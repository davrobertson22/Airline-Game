// @not-a-test — fits the per-airport demand-model-v2 factors and WRITES
// src/data/demandV2Factors.js. Run after changing DEMAND_V2 or the data:
//
//   node tools/demand-audit/fit-airports.mjs           fit + write + report
//   node tools/demand-audit/fit-airports.mjs --dry     fit + report, write nothing
//
// The global v2 terms (drive ramp, leakage, size, visitors) explain the SHAPE of
// demand, but most of what is left over is airport-specific (a log-residual SD
// of ~0.97 falls to ~0.62 with one factor per airport): a catchment bigger than
// its metro population, a university town, a thin local economy. This fits one
// log factor per airport on top of v2 at realism 1:
//
//   * US: every DOT Table 6 cluster pair (us-od-data.mjs), weighted by
//     sqrt(traffic) like fit-v2; pairs absent from the table are censored
//     (< 35/wk) and enter as P(real < 35), so a small airport can't buy a big
//     factor by having its over-predicted pairs drop out of the data.
//   * AU: BITRE city pairs (au-od-data.mjs).
//   * Regional surface: what is left is strongly REGIONAL — routes within the
//     US West run ~2.5x short of real, the Northeast/Midwest ~0.7x — so the fit
//     is hierarchical. Stage 1 fits loose per-airport factors; stage 2 smooths
//     them into a surface (Gaussian kernel, SURFACE_KM, traffic-weighted, with
//     a pseudo-weight pulling empty areas back to 1); stage 3 refits each
//     airport with a N(surface, TAU^2) prior in log space — an airport with a
//     handful of pairs stays near its region, one with hundreds is free to
//     move. Every US/AU airport with no data of its own takes the surface.
//   * Capped to [CAP_LO, CAP_HI]. Some of what the data shows is an airline's
//     network, not demand (Allegiant's Sanford and Punta Gorda bases): the cap
//     keeps the game from copying one carrier's choices wholesale.
//
// Factors apply to DOMESTIC pairs only (that is what they were fitted on) and,
// like every v2 term, enter the game as C^realism.

import { writeFileSync } from 'fs';
import * as M from '../../src/utils/market.js';
import { AIRPORT_FACTORS, CORRIDOR_FACTORS } from '../../src/data/demandV2Factors.js';
import { AIRPORTS, getAirport } from '../../src/data/airports.js';
import { loadUsOd, THRESH_WK } from './us-od-data.mjs';
import { loadAuOd } from './au-od-data.mjs';

const DRY = process.argv.includes('--dry');
const TAU = 0.5, TAU_LOOSE = 1.5, CAP_LO = 0.25, CAP_HI = 2.5, SURFACE_KM = 350, SURFACE_PRIOR = 4;
const SIGMA_US = 1.0, SIGMA_AU = 0.68;   // fit-v2's error scales at its optimum

// Fit against v2 WITHOUT the factors being fitted.
for (const k of Object.keys(AIRPORT_FACTORS)) delete AIRPORT_FACTORS[k];
for (const k of Object.keys(CORRIDOR_FACTORS)) delete CORRIDOR_FACTORS[k];
M.setDemandModel(2);
const keepRealism = M.DEMAND_V2.realism;
M.DEMAND_V2.realism = 1;
M.resetDemandV2Caches();

const us = loadUsOd();
const au = loadAuOd().rows;
const prim = (code) => { const mt = M.metroOf(code); return mt ? mt.primary : code; };

// ── Rows: base prediction + which factors touch it ───────────────────────────
// US factors are per DOT cluster (all its game nodes share one); AU per node.
const rows = [];
for (const r of us.rows) {
  let base = 0;
  for (const [a, b] of r.nodePairs) base += M.baseCityPairDemand(a, b);
  if (!(base > 0)) continue;
  // Corridor key: every node pair of the row in one corridor (clusters never straddle one in practice).
  const cors = new Set(r.nodePairs.map(([x, y]) => { const c = M.v2CorridorOf(x); return c && c === M.v2CorridorOf(y) ? c : '-'; }));
  const cor = cors.size === 1 && !cors.has('-') ? ['COR:' + [...cors][0]] : [];
  rows.push({ set: 'US', base, real: r.real, w: Math.sqrt(Math.max(r.real ?? 0, THRESH_WK)), keys: ['US:' + r.A.key, 'US:' + r.B.key, ...cor] });
}
for (const r of au) {
  const base = M.baseCityPairDemand(r.a, r.b);
  if (!(base > 0) || !(r.real > 0)) continue;
  const ca = M.v2CorridorOf(prim(r.a));
  rows.push({ set: 'AU', base, real: r.real, w: Math.sqrt(r.real), keys: ['AU:' + prim(r.a), 'AU:' + prim(r.b), ...(ca && ca === M.v2CorridorOf(prim(r.b)) ? ['COR:' + ca] : [])] });
}
const wMean = { US: 0, AU: 0 }, wN = { US: 0, AU: 0 };
for (const r of rows) { wMean[r.set] += r.w; wN[r.set]++; }
for (const r of rows) r.w /= wMean[r.set] / wN[r.set];

