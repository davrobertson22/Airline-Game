# Market Development — Design

Status: **Package 1 (engine) built 2026-10-29, not yet merged.** It was built on
a clean copy of `ce959d3` while another session had uncommitted work in the same
files, and is held as `_stage_tmp/market-dev/market-dev.patch` (applies with
`git apply -p1`; checked clean against the working tree at 00:58). Full suite
green apart from `routes-gates-finder-lag`, which fails on the untouched
baseline too. Packages 2–4 are still proposal. See §14 for build notes.
Intended for both repos (Tailwinds first, Headwinds port in the same shape,
§12). New worlds only: behind a world flag that a new game sets and existing
saves never carry.

## Goal

Today a city pair's passenger pool is a fixed fact of geography. The gravity
model (`computeBaseCityPairDemand`, `utils/market.js`) prices every pair from
its two airports, and its memo comment is explicit that "nothing about the game
clock enters it". Seasonality, growth, events and the 16-week maturity ramp
multiply that pool, but nothing an airline *does* changes how big a market is,
apart from the same-week fare elasticity. Frequency only moves share between
carriers, and the market has no memory: the week a route closes, it is as
if it never flew.

Real markets are not like that. A new nonstop grows its city pair 20–50% over a
year or two. Sustained low fares grow a market beyond the instant elasticity
response (the long-run "low-cost carrier effect"). When service leaves, the
traffic does not vanish overnight. It drifts away to connections, other modes
and not travelling, over months.

This design gives every served market a **development level D** that the
service on it builds up, and that fades slowly when the service goes. Building a
market becomes an investment that pays back over months. Walking away from one
costs something. A rival can move into a market you developed, as in real life.

Same philosophy as the event system and the order book: **model the world, make
the airline earn it.** D is not aimed at the player. It responds to everyone's
service on the pair, the AI's included.

---

## Locked decisions (2026-10-29)

| Decision | Choice |
|---|---|
| Floor for a pair with no service | **0.70** |
| The 16-week `routeMaturityFactor` ramp | **Replaced** in flag-on worlds (see §6) |
| Which games | **Both** Tailwinds and Headwinds, **new worlds/new games only** |

---

## 1. The number

`D` is a multiplier on the gravity pool, one per **metro pair**. It is keyed on
the two metro primaries, sorted, so JFK–LHR and EWR–LGW share one value. That
matches how `baseCityPairDemand` already prices a metro pair as one market.

D = 1.0 means "served the way a typical real market is served". The gravity
model was calibrated against real O&D on markets with normal service, so D = 1.0
leaves that calibration intact. Below 1.0 is an under-served market. Above is a
market pushed by heavy frequency or sustained low fares.

`buildRouteMarket` gains D as one more factor on `adjusted`:

```
adjusted = base × seasonal × D × eventMult × growth        (flag on)
adjusted = base × seasonal × maturity × eventMult × growth (flag off, unchanged)
```

## 2. The target

Each week D moves toward a **target T**, computed from last week's service on
the pair by every carrier: the player, AI rivals and, in Headwinds, the other humans.

```
T = clamp(0.70, 1.30,  freqTerm × fareTerm)

freqTerm = (effectiveFreq / 7) ^ 0.15          (effectiveFreq = 0 → T = 0.70)
fareTerm = clamp(0.85, 1.15, (refFare / avgFareSold) ^ 0.30)
```

**effectiveFreq** is one-way weekly departures between the two metros, summed
over all carriers and all member-airport pairs:

| Service | Weight |
|---|---|
| Nonstop (any carrier, any member pair) | 1.0 |
| Through-service on a tag / multistop route (A→B→C, same aircraft) | 0.5 |
| Connecting itinerary (own-metal or rival one-stop, `RIVAL_CONN_PREFIX`) | 0.5 |

**freqTerm** reference points: 1/wk 0.75 · 3/wk 0.88 · 7/wk 1.00 · 14/wk 1.11 ·
28/wk 1.23. The exponent is deliberately low. Measured frequency elasticity of
total market size is modest, and a steep curve would make spamming departures
the dominant strategy.

**fareTerm** uses the passenger-weighted economy fare actually *sold* on the pair
last week, against the plain `referencePrice`. At 0.9× reference it gives 1.03;
at an LCC-style 0.7× it gives 1.11. This is only the slow, long-run part of fare
response. The same-week 2.2 leisure elasticity in `computeMarketShare` /
`_monopolyResult` still applies on top, unchanged. An unserved pair has no sold
fare, so fareTerm = 1.

