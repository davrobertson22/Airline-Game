// Tail logos (port from Headwinds, 2026-11-06): the airline's tail is the
// flat fin silhouette the airline-tail charts use (TailFin.jsx FIN_PATH, a
// trapezoid 1.291 wide for 1 tall, nose to the right) in the livery's tail
// colour, with the logo big on the fin and one of TAIL_DESIGNS in the accent
// colour — or the player's own uploaded tail image, clipped to the fin.
// Designed in the logo maker's Tail section; shown over your hubs on the
// Network map.
//
//   node --import ./tools/_register-loader.mjs tools/tail-fin-test.mjs

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToString, renderToStaticMarkup } from 'react-dom/server';

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${(e.stack || e.message).split('\n').slice(0, 4).join('\n      ')}`); failed++; }
}
const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const strip = (h) => h.replaceAll('<!-- -->', '');
const store = new Map();
globalThis.window = globalThis.window ?? {};
window.dispatchEvent = () => true; window.addEventListener = () => {}; window.removeEventListener = () => {};
window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
globalThis.matchMedia = window.matchMedia;
globalThis.CustomEvent = globalThis.CustomEvent ?? class { constructor(t, i) { this.type = t; this.detail = i?.detail; } };
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
window.localStorage = globalThis.localStorage;

const TAIL = `data:image/webp;base64,${Buffer.from('RIFF....WEBPVP8 ').toString('base64')}`;
const L = await import('../src/data/livery.js');
const { gameReducer, freshState, GameProvider } = await import('../src/store/GameContext.jsx');
const TF = await import('../src/components/TailFin.jsx');
const TailFin = TF.default;
const { hubFinMarkup, hubFinSize, logoOf, tailOf, tailAspect } = await import('../src/utils/hubFin.js');
const { markColorOn } = await import('../src/utils/logoBranding.js');
const img = await import('../src/utils/logoImage.js');

console.log('\nTail logos (Tailwinds)\n');

await test('the silhouette is the chart\'s: a 1.291:1 trapezoid, nose right, straight leading edge, short tip', () => {
  const { FIN_W, FIN_H, FIN_ASPECT, FIN_PATH } = TF;
  assert.equal(FIN_ASPECT, FIN_W / FIN_H);
  assert.ok(Math.abs(FIN_ASPECT - 1.291) < 0.001);
  assert.match(FIN_PATH, /^M405 1000 /);
  assert.match(FIN_PATH, / L1291 1000 Z$/);
  assert.equal(tailAspect(), FIN_ASPECT);
});

await test('the livery carries tailDesign; the file is the Headwinds engine module', () => {
  assert.deepEqual(L.TAIL_DESIGNS, ['solid', 'stripe', 'stripes', 'swoosh', 'split']);
  assert.equal(L.normalizeLivery({}).tailDesign, 'solid');
  assert.equal(L.normalizeLivery({ tailDesign: 'swoosh' }).tailDesign, 'swoosh');
  assert.equal(L.normalizeLivery({ tailDesign: '<x>' }).tailDesign, 'solid');
  assert.notEqual(L.liveryKey({ tailDesign: 'swoosh' }), L.liveryKey({ tailDesign: 'solid' }));
});

await test('SET_BRANDING keeps the design on the livery and stores / clears an uploaded tail', () => {
  let s = gameReducer(freshState(), { type: 'START_GAME', airlineName: 'Fin Air', hub: 'SYD', enableObjectives: false });
  s = gameReducer(s, { type: 'SET_BRANDING', airlineName: 'Fin Air', logoId: 'eagle', logoColor: '#d71920', livery: { tail: '#d71920', tailDesign: 'stripes' } });
  assert.equal(s.livery.tailDesign, 'stripes');
  s = gameReducer(s, { type: 'SET_BRANDING', airlineName: 'Fin Air', customTail: TAIL });
  assert.equal(s.customTail, TAIL);
  assert.equal(gameReducer(s, { type: 'SET_BRANDING', airlineName: 'Fin Air 2' }).customTail, TAIL, 'a rename keeps it');
  assert.equal(gameReducer(s, { type: 'SET_BRANDING', customTail: null }).customTail, null);
});

const fin = (livery, logo = { id: 'eagle', accentColor: '#d71920' }, extra = {}) =>
  strip(renderToStaticMarkup(React.createElement(TailFin, { livery, logo, height: 60, idPrefix: 'x', ...extra })));

await test('TailFin: a flat silhouette clipped to the chart shape, in the tail colour, at the fin\'s aspect', () => {
  const html = fin({ tail: '#0a2a66' });
  assert.match(html, /<clipPath id="fin-x"><path d="M405 1000 /);
  assert.match(html, /<rect x="0" y="0" width="\d+" height="\d+" fill="#0a2a66"/);
  assert.match(html, new RegExp(`width="${Math.round(60 * TF.FIN_ASPECT)}" height="60"`));
  assert.doesNotMatch(html, /<image|<canvas|Gradient|filter=/);
  assert.match(html, /data-tail-design="solid"/);
});

await test('designs draw in the accent colour; the striped designs carry no logo', () => {
  assert.match(fin({ tail: '#0a2a66', cheatline: '#ffcc00', tailDesign: 'stripe' }), /<polygon points="[^"]+" fill="#ffcc00"/);
  assert.match(fin({ tail: '#0a2a66', cheatline: '#ffcc00', tailDesign: 'swoosh' }), /<path d="M0 [^"]+" fill="#ffcc00"/);
  assert.match(fin({ tail: '#0a2a66', cheatline: '#ffcc00', tailDesign: 'split' }), /<polygon points="[^"]+" fill="#ffcc00"/);
  assert.deepEqual([...TF.LOGO_FREE_DESIGNS].sort(), ['stripe', 'stripes']);
  for (const d of ['solid', 'swoosh', 'split']) assert.match(fin({ tail: '#0a2a66', tailDesign: d }), /<g transform="translate[^>]*><svg/, d);
  for (const d of ['stripe', 'stripes']) assert.doesNotMatch(fin({ tail: '#0a2a66', tailDesign: d }), /<g transform="translate[^>]*><svg/, d);
  const expected = markColorOn('#d71920', '#d71920');
  assert.match(fin({ tail: '#d71920' }), new RegExp(`stroke="${expected}"`), 'the mark is recoloured to read on the tail');
});

await test('an uploaded tail is drawn clipped to the fin over the tail colour, with no design and no logo', () => {
  const html = fin({ tail: '#0a2a66', cheatline: '#ffcc00', tailDesign: 'swoosh' }, undefined, { tail: TAIL });
  assert.match(html, /data-tail-design="custom"/);
  assert.match(html, /<image href="data:image\/webp;base64,[^"]+" x="0" y="0" width="1291" height="1000" preserveAspectRatio="xMidYMid slice"/);
  assert.match(html, /<rect x="0" y="0" width="1291" height="1000" fill="#0a2a66">/);
  assert.doesNotMatch(html, /<g transform="translate[^>]*><svg/);
  assert.doesNotMatch(html, /fill="#ffcc00"/, 'no swoosh under an upload');
});

await test('the upload is shrunk to the fin\'s proportions; the template is the fin outline', () => {
  assert.equal(typeof img.fileToTailDataURL, 'function');
  assert.ok(Math.abs(img.TAIL_W / img.TAIL_H - TF.FIN_ASPECT) * img.TAIL_H < 1);
  assert.equal(img.TAIL_DATAURL_MAX_CHARS, 196_608);
  const svg = TF.tailTemplateSVG(img.TAIL_W, img.TAIL_H);
  assert.match(svg, new RegExp(`^<svg xmlns="http://www.w3.org/2000/svg" width="${img.TAIL_W}" height="${img.TAIL_H}" viewBox="0 0 1291 1000">`));
  assert.ok(svg.includes(`d="${TF.FIN_PATH}"`));
});

await test('hub markup: sized by tier, keyed on the look (upload included), unique clip ids, rendered on demand', async () => {
  const who = { airlineName: 'A', logoId: 'star', logoColor: '#ff0000', livery: { tailDesign: 'swoosh' } };
  const a = hubFinMarkup(who);
  const b = hubFinMarkup({ ...who, livery: { tailDesign: 'solid' } });
  const c = hubFinMarkup({ ...who, customTail: TAIL });
  assert.notEqual(a.key, b.key);
  assert.notEqual(a.key, c.key);
  assert.equal(await a.load([1]), true);
  assert.match(a.html(3), new RegExp(`height="${hubFinSize(3)}"`));
  assert.match(a.html(3), new RegExp(`clipPath id="fin-hub-${a.key}-t3"`));
  assert.match(c.html(2), /<image href="data:image\/webp/);
  assert.ok(hubFinSize(3) > hubFinSize(0));
  assert.equal(logoOf({ customLogo: 'data:image/png;base64,AA', logoId: 'star' }).id, null);
  assert.equal(tailOf({ customTail: TAIL }), TAIL);
  assert.equal(tailOf({}), null);
});

await test('the Network map draws the fins in their own effect after load(), keyed on the tail too', async () => {
  const src = read('../src/components/RouteMap.jsx');
  assert.match(src, /const hubFin = useMemo\(\(\) => hubFinMarkup\(state\)/);
  assert.match(src, /state\.customLogo, state\.customTail, state\.airlineName\]\);/);
  assert.match(src, /await hubFin\.load\(/);
  assert.match(src, /const html = hubFin\.html\(tier\);\s*if \(!html\) continue;/);
  assert.match(src, /className: 'hub-fin-marker'/);
  const RouteMap = (await import('../src/components/RouteMap.jsx')).default;
  store.set('bbae_save_v2', JSON.stringify({ ...freshState(), phase: 'playing', hub: 'SYD', hubs: { SYD: { tier: 2 } }, customTail: TAIL }));
  assert.ok(renderToString(React.createElement(GameProvider, null, React.createElement(RouteMap))).length > 0, 'still server-renders');
});

await test('logo maker: a Tail section with every design as a live tile, an Upload tile, colours and logo toggles', async () => {
  const BrandingModal = (await import('../src/components/BrandingModal.jsx')).default;
  const { LIVERY_PALETTE } = await import('../src/components/LiveryEditor.jsx');
  const render = () => strip(renderToString(React.createElement(GameProvider, null, React.createElement(BrandingModal, { onClose() {} }))));
  store.set('bbae_save_v2', JSON.stringify({ ...freshState(), phase: 'playing', airlineName: 'Fin Air', logoId: 'eagle', logoColor: '#d71920',
    livery: { tail: LIVERY_PALETTE[4].hex, cheatline: LIVERY_PALETTE[6].hex, tailDesign: 'swoosh', logoTile: true } }));
  const html = render();
  assert.match(html, /<label class="form-label">Tail<\/label>/);
  assert.match(html, /aria-label="Fin Air tail"/);
  for (const d of L.TAIL_DESIGNS) assert.match(html, new RegExp(`data-tail-design="${d}"`));
  assert.match(html, /aria-checked="true" data-tail-design="swoosh"/);
  assert.match(html, /aria-checked="false" data-tail-design="upload"/);
  assert.match(html, /<input type="file" accept="image\/\*" data-tail-file/);
  assert.match(html, /download="tail-template\.svg" data-tail-template/);
  assert.match(html, new RegExp(`aria-checked="true" title="[^"]+" data-tail-swatch="tail" data-tail-colour="${LIVERY_PALETTE[4].hex}"`));
  assert.match(html, new RegExp(`aria-checked="true" title="[^"]+" data-tail-swatch="cheatline" data-tail-colour="${LIVERY_PALETTE[6].hex}"`));
  assert.match(html, /aria-pressed="true" data-tail-logo/);
  assert.match(html, /aria-pressed="true" data-tail-tile/);
  store.set('bbae_save_v2', JSON.stringify({ ...freshState(), phase: 'playing', airlineName: 'Fin Air', logoId: 'eagle', livery: { tailDesign: 'stripe' } }));
  const striped = render();
  assert.match(striped, /data-tail-logo="true" disabled=""/);
  assert.match(striped, /the stripes carry this tail/);
  store.set('bbae_save_v2', JSON.stringify({ ...freshState(), phase: 'playing', airlineName: 'Fin Air', logoId: 'eagle', livery: { tailDesign: 'swoosh' }, customTail: TAIL }));
  const up = render();
  assert.match(up, /aria-checked="true" data-tail-design="upload"/);
  assert.match(up, /aria-checked="false" data-tail-design="swoosh"/);
  assert.match(up, /aria-label="Fin Air tail"[^>]*data-tail-design="custom"/);
  assert.match(up, /data-tail-remove/);
  assert.doesNotMatch(up, /data-tail-swatch="cheatline"/);
  assert.doesNotMatch(up, /data-tail-logo/);
  const bm = read('../src/components/BrandingModal.jsx');
  assert.match(bm, /useState\(state\.customTail \?\? null\)/);
  assert.match(bm, /\.\.\.\(customTail !== \(state\.customTail \?\? null\) \? \{ customTail \} : \{\}\),/);
});

await test('the shared files are byte-identical to Headwinds\' (TailFin, TailPicker, hubFin, logoImage) — keep them in step', () => {
  // A note, not a cross-repo read: these four are copied verbatim from
  // Headwinds' src/. Pin what the copies must still contain.
  assert.match(read('../src/components/TailFin.jsx'), /export const FIN_W = 1291, FIN_H = 1000/);
  assert.match(read('../src/components/TailPicker.jsx'), /data-tail-design="upload"/);
  assert.match(read('../src/utils/hubFin.js'), /export const tailOf = /);
  assert.match(read('../src/utils/logoImage.js'), /export function fileToTailDataURL/);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
