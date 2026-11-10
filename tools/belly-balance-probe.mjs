// @not-a-test
// Belly cargo balance probe (claude/belly-cargo-design.md, build step 1).
//
//   node --import ./tools/_register-loader.mjs tools/belly-balance-probe.mjs [routes|airline|all]
//
// routes  : one airline, one route, 22 weeks, with and without belly cargo.
// airline : a scripted mixed airline and the rival field over 2 and 5 years,
//           belly world against the same seed without it.
import { gameReducer, freshState } from '../src/store/GameContext.jsx';
import { AIRCRAFT_TYPES } from '../src/data/aircraft.js';
import { defaultClassPrices, referencePrice } from '../src/utils/simulation.js';
import { routeDistance, cargoCityPairDemand } from '../src/utils/market.js';
import { BELLY } from '../src/models/bellyCargo.js';

const mode = process.argv[2] ?? 'all';
// Try other settings without editing the model: BELLY_RATE=0.5 BELLY_FILL=0.6 BELLY_MAINDECK=0.4
if (process.env.BELLY_RATE) BELLY.rateFactor = Number(process.env.BELLY_RATE);
if (process.env.BELLY_FILL) BELLY.fillCeiling = Number(process.env.BELLY_FILL);
if (process.env.BELLY_MAINDECK) BELLY.mainDeckShare = Number(process.env.BELLY_MAINDECK);
const find = (re, freighter = false) => AIRCRAFT_TYPES.find(t => re.test(t.name) && !!t.freighter === freighter);
const seeded = (seed) => () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const money = (n) => (n < 0 ? '-' : '') + '$' + Math.abs(Math.round(n)).toLocaleString('en-US');
const pct = (n) => (100 * n).toFixed(1) + '%';

function start(hub, belly, seed, extra = {}) {
  Math.random = seeded(seed);
  let s = gameReducer(freshState(), { type: 'START_GAME', airlineName: 'Probe', hub, enableObjectives: false, productionLines: false, ...extra });
  return { ...s, cash: 5e9, newWorldRestrictions: true, ...(belly ? { bellyCargoWorld: true } : {}) };
}
function openRoute(s, typeId, o, d, freq, cargo = false) {
  for (const code of [o, d]) while ((s.gates?.[code] ?? 0) * 50 < 60 + (cargo ? 0 : 0) + freq + ((s.routes ?? []).concat(s.cargoRoutes ?? []).filter(r => r.origin === code || r.destination === code).reduce((x, r) => x + r.weeklyFrequency, 0))) {
    const g = s.gates?.[code] ?? 0; s = gameReducer(s, { type: 'ADD_GATE', airportCode: code }); if ((s.gates?.[code] ?? 0) === g) break;
  }
  let left = freq, guard = 0;
  while (left > 0 && guard++ < 12) {
    const n = s.fleet.length; s = gameReducer(s, { type: 'BUY_AIRCRAFT', typeId }); if (s.fleet.length === n) break;
    const a = s.fleet[s.fleet.length - 1];
    let placed = 0;
    for (let k = Math.min(left, 28); k >= 1; k--) {
      const before = cargo ? (s.cargoRoutes ?? []).length : s.routes.length;
      const s2 = gameReducer({ ...s, error: null }, cargo
        ? { type: 'ADD_CARGO_ROUTE', aircraftId: a.id, origin: o, destination: d, weeklyFrequency: k }
        : { type: 'ADD_ROUTE', aircraftId: a.id, origin: o, destination: d, weeklyFrequency: k });
      const after = cargo ? (s2.cargoRoutes ?? []).length : s2.routes.length;
      if (after > before) { s = s2; placed = k; break; }
    }
    if (!placed) break; left -= placed;
  }
  if (!cargo) s = { ...s, routePricing: { ...s.routePricing, [[o, d].sort().join('-')]: defaultClassPrices(Math.round(referencePrice(o, d))) } };
  return s;
}
function run(s, weeks, each = null) {
  for (const g of ['pilots', 'cabinCrew', 'groundStaff', 'maintenanceTeam']) s = gameReducer(s, { type: 'HIRE_CREW', group: g, bodies: 700, startNow: true });
  for (let i = 0; i < weeks; i++) {
    s = gameReducer(s, { type: 'ADVANCE_WEEK' });
    if (s.cash < 1e9) s = { ...s, cash: s.cash + 4e9, _topups: (s._topups ?? 0) + 1, consecutiveNegativeWeeks: 0, missedLoanPayments: 0 };
    each?.(s, i);
  }
  return s;
}

