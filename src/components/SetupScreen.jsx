import { useState } from 'react';
import { useGame } from '../store/GameContext.jsx';
import { AIRPORTS } from '../data/airports.js';
import AirlineLogo, { AIRLINE_LOGOS } from './AirlineLogo.jsx';

export default function SetupScreen() {
  const { dispatch } = useGame();
  const [airlineName, setAirlineName] = useState('');
  const [hub,         setHub]         = useState('JFK');
  const [logoId,      setLogoId]      = useState(AIRLINE_LOGOS[0].id);

  function handleStart(e) {
    e.preventDefault();
    if (!airlineName.trim()) return;
    dispatch({ type: 'START_GAME', airlineName: airlineName.trim(), hub, logoId });
  }

  const hubAirport = AIRPORTS.find(a => a.code === hub);

  return (
    <div className="setup-screen">
      <div className="setup-card" style={{ maxWidth: 560 }}>
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
              gridTemplateColumns: 'repeat(6, 1fr)',
              gap: 8,
              padding: '12px',
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
                      gap: 4,
                      padding: '7px 4px',
                      background: selected ? 'var(--accent-dim)' : 'transparent',
                      border: `2px solid ${selected ? 'var(--accent)' : 'transparent'}`,
                      borderRadius: 8,
                      cursor: 'pointer',
                      transition: 'border-color .12s, background .12s',
                    }}
                  >
                    <AirlineLogo id={logo.id} size={36} />
                    <span style={{
                      fontSize: 9,
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

            {/* Preview */}
            {airlineName.trim() && (
              <div style={{
                marginTop: 10,
                padding: '10px 14px',
                background: 'var(--surface2)',
                borderRadius: 8,
                border: '1px solid var(--border)',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
              }}>
                <AirlineLogo id={logoId} size={32} />
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{airlineName}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    {AIRLINE_LOGOS.find(l => l.id === logoId)?.name} livery
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
              {AIRPORTS.map(a => (
                <option key={a.code} value={a.code}>
                  {a.code} — {a.city}, {a.country}
                </option>
              ))}
            </select>
            {hubAirport && (
              <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text-muted)' }}>
                {hubAirport.name} · {hubAirport.population}M metro area · {hubAirport.tier} hub
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
            Don't let your cash hit zero!
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
