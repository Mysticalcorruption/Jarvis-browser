/* Live-learning status surface. It only presents state supplied by the app. */
(function () {
  'use strict';

  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[character]));

  let startedAt = null;
  let lastActive = false;
  let collapsed = false;
  let elapsedTimer = null;

  function sourceFor(state) {
    const info = state?.screenLearningInfo || state?.screenLearningData || state?.screenLearningStatus;
    if (info && typeof info === 'object' && !Array.isArray(info)) return { ...info, events: info.events || state?.learning || [] };
    return { events: Array.isArray(state?.learning) ? state.learning : [] };
  }

  function firstValue(...values) {
    return values.find(value => value !== undefined && value !== null && String(value).trim() !== '');
  }

  function formatTime(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function elapsed(value) {
    if (!value) return 'just now';
    const seconds = Math.max(0, Math.floor((Date.now() - value) / 1000));
    if (seconds < 60) return 'started just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `active for ${minutes}m`;
    return `active for ${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  }

  function normalise(state) {
    const source = sourceFor(state);
    const active = Boolean(state?.screenLearning || source.active || source.enabled);
    if (active && !lastActive) startedAt = Date.now();
    if (!active) startedAt = null;
    lastActive = active;

    const status = String(firstValue(source.phase, source.status, source.activityStatus, active ? 'capturing' : 'stopped')).toLowerCase();
    const phase = status.includes('analys') ? 'ANALYZING SCREEN' : status.includes('pause') ? 'LEARNING PAUSED' : status.includes('learn') || status.includes('saved') ? 'LEARNING SAVED' : status.includes('captur') ? 'CAPTURE READY' : status.includes('error') ? 'CAPTURE ISSUE' : active ? 'LIVE LEARNING' : 'LEARNING STOPPED';
    const snapshot = source.snapshot || source.lastCapture || source.latestCapture || {};
    const activeWindow = firstValue(source.activeWindow, source.activeApp, source.windowTitle, snapshot.activeWindow, snapshot.activeApp, snapshot.windowTitle);
    const summary = firstValue(source.summary, source.lastSummary, source.activity, snapshot.summary);
    const rawEvents = firstValue(source.events, source.observations, source.activityLog, snapshot.observations);
    const events = Array.isArray(rawEvents) ? rawEvents : [];
    const savedCount = Number(firstValue(source.savedCount, source.notesSaved, source.learningNotes)) || 0;
    const capturedAt = firstValue(source.capturedAt, source.lastCaptureAt, snapshot.capturedAt, source.updatedAt);
    const model = firstValue(source.model, source.lastModel, snapshot.model);
    const sensitivity = firstValue(source.sensitivity, snapshot.sensitivity);
    const preview = firstValue(source.preview, snapshot.preview);
    const captures = Number(firstValue(source.captures, snapshot.captures)) || 0;
    const activities = Array.isArray(source.activities) ? source.activities : [];
    return { active, phase, activeWindow, summary, events, savedCount, capturedAt, model, sensitivity, preview, captures, activities, source };
  }

  function ensureHud() {
    let hud = document.getElementById('learning-hud');
    if (hud) return hud;
    hud = document.createElement('section');
    hud.id = 'learning-hud';
    hud.className = 'learning-hud hidden';
    hud.setAttribute('role', 'status');
    hud.setAttribute('aria-live', 'polite');
    hud.setAttribute('aria-atomic', 'false');
      hud.innerHTML = `<div class="learning-hud-glow"></div>
      <div class="learning-hud-head">
        <span class="learning-hud-symbol" data-icon="scan"></span>
        <div class="learning-hud-heading"><div class="learning-hud-kicker"><i class="learning-pulse"></i><span id="learning-hud-phase">LIVE LEARNING</span><span class="learning-hud-elapsed" id="learning-hud-elapsed">started just now</span></div><strong id="learning-hud-title">Learning from your desktop</strong><p id="learning-hud-summary">Watching the entire desktop for useful routine signals.</p></div>
        <button class="learning-hud-toggle" id="learning-hud-toggle" type="button" aria-label="Collapse learning details" aria-expanded="true">${window.icon ? window.icon('chevron-down') : ''}</button>
      </div>
      <div class="learning-hud-details" id="learning-hud-details">
        <div class="learning-data-grid" id="learning-data-grid"></div>
        <div class="learning-preview hidden" id="learning-preview-wrap"><img id="learning-preview" alt="Temporary in-memory desktop preview"><small>Temporary preview · held in memory until the next capture</small></div>
        <div class="learning-observations" id="learning-observations"></div>
        <div class="learning-hud-foot"><span class="learning-hud-privacy" id="learning-hud-privacy">Review observations before saving them as training notes.</span><div class="learning-hud-actions"><button class="secondary hidden" id="learning-hud-connect" type="button">Connect AI</button><button class="secondary" id="learning-hud-review" type="button">Review learning</button><button class="learning-stop" id="learning-hud-stop" type="button">Pause</button></div></div>
      </div>`;
    document.body.appendChild(hud);
    if (window.renderIcons) window.renderIcons(hud);
    hud.querySelector('#learning-hud-toggle').addEventListener('click', () => {
      collapsed = !collapsed;
      hud.classList.toggle('collapsed', collapsed);
      hud.querySelector('#learning-hud-toggle').setAttribute('aria-expanded', String(!collapsed));
      hud.querySelector('#learning-hud-toggle').setAttribute('aria-label', collapsed ? 'Show learning details' : 'Collapse learning details');
    });
    hud.querySelector('#learning-hud-review').addEventListener('click', () => {
      document.dispatchEvent(new CustomEvent('jarvis-learning-review'));
    });
    hud.querySelector('#learning-hud-connect').addEventListener('click', () => {
      document.dispatchEvent(new CustomEvent('jarvis-learning-connect'));
    });
    hud.querySelector('#learning-hud-stop').addEventListener('click', () => {
      document.dispatchEvent(new CustomEvent('jarvis-learning-stop'));
    });
    return hud;
  }

  function render(state) {
    const model = normalise(state);
    const hud = ensureHud();
    hud.classList.toggle('hidden', !model.active);
    if (!model.active) {
      if (elapsedTimer) { clearInterval(elapsedTimer); elapsedTimer = null; }
      const previewWrap = hud.querySelector('#learning-preview-wrap');
      const previewImage = hud.querySelector('#learning-preview');
      previewWrap.classList.add('hidden');
      previewImage.removeAttribute('src');
      return;
    }
    if (!elapsedTimer) elapsedTimer = setInterval(() => {
      const elapsedNode = document.getElementById('learning-hud-elapsed');
      if (elapsedNode && lastActive) elapsedNode.textContent = elapsed(startedAt);
    }, 15000);
    hud.dataset.phase = model.phase.toLowerCase().replace(/\s+/g, '-');
    hud.querySelector('#learning-hud-phase').textContent = model.phase;
    hud.querySelector('#learning-hud-elapsed').textContent = elapsed(startedAt);
    hud.querySelector('#learning-hud-title').textContent = model.phase === 'ANALYZING SCREEN' ? 'Making sense of this snapshot' : model.phase === 'LEARNING SAVED' ? 'A new learning note is ready' : 'Learning from your desktop';
    hud.querySelector('#learning-hud-summary').textContent = model.summary || (model.activeWindow ? `Currently seeing ${model.activeWindow}.` : model.source.message || 'Watching the entire desktop for broad routine signals.');
    hud.querySelector('#learning-hud-stop').textContent = model.phase === 'LEARNING PAUSED' ? 'Resume' : 'Pause';
    hud.querySelector('#learning-hud-connect').classList.toggle('hidden', model.model !== 'Not connected');
    const privacy = model.sensitivity === 'sensitive_content_detected' ? 'Sensitive content was detected and omitted from the saved note.' : model.savedCount ? `${model.savedCount} learning note${model.savedCount === 1 ? '' : 's'} saved · Raw screenshots are never saved.` : 'Review observations before saving them as training notes.';
    hud.querySelector('#learning-hud-privacy').textContent = privacy;
    const activeWindowLabel = model.activeWindow ? escapeHtml(model.activeWindow) : escapeHtml(firstValue(model.source.sourceName, 'All visible windows'));
    const capturedLabel = model.capturedAt ? `Last update ${escapeHtml(formatTime(model.capturedAt))}` : 'Ready for first update';
    const modelLabel = model.model ? escapeHtml(model.model) : 'OpenRouter · free router';
    const captureLabel = model.captures ? `${model.captures} capture${model.captures === 1 ? '' : 's'}` : capturedLabel;
    const displayLabel = Number(model.source.displayCount) > 1 ? `${model.source.displayCount} display sources` : 'Entire display source';
    hud.querySelector('#learning-data-grid').innerHTML = `<article class="learning-data-card"><span class="learning-data-icon">${window.icon ? window.icon('scan') : ''}</span><div><strong>Entire desktop</strong><small>${escapeHtml(displayLabel)}</small></div><em>ON</em></article><article class="learning-data-card"><span class="learning-data-icon">${window.icon ? window.icon('orbit') : ''}</span><div><strong>Desktop source</strong><small>${activeWindowLabel}</small></div><em>${escapeHtml(captureLabel)}</em></article><article class="learning-data-card"><span class="learning-data-icon">${window.icon ? window.icon('history') : ''}</span><div><strong>Free AI model</strong><small>${modelLabel}</small></div><em>LOCAL</em></article>`;
    const previewWrap = hud.querySelector('#learning-preview-wrap');
    const previewImage = hud.querySelector('#learning-preview');
    previewWrap.classList.toggle('hidden', !model.preview);
    if (model.preview) previewImage.src = model.preview;
    const eventSource = model.events.length ? model.events : model.activities.map(text => ({ summary: text }));
    const eventMarkup = eventSource.slice(-3).reverse().map(event => {
      const text = typeof event === 'string' ? event : firstValue(event?.summary, event?.text, event?.label, event?.title);
      const time = typeof event === 'object' ? formatTime(firstValue(event.time, event.timestamp, event.createdAt)) : '';
      const detail = typeof event === 'object' && Array.isArray(event.context) && event.context.length ? `<small>${escapeHtml(event.context.join(' · '))}</small>` : '';
      return text ? `<div class="learning-observation"><span class="learning-observation-dot"></span><span class="learning-observation-copy"><strong>${escapeHtml(text)}</strong>${detail}</span>${time ? `<time>${escapeHtml(time)}</time>` : ''}</div>` : '';
    }).join('');
    hud.querySelector('#learning-observations').innerHTML = eventMarkup || '<div class="learning-observation learning-observation-empty"><span class="learning-observation-dot"></span><span>Waiting for a visible activity update…</span></div>';
  }

  window.JarvisLearningHud = { render };
}());
