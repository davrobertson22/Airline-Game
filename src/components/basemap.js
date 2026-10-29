// Basemap tile source for the route map.
//
// CARTO started requiring an API key on their raster basemaps in August 2026.
// Unkeyed tiles still return HTTP 200 — but with "API KEY REQUIRED" burnt into
// the PNG, so the failure looks like graffiti across the ocean rather than a
// broken map. The key is free (carto.com/basemaps/apikey — email + domain, no
// account, 5M tiles/month) and is read from VITE_CARTO_KEY at build time.
//
// No key set → the old unkeyed URL. Watermarked, but the map still draws; a
// missing env var must never blank the world.
//
// Plain JS, no JSX, so tools/ tests can import it without a transform.

export const CARTO_KEY = import.meta.env?.VITE_CARTO_KEY || '';

// Split out from TILE_URL so a test can assert the key reaches the query string
// without Vite, a DOM or a network call.
export function cartoTileUrl(key = CARTO_KEY) {
  const base = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
  return key ? `${base}?key=${encodeURIComponent(key)}` : base;
}

export const TILE_URL = cartoTileUrl();

export const TILE_OPTS = {
  attribution: '© <a href="https://www.openstreetmap.org/copyright">OSM</a> © <a href="https://carto.com/attributions">CARTO</a>',
  subdomains: 'abcd',
  maxZoom: 20,
};

// ── Satellite basemap (NASA Blue Marble) ──────────────────────────────────────
// Self-hosted, public-domain imagery: no key, no quota, no tile bill. CARTO's
// commercial free tier is 1M tiles/month, and a map that is always on screen
// (the map-first layout) would burn through that; these are static files
// served with the site, so a page view costs nothing.
//
// The tiles live in public/tiles/bluemarble/{z}/{x}/{y}.jpg, Web Mercator,
// zoom 0–6 (5,461 JPEGs, ~21 MB), cut from NASA's Blue Marble Next Generation
// July 2004 mosaic (21600×10800) by tools/bluemarble-tiles.py. Beyond zoom 6
// the source has no more detail, so the map over-zooms the z6 tiles.
//
// Opt-in: until a player picks Satellite or Dark, the default follows the
// layout. Classic keeps the Dark map everyone already knows; the map-first
// layout (a beta the player chooses to try) opens on Satellite. An explicit
// pick wins in both. Ported from Headwinds (mapCore.js there).
export const BASEMAP_KEY = 'tw_basemap';
// Fired on window when the choice changes, so a map already on screen (and the
// settings menu that changed it) stay in step without a context.
export const BASEMAP_EVENT = 'tw:basemap';
export const BASEMAPS = ['satellite', 'dark'];
export const DEFAULT_BASEMAP = 'dark';          // classic layout, no pick yet
export const MAP_FIRST_BASEMAP = 'satellite';   // map-first layout, no pick yet
// The layout choice (components/MapShell.jsx). Kept here, not there, because
// MapShell imports this module through RouteMap.
export const LAYOUT_KEY = 'tw_layout';
export const BLUE_MARBLE_PATH = '/tiles/bluemarble/{z}/{x}/{y}.jpg';
export const BLUE_MARBLE_MAX_ZOOM = 6;
export const BLUE_MARBLE_ATTRIBUTION =
  'Imagery <a href="https://visibleearth.nasa.gov/collection/1484/blue-marble">NASA Blue Marble</a>';
// The imagery's own ocean colour, for the strip past ±85° Web Mercator never
// draws and for the moment before the first tile lands.
export const SATELLITE_OCEAN = '#02051a';

/** The basemap a player who has never picked one sees, by layout. */
export function defaultBasemap() {
  try { return localStorage.getItem(LAYOUT_KEY) === 'map' ? MAP_FIRST_BASEMAP : DEFAULT_BASEMAP; }
  catch { return DEFAULT_BASEMAP; }
}

/** An unknown or missing value is the default, never a broken map. */
export function normalizeBasemap(v) {
  return BASEMAPS.includes(v) ? v : defaultBasemap();
}

export function readBasemap() {
  try { return normalizeBasemap(localStorage.getItem(BASEMAP_KEY)); }
  catch { return DEFAULT_BASEMAP; }
}

export function writeBasemap(v) {
  const b = normalizeBasemap(v);
  try { localStorage.setItem(BASEMAP_KEY, b); } catch { /* private mode */ }
  try { window.dispatchEvent(new CustomEvent(BASEMAP_EVENT, { detail: b })); } catch { /* SSR */ }
  return b;
}

/** Blue Marble tile template. Built by string concatenation — new URL() would
 *  percent-encode the {z}/{x}/{y} braces. */
export function blueMarbleTileUrl(origin = '') {
  return `${origin}${BLUE_MARBLE_PATH}`;
}

/** Leaflet tile layer arguments for a basemap id. */
export function basemapLayerSpec(id) {
  if (normalizeBasemap(id) === 'satellite') {
    return {
      url: blueMarbleTileUrl(),
      opts: { attribution: BLUE_MARBLE_ATTRIBUTION, maxNativeZoom: BLUE_MARBLE_MAX_ZOOM, maxZoom: 20 },
    };
  }
  return { url: TILE_URL, opts: TILE_OPTS };
}

/** Swap a Leaflet map's basemap in place — markers, lines and zoom untouched. */
export function setMapBasemap(map, id) {
  const L = typeof window !== 'undefined' ? window.L : null;
  const b = normalizeBasemap(id);
  if (!L || !map || map.__twBasemap === b) return;
  if (map.__twBaseLayer) map.removeLayer(map.__twBaseLayer);
  const { url, opts } = basemapLayerSpec(b);
  map.__twBaseLayer = L.tileLayer(url, opts).addTo(map);
  map.__twBaseLayer.bringToBack?.();
  map.__twBasemap = b;
  const el = map.getContainer?.();
  if (el) el.style.background = b === 'satellite' ? SATELLITE_OCEAN : '';
}
