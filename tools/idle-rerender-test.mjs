// The game sits still while the player does nothing.
//
//   node --import ./tools/_register-loader.mjs tools/idle-rerender-test.mjs
//
// Before (2026-11-05): the "next week in…" countdown was App state, set by the
// auto-advance timer every second, so the WHOLE game re-rendered once a second
// at rest — measured in headless Chromium on a 600-tail save, the open Fleet
// page spent 3.4% of the main thread in script doing nothing (Market 2.0%,
// Finance 1.9%). The countdown now ticks inside its own little component and
// App's timer sets no state until the week is due: 0.0% on every page.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToString } from 'react-dom/server';

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${(e.stack || e.message).split('\n').slice(0, 5).join('\n      ')}`); failed++; }
}
const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const { default: WeekCountdown, formatCountdown } = await import('../src/components/WeekCountdown.jsx');

console.log('\nIdle re-renders\n');

await test('App keeps no per-second countdown state', () => {
  assert.doesNotMatch(app, /setTimeUntilNextWeek|timeUntilNextWeek/);
  // The auto-advance timer only acts when the week is due.
  const timer = app.slice(app.indexOf('const tick = setInterval('), app.indexOf('return () => clearInterval(tick);'));
  assert.ok(timer.length > 0, 'auto-advance timer found');
  assert.doesNotMatch(timer, /\bset(?!Interval|Timeout)[A-Z]\w*\(/, 'the timer must not set App state every second');
  assert.match(timer, /if \(nextWeekAt\.current - Date\.now\(\) <= 0\) advanceWeek\.current\(\);/);
});

await test('both countdowns (classic Next Week button, map view) are the self-ticking component', () => {
  assert.equal((app.match(/<WeekCountdown atRef=\{nextWeekAt\} version=\{countdownVersion\} \/>/g) ?? []).length, 2);
});

await test('the countdown reads the same as before', () => {
  assert.equal(formatCountdown(3_600_000 + 61_000), '1h 1m');
  assert.equal(formatCountdown(61_500), '1m 2s');
  assert.equal(formatCountdown(4_000), '4s');
  assert.equal(formatCountdown(-5), '0s');
  const at = { current: Date.now() + 125_000 };
  assert.match(renderToString(React.createElement(WeekCountdown, { atRef: at })), /^2m (4|5)s$/);
});

console.log(`\nidle-rerender-test: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
