import { useState, useEffect } from 'react';
import { useGame } from '../store/GameContext.jsx';
import {
  AIRCRAFT_TYPES,
  AIRCRAFT_CATEGORIES,
  getAircraftType,
  buyDiscount,
  effectivePurchasePrice,
  efficiencyScore,
  seatEfficiency,
} from '../data/aircraft.js';
import { formatMoney } from '../utils/simulation.js';
import { absoluteWeek } from '../utils/fuel.js';
import AircraftCheckout from './AircraftCheckout.jsx';

// Category accent colors
const CAT_COLORS = {
  'Turboprop':    '#d29922',
  'Regional Jet': '#3fb950',
  'Narrow Body':  '#388bfd',
  'Wide Body':    '#a371f7',
};

const CAT_ICONS = {
  'Turboprop':    '🌀',
  'Regional Jet': '✈',
  'Narrow Body':  '✈',
  'Wide Body':    '🛫',
};

const DELIVERY_LEAD = {
  'Wide Body':    4,
  'Narrow Body':  3,
  'Regional Jet': 2,
  'Turboprop':    1,
};

function AircraftPhoto({ src, alt, category }) {
  const [failed, setFailed] = useState(false);
  // Reset failed state if the src URL changes
  useEffect(() => { setFailed(false); }, [src]);
  const color = CAT_COLORS[category] || '#8b949e';

  if (failed || !src) {
    return (
      <div className="aircraft-photo-placeholder" style={{
        background: `linear-gradient(160deg, ${color}18 0%, transparent 100%)`,
        borderBottom: `1px solid ${color}30`,
      }}>
        <div style={{ fontSize: 52, opacity: 0.25 }}>✈</div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6, opacity: 0.7 }}>{alt}</div>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      className="aircraft-photo"
      onError={() => setFailed(true)}
    />
  );
}

// ── Pending orders bar ────────────────────────────────────────────────────────

