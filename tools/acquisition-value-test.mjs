// acquisition-value-test.mjs — the "buy a $500K airline, pocket its $67M" fix.
//
// Reported by a player (Discord, 2026-07-30): FastFly printed a $500K market cap
// while holding $67.43M in cash, so it could be acquired for $625K and the buyer
// inherited the whole pile — a net gain of ~$67M, ten routes and nineteen jets,
// repeatable on every cash-rich loss-maker in the roster.
//
// Two things were wrong and both are fixed here:
//   1. computeMarketCap valued a loss-maker at `annualLoss x 5 + cash x 0.8`, which
//      falls straight through MIN_MARKET_CAP no matter how much cash is in the
//      bank. Equity now floors at net cash — the liquidation value.
//   2. The acquisition price was computed in THREE places (list, modal, reducer)
//      with no floor at all. There is now one helper, and the price can never sit
//      below the cash + fleet break-up value the buyer walks away with.
//
//   node --import ./tools/_register-loader.mjs tools/acquisition-value-test.mjs

import assert from 'node:assert/strict';
import { gameReducer, freshState } from '../src/store/GameContext.jsx';
import { computeMarketCap, MIN_MARKET_CAP } from '../src/utils/market.js';
import {
  acquisitionQuote, acquisitionPrice, competitorFleetNAV,
  ACQUISITION_PREMIUM, FIRE_SALE_PREMIUM, FLEET_FLOOR_HAIRCUT,
} from '../src/models/competitorAI.js';
import { getAircraftType } from '../src/data/aircraft.js';

// uid() builds ids from Math.random — keep it varying so ids never collide.
let _rng = 0;
Math.random = () => 0.90 + ((_rng++ % 97) / 1000);

let passed = 0, failed = 0;
const test = (n, fn) => {
  try { fn(); console.log('  ok  ' + n); passed++; }
  catch (e) { console.log('  FAIL ' + n + '\n       ' + (e.message || e)); failed++; }
};

const M = 1_000_000;

// ── The reported carrier ─────────────────────────────────────────────────────
// FastFly: budget, hub LAX, 10 routes, 19 aircraft, $67.43M cash, losing money
// hard enough that the going-concern formula floored its cap at $500K.
const TYPE = 'a320neo';
const fastFly = (over = {}) => ({
  id:               'ff',
  name:             'FastFly',
  tier:             'budget',
  homeHub:          'LAX',
  baseQualityScore: 45,
  cash:             67_430_000,
  fireSale:         false,
  profitHistory:    Array.from({ length: 12 }, () => -6 * M),   // deep, sustained losses
  routes: Object.fromEntries(
    ['DEN-LAX', 'JFK-LAX', 'LAS-LAX', 'LAX-ORD', 'LAX-PHX',
     'LAX-SEA', 'LAX-SFO', 'DEN-JFK', 'LAX-MCO', 'EWR-LAX']
      .map(k => [k, { frequency: 7, aircraftType: TYPE, tails: 2 }])),
  fleet: Array.from({ length: 19 }, (_, i) => ({
    id: `ff-t${i}`, typeId: TYPE, routeKey: 'DEN-LAX', ageWeeks: 200,
  })),
  ...over,
});

// ── 1. Valuation: cash is the floor ──────────────────────────────────────────

test('a loss-maker sitting on cash is no longer worth the $500K minimum', () => {
  const c = fastFly();
  const { marketCap, fairValue } = computeMarketCap(c.profitHistory, c.cash, c.baseQualityScore);
  assert.notEqual(marketCap, MIN_MARKET_CAP, 'this is the exact number the player screenshotted');
  assert.ok(fairValue >= c.cash,
    `fair value $${(fairValue / M).toFixed(1)}M must be at least the $${(c.cash / M).toFixed(1)}M in the bank`);
});

test('losses still drag the valuation down — just never below the cash pile', () => {
  const mild  = computeMarketCap(Array.from({ length: 12 }, () => -0.2 * M), 40 * M, 50).fairValue;
  const brutal = computeMarketCap(Array.from({ length: 12 }, () => -20 * M), 40 * M, 50).fairValue;
  assert.ok(brutal <= mild, 'a worse loss-maker is never worth more');
  assert.equal(brutal, 40 * M, 'and the floor is exactly net cash');
});

