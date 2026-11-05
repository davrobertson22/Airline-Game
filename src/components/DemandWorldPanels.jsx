// Randomized demand worlds — the panels around the dice (data/demandWorld.js):
//
//   • WorldPreview      the setup screen's look at a world before launch
//   • AutoRoller        "roll until": conditions on named airports, searched for
//   • DemandWorldShare  the running game's world number, with a Copy button
//
// Discord, 2026-11-05 (VodkaOnFire): the world number vanished once a game
// began, a world could only be seen by launching it, and finding a world where
// a couple of chosen airports boom meant launching over and over.
import { useState, useRef, useEffect } from 'react';
import { getAirport, baseTierOf } from '../data/airports.js';
import {
  worldFactor, summarizeDemandWorld, demandWorldShareText, megaCapLabel,
  worldSearcher, ruleReachable, rollRangeOf, newDemandSeed,
} from '../data/demandWorld.js';
import { Glyph } from './Icons.jsx';

const muted = { fontSize: 11, color: 'var(--text-muted)' };

/** "+12%" / "−8%" from a whole percent. */
export function fmtRollPct(n) {
  return `${n > 0 ? '+' : n < 0 ? '−' : '±'}${Math.abs(n)}%`;
}
const rollPct = (world, code) => Math.round((worldFactor(world, code) - 1) * 100);
const pctColor = (n) => (n > 0 ? 'var(--green)' : n < 0 ? 'var(--red)' : 'var(--text-muted)');

/** Copy text to the clipboard; `copied` flips true for a moment. */
export function useCopyText() {
  const [copied, setCopied] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
      return true;
    } catch { return false; }
  }
  return [copied, copy];
}

/** A tier name for display, from the world's override or the real tier. */
function tierIn(world, code) {
  return world?.tiers?.[code] ?? baseTierOf(code);
}

function CodeList({ codes }) {
  return <span style={{ fontFamily: 'monospace' }}>{codes.join(', ')}</span>;
}

/**
 * The setup screen's preview: your hub's roll, the headline booms and busts,
 * and every tier change. `world` is null while it rolls.
 */
export function WorldPreview({ world, hub, busy, error, onPickHub, onHide }) {
  const sum = world ? summarizeDemandWorld(world, 5) : null;
  const hubAirport = getAirport(hub);
  const hubPct = world ? rollPct(world, hub) : 0;
  const hubTier = world ? tierIn(world, hub) : null;
  const hubMoved = world && hubTier !== baseTierOf(hub);
  const minorMoves = sum ? sum.promotedToMajor.length + sum.demotedToRegional.length : 0;
  return (
    <div data-world-preview style={{ marginTop: 10, padding: '10px 12px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', flex: 1 }}>
          {world ? `World #${world.seed}` : 'World preview'}
        </span>
        <button type="button" className="btn btn-ghost" style={{ padding: '2px 8px', fontSize: 11 }} onClick={onHide}>Hide</button>
      </div>
      {error ? (
        <div style={muted}>Couldn't load the airport table to roll this world. Check your connection and try again.</div>
      ) : !world || busy ? (
        <div style={muted}>Rolling the world…</div>
      ) : (
        <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.6 }}>
          <div>
            <Glyph e="🏠" /> Your hub, <strong>{hub}</strong>{hubAirport ? ` ${hubAirport.city}` : ''}:{' '}
            <strong style={{ color: pctColor(hubPct) }}>{fmtRollPct(hubPct)} traffic</strong>
            {hubMoved && <span style={muted}> · now a {hubTier} airport (really {baseTierOf(hub)})</span>}
            {onPickHub && (
              <button type="button" onClick={onPickHub}
                style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 12, padding: 0, marginLeft: 8 }}>
                Change hub
              </button>
            )}
          </div>
          {sum.booms.length > 0 && (
            <div>Booming: {sum.booms.map((b, i) => (
              <span key={b.code}>{i > 0 && ', '}<span style={{ fontFamily: 'monospace' }}>{b.code}</span> <span style={{ color: pctColor(b.pct) }}>{fmtRollPct(b.pct)}</span></span>
            ))}</div>
          )}
          {sum.busts.length > 0 && (
            <div>Slumping: {sum.busts.map((b, i) => (
              <span key={b.code}>{i > 0 && ', '}<span style={{ fontFamily: 'monospace' }}>{b.code}</span> <span style={{ color: pctColor(b.pct) }}>{fmtRollPct(b.pct)}</span></span>
            ))}</div>
          )}
          {sum.promotedToMega.length > 0 && <div>New mega airports: <CodeList codes={sum.promotedToMega} /></div>}
          {sum.demotedFromMega.length > 0 && <div>No longer mega: <CodeList codes={sum.demotedFromMega} /></div>}
          {minorMoves > 0 && (
            <div style={muted}>
              {sum.promotedToMajor.length} regional airport{sum.promotedToMajor.length === 1 ? '' : 's'} grew into majors
              and {sum.demotedToRegional.length} major{sum.demotedToRegional.length === 1 ? '' : 's'} shrank to regional.
            </div>
          )}
          <div style={{ ...muted, marginTop: 4 }}>
            The hub list on the Home hub step now shows every airport's roll in this world.
          </div>
        </div>
      )}
    </div>
  );
}

