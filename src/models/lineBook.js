// ─────────────────────────────────────────────────────────────────────────────
// LINE BOOK — Tailwinds' side of the shared production lines.
//
// data/productionLines.js is the Headwinds module, copied unchanged. There the
// server injects every OTHER airline's bookings as state.lineBook. A solo game
// has no other humans: the other buyers are the AI rivals, and since production
// lines they order through the same lines (models/competitorAI.js, linePlans)
// instead of being handed aircraft the week they decide to grow.
//
// A rival's order is a PLAN: one route move (new route, more flights, a bigger
// type) and one booked week per aircraft it needs. The ledger is the same as
// Headwinds': a slot is taken exactly when somebody holds an order for that
// week. Nothing else is stored — cancel a plan or lose the airline and the
// slots are free again.
//
//   plan = { id, kind: 'launch'|'grow'|'defend'|'upgauge', routeKey, typeId,
//            lineId, weeks: [absWeek…], cfg: {route config on completion},
//            orderedAbs }
// ─────────────────────────────────────────────────────────────────────────────

import {
  lineOf, sumBookings, minusBookings, bookingsFromStates, worldFleetBoard,
  lineGapWeeks, cancelTerms, lineBookings, ownLineWeeks, capacityFor,
  slotWindow, tooCloseToOwn, slotPremiumPct,
} from '../data/productionLines.js';
import { cancellationRefund, hasPaymentSchedule, amountPaid } from './orderPayments.js';

/**
 * Frames-a-week multiplier on every line in a solo game. Headwinds sizes lines
 * for a 50-player world at 1.0; a Tailwinds world is the player plus ~25 rivals
 * that each order a few aircraft a month. Calibrated 2026-10-17 so the lines the
 * AI piles onto (A320neo in 2026, DC-8 in 1975) run busy without walling anyone
 * off (tools/production-lines-ai-test.mjs §calibration).
 */
export const SOLO_LINE_SCALE = 0.4;

/** The plan's frames as order-shaped rows the production-lines module reads. */
export function planOrders(plans, fromAbsWeek = -Infinity) {
  const out = [];
  for (const p of plans ?? []) {
    for (const w of p.weeks ?? []) {
      if (w >= fromAbsWeek) out.push({ typeId: p.typeId, lineId: p.lineId, deliverAbsWeek: w });
    }
  }
  return out;
}

/** { [lineId]: { [week]: n } } for every rival's undelivered plan frames. */
export function rivalBookings(competitors, fromAbsWeek = 0) {
  return bookingsFromStates((competitors ?? []).map(c => ({ pendingOrders: planOrders(c.linePlans, fromAbsWeek) })), fromAbsWeek);
}

/** The player's own orders as a booking map. */
export function playerBookings(pendingOrders, fromAbsWeek = 0) {
  return bookingsFromStates([{ pendingOrders: pendingOrders ?? [] }], fromAbsWeek);
}

/**
 * The state the production-lines functions expect: the player's own orders in
 * pendingOrders, every rival's bookings injected as lineBook. Identity when the
 * world has no production lines.
 */
export function withLineBook(state, absWeek) {
  if (state?.productionLinesWorld !== true) return state;
  return {
    ...state,
    lineBook: {
      scale: state.productionLineScale ?? SOLO_LINE_SCALE,
      bookings: rivalBookings(state.competitors, absWeek),
    },
  };
}

/**
 * The booking ledger for one AI tick: every rival's plans plus the player's
 * orders, kept current as rivals book so the second airline to act sees what
 * the first one took.
 */
export function makeTickLedger({ competitors, pendingOrders, absWeek, scale = SOLO_LINE_SCALE }) {
  const total = sumBookings([rivalBookings(competitors, absWeek), playerBookings(pendingOrders, absWeek)]);
  return {
    absWeek, scale, total,
    add(lineId, weeks) {
      const m = (total[lineId] ??= {});
      for (const w of weeks) m[w] = (m[w] ?? 0) + 1;
    },
    remove(lineId, weeks) {
      const m = total[lineId];
      if (!m) return;
      for (const w of weeks) {
        if (!(w in m)) continue;
        m[w] -= 1;
        if (m[w] <= 0) delete m[w];
      }
    },
  };
}

/**
 * Where `n` frames of `type` would land for this rival, without booking them:
 * { weeks, lineId, gap, standard, delay, premiumPct } — `delay` is how much
 * later than an empty line the last frame arrives (0 = the line is not holding
 * it up); `premiumPct` sums the early-slot premium over the frames (as a share
 * of one frame's list price), 0 unless `early`.
 */
