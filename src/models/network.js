/**
 * network.js — O&D routing, cannibalization detection, and partner revenue model
 *
 * CORE CONCEPTS
 * ─────────────
 * 1. NetworkGraph       — adjacency index of player + partner routes keyed by airport
 * 2. Connection         — a (A→hub→C) itinerary sharing a hub airport
 * 3. Diversion          — when a direct A→C exists, demand shifts away from A→hub→C
 * 4. CannibalizationMap — per-routeKey multiplier on connecting demand (0–1)
 * 5. PartnerODRevenue   — actual O&D revenue from player+partner leg combos,
 *                         replacing the old flat interline rate model
 *
 * CANNIBALIZATION MECHANIC
 * ─────────────────────────
 * For each hub airport H the player operates, we look at every (A→H, H→C) pairing
 * (one or both legs may be partner metal). If the player also flies A→C direct, a
 * logit utility model splits the A→C demand pool between the direct and the connecting
 * option. The connection's share is returned as a multiplier applied to that route's
 * connecting demand in simulation.js.
 *
 * PARTNER REVENUE
 * ────────────────
 * For connections where one leg is a partner's (alliance or codeshare), the player
 * earns a prorate fraction of the ticket price proportional to the mileage they fly.
 * This replaces the old flat INTERLINE_RATE_BY_TIER model with something that scales
 * with the actual network.
 *
 * RELATIONSHIP HEALTH
 * ────────────────────
 * Each week, if the player operates a direct route that competes with a Joint Venture
 * partner's connecting traffic, the partnership health decays. This creates a real
 * trade-off between launching profitable direct routes and preserving alliance revenue.
 */

import { baseCityPairDemand, routeDistance, referencePrice } from '../utils/market.js';

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Utility penalty applied to a connecting itinerary vs a direct flight.
 * Higher value = passengers strongly prefer direct; connection loses more demand.
 * Scaled by partnership type: own metal is least punishing, bare interline most.
 */
export const CONNECTION_PENALTY = {
  ownMetal:      0.30,   // both legs on player aircraft — lounge, bag transfer, seamless
  jointVenture:  0.38,   // JV: coordinated schedules, shared revenue pool
  alliance:      0.50,   // alliance: coordinated but separate revenue
  codeshare:     0.60,   // codeshare: one ticket, different metal
  interline:     0.75,   // basic interline: separate tickets, minimal cooperation
};

/**
 * Prorate fraction the player earns on their leg of a codeshare/alliance itinerary.
 * These supplement the mileage-based prorate with a minimum floor.
 * (Actual prorate = max(mileage_fraction, floor below))
 */
export const PRORATE_FLOOR = {
  jointVenture:  0.50,   // revenue pooled — effective 50% on both legs
  alliance:      0.42,
  codeshare:     0.48,
  interline:     0.38,
};

/** Maximum connection layover for a valid itinerary (minutes). */
const MAX_LAYOVER_MINUTES  = 4 * 60;

/** Minimum connection time (minutes) — below this the connection is impossible. */
const MIN_LAYOVER_MINUTES  = 45;

/** Weekly demand ceiling beyond which we stop enumerating O&D pairs (performance). */
const MIN_OD_DEMAND_PAX    = 5;

/** Utility weight: how much price matters in the direct vs connect choice. */
const PRICE_WEIGHT         = 1.2;

/** Utility weight: how much frequency matters (log scale). */
const FREQ_WEIGHT          = 0.35;

// ─── Types (JSDoc) ────────────────────────────────────────────────────────────

/**
 * @typedef {object} NetworkRoute
 * A normalised route, covering both player and partner entries.
 * @property {string}  origin
 * @property {string}  destination
 * @property {string}  routeKey           - alphabetically sorted 'A-B'
 * @property {number}  weeklyFrequency    - one-way flights per week
 * @property {number}  price              - economy price ($), estimated for partner routes
 * @property {'player'|'partner'} owner
 * @property {string}  [partnerId]        - competitor id if owner === 'partner'
 * @property {string}  [partnershipType]  - 'jointVenture'|'alliance'|'codeshare'|'interline'
 */

