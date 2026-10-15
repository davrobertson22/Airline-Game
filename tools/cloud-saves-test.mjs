// Cloud saves, client side: talking to /tw/saves and signing in.
//
// The supporter perk (docs/cloud-save-design.md): sign in with a Headwinds
// account, keep three airlines in the cloud. The server is the authority
// (Headwinds, lib/cloudSaves.mjs); this suite pins the client's half of the
// contract:
//
//   - every request carries the Supabase token, and no token means "signed out"
//     without touching the network;
//   - every server answer becomes a CloudError whose message is written for the
//     player — and a 5xx never leaks the server's own text;
//   - an upload names the version it replaces, and a 409 is a conflict to ASK
//     about, retried at most once against the version the server reported;
//   - the sign-in round trip (/?cloud=return&code=…) reopens the right mode,
//     explains a failure in words, and scrubs itself from the address bar.
//
// Verified failing on HEAD (2026-10-15): src/cloud/ did not exist, and HEAD's
// SaveLoadModal had no cloud section (see cloud-saves-ui-test.mjs).
//
//   node tools/cloud-saves-test.mjs

import assert from 'node:assert/strict';

const { cloudApi, uploadWithConflictCheck, deviceLabel, CloudError } = await import('../src/cloud/cloudApi.js');
const auth = await import('../src/cloud/cloudAuth.js');
const { CLOUD_API_BASE, CLOUD_AUTH_STORAGE_KEY, CLOUD_RETURN_MODE_KEY } = await import('../src/cloud/cloudConfig.js');

let passed = 0, failed = 0;
const tests = [];
function test(name, fn) { tests.push([name, fn]); }
function section(t) { tests.push([`§${t}`, null]); }

// ── Fakes ─────────────────────────────────────────────────────────────────────

function res(status, body, { bytes } = {}) {
  return {
    status, ok: status >= 200 && status < 300,
    async json() { if (body === undefined) throw new Error('no body'); return body; },
    async arrayBuffer() { return (bytes ?? new Uint8Array()).buffer; },
  };
}
function fakeFetch(...responses) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, ...init });
    const r = responses.shift();
    if (r instanceof Error) throw r;
    return typeof r === 'function' ? r(url, init) : r;
  };
  fn.calls = calls;
  return fn;
}
const apiWith = (fetchImpl, token = 'tok-123') => cloudApi({ getToken: async () => token, base: 'https://api.test', fetchImpl });
const memStore = (init = {}) => {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m,
    get length() { return m.size; }, key: (i) => [...m.keys()][i] ?? null,
  };
};
/** What a browser that STARTED a sign-in holds (the newer per-flow key shape). */
const startedHere = (extra = {}) => memStore({ [`${CLOUD_AUTH_STORAGE_KEY}-flow-abc-code-verifier`]: 'v', ...extra });
const summary = (name, at = '2026-10-15T01:00:00.000Z', extra = {}) =>
  ({ slot: 0, meta: { airlineName: name, year: 14, week: 12, startYear: 1978 }, size: 1000, savedAt: at, uploadedAt: at, deviceLabel: 'Chrome on Mac', ...extra });

async function rejectsWith(promise, kind) {
  try { await promise; } catch (e) {
    assert.ok(e instanceof CloudError, `expected CloudError, got ${e}`);
    assert.equal(e.kind, kind);
    assert.ok(e.message.length > 15, 'message written for a player');
    return e;
  }
  assert.fail(`expected a ${kind} CloudError`);
}

// ── API ───────────────────────────────────────────────────────────────────────

section('the API client');

test('production talks to the Headwinds API', () => {
  assert.equal(CLOUD_API_BASE, 'https://api.headwindsairlinegame.com');
});

test('list: bearer token, the slots, and whether this account may upload', async () => {
  const f = fakeFetch(res(200, { supporter: true, maxSlots: 3, slots: [summary('A'), null, null] }));
  const out = await apiWith(f).list();
  assert.equal(f.calls[0].url, 'https://api.test/tw/saves');
  assert.equal(f.calls[0].method, 'GET');
  assert.equal(f.calls[0].headers.Authorization, 'Bearer tok-123');
  assert.equal(out.supporter, true);
  assert.equal(out.slots[0].meta.airlineName, 'A');
});

test('signed out: no request at all', async () => {
  const f = fakeFetch();
  await rejectsWith(apiWith(f, null).list(), 'signedOut');
  assert.equal(f.calls.length, 0);
});

test('no network: "offline", and the message says the local game is fine', async () => {
  const e = await rejectsWith(apiWith(fakeFetch(new TypeError('Failed to fetch'))).list(), 'offline');
  assert.match(e.message, /unaffected/);
});

