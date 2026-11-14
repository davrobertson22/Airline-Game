// HistoryCard — an aviation-history milestone, shown the week it happens.
// ----------------------------------------------------------------------------
// Era games only. The milestones live in data/historyMilestones.js and are a
// function of the calendar, so this card reads nothing from the save beyond the
// date (and launchPrograms, for the launch-customer line). Every milestone is in
// the News tab too; this decides which ones also interrupt, per the player's
// All / Major only / Off setting (utils/historyPrefs.js).
//
// When it pops up:
//   • the week moved on by exactly one while the game was open (a normal week),
//     or a new game has just opened on week 1 (its era card);
//   • never for weeks skipped over (a reload, a long absence): those are in the
//     News tab, and a pile of cards on return would bury the away digest;
//   • it waits for the weekly debrief and the away digest to be dismissed, so
//     only one full-screen card is up at a time.
import { useEffect, useRef, useState } from 'react';
import { useGame } from '../store/GameContext.jsx';
import { historyRowsForWeek, historyRowPopsUp } from '../data/historyMilestones.js';
import { HISTORY_MODES, loadHistoryMode, saveHistoryMode, subscribeHistoryMode } from '../utils/historyPrefs.js';
import { subscribeAwayDigest, pendingAwayWeeks } from '../utils/awayDigest.js';

const absOf = (s) => (((s?.year ?? 1) - 1) * 52) + (s?.week ?? 1);

/**
 * Which week's rows to queue after a clock change, or null. Pure, for the test.
 * `prevAbs` is the week last seen (null on first mount).
 */
export function historyWeekToShow(prevAbs, nowAbs) {
  if (prevAbs == null) return nowAbs === 1 ? 1 : null;   // first mount: only a brand-new game
  if (nowAbs === prevAbs + 1) return nowAbs;              // an ordinary week
  if (nowAbs === 1 && prevAbs !== 1) return 1;            // a new game started in this tab
  return null;                                            // a jump: News tab only
}

// `initialQueue` is for the test's server render only; the game mounts it bare.
export default function HistoryCard({ initialQueue = [] } = {}) {
  const { state } = useGame();
  const isEra = Number.isInteger(state?.startYear) && state?.phase === 'playing';
  const nowAbs = absOf(state);

  const [mode, setMode] = useState(loadHistoryMode);
  useEffect(() => subscribeHistoryMode(setMode), []);
  const [awayWeeks, setAwayWeeks] = useState(pendingAwayWeeks);
  useEffect(() => subscribeAwayDigest(setAwayWeeks), []);

  const [queue, setQueue] = useState(initialQueue);
  const lastSeen = useRef(null);

  useEffect(() => {
    if (!isEra) { lastSeen.current = null; setQueue([]); return; }
    const week = historyWeekToShow(lastSeen.current, nowAbs);
    if (nowAbs === 1 && lastSeen.current !== 1) setQueue([]);   // a new game drops the old one's cards
    lastSeen.current = nowAbs;
    if (week == null) return;
    const rows = historyRowsForWeek({
      startYear: state.startYear, year: state.year, week: state.week, launchPrograms: state.launchPrograms,
    }).filter(r => historyRowPopsUp(r, loadHistoryMode()));
    if (rows.length) setQueue(q => [...q, ...rows.filter(r => !q.some(x => x.id === r.id))]);
  }, [isEra, nowAbs, state?.startYear]); // eslint-disable-line react-hooks/exhaustive-deps

  const card = queue[0];
  const visible = isEra && card && !state.showDebrief && awayWeeks === 0;

  useEffect(() => {
    if (!visible) return;
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); setQueue(q => q.slice(1)); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible]);

  if (!visible) return null;

  const d = card.data ?? {};
  const rest = queue.length - 1;
  const close = () => setQueue(q => q.slice(1));
  const choose = (id) => {
    saveHistoryMode(id);
    if (id === 'off') setQueue([]);
    else if (id === 'major') setQueue(q => [q[0], ...q.slice(1).filter(r => historyRowPopsUp(r, 'major'))].filter(Boolean));
  };

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) close(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 905, background: 'rgba(0,0,0,.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
    >
      <div role="dialog" aria-modal="true" aria-label={card.subject} className="history-card" style={{
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderTop: '3px solid var(--accent)', borderRadius: 'var(--radius-lg, 14px)',
        width: 'min(480px, 100%)', maxHeight: 'calc(100vh - 32px)', overflowY: 'auto',
        boxShadow: '0 18px 44px -14px rgba(0,0,0,.6)', padding: '18px 20px 16px',
      }}>
        <div style={{ fontSize: 11, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--text-dim)', marginBottom: 6 }}>
          🕰 {d.milestoneKind === 'era' ? 'A new era' : 'Aviation history'}{d.dateLabel ? ` · ${d.dateLabel}` : ''}
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
          <span style={{ fontSize: 22 }}>{card.icon}</span>
          <h3 style={{ margin: 0, fontSize: 19, color: 'var(--text)' }}>{card.subject}</h3>
        </div>
        <p style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--text-muted)', margin: '12px 0 0' }}>{d.body}</p>
        {d.launchCustomer && (
          <p style={{ fontSize: 13.5, lineHeight: 1.5, color: 'var(--accent)', margin: '10px 0 0', fontWeight: 600 }}>
            🏅 Your airline is one of its launch customers.
          </p>
        )}
        {d.unlocks && (
          <p style={{ fontSize: 13.5, lineHeight: 1.5, color: 'var(--text)', margin: '10px 0 0' }}>{d.unlocks}</p>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
          <span style={{ fontSize: 11.5, color: 'var(--text-dim)', marginRight: 2 }}>History pop-ups:</span>
          {HISTORY_MODES.map(m => (
            <button key={m.id} type="button" onClick={() => choose(m.id)} style={{
              padding: '3px 9px', borderRadius: 999, fontSize: 11.5, cursor: 'pointer',
              border: `1px solid ${mode === m.id ? 'var(--accent)' : 'var(--border)'}`,
              background: mode === m.id ? 'color-mix(in srgb, var(--accent) 18%, transparent)' : 'transparent',
              color: mode === m.id ? 'var(--accent)' : 'var(--text-dim)',
            }}>{m.label}</button>
          ))}
          <span style={{ flex: 1 }} />
          <button type="button" className="btn btn-primary" onClick={close} autoFocus>
            {rest > 0 ? `Next (${rest} more)` : 'Close'}
          </button>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 8 }}>
          Every milestone stays in the News tab under History.
        </div>
      </div>
    </div>
  );
}
