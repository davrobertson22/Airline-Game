import { useState } from 'react';
import { useGame } from '../store/GameContext.jsx';
import { getAirport } from '../data/airports.js';
import AirportLink from './AirportLink.jsx';
import { referencePrice, formatMoney, formatPercent } from '../utils/simulation.js';
import { computeQualityScore } from '../models/demand.js';
import AirlineLogo from './AirlineLogo.jsx';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TIER_META = {
  budget:  { label: 'Budget',  color: 'var(--yellow)' },
  legacy:  { label: 'Legacy',  color: 'var(--accent)'  },
  premium: { label: 'Premium', color: '#a78bfa'         },
};

/** Map aircraft serviceQuality → quality model serviceLevel */
function toServiceLevel(serviceQuality) {
  if (serviceQuality === 'luxury')  return 'business';
  if (serviceQuality === 'premium') return 'premium';
  return 'economy';
}

/** Compute player's quality score for one route (uses assigned aircraft config). */
function playerQuality(route, fleet) {
  const aircraft = fleet.find(a => a.id === route.aircraftId);
  if (!aircraft) return null;
  return computeQualityScore({
    onTimeRate:    0.85,
    serviceLevel:  toServiceLevel(aircraft.config?.serviceQuality ?? 'standard'),
    fleetAgeYears: (aircraft.ageWeeks ?? 0) / 52,
    customerRating: 3.5,
  });
}

// ─── Root component ───────────────────────────────────────────────────────────

