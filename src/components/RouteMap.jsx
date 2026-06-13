import { useEffect, useRef, useMemo, useState } from 'react';
import { useGame } from '../store/GameContext.jsx';
import { getAirport } from '../data/airports.js';
import { simulateRoute, formatMoney, currentGameDate } from '../utils/simulation.js';
import { getAlliance } from '../data/alliances.js';

// ── Great-circle path as a single continuous segment ─────────────────────────
// Keeps longitudes unwrapped (may exceed ±180) so Leaflet draws one smooth arc
// across world copies instead of splitting at the antimeridian edge.
function segmentsForRoute(lat1, lon1, lat2, lon2, n = 80) {
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

  return [norm];
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

function loadLeaflet() {
  return new Promise((resolve, reject) => {
    if (window.L) { resolve(window.L); return; }

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
    script.onerror = () => reject(new Error('Failed to load Leaflet'));
    document.head.appendChild(script);
  });
}

// ── Partner overlay colours ───────────────────────────────────────────────────
const ALLIANCE_COLOR   = '#a78bfa';  // purple for alliance members
const CODESHARE_COLOR  = '#38bdf8';  // sky-blue for codeshare partners

// ── Component ─────────────────────────────────────────────────────────────────
export default function RouteMap() {
  const { state } = useGame();
  const { fleet, routes, hub, competitors = [], allianceMembership, codeshareAgreements = [] } = state;

  const mapElRef      = useRef(null);   // DOM node
  const mapRef        = useRef(null);   // Leaflet map instance
  const layersRef     = useRef([]);     // Active Leaflet layers (routes + markers)
  const partnerLayersRef = useRef([]);  // Partner overlay layers (separate so we can toggle)
  const [ready, setReady]       = useState(!!window.L);
  const [mapReady, setMapReady] = useState(false);   // true once L.map() is done
  const [error, setError]       = useState(null);
  const [hoveredId, setHoveredId] = useState(null);
  const [showAlliance,  setShowAlliance]  = useState(true);
  const [showCodeshare, setShowCodeshare] = useState(true);

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
    });

    L.control.zoom({ position: 'bottomright' }).addTo(map);

    // CartoDB Dark Matter — proper dark game-map feel
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OSM</a> © <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: 'abcd',
      maxZoom: 20,
    }).addTo(map);

    mapRef.current = map;
    setMapReady(true);   // ← signals the layers effect to run

    // Cleanup on unmount
    return () => {
      map.remove();
      mapRef.current = null;
      setMapReady(false);
    };
  }, [ready]);

  // 3. Derive route data
  const gd = currentGameDate(state);
  const routeData = useMemo(() => routes.map(r => {
    const origin   = getAirport(r.origin);
    const dest     = getAirport(r.destination);
    if (!origin || !dest) return null;
    const aircraft = fleet.find(a => a.id === r.aircraftId);
    const result   = aircraft ? simulateRoute(r, aircraft, gd) : null;
    return { r, origin, dest, result };
  }).filter(Boolean), [routes, fleet, state.week]);

  const airportSet = useMemo(() => {
    const codes = new Set([hub, ...routeData.flatMap(d => [d.origin.code, d.dest.code])]);
    return [...codes].map(getAirport).filter(Boolean);
  }, [routeData, hub]);

  // 4a. Derive partner route data (alliance members + codeshare partners)
  const currentAlliance = allianceMembership ? getAlliance(allianceMembership.allianceId) : null;

  const partnerRouteData = useMemo(() => {
    const allianceMemberIds   = new Set(currentAlliance?.memberIds ?? []);
    const codesharePartnerIds = new Set(codeshareAgreements.map(a => a.competitorId));
    const result = [];
    for (const comp of competitors) {
      const isAllianceMember   = allianceMemberIds.has(comp.id);
      const isCodesharePartner = codesharePartnerIds.has(comp.id);
      if (!isAllianceMember && !isCodesharePartner) continue;
      const type  = isAllianceMember ? 'alliance' : 'codeshare';
      const color = isAllianceMember ? ALLIANCE_COLOR : CODESHARE_COLOR;
      for (const routeKey of Object.keys(comp.routes ?? {})) {
        const [a, b] = routeKey.split('-');
        const origin = getAirport(a);
        const dest   = getAirport(b);
        if (!origin || !dest) continue;
        result.push({ comp, type, color, origin, dest, routeKey });
      }
    }
    return result;
  }, [competitors, allianceMembership, codeshareAgreements, currentAlliance]);

  // 4b. Sync partner overlay layers
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !window.L) return;
    const L = window.L;

    // Clear previous partner layers
    partnerLayersRef.current.forEach(l => map.removeLayer(l));
    partnerLayersRef.current = [];

    for (const { comp, type, color, origin, dest } of partnerRouteData) {
      const show = type === 'alliance' ? showAlliance : showCodeshare;
      if (!show) continue;

      const segments = segmentsForRoute(origin.lat, origin.lon, dest.lat, dest.lon);
      const tipHtml = `
        <div class="map-tip">
          <div class="map-tip-title" style="color:${color}">${origin.code} → ${dest.code}</div>
          <div class="map-tip-sub">${origin.city} → ${dest.city}</div>
          <div class="map-tip-sub" style="margin-top:4px">${comp.name} · ${type === 'alliance' ? '🌐 Alliance' : '🤝 Codeshare'}</div>
        </div>
      `;

      for (const pts of segments) {
        const line = L.polyline(pts, {
          color,
          weight: 1.5,
          opacity: 0.55,
          dashArray: '5, 6',
          smoothFactor: 1,
        });
        line.bindTooltip(tipHtml, { sticky: true, className: 'game-tooltip', offset: [15, 0] });
        line.on('mouseover', () => line.setStyle({ opacity: 0.9, weight: 2.5 }));
        line.on('mouseout',  () => line.setStyle({ opacity: 0.55, weight: 1.5 }));
        line.addTo(map);
        partnerLayersRef.current.push(line);
      }

      // Small dot at each endpoint (only if not already in our own airportSet)
      for (const airport of [origin, dest]) {
        const dot = L.circleMarker([airport.lat, airport.lon], {
          radius: 3,
          fillColor: color,
          color: color,
          weight: 1,
          fillOpacity: 0.7,
          interactive: false,
        });
        dot.addTo(map);
        partnerLayersRef.current.push(dot);
      }
    }
  }, [partnerRouteData, showAlliance, showCodeshare, mapReady]);

  // 4. Sync routes + markers to map
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !window.L) return;
    const L = window.L;

    // Clear previous layers
    layersRef.current.forEach(l => map.removeLayer(l));
    layersRef.current = [];

    // Route polylines
    for (const { r, origin, dest, result } of routeData) {
      const profit   = result?.profit ?? 0;
      const color    = profit >= 0 ? '#3fb950' : '#f85149';
      const segments = segmentsForRoute(origin.lat, origin.lon, dest.lat, dest.lon);

      const lf      = result ? `${(result.loadFactor * 100).toFixed(0)}%` : '—';
      const pax     = result?.passengers?.toLocaleString() ?? '—';
      const profStr = result ? `<span style="color:${color}">${profit >= 0 ? '+' : ''}${formatMoney(profit)}/wk</span>` : '—';
      const rev     = result ? `+${formatMoney(result.revenue)}` : '—';
      const tipHtml = `
        <div class="map-tip">
          <div class="map-tip-title">${r.origin} <span class="map-tip-arrow">→</span> ${r.destination}</div>
          <div class="map-tip-sub">${origin.city} → ${dest.city}</div>
          <div class="map-tip-stats">
            <div><span class="map-tip-lbl">Load</span><span class="map-tip-val">${lf}</span></div>
            <div><span class="map-tip-lbl">Pax/wk</span><span class="map-tip-val">${pax}</span></div>
            <div><span class="map-tip-lbl">Revenue</span><span class="map-tip-val" style="color:#3fb950">${rev}</span></div>
            <div><span class="map-tip-lbl">Profit</span><span class="map-tip-val">${profStr}</span></div>
          </div>
        </div>
      `;

      // One polyline per segment (routes crossing the antimeridian get two)
      const lines = segments.map(pts => L.polyline(pts, {
        color,
        weight: 2.2,
        opacity: 0.75,
        smoothFactor: 1,
      }));

      lines.forEach(line => {
        line.bindTooltip(tipHtml, { sticky: true, className: 'game-tooltip', offset: [15, 0] });
        line.on('mouseover', () => {
          lines.forEach(l => l.setStyle({ weight: 4, opacity: 1 }));
          setHoveredId(r.id);
        });
        line.on('mouseout', () => {
          lines.forEach(l => l.setStyle({ weight: 2.2, opacity: 0.75 }));
          setHoveredId(null);
        });
        line.addTo(map);
        layersRef.current.push(line);
      });
    }

    // Airport markers
    for (const airport of airportSet) {
      const isHub = airport.code === hub;

      const marker = L.circleMarker([airport.lat, airport.lon], {
        radius:      isHub ? 8 : 5,
        fillColor:   isHub ? '#f0c040' : '#388bfd',
        color:       isHub ? '#fff8dc' : '#6db0ff',
        weight:      isHub ? 2 : 1.5,
        fillOpacity: 1,
        zIndexOffset: isHub ? 1000 : 0,
      });

      marker.bindTooltip(
        `<div class="map-tip"><div class="map-tip-title">${airport.code}</div><div class="map-tip-sub">${airport.city}, ${airport.country}${isHub ? ' <span style="color:#f0c040">● HUB</span>' : ''}</div></div>`,
        { className: 'game-tooltip', offset: [10, 0] },
      );

      marker.addTo(map);
      layersRef.current.push(marker);

      // Code label (not shown at low zoom — Leaflet handles that via zoom)
      const label = L.marker([airport.lat, airport.lon], {
        icon: L.divIcon({
          className: 'airport-label',
          html: `<span>${airport.code}</span>`,
          iconAnchor: [-9, 4],
        }),
        interactive: false,
        zIndexOffset: 500,
      });
      label.addTo(map);
      layersRef.current.push(label);
    }

    // Fit map to show all airports (with padding)
    if (airportSet.length > 0) {
      const bounds = L.latLngBounds(airportSet.map(a => [a.lat, a.lon]));
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 5 });
    }
  }, [routeData, airportSet, hub, mapReady]); // mapReady ensures this re-runs after L.map() finishes

  if (routes.length === 0) {
    return (
      <div className="empty-state" style={{ paddingTop: 80 }}>
        <div className="empty-state-icon">🗺️</div>
        <div className="empty-state-text">No routes yet.</div>
        <div style={{ marginTop: 8, fontSize: 13 }}>Open routes to see your network on the map.</div>
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
            <span style={{ marginLeft: 10, fontSize: 12, color: 'var(--text-muted)' }}>
              {routes.length} route{routes.length !== 1 ? 's' : ''} · {airportSet.length} airports
            </span>
          </div>
          <div style={{ display: 'flex', gap: 12, fontSize: 11, color: 'var(--text-muted)', alignItems: 'center', flexWrap: 'wrap' }}>
            {/* Static legend items */}
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 18, height: 2, background: '#3fb950', display: 'inline-block', borderRadius: 1 }} />
              Profitable
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 18, height: 2, background: '#f85149', display: 'inline-block', borderRadius: 1 }} />
              Loss
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#f0c040', display: 'inline-block' }} />
              Hub
            </span>

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

        {/* Map container */}
        {error ? (
          <div style={{ height: 520, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#060b18', color: 'var(--red)', fontSize: 13 }}>
            ⚠ Could not load map: {error}
          </div>
        ) : !ready ? (
          <div style={{ height: 520, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#060b18', color: 'var(--text-muted)', fontSize: 13, gap: 10 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
            </svg>
            Loading map tiles…
          </div>
        ) : (
          <div ref={mapElRef} style={{ height: 520 }} />
        )}
      </div>

      {/* Route summary table */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '10px 20px', borderBottom: '1px solid var(--border)' }}>
          <span style={{ fontWeight: 600, fontSize: 12, textTransform: 'uppercase', letterSpacing: '.5px', color: 'var(--text-muted)' }}>
            All Routes
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
            {routeData.map(({ r, result, origin, dest }) => {
              const profit = result?.profit ?? 0;
              const lf = result?.loadFactor ?? 0;
              const isHov = hoveredId === r.id;
              return (
                <tr
                  key={r.id}
                  style={{ background: isHov ? 'var(--surface2)' : undefined, cursor: 'default' }}
                >
                  <td style={{ paddingRight: 4 }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: profit >= 0 ? 'var(--green)' : 'var(--red)' }} />
                  </td>
                  <td><strong>{r.origin} → {r.destination}</strong></td>
                  <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>{origin.city} → {dest.city}</td>
                  <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                    {result ? `${result.distance.toLocaleString()} km` : '—'}
                  </td>
                  <td>
                    {result ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{
                          fontSize: 12, fontWeight: 600,
                          color: lf > 0.7 ? 'var(--green)' : lf > 0.4 ? 'var(--yellow)' : 'var(--red)',
                        }}>
                          {(lf * 100).toFixed(0)}%
                        </span>
                        <div className="mini-bar" style={{ width: 48 }}>
                          <div className="mini-bar-fill" style={{
                            width: `${lf * 100}%`,
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
    </div>
  );
}
