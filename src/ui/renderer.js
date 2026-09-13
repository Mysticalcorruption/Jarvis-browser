/* The UI talks only to a small, trusted preload bridge. Web pages never receive it. */
const $ = (id) => document.getElementById(id);
const api = window.jarvis;
let state = null;
let chat = [];
let pending = false;
let attached = false;
let currentPanel = null;
let toastTimer;
let lastFocus;
let recorder, recordingStream, recordingTimer;
let canvasFrame = 0;
let suggestionInput = null, suggestionItems = [], suggestionIndex = -1, suggestionRequest = 0;
let chatMemoryPromise = Promise.resolve();
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function invoke(command, payload = {}) {
  try {
    const result = await api.invoke(command, payload);
    if (result?.error && !['ask', 'transcribe'].includes(command)) notify(result.error);
    return result;
  } catch { notify('That action could not be completed. Please try again.'); return { error: 'Could not complete this action.' }; }
}
function notify(message) { $('toast').textContent = message; $('toast').classList.remove('hidden'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').classList.add('hidden'), 4500); }
function activeTab() { return state?.tabs.find(t => t.id === state.activeId); }
function isHome() { return !activeTab() || activeTab().url === 'jarvis://home'; }
function hostname(url) { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } }

function syncOverlay() { invoke('overlay', { open: Boolean(currentPanel || (suggestionInput === 'address')) }); }
function closeSuggestions() {
  suggestionRequest++;
  for (const inputId of ['address', 'home-query']) {
    $(inputId).setAttribute('aria-expanded', 'false'); $(inputId).removeAttribute('aria-activedescendant');
  }
  $('address-suggestions').classList.add('hidden'); $('home-suggestions').classList.add('hidden');
  suggestionInput = null; suggestionItems = []; suggestionIndex = -1; syncOverlay();
}
function suggestionBox(inputId = suggestionInput) { return $(inputId === 'address' ? 'address-suggestions' : 'home-suggestions'); }
async function showSuggestions(inputId, all = false) {
  if (!state || currentPanel) return;
  const input = $(inputId);
  const query = all || input.value === 'jarvis://home' ? '' : input.value.trim();
  const request = ++suggestionRequest;
  const results = await invoke('suggestions', { query });
  if (request !== suggestionRequest || document.activeElement !== input || !Array.isArray(results)) return;
  suggestionInput = inputId; suggestionIndex = -1;
  suggestionItems = results.map(item => ({ ...item, kind: 'url' }));
  if (!query || /^(jarvis|settings|customi[sz]e|build)/i.test(query)) suggestionItems.unshift({ title: 'JARVIS · Home', url: 'jarvis://home', source: 'Your browser', kind: 'home' }, { title: 'Browser settings', url: '', source: 'Make JARVIS yours', kind: 'settings' });
  suggestionItems = suggestionItems.slice(0, 8);
  if (query) suggestionItems.push({ title: `Search for “${query}”`, url: searchUrl(query), source: state.settings.searchEngine === 'duckduckgo' ? 'DuckDuckGo' : state.settings.searchEngine === 'google' ? 'Google' : 'Bing', kind: 'search' });
  renderSuggestions(); input.setAttribute('aria-expanded', 'true'); syncOverlay();
}
function renderSuggestions() {
  if (!suggestionInput) return;
  const box = suggestionBox();
  $('address-suggestions').classList.toggle('hidden', suggestionInput !== 'address');
  $('home-suggestions').classList.toggle('hidden', suggestionInput !== 'home-query');
  box.innerHTML = `<div class="suggestion-heading">SUGGESTED DESTINATIONS <span>↑ ↓ to choose · Enter to open</span></div>` + suggestionItems.map((item, i) => `<button type="button" class="url-suggestion ${i === suggestionIndex ? 'selected' : ''}" role="option" aria-selected="${i === suggestionIndex}" id="${box.id}-item-${i}" data-suggestion="${i}">${icon(item.kind === 'search' ? 'search' : item.kind === 'home' ? 'home' : item.kind === 'builder' ? 'sparkles' : item.kind === 'settings' ? 'settings' : item.source === 'Recently visited' ? 'history' : item.source === 'Bookmark' ? 'bookmark' : 'globe')}<span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.kind === 'url' ? item.url : item.source)}</small></span><em>${escapeHtml(item.kind === 'url' ? item.source : '')}</em></button>`).join('');
  if (suggestionIndex >= 0) $(suggestionInput).setAttribute('aria-activedescendant', `${box.id}-item-${suggestionIndex}`);
  else $(suggestionInput).removeAttribute('aria-activedescendant');
}
function chooseSuggestion(index) {
  const item = suggestionItems[index];
  if (!item) return;
  const input = $(suggestionInput); closeSuggestions(); input.blur(); closeFind();
  if (['builder', 'settings'].includes(item.kind)) showPanel(item.kind);
  else invoke('navigate', { url: item.url });
}
function suggestionKeys(event, inputId) {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    if (suggestionInput !== inputId) { showSuggestions(inputId); return; }
    suggestionIndex = (suggestionIndex + (event.key === 'ArrowDown' ? 1 : -1) + suggestionItems.length) % suggestionItems.length;
    renderSuggestions();
    suggestionBox().querySelector('.selected')?.scrollIntoView({ block: 'nearest' });
  } else if (event.key === 'Enter' && suggestionInput === inputId && suggestionIndex >= 0) { event.preventDefault(); chooseSuggestion(suggestionIndex); }
  else if (event.key === 'Escape') { event.preventDefault(); closeSuggestions(); }
}

function renderRecent() {
  $('recent-section').classList.toggle('hidden', !state.settings.showRecent);
  $('quick-links').classList.toggle('hidden', !state.settings.showPopular);
  $('popular-heading').classList.toggle('hidden', !state.settings.showPopular);
  const recent = state.history.slice(0, 6);
  $('recent-sites').innerHTML = recent.length ? recent.map(item => `<button class="recent-site" data-recent-url="${escapeHtml(item.url)}" title="${escapeHtml(item.url)}">${icon('history')}<span><strong>${escapeHtml(item.title || hostname(item.url))}</strong><small>${escapeHtml(hostname(item.url))}</small></span>${icon('arrow-up-right')}</button>`).join('') : '<p class="recent-empty">Your recent pages will appear here as you browse.</p>';
}

