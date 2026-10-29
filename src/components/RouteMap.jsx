import { useEffect, useRef, useMemo, useState, useCallback } from 'react';
import { useGame } from '../store/GameContext.jsx';
import { AIRPORTS, getAirport } from '../data/airports.js';
import { getAircraftType } from '../data/aircraft.js';
import {
  simulateRoute, simulateCargoRoute, cargoLaneAllocations, formatMoney, currentGameDate,
  fleetAvgUtilization, buildEventDemandModel, rivalSpecsFor,
  stateLoungeFields, stateGroundHandlingFields, stateCateringFields, routeStops, isMultiStop,
} from '../utils/simulation.js';
import { projectWeek } from '../utils/financeProjection.js';
import { getAlliance } from '../data/alliances.js';
import { HUB_TIERS } from '../models/demand.js';
import { Glyph } from './Icons.jsx';
import useIsMobile from '../hooks/useIsMobile.js';
import { setMapBasemap } from './basemap.js';
import useBasemap from '../hooks/useBasemap.js';
import { rivalIndexFor } from '../models/network.js';
import { AirportDetailModal } from './AirportLink.jsx';

// ── Polar softening ──────────────────────────────────────────────────────────
// Reported on Discord 2026-10-02 (Headwinds, Gulf hub, 500+ routes): the true
// great circle from the Gulf to the US West Coast tops out at 85–89°N. Web
// Mercator stretches that band without limit and Leaflet clamps it at 85.05°,
// so every such route shot off the top of the map, ran along the edge and came
// back down.
//
// Interior points above POLAR_SOFT_LAT are squashed toward it. The path keeps
// its shape and its endpoints (the threshold never sits below either airport,
// so Svalbard or Utqiaġvik still meet their markers). Ported from Headwinds'
// mapCore.js — keep the two in step.
export const POLAR_SOFT_LAT = 70;
const POLAR_SQUASH = 0.35;

export function softenPolar(path, lat1, lat2) {
  const north = Math.max(POLAR_SOFT_LAT, lat1, lat2);
  const south = Math.min(-POLAR_SOFT_LAT, lat1, lat2);
  return path.map(([lat, lon]) => [
    lat > north ? north + (lat - north) * POLAR_SQUASH
      : lat < south ? south + (lat - south) * POLAR_SQUASH
      : lat,
    lon,
  ]);
}

// ── World copies ─────────────────────────────────────────────────────────────
// An unwrapped path that crosses the antimeridian ends in the NEXT world copy:
// DXB→HNL ends at 202°E, HNL→DXB at −305°. Airport markers are drawn once, in
// [−180, 180], so at the world view the line left its origin and stopped in
// empty space off the edge, and the far airport had no line at all. A shifted
// second copy puts a line on both markers; each copy is still one smooth arc.
export function withWorldCopy(path) {
  if (path.length < 2) return [path];
  let min = Infinity, max = -Infinity;
  for (const [, lon] of path) { if (lon < min) min = lon; if (lon > max) max = lon; }
  if (max > 180)  return [path, path.map(([lat, lon]) => [lat, lon - 360])];
  if (min < -180) return [path, path.map(([lat, lon]) => [lat, lon + 360])];
  return [path];
}

// ── Great-circle path as a single continuous segment ─────────────────────────
// Keeps longitudes unwrapped (may exceed ±180) so Leaflet draws one smooth arc
// across world copies instead of splitting at the antimeridian edge. The FIRST
// segment is always the canonical path from the origin; a shifted copy follows
// only when the path crosses the antimeridian (see withWorldCopy).
export function segmentsForRoute(lat1, lon1, lat2, lon2, n = 80) {
  const raw = greatCirclePoints(lat1, lon1, lat2, lon2, n);
  if (raw.length === 0) return [raw];

  // Unwrap longitudes so the path is continuous (Leaflet handles >±180 fine)
  const norm = [[...raw[0]]];
  for (let i = 1; i < raw.length; i++) {
    let lon = raw[i][1];
    const prev = norm[i - 1][1];
    while (lon - prev >  180) lon -= 360;
    while (prev - lon >  180) lon += 360;
    norm.push([raw[i][0], lon]);
  }

  return withWorldCopy(softenPolar(norm, lat1, lat2));
}

// ── Great-circle path through a CHAIN of airports ────────────────────────────
// A multi-stop rotation is not one arc — MCI–JFK–ORY bends at JFK, and drawing
// MCI→ORY instead puts the line hundreds of km from the airport the aeroplane
// actually lands at. Legs are concatenated into ONE polyline, with longitudes
// unwrapped ACROSS the joins as well as within each leg, so a chain that crosses
// the antimeridian stays a single continuous line instead of snapping back
// across the whole world at a stop.
//
// `points` is [[lat, lon], ...] in visiting order (2 or more).
export function segmentsForChain(points, n = 80) {
  const pts = (points ?? []).filter(p => Array.isArray(p) && p.length >= 2);
  if (pts.length < 2) return [pts];

  const chain = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [lat1, lon1] = pts[i];
    const [lat2, lon2] = pts[i + 1];
    let startLon = lon1;
    if (chain.length) {
      const prev = chain[chain.length - 1][1];
      while (startLon - prev >  180) startLon -= 360;
      while (prev - startLon >  180) startLon += 360;
    }
    const shift = startLon - lon1;
    const [leg] = segmentsForRoute(lat1, lon1, lat2, lon2, n);
    for (let j = chain.length ? 1 : 0; j < leg.length; j++) {
      chain.push([leg[j][0], leg[j][1] + shift]);
    }
  }
  return withWorldCopy(chain);
}

// ── Framing the network ──────────────────────────────────────────────────────
// Reported on Discord 2026-10-02 (Headwinds, Gulf hub): the map opened on a
// frame fitted to the AIRPORTS, but a long-haul arc bulges well past its two
// ends — a Gulf hub's West Coast lines peak near 77°N even after polar
// softening, far above the northernmost airport — so the opening view clipped
// them at the top edge until the player zoomed out by hand.
//
// The frame is the airports PLUS the drawn lines. Pass each route's canonical
// path (segments[0] — the origin-anchored copy); the shifted world copy would
// widen the frame by a whole world for nothing. Latitudes are clamped to the
// Web Mercator limit. Ported from Headwinds' mapCore.js — keep the two in step.
export const MERCATOR_MAX_LAT = 85;

export function frameLatLngs(airports = [], paths = []) {
  const clamp = (lat) => Math.max(-MERCATOR_MAX_LAT, Math.min(MERCATOR_MAX_LAT, lat));
  const out = [];
  for (const a of airports) if (a) out.push([clamp(a.lat), a.lon]);
  for (const path of paths) for (const pt of path ?? []) out.push([clamp(pt[0]), pt[1]]);
  return out;
}

/** A rotation's identity: its stop chain, direction-normalised so A→B→C and the
 *  same rotation entered as C→B→A are one line on the map rather than two
 *  overlapping ones. Exported for the map's tests. */
export function chainKey(chain = []) {
  const codes = chain.map(a => (typeof a === 'string' ? a : a?.code)).filter(Boolean);
  const fwd = codes.join('>');
  const rev = [...codes].reverse().join('>');
  return fwd <= rev ? fwd : rev;
}

// ── Great-circle interpolation ────────────────────────────────────────────────
function greatCirclePoints(lat1, lon1, lat2, lon2, n = 80) {
  const D2R = Math.PI / 180;
  const R2D = 180 / Math.PI;
  const φ1 = lat1 * D2R, λ1 = lon1 * D2R;
  const φ2 = lat2 * D2R, λ2 = lon2 * D2R;
  const d = 2 * Math.asin(Math.sqrt(
    Math.sin((φ2 - φ1) / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin((λ2 - λ1) / 2) ** 2,
  ));
  if (d < 0.001) return [[lat1, lon1], [lat2, lon2]];
  return Array.from({ length: n + 1 }, (_, i) => {
    const f = i / n;
    const A = Math.sin((1 - f) * d) / Math.sin(d);
    const B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(φ1) * Math.cos(λ1) + B * Math.cos(φ2) * Math.cos(λ2);
    const y = A * Math.cos(φ1) * Math.sin(λ1) + B * Math.cos(φ2) * Math.sin(λ2);
    const z = A * Math.sin(φ1) + B * Math.sin(φ2);
    return [
      Math.atan2(z, Math.sqrt(x ** 2 + y ** 2)) * R2D,
      Math.atan2(y, x) * R2D,
    ];
  });
}

// ── Leaflet CDN loader ────────────────────────────────────────────────────────
const LEAFLET_CSS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
const LEAFLET_JS  = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';

// One in-flight load shared by every caller (ported from Headwinds mapCore.js).
// Two callers racing — React's development double-mount, or the map-first
// layout mounting the map at startup — each appended a <script>, and the second
// copy replaced window.L under a map built by the first. The next redraw then
// mixed two Leaflets' Bounds classes and threw "reading 'x'" in _clipPoints.
let leafletPromise = null;

export function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (leafletPromise) return leafletPromise;
  leafletPromise = new Promise((resolve, reject) => {

    // CSS
    if (!document.querySelector(`link[href="${LEAFLET_CSS}"]`)) {
      const link = document.createElement('link');
      link.rel = 'stylesheet'; link.href = LEAFLET_CSS;
      document.head.appendChild(link);
    }

    // JS
    const script = document.createElement('script');
    script.src = LEAFLET_JS;
    script.onload  = () => resolve(window.L);
    script.onerror = () => {
      // A failed load must not poison every later attempt.
      leafletPromise = null;
      reject(new Error('Failed to load Leaflet'));
    };
    document.head.appendChild(script);
  });
  return leafletPromise;
}

// ── Palette ────────────────────────────────────────────────────────────────────
const PROFIT_COLOR    = '#2ee6a0';  // bright teal-green
// Multi-stop rotations. Purple is already how the Routes page marks them (the
// tag card's left border, the THROUGH fare chips), so the map borrows it rather
// than inventing a third convention: profit still reads from the tooltip, but
// "this line bends" has to be visible at a glance.
export const TAG_COLOR = '#a371f7';  // purple for multi-stop (tag) routes
const LOSS_COLOR      = '#ff5d6c';  // bright coral-red
const HUB_COLOR       = '#ffcf4d';  // gold
const SPOKE_COLOR     = '#4da6ff';  // sky blue
const ALLIANCE_COLOR  = '#b794ff';  // purple for alliance members
const CODESHARE_COLOR = '#38e1ff';  // cyan for codeshare partners

// Rivals, by what kind of airline they are. Deliberately cooler and duller than
// the partner colours: a partner's network is an asset of yours and should read
// as one, while a rival's is information.
const RIVAL_COLORS = {
  budget:  '#e0803c',
  legacy:  '#7f95b3',
  premium: '#c58fd8',
};
const RIVAL_DEFAULT_COLOR = '#7f95b3';
const CARGO_COLOR     = '#e8833a';  // amber for cargo / freight routes

