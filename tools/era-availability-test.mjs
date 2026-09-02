// era-availability-test.mjs — Era mode (Tailwinds port): aircraft enter and
// leave the market on the real calendar. Classic games (startYear null) must
// see the full catalogue and the published delivered-age table, unchanged.
import { strict as assert } from 'node:assert';
import test from 'node:test';
import {
  AIRCRAFT_TYPES, getAircraftType, aircraftAvailability, aircraftOrderable, eraDeliveredAgeWeeks,
  isVintage, VINTAGE_AFTER_YEARS, VINTAGE_AGE_FLOOR, VINTAGE_AGE_CAP,
} from '../src/data/aircraft.js';
import { gameReducer, freshState, orderDenial, leaseDenial } from '../src/store/GameContext.jsx';

// ── Catalogue data ───────────────────────────────────────────────────────────

test('every type carries eis; oop (when present) is a sane window', () => {
  for (const t of AIRCRAFT_TYPES) {
    assert.ok(Number.isInteger(t.eis), `${t.id} missing eis`);
    if (t.oop != null) {
      assert.ok(Number.isInteger(t.oop) && t.oop >= t.eis, `${t.id}: oop ${t.oop} before eis ${t.eis}`);
      assert.ok(t.oop <= 2026, `${t.id}: oop ${t.oop} in the future — an open line carries no oop`);
    }
  }
});

test('every banded passenger type has a real production-line closure', () => {
  const missing = AIRCRAFT_TYPES
    .filter(t => !t.freighter && (t.deliveredAgeWeeks ?? 0) > 0)
    .filter(t => t.oop == null || t.oop >= 2026)
    .map(t => t.id);
  assert.deepEqual(missing, []);
});

// ── Delivered age generalisation ─────────────────────────────────────────────

test('classic games reproduce the published table exactly (parity) — except vintage lines', () => {
  for (const t of AIRCRAFT_TYPES) if (!isVintage(t)) assert.equal(eraDeliveredAgeWeeks(t, null), t.deliveredAgeWeeks ?? 0, t.id);
});

test('an era game at 2026 also reproduces the published table exactly', () => {
  for (const t of AIRCRAFT_TYPES) assert.equal(eraDeliveredAgeWeeks(t, 2026), t.deliveredAgeWeeks ?? 0, t.id);
});

test('in production means factory-fresh; age grows after the line closes', () => {
  const b707 = getAircraftType('b707320');            // eis 1962, oop 1978
  assert.equal(eraDeliveredAgeWeeks(b707, 1965), 0, 'in production: new');
  assert.equal(eraDeliveredAgeWeeks(b707, 1978), 0, 'last year of the line: new');
  const mid = eraDeliveredAgeWeeks(b707, 2002);
  assert.ok(mid > 0 && mid < 832, `halfway out of production: partially aged (got ${mid})`);
  assert.equal(eraDeliveredAgeWeeks(b707, 2060), 832, 'far past: capped at 16y');
  for (const t of AIRCRAFT_TYPES) {
    let prev = -1;
    for (let y = 1950; y <= 2050; y += 10) {
      const a = eraDeliveredAgeWeeks(t, y);
      assert.ok(a >= 0 && a <= 832, `${t.id}@${y}: ${a} out of range`);
      if (aircraftAvailability(t, y) === 'used') {
        assert.ok(a >= prev, `${t.id}@${y}: age went backwards (${prev} -> ${a})`);
        prev = a;
      } else { prev = -1; }
    }
  }
});

test('active freighter conversion lines always deliver old airframes', () => {
  const bcf = getAircraftType('b737800bcf');
  assert.equal(bcf.oop ?? null, null);
  assert.equal(eraDeliveredAgeWeeks(bcf, 2020), bcf.deliveredAgeWeeks, 'a fresh conversion is an old airframe');
  assert.equal(eraDeliveredAgeWeeks(bcf, null), bcf.deliveredAgeWeeks);
});

// ── Availability states ──────────────────────────────────────────────────────

test('aircraftAvailability walks future → new → used → expired; classic short-circuits', () => {
  const t = getAircraftType('caravelle');             // eis 1959, oop 1972
  assert.equal(aircraftAvailability(t, 1950), 'future');
  assert.equal(aircraftAvailability(t, 1959), 'new');
  assert.equal(aircraftAvailability(t, 1972), 'new');
  assert.equal(aircraftAvailability(t, 1973), 'used');
  assert.equal(aircraftAvailability(t, null), 'available');
  const open = getAircraftType('a320neo');
  assert.equal(aircraftAvailability(open, 2050), 'new');
  assert.equal(aircraftAvailability(t, 2002), 'used');
  assert.equal(aircraftAvailability(t, 2003), 'expired');
});

