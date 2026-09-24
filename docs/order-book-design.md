# Aircraft Order Book — Design

Status: **Package 1 (pre-delivery payments) built in Tailwinds, 2026-09-21** —
behind the `orderBook` flag, which new games do NOT yet set: it switches on
together with Package 2. Everything else is proposal. Intended for both repos (Tailwinds first,
Headwinds port in the same shape — see §13).

## Goal

Today acquisition is a vending machine: pick a type, pay the whole price, and the
frames arrive on a metronome 1–4 weeks apart forever. Nothing is scarce, nothing
is committed, and nobody else is buying.

Replace that with an **order book**: every production line has a rate and a
backlog, ordering consumes *delivery slots* from that line's forward schedule,
and the money falls due over the build rather than in one lump at signing. The
result is the actual airline-management problem — committing cash and capacity
years ahead of the demand you think you'll have — instead of a shopping trip.

Same philosophy the event system follows: **model the world, make the airline
earn it.** A backlog is not a dice roll aimed at the player. The line is full
because the world is buying, and it is full for everyone. A player who is late
to a type is late because they hesitated, not because something rolled against
them.

---

## What is wrong today

| | Today | Why it matters |
|---|---|---|
| Lead time | `DELIVERY_LEAD` = 1–4 wk by category, ×2 for the first frame, then +lead each | No planning horizon. Fleet decisions are reversible inside a month. |
| Supply | Infinite | The catalogue is a shop, not a market. |
| Cash | 100% at order (`ORDER_AIRCRAFT`) | No forward commitment, so no cash-flow risk in fleet planning. |
| Discount | Public ladder, 20% off at 100 frames (`orderDiscount`) | "Order a hundred" is strictly optimal today with no downside. A live exploit. |
| Used metal | A property of a *type* (`deliveredAgeWeeks`, vintage rule) | Elegant, but there is no board of specific airframes to grab when you need metal this month. |

---

## Decisions (locked)

| Decision | Choice |
|---|---|
| World flag | **`orderBook`**, same shape as `crewPipeline`. ON by default for newly created worlds, ABSENT on existing saves — they keep the classic vending machine forever. `reconcileState` must not retrofit it. |
| Package 1 is a prerequisite | Pre-delivery payments ship **before or with** slots, never after. Slots without staged payments are cheap to hold, and cheap-to-hold slots are the hoarding problem. |
| Backlog is a world constraint | Generated from world demand, never from "the player is winning". No rubber-banding, no per-airline targeting. |
| Determinism | No RNG. FNV-1a `hash32` keyed on `absWeek`, exactly as `charterBoard.js` does. With the flag off a scripted game must be byte-identical to HEAD (the old `tools/golden-master/` harness was removed; see §13 for the parity check that replaces it). |
| Delivery balance | **Always cash** (Dave, 2026-09-21). Charged on the delivery week whether or not the bank can cover it; a shortfall takes cash negative and the existing negative-cash rules (warnings, 6 weeks to bankruptcy) apply. No forfeiture, no auto-financing — a player finances a delivery by taking an aircraft loan against it. |
| Signing requirement | **Deposit + every pre-delivery instalment** (Dave, 2026-09-21) — this order's AND the unpaid instalments already on the book, so one pile of cash cannot back two orders. The balance is not part of it. |
| Rollout | Package 1 ships dark. `START_GAME` does not set `orderBook` until Package 2 lands, so the flag means one thing from the first world that has it and no world is upgraded mid-game. |
| Lead time | **Compressed. Hard cap 52 wk.** Real lead times of 2–5 years (100–260 wk) outrun a lot of Tailwinds games — a backlog longer than the session is just a locked door. Typical quotes land 8–40 wk out; a fully committed line can never quote past 52. Realism yields to session length here, deliberately. |
| AI competitors | **They buy through the order book.** No exemption — the AI queues for slots on the same lines, under the same caps. `competitorAI.js` stops spawning tails via `makeCompetitorTail` for growth and must cope with being slot-starved (grow slower, or go to the used board). Its orders are hash-derived, so the book stays deterministic. |
| Allocation caps | **Both.** A per-line cap (~30% of rolling 52-wk output) *and* a looser per-manufacturer ceiling (~45%). Per-line alone lets an airline corner every Boeing narrowbody while sitting under 30% on each one. |
| Acquisition | **The order book transfers with the airline.** Buying a carrier buys its delivery positions. Guard so this is not a way round the caps: a combined book over either cap is never confiscated, but it is **frozen** — no new orders or options on an over-cap line or manufacturer until deliveries bring the book back under. |
| Lockout | **Structurally impossible.** The lessor reserve pool (§8) is not purchasable by direct order at any price. Guaranteed by test, not by hope (§13). |