// Charter contracts.
//
//   TheCookiesGuy  "Would be cool if charter contracts showed up on the map as a
//                   different color (yellow maybe?)"   (Discord, 13 Sep 2026)
//
// Yellow, as asked, and a shade clear of the two things already near it: cargo's
// amber is warmer and orange, and the gold hub pins are dots rather than lines.
// The contract lines are dashed on top of that, because a charter is not a route
// — it is a commitment with an end date, and it should not read as though you
// have opened a service you will still be flying next quarter.
export const CHARTER_COLOR = '#ffe14d';

// ── Component ─────────────────────────────────────────────────────────────────
// ── Viewport ownership ────────────────────────────────────────────────────────
// The map moves the camera for exactly two reasons: the network it is drawing
// changed extent, or the player focused a different route. Everything else —
// hovering a line, a weekly tick re-costing every route, a parent re-render —
// redraws layers and leaves the zoom exactly where the player put it.
//
// Reported by players (Discord, Aug 2026): "when you zoom in and pass your mouse
// over a route, it resets your zoom". Hovering sets state, which re-rendered the
// component; the derived route data was rebuilt from scratch every render (see
// `gd` below), so the layer effect re-ran and called fitBounds again.
//
// Both helpers take the ref they guard and are exported so a test can drive the
// SAME decision the map makes, with no DOM and no Leaflet.

/** The airport set the viewport is framed on, as a stable string. Sorted, so the
 *  same set re-derived in a different order reads as unchanged. */
export function viewportExtent(airports = []) {
  return airports.map(a => a.code).sort().join(',');
}

/** True when the viewport should be re-framed on `airports` — i.e. the extent
 *  genuinely changed since the last fit. Records the new extent when it does. */
export function claimViewportFit(ref, airports = []) {
  if (!airports.length) return false;
  const extent = viewportExtent(airports);
  if (ref.current === extent) return false;
  ref.current = extent;
  return true;
}

/** True when the map should fly to `selectedId` — i.e. the focus changed. A
 *  redraw of an already-focused route is not a reason to move.
 *
 *  `visible` is false while the map has no size (Tailwinds has no globe, but
 *  the guard is shared with Headwinds, where the flat map hides under one).
 *  A hidden map does not fly AND does not claim the focus, so it flies once it
 *  is shown. In Headwinds, flying it anyway was Barca's "when I click a route sometimes my screen goes
 *  dark" (Discord, 2026-10-29): a Leaflet map that has never been on screen has
 *  no size, flyToBounds computes a NaN centre and throws "Invalid LatLng object:
 *  (NaN, NaN)" from inside a React effect, and the whole game unmounts to a black
 *  page. It needed the globe to be the first view since the page loaded — the
 *  map view opens on whichever the player used last, so "sometimes". */
export function claimRouteFly(ref, selectedId, visible = true) {
  if (selectedId == null) { ref.current = null; return false; }
  if (!visible) return false;
  if (ref.current === selectedId) return false;
  ref.current = selectedId;
  return true;
}

/** The route keys an airport focus lights up: every drawn group with the
 *  airport anywhere on it (an endpoint or a stop of a rotation). */
export function routeKeysAtAirport(groups = [], code) {
  if (!code) return [];
  return groups
    .filter(g => (g.chain?.length >= 2 ? g.chain : [g.origin, g.dest]).some(a => a?.code === code))
    .map(g => g.key);
}

// ── Designated stations ───────────────────────────────────────────────────────
// `state.hub` is the airline's FOUNDING hub and nothing more — it is stamped on
// every route at creation and never changes. The stations the player actually
// runs live in `state.hubs` ({ code: { tier, tierSince } }, tier 0 = focus city).
// The map pinned the founding hub alone, so a carrier hubbing at MCI, SLC, HNL
// and SJU saw four plain blue spokes and one gold pin (Discord, Knightmare,
// 27 Aug 2026). Same fallback HubManagement uses: an ABSENT hubs map is a legacy
// save and means "the founding hub, tier 1"; an EMPTY one means the player has
// abandoned every designation, and nothing should pin.

/** Every station the player has designated, as { [code]: { tier, name } }. */
export function mapHubs(state = {}) {
  const raw = state.hubs ?? (state.hub ? { [state.hub]: { tier: 1 } } : {});
  const out = {};
  for (const [code, h] of Object.entries(raw)) {
    const tier = h?.tier ?? 1;
    if (!HUB_TIERS[tier]) continue;   // hubConstruction entries aren't live yet
    out[code] = { tier, name: HUB_TIERS[tier].name };
  }
  return out;
}

/** Marker geometry for a hub tier — bigger pin the higher the tier. */
export function hubMarkerSize(tier) {
  const core = 9 + 2 * Math.max(0, Math.min(3, tier ?? 1));
  return { core, ring: core + 3 };
}

/**
 * The contracts the map draws, with their airports resolved.
 *
 * A charter is NOT a route record, deliberately: charterOpRecord() feeds block
 * hours and slot counts, but a contract never enters state.routes or
 * state.cargoRoutes, because everything in those arrays is treated as a market
 * participant by demand pooling, pair-share and encroachment. The same decision
 * that keeps charters out of the market keeps them off the map unless they are
 * drawn from state.charters directly — which is what this is for.
 *
 * Only contracts being flown THIS week qualify. A completed one is history and a
 * breached one is not being flown; neither is a line on a map of what you are
 * operating. A contract still ferrying out to its pickup does qualify, and
 * carries the station it is coming from: that empty leg is what the tail is
 * actually doing this week, and it is the cost the board's fee was quoted
 * against.
 *
 * Exported so the layer effect and its tests share one derivation — renderToString
 * runs no effects, so a Leaflet polyline can never be asserted directly.
 */
export function charterMapEntries(charters = []) {
  const out = [];
  for (const c of charters ?? []) {
    if (!c || (c.status !== 'active' && c.status !== 'positioning')) continue;
    const origin = getAirport(c.origin);
    const dest   = getAirport(c.destination);
    if (!origin || !dest) continue;
    const ferry = (c.status === 'positioning' && c.positionFrom)
      ? (getAirport(c.positionFrom) ?? null) : null;
    out.push({
      c,
      // The map's filters read `r.aircraftId` and `chain`, and the contract is
      // the operating record here — so it answers to both under its own name.
      r: c,
      origin, dest, ferry,
      // The ferry origin belongs in the chain: it is where the line starts, and
      // an endpoint with no marker and no place in the viewport is a line
      // running off the edge of the map to nowhere.
      chain: ferry ? [ferry, origin, dest] : [origin, dest],
      multi: false,
    });
  }
  return out;
}

/** Airports the map pins: every station you've designated (even one you have no
 *  routes at yet) plus both ends of every route drawn. */
export function mapAirportCodes(hubCodes = [], ...routeDataSets) {
  const codes = new Set(hubCodes.filter(Boolean));
  for (const set of routeDataSets) {
    for (const d of set ?? []) {
      // Every stop, not just the endpoints — a rotation's intermediate airports
      // need their marker (and their place in the viewport) too.
      for (const a of (d.chain?.length >= 2 ? d.chain : [d.origin, d.dest])) codes.add(a.code);
    }
  }
  return [...codes];
}


// ── Every airport, as a way to find your way around ─────────────────────────
// Asked for on Discord (Oct 2026): the map drew only the airports you already
// fly to, so a player looking to start somewhere unfamiliar had no idea where
// anything was. Every airport in the game now sits under the network as a dim
// dot. The big ones show at every zoom; the 2,000-odd regional fields fill in
// as you zoom toward them, and codes appear once there is room to read them.
// Only what is on screen is drawn, and labels are capped, so the map stays
// readable and cheap at any zoom.

/** Zoom at which each class of airport gets a dot, and a code label. */
export const WORLD_DOT_ZOOM   = { major: 0, regional: 4 };
export const WORLD_LABEL_ZOOM = { major: 4, regional: 6 };
/** Most code labels drawn at once — past this the map is a wall of text. */
export const WORLD_LABEL_CAP  = 250;

const worldClass = (a) => (a.tier === 'regional' ? 'regional' : 'major');

/**
 * The background airports to draw for a view.
 *
 * `view` is { south, north, west, east } in degrees; west/east may run past
 * ±180 when the player has panned into a neighbouring world copy, and each
 * returned dot carries the longitude of the copy that is on screen. Omit it to
 * get every airport the zoom allows. `skip` holds the codes the network already
 * pins, which keep their own markers.
 *
 * Labels go to the biggest airports first, so when the cap bites it drops the
 * smallest fields rather than an arbitrary corner of the screen.
 */
export function worldAirportsInView(airports = AIRPORTS, zoom = 2, view = null, skip = new Set()) {
  const dots = [];
  for (const a of airports) {
    if (!a || skip.has(a.code)) continue;
    const cls = worldClass(a);
    if (zoom < WORLD_DOT_ZOOM[cls]) continue;
    let lon = a.lon;
    if (view) {
      if (a.lat < view.south || a.lat > view.north) continue;
      lon = null;
      for (const k of [0, 360, -360, 720, -720]) {
        const l = a.lon + k;
        if (l >= view.west && l <= view.east) { lon = l; break; }
      }
      if (lon == null) continue;
    }
    dots.push({ a, lat: a.lat, lon, major: cls === 'major' });
  }
  const labels = dots
    .filter(d => zoom >= WORLD_LABEL_ZOOM[d.major ? 'major' : 'regional'])
    .sort((x, y) => (y.major - x.major) || ((y.a.population ?? 0) - (x.a.population ?? 0)))
    .slice(0, WORLD_LABEL_CAP);
  return { dots, labels };
}

const TIER_WORD = { mega: 'Major hub', major: 'Major airport', regional: 'Regional airport' };

// Clicking ANY airport on the map — a background dot or one of your own —
// opens its detail page, which is where you lease a gate there (Discord, Oct
// 2026: "Could you add an option to open gates when tapping on a city?").
const AIRPORT_CLICK_HINT = "Click to lease a gate or see the airport's details";

/** Hover card for a background airport. */
export function worldAirportTip(a) {
  return `<div class="map-tip"><div class="map-tip-title">${a.code} · ${a.name}</div>`
    + `<div class="map-tip-sub">${a.city}, ${a.country} · ${TIER_WORD[a.tier] ?? 'Airport'}</div>`
    + `<div class="map-tip-hint">${AIRPORT_CLICK_HINT}</div></div>`;
}

