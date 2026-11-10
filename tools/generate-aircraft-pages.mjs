// generate-aircraft-pages.mjs
// Generates the static aircraft guide pages in public/ from src/data/aircraft.js.
// Run from the project root:  node tools/generate-aircraft-pages.mjs
// Re-run whenever aircraft data changes, then rebuild (vite copies public/ into dist/).
//   node tools/generate-aircraft-pages.mjs --check   exit 1 if a page on disk is stale
// Afterwards run `node tools/stamp-page-dates.mjs` so a changed page gets its new date.

import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { AIRCRAFT_TYPES } from '../src/data/aircraft.js';
import { fuelCostPerKm } from '../src/utils/fuel.js';
import { cruiseSpeedKmh, typicalSeatsOf, fullCabinRangeKm } from '../src/utils/simulation.js';
import { NAV, FOOTER, SITE } from './site-chrome.mjs';
import { scatterChart, barChart, SERIES, CHART_CSS } from './site-charts.mjs';
import { updatedLabel } from './stamp-page-dates.mjs';

// A passenger type's headline range is quoted at its typical cabin; say which, and
// what it flies packed to the exit limit. A type quoted at full payload says so too.
const lightCabinNote = (t) => {
  if (t.freighter) return '';
  const typical = typicalSeatsOf(t);
  if (!(typical > 0)) return '';
  return typical < (t.seats ?? 0)
    ? ` at ${typical} seats (${fmtIntLite(fullCabinRangeKm(t))} km at ${t.seats})`
    : ` at all ${t.seats} seats`;
};
const fmtIntLite = (n) => Math.round(n).toLocaleString('en-US');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public');

// Hand-written, Tailwinds-only editorial injected into each category page after
// the stat table. These are wrapped in TW-ONLY markers on output; the Headwinds
// build (tools/headwinds-public.mjs in the Headwinds repo) strips anything
// between those markers and injects its own multiplayer section instead, so the
// two sites do not publish the same prose on the same generated pages.
const PICKS_DIR = path.join(ROOT, 'content/aircraft-picks');

function picksFor(file) {
  const p = path.join(PICKS_DIR, file);
  if (!existsSync(p)) {
    console.warn(`  \u26a0 no picks file for ${file} \u2014 page will ship without its editorial section`);
    return '';
  }
  return `    <!-- TW-ONLY:START -->\n${readFileSync(p, 'utf8').trimEnd()}\n    <!-- TW-ONLY:END -->`;
}

// Hand-written background on the real aircraft, with outside sources. Optional per page,
// Tailwinds-only like the picks.
const BACKGROUND_DIR = path.join(ROOT, 'content/aircraft-background');

function backgroundFor(file) {
  const p = path.join(BACKGROUND_DIR, file);
  if (!existsSync(p)) return '';
  return `    <!-- TW-ONLY:START -->\n${readFileSync(p, 'utf8').trimEnd()}\n    <!-- TW-ONLY:END -->`;
}

// --check compares instead of writing, so a test can tell when the pages are stale.
const CHECK = process.argv.includes('--check');
let staleCount = 0;
function emit(file, html, note) {
  const p = path.join(OUT, file);
  if (CHECK) {
    if (!existsSync(p) || readFileSync(p, 'utf8') !== html) {
      staleCount++;
      console.log(`stale: public/${file}`);
    }
    return;
  }
  writeFileSync(p, html);
  console.log(`wrote public/${file} (${note})`);
}

// ── Category → page config ───────────────────────────────────────────────────