/**
 * @typedef {object} Connection
 * A 1-stop itinerary through a hub airport.
 * @property {string}  hub
 * @property {string}  legOneOrigin       - O of leg 1
 * @property {string}  legOneDest         - hub
 * @property {string}  legTwoDest         - C (final destination)
 * @property {'player'|'partner'} leg1Owner
 * @property {'player'|'partner'} leg2Owner
 * @property {string}  [leg1PartnerId]
 * @property {string}  [leg2PartnerId]
 * @property {string}  partnershipType    - best applicable type for utility penalty
 * @property {number}  leg1Freq
 * @property {number}  leg2Freq
 * @property {number}  leg1Price
 * @property {number}  leg2Price
 * @property {number}  totalPrice         - combined fare estimate
 * @property {number}  odDemand           - gravity-model demand for origin→finalDest
 * @property {boolean} directExists       - does the player operate a direct on this O&D?
 * @property {number}  connectionShare    - 0–1 logit share that stays on the connection
 * @property {number}  directShare        - 1 - connectionShare
 */

/**
 * @typedef {object} CannibalizationMap
 * Maps routeKey → multiplier (0–1) to apply to that route's connecting demand.
 * A route can be a connecting leg in multiple O&D pairs, so multipliers compound.
 */

/**
 * @typedef {object} PartnerODEntry
 * Revenue earned by the player from one partner-leg O&D connection.
 * @property {string}  odKey              - 'origin-destination' sorted
 * @property {string}  hub
 * @property {string}  partnerLeg         - 'leg1'|'leg2' — which leg is partner metal
 * @property {number}  pax                - estimated connecting passengers
 * @property {number}  playerRevenue      - prorate revenue for the player's leg ($)
 * @property {number}  playerLegMileage
 * @property {number}  totalMileage
 * @property {string}  partnershipType
 */

// ─── Graph construction ───────────────────────────────────────────────────────

/**
 * Build an airport-keyed adjacency index from player routes + partner routes.
 *
 * @param {Array}  playerRoutes      - game state routes (each has origin, destination, weeklyFrequency, ticketPrice)
 * @param {Array}  partnerRoutes     - partner NetworkRoute entries (built by buildPartnerRoutes)
 * @returns {Map<string, NetworkRoute[]>}  airport → all NetworkRoutes that touch it
 */
function buildAdjacencyIndex(playerRoutes, partnerRoutes) {
  const index = new Map();

  const addToIndex = (airport, route) => {
    if (!index.has(airport)) index.set(airport, []);
    index.get(airport).push(route);
  };

  for (const r of playerRoutes) {
    const nr = {
      origin:          r.origin,
      destination:     r.destination,
      routeKey:        [r.origin, r.destination].sort().join('-'),
      weeklyFrequency: r.weeklyFrequency ?? 7,
      price:           r.ticketPrice ?? referencePrice(r.origin, r.destination),
      owner:           'player',
    };
    addToIndex(r.origin,      nr);
    addToIndex(r.destination, nr);
  }

  for (const r of partnerRoutes) {
    addToIndex(r.origin,      r);
    addToIndex(r.destination, r);
  }

  return index;
}

/**
 * Convert competitor route data + partnership context into NetworkRoute objects.
 *
 * @param {Array}  competitors        - state.competitors
 * @param {object} partnershipMap     - { [competitorId]: 'jointVenture'|'alliance'|'codeshare'|'interline' }
 * @returns {NetworkRoute[]}
 */
export function buildPartnerRoutes(competitors, partnershipMap) {
  const routes = [];
  for (const comp of competitors) {
    const pType = partnershipMap[comp.id];
    if (!pType) continue;  // not a partner — skip

    for (const [routeKey, cfg] of Object.entries(comp.routes)) {
      const [a, b] = routeKey.split('-');
      const refP   = referencePrice(a, b) ?? 300;
      const price  = Math.round(refP * (cfg.priceMultiplier ?? 1.0));

      // Forward direction
      routes.push({
        origin:          a,
        destination:     b,
        routeKey,
        weeklyFrequency: cfg.frequency ?? 7,
        price,
        owner:           'partner',
        partnerId:       comp.id,
        partnershipType: pType,
      });
      // Reverse direction (bidirectional service)
      routes.push({
        origin:          b,
        destination:     a,
        routeKey,
        weeklyFrequency: cfg.frequency ?? 7,
        price,
        owner:           'partner',
        partnerId:       comp.id,
        partnershipType: pType,
      });
    }
  }
  return routes;
}

