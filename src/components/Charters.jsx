import { useState, useMemo } from 'react';
import {
  useGame, charterAcceptBlockReason, charterOpRecord,
} from '../store/GameContext.jsx';
import { useConfirm } from './ConfirmModal.jsx';
import { useToast } from './ToastSystem.jsx';
import AirportLink from './AirportLink.jsx';
import { Glyph } from './Icons.jsx';
import ReserveNotice, { ReserveBadge, reserveOptionTag, reserveButtonTag } from './ReserveNotice.jsx';
import { getAircraftType } from '../data/aircraft.js';
import { getAirport } from '../data/airports.js';
import { isOutOfService } from '../data/maintenance.js';
import { isReserve } from '../data/reserve.js';
import {
  generateCharterBoard, servedAirportsOf, aircraftStationOf, quoteCharterForAircraft,
} from '../models/charterBoard.js';
import { CHARTER_TYPES } from '../data/charters.js';
import {
  formatMoney, effectiveRangeKm, routeBlockHours, blockHourFit,
  MAX_WEEKLY_BLOCK_HOURS, routeDistanceKm,
} from '../utils/simulation.js';

// ─────────────────────────────────────────────────────────────────────────────
// CHARTERS — the offer board and the contract book.
//
// The one rule this page follows, and the reason it looks the way it does:
// IT NEVER TELLS THE PLAYER WHETHER A CONTRACT IS WORTH TAKING.
//
// Pick an aircraft and it shows what that aeroplane costs to fly this mission —
// fuel, crew, landing, handling, the ferry legs, and the hours against its
// utilisation. That is arithmetic the player is entitled to have done for them.
// What it deliberately withholds is the verdict: no profit figure, no margin, no
// "recommended" badge, no green tick. Opportunity cost, what fuel will do across
// a sixteen-week term, and whether you have cover if the tail breaks are the
// player's judgement, and working them out is the whole feature.
//
// (The offer object carries `margin` and `isTrap` for the tests. Rendering
// either of them would defeat the point of the page.)
// ─────────────────────────────────────────────────────────────────────────────

const ACCENT = '#9d8cff';

export function CharterBadge() {
  return (
    <span style={{ background: `${ACCENT}22`, color: ACCENT, border: `1px solid ${ACCENT}55`, borderRadius: 4, padding: '2px 7px', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>
      <Glyph e="📜" /> Charter
    </span>
  );
}

const km = (n) => `${Math.round(n).toLocaleString()} km`;

/** A small labelled figure, used across both panes. */
function Stat({ label, value, tone }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--text-muted)' }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 600, color: tone ?? 'var(--text)' }}>{value}</div>
    </div>
  );
}

// ─── The quote panel ─────────────────────────────────────────────────────────

/**
 * What THIS aircraft costs to fly THIS contract. Cost only — see the file header.
 */
function Quote({ offer, aircraft, state }) {
  const type = aircraft ? getAircraftType(aircraft.typeId) : null;
  const served = useMemo(() => servedAirportsOf(state), [state]);
  if (!offer || !aircraft || !type) return null;

  const station = aircraftStationOf(aircraft, {
    routes: state.routes, cargoRoutes: state.cargoRoutes ?? [],
    charters: state.charters ?? [], hub: state.hub,
  });
  const positionFrom = station && station !== offer.origin ? station : null;
  const quote = quoteCharterForAircraft(offer, aircraft, type, {
    fuelIndex: state.fuelPrice?.index ?? 1.0, served, positionFrom,
  });
  if (!quote) return null;

  const proto = charterOpRecord(offer, aircraft.id);
  const missionHrs = routeBlockHours(proto, type, offer.flightsPerWeek);
  const fit = blockHourFit({
    aircraftId: aircraft.id, type,
    routes: state.routes, cargoRoutes: state.cargoRoutes ?? [], charters: state.charters ?? [],
    hoursPerFlight: missionHrs, weeklyFrequency: 1, ignoreSeason: true,
    capHours: MAX_WEEKLY_BLOCK_HOURS,
  });

  const Row = ({ label, value, muted, note }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '3px 0', fontSize: 12 }}>
      <span style={{ color: muted ? 'var(--text-muted)' : 'var(--text)' }}>
        {label}
        {note && <span style={{ color: 'var(--text-muted)', fontSize: 11 }}> · {note}</span>}
      </span>
      <span style={{ fontVariantNumeric: 'tabular-nums', color: muted ? 'var(--text-muted)' : 'var(--text)' }}>{value}</span>
    </div>
  );

  return (
    <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '10px 12px', marginTop: 8 }}>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--text-muted)', marginBottom: 6 }}>
        What {aircraft.tailNumber || aircraft.name} costs to fly it
      </div>
      <Row label="Fuel" value={quote.fuelBoughtByCustomer ? 'customer pays' : `${formatMoney(quote.perWeek.fuel)}/wk`}
           muted={quote.fuelBoughtByCustomer} />
      <Row label="Crew" value={`${formatMoney(quote.perWeek.crew)}/wk`} />
      <Row label="Landing &amp; nav" value={`${formatMoney(quote.perWeek.landing)}/wk`} />
      {quote.perWeek.handling > 0 && (
        <Row label="Ground handling" note="station you don't serve" value={`${formatMoney(quote.perWeek.handling)}/wk`} />
      )}
      <div style={{ borderTop: '1px solid var(--border)', margin: '6px 0' }} />
      <Row label={`Flying cost, ${offer.weeks} week${offer.weeks !== 1 ? 's' : ''}`} value={formatMoney(quote.termCost)} />
      {quote.permits > 0 && <Row label="Permits &amp; setup" note="one-off, on signature" value={formatMoney(quote.permits)} />}
      {quote.ferry > 0 && (
        <Row label="Positioning" note={`empty legs from ${positionFrom}, ${km(quote.ferryKm)}`} value={formatMoney(quote.ferry)} />
      )}
      <div style={{ borderTop: '1px solid var(--border)', margin: '6px 0' }} />
      <Row label="Block hours" note={`${Math.round(fit.existingHours)}h committed now`}
           value={`+${Math.round(missionHrs)}h/wk of ${MAX_WEEKLY_BLOCK_HOURS}h`} />
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6, lineHeight: 1.5 }}>
        Flying cost only. It doesn't count what those hours would earn on your schedule,
        and the fee is fixed for the whole term whatever fuel does.
      </div>
    </div>
  );
}

