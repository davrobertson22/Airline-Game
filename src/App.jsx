import { useState, useEffect, useRef } from 'react';
import { useGame } from './store/GameContext.jsx';
import { ToastProvider, useToast } from './components/ToastSystem.jsx';
import WeeklyDebrief from './components/WeeklyDebrief.jsx';
import { formatMoney } from './utils/simulation.js';
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
  const addToast = useToast();

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
    if (window.confirm('Start a new game? All progress will be lost.')) {
      dispatch({ type: 'RESET' });
    }
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
          Bastian Boys Airline Empires
        </div>
        <div className="topbar-sep" />
        <AirlineLogo id={state.logoId} size={28} radius={6} accentColor={state.logoColor} />
        <div className="topbar-airline">{state.airlineName}</div>
        <div className="topbar-spacer" />
        <div className="topbar-kpis">
          <div className="topbar-kpi">
            <span className="topbar-kpi-label">WEEK</span>
            <span className="topbar-kpi-value">{state.week} / {state.year}</span>
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

      {/* Bankrupt overlay */}
      {state.phase === 'bankrupt' && (
        <div className="bankrupt-overlay">
          <div className="bankrupt-card">
            <div style={{ fontSize: 48, marginBottom: 16 }}>💸</div>
            <h2 style={{ fontSize: 24, marginBottom: 8 }}>Bankruptcy</h2>
            <p style={{ color: 'var(--text-muted)', marginBottom: 24 }}>
              {state.airlineName} has run out of cash.
            </p>
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
    </div>
  );
}
