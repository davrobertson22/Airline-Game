// News — your world's story, kept.
// ----------------------------------------------------------------------------
// Reads `state.newsLog`, which the reducer appends to every week (see
// models/newsLog.js). Nothing here fetches or computes: the simulation already
// decided what happened, this decides how it reads.
//
// Why a tab and not just the Weekly Debrief: the debrief answers "what happened
// this week" and then throws it away — it showed the first six competitor lines
// and no more. This answers "when did that fare war start", "what did the board
// pay me for that objective", "how long has that recession been running".
import { useState, useMemo } from 'react';
import { useGame } from '../store/GameContext.jsx';
import { getAircraftType } from '../data/aircraft.js';
import { formatMoney, yearLabel } from '../utils/simulation.js';
import { NewsIcon } from './Icons.jsx';

const CATEGORIES = [
  { id: 'world',       label: 'World',       icon: '🌍' },
  { id: 'competitors', label: 'Competitors', icon: '⚔️' },
  { id: 'fleet',       label: 'Fleet',       icon: '✈️' },
  { id: 'company',     label: 'Company',     icon: '🏢' },
];

const PAGE = 60;

const typeName = (id) => getAircraftType(id)?.name ?? id ?? 'an aircraft';
const plural = (n, one, many) => `${Number(n ?? 0).toLocaleString()} ${n === 1 ? one : many}`;
const pair = (routeKey) => (routeKey ? routeKey.replace('-', '–') : null);

// Returns { headline, sub, list } — `headline` follows the subject when there
// is one, and stands alone when there isn't.
function compose(item) {
  const d = item.data ?? {};

  switch (item.kind) {
    case 'event_started':
      return { headline: '', sub: d.description ?? null };
    case 'event_ended':
      return { headline: 'has passed', sub: 'Conditions are back to normal.' };

    case 'delivery_arrived': {
      const parts = Object.entries(d.byType ?? {})
        .sort((a, b) => b[1] - a[1])
        .map(([id, n]) => (n > 1 ? `${n}× ${typeName(id)}` : `a ${typeName(id)}`));
      return {
        headline: `${parts.join(' and ') || plural(d.total, 'aircraft', 'aircraft')} joined your fleet`,
        sub: d.names?.length ? d.names.join(', ') : null,
        standalone: true,
      };
    }
    case 'check_forced':
      return {
        headline: `${plural(d.total, 'aircraft', 'aircraft')} grounded for an overdue ${(d.checkTypes ?? []).join('/')} check`,
        sub: d.names?.length ? d.names.join(', ') : null,
        standalone: true,
      };
    case 'check_completed':
      return {
        headline: `${plural(d.total, 'aircraft', 'aircraft')} back in service after a ${(d.checkTypes ?? []).join('/')} check`,
        sub: d.names?.length ? d.names.join(', ') : null,
        standalone: true,
      };
    case 'mechanical_failure':
      return {
        headline: `— ${d.label}`,
        sub: `Grounded ${plural(d.weeksGrounded, 'week', 'weeks')}${d.tailNumber ? ` · ${d.tailNumber}` : ''}`,
      };

    case 'objective_complete':
      return {
        headline: `Objective complete — ${d.title}`,
        sub: [d.desc, d.reward ? `Board reward ${formatMoney(d.reward)}` : null]
          .filter(Boolean).join(' · ') || null,
        standalone: true,
      };
    case 'record_week':
      return {
        headline: `Best week yet — ${formatMoney(d.profit)} profit`,
        sub: d.previousBest > 0 ? `Previous best was ${formatMoney(d.previousBest)}.` : null,
        standalone: true,
      };

    case 'competitor_note':
      return { headline: '', sub: d.description ?? null, standalone: true };

    // One-off migration: a schedule that was flying past the physical
    // block-hour limit was trimmed back. Spelled out in full — this changed
    // something the player paid for.
    case 'schedule_trim': {
      const cuts = (d.cuts ?? []).map(c => {
        const lane = `${c.origin}–${c.destination}`;
        return c.closed
          ? `${lane} closed (was ${c.fromFrequency}/wk)`
          : `${lane} ${c.fromFrequency} → ${c.toFrequency}/wk`;
      });
      return {
        headline: `was trimmed to the ${d.capHours}h weekly flying limit`,
        sub: `${d.aircraft ?? 'It'} was scheduled for ${Math.round(d.peakBefore ?? 0)}h a week against a `
           + `${d.capHours}h limit. ${cuts.join(' · ')}${cuts.length ? '.' : ''}`,
      };
    }

    default: {
      // Competitor events. A single move keeps the simulation's own sentence;
      // a rolled-up week gets a summary plus the full list on demand.
      if (!item.kind.startsWith('competitor_')) return { headline: item.kind };
      if (d.description) return { headline: '', sub: d.description, standalone: true };
      if (d.total > 1) {
        return {
          headline: `${plural(d.total, 'route', 'routes')} ${d.verb ?? 'changed'} across the market`,
          standalone: true,
          list: (d.entries ?? []).map((e) => `${e.airline ?? 'A carrier'} · ${pair(e.routeKey) ?? '—'}`),
        };
      }
      return { headline: '', sub: d.description ?? null, standalone: true };
    }
  }
}

