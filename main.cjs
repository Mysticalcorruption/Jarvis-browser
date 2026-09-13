const { app, BrowserWindow, WebContentsView, ipcMain, protocol, net, session, Menu, dialog, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { randomUUID } = require('node:crypto');
const { resolveAddress, isWebUrl, SEARCH_ENGINES } = require('./core.cjs');
const { askAssistant, transcribe } = require('./assistant.cjs');
const { buildSuggestions } = require('./suggestions.cjs');
const { validateFeature, buildFeature, starters } = require('./features.cjs');

const startupLogPath = process.env.JARVIS_STARTUP_LOG || path.join(require('node:os').tmpdir(), 'jarvis-startup.log');
function startupLog(message) {
  try { fs.appendFileSync(startupLogPath, `${new Date().toISOString()} ${message}\n`); } catch { /* Diagnostics must never affect launch. */ }
}
process.on('uncaughtException', error => { startupLog(`uncaughtException: ${error?.stack || error}`); });
process.on('unhandledRejection', error => { startupLog(`unhandledRejection: ${error?.stack || error}`); });

const UI_ORIGIN = 'jarvis-ui://app';
const HOME = 'jarvis://home';
const testing = process.env.JARVIS_TEST === '1';
app.setName('JARVIS');
app.setAppUserModelId('Personal.Jarvis.Browser');
startupLog(`boot packaged=${app.isPackaged} exe=${process.execPath}`);
if (process.env.JARVIS_PROFILE) app.setPath('userData', process.env.JARVIS_PROFILE);
else if (!app.isPackaged) app.setPath('userData', path.join(__dirname, '..', '.jarvis-profile'));
const primaryInstance = app.requestSingleInstanceLock();
if (!primaryInstance) app.quit();
protocol.registerSchemesAsPrivileged([{ scheme: 'jarvis-ui', privileges: { standard: true, secure: true, supportFetchAPI: true } }, { scheme: 'jarvis-tool', privileges: { standard: true, secure: true } }]);

let win, tabs = [], activeId, attachedView, pageBounds, overlay = false, persistTimer, aiController, featureController;
let quitting = false;
let voiceArmedUntil = 0, chosenEnvPath = null;
const storePath = path.join(app.getPath('userData'), 'browser.json');
const defaults = { name: 'Max', searchEngine: 'duckduckgo', speak: false, animations: true, model: 'gpt-5-mini', assistantOpen: true, accent: 'cyan', showRecent: true, showPopular: true, restoreTabs: true };
let data = { settings: { ...defaults }, bookmarks: [], history: [], savedTabs: [], features: [], featureData: {} };
const downloads = [];
const featurePreviews = new Map();

function readData() {
  try {
    const saved = JSON.parse(fs.readFileSync(storePath, 'utf8'));
    data.settings = { ...defaults, ...saved.settings };
    data.bookmarks = Array.isArray(saved.bookmarks) ? saved.bookmarks.filter(b => b && isWebUrl(b.url)).slice(0, 200) : [];
    data.history = Array.isArray(saved.history) ? saved.history.filter(b => b && isWebUrl(b.url)).slice(0, 500) : [];
    data.savedTabs = Array.isArray(saved.savedTabs) ? saved.savedTabs.filter(isWebUrl).slice(0, 20) : [];
    data.features = Array.isArray(saved.features) ? saved.features.slice(0, 20).flatMap(feature => {
      try { return [{ ...validateFeature(feature), id: String(feature.id), updatedAt: feature.updatedAt || Date.now(), revisions: Array.isArray(feature.revisions) ? feature.revisions.slice(0, 3).map(validateFeature) : [] }]; } catch { return []; }
    }) : [];
    data.featureData = saved.featureData && typeof saved.featureData === 'object' && !Array.isArray(saved.featureData) ? saved.featureData : {};
  } catch { /* A first launch starts with a fresh profile. */ }
}

function persistNow() {
  try {
    fs.mkdirSync(path.dirname(storePath), { recursive: true });
    const saved = { ...data, savedTabs: tabs.filter(t => isWebUrl(t.url)).map(t => t.url) };
    fs.writeFileSync(storePath + '.tmp', JSON.stringify(saved, null, 2));
    fs.renameSync(storePath + '.tmp', storePath);
  } catch { send('notice', 'Your profile could not be saved. Check available disk space.'); }
}
function persist() { clearTimeout(persistTimer); persistTimer = setTimeout(persistNow, 250); }

function credentials() {
  let key = process.env.OPENAI_API_KEY || '';
  let model = process.env.OPENAI_MODEL || data.settings.model;
  const candidates = [chosenEnvPath, path.join(app.getAppPath(), '.env.local'), path.join(app.getPath('userData'), '.env.local')].filter(Boolean);
  for (const target of candidates) {
    try {
      const raw = fs.readFileSync(target, 'utf8');
      for (const line of raw.split(/\r?\n/)) {
        const match = line.match(/^\s*(OPENAI_API_KEY|OPENAI_MODEL)\s*=\s*(.*?)\s*$/);
        if (!match) continue;
        const value = match[2].replace(/^['"]|['"]$/g, '');
        if (match[1] === 'OPENAI_API_KEY' && value) key = value;
        if (match[1] === 'OPENAI_MODEL' && value) model = value;
      }
    } catch { /* Missing optional configuration is normal. */ }
  }
  return { key, model };
}

function send(event, payload) {
  if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send('jarvis:event', { event, payload });
}
function activeTab() { return tabs.find(t => t.id === activeId); }
function state() {
  return {
    tabs: tabs.map(t => ({ id: t.id, title: t.title, url: t.url, loading: t.loading, error: t.error,
      canGoBack: t.view.webContents.navigationHistory.canGoBack(), canGoForward: t.view.webContents.navigationHistory.canGoForward() })),
    activeId, bookmarks: data.bookmarks, history: data.history, downloads, features: data.features,
    settings: data.settings, aiReady: Boolean(credentials().key), maximized: Boolean(win?.isMaximized()),
  };
}
function broadcast() { if (!quitting) send('state', state()); }

function layout() {
  if (!win || win.isDestroyed()) return;
  const tab = activeTab();
  const view = tab?.url !== HOME ? tab?.view : null;
  if (attachedView && attachedView !== view) { win.contentView.removeChildView(attachedView); attachedView = null; }
  if (view && view !== attachedView) { win.contentView.addChildView(view); attachedView = view; }
  if (!view) return;
  const [width, height] = win.getContentSize();
  const bounds = pageBounds || { x: 212, y: 100, width: width - 552, height: height - 128 };
  const x = Math.max(0, Math.min(width - 1, bounds.x));
  const y = Math.max(0, Math.min(height - 1, bounds.y));
  view.setBounds({ x, y, width: Math.max(1, Math.min(bounds.width, width - x)), height: Math.max(1, Math.min(bounds.height, height - y)) });
  view.setVisible(!overlay && !tab.error);
}

function keyboard(contents) {
  contents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const key = input.key.toLowerCase();
    const ctrl = input.control || input.meta;
    if (ctrl && ['l', 't', 'w', 'k', 'd', 'h', 'f', 'r', ','].includes(key)) {
      event.preventDefault();
      if (key === 't') createTab();
      else if (key === 'w') closeTab(activeId);
      else if (key === 'r') activeTab()?.view.webContents.reload();
      else if (key === 'd') toggleBookmark();
      else { win.webContents.focus(); send('shortcut', key); }
    } else if (input.alt && ['arrowleft', 'arrowright'].includes(key)) {
      event.preventDefault(); navigateHistory(key === 'arrowleft' ? 'back' : 'forward');
    } else if (key === 'f5') { event.preventDefault(); activeTab()?.view.webContents.reload(); }
    else if (key === 'f11') { event.preventDefault(); win.setFullScreen(!win.isFullScreen()); }
    else if (key === 'escape') { send('shortcut', 'escape'); }
  });
}

function createTab(address = HOME, foreground = true) {
  if (tabs.length >= 40) { send('notice', 'You have 40 open tabs. Close a tab to open another.'); return null; }
  const url = resolveAddress(address, data.settings.searchEngine);
  const view = new WebContentsView({ webPreferences: {
    partition: 'persist:jarvis-pages', nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true,
    allowRunningInsecureContent: false, navigateOnDragDrop: false,
  } });
  view.setBackgroundColor('#101720');
  const tab = { id: randomUUID(), title: url === HOME ? 'Home' : new URL(url).hostname, url, view, loading: false, error: null };
  tabs.push(tab);
  const wc = view.webContents;
  keyboard(wc);
  wc.setWindowOpenHandler(({ url: target, disposition }) => {
    if (isWebUrl(target)) createTab(target, disposition !== 'background-tab');
    return { action: 'deny' };
  });
  const blockUnsafe = (event, target) => { if (!isWebUrl(target)) event.preventDefault(); };
  wc.on('will-navigate', blockUnsafe);
  wc.on('will-redirect', blockUnsafe);
  wc.on('will-frame-navigate', event => { if (!isWebUrl(event.url) && event.url !== 'about:blank') event.preventDefault(); });
  wc.on('page-title-updated', (_event, title) => { tab.title = String(title).slice(0, 200); broadcast(); });
  wc.on('did-start-loading', () => { tab.loading = true; tab.error = null; broadcast(); layout(); });
  wc.on('did-stop-loading', () => { tab.loading = false; broadcast(); });
  const navigated = (_event, target) => {
    if (!isWebUrl(target)) return;
    tab.url = target; tab.error = null;
    const previousVisit = data.history.find(h => h.url === target);
    data.history = [{ id: previousVisit?.id || randomUUID(), url: target, title: wc.getTitle() || new URL(target).hostname, time: Date.now(), visits: (previousVisit?.visits || 0) + 1 }, ...data.history.filter(h => h.url !== target)].slice(0, 500);
    persist(); layout(); broadcast();
  };
  wc.on('did-navigate', navigated);
  wc.on('did-navigate-in-page', (event, target, mainFrame) => { if (mainFrame) navigated(event, target); });
  wc.on('did-finish-load', () => {
    const entry = data.history.find(h => h.url === tab.url);
    if (entry) { entry.title = tab.title; persist(); }
    broadcast();
  });
  wc.on('did-fail-load', (_event, code, description, _url, isMainFrame) => {
    if (isMainFrame && code !== -3) { tab.error = `This page couldn't be reached (${description}). Check the address or try again.`; tab.loading = false; layout(); broadcast(); }
  });
  wc.on('render-process-gone', () => { tab.error = 'This tab stopped responding. Reload to recover it.'; tab.loading = false; layout(); broadcast(); });
  wc.on('found-in-page', (_event, result) => send('find-result', { matches: result.matches, active: result.activeMatchOrdinal }));
  wc.on('context-menu', (_event, params) => {
    const template = [];
    if (isWebUrl(params.linkURL)) template.push({ label: 'Open link in new tab', click: () => createTab(params.linkURL) });
    if (params.selectionText) template.push({ role: 'copy' }, { label: 'Search for selection', click: () => createTab(SEARCH_ENGINES[data.settings.searchEngine] + encodeURIComponent(params.selectionText.slice(0, 2000))) });
    if (params.isEditable) template.push({ role: 'cut' }, { role: 'paste' }, { role: 'selectAll' });
    if (!template.length) template.push({ label: 'Back', enabled: wc.navigationHistory.canGoBack(), click: () => wc.navigationHistory.goBack() }, { label: 'Reload', click: () => wc.reload() });
    Menu.buildFromTemplate(template).popup({ window: win });
  });
  if (foreground) activeId = tab.id;
  if (url !== HOME) wc.loadURL(url).catch(() => {});
  layout(); broadcast(); persist();
  return tab.id;
}

function closeTab(id) {
  const index = tabs.findIndex(t => t.id === id);
  if (index < 0) return;
  const [tab] = tabs.splice(index, 1);
  if (attachedView === tab.view) { win.contentView.removeChildView(attachedView); attachedView = null; }
  tab.view.webContents.close();
  if (activeId === id) activeId = tabs[Math.min(index, tabs.length - 1)]?.id;
  if (!tabs.length) createTab();
  layout(); broadcast(); persist();
}

function navigate(address) {
  const url = resolveAddress(address, data.settings.searchEngine);
  const tab = activeTab();
  if (!tab) return createTab(url);
  tab.url = url; tab.error = null;
  if (url === HOME) { tab.title = 'Home'; tab.loading = false; tab.view.webContents.stop(); }
  else tab.view.webContents.loadURL(url).catch(() => {});
  layout(); broadcast(); persist();
}
function navigateHistory(direction) {
  const h = activeTab()?.view.webContents.navigationHistory;
  if (direction === 'back' && h?.canGoBack()) h.goBack();
  if (direction === 'forward' && h?.canGoForward()) h.goForward();
}
function toggleBookmark() {
  const tab = activeTab();
  if (!tab || !isWebUrl(tab.url)) return { error: 'Open a website to bookmark it.' };
  const exists = data.bookmarks.some(b => b.url === tab.url);
  if (exists) data.bookmarks = data.bookmarks.filter(b => b.url !== tab.url);
  else data.bookmarks.unshift({ id: randomUUID(), title: tab.title, url: tab.url, time: Date.now() });
  persist(); broadcast(); return { saved: !exists };
}

async function readPage() {
  const tab = activeTab();
  if (!tab || !isWebUrl(tab.url) || tab.error) return null;
  try {
    const text = await tab.view.webContents.executeJavaScript(`(() => {
      const source = document.querySelector('article') || document.querySelector('main') || document.body;
      if (!source) return '';
      const copy = source.cloneNode(true);
      copy.querySelectorAll('script,style,noscript,input,textarea,select,button,[contenteditable],nav,footer,header,[hidden],[aria-hidden="true"]').forEach(n => n.remove());
      return (copy.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 18000);
    })()`);
    return { url: tab.url, title: tab.title, text };
  } catch { return null; }
}

function setupPermissions(browserSession) {
  browserSession.setPermissionCheckHandler((wc, permission) => wc === win?.webContents && permission === 'media' && Date.now() < voiceArmedUntil);
  browserSession.setPermissionRequestHandler(async (wc, permission, callback, details) => {
    if (wc === win?.webContents) return callback(permission === 'media' && Date.now() < voiceArmedUntil && !(details.mediaTypes || []).includes('video'));
    if (!wc || !tabs.some(t => t.view.webContents === wc) || !['media', 'geolocation', 'notifications', 'fullscreen'].includes(permission)) return callback(false);
    if (testing) return callback(false);
    const origin = (() => { try { return new URL(details.requestingUrl || wc.getURL()).origin; } catch { return 'This website'; } })();
    const { response } = await dialog.showMessageBox(win, { type: 'question', title: 'Website permission', message: `${origin} wants to use ${permission === 'media' ? 'your microphone or camera' : permission}.`, buttons: ['Block', 'Allow once'], defaultId: 0, cancelId: 0 });
    callback(response === 1);
  });
  browserSession.on('will-download', (_event, item) => {
    const entry = { id: randomUUID(), name: item.getFilename(), received: 0, total: item.getTotalBytes(), status: 'progressing' };
    downloads.unshift(entry); broadcast();
    item.on('updated', (_event, status) => { entry.status = status; entry.received = item.getReceivedBytes(); entry.total = item.getTotalBytes(); broadcast(); });
    item.once('done', (_event, status) => { entry.status = status; entry.path = item.getSavePath(); broadcast(); send('notice', status === 'completed' ? `Downloaded ${entry.name}` : `Download ${status}: ${entry.name}`); });
  });
}

function ensureStartMenuShortcut() {
  if (process.platform !== 'win32' || testing || !app.isPackaged) return;
  try {
    const startMenu = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs');
    fs.mkdirSync(startMenu, { recursive: true });
    const shortcut = path.join(startMenu, 'JARVIS.lnk');
    shell.writeShortcutLink(shortcut, 'create', {
      target: process.execPath,
      args: '',
      cwd: path.dirname(process.execPath),
      description: 'JARVIS — your personal browser',
      icon: process.execPath,
      iconIndex: 0,
      appUserModelId: 'Personal.Jarvis.Browser',
    });
  } catch { /* The app remains launchable from its executable if Windows blocks shortcut creation. */ }
}

function registerIpc() {
  ipcMain.handle('jarvis:invoke', async (event, command, payload = {}) => {
    if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame || event.senderFrame.url !== `${UI_ORIGIN}/index.html`) throw new Error('Untrusted request');
    if (!payload || typeof payload !== 'object') throw new Error('Invalid request');
    try {
      switch (command) {
        case 'state': return state();
        case 'suggestions': return buildSuggestions(payload.query, data);
        case 'new-tab': return createTab(typeof payload.url === 'string' ? payload.url : HOME);
        case 'switch-tab': if (tabs.some(t => t.id === payload.id)) { activeId = payload.id; layout(); broadcast(); } return;
        case 'close-tab': return closeTab(payload.id);
        case 'navigate': return navigate(payload.url);
        case 'back': case 'forward': return navigateHistory(command);
        case 'reload': if (activeTab()?.url !== HOME) activeTab()?.view.webContents.reload(); return;
        case 'stop': activeTab()?.view.webContents.stop(); return;
        case 'bookmark': return toggleBookmark();
        case 'remove-bookmark': data.bookmarks = data.bookmarks.filter(b => b.id !== payload.id); persist(); broadcast(); return;
        case 'clear-history': data.history = []; persist(); broadcast(); return;
        case 'bounds': {
          if (['x', 'y', 'width', 'height'].every(k => Number.isFinite(payload[k]))) {
            pageBounds = Object.fromEntries(['x', 'y', 'width', 'height'].map(k => [k, Math.round(payload[k])])); layout();
          } return;
        }
        case 'overlay': overlay = Boolean(payload.open); layout(); return;
        case 'minimize': win.minimize(); return;
        case 'maximize': win.isMaximized() ? win.unmaximize() : win.maximize(); return;
        case 'close-window': win.close(); return;
        case 'find': {
          const wc = activeTab()?.view.webContents;
          if (payload.text && typeof payload.text === 'string') wc?.findInPage(payload.text.slice(0, 300), { forward: payload.forward !== false, findNext: Boolean(payload.next) });
          else wc?.stopFindInPage('clearSelection');
          return;
        }
        case 'settings': {
          if (typeof payload.name === 'string') data.settings.name = payload.name.trim().slice(0, 40) || 'Commander';
          if (Object.hasOwn(SEARCH_ENGINES, payload.searchEngine)) data.settings.searchEngine = payload.searchEngine;
          for (const key of ['speak', 'animations', 'assistantOpen', 'showRecent', 'showPopular', 'restoreTabs']) if (typeof payload[key] === 'boolean') data.settings[key] = payload[key];
          if (['cyan', 'violet', 'amber', 'green'].includes(payload.accent)) data.settings.accent = payload.accent;
          if (['gpt-5-mini', 'gpt-5'].includes(payload.model)) data.settings.model = payload.model;
          persist(); broadcast(); return state();
        }
        case 'connect-ai': {
          const result = await dialog.showOpenDialog(win, { title: 'Choose your OpenAI environment file', properties: ['openFile', 'showHiddenFiles'], filters: [{ name: 'Environment files', extensions: ['local', 'env', 'txt'] }, { name: 'All files', extensions: ['*'] }] });
          if (result.canceled) return { canceled: true };
          const candidate = result.filePaths[0];
          if (fs.statSync(candidate).size > 65536) return { error: 'Choose a small environment file containing OPENAI_API_KEY.' };
          chosenEnvPath = candidate;
          const ready = Boolean(credentials().key); broadcast();
          return ready ? { connected: true } : { error: 'No OPENAI_API_KEY was found in that file.' };
        }
        case 'page': return await readPage();
        case 'ask': {
          if (aiController) return { error: 'Please wait for the current reply or stop it first.' };
          if (!Array.isArray(payload.messages) || !payload.messages.length) return { error: 'Enter a message first.' };
          aiController = new AbortController();
          const timeout = setTimeout(() => aiController?.abort(), 60000);
          try { return await askAssistant({ ...credentials(), messages: payload.messages, page: payload.attachPage ? await readPage() : null, signal: aiController.signal }); }
          finally { clearTimeout(timeout); aiController = null; }
        }
        case 'cancel-ai': aiController?.abort(); return;
        case 'feature-starter': return starters[payload.name] ? { feature: validateFeature(starters[payload.name]) } : { error: 'Unknown starter tool.' };
        case 'preview-feature': {
          if (typeof payload.document !== 'string' || payload.document.length > 180000) return { error: 'This preview is too large.' };
          const token = randomUUID();
          featurePreviews.set(token, payload.document);
          while (featurePreviews.size > 4) featurePreviews.delete(featurePreviews.keys().next().value);
          return { url: `jarvis-tool://preview/${token}` };
        }
        case 'build-feature': {
          if (featureController) return { error: 'A feature is already being built. Wait or cancel it first.' };
          if (typeof payload.prompt !== 'string' || payload.prompt.trim().length < 5 || payload.prompt.length > 8000) return { error: 'Describe the feature in 5 to 8,000 characters.' };
          featureController = new AbortController();
          const timeout = setTimeout(() => featureController?.abort(), 120000);
          try { return await buildFeature({ ...credentials(), prompt: payload.prompt, previous: data.features.find(f => f.id === payload.id), signal: featureController.signal }); }
          finally { clearTimeout(timeout); featureController = null; }
        }
        case 'cancel-feature': featureController?.abort(); return;
        case 'install-feature': {
          const feature = validateFeature(payload.feature);
          const existing = data.features.find(f => f.id === payload.id);
          if (!existing && data.features.length >= 20) return { error: 'You can install up to 20 tools. Remove one before adding another.' };
          const record = { ...feature, id: existing?.id || randomUUID(), updatedAt: Date.now(), revisions: existing ? [validateFeature(existing), ...existing.revisions].slice(0, 3) : [] };
          data.features = [record, ...data.features.filter(f => f.id !== record.id)];
          persist(); broadcast(); return { id: record.id };
        }
        case 'remove-feature': data.features = data.features.filter(f => f.id !== payload.id); delete data.featureData[payload.id]; persist(); broadcast(); return;
        case 'rollback-feature': {
          const feature = data.features.find(f => f.id === payload.id);
          if (!feature?.revisions.length) return { error: 'There is no earlier version to restore.' };
          const [previous, ...revisions] = feature.revisions;
          Object.assign(feature, validateFeature(previous), { revisions, updatedAt: Date.now() });
          persist(); broadcast(); return { restored: true };
        }
        case 'feature-data': return data.features.some(f => f.id === payload.id) ? data.featureData[payload.id] ?? null : null;
        case 'save-feature-data': {
          if (!data.features.some(f => f.id === payload.id)) return { error: 'Install the tool before saving data.' };
          const serialized = JSON.stringify(payload.value ?? null);
          if (Buffer.byteLength(serialized, 'utf8') > 20000) return { error: 'This tool has reached its 20 KB storage limit.' };
          data.featureData[payload.id] = JSON.parse(serialized); persist(); return { saved: true };
        }
        case 'voice-arm': voiceArmedUntil = Date.now() + 10000; return { ready: Boolean(credentials().key) };
        case 'transcribe': return await transcribe({ ...credentials(), audio: payload.audio });
        case 'show-download': {
          const download = downloads.find(d => d.id === payload.id && d.status === 'completed');
          if (download?.path) shell.showItemInFolder(download.path); return;
        }
        default: throw new Error('Unknown browser command');
      }
    } catch (error) {
      if (error.name === 'AbortError' || error.name === 'TimeoutError') return { error: 'Reply stopped. You can try again when you are ready.' };
      if (error instanceof TypeError && command === 'ask') return { error: 'Could not reach OpenAI. Check your internet connection and try again.' };
      return { error: ['navigate', 'new-tab'].includes(command) ? error.message : 'That action could not be completed. Please try again.' };
    }
  });
}

