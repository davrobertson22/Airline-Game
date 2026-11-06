// Map and Dashboard visuals (port from Headwinds, 2026-11-06):
//
//   · Network map "Width" toggle — passenger lines thicker by last week's
//     passengers (utils/routeWidth.js: square root against the busiest line,
//     0.45× to 2.4×, multiplying every hover/focus state); off by default,
//     remembered per browser.
//   · Network map "Colour: Profit / Load factor" switch — five cool-to-hot
//     load-factor bands with no profit green, loss red or freight amber, a
//     key, remembered per browser (utils/routeColour.js).
//   · Dashboard "Where the money went" — Finance's cost bridge folded into
//     seven bars (utils/compactBridge.js, CompactWaterfall.jsx); the walk
//     lands on the bridge's net cash to the dollar.
//   · Dashboard week-on-week arrows on Load Factor (pt), passengers, Yield
//     (projected this week vs last week through the same arithmetic) and
//     Fleet (since last week's close).
//
//   node --import ./tools/_register-loader.mjs tools/map-visuals-test.mjs

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToString } from 'react-dom/server';

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${(e.stack || e.message).split('\n').slice(0, 5).join('\n      ')}`); failed++; }
}
const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const strip = (h) => h.replaceAll('<!-- -->', '');
const store = new Map();
globalThis.window = globalThis.window ?? {};
window.dispatchEvent = () => true; window.addEventListener = () => {}; window.removeEventListener = () => {};
window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
globalThis.matchMedia = window.matchMedia;
globalThis.CustomEvent = globalThis.CustomEvent ?? class { constructor(t, i) { this.type = t; this.detail = i?.detail; } };
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k), clear: () => store.clear() };
window.localStorage = globalThis.localStorage;

let x = 4242;
Math.random = () => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return x / 4294967296; };

const W = await import('../src/utils/routeWidth.js');
const C = await import('../src/utils/routeColour.js');
const RM = await import('../src/components/RouteMap.jsx');
const { gameReducer, freshState, GameProvider } = await import('../src/store/GameContext.jsx');
const { projectWeek } = await import('../src/utils/financeProjection.js');
const { defaultClassPrices } = await import('../src/utils/simulation.js');
const { referencePrice } = await import('../src/utils/market.js');
const { getAircraftType, AIRCRAFT_TYPES } = await import('../src/data/aircraft.js');
const Dash = await import('../src/components/Dashboard.jsx');
const { costBridge, bridgeInputsFromReport } = await import('../src/utils/pnlBridge.js');
const { compactWaterfall, projectedWaterfall, lastWeekWaterfall, COMPACT_BUCKETS } = await import('../src/utils/compactBridge.js');

// ── 1. Width ─────────────────────────────────────────────────────────────────
console.log('\n── 1. Route width by passengers ────────────────────────────────');

await test('the factor runs from the thinnest to the thickest width, by the square root', () => {
  assert.equal(W.paxWidthFactor(0, 10_000), W.WIDTH_MIN);
  assert.equal(W.paxWidthFactor(10_000, 10_000), W.WIDTH_MAX);
  assert.equal(W.paxWidthFactor(50_000, 10_000), W.WIDTH_MAX, 'never past the busiest line');
  assert.equal(W.paxWidthFactor(500, 0), W.WIDTH_MIN, 'an empty network draws thin, not NaN');
  const mid = W.WIDTH_MIN + (W.WIDTH_MAX - W.WIDTH_MIN) / 2;
  assert.ok(Math.abs(W.paxWidthFactor(2_500, 10_000) - mid) <= 0.01, 'a quarter of the busiest sits halfway');
});

await test('off → no factors (every line draws at 1); on → one per group', () => {
  const groups = [
    { key: 'JFK~LHR', passengers: 9_000, hasResult: true },
    { key: 'JFK~ORD', passengers: 900, hasResult: true },
    { key: 'JFK~MIA', passengers: 0, hasResult: false },
  ];
  assert.equal(W.routeWidthFactors(groups, false).size, 0);
  const f = W.routeWidthFactors(groups, true);
  assert.equal(f.get('JFK~LHR'), W.WIDTH_MAX);
  assert.ok(f.get('JFK~ORD') > W.WIDTH_MIN && f.get('JFK~ORD') < W.WIDTH_MAX);
  assert.equal(f.get('JFK~MIA'), W.WIDTH_MIN, 'opened this week: has carried no one yet');
});

await test('the flat map multiplies every line state by it and re-styles when it changes', () => {
  const src = read('../src/components/RouteMap.jsx');
  assert.match(src, /const w = widthRef\.current\.get\(id\) \?\? 1;\s+mainW \*= w; haloW \*= w;/);
  assert.match(src, /useEffect\(\(\) => \{ applyStyles\(\); \}, \[widthFactors, applyStyles\]\);/);
});

// ── 2. Colour ────────────────────────────────────────────────────────────────
console.log('\n── 2. Colour routes by load factor ─────────────────────────────');

await test('bands run cool to hot, with no profit green, loss red or freight amber', () => {
  assert.equal(C.loadFactorColor(0.3), C.LF_BANDS[0].color);
  assert.equal(C.loadFactorColor(0.5), C.LF_BANDS[1].color);
  assert.equal(C.loadFactorColor(0.79), C.LF_BANDS[2].color);
  assert.equal(C.loadFactorColor(0.95), C.LF_BANDS[4].color);
  assert.equal(C.loadFactorColor(NaN), C.LF_BANDS[0].color);
  for (const b of C.LF_BANDS) assert.ok(!['#2ee6a0', '#ff5d6c', '#e8833a', '#a371f7'].includes(b.color), b.color);
  assert.equal(C.normalizeColourMode('lf'), 'lf');
  assert.equal(C.normalizeColourMode('nonsense'), 'profit');
});

await test('routeGroupColor: profit by default, the band in lf mode, multi-stop always purple', () => {
  const g = { hasResult: true, profit: -5, loadFactor: 0.92 };
  assert.equal(RM.routeGroupColor(g), '#ff5d6c');
  assert.equal(RM.routeGroupColor(g, 'lf'), C.loadFactorColor(0.92));
  assert.equal(RM.routeGroupColor({ ...g, multi: true }, 'lf'), RM.TAG_COLOR);
  assert.equal(RM.routeGroupColor({ hasResult: false, loadFactor: 0 }, 'lf'), C.LF_BANDS[0].color);
});

await test('every map draw goes through the mode: the first draw and the in-place recolour', () => {
  const src = read('../src/components/RouteMap.jsx');
  assert.equal((src.match(/routeGroupColor\(g, colorModeRef\.current\)/g) ?? []).length, 2);
  assert.match(src, /mapReady, applyStyles, colorMode\]\);/);
});

const jet = AIRCRAFT_TYPES.find(t => !t.freighter && t.category === 'Narrow Body');
const mapSave = { ...freshState(), phase: 'playing', week: 20, year: 2, hub: 'DXB', cash: 2e7, scheduleTrimVersion: 1,
  hubs: { DXB: { tier: 2, tierSince: 0 } }, gates: { DXB: 16, LHR: 6 },
  fleet: [{ id: 'ac0', typeId: jet.id, name: 'T0', tailNumber: 'A6T', status: 'assigned', ageWeeks: 52, ownershipType: 'owned', config: { economy: jet.seats } }],
  routes: [{ id: 'r0', origin: 'DXB', destination: 'LHR', stops: ['DXB', 'LHR'], aircraftId: 'ac0', weeklyFrequency: 14, weeksOpen: 40, hub: 'DXB', cateringLevel: 'full' }] };
const renderMap = (props = {}) => { store.set('bbae_save_v2', JSON.stringify(mapSave)); return strip(renderToString(React.createElement(GameProvider, null, React.createElement(RM.default, props)))); };
const tag = (html, attr) => (html.match(new RegExp(`<button[^>]*${attr}[^>]*>`)) ?? [null])[0];

await test('Network map (SSR): both switches offered, off / profit by default, with the profit key', () => {
  store.delete(W.ROUTE_WIDTH_KEY); store.delete(C.ROUTE_COLOUR_KEY);
  const html = renderMap();
  assert.match(tag(html, 'data-map-width-toggle'), /aria-pressed="false"/);
  assert.match(tag(html, 'data-map-colour-toggle'), /aria-pressed="false"/);
  assert.match(html, />Profitable</);
  assert.doesNotMatch(html, /data-map-lf-key/);
});

await test('Network map (SSR): remembered settings come back, and lf mode shows the band key instead', () => {
  store.set(W.ROUTE_WIDTH_KEY, 'on'); store.set(C.ROUTE_COLOUR_KEY, 'lf');
  const html = renderMap();
  assert.match(tag(html, 'data-map-width-toggle'), /aria-pressed="true"/);
  assert.match(tag(html, 'data-map-colour-toggle'), /aria-pressed="true"/);
  assert.match(html, /data-map-lf-key/);
  for (const b of C.LF_BANDS) assert.ok(html.includes(b.color));
  assert.doesNotMatch(html, />Profitable</);
});

await test('map-first layout: Width and Load chips, and a compact key when it is on', () => {
  store.set(W.ROUTE_WIDTH_KEY, 'off'); store.set(C.ROUTE_COLOUR_KEY, 'lf');
  const html = renderMap({ fullBleed: true });
  assert.match(tag(html, 'data-map-width-toggle'), /map-bleed-chip/);
  assert.match(tag(html, 'data-map-colour-toggle'), /map-bleed-chip on/);
  assert.match(html, /data-map-lf-key/);
  store.delete(C.ROUTE_COLOUR_KEY); store.delete(W.ROUTE_WIDTH_KEY);
});

// ── 3. Where the money went ─────────────────────────────────────────────────
console.log('\n── 3. Dashboard: compact profit waterfall ──────────────────────');

const DESTS = ['ORD', 'LAX', 'MIA', 'BOS'];
function airline() {
  let s = gameReducer(freshState(), { type: 'START_GAME', airlineName: 'Probe Air', hub: 'JFK', enableObjectives: false });
  s = { ...s, cash: 5e9 };
  for (let i = 0; i < 6; i++) s = gameReducer(s, { type: 'ADD_GATE', airportCode: 'JFK' });
  for (const d of DESTS) {
    s = gameReducer(s, { type: 'BUY_AIRCRAFT', typeId: 'b737800' });
    const ac = s.fleet[s.fleet.length - 1].id;
    s = gameReducer(s, { type: 'ADD_GATE', airportCode: d });
    s = gameReducer(s, { type: 'ADD_ROUTE', aircraftId: ac, origin: 'JFK', destination: d, weeklyFrequency: 21 });
  }
  const routePricing = { ...s.routePricing };
  for (const d of DESTS) routePricing[['JFK', d].sort().join('-')] = defaultClassPrices(Math.round(referencePrice('JFK', d) * 1.1));
  return { ...s, routePricing, fleet: s.fleet.map(a => ({ ...a, config: { ...a.config, economy: getAircraftType(a.typeId).seats } })) };
}
const tick = (s, n = 1) => { for (let i = 0; i < n; i++) s = gameReducer(s, { type: 'ADVANCE_WEEK' }); return s; };
const dashHtml = (s) => { store.set('bbae_save_v2', JSON.stringify(s)); return strip(renderToString(React.createElement(GameProvider, null, React.createElement(Dash.default)))); };
function steps(html) {
  const at = html.indexOf('Where the money went');
  if (at === -1) return null;
  const frag = html.slice(at, html.indexOf('Full cost bridge', at) + 1 || undefined);
  return [...frag.matchAll(/data-cwf-step="([^"]+)" data-cwf-value="(-?\d+)"/g)].map(m => [m[1], Number(m[2])]);
}
const base = tick(airline(), 3);

await test('the walk lands on the bridge\'s net cash to the dollar — this week and last', () => {
  for (const [label, wf, bridge] of [
    ['projected', projectedWaterfall(projectWeek(base), base), costBridge(projectWeek(base), base)],
    ['last week', lastWeekWaterfall(base), costBridge(bridgeInputsFromReport(base.lastReport), base)],
  ]) {
    assert.equal(Math.round(wf.walkEnd), Math.round(bridge.netProfit), `${label}: walk ${wf.walkEnd} vs net ${bridge.netProfit}`);
    assert.equal(wf.steps[0].value, bridge.rows.find(r => r.key === 'revenue').value, `${label}: starts at route revenue`);
    assert.equal(wf.steps.at(-1).value, bridge.netProfit, `${label}: ends at net cash`);
  }
  assert.equal(Math.round(lastWeekWaterfall(base).net), Math.round(base.lastReport.cashDelta), 'last week ends on the real cash change');
  assert.equal(Math.round(projectedWaterfall(projectWeek(base), base).net), Math.round(projectWeek(base).netCash));
});

await test('every bridge row lands in exactly one bucket; an unknown row goes to Other, not missing', () => {
  const keys = COMPACT_BUCKETS.flatMap(b => b.rows);
  assert.equal(new Set(keys).size, keys.length);
  const bridge = { revenue: 1000, netProfit: 670, rows: [
    { key: 'revenue', value: 1000, kind: 'income' }, { key: 'direct', value: -300, kind: 'cost' },
    { key: 'contribution', value: 700, kind: 'subtotal' }, { key: 'brandNewCost', label: 'Something new', value: -50, kind: 'cost' },
    { key: 'partnerRev', value: 20, kind: 'income' }, { key: 'net', value: 670, kind: 'total' } ] };
  const wf = compactWaterfall(bridge);
  assert.equal(wf.walkEnd, 670);
  const other = wf.steps.find(s => s.key === 'other');
  assert.equal(other.value, -30);
  assert.ok(other.parts.some(p => p.key === 'brandNewCost'));
});

await test('Dashboard (SSR): the card draws last week by default, ending on the real cash change; projection before the first week', () => {
  const st = steps(dashHtml(base));
  assert.ok(st, 'no "Where the money went" card on the Dashboard');
  assert.equal(st[0][0], 'revenue');
  assert.equal(st.at(-1)[0], 'net');
  assert.equal(st.at(-1)[1], Math.round(base.lastReport.cashDelta));
  const mid = st.slice(1, -1).reduce((s, [, v]) => s + v, 0);
  assert.ok(Math.abs(st[0][1] + mid - st.at(-1)[1]) <= st.length, 'bars add up (to rounding) to the net bar');
  const fresh = airline();
  assert.ok(!fresh.lastReport);
  assert.equal(steps(dashHtml(fresh)).at(-1)[1], Math.round(projectWeek(fresh).netCash));
});

await test('the card agrees with the Weekly P&L card\'s net cash beside it, and links to Finance', () => {
  const html = dashHtml(base);
  const m = html.match(/data-pnl-col="lw" data-pnl-row="net" data-pnl-kind="total" data-pnl-exact="(-?[\d.]+)"/);
  assert.ok(m, 'Weekly P&L last-week net found');
  assert.equal(Math.round(Number(m[1])), steps(html).at(-1)[1]);
  assert.match(html, /Full cost bridge in Finance/);
});

// ── 4. Week-on-week arrows ──────────────────────────────────────────────────
console.log('\n── 4. Dashboard: week-on-week arrows ───────────────────────────');

let st = tick(airline(), 3);
// Change something so this week differs from last: a fare cut on one pair and
// fewer flights on another (the v4 demand model answers a fare cut slowly, so
// the frequency cut is what moves the load factor at once).
st = { ...st,
  routePricing: { ...st.routePricing, 'JFK-ORD': defaultClassPrices(Math.round(referencePrice('JFK', 'ORD') * 0.8)) },
  routes: st.routes.map((r, i) => (i === 1 ? { ...r, weeklyFrequency: 7 } : r)) };
const tile = (html, key) => { const i = html.indexOf(`data-kpi="${key}"`); return i < 0 ? null : html.slice(i, html.indexOf('class="stat-box"', i + 10) > 0 ? html.indexOf('class="stat-box"', i + 10) : i + 1500); };

await test('the arithmetic: this week (projected) against last week, same formula both sides', () => {
  const now = Dash.networkStatsOf(projectWeek(st).report);
  const last = Dash.networkStatsOf(st.lastReport);
  const w = Dash.weekOnWeek(now, last);
  assert.ok(Math.abs(w.loadFactorPt - (now.loadFactor - last.loadFactor) * 100) < 1e-9);
  assert.ok(Math.abs(w.paxPct - ((now.boardedPax - last.boardedPax) / last.boardedPax) * 100) < 1e-9);
  assert.deepEqual(Dash.weekOnWeek(now, null), { loadFactorPt: null, paxPct: null, yieldPct: null });
});

await test('Dashboard (SSR): Load Factor and Yield tiles carry the arrows the arithmetic gives', () => {
  const html = dashHtml(st);
  const w = Dash.weekOnWeek(Dash.networkStatsOf(projectWeek(st).report), Dash.networkStatsOf(st.lastReport));
  const lf = tile(html, 'load-factor');
  assert.ok(lf, 'load factor tile');
  assert.ok(Math.abs(w.loadFactorPt) >= 0.05, 'fixture: the frequency cut moves the load factor');
  assert.match(lf, new RegExp(`data-trend="${w.loadFactorPt}"`));
  assert.match(lf, new RegExp(`${w.loadFactorPt >= 0 ? '↑' : '↓'} ${Math.abs(w.loadFactorPt).toFixed(1)}pt`));
  assert.match(lf, new RegExp(`data-pax-trend="${w.paxPct}"`));
  if (Math.abs(w.yieldPct) >= 0.05) assert.match(tile(html, 'yield'), new RegExp(`data-trend="${w.yieldPct}"`));
  else assert.doesNotMatch(tile(html, 'yield'), /data-trend/, 'no arrow for a yield that held');
});

await test('Dashboard (SSR): Fleet shows aircraft added since last week; none before the first week', () => {
  let s2 = gameReducer(st, { type: 'BUY_AIRCRAFT', typeId: 'b737800' });
  s2 = gameReducer(s2, { type: 'BUY_AIRCRAFT', typeId: 'b737800' });
  const added = s2.fleet.length - s2.statsHistory.at(-1).fleet;
  assert.ok(added > 0, 'fixture: bought aircraft arrive at once');
  assert.match(tile(dashHtml(s2), 'fleet'), new RegExp(`data-trend="${added}"[^>]*>↑ ${added}<`));
  assert.doesNotMatch(tile(dashHtml(airline()), 'load-factor') ?? '', /data-trend/, 'no last week → no arrow');
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
