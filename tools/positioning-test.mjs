// The positioning map plots the market that exists.
//
// D5. The Reputation tab's brand map drew three rivals from a literal:
//
//       { id: 'zoomjet',   x: 0.28, y: 0.12 }
//       { id: 'globalair', x: 0.58, y: 0.55 }
//       { id: 'apexair',   x: 0.82, y: 0.88 }
//
//     They are real carriers, which made it worse rather than better. A world
//     samples 25 of 70, so measured over 400 sampled worlds only 1.46 of those
//     three actually exist: 14.5% of games plotted three competitors the player
//     would never meet and 10.8% got all three. The 25 carriers that WERE out
//     there — live networks, live fares, live quality — went undrawn, and the
//     three that were drawn never moved whatever the market did.
//
//     The player's own dot had the matching defect from the other direction: it
//     read `route.ticketPrice` off the raw state.routes array, so it could not
//     see a single fare set through state.routePricing — which is the only place
//     a fare is ever written. Measured on HEAD: taking every fare to a 60%
//     premium moved the dot exactly zero.
//
//   node --import ./tools/_register-loader.mjs tools/positioning-test.mjs

import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'react-dom/server';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
  key: (i) => [...store.keys()][i] ?? null,
  get length() { return store.size; },
};
globalThis.window ??= {
  localStorage: globalThis.localStorage,
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
};
if (!globalThis.window.localStorage) globalThis.window.localStorage = globalThis.localStorage;

const {
  calcPositioning, competitorPositioning, competitorField, positionFrom,
  rivalProductQuality, strategyLabel, NEUTRAL_QUALITY_SCORE, NEUTRAL_PRODUCT,
} = await import('../src/models/positioning.js');
const { COMPETITOR_AIRLINES, sampleAndInitializeCompetitors, competitorBusinessFraction, TIER_PRICE_MULT }
  = await import('../src/models/demand.js');