// Anything touching your own network. Solo has your routes right there in
// state, so this needs no plumbing at all.
function useMyNetwork() {
  const { state } = useGame();
  return useMemo(() => {
    const airports = new Set([
      ...Object.keys(state?.gates ?? {}),
      ...Object.keys(state?.hubs ?? {}),
    ]);
    const pairs = new Set();
    for (const r of [...(state?.routes ?? []), ...(state?.cargoRoutes ?? [])]) {
      if (!r?.origin || !r?.destination) continue;
      airports.add(r.origin);
      airports.add(r.destination);
      pairs.add([r.origin, r.destination].sort().join('-'));
    }
    return { airports, pairs };
  }, [state?.routes, state?.cargoRoutes, state?.gates, state?.hubs]);
}

function touchesMe(item, net) {
  // Your own fleet and company news is always about you.
  if (item.category === 'fleet' || item.category === 'company') return true;
  const keys = [
    ...(item.data?.routes ?? []),
    ...(item.data?.routeKey ? [item.data.routeKey] : []),
  ];
  for (const k of keys) {
    const [a, b] = String(k).split('-');
    if (!a || !b) continue;
    if (net.pairs.has([a, b].sort().join('-'))) return true;
    if (net.airports.has(a) || net.airports.has(b)) return true;
  }
  if (item.data?.airport && net.airports.has(item.data.airport)) return true;
  return false;
}

