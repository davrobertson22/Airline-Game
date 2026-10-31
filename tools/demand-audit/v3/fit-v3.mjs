// @not-a-test — fits demand model v3 and WRITES src/data/demandV3Factors.js
// (and prints DEMAND_V3.intlSize to paste into utils/market.js).
//
//   node tools/demand-audit/v3/fit-v3.mjs          fit + write + report
//   node tools/demand-audit/v3/fit-v3.mjs --dry    fit + report only
//
// Data: real-data.mjs (every normalized route-traffic file). All of it counts
// passengers on NONSTOP flights, less the transfers at known hubs. That is
// the pool a nonstop between the two airports draws on, which is what a
// pair's demand means to a player. Everything at realism 1, on top of v2 (with
// v3's domestic-only fix):
//
//  1. Short-haul pairs, both ends in covered countries, under SHORT_KM:
//       log real = log base + f_A + f_B + k_{country A, country B}
//     f: one factor per airport in a covered country other than the US and
//     Australia (v2 calibrates those), applied to all its pairs. Hierarchical
//     like v2's fit-airports: loose fit → regional Gaussian surface → refit
//     shrunk toward it (log sd TAU), capped. k: per country pair — a new
//     country's domestic level and the intra-region pulls (holiday flows) —
//     prior N(0, TAU_LINK²).
//  2. Every other pair with data (long-haul, or one end outside the covered
//     countries), stage-1 factors held:
//       log real = log base + f_A + f_B + i_A + i_B + k
//     i: an INTERNATIONAL factor for each US / Australian airport (applies to
//     its international pairs only), same hierarchy within its country. k: the
//     link factors of every country pair not fitted in stage 1.
//  Weights sqrt(traffic), mean 1 per source; rows leaning on a hub's assumed
//  transfer share count half. Pairs under MIN_WK are dropped.
//
//  Reported, not fitted: COUNTRY totals (real passengers between two countries
//  against the game's demand summed over every airport pair between them). The
//  game's thin international markets — pairs no one flies nonstop — still sum
//  to several times the real traffic; their passengers mostly reach the game
//  as connections.

import { writeFileSync } from 'fs';
import * as M from '../../../src/utils/market.js';
import { AIRPORT_FACTORS as V3F, LINK_FACTORS as V3L } from '../../../src/data/demandV3Factors.js';
import { AIRPORTS, getAirport } from '../../../src/data/airports.js';
import { loadV3Real, nodeOf, CONNECT_SHARE, TRANSIT_HUBS } from './real-data.mjs';
import { COVERED_COUNTRIES, DOMESTIC_ONLY } from './covered.mjs';

const DRY = process.argv.includes('--dry');
const MIN_WK = 20, TAU = 0.5, TAU_LOOSE = 1.5, TAU_LINK = 0.7, SIGMA = 0.8, SURFACE_KM = 400, SURFACE_PRIOR = 4;
const CAP_LO = 0.2, CAP_HI = 5, SHORT_KM = 3000, LINK_LAMBDA = 2, LINK_LO = 0.1, LINK_HI = 8;
const V2_COUNTRIES = new Set(['US', 'AU']);
const W_EXP = +(process.env.V3_WEXP ?? 0.75);   // row weight = traffic^W_EXP (big markets count more than sqrt would give them)
// refMass is held at 20 (a JFK- or LHR-sized metro): the loss is nearly flat in
// it above that (2% better at 320), but a large refMass shrinks EVERY pair,
// trunks included, and only link factors put the trunks back — leaving
// country pairs with no data (China–Thailand) at a fraction of their classic
// demand. At 20 the classic trunks, which the data says are right, stay put.

// Base: the game at realism 1, v3 tables empty, size term off (S applied here).
for (const k of Object.keys(V3F)) delete V3F[k];
for (const k of Object.keys(V3L)) delete V3L[k];
M.setDemandModel(3);
const keepRealism = M.DEMAND_V2.realism;
M.DEMAND_V2.realism = 1;
M.resetDemandV2Caches();
const real = loadV3Real();
const srcs = new Set(real.sources);
const covered = COVERED_COUNTRIES([...srcs]);
const strip = (code) => (TRANSIT_HUBS.has(code) ? 1 - (CONNECT_SHARE[code] ?? 0) : 1);