---

## Open questions

| Question | Options | Lean |
|---|---|---|
| Line-rate authoring | Hand-author 197 types vs derive from category + maturity | **Derive**, with a ~20-entry override table for the famous lines. |
| Used board in Tailwinds | Sourced from competitor retirements only, or also synthesised | Both. Competitor retirements alone are too thin early. |
| Options (package 3) | Ship with slots or defer | Defer one package. Slots are legible on their own; options are the depth layer. |
| Cargo/freighter lines | Share the pax order book or run separately | Separately — conversion lines behave differently (see `eraDeliveredAgeWeeks`, freighter branch). |
| Era worlds vs the 52-wk cap | Same cap everywhere / scale with the orderable catalogue | 52 weeks in 1962, with 6 new-build mainline narrowbodies on the market, bites far harder than 52 weeks in 2026 with 14. Follows directly from the locked lead-time decision. |
| Lease buyout on reserve-pool metal | See §8.6 — replacement ordering, cap-routed, minimum term | Proposal written up in §8.6. Awaiting a call on whether to take all three layers or just the replacement rule. |
| Line-book persistence | Store `committed[]` / derive world demand from the hash and store only real allocations | Lean: derive. 197 lines × hundreds of weeks is real save weight (see `save-storage-indexeddb-plan.md`), and the world's half of the book is deterministic anyway. |
| UI home | Third Marketplace tab / inside the browse table / both | Scope-defining. Lean: an earliest-slot column in browse (cheap, always visible) plus a line-detail panel on the checkout. |
| Backlog visibility | Whole world's book / only lines you've engaged with | In Headwinds, seeing who holds slots is genuine intel and a counterplay lever. Lean: aggregate committed share public, holder identity hidden outside your alliance. |

---

## 1. The model

Three new objects. All derived, none hand-authored per type except the override
table.

**Line** — one per aircraft type, not per family. Lives in a new
`src/models/orderBook.js`.

```
line = {
  typeId,
  rate,              // frames per week the factory produces
  committed[],       // slot index -> owner (airlineId | 'world' | 'lessor' | null)
  openedWeek,        // absolute week the line started delivering (from eis)
}
```

**Slot** — a delivery position. Identified by `(typeId, absWeek, index)`. A line
running at 1.6/wk yields ~1–2 slots per week; ordering N frames takes the next N
unallocated slots and the order's `deliverAbsWeek` comes from the slot, not from
`DELIVERY_LEAD`.

**Rate derivation** — `lineRate(type, calYear, worldScale)`:

```
base       = { Turboprop: 1.2, 'Regional Jet': 1.0, 'Narrow Body': 1.6,
               'Wide Body': 0.5, 'Double Deck': 0.15, Supersonic: 0.1 }[category]
override   = LINE_RATE_OVERRIDE[typeId] ?? null     // ~20 famous lines
maturity   = ramp 0 -> 1 over the 3 years after eis, taper to 0.3 in the last
             3 years before oop
worldScale = Headwinds only: clamp(activeAirlines / 4, 1, 3)
rate       = (override ?? base) * maturity * worldScale
```

The maturity ramp is what makes a just-certified widebody genuinely hard to get
and a 20-year-old narrowbody available next month — which is both realistic and
exactly the tension the feature exists to create.

**Opening backlog.** A line that has been running since before the player's world
started is not empty. Seed `committed[]` with world demand back-filled from
`openedWeek`, at an occupancy that follows the same maturity curve: ~85% in the
first three years post-EIS (everyone ordered at launch), settling to ~55–65%
mid-life, falling away as `oop` approaches.

**World demand consumes slots every tick**, deterministically:

```
slotSeed = `${worldSeed}|line|${typeId}|${absWeek}`
take     = hashRange(slotSeed, floor(rate * occupancyTarget), ceil(rate))
```

So the board moves whether or not the player orders, it replays identically on
save/load, and a projection can never burn a draw or predict one.

