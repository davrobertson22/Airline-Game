import { useState, useEffect } from 'react';
import { useGame } from '../store/GameContext.jsx';
import { formatMoney } from '../utils/simulation.js';
import {
  bellyCargoOn, bellyReferenceRate, bellyRateFor, bellyPairKey, BELLY_RATE_MIN_MULT, BELLY_RATE_MAX_MULT,
} from '../models/bellyCargo.js';

// ─────────────────────────────────────────────────────────────────────────────
// Belly cargo on a passenger route (models/bellyCargo.js, belly-cargo worlds).
//
// What the holds carried and earned, and the pair's belly rate. The rate is
// the pair's, like its fares: every aircraft you fly on the pair sells hold
// space at it. Leave it alone and it follows the market reference as that moves.
// ─────────────────────────────────────────────────────────────────────────────

const rateText = (r) => `$${r.toFixed(3)}`;

/**
 * @param {string} origin, destination
 * @param {Array}  results   this pair's route results (the tick's, or a preview's)
 * @param {string} [basis]   what the figures are: 'last week' | 'this week (projected)' …
 */
export default function BellyCargoPanel({ origin, destination, results = [], basis = 'last week' }) {
  const { state, dispatch } = useGame();
  const on  = bellyCargoOn(state);
  const key = bellyPairKey(origin, destination);
  const own = state.bellyRates?.[key] ?? null;
  const ref = on ? bellyReferenceRate(origin, destination) : 0;
  const rate = on ? bellyRateFor(state.bellyRates, origin, destination) : 0;
  const [draft, setDraft] = useState(rate.toFixed(3));
  useEffect(() => { setDraft(rate.toFixed(3)); }, [rate]);
  if (!on) return null;

  const sum = (k) => results.reduce((s, r) => s + (r?.[k] ?? 0), 0);
  const tonnes = sum('bellyTonnes'), capacity = sum('bellyCapacity');
  const revenue = sum('bellyRevenue'), cost = sum('bellyHandlingCost') + sum('bellyFuelCost');
  const fill = capacity > 0 ? tonnes / capacity : 0;
  const pctOfRef = ref > 0 ? Math.round((rate / ref - 1) * 100) : 0;

  const commit = () => {
    const v = parseFloat(draft);
    if (!Number.isFinite(v) || !(v > 0)) { setDraft(rate.toFixed(3)); return; }
    if (Math.abs(v - rate) < 0.0005) return;
    dispatch({ type: 'SET_BELLY_RATE', origin, destination, rate: v });
  };
  const nudge = (pct) => dispatch({ type: 'SET_BELLY_RATE', origin, destination, rate: rate * (1 + pct / 100) });

  const btn = { padding: '3px 8px', fontSize: 12, borderRadius: 6, border: '1px solid var(--border)',
    background: 'transparent', color: 'var(--text)', cursor: 'pointer' };

  return (
    <div data-testid="belly-cargo-panel" style={{ marginTop: 14, padding: '10px 12px', borderRadius: 8,
      background: 'var(--surface-2, rgba(255,255,255,0.03))', border: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 10, marginBottom: 6 }}>
        <span style={{ fontWeight: 600, fontSize: 13 }}>Belly cargo</span>
        <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>freight in the holds of these flights · {basis}</span>
      </div>
      {capacity > 0 ? (
        <div style={{ fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.6 }}>
          <strong style={{ color: 'var(--text)' }}>{Math.round(tonnes).toLocaleString()} t</strong> each way
          of {Math.round(capacity).toLocaleString()} t of hold space ({Math.round(fill * 100)}% full)
          {revenue > 0 && <> · <span style={{ color: 'var(--green)' }}>+{formatMoney(revenue)}</span> revenue,
            {' '}<span style={{ color: 'var(--red)' }}>−{formatMoney(cost)}</span> handling and carrying fuel,
            {' '}<strong style={{ color: revenue - cost >= 0 ? 'var(--green)' : 'var(--red)' }}>
              {revenue - cost >= 0 ? '+' : '−'}{formatMoney(Math.abs(revenue - cost))}</strong> net a week</>}
          {revenue <= 0 && tonnes <= 0 && <> · nothing loaded: at this rate the freight does not cover its handling and fuel, or the lane has none to offer</>}
        </div>
      ) : (
        <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
          No hold space to sell on this route: the aircraft is at its weight limit at this distance, or its hold is too small.
        </div>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 8, fontSize: 12.5 }}>
        <label htmlFor={`belly-rate-${key}`} style={{ color: 'var(--text-muted)' }}>Rate per tonne-km</label>
        <button type="button" style={btn} onClick={() => nudge(-5)} aria-label="Lower the belly rate 5%">−5%</button>
        <input id={`belly-rate-${key}`} type="number" step="0.005" min={(ref * BELLY_RATE_MIN_MULT).toFixed(3)} max={(ref * BELLY_RATE_MAX_MULT).toFixed(3)}
          value={draft} onChange={e => setDraft(e.target.value)} onBlur={commit}
          onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
          style={{ width: 84, padding: '3px 6px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 12.5 }} />
        <button type="button" style={btn} onClick={() => nudge(5)} aria-label="Raise the belly rate 5%">+5%</button>
        <span style={{ color: 'var(--text-dim)' }}>
          market {rateText(ref)}
          {own != null
            ? <> · yours is {pctOfRef >= 0 ? '+' : ''}{pctOfRef}%</>
            : <> · following the market</>}
        </span>
        {own != null && (
          <button type="button" style={btn} onClick={() => dispatch({ type: 'SET_BELLY_RATE', origin, destination, rate: null })}>
            Follow the market
          </button>
        )}
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 6, lineHeight: 1.5 }}>
        A dearer rate sells less of the hold and loses freight to rivals on the lane; a cheaper one fills more but each tonne
        still costs handling and fuel to carry. The best rate is usually near the market, and higher when fuel is dear.
      </div>
    </div>
  );
}
