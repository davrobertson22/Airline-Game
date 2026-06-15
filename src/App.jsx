import { useState, useEffect, useRef } from 'react';
import { useGame } from './store/GameContext.jsx';
import { ToastProvider, useToast } from './components/ToastSystem.jsx';
import WeeklyDebrief from './components/WeeklyDebrief.jsx';
import SaveLoadModal from './components/SaveLoadModal.jsx';
import { formatMoney, formatGameDate, weekToGameDate } from './utils/simulation.js';
import SetupScreen from './components/SetupScreen.jsx';
import Dashboard from './components/Dashboard.jsx';
import Fleet from './components/Fleet.jsx';
import Routes from './components/Routes.jsx';
import Marketplace from './components/Marketplace.jsx';
import Finance from './components/Finance.jsx';
import { DashboardIcon, RoutesIcon, FleetIcon, MarketIcon, FinanceIcon, CompetitionIcon, PlannerIcon, GateIcon, OperationsIcon, RepIcon, HubIcon, LoyaltyIcon } from './components/Icons.jsx';
import HubManagement from './components/HubManagement.jsx';
import Reputation from './components/Reputation.jsx';
import Competition from './components/Competition.jsx';
import RoutePlanner from './components/RoutePlanner.jsx';
import Airports from './components/Airports.jsx';
import RouteMap from './components/RouteMap.jsx';
import Operations from './components/Operations.jsx';
import Loyalty from './components/Loyalty.jsx';
import Alliances from './components/Alliances.jsx';
import AirlineLogo from './components/AirlineLogo.jsx';
import OnboardingTour, { TOUR_KEY } from './components/OnboardingTour.jsx';

function MapIcon({ size = 15 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" />
      <line x1="8" y1="2" x2="8" y2="18" />
      <line x1="16" y1="6" x2="16" y2="22" />
    </svg>
  );
}

function AllianceIcon({ size = 15 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  );
}

const TABS = [
  { id: 'dashboard',   label: 'Dashboard',     Icon: DashboardIcon   },
  { id: 'map',         label: 'Map',           Icon: MapIcon         },
  { id: 'planner',     label: 'Route Planner', Icon: PlannerIcon     },
  { id: 'routes',      label: 'Routes',        Icon: RoutesIcon      },
  { id: 'fleet',       label: 'Fleet',         Icon: FleetIcon       },
  { id: 'market',      label: 'Market',        Icon: MarketIcon      },
  { id: 'airports',    label: 'Gates',         Icon: GateIcon          },
  { id: 'hubs',        label: 'Hubs',          Icon: HubIcon           },
  { id: 'operations',  label: 'Operations',   Icon: OperationsIcon    },
  { id: 'reputation',  label: 'Reputation',    Icon: RepIcon         },
  { id: 'loyalty',     label: 'Loyalty',       Icon: LoyaltyIcon     },
  { id: 'alliances',   label: 'Alliances',    Icon: AllianceIcon    },
  { id: 'competition', label: 'Competition',  Icon: CompetitionIcon   },
  { id: 'finance',     label: 'Finance',       Icon: FinanceIcon     },
];

export default function App() {
  return (
    <ToastProvider>
      <AppInner />
    </ToastProvider>
  );
}

