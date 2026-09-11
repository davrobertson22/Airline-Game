// "Support the dev" — the solo game's version of the ask.
//
// Tailwinds has no accounts, so there is nothing to hang a badge on and no way
// to know whose browser to turn the ads off in. The perks live in Headwinds
// (multiplayer), and this card says so rather than implying otherwise — see
// public/support.html, which is the page it links to.
//
// Rendered once, at the bottom of the Dashboard only. Not on every tab, never
// over the game, and never at a moment the player just lost money.
import { useState } from 'react';

export const KOFI_URL = 'https://ko-fi.com/E2V226S4CD';

// Dismissal lasts 30 days rather than forever: someone who says "not now" in
// their first hour may feel differently after a few hundred game weeks.
// localStorage throws in private windows and can return null, so every access is
// guarded and the card simply shows when in doubt.
const DISMISS_KEY = 'tw.support.dismissedAt';
const DISMISS_DAYS = 30;

function dismissedRecently() {
  try {
    const at = Number(window.localStorage.getItem(DISMISS_KEY));
    return Number.isFinite(at) && at > 0 && Date.now() - at < DISMISS_DAYS * 24 * 60 * 60 * 1000;
  } catch { return false; }
}

export default function SupportCard() {
  const [dismissed, setDismissed] = useState(() => dismissedRecently());
  if (dismissed) return null;

  const hide = () => {
    try { window.localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* no-op */ }
    setDismissed(true);
  };

  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10,
      padding: '16px 18px', margin: '24px 0 0',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <strong style={{ fontSize: 14 }}>Support the dev</strong>
        <button
          onClick={hide} title="Hide this for a month"
          style={{
            marginLeft: 'auto', background: 'none', border: '1px solid var(--border)',
            color: 'var(--text-dim)', borderRadius: 6, fontSize: 11, padding: '3px 10px',
            cursor: 'pointer', fontFamily: 'inherit',
          }}
        >
          Not now
        </button>
      </div>
      <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6 }}>
        Tailwinds is free, has no paid upgrades, and is going to stay that way. It is built and
        paid for by one person — if you have got some hours out of it, chipping in helps cover
        the servers. Nothing you pay for ever changes the game.
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
        <a
          href={KOFI_URL} target="_blank" rel="noopener noreferrer"
          style={{
            background: '#72a4f2', color: '#08162c', fontWeight: 700, fontSize: 13,
            padding: '9px 18px', borderRadius: 7, textDecoration: 'none',
          }}
        >
          ♥ Support on Ko-fi
        </a>
        <a
          href="/support.html" target="_blank" rel="noopener noreferrer"
          style={{ color: 'var(--accent)', fontSize: 12.5, textDecoration: 'none', fontWeight: 600 }}
        >
          What it pays for →
        </a>
      </div>
    </div>
  );
}
