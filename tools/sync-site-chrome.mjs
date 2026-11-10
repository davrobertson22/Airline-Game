// sync-site-chrome.mjs
// Rewrites the header nav and footer of every hand-written page in public/ from the single
// copy in tools/site-chrome.mjs. Generated pages take theirs from the same module when they
// are generated, so run the generators too after changing the nav or footer.
//
//   node tools/sync-site-chrome.mjs          rewrite pages
//   node tools/sync-site-chrome.mjs --check  list pages that have drifted, exit 1 if any

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { applyChrome } from './site-chrome.mjs';

const PUBLIC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const check = process.argv.includes('--check');

let drifted = 0;
for (const file of readdirSync(PUBLIC).filter((f) => f.endsWith('.html')).sort()) {
  const p = path.join(PUBLIC, file);
  const before = readFileSync(p, 'utf8');
  const after = applyChrome(before);
  if (after === before) continue;
  drifted++;
  if (check) console.log(`drifted: public/${file}`);
  else {
    writeFileSync(p, after);
    console.log(`synced public/${file}`);
  }
}
if (check && drifted) process.exit(1);
if (!drifted) console.log('nav and footer already in sync on every page');