function AppInner() {
  const { state, dispatch } = useGame();
  const [activeTab, setActiveTab] = useState('dashboard');
  const [showTour, setShowTour] = useState(false);
  const [saveLoadMode, setSaveLoadMode] = useState(null); // 'save' | 'load' | null
  const [showNewGameConfirm, setShowNewGameConfirm] = useState(false);
  const addToast = useToast();

  // Show tour automatically the first time a game starts
  useEffect(() => {
    if (state.phase === 'playing' && !localStorage.getItem(TOUR_KEY)) {
      setShowTour(true);
    }
  }, [state.phase]);

  // Fire pending toasts from the reducer
  useEffect(() => {
    if (!state.pendingToasts?.length) return;
    state.pendingToasts.forEach(t => addToast(t));
    dispatch({ type: 'CLEAR_TOASTS' });
  }, [state.pendingToasts]);

  const WEEK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
  const LS_KEY = 'airline_next_week_at';

  function loadNextWeekAt() {
    const saved = localStorage.getItem(LS_KEY);
    if (saved) {
      const ts = parseInt(saved, 10);
      if (ts > Date.now()) return ts;
    }
    return Date.now() + WEEK_INTERVAL_MS;
  }

  const nextWeekAt = useRef(loadNextWeekAt());
  const [timeUntilNextWeek, setTimeUntilNextWeek] = useState(() => Math.max(0, nextWeekAt.current - Date.now()));

  function resetTimer() {
    const ts = Date.now() + WEEK_INTERVAL_MS;
    nextWeekAt.current = ts;
    localStorage.setItem(LS_KEY, String(ts));
    setTimeUntilNextWeek(WEEK_INTERVAL_MS);
  }

  // Auto-advance every hour
  useEffect(() => {
    if (state.phase !== 'playing') return;

    const tick = setInterval(() => {
      const remaining = nextWeekAt.current - Date.now();
      if (remaining <= 0) {
        dispatch({ type: 'ADVANCE_WEEK' });
        setActiveTab('dashboard');
        resetTimer();
      } else {
        setTimeUntilNextWeek(remaining);
      }
    }, 1000);

    return () => clearInterval(tick);
  }, [state.phase]);

  // Clear saved timer on reset/new game
  useEffect(() => {
    if (state.phase === 'setup') {
      localStorage.removeItem(LS_KEY);
    }
  }, [state.phase]);

  if (state.phase === 'setup') return <SetupScreen />;

  function handleAdvanceWeek() {
    dispatch({ type: 'ADVANCE_WEEK' });
    setActiveTab('dashboard');
    resetTimer();
  }

  function formatCountdown(ms) {
    const totalSec = Math.ceil(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  }

  function handleReset() {
    setShowNewGameConfirm(true);
  }

  function confirmNewGame() {
    setShowNewGameConfirm(false);
    dispatch({ type: 'RESET' });
  }

  const tabContent = {
    dashboard:   <Dashboard />,
    map:         <RouteMap />,
    planner:     <RoutePlanner />,
    routes:      <Routes />,
    fleet:       <Fleet />,
    market:      <Marketplace />,
    airports:    <Airports />,
    hubs:        <HubManagement />,
    operations:  <Operations />,
    reputation:  <Reputation />,
    loyalty:     <Loyalty />,
    alliances:   <Alliances />,
    competition: <Competition />,
    finance:     <Finance />,
  };

  return (
    <div className="app-layout">
      {/* Top bar */}
      <div className="topbar">
        <div className="topbar-logo">
          <span className="topbar-logo-icon">✈</span>
          Tailwinds - Airline Manager
        </div>
        <div className="topbar-sep" />
        <AirlineLogo id={state.logoId} size={28} radius={6} accentColor={state.logoColor} />
        <div className="topbar-airline">{state.airlineName}</div>
        <div className="topbar-spacer" />
        <div className="topbar-kpis">
          <div className="topbar-kpi">
            <span className="topbar-kpi-label">DATE</span>
            <span className="topbar-kpi-value" style={{ fontSize: 13 }}>{formatGameDate(state)}</span>
          </div>
          <div className="topbar-kpi-divider" />
          <div className="topbar-kpi">
            <span className="topbar-kpi-label">CASH</span>
            <span className={`topbar-cash ${state.cash < 0 ? 'negative' : ''}`}>
              {formatMoney(state.cash)}
            </span>
          </div>
        </div>
        <button className="btn-advance" onClick={handleAdvanceWeek} title="Advance now (auto-advances in the shown time)">
          Next Week › <span style={{ fontSize: 11, opacity: 0.7, marginLeft: 4 }}>{formatCountdown(timeUntilNextWeek)}</span>
        </button>
        <button
          className="btn btn-ghost"
          style={{ fontSize: 12, padding: '5px 10px' }}
          onClick={() => setSaveLoadMode('save')}
          title="Save game to a slot"
        >
          💾 Save
        </button>
        <button
          className="btn btn-ghost"
          style={{ fontSize: 12, padding: '5px 10px' }}
          onClick={() => setSaveLoadMode('load')}
          title="Load a saved game"
        >
          📂 Load
        </button>
        <button
          className="btn btn-ghost"
          style={{ fontSize: 12, padding: '5px 10px' }}
          onClick={() => setShowTour(true)}
          title="How to play"
        >
          ?
        </button>
        <button
          className="btn btn-ghost"
          style={{ fontSize: 12, padding: '5px 10px' }}
          onClick={handleReset}
        >
          New Game
        </button>
      </div>

      {/* Nav tabs */}
      <div className="nav-tabs">
        {TABS.map(({ id, label, Icon }) => (
          <button
            key={id}
            className={`nav-tab ${activeTab === id ? 'active' : ''}`}
            onClick={() => setActiveTab(id)}
          >
            <Icon size={14} />
            <span>{label}</span>
          </button>
        ))}
      </div>

      {/* Page content */}
      <div className="main-content">
        {tabContent[activeTab]}
      </div>

      {/* Weekly debrief modal */}
      <WeeklyDebrief />

      {/* Advance-week error overlay — shows if reducer threw */}
      {state.advanceWeekError && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,.8)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999,
        }}>
          <div style={{
            background: 'var(--surface)', border: '1px solid var(--red)',
            borderRadius: 12, padding: 32, maxWidth: 500, width: '90%',
          }}>
            <div style={{ fontSize: 24, marginBottom: 8 }}>⚠️ Advance Week Error</div>
            <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 16 }}>
              An error occurred while advancing the week. Please copy this message and report it:
            </p>
            <pre style={{
              background: 'var(--surface2)', padding: 12, borderRadius: 6,
              fontSize: 11, overflowX: 'auto', color: 'var(--red)', whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
            }}>
              {state.advanceWeekError}
            </pre>
            <button
              className="btn btn-primary"
              style={{ marginTop: 16, width: '100%' }}
              onClick={() => dispatch({ type: 'CLEAR_ERROR' })}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Bankrupt overlay */}
      {state.phase === 'bankrupt' && (
        <div className="bankrupt-overlay">
          <div className="bankrupt-card">
            <div style={{ fontSize: 48, marginBottom: 16 }}>💸</div>
            <h2 style={{ fontSize: 24, marginBottom: 8 }}>Bankruptcy</h2>
            <p style={{ color: 'var(--text-muted)', marginBottom: 8 }}>
              {state.airlineName} has been declared bankrupt.
            </p>
            <p style={{ color: 'var(--text-dim)', fontSize: 13, marginBottom: 24, lineHeight: 1.6 }}>
              {state.bankruptcyReason === 'missed_loans'
                ? '3 loan payments were missed. The bank has called in your debt and seized operations.'
                : state.bankruptcyReason === 'consecutive_negative'
                ? 'Your cash was negative for 6 consecutive weeks. Unable to sustain operations.'
                : 'Your airline ran out of cash.'}
            </p>
            <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 24, padding: '10px 14px', background: 'var(--surface2)', borderRadius: 8 }}>
              Weeks survived: <strong style={{ color: 'var(--text)' }}>{((state.year - 1) * 52 + state.week)}</strong>
              {state.missedLoanPayments > 0 && <> · Missed payments: <strong style={{ color: 'var(--red)' }}>{state.missedLoanPayments}</strong></>}
            </div>
            <button
              className="btn btn-primary"
              style={{ width: '100%', padding: 12 }}
              onClick={handleReset}
            >
              Start New Airline
            </button>
          </div>
        </div>
      )}

      {/* Victory overlay — all competitors acquired */}
      {state.gameWon && !state.victoryAcknowledged && (
        <VictoryOverlay
          stats={state.victoryStats}
          airlineName={state.airlineName}
          logoId={state.logoId}
          logoColor={state.logoColor}
          onContinue={() => dispatch({ type: 'ACKNOWLEDGE_VICTORY' })}
          onNewGame={handleReset}
        />
      )}

      {/* Onboarding tour */}
      {showTour && <OnboardingTour onClose={() => setShowTour(false)} />}

      {/* Save / Load modal */}
      {saveLoadMode && (
        <SaveLoadModal mode={saveLoadMode} onClose={() => setSaveLoadMode(null)} />
      )}

      {/* New Game confirmation */}
      {showNewGameConfirm && (
        <div className="saveload-overlay" onClick={e => { if (e.target === e.currentTarget) setShowNewGameConfirm(false); }}>
          <div className="confirm-modal">
            <h2 className="confirm-modal-title">Start a New Game?</h2>
            <p className="confirm-modal-body">
              Your current game is auto-saved and can be recovered via <strong>Load Game</strong> if you save it to a slot first.
              Starting a new game will reset everything.
            </p>
            <div className="confirm-modal-actions">
              <button className="btn btn-ghost" onClick={() => setShowNewGameConfirm(false)}>Cancel</button>
              <button className="btn btn-danger" onClick={confirmNewGame}>Start New Game</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Victory screen ───────────────────────────────────────────────────────────

function VictoryStat({ label, value }) {
  return (
    <div style={{ textAlign: 'center', minWidth: 90 }}>
      <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--text)' }}>{value}</div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 2 }}>
        {label}
      </div>
    </div>
  );
}

function VictoryOverlay({ stats, airlineName, logoId, logoColor, onContinue, onNewGame }) {
  const s = stats ?? {};
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9998,
      background: 'radial-gradient(circle at 50% 30%, rgba(16,185,129,0.18), rgba(0,0,0,0.85))',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }}>
      <div className="card" style={{
        width: '100%', maxWidth: 460, padding: '32px 28px 24px', textAlign: 'center',
        border: '1px solid rgba(16,185,129,0.5)',
      }}>
        <div style={{ fontSize: 52, marginBottom: 8 }}>🏆</div>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
          <AirlineLogo id={logoId} size={44} radius={8} accentColor={logoColor} />
        </div>
        <h2 style={{ fontSize: 26, marginBottom: 6, color: 'var(--green)' }}>You Control the Skies</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 4, lineHeight: 1.5 }}>
          {airlineName} has acquired every competitor{s.lastRival ? <> — {s.lastRival} was the last to fall</> : null}.
          The industry is yours.
        </p>

        <div style={{
          display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '18px 24px',
          margin: '22px 0', padding: '18px 12px', background: 'var(--surface2)', borderRadius: 10,
        }}>
          {s.marketCap != null && <VictoryStat label="Market cap" value={formatMoney(s.marketCap)} />}
          <VictoryStat label="Cash" value={formatMoney(s.cash ?? 0)} />
          <VictoryStat label="Aircraft" value={s.fleetCount ?? 0} />
          <VictoryStat label="Routes" value={s.routeCount ?? 0} />
          <VictoryStat label="Airports" value={s.airports ?? 0} />
          <VictoryStat label="Years played" value={s.year ?? '–'} />
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={onContinue}
            style={{
              flex: 1, padding: '11px 0', borderRadius: 8, fontWeight: 700, fontSize: 14, cursor: 'pointer',
              background: 'var(--green)', border: 'none', color: '#fff',
            }}
          >
            Keep Playing
          </button>
          <button
            onClick={onNewGame}
            style={{
              flex: 1, padding: '11px 0', borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: 'pointer',
              background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)',
            }}
          >
            New Game
          </button>
        </div>
      </div>
    </div>
  );
}
