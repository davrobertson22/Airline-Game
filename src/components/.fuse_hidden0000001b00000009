import { useId } from 'react';

// ── Logo catalogue ────────────────────────────────────────────────────────────
// Each entry: id, name, and a render(gid, r, color) function where
//   gid   = unique gradient/defs ID prefix for this instance
//   r     = corner radius of the background rect
//   color = user-chosen accent color (hex string)

export const AIRLINE_LOGOS = [
  {
    id: 'horizon',
    name: 'Horizon',
    render(gid, r, color = '#f5a623') {
      return (
        <>
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor="#0a1628" />
              <stop offset="100%" stopColor="#1a4d7e" />
            </linearGradient>
          </defs>
          <rect width="40" height="40" rx={r} fill={`url(#${gid})`} />
          <line x1="6" y1="26" x2="34" y2="26" stroke="rgba(255,255,255,.2)" strokeWidth="0.8" />
          <path d="M 12 26 A 8 8 0 0 1 28 26" fill="none" stroke={color} strokeWidth="2.8" strokeLinecap="round" />
          <line x1="20" y1="26" x2="20" y2="11" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
          <line x1="20" y1="20" x2="13" y2="14" stroke={color} strokeWidth="1.2" strokeLinecap="round" />
          <line x1="20" y1="20" x2="27" y2="14" stroke={color} strokeWidth="1.2" strokeLinecap="round" />
        </>
      );
    },
  },
  {
    id: 'eagle',
    name: 'Eagle',
    render(gid, r, color = '#ffffff') {
      return (
        <>
          <rect width="40" height="40" rx={r} fill="#b71c1c" />
          <path d="M 5 29 C 9 20 16 13 22 15 C 27 17 25 26 30 23 C 34 21 37 16 37 16"
            fill="none" stroke={color} strokeWidth="2.8" strokeLinecap="round" />
          <path d="M 5 29 C 11 25 20 23 30 27"
            fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeOpacity="0.4" />
        </>
      );
    },
  },
  {
    id: 'compass',
    name: 'Compass',
    render(gid, r, color = '#d4aa00') {
      return (
        <>
          <rect width="40" height="40" rx={r} fill="#1a2744" />
          <polygon points="20,7  22,18  20,20  18,18" fill={color} />
          <polygon points="20,33 22,22  20,20  18,22" fill={color} />
          <polygon points="7,20  18,22  20,20  18,18" fill={color} />
          <polygon points="33,20 22,18  20,20  22,22" fill={color} />
          <polygon points="10,10 17,17 20,20 16,18" fill={color} opacity="0.45" />
          <polygon points="30,10 23,17 20,20 24,18" fill={color} opacity="0.45" />
          <polygon points="10,30 17,23 20,20 16,22" fill={color} opacity="0.45" />
          <polygon points="30,30 23,23 20,20 24,22" fill={color} opacity="0.45" />
          <circle cx="20" cy="20" r="2.5" fill={color} />
        </>
      );
    },
  },
  {
    id: 'jade',
    name: 'Jade',
    render(gid, r, color = '#ffffff') {
      return (
        <>
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor="#0e4227" />
              <stop offset="100%" stopColor="#1a6b45" />
            </linearGradient>
          </defs>
          <rect width="40" height="40" rx={r} fill={`url(#${gid})`} />
          <path d="M 6 30 C 10 18 20 11 35 14"
            fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" />
          <path d="M 6 30 C 13 25 24 23 35 26"
            fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeOpacity="0.35" />
        </>
      );
    },
  },
  {
    id: 'arctic',
    name: 'Arctic',
    render(gid, r, color = '#ffffff') {
      return (
        <>
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%"   stopColor="#0d2d4f" />
              <stop offset="100%" stopColor="#1a5c8c" />
            </linearGradient>
          </defs>
          <rect width="40" height="40" rx={r} fill={`url(#${gid})`} />
          <line x1="20" y1="7"  x2="20" y2="33" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
          <line x1="7"  y1="20" x2="33" y2="20" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
          <line x1="10" y1="10" x2="30" y2="30" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
          <line x1="30" y1="10" x2="10" y2="30" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
          <line x1="16" y1="11" x2="24" y2="11" stroke={color} strokeWidth="1.1" />
          <line x1="16" y1="29" x2="24" y2="29" stroke={color} strokeWidth="1.1" />
          <line x1="11" y1="16" x2="11" y2="24" stroke={color} strokeWidth="1.1" />
          <line x1="29" y1="16" x2="29" y2="24" stroke={color} strokeWidth="1.1" />
          <circle cx="20" cy="20" r="2.8" fill={color} />
        </>
      );
    },
  },
  {
    id: 'sapphire',
    name: 'Sapphire',
    render(gid, r, color = '#00bfff') {
      return (
        <>
          <rect width="40" height="40" rx={r} fill="#07101e" />
          <polygon points="20,7  33,20  20,33  7,20"
            fill="none" stroke={color} strokeWidth="2.5" />
          <polygon points="20,13 27,20  20,27  13,20"
            fill={color} opacity="0.45" />
          <path d="M 20 7 L 27 14 L 20 14 Z"
            fill={color} opacity="0.25" />
        </>
      );
    },
  },
  {
    id: 'crown',
    name: 'Crown',
    render(gid, r, color = '#c8950f') {
      return (
        <>
          <rect width="40" height="40" rx={r} fill="#0b0d12" />
          <path d="M 8 29 L 8 18 L 14 24 L 20 11 L 26 24 L 32 18 L 32 29 Z"
            fill={color} />
          <rect x="8" y="28" width="24" height="3.5" rx="1.5" fill={color} />
          <circle cx="20" cy="18.5" r="2.2" fill="#fff8dc" />
          <circle cx="13" cy="23.5" r="1.5" fill="#fff8dc" opacity=".6" />
          <circle cx="27" cy="23.5" r="1.5" fill="#fff8dc" opacity=".6" />
        </>
      );
    },
  },
  {
    id: 'bolt',
    name: 'Bolt',
    render(gid, r, color = '#e67e00') {
      return (
        <>
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor={color} />
              <stop offset="100%" stopColor={color} stopOpacity="0.7" />
            </linearGradient>
          </defs>
          <rect width="40" height="40" rx={r} fill={`url(#${gid})`} />
          <polygon points="23,6 12,22 19.5,22 17,34 28,18 20.5,18" fill="#0d1117" opacity=".88" />
        </>
      );
    },
  },
  {
    id: 'phoenix',
    name: 'Phoenix',
    render(gid, r, color = '#e65c00') {
      return (
        <>
          <defs>
            <linearGradient id={gid} x1="0" y1="1" x2="0" y2="0">
              <stop offset="0%"   stopColor={color} stopOpacity="0.7" />
              <stop offset="100%" stopColor={color} />
            </linearGradient>
          </defs>
          <rect width="40" height="40" rx={r} fill={`url(#${gid})`} />
          <path d="M 7 33 C 7 22 12 14 20 9 C 28 14 33 22 33 33"
            fill="none" stroke="rgba(255,255,255,.85)" strokeWidth="2.5" strokeLinecap="round" />
          <path d="M 13 33 C 14 22 17 15 20 9 C 23 15 26 22 27 33 Z"
            fill="rgba(255,255,255,.18)" />
          <circle cx="20" cy="9" r="2.8" fill="rgba(255,255,255,.9)" />
        </>
      );
    },
  },
  {
    id: 'comet',
    name: 'Comet',
    render(gid, r, color = '#d0a8ff') {
      return (
        <>
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%"   stopColor="#12002a" />
              <stop offset="100%" stopColor="#4a0082" />
            </linearGradient>
          </defs>
          <rect width="40" height="40" rx={r} fill={`url(#${gid})`} />
          <line x1="26" y1="16" x2="7"  y2="35" stroke="white" strokeWidth="2.5" strokeLinecap="round" opacity=".9" />
          <line x1="24" y1="18" x2="9"  y2="36" stroke="white" strokeWidth="1.5" strokeLinecap="round" opacity=".5" />
          <line x1="22" y1="15" x2="6"  y2="30" stroke="white" strokeWidth="1"   strokeLinecap="round" opacity=".3" />
          <circle cx="29" cy="12" r="4.5" fill="white" />
          <circle cx="29" cy="12" r="2.5" fill={color} />
        </>
      );
    },
  },
  {
    id: 'summit',
    name: 'Summit',
    render(gid, r, color = '#ffffff') {
      return (
        <>
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor="#1a3020" />
              <stop offset="100%" stopColor="#2e5c20" />
            </linearGradient>
          </defs>
          <rect width="40" height="40" rx={r} fill={`url(#${gid})`} />
          <polygon points="28,13 37,30 19,30" fill={color} opacity="0.35" />
          <polygon points="20,8 32,30 8,30" fill={color} opacity="0.85" />
          <polygon points="20,8 24.5,17 15.5,17" fill={color} />
        </>
      );
    },
  },
  {
    id: 'prism',
    name: 'Prism',
    render(gid, r, color = '#ffffff') {
      return (
        <>
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%"   stopColor="#002a2a" />
              <stop offset="100%" stopColor="#005050" />
            </linearGradient>
          </defs>
          <rect width="40" height="40" rx={r} fill={`url(#${gid})`} />
          <polygon points="20,7 34,31 6,31"
            fill="none" stroke={color} strokeWidth="1.8" strokeOpacity="0.7" />
          <line x1="20" y1="7" x2="34" y2="31" stroke="#ff5555" strokeWidth="1.2" opacity=".8" />
          <line x1="20" y1="7" x2="29" y2="31" stroke="#ffaa00" strokeWidth="1.2" opacity=".8" />
          <line x1="20" y1="7" x2="24" y2="31" stroke="#ffee00" strokeWidth="1.2" opacity=".7" />
          <line x1="20" y1="7" x2="19" y2="31" stroke="#44ee44" strokeWidth="1.2" opacity=".8" />
          <line x1="20" y1="7" x2="14" y2="31" stroke="#44aaff" strokeWidth="1.2" opacity=".8" />
          <line x1="20" y1="7" x2="6"  y2="31" stroke="#bb44ff" strokeWidth="1.2" opacity=".8" />
        </>
      );
    },
  },
];

