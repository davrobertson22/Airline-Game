import { useState, useMemo } from 'react';
import { useGame, cargoFrequencyChangeBlockReason } from '../store/GameContext.jsx';
import { useConfirm } from './ConfirmModal.jsx';
import AirportLink from './AirportLink.jsx';
import { getAircraftType } from '../data/aircraft.js';
import { getAirport } from '../data/airports.js';
import { groundedTitle } from '../data/maintenance.js';
import { simulateCargoRoute, simulateCargoNetwork, bellyPoolFactorOf, formatMoney, formatPercent, currentGameDate } from '../utils/simulation.js';
import { Glyph, GlyphLabel } from './Icons.jsx';
import { connectingFreightTitle } from '../utils/connectingFreight.js';
import OutOfRangeBadge from './OutOfRangeBadge.jsx';
import { useToast } from './ToastSystem.jsx';
import NumberStepper from './NumberStepper.jsx';
import RouteFrequencyControls from './FrequencyControls.jsx';
import { cargoReferenceYield } from '../utils/market.js';
import { planCargoYields, cargoYieldBatches, CARGO_BULK_PCT_MIN, CARGO_BULK_PCT_MAX } from '../models/cargoYieldBulk.js';
import { cargoRivalsOnLane } from '../models/competitorCargo.js';

const ACCENT = '#e8833a';
const CARGO_PAGE_SIZE = 60;

// ─── Freight badge (exported for reuse on passenger cards too) ──────────────────

