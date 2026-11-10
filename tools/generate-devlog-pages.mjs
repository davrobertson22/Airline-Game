// generate-devlog-pages.mjs
// Builds every devlog page from the one source file, content/devlog-entries.html.
//
//   public/devlog.html            the index: every update, by month, headline + first line
//   public/devlog/YYYY-MM.html    one page per month, entries in full
//   public/devlog/<slug>.html     a page of its own for any entry of 500+ words
//                                 (the month page then carries a summary and a link, so the
//                                 same text is never published at two URLs)
//   index.html                    the "Latest updates" block between the DEVLOG-LATEST markers
//
//   node tools/generate-devlog-pages.mjs          write the pages
//   node tools/generate-devlog-pages.mjs --check  exit 1 if any page on disk is stale
//
// After writing, run `node tools/stamp-page-dates.mjs` to date the pages and rebuild the sitemap.

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { NAV, FOOTER, SITE } from './site-chrome.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = 'content/devlog-entries.html';
export const POST_MIN_WORDS = 500;
export const HOME_LATEST = 5;
// A month too short to stand as a page of its own is published on a neighbour's page.
// June 2026 was the devlog's first fortnight: three entries, about 260 words.
const PAGE_OF = { '2026-06': '2026-07' };
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// ── Text helpers ──────────────────────────────────────────────────────────────

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', hellip: '…', rarr: '→', larr: '←', times: '×', middot: '·', minus: '−', deg: '°', eacute: 'é', frac12: '½', cent: '¢' };
const decode = (s) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z0-9]+);/gi, (m, n) => (n in NAMED ? NAMED[n] : m));
// Inline tags vanish (so "<strong>word</strong>:" stays "word:"); block tags become a space.
export const plain = (html) =>
  decode(html.replace(/<\/?(strong|em|a|code|span|b|i)\b[^>]*>/g, '').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const wordCount = (html) => (plain(html) ? plain(html).split(' ').length : 0);

function clip(text, max) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return cut.slice(0, Math.max(cut.lastIndexOf(' '), max - 30)).replace(/[\s,;:—–-]+$/, '') + '…';
}

function slugify(text) {
  const base = text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’‘']/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (base.length <= 60) return base || 'update';
  const cut = base.slice(0, 60);
  return cut.slice(0, cut.lastIndexOf('-') > 30 ? cut.lastIndexOf('-') : 60).replace(/-+$/, '');
}

// ── Parse the source ──────────────────────────────────────────────────────────

export function parseEntries(source) {
  const body = source.replace(/^\s*<!--[\s\S]*?-->/, '');
  const chunks = body.split(/(?=<div class="entry")/).filter((c) => c.trim());
  const entries = chunks.map((chunk, i) => {
    const where = `entry ${i + 1} of ${SOURCE}`;
    const open = chunk.match(/^<div class="entry"([^>]*)>/);
    if (!open) throw new Error(`${where}: text outside an entry: ${chunk.trim().slice(0, 80)}`);
    const dateM = chunk.match(/<p class="date">([^<]+)<\/p>/);
    const h2M = chunk.match(/<h2[^>]*>([\s\S]*?)<\/h2>/);
    if (!dateM || !h2M) throw new Error(`${where}: needs a <p class="date"> and an <h2>`);
    const dm = dateM[1].trim().match(/^([A-Z][a-z]+) (\d{1,2}), (\d{4})$/);
    const month = dm ? MONTHS.indexOf(dm[1]) : -1;
    if (month < 0) throw new Error(`${where}: date "${dateM[1]}" is not "Month D, YYYY"`);
    const close = chunk.lastIndexOf('</div>');
    if (close < 0) throw new Error(`${where}: entry is not closed`);
    const bodyHtml = chunk.slice(chunk.indexOf('</h2>') + 5, close).replace(/^\s*\n/, '').trimEnd();
    if (/<div/.test(bodyHtml)) throw new Error(`${where}: a <div> inside an entry is not supported`);
    const attr = (name) => (open[1].match(new RegExp(`data-${name}="([^"]*)"`)) || [])[1];
    const titleHtml = h2M[1].trim();
    const first = bodyHtml.match(/<(li|p)[^>]*>([\s\S]*?)<\/\1>/);
    return {
      dateText: dateM[1].trim(),
      year: Number(dm[3]),
      month,
      day: Number(dm[2]),
      iso: `${dm[3]}-${String(month + 1).padStart(2, '0')}-${String(dm[2]).padStart(2, '0')}`,
      monthKey: `${dm[3]}-${String(month + 1).padStart(2, '0')}`,
      monthLabel: `${MONTHS[month]} ${dm[3]}`,
      titleHtml,
      title: plain(titleHtml),
      bodyHtml,
      words: wordCount(titleHtml + ' ' + bodyHtml),
      excerpt: clip(first ? plain(first[2]) : plain(bodyHtml), 210),
      fixedSlug: attr('slug'),
      postFlag: attr('post'),
    };
  });

  // Newest first, same-day entries in the order written.
  entries.sort((x, y) => (x.iso < y.iso ? 1 : x.iso > y.iso ? -1 : 0));

  // Slugs are handed out oldest first, so adding a new entry never renames an old one.
  const used = new Set();
  for (const e of [...entries].reverse()) {
    let slug = e.fixedSlug || slugify(e.title);
    if (/^\d{4}-\d{2}$/.test(slug)) slug = `update-${slug}`;
    let n = 2;
    const base = slug;
    while (used.has(slug)) slug = `${base}-${n++}`;
    used.add(slug);
    e.slug = slug;
    e.isPost = e.postFlag === 'yes' || (e.postFlag !== 'no' && e.words >= POST_MIN_WORDS);
    e.pageKey = PAGE_OF[e.monthKey] || e.monthKey;
    e.url = e.isPost ? `/devlog/${slug}.html` : `/devlog/${e.pageKey}.html#${slug}`;
  }
  return entries;
}

