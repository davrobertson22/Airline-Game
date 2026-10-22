// ─────────────────────────────────────────────────────────────────────────────
// RIVAL SETS — custom, shareable AI competitor fields (Tailwinds only).
//
// A rival set is a small versioned JSON document a player pastes in at setup
// (or copies out of a running game to share): each rival has a name, a home
// hub, a tier, a size and optionally a founding year, logo, style and quality.
//
//   { "tailwindsRivals": 1, "name": "…", "rivals": [
//       { "name": "Pacific Rim Airlines", "hub": "NRT", "tier": "legacy",
//         "size": "large", "founded": 1951, "logo": "jade",
//         "style": "fortress", "quality": 72,
//         "fleet": ["b747400", "b777300er"], "maker": ["Boeing", "Embraer"],
//         "ceased": 2001, "hub2": "KIX", "routes": ["NRT-LAX", "NRT-HKG"] } ] }
//
// Size, not money: small / medium / large set starting cash and network size
// from the tier, and market value comes out of play (Dave, 2026-10-17).
// Founding years matter in era games only: a rival founded after the start
// year waits as an ENTRANT and joins once the calendar reaches its year, if
// the field has room (models/competitorAI.js). Classic games have no calendar,
// so every listed rival starts on day one.
//
// Logos are the built-in presets only, so shared sets stay small and no one
// hosts anyone else's images.
//
// Also optional (2026-10-17, second package):
//   fleet / maker  the carrier only buys these types / this manufacturer when
//                  one can fly the route — otherwise whatever fits, so it
//                  never stops flying (demand.js preferredTypes). "maker"
//                  can name several (2026-10-21, Discord: VodkaOnFire): a
//                  list ["Boeing", "Embraer"] or one string split on commas
//                  ("Boeing, Embraer"); "makers" reads the same. One maker is
//                  kept as a string, several as a list (saves and copies
//                  from before keep their string).
//   ceased         era games: the airline winds down in that year
//   hub2           a second hub from day one
//   routes         its starting network ("AAA-BBB"), replacing the generated
//                  one; size still sets its cash. Pairs nothing of the era (or
//                  of its fleet preference) can fly are left out at the start.
//
// Third package (2026-10-18, Discord: VodkaOnFire):
//   logo "random"  a logo drawn when the airline is founded, from the least
//                  used in the field so a big set spreads across all of them.
//                  "randomLogos": true at the top of a set does it for every
//                  rival, whatever it lists (a set copied out of a game lists
//                  every logo).
//   chance         0–100: the percent chance the airline appears in a game at
//                  all, rolled at the start (or, for an era entrant, in its
//                  founding year). Adjusted by CROWDING: likelier where few
//                  airlines are based near its hub, less likely where many
//                  are (rivalChance). "crowding": false keeps it exact. Both
//                  can sit at the top of a set as the default for every rival.
//                  A rival with no chance, or 100, always appears.
// ─────────────────────────────────────────────────────────────────────────────

import { getAirport } from '../data/airports.js';
import { distanceKm } from '../utils/market.js';
import { AIRCRAFT_TYPES, getAircraftType } from '../data/aircraft.js';
import {
  generateStarterRoutes, listedStarterRoutes, buildCompetitorFleet, jitterCompetitor, COMPETITOR_AIRLINES,
} from './demand.js';

export const RIVAL_SET_VERSION = 1;
/** Most rivals a set may START with (entrants not counted). Probe 2026-10-16: tick
 *  time is fine past 100; the rivals map overlay and save size are the limits. */
