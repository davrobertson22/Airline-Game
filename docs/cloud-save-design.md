# Supporter Cloud Saves — Design

Status: **server and client BUILT; not launched.**
- Server (Headwinds, 2026-10-14): `apps/headwinds-server/src/lib/cloudSaves.mjs`,
  `routes/tailwindsSaves.mjs`, the `TailwindsCloudSave` table and migration;
  `tools/tailwinds-cloud-saves-test.mjs`.
- Client (Tailwinds, 2026-10-15): `src/cloud/` (config, sign-in, API client,
  sign-in-return hook) and `src/components/CloudSaves.jsx`, in the Save / Load
  window and reachable from the new-game screen; `tools/cloud-saves-test.mjs`,
  `tools/cloud-saves-ui-test.mjs`. Hidden behind **`CLOUD_SAVES_LIVE = false`**
  in `src/cloud/cloudConfig.js`; preview on the live site with `?cloudpreview=1`.
- Launch commit (2026-10-15): `CLOUD_SAVES_LIVE = true`; support page ("In
  Tailwinds" → cloud saves; perks framed as thank-yous), privacy (new "Cloud
  saves" section: Supabase sign-in, what is stored, deletion, ~1-week backup
  tail), terms §2 (best effort, not a paid service, may end with notice), FAQ,
  devlog, sitemap (support.html added — it was missing). Backups: Supabase's
  daily physical backups, ~7 days visible; restore cloud saves via "Restore to
  new project" and copy `TailwindsCloudSave` rows, never an in-place restore
  (that would rewind every Headwinds world).

File export / import (Package 0) is built in Tailwinds but **parked** — Dave
decided on 2026-10-14 not to let players download their saves for now (see
`docs/save-storage-indexeddb-plan.md` Phase 4). The `.twsave` format and its
validator (`src/store/saveFile.js`) are still what the cloud uploads and checks.

## Goal

A Tailwinds airline follows its player between browsers and devices. Sign in with
a Headwinds account, put the airline in a cloud slot, pick it up on the laptop,
the phone, the work machine.

Offered to supporters as a **goodwill perk**: a thank-you for keeping the lights
on, in the same spirit as the Headwinds ♥ SUPPORTER badge. It is not a product,
not a service level, and not what keeps anyone's save safe.

## Decisions (locked)

- **Goodwill perk, not a purchase** (Dave, 2026-10-14). Every word of the copy, and
  every rule below about lapsing, follows from that.
- **No save downloads for now — cloud saves ship without file export** (Dave,
  2026-10-14). The earlier plan was export / import first, for everyone, so no
  player is ever told "pay or risk your airline". Dave chose to keep file
  downloads parked and go ahead anyway, accepting that a cloud slot is the only
  copy of an airline outside its browser. Consequences: the client never offers
  a cloud save as a file (Load goes straight into the game), and the §7 copy
  must not imply players have any other backup.
- **Nothing in the simulation.** A cloud save is a byte-for-byte `.twsave`. The
  server stores it and hands it back; it never reads, edits or grants anything
  inside it.
- **Reuse Headwinds accounts.** No second account system. Tailwinds signs in
  against the Headwinds server.

## Principles that fall out of "goodwill"

1. **Loading is never gated.** Supporter status is checked on UPLOAD only. A
   lapsed supporter (monthly tip cancelled) can list, load into the game and
   delete their cloud saves indefinitely. ("Load" means into the game: with file
   downloads parked, the client never offers a cloud save as a file.) Taking
   someone's airline away because a tip stopped would turn a thank-you into a
   hostage.
2. **No guarantees, said plainly.** "Best effort, hobby project." The UI and
   the support page both say it.
3. **Lapsing is quiet.** No nag screens, no countdowns. The upload button is
   replaced by one line explaining why, with a link to the support page.
4. **Removable in a day.** If the perk ever has to end, the client hides the cloud
   section and the server keeps cloud saves loadable for a stated notice period.
   Nothing about a local game depends on the server existing.

## 1. Architecture

```
tailwindsairlinegame.com (Vercel, static)         Headwinds server (Railway)
┌──────────────────────────────┐   HTTPS + CORS    ┌──────────────────────────────┐
│ Save / Load window           │ ───────────────►  │ auth.mjs   Supabase JWT, as  │
│  • local slots (IndexedDB)   │  Supabase token   │            for every request │
│  • Cloud slots (supporters)  │ ◄───────────────  │ /tw/saves/*  cloud slots     │
│                              │  .twsave bytes    │ Postgres: TailwindsCloudSave │
└──────────────────────────────┘                   │ Account.isSupporter (exists) │
         │ signs in with                            └──────────────────────────────┘
         ▼
   Supabase (the Headwinds project: Google, Discord, email link)
```

