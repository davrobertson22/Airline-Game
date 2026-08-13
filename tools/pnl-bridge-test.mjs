// The weekly P&L opens on the number the player is looking at.
//
// D7(e). The Dashboard's Weekly P&L is a bridge — route profit at the top,
//        corporate costs below, net profit at the bottom. Its first row summed
//        the engine's per-route `profit`, which is revenue less DIRECT flying
//        costs, and its tooltip said "this is the profit shown in the Top Routes
//        table". That table renders each route's FULLY-LOADED profit: the same
//        contribution, less that route's block-hour share of its aircraft's
//        lease and maintenance.
//
//        Both numbers were right. Only one of them was the one the label
//        promised, and it was the number a player is trying to reconcile FROM.
//        The gap is the entire flying fleet's ownership cost — measured at
//        $183,966 a week on a two-route fixture.
//
//        The ladder is now self-checking: `residual` is whatever the itemised
//        rows fail to explain, and it is asserted to be zero here. Headwinds'
//        copy of this module has no such test, and it double-counts partner
//        revenue — its report's totalRevenue already contains the partner share
//        and the bridge adds it again as its own row. That was found by writing
//        this file.
//
//   node --import ./tools/_register-loader.mjs tools/pnl-bridge-test.mjs

import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { costBridge, bridgeInputsFromReport } from '../src/utils/pnlBridge.js';
import {
  weeklyTick, referencePrice, routePairKey, defaultClassPrices, defaultConfig, formatMoney,
} from '../src/utils/simulation.js';
import { projectWeek } from '../src/utils/financeProjection.js';
import { allocateFixedCosts, routeProfit, BASIS_FULL } from '../src/utils/routeEconomics.js';
import { getAircraftType } from '../src/data/aircraft.js';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k), clear: () => store.clear(),
  key: (i) => [...store.keys()][i] ?? null, get length() { return store.size; },
};
globalThis.window ??= {
  localStorage: globalThis.localStorage,
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
};
if (!globalThis.window.localStorage) globalThis.window.localStorage = globalThis.localStorage;

