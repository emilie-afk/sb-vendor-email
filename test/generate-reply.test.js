// Run: npm test  (node:test; mocked model; synthetic vendor email, no real correspondence)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHandler } = require('../netlify/functions/generate-reply.js');

const GUIDE = JSON.stringify(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs', 'style-guide.example.json'), 'utf8')));
const ENV = { TOOL_PASSWORD: 'fictional-pass', ANTHROPIC_API_KEY: 'test-key-not-real', VENDOR_REPLY_GUIDE: GUIDE };
const EMAIL = 'Hi team, SYNTHETIC-VENDOR-MARKER here. We placed the sample order and can ship the new planters next week.';
function mock(status = 200) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push(init);
    return status === 200
      ? new Response(JSON.stringify({ content: [{ text: 'Great to hear the order is in. Looking forward to it' }] }), { status })
      : new Response('{"error":{"message":"echo: ' + EMAIL + '"}}', { status });
  };
  return { fetch, calls };
}
const post = (body) => ({ httpMethod: 'POST', body: JSON.stringify(body) });

function captureLogs(fn) {
  const logs = []; const o = { error: console.error, log: console.log, warn: console.warn };
  console.error = console.log = console.warn = (...a) => logs.push(a.map(String).join(' '));
  return fn().finally(() => Object.assign(console, o)).then(() => logs.join('\n'));
}

test('authorization before any model call; unset TOOL_PASSWORD denies', async () => {
  for (const [env, body] of [
    [ENV, { email: EMAIL }], [ENV, { password: 'nope', email: EMAIL }], [ENV, { password: '', email: EMAIL }],
    [{ ...ENV, TOOL_PASSWORD: '' }, { password: '', email: EMAIL }], [{ ...ENV, TOOL_PASSWORD: undefined }, { password: 'x', email: EMAIL }],
    [{ ...ENV, TOOL_PASSWORD: undefined }, { password: 'x', authOnly: true }],
  ]) {
    const m = mock();
    const r = await createHandler({ env, fetch: m.fetch })(post(body));
    assert.equal(r.statusCode, 401);
    assert.equal(m.calls.length, 0);
  }
});

test('drafting workflow: auth ping, draft reply, nothing sent anywhere else', async () => {
  const m = mock();
  const h = createHandler({ env: ENV, fetch: m.fetch });
  assert.equal((await h(post({ password: 'fictional-pass', authOnly: true }))).statusCode, 200);
  assert.equal(m.calls.length, 0, 'auth ping makes no model call');
  const r = await h(post({ password: 'fictional-pass', email: EMAIL, notes: 'confirm ship date' }));
  assert.equal(r.statusCode, 200);
  assert.equal(JSON.parse(r.body).reply, 'Great to hear the order is in. Looking forward to it');
  assert.equal(m.calls.length, 1);
  assert.ok(JSON.parse(m.calls[0].body).messages[0].content.includes('confirm ship date'));
  assert.ok(!r.body.includes('test-key-not-real'));
});

test('vendor correspondence never reaches logs or error responses', async () => {
  const logs = await captureLogs(async () => {
    const r = await createHandler({ env: ENV, fetch: mock(400).fetch })(post({ password: 'fictional-pass', email: EMAIL }));
    assert.equal(r.statusCode, 502);
    assert.ok(!r.body.includes('SYNTHETIC-VENDOR-MARKER'));
    const r2 = await createHandler({ env: ENV, fetch: async () => { throw new Error('boom ' + EMAIL); } })(post({ password: 'fictional-pass', email: EMAIL }));
    assert.equal(r2.statusCode, 500);
    assert.ok(!r2.body.includes('SYNTHETIC-VENDOR-MARKER'));
  });
  assert.ok(!logs.includes('SYNTHETIC-VENDOR-MARKER'), 'no vendor text in logs');
});

test('input bounds', async () => {
  const m = mock();
  const h = createHandler({ env: ENV, fetch: m.fetch });
  assert.equal((await h(post({ password: 'fictional-pass', email: 'x'.repeat(20001) }))).statusCode, 400);
  assert.equal((await h(post({ password: 'fictional-pass', email: EMAIL, notes: 'x'.repeat(4001) }))).statusCode, 400);
  assert.equal((await h(post({ password: 'fictional-pass', email: { a: 1 } }))).statusCode, 400);
  assert.equal(m.calls.length, 0);
});

test('page offers drafting and copying only (no sending), keeps password in memory', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.ok(!/mailto:|sendMail|send-email|localStorage|sessionStorage/i.test(html));
  assert.ok(/navigator\.clipboard\.writeText/.test(html));
});

test('missing or invalid style guide: clear 503 before any model call (sign-in ping still works)', async () => {
  for (const g of [undefined, '', '{', JSON.stringify({ system: 'x', user: 'no email placeholder', notes: '{{notes}}' })]) {
    const m = mock();
    const h = createHandler({ env: { ...ENV, VENDOR_REPLY_GUIDE: g }, fetch: m.fetch });
    const r = await h(post({ password: 'fictional-pass', email: EMAIL }));
    assert.equal(r.statusCode, 503);
    assert.match(JSON.parse(r.body).error, /Style guide is not configured/);
    assert.equal((await h(post({ password: 'fictional-pass', authOnly: true }))).statusCode, 200);
    assert.equal(m.calls.length, 0);
  }
});

test('system and user messages come from the private guide; notes block only when notes given', async () => {
  const m = mock();
  const h = createHandler({ env: ENV, fetch: m.fetch });
  const r = await h(post({ password: 'fictional-pass', email: 'Hello {{notesBlock}}', notes: 'ship date' }));
  await h(post({ password: 'fictional-pass', email: 'Hello again' }));
  const [a, b] = m.calls.map((c) => JSON.parse(c.body));
  assert.equal(a.system, 'FICTIONAL SYSTEM GUIDE. Write a warm, short reply. No sign-off name.');
  assert.equal(a.messages[0].content, 'Vendor email:\n\nHello {{notesBlock}}\n\nCover these points:\nship date\n\nWrite a reply.');
  assert.equal(b.messages[0].content, 'Vendor email:\n\nHello again\n\nWrite a reply.');
  assert.ok(!r.body.includes('FICTIONAL'));
});
