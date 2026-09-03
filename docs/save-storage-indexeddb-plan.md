# Save storage — moving Tailwinds off the 5 MB localStorage wall

Status: **plan, not built.** Written 2026-08-27 after a player (Nick) reported
autosave had stopped because browser storage was full, and deleting save slots
only bought him a little time.

---

## 1. The problem, measured

Probed with `tools/_probe-save-growth.mjs` against the real reducer, ticking a
started game forward with no player activity (so this is a **floor**, not a
worst case — a real airline adds fleet, routes, hubs and cabin templates on top):

| Game age | Autosave JSON | Biggest contributors |
|---|---|---|
| Year 1 | 218 KB | newsLog 77, competitors 73, financialHistory 46 |
| Year 5 | 357 KB | competitors 123, newsLog 110, statsHistory 71 |
| Year 10 | 440 KB | statsHistory 143, competitors 132, newsLog 113 |
| Year 20 | **615 KB** | statsHistory 287, competitors 175, newsLog 118 |

Three of the four big keys are capped and plateau (`newsLog` at
`NEWS_LOG_CAP` 250, `financialHistory` at 52 weeks). **`statsHistory` is the
one that never stops** — `STATS_HISTORY_CAP` is 1820 entries, i.e. 35 game
years, ~275 bytes a week, and it is the largest key in any save past year 10.

Now multiply. Chrome gives an origin **5 MiB of localStorage, counted in
UTF-16**, so every character costs two bytes. And the game keeps **four full
copies of the state**:

- `bbae_save_v2` — the autosave (`GameContext.jsx:4179`)
- `bbae_slot_0/1/2` — manual slots, each a record whose `gameState` field is
  the entire state again (`SaveLoadModal.jsx:33`)

```
615 KB x 2 (UTF-16) x 4 copies  ≈  4.8 MB  →  quota exceeded at ~5 MB
```

That is Nick exactly. Deleting slots frees three of the four copies, which is
why it works — and why it is temporary: the autosave alone keeps growing.

The good news is that the game already **handles** the failure honestly:
`persistAutosave` and `writeSlot` both detect `QuotaExceededError` and surface
a real message rather than swallowing it. Nick got told the truth. He just has
nothing he can do about it.

---

## 2. Goal and non-goals

**Goal:** remove the storage ceiling as a thing players can hit, without
changing how saving feels.

**Non-goals for this work:**

- Shrinking the state. `statsHistory` downsampling is a good idea on its own
  merits (see §8) but it is not the fix, and doing it here would confuse a
  storage migration with a data-model change.
- Compressing saves. Worth 10.4x (measured: 615 KB → 59 KB gzip+base64) and
  ~30 lines, but it is a **postponement** — and inside IndexedDB it is not
  needed, because IndexedDB stores structured-clone objects directly and the
  quota is orders of magnitude larger. Compressing there would only make saves
  unreadable in devtools for no gain. See §9 if we want it as a stopgap first.
- Server-side saves / accounts. That is Headwinds' job, not Tailwinds'.

---

## 3. What moves and what stays

Everything in `src` that touches localStorage, and its verdict:

| Key | Where | Size | Verdict |
|---|---|---|---|
| `bbae_save_v2` | `GameContext.jsx:4179` | up to ~600 KB+ | **→ IndexedDB** |
| `bbae_slot_0..2` | `SaveLoadModal.jsx:8` | up to ~600 KB+ each | **→ IndexedDB** |
| `bbae_tour_seen_v3` | `OnboardingTour.jsx:9` | a few bytes | stays |
| `bbae_hint_*` | `Callout.jsx:23` | a few bytes | stays |
| `market_layout` | `Marketplace.jsx:610` | tiny | stays |
| `tw_profit_basis_v1` | `routeEconomics.js:72` | tiny | stays |
| `hw_last_seen_week_v1*` | `awayDigest.js:49` | tiny | stays |
| `airline_next_week_at` | `App.jsx:206` | one integer | stays |

Only two things are big. Everything else is a UI flag where synchronous
localStorage is genuinely the better tool — moving them would add async
plumbing for no benefit.

---

## 4. Target design

One new module, `src/store/saveStore.js`, owning all durable-save I/O.

```js
// Record shape — one per key, structured-cloned into IndexedDB as an object.
// No JSON.stringify anywhere in this path.
{
  key:      'autosave' | 'slot_0' | 'slot_1' | 'slot_2',
  schema:   1,               // record-envelope version, not game-state version
  savedAt:  1756330000000,
  meta:     { airlineName, logoId, logoColor, customLogo, hub, cash, week, year },
  state:    { ...full game state }
}
```

`meta` is exactly what the Save/Load cards render today, split out so the slot
list can be drawn without deserialising four full game states. (It also fixes
a small existing duplication: today `writeSlot` stores `customLogo` at the top
level *and* again inside `gameState`.)

**Public API** — all async:

```js
openSaveStore(backend?)      // resolves a store; falls back automatically
store.read(key)              // → record | null
store.write(key, record)     // → { ok, reason?, message? }   (same shape as today)
store.delete(key)
store.listMeta()             // → { [key]: meta } — cheap, for the slot list
store.estimate()             // → { usage, quota } via navigator.storage.estimate()
```