const byKey = new Map();
for (const [i, r] of rows.entries()) for (const k of r.keys) { if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(i); }
const a = new Map([...byKey.keys()].map((k) => [k, 0]));

const Phi = (z) => { const t = 1 / (1 + 0.2316419 * Math.abs(z)); const d = 0.3989423 * Math.exp(-z * z / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return z > 0 ? 1 - p : p; };
const lnT = Math.log(THRESH_WK);
function rowNll(r, logPred) {
  const s = r.set === 'US' ? SIGMA_US : SIGMA_AU;
  if (r.real) { const e = Math.log(r.real) - logPred; return r.w * e * e / (2 * s * s); }
  return -r.w * Math.log(Math.max(1e-12, Phi((lnT - logPred) / s)));
}
const logPred = (r, override) => Math.log(r.base) + r.keys.reduce((s, k) => s + (k === override?.k ? override.v : a.get(k)), 0);
const prior = new Map();
let tau = TAU_LOOSE;
const TAU_COR = 0.7;
function keyNll(k, v) {
  const p = prior.get(k) ?? 0;
  const t = k.startsWith('COR:') ? TAU_COR : tau;
  let f = (v - p) * (v - p) / (2 * t * t);
  for (const i of byKey.get(k)) f += rowNll(rows[i], logPred(rows[i], { k, v }));
  return f;
}
function golden(f, lo, hi) {
  const g = (Math.sqrt(5) - 1) / 2; let x1 = hi - g * (hi - lo), x2 = lo + g * (hi - lo), f1 = f(x1), f2 = f(x2);
  for (let i = 0; i < 40; i++) { if (f1 < f2) { hi = x2; x2 = x1; f2 = f1; x1 = hi - g * (hi - lo); f1 = f(x1); } else { lo = x1; x1 = x2; f1 = f2; x2 = lo + g * (hi - lo); f2 = f(x2); } }
  return (lo + hi) / 2;
}
const COR_LO = Math.log(0.1), COR_HI = Math.log(6);
function fitAll(lo, hi) {
  for (let sweep = 0; sweep < 12; sweep++) {
    let moved = 0;
    for (const k of a.keys()) {
      const [l, h] = k.startsWith('COR:') ? [COR_LO, COR_HI] : [lo, hi];
      const v = golden((x) => keyNll(k, x), l, h); moved = Math.max(moved, Math.abs(v - a.get(k))); a.set(k, v);
    }
    if (moved < 1e-3) break;
  }
}
const LO = Math.log(CAP_LO), HI = Math.log(CAP_HI);
// Stage 1: loose airport factors.
fitAll(Math.log(0.05), Math.log(20));
// Stage 2: the regional surface. Each fitted key sits at its anchor airport and
// weighs its total traffic weight.
const keyAirport = new Map();
for (const c of us.clusters) keyAirport.set('US:' + c.key, getAirport(c.anchor));
for (const k of a.keys()) if (k.startsWith('AU:')) keyAirport.set(k, getAirport(k.slice(3)));
const keyWeight = new Map([...byKey].map(([k, is]) => [k, is.reduce((s, i) => s + rows[i].w, 0)]));
const surfaceAt = (ap, set) => {
  let num = 0, den = SURFACE_PRIOR;
  for (const [k, v] of a) {
    if (!k.startsWith(set + ':')) continue;   // corridor keys never feed the surface
    const b = keyAirport.get(k); if (!b) continue;
    const km = M.distanceKm(ap, b);
    const w = keyWeight.get(k) * Math.exp(-0.5 * (km / SURFACE_KM) ** 2);
    num += w * v; den += w;
  }
  return num / den;
};
for (const k of a.keys()) if (!k.startsWith('COR:')) prior.set(k, surfaceAt(keyAirport.get(k), k.slice(0, 2)));
// Stage 3: refit with each airport shrunk toward its region, inside the caps.
tau = TAU;
for (const [k, p] of prior) a.set(k, Math.max(LO, Math.min(HI, p)));
const corridors = {};
fitAll(LO, HI);

// ── Factors per game node ────────────────────────────────────────────────────
const factors = {};
for (const c of us.clusters) { const v = a.get('US:' + c.key); if (v != null) for (const n of c.nodes) factors[n] = +Math.exp(v).toFixed(3); }
for (const [k, v] of a) if (k.startsWith('AU:')) factors[k.slice(3)] = +Math.exp(v).toFixed(3);
for (const [k, v] of a) if (k.startsWith('COR:')) corridors[k.slice(4)] = +Math.exp(v).toFixed(3);
// Every other game airport in the US / Australia takes its region's surface.
let surfaced = 0;
for (const ap of AIRPORTS) {
  if (ap.country !== 'US' && ap.country !== 'AU') continue;
  const node = prim(ap.code);
  if (factors[node] != null) continue;
  factors[node] = +Math.exp(Math.max(LO, Math.min(HI, surfaceAt(getAirport(node), ap.country)))).toFixed(3);
  surfaced++;
}
for (const k of Object.keys(factors)) if (Math.abs(factors[k] - 1) < 0.005) delete factors[k];

// ── Report ───────────────────────────────────────────────────────────────────
const stat = (set, withF) => {
  const lr = rows.filter((r) => r.set === set && r.real).map((r) => Math.log(r.real) - (withF ? logPred(r) : Math.log(r.base)));
  const mu = lr.reduce((s, x) => s + x, 0) / lr.length;
  return `geo real/model ${Math.exp(mu).toFixed(2)} sdLog ${Math.sqrt(lr.reduce((s, x) => s + (x - mu) ** 2, 0) / lr.length).toFixed(2)} (n ${lr.length})`;
};
console.log(`US  before: ${stat('US', false)}\n    after:  ${stat('US', true)}`);
console.log(`AU  before: ${stat('AU', false)}\n    after:  ${stat('AU', true)}`);
const sorted = Object.entries(factors).sort((x, y) => x[1] - y[1]);
const lab = ([c, f]) => `${c} ${getAirport(c)?.city ?? ''} ${f}`;
console.log(`\n${sorted.length} airports with a factor (${surfaced} from the regional surface alone). Lowest: ${sorted.slice(0, 10).map(lab).join(', ')}`);
console.log(`Highest: ${sorted.slice(-10).reverse().map(lab).join(', ')}`);
console.log(`At the cap: ${sorted.filter(([, f]) => f <= CAP_LO + 0.001 || f >= CAP_HI - 0.001).map(([c]) => c).join(' ') || 'none'}`);

console.log('Corridors:', Object.entries(corridors).map(([k, f]) => `${k} ${f} (${byKey.get('COR:' + k).length} pairs)`).join(', '));
console.log('Regional surface:', ['SEA', 'SFO', 'LAX', 'PHX', 'DEN', 'DFW', 'ORD', 'ATL', 'MIA', 'JFK', 'BOS', 'MSP', 'SYD', 'PER'].map((c) => `${c} ${Math.exp(surfaceAt(getAirport(c), getAirport(c).country)).toFixed(2)}`).join(', '));

// Short-haul corridors still off after the factors (candidates for a corridor rule).
const short = [];
for (const r of us.rows) {
  if (!r.real || r.km > 900) continue;
  let m = 0; for (const [x, y] of r.nodePairs) { const cx = M.v2CorridorOf(x); m += M.baseCityPairDemand(x, y) * (factors[x] ?? 1) * (factors[y] ?? 1) * (cx && cx === M.v2CorridorOf(y) ? corridors[cx] ?? 1 : 1); }
  if (m > 0 && r.real >= 1500) short.push([r.A.label.split(' ')[0] + '–' + r.B.label.split(' ')[0], Math.round(r.km), m / r.real, Math.round(r.real)]);
}
short.sort((x, y) => x[2] - y[2]);
console.log('\nShort-haul (<900 km, real >= 1,500/wk) most under after factors:', short.slice(0, 12).map(([p, km, q, real]) => `${p} ${km}km ${q.toFixed(2)}x (real ${real})`).join('; '));
console.log('Most over:', short.slice(-8).reverse().map(([p, km, q, real]) => `${p} ${km}km ${q.toFixed(2)}x (real ${real})`).join('; '));

M.DEMAND_V2.realism = keepRealism;
if (!DRY) {
  const body = Object.entries(factors).sort(([x], [y]) => (x < y ? -1 : 1)).map(([c, f]) => `  ${c}: ${f},`).join('\n');
  writeFileSync(new URL('../../src/data/demandV2Factors.js', import.meta.url), `// GENERATED by tools/demand-audit/fit-airports.mjs — do not hand-edit.
// Per-airport demand-model-v2 calibration factors (domestic pairs only),
// fitted at realism 1 to DOT Table 6 (US) and BITRE (AU); shrunk toward 1
// (log prior sd ${TAU}) and capped to [${CAP_LO}, ${CAP_HI}]. See utils/market.js.
export const AIRPORT_FACTORS = {
${body}
};
// Pairs with both ends in one DEMAND_V2.corridors region (prior sd ${TAU_COR}).
export const CORRIDOR_FACTORS = {
${Object.entries(corridors).map(([k, f]) => `  ${k}: ${f},`).join('\n')}
};
`);
  console.log(`\nwrote src/data/demandV2Factors.js (${sorted.length} factors)`);
}
