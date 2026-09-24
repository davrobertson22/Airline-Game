/**
 * Pre-delivery payments — order book package 1 (docs/order-book-design.md §2).
 *
 * ── What changes ────────────────────────────────────────────────────────────
 *
 * Classic ordering charges the whole price the moment an owned order is
 * signed. Under the `orderBook` world flag the price is STAGED instead, the
 * way aircraft are actually bought:
 *
 *     at signing        2%    deposit, never refunded
 *     T-18 weeks        8%    pre-delivery instalment
 *     T-12 weeks        8%    pre-delivery instalment
 *     T-6 weeks         7%    pre-delivery instalment
 *     on delivery      75%    the balance
 *
 * An instalment whose week would fall BEFORE signing is simply due at signing.
 * That clamp is what makes this safe to ship ahead of slots: on today's short
 * lead times (1–8 weeks) most of the pre-delivery money is still paid up
 * front, and the schedule spreads out on its own once package 2 lengthens the
 * window between signing and delivery. Nothing here knows how long a lead
 * time is; it only reads the two weeks it is handed.
 *
 * ── Decisions (Dave, 2026-09-21) ────────────────────────────────────────────
 *
 *   * The balance is ALWAYS cash. It is charged on the delivery week whether
 *     the airline can afford it or not; a shortfall takes cash negative and the
 *     existing negative-cash rules (warnings, six weeks to bankruptcy) apply.
 *     Nothing is forfeited on a shortfall and nothing is auto-financed — a
 *     player who wants to finance a delivery takes an aircraft loan against it.
 *   * To SIGN, cash must cover the deposit and every pre-delivery instalment:
 *     this order's, and the unpaid ones already committed on the book. See
 *     committedPreDelivery() — without it one pile of cash could back the
 *     instalments of every order the player cared to sign.
 *
 * ── Accounting ──────────────────────────────────────────────────────────────
 *
 * Payments are capital, not cost. They leave the bank, they are not tax
 * deductible (depreciation carries an owned aircraft's cost, exactly as it
 * does for a classic purchase), and the weekly P&L card names them on a row
 * of their own — a cash movement with no row is a reconciliation failure by
 * design (see tools/pnl-reconcile-test.mjs).
 *
 * The reducer, the finance projection, the order form and the cancel dialogs
 * all read these functions, so the number a screen quotes and the number the
 * reducer charges cannot drift apart. tools/order-payments-test.mjs holds it.
 */

/** Share of the contract price taken as a deposit at signing. */
export const PDP_DEPOSIT_SHARE = 0.02;

/** Pre-delivery instalments, by weeks before the delivery week. */
export const PDP_INSTALMENTS = Object.freeze([
  Object.freeze({ weeksBefore: 18, share: 0.08 }),
  Object.freeze({ weeksBefore: 12, share: 0.08 }),
  Object.freeze({ weeksBefore: 6,  share: 0.07 }),
]);

/**
 * On cancellation the deposit is forfeited and paid instalments come back at
 * this rate. Cancelling straight after signing therefore costs ~6.6% of the
 * price on today's lead times (the whole pre-delivery quarter is paid up
 * front) — a little stiffer than the classic 5% fee, deliberately: a signed
 * delivery position is worth something and walking away from one should cost.
 */
export const PDP_CANCEL_REFUND_SHARE = 0.80;

/** The classic path's cancellation refund on an owned order. */
export const CLASSIC_CANCEL_REFUND_SHARE = 0.95;

/** Does this order carry a staged payment schedule (i.e. was it signed under the flag)? */
export function hasPaymentSchedule(order) {
  return Array.isArray(order?.payments);
}

/**
 * The payment schedule for one aircraft.
 *
 * Amounts are rounded per line and the balance takes the remainder, so the
 * parts always sum to `contractPrice` exactly. Weeks are absolute weeks
 * (utils/fuel.js absoluteWeek); nothing is marked paid.
 *
 * @param {number} contractPrice   everything owed for the airframe, options included
 * @param {number} orderAbsWeek    the week the order is signed
 * @param {number} deliverAbsWeek  the week the aircraft arrives
 */
