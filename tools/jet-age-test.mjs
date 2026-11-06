// The jet age (src/models/jetAge.js) and the Original 737s — port from Headwinds.
//
// Discord (Kat the Fox, 2026-11-03, about the Headwinds world Timely Takeoff):
// "It's the last week of '66 and the #1 airline has 0 jets. But 406 vanguards",
// and no 737-100/-200 although both flew in 1968. Tailwinds had the same engine
// gap. Here the jet age is NEW GAMES ONLY (Dave, 2026-11-06): START_GAME stamps
// state.jetAgeWorld, and every save without it keeps the old rules for life.
//
// On HEAD a Vanguard on a long sector in 1966 carried exactly what it carried in
// 1957 (tools/_probe/jet-age-head-probe.mjs reproduces it on the HEAD engine).
//
//   node --import ./tools/_register-loader.mjs tools/jet-age-test.mjs

import assert from 'node:assert/strict';
import { gameReducer, freshState } from '../src/store/GameContext.jsx';
import { computeMarketShare, buildRouteMarket } from '../src/models/demand.js';
import { setEraCalendarYear, getEraCalendarYear, referencePrice } from '../src/utils/market.js';
import { simulateRoute, routeDistanceKm, defaultClassPrices, routeQualityBreakdown } from '../src/utils/simulation.js';
import { projectWeek } from '../src/utils/financeProjection.js';
import { projectRouteAddition } from '../src/models/pairShare.js';
import { createForecastWorkerCore } from '../src/utils/finderForecastWorkerCore.js';
import { AIRCRAFT_TYPES, getAircraftType, aircraftAvailability } from '../src/data/aircraft.js';
import { lineOf } from '../src/data/productionLines.js';
import {
  jetAgeAppeal, blendJetAgeAppeal, offersJetAgeCapture, JET_AGE_MAX_LOSS,
  setJetAgeEnabled, jetAgeEnabled,
} from '../src/models/jetAge.js';

