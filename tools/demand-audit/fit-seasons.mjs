// @not-a-test — fits demand-model-v2 seasonal profiles and WRITES
// src/data/demandV2Seasons.js.
//
//   node tools/demand-audit/fetch-dot-car.mjs   (data/dot-car-table6.json — the airport mapping)
//   curl ... data/dot-car-table6-seasons.json    (Table 6, years 2023–2025; see below)
//   node tools/demand-audit/fit-seasons.mjs [--dry]
//
// The classic model gives every US airport one curve (SEASONAL_PROFILES.generic:
// a summer peak), so Miami–New York peaks in July when the real route peaks in
// the winter, and Boston–Chicago never sees its deep January–March trough.
// This fits one profile per airport from real traffic:
//
//   * US: DOT Table 6 quarterly passengers, calendar years 2023–2025, every
//     cluster pair present in all four quarters of a year. A pair's quarter
//     index (its traffic that quarter / its quarterly mean) is modelled as the
//     MEAN of its two airports' indices — exactly how getSeasonalProfile blends
//     endpoint profiles in the game. Fitted by alternating weighted least
//     squares (weight sqrt traffic), each airport shrunk toward its region.
//     DOT is quarterly, so months come from the classic curve's shape inside
//     each quarter, rescaled to the fitted quarter level.
//   * AU: BITRE monthly passengers, the last 36 months, same model per month.
//   * Airports with no data take a traffic-weighted regional surface (Gaussian
//     kernel, SURFACE_KM). Every profile is normalised to an annual mean of 1,
//     so seasonality moves demand between months, never adds or removes it.
//
// Fetch for the US seasons file (Socrata, ~8 MB):
//   https://data.transportation.gov/resource/yj5y-b2ir.json?$where=year in(2023,2024,2025)&$limit=100000&$select=year,quarter,citymarketid_1,citymarketid_2,passengers

import { readFileSync, writeFileSync } from 'fs';
import { AIRPORTS, getAirport } from '../../src/data/airports.js';
import { distanceKm, metroOf, DEMAND_V2 } from '../../src/utils/market.js';
import { SEASONAL_PROFILES } from '../../src/models/demand.js';
import { loadUsOd } from './us-od-data.mjs';

const DRY = process.argv.includes('--dry');
const SURFACE_KM = 400, SHRINK = 8;   // SHRINK: pseudo-weight pulling an airport toward its region
const prim = (c) => { const mt = metroOf(c); return mt ? mt.primary : c; };

// ── Generic ALS for "pair index = mean of endpoint indices" over P periods ────
function fitEndpoints(obs, P) {
  // obs: [{ a, b, y: [P], w }]
  const keys = [...new Set(obs.flatMap((o) => [o.a, o.b]))];
  const q = new Map(keys.map((k) => [k, new Array(P).fill(1)]));
  const prior = new Map(keys.map((k) => [k, new Array(P).fill(1)]));
  const solve = (shrink) => {
    for (let it = 0; it < 40; it++) {
      const num = new Map(keys.map((k) => [k, new Array(P).fill(0)])), den = new Map(keys.map((k) => [k, 0]));
      for (const o of obs) {
        for (const [me, other] of [[o.a, o.b], [o.b, o.a]]) {
          // y = (q_me + q_other)/2  →  q_me ≈ 2y − q_other
          const n = num.get(me), qo = q.get(other);
          for (let p = 0; p < P; p++) n[p] += o.w * (2 * o.y[p] - qo[p]);
          den.set(me, den.get(me) + o.w);
        }
      }
      for (const k of keys) {
        const pr = prior.get(k), n = num.get(k), d = den.get(k);
        const v = n.map((x, p) => (x + shrink * pr[p]) / (d + shrink));
        const m = v.reduce((s, x) => s + x, 0) / P;
        q.set(k, v.map((x) => Math.max(0.3, x / m)));
      }
    }
  };
  solve(0.5);
  return { q, prior, keys, solve };
}
function surfaceOf(q, keyAirport, keyWeight, ap, P) {
  const num = new Array(P).fill(0); let den = 0;
  for (const [k, v] of q) {
    const b = keyAirport.get(k); if (!b || b.country !== ap.country) continue;
    const w = keyWeight.get(k) * Math.exp(-0.5 * (distanceKm(ap, b) / SURFACE_KM) ** 2);
    for (let p = 0; p < P; p++) num[p] += w * v[p];
    den += w;
  }
  if (!(den > 1e-9)) return null;
  const v = num.map((x) => x / den); const m = v.reduce((s, x) => s + x, 0) / P;
  return v.map((x) => x / m);
}

