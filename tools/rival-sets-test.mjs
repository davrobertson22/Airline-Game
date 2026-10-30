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
import { readFileSync } from 'node:fs';
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
const D = await import('../src/models/demand.js');
const { getAircraftType } = await import('../src/data/aircraft.js');
const AC = await import('../src/data/aircraft.js');
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

test('the setup screen\'s path works: the checked set it dispatches is accepted as-is', () => {
  need();
  // SetupScreen dispatches parseRivalSet(text).set, not the text. That object
  // must pass START_GAME's own check, or every custom game silently gets the
  // random field (the first build of this feature shipped exactly that bug).
  const checked = RS.parseRivalSet(JSON.stringify(set([R('Alpha Air', 'LHR', 'legacy', { founded: 1950 }), R('Beta Jet', 'AMS', 'budget')]))).set;
  assert.equal(RS.parseRivalSet(checked).ok, true);
  const s = withSeed(0, () => start({ rivalSet: checked, rivalMode: 'replace' }));
  assert.deepEqual(s.competitors.map(c => c.name).sort(), ['Alpha Air', 'Beta Jet']);
});

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

section('second package: fleet, closing year, routes, second hub');

test('the new fields parse, and mistakes in them are warnings', () => {
  need();
  const p = RS.parseRivalSet(set([R('Pan Global', 'JFK', 'legacy', {
    fleet: ['B747200', 'nope'], maker: 'boeing', founded: 1927, ceased: 1991, hub2: 'mia',
    routes: ['JFK-LHR', 'jfk - cdg', 'LHR-JFK', 'JFK-JFK', 'XXX-JFK', 'JFKLHR'],
  }), R('Bad Close', 'LHR', 'legacy', { founded: 1980, ceased: 1975, hub2: 'LHR', maker: 'Acme' })]));
  assert.equal(p.ok, true, p.errors.join('; '));
  const [a, b] = p.set.rivals;
  assert.deepEqual(a.fleet, ['b747200']);
  assert.equal(a.maker, 'boeing');
  assert.equal(a.ceased, 1991);
  assert.equal(a.hub2, 'MIA');
  assert.deepEqual(a.routes, ['JFK-LHR', 'JFK-CDG'], 'normalised, duplicates (either way round) and bad pairs dropped');
  assert.equal(b.ceased, undefined, 'cannot close before it opens');
  assert.equal(b.hub2, undefined, 'second hub = home hub is ignored');
  assert.equal(b.maker, undefined);
  assert.ok(p.warnings.some(w => /unknown aircraft type "nope"/.test(w)));
  assert.ok(p.warnings.some(w => /route "JFK-JFK" left out/.test(w)));
  assert.ok(p.warnings.some(w => /no manufacturer called "Acme"/.test(w)));
});

test('a fleet preference narrows the AI\'s choice, but never to nothing', () => {
  const list = [getAircraftType('b737800'), getAircraftType('a320ceo'), getAircraftType('b777300er')];
  assert.deepEqual(D.preferredTypes(list, { types: [], maker: 'airbus' }).map(t => t.id), ['a320ceo']);
  assert.deepEqual(D.preferredTypes(list, { types: ['b777300er'], maker: null }).map(t => t.id), ['b777300er']);
  assert.deepEqual(D.preferredTypes(list, { types: ['a380'], maker: null }), list, 'nothing preferred can do it: anything that fits');
  assert.equal(D.preferredTypes(list, null), list);
  const longHaul = D.rankCompetitorAircraftTypes(9000, 'legacy', { types: [], maker: 'airbus' });
  assert.ok(longHaul.length > 0 && longHaul.every(t => /airbus/i.test(t.manufacturer)));
});

test('an all-Boeing rival flies only Boeings, its listed routes and its second hub', () => {
  const s = withSeed(51, () => start({ startYear: 1975, rivalSet: set([R('Pan Global', 'JFK', 'legacy', {
    size: 'large', maker: 'Boeing', hub2: 'MIA', routes: ['JFK-LHR', 'JFK-CDG', 'JFK-MIA', 'MIA-GRU', 'JFK-SFO'] })]) }));
  const c = s.competitors[0];
  assert.deepEqual(Object.keys(c.routes).sort(), ['CDG-JFK', 'GRU-MIA', 'JFK-LHR', 'JFK-MIA', 'JFK-SFO']);
  assert.equal(c.secondaryHub, 'MIA');
  assert.ok(c.fleet.length > 0 && c.fleet.every(f => /boeing/i.test(getAircraftType(f.typeId).manufacturer)), [...new Set(c.fleet.map(f => f.typeId))].join(','));
  // …and keeps buying Boeing as it grows.
  let t = s;
  withSeed(52, () => { for (let w = 0; w < 52; w++) t = gameReducer(t, { type: 'ADVANCE_WEEK' }); });
  const pg = t.competitors.find(x => x.name === 'Pan Global');
  assert.ok(pg.fleet.every(f => /boeing/i.test(getAircraftType(f.typeId).manufacturer)));
  assert.ok([...(pg.linePlans ?? [])].every(p => /boeing/i.test(getAircraftType(p.typeId).manufacturer)), 'orders too');
});

