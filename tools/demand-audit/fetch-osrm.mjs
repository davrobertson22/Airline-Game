// @not-a-test — downloads driving times for demand model v2; makes network calls.
//
// For every airport in a v2 drive country (DEMAND_V2.driveCountries), driving
// time and road distance to its NEIGHBOURS nearest same-country airports within
// MAX_KM, from the public OSRM demo server (router.project-osrm.org, car
// profile). Cached in data/osrm-drive.json and resumable: re-run until it
// reports nothing left. Polite: one request per second (the demo server's
// usage policy), BUDGET_S seconds per run.
//
//   node tools/demand-audit/fetch-osrm.mjs
//
// Then: node tools/demand-audit/fit-roads.mjs

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { AIRPORTS } from '../../src/data/airports.js';
import { distanceKm, DEMAND_V2 } from '../../src/utils/market.js';

const NEIGHBOURS = 25, MAX_KM = 1100, BUDGET_S = Number(process.env.BUDGET_S ?? 150);
const out = new URL('./data/osrm-drive.json', import.meta.url);
const cache = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : { source: 'router.project-osrm.org table/v1/driving', pairs: {}, done: [] };
const done = new Set(cache.done);
const drive = new Set(DEMAND_V2.driveCountries);
const aps = AIRPORTS.filter((a) => drive.has(a.country) && Number.isFinite(a.lat) && Number.isFinite(a.lon));
const todo = aps.filter((a) => !done.has(a.code));
const t0 = Date.now();
let n = 0;
for (const a of todo) {
  if ((Date.now() - t0) / 1000 > BUDGET_S) break;
  const nb = aps.filter((b) => b.code !== a.code && b.country === a.country)
    .map((b) => [b, distanceKm(a, b)]).filter(([, km]) => km <= MAX_KM)
    .sort((x, y) => x[1] - y[1]).slice(0, NEIGHBOURS).map(([b]) => b);
  if (nb.length) {
    const coords = [a, ...nb].map((p) => `${p.lon},${p.lat}`).join(';');
    const url = `https://router.project-osrm.org/table/v1/driving/${coords}?sources=0&annotations=duration,distance`;
    let j = null;
    for (let attempt = 0; attempt < 3 && !j; attempt++) {
      try { const res = await fetch(url); if (res.ok) j = await res.json(); else await new Promise((r) => setTimeout(r, 3000)); }
      catch { await new Promise((r) => setTimeout(r, 3000)); }
    }
    if (!j || j.code !== 'Ok') { console.log('failed', a.code); continue; }
    nb.forEach((b, i) => {
      const h = j.durations[0][i + 1], km = j.distances[0][i + 1];
      const key = a.code < b.code ? `${a.code}|${b.code}` : `${b.code}|${a.code}`;
      // null = no road route (islands, Bass Strait...): kept so the fit knows.
      cache.pairs[key] = h == null ? null : [Math.round(h / 60), Math.round(km / 1000)];   // [minutes, road km]
    });
  }
  cache.done.push(a.code); done.add(a.code); n++;
  await new Promise((r) => setTimeout(r, 1000));
}
writeFileSync(out, JSON.stringify(cache));
console.log(`fetched ${n} airports this run; ${aps.length - done.size} left of ${aps.length}; ${Object.keys(cache.pairs).length} pairs cached`);
