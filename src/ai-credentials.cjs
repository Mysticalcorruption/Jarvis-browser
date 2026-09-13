const fs = require('node:fs');
const { FREE_MODEL } = require('./free-ai.cjs');

function readFreeCredentials({ env = process.env, envFiles = [], savedKey = '', testing = false } = {}) {
  if (testing) return { key: '', model: FREE_MODEL };
  const valid = value => typeof value === 'string' && /^sk-or-v1-[A-Za-z0-9_-]{16,512}$/.test(value);
  if (valid(savedKey)) return { key: savedKey, model: FREE_MODEL };
  if (valid(env.OPENROUTER_API_KEY)) return { key: env.OPENROUTER_API_KEY, model: FREE_MODEL };
  for (const filename of envFiles.filter(Boolean)) {
    try {
      if (fs.statSync(filename).size > 65536) continue;
      const match = fs.readFileSync(filename, 'utf8').match(/^\s*OPENROUTER_API_KEY\s*=\s*(.*?)\s*$/m);
      const value = match?.[1].replace(/^['"]|['"]$/g, '');
      if (valid(value)) return { key: value, model: FREE_MODEL };
    } catch { /* An optional local connection file may not exist. */ }
  }
  return { key: '', model: FREE_MODEL };
}

module.exports = { readFreeCredentials };
