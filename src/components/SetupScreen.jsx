import { useState } from 'react';
import { useGame } from '../store/GameContext.jsx';
import { AIRPORTS } from '../data/airports.js';
import AirlineLogo, { AIRLINE_LOGOS } from './AirlineLogo.jsx';

// ── Accent colour palette ────────────────────────────────────────────────────
const ACCENT_COLORS = [
  { hex: '#f5a623', label: 'Gold'    },
  { hex: '#e53935', label: 'Red'     },
  { hex: '#1e88e5', label: 'Blue'    },
  { hex: '#00bfff', label: 'Cyan'    },
  { hex: '#43a047', label: 'Green'   },
  { hex: '#8e24aa', label: 'Purple'  },
  { hex: '#fb8c00', label: 'Orange'  },
  { hex: '#e91e63', label: 'Pink'    },
  { hex: '#ffffff', label: 'White'   },
  { hex: '#00c9a7', label: 'Teal'    },
  { hex: '#c8950f', label: 'Amber'   },
  { hex: '#d0a8ff', label: 'Lavender'},
];

// ── Region grouping ──────────────────────────────────────────────────────────
const REGION_ORDER = [
  'North America',
  'South America',
  'Europe',
  'Middle East',
  'Africa',
  'Asia',
  'Oceania',
];

const COUNTRY_TO_REGION = {
  // North America
  US: 'North America', CA: 'North America', MX: 'North America',
  PA: 'North America', GT: 'North America', CR: 'North America',
  CU: 'North America', JM: 'North America', DO: 'North America',
  PR: 'North America', BS: 'North America', BB: 'North America',
  TT: 'North America', HN: 'North America', SV: 'North America',
  NI: 'North America', BZ: 'North America',
  // South America
  BR: 'South America', AR: 'South America', CL: 'South America',
  CO: 'South America', PE: 'South America', VE: 'South America',
  EC: 'South America', BO: 'South America', PY: 'South America',
  UY: 'South America', GY: 'South America', SR: 'South America',
  // Europe
  GB: 'Europe', FR: 'Europe', DE: 'Europe', NL: 'Europe',
  ES: 'Europe', IT: 'Europe', CH: 'Europe', AT: 'Europe',
  BE: 'Europe', PT: 'Europe', NO: 'Europe', SE: 'Europe',
  FI: 'Europe', DK: 'Europe', IE: 'Europe', PL: 'Europe',
  GR: 'Europe', TR: 'Europe', RU: 'Europe', UA: 'Europe',
  CZ: 'Europe', HU: 'Europe', RO: 'Europe', BG: 'Europe',
  HR: 'Europe', RS: 'Europe', SK: 'Europe', SI: 'Europe',
  LT: 'Europe', LV: 'Europe', EE: 'Europe', IS: 'Europe',
  LU: 'Europe', MT: 'Europe', CY: 'Europe', AL: 'Europe',
  MK: 'Europe', BA: 'Europe', ME: 'Europe', XK: 'Europe',
  // Middle East
  AE: 'Middle East', QA: 'Middle East', SA: 'Middle East',
  IL: 'Middle East', JO: 'Middle East', LB: 'Middle East',
  IQ: 'Middle East', IR: 'Middle East', KW: 'Middle East',
  BH: 'Middle East', OM: 'Middle East', YE: 'Middle East',
  // Africa
  ZA: 'Africa', EG: 'Africa', KE: 'Africa', NG: 'Africa',
  MA: 'Africa', ET: 'Africa', GH: 'Africa', TZ: 'Africa',
  UG: 'Africa', CM: 'Africa', CI: 'Africa', SN: 'Africa',
  TN: 'Africa', DZ: 'Africa', LY: 'Africa', SD: 'Africa',
  MZ: 'Africa', ZM: 'Africa', ZW: 'Africa', AO: 'Africa',
  MU: 'Africa', MG: 'Africa', RW: 'Africa',
  // Asia (covers South, Southeast, East Asia)
  SG: 'Asia', HK: 'Asia', MY: 'Asia', TH: 'Asia',
  ID: 'Asia', PH: 'Asia', IN: 'Asia', LK: 'Asia',
  JP: 'Asia', KR: 'Asia', CN: 'Asia', TW: 'Asia',
  VN: 'Asia', MM: 'Asia', KH: 'Asia', LA: 'Asia',
  BD: 'Asia', NP: 'Asia', PK: 'Asia', AF: 'Asia',
  UZ: 'Asia', KZ: 'Asia', MN: 'Asia', MO: 'Asia',
  // Oceania
  AU: 'Oceania', NZ: 'Oceania', PG: 'Oceania', FJ: 'Oceania',
};

function getRegion(country) {
  return COUNTRY_TO_REGION[country] ?? 'Other';
}

function groupedAirports() {
  const groups = {};
  for (const a of AIRPORTS) {
    const region = getRegion(a.country);
    if (!groups[region]) groups[region] = [];
    groups[region].push(a);
  }
  for (const g of Object.values(groups)) {
    g.sort((a, b) => a.city.localeCompare(b.city));
  }
  return groups;
}

