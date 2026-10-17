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
//         "style": "fortress", "quality": 72 } ] }
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
// ─────────────────────────────────────────────────────────────────────────────

import { getAirport } from '../data/airports.js';
import {
  generateStarterRoutes, buildCompetitorFleet, jitterCompetitor, COMPETITOR_AIRLINES,
} from './demand.js';

export const RIVAL_SET_VERSION = 1;
/** Most rivals a set may START with (entrants not counted). Probe 2026-10-16: tick
 *  time is fine past 100; the rivals map overlay and save size are the limits. */
export const RIVAL_SET_MAX_START = 60;
/** Most rivals a set may hold in all, starters plus future entrants. */
export const RIVAL_SET_MAX_TOTAL = 120;
export const RIVAL_NAME_MAX = 40;
export const RIVAL_TIERS = ['budget', 'legacy', 'premium'];
export const RIVAL_SIZES = ['small', 'medium', 'large'];
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
    let logo = raw.logo == null ? null : String(raw.logo).toLowerCase();
    if (logo != null && !RIVAL_LOGOS.includes(logo)) { warnings.push(`${label}: unknown logo "${raw.logo}", picking one.`); logo = null; }
    if (logo == null) { const pool = TIER_LOGOS[tier]; logo = pool[hash(name) % pool.length]; }
    let style = raw.style == null ? null : String(raw.style).toLowerCase();
    if (style != null && !RIVAL_STYLES.includes(style)) { warnings.push(`${label}: unknown style "${raw.style}", the game will pick one.`); style = null; }
    let quality = null;
    if (raw.quality != null && raw.quality !== '') {
      const q = Number(raw.quality);
      if (Number.isFinite(q)) quality = Math.max(20, Math.min(95, Math.round(q)));
      else warnings.push(`${label}: quality "${raw.quality}" ignored.`);
    }
    rivals.push({ name, hub, tier, size, founded, logo, style, quality });
  });

  const name = typeof doc.name === 'string' ? doc.name.trim().slice(0, 60) : '';
  return { ok: errors.length === 0, set: errors.length === 0 ? { name, rivals } : null, errors, warnings };
}

/**
 * Split a set for a game: who starts on day one, who waits to be founded.
 * Classic (startYear null): everyone starts. Era: founded after the start
 * year → entrant, earliest first. Starters past RIVAL_SET_MAX_START are
 * dropped (reported back so the setup screen can say so).
 */
export function splitRivalSet(set, startYear) {
  const starters = [], entrants = [];
  for (const r of set?.rivals ?? []) {
    if (startYear != null && r.founded != null && r.founded > startYear) entrants.push(r);
    else starters.push(r);
  }
  entrants.sort((a, b) => a.founded - b.founded || a.name.localeCompare(b.name));
  return {
    starters: starters.slice(0, RIVAL_SET_MAX_START),
    entrants,
    dropped: Math.max(0, starters.length - RIVAL_SET_MAX_START),
  };
}

/** The competitor object the game runs for one rival of a set. */
export function buildRivalFromSpec(spec, { idSeed = 0 } = {}) {
  const base = {
    id: `set_${slug(spec.name)}_${(hash(`${spec.name}|${idSeed}`) % 46656).toString(36)}`,
    name: spec.name,
    homeHub: spec.hub,
    tier: spec.tier,
    logoId: spec.logo,
    baseQualityScore: spec.quality ?? TIER_QUALITY[spec.tier],
    cash: Math.round(TIER_BASE_CASH[spec.tier] * SIZE_CASH[spec.size]),
    weeklyStats: null,
    routes: {},
    fromSet: true,
    size: spec.size,
    ...(spec.founded != null ? { founded: spec.founded } : {}),
    ...(spec.style ? { _archetype: spec.style } : {}),
  };
  // Same personality jitter the built-in carriers get — but a quality the set
  // spells out is kept exactly.
  const c = jitterCompetitor(base);
  if (spec.quality != null) c.baseQualityScore = spec.quality;
  const n = Math.max(3, Math.round(TIER_BASE_ROUTES[spec.tier] * SIZE_ROUTES[spec.size]));
  c.routes = generateStarterRoutes(c, n);
  return buildCompetitorFleet(c);
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
      ...(startYear != null ? { founded: c.founded != null && c.founded <= startYear ? c.founded : startYear } : {}),
      ...(RIVAL_LOGOS.includes(c.logoId) ? { logo: c.logoId } : {}),
      ...(RIVAL_STYLES.includes(c._archetype) ? { style: c._archetype } : {}),
      quality: Math.round(c.baseQualityScore ?? TIER_QUALITY[c.tier] ?? 60),
    })),
    ...entrants.map(r => ({
      name: r.name, hub: r.hub, tier: r.tier, size: r.size,
      ...(r.founded != null ? { founded: r.founded } : {}),
      logo: r.logo, ...(r.style ? { style: r.style } : {}), ...(r.quality != null ? { quality: r.quality } : {}),
    })),
  ];
  return JSON.stringify({ tailwindsRivals: RIVAL_SET_VERSION, ...(name ? { name } : {}), rivals }, null, 2);
}

/** A short example set from the built-in carriers, for the setup screen. */
export function exampleRivalSet(startYear = null) {
  const pick = ['globalair', 'zoomjet', 'apexair', 'pacificrim', 'nofrills'];
  const sizes = ['large', 'medium', 'large', 'medium', 'small'];
  const rivals = pick.map((id, i) => {
    const c = COMPETITOR_AIRLINES.find(x => x.id === id);
    return c && { name: c.name, hub: c.homeHub, tier: c.tier, size: sizes[i], logo: c.logoId };
  }).filter(Boolean);
  if (startYear != null && rivals.length) {
    rivals[rivals.length - 1].founded = startYear + 5;   // shows an entrant
  }
  return JSON.stringify({ tailwindsRivals: RIVAL_SET_VERSION, name: 'Example set', rivals }, null, 2);
}
