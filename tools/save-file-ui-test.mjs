// @not-a-test — PARKED 2026-10-14. Dave held export / import back before it
// shipped, so SaveFileControls.jsx is on disk but not wired into the Save / Load
// window or the new-game screen, and this suite would fail by design. Remove
// this marker when the controls are wired back in.
//
// The export / import controls render where a player needs them.
//
// Server-renders the REAL Save / Load window and new-game screen (no mocks)
// through the JSX loader. The two places matter for different players: the
// window is where someone backs up the airline they are playing, and the
// new-game screen is where someone arriving on a NEW device lands — with no
// game, so no header and no Load button. If the import offer is missing there,
// the file they exported has nowhere to go.
//
//   node --import ./tools/_register-loader.mjs tools/save-file-ui-test.mjs

import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'react-dom/server';

const mem = new Map();
globalThis.window = globalThis.window ?? {};
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
  clear: () => mem.clear(),
};

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${(e.stack || e.message).split('\n').slice(0, 4).join('\n      ')}`); failed++; }
}

const { GameProvider, gameReducer, freshState } = await import('../src/store/GameContext.jsx');
const { ConfirmProvider } = await import('../src/components/ConfirmModal.jsx');
const SaveLoadModal = (await import('../src/components/SaveLoadModal.jsx')).default;
const SetupScreen   = (await import('../src/components/SetupScreen.jsx')).default;

const h = React.createElement;
function render(el, seed) {
  mem.clear();
  if (seed) mem.set('bbae_save_v2', JSON.stringify(seed));
  return renderToString(h(GameProvider, null, h(ConfirmProvider, null, el)));
}

const playing = gameReducer(freshState(), { type: 'START_GAME', airlineName: 'Probe Air', hub: 'LGW' });

console.log('\n── Save / Load window ───────────────────────────────────────');
for (const mode of ['save', 'load']) {
  test(`${mode} mode offers export and import mid-game`, () => {
    const html = render(h(SaveLoadModal, { mode, onClose() {} }), playing);
    assert.ok(html.includes('Back up to a file'), 'backup section');
    assert.ok(html.includes('Export current game'), 'export button');
    assert.ok(html.includes('Import a save file'), 'import button');
    assert.ok(/type="file"/.test(html), 'file input');
    assert.ok(!/accept=/.test(html), 'no accept filter: iOS would grey out .twsave');
  });
}

console.log('\n── New-game screen ──────────────────────────────────────────');
test('a player with no game can import from the first step', () => {
  const html = render(h(SetupScreen), null);
  assert.ok(html.includes('Moving an airline from another device'), 'prompt');
  assert.ok(html.includes('Import a save file'), 'import button');
});
test('the export button is not offered when there is no game to export', () => {
  const html = render(h(SaveLoadModal, { mode: 'load', onClose() {} }), null);
  assert.ok(!html.includes('Export current game'));
  assert.ok(html.includes('Import a save file'));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
