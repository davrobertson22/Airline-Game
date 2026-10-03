// Targeted test for the BULK_RESET_PRICING reducer action (selection bar "Reset to ref").
// Run with: node --import ./tools/_register-loader.mjs tools/bulk-reset-pricing-test.mjs
import { gameReducer } from '../src/store/GameContext.jsx';
import { routePairKey, CLASS_FARE_MULTIPLIERS } from '../src/utils/simulation.js';
import { referencePrice } from '../src/utils/market.js';
import { referenceClassPrices } from '../src/components/FareEditor.jsx';

let pass = 0, fail = 0;
const ok = (name, cond) => { cond ? (pass++, console.log('  ✓', name)) : (fail++, console.log('  ✗', name)); };

const r1  = { id: 'r1',  origin: 'JFK', destination: 'LAX', aircraftId: 'a1', weeklyFrequency: 7 };
const r1b = { id: 'r1b', origin: 'LAX', destination: 'JFK', aircraftId: 'a3', weeklyFrequency: 7 };
const r2  = { id: 'r2',  origin: 'ORD', destination: 'MIA', aircraftId: 'a2', weeklyFrequency: 7 };
const r3  = { id: 'r3',  origin: 'SYD', destination: 'MEL', aircraftId: 'a4', weeklyFrequency: 7 };
const k1 = routePairKey('JFK', 'LAX');
const k2 = routePairKey('ORD', 'MIA');
const k3 = routePairKey('SYD', 'MEL');

const offRef = { economy: 999, premiumEconomy: 1500, businessClass: 2500, firstClass: 4000 };
const baseState = {
  routes: [r1, r1b, r2, r3],
  routePricing: { [k1]: { ...offRef }, [k2]: { ...offRef }, [k3]: { ...offRef } },
};

const expectRef = (o, d) => {
  const refP = referencePrice(o, d);
  const out = {};
  for (const [cls, m] of Object.entries(CLASS_FARE_MULTIPLIERS)) out[cls] = Math.round(refP * m);
  return out;
};
const same = (a, b) => Object.keys(b).every(k => a?.[k] === b[k]);

console.log('\n── BULK_RESET_PRICING ───────────────────');

{
  const next = gameReducer(baseState, { type: 'BULK_RESET_PRICING', routeIds: ['r1', 'r2'] });
  ok('selected pair 1 reset to reference on every cabin', same(next.routePricing[k1], expectRef('JFK', 'LAX')));
  ok('selected pair 2 reset to reference on every cabin', same(next.routePricing[k2], expectRef('ORD', 'MIA')));
  ok('unselected pair untouched', same(next.routePricing[k3], offRef));
  ok('does not mutate original state', same(baseState.routePricing[k1], offRef));
  ok('matches the fare editor\'s reference fares exactly (no "Reset to ref" left showing)',
    same(next.routePricing[k1], referenceClassPrices('JFK', 'LAX')));
}

{
  const next = gameReducer(baseState, { type: 'BULK_RESET_PRICING', routeIds: ['r1b'] });
  ok('reverse-direction route resets the shared pair', same(next.routePricing[k1], expectRef('JFK', 'LAX')));
}

{
  const st = { ...baseState, routePricing: { [k2]: { ...offRef } } };
  const next = gameReducer(st, { type: 'BULK_RESET_PRICING', routeIds: ['r1'] });
  ok('pair with no stored pricing gets reference fares', same(next.routePricing[k1], expectRef('JFK', 'LAX')));
}

{
  const st = { ...baseState, routePricing: { ...baseState.routePricing, [k1]: { ...offRef, extra: 'keep' } } };
  const next = gameReducer(st, { type: 'BULK_RESET_PRICING', routeIds: ['r1'] });
  ok('other keys on the pair price set are preserved', next.routePricing[k1].extra === 'keep');
}

{
  const a = gameReducer(baseState, { type: 'BULK_RESET_PRICING', routeIds: [] });
  const b = gameReducer(baseState, { type: 'BULK_RESET_PRICING', routeIds: ['nope'] });
  const c = gameReducer(baseState, { type: 'BULK_RESET_PRICING' });
  ok('empty routeIds is a no-op', a === baseState);
  ok('unknown routeId is a no-op', b === baseState);
  ok('missing routeIds is a no-op', c === baseState);
}

console.log('\n───────────────────────────────────────');
console.log(`  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
