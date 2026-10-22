import { useState, useMemo } from 'react';
import { useGame } from '../store/GameContext.jsx';
import { AIRPORTS, getAirport } from '../data/airports.js';
import { AIRCRAFT_TYPES, getAircraftType, aircraftOrderable } from '../data/aircraft.js';
import { distanceKm, formatMoney, currentGameDate, calendarYear, effectiveRangeKm } from '../utils/simulation.js';
import { cargoCityPairDemand, cargoReferenceYield, cargoBackhaulFactor } from '../utils/market.js';
import { cargoLaneServed, rankByDemandLeft } from '../models/routeFinder.js';
import { idleTailsOfType } from '../models/routeBatch.js';
import { Glyph } from './Icons.jsx';
import FinderDestination, { finderCellPad } from './FinderDestination.jsx';
import ServedCell from './FinderServed.jsx';
import useIsMobile from '../hooks/useIsMobile.js';
import InfoTip from './InfoTip.jsx';
import OriginPicker from './OriginPicker.jsx';
import { useSlotPosition, SlotCell, OriginSlotsLine } from './FinderSlots.jsx';
import { useRememberedState, finderMemoryKey } from '../utils/finderMemory.js';

const PAGE_SIZE = 25;
const ACCENT    = '#e8833a';

const SORT_OPTIONS = [
  { id: 'demand',   label: 'Highest demand' },
  { id: 'room',     label: 'Most demand left' },
  { id: 'revenue',  label: 'Revenue potential' },
  { id: 'shortest', label: 'Shortest distance' },
  { id: 'longest',  label: 'Longest distance' },
];

const pairKey = (a, b) => [a, b].sort().join('-');

/**
 * Cargo Route Finder — the freight sibling of the passenger RouteFinder.
 * Scans every airport pair from a chosen origin and lists unserved FREIGHT
 * lanes ordered by cargo demand (tonnes/week) or revenue potential.
 * Cargo demand is driven by trade, not tourism, so the results look very
 * different from passenger ones.
 *
 * It had fallen behind the passenger finder (VodkaOnFire, Discord 2026-10-21:
 * "Freight has some key missing features"):
 *
 *   "can't see which planes you have idle"     The freighter picker listed the
 *       catalogue, never your fleet. Your freighters now come first, with how
 *       many you own, how many sit idle and the reach of your best tail — the
 *       passenger finder's picker, row for row.
 *   "can't see/toggle routes already flown"    Lanes you fly were always
 *       hidden. They can be shown, tagged with the route you already fly.
 *   "the same 0-x% demand satisfied"           The Served column
 *       (models/routeFinder.js cargoLaneServed) and a "Most demand left" sort.
 */
