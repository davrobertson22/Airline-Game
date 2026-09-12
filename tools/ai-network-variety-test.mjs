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

import {
  sampleAndInitializeCompetitors,
  computeCompetitorWeeklyStats,
  buildPairIncumbents,
} from '../src/models/demand.js';
import { tickCompetitorAI, retainedProfit, carrierMaxRoutes } from '../src/models/competitorAI.js';
import { computeMarketCap } from '../src/utils/market.js';

let failures = 0;
function check(name, cond, detail = '') {
  if (cond) { console.log(`  ✓ ${name}`); }
  else      { console.error(`  ✗ ${name} ${detail}`); failures++; }
}

console.log('── carrierMaxRoutes is stable and spread ──');
const sample = sampleAndInitializeCompetitors(25);
const ceilings = sample.map(c => carrierMaxRoutes({ ...c, _archetype: 'balanced' }));
check('deterministic for a given carrier',
  sample.every(c => carrierMaxRoutes(c) === carrierMaxRoutes({ ...c })));
check('ceilings are not all equal', new Set(ceilings).size > 1,
  `only ${new Set(ceilings).size} distinct value(s)`);
check('ceilings stay in a sane band', ceilings.every(n => n >= 8 && n <= 64),
  `min ${Math.min(...ceilings)} max ${Math.max(...ceilings)}`);
const withSecond = carrierMaxRoutes({ ...sample[0], secondaryHub: 'ORD' });
check('a second hub lifts the ceiling', withSecond > carrierMaxRoutes(sample[0]),
  `${carrierMaxRoutes(sample[0])} → ${withSecond}`);

console.log('── 10-year simulation ──');
let comps = sample;
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

const byTier = {};
for (const c of comps) {
  (byTier[c.tier] ??= []).push({
    routes: Object.keys(c.routes ?? {}).length,
    fleet:  (c.fleet ?? []).length,
  });
}

// The old bug: within a tier every carrier landed on ONE route count. Require
// real spread wherever a tier has enough carriers to judge it.
for (const [tier, rows] of Object.entries(byTier)) {
  if (rows.length < 4) { console.log(`  ℹ ${tier}: only ${rows.length} carriers, skipped`); continue; }
  const routes = rows.map(r => r.routes);
  const fleets = rows.map(r => r.fleet);
  const distinctR = new Set(routes).size;
  const distinctF = new Set(fleets).size;
  const modalShare = Math.max(...Object.values(routes.reduce((m, v) => (m[v] = (m[v] ?? 0) + 1, m), {}))) / routes.length;
  console.log(`  ${tier}: ${rows.length} carriers, routes ${Math.min(...routes)}–${Math.max(...routes)} (${distinctR} distinct), fleet ${Math.min(...fleets)}–${Math.max(...fleets)} (${distinctF} distinct)`);
  check(`${tier}: route counts are not one number`, distinctR >= Math.max(3, Math.ceil(rows.length * 0.5)),
    `${distinctR} distinct across ${rows.length} carriers`);
  check(`${tier}: no single route count dominates the tier`, modalShare <= 0.5,
    `${Math.round(modalShare * 100)}% of carriers share one route count`);
  check(`${tier}: largest network is at least 1.6x the smallest`,
    Math.max(...routes) >= Math.min(...routes) * 1.6,
    `${Math.min(...routes)} → ${Math.max(...routes)}`);
  check(`${tier}: fleet sizes are not one number`, distinctF >= Math.ceil(rows.length * 0.6),
    `${distinctF} distinct across ${rows.length} carriers`);
}

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
