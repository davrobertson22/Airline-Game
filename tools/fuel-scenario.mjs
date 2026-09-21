// Deterministic scenario helper for the fuel-operations suites.  @not-a-test
// ----------------------------------------------------------------------------
// Ported from the Headwinds golden-master harness (tools/golden-master/
// harness.mjs).  Tailwinds has no golden master, so this carries only the part
// the fuel suites need: a fixed, scripted game with ALL randomness seeded and
// the clock stubbed, so a test can say "advance 60 weeks and look at the
// result" and get the same answer every run.
//
// Not named *-test.mjs on purpose: tools/run-tests.mjs discovers suites by that
// pattern, and this file asserts nothing.
import { gameReducer, freshState } from '../src/store/GameContext.jsx';

// ── Seeded RNG (mulberry32) ─────────────────────────────────────────────────
export function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Stub Math.random AND Date.now so uid()/event-ids are deterministic too.
function installDeterminism(seed) {
  const rng = makeRng(seed);
  const origRandom = Math.random;
  const origNow = Date.now;
  let clock = 1_700_000_000_000;           // fixed epoch
  Math.random = rng;
  Date.now = () => (clock += 1000);        // monotonic, deterministic per call
  return () => { Math.random = origRandom; Date.now = origNow; };
}

// Start an airline, lease an aircraft, open a gate + a route, then advance.
// Exercises competitors, fuel, events, finance, demand and route economics.
export function runScenario({ seed = 0xC0FFEE, weeks = 60 } = {}) {
  const restore = installDeterminism(seed);
  try {
    let s = gameReducer(freshState(), {
      type: 'START_GAME', airlineName: 'GoldenAir', hub: 'JFK', enableObjectives: true,
    });
    // Classic instant-crew, not the hiring pipeline: a new Tailwinds game
    // starts with crewPipeline on, and an airline that has hired nobody has
    // every tail unstaffed - it flies no routes at all, so the tick reports a
    // fuel bill of exactly 0 and there is nothing for a fuel test to measure.
    // Plus a cash cushion, because this one-aircraft network loses money and
    // would otherwise go bankrupt around year 2 and stop being a fixture.
    s = { ...s, crewPipeline: false, cash: 2_000_000_000 };
    s = gameReducer(s, { type: 'LEASE_AIRCRAFT', typeId: 'a320ceo' });
    const aircraftId = s.fleet[0]?.id;
    s = gameReducer(s, { type: 'ADD_GATE', airportCode: 'LAX' });
    s = gameReducer(s, {
      type: 'ADD_ROUTE', aircraftId, origin: 'JFK', destination: 'LAX', weeklyFrequency: 7,
    });
    for (let w = 0; w < weeks; w++) {
      s = gameReducer(s, { type: 'ADVANCE_WEEK' });
    }
    return s;
  } finally {
    restore();
  }
}
