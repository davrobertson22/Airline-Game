import { useState, useEffect, useCallback } from 'react';
import { useConfirm } from './ConfirmModal.jsx';
import { useGame } from '../store/GameContext.jsx';
import { formatMoney, weekToGameDate } from '../utils/simulation.js';
import { makeRecord, SLOT_KEYS } from '../store/saveStore.js';
import AirlineLogo from './AirlineLogo.jsx';
import { SaveIcon, FolderOpenIcon, CloseIcon } from './Icons.jsx';

const NUM_SLOTS = SLOT_KEYS.length;

/** Bytes as something a player can read at a glance. */
function formatBytes(n) {
  if (!Number.isFinite(n)) return null;
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(n / 1e3))} KB`;
}

/**
 * Write a save slot, and SAY whether it worked.
 *
 * This used to call localStorage.setItem bare. When the browser's storage for
 * the site was full the call threw QuotaExceededError straight out of the click
 * handler: the slot list re-read and showed the OLD contents, no message
 * appeared, and the player was left believing they had saved.
 *
 * Slots now live in IndexedDB via saveStore, which is where the 5 MiB ceiling
 * went away — see store/saveStore.js for the measurements. This wrapper stays
 * because the `{ok, reason, message}` contract is what the banner below renders,
 * and because a browser with IndexedDB blocked still lands on localStorage and
 * can still fill it.
 *
 * @returns {{ok: boolean, reason?: 'quota'|'unavailable'|'error', message?: string}}
 */
export async function writeSlot(i, state, store) {
  if (!store) return { ok: false, reason: 'unavailable', message: 'This browser is not allowing the game to store data. Private browsing usually causes this.' };
  return store.write(SLOT_KEYS[i], makeRecord(SLOT_KEYS[i], state));
}

function SlotCard({ index, slot, mode, onSave, onLoad, onDelete }) {
  const isEmpty = !slot;
  // `slot` is a META record now — the card never needed the game state, and
  // deserialising three of them to draw three cards was pure cost.
  const gameDateStr = slot
    ? (() => {
        const { monthName, weekInMonth } = weekToGameDate(slot.week);
        const sy = slot.startYear;
        const yr = Number.isInteger(sy) ? String(sy + slot.year - 1) : `Yr ${slot.year}`;
        return `${monthName} wk ${weekInMonth}, ${yr}`;
      })()
    : null;
  const dateStr = slot?.savedAt
    ? new Date(slot.savedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
      + ' ' + new Date(slot.savedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : null;

  return (
    <div className={`save-slot${isEmpty ? ' save-slot-empty' : ''}`}>
      <div className="save-slot-header">
        <span className="save-slot-label">Slot {index + 1}</span>
        {!isEmpty && (
          <button className="save-slot-delete" onClick={() => onDelete(index)} title="Delete save"><CloseIcon size={13} /></button>
        )}
      </div>

      {isEmpty ? (
        <div className="save-slot-body save-slot-body-empty">
          <span className="save-slot-empty-text">Empty</span>
        </div>
      ) : (
        <div className="save-slot-body">
          <div className="save-slot-airline">
            <AirlineLogo id={slot.logoId} customSrc={slot.customLogo} size={26} radius={5} accentColor={slot.logoColor} />
            <div>
              <div className="save-slot-airline-name">{slot.airlineName}</div>
              <div className="save-slot-hub">{slot.hub}</div>
            </div>
          </div>
          <div className="save-slot-meta">
            <div className="save-slot-meta-row">
              <span className="save-slot-meta-label">Date</span>
              <span>{gameDateStr}</span>
            </div>
            <div className="save-slot-meta-row">
              <span className="save-slot-meta-label">Cash</span>
              <span style={{ color: slot.cash < 0 ? 'var(--red)' : 'var(--green)' }}>{formatMoney(slot.cash)}</span>
            </div>
            {dateStr && (
              <div className="save-slot-meta-row">
                <span className="save-slot-meta-label">Saved</span>
                <span className="save-slot-date">{dateStr}</span>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="save-slot-actions">
        {mode === 'save' && (
          <button className="btn btn-primary save-slot-btn" onClick={() => onSave(index)}>
            {isEmpty ? 'Save Here' : 'Overwrite'}
          </button>
        )}
        {mode === 'load' && !isEmpty && (
          <button className="btn btn-primary save-slot-btn" onClick={() => onLoad(index)}>
            Load
          </button>
        )}
        {mode === 'load' && isEmpty && (
          <span className="save-slot-empty-action">No save</span>
        )}
      </div>
    </div>
  );
}

export default function SaveLoadModal({ mode, onClose }) {
  const { state, dispatch, saveStore } = useGame();
  const confirm = useConfirm();
  // null while the list is still being read — IndexedDB cannot answer
  // synchronously, so the cards cannot be built in a useState initialiser any
  // more. Reading META only, so this stays fast however big the saves are.
  const [slots, setSlots] = useState(null);
  const [saveError, setSaveError] = useState(null);
  // How much room the browser is actually giving this game. A player who runs
  // out used to discover it by hitting it, and the message they got could be
  // advice they had no way to take ("delete another save slot", with two empty
  // slots on screen). A number on the screen is something they can act on, and
  // something they can put in a bug report.
  const [usage, setUsage] = useState(null);

  const refresh = useCallback(async () => {
    if (!saveStore) { setSlots(Array(NUM_SLOTS).fill(null)); return; }
    const metas = await saveStore.listMeta();
    setSlots(SLOT_KEYS.map(k => metas[k] ?? null));
  }, [saveStore]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    let live = true;
    (async () => {
      const est = await saveStore?.estimate?.();
      if (live && est?.usage != null && est?.quota) setUsage(est);
    })();
    return () => { live = false; };
  }, [saveStore]);

  async function handleSave(i) {
    const result = await writeSlot(i, state, saveStore);
    setSaveError(result.ok ? null : { slot: i, message: result.message });
    await refresh();
  }

  async function handleLoad(i) {
    const record = await saveStore?.read(SLOT_KEYS[i]);
    if (!record?.state) return;
    dispatch({ type: 'LOAD_STATE', payload: record.state });
    onClose();
  }

  async function handleDelete(i) {
    if (!await confirm({ title: `Delete slot ${i + 1}?`, body: 'This cannot be undone.', danger: true, confirmLabel: 'Delete slot' })) return;
    await saveStore?.delete(SLOT_KEYS[i]);
    setSaveError(null);
    await refresh();
  }

  return (
    <div className="saveload-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="saveload-modal">
        <div className="saveload-header">
          <h2 className="saveload-title" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            {mode === 'save' ? <><SaveIcon size={18} /> Save Game</> : <><FolderOpenIcon size={18} /> Load Game</>}
          </h2>
          <button className="saveload-close btn btn-ghost" onClick={onClose}><CloseIcon size={15} /></button>
        </div>
        <p className="saveload-hint">
          {mode === 'save'
            ? 'Pick a slot. Your game also auto-saves in the background as you play.'
            : 'Pick a slot to restore. Your current auto-save is unaffected.'}
        </p>
        {usage && (
          <p className="saveload-hint" style={{ marginTop: -6, opacity: 0.75, fontSize: '0.82rem' }}>
            Saves are using {formatBytes(usage.usage)} of {formatBytes(usage.quota)} this browser allows.
          </p>
        )}
        {saveError && (
          <p role="alert" style={{
            margin: '0 0 12px', padding: '10px 12px', borderRadius: 8,
            background: 'rgba(248,81,73,0.10)', border: '1px solid rgba(248,81,73,0.35)',
            color: 'var(--red)', fontSize: '0.9rem', lineHeight: 1.5,
          }}>
            <strong>Slot {saveError.slot + 1} was not saved.</strong> {saveError.message}
          </p>
        )}
        {slots === null ? (
          // Never draw three "Empty" cards over saves that are still loading —
          // a player who clicked Overwrite on a slot the list had not read yet
          // would be overwriting a save the screen told them was empty.
          <p className="saveload-hint" style={{ margin: '18px 0', textAlign: 'center' }}>Reading your saves…</p>
        ) : (
        <div className="save-slots">
          {slots.map((slot, i) => (
            <SlotCard
              key={i}
              index={i}
              slot={slot}
              mode={mode}
              onSave={handleSave}
              onLoad={handleLoad}
              onDelete={handleDelete}
            />
          ))}
        </div>
        )}
      </div>
    </div>
  );
}