function updateBounds() {
  if (!api) return;
  const box = $('page-viewport').getBoundingClientRect();
  const findHeight = $('find-bar').classList.contains('hidden') ? 0 : 43;
  invoke('bounds', { x: box.x, y: box.y + findHeight, width: box.width, height: box.height - findHeight });
}

function renderState(next) {
  if (!next || !next.tabs) return;
  state = next;
  const tab = activeTab();
  const home = isHome();
  $('home').classList.toggle('hidden', !home);
  $('page-error').classList.toggle('hidden', home || !tab?.error);
  $('page-error-message').textContent = tab?.error || '';
  $('tabs').innerHTML = state.tabs.map(t => `<div class="tab ${t.id === state.activeId ? 'active' : ''}" role="group" aria-label="${escapeHtml(t.title)} tab"><button class="tab-select" data-tab="${t.id}" title="${escapeHtml(t.url)}" aria-current="${t.id === state.activeId ? 'page' : 'false'}">${icon(t.loading ? 'refresh' : t.url === 'jarvis://home' ? 'home' : 'globe', t.loading ? 'loading-icon' : '')}<span class="tab-title">${escapeHtml(t.title)}</span></button><button class="tab-close" data-close-tab="${t.id}" aria-label="Close ${escapeHtml(t.title)} tab">${icon('close')}</button></div>`).join('');
  $('tab-count').textContent = String(state.tabs.length).padStart(2, '0');
  $('bookmark-count').textContent = state.bookmarks.length;
  $('home-tab-stat').textContent = String(state.tabs.length).padStart(2, '0');
  $('home-bookmark-stat').textContent = String(state.bookmarks.length).padStart(2, '0');
  if (document.activeElement !== $('address')) $('address').value = home ? 'jarvis://home' : tab?.url || '';
  $('address-icon').innerHTML = icon(home ? 'sparkles' : tab?.url.startsWith('https:') ? 'shield' : 'globe');
  $('back').disabled = !tab?.canGoBack;
  $('forward').disabled = !tab?.canGoForward;
  $('reload').innerHTML = icon(tab?.loading ? 'close' : 'refresh');
  $('reload').setAttribute('aria-label', tab?.loading ? 'Stop loading' : 'Reload page');
  $('bookmark-page').classList.toggle('bookmarked', state.bookmarks.some(b => b.url === tab?.url));
  $('bookmark-page').disabled = home;
  $('status-text').textContent = tab?.loading ? `Connecting to ${hostname(tab.url)}…` : home ? 'All systems ready' : tab?.error ? 'Page unavailable' : `Browsing ${hostname(tab?.url || '')}`;
  const name = state.settings.name || 'Commander';
  $('profile-name').textContent = name;
  document.querySelectorAll('.profile-avatar,.space-avatar').forEach(el => { el.textContent = name[0].toUpperCase(); });
  updateClock();
  $('assistant-panel').classList.toggle('hidden', !state.settings.assistantOpen);
  $('assistant-toggle').classList.toggle('active', state.settings.assistantOpen);
  $('speak-toggle').classList.toggle('active', state.settings.speak);
  $('speak-toggle').setAttribute('aria-pressed', String(state.settings.speak));
  document.body.classList.toggle('no-motion', !state.settings.animations);
  document.body.dataset.accent = state.settings.accent || 'cyan';
  document.body.dataset.theme = state.settings.theme || 'midnight';
  document.body.dataset.background = state.settings.background || 'aurora';
  document.documentElement.style.setProperty('--glow', String(Math.max(0, Math.min(100, Number(state.settings.glow ?? 55))) / 100));
  renderRecent();
  $('feature-tools').innerHTML = (state.features || []).map(feature => `<button class="side-link" data-tool-id="${escapeHtml(feature.id)}" title="${escapeHtml(feature.summary)}">${icon('square')}<span>${escapeHtml(feature.name)}</span></button>`).join('');
  $('connection-text').textContent = state.aiReady ? 'Free AI configured · OpenRouter' : 'Connect AI to start a conversation';
  $('connection-status').classList.toggle('connected', state.aiReady);
  JarvisGuide.update(state);
  if (window.JarvisLearningHud) JarvisLearningHud.render(state);
  updateAISetup();
  $('voice-button').disabled = true;
  $('voice-button').title = 'Microphone transcription is not included with free AI. Use Windows voice typing (Win + H) in the message box.';
  $('attach-page').disabled = home;
  if (home && attached) setAttached(false);
  requestAnimationFrame(updateBounds);
  if (currentPanel === 'downloads') renderCollection('downloads');
}

function updateClock() {
  const now = new Date();
  const hour = now.getHours();
  const greeting = 'Welcome';
  $('greeting').innerHTML = `${greeting}, ${escapeHtml(state?.settings.name || 'Commander')}<span>.</span>`;
  $('today').textContent = now.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' }).toUpperCase();
}

