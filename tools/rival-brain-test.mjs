// Smart rivals — how AI airlines choose (models/rivalBrain.js; new games,
// state.smartRivalsWorld).
//
// The 2026-11-11 audit (project doc claude/ai-airlines-audit-2026-11-11.md) ran
// the AI through three seeded ten-year worlds and measured it: 65% of launched
// routes withdrawn within a year, 42% of rival aircraft closed-line types
// delivered as new, 18% of routes with neither end in the carrier's home
// market and half of all second hubs abroad, 83% of routes on the load cap at a
// fare that never moved, and a route P&L that split a pair by head count so
// nothing the player did reached a rival's books.
//
// What this suite pins:
//   * home market — bases, second hubs and every launched route;
//   * aircraft — sized to the lane and its passengers, in production, from a
//     maker the carrier could buy from;
//   * look before launching — a route that would lose money is not opened;
//   * the pair contest — a rival loses passengers to a better offer and wins
//     them back from a full one; alone, it is exactly the old arithmetic;
//   * yield management, fleet age and renewal, restructuring, liquidation;
//   * the field's wealth after ten years stays in the band the cost scale was
//     tuned to (demand.js SMART_RIVAL_COST_SCALE);
//   * a world without the flag is untouched.
//
//   node --import ./tools/_register-loader.mjs tools/rival-brain-test.mjs

import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};
globalThis.window ??= {
  localStorage: globalThis.localStorage,
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
};

const brain = await import('../src/models/rivalBrain.js');
const D     = await import('../src/models/demand.js');
const AI    = await import('../src/models/competitorAI.js');
const L     = await import('../src/models/liquidation.js');
const { getAirport } = await import('../src/data/airports.js');
const { getAircraftType, aircraftAvailability, AIRCRAFT_TYPES, maxSeatsForRange } = await import('../src/data/aircraft.js');
const { routeDistance, computeMarketCap, referencePrice } = await import('../src/utils/market.js');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${(e.stack || e.message).split('\n').slice(0, 5).join('\n      ')}`); failed++; }
}
function section(t) { console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 66 - t.length))}`); }

