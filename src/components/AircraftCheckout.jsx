import { useState } from 'react';
import NumberStepper from './NumberStepper.jsx';
import { useGame } from '../store/GameContext.jsx';
import { getAircraftType, effectivePurchasePrice, eraPurchasePrice, eraWeeklyLease, orderDiscount, canFitWifi, wifiAirframeDenial } from '../data/aircraft.js';
import {
  formatMoney,
  CLASS_FARE_MULTIPLIERS,
  CLASS_SPACE_MULTIPLIERS,
  SEAT_QUALITY_COST_PER_ROUTE,
  SERVICE_QUALITY_COST_PER_ROUTE,
  weekToGameDate,
  configRangeMod, calendarYear, cruiseSpeedKmh, typicalSeatsOf } from '../utils/simulation.js';
import {
  wifiInstallCost, wifiRetrofitCost, wifiLeaseSurcharge, WIFI_WEEKLY_OPEX,
} from '../data/wifi.js';
import { featureLive, ERA_FEATURE_MESSAGE } from '../data/eraFeatures.js';
import { absoluteWeek } from '../utils/fuel.js';
import { deliverySchedule, deliveryLead } from '../data/delivery.js';
import { makeSlotAllocator, slotPremiumPct, slotCalendar, launchWindow, launchOrderDiscount, lineInfo, lineOf } from '../data/productionLines.js';
import { withLineBook } from '../models/lineBook.js';
import { Glyph, GlyphLabel } from './Icons.jsx';
import CabinTemplatePicker from './CabinTemplatePicker.jsx';
import { ReplacesSection, replacesForDispatch } from './FleetRenewal.jsx';
import {
  buildPaymentSchedule, preDeliveryTotal, signingAmount, committedPreDelivery,
} from '../models/orderPayments.js';

const CAT_COLORS = {
  'Turboprop':    '#ffb43d',
  'Regional Jet': '#38d39f',
  'Narrow Body':  '#3ea6ff',
  'Wide Body':    '#a98bff',
};

const QUALITY_OPTIONS = [
  { value: 'basic',    label: 'Basic',    desc: 'Budget fittings, no frills.' },
  { value: 'standard', label: 'Standard', desc: 'Comfortable, no-nonsense.' },
  { value: 'premium',  label: 'Premium',  desc: 'Enhanced seats, better meals.' },
  { value: 'luxury',   label: 'Luxury',   desc: 'Flagship product. Premium cost.' },
];

const CLASS_COLORS = {
  firstClass:     '#bc8cff',
  businessClass:  '#ffb43d',
  premiumEconomy: '#3ea6ff',
  economy:        '#38d39f',
};


function absWeekToDisplay(absWeek) {
  const year       = Math.floor((absWeek - 1) / 52) + 1;
  const weekInYear = ((absWeek - 1) % 52) + 1;
  const { monthName, weekInMonth } = weekToGameDate(weekInYear);
  return { displayYear: year, displayWeek: weekInYear, monthName, weekInMonth };
}

function AircraftPhoto({ src, alt, category }) {
  const [failed, setFailed] = useState(false);
  const color = CAT_COLORS[category] || '#93a4ba';
  if (failed || !src) {
    return (
      <div style={{
        width: '100%', height: 160,
        background: `linear-gradient(160deg, ${color}18 0%, transparent 100%)`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        borderRadius: '10px 10px 0 0',
      }}>
        <span style={{ fontSize: 56, opacity: 0.2 }}><Glyph e="✈" /></span>
      </div>
    );
  }
  return (
    <img src={src} alt={alt}
      style={{ width: '100%', height: 160, objectFit: 'cover', borderRadius: '10px 10px 0 0', display: 'block' }}
      onError={() => setFailed(true)}
    />
  );
}