function setAttached(value) {
  attached = value;
  $('attach-page').classList.toggle('active', value);
  $('attach-page').setAttribute('aria-pressed', String(value));
  $('attach-page').querySelector('span:last-child').textContent = value ? 'This page will be included' : 'Include this page';
}
async function showAssistant(focus = true) {
  if (!state.settings.assistantOpen) await invoke('settings', { assistantOpen: true });
  if (focus) $('chat-input').focus();
}
function renderChat() {
  $('assistant-welcome').classList.toggle('hidden', chat.length > 0);
  $('messages').innerHTML = chat.map((m, index) => `<article class="message ${m.role} ${m.error ? 'error' : ''}"><div class="message-label">${m.role === 'assistant' ? icon('sparkles') : ''}${m.role === 'user' ? 'YOU' : 'JARVIS'}${m.local ? ' · BROWSER CONTROL' : ''}${m.model ? ` · ${escapeHtml(m.model)}` : ''}</div><div class="message-text">${escapeHtml(m.content)}</div>${m.context ? `<div class="context-tag">${icon('link')}Page included: ${escapeHtml(m.context)}</div>` : ''}${m.actions?.length ? `<div class="message-actions">${m.actions.map((action, a) => `<button data-chat-action="${index}:${a}">${escapeHtml(action.label)}${icon('arrow-up-right')}</button>`).join('')}</div>` : ''}${m.setup ? `<div class="message-actions"><button data-connect-ai>Connect AI ${icon('arrow-up-right')}</button></div>` : ''}</article>`).join('') + (pending ? '<div class="message"><div class="message-label">JARVIS IS THINKING · CHOOSING A FREE MODEL</div><div class="thinking"><i></i><i></i><i></i></div></div>' : '');
  $('send-message').innerHTML = icon(pending ? 'stop' : 'arrow-up');
  $('send-message').setAttribute('aria-label', pending ? 'Stop reply' : 'Send message');
  $('composer-hint').textContent = pending ? 'THINKING WITH YOU' : 'AT YOUR SERVICE';
  const memoryMessages = chat.filter(message => message && (message.role === 'user' || message.role === 'assistant')).length;
  $('assistant-footnote').textContent = memoryMessages
    ? `Saved locally on this laptop · ${memoryMessages} message${memoryMessages === 1 ? '' : 's'}. Page content stays private until you include it.`
    : 'Chat memory is ready on this laptop. Page content stays private until you include it.';
  requestAnimationFrame(() => { $('chat-scroll').scrollTop = $('chat-scroll').scrollHeight; });
}

function saveChatMemory() {
  // The main process sanitises and bounds this copy before writing it to the
  // local profile. Page bodies and screen snapshots are never included here.
  return invoke('save-chat', { messages: chat });
}

async function loadChatMemory() {
  const memory = await invoke('chat-memory');
  if (Array.isArray(memory?.messages)) chat = memory.messages;
  renderChat();
}

function speak(text) {
  if (!state.settings.speak || !window.speechSynthesis) return;
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text.slice(0, 5000));
  const voices = speechSynthesis.getVoices();
  utterance.voice = voices.find(v => /en-GB/.test(v.lang) && /George|Ryan|Male|David/i.test(v.name)) || voices.find(v => v.lang === 'en-GB') || voices.find(v => v.lang.startsWith('en')) || null;
  utterance.rate = 1; utterance.pitch = .92;
  speechSynthesis.speak(utterance);
}

async function runLocalCommand(text) {
  const value = text.replace(/^(?:hey[, ]+)?jarvis[, ]+/i, '').trim();
  if (/^(help|how (?:do i|does (?:this|it)) (?:work|use.*)|show me how)$/i.test(value)) { await showPanel('guide'); return 'I opened the guide. Choose Browse now or open your School library.'; }
  if (/^(new tab|open a new tab)$/i.test(value)) { await invoke('new-tab'); return 'A fresh tab, ready for your next idea.'; }
  if (/^(go home|home|open home)$/i.test(value)) { await invoke('navigate', { url: 'jarvis://home' }); return 'Welcome back to your command centre.'; }
  if (/^(go back|back)$/i.test(value)) { if (!activeTab()?.canGoBack) return 'There isn’t a previous page in this tab yet.'; await invoke('back'); return 'Going back one page.'; }
  if (/^(go forward|forward)$/i.test(value)) { if (!activeTab()?.canGoForward) return 'There isn’t a next page in this tab yet.'; await invoke('forward'); return 'Moving forward one page.'; }
  if (/^(reload|refresh)( this page| the page)?$/i.test(value)) { await invoke('reload'); return 'Refreshing the page.'; }
  if (/^(bookmark|save)( this)?( page)?$/i.test(value)) { const result = await invoke('bookmark'); return result?.error || (result?.saved ? 'Saved to your bookmarks.' : 'Removed from your bookmarks.'); }
  const search = value.match(/^search(?: the web)?(?: for)?\s+(.+)$/i);
  if (search) { await invoke('new-tab', { url: searchUrl(search[1]) }); return `Searching the web for “${search[1]}”.`; }
  const open = value.match(/^(?:open|go to|navigate to)\s+(.+)$/i);
  if (open) {
    const sites = { youtube: 'https://youtube.com', google: 'https://google.com', github: 'https://github.com', wikipedia: 'https://wikipedia.org', reddit: 'https://reddit.com', spotify: 'https://open.spotify.com', gmail: 'https://mail.google.com' };
    const target = sites[open[1].toLowerCase()] || open[1];
    if (/^https?:\/\//i.test(target) || /^[\w.-]+\.[a-z]{2,}(\/.*)?$/i.test(target)) {
      const result = await invoke('new-tab', { url: target });
      return result?.error || `Opening ${open[1]}.`;
    }
  }
  return null;
}
function searchUrl(query) {
  const prefixes = { google: 'https://www.google.com/search?q=', bing: 'https://www.bing.com/search?q=', duckduckgo: 'https://duckduckgo.com/?q=' };
  return (prefixes[state.settings.searchEngine] || prefixes.duckduckgo) + encodeURIComponent(query);
}

async function sendMessage(text) {
  text = (text || $('chat-input').value).trim();
  if (!text || pending) return;
  if (text.length > 12000) { notify('Please keep messages under 12,000 characters.'); return; }
  await chatMemoryPromise;
  await showAssistant(false);
  $('chat-input').value = '';
  const include = attached && !isHome();
  chat.push({ role: 'user', content: text, context: include ? activeTab().title : null });
  await saveChatMemory();
  renderChat();
  pending = true; renderChat();
  const local = await runLocalCommand(text);
  if (local) { pending = false; chat.push({ role: 'assistant', content: local, local: true }); await saveChatMemory(); renderChat(); speak(local); return; }
  const messages = chat.filter(m => !m.error && !m.local).map(m => ({ role: m.role, content: m.content }));
  const result = await invoke('ask', { messages, attachPage: include });
  pending = false;
  if (result?.error) chat.push({ role: 'assistant', content: result.error, error: true, setup: result.needsSetup });
  else { chat.push({ role: 'assistant', content: result?.message || 'I didn’t receive a reply. Please try again.', actions: result?.actions || [], model: result?.model }); speak(result?.message || ''); }
  await saveChatMemory();
  renderChat(); $('chat-input').focus();
}