export const RIVAL_SET_MAX_START = 60;
/** Most rivals a set may hold in all, starters plus future entrants. */
export const RIVAL_SET_MAX_TOTAL = 120;
export const RIVAL_NAME_MAX = 40;
/** Most starting routes one rival may list (CARRIER_ROUTES_MAX in competitorAI.js). */
export const RIVAL_ROUTES_MAX = 60;
/** Most aircraft types one rival may list as its fleet. */
export const RIVAL_FLEET_MAX = 12;
const MAKERS = [...new Set(AIRCRAFT_TYPES.map(t => String(t.manufacturer ?? '')).filter(Boolean))];
export const RIVAL_TIERS = ['budget', 'legacy', 'premium'];
export const RIVAL_SIZES = ['small', 'medium', 'large'];
/** Setup option: how many random rivals (the usual field is 25). */
export const RIVAL_COUNT_OPTIONS = { few: 10, many: 40 };
/** competitorAI.js ARCHETYPES keys (asserted equal in tools/rival-sets-test.mjs). */
export const RIVAL_STYLES = ['aggressive', 'expansionist', 'fortress', 'copycat', 'niche', 'balanced'];
/** components/AirlineLogo.jsx AIRLINE_LOGOS ids (asserted equal in the test). */
export const RIVAL_LOGOS = ['arctic', 'bolt', 'comet', 'compass', 'crown', 'delta', 'eagle', 'globe', 'horizon',
  'jade', 'jet', 'orbit', 'phoenix', 'prism', 'sapphire', 'star', 'summit', 'sunburst', 'wing'];

/** Starting cash by tier for a medium carrier — the middle of the built-in bank. */
const TIER_BASE_CASH = { budget: 11_000_000, legacy: 42_000_000, premium: 62_000_000 };
const TIER_BASE_ROUTES = { budget: 7, legacy: 6, premium: 5 };
const TIER_QUALITY = { budget: 38, legacy: 67, premium: 82 };
export const SIZE_CASH = { small: 0.5, medium: 1, large: 2 };
export const SIZE_ROUTES = { small: 0.6, medium: 1, large: 1.7 };
const TIER_LOGOS = { budget: ['bolt', 'prism', 'phoenix', 'jet'], legacy: ['compass', 'eagle', 'horizon', 'summit', 'globe'], premium: ['crown', 'sapphire', 'jade', 'arctic'] };

/** Crowding: airlines based within this distance of a rival's hub count against
 *  its chance of appearing, the closer the more (same airport = 1). */
export const CROWDING_RADIUS_KM = 1000;
/** Chance multiplier with nobody nearby; it falls as 1.5 / (1 + 0.5 × crowding),
 *  so one airline at the same hub leaves the chance as written, two halve the
 *  boost, and a crowded region (Europe's big four) roughly halves the chance. */
const CROWDING_EMPTY_BOOST = 1.5;

const hash = (s) => { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 24) || 'rival';

/**
 * Check a set and normalise every rival in it. Accepts the raw pasted text or
 * an already-parsed object. Never throws.
 * → { ok, set: { name, rivals: [normalised] } | null, errors: [string], warnings: [string] }
 * A set with errors is refused whole; warnings describe what was defaulted.
 */