// ── US ───────────────────────────────────────────────────────────────────────
const us = loadUsOd();
const mk = new Map(us.markets.map((m) => [m.id, m]));
const seasons = JSON.parse(readFileSync(new URL('./data/dot-car-table6-seasons.json', import.meta.url), 'utf8'));
const pk = (a, b) => (a < b ? a + '\u0000' + b : b + '\u0000' + a);
const acc = new Map();   // pairKey|year → [q1..q4]
for (const r of seasons) {
  const a = mk.get(r.citymarketid_1), b = mk.get(r.citymarketid_2);
  if (!a?.cluster || !b?.cluster || a.cluster === b.cluster) continue;
  const k = pk(a.cluster, b.cluster) + '|' + r.year;
  if (!acc.has(k)) acc.set(k, { a: a.cluster < b.cluster ? a.cluster : b.cluster, b: a.cluster < b.cluster ? b.cluster : a.cluster, q: [0, 0, 0, 0], n: [0, 0, 0, 0] });
  const e = acc.get(k); e.q[+r.quarter - 1] += +r.passengers; e.n[+r.quarter - 1]++;
}
const byPair = new Map();
for (const e of acc.values()) {
  if (e.n.some((x) => x === 0)) continue;   // a quarter under the 10/day cut-off — drop the year
  const mean = e.q.reduce((s, x) => s + x, 0) / 4;
  const key = pk(e.a, e.b);
  const p = byPair.get(key) ?? { a: e.a, b: e.b, y: [0, 0, 0, 0], yrs: 0, pax: 0 };
  e.q.forEach((x, i) => { p.y[i] += x / mean; }); p.yrs++; p.pax += mean;
  byPair.set(key, p);
}
const usObs = [...byPair.values()].map((p) => ({ a: p.a, b: p.b, y: p.y.map((x) => x / p.yrs), w: Math.sqrt(p.pax / p.yrs) * Math.sqrt(p.yrs) }));
const US = fitEndpoints(usObs, 4);
const clusterAnchor = new Map(us.clusters.map((c) => [c.key, getAirport(c.anchor)]));
const usWeight = new Map(US.keys.map((k) => [k, usObs.filter((o) => o.a === k || o.b === k).reduce((s, o) => s + o.w, 0)]));
for (const k of US.keys) US.prior.set(k, surfaceOf(US.q, clusterAnchor, usWeight, clusterAnchor.get(k), 4) ?? [1, 1, 1, 1]);
US.solve(SHRINK);

// Quarters → months on the classic curve's within-quarter shape — the ski
// curve's for mountain resorts, whose Oct–Dec quarter is all December.
const generic = SEASONAL_PROFILES.generic;
const mountain = new Set(DEMAND_V2.mountainResorts);
const toMonths = (qv, code) => {
  const shape = mountain.has(code) ? SEASONAL_PROFILES.ski : generic;
  const out = [];
  for (let m = 1; m <= 12; m++) {
    const qi = Math.floor((m - 1) / 3);
    const qMean = (shape[qi * 3 + 1] + shape[qi * 3 + 2] + shape[qi * 3 + 3]) / 3;
    out.push(shape[m] / qMean * qv[qi]);
  }
  const mean = out.reduce((s, x) => s + x, 0) / 12;
  return out.map((x) => +(x / mean).toFixed(3));
};
const profiles = {};
for (const c of us.clusters) { const v = US.q.get(c.key); if (v) for (const n of c.nodes) profiles[n] = toMonths(v, n); }
let usSurfaced = 0;
for (const ap of AIRPORTS) {
  if (ap.country !== 'US') continue;
  const node = prim(ap.code); if (profiles[node]) continue;
  const n = getAirport(node);
  // Hawaii, Alaska, Puerto Rico have their own climates: only their own data counts.
  if (n.lat < 24 || n.lon < -140 || n.lon > -66) continue;
  const v = surfaceOf(US.q, clusterAnchor, usWeight, n, 4); if (!v) continue;
  profiles[node] = toMonths(v, node); usSurfaced++;
}

