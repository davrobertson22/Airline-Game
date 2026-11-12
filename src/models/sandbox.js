// ─────────────────────────────────────────────────────────────────────────────
// SANDBOX MODE (Tailwinds only; Discord, Xen, 2026-11-12: "a great way to try
// out everything: aeroplanes, marketing, loyalty and so on, or to give
// yourself a set amount of money to start with").
//
// Chosen at new game and fixed for the life of the game: a save carries
// `sandbox: true` from START_GAME and nothing ever switches it on or off.
// It changes two things, and nothing else about the simulation:
//
//   1. Starting money. The player picks it (presets or a typed amount)
//      instead of the usual $10M. Era games scale it by the era's capital
//      scale, exactly as they scale the normal $10M.
//   2. Instant deliveries, if ticked at setup (`sandboxInstantDelivery`).
//      An order arrives the moment it is signed: it takes no production-line
//      slot, owned frames are paid in full at signing (there is nothing to
//      stage payments against), and crew hired by the airline start work at
//      once instead of training, so the aircraft can actually fly. A launch
//      order still waits for the type's entry into service: the aircraft
//      does not exist before then.
//
// Bankruptcy, rivals, events, demand and costs are all the normal game.
// ─────────────────────────────────────────────────────────────────────────────

export const SANDBOX_DEFAULT_CASH = 10_000_000;
export const SANDBOX_CASH_PRESETS = [10_000_000, 50_000_000, 250_000_000, 1_000_000_000];
export const SANDBOX_CASH_MIN = 1_000_000;
export const SANDBOX_CASH_MAX = 10_000_000_000;

/** The starting money a sandbox game opens with, before any era scaling. */
export function sandboxStartCash(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return SANDBOX_DEFAULT_CASH;
  const whole = Math.round(n / 100_000) * 100_000;
  return Math.min(SANDBOX_CASH_MAX, Math.max(SANDBOX_CASH_MIN, whole));
}

/** Parse what a player typed ("250m", "$1.5B", "40,000,000") into dollars, or null. */
export function parseSandboxCash(text) {
  const t = String(text ?? '').trim().toLowerCase().replace(/[$,\s]/g, '');
  const m = t.match(/^(\d+(?:\.\d+)?)(k|m|mn|b|bn)?$/);
  if (!m) return null;
  const mult = { k: 1e3, m: 1e6, mn: 1e6, b: 1e9, bn: 1e9 }[m[2]] ?? 1;
  const v = Number(m[1]) * mult;
  return Number.isFinite(v) && v > 0 ? v : null;
}

export const isSandbox = (state) => state?.sandbox === true;

/** Orders arrive at signing and crew start work at hire. */
export const instantDeliveryOn = (state) =>
  state?.sandbox === true && state?.sandboxInstantDelivery === true;
