import { useMemo } from 'react';
import { calendarYear as eraCalendarYear } from '../utils/simulation.js';
import { featureLive, ERA_FEATURE_MESSAGE } from '../data/eraFeatures.js';
import { useGame, slotsUsedAt as slotsUsedAtEngine } from '../store/GameContext.jsx';
import { AIRPORTS, getAirport } from '../data/airports.js';
import {
  baseCityPairDemand, referencePrice, formatMoney, formatPercent, SLOTS_PER_GATE,
  cargoSlotsUsedAt, routeLegs, routeSegments,
} from '../utils/simulation.js';
import {
  AIRPORT_GATEWAY_SCORES, HUB_TIERS,
} from '../models/demand.js';
import { getAirportRestrictions } from '../data/airportRestrictions.js';
import { Glyph } from './Icons.jsx';
import { useConfirm } from './ConfirmModal.jsx';
import {
  canBuildLounge, isLoungeOpen, loungeCloseRefund,
  LOUNGE_BUILD_COST, LOUNGE_BUILD_WEEKS, LOUNGE_WEEKLY_OPEX,
  LOUNGE_APPEAL_PER_END, LOUNGE_OWNED_COST_FACTOR,
} from '../data/lounges.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function weekToMonth(week) {
  return Math.min(12, Math.max(1, Math.ceil(week * 12 / 52)));
}

const TIER_COLOR = { budget: 'var(--yellow)', legacy: 'var(--accent)', premium: 'var(--purple)' };

function Stat({ label, value, sub, color }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 3 }}>{label}</div>
      <div style={{ fontWeight: 700, fontSize: 15, color: color ?? 'var(--text)' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 1 }}>{sub}</div>}
    </div>
  );
}

/**
 * Build / manage the lounge at ONE airport.
 *
 * The quote and every eligibility reason come from canBuildLounge — the same
 * function the reducer enforces with — so the player is never shown a button
 * that the engine will refuse, and never a price the engine won't charge.
 */
