const { app, BrowserWindow, WebContentsView, ipcMain, protocol, session, Menu, dialog, shell, safeStorage, desktopCapturer, globalShortcut } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const { randomUUID } = require('node:crypto');
const { resolveAddress, isWebUrl, SEARCH_ENGINES } = require('./core.cjs');
const { askAssistant, transcribe } = require('./assistant.cjs');
const { buildSuggestions } = require('./suggestions.cjs');
const { validateFeature, buildFeature, starters } = require('./features.cjs');
const { FREE_MODEL } = require('./free-ai.cjs');
const { readFreeCredentials } = require('./ai-credentials.cjs');
const { createOpenRouterAuth } = require('./openrouter-auth.cjs');
const { analyseScreen, cleanText } = require('./screen-learning.cjs');
const { normaliseChat, MAX_MESSAGES } = require('./chat-memory.cjs');
const { createSchoolLibrary } = require('./school-library.cjs');
const schoolLibrary = createSchoolLibrary({ getWindow: () => win, dialog, shell, getData: () => data, persist: () => persist(), credentials: () => credentials(), send: (event, value) => send(event, value) });

const startupLogPath = process.env.JARVIS_STARTUP_LOG;
function startupLog(message) {
  if (!startupLogPath) return;
  try { fs.appendFileSync(startupLogPath, `${new Date().toISOString()} ${message}\n`); } catch { /* Diagnostics must never affect launch. */ }
}

const HOME = 'jarvis://home';
const testing = process.env.JARVIS_TEST === '1';
app.setName('JARVIS');
app.setAppUserModelId('Personal.Jarvis.Browser');
startupLog(`boot packaged=${app.isPackaged} exe=${process.execPath}`);
if (process.env.JARVIS_PROFILE) app.setPath('userData', process.env.JARVIS_PROFILE);
else if (!app.isPackaged) app.setPath('userData', path.join(__dirname, '..', '.jarvis-profile'));
const primaryInstance = app.requestSingleInstanceLock();
startupLog(`single instance primary=${primaryInstance}`);
if (!primaryInstance) app.quit();
protocol.registerSchemesAsPrivileged([{ scheme: 'jarvis-tool', privileges: { standard: true, secure: true } }]);

let win, tabs = [], activeId, attachedView, pageBounds, overlay = false, persistTimer, aiController, featureController;
let quitting = false;
let screenLearning = false;
let screenLearningTimer = null;
let screenLearningInFlight = false;
let screenLearningController = null;
let screenLearningSession = 0;
let emergencyShortcut = '';
let screenLearningInfo = {
  active: false,
  phase: 'stopped',
  source: 'Entire desktop',
  capturedAt: null,
  captures: 0,
  intervalMs: 30000,
  lastError: '',
  preview: null,
  previewWidth: 0,
  previewHeight: 0,
  summary: '',
  activities: [],
  context: [],
  confidence: 'medium',
  model: '',
  sensitivity: 'clear',
  savedCount: 0,
  events: [],
  captureKind: 'screen',
  displayCount: 0,
  privacy: 'Snapshots stay in memory until the next capture and are never saved as files.',
};
let voiceArmedUntil = 0;
let savedOpenRouterKey = '', authClient;
let uiServer, uiOrigin = '';
const storePath = path.join(app.getPath('userData'), 'browser.json');
const defaults = { name: 'Max', searchEngine: 'duckduckgo', speak: false, animations: true, model: FREE_MODEL, assistantOpen: true, accent: 'cyan', theme: 'midnight', background: 'aurora', glow: 55, showRecent: true, showPopular: true, restoreTabs: true };
let data = { settings: { ...defaults }, bookmarks: [], history: [], savedTabs: [], features: [], featureData: {}, training: { instructions: '', examples: '' }, learning: [], chat: [] };
const downloads = [];
const featurePreviews = new Map();

