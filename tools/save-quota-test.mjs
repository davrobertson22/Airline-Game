// Saving must be honest about failing.
//
// The bug this locks out: both save paths swallowed a full browser store.
//
//   * The autosave was `try { localStorage.setItem(...) } catch (_) {}`. Once
//     the browser's storage for the site filled — which a long game does on its
//     own — every write threw QuotaExceededError, the catch ate it, and the
//     game carried on looking entirely normal while persisting nothing. The
//     player found out at the next refresh, having lost the session, while the
//     Save/Load screen still read "your game also auto-saves continuously in
//     the background".
//   * The manual slot write called setItem bare, so a full store threw straight
//     out of the click handler. The slot list re-read and showed the OLD
//     contents; no message appeared; the player believed they had saved.
//
// `tools/_probe-save-quota.mjs` reproduces both pre-fix call paths verbatim and
// prints what the player was told (nothing). Run it for the before-picture.
//
//   node --import ./tools/_register-loader.mjs tools/save-quota-test.mjs

import assert from 'node:assert/strict';

// Cases are queued and run at the end: slot writes go through the save store,
// whose API is async, and the sequence of sections has to stay readable.
let passed = 0, failed = 0;
const queue = [];
function test(name, fn) { queue.push([name, fn]); }
function section(t) { queue.push([t, null]); }

// A localStorage stand-in that can be told to be full, and that can fail the
// three different ways real browsers report a full store.
function makeStorage() {
  const store = new Map();
  const s = {
    mode: 'ok',            // 'ok' | 'quota' | 'quota-code' | 'quota-firefox' | 'other'
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    removeItem: (k) => store.delete(k),
    setItem: (k, v) => {
      if (s.mode === 'ok') { store.set(k, String(v)); return; }
      const e = new Error('setItem failed');
      if (s.mode === 'quota')         e.name = 'QuotaExceededError';
      if (s.mode === 'quota-code')  { e.name = 'Error'; e.code = 22; }
      if (s.mode === 'quota-firefox') { e.name = 'NS_ERROR_DOM_QUOTA_REACHED'; e.code = 1014; }
      if (s.mode === 'other')         e.name = 'SecurityError';
      throw e;
    },
    _size: () => store.size,
  };
  return s;
}

globalThis.localStorage = makeStorage();
globalThis.window = { localStorage: globalThis.localStorage };

const { gameReducer, freshState } = await import('../src/store/GameContext.jsx');
const { writeSlot } = await import('../src/components/SaveLoadModal.jsx');
const { openSaveStore, localStorageBackend } = await import('../src/store/saveStore.js');

// Saving goes through the save store now — GameContext's own persistAutosave is
// gone, because a second implementation of "write the save and be honest about
// failing" is a second place for the next bug to hide. These cases are still
// about exactly what they always were, so they keep their assertions and put a
// store on top of the fake localStorage instead of calling a writer directly.
// tools/save-store-test.mjs covers the store's own logic (dual read, migration);
// tools/save-store-browser-check.mjs covers the real IndexedDB adapter.
const storeOn = (st) => openSaveStore({ backends: { local: localStorageBackend(st) }, localStorage: st, migrate: false });
const autosave = async (st, s = state) => (await storeOn(st)).write('autosave', (await import('../src/store/saveStore.js')).makeRecord('autosave', s));

const state = { ...freshState(), airlineName: 'Quota Air', cash: 1_000_000 };

console.log('\nSave-quota honesty\n');

// ── 1. The autosave ──────────────────────────────────────────────────────────
section('1. The autosave reports its own failure');

test('a healthy store saves and says so', async () => {
  const st = makeStorage();
  const r = await autosave(st);
  assert.equal(r.ok, true, 'a working store did not report success');
  // Read back whatever key it chose rather than hardcoding one — the point of
  // this assertion is that SOMETHING was persisted, not which key it used.
  assert.equal(st._size(), 2, 'nothing was actually written (save + breadcrumb)');
});

test('a full store returns a failure instead of swallowing it', async () => {
  const st = makeStorage(); st.mode = 'quota';
  const r = await autosave(st);
  assert.equal(r.ok, false, 'the quota error was swallowed — this is the bug');
  assert.equal(r.reason, 'quota');
});

test('the message names the problem and what is at stake', async () => {
  const st = makeStorage(); st.mode = 'quota';
  const { message } = await autosave(st);
  assert.ok(/full/i.test(message), `message does not say the store is full: ${message}`);
  assert.ok(/refresh|lost/i.test(message), `message does not warn what is at stake: ${message}`);
});