export default function Competition() {
  const { state } = useGame();
  const { competitors = [], routes, fleet, financialHistory = [] } = state;
  const [expandedCarrier, setExpandedCarrier] = useState(null);

  // Map from routeKey → player route object
  const playerRouteMap = {};
  for (const r of routes) {
    const key = [r.origin, r.destination].sort().join('-');
    playerRouteMap[key] = r;
  }

  // Routes where at least one competitor overlaps with the player
  const contestedKeys = Object.keys(playerRouteMap).filter(k =>
    competitors.some(c => k in c.routes)
  );

  // Prior week profit for player
  const playerLastWeek = financialHistory.length > 0
    ? financialHistory[financialHistory.length - 1].profit ?? null
    : null;

  return (
    <div>
      {/* ── Leaderboard ───────────────────────────────────────────────────── */}
      <Leaderboard
        competitors={competitors}
        playerLastWeek={playerLastWeek}
        playerName={state.airlineName}
        playerLogoId={state.logoId}
        playerHub={state.hub}
        playerCash={state.cash}
      />

      {/* ── Contested routes ──────────────────────────────────────────────── */}
      <SectionHeader>⚔ Contested Routes</SectionHeader>
      {contestedKeys.length === 0 ? (
        <div className="empty-state" style={{ marginBottom: 24 }}>
          <div className="empty-state-icon">🤝</div>
          <div className="empty-state-text">No contested routes yet</div>
          <div style={{ fontSize: 13, marginTop: 6, color: 'var(--text-muted)' }}>
            Open routes that competitors also fly to see head-to-head comparisons.
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24 }}>
          {contestedKeys.map(key => (
            <ContestedRouteRow
              key={key}
              routeKey={key}
              playerRoute={playerRouteMap[key]}
              competitors={competitors.filter(c => key in c.routes)}
              fleet={fleet}
            />
          ))}
        </div>
      )}

      {/* ── Full competitor networks ──────────────────────────────────────── */}
      <SectionHeader>Competitor Networks</SectionHeader>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {competitors.map(c => (
          <NetworkPanel
            key={c.id}
            carrier={c}
            playerRouteMap={playerRouteMap}
            expanded={expandedCarrier === c.id}
            onToggle={() => setExpandedCarrier(p => p === c.id ? null : c.id)}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Leaderboard({ competitors, playerLastWeek, playerName, playerLogoId, playerHub, playerCash }) {
  // Build unified list with player + competitors
  const entries = [
    {
      id: '__player__',
      name: playerName,
      logoId: playerLogoId,
      hub: playerHub,
      cash: playerCash,
      tier: null,
      weeklyProfit: playerLastWeek,
      isPlayer: true,
    },
    ...competitors.map(c => ({
      id: c.id,
      name: c.name,
      logoId: c.logoId,
      hub: c.homeHub,
      cash: c.cash ?? null,
      tier: c.tier,
      weeklyProfit: c.weeklyStats?.weeklyProfit ?? null,
      isPlayer: false,
    })),
  ];

  const hasAnyData = entries.some(e => e.weeklyProfit !== null);

  // Sort: null profits go to bottom; otherwise descending
  const sorted = [...entries].sort((a, b) => {
    if (a.weeklyProfit === null && b.weeklyProfit === null) return 0;
    if (a.weeklyProfit === null) return 1;
    if (b.weeklyProfit === null) return -1;
    return b.weeklyProfit - a.weeklyProfit;
  });

  const maxAbsProfit = Math.max(...sorted.map(e => Math.abs(e.weeklyProfit ?? 0)), 1);

  return (
    <div style={{ marginBottom: 28 }}>
      <SectionHeader>🏆 Industry Leaderboard — Prior Week Profit</SectionHeader>

      {!hasAnyData && (
        <div className="empty-state" style={{ marginBottom: 8 }}>
          <div className="empty-state-icon">📊</div>
          <div className="empty-state-text">Advance one week to populate the leaderboard</div>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {sorted.map((entry, idx) => {
          const profit = entry.weeklyProfit;
          const isPositive = profit !== null && profit >= 0;
          const profitColor = profit === null ? 'var(--text-muted)' : isPositive ? 'var(--green)' : '#f87171';
          const barWidth = profit !== null ? Math.abs(profit) / maxAbsProfit * 100 : 0;
          const tier = entry.tier ? TIER_META[entry.tier] : null;

          const rankBadge = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `#${idx + 1}`;

          return (
            <div
              key={entry.id}
              className="card"
              style={{
                padding: '10px 14px',
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                border: entry.isPlayer ? '1px solid rgba(59,130,246,0.4)' : undefined,
                background: entry.isPlayer ? 'rgba(59,130,246,0.06)' : undefined,
              }}
            >
              {/* Rank */}
              <div style={{ width: 28, textAlign: 'center', fontSize: idx < 3 ? 18 : 13, fontWeight: 700, color: 'var(--text-muted)', flexShrink: 0 }}>
                {rankBadge}
              </div>

              {/* Logo */}
              <AirlineLogo id={entry.logoId} size={32} />

              {/* Name + hub */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 700, fontSize: 14 }}>{entry.name}</span>
                  {entry.isPlayer && (
                    <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 99, background: 'rgba(59,130,246,0.2)', color: '#60a5fa', fontWeight: 700 }}>
                      YOU
                    </span>
                  )}
                  {tier && (
                    <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 99, background: 'var(--surface2)', color: tier.color, fontWeight: 600 }}>
                      {tier.label}
                    </span>
                  )}
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    <AirportLink code={entry.hub} style={{ color: 'var(--text-muted)' }} />
                  </span>
                </div>

                {/* Bar */}
                <div style={{ marginTop: 5, height: 4, background: 'var(--surface2)', borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%',
                    width: `${barWidth}%`,
                    background: profitColor,
                    borderRadius: 2,
                    transition: 'width 0.4s ease',
                  }} />
                </div>
              </div>

              {/* Profit */}
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: profitColor }}>
                  {profit === null
                    ? '–'
                    : `${isPositive ? '+' : ''}${formatMoney(profit)}`
                  }
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>prior week profit</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SectionHeader({ children }) {
  return (
    <div style={{
      fontWeight: 700, fontSize: 13, marginBottom: 10,
      color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em',
    }}>
      {children}
    </div>
  );
}

function CompetitorCard({ carrier, playerRouteMap }) {
  const tier        = TIER_META[carrier.tier] ?? { label: carrier.tier, color: 'var(--text-muted)' };
  const totalRoutes  = Object.keys(carrier.routes).length;
  const sharedRoutes = Object.keys(carrier.routes).filter(k => k in playerRouteMap).length;
  const s           = carrier.weeklyStats;

  return (
    <div className="card" style={{ padding: '14px 16px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <AirlineLogo id={carrier.logoId} size={36} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 15, lineHeight: 1.2 }}>{carrier.name}</div>
          <span style={{
            fontSize: 10, padding: '1px 7px', borderRadius: 99,
            background: 'var(--surface2)', color: tier.color, fontWeight: 600,
          }}>
            {tier.label}
          </span>
        </div>
      </div>

      {/* Identity row */}
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
        Hub: <AirportLink code={carrier.homeHub} style={{ fontWeight: 700, color: 'var(--text)' }} />
        <span style={{ marginLeft: 12 }}>
          Quality: <strong style={{ color: qualityColor(carrier.baseQualityScore) }}>{carrier.baseQualityScore}/100</strong>
        </span>
      </div>

      {/* Weekly stats — show once first tick has run */}
      {s ? (
        <>
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 1fr',
            gap: '6px 16px', fontSize: 12, marginBottom: 10,
          }}>
            <StatLine label="Weekly profit" value={formatMoney(s.weeklyProfit)}
              color={s.weeklyProfit >= 0 ? 'var(--green)' : '#f87171'}
              prefix={s.weeklyProfit >= 0 ? '+' : ''} />
            <StatLine label="Weekly revenue" value={formatMoney(s.weeklyRevenue)} />
            <StatLine label="Weekly flights" value={s.weeklyFlights.toLocaleString()} />
            <StatLine label="Weekly pax" value={s.weeklyPax.toLocaleString()} />
          </div>

          {/* Cash */}
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '7px 10px', background: 'var(--surface2)', borderRadius: 6, fontSize: 12,
          }}>
            <span style={{ color: 'var(--text-muted)' }}>Cash balance</span>
            <strong style={{ color: carrier.cash >= 0 ? 'var(--text)' : '#f87171' }}>
              {formatMoney(carrier.cash ?? 0)}
            </strong>
          </div>
        </>
      ) : (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>
          Advance one week to see financials
        </div>
      )}

      {/* Routes summary */}
      <div style={{ display: 'flex', gap: 12, fontSize: 12, marginTop: 8, color: 'var(--text-muted)' }}>
        <span>{totalRoutes} routes</span>
        {sharedRoutes > 0 && (
          <span style={{ color: 'var(--yellow)', fontWeight: 600 }}>⚔ {sharedRoutes} shared</span>
        )}
      </div>
    </div>
  );
}

function StatLine({ label, value, color, prefix = '' }) {
  return (
    <div>
      <div style={{ color: 'var(--text-muted)', marginBottom: 1 }}>{label}</div>
      <div style={{ fontWeight: 700, color: color ?? 'var(--text)' }}>{prefix}{value}</div>
    </div>
  );
}

function ContestedRouteRow({ routeKey, playerRoute, competitors, fleet }) {
  const [a, b] = routeKey.split('-');
  const oAirport = getAirport(a);
  const dAirport = getAirport(b);
  const refP = referencePrice(a, b);
  const pQual = playerQuality(playerRoute, fleet);

  const cols = 1 + competitors.length; // you + N competitors

  return (
    <div className="card" style={{ padding: '12px 14px' }}>
      {/* Route header */}
      <div style={{ marginBottom: 10 }}>
        <span style={{ fontWeight: 700, fontSize: 15 }}><AirportLink code={a} /> → <AirportLink code={b} /></span>
        <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 10 }}>
          {oAirport?.city} – {dAirport?.city}
        </span>
        <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 8 }}>
          · ref ${refP}
        </span>
      </div>

      {/* Comparison grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: `140px repeat(${cols}, 1fr)`,
        fontSize: 12,
        gap: 0,
      }}>
        {/* Column headers */}
        <div />
        <ColHeader isPlayer>You</ColHeader>
        {competitors.map(c => <ColHeader key={c.id}>{c.name}</ColHeader>)}

        {/* Price */}
        <RowLabel>Price (economy)</RowLabel>
        <PriceCell price={playerRoute.ticketPrice} refP={refP} isPlayer />
        {competitors.map(c => {
          const price = Math.round(refP * c.routes[routeKey].priceMultiplier);
          return <PriceCell key={c.id} price={price} refP={refP} />;
        })}

        {/* Quality */}
        <RowLabel>Quality score</RowLabel>
        <QualityCell score={pQual} isPlayer />
        {competitors.map(c => <QualityCell key={c.id} score={c.baseQualityScore} />)}

        {/* Frequency */}
        <RowLabel>Flights / week</RowLabel>
        <FreqCell freq={playerRoute.weeklyFrequency} isPlayer />
        {competitors.map(c => (
          <FreqCell key={c.id} freq={c.routes[routeKey].frequency} />
        ))}
      </div>

      {/* Hints */}
      <CompetitiveHints
        playerRoute={playerRoute}
        playerQual={pQual}
        competitors={competitors}
        routeKey={routeKey}
        refP={refP}
      />
    </div>
  );
}

