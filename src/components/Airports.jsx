import { useState } from 'react';
import { useGame } from '../store/GameContext.jsx';
import AirportDetail from './AirportDetail.jsx';
import { AIRPORTS, getAirport, gateMonthlyFee } from '../data/airports.js';
import { SLOTS_PER_GATE } from '../utils/simulation.js';
import { formatMoney } from '../utils/simulation.js';

// Tier badge styling
function TierBadge({ tier }) {
  const cfg = {
    mega:     { bg: 'rgba(163,113,247,0.15)', color: '#a371f7', border: 'rgba(163,113,247,0.35)' },
    major:    { bg: 'rgba(56,139,253,0.15)',  color: '#388bfd', border: 'rgba(56,139,253,0.35)'  },
    regional: { bg: 'rgba(63,185,80,0.15)',   color: '#3fb950', border: 'rgba(63,185,80,0.35)'   },
  }[tier] ?? { bg: 'rgba(139,148,158,0.15)', color: '#8b949e', border: 'rgba(139,148,158,0.35)' };
  return (
    <span style={{
      fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3,
      background: cfg.bg, color: cfg.color,
      border: `1px solid ${cfg.border}`,
      textTransform: 'uppercase', letterSpacing: '0.06em',
    }}>
      {tier}
    </span>
  );
}