async function summarize() {
  await showAssistant();
  if (!state.aiReady) { await showPanel('settings'); return; }
  if (isHome()) { notify('Open a website, then choose “Summarize this page”.'); $('chat-input').placeholder = 'Open a page to summarize, or ask anything…'; return; }
  setAttached(true);
  await sendMessage('Summarize this page in a short overview and three key takeaways.');
}

async function toggleVoice() {
  notify('Use Windows voice typing (Win + H) in the message box. JARVIS can still read replies aloud.');
}

function updateAISetup() {
  if (currentPanel !== 'settings' || !$('connect-free-ai')) return;
  const busy = ['waiting', 'connecting'].includes(state.aiAuth?.phase);
  $('connect-free-ai').disabled = busy;
  $('connect-free-ai').textContent = busy ? 'Waiting for sign-in…' : state.aiReady ? 'Reconnect free AI' : 'Connect free AI';
  $('cancel-connect-ai').classList.toggle('hidden', !busy);
  $('ai-setup-status').textContent = state.aiAuth?.message || (state.aiReady ? 'Your free AI connection is saved. Try a question or build a tool.' : 'Connect a free OpenRouter account. No purchase is required.');
}

function basicSettingsMarkup() {
  return `<div class="settings-section"><h3>Make it yours</h3><div class="settings-row"><label for="setting-name">What should JARVIS call you?</label><input id="setting-name" type="text" maxlength="40" value="${escapeHtml(state.settings.name)}"></div><div class="settings-row"><label for="setting-search">Search engine</label><select id="setting-search"><option value="duckduckgo">DuckDuckGo</option><option value="google">Google</option><option value="bing">Bing</option></select></div><div class="settings-row"><label for="setting-motion">Core animations<small>A little cinematic atmosphere.</small></label><input id="setting-motion" type="checkbox" ${state.settings.animations ? 'checked' : ''}></div></div><div class="settings-section"><h3>Your AI companion</h3><div class="settings-row"><label for="setting-model">Free AI<small>For chat, summaries and building tools.</small></label><select id="setting-model" disabled><option value="openrouter/free">OpenRouter · Free models only</option></select></div><div class="settings-row"><label for="setting-voice">Read replies aloud<small>Uses a voice available on this computer.</small></label><input id="setting-voice" type="checkbox" ${state.settings.speak ? 'checked' : ''}></div><div class="settings-note"><strong>${state.aiReady ? 'Your AI key is connected.' : 'AI is not connected yet.'}</strong><br>${state.aiReady ? 'Messages and pages you choose to include go to OpenRouter and its selected free AI provider. Your connection is stored securely on this laptop.' : 'Click Connect free AI, sign in to OpenRouter and approve the connection. Then return to JARVIS. You do not need to buy credits or copy an API key.'}<br>Free usage limits and availability vary. JARVIS uses only free models, with no paid fallback. Browser commands and starter tools work immediately.</div><div class="settings-actions"><button class="primary" id="connect-free-ai">Connect free AI</button><button class="secondary hidden" id="cancel-connect-ai">Cancel sign-in</button><button class="secondary" id="refresh-ai">${icon('refresh')} Refresh status</button></div><p id="ai-setup-status" class="settings-note" role="status"></p></div><div class="settings-section"><div class="settings-note">Browser data, bookmarks and your conversation are saved locally on this laptop. Use New conversation to clear the current chat. Microphone transcription is unavailable with free AI. Use Windows voice typing (Win + H); spoken replies use your computer’s voice. AI replies can make mistakes.</div><button class="primary" id="save-settings">Save preferences ${icon('check')}</button></div>`;
}

function settingsMarkup() {
  const s = state.settings;
  return `<div class="settings-section"><h3>Your browser, your way</h3><div class="settings-row"><label for="setting-accent">Accent colour</label><select id="setting-accent"><option value="cyan">Arc cyan</option><option value="violet">Nebula violet</option><option value="amber">Solar amber</option><option value="green">Aurora green</option></select></div><div class="settings-row"><label for="setting-recent">Recently visited pages<small>Show your latest destinations on Home.</small></label><input id="setting-recent" type="checkbox" ${s.showRecent ? 'checked' : ''}></div><div class="settings-row"><label for="setting-popular">Common website shortcuts</label><input id="setting-popular" type="checkbox" ${s.showPopular ? 'checked' : ''}></div><div class="settings-row"><label for="setting-restore">Reopen tabs on launch</label><input id="setting-restore" type="checkbox" ${s.restoreTabs ? 'checked' : ''}></div></div>` + basicSettingsMarkup();
}