export function parseRivalSet(input) {
  const errors = [], warnings = [];
  let doc = input;
  if (typeof input === 'string') {
    const text = input.trim();
    if (!text) return { ok: false, set: null, errors: ['The box is empty.'], warnings };
    try { doc = JSON.parse(text); }
    catch { return { ok: false, set: null, errors: ['That is not valid JSON — check for a missing comma, quote or bracket.'], warnings }; }
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    return { ok: false, set: null, errors: ['A rival set is an object with a "rivals" list.'], warnings };
  }
  if (doc.tailwindsRivals !== RIVAL_SET_VERSION) {
    errors.push(`Missing or unknown version: the set must say "tailwindsRivals": ${RIVAL_SET_VERSION}.`);
  }
  const list = Array.isArray(doc.rivals) ? doc.rivals : null;
  if (!list) errors.push('The set has no "rivals" list.');
  else if (list.length === 0) errors.push('The "rivals" list is empty.');
  else if (list.length > RIVAL_SET_MAX_TOTAL) errors.push(`A set can hold at most ${RIVAL_SET_MAX_TOTAL} rivals; this one has ${list.length}.`);

  // Set-wide defaults (third package): random logos, a chance, crowding.
  const randomLogos = doc.randomLogos === true || String(doc.logo ?? '').trim().toLowerCase() === 'random';
  let setChance = parseChance(doc.chance);
  if (Number.isNaN(setChance)) { warnings.push(`The set's chance "${doc.chance}" ignored (a percentage from 0 to 100).`); setChance = undefined; }
  const setCrowding = doc.crowding !== false;

  const rivals = [];
  const names = new Set();
  (list ?? []).slice(0, RIVAL_SET_MAX_TOTAL).forEach((raw, i) => {
    const at = `Rival ${i + 1}`;
    if (!raw || typeof raw !== 'object') { errors.push(`${at} is not an object.`); return; }
    const name = typeof raw.name === 'string' ? raw.name.trim().replace(/\s+/g, ' ') : '';
    const label = name ? `${at} (${name})` : at;
    if (!name) { errors.push(`${at} has no name.`); return; }
    if (name.length > RIVAL_NAME_MAX) { errors.push(`${label}: names are at most ${RIVAL_NAME_MAX} characters.`); return; }
    if (names.has(name.toLowerCase())) { errors.push(`${label}: two rivals share this name.`); return; }
    names.add(name.toLowerCase());
    const hub = typeof raw.hub === 'string' ? raw.hub.trim().toUpperCase() : '';
    if (!hub || !getAirport(hub)) { errors.push(`${label}: "${raw.hub ?? ''}" is not an airport code in the game.`); return; }
    const tier = String(raw.tier ?? '').toLowerCase();
    if (!RIVAL_TIERS.includes(tier)) { errors.push(`${label}: tier must be budget, legacy or premium.`); return; }
    let size = String(raw.size ?? 'medium').toLowerCase();
    if (!RIVAL_SIZES.includes(size)) { warnings.push(`${label}: unknown size "${raw.size}", using medium.`); size = 'medium'; }
    let founded = null;
    if (raw.founded != null && raw.founded !== '') {
      const y = Number(raw.founded);
      if (Number.isInteger(y) && y >= 1900 && y <= 2100) founded = y;
      else warnings.push(`${label}: founding year "${raw.founded}" ignored (a year from 1900 to 2100).`);
    }
    let logo = raw.logo == null ? null : String(raw.logo).trim().toLowerCase();
    if (randomLogos || logo === 'random') logo = 'random';
    else {
      if (logo != null && !RIVAL_LOGOS.includes(logo)) { warnings.push(`${label}: unknown logo "${raw.logo}", picking one.`); logo = null; }
      if (logo == null) { const pool = TIER_LOGOS[tier]; logo = pool[hash(name) % pool.length]; }
    }
    let style = raw.style == null ? null : String(raw.style).toLowerCase();
    if (style != null && !RIVAL_STYLES.includes(style)) { warnings.push(`${label}: unknown style "${raw.style}", the game will pick one.`); style = null; }
    let quality = null;
    if (raw.quality != null && raw.quality !== '') {
      const q = Number(raw.quality);
      if (Number.isFinite(q)) quality = Math.max(20, Math.min(95, Math.round(q)));
      else warnings.push(`${label}: quality "${raw.quality}" ignored.`);
    }
    // ── Second package: fleet, maker, ceased, hub2, routes ──────────────────
    let fleet = [];
    if (raw.fleet != null) {
      const listIn = Array.isArray(raw.fleet) ? raw.fleet : [raw.fleet];
      for (const id of listIn) {
        const t = getAircraftType(String(id).trim().toLowerCase());
        if (!t) warnings.push(`${label}: unknown aircraft type "${id}" left out of its fleet.`);
        else if (!fleet.includes(t.id)) fleet.push(t.id);
      }
      if (fleet.length > RIVAL_FLEET_MAX) { warnings.push(`${label}: only the first ${RIVAL_FLEET_MAX} fleet types are kept.`); fleet = fleet.slice(0, RIVAL_FLEET_MAX); }
    }
    // One maker or several: a list, or one string split on commas. JSON
    // keeps only the last of a repeated key, so a list is the way to name two.
    const makers = [];
    for (const v of [raw.maker, raw.makers].flatMap(x => x == null ? [] : Array.isArray(x) ? x : String(x).split(/[,;]/))) {
      const m = String(v ?? '').trim().toLowerCase();
      if (!m) continue;
      const hit = MAKERS.find(x => x.toLowerCase() === m) ?? MAKERS.find(x => x.toLowerCase().includes(m));
      if (!hit) warnings.push(`${label}: no manufacturer called "${String(v).trim()}" in the game; ignored.`);
      else if (!makers.includes(m)) makers.push(m);
    }
    const maker = makers.length > 1 ? makers : (makers[0] ?? null);
    let ceased = null;
    if (raw.ceased != null && raw.ceased !== '') {
      const y = Number(raw.ceased);
      if (!Number.isInteger(y) || y < 1900 || y > 2100) warnings.push(`${label}: closing year "${raw.ceased}" ignored (a year from 1900 to 2100).`);
      else if (founded != null && y <= founded) warnings.push(`${label}: it can't close (${y}) before it is founded (${founded}); closing year ignored.`);
      else ceased = y;
    }
    let hub2 = null;
    if (raw.hub2 != null && String(raw.hub2).trim()) {
      const h = String(raw.hub2).trim().toUpperCase();
      if (!getAirport(h)) warnings.push(`${label}: second hub "${raw.hub2}" is not an airport code in the game; ignored.`);
      else if (h === hub) warnings.push(`${label}: the second hub is the same as the home hub; ignored.`);
      else hub2 = h;
    }
    let routes = [];
    if (raw.routes != null) {
      const listIn = Array.isArray(raw.routes) ? raw.routes : [];
      if (!Array.isArray(raw.routes)) warnings.push(`${label}: "routes" should be a list like ["${hub}-JFK"]; ignored.`);
      const seen = new Set();
      for (const r of listIn) {
        const m = /^\s*([A-Za-z]{3})\s*-\s*([A-Za-z]{3})\s*$/.exec(String(r));
        const a = m?.[1].toUpperCase(), b = m?.[2].toUpperCase();
        if (!m || a === b || !getAirport(a) || !getAirport(b)) { warnings.push(`${label}: route "${r}" left out (two different airport codes, like "${hub}-JFK").`); continue; }
        const key = [a, b].sort().join('-');
        if (seen.has(key)) continue;
        seen.add(key);
        routes.push(`${a}-${b}`);
      }
      if (routes.length > RIVAL_ROUTES_MAX) { warnings.push(`${label}: only the first ${RIVAL_ROUTES_MAX} routes are kept.`); routes = routes.slice(0, RIVAL_ROUTES_MAX); }
    }
    // ── Third package: chance and crowding ─────────────────────────────────
    let chance = parseChance(raw.chance);
    if (Number.isNaN(chance)) { warnings.push(`${label}: chance "${raw.chance}" ignored (a percentage from 0 to 100).`); chance = undefined; }
    chance = chance ?? setChance ?? 100;
    const crowding = typeof raw.crowding === 'boolean' ? raw.crowding : setCrowding;
    rivals.push({
      name, hub, tier, size, founded, logo, style, quality,
      ...(chance < 100 ? { chance } : {}), ...(chance < 100 && chance > 0 && !crowding ? { crowding: false } : {}),
      ...(fleet.length ? { fleet } : {}), ...(maker ? { maker } : {}),
      ...(ceased != null ? { ceased } : {}), ...(hub2 ? { hub2 } : {}),
      ...(routes.length ? { routes } : {}),
    });
  });

  const name = typeof doc.name === 'string' ? doc.name.trim().slice(0, 60) : '';
  // The normalised set keeps its version: the setup screen hands this object
  // to START_GAME, which checks it again with this same function.
  return { ok: errors.length === 0, set: errors.length === 0 ? { tailwindsRivals: RIVAL_SET_VERSION, name, rivals } : null, errors, warnings };
}

