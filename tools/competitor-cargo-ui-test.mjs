// Rival freight on the player's screens: the Competition tab lists a rival's
// freight lanes (and flags the ones you fly too), and your freight routes say
// who you are competing with — a lane a rival moves onto loses tonnage, and
// that drop must not be a mystery.
//
// SSR-renders the real components from a save.
//
//   node --import ./tools/_register-loader.mjs tools/competitor-cargo-ui-test.mjs
import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { cargoReferenceYield } from '../src/utils/market.js';
import { cargoLaneCfg, makeCargoTail } from '../src/models/competitorCargo.js';

const store = new Map();
globalThis.window = globalThis.window ?? {};
globalThis.window.matchMedia = globalThis.window.matchMedia ?? (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${(e.stack || e.message).split('\n').slice(0, 4).join('\n      ')}`); failed++; }
}

const { GameProvider, freshState } = await import('../src/store/GameContext.jsx');
const { default: Competition } = await import('../src/components/Competition.jsx');
const { default: CargoRoutesList } = await import('../src/components/CargoRoutesList.jsx');

const LANE = 'DXB-FRA';
const rival = {
  id: 'rv', name: 'Gulf Freight Air', tier: 'legacy', homeHub: 'DXB', cash: 400_000_000, baseQualityScore: 60,
  logoId: 'horizon', _archetype: 'balanced', marketCap: 2_000_000_000, profitHistory: [3_000_000],
  routes: { 'DXB-LHR': { frequency: 7, priceMultiplier: 1.04, aircraftType: 'b77w', seats: 350, tails: 1 } },
  fleet: [{ id: 'rv-1', typeId: 'b77w', routeKey: 'DXB-LHR', ageWeeks: 100 }, makeCargoTail('rv', 'b777f', LANE)],
  cargoRoutes: { [LANE]: cargoLaneCfg(LANE, { aircraftType: 'b777f', frequency: 7, tails: 1, yieldMultiplier: 1, openedWeek: 20 }) },
  weeklyStats: { weeklyFlights: 30, weeklyPax: 9000, weeklyRevenue: 9_000_000, weeklyCost: 7_000_000, weeklyProfit: 2_000_000,
    weeklyCargoTonnes: 690, cargoLanes: 1 },
};

const save = {
  ...freshState(),
  phase: 'playing', week: 30, year: 3, hub: 'FRA', cash: 300_000_000, homeCountry: 'DE',
  gates: { FRA: 20, DXB: 10 }, hubs: { FRA: { tier: 1 } },
  fleet: [{ id: 'f1', typeId: 'b777f', name: 'Freighter One', tailNumber: 'D-FRT1', status: 'assigned', ageWeeks: 60, ownershipType: 'owned', config: {} }],
  routes: [],
  cargoRoutes: [{ id: 'c1', origin: 'FRA', destination: 'DXB', aircraftId: 'f1', weeklyFrequency: 7,
    yieldPrice: cargoReferenceYield('FRA', 'DXB'), weeksOpen: 40, hub: 'FRA', cargo: true }],
  competitors: [rival],
};

const render = (el) => {
  store.set('bbae_save_v2', JSON.stringify(save));
  return renderToString(React.createElement(GameProvider, null, el)).replace(/<!-- -->/g, '');
};

console.log('\nRival freight on your screens\n');

const comp = render(React.createElement(Competition));
test('the Competition tab counts a rival’s freight lanes', () => {
  assert.match(comp, /1 freight lane\b/);
});

const list = render(React.createElement(CargoRoutesList));
test('your freight route names the rival competing for it', () => {
  assert.match(list, /Gulf Freight Air/);
});
test('a lone freighter with a rival is not called a "shared lane" (that means two of yours)', () => {
  assert.doesNotMatch(list, /Shared lane/);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