app.on('second-instance', () => { if (win && !win.isDestroyed()) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } });
if (primaryInstance) app.whenReady().then(async () => {
  startupLog('app ready');
  readData();
  protocol.handle('jarvis-ui', request => {
    const url = new URL(request.url);
    const allowed = ['/index.html', '/styles.css', '/renderer.js', '/icons.js', '/builder.js'];
    if (url.host !== 'app' || !allowed.includes(url.pathname)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(path.join(__dirname, 'ui', url.pathname.slice(1))).href);
  });
  protocol.handle('jarvis-tool', request => {
    const url = new URL(request.url);
    const content = url.host === 'preview' ? featurePreviews.get(url.pathname.slice(1)) : null;
    if (!content) return new Response('Preview expired. Open the tool again.', { status: 404 });
    return new Response(content, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; media-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'" } });
  });
  win = new BrowserWindow({ width: 1440, height: 930, minWidth: 1024, minHeight: 680, title: 'JARVIS — Your personal browser',
    frame: false, show: false, backgroundColor: '#080e14', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, navigateOnDragDrop: false },
  });
  startupLog('window created');
  Menu.setApplicationMenu(null);
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  keyboard(win.webContents);
  setupPermissions(session.defaultSession);
  setupPermissions(session.fromPartition('persist:jarvis-pages'));
  registerIpc();
  ensureStartMenuShortcut();
  win.on('resize', layout);
  win.on('maximize', broadcast); win.on('unmaximize', broadcast);
  win.on('close', () => { quitting = true; clearTimeout(persistTimer); persistNow(); aiController?.abort(); featureController?.abort(); for (const tab of tabs) { if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close(); } });
  win.on('closed', () => { win = null; });
  const restore = [...data.savedTabs];
  createTab();
  if (data.settings.restoreTabs) for (const url of restore) createTab(url, false);
  await win.loadURL(`${UI_ORIGIN}/index.html`);
  startupLog('ui loaded');
  win.show();
  startupLog('window shown');
});
app.on('window-all-closed', () => app.quit());
