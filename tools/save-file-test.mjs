// Save files must carry an airline out of the browser and back in, intact —
// and must refuse anything else politely, without ever throwing.
//
// Background: every Tailwinds save lives in one browser profile (IndexedDB, see
// saveStore.js). Clearing site data, switching device, or Safari's 7-day
// eviction of script-written storage loses the airline, and there was no way to
// back one up (docs/save-storage-indexeddb-plan.md §6 Phase 4). saveFile.js is
// that way: Export writes a .twsave, Import reads one back through LOAD_STATE.
// It is also the unit the planned supporter cloud sync uploads, so the format
// and the validator here are load-bearing twice.
//
//   node --import ./tools/_register-loader.mjs tools/save-file-test.mjs

import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
  clear: () => mem.clear(),
};

let passed = 0, failed = 0;
const tests = [];
function test(name, fn) { tests.push([name, fn]); }
function section(t) { tests.push([`§${t}`, null]); }

const {
  encodeSaveFile, decodeSaveFile, buildSaveEnvelope, saveFileName, saveFileDateLabel,
  looksLikeGameState, SAVE_FILE_FORMAT, SAVE_FILE_VERSION, SAVE_FILE_EXT,
} = await import('../src/store/saveFile.js');
const { metaFromState, requestPersistence, isPersisted } = await import('../src/store/saveStore.js');
const { gameReducer, freshState } = await import('../src/store/GameContext.jsx');

// ── A real airline, built by the real reducer ─────────────────────────────────

function buildAirline() {
  let s = gameReducer(freshState(), { type: 'START_GAME', airlineName: 'Probe Air', hub: 'LGW' });
  s = { ...s, cash: 5e9 };
  for (const d of ['CDG', 'AMS', 'FRA', 'MAD', 'FCO', 'DUB', 'BCN', 'MUC']) {
    const before = s.fleet.length;
    s = gameReducer(s, { type: 'BUY_AIRCRAFT', typeId: 'a320ceo' });
    if (s.fleet.length === before) continue;
    const ac = s.fleet.at(-1);
    s = { ...s, gates: { ...s.gates, LGW: 40, [d]: 4 } };
    s = gameReducer(s, { type: 'ADD_ROUTE', origin: 'LGW', destination: d, aircraftId: ac.id, weeklyFrequency: 7 });
  }
  for (let w = 0; w < 20; w++) s = gameReducer(s, { type: 'ADVANCE_WEEK' });
  return s;
}
const airline = buildAirline();
/** What survives JSON: the comparison target for any round trip. */
const asJson = (x) => JSON.parse(JSON.stringify(x));
const enc = new TextEncoder();

// ── Round trip ────────────────────────────────────────────────────────────────

section('round trip');

test('the fixture is a real airline (routes, fleet, weeks played)', () => {
  assert.ok(airline.routes.length >= 4, `routes: ${airline.routes.length}`);
  assert.ok(airline.fleet.length >= 4, `fleet: ${airline.fleet.length}`);
  assert.ok(((airline.year - 1) * 52 + airline.week) > 20);
  assert.ok(looksLikeGameState(airline));
});

test('export then import gives back the same state', async () => {
  const bytes = await encodeSaveFile(airline, { exportedAt: 1_760_000_000_000 });
  const back = await decodeSaveFile(bytes);
  assert.equal(back.ok, true, back.message);
  assert.deepEqual(back.state, asJson(airline));
  assert.equal(back.exportedAt, 1_760_000_000_000);
  assert.deepEqual(back.meta, asJson(metaFromState(airline)));
});

test('the file is gzip, and much smaller than the JSON', async () => {
  const bytes = await encodeSaveFile(airline);
  assert.equal(bytes[0], 0x1f); assert.equal(bytes[1], 0x8b);
  const json = JSON.stringify(buildSaveEnvelope(airline)).length;
  assert.ok(bytes.length * 4 < json, `gz ${bytes.length} vs json ${json}`);
});

