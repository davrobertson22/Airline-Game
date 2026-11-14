// History pop-up setting — 'all' | 'major' | 'off'.
// ----------------------------------------------------------------------------
// Era games show aviation-history milestones (data/historyMilestones.js) in the
// News tab always, and as a pop-up card when this setting lets them through:
//   all   — every milestone (about one every two years of game time)
//   major — the big moments only, plus any airliner you are a launch customer of
//   off   — no pop-ups; the News tab still has them all
// Device-local, like the alert settings (alertPrefs.js), and kept out of the
// save so it never changes game state.

export const HISTORY_PREFS_KEY = 'history_popups_v1';
export const HISTORY_MODES = [
  { id: 'all',   label: 'All' },
  { id: 'major', label: 'Major only' },
  { id: 'off',   label: 'Off' },
];
export const DEFAULT_HISTORY_MODE = 'all';

const VALID = new Set(HISTORY_MODES.map(m => m.id));
const listeners = new Set();

export function normalizeHistoryMode(v) {
  return VALID.has(v) ? v : DEFAULT_HISTORY_MODE;
}

export function loadHistoryMode() {
  try { return normalizeHistoryMode(globalThis.localStorage?.getItem(HISTORY_PREFS_KEY)); }
  catch { return DEFAULT_HISTORY_MODE; }
}

/** Save the setting and tell every open control (the card and the News tab). */
export function saveHistoryMode(v) {
  const mode = normalizeHistoryMode(v);
  try { globalThis.localStorage?.setItem(HISTORY_PREFS_KEY, mode); } catch { /* private mode */ }
  for (const fn of listeners) fn(mode);
  return mode;
}

export function subscribeHistoryMode(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