function trainingMarkup() {
  const t = state.training || {};
  const info = state.screenLearningInfo || {};
  const notes = Array.isArray(state.learning) ? state.learning.slice(0, 8) : [];
  const status = state.screenLearning ? (info.phase === 'analyzing' ? 'Capturing and asking the free AI for broad routine signals…' : info.phase === 'learned' ? 'Learning note saved locally.' : 'Live learning is active.') : info.phase === 'emergency-stopped' ? 'Emergency stop is active. No new snapshots will be taken.' : 'Screen learning is stopped.';
  const shortcut = state.emergencyShortcut ? state.emergencyShortcut.replaceAll('Control', 'Ctrl').replaceAll('Escape', 'Esc') : 'the in-app button';
  const noteMarkup = notes.length ? notes.map(note => {
    const when = Number(note.time) ? new Date(Number(note.time)).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'Recent';
    const activities = Array.isArray(note.activities) && note.activities.length ? `<small>${escapeHtml(note.activities.join(' · '))}</small>` : '';
    const context = Array.isArray(note.context) && note.context.length ? `<small class="learning-note-context">Useful context: ${escapeHtml(note.context.join(' · '))}</small>` : '';
    const sensitivity = note.sensitivity === 'sensitive_content_detected' ? '<em>Sensitive text omitted</em>' : '';
    return `<article class="learning-note"><div><strong>${escapeHtml(note.summary)}</strong>${activities}${context}</div><time>${escapeHtml(when)}</time>${sensitivity}</article>`;
  }).join('') : '<p class="learning-notes-empty">No learning notes yet. Start a session and JARVIS will show each high-level observation here.</p>';
  return `<div class="settings-section"><h3>Train my JARVIS</h3><p>Teach JARVIS your preferences in plain language. These notes stay on this laptop and guide future free AI requests.</p><label for="training-instructions">How should JARVIS behave?</label><textarea id="training-instructions" rows="6" maxlength="8000" placeholder="Be concise. Help me revise for GCSEs.">${escapeHtml(t.instructions || '')}</textarea><label for="training-examples">Examples of replies you like</label><textarea id="training-examples" rows="8" maxlength="12000" placeholder="Me: Explain photosynthesis\nJARVIS: Use a short explanation, then a simple analogy.">${escapeHtml(t.examples || '')}</textarea><div class="settings-section screen-learning"><h3>Learn from my screen</h3><p>When enabled, JARVIS captures the whole display, including other visible apps and the desktop, on a timer. The free AI keeps only broad routine signals; raw screenshots are never written to disk.</p><p id="screen-learning-status" class="settings-note">${escapeHtml(status)}</p><div class="learning-settings-meta"><span>Source <strong>Entire desktop</strong></span><span>Saved notes <strong>${notes.length}</strong></span><span>AI model <strong>${escapeHtml(info.model || 'OpenRouter free')}</strong></span></div><button class="primary" id="toggle-screen-learning">${state.screenLearning ? 'Stop learning' : 'Start learning'}</button><button class="secondary" id="emergency-stop-training">Emergency stop</button><p class="settings-note learning-kill-switch">Kill switch: click Emergency stop or press <strong>${escapeHtml(shortcut)}</strong>.</p><div class="learning-notes-heading"><strong>What JARVIS has learned</strong><button class="secondary" id="clear-learning" ${notes.length ? '' : 'disabled'}>Clear notes</button></div><div class="learning-notes" id="learning-notes">${noteMarkup}</div></div><p class="settings-note">Do not add passwords, API keys, or private information. You can pause at any time with the popup or the Emergency stop button.</p><button class="primary" id="save-training">Save training notes ${icon('check')}</button><button class="secondary" id="clear-training">Clear training</button></div>`;
}

async function showPanel(panel, toolId = null) {
  closeSuggestions();
  JarvisBuilder.dispose();
  lastFocus = document.activeElement;
  currentPanel = panel;
  await invoke('overlay', { open: true });
  $('modal-backdrop').classList.remove('hidden');
  document.querySelector('.modal').classList.toggle('builder-modal', ['builder', 'tool'].includes(panel));
  $('modal-content').classList.remove('running-tool');
  $('modal-title').textContent = { school: 'School library', bookmarks: 'Your bookmarks', history: 'Where you’ve been', downloads: 'Your downloads', guide: 'How to use JARVIS', training: 'Train my JARVIS', settings: 'Browser & AI settings', builder: 'Build a feature', tool: state.features?.find(f => f.id === toolId)?.name || 'Your tool' }[panel];
  JarvisLibrary.close();
  if (panel === 'school') { await JarvisLibrary.open($('modal-content'), { invoke }); $('modal-close').focus(); return; }
  if (panel === 'builder' || panel === 'tool') {
    await JarvisBuilder.open($('modal-content'), { invoke, getState: () => state, refreshState: async () => renderState(await invoke('state')), notify, close: closePanel, openSettings: () => showPanel('settings'), openTool: id => showPanel('tool', id), openAction: action => { closePanel(); invoke('new-tab', { url: action.type === 'search' ? searchUrl(action.value) : action.value }); } }, toolId);
    $('modal-close').focus(); return;
  }
  if (panel === 'guide') { $('modal-content').innerHTML = JarvisGuide.markup(state.aiReady); $('modal-close').focus(); return; }
  if (panel === 'training') { $('modal-content').innerHTML = trainingMarkup(); $('save-training').onclick = async () => { await invoke('training', { instructions: $('training-instructions').value, examples: $('training-examples').value }); notify('Training notes saved on this laptop.'); }; $('clear-training').onclick = async () => { await invoke('training', { instructions: '', examples: '' }); $('training-instructions').value = ''; $('training-examples').value = ''; notify('Training notes cleared.'); }; $('toggle-screen-learning').onclick = async () => { await invoke('screen-learning', { enabled: !state.screenLearning }); renderState(await invoke('state')); showPanel('training'); }; $('emergency-stop-training').onclick = async () => { await invoke('emergency-stop'); renderState(await invoke('state')); showPanel('training'); }; $('clear-learning').onclick = async () => { await invoke('clear-learning'); renderState(await invoke('state')); showPanel('training'); notify('Saved learning notes cleared.'); }; $('modal-close').focus(); return; }
  if (panel === 'settings') {
    $('modal-content').innerHTML = settingsMarkup();
    $('modal-content').insertAdjacentHTML('afterbegin', `<div class="settings-section appearance-panel"><h3>Visual control room</h3><div class="settings-row"><label for="setting-theme">Interface atmosphere<small>Choose the surface treatment for JARVIS.</small></label><select id="setting-theme"><option value="midnight">Midnight command</option><option value="glass">Frosted glass</option><option value="carbon">Carbon cockpit</option></select></div><div class="settings-row"><label for="setting-background">Background scene<small>Set the ambient world behind your workspace.</small></label><select id="setting-background"><option value="aurora">Aurora field</option><option value="deep-space">Deep space</option><option value="graphite">Graphite grid</option><option value="ocean">Ocean dusk</option><option value="plain">Pure midnight</option></select></div><div class="settings-row"><label for="setting-glow">Intelligence glow<small>Adjust the technical linework brightness.</small></label><input id="setting-glow" type="range" min="0" max="100" step="5"></div></div>`);
    $('setting-theme').value = state.settings.theme || 'midnight'; $('setting-background').value = state.settings.background || 'aurora'; $('setting-glow').value = Number(state.settings.glow ?? 55);
    $('setting-theme').onchange = () => invoke('settings', { theme: $('setting-theme').value });
    $('setting-background').onchange = () => invoke('settings', { background: $('setting-background').value });
    $('setting-glow').oninput = () => { document.documentElement.style.setProperty('--glow', String(Number($('setting-glow').value) / 100)); invoke('settings', { glow: Number($('setting-glow').value) }); };
    $('setting-search').value = state.settings.searchEngine;
    $('setting-model').value = state.settings.model;
    $('setting-accent').value = state.settings.accent || 'cyan';
    $('save-settings').onclick = async () => {
      await invoke('settings', { name: $('setting-name').value, searchEngine: $('setting-search').value, model: $('setting-model').value, speak: $('setting-voice').checked, animations: $('setting-motion').checked, accent: $('setting-accent').value, showRecent: $('setting-recent').checked, showPopular: $('setting-popular').checked, restoreTabs: $('setting-restore').checked });
      closePanel(); notify('Your preferences are saved.');
    };
    $('connect-free-ai').onclick = async () => { await invoke('connect-ai'); renderState(await invoke('state')); };
    $('cancel-connect-ai').onclick = async () => { await invoke('cancel-connect-ai'); renderState(await invoke('state')); };
    updateAISetup();
    $('refresh-ai').onclick = async () => { renderState(await invoke('state')); showPanel('settings'); notify(state.aiReady ? 'Your free AI connection is saved.' : 'Choose Connect free AI to sign in.'); };
  } else renderCollection(panel);
  $('modal-close').focus();
}
async function closePanel() { JarvisLibrary.close(); JarvisBuilder.dispose(); currentPanel = null; $('modal-backdrop').classList.add('hidden'); syncOverlay(); if (lastFocus?.isConnected) lastFocus.focus(); }