/**
 * Split a set for a game: who starts on day one, who waits to be founded.
 * Classic (startYear null): everyone starts. Era: founded after the start
 * year → entrant, earliest first. Starters past RIVAL_SET_MAX_START are
 * dropped (reported back so the setup screen can say so).
 */
export function splitRivalSet(set, startYear, draw = null) {
  const starters = [], entrants = [];
  let closed = 0;
  for (const r of set?.rivals ?? []) {
    // Era game: an airline that has already closed by the start year never appears.
    if (startYear != null && r.ceased != null && r.ceased <= startYear) { closed++; continue; }
    if (startYear != null && r.founded != null && r.founded > startYear) entrants.push(r);
    else starters.push(r);
  }
  entrants.sort((a, b) => a.founded - b.founded || a.name.localeCompare(b.name));
  const sure = starters.filter(isSure).length;
  // Without a draw (the setup screen's preview) nothing is rolled: the counts
  // say how many are certain and how many are left to chance.
  if (!draw) {
    return {
      starters: starters.slice(0, RIVAL_SET_MAX_START),
      entrants,
      dropped: Math.max(0, sure - RIVAL_SET_MAX_START),
      closed,
      sure,
      byChance: starters.length - sure,
      missed: 0,
    };
  }
  // Starting a game: roll the chance rivals in, then cap. Certain rivals come
  // first, so the cap only ever cuts chance rivals while there are any.
  const { chosen, missed } = drawRivals(starters, draw);
  return {
    starters: chosen.slice(0, RIVAL_SET_MAX_START),
    entrants,
    dropped: Math.max(0, chosen.length - RIVAL_SET_MAX_START),
    closed,
    sure,
    byChance: starters.length - sure,
    missed: missed.length,
  };
}