const PAGES = [
  {
    file: 'aircraft-narrow-body.html',
    title: 'Narrow-Body Aircraft Guide — Tailwinds Airline Management Game',
    h1: 'Narrow-Body Aircraft Guide',
    categories: ['Narrow Body'],
    description:
      'Every narrow-body jet in Tailwinds compared: seats, range, lease cost, fuel burn, and per-seat economics. Find the right single-aisle workhorse for your airline.',
    intro: `
      <p>Single-aisle jets fly most of the world's short and medium-haul routes, and they will fly most of yours. They suit city pairs a few hundred to a few thousand kilometres apart with steady demand, where a widebody would leave half its seats empty and a turboprop would take too long.</p>
      <p>Inside the category the choice is between capacity and cost. The A318 and 737-700 are cheap to lease and easy to fill, so a mistake on a new route costs little. The A321neo and 737 MAX 10 carry many more passengers for a modest rise in trip cost, which pays on a route you already know is busy and hurts on one you are guessing at. The table and notes below use each aircraft's in-game numbers, including fuel cost per seat-kilometre: what it costs in fuel to move one seat one kilometre.</p>
      <h2>How to choose</h2>
      <p>Match seats to demand first, then range to the route, and look at price last. A jet 30% too big for its route flies half-empty and loses money however efficient it is. The new-generation types (neo, MAX, A220, E2) burn less fuel per seat than the classics they replaced and lease for more, so they suit busy networks that keep them in the air. Older classics cost far less each week but burn more, and they arrive second-hand with a maintenance bill that age has already raised. The oldest jets here, whose lines closed in 1976 or earlier, are buy-only, because no lessor stocks them. The Comet 1 is listed for history: its certificate was withdrawn in 1954, so it can only be bought in an era game, from 1952 through 1954.</p>`,
  },
  {
    file: 'aircraft-wide-body.html',
    title: 'Wide-Body Aircraft Guide — Tailwinds Airline Management Game',
    h1: 'Wide-Body Aircraft Guide',
    categories: ['Wide Body'],
    description:
      'All wide-body jets in Tailwinds compared: seats, range, lease cost, fuel burn, and per-seat economics. Pick the right twin-aisle for long-haul expansion.',
    intro: `
      <p>Widebodies are how a Tailwinds airline goes intercontinental — and how plenty of them go bankrupt. A twin-aisle jet carries two to three times the passengers of a narrow-body, costs several times as much to lease, and burns fuel accordingly. On a dense long-haul trunk route it prints money; on a thin route it is the fastest way to destroy a healthy balance sheet.</p>
      <p>Fill rate is everything at this scale. A 300-seat jet at 85% load is a triumph; the same jet at 45% is a weekly six-figure loss. Before leasing any aircraft on this page, be confident the city pair can actually fill it — big populations at both ends, ideally with hub feed behind one of them.</p>
      <h2>How to choose</h2>
      <p>Modern twins (the 777X, A330neo, 787 and A350 families, plus the 777-300ER) fill the top of the efficiency table and should be your default for new long-haul flying. Older types — A340s, early 777s, the 767 family — lease for dramatically less and remain sensible on routes you have already proven, or as a bridge while you build cash. They arrive second-hand, though, so budget for maintenance well above the base figure. Watch range carefully: ultra-long-range variants carry a lease premium you only earn back on routes that actually need it. Every range here is quoted at the maker's typical cabin. Pack a widebody to its exit limit and the extra passengers come out of the fuel, so the range falls, sharply on the ultra-long-range A350s, whose headline needs a light premium cabin like Singapore's or Qantas'.</p>`,
  },
  {
    file: 'aircraft-regional-jets.html',
    title: 'Regional Jet Guide — Tailwinds Airline Management Game',
    h1: 'Regional Jet Guide',
    categories: ['Regional Jet'],
    description:
      'Every regional jet in Tailwinds compared: seats, range, lease cost, fuel burn, and per-seat economics. Build profitable thin routes and hub feed.',
    intro: `
      <p>Regional jets solve a specific problem: routes with real demand, but not enough of it to fill a 150-seat narrow-body. In Tailwinds that describes a huge share of the map — secondary cities, short cross-border hops, and above all <em>hub feed</em>, the short flights that funnel connecting passengers into your hub for onward long-haul travel.</p>
      <p>Per-seat costs run higher than larger jets; that is the price of right-sizing. A regional jet is not competing with an A320 on cost per seat — it is competing with the empty seats the A320 would fly on a thin route. Judged that way, the category is one of the most reliably profitable in the game.</p>
      <h2>How to choose</h2>
      <p>The E-Jets and the larger CRJs cover the 78–146 seat band, from the CRJ-700 up to the E195-E2; the E2 generation offers materially better burn for a higher lease. At the small end, the 37–52 seat jets (the ERJ-135, ERJ-145 and CRJ-200) only make sense on very thin or very short missions where nothing bigger could break even. As always: pick the seat count the route can fill, not the one with the prettiest efficiency number.</p>
      <h2>Business jets</h2>
      <p>Four business jets sit in this table too — the Citation CJ4, Phenom 300E, Challenger 350 and Gulfstream G650ER. They are not regional jets in any commercial sense: ten or nineteen seats behind jet engines make for some of the worst per-seat fuel figures in the game (the Challenger 350's is the worst of all, and only Concorde separates it from the G650ER), and none of them will ever pay on a scheduled route. They exist for the <a href="/devlog.html">charter board</a>, where executive contracts demand a business jet and price against one, and where a light jet parked at the right airport can turn a fixed fee into a profit that no airliner could. Treat them as a sideline, not a fleet.</p>`,
  },
  {
    file: 'aircraft-turboprops.html',
    title: 'Turboprop Aircraft Guide — Tailwinds Airline Management Game',
    h1: 'Turboprop Aircraft Guide',
    categories: ['Turboprop'],
    description:
      'All turboprops in Tailwinds compared: seats, range, lease cost, fuel burn, and per-seat economics. The cheapest way to fly short, thin routes.',
    intro: `
      <p>Turboprops are the most misunderstood aircraft in Tailwinds. New players skip them because they look slow and small; experienced players quietly build entire profitable sub-networks on them. Below roughly 800 kilometres, nothing else in the game touches their trip costs — the fuel table below makes the point better than any argument.</p>
      <p>Their weekly leases are the lowest in the game, which also makes them the lowest-risk way to experiment. A failed turboprop route costs you pocket change; a failed widebody route can cost you the company.</p>
      <h2>How to choose</h2>
      <p>The ATR 72 and Q400 are the modern workhorses — the ATR cheaper per trip, the Q400 bigger, longer-legged and cheaper per seat. Both cruise at the same turboprop speed. Many of the older types in this table are 1940s–60s propliners whose lines closed in 1976 or earlier: no lessor stocks those, so they are buy-only, and they arrive decades old. Smaller 19–40 seat types unlock genuinely tiny markets (island hops, mountain fields, remote communities) that no jet can serve economically. Range is rarely the constraint; matching seats to a thin market is the whole art.</p>`,
  },
  {
    file: 'aircraft-freighters.html',
    title: 'Freighter Aircraft Guide — Tailwinds Airline Management Game',
    h1: 'Freighter Aircraft Guide',
    categories: ['Freighter'],
    description:
      'Every cargo aircraft in Tailwinds compared: payload, range, lease cost and fuel burn. Build a profitable cargo network alongside your passenger airline.',
    intro: `
      <p>Freighters carry payload instead of passengers. There is no catering, no loyalty programme and no cabin to configure: revenue is the tonnes you carry times the rate on the lane. The freight market has rivals of its own. Full-service AI airlines start freight arms from their hubs once they are established, and a lane's freight is divided by how much each airline lifts and how keenly it prices (see <a href="/competition-and-alliances.html">competition &amp; alliances</a>). A cargo network earns separately from your passenger routes, so it can steady the airline's income when passenger demand dips.</p>
      <p>With no seats to count, the comparison is payload tonnes against trip cost on the lanes you fly. Small feeders bring parcels into a hub. Large intercontinental freighters move heavy tonnage between major economies.</p>
      <h2>How to choose</h2>
      <p>Start with a regional freighter on a short lane you know has freight. It teaches cargo pricing for little money. Converted passenger jets (the BCF and P2F types) sit in the middle: cheap to lease, with a useful payload. Purpose-built giants such as the 747 freighters need a dense long-haul trade lane to fill them, and on such a lane they carry more per flight than anything else you can lease.</p>`,
  },
  {
    file: 'aircraft-flagships.html',
    title: 'Flagship Aircraft: Double-Deckers & Concorde — Tailwinds Guide',
    h1: 'Flagships: Double-Deckers & Supersonic',
    categories: ['Double Deck', 'Supersonic'],
    description:
      'The A380, 747 family and Concorde in Tailwinds: seats, range, lease cost and economics of the game’s biggest and fastest aircraft — and when they actually pay.',
    intro: `
      <p>This page covers the largest and fastest aircraft in Tailwinds: the double-deck A380 and 747 family, and Concorde. They are the aircraft players most want to fly, and the ones most often flown at a loss.</p>
      <p>A double-decker needs a route that fills 400 to 853 seats every week. In practice that means the busiest trunk routes, usually between mega-hubs with connecting traffic at both ends. On such a route the cost per seat is very low. On a weaker one the weekly lease alone can cancel the profit of several healthy routes.</p>
      <p>Concorde is a separate case. It burns more fuel per seat than any other airliner in the game, but passengers pay a large premium to fly supersonic, so on a wealthy long-haul pair it can pay its way. Treat it as a prestige aircraft that has to fight for its margin.</p>
      <h2>How to choose</h2>
      <p>Wait until the network is ready. A flagship needs established mega-hubs, a deep cash reserve, and trunk routes that already overflow your largest twin-engined widebodies. With those in place it is the cheapest way to add seats to a route that is full.</p>`,
  },
];