// ── Page shell ────────────────────────────────────────────────────────────────

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
    main { max-width:760px; margin:0 auto; padding:48px 24px 72px; }
    h1 { font-family:'Space Grotesk',sans-serif; font-size:2.1rem; line-height:1.2; margin:0 0 8px; }
    .lede { color:var(--muted); font-size:1.1rem; margin:0 0 36px; }
    h2 { font-family:'Space Grotesk',sans-serif; font-size:1.45rem; margin:0 0 4px; }
    h2 a { color:var(--text); text-decoration:none; }
    h2 a:hover { color:var(--gold-light); }
    h3 { font-size:1.05rem; margin:20px 0 6px; }
    p { margin:0 0 16px; }
    ul { margin:0 0 16px; padding-left:22px; }
    li { margin:0 0 8px; }
    .crumbs { font-size:0.85rem; color:var(--muted); margin:0 0 20px; }
    .crumbs a { color:var(--muted); }
    .byline { color:var(--muted); font-size:0.88rem; margin:-24px 0 32px; }
    .entry { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:24px 28px; margin:0 0 22px; scroll-margin-top:16px; }
    .entry .date { color:var(--gold-light); font-size:0.85rem; font-weight:600; text-transform:uppercase; letter-spacing:0.05em; margin:0 0 6px; }
    .entry h2 { margin:0 0 12px; }
    .entry > :last-child { margin-bottom:0; }
    .post h2 { margin:32px 0 10px; }
    .month { margin:0 0 40px; }
    .month h2 { margin:0 0 4px; }
    .month .count { color:var(--muted); font-size:0.88rem; margin:0 0 14px; }
    ul.idx { list-style:none; padding:0; margin:0; border-top:1px solid var(--line); }
    ul.idx li { margin:0; padding:12px 0; border-bottom:1px solid var(--line); display:grid; grid-template-columns:64px 1fr; gap:2px 14px; }
    ul.idx .d { color:var(--gold-light); font-size:0.82rem; font-weight:600; text-transform:uppercase; letter-spacing:0.04em; padding-top:3px; }
    ul.idx a { font-weight:600; text-decoration:none; }
    ul.idx a:hover { text-decoration:underline; }
    ul.idx .x { grid-column:2; color:var(--muted); font-size:0.92rem; line-height:1.55; }
    .pager { display:flex; flex-wrap:wrap; justify-content:space-between; gap:12px 24px; margin:32px 0 8px; font-size:0.95rem; }
    .pager a { text-decoration:none; }
    .cta { display:inline-block; background:var(--gold); color:#20180a; font-weight:700; padding:13px 30px; border-radius:8px; text-decoration:none; margin:18px 0; }
    footer.site { border-top:1px solid var(--line); }
    .footwrap { max-width:880px; margin:0 auto; padding:28px 24px; color:var(--muted); font-size:0.9rem; display:flex; flex-wrap:wrap; gap:16px; }
    .footwrap a { color:var(--gold-light); text-decoration:none; }
    @media (max-width:520px) { .entry { padding:20px 18px; } ul.idx li { grid-template-columns:1fr; } ul.idx .x { grid-column:1; } }`;

function shell({ title, description, file, date, ogType = 'website', jsonLd, main }) {
  const canonical = `${SITE}/${file}`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <!-- GENERATED by tools/generate-devlog-pages.mjs from content/devlog-entries.html. Do not edit. -->
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}" />
  <meta name="date" content="${date}" />
  <link rel="canonical" href="${canonical}" />
  <meta property="og:title" content="${esc(title)}" />
  <meta property="og:description" content="${esc(description)}" />
  <meta property="og:type" content="${ogType}" />
  <meta property="og:url" content="${canonical}" />
  <meta property="og:image" content="${SITE}/og-image.png" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta name="twitter:card" content="summary_large_image" />
  <link rel="icon" type="image/png" href="/favicon.png" />${jsonLd ? `\n  <script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>` : ''}
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
${main}
  </main>
${FOOTER}
</body>
</html>
`;
}