export default function Airports() {
  const { state, dispatch } = useGame();
  const { gates = {}, routes, cash } = state;
  const [search, setSearch]           = useState('');
  const [selectedAirport, setSelectedAirport] = useState(null);

  if (selectedAirport) {
    return <AirportDetail code={selectedAirport} onBack={() => setSelectedAirport(null)} />;
  }

  // Total departures / arrivals consuming slots at an airport
  function slotsUsedAt(code) {
    return routes
      .filter(r => r.origin === code || r.destination === code)
      .reduce((s, r) => s + r.weeklyFrequency, 0);
  }

  const myGateEntries = Object.entries(gates)
    .filter(([, count]) => count > 0)
    .map(([code, count]) => ({ code, count, airport: getAirport(code) }))
    .filter(({ airport }) => airport)
    .sort((a, b) => b.count - a.count);

  const totalGates       = myGateEntries.reduce((s, { count }) => s + count, 0);
  const totalWeeklyFees  = myGateEntries.reduce((s, { airport, count }) =>
    s + Math.round(count * gateMonthlyFee(airport) / 4), 0);

  const filtered = search.trim()
    ? AIRPORTS.filter(a =>
        a.code.includes(search.trim().toUpperCase()) ||
        a.city.toLowerCase().includes(search.trim().toLowerCase()) ||
        a.name.toLowerCase().includes(search.trim().toLowerCase())
      )
    : AIRPORTS;

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            {myGateEntries.length} airport{myGateEntries.length !== 1 ? 's' : ''} · {totalGates} gate{totalGates !== 1 ? 's' : ''} total
          </div>
          {totalWeeklyFees > 0 && (
            <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 3 }}>
              Gate fees: <span style={{ color: 'var(--red)' }}>{formatMoney(totalWeeklyFees)}/wk</span>
              {' · '}{formatMoney(totalWeeklyFees * 4)}/month
            </div>
          )}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'right' }}>
          Each gate: {SLOTS_PER_GATE} slots / wk<br />
          <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>1 slot = 1 departure / wk</span>
        </div>
      </div>

      {/* ── My gates ──────────────────────────────────────────────── */}
      {myGateEntries.length > 0 && (
        <section style={{ marginBottom: 28 }}>
          <div style={{
            fontSize: 11, fontWeight: 600, color: 'var(--text-muted)',
            textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8,
          }}>
            Your Gates
          </div>
          {myGateEntries.map(({ code, count, airport }) => {
            const used       = slotsUsedAt(code);
            const capacity   = count * SLOTS_PER_GATE;
            const usagePct   = capacity > 0 ? used / capacity : 0;
            const weeklyCost = Math.round(count * gateMonthlyFee(airport) / 4);
            const canRemove  = used <= (count - 1) * SLOTS_PER_GATE;
            const barColor   = usagePct >= 0.9 ? 'var(--red)'
                             : usagePct >= 0.7 ? 'var(--yellow)'
                             : 'var(--green)';

            return (
              <div key={code} className="card" style={{ marginBottom: 8, padding: '12px 16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  {/* Airport info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                      <span style={{ fontWeight: 700, fontSize: 16 }}>{code}</span>
                      <span style={{ fontSize: 13, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {airport.city} · {airport.name}
                      </span>
                      <TierBadge tier={airport.tier} />
                    </div>
                    {/* Slot utilisation bar */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 5 }}>
                      <div style={{
                        flex: 1, height: 6, borderRadius: 3,
                        background: 'var(--surface3)', overflow: 'hidden',
                      }}>
                        <div style={{
                          height: '100%', width: `${Math.min(100, usagePct * 100)}%`,
                          background: barColor, borderRadius: 3, transition: 'width 0.3s',
                        }} />
                      </div>
                      <span style={{ fontSize: 12, color: barColor, fontWeight: 600, minWidth: 90, textAlign: 'right' }}>
                        {used} / {capacity} slots
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                      {count} gate{count > 1 ? 's' : ''} · {formatMoney(weeklyCost)}/wk ({formatMoney(weeklyCost * 4)}/mo)
                    </div>
                  </div>

                  {/* Add / remove / view buttons */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flexShrink: 0 }}>
                    <button
                      className="btn btn-ghost"
                      style={{ padding: '4px 12px', fontSize: 12 }}
                      onClick={() => setSelectedAirport(code)}
                    >
                      Details →
                    </button>
                    <button
                      className="btn btn-primary"
                      style={{ padding: '4px 12px', fontSize: 12 }}
                      onClick={() => dispatch({ type: 'ADD_GATE', airportCode: code })}
                    >
                      + Gate
                    </button>
                    <button
                      className="btn"
                      style={{
                        padding: '4px 12px', fontSize: 12,
                        opacity: canRemove ? 1 : 0.35,
                        cursor: canRemove ? 'pointer' : 'not-allowed',
                        background: 'rgba(248,81,73,0.1)',
                        color: 'var(--red)',
                        border: '1px solid rgba(248,81,73,0.3)',
                      }}
                      disabled={!canRemove}
                      title={canRemove ? 'Remove one gate' : 'Routes are using all slot capacity'}
                      onClick={() => dispatch({ type: 'REMOVE_GATE', airportCode: code })}
                    >
                      − Gate
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </section>
      )}

      {/* ── Browse / add airports ─────────────────────────────────── */}
      <section>
        <div style={{
          fontSize: 11, fontWeight: 600, color: 'var(--text-muted)',
          textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10,
        }}>
          {myGateEntries.length > 0 ? 'Expand to More Airports' : 'Acquire Your First Gates'}
        </div>

        <input
          className="form-input"
          placeholder="Search by code or city…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ marginBottom: 12, maxWidth: 320 }}
        />

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
          gap: 6,
        }}>
          {filtered.map(airport => {
            const count      = gates[airport.code] ?? 0;
            const weeklyCost = Math.round(gateMonthlyFee(airport) / 4);
            const held       = count > 0;

            return (
              <div
                key={airport.code}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '8px 12px', borderRadius: 'var(--radius)',
                  background: held ? 'var(--surface2)' : 'var(--surface)',
                  border: `1px solid ${held ? 'var(--accent-dim)' : 'var(--border)'}`,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 700 }}>{airport.code}</span>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 140 }}>
                      {airport.city}
                    </span>
                    <TierBadge tier={airport.tier} />
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>
                    {formatMoney(weeklyCost)}/wk · {SLOTS_PER_GATE} slots/gate
                    {held && (
                      <span style={{ color: 'var(--accent)', marginLeft: 6 }}>
                        {count} gate{count > 1 ? 's' : ''} held
                      </span>
                    )}
                  </div>
                </div>
                <button
                  className="btn btn-primary"
                  style={{ padding: '4px 10px', fontSize: 12, flexShrink: 0, marginLeft: 8 }}
                  onClick={() => dispatch({ type: 'ADD_GATE', airportCode: airport.code })}
                >
                  + Gate
                </button>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