/** Hover card for one of your own airports (a hub when `hubInfo` is set). */
/** Line colour for a route group: purple rotation, else green / red by profit. */
export function routeGroupColor(g) {
  return g.multi ? TAG_COLOR : ((g.hasResult ? g.profit : 0) >= 0 ? PROFIT_COLOR : LOSS_COLOR);
}

/** Tooltip for one of your passenger lines (one city pair or rotation). */
export function routeTipHtml(g) {
  const { origin, dest } = g;
  const chain = g.chain?.length >= 2 ? g.chain : [origin, dest];
  const profit = g.hasResult ? g.profit : 0;
  const profitColor = profit >= 0 ? PROFIT_COLOR : LOSS_COLOR;
  const lf      = g.hasResult ? `${(g.loadFactor * 100).toFixed(0)}%` : '—';
  const pax     = g.hasResult ? Math.round(g.passengers).toLocaleString() : '—';
  const profStr = g.hasResult ? `<span style="color:${profitColor}">${profit >= 0 ? '+' : ''}${formatMoney(profit)}/wk</span>` : '—';
  const rev     = g.hasResult ? `+${formatMoney(g.revenue)}` : '—';
  const acText  = `${g.aircraftCount} aircraft`;
  const titleHtml = chain.map(a => a.code).join(' <span class="map-tip-arrow">→</span> ');
  const subHtml = g.multi
    ? `${chain.length - 1} legs · ${origin.city} → ${dest.city} · ${acText}`
    : `${origin.city} → ${dest.city} · ${acText}`;
  return `
        <div class="map-tip">
          <div class="map-tip-title">${titleHtml}</div>
          <div class="map-tip-sub">${subHtml}</div>
          <div class="map-tip-stats">
            <div><span class="map-tip-lbl">Load</span><span class="map-tip-val">${lf}</span></div>
            <div><span class="map-tip-lbl">Pax/wk</span><span class="map-tip-val">${pax}</span></div>
            <div><span class="map-tip-lbl">Revenue</span><span class="map-tip-val" style="color:${PROFIT_COLOR}">${rev}</span></div>
            <div><span class="map-tip-lbl">Profit</span><span class="map-tip-val">${profStr}</span></div>
          </div>
          <div class="map-tip-hint">Click to focus this route</div>
        </div>
      `;
}

/** Tooltip for one of your freighter lines. */
export function cargoTipHtml(g) {
  const { origin, dest } = g;
  const lf      = g.hasResult ? `${(g.loadFactor * 100).toFixed(0)}%` : '—';
  const tonnes  = g.hasResult ? `${Math.round(g.tonnes).toLocaleString()} t` : '—';
  const profit  = g.hasResult ? g.profit : 0;
  const profStr = g.hasResult ? `${profit >= 0 ? '+' : ''}${formatMoney(profit)}/wk` : '—';
  const rev     = g.hasResult ? `+${formatMoney(g.revenue)}` : '—';
  return `
        <div class="map-tip">
          <div class="map-tip-title" style="color:${CARGO_COLOR}">${origin.code} <span class="map-tip-arrow">→</span> ${dest.code}</div>
          <div class="map-tip-sub">${origin.city} → ${dest.city} · ${g.aircraftCount} freighter${g.aircraftCount !== 1 ? 's' : ''}</div>
          <div class="map-tip-stats">
            <div><span class="map-tip-lbl">Tonnes/wk</span><span class="map-tip-val" style="color:${CARGO_COLOR}">${tonnes}</span></div>
            <div><span class="map-tip-lbl">Load</span><span class="map-tip-val">${lf}</span></div>
            <div><span class="map-tip-lbl">Revenue</span><span class="map-tip-val" style="color:${PROFIT_COLOR}">${rev}</span></div>
            <div><span class="map-tip-lbl">Profit</span><span class="map-tip-val">${profStr}</span></div>
          </div>
        </div>
      `;
}

/**
 * The shape of what the route layer draws, as one string: every line (its group
 * key fixes the geometry) and every pin with its hub badge. A weekly tick
 * usually leaves all of that alone and moves only the numbers in the tooltips,
 * and now and then flips a break-even route between green and red. So when
 * this is unchanged the layer effect recolours and re-labels the lines in place
 * instead of tearing down and re-adding every polyline and marker. Sorted: the
 * engine may hand routes back in a different order after a tick.
 * (Port from Headwinds, where map view keeps the map on screen all the time.)
 */
export function networkDrawKey(routeGroups, airportSet, hubs) {
  const lines = routeGroups.map(g => g.key).sort().join('|');
  const pins = airportSet.map((a) => {
    const h = hubs[a.code];
    return h ? `${a.code}*${h.tier ?? ''}*${h.name ?? ''}` : a.code;
  }).sort().join(',');
  return `${lines}#${pins}`;
}

export function networkAirportTip(airport, hubInfo = null) {
  const badge = hubInfo
    ? ` <span style="color:${HUB_COLOR}">● ${String(hubInfo.name ?? 'Hub').toUpperCase()}</span>`
    : '';
  return `<div class="map-tip"><div class="map-tip-title">${airport.code}</div>`
    + `<div class="map-tip-sub">${airport.city}, ${airport.country}${badge}</div>`
    + `<div class="map-tip-hint">${AIRPORT_CLICK_HINT}</div></div>`;
}

const WORLD_AIRPORTS_KEY = 'tw_map_world_airports';