const CTA = `    <a class="cta" href="/">Play Tailwinds — It's Free →</a>`;
const shortDate = (e) => `${MONTHS[e.month].slice(0, 3)} ${e.day}`;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// ── Pages ─────────────────────────────────────────────────────────────────────

function indexPage(entries, months) {
  const oldest = entries[entries.length - 1];
  const sections = months
    .map(
      (m) => `    <section class="month">
      <h2><a href="/devlog/${m.key}.html">${m.label}</a></h2>
      <p class="count">${plural(m.entries.length, 'update')} · <a href="/devlog/${m.key}.html">read the month in full</a></p>
      <ul class="idx">
${m.entries.map((e) => `        <li><span class="d">${shortDate(e)}</span><a href="${e.url}">${e.titleHtml}</a><span class="x">${esc(e.excerpt)}</span></li>`).join('\n')}
      </ul>
    </section>`
    )
    .join('\n\n');
  return shell({
    title: 'Devlog — Tailwinds Airline Management Game Updates',
    description: "Development log for Tailwinds: what's new in the free browser airline management game — new features, balance changes, and fixes, update by update.",
    file: 'devlog.html',
    date: entries[0].iso,
    main: `    <h1>Devlog</h1>
    <p class="lede">What's changing in Tailwinds, update by update. The game ships improvements most days, and every significant one is written up here for players: ${plural(entries.length, 'update')} since ${MONTHS[oldest.month]} ${oldest.year}, newest first. For discussion, bug reports, and sneak peeks, <a href="/contact.html">join the Discord</a>.</p>

${sections}

    <p>Older changes predate this devlog. From ${MONTHS[oldest.month]} ${oldest.year} on, every significant update gets an entry.</p>

${CTA}`,
  });
}

function monthPage(m, i, months) {
  const newer = months[i - 1];
  const older = months[i + 1];
  const cards = m.entries
    .map((e) =>
      e.isPost
        ? `    <div class="entry" id="${e.slug}">
      <p class="date">${e.dateText}</p>
      <h2><a href="${e.url}">${e.titleHtml}</a></h2>
      <p>${esc(e.excerpt)}</p>
      <p><a href="${e.url}">Read the full update →</a></p>
    </div>`
        : `    <div class="entry" id="${e.slug}">
      <p class="date">${e.dateText}</p>
      <h2><a href="#${e.slug}">${e.titleHtml}</a></h2>
${e.bodyHtml}
    </div>`
    )
    .join('\n\n');
  const heads = m.entries.slice(0, 3).map((e) => e.title).join('; ');
  return shell({
    title: `Tailwinds Devlog: ${m.label} Updates`,
    description: clip(`Every Tailwinds update from ${m.label}, in full: ${heads}`, 158),
    file: `devlog/${m.key}.html`,
    date: m.entries[0].iso,
    main: `    <p class="crumbs"><a href="/">Home</a> › <a href="/devlog.html">Devlog</a> › ${m.label}</p>
    <h1>Devlog: ${m.label}</h1>
    <p class="lede">${plural(m.entries.length, 'update')} to Tailwinds in ${m.label}, newest first. The <a href="/devlog.html">devlog index</a> lists every month.</p>

${cards}

    <p class="pager">
      <span>${older ? `<a href="/devlog/${older.key}.html">← ${older.label}</a>` : ''}</span>
      <span><a href="/devlog.html">All months</a></span>
      <span>${newer ? `<a href="/devlog/${newer.key}.html">${newer.label} →</a>` : ''}</span>
    </p>

${CTA}`,
  });
}

