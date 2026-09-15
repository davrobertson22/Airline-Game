// charter-balance-probe.mjs — @not-a-test: does charter work sit where the
// design says it should?
//
// docs/charter-design.md §7 claims two things that were asserted by feel when
// the fee margins were set, and never measured:
//
//   1. A well-run SCHEDULE beats well-run CHARTER work per block hour. Charters
//      are supposed to win on MARGINAL hours — a tail with spare capacity, a
//      reserve, a season when your leisure routes are dormant — not to be a
//      better business than running an airline. If charter return per block hour
//      beats scheduled return, the optimal play is to stop flying a network and
//      become a charter broker, which is not the game.
//
//   2. The traps are real and the good ones are worth taking. Across the board a
//      player who reads it should clear a useful margin; one who signs
//      everything should not.
//
// Prints, never asserts. Balance is a judgement call — this is the evidence.
//
//   node --import ./tools/_register-loader.mjs tools/charter-balance-probe.mjs [weeks=260]

import { generateCharterBoard, servedAirportsOf, quoteCharterForAircraft } from '../src/models/charterBoard.js';
import { referenceTypeFor, CHARTER_TYPES } from '../src/data/charters.js';
import { getAircraftType, AIRCRAFT_TYPES } from '../src/data/aircraft.js';
import {
  simulateCharter, simulateRoute, routeBlockHours, blockTimeHours, defaultConfig,
  routeDistanceKm, MAX_WEEKLY_BLOCK_HOURS, formatMoney, referencePrice,
} from '../src/utils/simulation.js';
import { weeklyLandingFee } from '../src/data/overhead.js';
import { getAirport } from '../src/data/airports.js';

const WEEKS = Number(process.argv[2]) || 260;

const state = {
  airlineName: 'Balance Air', hub: 'SFO', homeCountry: 'US',
  gates: { SFO: 6, LAX: 3, ORD: 2 },
  hubs: { SFO: { tier: 2 } },
  routes: [
    { origin: 'SFO', destination: 'JFK' }, { origin: 'SFO', destination: 'SEA' },
    { origin: 'SFO', destination: 'ORD' }, { origin: 'LAX', destination: 'DFW' },
  ],
  cargoRoutes: [], charters: [],
  awareness: 70, gameDate: { month: 7 }, charterReliability: 50,
  fuelPrice: { index: 1.0 }, activeEvents: [],
  lastReport: { reputationScore: 65 },
};

const tailFor = (typeId) => ({
  id: 'probe', typeId, status: 'idle', ageWeeks: 60,
  ownershipType: 'owned', fuelMod: 1.0,
});

const money = (n) => formatMoney(Math.round(n));
const pct = (n) => `${(n * 100).toFixed(1)}%`;

// ── 1. What the board actually pays, flown with the RIGHT metal ─────────────
//
// "The right metal" = the reference type the fee was priced against. This is the
// best case an informed player can reach, so it is the ceiling on charter work.

let n = 0, traps = 0;
let sumProfit = 0, sumHours = 0, sumFee = 0;
let trapProfit = 0, trapHours = 0;
let goodProfit = 0, goodHours = 0;
const byType = new Map();

for (let w = 0; w < WEEKS; w++) {
  const at = { ...state, gameDate: { month: (Math.floor(w / 4.33) % 12) + 1 } };
  for (const offer of generateCharterBoard(at, w)) {
    const type = getAircraftType(offer.refTypeId);
    if (!type) continue;
    const ac = tailFor(offer.refTypeId);
    const contract = {
      ...offer, aircraftId: 'probe', weeklyFrequency: offer.flightsPerWeek,
      stops: [offer.origin, offer.destination], status: 'active',
      originServed: true, destServed: true,
    };
    const r = simulateCharter(contract, ac, 1.0);
    if (!r) continue;

    const weeks = offer.weeks;
    const profit = r.profit * weeks;
    const hours  = r.blockHours * weeks;

    n += 1;
    sumProfit += profit; sumHours += hours; sumFee += offer.fee;
    if (offer.isTrap) { traps += 1; trapProfit += profit; trapHours += hours; }
    else              { goodProfit += profit; goodHours += hours; }

    const key = offer.type;
    const e = byType.get(key) ?? { n: 0, profit: 0, hours: 0 };
    e.n += 1; e.profit += profit; e.hours += hours;
    byType.set(key, e);
  }
}

console.log(`\n── Charter board, ${WEEKS} weeks, flown with the metal the fee was priced against ──`);
console.log(`  offers            ${n}  (${traps} traps, ${pct(traps / n)})`);
console.log(`  total fees        ${money(sumFee)}`);
console.log(`  total profit      ${money(sumProfit)}`);
console.log(`  profit / block hr ${money(sumHours > 0 ? sumProfit / sumHours : 0)}`);
console.log('');
console.log(`  signing EVERYTHING   ${money(sumHours > 0 ? sumProfit / sumHours : 0)}/hr over ${Math.round(sumHours).toLocaleString()} hrs`);
console.log(`  signing only GOOD    ${money(goodHours > 0 ? goodProfit / goodHours : 0)}/hr over ${Math.round(goodHours).toLocaleString()} hrs`);
console.log(`  signing only TRAPS   ${money(trapHours > 0 ? trapProfit / trapHours : 0)}/hr over ${Math.round(trapHours).toLocaleString()} hrs`);

