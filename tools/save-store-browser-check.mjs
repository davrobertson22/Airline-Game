// save-store-browser-check.mjs — @not-a-test: needs a real browser, so
// tools/run-tests.mjs skips it and it is run by hand.
//
//   npm i --no-save playwright && npx playwright install chromium
//   node tools/save-store-browser-check.mjs
//
// tools/save-store-test.mjs covers the store's logic against injected backends.
// It cannot cover the one thing this whole change rests on: the real IndexedDB
// adapter, in a real browser, against a real localStorage quota. This does — it
// is the manual pass docs/save-storage-indexeddb-plan.md §11 asks for, written
// down so it can be repeated instead of remembered.
//
// src/store/saveStore.js has no imports, so this needs no build step: the file
// is served to headless Chromium as-is.
//
// What it established when it was written (2026-09-08):
//
//   * localStorage in Chromium gives out at ~5.18M CHARACTERS — roughly double
//     the plan's "5 MiB counted in UTF-16" assumption. A real 13-year,
//     279-route save measures 835K chars, so four copies of THAT do fit. The
//     ceiling is real but further out than the plan claimed, which is worth
//     knowing before quoting the old arithmetic at anyone.
//   * At a larger airline, localStorage takes the autosave and one slot and
//     then refuses the next — the exact shape of the player report this work
//     came from — while IndexedDB takes all four without complaint.
//   * Migration off a genuine legacy localStorage save works, frees the
//     originals, survives a reload, and is idempotent.
//
// It also found the blocked-open hazard now handled in openDatabase(): a
// pending deleteDatabase against a still-open connection made the next open
// time out and silently demote itself to localStorage — where its writes would
// then be shadowed by the older IndexedDB save the reader prefers.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let chromium;
try { ({ chromium } = await import('playwright')); }
catch {
  console.error('This check needs playwright:\n  npm i --no-save playwright && npx playwright install chromium');
  process.exit(2);
}

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PAGE = `<!doctype html><meta charset="utf-8"><title>saveStore browser check</title><body>ready</body>
<script type="module">
  import * as S from './saveStore.js';
  window.S = S; window.ready = true;
</script>`;

const server = http.createServer((req, res) => {
  const url = (req.url ?? '/').split('?')[0];
  if (url === '/saveStore.js') {
    let body;
    try { body = fs.readFileSync(path.join(REPO, 'src', 'store', 'saveStore.js')); }
    catch { res.writeHead(404); res.end('saveStore.js not found'); return; }
    res.writeHead(200, { 'content-type': 'text/javascript' });
    res.end(body);
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(PAGE);
});
const PORT = 8731;
await new Promise(r => server.listen(PORT, r));

// PLAYWRIGHT_CHROMIUM_PATH lets this run against a Chromium that is already on
// the machine, instead of the exact build the installed playwright expects.
const browser = await chromium.launch(
  process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {},
);
const page = await browser.newPage();
page.on('pageerror', e => console.log('  !! page error:', e.message));

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { console.log(`  ✓ ${name}`); pass++; }
  else { console.log(`  ✗ ${name}${detail ? '\n      ' + detail : ''}`); fail++; }
};
const goto = async () => {
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForFunction('window.ready === true');
};
await goto();

// An airline shaped like the 2026-09-08 report: 279 routes, 160 aircraft, 13
// years of history. Sized against tools/_probe-real-save-size.mjs, which builds
// the same thing through the real reducer and measures 815 KB.
const seedBig = `(() => {
  const big = { airlineName: 'Atlantic Airways', logoId: 'horizon', logoColor: '#f5a623',
                customLogo: null, hub: 'LGW', cash: 4130000, week: 5, year: 14, startYear: 1978,
                routes: [], fleet: [], statsHistory: [], newsLog: [], competitors: [], financialHistory: [] };
  for (let i = 0; i < 279; i++) big.routes.push({ id: 'rt-' + i + '-abcde', origin: 'LGW', destination: 'AP' + i, stops: ['LGW','AP'+i], aircraftId: 'ac-' + i, weeklyFrequency: 7, hub: 'LGW', season: null, weeksOpen: 100 });
  for (let i = 0; i < 160; i++) big.fleet.push({ id: 'ac-' + i, typeId: 'b737-800', name: 'Boeing 737-800 #' + i, tailNumber: 'G-AB' + i, status: 'assigned', ageWeeks: 200 + i, ownershipType: 'owned', config: { firstClass: 0, businessClass: 16, premiumEconomy: 0, economy: 150, seatQuality: 2, serviceQuality: 2 }, fuelMod: 1, rangeMod: 1, maintMod: 1, engineId: 'cfm56-7b', engineLabel: 'CFM56-7B', hasWingtips: true });
  for (let i = 0; i < 676; i++) big.statsHistory.push({ absWeek: i, pax: 12345 + i, ask: 9876543 + i, rpk: 8765432 + i, revenue: 1234567 + i, cost: 1134567 + i, profit: 100000, lf: 0.812, destinations: 140, flights: 1953, fleet: 160 });
  for (let i = 0; i < 27; i++) {
    const c = { id: 'c' + i, name: 'Competitor Airways ' + i, code: 'C' + i, hub: 'AP' + i, tier: 2,
                cash: 500000000, fleet: [], routes: [], profitHistory: [1,2,3,4,5,6,7,8,9,10,11,12] };
    for (let j = 0; j < 40; j++) c.fleet.push({ id: 'cf' + i + '-' + j, typeId: 'a320ceo', seats: 180, ageWeeks: 300 });
    for (let j = 0; j < 60; j++) c.routes.push({ id: 'cr' + i + '-' + j, origin: 'AP' + i, destination: 'AP' + j, weeklyFrequency: 7, price: 210, aircraftId: 'cf' + i + '-' + (j % 40) });
    big.competitors.push(c);
  }
  for (let i = 0; i < 52; i++) {
    const h = { week: i, revenue: 1234567, totalCost: 1134567, profit: 100000, fuel: 200000, labor: 300000,
                landingFees: 50000, catering: 20000, gates: 40000, insurance: 9000, marketing: 30000,
                depreciation: 80000, corporateTax: 21000, fuelIndex: 1.02, events: [], routeRevenues: {} };
    for (let j = 0; j < 279; j++) h.routeRevenues['rt-' + j + '-abcde'] = 40000 + j;
    big.financialHistory.push(h);
  }
  for (let i = 0; i < 250; i++) big.newsLog.push({ id: 'n' + i, absWeek: i, year: 14, week: 5, category: 'ops', kind: 'delay', subject: 'A route somewhere in the network', icon: 'x', tier: 2, data: { a: 1, b: 'some reasonably wordy news body text to make this realistic' } });
  return big;
})()`;