export function FreightBadge() {
  return (
    <span style={{ background: `${ACCENT}22`, color: ACCENT, border: `1px solid ${ACCENT}55`, borderRadius: 4, padding: '2px 7px', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>
      <Glyph e="📦" /> Freight
    </span>
  );
}

export function PassengerBadge() {
  return (
    <span style={{ background: 'rgba(56,139,253,0.15)', color: 'var(--accent)', border: '1px solid rgba(56,139,253,0.4)', borderRadius: 4, padding: '2px 7px', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>
      <Glyph e="🧍" /> Passenger
    </span>
  );
}

// ─── Cargo routes list ──────────────────────────────────────────────────────────

/**
 * Freight routes, as either a compact sortable table (default on desktop) or the
 * roomier cards (default on phones). Table rows expand to reveal the same
 * frequency / yield / close-route controls the cards show inline.
 *
 * @param {string}   airportFilter  'all' | airport code — only routes touching this airport
 * @param {boolean}  hideViewToggle suppress the Table/Cards switch (when the parent owns it)
 * @param {function} [onAddFreighter] (origin, destination) — the parent opens its
 *                   freight planner on that lane. Without it the "+ Add Freighter"
 *                   control is not rendered, so an embedder that has no planner to
 *                   open never shows a button that does nothing.
 */
export default function CargoRoutesList({ airportFilter = 'all', hideViewToggle = false, onAddFreighter }) {
  const { state, dispatch } = useGame();
  const confirm = useConfirm();
  const addToast = useToast();
  const { cargoRoutes = [], fleet } = state;
  const gd = currentGameDate(state);

  // View mode mirrors the passenger table: phones get the touch-friendly cards,
  // desktop gets the compact sortable table.
  const [viewMode, setViewMode] = useState(() => {
    try { return window.matchMedia('(max-width: 640px)').matches ? 'cards' : 'table'; }
    catch { return 'table'; }
  });
  // Mass pricing: routes ticked for the selection bar, and the load-factor
  // modal behind the summary bar's Bulk Pricing button.
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [showBulk, setShowBulk] = useState(false);

  const allRows = useMemo(() => {
    // Same-lane pooling: mirror the weekly tick so the list shows each route's
    // SHARE of a shared lane, not N copies of the full market.
    // The whole network in one pass (the tick's own simulateCargoNetwork), so
    // freight connecting through your airports shows on the legs that carry it.
    const net   = simulateCargoNetwork(cargoRoutes, fleet, { gameDate: gd, competitors: state.competitors,
      bellyPoolFactor: bellyPoolFactorOf(state, gd) });
    const alloc = net.allocations;
    return cargoRoutes.map(route => {
      const aircraft = fleet.find(a => a.id === route.aircraftId);
      const type     = aircraft ? getAircraftType(aircraft.typeId) : null;
      // A tail in a check flies nothing this week; the row still shows what the
      // route earns when it is back, as before.
      const sim      = net.results.get(route.id)
        ?? (aircraft ? simulateCargoRoute(route, aircraft, gd, null, 1.0, 1.0, alloc.get(route.id) ?? null) : null);
      // "Shared lane" is about YOUR freighters sharing a pool; a lane a rival
      // contests gets an allocation too, but that's the rivals chip below.
      return { route, aircraft, type, sim,
               pooled: (alloc.get(route.id)?.laneRoutes ?? 0) >= 2,
               rivals: cargoRivalsOnLane(state.competitors, route.origin, route.destination) };
    });
  }, [cargoRoutes, fleet, gd, state.competitors]);

  // Scope to the airport filter, then sort by profit descending (the old card order).
  const rows = useMemo(() => {
    const scoped = airportFilter === 'all'
      ? allRows
      : allRows.filter(({ route }) => route.origin === airportFilter || route.destination === airportFilter);
    return [...scoped].sort((a, b) => (b.sim?.profit ?? -Infinity) - (a.sim?.profit ?? -Infinity));
  }, [allRows, airportFilter]);

  if (cargoRoutes.length === 0) {
    return (
      <div className="empty-state" style={{ marginTop: 8 }}>
        <div className="empty-state-icon"><Glyph e="📦" /></div>
        <div className="empty-state-text">No cargo routes yet.</div>
        <div style={{ marginTop: 8, fontSize: 13, color: 'var(--text-muted)' }}>
          Buy a freighter from the Market, then click <strong><Glyph e="📦" /> Open Freight Route</strong> above (or use the Route Planner in Freight mode).
        </div>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="empty-state" style={{ marginTop: 8 }}>
        <div className="empty-state-icon"><Glyph e="🔍" /></div>
        <div className="empty-state-text">No cargo routes touch {airportFilter}</div>
        <div style={{ marginTop: 8, fontSize: 13, color: 'var(--text-muted)' }}>
          {cargoRoutes.length} freight route{cargoRoutes.length !== 1 ? 's' : ''} elsewhere in the network.
        </div>
      </div>
    );
  }

  // Typed or stepped values from the NumberStepper — already clamped and
  // run through the engine guard, so these just dispatch.
  function setFreq(route, n) {
    dispatch({ type: 'UPDATE_CARGO_FREQUENCY', routeId: route.id, weeklyFrequency: n });
  }
  function setYield(route, y) {
    dispatch({ type: 'UPDATE_CARGO_YIELD', routeId: route.id, yieldPrice: Math.max(0.01, +y.toFixed(3)) });
  }
  // Many freighters at once: one BULK_SET_CARGO_YIELD per batch
  // (models/cargoYieldBulk.js), never one dispatch per freighter.
  function applyYieldToRows(rowsToPrice, change) {
    const ids = rowsToPrice.map(r => r.route.id);
    const plan = planCargoYields(state, ids, change);
    if (plan.changed === 0) return;
    for (const batch of cargoYieldBatches(ids)) {
      dispatch({ type: 'BULK_SET_CARGO_YIELD', routeIds: batch, mode: change.mode, value: change.value });
    }
    addToast({
      type: 'success',
      title: change.mode === 'reference' ? 'Freight back to the going rate' : 'Freight repriced',
      message: `${plan.changed} cargo route${plan.changed !== 1 ? 's' : ''}`
        + (change.mode === 'pct' ? ` · ${change.value > 0 ? '+' : ''}${change.value}%` : ''),
    });
  }
  async function closeRows(rowsToClose) {
    const n = rowsToClose.length;
    if (!(await confirm({
      title: `Close ${n} cargo route${n !== 1 ? 's' : ''}?`,
      body: `${n} freighter${n !== 1 ? 's' : ''} return${n === 1 ? 's' : ''} to idle.`,
      danger: true, confirmLabel: `Close ${n} route${n !== 1 ? 's' : ''}`,
    }))) return;
    for (const { route } of rowsToClose) dispatch({ type: 'CLOSE_CARGO_ROUTE', routeId: route.id });
    setSelectedIds(new Set());
  }
  function toggleSelect(id) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
  function setManySelected(ids, on) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      for (const id of ids) on ? next.add(id) : next.delete(id);
      return next;
    });
  }
  async function close(route) {
    if (await confirm({ title: `Close cargo route ${route.origin} → ${route.destination}?`, body: 'The freighter returns to idle.', danger: true, confirmLabel: 'Close route' })) {
      dispatch({ type: 'CLOSE_CARGO_ROUTE', routeId: route.id });
    }
  }

  // Ticked routes that still exist (a closed route drops out of the selection).
  const selectedRows = rows.filter(r => selectedIds.has(r.route.id));
  const selection = { has: (id) => selectedIds.has(id), toggle: toggleSelect, setMany: setManySelected };
  const controls = { setFreq, setYield, close, state, onAddFreighter, selection };

  const totalRev    = rows.reduce((s, r) => s + (r.sim?.revenue ?? 0), 0);
  const totalProfit = rows.reduce((s, r) => s + (r.sim?.profit ?? 0), 0);
  const totalTonnes = rows.reduce((s, r) => s + (r.sim?.tonnes ?? 0), 0);
  const totalConnRev = rows.reduce((s, r) => s + (r.sim?.connectingRevenue ?? 0), 0);

  return (
    <div>
      {/* Summary bar */}
      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginBottom: 14, padding: '10px 14px', background: 'var(--surface2)', borderRadius: 'var(--radius)', border: `1px solid ${ACCENT}33`, alignItems: 'center' }}>
        <div>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.4 }}>Cargo routes</span>
          <div style={{ fontWeight: 700, fontSize: 15 }}>
            {rows.length}
            {rows.length !== cargoRoutes.length && (
              <span style={{ fontSize: 11, color: 'var(--text-dim)', fontWeight: 400 }}> of {cargoRoutes.length}</span>
            )}
          </div>
        </div>
        <div><span style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.4 }}>Tonnes / wk</span><div style={{ fontWeight: 700, fontSize: 15, color: ACCENT }}>{totalTonnes.toLocaleString()}</div></div>
        <div><span style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.4 }}>Freight revenue</span><div style={{ fontWeight: 700, fontSize: 15, color: 'var(--green)' }}>{formatMoney(totalRev)}</div></div>
        {totalConnRev > 0 && (
          <div title="Freight connecting between two of your freighter routes at an airport they share — it fills payload the local freight leaves empty">
            <span style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.4 }}>of which connecting</span>
            <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--green)' }}>{formatMoney(totalConnRev)}</div>
          </div>
        )}
        <div><span style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.4 }}>Var. profit / wk</span><div style={{ fontWeight: 700, fontSize: 15, color: totalProfit >= 0 ? 'var(--green)' : 'var(--red)' }}>{(totalProfit >= 0 ? '+' : '') + formatMoney(totalProfit)}</div></div>
        <button
          className="btn btn-ghost"
          style={{ marginLeft: 'auto', fontSize: 12, padding: '4px 10px' }}
          onClick={() => setShowBulk(true)}
          title="Reprice many cargo routes at once, filtered by load factor"
        >
          <GlyphLabel size={12} text="⚖️ Bulk Pricing" />
        </button>
        {!hideViewToggle && (
          <div style={{ display: 'flex', gap: 2, background: 'var(--surface)', borderRadius: 'var(--radius)', padding: 2 }}>
            {[{ id: 'table', label: '⊟ Table' }, { id: 'cards', label: '⊞ Cards' }].map(v => (
              <button
                key={v.id}
                className={`btn ${viewMode === v.id ? 'btn-primary' : 'btn-ghost'}`}
                style={{ fontSize: 12, padding: '4px 10px', ...(viewMode === v.id ? { background: ACCENT, borderColor: ACCENT } : null) }}
                onClick={() => setViewMode(v.id)}
              >
                {v.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {selectedRows.length > 0 && (
        <CargoSelectionBar
          rows={selectedRows}
          onApplyYield={applyYieldToRows}
          onCloseRows={closeRows}
          onClear={() => setSelectedIds(new Set())}
        />
      )}

      {viewMode === 'cards' && rows.length > 1 && (
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-muted)', marginBottom: 8, cursor: 'pointer' }}>
          <input
            type="checkbox"
            style={{ accentColor: ACCENT }}
            checked={rows.every(r => selectedIds.has(r.route.id))}
            onChange={e => setManySelected(rows.map(r => r.route.id), e.target.checked)}
          />
          Select all {rows.length} routes
        </label>
      )}

      {viewMode === 'table'
        ? <CargoTable rows={rows} controls={controls} />
        : rows.map(r => <CargoRouteCard key={r.route.id} {...r} controls={controls} />)}

      {showBulk && (
        <CargoBulkPricingModal
          allRows={rows}
          onApply={applyYieldToRows}
          onClose={() => setShowBulk(false)}
        />
      )}
    </div>
  );
}

// ─── Connecting freight on a leg ────────────────────────────────────────────────
// Freight between two of your OTHER airports that rides this leg through an
// airport where your freighter routes meet (simulateCargoNetwork). The tooltip
// lists the markets, biggest first.
export function ConnectingFreightChip({ sim, style }) {
  if (!(sim?.connectingTonnes > 0)) return null;
  return (
    <span
      style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3, background: 'rgba(63,185,80,0.12)', color: 'var(--green)', border: '1px solid rgba(63,185,80,0.35)', textTransform: 'uppercase', letterSpacing: '.04em', ...style }}
      title={connectingFreightTitle(sim)}
    >
      <Glyph e="🔗" /> +{sim.connectingTonnes.toLocaleString()} t connecting
    </span>
  );
}

// ─── Rival freighters on a lane ─────────────────────────────────────────────────

function rivalsTitle(rivals) {
  return 'Rival freighters on this lane take their share of its freight, more of it the more they lift and the cheaper they price:\n'
    + rivals.map(r => `${r.name}: ${r.tonnesPerWeek.toLocaleString()} t/wk${r.frequency ? `, ${r.frequency}×/wk` : ''}`
      + `${r.aircraftType ? ` (${getAircraftType(r.aircraftType)?.name ?? r.aircraftType})` : ''}`
      + `${r.yieldPrice != null ? ` at $${r.yieldPrice.toFixed(3)}/t-km` : ''}`).join('\n');
}

/** Chip on a freight lane a rival also flies. */
export function CargoRivalsChip({ rivals, style }) {
  if (!rivals?.length) return null;
  return (
    <span
      style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3, background: 'rgba(251,191,36,0.12)', color: 'var(--yellow)', border: '1px solid rgba(251,191,36,0.35)', textTransform: 'uppercase', letterSpacing: '.04em', ...style }}
      title={rivalsTitle(rivals)}
    >
      <Glyph e="⚔" /> {rivals.length === 1 ? rivals[0].name : `${rivals.length} rivals`}
    </span>
  );
}

