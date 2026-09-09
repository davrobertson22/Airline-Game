// The save store must never lose an airline.
//
// Background: saves were four full copies of the game state in localStorage,
// counted in UTF-16 against a 5 MiB origin budget. A player's 1991 save (279
// routes, 160 aircraft — Discord, 2026-09-08) measured 688 KB of JSON, so the
// autosave plus ONE manual slot was already ~2.8 MB and a second slot could not
// be written. He was told to "delete another save slot", with two empty slots
// on screen. saveStore.js moves saves to IndexedDB, where that ceiling is gone.
//
// The dangerous part is not the storage swap, it is the migration: once a save
// lives in IndexedDB and the localStorage copy is deleted, a build that only
// reads localStorage shows the player a brand-new game, which for a 13-year
// airline is indistinguishable from data loss. Two rules make that safe, and
// this file exists to keep them true:
//
//   1. the reader ALWAYS tries both stores, permanently;
//   2. migration NEVER deletes a localStorage original until it has written the
//      record to IndexedDB, read it back, and checked it is the same save.
//
//   node --import ./tools/_register-loader.mjs tools/save-store-test.mjs

import assert from 'node:assert/strict';

let passed = 0, failed = 0;
const tests = [];
function test(name, fn) { tests.push([name, fn]); }
function section(t) { tests.push([`§${t}`, null]); }

const {
  openSaveStore, migrateLocalToIdb, localStorageBackend, memoryBackend,
  makeRecord, metaFromState, AUTOSAVE_KEY, SLOT_KEYS, ALL_KEYS, BREADCRUMB_KEY,
} = await import('../src/store/saveStore.js');

// ── Fakes ─────────────────────────────────────────────────────────────────────

/** A localStorage stand-in that can be told it is full, or to be absent. */
function fakeStorage({ full = false, bytes = Infinity } = {}) {
  const map = new Map();
  let used = 0;
  return {
    map,
    setFull(v) { full = v; },
    get length() { return map.size; },
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem(k, v) {
      const size = String(v).length * 2;
      if (full || used - (map.has(k) ? String(map.get(k)).length * 2 : 0) + size > bytes) {
        const err = new Error('quota'); err.name = 'QuotaExceededError'; throw err;
      }
      if (map.has(k)) used -= String(map.get(k)).length * 2;
      used += size;
      map.set(k, String(v));
    },
    removeItem(k) { if (map.has(k)) used -= String(map.get(k)).length * 2; map.delete(k); },
  };
}

/**
 * A durable fake standing in for the IndexedDB backend.
 *
 * NOT memoryBackend() — that one deliberately reports every write as a failure,
 * because a store that dies with the tab has to raise "your game is not being
 * saved". It is the wrong shape for a backend that is supposed to work.
 */
function durableFake() {
  const map = new Map();
  return {
    name: 'indexedDB',
    async read(key)          { return map.get(key) ?? null; },
    async write(key, record) { map.set(key, { ...record, key }); return { ok: true }; },
    async delete(key)        { map.delete(key); },
    async listMeta() {
      const out = {};
      for (const [key, rec] of map) out[key] = { ...rec.meta, savedAt: rec.savedAt };
      return out;
    },
  };
}

/** A backend that fails writes, or corrupts them, on demand. */
function flakyBackend({ failWrites = false, corruptReadback = false } = {}) {
  const inner = durableFake();
  return {
    name: 'flaky',
    async read(key) {
      const rec = await inner.read(key);
      if (rec && corruptReadback) return { ...rec, state: { ...rec.state, week: rec.state.week + 1 } };
      return rec;
    },
    async write(key, record) {
      if (failWrites) return { ok: false, reason: 'quota', message: 'full' };
      return inner.write(key, record);
    },
    async delete(key)  { return inner.delete(key); },
    async listMeta()   { return inner.listMeta(); },
    _inner: inner,
  };
}

const stateAt = (over = {}) => ({
  airlineName: 'Atlantic Airways', logoId: 'horizon', logoColor: '#f5a623', customLogo: null,
  hub: 'LGW', cash: 4_130_000, week: 5, year: 14, startYear: 1978,
  routes: [{ id: 'r1' }, { id: 'r2' }], fleet: [{ id: 'a1' }],
  ...over,
});