test('each refusal maps to a kind the screen can act on', async () => {
  await rejectsWith(apiWith(fakeFetch(res(401, { error: 'x' }))).list(), 'signedOut');
  const ns = await rejectsWith(apiWith(fakeFetch(res(403, { error: 'Uploading is a thank-you…', code: 'NOT_SUPPORTER' }))).upload(0, new Uint8Array([1]), null), 'notSupporter');
  assert.equal(ns.message, 'Uploading is a thank-you…');
  await rejectsWith(apiWith(fakeFetch(res(403, { error: 'Your account has been banned.' }))).list(), 'forbidden');
  await rejectsWith(apiWith(fakeFetch(res(404, { error: 'That cloud slot is empty.' }))).load(1), 'empty');
  await rejectsWith(apiWith(fakeFetch(res(413, { error: 'Request body is too large' }))).upload(0, new Uint8Array([1]), null), 'tooBig');
  const inv = await rejectsWith(apiWith(fakeFetch(res(422, { error: 'That file could not be read — it may be damaged.', code: 'INVALID_SAVE' }))).upload(0, new Uint8Array([1]), null), 'invalid');
  assert.match(inv.message, /damaged/);
  await rejectsWith(apiWith(fakeFetch(res(429, { error: 'Too many cloud-save requests. Wait a minute and try again.' }))).list(), 'busy');
});

test('a server error never shows the player the server\'s own text', async () => {
  const e = await rejectsWith(apiWith(fakeFetch(res(500, { error: 'Invalid `prisma.tailwindsCloudSave.findMany()` invocation' }))).list(), 'server');
  assert.ok(!/prisma/i.test(e.message));
  assert.match(e.message, /unaffected/);
});

test('upload: raw bytes, the version it replaces, and the device', async () => {
  const f = fakeFetch(res(200, { slot: summary('A') }), res(200, { slot: summary('A') }));
  const bytes = new Uint8Array([0x1f, 0x8b, 1, 2]);
  const a = await apiWith(f).upload(2, bytes, null, 'Safari on iPhone');
  const b = await apiWith(f).upload(2, bytes, '2026-10-15T01:00:00.000Z');
  assert.equal(a.ok, true);
  assert.equal(f.calls[0].method, 'PUT');
  assert.equal(f.calls[0].url, 'https://api.test/tw/saves/2');
  assert.equal(f.calls[0].body, bytes);
  assert.equal(f.calls[0].headers['content-type'], 'application/octet-stream');
  assert.equal(f.calls[0].headers['x-tw-base-upload'], 'none');
  assert.equal(f.calls[0].headers['x-tw-device'], 'Safari on iPhone');
  assert.equal(f.calls[1].headers['x-tw-base-upload'], '2026-10-15T01:00:00.000Z');
  assert.ok(!('x-tw-device' in f.calls[1].headers));
  assert.equal(b.slot.meta.airlineName, 'A');
});

test('upload: a 409 is a conflict carrying what the slot holds now', async () => {
  const f = fakeFetch(res(409, { error: 'changed', code: 'CLOUD_SLOT_CHANGED', current: summary('Theirs') }));
  const r = await apiWith(f).upload(0, new Uint8Array([1]), null);
  assert.deepEqual([r.ok, r.conflict, r.current.meta.airlineName], [false, true, 'Theirs']);
});

test('load: the bytes, untouched', async () => {
  const bytes = new Uint8Array([0x1f, 0x8b, 9, 8, 7]);
  const out = await apiWith(fakeFetch(res(200, undefined, { bytes }))).load(1);
  assert.deepEqual([...out], [...bytes]);
});

test('delete: 204 is success', async () => {
  const f = fakeFetch(res(204));
  await apiWith(f).remove(0);
  assert.equal(f.calls[0].method, 'DELETE');
});

// ── Conflicts ─────────────────────────────────────────────────────────────────

section('conflicts: ask, retry once, never loop');

function scriptedApi(...answers) {
  const calls = [];
  return { calls, async upload(slot, bytes, base, device) { calls.push({ slot, base, device }); return answers.shift(); } };
}
const OK = { ok: true, slot: summary('Mine') };
const CONFLICT = (current) => ({ ok: false, conflict: true, current });

test('no conflict: one upload, no question', async () => {
  const api = scriptedApi(OK);
  let asked = 0;
  const r = await uploadWithConflictCheck({ api, slot: 1, bytes: 'b', baseUploadedAt: 'v1', device: 'd', confirmReplace: async () => { asked++; return true; } });
  assert.equal(r.ok, true); assert.equal(asked, 0); assert.equal(api.calls.length, 1);
});