function renderCollection(panel, query = '') {
  const items = state[panel] || [];
  const type = panel === 'bookmarks' ? 'bookmark' : panel === 'downloads' ? 'download' : 'history';
  if (!items.length) {
    $('modal-content').innerHTML = `<div class="collection-empty">${icon(type)}<h3>${panel === 'bookmarks' ? 'Keep the good stuff.' : panel === 'history' ? 'A fresh start.' : 'Nothing downloading yet.'}</h3><p>${panel === 'bookmarks' ? 'Open a page and press the star in the address bar.<br>Your saved pages will appear here.' : panel === 'history' ? 'The pages you visit will appear here, saved on this computer.' : 'Files you download during this session will appear here.'}</p></div>`;
    return;
  }
  if (!$('collection-list') || $('modal-content').dataset.panel !== panel) {
    $('modal-content').dataset.panel = panel;
    $('modal-content').innerHTML = `<div class="collection-tools"><input id="collection-search" placeholder="Search ${panel}" aria-label="Search ${panel}">${panel === 'history' ? '<button id="clear-history" class="secondary">Clear history</button>' : ''}</div><div id="collection-list"></div>`;
    $('collection-search').oninput = e => renderCollection(panel, e.target.value);
    if ($('clear-history')) $('clear-history').onclick = async () => { await invoke('clear-history'); renderCollection('history'); };
  }
  const filter = (query || $('collection-search')?.value || '').toLowerCase();
  const filtered = items.filter(i => `${i.title || i.name} ${i.url || ''}`.toLowerCase().includes(filter));
  $('collection-list').innerHTML = filtered.length ? filtered.map(i => `<div class="collection-row">${icon(type)}<button class="collection-open" ${panel === 'downloads' ? `data-download="${i.id}"` : `data-url="${escapeHtml(i.url)}"`}><strong>${escapeHtml(i.title || i.name)}</strong><small>${panel === 'downloads' ? escapeHtml(i.status === 'progressing' ? `${(i.received / 1048576).toFixed(1)} MB${i.total ? ` of ${(i.total / 1048576).toFixed(1)} MB` : ''}` : i.status) : `${escapeHtml(hostname(i.url))} · ${new Date(i.time).toLocaleDateString('en-GB')}`}</small></button>${panel === 'bookmarks' ? `<button data-remove-bookmark="${i.id}" aria-label="Remove ${escapeHtml(i.title)}">${icon('close')}</button>` : icon(panel === 'downloads' ? 'folder' : 'arrow-up-right')}</div>`).join('') : '<div class="collection-empty">No matches found.</div>';
}

