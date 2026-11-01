import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classify, cleanHeadline, mergeItems, parseFeed, titleKey } from '../scripts/lib.mjs';

const config = {
  retentionDays: 120,
  maxItems: 100,
  filters: {
    exclude: 'Bリーグ|ブレイブサンダース',
    excludeSources: 'BAYSTORE',
    excludeCorporate: '決算|(?<![A-Za-z])AI(?![A-Za-z])',
  },
  candidates: [
    { name: '川本晴大', category: '高校' },
    { name: '髙橋煌稀', aliases: ['高橋煌稀'], category: '大学' },
  ],
};
const topicsOf = (title, extra = {}) =>
  classify({ title, date: '2026-10-30T00:00:00Z', url: 'https://example.com/', ...extra }, config)?.topics ?? null;

test('RSS を読み、実体参照と CDATA と source を解釈する', () => {
  const [a, b] = parseFeed(`<rss><channel><title>feed</title>
    <item><title>A &amp; B &#x3042;</title><link>https://a.example/1?x=1&amp;y=2</link>
      <pubDate>Sat, 31 Oct 2026 20:36:40 GMT</pubDate><source url="https://www.baystars.co.jp">公式</source></item>
    <item><title><![CDATA[C & D]]></title><link>https://a.example/2</link></item>
  </channel></rss>`);
  assert.equal(a.title, 'A & B あ');
  assert.equal(a.url, 'https://a.example/1?x=1&y=2');
  assert.equal(a.source, '公式');
  assert.equal(a.sourceUrl, 'https://www.baystars.co.jp');
  assert.equal(b.title, 'C & D');
});

test('実体参照を二重に解釈しない', () => {
  const [item] = parseFeed('<rss><item><title>&amp;lt;x&amp;gt;</title><link>https://a.example/</link></item></rss>');
  assert.equal(item.title, '&lt;x&gt;');
});

test('実体参照で書かれた山括弧の中身を消さない', () => {
  const [item] = parseFeed('<rss><item><title>A &lt;B&gt; C</title><link>https://a.example/</link></item></rss>');
  assert.equal(item.title, 'A <B> C');
});

test('Atom のリンクを読み、http 以外のリンクは捨てる', () => {
  const items = parseFeed(`<feed>
    <entry><title>atom</title><link rel="self" href="https://a.example/self"/>
      <link rel="alternate" href="https://a.example/page"/><published>2026-10-30T00:00:00Z</published></entry>
    <entry><title>bad</title><link rel="alternate" href="javascript:alert(1)"/></entry>
  </feed>`);
  assert.equal(items.length, 1);
  assert.equal(items[0].url, 'https://a.example/page');
});

test('見出しを整え、Yahoo!経由は転載元の媒体名にする', () => {
  assert.deepEqual(cleanHeadline('見出し - 中日新聞Web', '中日新聞Web'), { title: '見出し', source: '中日新聞Web' });
  assert.deepEqual(cleanHeadline('見出し（THE ANSWER） - Yahoo!ニュース', 'Yahoo!ニュース'), { title: '見出し', source: 'THE ANSWER' });
  assert.deepEqual(cleanHeadline('試合（第3戦） - サンスポ', 'サンスポ'), { title: '試合（第3戦）', source: 'サンスポ' });
  assert.deepEqual(cleanHeadline('見出し｜試合レポート｜記事一覧 - 高校野球ドットコム', '高校野球ドットコム'), { title: '見出し', source: '高校野球ドットコム' });
});

test('全角半角と記号の違いを同一視する', () => {
  assert.equal(titleKey('ＤｅＮＡ、勝利！'), titleKey('DeNA 勝利'));
});

