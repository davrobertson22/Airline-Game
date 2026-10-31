import { useState, useRef, useEffect, useCallback } from 'react';
import { useGame } from '../store/GameContext.jsx';
import { AIRPORTS, getCountryName } from '../data/airports.js';
import { STARTING_CAPITAL } from '../data/credit.js';
import { eraSeedCapital, ERA_MIN_START_YEAR,
         ERA_MAX_NEW_START_YEAR, HORIZON_YEAR, runLengthYears } from '../data/era.js';
import { AIRLINE_LOGOS } from './AirlineLogo.jsx';
import LogoPicker, { AirlineCodeField } from './LogoPicker.jsx';
import { LOGO_COLORS, normalizeAirlineCode, cleanHex } from '../utils/logoBranding.js';
import { Glyph } from './Icons.jsx';
import SaveLoadModal from './SaveLoadModal.jsx';
import { useCloudSignInReturn } from '../cloud/useCloudSignInReturn.js';
import { cloudSavesEnabled } from '../cloud/cloudConfig.js';
import useIsMobile from '../hooks/useIsMobile.js';
import { rollDemandWorld, newDemandSeed, cleanDemandSeed, DEMAND_ROLL_RANGE } from '../data/demandWorld.js';
import { loadAirportMarkets } from './AllAirportsTable.jsx';
import { DEMAND_MODEL_LATEST } from '../utils/market.js';
import { parseRivalSet, splitRivalSet, exampleRivalSet, RIVAL_SET_MAX_START } from '../models/rivalSets.js';

// ── Accent colour palette ────────────────────────────────────────────────────
// Lives in utils/logoBranding.js now (the rival colours draw from it too);
// re-exported under its old name for the components that import it from here.
export const ACCENT_COLORS = LOGO_COLORS;

// Country names come from the single source of truth in airports.js
// (data/airports.js → COUNTRY_NAMES / getCountryName), so this screen never
// drifts out of sync when new countries are added.
const countryName = getCountryName;

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

// Era mode: an optional real-calendar start. '' = classic (timeless, whole
// catalogue). A year pins Y1 to that January and the game walks the century —
// aircraft arrive when they really entered service, demand and fuel follow
// their historical curves (see src/data/era.js).
const ERA_PRESETS = [
  { year: 1950, title: 'Piston age',       blurb: 'DC-3s and Constellations. Five types on the market; the jets are eight years out.' },
  { year: 1958, title: 'Dawn of the jets', blurb: 'The 707 and DC-8 arrive this year. Bet on them, or milk the propliners a little longer.' },
  { year: 1970, title: 'Jumbo',            blurb: 'The 747 enters service. Wide-bodies change the economics of every long route.' },
  { year: 1978, title: 'Deregulation',     blurb: 'Fares fall, fuel spikes, the 737 and A300 are young. The classic hard start.' },
  { year: 2000, title: 'Modern',           blurb: 'A320s and 777s, cheap fuel, everything but the neos and Dreamliners.' },
];

/** "−20% to +10%" from a [low, high] multiplier pair. */
function rangeLabel([lo, hi]) {
  const p = (m) => { const n = Math.round((m - 1) * 100); return `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n)}%`; };
  return `${p(lo)} to ${p(hi)}`;
}