// ── AU (monthly) ─────────────────────────────────────────────────────────────
const lines = readFileSync(new URL('./data/bitre-dom-citypairs.csv', import.meta.url), 'utf8').replace(/^﻿/, '').trim().split(/\r?\n/).slice(1).map((l) => l.split(','));
const mkey = (r) => +r[10] * 12 + (+r[11] - 1);
const last = Math.max(...lines.map(mkey));
const auAps = AIRPORTS.filter((a) => a.country === 'AU');
const auNode = (city) => { const ap = auAps.find((a) => (a.city || '').toUpperCase() === city); return ap ? prim(ap.code) : null; };
const auPairs = new Map();
for (const r of lines) {
  const ago = last - mkey(r); if (ago < 0 || ago >= 36) continue;
  const a = auNode(r[0]), b = auNode(r[1]); if (!a || !b || a === b) continue;
  const yearIdx = Math.floor(ago / 12), month = +r[11] - 1;
  const k = (a < b ? a + '|' + b : b + '|' + a) + '|' + yearIdx;
  const e = auPairs.get(k) ?? { a: a < b ? a : b, b: a < b ? b : a, m: new Array(12).fill(0), n: 0 };
  e.m[month] += +r[3]; e.n++; auPairs.set(k, e);
}
const auAgg = new Map();
for (const e of auPairs.values()) {
  if (e.n < 12 || e.m.some((x) => !(x > 0))) continue;
  const mean = e.m.reduce((s, x) => s + x, 0) / 12;
  const key = e.a + '|' + e.b;
  const p = auAgg.get(key) ?? { a: e.a, b: e.b, y: new Array(12).fill(0), yrs: 0, pax: 0 };
  e.m.forEach((x, i) => { p.y[i] += x / mean; }); p.yrs++; p.pax += mean; auAgg.set(key, p);
}
const auObs = [...auAgg.values()].map((p) => ({ a: p.a, b: p.b, y: p.y.map((x) => x / p.yrs), w: Math.sqrt(p.pax / p.yrs) * Math.sqrt(p.yrs) }));
const AU = fitEndpoints(auObs, 12);
const auAnchor = new Map(AU.keys.map((k) => [k, getAirport(k)]));
const auWeight = new Map(AU.keys.map((k) => [k, auObs.filter((o) => o.a === k || o.b === k).reduce((s, o) => s + o.w, 0)]));
for (const k of AU.keys) AU.prior.set(k, surfaceOf(AU.q, auAnchor, auWeight, auAnchor.get(k), 12) ?? new Array(12).fill(1));
AU.solve(SHRINK);
const norm12 = (v) => { const m = v.reduce((s, x) => s + x, 0) / 12; return v.map((x) => +(x / m).toFixed(3)); };
for (const k of AU.keys) profiles[k] = norm12(AU.q.get(k));
let auSurfaced = 0;
for (const ap of auAps) {
  const node = prim(ap.code); if (profiles[node]) continue;
  const v = surfaceOf(AU.q, auAnchor, auWeight, getAirport(node), 12); if (!v) continue;
  profiles[node] = norm12(v); auSurfaced++;
}

// ── Report ───────────────────────────────────────────────────────────────────
const qOf = (m12) => [0, 1, 2, 3].map((q) => (m12[q * 3] + m12[q * 3 + 1] + m12[q * 3 + 2]) / 3);
const genQ = qOf(generic.slice(1));
const errs = (pred) => { let se = 0, n = 0; for (const o of usObs) { const p = pred(o); for (let i = 0; i < 4; i++) { se += o.w * (o.y[i] - p[i]) ** 2; n += o.w; } } return Math.sqrt(se / n); };
const nodeOfCluster = new Map(us.clusters.map((c) => [c.key, c.nodes[0]]));
console.log(`US: ${usObs.length} pairs, ${US.keys.length} airports fitted, ${usSurfaced} from the regional surface`);
console.log(`  quarter-index RMS error: classic curve ${errs(() => genQ.map((x) => x / (genQ.reduce((s, y) => s + y) / 4))).toFixed(3)}, fitted ${errs((o) => { const qa = qOf(profiles[nodeOfCluster.get(o.a)]), qb = qOf(profiles[nodeOfCluster.get(o.b)]); return qa.map((x, i) => (x + qb[i]) / 2); }).toFixed(3)}`);
const show = (c) => { const p = profiles[c]; if (!p) return `${c} -`; return `${c} ${qOf(p).map((x) => (25 * x).toFixed(0)).join('/')}`; };
console.log('  quarter shares % (Q1/Q2/Q3/Q4):', ['MIA', 'MCO', 'LAS', 'JFK', 'BOS', 'ORD', 'MSP', 'DEN', 'ASE', 'SEA', 'PHX', 'ANC', 'HNL'].map(show).join(', '));
console.log(`AU: ${auObs.length} pairs, ${AU.keys.length} airports, ${auSurfaced} from the surface`);
const mshow = (c) => profiles[c] ? `${c} ${profiles[c].map((x) => x.toFixed(2)).join(' ')}` : `${c} -`;
for (const c of ['SYD', 'CNS', 'HBA', 'DRW', 'OOL']) console.log('  ', mshow(c));

if (!DRY) {
  const body = Object.entries(profiles).sort(([x], [y]) => (x < y ? -1 : 1)).map(([c, v]) => `  ${c}: [${v.join(',')}],`).join('\n');
  writeFileSync(new URL('../../src/data/demandV2Seasons.js', import.meta.url), `// GENERATED by tools/demand-audit/fit-seasons.mjs — do not hand-edit.
// Demand-model-v2 seasonal profiles (Jan..Dec, annual mean 1), fitted to DOT
// Table 6 quarterly traffic 2023–2025 (US; months from the classic curve's
// within-quarter shape) and BITRE monthly traffic (AU). See models/demand.js.
export const SEASONS = {
${body}
};
`);
  console.log(`wrote src/data/demandV2Seasons.js (${Object.keys(profiles).length} airports)`);
}