function normaliseLearningNote(note) {
  if (!note || typeof note !== 'object') return null;
  const summary = cleanText(note.summary || '');
  if (!summary) return null;
  const timeValue = Number(note.time || note.timestamp || note.createdAt || Date.now());
  return {
    id: String(note.id || randomUUID()),
    time: Number.isFinite(timeValue) ? timeValue : Date.now(),
    summary,
    activities: Array.isArray(note.activities) ? note.activities.map(item => cleanText(item, 120)).filter(Boolean).slice(0, 5) : [],
    context: Array.isArray(note.context) ? note.context.map(item => cleanText(item, 160)).filter(Boolean).slice(0, 5) : [],
    confidence: ['low', 'medium', 'high'].includes(note.confidence) ? note.confidence : 'medium',
    sensitivity: note.sensitivity === 'sensitive_content_detected' ? 'sensitive_content_detected' : 'clear',
    model: String(note.model || '').slice(0, 160),
  };
}

function readData() {
  try {
    const saved = JSON.parse(fs.readFileSync(storePath, 'utf8'));
    data.settings = { ...defaults, ...saved.settings, model: FREE_MODEL };
    data.bookmarks = Array.isArray(saved.bookmarks) ? saved.bookmarks.filter(b => b && isWebUrl(b.url)).slice(0, 200) : [];
    data.history = Array.isArray(saved.history) ? saved.history.filter(b => b && isWebUrl(b.url)).slice(0, 500) : [];
    data.savedTabs = Array.isArray(saved.savedTabs) ? saved.savedTabs.filter(isWebUrl).slice(0, 20) : [];
    data.features = Array.isArray(saved.features) ? saved.features.slice(0, 20).flatMap(feature => {
      try { return [{ ...validateFeature(feature), id: String(feature.id), updatedAt: feature.updatedAt || Date.now(), revisions: Array.isArray(feature.revisions) ? feature.revisions.slice(0, 3).map(validateFeature) : [] }]; } catch { return []; }
    }) : [];
    data.featureData = saved.featureData && typeof saved.featureData === 'object' && !Array.isArray(saved.featureData) ? saved.featureData : {};
    data.training = saved.training && typeof saved.training === 'object' ? { instructions: String(saved.training.instructions || '').slice(0, 8000), examples: String(saved.training.examples || '').slice(0, 12000) } : { instructions: '', examples: '' };
    data.learning = Array.isArray(saved.learning) ? saved.learning.map(normaliseLearningNote).filter(Boolean).slice(0, 100) : [];
    data.chat = normaliseChat(saved.chat || saved.chatMemory || []);
    data.school = saved.school && typeof saved.school.folder === 'string' ? { folder: saved.school.folder, documents: Array.isArray(saved.school.documents) ? saved.school.documents.filter(d => d && typeof d.path === 'string' && typeof d.id === 'string').slice(0, 1000) : [] } : { folder: '', documents: [] };
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

function publicChatMemory() {
  return {
    messages: data.chat.slice(-MAX_MESSAGES),
    count: data.chat.length,
    storage: 'local-only',
    privacy: 'Your saved conversation stays on this laptop until you clear it.',
  };
}

function saveChat(messages) {
  data.chat = normaliseChat(messages);
  persist();
  return { saved: true, count: data.chat.length };
}

function clearChat() {
  data.chat = [];
  persist();
  return { cleared: true };
}

function publicScreenLearningInfo(includePreview = false) {
  const info = { ...screenLearningInfo };
  if (!includePreview) delete info.preview;
  return info;
}

function publishScreenLearning(includePreview = false) {
  broadcast();
  // Send the state first, then the transient preview. The preview is never
  // part of persisted state and should remain visible until the next update.
  send('screen-learning-update', publicScreenLearningInfo(includePreview));
}

function setScreenLearningInfo(patch, includePreview = false) {
  Object.assign(screenLearningInfo, patch);
  publishScreenLearning(includePreview);
}

async function captureDesktopSnapshot(sessionId) {
  if (!screenLearning || sessionId !== screenLearningSession || quitting) return { error: 'Screen learning is stopped.' };
  if (screenLearningInFlight) return { error: 'A screen snapshot is already being captured.' };
  screenLearningInFlight = true;
  try {
    if (!desktopCapturer || typeof desktopCapturer.getSources !== 'function') throw new Error('Desktop capture is unavailable in this build of Electron.');
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 640, height: 360 },
      fetchWindowIcons: false,
    });
    const screenSources = sources.filter(item => !String(item.id || '').toLowerCase().startsWith('window:'));
    const source = screenSources.find(item => /entire\s+screen|entire\s+desktop/i.test(item.name)) || screenSources[0];
    if (!source?.thumbnail || source.thumbnail.isEmpty()) throw new Error('Windows did not return a desktop image. Check display capture permissions and try again.');
    const size = source.thumbnail.getSize();
    const preview = `data:image/jpeg;base64,${source.thumbnail.toJPEG(55).toString('base64')}`;
    const capturedAt = Date.now();
    if (sessionId !== screenLearningSession || !screenLearning) return { error: 'Screen learning was stopped.' };
    const captures = screenLearningInfo.captures + 1;
    screenLearningInfo.preview = preview;
    setScreenLearningInfo({
      active: true,
      phase: 'analyzing',
      source: 'Entire desktop',
      sourceName: String(source.name || 'Entire screen').slice(0, 120),
      captureKind: 'screen',
      displayCount: screenSources.length,
      capturedAt,
      captures,
      lastError: '',
      previewWidth: size.width,
      previewHeight: size.height,
      message: 'Whole-display snapshot captured. The free AI is checking for broad routine signals; raw pixels stay in memory only.',
    }, true);

    const key = credentials().key;
    if (!key) {
      setScreenLearningInfo({
        active: true,
        phase: 'captured',
        message: 'Snapshot captured for your review. Connect free AI in Settings to turn it into a learning note.',
      }, true);
      return { captured: true, analysed: false, needsSetup: true, ...publicScreenLearningInfo(true) };
    }

    const captureController = new AbortController();
    screenLearningController = captureController;
    let analysis;
    try {
      analysis = await analyseScreen({ key, image: preview, signal: captureController.signal });
    } catch (error) {
      if (sessionId !== screenLearningSession || !screenLearning) return { error: 'Screen learning was stopped.' };
      const message = String(error?.message || error).slice(0, 240);
      setScreenLearningInfo({
        active: true,
        phase: 'captured',
        lastError: message,
        message: `Snapshot captured, but the free AI could not review it: ${message}. No learning note was saved.`,
      }, true);
      return { captured: true, analysed: false, analysisError: message, ...publicScreenLearningInfo(true) };
    } finally {
      if (screenLearningController === captureController) screenLearningController = null;
    }
    if (sessionId !== screenLearningSession || !screenLearning) return { error: 'Screen learning was stopped.' };
    if (analysis?.error) {
      const setupNeeded = Boolean(analysis.needsSetup);
      setScreenLearningInfo({
        active: true,
        phase: 'captured',
        lastError: setupNeeded ? '' : String(analysis.error).slice(0, 240),
        message: setupNeeded ? 'Snapshot captured for your review. Connect free AI in Settings to turn it into a learning note.' : `Snapshot captured, but the free AI could not review it: ${String(analysis.error).slice(0, 240)}. No learning note was saved.`,
      }, true);
      return { captured: true, analysed: false, ...(setupNeeded ? { needsSetup: true } : { analysisError: analysis.error }), ...publicScreenLearningInfo(true) };
    }

    const note = normaliseLearningNote({
      id: randomUUID(),
      time: capturedAt,
      summary: analysis.summary,
      activities: analysis.activities,
      context: analysis.context,
      confidence: analysis.confidence,
      sensitivity: analysis.sensitivity,
      model: analysis.model,
    });
    if (!note) throw new Error('The free AI returned no usable learning summary.');
    const previous = data.learning[0];
    const duplicate = previous && previous.summary === note.summary && JSON.stringify(previous.activities) === JSON.stringify(note.activities) && JSON.stringify(previous.context) === JSON.stringify(note.context);
    if (!duplicate) {
      data.learning = [note, ...data.learning].slice(0, 100);
      persist();
    }
    setScreenLearningInfo({
      active: true,
      phase: 'learned',
    summary: note.summary,
    activities: note.activities,
    context: note.context,
    confidence: note.confidence,
    sensitivity: note.sensitivity,
      model: note.model,
      savedCount: data.learning.length,
      events: data.learning.slice(0, 3),
      lastError: '',
      message: duplicate ? 'No new routine signal was found. The existing learning note was kept.' : 'High-level routine signals saved locally. The raw snapshot remains in memory only until the next capture.',
    }, true);
    return { captured: true, analysed: true, saved: !duplicate, note, ...publicScreenLearningInfo(true) };
  } catch (error) {
    if (sessionId === screenLearningSession && screenLearning) {
      screenLearningInfo.preview = null;
      setScreenLearningInfo({
        active: true,
        phase: 'error',
        lastError: String(error?.message || error).slice(0, 240),
        message: 'JARVIS could not capture the desktop. Learning is still on; try capturing again.',
      });
    }
    return { error: String(error?.message || error).slice(0, 240) };
  } finally {
    if (sessionId === screenLearningSession) screenLearningInFlight = false;
  }
}

