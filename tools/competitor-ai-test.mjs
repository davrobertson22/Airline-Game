// competitor-ai-test.mjs — long-run invariant test for the adaptive competitor AI.
// Run: node tools/competitor-ai-test.mjs
//
// Simulates 6 game-years of competitor evolution against a static player network
// and asserts structural invariants + sane dynamics.

import {
  sampleAndInitializeCompetitors,
  computeCompetitorWeeklyStats,
  computeCompetitorRoutePnL,
  buildPairIncumbents,
  COMPETITOR_AIRLINES,
} from '../src/models/demand.js';
import { tickCompetitorAI, retainedProfit, ARCHETYPES } from '../src/models/competitorAI.js';
import { computeMarketCap } from '../src/utils/market.js';

let failures = 0;
function check(name, cond, detail = '') {
  if (cond) { console.log(`  ✓ ${name}`); }
  else      { console.error(`  ✗ ${name} ${detail}`); failures++; }
}

console.log('── Competitor bank ──');
check('bank has 70 airlines', COMPETITOR_AIRLINES.length === 70, `got ${COMPETITOR_AIRLINES.length}`);

let comps = sampleAndInitializeCompetitors(25);
check('samples 25 carriers', comps.length === 25, `got ${comps.length}`);
check('every carrier starts with routes', comps.every(c => Object.keys(c.routes).length >= 3),
  comps.filter(c => Object.keys(c.routes).length < 3).map(c => c.id).join(','));
check('every carrier starts with a fleet', comps.every(c => (c.fleet ?? []).length > 0));
const tiers = new Set(comps.map(c => c.tier));
check('all three tiers present', tiers.has('budget') && tiers.has('legacy') && tiers.has('premium'));

console.log('── 6-year simulation ──');
const playerRoutes = [
  { origin: 'JFK', destination: 'LHR', ticketPrice: 620, weeklyFrequency: 14 },
  { origin: 'JFK', destination: 'LAX', ticketPrice: 380, weeklyFrequency: 21 },
  { origin: 'JFK', destination: 'MIA', ticketPrice: 210, weeklyFrequency: 14 },
];
const counts = {};
let nanFound = false;
let structureBroken = false;

for (let wk = 1; wk <= 312; wk++) {
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
  for (const e of r.events) counts[e.type] = (counts[e.type] ?? 0) + 1;

  if (comps.some(c => !Number.isFinite(c.cash) || !Number.isFinite(c.marketCap))) { nanFound = true; break; }
  for (const c of comps) {
    for (const [key, cfg] of Object.entries(c.routes)) {
      if (!/^[A-Z]{3}-[A-Z]{3}$/.test(key) || !(cfg.frequency > 0) || !(cfg.priceMultiplier > 0)) {
        structureBroken = true;
        console.error('   broken route', c.id, key, JSON.stringify(cfg));
      }
    }
    // every route's tails exist in the fleet
    const fleetKeys = new Set((c.fleet ?? []).map(f => f.routeKey));
    for (const key of Object.keys(c.routes)) {
      if ((c.routes[key].tails ?? 0) > 0 && !fleetKeys.has(key)) {
        structureBroken = true;
        console.error('   route without fleet tails', c.id, key);
      }
    }
  }
  if (structureBroken) break;
}

check('no NaN cash/marketCap over 312 weeks', !nanFound);
check('route/fleet structure intact', !structureBroken);
check('AI opened routes', (counts.launch ?? 0) > 50, `launches=${counts.launch ?? 0}`);
check('AI cut losing routes', (counts.cut ?? 0) > 5, `cuts=${counts.cut ?? 0}`);
check('lifecycle produced distress or drama',
  (counts.fireSale ?? 0) + (counts.bankrupt ?? 0) + (counts.merger ?? 0) + (counts.startup ?? 0) > 0,
  JSON.stringify(counts));
check('roster stayed within bounds', comps.length >= 4 && comps.length <= 28, `roster=${comps.length}`);
check('all carriers have archetypes', comps.every(c => ARCHETYPES[c._archetype]),
  comps.filter(c => !ARCHETYPES[c._archetype]).map(c => c.id).join(','));

// Dispersion: the world should have winners and losers, not uniform riches.
const cashes = comps.map(c => c.cash).sort((a, b) => a - b);
check('cash dispersion (max > 5× min or losers exist)',
  cashes[0] < 20_000_000 || cashes[cashes.length - 1] > cashes[0] * 5,
  `min=${(cashes[0] / 1e6).toFixed(0)}M max=${(cashes[cashes.length - 1] / 1e6).toFixed(0)}M`);

// Per-route P&L sanity: monopoly demand > contested demand on the same pair.
const probe = comps.find(c => Object.keys(c.routes).length > 0);
if (probe) {
  const key  = Object.keys(probe.routes)[0];
  const solo = computeCompetitorRoutePnL(probe, key, probe.routes[key], 6, null);
  const duo  = computeCompetitorRoutePnL(probe, key, probe.routes[key], 6, new Map([[key, 3]]));
  check('demand splits under competition', duo.pax <= solo.pax, `${duo.pax} vs ${solo.pax}`);
}

console.log('events over 6y:', JSON.stringify(counts));
console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