export default function News() {
  const { state } = useGame();
  const net = useMyNetwork();

  const [active, setActive] = useState(() => new Set(CATEGORIES.map((c) => c.id)));
  const [bigOnly, setBigOnly] = useState(false);
  const [nearOnly, setNearOnly] = useState(false);
  const [shownCount, setShownCount] = useState(PAGE);
  const [expanded, setExpanded] = useState(() => new Set());

  const log = state?.newsLog ?? [];

  const items = useMemo(() => {
    // Stored oldest-first (append is a push); the page reads newest-first.
    const out = [];
    for (let i = log.length - 1; i >= 0; i--) {
      const it = log[i];
      if (!active.has(it.category)) continue;
      const near = touchesMe(it, net);
      const tier = near && it.category === 'competitors' ? 1 : it.tier;
      if (bigOnly && tier !== 1) continue;
      if (nearOnly && !near) continue;
      out.push({ ...it, near, effectiveTier: tier });
    }
    return out;
  }, [log, active, net, bigOnly, nearOnly]);

  const page = items.slice(0, shownCount);

  const toggleCategory = (id) => {
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      // Never let the player filter everything away — a blank screen reads broken.
      return next.size === 0 ? new Set([id]) : next;
    });
    setShownCount(PAGE);
  };

  const chip = (on) => ({
    padding: '4px 10px', borderRadius: 999, fontSize: 12, cursor: 'pointer',
    border: `1px solid ${on ? 'var(--accent)' : 'var(--border, rgba(255,255,255,0.14))'}`,
    background: on ? 'color-mix(in srgb, var(--accent) 18%, transparent)' : 'transparent',
    color: on ? 'var(--accent)' : 'var(--text-dim, #9aa)',
    whiteSpace: 'nowrap',
  });

  let lastWeekKey = null;

  return (
    <div className="panel" style={{ maxWidth: 900 }}>
      <h2 style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 0 }}>
        <NewsIcon size={18} /> News
      </h2>
      <p className="muted" style={{ marginTop: -6, fontSize: 13 }}>
        What's happened in your world, newest first — the competition's moves, the economy,
        and your own milestones. Your weekly results stay in the debrief.
      </p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '12px 0' }}>
        {CATEGORIES.map((c) => (
          <button key={c.id} style={chip(active.has(c.id))} onClick={() => toggleCategory(c.id)}>
            {c.icon} {c.label}
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
        <button style={chip(bigOnly)} onClick={() => { setBigOnly((v) => !v); setShownCount(PAGE); }}>
          ★ Big moves only
        </button>
        <button style={chip(nearOnly)} onClick={() => { setNearOnly((v) => !v); setShownCount(PAGE); }}>
          📍 Near my network
        </button>
      </div>

      {log.length === 0 && (
        <p className="muted">
          Nothing yet — news starts building from your next week. Advance the clock and the
          world will get on with it.
        </p>
      )}
      {log.length > 0 && page.length === 0 && (
        <p className="muted">Nothing matches these filters.</p>
      )}

      {page.map((it) => {
        const c = compose(it);
        const weekKey = `Y${it.year} W${it.week}`;
        const divider = weekKey !== lastWeekKey ? weekKey : null;
        lastWeekKey = weekKey;
        const isOpen = expanded.has(it.id);
        const subject = c.standalone ? null : it.subject;

        return (
          <div key={it.id}>
            {divider && (
              <div style={{
                margin: '16px 0 6px', padding: '3px 0',
                fontSize: 11, letterSpacing: 1, textTransform: 'uppercase',
                color: 'var(--text-dim, #8a94a6)',
                borderBottom: '1px solid var(--border, rgba(255,255,255,0.10))',
              }}>
                {yearLabel(state, it.year)} · Week {it.week}
              </div>
            )}
            <div style={{
              display: 'flex', gap: 10, alignItems: 'baseline',
              padding: '9px 6px 9px 10px',
              borderBottom: '1px solid var(--border, rgba(255,255,255,0.07))',
              fontSize: 13.5, lineHeight: 1.55,
              borderLeft: it.effectiveTier === 1 ? '2px solid var(--accent)' : '2px solid transparent',
            }}>
              <span style={{ flexShrink: 0, fontSize: 15 }}>{it.icon ?? '•'}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                {subject ? <strong>{subject}</strong> : null}
                {c.headline ? `${subject ? ' ' : ''}${c.headline}` : ''}
                {c.sub && <div style={{ opacity: 0.7, fontSize: 12.5 }}>{c.sub}</div>}
                {c.list?.length > 0 && (
                  <div>
                    <button
                      onClick={() => setExpanded((p) => {
                        const n = new Set(p);
                        if (n.has(it.id)) n.delete(it.id); else n.add(it.id);
                        return n;
                      })}
                      style={{
                        background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                        color: 'var(--accent)', fontSize: 12,
                      }}
                    >
                      {isOpen ? 'Hide' : `Show all ${c.list.length}`}
                    </button>
                    <div style={{ opacity: 0.65, fontSize: 12.5, marginTop: 2 }}>
                      {(isOpen ? c.list : c.list.slice(0, 2)).map((line, i) => (
                        <div key={i}>{line}</div>
                      ))}
                      {!isOpen && c.list.length > 2 && <div>+{c.list.length - 2} more</div>}
                    </div>
                  </div>
                )}
              </span>
            </div>
          </div>
        );
      })}

      {items.length > page.length && (
        <button
          className="btn"
          style={{ margin: '16px auto', display: 'block' }}
          onClick={() => setShownCount((n) => n + PAGE)}
        >
          Show older news
        </button>
      )}
      {log.length >= 250 && items.length === page.length && page.length > 0 && (
        <p className="muted" style={{ textAlign: 'center', marginTop: 16, fontSize: 12 }}>
          That's as far back as your save keeps news.
        </p>
      )}
    </div>
  );
}

export { compose };
