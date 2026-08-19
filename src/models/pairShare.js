// ─────────────────────────────────────────────────────────────────────────────
// PAIR MARKET SHARE + ROUTE PROJECTION — one place that answers
//   "what slice of this city pair am I actually carrying?"  and
//   "what will this route ACTUALLY carry once I open it?"
//
// WHY THIS EXISTS
// ---------------
// The route-launch forms asked the second question with a bare
// `simulateRoute(spec, aircraft, gameDate)` and a null demandOverride. That call
// means "what would this aircraft carry if it were the ONLY thing in this
// market?" — so on a pair the player already flies it handed the new tail the
// entire O&D pool a second time, while weeklyTick pools every tail on a pair
// into ONE offer and splits the result by seat share (see the pre-pass in
// utils/simulation.js). Measured on a fixture:
//
//   DCA–GSP  A320neo 10/wk  1→2 tails   tick +$251,183   forecast +$248,645
//   DCA–GSP  A320neo 10/wk  2→3 tails   tick  +$88,580   forecast +$248,645
//   DCA–GSP  A320neo 14/wk  2→3 tails   tick  −$87,985   forecast +$348,180
//   IAD–HVN  A320neo 12/wk  2→3 tails   tick   −$6,389   forecast +$273,712
//
// The forecast pinned at the engine's 87.3% load ceiling in every saturated case
// and never signalled saturation — and it is accurate on an unserved pair, which
// is exactly what makes it trustworthy right up until it isn't. The player pays
// a non-refundable launch fee on each one.
//
// A second, compounding defect on the same call sites: `simulateRoute` reads
// `route.brandReach ?? 1`, i.e. an offer that omits it is scored as an
// ESTABLISHED carrier. No preview attached it, so a week-one airline (real
// brand reach ≈ 0.45) previewed the market share of a household name. The
// market-SHARE panels next to the forecast already applied `stateBrandReach`,
// so the two halves of one screen disagreed with each other.
//
// Ported from Headwinds' packages/engine/src/models/pairShare.js. Differences
// from that file are marked TW: — Tailwinds is ahead of Headwinds in several
// places (rival dedupe, ticket premium, the ancillaries/competitors arguments)
// and those must not be regressed by a blind transplant.
//
// A preview that disagrees with weeklyTick is a bug in one of them. Fix the
// disagreement, don't paper over it.
// ─────────────────────────────────────────────────────────────────────────────

import {
  buildRouteMarket,
  computeMarketShare,
  computeConnectivityBonus,
  routeMaturityFactor,
  HUB_TIERS,
} from './demand.js';
import { memberPairKeysOf } from '../utils/market.js';
import { campaignDemandBoostPct } from '../data/overhead.js';
import { getAircraftType } from '../data/aircraft.js';
import {
  configBodies,
  defaultConfig,
  hydrateRoute,
  routeQualityBreakdown,
  isMultiStop,
  hubSpokeCounts,
  routePairKey,
  stateSensReduction,
  stateBrandReach,
  stateLoungeFields,
  simulateRoute,
  fleetAvgUtilization,
  routeLandingFee,
  rivalOffersFor,
  rivalSpecsFor,
  buildEventDemandModel,
  CLASS_FARE_MULTIPLIERS,
} from '../utils/simulation.js';

// TW: Headwinds declares its own `pairKeyOf`. Tailwinds already exports the
// identical helper as `routePairKey` and the tick keys `demandAllocations`,
// `partnerContestedKeys` and `routePricing` with it — a second private copy is
// exactly how two files start disagreeing about what a pair is.
export { routePairKey as pairKeyOf };

/**
 * The demand multiplier weeklyTick applies to one O&D, resolved from state alone.
 *
 * weeklyTick builds `buildEventDemandModel(state.activeEvents).multFor(a, b)`
 * once and hands it to BOTH buildRouteMarket and simulateRoute. Previews used to
 * rely on the CALLER having it in hand: pairMarketShare defaulted
 * `opts.eventDemandMult` to 1 and projectRouteAddition defaulted its own
 * parameter to 1.0, so a pandemic reached a launch forecast only if the screen
 * asking for the forecast happened to pass it. Both current call sites do — and
 * anything else previewed a world with no event in it.
 *
 * `eventOnly` is the caller's figure when it has one; otherwise it is resolved
 * here, so no call site needs editing and none can silently omit it.
 *
 * TW: Tailwinds has no per-world demand multiplier (Headwinds' twin of this
 * helper composes state.worldDemandMult on top). There is nothing to add here.
 */
