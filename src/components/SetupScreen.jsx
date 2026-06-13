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

// ── Country name lookup (ISO → display name) ─────────────────────────────────
const COUNTRY_NAMES = {
  AE: 'United Arab Emirates', AF: 'Afghanistan', AL: 'Albania',
  AO: 'Angola',               AR: 'Argentina',   AT: 'Austria',
  AU: 'Australia',            AZ: 'Azerbaijan',  BA: 'Bosnia & Herzegovina',
  BB: 'Barbados',             BD: 'Bangladesh',  BE: 'Belgium',
  BG: 'Bulgaria',             BH: 'Bahrain',     BO: 'Bolivia',
  BR: 'Brazil',               BS: 'Bahamas',     BZ: 'Belize',
  CA: 'Canada',               CH: 'Switzerland', CI: "Côte d'Ivoire",
  CL: 'Chile',                CM: 'Cameroon',    CN: 'China',
  CO: 'Colombia',             CR: 'Costa Rica',  CU: 'Cuba',
  CY: 'Cyprus',               CZ: 'Czech Republic', DE: 'Germany',
  DK: 'Denmark',              DO: 'Dominican Republic', DZ: 'Algeria',
  EC: 'Ecuador',              EE: 'Estonia',     EG: 'Egypt',
  ES: 'Spain',                ET: 'Ethiopia',    FI: 'Finland',
  FJ: 'Fiji',                 FR: 'France',      GB: 'United Kingdom',
  GH: 'Ghana',                GR: 'Greece',      GT: 'Guatemala',
  GY: 'Guyana',               HK: 'Hong Kong',   HN: 'Honduras',
  HR: 'Croatia',              HU: 'Hungary',     ID: 'Indonesia',
  IE: 'Ireland',              IL: 'Israel',      IN: 'India',
  IQ: 'Iraq',                 IR: 'Iran',        IS: 'Iceland',
  IT: 'Italy',                JM: 'Jamaica',     JO: 'Jordan',
  JP: 'Japan',                KE: 'Kenya',       KH: 'Cambodia',
  KR: 'South Korea',          KW: 'Kuwait',      KZ: 'Kazakhstan',
  LA: 'Laos',                 LB: 'Lebanon',     LK: 'Sri Lanka',
  LT: 'Lithuania',            LU: 'Luxembourg',  LV: 'Latvia',
  LY: 'Libya',                MA: 'Morocco',     ME: 'Montenegro',
  MG: 'Madagascar',           MK: 'North Macedonia', MM: 'Myanmar',
  MN: 'Mongolia',             MO: 'Macau',       MT: 'Malta',
  MU: 'Mauritius',            MX: 'Mexico',      MY: 'Malaysia',
  MZ: 'Mozambique',           NG: 'Nigeria',     NI: 'Nicaragua',
  NL: 'Netherlands',          NO: 'Norway',      NP: 'Nepal',
  NZ: 'New Zealand',          OM: 'Oman',        PA: 'Panama',
  PE: 'Peru',                 PG: 'Papua New Guinea', PH: 'Philippines',
  PK: 'Pakistan',             PL: 'Poland',      PR: 'Puerto Rico',
  PT: 'Portugal',             PY: 'Paraguay',    QA: 'Qatar',
  RO: 'Romania',              RS: 'Serbia',      RU: 'Russia',
  RW: 'Rwanda',               SA: 'Saudi Arabia', SD: 'Sudan',
  SE: 'Sweden',               SG: 'Singapore',   SI: 'Slovenia',
  SK: 'Slovakia',             SN: 'Senegal',     SR: 'Suriname',
  SV: 'El Salvador',          TH: 'Thailand',    TN: 'Tunisia',
  TR: 'Turkey',               TT: 'Trinidad & Tobago', TW: 'Taiwan',
  TZ: 'Tanzania',             UA: 'Ukraine',     UG: 'Uganda',
  US: 'United States',        UY: 'Uruguay',     UZ: 'Uzbekistan',
  VE: 'Venezuela',            VN: 'Vietnam',     XK: 'Kosovo',
  YE: 'Yemen',                ZA: 'South Africa', ZM: 'Zambia',
  ZW: 'Zimbabwe',
};

function countryName(code) {
  return COUNTRY_NAMES[code] ?? code;
}

// Returns [{countryName, airports[]}] sorted A-Z by country name
function groupedByCountry(filter = '') {
  const q = filter.trim().toLowerCase();
  const groups = {};
  for (const a of AIRPORTS) {
    const name = countryName(a.country);
    const matches = !q
      || a.code.toLowerCase().includes(q)
      || a.city.toLowerCase().includes(q)
      || a.name.toLowerCase().includes(q)
      || name.toLowerCase().includes(q);
    if (!matches) continue;
    if (!groups[name]) groups[name] = [];
    groups[name].push(a);
  }
  return Object.entries(groups)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, airports]) => ({
      name,
      airports: [...airports].sort((a, b) => a.city.localeCompare(b.city)),
    }));
}

