// @not-a-test — fits demand-model-v3 seasonal profiles and WRITES
// src/data/demandV3Seasons.js.
//
//   node tools/demand-audit/v3/fit-v3-seasons.mjs [--dry]
//
// A route's monthly shape is modelled as the PRODUCT of its two airports'
// profiles (renormalised to mean 1) — v3's blend in getSeasonalProfile. v2
// averaged them, which cannot express a summer-only island route from a
// year-round hub: the average leaves half the summer peak in January, and the
// fit then drags the HUB's own profile down in summer to compensate. In logs
// the product is additive, so the fit is alternating weighted least squares on
//   log(index + EPS) − its monthly mean = s_A + s_B     (each s mean 0)
// weight sqrt traffic, each airport shrunk toward a same-country regional
// surface. Monthly data from every v3 source (real-data.mjs). Profiles are
// written for every airport in a covered country (the US and Australia too:
// a v3 game refits them under the product blend); others in a covered
// country take their region's surface. Annual mean 1: seasons move demand
// between months, never add or remove it.

import { writeFileSync } from 'fs';
import { AIRPORTS, getAirport } from '../../../src/data/airports.js';
import { distanceKm } from '../../../src/utils/market.js';
import { SEASONAL_PROFILES } from '../../../src/models/demand.js';
import { loadV3Real, nodeOf } from './real-data.mjs';
import { COVERED_COUNTRIES } from './covered.mjs';

const DRY = process.argv.includes('--dry');
const SURFACE_KM = 400, SHRINK = 8, EPS = 0.03, MIN_WK = 20, LOG_FLOOR = Math.log(0.1);

const real = loadV3Real();
const covered = COVERED_COUNTRIES(real.sources);
const P = 12;
const centre = (v) => { const m = v.reduce((s, x) => s + x, 0) / v.length; return v.map((x) => x - m); };
const obs = [];
for (const r of real.rows) {
  if (!r.months || !(r.real >= MIN_WK)) continue;
  const mean = r.months.reduce((s, x) => s + x, 0) / 12;
  if (!(mean > 0)) continue;
  obs.push({ a: r.a, b: r.b, cls: r.ca === r.cb ? 'dom' : 'intl', y: r.months.map((x) => x / mean), ly: centre(r.months.map((x) => Math.log(x / mean + EPS))),
    w: Math.sqrt(r.real) * (r.hubConnect ? 0.5 : 1) });
}
const keys = [...new Set(obs.flatMap((o) => [o.a, o.b]))];
const keyW0 = new Map(keys.map((k) => [k, 0]));
for (const o of obs) { keyW0.set(o.a, keyW0.get(o.a) + o.w); keyW0.set(o.b, keyW0.get(o.b) + o.w); }
const s = new Map(keys.map((k) => [k, new Array(P).fill(0)]));
const prior = new Map(keys.map((k) => [k, new Array(P).fill(0)]));
// Plus one profile per route CLASS (domestic / international) that every
// route of the class shares: what makes Frankfurt–London peak in summer when
// neither hub, on its own business-heavy network, does. The endpoint terms
// are kept free of it by centring them across airports each month.
const g = { dom: new Array(P).fill(0), intl: new Array(P).fill(0) };
function solve(shrink) {
  for (let it = 0; it < 60; it++) {
    const num = new Map(keys.map((k) => [k, new Array(P).fill(0)])), den = new Map(keys.map((k) => [k, 0]));
    for (const o of obs) for (const [me, other] of [[o.a, o.b], [o.b, o.a]]) {
      const n = num.get(me), so = s.get(other), gc = g[o.cls];
      for (let p = 0; p < P; p++) n[p] += o.w * (o.ly[p] - so[p] - gc[p]);
      den.set(me, den.get(me) + o.w);
    }
    for (const k of keys) {
      const pr = prior.get(k), n = num.get(k), d = den.get(k);
      s.set(k, centre(n.map((x, p) => Math.max(LOG_FLOOR, (x + shrink * pr[p]) / (d + shrink)))));
    }
    // Centre the endpoint terms across airports (traffic-weighted) per month,
    // then refit the class profiles on what is left.
    const mu = new Array(P).fill(0); let W = 0;
    for (const k of keys) { const w = keyW0.get(k); W += w; const v = s.get(k); for (let p = 0; p < P; p++) mu[p] += w * v[p]; }
    for (const k of keys) s.set(k, s.get(k).map((x, p) => x - mu[p] / W));
    for (const cls of ['dom', 'intl']) {
      const acc = new Array(P).fill(0); let wc = 0;
      for (const o of obs) { if (o.cls !== cls) continue; const sa = s.get(o.a), sb = s.get(o.b); for (let p = 0; p < P; p++) acc[p] += o.w * (o.ly[p] - sa[p] - sb[p]); wc += o.w; }
      if (wc > 0) g[cls] = centre(acc.map((x) => x / wc));
    }
  }
}
solve(0.5);
const keyAp = new Map(keys.map((k) => [k, getAirport(k)]));
const keyW = new Map(keys.map((k) => [k, 0]));
for (const o of obs) { keyW.set(o.a, keyW.get(o.a) + o.w); keyW.set(o.b, keyW.get(o.b) + o.w); }
function surfaceOf(ap) {
  const num = new Array(P).fill(0); let den = 0;
  for (const [k, v] of s) {
    const b = keyAp.get(k); if (!b || b.country !== ap.country) continue;
    const w = keyW.get(k) * Math.exp(-0.5 * (distanceKm(ap, b) / SURFACE_KM) ** 2);
    for (let p = 0; p < P; p++) num[p] += w * v[p]; den += w;
  }
  if (!(den > 1e-9)) return null;
  return centre(num.map((x) => x / den));
}
for (const k of keys) prior.set(k, surfaceOf(keyAp.get(k)) ?? new Array(P).fill(0));
solve(SHRINK);