/** The pre-saveStore on-disk shapes, written by hand, as an old build left them. */
function seedLegacy(storage, { autosave = null, slots = {} } = {}) {
  if (autosave) storage.setItem('bbae_save_v2', JSON.stringify(autosave));
  for (const [i, st] of Object.entries(slots)) {
    storage.setItem(`bbae_slot_${i}`, JSON.stringify({
      airlineName: st.airlineName, logoId: st.logoId, logoColor: st.logoColor,
      customLogo: st.customLogo ?? null, hub: st.hub, cash: st.cash,
      week: st.week, year: st.year, savedAt: 1_756_330_000_000, gameState: st,
    }));
  }
}

// ── Round trip ────────────────────────────────────────────────────────────────

section('round trip');

test('a written record reads back with its state intact', async () => {
  const store = await openSaveStore({ backends: { idb: durableFake() }, localStorage: fakeStorage() });
  const st = stateAt();
  assert.deepEqual(await store.write(AUTOSAVE_KEY, makeRecord(AUTOSAVE_KEY, st)), { ok: true });
  const back = await store.read(AUTOSAVE_KEY);
  assert.deepEqual(back.state, st);
  assert.equal(back.meta.airlineName, 'Atlantic Airways');
  assert.equal(back.meta.startYear, 1978);
});

test('a deleted slot is gone from both stores', async () => {
  const storage = fakeStorage();
  seedLegacy(storage, { slots: { 0: stateAt() } });
  const store = await openSaveStore({ backends: { idb: durableFake(), local: localStorageBackend(storage) }, localStorage: storage, migrate: false });
  assert.ok(await store.read('slot_0'));
  await store.delete('slot_0');
  assert.equal(await store.read('slot_0'), null);
  assert.equal(storage.getItem('bbae_slot_0'), null);
});

test('listMeta draws the cards without deserialising any game state', async () => {
  const store = await openSaveStore({ backends: { idb: durableFake() }, localStorage: fakeStorage() });
  await store.write('slot_2', makeRecord('slot_2', stateAt({ airlineName: 'Probe Air', cash: 42 })));
  const metas = await store.listMeta();
  assert.deepEqual(Object.keys(metas), ['slot_2']);
  assert.equal(metas.slot_2.airlineName, 'Probe Air');
  assert.equal(metas.slot_2.cash, 42);
  assert.equal('state' in metas.slot_2, false, 'listMeta leaked a whole game state into the slot list');
  assert.equal('routes' in metas.slot_2, false);
});

// ── The write-result contract ─────────────────────────────────────────────────

section('write-result contract — the honest failure messages depend on it');

test('a full localStorage yields reason "quota" with a message, not a throw', async () => {
  const storage = fakeStorage({ full: true });
  const store = await openSaveStore({ backends: { local: localStorageBackend(storage) }, localStorage: storage });
  const result = await store.write(AUTOSAVE_KEY, makeRecord(AUTOSAVE_KEY, stateAt()));
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'quota');
  assert.equal(typeof result.message, 'string');
  assert.ok(result.message.length > 20);
});

test('the slot quota message no longer tells a player with empty slots to delete one', async () => {
  const storage = fakeStorage({ full: true });
  const store = await openSaveStore({ backends: { local: localStorageBackend(storage) }, localStorage: storage });
  const result = await store.write('slot_1', makeRecord('slot_1', stateAt()));
  assert.equal(result.reason, 'quota');
  assert.match(result.message, /already empty/i,
    'the message must account for the case that broke the 2026-09-08 report: other slots empty and still no room');
});

test('with no store at all, the write resolves AND says the game is not being saved', async () => {
  // The memory rung keeps the session playable but must not claim to have
  // saved anything — a save that dies with the tab is not a save, and the
  // player has to be told. Silence here is the original swallowed-error bug.
  const store = await openSaveStore({ indexedDB: null, localStorage: null, migrate: false });
  assert.equal(store.backendName, 'memory');
  const r = await store.write(AUTOSAVE_KEY, makeRecord(AUTOSAVE_KEY, stateAt()));
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'unavailable');
  assert.ok(/not allowing|private/i.test(r.message), r.message);
  // …and it still retains it, so loading a slot saved this session works.
  assert.ok(await store.read(AUTOSAVE_KEY));
});

// ── Dual read ─────────────────────────────────────────────────────────────────

section('dual read — IndexedDB wins, localStorage is still found');

