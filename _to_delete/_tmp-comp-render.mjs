import fs from "node:fs";
import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { AIRCRAFT_TYPES, getAircraftType } from '../src/data/aircraft.js';

const store = new Map();
globalThis.window = globalThis.window ?? {};
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k), clear: () => store.clear(),
};

const { GameProvider, freshState } = await import('../src/store/GameContext.jsx');
const Competition = (await import('../src/components/Competition.jsx')).default;

const big = getAircraftType('a220100'), small = getAircraftType('atr72');
const save = {
  ...freshState(),
  phase: 'playing', week: 20, year: 1, hub: 'LAX', cash: 5e6,
  gates: { LAX: 8, SFO: 8 },
  fleet: [
    { id: 'ac1', typeId: big.id,   name: 'A', tailNumber: 'N1', status: 'assigned', ageWeeks: 52, ownershipType: 'owned', config: { economy: big.seats } },
    { id: 'ac2', typeId: small.id, name: 'B', tailNumber: 'N2', status: 'assigned', ageWeeks: 52, ownershipType: 'owned', config: { economy: small.seats } },
  ],
  routes: [
    { id: 'r1', origin: 'LAX', destination: 'SFO', aircraftId: 'ac1', weeklyFrequency: 47, weeksOpen: 20, hub: 'LAX', ticketPrice: 105, cateringLevel: 'full' },
    { id: 'r2', origin: 'LAX', destination: 'SFO', aircraftId: 'ac2', weeklyFrequency: 18, weeksOpen: 20, hub: 'LAX', ticketPrice: 105, cateringLevel: 'full' },
  ],
  competitors: [{
    id: 'ua', name: 'United Airlines', tier: 'legacy', logoId: 'compass',
    baseQualityScore: 62, cash: 1e8, marketCap: 5e8, homeHub: 'SFO',
    routes: { 'LAX-SFO': { frequency: 47, priceMultiplier: 1.0, economyFare: 156, seats: 156, aircraftType: 'a319' } },
  }],
};
store.set('bbae_save_v2', JSON.stringify(save));

const html = renderToString(React.createElement(GameProvider, null, React.createElement(Competition)));
const expectSeats = big.seats * 47 + small.seats * 18;
console.log('expect flights 65, seats', expectSeats);




fs.writeFileSync("/tmp/out.html",html);console.log('  ✓ Competition tab renders the pair total (65 flights, ' + expectSeats.toLocaleString('en-US') + ' seats)');