console.log('\n── where localStorage actually gives out ─────────────────');
let ceiling = 0;
{
  ceiling = await page.evaluate(`(() => {
    localStorage.clear();
    const chunk = 'x'.repeat(64 * 1024);
    let n = 0;
    try { for (; n < 400; n++) localStorage.setItem('k' + n, chunk); } catch (e) { /* full */ }
    const chars = n * 64 * 1024;
    localStorage.clear();
    return chars;
  })()`);
  check('localStorage has a hard ceiling, and it is in the megabytes', ceiling > 1e6 && ceiling < 2e7, `${(ceiling/1e6).toFixed(2)}M characters`);
  console.log(`      measured ceiling: ${(ceiling/1e6).toFixed(2)}M characters`);
}

console.log('\n── a save too big for localStorage ─────────────────────');
{
  const r = await page.evaluate(`(async (ceiling) => {
    localStorage.clear();
    const big = ${seedBig};
    // Grow the airline until ONE save is a third of the ceiling, so four copies
    // clearly clear it. This is simply a bigger airline than the one reported.
    const need = (ceiling * 1.3) / 4;
    big.padding = [];
    const unit = JSON.parse(JSON.stringify({ c: big.competitors, s: big.statsHistory }));
    let bytes = JSON.stringify(big).length;
    while (bytes < need && big.padding.length < 60) {
      big.padding.push(JSON.parse(JSON.stringify(unit)));
      bytes = JSON.stringify(big).length;
    }

    const ls = await S.openSaveStore({ indexedDB: null, migrate: false });
    const lsOut = [];
    for (const k of S.ALL_KEYS) lsOut.push([k, await ls.write(k, S.makeRecord(k, big))]);

    localStorage.clear();
    await new Promise(res => { const d = indexedDB.deleteDatabase('tailwinds-saves'); d.onsuccess = d.onerror = d.onblocked = res; });
    const idb = await S.openSaveStore();
    const idbOut = [];
    for (const k of S.ALL_KEYS) idbOut.push([k, await idb.write(k, S.makeRecord(k, big))]);
    const back = await idb.read('slot_2');
    return { bytes, lsOut, idbOut, routes: back?.state?.routes?.length };
  })(${ceiling})`);

  console.log(`      one save: ${(r.bytes/1e6).toFixed(2)}M characters; four copies: ${(r.bytes*4/1e6).toFixed(2)}M`);
  const lsFailed = r.lsOut.filter(([, x]) => !x.ok);
  check('localStorage refuses to hold all four copies', lsFailed.length > 0, 'all four fit — the fixture is not above the ceiling');
  check('and says so as a quota failure with a message', lsFailed.every(([, x]) => x.reason === 'quota' && x.message), JSON.stringify(lsFailed[0]?.[1]));
  console.log(`      localStorage: ${r.lsOut.length - lsFailed.length}/4 written, refused ${lsFailed.map(([k]) => k).join(', ') || '(none)'}`);
  check('IndexedDB takes all four of the same saves', r.idbOut.every(([, x]) => x.ok), JSON.stringify(r.idbOut.filter(([, x]) => !x.ok)));
  check('and reads one back intact', r.routes === 279, `routes=${r.routes}`);
}