test('a legacy localStorage save is readable with no migration at all', async () => {
  const storage = fakeStorage();
  const st = stateAt();
  seedLegacy(storage, { autosave: st, slots: { 0: stateAt({ airlineName: 'Slot Air' }) } });
  const store = await openSaveStore({ backends: { local: localStorageBackend(storage) }, localStorage: storage, migrate: false });
  assert.deepEqual((await store.read(AUTOSAVE_KEY)).state, st);
  assert.equal((await store.read('slot_0')).meta.airlineName, 'Slot Air');
});

test('when both stores hold a key, IndexedDB is the one that answers', async () => {
  const storage = fakeStorage();
  seedLegacy(storage, { autosave: stateAt({ cash: 1 }) });
  const idb = durableFake();
  await idb.write(AUTOSAVE_KEY, makeRecord(AUTOSAVE_KEY, stateAt({ cash: 999 })));
  const store = await openSaveStore({ backends: { idb, local: localStorageBackend(storage) }, localStorage: storage, migrate: false });
  assert.equal((await store.read(AUTOSAVE_KEY)).state.cash, 999);
});

test('a key only in localStorage is still found when IndexedDB is primary', async () => {
  const storage = fakeStorage();
  seedLegacy(storage, { slots: { 2: stateAt({ airlineName: 'Only Local' }) } });
  const store = await openSaveStore({ backends: { idb: durableFake(), local: localStorageBackend(storage) }, localStorage: storage, migrate: false });
  assert.equal((await store.read('slot_2')).meta.airlineName, 'Only Local');
});

// ── Migration ─────────────────────────────────────────────────────────────────

section('migration — verify before delete, always');

test('a legacy save moves across and the original is freed', async () => {
  const storage = fakeStorage();
  const st = stateAt();
  seedLegacy(storage, { autosave: st, slots: { 0: stateAt({ airlineName: 'Slot Air' }) } });
  const idb = durableFake();
  const store = await openSaveStore({ backends: { idb, local: localStorageBackend(storage) }, localStorage: storage });
  assert.deepEqual(store.migrated.sort(), ['autosave', 'slot_0']);
  assert.deepEqual((await idb.read(AUTOSAVE_KEY)).state, st);
  assert.equal(storage.getItem('bbae_save_v2'), null, 'the localStorage copy was not freed — the quota is not actually recovered');
  assert.equal(storage.getItem('bbae_slot_0'), null);
  assert.deepEqual((await store.read(AUTOSAVE_KEY)).state, st);
});

test('migration is idempotent — a second run has nothing to do and breaks nothing', async () => {
  const storage = fakeStorage();
  seedLegacy(storage, { autosave: stateAt() });
  const idb = durableFake();
  const local = localStorageBackend(storage);
  const first  = await migrateLocalToIdb(idb, local);
  const second = await migrateLocalToIdb(idb, local);
  assert.deepEqual(first, [AUTOSAVE_KEY]);
  assert.deepEqual(second, []);
  assert.ok(await idb.read(AUTOSAVE_KEY));
});

test('a failed write leaves the localStorage original exactly where it was', async () => {
  const storage = fakeStorage();
  const st = stateAt();
  seedLegacy(storage, { autosave: st });
  const idb = flakyBackend({ failWrites: true });
  const migrated = await migrateLocalToIdb(idb, localStorageBackend(storage));
  assert.deepEqual(migrated, []);
  assert.ok(storage.getItem('bbae_save_v2'), 'the original was deleted after a FAILED write — this is data loss');
  assert.deepEqual(JSON.parse(storage.getItem('bbae_save_v2')), st);
});

test('a readback that does not match leaves the original where it was', async () => {
  const storage = fakeStorage();
  const st = stateAt();
  seedLegacy(storage, { autosave: st });
  const idb = flakyBackend({ corruptReadback: true });
  const migrated = await migrateLocalToIdb(idb, localStorageBackend(storage));
  assert.deepEqual(migrated, []);
  assert.ok(storage.getItem('bbae_save_v2'), 'the original was deleted after an UNVERIFIED write — this is data loss');
});

test('a key already in IndexedDB is not overwritten by the stale localStorage copy', async () => {
  const storage = fakeStorage();
  seedLegacy(storage, { autosave: stateAt({ cash: 1, week: 2 }) });
  const idb = durableFake();
  await idb.write(AUTOSAVE_KEY, makeRecord(AUTOSAVE_KEY, stateAt({ cash: 999, week: 40 })));
  await migrateLocalToIdb(idb, localStorageBackend(storage));
  assert.equal((await idb.read(AUTOSAVE_KEY)).state.cash, 999, 'a stale localStorage save clobbered the newer IndexedDB one');
  assert.equal(storage.getItem('bbae_save_v2'), null, 'the superseded copy should still be freed');
});

