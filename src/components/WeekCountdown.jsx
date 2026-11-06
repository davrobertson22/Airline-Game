import { useEffect, useState } from 'react';

/**
 * "Next week in 41m 12s" — a countdown that ticks on its own.
 *
 * The countdown used to be App state, set every second by the auto-advance
 * timer, so the WHOLE game re-rendered once a second with the player doing
 * nothing: the open page (a 600-row Fleet table, the Market, the map's layers)
 * rebuilt sixty times a minute just to change one number in the top bar. Now
 * only this span re-renders; App's timer re-renders nothing until the week is
 * actually due.
 *
 * `atRef` is App's ref to the next auto-advance time (ms). `version` is bumped
 * when that time is reset, so the display jumps at once instead of on the
 * next tick.
 */
export function formatCountdown(ms) {
  const totalSec = Math.ceil(Math.max(0, ms) / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export default function WeekCountdown({ atRef, version = 0 }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [version]);
  return formatCountdown((atRef?.current ?? now) - now);
}