/**
 * Build a Map<competitorId, partnershipType> from game state.
 * Codeshare agreements take precedence over alliance membership for tier.
 * If a competitor is in a JV (joint venture) agreement, mark them specially.
 *
 * @param {object|null} allianceMembership   - state.allianceMembership
 * @param {Array}       codeshareAgreements  - state.codeshareAgreements
 * @param {object|null} allianceDef          - ALLIANCES entry or null
 * @param {object}      [jvRoutes]           - { [competitorId]: true } for JV partners
 * @returns {Map<string, string>}
 */
export function buildPartnershipMap(allianceMembership, codeshareAgreements, allianceDef, jvRoutes = {}) {
  const map = new Map();

  // Alliance members (weaker than codeshare)
  if (allianceDef) {
    for (const id of (allianceDef.memberIds ?? [])) {
      map.set(id, 'alliance');
    }
  }

  // Codeshare agreements override alliance (stronger cooperation)
  for (const ag of (codeshareAgreements ?? [])) {
    map.set(ag.competitorId, 'codeshare');
  }

  // Joint venture overrides everything (strongest)
  for (const id of Object.keys(jvRoutes)) {
    if (jvRoutes[id]) map.set(id, 'jointVenture');
  }

  return map;
}

// ─── Connection enumeration ───────────────────────────────────────────────────

/**
 * Find all valid 1-stop connections through a hub airport.
 * A connection is valid when:
 *   - The player has AT LEAST ONE of the two legs (own metal or meaningful partner)
 *   - The O&D demand is above the minimum threshold
 *
 * @param {string}                hub
 * @param {Map}                   adjacencyIndex    - from buildAdjacencyIndex
 * @param {Set<string>}           playerRouteKeys   - set of route keys the player operates
 * @param {Set<string>}           directRouteKeys   - same set (for checking if direct exists)
 * @returns {Connection[]}
 */
function findConnectionsAtHub(hub, adjacencyIndex, playerRouteKeys, directRouteKeys) {
  const touchingRoutes = adjacencyIndex.get(hub) ?? [];

  // Split into routes that arrive at hub (i.e., destination === hub)
  // and routes that depart from hub (i.e., origin === hub)
  const inbound  = touchingRoutes.filter(r => r.destination === hub);
  const outbound = touchingRoutes.filter(r => r.origin      === hub);

  const connections = [];

  for (const leg1 of inbound) {
    for (const leg2 of outbound) {
      const origin = leg1.origin;
      const dest   = leg2.destination;

      // Skip trivial (same O&D as the legs themselves)
      if (origin === dest) continue;

      // Require player to own at least one leg (otherwise irrelevant)
      if (leg1.owner !== 'player' && leg2.owner !== 'player') continue;

      // O&D demand check
      const odDemand = baseCityPairDemand(origin, dest);
      if (!odDemand || odDemand < MIN_OD_DEMAND_PAX) continue;

      // Determine best partnership type for penalty
      // If both legs are player metal → ownMetal
      // If one is partner → use the partner leg's type
      let partnershipType;
      if (leg1.owner === 'player' && leg2.owner === 'player') {
        partnershipType = 'ownMetal';
      } else {
        const partnerLeg = leg1.owner === 'partner' ? leg1 : leg2;
        partnershipType  = partnerLeg.partnershipType ?? 'interline';
      }

      const directKey    = [origin, dest].sort().join('-');
      const directExists = directRouteKeys.has(directKey);

      const totalPrice   = leg1.price + leg2.price;
      const refP         = referencePrice(origin, dest) ?? totalPrice;
      const minFreq      = Math.min(leg1.weeklyFrequency, leg2.weeklyFrequency);

      // Logit utility for connection vs direct
      const penalty        = CONNECTION_PENALTY[partnershipType] ?? CONNECTION_PENALTY.interline;
      const connectUtil    = -penalty
                             - PRICE_WEIGHT * (totalPrice / Math.max(refP, 1))
                             + FREQ_WEIGHT  * Math.log1p(minFreq);

      let connectionShare = 1.0;
      let directShare     = 0.0;

      if (directExists) {
        // Direct route utility (we don't have its exact price here, so use refPrice as proxy)
        const directUtil = -PRICE_WEIGHT * 1.0   // price at reference = normalised 1.0
                           + FREQ_WEIGHT * Math.log1p(7); // assume baseline 7 freq
        const expConn   = Math.exp(connectUtil - Math.max(connectUtil, directUtil));
        const expDirect = Math.exp(directUtil  - Math.max(connectUtil, directUtil));
        const total     = expConn + expDirect;
        connectionShare = expConn   / total;
        directShare     = expDirect / total;
      }

      connections.push({
        hub,
        legOneOrigin:    origin,
        legOneDest:      hub,
        legTwoDest:      dest,
        leg1Owner:       leg1.owner,
        leg2Owner:       leg2.owner,
        leg1PartnerId:   leg1.partnerId,
        leg2PartnerId:   leg2.partnerId,
        partnershipType,
        leg1Freq:        leg1.weeklyFrequency,
        leg2Freq:        leg2.weeklyFrequency,
        leg1Price:       leg1.price,
        leg2Price:       leg2.price,
        totalPrice,
        odDemand,
        directExists,
        connectionShare,
        directShare,
      });
    }
  }

  return connections;
}

