const PAGE_SIZE = 40;
const STALE_HOURS = 6;
const TABS = ['all', 'baystars', 'draft', 'saved'];
const CATEGORIES = ['高校', '大学', '社会人'];
const OFFICIAL_FILTERS = [['all', 'すべて'], ['press', '報道'], ['official', '公式']];

const $ = (id) => document.getElementById(id);

const store = {
  read(key, fallback) {
    try {
      const value = localStorage.getItem(key);
      return value === null ? fallback : JSON.parse(value);
    } catch {
      return fallback;
    }
  },
  write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // プライベートブラウズなどでは保存できないが、表示は続ける
    }
  },
};

const state = {
  items: [],
  candidates: [],
  query: '',
  category: null,
  player: null,
  official: 'all',
  limit: PAGE_SIZE,
  saved: store.read('saved', {}),
  read: new Set(store.read('read', [])),
  previousVisit: store.read('lastVisit', null),
};

function currentTab() {
  const hash = location.hash.slice(1);
  return TABS.includes(hash) ? hash : 'all';
}

const fold = (text) => text.normalize('NFKC').toLowerCase();

function matches(item, tab) {
  if (tab === 'baystars') {
    if (!item.topics.includes('baystars')) return false;
    if (state.official === 'official' && !item.official) return false;
    if (state.official === 'press' && item.official) return false;
  }
  if (tab === 'draft') {
    if (!item.topics.includes('draft')) return false;
    if (state.player && !item.players.includes(state.player)) return false;
    if (state.category && !state.player) {
      const names = state.candidates.filter((c) => c.category === state.category).map((c) => c.name);
      if (!item.players.some((name) => names.includes(name))) return false;
    }
  }
  if (state.query) {
    const haystack = fold(`${item.title} ${item.source} ${item.players.join(' ')}`);
    if (!state.query.split(/\s+/).every((word) => haystack.includes(word))) return false;
  }
  return true;
}

function visibleItems(tab) {
  const pool = tab === 'saved'
    ? Object.values(state.saved).sort((a, b) => b.date.localeCompare(a.date))
    : state.items;
  return pool.filter((item) => matches(item, tab));
}

