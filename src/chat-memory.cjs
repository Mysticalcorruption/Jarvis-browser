const { sanitizeActions } = require('./core.cjs');

// Keep chat useful across restarts without allowing an unbounded profile file.
// These limits apply to the local memory copy; the live composer has its own
// input limit and the assistant still receives only the recent conversation.
const MAX_MESSAGES = 80;
const MAX_CONTENT_LENGTH = 12000;
const MAX_CONTEXT_LENGTH = 200;

function cleanText(value, limit = MAX_CONTENT_LENGTH) {
  return typeof value === 'string'
    ? value.replace(/\u0000/g, '').slice(0, limit)
    : '';
}

function normaliseChatMessage(message) {
  if (!message || !['user', 'assistant'].includes(message.role)) return null;
  const content = cleanText(message.content);
  if (!content.trim()) return null;

  const result = { role: message.role, content };
  const context = cleanText(message.context, MAX_CONTEXT_LENGTH);
  if (context.trim()) result.context = context;
  const model = cleanText(message.model, 160);
  if (model.trim()) result.model = model;
  if (message.local === true) result.local = true;
  if (message.error === true) result.error = true;
  if (message.setup === true) result.setup = true;
  const actions = sanitizeActions(message.actions);
  if (actions.length) result.actions = actions;
  return result;
}

function normaliseChat(messages) {
  if (!Array.isArray(messages)) return [];
  return messages.map(normaliseChatMessage).filter(Boolean).slice(-MAX_MESSAGES);
}

module.exports = { MAX_MESSAGES, MAX_CONTENT_LENGTH, normaliseChatMessage, normaliseChat };
