const FREE_MODEL = 'openrouter/free';
const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

function friendlyApiError(status) {
  if (status === 401) return 'Reconnect free AI in Settings. Your OpenRouter connection was not accepted.';
  if (status === 402) return 'OpenRouter could not serve this free request. JARVIS will not switch to a paid model. Check your OpenRouter account or try again later.';
  if (status === 429) return 'OpenRouter has reached a free usage limit or is busy. Try again later; daily limits reset. Browsing and starter tools still work.';
  if (status === 403) return 'OpenRouter blocked this request. Check your account and privacy settings, or try a different question.';
  if (status === 404 || status === 503) return 'No suitable free AI is available right now. Try again later. JARVIS will not use a paid model.';
  if (status >= 500) return 'OpenRouter is temporarily unavailable. Please try again shortly.';
  return 'The free AI request could not be completed. Please try a shorter request.';
}

async function requestStructured({ key, instructions, messages, schema, name, maxTokens = 3000, signal, fetchImpl = fetch }) {
  if (!key) return { error: 'Connect free AI in Settings to enable questions, page summaries and tool building. Browser commands and starter tools already work.', needsSetup: true };
  const response = await fetchImpl(ENDPOINT, {
    method: 'POST', signal: signal || AbortSignal.timeout(120000),
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'X-Title': 'JARVIS Personal Browser' },
    body: JSON.stringify({
      model: FREE_MODEL,
      messages: [{ role: 'system', content: instructions }, ...messages],
      stream: false, max_tokens: maxTokens,
      provider: { require_parameters: true, max_price: { prompt: 0, completion: 0 } },
      response_format: { type: 'json_schema', json_schema: { name, strict: true, schema } },
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.error) return { error: friendlyApiError(response.ok ? Number(body.error?.code) || 500 : response.status) };
  const choice = body.choices?.[0];
  if (choice?.finish_reason === 'length') return { error: 'The free AI ran out of room for this reply. Try a shorter question or a smaller tool.' };
  const content = choice?.message?.content;
  if (typeof content !== 'string' || !content.trim()) return { error: 'The free AI did not return a complete reply. Please try again.' };
  try { return { value: JSON.parse(content), model: typeof body.model === 'string' ? body.model : FREE_MODEL }; }
  catch { return { error: 'The free AI returned an incomplete reply. Try again or simplify your request.' }; }
}

module.exports = { FREE_MODEL, ENDPOINT, requestStructured, friendlyApiError };
