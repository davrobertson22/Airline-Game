/**
 * Durable-save I/O for Tailwinds — the one place that knows where a save lives.
 *
 * WHY THIS EXISTS
 * ───────────────
 * Saves used to be four full copies of the game state in localStorage: the
 * autosave at `bbae_save_v2` plus three manual slots, each slot record carrying
 * the entire state again under `gameState`. Chrome gives an origin 5 MiB of
 * localStorage counted in UTF-16, so every character costs two bytes, and a
 * mature airline's state is not small. Measured 2026-09-08 against a save
 * shaped like the one a player reported (started 1978, playing 1991, 279 routes,
 * 160 aircraft): 688 KB of JSON, so ~1.4 MB per copy. The autosave plus ONE
 * manual slot is already ~2.8 MB; asking for a second slot needs a third copy
 * and the write fails.
 *
 * That is exactly what the player saw, and the message he got — "delete another
 * save slot to make room" — was advice he could not take, because his other two
 * slots were already empty. The ceiling was the autosave and the one slot he had.
 *
 * IndexedDB has no such ceiling (origin quotas are measured in gigabytes) and
 * stores structured-clone objects directly, so there is no JSON.stringify in the
 * hot path at all.
 *
 * WHAT MAKES THIS SAFE
 * ────────────────────
 * The reader ALWAYS tries both stores, IndexedDB first, then localStorage. That
 * is permanent, not transitional: it is what lets a build that predates
 * IndexedDB — or a browser where IndexedDB is blocked — still find a save.
 *
 * Migration never deletes a localStorage original until it has written the
 * record to IndexedDB and READ IT BACK and checked it is the same save. No
 * readback, no delete. Deleting is the step that actually frees the quota, so
 * it is also the only step that can lose an airline.
 *
 * Fallback chain: IndexedDB → localStorage → in-memory. A save that fails is
 * worse than a small save, and the last rung keeps the existing honest "your
 * game is not being saved" toast working rather than throwing.
 *
 * ON-DISK SHAPES
 * ──────────────
 * In IndexedDB, one record per key:
 *
 *   { key, schema, savedAt, meta, state }
 *
 * `meta` is exactly what the Save/Load cards render, split out so the slot list
 * can be drawn without deserialising three whole game states. (It also removes
 * a duplication the old slot record had, storing customLogo at the top level
 * AND again inside gameState.)
 *
 * In localStorage the LEGACY shapes are preserved byte-for-byte — the autosave
 * is a bare `JSON.stringify(state)`, a slot is the old flat record with
 * `gameState` — so that an older build reading those keys sees exactly what it
 * has always seen. The translation lives in this file and nowhere else.
 */

// ── Keys ──────────────────────────────────────────────────────────────────────

export const AUTOSAVE_KEY = 'autosave';
export const SLOT_KEYS = ['slot_0', 'slot_1', 'slot_2'];
export const ALL_KEYS = [AUTOSAVE_KEY, ...SLOT_KEYS];

/** Legacy localStorage key for each logical key. Do not change these. */
const LEGACY_KEY = {
  autosave: 'bbae_save_v2',
  slot_0:   'bbae_slot_0',
  slot_1:   'bbae_slot_1',
  slot_2:   'bbae_slot_2',
};

/**
 * A few bytes in localStorage saying "this browser has a save".
 *
 * index.html decides whether the ?play deep link should skip the landing page,
 * in a blocking inline script before first paint. That script can never read
 * IndexedDB, so it reads this instead. Easy to forget; forgetting it ships as
 * "the ?play link stopped resuming my game".
 */
export const BREADCRUMB_KEY = 'bbae_has_save';

export const RECORD_SCHEMA = 1;

const DB_NAME = 'tailwinds-saves';
const DB_VERSION = 1;
const STORE_NAME = 'saves';

// ── Messages ──────────────────────────────────────────────────────────────────
// The write-result contract is `{ ok, reason?, message? }` and it is load-bearing:
// GameProvider raises a toast from it and SaveLoadModal renders it as a banner.
// Keep the shape.

const MSG = {
  quotaAutosave:
    'Your browser’s storage for this game is full, so your progress is no longer being saved automatically. Anything you do until then will be lost if you refresh.',
  quotaSlot:
    'Your browser’s storage for this game is full. Deleting a save slot may make room — but if your other slots are already empty, the game itself has outgrown what this browser will store.',
  unavailable:
    'This browser is not allowing the game to store data. Private browsing usually causes this.',
  errorAutosave:
    'Your progress could not be saved. Anything you do from here will be lost if you refresh.',
  errorSlot:
    'That slot could not be written. Your game is unchanged.',
};