/** One line naming who else flies the lane, for the expanded row and the card. */
function CargoRivalsLine({ rivals }) {
  if (!rivals?.length) return null;
  return (
    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>
      <Glyph e="⚔" /> Competing for this freight: {rivals.map(r =>
        `${r.name} (${r.tonnesPerWeek.toLocaleString()} t/wk${r.yieldPrice != null ? ` at $${r.yieldPrice.toFixed(3)}` : ''})`).join(' · ')}
    </div>
  );
}

// ─── Table view ────────────────────────────────────────────────────────────────

const CARGO_COLUMNS = [
  { id: 'route',  label: 'Route',        align: 'left'  },
  { id: 'dist',   label: 'Distance',     align: 'right' },
  { id: 'freq',   label: 'Freq',         align: 'right' },
  { id: 'load',   label: 'Load',         align: 'right' },
  { id: 'tonnes', label: 'Tonnes/wk',    align: 'right' },
  { id: 'yield',  label: 'Yield $/t-km', align: 'right' },
  { id: 'rev',    label: 'Revenue',      align: 'right' },
  { id: 'profit', label: 'Var. profit',  align: 'right' },
];

const CARGO_SORTERS = {
  route:  (a, b) => `${a.route.origin}${a.route.destination}`.localeCompare(`${b.route.origin}${b.route.destination}`),
  dist:   (a, b) => (a.sim?.distance ?? 0)         - (b.sim?.distance ?? 0),
  freq:   (a, b) => (a.route.weeklyFrequency ?? 0) - (b.route.weeklyFrequency ?? 0),
  load:   (a, b) => (a.sim?.loadFactor ?? 0)       - (b.sim?.loadFactor ?? 0),
  tonnes: (a, b) => (a.sim?.tonnes ?? 0)           - (b.sim?.tonnes ?? 0),
  yield:  (a, b) => (a.route.yieldPrice ?? 0)      - (b.route.yieldPrice ?? 0),
  rev:    (a, b) => (a.sim?.revenue ?? 0)          - (b.sim?.revenue ?? 0),
  profit: (a, b) => (a.sim?.profit ?? 0)           - (b.sim?.profit ?? 0),
};