// ── Auto-roller ───────────────────────────────────────────────────────────────

const MAX_RULES = 5;
export const MAX_TRIES = 50_000;
const SLICE_MS = 24;   // work per frame, so the screen stays responsive

const OP_LABEL = { atLeast: 'rolls at least', atMost: 'rolls at most', tier: 'becomes' };

// A starting target each tier can reach: megas barely move, regionals swing widely.
const DEFAULT_PCT = { mega: 5, major: 20, regional: 40 };
function newRule(code = '') {
  const tier = code && getAirport(code) ? baseTierOf(code) : 'major';
  return { id: Math.random().toString(36).slice(2), code, op: 'atLeast', pct: DEFAULT_PCT[tier] ?? 20, tier: 'mega' };
}

/** A rule as the searcher takes it, or null while the row is half-filled. */
function cleanRule(r) {
  const code = String(r.code ?? '').trim().toUpperCase();
  if (!getAirport(code)) return null;
  if (r.op === 'tier') return { code, op: 'tier', tier: r.tier };
  const pct = Math.round(Number(r.pct));
  if (!Number.isFinite(pct)) return null;
  return { code, op: r.op, pct };
}

/**
 * Roll worlds until one meets every condition, then hand its seed back.
 * `loadMarkets` resolves to AIRPORT_MARKETS (the table loads on demand).
 */