export const LOGO_MAP = Object.fromEntries(AIRLINE_LOGOS.map(l => [l.id, l]));

// ── Renderer ──────────────────────────────────────────────────────────────────

/**
 * Renders an airline logo by ID.
 *   id          — one of the AIRLINE_LOGOS ids
 *   size        — px size (width = height, default 40)
 *   radius      — corner radius; default 20% of size
 *   accentColor — hex color applied to the logo's main accent elements
 *   style       — extra inline styles on the wrapping <svg>
 */
export default function AirlineLogo({ id, size = 40, radius, accentColor, style, className }) {
  const uid  = useId().replace(/:/g, '');
  const gid  = `lg-${id}-${uid}`;
  const logo = LOGO_MAP[id];
  const r    = radius ?? Math.round(size * 0.2);

  if (!logo) {
    return (
      <svg width={size} height={size} viewBox="0 0 40 40" style={style} className={className}>
        <rect width="40" height="40" rx={r} fill="#21262d" />
        <text x="20" y="26" textAnchor="middle" fill="#8b949e"
          fontSize="20" fontWeight="700" fontFamily="system-ui">
          ?
        </text>
      </svg>
    );
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      style={{ flexShrink: 0, display: 'block', ...style }}
      className={className}
    >
      {logo.render(gid, r, accentColor)}
    </svg>
  );
}