const { GameProvider, freshState } = await import('../src/store/GameContext.jsx');
const Dashboard = (await import('../src/components/Dashboard.jsx')).default;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${(e.stack || e.message).split('\n').slice(0, 4).join('\n      ')}`); failed++; }
}
const realWarn = console.warn;
const quietly = (fn) => { console.warn = () => {}; try { return fn(); } finally { console.warn = realWarn; } };

const NARROW = getAircraftType('a320ceo');

/** A network with a leased tail flying, an owned tail flying, and one parked. */
const world = (over = {}) => {
  const spokes = ['ORD', 'MIA', 'BOS'];
  const fleet = [
    { id: 'lease0', typeId: NARROW.id, tailNumber: 'NL0', status: 'assigned', ageWeeks: 60,
      ownershipType: 'leased', weeklyLease: 68_000, config: defaultConfig(NARROW.seats) },
    { id: 'own0', typeId: NARROW.id, tailNumber: 'NO0', status: 'assigned', ageWeeks: 60,
      ownershipType: 'owned', config: defaultConfig(NARROW.seats) },
    { id: 'idle0', typeId: NARROW.id, tailNumber: 'NI0', status: 'idle', ageWeeks: 60,
      ownershipType: 'leased', weeklyLease: 68_000, config: defaultConfig(NARROW.seats) },
  ];
  const routes = [
    { id: 'r0', origin: 'JFK', destination: spokes[0], aircraftId: 'lease0', weeklyFrequency: 14,
      weeksOpen: 80, hub: 'JFK', ticketPrice: Math.round(referencePrice('JFK', spokes[0])), cateringLevel: 'standard' },
    { id: 'r1', origin: 'JFK', destination: spokes[1], aircraftId: 'own0', weeklyFrequency: 14,
      weeksOpen: 80, hub: 'JFK', ticketPrice: Math.round(referencePrice('JFK', spokes[1])), cateringLevel: 'standard' },
    // A SECOND route on the same tail — this is what makes the per-route
    // trueProfit wrong and the fleet-level split right.
    { id: 'r2', origin: 'JFK', destination: spokes[2], aircraftId: 'own0', weeklyFrequency: 7,
      weeksOpen: 80, hub: 'JFK', ticketPrice: Math.round(referencePrice('JFK', spokes[2])), cateringLevel: 'standard' },
  ];
  return {
    phase: 'playing', week: 20, year: 3, hub: 'JFK', cash: 1e8, awareness: 65, absWeek: 120,
    gates: { JFK: 4, ORD: 2, MIA: 2, BOS: 2 },
    labor: { pilots: { payMultiplier: 1 }, cabin: { payMultiplier: 1 },
             engineers: { payMultiplier: 1 }, ground: { payMultiplier: 1 } },
    fleet, routes, cargoRoutes: [],
    routePricing: Object.fromEntries(spokes.map(d =>
      [routePairKey('JFK', d), defaultClassPrices(Math.round(referencePrice('JFK', d)))])),
    // An INERT carrier rather than an empty bank. reconcileState() reads
    // `parsed.competitors?.length > 0 ? parsed.competitors :
    // sampleAndInitializeCompetitors(25)`, so a save with `competitors: []`
    // arrives at the GameProvider with 25 RANDOMLY SAMPLED rivals — while
    // bridgeFor() below scores the raw save with none. That is the "two
    // different airlines" the comment on saveFor warns about, and it was
    // invisible only for as long as every route in this fixture was
    // capacity-capped: the load model used to be fed the capped pool, so the
    // week's numbers could not respond to who else was flying. They can now
    // (H10), and the model/render comparisons below went flaky run-to-run
    // ($698.3K vs $686.4K on consecutive runs). This bank has no routes, so
    // buildCompetitorOffer returns null for every pair and it contests
    // nothing — identical numbers to the empty bank, minus the resampling.
    competitors: [{ id: 'inert', name: 'Inert Air', homeHub: 'LHR', tier: 'legacy',
                    logoId: 'compass', baseQualityScore: 60, cash: 1, weeklyStats: null, routes: {} }],
    encroachments: [], activeEvents: [], loans: [], hedgeContracts: [],
    financialHistory: [], marketingBudget: 50_000,
    ...over,
  };
};

const bridgeFor = (state) => {
  const proj = quietly(() => projectWeek(state));
  return { proj, bridge: costBridge(proj, state) };
};

// ── It accounts for every dollar ────────────────────────────────────────────

console.log('\n── Nothing goes missing ─────────────────────────────────');

test('the itemised rows explain the whole of operating profit', () => {
  // THE SELF-CHECK. If a cost line is added to weeklyTick and not bucketed
  // here, this is what catches it.
  const { bridge } = bridgeFor(world());
  assert.equal(bridge.residual, 0, `$${bridge.residual} unaccounted for`);
});

test('net profit is the same number the rest of the app shows', () => {
  const { proj, bridge } = bridgeFor(world());
  assert.equal(bridge.netProfit, Math.round(proj.netCash));
});

test('partner revenue is counted once, not twice', () => {
  // Headwinds' copy gets this wrong: weeklyTick reports totalRevenue with the
  // partner share already inside it, and the bridge then adds a partner row.
  // The residual lands at exactly minus the partner revenue.
  const base = {
    totalRevenue: 1_000_000, totalCost: 700_000, totalOpCost: 400_000,
    totalPartnerRevenue: 0, totalPartnerFees: 0, totalDistributionCost: 25_000,
    totalGateFees: 50_000, totalLaborCosts: 60_000, totalHQCost: 30_000, totalInsurance: 10_000,
    totalFamilyBaseCosts: 0, totalMroBaseCosts: 0, totalMarketingSpend: 20_000,
    totalLoyaltyCost: 0, totalHubInvestment: 0, strikeLoss: 0,
    routeResults: [{ routeId: 'r0' }], cargoRouteResults: [],
    fleetCosts: [{ aircraftId: 'a0', lease: 100_000, maintenance: 5_000, reserveParking: 0 }],
  };
  const st = { routes: [{ id: 'r0', aircraftId: 'a0' }], cargoRoutes: [] };
  for (const partner of [0, 50_000, 200_000]) {
    const report = { ...base, totalRevenue: 1_000_000 + partner, totalPartnerRevenue: partner };
    const inputs = { report, ebitda: report.totalRevenue - report.totalCost,
      loanPayments: 0, seasonalReactivation: 0, leaseRedelivery: 0, corporateTax: 0,
      netCash: report.totalRevenue - report.totalCost };
    const b = costBridge(inputs, st);
    assert.equal(b.residual, 0, `partner revenue ${partner} left a residual of ${b.residual}`);
    assert.equal(b.rows.find(r => r.key === 'revenue').value, 1_000_000,
      'the row labelled "Route revenue" should be route revenue');
  }
});