test('a profitable airline is valued by its profits, exactly as before', () => {
  // The floor must not become a subsidy: for anything healthy the going-concern
  // formula is far above cash and nothing about the number changes.
  const profits = Array.from({ length: 12 }, () => 2 * M);
  const r = computeMarketCap(profits, 40 * M, 65);
  const annualized = Math.round(profits.reduce((s, p) => s + p, 0) * (52 / 12));
  const pe = 12 + 0 + (65 / 100) * 5;   // flat profits → zero growth bonus
  assert.equal(r.fairValue, annualized * pe + 40 * M * 0.8, 'untouched by the floor');
  assert.ok(r.fairValue > 40 * M, 'sanity: the going-concern leg is the binding one here');
});

test('a carrier in the red is not rescued by the floor', () => {
  // Negative cash must not lift anything — a fire-sale carrier stays cheap.
  const r = computeMarketCap(Array.from({ length: 12 }, () => -4 * M), -8 * M, 40);
  assert.equal(r.fairValue, MIN_MARKET_CAP);
});

// ── 2. Pricing: you cannot buy a company for less than what it hands you ─────

test('the reported deal is dead: price now exceeds the cash inherited', () => {
  const c = fastFly();
  c.marketCap = computeMarketCap(c.profitHistory, c.cash, c.baseQualityScore).marketCap;
  const q = acquisitionQuote(c);
  assert.ok(q.price > c.cash,
    `paid $${(q.price / M).toFixed(1)}M for $${(c.cash / M).toFixed(1)}M — still free money`);
  const netOutlay = q.price - c.cash;
  assert.ok(netOutlay > 0, 'net cash outlay must be positive');
});

test('even a stale $500K print cannot be exploited — the floor is independent', () => {
  // The published cap converges toward fair value over several weeks, so mid-catch-up
  // it can still lag low. The break-up floor does not depend on the print at all.
  const c = fastFly({ marketCap: MIN_MARKET_CAP });
  const q = acquisitionQuote(c);
  assert.equal(q.marketCapPrice, Math.round(MIN_MARKET_CAP * ACQUISITION_PREMIUM));
  assert.ok(q.floorBinds, 'the floor must be what sets this price');
  assert.ok(q.price > c.cash, `$${(q.price / M).toFixed(1)}M vs $${(c.cash / M).toFixed(1)}M of cash`);
});

test('the floor is cash plus a slice of real fleet break-up value', () => {
  const c = fastFly({ marketCap: MIN_MARKET_CAP });
  const type = getAircraftType(TYPE);
  assert.ok(type, `test needs a real aircraft type (${TYPE})`);
  const nav = competitorFleetNAV(c);
  assert.ok(nav > 0, 'nineteen airworthy jets are worth something');
  assert.ok(nav < 19 * type.purchasePrice, 'and less than nineteen new ones — they are aged');
  assert.equal(acquisitionQuote(c).floorPrice,
    Math.round(c.cash + nav * FLEET_FLOOR_HAIRCUT));
});

test('a healthy carrier is priced exactly as before — the floor never binds', () => {
  const healthy = {
    id: 'pp', name: 'Pampa Premium', tier: 'premium', cash: 200 * M, fireSale: false,
    marketCap: 2_730_000_000,
    fleet: Array.from({ length: 20 }, (_, i) => ({ id: `pp-t${i}`, typeId: TYPE, ageWeeks: 100 })),
  };
  const q = acquisitionQuote(healthy);
  assert.equal(q.floorBinds, false, 'a going concern is worth more than its parts');
  assert.equal(q.price, Math.round(healthy.marketCap * ACQUISITION_PREMIUM),
    'the classic 25% premium over market cap, unchanged');
});

test('a fire sale discounts the business, never the metal', () => {
  const distressed = {
    id: 'ds', name: 'Distressed Air', tier: 'budget', cash: -5 * M, fireSale: true,
    marketCap: 40 * M,
    fleet: Array.from({ length: 8 }, (_, i) => ({ id: `ds-t${i}`, typeId: TYPE, ageWeeks: 600 })),
  };
  const q = acquisitionQuote(distressed);
  assert.equal(q.premium, FIRE_SALE_PREMIUM, 'still a discount, not a premium');
  assert.ok(q.marketCapPrice < 40 * M, 'the going-concern leg really is discounted');
  assert.equal(q.haircut, FLEET_FLOOR_HAIRCUT, 'but the airframes are not marked down');
});