async function startScreenLearning(options = {}) {
  const requested = Number(options.intervalMs);
  const intervalMs = Number.isFinite(requested) ? Math.min(120000, Math.max(15000, Math.round(requested))) : 30000;
  if (screenLearning) return { enabled: true, info: publicScreenLearningInfo() };
  clearInterval(screenLearningTimer);
  screenLearningTimer = null;
  screenLearningSession += 1;
  const sessionId = screenLearningSession;
  screenLearning = true;
  screenLearningInfo = {
    active: true,
    phase: 'starting',
    source: 'Entire desktop',
    capturedAt: null,
    captures: 0,
    intervalMs,
    lastError: '',
    preview: null,
    previewWidth: 0,
    previewHeight: 0,
    summary: '',
    activities: [],
    context: [],
    confidence: 'medium',
    model: credentials().key ? FREE_MODEL : 'Not connected',
    sensitivity: 'clear',
    savedCount: data.learning.length,
    events: data.learning.slice(0, 3),
    captureKind: 'screen',
    displayCount: 0,
    privacy: 'Snapshots stay in memory until the next capture and are never saved as files.',
    message: 'JARVIS is preparing a whole-desktop snapshot for your review.',
  };
  publishScreenLearning();
  const first = await captureDesktopSnapshot(sessionId);
  if (first.captured && screenLearning && sessionId === screenLearningSession) {
    screenLearningTimer = setInterval(() => { captureDesktopSnapshot(sessionId).catch(() => {}); }, intervalMs);
  }
  return { enabled: screenLearning, info: publicScreenLearningInfo(), capture: first };
}