/** "60", 60, "60%" → 60; absent → undefined; anything else → NaN. */
function parseChance(v) {
  if (v == null || v === '') return undefined;
  const n = Number(String(v).trim().replace(/%$/, '').trim());
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : NaN;
}

const isSure = (r) => (r.chance ?? 100) >= 100;

/** How crowded a hub is: airlines based within CROWDING_RADIUS_KM, each
 *  weighted by closeness (1 at the same airport, 0 at the edge). */
export function crowdingAt(hub, hubs = []) {
  const a = getAirport(hub);
  if (!a) return 0;
  let w = 0;
  for (const h of hubs) {
    if (h === hub) { w += 1; continue; }
    const b = getAirport(h);
    if (!b) continue;
    const d = distanceKm(a, b);
    if (d < CROWDING_RADIUS_KM) w += 1 - d / CROWDING_RADIUS_KM;
  }
  return w;
}

/**
 * The probability (0–1) a set rival appears, given the hubs already in the
 * field (the player's included). Its chance as written, scaled by crowding
 * unless the set turned that off; never above 1. 100 and 0 are absolute.
 */
export function rivalChance(spec, hubs = []) {
  const base = Math.max(0, Math.min(100, spec?.chance ?? 100)) / 100;
  if (base >= 1 || base <= 0 || spec.crowding === false) return base;
  return Math.min(1, base * CROWDING_EMPTY_BOOST / (1 + 0.5 * crowdingAt(spec.hub, hubs)));
}

/**
 * Roll a list of set rivals into a game. Certain ones always come; the rest
 * are rolled in a shuffled order, each against the field as it stands — so
 * a region that fills up early gets harder to join, and an empty one easier.
 *   hubs     hubs already in the field (the player's, a random field's)
 *   keepOne  if nothing at all came in, take the likeliest miss (a set with
 *            only chance rivals must not leave an empty sky)
 * → { chosen, missed }
 */