// ─── Primary exports ──────────────────────────────────────────────────────────

/**
 * Compute the full set of 1-stop connections in the player's network,
 * including partner route pairings.
 *
 * Returns all Connection objects for inspection / UI display.
 *
 * @param {Array}   playerRoutes       - state.routes
 * @param {Array}   competitors        - state.competitors
 * @param {Map}     partnershipMap     - from buildPartnershipMap
 * @returns {Connection[]}
 */
export function buildAllConnections(playerRoutes, competitors, partnershipMap) {
  const partnerRoutes    = buildPartnerRoutes(competitors, Object.fromEntries(partnershipMap));
  const playerRouteKeys  = new Set(playerRoutes.map(r => [r.origin, r.destination].sort().join('-')));
  const adjacencyIndex   = buildAdjacencyIndex(playerRoutes, partnerRoutes);

  // Hub airports = all airports where the player has ≥2 routes
  const hubCandidates = new Set();
  for (const r of playerRoutes) {
    hubCandidates.add(r.origin);
    hubCandidates.add(r.destination);
  }

  const allConnections = [];
  for (const hub of hubCandidates) {
    const conns = findConnectionsAtHub(hub, adjacencyIndex, playerRouteKeys, playerRouteKeys);
    allConnections.push(...conns);
  }

  return allConnections;
}

/**
 * Build a CannibalizationMap: for each player route, what fraction of its
 * connecting demand survives after the direct routes steal their share?
 *
 * A route may appear as leg 1 in multiple connections — the factors compound
 * multiplicatively (each direct route independently siphons a portion).
 * We cap compounding so a single route can't be reduced below 20% of connecting demand.
 *
 * @param {Connection[]} connections   - from buildAllConnections
 * @returns {Object}  { [routeKey]: number }  0.2–1.0
 */
export function buildCannibalizationMap(connections) {
  const factors = {};   // routeKey → accumulated factor

  for (const conn of connections) {
    if (!conn.directExists) continue;  // no direct competitor — no cannibalization

    const leg1Key = [conn.legOneOrigin, conn.legOneDest].sort().join('-');
    const leg2Key = [conn.legOneDest,   conn.legTwoDest].sort().join('-');
    const share   = conn.connectionShare;  // fraction that stays on the connection

    // Multiply into each leg's factor (compound across multiple competing directs)
    factors[leg1Key] = (factors[leg1Key] ?? 1.0) * share;
    factors[leg2Key] = (factors[leg2Key] ?? 1.0) * share;
  }

  // Enforce floor of 0.20 so a route always keeps at least 20% of connecting pax
  for (const key of Object.keys(factors)) {
    factors[key] = Math.max(0.20, factors[key]);
  }

  return factors;
}