// ── Vintage metal on the 2026 market (Discord 2026-09-01/02) ────────────────
// The 1950s propliners were briefly hidden from classic as "era-only" after they
// leaked in as the cheapest lease per seat on the books (Vanguard $114/seat-wk
// vs ATR 72 $564, same maintenance band). Dave: every aircraft belongs on the
// 2026 market. So instead: a line closed VINTAGE_AFTER_YEARS+ delivers old
// (VINTAGE_AGE_FLOOR → VINTAGE_AGE_CAP, i.e. 5.5× maintenance) and is buy-only.

test('vintage rule: lines closed 50+ years deliver 20–30 years old and are buy-only; everything younger is untouched', () => {
  const dc3 = getAircraftType('dc3'), van = getAircraftType('vanguard'), dc863 = getAircraftType('dc863');
  const b732 = getAircraftType('b737200'), il18 = getAircraftType('il18'), conc = getAircraftType('concorde');
  assert.equal(VINTAGE_AFTER_YEARS, 50); assert.equal(VINTAGE_AGE_FLOOR, 20); assert.equal(VINTAGE_AGE_CAP, 30);
  assert.equal(isVintage(dc3), true);   assert.equal(eraDeliveredAgeWeeks(dc3, null), 30 * 52, '1946 line: capped at 30y');
  assert.equal(isVintage(van), true);   assert.equal(eraDeliveredAgeWeeks(van, null), 30 * 52, '1964 line: 62y closed → cap');
  assert.equal(isVintage(dc863), true); assert.equal(eraDeliveredAgeWeeks(dc863, null), 24 * 52, '1972 line: 54y closed → 20 + 4');
  assert.equal(isVintage(b732), false); assert.equal(eraDeliveredAgeWeeks(b732, null), b732.deliveredAgeWeeks, '1988 line: published band');
  assert.equal(isVintage(il18), false,  '1978 line (48y): not yet vintage');
  assert.equal(isVintage(conc), false); assert.equal(eraDeliveredAgeWeeks(conc, null), 0, 'band-less classic conceit untouched');
  for (const t of AIRCRAFT_TYPES) {
    const v = isVintage(t);
    assert.equal(v, (t.deliveredAgeWeeks ?? 0) > 0 && t.oop != null && 2026 - t.oop >= VINTAGE_AFTER_YEARS, t.id);
    if (v) {
      const y = eraDeliveredAgeWeeks(t, null) / 52;
      assert.ok(y >= VINTAGE_AGE_FLOOR && y <= VINTAGE_AGE_CAP && y > (t.deliveredAgeWeeks ?? 0) / 52, `${t.id} ${y}y`);
      assert.equal(aircraftOrderable(t, null), t.withdrawnYear == null, `${t.id} orderable in classic`);
    } else {
      assert.equal(eraDeliveredAgeWeeks(t, null), t.deliveredAgeWeeks ?? 0, `${t.id} classic parity`);
    }
    assert.equal(eraDeliveredAgeWeeks(t, 2026), t.deliveredAgeWeeks ?? 0, `${t.id} era@2026 untouched`);
  }
  const vintage = AIRCRAFT_TYPES.filter(isVintage).map(t => t.id);
  assert.ok(vintage.includes('c47') && vintage.includes('dc4') && vintage.includes('l188') && vintage.includes('cv580'), vintage.join(','));
});

test('vintage rule in the reducer: a classic game buys a DC-4 at 30y old, cannot lease it, and never sees the Comet 1', () => {
  const classic = { ...freshState(), phase: 'playing', cash: 500_000_000, year: 1, week: 1 };
  assert.equal(orderDenial(classic, 'dc4'), null, 'on the market');
  assert.equal(leaseDenial(classic, 'dc4')?.code, 'vintage', 'buy-only');
  assert.equal(leaseDenial(classic, 'b737200'), null, 'June block still leases');
  const bought = gameReducer(classic, { type: 'BUY_AIRCRAFT', typeId: 'dc4' });
  assert.equal(bought.fleet.length, 1);
  assert.equal(bought.fleet[0].ageWeeks, 30 * 52, 'delivered at the vintage age');
  for (const action of [{ type: 'LEASE_AIRCRAFT', typeId: 'dc4' }, { type: 'ORDER_AIRCRAFT', typeId: 'dc4', quantity: 1, ownershipType: 'lease' }]) {
    const after = gameReducer(classic, action);
    assert.equal((after.fleet ?? []).length + (after.pendingOrders ?? []).length, 0, `${action.type}: no lease of vintage metal`);
  }
  const ordered = gameReducer(classic, { type: 'ORDER_AIRCRAFT', typeId: 'dc4', quantity: 1, ownershipType: 'owned' });
  assert.equal((ordered.pendingOrders ?? []).length, 1, 'owned order goes through');
  assert.equal(orderDenial(classic, 'comet1')?.code, 'withdrawn', 'grounded type has no market at any date');
  assert.equal(gameReducer(classic, { type: 'BUY_AIRCRAFT', typeId: 'comet1' }).fleet.length, 0);
});

