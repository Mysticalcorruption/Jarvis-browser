window.JarvisBuilder = (() => {
  let context, host, draft, editingId, currentToolId, building = false, nonce, frame, savedData = null, proposedAction = null;
  let generation = 0;
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const element = id => host?.querySelector('#' + id);

  function dispose() {
    generation++;
    if (building) context.invoke('cancel-feature');
    building = false; nonce = null; frame = null; proposedAction = null; host = null;
  }

  function scaffold() {
    const tools = context.getState().features || [];
    host.innerHTML = `<div class="builder-intro"><span class="builder-orb">${icon('sparkles')}</span><div><h3>Make a tool for your browser</h3><p>1. Choose a starter or describe an idea. 2. Try it in the preview. 3. Add it to your browser.</p></div></div><div class="builder-form"><label for="feature-target">Create something new or improve an installed tool</label><select id="feature-target"><option value="">New feature</option>${tools.map(t => `<option value="${escape(t.id)}">Improve ${escape(t.name)}</option>`).join('')}</select><label for="feature-request">What would you like it to do?</label><textarea id="feature-request" maxlength="8000" rows="3" placeholder="Build me a revision planner with subjects, a daily checklist and a progress bar…"></textarea><div class="builder-generate-row"><span id="build-connection">${context.getState().aiReady ? 'FREE AI · OPENROUTER' : 'AI SETUP NEEDED · STARTERS WORK NOW'}</span><button class="primary" id="generate-feature">${icon('sparkles')} Build with AI</button></div></div><div class="starter-row"><span>Ready to try — no AI needed</span><button class="secondary" data-starter="notes">${icon('message-plus')} Quick notes</button><button class="secondary" data-starter="focus">${icon('history')} Focus timer</button></div><div id="feature-build-status" role="status" class="feature-build-status"></div><div id="feature-preview-section" class="hidden"><div class="feature-preview-header"><div><span class="eyebrow" id="feature-preview-label">YOUR PREVIEW</span><h3 id="feature-preview-name"></h3><p id="feature-preview-summary"></p></div><button class="primary" id="install-feature">Add to my browser ${icon('plus')}</button></div><div id="feature-action" class="feature-action hidden"></div><div class="feature-frame-host"><iframe id="feature-preview" title="Feature preview" sandbox="allow-scripts" referrerpolicy="no-referrer"></iframe></div><div id="feature-feedback" class="feature-feedback" role="status"></div></div><p class="builder-scope">Build new tools that live in your sidebar: planners, calculators, reading helpers, notes and more. Tools can save their own data and suggest pages to open. Changing the underlying browser engine requires an app update.</p>`;
    element('feature-target').onchange = async event => {
      editingId = event.target.value || null;
      if (editingId) {
        draft = context.getState().features.find(t => t.id === editingId);
        await preview(draft, editingId, true);
      } else { draft = null; frame = null; nonce = null; element('feature-preview-section').classList.add('hidden'); }
    };
    if (!context.getState().aiReady) {
      element('generate-feature').innerHTML = `${icon('settings')} Connect free AI to build`;
      element('build-connection').textContent = 'Start with Quick notes or Focus timer below.';
    }
    element('generate-feature').onclick = () => context.getState().aiReady ? generate() : context.openSettings();
    host.querySelectorAll('[data-starter]').forEach(button => { button.onclick = async () => {
      if (building) return;
      const result = await context.invoke('feature-starter', { name: button.dataset.starter });
      if (result.feature) { editingId = null; element('feature-target').value = ''; draft = result.feature; await preview(draft); }
    }; });
    element('install-feature').onclick = install;
  }

  async function open(target, ctx, toolId = null) {
    dispose(); context = ctx; host = target; draft = null; editingId = null; currentToolId = toolId; savedData = null;
    scaffold();
    if (toolId) {
      const tool = context.getState().features.find(t => t.id === toolId);
      if (!tool) return;
      draft = tool; editingId = tool.id;
      host.classList.add('running-tool');
      element('feature-preview-label').textContent = 'YOUR INSTALLED TOOL';
      element('install-feature').outerHTML = `<div class="tool-controls"><button class="secondary" id="improve-feature">${icon('sparkles')} Improve with AI</button>${tool.revisions?.length ? `<button class="secondary" id="rollback-feature">Restore previous version</button>` : ''}<button class="secondary" id="remove-feature">Remove tool</button></div>`;
      element('improve-feature').onclick = () => {
        host.classList.remove('running-tool');
        scaffold(); element('feature-target').value = toolId; draft = tool; editingId = toolId;
        preview(tool, toolId, true); element('feature-request').focus();
      };
      if (element('rollback-feature')) element('rollback-feature').onclick = async () => { const result = await context.invoke('rollback-feature', { id: toolId }); if (result.restored) { context.notify('Previous version restored.'); context.openTool(toolId); } };
      element('remove-feature').onclick = async () => {
        if (!element('remove-feature').dataset.confirm) { element('remove-feature').textContent = 'Remove tool and its saved data?'; element('remove-feature').dataset.confirm = 'true'; return; }
        await context.invoke('remove-feature', { id: toolId }); context.notify('Tool removed.'); context.close();
      };
      await preview(tool, toolId);
    } else host.classList.remove('running-tool');
  }

  async function generate() {
    if (building) { await context.invoke('cancel-feature'); return; }
    const prompt = element('feature-request').value.trim();
    if (prompt.length < 5) { element('feature-build-status').textContent = 'Describe the tool you want to build first.'; return; }
    const ownGeneration = ++generation;
    building = true;
    element('generate-feature').textContent = 'Stop building';
    element('feature-build-status').innerHTML = '<span class="loading-icon">✧</span> Building your feature. This can take a minute…';
    element('feature-request').disabled = true; element('feature-target').disabled = true;
    const result = await context.invoke('build-feature', { prompt, id: editingId });
    if (ownGeneration !== generation || !host) return;
    building = false;
    element('generate-feature').innerHTML = `${icon('sparkles')} Build with AI`;
    element('feature-request').disabled = false; element('feature-target').disabled = false;
    if (result.error) {
      element('feature-build-status').textContent = result.error;
      if (result.needsSetup) { const button = document.createElement('button'); button.className = 'secondary'; button.textContent = 'Open AI settings'; button.onclick = context.openSettings; element('feature-build-status').append(button); }
      return;
    }
    draft = result.feature;
    element('feature-build-status').textContent = 'Your preview is ready. Try it below, then install it when you are happy.';
    await preview(draft, editingId, true);
  }

  async function preview(feature, id = null, isDraft = false) {
    if (!host || !feature) return;
    currentToolId = isDraft ? null : id;
    const ownGeneration = generation;
    savedData = id ? await context.invoke('feature-data', { id }) : null;
    if (ownGeneration !== generation || !host) return;
    element('feature-preview-section').classList.remove('hidden');
    element('feature-preview-name').textContent = feature.name;
    element('feature-preview-summary').textContent = feature.summary;
    if (element('install-feature')) element('install-feature').textContent = editingId ? 'Save this update' : 'Add to my browser';
    element('feature-feedback').textContent = currentToolId ? 'Changes in this tool are saved on this computer.' : 'Try it here first. Click Add to my browser to keep this tool and anything you enter.';
    proposedAction = null; element('feature-action').classList.add('hidden');
    nonce = crypto.randomUUID();
    frame = element('feature-preview');
    const documentFragment = new DOMParser().parseFromString(feature.html, 'text/html');
    documentFragment.querySelectorAll('script,style,iframe,object,embed,link,base,meta').forEach(node => node.remove());
    documentFragment.querySelectorAll('*').forEach(node => {
      [...node.attributes].filter(a => /^on/i.test(a.name) || a.name === 'srcdoc' || a.name === 'formaction').forEach(a => node.removeAttribute(a.name));
    });
    const bootstrap = `(()=>{const token=${JSON.stringify(nonce)};let data=null,ready=false;const callbacks=[];const send=(action,payload)=>parent.postMessage({channel:'jarvis-tool',token,action,...payload},'*');window.JarvisTool=Object.freeze({save:value=>send('save',{value}),onData:callback=>{callbacks.push(callback);if(ready)callback(data);},open:url=>send('open',{value:String(url)}),search:query=>send('search',{value:String(query)})});addEventListener('message',event=>{if(event.source===parent&&event.data?.channel==='jarvis-tool-data'&&event.data.token===token){data=event.data.value;ready=true;callbacks.forEach(callback=>callback(data));}});addEventListener('error',event=>send('error',{value:event.message}));addEventListener('unhandledrejection',()=>send('error',{value:'This tool could not complete an action.'}));document.addEventListener('click',event=>{const link=event.target.closest('a');if(link){event.preventDefault();send('open',{value:link.getAttribute('href')||''});}});document.addEventListener('submit',event=>event.preventDefault());send('ready',{});})();`;
    const safeStyle = feature.css.replace(/<\/style/gi, '<\\/style');
    const safeScript = feature.js.replace(/<\/script/gi, '<\\/script');
    const documentSource = `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; media-src 'none'; font-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'"><style>html{color-scheme:dark}*{box-sizing:border-box}body{margin:0;padding:28px;background:#0b1620;color:#d6e9f1;font:14px/1.6 'Segoe UI',sans-serif}h1{font-size:30px;font-weight:350;margin:0 0 12px}p,small{color:#86a6ba}input,textarea,select{font:inherit;border:1px solid #294653;background:#10222f;color:#d6e9f1;border-radius:7px;padding:10px;max-width:100%}button{font:inherit;border:1px solid #376372;background:#15323f;color:#bde8ed;border-radius:7px;padding:9px 16px;cursor:pointer}button:hover{background:#244b5b}button:focus-visible,input:focus-visible,textarea:focus-visible{outline:2px solid #5ce1e6}a{color:#5ce1e6}${safeStyle}</style></head><body>${documentFragment.body.innerHTML}<script nonce="${nonce}">${bootstrap}<\/script><script nonce="${nonce}">${safeScript}<\/script></body></html>`;
    const result = await context.invoke('preview-feature', { document: documentSource });
    if (ownGeneration !== generation || !host || !frame) return;
    if (result.url) frame.src = result.url;
    else element('feature-feedback').textContent = result.error || 'The preview could not be opened.';
  }

  async function install() {
    if (!draft) return;
    const result = await context.invoke('install-feature', { id: editingId, feature: draft });
    if (result.error) { element('feature-feedback').textContent = result.error; return; }
    if (savedData !== null) await context.invoke('save-feature-data', { id: result.id, value: savedData });
    context.notify(editingId ? 'Feature updated. Its previous version is available to restore.' : 'Feature installed. Open it from your sidebar.');
    context.refreshState && await context.refreshState();
    context.openTool(result.id);
  }

  window.addEventListener('message', async event => {
    if (!host || !frame || event.source !== frame.contentWindow || event.data?.channel !== 'jarvis-tool' || event.data.token !== nonce) return;
    const message = event.data;
    if (message.action === 'ready') { frame.contentWindow.postMessage({ channel: 'jarvis-tool-data', token: nonce, value: savedData }, '*'); return; }
    if (message.action === 'save') {
      let json;
      try { json = JSON.stringify(message.value ?? null); } catch { return; }
      if (new TextEncoder().encode(json).length > 20000) { element('feature-feedback').textContent = 'This tool can save up to 20 KB. Try using less text.'; return; }
      savedData = JSON.parse(json);
      if (currentToolId) {
        const result = await context.invoke('save-feature-data', { id: currentToolId, value: savedData });
        if (element('feature-feedback')) element('feature-feedback').textContent = result?.error || 'Saved on this computer.';
      }
    } else if (message.action === 'error') {
      element('feature-feedback').textContent = 'The tool reported a problem: ' + String(message.value || '').slice(0, 200) + ' — ask the builder to fix it.';
    } else if (['open', 'search'].includes(message.action) && typeof message.value === 'string') {
      const value = message.value.trim().slice(0, 2000);
      if (!value) return;
      if (message.action === 'open') {
        try { const url = new URL(value); if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return; } catch { return; }
      }
      proposedAction = { type: message.action, value };
      element('feature-action').innerHTML = `<span>This tool suggests ${message.action === 'search' ? 'searching for' : 'opening'} <strong>${escape(value)}</strong></span><button class="secondary" id="feature-action-confirm">${message.action === 'search' ? 'Search' : 'Open page'} ${icon('arrow-up-right')}</button><button id="feature-action-dismiss" aria-label="Dismiss suggestion">${icon('close')}</button>`;
      element('feature-action').classList.remove('hidden');
      element('feature-action-confirm').onclick = () => { const action = proposedAction; proposedAction = null; if (action) context.openAction(action); };
      element('feature-action-dismiss').onclick = () => { proposedAction = null; element('feature-action').classList.add('hidden'); };
    }
  });
  return { open, dispose };
})();