function stopScreenLearning(reason = 'stopped') {
  screenLearningSession += 1;
  clearInterval(screenLearningTimer);
  screenLearningTimer = null;
  screenLearningController?.abort();
  screenLearningController = null;
  screenLearningInFlight = false;
  screenLearning = false;
  screenLearningInfo = {
    ...screenLearningInfo,
    active: false,
    phase: reason === 'emergency' || reason === 'keyboard' ? 'emergency-stopped' : 'stopped',
    capturedAt: screenLearningInfo.capturedAt || null,
    preview: null,
    lastError: '',
    savedCount: data.learning.length,
    events: data.learning.slice(0, 3),
    message: reason === 'emergency' || reason === 'keyboard' ? 'Emergency stop activated. No more screen snapshots will be taken.' : 'Screen learning is stopped.',
  };
  publishScreenLearning();
}

function emergencyStop(reason = 'emergency') {
  schoolLibrary.cancel();
  stopScreenLearning(reason);
  aiController?.abort();
  featureController?.abort();
  authClient?.cancel();
  send('notice', 'Emergency stop active. Screen learning and AI activity have stopped.');
  broadcast();
  return { stopped: true };
}

function registerEmergencyShortcut() {
  if (testing || !globalShortcut?.register) return;
  // Ctrl+Shift+Esc is handled while JARVIS has focus. Windows reserves it for
  // Task Manager, so also register a global fallback that works across apps.
  for (const accelerator of ['Control+Shift+Escape', 'Control+Shift+Alt+Escape']) {
    try {
      if (globalShortcut.register(accelerator, () => emergencyStop('keyboard'))) {
        emergencyShortcut = accelerator;
        startupLog(`emergency shortcut registered ${accelerator}`);
        break;
      }
    } catch (error) { startupLog(`emergency shortcut failed ${accelerator}: ${error?.message || error}`); }
  }
  if (!emergencyShortcut) startupLog('emergency shortcut unavailable; use the in-app Emergency stop button');
}

