import { createHash } from 'node:crypto';

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code) => {
    if (code[0] !== '#') return ENTITIES[code.toLowerCase()] ?? whole;
    const point = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
    return point <= 0x10ffff ? String.fromCodePoint(point) : whole;
  });
}

function readText(raw) {
  const cdata = raw.match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
  // タグを除いてから実体参照を戻す（順序が逆だと「&lt;B&gt;」のような文字まで消える）
  const text = (cdata ? cdata[1] : raw).replace(/<[^>]+>/g, '');
  return (cdata ? text : decodeEntities(text)).replace(/\s+/g, ' ').trim();
}

function readTag(block, names) {
  for (const name of names) {
    const match = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
    if (match) return readText(match[1]);
  }
  return '';
}

function readLink(block) {
  const rss = block.match(/<link>([\s\S]*?)<\/link>/i);
  if (rss) return readText(rss[1]);
  const links = [...block.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]);
  const atom = links.find((l) => /rel=["']alternate["']/i.test(l)) ?? links.find((l) => !/rel=/i.test(l));
  const href = atom?.match(/href=["']([^"']+)["']/i);
  return href ? decodeEntities(href[1]) : '';
}

/** RSS 2.0 / Atom を {title, url, date, source, sourceUrl} の配列にする */
export function parseFeed(xml) {
  const items = [];
  for (const [block] of xml.matchAll(/<(item|entry)\b[\s\S]*?<\/\1>/gi)) {
    const source = block.match(/<source\b([^>]*)>([\s\S]*?)<\/source>/i);
    const item = {
      title: readTag(block, ['title']),
      url: readLink(block),
      date: readTag(block, ['pubDate', 'published', 'updated', 'dc:date']),
      source: source ? readText(source[2]) : '',
      sourceUrl: source ? (source[1].match(/url=["']([^"']+)["']/i)?.[1] ?? '') : '',
    };
    if (item.title && /^https?:\/\//i.test(item.url)) items.push(item);
  }
  return items;
}

/** 見出しの末尾に付く媒体名などを取り除き、転載元が分かれば媒体名もそちらにする */
export function cleanHeadline(rawTitle, rawSource) {
  const suffix = ` - ${rawSource}`;
  let title = rawSource && rawTitle.endsWith(suffix) ? rawTitle.slice(0, -suffix.length).trim() : rawTitle;
  let source = rawSource;
  title = title.replace(/(?:｜[^｜]+)*｜記事一覧$/, '').trim();
  if (/Yahoo/i.test(rawSource)) {
    const outlet = title.match(/\s*[（(]([^（）()]{1,30})[）)]$/);
    if (outlet) {
      title = title.slice(0, outlet.index).trim();
      source = outlet[1];
    }
  }
  return { title, source };
}

const normalize = (text) => text.normalize('NFKC');

/** 媒体が違っても同じ見出しなら同じ記事として扱うためのキー */
export function titleKey(title) {
  return normalize(title).toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
}

export function makeId(title) {
  return createHash('sha1').update(titleKey(title)).digest('hex').slice(0, 12);
}

function isNextDraftHeadline(text, year) {
  // 「27年オフからドラフト指名権」のようなFA補償の話や、指名済み選手の交渉の話を除く
  if (!text.includes('ドラフト') || /指名権|補償|交渉/.test(text)) return false;
  if (/2027年?[^、。]{0,8}ドラフト|ドラフト[^、。]{0,4}2027|(?<!\d)27年の?ドラフト/.test(text)) return true;
  // 「来年のドラフト」が2027年を指すのは2026年の記事だけ
  const relative = year <= 2026 ? '来年|来秋' : year === 2027 ? '今年|今秋' : null;
  return relative !== null && new RegExp(`(${relative})[^、。]{0,12}ドラフト`).test(text);
}

/**
 * 見出しから話題と候補選手を判定する。関係ない記事は null。
 * 検索エンジンの結果には無関係な記事も混ざるので、必ず見出しで確かめる。
 */
export function classify(item, config) {
  const title = normalize(item.title);
  const exclude = new RegExp(config.filters.exclude);
  const excludeSources = new RegExp(config.filters.excludeSources);
  if (exclude.test(title) || excludeSources.test(item.source ?? '')) return null;

  const players = config.candidates
    .filter((c) => [c.name, ...(c.aliases ?? [])].some((name) => title.includes(normalize(name))))
    .map((c) => c.name);

  const year = new Date(item.date).getFullYear();
  const isDraft = players.length > 0 || isNextDraftHeadline(title, year);

  const official = /baystars\.co\.jp/i.test(item.sourceUrl ?? '') || /baystars\.co\.jp/i.test(item.url);
  const named = /ベイスターズ/.test(title) || official;
  const corporate = new RegExp(config.filters.excludeCorporate);
  const isBaystars = named || (/DeNA|DENA/.test(title) && !corporate.test(title));

  const topics = [];
  if (isBaystars) topics.push('baystars');
  if (isDraft) topics.push('draft');
  return topics.length ? { topics, players, official } : null;
}

/**
 * 既存の記事に新着をマージする。判定は既存分も毎回やり直すので、
 * 候補リストやフィルタを変更すると過去の記事にも反映される。
 */
export function mergeItems(existing, incoming, config, now = new Date()) {
  const byKey = new Map(existing.map((item) => [titleKey(item.title), item]));
  const nowIso = now.toISOString();

  for (const raw of incoming) {
    const { title, source } = cleanHeadline(raw.title, raw.source);
    const key = titleKey(title);
    if (!key) continue;
    const parsed = new Date(raw.date);
    const date = Number.isNaN(parsed.getTime()) || parsed > now ? nowIso : parsed.toISOString();
    const current = byKey.get(key);
    if (current) {
      // 中継リンクより媒体への直リンクを優先する
      if (/news\.google\.com/.test(current.url) && !/news\.google\.com/.test(raw.url)) {
        current.url = raw.url;
        current.source = source;
      }
      continue;
    }
    byKey.set(key, {
      id: makeId(title),
      title,
      url: raw.url,
      source,
      sourceUrl: raw.sourceUrl ?? '',
      date,
      firstSeen: nowIso,
    });
  }

  const cutoff = now.getTime() - config.retentionDays * 86400000;
  const result = [];
  for (const item of byKey.values()) {
    if (new Date(item.date).getTime() < cutoff) continue;
    const verdict = classify(item, config);
    if (verdict) result.push({ ...item, ...verdict });
  }
  result.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  return result.slice(0, config.maxItems);
}

export function googleNewsUrl(query) {
  const params = new URLSearchParams({ q: `${query} when:30d`, hl: 'ja', gl: 'JP', ceid: 'JP:ja' });
  return `https://news.google.com/rss/search?${params}`;
}

/** 設定から取得先の一覧を作る */
export function buildSources(config) {
  return [
    ...config.searches.map((q) => ({ name: `検索: ${q}`, url: googleNewsUrl(q) })),
    ...config.candidates.map((c) => ({ name: `選手: ${c.name}`, url: googleNewsUrl(`"${c.name}" 野球`) })),
    ...config.feeds.map((f) => ({ name: f.name, url: f.url, source: f.name })),
  ];
}
