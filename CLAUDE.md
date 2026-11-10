# Tailwinds — Airline Management Game

Free browser airline management game (React + Vite SPA), live at https://www.tailwindsairlinegame.com. Monetized via Google AdSense — the static content pages in `public/` exist largely to satisfy AdSense content policies. Keep them healthy.

## Shell blocks — commands only

Any shell/bash block written for Dave to run must contain **commands only**: no inline `#` comments, no `#` header lines, no explanatory prose, no annotations like `npm test   # exit 0`. Put every word of explanation in prose before or after the block.

He copy-pastes the whole block into Terminal, and he runs **zsh**, where `INTERACTIVE_COMMENTS` is off — a trailing `#` is an ARGUMENT, not a comment. This is not a style preference; it silently corrupts commands. Real example: `git status   # eight staged` parsed as `git status '#' eight staged`, i.e. three pathspecs matching nothing, so git printed "nothing to commit, working tree clean" on a tree with eight staged files.

Applies to Headwinds too.

## Devlog maintenance (important)

**Whenever a session ships a notable game change (feature, rebalance, significant fix), add an entry to `content/devlog-entries.html` before committing.** That file is the source for every devlog page. `public/devlog.html` and everything in `public/devlog/` are **generated** from it; do not hand-edit them.

- Add a new `<div class="entry">` at the TOP of the list (newest first), following the existing format: `<p class="date">` with the date, an `<h2>` headline, and player-facing bullets — write for players, not developers (no commit-speak, no file names).
- Group small related changes into one entry rather than many tiny ones.
- Cross-link relevant guide pages (e.g. `/route-economics.html`, `/aircraft.html`) where natural.
- Then rebuild and date the pages:
  `node tools/generate-devlog-pages.mjs && node tools/stamp-page-dates.mjs`
  This rewrites the devlog index, the month page (`public/devlog/YYYY-MM.html`), a page of its own for any entry of 500+ words (`public/devlog/<slug>.html`), the "Latest updates" block on the homepage, and the sitemap. Commit the generated files with the source.

## Static content pages (`public/`)

- All SEO/content pages live in `public/` and are copied verbatim into `dist/` by Vite. Never edit `dist/` directly.
- `tools/site-pages-test.mjs` (part of `npm test`) guards all of the rules below and names the tool to run when one fails.
- **Nav and footer** have one source, `tools/site-chrome.mjs`. After changing it run `node tools/sync-site-chrome.mjs` (hand-written pages) and the generators (generated pages). Do not edit a page's `<header class="site">` or `<footer class="site">` by hand.
- **Dates.** Never hand-edit a "Last updated" byline, a JSON-LD `dateModified`, or `public/sitemap.xml`. After editing any page in `public/` or the landing in `index.html`, run `node tools/stamp-page-dates.mjs`. It dates a page only when its content has really changed (3+ paragraphs, rows or images; record in `content/page-dates.json`) and rebuilds the sitemap with a `<lastmod>` per page. Stamping every page with the release date is what Google reads as bulk-produced content; do not bring it back.
- Aircraft guide pages (`aircraft*.html`) are **generated** — do not hand-edit. Regenerate with:
  `node tools/generate-aircraft-pages.mjs`
  Re-run whenever `src/data/aircraft.js` changes (stats, new types). Hand-written parts live in `content/aircraft-picks/` (editorial) and `content/aircraft-background/` (the real aircraft, with outside sources); the charts are drawn from the data.
- **Charts and data tables on hand-written pages** sit between `<!-- GEN:id:START -->` / `<!-- GEN:id:END -->` markers and are filled by `node tools/generate-guide-charts.mjs` from the game's data. Re-run it when aircraft or fuel data changes. Add a block by adding it to `BLOCKS` in that script.
- All pages share the same hand-rolled dark theme (CSS vars: `--bg`, `--panel`, `--gold`...). When adding a page: copy an existing page's `<head>` and styles, add the page to `GUIDES` or `ARTICLES` in `tools/site-chrome.mjs` and run the sync (that puts it in every footer), add a card for it to the Guides section of the landing in `index.html`, then run `node tools/stamp-page-dates.mjs` (that adds it to the sitemap).
- New pages need: unique `<title>` + `<meta name="description">`, canonical URL, and 500+ words of real content (AdSense "low value content" was a past rejection — thin pages hurt).
- Two kinds of page: **guides** explain the game; **articles** (`regional-jets-explained.html` and friends) explain real aviation with the game's data and cite outside sources. Search traffic comes from the articles and the comparison page, not the guides, so real-world facts in them must be checked against a source and the source listed at the foot of the page.

## Site structure notes

- `index.html` contains a static `#seo-landing` section: the site's front door, shown on every visit until the player clicks Play. It carries the site nav, the Guides section (a card for every guide and article) and the generated Latest updates block. Don't remove it.
- Contact channel is the Discord invite (`discord.com/invite/B7zP8X3YGm`) — no public email. Used on contact.html, about.html, privacy.html.
- `public/ads.txt`, `robots.txt`, `sitemap.xml`, and `googleb69adfd073bb3cd6.html` (Search Console verification) must survive any restructuring.

## Build & test

- Build: `npm run build` (note: fails in Linux sandboxes — node_modules has macOS-native rollup; build runs on the user's machine).
- Test scripts live in `tools/*-test.mjs`. `npm test` runs all of them via `tools/run-tests.mjs`,
  which discovers them from disk — no hand-maintained chain, so a new suite is picked up the moment
  it exists. It runs in parallel, reports every failure instead of stopping at the first, and exits
  non-zero if any failed. `npm run test:list` / `npm run test:serial`; `node tools/run-tests.mjs <substring>`
  runs a subset. A file that only prints a report carries `@not-a-test` in its header and is skipped.
- `src/data/airportMarkets.js` (the Airports → All airports market columns) is **generated** — do not hand-edit.
  Regenerate with `node tools/generate-airport-markets.mjs` whenever airports, metros or the demand model change;
  `tools/airport-markets-test.mjs` fails when it is stale.
- Game data: `src/data/` (aircraft, airports, alliances...). Simulation: `src/models/` and `src/utils/`. `.bak`/`.pre*` files in `src/data/` are manual backups — ignore them.