function ColHeader({ children, isPlayer }) {
  return (
    <div style={{
      padding: '4px 8px',
      background: isPlayer ? 'rgba(59,130,246,0.12)' : 'var(--surface2)',
      textAlign: 'center',
      fontWeight: 600,
      borderRadius: 4,
      margin: '0 2px 2px',
    }}>
      {children}
    </div>
  );
}

function RowLabel({ children }) {
  return (
    <div style={{ padding: '7px 0', color: 'var(--text-muted)', display: 'flex', alignItems: 'center' }}>
      {children}
    </div>
  );
}

function PriceCell({ price, refP, isPlayer }) {
  const ratio = price / refP;
  const color = ratio < 0.95 ? 'var(--green)' : ratio > 1.20 ? '#f87171' : 'var(--text)';
  return (
    <div style={{ padding: '7px 8px', textAlign: 'center' }}>
      <span style={{ fontWeight: 700, color }}>${price}</span>
      <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 3 }}>
        ({Math.round(ratio * 100)}%)
      </span>
    </div>
  );
}

function QualityCell({ score }) {
  if (score == null) return (
    <div style={{ padding: '7px 8px', textAlign: 'center', color: 'var(--text-muted)' }}>–</div>
  );
  const color = qualityColor(score);
  return (
    <div style={{ padding: '7px 8px', textAlign: 'center' }}>
      <span style={{ fontWeight: 700, color }}>{score}</span>
      <div style={{ height: 3, background: 'var(--surface2)', borderRadius: 2, marginTop: 3, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${score}%`, background: color, borderRadius: 2, transition: 'width 0.3s' }} />
      </div>
    </div>
  );
}

function FreqCell({ freq }) {
  return (
    <div style={{ padding: '7px 8px', textAlign: 'center' }}>
      {freq}×
    </div>
  );
}

function CompetitiveHints({ playerRoute, playerQual, competitors, routeKey, refP }) {
  const hints = [];

  for (const c of competitors) {
    const compPrice = Math.round(refP * c.routes[routeKey].priceMultiplier);
    const priceDiff = playerRoute.ticketPrice - compPrice;
    const qualDiff  = (playerQual ?? 0) - c.baseQualityScore;

    if (priceDiff > compPrice * 0.12)
      hints.push({ type: 'warn', text: `Your price is ${Math.round(priceDiff / refP * 100)}% above ${c.name}'s — you may be losing price-sensitive passengers.` });

    if (qualDiff < -20)
      hints.push({ type: 'info', text: `${c.name} has a ${Math.abs(qualDiff)}-point quality advantage. Consider upgrading seat or service quality in Fleet.` });

    if (priceDiff < -compPrice * 0.12 && qualDiff > 15)
      hints.push({ type: 'good', text: `You lead ${c.name} on both price and quality — strong position.` });
  }

  if (hints.length === 0) return null;

  const colors = { warn: '#fbbf24', info: 'var(--accent)', good: 'var(--green)' };
  return (
    <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
      {hints.map((h, i) => (
        <div key={i} style={{ fontSize: 12, color: colors[h.type], padding: '4px 8px', background: 'var(--surface2)', borderRadius: 4 }}>
          {h.type === 'warn' ? '⚠ ' : h.type === 'good' ? '✓ ' : 'ℹ '}{h.text}
        </div>
      ))}
    </div>
  );
}

function NetworkPanel({ carrier, playerRouteMap, expanded, onToggle }) {
  const tier   = TIER_META[carrier.tier] ?? { label: carrier.tier, color: 'var(--text-muted)' };
  const routes = Object.entries(carrier.routes).sort(([a], [b]) => a.localeCompare(b));

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <button
        onClick={onToggle}
        style={{
          width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '12px 14px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text)',
        }}
      >
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <span style={{ fontWeight: 700 }}>{carrier.name}</span>
          <span style={{ fontSize: 11, color: tier.color, fontWeight: 600 }}>{tier.label}</span>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{routes.length} routes</span>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>· quality {carrier.baseQualityScore}/100</span>
        </div>
        <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && (
        <div style={{ borderTop: '1px solid var(--border)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ color: 'var(--text-muted)', background: 'var(--surface2)' }}>
                <th style={{ textAlign: 'left',  padding: '6px 14px', fontWeight: 500 }}>Route</th>
                <th style={{ textAlign: 'right', padding: '6px 12px', fontWeight: 500 }}>Price</th>
                <th style={{ textAlign: 'right', padding: '6px 12px', fontWeight: 500 }}>vs ref</th>
                <th style={{ textAlign: 'right', padding: '6px 12px', fontWeight: 500 }}>Freq</th>
                <th style={{ padding: '6px 14px' }} />
              </tr>
            </thead>
            <tbody>
              {routes.map(([key, cfg]) => {
                const [a, b] = key.split('-');
                const refP  = referencePrice(a, b);
                const price = Math.round(refP * cfg.priceMultiplier);
                const oCity = getAirport(a)?.city ?? a;
                const dCity = getAirport(b)?.city ?? b;
                const isShared = key in playerRouteMap;

                return (
                  <tr key={key} style={{
                    borderTop: '1px solid var(--border)',
                    background: isShared ? 'rgba(251,191,36,0.05)' : 'transparent',
                  }}>
                    <td style={{ padding: '7px 14px' }}>
                      <span style={{ fontWeight: 600 }}><AirportLink code={a} />–<AirportLink code={b} /></span>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 6 }}>
                        {oCity}–{dCity}
                      </span>
                      {isShared && (
                        <span style={{ marginLeft: 8, fontSize: 10, color: 'var(--yellow)', fontWeight: 600 }}>
                          ⚔ contested
                        </span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right', padding: '7px 12px', fontWeight: 700 }}>
                      <span style={{ color: priceColor(cfg.priceMultiplier) }}>${price}</span>
                    </td>
                    <td style={{ textAlign: 'right', padding: '7px 12px', color: 'var(--text-muted)' }}>
                      {Math.round(cfg.priceMultiplier * 100)}%
                    </td>
                    <td style={{ textAlign: 'right', padding: '7px 12px' }}>{cfg.frequency}×/wk</td>
                    <td style={{ padding: '7px 14px' }} />
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

// ─── Colour helpers ───────────────────────────────────────────────────────────

function qualityColor(score) {
  if (score >= 70) return 'var(--green)';
  if (score >= 45) return 'var(--yellow)';
  return '#f87171';
}

function priceColor(multiplier) {
  if (multiplier < 0.90) return 'var(--green)';
  if (multiplier > 1.25) return '#a78bfa';
  return 'var(--text)';
}
