// Randomized demand worlds — the screens: the setup option, and the roll chip on
// an airport page in a randomized save (and its absence in a realistic one).
//
//   node --import ./tools/_register-loader.mjs tools/demand-world-ui-test.mjs
import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { AIRPORT_MARKETS } from '../src/data/airportMarkets.js';
import { rollDemandWorld, applyDemandWorld, demandFactor } from '../src/data/demandWorld.js';
import { baseTierOf } from '../src/data/airports.js';

const store = new Map();
globalThis.window = globalThis.window ?? {};
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};

let passed = 0, failed = 0;
const t = (name, fn) => {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${(e.stack || e.message).split('\n').slice(0, 3).join('\n      ')}`); failed++; }
};

const { GameProvider, freshState } = await import('../src/store/GameContext.jsx');
const SetupScreen   = (await import('../src/components/SetupScreen.jsx')).default;
const AirportDetail = (await import('../src/components/AirportDetail.jsx')).default;
const render = (el) => renderToString(React.createElement(GameProvider, null, el)).replace(/<!--.*?-->/g, '');
const seed = (extra) => store.set('bbae_save_v2', JSON.stringify({ ...freshState(), phase: 'playing', hub: 'ORD', gates: { ORD: 1 }, ...extra }));

t('the setup screen offers Realistic and Randomized passenger demand', () => {
  store.clear();
  const html = render(React.createElement(SetupScreen));
  assert.match(html, /Passenger demand/);
  assert.match(html, /Realistic/);
  assert.match(html, /Randomized/);
});

const WORLD = rollDemandWorld(55555, { uncapMegas: true }, AIRPORT_MARKETS);
const MOVED = Object.keys(WORLD.tiers).find(c => baseTierOf(c) === 'major' && WORLD.tiers[c] === 'mega')
  ?? Object.keys(WORLD.tiers)[0];

t('a randomized save shows the airport\'s roll, and where its tier came from', () => {
  seed({ demandWorld: WORLD });
  const html = render(React.createElement(AirportDetail, { code: MOVED, onBack: () => {} }));
  applyDemandWorld(WORLD);
  const pct = Math.abs(Math.round((demandFactor(MOVED) - 1) * 100));
  assert.match(html, new RegExp(`${pct}% traffic`));
  assert.match(html, new RegExp(`(promoted|demoted) from ${baseTierOf(MOVED)}`));
});

t('a realistic save shows no roll chip', () => {
  seed({});
  const html = render(React.createElement(AirportDetail, { code: 'ORD', onBack: () => {} }));
  assert.doesNotMatch(html, /% traffic/);
});

applyDemandWorld(null);
console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