Last week's service, not this week's: D is fixed for the whole tick, so every
caller in a week (tick, planner, finder) reads one value with no ordering
dependency. The tick's last step writes next week's D.

## 3. The movement

Asymmetric exponential approach. Markets build in about a year and fade more
slowly than they build:

```
if T > D:  D += (T − D) × 0.0341      half-life 20 weeks
else:      D += (T − D) × 0.0228      half-life 30 weeks
```

Rates are named constants (`MARKET_DEV_BUILD_HALFLIFE = 20`,
`MARKET_DEV_FADE_HALFLIFE = 30`) so they can be tuned without touching the
formula.

## 4. Worked example

A pair with a 1,000 pax/wk gravity pool, never served.

| Moment | D | Pool |
|---|---|---|
| Launch, daily at reference fare (T = 1.00) | 0.70 | 700 |
| Week 20 | 0.85 | 850 |
| Week 40 | 0.93 | 925 |
| Week 60 | 0.96 | 960 |
| Go twice daily at 0.9× reference (T = 1.11 × 1.03 ≈ 1.15) | → 1.15 | → ~1,150 |
| Exit at D = 1.10; 30 weeks later | 0.90 | 900 |
| 60 weeks after exit | 0.80 | 800 |

A rival that enters within a few months of the exit inherits most of the
developed market.

## 5. State, storage and determinism

```js
state.marketDevWorld = true          // the flag (new games only)
state.marketDev = {
  v: 1,
  pairs: { 'JFK|LHR': { d: 1.04, fare: 0.97 } },  // metro-primary key, sorted
}
```

- **Only pairs with nonstop or through-service are stored**, plus pairs still
  fading after service stopped. Once a fading pair is within 0.005 of the floor
  it is dropped. Size is bounded by served markets (the player plus ~25 AI
  networks, low thousands), not by the ~38,000 spoke pairs a big hub connects.
- **Connecting-only pairs are stateless.** A pair served only by connections
  takes `T` computed on the spot from its connecting frequency, with no memory.
  `buildOwnMetalConnections` already knows those frequencies inline, so there's
  no extra lookup, and the network tick never writes thousands of entries.
- **Unknown pair → 0.70** (no service, no memory).
- **Deterministic.** D is a pure function of the save's service history. No
  random draws, so a reloaded save replays identically.
- **Publishing.** Following the `setFareIndex` / `setEraStartYear` pattern
  (`GameContext.jsx` ~1585), the reducer publishes `state.marketDev` through a
  module-level `setMarketDev()` in `utils/market.js` on every action, and
  `marketDevFor(o, d)` reads it. Flag off → the setter receives null and
  `marketDevFor` returns exactly 1 for every pair.
- **The gravity memo is untouched.** `baseCityPairDemand` stays pure. D is
  applied at the call sites, like growth.

## 6. Replacing the maturity ramp

`routeMaturityFactor` (0.55 at launch → 1.0 at week 16) currently scales the
**whole pool**, both in `simulateRoute` (`simulation.js` ~1963) and in the lane
pre-pass (~4369), where lane maturity is the oldest tail on the pair. Two
problems if it stays alongside D:

1. On a new pair it stacks: 0.70 × 0.55 ≈ 0.39 at launch.
2. On an established pair it is already wrong. A newcomer on JFK–LHR shrinks the
   *market* for that week, when the market obviously already exists.

Flag-on worlds therefore pass `maturity = 1` to `buildRouteMarket`. In place of
the ramp there is a **per-airline awareness ramp**, same curve, that:

- **Contested pairs:** enters `computeUtility` as `log(ramp)`, in the same
  log-identity form as `brandUtil`, so a newcomer *wins share* gradually. It is
  NOT included in `offersBrandCapture`. It moves passengers between carriers,
  never out of the market.
- **Monopoly pairs:** does nothing. D's climb from the floor *is* the ramp there.
  Applying both would bring the stacking back.

Cargo keeps its own maturity rule. D is passengers only.

## 7. Every place that reads the pool

Each of these must read D (or deliberately not) so previews and the tick agree.
That disagreement is the bug class this codebase keeps paying for.