console.log('\n── the reported airline, in real IndexedDB ──────────────');
{
  const r = await page.evaluate(`(async () => {
    localStorage.clear();
    await new Promise(res => { const d = indexedDB.deleteDatabase('tailwinds-saves'); d.onsuccess = d.onerror = d.onblocked = res; });
    const big = ${seedBig};
    const store = await S.openSaveStore();
    const out = [];
    for (const k of S.ALL_KEYS) out.push([k, await store.write(k, S.makeRecord(k, big))]);
    const back = await store.read('slot_2');
    return { backend: store.backendName, out, bytes: JSON.stringify(big).length,
             routes: back?.state?.routes?.length, fleet: back?.state?.fleet?.length,
             stats: back?.state?.statsHistory?.length, name: back?.meta?.airlineName,
             breadcrumb: localStorage.getItem(S.BREADCRUMB_KEY) };
  })()`);
  check('the fixture is the size the real save measures (~0.8M chars)', r.bytes > 700_000 && r.bytes < 1_100_000, `${(r.bytes/1e6).toFixed(2)}M characters`);
  check('IndexedDB is the backend in a normal browser', r.backend === 'indexedDB');
  check('all four saves are written', r.out.every(([, x]) => x.ok), JSON.stringify(r.out.filter(([, x]) => !x.ok)));
  check('a slot reads back with its full network intact', r.routes === 279 && r.fleet === 160 && r.stats === 676, `routes=${r.routes} fleet=${r.fleet} stats=${r.stats}`);
  check('the meta survives the round trip', r.name === 'Atlantic Airways');
  check('the breadcrumb is in localStorage for the ?play deep link', r.breadcrumb === '1');
}

console.log('\n── migration off a real legacy localStorage save ─────────');
// A fresh page first: the previous block's IndexedDB connection dies with its
// JS context, so the deleteDatabase below is not blocked by it.
await goto();
{
  const r = await page.evaluate(`(async () => {
    await new Promise(res => { const d = indexedDB.deleteDatabase('tailwinds-saves'); d.onsuccess = d.onerror = d.onblocked = res; });
    localStorage.clear();
    const st = { airlineName: 'Legacy Air', logoId: 'horizon', logoColor: '#abc', customLogo: null,
                 hub: 'JFK', cash: 777, week: 9, year: 3, startYear: 1978,
                 routes: [{ id: 'r1' }, { id: 'r2' }], fleet: [{ id: 'f1' }] };
    localStorage.setItem('bbae_save_v2', JSON.stringify(st));
    localStorage.setItem('bbae_slot_1', JSON.stringify({ airlineName: 'Legacy Air', hub: 'JFK', cash: 777, week: 9, year: 3, savedAt: 1756330000000, gameState: st }));
    const store = await S.openSaveStore();
    const auto = await store.read('autosave');
    const slot = await store.read('slot_1');
    return { migrated: store.migrated,
             ls_auto: localStorage.getItem('bbae_save_v2'), ls_slot: localStorage.getItem('bbae_slot_1'),
             autoName: auto?.state?.airlineName, slotName: slot?.meta?.airlineName,
             slotStartYear: slot?.meta?.startYear, breadcrumb: localStorage.getItem(S.BREADCRUMB_KEY) };
  })()`);
  check('both legacy saves migrated', r.migrated.slice().sort().join() === 'autosave,slot_1', JSON.stringify(r.migrated));
  check('the localStorage originals are freed — the quota is actually recovered', r.ls_auto === null && r.ls_slot === null);
  check('the migrated autosave reads back', r.autoName === 'Legacy Air');
  check('the migrated slot keeps its era startYear in meta', r.slotName === 'Legacy Air' && r.slotStartYear === 1978, `startYear=${r.slotStartYear}`);
  check('the breadcrumb is set after migration', r.breadcrumb === '1');
}

console.log('\n── a reload finds it; migration is idempotent ───────────');
await goto();
{
  const r = await page.evaluate(`(async () => {
    const store = await S.openSaveStore();
    const auto = await store.read('autosave');
    const metas = await store.listMeta();
    return { migrated: store.migrated, name: auto?.state?.airlineName,
             keys: Object.keys(metas).sort(), leaked: 'state' in (metas.slot_1 ?? {}) };
  })()`);
  check('a second open has nothing left to migrate', r.migrated.length === 0, JSON.stringify(r.migrated));
  check('the airline is still there after a page reload', r.name === 'Legacy Air');
  check('listMeta sees both saves', r.keys.join() === 'autosave,slot_1', r.keys.join());
  check('listMeta does not carry game state into the slot list', r.leaked === false);
}

console.log('\n── deleting a slot ──────────────────────────────');
{
  const r = await page.evaluate(`(async () => {
    const store = await S.openSaveStore();
    await store.delete('slot_1');
    const after = await store.read('slot_1');
    return { after, keys: Object.keys(await store.listMeta()) };
  })()`);
  check('a deleted slot is gone and stays gone', r.after === null && !r.keys.includes('slot_1'));
}

console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
server.close();
process.exit(fail ? 1 : 0);
