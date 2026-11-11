// Bug and consistency audit, 2026-11-09 — the fixes that apply to Tailwinds
// (port from Headwinds; the multiplayer-only and fare-cliff items do not).
//
//   1. gate fees        — Finance ▸ By Airport priced every gate at the first
//                         gate's rate ÷ 4.33; it now prints the tick's bill
//   2. line maintenance — the Fleet page ignored the maintenance budget
//   3. G&A              — hub investment was missing from the year-to-date
//   4. board mandate    — load factor averaged per route, not per seat
//   5. fleet utilisation— green from 75% up; now warns past 85%
//   6. copy             — gate pricing, loans, meltdowns, click paths
//
// HEAD failure proof. Sections 1, 2 and 5 call helpers or markup that do not
// exist on HEAD; the old figures were reproduced in the Headwinds repo's
// tools/_probe/audit1109-gates-cliff.mjs (same formulas: "ORD 20 gates billed
// $1,714,773, table shows $554,273"). Sections 3, 4 and 6 fail on HEAD as
// written.
//
//   node --import ./tools/_register-loader.mjs tools/audit-1109-fixes-test.mjs

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToString } from 'react-dom/server';

const store = new Map();
globalThis.window = globalThis.window ?? {};
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${(e.stack || e.message).split('\n').slice(0, 5).join('\n      ')}`); failed++; }
}
const src = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

const { GameProvider, freshState, gameReducer } = await import('../src/store/GameContext.jsx');
const { formatMoney, weeklyGateFeeAt, maintenanceMultiplier } = await import('../src/utils/simulation.js');
const { getAircraftType } = await import('../src/data/aircraft.js');
const { effectiveMaintAgeWeeks } = await import('../src/data/maintenance.js');
const { getAirport, gateMonthlyFee } = await import('../src/data/airports.js');
const { projectWeek } = await import('../src/utils/financeProjection.js');
const { tailMaintenanceFn } = await import('../src/utils/tailCosts.js');
const { MANDATE_KINDS } = await import('../src/models/boardMandates.js');
const { INCIDENT } = await import('../src/models/incidents.js');

const playing = (over = {}) => ({ ...freshState(), phase: 'playing', cash: 2_000_000_000, year: 2, week: 10,
  hub: 'ORD', fleet: [], pendingOrders: [], routes: [], cargoRoutes: [], ...over });

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── 1. Gate fees: one figure, the tick\'s ──────────────────────');

const GATES = { ORD: 20, BOI: 6, JFK: 1, LHR: 40 };
for (const [label, over] of [['escalating rent', {}], ['demand model v4 rent', { demandModel: 4 }]]) {
  test(`${label}: per-airport fees add up to the report's gate bill`, () => {
    const st = playing({ gates: GATES, ...over });
    const report = projectWeek(st).report;
    const sum = Object.entries(GATES).reduce((s, [c, n]) => s + weeklyGateFeeAt(st, c, n), 0);
    assert.equal(sum, report.totalGateFees);
  });
}
test('20 gates at a mega airport are not 20 first gates ÷ 4.33 (escalating rent)', () => {
  const st = playing({ gates: GATES });
  projectWeek(st);   // sets the game's rent rule, as any screen's projection does
  const real = weeklyGateFeeAt(st, 'ORD', 20);
  const old = Math.round(gateMonthlyFee(getAirport('ORD')) * 20 / 4.33);
  assert.ok(real > old * 2, `billed ${real}, the old table showed ${old}`);
});
test('Finance prints the shared figure in both places', () => {
  const s = src('src/components/Finance.jsx');
  assert.ok(!s.includes('4.33'));
  assert.ok(!/gateMonthlyFee\(/.test(s), 'Finance still prices gates itself');
  assert.equal((s.match(/weeklyGateFeeAt\(state, code, /g) ?? []).length, 2);
});

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── 2. Line maintenance: the Fleet page shows the tick\'s bill ──');

let fleetState = playing({ maintenanceBudget: 1.3 });
for (const typeId of ['b737800', 'b737800', 'a320neo']) fleetState = gameReducer(fleetState, { type: 'BUY_AIRCRAFT', typeId });
fleetState = { ...fleetState, fleet: fleetState.fleet.map((a, i) => ({ ...a, ageWeeks: 300 + 200 * i })) };

test('per tail, the helper is the report\'s figure and carries the budget', () => {
  assert.equal(fleetState.fleet.length, 3);
  const report = projectWeek(fleetState).report;
  const fn = tailMaintenanceFn(fleetState);
  let sum = 0;
  for (const a of fleetState.fleet) {
    assert.equal(fn(a), report.fleetCosts.find(c => c.aircraftId === a.id).maintenance);
    const bare = Math.round(getAircraftType(a.typeId).baseMaintenancePerWk * maintenanceMultiplier(effectiveMaintAgeWeeks(a)));
    assert.ok(fn(a) > bare * 1.2, `budget 1.30× not in the figure: ${fn(a)} vs bare ${bare}`);
    sum += fn(a);
  }
  assert.equal(sum, report.totalMaintenance);
});
const FleetPage = (await import('../src/components/Fleet.jsx')).default;
test('SSR: Weekly Maintenance on the Fleet page equals report.totalMaintenance', () => {
  store.set('bbae_save_v2', JSON.stringify(fleetState));
  const html = renderToString(React.createElement(GameProvider, null, React.createElement(FleetPage)))
    .replace(/<!-- -->/g, '');
  const i = html.indexOf('Weekly Maintenance');
  assert.ok(i > 0, 'tile rendered');
  const tile = html.slice(i, i + 300).replace(/<[^>]+>/g, ' ');
  const total = fleetState.fleet.reduce((s, a) => s + tailMaintenanceFn(fleetState)(a), 0);
  assert.ok(tile.includes(formatMoney(total)), `tile "${tile.trim()}" should show ${formatMoney(total)}`);
});
test('Fleet.jsx no longer multiplies base maintenance by age alone for a bill', () => {
  const lines = src('src/components/Fleet.jsx').split('\n')
    .filter(l => /baseMaintenancePerWk/.test(l) && !/RESERVE_READINESS_MULT/.test(l));
  assert.deepEqual(lines, []);
});

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── 3. G&A year-to-date carries hub investment ─────────────────');

test('both G&A total rows add hub investment to the year-to-date', () => {
  const s = src('src/components/Finance.jsx');
  assert.equal((s.match(/ytd=\{-\(ytdHQCost \+ ytdHubInvestment\)\}/g) ?? []).length, 2);
  assert.ok(!/ytd=\{-ytdHQCost\}/.test(s));
});

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── 4. Board mandate load factor is the Dashboard\'s ────────────');

