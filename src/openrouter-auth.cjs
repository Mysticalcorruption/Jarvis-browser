const http = require('node:http');
const { randomBytes, createHash } = require('node:crypto');

function createOpenRouterAuth({ openExternal, saveKey, onChange = () => {}, fetchImpl = fetch, timeoutMs = 10 * 60 * 1000 }) {
  let flow = null;
  let status = { phase: 'idle', message: '' };
  const update = (phase, message) => { status = { phase, message }; onChange(status); };
  function cleanup(target) {
    clearTimeout(target.timer);
    target.controller.abort();
    target.server?.close();
    if (flow === target) flow = null;
  }
  function respond(res, code, message) {
    res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'" });
    res.end(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>JARVIS AI setup</title><body style="background:#0b1620;color:#d6e9f1;font:18px/1.7 Segoe UI,sans-serif;padding:60px;max-width:650px;margin:auto"><h1>JARVIS</h1><p>${message}</p><p>You can close this tab and return to JARVIS.</p></body></html>`);
  }
  async function start() {
    if (flow) return { pending: true };
    const target = { verifier: randomBytes(48).toString('base64url'), callbackPath: '/callback/' + randomBytes(24).toString('hex'), controller: new AbortController(), exchanging: false };
    flow = target;
    update('waiting', 'Finish signing in on the OpenRouter page, then return here.');
    try {
      target.server = http.createServer(async (req, res) => {
        const base = `http://127.0.0.1:${target.server.address()?.port}`;
        let url;
        try { url = new URL(req.url, base); } catch { res.writeHead(400).end(); return; }
        if (flow !== target || req.method !== 'GET' || req.headers.host !== new URL(base).host || url.pathname !== target.callbackPath) { res.writeHead(404).end(); return; }
        if (target.exchanging) { respond(res, 409, 'The connection is already being completed.'); return; }
        const code = url.searchParams.get('code');
        if (!code || code.length > 4096) {
          respond(res, 400, 'Sign-in was cancelled or did not return a valid code. Choose Connect free AI in JARVIS to try again.');
          cleanup(target); update('error', 'Sign-in was not completed. Choose Connect free AI to try again.'); return;
        }
        target.exchanging = true;
        update('connecting', 'Finishing your free AI connection…');
        try {
          const response = await fetchImpl('https://openrouter.ai/api/v1/auth/keys', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            signal: AbortSignal.any([target.controller.signal, AbortSignal.timeout(30000)]),
            body: JSON.stringify({ code, code_verifier: target.verifier, code_challenge_method: 'S256' }),
          });
          const body = await response.json().catch(() => ({}));
          if (!response.ok || typeof body.key !== 'string' || !/^sk-or-v1-[A-Za-z0-9_-]{16,512}$/.test(body.key)) throw new Error('Connection rejected');
          if (flow !== target) { respond(res, 400, 'This sign-in has expired. Please try again.'); return; }
          await saveKey(body.key);
          respond(res, 200, 'Free AI is connected. Return to JARVIS and send a message. Free usage limits apply.');
          cleanup(target); update('connected', 'Free AI is connected. Try a question or build a tool.');
        } catch {
          respond(res, 400, 'The connection could not be saved. Return to JARVIS and choose Connect free AI to try again.');
          if (flow === target) { cleanup(target); update('error', 'Could not finish connecting. Check your internet connection and try again.'); }
        }
      });
      await new Promise((resolve, reject) => { target.server.once('error', reject); target.server.listen(0, '127.0.0.1', resolve); });
      const callback = `http://127.0.0.1:${target.server.address().port}${target.callbackPath}`;
      const authUrl = new URL('https://openrouter.ai/auth');
      authUrl.searchParams.set('callback_url', callback);
      authUrl.searchParams.set('code_challenge', createHash('sha256').update(target.verifier).digest('base64url'));
      authUrl.searchParams.set('code_challenge_method', 'S256');
      authUrl.searchParams.set('key_label', 'JARVIS Free AI');
      target.timer = setTimeout(() => { if (flow === target) { cleanup(target); update('error', 'Sign-in timed out. Choose Connect free AI to try again.'); } }, timeoutMs);
      target.timer.unref();
      await openExternal(authUrl.href);
      return { pending: true };
    } catch {
      cleanup(target); update('error', 'Could not open secure sign-in. Please try again.');
      return { error: status.message };
    }
  }
  function cancel() { if (flow) cleanup(flow); update('idle', ''); }
  return { start, cancel, getStatus: () => ({ ...status }) };
}

module.exports = { createOpenRouterAuth };
