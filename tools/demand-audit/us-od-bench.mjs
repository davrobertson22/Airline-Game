// @not-a-test — calibration report, prints a benchmark; asserts nothing.
//
// US long-tail demand benchmark. bench.mjs checks the gravity model against 47
// hand-estimated big-city pairs, but 74% of the game's airports are smaller
// than the smallest city in it. This script checks baseCityPairDemand() against
// every contiguous-US city-pair market in the DOT Consumer Airfare Report
// (Table 6: true O&D from the DB1B ticket sample, markets >= 10 pax/day).
// Mapping and aggregation are described in us-od-data.mjs.
//
//   node tools/demand-audit/fetch-dot-car.mjs      (once / per new DOT quarter)
//   node tools/demand-audit/us-od-bench.mjs [--pairs]
//
// Censoring: the fit includes every pair the model sizes at >= 350/wk and
// imputes 17.5/wk for those absent from Table 6, so over-prediction on thin
// pairs isn't hidden by the table's cut-off.
// Caveats: DB1B counts fare-paying tickets on US carriers (award travel is
// excluded, so real O&D is somewhat higher, maybe 5-10%); the game's base
// demand is at reference price, DOT's is at actual fares.
//
// What-if knob for trying a mass-exponent change without touching the game:
//   WHATIF_BETA=0.25 WHATIF_REF=20 node tools/demand-audit/us-od-bench.mjs
// scales each node pair by ((Mo·Md)/REF²)^BETA, i.e. per-end exponent 0.5+BETA,
// unchanged for two REF-million endpoints.

import { baseCityPairDemand, getDemandMass } from '../../src/utils/market.js';
import { getAirport } from '../../src/data/airports.js';
import { loadUsOd, priceRows, THRESH_WK } from './us-od-data.mjs';

const SHOW_PAIRS = process.argv.includes('--pairs');
const WI_BETA = Number(process.env.WHATIF_BETA ?? 0), WI_REF = Number(process.env.WHATIF_REF ?? 20);
const whatIf = (a, b) => (WI_BETA ? Math.pow((getDemandMass(getAirport(a), true) * getDemandMass(getAirport(b), true)) / (WI_REF * WI_REF), WI_BETA) : 1);
if (WI_BETA) console.log(`WHAT-IF: per-end mass exponent ${0.5 + WI_BETA}, reference mass ${WI_REF}M`);

const data = loadUsOd();
const rows = priceRows(data.rows, (a, b) => baseCityPairDemand(a, b) * whatIf(a, b));

const fmt = (v, d = 2) => (v == null ? '-' : v.toFixed(d));
const stats = (rs) => {
  const lr = rs.map((r) => Math.log(r.model / r.real)).sort((a, b) => a - b);
  const n = lr.length; if (!n) return null;
  const mu = lr.reduce((s, x) => s + x, 0) / n;
  const sd = Math.sqrt(lr.reduce((s, x) => s + (x - mu) ** 2, 0) / n);
  const w2 = lr.filter((x) => Math.abs(x) < Math.log(2)).length / n;
  return { n, median: Math.exp(lr[Math.floor(n / 2)]), geo: Math.exp(mu), sdLog: sd, within2x: w2 };
};
const line = (label, rs) => { const s = stats(rs); if (!s) return; console.log(label.padEnd(22), String(s.n).padStart(6), fmt(s.median).padStart(7), fmt(s.geo).padStart(7), fmt(s.sdLog).padStart(7), (fmt(100 * s.within2x, 0) + '%').padStart(7)); };
const head = (t) => { console.log('\n' + t); console.log(''.padEnd(22), '     n  median geomean  sdLog  <2x'); };

const obs = rows.filter((r) => r.real && r.model > 0);
const mk = data.markets;
console.log(`DOT quarters: ${data.quarters.join(' ')} | city markets ${mk.length}, mapped ${mk.filter((x) => x.nodes.length).length} (${mk.filter((x) => x.inferred).length} triangulated) | clusters ${data.clusters.length}`);
console.log(`passengers covered by game airports: ${(100 * data.paxMapped / data.paxAll).toFixed(1)}%`);
console.log('ratio = model / real (one-way weekly O&D). 1.00 = perfect.');

head('Observed pairs (in DOT Table 6)');
line('all', obs);
line('real >= 1,000/wk', obs.filter((r) => r.real >= 1000));
line('both full 4 quarters', obs.filter((r) => r.nq === data.quarters.length));

const minMass = (r) => Math.min(r.A.mass, r.B.mass);
head('By smaller endpoint mass (M people)');
for (const [lo, hi] of [[0, 0.3], [0.3, 0.7], [0.7, 1.5], [1.5, 4], [4, 1e9]]) line(`${lo}–${hi === 1e9 ? '∞' : hi}`, obs.filter((r) => minMass(r) >= lo && minMass(r) < hi));
head('By distance (km)');
for (const [lo, hi] of [[0, 400], [400, 700], [700, 1100], [1100, 1700], [1700, 2500], [2500, 3500], [3500, 1e9]]) line(`${lo}–${hi === 1e9 ? '∞' : hi}`, obs.filter((r) => r.km >= lo && r.km < hi));
head('By leisure pull (larger visitor share of either end)');
const vs = (r) => Math.max(r.A.visitorShare, r.B.visitorShare);
line('no visitor mass', obs.filter((r) => vs(r) === 0));
line('visitors < 50% mass', obs.filter((r) => vs(r) > 0 && vs(r) < 0.5));
line('visitors >= 50% mass', obs.filter((r) => vs(r) >= 0.5));
head('By endpoint size (S < 1M, M 1–4M, L >= 4M people)');
const tier = (c) => (c.mass < 1 ? 'S' : c.mass < 4 ? 'M' : 'L');
const rank = { L: 0, M: 1, S: 2 };
for (const t of ['L-L', 'L-M', 'L-S', 'M-M', 'M-S', 'S-S']) line(t, obs.filter((r) => [tier(r.A), tier(r.B)].sort((a, b) => rank[a] - rank[b]).join('-') === t));