const sites = [
  { label: 'Google', url: 'https://google.com', svg: '<text x="12" y="19" font-size="22" text-anchor="middle" font-family="Arial" font-weight="bold" fill="#78adf3">G</text>' },
  { label: 'YouTube', url: 'https://youtube.com', svg: '<rect x="2" y="5" width="20" height="14" rx="5" fill="#eb625e"/><path d="m10 9 6 3-6 3Z" fill="#172730"/>' },
  { label: 'GitHub', url: 'https://github.com', svg: '<path d="M12 2a10 10 0 0 0-3 19.5V19c-3 .7-3-1.3-4-1.5.5-.8 1.4.8 2 1 1 .3 2-.1 2-.1 0-.8.4-1.2.4-1.2-3.3-.4-5.4-1.6-5.4-5.1 0-1.2.5-2.3 1.3-3.1-.2-.8-.2-2 .3-3 1.8 0 3.1 1.2 3.1 1.2a11 11 0 0 1 6.6 0S16.8 6 18.4 6c.6 1 .5 2.2.3 3 .8.8 1.3 1.9 1.3 3.1 0 3.5-2.1 4.7-5.4 5.1.6.5.8 1.2.8 2.2v2.1A10 10 0 0 0 12 2Z" fill="#b6c8d5"/>' },
  { label: 'Wikipedia', url: 'https://wikipedia.org', svg: '<text x="12" y="19" font-size="23" text-anchor="middle" font-family="Georgia" fill="#c7ced6">W</text>' },
  { label: 'Reddit', url: 'https://reddit.com', svg: '<circle cx="12" cy="13" r="8" fill="#ce8567"/><path d="m13 6 1-4 5 1" fill="none" stroke="#ce8567" stroke-width="1.5"/><circle cx="19" cy="3" r="1.8" fill="#ce8567"/><circle cx="9" cy="12" r="1.3" fill="#182630"/><circle cx="15" cy="12" r="1.3" fill="#182630"/><path d="M8 16q4 3 8 0" fill="none" stroke="#182630" stroke-width="1.5"/>' },
  { label: 'Spotify', url: 'https://open.spotify.com', svg: '<circle cx="12" cy="12" r="10" fill="#73bc93"/><path d="M6 9q7-2 12 1M7 12q6-2 10 1M8 15q5-1.5 8 .6" fill="none" stroke="#18332b" stroke-width="1.6" stroke-linecap="round"/>' },
];

function animateCore() {
  const canvas = $('core-canvas');
  const ctx = canvas.getContext('2d');
  const dots = [];
  for (let row = 1; row < 24; row++) {
    const theta = row / 24 * Math.PI;
    for (let col = 0; col < 46; col++) dots.push({ theta, phi: col / 46 * Math.PI * 2 });
  }
  let previous = 0;
  function frame(time) {
    canvasFrame = requestAnimationFrame(frame);
    if (document.hidden || !isHome() || time - previous < 45) return;
    previous = time;
    const rotate = state?.settings.animations !== false && !matchMedia('(prefers-reduced-motion: reduce)').matches ? time / 32000 : .5;
    ctx.clearRect(0, 0, 440, 440);
    for (const p of dots) {
      const x = Math.sin(p.theta) * Math.cos(p.phi + rotate);
      const y = Math.cos(p.theta);
      const z = Math.sin(p.theta) * Math.sin(p.phi + rotate);
      if (z < -.25) continue;
      const px = 220 + x * 172;
      const py = 220 + y * 172;
      const fade = (z + 1) / 2;
      const centerFade = Math.abs(y) < .25 && Math.abs(x) < .72 ? .12 : 1;
      ctx.fillStyle = `rgba(103,219,242,${fade * .54 * centerFade})`;
      ctx.beginPath(); ctx.arc(px, py, 1 + z * .45, 0, Math.PI * 2); ctx.fill();
    }
  }
  canvasFrame = requestAnimationFrame(frame);
}

function openFind() {
  if (isHome()) { notify('Open a website to find text on a page.'); return; }
  $('find-bar').classList.remove('hidden'); updateBounds(); $('find-input').focus();
}
function closeFind() { $('find-bar').classList.add('hidden'); $('find-input').value = ''; invoke('find', { text: '' }); updateBounds(); }