export function quotePlan(ledger, carrierPlans, type, n, { gap = null, early = false } = {}) {
  const mine = bookingsFromStates([{ pendingOrders: planOrders(carrierPlans, ledger.absWeek) }], ledger.absWeek);
  const others = minusBookings(ledger.total, mine);
  const view = { lineBook: { scale: ledger.scale, bookings: others }, pendingOrders: planOrders(carrierPlans, ledger.absWeek) };
  const lineId = lineOf(type);
  const g = gap ?? lineGapWeeks(lineId);
  const booked = lineBookings(view, lineId, ledger.absWeek);
  const own = ownLineWeeks(view, lineId);
  const cap = capacityFor(view, lineId, ledger.absWeek);
  const { standard, earliest } = slotWindow(type, ledger.absWeek);
  const weeks = [];
  // `early`: start at the first buildable week and pay the early-slot premium
  // on any frame that lands before the standard week (slotPremiumPct).
  let w = early ? earliest : standard;
  for (let i = 0; i < n; i++) {
    for (let guard = 0; guard < 52 * 200; guard++, w++) {
      if (!tooCloseToOwn(own, w, g) && (booked.get(w) ?? 0) < cap) break;
    }
    weeks.push(w);
    booked.set(w, (booked.get(w) ?? 0) + 1);
    own.add(w);
    w++;
  }
  // An empty line still spaces one airline's frames by the gap.
  const uncontested = standard + g * (n - 1);
  const premiumPct = weeks.reduce((sum, wk) => sum + slotPremiumPct(type, wk, ledger.absWeek), 0);
  return { weeks, lineId, gap: g, standard, premiumPct,
           delay: Math.max(0, weeks[weeks.length - 1] - uncontested) };
}

/** A rival's fleet as the order board counts it: { [typeId]: [inService, onOrder] }. */
export function competitorFleetMix(c, absWeek) {
  const out = {};
  for (const f of c?.fleet ?? []) {
    if (!f?.typeId) continue;
    (out[f.typeId] ??= [0, 0])[0] += 1;
  }
  for (const p of c?.linePlans ?? []) {
    for (const w of p.weeks ?? []) {
      // Delivered frames wait on the plan until the whole move is ready, but
      // they exist: they count as flying, not on order.
      (out[p.typeId] ??= [0, 0])[w <= absWeek ? 0 : 1] += 1;
    }
  }
  return out;
}

/** The world order board for a solo game: every rival plus you. */
export function soloFleetBoard(state, absWeek) {
  return worldFleetBoard({
    ...state,
    competitors: (state?.competitors ?? []).map(c => ({ id: c.id, name: c.name, fleetMix: competitorFleetMix(c, absWeek) })),
  });
}

/**
 * What cancelling an order returns, for CANCEL_ORDER and every screen that
 * quotes it. { allowed, refund, forfeit, weeksOut, reason, rule }
 *   classic world                → models/orderPayments.js cancellationRefund
 *   production lines, launch     → firm, not cancellable
 *   production lines, staged buy → the staged-payment rule: deposit kept, paid
 *                                  instalments back at 80% (the nearer the slot,
 *                                  the more has been paid, the more is lost)
 *   production lines, otherwise  → data/productionLines.js cancelTerms (owned:
 *                                  5–30% by how near the slot; lease: deposit
 *                                  and slot fee back only 26+ weeks out)
 */
export function orderCancelTerms(state, order, absWeek) {
  const weeksOut = Math.max(0, (order?.deliverAbsWeek ?? absWeek) - absWeek);
  if (state?.productionLinesWorld === true && order && !order.used) {
    if (order.launch || order.ownershipType !== 'owned' || !hasPaymentSchedule(order)) {
      return { ...cancelTerms(order, absWeek), rule: order.launch ? 'launch' : 'line' };
    }
    const refund = cancellationRefund(order);
    return { allowed: true, refund, forfeit: Math.max(0, amountPaid(order) - refund), weeksOut, reason: null, rule: 'staged' };
  }
  const refund = cancellationRefund(order);
  const paid = !order ? 0
    : order.ownershipType !== 'owned' ? (order.leaseDeposit ?? 0)
    : hasPaymentSchedule(order) ? amountPaid(order) : (order.totalPrice ?? 0);
  return { allowed: true, refund, forfeit: Math.max(0, paid - refund), weeksOut, reason: null, rule: 'classic' };
}

export { lineOf };
