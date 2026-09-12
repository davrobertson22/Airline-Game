// ai-network-variety-test.mjs — rival networks must not all converge on the
// same size.
// Run: node tools/ai-network-variety-test.mjs
//
// Regression for Discord 2026-09-10 (wj): "why do all ai airlines have 62
// planes and 30 routes". MAX_ROUTES used to be a flat per-tier ceiling, so
// every carrier of a tier grew to exactly that number and stopped — by game
// year 5 every legacy rival sat on 30 routes with a fleet clustered around one
// figure, because fleet size is a function of route count. carrierMaxRoutes()
// now gives each carrier its own ceiling from its id hash, archetype and hub.
//
// Determinism: the ceiling section is pure (it reads the whole 70-airline bank,
// no sampling). The simulation section seeds Math.random, because the carrier
// SAMPLE is random — an unseeded run can deal a tier only four carriers whose
// ceilings happen to sit close together, and a spread assertion on four draws
// fails perhaps one run in ten. A flaky suite in a 135-suite parallel run is
// worse than no suite, so the dice are pinned here and the spread is asserted
// exhaustively over the bank instead.

import {
  sampleAndInitializeCompetitors,
  computeCompetitorWeeklyStats,
  buildPairIncumbents,
  COMPETITOR_AIRLINES,
} from '../src/models/demand.js';
import { tickCompetitorAI, retainedProfit, carrierMaxRoutes } from '../src/models/competitorAI.js';
import { computeMarketCap } from '../src/utils/market.js';

let failures = 0;
function check(name, cond, detail = '') {
  if (cond) { console.log(`  ✓ ${name}`); }
  else      { console.error(`  ✗ ${name} ${detail}`); failures++; }
}

// ── 1. Ceilings, over the whole bank — no sampling, no randomness ───────────
console.log('── carrierMaxRoutes across the full carrier bank ──');

const ARCHES = ['expansionist', 'aggressive', 'copycat', 'balanced', 'fortress', 'niche'];
const ceilingOf = (c, extra = {}) => carrierMaxRoutes({ ...c, _archetype: 'balanced', ...extra });

check('deterministic — same carrier, same answer',
  COMPETITOR_AIRLINES.every(c => ceilingOf(c) === ceilingOf({ ...c })));

for (const tier of ['budget', 'legacy', 'premium']) {
  const inTier = COMPETITOR_AIRLINES.filter(c => c.tier === tier);
  if (!inTier.length) { check(`${tier}: bank has carriers`, false); continue; }
  const ns = inTier.map(c => ceilingOf(c));
  const distinct = new Set(ns).size;
  const modal = Math.max(...Object.values(ns.reduce((m, v) => (m[v] = (m[v] ?? 0) + 1, m), {})));
  console.log(`  ${tier}: ${inTier.length} carriers, ceilings ${Math.min(...ns)}–${Math.max(...ns)} (${distinct} distinct)`);
  check(`${tier}: ceilings are not one number`, distinct >= Math.min(8, inTier.length),
    `${distinct} distinct across ${inTier.length} carriers`);
  check(`${tier}: no ceiling claims more than a third of the tier`, modal / ns.length <= 0.34,
    `${Math.round(modal / ns.length * 100)}% share one ceiling`);
  check(`${tier}: biggest ceiling is at least 2x the smallest`,
    Math.max(...ns) >= Math.min(...ns) * 2, `${Math.min(...ns)} → ${Math.max(...ns)}`);
  check(`${tier}: ceilings stay in a sane band`, ns.every(n => n >= 8 && n <= 64),
    `min ${Math.min(...ns)} max ${Math.max(...ns)}`);
}

console.log('── the factors move the ceiling in the right direction ──');
const ref = COMPETITOR_AIRLINES[0];
check('an expansionist outgrows a niche carrier',
  ceilingOf(ref, { _archetype: 'expansionist' }) > ceilingOf(ref, { _archetype: 'niche' }),
  `${ceilingOf(ref, { _archetype: 'niche' })} → ${ceilingOf(ref, { _archetype: 'expansionist' })}`);
check('archetype ordering holds for every carrier in the bank',
  COMPETITOR_AIRLINES.every(c =>
    ceilingOf(c, { _archetype: 'expansionist' }) >= ceilingOf(c, { _archetype: 'balanced' })
    && ceilingOf(c, { _archetype: 'balanced' }) >= ceilingOf(c, { _archetype: 'niche' })));
