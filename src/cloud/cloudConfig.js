// Where Tailwinds cloud saves live — a supporter perk served by the Headwinds
// API (apps/headwinds-server/src/lib/cloudSaves.mjs in the Headwinds repo).
// Design: docs/cloud-save-design.md.
//
// Players sign in with their HEADWINDS account: the same Supabase project, the
// same Google / Discord / email-link login. These two values are public by
// design — Supabase's publishable key is shipped to every Headwinds visitor —
// so they are constants here rather than build-time secrets.
export const CLOUD_SUPABASE_URL = 'https://krlvgiupfftzdvtlpxor.supabase.co';
export const CLOUD_SUPABASE_KEY = 'sb_publishable___0f6ANUfJK0uMXdFXeCvA_vbK7Te8B';

// The Headwinds API. VITE_TW_CLOUD_API points a dev build at a local server
// (`npm run -w @headwinds/server dev` → http://localhost:8787).
export const CLOUD_API_BASE =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_TW_CLOUD_API) ||
  'https://api.headwindsairlinegame.com';

/** localStorage key the Supabase session is kept under (its own, not Headwinds'). */
export const CLOUD_AUTH_STORAGE_KEY = 'tw.cloud.auth';
/** Which Save/Load mode to reopen after a sign-in round trip. */
export const CLOUD_RETURN_MODE_KEY = 'tw.cloud.returnMode';
/** The query flag a sign-in redirect comes back with: /?cloud=return&code=… */
export const CLOUD_RETURN_PARAM = 'cloud';
export const CLOUD_RETURN_VALUE = 'return';

export const CLOUD_SLOTS = 3;

// ── Launch switch ─────────────────────────────────────────────────────────────
// Cloud saves stay hidden until launch: database backups verified, and the
// privacy, terms and support pages updated (docs/cloud-save-design.md §7).
// Launched by flipping this to true (the launch commit, alongside the support,
// privacy, terms, FAQ and devlog copy).
//
// Before launch, anyone could preview on the live site: open
// https://www.tailwindsairlinegame.com/?cloudpreview=1 once and it sticks in
// that browser; ?cloudpreview=0 turns it off again.
export const CLOUD_SAVES_LIVE = true;
const PREVIEW_KEY = 'tw.cloud.preview';

export function cloudSavesEnabled(
  win = (typeof window !== 'undefined' ? window : null),
  live = CLOUD_SAVES_LIVE,
) {
  if (live) return true;
  try {
    const store = win?.localStorage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
    const flag = new URLSearchParams(win?.location?.search ?? '').get('cloudpreview');
    if (flag === '1') store?.setItem(PREVIEW_KEY, '1');
    if (flag === '0') store?.removeItem(PREVIEW_KEY);
    return store?.getItem(PREVIEW_KEY) === '1';
  } catch { return false; }
}
