// Verifies deployableFleetForRoute() agrees with the reducer's ADD_CARGO_ROUTE
// accept/reject for assigning MORE cargo routes to a freighter that already
// flies one (the "spare hours but can't open a route" bug).
import assert from 'node:assert/strict';
import { gameReducer, freshState } from '../src/store/_engine.generated.mjs';
import { deployableFleetForRoute, routeDistanceKm } from '../src/utils/simulation.js';
import { getAircraftType } from '../src/data/aircraft.js';

let passed = 0, failed = 0;
const test = (n, fn) => { try { fn(); console.log('  ✓ ' + n); passed++; } catch (e) { console.log('  ✗ ' + n + '\n      ' + e.message); failed++; } };

function pickFreighter() {
  for (const id of ['b737f','b737-400f','b752f','b757f','b767f','b777f','b7478f']) if (getAircraftType(id)?.freighter) return id;
  return null;
}

console.log('\n── deployableFleetForRoute vs reducer ─────');
const typeId = pickFreighter();
test('a freighter type resolves', () => assert.ok(typeId, 'no freighter type id found'));

if (typeId) {
  const acId = 'F1';
  let st = { ...freshState(), cash: 5_000_000,
    fleet: [{ id: acId, typeId, name: 'F1', status: 'assigned', ageWeeks: 8, ownershipType: 'owned' }],
    gates: { MSP: 1, DTW: 1, ORD: 1, LAX: 1 },
    routes: [],
    cargoRoutes: [{ id: 'r1', origin: 'MSP', destination: 'DTW', aircraftId: acId, weeklyFrequency: 7, yieldPrice: 1, weeksOpen: 30, cargo: true }],
  };
  const tryAdd = (o, d, f) => {
    const before = st.cargoRoutes.length;
    const after = gameReducer(st, { type: 'ADD_CARGO_ROUTE', origin: o, destination: d, aircraftId: acId, weeklyFrequency: f, yieldPrice: 1 });
    return (after.cargoRoutes?.length ?? 0) > before;
  };
  test('reducer ACCEPTS assigned freighter on a connected 2nd lane (MSP->ORD)', () => {
    assert.ok(tryAdd('MSP','ORD',3), 'reducer rejected a connected lane it should allow');
  });

  const stH = { fleet: st.fleet, cargoRoutes: st.cargoRoutes };
  const d = (o,dst,f) => deployableFleetForRoute({ fleet: stH.fleet, existingRoutes: stH.cargoRoutes, typeId, origin:o, dest:dst, distKm: routeDistanceKm(o,dst), weeklyFrequency:f });

  test('helper: connected lane (MSP->ORD) marks assigned freighter ELIGIBLE', () => {
    const r = d('MSP','ORD',3);
    assert.equal(r.length, 1); assert.equal(r[0].idle, false);
    assert.ok(r[0].connectivityOk); assert.ok(r[0].eligible); assert.ok(r[0].spareBlockHrs > 0);
  });
  test('helper: UNconnected lane (LAX->ORD) NOT eligible (network rule)', () => {
    const r = d('LAX','ORD',3);
    assert.equal(r[0].connectivityOk, false); assert.equal(r[0].eligible, false); assert.ok(r[0].hoursOk);
  });
  test('helper: IDLE freighter eligible on any lane', () => {
    const r = deployableFleetForRoute({ fleet: [{ id:'F2', typeId, name:'F2', status:'idle', ageWeeks:2 }], existingRoutes: [], typeId, origin:'LAX', dest:'ORD', distKm: routeDistanceKm('LAX','ORD'), weeklyFrequency:5 });
    assert.equal(r[0].idle, true); assert.ok(r[0].eligible);
  });
  test('helper: grounded freighter excluded', () => {
    const r = deployableFleetForRoute({ fleet: [{ id:'F3', typeId, name:'F3', status:'grounded', ageWeeks:2 }], existingRoutes: [], typeId, origin:'MSP', dest:'DTW', distKm: routeDistanceKm('MSP','DTW'), weeklyFrequency:5 });
    assert.equal(r.length, 0);
  });
}
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