export function drawRivals(list, { hubs = [], keepOne = false, rng = Math.random } = {}) {
  const sure = list.filter(isSure);
  const maybe = list.filter(r => !isSure(r));
  for (let i = maybe.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [maybe[i], maybe[j]] = [maybe[j], maybe[i]];
  }
  const placed = [...hubs, ...sure.map(r => r.hub)];
  const chosen = [...sure], missed = [];
  let best = null, bestP = 0;
  for (const r of maybe) {
    const p = rivalChance(r, placed);
    if (p > 0 && rng() < p) { chosen.push(r); placed.push(r.hub); }
    else { missed.push(r); if (p > bestP) { best = r; bestP = p; } }
  }
  if (keepOne && chosen.length === 0 && best) {
    chosen.push(best);
    missed.splice(missed.indexOf(best), 1);
  }
  return { chosen, missed };
}

/** A logo for a "random" rival: one of the least used in the field, picked at random among them. */
export function pickRandomLogo(takenLogos = [], rng = Math.random) {
  const used = new Map(RIVAL_LOGOS.map(l => [l, 0]));
  for (const l of takenLogos) if (used.has(l)) used.set(l, used.get(l) + 1);
  const least = Math.min(...used.values());
  const pool = RIVAL_LOGOS.filter(l => used.get(l) === least);
  return pool[Math.floor(rng() * pool.length)];
}

/** The competitor object the game runs for one rival of a set. */
export function buildRivalFromSpec(spec, { idSeed = 0, takenLogos = [] } = {}) {
  const base = {
    id: `set_${slug(spec.name)}_${(hash(`${spec.name}|${idSeed}`) % 46656).toString(36)}`,
    name: spec.name,
    homeHub: spec.hub,
    tier: spec.tier,
    // "random": drawn now, from the logos the field uses least.
    logoId: spec.logo === 'random' || !RIVAL_LOGOS.includes(spec.logo) ? pickRandomLogo(takenLogos) : spec.logo,
    baseQualityScore: spec.quality ?? TIER_QUALITY[spec.tier],
    cash: Math.round(TIER_BASE_CASH[spec.tier] * SIZE_CASH[spec.size]),
    weeklyStats: null,
    routes: {},
    fromSet: true,
    size: spec.size,
    ...(spec.founded != null ? { founded: spec.founded } : {}),
    ...(spec.ceased != null ? { ceased: spec.ceased } : {}),
    ...(spec.style ? { _archetype: spec.style } : {}),
    ...((spec.fleet?.length || spec.maker) ? { fleetPref: { types: spec.fleet ?? [], maker: spec.maker ?? null } } : {}),
    ...(spec.hub2 ? { secondaryHub: spec.hub2 } : {}),
    // What the set said, for copying the field back out (exportRivalSet).
    setSpec: spec,
  };
  // Same personality jitter the built-in carriers get — but a quality the set
  // spells out is kept exactly.
  const c = jitterCompetitor(base);
  if (spec.quality != null) c.baseQualityScore = spec.quality;
  const n = Math.max(3, Math.round(TIER_BASE_ROUTES[spec.tier] * SIZE_ROUTES[spec.size]));
  let skipped = [];
  if (spec.routes?.length) {
    const listed = listedStarterRoutes(c, spec.routes);
    skipped = listed.skipped;
    c.routes = Object.keys(listed.routes).length ? listed.routes : generateStarterRoutes(c, n);
  } else {
    c.routes = generateStarterRoutes(c, n);
  }
  const built = buildCompetitorFleet(c);
  return skipped.length ? { ...built, _skippedRoutes: skipped } : built;
}

/** Size of a running carrier, for export: from its network against its tier. */
function sizeOf(c) {
  if (RIVAL_SIZES.includes(c.size)) return c.size;
  const routes = Object.keys(c.routes ?? {}).length;
  const base = TIER_BASE_ROUTES[c.tier] ?? 6;
  return routes <= base * 0.75 ? 'small' : routes >= base * 1.6 ? 'large' : 'medium';
}

/**
 * The set that recreates a game's field: every rival still flying, plus the
 * entrants still waiting. Pretty-printed for pasting into Discord.
 */
