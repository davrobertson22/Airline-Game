// Rival refuelling stops + listed routes as goals (Tailwinds, new games only).
//
// Discord 2026-11-02 (VodkaOnFire): rivals given routes in a rival set that
// nothing of the era can fly should work toward them — wait for aircraft
// that can, and/or fly them with a stop on the way. Decisions (Dave,
// 2026-11-04): a refuelling stop that sells only the through market, at an
// appeal penalty; any AI rival may use one; new games only
// (state.rivalStopsWorld). Design: models/rivalStops.js header.
//
//   node --import ./tools/_register-loader.mjs tools/rival-stops-test.mjs
import assert from 'node:assert/strict';

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
  try {
    const out = fn();
    if (out && typeof out.then === 'function') throw new Error('test bodies must be synchronous');
    console.log(`  ✓ ${name}`); passed++;
  } catch (e) { console.log(`  ✗ ${name}\n      ${(e.stack || e.message).split('\n').slice(0, 6).join('\n      ')}`); failed++; }
}
function section(t) { console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 66 - t.length))}`); }

const S  = await import('../src/models/rivalStops.js');
const D  = await import('../src/models/demand.js');
const AI = await import('../src/models/competitorAI.js');
const RS = await import('../src/models/rivalSets.js');
const M  = await import('../src/utils/market.js');
const { getAirport } = await import('../src/data/airports.js');
const { metroPrimary } = await import('../src/data/metros.js');
const { getAircraftType } = await import('../src/data/aircraft.js');
const { gameReducer, freshState } = await import('../src/store/GameContext.jsx');
const LB = await import('../src/models/lineBook.js');

function seeded(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function withSeed(seed, fn) { const real = Math.random; Math.random = seeded(seed); try { return fn(); } finally { Math.random = real; } }
const ERA = await import('../src/data/era.js');
const OH  = await import('../src/data/overhead.js');
const AC  = await import('../src/data/aircraft.js');
/** The era module state the reducer sets for a game in calendar year y (GameContext setEraModuleState); null = classic. */
// New games price on the latest demand model (START_GAME); the suite does too.
M.setDemandModel(M.DEMAND_MODEL_LATEST);
function setEra(y) {
  M.setFareIndex(y != null ? (ERA.eraFareIndex(y) ?? 1) : 1);
  M.setEraStartYear(y);
  M.setEraCalendarYear(y);
  OH.setEraCostScale(y != null ? (ERA.eraOverheadScale(y) ?? 1) : 1);
  AC.setEraPriceYear(y);
}
function inYear(y, fn) { setEra(y); try { return fn(); } finally { setEra(null); } }

/** Tick one carrier week by week (books its weekly P&L like the reducer does) until `until` says stop. */
function run(carriers, { from = 1, weeks = 60, stopsWorld = true, until = () => false } = {}) {
  let comps = carriers;
  const events = [];
  for (let wk = from; wk < from + weeks; wk++) {
    const r = AI.tickCompetitorAI(comps, { weekNumber: wk, month: 6, playerRoutes: [], playerHubs: ['ORD'], stopsWorld, mergers: false, startupRate: 'off' });
    const counts = D.buildPairIncumbents(r.competitors, []);
    comps = r.competitors.map(c => {
      const st = D.computeCompetitorWeeklyStats(c, 6, counts);
      return { ...c, cash: c.cash + st.weeklyProfit, profitHistory: [...(c.profitHistory ?? []), st.weeklyProfit].slice(-12) };
    });
    events.push(...r.events);
    if (until(comps, events)) break;
  }
  return { comps, events };
}
/** Long hauls through a stop in the 1950s are marginal in the AI's books; price one up so a test watches the mechanics, not the era's fares. */
const paying = (c, key) => {
  const cfg = c.routes[key];
  const next = { ...cfg, priceMultiplier: 2.2, frequency: 5 };
  return { ...c, routes: { ...c.routes, [key]: { ...next, tails: D.tailsForCompetitorRoute(key, next, 5) } },
           fleet: (c.fleet ?? []).filter(f => f.routeKey !== key).concat(Array.from({ length: D.tailsForCompetitorRoute(key, next, 5) }, (_, i) => ({ id: `pay-${i}`, typeId: cfg.aircraftType, routeKey: key, ageWeeks: 0 }))) };
};
const carrierFrom = (spec, { stops = true } = {}) => {
  const { _skippedRoutes, _viaStop, ...c } = withSeed(1, () => RS.buildRivalFromSpec(RS.parseRivalSet({ tailwindsRivals: 1, rivals: [spec] }).set.rivals[0], { stops }));
  return { ...c, cash: 900_000_000, profitHistory: [5_000_000], _archetype: 'balanced' };
};

section('finding a stop');

test('a pair out of range gets one stop: both legs in range, a modest detour, not hugging either end', () => {
  const st = S.findRefuelStop('LHR', 'SYD', { year: null, maxLegKm: 9500 });
  assert.ok(st, 'London–Sydney with a 9,500 km aircraft should have a stop');
  const direct = M.routeDistance('LHR', 'SYD');
  assert.ok(Math.max(...st.legsKm) <= 9500, JSON.stringify(st));
  assert.ok(st.flownKm <= direct * S.REFUEL_MAX_DETOUR, JSON.stringify(st));
  assert.ok(Math.min(...st.legsKm) >= Math.max(S.REFUEL_MIN_LEG_KM, direct * S.REFUEL_MIN_LEG_SHARE));
  assert.equal(st.flownKm, st.legsKm[0] + st.legsKm[1]);
});

test('no stop when the aircraft reaches nonstop, or when one stop is not enough', () => {
  assert.equal(S.findRefuelStop('LHR', 'JFK', { year: null, maxLegKm: 9000 }), null);
  assert.equal(S.findRefuelStop('LHR', 'SYD', { year: null, maxLegKm: 6000 }), null);
});

test('asked the other way round, the same stop with the legs reversed', () => {
  const ab = S.findRefuelStop('LHR', 'SYD', { year: null, maxLegKm: 9500 });
  const ba = S.findRefuelStop('SYD', 'LHR', { year: null, maxLegKm: 9500 });
  assert.equal(ab.via, ba.via);
  assert.deepEqual(ab.legsKm, [...ba.legsKm].reverse());
});

test('a stop is a long-runway airport, and a city\'s main one (no 1950s stop at a 2019 second airport)', () => {
  for (const [a, b] of [['LHR', 'SYD'], ['LAX', 'NRT'], ['JFK', 'NRT'], ['SFO', 'SYD'], ['LHR', 'JNB'], ['SIN', 'LHR']]) {
    for (const max of [6800, 9000]) {
      const st = S.findRefuelStop(a, b, { year: null, maxLegKm: max });
      if (!st) continue;
      assert.ok((getAirport(st.via).runwayFt ?? 0) >= S.REFUEL_MIN_RUNWAY_FT, `${a}-${b} via ${st.via}`);
      assert.equal(metroPrimary(st.via), st.via, `${a}-${b} via ${st.via}`);
    }
  }
});

test('era games: a Western airline never stops in the Soviet Union before 1991 or in China before 1979', () => {
  const soviet = new Set(['RU', 'UA', 'BY', 'KZ', 'UZ', 'TM', 'KG', 'TJ', 'GE', 'AM', 'AZ', 'MD', 'LT', 'LV', 'EE']);
  let found = 0;
  for (const year of [1955, 1962, 1975]) {
    for (const hub of ['LHR', 'CDG', 'JFK', 'FRA']) {
      for (const ap of D.bigAirports()) {
        const st = S.findRefuelStop(hub, ap.code, { year, home: getAirport(hub).country });
        if (!st) continue;
        found++;
        const c = getAirport(st.via).country;
        assert.ok(!soviet.has(c), `${year} ${hub}-${ap.code} via ${st.via} (${c})`);
        if (year < 1979) assert.notEqual(c, 'CN', `${year} ${hub}-${ap.code} via ${st.via}`);
      }
    }
  }
  assert.ok(found > 20, `expected plenty of era stops, found ${found}`);
});

test('the range ceiling follows the calendar', () => {
  assert.ok(S.aiRangeCeilingKm(1952) < S.aiRangeCeilingKm(1975));
  assert.ok(S.aiRangeCeilingKm(null) >= S.aiRangeCeilingKm(1975));
});

section('what a stop costs');

test('a stop reads worse to passengers than a nonstop, by more when it is a longer way round', () => {
  const near = S.techStopPenalty('LAX', 'HNL', 'NRT');
  assert.ok(near > 0 && near < 1, String(near));
  assert.equal(S.techStopPenalty('LAX', null, 'NRT'), 0);
  const share = S.techStopDemandShare('LAX', 'HNL', 'NRT');
  assert.ok(share > 0.5 && share < 1, String(share));
  const far = S.techStopPenalty('LHR', 'NBO', 'JFK');   // a stop in the wrong hemisphere
  assert.ok(far > near, `${far} vs ${near}`);
});

const RIVAL = { id: 'r1', name: 'Test', tier: 'legacy', homeHub: 'LAX', baseQualityScore: 65, routes: {} };
const CFG   = { frequency: 7, priceMultiplier: 1.04, aircraftType: 'l1049g', seats: 70, tails: 4 };

test('the AI books: fewer passengers, more cost, more tails through a stop', () => {
  const ns  = D.computeCompetitorRoutePnL(RIVAL, 'LAX-NRT', CFG, 6);
  const via = D.computeCompetitorRoutePnL(RIVAL, 'LAX-NRT', { ...CFG, via: 'HNL' }, 6);
  assert.ok(via.demandOneWay < ns.demandOneWay, `${via.demandOneWay} vs ${ns.demandOneWay}`);
  assert.ok(via.cost > ns.cost, `${via.cost} vs ${ns.cost}`);
  assert.ok(D.tailsForCompetitorRoute('LAX-NRT', { via: 'HNL' }, 14) >= D.tailsForCompetitorRoute('LAX-NRT', {}, 14));
  assert.equal(D.tailsForCompetitorRoute('LAX-NRT', {}, 14), D.tailsForRoute(M.routeDistance('LAX', 'NRT'), 14));
});

test('the player\'s share fight: a stopping rival offers less connectivity than the same rival nonstop', () => {
  const market = { origin: 'LAX', destination: 'NRT', referencePrice: 900, distanceKm: M.routeDistance('LAX', 'NRT') };
  const ns  = D.buildCompetitorOffer({ ...RIVAL, routes: { 'LAX-NRT': CFG } }, market);
  const via = D.buildCompetitorOffer({ ...RIVAL, routes: { 'LAX-NRT': { ...CFG, via: 'HNL' } } }, market);
  assert.ok(Math.abs((ns.connectivityBonus - via.connectivityBonus) - S.techStopPenalty('LAX', 'HNL', 'NRT')) < 1e-9);
});

test('a refuelling-stop route is sized on its longest leg', () => {
  inYear(1952, () => {
    const c = D.buildCompetitorFleet({ id: 'x', tier: 'legacy', homeHub: 'LAX', routes: { 'LAX-NRT': { frequency: 5, priceMultiplier: 1, via: 'HNL' } } });
    const r = c.routes['LAX-NRT'];
    assert.ok(r.aircraftType, 'a 1952 type should fly the longest leg');
    assert.ok(getAircraftType(r.aircraftType).range >= Math.max(...S.routeLegsKm('LAX-NRT', r)));
    assert.equal(c.fleet.filter(f => f.routeKey === 'LAX-NRT').length, r.tails);
  });
});

section('a rival set\'s listed routes');

test('a listed route out of range nonstop starts through a stop in a stops world, and is left out otherwise', () => {
  inYear(1952, () => {
    const air = { tier: 'legacy', homeHub: 'LAX', fleetPref: null };
    const on  = D.listedStarterRoutes(air, ['LAX-NRT', 'LAX-SFO'], { stops: true });
    assert.ok(on.routes['LAX-NRT']?.via, JSON.stringify(on));
    assert.equal(on.routes['LAX-SFO']?.via, undefined);
    assert.equal(on.viaStop.length, 1);
    const off = D.listedStarterRoutes(air, ['LAX-NRT', 'LAX-SFO']);
    assert.equal(off.routes['LAX-NRT'], undefined);
    assert.deepEqual(off.skipped, ['LAX-NRT']);
  });
});

test('a new era game is a stops world, and its toast says which listed routes stop or wait', () => {
  const set = { tailwindsRivals: 1, rivals: [{ name: 'Pacific Clipper', hub: 'LAX', tier: 'legacy', routes: ['LAX-NRT', 'LAX-SFO', 'LAX-SIN'] }] };
  const s = withSeed(7, () => gameReducer(freshState(), { type: 'START_GAME', airlineName: 'Mine', hub: 'ORD', startYear: 1952, rivalSet: JSON.stringify(set) }));
  setEra(null);
  assert.equal(s.rivalStopsWorld, true);
  const pc = s.competitors.find(c => c.name === 'Pacific Clipper');
  assert.ok(pc.routes['LAX-NRT']?.via, JSON.stringify(pc.routes));
  assert.ok(pc.routes['LAX-NRT'].aircraftType);
  const toast = (s.pendingToasts ?? []).find(t => /refuel|waiting on aircraft/i.test(`${t.title} ${t.message}`));
  assert.ok(toast, JSON.stringify(s.pendingToasts));
  assert.match(toast.message, /refuelling stop/);
});

test('a listed route nothing can reach opens as soon as something can, and says so', () => {
  const c = inYear(1952, () => carrierFrom({ name: 'Empire Air', hub: 'LHR', tier: 'legacy', routes: ['LHR-CDG', 'LHR-HKG'] }));
  assert.equal(c.routes['CDG-LHR'] != null, true);
  assert.equal(c.routes['HKG-LHR'], undefined, '1952: London–Hong Kong is out of reach even with one stop');
  // Still out of reach: a year of 1952 never opens it.
  const still = inYear(1952, () => withSeed(3, () => run([c], { weeks: 40 })));
  assert.equal(still.comps[0].routes['HKG-LHR'], undefined);
  // 1972: the 747 flies it nonstop — the carrier goes for it ahead of anything else.
  const later = inYear(1972, () => withSeed(3, () => run([c], { weeks: 40, until: (cs) => cs[0].routes['HKG-LHR'] })));
  const r = later.comps[0].routes['HKG-LHR'];
  assert.ok(r, 'London–Hong Kong should open once a type can fly it');
  assert.equal(r.via, undefined);
  assert.ok(later.events.some(e => e.type === 'launch' && e.routeKey === 'HKG-LHR' && /waiting to fly/.test(e.description)));
});

test('old saves (no stops world) never chase listed routes or fly through a stop', () => {
  const c = inYear(1952, () => carrierFrom({ name: 'Empire Air', hub: 'LHR', tier: 'legacy', routes: ['LHR-CDG', 'LHR-HKG'] }, { stops: false }));
  const out = inYear(1958, () => withSeed(5, () => run([c], { weeks: 80, stopsWorld: false })));
  assert.ok(!out.events.some(e => /waiting to fly/.test(e.description ?? '')));
  for (const cfg of Object.values(out.comps[0].routes)) assert.equal(cfg.via, undefined);
});

test('a listed route withdrawn for losses rests before the carrier tries it again', () => {
  const c = inYear(1972, () => carrierFrom({ name: 'Empire Air', hub: 'LHR', tier: 'legacy', routes: ['LHR-CDG', 'LHR-AMS', 'LHR-FRA', 'LHR-HKG'] }));
  // Price London–Hong Kong into the ground and start it on the loss timer.
  const losing = { ...c, routes: { ...c.routes, 'HKG-LHR': { ...c.routes['HKG-LHR'], priceMultiplier: 0.05 } }, _routeLoss: { 'HKG-LHR': 100 } };
  const out = inYear(1972, () => withSeed(9, () => run([losing], { weeks: 30, until: (cs) => !cs[0].routes['HKG-LHR'] })));
  const after = out.comps[0];
  assert.equal(after.routes['HKG-LHR'], undefined, 'the losing route should be withdrawn');
  const retry = after._listedRetry?.['HKG-LHR'];
  const cutWeek = retry - AI.LISTED_RETRY_WEEKS;
  assert.ok(cutWeek >= 1 && cutWeek <= 30, JSON.stringify(after._listedRetry));
  // During the rest it stays away, healthy as the carrier is…
  const healthy = { ...after, cash: 900_000_000, profitHistory: [5_000_000] };
  const resting = inYear(1972, () => withSeed(9, () => run([healthy], { from: 31, weeks: 40 })));
  assert.equal(resting.comps[0].routes['HKG-LHR'], undefined, 'not before its rest is over');
  // …and comes back for it once the rest is over.
  const back = inYear(1972, () => withSeed(9, () => run([{ ...resting.comps[0], cash: 900_000_000, profitHistory: [5_000_000] }],
    { from: retry, weeks: 40, until: (cs) => cs[0].routes['HKG-LHR'] })));
  assert.ok(back.comps[0].routes['HKG-LHR'], 'it should try London–Hong Kong again after the rest');
});

section('going nonstop');

test('a carrier flying through a stop goes nonstop once a type can, and drops the stop', () => {
  const c = inYear(1952, () => paying(carrierFrom({ name: 'Pacific Clipper', hub: 'LAX', tier: 'legacy', routes: ['LAX-NRT', 'LAX-SFO', 'LAX-SEA'] }), 'LAX-NRT'));
  assert.ok(c.routes['LAX-NRT'].via, JSON.stringify(c.routes['LAX-NRT']));
  // Still 1952: nothing reaches nonstop, so the stop stays.
  const before = inYear(1952, () => withSeed(11, () => run([c], { weeks: 20 })));
  assert.equal(before.comps[0].routes['LAX-NRT']?.via, 'HNL');
  const out = inYear(1962, () => withSeed(11, () => run([c], { weeks: 60, until: (cs) => cs[0].routes['LAX-NRT'] && !cs[0].routes['LAX-NRT'].via })));
  const r = out.comps[0].routes['LAX-NRT'];
  assert.ok(r && !r.via, JSON.stringify(r));
  assert.ok(getAircraftType(r.aircraftType).range >= M.routeDistance('LAX', 'NRT'));
  assert.equal(out.comps[0].fleet.filter(f => f.routeKey === 'LAX-NRT').length, r.tails);
  assert.ok(out.events.some(e => e.type === 'nonstop' && e.routeKey === 'LAX-NRT' && /nonstop/.test(e.description)));
});

test('production lines: a via launch arrives with its stop, and a nonstop order swaps the frames and drops it', () => {
  const base = { id: 'r', name: 'R', cash: 1e9, fleet: [{ id: 'r-t1', typeId: 'l1049g', routeKey: 'LAX-NRT' }, { id: 'r-t2', typeId: 'l1049g', routeKey: 'LAX-NRT' }],
                 routes: { 'LAX-NRT': { frequency: 5, aircraftType: 'l1049g', seats: 70, tails: 2, priceMultiplier: 1, via: 'HNL' } } };
  const launched = AI.deliverLinePlans({ ...base, linePlans: [
    { id: 'p1', kind: 'launch', routeKey: 'JFK-LHR', typeId: 'l1049g', lineId: 'x', weeks: [10], cfg: { frequency: 5, aircraftType: 'l1049g', seats: 70, priceMultiplier: 1, via: 'SNN' } },
  ] }, 10).carrier;
  assert.equal(launched.routes['JFK-LHR'].via, 'SNN');
  const ns = AI.deliverLinePlans({ ...base, linePlans: [
    { id: 'p2', kind: 'nonstop', routeKey: 'LAX-NRT', typeId: 'l1649', lineId: 'x', weeks: [20, 21, 22], cfg: { seats: 80 } },
  ] }, 22).carrier;
  assert.equal(ns.routes['LAX-NRT'].via, undefined);
  assert.equal(ns.routes['LAX-NRT'].aircraftType, 'l1649');
  assert.equal(ns.routes['LAX-NRT'].tails, 3);
  assert.deepEqual(ns.fleet.map(f => f.typeId), ['l1649', 'l1649', 'l1649']);
});

test('production lines: the AI orders frames to go nonstop and the swap lands on delivery', () => {
  const c = inYear(1952, () => paying(carrierFrom({ name: 'Pacific Clipper', hub: 'LAX', tier: 'legacy', routes: ['LAX-NRT', 'LAX-SFO', 'LAX-SEA'] }), 'LAX-NRT'));
  assert.ok(c.routes['LAX-NRT'].via);
  let comps = [c];
  const events = [];
  inYear(1962, () => withSeed(13, () => {
    for (let wk = 1; wk <= 120; wk++) {
      const lines = LB.makeTickLedger({ competitors: comps, pendingOrders: [], absWeek: wk + 1, scale: 1 });
      const r = AI.tickCompetitorAI(comps, { weekNumber: wk, month: 6, playerRoutes: [], playerHubs: [], stopsWorld: true, mergers: false, startupRate: 'off', lines });
      const counts = D.buildPairIncumbents(r.competitors, []);
      comps = r.competitors.map(x => { const st = D.computeCompetitorWeeklyStats(x, 6, counts); return { ...x, cash: x.cash + st.weeklyProfit, profitHistory: [st.weeklyProfit] }; });
      events.push(...r.events);
      if (comps[0].routes['LAX-NRT'] && !comps[0].routes['LAX-NRT'].via) break;
    }
  }));
  assert.ok(events.some(e => e.type === 'aircraftOrder' && e.routeKey === 'LAX-NRT'), 'frames ordered for the nonstop');
  const r = comps[0].routes['LAX-NRT'];
  assert.ok(r && !r.via, JSON.stringify(r));
  assert.ok(events.some(e => e.type === 'nonstop' && e.routeKey === 'LAX-NRT'));
});

section('any rival, its own expansion');

test('any rival weighs routes through a stop when it picks where to grow (stops world only)', () => {
  inYear(1952, () => {
    const c = { id: 'gc', name: 'Global Clipper', tier: 'premium', homeHub: 'JFK', _archetype: 'fortress', routes: {} };
    // Everything it can reach nonstop is already in its network.
    const network = {};
    for (const ap of D.bigAirports()) {
      if (ap.code === 'JFK') continue;
      const d = M.routeDistance('JFK', ap.code);
      if (d >= 300 && D.pickCompetitorAircraftType(d, 'premium')) network[['JFK', ap.code].sort().join('-')] = { frequency: 7, priceMultiplier: 1 };
    }
    const ctx = { incumbents: new Map(), playerPairs: new Map(), playerHubs: [], playerNotice: 0 };
    assert.equal(AI.pickExpansionTarget(c, network, ctx), null, 'without stops there is nowhere left to go');
    const cand = AI.pickExpansionTarget(c, network, { ...ctx, stops: true });
    assert.ok(cand?.via, JSON.stringify(cand));
    assert.ok(cand.legKm < cand.dist);
    assert.ok(D.pickCompetitorAircraftType(cand.legKm, 'premium'));
    assert.ok(!D.pickCompetitorAircraftType(cand.dist, 'premium'));
  });
});

test('a listed route launched mid-game through a stop says where it stops', () => {
  // Built without stops (as if founded before a stop could be found), then
  // ticked in a stops world: the carrier opens it through its stop.
  const c = inYear(1952, () => carrierFrom({ name: 'Pacific Clipper', hub: 'LAX', tier: 'legacy', routes: ['LAX-SFO', 'LAX-NRT'] }, { stops: false }));
  assert.equal(c.routes['LAX-NRT'], undefined);
  const out = inYear(1952, () => withSeed(4, () => run([c], { weeks: 40, until: (cs) => cs[0].routes['LAX-NRT'] })));
  const cfg = out.comps[0].routes['LAX-NRT'];
  assert.ok(cfg?.via, JSON.stringify(cfg));
  assert.ok(getAircraftType(cfg.aircraftType).range >= Math.max(...S.routeLegsKm('LAX-NRT', cfg)));
  assert.equal(out.comps[0].fleet.filter(f => f.routeKey === 'LAX-NRT').length, cfg.tails);
  const e = out.events.find(e => e.type === 'launch' && e.routeKey === 'LAX-NRT');
  assert.match(e.description, new RegExp(`stopping at ${cfg.via} to refuel — a route it has been waiting to fly`));
});

section('a takeover');

test('buying a rival that flies through a stop gives you a multi-stop route through it', () => {
  const tail = (i, typeId, routeKey) => ({ id: `x${i}`, typeId, routeKey, ageWeeks: 300 });
  const TARGET = {
    id: 'r1', name: 'Rival Air', tier: 'legacy', homeHub: 'LAX', cash: 5_000_000, marketCap: 40_000_000, baseQualityScore: 60,
    fleet: [tail(0, 'b737800', 'LAX-SFO'), tail(1, 'b7879', 'LAX-NRT')],
    routes: { 'LAX-SFO': { frequency: 7, priceMultiplier: 1 }, 'LAX-NRT': { frequency: 5, priceMultiplier: 1, via: 'HNL' } },
  };
  const state = {
    week: 30, year: 3, hub: 'ORD', airlineName: 'Test Air', cash: 5_000_000_000, fleet: [], routes: [], gates: { ORD: 6 },
    routePricing: {}, routeCatering: {}, competitors: [TARGET], codeshareAgreements: [], pendingToasts: [],
  };
  const next = gameReducer(state, { type: 'ACQUIRE_COMPETITOR', competitorId: 'r1' });
  const tag = next.routes.find(r => r.origin === 'LAX' && r.destination === 'NRT' || r.origin === 'NRT' && r.destination === 'LAX');
  assert.ok(tag, JSON.stringify(next.routes.map(r => [r.origin, r.destination])));
  assert.deepEqual(tag.stops, ['LAX', 'HNL', 'NRT']);
  assert.ok(Object.keys(tag.segmentPrices ?? {}).length >= 3, JSON.stringify(tag.segmentPrices));
  const plain = next.routes.find(r => [r.origin, r.destination].sort().join('-') === 'LAX-SFO');
  assert.equal(plain.stops, undefined);
  assert.ok(next.routePricing['LAX-SFO']);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