function credentials() {
  return readFreeCredentials({ testing, savedKey: savedOpenRouterKey, envFiles: [
    path.join(app.getAppPath(), '.env.local'),
    app.isPackaged ? path.resolve(path.dirname(process.execPath), '..', '..', '.env.local') : null,
    path.join(app.getPath('userData'), '.env.local'),
  ] });
}

function setupFreeAI() {
  const keyFile = path.join(app.getPath('userData'), 'openrouter-key.bin');
  if (!testing && safeStorage.isEncryptionAvailable()) {
    try { savedOpenRouterKey = safeStorage.decryptString(fs.readFileSync(keyFile)); } catch { /* No saved connection yet. */ }
  }
  authClient = createOpenRouterAuth({
    openExternal: url => shell.openExternal(url),
    saveKey: key => {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows secure storage is unavailable');
      fs.mkdirSync(path.dirname(keyFile), { recursive: true });
      fs.writeFileSync(keyFile + '.tmp', safeStorage.encryptString(key));
      fs.renameSync(keyFile + '.tmp', keyFile);
      savedOpenRouterKey = key;
    },
    onChange: status => {
      broadcast();
      if (status.phase === 'connected') {
        send('notice', status.message);
        if (win && !win.isDestroyed()) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
      }
    },
  });
}

async function connectFreeAI() {
  if (testing) return { error: 'Sign-in is disabled during automated tests.' };
  if (!safeStorage.isEncryptionAvailable()) return { error: 'Windows secure storage is unavailable. Restart JARVIS and try again.' };
  return authClient.start();
}

function send(event, payload) {
  if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send('jarvis:event', { event, payload });
}

function startUiServer() {
  return new Promise((resolve, reject) => {
    uiServer = http.createServer((request, response) => {
      let pathname;
      try { pathname = decodeURIComponent(new URL(request.url || '/', 'http://127.0.0.1').pathname); } catch { response.writeHead(400); response.end('Bad request'); return; }
      const allowed = ['/index.html', '/styles.css', '/renderer.js', '/icons.js', '/builder.js', '/guide.js', '/learning-hud.js', '/school-library.js', '/air.css', '/jarvis-logo.png'];
      if (!allowed.includes(pathname)) { response.writeHead(404); response.end('Not found'); return; }
      try {
        const body = fs.readFileSync(path.join(__dirname, 'ui', pathname.slice(1)));
        const type = pathname.endsWith('.png') ? 'image/png' : pathname.endsWith('.html') ? 'text/html; charset=utf-8' : pathname.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8';
        response.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
        response.end(body);
      } catch { response.writeHead(404); response.end('Not found'); }
    });
    uiServer.once('error', reject);
    uiServer.listen(0, '127.0.0.1', () => {
      uiOrigin = `http://127.0.0.1:${uiServer.address().port}`;
      startupLog(`ui server ${uiOrigin}`);
      resolve();
    });
  });
}
function activeTab() { return tabs.find(t => t.id === activeId); }
function state() {
  return {
    tabs: tabs.map(t => ({ id: t.id, title: t.title, url: t.url, loading: t.loading, error: t.error,
      canGoBack: t.view.webContents.navigationHistory.canGoBack(), canGoForward: t.view.webContents.navigationHistory.canGoForward() })),
    activeId, bookmarks: data.bookmarks, history: data.history, downloads, features: data.features,
    settings: data.settings, training: data.training, learning: data.learning.slice(0, 20), screenLearning, screenLearningInfo: publicScreenLearningInfo(), emergencyShortcut, aiReady: Boolean(credentials().key), aiProvider: 'OpenRouter', aiAuth: authClient?.getStatus() || { phase: 'idle', message: '' }, voiceAvailable: false, maximized: Boolean(win?.isMaximized()),
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
    try {
      const written = shell.writeShortcutLink(shortcut, 'create', {
        target: process.execPath,
        args: '',
        cwd: path.dirname(process.execPath),
        description: 'JARVIS — your personal browser',
        icon: process.execPath,
        iconIndex: 0,
      });
      startupLog(`shortcut ${written ? 'written' : 'not written'} ${shortcut}`);
    } catch (error) { startupLog(`shortcut failed ${shortcut}: ${error?.message || error}`); }
  } catch { /* The app remains launchable from its executable if Windows blocks shortcut creation. */ }
}

