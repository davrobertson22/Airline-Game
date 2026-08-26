// P6 — Tailwinds drift sweep. No DB, no network, no render.
//   node tools/p6-drift-test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// ── localStorage mock (routeEconomics persists the profit basis) ─────────────
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};

let passed = 0, failed = 0;
const test = (name, fn) => { try { fn(); console.log(`  ✓ ${name}`); passed++; } catch (e) { console.log(`  ✗ ${name}\n      ${(e.stack || e.message).split('\n').slice(0, 4).join('\n      ')}`); failed++; } };
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

const { loadProfitBasis, saveProfitBasis, BASIS_CONTRIBUTION, BASIS_FULL } = await import('../src/utils/routeEconomics.js');

// ── hw_ → tw_ localStorage key, with a one-time migration ────────────────────
test('saveProfitBasis writes the Tailwinds-namespaced key, not the hw_ one', () => {
  store.clear();
  saveProfitBasis(BASIS_CONTRIBUTION);
  assert.equal(localStorage.getItem('tw_profit_basis_v1'), BASIS_CONTRIBUTION, 'must write tw_ key');
  assert.equal(localStorage.getItem('hw_profit_basis_v1'), null, 'must not write the hw_ key');
});

test('loadProfitBasis migrates a returning player from the legacy hw_ key', () => {
  store.clear();
  localStorage.setItem('hw_profit_basis_v1', BASIS_CONTRIBUTION); // old build's saved choice
  assert.equal(loadProfitBasis(), BASIS_CONTRIBUTION, 'legacy value is honoured');
  // and the new key still takes precedence when both exist
  localStorage.setItem('tw_profit_basis_v1', BASIS_FULL);
  assert.equal(loadProfitBasis(), BASIS_FULL, 'tw_ key wins over legacy hw_');
});

// ── Finance forecast uses the projection's hedged fuel multiplier ────────────
test('Finance forecast reads proj.fuelMultiplier, not the dead state.fuelMultiplier', () => {
  const src = read('../src/components/Finance.jsx');
  assert.ok(!/const fuelMultiplier = state\.fuelMultiplier/.test(src), 'still reads the never-written state.fuelMultiplier');
  assert.ok(/const fuelMultiplier = proj\.fuelMultiplier/.test(src), 'not switched to proj.fuelMultiplier');
});

// ── Fleet aircraft detail uses the hedged multiplier, not the raw spot index ──
test('Fleet aircraft detail routes fuel through effectiveFuelMultiplier', () => {
  const src = read('../src/components/Fleet.jsx');
  assert.ok(/effectiveFuelMultiplier/.test(src), 'does not import/use effectiveFuelMultiplier');
  assert.ok(!/state\.fuelPrice\?\.index \?\? state\.fuelMultiplier/.test(src), 'still passes the raw spot index to the sim');
});

console.log(`\np6-drift: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
