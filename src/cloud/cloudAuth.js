// Signing in to cloud saves with a Headwinds account.
//
// Supabase's browser client is loaded LAZILY — only when a player who has
// signed in before opens Save / Load, or clicks a sign-in button, or comes back
// from one. Nobody else downloads it, so the game's first load is unchanged.
//
// PKCE flow: a sign-in (Google, Discord or an emailed link) comes back to
// /?cloud=return&code=…, and the client swaps the code for a session using a
// verifier it left in this browser's storage. Query-string based, so it never
// collides with anything the game keeps in the URL hash. The catch, worth
// telling players: an email link must be opened in the browser that asked for it.
//
// Every browser dependency is a parameter with a real default, so the suite
// (tools/cloud-saves-test.mjs) can drive the return path without a browser
// and without the Supabase package.
import {
  CLOUD_SUPABASE_URL, CLOUD_SUPABASE_KEY, CLOUD_AUTH_STORAGE_KEY,
  CLOUD_RETURN_MODE_KEY, CLOUD_RETURN_PARAM, CLOUD_RETURN_VALUE,
} from './cloudConfig.js';

const win = () => (typeof window !== 'undefined' ? window : null);
const storage = () => { try { return win()?.localStorage ?? null; } catch { return null; } };

let clientPromise = null;

/** The Supabase client, created once, on first need. */
export function loadCloudClient() {
  if (!clientPromise) {
    clientPromise = import('@supabase/supabase-js').then(({ createClient }) =>
      createClient(CLOUD_SUPABASE_URL, CLOUD_SUPABASE_KEY, {
        auth: {
          flowType: 'pkce',
          storageKey: CLOUD_AUTH_STORAGE_KEY,
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      }));
    clientPromise.catch(() => { clientPromise = null; });   // a failed chunk load can be retried
  }
  return clientPromise;
}

/** Cheap check that needs no network and no Supabase: has this browser signed in before? */
export function hasStoredSession(store = storage()) {
  try { return !!store?.getItem(CLOUD_AUTH_STORAGE_KEY); } catch { return false; }
}

export function signInReturnUrl(loc = win()?.location) {
  return `${loc.origin}/?${CLOUD_RETURN_PARAM}=${CLOUD_RETURN_VALUE}`;
}

export function isSignInReturn(search = win()?.location?.search ?? '') {
  try { return new URLSearchParams(search).get(CLOUD_RETURN_PARAM) === CLOUD_RETURN_VALUE; } catch { return false; }
}

const RETURN_PARAMS = [CLOUD_RETURN_PARAM, 'code', 'error', 'error_code', 'error_description', 'state'];

/** The URL with the sign-in round trip's parameters taken out, so a reload does not replay it. */
export function cleanedReturnUrl(href) {
  const url = new URL(href);
  for (const p of RETURN_PARAMS) url.searchParams.delete(p);
  const q = url.searchParams.toString();
  return url.pathname + (q ? `?${q}` : '') + url.hash;
}

function rememberMode(mode, store = storage()) {
  try { store?.setItem(CLOUD_RETURN_MODE_KEY, mode === 'save' ? 'save' : 'load'); } catch { /* best effort */ }
}

function takeMode(store = storage()) {
  try {
    const m = store?.getItem(CLOUD_RETURN_MODE_KEY);
    store?.removeItem(CLOUD_RETURN_MODE_KEY);
    return m === 'save' ? 'save' : 'load';
  } catch { return 'load'; }
}

/**
 * Is there a PKCE verifier in this browser for a sign-in it started? Supabase
 * keeps it under `<storageKey>-code-verifier` (older) or
 * `<storageKey>-flow-<id>-code-verifier` (newer). Without one, the client does
 * not even attempt the exchange — it just comes back signed out — so this is
 * how "the email link was opened in another browser" is told apart.
 * Unknown storage → assume yes, and let the exchange report what it finds.
 */
export function hasPkceVerifier(store) {
  try {
    if (!store || typeof store.key !== 'function' || !Number.isFinite(store.length)) return true;
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (k && k.startsWith(CLOUD_AUTH_STORAGE_KEY) && k.endsWith('code-verifier')) return true;
    }
    return false;
  } catch { return true; }
}

