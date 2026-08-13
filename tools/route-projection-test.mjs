// ─────────────────────────────────────────────────────────────────────────────
// THE ROUTE-LAUNCH FORECAST MUST FORECAST A WEEK THAT CAN ACTUALLY HAPPEN.
//
// Both route-launch forms used to answer "what will this route carry?" with a
// bare `simulateRoute(spec, aircraft, gameDate)` and a null demandOverride —
// which asks the demand model what this aircraft would carry ALONE in this
// market. On a pair the player already flies, that is the whole O&D pool, handed
// out a second time. weeklyTick pools every tail on a pair into ONE offer and
// splits the result by seat share (utils/simulation.js, the multi-aircraft
// pre-pass), so the two answered the same question differently. Measured on the
// fixtures below, against the REAL weeklyTick, before the fix:
//
//   DCA–GSP  A320neo 10/wk  2→3 tails    forecast +$248,645   tick  +$88,580
//   DCA–GSP  A320neo 14/wk  2→3 tails    forecast +$348,180   tick  −$87,985
//   IAD–HVN  A320neo 12/wk  2→3 tails    forecast +$273,712   tick   −$6,389
//
// It pinned at the engine's 87.3% load ceiling in every saturated case and never
// signalled saturation — and it was accurate on an unserved pair, which is
// exactly what made it trustworthy right up until it wasn't. The launch fee is
// not refundable.
//
// Compounding it on the same call sites: simulateRoute reads `route.brandReach
// ?? 1`, so an offer that omits brand reach is scored as an ESTABLISHED carrier.
// No preview attached it. A week-one airline (real reach ≈ 0.45) was forecast at
// household-name market share, while the market-SHARE panel two inches away on
// the same screen already applied stateBrandReach.
//
// Both call sites now go through models/pairShare.js → projectRouteAddition().
// This suite pins that projection against what weeklyTick actually books for the
// very route being previewed, and then SSR-renders the real <RoutePlanner/> to
// prove the COMPONENT agrees — a helper tested in isolation can pass while the
// component that calls it does not.
//
//   node --import ./tools/_register-loader.mjs tools/route-projection-test.mjs
// ─────────────────────────────────────────────────────────────────────────────

import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'react-dom/server';
import {
  weeklyTick, routePairKey, currentGameDate, buildEventDemandModel,
  simulateRoute, rivalSpecsFor, stateLoungeFields, fleetAvgUtilization,
  defaultClassPrices, defaultConfig, stateBrandReach,
} from '../src/utils/simulation.js';
import { weeklyLoadJitter, referencePrice } from '../src/utils/market.js';
import { getAircraftType } from '../src/data/aircraft.js';
import { projectRouteAddition, pairMarketShare } from '../src/models/pairShare.js';

// Minimal browser shims for the SSR section (effects don't run, but the store
// reads localStorage on init).
const lsStore = new Map();
globalThis.window = globalThis.window ?? {};
globalThis.localStorage = {
  getItem: (k) => (lsStore.has(k) ? lsStore.get(k) : null),
  setItem: (k, v) => lsStore.set(k, String(v)),
  removeItem: (k) => lsStore.delete(k),
  clear: () => lsStore.clear(),
};