console.log('\n  by contract type:');
for (const [type, e] of [...byType.entries()].sort((a, b) => b[1].n - a[1].n)) {
  console.log(`    ${String(type).padEnd(16)} n=${String(e.n).padStart(4)}  ${money(e.hours > 0 ? e.profit / e.hours : 0)}/blk hr`);
}

// ── 2. The same board flown with the WRONG metal ─────────────────────────────
//
// One size class up from the reference. This is the mistake the feature is built
// around, and it should hurt.

let wrongProfit = 0, wrongHours = 0, wrongN = 0;
for (let w = 0; w < WEEKS; w += 2) {
  for (const offer of generateCharterBoard(state, w)) {
    const ref = getAircraftType(offer.refTypeId);
    if (!ref || offer.freighter) continue;
    // The cheapest CURRENT type that is at least 40% bigger than the reference.
    const bigger = AIRCRAFT_TYPES
      .filter(t => !t.freighter && t.oop == null && t.withdrawnYear == null
        && (t.seats ?? 0) >= (ref.seats ?? 0) * 1.4
        && (t.range ?? 0) >= offer.distanceKm
        && (t.runwayFt ?? 0) <= offer.runwayFt)
      .sort((a, b) => (a.seats ?? 0) - (b.seats ?? 0))[0];
    if (!bigger) continue;
    const contract = {
      ...offer, aircraftId: 'probe', weeklyFrequency: offer.flightsPerWeek,
      stops: [offer.origin, offer.destination], status: 'active',
      originServed: true, destServed: true,
    };
    const r = simulateCharter(contract, tailFor(bigger.id), 1.0);
    if (!r) continue;
    wrongN += 1;
    wrongProfit += r.profit * offer.weeks;
    wrongHours  += r.blockHours * offer.weeks;
  }
}
console.log(`\n── The same contracts, flown one size class too big (n=${wrongN}) ──`);
console.log(`  profit / block hr ${money(wrongHours > 0 ? wrongProfit / wrongHours : 0)}`);

// ── 3. The comparison that actually decides the balance ──────────────────────
//
// A scheduled route on the same lane, same aircraft, same frequency, mature and
// sensibly priced — what those block hours earn if you fly your own network with
// them instead. Charter should lose this on average.

console.log('\n── Scheduled flying vs charter, same metal, same lanes ──');
const LANES = [
  ['SFO', 'JFK'], ['SFO', 'SEA'], ['SFO', 'ORD'], ['LAX', 'DFW'],
  ['JFK', 'LHR'], ['SFO', 'HNL'], ['ORD', 'DEN'], ['LAX', 'SEA'],
];
let schedProfit = 0, schedHours = 0;
for (const [o, d] of LANES) {
  const dist = routeDistanceKm(o, d);
  const ref = referenceTypeFor({ originCode: o, destCode: d, seats: 150, flightsPerWeek: 7 });
  if (!ref) continue;
  const type = ref.type;
  const ac = { id: 'a', typeId: type.id, ageWeeks: 60, config: defaultConfig(type.seats) };
  // A fare is not optional: simulateRoute with no ticketPrice sells nothing and
  // reports a 0% load factor, which made the first run of this probe compare
  // charter work against an airline that had forgotten to price its seats.
  const route = {
    id: 'r', origin: o, destination: d, hub: 'SFO', hubSpokes: 12,
    aircraftId: 'a', weeklyFrequency: 7, weeksOpen: 60,
    ticketPrice: referencePrice(o, d),
  };
  const r = simulateRoute(route, ac, { week: 30, month: 7 });
  if (!r) continue;
  const landing = weeklyLandingFee(type.category, 7,
    getAirport(o)?.tier ?? 'major', getAirport(d)?.tier ?? 'major');
  const profit = r.revenue - r.totalOpCost - landing;
  const hours  = routeBlockHours(route, type, 7);
  schedProfit += profit; schedHours += hours;
  console.log(`  ${o}–${d} ${String(Math.round(dist)).padStart(5)}km  ${String(type.id).padEnd(14)} `
    + `${money(hours > 0 ? profit / hours : 0)}/blk hr   lf ${pct(r.loadFactor ?? 0)}`);
}
const schedPerHour  = schedHours > 0 ? schedProfit / schedHours : 0;
const charterGood   = goodHours > 0 ? goodProfit / goodHours : 0;
const charterAll    = sumHours > 0 ? sumProfit / sumHours : 0;

console.log('');
console.log(`  scheduled, mature, well-priced   ${money(schedPerHour)}/blk hr`);
console.log(`  charter, good offers only        ${money(charterGood)}/blk hr`);
console.log(`  charter, signing everything      ${money(charterAll)}/blk hr`);
console.log('');
if (charterGood > schedPerHour) {
  console.log(`  ⚠️  Charter beats the schedule by ${money(charterGood - schedPerHour)}/blk hr.`);
  console.log(`      §7 says it should not: the optimal play becomes "stop flying a network".`);
  console.log(`      Lower CHARTER_MARGIN_GOOD in src/data/charters.js.`);
} else {
  console.log(`  ✓  The schedule wins by ${money(schedPerHour - charterGood)}/blk hr `
    + `(${pct(schedPerHour > 0 ? (schedPerHour - charterGood) / schedPerHour : 0)}), which is what §7 wants:`);
  console.log(`     charters are worth flying on MARGINAL hours, not instead of an airline.`);
}