let passed = 0, failed = 0;
const realRandom = Math.random;
async function test(name, fn) {
  setJetAgeEnabled(true);
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${(e.stack || e.message).split('\n').slice(0, 5).join('\n      ')}`); failed++; }
  finally { setEraCalendarYear(null); setJetAgeEnabled(false); Math.random = realRandom; }
}

const T = (id) => getAircraftType(id);
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

await test('the appeal curve: props on long sectors once jets are established, nothing else', () => {
  assert.equal(jetAgeAppeal(T('vanguard'), 2000, null), 1, 'classic game (no era calendar)');
  assert.equal(jetAgeAppeal(T('vanguard'), 2000, 1957), 1, 'before the 707');
  assert.equal(jetAgeAppeal(T('vanguard'), 2000, 1966), 1 - JET_AGE_MAX_LOSS, 'full jet age, long sector');
  assert.equal(jetAgeAppeal(T('vanguard'), 350, 1966), 1, 'a short hop stays a prop market');
  assert.equal(jetAgeAppeal(T('caravelle'), 2000, 1966), 1, 'jets are untouched');
  assert.ok(jetAgeAppeal(T('dc3'), 2000, 1966) < 1, 'pistons count as props too');
  const prFreighter = AIRCRAFT_TYPES.find(t => t.freighter && t.category === 'Turboprop');
  if (prFreighter) assert.equal(jetAgeAppeal(prFreighter, 2000, 1966), 1, `freight does not care (${prFreighter.id})`);
  assert.equal(blendJetAgeAppeal([{ type: T('vanguard'), freq: 7 }, { type: T('caravelle'), freq: 7 }], 2000, 1966),
    +(1 - JET_AGE_MAX_LOSS / 2).toFixed(4), 'a half-jet schedule sits halfway');
  setJetAgeEnabled(false);
  assert.equal(jetAgeAppeal(T('vanguard'), 2000, 1966), 1, 'switched off (a game started before the change)');
});

const market = () => ({ ...buildRouteMarket('LHR', 'ATH', { month: 6 }) });
const offer = (id, extra = {}) => ({
  airlineId: id, origin: 'LHR', destination: 'ATH', economyPrice: referencePrice('LHR', 'ATH'), businessPrice: null,
  weeklyFrequency: 7, seatsPerFlight: 139, economySeats: 1e9, businessSeats: 0, totalSeats: 1e9,
  qualityScore: 60, qualityScoreLeisure: 60, qualityScoreBusiness: 60, connectivityBonus: 0, ...extra,
});
const pax = (r) => r.totalPax ?? (r.leisurePax + r.businessPax);

await test('a prop alone on a long sector reaches 65% of the market a jet would', () => {
  const m = market();
  close(pax(computeMarketShare(m, [offer('a', { jetAgeAppeal: 0.65 })])[0]) / pax(computeMarketShare(m, [offer('a')])[0]),
    0.65, 0.02, 'prop/jet passengers');
});

await test('against a jet the prop keeps ~39%, and nobody is turned away', () => {
  const m = market();
  const both = computeMarketShare(m, [offer('prop', { jetAgeAppeal: 0.65 }), offer('jet')]);
  const twin = computeMarketShare(m, [offer('a'), offer('b')]);
  const total = pax(both[0]) + pax(both[1]);
  close(total / (pax(twin[0]) + pax(twin[1])), 1, 0.02, 'the pair carries what two jets would');
  close(pax(both[0]) / total, 0.65 / 1.65, 0.03, 'prop share');
  assert.equal(offersJetAgeCapture([{ jetAgeAppeal: 0.65 }, { jetAgeAppeal: 0.8 }]), 0.8);
});

await test('simulateRoute: a Vanguard on a long sector books less in 1966 than 1957 — in a new game only', () => {
  const ac = { id: 'v', typeId: 'vanguard', ageWeeks: 0 };
  const route = { origin: 'EDI', destination: 'PMI', aircraftId: 'v', weeklyFrequency: 7,
    ticketPrice: Math.round(referencePrice('EDI', 'PMI') * 1.3) };
  setEraCalendarYear(1957); const before = simulateRoute(route, ac);
  setEraCalendarYear(1966); const after = simulateRoute(route, ac);
  assert.ok(before.passengers < 139 * 7, `fixture must be demand-limited: ${before.passengers}`);
  assert.ok(after.passengers < before.passengers * 0.75, `1966 ${after.passengers} pax vs 1957 ${before.passengers}`);
  setJetAgeEnabled(false);
  assert.equal(simulateRoute(route, ac).passengers, before.passengers, 'an older save keeps the old rules');
});

// A new era game at LHR flying one type, re-badged onto the fleet (an era game
// refuses a lease on a type in its first years, a classic one on a Vanguard).
function eraAirline({ typeIds, dests, calYear = 1966, flag = true, spare = null }) {
  let s = gameReducer(freshState(), { type: 'START_GAME', airlineName: 'Props', hub: 'LHR', enableObjectives: false });
  assert.equal(s.jetAgeWorld, true, 'START_GAME stamps the new-game flag');
  s = { ...s, cash: 5e8, competitors: [], encroachments: {}, crewPipeline: false };
  if (!flag) { const { jetAgeWorld: _drop, ...rest } = s; s = rest; }
  dests.forEach((d, i) => {
    s = gameReducer(s, { type: 'LEASE_AIRCRAFT', typeId: 'e175' });
    const ac = s.fleet[s.fleet.length - 1].id;
    s = { ...s, fleet: s.fleet.map(a => (a.id === ac ? { ...a, typeId: typeIds[i] ?? typeIds[0], config: undefined } : a)) };
    s = gameReducer(s, { type: 'ADD_GATE', airportCode: d });
    s = gameReducer(s, { type: 'ADD_ROUTE', aircraftId: ac, origin: 'LHR', destination: d, weeklyFrequency: 7 });
  });
  if (spare) {   // an unassigned tail, leased before the calendar moves to the era
    s = gameReducer(s, { type: 'LEASE_AIRCRAFT', typeId: 'e175' });
    const ac = s.fleet[s.fleet.length - 1].id;
    s = { ...s, fleet: s.fleet.map(a => (a.id === ac ? { ...a, typeId: spare, config: undefined, spare: true } : a)) };
  }
  const routePricing = { ...s.routePricing };
  for (const d of new Set(dests)) routePricing[['LHR', d].sort().join('-')] = defaultClassPrices(Math.round(referencePrice('LHR', d) * 1.3));
  return { ...s, routePricing, startYear: 1950, year: calYear - 1949, week: 10,
    routes: s.routes.map(r => ({ ...r, weeksOpen: 40 })) };
}

await test('the forecast agrees with the tick for a mixed Vanguard/Caravelle pair in a new 1966 game', () => {
  let s = eraAirline({ typeIds: ['vanguard', 'caravelle', 'vanguard'], dests: ['ATH', 'ATH', 'EDI'] });
  assert.equal(s.routes.length, 3, `fixture: ${s.error ?? ''}`);
  Math.random = () => 0.9999999;
  for (let i = 0; i < 2; i++) s = gameReducer(s, { type: 'ADVANCE_WEEK' });
  assert.equal(jetAgeEnabled(), true, 'the reducer published the switch');
  const proj = projectWeek(s);
  const next = gameReducer(s, { type: 'ADVANCE_WEEK' });
  const byId = (rep) => new Map((rep?.routeResults ?? []).map(x => [x.routeId, x]));
  const P = byId(proj.report), A = byId(next.lastReport);
  assert.ok(A.size >= 3, `expected 3 flown routes, got ${A.size}`);
  for (const [id, a] of A) assert.equal(P.get(id)?.passengers, a.passengers, `route ${id}: projected ${P.get(id)?.passengers}, flew ${a.passengers}`);
  const r = s.routes.find(x => x.destination === 'ATH' && s.fleet.find(a => a.id === x.aircraftId)?.typeId === 'vanguard');
  assert.equal(routeQualityBreakdown(r, s.fleet.find(a => a.id === r.aircraftId), s).jetAgeAppeal,
    jetAgeAppeal(T('vanguard'), routeDistanceKm('LHR', 'ATH'), 1966), 'the route screen can explain it');
});

await test('the Route Planner forecasts a jet joining a Vanguard pair the way the tick flies it', () => {
  let s = eraAirline({ typeIds: ['vanguard'], dests: ['ATH'], spare: 'caravelle' });
  const id = s.fleet.find(a => a.spare).id;
  assert.equal(s.fleet.length, 2, 'fixture: a Vanguard on the pair and a spare Caravelle');
  Math.random = () => 0.9999999;
  s = gameReducer(s, { type: 'ADVANCE_WEEK' });
  const key = ['ATH', 'LHR'].sort().join('-');
  const planned = projectRouteAddition(s, { origin: 'LHR', destination: 'ATH', aircraft: s.fleet.find(a => a.id === id),
    weeklyFrequency: 7, classPrices: s.routePricing[key] });
  assert.ok(planned?.shared, 'the planner should see the pair as shared with the Vanguard');
  let t = gameReducer(s, { type: 'ADD_ROUTE', aircraftId: id, origin: 'LHR', destination: 'ATH', weeklyFrequency: 7 });
  assert.ok(t.routes.some(r => r.aircraftId === id), `route did not open: ${t.error ?? ''}`);
  t = { ...t, routes: t.routes.map(r => ({ ...r, weeksOpen: 40 })) };
  const next = gameReducer(t, { type: 'ADVANCE_WEEK' });
  const onPair = new Set(t.routes.map(r => r.id));
  const flown = next.lastReport.routeResults.filter(x => onPair.has(x.routeId)).reduce((n, x) => n + x.passengers, 0);
  const got = planned.mature?.pairPassengers ?? planned.pairPassengers;
  assert.ok(Math.abs(got - flown) <= Math.max(3, flown * 0.02), `planner ${got} pax on the pair vs tick ${flown}`);
});

await test('a save without the flag keeps the old rules through the tick', () => {
  let s = eraAirline({ typeIds: ['vanguard'], dests: ['ATH'], flag: false });
  Math.random = () => 0.9999999;
  s = gameReducer(s, { type: 'ADVANCE_WEEK' });
  assert.equal(jetAgeEnabled(), false, 'the reducer switched it off for this save');
  const r = s.routes[0];
  assert.equal(routeQualityBreakdown(r, s.fleet.find(a => a.id === r.aircraftId), s).jetAgeAppeal, 1);
});

await test('the Route Finder worker publishes the era year and the switch from the held state', () => {
  const handle = createForecastWorkerCore();
  const s = eraAirline({ typeIds: ['vanguard'], dests: ['ATH'] });
  setJetAgeEnabled(false); setEraCalendarYear(null);
  handle({ type: 'state', id: 'x', state: s });
  handle({ type: 'price', jobId: 1, stateId: 'x', ctx: { aircraftTypeId: 'vanguard', weeklyFrequency: 7 }, rows: [] });
  assert.equal(getEraCalendarYear(), 1966);
  assert.equal(jetAgeEnabled(), true);
});

await test('the Original 737s: -100 and -200 from 1968, on one Renton line', () => {
  for (const id of ['b737100', 'b737200']) {
    assert.equal(aircraftAvailability(T(id), 1967), 'future', `${id} in 1967`);
    assert.equal(aircraftAvailability(T(id), 1968), 'new', `${id} in 1968`);
  }
  assert.equal(aircraftAvailability(T('b737100'), 1970), 'used', 'the -100 line closed in 1969');
  assert.equal(lineOf('b737100'), lineOf('b737200'), 'same production line');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