**Two classes of buyer.** Named AI competitors order **explicitly** through the
book (locked decision above) — their orders occupy real slots, count against the
same per-line and per-manufacturer caps, and show in the book like anyone else's.
The hash-derived consumption above is the *rest of the world*: the carriers the
sim does not model by name. Both are deterministic; only the second is anonymous.

Consequence for `competitorAI.js`: fleet growth stops going straight to
`makeCompetitorTail` and has to queue. An AI that cannot get slots grows more
slowly or goes to the used board — it must never stall outright, or the
competitive layer quietly dies. Worth its own test.

---

## 2. Package 1 — Pre-delivery payments

The highest realism-per-line-of-code change in the document, and the one that
makes everything else safe.

`pendingOrders[]` entries gain `payments[]`:

| When | Share | Note |
|---|---|---|
| At signing | 2% | Non-refundable. |
| T−18 wk | 8% | |
| T−12 wk | 8% | |
| T−6 wk | 7% | |
| On delivery | 75% | Balance. |

~25% pre-delivery, which is roughly right, and it means **a slot you hold but do
not need bleeds cash on a schedule against zero revenue**.

**The clamp.** An instalment whose week would fall before signing is due AT
signing. That is what lets this ship ahead of slots: on today's 1–8 week lead
times the whole pre-delivery quarter is still paid up front and only the
balance waits for delivery; the schedule spreads out by itself once Package 2
lengthens the window. `models/orderPayments.js` never knows what a lead time is.

### As built (Tailwinds, 2026-09-21)

- **`src/models/orderPayments.js`** — the schedule, the clamp, the book-wide
  signing requirement (`committedPreDelivery`), the tick's settlement
  (`settleDuePayments`) and the one refund function (`cancellationRefund`) that
  the reducer and both cancel dialogs call.
- **`ORDER_AIRCRAFT`** — under the flag, owned orders carry `contractPrice` and
  `payments[]` (airframe + line-fit Wi-Fi) and charge only the signing-week
  payments. The bulk-discount loop resolves quantity against the staged
  requirement. Leases and flag-off worlds take the classic path unchanged.
- **`ADVANCE_WEEK`** — settles every payment due by the week the tick moves into
  (the delivery pass's `newAbsWeek`, so a balance and its aircraft always land
  together). Capital: in `preTaxProfit`, not in the tax base. Reported as
  `lastReport.aircraftPayments`, present only in a week that paid something so
  classic reports stay byte-identical.
- **`CANCEL_ORDER`** — deposit forfeited, paid instalments refunded at 80%
  (`PDP_CANCEL_REFUND_SHARE`). On today's lead times that is ~6.6% of the price
  against the classic 5% — deliberately a little stiffer.