const realRandom = Math.random;
function seedRandom(seed) {
  let s = seed;
  Math.random = function seeded() {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PLAYER = [
  { origin: 'JFK', destination: 'LHR', ticketPrice: 620, weeklyFrequency: 14, seats: 300, quality: 65 },
  { origin: 'JFK', destination: 'LAX', ticketPrice: 380, weeklyFrequency: 21, seats: 190, quality: 65 },
];

/** A seeded world, ticked the way the reducer ticks it. Returns the field and what happened. */
function runWorld({ seed, weeks, smart, onWeek = null }) {
  seedRandom(seed);
  let comps = D.sampleAndInitializeCompetitors(25, { smart });
  const events = [];
  for (let wk = 1; wk <= weeks; wk++) {
    const month = Math.min(12, Math.ceil(((wk - 1) % 52 + 1) / 4.34));
    const r = AI.tickCompetitorAI(comps, { weekNumber: wk, month, playerRoutes: PLAYER,
      playerHubs: ['JFK'], playerMarketCap: 50e6 + wk * 3e6, smart });
    for (const e of r.events) events.push({ ...e, wk });
    const counts = D.buildPairIncumbents(r.competitors, PLAYER);
    const world  = smart ? { contest: brain.buildPairContest(r.competitors, PLAYER) } : null;
    comps = r.competitors.map(c => {
      const stats = D.computeCompetitorWeeklyStats(c, month, counts, world);
      const cash  = (c.cash ?? 0) + AI.retainedProfit(c.cash ?? 0, stats.weeklyProfit, smart ? { weeklyCost: stats.weeklyCost } : undefined);
      const ph    = [...(c.profitHistory ?? []), stats.weeklyProfit].slice(-12);
      const { marketCap, sharePrice } = computeMarketCap(ph, cash, c.baseQualityScore);
      return { ...c, weeklyStats: stats, cash, profitHistory: ph, marketCap, sharePrice };
    });
    onWeek?.(wk, comps, r.events);
  }
  Math.random = realRandom;
  return { comps, events };
}

// ─────────────────────────────────────────────────────────────────────────────
section('Home market');

test('one country, its territories, and the European single market', () => {
  assert.equal(brain.sameHomeMarket('US', 'US'), true);
  assert.equal(brain.sameHomeMarket('US', 'PR'), true, 'San Juan is home for a US carrier');
  assert.equal(brain.sameHomeMarket('IT', 'FR'), true, 'the single market is one home market');
  assert.equal(brain.sameHomeMarket('IE', 'PL'), true);
  assert.equal(brain.sameHomeMarket('US', 'CA'), false);
  assert.equal(brain.sameHomeMarket('PH', 'JP'), false);
});

test('the single market has dates: not before 1993, and the UK left it', () => {
  assert.equal(brain.sameHomeMarket('IT', 'FR', 1985), false);
  assert.equal(brain.sameHomeMarket('IT', 'FR', 1995), true);
  assert.equal(brain.sameHomeMarket('IT', 'PL', 1995), false, 'Poland joined in 2004');
  assert.equal(brain.sameHomeMarket('IT', 'GB', 2005), true);
  assert.equal(brain.sameHomeMarket('IT', 'GB', 2026), false);
  assert.equal(brain.sameHomeMarket('IT', 'GB'), false, 'a classic world reads as 2026');
});

test('a carrier with a busy foreign station does not base aircraft there', () => {
  // Manila budget carrier whose most-flown airport is Tokyo Haneda — the audit's
  // example, which ended with a Haneda hub and 14 of 15 routes outside the Philippines.
  const airline = { id: 'coral', name: 'Coral Air', homeHub: 'MNL', tier: 'budget', _archetype: 'expansionist' };
  const routes = { 'HND-MNL': {}, 'HND-ICN': {}, 'HND-TPE': {}, 'HND-SIN': {}, 'CEB-MNL': {} };
  const stub = () => ({ options: [{ type: { id: 'x' }, frequency: 7, seats: 180, tails: 1, profit: 1, value: 1 }] });
  seedRandom(5);
  for (let i = 0; i < 25; i++) {
    const pick = AI.pickExpansionTarget(airline, routes, { incumbents: new Map(), playerPairs: new Map(),
      playerHubs: [], playerNotice: 0.5, smart: true, evaluate: stub });
    assert.ok(pick, 'it still finds somewhere to go');
    const [a, b] = pick.key.split('-');
    assert.ok(getAirport(a).country === 'PH' || getAirport(b).country === 'PH', `${pick.key} has no end in the Philippines`);
  }
  Math.random = realRandom;
});

// ─────────────────────────────────────────────────────────────────────────────
section('Aircraft');

const smartOpts = (demand, home = 'US') => ({ smart: true, demand, home });

test('a carrier orders what is being built', () => {
  for (const tier of ['budget', 'legacy', 'premium']) {
    for (const dist of [400, 1200, 3000, 6000, 10000]) {
      const t = D.pickCompetitorAircraftType(dist, tier, null, smartOpts(null));
      assert.ok(t, `${tier} ${dist} km has an aircraft`);
      assert.equal(aircraftAvailability(t, 2026), 'new', `${tier} ${dist} km picked ${t.id}, whose line is not building in 2026`);
    }
  }
});

test('the aircraft is sized to the passengers the lane has', () => {
  const thin  = D.pickCompetitorAircraftType(500, 'legacy', null, smartOpts(350));
  const trunk = D.pickCompetitorAircraftType(500, 'legacy', null, smartOpts(6000));
  assert.ok(thin.seats <= 110, `a thin short route gets a regional aircraft, not the ${thin.id} (${thin.seats} seats)`);
  assert.ok(trunk.seats >= 180 && trunk.seats <= 250, `a short trunk gets a big narrowbody, not the ${trunk.id} (${trunk.seats} seats)`);
  const longThin  = D.pickCompetitorAircraftType(6000, 'legacy', null, smartOpts(900));
  const longDense = D.pickCompetitorAircraftType(6000, 'legacy', null, smartOpts(4000));
  assert.ok(longDense.seats > longThin.seats, `${longDense.id} should out-seat ${longThin.id}`);
  assert.ok(/Wide|Double/.test(longDense.category), `a dense long route gets a widebody, not the ${longDense.id}`);
});

test('no widebody under 1,500 km, however many passengers', () => {
  for (const tier of ['budget', 'legacy', 'premium']) {
    const t = D.pickCompetitorAircraftType(900, tier, null, smartOpts(50000));
    assert.ok(maxSeatsForRange(t, 900) <= brain.seatCeilingFor(900, tier), `${tier}: ${t.id}`);
    assert.ok(!/Wide|Double/.test(t.category), `${tier}: ${t.id} is a ${t.category}`);
  }
});

test('Soviet, Russian and Chinese types stay with the airlines that bought them', () => {
  const eastern = /antonov|ilyushin|irkut|sukhoi|tupolev|yakovlev|comac|xian/i;
  for (const dist of [600, 1500, 3000, 4500]) {
    for (const demand of [300, 1500, 5000]) {
      const top = D.rankCompetitorAircraftTypes(dist, 'legacy', null, smartOpts(demand, 'CA')).slice(0, 3);
      for (const t of top) assert.ok(!eastern.test(t.manufacturer), `a Canadian carrier's shortlist has the ${t.id}`);
    }
  }
  const pref = { maker: 'comac' };
  const named = D.pickCompetitorAircraftType(1500, 'legacy', pref, smartOpts(2500, 'CA'));
  assert.ok(/comac/i.test(named.manufacturer), 'a rival set that names the maker gets it');
});

test('a premium carrier fits fewer seats than a budget one', () => {
  const t = getAircraftType('a321neo');
  assert.ok(brain.rivalLaneSeats(t, 1000, 'premium') < brain.rivalLaneSeats(t, 1000, 'budget'));
  assert.equal(brain.rivalLaneSeats(t, 1000, 'budget'), maxSeatsForRange(t, 1000));
});

test('carriers lean to one of the two big makers, and not all to the same one', () => {
  const houses = D.COMPETITOR_AIRLINES.map(c => brain.houseMakerOf(c));
  const airbus = houses.filter(h => h === 'Airbus').length;
  assert.ok(airbus >= houses.length * 0.3 && airbus <= houses.length * 0.7, `${airbus} of ${houses.length} lean Airbus`);
  assert.equal(brain.houseMakerOf({ id: 'x', fleetPref: { maker: 'boeing' } }), null, 'a rival set that names a maker has no lean of its own');
  assert.equal(brain.houseMakerOf(D.COMPETITOR_AIRLINES[0]), brain.houseMakerOf({ ...D.COMPETITOR_AIRLINES[0] }), 'and it never changes');
});

// ─────────────────────────────────────────────────────────────────────────────
section('The pair contest');

const offer = (id, o = {}) => ({ id, freq: 7, seats: 200, mult: 1, quality: 60, ...o });

test('alone on a pair it is the old arithmetic', () => {
  const d = brain.contestDemand([], offer('a', { mult: 1.2 }), 5000);
  assert.ok(Math.abs(d - 5000 * Math.pow(1 / 1.2, 1.3)) < 1e-6);
});

test('identical carriers split the pair exactly as before', () => {
  const others = [offer('b', { seats: 9999 }), offer('c', { seats: 9999 })];
  const d = brain.contestDemand(others, offer('a', { seats: 9999 }), 6000);
  assert.ok(Math.abs(d - 6000 * Math.pow(3, 0.15) / 3) < 1e-6);
});

test('more departures, a lower fare and a better product each win passengers', () => {
  const rival = [offer('b', { seats: 9999 })];
  const base  = brain.contestDemand(rival, offer('a', { seats: 9999 }), 6000);
  assert.ok(brain.contestDemand(rival, offer('a', { seats: 9999, freq: 21 }), 6000) > base);
  assert.ok(brain.contestDemand(rival, offer('a', { seats: 9999, mult: 0.85 }), 6000) > base);
  assert.ok(brain.contestDemand(rival, offer('a', { seats: 9999, quality: 80 }), 6000) > base);
});

test('a full airline turns passengers away, and the others pick some up', () => {
  const roomy = brain.contestDemand([offer('b', { seats: 9999 })], offer('a', { seats: 9999 }), 6000);
  const full  = brain.contestDemand([offer('b', { seats: 100 })],  offer('a', { seats: 9999 }), 6000);
  assert.ok(full > roomy, `${full} should exceed ${roomy}`);
});

test('budget, legacy and premium carriers pull about equally at their usual fares', () => {
  const pulls = [
    brain.offerPull(offer('b', { mult: 0.76, quality: 40 })),
    brain.offerPull(offer('l', { mult: 1.04, quality: 62 })),
    brain.offerPull(offer('p', { mult: 1.45, quality: 81 })),
  ];
  assert.ok(Math.max(...pulls) / Math.min(...pulls) < 1.25, pulls.map(p => p.toFixed(2)).join(' / '));
});

test("the player's flights reach a rival's books", () => {
  const rival = { id: 'r1', name: 'Rival', tier: 'legacy', homeHub: 'JFK', baseQualityScore: 60,
    routes: { 'JFK-LAX': { frequency: 14, priceMultiplier: 1.04, aircraftType: 'a321neo', seats: 244, tails: 3 } } };
  const ref = referencePrice('JFK', 'LAX');
  const world = (playerRoutes) => ({ contest: brain.buildPairContest([rival], playerRoutes) });
  const alone   = D.computeCompetitorRoutePnL(rival, 'JFK-LAX', rival.routes['JFK-LAX'], 6, null, world([]));
  const modest  = D.computeCompetitorRoutePnL(rival, 'JFK-LAX', rival.routes['JFK-LAX'], 6, null,
    world([{ origin: 'JFK', destination: 'LAX', weeklyFrequency: 7, ticketPrice: ref, seats: 190, quality: 60 }]));
  const strong  = D.computeCompetitorRoutePnL(rival, 'JFK-LAX', rival.routes['JFK-LAX'], 6, null,
    world([{ origin: 'JFK', destination: 'LAX', weeklyFrequency: 180, ticketPrice: ref * 0.8, seats: 400, quality: 85 }]));
  assert.ok(modest.demandOneWay < alone.demandOneWay, 'any competitor takes passengers');
  assert.ok(strong.demandOneWay < modest.demandOneWay, 'a stronger one takes more');
  // The old split would have given both players of the pair the same slice whatever they offered.
  const oldSplit = D.computeCompetitorRoutePnL(rival, 'JFK-LAX', rival.routes['JFK-LAX'], 6, new Map([['JFK-LAX', 2]]));
  assert.notEqual(strong.demandOneWay, oldSplit.demandOneWay);
});

// ─────────────────────────────────────────────────────────────────────────────
section('Yield, age, failure');

function soloCarrier(routes, extra = {}) {
  const c = { id: 'ai-brain', name: 'Brain Air', homeHub: 'JFK', tier: 'legacy', logoId: 'eagle',
    baseQualityScore: 60, cash: 80_000_000, profitHistory: [1_000_000, 1_000_000],
    _archetype: 'fortress', allianceId: null, routes: {}, fleet: [], ...extra };
  for (const [key, cfg] of Object.entries(routes)) {
    const [a, b] = key.split('-');
    const tails = cfg.tails ?? D.tailsForRoute(routeDistance(a, b), cfg.frequency);
    c.routes[key] = { priceMultiplier: 1.04, ...cfg, tails };
    for (let i = 0; i < tails; i++) c.fleet.push({ ...D.makeCompetitorTail(c.id, cfg.aircraftType, key, false), ageWeeks: cfg.ageWeeks ?? 0 });
  }
  return c;
}
function tickSolo(c, weeks, ctx = {}) {
  let comps = [c];
  const events = [];
  for (let wk = 1; wk <= weeks; wk++) {
    const r = AI.tickCompetitorAI(comps, { weekNumber: wk, month: 6, playerRoutes: [], playerHubs: [], playerMarketCap: 0,
      mergers: false, startupRate: 'off', smart: true, ...ctx });
    comps = r.competitors;
    events.push(...r.events);
    if (!comps.length) break;
  }
  return { c: comps[0] ?? null, events };
}

test('a route that keeps selling out is priced up, inside the band', () => {
  Math.random = () => 0.99;
  const c0 = soloCarrier({ 'JFK-LHR': { frequency: 3, aircraftType: 'a321neo', seats: 244 } });
  const { c } = tickSolo(c0, 40);
  Math.random = realRandom;
  const band = brain.fareBand(c0, 1);
  const m = c.routes['JFK-LHR'].priceMultiplier;
  assert.ok(m > 1.04, `fare multiple ${m} should have risen from 1.04`);
  assert.ok(m <= band.ceiling + 1e-9, `fare multiple ${m} is above the ceiling ${band.ceiling}`);
});

test('a soft route is priced down, never below the floor', () => {
  Math.random = () => 0.99;
  const c0 = soloCarrier({ 'JFK-LOS': { frequency: 21, aircraftType: 'a330neo', seats: 400, priceMultiplier: 1.15 } });
  const { c } = tickSolo(c0, 12);
  Math.random = realRandom;
  const m = c?.routes?.['JFK-LOS']?.priceMultiplier;
  assert.ok(m != null, 'the route is still flown');
  assert.ok(m < 1.15, `fare multiple ${m} should have fallen from 1.15`);
  assert.ok(m >= brain.fareBand(c0, 1).floor - 1e-9);
});

test('old airframes cost more to keep', () => {
  assert.equal(brain.ageMaintenanceMult(0), 1);
  assert.ok(Math.abs(brain.ageMaintenanceMult(16 * 52) - 2.3) < 0.01);
  assert.ok(brain.ageMaintenanceMult(22 * 52) > brain.ageMaintenanceMult(16 * 52));
  const c = soloCarrier({ 'JFK-LAX': { frequency: 14, aircraftType: 'a321neo', seats: 244 } });
  const young = D.computeCompetitorRoutePnL(c, 'JFK-LAX', c.routes['JFK-LAX'], 6);
  const old   = D.computeCompetitorRoutePnL(c, 'JFK-LAX', { ...c.routes['JFK-LAX'], maintMult: 2.3 }, 6);
  assert.ok(old.cost > young.cost);
});

test('fleets age a week a week, and a healthy carrier renews an old one', () => {
  Math.random = () => 0.99;
  const c0 = soloCarrier({ 'JFK-LAX': { frequency: 14, aircraftType: 'b757300', seats: 295, ageWeeks: 20 * 52 } }, { cash: 400_000_000 });
  const { c, events } = tickSolo(c0, 30);
  Math.random = realRandom;
  const renewal = events.find(e => e.type === 'renewal');
  assert.ok(renewal, 'a twenty-year-old fleet is replaced');
  const type = getAircraftType(c.routes['JFK-LAX'].aircraftType);
  assert.equal(aircraftAvailability(type, 2026), 'new', `replaced with the ${type.id}`);
  assert.ok(c.fleet.every(f => f.ageWeeks < 52), 'the new frames are new');
  const aged = tickSolo(soloCarrier({ 'JFK-LAX': { frequency: 14, aircraftType: 'a321neo', seats: 244 } }), 10).c;
  assert.equal(Math.max(...aged.fleet.map(f => f.ageWeeks)), 10, 'the frames it started with are ten weeks older');
});

test('the first failure is a restructuring; the second closes the airline and lists its aircraft', () => {
  Math.random = () => 0.99;
  const routes = {};
  for (const d of ['LAX', 'ORD', 'MIA', 'SFO', 'BOS', 'ATL']) routes[['JFK', d].sort().join('-')] = { frequency: 7, aircraftType: 'a321neo', seats: 244 };
  const c0 = soloCarrier(routes, { cash: -40_000_000, profitHistory: [-2_000_000] });
  const first = tickSolo(c0, 1);
  const ev = first.events.find(e => e.type === 'restructure');
  assert.ok(ev, 'restructured, not closed');
  assert.ok(first.c, 'it is still flying');
  assert.ok(Object.keys(first.c.routes).length >= 3);
  assert.equal(first.c.costRelief, AI.RESTRUCTURE_COST_RELIEF);
  assert.ok(first.c.cash > 0 && !first.c.fireSale);
  assert.ok(first.c.fleet.every(f => first.c.routes[f.routeKey]), 'no aircraft left on dropped routes');
  const second = tickSolo({ ...first.c, cash: -40_000_000 }, 1, {});
  const closed = second.events.find(e => e.type === 'bankrupt');
  assert.ok(closed, 'the second failure is final');
  assert.equal(second.c, null);
  assert.ok(closed.fleet.length > 0 && closed.fleet.every(f => f.typeId && f.ageWeeks >= 0));
  Math.random = realRandom;
});

test('restructuring relief runs out', () => {
  Math.random = () => 0.99;
  const c0 = soloCarrier({ 'JFK-LAX': { frequency: 14, aircraftType: 'a321neo', seats: 244 } },
    { costRelief: AI.RESTRUCTURE_COST_RELIEF, _reliefUntil: 5, _restructured: 1 });
  assert.equal(tickSolo(c0, 3).c.costRelief, AI.RESTRUCTURE_COST_RELIEF);
  assert.equal(tickSolo(c0, 6).c.costRelief, undefined);
  Math.random = realRandom;
});

test('a liquidation lists each airframe at book value, for a few weeks', () => {
  const lots = L.lotsFromEvents([{ type: 'bankrupt', airlineId: 'x', name: 'Gone Air',
    fleet: [{ typeId: 'a321neo', ageWeeks: 0 }, { typeId: 'a321neo', ageWeeks: 520 }, { typeId: 'nope', ageWeeks: 0 }] }], 100);
  assert.equal(lots.length, 2, 'an unknown type is not listed');
  assert.ok(lots[0].price > lots[1].price, 'an older frame is cheaper');
  assert.ok(lots[0].price <= getAircraftType('a321neo').purchasePrice);
  assert.equal(L.liveLots(lots, 100 + L.LIQUIDATION_WEEKS - 1).length, 2);
  assert.equal(L.liveLots(lots, 100 + L.LIQUIDATION_WEEKS).length, 0);
  assert.equal(L.groupLots(lots, 100).length, 2);
  assert.equal(L.lotsFromEvents([{ type: 'bankrupt', airlineId: 'y', name: 'Old World Air' }], 100).length, 0,
    'a failure in a world without the flag lists nothing');
});

test('a rich carrier pays its profit out', () => {
  const cost = 10_000_000;
  const target = Math.max(AI.SMART_CASH_FLOOR, cost * AI.SMART_CASH_WEEKS);
  assert.equal(AI.retainedProfit(target - 1, 1_000_000, { weeklyCost: cost }), 1_000_000);
  assert.equal(AI.retainedProfit(target + 1, 1_000_000, { weeklyCost: cost }), Math.round(1_000_000 * AI.SMART_CASH_RETENTION));
  assert.equal(AI.retainedProfit(target * 2 + 1, 1_000_000, { weeklyCost: cost }), 0);
  assert.equal(AI.retainedProfit(target * 3, -500_000, { weeklyCost: cost }), -500_000, 'a loss is always its own');
  assert.equal(AI.retainedProfit(100, 1_000_000), 1_000_000, 'without the flag the old rule stands');
});

// ─────────────────────────────────────────────────────────────────────────────
section('A seeded ten-year world');

const launchedAt = new Map();
let early = 0, launches = 0;
const world = runWorld({ seed: 11, weeks: 520, smart: true, onWeek: (wk, comps, events) => {
  for (const e of events) {
    if (e.type === 'launch') { launches++; launchedAt.set(e.airlineId + e.routeKey, wk); }
    if (e.type === 'cut') { const l = launchedAt.get(e.airlineId + e.routeKey); if (l != null && wk - l <= 52) early++; }
  }
} });

test('routes are launched to stay', () => {
  assert.ok(launches > 200, `${launches} launches`);
  assert.ok(early / launches < 0.2, `${early} of ${launches} launches were withdrawn within a year (it was 65%)`);
});

test('every second hub is at home, and no carrier flies a route of its own making abroad', () => {
  const absorbed = new Set(world.events.filter(e => e.type === 'merger').map(e => e.airlineId));
  for (const c of world.comps) {
    if (c.secondaryHub) assert.ok(brain.inHomeMarket(c, c.secondaryHub), `${c.name} (${c.homeHub}) has a hub at ${c.secondaryHub}`);
    if (absorbed.has(c.id)) continue;   // a bought network comes as it is
    for (const key of Object.keys(c.routes)) {
      const [a, b] = key.split('-');
      assert.ok(brain.routeTouchesHome(c, a, b), `${c.name} (${c.homeHub}) flies ${key}`);
    }
  }
});

test('no closed-line aircraft, no widebody under 1,500 km', () => {
  for (const c of world.comps) {
    for (const [key, cfg] of Object.entries(c.routes)) {
      const t = getAircraftType(cfg.aircraftType);
      const [a, b] = key.split('-');
      assert.equal(aircraftAvailability(t, 2026), 'new', `${c.name} flies the ${t.id} on ${key}`);
      if (routeDistance(a, b) < 1500) assert.ok(!/Wide|Double/.test(t.category), `${c.name} flies the ${t.id} on ${key}`);
    }
  }
});

test('regional airports are on the map', () => {
  let regional = 0, all = 0;
  for (const c of world.comps) for (const key of Object.keys(c.routes)) {
    all++;
    if (key.split('-').some(code => getAirport(code)?.tier === 'regional')) regional++;
  }
  assert.ok(regional / all > 0.1, `${regional} of ${all} rival routes touch a regional airport`);
});

test('fares move: carriers no longer hold one fare across the network', () => {
  const spreads = world.comps.filter(c => Object.keys(c.routes).length >= 8).map(c => {
    const m = Object.values(c.routes).map(r => r.priceMultiplier);
    return Math.max(...m) - Math.min(...m);
  });
  const moved = spreads.filter(s => s > 0.03).length;
  assert.ok(moved / spreads.length > 0.5, `${moved} of ${spreads.length} carriers have a fare spread over 3 points`);
});

test("the field's wealth is in the band the cost scale was tuned to", () => {
  // demand.js SMART_RIVAL_COST_SCALE. Before the change the same worlds averaged
  // a $14.5bn market cap; the player is ranked against these numbers.
  const caps = world.comps.map(c => c.marketCap ?? 0);
  const avg  = caps.reduce((a, b) => a + b, 0) / caps.length / 1e9;
  assert.ok(avg > 9 && avg < 21, `average rival market cap after ten years is $${avg.toFixed(1)}bn`);
  const routes = world.comps.reduce((a, c) => a + Object.keys(c.routes).length, 0) / world.comps.length;
  assert.ok(routes > 16 && routes < 32, `average network is ${routes.toFixed(1)} routes`);
});

// ─────────────────────────────────────────────────────────────────────────────
section('A world without the flag');

test('the aircraft ranking is the old one', () => {
  const TIER = { budget: 160, legacy: 250, premium: 330 };
  for (const tier of ['budget', 'legacy', 'premium']) {
    for (const dist of [500, 2500, 7000]) {
      const old = AIRCRAFT_TYPES.filter(t => !t.aiSkip && (t.range ?? 0) >= dist && aircraftAvailability(t, 2026) !== 'expired')
        .slice().sort((a, b) => (Math.abs(a.seats - TIER[tier]) + Math.max(0, a.range - dist * 1.25) * 0.005)
                              - (Math.abs(b.seats - TIER[tier]) + Math.max(0, b.range - dist * 1.25) * 0.005))[0];
      assert.equal(D.pickCompetitorAircraftType(dist, tier).id, old.id);
    }
  }
});

test('nothing ages, nothing is repriced, nobody is restructured', () => {
  const old = runWorld({ seed: 11, weeks: 156, smart: false });
  assert.ok(old.events.every(e => !['restructure', 'renewal'].includes(e.type)));
  assert.ok(old.events.filter(e => e.type === 'bankrupt').every(e => e.fleet === undefined));
  for (const c of old.comps) {
    assert.equal(c.costRelief, undefined);
    for (const cfg of Object.values(c.routes)) assert.equal(cfg.maintMult, undefined);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
section('In the game');

const engine = await import('../src/store/GameContext.jsx');
const { gameReducer, freshState } = engine;

test('a new game has smart rivals; a week ticks with them', () => {
  seedRandom(3);
  let state = gameReducer(freshState(), { type: 'START_GAME', airlineName: 'Brain Test Air', hub: 'JFK', enableObjectives: false });
  assert.equal(state.smartRivalsWorld, true);
  for (const c of state.competitors) for (const cfg of Object.values(c.routes)) {
    if (!cfg.aircraftType) continue;
    assert.equal(aircraftAvailability(getAircraftType(cfg.aircraftType), 2026), 'new', `${c.name} starts on the ${cfg.aircraftType}`);
  }
  const ageOf = (cs) => cs.reduce((a, c) => a + (c.fleet ?? []).reduce((x, f) => x + (f.ageWeeks ?? 0), 0), 0);
  const before = ageOf(state.competitors);
  for (let i = 0; i < 8; i++) state = gameReducer(state, { type: 'ADVANCE_WEEK' });
  assert.equal(state.phase, 'playing');
  assert.ok(ageOf(state.competitors) > before, 'rival fleets age');
  for (const c of state.competitors) {
    assert.ok(Number.isFinite(c.cash) && Number.isFinite(c.marketCap), `${c.name} has finite books`);
  }
  Math.random = realRandom;
});

test('a save without the flag keeps the rivals it started with', () => {
  seedRandom(4);
  let state = gameReducer(freshState(), { type: 'START_GAME', airlineName: 'Old Save Air', hub: 'JFK', enableObjectives: false });
  const { smartRivalsWorld: _flag, ...old } = state;
  let s = old;
  for (let i = 0; i < 6; i++) s = gameReducer(s, { type: 'ADVANCE_WEEK' });
  assert.equal(s.smartRivalsWorld, undefined);
  assert.equal(s.liquidationLots, undefined);
  for (const c of s.competitors) for (const cfg of Object.values(c.routes)) assert.equal(cfg.maintMult, undefined);
  Math.random = realRandom;
});

test('buying from a liquidation sale', () => {
  seedRandom(6);
  let state = gameReducer(freshState(), { type: 'START_GAME', airlineName: 'Bargain Air', hub: 'JFK', enableObjectives: false });
  const lots = L.lotsFromEvents([{ type: 'bankrupt', airlineId: 'x', name: 'Gone Air',
    fleet: [{ typeId: 'atr72', ageWeeks: 300 }, { typeId: 'a380', ageWeeks: 300 }] }], 10);
  state = { ...state, liquidationLots: lots, cash: lots[0].price + 1000 };
  const fleetBefore = state.fleet.length;
  const tooDear = gameReducer(state, { type: 'BUY_LIQUIDATION_AIRCRAFT', lotId: lots[1].id });
  assert.equal(tooDear, state, 'cannot buy what it cannot pay for');
  const after = gameReducer(state, { type: 'BUY_LIQUIDATION_AIRCRAFT', lotId: lots[0].id });
  assert.equal(after.fleet.length, fleetBefore + 1);
  // The price, and whatever hiring a crew for it costs in this world.
  const paid = state.cash - after.cash;
  assert.ok(paid >= lots[0].price && paid <= lots[0].price + 1000, `paid ${paid} for a ${lots[0].price} lot`);
  assert.equal(after.liquidationLots.length, 1);
  const bought = after.fleet[after.fleet.length - 1];
  assert.equal(bought.typeId, 'atr72');
  assert.equal(bought.ageWeeks, 300);
  assert.equal(bought.ownershipType, 'owned');
  assert.equal(bought.status, 'idle');
  assert.equal(gameReducer(after, { type: 'BUY_LIQUIDATION_AIRCRAFT', lotId: lots[0].id }), after, 'a lot sells once');
  Math.random = realRandom;
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