test('buy-and-liquidate is never profitable, for any carrier', () => {
  // The one property that actually closes the exploit: acquired aircraft land in
  // the player fleet and SELL_AIRCRAFT pays NAV minus a 5% fee, so the price must
  // cover cash + those proceeds. The upside of a takeover is the NETWORK.
  const carriers = [
    fastFly({ marketCap: MIN_MARKET_CAP }),
    fastFly({ marketCap: 900 * M }),
    { id: 'ds', name: 'Distressed Air', cash: -5 * M, fireSale: true, marketCap: 40 * M,
      fleet: Array.from({ length: 8 }, (_, i) => ({ id: `d${i}`, typeId: TYPE, ageWeeks: 600 })) },
    { id: 'tiny', name: 'Tiny Air', cash: 2 * M, marketCap: MIN_MARKET_CAP, fleet: [] },
  ];
  for (const c of carriers) {
    const q = acquisitionQuote(c);
    const liquidation = (c.cash ?? 0) + competitorFleetNAV(c) * 0.95;   // sale fee is 5%
    assert.ok(q.price >= Math.round(liquidation) - 1,
      `${c.name}: paid $${(q.price / M).toFixed(1)}M, could liquidate for $${(liquidation / M).toFixed(1)}M`);
  }
});

test('acquisitionPrice returns null for a carrier with no valuation yet', () => {
  assert.equal(acquisitionPrice({ id: 'x', marketCap: null }), null);
  assert.equal(acquisitionPrice(null), null);
});

// ── 3. The reducer charges the quoted price ──────────────────────────────────
// The UI and the reducer used to compute the price separately. These are the
// tests that would have caught the original defect.

const stateWith = (competitor, cash = 2_000 * M) => ({
  ...freshState(),
  week: 20, year: 2,
  cash,
  competitors: [competitor],
});

test('acquiring no longer increases the buyer cash', () => {
  const c = fastFly({ marketCap: MIN_MARKET_CAP });
  const s0 = stateWith(c);
  const s1 = gameReducer(s0, { type: 'ACQUIRE_COMPETITOR', competitorId: 'ff' });
  assert.ok(s1.cash < s0.cash,
    `cash went $${(s0.cash / M).toFixed(1)}M → $${(s1.cash / M).toFixed(1)}M — the exploit is back`);
  assert.equal(s1.competitors.length, 0, 'and the carrier was actually absorbed');
  assert.equal(s1.fleet.length, 19, 'with its fleet');
});

test('the reducer charges exactly what the modal quotes', () => {
  const c = fastFly({ marketCap: MIN_MARKET_CAP });
  const s0 = stateWith(c);
  const s1 = gameReducer(s0, { type: 'ACQUIRE_COMPETITOR', competitorId: 'ff' });
  const quoted = acquisitionQuote(c).price;
  assert.equal(s1.cash, s0.cash - quoted + c.cash, 'no hidden difference between quote and charge');
});

test('a player who cannot cover the floored price is refused', () => {
  const c  = fastFly({ marketCap: MIN_MARKET_CAP });
  const s0 = stateWith(c, 10 * M);   // affordable at the OLD $625K price
  const s1 = gameReducer(s0, { type: 'ACQUIRE_COMPETITOR', competitorId: 'ff' });
  assert.equal(s1, s0, 'the action is ignored outright');
});

test('the acquired fleet cannot be flipped for more than the deal cost', () => {
  const c  = fastFly({ marketCap: MIN_MARKET_CAP });
  const s0 = stateWith(c);
  let s    = gameReducer(s0, { type: 'ACQUIRE_COMPETITOR', competitorId: 'ff' });
  assert.equal(s.fleet.length, 19, 'sanity: the jets did transfer');
  for (const a of [...s.fleet]) s = gameReducer(s, { type: 'SELL_AIRCRAFT', aircraftId: a.id });
  // Tolerance is per-airframe cent rounding on the 5% sale fee, not a margin.
  assert.ok(s.cash - s0.cash <= 19,
    `buy + liquidate netted $${(s.cash - s0.cash).toLocaleString()} on a $${(s0.cash / M).toFixed(0)}M bankroll`);
});

test('a fresh-game competitor with no market cap yet is still priced sanely', () => {
  const c  = fastFly({ marketCap: undefined });
  const s0 = stateWith(c);
  const s1 = gameReducer(s0, { type: 'ACQUIRE_COMPETITOR', competitorId: 'ff' });
  assert.ok(s1.cash < s0.cash, 'the cold-valuation path is floored too');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
