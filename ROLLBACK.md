# ROLLBACK — Mobile / PWA work

How to undo any part of the mobile/PWA effort, phase by phase. All work lives on
the **`mobile-pwa`** branch; `main` is the pre-mobile baseline.

## Fastest full undo
You never merged anything you didn't want, so the nuclear option is simple:
```bash
git checkout main          # return to the pre-mobile state
git branch -D mobile-pwa   # (optional) delete the mobile branch entirely
```
`main` is exactly as it was before this work began.

## Per-phase undo
Each phase is its own commit on `mobile-pwa`. To undo one phase without touching
the others:
```bash
git revert <commit-hash>   # creates an inverse commit; safe, preserves history
```
Find hashes with `git log --oneline`. Phase entries below list the files each
phase touched so you can confirm scope before reverting.

> Note on the sandbox: git commits in this effort are run by you in your own
> Terminal (the assistant edits files but does not commit). If you ever see
> `fatal: Unable to create '.git/index.lock': File exists`, it's a harmless
> leftover from the sandbox — just `rm .git/index.lock` and retry.

---

## Phase 0 — Clean baseline  ✅ committed
**Commit:** `59b8d75  Add custom airline logo upload`
This committed pre-existing uncommitted work (the custom-logo-upload feature) so
the mobile branch starts from a clean tree. It is a real feature, not mobile
work — leave it in place. To undo *just* this: `git revert 59b8d75`.
Files: `src/App.jsx`, `src/components/AirlineLogo.jsx`,
`src/components/SaveLoadModal.jsx`, `src/components/SetupScreen.jsx`,
`src/store/GameContext.jsx`.

---

## Phase 1 — PWA plumbing (manifest + service worker)
**Commit:** `_____` (fill in after committing)
Makes the app installable + offline-capable. Network-first, so it cannot pin
users to a stale build.

Added:
- `public/manifest.webmanifest`
- `public/sw.js`  (the service worker)
- `public/pwa-icon-192.png`, `public/pwa-icon-512.png`, `public/pwa-icon-maskable-512.png`

Changed:
- `index.html` — added `<link rel="manifest">`, `theme-color`, Apple PWA meta + touch icon (status-bar style = `default`)
- `src/main.jsx` — added the production-only service-worker registration block

**Code revert:** `git revert <hash>` (or delete the added files + the two edits).

**⚠ Service worker — the one non-pure-code revert.** Reverting the code stops
*new* visitors from registering the worker, but browsers that already registered
it keep running the cached worker until it's explicitly removed. To purge it from
those browsers, deploy a **kill-switch worker**: replace `public/sw.js` with the
file below and ship it. It unregisters itself and clears all caches, then can be
deleted on a later deploy.

```js
// public/sw.js  — KILL SWITCH: unregister and clear all caches
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
    await self.registration.unregister();
    const clients = await self.clients.matchAll();
    clients.forEach((c) => c.navigate(c.url));
  })());
});
```
(An individual user can also clear it manually: DevTools → Application → Service
Workers → Unregister.)

---

## Phase 2 — Mobile breakpoint scaffolding + viewport fixes
**Commit:** `_____` (fill in after committing)
Adds the mobile foundation. All CSS changes are inside a single
`@media (max-width: 640px)` block, so desktop (>640px) is byte-for-byte
unchanged.

Added:
- `src/hooks/useIsMobile.js` — JS breakpoint hook for inline-styled components

Changed:
- `src/index.css` — appended one `@media (max-width: 640px)` block at the very
  end (`100dvh` fix + 16px form inputs). No existing rules were modified.

**Code revert:** `git revert <hash>`, or manually: delete the trailing
`@media (max-width: 640px)` block from `index.css`, delete
`src/hooks/useIsMobile.js`. Nothing else references them yet.
Desktop risk: none — the only change outside the media query is the iOS meta tag.

---

## Phases 3–6 — (not yet done)
Will be appended here as each is completed: topbar, tables, route map, tooltips.