test('conflict and the player says no: nothing more is sent', async () => {
  const api = scriptedApi(CONFLICT(summary('Theirs', '2026-10-15T02:00:00.000Z')));
  const r = await uploadWithConflictCheck({ api, slot: 0, bytes: 'b', baseUploadedAt: null, confirmReplace: async () => false });
  assert.deepEqual([r.ok, r.cancelled], [false, true]);
  assert.equal(api.calls.length, 1);
});

test('conflict and the player says yes: retried against the version the server reported', async () => {
  const api = scriptedApi(CONFLICT(summary('Theirs', '2026-10-15T02:00:00.000Z')), OK);
  let shown = null;
  const r = await uploadWithConflictCheck({ api, slot: 0, bytes: 'b', baseUploadedAt: '2026-10-15T01:00:00.000Z', confirmReplace: async (c) => { shown = c; return true; } });
  assert.equal(r.ok, true);
  assert.equal(shown.meta.airlineName, 'Theirs');
  assert.equal(api.calls[1].base, '2026-10-15T02:00:00.000Z');
});

test('a slot emptied elsewhere: the retry expects an empty slot', async () => {
  const api = scriptedApi(CONFLICT(null), OK);
  await uploadWithConflictCheck({ api, slot: 2, bytes: 'b', baseUploadedAt: 'v1', confirmReplace: async () => true });
  assert.equal(api.calls[1].base, null);
});

test('it moved AGAIN while the player read the question: give up, do not ask forever', async () => {
  const api = scriptedApi(CONFLICT(summary('T1')), CONFLICT(summary('T2')), OK);
  let asked = 0;
  const r = await uploadWithConflictCheck({ api, slot: 0, bytes: 'b', baseUploadedAt: null, confirmReplace: async () => { asked++; return true; } });
  assert.deepEqual([r.ok, r.conflict, asked, api.calls.length], [false, true, 1, 2]);
  assert.equal(r.current.meta.airlineName, 'T2');
});

// ── Device labels ─────────────────────────────────────────────────────────────

section('device labels');

test('the common browsers and systems read naturally', () => {
  const cases = [
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36', 'Chrome on Mac'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15', 'Safari on Mac'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1', 'Safari on iPhone'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0 Mobile/15E148 Safari/604.1', 'Chrome on iPhone'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36 Edg/129.0', 'Edge on Windows'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0', 'Firefox on Windows'],
    ['Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36', 'Chrome on Android'],
    ['', 'Browser'],
  ];
  for (const [ua, want] of cases) assert.equal(deviceLabel(ua), want, ua);
});

// ── Sign-in round trip ────────────────────────────────────────────────────────

section('sign-in round trip');

const loc = (search, hash = '') => ({ origin: 'https://www.tailwindsairlinegame.com', search, href: `https://www.tailwindsairlinegame.com/${search}${hash}` });
const fakeHistory = () => { const h = { state: null, calls: [], replaceState(s, t, url) { h.calls.push(url); } }; return h; };
const client = ({ session = null, initError = null, getSessionError = null } = {}) => {
  const calls = [];
  const sb = { auth: {
    async initialize() { calls.push('initialize'); return { error: initError }; },
    async getSession() { calls.push('getSession'); return { data: { session }, error: getSessionError }; },
    async signInWithOAuth(o) { calls.push(['oauth', o]); return { error: null }; },
    async signInWithOtp(o) { calls.push(['otp', o]); return { error: null }; },
  } };
  return { sb, calls, load: async () => sb };
};

test('sign-ins come back to /?cloud=return on this site', () => {
  assert.equal(auth.signInReturnUrl(loc('')), 'https://www.tailwindsairlinegame.com/?cloud=return');
  assert.equal(auth.isSignInReturn('?cloud=return&code=abc'), true);
  assert.equal(auth.isSignInReturn('?play'), false);
  assert.equal(auth.isSignInReturn('?cloud=returned'), false);
});

test('Google / Discord: the provider, the return address, and the mode to reopen', async () => {
  const c = client(); const store = memStore();
  await auth.signInWithProvider('discord', 'save', { load: c.load, loc: loc(''), store });
  const [, opts] = c.calls.find((x) => x[0] === 'oauth');
  assert.equal(opts.provider, 'discord');
  assert.equal(opts.options.redirectTo, 'https://www.tailwindsairlinegame.com/?cloud=return');
  assert.equal(store.getItem(CLOUD_RETURN_MODE_KEY), 'save');
});

test('an emailed link returns to the same place and may create the account', async () => {
  const c = client(); const store = memStore();
  await auth.sendEmailLink('pilot@example.com', 'load', { load: c.load, loc: loc(''), store });
  const [, opts] = c.calls.find((x) => x[0] === 'otp');
  assert.equal(opts.email, 'pilot@example.com');
  assert.equal(opts.options.emailRedirectTo, 'https://www.tailwindsairlinegame.com/?cloud=return');
  assert.equal(opts.options.shouldCreateUser, true);
});