test('nothing to migrate is not an error', async () => {
  const storage = fakeStorage();
  const store = await openSaveStore({ backends: { idb: durableFake(), local: localStorageBackend(storage) }, localStorage: storage });
  assert.deepEqual(store.migrated, []);
  assert.equal(await store.read(AUTOSAVE_KEY), null);
});

// ── Breadcrumb ────────────────────────────────────────────────────────────────

section('breadcrumb — index.html cannot read IndexedDB before first paint');

test('a successful autosave leaves the breadcrumb behind', async () => {
  const storage = fakeStorage();
  const store = await openSaveStore({ backends: { idb: durableFake(), local: localStorageBackend(storage) }, localStorage: storage });
  assert.equal(storage.getItem(BREADCRUMB_KEY), null);
  await store.write(AUTOSAVE_KEY, makeRecord(AUTOSAVE_KEY, stateAt()));
  assert.equal(storage.getItem(BREADCRUMB_KEY), '1', 'without this the ?play deep link stops resuming');
});

test('migrating an existing save sets the breadcrumb too', async () => {
  const storage = fakeStorage();
  seedLegacy(storage, { autosave: stateAt() });
  await openSaveStore({ backends: { idb: durableFake(), local: localStorageBackend(storage) }, localStorage: storage });
  assert.equal(storage.getItem(BREADCRUMB_KEY), '1');
});

test('a save that exists but was not migrated still sets the breadcrumb', async () => {
  const storage = fakeStorage();
  seedLegacy(storage, { autosave: stateAt() });
  await openSaveStore({ backends: { local: localStorageBackend(storage) }, localStorage: storage });
  assert.equal(storage.getItem(BREADCRUMB_KEY), '1');
});

test('deleting the autosave clears the breadcrumb', async () => {
  const storage = fakeStorage();
  const store = await openSaveStore({ backends: { idb: durableFake(), local: localStorageBackend(storage) }, localStorage: storage });
  await store.write(AUTOSAVE_KEY, makeRecord(AUTOSAVE_KEY, stateAt()));
  await store.delete(AUTOSAVE_KEY);
  assert.equal(storage.getItem(BREADCRUMB_KEY), null);
});

// ── Legacy shape preservation ─────────────────────────────────────────────────

section('legacy shapes — an older build must still recognise what we write there');

test('the localStorage autosave is still the bare state, as it always was', async () => {
  const storage = fakeStorage();
  const store = await openSaveStore({ backends: { local: localStorageBackend(storage) }, localStorage: storage });
  const st = stateAt();
  await store.write(AUTOSAVE_KEY, makeRecord(AUTOSAVE_KEY, st));
  assert.deepEqual(JSON.parse(storage.getItem('bbae_save_v2')), st,
    'an older build reads this key as the game state directly — an envelope here is a broken save for them');
});

test('a localStorage slot is still the flat record with gameState', async () => {
  const storage = fakeStorage();
  const store = await openSaveStore({ backends: { local: localStorageBackend(storage) }, localStorage: storage });
  const st = stateAt();
  await store.write('slot_1', makeRecord('slot_1', st));
  const raw = JSON.parse(storage.getItem('bbae_slot_1'));
  assert.deepEqual(raw.gameState, st);
  assert.equal(raw.airlineName, st.airlineName);
  assert.equal(raw.hub, st.hub);
  assert.equal(typeof raw.savedAt, 'number');
});

test('metaFromState carries exactly what the cards render', () => {
  const meta = metaFromState(stateAt());
  assert.deepEqual(Object.keys(meta).sort(),
    ['airlineName', 'cash', 'customLogo', 'hub', 'logoColor', 'logoId', 'startYear', 'week', 'year']);
});

test('the key list is the four saves and nothing else', () => {
  assert.deepEqual(ALL_KEYS, ['autosave', 'slot_0', 'slot_1', 'slot_2']);
  assert.deepEqual(SLOT_KEYS.length, 3);
});

// ── run ───────────────────────────────────────────────────────────────────────

for (const [name, fn] of tests) {
  if (fn === null) { console.log(`\n── ${name.slice(1)} ${'─'.repeat(Math.max(0, 61 - name.length))}`); continue; }
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${(e.stack || e.message).split('\n').slice(0, 5).join('\n      ')}`); failed++; }
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