const ROUTES = [
  ['JFK', 'LHR', /787-9/, 14, 'wide long'], ['LAX', 'NRT', /787-9/, 7, 'wide long'], ['HKG', 'LAX', /777-300ER/, 7, 'wide long'],
  ['SIN', 'LHR', /A350-900/, 7, 'wide long'], ['SYD', 'LAX', /787-9/, 7, 'wide long'], ['FRA', 'JFK', /A330-300/, 7, 'wide long'],
  ['DXB', 'LHR', /A380/, 7, 'double deck'], ['SIN', 'BKK', /A330-300/, 14, 'wide medium'], ['LHR', 'DXB', /777-300ER/, 7, 'wide medium'],
  ['HND', 'CTS', /787-9/, 14, 'wide medium'], ['JFK', 'LAX', /A321neo/, 21, 'narrow'], ['LHR', 'MAD', /A320neo/, 21, 'narrow'],
  ['ORD', 'DEN', /737-800/, 21, 'narrow'], ['SIN', 'HKG', /A321neo/, 14, 'narrow'], ['JFK', 'LHR', /A321XLR/, 7, 'narrow'],
];

if (mode === 'routes' || mode === 'all') {
  console.log('\n== Single routes, no rival, average of weeks 21-30 ==');
  console.log(`rate ${BELLY.rateFactor} · fill ${BELLY.fillCeiling} · main-deck share ${BELLY.mainDeckShare}`);
  console.log(['route', 'aircraft', 'class', 'km', 'flts/wk', 'belly t/flt', 'pax rev', 'belly rev', 'share', 'belly cost', 'route profit before', 'after', 'profit lift'].join(' | '));
  const byClass = {};
  for (const [o, d, re, f, cls] of ROUTES) {
    const t = find(re); if (!t) { console.log('  (no type for', re, ')'); continue; }
    // One belly-world run with the rival field removed; "before" is the same
    // weeks with the belly lines taken back out, so nothing else differs.
    let s = openRoute({ ...start(o, true, 4242), competitors: [] }, t.id, o, d, f);
    const acc = { rev: 0, bellyRev: 0, bellyCost: 0, cap: 0, true: 0, n: 0 };
    s = run(s, 30, (st, i) => {
      if (i < 20) return;
      const rr = st.lastReport?.routeResults ?? [];
      const sum = (k) => rr.reduce((x, r) => x + (r[k] ?? 0), 0);
      acc.rev += sum('revenue'); acc.bellyRev += sum('bellyRevenue'); acc.bellyCost += sum('bellyHandlingCost') + sum('bellyFuelCost');
      acc.cap += sum('bellyCapacity'); acc.true += sum('trueProfit'); acc.n++;
    });
    const w = (k) => acc[k] / Math.max(1, acc.n);
    const flights = s.routes.reduce((x, r) => x + r.weeklyFrequency, 0);
    const paxRev = w('rev') - w('bellyRev'), after = w('true'), before = after - (w('bellyRev') - w('bellyCost'));
    const share = w('rev') > 0 ? w('bellyRev') / w('rev') : 0;
    (byClass[cls] ??= []).push(share);
    console.log([o + '-' + d, t.name, cls, Math.round(routeDistance(o, d)), flights, flights ? (w('cap') / flights).toFixed(1) : '0', money(paxRev), money(w('bellyRev')), pct(share), money(w('bellyCost')), money(before), money(after), before > 0 ? '+' + pct(after / before - 1) : 'n/a'].join(' | '));
  }
  console.log('\nBelly share of route revenue, by class (mean):');
  for (const [k, v] of Object.entries(byClass)) console.log('  ' + k + ': ' + pct(v.reduce((a, c) => a + c, 0) / v.length) + '  (' + v.map(pct).join(', ') + ')');
}