| Call site | Change |
|---|---|
| `buildRouteMarket` (`models/demand.js`) | multiply by `marketDevFor(o, d)` when the flag is on |
| `pairDemandNow` | same factor. `tools/route-finder-demand-test.mjs` keeps it pinned to `buildRouteMarket` |
| `simulateRoute`, lane pre-pass, segment path (`simulation.js` ~1964 / ~2570 / ~4370 / ~4527) | maturity → 1 when the flag is on; D arrives through `buildRouteMarket` |
| `pairShare.js` projections (~305, ~362) | same as the tick |
| `network.js` own-metal O&D (~479, ~1424) | `baseCityPairDemand × level`, where level = stored D if the pair has nonstop service, else the stateless connecting T |
| `computeCompetitorRoutePnL` (`demand.js` ~3631) | `baseD × marketDevFor(a, b)`; AI economics see the same market as the player |
| `competitorAI.js` expansion scoring (~1292) | score a candidate at the market it would **create**: `base × avg(D_now, T_at_planned_freq)`. Otherwise the AI only ever enters markets someone else developed |
| `routeFinder.js` (~199) | two figures: **Market now** (`base × D`) and **Potential** (`base × T` at daily service). "Most demand left" sorts on now |
| `utils/airportMarket.js` (generated airport columns) | unchanged. It is the static, fully developed gravity figure, so label it as such |
| `RoutePlanner` / `RouteDetail` | read through `buildRouteMarket`; the 12-month strip should show the D trajectory (§9) |

## 8. Starting a world

- **Pre-warm.** At world creation, every pair an AI starter network serves is
  set to `D = T` (its equilibrium for that service), so a new game does not open
  in a world-wide slump. Rivals that found later (custom rival sets, era
  founding years) develop their markets normally.
- **Unserved pairs** start at the 0.70 floor by default (nothing stored).
- **Randomized demand worlds** stack cleanly. The world's traffic roll scales
  the gravity base; D scales what service has made of it.
- **Era worlds** are unaffected in shape. The era index scales the base, and D sits on top.

## 9. What the player sees

- **Route Finder:** Market now / Potential columns. An under-served pair with a
  big Potential is the opportunity this feature creates.
- **Route detail:** a small "Market development" line: current D, the target
  your current service is building toward, and the arrow (growing / stable /
  fading). One sentence of explanation behind an InfoTip.
- **Route Planner:** the 12-month profit strip projects D's climb under the
  planned frequency and fare, so a slow-building route reads as an investment,
  not a mistake.
- **Closing a route:** the confirm dialog notes that the market will fade over
  the following months, and that a rival entering now inherits it.
- **Guide pages:** a section in `public/route-economics.html`; devlog entry when
  it ships.

## 10. Balance and exploits

- **Frequency spam.** Doubling frequency gains about 11% market size and costs
  the full operating bill, so spam loses money on its own terms. The 1.30 cap
  bounds the upside.
- **Pump and fade.** Flood a pair, build D, then cut back and coast on the
  memory. This is intended, and it is bounded: the fade starts immediately, at a
  30-week half-life, toward the target the *reduced* service sets, not the floor.
- **Fare dumping.** fareTerm is capped at +15% and is slow. The instant
  elasticity already punishes the revenue side.
- **Free-riding.** A rival can enter a market you built. The incumbent keeps a
  frequency, brand and awareness edge in the share fight. This is intended.
- **Total demand.** For a given seed, week-one *carried* passengers across the
  world should stay within a few percent of a flag-off world (pre-warm makes
  served pairs start at equilibrium; unserved pairs carried nothing anyway).
- **Events cap.** D is structural, not an event. It sits outside `clampImpact`'s
  ±30% combined cap and has its own [0.70, 1.30] bounds, so the year-3 event
  difficulty fix is untouched.
- **Hub strategies.** Connecting-only O&D sits below today's level (daily on both
  legs → effective 3.5/wk → 0.90). That is a deliberate nudge toward nonstop
  service on big pairs, and the main balance number to watch in playtesting.

## 11. Packages

1. **Engine.** Flag, state, `setMarketDev` / `marketDevFor`, the target and the
   update step at the end of the weekly tick, `buildRouteMarket` /
   `pairDemandNow` / competitor P&L / network O&D reading it, pre-warm, the
   maturity swap with the awareness utility term. New-game setup sets the flag.