const totModel = rows.reduce((s, r) => s + r.model, 0), totReal = obs.reduce((s, r) => s + r.real, 0);
console.log(`\nTotal one-way weekly O&D across all mapped US pairs: model ${Math.round(totModel).toLocaleString()} vs real ${Math.round(totReal).toLocaleString()} (${fmt(totModel / totReal)}×)`);
const absent = rows.filter((r) => !r.real);
console.log(`  ${fmt(100 * absent.reduce((s, r) => s + r.model, 0) / totModel, 0)}% of the model's US demand sits on pairs DOT shows under ${THRESH_WK}/wk`);

console.log(`\nCensored: pairs the model sizes but DOT shows < ${THRESH_WK}/wk (absent from Table 6)`);
for (const [lo, hi] of [[THRESH_WK, 100], [100, 350], [350, 1000], [1000, 1e9]]) {
  const inB = rows.filter((r) => r.model >= lo && r.model < hi);
  const ab = inB.filter((r) => !r.real).length;
  console.log(`  model ${String(lo).padStart(4)}–${hi === 1e9 ? '∞   ' : String(hi).padEnd(4)}/wk: ${String(inB.length).padStart(6)} pairs, ${String(ab).padStart(5)} absent (${fmt(100 * ab / Math.max(1, inB.length), 0)}%)`);
}

// OLS: log(real/model) on centred log mass product and log distance.
function ols(X, y) {
  const k = X[0].length, XtX = Array.from({ length: k }, () => new Array(k).fill(0)), Xty = new Array(k).fill(0);
  for (let i = 0; i < X.length; i++) for (let a = 0; a < k; a++) { Xty[a] += X[i][a] * y[i]; for (let b = 0; b < k; b++) XtX[a][b] += X[i][a] * X[i][b]; }
  const M = XtX.map((row, i) => [...row, Xty[i]]);
  for (let c = 0; c < k; c++) { let p = c; for (let r = c + 1; r < k; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r; [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < k; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let q = c; q <= k; q++) M[r][q] -= f * M[c][q]; } }
  const beta = M.map((row, i) => row[k] / row[i]);
  const res = y.map((yi, i) => yi - X[i].reduce((s, x, a) => s + x * beta[a], 0));
  return { beta, sd: Math.sqrt(res.reduce((s, e) => s + e * e, 0) / y.length) };
}
const fitSet = rows.filter((r) => r.model >= 350).map((r) => ({ ...r, y: Math.log((r.real ?? THRESH_WK / 2) / r.model), imputed: !r.real }));
const X = fitSet.map((r) => [1, Math.log(r.A.mass * r.B.mass), Math.log(r.km)]);
const means = X[0].map((_, a) => (a === 0 ? 0 : X.reduce((s, x) => s + x[a], 0) / X.length));
const Xc = X.map((x) => x.map((v, a) => (a === 0 ? 1 : v - means[a])));
const y = fitSet.map((r) => r.y);
const fit = ols(Xc, y);
const ybar = y.reduce((a, b) => a + b, 0) / y.length;
const sd0 = Math.sqrt(y.reduce((s, v) => s + (v - ybar) ** 2, 0) / y.length);
console.log(`\nFit on ${fitSet.length} pairs with model >= 350/wk (${fitSet.filter((r) => r.imputed).length} censored, imputed at ${THRESH_WK / 2}/wk)`);
console.log(`  log(real/model) = ${fmt(fit.beta[0], 3)} + ${fmt(fit.beta[1], 3)}·log(Mo·Md) + ${fmt(fit.beta[2], 3)}·log(km)   [centred]`);
console.log(`  level: real ≈ ${fmt(Math.exp(fit.beta[0]))}× model at the sample mean`);
console.log(`  implied per-end mass exponent: ${fmt(0.5 + fit.beta[1], 3)} (model uses 0.5)`);
console.log(`  distance: real/model changes by ${fmt(fit.beta[2], 3)} per log-km on top of the model's (1+d/3000)^-1.1`);
console.log(`  log-residual SD: ${fmt(sd0, 3)} -> ${fmt(fit.sd, 3)} after correction`);

const big = obs.filter((r) => r.real >= 700).sort((a, b) => a.model / a.real - b.model / b.real);
const pr = (r) => `  ${(r.A.label + ' — ' + r.B.label).slice(0, 78).padEnd(78)} ${String(Math.round(r.km)).padStart(5)}km model ${String(Math.round(r.model)).padStart(6)} real ${String(Math.round(r.real)).padStart(6)} ratio ${fmt(r.model / r.real)}`;
console.log('\nMost UNDER-predicted (real >= 700/wk):'); big.slice(0, SHOW_PAIRS ? 60 : 20).forEach((r) => console.log(pr(r)));
console.log('\nMost OVER-predicted (real >= 700/wk):'); big.slice(-(SHOW_PAIRS ? 60 : 20)).reverse().forEach((r) => console.log(pr(r)));
const cens = absent.filter((r) => r.model >= 350).sort((a, b) => b.model - a.model);
console.log(`\nLargest model pairs DOT shows under ${THRESH_WK}/wk:`); cens.slice(0, SHOW_PAIRS ? 40 : 15).forEach((r) => console.log(`  ${(r.A.label + ' — ' + r.B.label).slice(0, 78).padEnd(78)} ${String(Math.round(r.km)).padStart(5)}km model ${String(Math.round(r.model)).padStart(6)}`));