if (mode === 'airline' || mode === 'all') {
  // Two runs that differ only by the flag do NOT stay comparable: the first
  // changed number changes a rival decision and the worlds drift apart. So the
  // belly effect is read INSIDE belly-world runs (belly lines against the same
  // week's totals), and the with/without comparison is an average over seeds.
  const SEEDS = (process.argv[3] ?? '11,23,37,59').split(',').map(Number);
  console.log('\n== Mixed airline at JFK and the rival field, ' + SEEDS.length + ' seeds, 5 years ==');
  const NET = [[/787-9/, 'LHR', 14], [/787-9/, 'CDG', 7], [/787-9/, 'NRT', 7], [/777-300ER/, 'HKG', 7], [/A330-300/, 'FRA', 7],
    [/A321neo/, 'LAX', 21], [/A321neo/, 'SFO', 14], [/737-800/, 'ORD', 21], [/737-800/, 'ATL', 21], [/737-800/, 'MIA', 14], [/A320neo/, 'DFW', 14], [/A320neo/, 'BOS', 21]];
  const FRT = [[/777F|777-200F|777 Freighter/, 'FRA', 5], [/767-300F/, 'LHR', 5]];
  const rows = { false: [], true: [] };
  for (const seed of SEEDS) for (const belly of [false, true]) {
    let s = start('JFK', belly, seed);
    for (const [re, d, f] of NET) { const t = find(re); if (t) s = openRoute(s, t.id, 'JFK', d, f); }
    for (const [re, d, f] of FRT) { const t = find(re, true); if (t) s = openRoute(s, t.id, 'JFK', d, f, true); }
    const m = { rev: 0, opProfit: 0, belly: 0, bellyNet: 0, cargo: 0, rivalProfit: 0, rivalBellyProfit: 0, rivalBellyRev: 0, rivalRev: 0, n: 0 };
    s = run(s, 260, (st, i) => {
      if (i < 52) return;                      // let the network and the field settle
      const r = st.lastReport ?? {};
      m.rev += r.totalRevenue ?? 0; m.opProfit += (r.totalRevenue ?? 0) - (r.totalCostAll ?? r.totalCost ?? 0);
      m.belly += r.totalBellyRevenue ?? 0; m.bellyNet += (r.totalBellyRevenue ?? 0) - (r.totalBellyCost ?? 0); m.cargo += r.totalCargoRevenue ?? 0;
      for (const c of st.competitors ?? []) { const w = c.weeklyStats ?? {};
        m.rivalProfit += w.weeklyProfit ?? 0; m.rivalRev += w.weeklyRevenue ?? 0; m.rivalBellyProfit += w.weeklyBellyProfit ?? 0; m.rivalBellyRev += w.weeklyBellyRevenue ?? 0; }
      m.n++;
    });
    const comps = s.competitors ?? [];
    rows[belly].push({ ...m, rivals: comps.length, rivalCash: comps.reduce((x, c) => x + (c.cash ?? 0), 0),
      rivalFreightLanes: comps.reduce((x, c) => x + Object.keys(c.cargoRoutes ?? {}).length, 0) });
  }
  const mean = (arr, k) => arr.reduce((x, r) => x + r[k], 0) / arr.length;
  const B = rows[true], N = rows[false];
  console.log('\nInside the belly worlds (years 2-5, mean of seeds):');
  console.log('  player: belly share of revenue          ' + pct(mean(B, 'belly') / mean(B, 'rev')));
  console.log('  player: belly net as share of op profit ' + pct(mean(B, 'bellyNet') / Math.max(1, mean(B, 'opProfit'))) + '   (op profit/yr ' + money(mean(B, 'opProfit') / 4) + ', belly net/yr ' + money(mean(B, 'bellyNet') / 4) + ')');
  console.log('  rivals: belly share of revenue          ' + pct(mean(B, 'rivalBellyRev') / mean(B, 'rivalRev')));
  console.log('  rivals: belly profit as share of profit ' + pct(mean(B, 'rivalBellyProfit') / Math.max(1, mean(B, 'rivalProfit'))));
  console.log('\nWith against without (mean of seeds; per-seed values in brackets):');
  const line = (label, k, f = money) => console.log('  ' + label.padEnd(34) + 'none ' + f(mean(N, k)) + '   belly ' + f(mean(B, k)) + '   [' + N.map(r => f(r[k])).join(', ') + ' | ' + B.map(r => f(r[k])).join(', ') + ']');
  line('player freighter revenue, 4 yrs', 'cargo');
  line('rivals alive at year 5', 'rivals', (n) => n.toFixed(1));
  line('rival cash at year 5', 'rivalCash');
  line('rival profit, 4 yrs', 'rivalProfit');
  line('rival freight lanes at year 5', 'rivalFreightLanes', (n) => n.toFixed(1));
}
