// site-pages-test.mjs
// Guards the static site Google and AdSense review: public/**/*.html and the landing in
// index.html. Each check exists because its failure was found on the live site in
// November 2026, when AdSense turned the site down for "low value content" a second time:
// the homepage linked to only half the guides, five unlinked pages were crawled but not
// indexed, every page claimed the same "last updated" day, and the whole devlog was one URL.
//
//   node tools/site-pages-test.mjs
//
// Most failures are fixed by re-running the tool the message names.

import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { applyChrome, GUIDES, ARTICLES, SITE } from './site-chrome.mjs';
import { build as buildDevlog, orphans, POST_MIN_WORDS, HOME_LATEST } from './generate-devlog-pages.mjs';
import { fill as fillGenerated } from './generate-guide-charts.mjs';
import { listPages, urlPath, run as checkDates, readManifest } from './stamp-page-dates.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const pages = listPages(ROOT);
const html = Object.fromEntries(pages.map((rel) => [rel, read(rel)]));
const mainText = (h) => {
  const m = h.match(/<main[\s\S]*?<\/main>/);
  return (m ? m[0] : h).replace(/<(script|style|svg)[\s\S]*?<\/\1>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
};
const words = (h) => mainText(h).split(' ').length;

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL ${name}\n       ${String(err.message).split('\n').join('\n       ')}`);
  }
}

console.log('\n── shared nav and footer ───────────────────────────────────');
test('every page carries the nav and footer from tools/site-chrome.mjs', () => {
  const drifted = pages.filter((rel) => rel !== 'index.html' && applyChrome(html[rel]) !== html[rel]);
  assert.deepEqual(drifted, [], 'run: node tools/sync-site-chrome.mjs (and the generators, for generated pages)');
});
test('every page that is not the homepage has the nav and the footer', () => {
  const bare = pages.filter((rel) => rel !== 'index.html' && !(html[rel].includes('<header class="site">') && html[rel].includes('<footer class="site">')));
  assert.deepEqual(bare, []);
});

console.log('\n── the homepage is the front door ──────────────────────────');
const home = html['index.html'];
const landing = home.slice(home.indexOf('<div id="seo-landing"'), home.indexOf('<div id="root"'));
test('the landing is still in index.html, ahead of the game root', () => {
  assert.ok(landing.length > 5000, 'the #seo-landing block is missing or empty');
});
test('the landing links to every guide and article', () => {
  const missing = [...GUIDES, ...ARTICLES].map(([file]) => file).filter((file) => !landing.includes(`href="/${file}"`));
  assert.deepEqual(missing, [], 'add a card for each to the Guides section of index.html');
});
test('the landing links to every aircraft class page', () => {
  const classPages = pages.map(urlPath).filter((f) => /^aircraft-.*\.html$/.test(f));
  assert.ok(classPages.length >= 6);
  assert.deepEqual(classPages.filter((f) => !landing.includes(`href="/${f}"`)), []);
});
test(`the landing shows the ${HOME_LATEST} latest devlog entries, with dates`, () => {
  assert.equal((landing.match(/class="sl-update"/g) || []).length, HOME_LATEST, 'run: node tools/generate-devlog-pages.mjs');
  assert.equal((landing.match(/class="sl-date"/g) || []).length, HOME_LATEST);
});
test('the landing has a site nav with the guides, aircraft and devlog one click away', () => {
  const nav = (landing.match(/<nav class="sl-nav"[\s\S]*?<\/nav>/) || [''])[0];
  for (const href of ['/how-to-play.html', '#guides', '/aircraft.html', '/devlog.html', '/faq.html']) assert.ok(nav.includes(`href="${href}"`), `nav is missing ${href}`);
});
test('the pre-paint script and the Play buttons still work the landing/game switch', () => {
  assert.ok(home.includes("setAttribute('data-skip-landing', '1')"), 'pre-paint script changed');
  assert.ok((landing.match(/setAttribute\('data-skip-landing','1'\)/g) || []).length >= 3, 'expected Play controls in the nav, the hero and the how-to-play section');
});

console.log('\n── devlog ──────────────────────────────────────────────────');
const devlog = buildDevlog(ROOT);
test('devlog pages on disk match content/devlog-entries.html', () => {
  const stale = [...devlog.files].filter(([rel, content]) => !existsSync(path.join(ROOT, rel)) || read(rel) !== content).map(([rel]) => rel);
  assert.deepEqual(stale, [], 'run: node tools/generate-devlog-pages.mjs');
  assert.deepEqual(orphans(devlog.files, ROOT), [], 'a page in public/devlog/ is no longer generated: remove it');
});
test('no entry is published in full at two URLs', () => {
  for (const e of devlog.entries.filter((x) => x.isPost)) {
    const month = devlog.files.get(`public/devlog/${e.pageKey}.html`);
    const probe = mainText(`<main>${e.bodyHtml}</main>`).slice(200, 420);
    assert.ok(probe.length > 100 && !mainText(month).includes(probe), `${e.title}: full text is on its month page as well as its own page`);
  }
  assert.ok(!mainText(devlog.files.get('public/devlog.html')).includes(mainText(`<main>${devlog.entries[0].bodyHtml}</main>`).slice(250, 420)), 'the index carries an entry in full');
});
test('every entry has one home, and every slug is unique', () => {
  const slugs = devlog.entries.map((e) => e.slug);
  assert.equal(new Set(slugs).size, slugs.length);
  for (const e of devlog.entries) {
    const [file, anchor] = e.url.slice(1).split('#');
    const page = devlog.files.get(`public/${file}`);
    assert.ok(page, `${e.title}: ${file} is not generated`);
    if (anchor) assert.ok(page.includes(`id="${anchor}"`), `${e.title}: #${anchor} missing from ${file}`);
  }
});
test(`a standalone post has ${POST_MIN_WORDS}+ words, and so does every month page`, () => {
  for (const [rel, content] of devlog.files) {
    if (!rel.startsWith('public/devlog/')) continue;
    assert.ok(words(content) >= POST_MIN_WORDS, `${rel} has only ${words(content)} words: fold it into a neighbour (PAGE_OF in the generator)`);
  }
});

