# Tailwinds — Airline Management Game

Free browser airline management game (React + Vite SPA), live at https://www.tailwindsairlinegame.com. Monetized via Google AdSense — the static content pages in `public/` exist largely to satisfy AdSense content policies. Keep them healthy.

## Shell blocks — commands only

Any shell/bash block written for Dave to run must contain **commands only**: no inline `#` comments, no `#` header lines, no explanatory prose, no annotations like `npm test   # exit 0`. Put every word of explanation in prose before or after the block.

He copy-pastes the whole block into Terminal, and he runs **zsh**, where `INTERACTIVE_COMMENTS` is off — a trailing `#` is an ARGUMENT, not a comment. This is not a style preference; it silently corrupts commands. Real example: `git status   # eight staged` parsed as `git status '#' eight staged`, i.e. three pathspecs matching nothing, so git printed "nothing to commit, working tree clean" on a tree with eight staged files.

Applies to Headwinds too.

## Devlog maintenance (important)

**Whenever a session ships a notable game change (feature, rebalance, significant fix), add an entry to `public/devlog.html` before committing.**

- Add a new `<div class="entry">` at the TOP of the list (newest first), following the existing format: `<p class="date">` with the date, an `<h2>` headline, and player-facing bullets — write for players, not developers (no commit-speak, no file names).
- Group small related changes into one entry rather than many tiny ones.
- Update the devlog's `<lastmod>` in `public/sitemap.xml` to the current date.
- Cross-link relevant guide pages (e.g. `/route-economics.html`, `/aircraft.html`) where natural.

## Static content pages (`public/`)

- All SEO/content pages live in `public/` and are copied verbatim into `dist/` by Vite. Never edit `dist/` directly.
- Aircraft guide pages (`aircraft*.html`) are **generated** — do not hand-edit. Regenerate with:
  `node tools/generate-aircraft-pages.mjs`
  Re-run whenever `src/data/aircraft.js` changes (stats, new types) or the shared nav/footer changes (edit the NAV/FOOTER constants in the script).
- All pages share the same hand-rolled dark theme (CSS vars: `--bg`, `--panel`, `--gold`...) and identical header nav + footer link blocks. When adding a page: copy an existing page's chrome, add it to the footer of ALL pages, and add a `<url>` entry to `public/sitemap.xml`.
- New pages need: unique `<title>` + `<meta name="description">`, canonical URL, and 500+ words of real content (AdSense "low value content" was a past rejection — thin pages hurt).

## Site structure notes

- `index.html` contains a static `#seo-landing` section (crawlable text for the SPA) — it's hidden for returning players via a localStorage check. Don't remove it.
- Contact channel is the Discord invite (`discord.com/invite/B7zP8X3YGm`) — no public email. Used on contact.html, about.html, privacy.html.
- `public/ads.txt`, `robots.txt`, `sitemap.xml`, and `googleb69adfd073bb3cd6.html` (Search Console verification) must survive any restructuring.

## Build & test

- Build: `npm run build` (note: fails in Linux sandboxes — node_modules has macOS-native rollup; build runs on the user's machine).
- Test scripts live in `tools/*-test.mjs`. `npm test` runs all of them via `tools/run-tests.mjs`,
  which discovers them from disk — no hand-maintained chain, so a new suite is picked up the moment
  it exists. It runs in parallel, reports every failure instead of stopping at the first, and exits
  non-zero if any failed. `npm run test:list` / `npm run test:serial`; `node tools/run-tests.mjs <substring>`
  runs a subset. A file that only prints a report carries `@not-a-test` in its header and is skipped.
- Game data: `src/data/` (aircraft, airports, alliances...). Simulation: `src/models/` and `src/utils/`. `.bak`/`.pre*` files in `src/data/` are manual backups — ignore them.