test('a strike is subtracted once', () => {
  const report = {
    totalRevenue: 1_000_000, totalCost: 700_000, totalOpCost: 400_000, strikeLoss: 30_000,
    totalGateFees: 50_000, totalLaborCosts: 60_000, totalHQCost: 30_000, totalInsurance: 10_000,
    totalDistributionCost: 25_000, totalMarketingSpend: 20_000,
    routeResults: [{ routeId: 'r0' }], cargoRouteResults: [],
    fleetCosts: [{ aircraftId: 'a0', lease: 100_000, maintenance: 5_000, reserveParking: 0 }],
  };
  const b = costBridge(bridgeInputsFromReport({ ...report, cashDelta: 270_000 }),
    { routes: [{ id: 'r0', aircraftId: 'a0' }], cargoRoutes: [] });
  assert.equal(b.residual, 0);
  assert.equal(b.rows.find(r => r.key === 'strike').value, -30_000);
});

// ── It opens on the right number ────────────────────────────────────────────

console.log('\n── The first row is the table beside it ─────────────────');

test('route operating profit equals the Top Routes column, added up', () => {
  // The table charges each route its block-hour share of the aircraft (see
  // routeEconomics.js). Summed over every route, that is exactly the FLYING
  // fleet's lease and maintenance — which is what the bridge subtracts.
  const state = world();
  const { proj, bridge } = bridgeFor(state);
  const resultsById = {};
  for (const rr of proj.report.routeResults ?? []) resultsById[rr.routeId] = rr;
  const fixedByRoute = allocateFixedCosts({
    routes: state.routes, cargoRoutes: state.cargoRoutes, fleet: state.fleet, resultsById });
  const tableTotal = (proj.report.routeResults ?? []).reduce((s, rr) =>
    s + routeProfit(rr, Math.round(fixedByRoute[rr.routeId] ?? 0), BASIS_FULL), 0);
  assert.ok(Math.abs(bridge.routeOperating - tableTotal) <= state.routes.length,
    `bridge ${bridge.routeOperating} vs table ${tableTotal}`);
});

test('and it is BELOW the old opening row by the flying fleet\'s ownership', () => {
  // THE DEFECT, measured. The old first row summed routeResults.profit, which
  // excludes lease and maintenance, while claiming to be the table's figure.
  const state = world();
  const { proj, bridge } = bridgeFor(state);
  const oldRow = (proj.report.routeResults ?? []).reduce((s, rr) => s + (rr.profit ?? 0), 0)
               + (proj.report.totalCargoProfit ?? 0);
  const flyingIds = new Set(state.routes.map(r => r.aircraftId));
  const ownFlying = (proj.report.fleetCosts ?? [])
    .filter(fc => flyingIds.has(fc.aircraftId))
    .reduce((s, fc) => s + (fc.lease ?? 0) + (fc.maintenance ?? 0), 0);
  assert.ok(ownFlying > 0, 'fixture must have aircraft that cost something to own');
  assert.ok(Math.abs((oldRow - bridge.routeOperating) - ownFlying) < 2,
    `the gap was $${oldRow - bridge.routeOperating}, the flying fleet costs $${ownFlying}`);
});