// ── Formatting helpers ────────────────────────────────────────────────────────

const fmtMoney = (n) =>
  n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M` : `$${Math.round(n / 1000)}K`;
const fmtInt = (n) => n.toLocaleString('en-US');
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ── Shared page chrome (matches how-to-play.html styling) ────────────────────

// NAV and FOOTER are imported from site-chrome.mjs, the one copy every page shares.

const CSS = `
    :root { --bg:#1b1b1f; --panel:#26262d; --line:#3a3b40; --text:#ededee; --muted:#a1a1aa; --gold:#c79a4b; --gold-light:#d3ad63; }
    * { box-sizing: border-box; }
    body { font-family:'IBM Plex Sans',system-ui,-apple-system,sans-serif; background:var(--bg); color:var(--text); margin:0; line-height:1.7; }
    a { color:var(--gold-light); }
    header.site { border-bottom:1px solid var(--line); }
    nav.site { max-width:880px; margin:0 auto; padding:18px 24px; display:flex; flex-wrap:wrap; gap:20px; align-items:center; }
    nav.site .brand { font-family:'Space Grotesk',sans-serif; font-weight:700; font-size:1.15rem; color:var(--text); text-decoration:none; margin-right:auto; }
    nav.site a.link { color:var(--muted); text-decoration:none; font-size:0.95rem; font-weight:500; }
    nav.site a.link:hover { color:var(--gold-light); }
    main { max-width:860px; margin:0 auto; padding:48px 24px 72px; }
    h1 { font-family:'Space Grotesk',sans-serif; font-size:2.1rem; line-height:1.2; margin:0 0 8px; }
    .lede { color:var(--muted); font-size:1.1rem; margin:0 0 36px; }
    h2 { font-family:'Space Grotesk',sans-serif; font-size:1.45rem; margin:40px 0 12px; }
    h3 { font-size:1.15rem; margin:0 0 6px; font-family:'Space Grotesk',sans-serif; }
    p { margin:0 0 16px; }
    .cta { display:inline-block; background:var(--gold); color:#20180a; font-weight:700; padding:13px 30px; border-radius:8px; text-decoration:none; margin:18px 0; }
    table.stats { width:100%; border-collapse:collapse; font-size:0.88rem; margin:0 0 28px; }
    table.stats th, table.stats td { padding:8px 10px; border-bottom:1px solid var(--line); text-align:right; white-space:nowrap; }
    table.stats th:first-child, table.stats td:first-child { text-align:left; white-space:normal; }
    table.stats th { color:var(--muted); font-weight:600; position:sticky; top:0; background:var(--bg); }
    .tablewrap { overflow-x:auto; margin:0 0 28px; }
    .card { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:20px 24px; margin:0 0 18px; }
    .card .meta { color:var(--muted); font-size:0.85rem; margin:0 0 10px; }
    .card img { width:100%; max-width:480px; border-radius:8px; display:block; margin:10px 0 12px; }
    .card .specs { display:flex; flex-wrap:wrap; gap:8px 22px; font-size:0.88rem; color:var(--muted); margin:0 0 10px; }
    .card .specs b { color:var(--text); font-weight:600; }
    .note { border-left:3px solid var(--gold); padding:4px 0 4px 16px; color:var(--muted); margin:10px 0 0; font-size:0.92rem; }
    .crumbs { font-size:0.85rem; color:var(--muted); margin:0 0 20px; }
    .crumbs a { color:var(--muted); }
    .byline { color:var(--muted); font-size:0.88rem; margin:-24px 0 32px; }
    figure.shot { margin:8px 0 32px; }
    figure.shot img { width:100%; height:auto; display:block; border:1px solid var(--line); border-radius:10px; }
    figure.shot figcaption { color:var(--muted); font-size:0.9rem; line-height:1.55; margin-top:10px; }
    ul.sources { color:var(--muted); font-size:0.92rem; padding-left:20px; margin:0 0 28px; }
    ul.sources li { margin:0 0 6px; }
    footer.site { border-top:1px solid var(--line); }
    .footwrap { max-width:880px; margin:0 auto; padding:28px 24px; color:var(--muted); font-size:0.9rem; display:flex; flex-wrap:wrap; gap:16px; }
    .footwrap a { color:var(--gold-light); text-decoration:none; }${CHART_CSS}`;

// The "Last updated" date under each page's lede comes from content/page-dates.json, so
// regenerating never moves it. `node tools/stamp-page-dates.mjs` moves it when the page's
// content has really changed (new aircraft, rebalanced stats, rewritten advice).

function pageShell({ title, description, canonical, h1, lede, body }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}" />
  <link rel="canonical" href="${canonical}" />
  <meta property="og:title" content="${esc(title)}" />
  <meta property="og:description" content="${esc(description)}" />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="${canonical}" />
  <meta property="og:image" content="https://www.tailwindsairlinegame.com/og-image.png" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta name="twitter:card" content="summary_large_image" />
  <link rel="icon" type="image/png" href="/favicon.png" />
  <!-- Google AdSense -->
  <meta name="google-adsense-account" content="ca-pub-5123198950074938">
  <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-5123198950074938" crossorigin="anonymous"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700&display=swap" rel="stylesheet" />
  <style>${CSS}
  </style>
</head>
<body>
${NAV}

  <main>
    <p class="crumbs"><a href="/">Home</a> › <a href="/aircraft.html">Aircraft</a>${h1 === 'Aircraft in Tailwinds' ? '' : ` › ${esc(h1)}`}</p>
    <h1>${esc(h1)}</h1>
    <p class="lede">${lede}</p>
    <p class="byline">By the Tailwinds team · Last updated ${updatedLabel(`public/${canonical.slice(SITE.length + 1)}`)}</p>
${body}
    <a class="cta" href="/">Play Tailwinds — It's Free →</a>
  </main>
${FOOTER}
</body>
</html>
`;
}

// ── Derived economics ─────────────────────────────────────────────────────────

function enrich(t) {
  const fuelKm = fuelCostPerKm(t); // $/km at base price
  return {
    ...t,
    fuelKm,
    fuelSeatKm: t.seats > 0 ? (fuelKm / t.seats) * 100 : null, // ¢ per seat-km
    fuelTonneKm: t.payloadTonnes ? (fuelKm / t.payloadTonnes) * 100 : null, // ¢ per tonne-km
    leasePerSeat: t.seats > 0 ? t.weeklyLease / t.seats : null,
  };
}

function statsTable(group, isFreight) {
  const metric = (t) => (isFreight ? t.fuelTonneKm : t.fuelSeatKm);
  const ranked = [...group].filter((t) => metric(t) != null).sort((a, b) => metric(a) - metric(b));
  const rankOf = new Map(ranked.map((t, i) => [t.id, i + 1]));
  const perUnit = (t) =>
    isFreight
      ? t.payloadTonnes
        ? Math.round(t.weeklyLease / t.payloadTonnes)
        : null
      : t.seats > 0
        ? Math.round(t.leasePerSeat)
        : null;
  const rows = group
    .map((t) => {
      const rank = rankOf.get(t.id);
      const unit = perUnit(t);
      return `      <tr>
        <td><a href="#${t.id}">${esc(t.name)}</a></td>
        <td>${isFreight ? `${t.payloadTonnes} t` : fmtInt(t.seats)}</td>
        <td>${fmtInt(t.range)} km${lightCabinNote(t)}</td>
        <td>${fmtInt(cruiseSpeedKmh(t))} km/h</td>
        <td>${fmtMoney(t.weeklyLease)}</td>
        <td>${fmtMoney(t.purchasePrice)}</td>
        <td>${t.fuelBurnPer100km.toFixed(0)} L</td>
        <td>${isFreight ? (t.fuelTonneKm ? t.fuelTonneKm.toFixed(1) + '\u00a2' : '\u2014') : t.fuelSeatKm ? t.fuelSeatKm.toFixed(2) + '\u00a2' : '\u2014'}</td>
        <td>${rank ? `${rank} / ${ranked.length}` : '\u2014'}</td>
        <td>${unit ? '$' + fmtInt(unit) : '\u2014'}</td>
      </tr>`;
    })
    .join('\n');
  return `    <div class="tablewrap"><table class="stats">
      <thead><tr><th>Aircraft</th><th>${isFreight ? 'Payload' : 'Seats'}</th><th>Range</th><th>Cruise</th><th>Lease/wk</th><th>Price</th><th>Fuel/100km</th><th>Fuel/${isFreight ? 'tonne' : 'seat'}-km</th><th>Fuel rank</th><th>Lease/${isFreight ? 'tonne' : 'seat'}</th></tr></thead>
      <tbody>
${rows}
      </tbody>
    </table></div>`;
}

function aircraftCard(t, isFreight) {
  const meta = [
    esc(t.manufacturer),
    esc(t.category),
    t.runwayFt ? `needs ${fmtInt(t.runwayFt)} ft` : '',
    `maintenance ${fmtMoney(t.baseMaintenancePerWk)}/wk`,
  ]
    .filter(Boolean)
    .join(' \u00b7 ');
  return `    <div class="card" id="${t.id}">
      <h3>${esc(t.name)}</h3>
      <p class="meta">${meta}</p>
      <p>${esc(t.description || '')}</p>
    </div>`;
}

// ── Charts ────────────────────────────────────────────────────────────────────

const shortName = (t) => {
  const rest = t.name.startsWith(`${t.manufacturer} `) ? t.name.slice(t.manufacturer.length + 1) : t.name;
  return /^\d+$/.test(rest) ? t.name : rest; // "Fokker 100" stays whole
};
const PRODUCTION = [
  { key: 'built', label: 'Still in production', color: SERIES[0] },
  { key: 'closed', label: 'Out of production (arrives second-hand)', color: SERIES[1] },
];
const seriesOf = (t) => (t.oop ? 'closed' : 'built');
const pick = (group, score) => group.reduce((best, t) => (score(t) > score(best) ? t : best));
const figure = (svg, caption) => `    <figure class="chart">
      <div class="chartwrap">${svg}</div>
      <figcaption>${caption}</figcaption>
    </figure>`;

function chartsFor(page, group, isFreight) {
  const size = (t) => (isFreight ? t.payloadTonnes : typicalSeatsOf(t) || t.seats);
  const metric = (t) => (isFreight ? t.fuelTonneKm : t.fuelSeatKm);
  const unit = isFreight ? 'tonne' : 'seat';
  const few = group.length <= 12;
  const noun = { 'Narrow Body': 'narrow-body jets', 'Wide Body': 'wide-body jets', 'Regional Jet': 'regional and business jets', Turboprop: 'turboprops and propliners', Freighter: 'freighters', 'Double Deck': 'flagships' }[page.categories[0]];
  const the = (t) => (/^Concorde/.test(t.name) ? esc(t.name) : `the ${esc(t.name)}`);
  const The = (t) => the(t).replace(/^t/, 'T');

  // 1. Size against range: where each type sits in the category.
  const far = pick(group, (t) => t.range);
  const big = pick(group, (t) => size(t));
  const small = pick(group, (t) => -size(t));
  const near = pick(group, (t) => -t.range);
  const newest = pick(group, (t) => t.eis);
  const reach = scatterChart({
    label: `${page.h1}: ${isFreight ? 'payload' : 'seats'} against range for all ${group.length} types`,
    points: group.map((t) => ({
      x: size(t),
      y: t.range,
      name: t.name,
      short: shortName(t),
      series: seriesOf(t),
      tip: `${t.name}: ${isFreight ? `${t.payloadTonnes} t` : `${fmtInt(size(t))} seats`}, ${fmtInt(t.range)} km, in service ${t.eis}`,
    })),
    series: PRODUCTION,
    xLabel: isFreight ? 'Payload (tonnes)' : 'Seats in the cabin the range is quoted at',
    yLabel: 'Range (km)',
    xFmt: fmtInt,
    yFmt: fmtInt,
    labelNames: few ? group.map((t) => t.name) : [...new Set([far, big, small, near, newest].map((t) => t.name))],
  });
  const reachCaption = `${isFreight ? 'Payload' : 'Seats'} against range for all ${group.length} ${noun} in Tailwinds, from the table above. The longest-legged is ${the(far)} at ${fmtInt(far.range)} km and the ${isFreight ? 'heaviest lifter' : 'biggest cabin'} is ${the(big)} (${isFreight ? `${big.payloadTonnes} tonnes` : `${fmtInt(size(big))} seats`}). Blue types are still built and can be ordered new. Orange lines have closed, so those aircraft arrive second-hand. Hover or tap a dot for the type.`;

  // 2. Fuel per seat-km (or tonne-km) by year of entry into service: what each generation bought.
  const scored = group.filter((t) => metric(t) != null);
  const best = pick(scored, (t) => -metric(t));
  const worst = pick(scored, (t) => metric(t));
  const oldest = pick(scored, (t) => -t.eis);
  const cents = (v) => `${v.toFixed(isFreight ? 1 : 2)}\u00a2`;
  let fuel;
  let fuelCaption;
  if (few) {
    const ranked = [...scored].sort((a, b) => metric(a) - metric(b));
    fuel = barChart({
      label: `${page.h1}: fuel cost per ${unit}-kilometre, cheapest first`,
      bars: ranked.map((t) => ({ label: `${shortName(t)} (${t.eis})`, value: metric(t), series: seriesOf(t), tip: `${t.name}: ${cents(metric(t))} per ${unit}-km` })),
      series: PRODUCTION.filter((p) => ranked.some((t) => seriesOf(t) === p.key)),
      valueFmt: cents,
      xLabel: `Fuel cost per ${unit}-kilometre at the base fuel price, with the year each type entered service`,
    });
    fuelCaption = `Fuel cost per ${unit}-kilometre with every seat filled, cheapest first. ${The(best)} moves a ${unit} for ${cents(metric(best))} a kilometre; ${the(worst)} needs ${cents(metric(worst))}, ${(metric(worst) / metric(best)).toFixed(1)} times as much.`;
  } else {
    fuel = scatterChart({
      label: `${page.h1}: fuel cost per ${unit}-kilometre by year of entry into service`,
      points: scored.map((t) => ({
        x: t.eis,
        y: metric(t),
        name: t.name,
        short: shortName(t),
        series: seriesOf(t),
        tip: `${t.name} (${t.eis}): ${cents(metric(t))} per ${unit}-km`,
      })),
      series: PRODUCTION,
      xLabel: 'Year the type entered service',
      yLabel: `Fuel per ${unit}-km (\u00a2)`,
      xFmt: (v) => String(v),
      yFmt: (v) => (isFreight ? String(v) : v.toFixed(1)),
      xZero: false,
      labelNames: [...new Set([worst, best, oldest, newest].map((t) => t.name))],
    });
    fuelCaption = `Fuel cost per ${unit}-kilometre at the base fuel price, set against the year each type entered service. The dearest ${unit} on the chart is aboard ${the(worst)} (${worst.eis}) at ${cents(metric(worst))} a kilometre, and the cheapest aboard ${the(best)} (${best.eis}) at ${cents(metric(best))}. ${isFreight ? 'Payloads differ widely, so compare aircraft of a similar size.' : 'Every seat is assumed sold, and small cabins spread the same engines over fewer seats, so compare aircraft of a similar size.'}`;
  }
  return `    <!-- TW-ONLY:START -->
    <h2>The category in two charts</h2>
${figure(reach, reachCaption)}
${figure(fuel, fuelCaption)}
    <!-- TW-ONLY:END -->`;
}

// ── Category pages ────────────────────────────────────────────────────────────

const all = AIRCRAFT_TYPES.map(enrich);

for (const page of PAGES) {
  const group = all
    .filter((t) => page.categories.includes(t.category))
    .sort((a, b) => (a.seats || a.payloadTonnes || 0) - (b.seats || b.payloadTonnes || 0));
  const isFreight = page.categories.includes('Freighter');
  const body = [
    page.intro,
    `<h2>All ${group.length} aircraft at a glance</h2>`,
    `<p>Figures are the game's actual values. Fuel cost assumes the base fuel price of $1.45/litre — the live market price in your save drifts between roughly half and nearly double that, which is why <a href="/route-economics.html">fuel hedging</a> matters. Lease and price are the classic-game market rates. Any type whose production line closed in 1976 or earlier is buy-only, because no lessor stocks it, so ignore its lease column. In an era game the calendar takes over: a type appears the year it entered service, lessors only take it from ten years after that (the war-surplus C-46, C-47 and DC-4 excepted), and prices shift with the year.</p>`,
    statsTable(group, isFreight),
    chartsFor(page, group, isFreight),
    picksFor(page.file),
    backgroundFor(page.file),
    `<h2>Every type in the category</h2>`,
    `<p>Reference entries for all ${group.length}, in the same order as the table. The table above carries ${isFreight ? 'payload' : 'seats'}, range, cruise speed, lease, price and fuel; these add the runway each type needs and its base weekly maintenance bill. That base is for a factory-fresh frame: out-of-production types arrive second-hand, already years old, and their maintenance starts higher (the market screen in the game quotes the delivered figure).</p>`,
    group.map((t) => aircraftCard(t, isFreight)).join('\n'),
  ].join('\n');

  const html = pageShell({
    title: page.title,
    description: page.description,
    canonical: `${SITE}/${page.file}`,
    h1: page.h1,
    lede: page.description,
    body,
  });
  emit(page.file, html, `${group.length} aircraft`);
}

// ── Index page ────────────────────────────────────────────────────────────────

const catCounts = PAGES.map((p) => ({
  ...p,
  count: all.filter((t) => p.categories.includes(t.category)).length,
}));

const indexBody = `
      <p>Tailwinds ships with <strong>${all.length} real-world aircraft types</strong>, from 9-seat island hoppers to the Airbus A380 — every one modelled with its own seats or payload, range, lease and purchase price, fuel burn, crew cost, and maintenance bill. Which ones you fly, and where, is most of the game.</p>
      <p>The guides below cover every type in each category, with full stat tables, per-seat economics computed from the game's actual data, and honest notes on when each aircraft earns its keep. If you're new, start with the <a href="/fleet-planning.html">fleet planning guide</a> to learn how to think about aircraft selection, then dive into a category.</p>

      <h2>Browse by category</h2>
${catCounts
  .map(
    (p) => `      <div class="card">
        <h3><a href="/${p.file}">${esc(p.h1)}</a></h3>
        <p class="meta">${p.count} aircraft</p>
        <p>${esc(p.description)}</p>
      </div>`
  )
  .join('\n')}

      <h2>How aircraft economics work in Tailwinds</h2>
      <p>Every aircraft in the game charges you in four ways: a <strong>weekly lease</strong> (or capital tied up in a purchase), <strong>fuel</strong> burned per kilometre flown, <strong>crew</strong> cost per kilometre, and a weekly <strong>maintenance</strong> bill that grows as the airframe ages. Revenue comes from the seats (or cargo tonnes) you fill. The art of fleet planning is matching capacity and range to each route so you pay for exactly the aircraft the mission needs — and nothing more. Orders are not instant, either: the first frame of a type arrives after twice its class's lead time (two weeks for a turboprop, up to ten for a double-decker), and each further frame of the same type follows one lead time behind the last.</p>
      <p>Two derived numbers appear throughout these guides. <strong>Fuel per seat-km</strong> is the fuel cost of moving one seat one kilometre — the cleanest efficiency comparison between types. <strong>Lease per seat</strong> spreads the weekly lease across capacity, showing how expensive each seat is before it ever leaves the gate. Together they explain most of why one aircraft makes money on a route and another loses it.</p>
      <figure class="shot">
        <img src="/img/guide/market.webp" width="1200" height="785" loading="lazy" alt="The Fleet Market screen in table view, listing Airbus types with seats, range, runway, fuel per seat, maintenance, lease and purchase price" />
        <figcaption>Fleet › Market in table view puts every type side by side: seats, range, runway length, fuel burn per seat, a 0–100 fuel-efficiency score, weekly maintenance, lease rate and purchase price. Filter by category or manufacturer, or show only types you can lease right now.</figcaption>
      </figure>`;

emit(
  'aircraft.html',
  pageShell({
    title: `Aircraft Guide — All ${all.length} Planes in Tailwinds Airline Management Game`,
    description: `Complete guide to all ${all.length} aircraft in Tailwinds: narrow-bodies, widebodies, regional jets, turboprops, freighters and flagships — with real in-game stats and economics.`,
    canonical: `${SITE}/aircraft.html`,
    h1: 'Aircraft in Tailwinds',
    lede: `Every aircraft in the game, organised by category — with real stats, per-seat economics, and advice on when to fly each one.`,
    body: indexBody,
  }),
  `index, ${all.length} aircraft`
);
if (CHECK && staleCount) process.exit(1);