function registerIpc() {
  ipcMain.handle('jarvis:invoke', async (event, command, payload = {}) => {
    if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame || event.senderFrame.url !== `${uiOrigin}/index.html`) throw new Error('Untrusted request');
    if (!payload || typeof payload !== 'object') throw new Error('Invalid request');
    try {
      switch (command) {
        case 'state': return state();
        case 'library-state': return schoolLibrary.state();
        case 'library-folder': return await schoolLibrary.chooseFolder();
        case 'library-import': return await schoolLibrary.importFiles();
        case 'library-file': return await schoolLibrary.fileDocument(payload);
        case 'library-dismiss': return schoolLibrary.dismiss(payload.id);
        case 'library-cancel': return schoolLibrary.cancel();
        case 'library-reveal': return await schoolLibrary.reveal(payload.id);
        case 'chat-memory': return publicChatMemory();
        case 'save-chat': {
          if (!Array.isArray(payload.messages)) return { error: 'Chat memory needs a list of messages.' };
          return saveChat(payload.messages);
        }
        case 'clear-chat': return clearChat();
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
          if (['midnight', 'glass', 'carbon'].includes(payload.theme)) data.settings.theme = payload.theme;
          if (['aurora', 'deep-space', 'graphite', 'ocean', 'plain'].includes(payload.background)) data.settings.background = payload.background;
          if (Number.isFinite(payload.glow)) data.settings.glow = Math.max(0, Math.min(100, Math.round(payload.glow)));
          data.settings.model = FREE_MODEL;
          persist(); broadcast(); return state();
        }
        case 'training': {
          if (typeof payload.instructions === 'string') data.training.instructions = payload.instructions.trim().slice(0, 8000);
          if (typeof payload.examples === 'string') data.training.examples = payload.examples.trim().slice(0, 12000);
          persist(); broadcast(); return state();
        }
        case 'clear-learning': {
          data.learning = [];
          screenLearningInfo.savedCount = 0;
          screenLearningInfo.events = [];
          screenLearningInfo.summary = '';
          screenLearningInfo.activities = [];
          screenLearningInfo.context = [];
          persist();
          publishScreenLearning();
          return state();
        }
        case 'screen-learning': {
          if (payload.enabled) return await startScreenLearning(payload);
          stopScreenLearning('stopped');
          return { enabled: false, info: publicScreenLearningInfo() };
        }
        case 'screen-learning-capture': {
          if (!screenLearning) return { error: 'Start screen learning before requesting a snapshot.' };
          return await captureDesktopSnapshot(screenLearningSession);
        }
        case 'emergency-stop': {
          schoolLibrary.cancel();
          return emergencyStop('emergency');
        }
        case 'connect-ai': return await connectFreeAI();
        case 'cancel-connect-ai': authClient.cancel(); return;
        case 'page': return await readPage();
        case 'ask': {
          if (aiController) return { error: 'Please wait for the current reply or stop it first.' };
          if (!Array.isArray(payload.messages) || !payload.messages.length) return { error: 'Enter a message first.' };
          aiController = new AbortController();
          const timeout = setTimeout(() => aiController?.abort(), 60000);
           try { return await askAssistant({ ...credentials(), training: { ...data.training, screenNotes: data.learning.slice(0, 20) }, messages: payload.messages, page: payload.attachPage ? await readPage() : null, signal: aiController.signal }); }
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
        case 'voice-arm': return { ready: false };
        case 'transcribe': return await transcribe({ ...credentials(), audio: payload.audio });
        case 'show-download': {
          const download = downloads.find(d => d.id === payload.id && d.status === 'completed');
          if (download?.path) shell.showItemInFolder(download.path); return;
        }
        default: throw new Error('Unknown browser command');
      }
    } catch (error) {
      if (error.name === 'AbortError' || error.name === 'TimeoutError') return { error: 'Reply stopped. You can try again when you are ready.' };
      if (error instanceof TypeError && ['ask', 'build-feature'].includes(command)) return { error: 'Could not reach OpenRouter. Check your internet connection and try again.' };
      return { error: ['navigate', 'new-tab'].includes(command) ? error.message : 'That action could not be completed. Please try again.' };
    }
  });
}

