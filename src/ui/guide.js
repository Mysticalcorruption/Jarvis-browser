window.JarvisGuide = (() => {
  const steps = `<ol class="guide-steps"><li><strong>Browse the web</strong><p>Type a website such as <b>youtube.com</b>, or words to search for, in the bar at the top. Press Enter. Common sites and your recent pages appear as you type.</p></li><li><strong>Talk to JARVIS</strong><p>Use the message box on the right. Commands like <b>open YouTube</b>, <b>new tab</b> and <b>go home</b> work straight away. Questions and page summaries need the AI connection.</p></li><li><strong>Organise schoolwork</strong><p>Open <b>School library</b>, choose your cloud sync folder and add PDF, Word or text documents. JARVIS suggests a subject and topic. Review them, then save a copy. Your cloud app handles the upload.</p></li><li><strong>Teach JARVIS safely</strong><p>Open <b>Train my JARVIS</b> and choose <b>Start learning</b> after connecting free AI. The bottom popup shows the entire-desktop preview, the free model, and the high-level note kept for future replies. Pause or use <b>Emergency stop</b> whenever you want.</p></li></ol>`;
  function markup(ready) {
    return `<div class="guide-intro"><h3>Your space, made simple.</h3><p>Browse, ask and keep your schoolwork together.</p></div>${steps}<div class="guide-ai-note"><strong>${ready ? 'Free AI configured · OpenRouter' : 'AI is not connected yet'}</strong><p>${ready ? 'You can ask questions and organise documents. Responses use OpenRouter’s free models and are subject to free usage limits and availability.' : 'Choose Settings, then Connect free AI. Sign in to OpenRouter and approve the connection, then come back here. JARVIS uses free models only. Free daily limits and availability vary; no purchase is required.'}</p><button class="secondary" data-panel="settings">${ready ? 'AI settings' : 'View AI setup'}</button></div><div class="guide-actions"><button class="primary" data-guide-action="browse">Browse now</button><button class="secondary" data-panel="school">Open school library</button></div>`;
  }
  function update(state) {
    const ready = state.aiReady;
    document.getElementById('home-ai-state').textContent = ready ? 'Free AI configured · OpenRouter' : 'AI not connected · browsing works now';
    document.getElementById('assistant-welcome-title').textContent = 'A little help, whenever.';
    document.getElementById('assistant-welcome-copy').textContent = ready ? 'Ask a question, give a browser command, or include a page for a summary.' : 'A thought, a question, a place to go. Connect AI in Settings when you are ready.';
    document.getElementById('chat-input').placeholder = ready ? 'Ask a question or give a command…' : 'Try “open YouTube” or “new tab”…';
    document.getElementById('connection-text').textContent = ready ? 'Free AI · OpenRouter · Settings' : 'Connect free AI · OpenRouter';
  }
  return { markup, update };
})();