/**
 * Compute partner O&D revenue: the player's prorate share from connections
 * where one leg is partner metal.
 *
 * @param {Connection[]}  connections
 * @param {number}        [assumedLoadFactor=0.72]
 * @returns {{ totalRevenue: number, entries: PartnerODEntry[] }}
 */
export function computePartnerODRevenue(connections, assumedLoadFactor = 0.72) {
  const entries = [];
  let totalRevenue = 0;

  for (const conn of connections) {
    // Only relevant when exactly one leg is partner metal
    const mixedLegs = (conn.leg1Owner === 'player') !== (conn.leg2Owner === 'player');
    if (!mixedLegs) continue;

    const origin  = conn.legOneOrigin;
    const hub     = conn.hub;
    const dest    = conn.legTwoDest;

    const pax          = Math.round(conn.odDemand * conn.connectionShare * assumedLoadFactor);
    if (pax <= 0) continue;

    const playerLeg    = conn.leg1Owner === 'player' ? 'leg1' : 'leg2';
    const playerOrigin = playerLeg === 'leg1' ? origin : hub;
    const playerDest   = playerLeg === 'leg1' ? hub    : dest;
    const partnerType  = conn.partnershipType;

    const playerMiles  = routeDistance(playerOrigin, playerDest);
    const totalMiles   = routeDistance(origin, dest);

    if (!playerMiles || !totalMiles) continue;

    // Prorate: mileage fraction, subject to floor
    const mileageProrate = playerMiles / totalMiles;
    const floorProrate   = PRORATE_FLOOR[partnerType] ?? PRORATE_FLOOR.interline;
    const prorate        = Math.max(mileageProrate, floorProrate);

    const ticketPrice    = conn.totalPrice;
    const playerRevenue  = Math.round(pax * ticketPrice * prorate);

    totalRevenue += playerRevenue;
    entries.push({
      odKey:             [origin, dest].sort().join('-'),
      hub,
      partnerLeg:        playerLeg === 'leg1' ? 'leg2' : 'leg1',
      pax,
      playerRevenue,
      playerLegMileage:  Math.round(playerMiles),
      totalMileage:      Math.round(totalMiles),
      partnershipType:   partnerType,
    });
  }

  return { totalRevenue, entries };
}

/**
 * Compute how much partnership health decay to apply this week.
 * Decay fires when the player operates a direct route that competes with a
 * joint-venture partner's connecting traffic.
 *
 * @param {Connection[]}  connections
 * @param {Map}           partnershipMap   - { competitorId → type }
 * @returns {{ [competitorId]: number }}  health points to subtract (0–10 per route)
 */
export function computePartnerHealthDecay(connections, partnershipMap) {
  const decay = {};

  for (const conn of connections) {
    if (!conn.directExists) continue;

    // Only matters when a partner is involved
    const partnerIds = [conn.leg1PartnerId, conn.leg2PartnerId].filter(Boolean);
    if (partnerIds.length === 0) continue;

    for (const pid of partnerIds) {
      const pType = partnershipMap.get(pid);
      if (!pType) continue;

      // Stronger partnerships feel more betrayed by a competing direct
      const decayPerRoute = {
        jointVenture: 8,   // JV partners lose serious trust
        codeshare:    4,
        alliance:     2,
        interline:    1,
      }[pType] ?? 1;

      // Scale by how much demand the direct actually siphons
      const siphonedFraction = conn.directShare;
      const effectiveDecay   = Math.round(decayPerRoute * siphonedFraction);

      decay[pid] = (decay[pid] ?? 0) + effectiveDecay;
    }
  }

  return decay;
}

// ─── Preview helper (for RoutePlanner UI) ────────────────────────────────────

/**
 * getCannibalizationPreview
 *
 * Call this BEFORE the player commits to launching a new direct route.
 * Returns a summary of which existing connections would be affected, how much
 * connecting pax would shift to the direct, and the estimated revenue impact.
 *
 * @param {object}  prospectiveRoute   - { origin, destination, ticketPrice?, weeklyFrequency? }
 * @param {Array}   playerRoutes       - current state.routes
 * @param {Array}   competitors        - state.competitors
 * @param {Map}     partnershipMap     - from buildPartnershipMap
 * @returns {{
 *   affectedConnections: Connection[],
 *   totalStealPax:       number,
 *   totalStealRevenue:   number,
 *   partnerRisk:         { competitorId: string, type: string, decayPoints: number }[],
 *   summary:             string,
 * }}
 */