test('every way a browser reports a full store is recognised as quota', async () => {
  for (const mode of ['quota', 'quota-code', 'quota-firefox']) {
    const st = makeStorage(); st.mode = mode;
    assert.equal((await autosave(st)).reason, 'quota', `${mode} was not read as a quota failure`);
  }
});

test('a non-quota failure is still reported, just not blamed on space', async () => {
  const st = makeStorage(); st.mode = 'other';
  const r = await autosave(st);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'error');
  assert.ok(!/full/i.test(r.message), 'a SecurityError should not be described as a full store');
});

test('no storage at all is reported, not crashed on', async () => {
  const store = await openSaveStore({ indexedDB: null, localStorage: null, backends: {}, migrate: false });
  const { makeRecord } = await import('../src/store/saveStore.js');
  const r = await store.write('autosave', makeRecord('autosave', state));
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'unavailable');
});

// ── 2. The warning reaches the player ────────────────────────────────────────
section('2. The failure can reach the screen');

test('PUSH_TOAST queues a toast the app layer will show', () => {
  const before = { ...freshState(), pendingToasts: [] };
  const after = gameReducer(before, { type: 'PUSH_TOAST', toast: { type: 'danger', title: 'x', message: 'y' } });
  assert.equal((after.pendingToasts ?? []).length, 1, 'the toast was not queued');
  assert.equal(after.pendingToasts[0].title, 'x');
});

test('PUSH_TOAST with no toast is a no-op, not a crash', () => {
  const before = { ...freshState(), pendingToasts: [] };
  const after = gameReducer(before, { type: 'PUSH_TOAST' });
  assert.equal((after.pendingToasts ?? []).length, 0);
});

test('PUSH_TOAST appends rather than replacing what the tick queued', () => {
  const before = { ...freshState(), pendingToasts: [{ title: 'from the tick' }] };
  const after = gameReducer(before, { type: 'PUSH_TOAST', toast: { title: 'from the autosave' } });
  assert.equal(after.pendingToasts.length, 2, 'the autosave warning ate the weekly toasts');
  assert.equal(after.pendingToasts[0].title, 'from the tick');
});

// ── 3. The manual save ───────────────────────────────────────────────────────
section('3. A manual save says when it did not happen');

test('a healthy store writes the slot and reports success', async () => {
  const st = makeStorage();
  const r = await writeSlot(0, state, await storeOn(st));
  assert.equal(r.ok, true);
  const raw = st.getItem('bbae_slot_0');
  assert.ok(raw, 'the slot was not written');
  assert.equal(JSON.parse(raw).airlineName, 'Quota Air');
});

test('a full store returns a failure instead of throwing out of the click', async () => {
  const st = makeStorage();
  const store = await storeOn(st);
  st.mode = 'quota';
  let threw = null;
  let r;
  try { r = await writeSlot(1, state, store); } catch (e) { threw = e; }
  assert.equal(threw, null, 'writeSlot threw — an uncaught throw in a click handler is exactly the silent failure');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'quota');
});

test('the quota message no longer tells a player with empty slots to delete one', async () => {
  // What the 2026-09-08 report actually looked like: slots 1 and 2 empty, and
  // the banner on the failed write said "Delete another save slot to make room."
  // There was nothing to delete. The message has to allow for that.
  const st = makeStorage();
  const store = await storeOn(st);
  st.mode = 'quota';
  const { message } = await writeSlot(1, state, store);
  assert.ok(/full/i.test(message), `message does not say the store is full: ${message}`);
  assert.ok(/already empty/i.test(message),
    `message still assumes there is a slot to delete: ${message}`);
});

test('a failed slot write leaves the existing slot alone', async () => {
  const st = makeStorage();
  const store = await storeOn(st);
  await writeSlot(2, { ...state, airlineName: 'Original' }, store);
  st.mode = 'quota';
  const r = await writeSlot(2, { ...state, airlineName: 'Replacement' }, store);
  assert.equal(r.ok, false);
  assert.equal(JSON.parse(st.getItem('bbae_slot_2')).airlineName, 'Original',
    'a failed save damaged the slot it failed to overwrite');
});

for (const [name, fn] of queue) {
  if (fn === null) { console.log(`\n── ${name} ${'─'.repeat(Math.max(0, 62 - name.length))}`); continue; }
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${(e.stack || e.message).split('\n').slice(0, 4).join('\n      ')}`); failed++; }
}

console.log(`\n${failed === 0 ? '✅' : '❌'}  ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