// V3_HOLDOUT=1: hold out every fifth pair (by a hash of its key), fit on the
// rest, and report the error on the held-out pairs at the end (--dry implied).
const HOLDOUT = !!process.env.V3_HOLDOUT;
const held = (key) => { let h = 0; for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h % 5 === 0; };
const heldRows = [];
const short = [], long = [];
for (const r of real.rows) {
  if (!(r.real >= MIN_WK)) continue;
  if (HOLDOUT && held(r.key)) { if (!(r.ca === r.cb && V2_COUNTRIES.has(r.ca))) heldRows.push(r); continue; }
  const dom = r.ca === r.cb;
  if (dom && V2_COUNTRIES.has(r.ca)) continue;           // v2 owns US / AU domestic
  const base0 = M.baseCityPairDemand(r.a, r.b);
  if (!(base0 > 0)) continue;
  const row = { ...r, base0, dom, w: Math.pow(r.real, W_EXP) * (r.hubConnect ? 0.5 : 1) };
  const cov = (c) => covered.has(c) && (dom || !DOMESTIC_ONLY.has(c));
  if (cov(r.ca) && cov(r.cb) && r.km <= SHORT_KM) short.push(row); else long.push(row);
}
for (const set of [short, long]) {
  const wm = new Map();
  for (const r of set) { const e = wm.get(r.src) ?? [0, 0]; e[0] += r.w; e[1]++; wm.set(r.src, e); }
  for (const r of set) { const [s, n] = wm.get(r.src); r.w /= s / n; }
}
const shortLinks = new Set(short.map((r) => M.linkKey(r.ca, r.cb)));

// ── Stage 1: short-haul airport + link factors ───────────────────────────────
for (const r of short) {
  r.base = r.base0;
  r.keys = [];
  for (const [n, c] of [[r.a, r.ca], [r.b, r.cb]]) if (!V2_COUNTRIES.has(c)) r.keys.push('A:' + n);
  r.keys.push('L:' + M.linkKey(r.ca, r.cb));
}
const byKey = new Map();
short.forEach((r, i) => r.keys.forEach((k) => { if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(i); }));
const val = new Map([...byKey.keys()].map((k) => [k, 0]));
const prior = new Map();
const tauOf = (k, tau) => (k.startsWith('L:') ? TAU_LINK : tau);
const pred = (r) => Math.log(r.base) + r.keys.reduce((s, k) => s + val.get(k), 0);
function sweep(tau, lo, hi) {
  for (let it = 0; it < 60; it++) {
    let moved = 0;
    for (const [k, is] of byKey) {
      let num = 0, den = 0;
      for (const i of is) { const r = short[i]; num += r.w * (Math.log(r.real) - (pred(r) - val.get(k))); den += r.w; }
      const t = tauOf(k, tau), lam = SIGMA * SIGMA / (t * t);
      let v = (num + lam * (prior.get(k) ?? 0)) / (den + lam);
      if (k.startsWith('A:')) v = Math.max(lo, Math.min(hi, v));
      moved = Math.max(moved, Math.abs(v - val.get(k))); val.set(k, v);
    }
    if (moved < 1e-4) break;
  }
}
const LO = Math.log(CAP_LO), HI = Math.log(CAP_HI);
const GAMMA = +(process.env.V3_GAMMA ?? 0), PAIR_REF = 1000;
sweep(TAU_LOOSE, Math.log(0.02), Math.log(50));
// Identify: an airport-factor shift common to a whole country is the same
// model as a shift of every link involving that country (domestic ×2). Move
// each country's traffic-weighted mean factor into its links, so factors
// describe airports RELATIVE to their country and links carry the levels.
function centre(valMap, byK, rowsArr, keyPrefix, linkOk) {
  const mu = new Map();
  for (const [k, is] of byK) {
    if (!k.startsWith(keyPrefix)) continue;
    const c = getAirport(k.slice(keyPrefix.length)).country;
    const w = is.reduce((s, i) => s + rowsArr[i].w, 0);
    const e = mu.get(c) ?? [0, 0]; e[0] += w * valMap.get(k); e[1] += w; mu.set(c, e);
  }
  for (const [k] of byK) if (k.startsWith(keyPrefix)) { const e = mu.get(getAirport(k.slice(keyPrefix.length)).country); valMap.set(k, valMap.get(k) - e[0] / e[1]); }
  for (const [k] of byK) {
    if (!k.startsWith('L:') || !linkOk(k)) continue;
    const [c1, c2] = k.slice(2).split('|');
    let add = 0; for (const c of [c1, c2]) { const e = mu.get(c); if (e) add += e[0] / e[1]; }
    valMap.set(k, valMap.get(k) + add);
  }
}
centre(val, byKey, short, 'A:', () => true);
const keyAp = new Map([...val.keys()].filter((k) => k.startsWith('A:')).map((k) => [k, getAirport(k.slice(2))]));
const keyW = new Map([...byKey].map(([k, is]) => [k, is.reduce((s, i) => s + short[i].w, 0)]));
function surfaceAt(ap) {
  let num = 0, den = SURFACE_PRIOR;
  for (const [k, b] of keyAp) {
    const w = keyW.get(k) * Math.exp(-0.5 * (M.distanceKm(ap, b) / SURFACE_KM) ** 2);
    num += w * val.get(k); den += w;
  }
  return num / den;
}
for (const [k, ap] of keyAp) prior.set(k, surfaceAt(ap));
for (const [k, p] of prior) val.set(k, Math.max(LO, Math.min(HI, p)));
sweep(TAU, LO, HI);

