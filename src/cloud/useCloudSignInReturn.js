// Finishing a cloud-save sign-in when the provider sends the player back.
//
// Sign-in leaves the page (Google, Discord, or an emailed link) and returns to
// /?cloud=return&code=…. Whatever screen the player lands on — the game, or the
// new-game screen on a device with no airline yet — calls this hook, and the
// first one that is ready finishes the exchange and reopens Save / Load in the
// mode they left from, with any error to show there.
//
// index.html skips the landing page for /?cloud=return, so the player comes
// straight back to the game rather than to the front door.
import { useEffect } from 'react';
import { isSignInReturn, completeSignInReturn } from './cloudAuth.js';

let consumed = false;

/** @param {boolean} enabled  @param {(mode: 'save'|'load', error: string|null) => void} open */
export function useCloudSignInReturn(enabled, open) {
  useEffect(() => {
    if (!enabled || consumed || typeof window === 'undefined') return;
    if (!isSignInReturn(window.location.search)) return;
    consumed = true;
    (async () => {
      const { mode, error } = await completeSignInReturn();
      open(mode, error);
    })();
  }, [enabled, open]);
}