const MSG = {
  verifier: 'That sign-in link was opened in a different browser from the one that asked for it. Ask for a new link here and open it in this browser.',
  generic: 'Signing in did not finish. Try again — and if it keeps happening, tell us on Discord.',
  unavailable: 'Cloud saves could not load. Check your connection and try again.',
};

/** Start a Google or Discord sign-in. Navigates away; comes back to /?cloud=return. */
export async function signInWithProvider(provider, mode, { load = loadCloudClient, loc = win()?.location, store = storage() } = {}) {
  rememberMode(mode, store);
  const sb = await load();
  const { error } = await sb.auth.signInWithOAuth({ provider, options: { redirectTo: signInReturnUrl(loc) } });
  if (error) throw new Error(error.message || MSG.generic);
}

/** Email a one-time sign-in link. */
export async function sendEmailLink(email, mode, { load = loadCloudClient, loc = win()?.location, store = storage() } = {}) {
  rememberMode(mode, store);
  const sb = await load();
  const { error } = await sb.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: signInReturnUrl(loc), shouldCreateUser: true },
  });
  if (error) throw new Error(error.message || MSG.generic);
}

/** The current session, or null. Never loads Supabase for a browser that has never signed in. */
export async function currentSession({ load = loadCloudClient, store = storage() } = {}) {
  if (!hasStoredSession(store) && !clientPromise) return null;
  try {
    const sb = await load();
    const { data } = await sb.auth.getSession();
    return data?.session ?? null;
  } catch { return null; }
}

/** A fresh access token for the API, or null when signed out. */
export async function accessToken(deps) {
  return (await currentSession(deps))?.access_token ?? null;
}

export async function signOut({ load = loadCloudClient } = {}) {
  try { const sb = await load(); await sb.auth.signOut(); } catch { /* the local session is what matters */ }
  try { storage()?.removeItem(CLOUD_AUTH_STORAGE_KEY); } catch { /* best effort */ }
}

/**
 * Finish a sign-in that came back to this page. Creating the client is what
 * exchanges the code (detectSessionInUrl); this then confirms a session exists
 * and strips the round-trip parameters from the address bar.
 *
 * @returns {Promise<{ mode: 'save'|'load', error: string|null, session: object|null }>}
 */
export async function completeSignInReturn({
  load = loadCloudClient, loc = win()?.location, history = win()?.history, store = storage(),
} = {}) {
  const params = new URLSearchParams(loc.search);
  const mode = takeMode(store);
  const providerError = params.get('error_description') || params.get('error');
  let session = null;
  let error = null;

  if (providerError) {
    error = `Signing in did not finish: ${providerError.replace(/\+/g, ' ')}`;
  } else if (params.get('code') && !hasPkceVerifier(store)) {
    error = MSG.verifier;
  } else {
    try {
      const sb = await load();
      // The code exchange runs inside the client's initialisation, and only
      // initialize() reports how it went — getSession() just comes back empty.
      const init = typeof sb.auth.initialize === 'function' ? await sb.auth.initialize() : null;
      const { data, error: e } = await sb.auth.getSession();
      session = data?.session ?? null;
      if (!session) {
        const text = String(init?.error?.message ?? e?.message ?? '');
        error = /verifier|code.?challenge|flow state/i.test(text) ? MSG.verifier : MSG.generic;
      }
    } catch {
      error = MSG.unavailable;
    }
  }
  try { history?.replaceState(history.state, '', cleanedReturnUrl(loc.href)); } catch { /* cosmetic */ }
  return { mode, error, session };
}

/** For a session, the name to show: the email, else whatever the provider gave. */
export function sessionLabel(session) {
  const u = session?.user;
  return u?.email || u?.user_metadata?.full_name || u?.user_metadata?.name || 'your Headwinds account';
}
