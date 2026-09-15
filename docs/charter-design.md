# Charter Contracts — Design

Status: built in Tailwinds (packages 1-5 + the reserve rescue). Headwinds port outstanding.

## Goal

A rotating board of fixed-fee flying contracts. The world posts them; the player
decides which ones to take. The fee is fixed and public — the *cost* is yours and
yours alone, so the whole skill is knowing your own airline well enough to price
the job: which tail, how far is it from the pickup, what does that airframe
actually burn, what are you giving up on the schedule, and what will fuel do
before the contract runs out.

Deliberately NOT a luck mechanic. The board is generated from the world (season,
geography, active events, your served network), and a bad outcome is always
traceable to a decision the player made — took a contract priced below their own
cost, committed a tail with no spare, or ignored the fuel curve on a 16-week term.
Same rule the event system follows: model the world, make the airline earn it.

---

## Decisions (locked)

| Decision | Choice |
|---|---|
| World flag | **None.** On for every save. Purely additive — with no contract accepted nothing in the tick moves, and the golden master staying PARITY OK proves it. `reconcileState` seeds `charters: []` / `charterReliability: 50` on load. |
| Cost quote in UI | **Direct cost for the selected tail only.** Fuel, crew, landing, handling, ferry legs, and hours against that tail's utilisation. No profit verdict, no recommendation badge. Opportunity cost, fuel drift and breach risk stay the player's judgement. |
| Gates at the far end | **Not required.** Slots are consumed only where you already hold gates; an unserved endpoint pays a one-off permit fee plus a per-departure handling surcharge, both scaled by airport tier. |
| Trap density | **~28%** of the board priced below a competent operator's cost (`CHARTER_TRAP_RATE`). |

---|---|---|
| World flag? | `charterContracts` flag like `crewPipeline`, or on for all saves | **On for all saves.** Purely additive — no accepted contract, no behaviour change. Golden master must stay PARITY OK, which proves it. |
| Cost quote in UI | Full profit estimate / direct cost only / nothing | **Direct cost only** once a tail is selected. Game does arithmetic the player is entitled to; player supplies the judgement (opportunity cost, fuel drift, breach risk). |
| Gates at the far end | Required / not required | **Not required.** Charge a one-off handling & permit fee scaled by airport tier instead. Requiring gates everywhere kills the feature's whole appeal. |
| Trap density | share of board priced below a competent operator's cost | **~25–30%.** Enough that the board must actually be read, not so much that it reads as noise. |

---

## 1. Contract types

Six shapes so the board isn't one-note, and so different fleets have different
edges. Each is a template in `src/data/charters.js` (sibling of `events.js`).

| Type | Shape | Requirement | Term | Risk |
|---|---|---|---|---|
| `adhoc_pax` | One or two round trips, named O&D | ≥N seats | 1–3 wk | Low |
| `series` | Weekly frequency on a leisure lane (tour operator / IT programme) | ≥N seats, range | 8–20 wk | Fuel exposure |
| `adhoc_freight` | Outsize / urgent freight | freighter, payload ≥ X t | 1–4 wk | Low |
| `acmi` | Wet-lease a tail to a rival: you supply aircraft + crew, **they buy the fuel** | type class, block hrs | 6–16 wk | Low risk, thin margin |
| `government` | Relief / troop / pilgrimage rotation. Awkward fields | range, `runwayFt`, seats | 4–12 wk | High fee, high cost |
| `subservice` | A rival is AOG and wants their route covered | type class, start immediately | 1–3 wk | Short, rich, expires fast |

`acmi` is the deliberate contrast to `series`: same commitment of hours, but fuel
is the customer's problem. When a fuel spike event is running, ACMI quietly
becomes the right answer — a lesson the player learns once and never forgets.

---

## 2. Where the board comes from

**Deterministic, no RNG.** `weeklyTick` contains no random draws (see the caching
note at the top of `financeProjection.js`) and nothing here may change that. Offer
generation uses the FNV-1a + finalizer hash already in the codebase
(`hash32`/`hashUnit` in `models/departureBoard.js`, same construction as
`weeklyLoadJitter`), keyed on `absWeek | slot`:

```
slotSeed   = `${airlineSeed}|charter|${absWeek}|${slot}`
template   = pick(CHARTER_TEMPLATES, hashUnit(slotSeed + '|t'), weightedBySeasonAndEvents)
endpoints  = pick from the candidate airport pool (below)
size, term, feeMargin = hashRange(slotSeed + '|…')
```

So the board survives save/load, replays identically, and a projection can never
burn a draw or predict one.

**Candidate airports** — offers arrive where you are known:
- airports you serve, plus anything within a radius of your hubs/focus cities
- your home country at a lower bar
- one "stretch" slot per board drawn from anywhere, so there is always something
  aspirational you can't quite reach yet

**Board size and quality are earned**, not rolled. Slots available =
`f(awareness, reputation.overall, charterReliability)` — the three signals already
in state plus the new one in §6. A week-one startup sees 2 thin slots; a mature
well-run carrier sees 6 and the fee margins skew better. This is the loop that
makes charters something you grow into rather than a lottery.

**Refresh** 1–2 slots per week, not the whole board. Offers carry
`postedWeek` / `expiresWeek` (2–4 weeks), so a big contract you're clearing hours
for stays put long enough to plan around.

**Season and events move the board** (`gameDate.month` + `activeEvents`):
- winter → Alpine ski series; summer → Mediterranean and island IT programmes
- pilgrimage and sports-season rotations on their calendar weeks
- `type: 'economy'` downturn → fewer slots, fee margins compressed
- `type: 'fuel'` spike → ACMI weighting up
- `type: 'disruption'` → `subservice` contracts appear (someone else's bad week)

---

## 3. Fee model — the crux

Price the fee off a **notional reference operator**, never off the player's own
fleet. That one choice is what makes fleet knowledge pay:

```
refType  = smallest catalogue type meeting the requirement (seats / payload / range)
refCost  = refFuel(dist, refType, currentFuelIndex)
         + refCrew(dist, refType)
         + refLanding(tierFrom, tierTo, flights)
         + refHandling(tonnes or pax)
fee      = round(refCost × feeMargin × weeks)
```

`feeMargin` is drawn per offer, roughly `0.92 … 1.40`, skewed by type and by the
player's `charterReliability`. A margin below ~1.0 is a contract nobody should
take — unless they happen to have an unusually efficient tail sitting idle at the
pickup airport, in which case it's free money. **That asymmetry is the game.**

The player's actual profit is then:

```
profit = fee
       − Σ weeks [ dist × fuelCostPerKm(type) × flights × fuelMultiplier × aircraft.fuelMod
                   + dist × type.crewCostPerKm × flights
                   + weeklyLandingFee(cat, flights, tierFrom, tierTo)
                   + handling ]
       − ferryCost (positioning in, and home at the end)
       − opportunity cost of the block hours          ← not shown, the player's job
```

Everything on that list except the last two lines is already computed by the
engine for scheduled routes. Charters reuse it verbatim.

**Positioning is the network-knowledge lever.** A contract out of your hub is
nearly free to start. One out of a city you don't serve costs two empty legs —
fuel, crew and block hours for zero revenue. Ferry cost IS shown as a line item
when a tail is selected (hiding it would just be tedious, not deep); what is not
shown is what those displaced hours would have earned on the schedule.

---

## 4. State + reducer

```js
state.charterOffers   // derived per-week board, or cached {absWeek, offers[]}
state.charters = [{
  id, templateId, type, origin, destination,
  aircraftId, seatsRequired | tonnesRequired,
  fee, feePerWeek, weeksTotal, weeksRemaining, startWeek,
  flightsPerWeek, distanceKm,
  ferryFrom, positioningWeeksRemaining,
  status: 'positioning' | 'active' | 'complete' | 'breached',
  breachPenalty, reputationStake,
}]
state.charterReliability  // 0–100, see §6
```

New actions: `ACCEPT_CHARTER` (aircraftId + offerId), `DISMISS_OFFER`,
`CANCEL_CHARTER` (pays `breachPenalty`, hits reliability), `REASSIGN_CHARTER`.

`ACCEPT_CHARTER` guards, mirroring `ADD_CARGO_ROUTE`:
range (`effectiveRangeKm`, per-airframe so mods count), runway, seats/payload,
block hours against `MAX_WEEKLY_BLOCK_HOURS`, `checkRouteRestrictions`, slots at
airports where you hold gates, aircraft serviceable and not retired.

### Block hours — the main integration surface

`routesCommittedTo(aircraftId, routes, cargoRoutes)` and the
`committedBlockHours*` family are called from ~10 places (every guard and every
utilisation bar). Charter hours must land in that total or the player can
double-book a tail into a breach the UI never warned about.

Two options:
1. **Fourth parameter** `charters = []` on the four helpers, updating each call
   site. Mechanical, explicit, testable.
2. Shadow route records in a `state.charterRoutes` array.

**Take option 1.** Option 2 leaks charters into demand pooling, pair-share,
encroachment and cargo lane allocation, all of which treat anything in those
arrays as a market participant. A charter is not in the market — it's a contract.

---

## 5. Execution in the tick

New `simulateCharter(contract, aircraft, gameDate, labor, fuelMultiplier)` beside
`simulateCargoRoute()`, returning `{ revenue, fuelCost, crewCost, landingFees,
handling, ferryCost, totalOpCost, profit, blockHours }`.

Per tick, for each active contract:

1. **Serviceability check.** Assigned tail AOG, in a heavy check, or crew-grounded
   (A7 severe band) → **breach**: pay `breachPenalty`, reputation hit, contract
   ends. This is the earned failure: you signed a 12-week commitment with no cover.
2. **Reserve rescue.** `applyReserveCovers()` already reconciles and dispatches
   covers by rewriting `r.aircraftId` / `coverForAircraftId` on route records.
   Extend it to take `charters` as a third list and a stationed reserve of the
   right type saves the contract. Gives the reserve system a genuine second
   reason to exist beyond schedule protection.
3. **Positioning weeks** burn ferry cost and hours, earn nothing.
4. **Active weeks** credit `feePerWeek`, debit the computed operating cost.
5. `weeksRemaining--`; at zero → `complete`, reliability up, ferry home.

Report additions: `charterResults[]`, `totalCharterRevenue`, `totalCharterCost`,
`totalCharterProfit`, `charterBlockHours`.

---

## 6. Reliability — the earned loop

`charterReliability` (0–100, starts ~50): completions raise it, breaches drop it
hard. It gates how many slots the board shows and skews `feeMargin`.

No dice anywhere in it. A carrier that delivers gets offered better work; one that
walks away from contracts gets offered scraps. Exactly the "singling out one
airline must be EARNED" rule the event system already follows.

---

## 7. Balance guardrails — measured

Charters must complement the schedule, never replace it. `tools/charter-balance-probe.mjs`
(@not-a-test) measures it rather than asserting it. Over 260 weeks of boards,
every contract flown with the metal its fee was priced against:

| | profit / block hour |
|---|---|
| Scheduled route, mature, well-priced, 95% LF | **$4.9k** |
| Charter, good offers only | $1.3k |
| Charter, signing everything on the board | $856 |
| Charter, signing only the traps | −$413 |
| The same contracts flown one size class too big | −$1.8k |

Charter work returns about **27% of a well-run mature route per block hour**, which
is the intended shape: it is worth flying on hours that would otherwise earn
nothing — spare capacity, a reserve, a season when the leisure routes are dormant —
and never worth flying instead of an airline. Reading the board rather than signing
everything is worth roughly +50%, and signing the traps loses money outright.

By type: freight and government pay best ($1.4k), series and ad-hoc passenger sit
mid-board (~$800), sub-service $649, ACMI $396.

### What the probe changed

**ACMI was mispriced, twice.** Priced off non-fuel cost it returned $253/blk hr —
thin by design (no fuel risk, no fuel margin), but close enough to pointless to be
worth checking. Pricing the reference aircraft's weekly lease into it instead — on
the theory that a wet-lease customer is buying the asset — took it to **$6.4k/blk hr,
better than a mature scheduled route**, and dragged the whole board up until even
the traps turned a profit. The fee was covering a lease the charter P&L never pays,
because the fleet loop charges it whether the jet works or not.

Reverted to the non-fuel base, with one change: **ACMI is never drawn as a trap**
(`ACMI_HAS_NO_TRAPS`). A wet lease is a rate-card arrangement between two airlines,
not a competitive tender, so a systematically underpriced one is not a realistic
failure mode. It now sits at $396/blk hr — thin, safe, always positive, and the only
charter work still paying during a fuel spike, which is when the board offers more
of it.

The trap rate is therefore measured among trap-ELIGIBLE contracts (~28%), not the
whole board (~22%), so the real figure cannot drift as ACMI's share of the board moves.

## 8. UI

New **Charters** page (nav beside Cargo), two panes:

- **Offer board** — cards per offer: type badge, O&D, requirement, term, fee,
  expiry countdown. Select a tail → direct cost breakdown incl. ferry legs, and
  the hours it will consume shown against that tail's current utilisation.
  No profit verdict. No "recommended" badge.
- **Active contracts** — weeks remaining, weekly P&L, assigned tail, and a breach
  risk flag when the tail has no same-type cover available.

Also: Weekly Debrief lines (won / completed / breached), News log entries for
large contracts, and a `charterRevenue` row in Finance beside Cargo revenue.

### On the network map (built Sep 2026, TheCookiesGuy's request)

A contract is not a route record — §4 keeps it out of `state.routes` and
`state.cargoRoutes` so demand pooling, pair-share and encroachment never see it
as a market participant. The map draws from those two arrays, so the same
decision makes contracts invisible unless they get a layer of their own:
`charterMapEntries(state.charters)` in `RouteMap.jsx`, drawn yellow
(`CHARTER_COLOR`) and dashed, with its own legend toggle beside Cargo.

- Only `active` and `positioning` contracts draw. A completed one is history; a
  breached one is not being flown.
- A positioning contract also draws its **empty leg**, dotted and faint, back to
  `positionFrom`. The ferry origin joins the airport set, so the line starts at a
  labelled station rather than running off to an unmarked point.
- Tooltip money comes from `report.charterResults` via the same `projectWeek`
  pass the rest of the screen reads — the map never re-derives a contract's week.

---

## 9. Wiring that WILL drift if forgotten

The P6 sweep exists because a revenue line was added and the forecast kept reading
the old value. Same trap here:

- `utils/financeProjection.js` — `projectWeek` must include charter revenue and
  cost, or Forecast disagrees with actuals every week a contract runs.
- `utils/pnlBridge.js` — add a charter row, or the self-checking `residual` row
  appears (which is the module working as designed, but still a bug).
- `financialHistory` — new `charterRevenue` series for Finance ▸ Statistics.
- `utils/tickPrep.js` — positioning and term countdowns belong in `prepareWeek`,
  not in `ADVANCE_WEEK`, so `projectWeek` runs the identical prep.
- `saveStore.js` / `reconcileState` — old saves need `charters: []`,
  `charterReliability: 50` seeded on load.
- `awayDigest.js` — contracts completing while away should appear in the digest.

---

## 10. Build order

1. `data/charters.js` templates + deterministic generator + `charter-offer-test.mjs`
   (proves the same `absWeek` yields the same board, and that season/event
   weighting moves it).
2. State, actions, guards, block-hour fourth parameter + `charter-guard-test.mjs`.
3. `simulateCharter` + tick integration + report lines + `charter-sim-test.mjs`.
4. Projection / pnlBridge / history / reconcile wiring + `charter-reconcile-test.mjs`.
5. UI page + Debrief + News.
6. ACMI, subservice, reliability tiering.
7. Port to Headwinds — where ACMI to a rival becomes ACMI to another *player*,
   which is a considerably more interesting object.

Golden master must stay PARITY OK throughout: with no accepted contract, nothing
in the tick may move.

## Files touched

`src/data/charters.js` (new) · `src/models/charterBoard.js` (new) ·
`src/utils/simulation.js` · `src/utils/tickPrep.js` · `src/utils/financeProjection.js` ·
`src/utils/pnlBridge.js` · `src/utils/awayDigest.js` · `src/store/GameContext.jsx` ·
`src/store/saveStore.js` · `src/components/Charters.jsx` (new) ·
`src/components/Finance.jsx` · `src/components/WeeklyDebrief.jsx` · `src/App.jsx`