const airportF = {};
for (const k of keyAp.keys()) airportF[k.slice(2)] = +Math.exp(val.get(k)).toFixed(3);
let surfaced = 0;
for (const ap of AIRPORTS) {
  if (!covered.has(ap.country) || V2_COUNTRIES.has(ap.country)) continue;
  const n = nodeOf(ap.code); if (airportF[n] != null) continue;
  airportF[n] = +Math.exp(Math.max(LO, Math.min(HI, surfaceAt(getAirport(n))))).toFixed(3); surfaced++;
}
for (const k of Object.keys(airportF)) if (Math.abs(airportF[k] - 1) < 0.005) delete airportF[k];
const linkF = {};
for (const k of val.keys()) if (k.startsWith('L:')) linkF[k.slice(2)] = +Math.exp(val.get(k)).toFixed(3);

// ── Stage 2: long-haul / outside pairs ─────────────────────────────────────────
const fA = (n) => { const c = getAirport(n).country; return V2_COUNTRIES.has(c) || DOMESTIC_ONLY.has(c) ? 1 : (airportF[n] ?? 1); };   // on an international pair
const stage1Links = new Set(Object.keys(linkF));
const long2 = [];
for (const r of long) {
  if (r.dom) continue;
  const keys = [];
  for (const [n, c] of [[r.a, r.ca], [r.b, r.cb]]) if (V2_COUNTRIES.has(c)) keys.push('I:' + n);
  const lk = M.linkKey(r.ca, r.cb);
  if (!stage1Links.has(lk)) keys.push('L:' + lk);
  if (!keys.length) continue;
  long2.push({ ...r, base: r.base0 * Math.pow(r.base0 / PAIR_REF, GAMMA) * fA(r.a) * fA(r.b) * (linkF[lk] ?? 1), keys });
}
const byKey2 = new Map();
long2.forEach((r, i) => r.keys.forEach((k) => { if (!byKey2.has(k)) byKey2.set(k, []); byKey2.get(k).push(i); }));
const val2 = new Map([...byKey2.keys()].map((k) => [k, 0]));
const prior2 = new Map();
const pred2 = (r) => Math.log(r.base) + r.keys.reduce((s, k) => s + val2.get(k), 0);
function sweep2(tau, lo, hi) {
  for (let it = 0; it < 60; it++) {
    let moved = 0;
    for (const [k, is] of byKey2) {
      let num = 0, den = 0;
      for (const i of is) { const r = long2[i]; num += r.w * (Math.log(r.real) - (pred2(r) - val2.get(k))); den += r.w; }
      const t = k.startsWith('L:') ? TAU_LINK : tau, lam = SIGMA * SIGMA / (t * t);
      let v = (num + lam * (prior2.get(k) ?? 0)) / (den + lam);
      v = k.startsWith('L:') ? Math.max(Math.log(LINK_LO), Math.min(Math.log(LINK_HI), v)) : Math.max(lo, Math.min(hi, v));
      moved = Math.max(moved, Math.abs(v - val2.get(k))); val2.set(k, v);
    }
    if (moved < 1e-4) break;
  }
}
sweep2(TAU_LOOSE, Math.log(0.02), Math.log(50));
centre(val2, byKey2, long2, 'I:', () => true);
const keyI = new Map([...val2.keys()].filter((k) => k.startsWith('I:')).map((k) => [k, getAirport(k.slice(2))]));
const keyIW = new Map([...byKey2].map(([k, is]) => [k, is.reduce((s, i) => s + long2[i].w, 0)]));
function surfaceI(ap) {
  let num = 0, den = SURFACE_PRIOR;
  for (const [k, b] of keyI) {
    if (b.country !== ap.country) continue;
    const w = keyIW.get(k) * Math.exp(-0.5 * (M.distanceKm(ap, b) / SURFACE_KM) ** 2);
    num += w * val2.get(k); den += w;
  }
  return num / den;
}
for (const [k, ap] of keyI) prior2.set(k, surfaceI(ap));
for (const [k, p] of prior2) val2.set(k, Math.max(LO, Math.min(HI, p)));
sweep2(TAU, LO, HI);
for (const [k, ap] of keyI) airportF[k.slice(2)] = +Math.exp(val2.get(k)).toFixed(3);
let surfacedI = 0;
for (const ap of AIRPORTS) {
  if (!V2_COUNTRIES.has(ap.country) || !covered.has(ap.country)) continue;
  const n = nodeOf(ap.code); if (airportF[n] != null) continue;
  airportF[n] = +Math.exp(Math.max(LO, Math.min(HI, surfaceI(getAirport(n))))).toFixed(3); surfacedI++;
}
for (const k of val2.keys()) if (k.startsWith('L:')) linkF[k.slice(2)] = +Math.exp(val2.get(k)).toFixed(3);
for (const k of Object.keys(airportF)) if (Math.abs(airportF[k] - 1) < 0.005) delete airportF[k];
for (const k of Object.keys(linkF)) if (Math.abs(linkF[k] - 1) < 0.005) delete linkF[k];