function element(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function chip(label, pressed, onClick, count) {
  const button = element('button', { type: 'button', className: 'chip' }, label);
  button.setAttribute('aria-pressed', String(pressed));
  if (count !== undefined) {
    button.append(element('small', { textContent: String(count) }));
    if (count === 0) button.classList.add('empty');
  }
  button.addEventListener('click', () => {
    onClick();
    state.limit = PAGE_SIZE;
    render();
  });
  return button;
}

function renderFilters(tab) {
  const box = $('filters');
  const scrollLeft = box.querySelector('.scroll')?.scrollLeft ?? 0;
  box.replaceChildren();

  if (tab === 'baystars') {
    box.append(element('div', { className: 'chip-row' },
      ...OFFICIAL_FILTERS.map(([value, label]) =>
        chip(label, state.official === value, () => { state.official = value; }))));
  }

  if (tab === 'draft') {
    box.append(element('div', { className: 'chip-row' },
      chip('全カテゴリ', !state.category, () => { state.category = null; state.player = null; }),
      ...CATEGORIES.map((category) => chip(category, state.category === category, () => {
        state.category = category;
        state.player = null;
      }))));

    const counts = new Map();
    for (const item of state.items) {
      for (const name of item.players) counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    const players = state.candidates.filter((c) => !state.category || c.category === state.category);
    const row = element('div', { className: 'chip-row scroll' },
      ...players.map((c) => {
        const button = chip(c.name, state.player === c.name, () => {
          state.player = state.player === c.name ? null : c.name;
        }, counts.get(c.name) ?? 0);
        button.title = [c.team, c.position].filter(Boolean).join(' / ');
        return button;
      }));
    box.append(row);
    row.scrollLeft = scrollLeft;
  }
}

function dayKey(date) {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function dayLabel(date, now) {
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (dayKey(date) === dayKey(now)) return '今日';
  if (dayKey(date) === dayKey(yesterday)) return '昨日';
  const weekday = '日月火水木金土'[date.getDay()];
  const prefix = date.getFullYear() === now.getFullYear() ? '' : `${date.getFullYear()}年`;
  return `${prefix}${date.getMonth() + 1}月${date.getDate()}日（${weekday}）`;
}

function timeLabel(date, now) {
  const minutes = Math.floor((now - date) / 60000);
  if (minutes < 1) return 'たった今';
  if (minutes < 60) return `${minutes}分前`;
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}時間前`;
  return `${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/** 媒体名がURLのまま届くことがあるので、ドメインだけにする */
function sourceLabel(source) {
  return source.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
}

function renderCard(item, now) {
  const isRead = state.read.has(item.id);
  const date = new Date(item.date);
  const meta = element('span', { className: 'card-meta' });

  if (state.previousVisit && item.firstSeen > state.previousVisit && !isRead) {
    meta.append(element('span', { className: 'badge new', textContent: 'NEW' }));
  }
  meta.append(
    element('span', { textContent: sourceLabel(item.source) || '不明な媒体' }),
    element('time', { dateTime: item.date, textContent: timeLabel(date, now) }),
  );
  if (item.official) meta.append(element('span', { className: 'badge', textContent: '公式' }));
  for (const name of item.players) meta.append(element('span', { className: 'badge draft', textContent: name }));

  const link = element('a', {
    className: 'card-link',
    href: /^https?:\/\//i.test(item.url) ? item.url : '#',
    target: '_blank',
    rel: 'noopener noreferrer',
  }, element('span', { className: 'card-title', textContent: item.title }), meta);
  const card = element('article', { className: isRead ? 'card read' : 'card' }, link);

  link.addEventListener('click', () => {
    state.read.add(item.id);
    store.write('read', [...state.read].slice(-3000));
    card.classList.add('read');
    meta.querySelector('.new')?.remove();
  });

  const isSaved = Boolean(state.saved[item.id]);
  const save = element('button', {
    type: 'button',
    className: 'save',
    textContent: isSaved ? '★' : '☆',
    ariaLabel: `「${item.title}」を保存`,
  });
  save.setAttribute('aria-pressed', String(isSaved));
  save.addEventListener('click', () => {
    if (state.saved[item.id]) delete state.saved[item.id];
    else state.saved[item.id] = item;
    store.write('saved', state.saved);
    if (currentTab() === 'saved') render();
    else {
      const pressed = Boolean(state.saved[item.id]);
      save.textContent = pressed ? '★' : '☆';
      save.setAttribute('aria-pressed', String(pressed));
    }
  });
  card.append(save);
  return card;
}

function emptyMessage(tab) {
  if (state.query) return '検索に一致する記事はありません。';
  if (tab === 'saved') return '☆ を押した記事がここに保存されます。';
  if (state.player) return `最近の見出しに「${state.player}」を含む記事はありません。`;
  return state.items.length ? 'この条件の記事はありません。' : 'ニュースを読み込めませんでした。';
}

function render() {
  const tab = currentTab();
  for (const link of document.querySelectorAll('.tabs a')) {
    if (link.dataset.tab === tab) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  renderFilters(tab);

  const items = visibleItems(tab);
  const now = new Date();
  const list = $('list');
  list.replaceChildren();
  $('count').textContent = `${items.length.toLocaleString('ja-JP')} 件`;

  if (!items.length) {
    list.append(element('p', { className: 'empty-state', textContent: emptyMessage(tab) }));
  }

  let lastDay = '';
  for (const item of items.slice(0, state.limit)) {
    const date = new Date(item.date);
    if (dayKey(date) !== lastDay) {
      lastDay = dayKey(date);
      list.append(element('h2', { className: 'day', textContent: dayLabel(date, now) }));
    }
    list.append(renderCard(item, now));
  }
  $('more').hidden = items.length <= state.limit;
}

function showNotice(message) {
  $('notice').textContent = message ?? '';
  $('notice').hidden = !message;
}

async function fetchJson(path) {
  const response = await fetch(path, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function applyStatus(status) {
  if (!status?.checkedAt) {
    $('status').textContent = '';
    return null;
  }
  const checked = new Date(status.checkedAt);
  const ok = status.sourceCount - status.failures.length;
  $('status').textContent = `最終取得 ${checked.toLocaleString('ja-JP', { dateStyle: 'short', timeStyle: 'short' })} ／ 取得元 ${ok}/${status.sourceCount} 件成功`;
  return (Date.now() - checked) / 3600000 > STALE_HOURS ? checked : null;
}

async function load() {
  const button = $('refresh');
  button.disabled = true;
  button.textContent = '更新中…';
  try {
    const [news, status] = await Promise.all([
      fetchJson('data/news.json'),
      fetchJson('data/status.json').catch(() => null),
    ]);
    state.items = news.items;
    state.candidates = news.candidates;
    const staleSince = applyStatus(status);
    showNotice(staleSince
      ? `ニュースの取得が ${staleSince.toLocaleString('ja-JP', { dateStyle: 'short', timeStyle: 'short' })} から止まっています。`
      : navigator.onLine === false ? 'オフラインです。保存済みのデータを表示しています。' : null);
  } catch {
    showNotice(state.items.length
      ? '更新できませんでした。前回のデータを表示しています。'
      : 'ニュースを読み込めませんでした。通信状況を確認して「更新」を押してください。');
  } finally {
    button.disabled = false;
    button.textContent = '更新';
    render();
  }
}

$('refresh').addEventListener('click', load);
$('more').addEventListener('click', () => {
  state.limit += PAGE_SIZE;
  render();
});
$('search').addEventListener('input', (event) => {
  state.query = fold(event.target.value.trim());
  state.limit = PAGE_SIZE;
  render();
});
window.addEventListener('hashchange', () => {
  state.limit = PAGE_SIZE;
  window.scrollTo(0, 0);
  render();
});
window.addEventListener('online', load);
window.addEventListener('offline', () => showNotice('オフラインです。保存済みのデータを表示しています。'));

let installPrompt = null;
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  installPrompt = event;
  $('install').hidden = false;
});
$('install').addEventListener('click', async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  $('install').hidden = true;
});

store.write('lastVisit', new Date().toISOString());
load();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch((error) => console.warn('Service Worker 登録失敗', error));
}
