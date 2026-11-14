// The map and route detail read who is in your alliance from live competitor
// state, not the founding memberIds list.
//
// Discord 2026-11-13: "map is broken it will not show alliance routes". A game
// samples a subset of carriers and the AI moves them between blocs, so the
// founding list often names nobody who is actually in your alliance; the map's
// Alliance layer read that list and drew nothing.
//
//   node --import ./tools/_register-loader.mjs tools/alliance-live-members-test.mjs
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { ALLIANCES, allianceMembers } from '../src/data/alliances.js';

const bloc = ALLIANCES[0];
const comps = [
  { id: 'newjoiner', allianceId: bloc.id, routes: {} },
  { id: bloc.memberIds[0], allianceId: null, routes: {} },
];
assert.deepEqual(allianceMembers(bloc.id, comps).map(c => c.id), ['newjoiner'],
  'a carrier that joined counts; a founder that left does not');

const dir = new URL('../src/components/', import.meta.url);
const offenders = readdirSync(dir).filter(f => /\.jsx?$/.test(f))
  .filter(f => /\.memberIds\b/.test(readFileSync(new URL(f, dir), 'utf8')));
assert.deepEqual(offenders, [], `components reading the founding memberIds list: ${offenders.join(', ')}`);

console.log('alliance-live-members-test: ok');