function PendingOrdersBar({ pendingOrders, year, week, onCancel }) {
  if (!pendingOrders || pendingOrders.length === 0) return null;

  const currentAbsWeek = absoluteWeek(year, week);

  return (
    <div style={{
      marginBottom: 20,
      background: 'var(--surface2)',
      border: '1px solid var(--border)',
      borderRadius: 8,
      overflow: 'hidden',
    }}>
      <div style={{
        padding: '10px 16px',
        borderBottom: '1px solid var(--border)',
        fontSize: 12,
        fontWeight: 600,
        color: 'var(--text-muted)',
        textTransform: 'uppercase',
        letterSpacing: '0.07em',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}>
        <span>📦</span>
        <span>On Order ({pendingOrders.length})</span>
      </div>
      <div style={{ padding: '8px 8px 4px' }}>
        {pendingOrders.map(order => {
          const type          = getAircraftType(order.typeId);
          const catColor      = CAT_COLORS[type?.category] || '#8b949e';
          const weeksLeft     = order.deliverAbsWeek - currentAbsWeek;
          const deliverYear   = Math.floor((order.deliverAbsWeek - 1) / 52) + 2026;
          const deliverWeek   = ((order.deliverAbsWeek - 1) % 52) + 1;
          const lead          = DELIVERY_LEAD[type?.category] ?? 2;
          const progress      = Math.max(0, Math.min(1, 1 - (weeksLeft / lead)));

          return (
            <div key={order.id} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '8px 8px',
              marginBottom: 4,
              borderRadius: 6,
              background: 'var(--surface1)',
            }}>
              {/* Category dot */}
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: catColor, flexShrink: 0 }} />

              {/* Name + type */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {order.name}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>
                  {type?.name}
                  {order.engineLabel && ` · ${order.engineLabel}`}
                  {order.hasWingtips && ' · Wingtips'}
                  {' · '}
                  <span style={{
                    color: order.ownershipType === 'owned' ? 'var(--green)' : 'var(--accent)',
                    fontWeight: 600,
                  }}>
                    {order.ownershipType === 'owned' ? 'Purchase' : 'Lease'}
                  </span>
                </div>
              </div>

              {/* Progress bar + ETA */}
              <div style={{ textAlign: 'right', flexShrink: 0, minWidth: 90 }}>
                <div style={{ fontSize: 11, color: weeksLeft <= 1 ? 'var(--green)' : 'var(--text-muted)', fontWeight: 600 }}>
                  {weeksLeft <= 0 ? 'Arriving…' : `${weeksLeft}w left`}
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 1 }}>
                  Wk {deliverWeek}/{deliverYear}
                </div>
                <div style={{ height: 3, width: 80, background: 'var(--surface3)', borderRadius: 2, marginTop: 4, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${progress * 100}%`, background: catColor, borderRadius: 2, transition: 'width 0.3s' }} />
                </div>
              </div>

              {/* Cancel button */}
              <button
                onClick={() => onCancel(order)}
                style={{
                  flexShrink: 0,
                  padding: '3px 8px',
                  fontSize: 11,
                  borderRadius: 4,
                  border: '1px solid rgba(248,81,73,0.3)',
                  background: 'rgba(248,81,73,0.08)',
                  color: 'var(--red)',
                  cursor: 'pointer',
                }}
                title="Cancel order"
              >
                Cancel
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function Marketplace() {
  const { state, dispatch } = useGame();
  const { cash, fleet, pendingOrders = [], year, week } = state;

  const [activeCategory, setActiveCategory] = useState('All');
  const [activeMfr, setActiveMfr]           = useState('All');

  // Checkout modal state: { typeId, mode: 'lease'|'buy' } or null
  const [checkout, setCheckout] = useState(null);

  function handleCancelOrder(order) {
    const type    = getAircraftType(order.typeId);
    const hasRefund = order.ownershipType === 'owned' && order.totalPrice > 0;
    const refund    = hasRefund ? Math.round(order.totalPrice * 0.95) : 0;
    const msg = hasRefund
      ? `Cancel order for ${order.name}? You will receive a refund of ${formatMoney(refund)} (5% cancellation fee deducted).`
      : `Cancel lease order for ${order.name}? This is free to cancel before delivery.`;
    if (window.confirm(msg)) {
      dispatch({ type: 'CANCEL_ORDER', orderId: order.id });
    }
  }

  const ownedCounts = fleet.reduce((acc, a) => {
    acc[a.typeId] = (acc[a.typeId] || 0) + 1;
    return acc;
  }, {});

  const pendingCounts = pendingOrders.reduce((acc, o) => {
    acc[o.typeId] = (acc[o.typeId] || 0) + 1;
    return acc;
  }, {});

  const currentWeeklyLease = fleet.reduce((sum, a) => {
    const t = AIRCRAFT_TYPES.find(x => x.id === a.typeId);
    return sum + (a.ownershipType === 'lease' ? (t?.weeklyLease ?? 0) : 0);
  }, 0);

  const categories = ['All', ...AIRCRAFT_CATEGORIES];

  const mfrsInCategory = ['All', ...[...new Set(
    (activeCategory === 'All' ? AIRCRAFT_TYPES : AIRCRAFT_TYPES.filter(t => t.category === activeCategory))
      .map(t => t.manufacturer)
  )].sort()];

  const safeMfr = mfrsInCategory.includes(activeMfr) ? activeMfr : 'All';

  const filtered = AIRCRAFT_TYPES.filter(t =>
    (activeCategory === 'All' || t.category === activeCategory) &&
    (safeMfr        === 'All' || t.manufacturer === safeMfr)
  );

  return (
    <div>
      {/* Pending orders */}
      <PendingOrdersBar
        pendingOrders={pendingOrders}
        year={year}
        week={week}
        onCancel={handleCancelOrder}
      />

      {/* Header + category filter */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 14 }}>
          Order aircraft to grow your fleet. New deliveries are staggered by type — widebodies take 4 weeks, narrowbodies 3, regional jets 2, turboprops 1.
        </div>
        <div className="category-tabs">
          {categories.map(cat => {
            const isActive = activeCategory === cat;
            const color = CAT_COLORS[cat];
            return (
              <button
                key={cat}
                className={`category-tab ${isActive ? 'active' : ''}`}
                style={isActive && color ? { color, borderBottomColor: color } : {}}
                onClick={() => { setActiveCategory(cat); setActiveMfr('All'); }}
              >
                {cat !== 'All' && <span style={{ marginRight: 5 }}>{CAT_ICONS[cat]}</span>}
                {cat}
              </button>
            );
          })}
        </div>

        {/* Manufacturer filter */}
        <div style={{
          display: 'flex', gap: 6, overflowX: 'auto',
          paddingBottom: 4, marginTop: 10, scrollbarWidth: 'none',
        }}>
          {mfrsInCategory.map(mfr => {
            const isActive = safeMfr === mfr;
            return (
              <button
                key={mfr}
                onClick={() => setActiveMfr(mfr)}
                style={{
                  flexShrink: 0, padding: '4px 12px', borderRadius: 20,
                  border: isActive ? '1px solid var(--accent)' : '1px solid var(--border)',
                  background: isActive ? 'rgba(56,139,253,0.15)' : 'var(--surface2)',
                  color: isActive ? 'var(--accent)' : 'var(--text-muted)',
                  fontSize: 12, fontWeight: isActive ? 600 : 400,
                  cursor: 'pointer', whiteSpace: 'nowrap', transition: 'all 0.15s',
                }}
              >
                {mfr}
              </button>
            );
          })}
        </div>
      </div>

      {/* Aircraft grid */}
      <div className="aircraft-market-grid">
        {filtered.map(type => {
          const currentAbsWeek = absoluteWeek(year, week);
          const lead           = DELIVERY_LEAD[type.category] ?? 2;
          const newWeeklyTotal = currentWeeklyLease + type.weeklyLease;
          const weeksOfCash    = type.weeklyLease > 0 ? Math.floor(cash / newWeeklyTotal) : Infinity;
          const catColor       = CAT_COLORS[type.category] || '#8b949e';
          const cashWarning    = isFinite(weeksOfCash) && weeksOfCash < 4;

          const alreadyOwned  = ownedCounts[type.id] || 0;
          const onOrder       = pendingCounts[type.id] || 0;
          const discount      = buyDiscount(alreadyOwned);
          const buyPrice      = effectivePurchasePrice(type, alreadyOwned);
          const discPct       = Math.round(discount * 100);
          const effScore      = efficiencyScore(type);
          const effRaw        = seatEfficiency(type).toFixed(2);
          const canAffordBuy  = cash >= buyPrice;
          const effColor      = effScore >= 70 ? 'var(--green)' : effScore >= 40 ? 'var(--yellow)' : 'var(--red)';

          // Delivery note
          const pendingOfType = pendingOrders.filter(o => o.typeId === type.id);
          const maxExisting   = pendingOfType.length > 0
            ? Math.max(...pendingOfType.map(o => o.deliverAbsWeek))
            : currentAbsWeek;
          const nextDeliveryWeeks = Math.max(currentAbsWeek + lead, maxExisting + lead) - currentAbsWeek;

          const hasOptions = (type.configOptions?.engines?.length > 1) || !!type.configOptions?.wingtips;

          return (
            <div className="aircraft-market-card" key={type.id}>
              {/* Photo banner */}
              <div className="aircraft-photo-wrap">
                <AircraftPhoto src={type.image} alt={type.name} category={type.category} />
                <div className="aircraft-photo-overlay">
                  <span
                    className="aircraft-cat-badge"
                    style={{ background: `${catColor}25`, color: catColor, border: `1px solid ${catColor}50` }}
                  >
                    {type.category}
                  </span>
                  {alreadyOwned > 0 && (
                    <span className="badge badge-blue" style={{ marginLeft: 6 }}>{alreadyOwned} in fleet</span>
                  )}
                  {onOrder > 0 && (
                    <span className="badge" style={{
                      marginLeft: 4,
                      background: 'rgba(210,153,34,0.2)', color: 'var(--yellow)',
                      border: '1px solid rgba(210,153,34,0.4)',
                    }}>
                      {onOrder} on order
                    </span>
                  )}
                </div>
              </div>

              {/* Card body */}
              <div className="aircraft-market-body">
                {/* Title */}
                <div style={{ marginBottom: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                    <span style={{ fontWeight: 700, fontSize: 17 }}>{type.name}</span>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{type.manufacturer}</span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.5 }}>
                    {type.description}
                  </div>
                </div>

                {/* Stat pills */}
                <div className="aircraft-stat-row">
                  <div className="aircraft-stat-pill">
                    <span className="aircraft-stat-pill-label">Seats</span>
                    <span className="aircraft-stat-pill-value">{type.seats}</span>
                  </div>
                  <div className="aircraft-stat-pill">
                    <span className="aircraft-stat-pill-label">Range</span>
                    <span className="aircraft-stat-pill-value">{type.range.toLocaleString()} km</span>
                  </div>
                  <div className="aircraft-stat-pill">
                    <span className="aircraft-stat-pill-label">Fuel/km</span>
                    <span className="aircraft-stat-pill-value">${type.fuelCostPerKm.toFixed(1)}</span>
                  </div>
                  <div className="aircraft-stat-pill">
                    <span className="aircraft-stat-pill-label">Maint/wk</span>
                    <span className="aircraft-stat-pill-value">{formatMoney(type.baseMaintenancePerWk)}</span>
                  </div>
                </div>

                {/* Fuel efficiency bar */}
                <div style={{ marginTop: 10, marginBottom: 4 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Seat efficiency</span>
                    <span style={{ fontSize: 11, color: effColor, fontWeight: 600 }}>
                      {effScore}/100 · ${effRaw}/seat/100km
                    </span>
                  </div>
                  <div style={{ height: 4, borderRadius: 2, background: 'var(--surface3)', overflow: 'hidden' }}>
                    <div style={{ height: '100%', borderRadius: 2, width: `${effScore}%`, background: effColor, transition: 'width 0.3s' }} />
                  </div>
                </div>

                {/* Config options badge */}
                {hasOptions && (
                  <div style={{ marginTop: 8 }}>
                    <span style={{
                      fontSize: 11, padding: '2px 8px', borderRadius: 4,
                      background: 'rgba(163,113,247,0.12)', color: '#a371f7',
                      border: '1px solid rgba(163,113,247,0.3)',
                    }}>
                      ⚙ Engine &amp; wingtip options available
                    </span>
                  </div>
                )}

                {/* Delivery note */}
                <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-muted)' }}>
                  📅 Delivery in <strong>{nextDeliveryWeeks} week{nextDeliveryWeeks !== 1 ? 's' : ''}</strong>
                  {onOrder > 0 && ` (${onOrder} already queued)`}
                </div>

                {/* Acquisition footer */}
                <div style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 10 }}>

                  {/* Lease row */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                        <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--accent)' }}>
                          {formatMoney(type.weeklyLease)}
                        </span>
                        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>/wk</span>
                      </div>
                      <div style={{ fontSize: 11, color: cashWarning ? 'var(--red)' : 'var(--text-muted)', marginTop: 1 }}>
                        {isFinite(weeksOfCash)
                          ? `${weeksOfCash} wks runway${cashWarning ? ' ⚠' : ''}`
                          : 'No lease costs yet'}
                      </div>
                    </div>
                    <button
                      className="btn btn-primary aircraft-lease-btn"
                      onClick={() => setCheckout({ typeId: type.id, mode: 'lease' })}
                    >
                      Lease →
                    </button>
                  </div>

                  {/* Buy row */}
                  <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    paddingTop: 8, borderTop: '1px solid var(--border-subtle)',
                  }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 18, fontWeight: 700, color: canAffordBuy ? 'var(--green)' : 'var(--text-dim)' }}>
                          {formatMoney(buyPrice)}
                        </span>
                        {discPct > 0 && (
                          <span style={{
                            fontSize: 10, fontWeight: 700, padding: '1px 5px', borderRadius: 4,
                            background: 'rgba(63,185,80,0.15)', color: 'var(--green)',
                            border: '1px solid rgba(63,185,80,0.3)',
                          }}>
                            -{discPct}% fleet
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>
                        buy outright · no weekly lease
                      </div>
                    </div>
                    <button
                      className="btn aircraft-lease-btn"
                      style={{
                        background: canAffordBuy ? 'rgba(63,185,80,0.15)' : 'var(--surface3)',
                        color: canAffordBuy ? 'var(--green)' : 'var(--text-dim)',
                        border: `1px solid ${canAffordBuy ? 'rgba(63,185,80,0.4)' : 'var(--border)'}`,
                        cursor: canAffordBuy ? 'pointer' : 'not-allowed',
                      }}
                      disabled={!canAffordBuy}
                      onClick={() => canAffordBuy && setCheckout({ typeId: type.id, mode: 'buy' })}
                    >
                      {canAffordBuy ? 'Buy →' : 'Can\'t afford'}
                    </button>
                  </div>

                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Checkout modal */}
      {checkout && (
        <AircraftCheckout
          typeId={checkout.typeId}
          mode={checkout.mode}
          onClose={() => setCheckout(null)}
        />
      )}
    </div>
  );
}