test('a successful return reopens the remembered mode and scrubs the address bar', async () => {
  const c = client({ session: { access_token: 't', user: { email: 'pilot@example.com' } } });
  const store = startedHere({ [CLOUD_RETURN_MODE_KEY]: 'save' });
  const history = fakeHistory();
  const r = await auth.completeSignInReturn({ load: c.load, loc: loc('?cloud=return&code=abc123', '#fleet'), history, store });
  assert.equal(r.error, null);
  assert.equal(r.mode, 'save');
  assert.equal(r.session.access_token, 't');
  assert.equal(store.getItem(CLOUD_RETURN_MODE_KEY), null, 'the remembered mode is used once');
  assert.deepEqual(history.calls, ['/#fleet']);
  assert.ok(c.calls.includes('initialize'), 'the exchange result is read from initialize()');
});

test('a provider refusal is explained without loading the client', async () => {
  let loaded = false;
  const r = await auth.completeSignInReturn({
    load: async () => { loaded = true; return client().sb; },
    loc: loc('?cloud=return&error=access_denied&error_description=User+cancelled+the+login'), history: fakeHistory(), store: memStore(),
  });
  assert.equal(loaded, false);
  assert.match(r.error, /User cancelled the login/);
  assert.equal(r.mode, 'load', 'defaults to load when nothing was remembered');
});

test('an email link opened in another browser says exactly that (no verifier here)', async () => {
  // Measured in Chromium against the real built client (2026-10-15): with no
  // verifier stored, Supabase does not attempt the exchange and reports nothing.
  const c = client();
  const r = await auth.completeSignInReturn({ load: c.load, loc: loc('?cloud=return&code=abc'), history: fakeHistory(), store: memStore() });
  assert.match(r.error, /different browser/);
});

test('a stale verifier from an older attempt: the exchange\'s own complaint is recognised', async () => {
  const c = client({ initError: { message: 'code challenge does not match previously saved code verifier' } });
  const r = await auth.completeSignInReturn({ load: c.load, loc: loc('?cloud=return&code=abc'), history: fakeHistory(), store: startedHere() });
  assert.match(r.error, /different browser/);
});

test('either verifier key shape counts; unknown storage is given the benefit of the doubt', () => {
  assert.equal(auth.hasPkceVerifier(memStore({ [`${CLOUD_AUTH_STORAGE_KEY}-code-verifier`]: 'v' })), true);
  assert.equal(auth.hasPkceVerifier(startedHere()), true);
  assert.equal(auth.hasPkceVerifier(memStore({ 'other-code-verifier': 'v' })), false);
  assert.equal(auth.hasPkceVerifier({ getItem() { return null; } }), true);
});

test('if the sign-in code cannot even load, the player is told to check their connection', async () => {
  const r = await auth.completeSignInReturn({
    load: async () => { throw new Error('chunk failed'); },
    loc: loc('?cloud=return&code=abc'), history: fakeHistory(), store: startedHere(),
  });
  assert.match(r.error, /connection/);
});

test('the round-trip parameters come out of the URL; everything else stays', () => {
  assert.equal(auth.cleanedReturnUrl('https://x.test/?play&cloud=return&code=abc&state=s#news'), '/?play=#news');
  assert.equal(auth.cleanedReturnUrl('https://x.test/?cloud=return&error=x&error_code=y&error_description=z'), '/');
});

test('a browser that never signed in never loads Supabase to find out', async () => {
  let loaded = false;
  const s = await auth.currentSession({ load: async () => { loaded = true; return client().sb; }, store: memStore() });
  assert.equal(s, null);
  assert.equal(loaded, false);
  assert.equal(auth.hasStoredSession(memStore({ [CLOUD_AUTH_STORAGE_KEY]: '{"access_token":"x"}' })), true);
  assert.equal(auth.hasStoredSession(null), false);
});

test('who is signed in: the email, else the provider\'s name', () => {
  assert.equal(auth.sessionLabel({ user: { email: 'a@b.c' } }), 'a@b.c');
  assert.equal(auth.sessionLabel({ user: { user_metadata: { full_name: 'Dave' } } }), 'Dave');
  assert.equal(auth.sessionLabel(null), 'your Headwinds account');
});

// ── run ───────────────────────────────────────────────────────────────────────

for (const [name, fn] of tests) {
  if (fn === null) { console.log(`\n── ${name.slice(1)} ${'─'.repeat(Math.max(0, 61 - name.length))}`); continue; }
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${(e.stack || e.message).split('\n').slice(0, 5).join('\n      ')}`); failed++; }
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