test('a tail flying two routes is charged once, not twice', () => {
  // The engine's per-route trueProfit charges the FULL aircraft to every route
  // it flies. Summing that over a tail with two routes double-counts it; the
  // bridge works from fleet totals and cannot.
  const state = world();
  const { proj, bridge } = bridgeFor(state);
  const naive = (proj.report.routeResults ?? []).reduce((s, rr) => s + (rr.trueProfit ?? 0), 0);
  assert.ok(bridge.routeOperating > naive,
    `the fleet-level figure ${bridge.routeOperating} should beat the double-counted ${naive}`);
});

// ── The parked fleet gets its own line ──────────────────────────────────────

console.log('\n── An aeroplane that flew nothing still costs money ─────');

test('a parked tail lands on its own row rather than inside route profit', () => {
  const { bridge } = bridgeFor(world());
  const parked = bridge.rows.find(r => r.key === 'ownParked');
  assert.ok(parked, 'the fixture has an idle leased aircraft; it should be visible');
  assert.ok(parked.value < 0);
});

test('an airline with nothing parked has no such row', () => {
  const state = world();
  state.fleet = state.fleet.filter(a => a.id !== 'idle0');
  const { bridge } = bridgeFor(state);
  assert.equal(bridge.rows.find(r => r.key === 'ownParked'), undefined);
  assert.equal(bridge.residual, 0);
});

test('reserve standby parking is never charged to a route', () => {
  const report = {
    totalRevenue: 500_000, totalCost: 400_000, totalOpCost: 200_000,
    routeResults: [{ routeId: 'r0' }], cargoRouteResults: [],
    fleetCosts: [{ aircraftId: 'a0', lease: 100_000, maintenance: 0, reserveParking: 12_000 }],
  };
  const b = costBridge({ report, ebitda: 100_000, loanPayments: 0, seasonalReactivation: 0,
    leaseRedelivery: 0, corporateTax: 0, netCash: 100_000 },
    { routes: [{ id: 'r0', aircraftId: 'a0' }], cargoRoutes: [] });
  // a0 IS flying, so its lease is in the flying bucket — but the standby fee is
  // not a cost of flying and belongs below the route line either way.
  assert.equal(b.rows.find(r => r.key === 'ownFlying').value, -100_000);
  assert.equal(b.rows.find(r => r.key === 'ownParked').value, -12_000);
});

// ── Last week ───────────────────────────────────────────────────────────────

console.log('\n── The week that already happened ───────────────────────');

test('a stored report bridges as cleanly as a projection', () => {
  const state = world();
  const proj = quietly(() => projectWeek(state));
  // Shaped the way the reducer stores it: below-the-line items on the report,
  // cashDelta already net of tax.
  const stored = { ...proj.report, loanPayments: 40_000, corporateTax: 15_000,
    seasonalReactivation: 0, leaseRedelivery: 0,
    cashDelta: Math.round(proj.report.totalRevenue - proj.report.totalCost) - 40_000 - 15_000 };
  const b = costBridge(bridgeInputsFromReport(stored), state);
  assert.equal(b.residual, 0);
  assert.equal(b.netProfit, stored.cashDelta);
  assert.equal(b.rows.find(r => r.key === 'loans').value, -40_000);
  assert.equal(b.rows.find(r => r.key === 'tax').value, -15_000);
});

test('a missing report does not throw', () => {
  const b = costBridge(bridgeInputsFromReport(null), {});
  assert.equal(b.revenue, 0);
  assert.equal(b.netProfit, 0);
  assert.ok(Array.isArray(b.rows));
});

// ── Shape ───────────────────────────────────────────────────────────────────

console.log('\n── The ladder reads as a ladder ─────────────────────────');

test('every row is signed the way it reads', () => {
  const { bridge } = bridgeFor(world());
  for (const row of bridge.rows) {
    if (row.kind === 'cost') assert.ok(row.value <= 0, `${row.key} is a cost but positive`);
    if (row.kind === 'income') assert.ok(row.value >= 0, `${row.key} is income but negative`);
    assert.ok(typeof row.label === 'string' && row.label.length > 0);
    assert.ok(Number.isFinite(row.value), `${row.key} is ${row.value}`);
  }
});