// ─── One offer ───────────────────────────────────────────────────────────────

function OfferCard({ offer, absWeek }) {
  const { state, dispatch } = useGame();
  const addToast = useToast();
  const [aircraftId, setAircraftId] = useState('');

  const fleet = state.fleet ?? [];
  const chosen = fleet.find(a => a.id === aircraftId) ?? null;
  const chosenType = chosen ? getAircraftType(chosen.typeId) : null;

  // Every tail, each with the reason it cannot take this contract (null = it can).
  // Computed through the same guard the reducer uses, so the page can never offer
  // an aircraft the submit would refuse.
  const candidates = useMemo(() => fleet
    .filter(a => a.status !== 'retired')
    .map(a => ({ a, reason: charterAcceptBlockReason(state, offer.id, a.id) }))
    .sort((x, y) => (x.reason ? 1 : 0) - (y.reason ? 1 : 0)
      || String(x.a.name ?? '').localeCompare(String(y.a.name ?? ''))),
    [state, offer.id]);

  const eligible = candidates.filter(c => !c.reason);
  const blockReason = chosen ? candidates.find(c => c.a.id === chosen.id)?.reason : null;
  const weeksLeft = Math.max(0, (offer.expiresWeek ?? absWeek) - absWeek + 1);

  const accept = () => {
    if (!chosen || blockReason) return;
    dispatch({ type: 'ACCEPT_CHARTER', offerId: offer.id, aircraftId: chosen.id });
    addToast({
      icon: offer.icon, color: offer.color,
      title: 'Contract signed',
      message: `${offer.origin}–${offer.destination} for ${offer.customer}, ${offer.weeks} week${offer.weeks !== 1 ? 's' : ''}.`,
    });
  };

  return (
    <div className="card" style={{ padding: '14px 16px', borderLeft: `3px solid ${offer.color}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 16 }}><Glyph e={offer.icon} size={16} /></span>
            <strong style={{ fontSize: 15 }}>
              <AirportLink code={offer.origin} /> → <AirportLink code={offer.destination} />
            </strong>
            <span style={{ fontSize: 11, fontWeight: 700, color: offer.color, background: `${offer.color}1e`,
                           border: `1px solid ${offer.color}55`, borderRadius: 4, padding: '2px 7px' }}>
              {offer.name}
            </span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
            For {offer.customer} · {km(offer.distanceKm)}
            {' · '}{offer.freighter ? `needs ${offer.tonnesRequired}t payload`
              : offer.bizjet ? `needs a business jet with ${offer.seatsRequired} seats`
              : `needs ${offer.seatsRequired} seats`}
            {' · '}{offer.runwayFt.toLocaleString()}ft runway
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--green)' }}>{formatMoney(offer.fee)}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{formatMoney(offer.feePerWeek)}/wk fixed</div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginTop: 10 }}>
        <Stat label="Term" value={`${offer.weeks} wk`} />
        <Stat label="Frequency" value={`${offer.flightsPerWeek}× / wk`} />
        <Stat label="Offer closes" value={weeksLeft <= 1 ? 'this week' : `${weeksLeft} wks`}
              tone={weeksLeft <= 1 ? 'var(--yellow)' : undefined} />
        <Stat label="If you walk away" value={formatMoney(offer.breachPenalty)} tone="var(--red)" />
      </div>

      {offer.type === CHARTER_TYPES.ACMI && (
        <div style={{ fontSize: 12, color: ACCENT, marginTop: 8 }}>
          <Glyph e="🤝" size={12} /> Wet lease — you supply aircraft, crew, maintenance and insurance.
          The customer buys the fuel.
        </div>
      )}

      <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <select
          value={aircraftId}
          onChange={(e) => setAircraftId(e.target.value)}
          style={{ flex: '1 1 260px', minWidth: 0 }}
        >
          <option value="">
            {eligible.length > 0
              ? `Choose an aircraft (${eligible.length} can fly this)`
              : 'No aircraft in your fleet can fly this'}
          </option>
          {candidates.map(({ a, reason }) => (
            <option key={a.id} value={a.id} disabled={!!reason}>
              {(a.tailNumber || a.name)} · {getAircraftType(a.typeId)?.name ?? a.typeId}
              {reserveOptionTag(a)}
              {reason ? ` — ${reason}` : ''}
            </option>
          ))}
        </select>
        <button
          className="btn btn-primary"
          disabled={!chosen || !!blockReason}
          onClick={accept}
        >
          Sign contract{chosen ? reserveButtonTag(chosen) : ''}
        </button>
        <button
          className="btn"
          onClick={() => dispatch({ type: 'DISMISS_CHARTER_OFFER', offerId: offer.id })}
          title="Take this off your board"
        >
          Pass
        </button>
      </div>

      {chosen && blockReason && (
        <div style={{ fontSize: 12, color: 'var(--red)', marginTop: 6 }}>{blockReason}</div>
      )}

      {/* Signing with a stationed reserve ends its standby — the same warning
          every route picker carries, for the same reason. */}
      {chosen && isReserve(chosen) && (
        <ReserveNotice
          aircraft={chosen}
          fleet={state.fleet}
          ops={[...(state.routes ?? []), ...(state.cargoRoutes ?? [])]}
          action="Signing this contract"
          typeName={chosenType?.name}
        />
      )}

      {chosen && !blockReason && <Quote offer={offer} aircraft={chosen} state={state} />}
    </div>
  );
}

// ─── One running contract ────────────────────────────────────────────────────

function ContractCard({ contract }) {
  const { state, dispatch } = useGame();
  const confirm = useConfirm();
  const addToast = useToast();

  const aircraft = (state.fleet ?? []).find(a => a.id === contract.aircraftId);
  const original = contract.coverForAircraftId
    ? (state.fleet ?? []).find(a => a.id === contract.coverForAircraftId) : null;
  const type = aircraft ? getAircraftType(aircraft.typeId) : null;

  // Breach risk: the tail is out of service and nothing same-type is standing by
  // to take it over. This is the one forward-looking thing the page does say,
  // because it is about the airline's own exposure, not the contract's worth.
  const grounded = aircraft ? isOutOfService(aircraft) : true;
  const hasCover = (state.fleet ?? []).some(a =>
    a.id !== contract.aircraftId && a.typeId === aircraft?.typeId
    && isReserve(a) && !isOutOfService(a)
    && (a.reserveBase === contract.origin || a.reserveBase === contract.destination));
  const atRisk = grounded && !hasCover && !contract.coverForAircraftId;

  const cancel = async () => {
    const ok = await confirm({
      title: 'Walk away from this contract?',
      message: `Breaking the ${contract.origin}–${contract.destination} contract costs ${formatMoney(contract.breachPenalty)} `
             + `and damages your charter record. ${contract.weeksRemaining} week${contract.weeksRemaining !== 1 ? 's' : ''} remain.`,
      confirmLabel: 'Break contract',
      danger: true,
    });
    if (!ok) return;
    dispatch({ type: 'CANCEL_CHARTER', charterId: contract.id });
    addToast({ icon: '⚠️', color: 'var(--red)', title: 'Contract broken',
      message: `${formatMoney(contract.breachPenalty)} penalty paid.` });
  };

  const pct = contract.weeksTotal > 0
    ? Math.min(1, (contract.weeksTotal - contract.weeksRemaining) / contract.weeksTotal) : 0;

  return (
    <div className="card" style={{ padding: '14px 16px', borderLeft: `3px solid ${contract.color ?? ACCENT}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Glyph e={contract.icon ?? '📜'} size={16} />
            <strong style={{ fontSize: 15 }}>
              <AirportLink code={contract.origin} /> → <AirportLink code={contract.destination} />
            </strong>
            {contract.status === 'positioning' && (
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--yellow)' }}>POSITIONING</span>
            )}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
            {contract.name} for {contract.customer} · {contract.flightsPerWeek}× / wk
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--green)' }}>{formatMoney(contract.feePerWeek)}/wk</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {`${contract.weeksRemaining} of ${contract.weeksTotal} wks left`}
          </div>
        </div>
      </div>

      <div style={{ height: 4, background: 'var(--bg)', borderRadius: 999, margin: '10px 0 8px' }}>
        <div style={{ height: '100%', width: `${pct * 100}%`, background: contract.color ?? ACCENT, borderRadius: 999 }} />
      </div>

      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
        <Stat label="Flown by" value={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {aircraft ? (aircraft.tailNumber || aircraft.name) : '—'}
            {aircraft && <ReserveBadge aircraft={aircraft} />}
          </span>
        } />
        {original && <Stat label="Covering for" value={original.tailNumber || original.name} tone="var(--yellow)" />}
        <Stat label="Aircraft" value={type?.name ?? '—'} />
        <Stat label="Breach penalty" value={formatMoney(contract.breachPenalty)} tone="var(--red)" />
      </div>

      {atRisk && (
        <div style={{ fontSize: 12, color: 'var(--red)', background: 'rgba(248,81,73,.10)',
                      border: '1px solid rgba(248,81,73,.35)', borderRadius: 'var(--radius)',
                      padding: '8px 10px', marginTop: 10, lineHeight: 1.5 }}>
          <Glyph e="⚠️" size={12} />{' '}
          <strong>{aircraft?.tailNumber || aircraft?.name}</strong> is out of service and no same-type
          reserve is stationed at {contract.origin} or {contract.destination}. If it is still down when
          the week runs, this contract is breached and costs {formatMoney(contract.breachPenalty)}.
          Move it to another aircraft, or station a reserve.
        </div>
      )}

      <div style={{ marginTop: 10 }}>
        <button className="btn btn-danger" onClick={cancel}>Break contract</button>
      </div>
    </div>
  );
}