console.log('\n── generated pages and blocks ──────────────────────────────');
test('charts and data tables on hand-written pages match the game data', () => {
  const stale = pages.filter((rel) => rel !== 'index.html' && fillGenerated(html[rel], rel) !== html[rel]);
  assert.deepEqual(stale, [], 'run: node tools/generate-guide-charts.mjs');
});
test('aircraft pages match src/data/aircraft.js', () => {
  const r = spawnSync(process.execPath, ['tools/generate-aircraft-pages.mjs', '--check'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(r.status, 0, `run: node tools/generate-aircraft-pages.mjs\n${r.stdout}${r.stderr}`.trim());
});

console.log('\n── dates and sitemap ───────────────────────────────────────');
test('every page date, byline and the sitemap are current', () => {
  assert.deepEqual(checkDates({ root: ROOT, write: false }), [], 'run: node tools/stamp-page-dates.mjs');
});
test('the sitemap lists every page exactly once, and nothing else', () => {
  const locs = [...read('public/sitemap.xml').matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.deepEqual([...locs].sort(), pages.map((rel) => `${SITE}/${urlPath(rel)}`).sort());
});
test('pages do not all claim the same day (the site-wide date stamp is gone)', () => {
  const days = new Set(Object.values(readManifest(ROOT)).map((e) => e.updated));
  assert.ok(days.size >= 8, `only ${days.size} distinct dates across ${pages.length} pages`);
});

console.log('\n── every page stands on its own ────────────────────────────');
test('unique title, a description, and a canonical URL that is its own address', () => {
  const titles = new Map();
  for (const rel of pages) {
    const h = html[rel];
    const title = (h.match(/<title>([^<]+)<\/title>/) || [])[1];
    assert.ok(title, `${rel}: no <title>`);
    assert.ok(!titles.has(title), `${rel} and ${titles.get(title)} share the title "${title}"`);
    titles.set(title, rel);
    assert.ok(/<meta name="description" content="[^"]{50,}"/.test(h), `${rel}: missing or very short meta description`);
    const canonical = (h.match(/<link rel="canonical" href="([^"]+)"/) || [])[1];
    const want = rel === 'index.html' ? [SITE, `${SITE}/`] : [`${SITE}/${urlPath(rel)}`];
    assert.ok(want.includes(canonical), `${rel}: canonical is ${canonical}`);
    assert.ok(!/noindex/i.test(h), `${rel}: carries noindex`);
  }
});
test('guides and articles are substantial (500+ words of their own)', () => {
  for (const [file] of [...GUIDES, ...ARTICLES]) {
    const rel = `public/${file}`;
    assert.ok(html[rel], `${file} is in site-chrome.mjs but not on disk`);
    assert.ok(words(html[rel]) >= 500, `${file}: ${words(html[rel])} words`);
  }
});
test('every internal link and image points at something that exists', () => {
  const broken = [];
  for (const rel of pages) {
    for (const m of html[rel].matchAll(/(?:href|src)="(\/[^"]*)"/g)) {
      const [target, anchor] = m[1].split('#');
      const file = target.split('?')[0];
      if (file.startsWith('/src/') || file.startsWith('/assets/')) continue; // the game bundle
      const onDisk = file === '/' ? 'index.html' : `public${file}`;
      if (!existsSync(path.join(ROOT, onDisk))) broken.push(`${rel} → ${m[1]}`);
      else if (anchor && onDisk.endsWith('.html') && !read(onDisk).includes(`id="${anchor}"`)) broken.push(`${rel} → ${m[1]} (no such anchor)`);
    }
  }
  assert.deepEqual(broken, []);
});
test('articles cite outside sources', () => {
  for (const file of ['regional-jets-explained.html', 'narrow-body-vs-wide-body.html', 'a380-vs-747.html', 'hub-strategy.html', 'fuel-hedging.html', 'aircraft-flagships.html', 'aircraft-narrow-body.html', 'aircraft-freighters.html']) {
    const main = html[`public/${file}`].match(/<main[\s\S]*?<\/main>/)[0];
    const outside = [...main.matchAll(/href="(https?:\/\/[^"]+)"/g)].map((m) => m[1]).filter((u) => !u.startsWith(SITE));
    assert.ok(outside.length >= 2, `${file}: ${outside.length} outside links`);
  }
});

console.log(`\n${failed ? 'FAIL' : 'PASS'} — ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
