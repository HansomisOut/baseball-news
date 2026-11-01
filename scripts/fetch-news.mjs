import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSources, mergeItems, parseFeed } from './lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const NEWS_PATH = join(ROOT, 'public/data/news.json');
const STATUS_PATH = join(ROOT, 'public/data/status.json');
const CONCURRENCY = 4;
const USER_AGENT = 'Mozilla/5.0 (compatible; baseball-news-pwa/1.0; personal feed reader)';

async function fetchSource(source, attempts = 2) {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(source.url, {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(20000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const items = parseFeed(await response.text());
      return source.source ? items.map((item) => ({ ...item, source: source.source })) : items;
    } catch (error) {
      if (attempt >= attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }
}

async function fetchAll(sources) {
  const items = [];
  const failures = [];
  const queue = [...sources];
  const worker = async () => {
    for (let source = queue.shift(); source; source = queue.shift()) {
      try {
        items.push(...(await fetchSource(source)));
      } catch (error) {
        failures.push({ name: source.name, error: String(error.message ?? error) });
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return { items, failures };
}

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 1)}\n`);
  await rename(temp, path);
}

const config = await readJson(join(ROOT, 'config/sources.json'));
const previous = await readJson(NEWS_PATH, { items: [] });
const sources = buildSources(config);
const { items, failures } = await fetchAll(sources);

for (const failure of failures) console.warn(`取得失敗: ${failure.name} (${failure.error})`);

// 全滅なら保存せず失敗扱いにする（既存のデータを壊さない）
if (failures.length === sources.length) {
  console.error('すべての取得元で失敗しました');
  process.exit(1);
}

const now = new Date();
const merged = mergeItems(previous.items, items, config, now);
const candidates = config.candidates.map(({ name, team, category, position }) => ({ name, team, category, position }));
const payload = { items: merged, candidates };

// 中身が変わらなければ news.json を書き換えない（無駄なコミットを防ぐ）
const changed = JSON.stringify(payload.items) !== JSON.stringify(previous.items)
  || JSON.stringify(payload.candidates) !== JSON.stringify(previous.candidates);
if (changed) await writeJson(NEWS_PATH, payload);

await writeJson(STATUS_PATH, {
  checkedAt: now.toISOString(),
  sourceCount: sources.length,
  failures,
});

const count = (topic) => merged.filter((item) => item.topics.includes(topic)).length;
const added = merged.filter((item) => item.firstSeen === now.toISOString()).length;
console.log(`取得元 ${sources.length - failures.length}/${sources.length} 成功 / 新着 ${added} 件`);
console.log(`合計 ${merged.length} 件（DeNA ${count('baystars')} / ドラフト ${count('draft')}）`);