// ─── The page ────────────────────────────────────────────────────────────────

export default function Charters() {
  const { state } = useGame();
  const absWeek = ((state.year ?? 1) - 1) * 52 + (state.week ?? 1);
  const board = useMemo(() => generateCharterBoard(state, absWeek), [state, absWeek]);
  const contracts = (state.charters ?? []).filter(c => c.status === 'active' || c.status === 'positioning');
  const reliability = state.charterReliability ?? 50;

  const weeklyFees = contracts
    .filter(c => c.status === 'active')
    .reduce((s, c) => s + (c.feePerWeek ?? 0), 0);

  const record = reliability >= 80 ? { label: 'Trusted', tone: 'var(--green)' }
    : reliability >= 55 ? { label: 'Good', tone: 'var(--text)' }
    : reliability >= 35 ? { label: 'Mixed', tone: 'var(--yellow)' }
    : { label: 'Poor', tone: 'var(--red)' };

  return (
    <div>
      <div className="card" style={{ padding: '14px 18px', marginBottom: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18 }}><Glyph e="📜" size={18} /> Charters</h2>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-muted)', maxWidth: 640, lineHeight: 1.6 }}>
              Fixed-fee flying, posted by brokers who know your airline. The cheque is the same
              whoever flies it — what it is worth depends on which of your aircraft takes it,
              how far that aircraft is from the pickup, and what you give up on the schedule.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap' }}>
            <Stat label="Contracts running" value={contracts.length} />
            <Stat label="Contracted income" value={`${formatMoney(weeklyFees)}/wk`} tone="var(--green)" />
            <Stat label="Delivery record" value={record.label} tone={record.tone} />
          </div>
        </div>
      </div>

      <h3 style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--text-muted)', margin: '18px 0 8px' }}>
        Offer board
      </h3>
      {board.length === 0 ? (
        <div className="card" style={{ padding: '18px', fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6 }}>
          Nothing on the board this week. Brokers post work to carriers they have heard of —
          grow your awareness and your reputation and more of it, better paid, will come your way.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {board.map(o => <OfferCard key={o.id} offer={o} absWeek={absWeek} />)}
        </div>
      )}

      <h3 style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--text-muted)', margin: '22px 0 8px' }}>
        Contracts running
      </h3>
      {contracts.length === 0 ? (
        <div className="card" style={{ padding: '18px', fontSize: 13, color: 'var(--text-muted)' }}>
          You are not flying any charter contracts.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {contracts.map(c => <ContractCard key={c.id} contract={c} />)}
        </div>
      )}
    </div>
  );
}