/** Browsers disagree on how they report a full store: name, legacy code 22, Firefox's 1014. */
function isQuotaError(err) {
  return !!err && (
    err.name === 'QuotaExceededError' ||
    err.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    err.code === 22 || err.code === 1014
  );
}

function failure(err, key) {
  const slot = key !== AUTOSAVE_KEY;
  if (isQuotaError(err)) {
    return { ok: false, reason: 'quota', message: slot ? MSG.quotaSlot : MSG.quotaAutosave };
  }
  return { ok: false, reason: 'error', message: slot ? MSG.errorSlot : MSG.errorAutosave };
}

// ── Record helpers ────────────────────────────────────────────────────────────

/** The fields the Save/Load cards render. Cheap to read, no game state attached. */
export function metaFromState(state) {
  return {
    airlineName: state?.airlineName,
    logoId:      state?.logoId,
    logoColor:   state?.logoColor,
    customLogo:  state?.customLogo ?? null,
    hub:         state?.hub,
    cash:        state?.cash,
    week:        state?.week,
    year:        state?.year,
    startYear:   state?.startYear,
  };
}

export function makeRecord(key, state, savedAt = Date.now()) {
  return { key, schema: RECORD_SCHEMA, savedAt, meta: metaFromState(state), state };
}

/**
 * Is this readback the record we just wrote?
 *
 * Deliberately cheap and deliberately not a deep compare: migration runs at boot
 * on a state that can be most of a megabyte, and a deep equality check there
 * would cost more than the migration. These fields together do not collide
 * between two different saves of the same airline in practice, and the point is
 * to catch a write that silently did not land — a truncated record, a store that
 * accepted and dropped it — not to detect a one-dollar difference in cash.
 */
function sameSave(a, b) {
  if (!a || !b || !a.state || !b.state) return false;
  return a.savedAt === b.savedAt
    && a.state.week  === b.state.week
    && a.state.year  === b.state.year
    && a.state.cash  === b.state.cash
    && a.state.airlineName === b.state.airlineName
    && (a.state.routes?.length ?? 0) === (b.state.routes?.length ?? 0)
    && (a.state.fleet?.length  ?? 0) === (b.state.fleet?.length  ?? 0);
}

// ── Backend: localStorage, in the LEGACY on-disk shapes ───────────────────────

export function localStorageBackend(storage) {
  if (!storage) return null;
  return {
    name: 'localStorage',

    async read(key) {
      const raw = storage.getItem(LEGACY_KEY[key]);
      if (!raw) return null;
      let parsed;
      try { parsed = JSON.parse(raw); } catch { return null; }
      if (!parsed || typeof parsed !== 'object') return null;
      if (key === AUTOSAVE_KEY) {
        // The autosave was stored as the bare state, with no envelope.
        return { key, schema: RECORD_SCHEMA, savedAt: null, meta: metaFromState(parsed), state: parsed };
      }
      // A slot was a flat record with the state under `gameState`.
      const state = parsed.gameState;
      if (!state) return null;
      // The flat record is the authority on the branding it carried, but it
      // predates `startYear` in meta — so overlay only the fields it actually
      // has, or an era save loses the calendar year its cards are labelled by.
      const meta = metaFromState(state);
      for (const [k, v] of Object.entries(metaFromState(parsed))) {
        if (v !== undefined) meta[k] = v;
      }
      return { key, schema: RECORD_SCHEMA, savedAt: parsed.savedAt ?? null, meta, state };
    },

    async write(key, record) {
      try {
        storage.setItem(
          LEGACY_KEY[key],
          key === AUTOSAVE_KEY
            ? JSON.stringify(record.state)
            : JSON.stringify({ ...record.meta, savedAt: record.savedAt, gameState: record.state }),
        );
        return { ok: true };
      } catch (err) {
        return failure(err, key);
      }
    },

    async delete(key) {
      try { storage.removeItem(LEGACY_KEY[key]); } catch { /* nothing to undo */ }
    },

    async listMeta() {
      const out = {};
      for (const key of ALL_KEYS) {
        const rec = await this.read(key);
        if (rec) out[key] = { ...rec.meta, savedAt: rec.savedAt };
      }
      return out;
    },
  };
}

