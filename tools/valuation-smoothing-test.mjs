// Market-cap smoothing — ported from the Headwinds "+8383% on a private company"
// fix (2026-07-29). Tailwinds never had a stock market, so it never had the
// private/listed half of that bug — but it also never had ANY smoothing, which is
// the half that does apply here.
//
// Before this: the published market cap WAS the raw fair value, recomputed from
// scratch every tick for the player and for every AI rival. One good week, a loan
// draw, an asset sale or a single bad month moved the leaderboard number by
// whatever the model said, with nothing in between — the same defect that printed
// a four-digit weekly move in Headwinds, just without a share price on top of it.
//
// After: the published cap CONVERGES toward fair value inside a weekly band that
// widens with the size of the gap. The fair-value math is untouched, so where a
// valuation SETTLES is exactly what it was — only the path changed.
//
//   node --import ./tools/_register-loader.mjs tools/valuation-smoothing-test.mjs

import assert from 'node:assert/strict';
import { gameReducer, freshState } from '../src/store/GameContext.jsx';
import {
  computeMarketCap, publishMarketCap, moveClampFor, TOTAL_SHARES,
  MARKET_CONVERGENCE, WEEKLY_MOVE_CLAMP, MOVE_CLAMP_MAX, MIN_MARKET_CAP,
} from '../src/utils/market.js';

// uid() builds ids from Math.random — keep it varying so ids never collide.
let _rng = 0;
Math.random = () => 0.90 + ((_rng++ % 97) / 1000);

let passed = 0, failed = 0;
const test = (n, fn) => {
  try { fn(); console.log('  ok  ' + n); passed++; }
  catch (e) { console.log('  FAIL ' + n + '\n       ' + (e.message || e)); failed++; }
};

const M = 1_000_000;
const history = (weeks, profit, totalCost = 4_140_000) =>
  Array.from({ length: weeks }, () => ({ profit, totalCost, revenue: totalCost + profit }));

// ── 1. The level did not move ────────────────────────────────────────────────
// The single most important property of this port: it is a change to the PATH of
// the published number, not to what the model thinks an airline is worth.

test('fair value is exactly what the old formula produced', () => {
  const profits = history(12, 2 * M).map(h => h.profit);
  const r = computeMarketCap(profits, 40 * M, 65);
  // Reconstruct the pre-port formula by hand and demand an exact match.
  const weeks = profits.slice(-12);
  const annualized = Math.round(weeks.reduce((s, p) => s + p, 0) * (52 / weeks.length));
  const recent = weeks.slice(-6), prior = weeks.slice(0, weeks.length - 6);
  const recentAvg = recent.reduce((s, p) => s + p, 0) / recent.length;
  const priorAvg  = prior.reduce((s, p) => s + p, 0) / prior.length;
  const growth = priorAvg !== 0 ? (recentAvg - priorAvg) / Math.abs(priorAvg) : (recentAvg > 0 ? 0.5 : 0);
  const pe = 12 + Math.max(-5, Math.min(15, growth * 20)) + (65 / 100) * 5;
  const expected = Math.max((annualized >= 0 ? annualized * pe : annualized * 5) + 40 * M * 0.8, 500_000);
  assert.equal(r.fairValue, expected, 'the valuation model itself is untouched');
});

test('a cold valuation still publishes fair value directly', () => {
  // Save-load fallbacks and acquisition pricing pass no previous print, and must
  // behave exactly as they did before the port.
  const profits = history(12, 2 * M).map(h => h.profit);
  const r = computeMarketCap(profits, 40 * M, 65);
  assert.equal(r.marketCap, r.fairValue, 'no previous print → nothing to smooth');
  assert.equal(r.sharePrice, r.marketCap / TOTAL_SHARES);
});

test('the short-history branch smooths too, instead of returning early', () => {
  // This branch used to `return` before any smoothing existed. A brand-new airline
  // whose cash swings should not teleport its print either.
  const prev = 20 * M;
  const r = computeMarketCap([1 * M], 300 * M, 50, { prevMarketCap: prev });
  assert.equal(r.fairValue, Math.max(300 * M * 1.5, MIN_MARKET_CAP), 'fair value unchanged');
  const move = (r.marketCap - prev) / prev;
  assert.ok(move <= MOVE_CLAMP_MAX + 1e-9, `moved ${(move * 100).toFixed(1)}% — must be banded`);
});

// ── 2. The band ──────────────────────────────────────────────────────────────

test('an ordinary week moves at most 8%', () => {
  assert.equal(WEEKLY_MOVE_CLAMP, 0.08);
  assert.equal(moveClampFor(100 * M, 100 * M), 0.08);
  assert.ok(moveClampFor(100 * M, 105 * M) < 0.083, 'a 5% gap barely widens the band');
});

test('a real re-rating widens the band, symmetrically, and is capped', () => {
  assert.ok(moveClampFor(100 * M, 400 * M) > 0.15, 'fair value 4x the print → a wider band');
  assert.equal(moveClampFor(100 * M, 400 * M).toFixed(6), moveClampFor(400 * M, 100 * M).toFixed(6),
    'a collapse reprices exactly as fast as a re-rating');
  assert.equal(moveClampFor(1 * M, 10_000 * M), MOVE_CLAMP_MAX, 'and it is capped');
});

