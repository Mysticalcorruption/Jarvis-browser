const SEARCH_ENGINES = {
  duckduckgo: 'https://duckduckgo.com/?q=',
  google: 'https://www.google.com/search?q=',
  bing: 'https://www.bing.com/search?q=',
};

function isWebUrl(value) {
  try { const u = new URL(value); return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password; } catch { return false; }
}

function resolveAddress(input, engine = 'duckduckgo') {
  const value = String(input || '').trim().slice(0, 8192);
  if (!value || /^(jarvis|jarvis:\/\/home|home)$/i.test(value)) return 'jarvis://home';
  if (/^(https?):\/\//i.test(value)) {
    if (!isWebUrl(value)) throw new Error('Enter a valid web address without embedded credentials.');
    return new URL(value).href;
  }
  if (/^(localhost|127\.0\.0\.1)(:\d+)?(\/.*)?$/i.test(value)) return new URL('http://' + value).href;
  if (/^[a-z][a-z\d+.-]*:/i.test(value) && !/^[\w.-]+:\d+(\/.*)?$/.test(value)) throw new Error('Only http and https web addresses can be opened.');
  if (/^[^\s/]+\.[a-z]{2,}(:\d+)?(\/[^\s]*)?$/i.test(value)) {
    const url = 'https://' + value;
    if (isWebUrl(url)) return new URL(url).href;
  }
  return (SEARCH_ENGINES[engine] || SEARCH_ENGINES.duckduckgo) + encodeURIComponent(value);
}

function localCommand(input) {
  const text = String(input || '').trim();
  if (/^(?:hey[, ]+)?jarvis[, ]+/i.test(text)) return localCommand(text.replace(/^(?:hey[, ]+)?jarvis[, ]+/i, ''));
  if (/^(new tab|open a new tab)$/i.test(text)) return { type: 'new-tab' };
  if (/^(go home|home|open home)$/i.test(text)) return { type: 'home' };
  if (/^(go back|back)$/i.test(text)) return { type: 'back' };
  if (/^(go forward|forward)$/i.test(text)) return { type: 'forward' };
  if (/^(reload|refresh)( this page| the page)?$/i.test(text)) return { type: 'reload' };
  if (/^(bookmark|save)( this)?( page)?$/i.test(text)) return { type: 'bookmark' };
  const search = text.match(/^search(?: the web)?(?: for)?\s+(.+)$/i);
  if (search) return { type: 'search', value: search[1] };
  const open = text.match(/^(?:open|go to|navigate to)\s+(.+)$/i);
  if (open) {
    const shortcuts = { youtube: 'https://youtube.com', google: 'https://google.com', github: 'https://github.com', wikipedia: 'https://wikipedia.org', reddit: 'https://reddit.com', spotify: 'https://open.spotify.com', gmail: 'https://mail.google.com' };
    const value = shortcuts[open[1].toLowerCase()] || open[1];
    if (isWebUrl(value) || /^[\w.-]+\.[a-z]{2,}(\/.*)?$/i.test(value)) return { type: 'open', value };
  }
  return null;
}

function sanitizeActions(actions) {
  if (!Array.isArray(actions)) return [];
  return actions.slice(0, 4).filter(a => a && typeof a.label === 'string' && typeof a.value === 'string' &&
    ((a.type === 'open' && isWebUrl(a.value)) || (a.type === 'search' && a.value.trim().length > 0)))
    .map(a => ({ type: a.type, label: a.label.slice(0, 80), value: a.value.slice(0, 2000) }));
}

module.exports = { SEARCH_ENGINES, isWebUrl, resolveAddress, localCommand, sanitizeActions };