export default function SetupScreen() {
  const { dispatch } = useGame();
  const [airlineName,       setAirlineName]       = useState('');
  const [hub,               setHub]               = useState('JFK');
  const [hubSearch,         setHubSearch]         = useState('');
  const [logoId,            setLogoId]            = useState(AIRLINE_LOGOS[0].id);
  const [accentColor,       setAccentColor]       = useState(ACCENT_COLORS[0].hex);
  const [enableObjectives,  setEnableObjectives]  = useState(true);

  function handleStart(e) {
    e.preventDefault();
    if (!airlineName.trim()) return;
    dispatch({
      type:             'START_GAME',
      airlineName:      airlineName.trim(),
      hub,
      logoId,
      logoColor:        accentColor,
      enableObjectives,
    });
  }

  const hubAirport    = AIRPORTS.find(a => a.code === hub);
  const countryGroups = groupedByCountry(hubSearch);

  return (
    <div className="setup-screen">
      <div className="setup-card" style={{ maxWidth: 600 }}>
        <div className="setup-title">✈ Tailwinds - Airline Manager</div>
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

            {/* Search box */}
            <input
              className="form-input"
              type="text"
              placeholder="Search by city, airport or country…"
              value={hubSearch}
              onChange={e => setHubSearch(e.target.value)}
              style={{ marginBottom: 6 }}
            />

            {/* Scrollable airport list */}
            <div style={{
              maxHeight: 280,
              overflowY: 'auto',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              background: 'var(--surface2)',
            }}>
              {countryGroups.length === 0 ? (
                <div style={{ padding: '20px 14px', color: 'var(--text-muted)', fontSize: 13, textAlign: 'center' }}>
                  No airports match "{hubSearch}"
                </div>
              ) : countryGroups.map(({ name, airports }) => (
                <div key={name}>
                  {/* Country subheading */}
                  <div style={{
                    padding: '6px 12px',
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: '.8px',
                    textTransform: 'uppercase',
                    color: 'var(--accent)',
                    background: 'var(--surface3)',
                    borderBottom: '1px solid var(--border)',
                    position: 'sticky',
                    top: 0,
                    zIndex: 1,
                  }}>
                    {name}
                  </div>

                  {/* Airports in this country */}
                  {airports.map(a => {
                    const selected = a.code === hub;
                    return (
                      <button
                        key={a.code}
                        type="button"
                        onClick={() => setHub(a.code)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                          width: '100%',
                          padding: '7px 12px',
                          background: selected ? 'var(--accent-dim)' : 'transparent',
                          border: 'none',
                          borderBottom: '1px solid var(--border)',
                          cursor: 'pointer',
                          textAlign: 'left',
                          color: 'var(--text)',
                          transition: 'background .1s',
                        }}
                      >
                        <span style={{
                          fontFamily: 'monospace',
                          fontWeight: 700,
                          fontSize: 13,
                          color: selected ? 'var(--accent)' : 'var(--text-dim)',
                          minWidth: 36,
                        }}>
                          {a.code}
                        </span>
                        <span style={{ fontSize: 13, flex: 1 }}>
                          {a.city}
                          <span style={{ color: 'var(--text-muted)', fontSize: 11, marginLeft: 6 }}>
                            {a.name}
                          </span>
                        </span>
                        <span style={{
                          fontSize: 10,
                          color: 'var(--text-muted)',
                          textTransform: 'uppercase',
                          letterSpacing: '.4px',
                        }}>
                          {a.tier}
                        </span>
                        {selected && (
                          <span style={{ color: 'var(--accent)', fontSize: 14, marginLeft: 4 }}>✓</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>

            {/* Selected airport summary */}
            {hubAirport && (
              <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text-muted)' }}>
                {hubAirport.name} · {hubAirport.population}M metro area · {hubAirport.tier} hub
                <span style={{ marginLeft: 8, color: 'var(--accent)', fontWeight: 600 }}>
                  🏠 Home country: {countryName(hubAirport.country)}
                </span>
              </div>
            )}
          </div>

          {/* ── Board Objectives toggle ── */}
          <div className="form-group">
            <label className="form-label">Game Options</label>
            <button
              type="button"
              onClick={() => setEnableObjectives(v => !v)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                width: '100%',
                padding: '12px 14px',
                background: 'var(--surface2)',
                border: `1px solid ${enableObjectives ? 'var(--accent)' : 'var(--border)'}`,
                borderRadius: 'var(--radius)',
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              {/* Toggle pill */}
              <div style={{
                width: 36,
                height: 20,
                borderRadius: 10,
                background: enableObjectives ? 'var(--accent)' : 'var(--surface3)',
                position: 'relative',
                flexShrink: 0,
                transition: 'background 0.2s',
              }}>
                <div style={{
                  position: 'absolute',
                  top: 2,
                  left: enableObjectives ? 18 : 2,
                  width: 16,
                  height: 16,
                  borderRadius: '50%',
                  background: '#fff',
                  transition: 'left 0.2s',
                }} />
              </div>
              <div>
                <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)' }}>
                  🏅 Board Objectives
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                  {enableObjectives
                    ? 'Earn cash rewards by hitting strategic milestones and financial targets'
                    : 'Sandbox mode — no objectives, play freely'}
                </div>
              </div>
            </button>
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