export function stateDemandMult(state, origin, destination, eventOnly) {
  return eventOnly ?? buildEventDemandModel(state.activeEvents).multFor(origin, destination);
}

/**
 * Combine every player aircraft on one city pair into the single AirlineOffer
 * the demand model expects. Mirrors weeklyTick's multi-aircraft pre-pass: one
 * carrier competes for the pair, not one offer per tail.
 *
 * @param {object}   state       full game state
 * @param {object[]} pairRoutes  the player's routes on this pair (>= 1)
 * @returns {object|null}
 */
export function buildPlayerPairOffer(state, pairRoutes) {
  if (!pairRoutes || pairRoutes.length === 0) return null;
  const r0 = pairRoutes[0];
  const fleet = state.fleet ?? [];

  let totalFreq = 0, totalEcoSeats = 0, totalBizSeats = 0, totalSeatsAll = 0;
  let premiumSeats = 0;                 // TW: Σ bodies × that type's ticketPremium
  let hasBusinessCabin = false;
  let qualitySum = 0, qualityN = 0;
  for (const route of pairRoutes) {
    const aircraft = fleet.find((a) => a.id === route.aircraftId);
    if (!aircraft) continue;
    const type = getAircraftType(aircraft.typeId);
    if (!type) continue;
    const cfg  = aircraft.config ?? defaultConfig(type.seats);
    const freq = route.weeklyFrequency ?? 7;
    const eco  = (cfg.economy ?? type.seats) * freq;
    const biz  = (cfg.businessClass ?? 0) * freq;
    const bodies = configBodies(cfg) * freq;
    totalFreq     += freq;
    totalEcoSeats += eco;
    totalBizSeats += biz;
    totalSeatsAll += bodies;
    premiumSeats  += bodies * (type.ticketPremium ?? 1);
    if (biz > 0) hasBusinessCabin = true;
    // Engine-accurate per-route quality (morale, utilization, cabin product,
    // catering, ancillaries, hub bonus) — the same figure the tick scores the
    // offer with, through the same helper.
    const q = routeQualityBreakdown(route, aircraft, state)?.total;
    if (q != null) { qualitySum += q; qualityN += 1; }
  }
  if (totalFreq <= 0 || qualityN === 0) return null;

  const key = routePairKey(r0.origin, r0.destination);
  const cp  = state.routePricing?.[key] ?? r0.classPrices ?? {};
  // TW: the seat-weighted TICKET PREMIUM the tick's pooled offer applies before
  // the demand model, so higher fares feed through elasticity. Headwinds' pooled
  // offer has no premium term; omitting it here would let a supersonic lane's
  // fares silently revert to subsonic in the preview only.
  const ticketPremium = totalSeatsAll > 0 ? premiumSeats / totalSeatsAll : 1;
  const ecoPrice = Math.max(1, (cp.economy ?? r0.ticketPrice ?? 1) * ticketPremium);
  // A business FARE with no business SEATS is not a cabin — leaving it non-null
  // would let the model sell premium demand this pair cannot carry. And no
  // implicit 3.5x fare when the pair carries no business price: that is the tick's
  // rule for the pooled offer, and inventing one here is how two code paths start
  // answering the same question differently.
  const bizPrice = hasBusinessCabin
    ? (cp.businessClass != null
        ? Math.max(1, cp.businessClass * ticketPremium)
        : Math.max(1, ecoPrice * CLASS_FARE_MULTIPLIERS.businessClass))
    : null;

  // Hub quality bonus from the better endpoint. Tier 0 (Focus City) is a valid
  // designation, so test against null rather than truthiness.
  const hubQ = hubQualityFor(state, r0.origin, r0.destination);

  return {
    airlineId:        'player',
    origin:           r0.origin,
    destination:      r0.destination,
    economyPrice:     ecoPrice,
    businessPrice:    bizPrice,
    weeklyFrequency:  totalFreq,
    seatsPerFlight:   Math.round((totalEcoSeats + totalBizSeats) / totalFreq),
    economySeats:     totalEcoSeats,
    businessSeats:    totalBizSeats,
    totalSeats:       totalSeatsAll,
    qualityScore:     Math.round(qualitySum / qualityN),
    // TW: the tick's pooled offer resolves connectivity through
    // computeConnectivityBonus(route.hub, …, spokeCounts[route.hub]) — the
    // ROUTE's hub, scaled by the spokes the player actually connects there.
    // Headwinds uses pairConnectivityBonus over every designated hub; on
    // Tailwinds that would score a pair the tick scores at 0.
    connectivityBonus: computeConnectivityBonus(
      r0.hub, r0.origin, r0.destination,
      hubSpokeCounts(state.routes ?? [])[r0.hub] ?? 0),
    priceSensitivityReduction: stateSensReduction(state, hubQ),
    marketingBoost:   playerCampaignBoost(state, r0.origin, r0.destination),
    // Brand reach, resolved through the same helper the tick uses. Without it a
    // week-one carrier previews the market share of an established one — the
    // exact preview/tick divergence this module exists to prevent.
    brandReach:       stateBrandReach(state, hubQ, false),
    // Lounges at this pair's endpoints. Same reason as brandReach: leaving it
    // off would preview the business share of a carrier with a lounge network
    // for one that has none (or vice versa).
    loungeAppeal:     stateLoungeFields(state, r0.origin, r0.destination).loungeAppeal,
  };
}