const { gameReducer, freshState, GameProvider } = await import('../src/store/GameContext.jsx');
const RoutePlanner = (await import('../src/components/RoutePlanner.jsx')).default;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${(e.stack || e.message).split('\n').slice(0, 6).join('\n      ')}`); failed++; }
}

const realRandom = Math.random;
/** Hold every probability gate shut so nothing but the deterministic engine runs. */
const quiet = (fn) => {
  const p = Math.random;
  Math.random = () => 0.9999999;
  try { return fn(); } finally { Math.random = p; }
};

const money = (v) => (v < 0 ? '-' : '+') + '$' + Math.abs(Math.round(v)).toLocaleString();
const pct   = (v) => (v * 100).toFixed(1) + '%';

/**
 * The absolute week whose load jitter is nearest 1 for this pair.
 *
 * weeklyTick multiplies each pair's demand by weeklyLoadJitter(pair, absWeek),
 * a deterministic ±2.5% wobble; a projection has no week to key it on and
 * deliberately projects the expected week. Pinning the fixture to a calm week is
 * what keeps that honest ±2.5% out of the assertions — without it the tolerances
 * would have to be wide enough to hide a real regression.
 */
function calmWeek(pairKey) {
  let best = 0, bestErr = Infinity;
  for (let w = 0; w < 4000; w++) {
    const e = Math.abs(weeklyLoadJitter(pairKey, w) - 1);
    if (e < bestErr) { bestErr = e; best = w; }
  }
  return best;
}

const TYPE_ID = 'a320neo';
const TYPE = getAircraftType(TYPE_ID);
assert.ok(TYPE, 'a320neo missing from the aircraft data — re-point this fixture');

/**
 * An airline with `tails` A320neos on one pair out of `hub`, all mature and
 * owned, priced at the market reference fare. Every aircraft carries the
 * all-economy default layout so the planner's synthetic preview airframe is the
 * same aeroplane the tick flies.
 */
function airline({ hub, dest, tails, freq, weeksOpen = 20, awareness = 70 }) {
  let s = quiet(() => gameReducer(freshState(),
    { type: 'START_GAME', airlineName: 'Probe Air', hub, enableObjectives: false }));
  s = { ...s, cash: 5e9 };
  for (let i = 0; i < 6; i++) s = gameReducer(s, { type: 'ADD_GATE', airportCode: hub });
  for (let i = 0; i < 6; i++) s = gameReducer(s, { type: 'ADD_GATE', airportCode: dest });
  const fare = Math.round(referencePrice(hub, dest));
  for (let i = 0; i < tails; i++) {
    s = gameReducer(s, { type: 'BUY_AIRCRAFT', typeId: TYPE_ID });
    const ac = s.fleet[s.fleet.length - 1].id;
    s = gameReducer(s, { type: 'ADD_ROUTE', aircraftId: ac, origin: hub, destination: dest,
      weeklyFrequency: freq, ticketPrice: fare });
  }
  // A spare tail, parked, so the projection always has a real airframe to fly
  // and the fixture never has to invent one the fleet does not contain.
  s = gameReducer(s, { type: 'BUY_AIRCRAFT', typeId: TYPE_ID });
  const spare = s.fleet[s.fleet.length - 1].id;
  return {
    ...s,
    awareness,
    // weeklyTick reads state.gameDate (the reducer attaches it in tickPrep) and
    // falls back to month 6. Pin it so the tick and the projection are looking at
    // the same month — seasonality alone is worth ~40% of the demand pool, which
    // would swamp everything this suite is trying to measure.
    gameDate: currentGameDate(s),
    absWeek: calmWeek(routePairKey(hub, dest)),
    spareId: spare,
    fare,
    fleet: s.fleet.map(a => ({ ...a, ageWeeks: 0, ownershipType: 'owned',
      config: defaultConfig(TYPE.seats) })),
    routes: s.routes.map(r => ({ ...r, weeksOpen })),
  };
}

/** Open the spare tail on the same pair, at `weeksOpen` weeks of maturity. */
function withAddedTail(s, hub, dest, freq, weeksOpen) {
  const t = quiet(() => gameReducer(s, { type: 'ADD_ROUTE', aircraftId: s.spareId,
    origin: hub, destination: dest, weeklyFrequency: freq, ticketPrice: s.fare }));
  const added = t.routes[t.routes.length - 1];
  return {
    state: {
      ...t,
      fleet: t.fleet.map(a => ({ ...a, config: defaultConfig(TYPE.seats) })),
      routes: t.routes.map(r => (r.id === added.id ? { ...r, weeksOpen } : r)),
    },
    addedId: added.id,
  };
}

/** What weeklyTick books for one route: O&D only, so it is the same quantity
 *  simulateRoute's `revenue` / `profit` describe (connecting feed excluded). */
function tickRoute(state, routeId) {
  const rep = quiet(() => weeklyTick(state));
  const rr = (rep.routeResults ?? []).find(r => r.routeId === routeId);
  if (!rr) return null;
  return {
    passengers: rr.passengers ?? 0,
    loadFactor: rr.loadFactor ?? 0,
    revenue: Math.round(rr.revenue - (rr.connecting?.totalRevenue ?? 0)),
    profit: Math.round(rr.revenue - (rr.connecting?.totalRevenue ?? 0) - rr.totalOpCost),
  };
}

/** Pair-wide O&D operating profit — what the player's bank account sees. */
function tickPair(state, hub, dest) {
  const key = routePairKey(hub, dest);
  const rep = quiet(() => weeklyTick(state));
  let profit = 0, pax = 0;
  for (const rr of rep.routeResults ?? []) {
    const route = state.routes.find(r => r.id === rr.routeId);
    if (!route || routePairKey(route.origin, route.destination) !== key) continue;
    profit += rr.revenue - (rr.connecting?.totalRevenue ?? 0) - rr.totalOpCost;
    pax += rr.passengers ?? 0;
  }
  return { profit: Math.round(profit), pax };
}

/** The forecast EXACTLY as the two call sites built it before this fix — a bare
 *  simulateRoute on a synthetic route, no pooling and no brandReach. Kept here
 *  as the control: every assertion below has to fail against it. */
function bareForecast(state, origin, dest, freq, price) {
  const ac = { id: '__bare__', typeId: TYPE_ID, ageWeeks: 0, config: defaultConfig(TYPE.seats) };
  return simulateRoute(
    { id: '__bare__', origin, destination: dest, aircraftId: '__bare__', weeklyFrequency: freq,
      ticketPrice: price, classPrices: defaultClassPrices(price), hub: state.hub, weeksOpen: 20,
      ...stateLoungeFields(state, origin, dest) },
    ac, currentGameDate(state),
    state.labor ?? null, 1.0, null, rivalSpecsFor(state, origin, dest),
    fleetAvgUtilization(state.fleet ?? [], [...(state.routes ?? []), ...(state.cargoRoutes ?? [])]),
    state.satisfaction ?? null, buildEventDemandModel(state.activeEvents).multFor(origin, dest),
    state.ancillaries ?? null, state.competitors ?? [],
  );
}

function project(state, origin, dest, freq) {
  const aircraft = (state.fleet ?? []).find(a => a.id === state.spareId);
  return projectRouteAddition(state, {
    origin, destination: dest, aircraft, weeklyFrequency: freq,
    ticketPrice: state.fare, classPrices: defaultClassPrices(state.fare),
    gameDate: currentGameDate(state),
    eventDemandMult: buildEventDemandModel(state.activeEvents).multFor(origin, dest),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. The projection is the week the tick delivers, on every saturation regime
// ─────────────────────────────────────────────────────────────────────────────

console.log('\nRoute-launch projection ↔ weeklyTick agreement\n');
console.log('── 1. The forecast for a route IS what the tick books for it ──────────────');

const SCENARIOS = [
  { label: 'DCA–GSP  10/wk  unserved pair (0 → 1 tail)', hub: 'DCA', dest: 'GSP', tails: 0, freq: 10 },
  { label: 'DCA–GSP  10/wk  1 → 2 tails',                hub: 'DCA', dest: 'GSP', tails: 1, freq: 10 },
  { label: 'DCA–GSP  10/wk  2 → 3 tails  (SATURATED)',   hub: 'DCA', dest: 'GSP', tails: 2, freq: 10 },
  { label: 'DCA–GSP  14/wk  2 → 3 tails  (SATURATED)',   hub: 'DCA', dest: 'GSP', tails: 2, freq: 14 },
  { label: 'IAD–HVN  12/wk  2 → 3 tails  (SATURATED)',   hub: 'IAD', dest: 'HVN', tails: 2, freq: 12 },
];

const rows = [];
for (const sc of SCENARIOS) {
  const before = airline(sc);
  const proj = project(before, sc.hub, sc.dest, sc.freq);
  const { state: after, addedId } = withAddedTail(before, sc.hub, sc.dest, sc.freq, 20);
  const tick = tickRoute(after, addedId);
  const bare = bareForecast(before, sc.hub, sc.dest, sc.freq, before.fare);
  const pairBefore = sc.tails > 0 ? tickPair(before, sc.hub, sc.dest) : { profit: 0, pax: 0 };
  const pairAfter  = tickPair(after, sc.hub, sc.dest);
  rows.push({ sc, proj, tick, bare, marginal: pairAfter.profit - pairBefore.profit,
              pairPax: [pairBefore.pax, pairAfter.pax] });
}

for (const r of rows) {
  console.log(`\n  ${r.sc.label}`);
  console.log(`      tick books for the new tail : ${String(r.tick.passengers).padStart(5)} pax  LF ${pct(r.tick.loadFactor).padStart(6)}  op ${money(r.tick.profit).padStart(11)}`);
  console.log(`      projection (this fix)       : ${String(r.proj.mature.passengers).padStart(5)} pax  LF ${pct(r.proj.mature.loadFactor).padStart(6)}  op ${money(r.proj.mature.profit).padStart(11)}`);
  console.log(`      bare simulateRoute (before) : ${String(r.bare.passengers).padStart(5)} pax  LF ${pct(r.bare.loadFactor).padStart(6)}  op ${money(r.bare.profit).padStart(11)}`);
  console.log(`      pair pax ${r.pairPax[0]} → ${r.pairPax[1]}, pair marginal op profit ${money(r.marginal)}`);
}
console.log('');

for (const r of rows) {
  // Exact, not a band — with ONE passenger of slack, and not a passenger more.
  //
  // Every input to both sides is deterministic here (the fixture pins the calm
  // week and the game month) except one, and it cannot be pinned: the
  // projection deliberately forecasts the EXPECTED week, omitting the route's
  // absWeek so simulateRoute takes weeklyLoadJitter = 1 exactly, while the tick
  // must roll a real week. weeklyLoadJitter can never RETURN exactly 1 — it is
  // `1 − J + 2J·(h / 0xffffffff)` over a 32-bit hash, and h / 0xffffffff is
  // never exactly 0.5 — so calmWeek can only find the closest week there is.
  // For DCA–GSP that is week 1730 at 1.0000032: six thousandths of a passenger
  // on this fixture, invisible unless the pre-rounding demand sits within it of
  // a .5 boundary. On the unserved-pair scenario it does, so the tick rounds to
  // 1834 where the projection rounds to 1833. Measured across the eight calmest
  // DCA–GSP weeks (1730, 1018, 3604, 2190, 1086, 3812, 1461, 1421) six agree
  // exactly and two — 1730 and 3812 — sit one passenger apart, which is the
  // signature of a rounding boundary rather than of a model disagreement. The
  // same 1833/1834 (and the same −$197 below) fail on the pre-metro-rework tree
  // at ~/w3/head/tw, so this is not something the metro pooling introduced.
  //
  // One passenger is the smallest band the two paths can share. It hides
  // nothing: the bare-call control in section 2 is out by hundreds, and the
  // ±2.5% the jitter is capable of would be ~46 passengers here.
  test(`${r.sc.label} — projected passengers are the passengers the tick books`, () => {
    assert.ok(Math.abs(r.proj.mature.passengers - r.tick.passengers) <= 1,
      `forecast ${r.proj.mature.passengers} pax vs ${r.tick.passengers} booked (off by `
      + `${r.proj.mature.passengers - r.tick.passengers}). The preview and the tick are answering `
      + 'different questions — see models/pairShare.js.');
  });

  test(`${r.sc.label} — projected operating profit is the profit the tick books`, () => {
    // $2 of arithmetic slack, plus whatever that one rounding-boundary
    // passenger is worth at this route's realised yield — carrying a passenger
    // the other side did not carry has to be allowed to move the money by
    // exactly one fare and by nothing else.
    const yieldPerPax = r.tick.passengers > 0 ? r.tick.revenue / r.tick.passengers : 0;
    const band = 2 + Math.abs(r.proj.mature.passengers - r.tick.passengers) * yieldPerPax;
    assert.ok(Math.abs(r.proj.mature.profit - r.tick.profit) <= band,
      `forecast ${money(r.proj.mature.profit)} vs ${money(r.tick.profit)} booked `
      + `(off by ${money(r.proj.mature.profit - r.tick.profit)}, band ${money(Math.round(band))}).`);
  });
}

console.log('\n── 2. The control: the OLD bare call fails these same assertions ──────────');
// Without this the suite proves nothing — a projection that happened to equal a
// bare simulateRoute would pass section 1 on an unserved pair and be no fix at all.
test('on an UNSERVED pair the bare call was already right (that is what made it trusted)', () => {
  const r = rows[0];
  assert.ok(Math.abs(r.bare.passengers - r.tick.passengers) <= Math.max(4, r.tick.passengers * 0.01),
    `bare ${r.bare.passengers} vs tick ${r.tick.passengers} — if these differ the fixture is not `
    + 'reproducing the reported behaviour and the rest of this suite is measuring something else');
});

test('on a SATURATED pair the bare call hands the newcomer the whole pool', () => {
  const saturated = rows.filter(r => r.sc.tails >= 2);
  assert.ok(saturated.length >= 3, 'need the saturated scenarios in the table');
  for (const r of saturated) {
    assert.ok(r.bare.passengers > r.tick.passengers * 1.15,
      `${r.sc.label}: bare forecast ${r.bare.passengers} pax vs ${r.tick.passengers} booked — `
      + 'this fixture is not saturated, so it cannot demonstrate the defect');
    assert.ok(Math.abs(r.bare.profit - r.tick.profit) > 100_000,
      `${r.sc.label}: the bare forecast is only ${money(r.bare.profit - r.tick.profit)} out — `
      + 'too small to be the reported bug');
  }
});

test('the bare call pins at the engine load ceiling on every saturated pair', () => {
  for (const r of rows.filter(r => r.sc.tails >= 2)) {
    assert.ok(r.bare.loadFactor > 0.86,
      `${r.sc.label}: bare LF ${pct(r.bare.loadFactor)} — the reported symptom is a forecast `
      + 'pinned at ~87.3% with no hint of saturation');
    assert.ok(r.proj.mature.loadFactor < r.bare.loadFactor - 0.05,
      `${r.sc.label}: the projection is still showing ${pct(r.proj.mature.loadFactor)} — it has `
      + 'not felt the pair filling up');
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Lane maturity: a new pair ramps, an established one does not re-ramp
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n── 3. Lane maturity ──────────────────────────────────────────────────────');

test('a genuinely new pair is forecast BELOW its mature demand in week 0', () => {
  const s = airline({ hub: 'DCA', dest: 'GSP', tails: 0, freq: 10 });
  const p = project(s, 'DCA', 'GSP', 10);
  assert.ok(p.launch.loadFactor < p.mature.loadFactor - 0.005,
    `launch LF ${pct(p.launch.loadFactor)} vs mature ${pct(p.mature.loadFactor)} — a brand-new `
    + 'lane opens below its mature demand and climbs for 16 weeks (routeMaturityFactor)');
  assert.equal(p.shared, false);
  assert.equal(p.pairRouteCount, 1);
});

test('the week-0 forecast for a new pair is the week the tick books at week 0', () => {
  const s = airline({ hub: 'DCA', dest: 'GSP', tails: 0, freq: 10 });
  const p = project(s, 'DCA', 'GSP', 10);
  const { state: after, addedId } = withAddedTail(s, 'DCA', 'GSP', 10, 0);
  const tick = tickRoute(after, addedId);
  assert.ok(Math.abs(p.launch.passengers - tick.passengers) <= Math.max(4, tick.passengers * 0.01),
    `week-0 forecast ${p.launch.passengers} pax vs ${tick.passengers} booked — the launch figure `
    + 'is the one on the confirm panel next to a non-refundable launch fee');
});

test('joining a pair you already fly does NOT re-ramp it', () => {
  const s = airline({ hub: 'DCA', dest: 'GSP', tails: 2, freq: 10 });
  const p = project(s, 'DCA', 'GSP', 10);
  assert.equal(p.shared, true);
  assert.equal(p.pairRouteCount, 3);
  assert.equal(p.launch.passengers, p.mature.passengers,
    'the market already knows this service — an added tail gets a mature slice on day one');
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. brandReach: a week-one airline is not an established one
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n── 4. Brand reach on a week-one airline ──────────────────────────────────');

const WEEK_ONE = { hub: 'AUS', dest: 'MSY', tails: 0, freq: 14, awareness: 5 };
const weekOne = airline(WEEK_ONE);
const weekOneReach = stateBrandReach(weekOne, 0, false);
const weekOneProj = project(weekOne, 'AUS', 'MSY', 14);
const weekOneAdd  = withAddedTail(weekOne, 'AUS', 'MSY', 14, 20);
const weekOneTick = tickRoute(weekOneAdd.state, weekOneAdd.addedId);
const weekOneBare = bareForecast(weekOne, 'AUS', 'MSY', 14, weekOne.fare);

console.log(`      state brand reach           : ${weekOneReach.toFixed(4)}  (1.0 = established-carrier parity)`);
console.log(`      tick books                  : ${weekOneTick.passengers} pax  LF ${pct(weekOneTick.loadFactor)}  op ${money(weekOneTick.profit)}`);
console.log(`      projection (this fix)       : ${weekOneProj.mature.passengers} pax  LF ${pct(weekOneProj.mature.loadFactor)}  op ${money(weekOneProj.mature.profit)}`);
console.log(`      bare simulateRoute (before) : ${weekOneBare.passengers} pax  LF ${pct(weekOneBare.loadFactor)}  op ${money(weekOneBare.profit)}\n`);

test('the fixture really is a week-one airline (brand reach well under parity)', () => {
  assert.ok(weekOneReach < 0.7,
    `brand reach ${weekOneReach.toFixed(3)} — raise the fixture's youth or this case is vacuous`);
});