// ── Report ───────────────────────────────────────────────────────────────────
console.log(`sources ${[...srcs].join(', ')}; covered ${[...covered].join(' ')}`);
const st = new Map();
for (const r of short) for (const g of [r.dom ? 'dom ' + r.ca : 'intl short', 'ALL short']) {
  const e = st.get(g) ?? { w: 0, b: 0, a: 0, bb: 0, aa: 0, real: 0, gb: 0, ga: 0, n: 0 };
  const eb = Math.log(r.real) - Math.log(r.base0), ea = Math.log(r.real) - pred(r);
  e.w += r.w; e.b += r.w * eb; e.a += r.w * ea; e.bb += r.w * eb * eb; e.aa += r.w * ea * ea;
  e.real += r.real; e.gb += r.base0; e.ga += Math.exp(pred(r)); e.n++; st.set(g, e);
}
const sd = (s, ss, w) => Math.sqrt(Math.max(0, ss / w - (s / w) ** 2));
console.log('\nstage 1 (short-haul pairs)   n   game/real before → after   log-sd before → after');
for (const [g, e] of [...st].sort((x, y) => y[1].real - x[1].real)) {
  if (e.n < 5) continue;
  console.log(' ', g.padEnd(24), String(e.n).padStart(5), `   ${(e.gb / e.real).toFixed(2)} → ${(e.ga / e.real).toFixed(2)}`, `        ${sd(e.b, e.bb, e.w).toFixed(2)} → ${sd(e.a, e.aa, e.w).toFixed(2)}`);
}
{
  let w = 0, b1 = 0, b2 = 0, a1 = 0, a2 = 0;
  for (const r of long2) { const eb = Math.log(r.real / r.base0), ea = Math.log(r.real) - pred2(r); w += r.w; b1 += r.w * eb; b2 += r.w * eb * eb; a1 += r.w * ea; a2 += r.w * ea * ea; }
  console.log(`stage 2 (long-haul / outside pairs, n ${long2.length}) log-sd ${sd(b1, b2, w).toFixed(2)} → ${sd(a1, a2, w).toFixed(2)}; geo game/real ${Math.exp(-b1 / w).toFixed(2)} → ${Math.exp(-a1 / w).toFixed(2)}`);
}
// Country totals (diagnostic): the game summed over every airport pair between two countries.
{
  for (const [k, f] of Object.entries(airportF)) V3F[k] = f;
  for (const [k, f] of Object.entries(linkF)) V3L[k] = f;
  M.resetDemandV2Caches();
  const nodesBy = new Map();
  for (const ap of AIRPORTS) { const n = nodeOf(ap.code); if (n !== ap.code) continue; if (!nodesBy.has(ap.country)) nodesBy.set(ap.country, []); nodesBy.get(ap.country).push(n); }
  const strip = (c) => (TRANSIT_HUBS.has(c) ? 1 - (CONNECT_SHARE[c] ?? 0) : 1);
  const tot = new Map();
  for (const r of real.rows) { if (r.ca === r.cb) continue; const lk = M.linkKey(r.ca, r.cb); tot.set(lk, (tot.get(lk) ?? 0) + r.raw * strip(r.a) * strip(r.b)); }
  const show = [];
  for (const lk of ['CA|US', 'MX|US', 'GB|US', 'JP|US', 'DE|US', 'ES|GB', 'DE|ES', 'FR|IT', 'AU|NZ', 'AU|ID']) {
    const [c1, c2] = lk.split('|'); let g = 0;
    for (const x of nodesBy.get(c1) ?? []) for (const y of nodesBy.get(c2) ?? []) g += M.baseCityPairDemand(x, y);
    if (tot.get(lk)) show.push(`${lk} ${(g / tot.get(lk)).toFixed(1)}×`);
  }
  console.log('  country totals, game ÷ real (diagnostic):', show.join(', '));
  const TR = ['JFK-LHR','LAX-HND','YYZ-JFK','JFK-CDG','JFK-CUN','LAX-MEX','MIA-GRU','SYD-AKL','SYD-LAX','PIT-CUN','IND-CUN','ORD-LHR','MEL-DPS','LHR-PMI','FRA-PMI','MAD-BCN','CDG-FCO'];
  const idx = new Map(real.rows.map((x) => [x.key, x]));
  console.log('  sample pairs, game ÷ real at realism 1:', TR.map((p) => { const [a, b] = p.split('-'); const x = idx.get(a < b ? p : b + '-' + a);
    return `${p} ${x ? (M.baseCityPairDemand(a, b) / x.real).toFixed(2) : '-'}`; }).join(', '));
  for (const k of Object.keys(V3F)) delete V3F[k];
  for (const k of Object.keys(V3L)) delete V3L[k];
}
const sortedA = Object.entries(airportF).sort((x, y) => x[1] - y[1]);
const lab = ([c, f]) => `${c} ${getAirport(c)?.city ?? ''} ${f}`;
console.log(`\n${sortedA.length} airport factors (${surfaced + surfacedI} from a regional surface alone)`);
console.log('Lowest:', sortedA.slice(0, 12).map(lab).join(', '));
console.log('Highest:', sortedA.slice(-15).reverse().map(lab).join(', '));
const sortedL = Object.entries(linkF).sort((x, y) => y[1] - x[1]);
console.log(`\n${sortedL.length} link factors. Highest:`, sortedL.slice(0, 25).map(([k, f]) => `${k} ${f}`).join(', '));
console.log('Lowest:', sortedL.slice(-15).map(([k, f]) => `${k} ${f}`).join(', '));
console.log('Domestic levels:', sortedL.filter(([k]) => k.split('|')[0] === k.split('|')[1]).map(([k, f]) => `${k.split('|')[0]} ${f}`).join(', '));