const prof = (lv) => { const e = lv.map((x) => Math.exp(x)); const m = e.reduce((a, x) => a + x, 0) / P; return e.map((x) => +(x / m).toFixed(3)); };
const profiles = {};
// India's DGCA tables are annual (no months): its airports would be profiled
// only from their international partners' months. Leave them on v2/classic.
const NO_MONTHLY = new Set(['IN']);
const own = (c) => covered.has(c) && !NO_MONTHLY.has(c);
// Covered airports always; any other airport the data sees on enough routes
// too (Singapore, Dubai, Cancún…), since covered airports' profiles were
// fitted against their partners' fitted terms and a classic archetype on the
// other end would undo that.
const MIN_PARTNER_W = 3 * Math.pow(500, 0.5);
for (const k of keys) if (own(keyAp.get(k).country) || (!NO_MONTHLY.has(keyAp.get(k).country) && keyW0.get(k) >= MIN_PARTNER_W)) profiles[k] = prof(s.get(k));
let surfaced = 0;
for (const ap of AIRPORTS) {
  if (!own(ap.country)) continue;
  const n = nodeOf(ap.code); if (profiles[n]) continue;
  const v = surfaceOf(getAirport(n)); if (!v) continue;
  profiles[n] = prof(v); surfaced++;
}
const classProfile = { dom: prof(g.dom), intl: prof(g.intl) };
const blend = (pa, pb, cls) => { const x = pa.map((v, i) => v * pb[i] * classProfile[cls][i]); const m = x.reduce((a, v) => a + v, 0) / P; return x.map((v) => v / m); };

// Report: monthly-index RMS error, classic archetypes vs fitted.
import('../../../src/models/demand.js').then(({ classicSeasonalProfileForAirport }) => {
  let seC = 0, seF = 0, n = 0;
  for (const o of obs) {
    if (!own(getAirport(o.a).country) || !own(getAirport(o.b).country)) continue;
    const ca = classicSeasonalProfileForAirport(o.a), cb = classicSeasonalProfileForAirport(o.b);
    const fa = profiles[o.a] ?? ca.slice(1), fb = profiles[o.b] ?? cb.slice(1);
    const f = blend(fa, fb, o.cls);
    for (let p = 0; p < P; p++) {
      seC += o.w * (o.y[p] - (ca[p + 1] + cb[p + 1]) / 2) ** 2;
      seF += o.w * (o.y[p] - f[p]) ** 2; n += o.w;
    }
  }
  console.log(`${obs.length} routes, ${Object.keys(profiles).length - surfaced} airports fitted, ${surfaced} from the surface`);
  console.log('(error on routes with both ends in covered countries; fitted = product blend)');
  console.log(`monthly-index RMS error: classic ${Math.sqrt(seC / n).toFixed(3)}, fitted ${Math.sqrt(seF / n).toFixed(3)}`);
  console.log('class profiles: dom', classProfile.dom.map((x) => x.toFixed(2)).join(' '), '| intl', classProfile.intl.map((x) => x.toFixed(2)).join(' '));
  for (const c of ['LHR', 'CDG', 'FRA', 'MAD', 'PMI', 'HER', 'AYT', 'TFS', 'OSL', 'TOS', 'GVA', 'INN', 'GRU', 'DEL', 'HND', 'YYZ', 'CUN']) {
    const p = profiles[c]; if (p) console.log('  ', c.padEnd(4), p.map((x) => x.toFixed(2)).join(' '));
  }
  if (!DRY) {
    const body = Object.entries(profiles).sort(([x], [y]) => (x < y ? -1 : 1)).map(([c, v]) => `  ${c}: [${v.join(',')}],`).join('\n');
    writeFileSync(new URL('../../../src/data/demandV3Seasons.js', import.meta.url), `// GENERATED by tools/demand-audit/v3/fit-v3-seasons.mjs — do not hand-edit.
// Demand-model-v3 seasonal profiles (Jan..Dec, annual mean 1), fitted to the
// monthly route traffic of every v3 source (${real.sources.join(', ')}).
// Blended as a normalised PRODUCT in a v3 game. See models/demand.js.
export const SEASONS = {
${body}
};
// Every v3-blended route also carries its class's profile (domestic or
// international): the seasonality all routes of the class share.
export const CLASS_SEASONS = {
  dom: [${classProfile.dom.join(',')}],
  intl: [${classProfile.intl.join(',')}],
};
`);
    console.log(`wrote src/data/demandV3Seasons.js (${Object.keys(profiles).length} airports)`);
  }
});