test('the un-braded bare forecast overstates a week-one airline by a wide margin', () => {
  assert.ok(weekOneBare.passengers > weekOneTick.passengers * 1.2,
    `bare ${weekOneBare.passengers} pax vs ${weekOneTick.passengers} booked — the reported symptom `
    + 'is a new airline previewing the market share of an established one');
});

test('the projection carries brandReach and lands on the week the tick books', () => {
  // A band, not an equality, and for a stated reason: reputation feeds brand
  // reach, and one of reputation's inputs is the size of the network — so the
  // route the player is about to open raises the very brand reach it will fly
  // under. A forecast cannot know that without opening the route. It is worth
  // ~0.3% of demand here (0.4502 → 0.4515) and it is the ONLY term left.
  const paxDrift = Math.abs(weekOneProj.mature.passengers - weekOneTick.passengers);
  assert.ok(paxDrift <= Math.max(2, weekOneTick.passengers * 0.01),
    `forecast ${weekOneProj.mature.passengers} pax vs ${weekOneTick.passengers} booked `
    + `(off by ${paxDrift})`);
  assert.ok(Math.abs(weekOneProj.mature.profit - weekOneTick.profit) <= Math.max(2000, Math.abs(weekOneTick.profit) * 0.03),
    `forecast ${money(weekOneProj.mature.profit)} vs ${money(weekOneTick.profit)} booked`);
});