// ── Compact class row with inline +/- ────────────────────────────────────────
function ClassRow({ label, color, fareLabel, spaceLabel, value, max, onChange }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '7px 0',
      borderBottom: '1px solid var(--border)',
    }}>
      <div style={{ width: 10, height: 10, borderRadius: 2, background: color, flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500 }}>{label}</div>
        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1 }}>
          {fareLabel} · {spaceLabel}
        </div>
      </div>
      {/* − / value / + */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
        <button
          onClick={() => onChange(Math.max(0, value - 1))}
          disabled={value === 0}
          style={{
            width: 26, height: 26, borderRadius: 5,
            border: '1px solid var(--border)', background: 'var(--surface2)',
            color: value === 0 ? 'var(--text-dim)' : 'var(--text)',
            cursor: value === 0 ? 'default' : 'pointer',
            fontSize: 16, lineHeight: 1,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >−</button>
        <input
          type="number" min={0} max={max} value={value}
          onChange={e => onChange(Math.min(max, Math.max(0, parseInt(e.target.value, 10) || 0)))}
          style={{
            width: 50, textAlign: 'center', fontSize: 14, fontWeight: 600,
            background: 'var(--surface2)', border: '1px solid var(--border)',
            borderRadius: 5, color: 'var(--text)', padding: '3px 4px',
          }}
        />
        <button
          onClick={() => onChange(Math.min(max, value + 1))}
          disabled={value >= max}
          style={{
            width: 26, height: 26, borderRadius: 5,
            border: '1px solid var(--border)', background: 'var(--surface2)',
            color: value >= max ? 'var(--text-dim)' : 'var(--text)',
            cursor: value >= max ? 'default' : 'pointer',
            fontSize: 16, lineHeight: 1,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >+</button>
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', width: 30, textAlign: 'right', flexShrink: 0 }}>
        seats
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

// `replaceIds` presets the "Replaces" block (Fleet ▸ bulk replace); `onOrdered`
// runs after a successful dispatch, before onClose.
export default function AircraftCheckout({ typeId, mode, onClose, replaceIds = null, onOrdered = null }) {
  const { state, dispatch } = useGame();
  const { cash, fleet, pendingOrders = [], year, week } = state;

  const type = getAircraftType(typeId);
  // The `!type` guard is deliberately BELOW every hook in this component rather
  // than here. React requires the same hooks in the same order on every render;
  // returning above them meant an unknown typeId rendered 1 hook and a known one
  // rendered 13, so any render that changed `typeId` from unknown to known (or
  // back) while this modal stayed mounted would throw "Rendered more hooks than
  // during the previous render" and unmount the tree. That is the same fault
  // that black-screened every new game from App.jsx. Everything between here and
  // the guard therefore tolerates a null type.
  const isFreighter   = !!type?.freighter;
  const catColor      = CAT_COLORS[type?.category] || '#93a4ba';
  const configOptions = type?.configOptions ?? {};
  const engines       = configOptions.engines ?? [];
  const wingtipDef    = configOptions.wingtips ?? null;
  const maxSeats      = type?.seats ?? 0;

  // ── Engine / wingtip ──────────────────────────────────────────────────────
  const defaultEngine = engines.find(e => e.default) ?? engines[0];
  const [selectedEngineId, setSelectedEngineId] = useState(defaultEngine?.id ?? null);
  const [hasWingtips, setHasWingtips]            = useState(false);
  // Line-fit connectivity. Cheaper now than retrofitting later (see data/wifi.js),
  // which is the whole reason it belongs on the order form rather than only on
  // the Fleet page.
  const [hasWifi, setHasWifi]                    = useState(false);

  // ── Production lines (data/productionLines.js) ───────────────────────────
  // A factory line per family shared with every rival, your frames a class gap
  // apart, earlier slots at a premium. An announced, not-yet-flying type is a
  // launch order.
  const linesWorld  = state.productionLinesWorld === true;
  const launchTerms = (() => {
    if (!linesWorld || mode !== 'buy' || !type) return null;
    const lw = launchWindow(state, type);
    return lw?.open ? lw : null;
  })();
  const isLaunch = !!launchTerms;
  // null = the standard week (no premium); an absWeek = start looking there.
  const [slotFrom, setSlotFrom] = useState(null);

  // ── Quantity ──────────────────────────────────────────────────────────────
  const [quantity, setQuantity] = useState(Math.max(launchTerms?.minQty ?? 1, Math.min(100, replaceIds?.length || 1)));

  // ── Fleet renewal: which existing tails these frames take over from ──────
  const [replaceSel, setReplaceSel]           = useState(replaceIds ?? []);
  const [replaceDisposal, setReplaceDisposal] = useState('dispose');

  // ── Custom name (optional) ────────────────────────────────────────────────
  const [customName, setCustomName] = useState('');

  // ── Cabin configuration ───────────────────────────────────────────────────
  const [first, setFirstRaw] = useState(0);
  const [biz,   setBizRaw]   = useState(0);
  const [prem,  setPremRaw]  = useState(0);
  // A new aircraft arrives at the type's TYPICAL seating, where its headline range
  // applies; packing it up to the exit limit costs range (payloadRangeMod).
  const [eco,   setEcoRaw]   = useState(typicalSeatsOf(type));
  const [seatQ, setSeatQ]    = useState('standard');
  const [servQ, setServQ]    = useState('standard');

  // Every hook above has now run unconditionally. Safe to bail.
  if (!type) return null;

  // Clamp economy whenever premium classes change to avoid over-allocation
  function clampEco(f, b, p, currentEco) {
    const premUnits = f * CLASS_SPACE_MULTIPLIERS.firstClass
                    + b * CLASS_SPACE_MULTIPLIERS.businessClass
                    + p * CLASS_SPACE_MULTIPLIERS.premiumEconomy;
    const maxE = Math.max(0, Math.floor((maxSeats - premUnits) / CLASS_SPACE_MULTIPLIERS.economy));
    return Math.min(currentEco, maxE);
  }
  function setFirst(v) { setFirstRaw(v); setEcoRaw(e => clampEco(v,   biz,  prem, e)); }
  function setBiz(v)   { setBizRaw(v);   setEcoRaw(e => clampEco(first, v,   prem, e)); }
  function setPrem(v)  { setPremRaw(v);  setEcoRaw(e => clampEco(first, biz,  v,   e)); }
  function setEco(v)   { setEcoRaw(v); }

  // Apply a saved cabin template (clamped defensively to this type's floor space)
  function applyTemplate(cfg) {
    const f = Math.max(0, cfg.firstClass ?? 0);
    const b = Math.max(0, cfg.businessClass ?? 0);
    const p = Math.max(0, cfg.premiumEconomy ?? 0);
    setFirstRaw(f);
    setBizRaw(b);
    setPremRaw(p);
    setEcoRaw(clampEco(f, b, p, Math.max(0, cfg.economy ?? 0)));
    setSeatQ(cfg.seatQuality ?? 'standard');
    setServQ(cfg.serviceQuality ?? 'standard');
  }

  const usedUnits = first * CLASS_SPACE_MULTIPLIERS.firstClass
                  + biz   * CLASS_SPACE_MULTIPLIERS.businessClass
                  + prem  * CLASS_SPACE_MULTIPLIERS.premiumEconomy
                  + eco   * CLASS_SPACE_MULTIPLIERS.economy;
  const over = usedUnits > maxSeats;

  const maxFirst = Math.floor(
    (maxSeats - biz * CLASS_SPACE_MULTIPLIERS.businessClass - prem * CLASS_SPACE_MULTIPLIERS.premiumEconomy - eco * CLASS_SPACE_MULTIPLIERS.economy)
    / CLASS_SPACE_MULTIPLIERS.firstClass
  );
  const maxBiz = Math.floor(
    (maxSeats - first * CLASS_SPACE_MULTIPLIERS.firstClass - prem * CLASS_SPACE_MULTIPLIERS.premiumEconomy - eco * CLASS_SPACE_MULTIPLIERS.economy)
    / CLASS_SPACE_MULTIPLIERS.businessClass
  );
  const maxPrem = Math.floor(
    (maxSeats - first * CLASS_SPACE_MULTIPLIERS.firstClass - biz * CLASS_SPACE_MULTIPLIERS.businessClass - eco * CLASS_SPACE_MULTIPLIERS.economy)
    / CLASS_SPACE_MULTIPLIERS.premiumEconomy
  );
  const maxEco = Math.max(0, Math.floor(
    (maxSeats - first * CLASS_SPACE_MULTIPLIERS.firstClass - biz * CLASS_SPACE_MULTIPLIERS.businessClass - prem * CLASS_SPACE_MULTIPLIERS.premiumEconomy)
    / CLASS_SPACE_MULTIPLIERS.economy
  ));

  // Revenue index vs all-economy
  const totalPhysical = first + biz + prem + eco;
  const revenueIndex = totalPhysical > 0
    ? (first / totalPhysical) * CLASS_FARE_MULTIPLIERS.firstClass
    + (biz   / totalPhysical) * CLASS_FARE_MULTIPLIERS.businessClass
    + (prem  / totalPhysical) * CLASS_FARE_MULTIPLIERS.premiumEconomy
    + (eco   / totalPhysical) * CLASS_FARE_MULTIPLIERS.economy
    : 1;

  const extraQualityCost =
    (SEAT_QUALITY_COST_PER_ROUTE[seatQ] ?? 0) +
    (SERVICE_QUALITY_COST_PER_ROUTE[servQ] ?? 0);

  // Freighters carry cargo, not passengers — no cabin layout to choose. Pass null
  // so delivery falls back to the (irrelevant) default config.
  const cabinConfig = isFreighter ? null : {
    firstClass:     first,
    businessClass:  biz,
    premiumEconomy: prem,
    economy:        eco,
    seatQuality:    seatQ,
    serviceQuality: servQ,
  };

  // ── Engine / wingtip modifiers ────────────────────────────────────────────
  const selectedEngine    = engines.find(e => e.id === selectedEngineId) ?? defaultEngine;
  const engineFuelMod     = selectedEngine?.fuelMod  ?? 1.0;
  const enginePriceMod    = selectedEngine?.priceMod ?? 1.0;
  const engineMaintMod    = selectedEngine?.maintMod ?? 1.0;
  const wingtipFuelMod    = (hasWingtips && wingtipDef) ? (wingtipDef.fuelMod  ?? 1.0) : 1.0;
  const wingtipRangeMod   = (hasWingtips && wingtipDef) ? (wingtipDef.rangeMod ?? 1.0) : 1.0;
  const wingtipCost       = (hasWingtips && wingtipDef) ? (wingtipDef.cost     ?? 0)   : 0;
  const combinedFuelMod   = Math.round(engineFuelMod * wingtipFuelMod * 10000) / 10000;
  const fuelPctSaving     = Math.round((1 - combinedFuelMod) * 100);
  const rangePctGain      = Math.round((wingtipRangeMod - 1) * 100);
  const maintPctChange    = Math.round((engineMaintMod - 1) * 100);
  const effectiveRange    = Math.round(type.range * wingtipRangeMod);
  // Cabin-density range bonus (fewer passengers = more range)
  const cabinForRange     = { firstClass: first, businessClass: biz, premiumEconomy: prem, economy: eco };
  const cabinRangeMod     = configRangeMod(cabinForRange, type);
  const effectiveRangeFull = Math.round(type.range * wingtipRangeMod * cabinRangeMod);
  const cabinRangePctGain  = Math.round((cabinRangeMod - 1) * 100);

  // ── Delivery schedule ─────────────────────────────────────────────────────
  const lead           = deliveryLead(type);
  const currentAbsWeek = absoluteWeek(year, week);
  const pendingOfType  = pendingOrders.filter(o => o.typeId === typeId);
  // Production lines: the allocator ORDER_AIRCRAFT uses, over the same line
  // (your orders and every rival's), so the weeks on screen are the weeks you get.
  const lineState = linesWorld ? withLineBook(state, currentAbsWeek) : null;
  const lineAlloc = lineState ? makeSlotAllocator(lineState, type, {
    absWeek:   currentAbsWeek,
    fromWeek:  isLaunch ? null : slotFrom,
    notBefore: isLaunch ? launchTerms.eisAbs : null,
  }) : null;
  const deliveryWeeks  = lineAlloc
    ? Array.from({ length: quantity }, () => lineAlloc.take())
    : deliverySchedule(type, pendingOrders, currentAbsWeek, quantity);
  const firstDelivery = deliveryWeeks[0];
  const lastDelivery  = deliveryWeeks[deliveryWeeks.length - 1];
  const { displayYear: firstYear, monthName: firstMon, weekInMonth: firstWIM } = absWeekToDisplay(firstDelivery);
  const { displayYear: lastYear,  monthName: lastMon,  weekInMonth: lastWIM  } = absWeekToDisplay(lastDelivery);

  // ── Pricing ───────────────────────────────────────────────────────────────
  const fleetCountNow   = fleet.filter(a => a.typeId === typeId).length;
  const pendingCountNow = pendingOfType.length;
  const alreadyOwned    = fleetCountNow + pendingCountNow;
  const discount        = mode === 'buy'
    ? (isLaunch ? launchOrderDiscount(state, type, quantity) : orderDiscount(quantity))
    : 0;
  const discPct         = Math.round(discount * 100);
  const calYear         = calendarYear(state);   // era new-build premium while the line is open (null = classic)
  const baseUnitPrice   = isLaunch
    ? Math.round(eraPurchasePrice(type, calYear) * (1 - discount))
    : effectivePurchasePrice(type, mode === 'buy' ? quantity : 1, calYear);
  const enginePriceAdj  = Math.round(baseUnitPrice * (enginePriceMod - 1));
  const unitBuyPrice    = Math.round(baseUnitPrice * enginePriceMod) + wingtipCost;
  // Early-slot premium per frame, on list price — the reducer's exact formula.
  // Bought: part of the price. Leased: a one-off fee alongside the deposit.
  const framePremiums    = deliveryWeeks.map(w => lineAlloc
    ? Math.round(eraPurchasePrice(type, calYear) * enginePriceMod * slotPremiumPct(type, w, currentAbsWeek))
    : 0);
  const totalSlotPremium = framePremiums.reduce((a, b) => a + b, 0);
  const premiumFrames    = framePremiums.filter(x => x > 0).length;
  const totalBuyPrice   = unitBuyPrice * quantity + (mode === 'buy' ? totalSlotPremium : 0);
  // Owned: connectivity capex falls due up front, on top of the airframe price.
  // Leased: the lessor amortises it into the rate instead (wifiLeaseAdj below),
  // so charging it here too would bill for the same antenna twice. Both mirror
  // ORDER_AIRCRAFT exactly — if these drift, the quote on screen is a lie.
  // Two independent gates on the connectivity option, and both have been
  // wrong (Discord 2026-09-03): the WORLD has to have onboard internet in it
  // at all, and the AIRFRAME has to be able to carry an installation. A
  // Constellation fails the second in every world; a brand-new DC-6 in a 1950
  // world failed the first and was offered the package anyway.
  const wifiEraLive     = featureLive('wifi', calYear);
  const wifiFittable    = canFitWifi(type);
  const wifiOffered     = wifiEraLive && wifiFittable;
  const wantsWifi       = hasWifi && wifiOffered;
  const unitWifiFee     = (wantsWifi && mode === 'buy') ? wifiInstallCost() : 0;
  const totalWifiFee    = unitWifiFee * quantity;
  const buyTotalDue     = totalBuyPrice + totalWifiFee;

  const baseWeeklyLease  = eraWeeklyLease(type, calYear);
  const engineLeaseAdj   = Math.round(baseWeeklyLease * (enginePriceMod - 1));
  const wingtipLeaseAdj  = (hasWingtips && wingtipDef) ? Math.round((wingtipDef.cost ?? 0) / 200) : 0;
  const wifiLeaseAdj     = wantsWifi ? wifiLeaseSurcharge() : 0;
  const unitWeeklyLease  = baseWeeklyLease + engineLeaseAdj + wingtipLeaseAdj + wifiLeaseAdj;
  const totalWeeklyLease = unitWeeklyLease * quantity;
  const unitLeaseDeposit  = unitWeeklyLease * 12;   // 3 months (12 weeks) upfront
  const totalLeaseDeposit = unitLeaseDeposit * quantity;
  const leaseDueNow       = totalLeaseDeposit + (mode === 'lease' ? totalSlotPremium : 0);

  // ── Staged payments (order book §2) ──────────────────────────────────────
  // Under the `orderBook` flag an owned order pays a deposit now, instalments
  // before delivery and the balance on the delivery week. Signing needs cash
  // for the deposit and every pre-delivery instalment — this order's and the
  // unpaid ones already on the book. Same helpers ORDER_AIRCRAFT uses, so the
  // quote and the charge cannot disagree.
  // Launch orders are bought outright (no staged payments), as the reducer does.
  const staged          = mode === 'buy' && state.orderBook === true && !isLaunch;
  const unitContract    = unitBuyPrice + unitWifiFee;
  const unitPreDelivery = preDeliveryTotal(unitContract);
  const committedPdp    = staged ? committedPreDelivery(pendingOrders) : 0;
  // Each frame's contract carries its own early-slot premium.
  const frameContract   = (i) => unitContract + framePremiums[i];
  const stagedSigning   = staged
    ? deliveryWeeks.reduce((s, w, i) => s + signingAmount(buildPaymentSchedule(frameContract(i), currentAbsWeek, w), currentAbsWeek), 0)
    : 0;
  const stagedPreDelivery = staged
    ? deliveryWeeks.reduce((s, _w, i) => s + preDeliveryTotal(frameContract(i)), 0)
    : unitPreDelivery * quantity;
  const stagedLater       = stagedPreDelivery - stagedSigning;          // instalments still to come
  const stagedBalance     = buyTotalDue - stagedPreDelivery;            // always cash, on delivery
  const stagedNeed        = committedPdp + stagedPreDelivery;

  const canAfford     = staged
    ? cash >= stagedNeed
    : mode === 'buy' ? cash >= buyTotalDue : cash >= leaseDueNow;
  const maxAffordable = staged
    ? Math.max(0, Math.floor((cash - committedPdp) / Math.max(1, unitPreDelivery)))
    : mode === 'buy'
      ? Math.max(0, Math.floor(cash / (unitBuyPrice + unitWifiFee)))
      : Math.max(0, Math.floor(cash / unitLeaseDeposit));

  function setQty(n) { setQuantity(Math.max(isLaunch ? launchTerms.minQty : 1, Math.min(100, n))); }

  // The order as configured, for the replacement checks: range comes from the
  // wingtips and the cabin, exactly as it will on the delivered tail.
  const replaceDraft = {
    id: '__checkout-draft', typeId, name: type.name,
    ownershipType: mode === 'buy' ? 'owned' : 'lease',
    rangeMod: Math.round(wingtipRangeMod * 10000) / 10000,
    ...(cabinConfig ? { config: cabinConfig } : {}),
  };

  function handleConfirm() {
    const replaces = replaceSel.length ? replacesForDispatch(state, replaceSel, replaceDraft, quantity) : [];
    dispatch({
      type:          'ORDER_AIRCRAFT',
      typeId,
      ownershipType: mode === 'buy' ? 'owned' : 'lease',
      engineId:      selectedEngine?.id ?? null,
      hasWingtips,
      hasWifi:       wantsWifi,
      quantity,
      config:        cabinConfig,
      name:          customName.trim() || null,
      // Production lines: where to start looking for slots (the reducer does
      // the rest). Omitted = the standard week, no premium.
      slotFromWeek:  linesWorld && !isLaunch && slotFrom != null ? slotFrom : undefined,
      ...(replaces.length && !isLaunch ? { replaces, replaceDisposal } : {}),
    });
    onOrdered?.();
    onClose();
  }

  // Shared section header style
  const sectionTitle = {
    fontSize: 11, fontWeight: 600, color: 'var(--text-muted)',
    textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10,
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.72)',
        zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: 'var(--surface2)', borderRadius: 10,
        maxWidth: 540, width: '100%', maxHeight: '92vh', overflowY: 'auto',
        border: '1px solid var(--border)', boxShadow: '0 24px 64px rgba(0,0,0,0.55)',
      }}>
        <AircraftPhoto src={type.image} alt={type.name} category={type.category} />

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div style={{ padding: '14px 20px 0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 19 }}>{type.name}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>
                {type.manufacturer} · <span style={{ color: catColor }}>{type.category}</span>
                {' · '}{isFreighter ? `${type.payloadTonnes}t payload` : `${type.seats} seats`} · {type.range.toLocaleString()} km range{!isFreighter && typicalSeatsOf(type) < type.seats ? ` at ${typicalSeatsOf(type)} seats` : ''} · {cruiseSpeedKmh(type).toLocaleString()} km/h cruise
              </div>
            </div>
            <button className="btn btn-ghost" onClick={onClose} style={{ padding: '4px 10px', marginLeft: 8 }}><Glyph e="✕" /></button>
          </div>

          {/* Delivery callout */}
          <div style={{
            marginTop: 10, padding: '8px 12px',
            background: 'rgba(56,139,253,0.1)', borderRadius: 6,
            fontSize: 13, color: 'var(--accent)',
            border: '1px solid rgba(56,139,253,0.25)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span><Glyph e="📅" /></span>
              <span>
                {quantity === 1 ? (
                  <>First delivery in <strong>{firstDelivery - currentAbsWeek}w</strong> (Wk {firstWIM} {firstMon} Y{firstYear})</>
                ) : (
                  <><strong>{quantity} aircraft</strong> · first in <strong>{firstDelivery - currentAbsWeek}w</strong> (Wk {firstWIM} {firstMon} Y{firstYear}), last in <strong>{lastDelivery - currentAbsWeek}w</strong> (Wk {lastWIM} {lastMon} Y{lastYear}) · {lineAlloc ? `at least ${lineAlloc.gap}w apart` : `every ${lead}w`}</>
                )}
                {pendingOfType.length > 0 && (
                  <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}> · {pendingOfType.length} already queued</span>
                )}
              </span>
            </div>
            {quantity > 1 && (
              <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid rgba(56,139,253,0.2)', display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                {deliveryWeeks.map((absW, i) => {
                  const { displayYear: dy, monthName: mn, weekInMonth: wim } = absWeekToDisplay(absW);
                  return (
                    <span key={i} style={{
                      fontSize: 11, padding: '2px 7px', borderRadius: 4,
                      background: 'rgba(56,139,253,0.15)', color: 'var(--accent)',
                      border: '1px solid rgba(56,139,253,0.25)',
                    }}>#{i+1} — {absW - currentAbsWeek}w (Wk {wim} {mn} Y{dy}){framePremiums[i] > 0 ? ` · +${formatMoney(framePremiums[i])}` : ''}</span>
                  );
                })}
              </div>
            )}
          </div>

          {/* Launch-customer terms */}
          {isLaunch && (
            <div style={{
              marginTop: 10, padding: '8px 12px', borderRadius: 6, fontSize: 12.5, lineHeight: 1.5,
              background: 'rgba(163,113,247,0.12)', border: '1px solid rgba(163,113,247,0.35)', color: 'var(--text)',
            }}>
              <Glyph e="🚀" /> <strong>Launch order.</strong> The {type.name} enters service in {type.eis}. As a launch customer
              you take the first slots on the line from January {type.eis}, one every {lineAlloc?.gap ?? lead} week{(lineAlloc?.gap ?? lead) === 1 ? '' : 's'}, at {Math.round(discount * 100)}% off list
              (bulk + launch{(launchTerms.discount > 0.08) ? ' + loyalty' : ''}). Minimum {launchTerms.minQty} aircraft, paid in full now.{' '}
              <strong>Launch orders are firm: they cannot be cancelled.</strong>
            </div>
          )}

          {/* Production line: pick a start week (early slots cost extra) */}
          {lineAlloc && !isLaunch && (() => {
            const cal  = slotCalendar(lineState, type, currentAbsWeek, 12);
            const info = lineInfo(lineOf(type));
            const chosen = slotFrom ?? lineAlloc.standard;
            return (
              <div style={{ marginTop: 10, fontSize: 12 }}>
                <div style={{ color: 'var(--text-muted)', marginBottom: 6 }}>
                  <Glyph e="🏭" /> <strong style={{ color: 'var(--text)' }}>{info.name}</strong> line · {cal.capacity} aircraft a week for you and every rival,
                  and yours arrive at least {cal.gap} week{cal.gap === 1 ? '' : 's'} apart. Start from:
                </div>
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                  {cal.rows.map(r => {
                    const full = r.free <= 0 || r.gapBlocked;
                    const on   = r.week === chosen;
                    const std  = r.premiumPct === 0;
                    return (
                      <button
                        key={r.week}
                        type="button"
                        disabled={full}
                        onClick={() => setSlotFrom(std && r.week === lineAlloc.standard ? null : r.week)}
                        title={r.mine ? 'You already take an aircraft this week' : r.gapBlocked ? `Within ${cal.gap} weeks of another of your aircraft on this line` : full ? 'Line full this week' : `${r.free} of ${cal.capacity} slots open`}
                        style={{
                          padding: '3px 7px', borderRadius: 5, fontSize: 11, lineHeight: 1.3,
                          cursor: full ? 'not-allowed' : 'pointer', opacity: full ? 0.4 : 1,
                          border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`,
                          background: on ? 'rgba(56,139,253,0.15)' : 'var(--surface2)',
                          color: on ? 'var(--accent)' : 'var(--text-muted)',
                        }}
                      >
                        {r.week - currentAbsWeek}w
                        <span style={{ display: 'block', fontSize: 10, color: std ? 'var(--green)' : 'var(--yellow)' }}>
                          {full ? (r.mine ? 'yours' : r.gapBlocked ? 'gap' : 'full') : std ? 'list' : `+${Math.round(r.premiumPct * 100)}%`}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })()}
        </div>

        <div style={{ padding: '14px 20px' }}>

          {/* ── Quantity ─────────────────────────────────────────────────── */}
          <section style={{ marginBottom: 18 }}>
            <div style={sectionTitle}>Quantity</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ textAlign: 'center' }}>
                <NumberStepper
                  live
                  value={quantity}
                  min={isLaunch ? launchTerms.minQty : 1}
                  max={Math.max(isLaunch ? launchTerms.minQty : 1, mode === 'buy' ? Math.min(100, maxAffordable) : 100)}
                  onChange={setQty}
                  ariaLabel="aircraft quantity"
                />
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>aircraft</div>
              </div>
              <div style={{ display: 'flex', gap: 4, marginLeft: 4 }}>
                {[1, 5, 10, 25, 50, 100].filter(n => n <= (mode === 'buy' ? maxAffordable : 100) && (!isLaunch || n >= launchTerms.minQty)).map(n => (
                  <button key={n} onClick={() => setQty(n)} style={{ padding: '4px 9px', borderRadius: 5, border: `1px solid ${quantity === n ? 'var(--accent)' : 'var(--border)'}`, background: quantity === n ? 'rgba(56,139,253,0.15)' : 'var(--surface2)', color: quantity === n ? 'var(--accent)' : 'var(--text-muted)', fontSize: 12, fontWeight: quantity === n ? 600 : 400, cursor: 'pointer' }}>{n}</button>
                ))}
              </div>
            </div>
          </section>

          {/* ── Custom name ──────────────────────────────────────────────── */}
          <section style={{ marginBottom: 18 }}>
            <div style={sectionTitle}>Aircraft Name <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional)</span></div>
            <input
              type="text"
              value={customName}
              maxLength={40}
              onChange={e => setCustomName(e.target.value)}
              placeholder={`e.g. "Spirit of ${type.manufacturer}" · defaults to ${type.name} #N`}
              style={{
                width: '100%', padding: '8px 12px', fontSize: 13,
                background: 'var(--surface2)', color: 'var(--text)',
                border: '1px solid var(--border)', borderRadius: 7, outline: 'none',
              }}
              onFocus={e => { e.target.style.borderColor = 'var(--accent)'; }}
              onBlur={e => { e.target.style.borderColor = 'var(--border)'; }}
            />
            {customName.trim() && quantity > 1 && (
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 5 }}>
                Aircraft will be named “{customName.trim()} #1” through “{customName.trim()} #{quantity}”
              </div>
            )}
          </section>

          {/* ── Engine options ───────────────────────────────────────────── */}
          {engines.length > 1 && (
            <section style={{ marginBottom: 18 }}>
              <div style={sectionTitle}>Engine Options</div>
              {engines.map(eng => {
                const isSelected = selectedEngineId === eng.id;
                const fuelDelta  = Math.round((eng.fuelMod - 1) * 100);
                const priceDelta = Math.round((eng.priceMod - 1) * 100);
                const maintDelta = Math.round(((eng.maintMod ?? 1.0) - 1) * 100);
                return (
                  <label key={eng.id} style={{ display: 'flex', gap: 10, padding: '9px 12px', marginBottom: 5, borderRadius: 7, border: `1px solid ${isSelected ? 'var(--accent)' : 'var(--border)'}`, background: isSelected ? 'rgba(56,139,253,0.08)' : 'var(--surface2)', cursor: 'pointer', transition: 'all 0.15s' }}>
                    <input type="radio" name={`engine-${typeId}`} value={eng.id} checked={isSelected} onChange={() => setSelectedEngineId(eng.id)} style={{ marginTop: 3, accentColor: 'var(--accent)' }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                        <span style={{ fontWeight: 600, fontSize: 13 }}>{eng.label}</span>
                        {eng.default && <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 3, background: 'rgba(56,139,253,0.15)', color: 'var(--accent)', border: '1px solid rgba(56,139,253,0.3)' }}>default</span>}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, lineHeight: 1.4 }}>{eng.description}</div>
                      <div style={{ display: 'flex', gap: 10, marginTop: 4, fontSize: 11, flexWrap: 'wrap' }}>
                        {fuelDelta !== 0 && <span style={{ color: fuelDelta < 0 ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>{fuelDelta < 0 ? '↓' : '↑'} {Math.abs(fuelDelta)}% fuel</span>}
                        {maintDelta !== 0 && <span style={{ color: maintDelta > 0 ? 'var(--red)' : 'var(--green)', fontWeight: 600 }}>{maintDelta > 0 ? '↑' : '↓'} {Math.abs(maintDelta)}% maint</span>}
                        {priceDelta > 0 && <span style={{ color: 'var(--text-muted)' }}>+{priceDelta}% {mode === 'buy' ? 'unit price' : 'lease rate'}</span>}
                        {fuelDelta === 0 && maintDelta === 0 && priceDelta === 0 && <span style={{ color: 'var(--text-muted)' }}>Standard · no premium</span>}
                      </div>
                    </div>
                  </label>
                );
              })}
            </section>
          )}

          {/* ── Wingtip ──────────────────────────────────────────────────── */}
          {wingtipDef && (
            <section style={{ marginBottom: 18 }}>
              <div style={sectionTitle}>Wingtip Package</div>
              <label style={{ display: 'flex', gap: 10, padding: '9px 12px', borderRadius: 7, border: `1px solid ${hasWingtips ? 'var(--accent)' : 'var(--border)'}`, background: hasWingtips ? 'rgba(56,139,253,0.08)' : 'var(--surface2)', cursor: 'pointer', transition: 'all 0.15s' }}>
                <input type="checkbox" checked={hasWingtips} onChange={e => setHasWingtips(e.target.checked)} style={{ marginTop: 3, accentColor: 'var(--accent)' }} />
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{wingtipDef.label}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, lineHeight: 1.4 }}>{wingtipDef.description}</div>
                  <div style={{ display: 'flex', gap: 10, marginTop: 4, fontSize: 11, flexWrap: 'wrap' }}>
                    <span style={{ color: 'var(--green)', fontWeight: 600 }}>↓ {Math.abs(Math.round((wingtipDef.fuelMod - 1) * 100))}% fuel</span>
                    {wingtipDef.rangeMod && wingtipDef.rangeMod !== 1.0 && (
                      <span style={{ color: 'var(--accent)', fontWeight: 600 }}>↑ {Math.round((wingtipDef.rangeMod - 1) * 100)}% range ({type.range.toLocaleString()} → {effectiveRangeFull.toLocaleString()} km)</span>
                    )}
                    {mode === 'buy' && <span style={{ color: 'var(--text-muted)' }}>+{formatMoney(wingtipDef.cost ?? 0)} per aircraft</span>}
                    {mode === 'lease' && wingtipLeaseAdj > 0 && <span style={{ color: 'var(--text-muted)' }}>+{formatMoney(wingtipLeaseAdj)}/wk per aircraft</span>}
                  </div>
                </div>
              </label>
            </section>
          )}

          {/* ── Onboard connectivity ─────────────────────────────────────── */}
          {/* Not offered at all when the world has no onboard internet yet, and
              not offered on an airframe that could never carry it. In both
              cases the player sees WHY rather than a silently missing option —
              an absent checkbox reads as a bug, a stated reason reads as a
              rule. */}
          {!isFreighter && !wifiOffered && (
            <section style={{ marginBottom: 18 }}>
              <div style={sectionTitle}>Onboard Connectivity</div>
              <div style={{ display: 'flex', gap: 10, padding: '9px 12px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface2)' }}>
                <div style={{ opacity: 0.5, fontSize: 15, lineHeight: 1.2 }}><Glyph e="📶" /></div>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-dim)' }}>
                    Wi-Fi &amp; streaming package unavailable
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, lineHeight: 1.4 }}>
                    {!wifiEraLive
                      ? ERA_FEATURE_MESSAGE.wifi
                      : `${wifiAirframeDenial(type)} It will take the no-Wi-Fi quality `
                        + `penalty on every route it flies.`}
                  </div>
                </div>
              </div>
            </section>
          )}
          {!isFreighter && wifiOffered && (
            <section style={{ marginBottom: 18 }}>
              <div style={sectionTitle}>Onboard Connectivity</div>
              <label style={{ display: 'flex', gap: 10, padding: '9px 12px', borderRadius: 7, border: `1px solid ${hasWifi ? 'var(--accent)' : 'var(--border)'}`, background: hasWifi ? 'rgba(56,139,253,0.08)' : 'var(--surface2)', cursor: 'pointer', transition: 'all 0.15s' }}>
                <input type="checkbox" checked={hasWifi} onChange={e => setHasWifi(e.target.checked)} style={{ marginTop: 3, accentColor: 'var(--accent)' }} />
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>Wi-Fi &amp; streaming package</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, lineHeight: 1.4 }}>
                    Satellite antenna, modem and cabin access points, fitted on the production line.
                    Passengers now expect connectivity, and an aircraft without it takes a quality
                    penalty on every route it flies. What you charge for it is a separate,
                    airline-wide decision on the Ancillaries tab.
                  </div>
                  <div style={{ display: 'flex', gap: 10, marginTop: 4, fontSize: 11, flexWrap: 'wrap' }}>
                    {mode === 'buy'
                      ? <span style={{ color: 'var(--text-muted)' }}>+{formatMoney(wifiInstallCost())} per aircraft</span>
                      : <span style={{ color: 'var(--text-muted)' }}>+{formatMoney(wifiLeaseSurcharge())}/wk per aircraft</span>}
                    <span style={{ color: 'var(--text-muted)' }}>−{formatMoney(WIFI_WEEKLY_OPEX)}/wk to run</span>
                    <span style={{ color: 'var(--yellow)' }}>fitting it later costs {formatMoney(wifiRetrofitCost())}</span>
                  </div>
                </div>
              </label>
            </section>
          )}

          {/* ── Cabin configuration (passenger aircraft only) ────────────── */}
          {!isFreighter && (
          <section style={{ marginBottom: 18 }}>
            <div style={sectionTitle}>Cabin Configuration</div>

            {/* Saved templates */}
            <CabinTemplatePicker
              typeId={typeId}
              currentConfig={{ firstClass: first, businessClass: biz, premiumEconomy: prem, economy: eco, seatQuality: seatQ, serviceQuality: servQ }}
              onApply={applyTemplate}
            />

            {/* Seat bar */}
            <div style={{ height: 12, borderRadius: 4, overflow: 'hidden', display: 'flex', marginBottom: 6 }}>
              {[
                { units: first * CLASS_SPACE_MULTIPLIERS.firstClass,     color: CLASS_COLORS.firstClass },
                { units: biz   * CLASS_SPACE_MULTIPLIERS.businessClass,  color: CLASS_COLORS.businessClass },
                { units: prem  * CLASS_SPACE_MULTIPLIERS.premiumEconomy, color: CLASS_COLORS.premiumEconomy },
                { units: eco   * CLASS_SPACE_MULTIPLIERS.economy,        color: CLASS_COLORS.economy },
              ].map((seg, i) => seg.units > 0 && (
                <div key={i} style={{ width: `${(seg.units / maxSeats) * 100}%`, background: seg.color }} />
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)', marginBottom: 10 }}>
              <span style={{ color: over ? 'var(--red)' : undefined }}>
                {over
                  ? <GlyphLabel size={11} text={`⚠ Over-allocated by ${(usedUnits - maxSeats).toFixed(1)} seat-units`} />
                  : `${usedUnits.toFixed(1)} / ${maxSeats} seat-units used`}
              </span>
              <span>{first + biz + prem + eco} physical seats</span>
            </div>

            {/* Class rows */}
            <ClassRow
              label="First Class" color={CLASS_COLORS.firstClass}
              fareLabel={`${CLASS_FARE_MULTIPLIERS.firstClass}× fare`}
              spaceLabel={`${CLASS_SPACE_MULTIPLIERS.firstClass}× space`}
              value={first} max={maxFirst} onChange={setFirst}
            />
            <ClassRow
              label="Business Class" color={CLASS_COLORS.businessClass}
              fareLabel={`${CLASS_FARE_MULTIPLIERS.businessClass}× fare`}
              spaceLabel={`${CLASS_SPACE_MULTIPLIERS.businessClass}× space`}
              value={biz} max={maxBiz} onChange={setBiz}
            />
            <ClassRow
              label="Premium Economy" color={CLASS_COLORS.premiumEconomy}
              fareLabel={`${CLASS_FARE_MULTIPLIERS.premiumEconomy}× fare`}
              spaceLabel={`${CLASS_SPACE_MULTIPLIERS.premiumEconomy}× space`}
              value={prem} max={maxPrem} onChange={setPrem}
            />

            <ClassRow
              label="Economy" color={CLASS_COLORS.economy}
              fareLabel={`${CLASS_FARE_MULTIPLIERS.economy}× fare`}
              spaceLabel={`${CLASS_SPACE_MULTIPLIERS.economy}× space`}
              value={eco} max={maxEco} onChange={setEco}
            />
            {/* Sparse-cabin range callout */}
            {!isFreighter && (
              <div style={{
                marginTop: 6, padding: '6px 10px',
                background: 'rgba(56,139,253,0.08)', borderRadius: 5,
                fontSize: 11, color: 'var(--accent)',
                border: '1px solid rgba(56,139,253,0.2)',
                display: 'flex', alignItems: 'center', gap: 6,
              }}>
                <span><Glyph e="✈" /></span>
                <span>
                  Range with this cabin{' '}
                  <strong>{effectiveRangeFull.toLocaleString()} km</strong>
                  {cabinRangePctGain > 0 && <span style={{ color: 'var(--green)', marginLeft: 4 }}>(+{cabinRangePctGain}%)</span>}
                  {cabinRangePctGain < 0 && <span style={{ color: 'var(--red)', marginLeft: 4 }}>({cabinRangePctGain}%: packed past the typical {typicalSeatsOf(type)} seats)</span>}
                  {' · '}{first + biz + prem + eco} seats · {typicalSeatsOf(type)} typical · {maxSeats} max
                </span>
              </div>
            )}

            {/* Seat & service quality */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 12 }}>
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Seat Quality</div>
                <select
                  value={seatQ} onChange={e => setSeatQ(e.target.value)}
                  style={{ width: '100%', padding: '6px 8px', fontSize: 12, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text)', cursor: 'pointer' }}
                >
                  {QUALITY_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>{o.label} — {o.desc}</option>
                  ))}
                </select>
                {SEAT_QUALITY_COST_PER_ROUTE[seatQ] > 0 && (
                  <div style={{ fontSize: 10, color: 'var(--red)', marginTop: 3 }}>
                    +{formatMoney(SEAT_QUALITY_COST_PER_ROUTE[seatQ])}/route/wk
                  </div>
                )}
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Service Quality</div>
                <select
                  value={servQ} onChange={e => setServQ(e.target.value)}
                  style={{ width: '100%', padding: '6px 8px', fontSize: 12, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text)', cursor: 'pointer' }}
                >
                  {QUALITY_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>{o.label} — {o.desc}</option>
                  ))}
                </select>
                {SERVICE_QUALITY_COST_PER_ROUTE[servQ] > 0 && (
                  <div style={{ fontSize: 10, color: 'var(--red)', marginTop: 3 }}>
                    +{formatMoney(SERVICE_QUALITY_COST_PER_ROUTE[servQ])}/route/wk
                  </div>
                )}
              </div>
            </div>

            {/* Revenue preview */}
            <div style={{
              marginTop: 10, padding: '8px 12px',
              background: 'var(--surface2)', borderRadius: 6,
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              fontSize: 12,
            }}>
              <span style={{ color: 'var(--text-muted)' }}>Blended revenue index vs all-economy</span>
              <span style={{ fontWeight: 700, color: revenueIndex > 1.05 ? 'var(--green)' : revenueIndex > 1 ? 'var(--yellow)' : 'var(--text-muted)' }}>
                {revenueIndex.toFixed(2)}×
              </span>
            </div>
          </section>
          )}

          {/* ── Replaces (fleet renewal) ─────────────────────────────────── */}
          {!isLaunch && <ReplacesSection
            draft={replaceDraft}
            quantity={quantity}
            setQuantity={setQty}
            selected={replaceSel}
            setSelected={setReplaceSel}
            disposal={replaceDisposal}
            setDisposal={setReplaceDisposal}
            deliveryWeeks={deliveryWeeks}
            defaultOpen={!!replaceIds?.length}
          />}

          {/* ── Order summary ────────────────────────────────────────────── */}
          <section style={{ borderTop: '1px solid var(--border)', paddingTop: 14, marginBottom: 14 }}>
            <div style={sectionTitle}>Order Summary</div>

            {mode === 'buy' ? (
              <div style={{ fontSize: 13 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5, color: 'var(--text-muted)' }}>
                  <span>Base price per aircraft{discPct > 0 && <span style={{ marginLeft: 5, fontSize: 11, color: 'var(--green)', fontWeight: 600 }}>(−{discPct}% {isLaunch ? 'launch + bulk' : 'bulk'})</span>}</span>
                  <span style={{ color: 'var(--text)' }}>{formatMoney(baseUnitPrice)}</span>
                </div>
                {enginePriceAdj !== 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5, color: 'var(--text-muted)' }}>
                    <span>Engine: {selectedEngine?.label}</span>
                    <span style={{ color: 'var(--text)' }}>{enginePriceAdj > 0 ? '+' : ''}{formatMoney(enginePriceAdj)}</span>
                  </div>
                )}
                {wingtipCost > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5, color: 'var(--text-muted)' }}>
                    <span>{wingtipDef?.label}</span>
                    <span style={{ color: 'var(--text)' }}>+{formatMoney(wingtipCost)}</span>
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, paddingBottom: 8, borderBottom: '1px dashed var(--border)', fontSize: 12 }}>
                  <span style={{ color: 'var(--text-muted)' }}>Unit price</span>
                  <span>{formatMoney(unitBuyPrice)}</span>
                </div>
                {totalSlotPremium > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5, color: 'var(--text-muted)' }}>
                    <span>Early-slot premium{premiumFrames > 1 ? ` (${premiumFrames} aircraft)` : ''}</span>
                    <span style={{ color: 'var(--yellow)' }}>+{formatMoney(totalSlotPremium)}</span>
                  </div>
                )}
                {quantity > 1 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5, color: 'var(--text-muted)' }}>
                    <span>× {quantity} aircraft</span>
                    <span style={{ color: 'var(--text)' }}>{formatMoney(unitBuyPrice)} × {quantity}</span>
                  </div>
                )}
                {totalWifiFee > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5, color: 'var(--text-muted)' }}>
                    <span>Wi-Fi package — one-off{quantity > 1 ? ` × ${quantity}` : ''}</span>
                    <span style={{ color: 'var(--text)' }}>+{formatMoney(totalWifiFee)}</span>
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 8, borderTop: '1px solid var(--border)', fontWeight: 700, fontSize: 15 }}>
                  <span>Total{quantity > 1 ? ` (${quantity} aircraft)` : ''}</span>
                  <span style={{ color: canAfford ? 'var(--green)' : 'var(--red)' }}>{formatMoney(buyTotalDue)}</span>
                </div>
                {staged ? (
                  <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px dashed var(--border)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontWeight: 600 }}>
                      <span>Due at signing</span>
                      <span>{formatMoney(stagedSigning)}</span>
                    </div>
                    {stagedLater > 0 && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, color: 'var(--text-muted)' }}>
                        <span>Pre-delivery instalments (18, 12 and 6 weeks out)</span>
                        <span style={{ color: 'var(--text)' }}>{formatMoney(stagedLater)}</span>
                      </div>
                    )}
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, color: 'var(--text-muted)' }}>
                      <span>Balance on delivery</span>
                      <span style={{ color: 'var(--text)' }}>{formatMoney(stagedBalance)}</span>
                    </div>
                    {!canAfford && (
                      <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 4, textAlign: 'right' }}>
                        Need {formatMoney(stagedNeed - cash)} more{maxAffordable > 0 ? ` · can afford ${maxAffordable}` : ''}
                      </div>
                    )}
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.45 }}>
                      To sign you need the deposit and every pre-delivery instalment in the bank
                      ({formatMoney(stagedPreDelivery)}{committedPdp > 0 ? `, plus ${formatMoney(committedPdp)} already owed on other orders` : ''}).
                      The balance is charged in cash the week each aircraft arrives — if the bank can’t cover it, it goes negative.
                    </div>
                    {canAfford && cash - stagedPreDelivery - committedPdp < stagedBalance && (
                      <div style={{
                        fontSize: 11, marginTop: 6, padding: '6px 8px', borderRadius: 4, lineHeight: 1.45,
                        background: 'rgba(210,153,34,0.12)', border: '1px solid rgba(210,153,34,0.35)', color: 'var(--yellow)',
                      }}>
                        <Glyph e="⚠" /> After this order you would have {formatMoney(Math.max(0, cash - stagedPreDelivery - committedPdp))} left,
                        and the balance{quantity > 1 ? 's come' : ' comes'} to {formatMoney(stagedBalance)}. Unless your routes earn the difference
                        by delivery, your cash goes negative when {quantity > 1 ? 'they arrive' : 'it arrives'}. Leasing, or an aircraft loan, avoids that.
                      </div>
                    )}
                  </div>
                ) : (
                  <>
                    {!canAfford && (
                      <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 4, textAlign: 'right' }}>
                        Need {formatMoney(buyTotalDue - cash)} more{maxAffordable > 0 ? ` · can afford ${maxAffordable}` : ''}
                      </div>
                    )}
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3, textAlign: 'right' }}>Full payment due at order</div>
                  </>
                )}
              </div>
            ) : (
              <div style={{ fontSize: 13 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5, color: 'var(--text-muted)' }}>
                  <span>Base weekly lease</span>
                  <span style={{ color: 'var(--text)' }}>{formatMoney(baseWeeklyLease)}/wk</span>
                </div>
                {engineLeaseAdj !== 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5, color: 'var(--text-muted)' }}>
                    <span>Engine: {selectedEngine?.label}</span>
                    <span style={{ color: 'var(--text)' }}>{engineLeaseAdj > 0 ? '+' : ''}{formatMoney(engineLeaseAdj)}/wk</span>
                  </div>
                )}
                {wingtipLeaseAdj > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5, color: 'var(--text-muted)' }}>
                    <span>{wingtipDef?.label}</span>
                    <span style={{ color: 'var(--text)' }}>+{formatMoney(wingtipLeaseAdj)}/wk</span>
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, paddingBottom: 8, borderBottom: '1px dashed var(--border)', fontSize: 12 }}>
                  <span style={{ color: 'var(--text-muted)' }}>Per aircraft / wk</span>
                  <span>{formatMoney(unitWeeklyLease)}</span>
                </div>
                {quantity > 1 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5, color: 'var(--text-muted)' }}>
                    <span>× {quantity} aircraft (when all delivered)</span>
                    <span style={{ color: 'var(--text)' }}>{formatMoney(unitWeeklyLease)} × {quantity}</span>
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 8, borderTop: '1px solid var(--border)', fontWeight: 700, fontSize: 15 }}>
                  <span>Total weekly lease</span>
                  <span style={{ color: 'var(--accent)' }}>{formatMoney(totalWeeklyLease)}/wk</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)', fontWeight: 700, fontSize: 14 }}>
                  <span>3-month deposit (due now)</span>
                  <span style={{ color: canAfford ? 'var(--green)' : 'var(--red)' }}>{formatMoney(totalLeaseDeposit)}</span>
                </div>
                {totalSlotPremium > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontWeight: 700, fontSize: 14 }}>
                    <span>Early-slot fee, one-off (due now)</span>
                    <span style={{ color: 'var(--yellow)' }}>{formatMoney(totalSlotPremium)}</span>
                  </div>
                )}
                {!canAfford && (
                  <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 4, textAlign: 'right' }}>
                    Need {formatMoney(leaseDueNow - cash)} more{maxAffordable > 0 ? ` · can afford ${maxAffordable}` : ''}
                  </div>
                )}
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3, textAlign: 'right' }}>
                  12 weeks × {formatMoney(unitWeeklyLease)}/wk · applied toward first months of lease
                </div>
              </div>
            )}

            {/* Fuel / range / maint callout */}
            {(fuelPctSaving > 0 || rangePctGain > 0 || maintPctChange !== 0) && (
              <div style={{ marginTop: 10, padding: '7px 10px', background: 'rgba(63,185,80,0.1)', borderRadius: 5, fontSize: 12, color: 'var(--green)', border: '1px solid rgba(63,185,80,0.25)' }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px' }}>
                  {fuelPctSaving > 0 && (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span><Glyph e="⛽" /></span>
                      <span>Saves <strong>{fuelPctSaving}%</strong> fuel vs standard build</span>
                    </span>
                  )}
                  {rangePctGain > 0 && (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--accent)' }}>
                      <span><Glyph e="✈" /></span>
                      <span>Range extended to <strong>{effectiveRange.toLocaleString()} km</strong> (+{rangePctGain}%)</span>
                    </span>
                  )}
                  {maintPctChange !== 0 && (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: maintPctChange > 0 ? 'var(--red)' : 'var(--green)' }}>
                      <span><Glyph e="🔧" /></span>
                      <span>Maintenance <strong>{maintPctChange > 0 ? '+' : ''}{maintPctChange}%</strong> vs standard engine</span>
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Cabin summary callout */}
            {(first + biz + prem > 0 || eco < maxEco || seatQ !== 'standard' || servQ !== 'standard') && (
              <div style={{ marginTop: 8, padding: '7px 10px', background: 'rgba(163,113,247,0.1)', borderRadius: 5, fontSize: 12, color: '#a98bff', border: '1px solid rgba(163,113,247,0.25)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span><Glyph e="💺" /></span>
                <span>
                  {[
                    first > 0 && `${first}F`,
                    biz   > 0 && `${biz}J`,
                    prem  > 0 && `${prem}W`,
                    `${eco}Y`,
                  ].filter(Boolean).join(' / ')}
                  {(seatQ !== 'standard' || servQ !== 'standard') && ` · ${seatQ} seats, ${servQ} service`}
                  {' · '}revenue index <strong>{revenueIndex.toFixed(2)}×</strong>
                  {extraQualityCost > 0 && <span style={{ color: 'var(--red)' }}> · +{formatMoney(extraQualityCost)}/route/wk quality costs</span>}
                </span>
              </div>
            )}
          </section>

          {/* ── Actions ──────────────────────────────────────────────────── */}
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn" style={{ flex: 1 }} onClick={onClose}>Cancel</button>
            <button
              className="btn btn-primary"
              style={{ flex: 2, ...(!canAfford || over ? { background: 'var(--surface3)', color: 'var(--text-dim)', cursor: 'not-allowed', border: '1px solid var(--border)' } : {}) }}
              disabled={!canAfford || over}
              onClick={handleConfirm}
            >
              <GlyphLabel size={13} text={over
                ? '⚠ Fix cabin layout'
                : mode === 'buy'
                  ? (isLaunch ? `🚀 Launch order ${quantity}× ${type.name}` : `🛒 Order ${quantity > 1 ? quantity + '× ' : ''}${type.name}`)
                  : `✍️ Sign Lease${quantity > 1 ? ` × ${quantity}` : ''}`} />
            </button>
          </div>

        </div>
      </div>
    </div>
  );
}
