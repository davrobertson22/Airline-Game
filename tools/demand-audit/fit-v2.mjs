// @not-a-test — fits the demand-model-v2 parameters; prints them, changes nothing.
//
//   node tools/demand-audit/fit-v2.mjs            fit, then report at realism 1 and the game's realism
//   node tools/demand-audit/fit-v2.mjs --report   report the parameters currently in DEMAND_V2
//
// Data: us-od-data.mjs (DOT Table 6, every contiguous-US city pair) and
// au-od-data.mjs (BITRE). Objective: joint log-likelihood. US pairs absent from
// Table 6 are censored (< 35/wk one-way) and enter as P(real < 35) — a Tobit
// fit — so the table's cut-off can't hide over-prediction. AU pairs are plain
// log-normal. Each dataset gets its own error scale. The fit runs at realism 1
// (match the data); the game then ships C^realism (see DEMAND_V2 in market.js).
// Paste the printed parameters into DEMAND_V2 to adopt them.

import { writeFileSync, readFileSync, existsSync } from 'fs';
import * as M from '../../src/utils/market.js';
import { loadUsOd, THRESH_WK } from './us-od-data.mjs';
import { loadAuOd } from './au-od-data.mjs';

const REPORT_ONLY = process.argv.includes('--report');
const us = loadUsOd();
const au = loadAuOd().rows;
const V = M.DEMAND_V2;

// name, getter/setter path, lo, hi
const P = [
  ['drive.fullH', 2, 16], ['drive.floor', 0.02, 1], ['drive.shape', 0.4, 4],
  ['size.refMass', 0.3, 25], ['size.exp', 0, 0.8],
  ['leak.radiusKm', 40, 300], ['leak.strength', 0, 0.95],
  ['visitorWeight', 0, 1.5], ['level.US', 0.05, 3], ['level.AU', 0.3, 8],
];
const getp = (path) => path.split('.').reduce((o, k) => o[k], V);
const setp = (path, v) => { const ks = path.split('.'); const last = ks.pop(); ks.reduce((o, k) => o[k], V)[last] = v; };
const toU = (x, lo, hi) => Math.log((x - lo) / (hi - x));
const fromU = (u, lo, hi) => lo + (hi - lo) / (1 + Math.exp(-u));
const apply = (u) => { P.forEach(([p, lo, hi], i) => setp(p, fromU(u[i], lo, hi))); M.resetDemandV2Caches(); };

// Fit the global terms WITHOUT the per-airport factors (fit-airports.mjs fits
// those afterwards, on top of these). --report keeps them, to show the game.
import { AIRPORT_FACTORS } from '../../src/data/demandV2Factors.js';
const savedFactors = { ...AIRPORT_FACTORS };
if (!REPORT_ONLY) for (const k of Object.keys(AIRPORT_FACTORS)) delete AIRPORT_FACTORS[k];
M.setDemandModel(2);
const savedRealism = V.realism;