function LoungeCard({ code }) {
  const { state, dispatch } = useGame();
  const confirm = useConfirm();
  const lounges = state.lounges ?? {};
  const lounge  = lounges[code];
  const check   = canBuildLounge(code, { lounges, gates: state.gates ?? {}, cash: state.cash });
  const appealPct = Math.round(LOUNGE_APPEAL_PER_END * 100);
  const savingPct = Math.round((1 - LOUNGE_OWNED_COST_FACTOR) * 100);

  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ fontSize: 16 }}><Glyph e="🛋️" size={16} /></span>
        <div style={{ fontWeight: 600 }}>Lounge</div>
        {lounge && (
          <span className="badge" style={isLoungeOpen(lounge)
            ? { background: 'rgba(63,185,80,.12)', color: 'var(--green)', border: '1px solid rgba(63,185,80,.35)' }
            : { background: 'rgba(210,153,34,.14)', color: 'var(--yellow)', border: '1px solid rgba(210,153,34,.4)' }}>
            {isLoungeOpen(lounge) ? 'Open' : `Fitting out — ${lounge.buildWeeksLeft}w left`}
          </span>
        )}
      </div>

      {!lounge && (
        <>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 12 }}>
            A lounge at {code} makes you materially more attractive to <strong>business travellers</strong> on
            every route touching it (about +{appealPct}% weight in the business market, and again at the other
            end if you have a lounge there too). It also cuts the premium ground bill on those routes by
            roughly {savingPct}%, because you stop paying a contractor per head — which is why lounges pay for
            themselves at a hub with real premium traffic and quietly bleed money at a thin outstation.
            Once it opens you can sell day passes; the price is set on the Ancillaries tab.
          </div>
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginBottom: 12 }}>
            <Stat label="Build cost"  value={formatMoney(LOUNGE_BUILD_COST)} sub="one-off" />
            <Stat label="Fit-out"     value={`${LOUNGE_BUILD_WEEKS} weeks`} sub="before it opens" />
            <Stat label="Running"     value={`${formatMoney(LOUNGE_WEEKLY_OPEX)}/wk`} sub="staff, F&B, rent" color="var(--red)" />
          </div>
          {(() => {
            const eraLock = !featureLive('lounges', eraCalendarYear(state));
            const reason = eraLock ? ERA_FEATURE_MESSAGE.lounges : (!check.ok ? check.reasons[0] : null);
            return reason && (
              <div style={{ fontSize: 12, color: 'var(--yellow)', marginBottom: 10 }}>
                {eraLock ? '🕰 ' : ''}{reason}
              </div>
            );
          })()}
          <button
            className={check.ok && featureLive('lounges', eraCalendarYear(state)) ? 'btn btn-primary' : 'btn'}
            style={{ fontSize: 13, cursor: check.ok && featureLive('lounges', eraCalendarYear(state)) ? 'pointer' : 'not-allowed' }}
            disabled={!check.ok || !featureLive('lounges', eraCalendarYear(state))}
            onClick={async () => {
              if (!check.ok || !featureLive('lounges', eraCalendarYear(state))) return;
              if (await confirm({
                title: `Build a lounge at ${code}?`,
                body: `${formatMoney(check.capex)} now, then ${formatMoney(LOUNGE_WEEKLY_OPEX)}/wk once it opens `
                    + `in ${LOUNGE_BUILD_WEEKS} weeks.\n\n`
                    + `It lifts your standing with business travellers on routes through ${code} and cuts the `
                    + `premium ground bill there. It earns nothing at all until the fit-out finishes.`,
                confirmLabel: `Build for ${formatMoney(check.capex)}`,
              })) {
                dispatch({ type: 'BUILD_LOUNGE', code, airportCode: code });
              }
            }}
          >
            Build lounge — {formatMoney(LOUNGE_BUILD_COST)}
          </button>
        </>
      )}

      {lounge && (
        <>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 12 }}>
            {isLoungeOpen(lounge)
              ? `Open and taking guests. Business travellers rate you higher on every route through ${code}, `
                + `premium ground costs here are down about ${savingPct}%, and you can sell day passes on `
                + `routes touching this airport. Who gets in free is set on the Ancillaries tab.`
              : `Under construction. It costs nothing to run and does nothing for you until it opens.`}
          </div>
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginBottom: 12 }}>
            <Stat label="Running cost" value={isLoungeOpen(lounge) ? `${formatMoney(LOUNGE_WEEKLY_OPEX)}/wk` : '—'} color="var(--red)" />
            <Stat label="Close refund" value={formatMoney(loungeCloseRefund(lounge))} sub="if you shut it" />
          </div>
          <button
            className="btn"
            style={{ fontSize: 12, background: 'rgba(248,81,73,0.08)', color: 'var(--red)', border: '1px solid rgba(248,81,73,0.3)' }}
            onClick={async () => {
              if (await confirm({
                title: `Close the ${code} lounge?`,
                body: `You get ${formatMoney(loungeCloseRefund(lounge))} back for the fittings and the lease exit — `
                    + `far less than the ${formatMoney(lounge.capex ?? LOUNGE_BUILD_COST)} you put in.\n\n`
                    + `Business travellers on routes through ${code} will notice, and your premium ground `
                    + `costs here go back to the full contract rate.`,
                danger: true,
                confirmLabel: 'Close lounge',
              })) {
                dispatch({ type: 'CLOSE_LOUNGE', code, airportCode: code });
              }
            }}
          >
            Close lounge
          </button>
        </>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function AirportDetail({ code, onBack }) {
  const { state } = useGame();
  const airport   = getAirport(code);
  const gates     = state.gates ?? {};
  const hubs      = state.hubs  ?? (state.hub ? { [state.hub]: { tier: 1 } } : {});
  const myGates   = gates[code] ?? 0;
  const hubInfo   = hubs[code];
  const hubTier   = hubInfo ? HUB_TIERS[hubInfo.tier] : null;

  const restrictions = getAirportRestrictions(code); // array, may be empty

  const slotCap  = myGates * SLOTS_PER_GATE;
  // Counted the way the engine's slot guards count it: a rotation calling here
  // uses two movements a cycle, an endpoint one. The old endpoint-only reading
  // showed this page fewer slots in use than the guard that refuses flights.
  const slotsUsed = slotsUsedAtEngine(state.routes, code)
    + cargoSlotsUsedAt(code, state.cargoRoutes);

  const gwScore = AIRPORT_GATEWAY_SCORES[code] ?? 0.20;

  // My routes at this airport
  // Anything that TOUCHES this airport, so a rotation stopping here is listed at
  // the airport it stops at rather than only at its endpoints.
  const myRoutes = state.routes.filter(r => routeLegs(r).some(l => l.from === code || l.to === code));

  // Group deployments into distinct city pairs (multiple aircraft on the same
  // pair = one route), matching how the competitor rows below are counted.
  // Every route here touches `code`, so the other endpoint identifies the pair.
  // A rotation contributes the legs it flies out of THIS airport — MCI–JFK–ORY
  // seen from JFK is two pairs, JFK–MCI and JFK–ORY, which is what it sells.
  const myPairs = Object.values(
    myRoutes.reduce((m, r) => {
      for (const l of routeLegs(r)) {
        if (l.from !== code && l.to !== code) continue;
        const other = l.from === code ? l.to : l.from;
        if (!m[other]) m[other] = { other, frequency: 0 };
        m[other].frequency += (r.weeklyFrequency ?? 0);
      }
      return m;
    }, {})
  );
  const myRouteCount = myPairs.length;
  // The flights-per-week headline over that list, so it adds up to what is
  // underneath it. NOT the peak `slotsUsed` above — that answers the guard's
  // question ("will another flight fit in the busiest month"), and the two
  // differ whenever the network is seasonal.
  const myTotalFreq = myPairs.reduce((s, p) => s + p.frequency, 0);

  // Top 15 city pairs involving this airport, by O&D demand
  const topPairs = useMemo(() => {
    return AIRPORTS
      .filter(a => a.code !== code)
      .map(a => ({
        code:   a.code,
        city:   a.city,
        demand: baseCityPairDemand(code, a.code),
        refP:   referencePrice(code, a.code),
      }))
      .sort((a, b) => b.demand - a.demand)
      .slice(0, 15);
  }, [code]);

  const totalAirportDemand = useMemo(
    () => topPairs.reduce((s, p) => s + p.demand, 0),
    [topPairs]
  );

  // Which competitors serve each pair
  const compRouteMap = useMemo(() => {
    const map = {};
    for (const comp of state.competitors ?? []) {
      for (const [key] of Object.entries(comp.routes ?? {})) {
        const [a, b] = key.split('-');
        const other  = a === code ? b : b === code ? a : null;
        if (!other) continue;
        if (!map[other]) map[other] = [];
        map[other].push(comp);
      }
    }
    return map;
  }, [code, state.competitors]);

  // Do I serve each pair?
  // Every market I sell out of this airport — routeSegments, not routeLegs, so
  // a rotation's THROUGH markets count: MCI–JFK–ORY genuinely sells MCI–ORY and
  // the tick prices it, so from MCI that pair reads as served.
  const myRouteSet = useMemo(() => {
    const s = new Set();
    for (const r of myRoutes) {
      for (const seg of routeSegments(r)) {
        if (seg.from === code) s.add(seg.to);
        else if (seg.to === code) s.add(seg.from);
      }
    }
    return s;
  }, [myRoutes, code]);

  // All airlines present at this airport (for the presence summary)
  const airlinePresence = useMemo(() => {
    const result = [];

    // Player
    if (myRoutes.length > 0) {
      result.push({
        id:        'player',
        name:      state.airlineName,
        tier:      null,
        routes:    myRouteCount,
        frequency: myTotalFreq,
        isPlayer:  true,
      });
    }

    // Competitors
    const compsSeen = new Set();
    for (const [, comps] of Object.entries(compRouteMap)) {
      for (const c of comps) {
        if (!compsSeen.has(c.id)) {
          compsSeen.add(c.id);
          const compRoutes = Object.keys(c.routes ?? {}).filter(key => {
            const [a, b] = key.split('-');
            return a === code || b === code;
          });
          result.push({
            id:        c.id,
            name:      c.name,
            tier:      c.tier,
            routes:    compRoutes.length,
            frequency: compRoutes.reduce((s, key) => s + (c.routes[key]?.frequency ?? 0), 0),
            isPlayer:  false,
          });
        }
      }
    }

    return result.sort((a, b) => b.frequency - a.frequency);
  }, [myRoutes, compRouteMap, state.airlineName, myTotalFreq]);

  // ── Transit flows over this airport (real A→hub→C itineraries) ────────────────
  // The weekly network tick enumerates the actual connecting passengers you carry
  // over each of your hubs and saves the top itineraries onto lastReport. Filter to
  // the airport being viewed → an honest "who's connecting here, from where to
  // where" list. Only populated for YOUR designated hubs, after the first tick.
  const lastReport = state.lastReport;
  const transitFlows = useMemo(() => {
    return (lastReport?.ownMetalOD?.entries ?? [])
      .filter(e => e.hub === code)
      .map(e => {
        const [from, to] = String(e.od ?? '').split('→');
        return { ...e, from, to };
      })
      .filter(e => e.from && e.to)
      .sort((a, b) => b.pax - a.pax);
  }, [lastReport, code]);
  const hubTransit = lastReport?.ownMetalOD?.byHub?.[code] ?? null;
  const partnerTransitPax = useMemo(() => {
    return (lastReport?.partnerODRevenue?.entries ?? [])
      .filter(e => e.hub === code)
      .reduce((s, e) => s + (e.pax ?? 0), 0);
  }, [lastReport, code]);
  const maxTransitPax = transitFlows[0]?.pax ?? 1;

  return (
    <div>
      {/* Back + header */}
      <button className="btn btn-ghost" style={{ fontSize: 13, marginBottom: 14 }} onClick={onBack}>
        ← Back to Airports
      </button>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 26, letterSpacing: -0.5 }}>{code}</div>
          <div style={{ color: 'var(--text-muted)', fontSize: 14, marginTop: 2 }}>
            {airport?.name} · {airport?.city}, {airport?.country}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {hubTier && (
            <span style={{
              background: hubTier.color + '22', color: hubTier.color,
              border: `1px solid ${hubTier.color}55`,
              borderRadius: 4, padding: '5px 12px', fontSize: 12, fontWeight: 700,
            }}>
              {hubTier.name}
            </span>
          )}
          {myGates > 0 && (
            <span style={{ background: 'rgba(56,139,253,0.12)', color: 'var(--accent)', border: '1px solid rgba(56,139,253,0.3)', borderRadius: 4, padding: '5px 12px', fontSize: 12, fontWeight: 600 }}>
              {myGates} {myGates === 1 ? 'gate' : 'gates'}
            </span>
          )}
          {airport?.runwayFt && (
            <span title="Longest runway — aircraft that need more runway than this cannot operate here" style={{ background: 'var(--surface2)', color: 'var(--text-secondary)', border: '1px solid var(--border)', borderRadius: 4, padding: '5px 12px', fontSize: 12, fontWeight: 600, cursor: 'help' }}>
              <Glyph e="🛬" /> {airport.runwayFt.toLocaleString()} ft runway
            </span>
          )}
          {restrictions.map((r, i) => (
            <span key={i} style={{ background: 'rgba(220,53,69,0.12)', color: 'var(--red)', border: '1px solid rgba(220,53,69,0.35)', borderRadius: 4, padding: '5px 12px', fontSize: 12, fontWeight: 600 }}>
              <Glyph e="🚫" /> {r.shortLabel}
            </span>
          ))}
        </div>
      </div>

      {restrictions.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
          {restrictions.map((r, i) => (
            <div key={i} style={{
              background: 'rgba(220,53,69,0.07)',
              border: '1px solid rgba(220,53,69,0.25)',
              borderRadius: 'var(--radius)',
              padding: '10px 14px',
              fontSize: 13,
              color: 'var(--text-secondary)',
              lineHeight: 1.5,
            }}>
              <strong style={{ color: 'var(--red)' }}>{r.label}:</strong>{' '}
              {r.description}
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12 }}>

        <LoungeCard code={code} />

        {/* Your presence */}
        <div className="card">
          <div style={{ fontWeight: 600, marginBottom: 12 }}>Your Presence</div>
          {myGates === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
              You don't have any gates here yet.
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginBottom: 14 }}>
                <Stat label="Gates"         value={myGates} />
                <Stat label="Slot Usage"    value={`${slotsUsed} / ${slotCap}`} sub="departures / wk" color={slotsUsed / slotCap > 0.8 ? 'var(--yellow)' : 'var(--text)'} />
                <Stat label="Routes"        value={myRouteCount} />
                <Stat label="Flights/wk"   value={myTotalFreq + '×'} />
              </div>
              {/* Slot utilisation bar */}
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Slot utilisation</div>
                <div style={{ height: 6, background: 'var(--surface3)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{
                    width: `${Math.min(100, slotsUsed / slotCap * 100)}%`,
                    height: '100%',
                    background: slotsUsed / slotCap > 0.9 ? 'var(--red)' : slotsUsed / slotCap > 0.7 ? 'var(--yellow)' : 'var(--green)',
                    borderRadius: 3,
                  }} />
                </div>
              </div>
              {/* My routes list */}
              {myRoutes.length > 0 && (
                <div style={{ borderRadius: 'var(--radius)', overflow: 'hidden', border: '1px solid var(--border)' }}>
                  {myPairs.map((p, i) => {
                    const otherAp = getAirport(p.other);
                    return (
                      <div key={p.other} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px', borderTop: i > 0 ? '1px solid var(--border-subtle)' : 'none' }}>
                        <div style={{ flex: 1 }}>
                          <span style={{ fontWeight: 700, fontSize: 14 }}>{code} ⇄ {p.other}</span>
                          <span style={{ color: 'var(--text-muted)', fontSize: 12, marginLeft: 8 }}>{otherAp?.city}</span>
                        </div>
                        <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{p.frequency}× / wk</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
          {hubTier && (
            <div style={{ marginTop: 12, padding: '10px 12px', background: 'var(--surface2)', borderRadius: 'var(--radius)', fontSize: 12, borderLeft: `3px solid ${hubTier.color}` }}>
              <span style={{ color: hubTier.color, fontWeight: 700 }}>{hubTier.name}</span>
              <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>
                {Math.round(hubTier.captureRate * 100)}% connecting capture · +{hubTier.qualityBonus} quality pts on hub routes
              </span>
            </div>
          )}
        </div>

        {/* Gateway / connecting pool */}
        <div className="card">
          <div style={{ fontWeight: 600, marginBottom: 12 }}>Transit & Connectivity</div>
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginBottom: 14 }}>
            <Stat label="Gateway Score"    value={`${Math.round(gwScore * 100)}%`} sub="of traffic is transit" color={gwScore >= 0.65 ? 'var(--purple)' : gwScore >= 0.45 ? 'var(--accent)' : 'var(--text-muted)'} />
            <Stat label="Transit Pool"     value={Math.round(gwScore * 800).toLocaleString()} sub="weekly connecting pax available" />
          </div>
          <div style={{ height: 6, background: 'var(--surface3)', borderRadius: 3, overflow: 'hidden', marginBottom: 8 }}>
            <div style={{ width: `${Math.round(gwScore * 100)}%`, height: '100%', background: 'var(--purple)', borderRadius: 3 }} />
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 12 }}>
            {gwScore >= 0.65 ? 'Major international transit hub, high connecting traffic available' :
             gwScore >= 0.45 ? 'Significant gateway airport, moderate connecting traffic' :
             'Primary O&D airport, connecting traffic limited'}
          </div>
          {hubTier ? (
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              At <span style={{ color: hubTier.color, fontWeight: 600 }}>{hubTier.name}</span> tier, you capture ~
              <span style={{ color: 'var(--green)', fontWeight: 700 }}> {Math.round(gwScore * 800 * hubTier.captureRate)} pax/wk</span> from this pool per route.
            </div>
          ) : myGates > 0 ? (
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              Designate this as a hub (requires 10 gates) to start capturing connecting traffic.
            </div>
          ) : (
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              Buy gates here, then designate as a hub to unlock connecting traffic.
            </div>
          )}
          {transitFlows.length > 0 ? (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
                Connecting itineraries over {code}
                {hubTransit && <span style={{ textTransform: 'none', letterSpacing: 0, color: 'var(--text-dim)' }}> — {hubTransit.pax.toLocaleString()} pax · {formatMoney(hubTransit.revenue)}/wk across {hubTransit.markets} {hubTransit.markets === 1 ? 'market' : 'markets'}</span>}
              </div>
              <div style={{ borderRadius: 'var(--radius)', overflow: 'hidden', border: '1px solid var(--border)' }}>
                {transitFlows.slice(0, 12).map((e, i) => {
                  const barPct = Math.round(e.pax / maxTransitPax * 100);
                  const fromAp = getAirport(e.from);
                  const toAp   = getAirport(e.to);
                  return (
                    <div key={`${e.od}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 12px', borderTop: i > 0 ? '1px solid var(--border-subtle)' : 'none' }}>
                      <span style={{ fontWeight: 700, fontSize: 13, minWidth: 108 }} title={`${fromAp?.city ?? e.from} → ${toAp?.city ?? e.to}`}>{e.from} → {e.to}</span>
                      <div style={{ flex: 1, height: 5, background: 'var(--surface3)', borderRadius: 3, overflow: 'hidden', minWidth: 24 }}>
                        <div style={{ width: `${barPct}%`, height: '100%', background: 'var(--purple)', borderRadius: 3, opacity: 0.85 }} />
                      </div>
                      <span style={{ fontSize: 12, fontWeight: 600, minWidth: 62, textAlign: 'right' }}>{e.pax.toLocaleString()} pax</span>
                      <span style={{ fontSize: 12, color: 'var(--text-muted)', minWidth: 54, textAlign: 'right' }}>{formatMoney(e.revenue)}</span>
                    </div>
                  );
                })}
              </div>
              {partnerTransitPax > 0 && (
                <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 6 }}>
                  +{partnerTransitPax.toLocaleString()} pax/wk via partner-fed connections
                </div>
              )}
              <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 6 }}>
                Real connecting passengers you carried over {code} last week, by origin → destination.
              </div>
            </div>
          ) : (
            <div style={{ marginTop: 12, fontSize: 12, color: 'var(--text-dim)' }}>
              {hubTier
                ? <>No passengers connected over {code} last week — add spoke routes feeding both into and out of this hub so itineraries can form here.</>
                : <>No connecting itineraries over {code} yet — this fills in each week once {code} is a designated hub with spoke routes feeding through it.</>}
            </div>
          )}
        </div>

        {/* Airlines at this airport */}
        <div className="card">
          <div style={{ fontWeight: 600, marginBottom: 12 }}>
            Airlines at {code}
            <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--text-muted)', marginLeft: 8 }}>
              {airlinePresence.length} {airlinePresence.length === 1 ? 'carrier' : 'carriers'}
            </span>
          </div>
          {airlinePresence.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>No airline data available.</div>
          ) : (
            <div style={{ borderRadius: 'var(--radius)', overflow: 'hidden', border: '1px solid var(--border)' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: 'var(--surface2)' }}>
                    {['Airline', 'Type', 'Routes', 'Flights/wk'].map(h => (
                      <th key={h} style={{ padding: '6px 12px', textAlign: 'left', color: 'var(--text-muted)', fontWeight: 600 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {airlinePresence.map((a, i) => (
                    <tr key={a.id} style={{ borderTop: i > 0 ? '1px solid var(--border-subtle)' : 'none', background: a.isPlayer ? 'rgba(63,185,80,0.05)' : 'transparent' }}>
                      <td style={{ padding: '7px 12px', fontWeight: a.isPlayer ? 700 : 400, color: a.isPlayer ? 'var(--green)' : 'var(--text)' }}>
                        {a.isPlayer && '▶ '}{a.name}
                      </td>
                      <td style={{ padding: '7px 12px' }}>
                        {a.tier ? (
                          <span style={{ color: TIER_COLOR[a.tier] ?? 'var(--text-muted)', fontSize: 11, fontWeight: 700, textTransform: 'capitalize' }}>{a.tier}</span>
                        ) : <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>your airline</span>}
                      </td>
                      <td style={{ padding: '7px 12px', color: 'var(--text-muted)' }}>{a.routes}</td>
                      <td style={{ padding: '7px 12px', fontWeight: 600 }}>{a.frequency * 2}×</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Passenger flows — top pairs */}
        <div className="card" style={{ gridColumn: 'span 2' }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>
            Passenger Flows
            <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--text-muted)', marginLeft: 8 }}>
              top destinations by O&D demand
            </span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 12 }}>
            Total demand across top 15 pairs: {totalAirportDemand.toLocaleString()} pax/wk
          </div>
          <div style={{ overflowX: 'auto', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: 'var(--surface2)' }}>
                  {['Destination', 'O&D Demand', 'Ref Price', 'You', 'Competitors', 'Demand Bar'].map(h => (
                    <th key={h} style={{ padding: '7px 12px', textAlign: 'left', color: 'var(--text-muted)', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {topPairs.map((pair, i) => {
                  const iServe    = myRouteSet.has(pair.code);
                  const comps     = compRouteMap[pair.code] ?? [];
                  const maxDemand = topPairs[0]?.demand ?? 1;
                  const barPct    = Math.round(pair.demand / maxDemand * 100);
                  return (
                    <tr key={pair.code} style={{ borderTop: i > 0 ? '1px solid var(--border-subtle)' : 'none' }}>
                      <td style={{ padding: '7px 12px' }}>
                        <span style={{ fontWeight: 700 }}>{pair.code}</span>
                        <span style={{ color: 'var(--text-muted)', fontSize: 12, marginLeft: 6 }}>{pair.city}</span>
                      </td>
                      <td style={{ padding: '7px 12px', fontWeight: 600 }}>{pair.demand.toLocaleString()}</td>
                      <td style={{ padding: '7px 12px', color: 'var(--text-muted)' }}>${pair.refP}</td>
                      <td style={{ padding: '7px 12px' }}>
                        {iServe
                          ? <span style={{ color: 'var(--green)', fontSize: 12, fontWeight: 600 }}><Glyph e="✓" /> Serving</span>
                          : <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>—</span>
                        }
                      </td>
                      <td style={{ padding: '7px 12px' }}>
                        {comps.length > 0
                          ? <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{comps.map(c => c.name).join(', ')}</span>
                          : <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>—</span>
                        }
                      </td>
                      <td style={{ padding: '7px 12px', minWidth: 100 }}>
                        <div style={{ height: 5, background: 'var(--surface3)', borderRadius: 3, overflow: 'hidden' }}>
                          <div style={{
                            width: `${barPct}%`, height: '100%', borderRadius: 3,
                            background: iServe ? 'var(--green)' : 'var(--accent)', opacity: iServe ? 0.9 : 0.4,
                          }} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