/** Targeted-campaign lift on a pair — strongest campaign at either endpoint. */
export function playerCampaignBoost(state, origin, destination) {
  const cs = state.campaignStrength ?? {};
  return campaignDemandBoostPct(Math.max(cs[origin] ?? 0, cs[destination] ?? 0));
}

/**
 * Every rival offer on a pair, resolved through the SAME helper the weekly tick
 * uses so a preview cannot silently disagree with it.
 *
 * TW: Headwinds walks state.humanRivals → state.encroachments → state.competitors
 * by hand and re-implements the dedupe inline. Tailwinds is single-player (there
 * is no humanRivals channel) and already owns that dedupe in
 * `rivalOffersFor(competitors, specs, market)`, which drops the synthetic
 * encroachment entrant when the same carrier already has a real network on the
 * pair. Routing through it rather than re-concatenating by hand is what stops
 * this file drifting away from the tick.
 */
export function buildRivalPairOffers(state, market) {
  return rivalOffersFor(
    state.competitors ?? [],
    rivalSpecsFor(state, market.origin, market.destination),
    market,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// METRO LANE — the preview's half of weeklyTick's one-fight-per-metro-pair rule
// ─────────────────────────────────────────────────────────────────────────────

/** The player's nonstop routes on one airport pair. */
function routesOnPair(state, key) {
  // TW: `pairKeyOf` here is a re-EXPORT of routePairKey, not a local binding —
  // referencing it inside this module is a ReferenceError at call time.
  return (state.routes ?? []).filter(
    (r) => routePairKey(r.origin, r.destination) === key && !isMultiStop(r));
}

/** Does anyone other than the player fly this exact airport pair? */
function pairHasRival(state, key) {
  if ((state.humanRivals?.[key] ?? []).length > 0) return true;
  if (state.encroachments?.[key]) return true;
  return (state.competitors ?? []).some((c) => c?.routes?.[key]);
}

/**
 * Demand-model market share for one city pair.
 *
 * @param {object} state
 * @param {string} origin
 * @param {string} destination
 * @param {object} [opts]
 * @param {object}   [opts.gameDate]        defaults to state.gameDate
 * @param {object[]} [opts.pairRoutes]      override the routes on this pair — used by
 *                                          projectRouteAddition() to price a pair that
 *                                          includes a route not opened yet
 * @param {number}   [opts.weeksOpen]       override lane maturity (0 = launch week)
 * @param {number}   [opts.eventDemandMult] world-event demand multiplier for this O&D,
 *                                          the same figure weeklyTick hands
 *                                          buildRouteMarket (TW has no worldDemandMult)
 * @returns {{ market, offers, results, playerResult, playerShare, totalPax, contested }}
 */
export function pairMarketShare(state, origin, destination, opts = {}) {
  const gameDate = opts.gameDate ?? state.gameDate ?? { month: 6 };
  const key = routePairKey(origin, destination);

  // Tag (multi-stop) routes self-contain their O&D split and must not join a
  // pair offer — the tick skips them in the pre-pass for the same reason. The
  // test for that is isMultiStop() and NOT `!r.stops?.length`: hydration gives
  // every single-leg route `stops: [origin, destination]`, so the latter matches
  // only UN-hydrated routes and returns an empty pair on any real save.
  const pairRoutes = opts.pairRoutes ?? (state.routes ?? []).filter(
    (r) => routePairKey(r.origin, r.destination) === key && !isMultiStop(r)
  );
  // Route maturity is per-route; a pair flown by several tails ramps with the
  // OLDEST of them (the market has known the service that long) — the tick's
  // laneWeeksOpen rule.
  const weeksOpen = opts.weeksOpen ?? pairRoutes.reduce(
    (m, r) => Math.max(m, r.weeksOpen ?? 0), 0);
  const maturity = pairRoutes.some((r) => r.weeksOpen != null)
    ? routeMaturityFactor(weeksOpen) : 1;
  // The pool the tick will fight over: seasonality × maturity × world events.
  // Defaulting the event multiplier to 1 here left the shock out of the POOL
  // whenever the caller did not supply it, while simulateRoute still applied it
  // to the route — two halves of one multiplier, applied in different places.
  const market = buildRouteMarket(origin, destination, gameDate, maturity,
    opts.eventDemandMult ?? stateDemandMult(state, origin, destination));

  const playerOffer = buildPlayerPairOffer(state, pairRoutes);
  const rivalOffers = buildRivalPairOffers(state, market);

  // ── Metro lane: ONE share fight per metro pair, exactly as weeklyTick runs it
  //
  // data/metros.js prices every member pair of a metro pair at the same metro
  // total — New York↔London is one market however you fly it — and the tick's
  // pre-pass fights over it once: one player offer PER MEMBER PAIR SERVED (your
  // JFK and your EWR services are genuinely different products chasing the same
  // travellers), with rivals scanned across EVERY member pair.
  //
  // This preview scanned the queried airport pair and nothing else. On a lane
  // where the competition sits at the sibling field it therefore reported an
  // empty market. Measured on a fixture with a rival flying JFK–LHR and the
  // player pricing up EWR–LHR:
  //
  //     preview  6,160 pax  100.0% load  +$3,131,886/wk   "no competitors"
  //     tick     4,633 pax   75.2% load  +$1,642,215/wk
  //
  // — a 33% passenger and $1.49M/wk overstatement, on a screen that also told
  // the player the lane was uncontested. Reported in Discord by Lancelotbronner:
  // "multiple airports in the same city still show a large demand but none of
  // the routes are profitable, are they linked?". They are, and now the preview
  // says so.
  //
  // The engagement guard mirrors the tick's exactly: a lane carrying fewer than
  // two player presences and no rival at an UNSERVED sibling field keeps the
  // historical exact-pair path, so nothing off a real metro lane moves.
  const laneKeys = memberPairKeysOf(origin, destination).filter((k) => k !== key);
  const siblingPlayerOffers = [];
  const siblingRivalOffers  = [];
  const siblingPairs = [];
  let   siblingRouteCount = 0;
  let   unservedSiblingRival = false;
  for (const k of laneKeys) {
    const rs    = routesOnPair(state, k);
    const rival = pairHasRival(state, k);
    if (rs.length === 0 && !rival) continue;
    if (rs.length === 0) unservedSiblingRival = true;
    if (rs.length > 0) {
      const o = buildPlayerPairOffer(state, rs);
      if (o) {
        siblingPlayerOffers.push(o);
        siblingPairs.push(k);
        siblingRouteCount += rs.length;
      }
    }
    if (rival) {
      // Every member pair prices at the metro total by construction, and the
      // tick gives the whole lane ONE maturity — the queried pair's. Rebuilding
      // the sibling's market rather than reusing this one keeps its own event
      // multiplier, which is what the tick's per-key buildRouteMarket does.
      const [ka, kb] = k.split('-');
      siblingRivalOffers.push(...buildRivalPairOffers(state,
        buildRouteMarket(ka, kb, gameDate, market.maturityFactor ?? 1,
          stateDemandMult(state, ka, kb))));
    }
  }
  const lanePooled =
    (pairRoutes.length + siblingRouteCount) >= 2 || unservedSiblingRival;

  // The queried pair's offer goes FIRST and stays first: on a pooled lane your
  // own sibling services are `airlineId: 'player'` too (the tick names them the
  // same way), so POSITION, not id, is what identifies this pair's result.
  const laneSiblings = lanePooled ? siblingPlayerOffers : [];
  const laneRivals   = lanePooled
    ? [...rivalOffers, ...siblingRivalOffers]
    : rivalOffers;
  const offers = [...(playerOffer ? [playerOffer] : []), ...laneSiblings, ...laneRivals];
  if (offers.length === 0) {
    return { market, offers, results: [], playerResult: null,
             playerShare: null, playerLaneShare: null, totalPax: 0, contested: false,
             lanePooled: false, laneRivalCount: 0, siblingPairs: [] };
  }

  const results = computeMarketShare(market, offers);
  const playerResult = playerOffer ? (results[0] ?? null) : null;
  const totalPax = results.reduce((s, r) => s + (r.totalPax ?? 0), 0);
  // Everything YOUR airline carries in the lane — this pair plus your sibling
  // fields. Indexed off the same offer order the array was built in.
  const siblingBase = playerOffer ? 1 : 0;
  const playerLanePax = (playerResult?.totalPax ?? 0)
    + laneSiblings.reduce((s, _o, i) => s + (results[siblingBase + i]?.totalPax ?? 0), 0);

  return {
    market,
    offers,
    results,
    playerResult,
    // Share of passengers ACTUALLY CARRIED, capacity caps included — if you only
    // have seats for half the people who'd pick you, you don't hold their share.
    playerShare: playerResult && totalPax > 0
      ? playerResult.totalPax / totalPax
      : playerResult ? 1 : null,
    // Your WHOLE airline's slice of the metro lane, sibling airports included.
    playerLaneShare: totalPax > 0 ? playerLanePax / totalPax : null,
    totalPax,
    contested: laneRivals.length > 0,
    // True when the tick's metro pre-pass would engage on this lane. A caller
    // building a route forecast must then take a pooled SLICE rather than let
    // simulateRoute run its own whole-pool fight — that second fight is what
    // handed a sibling-airport launch the entire metro market a second time.
    lanePooled,
    laneRivalCount: laneRivals.length,
    // Member pairs of this lane you already serve, e.g. ['JFK-LHR'] when pricing
    // up EWR–LHR. The planner names them so "why is my demand lower than the
    // market figure?" has a visible answer.
    siblingPairs,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ROUTE PROJECTION — "what will this route ACTUALLY carry once I open it?"
// ─────────────────────────────────────────────────────────────────────────────

/** Sentinel id for the not-yet-real route a projection is built around. */
export const PREVIEW_ROUTE_ID = '__preview__';

/**
 * Split one pair's pooled demand into a single route's slice, exactly the way
 * weeklyTick's multi-aircraft pre-pass does: proportionally by that route's
 * share of the pair's economy and business seats.
 */
function sliceForRoute(pooled, route, aircraft, pairRoutes, fleet) {
  let totalEco = 0, totalBiz = 0;
  let myEco = 0, myBiz = 0;
  for (const r of pairRoutes) {
    const ac = r.id === route.id ? aircraft : fleet.find((a) => a.id === r.aircraftId);
    if (!ac) continue;
    const type = getAircraftType(ac.typeId);
    if (!type) continue;
    const cfg  = ac.config ?? defaultConfig(type.seats);
    const freq = r.weeklyFrequency ?? 7;
    const eco  = (cfg.economy ?? type.seats) * freq;
    const biz  = (cfg.businessClass ?? 0) * freq;
    totalEco += eco; totalBiz += biz;
    if (r.id === route.id) { myEco = eco; myBiz = biz; }
  }
  const ecoFrac = totalEco > 0 ? myEco / totalEco : 1 / Math.max(1, pairRoutes.length);
  const bizFrac = totalBiz > 0 ? myBiz / totalBiz : 1 / Math.max(1, pairRoutes.length);
  return {
    leisurePax:      Math.round((pooled.leisurePax      ?? 0) * ecoFrac),
    businessPax:     Math.round((pooled.businessPax     ?? 0) * bizFrac),
    // PRE-CAP demand rides along, exactly as weeklyTick's demandAllocations do.
    // simulateRoute's load model spills against the demand the MARKET generated,
    // not against the seat count: hand it only the capped figures and a
    // capacity-capped lane looks like a lane with demand equal to its seats, so
    // the spill model trims a route the tick does not. Measured on a two-airport
    // New York↔London lane: preview 5,379 pax against the tick's 5,789 (-7.1%),
    // purely from the missing uncapped fields. The tick has always passed them;
    // this slice simply never did, which stayed invisible while the only pooled
    // previews were same-pair ones sitting at 100% load.
    leisurePaxUncapped:  Math.round((pooled.leisurePaxUncapped  ?? pooled.leisurePax  ?? 0) * ecoFrac),
    businessPaxUncapped: Math.round((pooled.businessPaxUncapped ?? pooled.businessPax ?? 0) * bizFrac),
    economyRevenue:  Math.round((pooled.economyRevenue  ?? 0) * ecoFrac),
    businessRevenue: Math.round((pooled.businessRevenue ?? 0) * bizFrac),
    leisureShare:    pooled.leisureShare,
    businessShare:   pooled.businessShare,
    capacityCapped:  pooled.capacityCapped,
  };
}

/**
 * Project what a route the player has NOT opened yet would actually carry.
 *
 * Five things the tick applies that a bare simulateRoute() call does not:
 *
 *   1. Lane pooling   — every player tail on a pair competes as ONE offer and
 *                       splits the result by seat share (weeklyTick's pre-pass).
 *   2. Maturity ramp  — a brand-new pair opens below its mature demand and takes
 *                       16 weeks to get there (routeMaturityFactor).
 *   3. Load ceiling   — demand is spilled against an achievable ceiling, so 100%
 *                       load is not merely unlikely, it is unreachable: parity
 *                       lands near 87% and the asymptote is 95%.
 *   4. Rivals         — AI carriers and encroachment challengers contest the pair
 *                       through rivalOffersFor().
 *   5. Brand          — brandReach / marketingBoost / priceSensitivityReduction,
 *                       resolved from state through the same helpers the tick uses.
 *
 * Joining a pair you already fly deliberately returns launch === mature: the
 * market already knows the service, so an added tail gets a mature slice on day
 * one. The ramp only shows up on a genuinely new pair.
 *
 * @param {object} state
 * @param {object} spec
 * @param {string} spec.origin
 * @param {string} spec.destination
 * @param {object} spec.aircraft            the airframe to fly it (may be synthetic)
 * @param {number} spec.weeklyFrequency
 * @param {object} [spec.classPrices]       per-cabin fares; pair pricing wins if set
 * @param {number} [spec.ticketPrice]
 * @param {string} [spec.cateringLevel]
 * @param {object} [spec.season]
 * @param {string} [spec.replacesRouteId]   editing an existing route rather than adding
 * @param {object} [spec.gameDate]
 * @param {number} [spec.fuelMultiplier]
 * @param {number} [spec.eventDemandMult]
 * @returns {{
 *   mature: object|null,      // simulateRoute result at full maturity
 *   launch: object|null,      // simulateRoute result in week 0
 *   shared: boolean,          // pair already flown by another of your tails
 *   pairRouteCount: number,   // your routes on the pair INCLUDING this one
 *   pairPassengers: number|null,  // what the whole pair carries, this tail included
 *   lanePassengers: number,       // what the whole metro lane carries, everyone
 *   laneDemand: number,           // the lane's pooled weekly demand
 *   rivalCount: number,        // rivals in the whole METRO lane, not just the pair
 *   lanePooled: boolean,       // the tick's metro pre-pass engages on this lane
 *   siblingPairs: string[],    // member pairs of the lane you already serve
 *   playerShare: number|null, // pair share at maturity, capacity caps included
 * }|null}
 */
export function projectRouteAddition(state, spec) {
  const {
    origin, destination, aircraft, weeklyFrequency,
    classPrices, ticketPrice, cateringLevel, season,
    replacesRouteId = null,
    gameDate = state.gameDate ?? { month: 6 },
    // TW: weeklyTick reads state.fuelMultiplier (tickPrep computes it and hands
    // it in as part of tickInput; a saved state does not carry it, so this is
    // 1.0 on a real save — exactly what the two call sites passed by hand).
    fuelMultiplier = state.fuelMultiplier ?? 1.0,
    // TW: Tailwinds has no state.worldDemandMult. The tick's demand multiplier
    // for an O&D is buildEventDemandModel(state.activeEvents).multFor, and it
    // goes to BOTH buildRouteMarket and simulateRoute — so it does here. Resolved
    // from state when the caller passes nothing, so a world event cannot go
    // missing from a forecast just because the screen asking forgot to opt in.
    eventDemandMult = buildEventDemandModel(state.activeEvents).multFor(origin, destination),
  } = spec;
  if (!origin || !destination || !aircraft || origin === destination) return null;

  const key   = routePairKey(origin, destination);
  const fleet = state.fleet ?? [];
  // The airframe may be synthetic (RoutePlanner previews a TYPE, not a tail), so
  // make sure the offer builder can find it.
  const fleetPlus = fleet.some((a) => a.id === aircraft.id) ? fleet : [...fleet, aircraft];

  // Price and catering belong to the O&D PAIR, not to the aircraft: ADD_ROUTE
  // only seeds routePricing/routeCatering when the pair has none, so a fare
  // typed into the form for a pair the player already flies is discarded by the
  // reducer. hydrateRoute() is the tick's own resolver — running the preview
  // through it means the forecast quotes the fare the route will actually fly
  // at, and the fare the pooled offer above is priced with.
  const previewRoute = hydrateRoute({
    id: PREVIEW_ROUTE_ID,
    origin, destination,
    stops: [origin, destination],
    aircraftId: aircraft.id,
    weeklyFrequency,
    ticketPrice,
    classPrices,
    cateringLevel,
    season,
    hub: state.hub,
  }, state.routePricing ?? {}, state.routeCatering ?? {});

  // Your OTHER routes on this pair. A route being edited is replaced, not joined —
  // otherwise the edit previews as if it were competing with its own old self.
  const others = (state.routes ?? []).filter(
    (r) => routePairKey(r.origin, r.destination) === key
      && !isMultiStop(r)
      && r.id !== replacesRouteId
      && r.id !== PREVIEW_ROUTE_ID
  );
  const pairRoutes = [...others, previewRoute];
  const routesPlus = [
    ...(state.routes ?? []).filter((r) => r.id !== replacesRouteId),
    previewRoute,
  ];
  const stateForOffer = { ...state, fleet: fleetPlus, routes: routesPlus };

  // Lane maturity. An established pair is already mature and does NOT re-ramp
  // when you add a tail; only a pair you have never flown starts at week 0.
  const existingWeeks = others.reduce((m, r) => Math.max(m, r.weeksOpen ?? 0), 0);
  const matureWeeks   = Math.max(existingWeeks, 16);
  const launchWeeks   = others.length > 0 ? existingWeeks : 0;

  const hubQ = hubQualityFor(state, origin, destination);
  const hcf  = hubCostFactorsFor(state, [origin, destination]);
  // The spokes the player connects at this route's hub, counted the way the tick
  // counts them (weeklyTick attaches route.hubSpokes from hubSpokeCounts). Omit
  // it and simulateRoute falls back to CONNECTIVITY_LEGACY_SPOKES = 12, which is
  // a hub the player may not have.
  const hubSpokes = hubSpokeCounts(routesPlus)[state.hub] ?? 0;
  // The tick's per-route load jitter is keyed on (pair, absolute week). A route
  // that does not exist yet has no week to key it on, so leave it absent and
  // simulateRoute projects the EXPECTED week (jitter = 1) — an honest central
  // estimate rather than one arbitrary week's roll.

  const runAt = (weeksOpen) => {
    const share = pairMarketShare(stateForOffer, origin, destination, {
      gameDate,
      eventDemandMult,
      pairRoutes: pairRoutes.map((r) =>
        r.id === PREVIEW_ROUTE_ID ? { ...r, weeksOpen } : r),
      weeksOpen,
    });
    if (!share.playerResult) return { result: null, share };
    // Mirror the tick: a pair flown by a single tail with nothing else in its
    // metro lane runs simulateRoute's own demand path; a shared pair — or ANY
    // pooled lane — needs the pooled split instead.
    //
    // `share.lanePooled` is the half that was missing. The tick hands every
    // member group of a pooled lane a demandOverride even when that member pair
    // flies a single tail, because the metro pair has already been fought over.
    // Without it, a launch at a sibling airport fell through to simulateRoute's
    // own whole-pool fight and was quoted the entire metro market a second time.
    const override = (pairRoutes.length >= 2 || share.lanePooled)
      ? sliceForRoute(share.playerResult, previewRoute, aircraft, pairRoutes, fleetPlus)
      : null;
    const route = {
      ...previewRoute,
      weeksOpen,
      hubSpokes,
      ...(hubQ > 0 ? { hubQualityBonus: hubQ } : {}),
      priceSensitivityReduction: stateSensReduction(state, hubQ),
      marketingBoost: playerCampaignBoost(state, origin, destination),
      brandReach: stateBrandReach(state, hubQ, false),
      // The same three lounge fields weeklyTick attaches. Without loungeCoverage
      // the projection sells day passes at an airport with no lounge; without
      // loungeContractFactor it quotes the full third-party premium ground rate
      // on a route the tick discounts — wrong in both directions at once.
      ...stateLoungeFields(state, origin, destination),
      ...(hcf ? { hubCostFactors: hcf } : {}),
    };
    const result = simulateRoute(
      route, aircraft, gameDate,
      state.labor ?? null,
      fuelMultiplier,
      override,
      rivalSpecsFor(state, origin, destination),
      fleetAvgUtilization(fleetPlus, [...routesPlus, ...(state.cargoRoutes ?? [])]),
      state.satisfaction ?? null,
      eventDemandMult,
      // TW: simulateRoute args 11/12. Headwinds' projection predates neither, but
      // omitting them here would forecast a route with no à-la-carte revenue and
      // no AI carriers on it — i.e. exactly the monopoly the old bare call assumed.
      state.ancillaries ?? null,
      state.competitors ?? [],
    );
    if (!result) return { result, share };
    // Landing fees are charged per departure by weeklyTick and are NOT inside
    // simulateRoute's `profit`. Surfaced rather than folded in: `profit` keeps
    // the meaning both call sites already display, and a caller that wants the
    // tick's definition of route profit uses profitAfterLandingFees.
    const type = getAircraftType(aircraft.typeId);
    return {
      result: {
        ...result,
        landingFee: routeLandingFee(route, type, weeklyFrequency),
        profitAfterLandingFees: Math.round(
          result.profit - routeLandingFee(route, type, weeklyFrequency)),
      },
      share,
    };
  };

  const mature = runAt(matureWeeks);
  const launch = runAt(launchWeeks);
  if (!mature.result) return null;

  return {
    mature: mature.result,
    launch: launch.result,
    shared: others.length > 0,
    pairRouteCount: pairRoutes.length,
    // What the WHOLE pair carries once this tail joins it, and what the whole
    // metro lane carries between everyone on it. The per-route figures above are
    // a slice of the first; without them on hand a planner can show a second
    // aircraft's profit falling and have no way to say why. "how come net profit
    // comes down if i add more aircraft to the same route" — ASAS, Discord.
    pairPassengers: mature.share.playerResult?.totalPax ?? null,
    pairRevenue: mature.share.playerResult
      ? Math.round((mature.share.playerResult.economyRevenue ?? 0)
                 + (mature.share.playerResult.businessRevenue ?? 0))
      : null,
    lanePassengers: mature.share.totalPax,
    laneDemand: Math.round((mature.share.market?.leisureDemand ?? 0)
                         + (mature.share.market?.businessDemand ?? 0)),
    rivalCount: mature.share.laneRivalCount,
    lanePooled: mature.share.lanePooled,
    siblingPairs: mature.share.siblingPairs,
    playerShare: mature.share.playerShare,
  };
}

/** The hubs map, with the same backward-compat fallback weeklyTick uses. */
function hubsOf(state) {
  return state.hubs ?? (state.hub ? { [state.hub]: { tier: 1 } } : {});
}

/** Best hub quality bonus across a pair's endpoints (tier 0 is a real tier). */
function hubQualityFor(state, origin, destination) {
  const hubs = hubsOf(state);
  const q = (code) => {
    const t = hubs[code]?.tier;
    return t != null ? (HUB_TIERS[t]?.qualityBonus ?? 0) : 0;
  };
  return Math.max(q(origin), q(destination));
}

/**
 * TW: hub cost efficiency for the airports a route touches — station handling,
 * crew layovers, line maintenance. weeklyTick attaches this to every route
 * (hubCostFactorsFor) and simulateRoute reads it as `route.hubCostFactors`; the
 * old previews omitted it and quoted the undiscounted station and layover bill,
 * so a hub route was forecast ~$1.5–2.5k/wk more expensive than the week that
 * followed. Headwinds' projection has the same gap.
 *
 * Same three rules as the tick: station is the mean of the per-endpoint
 * discounts, layover the best endpoint, maintenance the best factor touched.
 */
function hubCostFactorsFor(state, codes) {
  const hubs = hubsOf(state);
  const defs = codes.map((c) => {
    const t = hubs[c]?.tier;
    return t != null ? (HUB_TIERS[t] ?? null) : null;
  });
  const station = defs.reduce((s, d) => s + (d?.stationDiscount ?? 0), 0) / Math.max(1, defs.length);
  const layover = Math.max(0, ...defs.map((d) => d?.layoverDiscount ?? 0));
  const maint   = Math.min(1.0, ...defs.map((d) => d?.maintFactor ?? 1.0));
  if (station <= 0 && layover <= 0 && maint >= 1.0) return null;
  return { station: +station.toFixed(4), layover, maint };
}