// ── Backend: IndexedDB ────────────────────────────────────────────────────────

function promisifyRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror   = () => reject(request.error);
  });
}

/**
 * Open the database, or resolve null if IndexedDB is not usable here.
 *
 * Blocked IndexedDB is not exotic: some Safari private-browsing modes and a
 * number of embedded webviews expose the global and then throw or hang on open.
 * A hang is the nastier failure — it would leave the game stuck on its hydrate
 * screen forever — so the open races a timeout and falls through to
 * localStorage rather than waiting.
 */
async function openDatabase(idbFactory, timeoutMs = 3000) {
  if (!idbFactory) return null;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => { if (!settled) { settled = true; resolve(value); } };
    const timer = setTimeout(() => finish(null), timeoutMs);
    let request;
    try {
      request = idbFactory.open(DB_NAME, DB_VERSION);
    } catch {
      clearTimeout(timer);
      finish(null);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: 'key' });
    };
    request.onsuccess = () => {
      clearTimeout(timer);
      const db = request.result;
      // Let another tab upgrade the database instead of being blocked by this
      // one. Without this, a future DB_VERSION bump deadlocks every player who
      // keeps two tabs open: the new tab's open blocks, times out, and demotes
      // itself to localStorage — where its writes would then be shadowed by the
      // older IndexedDB save the reader prefers. Found by driving this file in a
      // real browser (2026-09-08), where a pending deleteDatabase against a
      // still-open connection reproduced exactly that demotion.
      db.onversionchange = () => { try { db.close(); } catch { /* already gone */ } };
      finish(db);
    };
    request.onerror   = () => { clearTimeout(timer); finish(null); };
    request.onblocked = () => { clearTimeout(timer); finish(null); };
  });
}

/**
 * Open, and if that comes back empty give it one more go before giving up.
 *
 * A blocked or slow first open is usually transient — another tab mid-upgrade,
 * a delete still draining. Demoting to localStorage on the strength of one
 * attempt is the expensive mistake, because the demoted tab writes somewhere the
 * reader does not prefer.
 */
async function openDatabaseWithRetry(idbFactory) {
  const first = await openDatabase(idbFactory);
  if (first) return first;
  if (!idbFactory) return null;
  return openDatabase(idbFactory);
}

export function indexedDbBackend(db) {
  if (!db) return null;
  const tx = (mode) => db.transaction(STORE_NAME, mode).objectStore(STORE_NAME);
  return {
    name: 'indexedDB',

    async read(key) {
      try {
        const rec = await promisifyRequest(tx('readonly').get(key));
        return rec ?? null;
      } catch { return null; }
    },

    async write(key, record) {
      try {
        await promisifyRequest(tx('readwrite').put({ ...record, key }));
        return { ok: true };
      } catch (err) {
        return failure(err, key);
      }
    },

    async delete(key) {
      try { await promisifyRequest(tx('readwrite').delete(key)); } catch { /* nothing to undo */ }
    },

    async listMeta() {
      const out = {};
      for (const key of ALL_KEYS) {
        const rec = await this.read(key);
        if (rec) out[key] = { ...rec.meta, savedAt: rec.savedAt };
      }
      return out;
    },
  };
}

// ── Backend: memory (last rung) ───────────────────────────────────────────────

/**
 * The last rung: keeps saves for the life of the tab and nothing longer.
 *
 * It RETAINS what it is given — so loading a slot you saved this session still
 * works, and the game does not degrade mid-play — but it reports every write as
 * a failure, because a save that dies with the tab is not a save and the player
 * has to be told. This is what raises "your game is not being saved" in a
 * browser that allows neither IndexedDB nor localStorage, which is usually
 * private browsing. Reporting success here would be the original swallowed-error
 * bug wearing a different coat.
 */
export function memoryBackend() {
  const map = new Map();
  return {
    name: 'memory',
    async read(key)          { return map.get(key) ?? null; },
    async write(key, record) {
      map.set(key, { ...record, key });
      return { ok: false, reason: 'unavailable', message: MSG.unavailable };
    },
    async delete(key)        { map.delete(key); },
    async listMeta() {
      const out = {};
      for (const [key, rec] of map) out[key] = { ...rec.meta, savedAt: rec.savedAt };
      return out;
    },
  };
}

// ── The store ─────────────────────────────────────────────────────────────────