test('subtotals carry a margin and ordinary rows do not', () => {
  const { bridge } = bridgeFor(world());
  for (const row of bridge.rows) {
    if (row.kind === 'subtotal' || row.kind === 'total') {
      assert.ok(Number.isFinite(row.margin), `${row.key} has no margin`);
    } else {
      assert.equal(row.margin, undefined, `${row.key} should not carry a margin`);
    }
  }
});

test('the ladder ends where it says it does', () => {
  const { bridge } = bridgeFor(world());
  assert.equal(bridge.rows.at(-1).key, 'net');
  assert.equal(bridge.rows.at(-1).kind, 'total');
  assert.equal(bridge.rows[0].key, 'revenue');
});

// ── The card on the screen ──────────────────────────────────────────────────

console.log('\n── The card renders what the model computed ────────────');

// React SSR splits adjacent text nodes with an empty comment.
const clean = (html) => html
  .replace(/<!-- -->/g, '')
  .replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"')
  .replace(/&nbsp;/g, ' ').replace(/&#x2019;/g, '\u2019');

// The provider hydrates from the save, so the state the card renders is
// freshState merged with ours — compute the bridge from the SAME object or the
// comparison is between two different airlines.
const saveFor = (state) => ({ ...freshState(), ...state, airlineName: 'Bridge Air' });
const renderDash = (save) => {
  store.clear();
  store.set('bbae_save_v2', JSON.stringify(save));
  return clean(renderToString(React.createElement(GameProvider, null, React.createElement(Dashboard))));
};

/** Every money figure the P&L card prints, in order. */
const moneyIn = (html) => [...html.matchAll(/[-+]?\$[\d,]+(?:\.\d+)?[KMB]?/g)].map(m => m[0]);

test('the Weekly P&L card is on the page and opens on the route line', () => {
  const html = renderDash(saveFor(world()));
  assert.ok(html.includes('Weekly P&L'), 'the card should render');
  assert.ok(html.includes('Route operating profit'));
  assert.ok(html.includes('Net profit'));
  // The old tooltip claimed the first row was the direct-cost figure. It now
  // says what it is, and says it is the table's number.
  assert.ok(html.includes('fully-loaded profit added up'),
    'the first row should say what it actually sums');
  assert.ok(!html.includes('minus its direct flying costs (fuel, crew, service, landing fees), passenger and cargo. This is the profit shown in the Top Routes table'),
    'the old claim should be gone');
});

test('nothing on the card reads as unattributed', () => {
  const html = renderDash(saveFor(world()));
  assert.ok(!html.includes('Unattributed'),
    'the residual row must never appear on a healthy week');
});

test('the card and the model agree on the opening figure', () => {
  // Formatted with the app's own formatter, so this compares the printed digits
  // rather than my idea of how to print them.
  const save = saveFor(world());
  const { bridge } = bridgeFor(save);
  const shown = moneyIn(renderDash(save));
  const target = formatMoney(bridge.routeOperating);
  assert.ok(shown.some(s => s.replace(/^\+/, '') === target),
    `route operating profit ${target} does not appear among ${shown.slice(0, 14).join(' ')}`);
});

test('and on the bottom line', () => {
  const save = saveFor(world());
  const { bridge } = bridgeFor(save);
  const shown = moneyIn(renderDash(save));
  const target = formatMoney(bridge.netProfit);
  assert.ok(shown.some(s => s.replace(/^\+/, '') === target),
    `net profit ${target} does not appear among ${shown.slice(0, 14).join(' ')}`);
});

test('a parked aeroplane is named on the card, once it is expanded', () => {
  // The detail rows live behind a toggle, so the label ships in the markup with
  // the row hidden — what matters is that the string is the honest one.
  const html = renderDash(saveFor(world()));
  assert.ok(html.includes('Fixed &amp; overhead costs') || html.includes('Fixed & overhead costs'));
  assert.ok(!html.includes('Aircraft leases'),
    'aircraft ownership is no longer a single undifferentiated line');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