const Phi = (z) => { const t = 1 / (1 + 0.2316419 * Math.abs(z)); const d = 0.3989423 * Math.exp(-z * z / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return z > 0 ? 1 - p : p; };
const lnThresh = Math.log(THRESH_WK);

// v2 = round(v1_raw x C^realism), and v1 never changes, so cache v1 and each
// pair's metro primaries once; an evaluation only recomputes C. (v1 is cached
// rounded — a sub-passenger difference from the game's single rounding.)
import { getAirport } from '../../src/data/airports.js';
const prim = (code) => { const mt = M.metroOf(code); return [mt ? (getAirport(mt.primary) ?? getAirport(code)) : getAirport(code), mt ?? null]; };
function pairInfo(a, b) {
  const was = M.getDemandModel(); M.setDemandModel(1);
  const v1 = M.baseCityPairDemand(a, b); M.setDemandModel(was);
  const [po, mO] = prim(a), [pd, mD] = prim(b);
  return { v1, po, pd, mO, mD, dist: M.distanceKm(po, pd) };
}
const usInfo = us.rows.map((r) => r.nodePairs.map(([a, b]) => pairInfo(a, b)));
const auInfo = au.map((r) => pairInfo(r.a, r.b));
const priced = (q) => {
  if (M.getDemandModel() !== 2 || !q.v1) return q.v1;
  return q.v1 * Math.pow(M.demandV2Correction(q.po, q.pd, q.mO, q.mD, q.dist), V.realism);
};
function predictions() {
  const usPred = usInfo.map((qs) => qs.reduce((s, q) => s + priced(q), 0));
  const auPred = auInfo.map(priced);
  return { usPred, auPred };
}

// Traffic weights: a pair counts in proportion to sqrt(its real traffic) (35/wk
// for a censored one), normalised to mean 1, so the routes that carry the
// passengers steer the fit rather than thousands of near-empty town pairs.
const wOf = (real) => Math.sqrt(Math.max(real ?? 0, THRESH_WK));
const usW = (() => { const w = us.rows.map((r) => wOf(r.real)); const m = w.reduce((a, b) => a + b) / w.length; return w.map((x) => x / m); })();
const auW = (() => { const w = au.map((r) => wOf(r.real)); const m = w.reduce((a, b) => a + b) / w.length; return w.map((x) => x / m); })();

function nll() {
  const { usPred, auPred } = predictions();
  // closed-form-ish: profile the two sigmas by a couple of fixed-point passes
  let sU = 1, sA = 0.5, best = Infinity;
  for (let pass = 0; pass < 3; pass++) {
    let ll = 0, ssq = 0, n = 0;
    for (let i = 0; i < us.rows.length; i++) {
      const pred = usPred[i]; const real = us.rows[i].real;
      const w = usW[i];
      if (real) { if (pred <= 0) { ll += 50 * w; continue; } const e = Math.log(real) - Math.log(pred); ll += w * (e * e / (2 * sU * sU) + Math.log(sU)); ssq += w * e * e; n += w; }
      else if (pred > 1) ll -= w * Math.log(Math.max(1e-12, Phi((lnThresh - Math.log(pred)) / sU)));
    }
    let llA = 0, ssqA = 0;
    for (let i = 0; i < au.length; i++) { const e = Math.log(au[i].real) - Math.log(Math.max(1, auPred[i])); llA += auW[i] * (e * e / (2 * sA * sA) + Math.log(sA)); ssqA += auW[i] * e * e; }
    best = ll + llA;
    sU = Math.max(0.3, Math.sqrt(ssq / Math.max(1, n))); sA = Math.max(0.2, Math.sqrt(ssqA / au.length));
  }
  return best;
}

function nelderMead(f, x0, { iters = 900, step = 0.6, onBest = null } = {}) {
  const n = x0.length; let S = [x0.slice()];
  for (let i = 0; i < n; i++) { const x = x0.slice(); x[i] += step; S.push(x); }
  let F = S.map(f);
  for (let it = 0; it < iters; it++) {
    const idx = F.map((v, i) => i).sort((a, b) => F[a] - F[b]); S = idx.map((i) => S[i]); F = idx.map((i) => F[i]);
    const c = new Array(n).fill(0); for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) c[j] += S[i][j] / n;
    const lerp = (a, b, t) => a.map((v, j) => v + t * (b[j] - v));
    const xr = lerp(c, S[n], -1), fr = f(xr);
    if (fr < F[0]) { const xe = lerp(c, S[n], -2), fe = f(xe); if (fe < fr) { S[n] = xe; F[n] = fe; } else { S[n] = xr; F[n] = fr; } }
    else if (fr < F[n - 1]) { S[n] = xr; F[n] = fr; }
    else { const xc = lerp(c, S[n], 0.5), fc = f(xc); if (fc < F[n]) { S[n] = xc; F[n] = fc; }
      else { for (let i = 1; i <= n; i++) { S[i] = lerp(S[0], S[i], 0.5); F[i] = f(S[i]); } } }
    if (it % 50 === 0) { process.stderr.write(`  iter ${it} nll ${F[0].toFixed(1)}\n`); if (onBest) onBest(S[0]); }
  }
  return { x: S[0], f: F[0] };
}