document.querySelector('.home').append(document.querySelector('.core-scene'));
renderIcons();
$('quick-links').innerHTML = sites.map(s => `<button class="quick-link" data-quick-url="${s.url}"><span class="site-icon"><svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">${s.svg}</svg></span><span>${s.label}</span></button>`).join('');
document.addEventListener('click', async event => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.dataset.runCommand) await sendMessage(button.dataset.runCommand);
  if (button.dataset.guideAction === 'browse') { await closePanel(); await invoke('navigate', { url: 'jarvis://home' }); $('home-query').focus(); }
  if (button.dataset.guideAction === 'notes') { await showPanel('builder'); $('modal-content').querySelector('[data-starter="notes"]').click(); }
  if (button.dataset.command) invoke(button.dataset.command);
  if (button.hasAttribute('data-emergency-stop')) { await invoke('emergency-stop'); notify('Emergency stop active. Screen learning and AI activity have stopped.'); }
  if (button.dataset.tab) { closeFind(); invoke('switch-tab', { id: button.dataset.tab }); }
  if (button.dataset.closeTab) invoke('close-tab', { id: button.dataset.closeTab });
  if (button.dataset.panel) showPanel(button.dataset.panel);
  if (button.dataset.toolId) showPanel('tool', button.dataset.toolId);
  if (button.dataset.suggestion !== undefined) chooseSuggestion(Number(button.dataset.suggestion));
  if (button.dataset.recentUrl) { closeSuggestions(); invoke('navigate', { url: button.dataset.recentUrl }); }
  if (button.dataset.quickUrl) invoke('navigate', { url: button.dataset.quickUrl });
  if (button.dataset.prompt) { await showAssistant(); $('chat-input').value = button.dataset.prompt; $('chat-input').focus(); }
  if (button.dataset.url) { closePanel(); invoke('new-tab', { url: button.dataset.url }); }
  if (button.dataset.download) invoke('show-download', { id: button.dataset.download });
  if (button.dataset.removeBookmark) { await invoke('remove-bookmark', { id: button.dataset.removeBookmark }); renderCollection('bookmarks'); }
  if (button.hasAttribute('data-connect-ai')) showPanel('settings');
  if (button.dataset.chatAction) {
    const [m, a] = button.dataset.chatAction.split(':').map(Number);
    const action = chat[m]?.actions?.[a];
    if (action) invoke('new-tab', { url: action.type === 'search' ? searchUrl(action.value) : action.value });
  }
});
document.addEventListener('jarvis-learning-review', () => showPanel('training'));
document.addEventListener('jarvis-learning-connect', () => showPanel('settings'));
document.addEventListener('jarvis-learning-stop', async () => {
  await invoke('screen-learning', { enabled: false });
  renderState(await invoke('state'));
  notify('Live learning paused. No new screen observations will be collected.');
});
$('new-tab').onclick = () => invoke('new-tab');
$('address-form').onsubmit = event => { event.preventDefault(); const value = $('address').value; closeSuggestions(); $('address').blur(); closeFind(); invoke('navigate', { url: value }); };
$('address').onfocus = () => { $('address').select(); showSuggestions('address', true); };
$('address').oninput = () => showSuggestions('address');
$('address').onkeydown = event => suggestionKeys(event, 'address');
$('home-query').onfocus = () => showSuggestions('home-query');
$('home-query').oninput = () => showSuggestions('home-query');
$('home-query').onkeydown = event => suggestionKeys(event, 'home-query');
$('home-search').onsubmit = event => { event.preventDefault(); const value = $('home-query').value.trim(); closeSuggestions(); $('home-query').blur(); if (value) { invoke('navigate', { url: value }); $('home-query').value = ''; } };
document.addEventListener('pointerdown', event => { if (!event.target.closest('.address-form,.home-search-wrap')) closeSuggestions(); });
document.addEventListener('focusin', event => { if (suggestionInput && !event.target.closest('.address-form,.home-search-wrap')) closeSuggestions(); });
$('back').onclick = () => invoke('back'); $('forward').onclick = () => invoke('forward');
$('reload').onclick = () => invoke(activeTab()?.loading ? 'stop' : 'reload');
$('bookmark-page').onclick = async () => { const result = await invoke('bookmark'); if (!result?.error) notify(result?.saved ? 'Saved to your bookmarks.' : 'Bookmark removed.'); };
$('home-button').onclick = () => { closeFind(); invoke('navigate', { url: 'jarvis://home' }); };
$('assistant-toggle').onclick = () => invoke('settings', { assistantOpen: !state.settings.assistantOpen });
$('companion-toggle').onclick = () => showAssistant();
$('ask-from-home').onclick = () => showAssistant();
$('summarize-home').onclick = summarize;
$('connection-status').onclick = () => showPanel('settings');
$('attach-page').onclick = () => setAttached(!attached);
$('speak-toggle').onclick = async () => { if (state.settings.speak) speechSynthesis.cancel(); await invoke('settings', { speak: !state.settings.speak }); };
$('chat-form').onsubmit = event => { event.preventDefault(); pending ? invoke('cancel-ai') : sendMessage(); };
$('chat-input').onkeydown = event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); if (!pending) sendMessage(); } };
$('voice-button').onclick = toggleVoice;
$('clear-chat').onclick = async () => { if (pending) { notify('Stop the current reply before starting a new conversation.'); return; } await invoke('clear-chat'); chat = []; speechSynthesis.cancel(); setAttached(false); renderChat(); $('chat-input').focus(); notify('New conversation started. Your previous saved messages were cleared.'); };
$('modal-close').onclick = closePanel;
$('modal-backdrop').onclick = event => { if (event.target === $('modal-backdrop')) closePanel(); };
$('retry-page').onclick = () => invoke('reload'); $('error-home').onclick = () => invoke('navigate', { url: 'jarvis://home' });
$('find-input').oninput = () => invoke('find', { text: $('find-input').value });
$('find-input').onkeydown = event => { if (event.key === 'Enter') invoke('find', { text: $('find-input').value, next: true, forward: !event.shiftKey }); };
$('find-next').onclick = () => invoke('find', { text: $('find-input').value, next: true });
$('find-prev').onclick = () => invoke('find', { text: $('find-input').value, next: true, forward: false });
$('find-close').onclick = closeFind;
document.addEventListener('keydown', event => {
  if (event.ctrlKey && event.shiftKey && event.key === 'Escape') { event.preventDefault(); invoke('emergency-stop'); notify('Emergency stop active. Screen learning and AI activity have stopped.'); }
  if (currentPanel && event.key === 'Tab') {
    const elements = [...document.querySelector('.modal').querySelectorAll('button,input,select,textarea,iframe,a[href]')].filter(e => !e.disabled && e.getClientRects().length);
    if (event.shiftKey && document.activeElement === elements[0]) { event.preventDefault(); elements.at(-1).focus(); }
    else if (!event.shiftKey && document.activeElement === elements.at(-1)) { event.preventDefault(); elements[0].focus(); }
  }
});
api.onEvent(({ event, payload }) => {
  if (event === 'library-update') JarvisLibrary.update(payload);
  if (event === 'state') renderState(payload);
  if (event === 'screen-learning-update' && payload && typeof payload === 'object') {
    state = state ? { ...state, screenLearning: Boolean(payload.active), screenLearningInfo: payload, learning: Array.isArray(payload.events) ? payload.events : state.learning } : state;
    if (window.JarvisLearningHud && state) JarvisLearningHud.render({ ...state, screenLearningInfo: payload });
    const liveStatus = $('screen-learning-status');
    if (liveStatus) liveStatus.textContent = payload.message || (payload.active ? 'Live learning is active.' : 'Screen learning is stopped.');
  }
  if (event === 'open-panel') showPanel(payload);
  if (event === 'notice') notify(payload);
  if (event === 'find-result') $('find-count').textContent = `${payload.active}/${payload.matches}`;
  if (event === 'shortcut') {
    if (payload === 'l') { $('address').focus(); $('address').select(); }
    if (payload === 'k') showAssistant();
    if (payload === 'h') showPanel('history');
    if (payload === ',') showPanel('settings');
    if (payload === 'f') openFind();
    if (payload === 'escape') { if (suggestionInput) closeSuggestions(); else currentPanel ? closePanel() : closeFind(); speechSynthesis.cancel(); }
  }
});
new ResizeObserver(updateBounds).observe($('main-content'));
window.addEventListener('beforeunload', () => { cancelAnimationFrame(canvasFrame); recordingStream?.getTracks().forEach(t => t.stop()); speechSynthesis.cancel(); });
chatMemoryPromise = invoke('state').then(async initial => { renderState(initial); await loadChatMemory(); });
window.setTimeout(() => document.getElementById('boot-splash')?.remove(), 3100);
updateClock(); setInterval(updateClock, 60000);
// The quiet home background replaces the animated reactor.
