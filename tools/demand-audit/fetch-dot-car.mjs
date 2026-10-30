// @not-a-test — downloads benchmark data; makes network calls.
//
// US DOT Domestic Airline Consumer Airfare Report (built from the DB1B 10% ticket
// sample, so these are true origin–destination trips, not flight legs):
//   Table 6  — every contiguous-US city-pair market averaging >= 10 pax/day
//   Table 1a — airport-level rows for markets touching multi-airport cities
//              (used here only to learn which airports make up each city market)
// Both tables are directionless: "passengers" is per day, both directions added.
//
//   node tools/demand-audit/fetch-dot-car.mjs [lastYear lastQuarter]
//
// Pulls the four quarters ending at lastYear/lastQuarter (default 2026 Q1) into
// tools/demand-audit/data/. Re-run when DOT publishes a new quarter, then run
// us-od-bench.mjs.

import { writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'data');
mkdirSync(out, { recursive: true });

const lastYear = Number(process.argv[2] ?? 2026);
const lastQ = Number(process.argv[3] ?? 1);
const quarters = [];
for (let i = 0, y = lastYear, q = lastQ; i < 4; i++) {
  quarters.push([y, q]);
  if (--q === 0) { q = 4; y--; }
}
const where = quarters.map(([y, q]) => `(year=${y} AND quarter=${q})`).join(' OR ');

const TABLES = {
  'dot-car-table6.json': ['yj5y-b2ir', 'year,quarter,citymarketid_1,citymarketid_2,city1,city2,nsmiles,passengers,fare'],
  'dot-car-table1a.json': ['tfrh-tu9e', 'year,quarter,citymarketid_1,citymarketid_2,city1,city2,airport_1,airport_2,nsmiles,passengers'],
};

for (const [file, [id, select]] of Object.entries(TABLES)) {
  const url = `https://data.transportation.gov/resource/${id}.json?` + new URLSearchParams({
    $where: where, $select: select, $limit: '50000',
  });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
  const rows = await res.json();
  writeFileSync(join(out, file), JSON.stringify(rows));
  console.log(file, rows.length, 'rows,', quarters.map(([y, q]) => `${y}Q${q}`).join(' '));
}