function CargoTable({ rows, controls }) {
  const [sortCol, setSortCol] = useState('profit');
  const [sortDir, setSortDir] = useState('desc');   // 'asc' | 'desc'
  const [shown,   setShown]   = useState(CARGO_PAGE_SIZE);
  const [expandedIds, setExpandedIds] = useState(() => new Set());

  const sorted = useMemo(() => {
    const cmp = CARGO_SORTERS[sortCol] ?? CARGO_SORTERS.profit;
    const s = [...rows].sort(cmp);
    if (sortDir === 'desc') s.reverse();
    return s;
  }, [rows, sortCol, sortDir]);

  const visible = sorted.slice(0, shown);
  const { selection } = controls;
  const allSelected  = rows.length > 0 && rows.every(r => selection.has(r.route.id));
  const someSelected = rows.some(r => selection.has(r.route.id));

  function clickHeader(colId) {
    if (sortCol === colId) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortCol(colId); setSortDir(colId === 'route' ? 'asc' : 'desc'); }
  }

  function toggleExpand(id) {
    setExpandedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  const COL_HEADER = {
    padding: '6px 10px', textAlign: 'left', color: 'var(--text-muted)', fontWeight: 600,
    fontSize: 11, whiteSpace: 'nowrap', textTransform: 'uppercase', letterSpacing: '0.04em',
    borderBottom: '1px solid var(--border)', cursor: 'pointer', userSelect: 'none',
  };

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden', borderLeft: `3px solid ${ACCENT}` }}>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr>
              <th style={{ ...COL_HEADER, cursor: 'default', width: 28, paddingRight: 0 }}>
                <input
                  type="checkbox"
                  data-cargo-select-all=""
                  style={{ accentColor: ACCENT, cursor: 'pointer' }}
                  checked={allSelected}
                  ref={el => { if (el) el.indeterminate = someSelected && !allSelected; }}
                  onChange={e => selection.setMany(rows.map(r => r.route.id), e.target.checked)}
                  title={allSelected ? 'Deselect all' : `Select all ${rows.length} routes for bulk pricing`}
                />
              </th>
              {CARGO_COLUMNS.map(c => (
                <th
                  key={c.id}
                  style={{ ...COL_HEADER, textAlign: c.align }}
                  onClick={() => clickHeader(c.id)}
                  title="Click to sort"
                >
                  {c.label}
                  {sortCol === c.id && (
                    <span style={{ marginLeft: 4, color: ACCENT }}>{sortDir === 'desc' ? '▾' : '▴'}</span>
                  )}
                </th>
              ))}
              <th style={{ ...COL_HEADER, cursor: 'default', width: 30 }}></th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r, i) => (
              <CargoTableRow
                key={r.route.id}
                row={r}
                zebra={i % 2 === 1}
                expanded={expandedIds.has(r.route.id)}
                onToggleExpand={() => toggleExpand(r.route.id)}
                controls={controls}
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* Incremental paging keeps the DOM small with very large freight networks */}
      {sorted.length > shown && (
        <div style={{ padding: '10px 14px', textAlign: 'center', borderTop: '1px solid var(--border)' }}>
          <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => setShown(s => s + CARGO_PAGE_SIZE)}>
            Show {Math.min(CARGO_PAGE_SIZE, sorted.length - shown)} more ({shown} of {sorted.length})
          </button>
        </div>
      )}
    </div>
  );
}

