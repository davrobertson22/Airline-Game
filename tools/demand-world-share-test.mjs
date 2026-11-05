// Randomized demand worlds — sharing, previewing and the auto-roller
// (Discord 2026-11-05, VodkaOnFire): the share line round-trips, the preview
// reads the same rolls the game will, and every world the auto-roller returns
// meets its conditions while every seed it skips really fails them.
//
//   node --import ./tools/_register-loader.mjs tools/demand-world-share-test.mjs
import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { AIRPORT_MARKETS } from '../src/data/airportMarkets.js';
import {
  rollDemandWorld, applyDemandWorld, demandFactor, worldFactor,
  demandWorldShareText, parseDemandWorldShare, worldSearcher, ruleReachable,
} from '../src/data/demandWorld.js';
import { AIRPORTS, baseTierOf } from '../src/data/airports.js';

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
const pctOf = (w, c) => Math.round((worldFactor(w, c) - 1) * 100);

t('the share line round-trips the number and the mega setting', () => {
  for (const uncapMegas of [false, true]) {
    const w = rollDemandWorld(424242, { uncapMegas }, AIRPORT_MARKETS);
    const text = demandWorldShareText(w);
    assert.match(text, /#424242/);
    assert.deepEqual(parseDemandWorldShare(text), { seed: 424242, uncapMegas });
  }
  assert.deepEqual(parseDemandWorldShare('  9876 '), { seed: 9876, uncapMegas: undefined });
  assert.equal(parseDemandWorldShare('no number here'), null);
  assert.equal(demandWorldShareText(null), '');
});

t('the preview reads the same rolls the running game will', () => {
  const w = rollDemandWorld(31337, {}, AIRPORT_MARKETS);
  applyDemandWorld(w);
  for (const code of ['JFK', 'LHR', 'LGW', 'DEN', 'AUS', 'BOI', 'NRT']) assert.equal(worldFactor(w, code), demandFactor(code), code);
  applyDemandWorld(null);
  assert.equal(worldFactor(null, 'JFK'), 1);
});

const RULES = [{ code: 'DEN', op: 'atLeast', pct: 25 }, { code: 'ORD', op: 'atMost', pct: -5 }];
const meets = (w, rules) => rules.every(r =>
  r.op === 'atLeast' ? pctOf(w, r.code) >= r.pct
  : r.op === 'atMost' ? pctOf(w, r.code) <= r.pct
  : (w.tiers[r.code] ?? baseTierOf(r.code)) === r.tier);

t('the auto-roller agrees with a full roll on every seed, hit or miss', () => {
  const s = worldSearcher(AIRPORT_MARKETS, {});
  let hits = 0;
  for (let seed = 1; seed <= 600; seed++) {
    const got = s.test(seed, RULES);
    const full = rollDemandWorld(seed, {}, AIRPORT_MARKETS);
    assert.equal(!!got, meets(full, RULES), `seed ${seed}`);
    if (got) { hits++; assert.deepEqual(got, full); }
  }
  assert.ok(hits > 0, 'the test rules should hit at least once in 600 seeds');
});

t('a tier condition finds worlds where the airport really changed tier', () => {
  const full = rollDemandWorld(55555, { uncapMegas: true }, AIRPORT_MARKETS);
  const riser = Object.keys(full.tiers).find(c => full.tiers[c] === 'mega');
  assert.ok(riser, 'world 55555 (uncapped) promotes a major');
  const s = worldSearcher(AIRPORT_MARKETS, { uncapMegas: true });
  const rule = [{ code: riser, op: 'tier', tier: 'mega' }];
  assert.ok(s.test(55555, rule));
  for (let seed = 1; seed <= 300; seed++) {
    const got = s.test(seed, rule);
    if (got) assert.equal(got.tiers[riser], 'mega');
  }
});

t('out-of-reach conditions are flagged before rolling', () => {
  assert.equal(ruleReachable({ code: 'LHR', op: 'atLeast', pct: 40 }), false);   // a mega tops out near +10%
  assert.equal(ruleReachable({ code: 'LHR', op: 'atLeast', pct: 5 }), true);
  const regional = AIRPORTS.find(a => baseTierOf(a.code) === 'regional').code;
  assert.equal(ruleReachable({ code: regional, op: 'atLeast', pct: 80 }), true);
  assert.equal(ruleReachable({ code: regional, op: 'tier', tier: 'mega' }), false);
  assert.equal(ruleReachable({ code: 'ZZZZ', op: 'atLeast', pct: 0 }), false);
});

const { GameProvider, freshState } = await import('../src/store/GameContext.jsx');
const { DemandWorldShare, WorldPreview } = await import('../src/components/DemandWorldPanels.jsx');
const SetupScreen = (await import('../src/components/SetupScreen.jsx')).default;
const awaitAirports = (await import('../src/components/Airports.jsx')).default;
const render = (el) => renderToString(React.createElement(GameProvider, null, el)).replace(/<!--.*?-->/g, '');

t('a randomized game shows its world number with Copy; a realistic one shows nothing', () => {
  const w = rollDemandWorld(55555, { uncapMegas: true }, AIRPORT_MARKETS);
  const html = render(React.createElement(DemandWorldShare, { world: w }));
  assert.match(html, /#55555/);
  assert.match(html, /more megas allowed/);
  assert.match(html, /Copy/);
  assert.equal(render(React.createElement(DemandWorldShare, { world: null })), '');
});

t('the Airports page carries the world number in a randomized save', () => {
  const w = rollDemandWorld(55555, {}, AIRPORT_MARKETS);
  store.set('bbae_save_v2', JSON.stringify({ ...freshState(), phase: 'playing', hub: 'ORD', gates: { ORD: 1 }, demandWorld: w }));
  const Airports = awaitAirports;
  const html = render(React.createElement(Airports));
  assert.match(html, /Randomized world/);
  assert.match(html, /#55555/);
  store.clear();
  applyDemandWorld(null);
});

t('the preview shows the hub\'s roll in that world', () => {
  const w = rollDemandWorld(777, {}, AIRPORT_MARKETS);
  const html = render(React.createElement(WorldPreview, { world: w, hub: 'DEN', onHide: () => {} }));
  const pct = Math.abs(pctOf(w, 'DEN'));
  assert.match(html, /World #777/);
  assert.match(html, new RegExp(`${pct}% traffic`));
});

t('the setup screen still renders', () => {
  const html = render(React.createElement(SetupScreen));
  assert.match(html, /Passenger demand/);
});

applyDemandWorld(null);
console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