**Backend is injectable**, following the pattern `persistAutosave(state,
storage = localStorage)` already established at `GameContext.jsx:4419`. That
gives us testability without adding `fake-indexeddb` — this repo has **zero
devDependencies** today and I would like to keep it that way.

**Fallback chain, in order:**

1. IndexedDB (primary)
2. localStorage (some Safari private-browsing modes and embedded webviews
   block IDB; a save that fails is worse than a small save)
3. in-memory (last resort — the existing "not being saved" toast fires)

**The reader always tries both stores.** IndexedDB first, then localStorage.
This is what makes rollback survivable — see §7.

Keep the write-result contract (`{ok, reason, message}`) exactly as it is, so
the honest quota/failure toasts in `GameProvider` and the `saveError` banner in
`SaveLoadModal` keep working unchanged.

---

## 5. Five things in the current code that make this non-trivial

These are the whole cost of the migration. None is hard; all are easy to miss.

### 5a. Boot is synchronous, inside `useReducer`'s initialiser

```js
// GameContext.jsx:4440
const [state, dispatch] = useReducer(reducer, null, () => {
  const saved = localStorage.getItem(SAVE_KEY);
  if (saved) return reconcileState(JSON.parse(saved));
  return freshState();
});
```

IndexedDB cannot answer synchronously. `GameProvider` needs a hydration phase:
start at `freshState()` with a `hydrating: true` flag, dispatch
`{type:'LOAD_STATE'}` when the read resolves (that action already exists,
`GameContext.jsx:4162`, and already runs `reconcileState`), and render nothing
game-shaped until then.

**This is much cheaper here than in a typical app**, because of the landing
page: `index.html` hides `#root` entirely (`#root { display: none }`,
line 31) until the player clicks "Play Free Now". The hydrate happens behind
the front door. For the overwhelming majority of visits there is no visible
loading state at all.

### 5b. `index.html` reads the save key synchronously, before paint

```html
<!-- index.html:17-25 -->
if (wantPlay && localStorage.getItem('bbae_save_v2')) {
  document.documentElement.setAttribute('data-skip-landing', '1');
}
```

This is the `?play` deep link: a returning player with a save skips the
landing. It runs in a blocking inline script before first paint, so it can
**never** read IndexedDB.

Fix: `saveStore` writes a tiny **breadcrumb** to localStorage on every
successful autosave — `bbae_has_save = '1'` — and the inline script checks
that instead. A handful of bytes, and it keeps the deep link working. Easy to
forget; would ship as "the ?play link stopped resuming."

### 5c. Autosave currently fires on **every dispatch**

```js
// GameContext.jsx:4452
useEffect(() => { const result = persistAutosave(state); ... }, [state]);
```

Every click writes the whole state. On a year-20 save that is ~2.5 ms of
`JSON.stringify` per interaction, today. Async writes make an unthrottled
version worse — overlapping IDB transactions, and last-write-wins races
between them.

Fix while we are here: debounce (~1 s trailing) plus a dirty flag, a
`flush()` on `visibilitychange`/`pagehide` so nothing is lost on tab close,
and a single in-flight write with the newest state coalesced behind it. Note
this is a **behaviour change worth being deliberate about** — a hard browser
kill within the debounce window loses up to a second of play. The
`pagehide` flush covers every ordinary case.

### 5d. `SaveLoadModal` reads slots synchronously in a `useState` initialiser

```js
// SaveLoadModal.jsx:140
const [slots, setSlots] = useState(readAllSlots);
```

Becomes a `useEffect` load with a brief skeleton state, and `handleSave` /
`handleDelete` become async. `store.listMeta()` keeps this fast — it should
not deserialise four whole game states to draw four cards.

### 5e. StrictMode double-invokes effects

`main.jsx` wraps the app in `React.StrictMode`. In dev, effects mount twice,
so the hydrate must be idempotent and guarded (an `useRef` latch, the same
technique `autosaveBroken` already uses at `GameContext.jsx:4450`), or two
concurrent hydrates race and the loser can clobber the winner.

---

## 6. Phases

Deliberately split so that the **async refactor** and the **storage swap** are
two separate deployments. If something breaks, we know which one did it.

### Phase 1 — async save layer, still on localStorage

Introduce `saveStore.js` with the **localStorage backend only**. Do the whole
async refactor — hydrate phase, debounced autosave, async slot list,
breadcrumb key, dual-read reader — with the storage medium unchanged.

Files: `src/store/saveStore.js` (new), `src/store/GameContext.jsx`,
`src/components/SaveLoadModal.jsx`, `index.html`.

Behaviour after Phase 1 is identical to today, except autosave is debounced.
Nobody's quota problem is fixed yet. **This phase is the rollback floor** (§7).

### Phase 2 — IndexedDB backend + migration

Add the IDB adapter and make it primary. On first boot with a localStorage
save present:

1. read the localStorage save + slots,
2. write them to IndexedDB,
3. **read them back and verify**,
4. only then delete the localStorage originals (this is what actually frees
   Nick's quota),
5. set the breadcrumb.

Migration must be idempotent and must never delete before a verified readback.
If IDB is unavailable, skip migration entirely and stay on localStorage — a
player in that situation is no worse off than today.

Files: `src/store/saveStore.js`.

### Phase 3 — make it visible

- `navigator.storage.persist()` requested once after the first successful
  save, to opt out of best-effort eviction (Chrome/Safari grant silently
  based on engagement; Firefox prompts, so gate it behind a real user action
  rather than firing on load).
- A usage line in the Save/Load modal from `store.estimate()` — "Saves are
  using 2.4 MB of 8 GB available" — so this failure mode is never again
  something a player discovers by hitting it.
- Update the modal's hint text: "auto-saves continuously in the background"
  is now debounced, which is still true but the copy could say where saves
  live.

### Phase 4 — export / import (recommend doing this regardless)

There is currently **no way for a player to back up or move a save** — no
export, no import, nothing (`grep` for `createObjectURL` in `src` returns
nothing). Download a slot as a `.twsave` file, load one back. This is the only
real answer to §8, and it is a couple of hours.

---

## 7. Migration and rollback

The rollback risk is specific: once a save lives in IndexedDB and the
localStorage copy is gone, **a build that only knows how to read localStorage
shows the player a brand-new game.** For a 20-year airline that is
indistinguishable from data loss.

Three things make this safe:

1. **The reader tries both stores, permanently.** Shipped in Phase 1, before
   anything writes to IDB. So Phase 1 is the **rollback floor** — reverting
   Phase 2 is safe; reverting *past* Phase 1 is not. Worth a line in
   `ROLLBACK.md`.
2. **Migration verifies before it deletes.** No readback, no delete.
3. **Phase 4 gives players their own escape hatch**, which is the only
   mitigation that survives our mistakes.

Phase 2 should bake for a week before Phase 3 touches anything else.

---

## 8. What this does *not* fix

Worth being clear-eyed, because IndexedDB is not durable storage:

- **Clearing site data wipes it**, same as localStorage.
- **Different browser or machine = no save.** Nothing local fixes this.
- **Safari evicts script-written storage after 7 days without a visit**, when
  cross-site tracking prevention is on. This applies to IndexedDB and
  localStorage alike, so the move does not make it worse — but a player who
  takes a fortnight off can lose their airline on iOS today.
  `navigator.storage.persist()` (Phase 3) is the documented opt-out, and
  export/import (Phase 4) is the real insurance.
- **`statsHistory` still grows unbounded** — it just stops mattering at IDB
  scale. Downsampling it (weekly for 2 years, monthly before that) is a
  worthwhile separate change: it would cut a year-20 save by ~40% and make
  the Statistics page faster to boot.

---

## 9. If we want relief before Phase 2 lands

Compression is the stopgap: gzip + base64 in `persistAutosave` / `writeSlot`,
measured at 615 KB → 59 KB (10.4x), ~4 ms added per save at gzip level 6, ~30
lines. It fits entirely inside the existing synchronous code and needs none of
§5.

The catch is that it is the same one-way door as §7 — an older build cannot
read a compressed save — so it needs the same "ship the dual-format reader
first" discipline. Given that, **doing Phase 1 + 2 directly is cleaner than
doing compression and then undoing it.** Only reach for compression if players
are hitting the wall faster than the migration can ship.

---

## 10. Effort

| Phase | Estimate |
|---|---|
| 1 — async layer on localStorage | ~half a day, most of it §5a–5e |
| 2 — IDB backend + migration | ~half a day |
| 3 — persist() + usage meter | ~2 hours |
| 4 — export / import | ~2 hours |

New dependencies: **none.** Hand-rolled IDB wrapper (~120 lines) rather than
`idb`, and an injectable backend rather than `fake-indexeddb`, to keep the
dependency list at the five entries it has today.

---

## 11. Tests

Following the repo convention (`tools/*-test.mjs`, auto-discovered by
`run-tests.mjs`):

- `tools/save-store-test.mjs` — against an in-memory fake backend: round-trip;
  `listMeta` without full deserialisation; quota/unavailable/error results keep
  the exact `{ok, reason, message}` contract; dual-read precedence (IDB wins
  over localStorage); migration is idempotent, verifies before deleting, and
  does **not** delete when readback fails.
- `tools/save-hydrate-test.mjs` — SSR-render `GameProvider` (the suite already
  server-renders components, e.g. `pnl-reconcile-test.mjs`): asserts the
  hydrating state renders, then the loaded state, and that a double-mount does
  not double-hydrate.
- `tools/save-debounce-test.mjs` — N rapid dispatches produce one write; the
  final write carries the newest state; `flush()` writes synchronously-enough
  on pagehide.
- Keep `tools/_probe-save-quota.mjs` and `tools/_probe-save-growth.mjs` as
  probes (underscore-prefixed, so `run-tests.mjs` correctly skips them).

The one thing the injectable backend cannot cover is the real IDB adapter
against a real browser. That needs one manual pass: play, refresh, hard-refresh,
save/load/delete a slot, `?play` deep link, private browsing, and a migration
from a pre-existing localStorage save.
