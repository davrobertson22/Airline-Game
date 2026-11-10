// site-chrome.mjs
// The ONE copy of the header nav and footer shared by every static page in public/.
//
//   - Generators (generate-aircraft-pages.mjs, generate-devlog-pages.mjs) import NAV / FOOTER.
//   - Hand-written pages carry a pasted copy; `node tools/sync-site-chrome.mjs` rewrites it
//     in every public/*.html, and tools/site-pages-test.mjs fails when one has drifted.
//
// To add a page to the site: write it, add it to GUIDES / ARTICLES below (that puts it in
// the footer), run the sync, then `node tools/stamp-page-dates.mjs` to date it and rebuild
// the sitemap. The homepage's Guides section is hand-written in index.html; the test checks
// that every guide and article here is linked from it.

export const SITE = 'https://www.tailwindsairlinegame.com';

// Game guides: how Tailwinds works and how to play it well.
export const GUIDES = [
  ['how-to-play.html', 'How to Play'],
  ['strategy.html', 'Strategy'],
  ['beginner-mistakes.html', 'Beginner Mistakes'],
  ['route-economics.html', 'Route Economics'],
  ['route-case-study.html', 'Route Case Study'],
  ['hub-strategy.html', 'Hub Strategy'],
  ['fleet-planning.html', 'Fleet Planning'],
  ['demand-and-quality.html', 'Demand &amp; Quality'],
  ['competition-and-alliances.html', 'Competition &amp; Alliances'],
  ['fuel-hedging.html', 'Fuel Hedging'],
  ['on-time-performance.html', 'On-Time Performance'],
  ['aircraft.html', 'Aircraft'],
  ['glossary.html', 'Glossary'],
  ['faq.html', 'FAQ'],
];

// Articles: aviation explained, with the game's data. Readable without playing.
export const ARTICLES = [
  ['regional-jets-explained.html', 'Regional Jets Explained'],
  ['narrow-body-vs-wide-body.html', 'Narrow-Body vs Wide-Body'],
  ['a380-vs-747.html', 'A380 vs 747'],
  ['best-airline-management-games.html', 'Best Airline Games'],
];

const SITE_PAGES = [
  ['devlog.html', 'Devlog'],
  ['about.html', 'About'],
  ['contact.html', 'Contact'],
];

const a = ([file, label]) => `      <a href="/${file}">${label}</a>`;

export const NAV = `
  <header class="site">
    <nav class="site">
      <a class="brand" href="/">Tailwinds</a>
      <a class="link" href="/how-to-play.html">How to Play</a>
      <a class="link" href="/#guides">Guides</a>
      <a class="link" href="/aircraft.html">Aircraft</a>
      <a class="link" href="/devlog.html">Devlog</a>
      <a class="link" href="/faq.html">FAQ</a>
      <a class="link" href="/support.html" style="color:var(--gold-light);border:1px solid var(--gold);border-radius:999px;padding:2px 12px;font-weight:600;">&#9829; Support</a>
      <a class="link" href="/">Play</a>
    </nav>
  </header>`;

export const FOOTER = `
  <footer class="site">
    <div class="footwrap">
      <a href="/?home">Home</a>
${[...GUIDES, ...ARTICLES, ...SITE_PAGES].map(a).join('\n')}
      <a href="/support.html" style="font-weight:600;">&#9829; Support Tailwinds</a>
      <a href="/privacy.html">Privacy</a>
      <a href="/terms.html">Terms</a>
      <span style="margin-left:auto;">© Tailwinds — free to play in your browser. Multiplayer: <a href="https://www.headwindsairlinegame.com" target="_blank" rel="noopener noreferrer">Headwinds</a>.</span>
    </div>
  </footer>`;

// The same blocks as they sit inside a page (leading newline dropped).
export const NAV_BLOCK = NAV.replace(/^\n/, '');
export const FOOTER_BLOCK = FOOTER.replace(/^\n/, '');

const HEADER_RE = /[ \t]*<header class="site">[\s\S]*?<\/header>/;
const FOOTER_RE = /[ \t]*<footer class="site">[\s\S]*?<\/footer>/;

// Returns the page with the shared nav and footer swapped in. Pages without the
// blocks (the Search Console verification file) come back untouched.
export function applyChrome(html) {
  let out = html;
  if (HEADER_RE.test(out)) out = out.replace(HEADER_RE, () => NAV_BLOCK);
  if (FOOTER_RE.test(out)) out = out.replace(FOOTER_RE, () => FOOTER_BLOCK);
  return out;
}