export function AutoRoller({ hub, uncapMegas, loadMarkets, onFound }) {
  const [rules, setRules]   = useState(() => [newRule(hub)]);
  const [run, setRun]       = useState(null);   // { tries, found?, failed?, error? }
  const stopRef = useRef(false);
  const running = run && !run.done;
  useEffect(() => () => { stopRef.current = true; }, []);

  const cleaned = rules.map(cleanRule);
  const usable = cleaned.filter(Boolean);
  const unreachable = usable.filter(r => !ruleReachable(r));
  const canRun = usable.length > 0 && unreachable.length === 0 && !running;

  function update(id, patch) { setRules(rs => rs.map(r => (r.id === id ? { ...r, ...patch } : r))); }

  async function start() {
    if (!canRun) return;
    stopRef.current = false;
    setRun({ tries: 0 });
    let markets;
    try { markets = await loadMarkets(); }
    catch { setRun({ tries: 0, done: true, error: true }); return; }
    const searcher = worldSearcher(markets, { uncapMegas });
    const target = usable;
    let tries = 0;
    const tried = new Set();
    const step = () => {
      if (stopRef.current) { setRun({ tries, done: true, stopped: true }); return; }
      const until = performance.now() + SLICE_MS;
      while (performance.now() < until && tries < MAX_TRIES) {
        const seed = newDemandSeed();
        if (tried.has(seed)) continue;
        tried.add(seed);
        tries++;
        const world = searcher.test(seed, target);
        if (world) { setRun({ tries, done: true, found: world.seed }); onFound(world); return; }
      }
      if (tries >= MAX_TRIES) { setRun({ tries, done: true, failed: true }); return; }
      setRun({ tries });
      setTimeout(step, 0);
    };
    setTimeout(step, 0);
  }

  const inputStyle = { fontSize: 12, padding: '3px 6px' };
  return (
    <div data-auto-roller style={{ marginTop: 10, padding: '10px 12px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>Roll until…</div>
      <div style={{ ...muted, marginTop: 2, marginBottom: 8 }}>
        Set conditions on airports you care about and the dice roll until a world meets all of them.
        It only searches the rolls. It can't build a world that couldn't come up by chance.
      </div>
      {rules.map((r, i) => {
        const c = cleaned[i];
        const range = c ? rollRangeOf(c.code) : null;
        const bad = c && !ruleReachable(c);
        return (
          <div key={r.id} style={{ marginBottom: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <input type="text" value={r.code} maxLength={4} placeholder="Code" aria-label="Airport code"
                onChange={e => update(r.id, { code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })}
                style={{ ...inputStyle, width: 56, fontFamily: 'monospace' }} disabled={running} />
              <select value={r.op} onChange={e => update(r.id, { op: e.target.value })} style={inputStyle} disabled={running} aria-label="Condition">
                {Object.entries(OP_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              {r.op === 'tier' ? (
                <select value={r.tier} onChange={e => update(r.id, { tier: e.target.value })} style={inputStyle} disabled={running} aria-label="Tier">
                  <option value="mega">a mega airport</option>
                  <option value="major">a major airport</option>
                  <option value="regional">a regional airport</option>
                </select>
              ) : (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 12, color: 'var(--text)' }}>
                  <input type="number" value={r.pct} step={5} aria-label="Percent"
                    onChange={e => update(r.id, { pct: e.target.value })}
                    style={{ ...inputStyle, width: 62 }} disabled={running} />% traffic
                </span>
              )}
              {rules.length > 1 && (
                <button type="button" onClick={() => setRules(rs => rs.filter(x => x.id !== r.id))} disabled={running}
                  aria-label="Remove condition"
                  style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '0 4px' }}>
                  <Glyph e="✕" size={12} />
                </button>
              )}
            </div>
            {r.code && !c && <div style={{ ...muted, color: 'var(--red)' }}>No airport with code {r.code.toUpperCase()}.</div>}
            {c && (
              <div style={{ ...muted, color: bad ? 'var(--red)' : 'var(--text-muted)' }}>
                {getAirport(c.code).city} is a {baseTierOf(c.code)} airport and rolls about {fmtRollPct(Math.round((range[0] - 1) * 100))} to {fmtRollPct(Math.round((range[1] - 1) * 100))}.
                {bad && (c.op === 'tier' ? ' It can\'t become that tier in one world.' : ' That roll is out of its reach.')}
              </div>
            )}
          </div>
        );
      })}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
        {rules.length < MAX_RULES && (
          <button type="button" className="btn btn-ghost" style={{ padding: '4px 10px', fontSize: 12 }} disabled={running}
            onClick={() => setRules(rs => [...rs, newRule()])}>
            + Add condition
          </button>
        )}
        {running ? (
          <button type="button" className="btn btn-ghost" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => { stopRef.current = true; }}>
            Stop
          </button>
        ) : (
          <button type="button" className="btn btn-primary" style={{ padding: '4px 12px', fontSize: 12, opacity: canRun ? 1 : 0.5 }} disabled={!canRun} onClick={start}>
            <Glyph e="🎲" /> Roll until found
          </button>
        )}
        <span style={muted}>
          {running && `Rolled ${run.tries.toLocaleString('en-US')} worlds…`}
          {run?.found && `Found world #${run.found} after ${run.tries.toLocaleString('en-US')} ${run.tries === 1 ? 'roll' : 'rolls'}.`}
          {run?.failed && `No match in ${MAX_TRIES.toLocaleString('en-US')} worlds. Loosen a condition and try again.`}
          {run?.stopped && `Stopped after ${run.tries.toLocaleString('en-US')} worlds.`}
          {run?.error && 'Couldn\'t load the airport table. Check your connection and try again.'}
        </span>
      </div>
    </div>
  );
}

// ── In game ───────────────────────────────────────────────────────────────────

/**
 * The running game's world number and mega setting, with Copy. Renders nothing
 * in a realistic game. `variant="menu"` fits the map view's Settings menu.
 */
export function DemandWorldShare({ world, variant = 'inline' }) {
  const [copied, copy] = useCopyText();
  if (!world || !Number.isFinite(world.seed)) return null;
  const text = demandWorldShareText(world);
  if (variant === 'menu') {
    return (
      <>
        <div className="ms-menu-title">Passenger demand</div>
        <button role="menuitem" data-world-share onClick={() => copy(text)} title="Copy this world to share it. Paste it into World # on the new-game screen to play the same world.">
          <span className="ms-menu-glyph">🎲</span>
          <span style={{ flex: 1 }}>
            World #{world.seed}
            <span style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)' }}>{megaCapLabel(world.uncapMegas)}</span>
          </span>
          <span style={{ fontSize: 11, color: copied ? 'var(--green)' : 'var(--accent)' }}>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </>
    );
  }
  return (
    <div data-world-share style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      <span>🎲 Randomized world <strong style={{ color: 'var(--text)' }}>#{world.seed}</strong> · {megaCapLabel(world.uncapMegas)}</span>
      <button type="button" onClick={() => copy(text)}
        title="Copy this world to share it. Paste it into World # on the new-game screen to play the same world."
        style={{ background: 'none', border: 'none', color: copied ? 'var(--green)' : 'var(--accent)', cursor: 'pointer', fontSize: 12, padding: 0 }}>
        <Glyph e="📋" size={12} /> {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}
