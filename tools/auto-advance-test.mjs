// Player-chosen auto-advance interval (Discord, 2026-11-18).
//
//   node --import ./tools/_register-loader.mjs tools/auto-advance-test.mjs
//
// Before: every game advanced a week every 60 minutes, fixed. Now the player
// picks a preset, a custom number of minutes, or Off.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToString } from 'react-dom/server';

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${(e.stack || e.message).split('\n').slice(0, 5).join('\n      ')}`); failed++; }
}

const A = await import('../src/utils/autoAdvance.js');
const { default: WeekCountdown } = await import('../src/components/WeekCountdown.jsx');
const { default: AutoAdvancePicker } = await import('../src/components/AutoAdvancePicker.jsx');
const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const shell = readFileSync(new URL('../src/components/MapShell.jsx', import.meta.url), 'utf8');

function memStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
}

console.log('\nAuto-advance interval\n');

await test('default stays one hour for players who never touch it', () => {
  assert.equal(A.loadAutoAdvanceMin(memStorage()), 60);
  assert.equal(A.autoAdvanceMs(60), 3_600_000);
});

await test('values are clamped to whole minutes, 1 min to 24 h; 0 / negative = off', () => {
  assert.equal(A.normalizeAutoAdvanceMin(15), 15);
  assert.equal(A.normalizeAutoAdvanceMin('45'), 45);
  assert.equal(A.normalizeAutoAdvanceMin(2.6), 3);
  assert.equal(A.normalizeAutoAdvanceMin(0.4), 1);
  assert.equal(A.normalizeAutoAdvanceMin(99999), 1440);
  assert.equal(A.normalizeAutoAdvanceMin(0), 0);
  assert.equal(A.normalizeAutoAdvanceMin(-5), 0);
  assert.equal(A.normalizeAutoAdvanceMin('off'), 0);
  assert.equal(A.normalizeAutoAdvanceMin('garbage'), 60);
  assert.equal(A.autoAdvanceMs(0), null);
});

await test('the setting round-trips through storage', () => {
  const s = memStorage();
  A.saveAutoAdvanceMin(15, s);
  assert.equal(A.loadAutoAdvanceMin(s), 15);
  A.saveAutoAdvanceMin(0, s);
  assert.equal(A.loadAutoAdvanceMin(s), 0);
});

await test('labels read naturally', () => {
  assert.equal(A.autoAdvanceLabel(0), 'Off');
  assert.equal(A.autoAdvanceLabel(15), '15 min');
  assert.equal(A.autoAdvanceLabel(60), '1 h');
  assert.equal(A.autoAdvanceLabel(90), '1 h 30 min');
});

await test('next due time: off never fires, a reload keeps the clock, a shorter interval pulls it in', () => {
  const now = 1_000_000_000;
  assert.equal(A.nextDueAt(now, 0, now + 5000), Infinity);
  assert.equal(A.nextDueAt(now, 60), now + 3_600_000);
  assert.equal(A.nextDueAt(now, 60, String(now + 600_000)), now + 600_000, 'reload keeps the saved time');
  assert.equal(A.nextDueAt(now, 15, now + 3_000_000), now + 900_000, 'shortened: no longer than one new interval');
  assert.equal(A.nextDueAt(now, 60, now - 1), now + 3_600_000, 'past time is not caught up');
});

await test('countdown shows "auto off" when the timer is off', () => {
  const html = renderToString(React.createElement(WeekCountdown, { atRef: { current: Infinity } }));
  assert.match(html, /auto off/);
});

await test('picker renders the presets with the current choice selected', () => {
  const html = renderToString(React.createElement(AutoAdvancePicker, { value: 15, onChange: () => {} }));
  assert.match(html, /Every 15 min/);
  assert.match(html, /Off \(Next Week only\)/);
  assert.match(html, /Custom/);
  const custom = renderToString(React.createElement(AutoAdvancePicker, { value: 45, onChange: () => {} }));
  assert.match(custom, /data-auto-advance-custom/, 'a non-preset value opens the custom field');
});

await test('App reads the interval from the setting, not a fixed hour', () => {
  assert.doesNotMatch(app, /WEEK_INTERVAL_MS/);
  assert.match(app, /nextDueAt\(Date\.now\(\), autoAdvanceMinRef\.current/);
});

await test('both layouts offer the setting (classic clock button + mobile menu, map Settings menu)', () => {
  assert.equal((app.match(/data-auto-advance-open/g) ?? []).length, 2);
  assert.match(app, /<AutoAdvanceDialog /);
  assert.match(app, /autoAdvance=\{remote \? null : <AutoAdvancePicker /);
  assert.match(shell, /data-shell="auto-advance"/);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed) process.exit(1);
