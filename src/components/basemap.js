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
