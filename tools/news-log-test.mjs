// Solo news log test — no browser, no save file.
//
// The news log is written by the reducer and read by the News tab, so the two
// things worth proving are that a week's report becomes the right rows, and
// that a busy world does not bury the important ones.
//
//   node --import ./tools/_register-loader.mjs tools/news-log-test.mjs

import assert from 'node:assert/strict';
import { buildWeekNews, appendNews, NEWS_LOG_CAP } from '../src/models/newsLog.js';

const store = new Map();
globalThis.window = globalThis.window ?? {};
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};

const { gameReducer, freshState } = await import('../src/store/GameContext.jsx');
const { compose } = await import('../src/components/News.jsx');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${(e.stack || e.message).split('\n').slice(0, 3).join('\n      ')}`); failed++; }
}

const week = (over = {}) => buildWeekNews({ year: 2, week: 14, absWeek: 66, ...over });

console.log('\nSolo news log\n');

// ── Building rows ────────────────────────────────────────────────────────────
test('world events open and close as headlines', () => {
  const rows = week({
    newEvents: [{ id: 'e1', name: 'Fuel Price Spike', icon: '⛽', resolvedDesc: 'Fuel up 23%.' }],
    expiredEvents: [{ id: 'e0', name: 'Regional Recession', icon: '📉' }],
  });
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.tier === 1 && r.category === 'world'));
  assert.equal(rows[0].data.description, 'Fuel up 23%.');
});

test('a busy market week is ONE line, not five', () => {
  const launches = ['Ibero Air', 'Fjord Low', 'Dragon East', 'Pampa Low', 'NaijaJet']
    .map((name, i) => ({
      type: 'launch', airlineId: `c${i}`, name, routeKey: `AA${i}-BB${i}`,
      description: `${name} launched new service on AA${i} → BB${i}.`,
    }));
  const rows = week({ competitorEvents: launches });
  assert.equal(rows.length, 1, 'five launches from five carriers roll into one item');
  assert.equal(rows[0].data.total, 5);
  assert.equal(rows[0].data.entries.length, 5, 'the detail survives');
  assert.equal(rows[0].data.routes.length, 5, 'route keys are exposed for the network filter');
});

test('a lone launch keeps the simulation\'s own wording', () => {
  const rows = week({
    competitorEvents: [{
      type: 'launch', airlineId: 'c1', name: 'Ibero Air', routeKey: 'BCN-LHR',
      description: 'Ibero Air launched new service on BCN → LHR.',
    }],
  });
  assert.equal(rows[0].data.total, 1);
  assert.equal(rows[0].subject, 'Ibero Air');
  assert.equal(rows[0].data.description, 'Ibero Air launched new service on BCN → LHR.');
});

test('rare competitor events are never rolled away', () => {
  const rows = week({
    competitorEvents: [
      { type: 'bankrupt', airlineId: 'c1', name: 'Alpha', description: 'Alpha has failed.' },
      { type: 'merger', airlineId: 'c2', name: 'Beta', description: 'Beta merged.' },
      { type: 'fareWar', airlineId: 'c3', name: 'Gamma', routeKey: 'A-B', description: 'Gamma started a fare war.' },
    ],
  });
  assert.equal(rows.length, 3, 'each stands alone');
  assert.ok(rows.every((r) => r.tier === 1), 'and each is headline news');
});

test('a fleet intake is one row, summed by type', () => {
  const rows = week({
    deliveries: [
      { name: 'A320neo #1', typeId: 'a319neo' }, { name: 'A320neo #2', typeId: 'a319neo' },
      { name: 'B789 #1', typeId: 'b789' },
    ],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].data.total, 3);
  assert.equal(rows[0].data.byType.a319neo, 2);
  assert.equal(rows[0].tier, 2, 'three aircraft is ordinary');
  const big = week({ deliveries: Array.from({ length: 5 }, () => ({ name: 'x', typeId: 'a319neo' })) });
  assert.equal(big[0].tier, 1, 'five at once is not');
});

test('an unplanned grounding outranks a completed check', () => {
  const rows = week({
    checksForced: [{ name: 'A320 #3', checkType: 'C' }],
    checksCompleted: [{ name: 'A320 #1', checkType: 'C' }],
  });
  const forced = rows.find((r) => r.kind === 'check_forced');
  const done = rows.find((r) => r.kind === 'check_completed');
  assert.equal(forced.tier, 1);
  assert.equal(done.tier, 2);
});

test('objectives and record weeks are company milestones', () => {
  const rows = week({
    completedObjectives: [{ id: 'o1', title: 'First Million', reward: 500_000, icon: '🏅' }],
    profit: 900_000, bestProfitBefore: 400_000,
  });
  assert.equal(rows.filter((r) => r.category === 'company').length, 2);
  const rec = rows.find((r) => r.kind === 'record_week');
  assert.equal(rec.data.profit, 900_000);
});

test('"best loss yet" is not a record', () => {
  const rows = week({ profit: -50_000, bestProfitBefore: -900_000 });
  assert.equal(rows.filter((r) => r.kind === 'record_week').length, 0);
});

test('ids are deterministic — no wall clock in the reducer', () => {
  const a = week({ newEvents: [{ id: 'e1', name: 'X' }] });
  const b = week({ newEvents: [{ id: 'e1', name: 'X' }] });
  assert.deepEqual(a, b, 'the same report must always produce the same rows');
  assert.equal(a[0].id, 'w66-0');
  assert.ok(!('at' in a[0]) && !('timestamp' in a[0]), 'no timestamp field exists to drift');
});

// ── The log itself ───────────────────────────────────────────────────────────
test('the log is capped and keeps the NEWEST items', () => {
  let log = [];
  for (let w = 1; w <= NEWS_LOG_CAP + 40; w++) {
    log = appendNews(log, buildWeekNews({
      year: 1, week: w, absWeek: w,
      newEvents: [{ id: `e${w}`, name: `Event ${w}` }],
    }));
  }
  assert.equal(log.length, NEWS_LOG_CAP);
  assert.equal(log[log.length - 1].data.eventId, `e${NEWS_LOG_CAP + 40}`, 'newest kept');
  assert.equal(log[0].data.eventId, `e41`, 'oldest trimmed');
});

test('an empty week does not touch the log', () => {
  const log = [{ id: 'x' }];
  assert.equal(appendNews(log, []), log);
});

// ── End to end through the real reducer ──────────────────────────────────────
test('a real game accumulates news, and stays deterministic in shape', () => {
  let s = gameReducer(freshState(), { type: 'START_GAME', airlineName: 'Test Air', hub: 'SFO' });
  assert.deepEqual(s.newsLog, [], 'a new game starts with an empty log');
  for (let i = 0; i < 12; i++) s = gameReducer(s, { type: 'ADVANCE_WEEK' });
  assert.ok(s.newsLog.length > 0, 'twelve weeks produce news');
  assert.ok(s.newsLog.length < 60, `twelve weeks should not produce a wall of items (got ${s.newsLog.length})`);
  for (const it of s.newsLog) {
    assert.ok(it.id && it.category && it.kind, 'every row is well formed');
    assert.ok(Number.isInteger(it.absWeek) && Number.isInteger(it.tier));
  }
  // Oldest-first storage, so the tab can reverse for display.
  const weeks = s.newsLog.map((i) => i.absWeek);
  assert.deepEqual(weeks, [...weeks].sort((a, b) => a - b), 'log stays in week order');
});

test('a save from before this feature loads without a log', () => {
  let s = gameReducer(freshState(), { type: 'START_GAME', airlineName: 'Legacy Air', hub: 'JFK' });
  delete s.newsLog;                       // what an old save looks like
  s = gameReducer(s, { type: 'ADVANCE_WEEK' });
  assert.ok(Array.isArray(s.newsLog), 'the log is created rather than crashing');
});

// ── Wording ──────────────────────────────────────────────────────────────────
test('every kind composes a real sentence', () => {
  const cases = [
    ['event_started', { description: 'Fuel up 23%.' }],
    ['event_ended', {}],
    ['delivery_arrived', { total: 2, byType: { a319neo: 2 }, names: ['A319neo #1'] }],
    ['check_forced', { total: 1, checkTypes: ['C'], names: ['A320 #3'] }],
    ['check_completed', { total: 1, checkTypes: ['D'], names: ['A320 #1'] }],
    ['mechanical_failure', { label: 'Hydraulic fault', weeksGrounded: 2, tailNumber: 'N123TW' }],
    ['objective_complete', { title: 'First Million', reward: 500_000 }],
    ['record_week', { profit: 900_000, previousBest: 400_000 }],
    ['competitor_launch', { total: 5, verb: 'launched', entries: [{ airline: 'Ibero Air', routeKey: 'BCN-LHR' }] }],
    ['competitor_bankrupt', { description: 'Alpha has failed.' }],
  ];
  for (const [kind, data] of cases) {
    const c = compose({ kind, subject: 'Test', data });
    const text = `${c.headline ?? ''} ${c.sub ?? ''}`.trim();
    assert.ok(text.length > 0, `${kind} composed nothing`);
    assert.notEqual(c.headline, kind, `${kind} fell through to the raw kind name`);
  }
  // The rolled-up market week must say how many, and offer the list.
  const rolled = compose({
    kind: 'competitor_launch', subject: null,
    data: { total: 5, verb: 'launched', entries: [{ airline: 'Ibero Air', routeKey: 'BCN-LHR' }] },
  });
  assert.match(rolled.headline, /5 routes launched across the market/);
  assert.equal(rolled.list.length, 1);
  assert.match(rolled.list[0], /Ibero Air · BCN–LHR/);
});

test('aircraft are named, never printed as type ids', () => {
  const c = compose({ kind: 'delivery_arrived', data: { total: 1, byType: { a319neo: 1 }, names: [] } });
  assert.match(c.headline, /Airbus A319neo/, `expected the display name, got: ${c.headline}`);
  assert.ok(!c.headline.includes('a319neo'), `raw typeId leaked: ${c.headline}`);
  // An id the aircraft table no longer knows must degrade to the id, not crash.
  const gone = compose({ kind: 'delivery_arrived', data: { total: 1, byType: { retired_type: 1 }, names: [] } });
  assert.match(gone.headline, /retired_type/);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
