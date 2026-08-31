// era-features-test.mjs — Era mode (Tailwinds port): concepts that don't exist
// yet are refused, anachronistic events stay off the dice, and the Comet 1
// grounding fires once. Classic games see none of it.
import { strict as assert } from 'node:assert';
import test from 'node:test';
import { featureLive, ERA_FEATURE_FROM, ERA_FEATURE_MESSAGE } from '../src/data/eraFeatures.js';
import { rollEvents, EVENT_TEMPLATES } from '../src/data/events.js';
import { gameReducer, freshState, eraFeatureDenial, COMET_GROUNDING } from '../src/store/GameContext.jsx';
import { getAircraftType, aircraftAvailability } from '../src/data/aircraft.js';

const eraState = (startYear, calYear, extra = {}) =>
  ({ ...freshState(), phase: 'playing', cash: 500_000_000, startYear, year: calYear - startYear + 1, week: 1, competitors: [], ...extra });

test('featureLive: classic always true; era years gate each concept', () => {
  for (const f of Object.keys(ERA_FEATURE_FROM)) {
    assert.equal(featureLive(f, null), true, `${f} classic`);
    assert.equal(featureLive(f, ERA_FEATURE_FROM[f] - 1), false, `${f} the year before`);
    assert.equal(featureLive(f, ERA_FEATURE_FROM[f]), true, `${f} its year`);
    assert.ok(ERA_FEATURE_MESSAGE[f]?.length > 0, `${f} carries a player-facing message`);
  }
});

test('the reducer refuses era-locked features and allows them once live', () => {
  const at1955 = eraState(1950, 1955);
  assert.equal(eraFeatureDenial(at1955, 'globalAlliances')?.code, 'not_yet_invented');
  const joined = gameReducer(at1955, { type: 'JOIN_ALLIANCE', allianceId: 'skybridge' });
  assert.equal(joined.allianceMembership ?? null, null, 'no membership before 1997');
  assert.ok(joined.error?.includes('1997'));
  const anc = gameReducer(eraState(1950, 1990), { type: 'SET_ANCILLARIES', active: true });
  assert.equal(anc.ancillaries ?? null, null, 'no à la carte pricing before 2008');
  const anc1 = gameReducer(eraState(1950, 1990), { type: 'SET_ANCILLARY', id: 'bags', offered: true });
  assert.equal(anc1.ancillaries ?? null, null, 'nor by the per-product back door');
  const wifi = gameReducer(eraState(1950, 1995, { fleet: [{ id: 'x1', typeId: 'b737400', ageWeeks: 0, status: 'idle' }] }),
    { type: 'INSTALL_WIFI', aircraftIds: ['x1'] });
  assert.ok(!wifi.fleet.find(a => a.id === 'x1')?.wifi, 'no Wi-Fi before 2004');
  const lounge = gameReducer(eraState(1950, 1960, { gates: { JFK: 2 } }), { type: 'BUILD_LOUNGE', code: 'JFK' });
  assert.equal(Object.keys(lounge.lounges ?? {}).length, 0, 'no lounge network before 1985');
  const cs = gameReducer(eraState(1950, 1980), { type: 'SIGN_CODESHARE', competitorId: 'anything' });
  assert.equal((cs.codeshareAgreements ?? []).length, 0, 'no codeshares before 1990');
  // Classic games see no denial at all — the parity invariant.
  assert.equal(eraFeatureDenial({ ...freshState() }, 'wifi'), null);
  assert.equal(eraFeatureDenial(eraState(1950, 2010), 'ancillaries'), null);
  const live = gameReducer(eraState(1950, 2010), { type: 'SET_ANCILLARIES', active: true });
  assert.ok(live.ancillaries, 'once live, the action lands');
});

test('anachronistic events stay off the dice until their concept exists', () => {
  const gated = EVENT_TEMPLATES.filter(t => t.fromYear != null).map(t => t.id);
  assert.deepEqual(gated.sort(), ['mega_conference', 'pandemic_scare', 'tech_outage']);
  const origRandom = Math.random;
  try {
    Math.random = () => 0;   // every template triggers — only filters decide
    const at1955 = [];
    for (let i = 0; i < 30 && at1955.length < 60; i++) at1955.push(...rollEvents([], { calendarYear: 1955 }));
    assert.ok(at1955.length > 0, 'events still roll in 1955');
    assert.ok(!at1955.some(e => gated.includes(e.templateId)), 'no IT outage in 1955');
    const classic = rollEvents([]);
    assert.ok(classic.length > 0, 'classic rolls untouched');
  } finally {
    Math.random = origRandom;
  }
});

test('the Comet 1 grounding: fleet withdrawn, insurance paid, fires once', () => {
  let st = eraState(1952, 1952, {});
  st = gameReducer(st, { type: 'BUY_AIRCRAFT', typeId: 'comet1' });
  st = gameReducer(st, { type: 'BUY_AIRCRAFT', typeId: 'comet1' });
  assert.equal(st.fleet.filter(a => a.typeId === 'comet1').length, 2);
  st = { ...st, year: 1954 - 1952 + 1, week: COMET_GROUNDING.week - 1 };
  st = gameReducer(st, { type: 'ADVANCE_WEEK' });
  assert.equal(st.week, COMET_GROUNDING.week, 'entering the grounding week');
  const before = st.cash;
  st = gameReducer(st, { type: 'ADVANCE_WEEK' });
  assert.equal(st.fleet.filter(a => a.typeId === 'comet1').length, 0, 'the fleet is grounded');
  assert.equal(st.cometGrounded, true);
  const payout = 2 * Math.round(getAircraftType('comet1').purchasePrice * COMET_GROUNDING.hullPayoutFrac);
  assert.ok(st.cash - before > payout * 0.8, `insurance landed (≈${payout})`);
  assert.ok(st.pendingToasts?.some(t => t.title.includes('Comet')), 'the player is told');
  const again = gameReducer(st, { type: 'ADVANCE_WEEK' });
  assert.equal(again.cometGrounded, true, 'never fires twice');
  assert.equal(aircraftAvailability(getAircraftType('comet1'), 1953), 'new');
  assert.equal(aircraftAvailability(getAircraftType('comet1'), 1955), 'expired');
  assert.equal(aircraftAvailability(getAircraftType('comet1'), null), 'available', 'classic untouched');
});

test('a classic game never grounds anything at week 15 of year 5', () => {
  let st = { ...freshState(), phase: 'playing', cash: 500_000_000, competitors: [], year: 5, week: 14, fleet: [], routes: [] };
  st = gameReducer(st, { type: 'ADVANCE_WEEK' });
  st = gameReducer(st, { type: 'ADVANCE_WEEK' });
  assert.ok(!('cometGrounded' in st), 'classic saves never grow the flag');
});
