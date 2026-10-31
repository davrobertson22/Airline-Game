// @not-a-test — loader for the demand-model-v3 benchmark: every normalized
// route-traffic file in tools/demand-audit/data/v3/normalized_*.csv
// (source,origin_iata,dest_iata,year,month,passengers,measure,direction),
// mapped onto the game's pricing nodes (metro primaries) and turned into the
// unit baseCityPairDemand speaks: ONE-WAY WEEKLY O&D passengers.
//
//  * Year: 2024 where a source has it (the last complete year everywhere),
//    else the latest year with 12 months (or an annual row).
//  * 'both' rows are halved; 'one-way' rows are summed over both directions
//    and halved, so the result is the mean of the two directions.
//  * 'segment' sources count everyone on the flight, connecting passengers
//    included. The game prices O&D (connections are its own model), so a
//    segment figure is scaled by an O&D share: CONNECT_SHARE (assumed, from
//    published transfer rates) at each end that is a connecting hub, and
//    BASE_OD_SHARE (10% connecting, as for BITRE) everywhere else.
//  * Several sources can cover one pair (Eurostat sees UK–EU from the EU side,
//    the CAA from the UK side; T-100 and Eurostat both see US–EU): an O&D
//    source wins over a segment one, and within a measure the larger figure
//    wins (sources undercount, they don't double count).
//
// Also returns monthly shares per node pair for the season fit.