export function getCannibalizationPreview(
  prospectiveRoute,
  playerRoutes,
  competitors,
  partnershipMap
) {
  const { origin, destination } = prospectiveRoute;
  const directKey = [origin, destination].sort().join('-');

  // Temporarily add the prospective route to the player network
  const augmentedRoutes = [
    ...playerRoutes,
    {
      origin,
      destination,
      weeklyFrequency: prospectiveRoute.weeklyFrequency ?? 7,
      ticketPrice:     prospectiveRoute.ticketPrice ?? referencePrice(origin, destination),
    },
  ];

  // Build connections with the new route included
  const connections    = buildAllConnections(augmentedRoutes, competitors, partnershipMap);

  // Filter to only connections that are affected by THIS new direct route
  const affected = connections.filter(
    c => c.directExists && [c.legOneOrigin, c.legTwoDest].sort().join('-') === directKey
  );

  const LOAD_FACTOR = 0.72;
  let totalStealPax     = 0;
  let totalStealRevenue = 0;

  for (const c of affected) {
    const stolenPax = Math.round(c.odDemand * c.directShare * LOAD_FACTOR);
    const price     = prospectiveRoute.ticketPrice ?? referencePrice(origin, destination) ?? c.totalPrice;
    totalStealPax     += stolenPax;
    totalStealRevenue += stolenPax * price;
  }

  // Partner risk
  const partnerRisk = [];
  const decayMap    = computePartnerHealthDecay(affected, partnershipMap);
  for (const [pid, pts] of Object.entries(decayMap)) {
    const pType = partnershipMap.get(pid);
    partnerRisk.push({ competitorId: pid, type: pType, decayPoints: pts });
  }

  // Human-readable summary
  const hasPartnerRisk = partnerRisk.length > 0;
  const summary = affected.length === 0
    ? 'No existing connections compete with this route.'
    : `This route competes with ${affected.length} connection(s) through your hubs, `
      + `diverting ~${totalStealPax} pax/week to the direct. `
      + (hasPartnerRisk
        ? `⚠️ Strains relationship with ${partnerRisk.map(r => r.competitorId).join(', ')}.`
        : 'No partner relationships affected.');

  return {
    affectedConnections: affected,
    totalStealPax,
    totalStealRevenue,
    partnerRisk,
    summary,
  };
}

// ─── Convenience: run all network calculations for a weekly tick ──────────────

/**
 * runNetworkTick
 *
 * Single entry point called by simulation.js once per ADVANCE_WEEK.
 * Returns everything the simulation needs to:
 *   1. Apply cannibalization to connecting demand (cannibalizationMap)
 *   2. Add partner O&D revenue (partnerODRevenue)
 *   3. Decay partnership health (partnerHealthDecay)
 *
 * @param {object}  state   - subset: { routes, competitors, allianceMembership,
 *                                      codeshareAgreements, allianceDef, jointVentures }
 * @returns {{
 *   connections:        Connection[],
 *   cannibalizationMap: object,
 *   partnerODRevenue:   { totalRevenue: number, entries: PartnerODEntry[] },
 *   partnerHealthDecay: object,
 * }}
 */
export function runNetworkTick(state) {
  const {
    routes               = [],
    competitors          = [],
    allianceMembership   = null,
    codeshareAgreements  = [],
    allianceDef          = null,
    jointVentures        = {},
  } = state;

  const partnershipMap = buildPartnershipMap(
    allianceMembership,
    codeshareAgreements,
    allianceDef,
    jointVentures,
  );

  const connections        = buildAllConnections(routes, competitors, partnershipMap);
  const cannibalizationMap = buildCannibalizationMap(connections);
  const partnerODRevenue   = computePartnerODRevenue(connections);
  const partnerHealthDecay = computePartnerHealthDecay(connections, partnershipMap);

  return {
    connections,
    cannibalizationMap,
    partnerODRevenue,
    partnerHealthDecay,
  };
}
