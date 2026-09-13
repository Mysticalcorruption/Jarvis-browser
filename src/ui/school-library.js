window.JarvisLibrary = (() => {
  let root, api, snapshot = {}, query = '', phase = '', selected = '';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function render() {
    if (!root?.isConnected || root.dataset.library !== 'active') return;
    const documents = snapshot.documents || [], pending = snapshot.pending || [];
    const subjects = [...new Set(documents.map(d => d.subject))].sort();
    const shown = documents.filter(d => (!selected || d.subject === selected) && `${d.name} ${d.subject} ${d.topic} ${d.summary}`.toLowerCase().includes(query.toLowerCase()));
    root.innerHTML = `<div class="library-intro"><span class="library-emblem">${icon('folder')}</span><div><h3>A place for every idea.</h3><p>Your schoolwork, organised by subject and topic.</p></div></div>
      <div class="cloud-connection"><div>${icon('folder')}<span><strong>${snapshot.folder ? 'Cloud folder connected' : 'Choose where your schoolwork lives'}</strong><small>${esc(snapshot.folder || 'Choose a folder synced by OneDrive, Google Drive or Dropbox.')}</small></span></div><button class="secondary" data-library="folder">${snapshot.folder ? 'Change folder' : 'Choose folder'}</button></div>
      <div class="library-upload"><span>${icon('scan')}</span><h3>From a pile of files to a clear mind.</h3><p>JARVIS reads your documents and suggests the right subject and topic.</p><button class="primary" data-library="import" ${snapshot.busy ? 'disabled' : ''}>${icon('plus')} Add documents</button><small>PDF, Word (.docx), TXT, Markdown, CSV · Up to 20 MB each</small><p class="library-disclosure">Extracted text is sent to your connected free AI when you add documents. Review the suggestions before saving a copy to your chosen folder. Your originals stay in place.</p></div>
      <div class="library-progress" role="status">${snapshot.busy ? '<i class="status-dot"></i>' : ''}${esc(phase)}${snapshot.busy ? '<button class="secondary" data-library="cancel">Stop sorting</button>' : ''}</div>
      ${pending.length ? `<div class="library-section-title"><h3>Review before filing</h3><span>${pending.length} document${pending.length === 1 ? '' : 's'}</span></div><div class="document-review-list">${pending.map(d => `<article class="document-review" data-id="${esc(d.id)}"><div class="document-heading">${icon('file')}<strong>${esc(d.name)}</strong><span class="document-badge">${esc(d.status === 'review' ? d.error ? 'Manual review' : `${d.confidence} confidence` : d.status)}</span></div>${d.error ? `<p class="document-error">${esc(d.error)}</p>` : `<p>${esc(d.summary || 'Reading document content…')}</p>`}${d.status === 'review' ? `<div class="document-folders"><label>Subject<input data-field="subject" maxlength="70" value="${esc(d.subject)}"></label><span>/</span><label>Topic<input data-field="topic" maxlength="70" value="${esc(d.topic)}"></label></div><div class="document-actions"><small>${esc(d.model || 'Manually organised')} · ${d.characters ? `${d.characters.toLocaleString()} characters read` : 'Original file preserved'}</small><button class="secondary" data-library="dismiss" data-id="${esc(d.id)}">Remove</button><button class="primary" data-library="file" data-id="${esc(d.id)}" ${snapshot.folder ? '' : 'disabled'}>Save to folder ${icon('arrow-right')}</button></div>` : '<div class="thinking"><i></i><i></i><i></i></div>'}</article>`).join('')}</div>` : ''}
      <div class="library-section-title"><h3>Your library</h3><span>${documents.length} filed</span></div><div class="library-filters"><input id="document-search" placeholder="Search documents, subjects or topics" aria-label="Search school documents" value="${esc(query)}"><select id="document-subject" aria-label="Filter subject"><option value="">All subjects</option>${subjects.map(s => `<option ${s === selected ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></div>
      <div class="document-list">${shown.length ? shown.map(d => `<button class="document-row" data-library="reveal" data-id="${esc(d.id)}">${icon('file')}<span><strong>${esc(d.name)}</strong><small>${esc(d.subject)} / ${esc(d.topic)}</small>${d.summary ? `<small>${esc(d.summary)}</small>` : ''}</span>${icon('arrow-up-right')}</button>`).join('') : '<div class="library-empty">Your organised documents will appear here.<br><small>Add schoolwork to start your collection.</small></div>'}</div>
      <p class="library-sync-note">Saved under JARVIS School / Subject / Topic. Your cloud app handles syncing; JARVIS cannot verify whether an upload has finished.</p>`;
    root.querySelector('#document-search').oninput = e => { const position = e.target.selectionStart; query = e.target.value; preserveDrafts(); render(); const input = root.querySelector('#document-search'); input.focus(); input.setSelectionRange(position, position); };
    root.querySelector('#document-subject').onchange = e => { selected = e.target.value; preserveDrafts(); render(); };
    root.onclick = async e => {
      const button = e.target.closest('[data-library]'); if (!button || button === root) return;
      preserveDrafts();
      const action = button.dataset.library, id = button.dataset.id;
      let payload = { id };
      if (action === 'file') { const item = snapshot.pending.find(d => d.id === id); payload = { id, subject: item.subject, topic: item.topic }; }
      button.disabled = true;
      const result = await api.invoke(`library-${action}`, payload);
      if (result && !result.error && action !== 'reveal') snapshot = result;
      render();
    };
  }
  function preserveDrafts() {
    for (const card of root?.querySelectorAll('.document-review') || []) {
      const item = snapshot.pending?.find(d => d.id === card.dataset.id);
      if (item && card.querySelector('[data-field="subject"]')) { item.subject = card.querySelector('[data-field="subject"]').value; item.topic = card.querySelector('[data-field="topic"]').value; }
    }
  }
  return {
    async open(container, context) { root = container; root.dataset.library = 'active'; api = context; snapshot = await api.invoke('library-state'); phase = ''; query = ''; selected = ''; render(); root.scrollTop = 0; },
    close() { if (root) { delete root.dataset.library; root.onclick = null; } root = null; },
    update(next) { preserveDrafts(); const drafts = new Map((snapshot.pending || []).filter(d => d.status === 'review').map(d => [d.id, { subject: d.subject, topic: d.topic }])); snapshot = next; for (const item of snapshot.pending || []) if (drafts.has(item.id)) Object.assign(item, drafts.get(item.id)); phase = next.phase || ''; render(); },
  };
})();
