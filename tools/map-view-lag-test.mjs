// Map view lag — port of the Headwinds fix (Discord, 2026-10-29: "the lag was
// crazy" in map view).
//
//   node --import ./tools/_register-loader.mjs tools/map-view-lag-test.mjs
//
// Map view keeps the world map mounted under every page, so three things that
// were harmless on the classic Map tab became constant costs:
//   1. the page panel was frosted glass — a 10px backdrop blur over a full-
//      screen map, recomputed every frame anything under or inside it moved
//      (measured in Headwinds: 28 fps with a page open, 20 fps scrolling it;
//      60 / 59 fps without the blur);
//   2. every new state (a week, any click in a page) re-projected the week and
//      tore down and re-added every Leaflet layer behind the panel — the map is
//      now `paused` while a page covers it;
//   3. on the open map, a tick that moved no line still rebuilt every route,
//      rival and cargo line, and redrew every background airport dot — they
//      are now recoloured and re-labelled in place (networkDrawKey).

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${(e.stack || e.message).split('\n').slice(0, 5).join('\n      ')}`); failed++; }
}

const store = new Map();
globalThis.window = globalThis.window ?? {};
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};
globalThis.window.matchMedia = globalThis.window.matchMedia
  ?? (() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));

const { networkDrawKey, routeGroupColor, routeTipHtml } = await import('../src/components/RouteMap.jsx');
const { getAirport } = await import('../src/data/airports.js');

const root = new URL('..', import.meta.url);
const css = readFileSync(new URL('src/index.css', root), 'utf8');
const shellSrc = readFileSync(new URL('src/components/MapShell.jsx', root), 'utf8');
const mapSrc = readFileSync(new URL('src/components/RouteMap.jsx', root), 'utf8');

console.log('\nMap view lag\n');

const rules = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map(m => ({ sel: m[1].trim(), body: m[2] }));
const selects = (r, cls) => r.sel.split(',').some(s => s.trim() === cls);

await test('the page panel has no backdrop blur, and is opaque instead', () => {
  const panelRules = rules.filter(r => selects(r, '.ms-panel'));
  assert.ok(panelRules.length >= 2, 'found the .ms-panel rules');
  for (const r of panelRules) assert.ok(!/backdrop-filter/.test(r.body), `.ms-panel blurred by "${r.sel}"`);
  const bg = panelRules.map(r => r.body.match(/background:\s*([^;]+);/)?.[1]).filter(Boolean).pop();
  assert.ok(bg && !/rgba\([^)]*,\s*0?\.\d+\s*\)/.test(bg), `panel background should be opaque, got ${bg}`);
});

// Superseded 2026-10-29 (Barca's flat-map lag, ported from Headwinds): the
// small controls lost their glass too. Measured on a 250-route airline panning
// the flat map, blurring the map under the floating controls cost about as much
// as the route glows' blur filter. They are now a near-opaque fill.
await test('the floating controls are a solid fill, not a blur of the moving map', () => {
  for (const cls of ['.ms-dock', '.ms-status', '.ms-alert', '.ms-home']) {
    assert.ok(rules.some(r => selects(r, cls) && /background:\s*rgba\(8, 10, 16/.test(r.body)), `${cls} has its fill`);
    assert.ok(!rules.some(r => selects(r, cls) && /backdrop-filter:\s*blur/.test(r.body)), `${cls} blurs the map`);
  }
});

await test('the map\'s CSS animations pause while a page covers it', () => {
  const r = rules.find(x => x.sel === '.ms-panel-open .ms-map *');
  assert.ok(r && /animation-play-state:\s*paused/.test(r.body));
});

await test('map view pauses the background map whenever a page is open', () => {
  assert.match(shellSrc, /<RouteMap fullBleed paused=\{!*panelOpen\} \/>/);
});

await test('the background airport dots key on the pinned codes, not the array', () => {
  assert.match(mapSrc, /const pinnedCodes = useMemo\([^\n]*\[pinnedKey\]\)/);
});

const ap = (c) => getAirport(c);
const group = (a, b, profit) => ({
  key: [a, b].sort().join('~'), origin: ap(a), dest: ap(b), multi: false, hasResult: true, profit,
  loadFactor: 0.8, passengers: 1000, revenue: 1e5, aircraftCount: 1,
});
const hubs = { JFK: { tier: 2, name: 'Hub' } };
const pins = (...codes) => codes.map(ap);

await test('the draw key ignores route order and profit (colour is restyled in place)', () => {
  const a = [group('JFK', 'LHR', 5e5), group('JFK', 'ORD', -2e4)];
  const b = [group('JFK', 'ORD', 3e4), group('JFK', 'LHR', 4e5)];
  assert.notEqual(routeGroupColor(a[1]), routeGroupColor(b[0]), 'JFK–ORD crossed break-even');
  assert.equal(networkDrawKey(a, pins('JFK', 'LHR', 'ORD'), hubs), networkDrawKey(b, pins('ORD', 'JFK', 'LHR'), hubs));
});

await test('the draw key changes when a line, a pin or a hub badge changes', () => {
  const base = networkDrawKey([group('JFK', 'LHR', 1)], pins('JFK', 'LHR'), hubs);
  assert.notEqual(base, networkDrawKey([group('JFK', 'LHR', 1), group('JFK', 'CDG', 1)], pins('JFK', 'LHR', 'CDG'), hubs), 'new route');
  assert.notEqual(base, networkDrawKey([], pins('JFK'), hubs), 'route closed');
  assert.notEqual(base, networkDrawKey([group('JFK', 'LHR', 1)], pins('JFK', 'LHR'), { JFK: { tier: 3, name: 'Hub' } }), 'hub tier');
});

await test('the route tooltip carries this week\'s numbers', () => {
  const g = group('JFK', 'LHR', -12_345);
  const tip = routeTipHtml(g);
  assert.match(tip, /JFK/);
  assert.match(tip, /80%/);
  assert.match(tip, /-\$/);
});

console.log(`\nmap-view-lag-test: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