check('every archetype yields a legal ceiling',
  COMPETITOR_AIRLINES.every(c => ARCHES.every(a => {
    const n = ceilingOf(c, { _archetype: a });
    return Number.isInteger(n) && n >= 8 && n <= 64;
  })));
check('a second hub lifts the ceiling',
  COMPETITOR_AIRLINES.every(c => ceilingOf(c, { secondaryHub: 'ORD' }) >= ceilingOf(c))
  && ceilingOf(ref, { secondaryHub: 'ORD' }) > ceilingOf(ref),
  `${ceilingOf(ref)} → ${ceilingOf(ref, { secondaryHub: 'ORD' })}`);

// ── 2. A seeded 10-year world actually ends up varied ───────────────────────
console.log('── 10-year simulation (seeded) ──');
const realRandom = Math.random;
let _s = 0x9e3779b9;
Math.random = function seeded() {
  _s |= 0; _s = (_s + 0x6D2B79F5) | 0;
  let t = Math.imul(_s ^ (_s >>> 15), 1 | _s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

try {
  let comps = sampleAndInitializeCompetitors(25);
  const playerRoutes = [
    { origin: 'JFK', destination: 'LHR', ticketPrice: 620, weeklyFrequency: 14 },
    { origin: 'JFK', destination: 'LAX', ticketPrice: 380, weeklyFrequency: 21 },
  ];
  for (let wk = 1; wk <= 520; wk++) {
    const month = Math.min(12, Math.ceil(((wk - 1) % 52 + 1) / 4.34));
    const r = tickCompetitorAI(comps, {
      weekNumber: wk, month, playerRoutes,
      playerHubs: ['JFK'], playerMarketCap: 50_000_000 + wk * 3_000_000,
    });
    const pairCounts = buildPairIncumbents(r.competitors, playerRoutes);
    comps = r.competitors.map(c => {
      const stats = computeCompetitorWeeklyStats(c, month, pairCounts);
      const cash  = (c.cash ?? 0) + retainedProfit(c.cash ?? 0, stats.weeklyProfit);
      const ph    = [...(c.profitHistory ?? []), stats.weeklyProfit].slice(-12);
      const { marketCap, sharePrice } = computeMarketCap(ph, cash, c.baseQualityScore);
      return { ...c, weeklyStats: stats, cash, profitHistory: ph, marketCap, sharePrice };
    });
  }

  const rows = comps.map(c => ({
    tier: c.tier,
    routes: Object.keys(c.routes ?? {}).length,
    fleet:  (c.fleet ?? []).length,
  }));

  // The old bug in one line: across the WHOLE board, route counts collapsed to
  // one value per tier. Asserted board-wide so it does not depend on how many
  // carriers of a given tier the sample happened to deal.
  const allRoutes = rows.map(r => r.routes);
  const allFleets = rows.map(r => r.fleet);
  console.log(`  board: ${rows.length} carriers, routes ${Math.min(...allRoutes)}–${Math.max(...allRoutes)} (${new Set(allRoutes).size} distinct), fleet ${Math.min(...allFleets)}–${Math.max(...allFleets)} (${new Set(allFleets).size} distinct)`);
  check('board-wide route counts are well spread',
    new Set(allRoutes).size >= Math.ceil(rows.length * 0.6),
    `${new Set(allRoutes).size} distinct across ${rows.length} carriers`);
  check('board-wide fleet sizes are well spread',
    new Set(allFleets).size >= Math.ceil(rows.length * 0.6),
    `${new Set(allFleets).size} distinct across ${rows.length} carriers`);

  for (const tier of ['budget', 'legacy', 'premium']) {
    const inTier = rows.filter(r => r.tier === tier);
    if (inTier.length < 4) { console.log(`  ℹ ${tier}: only ${inTier.length} carriers in this sample, skipped`); continue; }
    const routes = inTier.map(r => r.routes);
    const distinct = new Set(routes).size;
    const modalShare = Math.max(...Object.values(routes.reduce((m, v) => (m[v] = (m[v] ?? 0) + 1, m), {}))) / routes.length;
    console.log(`  ${tier}: ${inTier.length} carriers, routes ${Math.min(...routes)}–${Math.max(...routes)} (${distinct} distinct)`);
    check(`${tier}: route counts are not one number`, distinct >= Math.max(2, Math.ceil(inTier.length * 0.5)),
      `${distinct} distinct across ${inTier.length} carriers`);
    check(`${tier}: no single route count dominates the tier`, modalShare <= 0.5,
      `${Math.round(modalShare * 100)}% of carriers share one route count`);
  }
} finally {
  Math.random = realRandom;
}

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