test('the band is a band, not a governor — a grower still catches its fair value', () => {
  // A flat 8% would take ~68 weeks to close a 180x gap, longer than it took to
  // open, so the print would never converge while the airline kept growing.
  const fair = 5_200 * M;
  let cap = 29 * M, weeks = 0;
  while (cap < fair * 0.9 && weeks < 500) {
    cap = publishMarketCap(fair, cap);
    weeks++;
  }
  assert.ok(weeks <= 30, `took ${weeks} weeks to converge (a flat 8% band takes 68)`);
});

test('publishMarketCap never prints below the absolute floor, or below the band', () => {
  assert.equal(publishMarketCap(1, 100), MIN_MARKET_CAP, 'a cold print is floored');
  // A total collapse of fair value. Note the 30% convergence step is GENTLER than
  // the 35% band, so on a one-week collapse it is convergence that binds, not the
  // clamp — the print falls to prev + 0.30 x (floor - prev), never further.
  const out = publishMarketCap(-500 * M, 10 * M);
  assert.ok(out >= MIN_MARKET_CAP, 'never below the absolute floor');
  assert.ok(out >= 10 * M * (1 - MOVE_CLAMP_MAX) - 1e-6, 'never below the widest band either');
  assert.ok(Math.abs(out - (10 * M + MARKET_CONVERGENCE * (MIN_MARKET_CAP - 10 * M))) < 1,
    'and it is exactly the convergence step, because that is the tighter of the two');
});

test('convergence pulls toward fair value, it does not overshoot it', () => {
  const prev = 100 * M, fair = 120 * M;
  const out = publishMarketCap(fair, prev);
  assert.ok(out > prev && out < fair, `expected a step between $100M and $120M, got $${(out / M).toFixed(1)}M`);
  assert.ok(Math.abs(out - (prev + MARKET_CONVERGENCE * (fair - prev))) < 1,
    'and the step is exactly the convergence fraction when the band is not binding');
});

// ── 3. The reducer actually threads it ───────────────────────────────────────
// The pure-function tests above pass even if nothing calls them with a previous
// print. These are the ones that would have caught the original defect.

const airline = (over = {}) => ({
  ...freshState(),
  week: 20, year: 2,
  cash: 30 * M,
  marketCap: 25 * M,
  sharePrice: 0.25,
  financialHistory: history(12, 1_530_000),
  ...over,
});

test('the player tick smooths the published cap across a violent swing', () => {
  let s = airline();
  const caps = [s.marketCap];
  for (let i = 0; i < 12; i++) {
    s = { ...s, cash: i % 2 === 0 ? 3 * M : 600 * M };
    s = gameReducer(s, { type: 'ADVANCE_WEEK' });
    caps.push(s.marketCap);
  }
  for (let i = 1; i < caps.length; i++) {
    const move = Math.abs(caps[i] - caps[i - 1]) / caps[i - 1];
    assert.ok(move <= MOVE_CLAMP_MAX + 1e-9,
      `week ${i} printed ${(move * 100).toFixed(1)}% — outside the ±${(MOVE_CLAMP_MAX * 100).toFixed(0)}% band`);
  }
});

test('...and the same swing is unbanded if the previous print is not passed', () => {
  // Demonstrates the assertion above is not vacuous: this is the pre-port call.
  const lean = computeMarketCap(history(12, 1_530_000).map(h => h.profit), 3 * M, 5);
  const fat  = computeMarketCap(history(12, 1_530_000).map(h => h.profit), 600 * M, 5);
  const move = (fat.marketCap - lean.marketCap) / lean.marketCap;
  assert.ok(move > MOVE_CLAMP_MAX,
    `the unsmoothed path moves ${(move * 100).toFixed(0)}% in one step — outside the band the smoothed path is held to`);
});

test('AI rivals are smoothed too, or the leaderboard is half-smoothed', () => {
  let s = airline();
  assert.ok((s.competitors ?? []).length > 0, 'the scenario actually has AI rivals');
  // Rivals hold no marketCap until they have been ticked once — that first tick is
  // a cold valuation for every one of them, so seed it before measuring.
  s = gameReducer(s, { type: 'ADVANCE_WEEK' });
  const before = s.competitors.map(c => c.marketCap);
  s = gameReducer(s, { type: 'ADVANCE_WEEK' });
  const after = s.competitors.map(c => c.marketCap);
  let checked = 0;
  for (let i = 0; i < after.length; i++) {
    const prev = before[i];
    if (!(prev > 0)) continue;              // first tick for that rival — cold, exempt
    const move = Math.abs(after[i] - prev) / prev;
    assert.ok(move <= MOVE_CLAMP_MAX + 1e-9,
      `rival ${s.competitors[i].name} printed ${(move * 100).toFixed(1)}%`);
    checked++;
  }
  assert.ok(checked > 0, 'at least one rival had a previous print to compare against');
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
