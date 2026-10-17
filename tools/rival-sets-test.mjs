// Custom rival sets (Tailwinds): a pasted, shareable set of AI rivals at setup,
// era rivals that are founded in their own year, "no random startups", "no rival
// based at my hub", and copying a running game's field back out.
//
// Design: models/rivalSets.js header (Discord feature request, decisions
// 2026-10-17: founding years count in era games only; size small/medium/large,
// not money; the player chooses replace or add).
//
//   node --import ./tools/_register-loader.mjs tools/rival-sets-test.mjs
import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'react-dom/server';

const store = new Map();
globalThis.window = globalThis.window ?? {};
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};

let passed = 0, failed = 0;
function test(name, fn) {
  try {
    const out = fn();
    if (out && typeof out.then === 'function') throw new Error('test bodies must be synchronous');
    console.log(`  ✓ ${name}`); passed++;
  } catch (e) { console.log(`  ✗ ${name}\n      ${(e.stack || e.message).split('\n').slice(0, 6).join('\n      ')}`); failed++; }
}
function section(t) { console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 66 - t.length))}`); }

const { gameReducer, freshState, GameProvider } = await import('../src/store/GameContext.jsx');
const RS = await import('../src/models/rivalSets.js').catch(() => null);
const AI = await import('../src/models/competitorAI.js');
const { AIRLINE_LOGOS } = await import('../src/components/AirlineLogo.jsx');
const Competition = (await import('../src/components/Competition.jsx')).default;
const SetupScreen = (await import('../src/components/SetupScreen.jsx')).default;
const need = () => assert.ok(RS, 'src/models/rivalSets.js does not exist');

function seeded(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function withSeed(seed, fn) { const real = Math.random; Math.random = seeded(seed); try { return fn(); } finally { Math.random = real; } }
const start = (extra = {}) => gameReducer(freshState(), { type: 'START_GAME', airlineName: 'Mine', hub: 'ORD', ...extra });
const set = (rivals, extra = {}) => ({ tailwindsRivals: 1, name: 'Test set', rivals, ...extra });
const R = (name, hub, tier, extra = {}) => ({ name, hub, tier, ...extra });

section('the format');

test('a good set parses, with defaults filled in', () => {
  need();
  const p = RS.parseRivalSet(JSON.stringify(set([R('Alpha Air', 'lhr', 'Legacy'), R('Beta Jet', 'AMS', 'budget', { size: 'small', logo: 'bolt', style: 'aggressive', quality: 41, founded: 1980 })])));
  assert.equal(p.ok, true, p.errors.join('; '));
  assert.deepEqual(p.set.rivals[0], { name: 'Alpha Air', hub: 'LHR', tier: 'legacy', size: 'medium', founded: null, logo: p.set.rivals[0].logo, style: null, quality: null });
  assert.ok(RS.RIVAL_LOGOS.includes(p.set.rivals[0].logo), 'a logo is picked');
  assert.deepEqual(p.set.rivals[1], { name: 'Beta Jet', hub: 'AMS', tier: 'budget', size: 'small', founded: 1980, logo: 'bolt', style: 'aggressive', quality: 41 });
  assert.equal(p.warnings.length, 0);
});

test('a broken set is refused with a reason a player can act on', () => {
  need();
  const errs = (x) => RS.parseRivalSet(x).errors.join(' | ');
  assert.match(errs('{ "rivals": [ }'), /not valid JSON/);
  assert.match(errs(''), /empty/);
  assert.match(errs(JSON.stringify({ rivals: [R('A', 'LHR', 'legacy')] })), /tailwindsRivals/);
  assert.match(errs(JSON.stringify(set([]))), /empty/);
  assert.match(errs(JSON.stringify(set([R('A', 'XXQ', 'legacy')]))), /not an airport code/);
  assert.match(errs(JSON.stringify(set([R('A', 'LHR', 'luxury')]))), /tier must be/);
  assert.match(errs(JSON.stringify(set([R('A', 'LHR', 'legacy'), R('a', 'JFK', 'budget')]))), /share this name/);
  assert.match(errs(JSON.stringify(set([R('', 'LHR', 'legacy')]))), /no name/);
  assert.match(errs(JSON.stringify(set(Array.from({ length: 121 }, (_, i) => R(`Air ${i}`, 'LHR', 'legacy'))))), /at most 120/);
  assert.equal(RS.parseRivalSet('[]').ok, false);
});

test('small mistakes are defaulted with a warning, not refused', () => {
  need();
  const p = RS.parseRivalSet(set([R('A', 'LHR', 'legacy', { size: 'huge', logo: 'swoosh', style: 'sneaky', founded: 'soon', quality: 400 })]));
  assert.equal(p.ok, true);
  assert.equal(p.warnings.length, 4);
  assert.equal(p.set.rivals[0].size, 'medium');
  assert.equal(p.set.rivals[0].quality, 95, 'quality clamped');
});

test("the format's style and logo lists match the game's", () => {
  need();
  assert.deepEqual([...RS.RIVAL_STYLES].sort(), Object.keys(AI.ARCHETYPES).sort());
  assert.deepEqual([...RS.RIVAL_LOGOS].sort(), AIRLINE_LOGOS.map(l => l.id).sort());
});

test('classic games start everyone; era games hold back rivals founded later', () => {
  need();
  const p = RS.parseRivalSet(set([R('A', 'LHR', 'legacy', { founded: 1950 }), R('B', 'JFK', 'legacy', { founded: 1990 }), R('C', 'ORD', 'budget', { founded: 1972 })])).set;
  assert.equal(RS.splitRivalSet(p, null).starters.length, 3);
  const era = RS.splitRivalSet(p, 1970);
  assert.deepEqual(era.starters.map(r => r.name), ['A']);
  assert.deepEqual(era.entrants.map(r => r.name), ['C', 'B'], 'earliest first');
  const big = RS.parseRivalSet(set(Array.from({ length: 70 }, (_, i) => R(`Air ${i}`, 'LHR', 'legacy')))).set;
  assert.equal(RS.splitRivalSet(big, null).starters.length, RS.RIVAL_SET_MAX_START);
  assert.equal(RS.splitRivalSet(big, null).dropped, 10);
});

section('starting a game with a set');

test('"only these rivals": the field is exactly the set', () => {
  const s = withSeed(1, () => start({ rivalSet: set([R('Alpha Air', 'LHR', 'legacy'), R('Beta Jet', 'AMS', 'budget')]), rivalMode: 'replace' }));
  assert.deepEqual(s.competitors.map(c => c.name).sort(), ['Alpha Air', 'Beta Jet']);
  assert.equal(s.rivalSetName, 'Test set');
  assert.ok(s.competitors.every(c => Object.keys(c.routes).length >= 3 && c.fleet.length > 0), 'each has a starter network and fleet');
});

test('size sets cash and network: small < medium < large', () => {
  const s = withSeed(2, () => start({ rivalSet: set(['small', 'medium', 'large'].map(size => R(`${size} air`, 'FRA', 'legacy', { size }))), rivalMode: 'replace' }));
  const by = Object.fromEntries(s.competitors.map(c => [c.name, c]));
  assert.ok(by['small air'].cash < by['medium air'].cash && by['medium air'].cash < by['large air'].cash);
  const routes = (n) => Object.keys(by[n].routes).length;
  assert.ok(routes('small air') < routes('medium air') && routes('medium air') < routes('large air'), `${routes('small air')} / ${routes('medium air')} / ${routes('large air')}`);
});

test('style, quality and logo are kept as written', () => {
  const s = withSeed(3, () => start({ rivalSet: set([R('Gamma', 'SIN', 'premium', { style: 'niche', quality: 90, logo: 'crown' })]) }));
  const c = s.competitors[0];
  assert.equal(c._archetype, 'niche');
  assert.equal(c.baseQualityScore, 90);
  assert.equal(c.logoId, 'crown');
});

test('"these plus the random field": the set joins the usual rivals, no duplicate names', () => {
  const s = withSeed(4, () => start({ rivalSet: set([R('Global Air', 'LHR', 'legacy'), R('Delta Prime', 'ATL', 'legacy')]), rivalMode: 'add' }));
  assert.ok(s.competitors.length > 20);
  assert.equal(s.competitors.filter(c => c.name === 'Global Air').length, 1);
  assert.ok(s.competitors.some(c => c.name === 'Delta Prime' && c.fromSet));
});

test('a set with errors is ignored and the game gets the random field', () => {
  const s = withSeed(5, () => start({ rivalSet: set([R('A', 'NOPE', 'legacy')]) }));
  assert.ok(s.competitors.length > 20);
  assert.equal(s.rivalSetName, undefined);
});

test('no set and no options: the game starts exactly as before', () => {
  const s = withSeed(6, () => start());
  assert.ok(s.competitors.length > 20);
  for (const k of ['rivalSetName', 'rivalEntrants', 'rivalRosterCap', 'noRandomStartups', 'emptyHubStart']) assert.equal(s[k], undefined, k);
});

section('no rival based at my hub');

test('the random field loses any rival based at your hub', () => {
  let removed = 0;
  for (const [hub, seed] of [['LHR', 7], ['ORD', 8], ['DXB', 9]]) {
    const ctrl = withSeed(seed, () => gameReducer(freshState(), { type: 'START_GAME', airlineName: 'Mine', hub }));
    const s = withSeed(seed, () => gameReducer(freshState(), { type: 'START_GAME', airlineName: 'Mine', hub, emptyHub: true }));
    assert.ok(!s.competitors.some(c => c.homeHub === hub), hub);
    const based = ctrl.competitors.filter(c => c.homeHub === hub).length;
    removed += based;
    assert.equal(s.competitors.length, ctrl.competitors.length - based);
  }
  assert.ok(removed > 0, 'some rival was based at one of these hubs');
});

test('…and so does a custom set', () => {
  const s = withSeed(10, () => start({ rivalSet: set([R('Home Rival', 'ORD', 'legacy'), R('Away', 'LHR', 'legacy')]), emptyHub: true }));
  assert.deepEqual(s.competitors.map(c => c.name), ['Away']);
});

section('era games: rivals founded in their own year');

const eraSet = set([
  R('Founder Air', 'LHR', 'legacy', { founded: 1960 }),
  R('Seventies Jet', 'AMS', 'budget', { founded: 1972 }),
  R('Eighties Air', 'JFK', 'premium', { founded: 1981 }),
]);

test('a rival founded after the start year waits, then appears in its year', () => {
  let s = withSeed(11, () => start({ startYear: 1970, rivalSet: eraSet, rivalMode: 'replace' }));
  assert.deepEqual(s.competitors.map(c => c.name), ['Founder Air']);
  assert.deepEqual(s.rivalEntrants.map(r => r.name), ['Seventies Jet', 'Eighties Air']);
  const seenAt = {};
  withSeed(12, () => {
    for (let w = 0; w < 52 * 4; w++) {
      s = gameReducer(s, { type: 'ADVANCE_WEEK' });
      for (const c of s.competitors) seenAt[c.name] ??= 1969 + s.year;
    }
  });
  assert.equal(seenAt['Seventies Jet'], 1972);
  assert.equal(seenAt['Eighties Air'], undefined, 'not before 1981');
  assert.deepEqual(s.rivalEntrants.map(r => r.name), ['Eighties Air']);
});

test('a full field makes an entrant wait, and it joins once there is room', () => {
  need();
  const spec = RS.parseRivalSet(set([R('Late Air', 'MIA', 'budget', { founded: 1975 })])).set.rivals[0];
  const field = Array.from({ length: 30 }, (_, i) => ({ id: `f${i}`, name: `F${i}`, homeHub: 'LHR', tier: 'legacy', cash: 5e7, routes: {}, fleet: [], baseQualityScore: 60, _archetype: 'balanced' }));
  const full = withSeed(13, () => AI.tickCompetitorAI(field, { weekNumber: 200, calendarYear: 1976, entrants: [spec], rosterCap: 30 }));
  assert.equal(full.entrants.length, 1, 'waits while the field is full');
  assert.ok(!full.competitors.some(c => c.name === 'Late Air'));
  const room = withSeed(13, () => AI.tickCompetitorAI(field.slice(0, 25), { weekNumber: 200, calendarYear: 1976, entrants: [spec], rosterCap: 30 }));
  assert.equal(room.entrants.length, 0);
  assert.ok(room.competitors.some(c => c.name === 'Late Air' && c.homeHub === 'MIA'));
  assert.ok(room.events.some(e => e.type === 'startup' && /Late Air has been founded/.test(e.description)));
});

test('classic games ignore founding years: everyone starts on day one', () => {
  const s = withSeed(14, () => start({ rivalSet: eraSet }));
  assert.equal(s.competitors.length, 3);
  assert.equal(s.rivalEntrants.length, 0);
});

section('no random new airlines');

test('with the option on, only a set\'s own entrants ever join', () => {
  const run = (opts) => withSeed(21, () => {
    let s = start(opts);
    let startups = 0;
    for (let w = 0; w < 52 * 3; w++) {
      s = gameReducer(s, { type: 'ADVANCE_WEEK' });
      startups += (s.lastReport?.competitorEvents ?? []).filter(e => e.type === 'startup').length;
    }
    return startups;
  });
  assert.ok(run({}) > 0, 'the control run sees random startups');
  assert.equal(run({ noRandomStartups: true }), 0);
});

section('sharing a field');

test('a running game exports as a set that parses back to the same field', () => {
  need();
  const s = withSeed(31, () => start({ startYear: 1970, rivalSet: eraSet }));
  const text = RS.exportRivalSet({ competitors: s.competitors, entrants: s.rivalEntrants, name: s.rivalSetName, startYear: s.startYear });
  const back = RS.parseRivalSet(text);
  assert.equal(back.ok, true, back.errors.join('; '));
  assert.deepEqual(back.set.rivals.map(r => r.name), ['Founder Air', 'Seventies Jet', 'Eighties Air']);
  assert.deepEqual(back.set.rivals.map(r => r.founded), [1960, 1972, 1981]);
  const random = withSeed(32, () => start());
  const r2 = RS.parseRivalSet(RS.exportRivalSet({ competitors: random.competitors }));
  assert.equal(r2.ok, true, r2.errors.join('; '));
  assert.equal(r2.set.rivals.length, random.competitors.length);
});

test('the example set parses, and its entrant only waits in an era game', () => {
  need();
  assert.equal(RS.parseRivalSet(RS.exampleRivalSet()).ok, true);
  const era = RS.parseRivalSet(RS.exampleRivalSet(1990));
  assert.equal(era.ok, true);
  assert.equal(RS.splitRivalSet(era.set, 1990).entrants.length, 1);
});

section('screens');

const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');

test('the Competition screen offers the field as a set to copy', () => {
  const s = withSeed(41, () => start({ startYear: 1970, rivalSet: eraSet }));
  store.set('bbae_save_v2', JSON.stringify(s));
  const html = text(renderToString(React.createElement(GameProvider, null, React.createElement(Competition))));
  assert.match(html, /Share this field/);
  assert.match(html, /Copy rival set/);
  assert.match(html, /Still to be founded: Seventies Jet \(1972\), Eighties Air \(1981\)/);
  assert.match(html, /started with Test set/);
});

test('the setup screen has the Rivals options', () => {
  store.clear();
  const html = text(renderToString(React.createElement(GameProvider, null, React.createElement(SetupScreen))));
  assert.match(html, /Random rivals/);
  assert.match(html, /Custom set/);
  assert.match(html, /No rival based at my hub/);
  assert.match(html, /No random new airlines during the game/);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