export default function RouteMap({ fullBleed = false, paused = false } = {}) {
  // Map view keeps this map mounted under every page. While a page covers it
  // (`paused`) it holds the state it last drew, so a weekly tick or any click
  // inside the page doesn't re-project the week and rebuild every Leaflet layer
  // behind the panel. It catches up once, when the panel closes.
  const live = useGame();
  const heldRef = useRef(live);
  if (!paused) heldRef.current = live;
  const { state } = heldRef.current;
  // Satellite (Blue Marble) or Dark (CARTO) — see basemap.js.
  const [basemap, setBasemap] = useBasemap();
  const { fleet, routes, cargoRoutes = [], charters = [], hub, hubs: hubsState,
          competitors = [], allianceMembership, codeshareAgreements = [] } = state;

  // Every designated station, gold-pinned — not just the founding hub.
  const hubs = useMemo(() => mapHubs({ hub, hubs: hubsState }), [hub, hubsState]);
  const hubCodes = useMemo(() => Object.keys(hubs), [hubs]);

  // The map has a fixed inline height that a CSS media query can't reach, so we
  // size it here. Shorter on phones so the route list below is reachable without
  // a long scroll; unchanged (520) on desktop.
  //
  // Full-bleed (the map-first layout's background) fills its parent instead, so
  // the height is measured — Leaflet's size wants a number, not '100%'.
  const isMobile = useIsMobile();
  const bleedRef = useRef(null);
  const [bleedHeight, setBleedHeight] = useState(() =>
    (typeof window !== 'undefined' ? window.innerHeight : 800));
  useEffect(() => {
    if (!fullBleed || !bleedRef.current || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => {
      const h = Math.round(e.contentRect.height);
      if (h > 0) setBleedHeight(h);
    });
    ro.observe(bleedRef.current);
    return () => ro.disconnect();
  }, [fullBleed]);
  const mapHeight = fullBleed ? bleedHeight : (isMobile ? 380 : 520);

  const mapElRef      = useRef(null);   // DOM node
  const mapRef        = useRef(null);   // Leaflet map instance
  const layersRef     = useRef([]);     // Active Leaflet layers (routes + markers)
  const lineGroupsRef = useRef(new Map()); // routeId -> { halo:[], main:[], color }
  const partnerLayersRef = useRef([]);  // Partner overlay layers (separate so we can toggle)
  const [ready, setReady]       = useState(!!window.L);
  const [mapReady, setMapReady] = useState(false);   // true once L.map() is done
  const [error, setError]       = useState(null);
  const [hoveredId, setHoveredId] = useState(null);
  const [selectedId, setSelectedIdRaw] = useState(null);
  // Airport focus (Barca, Discord 2026-10-29: "highlight all routes from a
  // particular airport — maybe by clicking its label"). One focus at a time:
  // picking a route drops the airport focus and the other way round.
  const [focusAirport, setFocusAirportRaw] = useState(null);
  const setSelectedId = useCallback((v) => {
    setFocusAirportRaw(null);
    setSelectedIdRaw(v);
  }, []);
  const toggleAirportFocus = useCallback((code) => {
    setSelectedIdRaw(null);
    setFocusAirportRaw(prev => (prev === code ? null : code));
  }, []);
  const clearFocus = useCallback(() => { setSelectedIdRaw(null); setFocusAirportRaw(null); }, []);
  const [showAlliance,  setShowAlliance]  = useState(true);
  const [showCodeshare, setShowCodeshare] = useState(true);
  // Off by default. Twenty-five carriers put roughly 165 more lines on the map,
  // and a map you cannot read is not more information than one you can.
  const [showRivals,    setShowRivals]    = useState(false);
  const [showCargo,     setShowCargo]     = useState(true);
  const [showCharters,  setShowCharters]  = useState(true);
  const [acTypeFilter,  setAcTypeFilter]  = useState('all');  // 'all' | aircraft typeId
  const [airportFilter, setAirportFilter] = useState('all');  // 'all' | IATA code
  // Every airport under the network — on unless the player has switched it off.
  const [showAirports, setShowAirports] = useState(() => {
    try { return localStorage.getItem(WORLD_AIRPORTS_KEY) !== '0'; } catch { return true; }
  });
  const toggleAirports = () => setShowAirports(v => {
    try { localStorage.setItem(WORLD_AIRPORTS_KEY, v ? '0' : '1'); } catch { /* per-browser nicety only */ }
    return !v;
  });
  const [detailCode, setDetailCode] = useState(null);   // airport detail opened from a dot
  const worldRendererRef = useRef(null);
  const cargoLayersRef = useRef([]);   // amber cargo route overlay layers
  const charterLayersRef = useRef([]); // yellow charter contract overlay layers
  // Signatures of what each layer effect last drew (see networkDrawKey), so a
  // tick that changes no line can skip the rebuild.
  const drawnRef = useRef({ routes: null, cargo: null, partners: null });

  // Keep refs of current interaction state so the (rarely-rebuilt) layer effect
  // can apply correct styling without being a dependency.
  const selectedIdRef = useRef(null);
  const hoveredIdRef  = useRef(null);
  const focusKeysRef  = useRef(new Set());   // route keys lit by an airport focus
  const airportClickRef = useRef(null);      // latest toggleAirportFocus, for Leaflet handlers
  airportClickRef.current = toggleAirportFocus;

  // Viewport bookkeeping — see claimViewportFit / claimRouteFly above.
  const fittedExtentRef = useRef(null);   // airport set the viewport was fitted to
  const flownToRef      = useRef(null);   // route key we last flew to

  // 1. Load Leaflet from CDN
  useEffect(() => {
    if (window.L) { setReady(true); return; }
    loadLeaflet()
      .then(() => setReady(true))
      .catch(e => setError(e.message));
  }, []);

  // 2. Init map once Leaflet + DOM element are ready
  useEffect(() => {
    if (!ready || !mapElRef.current || mapRef.current) return;
    const L = window.L;

    const map = L.map(mapElRef.current, {
      center: [20, 10],
      zoom: 2,
      minZoom: 1,
      maxZoom: 10,
      zoomControl: false,
      attributionControl: true,
      worldCopyJump: true,
      // Fractional fits. With whole-number zoom, a network a few pixels too
      // tall for zoom 2 drops to zoom 1 and shows three and a half copies of
      // the world; quarter steps let fitBounds land on the frame that fits.
      // The +/− buttons still step a whole level.
      zoomSnap: 0.25,
      zoomDelta: 1,
    });

    // Full-bleed: wheel / pinch zoom only — the corner belongs to the HUD.
    if (!fullBleed) L.control.zoom({ position: 'bottomright' }).addTo(map);

    // Satellite (NASA Blue Marble) or CARTO Dark Matter — basemap.js owns both
    // URLs, and swaps the layer in place when the player changes it.
    setMapBasemap(map, basemap);

    // Click empty map → deselect (a route or an airport)
    map.on('click', () => clearFocus());

    mapRef.current = map;
    setMapReady(true);   // ← signals the layers effect to run

    // Cleanup on unmount
    return () => {
      map.remove();
      mapRef.current = null;
      // A fresh map instance starts with no viewport of its own, so the next
      // draw must frame the network even if nothing about it changed.
      fittedExtentRef.current = null;
      flownToRef.current = null;
      worldRendererRef.current = null;   // its canvas belonged to the old map
      drawnRef.current = { routes: null, cargo: null, partners: null };
      setMapReady(false);
    };
  }, [ready]);

  // Leaflet caches the container size, so when the height changes (e.g. crossing
  // the mobile breakpoint or rotating the device) we must tell it to remeasure,
  // otherwise tiles render into the old dimensions.
  useEffect(() => {
    if (mapRef.current) mapRef.current.invalidateSize();
  }, [mapHeight]);

  // Satellite / Dark switched (here or from the map-first settings menu).
  useEffect(() => {
    if (mapReady) setMapBasemap(mapRef.current, basemap);
  }, [mapReady, basemap]);

  // 3. Derive route data
  //
  // ── Single source of truth ────────────────────────────────────────────────
  // Every number on this screen (map tooltips + the route table below) comes
  // from the SAME canonical engine projection the Dashboard, Routes and Finance
  // screens use. This map used to call a BARE simulateRoute(r, aircraft, gd),
  // which skipped labor, the fuel-price multiplier, competitor encroachment,
  // fleet utilisation, satisfaction, live events and — on the cargo side — the
  // shared-lane demand pool. Unopposed demand meant busy routes pinned at a
  // 100% load factor with an inflated profit, so the map disagreed with every
  // other screen (Finance said 87%, the map said 100%). Prefer the engine's
  // routeResult; fall back to a standalone sim ONLY for routes the engine skips
  // (grounded / dormant-seasonal), run with the same inputs the engine used.
  // Memoised on the game week, NOT derived inline: currentGameDate() returns a
  // fresh object every call and this value is a dependency of routeData below.
  // Recomputed each render, it made routeData → routeGroups → airportSet all new
  // identities on EVERY render, so the layer effect tore down and rebuilt every
  // Leaflet layer — and re-framed the viewport — each time hover state changed.
  const gd = useMemo(() => currentGameDate(state), [state.week]);
  const proj = useMemo(() => projectWeek(state), [state]);
  const rrById = useMemo(() => {
    const m = {};
    for (const rr of proj.report?.routeResults ?? []) m[rr.routeId] = rr;
    return m;
  }, [proj]);
  const cargoRrById = useMemo(() => {
    const m = {};
    for (const rr of proj.report?.cargoRouteResults ?? []) m[rr.routeId] = rr;
    return m;
  }, [proj]);
  // This week's charter results, straight off the same canonical projection the
  // rest of this screen reads. A contract's week is arithmetic the engine has
  // already done; the map has no business re-deriving it.
  const charterRrById = useMemo(() => {
    const m = {};
    for (const cr of proj.report?.charterResults ?? []) m[cr.charterId] = cr;
    return m;
  }, [proj]);

  const routeData = useMemo(() => {
    const avgUtil  = fleetAvgUtilization(fleet, [...routes, ...cargoRoutes]);
    const evDemand = buildEventDemandModel(state.activeEvents);
    return routes.map(r => {
      const origin   = getAirport(r.origin);
      const dest     = getAirport(r.destination);
      if (!origin || !dest) return null;
      const aircraft = fleet.find(a => a.id === r.aircraftId);
      const result = !aircraft ? null
        : (rrById[r.id] ?? simulateRoute(
            { ...r, ...stateLoungeFields(state, r.origin, r.destination), ...stateGroundHandlingFields(state, r.origin, r.destination), ...stateCateringFields(state, r) },
            aircraft, gd, state.labor ?? null, proj.fuelMultiplier,
            null, rivalSpecsFor(state, r.origin, r.destination), avgUtil, state.satisfaction ?? null,
            evDemand.multFor(r.origin, r.destination), state.ancillaries ?? null, state.competitors ?? [], rivalIndexFor(state)));
      // The airports this route actually touches, in visiting order. For a
      // single-leg route that is [origin, dest]; for a rotation it is every
      // stop, which is what the line has to bend through and what the airport
      // filter has to match on.
      const chain = routeStops(r).map(getAirport).filter(Boolean);
      return { r, origin, dest, result, chain, multi: isMultiStop(r) && chain.length > 2 };
    }).filter(Boolean);
  }, [routes, cargoRoutes, fleet, rrById, proj, gd, state.labor, state.satisfaction, state.activeEvents]);

  // Cargo route data (mirrors routeData but for freighters / cargo routes).
  // The fallback runs the same shared-lane allocation the engine does, so a
  // freighter sharing a pair never sees the full-market pool to itself.
  const cargoRouteData = useMemo(() => {
    const needsFallback = cargoRoutes.some(r => !cargoRrById[r.id]);
    const alloc = needsFallback
      ? cargoLaneAllocations(cargoRoutes, fleet, 1.0, { gameDate: gd, competitors }) : null;
    return cargoRoutes.map(r => {
      const origin   = getAirport(r.origin);
      const dest     = getAirport(r.destination);
      if (!origin || !dest) return null;
      const aircraft = fleet.find(a => a.id === r.aircraftId);
      const result = !aircraft ? null
        : (cargoRrById[r.id] ?? simulateCargoRoute(r, aircraft, gd, state.labor ?? null,
            proj.fuelMultiplier, 1.0, alloc?.get(r.id) ?? null));
      return { r, origin, dest, result, chain: [origin, dest], multi: false };
    }).filter(Boolean);
  }, [cargoRoutes, fleet, cargoRrById, proj, gd, state.labor]);

  // Contracts being flown this week, in the same shape the filters and the
  // airport set already understand.
  const charterData = useMemo(() => charterMapEntries(charters), [charters]);

  // ── Map filters: by aircraft type and by airport ─────────────────────────
  // Options come from the UNfiltered data so the dropdowns always list
  // everything; the map + table below render only what passes the filters.
  const typesInUse = useMemo(() => {
    const ids = new Set();
    for (const r of [...routes, ...cargoRoutes, ...charterData.map(d => d.c)]) {
      const a = fleet.find(x => x.id === r.aircraftId);
      if (a) ids.add(a.typeId);
    }
    return [...ids].map(getAircraftType).filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [routes, cargoRoutes, charterData, fleet]);

  const airportOptions = useMemo(() => {
    const codes = new Set([
      ...routeData.flatMap(d => d.chain.map(a => a.code)),
      ...cargoRouteData.flatMap(d => [d.origin.code, d.dest.code]),
      ...charterData.flatMap(d => d.chain.map(a => a.code)),
    ]);
    return [...codes].map(getAirport).filter(Boolean)
      .sort((a, b) => a.code.localeCompare(b.code));
  }, [routeData, cargoRouteData, charterData]);

  const matchesFilters = useCallback((d) => {
    if (acTypeFilter !== 'all') {
      const a = fleet.find(x => x.id === d.r.aircraftId);
      if (!a || a.typeId !== acTypeFilter) return false;
    }
    // A rotation touching the filtered airport in the MIDDLE is still touching
    // it — filtering on the endpoints alone hid MCI–JFK–ORY from "Airport: JFK".
    if (airportFilter !== 'all' && !(d.chain ?? [d.origin, d.dest]).some(a => a.code === airportFilter)) return false;
    return true;
  }, [acTypeFilter, airportFilter, fleet]);

  const filteredRouteData      = useMemo(() => routeData.filter(matchesFilters), [routeData, matchesFilters]);
  const filteredCargoRouteData = useMemo(() => cargoRouteData.filter(matchesFilters), [cargoRouteData, matchesFilters]);
  const filteredCharterData    = useMemo(() => charterData.filter(matchesFilters), [charterData, matchesFilters]);
  const filtersActive = acTypeFilter !== 'all' || airportFilter !== 'all';

  const airportSet = useMemo(() => (
    mapAirportCodes(hubCodes, filteredRouteData, filteredCargoRouteData, filteredCharterData)
      .map(getAirport).filter(Boolean)
  ), [filteredRouteData, filteredCargoRouteData, filteredCharterData, hubCodes]);

  // Group route entries by city pair (direction-agnostic) so multiple aircraft
  // on the same JFK↔ORD pair show as ONE line + ONE row with aggregated stats.
  const routeGroups = useMemo(() => {
    const map = new Map();
    for (const d of filteredRouteData) {
      // A rotation is keyed on its whole chain, not its endpoints. Sharing the
      // pair key with a plain MCI–ORY service merged two different products
      // into one line and one row — and drew the rotation as a direct flight it
      // does not operate.
      const key = d.multi ? `tag:${chainKey(d.chain)}` : [d.origin.code, d.dest.code].sort().join('~');
      let g = map.get(key);
      if (!g) {
        g = {
          key, origin: d.origin, dest: d.dest, members: [],
          chain: d.chain, multi: d.multi,
          profit: 0, revenue: 0, passengers: 0, seats: 0, distance: 0,
        };
        map.set(key, g);
      }
      g.members.push(d);
      if (d.result) {
        g.profit     += d.result.profit;
        g.revenue    += d.result.revenue;
        g.passengers += d.result.passengers;
        g.seats      += d.result.loadFactor > 0 ? d.result.passengers / d.result.loadFactor : 0;
        g.distance    = d.result.distance;
      }
    }
    const arr = [...map.values()];
    for (const g of arr) {
      g.loadFactor   = g.seats > 0 ? g.passengers / g.seats : 0;
      g.aircraftCount = g.members.length;
      g.hasResult    = g.members.some(m => m.result);
    }
    return arr;
  }, [filteredRouteData]);

  // Group cargo route entries by city pair (aggregate tonnes / profit / capacity).
  const cargoGroups = useMemo(() => {
    const map = new Map();
    for (const d of filteredCargoRouteData) {
      const key = [d.origin.code, d.dest.code].sort().join('~');
      let g = map.get(key);
      if (!g) {
        g = { key, origin: d.origin, dest: d.dest, members: [], profit: 0, revenue: 0, tonnes: 0, capacity: 0, distance: 0 };
        map.set(key, g);
      }
      g.members.push(d);
      if (d.result) {
        g.profit   += d.result.profit;
        g.revenue  += d.result.revenue;
        g.tonnes   += d.result.tonnes;
        g.capacity += d.result.capacityTonnes;
        g.distance  = d.result.distance;
      }
    }
    const arr = [...map.values()];
    for (const g of arr) {
      g.loadFactor    = g.capacity > 0 ? g.tonnes / g.capacity : 0;
      g.aircraftCount = g.members.length;
      g.hasResult     = g.members.some(m => m.result);
    }
    return arr;
  }, [filteredCargoRouteData]);

  // If the focused route gets filtered out, drop the focus so the map doesn't
  // stay zoomed on an invisible line.
  useEffect(() => {
    if (selectedId != null && !routeGroups.some(g => g.key === selectedId)) setSelectedId(null);
  }, [routeGroups, selectedId]);

  // Routes lit by the airport focus (empty when none, or when no drawn route
  // touches it — then the focus simply frames the airport).
  const airportFocusKeys = useMemo(
    () => routeKeysAtAirport(routeGroups, focusAirport),
    [routeGroups, focusAirport],
  );

  // ── Style resolver: highlight selected/hovered, dim the rest ─────────────────
  const applyStyles = useCallback(() => {
    const selId = selectedIdRef.current;
    const hovId = hoveredIdRef.current;
    const lit = focusKeysRef.current;
    const anySel = selId != null || lit.size > 0;

    lineGroupsRef.current.forEach((group, id) => {
      // A single focused (or hovered) route flows; an airport's routes are lit
      // solid — dozens of animated dashes at once is what makes a map crawl.
      const flowing = id === selId || id === hovId;
      const active = flowing || lit.has(id);
      let mainW, mainO, haloW, haloO;
      if (flowing)      { mainW = 4.5; mainO = 1;    haloW = 18; haloO = 0.30; }
      else if (active)  { mainW = 3.2; mainO = 1;    haloW = 12; haloO = 0.24; }
      else if (anySel)  { mainW = 1.8; mainO = 0.18; haloW = 7;  haloO = 0.03; }
      else              { mainW = 2.5; mainO = 0.85; haloW = 9;  haloO = 0.16; }

      group.halo.forEach(l => l.setStyle({ weight: haloW, opacity: haloO }));
      group.main.forEach(l => {
        l.setStyle({
          weight: mainW,
          opacity: mainO,
          dashArray: flowing ? '10 16' : null,
        });
        const el = l.getElement && l.getElement();
        if (el) el.classList.toggle('flowing', flowing);
      });
    });
  }, []);

  // 4a. Derive partner route data (alliance members + codeshare partners)
  const currentAlliance = allianceMembership ? getAlliance(allianceMembership.allianceId) : null;

  // Every carrier's live network, tagged by what they are to you. This loop has
  // always walked all of them; it used to `continue` on anyone who wasn't a
  // partner, which made the airlines you are actually competing against the one
  // thing the map would not draw.
  //
  // `contested` marks a rival route on a pair YOU fly. Those are the lines worth
  // looking at, and they are drawn solid and full-strength while the rest of the
  // field sits faint behind them — the same treatment the positioning chart
  // gives the same distinction.
  const partnerRouteData = useMemo(() => {
    const allianceMemberIds   = new Set(currentAlliance?.memberIds ?? []);
    const codesharePartnerIds = new Set(codeshareAgreements.map(a => a.competitorId));
    const myPairs = new Set((routes ?? []).map(r => [r.origin, r.destination].sort().join('-')));
    const result = [];
    for (const comp of competitors) {
      const isAllianceMember   = allianceMemberIds.has(comp.id);
      const isCodesharePartner = codesharePartnerIds.has(comp.id);
      const type = isAllianceMember ? 'alliance' : isCodesharePartner ? 'codeshare' : 'rival';
      const color = type === 'alliance' ? ALLIANCE_COLOR
                  : type === 'codeshare' ? CODESHARE_COLOR
                  : (RIVAL_COLORS[comp.tier] ?? RIVAL_DEFAULT_COLOR);
      for (const routeKey of Object.keys(comp.routes ?? {})) {
        const [a, b] = routeKey.split('-');
        const origin = getAirport(a);
        const dest   = getAirport(b);
        if (!origin || !dest) continue;
        result.push({ comp, type, color, origin, dest, routeKey,
                      contested: myPairs.has(routeKey) });
      }
    }
    // Contested last, so they draw on top of the field rather than under it.
    result.sort((a, b) => (a.contested ? 1 : 0) - (b.contested ? 1 : 0));
    return result;
  }, [competitors, allianceMembership, codeshareAgreements, currentAlliance, routes]);

  /** Pairs of yours that a rival also serves — the number on the Rivals toggle. */
  const contestedRivalCount = useMemo(() => {
    const pairs = new Set();
    for (const r of partnerRouteData) if (r.type === 'rival' && r.contested) pairs.add(r.routeKey);
    return pairs.size;
  }, [partnerRouteData]);

  // 4b. Sync partner overlay layers
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !window.L) return;
    const L = window.L;
    const dim = (selectedId != null || focusAirport) ? 0.25 : 1;   // fade partners when focusing

    // The airport filter applies to partner overlays too, so "show me JFK"
    // really means only lines touching JFK. (The aircraft-type filter is
    // ours-only — we don't know what partners fly.)
    const shown = partnerRouteData.filter(({ type, origin, dest }) =>
      (type === 'alliance' ? showAlliance : type === 'codeshare' ? showCodeshare : showRivals)
      && (airportFilter === 'all' || origin.code === airportFilter || dest.code === airportFilter));
    // Every tick hands over new competitor objects, usually with the same
    // network; everything a partner or rival line shows is in this key.
    const drawKey = `${dim}#` + shown.map(({ comp, type, origin, dest, contested }) =>
      `${comp.id}:${comp.name}:${type}:${contested ? 1 : 0}:${origin.code}-${dest.code}`).sort().join('|');
    if (drawnRef.current.partners === drawKey) return;
    drawnRef.current.partners = drawKey;

    // Clear previous partner layers
    partnerLayersRef.current.forEach(l => map.removeLayer(l));
    partnerLayersRef.current = [];

    for (const { comp, type, color, origin, dest, contested } of shown) {

      const segments = segmentsForRoute(origin.lat, origin.lon, dest.lat, dest.lon);
      const tipHtml = `
        <div class="map-tip">
          <div class="map-tip-title" style="color:${color}">${origin.code} → ${dest.code}</div>
          <div class="map-tip-sub">${origin.city} → ${dest.city}</div>
          <div class="map-tip-sub" style="margin-top:4px">${comp.name} · ${
            type === 'alliance' ? 'Alliance'
            : type === 'codeshare' ? 'Codeshare'
            : contested ? 'Competing with you here' : 'Rival'
          }</div>
        </div>
      `;

      // A partner's network is drawn as it always was. A rival's is drawn
      // quieter — solid where they are on one of your pairs, and barely there
      // where they are somewhere you don't fly. That faint layer IS the market:
      // it is what a route you are thinking about opening looks like before you
      // open it.
      const rival    = type === 'rival';
      const baseOp   = rival ? (contested ? 0.6 : 0.16) : 0.55;
      const baseWt   = rival ? (contested ? 2 : 1) : 1.5;
      const dashes   = rival && contested ? null : '5, 6';

      for (const pts of segments) {
        const line = L.polyline(pts, {
          color,
          weight: baseWt,
          opacity: baseOp * dim,
          ...(dashes ? { dashArray: dashes } : {}),
          smoothFactor: 1,
        });
        line.bindTooltip(tipHtml, { sticky: true, className: 'game-tooltip', offset: [15, 0] });
        line.on('mouseover', () => line.setStyle({ opacity: 0.9, weight: baseWt + 1 }));
        line.on('mouseout',  () => line.setStyle({ opacity: baseOp * dim, weight: baseWt }));
        line.addTo(map);
        partnerLayersRef.current.push(line);
      }

      // Endpoint dots. Skipped for the faint rival field — 165 lines is legible;
      // 330 extra dots on top of them is not.
      if (!rival || contested) {
        for (const airport of [origin, dest]) {
          const dot = L.circleMarker([airport.lat, airport.lon], {
            radius: 3,
            fillColor: color,
            color: color,
            weight: 1,
            fillOpacity: (rival ? 0.5 : 0.7) * dim,
            interactive: false,
          });
          dot.addTo(map);
          partnerLayersRef.current.push(dot);
        }
      }
    }
  }, [partnerRouteData, showAlliance, showCodeshare, showRivals, selectedId, focusAirport, mapReady, airportFilter]);

  // 4c. Sync cargo route overlay (amber, distinct from green/red passenger lines)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !window.L) return;
    const L = window.L;
    // Fade cargo when focusing a passenger route; an airport focus keeps the
    // freight lines that touch the airport.
    const dimFor = (g) => (selectedId != null ? 0.3
      : focusAirport && g.origin.code !== focusAirport && g.dest.code !== focusAirport ? 0.3 : 1);

    // Same lines as last time (a tick): refresh the tooltips only.
    const drawKey = showCargo ? `${selectedId != null}:${focusAirport ?? ''}#${cargoGroups.map(g => g.key).sort().join('|')}` : 'off';
    if (drawnRef.current.cargo === drawKey) {
      const byKey = new Map(cargoGroups.map(g => [g.key, g]));
      for (const l of cargoLayersRef.current) {
        if (l._cargoKey && byKey.has(l._cargoKey)) l.setTooltipContent(cargoTipHtml(byKey.get(l._cargoKey)));
      }
      return;
    }
    drawnRef.current.cargo = drawKey;

    cargoLayersRef.current.forEach(l => map.removeLayer(l));
    cargoLayersRef.current = [];
    if (!showCargo) return;

    for (const g of cargoGroups) {
      const { origin, dest } = g;
      const dim = dimFor(g);
      const segments = segmentsForRoute(origin.lat, origin.lon, dest.lat, dest.lon);
      const tipHtml = cargoTipHtml(g);

      for (const pts of segments) {
        const glow = L.polyline(pts, {
          color: CARGO_COLOR, weight: 9, opacity: 0.14 * dim,
          lineCap: 'round', smoothFactor: 1, interactive: false, className: 'route-glow',
        });
        glow.addTo(map);
        cargoLayersRef.current.push(glow);

        const line = L.polyline(pts, {
          color: CARGO_COLOR, weight: 2.5, opacity: 0.9 * dim,
          lineCap: 'round', smoothFactor: 1,
        });
        line.bindTooltip(tipHtml, { sticky: true, className: 'game-tooltip', offset: [15, 0] });
        line._cargoKey = g.key;
        line.on('mouseover', () => line.setStyle({ weight: 4, opacity: 1 }));
        line.on('mouseout',  () => line.setStyle({ weight: 2.5, opacity: 0.9 * dim }));
        line.addTo(map);
        cargoLayersRef.current.push(line);
      }
    }
  }, [cargoGroups, showCargo, selectedId, focusAirport, mapReady]);

  // 4d. Sync charter contract overlay (yellow, dashed, with the empty leg)
  //
  // Drawn from state.charters rather than from a route array, for the reason in
  // charterMapEntries above. Everything on this layer is deliberately temporary-
  // looking: dashed because the contract ends, and the positioning leg dotted and
  // faint because nobody is being carried on it.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !window.L) return;
    const L = window.L;
    const dim = (selectedId != null || focusAirport) ? 0.3 : 1;   // fade charters when focusing

    charterLayersRef.current.forEach(l => map.removeLayer(l));
    charterLayersRef.current = [];
    if (!showCharters) return;

    for (const { c, origin, dest, ferry } of filteredCharterData) {
      const res      = charterRrById[c.id] ?? null;
      const aircraft = fleet.find(a => a.id === c.aircraftId);
      const acName   = aircraft ? (aircraft.tailNumber ?? aircraft.name ?? '—') : 'unassigned';
      const weeks    = `${c.weeksRemaining ?? 0} of ${c.weeksTotal ?? c.weeksRemaining ?? 0} wk left`;
      const feeStr   = `+${formatMoney(c.feePerWeek ?? 0)}/wk`;
      // A positioning week earns nothing by design, so its profit line is the
      // ferry cost with a minus in front of it — which is the number the player
      // is meant to feel before signing the next one of these.
      const profit   = res ? res.profit : null;
      const profStr  = profit == null ? '—'
        : `<span style="color:${profit >= 0 ? PROFIT_COLOR : LOSS_COLOR}">${profit >= 0 ? '+' : ''}${formatMoney(profit)}/wk</span>`;
      const positioning = c.status === 'positioning';

      const tipHtml = `
        <div class="map-tip">
          <div class="map-tip-title" style="color:${CHARTER_COLOR}">${origin.code} <span class="map-tip-arrow">→</span> ${dest.code}</div>
          <div class="map-tip-sub">${c.icon ? `${c.icon} ` : ''}${c.customer ?? c.name ?? 'Charter'} · ${weeks}</div>
          <div class="map-tip-sub">${acName} · ${c.weeklyFrequency ?? 1}×/wk${
            positioning ? ` · positioning from ${ferry?.code ?? c.positionFrom}` : ''}</div>
          <div class="map-tip-stats">
            <div><span class="map-tip-lbl">Fee</span><span class="map-tip-val" style="color:${CHARTER_COLOR}">${feeStr}</span></div>
            <div><span class="map-tip-lbl">Profit</span><span class="map-tip-val">${profStr}</span></div>
          </div>
          ${positioning ? '<div class="map-tip-hint">Ferrying out — earns nothing this week</div>' : ''}
        </div>
      `;

      // The empty leg, under everything else.
      if (ferry) {
        for (const pts of segmentsForRoute(ferry.lat, ferry.lon, origin.lat, origin.lon)) {
          const leg = L.polyline(pts, {
            color: CHARTER_COLOR, weight: 1.5, opacity: 0.45 * dim,
            dashArray: '2 7', lineCap: 'round', smoothFactor: 1,
          });
          leg.bindTooltip(
            `<div class="map-tip"><div class="map-tip-title" style="color:${CHARTER_COLOR}">${ferry.code} → ${origin.code}</div>` +
            `<div class="map-tip-sub">Positioning leg · ${Math.round(c.ferryKm ?? 0).toLocaleString()} km empty</div>` +
            `<div class="map-tip-sub">Costs ${formatMoney(c.ferryCost ?? 0)}, earns nothing</div></div>`,
            { sticky: true, className: 'game-tooltip', offset: [15, 0] },
          );
          leg.addTo(map);
          charterLayersRef.current.push(leg);
        }
      }

      const baseOp = (positioning ? 0.55 : 0.95) * dim;
      for (const pts of segmentsForRoute(origin.lat, origin.lon, dest.lat, dest.lon)) {
        const glow = L.polyline(pts, {
          color: CHARTER_COLOR, weight: 9, opacity: 0.12 * dim,
          lineCap: 'round', smoothFactor: 1, interactive: false, className: 'route-glow',
        });
        glow.addTo(map);
        charterLayersRef.current.push(glow);

        const line = L.polyline(pts, {
          color: CHARTER_COLOR, weight: 2.5, opacity: baseOp,
          dashArray: '9 7', lineCap: 'round', smoothFactor: 1,
        });
        line.bindTooltip(tipHtml, { sticky: true, className: 'game-tooltip', offset: [15, 0] });
        line.on('mouseover', () => line.setStyle({ weight: 4, opacity: 1 }));
        line.on('mouseout',  () => line.setStyle({ weight: 2.5, opacity: baseOp }));
        line.addTo(map);
        charterLayersRef.current.push(line);
      }
    }
  }, [filteredCharterData, charterRrById, fleet, showCharters, selectedId, focusAirport, mapReady]);

  // 4. Sync routes + markers to map
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !window.L) return;
    const L = window.L;

    // Same lines and pins (the usual weekly tick): recolour any route that
    // crossed break-even, put the new numbers in the tooltips, and keep every
    // layer, the hover/focus styles and the view.
    const drawKey = networkDrawKey(routeGroups, airportSet, hubs);
    if (drawnRef.current.routes === drawKey) {
      for (const g of routeGroups) {
        const group = lineGroupsRef.current.get(g.key);
        if (!group) continue;
        const color = routeGroupColor(g);
        if (color !== group.color) {
          group.halo.forEach(l => l.setStyle({ color }));
          group.main.forEach(l => l.setStyle({ color }));
          group.color = color;
        }
        const tip = routeTipHtml(g);
        group.main.forEach(l => l.setTooltipContent(tip));
      }
      return;
    }
    drawnRef.current.routes = drawKey;

    // Clear previous layers
    layersRef.current.forEach(l => map.removeLayer(l));
    layersRef.current = [];
    lineGroupsRef.current = new Map();
    // Canonical path of every drawn line — the viewport frames these too.
    const framePaths = [];

    // Route polylines (glow halo underneath + crisp main line on top).
    // One line per city pair — all aircraft on the pair are aggregated into the group.
    for (const g of routeGroups) {
      const { origin, dest } = g;
      const chain    = g.chain?.length >= 2 ? g.chain : [origin, dest];
      const profit   = g.hasResult ? g.profit : 0;
      // Profit colour still carries the money; a rotation is purple because the
      // shape of the line is the thing you cannot read any other way (and purple
      // is what the Routes page already calls multi-stop).
      const profitColor = profit >= 0 ? PROFIT_COLOR : LOSS_COLOR;
      const color    = g.multi ? TAG_COLOR : profitColor;
      const segments = g.multi
        ? segmentsForChain(chain.map(a => [a.lat, a.lon]))
        : segmentsForRoute(origin.lat, origin.lon, dest.lat, dest.lon);
      framePaths.push(segments[0]);

      const tipHtml = routeTipHtml(g);

      const halo = [];
      const main = [];

      for (const pts of segments) {
        // Glow halo (non-interactive, sits beneath the main line)
        const glow = L.polyline(pts, {
          color,
          weight: 9,
          opacity: 0.16,
          lineCap: 'round',
          smoothFactor: 1,
          interactive: false,
          className: 'route-glow',
        });
        glow.addTo(map);
        halo.push(glow);
        layersRef.current.push(glow);

        // Crisp main line (interactive)
        const line = L.polyline(pts, {
          color,
          weight: 2.5,
          opacity: 0.85,
          lineCap: 'round',
          smoothFactor: 1,
          className: 'route-line',
        });
        line.bindTooltip(tipHtml, { sticky: true, className: 'game-tooltip', offset: [15, 0] });
        line.on('mouseover', () => { setHoveredId(g.key); });
        line.on('mouseout',  () => { setHoveredId(null); });
        line.on('click', (e) => {
          L.DomEvent.stopPropagation(e);
          setSelectedId(prev => (prev === g.key ? null : g.key));
        });
        line.addTo(map);
        main.push(line);
        layersRef.current.push(line);
      }

      lineGroupsRef.current.set(g.key, { halo, main, color });
    }

    // Airport markers
    for (const airport of airportSet) {
      const hubInfo = hubs[airport.code];

      if (hubInfo) {
        // Pulsing hub marker (animated CSS divIcon), sized by tier so a focus
        // city reads as smaller than an International Gateway.
        const { core, ring } = hubMarkerSize(hubInfo.tier);
        const hubMarker = L.marker([airport.lat, airport.lon], {
          icon: L.divIcon({
            className: 'hub-marker',
            html: `<span class="hub-pulse-ring" style="--hub-ring:${ring}px"></span><span class="hub-pulse-core" style="--hub-core:${core}px"></span>`,
            iconSize: [22, 22],
            iconAnchor: [11, 11],
          }),
          zIndexOffset: 1000,
        });
        hubMarker.bindTooltip(networkAirportTip(airport, hubInfo), { className: 'game-tooltip', offset: [12, 0] });
        // Same as a background dot: the airport's page, with its gate card.
        hubMarker.on('click', (e) => { L.DomEvent.stopPropagation(e); setDetailCode(airport.code); });
        hubMarker.addTo(map);
        layersRef.current.push(hubMarker);
      } else {
        // Glow halo behind spoke airport
        const halo = L.circleMarker([airport.lat, airport.lon], {
          radius: 9,
          fillColor: SPOKE_COLOR,
          color: SPOKE_COLOR,
          weight: 0,
          fillOpacity: 0.18,
          interactive: false,
        });
        halo.addTo(map);
        layersRef.current.push(halo);

        const marker = L.circleMarker([airport.lat, airport.lon], {
          radius: 5,
          fillColor: SPOKE_COLOR,
          color: '#bfe0ff',
          weight: 1.5,
          fillOpacity: 1,
        });
        marker.bindTooltip(networkAirportTip(airport), { className: 'game-tooltip', offset: [10, 0] });
        marker.on('click', (e) => { L.DomEvent.stopPropagation(e); setDetailCode(airport.code); });
        marker.addTo(map);
        layersRef.current.push(marker);
      }

      // Code label (not shown at low zoom — Leaflet handles that via zoom)
      // Clickable: a click lights every route at this airport. (The pin itself
      // opens the airport's detail, as before.)
      const label = L.marker([airport.lat, airport.lon], {
        icon: L.divIcon({
          className: 'airport-label airport-label-click',
          html: `<span>${airport.code}</span>`,
          iconAnchor: [-10, 4],
        }),
        interactive: true,
        keyboard: false,
        title: `Show every route at ${airport.code}`,
        zIndexOffset: 500,
      });
      label.on('click', (e) => { window.L.DomEvent.stopPropagation(e); airportClickRef.current?.(airport.code); });
      label.addTo(map);
      layersRef.current.push(label);
    }

    // Frame the network — only when its extent actually changed.
    if (claimViewportFit(fittedExtentRef, airportSet)) {
      // Airports AND the arcs between them — see frameLatLngs above.
      const bounds = L.latLngBounds(frameLatLngs(airportSet, framePaths));
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 5 });
    }

    applyStyles();
  }, [routeGroups, airportSet, hubs, mapReady, applyStyles]); // mapReady ensures this re-runs after L.map() finishes

  // 5. Every airport in the game, dim, under the network. Redrawn for the view
  // on every pan and zoom (see worldAirportsInView). Lives in its own panes so
  // it always sits beneath your lines and your own airports' markers.
  // Keyed on the codes, not the array: airportSet is a new array after every
  // tick, and a new Set here clears and redraws every background dot.
  const pinnedKey = useMemo(() => airportSet.map(a => a.code).sort().join(','), [airportSet]);
  const pinnedCodes = useMemo(() => new Set(pinnedKey ? pinnedKey.split(',') : []), [pinnedKey]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !window.L || !showAirports) return;
    const L = window.L;
    if (!map.getPane('worldAirports')) {
      map.createPane('worldAirports').style.zIndex = 350;        // under route lines (400)
      map.createPane('worldAirportLabels').style.zIndex = 450;   // under your own labels (600)
      map.getPane('worldAirportLabels').style.pointerEvents = 'none';
    }
    // One canvas for every dot: a few hundred SVG circles per pan is what
    // makes a map stutter. A generous hit tolerance, because a 3px dot is
    // hard to land a finger on.
    if (!worldRendererRef.current) {
      worldRendererRef.current = L.canvas({ pane: 'worldAirports', padding: 0.2, tolerance: isMobile ? 10 : 5 });
    }
    const renderer = worldRendererRef.current;
    const group = L.layerGroup().addTo(map);

    const draw = () => {
      group.clearLayers();
      const b = map.getBounds().pad(0.15);
      const { dots, labels } = worldAirportsInView(AIRPORTS, map.getZoom(), {
        south: b.getSouth(), north: b.getNorth(), west: b.getWest(), east: b.getEast(),
      }, pinnedCodes);
      for (const d of dots) {
        const m = L.circleMarker([d.lat, d.lon], {
          renderer, pane: 'worldAirports',
          radius: d.major ? 3.5 : 2.5,
          color: '#0a1020', weight: 1,
          fillColor: d.major ? '#b4c2d4' : '#7f8ca0', fillOpacity: 0.9,
        });
        m.bindTooltip(worldAirportTip(d.a), { className: 'game-tooltip', offset: [8, 0] });
        m.on('click', (e) => { L.DomEvent.stopPropagation(e); setDetailCode(d.a.code); });
        group.addLayer(m);
      }
      for (const d of labels) {
        group.addLayer(L.marker([d.lat, d.lon], {
          icon: L.divIcon({
            className: 'airport-label airport-label-world',
            // Same type as your own airports' codes, quieter, so the network still reads first.
            html: `<span style="color:#8d9bb0;font-weight:600;font-size:9px;opacity:.85">${d.a.code}</span>`,
            iconAnchor: [-6, 5],
          }),
          pane: 'worldAirportLabels',
          interactive: false,
          keyboard: false,
        }));
      }
    };

    draw();
    map.on('moveend', draw);   // fires after a zoom too
    return () => {
      // On unmount the map is torn down first (mapRef already cleared), and
      // its layers go with it.
      if (mapRef.current !== map) return;
      map.off('moveend', draw);
      map.removeLayer(group);
    };
  }, [mapReady, showAirports, pinnedCodes, isMobile]);

  // Re-style when hover changes
  useEffect(() => {
    hoveredIdRef.current = hoveredId;
    applyStyles();
  }, [hoveredId, applyStyles]);

  // What a focus frames: the route's whole chain, or every airport on the
  // routes at the focused airport (the airport alone when none touch it).
  const focusKey = selectedId != null ? selectedId : (focusAirport ? `airport:${focusAirport}` : null);
  const focusChain = useMemo(() => {
    if (selectedId != null) {
      const g = routeGroups.find(x => x.key === selectedId);
      return g ? (g.chain?.length >= 2 ? g.chain : [g.origin, g.dest]) : null;
    }
    if (!focusAirport) return null;
    const keys = new Set(airportFocusKeys);
    const pts = new Map();
    for (const g of routeGroups) {
      if (!keys.has(g.key)) continue;
      for (const a of (g.chain?.length >= 2 ? g.chain : [g.origin, g.dest])) if (a) pts.set(a.code, a);
    }
    const self = getAirport(focusAirport);
    if (self) pts.set(self.code, self);
    return pts.size ? [...pts.values()] : null;
  }, [selectedId, focusAirport, airportFocusKeys, routeGroups]);

  // Re-style + fly to the focus when it changes
  useEffect(() => {
    selectedIdRef.current = selectedId;
    focusKeysRef.current = new Set(airportFocusKeys);
    applyStyles();

    // routeGroups is a dependency (the focused route's coordinates live there),
    // so this effect also fires on the weekly tick. Fly once per focus — and
    // never while the map has no size yet (see claimRouteFly).
    const map = mapRef.current;
    const visible = !!map && map.getSize().x > 0;
    const focusChanged = claimRouteFly(flownToRef, focusKey, visible);
    if (!focusChanged || !map || !window.L) return;
    if (!focusChain) { flownToRef.current = null; return; }
    // Frame the WHOLE rotation — flying to the endpoints of MCI–JFK–ORY can
    // leave the stop in the middle off-screen.
    const bounds = window.L.latLngBounds(focusChain.map(a => [a.lat, a.lon]));
    try {
      if (focusChain.length === 1) map.flyTo(bounds.getCenter(), Math.max(map.getZoom(), 4), { duration: 0.8 });
      else map.flyToBounds(bounds, { padding: [90, 90], maxZoom: 6, duration: 0.8 });
    } catch { /* a fly is never worth the page */ }
  }, [selectedId, focusKey, focusChain, airportFocusKeys, routeGroups, applyStyles]);

  // A focused airport that leaves the network (its last route closed) clears.
  useEffect(() => {
    if (focusAirport && !airportSet.some(a => a.code === focusAirport)) setFocusAirportRaw(null);
  }, [airportSet, focusAirport]);

  // A carrier can hold a contract before it opens a single scheduled route, so
  // "nothing flying" means none of the three. With no network the map still
  // earns its place: it is where a new airline looks for somewhere to go.
  const noNetwork = routes.length === 0 && cargoRoutes.length === 0 && charterData.length === 0;

  const selectedData = selectedId != null ? routeGroups.find(x => x.key === selectedId) : null;

  // Satellite / Dark. Shared by the Map tab's header and the full-bleed map's
  // floating controls.
  const basemapToggle = (
    <div className="map-view-toggle" role="group" aria-label="Map style">
      {[['satellite', 'Satellite'], ['dark', 'Dark']].map(([v, label]) => (
        <button
          key={v}
          data-basemap={v}
          className={basemap === v ? 'active' : ''}
          aria-pressed={basemap === v}
          onClick={() => setBasemap(v)}
          title={v === 'satellite' ? 'NASA Blue Marble satellite imagery' : 'Dark map with coastlines and borders'}
        >{label}</button>
      ))}
    </div>
  );

  // The map itself.
  const mapBody = (
    <>
    {error ? (
      <div style={{ height: mapHeight, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#060b18', color: 'var(--red)', fontSize: 13 }}>
        <Glyph e="⚠" /> Could not load map: {error}
      </div>
    ) : !ready ? (
      <div style={{ height: mapHeight, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#060b18', color: 'var(--text-muted)', fontSize: 13, gap: 10 }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
        </svg>
        Loading map tiles…
      </div>
    ) : (
      <div ref={mapElRef} style={{ height: mapHeight }} />
    )}
    </>
  );

  // Map-first layout: the map IS the screen. No card, no route table — the
  // Routes page has the table — just the map and a small floating control row.
  // With no network yet it still draws every airport you can fly to.
  if (fullBleed) {
    return (
      <div ref={bleedRef} className="map-bleed">
        {mapBody}
        {noNetwork && (
          <div className="map-bleed-hint">No routes yet — tap <strong>Search</strong> to find your first one.</div>
        )}
        <div className="map-bleed-controls">
          {basemapToggle}
          <button
            className={`map-bleed-chip${showAirports ? ' on' : ''}`}
            aria-pressed={showAirports}
            onClick={toggleAirports}
            title={showAirports ? 'Hide the airports you don\'t fly to' : 'Show every airport you can fly to'}
          >Airports</button>
          {selectedId != null && (
            <button className="map-bleed-chip on" onClick={clearFocus}>
              <Glyph e="✕" /> Focus
            </button>
          )}
          {focusAirport && (
            <button className="map-bleed-chip on" data-airport-focus={focusAirport} onClick={clearFocus}
              title={`Stop highlighting ${focusAirport}'s routes`}>
              <Glyph e="✕" /> {focusAirport} · {airportFocusKeys.length} route{airportFocusKeys.length === 1 ? '' : 's'}
            </button>
          )}
        </div>
        {detailCode && <AirportDetailModal code={detailCode} onClose={() => setDetailCode(null)} />}
      </div>
    );
  }

  return (
    <div>
      {/* Map card */}
      <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 16 }}>
        {/* Header */}
        <div style={{
          padding: '12px 20px', borderBottom: '1px solid var(--border)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <div>
            <span style={{ fontWeight: 600, fontSize: 14 }}>Route Network</span>
            {noNetwork ? (
              <span style={{ marginLeft: 10, fontSize: 12, color: 'var(--text-muted)' }}>
                No routes yet{showAirports ? ' — every airport you can fly to is on the map; click one to lease a gate there' : ''}
              </span>
            ) : (
            <span style={{ marginLeft: 10, fontSize: 12, color: 'var(--text-muted)' }}>
              {routeGroups.length} route{routeGroups.length !== 1 ? 's' : ''} · {airportSet.length} airports{
                filteredCharterData.length > 0 && ` · ${filteredCharterData.length} charter${filteredCharterData.length !== 1 ? 's' : ''}`
              }{filtersActive && <span style={{ color: 'var(--accent)' }}> · filtered</span>}
              {selectedData && (
                <span style={{ color: 'var(--accent)' }}> · focused {(selectedData.chain ?? [selectedData.origin, selectedData.dest]).map(a => a.code).join('→')}</span>
              )}
              {focusAirport && (
                <span style={{ color: 'var(--accent)' }}> · {focusAirport}: {airportFocusKeys.length} route{airportFocusKeys.length === 1 ? '' : 's'}</span>
              )}
            </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 12, fontSize: 11, color: 'var(--text-muted)', alignItems: 'center', flexWrap: 'wrap' }}>
            {basemapToggle}
            {/* Filters: aircraft type + airport */}
            {typesInUse.length > 1 && (
              <select
                className="form-select"
                value={acTypeFilter}
                onChange={e => setAcTypeFilter(e.target.value)}
                style={{ width: 'auto', fontSize: 11, padding: '3px 6px', maxWidth: 160 }}
                title="Only show routes flown by this aircraft type"
              >
                <option value="all">Aircraft: All</option>
                {typesInUse.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            )}
            {airportOptions.length > 1 && (
              <select
                className="form-select"
                value={airportFilter}
                onChange={e => setAirportFilter(e.target.value)}
                style={{ width: 'auto', fontSize: 11, padding: '3px 6px', maxWidth: 160 }}
                title="Only show routes touching this airport"
              >
                <option value="all">Airport: All</option>
                {airportOptions.map(a => <option key={a.code} value={a.code}>{a.code} — {a.city}</option>)}
              </select>
            )}
            {filtersActive && (
              <button
                onClick={() => { setAcTypeFilter('all'); setAirportFilter('all'); }}
                className="map-clear-btn"
                title="Clear map filters"
              >
                <Glyph e="✕" /> Filters
              </button>
            )}
            {(selectedId != null || focusAirport) && (
              <button
                onClick={clearFocus}
                className="map-clear-btn"
              >
                <Glyph e="✕" /> Clear focus
              </button>
            )}
            {/* Static legend items */}
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 18, height: 2, background: PROFIT_COLOR, display: 'inline-block', borderRadius: 1 }} />
              Profitable
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 18, height: 2, background: LOSS_COLOR, display: 'inline-block', borderRadius: 1 }} />
              Loss
            </span>
            {routeGroups.some(g => g.multi) && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 5 }} title="A multi-stop rotation, drawn through every stop it serves">
                <span style={{ width: 18, height: 2, background: TAG_COLOR, display: 'inline-block', borderRadius: 1 }} />
                Multi-stop
              </span>
            )}
            <span
              style={{ display: 'flex', alignItems: 'center', gap: 5 }}
              title="Gold pins mark every station you've designated — focus cities, hubs and gateways alike"
            >
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: HUB_COLOR, display: 'inline-block' }} />
              {hubCodes.length > 1 ? 'Hubs' : 'Hub'}
            </span>

            {/* Every-airport layer. On by default; remembered per browser. */}
            <button
              onClick={toggleAirports}
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                opacity: showAirports ? 1 : 0.4, transition: 'opacity 0.15s',
                color: 'var(--text-muted)', fontSize: 11,
              }}
              title={showAirports
                ? 'Hide the other airports'
                : 'Show every airport in the game — the big ones always, smaller fields as you zoom in'}
            >
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#b4c2d4', display: 'inline-block' }} />
              All airports
            </button>

            {/* Cargo toggle — only when cargo routes exist */}
            {cargoRoutes.length > 0 && (
              <button
                onClick={() => setShowCargo(v => !v)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                  opacity: showCargo ? 1 : 0.4, transition: 'opacity 0.15s',
                  color: 'var(--text-muted)', fontSize: 11,
                }}
                title={showCargo ? 'Hide cargo routes' : 'Show cargo routes'}
              >
                <span style={{ width: 18, height: 2, background: CARGO_COLOR, display: 'inline-block', borderRadius: 1 }} />
                <Glyph e="📦" /> Cargo
              </button>
            )}

            {/* Charter toggle — only when contracts are being flown */}
            {charterData.length > 0 && (
              <button
                onClick={() => setShowCharters(v => !v)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                  opacity: showCharters ? 1 : 0.4, transition: 'opacity 0.15s',
                  color: 'var(--text-muted)', fontSize: 11,
                }}
                title={showCharters
                  ? 'Hide charter contracts'
                  : 'Show charter contracts — dashed, with the positioning leg dotted'}
              >
                <span style={{
                  width: 18, height: 0, borderTop: `2px dashed ${CHARTER_COLOR}`,
                  display: 'inline-block',
                }} />
                <Glyph e="📋" /> Charters
              </button>
            )}

            {/* Divider */}
            <span style={{ width: 1, height: 14, background: 'var(--border)', display: 'inline-block' }} />

            {/* Alliance toggle */}
            {currentAlliance && (
              <button
                onClick={() => setShowAlliance(v => !v)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                  opacity: showAlliance ? 1 : 0.4, transition: 'opacity 0.15s',
                  color: 'var(--text-muted)', fontSize: 11,
                }}
                title={showAlliance ? 'Hide alliance routes' : 'Show alliance routes'}
              >
                <span style={{
                  width: 18, height: 0, borderTop: `2px dashed ${ALLIANCE_COLOR}`,
                  display: 'inline-block',
                }} />
                Alliance
              </button>
            )}

            {/* Rivals toggle. Counts the ones on your own pairs, because that
                number is the reason to turn it on. */}
            {competitors.length > 0 && (
              <button
                onClick={() => setShowRivals(v => !v)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                  opacity: showRivals ? 1 : 0.4, transition: 'opacity 0.15s',
                  color: 'var(--text-muted)', fontSize: 11,
                }}
                title={showRivals ? 'Hide rival routes' : 'Show every rival network'}
              >
                <span style={{
                  width: 18, height: 0, borderTop: `2px solid ${RIVAL_DEFAULT_COLOR}`,
                  display: 'inline-block',
                }} />
                Rivals{contestedRivalCount > 0 ? ` (${contestedRivalCount})` : ''}
              </button>
            )}

            {/* Codeshare toggle */}
            {codeshareAgreements.length > 0 && (
              <button
                onClick={() => setShowCodeshare(v => !v)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                  opacity: showCodeshare ? 1 : 0.4, transition: 'opacity 0.15s',
                  color: 'var(--text-muted)', fontSize: 11,
                }}
                title={showCodeshare ? 'Hide codeshare routes' : 'Show codeshare routes'}
              >
                <span style={{
                  width: 18, height: 0, borderTop: `2px dashed ${CODESHARE_COLOR}`,
                  display: 'inline-block',
                }} />
                Codeshare
              </button>
            )}
          </div>
        </div>

        {mapBody}
      </div>

      {detailCode && <AirportDetailModal code={detailCode} onClose={() => setDetailCode(null)} />}

      {/* Route summary table */}
      {!noNetwork && (
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '10px 20px', borderBottom: '1px solid var(--border)' }}>
          <span style={{ fontWeight: 600, fontSize: 12, textTransform: 'uppercase', letterSpacing: '.5px', color: 'var(--text-muted)' }}>
            All Routes
          </span>
          <span style={{ marginLeft: 10, fontSize: 11, color: 'var(--text-dim)' }}>
            click a row to focus it on the map
          </span>
        </div>
        <table>
          <thead>
            <tr>
              <th style={{ width: 14 }}></th>
              <th>Route</th>
              <th>Airports</th>
              <th>Distance</th>
              <th>Load</th>
              <th>Profit / wk</th>
            </tr>
          </thead>
          <tbody>
            {routeGroups.map((g) => {
              const profit = g.hasResult ? g.profit : 0;
              const lf = g.hasResult ? g.loadFactor : 0;
              const isHov = hoveredId === g.key;
              const isSel = selectedId === g.key;
              return (
                <tr
                  key={g.key}
                  onClick={() => setSelectedId(prev => (prev === g.key ? null : g.key))}
                  onMouseEnter={() => setHoveredId(g.key)}
                  onMouseLeave={() => setHoveredId(null)}
                  style={{
                    background: isSel ? 'var(--accent-dim)' : isHov ? 'var(--surface2)' : undefined,
                    boxShadow: isSel ? 'inset 3px 0 0 var(--accent)' : undefined,
                    cursor: 'pointer',
                  }}
                >
                  <td style={{ paddingRight: 4 }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: profit >= 0 ? 'var(--green)' : 'var(--red)' }} />
                  </td>
                  <td>
                    <strong style={g.multi ? { color: TAG_COLOR } : undefined}>
                      {(g.chain ?? [g.origin, g.dest]).map(a => a.code).join(' → ')}
                    </strong>
                    {g.aircraftCount > 1 && (
                      <span className="ac-badge">{g.aircraftCount}×</span>
                    )}
                  </td>
                  <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                    {g.multi
                      ? `${g.origin.city} → ${g.dest.city} · ${(g.chain?.length ?? 2) - 1} legs`
                      : `${g.origin.city} → ${g.dest.city}`}
                  </td>
                  <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                    {g.hasResult ? `${g.distance.toLocaleString()} km` : '—'}
                  </td>
                  <td>
                    {g.hasResult ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{
                          fontSize: 12, fontWeight: 600,
                          color: lf > 0.7 ? 'var(--green)' : lf > 0.4 ? 'var(--yellow)' : 'var(--red)',
                        }}>
                          {(lf * 100).toFixed(0)}%
                        </span>
                        <div className="mini-bar" style={{ width: 48 }}>
                          <div className="mini-bar-fill" style={{
                            width: `${Math.min(lf, 1) * 100}%`,
                            background: lf > 0.7 ? 'var(--green)' : lf > 0.4 ? 'var(--yellow)' : 'var(--red)',
                          }} />
                        </div>
                      </div>
                    ) : '—'}
                  </td>
                  <td>
                    <span style={{ fontWeight: 600, color: profit >= 0 ? 'var(--green)' : 'var(--red)' }}>
                      {profit >= 0 ? '+' : ''}{formatMoney(profit)}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      )}
    </div>
  );
}
