// Cloud saves — the supporter perk's half of the Save / Load window.
//
// A player signs in with their Headwinds account and gets three cloud slots
// that follow them to any browser or device. Uploading is the perk; loading
// and deleting stay open to every signed-in account, so a lapsed supporter
// keeps what they put there (docs/cloud-save-design.md). The server enforces
// all of that; this screen just never offers what the server would refuse.
//
// CloudSavesView is the whole look, driven by props, so the render tests can
// show every state without a network. CloudSaves (default export) is the
// container that signs in, lists, uploads, loads and deletes.
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useGame } from '../store/GameContext.jsx';
import { useConfirm } from './ConfirmModal.jsx';
import { formatMoney, weekToGameDate } from '../utils/simulation.js';
import AirlineLogo from './AirlineLogo.jsx';
import { CloseIcon } from './Icons.jsx';
import { encodeSaveFile, decodeSaveFile, saveFileDateLabel } from '../store/saveFile.js';
import { confirmAndLoadSave } from './SaveFileControls.jsx';
import { cloudApi, uploadWithConflictCheck, deviceLabel } from '../cloud/cloudApi.js';
import {
  hasStoredSession, currentSession, accessToken, signInWithProvider, sendEmailLink, signOut, sessionLabel,
} from '../cloud/cloudAuth.js';
import { CLOUD_SLOTS, cloudSavesEnabled } from '../cloud/cloudConfig.js';

const SUPPORT_URL = '/support.html';