if (HOLDOUT) {
  for (const [k, f] of Object.entries(airportF)) V3F[k] = f;
  for (const [k, f] of Object.entries(linkF)) V3L[k] = f;
  M.resetDemandV2Caches();
  const err = (model) => { M.setDemandModel(model); let w = 0, s1 = 0, s2 = 0;
    for (const r of heldRows) { const g = M.baseCityPairDemand(r.a, r.b); if (!(g > 0)) continue; const e = Math.log(r.real / g), ww = Math.pow(r.real, W_EXP); w += ww; s1 += ww * e; s2 += ww * e * e; }
    return `geo game/real ${Math.exp(-s1 / w).toFixed(2)}, log-sd ${Math.sqrt(s2 / w - (s1 / w) ** 2).toFixed(2)}, mean |log err| ${Math.sqrt(s2 / w).toFixed(2)}`; };
  console.log(`\nHELD-OUT ${heldRows.length} pairs (realism 1): classic ${err(1)} | v2 ${err(2)} | v3 ${err(3)}`);
  for (const k of Object.keys(V3F)) delete V3F[k];
  for (const k of Object.keys(V3L)) delete V3L[k];
  M.setDemandModel(3);
}
M.DEMAND_V2.realism = keepRealism;
if (process.env.V3_SHOW) console.log("SHOW", process.env.V3_SHOW.split(",").map((k) => `${k} ${airportF[k] ?? linkF[k] ?? "-"}`).join(", "));
if (!DRY && !HOLDOUT) {
  const obj = (o) => Object.entries(o).sort(([x], [y]) => (x < y ? -1 : 1)).map(([k, f]) => `  '${k}': ${f},`).join('\n');
  writeFileSync(new URL('../../../src/data/demandV3Factors.js', import.meta.url), `// GENERATED by tools/demand-audit/v3/fit-v3.mjs — do not hand-edit.
// Demand model v3 calibration, fitted at realism 1 to ${[...srcs].join(', ')}
// (see utils/market.js "Demand model v3"). Airport factors: log prior sd ${TAU}
// around a regional surface, capped [${CAP_LO}, ${CAP_HI}]; a US/AU airport's
// applies to its international pairs only. Link factors per country pair
// ('A|B', sorted): prior sd ${TAU_LINK}, capped [${LINK_LO}, ${LINK_HI}].
export const AIRPORT_FACTORS = {
${obj(airportF)}
};
export const LINK_FACTORS = {
${obj(linkF)}
};
`);
  console.log('wrote src/data/demandV3Factors.js');
}