The Tailwinds site stays static. All new server code is in Headwinds, behind a
`/tw/` prefix, so it can be read, rate-limited and switched off as one unit.

## 2. Sign-in: the Headwinds login, used directly

**Changed from the first draft (2026-10-14), after reading the Headwinds code.**
Headwinds already authenticates every request with a Supabase access token sent
as `Authorization: Bearer`, verified locally against the project's published
keys (`apps/headwinds-server/src/auth.mjs`). So there is no handoff to build:

- Tailwinds signs in against the **same Supabase project** as the Headwinds web
  client (its URL and public anon key), with the same methods — Google, Discord,
  email link — and sends its own access token to `/tw/saves`.
- No code exchange, no second token type, no Headwinds-side "connect" page, no
  revoke endpoint: signing out of Tailwinds is a Supabase sign-out there.
- Sessions are per site. Signing in on Tailwinds is its own sign-in, to the same
  account.
- An identity that has never played Headwinds gets an `Account` row on its first
  request (auth.mjs does that for any first request). Harmless, and a gentle
  funnel toward Headwinds.
- Bans apply: `requireAuth` refuses a banned account here as everywhere.
- `@supabase/supabase-js` is loaded in Tailwinds **lazily**, only when the Cloud
  section is opened, so the game's first load does not grow.

**Two settings Dave changes (no code):**
1. Supabase → Authentication → URL Configuration → **Redirect URLs**: add
   `https://www.tailwindsairlinegame.com/**`, so Google, Discord and email links
   can return to Tailwinds.
2. Railway → API service → **`CORS_ORIGINS`**: add
   `https://www.tailwindsairlinegame.com` (comma-separated, alongside the
   Headwinds web origin). The apex domain redirects to `www`, so `www` is enough.

## 3. Data model (Prisma, Headwinds) — BUILT

```prisma
model TailwindsCloudSave {
  id          String   @id @default(cuid())
  accountId   String
  account     Account  @relation(fields: [accountId], references: [id], onDelete: Cascade)
  slot        Int      // 0..2
  fileVersion Int      // .twsave envelope version
  meta        Json     // metaFromState(): what the slot card draws
  bytes       Bytes    // the .twsave, exactly as uploaded
  size        Int
  savedAt     DateTime // when the game was exported for upload (client clock)
  uploadedAt  DateTime // server clock; the conflict token
  deviceLabel String?  // "Chrome on Mac" — shown on conflicts
  @@unique([accountId, slot])
}
```

Migration `20261015000000_tailwinds_cloud_saves` — additive (one new table), run
by Railway's pre-deploy `npm run db:deploy`. Postgres `bytea` is fine at this
scale: a late-game `.twsave` is ~60–100 KB, so three slots for a few hundred
supporters is tens of MB. Move blobs to object storage only if that stops being
true.

## 4. API — BUILT

| Method | Path | Who | Does |
|---|---|---|---|
| GET | `/tw/saves` | any signed-in account | `{ supporter, maxSlots: 3, maxUploadBytes, slots: [summary \| null ×3] }` — summary is `slot, meta, size, savedAt, uploadedAt, deviceLabel`, never bytes |
| GET | `/tw/saves/:slot` | any signed-in account | the `.twsave` bytes, `application/octet-stream`, `no-store`, not re-compressed |
| PUT | `/tw/saves/:slot` | **supporters only** | upload; body is the `.twsave` as `application/octet-stream`; header `x-tw-base-upload: none \| <uploadedAt>`; optional `x-tw-device` |
| DELETE | `/tw/saves/:slot` | any signed-in account | empty a slot (204) |

PUT checks, in order: signed in (401) → slot 0–2 (400) → supporter (403
`NOT_SUPPORTER`, with a kind message) → rate limit (429) → raw bytes (415) →
≤ 5 MB (413) → `x-tw-base-upload` present (400) → decodes with the Tailwinds
importer's own `decodeSaveFile` (422 `INVALID_SAVE`, with the importer's message)
→ conditional write → 200 with the new summary.

Conflict rule: the write succeeds only if the slot is empty (`none`) or its
`uploadedAt` equals the one the client sent — create-if-absent on the unique
index, or a compare-and-swap `updateMany`. Otherwise **409**
`CLOUD_SLOT_CHANGED` with the slot's current summary (or `null` if it was
deleted). The client shows both versions and, if the player chooses to
overwrite, resends against the `uploadedAt` from the 409.

Rate limits: 12 writes and 120 reads per account per 5 minutes (windows sized to
fit `rateLimit.mjs`'s 5-minute idle sweep).

The server's copy of the decoder is `lib/twsaveFile.mjs`, generated from
Tailwinds' `src/store/saveFile.js` (metaFromState inlined, the browser-only
download helper dropped). **Change the Tailwinds file first, then re-copy.**

