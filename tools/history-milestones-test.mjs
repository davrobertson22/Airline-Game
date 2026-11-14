// Aviation history milestones in era games (Discord, VodkaOnFire, 2026-11-13,
// "Create a living world"; Dave chose milestones first, no accidents).
//
// Covers:
//   1. the data: unique ids, real dates, aircraft entries only on a type's
//      entry-into-service year (so no card announces a type the market lacks),
//      feature entries only once the feature is live, a source on every entry;
//   2. dates map to the game week whose month matches (simulation.js);
//   3. rows: per week, through a date, era card, launch-customer line, classic
//      games get nothing;
//   4. the All / Major only / Off setting and its storage;
//   5. when the card pops up (an ordinary week, a new game; never a jump);
//   6. the News tab merges history rows and renders them, era games only.
//
//   node --import ./tools/_register-loader.mjs tools/history-milestones-test.mjs

import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'react-dom/server';

const store = new Map();
globalThis.window = globalThis.window ?? {};
globalThis.window.addEventListener = globalThis.window.addEventListener ?? (() => {});
globalThis.window.removeEventListener = globalThis.window.removeEventListener ?? (() => {});
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${(e.stack || e.message).split('\n').slice(0, 5).join('\n      ')}`); failed++; }
}

const H = await import('../src/data/historyMilestones.js');
const P = await import('../src/utils/historyPrefs.js');
const { getAircraftType } = await import('../src/data/aircraft.js');
const { ERA_FEATURE_FROM, featureLive } = await import('../src/data/eraFeatures.js');
const { weekToGameDate } = await import('../src/utils/simulation.js');
const HC = await import('../src/components/HistoryCard.jsx');
const { historyWeekToShow } = HC;
const News = await import('../src/components/News.jsx');
const { GameContext } = await import('../src/store/GameContext.jsx');

console.log('\nAviation history milestones\n');
console.log('── 1. Data ──');

test('ids are unique across milestones and era cards', () => {
  const ids = [...H.MILESTONES.map(m => m.id), ...H.ERA_INTROS.map(e => e.id)];
  assert.equal(new Set(ids).size, ids.length);
});

test('every date is a real calendar date', () => {
  for (const m of H.MILESTONES) {
    assert.match(m.date, /^\d{4}-\d{2}-\d{2}$/, m.id);
    const d = new Date(`${m.date}T00:00:00Z`);
    assert.equal(d.toISOString().slice(0, 10), m.date, m.id);
  }
});

test('milestones are in date order', () => {
  const dates = H.MILESTONES.map(m => m.date);
  assert.deepEqual(dates, [...dates].sort());
});

test('aircraft entries name a type that enters service that year', () => {
  for (const m of H.MILESTONES.filter(x => x.kind === 'aircraft')) {
    const t = getAircraftType(m.typeId);
    assert.ok(t, `${m.id}: no aircraft ${m.typeId}`);
    assert.equal(t.eis, Number(m.date.slice(0, 4)), `${m.id}: ${m.typeId} eis ${t.eis}`);
  }
});

test('feature entries name a feature that is live that year', () => {
  for (const m of H.MILESTONES.filter(x => x.kind === 'feature')) {
    assert.ok(m.feature in ERA_FEATURE_FROM, `${m.id}: unknown feature ${m.feature}`);
    assert.ok(featureLive(m.feature, Number(m.date.slice(0, 4))), `${m.id}: ${m.feature} not live yet`);
  }
});

test('every entry has a title, a body, a source and a valid tier', () => {
  for (const m of H.MILESTONES) {
    assert.ok(m.title && m.body, m.id);
    assert.ok(Array.isArray(m.sources) && m.sources.length > 0 && m.sources.every(s => /^https:\/\//.test(s)), m.id);
    assert.ok(['major', 'minor'].includes(m.tier), m.id);
    assert.ok(['aircraft', 'industry', 'feature'].includes(m.kind), m.id);
  }
});

test('no accidents: the first set is milestones only', () => {
  for (const m of H.MILESTONES) assert.doesNotMatch(`${m.title} ${m.body}`, /\b(crash|killed|fatal|disaster)\b/i, m.id);
});

test('era cards cover every legal start year without overlap', () => {
  for (let y = 1950; y <= 2050; y++) {
    const hits = H.ERA_INTROS.filter(e => y >= e.from && y <= e.to);
    assert.equal(hits.length, 1, `start ${y}`);
  }
  assert.equal(H.eraIntroFor(null), null);
});

console.log('\n── 2. Dates to game weeks ──');

test('every day lands in a week of its own month', () => {
  const days = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  for (let m = 1; m <= 12; m++) for (let d = 1; d <= days[m - 1]; d++) {
    const w = H.gameWeekOfDate(m, d);
    assert.ok(w >= 1 && w <= 52);
    assert.equal(weekToGameDate(w).monthIndex, m, `${m}/${d} → week ${w}`);
  }
});

test('the first and last of a month are its first and last weeks', () => {
  assert.equal(H.gameWeekOfDate(1, 1), 1);
  assert.equal(H.gameWeekOfDate(12, 31), 52);
  assert.equal(H.gameWeekOfDate(2, 1), 6);
  assert.equal(H.gameWeekOfDate(1, 31), 5);
});

test('date labels: full date, or the entry\'s month-only label', () => {
  assert.equal(H.milestoneDateLabel({ date: '1952-05-02' }), '2 May 1952');
  assert.equal(H.milestoneDateLabel({ date: '1988-04-08', dateLabel: 'April 1988' }), 'April 1988');
});

console.log('\n── 3. Rows ──');

const b707 = H.MILESTONES.find(m => m.id === 'b707-service');
const b707w = H.milestoneGameWeek(b707);

test('a week with a milestone returns its row, in News shape', () => {
  const rows = H.historyRowsForWeek({ startYear: 1958, year: 1, week: b707w.week });
  const r = rows.find(x => x.id === 'hist-b707-service');
  assert.ok(r);
  assert.equal(r.category, 'history');
  assert.equal(r.kind, 'history_milestone');
  assert.equal(r.tier, 1);
  assert.equal(r.absWeek, b707w.week);
  assert.equal(r.data.dateLabel, '26 October 1958');
});

test('week 1 of year 1 carries the era card', () => {
  const rows = H.historyRowsForWeek({ startYear: 1983, year: 1, week: 1 });
  assert.deepEqual(rows.map(r => r.id), ['hist-era-competition', 'hist-b757-service']);
  assert.equal(rows[0].kind, 'history_era');
  assert.equal(H.historyRowsForWeek({ startYear: 1983, year: 2, week: 1 }).length, 0);
});

test('a later year maps to the right calendar year', () => {
  const rows = H.historyRowsForWeek({ startYear: 1950, year: 9, week: b707w.week });
  assert.ok(rows.some(r => r.id === 'hist-b707-service'));
});

test('launch customers get their line and a major-tier row', () => {
  const minor = H.MILESTONES.find(m => m.id === 'b727-service');
  const w = H.milestoneGameWeek(minor).week;
  const plain = H.historyRowsForWeek({ startYear: 1964, year: 1, week: w })[0];
  assert.equal(plain.tier, 2);
  assert.equal(plain.data.launchCustomer, false);
  const mine = H.historyRowsForWeek({ startYear: 1964, year: 1, week: w, launchPrograms: { b727100: { frames: 4 } } })[0];
  assert.equal(mine.tier, 1);
  assert.equal(mine.data.launchCustomer, true);
});

test('through a date: era card first, nothing before the start or after now', () => {
  const rows = H.historyRowsThrough({ startYear: 1958, year: 13, week: 4 });   // January 1970
  assert.equal(rows[0].id, 'hist-era-jets');
  assert.ok(rows.some(r => r.id === 'hist-b707-service'));
  assert.ok(rows.some(r => r.id === 'hist-b747-service'));                     // 1970 week 4
  assert.ok(!rows.some(r => r.id === 'hist-comet1-service'));                  // before the start
  assert.ok(!rows.some(r => r.id === 'hist-southwest-takeoff'));               // not yet
  for (let i = 1; i < rows.length; i++) assert.ok(rows[i].absWeek >= rows[i - 1].absWeek);
});

test('classic games get no history at all', () => {
  assert.deepEqual(H.historyRowsForWeek({ startYear: null, year: 3, week: 10 }), []);
  assert.deepEqual(H.historyRowsThrough({ startYear: null, year: 3, week: 10 }), []);
});

test('a full 1950 run fires every milestone exactly once', () => {
  const seen = new Map();
  for (let y = 1; y <= 101; y++) for (let w = 1; w <= 52; w++)
    for (const r of H.historyRowsForWeek({ startYear: 1950, year: y, week: w })) seen.set(r.id, (seen.get(r.id) ?? 0) + 1);
  for (const m of H.MILESTONES) assert.equal(seen.get(`hist-${m.id}`), 1, m.id);
});

console.log('\n── 4. Setting ──');

test('All, Major only and Off filter as named', () => {
  const major = { tier: 1 }, minor = { tier: 2 };
  assert.equal(H.historyRowPopsUp(major, 'all'), true);
  assert.equal(H.historyRowPopsUp(minor, 'all'), true);
  assert.equal(H.historyRowPopsUp(major, 'major'), true);
  assert.equal(H.historyRowPopsUp(minor, 'major'), false);
  assert.equal(H.historyRowPopsUp(major, 'off'), false);
});

test('the setting defaults to All, saves, survives junk and notifies', () => {
  store.clear();
  assert.equal(P.loadHistoryMode(), 'all');
  let heard = null;
  const off = P.subscribeHistoryMode(m => { heard = m; });
  assert.equal(P.saveHistoryMode('major'), 'major');
  assert.equal(heard, 'major');
  assert.equal(P.loadHistoryMode(), 'major');
  off();
  store.set(P.HISTORY_PREFS_KEY, 'loud');
  assert.equal(P.loadHistoryMode(), 'all');
  assert.deepEqual(P.HISTORY_MODES.map(m => m.id), ['all', 'major', 'off']);
});

test('about one pop-up every two years under All, far fewer under Major', () => {
  const span = 2050 - 1950 + 1;
  const all = H.MILESTONES.length + 1;
  const major = H.MILESTONES.filter(m => m.tier === 'major').length + 1;
  assert.ok(span / all >= 2.5, `${all} cards in ${span} years`);
  assert.ok(major <= 10, `${major} major cards`);
});

console.log('\n── 5. When the card pops up ──');

test('an ordinary week pops; a jump does not; a new game shows its era card', () => {
  assert.equal(historyWeekToShow(40, 41), 41);
  assert.equal(historyWeekToShow(40, 45), null);       // reload / away: News tab only
  assert.equal(historyWeekToShow(null, 300), null);    // opened a save mid-game
  assert.equal(historyWeekToShow(null, 1), 1);         // opened a brand-new game
  assert.equal(historyWeekToShow(300, 1), 1);          // started a new game in this tab
  assert.equal(historyWeekToShow(1, 1), null);         // a re-render on week 1
});

function renderCard(state, queue) {
  const value = { state, dispatch: () => {} };
  return renderToString(React.createElement(GameContext.Provider, { value }, React.createElement(HC.default, { initialQueue: queue })))
    .replace(/<!-- -->/g, '');
}
const eraState = { startYear: 1964, year: 1, week: 20, phase: 'playing', showDebrief: false };
const cardRows = (launch) => H.historyRowsForWeek({ startYear: 1964, year: 1, week: H.milestoneGameWeek(H.MILESTONES.find(m => m.id === 'b727-service')).week, launchPrograms: launch });

test('the card shows date, title, body, setting and Close', () => {
  const html = renderCard(eraState, cardRows());
  assert.match(html, /Aviation history · 1 February 1964/);
  assert.match(html, /The 727 enters service/);
  assert.match(html, /Eastern Air Lines flew the first Boeing 727/);
  assert.match(html, /History pop-ups:/);
  assert.match(html, />All</); assert.match(html, />Major only</); assert.match(html, />Off</);
  assert.match(html, />Close</);
  assert.doesNotMatch(html, /launch customers/);
});

test('a launch customer sees its line; a queue offers Next', () => {
  const rows = cardRows({ b727100: { frames: 6 } });
  const html = renderCard(eraState, [...rows, ...H.historyRowsForWeek({ startYear: 1964, year: 1, week: 1 })]);
  assert.match(html, /Your airline is one of its launch customers/);
  assert.match(html, /Next \(1 more\)/);
});

test('the card waits for the debrief, and stays out of classic games', () => {
  assert.equal(renderCard({ ...eraState, showDebrief: true }, cardRows()), '');
  assert.equal(renderCard({ ...eraState, startYear: null }, cardRows()), '');
  assert.equal(renderCard(eraState, []), '');
});

console.log('\n── 6. News tab ──');

test('history merges in by week, after that week\'s own rows', () => {
  const log = [{ id: 'a', absWeek: 1 }, { id: 'b', absWeek: 5 }, { id: 'c', absWeek: 9 }];
  const hist = [{ id: 'h1', absWeek: 1 }, { id: 'h5', absWeek: 5 }, { id: 'h7', absWeek: 7 }, { id: 'h12', absWeek: 12 }];
  assert.deepEqual(News.mergeHistory(log, hist).map(r => r.id), ['a', 'h1', 'b', 'h5', 'h7', 'c', 'h12']);
  assert.equal(News.mergeHistory(log, []), log);
});

test('compose reads a history row: date as headline, body and extras below', () => {
  const r = H.historyRowsForWeek({ startYear: 1997, year: 1, week: H.milestoneGameWeek(H.MILESTONES.find(m => m.id === 'star-alliance')).week })[0];
  const c = News.compose(r);
  assert.equal(c.headline, '· 14 May 1997');
  assert.match(c.sub, /first global airline alliance/);
  assert.match(c.sub, /Alliances page/);
});

function renderNews(state) {
  const value = { state, dispatch: () => {} };
  return renderToString(React.createElement(GameContext.Provider, { value }, React.createElement(News.default)))
    .replace(/<!-- -->/g, '');
}

test('an era game shows History rows and the pop-up setting', () => {
  const html = renderNews({ startYear: 1958, year: 1, week: 50, newsLog: [], routes: [], cargoRoutes: [], hubs: {}, gates: {} });
  assert.match(html, /History pop-ups:/);
  assert.match(html, /The Boeing 707 enters service/);
  assert.match(html, /Welcome to the dawn of the jets/);
  assert.match(html, /🕰 History/);
});

test('a classic game shows neither', () => {
  const html = renderNews({ startYear: null, year: 3, week: 10, newsLog: [], routes: [], cargoRoutes: [], hubs: {}, gates: {} });
  assert.doesNotMatch(html, /History pop-ups/);
  assert.doesNotMatch(html, /🕰 History/);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