export function exportRivalSet({ competitors = [], entrants = [], name = '', startYear = null } = {}) {
  const rivals = [
    ...competitors.map(c => ({
      name: c.name, hub: c.homeHub, tier: c.tier, size: sizeOf(c),
      ...(startYear != null ? { founded: foundedYearOf(c, startYear) } : {}),
      ...(RIVAL_LOGOS.includes(c.logoId) ? { logo: c.logoId } : {}),
      ...(RIVAL_STYLES.includes(c._archetype) ? { style: c._archetype } : {}),
      quality: Math.round(c.baseQualityScore ?? TIER_QUALITY[c.tier] ?? 60),
      ...extrasOf(c.setSpec, c),
    })),
    ...entrants.map(r => ({
      name: r.name, hub: r.hub, tier: r.tier, size: r.size,
      ...(r.founded != null ? { founded: r.founded } : {}),
      logo: r.logo, ...(r.style ? { style: r.style } : {}), ...(r.quality != null ? { quality: r.quality } : {}),
      ...extrasOf(r, null),
    })),
  ];
  return JSON.stringify({ tailwindsRivals: RIVAL_SET_VERSION, ...(name ? { name } : {}), rivals }, null, 2);
}

/** An exported airline's founding year (era games): the year its set gave it;
 *  else, for one launched mid-game, the year it launched; else the start year
 *  (the random field, all flying on day one). Never clamped to the start year:
 *  an airline that joined in 1974 must not come back in a 1970 copy. */
function foundedYearOf(c, startYear) {
  if (c.founded != null) return c.founded;
  if (c.isStartup && Number.isFinite(c.foundedWeek)) return startYear + Math.floor((c.foundedWeek - 1) / 52);
  return startYear;
}

/** The second-package fields a set spelled out, carried into an export. */
function extrasOf(spec, carrier) {
  const out = {};
  if (spec?.fleet?.length) out.fleet = spec.fleet;
  if (spec?.maker) out.maker = spec.maker;
  if (spec?.ceased != null) out.ceased = spec.ceased;
  const hub2 = carrier ? carrier.secondaryHub : spec?.hub2;
  if (hub2) out.hub2 = hub2;
  if (spec?.routes?.length) out.routes = spec.routes;
  // A chance only travels with an airline still waiting to be founded: one
  // already flying has made it into this field.
  if (!carrier && spec?.chance != null && spec.chance < 100) {
    out.chance = spec.chance;
    if (spec.crowding === false) out.crowding = false;
  }
  return out;
}

/** A short example set from the built-in carriers, for the setup screen. */
export function exampleRivalSet(startYear = null) {
  const pick = ['globalair', 'zoomjet', 'apexair', 'pacificrim', 'nofrills'];
  const sizes = ['large', 'medium', 'large', 'medium', 'small'];
  const rivals = pick.map((id, i) => {
    const c = COMPETITOR_AIRLINES.find(x => x.id === id);
    return c && { name: c.name, hub: c.homeHub, tier: c.tier, size: sizes[i], logo: c.logoId };
  }).filter(Boolean);
  // Show the optional fields on two of them.
  if (rivals[0]) { rivals[0].maker = ['Boeing', 'Embraer']; rivals[0].routes = ['LHR-JFK', 'LHR-CDG', 'LHR-FRA', 'LHR-DXB', 'LHR-SIN']; }
  if (rivals[2]) { rivals[2].fleet = ['a380', 'b777300er']; rivals[2].hub2 = 'DOH'; }
  if (rivals[1]) rivals[1].logo = 'random';
  if (rivals[3]) rivals[3].chance = 60;
  if (startYear != null && rivals.length) {
    rivals[rivals.length - 1].founded = startYear + 5;   // shows an entrant
    rivals[rivals.length - 1].ceased = startYear + 20;   // …and a closing year
  }
  return JSON.stringify({ tailwindsRivals: RIVAL_SET_VERSION, name: 'Example set', rivals }, null, 2);
}
