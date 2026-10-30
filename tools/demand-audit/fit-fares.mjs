// @not-a-test — fits the demand-model-v2 domestic fare curve; prints it, changes nothing.
//
//   node tools/demand-audit/fit-fares.mjs
//
// DOT Table 6's `fare` is the average one-way price paid per passenger in the
// market, INCLUDING ticket taxes, airport fees and first-class tickets (DOT
// Consumer Airfare Report methodology), excluding ancillaries and award tickets.
// The game's referencePrice is an ex-tax ECONOMY fare, so each market's fare is
// converted before fitting:
//
//   economy-equivalent = (fare − FEES) / (1 + EXCISE) / PREMIUM_UPLIFT
//
//   FEES           ~$18 per one-way trip: $5.60 security fee + ~1.3 segments ×
//                  ($5.30 segment tax + $4.50 PFC)
//   EXCISE         7.5% US domestic ticket tax
//   PREMIUM_UPLIFT 1.15: ~9% of US domestic passengers in first/business at
//                  ~2.7x the economy fare
//
// then fitted, passenger-weighted, to base + perKm·km. Paste the result into
// DEMAND_V2.fares (utils/market.js); the game prices domestic pairs at
// classic × (real/classic)^realism.

import { readFileSync } from 'fs';
import * as M from '../../src/utils/market.js';
import { getAirport } from '../../src/data/airports.js';
import { loadUsOd } from './us-od-data.mjs';

const FEES = 18, EXCISE = 0.075, PREMIUM_UPLIFT = 1.15;
const d = loadUsOd();
const t6 = JSON.parse(readFileSync(new URL('./data/dot-car-table6.json', import.meta.url), 'utf8'));
const mk = new Map(d.markets.map((m) => [m.id, m]));
const pts = [];
for (const r of t6) {
  const a = mk.get(r.citymarketid_1), b = mk.get(r.citymarketid_2);
  if (!a?.nodes?.length || !b?.nodes?.length) continue;
  const o = getAirport(a.nodes[0]), dd = getAirport(b.nodes[0]);
  const km = M.distanceKm(o, dd); if (km < 50) continue;
  pts.push({ km, w: +r.passengers, real: (+r.fare - FEES) / (1 + EXCISE) / PREMIUM_UPLIFT, o: o.code, d: dd.code });
}
let sw = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
for (const p of pts) { sw += p.w; sx += p.w * p.km; sy += p.w * p.real; sxx += p.w * p.km * p.km; sxy += p.w * p.km * p.real; }
const perKm = (sw * sxy - sx * sy) / (sw * sxx - sx * sx), base = (sy - perKm * sx) / sw;
console.log(`fit: economy fare ≈ $${base.toFixed(1)} + $${(perKm * 1000).toFixed(1)} per 1,000 km   (DEMAND_V2.fares now: $${M.DEMAND_V2.fares.base} + $${(M.DEMAND_V2.fares.perKm * 1000).toFixed(1)})`);
console.log('\nkm band      real   classic  v2 (game)');
for (const [lo, hi] of [[0, 300], [300, 600], [600, 1000], [1000, 1500], [1500, 2500], [2500, 3500], [3500, 5000]]) {
  const s = pts.filter((p) => p.km >= lo && p.km < hi); const W = s.reduce((t, p) => t + p.w, 0); if (!W) continue;
  const avg = (f) => s.reduce((t, p) => t + p.w * f(p), 0) / W;
  M.setDemandModel(1); const c = avg((p) => M.referencePrice(p.o, p.d));
  M.setDemandModel(2); const v = avg((p) => M.referencePrice(p.o, p.d));
  console.log(`${lo}-${hi}`.padEnd(11), ('$' + avg((p) => p.real).toFixed(0)).padStart(6), ('$' + c.toFixed(0)).padStart(8), ('$' + v.toFixed(0)).padStart(8));
}
M.setDemandModel(1);