function CargoTableRow({ row, zebra, expanded, onToggleExpand, controls }) {
  const { route, aircraft, type, sim, pooled, rivals } = row;
  const oa = getAirport(route.origin);
  const da = getAirport(route.destination);

  const lf = sim?.loadFactor ?? 0;
  const lfColor   = lf >= 0.75 ? 'var(--green)' : lf >= 0.45 ? 'var(--yellow)' : 'var(--red)';
  const profColor = (sim?.profit ?? 0) >= 0 ? 'var(--green)' : 'var(--red)';

  const CELL  = { padding: '7px 10px' };
  const RIGHT = { ...CELL, textAlign: 'right' };

  return (
    <>
      <tr
        style={{
          borderBottom: expanded ? 'none' : '1px solid var(--border-subtle)',
          background: expanded ? 'var(--surface2)' : zebra ? 'var(--surface2)' : undefined,
          cursor: 'pointer',
        }}
        onClick={onToggleExpand}
      >
        <td style={{ padding: '0 0 0 10px', width: 28 }} onClick={e => e.stopPropagation()}>
          <input
            type="checkbox"
            data-cargo-select={route.id}
            style={{ accentColor: ACCENT, cursor: 'pointer' }}
            checked={controls.selection.has(route.id)}
            onChange={() => controls.selection.toggle(route.id)}
            title="Select this route for bulk pricing"
          />
        </td>
        <td style={{ ...CELL, whiteSpace: 'nowrap' }}>
          <span style={{ fontWeight: 700, fontFamily: 'monospace', fontSize: 13, color: ACCENT }}>
            {route.origin} → {route.destination}
          </span>
          <span style={{ color: 'var(--text-muted)', marginLeft: 8, fontSize: 11 }}>
            {oa?.city} → {da?.city}
          </span>
          {aircraft?.status === 'grounded' && (
            <span
              style={{ marginLeft: 6, fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3, background: 'rgba(248,81,73,0.15)', color: 'var(--red)', border: '1px solid rgba(248,81,73,0.3)', textTransform: 'uppercase' }}
              title={groundedTitle(aircraft)}
            >
              <Glyph e="🔧" /> {aircraft.groundedWeeksLeft}w
            </span>
          )}
          <OutOfRangeBadge route={route} style={{ marginLeft: 6 }} />
          {!aircraft && (
            <span style={{ marginLeft: 6, fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3, background: 'rgba(248,81,73,0.15)', color: 'var(--red)', border: '1px solid rgba(248,81,73,0.3)', textTransform: 'uppercase' }}>
              No freighter
            </span>
          )}
          {pooled && (
            <span
              style={{ marginLeft: 6, fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3, background: `${ACCENT}18`, color: ACCENT, border: `1px solid ${ACCENT}44`, textTransform: 'uppercase' }}
              title="Several of your freighters fly this lane — they share one demand pool, so this route's tonnage is its share of the market, not the full market"
            >
              <Glyph e="⚖" /> Shared lane
            </span>
          )}
          <CargoRivalsChip rivals={rivals} style={{ marginLeft: 6 }} />
          <ConnectingFreightChip sim={sim} style={{ marginLeft: 6 }} />
        </td>
        <td style={{ ...RIGHT, color: 'var(--text-muted)' }}>{sim ? `${sim.distance.toLocaleString()} km` : '—'}</td>
        <td style={RIGHT}>{route.weeklyFrequency}×</td>
        <td style={{ ...RIGHT, fontWeight: 700, color: lfColor }}>{sim ? formatPercent(lf) : '—'}</td>
        <td style={{ ...RIGHT, fontWeight: 700, color: ACCENT }}>{sim ? sim.tonnes.toLocaleString() : '—'}</td>
        {/* Yield, editable where it is shown ("the feature to edit the prices on a
            route after you've created it is also missing", Dunno23, Discord
            2026-11-05: it lived behind a row you had to open first). */}
        <td style={{ ...RIGHT, color: 'var(--text-muted)' }} onClick={e => e.stopPropagation()} data-cargo-yield-cell="">
          <span style={{ display: 'inline-flex', justifyContent: 'flex-end' }}>
            <NumberStepper
              size="sm"
              value={+route.yieldPrice.toFixed(3)}
              min={0.01}
              step={0.02}
              decimals={3}
              inputWidth={50}
              onChange={y => controls.setYield(route, y)}
              ariaLabel={`yield, ${route.origin} to ${route.destination}`}
              decTitle="Lower by $0.02"
              incTitle="Raise by $0.02"
            />
          </span>
        </td>
        <td style={{ ...RIGHT, fontWeight: 600, color: 'var(--green)' }}>{sim ? `+${formatMoney(sim.revenue)}` : '—'}</td>
        <td style={{ ...RIGHT, fontWeight: 700, color: profColor }}>
          {sim ? `${sim.profit >= 0 ? '+' : ''}${formatMoney(sim.profit)}` : '—'}
        </td>
        <td style={{ ...CELL, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
          {expanded ? '▴' : '▾'}
        </td>
      </tr>
      {expanded && (
        <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface2)' }}>
          <td colSpan={CARGO_COLUMNS.length + 2} style={{ padding: '0 14px 12px' }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '4px 0 10px' }}>
              {aircraft ? `${aircraft.name}${aircraft.tailNumber ? ` · ${aircraft.tailNumber}` : ''}` : <GlyphLabel size={12} text="⚠ no freighter assigned" />}
              {type && ` · ${type.payloadTonnes}t payload`}
              <CargoRivalsLine rivals={rivals} />
            </div>
            <CargoRouteControls route={route} sim={sim} controls={controls} />
          </td>
        </tr>
      )}
    </>
  );
}