test('話題の判定', () => {
  assert.deepEqual(topicsOf('DeNAが逆転勝ち'), ['baystars']);
  assert.deepEqual(topicsOf('ＤｅＮＡが逆転勝ち'), ['baystars']);
  assert.deepEqual(topicsOf('今日の試合結果', { sourceUrl: 'https://www.baystars.co.jp' }), ['baystars']);
  assert.deepEqual(topicsOf('川本晴大が完封'), ['draft']);
  assert.deepEqual(topicsOf('2027年ドラフト候補ランキング'), ['draft']);
  assert.deepEqual(topicsOf('DeNAが川本晴大を密着マーク'), ['baystars', 'draft']);
  assert.equal(topicsOf('巨人が連勝'), null);
});

test('別名でも候補選手を正式名で記録する', () => {
  const verdict = classify({ title: '高橋煌稀が好投', date: '2026-10-30T00:00:00Z', url: 'https://a.example/' }, config);
  assert.deepEqual(verdict.players, ['髙橋煌稀']);
});

test('無関係な話題を除外する', () => {
  assert.equal(topicsOf('Bリーグドラフト2027 指名候補'), null);
  assert.equal(topicsOf('DeNA川崎ブレイブサンダースが勝利'), null);
  assert.equal(topicsOf('DeNAが決算を発表'), null);
  assert.equal(topicsOf('ふわもこポーチ', { source: 'BAYSTORE ONLINE', sourceUrl: 'https://www.baystars.co.jp' }), null);
  assert.equal(topicsOf('FAの人的補償を撤廃 27年オフからドラフト指名権か金銭補償に'), null);
  assert.deepEqual(topicsOf('DeNA、ドラフト3位と27年5月以降に交渉'), ['baystars']);
  assert.deepEqual(topicsOf('【27年ドラフト展望】大阪桐蔭の左腕は大器'), ['draft']);
  assert.deepEqual(topicsOf('【表】2027年 主なドラフト候補'), ['draft']);
  assert.equal(topicsOf('DeNA、AI事業を強化'), null);
  assert.deepEqual(topicsOf('DeNA、FAIR な判定に抗議'), ['baystars']);
});

test('「来年のドラフト」は記事の年で解釈する', () => {
  assert.deepEqual(topicsOf('来年のドラフトは豊作'), ['draft']);
  assert.equal(topicsOf('来年のドラフトは豊作', { date: '2027-11-01T00:00:00Z' }), null);
  assert.deepEqual(topicsOf('今年のドラフトは豊作', { date: '2027-05-01T00:00:00Z' }), ['draft']);
  assert.equal(topicsOf('今年のドラフトは豊作'), null);
});

test('マージ: 重複をまとめ、直リンクを優先し、古い記事と未来の日付を処理する', () => {
  const now = new Date('2026-11-01T00:00:00Z');
  const first = mergeItems([], [
    { title: 'DeNAが勝利 - 媒体A', source: '媒体A', url: 'https://news.google.com/rss/articles/1', date: '2026-10-31T00:00:00Z' },
    { title: 'DeNAの未来記事', source: '媒体A', url: 'https://a.example/f', date: '2030-01-01T00:00:00Z' },
    { title: 'DeNAの古い記事', source: '媒体A', url: 'https://a.example/o', date: '2026-01-01T00:00:00Z' },
    { title: '巨人が勝利', source: '媒体A', url: 'https://a.example/g', date: '2026-10-31T00:00:00Z' },
  ], config, now);
  assert.deepEqual(first.map((i) => i.title), ['DeNAの未来記事', 'DeNAが勝利']);
  assert.equal(first[0].date, now.toISOString());

  const later = new Date('2026-11-01T01:00:00Z');
  const second = mergeItems(first, [
    { title: 'DeNAが勝利', source: '媒体B', url: 'https://b.example/1', date: '2026-10-31T05:00:00Z' },
  ], config, later);
  assert.equal(second.length, 2);
  const merged = second.find((i) => i.title === 'DeNAが勝利');
  assert.equal(merged.url, 'https://b.example/1');
  assert.equal(merged.source, '媒体B');
  assert.equal(merged.firstSeen, now.toISOString());
  assert.equal(merged.official, false);
});