export function buildPaymentSchedule(contractPrice, orderAbsWeek, deliverAbsWeek) {
  const price    = Math.max(0, Math.round(Number(contractPrice) || 0));
  const signed   = Math.round(Number(orderAbsWeek) || 0);
  const delivery = Math.max(signed, Math.round(Number(deliverAbsWeek) || 0));
  const deposit  = Math.round(price * PDP_DEPOSIT_SHARE);
  const out = [{ kind: 'deposit', absWeek: signed, amount: deposit, paid: false }];
  let scheduled = deposit;
  for (const { weeksBefore, share } of PDP_INSTALMENTS) {
    const amount = Math.round(price * share);
    out.push({ kind: 'pdp', absWeek: Math.max(signed, delivery - weeksBefore), amount, paid: false });
    scheduled += amount;
  }
  out.push({ kind: 'balance', absWeek: delivery, amount: price - scheduled, paid: false });
  return out;
}

/** Deposit plus every instalment — everything owed before the aircraft arrives. */
export function preDeliveryTotal(contractPrice) {
  return buildPaymentSchedule(contractPrice, 0, 0)
    .filter(p => p.kind !== 'balance')
    .reduce((s, p) => s + p.amount, 0);
}

/** What falls due on or before the signing week — the cash that leaves at signing. */
export function signingAmount(payments, orderAbsWeek) {
  return (payments ?? [])
    .filter(p => !p.paid && p.absWeek <= orderAbsWeek)
    .reduce((s, p) => s + p.amount, 0);
}

/** Mark every payment due on or before `absWeek` as paid. */
export function markPaidThrough(payments, absWeek) {
  return (payments ?? []).map(p => (!p.paid && p.absWeek <= absWeek) ? { ...p, paid: true } : p);
}

/**
 * Pre-delivery money signed for but not yet paid, across the whole book. The
 * balance is excluded on purpose: it is always cash on delivery and is not
 * part of what the bank has to hold to sign.
 */
export function committedPreDelivery(pendingOrders) {
  let total = 0;
  for (const o of pendingOrders ?? []) {
    if (!hasPaymentSchedule(o)) continue;
    for (const p of o.payments) if (!p.paid && p.kind !== 'balance') total += p.amount;
  }
  return total;
}

/**
 * Settle every payment due on or before `absWeek` — the tick's half of the
 * schedule. Returns the orders with those payments marked paid and the total
 * charged. When nothing is due the ORIGINAL array comes back untouched, so a
 * classic save's pendingOrders is never rewritten by a tick.
 *
 * @param {object[]} pendingOrders
 * @param {number}   absWeek        the week the tick moves INTO (delivery's newAbsWeek)
 */
export function settleDuePayments(pendingOrders, absWeek) {
  const orders = pendingOrders ?? [];
  let total = 0;
  let changed = false;
  const next = orders.map(o => {
    if (!hasPaymentSchedule(o)) return o;
    const due = o.payments.filter(p => !p.paid && p.absWeek <= absWeek);
    if (due.length === 0) return o;
    changed = true;
    total += due.reduce((s, p) => s + p.amount, 0);
    return { ...o, payments: markPaidThrough(o.payments, absWeek) };
  });
  return { orders: changed ? next : orders, total };
}

/** What the tick moving into `absWeek` will charge — settleDuePayments without the settling. */
export function paymentsDueBy(pendingOrders, absWeek) {
  return settleDuePayments(pendingOrders, absWeek).total;
}

/** Money already paid on an order. */
export function amountPaid(order) {
  if (!hasPaymentSchedule(order)) return 0;
  return order.payments.filter(p => p.paid).reduce((s, p) => s + p.amount, 0);
}

/**
 * What CANCEL_ORDER hands back. The single source for the reducer and every
 * screen that quotes a refund.
 *   lease                 → the security deposit, in full
 *   owned, with schedule  → paid instalments at PDP_CANCEL_REFUND_SHARE; deposit kept
 *   owned, classic        → CLASSIC_CANCEL_REFUND_SHARE of the price paid
 */
export function cancellationRefund(order) {
  if (!order) return 0;
  if (order.ownershipType !== 'owned') return order.leaseDeposit ?? 0;
  if (hasPaymentSchedule(order)) {
    const paidPdp = order.payments
      .filter(p => p.paid && p.kind === 'pdp')
      .reduce((s, p) => s + p.amount, 0);
    return Math.round(paidPdp * PDP_CANCEL_REFUND_SHARE);
  }
  return Math.round((order.totalPrice ?? 0) * CLASSIC_CANCEL_REFUND_SHARE);
}
