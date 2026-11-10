// generate-guide-charts.mjs
// Fills the generated charts and data tables on hand-written pages, so the numbers a guide
// or article shows always come from the game's current data.
//
// A page marks a slot like this, and everything between the markers is replaced:
//     <!-- GEN:hub-pairs:START -->
//     <!-- GEN:hub-pairs:END -->
//
//   node tools/generate-guide-charts.mjs          rewrite the slots
//   node tools/generate-guide-charts.mjs --check  exit 1 if any slot is stale
//
// Run it after changing src/data/aircraft.js or the fuel model, then stamp-page-dates.mjs.

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { AIRCRAFT_TYPES } from '../src/data/aircraft.js';
import { fuelCostPerKm, hedgeLockedPrice, HEDGE_DURATIONS, FUEL_MIN_INDEX, FUEL_MAX_INDEX } from '../src/utils/fuel.js';
import { typicalSeatsOf } from '../src/utils/simulation.js';
import { scatterChart, barChart, lineChart, SERIES } from './site-charts.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const fmt = (n) => Math.round(n).toLocaleString('en-US');
const money = (n) => (n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M` : `$${Math.round(n / 1000)}K`);
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const byName = (name) => {
  const t = AIRCRAFT_TYPES.find((x) => x.name === name);
  if (!t) throw new Error(`generate-guide-charts: no aircraft named "${name}" in src/data/aircraft.js`);
  return t;
};
// "Boeing 747-400" → "747-400", but "Fokker 100" stays whole: a bare number is not a name.
const short = (t) => {
  const rest = t.name.startsWith(`${t.manufacturer} `) ? t.name.slice(t.manufacturer.length + 1) : t.name;
  return /^\d+$/.test(rest) ? t.name : rest;
};
const typical = (t) => typicalSeatsOf(t) || t.seats;
// Fuel cost per seat-kilometre in cents, at the base fuel price, in the given cabin.
const seatKm = (t, seats) => (fuelCostPerKm(t) / seats) * 100;
const chart = (svg) => `<div class="chartwrap">${svg}</div>`;
const table = (head, rows) => `<div class="tablewrap"><table class="data">
        <thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead>
        <tbody>
${rows.map((r) => `          <tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('\n')}
        </tbody>
      </table></div>`;
const PRODUCTION = [
  { key: 'built', label: 'Still in production', color: SERIES[0] },
  { key: 'closed', label: 'Out of production', color: SERIES[1] },
];

// Regional airliners only: the four business jets share the game's category but not the job.
const regionalJets = () => AIRCRAFT_TYPES.filter((t) => t.category === 'Regional Jet' && t.seats >= 30).sort((a, b) => typical(a) - typical(b) || a.eis - b.eis);

const ENGINES = { 'Airbus A380': 4, 'Boeing 747-8I': 4, 'Boeing 747-400': 4, 'Boeing 747-100': 4, 'Boeing 777-300ER': 2, 'Boeing 787-9': 2, 'Airbus A350-1000': 2, 'Boeing 777X-9': 2 };
const giants = () => Object.keys(ENGINES).map(byName);

const BLOCKS = {
  // Hub strategy: n spokes through one hub connect n(n+1)/2 city pairs.
  'hub-pairs': () =>
    chart(
      barChart({
        label: 'City pairs connected through one hub, by number of spokes',
        bars: [3, 5, 10, 15, 20, 30].map((n) => ({ label: `${n} spokes`, value: (n * (n + 1)) / 2, tip: `${n} routes from the hub connect ${(n * (n + 1)) / 2} city pairs` })),
        valueFmt: (v) => `${fmt(v)} city pairs`,
        xLabel: 'City pairs a passenger can travel between, flying only the routes from the hub',
      })
    ),

  // Fuel hedging: the price each contract locks, straight from the game's pricing function.
  'hedge-lock': () => {
    const xs = [];
    for (let i = Math.round(FUEL_MIN_INDEX * 100); i <= Math.round(FUEL_MAX_INDEX * 100); i += 5) xs.push(i / 100);
    return chart(
      lineChart({
        label: 'The fuel index each hedge contract locks, against the market index on the day it is bought',
        lines: HEDGE_DURATIONS.map((d, i) => ({ label: d.label, endLabel: `${d.weeks} wk`, color: SERIES[i], points: xs.map((x) => [x, hedgeLockedPrice(x, d)]) })),
        reference: { label: 'No hedge (pay the market)', points: [[xs[0], xs[0]], [xs[xs.length - 1], xs[xs.length - 1]]] },
        xLabel: 'Market fuel index on the day you buy',
        yLabel: 'Index the contract locks',
        xFmt: (v) => v.toFixed(2),
        yFmt: (v) => v.toFixed(2),
      })
    );
  },

  'regional-jets-chart': () => {
    const group = regionalJets();
    return chart(
      scatterChart({
        label: 'Regional jets in Tailwinds: seats against range',
        points: group.map((t) => ({ x: typical(t), y: t.range, name: t.name, short: short(t), series: t.oop ? 'closed' : 'built', tip: `${t.name}: ${typical(t)} seats, ${fmt(t.range)} km, in service ${t.eis}` })),
        series: PRODUCTION,
        xLabel: 'Seats in a typical cabin',
        yLabel: 'Range (km)',
        xFmt: fmt,
        yFmt: fmt,
        labelNames: ['CRJ-200', 'Embraer ERJ-145', 'Embraer E175', 'CRJ-900', 'Embraer E195-E2', 'Embraer E190-E2', 'Yakovlev Yak-40', 'Fokker 100', 'Embraer ERJ-135'],
      })
    );
  },
  'regional-jets-table': () =>
    table(
      ['Aircraft', 'In service', 'Typical seats', 'Most seats', 'Range', 'Fuel per seat-km', 'Status'],
      regionalJets().map((t) => [esc(t.name), t.eis, typical(t), t.seats, `${fmt(t.range)} km`, `${seatKm(t, typical(t)).toFixed(2)}¢`, t.oop ? `Ended ${t.oop}` : 'In production'])
    ),

  'nb-wb-chart': () => {
    const group = AIRCRAFT_TYPES.filter((t) => (t.category === 'Narrow Body' || t.category === 'Wide Body') && t.eis >= 1980);
    return chart(
      scatterChart({
        label: 'Narrow-body and wide-body jets in Tailwinds: seats against range',
        points: group.map((t) => ({ x: typical(t), y: t.range, name: t.name, short: short(t), series: t.category === 'Narrow Body' ? 'nb' : 'wb', tip: `${t.name}: ${typical(t)} seats, ${fmt(t.range)} km` })),
        series: [
          { key: 'nb', label: 'Narrow-body (one aisle)', color: SERIES[0] },
          { key: 'wb', label: 'Wide-body (two aisles)', color: SERIES[1] },
        ],
        xLabel: 'Seats in a typical cabin',
        yLabel: 'Range (km)',
        xFmt: fmt,
        yFmt: fmt,
        labelNames: ['Airbus A321XLR', 'Boeing 737 MAX 8', 'Boeing 757-200', 'Boeing 787-9', 'Airbus A350-900ULR', 'Boeing 777X-9', 'Boeing 767-300ER', 'Airbus A220-300', 'Airbus A330-300'],
      })
    );
  },
  'nb-wb-table': () =>
    table(
      ['Aircraft', 'Aisles', 'Typical seats', 'Most seats', 'Range', 'Lease per week', 'Price', 'Fuel per seat-km'],
      ['Airbus A220-300', 'Boeing 737 MAX 8', 'Airbus A320neo', 'Airbus A321XLR', 'Boeing 787-9', 'Airbus A330-900neo', 'Airbus A350-900', 'Boeing 777-300ER'].map(byName).map((t) => [
        esc(t.name),
        t.category === 'Narrow Body' ? 'One' : 'Two',
        typical(t),
        t.seats,
        `${fmt(t.range)} km`,
        money(t.weeklyLease),
        money(t.purchasePrice),
        `${seatKm(t, typical(t)).toFixed(2)}¢`,
      ])
    ),

  'a380-747-chart': () =>
    chart(
      barChart({
        label: 'Fuel cost per seat-kilometre in a typical cabin: four-engined giants against twin-engined widebodies',
        bars: giants()
          .map((t) => ({ label: `${short(t)} (${typical(t)} seats)`, value: seatKm(t, typical(t)), series: ENGINES[t.name] === 4 ? 'four' : 'two', tip: `${t.name}: ${seatKm(t, typical(t)).toFixed(2)}¢ per seat-km at ${typical(t)} seats` }))
          .sort((a, b) => a.value - b.value),
        series: [
          { key: 'four', label: 'Four engines', color: SERIES[1] },
          { key: 'two', label: 'Two engines', color: SERIES[0] },
        ],
        valueFmt: (v) => `${v.toFixed(2)}¢`,
        xLabel: 'Fuel cost per seat-kilometre at the base fuel price, in each type’s typical cabin',
      })
    ),
  'a380-747-table': () =>
    table(
      ['Aircraft', 'In service', 'Engines', 'Typical seats', 'Most seats', 'Range', 'Lease per week', 'Fuel per seat-km'],
      giants().map((t) => [esc(t.name), t.eis, ENGINES[t.name], typical(t), t.seats, `${fmt(t.range)} km`, money(t.weeklyLease), `${seatKm(t, typical(t)).toFixed(2)}¢`])
    ),
};

const SLOT = /(<!-- GEN:([a-z0-9-]+):START -->)[\s\S]*?(<!-- GEN:\2:END -->)/g;

export function fill(html, file = 'page') {
  return html.replace(SLOT, (_, start, id, end) => {
    if (!BLOCKS[id]) throw new Error(`${file}: no generated block called "${id}"`);
    return `${start}\n      ${BLOCKS[id]()}\n      ${end}`;
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check');
  let stale = 0;
  let slots = 0;
  for (const file of readdirSync(PUBLIC).filter((f) => f.endsWith('.html')).sort()) {
    const p = path.join(PUBLIC, file);
    const before = readFileSync(p, 'utf8');
    slots += (before.match(/<!-- GEN:[a-z0-9-]+:START -->/g) || []).length;
    const after = fill(before, file);
    if (after === before) continue;
    stale++;
    if (check) console.log(`stale: public/${file}`);
    else {
      writeFileSync(p, after);
      console.log(`filled public/${file}`);
    }
  }
  console.log(`${slots} generated blocks${stale ? '' : ' · all current'}`);
  if (check && stale) process.exit(1);
}
