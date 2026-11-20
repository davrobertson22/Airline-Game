import { useEffect, useState } from 'react';
import {
  AUTO_ADVANCE_PRESETS, MAX_AUTO_ADVANCE_MIN, MIN_AUTO_ADVANCE_MIN,
  autoAdvanceLabel, normalizeAutoAdvanceMin,
} from '../utils/autoAdvance.js';

/**
 * Pick how often the week advances on its own: a preset, Off, or a typed
 * number of minutes. Used in the map view's Settings menu and the classic
 * layout's auto-advance dialog.
 */
export default function AutoAdvancePicker({ value, onChange, compact = false }) {
  const v = normalizeAutoAdvanceMin(value);
  const isPreset = AUTO_ADVANCE_PRESETS.includes(v);
  const [custom, setCustom] = useState(!isPreset);
  const [draft, setDraft] = useState(String(v || 60));

  const commitDraft = () => {
    const n = normalizeAutoAdvanceMin(draft);
    setDraft(String(n || MIN_AUTO_ADVANCE_MIN));
    onChange(n || MIN_AUTO_ADVANCE_MIN);
  };

  const selectStyle = {
    background: 'var(--surface-2, var(--surface))', color: 'var(--text)', border: '1px solid var(--border)',
    borderRadius: 8, padding: '5px 8px', fontSize: 13, fontFamily: 'inherit', minWidth: compact ? 0 : 150,
  };

  return (
    <div data-auto-advance-picker style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <select
        aria-label="Auto-advance every"
        data-auto-advance-select
        value={custom ? 'custom' : String(v)}
        onChange={(e) => {
          if (e.target.value === 'custom') { setCustom(true); setDraft(String(v || 60)); return; }
          setCustom(false);
          onChange(normalizeAutoAdvanceMin(e.target.value));
        }}
        style={selectStyle}
      >
        {AUTO_ADVANCE_PRESETS.map(m => (
          <option key={m} value={String(m)}>{m === 0 ? 'Off (Next Week only)' : `Every ${autoAdvanceLabel(m)}`}</option>
        ))}
        <option value="custom">Custom…</option>
      </select>
      {custom && (
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-muted)' }}>
          <input
            type="number"
            data-auto-advance-custom
            min={MIN_AUTO_ADVANCE_MIN}
            max={MAX_AUTO_ADVANCE_MIN}
            step={1}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitDraft}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitDraft(); } }}
            style={{ ...selectStyle, width: 80, minWidth: 0 }}
          />
          minutes
        </label>
      )}
    </div>
  );
}

/** The classic layout's dialog around the picker. */
export function AutoAdvanceDialog({ value, onChange, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div
      className="alert-settings-overlay"
      data-auto-advance-dialog
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 2100, background: 'rgba(0,0,0,.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
    >
      <div role="dialog" aria-modal="true" aria-label="Auto-advance" style={{
        background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg, 14px)',
        width: 'min(420px, 100%)', boxShadow: '0 18px 44px -14px rgba(0,0,0,.6)', padding: '16px 18px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text)', flex: 1 }}>Auto-advance</div>
          <button type="button" onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--text-dim)' }}>×</button>
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5, margin: '0 0 12px' }}>
          How often the game flies a week on its own while it is open. You can always
          advance sooner with <b>Next Week</b>. Changing this restarts the countdown.
        </p>
        <AutoAdvancePicker value={value} onChange={onChange} />
      </div>
    </div>
  );
}
