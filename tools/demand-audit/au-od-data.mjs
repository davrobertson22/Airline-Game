// @not-a-test — loader for the Australian domestic benchmark (BITRE).
//
// Source: BITRE "Domestic Airlines - Top Routes and Totals" (data.gov.au,
// dom_citypairs_web.csv): revenue passengers per city pair per month, both
// directions, on non-stop flights. These are flight-leg counts, not true O&D,
// so like bench.mjs we strip an assumed connecting share (AU_OD_SHARE) — the
// trunks are mostly local traffic, regional spokes into Sydney/Brisbane carry
// some connections.
//
//   curl -L -o tools/demand-audit/data/bitre-dom-citypairs.csv \
//     https://data.gov.au/data/dataset/c5029f2a-39b3-4aef-8ae1-73e7962f6170/resource/677d307f-6a1f-4de4-9b85-5e1aa7074423/download/dom_citypairs_web.csv
//
// Uses the latest 12 months in the file; a pair must have all 12 to count.
// City -> airport by the game's city name (metro primary when it has one).

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { distanceKm, getDemandMass, metroOf } from '../../src/utils/market.js';
import { AIRPORTS, getAirport } from '../../src/data/airports.js';

const here = dirname(fileURLToPath(import.meta.url));
export const AU_OD_SHARE = 0.9;

export function loadAuOd() {
  const lines = readFileSync(join(here, 'data', 'bitre-dom-citypairs.csv'), 'utf8').replace(/^﻿/, '').trim().split(/\r?\n/);
  const rows = lines.slice(1).map((l) => l.split(','));
  const key = (r) => +r[10] * 12 + (+r[11] - 1);
  const last = Math.max(...rows.map(key));
  const agg = new Map();
  for (const r of rows) {
    if (last - key(r) >= 12) continue;
    const k = r[0] + '|' + r[1];
    const e = agg.get(k) ?? { pax: 0, months: 0 };
    e.pax += +r[3]; if (+r[3] > 0) e.months++;
    agg.set(k, e);
  }
  const au = AIRPORTS.filter((a) => a.country === 'AU');
  const node = (city) => {
    const ap = au.find((a) => (a.city || '').toUpperCase() === city);
    if (!ap) return null;
    const mt = metroOf(ap.code);
    return mt ? mt.primary : ap.code;
  };
  const out = [];
  for (const [k, e] of agg) {
    if (e.months < 12) continue;
    const [c1, c2] = k.split('|');
    const a = node(c1), b = node(c2);
    if (!a || !b || a === b) continue;
    out.push({
      pair: `${a}-${b}`, a, b, label: `${c1} — ${c2}`,
      km: distanceKm(getAirport(a), getAirport(b)),
      massA: getDemandMass(getAirport(a), true), massB: getDemandMass(getAirport(b), true),
      real: e.pax * AU_OD_SHARE / 2 / 52,
    });
  }
  const lastY = Math.floor(last / 12), lastM = (last % 12) + 1;
  return { rows: out, window: `12 months to ${lastY}-${String(lastM).padStart(2, '0')}`, pairsInFile: agg.size };
}
