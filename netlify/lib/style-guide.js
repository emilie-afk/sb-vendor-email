// style-guide.js — the private vendor-reply guide (tone, hard rules, banned
// phrases and the message framing). Stored in the server-only Netlify
// environment variable VENDOR_REPLY_GUIDE (scope: Functions) as single-line JSON:
//   { "version": 1, "system": "...", "user": "...{{email}}...{{notesBlock}}...", "notes": "...{{notes}}..." }
// Never in Git or the published site. Shape: docs/style-guide.example.json.

const { validTemplate, fill } = require('./template');

const ENV_NAME = 'VENDOR_REPLY_GUIDE';

function parseGuide(raw) {
  let g;
  try { g = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return null; }
  if (!g || typeof g !== 'object') return null;
  if (typeof g.system !== 'string' || !g.system.trim()) return null;
  if (!validTemplate(g.user, ['email', 'notesBlock'], ['email'])) return null;
  if (!validTemplate(g.notes, ['notes'])) return null;
  return g;
}

function loadGuide(env) {
  return env[ENV_NAME] ? parseGuide(env[ENV_NAME]) : null;
}

// Notes are optional: the notes block is added only when notes were given.
function buildMessages(g, { email, notes }) {
  const notesBlock = notes ? fill(g.notes, { notes }) : '';
  return { system: g.system, user: fill(g.user, { email, notesBlock }) };
}

module.exports = { loadGuide, parseGuide, buildMessages, ENV_NAME };
