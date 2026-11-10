// stamp-page-dates.mjs
// Gives every static page a REAL "last updated" date: the day its own content last changed,
// not the day of the latest release. It owns three things:
//
//   content/page-dates.json   one { hash, updated } per page (hash of the page's main content)
//   the "Last updated ..." byline on pages that carry one, and "dateModified" in their JSON-LD
//   public/sitemap.xml        rebuilt in full: every page, each with its own <lastmod>
//
//   node tools/stamp-page-dates.mjs                    a page whose content hash changed gets today's date
//   node tools/stamp-page-dates.mjs --date=2026-11-09  ...or the date given
//   node tools/stamp-page-dates.mjs --check            exit 1 if a page, a byline or the sitemap is out of date
//   node tools/stamp-page-dates.mjs --seed-from-git    (one-off) date each page from the last commit
//                                                      that changed its content; used to build the manifest
//
// Only the text, images and charts inside <main> count (for the homepage, the landing), and the
// byline itself is ignored. So a nav, footer or CSS change never moves a date, and re-running
// this is always safe. Run it after any edit to a page in public/ or to index.html.
//
// A date moves only for a SIGNIFICANT change, which is what Google asks <lastmod> to mean.
// Each page is cut into blocks (paragraphs, list items, table rows, headings, images) and the
// date moves when MIN_BLOCKS or more of them are added, removed or reworded since the page was
// last dated. Fixing one number that appears on every page therefore re-dates nothing; small
// edits accumulate against the last dated version until together they cross the line.
// Devlog pages are simpler: they only ever change by gaining an entry, so any change dates them.

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { SITE } from './site-chrome.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = 'content/page-dates.json';
const SITEMAP = 'public/sitemap.xml';
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// ── Which files are pages ─────────────────────────────────────────────────────

// Repo-relative paths of every page: index.html plus public/**/*.html, minus the
// Search Console verification file.
export function listPages(root = ROOT) {
  const out = ['index.html'];
  const walk = (dir) => {
    for (const name of readdirSync(path.join(root, dir)).sort()) {
      const rel = `${dir}/${name}`;
      if (statSync(path.join(root, rel)).isDirectory()) walk(rel);
      else if (name.endsWith('.html') && !/^google[0-9a-f]+\.html$/.test(name)) out.push(rel);
    }
  };
  walk('public');
  return out;
}