app.on('second-instance', (_event, args) => { if (win && !win.isDestroyed()) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); if (args.includes('--connect-free-ai')) { send('open-panel', 'settings'); connectFreeAI(); } } });
if (primaryInstance) app.whenReady().then(async () => {
  startupLog('app ready');
  readData();
  screenLearningInfo.savedCount = data.learning.length;
  screenLearningInfo.events = data.learning.slice(0, 3);
  setupFreeAI();
  await startUiServer();
  protocol.handle('jarvis-tool', request => {
    const url = new URL(request.url);
    const content = url.host === 'preview' ? featurePreviews.get(url.pathname.slice(1)) : null;
    if (!content) return new Response('Preview expired. Open the tool again.', { status: 404 });
    return new Response(content, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; media-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'" } });
  });
  win = new BrowserWindow({ width: 1440, height: 930, minWidth: 1024, minHeight: 680, title: 'JARVIS — Your personal browser',
    frame: false, show: false, backgroundColor: '#14232b', icon: path.join(__dirname, 'ui', 'jarvis-logo.png'), autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, navigateOnDragDrop: false },
  });
  startupLog('window created');
  Menu.setApplicationMenu(null);
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  keyboard(win.webContents);
  setupPermissions(session.defaultSession);
  setupPermissions(session.fromPartition('persist:jarvis-pages'));
  registerEmergencyShortcut();
  registerIpc();
  ensureStartMenuShortcut();
  win.on('resize', layout);
  win.on('maximize', broadcast); win.on('unmaximize', broadcast);
  win.on('close', () => { quitting = true; stopScreenLearning('stopped'); clearTimeout(persistTimer); persistNow(); aiController?.abort(); featureController?.abort(); for (const tab of tabs) { if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close(); } });
  win.on('closed', () => { win = null; });
  const restore = [...data.savedTabs];
  createTab();
  if (data.settings.restoreTabs) for (const url of restore) createTab(url, false);
  await win.loadURL(`${uiOrigin}/index.html`);
  startupLog('ui loaded');
  win.show();
  startupLog('window shown');
  if (process.argv.includes('--connect-free-ai') && !testing) { send('open-panel', 'settings'); await connectFreeAI(); }
}).catch(error => {
  startupLog(`launch failed: ${error?.stack || error}`);
  dialog.showErrorBox('JARVIS could not start', 'Please close JARVIS and open it again. If this keeps happening, ask for help with this message: ' + String(error.message || error).slice(0, 300));
  app.quit();
});
app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => { stopScreenLearning('stopped'); if (globalShortcut?.unregisterAll) globalShortcut.unregisterAll(); authClient?.cancel(); uiServer?.close(); });