test('an uncompressed .twsave (no CompressionStream) still imports', async () => {
  const bytes = await encodeSaveFile(airline, { compress: false });
  assert.equal(bytes[0], '{'.charCodeAt(0));
  const back = await decodeSaveFile(bytes);
  assert.equal(back.ok, true, back.message);
  assert.deepEqual(back.state, asJson(airline));
});

test('a File/Blob from an <input type=file> imports', async () => {
  const blob = new Blob([await encodeSaveFile(airline)]);
  const back = await decodeSaveFile(blob);
  assert.equal(back.ok, true, back.message);
  assert.equal(back.state.airlineName, 'Probe Air');
});

test('an imported state loads through LOAD_STATE like a slot does', async () => {
  const back = await decodeSaveFile(await encodeSaveFile(airline));
  const viaFile = gameReducer(freshState(), { type: 'LOAD_STATE', payload: back.state });
  const viaSlot = gameReducer(freshState(), { type: 'LOAD_STATE', payload: asJson(airline) });
  for (const k of ['airlineName', 'hub', 'cash', 'week', 'year', 'phase']) assert.deepEqual(viaFile[k], viaSlot[k], k);
  assert.equal(viaFile.routes.length, viaSlot.routes.length);
  assert.equal(viaFile.fleet.length, viaSlot.fleet.length);
  assert.equal(viaFile.phase, 'playing');
});

test('the envelope says what it is', () => {
  const env = buildSaveEnvelope(airline, 5);
  assert.equal(env.format, SAVE_FILE_FORMAT);
  assert.equal(env.version, SAVE_FILE_VERSION);
  assert.equal(env.exportedAt, 5);
  assert.equal(env.meta.airlineName, 'Probe Air');
});

// ── Legacy shapes ─────────────────────────────────────────────────────────────

section('legacy shapes players rescue from devtools');

test('a bare state (the old localStorage autosave) imports', async () => {
  const back = await decodeSaveFile(JSON.stringify(airline));
  assert.equal(back.ok, true, back.message);
  assert.equal(back.state.airlineName, 'Probe Air');
  assert.equal(back.exportedAt, null);
});

test('an old flat slot record imports, dated by its savedAt', async () => {
  const rec = { airlineName: 'Probe Air', hub: 'LGW', savedAt: 1_756_330_000_000, gameState: airline };
  const back = await decodeSaveFile(JSON.stringify(rec));
  assert.equal(back.ok, true, back.message);
  assert.equal(back.exportedAt, 1_756_330_000_000);
  assert.equal(back.state.routes.length, airline.routes.length);
});

test('a UTF-8 byte-order mark from a text editor is tolerated', async () => {
  const text = '﻿' + JSON.stringify(buildSaveEnvelope(airline));
  const back = await decodeSaveFile(enc.encode(text));
  assert.equal(back.ok, true, back.message);
});

// ── Refusals ──────────────────────────────────────────────────────────────────

section('refusals: polite, specific, never a throw');

async function refuses(input, reason, opts) {
  const r = await decodeSaveFile(input, opts);
  assert.equal(r.ok, false, 'should have been refused');
  assert.equal(r.reason, reason);
  assert.equal(typeof r.message, 'string');
  assert.ok(r.message.length > 20, 'message is written for a player');
  return r;
}