2. **AI.** Expansion scoring at the market it would create. Route cutting
   aware that closing fades the market rather than zeroing it.
3. **UI.** Finder columns, route-detail line, planner trajectory, close-route
   note, guide section, devlog.
4. **Headwinds port** (§12).

Tests (new `tools/market-dev-test.mjs` plus touches to existing suites):

- Flag off: every pool byte-identical to today (parity).
- Daily nonstop at reference fare settles at D = 1.00 ± 0.01.
- Half-lives: 20 weeks building, 30 fading, within one week.
- Unserved pair = 0.70; connecting-only pair = stateless T, nothing stored.
- Metro members share one D (JFK–LHR === EWR–LGW).
- Save → reload replays identical D for 52 weeks.
- `pairDemandNow` === `buildRouteMarket` pool with D on (existing pin, extended).
- Week-one carried passengers within ±3% of flag-off for a fixed seed.
- Contested launch: awareness ramp moves share, not pool. Monopoly launch: no
  ramp, only D.

## 12. Headwinds

Same model, same constants, `packages/engine/src`. Gate: new worlds only, the
same flag. D lives in the shared world state and is updated in the server tick
from every human and AI carrier on the pair. A market one player builds is
there for the others, which suits Headwinds' shared-demand contest. The
awareness ramp is per airline as in Tailwinds.

## 13. Open items (tuning, not design)

- Weight of through-service and connections (0.5 each).
- The fareTerm exponent (0.30) and its ±15% cap.
- Whether the AI should ever deliberately *develop* a market (open thin and
  grow frequency), or only score candidates at their created market.

## 14. Build notes (package 1)

**What shipped in the patch**

- `src/models/marketDev.js`: constants, key, target, step, service
  collection, `advanceMarketDev`, `prewarmMarketDev`, `cleanMarketDev`, and the
  module-level `setMarketDev` / `marketDevFor` / `marketDevForOD`.
- `buildRouteMarket` and `pairDemandNow` multiply by D. In a flagged world the
  maturity argument no longer shrinks the pool; it rides on the market as
  `awareness`, and the contested share fight adds `log(awareness)` to the
  player's offers only (not in `offersBrandCapture`). Monopoly ignores it.
- `computeCompetitorRoutePnL` and both own-metal O&D sites in `network.js`
  read the developed market. The AI expansion score uses
  `base × avg(D_now, max(D_now, target at daily))`.
- Published in the reducer (every action), the provider's initial render,
  `reconcileState` (load), the top of `weeklyTick`, and the finder worker.
- `START_GAME` sets `marketDevWorld` and pre-warms the starting field unless
  `marketDev: false`. The setup screen has a "Market development" switch,
  default on. `ADVANCE_WEEK` writes next week's table from the week-start
  routes and rival networks.
- Tests: `tools/market-dev-test.mjs` (22 cases). `route-projection-test` and
  `projection-tick-agreement-test` now start classic worlds, because their
  fixtures pin the 16-week ramp and a classic-calibrated slump.

**Deviations from the text above**

- The fare term uses a frequency-weighted fare ratio (player: the pair's
  economy fare ÷ reference; AI: `priceMultiplier`), not a passenger-weighted
  sold fare. Same intent, no dependency on tick results.
- Stored pairs count nonstop plus through-service only. Rival one-stops and
  own-metal connections do not yet add to a stored pair's target. They only
  set the stateless connecting level for O&D without nonstop service.

**Finding: pre-warm lifts served markets about 10%.** Across three fresh
worlds the starting field serves 140–153 pairs. Median D is 1.05, the 90th
percentile is 1.28, and D weighted by demand is **1.10**. The big trunks carry
21+ AI departures a week and budget fares (0.76× → fareTerm 1.09). So the
design's "week one within ±3% of classic" does not hold. Served markets open
about 10% bigger. This arguably moves toward reality, because the gravity
calibration undershoots heavily served trunks (JFK–LAX 16.6k vs real 23k,
JFK–LHR 15.4k vs 21k) and overshoots thin pairs (SIN–LHR, DAC–DEL). But it is a
balance shift. If it should be neutral instead, the cleanest lever is
`MARKET_DEV_REF_FREQ` ≈ 13, so the starting field averages 1.0. A per-world
normaliser would also work, but it would move the locked 0.70 floor.