export default function SetupScreen() {
  const { dispatch } = useGame();
  const [airlineName,       setAirlineName]       = useState('');
  const [hub,               setHub]               = useState('JFK');
  const [hubSearch,         setHubSearch]         = useState('');
  const [logoId,            setLogoId]            = useState(AIRLINE_LOGOS[0].id);
  const [accentColor,       setAccentColor]       = useState(ACCENT_COLORS[0].hex);
  const [customLogo,        setCustomLogo]        = useState(null);   // data URL or null
  const [logoBg,            setLogoBg]            = useState(null);   // tile colour; null = default dark
  const [airlineCode,       setAirlineCode]       = useState('');     // '' = derived from the name
  // Continuing an airline from a local slot or a cloud save, on a device that
  // has no game running — the new-game screen is where such a player lands.
  const [showLoad,          setShowLoad]          = useState(false);
  const [cloudNotice,       setCloudNotice]       = useState(null);
  const [enableObjectives,  setEnableObjectives]  = useState(true);
  // Production lines (data/productionLines.js): on for new games; fixed for the game's life.
  const [productionLines,   setProductionLines]   = useState(true);
  // Market development (models/marketDev.js): on for new games; fixed for the game's life.
  const [marketDev,         setMarketDev]         = useState(true);
  const [eraSel,            setEraSel]            = useState('');       // '' | preset year (string) | 'custom'
  const [eraCustom,         setEraCustom]         = useState('1965');
  const [step,              setStep]              = useState(1);
  // Back from a cloud-save sign-in on a device with no airline yet: reopen the
  // Load window here (App does the same once a game is running).
  const openFromCloudSignIn = useCallback((mode, error) => { setCloudNotice(error); setShowLoad(true); }, []);
  useCloudSignInReturn(true, openFromCloudSignIn);
  // Demand world: '' = realistic, 'random' = rolled (data/demandWorld.js).
  const [demandMode,        setDemandMode]        = useState('');
  const [uncapMegas,        setUncapMegas]        = useState(false);
  const [demandSeed,        setDemandSeed]        = useState(() => String(newDemandSeed()));
  const [rolling,           setRolling]           = useState(false);
  // Rivals (models/rivalSets.js): the random field, or a pasted custom set.
  const [rivalSource,       setRivalSource]       = useState('random');   // 'random' | 'custom'
  const [rivalText,         setRivalTextRaw]      = useState(() => {
    try { return localStorage.getItem('tw_rival_set_draft') ?? ''; } catch { return ''; }
  });
  function setRivalText(t) {
    setRivalTextRaw(t);
    try { localStorage.setItem('tw_rival_set_draft', t); } catch { /* private mode */ }
  }
  const [rivalMode,         setRivalMode]         = useState('replace');  // 'replace' | 'add'
  const [rivalStartups,     setRivalStartups]     = useState('normal');   // 'off' | 'rare' | 'normal' | 'frequent'
  const [rivalCount,        setRivalCount]        = useState('normal');   // 'few' | 'normal' | 'many'
  const [rivalPressure,     setRivalPressure]     = useState('normal');   // 'relaxed' | 'normal' | 'fierce'
  const [rivalMergers,      setRivalMergers]      = useState(true);
  const [rivalFreight,      setRivalFreight]      = useState(true);
  const [emptyHub,          setEmptyHub]          = useState(false);
  const cardRef = useRef(null);

  // Each step renders in place, so the window keeps the scroll offset from the
  // step before it. Step 2's airport list is tall, so people arrive at step 3
  // already scrolled to the bottom of the card — looking straight at
  // "Launch Airline", with Game Options and the era picker off the top of the
  // screen. They launch without ever seeing the step. Put them back at the top.
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' });
    cardRef.current?.scrollIntoView({ block: 'start', behavior: 'auto' });
  }, [step]);
  const isMobile = useIsMobile();

  const usingCustom = logoId === 'custom' && customLogo;

  const STEPS = ['Brand', 'Home hub', 'Launch'];
  const codeInvalid = airlineCode.trim() !== '' && !normalizeAirlineCode(airlineCode);
  const canContinue = step !== 1 || (airlineName.trim().length > 0 && !codeInvalid);
  const eraYearRaw  = eraSel === '' ? null : eraSel === 'custom' ? Number(eraCustom) : Number(eraSel);
  // The floor is ERA_MIN_START_YEAR — the first year the era model is defined
  // for, NOT a round number. See the note in era.js.
  const startYear   = Number.isInteger(eraYearRaw)
    && eraYearRaw >= ERA_MIN_START_YEAR && eraYearRaw <= ERA_MAX_NEW_START_YEAR ? eraYearRaw : null;
  const eraInvalid  = eraSel === 'custom' && startYear == null;

  // Founders' equity shown in the subtitle. Reads the live constant (never a
  // hardcoded figure) and follows the era picker, since an era start is seeded
  // on the era-scaled amount rather than the modern one.
  const seedCapital      = eraSeedCapital(STARTING_CAPITAL, eraInvalid ? null : startYear);
  const seedCapitalLabel = `$${seedCapital.toLocaleString('en-US')}`;

  const seedValue   = cleanDemandSeed(demandSeed);
  const seedInvalid = demandMode === 'random' && seedValue == null;

  // Custom rival set: checked as the player types, the same check START_GAME runs.
  const rivalParse   = rivalSource === 'custom' ? parseRivalSet(rivalText) : null;
  const rivalInvalid = rivalSource === 'custom' && !rivalParse?.ok;
  const rivalSplit   = rivalParse?.ok ? splitRivalSet(rivalParse.set, eraInvalid ? null : startYear) : null;

  async function handleStart(e) {
    e.preventDefault();
    // A submit can reach us from any step — Enter in a text field, a mobile
    // keyboard's Go key, a password manager autofilling. Without this guard it
    // launched the game there and then, skipping the Launch step entirely, so
    // the player never saw the era picker and got a classic game at the default
    // hub. Treat a stray submit as "next step", never as "launch".
    if (step < 3) { if (canContinue) setStep(s => s + 1); return; }
    if (!airlineName.trim()) { setStep(1); return; }
    if (eraInvalid || seedInvalid || rivalInvalid || rolling) return;
    // A randomized world is rolled here, not in the reducer: it needs the
    // generated market table (~200 KB, loaded on demand) to place the tier lines.
    let demandWorld = null;
    if (demandMode === 'random') {
      setRolling(true);
      try {
        // A new game runs the latest demand model, so its tiers roll off those markets.
        const { AIRPORT_MARKETS } = await loadAirportMarkets(DEMAND_MODEL_LATEST);
        demandWorld = rollDemandWorld(seedValue, { uncapMegas }, AIRPORT_MARKETS);
      } catch (_) {
        setRolling(false);
        return;   // offline mid-load: stay on the Launch step, the button still works
      }
    }
    dispatch({
      type:             'START_GAME',
      airlineName:      airlineName.trim(),
      hub,
      // If a custom upload is selected, keep a real preset id as a fallback
      // and pass the image separately; otherwise use the chosen preset.
      logoId:           usingCustom ? 'horizon' : logoId,
      logoColor:        accentColor,
      customLogo:       usingCustom ? customLogo : null,
      logoBg:           cleanHex(logoBg),
      airlineCode:      normalizeAirlineCode(airlineCode),
      enableObjectives,
      productionLines,
      marketDev,
      startYear,
      demandWorld,
      ...(rivalSource === 'custom' && rivalParse?.ok ? { rivalSet: rivalParse.set, rivalMode } : {}),
      ...(rivalStartups !== 'normal' ? { rivalStartups } : {}),
      ...(rivalCount !== 'normal' && !(rivalSource === 'custom' && rivalMode === 'replace') ? { rivalCount } : {}),
      ...(rivalPressure !== 'normal' ? { rivalPressure } : {}),
      ...(!rivalMergers ? { rivalMergers: false } : {}),
      ...(!rivalFreight ? { rivalFreight: false } : {}),
      ...(emptyHub ? { emptyHub: true } : {}),
    });
  }

  const hubAirport    = AIRPORTS.find(a => a.code === hub);
  const countryGroups = groupedByCountry(hubSearch);

  return (
    <div className="setup-screen">
      <div className="setup-card" ref={cardRef} style={{ maxWidth: 600 }}>
        <div className="setup-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <img
            src="/tailwinds-mark-color.png"
            alt="Tailwinds"
            width={Math.round(28 * 1.27)}
            height={28}
            style={{ flexShrink: 0, display: 'block', objectFit: 'contain' }}
          />
          Tailwinds - Airline Manager
        </div>
        <div className="setup-subtitle">
          Build the world's greatest airline from scratch.
          You're starting with {seedCapitalLabel} in equity to get started — use it wisely.
        </div>

        {/* ── Step indicator ── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 22px' }}>
          {STEPS.map((label, i) => {
            const n = i + 1;
            const active = step === n;
            const done = step > n;
            return (
              <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8, flex: i < STEPS.length - 1 ? 1 : 'none' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <div style={{
                    width: 24, height: 24, borderRadius: '50%', flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 12, fontWeight: 700,
                    background: active || done ? 'var(--accent)' : 'var(--surface3)',
                    color: active || done ? '#fff' : 'var(--text-dim)',
                    transition: 'background .15s',
                  }}>
                    {done ? <Glyph e="✓" size={14} /> : n}
                  </div>
                  <span style={{
                    fontSize: 12, fontWeight: active ? 700 : 500,
                    color: active ? 'var(--text)' : 'var(--text-dim)',
                    whiteSpace: 'nowrap',
                  }}>{label}</span>
                </div>
                {i < STEPS.length - 1 && (
                  <div style={{ flex: 1, height: 2, background: step > n ? 'var(--accent)' : 'var(--border)', borderRadius: 2 }} />
                )}
              </div>
            );
          })}
        </div>

        <form onSubmit={handleStart}>

          {/* ════ STEP 1 — Brand your airline ════ */}
          <div style={{ display: step === 1 ? 'block' : 'none' }}>

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

          {/* ── Airline code ── */}
          <AirlineCodeField value={airlineCode} onChange={setAirlineCode} name={airlineName} />

          {/* ── Logo maker (shared with Edit Branding) ── */}
          <div className="form-group">
            <label className="form-label">Airline Logo</label>
            <LogoPicker
              name={airlineName}
              airlineCode={airlineCode}
              logoId={logoId} onLogoId={setLogoId}
              accentColor={accentColor} onAccentColor={setAccentColor}
              logoBg={logoBg} onLogoBg={setLogoBg}
              customLogo={customLogo} onCustomLogo={setCustomLogo}
            />
          </div>

          </div>{/* ════ END STEP 1 ════ */}

          {/* ════ STEP 2 — Home hub ════ */}
          <div style={{ display: step === 2 ? 'block' : 'none' }}>

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
                          <span style={{ color: 'var(--accent)', fontSize: 14, marginLeft: 4 }}><Glyph e="✓" /></span>
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
                  <Glyph e="🏠" /> Home country: {countryName(hubAirport.country)}
                </span>
              </div>
            )}
          </div>

          </div>{/* ════ END STEP 2 ════ */}

          {/* ════ STEP 3 — Options & launch ════ */}
          <div style={{ display: step === 3 ? 'block' : 'none' }}>

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
                  <Glyph e="🏅" /> Board Objectives
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                  {enableObjectives
                    ? 'Earn cash rewards by hitting strategic milestones and financial targets'
                    : 'Sandbox mode, no objectives, play freely'}
                </div>
              </div>
            </button>
            <button
              type="button"
              aria-pressed={productionLines}
              onClick={() => setProductionLines(v => !v)}
              style={{
                display: 'flex', alignItems: 'center', gap: 12, width: '100%',
                marginTop: 8, padding: '12px 14px',
                background: 'var(--surface2)',
                border: `1px solid ${productionLines ? 'var(--accent)' : 'var(--border)'}`,
                borderRadius: 'var(--radius)', cursor: 'pointer', textAlign: 'left',
              }}
            >
              <div style={{
                width: 36, height: 20, borderRadius: 10, position: 'relative', flexShrink: 0,
                background: productionLines ? 'var(--accent)' : 'var(--surface3)', transition: 'background 0.2s',
              }}>
                <div style={{
                  position: 'absolute', top: 2, left: productionLines ? 18 : 2, width: 16, height: 16,
                  borderRadius: '50%', background: '#fff', transition: 'left 0.2s',
                }} />
              </div>
              <div>
                <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)' }}>
                  <Glyph e="🏭" /> Production lines
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                  {productionLines
                    ? 'Aircraft come off factory lines you share with your rivals, and they order and wait too. Pay extra for an early slot, pay for purchases in stages, and sign up as a launch customer in era games'
                    : 'Classic ordering: a private delivery queue, paid in full when you order'}
                </div>
              </div>
            </button>
            <button
              type="button"
              aria-pressed={marketDev}
              onClick={() => setMarketDev(v => !v)}
              style={{
                display: 'flex', alignItems: 'center', gap: 12, width: '100%',
                marginTop: 8, padding: '12px 14px',
                background: 'var(--surface2)',
                border: `1px solid ${marketDev ? 'var(--accent)' : 'var(--border)'}`,
                borderRadius: 'var(--radius)', cursor: 'pointer', textAlign: 'left',
              }}
            >
              <div style={{
                width: 36, height: 20, borderRadius: 10, position: 'relative', flexShrink: 0,
                background: marketDev ? 'var(--accent)' : 'var(--surface3)', transition: 'background 0.2s',
              }}>
                <div style={{
                  position: 'absolute', top: 2, left: marketDev ? 18 : 2, width: 16, height: 16,
                  borderRadius: '50%', background: '#fff', transition: 'left 0.2s',
                }} />
              </div>
              <div>
                <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)' }}>
                  <Glyph e="📈" /> Market development
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                  {marketDev
                    ? 'Markets grow with the service they get: a new route builds its market over about a year, and a market fades slowly after its flights leave'
                    : 'Classic markets: every city pair has a fixed size whoever flies it'}
                </div>
              </div>
            </button>
          </div>

          {/* ── Era (real-calendar start) ── */}
          <div className="form-group">
            <label className="form-label"><Glyph e="🕰" /> Era</label>
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 8 }}>
              {[{ year: '', title: 'Classic', blurb: 'Timeless and endless. The whole catalogue from day one, modern demand and fuel, no closing date.' },
                ...ERA_PRESETS.map(p => ({ ...p, year: String(p.year) })),
                { year: 'custom', title: 'Custom year', blurb: `Pick any start between ${ERA_MIN_START_YEAR} and ${ERA_MAX_NEW_START_YEAR}. Every era run ends in ${HORIZON_YEAR}.` }].map(opt => {
                const active = eraSel === opt.year;
                return (
                  <button key={opt.year || 'classic'} type="button" onClick={() => setEraSel(opt.year)}
                    style={{
                      display: 'block', textAlign: 'left', padding: '10px 12px',
                      background: 'var(--surface2)',
                      border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                      borderRadius: 'var(--radius)', cursor: 'pointer',
                    }}>
                    <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)' }}>
                      {opt.year && opt.year !== 'custom' ? `${opt.year} · ` : ''}{opt.title}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{opt.blurb}</div>
                  </button>
                );
              })}
            </div>
            {eraSel === 'custom' && (
              <input type="number" min={ERA_MIN_START_YEAR} max={ERA_MAX_NEW_START_YEAR} value={eraCustom}
                onChange={e => setEraCustom(e.target.value)}
                style={{ marginTop: 8, width: 140 }} aria-label="Custom start year" />
            )}
            {eraSel !== '' && (
              <div style={{ fontSize: 11, color: eraInvalid ? 'var(--danger, #e5484d)' : 'var(--text-muted)', marginTop: 8 }}>
                {eraInvalid
                  ? `Enter a start year between ${ERA_MIN_START_YEAR} and ${ERA_MAX_NEW_START_YEAR}. The historical curves — demand, fares and fuel — begin in ${ERA_MIN_START_YEAR}.`
                  : `Your calendar starts in January ${startYear} and the horizon closes at the end of ${HORIZON_YEAR}: a ${runLengthYears(startYear)}-year run, `
                    + 'scored on market cap against whoever is still flying. Aircraft become available the year they really entered service, '
                    + 'demand and fuel follow their historical curves, and prices stay in today\'s dollars. '
                    + (startYear < 1990 ? 'Codeshares, alliances, Wi-Fi and ancillaries unlock as they were invented.' : 'Every route tool works from day one.')}
              </div>
            )}
          </div>

          {/* ── Rivals ── */}
          <div className="form-group">
            <label className="form-label"><Glyph e="⚔️" /> Rivals</label>
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 8 }}>
              {[{ id: 'random', title: 'Random rivals', blurb: 'About 25 airlines drawn from the game\'s own roster, different every game.' },
                { id: 'custom', title: 'Custom set', blurb: 'Paste a set of rivals: your own, or one shared on Discord. You can copy any game\'s rivals out from the Competition screen.' }].map(opt => {
                const active = rivalSource === opt.id;
                return (
                  <button key={opt.id} type="button" onClick={() => setRivalSource(opt.id)}
                    style={{
                      display: 'block', textAlign: 'left', padding: '10px 12px',
                      background: 'var(--surface2)',
                      border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                      borderRadius: 'var(--radius)', cursor: 'pointer',
                    }}>
                    <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)' }}>{opt.title}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{opt.blurb}</div>
                  </button>
                );
              })}
            </div>
            {rivalSource === 'custom' && (
              <div style={{ marginTop: 8, padding: '10px 12px', background: 'var(--surface2)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
                <textarea
                  value={rivalText}
                  onChange={e => setRivalText(e.target.value)}
                  rows={isMobile ? 7 : 9}
                  spellCheck={false}
                  aria-label="Rival set"
                  placeholder='{ "tailwindsRivals": 1, "rivals": [ { "name": "…", "hub": "LHR", "tier": "legacy", "size": "large" } ] }'
                  style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11.5, lineHeight: 1.4 }}
                />
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6, flexWrap: 'wrap' }}>
                  <button type="button" className="btn btn-ghost" style={{ padding: '4px 10px', fontSize: 12 }}
                    onClick={() => setRivalText(exampleRivalSet(eraInvalid ? null : startYear))}>
                    Load an example
                  </button>
                  {rivalText && (
                    <button type="button" className="btn btn-ghost" style={{ padding: '4px 10px', fontSize: 12 }}
                      onClick={() => setRivalText('')}>
                      Clear
                    </button>
                  )}
                </div>
                <div style={{ fontSize: 11, marginTop: 6, lineHeight: 1.5, color: rivalParse?.ok ? 'var(--green)' : 'var(--danger, #e5484d)' }}>
                  {rivalParse?.ok ? (
                    <>
                      <Glyph e="✓" /> {rivalSplit.byChance > 0
                        ? <>{rivalSplit.sure > 0 ? `${rivalSplit.sure} certain and ` : ''}{rivalSplit.byChance} by chance on day one</>
                        : <>{rivalSplit.starters.length} rival{rivalSplit.starters.length === 1 ? '' : 's'} on day one</>}
                      {rivalSplit.entrants.length > 0 && <>, {rivalSplit.entrants.length} founded later (from {rivalSplit.entrants[0].founded})</>}
                      {rivalSplit.dropped > 0 && <span style={{ color: 'var(--yellow)' }}> · only the first {RIVAL_SET_MAX_START} start; {rivalSplit.dropped} left out</span>}
                      {rivalSplit.byChance > 0 && <span style={{ color: 'var(--text-muted)' }}> · the dice roll when the game starts{rivalSplit.sure + rivalSplit.byChance > RIVAL_SET_MAX_START ? `, and at most ${RIVAL_SET_MAX_START} start` : ''}</span>}
                      {eraInvalid || startYear == null
                        ? rivalParse.set.rivals.some(r => r.founded != null) && <span style={{ color: 'var(--text-muted)' }}> · founding years only count in era games</span>
                        : null}
                    </>
                  ) : (
                    <>{(rivalParse?.errors ?? []).slice(0, 4).map((e, i) => <div key={i}>{e}</div>)}
                      {(rivalParse?.errors?.length ?? 0) > 4 && <div>…and {rivalParse.errors.length - 4} more.</div>}</>
                  )}
                </div>
                {rivalParse?.ok && rivalParse.warnings.length > 0 && (
                  <div style={{ fontSize: 11, marginTop: 4, color: 'var(--yellow)', lineHeight: 1.5 }}>
                    {rivalParse.warnings.slice(0, 3).map((w, i) => <div key={i}>{w}</div>)}
                    {rivalParse.warnings.length > 3 && <div>…and {rivalParse.warnings.length - 3} more.</div>}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 14, marginTop: 10, flexWrap: 'wrap', fontSize: 12, color: 'var(--text)' }}>
                  {[{ id: 'replace', label: 'Only these rivals' }, { id: 'add', label: 'These plus the random field' }].map(o => (
                    <label key={o.id} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                      <input type="radio" name="rival-mode" checked={rivalMode === o.id} onChange={() => setRivalMode(o.id)} />
                      {o.label}
                    </label>
                  ))}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6, lineHeight: 1.5 }}>
                  Each rival needs a name, a home airport code and a tier (budget, legacy or premium). Optional: size (small, medium or large),
                  founded and ceased (years: in era games the airline appears and closes in those years), logo, style, quality,
                  fleet (aircraft it flies, like "a320neo") or maker (like "Airbus", or a list like ["Boeing", "Embraer"]), hub2 (a second hub), routes (its
                  starting network, like "LHR-JFK") and chance (0 to 100: the percent chance it appears at all, higher where
                  few airlines are based near its hub). A logo can be "random". At the top of a set, "randomLogos": true
                  shuffles every logo and "chance": 50 sets everyone's. Load the example to see them all.
                </div>
              </div>
            )}
            {(() => {
              const pill = (value, setValue, opts) => (
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {opts.map(o => (
                    <button key={o.id} type="button" onClick={() => setValue(o.id)} title={o.title}
                      style={{
                        padding: '4px 10px', fontSize: 12, borderRadius: 14, cursor: 'pointer',
                        border: `1px solid ${value === o.id ? 'var(--accent)' : 'var(--border)'}`,
                        background: value === o.id ? 'rgba(56,139,253,0.15)' : 'var(--surface2)',
                        color: value === o.id ? 'var(--accent)' : 'var(--text-muted)',
                      }}>{o.label}</button>
                  ))}
                </div>
              );
              const row = (label, control, note) => (
                <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '150px 1fr', gap: isMobile ? 4 : 10, alignItems: 'center', marginTop: 10 }}>
                  <span style={{ fontSize: 12, color: 'var(--text)' }}>{label}</span>
                  <div>{control}{note && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>{note}</div>}</div>
                </div>
              );
              const countApplies = !(rivalSource === 'custom' && rivalMode === 'replace');
              return (
                <>
                  {countApplies && row('Random rivals',
                    pill(rivalCount, setRivalCount, [
                      { id: 'few', label: 'Few (10)' }, { id: 'normal', label: 'Usual (25)' }, { id: 'many', label: 'Many (40)' }]),
                    rivalCount === 'many' ? 'A crowded field: more competition on every route, and a busier rivals map.' : null)}
                  {row('Rival pressure',
                    pill(rivalPressure, setRivalPressure, [
                      { id: 'relaxed', label: 'Relaxed' }, { id: 'normal', label: 'Normal' }, { id: 'fierce', label: 'Fierce' }]),
                    rivalPressure === 'relaxed'
                      ? 'Rivals pay you half the usual attention, start fewer fare wars and make their moves less often.'
                      : rivalPressure === 'fierce'
                        ? 'Rivals watch you closely from early on, fight harder for your routes and move more often.'
                        : null)}
                  {row('New airlines',
                    pill(rivalStartups, setRivalStartups, [
                      { id: 'off', label: 'None' }, { id: 'rare', label: 'Rare' }, { id: 'normal', label: 'Normal' }, { id: 'frequent', label: 'Frequent' }]),
                    rivalStartups === 'off'
                      ? (rivalSource === 'custom' ? 'Only your set\'s own airlines ever join, so the game plays exactly as written.' : 'No random start-ups: the field only shrinks as airlines fail or are bought.')
                      : 'Random start-ups that join mid-game when the field has room.')}
                </>
              );
            })()}
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, fontSize: 12, color: 'var(--text)', cursor: 'pointer' }}>
              <input type="checkbox" checked={rivalMergers} onChange={e => setRivalMergers(e.target.checked)} />
              Rivals can merge with each other
            </label>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, marginLeft: 22 }}>
              {rivalMergers ? 'A strong rival sometimes buys a struggling one.' : 'Rivals never buy each other. You can still buy them.'}
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, fontSize: 12, color: 'var(--text)', cursor: 'pointer' }}>
              <input type="checkbox" checked={rivalFreight} onChange={e => setRivalFreight(e.target.checked)} />
              Rivals fly freight
            </label>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, marginLeft: 22 }}>
              {rivalFreight
                ? 'Established full-service rivals start freighter lanes from their hubs and compete with yours for the freight.'
                : 'Freight stays yours alone: rivals never fly freighters.'}
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, fontSize: 12, color: 'var(--text)', cursor: 'pointer' }}>
              <input type="checkbox" checked={emptyHub} onChange={e => setEmptyHub(e.target.checked)} />
              No rival based at my hub
            </label>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, marginLeft: 22 }}>
              Rivals still fly in, and airlines founded later may still base there.
            </div>
          </div>

          {/* ── Demand world ── */}
          <div className="form-group">
            <label className="form-label"><Glyph e="🎲" /> Passenger demand</label>
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 8 }}>
              {[{ id: '', title: 'Realistic', blurb: 'Every airport carries its real-world traffic. The map you know.' },
                { id: 'random', title: 'Randomized', blurb: 'Every airport\'s traffic is rolled. Some cities boom, others slump, and tiers move with them.' }].map(opt => {
                const active = demandMode === opt.id;
                return (
                  <button key={opt.id || 'realistic'} type="button" onClick={() => setDemandMode(opt.id)}
                    style={{
                      display: 'block', textAlign: 'left', padding: '10px 12px',
                      background: 'var(--surface2)',
                      border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                      borderRadius: 'var(--radius)', cursor: 'pointer',
                    }}>
                    <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)' }}>{opt.title}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{opt.blurb}</div>
                  </button>
                );
              })}
            </div>
            {demandMode === 'random' && (
              <div style={{ marginTop: 8, padding: '10px 12px', background: 'var(--surface2)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                  Traffic rolls by airport size: mega airports {rangeLabel(DEMAND_ROLL_RANGE.mega)},
                  majors {rangeLabel(DEMAND_ROLL_RANGE.major)}, regional airports {rangeLabel(DEMAND_ROLL_RANGE.regional)}.
                  A multi-airport city rolls once for all its airports. The world's total passengers stay at
                  their real-world level, so demand moves between cities rather than appearing from nowhere.
                  Airports that boom or slump far enough change tier, which moves their gate and landing fees.
                  Your hub's roll is revealed when you launch.
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, fontSize: 12, color: 'var(--text)', cursor: 'pointer' }}>
                  <input type="checkbox" checked={uncapMegas} onChange={e => setUncapMegas(e.target.checked)} />
                  Allow more mega airports than the real world has
                </label>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, marginLeft: 22 }}>
                  {uncapMegas
                    ? 'Every major that booms past the line becomes a mega.'
                    : 'Off: a major can only become a mega when a mega slumps out.'}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
                  <span style={{ fontSize: 12, color: 'var(--text)' }}>World #</span>
                  <input type="text" inputMode="numeric" value={demandSeed}
                    onChange={e => setDemandSeed(e.target.value.replace(/[^0-9]/g, ''))}
                    style={{ width: 120 }} aria-label="World seed" />
                  <button type="button" className="btn btn-ghost" style={{ padding: '4px 10px', fontSize: 12 }}
                    onClick={() => setDemandSeed(String(newDemandSeed()))}>
                    <Glyph e="🎲" /> Reroll
                  </button>
                </div>
                <div style={{ fontSize: 11, color: seedInvalid ? 'var(--danger, #e5484d)' : 'var(--text-muted)', marginTop: 4 }}>
                  {seedInvalid
                    ? 'Enter a world number of 1 or more.'
                    : 'Share the number to let a friend play the same world. Same number and mega setting, same world.'}
                </div>
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

          </div>{/* ════ END STEP 3 ════ */}

          {/* ── Step navigation ── */}
          <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
            {step > 1 && (
              <button
                type="button"
                className="btn btn-ghost"
                style={{ flex: '0 0 auto', padding: '12px 18px', fontSize: 14, fontWeight: 600 }}
                onClick={() => setStep(s => s - 1)}
              >
                ← Back
              </button>
            )}
            {/* Distinct keys, and NO type="submit" on the launch button.
                Chromium decides a click's default action AFTER the handlers
                run: React flushed setStep(3) synchronously, reused this very
                DOM node for the next step's button and flipped its type to
                "submit" — so the click that advanced Home hub -> Launch then
                submitted the form and started the game, and the player never
                saw the era picker. WebKit doesn't do this, which is why it only
                showed up in Chrome. Keys stop the node being reused; the
                onClick handler removes form submission from the path. */}
            {step < 3 ? (
              <button
                key="wizard-continue"
                type="button"
                className="btn btn-primary"
                style={{ flex: 1, padding: 12, fontSize: 15, fontWeight: 700, opacity: canContinue ? 1 : 0.5, cursor: canContinue ? 'pointer' : 'not-allowed' }}
                disabled={!canContinue}
                onClick={() => { if (canContinue) setStep(s => s + 1); }}
              >
                Continue →
              </button>
            ) : (
              <button
                key="wizard-launch"
                type="button"
                className="btn btn-primary"
                style={{ flex: 1, padding: 12, fontSize: 15, fontWeight: 700, opacity: rolling || rivalInvalid ? 0.6 : 1 }}
                disabled={rolling || rivalInvalid}
                title={rivalInvalid ? 'Fix the rival set, or switch back to random rivals' : undefined}
                onClick={handleStart}
              >
                {rolling ? 'Rolling the world…' : 'Launch Airline →'}
              </button>
            )}
          </div>
        </form>

        {/* A player on a new device lands here with no game, so no header and
            no Load button. Step 1 only: once they are building a new airline
            the offer is just noise. */}
        {step === 1 && (
          <div className="setup-continue">
            Continuing an airline?{' '}
            <button type="button" className="setup-continue-link" onClick={() => setShowLoad(true)}>
              {cloudSavesEnabled() ? 'Load from a save slot or the cloud' : 'Load from a save slot'}
            </button>
          </div>
        )}
      </div>
      {showLoad && (
        <SaveLoadModal
          mode="load" cloudNotice={cloudNotice}
          onClose={() => { setShowLoad(false); setCloudNotice(null); }}
        />
      )}
    </div>
  );
}