test('an empty file', () => refuses(new Uint8Array(0), 'empty'));
test('random binary', () => refuses(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 255, 254]), 'notASave'));
test('plain text that is not a save', () => refuses('just some notes about my airline', 'notASave'));
test('a cut-off download (truncated gzip)', async () => {
  const bytes = await encodeSaveFile(airline);
  await refuses(bytes.slice(0, Math.floor(bytes.length / 2)), 'damaged');
});
test('a cut-off JSON file', async () => {
  const text = JSON.stringify(buildSaveEnvelope(airline));
  await refuses(text.slice(0, text.length - 500), 'damaged');
});
test('some other JSON', async () => {
  await refuses('{"foo":1}', 'notASave');
  await refuses('[1,2,3]', 'notASave');
  await refuses('"hello"', 'notASave');
  await refuses('null', 'notASave');
});
test('somebody else\'s file format', () => refuses(JSON.stringify({ format: 'headwinds-world', version: 1, state: airline }), 'notASave'));
test('a save from a newer build', async () => {
  const r = await refuses(JSON.stringify({ ...buildSaveEnvelope(airline), version: SAVE_FILE_VERSION + 1 }), 'newer');
  assert.match(r.message, /newer version/i);
});
test('our envelope with the airline missing', () => refuses(JSON.stringify({ format: SAVE_FILE_FORMAT, version: 1, state: {} }), 'damaged'));
test('a game that never got past setup', () => refuses(JSON.stringify(freshState()), 'notASave'));
test('a gzip bomb is stopped at the cap, not inflated', async () => {
  const bomb = gzipSync(Buffer.alloc(8 * 1024 * 1024, 0x20));   // 8 MB of spaces, ~8 KB on disk
  const t = performance.now();
  await refuses(new Uint8Array(bomb), 'tooBig', { maxBytes: 1024 * 1024 });
  assert.ok(performance.now() - t < 2000);
});
test('a file bigger than the cap before decompression', () => refuses(new Uint8Array(2048).fill(0x7b), 'tooBig', { maxBytes: 1024 }));
test('something that is not a file at all', () => refuses(42, 'notASave'));

// ── Names ─────────────────────────────────────────────────────────────────────

section('file names');

test('an era game is named by airline and calendar date', () => {
  assert.equal(saveFileName({ airlineName: 'Probe Air', startYear: 1978, year: 14, week: 12 }),
    'Tailwinds - Probe Air - 1991 wk 12' + SAVE_FILE_EXT);
});
test('a classic game is named by game year', () => {
  assert.equal(saveFileDateLabel({ year: 3, week: 40 }), 'Year 3 wk 40');
});
test('characters no file system allows are removed', () => {
  const n = saveFileName({ airlineName: 'A/B\\C:D*E?F"G<H>I|J\u0007  K', year: 1, week: 1 });
  assert.equal(n, 'Tailwinds - ABCDEFGHIJ K - Year 1 wk 1.twsave');
});
test('a missing name still makes a usable file name', () => {
  assert.equal(saveFileName({}), 'Tailwinds.twsave');
});

// ── Persistent storage ────────────────────────────────────────────────────────

section('asking the browser not to clear saves');

test('already persisted: says so without asking again', async () => {
  let asked = 0;
  const nav = { storage: { persisted: async () => true, persist: async () => { asked++; return true; } } };
  assert.equal(await requestPersistence(nav), true);
  assert.equal(asked, 0);
});
test('not yet persisted: asks, and reports the answer', async () => {
  let asked = 0;
  const nav = { storage: { persisted: async () => false, persist: async () => { asked++; return false; } } };
  assert.equal(await requestPersistence(nav), false);
  assert.equal(asked, 1);
});
test('no Storage API, or one that throws: null, never an error', async () => {
  assert.equal(await requestPersistence({}), null);
  assert.equal(await requestPersistence(null), null);
  assert.equal(await requestPersistence({ storage: { persist: async () => { throw new Error('x'); } } }), null);
  assert.equal(await isPersisted({ storage: { persisted: async () => { throw new Error('x'); } } }), null);
  assert.equal(await isPersisted({ storage: { persisted: async () => true } }), true);
});

// ── run ───────────────────────────────────────────────────────────────────────

for (const [name, fn] of tests) {
  if (fn === null) { console.log(`\n── ${name.slice(1)} ${'─'.repeat(Math.max(0, 61 - name.length))}`); continue; }
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${(e.stack || e.message).split('\n').slice(0, 5).join('\n      ')}`); failed++; }
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