import { readFileSync, readdirSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { distanceKm, metroOf } from '../../../src/utils/market.js';
import { getAirport } from '../../../src/data/airports.js';

const here = dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = join(here, '..', 'data', 'v3');
export const BASE_OD_SHARE = 0.9;
// Share of a hub's passengers who are CONNECTING (approximate, published
// airport transfer rates; a metro's figure blends its airports). Assumption,
// not fitted — the factor fit cannot separate a hub's transfers from its O&D.
export const CONNECT_SHARE = {
  LHR: 0.20, CDG: 0.22, FRA: 0.50, AMS: 0.36, MUC: 0.35, IST: 0.40, ZRH: 0.30, VIE: 0.25,
  HEL: 0.45, CPH: 0.20, MAD: 0.20, FCO: 0.15, LIS: 0.25, BRU: 0.12, ARN: 0.10, OSL: 0.10,
  ATH: 0.15, DOH: 0.75, DXB: 0.55, AUH: 0.60, ADD: 0.70, SVO: 0.35, WAW: 0.25,
  ATL: 0.55, DFW: 0.50, ORD: 0.40, DEN: 0.35, IAH: 0.40, CLT: 0.65, DTW: 0.40, MSP: 0.40,
  PHX: 0.20, SLC: 0.45, SEA: 0.15, JFK: 0.15, EWR: 0.15, MIA: 0.25, LAX: 0.15, SFO: 0.15,
  YYZ: 0.30, YVR: 0.20, YUL: 0.15, PTY: 0.80, BOG: 0.25, MEX: 0.20, GRU: 0.30, LIM: 0.25,
  SIN: 0.30, HKG: 0.30, ICN: 0.30, NRT: 0.30, BKK: 0.20, KUL: 0.20, SYD: 0.10, AKL: 0.10,
};

// Hubs whose transfers are mostly between two OTHER countries (a small home
// market, a global network). On a country total their transfers are another
// country pair's traffic; a big-country hub's (Atlanta, Sydney) are mostly its
// own country's domestic feed, which IS that country's international O&D.
export const TRANSIT_HUBS = new Set(['LHR', 'CDG', 'FRA', 'AMS', 'MUC', 'IST', 'ZRH', 'VIE', 'HEL', 'CPH', 'MAD', 'FCO',
  'LIS', 'BRU', 'ATH', 'DOH', 'DXB', 'AUH', 'ADD', 'SVO', 'WAW', 'KEF', 'PTY', 'BOG', 'SIN', 'HKG', 'ICN', 'BKK', 'KUL', 'TPE', 'AKL']);
CONNECT_SHARE.KEF = 0.5; CONNECT_SHARE.TPE = 0.3;

export const nodeOf = (code) => { if (!getAirport(code)) return null; const mt = metroOf(code); return mt ? mt.primary : code; };
const odShare = (a, b) => (1 - (CONNECT_SHARE[a] ?? 1 - BASE_OD_SHARE)) * (CONNECT_SHARE[b] != null ? (1 - CONNECT_SHARE[b]) : 1);

export function loadV3Real({ year = 2024, sources = null } = {}) {
  const files = existsSync(DATA_DIR) ? readdirSync(DATA_DIR).filter((f) => /^normalized_.*\.csv$/.test(f)) : [];
  // per source: node pair -> { year -> { months: Map(m -> pax), annual } }
  const bySrc = new Map();
  const unmapped = new Map();
  for (const f of files) {
    const lines = readFileSync(join(DATA_DIR, f), 'utf8').trim().split(/\r?\n/);
    const hdr = lines[0].split(',');
    const ix = Object.fromEntries(hdr.map((h, i) => [h.trim(), i]));
    for (const l of lines.slice(1)) {
      const c = l.split(',');
      const src = c[ix.source], A = nodeOf(c[ix.origin_iata]), B = nodeOf(c[ix.dest_iata]);
      if (sources && !sources.includes(src)) continue;
      if (!A || !B) { const k = !A ? c[ix.origin_iata] : c[ix.dest_iata]; unmapped.set(k, (unmapped.get(k) ?? 0) + +c[ix.passengers]); continue; }
      if (A === B) continue;
      const pax = +c[ix.passengers]; if (!(pax > 0)) continue;
      const y = +c[ix.year], m = +c[ix.month];
      const key = A < B ? A + '-' + B : B + '-' + A;
      if (!bySrc.has(src)) bySrc.set(src, { measure: c[ix.measure], pairs: new Map() });
      const S = bySrc.get(src);
      const P = S.pairs.get(key) ?? new Map(); S.pairs.set(key, P);
      const Y = P.get(y) ?? { months: new Map(), annual: 0 }; P.set(y, Y);
      const half = c[ix.direction] === 'both' ? pax / 2 : pax / 2;   // one-way rows: sum both dirs, then halve
      if (m >= 1) Y.months.set(m, (Y.months.get(m) ?? 0) + half);
      else Y.annual += half;
    }
  }
  // Pick ONE year per source — the requested one if the source covers all of
  // it, else its latest complete year — and use it for every pair. A route
  // missing some months that year (a summer-only holiday route) is a route
  // with no traffic in them, not a gap: its year is the sum of the months it
  // has. Converted to weekly one-way O&D.
  const out = new Map();
  for (const [src, S] of bySrc) {
    const cover = new Map();   // year -> Set(months seen) | 'annual'
    for (const P of S.pairs.values()) for (const [y, Y] of P) {
      if (Y.annual > 0) { cover.set(y, 'annual'); continue; }
      if (cover.get(y) === 'annual') continue;
      const set = cover.get(y) ?? new Set(); for (const m of Y.months.keys()) set.add(m); cover.set(y, set);
    }
    const complete = (y) => cover.get(y) === 'annual' || cover.get(y)?.size === 12;
    const yrs = [...cover.keys()].sort((x, y) => y - x);
    const pick = complete(year) ? year : yrs.find(complete);
    if (pick == null) continue;
    S.year = pick;
    for (const [key, P] of S.pairs) {
      const Y = P.get(pick);
      if (!Y) continue;
      const yearPax = Y.annual > 0 ? Y.annual : [...Y.months.values()].reduce((s, v) => s + v, 0);
      const [A, B] = key.split('-');
      const share = S.measure === 'od' ? 1 : odShare(A, B);
      const real = yearPax * share / 52;
      const months = Y.annual > 0 ? null : Array.from({ length: 12 }, (_, i) => Y.months.get(i + 1) ?? 0);
      const prev = out.get(key);
      const better = !prev || (S.measure === 'od' && prev.measure !== 'od') || (S.measure === prev.measure && yearPax / 52 > prev.raw);
      if (better) out.set(key, { key, a: A, b: B, real, raw: yearPax / 52, measure: S.measure, src, year: pick, months, hubConnect: share < BASE_OD_SHARE - 1e-9,
        km: distanceKm(getAirport(A), getAirport(B)), ca: getAirport(A).country, cb: getAirport(B).country });
    }
  }
  return { rows: [...out.values()], sources: [...bySrc.keys()], unmapped };
}
