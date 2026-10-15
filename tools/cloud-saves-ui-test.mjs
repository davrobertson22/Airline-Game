// Cloud saves, on screen: every state of the section renders, the perk's
// rules show up as what is and is not offered, and a player on a new device
// can reach it.
//
// Server-renders the REAL components through the JSX loader. CloudSavesView is
// the whole look, driven by props, so each state is rendered directly; the
// Save / Load window and the new-game screen are rendered whole to prove the
// section and its entry point are actually wired in. Also runs index.html's
// own pre-paint script, because a sign-in that returns to the landing page
// instead of the game would look like it had failed.
//
// Verified failing on HEAD (2026-10-15): HEAD's SaveLoadModal has no
// "Cloud saves" section, its SetupScreen has no "Continuing an airline?" entry,
// and its index.html leaves /?cloud=return on the landing page.
//
//   node --import ./tools/_register-loader.mjs tools/cloud-saves-ui-test.mjs

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import React from 'react';
import { renderToString } from 'react-dom/server';

const mem = new Map();
globalThis.window = globalThis.window ?? {};
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
  clear: () => mem.clear(),
};

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${(e.stack || e.message).split('\n').slice(0, 4).join('\n      ')}`); failed++; }
}
const srcOf = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const { GameProvider, gameReducer, freshState } = await import('../src/store/GameContext.jsx');
const { ConfirmProvider } = await import('../src/components/ConfirmModal.jsx');
const { CloudSavesView, describeCloudSlot, conflictQuestion } = await import('../src/components/CloudSaves.jsx');
const SaveLoadModal = (await import('../src/components/SaveLoadModal.jsx')).default;
const SetupScreen   = (await import('../src/components/SetupScreen.jsx')).default;
const { cloudSavesEnabled, CLOUD_SAVES_LIVE } = await import('../src/cloud/cloudConfig.js');

const h = React.createElement;
const noop = () => {};
const handlers = { onSignIn: noop, onEmail: noop, onSignOut: noop, onUpload: noop, onLoad: noop, onDelete: noop };
const view = (props) => renderToString(h(CloudSavesView, { mode: 'save', canUpload: true, ...handlers, ...props }));
const slot = (name, extra = {}) => ({
  slot: 0, size: 70_000, savedAt: '2026-10-14T20:00:00.000Z', uploadedAt: '2026-10-14T20:00:05.000Z',
  deviceLabel: 'Chrome on Mac',
  meta: { airlineName: name, hub: 'LGW', cash: 4_130_000, week: 12, year: 14, startYear: 1978, logoId: 'horizon', logoColor: '#f5a623' },
  ...extra,
});
const count = (html, re) => (html.match(re) ?? []).length;

console.log('\n── Signed out ───────────────────────────────────────────────');
test('sign-in offers the Headwinds logins and explains the perk', () => {
  const html = view({ status: 'signedOut' });
  assert.ok(html.includes('Cloud saves'));
  assert.ok(html.includes('Continue with Google'));
  assert.ok(html.includes('Continue with Discord'));
  assert.ok(/type="email"/.test(html), 'email-link form');
  assert.ok(html.includes('Headwinds account'));
  assert.ok(html.includes('href="/support.html"'), 'What’s this? links to the support page');
});
test('after an email link is sent, it says to open it in this browser', () => {
  const html = view({ status: 'signedOut', emailSent: true });
  assert.ok(html.includes('open it in this browser'));
  assert.ok(!/type="email"/.test(html));
});
test('while checking a stored sign-in, it says so', () => {
  assert.ok(view({ status: 'checking' }).includes('Checking your sign-in'));
});

console.log('\n── Signed in ────────────────────────────────────────────────');
test('a supporter, saving: upload into empty slots, replace a filled one', () => {
  const html = view({ status: 'signedIn', who: 'pilot@example.com', cloud: { supporter: true, slots: [slot('Atlantic Airways'), null, null] } });
  assert.ok(html.includes('pilot@example.com'));
  assert.ok(html.includes('Sign out'));
  assert.ok(html.includes('Cloud 1') && html.includes('Cloud 3'));
  assert.ok(html.includes('Atlantic Airways'));
  assert.ok(html.includes('Chrome on Mac'));
  assert.equal(count(html, />Upload here</g), 2);
  assert.equal(count(html, />Replace</g), 1);
  assert.ok(!html.includes('thank-you'));
  assert.ok(html.includes('Best effort'));
});
test('a lapsed supporter, saving: no upload offered, told why, saves still there', () => {
  const html = view({ status: 'signedIn', who: 'x', cloud: { supporter: false, slots: [slot('Kept Air'), null, null] } });
  assert.equal(count(html, />Upload here</g) + count(html, />Replace</g), 0);
  assert.ok(html.includes('thank-you'));
  assert.ok(html.includes('stay yours to load'));
  assert.ok(html.includes('Kept Air'));
  assert.ok(html.includes('title="Delete cloud save"'), 'can still delete');
});
test('loading: every filled slot can be loaded, by supporters and lapsed alike', () => {
  for (const supporter of [true, false]) {
    const html = view({ mode: 'load', status: 'signedIn', who: 'x', cloud: { supporter, slots: [slot('A'), null, slot('C', { slot: 2 })] } });
    assert.equal(count(html, />Load</g), 2, `supporter=${supporter}`);
    assert.equal(count(html, />No save</g), 1);
    assert.equal(count(html, />Upload here</g), 0);
  }
});
test('with no game running there is nothing to upload, and it says so', () => {
  const html = view({ status: 'signedIn', who: 'x', canUpload: false, cloud: { supporter: true, slots: [null, null, null] } });
  assert.equal(count(html, />Upload here</g), 0);
  assert.ok(html.includes('Start or load a game'));
});
test('while the list loads, it says so; a busy slot says what it is doing', () => {
  assert.ok(view({ status: 'signedIn', who: 'x', cloud: null }).includes('Reading your cloud saves'));
  const busy = view({ status: 'signedIn', who: 'x', busySlot: 0, cloud: { supporter: true, slots: [null, null, null] } });
  assert.ok(busy.includes('Uploading…'));
});
test('errors are announced', () => {
  const html = view({ status: 'signedOut', note: { kind: 'error', text: 'Could not reach cloud saves.' } });
  assert.ok(/role="alert"/.test(html) && html.includes('Could not reach cloud saves.'));
});

console.log('\n── The questions it asks ────────────────────────────────────');
test('a conflict names what is there now, where from, and offers to replace it', () => {
  const q = conflictQuestion(1, slot('Theirs'), 'Mine');
  assert.match(q.title, /Cloud 2 changed on another device/);
  assert.match(q.body, /Theirs/);
  assert.match(q.body, /Chrome on Mac/);
  assert.match(q.body, /Replace it with Mine/);
  assert.equal(q.danger, true);
  assert.match(conflictQuestion(0, null, 'Mine').title, /emptied on another device/);
  assert.match(describeCloudSlot(slot('Theirs')), /^Theirs \(1991 wk 12\), uploaded /);
});

console.log('\n── Wired in ─────────────────────────────────────────────────');
const playing = gameReducer(freshState(), { type: 'START_GAME', airlineName: 'Probe Air', hub: 'LGW' });
const render = (el, seed, { preview = true } = {}) => {
  mem.clear();
  if (seed) mem.set('bbae_save_v2', JSON.stringify(seed));
  if (preview) mem.set('tw.cloud.preview', '1');
  return renderToString(h(GameProvider, null, h(ConfirmProvider, null, el)));
};
test('the Save / Load window carries the cloud section, in both modes', () => {
  for (const mode of ['save', 'load']) {
    const html = render(h(SaveLoadModal, { mode, onClose: noop }), playing);
    assert.ok(html.includes('aria-label="Cloud saves"'), mode);
    assert.ok(html.includes('Continue with Google'), `${mode}: signed out by default`);
  }
});
test('a sign-in error carried back from the provider shows in the window', () => {
  const html = render(h(SaveLoadModal, { mode: 'load', onClose: noop, cloudNotice: 'Signing in did not finish: User cancelled' }), playing);
  assert.ok(html.includes('User cancelled'));
});
test('the new-game screen offers to continue an airline (a new device lands here)', () => {
  const html = render(h(SetupScreen), null);
  assert.ok(html.includes('Continuing an airline?'));
  assert.ok(html.includes('Load from a save slot or the cloud'));
});
test('the app finishes a sign-in return before any early return (hooks rule)', () => {
  const app = srcOf('src/App.jsx');
  const hook = app.indexOf('useCloudSignInReturn(hydrated');
  const early = app.indexOf('if (!hydrated) return null;');
  assert.ok(hook > 0 && early > 0 && hook < early);
  assert.match(srcOf('src/components/SetupScreen.jsx'), /useCloudSignInReturn\(true,/);
});
test('Supabase is only ever loaded on demand, never in the main bundle', () => {
  for (const f of ['src/App.jsx', 'src/main.jsx', 'src/components/CloudSaves.jsx', 'src/components/SaveLoadModal.jsx', 'src/components/SetupScreen.jsx']) {
    assert.ok(!/from ['"]@supabase\/supabase-js['"]/.test(srcOf(f)), `${f} must not import Supabase statically`);
  }
  assert.match(srcOf('src/cloud/cloudAuth.js'), /import\('@supabase\/supabase-js'\)/);
});

console.log('\n── Launch switch ─────────────────────────────────────────────');
test('until launch, players see no cloud section and no cloud wording', () => {
  if (CLOUD_SAVES_LIVE) return;   // launched: nothing hidden any more
  const modal = render(h(SaveLoadModal, { mode: 'save', onClose: noop }), playing, { preview: false });
  assert.ok(!modal.includes('Cloud saves'));
  const setup = render(h(SetupScreen), null, { preview: false });
  assert.ok(setup.includes('Load from a save slot'));
  assert.ok(!setup.includes('or the cloud'));
});
test('?cloudpreview=1 turns it on in that browser and sticks; =0 turns it off', () => {
  const store = new Map();
  const ls = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
  const win = (search) => ({ location: { search }, localStorage: ls });
  assert.equal(cloudSavesEnabled(win(''), false), false);
  assert.equal(cloudSavesEnabled(win('?cloudpreview=1'), false), true);
  assert.equal(cloudSavesEnabled(win(''), false), true, 'sticks');
  assert.equal(cloudSavesEnabled(win('?cloudpreview=0'), false), false);
  assert.equal(cloudSavesEnabled(win(''), false), false);
  assert.equal(cloudSavesEnabled(win(''), true), true, 'launched: on for everyone');
});

console.log('\n── index.html: back from sign-in, straight into the game ────');
const script = srcOf('index.html').match(/<script>\s*\(function \(\) \{[\s\S]*?data-skip-landing[\s\S]*?<\/script>/)[0]
  .replace(/^<script>/, '').replace(/<\/script>$/, '');
function landing(search, { hasSave = false, hash = '' } = {}) {
  const attrs = {};
  const store = new Map(hasSave ? [['bbae_has_save', '1']] : []);
  vm.runInNewContext(script, {
    location: { search, hash },
    localStorage: { getItem: (k) => store.get(k) ?? null },
    document: { documentElement: { setAttribute: (k, v) => { attrs[k] = v; } } },
  });
  return attrs['data-skip-landing'] === '1' ? 'game' : 'landing';
}
test('/?cloud=return skips the landing page, save or no save', () => {
  assert.equal(landing('?cloud=return&code=abc'), 'game');
  assert.equal(landing('?cloud=return&code=abc', { hasSave: true }), 'game');
  assert.equal(landing('?cloud=return&error=access_denied'), 'game', 'an error is shown in the game, not lost on the front page');
});
test('everything else behaves exactly as before', () => {
  assert.equal(landing(''), 'landing');
  assert.equal(landing('', { hasSave: true }), 'landing');
  assert.equal(landing('?play', { hasSave: true }), 'game');
  assert.equal(landing('?play'), 'landing');
  assert.equal(landing('?cloud=returned'), 'landing');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
