const { isWebUrl } = require('./core.cjs');

const commonSites = [
  ['Google', 'https://www.google.com/'], ['YouTube', 'https://www.youtube.com/'],
  ['Wikipedia', 'https://www.wikipedia.org/'], ['GitHub', 'https://github.com/'],
  ['Reddit', 'https://www.reddit.com/'], ['Spotify', 'https://open.spotify.com/'],
  ['Gmail', 'https://mail.google.com/'], ['Outlook', 'https://outlook.live.com/'],
  ['BBC', 'https://www.bbc.co.uk/'], ['Amazon', 'https://www.amazon.co.uk/'],
  ['Netflix', 'https://www.netflix.com/'], ['ChatGPT', 'https://chatgpt.com/'],
].map(([title, url]) => ({ title, url, source: 'Common website' }));

function buildSuggestions(query, { history = [], bookmarks = [] } = {}) {
  const text = String(query || '').trim().toLowerCase().slice(0, 200);
  const words = text.split(/\s+/).filter(Boolean);
  const sources = [
    ...history.map(item => ({ ...item, source: 'Recently visited', weight: 30 })),
    ...bookmarks.map(item => ({ ...item, source: 'Bookmark', weight: 25 })),
    ...commonSites.map(item => ({ ...item, weight: 0 })),
  ];
  const seen = new Set();
  const results = [];
  for (const item of sources) {
    if (!isWebUrl(item.url)) continue;
    const url = new URL(item.url);
    const host = url.hostname.replace(/^www\./, '');
    const title = String(item.title || host).slice(0, 200);
    const haystack = `${host} ${url.pathname} ${title}`.toLowerCase();
    if (words.some(word => !haystack.includes(word))) continue;
    const key = `${host}${url.pathname}${url.search}${url.hash}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const score = item.weight + (text && host.startsWith(text) ? 100 : 0) + (text && title.toLowerCase().startsWith(text) ? 50 : 0);
    results.push({ title, url: url.href, source: item.source, time: item.time || null, score });
  }
  return results.sort((a, b) => b.score - a.score || (b.time || 0) - (a.time || 0)).slice(0, 8).map(({ score, ...item }) => item);
}
module.exports = { buildSuggestions, commonSites };