- **Visibility** — `projectWeek` forecasts next week's payments; the P&L bridge
  and Dashboard card carry an *Aircraft purchase payments* row in both columns;
  the Finance 12-week forecast has an *Aircraft* column (so the existing "cash
  turns negative in week +N" banner sees balances coming); the weekly debrief
  names it; the order form quotes *due at signing / instalments / balance on
  delivery*; the order card shows paid-so-far, the next payment and what
  cancelling returns.
- **Not built:** there is no "missed instalment" state. With always-cash there
  is nothing to miss, so the §8 *use it or lose it* rule is superseded — the
  negative-cash rules are the consequence instead.

**Consequence worth knowing.** Signing on 25% means a player can commit to four
times their cash. A 60-week soak ($900M airline signing $1.12B of aircraft, no
routes) ends bankrupt when the balances land — correct under the chosen rules,
and the forecast shows it coming, but it is a sharp edge for a new player. If it
bites in playtesting, the cheapest mitigations are an order-form warning when the
12-week forecast would go negative, or letting the book-to-fleet cap (§8) arrive
with Package 2 as planned.

**Known bypass for Package 2.** `BUY_AIRCRAFT` and `LEASE_AIRCRAFT` still deliver
instantly and ignore the flag. Nothing in the UI dispatches either today (test
fixtures do), but slots must gate them under the flag or they become the way
round the order book.

---

## 3. Package 2 — Slots and backlog

The order form stops quoting `currentAbsWeek + 2 * lead` and starts quoting the
line's earliest unallocated slot. `AircraftCheckout.jsx`'s delivery callout
becomes a real slot ladder; the Marketplace browse table gains an
**earliest slot** column so the scarcity is visible before the player commits to
a type.

Hard requirement from §4: the UI shows line state — committed share, earliest
unallocated slot, lessor pool state. Being blocked *with* information is a
planning problem; being blocked without it feels like griefing.

Era worlds get this almost free, and it is where the feature sings: a 1969 747
order delivering in 1972 is simply what happened.

---

## 4. Package 3 — Options and purchase rights

Pay a small fee to hold slots at a locked price. Exercise to firm (price locked
at option date, PDP schedule starts), or let them lapse and eat the fee.

This is the mechanic that makes the layer *interesting* rather than merely a
delay: cheap optionality against an uncertain demand cycle, which is exactly the
real decision. It also gives the seasonal layer (P1) and the economic events
something to bite on.

Options count against the allocation cap at a discounted weight (say 0.5×), so
they cannot be used to launder a corner.

---

## 5. Package 4 — Deferral, acceleration, transfer

- **Defer** a slot back by N weeks for a fee. Paid PDPs carry over.
- **Accelerate** by taking a slot someone else is giving up, at a premium.
- **Transfer** — in Headwinds, an actual player-to-player slot market.

This is the most multiplayer-native piece in the document and the strongest
argument for the whole layer existing in Headwinds: genuine contested scarcity,
the same shape as the shared-demand contest.

Guardrails in §8 — transfers need consent and a fee that eats the spread, or
hoarding pays for itself and the feature becomes an arbitrage.

---

## 6. Package 5 — Used board of real tails

A rotating board of *individual airframes*: age, hours, the cabin already fitted,
an asking price, 2–6 week delivery. This is the answer to "the line is full and I
need metal this month", and it is what makes backlogs a decision rather than a
wall.

Sources:
1. **Competitor retirements.** `competitorAI.js` already shrinks fleets and drops
   tails — today they are simply deleted. Pipe them onto the used board instead.
   The AI's contraction becomes visible and the board's supply tracks the world's
   actual health, which is a much better story than a synthesised list.
2. **Synthesised fill**, hash-seeded like the charter board, so week one is not
   empty.
3. **Headwinds: other players' listings.**

Individual tails let the used market price what the type-level `deliveredAgeWeeks`
abstraction cannot — hours, cabin, and a seller who needs the cash.

Shippable alone. Worth doing even if slots never ship.

---

## 7. Package 6 — Sale-leaseback

Sell a delivery position, or a just-delivered owned frame, to a lessor and lease
it back. Converts capex to opex at a worse lifetime cost.

The classic growth-airline trade, a real pressure valve for a cash-strapped
expander, and it plugs straight into the existing lease machinery and
`leaseBuyout.js`. It also gives the lessor pool (§8) a supply story beyond "the
manufacturer allocated it".

---

## 8. Anti-hoarding

The concern this section exists for: **a large airline buying every slot to stop
everyone else growing.**

The frame is *not* to make hoarding illegal. It is to make it **expensive**, and
to put a **floor** under everyone else that money cannot buy through.

Note first that the risk is very uneven by world. Orderable types by calendar
year:

| Year | Orderable types | Mainline narrowbodies in production |
|---|---|---|
| 1955 | 14 | 0 |
| 1962 | 35 | 6 |
| 1975 | 57 | 8 |
| 1990 | 77 | 9 |
| 2010 | 109 | 8 |
| 2026 | 119 | 14 |

In a classic 2026 world cornering means buying out fourteen independent lines
across five manufacturers — not realistic. In a 1955–1975 era world it is
genuinely feasible. **Every rule below has to be checked at 1955, not at 2026.**

### The economic brake — PDPs

Already §2, and it is load-bearing. Holding 40 slots to deny a rival means
carrying 40 payment streams against zero revenue: a balance-sheet attack on
yourself. This is why package 1 is a locked prerequisite.

### The floor — lessor reserve pool

**30–40% of every line's output is pre-sold to leasing companies and is not
available for direct order at any price.**

Lessors really do hold about half the world fleet, and the reason they exist is
exactly this: placing metal with carriers who cannot or will not order direct. A
small airline's growth path runs through the lessor pool, and no rival can touch
it. This single rule makes total lockout *structurally* impossible, and it is
more authentic than any cap.

Lessor slots surface as lease offers on the normal order form, at the normal
lease rate, with near-term delivery. From the player's side nothing new to learn.

### Supply responds — rate ramp

If a line's committed share stays above ~85% for 8 consecutive weeks, the
manufacturer raises the rate (+10%, capped at 2× base). Hoarding buys a temporary
edge the world then heals, rather than a permanent moat — and it is
world-modelling rather than a punitive anti-player rule, which is the right
register for this codebase.

### Rules on top

| Rule | Shape | Why |
|---|---|---|
| **Allocation cap** | No airline holds >30% of a line's rolling 52-week output | Manufacturers do not concentrate their order book or their credit risk. Legible in the UI. |
| **Book-to-fleet cap** | Firm book ≤ 1.5 × operating fleet, floor of 2 frames | Scale buys proportionally more, not unboundedly more. The floor is what lets a startup order at all. |
| ~~Use it or lose it~~ | Superseded by the always-cash decision (2026-09-21): instalments are always charged, so there is no missed PDP to forfeit. Negative cash and bankruptcy are the consequence. | Free optionality is still removed — the money leaves the bank on schedule regardless. |
| **No profitable resale** | Cancelled slots return to the *pool*, not to a private buyer. Transfers need manufacturer consent plus a fee that eats the spread | Otherwise §5 is an arbitrage and hoarding funds itself. |
| **Priority decay** | Serial deferrers and cancellers lose allocation priority | The relationship is an asset, so abusing it costs something. |
| **World-size scaling** | `worldScale` in the rate formula | A 12-airline Headwinds world is not fighting over a 4-airline supply. |

### Lease buyout and the reserve pool (§8.6)

The remaining leak in the floor. `leaseBuyout.js` already guarantees the round
trip is a **loss** — buy out at 1.10 × NAV, sell at 0.95 × NAV — so flipping
pool metal for profit is closed. The attack that survives is not profit-seeking,
it is capacity denial: lease from the reserve pool, buy out, repeat, and convert
the floor everyone else depends on into your own owned fleet.

Three layers, of which the first is the real answer:

**1. The lessor replaces the frame.** A buyout does not remove a unit from the
pool — it converts a flying pool frame into a future pool slot. The lessor takes
the money and orders a replacement, which enters the line's reserve allocation at
the next available reserve slot. This is what lessors actually are: capital
recyclers. The pool is a circulating stock, not a faucet, and the floor invariant
survives **by construction** rather than by prohibition. Cost to the buyer is
nothing extra; cost to the world is a delay.

**2. A buyout counts against the buyer's allocation cap.** The leak is only a
leak while the buyout is invisible to the allocation system. Route it through the
cap that already exists and the loophole closes exactly: an airline at its
per-line or per-manufacturer cap simply cannot buy out, because the lessor will
not sell into a concentration the manufacturer would not have allocated. No new
rule class, no second concept for the player to learn.

**3. A minimum operated term.** The lessor will not discuss a sale until the
placement has flown ~26 weeks. Realistic — a lessor prices the early-termination
option and does not sell a frame it has just placed — and it makes the buyout a
decision about a specific tail you have been operating rather than an instant
arbitrage on placement. It also means the denial version of the attack requires
actually *flying* the metal for half a year, which is a real opportunity cost.

Optionally, a **premium that scales with pool depletion**: `LEASE_BUYOUT_PREMIUM`
rises from 0.10 toward ~0.40 as that type's reserve pool thins. Self-correcting,
market-flavoured, and the price itself signals to everyone that the pool is
stressed. Rule-free, but it is the one layer that does not hard-close anything,
so it is a supplement and not a substitute for 1–3.

Note the symmetry with package 6: sale-leaseback **adds** to the pool, buyout
**withdraws and triggers a replacement**. The two together make the lessor pool
a real circulating stock with its own supply and demand, which is a far better
story than a fixed carve-out that only ever drains.

### Substitutes

The structural defence is that cornering requires cornering *every* substitute.
Design constraint, to be asserted by test: **every mission role has at least two
types with independent lines orderable at every calendar year the game supports.**
1955 has 14 orderable types and zero mainline narrowbodies — that is the year
that will fail first, and the used board plus the lessor pool are what carry it.

---

## 9. Package 7 — Earned discounts

Keep the ladder as the base, but layer on reasons:

- **Fleet commonality** — `families.js` already knows what is related.
- **Launch customer** — ordering before EIS buys a real discount and real risk.
- **Competitive campaign** — a "request competing bids" action that costs a few
  weeks and returns a better price from the rival manufacturer.
- **Repeat-buyer standing** — the same relationship score that §8's priority
  decay reads.

Ships last. It is the flavour layer, and it is also the fix for the existing
"order a hundred" exploit: the ladder applies to firm orders up to your
allocation share, and beyond that you are buying on the secondary market at a
premium rather than from the manufacturer at list.

---

## 10. Determinism

`weeklyTick` contains no random draws and nothing here may change that. Every
draw in this feature — world slot consumption, used-board generation, lessor pool
placement — uses `hash32` from `models/departureBoard.js` keyed on
`absWeek`, exactly as `charterBoard.js` does:

```
slotSeed = `${worldSeed}|line|${typeId}|${absWeek}`
```

Consequence: the order book replays identically on save/load, the finance
projection can read forward without burning a draw, and with `orderBook` absent
a scripted game stays byte-identical to HEAD (§13).

---

## 11. Migration and the world flag

`orderBook` follows the `crewPipeline` precedent exactly:

- `START_GAME` sets `orderBook: true` and seeds the line book, so new worlds are
  tracked from birth.
- Existing saves carry no flag and keep today's `DELIVERY_LEAD` path unchanged.
  `reconcileState` must **not** retrofit it — there is no sensible way to
  reconstruct a backlog an existing world never had, and a mid-game fleet plan
  built against instant delivery would break.
- Headwinds: server-side flag + guard + allow-list, same as `crewPipeline`.

Onboarding: a new airline cannot be told the line is full until week 40. The
mitigations already exist in shape — the Headwinds starter-fleet perk
(`STARTER_DELIVERY_CAP`), the lessor pool holding near-term metal, and the used
board. Same pattern as the A7 instant-crew floor: **waive the wait, not the
cost.**

---

## 12. The early game

The risk this section exists for: **a new airline spends its opening weeks
watching a delivery countdown.** That is the fastest way to lose a player, and
it would be entirely self-inflicted.

### The reframe: the order book is not early-game content

A week-one airline has $10M (`STARTING_CASH`) and an empty ramp. Real startups in
that position do not order new aircraft — they lease used metal, because that is
what $10M buys and what a carrier with no balance sheet and no planning horizon
can get. **The used board and the lessor pool are the early game; the order book
is something you graduate into** once you have the cash and a demand forecast
worth committing against.

So the design target is not "make the wait bearable". It is: **a new airline
should never need to touch the order book at all.** If it does, the early game
has been designed wrong.

### Why PDPs make the opening *more* active, not less

Today, buying an aircraft empties the bank — `ORDER_AIRCRAFT` charges the whole
price at signing, and on $10M that is the entire game for a while. Under §2 the
signing cost is 2%. A week-one airline can therefore hold a flying fleet *and* an
order book at the same time, because its capital is no longer locked up in metal
that has not arrived.

That inverts the concern. Package 1 is not what makes the early game a waiting
room; it is what stops the early game being a single all-in purchase.

The trap to watch is the opposite one — cheap signing tempts a new player to
over-commit and end up with a big book and nothing flying. The book-to-fleet cap
(§8, floor of 2 frames) is what bounds that, and it should be tuned with this
failure in mind rather than only the hoarding one.

### The queues are not where beginners are

The maturity curve in §1 puts the heaviest backlog on just-certified widebodies.
The cheap, older, smaller types a $10M startup can actually afford sit on mature
or closing lines, where occupancy is low and slots are near. **Design target:
anything a week-one airline can afford quotes inside 2–6 weeks** — near enough
to today's `DELIVERY_LEAD` that the opening barely changes.

### Mechanisms

| Mechanism | Shape |
|---|---|
| **Starter fleet is instant** | Port the Headwinds `STARTER_DELIVERY_CAP` perk to Tailwinds under the flag: the first 2 acquisitions skip the queue. Waive the **wait**, not the cost — the exact A7 instant-crew precedent. |
| **New-entrant allocation** | Manufacturers court new customers and want a diverse order book. A small carrier gets preferential slot position for its first N frames. Realistic, and the natural counterweight to §8's caps, which are aimed at the big end. |
| **Every wait has a purchasable alternative** | Pay an acceleration premium, take an older type available now, or lease instead of own. Then a wait is a **choice the player made to save money**, never a wall. Same principle as the floor invariant, applied to feel rather than fairness. |
| **Charters fill the gap** | Already built. A refreshing board of short contracts flown with the metal you already have is exactly the answer to "what do I do for eight weeks". Worth surfacing charter offers in the Orders tab while deliveries are pending. |
| **Texture on the wait** | PDP milestones, build progress, paint shop, slot confirmation. `newsLog.js` already emits `delivery_arrived`; add the milestones so an order reads as progress rather than a countdown. Cheap. |

### Make it a measured invariant

Do not leave this to feel. Assert it, the way §13's floor invariant is asserted:

> **Time to first revenue flight.** A newly founded airline, playing reasonably,
> is flying revenue within N weeks — in every world type and every supported
> calendar year.

Run it at 1955 (14 orderable types) as well as 2026. If the number drifts up
after a balance change, the balance change is wrong.

---

## 13. Test plan

New suites under `tools/`, picked up automatically by `run-tests.mjs`.

| Suite | Asserts |
|---|---|
| `orderbook-parity-test.mjs` | Flag absent → byte-identical to HEAD. The whole feature is inert on existing saves. (Package 1 proved this out-of-tree: a 40-week scripted game — owned and leased orders, Wi-Fi, a cancellation, deliveries, projections and bridge rows every week — serialised identically against a `git archive HEAD` copy. The in-tree guard is `order-payments-test.mjs` §2.) |
| `orderbook-determinism-test.mjs` | Same world seed + same week → byte-identical line state. Save/load mid-backlog replays identically. |
| `order-payments-test.mjs` **(built)** | Schedule math and the clamp; flag-off parity; signing charge and the book-wide requirement; instalment and balance land in the right tick; always-cash on a shortfall; payments are not tax-deductible; projection = charge; bridge names it with no residual; cancel refund = the quoted refund; the order form, order card, 12-week forecast and debrief. Proven failing on HEAD (20 of 27 at first run). |
| `pnl-reconcile-test.mjs` **(extended)** | The rendered Dashboard card carries the instalment row and still adds up, the week of and the week before. |
| `orderbook-allocation-test.mjs` | Allocation cap and book-to-fleet cap hold under a deliberate adversarial buyer; cancelled slots return to the pool and never to a private buyer. |
| **`orderbook-floor-test.mjs`** | **The floor invariant, below.** |
| `orderbook-substitutes-test.mjs` | Every mission role has ≥2 types on independent lines orderable at each of 1955 / 1962 / 1975 / 1990 / 2010 / 2026. |
| **`orderbook-earlygame-test.mjs`** | **Time to first revenue flight** (§12) stays within N weeks for a newly founded airline, at 1955 and 2026. Also asserts a week-one airline can reach a usable aircraft without ever using the order book. |
| `orderbook-ai-growth-test.mjs` | AI competitors ordering through the book still grow — slot-starved is allowed, stalled outright is not. |

### The floor invariant

> In any world, at any tick, **every airline has a purchasable path to a usable
> aircraft within N weeks at some price** — direct slot, lessor pool, or used
> board.

Run it across simulated worlds including a deliberately adversarial one where the
richest airline buys every slot it is permitted to buy, every week, forever. If
it passes at 1955 with 14 orderable types, it passes everywhere.

This invariant is the feature's safety rail. If a balance change ever breaks it,
the change is wrong.

---

## 14. Build order

1. **Package 1 — PDPs.** Standalone. Ships value immediately and is the
   prerequisite for everything else.
2. **Package 5 — used board.** Standalone. Also the supply floor slots will lean
   on, so it wants to exist first.
3. **Package 2 — slots and backlog**, with §8's caps, lessor pool and rate ramp
   built *in the same package*, never bolted on after.
4. **Package 6 — sale-leaseback.**
5. **Package 3 — options.**
6. **Package 4 — deferral / transfer**, and the Headwinds slot market.
7. **Package 7 — earned discounts.**

Tailwinds first in every case; Headwinds port in the same shape, with the server
guard and allow-list entry, plus the multiplayer-only pieces (§5 transfers, §6
player listings, `worldScale`).
