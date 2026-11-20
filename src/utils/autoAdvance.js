// How often the game advances a week on its own (Discord, 2026-11-18: "instead
// of leaving it at 60m for everyone, let us change it").
//
// A per-browser preference, not part of the save: it describes how the player
// likes to play on this machine, the same as the map style or pop-up settings.
// 0 means auto-advance is off and weeks only move on Next Week.
//
// Plain JS, no JSX, so tools/ tests can import it without a transform.

export const AUTO_ADVANCE_KEY = 'tw_auto_advance_min';
export const DEFAULT_AUTO_ADVANCE_MIN = 60;
export const MIN_AUTO_ADVANCE_MIN = 1;
export const MAX_AUTO_ADVANCE_MIN = 24 * 60;

// The picker's ready-made choices, in minutes. 0 = off.
export const AUTO_ADVANCE_PRESETS = [5, 10, 15, 30, 60, 120, 240, 480, 1440, 0];

/** A stored or typed value → whole minutes in range, 0 for off, or the
 *  default when it is not a number at all. */
export function normalizeAutoAdvanceMin(v) {
  if (v === 0 || v === '0' || v === 'off') return 0;
  const x = Number(v);
  if (v == null || v === '' || !Number.isFinite(x)) return DEFAULT_AUTO_ADVANCE_MIN;
  if (x <= 0) return 0;
  return Math.min(MAX_AUTO_ADVANCE_MIN, Math.max(MIN_AUTO_ADVANCE_MIN, Math.round(x)));
}

/** "Off", "45 min", "1 h", "1 h 30 min", "24 h". */
export function autoAdvanceLabel(min) {
  const m = normalizeAutoAdvanceMin(min);
  if (m === 0) return 'Off';
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0) return `${r} min`;
  return r ? `${h} h ${r} min` : `${h} h`;
}

/** The interval in ms, or null when auto-advance is off. */
export function autoAdvanceMs(min) {
  const m = normalizeAutoAdvanceMin(min);
  return m === 0 ? null : m * 60_000;
}

export function loadAutoAdvanceMin(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(AUTO_ADVANCE_KEY);
    return raw == null ? DEFAULT_AUTO_ADVANCE_MIN : normalizeAutoAdvanceMin(raw);
  } catch { return DEFAULT_AUTO_ADVANCE_MIN; }
}

export function saveAutoAdvanceMin(min, storage = globalThis.localStorage) {
  try { storage?.setItem(AUTO_ADVANCE_KEY, String(normalizeAutoAdvanceMin(min))); } catch { /* private mode */ }
}

/**
 * When the next week is due, given a saved due time (ms or null).
 *
 * - Off → Infinity: the timer never fires and the countdown says so.
 * - A saved time still in the future and no further away than one interval is
 *   kept, so a reload does not restart the clock.
 * - Anything else (none saved, already past, or further out than the interval
 *   now allows because the player shortened it) → one full interval from now.
 *   A past time is NOT caught up: weeks never fly while the tab is closed.
 */
export function nextDueAt(now, min, savedTs = null) {
  const ms = autoAdvanceMs(min);
  if (ms == null) return Infinity;
  const ts = Number(savedTs);
  if (Number.isFinite(ts) && ts > now && ts <= now + ms) return ts;
  return now + ms;
}