test('a listed route nothing of the era can fly is left out, and the player is told', () => {
  const s = withSeed(53, () => start({ startYear: 1960, rivalSet: set([R('Too Far', 'LHR', 'legacy', { routes: ['LHR-SYD', 'LHR-CDG'] })]) }));
  assert.deepEqual(Object.keys(s.competitors[0].routes), ['CDG-LHR']);
  assert.equal(s.competitors[0]._skippedRoutes, undefined, 'bookkeeping stripped');
  assert.ok(s.pendingToasts.some(t => /LHR-SYD/.test(t.message)));
});

test('a closing year retires the airline in that year (era games)', () => {
  let s = withSeed(54, () => start({ startYear: 1975, rivalSet: set([R('Pan Global', 'JFK', 'legacy', { founded: 1927, ceased: 1977 }), R('Stays', 'LHR', 'legacy')]) }));
  let closedIn = null, ev = null;
  withSeed(55, () => {
    for (let w = 0; w < 52 * 3 && !closedIn; w++) {
      s = gameReducer(s, { type: 'ADVANCE_WEEK' });
      ev = (s.lastReport?.competitorEvents ?? []).find(e => e.type === 'ceased');
      if (ev) closedIn = 1974 + s.year;
    }
  });
  assert.equal(closedIn, 1977);
  assert.match(ev.description, /Pan Global has ceased operations after 50 years/);
  assert.ok(!s.competitors.some(c => c.name === 'Pan Global'));
  assert.ok(s.competitors.some(c => c.name === 'Stays'));
});

test('an airline already closed by the start year never appears; classic games ignore closing years', () => {
  need();
  const sp = RS.parseRivalSet(set([R('Gone', 'JFK', 'legacy', { founded: 1930, ceased: 1960 }), R('Here', 'LHR', 'legacy')])).set;
  const split = RS.splitRivalSet(sp, 1970);
  assert.deepEqual(split.starters.map(r => r.name), ['Here']);
  assert.equal(split.closed, 1);
  assert.equal(RS.splitRivalSet(sp, null).starters.length, 2);
  let s = withSeed(56, () => start({ rivalSet: sp }));
  const evs = [];
  withSeed(57, () => { for (let w = 0; w < 10; w++) { s = gameReducer(s, { type: 'ADVANCE_WEEK' }); evs.push(...(s.lastReport?.competitorEvents ?? []).filter(e => e.name === 'Gone')); } });
  assert.ok(s.competitors.some(c => c.name === 'Gone'), JSON.stringify(evs.map(e => e.type + ':' + e.description)));
});

test('an entrant whose years pass while the field is full never joins', () => {
  need();
  const spec = RS.parseRivalSet(set([R('Brief Air', 'MIA', 'budget', { founded: 1975, ceased: 1978 })])).set.rivals[0];
  const field = Array.from({ length: 30 }, (_, i) => ({ id: `f${i}`, name: `F${i}`, homeHub: 'LHR', tier: 'legacy', cash: 5e7, routes: {}, fleet: [], baseQualityScore: 60, _archetype: 'balanced' }));
  const out = withSeed(58, () => AI.tickCompetitorAI(field.slice(0, 20), { weekNumber: 300, calendarYear: 1979, entrants: [spec], rosterCap: 30 }));
  assert.equal(out.entrants.length, 0);
  assert.ok(!out.competitors.some(c => c.name === 'Brief Air'));
});

test('the new fields survive copying the field back out', () => {
  need();
  const s = withSeed(59, () => start({ startYear: 1975, rivalSet: set([
    R('Pan Global', 'JFK', 'legacy', { maker: 'Boeing', ceased: 1991, hub2: 'MIA', routes: ['JFK-LHR', 'JFK-MIA'], fleet: ['b747200'] }),
    R('Later', 'AMS', 'budget', { founded: 1980, ceased: 1999, fleet: ['dc930'] }),
  ]) }));
  const back = RS.parseRivalSet(RS.exportRivalSet({ competitors: s.competitors, entrants: s.rivalEntrants, startYear: 1975 }));
  assert.equal(back.ok, true, back.errors.join('; '));
  const [pg, later] = back.set.rivals;
  assert.deepEqual([pg.maker, pg.ceased, pg.hub2, pg.routes, pg.fleet], ['boeing', 1991, 'MIA', ['JFK-LHR', 'JFK-MIA'], ['b747200']]);
  assert.deepEqual([later.founded, later.ceased, later.fleet], [1980, 1999, ['dc930']]);
});

section('field options');

