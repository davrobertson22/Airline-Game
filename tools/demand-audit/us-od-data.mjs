// @not-a-test — shared loader for the US DOT O&D benchmark (see us-od-bench.mjs).
//
// Builds, once per process, the comparison set between the game and the DOT
// Consumer Airfare Report Table 6 (true O&D from the DB1B ticket sample):
//
//  * DOT city markets -> game airports. Table 1a names the airports in every
//    market it touches; the rest are triangulated (the game airport whose great-
//    circle distances best match DOT's nonstop miles to >= 10 already-known
//    partners, median error < 2%). Markets the game lacks are dropped.
//  * Clusters: DOT markets and game metros are merged wherever they share an
//    airport (DOT "Boston" = BOS+MHT+PVD; game "nyc" = JFK+LGA+EWR...), so
//    both sides are compared at the same aggregation. The model side of a
//    cluster pair is the sum of the demand function over its game node pairs.
//  * real one-way weekly O&D = mean pax/day over the 4 quarters x 7 / 2.
//    A cluster pair absent from Table 6 carried < 10 pax/day (< 35/wk).
//
// Node pairs are returned so a caller can re-price every row with any demand
// function (refits, what-ifs) without rebuilding the mapping.

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { distanceKm, getDemandMass, metroOf } from '../../src/utils/market.js';
import { AIRPORTS, getAirport, getAirportScores } from '../../src/data/airports.js';

const here = dirname(fileURLToPath(import.meta.url));
const KM_PER_MI = 1.609344;
export const THRESH_WK = 10 * 7 / 2;

export function loadUsOd() {
  const load = (f) => JSON.parse(readFileSync(join(here, 'data', f), 'utf8'));
  const t6 = load('dot-car-table6.json');
  const t1a = load('dot-car-table1a.json');

  const markets = new Map();
  const mkt = (id, name) => {
    if (!markets.has(id)) markets.set(id, { id, name, aps: new Set(), nb: [], pax: 0 });
    return markets.get(id);
  };
  for (const r of t1a) { mkt(r.citymarketid_1, r.city1).aps.add(r.airport_1); mkt(r.citymarketid_2, r.city2).aps.add(r.airport_2); }
  const seenPair = new Set();
  for (const r of t6) {
    const a = mkt(r.citymarketid_1, r.city1), b = mkt(r.citymarketid_2, r.city2);
    a.pax += +r.passengers; b.pax += +r.passengers;
    const k = a.id + '|' + b.id;
    if (!seenPair.has(k)) { seenPair.add(k); a.nb.push([b.id, +r.nsmiles]); b.nb.push([a.id, +r.nsmiles]); }
  }
  const soloCode = new Map();
  for (const x of markets.values()) if (x.aps.size === 1) soloCode.set(x.id, [...x.aps][0]);
  const usAirports = AIRPORTS.filter((a) => a.country === 'US');
  const triangulate = (code, x) => {
    const ap = getAirport(code);
    const errs = [];
    for (const [pid, mi] of x.nb) {
      const pa = getAirport(soloCode.get(pid));
      if (pa) errs.push(Math.abs(distanceKm(ap, pa) / KM_PER_MI - mi) / mi);
    }
    if (errs.length < 10) return null;
    errs.sort((p, q) => p - q);
    return errs[Math.floor(errs.length / 2)];
  };
  for (let round = 0; round < 4; round++) {
    for (const x of markets.values()) {
      if (x.aps.size) continue;
      let best = null, bestErr = Infinity;
      for (const a of usAirports) { const e = triangulate(a.code, x); if (e != null && e < bestErr) { bestErr = e; best = a.code; } }
      if (best && bestErr < 0.02) { x.aps.add(best); x.inferred = best; soloCode.set(x.id, best); }
    }
  }

  const nodeOf = (code) => { if (!getAirport(code)) return null; const mt = metroOf(code); return mt ? mt.primary : code; };
  const parent = new Map();
  const find = (k) => { while (parent.get(k) !== k) { parent.set(k, parent.get(parent.get(k))); k = parent.get(k); } return k; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
  for (const x of markets.values()) {
    x.nodes = [...new Set([...x.aps].map(nodeOf).filter(Boolean))];
    if (!x.nodes.length) continue;
    parent.set('M' + x.id, 'M' + x.id);
    for (const n of x.nodes) { if (!parent.has(n)) parent.set(n, n); union('M' + x.id, n); }
  }
  const clusters = new Map();
  for (const x of markets.values()) {
    if (!x.nodes.length) continue;
    const c = find('M' + x.id);
    if (!clusters.has(c)) clusters.set(c, { key: c, names: [], nodes: new Set() });
    const cl = clusters.get(c); cl.names.push(x.name); x.nodes.forEach((n) => cl.nodes.add(n));
    x.cluster = c;
  }
  for (const cl of clusters.values()) {
    cl.nodes = [...cl.nodes];
    const massOf = (n) => getDemandMass(getAirport(n), true);
    cl.mass = cl.nodes.reduce((s, n) => s + massOf(n), 0);
    cl.anchor = cl.nodes.reduce((b, n) => (massOf(n) > massOf(b) ? n : b));
    const sc = getAirportScores(cl.anchor);
    cl.appeal = (sc.businessScore + sc.leisureScore) / 100;
    const ap = getAirport(cl.anchor);
    cl.visitorShare = ((ap.visitors ?? 0) * 1.5) / Math.max(0.01, massOf(cl.anchor));
    cl.label = cl.nodes.join('/') + ' ' + cl.names[0].replace(/ \(Metropolitan Area\)/, '');
  }

  let paxAll = 0, paxMapped = 0;
  const real = new Map();
  const quarters = new Set(t6.map((r) => r.year + 'Q' + r.quarter));
  const pk = (a, b) => (a < b ? a + '\u0000' + b : b + '\u0000' + a);
  for (const r of t6) {
    const p = +r.passengers; paxAll += p;
    const a = markets.get(r.citymarketid_1), b = markets.get(r.citymarketid_2);
    if (!a.cluster || !b.cluster || a.cluster === b.cluster) continue;
    paxMapped += p;
    const k = pk(a.cluster, b.cluster);
    if (!real.has(k)) real.set(k, { perDay: 0, q: new Set() });
    const e = real.get(k); e.perDay += p / quarters.size; e.q.add(r.year + 'Q' + r.quarter);
  }

  const cl = [...clusters.values()];
  const rows = [];
  for (let i = 0; i < cl.length; i++) for (let j = i + 1; j < cl.length; j++) {
    const A = cl[i], B = cl[j];
    const nodePairs = [];
    for (const a of A.nodes) for (const b of B.nodes) nodePairs.push([a, b]);
    const r = real.get(pk(A.key, B.key));
    rows.push({ A, B, nodePairs, km: distanceKm(getAirport(A.anchor), getAirport(B.anchor)), real: r ? r.perDay * 7 / 2 : null, nq: r ? r.q.size : 0 });
  }
  return { rows, clusters: cl, markets: [...markets.values()], quarters: [...quarters].sort(), paxAll, paxMapped };
}

/** Re-price every row with a demand function (a, b) => one-way weekly O&D. Drops pairs both sides say are empty. */
export function priceRows(rows, demand) {
  const out = [];
  for (const r of rows) {
    let model = 0;
    for (const [a, b] of r.nodePairs) model += demand(a, b);
    if (model > 0 || r.real) out.push({ ...r, model });
  }
  return out;
}
