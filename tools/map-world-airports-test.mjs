// Every airport on the network map, and a phone-sized route finder.
//
// Player feedback (Discord, Oct 2026), two requests in one thread:
//   1. "I would love to see the inclusion of airports on the map — at the very
//      least, their locations and names — so that I can start routes in places
//      I'm unfamiliar with and get a better sense of their orientation."
//      The map drew only the airports you already fly to. Now every airport is
//      a dim dot under the network: the big ones at every zoom, regional
//      fields as you zoom in, codes once there is room, labels capped.
//   2. "The airport names are so large that they obscure other information"
//      (route finder on a phone) — "maybe have it show just the IATA codes".
//      On a narrow screen the Destination cell leads with the code, the city
//      goes underneath in small type, country and region drop out, and badges
//      shorten. Desktop is unchanged.
//
// Helpers are driven directly; the real components are SSR-rendered.
//
//   node --import ./tools/_register-loader.mjs tools/map-world-airports-test.mjs

import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'react-dom/server';

const store = new Map();
globalThis.window = globalThis.window ?? {};
globalThis.window.dispatchEvent = globalThis.window.dispatchEvent ?? (() => true);
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};

const {
  worldAirportsInView, worldAirportTip, WORLD_LABEL_CAP, WORLD_DOT_ZOOM, WORLD_LABEL_ZOOM,
} = await import('../src/components/RouteMap.jsx');
const RouteMap = (await import('../src/components/RouteMap.jsx')).default;
const RouteFinder = (await import('../src/components/RouteFinder.jsx')).default;
const CargoRouteFinder = (await import('../src/components/CargoRouteFinder.jsx')).default;
const { AIRPORTS, getAirport } = await import('../src/data/airports.js');
const { GameProvider, freshState } = await import('../src/store/GameContext.jsx');
const { getAircraftType } = await import('../src/data/aircraft.js');

