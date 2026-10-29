// Map-first layout + the Blue Marble satellite basemap (ported from Headwinds).
//
//   node --import ./tools/_register-loader.mjs tools/map-first-layout-test.mjs
//
// Covers:
//   1. the basemap choice (Satellite / Dark): defaults, persistence, the
//      Leaflet layer spec and the globe style both views build from it;
//   2. the self-hosted tiles: every Web Mercator tile z0–6 is on disk, so a
//      missing file can't leave a black square in the ocean;
//   3. the map-first shell, SSR-rendered through the REAL App (not MapShell in
//      isolation): the map is the background, every page in the nav is still
//      reachable from a rail, the dock or a group menu;
//   4. it's opt-in: classic is the default and invites the player to try it.
//
// Tailwinds' App holds its first paint until the save is read (an effect SSR
// never runs), so the render re-provides the real context with hydrated: true,
// as tools/nav-favourites-test.mjs does.

import assert from 'node:assert/strict';
import { existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${(e.stack || e.message).split('\n').slice(0, 5).join('\n      ')}`); failed++; }
}

// A browser-ish global so the modules that read the player's choices on first
// render can be imported under node.
const store = new Map();
const events = [];
globalThis.window = globalThis.window ?? {};
window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
globalThis.matchMedia = window.matchMedia;
globalThis.document = globalThis.document ?? { addEventListener() {}, removeEventListener() {}, querySelector() { return null; }, body: {} };
window.dispatchEvent = (e) => { events.push(e); return true; };
window.addEventListener = () => {};
window.removeEventListener = () => {};
globalThis.CustomEvent = globalThis.CustomEvent ?? class CustomEvent { constructor(type, init) { this.type = type; this.detail = init?.detail; } };
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};

const mapCore = await import('../src/components/basemap.js');
const {
  readBasemap, writeBasemap, normalizeBasemap, basemapLayerSpec, blueMarbleTileUrl,
  BASEMAP_KEY, BASEMAP_EVENT, DEFAULT_BASEMAP, MAP_FIRST_BASEMAP, BLUE_MARBLE_MAX_ZOOM, TILE_URL,
} = mapCore;

console.log('\nMap-first layout + satellite basemap\n');

// ── 1. Basemap choice ────────────────────────────────────────────────────────
await test('opt-in: classic stays Dark until the player picks; map-first opens on Satellite', () => {
  assert.equal(DEFAULT_BASEMAP, 'dark');
  assert.equal(MAP_FIRST_BASEMAP, 'satellite');
  assert.equal(readBasemap(), 'dark', 'an existing classic player sees no change');
  store.set('tw_layout', 'map');
  assert.equal(readBasemap(), 'satellite', 'trying map-first brings the satellite look');
  store.set(BASEMAP_KEY, 'dark');
  assert.equal(readBasemap(), 'dark', 'an explicit pick wins in map-first');
  store.delete('tw_layout');
  store.set(BASEMAP_KEY, 'satellite');
  assert.equal(readBasemap(), 'satellite', 'an explicit pick wins in classic');
  store.delete(BASEMAP_KEY);
});

await test('junk in storage falls back to the layout default, never a broken map', () => {
  store.set(BASEMAP_KEY, 'neon');
  assert.equal(readBasemap(), 'dark');
  assert.equal(normalizeBasemap(undefined), 'dark');
  store.delete(BASEMAP_KEY);
});

await test('writing the choice persists it and tells every mounted map', () => {
  events.length = 0;
  assert.equal(writeBasemap('dark'), 'dark');
  assert.equal(store.get(BASEMAP_KEY), 'dark');
  assert.equal(readBasemap(), 'dark');
  assert.equal(events.at(-1)?.type, BASEMAP_EVENT);
  assert.equal(events.at(-1)?.detail, 'dark');
  store.delete(BASEMAP_KEY);
});

await test('Leaflet spec: Blue Marble over-zooms past z6; Dark is the keyed CARTO layer', () => {
  const sat = basemapLayerSpec('satellite');
  assert.equal(sat.url, '/tiles/bluemarble/{z}/{x}/{y}.jpg');
  assert.equal(sat.opts.maxNativeZoom, BLUE_MARBLE_MAX_ZOOM);
  assert.ok(sat.opts.maxZoom > BLUE_MARBLE_MAX_ZOOM, 'zooming past z6 stretches z6 rather than going blank');
  assert.match(sat.opts.attribution, /NASA/);
  const dark = basemapLayerSpec('dark');
  assert.equal(dark.url, TILE_URL);
  assert.match(dark.opts.attribution, /carto\.com/);
});

await test('tile template keeps its {z}/{x}/{y} placeholders when made absolute', () => {
  assert.equal(blueMarbleTileUrl('https://tw.example'), 'https://tw.example/tiles/bluemarble/{z}/{x}/{y}.jpg');
});

// ── 2. Tiles on disk ─────────────────────────────────────────────────────────
await test('every Blue Marble tile z0–6 exists (5,461 files)', () => {
  const root = fileURLToPath(new URL('../public/tiles/bluemarble/', import.meta.url));
  let n = 0;
  const missing = [];
  for (let z = 0; z <= BLUE_MARBLE_MAX_ZOOM; z++) {
    const span = 2 ** z;
    for (let x = 0; x < span; x++) for (let y = 0; y < span; y++) {
      const f = `${root}${z}/${x}/${y}.jpg`;
      if (!existsSync(f) || statSync(f).size === 0) missing.push(`${z}/${x}/${y}`);
      n++;
    }
  }
  assert.equal(n, 5461);
  assert.deepEqual(missing.slice(0, 5), [], `${missing.length} missing`);
});

// ── 3/4. The real App, both layouts ──────────────────────────────────────────
const React = (await import('react')).default;
const { renderToString } = await import('react-dom/server');
const { default: App } = await import('../src/App.jsx');
const { GameProvider, GameContext, freshState } = await import('../src/store/GameContext.jsx');
function Hydrated({ children }) {
  const ctx = React.useContext(GameContext);
  return React.createElement(GameContext.Provider, { value: { ...ctx, hydrated: true } }, children);
}
const { LAYOUT_KEY, MAP_GROUPS, MAP_PAGES, MAP_CHROME_PAGES, resolveMapPage, readLayout, writeLayout, LAYOUT_INVITE_KEY, MAP_HINT_KEY } = await import('../src/components/MapShell.jsx');
const { TAB_LABELS, TAB_GROUP } = await import('../src/navPath.js');

store.set('bbae_save_v2', JSON.stringify({
  ...freshState(),
  phase: 'playing', week: 5, year: 1, hub: 'SFO', cash: 12_345_678, airlineName: 'Pacific Gold',
  hubs: { SFO: { tier: 1, tierSince: 0 } }, gates: { SFO: 4 },
}));
store.set('bbae_tour_seen_v3', '1');
const render = () => renderToString(React.createElement(GameProvider, null,
  React.createElement(Hydrated, null, React.createElement(App)))).replaceAll('<!-- -->', '');

await test('classic is the default layout and offers the switch', () => {
  store.delete(LAYOUT_KEY);
  assert.equal(readLayout(), 'classic');
  const html = render();
  assert.ok(html.includes('class="topbar"'), 'classic top bar');
  assert.ok(html.includes('class="nav-tabs"'), 'classic tab strip');
  assert.ok(html.includes('data-layout-switch="map"'), 'Map view switch present');
  assert.ok(!html.includes('ms-root'), 'no map-first shell');
  assert.ok(/data-layout-switch="map"[^>]*title="Try the map-first layout \(beta\)/.test(html), 'the switch says it is a beta');
});

await test('opt-in: classic invites the player to try it until they do or say no', () => {
  store.delete(LAYOUT_KEY); store.delete(LAYOUT_INVITE_KEY);
  let html = render();
  assert.ok(html.includes('class="layout-invite"'), 'invitation strip shown');
  assert.ok(/class="btn btn-primary layout-invite-try"[^>]*>\s*Try it/.test(html), 'Try it button');
  assert.ok(/class="new-dot[ "]/.test(html), 'NEW dot on the top-bar button');

  store.set(LAYOUT_INVITE_KEY, 'dismissed');
  html = render();
  assert.ok(!html.includes('class="layout-invite"'), 'a dismissed invitation stays gone');
  assert.ok(!/class="new-dot[ "]/.test(html));
  assert.ok(html.includes('data-layout-switch="map"'), 'but the Map view button is still there');

  store.delete(LAYOUT_INVITE_KEY);
  writeLayout('map');                     // trying it closes the invitation for good
  assert.equal(store.get(LAYOUT_INVITE_KEY), 'tried');
  writeLayout('classic');
  html = render();
  assert.ok(!html.includes('class="layout-invite"'), 'back on classic after trying: no nagging');
  store.delete(LAYOUT_INVITE_KEY);
});

await test('first visit to map-first explains how to get back; once only', () => {
  store.set(LAYOUT_KEY, 'map'); store.delete(MAP_HINT_KEY);
  let html = render();
  assert.ok(html.includes('class="ms-beta-hint"'), 'first-visit hint');
  assert.ok(html.includes('Back to classic layout'), 'names the way back');
  store.set(MAP_HINT_KEY, '1');
  html = render();
  assert.ok(!html.includes('class="ms-beta-hint"'), 'gone after Got it');
  store.delete(LAYOUT_KEY); store.delete(MAP_HINT_KEY);
});

await test('map-first: the map is the background and the HUD floats over it', () => {
  store.set(LAYOUT_KEY, 'map');
  const html = render();
  assert.ok(html.includes('app-layout-map'));
  assert.ok(html.includes('class="ms-map"') && html.includes('map-bleed'), 'full-bleed map mounted');
  assert.ok(!html.includes('class="topbar"') && !html.includes('class="nav-tabs"'), 'no classic chrome');
  assert.ok(html.includes('$12.35M'), 'cash pill');
  assert.ok(/class="ms-next"[^>]*>Next week/.test(html), 'Next week button (solo)');
  assert.ok(!html.includes('class="ms-panel"'), 'opens on the map, no page panel');
  assert.ok(!html.includes('All Routes'), 'the Map tab route table is not drawn in full-bleed');
  assert.ok(!html.includes('empty-state'), 'a new airline with no routes still gets the world map');
  assert.ok(html.includes('map-bleed-hint'), '…with a nudge toward Search');
  for (const label of ['Search', 'Network', 'Fleet', 'World', 'Operations', 'Service', 'Finance']) {
    assert.ok(new RegExp(`<span class="ms-lbl-long">${label}</span>`).test(html), `dock: ${label}`);
  }
  assert.ok(/aria-pressed="true"[^>]*>Satellite</.test(html), 'Satellite pressed by default');
});

await test('every page in the nav is reachable from the map-first layout', () => {
  const inDock = new Set(MAP_GROUPS.flatMap(g => g.pages));
  const reachable = (p) => inDock.has(p) || MAP_CHROME_PAGES.includes(p);
  const unreachable = Object.keys(TAB_LABELS).filter(id => {
    if (id === 'map') return false;                 // the background itself
    return !reachable(resolveMapPage(id));
  });
  assert.deepEqual(unreachable, []);
  assert.deepEqual(Object.keys(MAP_PAGES).filter(p => !reachable(p)), []);
});

await test('every rendered control is a real group or chrome button (Tailwinds has News in solo)', () => {
  const html = render();
  for (const g of MAP_GROUPS) assert.ok(html.includes(`data-shell="group:${g.id}"`), `missing group ${g.id}`);
  for (const c of ['dashboard', 'wiki', 'tutorial', 'discord', 'settings']) assert.ok(html.includes(`data-shell="${c}"`), `missing ${c}`);
});

store.delete(LAYOUT_KEY);

console.log(`\nmap-first-layout-test: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
