// Rival freight — AI carriers fly freighters and contest the player's lanes.
//
// Before this, freight was the one business no rival entered: the player's
// freighters only ever met each other, and cargoLaneAllocations' rival channel
// (built for Headwinds' human rivals) never had anything on it in Tailwinds.
//
//   node --import ./tools/_register-loader.mjs tools/competitor-cargo-test.mjs
import assert from 'node:assert/strict';
import { getAircraftType } from '../src/data/aircraft.js';
import { cargoCityPairDemand, cargoReferenceYield } from '../src/utils/market.js';
import { simulateCargoRoute, cargoLaneAllocations } from '../src/utils/simulation.js';
import { sampleAndInitializeCompetitors, healAnachronisticCompetitorFleets } from '../src/models/demand.js';
import { tickCompetitorAI, deliverLinePlans, competitorFleetNAV } from '../src/models/competitorAI.js';
import {
  carrierMaxCargoLanes, aiFreighterTypes, cargoLaneCfg, buildCargoContest, competitorCargoLanePnL,
  computeCompetitorCargoStats, withCargoStats, manageCompetitorCargo, pickCargoExpansion,
  cargoTailKey, isCargoTail, makeCargoTail, cargoRivalsOnLane,
  AI_CARGO_START_WEEK, AI_CARGO_LOSS_WEEKS_TO_CUT,
} from '../src/models/competitorCargo.js';
import { cargoLaneServed } from '../src/models/routeFinder.js';
import { buildWeekNews } from '../src/models/newsLog.js';
import { gameReducer } from '../src/store/GameContext.jsx';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${(e.stack || e.message).split('\n').slice(0, 3).join('\n    ')}`); }
}

// Deterministic dice for anything that rolls.
let seed = 11;
const rng = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const realRandom = Math.random;
Math.random = rng;

const GD = { month: 6 };
const LANE = 'DXB-FRA';                          // sorted key
const lane = (o, d) => [o, d].sort().join('-');
const carrier = (over = {}) => ({
  id: 'rv', name: 'Rival Air', tier: 'legacy', homeHub: 'FRA', cash: 900_000_000,
  baseQualityScore: 60, _archetype: 'balanced', routes: {}, fleet: [], profitHistory: [5_000_000], ...over,
});
const playerFreighter = (id, typeId = 'b777f') => ({ id, typeId, status: 'assigned', ageWeeks: 52, ownershipType: 'owned' });
const playerCargoRoute = (o, d, ac, freq = 7, yieldPrice = null) =>
  ({ id: `pr-${ac}`, origin: o, destination: d, aircraftId: ac, weeklyFrequency: freq,
     yieldPrice: yieldPrice ?? cargoReferenceYield(o, d), weeksOpen: 40, cargo: true });

console.log('\nWho flies freight\n');

test('budget carriers never start a freight arm; legacy and premium do', () => {
  assert.equal(carrierMaxCargoLanes(carrier({ tier: 'budget' })), 0);
  assert.ok(carrierMaxCargoLanes(carrier({ tier: 'legacy' })) > 0);
  assert.ok(carrierMaxCargoLanes(carrier({ tier: 'premium' })) > 0);
});

test('a carrier at a freight hub runs a bigger freight arm than one at a passenger airport', () => {
  assert.ok(carrierMaxCargoLanes(carrier({ homeHub: 'HKG' })) > carrierMaxCargoLanes(carrier({ homeHub: 'LAS' })));
});

test('rivals never buy the outsize Antonovs, and an Airbus carrier flies Airbus freighters or none', () => {
  const all = aiFreighterTypes(3000);
  assert.ok(all.length > 0 && all.every(t => t.freighter));
  assert.ok(!all.some(t => t.id === 'an124' || t.id === 'an225'));
  const airbus = aiFreighterTypes(3000, { types: [], maker: 'airbus' });
  assert.ok(airbus.length > 0 && airbus.every(t => /airbus/i.test(t.manufacturer)));
  assert.deepEqual(aiFreighterTypes(3000, { types: [], maker: 'nobodyaero' }), [], 'no fallback to other makers');
});

console.log('\nLane economics are the player’s own\n');

test('a rival lane earns exactly what simulateCargoRoute says the same freighter earns', () => {
  const c = carrier();
  const cfg = cargoLaneCfg(LANE, { aircraftType: 'b777f', frequency: 7, tails: 1, yieldMultiplier: 1 });
  const p = competitorCargoLanePnL(c, LANE, cfg, { month: 6 });
  const [a, b] = LANE.split('-');
  const sim = simulateCargoRoute({ origin: a, destination: b, weeklyFrequency: 7, yieldPrice: cfg.yieldPrice },
    { id: 'x', typeId: 'b777f' }, GD, null, 1, 1, { demandTonnes: p.demandTonnes });
  assert.equal(p.revenue, sim.revenue);
  assert.equal(p.tonnes, sim.tonnes);
  assert.ok(p.cost > sim.totalOpCost, 'plus landing fees, airframes and the AI stand-in costs');
});

test('published capacity and rate follow frequency and type', () => {
  const cfg = cargoLaneCfg(LANE, { aircraftType: 'b777f', frequency: 10, yieldMultiplier: 1.06 });
  assert.equal(cfg.tonnesPerWeek, getAircraftType('b777f').payloadTonnes * 10);
  assert.ok(Math.abs(cfg.yieldPrice - cargoReferenceYield('DXB', 'FRA') * 1.06) < 0.001);
});

test('a world event reaches rival freight the way it reaches the player’s', () => {
  const c = carrier();
  const cfg = cargoLaneCfg(LANE, { aircraftType: 'b777f', frequency: 3, tails: 1, yieldMultiplier: 1 });
  const calm = competitorCargoLanePnL(c, LANE, cfg, { month: 6 });
  const slump = competitorCargoLanePnL(c, LANE, cfg, { month: 6, world: { demandMultFor: () => 0.5, fuelMult: 1.4 } });
  assert.ok(slump.demandTonnes < calm.demandTonnes * 0.55);
  assert.ok(slump.cost > calm.cost * 0.9);
});

console.log('\nThe contest\n');

const ownFleet = [playerFreighter('f1')];
const own = playerCargoRoute('DXB', 'FRA', 'f1', 7);
const rivalOn = (freq, mult = 1) => carrier({ cargoRoutes: { [LANE]: cargoLaneCfg(LANE,
  { aircraftType: 'b777f', frequency: freq, tails: 1, yieldMultiplier: mult, openedWeek: 1 }) } });

test('the player’s freighter alone on a lane is uncontested, exactly as before', () => {
  assert.equal(cargoLaneAllocations([own], ownFleet, 1.0, { gameDate: GD, competitors: [carrier()] }).get(own.id), undefined);
});

test('a rival freighter of the same size at the same rate splits the lane about evenly — from both seats', () => {
  const rv = rivalOn(7);
  const a = cargoLaneAllocations([{ ...own, weeksOpen: null }], ownFleet, 1.0, { gameDate: GD, competitors: [rv] }).get(own.id);
  assert.ok(a?.contested, 'the player sees the rival');
  const pool = cargoCityPairDemand('DXB', 'FRA', 6);
  assert.ok(Math.abs(a.demandTonnes / pool - 0.5) < 0.02, `player share ${(a.demandTonnes / pool).toFixed(3)}`);
  const contest = buildCargoContest([rv], [own], ownFleet);
  const p = competitorCargoLanePnL(rv, LANE, rv.cargoRoutes[LANE], { month: 6, contest });
  assert.ok(p.contested, 'the rival sees the player');
  assert.ok(Math.abs(p.demandTonnes / pool - 0.5) < 0.02, `rival share ${(p.demandTonnes / pool).toFixed(3)}`);
});

test('a cut-rate rival takes more of the lane than a premium-priced one', () => {
  const cheap = cargoLaneAllocations([{ ...own, weeksOpen: null }], ownFleet, 1.0, { gameDate: GD, competitors: [rivalOn(7, 0.85)] }).get(own.id);
  const dear  = cargoLaneAllocations([{ ...own, weeksOpen: null }], ownFleet, 1.0, { gameDate: GD, competitors: [rivalOn(7, 1.15)] }).get(own.id);
  assert.ok(cheap.demandTonnes < dear.demandTonnes);
});

test('a rival on a metro lane is seen whichever airport the player flies (EWR is New York, keyed by JFK)', () => {
  const k = lane('EWR', 'FRA');
  const rv = carrier({ cargoRoutes: { [k]: cargoLaneCfg(k, { aircraftType: 'b777f', frequency: 7, tails: 1, yieldMultiplier: 1 }) } });
  const r = playerCargoRoute('EWR', 'FRA', 'f1', 7);
  const a = cargoLaneAllocations([r], ownFleet, 1.0, { gameDate: GD, competitors: [rv] }).get(r.id);
  assert.ok(a?.contested, 'EWR–FRA rival must contest EWR–FRA (it was keyed by FRA–JFK and missed)');
  const served = cargoLaneServed({ cargoRoutes: [r], fleet: ownFleet, competitors: [rv], week: 26 }, 'EWR', 'FRA');
  assert.ok(served.rivalTonnes > 0, 'the finder’s Served column sees the rival too');
});

test('the freight screens can name who is on a lane', () => {
  const rv = rivalOn(7);
  const list = cargoRivalsOnLane([rv, carrier({ id: 'other', name: 'Other' })], 'FRA', 'DXB');
  assert.equal(list.length, 1);
  assert.equal(list[0].name, 'Rival Air');
  assert.equal(list[0].tonnesPerWeek, rv.cargoRoutes[LANE].tonnesPerWeek);
});

console.log('\nRunning a freight arm\n');

test('a healthy carrier opens a profitable lane from its hub, with freighter tails keyed to it', () => {
  seed = 5;
  const c = carrier({ routes: Object.fromEntries(['LHR', 'CDG', 'JFK', 'MAD', 'FCO', 'AMS'].map(x => [lane('FRA', x), { frequency: 7, priceMultiplier: 1 }])) });
  let out = null;
  for (let i = 0; i < 30 && !Object.keys(out?.cargoRoutes ?? {}).length; i++) {
    out = manageCompetitorCargo(c, { cash: c.cash, fleet: [], weekNumber: 40, lastProfit: 5_000_000,
      paxRoutes: 6, contest: new Map(), events: [] });
  }
  const lanes = Object.entries(out.cargoRoutes);
  assert.equal(lanes.length, 1);
  const [key, cfg] = lanes[0];
  assert.ok(key.split('-').includes('FRA'), `a lane from the hub, got ${key}`);
  const tails = out.fleet.filter(isCargoTail);
  assert.equal(tails.length, cfg.tails);
  assert.ok(tails.every(t => t.routeKey === cargoTailKey(key) && t.cargo === true && getAircraftType(t.typeId).freighter));
  assert.ok(out.cash < c.cash, 'the deposit was paid');
  assert.ok(competitorCargoLanePnL(c, key, cfg, { month: 6 }).profit > 0);
});

test('no freight before the opening board settles, without a network, when unprofitable, or with the option off', () => {
  const base = { cash: 900_000_000, fleet: [], lastProfit: 5_000_000, paxRoutes: 8, contest: new Map(), events: [] };
  for (let i = 0; i < 20; i++) {
    seed = 100 + i;
    assert.equal(Object.keys(manageCompetitorCargo(carrier(), { ...base, weekNumber: AI_CARGO_START_WEEK - 1 }).cargoRoutes).length, 0);
    assert.equal(Object.keys(manageCompetitorCargo(carrier(), { ...base, weekNumber: 40, paxRoutes: 2 }).cargoRoutes).length, 0);
    assert.equal(Object.keys(manageCompetitorCargo(carrier(), { ...base, weekNumber: 40, lastProfit: -1 }).cargoRoutes).length, 0);
    assert.equal(Object.keys(manageCompetitorCargo(carrier(), { ...base, weekNumber: 40, launchesAllowed: false }).cargoRoutes).length, 0);
  }
});

test('copycat rivals go after the player’s freight lanes once the player is noticed', () => {
  const contest = buildCargoContest([], [playerCargoRoute('DXB', 'FRA', 'f1', 3)], ownFleet);
  const pick = pickCargoExpansion(carrier({ _archetype: 'copycat' }), { contest, playerNotice: 1, month: 6 });
  assert.equal(pick?.key, LANE);
  assert.equal(pick.onPlayerLane, true);
});

test('a lane that keeps losing money is withdrawn and its freighters go', () => {
  // A rate far below cost: every week loses.
  const cfg = cargoLaneCfg(LANE, { aircraftType: 'b777f', frequency: 3, tails: 1, yieldMultiplier: 0.35 });
  let c = carrier({ cargoRoutes: { [LANE]: cfg }, fleet: [makeCargoTail('rv', 'b777f', LANE)] });
  const events = [];
  for (let w = 0; w <= AI_CARGO_LOSS_WEEKS_TO_CUT / 5 + 1 && c.cargoRoutes[LANE]; w++) {
    const out = manageCompetitorCargo(c, { cash: c.cash, fleet: c.fleet, actEvery: 5, weekNumber: 40,
      lastProfit: 5_000_000, paxRoutes: 6, contest: new Map(), events, launchesAllowed: false });
    c = { ...c, ...out };
  }
  assert.equal(c.cargoRoutes[LANE], undefined);
  assert.equal(c.fleet.filter(isCargoTail).length, 0);
  assert.ok(events.some(e => e.type === 'cargoCut' && e.routeKey === LANE));
});

test('weekly stats fold freight into the carrier’s P&L', () => {
  const rv = rivalOn(7);
  const cargo = computeCompetitorCargoStats(rv, { month: 6 });
  assert.equal(cargo.cargoLanes, 1);
  const pax = { weeklyFlights: 10, weeklyPax: 1000, weeklyRevenue: 1_000_000, weeklyCost: 900_000, weeklyProfit: 100_000 };
  const s = withCargoStats(pax, cargo);
  assert.equal(s.weeklyProfit, 100_000 + cargo.cargoProfit);
  assert.equal(s.weeklyRevenue, 1_000_000 + cargo.cargoRevenue);
  assert.equal(s.weeklyCargoTonnes, cargo.cargoTonnes);
  assert.equal(withCargoStats(pax, computeCompetitorCargoStats(carrier(), {})), pax, 'no freight, no change');
});

console.log('\nThe whole tick\n');

function runWorld(cargo, weeks = 104, s0 = 3) {
  seed = s0;
  let comps = sampleAndInitializeCompetitors(25);
  const events = [];
  for (let w = 1; w <= weeks; w++) {
    const r = tickCompetitorAI(comps, { weekNumber: w, month: ((w - 1) % 12) + 1, cargo,
      playerCargoRoutes: [own], playerFleet: ownFleet });
    events.push(...r.events);
    comps = r.competitors.map(c => ({ ...c, profitHistory: [...(c.profitHistory ?? []), 2_000_000].slice(-12), cash: (c.cash ?? 0) + 2_000_000 }));
  }
  return { comps, events };
}

const on = runWorld(true);
const off = runWorld(false);

test('two years in, several rivals fly freight; with the option off, none do', () => {
  const arms = on.comps.filter(c => Object.keys(c.cargoRoutes ?? {}).length > 0);
  assert.ok(arms.length >= 4, `only ${arms.length} freight arms`);
  assert.equal(off.comps.filter(c => Object.keys(c.cargoRoutes ?? {}).length).length, 0);
  assert.equal(off.events.filter(e => String(e.type).startsWith('cargo')).length, 0);
});

test('every rival freight lane is flown by its own freighters, tail for tail, and budget carriers have none', () => {
  for (const c of on.comps) {
    const lanes = c.cargoRoutes ?? {};
    if (c.tier === 'budget') assert.equal(Object.keys(lanes).length, 0, c.name);
    for (const [key, cfg] of Object.entries(lanes)) {
      const tails = (c.fleet ?? []).filter(t => t.routeKey === cargoTailKey(key));
      assert.equal(tails.length, cfg.tails, `${c.name} ${key}`);
      assert.equal(cfg.tonnesPerWeek, getAircraftType(cfg.aircraftType).payloadTonnes * cfg.frequency);
      assert.ok(cfg.frequency >= 1 && cfg.frequency <= 14);
    }
    // No passenger route ever ends up with a freighter, nor a freight lane with an airliner.
    for (const t of c.fleet ?? []) assert.equal(!!getAircraftType(t.typeId)?.freighter, isCargoTail(t), `${c.name} ${t.routeKey} ${t.typeId}`);
  }
});

test('freighters count in a rival’s fleet value (and so in its takeover floor)', () => {
  const c = on.comps.find(x => (x.fleet ?? []).some(isCargoTail));
  const paxOnly = { ...c, fleet: c.fleet.filter(t => !isCargoTail(t)) };
  assert.ok(competitorFleetNAV(c) > competitorFleetNAV(paxOnly));
});

console.log('\nOrders, heals, mergers, takeovers\n');

test('production lines: freighters ordered for a lane open it when the last one arrives', () => {
  const c = carrier({ linePlans: [{ id: 'p1', kind: 'cargoLaunch', routeKey: cargoTailKey(LANE), typeId: 'b777f',
    weeks: [10, 12], cfg: { aircraftType: 'b777f', frequency: 10, yieldMultiplier: 1 }, event: { type: 'cargoLaunch', routeKey: LANE } }] });
  assert.equal(deliverLinePlans(c, 11).carrier.cargoRoutes, undefined, 'not before the second frame');
  const { carrier: after, events } = deliverLinePlans(c, 12);
  assert.equal(after.cargoRoutes[LANE].tails, 2);
  assert.equal(after.cargoRoutes[LANE].tonnesPerWeek, getAircraftType('b777f').payloadTonnes * 10);
  assert.equal(after.fleet.filter(isCargoTail).length, 2);
  assert.equal(after.linePlans.length, 0);
  assert.equal(events.length, 1);
});

test('the era heal leaves freighter tails alone', () => {
  const c = carrier({ routes: { 'FRA-LHR': { frequency: 7, priceMultiplier: 1, aircraftType: 'a320neo', seats: 180, tails: 1 } },
    fleet: [{ id: 't1', typeId: 'a320neo', routeKey: 'FRA-LHR', ageWeeks: 0 }, makeCargoTail('rv', 'dc873f', LANE)],
    cargoRoutes: { [LANE]: cargoLaneCfg(LANE, { aircraftType: 'dc873f', frequency: 3, tails: 1 }) } });
  const [healed] = healAnachronisticCompetitorFleets([c], 1995);
  assert.equal(healed.fleet.filter(isCargoTail).length, 1);
});

test('a rival merger carries the target\u2019s freight arm, lanes and freighters, to the buyer', () => {
  const cfg = cargoLaneCfg(LANE, { aircraftType: 'b777f', frequency: 7, tails: 1, yieldMultiplier: 1 });
  const filler = (i) => carrier({ id: `f${i}`, name: `Filler ${i}`, homeHub: ['LHR', 'CDG', 'MAD', 'AMS'][i],
    cash: 20_000_000, profitHistory: [-1], routes: { [lane(['LHR', 'CDG', 'MAD', 'AMS'][i], 'JFK')]: { frequency: 7, priceMultiplier: 1 } } });
  const buyer  = carrier({ id: 'buyer', name: 'Buyer', homeHub: 'SIN', cash: 3_000_000_000, profitHistory: [9_000_000],
    routes: { 'HKG-SIN': { frequency: 7, priceMultiplier: 1 } } });
  const target = carrier({ id: 'tgt', name: 'Target', cash: 1_000_000, fireSale: true, marketCap: 20_000_000, profitHistory: [-1],
    routes: { 'FRA-LHR': { frequency: 7, priceMultiplier: 1 } },
    fleet: [makeCargoTail('tgt', 'b777f', LANE)], cargoRoutes: { [LANE]: cfg } });
  const saved = Math.random;
  Math.random = () => 0;          // the merger roll always fires
  let out;
  try { out = tickCompetitorAI([buyer, target, ...[0, 1, 2, 3].map(filler)], { weekNumber: 1, month: 6, mergers: true }); }
  finally { Math.random = saved; }
  const merged = out.competitors.find(c => c.id === 'buyer');
  assert.ok(!out.competitors.some(c => c.id === 'tgt'), 'the target is gone');
  assert.ok(merged.cargoRoutes?.[LANE], 'the buyer flies the lane');
  assert.equal(merged.fleet.filter(t => t.routeKey === cargoTailKey(LANE)).length, 1, 'with the target\u2019s freighter');
});

test('buying a rival brings its freight lanes over as your cargo routes, flown by its freighters', () => {
  const cfg = cargoLaneCfg(LANE, { aircraftType: 'b777f', frequency: 14, tails: 2, yieldMultiplier: 1.06 });
  const target = carrier({
    id: 'r1', marketCap: 300_000_000, cash: 10_000_000,
    routes: { 'FRA-LHR': { frequency: 7, priceMultiplier: 1 } },
    fleet: [{ id: 'a1', typeId: 'a320neo', routeKey: 'FRA-LHR', ageWeeks: 100 },
            makeCargoTail('r1', 'b777f', LANE, true), makeCargoTail('r1', 'b777f', LANE, true)],
    cargoRoutes: { [LANE]: cfg },
  });
  const state = { week: 30, year: 3, hub: 'ORD', airlineName: 'Test Air', cash: 5_000_000_000,
    fleet: [], routes: [], cargoRoutes: [], gates: { ORD: 6 }, routePricing: {}, routeCatering: {},
    competitors: [target, carrier({ id: 'keep' })], codeshareAgreements: [], pendingToasts: [] };
  const next = gameReducer(state, { type: 'ACQUIRE_COMPETITOR', competitorId: 'r1' });
  assert.equal(next.routes.length, 1, 'the passenger route');
  assert.equal(next.cargoRoutes.length, 2, 'one freight route per freighter');
  const freighterIds = new Set(next.fleet.filter(a => getAircraftType(a.typeId).freighter).map(a => a.id));
  assert.equal(freighterIds.size, 2);
  for (const r of next.cargoRoutes) {
    assert.ok(freighterIds.has(r.aircraftId));
    assert.equal(r.cargo, true);
    assert.equal(r.yieldPrice, cfg.yieldPrice, 'keeps the rate the rival charged');
  }
  assert.equal(next.cargoRoutes.reduce((s, r) => s + r.weeklyFrequency, 0), 14);
  assert.ok(next.routes.every(r => !freighterIds.has(r.aircraftId)), 'no freighter on the passenger route');
  assert.ok(next.fleet.filter(a => freighterIds.has(a.id)).every(a => a.status === 'assigned'));
});

test('a new game has rivals flying freight unless it was switched off; old saves have no flag', () => {
  const start = (extra) => gameReducer({ phase: 'setup' }, { type: 'START_GAME', airlineName: 'T', hub: 'FRA', ...extra });
  const s1 = start({});
  assert.equal(s1.rivalFreight, true);
  assert.equal(start({ rivalFreight: false }).rivalFreight, undefined);
});

console.log('\nNews\n');

test('a week of rival freight launches rolls up as freight lanes, not routes', () => {
  const rows = buildWeekNews({ year: 2, week: 3, absWeek: 55, competitorEvents: [
    { type: 'cargoLaunch', name: 'A', routeKey: LANE, description: 'x' },
    { type: 'cargoLaunch', name: 'B', routeKey: 'HKG-NRT', description: 'y' },
  ] });
  const row = rows.find(r => r.data?.eventType === 'cargoLaunch');
  assert.ok(row);
  assert.equal(row.data.total, 2);
  assert.equal(row.data.verb, 'opened');
});

Math.random = realRandom;
console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