## 5. Tailwinds client

A **Cloud saves** section in the Save / Load window, below the local slots:

- **Signed out:** one line — "Supporters can keep up to three airlines in the
  cloud and pick them up on any device." Buttons: *Sign in with your Headwinds
  account* (Google · Discord · email link) · *What's this?* (→ `/support.html`).
- **Signed in, supporter:** three cloud slot cards drawn from `/tw/saves` meta,
  each with *Upload current game* / *Load* / delete, plus the line "Best effort,
  hobby servers."
- **Signed in, not (or no longer) a supporter:** the same cards with *Load* and
  delete only, and one line where *Upload* would be: "Uploading is a thank-you
  for supporters. Your cloud saves stay yours to load."

*Load* fetches the bytes and runs them through `decodeSaveFile` and the **same
confirm and `LOAD_STATE` path the (parked) file Import uses** —
`ImportSaveButton`'s logic, factored out to take bytes instead of a File — so
there is one load path whether or not file import is ever switched on.

No background auto-sync in the first version. Possible later: "Back up to cloud
slot 3 every 26 game weeks", writing only to a slot the player has chosen for it.

## 6. Supporter status

Day one: the existing manual flag, `Account.isSupporter` — Ko-fi message names
the Headwinds username, Dave flips it from the moderation panel, exactly as for
the badge. The one-month grace for a lapsed monthly supporter is therefore
Dave's call too: he turns the flag off when the grace runs out. Later, optionally: Ko-fi's payment webhook sets it
automatically (verify the webhook token; match on the username in the message;
anything unmatched goes to a list for a human). Monthly tips that stop: the flag
can stay on for a grace month; even when it goes off, nothing but Upload changes.

## 7. Before launch (non-negotiable)

- **Backups of the Headwinds database** that include the new tables — at least a
  nightly dump kept off Railway, with one restore actually tested. Holding other
  people's saves makes losing them our fault.
- **Privacy page:** a section on cloud saves — what is stored (the save file and
  its summary, linked to the Headwinds account), why, how long, how to delete it
  (delete in the UI, or account deletion cascades), and that it is never shared.
- **Terms:** cloud saves are a best-effort goodwill feature with no availability
  guarantee and may be discontinued with notice; keep a local export.
- **Support page** "What you get → In Tailwinds", replacing "nothing but my
  thanks", along these lines:

  > Supporters can keep up to three airlines in the cloud and pick them up in any
  > browser, on any device. It's a thank-you, not a service: it runs on the same
  > hobby servers as everything else. If you stop supporting, your cloud saves
  > stay yours to load. Uploading is the only thing that pauses.

  (Drafted with file export parked. If export ships, add back: "keep an exported
  save file too" and "Backing up to a file is free for everyone, always.")

  The existing promise stays true and should stay on the page: nothing you pay
  for changes the game, and nothing you can already do stops working.

## 8. Retention

Open: how long to keep cloud saves for accounts that never sign in again.
Proposal: keep while the Headwinds account exists; if the account is deleted,
saves go with it (cascade). Revisit only if storage ever matters.

## 9. Build order

1. ✅ **Server — storage and API** (Headwinds, 2026-10-14): model + migration,
   `/tw/saves` endpoints, the importer's own validation, the conflict rule, rate
   limits; the API's error handler moved to `lib/errorHandler.mjs` so the suite
   runs under the real one. 32 cases in `tools/tailwinds-cloud-saves-test.mjs`.
2. ~~Server — sign-in handoff~~ — **not needed**: Tailwinds uses the Headwinds
   Supabase login directly (§2). Replaced by Dave's two settings in §2.
3. ✅ **Client** (Tailwinds, 2026-10-15): lazy Supabase sign-in (PKCE; its
   own 59 KB gz chunk, fetched only when cloud saves are used), the Cloud
   section, the shared confirm-and-load path, the conflict dialog, the
   new-game-screen entry, index.html skipping the landing page on
   `/?cloud=return`. Checked against the real server plugin over HTTP and in
   Chromium against the production build. Behind the launch switch.
4. **Copy and launch:** privacy, terms, support page, devlog, Discord post.
   Database backups verified before the support page changes.

## Open questions

Settled 2026-10-14 on the proposed defaults unless Dave says otherwise:
three cloud slots; no automatic cloud backup in v1; one-month grace for lapsed
monthly supporters (applied by hand, §6); supporter flag stays manual; no file
downloads for now (cloud saves go ahead without file export).

Still open:
1. Retention for accounts that never sign in again (§8 proposes: keep while the
   account exists).