test('rival count: a field of 10 or 40, start-ups refilling to the same proportion', () => {
  need();
  const few = withSeed(61, () => start({ rivalCount: 'few' }));
  const many = withSeed(62, () => start({ rivalCount: 'many' }));
  assert.equal(few.competitors.length, 10);
  assert.equal(many.competitors.length, 40);
  assert.equal(few.rivalStartupCap, 11);
  assert.equal(many.rivalStartupCap, 45);
  const plus = withSeed(63, () => start({ rivalCount: 'few', rivalSet: set([R('Mine Too', 'LHR', 'legacy')]), rivalMode: 'add' }));
  assert.equal(plus.competitors.length, 11, 'the set adds to the smaller random field');
});

const fieldOf = (n) => Array.from({ length: n }, (_, i) => ({ id: `g${i}`, name: `G${i}`, homeHub: 'LHR', tier: 'legacy', cash: 5e7, routes: {}, fleet: [], baseQualityScore: 60, _archetype: 'balanced' }));
const fixed = (v, fn) => { const real = Math.random; Math.random = () => v; try { return fn(); } finally { Math.random = real; } };
const startups = (out) => out.events.filter(e => e.type === 'startup').length;

test('start-up frequency: none / rare / normal / frequent, and the field-size cap', () => {
  // A draw of 0.03 misses the normal 2% chance and the rare 0.8%, but hits the frequent 5%.
  const at = (opts) => startups(fixed(0.03, () => AI.tickCompetitorAI(fieldOf(10), { weekNumber: 100, ...opts })));
  assert.equal(at({}), 0);
  assert.equal(at({ startupRate: 'rare' }), 0);
  assert.equal(at({ startupRate: 'frequent' }), 1);
  assert.equal(at({ startupRate: 'off' }), 0);
  const low = (opts) => startups(fixed(0.001, () => AI.tickCompetitorAI(fieldOf(10), { weekNumber: 100, ...opts })));
  assert.equal(low({}), 1);
  assert.equal(low({ startupRate: 'off' }), 0);
  assert.equal(low({ startupCap: 10 }), 0, 'a 10-rival game is not refilled past its size');
  assert.equal(low({ startupCap: 11 }), 1);
});

test('mergers can be switched off', () => {
  const field = () => [
    ...fieldOf(6),
    { id: 'rich', name: 'Rich', homeHub: 'JFK', tier: 'legacy', cash: 5e9, profitHistory: [1e6], routes: {}, fleet: [], baseQualityScore: 70, _archetype: 'balanced' },
    { id: 'weak', name: 'Weak', homeHub: 'BOS', tier: 'budget', cash: -1e6, fireSale: true, marketCap: 5e6, routes: {}, fleet: [], baseQualityScore: 40, _archetype: 'balanced' },
  ];
  const merged = (opts) => fixed(0.001, () => AI.tickCompetitorAI(field(), { weekNumber: 3, ...opts })).events.some(e => e.type === 'merger');
  assert.equal(merged({}), true);
  assert.equal(merged({ mergers: false }), false);
});

test('rival pressure: fierce rivals act more often and notice you more; relaxed ones less', () => {
  assert.deepEqual(Object.keys(AI.RIVAL_PRESSURE).sort(), ['fierce', 'relaxed']);
  const acts = (pressure) => {
    let comps = [{ id: 'solo', name: 'Solo', homeHub: 'LHR', tier: 'legacy', cash: 5e7, routes: {}, fleet: [], baseQualityScore: 60, _archetype: 'balanced' }];
    let n = 0, last = comps[0]._routeLoss;
    withSeed(70, () => {
      for (let w = 1; w <= 60; w++) {
        comps = AI.tickCompetitorAI(comps, { weekNumber: w, pressure }).competitors;
        if (comps[0]._routeLoss !== last) { n++; last = comps[0]._routeLoss; }
      }
    });
    return n;
  };
  const normal = acts(null), fierce = acts('fierce'), relaxed = acts('relaxed');
  assert.equal(normal, 12, 'a balanced carrier acts every 5 weeks');
  assert.equal(fierce, 15, '…every 4 when fierce');
  assert.equal(relaxed, 10, '…every 6 when relaxed');
  const s = withSeed(71, () => start({ rivalPressure: 'fierce', rivalMergers: false, rivalStartups: 'rare' }));
  assert.deepEqual([s.rivalPressure, s.rivalMergers, s.rivalStartups], ['fierce', false, 'rare']);
  const bad = withSeed(72, () => start({ rivalPressure: 'insane', rivalStartups: 'always', rivalCount: 'lots' }));
  for (const k of ['rivalPressure', 'rivalStartups', 'rivalCount']) assert.equal(bad[k], undefined, k);
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
  assert.match(html, /Rival pressure Relaxed Normal Fierce/);
  assert.match(html, /Random rivals Few \(10\) Usual \(25\) Many \(40\)/);
  assert.match(html, /New airlines None Rare Normal Frequent/);
  assert.match(html, /Rivals can merge with each other/);
});

section('third package: random logos and a chance to appear');