let passed = 0, failed = 0;
const test = (name, fn) => {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${(e.stack || e.message).split('\n').slice(0, 4).join('\n      ')}`); failed++; }
};

const big   = AIRPORTS.filter(a => a.tier !== 'regional');
const small = AIRPORTS.filter(a => a.tier === 'regional');

console.log('\n── 1. Which airports the map draws ──────────────────────');

test('zoomed out: every big airport, no regional fields, no labels', () => {
  const { dots, labels } = worldAirportsInView(AIRPORTS, 2);
  assert.equal(dots.length, big.length);
  assert.ok(dots.every(d => d.major));
  assert.equal(labels.length, 0, 'codes at world zoom are a wall of text');
});

test('zoomed in: regional fields appear, and codes for the big ones', () => {
  const z = WORLD_DOT_ZOOM.regional;
  const { dots, labels } = worldAirportsInView(AIRPORTS, z);
  assert.equal(dots.length, AIRPORTS.length);
  assert.ok(z >= WORLD_LABEL_ZOOM.major);
  assert.ok(labels.length > 0 && labels.every(d => d.major), 'only the big airports are labelled yet');
});

test('close in: regional codes too, but never more than the cap', () => {
  const { labels } = worldAirportsInView(AIRPORTS, WORLD_LABEL_ZOOM.regional);
  assert.equal(labels.length, WORLD_LABEL_CAP, 'the whole world at label zoom is capped');
  assert.ok(labels.slice(0, big.length).every(d => d.major), 'when the cap bites, the big airports keep their codes');
});

test('only what is on screen is drawn', () => {
  const europe = { south: 35, north: 60, west: -10, east: 30 };
  const { dots } = worldAirportsInView(AIRPORTS, 5, europe);
  const codes = new Set(dots.map(d => d.a.code));
  assert.ok(codes.has('CDG') && codes.has('FRA'));
  assert.ok(!codes.has('JFK') && !codes.has('NRT'));
  assert.ok(dots.length < AIRPORTS.length / 2);
});

test('panned into the next world copy, airports are placed in the copy you are looking at', () => {
  const pacific = { south: 0, north: 40, west: 170, east: 250 };
  const { dots } = worldAirportsInView(AIRPORTS, 5, pacific);
  const hnl = dots.find(d => d.a.code === 'HNL');
  assert.ok(hnl, 'Honolulu is on screen');
  assert.ok(Math.abs(hnl.lon - (getAirport('HNL').lon + 360)) < 1e-9, 'drawn at lon + 360, where the view is');
});

test("your own airports are skipped — they keep their network markers", () => {
  const { dots } = worldAirportsInView(AIRPORTS, 2, null, new Set(['JFK', 'LHR']));
  const codes = new Set(dots.map(d => d.a.code));
  assert.ok(!codes.has('JFK') && !codes.has('LHR') && codes.has('LAX'));
});

test('the hover card names the airport, where it is, and what it is', () => {
  const tip = worldAirportTip(getAirport('LIS'));
  for (const s of ['LIS', getAirport('LIS').name, getAirport('LIS').city]) assert.ok(tip.includes(s), s);
  assert.ok(/details/i.test(tip), 'tells you it can be clicked');
  assert.ok(small.length > 1000, 'sanity: the regional set is the bulk of the world');
});

console.log('\n── 2. The map itself ────────────────────────────────────');

const renderMap = (save) => {
  store.set('bbae_save_v2', JSON.stringify(save));
  return renderToString(React.createElement(GameProvider, null, React.createElement(RouteMap))).replaceAll('<!-- -->', '');
};
const fresh = { ...freshState(), phase: 'playing', week: 2, year: 1, hub: 'MAD', cash: 5e7, routes: [], cargoRoutes: [] };

test('a new airline with no routes still gets the map — it is where you look for somewhere to go', () => {
  const html = renderMap(fresh);
  assert.ok(html.includes('No routes yet'));
  assert.ok(html.includes('every airport you can fly to is on the map'));
  assert.ok(!html.includes('Open routes to see your network'), 'the old empty state is gone');
  assert.ok(html.includes('All airports'), 'with its toggle');
  assert.ok(!html.includes('All Routes'), 'no empty route table under it');
});

test('the toggle is remembered off', () => {
  store.set('tw_map_world_airports', '0');
  const html = renderMap(fresh);
  assert.ok(html.includes('All airports'));
  assert.ok(!html.includes('every airport you can fly to is on the map'), 'no promise of dots that are hidden');
  store.delete('tw_map_world_airports');
});

console.log('\n── 3. Route finder on a phone ───────────────────────────');

const NB = getAircraftType('b737800');
const plane = { id: 'a1', typeId: NB.id, status: 'idle', ageWeeks: 52, ownershipType: 'owned', config: { economy: NB.seats } };
const finderSave = { ...freshState(), phase: 'playing', week: 20, year: 2, hub: 'MAD', cash: 4e8, gates: { MAD: 1 }, fleet: [plane], routes: [], cargoRoutes: [] };
const renderFinder = (C, mobile) => {
  globalThis.window.matchMedia = (q) => ({ matches: mobile, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  store.set('bbae_save_v2', JSON.stringify(finderSave));
  const html = renderToString(React.createElement(GameProvider, null, React.createElement(C, { standalone: true }))).replaceAll('<!-- -->', '');
  delete globalThis.window.matchMedia;
  return html;
};

test('desktop: unchanged — city, country and region inline', () => {
  const html = renderFinder(RouteFinder, false);
  assert.ok(!html.includes('data-dest-compact'));
  assert.ok(html.includes('>Paris, FR<'), 'city, country');
  assert.ok(/airports?<\/span>/.test(html), '"+N airports" badge in full');
  assert.ok(html.includes("padding:7px 12px"));
});

test('phone: code first, city underneath, no country, short badges, tighter cells', () => {
  const html = renderFinder(RouteFinder, true);
  assert.ok(html.includes('data-dest-compact'), 'compact destination cell');
  assert.ok(!html.includes('>Paris, FR<'), 'no "city, country" run-on');
  assert.ok(/>Paris<\/div>/.test(html), 'city on its own small line');
  assert.ok(!/\+\d+ airports?<\/span>/.test(html), 'the +N badge is short');
  assert.ok(/>\+\d+<\/span>/.test(html));
  assert.ok(html.includes('title="CDG — '), 'the full name is still there on the row');
  assert.ok(html.includes('padding:6px 8px') && !html.includes('padding:7px 12px'));
});

test('freight finder gets the same phone layout', () => {
  const desk = renderFinder(CargoRouteFinder, false);
  const phone = renderFinder(CargoRouteFinder, true);
  assert.ok(!desk.includes('data-dest-compact') && /[A-Z][a-z]+, [A-Z]{2}</.test(desk));
  assert.ok(phone.includes('data-dest-compact'));
});

console.log(`\n${'─'.repeat(56)}`);
console.log(`  ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