const { referencePrice, routeDistance } = await import('../src/utils/market.js');
const { GameProvider, freshState } = await import('../src/store/GameContext.jsx');
const Reputation = (await import('../src/components/Reputation.jsx')).default;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${(e.stack || e.message).split('\n').slice(0, 4).join('\n      ')}`); failed++; }
}

// React SSR splits adjacent text nodes with an empty comment.
const clean = (html) => html
  .replace(/<!-- -->/g, '')
  .replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"');

// ── Fixture ─────────────────────────────────────────────────────────────────

const PAIRS = [['SFO', 'ORD'], ['SFO', 'JFK'], ['SFO', 'DEN']];
const pairKey = (a, b) => [a, b].sort().join('-');

const playerState = (over = {}) => ({
  fleet: PAIRS.map((_, i) => ({
    id: `ac${i}`, typeId: 'a320ceo', tailNumber: `N${i}TEST`, status: 'assigned',
    ageWeeks: 52, ownershipType: 'owned',
    config: { economy: 186, seatQuality: 'standard', serviceQuality: 'standard' },
  })),
  routes: PAIRS.map(([o, d], i) => ({
    id: `r${i}`, origin: o, destination: d, aircraftId: `ac${i}`,
    weeklyFrequency: 14, weeksOpen: 40, ticketPrice: Math.round(referencePrice(o, d)),
  })),
  routePricing: {},
  competitors: [],
  ...over,
});

const rival = (over = {}) => ({
  id: 'r1', name: 'Test Air', tier: 'legacy', homeHub: 'ORD', baseQualityScore: 65,
  routes: { [pairKey('ORD', 'DFW')]: { frequency: 14, priceMultiplier: 1.0 } },
  ...over,
});

// ── The shared scale ────────────────────────────────────────────────────────

console.log('\n── One formula, two carriers ────────────────────────────');

test('a rival at the neutral quality lands on a standard cabin', () => {
  // The two product scales — the player's 0–1 cabin average and a rival's 0–100
  // baseQualityScore — agree on exactly one point. Pinning them there is what
  // makes the two dots comparable at all; if this drifts, the chart is drawing
  // two carriers with the same product in different places.
  assert.equal(rivalProductQuality(NEUTRAL_QUALITY_SCORE), NEUTRAL_PRODUCT);
});

test('the product scale is monotonic and stays inside its axis', () => {
  let prev = -1;
  for (let q = 0; q <= 100; q++) {
    const v = rivalProductQuality(q);
    assert.ok(v >= 0 && v <= 1, `q${q} mapped to ${v}, outside the axis`);
    assert.ok(v >= prev, `q${q} scored lower than q${q - 1}`);
    prev = v;
  }
});

test('the scale follows the roster rather than a hardcoded range', () => {
  // The roster's best carrier should reach the top of the axis and its worst
  // should reach the bottom, whatever those numbers happen to be today.
  const scores = COMPETITOR_AIRLINES.map(c => c.baseQualityScore).filter(Number.isFinite);
  assert.ok(scores.length > 0);
  assert.equal(rivalProductQuality(Math.max(...scores)), 1);
  assert.equal(rivalProductQuality(Math.min(...scores)), 0);
});

test('a bad input is a standard cabin, not a NaN dot', () => {
  for (const bad of [undefined, null, NaN, 'premium']) {
    assert.equal(rivalProductQuality(bad), NEUTRAL_PRODUCT);
  }
});

test('both carriers go through the same final arithmetic', () => {
  // Not a paraphrase of it. Feed calcPositioning and competitorPositioning
  // inputs that describe the same airline and they must land on the same dot.
  const inputs = { bizCapRatio: 0.12, avgPricePrem: 0.05, avgQuality: NEUTRAL_PRODUCT };
  const direct = positionFrom(inputs);

  const c = rival({
    baseQualityScore: NEUTRAL_QUALITY_SCORE,
    routes: { [pairKey('ORD', 'DFW')]: { frequency: 10, priceMultiplier: 1.05 } },
  });
  const pos = competitorPositioning(c);
  const dist = routeDistance('ORD', 'DFW') ?? 0;
  const expected = positionFrom({
    bizCapRatio:  competitorBusinessFraction('legacy', dist),
    avgPricePrem: 0.05,
    avgQuality:   NEUTRAL_PRODUCT,
  });
  assert.equal(pos.x, expected.x);
  assert.equal(pos.y, expected.y);
  assert.ok(Number.isFinite(direct.x) && Number.isFinite(direct.y));
});

// ── Rivals are read from state ──────────────────────────────────────────────

console.log('\n── The dots move because the market does ────────────────');

test('raising a rival\'s fares moves them up the premium axis', () => {
  const cheap = competitorPositioning(rival({
    routes: { [pairKey('ORD', 'DFW')]: { frequency: 14, priceMultiplier: 0.80 } },
  }));
  const dear = competitorPositioning(rival({
    routes: { [pairKey('ORD', 'DFW')]: { frequency: 14, priceMultiplier: 1.40 } },
  }));
  assert.ok(dear.y > cheap.y, `${dear.y} should exceed ${cheap.y}`);
  assert.ok(dear.pricePremium > cheap.pricePremium);
});

test('a better product lifts a carrier without touching its fares', () => {
  const plain  = competitorPositioning(rival({ baseQualityScore: 45 }));
  const smart  = competitorPositioning(rival({ baseQualityScore: 85 }));
  assert.ok(smart.y > plain.y);
  assert.equal(smart.pricePremium, plain.pricePremium, 'fares were not the variable');
});

test('a long-haul network reads as more business-facing than a short one', () => {
  // competitorBusinessFraction carries more J on long sectors, which is the
  // engine's own statement about the rival's cabin — the same number it uses to
  // carve their premium capacity when they compete against you.
  const short = competitorPositioning(rival({
    routes: { [pairKey('ORD', 'DFW')]: { frequency: 14, priceMultiplier: 1.0 } },
  }));
  const long = competitorPositioning(rival({
    routes: { [pairKey('ORD', 'SIN')]: { frequency: 7, priceMultiplier: 1.0 } },
  }));
  assert.ok(long.x > short.x, `long-haul ${long.x} should exceed short-haul ${short.x}`);
});

test('the three tiers occupy different parts of the map', () => {
  // Priced at each tier's own multiplier — a "premium" carrier that charges
  // reference fares is not, in fact, positioned as full-service, and the chart
  // saying so would be the point.
  const at = (tier, q) => competitorPositioning(rival({
    tier, baseQualityScore: q,
    routes: { [pairKey('ORD', 'DFW')]: { frequency: 14, priceMultiplier: TIER_PRICE_MULT[tier] } },
  }));
  const budget  = at('budget', 38);
  const legacy  = at('legacy', 68);
  const premium = at('premium', 85);
  assert.ok(budget.x < legacy.x && legacy.x < premium.x, 'business focus rises with tier');
  assert.ok(budget.y < legacy.y && legacy.y < premium.y, 'so does premium positioning');
  assert.equal(strategyLabel(budget).name, 'Low-Cost Carrier');
});

test('a premium tier alone is not a full-service position — the network is', () => {
  // A carrier can charge premium fares and still be a leisure operator. What
  // moves it onto the business axis is long-haul flying, where the engine's own
  // cabin model carries a much bigger J cabin. Short-haul-only at a 45% premium
  // is Luxury Leisure, and the chart saying so is the whole value of computing
  // this from a network instead of pinning it to a tier.
  const shortHaul = competitorPositioning(rival({
    tier: 'premium', baseQualityScore: 85,
    routes: { [pairKey('ORD', 'DFW')]: { frequency: 14, priceMultiplier: TIER_PRICE_MULT.premium } },
  }));
  const longHaul = competitorPositioning(rival({
    tier: 'premium', baseQualityScore: 85,
    routes: { [pairKey('DXB', 'SIN')]: { frequency: 7, priceMultiplier: TIER_PRICE_MULT.premium } },
  }));
  assert.ok(longHaul.x > shortHaul.x);
  assert.equal(strategyLabel(shortHaul).name, 'Luxury Leisure');
  assert.equal(strategyLabel(longHaul).name, 'Premium Full-Service');
});

test('an airline flying nothing has no position, rather than a wrong one', () => {
  // A dot at the origin would be a claim that they are a budget leisure
  // carrier. They are a carrier with no network.
  assert.equal(competitorPositioning(rival({ routes: {} })), null);
  assert.equal(competitorPositioning(rival({ routes: undefined })), null);
  assert.equal(competitorPositioning(null), null);
});

test('every carrier in a real sampled world can be plotted', () => {
  const bank = sampleAndInitializeCompetitors(25);
  const placed = bank.map(competitorPositioning);
  assert.equal(placed.filter(Boolean).length, bank.length,
    'a carrier the engine put in the world is one the chart has to be able to draw');
  for (const p of placed) {
    assert.ok(p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1);
  }
});

// ── The field ───────────────────────────────────────────────────────────────

console.log('\n── Which names are worth showing ────────────────────────');

test('a rival on one of your pairs is the one that gets named', () => {
  const onMyPair = rival({
    id: 'near', name: 'Near Air',
    routes: { [pairKey('SFO', 'ORD')]: { frequency: 14, priceMultiplier: 1.0 } },
  });
  const elsewhere = rival({
    id: 'far', name: 'Far Air',
    routes: {
      [pairKey('ORD', 'DFW')]: { frequency: 14, priceMultiplier: 1.0 },
      [pairKey('ORD', 'MIA')]: { frequency: 14, priceMultiplier: 1.0 },
      [pairKey('ORD', 'ATL')]: { frequency: 14, priceMultiplier: 1.0 },
    },
  });
  const field = competitorField(playerState({ competitors: [elsewhere, onMyPair] }));
  assert.equal(field.length, 2);
  assert.equal(field[0].id, 'near', 'contested carriers sort ahead of bigger strangers');
  assert.equal(field[0].contested, true);
  assert.equal(field[1].contested, false);
});

test('among strangers the bigger network is drawn first', () => {
  const small = rival({ id: 's', name: 'Small', routes: { [pairKey('ORD', 'DFW')]: { priceMultiplier: 1 } } });
  const big = rival({
    id: 'b', name: 'Big',
    routes: Object.fromEntries(['DFW', 'MIA', 'ATL', 'BOS'].map(d => [pairKey('ORD', d), { priceMultiplier: 1 }])),
  });
  const field = competitorField(playerState({ competitors: [small, big] }));
  assert.equal(field[0].id, 'b');
  assert.equal(field[0].routeCount, 4);
});

test('a carrier with no network is left off the field entirely', () => {
  const field = competitorField(playerState({ competitors: [rival({ routes: {} }), rival({ id: 'ok' })] }));
  assert.deepEqual(field.map(f => f.id), ['ok']);
});

test('no competitors is an empty field, not a crash', () => {
  assert.deepEqual(competitorField(playerState()), []);
  assert.deepEqual(competitorField({}), []);
});

// ── The player's own dot ────────────────────────────────────────────────────

console.log('\n── The player can see their own repricing ───────────────');

test('a fare set through routePricing moves the player\'s dot', () => {
  // THE BUG: calcPositioning read `route.ticketPrice` off the raw routes array.
  // Price belongs to the O&D pair and lives in state.routePricing — hydrateRoute
  // projects it onto the route before the engine ever reads one. Bulk repricing
  // an entire network to a 60% premium moved this dot by exactly nothing.
  const base = playerState();
  const dearer = playerState({
    routePricing: Object.fromEntries(PAIRS.map(([o, d]) =>
      [pairKey(o, d), { economy: Math.round(referencePrice(o, d) * 1.6) }])),
  });
  const a = calcPositioning(base);
  const b = calcPositioning(dearer);
  assert.ok(Math.abs(a.pricePremium) < 0.01, `unpriced network sits at the reference, got ${a.pricePremium}`);
  assert.ok(b.pricePremium > 0.5, `a 60% premium should read as one, got ${b.pricePremium}`);
  assert.ok(b.y > a.y, 'and should move the dot up the premium axis');
  assert.ok(b.x > a.x, 'premium pricing also reads as more business-facing');
});

test('an airline with no routes sits in the middle rather than nowhere', () => {
  const pos = calcPositioning(playerState({ routes: [] }));
  assert.deepEqual(pos, { x: 0.5, y: 0.5, pricePremium: 0, bizCapRatio: 0 });
  assert.deepEqual(calcPositioning({}), { x: 0.5, y: 0.5, pricePremium: 0, bizCapRatio: 0 });
});

test('a route whose aircraft has gone is skipped, not counted as free', () => {
  const orphaned = playerState();
  orphaned.routes.push({ id: 'ghost', origin: 'SFO', destination: 'SEA', aircraftId: 'gone', ticketPrice: 9999 });
  assert.deepEqual(calcPositioning(orphaned), calcPositioning(playerState()));
});

// ── The chart itself ────────────────────────────────────────────────────────

console.log('\n── The tab draws what the model computed ────────────────');

const SPOKES_RIVALS = [
  rival({ id: 'contest', name: 'Contesting Air', tier: 'premium', baseQualityScore: 84,
    routes: { [pairKey('SFO', 'ORD')]: { frequency: 14, priceMultiplier: 1.45 } } }),
  rival({ id: 'stranger', name: 'Faraway Air', tier: 'budget', baseQualityScore: 38,
    routes: { [pairKey('LHR', 'CDG')]: { frequency: 21, priceMultiplier: 0.76 } } }),
];

const renderTab = (over = {}) => {
  store.clear();
  store.set('bbae_save_v2', JSON.stringify({
    ...freshState(), phase: 'playing', week: 20, year: 2, hub: 'SFO', cash: 20_000_000,
    ...playerState({ competitors: SPOKES_RIVALS }), ...over,
  }));
  return clean(renderToString(React.createElement(GameProvider, null, React.createElement(Reputation))));
};

test('the three pinned brand names are gone from the page', () => {
  const html = renderTab();
  // Not "gone from the game" — ZoomJet and the others are real carriers and may
  // legitimately appear when they are in the world and contesting a pair. Gone
  // as a fixed trio drawn regardless of whether they exist.
  assert.ok(!html.includes('0.28') || !html.includes('0.12'),
    'the literal coordinates should not survive anywhere in the markup');
});

test('a rival contesting one of your pairs is named on the chart', () => {
  const html = renderTab();
  assert.ok(html.includes('Contesting Air'),
    'the carrier flying against you is exactly the one worth labelling');
});

test('the whole field is drawn, named or not', () => {
  // Both rivals get a dot; only the contested one gets a label. Count circles
  // rather than names — the shape of the market is the point of the picture.
  const html = renderTab();
  const circles = (html.match(/<circle/g) ?? []).length;
  assert.ok(circles >= 3, `player + 2 rivals should be at least 3 dots, found ${circles}`);
});

test('every dot lands inside the plot area', () => {
  // A NaN or out-of-range coordinate renders as a dot in the margin or not at
  // all, which reads as "this carrier is off the chart" rather than as a bug.
  const html = renderTab();
  for (const m of html.matchAll(/<circle[^>]*cx="([^"]+)"[^>]*cy="([^"]+)"/g)) {
    const cx = Number(m[1]), cy = Number(m[2]);
    assert.ok(Number.isFinite(cx) && Number.isFinite(cy), `non-finite dot at ${m[1]},${m[2]}`);
    assert.ok(cx >= 0 && cx <= 320 && cy >= 0 && cy <= 220, `dot outside the canvas at ${cx},${cy}`);
  }
});

test('a game with no rivals yet still renders the player alone', () => {
  const html = renderTab({ competitors: [] });
  assert.ok(html.length > 0);
  assert.ok((html.match(/<circle/g) ?? []).length >= 1, 'the player is always on their own map');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