export default function CargoRouteFinder({ onPick, standalone = false }) {
  // Phones get a narrower table: code-first destinations, tighter cells.
  const isMobile = useIsMobile();
  const pad = finderCellPad(isMobile);
  const { state } = useGame();
  // Free gate slots per airport, counted the way the engine's guards count them.
  const slotPosition = useSlotPosition();

  const [open, setOpen]         = useState(!!standalone);
  // Kept across the trip to the planner and back, like the passenger finder
  // (utils/finderMemory.js).
  const mem = finderMemoryKey(state, 'freight');
  const [origin, setOrigin]     = useRememberedState(mem, 'origin', state.hub || '', c => !c || !!getAirport(c));
  const [minDist, setMinDist]   = useRememberedState(mem, 'minDist', '');
  const [maxDist, setMaxDist]   = useRememberedState(mem, 'maxDist', '');
  const [rangeTypeId, setRangeTypeId] = useRememberedState(mem, 'rangeTypeId', '', id => id === '' || !!getAircraftType(id)?.freighter);
  const [showServed, setShowServed] = useRememberedState(mem, 'showServed', false);
  const [sortBy, setSortBy]     = useRememberedState(mem, 'sortBy', 'demand', v => SORT_OPTIONS.some(o => o.id === v));
  const [limit, setLimit]       = useRememberedState(mem, 'limit', PAGE_SIZE, v => Number.isFinite(v) && v > 0);

  const originAirport = getAirport(origin);
  // Freight has a season (see CARGO_SEASONAL_PROFILE) — scan on the month the
  // player would actually launch into, not an annual average they never fly.
  const gd = currentGameDate(state);

  // ── Your freighters, as the picker sees them ───────────────────────────────
  // Same shape as the passenger finder's fleetTypes: per type, how many you
  // own, how many are idle (as the shortlist counts them — reserves and tails
  // in the shop are not idle), and the reach of the longest-legged one, since
  // range mods belong to the airframe.
  const fleetTypes = useMemo(() => {
    const byType = new Map();
    for (const a of state.fleet ?? []) {
      const t = getAircraftType(a.typeId);
      if (!t?.freighter || a.status === 'retired') continue;
      const reach = Math.round(effectiveRangeKm(a, t));
      const cur = byType.get(t.id);
      if (!cur) byType.set(t.id, { type: t, count: 1, reach, idle: 0 });
      else { cur.count += 1; cur.reach = Math.max(cur.reach, reach); }
    }
    for (const f of byType.values()) f.idle = idleTailsOfType(state.fleet, f.type.id).length;
    return [...byType.values()].sort((x, y) => y.count - x.count || x.type.name.localeCompare(y.type.name));
  }, [state.fleet]);
  const catalogueTypes = useMemo(
    () => AIRCRAFT_TYPES.filter(t => t.freighter && aircraftOrderable(t, calendarYear(state))
      && !fleetTypes.some(f => f.type.id === t.id)),
    [fleetTypes, state.startYear, state.year]); // eslint-disable-line react-hooks/exhaustive-deps

  const owned        = fleetTypes.find(f => f.type.id === rangeTypeId) ?? null;
  const selectedType = rangeTypeId ? getAircraftType(rangeTypeId) : null;
  const reach = selectedType
    ? (owned?.reach ?? Math.round(effectiveRangeKm({ typeId: selectedType.id }, selectedType)))
    : Infinity;
  // Longest reach of any freighter you own (the "in fleet range" mark).
  const maxFleetRange = fleetTypes.reduce((m, f) => Math.max(m, f.reach), 0);

  // Freight lanes the player already flies (either direction), with the route.
  const servedPairs = useMemo(() => {
    const m = new Map();
    for (const r of state.cargoRoutes ?? []) {
      const k = pairKey(r.origin, r.destination);
      if (!m.has(k)) m.set(k, `${r.origin}–${r.destination}`);
    }
    return m;
  }, [state.cargoRoutes]);

  // Demand + distance + yield for every destination from the origin
  // (heavy — origin-keyed memo, only computed while the panel is open)
  const candidates = useMemo(() => {
    if (!originAirport || !open) return [];
    const out = [];
    for (const a of AIRPORTS) {
      if (a.code === originAirport.code) continue;
      const demand = cargoCityPairDemand(originAirport.code, a.code, gd.month);
      if (demand <= 0) continue; // same-metro (trucked) or unknown
      const dist     = Math.round(distanceKm(originAirport, a));
      const refYield = cargoReferenceYield(originAirport.code, a.code);
      // Lane revenue potential at reference yield: headhaul tonnes priced over
      // both directions with THIS lane's backhaul factor — the ceiling IF you
      // carried the whole pool. A scale for comparing lanes, not a promise.
      const backhaul = cargoBackhaulFactor(originAirport.code, a.code);
      const revPotential = Math.round(demand * (1 + backhaul) * dist * refYield);
      out.push({ airport: a, code: a.code, origin: originAirport.code, dist, demand, refYield, revPotential });
    }
    return out;
  }, [originAirport, open, gd.month]);

  // ── How much of each lane is already flown (models/routeFinder.js) ─────────
  // Cached until your freight network, the rivals or the month move.
  const servedCache = useMemo(
    () => new Map(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.cargoRoutes, state.fleet, state.competitors, state.week, gd.month, origin]);
  const servedOf = (r) => {
    if (!servedCache.has(r.code)) servedCache.set(r.code, cargoLaneServed(state, r.origin, r.code, { gameDate: gd }));
    return servedCache.get(r.code);
  };

  // Apply filters + sort
  const filtered = useMemo(() => {
    const lo = parseInt(minDist, 10) || 0;
    const hi = parseInt(maxDist, 10) || Infinity;
    const out = [];
    for (const c of candidates) {
      if (c.dist < lo || c.dist > hi || c.dist > reach) continue;
      const flown = servedPairs.get(pairKey(origin, c.code)) ?? null;
      if (flown && !showServed) continue;
      out.push(flown ? { ...c, flown } : c);
    }
    return out;
  }, [candidates, minDist, maxDist, reach, origin, servedPairs, showServed]);

  const results = useMemo(() => {
    if (sortBy === 'room') return rankByDemandLeft(filtered, servedOf, limit);
    return [...filtered].sort((x, y) =>
      sortBy === 'shortest' ? x.dist - y.dist :
      sortBy === 'longest'  ? y.dist - x.dist :
      sortBy === 'revenue'  ? y.revPotential - x.revPotential :
      y.demand - x.demand
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, sortBy, sortBy === 'room' ? limit : 0, servedCache]);

  const shown = results.slice(0, limit);

  function resetPaging() { setLimit(PAGE_SIZE); }

  return (
    <div className="card" style={{ marginBottom: 12, borderLeft: `3px solid ${ACCENT}` }}>
      {/* Header / toggle */}
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: standalone ? 'default' : 'pointer' }}
        onClick={standalone ? undefined : () => setOpen(v => !v)}
      >
        <span style={{ fontSize: 16 }}><Glyph e="🔍" /></span>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>
            Cargo Route Finder
            <InfoTip text="Scans every airport reachable from a chosen origin and lists freight lanes you don't serve yet, ordered by cargo demand, demand left or revenue potential. Set a distance band, or pick a freighter to search only what its range can reach — yours come first, with how many sit idle. Looking commits nothing — Plan hands a lane to the freight planner only if you want it." />
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Discover unserved freight lanes by tonnage from any airport
          </div>
        </div>
        {!standalone && <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>{open ? '▴ Hide' : '▾ Show'}</span>}
      </div>

      {open && (
        <div style={{ marginTop: 14 }}>
          {/* Controls */}
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 10 }}>

            {/* Origin — your own network first (components/OriginPicker.jsx) */}
            <OriginPicker
              value={origin}
              accent={ACCENT}
              onChange={code => { setOrigin(code); resetPaging(); }}
            />

            {/* Freighter — your fleet first, catalogue after */}
            <div>
              <div className="form-label" style={{ marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                Freighter
                <InfoTip text="Pick a freighter and the search keeps to lanes it can reach. Freighters you own come first, with how many you have, how many are idle, and the range of your best-equipped tail rather than the catalogue figure." />
              </div>
              <select
                className="form-select"
                value={rangeTypeId}
                onChange={e => { setRangeTypeId(e.target.value); resetPaging(); }}
                style={{ width: 260 }}
              >
                <option value="">Any freighter — any distance</option>
                {fleetTypes.length > 0 && (
                  <optgroup label="In your fleet">
                    {fleetTypes.map(f => (
                      <option key={f.type.id} value={f.type.id}>
                        {f.type.name} — {f.count} owned{f.idle > 0 ? ` · ${f.idle} idle` : ''} · {f.reach.toLocaleString()} km
                      </option>
                    ))}
                  </optgroup>
                )}
                <optgroup label="Not in your fleet">
                  {catalogueTypes.map(t => (
                    <option key={t.id} value={t.id}>{t.name} — {t.range.toLocaleString()} km</option>
                  ))}
                </optgroup>
              </select>
              {selectedType && (
                <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 3 }}>
                  {reach.toLocaleString()} km · {selectedType.payloadTonnes}t payload
                  {owned ? '' : ' · lease required'}
                </div>
              )}
            </div>

            {/* Distance band */}
            <div>
              <div className="form-label" style={{ marginBottom: 6 }}>Distance (km)</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input
                  type="number" min={0} placeholder="min" value={minDist}
                  onChange={e => { setMinDist(e.target.value); resetPaging(); }}
                  className="form-input" style={{ width: 80, textAlign: 'center' }}
                />
                <span style={{ color: 'var(--text-dim)' }}>–</span>
                <input
                  type="number" min={0} placeholder="max" value={maxDist}
                  onChange={e => { setMaxDist(e.target.value); resetPaging(); }}
                  className="form-input" style={{ width: 80, textAlign: 'center' }}
                />
              </div>
            </div>

            {/* Sort */}
            <div>
              <div className="form-label" style={{ marginBottom: 6 }}>Sort by</div>
              <select
                className="form-select"
                value={sortBy}
                onChange={e => { setSortBy(e.target.value); resetPaging(); }}
                style={{ width: 170 }}
              >
                {SORT_OPTIONS.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
            </div>
          </div>

          {/* Filter toggles */}
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12, fontSize: 12, color: 'var(--text-muted)' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}
                   title="Lanes you already fly freight on are hidden by default. Show them to see how much of each is left — the Served column counts your own freighters too.">
              <input type="checkbox" data-show-served="" checked={showServed} onChange={e => { setShowServed(e.target.checked); resetPaging(); }} style={{ accentColor: ACCENT }} />
              Show lanes I already serve
            </label>
          </div>

          {/* Results */}
          {!originAirport ? (
            <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '12px 0' }}>
              Choose an origin airport to search from.
            </div>
          ) : results.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '12px 0' }}>
              No {showServed ? '' : 'unserved '}freight lanes match these filters.
              {selectedType && <> Nothing else is within the {selectedType.name}'s {reach.toLocaleString()} km — try “Any freighter”.</>}
            </div>
          ) : (
            <>
              <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 6 }}>
                {results.length.toLocaleString()} {showServed ? '' : 'unserved '}lane{results.length !== 1 ? 's' : ''} from {originAirport.code} · showing {shown.length}
                {selectedType && <> · within {reach.toLocaleString()} km</>}
                {owned && owned.idle > 0 && (
                  <> · <span style={{ color: 'var(--yellow)' }}>{owned.idle} idle {selectedType.name}{owned.idle !== 1 ? 's' : ''}</span></>
                )}
              </div>
              <OriginSlotsLine code={originAirport.code} freq={7} position={slotPosition} />
              <div style={{ overflowX: 'auto', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: 'var(--surface2)' }}>
                      {[
                        { h: 'Destination' },
                        { h: 'Distance',      right: true },
                        { h: 'Cargo Demand',  right: true },
                        { h: 'Served',        right: true, tip: "How much of the lane's weekly freight is already flown — your freighters (the freight table's own figure) and any rival's, at maturity, this month. Low is room for you; near 100% means a new freighter mostly splits the tonnage already there. Hover a figure for who carries what." },
                        { h: 'Ref Yield',     right: true },
                        { h: '≈ Rate',        right: true },
                        { h: 'Rev Potential', right: true },
                        { h: 'Your slots',    right: true },
                        { h: '',              right: false },
                      ].map((c, i) => (
                        <th key={i} style={{ padding: pad, textAlign: c.right ? 'right' : 'left', color: 'var(--text-muted)', fontWeight: 600, whiteSpace: 'nowrap' }}>
                          {c.h}{c.tip && <InfoTip text={c.tip} />}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map(r => {
                      const { airport: a, dist, demand, refYield, revPotential } = r;
                      const inRange = maxFleetRange >= dist;
                      return (
                        <tr key={a.code} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                          <td style={{ padding: pad }}>
                            <FinderDestination
                              airport={a}
                              compact={isMobile}
                              badges={[
                                r.flown && {
                                  text: `you fly ${r.flown}`,
                                  short: 'flown',
                                  title: `You already fly freight on this lane (${r.flown}). Another freighter here shares the lane's one pool of tonnage with it.`,
                                  tone: 'yellow',
                                },
                              ]}
                            >
                              {inRange && maxFleetRange > 0 && (
                                <span title="Within range of a freighter in your fleet" style={{ marginLeft: 6, fontSize: 11, color: 'var(--green)' }}><Glyph e="✈" /></span>
                              )}
                            </FinderDestination>
                          </td>
                          <td style={{ padding: pad, textAlign: 'right', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{dist.toLocaleString()} km</td>
                          <td style={{ padding: pad, textAlign: 'right', fontWeight: 700, color: ACCENT, whiteSpace: 'nowrap' }}>{demand.toLocaleString()} t<span style={{ fontWeight: 400, fontSize: 10, color: 'var(--text-dim)' }}> /wk</span></td>
                          <td style={{ padding: pad, textAlign: 'right' }}>
                            <ServedCell served={r.served ?? servedOf(r)} cargo />
                          </td>
                          <td style={{ padding: pad, textAlign: 'right', color: 'var(--text-muted)' }}>${refYield.toFixed(3)}</td>
                          <td style={{ padding: pad, textAlign: 'right', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>${(refYield * dist / 1000).toFixed(2)}/kg</td>
                          <td style={{ padding: pad, textAlign: 'right', color: 'var(--green)', whiteSpace: 'nowrap' }} title="Weekly lane revenue at reference yield IF you carried the whole pool — a comparison scale, not a promise">{formatMoney(revPotential)}</td>
                          <td style={{ padding: pad, textAlign: 'right' }}>
                            <SlotCell code={a.code} freq={7} position={slotPosition} />
                          </td>
                          <td style={{ padding: pad, textAlign: 'right' }}>
                            {onPick && (
                              <button
                                className="btn btn-ghost"
                                style={{ padding: '3px 10px', fontSize: 12, color: ACCENT }}
                                title={`Take ${origin} → ${a.code} to the freight planner — nothing is booked until you open the route there`}
                                onClick={() => onPick(origin, a.code, rangeTypeId || undefined)}
                              >
                                Plan →
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {results.length > shown.length && (
                <button
                  className="btn btn-ghost"
                  style={{ marginTop: 8, padding: '5px 14px', fontSize: 12 }}
                  onClick={() => setLimit(l => l + PAGE_SIZE)}
                >
                  Show {Math.min(PAGE_SIZE, results.length - shown.length)} more
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