test('every era opens with a real fleet — the propliner catalogue is in', () => {
  const at = (y) => AIRCRAFT_TYPES.filter(t => aircraftOrderable(t, y)).length;
  assert.equal(at(1950), 6, 'C-47, DC-3, DC-4, L-749, CV-240, Stratocruiser');
  assert.ok(at(1955) >= 10, `1955 should field 10+ types, got ${at(1955)}`);
  assert.ok(at(1958) >= 18, `1958 (jet age dawn) should field 18+, got ${at(1958)}`);
  assert.ok(at(1978) >= 48, `1978 should field 48+ types, got ${at(1978)}`);
  assert.ok(at(2000) >= 95, `2000 should field 95+ orderable types, got ${at(2000)}`);
  assert.equal(AIRCRAFT_TYPES.filter(t => aircraftOrderable(t, null)).length, AIRCRAFT_TYPES.length - 1, 'classic: the whole catalogue bar the grounded Comet 1');
});

// ── Reducer enforcement ──────────────────────────────────────────────────────

const era = (startYear, calYear) =>
  ({ ...freshState(), phase: 'playing', cash: 500_000_000, startYear, year: calYear - startYear + 1, week: 1, competitors: [] });

test('ORDER / LEASE / BUY all refuse a type that has not entered service', () => {
  const base = era(1950, 1950);
  assert.equal(orderDenial(base, 'b747400')?.code, 'not_yet_flying');
  for (const action of [
    { type: 'ORDER_AIRCRAFT', typeId: 'b747400', quantity: 1, ownershipType: 'owned' },
    { type: 'LEASE_AIRCRAFT', typeId: 'b747400' },
    { type: 'BUY_AIRCRAFT',   typeId: 'b747400' },
  ]) {
    const after = gameReducer(base, action);
    assert.equal(after.fleet.length, 0, `${action.type}: nothing may land`);
    assert.equal((after.pendingOrders ?? []).length, 0, `${action.type}: no order may be queued`);
    assert.equal(after.cash, base.cash, `${action.type}: no money may move`);
  }
});

test('expired lines are refused too: a 2040 game cannot buy DC-3s forever', () => {
  const st = era(1950, 2040);
  assert.equal(orderDenial(st, 'dc3')?.code, 'no_airworthy_frames');
  const after = gameReducer(st, { type: 'BUY_AIRCRAFT', typeId: 'dc3' });
  assert.equal(after.fleet.length, 0);
  assert.equal(aircraftOrderable(getAircraftType('dc3'), 2040), false);
  assert.equal(aircraftOrderable(getAircraftType('dc3'), 1960), true, 'fine while frames exist');
});

test('an in-service type is accepted, and arrives at the era-correct age', () => {
  const base = era(1978, 1978);
  assert.equal(orderDenial(base, 'b727200'), null);
  const bought = gameReducer(base, { type: 'BUY_AIRCRAFT', typeId: 'b727200' });
  assert.equal(bought.fleet.length, 1);
  assert.equal(bought.fleet[0].ageWeeks, 0, 'in production in 1978: factory-fresh');
  const late = gameReducer(era(1950, 2000), { type: 'BUY_AIRCRAFT', typeId: 'b727200' });
  assert.ok(late.fleet[0].ageWeeks > 0, 'the line closed in 1984: a 2000 frame is used');
  const classic = gameReducer({ ...freshState(), phase: 'playing', cash: 500_000_000, competitors: [] }, { type: 'BUY_AIRCRAFT', typeId: 'b727200' });
  assert.equal(classic.fleet[0].ageWeeks, getAircraftType('b727200').deliveredAgeWeeks, 'classic: published band');
});

test('classic games are untouched: orderDenial is always null', () => {
  const base = { ...freshState(), phase: 'playing', cash: 500_000_000 };
  assert.equal(orderDenial(base, 'b7779x'), null, 'even a 2027-eis type in a classic game');
});

test('the AI competitor sample is era-appropriate from the first week', () => {
  const typesIn = (s) => { const out = new Set(); for (const c of s.competitors) for (const r of Object.values(c.routes ?? {})) if (r.aircraftType) out.add(r.aircraftType); return [...out]; };
  const s1950 = gameReducer(undefined, { type: 'START_GAME', airlineName: 'A', hub: 'JFK', startYear: 1950 });
  const t1950 = typesIn(s1950);
  assert.ok(t1950.length > 0);
  assert.ok(t1950.every(t => (getAircraftType(t)?.eis ?? 0) <= 1950), `1950 rivals fly ${t1950.join(',')}`);
  const s1978 = gameReducer(undefined, { type: 'START_GAME', airlineName: 'A', hub: 'JFK', startYear: 1978 });
  assert.ok(typesIn(s1978).every(t => (getAircraftType(t)?.eis ?? 0) <= 1978));
  const classic = gameReducer(undefined, { type: 'START_GAME', airlineName: 'A', hub: 'JFK' });
  assert.ok(typesIn(classic).some(t => (getAircraftType(t)?.eis ?? 0) >= 2010), 'classic rivals fly the modern fleet');
});
