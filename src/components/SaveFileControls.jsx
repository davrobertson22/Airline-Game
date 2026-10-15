// Export / import of .twsave files — the player's own copy of their airline.
//
// NOT WIRED IN (2026-10-14): Dave held export / import back before shipping.
// Nothing imports this file. To ship it, re-add the "Back up to a file" section
// to SaveLoadModal.jsx and the import link to SetupScreen.jsx, and remove the
// @not-a-test marker from tools/save-file-ui-test.mjs, which checks both.
//
// Saves live in one browser profile (store/saveStore.js). A file is the only
// copy that survives clearing site data, a new device, or Safari's 7-day
// eviction, so this is offered to every player, free, from the Save / Load
// window and from the new-game screen (where someone arriving on a new device
// lands, with no game yet and no header to reach Load from).
//
// The format and its validation live in store/saveFile.js; this file is only
// the browser glue: the file picker, the confirm, the download.
import { useRef, useState } from 'react';
import { useGame } from '../store/GameContext.jsx';
import { useConfirm } from './ConfirmModal.jsx';
import { formatMoney } from '../utils/simulation.js';
import { metaFromState, requestPersistence } from '../store/saveStore.js';
import {
  encodeSaveFile, decodeSaveFile, downloadSaveFile, saveFileName, saveFileDateLabel,
} from '../store/saveFile.js';
import { UploadIcon } from './Icons.jsx';

/**
 * Write `state` to a .twsave and hand it to the browser as a download.
 * @returns {Promise<{ok: true, filename: string} | {ok: false, message: string}>}
 */
export async function exportGameToFile(state) {
  try {
    const bytes = await encodeSaveFile(state);
    const filename = saveFileName(metaFromState(state));
    if (!downloadSaveFile(bytes, filename)) {
      return { ok: false, message: 'This browser would not start the download. Your game is unchanged.' };
    }
    void requestPersistence();
    return { ok: true, filename };
  } catch {
    return { ok: false, message: 'The save file could not be made. Your game is unchanged.' };
  }
}

/**
 * A button that opens a file picker, reads a .twsave, confirms, and loads it.
 *
 * `replacing` says whether a game is running that the load would replace, so
 * the confirm can say so — on the new-game screen there is nothing to lose.
 */
export function ImportSaveButton({
  replacing = true, onDone, onError, className = 'btn btn-ghost', style, children,
}) {
  const { dispatch } = useGame();
  const confirm = useConfirm();
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);

  async function onPick(e) {
    const file = e.target.files?.[0];
    e.target.value = '';             // so picking the same file again still fires change
    if (!file) return;
    setBusy(true);
    try {
      const result = await decodeSaveFile(file);
      if (!result.ok) { onError?.(result.message); return; }
      const { meta, exportedAt } = result;
      const facts = [meta.hub, saveFileDateLabel(meta), Number.isFinite(meta.cash) ? `${formatMoney(meta.cash)} cash` : null]
        .filter(Boolean).join(' · ');
      const exported = exportedAt
        ? `\nExported ${new Date(exportedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}.`
        : '';
      const warning = replacing
        ? '\n\nThis replaces the game you are playing now. Save it to a slot or export it first if you want to keep it.'
        : '';
      const opts = { title: `Load ${meta.airlineName}?`, body: facts + exported + warning, confirmLabel: 'Load this airline' };
      const ok = confirm ? await confirm(opts) : window.confirm(`${opts.title}\n\n${opts.body}`);
      if (!ok) return;
      dispatch({ type: 'LOAD_STATE', payload: result.state });
      void requestPersistence();
      onError?.(null);
      onDone?.(meta);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button" className={className} style={style} disabled={busy}
        onClick={() => inputRef.current?.click()}
      >
        {children ?? <><UploadIcon size={14} /> {busy ? 'Reading…' : 'Import a save file'}</>}
      </button>
      {/* No `accept` filter: iOS greys out every extension it has no type for,
          .twsave included, so the player could not pick their own save. The
          content is sniffed instead (saveFile.js), so any file is safe to offer. */}
      <input
        ref={inputRef} type="file" onChange={onPick}
        style={{ display: 'none' }} aria-hidden="true" tabIndex={-1}
      />
    </>
  );
}