export const urlPath = (rel) => (rel === 'index.html' ? '' : rel.replace(/^public\//, ''));

// ── Content fingerprint ───────────────────────────────────────────────────────

export const MIN_BLOCKS = 3;
const short = (text) => createHash('sha256').update(text).digest('hex');
const isDevlog = (rel) => /^public\/devlog(\.html$|\/)/.test(rel);

function mainBody(html) {
  let body;
  const main = html.match(/<main[\s\S]*?<\/main>/);
  if (main) body = main[0];
  else {
    const s = html.indexOf('<div id="seo-landing"');
    const e = html.indexOf('<div id="root"');
    body = s >= 0 && e > s ? html.slice(s, e) : html;
  }
  return body.replace(/<p class="byline"[\s\S]*?<\/p>/g, '').replace(/<(script|style)[\s\S]*?<\/\1>/g, '');
}

// The page as a list of block fingerprints: one per paragraph, list item, heading, table row,
// caption, image and chart.
export function contentBlocks(html) {
  const marked = mainBody(html)
    .replace(/<svg[\s\S]*?<\/svg>/g, (svg) => `\u0001chart ${short(svg).slice(0, 12)}\u0001`)
    .replace(/<img[^>]*\ssrc="([^"]*)"[^>]*>/g, (_, src) => `\u0001image ${src}\u0001`)
    .replace(/<\/(p|li|h[1-6]|tr|figcaption|dt|dd|blockquote|summary)>/g, '\u0001');
  return marked
    .split('\u0001')
    .map((piece) => piece.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .map((text) => short(text).slice(0, 6));
}

export const contentHash = (html) => short(contentBlocks(html).join(' ')).slice(0, 16);

// How many blocks differ between two versions: the larger of "new or reworded" and "gone".
export function blocksTouched(oldBlocks, newBlocks) {
  const a = new Set(oldBlocks);
  const b = new Set(newBlocks);
  let added = 0;
  let removed = 0;
  for (const x of b) if (!a.has(x)) added++;
  for (const x of a) if (!b.has(x)) removed++;
  return Math.max(added, removed);
}

function fingerprint(rel, html, updated) {
  const blocks = contentBlocks(html);
  const entry = { updated, hash: short(blocks.join(' ')).slice(0, 16) };
  if (!isDevlog(rel)) entry.blocks = blocks.join(' ');
  return entry;
}

// ── Dates ─────────────────────────────────────────────────────────────────────

const BYLINE_RE = /(<p class="byline"[^>]*>[^<]*Last updated )([A-Z][a-z]+ \d{1,2}, \d{4})/;
const MODIFIED_RE = /("dateModified":\s*")(\d{4}-\d{2}-\d{2})/;
export const longDate = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
};
const todayIso = () => {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
};
// A generated page can state the date of its own content (a devlog post's publication
// day). It is used the first time the page is seen; after that, changes are dated normally.
const declaredDate = (html) => (html.match(/<meta name="date" content="(\d{4}-\d{2}-\d{2})"/) || [])[1];

export function readManifest(root = ROOT) {
  const p = path.join(root, MANIFEST);
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : {};
}

// The "Last updated" date a generator should print for a page it is about to write.
export function updatedLabel(rel, root = ROOT) {
  const entry = readManifest(root)[rel];
  return longDate(entry ? entry.updated : todayIso());
}

// ── Sitemap ───────────────────────────────────────────────────────────────────

function sitemapMeta(rel) {
  const f = urlPath(rel);
  if (f === '') return ['weekly', '1.0'];
  if (f === 'devlog.html') return ['weekly', '0.7'];
  if (f.startsWith('devlog/')) return ['monthly', '0.5'];
  if (f === 'terms.html') return ['yearly', '0.3'];
  if (f === 'privacy.html' || f === 'contact.html') return ['yearly', '0.4'];
  if (f === 'support.html') return ['monthly', '0.5'];
  if (f === 'about.html') return ['monthly', '0.6'];
  if (/^(aircraft-|glossary|faq|beginner-mistakes|route-case-study|fuel-hedging)/.test(f)) return ['monthly', '0.7'];
  return ['monthly', '0.8'];
}

export function buildSitemap(pages, manifest) {
  const urls = pages
    .map((rel) => {
      const [freq, pri] = sitemapMeta(rel);
      return `  <url>
    <loc>${SITE}/${urlPath(rel)}</loc>
    <lastmod>${manifest[rel].updated}</lastmod>
    <changefreq>${freq}</changefreq>
    <priority>${pri}</priority>
  </url>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

// ── Seeding from git (one-off) ────────────────────────────────────────────────

function seedFromGit(rel) {
  const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  let log;
  try {
    log = git('log', '--format=%H %ad', '--date=short', '--', rel).trim().split('\n').filter(Boolean);
  } catch {
    return null;
  }
  if (!log.length) return null;
  // Walk back from HEAD while the page is still essentially today's page. The oldest
  // such commit is when it last changed significantly; that version becomes the baseline.
  let head = null;
  let seed = null;
  for (const line of log) {
    const [sha, day] = line.split(' ');
    let html;
    try {
      html = git('show', `${sha}:${rel}`);
    } catch {
      break;
    }
    const blocks = contentBlocks(html);
    if (head === null) head = blocks;
    const touched = blocksTouched(blocks, head);
    if (isDevlog(rel) ? touched > 0 : touched >= MIN_BLOCKS) break;
    seed = fingerprint(rel, html, day);
  }
  return seed;
}

// ── Main ──────────────────────────────────────────────────────────────────────

// Returns the list of problems (empty when everything is in step). With write=true it fixes them.
export function run({ root = ROOT, write = false, date = todayIso() } = {}) {
  const pages = listPages(root);
  const before = readManifest(root);
  const manifest = {};
  const problems = [];
  for (const rel of pages) {
    const p = path.join(root, rel);
    let html = readFileSync(p, 'utf8');
    const known = before[rel];
    const blocks = contentBlocks(html);
    const touched = known && known.blocks !== undefined ? blocksTouched(known.blocks.split(' '), blocks) : null;
    if (known && (known.hash === contentHash(html) || (touched !== null && touched < MIN_BLOCKS))) {
      manifest[rel] = known; // unchanged, or an edit too small to re-date the page
    } else {
      manifest[rel] = fingerprint(rel, html, (!known && declaredDate(html)) || date);
      problems.push(`${rel}: ${known ? (touched === null ? 'changed' : `${touched} blocks changed`) : 'new page'} — dated ${manifest[rel].updated}`);
    }
    const m = html.match(BYLINE_RE);
    if (m && m[2] !== longDate(manifest[rel].updated)) {
      problems.push(`${rel}: byline says "${m[2]}", content last changed ${longDate(manifest[rel].updated)}`);
      if (write) {
        html = html.replace(BYLINE_RE, (_, lead) => lead + longDate(manifest[rel].updated));
        writeFileSync(p, html);
      }
    }
    const j = html.match(MODIFIED_RE);
    if (j && j[2] !== manifest[rel].updated) {
      problems.push(`${rel}: JSON-LD dateModified is ${j[2]}, content last changed ${manifest[rel].updated}`);
      if (write) {
        html = html.replace(MODIFIED_RE, (_, lead) => lead + manifest[rel].updated);
        writeFileSync(p, html);
      }
    }
  }
  for (const rel of Object.keys(before)) if (!manifest[rel]) problems.push(`${rel}: in ${MANIFEST} but no longer a page`);

  const sitemap = buildSitemap(pages, manifest);
  const sitemapPath = path.join(root, SITEMAP);
  if (!existsSync(sitemapPath) || readFileSync(sitemapPath, 'utf8') !== sitemap) {
    problems.push(`${SITEMAP}: out of date`);
    if (write) writeFileSync(sitemapPath, sitemap);
  }
  const json = JSON.stringify(manifest, null, 2) + '\n';
  const manifestPath = path.join(root, MANIFEST);
  if (write && (!existsSync(manifestPath) || readFileSync(manifestPath, 'utf8') !== json)) writeFileSync(manifestPath, json);
  return problems;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (name) => (process.argv.find((a) => a.startsWith(`--${name}=`)) || '').split('=')[1];
  if (process.argv.includes('--seed-from-git')) {
    const manifest = readManifest();
    for (const rel of listPages()) {
      const seed = seedFromGit(rel);
      if (!seed) continue;
      manifest[rel] = seed;
      console.log(`${seed.updated}  ${rel}`);
    }
    writeFileSync(path.join(ROOT, MANIFEST), JSON.stringify(manifest, null, 2) + '\n');
  } else {
    const check = process.argv.includes('--check');
    const date = arg('date');
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('--date must be YYYY-MM-DD');
    const problems = run({ write: !check, date: date || undefined });
    for (const line of problems) console.log(check ? `stale: ${line}` : line);
    console.log(problems.length ? (check ? `\n${problems.length} out of date — run: node tools/stamp-page-dates.mjs` : `\n${problems.length} updated`) : 'every page date and the sitemap are current');
    if (check && problems.length) process.exit(1);
  }
}