test('"random" logos parse, per rival or for the whole set', () => {
  need();
  const one = RS.parseRivalSet(set([R('A', 'LHR', 'legacy', { logo: 'Random' }), R('B', 'JFK', 'legacy', { logo: 'jade' })]));
  assert.equal(one.ok, true);
  assert.deepEqual(one.set.rivals.map(r => r.logo), ['random', 'jade']);
  assert.equal(one.warnings.length, 0);
  const all = RS.parseRivalSet(set([R('A', 'LHR', 'legacy', { logo: 'bolt' }), R('B', 'JFK', 'legacy')], { randomLogos: true }));
  assert.deepEqual(all.set.rivals.map(r => r.logo), ['random', 'random'], 'randomLogos overrides listed logos');
  assert.deepEqual(RS.parseRivalSet(set([R('A', 'LHR', 'legacy', { logo: 'jade' })], { logo: 'random' })).set.rivals[0].logo, 'random');
});

test('a random logo is drawn when the airline is built, from the least used', () => {
  need();
  const spec = RS.parseRivalSet(set([R('A', 'LHR', 'legacy', { logo: 'random' })])).set.rivals[0];
  const taken = RS.RIVAL_LOGOS.filter(l => l !== 'orbit');
  const c = RS.buildRivalFromSpec(spec, { takenLogos: taken });
  assert.equal(c.logoId, 'orbit');
  assert.equal(c.setSpec.logo, 'random', 'the set still says random');
  assert.ok(RS.RIVAL_LOGOS.includes(RS.buildRivalFromSpec(spec).logoId));
});

test('a big random-logo set spreads across every logo', () => {
  const rivals = Array.from({ length: 45 }, (_, i) => R(`Air ${i}`, ['LHR', 'JFK', 'NRT', 'SYD', 'GRU', 'JNB'][i % 6], 'legacy'));
  const s = withSeed(70, () => start({ rivalSet: set(rivals, { randomLogos: true }), rivalMode: 'replace' }));
  assert.equal(s.competitors.length, 45);
  const counts = RS.RIVAL_LOGOS.map(l => s.competitors.filter(c => c.logoId === l).length);
  assert.ok(Math.max(...counts) - Math.min(...counts) <= 1, `uneven: ${counts}`);
});