test('brandReach is the WHOLE gap — injecting it alone into the bare call closes it', () => {
  // Not an assertion about pairShare.js at all: it isolates the mechanism, so a
  // future regression that fixes the pax count by some other route is still
  // caught by section 1 rather than silently accepted here.
  const ac = { id: '__bare__', typeId: TYPE_ID, ageWeeks: 0, config: defaultConfig(TYPE.seats) };
  const branded = simulateRoute(
    { id: '__bare__', origin: 'AUS', destination: 'MSY', aircraftId: '__bare__', weeklyFrequency: 14,
      ticketPrice: weekOne.fare, classPrices: defaultClassPrices(weekOne.fare), hub: weekOne.hub,
      weeksOpen: 20, brandReach: weekOneReach, ...stateLoungeFields(weekOne, 'AUS', 'MSY') },
    ac, currentGameDate(weekOne),
    weekOne.labor ?? null, 1.0, null, rivalSpecsFor(weekOne, 'AUS', 'MSY'),
    fleetAvgUtilization(weekOne.fleet ?? [], weekOne.routes ?? []),
    weekOne.satisfaction ?? null, buildEventDemandModel(weekOne.activeEvents).multFor('AUS', 'MSY'),
    weekOne.ancillaries ?? null, weekOne.competitors ?? [],
  );
  assert.ok(Math.abs(branded.passengers - weekOneTick.passengers) <= Math.max(4, weekOneTick.passengers * 0.02),
    `brandReach alone leaves ${branded.passengers} vs ${weekOneTick.passengers} — something else `
    + 'is also missing from the preview offer');
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. pairMarketShare's own contract
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n── 5. pairMarketShare ────────────────────────────────────────────────────');

test('a pair the player flies is not reported as absent from its own market', () => {
  // The hydrated-`stops` trap: every single-leg route gets stops:[o,d] on the way
  // through the tick, so a `!r.stops?.length` guard would filter out every real
  // route and hand back an empty pair.
  const s = airline({ hub: 'DCA', dest: 'GSP', tails: 2, freq: 10 });
  const hydrated = { ...s, routes: s.routes.map(r => ({ ...r, stops: [r.origin, r.destination] })) };
  const share = pairMarketShare(hydrated, 'DCA', 'GSP', { gameDate: currentGameDate(s) });
  assert.ok(share.playerResult, 'the player vanished from a pair they fly with two aircraft');
  assert.ok(share.playerShare > 0);
});

test('the pooled offer carries brand, price-sensitivity and campaign terms', () => {
  const s = airline({ hub: 'DCA', dest: 'GSP', tails: 2, freq: 10, awareness: 5 });
  const share = pairMarketShare(s, 'DCA', 'GSP', { gameDate: currentGameDate(s) });
  const offer = share.offers.find(o => o.airlineId === 'player');
  assert.ok(offer, 'no player offer built');
  assert.ok(offer.brandReach != null && offer.brandReach < 1,
    `brandReach ${offer.brandReach} — an omitted brandReach is scored as parity, so a week-one `
    + 'airline previews the share of an established carrier');
  assert.ok(offer.priceSensitivityReduction != null, 'priceSensitivityReduction missing');
  assert.ok(offer.marketingBoost != null, 'marketingBoost missing');
  assert.ok(offer.loungeAppeal != null, 'loungeAppeal missing');
});

test('editing a route previews against its siblings, not against its own old self', () => {
  const s = airline({ hub: 'DCA', dest: 'GSP', tails: 2, freq: 10 });
  const victim = s.routes[0];
  const aircraft = s.fleet.find(a => a.id === victim.aircraftId);
  const p = projectRouteAddition(s, {
    origin: 'DCA', destination: 'GSP', aircraft, weeklyFrequency: 10,
    ticketPrice: s.fare, replacesRouteId: victim.id,
    gameDate: currentGameDate(s),
  });
  assert.equal(p.pairRouteCount, 2,
    'the edited route is joining the pair a third time — it is competing with the version '
    + 'it is replacing');
});

test('a multi-stop route on the same endpoints does not join the pair offer', () => {
  const s = airline({ hub: 'DCA', dest: 'GSP', tails: 1, freq: 10 });
  const tag = { id: 'tag1', origin: 'DCA', destination: 'GSP', stops: ['DCA', 'CLT', 'GSP'],
                aircraftId: s.spareId, weeklyFrequency: 4, weeksOpen: 20, hub: 'DCA' };
  const withTag = { ...s, routes: [...s.routes, tag] };
  const share = pairMarketShare(withTag, 'DCA', 'GSP', { gameDate: currentGameDate(s) });
  const offer = share.offers.find(o => o.airlineId === 'player');
  assert.equal(offer.weeklyFrequency, 10,
    'a tag route self-contains its O&D split (simulateTagRoute) — folding it into the pair '
    + 'offer double-counts its seats');
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. The COMPONENT agrees — SSR-render the real RoutePlanner
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n── 6. The real <RoutePlanner/>, server-rendered ───────────────────────────');

// RoutePlanner takes no props: origin, destination, type and frequency are local
// useState. renderToString runs no effects and fires no onChange, so the only way
// to render the planner as the player had it is to substitute the initial values
// of those slots — done by wrapping React's hook dispatcher, so the component
// under test is the real, unmodified module. (Same harness as
// tools/route-planner-render-test.mjs; the slot assertion below is what stops it
// silently rendering the empty-state path if that state block is reordered.)
const RCD = React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher;
assert.ok(RCD, 'React 18 hook dispatcher not reachable — this harness needs updating');

let seed = null, lastSeed = null;
let rawDispatcher = RCD.current, liveDispatcher = null;
function wrapDispatcher(d) {
  if (!d) return d;
  const w = Object.create(Object.getPrototypeOf(d));
  Object.assign(w, d);
  w.useState = function (initial) {
    if (seed) {
      const i = seed.i++;
      if (i < seed.slots.length) {
        seed.seen[i] = typeof initial === 'function' ? initial() : initial;
        const slot = seed.slots[i];
        if (slot) return d.useState(slot.value);
      }
      if (seed.i >= seed.slots.length) seed = null;
    }
    return d.useState(initial);
  };
  return w;
}
Object.defineProperty(RCD, 'current', {
  configurable: true,
  get() { return liveDispatcher; },
  set(v) { rawDispatcher = v; liveDispatcher = wrapDispatcher(v); },
});
RCD.current = rawDispatcher;

function Seed({ slots, children }) { seed = { i: 0, slots, seen: [] }; lastSeed = seed; return children; }

// RoutePlanner's leading state block, in source order.
const SLOT_NAMES = ['mode', 'origin', 'dest', 'selectedTypeId', 'frequency'];
const EXPECTED_INITIALS = ['passenger', '', '', '', 7];

function renderPlanner(save, { origin, dest, typeId, frequency }) {
  lsStore.set('bbae_save_v2', JSON.stringify(save));
  const slots = [null, { value: origin }, { value: dest }, { value: typeId }, { value: frequency }];
  return renderToString(
    React.createElement(GameProvider, null,
      React.createElement(Seed, { slots },
        React.createElement(RoutePlanner)))).replace(/<!-- -->/g, '');
}

/** Pull a stat tile's rendered value straight out of the HTML. */
function tile(html, label) {
  const esc = label.replace('&', '&amp;');
  const m = html.match(new RegExp(`${esc}</div><div[^>]*>([^<]*)<`));
  return m ? m[1] : null;
}

// The reporter's save: a saturated DCA–GSP already flown by two A320neos, with a
// third parked and ready. This is the screen that quoted +$248,645/wk.
const SATURATED = airline({ hub: 'DCA', dest: 'GSP', tails: 2, freq: 10 });
const satAdd = withAddedTail(SATURATED, 'DCA', 'GSP', 10, 20);
const satTick = tickRoute(satAdd.state, satAdd.addedId);
const satBare = bareForecast(SATURATED, 'DCA', 'GSP', 10, SATURATED.fare);

let satHtml;
test('the harness seeds RoutePlanner\'s own mode/origin/dest/type/frequency slots', () => {
  satHtml = renderPlanner(SATURATED, { origin: 'DCA', dest: 'GSP', typeId: TYPE_ID, frequency: 10 });
  assert.ok(lastSeed, 'seed wrapper never ran');
  assert.deepEqual(lastSeed.seen.slice(0, SLOT_NAMES.length), EXPECTED_INITIALS,
    `RoutePlanner's leading useState block changed — expected [${SLOT_NAMES}] to start as `
    + `${JSON.stringify(EXPECTED_INITIALS)} but saw ${JSON.stringify(lastSeed.seen.slice(0, 5))}. `
    + 'Re-point the slot indices or this section silently renders the empty-state path.');
});

test('the seeded route actually reaches the economics card', () => {
  // Everything below lives inside `ready && routeData &&`; without this the
  // section is vacuous.
  assert.ok(!satHtml.includes('Select two airports to analyse a route'),
    'planner still on the empty state — seeding did not take');
  assert.ok(satHtml.includes('Your estimated economics'), 'economics card rendered');
});

test('the rendered O&D Passengers figure is what the tick books, not the whole pool', () => {
  const shown = Number((tile(satHtml, 'O&D Passengers') ?? '').replace(/,/g, ''));
  assert.ok(Number.isFinite(shown) && shown > 0, `could not read the passenger tile (got ${shown})`);
  assert.ok(Math.abs(shown - satTick.passengers) <= Math.max(4, satTick.passengers * 0.01),
    `the planner shows ${shown} pax/wk on a pair the tick fills with ${satTick.passengers} — `
    + 'the component is not going through projectRouteAddition');
  assert.ok(Math.abs(shown - satBare.passengers) > satTick.passengers * 0.15,
    `the planner is still showing the bare whole-pool figure (${satBare.passengers})`);
});

test('the rendered Load Factor no longer pins at the engine ceiling', () => {
  const shown = tile(satHtml, 'Load Factor');
  assert.ok(shown, 'could not read the load factor tile');
  const value = Number(String(shown).split('→').pop().replace('%', '').trim());
  assert.ok(Number.isFinite(value), `unreadable load factor "${shown}"`);
  assert.ok(Math.abs(value / 100 - satTick.loadFactor) <= 1.5,
    `planner shows ${shown} against a tick load factor of ${pct(satTick.loadFactor)}`);
  assert.ok(value < 86,
    `planner still pinned at ${shown} — the forecast has not felt the pair filling up`);
});

test('the rendered O&D Revenue and Op Cost agree with the week the tick runs', () => {
  const rev = tile(satHtml, 'O&D Revenue');
  assert.ok(rev, 'could not read the revenue tile');
  const shown = Number(String(rev).replace(/[$,]/g, '').replace(/M$/, 'e6').replace(/K$/, 'e3'));
  assert.ok(Number.isFinite(shown), `unreadable revenue "${rev}"`);
  const drift = Math.abs(shown - satTick.revenue) / Math.max(1, satTick.revenue);
  // The tile is rounded for display (formatMoney), so this is a coarse band by
  // construction — the sharp assertions are on passengers and load factor above.
  assert.ok(drift < 0.05,
    `planner shows ${rev} O&D revenue against ${money(satTick.revenue)} booked`);
});

test('an UNSERVED pair still renders the accurate forecast it always did', () => {
  // The regression guard: the old call was right here, and the fix must not have
  // bought saturated accuracy with unserved accuracy.
  const clean = airline({ hub: 'DCA', dest: 'GSP', tails: 0, freq: 10 });
  const add = withAddedTail(clean, 'DCA', 'GSP', 10, 20);
  const t = tickRoute(add.state, add.addedId);
  const html = renderPlanner(clean, { origin: 'DCA', dest: 'GSP', typeId: TYPE_ID, frequency: 10 });
  const shown = Number((tile(html, 'O&D Passengers') ?? '').replace(/,/g, ''));
  assert.ok(Math.abs(shown - t.passengers) <= Math.max(4, t.passengers * 0.01),
    `planner shows ${shown} pax on an unserved pair the tick fills with ${t.passengers}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. The OTHER call site — Routes.jsx's inline add-route form
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n── 7. The real <AddRouteForm/>, server-rendered ───────────────────────────');

// AddRouteForm is exported, takes its pair as props and needs no hook seeding —
// so it can be rendered straight. Its default frequency is 7, which is also what
// the projection below is asked for.
const { AddRouteForm } = await import('../src/components/Routes.jsx');

const FORM_FREQ = 7;
const formWorld = airline({ hub: 'DCA', dest: 'GSP', tails: 2, freq: 10 });
const formAdd = quiet(() => gameReducer(formWorld, { type: 'ADD_ROUTE', aircraftId: formWorld.spareId,
  origin: 'DCA', destination: 'GSP', weeklyFrequency: FORM_FREQ, ticketPrice: formWorld.fare }));
const formAddedId = formAdd.routes[formAdd.routes.length - 1].id;
const formTick = tickRoute({
  ...formAdd,
  routes: formAdd.routes.map(r => ({ ...r, weeksOpen: 20 })),
  fleet: formAdd.fleet.map(a => ({ ...a, config: defaultConfig(TYPE.seats) })),
}, formAddedId);

let formHtml;
test('the add-route form renders its preview line for a pair already flown', () => {
  lsStore.set('bbae_save_v2', JSON.stringify(formWorld));
  formHtml = renderToString(
    React.createElement(GameProvider, null,
      React.createElement(AddRouteForm, { onClose() {}, initialOrigin: 'DCA', initialDest: 'GSP' })))
    .replace(/<!-- -->/g, '');
  assert.match(formHtml, /pax\/wk/, 'the preview line never rendered — nothing below can be trusted');
});

test('the form previews the slice the tick books, not the whole pool again', () => {
  const shown = Number((formHtml.match(/([\d,]+) pax\/wk/) ?? [])[1]?.replace(/,/g, ''));
  assert.ok(Number.isFinite(shown), 'could not read the passenger figure off the form');
  assert.equal(shown, formTick.passengers,
    `the form shows ${shown} pax/wk against ${formTick.passengers} the tick books for this exact `
    + 'route — Routes.jsx is not going through projectRouteAddition');
  const lf = Number((formHtml.match(/([\d.]+)% load/) ?? [])[1]);
  assert.ok(Math.abs(lf / 100 - formTick.loadFactor) <= 0.5,
    `the form shows ${lf}% load against ${pct(formTick.loadFactor)}`);
  assert.ok(lf < 86, `the form is still pinned at ${lf}% on a saturated pair`);
});

Math.random = realRandom;
console.log(`\n${'─'.repeat(60)}`);
console.log(`  ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