if (!REPORT_ONLY) {
  V.realism = 1;
  const x0 = P.map(([p, lo, hi]) => toU(Math.min(hi - 1e-6 * (hi - lo), Math.max(lo + 1e-6 * (hi - lo), getp(p))), lo, hi));
  const f = (u) => { apply(u); return nll(); };
  // Progress is checkpointed to data/fit-v2-result.json, so a long run that is
  // cut off still leaves its best point; --resume starts from that file.
  const out = new URL('./data/fit-v2-result.json', import.meta.url);
  const save = (u) => { apply(u); writeFileSync(out, JSON.stringify(Object.fromEntries(P.map(([p]) => [p, +getp(p).toPrecision(4)])), null, 1)); };
  let start = x0;
  if (process.argv.includes('--resume') && existsSync(out)) {
    const j = JSON.parse(readFileSync(out, 'utf8'));
    start = P.map(([p, lo, hi]) => toU(Math.min(hi - 1e-6 * (hi - lo), Math.max(lo + 1e-6 * (hi - lo), j[p] ?? getp(p))), lo, hi));
  }
  let res = nelderMead(f, start, { iters: process.argv.includes('--resume') ? 250 : 550, onBest: save });
  res = nelderMead(f, res.x, { iters: process.argv.includes('--resume') ? 150 : 300, step: 0.25, onBest: save });
  save(res.x);
  apply(res.x);
  console.log('Fitted (realism 1):');
  for (const [p] of P) console.log(`  ${p.padEnd(16)} ${+getp(p).toPrecision(3)}`);
  V.realism = savedRealism;
  M.resetDemandV2Caches();
}

// ── Report ───────────────────────────────────────────────────────────────────
const L = Math.log;
const geo = (xs) => Math.exp(xs.reduce((s, x) => s + L(x), 0) / xs.length);
function report(label) {
  const { usPred, auPred } = predictions();
  const obs = us.rows.map((r, i) => ({ ...r, model: usPred[i] })).filter((r) => r.real && r.model > 0);
  const tier = (c) => (c.mass < 1 ? 'S' : c.mass < 4 ? 'M' : 'L');
  const rank = { L: 0, M: 1, S: 2 };
  const tg = (t) => geo(obs.filter((r) => [tier(r.A), tier(r.B)].sort((a, b) => rank[a] - rank[b]).join('-') === t).map((r) => r.model / r.real));
  const db = (lo, hi) => geo(obs.filter((r) => r.km >= lo && r.km < hi).map((r) => r.model / r.real));
  const tot = usPred.reduce((s, x) => s + x, 0) / obs.reduce((s, r) => s + r.real, 0);
  const lr = obs.map((r) => L(r.model / r.real)); const mu = lr.reduce((a, b) => a + b) / lr.length;
  const sd = Math.sqrt(lr.reduce((s, x) => s + (x - mu) ** 2, 0) / lr.length);
  const auR = au.map((r, i) => auPred[i] / r.real);
  const al = auR.map(L); const am = al.reduce((a, b) => a + b) / al.length;
  const wGeo = Math.exp(obs.reduce((s, r) => s + Math.sqrt(r.real) * L(r.model / r.real), 0) / obs.reduce((s, r) => s + Math.sqrt(r.real), 0));
  console.log(`\n${label}`);
  console.log(`  US  traffic-weighted geo ${wGeo.toFixed(2)}`);
  console.log(`  US  total ${tot.toFixed(2)}x | geo ${Math.exp(mu).toFixed(2)} sdLog ${sd.toFixed(2)} | L-L ${tg('L-L').toFixed(2)} L-M ${tg('L-M').toFixed(2)} L-S ${tg('L-S').toFixed(2)} M-M ${tg('M-M').toFixed(2)} M-S ${tg('M-S').toFixed(2)} S-S ${tg('S-S').toFixed(2)}`);
  console.log(`      by km: <400 ${db(0, 400).toFixed(2)}  400-700 ${db(400, 700).toFixed(2)}  700-1100 ${db(700, 1100).toFixed(2)}  1100-2500 ${db(1100, 2500).toFixed(2)}  2500+ ${db(2500, 1e9).toFixed(2)}`);
  console.log(`  AU  geo ${Math.exp(am).toFixed(2)} sdLog ${Math.sqrt(al.reduce((s, x) => s + (x - am) ** 2, 0) / al.length).toFixed(2)} | SYD-MEL ${(auR[au.findIndex((r) => r.pair === 'SYD-MEL' || r.pair === 'MEL-SYD')] ?? NaN).toFixed(2)}`);
}
M.setDemandModel(1); report('Classic (v1)');
M.setDemandModel(2);
const keep = V.realism;
V.realism = 1; M.resetDemandV2Caches(); report('v2 at realism 1 (matches data)');
V.realism = keep; M.resetDemandV2Caches(); report(`v2 at realism ${keep.toFixed(3)} (the game)`);