test('chance parses as a percentage, with a set-wide default and crowding switch', () => {
  need();
  const p = RS.parseRivalSet(set([
    R('A', 'LHR', 'legacy', { chance: '60%' }), R('B', 'JFK', 'legacy'), R('C', 'NRT', 'legacy', { chance: 100 }),
    R('D', 'SYD', 'legacy', { chance: 150 }), R('E', 'GRU', 'legacy', { chance: 0, crowding: true }), R('F', 'JNB', 'legacy', { chance: 20, crowding: true }),
  ], { chance: 40, crowding: false }));
  assert.equal(p.ok, true, p.errors.join('; '));
  const byName = Object.fromEntries(p.set.rivals.map(r => [r.name, r]));
  assert.equal(byName.A.chance, 60);
  assert.equal(byName.A.crowding, false, 'the set turned crowding off');
  assert.equal(byName.B.chance, 40, 'set default');
  assert.equal(byName.C.chance, undefined, '100 is the same as no chance');
  assert.equal(byName.D.chance, 40, 'a bad chance falls back to the set default');
  assert.equal(byName.E.chance, 0);
  assert.equal(byName.F.crowding, undefined, 'a rival can turn crowding back on');
  assert.ok(p.warnings.some(w => /chance "150" ignored/.test(w)));
  assert.match(RS.parseRivalSet(set([R('A', 'LHR', 'legacy')], { chance: 'often' })).warnings.join(' '), /The set's chance "often" ignored/);
});

test('crowding: likelier where few airlines are based, less likely where many are', () => {
  need();
  const spec = { name: 'X', hub: 'LHR', chance: 50 };
  const empty = RS.rivalChance(spec, []);
  const one = RS.rivalChance(spec, ['LHR']);
  const europe = RS.rivalChance(spec, ['LHR', 'LGW', 'CDG', 'AMS', 'FRA', 'BRU']);
  assert.equal(empty, 0.75);
  assert.equal(one, 0.5, 'one airline at the same hub leaves the chance as written');
  assert.ok(europe < 0.3, `crowded Europe: ${europe}`);
  assert.equal(RS.rivalChance(spec, ['SYD', 'NRT', 'JFK']), 0.75, 'airlines far away do not count');
  assert.equal(RS.rivalChance({ ...spec, crowding: false }, ['LHR', 'LGW', 'CDG']), 0.5, 'exact when crowding is off');
  assert.equal(RS.rivalChance({ ...spec, chance: 90 }, []), 1, 'never above certain');
  assert.equal(RS.rivalChance({ ...spec, chance: 0 }, []), 0, 'zero is never, crowding or not');
  assert.equal(RS.rivalChance({ name: 'Y', hub: 'LHR' }, ['LHR', 'LHR', 'LHR']), 1, 'no chance = always');
});

test('drawing: certain rivals always come, chance rivals by their odds, underserved ones more often', () => {
  need();
  const rng = seeded(71);
  const europe = ['LHR', 'LGW', 'CDG', 'AMS', 'FRA', 'BRU', 'MUC', 'ZRH'];
  let isolated = 0, crowded = 0, sure = 0, never = 0;
  for (let i = 0; i < 2000; i++) {
    const { chosen } = RS.drawRivals([
      { name: 'Sure', hub: 'CDG' }, { name: 'Never', hub: 'HNL', chance: 0 },
      { name: 'Island', hub: 'HNL', chance: 40 }, { name: 'Crowd', hub: 'LHR', chance: 40 },
    ], { hubs: europe, rng });
    const names = new Set(chosen.map(r => r.name));
    if (names.has('Sure')) sure++;
    if (names.has('Never')) never++;
    if (names.has('Island')) isolated++;
    if (names.has('Crowd')) crowded++;
  }
  assert.equal(sure, 2000);
  assert.equal(never, 0);
  assert.ok(Math.abs(isolated / 2000 - 0.6) < 0.04, `isolated ${isolated / 2000}`);
  assert.ok(crowded / 2000 < 0.2, `crowded ${crowded / 2000}`);
});

test('a field of only chance rivals is never empty, and the dice are reported', () => {
  const rivals = Array.from({ length: 30 }, (_, i) => R(`Maybe ${i}`, ['LHR', 'CDG', 'AMS', 'FRA', 'MAD', 'FCO'][i % 6], 'legacy'));
  const s = withSeed(72, () => start({ rivalSet: set(rivals, { chance: 30 }), rivalMode: 'replace' }));
  assert.ok(s.competitors.length >= 1 && s.competitors.length < 30, `${s.competitors.length}`);
  const toast = (s.pendingToasts ?? []).find(t => /rolled the dice/.test(t.title));
  assert.ok(toast, 'a toast says how many made it');
  assert.match(toast.message, new RegExp(`^${s.competitors.length} of the 30 airlines`));
  const none = withSeed(73, () => start({ rivalSet: set([R('Low', 'LHR', 'legacy', { chance: 1, crowding: false })]), rivalMode: 'replace' }));
  assert.deepEqual(none.competitors.map(c => c.name), ['Low'], 'the likeliest miss is kept when nothing came in');
});

test('chance rivals are rolled before the 60-rival cap, so a long list is not cut to its first 60', () => {
  need();
  const rivals = Array.from({ length: 110 }, (_, i) => R(`Air ${i}`, 'LHR', 'legacy', { chance: 100 * (i < 5 ? 1 : 0.5) }));
  const p = RS.parseRivalSet(set(rivals)).set;
  const preview = RS.splitRivalSet(p, null);
  assert.equal(preview.sure, 5);
  assert.equal(preview.byChance, 105);
  assert.equal(preview.dropped, 0);
  const drawn = RS.splitRivalSet(p, null, { rng: seeded(74) });
  assert.ok(drawn.starters.slice(0, 5).every(r => r.chance == null), 'certain rivals first');
  assert.ok(drawn.starters.some(r => Number(r.name.slice(4)) >= 60), 'rivals listed after the 60th still get a chance');
  assert.ok(drawn.starters.length <= RS.RIVAL_SET_MAX_START);
});

test('with the random field added, chance rivals see its hubs as neighbours', () => {
  const s = withSeed(75, () => start({ rivalSet: set([R('Maybe Air', 'HNL', 'legacy', { chance: 60 })]), rivalMode: 'add' }));
  assert.ok(s.competitors.length >= 10, 'the random field is there');
});

test('a chance entrant rolls once when due: a miss never founds, a hit founds', () => {
  need();
  const field = Array.from({ length: 10 }, (_, i) => ({ id: `f${i}`, name: `F${i}`, homeHub: 'LHR', tier: 'legacy', logoId: 'jade', cash: 5e7, routes: {}, fleet: [], baseQualityScore: 60, _archetype: 'balanced' }));
  const zero = RS.parseRivalSet(set([R('Ghost Air', 'MIA', 'budget', { founded: 1975, chance: 0 })])).set.rivals[0];
  const out0 = withSeed(76, () => AI.tickCompetitorAI(field, { weekNumber: 200, calendarYear: 1976, entrants: [zero], rosterCap: 30 }));
  assert.equal(out0.entrants.length, 0, 'gone for good');
  assert.ok(!out0.competitors.some(c => c.name === 'Ghost Air'));
  const early = withSeed(76, () => AI.tickCompetitorAI(field, { weekNumber: 200, calendarYear: 1970, entrants: [zero], rosterCap: 30 }));
  assert.equal(early.entrants.length, 1, 'no roll before its year');
  const likely = RS.parseRivalSet(set([R('Sure Thing', 'MIA', 'budget', { founded: 1975, chance: 99, logo: 'random', crowding: false })])).set.rivals[0];
  let joined = 0;
  for (let k = 0; k < 20; k++) {
    const out = withSeed(80 + k, () => AI.tickCompetitorAI(field, { weekNumber: 200, calendarYear: 1976, entrants: [likely], rosterCap: 30 }));
    const c = out.competitors.find(x => x.name === 'Sure Thing');
    if (c) { joined++; assert.notEqual(c.logoId, 'jade', 'random logo avoids the one the field already uses'); }
  }
  assert.ok(joined >= 17, `joined ${joined}/20`);
});

test('copying the field out: entrants keep their chance, flying airlines show their drawn logo', () => {
  need();
  const s = withSeed(77, () => start({ startYear: 1975, rivalSet: set([
    R('Now Air', 'JFK', 'legacy', { logo: 'random', chance: 99, crowding: false }),
    R('Later Air', 'AMS', 'budget', { founded: 1985, chance: 35, logo: 'random' }),
  ]) }));
  const back = RS.parseRivalSet(RS.exportRivalSet({ competitors: s.competitors, entrants: s.rivalEntrants, startYear: 1975 }));
  assert.equal(back.ok, true, back.errors.join('; '));
  const now = back.set.rivals.find(r => r.name === 'Now Air');
  const later = back.set.rivals.find(r => r.name === 'Later Air');
  assert.ok(RS.RIVAL_LOGOS.includes(now.logo) && now.logo === s.competitors.find(c => c.name === 'Now Air').logoId);
  assert.equal(now.chance, undefined, 'it made it into this field');
  assert.equal(later.chance, 35);
  assert.equal(later.logo, 'random');
});

test('the example set shows a random logo and a chance', () => {
  need();
  const p = RS.parseRivalSet(RS.exampleRivalSet(1980));
  assert.equal(p.ok, true, p.errors.join('; '));
  assert.ok(p.set.rivals.some(r => r.logo === 'random'));
  assert.ok(p.set.rivals.some(r => r.chance === 60));
});

section('fixes 2026-10-18: start-ups, up-gauges, founding years in a copy');

test('random start-ups never hold the seat a set airline is waiting for', () => {
  need();
  const spec = RS.parseRivalSet(set([R('Late Air', 'MIA', 'budget', { founded: 1975 })])).set.rivals[0];
  const carrier = (i, extra = {}) => ({ id: `f${i}`, name: `F${i}`, homeHub: 'LHR', tier: 'legacy', cash: 5e7, routes: {}, fleet: [], baseQualityScore: 60, _archetype: 'balanced', ...extra });
  // 28 flying: 22 from the set, 6 of the game's own start-ups.
  const mixed = [...Array.from({ length: 22 }, (_, i) => carrier(i, { fromSet: true })),
                 ...Array.from({ length: 6 }, (_, i) => carrier(22 + i, { isStartup: true, foundedWeek: 100 }))];
  const out = withSeed(91, () => AI.tickCompetitorAI(mixed, { weekNumber: 300, calendarYear: 1976, entrants: [spec], rosterCap: 22 }));
  assert.equal(out.entrants.length, 0, 'it joins: the start-ups do not count against its room');
  assert.ok(out.competitors.some(c => c.name === 'Late Air'));
  // A field genuinely full of set airlines still makes it wait.
  const full = Array.from({ length: 28 }, (_, i) => carrier(i, { fromSet: true }));
  const wait = withSeed(91, () => AI.tickCompetitorAI(full, { weekNumber: 300, calendarYear: 1976, entrants: [spec], rosterCap: 22 }));
  assert.equal(wait.entrants.length, 1);
});

test('a historical pack gets every airline in its year, even with frequent start-ups', () => {
  need();
  const HUBS = ['LHR', 'CDG', 'FRA', 'AMS', 'MAD', 'FCO', 'ZRH', 'CPH', 'ARN', 'OSL', 'HEL', 'VIE', 'BRU', 'DUB', 'LIS', 'ATH', 'IST', 'JFK', 'LAX', 'ATL', 'DFW', 'MIA', 'SFO', 'YYZ', 'GRU', 'NRT', 'HKG', 'SIN'];
  // 24 on day one, 4 founded 1958-61: years for random start-ups to fill the
  // field first. End-to-end check of the whole path; the seat rule itself is
  // pinned by the test above (failures here before the fix were seed-dependent,
  // as bankruptcies often free a seat in time — a 50-year probe lost 6 of 34).
  const rivals = HUBS.map((hub, i) => R(`Hist ${i}`, hub, i % 3 ? 'legacy' : 'budget', { founded: i < 24 ? 1940 : 1958 + (i - 24) }));
  let s = withSeed(92, () => start({ startYear: 1950, rivalSet: set(rivals), rivalStartups: 'frequent' }));
  assert.equal(s.rivalEntrants.length, 4);
  const joined = {};
  let startups = 0;
  withSeed(93, () => {
    for (let w = 0; w < 52 * 12; w++) {
      s = gameReducer({ ...s, cash: 1e12 }, { type: 'ADVANCE_WEEK' });
      for (const e of s.lastReport?.competitorEvents ?? []) {
        if (e.type !== 'startup') continue;
        if (e.name.startsWith('Hist ')) joined[e.name] ??= 1950 + Math.floor(w / 52);
        else startups++;
      }
    }
  });
  for (const r of rivals.filter(x => x.founded > 1950)) assert.equal(joined[r.name], r.founded, `${r.name} joins in ${r.founded}`);
  assert.ok(startups > 0, 'random start-ups still launch alongside');
});

test('an up-gauge stays inside the fleet preference; a fallback route may still step up', () => {
  withSeed(98, () => start());   // a classic world: the whole catalogue is on the market
  const { AIRCRAFT_TYPES } = AC;
  const top = AIRCRAFT_TYPES.filter(t => /boeing/i.test(t.manufacturer)).sort((a, b) => b.seats - a.seats)[0];
  const boeing = { types: [], maker: 'boeing' };
  const strict = D.pickLargerCompetitorAircraftType(8000, Math.ceil(top.seats * 1.15), { fleetPref: boeing, strictPref: true });
  assert.equal(strict, null, 'a Boeing carrier that fills its biggest Boeing stays on it');
  const loose = D.pickLargerCompetitorAircraftType(8000, Math.ceil(top.seats * 1.15), { fleetPref: boeing, strictPref: false });
  assert.ok(loose && !/boeing/i.test(loose.manufacturer), 'a route that already had to fall back can still grow');
  assert.equal(D.isPreferredType(top, boeing), true);
  assert.equal(D.isPreferredType(AC.getAircraftType('a380'), boeing), false);
  assert.equal(D.isPreferredType(AC.getAircraftType('a380'), null), true, 'no preference: everything is preferred');
});

test('ten years on, one-maker carriers fly only their maker (classic, everything on the market)', () => {
  need();
  let s = withSeed(94, () => start({ hub: 'SYD', rivalStartups: 'off', rivalSet: set([
    R('Airbus A', 'CDG', 'legacy', { size: 'large', maker: 'Airbus' }),
    R('Boeing B', 'ORD', 'legacy', { size: 'large', maker: 'Boeing' }),
    R('Listed F', 'SIN', 'premium', { size: 'large', fleet: ['a350900', 'b787900'] }),
  ]) }));
  const offPref = (st) => Object.fromEntries(st.competitors.map(c => [c.name,
    (c.fleet ?? []).filter(f => !D.isPreferredType(AC.getAircraftType(f.typeId), c.fleetPref)).map(f => f.typeId)]));
  assert.deepEqual(offPref(s), { 'Airbus A': [], 'Boeing B': [], 'Listed F': [] });
  withSeed(95, () => { for (let w = 0; w < 52 * 10; w++) s = gameReducer({ ...s, cash: 1e12 }, { type: 'ADVANCE_WEEK' }); });
  for (const [name, off] of Object.entries(offPref(s))) assert.deepEqual(off, [], `${name} has off-preference metal: ${off.join(', ')}`);
});

test('copying the field out keeps the year an airline joined, not the start year', () => {
  need();
  // Classic demand model: this is about the founding year surviving an export,
  // and under v2's per-flight costs this seed's Seventies Jet (a budget start-up
  // flying 720Bs on short European hops) goes bust before year 4.
  let s = withSeed(96, () => start({ startYear: 1970, rivalSet: eraSet, rivalStartups: 'off', demandModel: 1 }));
  withSeed(97, () => { for (let w = 0; w < 52 * 4; w++) s = gameReducer({ ...s, cash: 1e12 }, { type: 'ADVANCE_WEEK' }); });
  assert.ok(s.competitors.some(c => c.name === 'Seventies Jet'), 'joined in 1972');
  const launched = { id: 'su1', name: 'Velocity Air', homeHub: 'ORD', tier: 'budget', isStartup: true, foundedWeek: 5 * 52 + 3, routes: {}, baseQualityScore: 40 };
  const back = RS.parseRivalSet(RS.exportRivalSet({ competitors: [...s.competitors, launched], entrants: s.rivalEntrants, startYear: 1970 }));
  assert.equal(back.ok, true, back.errors.join('; '));
  const year = (n) => back.set.rivals.find(r => r.name === n)?.founded;
  assert.equal(year('Founder Air'), 1960);
  assert.equal(year('Seventies Jet'), 1972, 'was 1970: pasted into a new 1970 game it came two years early');
  assert.equal(year('Eighties Air'), 1981);
  assert.equal(year('Velocity Air'), 1975, "a game's own start-up keeps the year it launched");
});

section('several makers per airline (2026-10-21)');

test('maker takes a list, a comma-separated string or "makers"; one maker stays a string', () => {
  need();
  const p = RS.parseRivalSet(set([
    R('List', 'JFK', 'legacy', { maker: ['Boeing', 'McDonnell Douglas'] }),
    R('Commas', 'LHR', 'legacy', { maker: 'Airbus, Embraer; ATR' }),
    R('Plural', 'CDG', 'legacy', { makers: ['Airbus', 'ATR'] }),
    R('Both', 'AMS', 'legacy', { maker: 'Fokker', makers: ['Boeing', 'fokker'] }),
    R('One', 'FRA', 'legacy', { maker: ['Airbus'] }),
    R('Mixed', 'MAD', 'legacy', { maker: ['Boeing', 'Acme', ''] }),
    R('None', 'ORD', 'legacy', { maker: ['Acme', 'Nope'] }),
  ]));
  assert.equal(p.ok, true, p.errors.join('; '));
  assert.deepEqual(Object.fromEntries(p.set.rivals.map(r => [r.name, r.maker])), {
    List: ['boeing', 'mcdonnell douglas'], Commas: ['airbus', 'embraer', 'atr'], Plural: ['airbus', 'atr'],
    Both: ['fokker', 'boeing'], One: 'airbus', Mixed: 'boeing', None: undefined,
  });
  assert.equal(p.warnings.filter(w => /no manufacturer called "Acme"/.test(w)).length, 2, 'an unknown maker is dropped, the rest kept');
  assert.ok(p.warnings.some(w => /no manufacturer called "Nope"/.test(w)));
  assert.ok(!p.warnings.some(w => /no manufacturer called ""/.test(w)), 'an empty entry is skipped quietly');
  const again = RS.parseRivalSet(p.set);
  assert.deepEqual(again.set.rivals.map(r => r.maker), p.set.rivals.map(r => r.maker), 'the checked set START_GAME re-checks is unchanged');
});

test('a two-maker preference keeps both makers and nothing else', () => {
  const list = ['b737800', 'a320ceo', 'e175', 'atr72', 'dc930'].map(id => getAircraftType(id));
  assert.deepEqual(D.preferredTypes(list, { types: [], maker: ['boeing', 'embraer'] }).map(t => t.id), ['b737800', 'e175']);
  assert.deepEqual(D.preferredTypes(list, { types: ['atr72'], maker: ['airbus'] }).map(t => t.id), ['a320ceo', 'atr72']);
  assert.deepEqual(D.preferredTypes(list, { types: [], maker: ['cessna', 'pilatus'] }), list, 'nothing preferred can do it: anything that fits');
  assert.deepEqual(D.preferredTypes(list, { types: [], maker: [] }), list, 'an empty list is no preference');
  assert.deepEqual(D.preferredTypes(list, { types: [], maker: [] }, { strict: true }), list, '…even strict');
  assert.equal(D.isPreferredType(getAircraftType('dc930'), { types: [], maker: ['boeing', 'mcdonnell douglas'] }), true);
  assert.equal(D.isPreferredType(getAircraftType('a320ceo'), { types: [], maker: ['boeing', 'mcdonnell douglas'] }), false);
});

test('a Boeing + McDonnell Douglas carrier flies only those, and a copy of the field keeps both', () => {
  need();
  const pref = /^(boeing|mcdonnell douglas)$/i;
  let s = withSeed(71, () => start({ startYear: 1975, rivalMode: 'replace', rivalStartups: 'off', rivalSet: set([
    R('Twin Maker', 'JFK', 'legacy', { size: 'large', maker: ['Boeing', 'McDonnell Douglas'] }),
  ]) }));
  const off = (st) => (st.competitors.find(x => x.name === 'Twin Maker')?.fleet ?? [])
    .map(f => getAircraftType(f.typeId)).filter(t => !pref.test(t.manufacturer)).map(t => t.id);
  assert.ok(s.competitors[0].fleet.length > 0);
  assert.deepEqual(off(s), []);
  withSeed(72, () => { for (let w = 0; w < 52 * 3; w++) s = gameReducer({ ...s, cash: 1e12 }, { type: 'ADVANCE_WEEK' }); });
  assert.deepEqual(off(s), [], 'still only Boeing and McDonnell Douglas three years on');
  const back = RS.parseRivalSet(RS.exportRivalSet({ competitors: s.competitors, entrants: s.rivalEntrants, startYear: 1975 }));
  assert.equal(back.ok, true, back.errors.join('; '));
  assert.deepEqual(back.set.rivals.find(r => r.name === 'Twin Maker').maker, ['boeing', 'mcdonnell douglas']);
});

test('the example set shows a list of makers', () => {
  need();
  const p = RS.parseRivalSet(RS.exampleRivalSet());
  assert.ok(p.set.rivals.some(r => Array.isArray(r.maker) && r.maker.length > 1));
});

test('the competition guide lists every maker name the game knows, and no others', () => {
  const html = readFileSync(new URL('../public/competition-and-alliances.html', import.meta.url), 'utf8');
  const table = /<h3>Manufacturer names<\/h3>[\s\S]*?<tbody>([\s\S]*?)<\/tbody>/.exec(html)?.[1] ?? '';
  const listed = [...table.matchAll(/<tr><td>([^<]+)<\/td>/g)].map(m => m[1]).sort();
  const game = [...new Set(AC.AIRCRAFT_TYPES.map(t => t.manufacturer).filter(Boolean))].sort();
  assert.deepEqual(listed, game, 'regenerate the Manufacturer names table in public/competition-and-alliances.html');
  for (const m of game) assert.equal(RS.parseRivalSet(set([R('X', 'JFK', 'legacy', { maker: [m] })])).warnings.length, 0, m);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