// ─── Shared controls (used by both the expanded table row and the card view) ────

function CargoRouteControls({ route, sim, controls }) {
  const { setFreq, setYield, close, state, onAddFreighter } = controls;
  const perKg = (route.yieldPrice * (sim?.distance ?? 0) / 1000);

  return (
    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Flights/wk</span>
        <NumberStepper
          size="sm"
          value={route.weeklyFrequency}
          min={1}
          max={99}
          onChange={n => setFreq(route, n)}
          blockReason={n => cargoFrequencyChangeBlockReason(state, route.id, n)}
          blockedTitle="Can’t add a flight"
          ariaLabel={`flights per week, ${route.origin} to ${route.destination}`}
          decTitle={route.weeklyFrequency > 1 ? 'One fewer flight per week' : 'At the minimum. Use Close route to stand the freighter down'}
          incTitle="One more flight per week"
        />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Yield $/t-km</span>
        <NumberStepper
          size="sm"
          value={+route.yieldPrice.toFixed(3)}
          min={0.01}
          step={0.02}
          decimals={3}
          inputWidth={50}
          onChange={y => setYield(route, y)}
          ariaLabel={`yield, ${route.origin} to ${route.destination}`}
          decTitle="Lower by $0.02"
          incTitle="Raise by $0.02"
        />
        <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>≈ ${perKg.toFixed(2)}/kg</span>
      </div>
      {/* One freighter is one freighter. The only way to put a second one on a
          lane you already fly used to be the planner on the other side of the
          page — the frequency stepper caps out at this airframe's block hours,
          and then the lane is simply full (Knightmare, Discord 2026-08-26). */}
      {onAddFreighter && (
        <button
          className="btn btn-ghost"
          style={{ marginLeft: 'auto', fontSize: 12, color: ACCENT }}
          title={`Open the freight planner on ${route.origin} → ${route.destination}`}
          onClick={() => onAddFreighter(route.origin, route.destination)}
        >+ Add Freighter</button>
      )}
      <button className="btn btn-ghost" style={{ marginLeft: onAddFreighter ? 0 : 'auto', color: 'var(--red)', fontSize: 12 }} onClick={() => close(route)}>Close route</button>
    </div>
  );
}

// ─── Card view (same layout as before, sharing the controls with the table) ─────