test('seat-weighted, tag rotations left out', () => {
  const report = { routeResults: [
    { passengers: 380, configuredSeatsOneWay: 400, loadFactor: 0.95 },
    { passengers: 20,  configuredSeatsOneWay: 50,  loadFactor: 0.40 },
    { passengers: 10,  tag: true, loadFactor: 0.10 },
  ] };
  const k = MANDATE_KINDS.load_factor;
  assert.equal(k.met({ report }, 0.88), true);    // 400 / 450 = 88.9%; the plain mean was 48%
  assert.equal(k.met({ report }, 0.90), false);
});

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── 5. Fleet utilisation warns before it hurts ─────────────────');

const Dashboard = (await import('../src/components/Dashboard.jsx')).default;
const renderDash = (st) => {
  store.set('bbae_save_v2', JSON.stringify(st));
  return renderToString(React.createElement(GameProvider, null, React.createElement(Dashboard))).replace(/<!-- -->/g, '');
};
test('an idle fleet carries no slack warning', () => {
  const html = renderDash(fleetState);
  assert.ok(html.includes('Fleet Utilisation'));
  assert.ok(!html.includes('data-utilisation-note'));
});
test('the thresholds come from the engine', () => {
  const s = src('src/components/Dashboard.jsx');
  assert.match(s, /avgPct > INCIDENT\.utilisationSafe \? 'var\(--yellow\)'/);
  assert.match(s, /incidentRisk\(state, avgPct[,)]/);
  assert.equal(INCIDENT.utilisationSafe, 0.85);
});

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── 6. Copy ────────────────────────────────────────────────────');

test('airport page: "gates get dearer" only where rent really escalates', () => {
  assert.match(src('src/components/AirportDetail.jsx'), /getGateRentV4\(\) \?/);
});
test('Wiki: loans, meltdowns and click paths match the game', () => {
  const s = src('src/components/Wiki.jsx');
  assert.ok(!/offers a \*\*guaranteed amount\*\*/.test(s));
  assert.match(s, /Aircraft Finance/);
  assert.ok(!/keeps \*\*no spare aircraft\*\* and lets/.test(s));
  assert.ok(!/Open the \*\*Market\*\* tab/.test(s));
  assert.match(s, /Fleet ▸ Market/);
});

console.log(`\n${failed ? '✗' : '✓'} audit-1109-fixes: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