/**
 * Open the save store, migrating a localStorage save into IndexedDB if one is
 * there and IndexedDB is usable.
 *
 * Every dependency is injectable so the whole thing is testable without a
 * browser and without pulling in fake-indexeddb — this repo has no
 * devDependencies and it is worth keeping that way.
 */
export async function openSaveStore(env = {}) {
  const {
    indexedDB: idbFactory = (typeof indexedDB   !== 'undefined' ? indexedDB   : null),
    localStorage: storage = (typeof localStorage !== 'undefined' ? localStorage : null),
    navigator: nav        = (typeof navigator   !== 'undefined' ? navigator   : null),
    migrate = true,
  } = env;

  // Test seam. The suite exercises the store's own logic — dual-read precedence,
  // migration ordering, the write-result contract — against in-memory backends,
  // so it needs neither a browser nor fake-indexeddb (this repo has no
  // devDependencies and it is worth keeping that way). Real callers never pass it.
  const db    = env.backends ? null : await openDatabaseWithRetry(idbFactory);
  const idb   = env.backends ? (env.backends.idb   ?? null) : indexedDbBackend(db);
  const local = env.backends ? (env.backends.local ?? null) : localStorageBackend(storage);
  const primary  = idb ?? local ?? memoryBackend();
  // The fallback is only consulted for READS, and only when it is a different
  // store from the primary. This is the dual-read that makes rollback survivable.
  const fallback = (idb && local) ? local : null;

  const setBreadcrumb = (present) => {
    if (!storage) return;
    try {
      if (present) storage.setItem(BREADCRUMB_KEY, '1');
      else storage.removeItem(BREADCRUMB_KEY);
    } catch { /* a breadcrumb is not worth failing a save over */ }
  };

  const store = {
    backendName: primary.name,
    migrated: [],

    /** IndexedDB first, then localStorage. A record in the primary always wins. */
    async read(key) {
      const found = await primary.read(key);
      if (found) return found;
      return fallback ? fallback.read(key) : null;
    },

    async write(key, record) {
      const result = await primary.write(key, record);
      if (result.ok && key === AUTOSAVE_KEY) setBreadcrumb(true);
      return result;
    },

    async delete(key) {
      await primary.delete(key);
      if (fallback) await fallback.delete(key);
      if (key === AUTOSAVE_KEY) setBreadcrumb(false);
    },

    /** Cheap enough to call on every open of the Save/Load modal. */
    async listMeta() {
      const merged = fallback ? await fallback.listMeta() : {};
      return { ...merged, ...(await primary.listMeta()) };
    },

    /** { usage, quota } in bytes, or null where the browser does not say. */
    async estimate() {
      try {
        if (!nav?.storage?.estimate) return null;
        const { usage, quota } = await nav.storage.estimate();
        return { usage: usage ?? null, quota: quota ?? null };
      } catch { return null; }
    },
  };

  if (migrate && idb && local) store.migrated = await migrateLocalToIdb(idb, local, setBreadcrumb);
  else if (await store.read(AUTOSAVE_KEY)) setBreadcrumb(true);

  return store;
}

/**
 * Copy localStorage saves into IndexedDB, then delete the originals.
 *
 * Idempotent: a key already present in IndexedDB is left alone, and the
 * localStorage copy of it is removed (a second run has nothing to do). Never
 * deletes before a verified readback — that ordering is the whole safety
 * argument, so it is written out in full rather than chained.
 *
 * @returns {string[]} keys that were migrated on this run
 */
export async function migrateLocalToIdb(idb, local, setBreadcrumb = () => {}) {
  const migrated = [];
  for (const key of ALL_KEYS) {
    const legacy = await local.read(key);
    if (!legacy) continue;

    const existing = await idb.read(key);
    if (existing) {
      // Already migrated on an earlier boot. The IndexedDB copy is authoritative,
      // so the localStorage one is dead weight in a 5 MiB budget.
      await local.delete(key);
      continue;
    }

    // A legacy autosave has no savedAt of its own — stamp one so the readback
    // check has something to compare, and so the slot list can show a date.
    const record = legacy.savedAt == null ? { ...legacy, savedAt: Date.now() } : legacy;

    const written = await idb.write(key, record);
    if (!written.ok) continue;                       // keep the original

    const readback = await idb.read(key);
    if (!sameSave(record, readback)) continue;       // keep the original

    await local.delete(key);
    migrated.push(key);
  }
  if (migrated.length) setBreadcrumb(true);
  return migrated;
}
