// What a bulk cancel returns, in words — one answer for the Fleet ▸ On Order
// panel and Market ▸ Orders.
//
// Every order is quoted by models/lineBook.js orderCancelTerms, the function
// CANCEL_ORDER pays from (single or bulk), and the figures summed, so the bulk
// dialog cannot promise a refund the reducer will not pay. Firm launch frames
// are counted and left out: CANCEL_ORDER keeps them on the book.

import { orderCancelTerms } from '../models/lineBook.js';
import { absoluteWeek } from './fuel.js';
import { formatMoney } from './simulation.js';

/** { count, firm, allowed, title, body, refund, forfeit, ids } */
export function cancelOrdersDialog(state, orders) {
  const absWeek = absoluteWeek(state?.year, state?.week);
  let refund = 0, forfeit = 0, firm = 0, lines = false;
  const ids = [];
  for (const o of orders ?? []) {
    const t = orderCancelTerms(state, o, absWeek);
    if (!t.allowed) { firm++; continue; }
    ids.push(o.id);
    refund += t.refund;
    forfeit += t.forfeit;
    lines = lines || t.rule === 'line' || t.rule === 'staged';
  }
  const count = ids.length;
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const title = `Cancel ${plural(count, 'order')}?`;
  const firmNote = firm > 0
    ? ` ${plural(firm, 'launch-customer order')} ${firm === 1 ? 'is' : 'are'} firm and will stay on the book.`
    : '';
  if (count === 0) {
    return { count, firm, allowed: false, title, body: firmNote.trim() || 'No orders selected.', refund: 0, forfeit: 0, ids };
  }
  const body = (forfeit > 0
    ? `You get ${formatMoney(refund)} back and lose ${formatMoney(forfeit)} in cancellation fees and forfeits.`
    : `You get ${formatMoney(refund)} back in full.`)
    + (lines ? ' The slots go back on the line for anyone to take.' : '')
    + firmNote;
  return { count, firm, allowed: true, title, body, refund, forfeit, ids };
}

/** Is this order cancellable at all (launch frames are firm)? */
export function orderCancellable(state, order) {
  return orderCancelTerms(state, order, absoluteWeek(state?.year, state?.week)).allowed;
}