export default function SetupScreen() {
  const { dispatch } = useGame();
  const [airlineName,  setAirlineName]  = useState('');
  const [hub,          setHub]          = useState('JFK');
  const [logoId,       setLogoId]       = useState(AIRLINE_LOGOS[0].id);
  const [accentColor,  setAccentColor]  = useState(ACCENT_COLORS[0].hex);

  function handleStart(e) {
    e.preventDefault();
    if (!airlineName.trim()) return;
    dispatch({
      type: 'START_GAME',
      airlineName: airlineName.trim(),
      hub,
      logoId,
      logoColor: accentColor,
    });
  }

  const hubAirport = AIRPORTS.find(a => a.code === hub);
  const groups     = groupedAirports();

  return (
    <div className="setup-screen">
      <div className="setup-card" style={{ maxWidth: 600 }}>
        <div className="setup-title">✈ Bastian Boys Airline Empires</div>
        <div className="setup-subtitle">
          Build the world's greatest airline from scratch.
          You have $10,000,000 to get started.
        </div>

        <form onSubmit={handleStart}>

          {/* ── Airline name ── */}
          <div className="form-group">
            <label className="form-label">Airline Name</label>
            <input
              className="form-input"
              type="text"
              placeholder="e.g. Pacific Airways"
              value={airlineName}
              onChange={e => setAirlineName(e.target.value)}
              maxLength={40}
              required
            />
          </div>

          {/* ── Logo picker ── */}
          <div className="form-group">
            <label className="form-label">Airline Logo</label>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: 10,
              padding: '14px',
              background: 'var(--surface2)',
              borderRadius: 'var(--radius)',
              border: '1px solid var(--border)',
            }}>
              {AIRLINE_LOGOS.map(logo => {
                const selected = logoId === logo.id;
                return (
                  <button
                    key={logo.id}
                    type="button"
                    title={logo.name}
                    onClick={() => setLogoId(logo.id)}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 6,
                      padding: '10px 6px',
                      background: selected ? 'var(--accent-dim)' : 'transparent',
                      border: `2px solid ${selected ? 'var(--accent)' : 'transparent'}`,
                      borderRadius: 10,
                      cursor: 'pointer',
                      transition: 'border-color .12s, background .12s',
                    }}
                  >
                    <AirlineLogo id={logo.id} size={52} accentColor={accentColor} />
                    <span style={{
                      fontSize: 10,
                      color: selected ? 'var(--accent)' : 'var(--text-dim)',
                      fontWeight: selected ? 600 : 400,
                      letterSpacing: '.3px',
                    }}>
                      {logo.name}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* ── Colour picker ── */}
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>
                Logo colour
              </div>
              <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
                {ACCENT_COLORS.map(c => {
                  const sel = accentColor === c.hex;
                  return (
                    <button
                      key={c.hex}
                      type="button"
                      title={c.label}
                      onClick={() => setAccentColor(c.hex)}
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: '50%',
                        background: c.hex,
                        border: sel
                          ? '3px solid var(--text)'
                          : '2px solid var(--border)',
                        cursor: 'pointer',
                        outline: sel ? '2px solid var(--accent)' : 'none',
                        outlineOffset: 2,
                        transition: 'border .1s, outline .1s',
                        flexShrink: 0,
                      }}
                    />
                  );
                })}
              </div>
            </div>

            {/* Preview */}
            {airlineName.trim() && (
              <div style={{
                marginTop: 12,
                padding: '10px 14px',
                background: 'var(--surface2)',
                borderRadius: 8,
                border: '1px solid var(--border)',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
              }}>
                <AirlineLogo id={logoId} size={38} accentColor={accentColor} />
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{airlineName}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    {AIRLINE_LOGOS.find(l => l.id === logoId)?.name} livery ·{' '}
                    {ACCENT_COLORS.find(c => c.hex === accentColor)?.label ?? 'Custom'} accent
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* ── Hub airport ── */}
          <div className="form-group">
            <label className="form-label">Home Hub Airport</label>
            <select
              className="form-select"
              value={hub}
              onChange={e => setHub(e.target.value)}
            >
              {REGION_ORDER.map(region => {
                const airports = groups[region];
                if (!airports?.length) return null;
                return (
                  <optgroup key={region} label={`── ${region} ──`}>
                    {airports.map(a => (
                      <option key={a.code} value={a.code}>
                        {a.code} — {a.city}, {a.country}
                      </option>
                    ))}
                  </optgroup>
                );
              })}
              {groups['Other']?.length > 0 && (
                <optgroup label="── Other ──">
                  {groups['Other'].map(a => (
                    <option key={a.code} value={a.code}>
                      {a.code} — {a.city}, {a.country}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
            {hubAirport && (
              <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text-muted)' }}>
                {hubAirport.name} · {hubAirport.population}M metro area · {hubAirport.tier} hub
                <span style={{ marginLeft: 8, color: 'var(--accent)', fontWeight: 600 }}>
                  🏠 Home country: {hubAirport.country}
                </span>
              </div>
            )}
          </div>

          {/* ── How to play ── */}
          <div style={{
            padding: 14,
            background: 'var(--surface2)',
            borderRadius: 'var(--radius)',
            fontSize: 12,
            color: 'var(--text-muted)',
            marginBottom: 24,
          }}>
            <strong style={{ color: 'var(--text)' }}>How to play:</strong> Lease aircraft from the
            Market, open routes between airports, then advance week-by-week to collect revenue.
            Don't let your cash hit zero! Your hub airport determines your <strong style={{ color: 'var(--text)' }}>home country</strong> — you can only build hubs within that country.
          </div>

          <button
            type="submit"
            className="btn btn-primary"
            style={{ width: '100%', padding: 12, fontSize: 15, fontWeight: 700 }}
          >
            Launch Airline →
          </button>
        </form>
      </div>
    </div>
  );
}