function when(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function gameDate(meta) {
  if (!Number.isFinite(meta?.week)) return saveFileDateLabel(meta);
  const { monthName, weekInMonth } = weekToGameDate(meta.week);
  const yr = Number.isInteger(meta.startYear) ? String(meta.startYear + meta.year - 1) : `Yr ${meta.year}`;
  return `${monthName} wk ${weekInMonth}, ${yr}`;
}

/** "Atlantic Airways (1991 wk 12), uploaded 14 Oct from Chrome on Mac" */
export function describeCloudSlot(slot) {
  if (!slot) return 'nothing';
  const m = slot.meta ?? {};
  const from = slot.deviceLabel ? ` from ${slot.deviceLabel}` : '';
  return `${m.airlineName ?? 'An airline'} (${saveFileDateLabel(m)}), uploaded ${when(slot.uploadedAt)}${from}`;
}

/** The question asked when another device changed a slot between list and upload. */
export function conflictQuestion(index, current, airlineName) {
  return current
    ? {
        title: `Cloud ${index + 1} changed on another device`,
        body: `It now holds ${describeCloudSlot(current)}.\n\nReplace it with ${airlineName} as you have it here?`,
        confirmLabel: 'Replace it', danger: true,
      }
    : {
        title: `Cloud ${index + 1} was emptied on another device`,
        body: `Upload ${airlineName} into it?`,
        confirmLabel: 'Upload',
      };
}

// ── View ──────────────────────────────────────────────────────────────────────

function CloudSlotCard({ index, slot, mode, canUploadHere, busy, onUpload, onLoad, onDelete }) {
  const empty = !slot;
  const m = slot?.meta ?? {};
  return (
    <div className={`save-slot cloud-slot${empty ? ' save-slot-empty' : ''}`}>
      <div className="save-slot-header">
        <span className="save-slot-label">{`Cloud ${index + 1}`}</span>
        {!empty && (
          <button className="save-slot-delete" onClick={() => onDelete(index)} title="Delete cloud save" disabled={busy}>
            <CloseIcon size={13} />
          </button>
        )}
      </div>
      {empty ? (
        <div className="save-slot-body save-slot-body-empty"><span className="save-slot-empty-text">Empty</span></div>
      ) : (
        <div className="save-slot-body">
          <div className="save-slot-airline">
            <AirlineLogo id={m.logoId} customSrc={m.customLogo} size={26} radius={5} accentColor={m.logoColor} bgColor={m.logoBg} />
            <div>
              <div className="save-slot-airline-name">{m.airlineName}</div>
              <div className="save-slot-hub">{m.hub}</div>
            </div>
          </div>
          <div className="save-slot-meta">
            <div className="save-slot-meta-row"><span className="save-slot-meta-label">Date</span><span>{gameDate(m)}</span></div>
            {Number.isFinite(m.cash) && (
              <div className="save-slot-meta-row">
                <span className="save-slot-meta-label">Cash</span>
                <span style={{ color: m.cash < 0 ? 'var(--red)' : 'var(--green)' }}>{formatMoney(m.cash)}</span>
              </div>
            )}
            <div className="save-slot-meta-row">
              <span className="save-slot-meta-label">Uploaded</span>
              <span className="save-slot-date">{when(slot.uploadedAt)}{slot.deviceLabel ? ` · ${slot.deviceLabel}` : ''}</span>
            </div>
          </div>
        </div>
      )}
      <div className="save-slot-actions">
        {mode === 'save' && canUploadHere && (
          <button className="btn btn-primary save-slot-btn" onClick={() => onUpload(index)} disabled={busy}>
            {busy ? 'Uploading…' : empty ? 'Upload here' : 'Replace'}
          </button>
        )}
        {mode === 'load' && !empty && (
          <button className="btn btn-primary save-slot-btn" onClick={() => onLoad(index)} disabled={busy}>
            {busy ? 'Loading…' : 'Load'}
          </button>
        )}
        {mode === 'load' && empty && <span className="save-slot-empty-action">No save</span>}
      </div>
    </div>
  );
}

function SignInPanel({ emailSent, onSignIn, onEmail }) {
  const [email, setEmail] = useState('');
  return (
    <div className="cloud-signin">
      <p className="cloud-text">
        Supporters can keep up to three airlines in the cloud and pick them up in any browser,
        on any device. Sign in with your Headwinds account: it&rsquo;s the same login.
      </p>
      <div className="cloud-actions">
        <button type="button" className="btn btn-ghost" onClick={() => onSignIn('google')}>Continue with Google</button>
        <button type="button" className="btn btn-ghost" onClick={() => onSignIn('discord')}>Continue with Discord</button>
        <a className="cloud-link" href={SUPPORT_URL} target="_blank" rel="noopener noreferrer">What&rsquo;s this?</a>
      </div>
      {emailSent ? (
        <p className="cloud-text cloud-sent">Check your email for a sign-in link, and open it in this browser.</p>
      ) : (
        <form className="cloud-email" onSubmit={(e) => { e.preventDefault(); if (email.trim()) onEmail(email.trim()); }}>
          <input
            type="email" required placeholder="or email me a sign-in link" value={email}
            onChange={(e) => setEmail(e.target.value)} aria-label="Email address"
          />
          <button type="submit" className="btn btn-ghost">Send link</button>
        </form>
      )}
    </div>
  );
}

/**
 * @param {{ status: 'checking'|'signedOut'|'signedIn', who?: string, cloud?: {supporter: boolean, slots: Array}|null,
 *           mode: 'save'|'load', canUpload: boolean, busySlot?: number|null, note?: {kind, text}|null,
 *           emailSent?: boolean, onSignIn, onEmail, onSignOut, onUpload, onLoad, onDelete }} p
 */
export function CloudSavesView(p) {
  const { status, who, cloud, mode, canUpload, busySlot = null, note = null } = p;
  const supporter = !!cloud?.supporter;
  const slots = cloud ? Array.from({ length: CLOUD_SLOTS }, (_, i) => cloud.slots?.[i] ?? null) : null;
  return (
    <section className="cloud-saves" aria-label="Cloud saves">
      <div className="cloud-head">
        <strong>Cloud saves</strong>
        <span className="cloud-chip">&#9829; Supporter perk</span>
        {status === 'signedIn' && (
          <span className="cloud-who">
            {who} · <button type="button" className="cloud-linkbtn" onClick={p.onSignOut}>Sign out</button>
          </span>
        )}
      </div>

      {status === 'checking' && <p className="cloud-text">Checking your sign-in…</p>}

      {status === 'signedOut' && <SignInPanel emailSent={p.emailSent} onSignIn={p.onSignIn} onEmail={p.onEmail} />}

      {status === 'signedIn' && (
        <>
          {mode === 'save' && cloud && !supporter && (
            <p className="cloud-text">
              Uploading to the cloud is a thank-you for people who{' '}
              <a className="cloud-link" href={SUPPORT_URL} target="_blank" rel="noopener noreferrer">support the game</a>.
              Any cloud saves you already have stay yours to load.
            </p>
          )}
          {mode === 'save' && cloud && supporter && !canUpload && (
            <p className="cloud-text">Start or load a game to upload it.</p>
          )}
          {slots === null ? (
            <p className="cloud-text">Reading your cloud saves…</p>
          ) : (
            <div className="save-slots">
              {slots.map((slot, i) => (
                <CloudSlotCard
                  key={i} index={i} slot={slot} mode={mode}
                  canUploadHere={supporter && canUpload}
                  busy={busySlot === i}
                  onUpload={p.onUpload} onLoad={p.onLoad} onDelete={p.onDelete}
                />
              ))}
            </div>
          )}
          <p className="cloud-fine">Best effort: cloud saves run on the same hobby servers as Headwinds.</p>
        </>
      )}

      {note && (
        <p role={note.kind === 'error' ? 'alert' : 'status'} className={`cloud-note cloud-note-${note.kind}`}>{note.text}</p>
      )}
    </section>
  );
}

// ── Container ─────────────────────────────────────────────────────────────────

/** The cloud section, or nothing at all until launch (cloudConfig.js, CLOUD_SAVES_LIVE). */
export default function CloudSaves(props) {
  return cloudSavesEnabled() ? <CloudSavesPanel {...props} /> : null;
}

function CloudSavesPanel({ mode, canUpload, onLoaded, notice = null }) {
  const { state, dispatch } = useGame();
  const confirm = useConfirm();
  const ask = useCallback(
    (opts) => (confirm ? confirm(opts) : Promise.resolve(window.confirm(`${opts.title}\n\n${opts.body ?? ''}`))),
    [confirm],
  );
  const [status, setStatus] = useState(() => (hasStoredSession() ? 'checking' : 'signedOut'));
  const [who, setWho] = useState(null);
  const [cloud, setCloud] = useState(null);
  const [busySlot, setBusySlot] = useState(null);
  const [note, setNote] = useState(notice ? { kind: 'error', text: notice } : null);
  const [emailSent, setEmailSent] = useState(false);
  const api = useMemo(() => cloudApi({ getToken: () => accessToken() }), []);

  const fail = useCallback((err) => {
    if (err?.kind === 'signedOut') { setStatus('signedOut'); setCloud(null); setWho(null); }
    setNote({ kind: 'error', text: err?.message || 'That did not work. Your game here is unaffected.' });
  }, []);

  const refresh = useCallback(async () => {
    try { setCloud(await api.list()); } catch (e) { fail(e); }
  }, [api, fail]);

  useEffect(() => {
    if (status !== 'checking') return undefined;
    let live = true;
    (async () => {
      const session = await currentSession();
      if (!live) return;
      if (!session) { setStatus('signedOut'); return; }
      setWho(sessionLabel(session));
      setStatus('signedIn');
    })();
    return () => { live = false; };
  }, [status]);

  useEffect(() => { if (status === 'signedIn') void refresh(); }, [status, refresh]);

  async function onSignIn(provider) {
    setNote(null);
    try { await signInWithProvider(provider, mode); } catch (e) { setNote({ kind: 'error', text: e.message }); }
  }

  async function onEmail(email) {
    setNote(null);
    try { await sendEmailLink(email, mode); setEmailSent(true); } catch (e) { setNote({ kind: 'error', text: e.message }); }
  }

  async function onSignOut() {
    await signOut();
    setStatus('signedOut'); setCloud(null); setWho(null); setNote(null); setEmailSent(false);
  }

  async function onUpload(i) {
    const slot = cloud?.slots?.[i] ?? null;
    // Replacing a DIFFERENT airline deserves a question; refreshing your own does not
    // (the same rule-of-thumb as overwriting a local slot).
    if (slot && slot.meta?.airlineName !== state.airlineName) {
      const ok = await ask({
        title: `Replace Cloud ${i + 1}?`,
        body: `It holds ${describeCloudSlot(slot)}.\n\nReplace it with ${state.airlineName}?`,
        confirmLabel: 'Replace it', danger: true,
      });
      if (!ok) return;
    }
    setBusySlot(i); setNote(null);
    try {
      const bytes = await encodeSaveFile(state);
      const r = await uploadWithConflictCheck({
        api, slot: i, bytes, baseUploadedAt: slot?.uploadedAt ?? null, device: deviceLabel(),
        confirmReplace: (current) => ask(conflictQuestion(i, current, state.airlineName)),
      });
      if (r.ok) setNote({ kind: 'ok', text: `${state.airlineName} is in Cloud ${i + 1}. To carry on elsewhere, sign in the same way on that device and load it. It is a copy, not live sync: upload again from whichever device you played on last.` });
      else if (r.conflict) setNote({ kind: 'error', text: `Cloud ${i + 1} changed again while you were deciding, so nothing was uploaded. Have another look and try again.` });
      await refresh();
    } catch (e) {
      fail(e);
    } finally {
      setBusySlot(null);
    }
  }

  async function onLoad(i) {
    setBusySlot(i); setNote(null);
    try {
      const result = await decodeSaveFile(await api.load(i));
      if (!result.ok) { setNote({ kind: 'error', text: result.message }); return; }
      const slot = cloud?.slots?.[i];
      const uploaded = slot ? `Uploaded ${when(slot.uploadedAt)}${slot.deviceLabel ? ` from ${slot.deviceLabel}` : ''}.` : null;
      if (await confirmAndLoadSave({ result, confirm, dispatch, replacing: state.phase !== 'setup', when: uploaded })) onLoaded?.();
    } catch (e) {
      fail(e);
    } finally {
      setBusySlot(null);
    }
  }

  async function onDelete(i) {
    const slot = cloud?.slots?.[i];
    if (!slot) return;
    const ok = await ask({
      title: `Delete Cloud ${i + 1}?`,
      body: `${describeCloudSlot(slot)}.\n\nThis cannot be undone.`,
      confirmLabel: 'Delete cloud save', danger: true,
    });
    if (!ok) return;
    setBusySlot(i); setNote(null);
    try { await api.remove(i); await refresh(); } catch (e) { fail(e); } finally { setBusySlot(null); }
  }

  return (
    <CloudSavesView
      status={status} who={who} cloud={cloud} mode={mode} canUpload={canUpload}
      busySlot={busySlot} note={note} emailSent={emailSent}
      onSignIn={onSignIn} onEmail={onEmail} onSignOut={onSignOut}
      onUpload={onUpload} onLoad={onLoad} onDelete={onDelete}
    />
  );
}