function postPage(e, entries) {
  const at = entries.indexOf(e);
  const newer = entries[at - 1];
  const older = entries[at + 1];
  return shell({
    title: `${e.title} — Tailwinds Devlog`,
    description: clip(e.excerpt, 158),
    file: `devlog/${e.slug}.html`,
    date: e.iso,
    ogType: 'article',
    jsonLd: {
      '@context': 'https://schema.org',
      '@type': 'BlogPosting',
      headline: e.title,
      datePublished: e.iso,
      mainEntityOfPage: `${SITE}/devlog/${e.slug}.html`,
      author: { '@type': 'Organization', name: 'Tailwinds', url: SITE },
      publisher: { '@type': 'Organization', name: 'Tailwinds', url: SITE },
    },
    main: `    <p class="crumbs"><a href="/">Home</a> › <a href="/devlog.html">Devlog</a> › <a href="/devlog/${e.pageKey}.html">${e.pageLabel}</a></p>
    <h1>${e.titleHtml}</h1>
    <p class="byline" style="margin-top:0;">${e.dateText} · By the Tailwinds team</p>

    <div class="post">
${e.bodyHtml}
    </div>

    <p class="pager">
      <span>${older ? `<a href="${older.url}">← ${older.titleHtml}</a>` : ''}</span>
      <span>${newer ? `<a href="${newer.url}">${newer.titleHtml} →</a>` : ''}</span>
    </p>
    <p><a href="/devlog/${e.pageKey}.html">More updates from ${e.pageLabel}</a> · <a href="/devlog.html">All updates</a></p>

${CTA}`,
  });
}

const HOME_START = '<!-- DEVLOG-LATEST:START (generated by tools/generate-devlog-pages.mjs; do not edit) -->';
const HOME_END = '<!-- DEVLOG-LATEST:END -->';

function homeBlock(entries) {
  return entries
    .slice(0, HOME_LATEST)
    .map(
      (e) => `          <a class="sl-update" href="${e.url}">
            <span class="sl-date">${e.dateText}</span>
            <strong>${e.titleHtml}</strong>
            <span class="sl-x">${esc(e.excerpt)}</span>
          </a>`
    )
    .join('\n');
}

// ── Build ─────────────────────────────────────────────────────────────────────

// Returns { files: Map<path relative to the repo root, contents>, entries, months }.
export function build(root = ROOT) {
  const entries = parseEntries(readFileSync(path.join(root, SOURCE), 'utf8'));
  const months = [];
  for (const e of entries) {
    let m = months[months.length - 1];
    if (!m || m.key !== e.pageKey) months.push((m = { key: e.pageKey, entries: [] }));
    m.entries.push(e);
  }
  for (const m of months) {
    // "July 2026", or "June and July 2026" when a short month shares the page.
    const labels = [...new Set(m.entries.map((e) => e.monthLabel))].reverse();
    m.label = labels.length === 1 ? labels[0] : `${labels.slice(0, -1).map((l) => l.split(' ')[0]).join(', ')} and ${labels[labels.length - 1]}`;
    for (const e of m.entries) e.pageLabel = m.label;
  }
  const files = new Map();
  files.set('public/devlog.html', indexPage(entries, months));
  months.forEach((m, i) => files.set(`public/devlog/${m.key}.html`, monthPage(m, i, months)));
  for (const e of entries) if (e.isPost) files.set(`public/devlog/${e.slug}.html`, postPage(e, entries));

  const homePath = path.join(root, 'index.html');
  const home = readFileSync(homePath, 'utf8');
  const s = home.indexOf(HOME_START);
  const t = home.indexOf(HOME_END);
  if (s >= 0 && t > s) {
    files.set('index.html', `${home.slice(0, s + HOME_START.length)}\n${homeBlock(entries)}\n          ${home.slice(t)}`);
  }
  return { files, entries, months, hasHomeBlock: s >= 0 && t > s };
}

// Generated pages on disk that the source no longer produces (a renamed headline, say).
export function orphans(files, root = ROOT) {
  const dir = path.join(root, 'public/devlog');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.html') && !files.has(`public/devlog/${f}`))
    .map((f) => `public/devlog/${f}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check');
  const { files, entries, months, hasHomeBlock } = build();
  let stale = 0;
  for (const [rel, content] of files) {
    const p = path.join(ROOT, rel);
    const same = existsSync(p) && readFileSync(p, 'utf8') === content;
    if (same) continue;
    stale++;
    if (check) console.log(`stale: ${rel}`);
    else {
      mkdirSync(path.dirname(p), { recursive: true });
      writeFileSync(p, content);
      console.log(`wrote ${rel}`);
    }
  }
  const left = orphans(files);
  for (const f of left) console.log(`orphan: ${f} is no longer generated — delete it (git rm) so it stops being served`);
  if (!hasHomeBlock) console.log('note: index.html has no DEVLOG-LATEST markers, so the homepage block was skipped');
  const posts = entries.filter((e) => e.isPost).length;
  console.log(`${entries.length} entries · ${months.length} month pages · ${posts} standalone posts${stale ? '' : ' · everything up to date'}`);
  if (check && (stale || left.length)) process.exit(1);
}
