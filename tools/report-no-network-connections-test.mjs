// The weekly report must not carry `networkConnections`.
//
// Port from Headwinds (2026-10-03). Measured there against production: 46 MB
// of the 154 MB of live airline state was this one array — "full Connection[]
// for debugging/UI", attached to every report since the hub-connectivity
// package and read by nothing in the engine or the UI. Here the save lives in
// localStorage, so the same field eats the storage quota instead of Postgres
// memory, and every save/load serialises it for no reader.
//
// Verified failing on HEAD: `'networkConnections' in state.lastReport` was true
// and the grep found the write at src/utils/simulation.js:5299.
//
//   node --import ./tools/_register-loader.mjs tools/report-no-network-connections-test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const store = new Map();
globalThis.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k), clear: () => store.clear() };
const { gameReducer, freshState } = await import('../src/store/GameContext.jsx');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log('  ok  ' + name); pass++; }
  catch (e) { console.log('  FAIL ' + name + '\n       ' + (e.message || e)); fail++; }
}

let s = gameReducer(freshState(), { type: 'START_GAME', airlineName: 'Probe Air', hub: 'LGW' });
s = { ...s, cash: 5e9 };
s = gameReducer(s, { type: 'BUY_AIRCRAFT', typeId: 'a320ceo' });
const ac = s.fleet.at(-1);
s = { ...s, cash: 5e9, gates: { ...s.gates, LGW: 8, AMS: 8 } };
s = gameReducer(s, { type: 'ADD_ROUTE', origin: 'LGW', destination: 'AMS', aircraftId: ac.id, weeklyFrequency: 7 });
for (let i = 0; i < 4; i++) s = gameReducer({ ...s, cash: 5e9 }, { type: 'ADVANCE_WEEK' });

t('a ticked state has a lastReport to inspect', () => {
  assert.ok(s.lastReport && typeof s.lastReport === 'object');
  assert.ok(Array.isArray(s.lastReport.routeResults) && s.lastReport.routeResults.length > 0);
});

t('lastReport does not carry networkConnections', () => {
  assert.equal('networkConnections' in s.lastReport, false,
    'networkConnections is still attached to the weekly report');
});

// Guard: a future reader must bring the field back deliberately (trimmed),
// never by surprise.
t('nothing in src reads networkConnections', () => {
  const hits = [];
  const walk = (d) => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, ent.name);
      if (ent.isDirectory()) { if (ent.name !== 'node_modules') walk(p); continue; }
      if (!/\.(m?js|jsx)$/.test(ent.name)) continue;
      const src = fs.readFileSync(p, 'utf8');
      let i = 0;
      while ((i = src.indexOf('networkConnections', i)) !== -1) {
        hits.push(path.relative(ROOT, p) + ':' + (src.slice(0, i).split('\n').length));
        i += 1;
      }
    }
  };
  walk(path.join(ROOT, 'src'));
  assert.deepEqual(hits, [], 'networkConnections referenced at: ' + hits.join(', '));
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