function CargoRouteCard({ route, aircraft, type, sim, pooled, rivals, controls }) {
  const lf = sim?.loadFactor ?? 0;
  const lfColor = lf >= 0.75 ? 'var(--green)' : lf >= 0.45 ? 'var(--yellow)' : 'var(--red)';

  return (
    <div className="card" style={{ marginBottom: 10, borderLeft: `3px solid ${ACCENT}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        {/* Left: identity */}
        <div style={{ minWidth: 220 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 17, fontWeight: 700 }}>
            <input
              type="checkbox"
              data-cargo-select={route.id}
              style={{ accentColor: ACCENT, cursor: 'pointer', width: 15, height: 15 }}
              checked={controls.selection.has(route.id)}
              onChange={() => controls.selection.toggle(route.id)}
              title="Select this route for bulk pricing"
            />
            <AirportLink code={route.origin} /> <span style={{ color: ACCENT }}>→</span> <AirportLink code={route.destination} />
            <FreightBadge />
            {pooled && (
              <span
                style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3, background: `${ACCENT}18`, color: ACCENT, border: `1px solid ${ACCENT}44`, textTransform: 'uppercase', letterSpacing: '.04em' }}
                title="Several of your freighters fly this lane — they share one demand pool, so this route's tonnage is its share of the market, not the full market"
              >
                <Glyph e="⚖" /> Shared lane
              </span>
            )}
            <CargoRivalsChip rivals={rivals} />
            <ConnectingFreightChip sim={sim} />
            {aircraft?.status === 'grounded' && (
              <span style={{
                fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3,
                background: 'rgba(248,81,73,0.15)', color: 'var(--red)',
                border: '1px solid rgba(248,81,73,0.3)',
                textTransform: 'uppercase', letterSpacing: '.04em',
              }} title={groundedTitle(aircraft)}>
                <Glyph e="🔧" /> {aircraft.groundedWeeksLeft}w
              </span>
            )}
            <OutOfRangeBadge route={route} />
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>
            {aircraft ? `${aircraft.name}${aircraft.tailNumber ? ` · ${aircraft.tailNumber}` : ''}` : <GlyphLabel size={12} text="⚠ no freighter assigned" />}
            {type && ` · ${type.payloadTonnes}t payload`}
            {sim && ` · ${sim.distance.toLocaleString()} km`}
          </div>
          <CargoRivalsLine rivals={rivals} />
        </div>

        {/* Middle: stats */}
        {sim && (
          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
            <div><div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Tonnes/wk</div><div style={{ fontWeight: 700, color: ACCENT }}>{sim.tonnes.toLocaleString()}</div></div>
            <div><div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Load</div><div style={{ fontWeight: 700, color: lfColor }}>{formatPercent(lf)}</div></div>
            <div><div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Revenue</div><div style={{ fontWeight: 700, color: 'var(--green)' }}>{formatMoney(sim.revenue)}</div></div>
            <div><div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Var. profit</div><div style={{ fontWeight: 700, color: sim.profit >= 0 ? 'var(--green)' : 'var(--red)' }}>{(sim.profit >= 0 ? '+' : '') + formatMoney(sim.profit)}</div></div>
          </div>
        )}
      </div>

      {/* Controls */}
      <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border-subtle)' }}>
        <CargoRouteControls route={route} sim={sim} controls={controls} />
      </div>
    </div>
  );
}

// ─── Mass pricing (Barca, Discord 2026-11-05: "Most importantly mass pricing") ─
//
// The passenger page's selection bar and Bulk Pricing modal, for freight. Both
// preview with planCargoYields and apply through BULK_SET_CARGO_YIELD, so the
// line under the controls is exactly what Apply writes. Freight has one rate per
// freighter rather than four cabins, so it is one % box, not a row of them.
// (Port from Headwinds, where the list groups freighters into lanes.)

/** "12 routes → $0.412–$0.455 · 3 above the going rate" for a planned change. */
function CargoYieldPreview({ plan }) {
  if (!plan) return null;
  if (plan.changed === 0) {
    return <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>Nothing would change.</span>;
  }
  const moved = plan.rows.filter(r => plan.yields.has(r.route.id));
  const lo = Math.min(...moved.map(r => r.to));
  const hi = Math.max(...moved.map(r => r.to));
  const above = moved.filter(r => r.to > r.ref * 1.0005).length;
  const range = hi - lo < 0.0005 ? `$${lo.toFixed(3)}` : `$${lo.toFixed(3)}–$${hi.toFixed(3)}`;
  return (
    <span data-cargo-yield-preview="" style={{ fontSize: 11, color: 'var(--text-muted)' }}>
      <b>{plan.changed}</b> route{plan.changed !== 1 ? 's' : ''} → {range}/t-km
      {above > 0 && <span title="Priced above each lane's reference yield — freight is price-sensitive, so expect lower loads"> · {above} above the going rate</span>}
    </span>
  );
}

const parsePct = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? Math.max(CARGO_BULK_PCT_MIN, Math.min(CARGO_BULK_PCT_MAX, n)) : 0;
};

// Both exported for tests (tools/cargo-bulk-yield-ui-test.mjs).
export function CargoSelectionBar({ rows, onApplyYield, onCloseRows, onClear }) {
  const { state } = useGame();
  const [pct, setPct] = useState('');
  const routeIds = rows.map(r => r.route.id);
  const n = parsePct(pct);
  const plan = n !== 0 ? planCargoYields(state, routeIds, { mode: 'pct', value: n }) : null;

  return (
    <div data-cargo-selection-bar="" style={{
      position: 'sticky', top: 8, zIndex: 50, marginBottom: 14,
      display: 'flex', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap',
      padding: '12px 16px', borderRadius: 10,
      background: 'var(--surface2)', border: `1px solid ${ACCENT}`,
      boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
    }}>
      <div style={{ fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap' }}>
        {rows.length} route{rows.length !== 1 ? 's' : ''} selected
      </div>

      <div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Yield change</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input
            type="number"
            className="form-input"
            data-cargo-bulk-pct=""
            placeholder="±%"
            value={pct}
            onChange={e => setPct(e.target.value)}
            style={{ width: 70, textAlign: 'center' }}
            aria-label="yield change, percent"
          />
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>%</span>
          <button
            className="btn btn-primary"
            style={{ fontSize: 12, padding: '4px 12px', background: ACCENT, borderColor: ACCENT }}
            disabled={!plan || plan.changed === 0}
            onClick={() => { onApplyYield(rows, { mode: 'pct', value: n }); setPct(''); }}
          >Apply</button>
          <button
            className="btn btn-ghost"
            style={{ fontSize: 12, padding: '4px 10px' }}
            title="Every selected route back to its own lane's going rate — the undo for a change that went wrong"
            onClick={() => onApplyYield(rows, { mode: 'reference' })}
          >Reset to ref</button>
        </div>
        <div style={{ marginTop: 4, minHeight: 14 }}><CargoYieldPreview plan={plan} /></div>
      </div>

      <div style={{ minWidth: 260 }}>
        <RouteFrequencyControls routeIds={routeIds} noun="route" each="each route" />
      </div>

      <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
        <button className="btn btn-ghost" style={{ fontSize: 12, color: 'var(--red)' }} onClick={() => onCloseRows(rows)}>Close</button>
        <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={onClear}>Clear</button>
      </div>
    </div>
  );
}

const RATE_FILTERS = [
  { id: 'any',   label: 'Any rate' },
  { id: 'above', label: 'Above the going rate' },
  { id: 'below', label: 'At or below the going rate' },
];

export function CargoBulkPricingModal({ allRows, onApply, onClose }) {
  const { state } = useGame();
  const [lfOn, setLfOn]   = useState(false);
  const [lfMin, setLfMin] = useState(0);
  const [lfMax, setLfMax] = useState(60);
  const [rate, setRate]   = useState('any');
  const [mode, setMode]   = useState('pct');
  const [pct, setPct]     = useState('');

  const ratioOf = (r) => r.route.yieldPrice / Math.max(0.01, cargoReferenceYield(r.route.origin, r.route.destination));
  const matching = allRows.filter(r => {
    if (lfOn) {
      const lf = (r.sim?.loadFactor ?? 0) * 100;
      if (lf < lfMin || lf > lfMax) return false;
    }
    if (rate === 'above' && !(ratioOf(r) > 1.0005)) return false;
    if (rate === 'below' && ratioOf(r) > 1.0005) return false;
    return true;
  });
  const routeIds = matching.map(r => r.route.id);
  const n = parsePct(pct);
  const change = mode === 'reference' ? { mode: 'reference' } : { mode: 'pct', value: n };
  const plan = routeIds.length > 0 && (mode === 'reference' || n !== 0) ? planCargoYields(state, routeIds, change) : null;

  function apply() {
    if (!plan || plan.changed === 0) return;
    onApply(matching, change);
    onClose();
  }

  const label = { fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 };
  const seg = (on) => ({
    padding: '4px 10px', fontSize: 12, fontWeight: 600, cursor: 'pointer', border: 'none',
    background: on ? ACCENT : 'transparent', color: on ? '#fff' : 'var(--text-muted)',
  });

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 2500,
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '6vh 16px', overflowY: 'auto',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="card"
        data-cargo-bulk-modal=""
        style={{ width: 520, maxWidth: '100%', maxHeight: '88vh', overflowY: 'auto', borderTop: `3px solid ${ACCENT}` }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <div style={{ fontSize: 17, fontWeight: 700 }}><Glyph e="⚖️" /> Freight Bulk Pricing</div>
          <button className="btn btn-ghost" style={{ padding: '2px 8px' }} onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 14, lineHeight: 1.5 }}>
          Pick cargo routes by how full they fly and how they are priced against the going rate, then
          reprice them all at once. Raise full routes; cut or reset the empty ones.
        </div>

        <div style={label}>Which routes</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, margin: '8px 0 16px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, flexWrap: 'wrap' }}>
            <input type="checkbox" checked={lfOn} onChange={e => setLfOn(e.target.checked)} style={{ accentColor: ACCENT }} />
            Load factor between
            <input type="number" className="form-input" min={0} max={100} value={lfMin} disabled={!lfOn}
                   onChange={e => setLfMin(Math.max(0, Math.min(100, Number(e.target.value) || 0)))} style={{ width: 60, textAlign: 'center' }} aria-label="minimum load factor" />
            and
            <input type="number" className="form-input" min={0} max={100} value={lfMax} disabled={!lfOn}
                   onChange={e => setLfMax(Math.max(0, Math.min(100, Number(e.target.value) || 0)))} style={{ width: 60, textAlign: 'center' }} aria-label="maximum load factor" />
            %
          </label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            Priced
            <select className="form-select" value={rate} onChange={e => setRate(e.target.value)} style={{ width: 220 }}>
              {RATE_FILTERS.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
            </select>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            <b style={{ color: 'var(--text)' }}>{matching.length}</b> of {allRows.length} route{allRows.length !== 1 ? 's' : ''} match
          </div>
        </div>

        <div style={label}>Change</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '8px 0 10px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
            <button type="button" style={seg(mode === 'pct')} onClick={() => setMode('pct')}>By %</button>
            <button type="button" style={seg(mode === 'reference')} onClick={() => setMode('reference')}>Reset to going rate</button>
          </div>
          {mode === 'pct' && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <input type="number" className="form-input" placeholder="±%" value={pct} onChange={e => setPct(e.target.value)}
                     style={{ width: 70, textAlign: 'center' }} aria-label="yield change, percent" />
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>%</span>
            </span>
          )}
        </div>
        <div style={{ minHeight: 16, marginBottom: 14 }}><CargoYieldPreview plan={plan} /></div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            style={{ background: ACCENT, borderColor: ACCENT }}
            disabled={!plan || plan.changed === 0}
            onClick={apply}
          >
            {plan?.changed ? `Reprice ${plan.changed} route${plan.changed !== 1 ? 's' : ''}` : 'Reprice'}
          </button>
        </div>
      </div>
    </div>
  );
}
