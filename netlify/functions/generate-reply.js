// The writing guide is private configuration (VENDOR_REPLY_GUIDE); see netlify/lib/style-guide.js.
const crypto = require('crypto');
const { loadGuide, buildMessages } = require('../lib/style-guide');

const MAX_EMAIL = 20000;
const MAX_NOTES = 4000;

// Constant-time comparison (hash first so lengths don't leak).
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  return crypto.timingSafeEqual(
    crypto.createHash('sha256').update(a).digest(),
    crypto.createHash('sha256').update(b).digest()
  );
}

// Vendor correspondence is never logged, stored or returned except as the drafted reply.
function createHandler(deps = {}) {
  const env = deps.env || process.env;
  const fetchImpl = deps.fetch || fetch;
  return async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Invalid request' }),
    };
  }

  const { password, email, notes, authOnly } = body;

  // Always validate password server-side, before any model call.
  // An unset TOOL_PASSWORD denies every request.
  if (!env.TOOL_PASSWORD || !password || !safeEqual(String(password), env.TOOL_PASSWORD)) {
    return {
      statusCode: 401,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Incorrect password' }),
    };
  }

  // Auth-only ping (used by the login screen to validate the password)
  if (authOnly) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true }),
    };
  }

  // Private guide, loaded only after the password check. Missing → clear error, no model call.
  const guide = loadGuide(env);
  if (!guide) {
    return {
      statusCode: 503,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Style guide is not configured on the server. Ask an admin to set it up.' }),
    };
  }

  if (typeof email !== 'string' || !email.trim()) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Email content is required' }),
    };
  }
  if (email.length > MAX_EMAIL || (notes != null && (typeof notes !== 'string' || notes.length > MAX_NOTES))) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Email or notes too long' }),
    };
  }
  if (!env.ANTHROPIC_API_KEY) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Server not configured' }),
    };
  }

  const { system: systemPrompt, user: userMessage } = buildMessages(guide, { email, notes });

  try {
    const response = await fetchImpl('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      }),
    });

    if (!response.ok) {
      // Status only: provider error bodies can quote the request (vendor email).
      console.error('Anthropic API error status', response.status);
      return {
        statusCode: 502,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Failed to generate reply. Try again.' }),
      };
    }

    const data = await response.json();
    const reply = (data.content && data.content[0] && data.content[0].text) || '';

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reply }),
    };
  } catch (err) {
    console.error('generate-reply failed:', (err && err.name) || 'Error');
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Something went wrong. Try again.' }),
    };
  }
  };
}

exports.handler = createHandler();
exports.createHandler = createHandler;
