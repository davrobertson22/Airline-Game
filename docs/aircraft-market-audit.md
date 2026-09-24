# Aircraft Market Audit — specs and pricing

**Date:** 2026-09-20 · **Scope:** all 197 types in `src/data/aircraft.js`
**Method:** real-world spec verification against published sources; economic sweep over 33 sectors × 24 market sizes (768 missions) using the engine's own cost functions (`fuelCostPerKm`, `weeklyLandingFee`, `weeklyInsuranceCost`, `crewScaleFor`, `hqScaleFor`, `maintenanceMultiplier`).

---

## Read this first: the existing tooling over-rates old metal

Before any finding below, one correction to the measuring instrument.

`tools/catalogue-deadweight-report.mjs` builds its cost model from the engine's functions, but its `fixedWeekly()` omits two things the live tick applies:

1. **The delivered-age maintenance multiplier.** It charges `t.baseMaintenancePerWk` raw. The tick charges `baseMaintenancePerWk × maintenanceMultiplier(effectiveMaintAgeWeeks)`. A type arriving at 832 weeks starts at **2.28×**, not 1.0×.
2. **The classic-game vintage rule.** `eraDeliveredAgeWeeks(type, null)` lifts any type whose line closed 50+ years ago to 20–30 years delivered age (up to **5.5×** maintenance), and `leaseDenial()` makes it buy-only.

Correcting both changes the picture materially:

| | deadweight model as written | age + vintage corrected |
|---|---|---|
| distinct winners | 36 | 25 |
| vintage share of wins | **19.3%** | **3.9%** |
| Vickers Vanguard | 57 wins | 18 wins |
| Britannia, L-1649, DC-3, Viscount 800, CV-440 | all win | all drop out |

**So the "1950s propliners dominate" reading that report invites is largely an artefact of the report.** The vintage rule is doing its job. Worth fixing the model before it drives a rebalance — the three lines needed are in `$HOME/audit/_audit-final.mjs` (see *Scratch files* at the end).

Everything below uses the corrected model.

---

## HIGH · Propeller fuel burn is calibrated on a different scale to jets

This is the one systematic spec error in the catalogue. Jets sit at the intended 92–98% of real burn. Propellers sit at roughly **50–70%**.

Independently verified (engine cruise power × SFC, or published trip-fuel):

| type | game `fuelBurnPer100km` | real (L/100km) | game as % of real |
|---|---|---|---|
| `il18` Il-18 | 210 | 415–545 | **39–51%** |
| `q400` Dash 8 Q400 | 137.25 | 229–289 | **47–60%** |
| `vanguard` Vanguard | 215 | ~366 | **59%** |
| `atr72` ATR 72-600 | 122.75 | 176–195 | **63–70%** |

Sources: Ivchenko AI-20 and Rolls-Royce Tyne cruise power/SFC ratings; Wikipedia *Fuel economy in aircraft* trip-fuel table for Q400 and ATR 72. The Dash 7's figure could not be verified — no public cruise fuel-flow data exists in reachable sources, so I am not proposing a number for it.

A broader sweep (lower confidence, single-source) put the whole Dash 8 family, ATR 42, C208B, B1900D, Saab 340, PC-12 and Viscount 700 in the same 43–72% band.

### What it does to the game

The Q400 is currently **the most fuel-efficient aircraft per seat in the entire 197-type catalogue**:

| rank | type | L/100km per seat |
|---|---|---|
| 1 | `q400` Dash 8 Q400 (2000) | 1.52 |
| 2 | `vanguard` Vickers Vanguard (**1961**) | 1.55 |
| 3 | `a330neo` A330-900neo (2018) | 1.57 |
| 4 | `atr72` ATR 72-600 | 1.57 |
| 5 | `f27` Fokker F27 (**1958**) | 1.58 |
| 6 | `a321xlr` A321XLR (2024) | 1.62 |
| … | `b7879` 787-9 | 1.71 |

A 1961 Vanguard and a 1958 F27 out-performing the 787-9 per seat is the clearest single symptom. In-game a turboprop beats a comparable regional jet by **40–45%** per seat (Q400 vs E175, ATR 72 vs CRJ-700); the real gap is closer to 20–30%. Turboprops take 7 of the top 10 win slots in the sweep.

**Recommendation.** Raise Turboprop-category burn toward real. A sensitivity run says the honest multiplier is roughly **×1.5–1.6 for modern turboprops** and **×1.7–2.0 for the pre-1975 types**. At ×1.6 the E195-E2 goes from 23 wins to 41 — modern regional jets get their niche back, which is the point. This does *not* fix findings 2 and 3 below; they are price problems.

---

## HIGH · The Dash 7 holds an unbreakable monopoly at commuter-turboprop pricing

**50 wins (10.9% of decided missions), median profit margin over the second-best aircraft: ×11.72.**

Every other winner in the sweep takes its missions by 1–8%. The Dash 7 takes them by an order of magnitude. The cause is structural:

> **The Dash 7 is the only aircraft in the catalogue with more than 40 seats that can use a runway under 3,100 ft.**

| runway | type | seats | weekly lease | purchase |
|---|---|---|---|---|
| **2,300 ft** | **`dash7` Dash 7** | **54** | **$12,000** | **$5.0M** |
| 3,100 ft | `dhc8100` Dash 8-100 | 40 | $10,000 | $4.0M |
| 3,300 ft | `dhc8200` Dash 8-200 | 40 | $12,000 | $5.0M |
| 3,500 ft | `dhc8300` Dash 8-300 | 56 | $17,000 | $7.0M |
| 3,600 ft | `atr42` ATR 42-600 | 50 | **$40,000** | **$20.0M** |

The 2,300 ft figure is correct — the Dash 7 was a genuine four-engine STOL 50-seater. The problem is that a unique capability is priced as an ordinary commuter turboprop: it undercuts the ATR 42-600 by **3.3× on lease and 4× on purchase** while carrying four more seats into 1,300 ft less runway.

This is not a fuel problem. Raising propeller burn by 60% takes the margin *up* to ×21, because its competitors on short fields are also propellers and it spreads fixed cost over more seats.

**Recommendation.** Price the capability, not the airframe. Something in the **$28–34k/week, $14–17M** band puts it between the Dash 8-300 and the ATR 42 and leaves it the right answer on short fields without making it free money. Its 1,300 km range and 624-week delivered age remain real drawbacks, so it should keep the niche.

---

## MED-HIGH · The Il-18 escapes the vintage rule by two years

**49 wins (10.7%)** — the second-biggest winner after the A380.

`oop: 1978`, so the line closed 48 years ago. `VINTAGE_AFTER_YEARS = 50`. It misses the vintage threshold by two years, arrives at 832 weeks rather than 20–30 years, and stays leasable. Combined with the worst fuel understatement in the catalogue (39–51% of real) it becomes a 110-seat, 6,500 km aircraft for $12,500/week.

The mechanism is a cliff edge: nothing about the aircraft changes, but in two years of real-world time it crosses the threshold and collapses from 49 wins to near zero. The F27 (`oop` 1987, 39 years) and Short 360 (`oop` 1991, 35 years) sit in the same pre-threshold window and both appear in the winners list.

**Recommendation.** The fuel correction in finding 1 does most of the work here — at ×1.8 the Il-18 drops out of the winners entirely. Worth also considering whether a hard 50-year cliff is the right shape, or whether delivered age should ramp continuously from, say, 35 years closed. A ramp removes the cliff for the whole 1955–1990 cohort at once rather than type by type.

---

## MED · Concentration at the top

| type | wins | share of decided | margin over #2 |
|---|---|---|---|
| `a380` A380 | 82 | **17.8%** | ×1.27 |
| `dash7` | 50 | 10.9% | ×11.72 |
| `il18` | 49 | 10.7% | ×1.13 |
| `dhc6` Twin Otter | 42 | 9.1% | — (sole eligible) |

The Twin Otter's 42 wins are legitimate — those are the sub-1,500 ft fields where nothing else fits, and it has no second place to beat.

The **A380** is a design call rather than a bug. It wins every high-demand mission on raw seat count, including short-haul ones (JFK–BOS, LAX–SFO), at a 27% profit margin over the next aircraft. That is defensible — the biggest aircraft *should* own the biggest markets — but 17.8% of the grid from one type is heavy, and the margin means it wins clearly rather than narrowly. Flagging for your judgement, not recommending a change.

Related, and more clearly wrong:

| type | seats | weekly lease | purchase | burn |
|---|---|---|---|---|
| `b747400` 747-400 | 605 | **$109,000** | $55M | 1608.25 |
| `b7478i` 747-8I | 605 | **$463,000** | $190M | 1400 |

Identical seat count. The -8I burns 13% less fuel for a **4.25× lease premium** — the fuel saving recovers roughly half the premium even on heavy long-haul utilisation. The 747-400 wins; the -8I peaks at 78.5% of the winner. The consistency suite's Pareto check passes because the -8I is better on fuel and range, but it is economically dominated.

---

## MED · Price is not calibrated against delivered value

Capital efficiency = peak weekly surplus before ownership cost ÷ weekly lease. The spread across the catalogue is **×1.2 to ×52.3 — a 43× range.**

| | most underpriced | | least |
|---|---|---|---|
| `vanguard` | ×52.3 | `l410` | ×1.2 |
| `b747100` | ×47.4 | `do228` | ×1.5 |
| `il18` | ×46.3 | `b1900d` | ×1.7 |
| `b747200` | ×37.1 | `dhc6` | ×1.9 |
| `britannia` | ×36.2 | `c408` | ×2.0 |
| `l1011` | ×34.5 | `c208b` | ×2.5 |

Part of that spread is size — a 19-seater can never post a large peak — but the pattern within size classes holds: pre-1980 metal is priced near scrap while earning near-modern revenue, and small modern turboprops are priced at market while earning almost nothing.

By category, median capital efficiency: Double Deck ×23.1, Turboprop ×14.7, Wide Body ×13.3, Narrow Body ×13.1, Regional Jet ×9.1. **Regional jets are the worst-value category in the game** — which is the other half of the finding-1 story.

Seven types clear their costs on no mission in the grid: `cl350`, `cj4`, `phenom300e`, `g650er` (business jets — they fly the charter board, so the scheduled-route grid is the wrong test and these are not findings), `bn2islander`, `pc12`, and `comet1`. The Comet 1 carries a `withdrawnYear` and 9.55 L/100km per seat, the worst in the catalogue — presumably deliberate.

---

## LOW · Lease vs buy is not a real decision

Lease yield (annual lease ÷ purchase price) runs **9.2% on modern types, 13.5–14.3% on vintage** — median 12.5%. Buying recoups in **7–11 years of avoided lease** against a 25–30 year useful life.

Buying is therefore correct for every type in the catalogue whenever you have the cash; leasing is purely a cash-flow bridge. The yield spread makes it worse rather than better, because the aircraft that are cheapest to buy outright are also the most expensive to lease. That may be the intended design — cash constraint as the real tradeoff — but there is currently no type for which leasing is the better economic answer.

---

## Confirmed spec errors worth fixing

Filtered to those I could verify. Range errors cluster on one cause: a ferry or reduced-payload figure used where the field wants max-payload range.

| id | field | game | real | severity |
|---|---|---|---|---|
| `b727200f` | range | 3,500 km | ~1,852 km at max payload | HIGH |
| `b767200sf` | range | 6,000 km | ~3,700 km at max payload | HIGH |
| `b707320` | range | 10,650 km | ~6,920 km at 189 pax | HIGH |
| `dc863` | range | 11,000 km | ~7,400 km | HIGH |
| `il96300` | range | 11,500 km | ~8,000 km at 300 pax | HIGH |
| `tu204` | range | 6,500 km | ~4,300 km | HIGH |
| `casacn235` | range | 4,355 km | ~2,870 km at max payload | HIGH |
| `an148` | range | 5,100 km | ~3,500 km (-100B) | HIGH |
| `dc873f` | range | 7,400 km | ~5,400 km at max payload | HIGH |
| `a330200f` | range | 7,400 km | ~5,900 km at 70 t | HIGH |
| `b737max7` | eis | 2023 | FAA cert Aug 2026; service ~2027 | HIGH |
| `b737max10` | eis | 2025 | not certified as of Sep 2026 | HIGH |
| `a319neo` | eis | 2019 | 2022 (first delivery) | HIGH |
| `spacejet` | eis | 2026 | programme cancelled Feb 2023 | HIGH |
| `b767200sf` | burn | 640 | burns *more* than the larger `b767300f` (593.75) — backwards | MED |
| `yak40` | seats | 40 | 32 (max certified) | MED |
| `dc1030f` | payload | 78 t | ~65 t | MED |
| `a300600f` | payload | 54 t | 48.3 t | MED |
| `e190f` | payload | 13 t | 10.7 t | MED |
| `hs748` | seats | 48 | 58 (high-density) | MED |
| `emb120` | oop | 2001 | 2007 | MED |
| `b377` | seats | 100 | 114 | MED |

**One open question rather than an error:** `runwayFt` on the 737 family (Classic, NG and MAX) runs 15–42% below published MTOW balanced field length, while the A220 matches its real figure exactly. Either the field means "typical operational minimum" (in which case the A220 is the outlier) or it means MTOW TOFL (in which case the 737s are). Worth settling, since route eligibility hinges on it. The 787 family and the Embraer E-Jets show the same downward bias at 15–18%.

## Things that look wrong but are not — don't chase these

- **13 freighters "violating" the `deliveredAgeWeeks` band.** The band rule applies to passenger types only (`expectedAgeBand` filters to `PAX` and honours `bandEis`). Conversions deliberately arrive one band older because a fresh P2F conversion is an old airframe, and `b737800bcf` / `e190f` / `a321p2f` correctly carry 312 weeks despite recent conversion programmes. Working as designed.
- **Concorde burning 24% above a literal cruise-burn calculation.** Deliberate; it is the prestige money-loser.
- **Business jets failing every scheduled-route mission.** They fly the charter board.

---

## Suggested order of work

1. **Fix the deadweight report's cost model** (age multiplier + vintage rule). Everything else gets measured against it.
2. **Recalibrate Turboprop fuel burn** — ×1.5–1.6 modern, ×1.7–2.0 pre-1975. Biggest single lever; fixes the Il-18 and restores the regional-jet niche.
3. **Reprice the Dash 7.** Independent of 2, and the only ×11 margin in the game.
4. **Fix the verified range and EIS errors** — cheap, no balance risk.
5. **Decide** the A380 share, the 747-400/-8I gap, the 50-year vintage cliff, and what `runwayFt` means. Design calls, not bugs.

Steps 2 and 3 want a regression test each — a per-seat fuel-burn floor by category, and a "no type wins its missions by more than ×N" check — so neither can drift back.

---

## Reproducing this

Four read-only analysis scripts produced the numbers above. They were written to `tools/`, then removed — the repo is back to its original state and `npm test` is unaffected (`aircraft-consistency-test` still passes 65/65; nothing in `src/` was touched).

The one worth rebuilding is the corrected sweep. It is the deadweight report's model with two changes to `fixedWeekly()`:

```js
import { eraDeliveredAgeWeeks, isVintage } from '../src/data/aircraft.js';
import { maintenanceMultiplier } from '../src/utils/simulation.js';

const age = eraDeliveredAgeWeeks(t, null);              // was: implicit 0 / 260
const maint = t.baseMaintenancePerWk * maintenanceMultiplier(age);
const own = isVintage(t) ? Math.round(t.purchasePrice * 0.125 / 52)  // buy-only
                         : t.weeklyLease;
```

Everything else — sectors, demand ladder, frequency optimisation — is unchanged from `catalogue-deadweight-report.mjs`. Folding these three lines into that report is step 1 of the work list above, and it makes the report's own conclusions trustworthy as a side effect.

---

# Addendum · The 767-300 complaint (2026-09-20)

**Verdict: the complaint is directionally right but misattributed. The 767-300 is not an outlier — it sits almost exactly on its generation's price line. The underpricing is cohort-wide, and the 767-300 is one of its milder cases.**

## It depends entirely on which metric the player is feeling

On **profit per week** — what a mature, cash-rich airline optimises — the 767-300 is not underpriced. Across 10 long-haul sectors × 14 market sizes it wins **zero** missions; it ranks 11th–13th of 17 on every sector, squeezed by narrowbodies below and the A330neo/A380 above.

On **return on capital** — what a cash-constrained player actually experiences — it looks very different:

| type | ROC (peak, owned) | pays for itself in |
|---|---|---|
| `a310300` A310-300 | **349%/yr** | **15 weeks** |
| `b747100` 747-100 | 347%/yr | 15 weeks |
| `l1011` L-1011 | 322%/yr | 16 weeks |
| `b767200er` 767-200ER | **307%/yr** | **17 weeks** |
| `a300600r` A300-600R | 258%/yr | 20 weeks |
| **`b767300` 767-300** | **250%/yr** | **21 weeks** |
| `a330200` A330-200 | 168%/yr | 31 weeks |
| `a330neo` A330-900neo | 108%/yr | 48 weeks |
| `b7878` 787-8 | 64%/yr | 81 weeks |
| `a350900` A350-900 | 53%/yr | 98 weeks |

The 767-300 returns its purchase price 2.3× faster than an A330neo and 3.9× faster than a 787-8. That is what the complaint is picking up.

But it is **13th** on that list. Repricing it alone just promotes the A310-300 — which is nearly twice as extreme — into the complaint slot.

## Root cause: the freighter seam, unfixed on the passenger side

The consistency suite already guards this exact failure for freighters. From its own header:

> *"Used conversions were priced off scrap values (0.11–0.50 $M/tonne) and purpose-built freighters off new-market values (1.3–2.1 $M/tonne) — a 21.6× spread in capital cost against only a 2.7× spread in operating cost per tonne-km."*

The same seam exists on the passenger side and nothing tests for it. Across the 38 passenger widebodies:

| | spread |
|---|---|
| capital cost per seat | **15.2×** ($29k/seat 747-100 → $443k/seat A350-900ULR) |
| fuel cost per seat-km | **2.5×** |
| maintenance per seat | **2.1×** |

A 15× capital spread against a 2.5× operating spread is the freighter bug in passenger clothing.

## Where the 767-300 actually sits

Fitting capital-cost-per-seat against `eis` across the widebody cohort gives a trend of **+4.7% per year of vintage**. Read against that line:

| type | eis | actual $/seat | fitted $/seat | implied price | current |
|---|---|---|---|---|---|
| `a310300` | 1986 | $39k | $75k | **$21M** | $11M |
| `b767400er` | 2000 | $96k | $142k | **$53M** | $36M |
| `b767200er` | 1984 | $55k | $69k | $20M | $16M |
| **`b767300`** | **1988** | **$80k** | **$82k** | **$29M** | **$28M** |
| `a300600r` | 1988 | $66k | $82k | $30M | $24M |
| `a330200` | 1998 | $135k | $130k | $53M | $55M |

The 767-300 is within 3% of its own generation's line. **The A310-300 is the real outlier** — priced at roughly half what its vintage implies, and the single best return on capital in the game.

## Two levers, and a caveat before pulling either

**Caveat first.** The old-metal-pays-back-fast dynamic may be intended: cheap entry-level capital early, upgrade to modern metal once you can afford profit-per-week rather than return-on-capital. The profit-per-week sweep says the progression does work — the 767-300 wins nothing once you have capital. If that arc is the design, the complaint describes the early game working as intended, and the only defect is the A310-300 being mispriced *within* the cohort.

If you do want to compress it:

1. **Price lever.** Bring the pre-1995 widebody band up toward the trend line. Equalising payback to ~1.7× the modern cohort needs roughly a 2.6× increase across that band — drastic, and it would collide with era-mode's `ERA_NEW_BUILD_PREMIUM` pricing. A partial move that fixes only the genuine outliers (A310-300, 767-400ER) is much cheaper and lower-risk.

2. **Revenue lever — probably the better one.** An old 767-300 currently earns the same fare per seat as a 787-9. In reality it would not. A generational yield penalty (via `ticketPremium` below 1.0, or a cabin-age term in demand) attacks the problem where it originates instead of inflating capital costs, and it leaves era mode's pricing untouched.

Either way this wants a regression test in `aircraft-consistency-test.mjs` — the passenger mirror of the freighter `$M-per-tonne spread stays under 10x` check. Something like *capital cost per seat spread stays under 8× within a category, and no type's return on capital exceeds 2.5× the modern-cohort median.*

## Suggested reply to the complaint

The 767-300 isn't specifically underpriced — it's priced correctly for its generation, and its generation is priced generously across the board. The A310-300, 747-100 and 767-200ER all return capital faster than it does.

---

# Addendum 2 · Does the generational ladder actually deliver?

**Short answer: yes on operating cost — 16 of 18 replacements earn a genuine gain. But on widebodies the price premium eats the whole gain, and the 777X is broken outright.**

## Fuel per seat: the ladder is sound

Each current type against the type it replaces, versus the manufacturer's real-world claim:

| old → new | per-seat fuel | in-game gain | real claim | |
|---|---|---|---|---|
| `b737800` → `b737max8` | 2.12 → 1.84 | 13.2% | ~14% | ok |
| `a320ceo` → `a320neo` | 2.20 → 1.82 | 17.5% | ~15% | ok |
| `a321ceo` → `a321neo` | 2.10 → 1.63 | 22.5% | ~15% | ok |
| `e195` → `e195e2` | 2.43 → 1.82 | 25.4% | ~16% | ok |
| `b767300` → `b7878` | 2.00 → 1.77 | 11.6% | ~20% | ok |
| `a330300` → `a330neo` | 1.81 → 1.57 | 12.9% | ~14% | ok |
| `a340600` → `a3501000` | 2.63 → 1.77 | 32.9% | ~20% | ok |
| `b747400` → `b7478i` | 2.66 → 2.31 | 12.9% | ~13% | ok |
| **`b777200er` → `b7778x`** | **1.94 → 1.93** | **0.3%** | ~10% | **shortfall** |
| **`b777300er` → `b7779x`** | **1.73 → 1.71** | **1.4%** | ~10% | **shortfall** |

The narrowbody half is guarded by `aircraft-consistency-test.mjs` and is in good shape. The widebody half has no equivalent test, and that is where both failures sit.

## The 777X is the one place "newer is better" genuinely fails

The 777X-8 and 777X-9 are essentially reskins of the 777s they replace — 0.3% and 1.4% per-seat gain against a real GE9X-plus-composite-wing programme claiming 10%+. Measured in money at full utilisation they are actually **worse** than the aircraft they replace before you even pay for them (−3.0% and −0.6% per seat-km ex-capital).

This is a straightforward data fix: the `b7778x` and `b7779x` `fuelBurnPer100km` figures need to come down roughly 8–10% relative to the 777-200ER/-300ER.

## But the deeper answer is about price, not performance

Cost per seat-km at full utilisation, ex-capital versus all-in (including the weekly lease):

| old → new | ex-capital | all-in |
|---|---|---|
| `a321ceo` → `a321neo` | 17.9% better | **13.9% better** |
| `e195` → `e195e2` | 18.3% better | **14.2% better** |
| `a320ceo` → `a320neo` | 12.7% better | **8.9% better** |
| `b737800` → `b737max8` | 6.5% better | **3.5% better** |
| `a330300` → `a330neo` | 12.7% better | **7.4% better** |
| `b767300` → `b7878` | 10.6% better | **1.7% WORSE** |
| `a330200` → `a330800` | 3.4% better | **2.1% WORSE** |
| `a340300` → `a350900` | 8.6% better | **6.9% WORSE** |
| `b777300er` → `b7779x` | 0.6% worse | **5.1% WORSE** |
| `b777200er` → `b7778x` | 3.0% worse | **19.6% WORSE** |

**Every narrowbody upgrade stays profitable after you pay for it (3.5–14.2% better). Five of the widebody upgrades go negative.**

So newer widebodies genuinely *do* perform better — they just don't *pay* better, because the capital premium is larger than the efficiency gain it buys. A 787-8 burns 10.6% less per seat-km than a 767-300 and costs 4.4× the lease to hold.

## This is the 767-300 complaint from the other end

Addendum 1 found a 15.2× capital spread against a 2.5× operating spread across passenger widebodies. This is the same fact stated forwards: if capital cost rises 15× across a generation ladder while operating cost falls 2.5×, then at some point up the ladder the upgrade stops paying — and the table above shows exactly where it stops.

Two defects, then, not one:

1. **The 777X fuel figures are wrong** and should be fixed on their own merits.
2. **The widebody capital band is too wide** for the operating gain it buys. Narrowbodies show what the right relationship looks like — compressing the widebody band toward the narrowbody ratio would make every rung of the ladder pay, which is what "newer should perform better" actually requires.

Worth a test: *every replacement type must beat the type it replaces on all-in cost per seat-km, not just on fuel.* That is the invariant the question implies, and nothing currently checks it.

---

# Addendum 3 · Which of the "worse" pairs are actually defects

**Correction to Addendum 2.** That table compared a *used* older type against a *new* replacement. In classic mode the catalogue price of a closed line is its second-hand 2026 value, while an open line's price is new metal — so the older aircraft in most of those pairs was being priced as a ten-year-old airframe. That is not a generational defect; it is the used market working.

Re-running with both sides priced as factory-fresh (`ERA_NEW_BUILD_PREMIUM = 2.5` applied to closed lines, delivered age 0):

| old → new | as catalogue stands | new vs new | |
|---|---|---|---|
| `b767300` → `b7878` | −1.7% | **+0.1%** | false alarm |
| `a330200` → `a330800` | −2.1% | **+6.8%** | false alarm |
| `b777300er` → `b7779x` | −5.1% | **+13.8%** | false alarm |
| `a340300` → `a350900` | −6.9% | **−5.0%** | marginal |
| `b777200er` → `b7778x` | −19.6% | **−12.1%** | **real** |
| `b747400` → `b7478i` | +0.9% | **−20.1%** | **real** (and hidden before) |

Note the 747 pair moves the *other* way — it looked fine only because the 747-400 was priced used. New against new, the 747-8I is the worst generational step in the game.

## Fix these

**1. The 777X fuel figures.** `b7778x` gains 0.3% per seat over the 777-200ER and `b7779x` gains 1.4% over the 777-300ER, against a real GE9X-and-new-wing programme claiming ~10%. This is a plain spec error and is worth correcting whatever you decide about pricing — it also removes most of the −12.1% on the 777X-8. Both figures want to come down roughly 8–10%.

**2. Nine types are out of production but still arrive factory-fresh.** The suite's `no out-of-production passenger type is delivered factory-fresh` test filters to `t.eis <= 2004`, so anything newer slips past it:

| type | line closed | arrives | weekly lease |
|---|---|---|---|
| `b777200lr` | 2013 (13y ago) | 0w | $207,000 |
| `b7478i` | 2017 (9y ago) | 0w | $463,000 |
| `an148` | 2018 | 0w | $32,000 |
| `ma600` | 2019 | 0w | $31,000 |
| `crj1000` | 2020 | 0w | $51,000 |
| `a380` | 2021 (5y ago) | 0w | $740,000 |
| `e190` | 2021 | 0w | $55,000 |
| `e195` | 2021 | 0w | $60,000 |
| `ssj100` | 2022 | 0w | $56,000 |

(`concorde` is also on this list and is the documented exception.)

This is the root of the 747-8I result: a type nine years out of production, paying new-metal lease, with no delivered age to offset it. Giving these their band would fix the 747-8I generational step without touching its price.

**It also connects to the A380.** The A380 is the single biggest winner in the game — 17.8% of all decided missions — and it too arrives factory-fresh from a line that closed in 2021. Banding it is a more principled way to trim that dominance than reaching for its price.

The fix is to drop the `eis <= 2004` filter from that test and let the band table cover every closed line.

## Leave these alone

- **`b767300` → `b7878`, `a330200` → `a330800`, `b777300er` → `b7779x`.** All positive new-vs-new. The gap you see in-game is a used airframe costing less to own than a new one, which is correct and is what makes a fleet decision interesting.
- **`a340300` → `a350900` at −5%.** The A350 buys 15.7% better fuel and 1,500 km more range for a 5% all-in premium at full utilisation. That is a tradeoff, not a defect.

## The general principle

Not every "newer is worse all-in" result is a bug. A ten-year-old airframe *should* cost less per seat-km to own than a new one — that is the second-hand market, and flattening it would remove the reason to ever buy used. The test worth encoding is narrower than Addendum 2 implied:

> *Priced as new metal against new metal, every replacement type must beat the type it replaces on all-in cost per seat-km.*

That invariant catches the 777X-8 and the 747-8I and passes everything else.

---

# Addendum 4 · Changes applied (2026-09-20)

All 156 test suites pass. `src/data/aircraft.js` was clean before this work, so `git diff src/data/aircraft.js` shows only these changes. Nothing was committed — the tree already held 57 files of in-progress fuel-farm work.

## Applied

**Turboprop fuel recalibration** — every Turboprop-category type raised toward the jets' 92–98%-of-real scale. Verified figures used directly where research supplied them (`q400` 137.25 → 233, `atr72` 122.75 → 176, `il18` 210 → 456, `vanguard` 215 → 348); the rest moved by a banded multiplier (×1.55 for `eis ≥ 1975`, ×1.85 before).

Effect on the mission sweep:

| | before | after |
|---|---|---|
| `il18` wins | 49 | **1** |
| `vanguard` wins | 18 | **6** |
| `e195e2` wins | 23 | **55** |
| vintage share of wins | 3.9% | **1.4%** |
| `c208b` margin over #2 | ×2.99 | **×1.20** |

The E195-E2 result is the one that matters: modern regional jets have their niche back.

**777X fuel** — `b7778x` 861 → 777, `b7779x` 937.75 → 856, giving each ~10% per seat over the frame it replaces instead of 0.3% and 1.4%.

**Closed lines no longer arrive factory-fresh** — nine types given a delivered age equal to how long their line has been shut: `b777200lr` 676w, `b7478i` 468w, `an148` 416w, `ma600` 364w, `crj1000` 312w, `a380`/`e190`/`e195` 260w, `ssj100` 208w.

**Dash 7 repriced** — $12,000 → $30,000/week, $5.0M → $15M (10.4% lease yield, inside the 8–15% band). It was leasing for less than a 40-seat Dash 8-200 while carrying 54 seats into 1,000 ft less runway.

**Spec corrections** — `b737max7` eis 2023 → 2027, `b737max10` 2025 → 2028, `a319neo` 2019 → 2022, `yak40` seats 40 → 32, `hs748` 48 → 58, `b377` 100 → 114, `emb120` oop 2001 → 2007, `b767200sf` burn 640 → 535 (it was out-burning the larger 767-300F).

**Tests** — new `tools/aircraft-generation-test.mjs` (3 checks: no propeller beats the best modern jet per seat; a turboprop's advantage over a same-size RJ stays under 40%; every replacement beats its predecessor by at least 5% per seat). `aircraft-consistency-test.mjs` extended: `expectedAgeBand()` now handles lines that closed after 2004, and the factory-fresh check covers every closed line rather than only `eis <= 2004`.

## Two things I got wrong, caught by your own suite

**Freighter payloads.** I had queued `dc1030f` 78 → 65 t, `a300600f` 54 → 48 t and `e190f` 13 → 11 t from the research pass. The consistency suite's own `REAL` table says 77, 54 and 13.5 — and it is better sourced (Embraer publishes 13.5 t for the E190F; my researcher was quoting charter-site *typical* payloads, not max structural). All three reverted. The suite also caught that the E190F change pushed the freighter $M-per-tonne spread to 10.2×, over its 10× guard.

**My own generational test.** The first version hand-rolled a cost model and disagreed with the engine by up to 50 points on the same pairs. It is not in the file. The reason is written into the test as a comment: reconstructing a "new" price for a closed line via one global `ERA_NEW_BUILD_PREMIUM` cannot fairly span a 1989 747-400 and a 2012 747-8I, and the verdict swings by tens of percent depending on which side you lift.

## Deliberately NOT applied

**Range corrections.** Ten types carry ferry or reduced-payload range where the field wants max-payload range (`b727200f` 3,500 → ~1,900 km, `b767200sf` 6,000 → ~3,700, `b707320` 10,650 → ~6,920, `dc863` 11,000 → ~7,400, `il96300` 11,500 → ~8,000, `tu204` 6,500 → ~4,300, `casacn235` 4,355 → ~2,870, `an148` 5,100 → ~3,500, `dc873f` 7,400 → ~5,400, `a330200f` 7,400 → ~5,900).

These are genuine errors, but `simulation.js` handles an over-range route with `if (dist > effectiveRange) return null` — no suspension, no news-log entry, no UI warning. Cutting these ranges would **silently zero revenue** on live routes while the player keeps paying costs, with nothing on screen explaining why. They need a migration path first: surface the route as grounded, post a news item, and let the player re-equip. Worth doing as its own change.

**The widebody capital band.** Still 15.2× per seat against a 2.5× operating spread. Compressing it is the fix for both the 767-300 complaint and the generational ladder, but it is a design decision with real blast radius on existing saves, and the right move is to model it before committing. The test that would guard it is documented in `aircraft-generation-test.mjs` but not asserted, because it would fail on day one.

**`spacejet`.** Flagged as a spec error (programme cancelled 2023, never entered service). Left alone — a what-if SpaceJet is the same kind of deliberate counterfactual as a still-flying Concorde, and removing it removes content.

## One correction to Addendum 1

The Dash 7's ×11.7 → ×16.5 margin over second place is largely a **grid artefact**, not 46 distinct problems. Its wins are almost entirely one airport — Barra, 2,776 ft — sampled at twelve demand levels, several of which (up to 59,000 passengers a week) Barra would never see. Second place is a 19-seat Twin Otter earning $5.5k, so the *ratio* is large while the situation is single. The reprice stands on the comparison with the Dash 8-200, not on that ratio.

---

# Addendum 5 · Range migration (2026-09-20)

157 suites pass, including the new `tools/range-stranding-test.mjs` (13 checks). A mutation check confirmed the test catches the weekly hook being removed.

## The bug underneath

`simulateRoute`, `simulateTagRoute` and `simulateCargoRoute` all `return null` for a leg beyond `effectiveRangeKm`, and `weeklyTick` does `if (!result) continue;`. Correct physics, silent failure: the route earned nothing, its aircraft kept billing lease and maintenance, and nothing anywhere said why. This was **reachable before the audit** — a cabin refit that costs range could always strand a route — so the fix closes a latent bug as well as making the range corrections safe to ship.

## What was built

- **Detector** (`simulation.js`): `routeRangeShortfall(route, aircraft)` and `rangeStrandedRoutes(state)`. They measure exactly as the tick does — unrounded `distanceKm` against `effectiveRangeKm` — so a route is flagged if and only if the tick will refuse it. Single-leg, multi-stop (reports the leg that fails, not the first) and cargo.
- **Reducer** (`GameContext.jsx`): `applyRangeStranding(state)` flags newly stranded routes with `route.rangeStranded`, clears the flag when a route is reachable again, and writes a tier-1 news row plus a toast. Returns the same object when nothing changed, so it runs as a re-entering pre-tick transform in `ADVANCE_WEEK` (the Comet 1 grounding pattern) without looping. Also runs on **save load**, news-only (the schedule-trim precedent), so affected players read why before they advance a week. `REASSIGN_ROUTE` clears the flag immediately.
- **UI**: shared `OutOfRangeBadge.jsx` on the Routes page and the cargo routes list, with the leg, the shortfall and the fix in its tooltip; stranded routes dim like grounded ones and count under the existing *Disrupted* filter. News renders `route_out_of_range` rows in full.

Nothing is closed or moved automatically. `REASSIGN_ROUTE` already keeps a route's ramp and pricing, so the notice points at the cheap fix and leaves the decision with the player.

## Range corrections — applied on the catalogue's own convention

Checking anchor types showed the catalogue uses **two conventions**: passenger aircraft carry the manufacturer's *headline* range (every modern jet matches exactly), and freighters carry range *at max structural payload*. The research list mixed the two — several of its "corrections" were max-payload figures for passenger types, which would have put them on a different basis from every other passenger jet. Only corrections that are wrong on the game's own convention were applied:

| type | was | now | basis |
|---|---|---|---|
| `a330200f` | 7,400 | **5,900** | Airbus: 5,900 km at 70 t (7,400 is at 65 t) |
| `b767200sf` | 6,000 | **3,700** | max-payload range, Aircraft Commerce |
| `dc873f` | 7,400 | **5,400** | max-payload range |
| `dc863` | 11,000 | **7,400** | out-ranged the long-range DC-8-62 it was a stretch of |
| `il96300` | 11,500 | **11,000** | Ilyushin headline range |
| `an148` | 5,100 | **3,500** | the type is named the -100B; 5,100 matches no -100B figure |

## Not applied, and why

| type | reason |
|---|---|
| `b707320` | research supplied the 6,920 km *max-payload* figure; the game uses headline range for passenger jets, and no verified headline figure was found |
| `tu204` | variant and basis both ambiguous across sources |
| `casacn235` | 4,355 km may be the headline figure; basis unclear |
| `b727200f` | only source was a charter broker — the same class of source that produced the wrong freighter payloads |

## Housekeeping

The `era.js` header still says `tools/golden-master/run.mjs must stay PARITY OK`; that directory was removed in an earlier commit, so the reference is stale.

*(Fixed in Addendum 7, item 4.)*

---

# Addendum 6 · Headwinds port, and a toast bug in the Tailwinds release (2026-09-21)

## A bug in 5e1e818, found while porting

`ADVANCE_WEEK` **replaces** `state.pendingToasts` with the week's own list. The stranding pass runs pre-tick and re-enters the reducer, so the toast it queued was thrown away by the very tick it announced. The Comet 1 grounding — the pattern the pass was modelled on — hit the same wall and only preserves pre-tick toasts in era games. Net effect in 5e1e818: in a **classic** game the news row and the badge worked, and the toast never appeared. The original test checked the toast on a direct `applyRangeStranding` call and never through `ADVANCE_WEEK`, which is how it got through.

**Fix:** `rangeStrandToasts(state, absWeek)` builds the toast from routes whose `rangeStranded.since` is the week being processed; `ADVANCE_WEEK` spreads it into its own toast list, and the pre-tick pass runs with `{ toast: false }`. A new test (*the toast survives the weekly tick in a classic game*) was verified failing on 5e1e818 before the fix.

Also added: `TRANSFER_ROUTES` now clears the flag too (`transferCompatibility` already range-checks every leg), so swapping a longer-range tail in removes the badge immediately rather than a week later. Verified failing first.

And `tools/range-stranding-ui-test.mjs`: SSR-renders the real Routes page and cargo list inside `GameProvider`. In Tailwinds it goes through the real load path — `reconcileState` → `applyRangeStranding` → badge — using `rangeMod` to make routes genuinely unreachable, because the load pass clears a hand-set flag on a route that is actually in range.

## Headwinds

The shared-engine sync tool is retired (it rsyncs with `--delete` and would clobber Headwinds-only work), so this was a hand port.

**Data.** On the 193 types the two catalogues share, every field the audit touched was identical before the audit. Headwinds lacks only the four business jets, none of which were edited. The 79 field changes were derived from Tailwinds' actual pre→post data and replayed with each old value verified. Afterwards the two catalogues match on every audited field; the only remaining difference is Headwinds' own `doubleDeck` flag.

**Engine.** Detector ported verbatim into `packages/engine/src/utils/simulation.js`; `applyRangeStranding`, `rangeStrandToasts`, the pre-tick hook and both flag-clears in `packages/engine/src/reducer.mjs`.

**One deliberate difference: no news row.** Headwinds' News tab is the world's shared feed, served identically to every viewer; a stranded route is private and would tell rivals about your network. The durable record is the flag itself — the badge and the *Disrupted* filter — plus the toast, which `tickService` carries forward (up to 40) for players who are away. No load-time pass: in multiplayer, state only changes at ticks and actions, and a stranded route loses nothing until the next tick, which flags it.

**UI.** Same badge, same Routes and cargo-list changes.

## Verification

- Engine behaviour verified failing on Headwinds HEAD `29e9be1` with a throwaway probe of the old call path, rather than an import error.
- The UI test was verified failing on HEAD's components. The first cut **passed on HEAD** — the Routes page embeds the cargo list, so a flagged cargo route put a badge on it by itself. The test now flags each route separately and asserts on text only the passenger group badge carries.
- Golden master (`run.mjs`): PARITY OK. Its fixtures fly only an A320ceo, an A320neo and a 787-9, none of which that round touched — so it is **not** coverage for an aircraft rebalance.
- Beta-world parity was already failing on Headwinds HEAD, bisected to `3d8e727` (gate fee cap); re-baselined separately in `b61f66d`.

## Observation (multiplayer, pre-existing)

`buildRivalViews` counted every route's frequency and capacity, including routes that were not flying. Fixed in Addendum 7, item 12.

---

# Addendum 7 · The remaining twelve (2026-09-24)

Twelve items were left open after Addendum 6. All twelve were measured again on the current data before anything changed. Nine are fixed. Two turned out not to be defects and stay unchanged, with the reasons below. One (the widebody capital band) was fixed narrowly rather than across the board. Tailwinds 165/165 suites, Headwinds 217/217. Each new behaviour has a test that fails on HEAD.

## 1 · The deadweight report now costs aircraft the way the tick does

`fixedWeeklyParts(t)` in `tools/catalogue-deadweight-report.mjs` charges maintenance at the delivered-age multiplier, hull insurance on vintage (owned) frames, and an imputed capital charge instead of a catalogue lease for buy-only vintage metal. The capital charge uses `VINTAGE_CAPITAL_YIELD`, the median lease yield, which is 12.1%. The new `tools/deadweight-model-test.mjs` runs a one-aircraft `weeklyTick` for a new A320neo, an aged 737-800 and a vintage Vanguard and checks the report agrees within 1%. On HEAD the report was off by 15% on the 737-800 and 5.5× on the Vanguard's maintenance.

## 2 · Closed lines priced as new metal

The convention: for a closed line, `purchasePrice` is what a used frame fetches at `deliveredAgeWeeks`, and era worlds multiply it by 2.5 while the line is open. Four widebodies broke that convention.

| type | was | now | why |
|---|---|---|---|
| `b7478i` | $190M / $463k, 9y | **$80M / $186k** | 747-400 sibling is $55M at 10y; +45% for 13% less fuel per seat and 1,400 km more range. It had the worst return on capital in its cohort and won nothing |
| `b777200lr` | 13y, $85M / $207k | **6y (`bandEis` 1997), $62M / $152k** | same line and same closure year as the 777-200ER, which arrives 6y old at $48M; +30% is the real list-price ratio |
| `a380`, `b777300er` | — | **`pricedAsNew: true`** | see 9 |

After the change, both the 747-8I and the 777-200LR are close alternatives in the sweep (91.5% and 93.4% of the winner at their peaks). Neither takes a mission from anything else.

## 3 · 777X-8

The earlier −12.1% compared the 777-8 with the wrong predecessor. Boeing's ultra-long-range shrink replaces the **777-200LR**, and new against new the gap to that aircraft was −1.1%. The remaining gap is maintenance and crew cost per seat, which is true of the real aircraft: it is sold for its range. Price trimmed from $195M/$471k to **$180M/$435k**, 0.84× the 777-9, which makes it +0.4% new against new. `aircraft-generation-test` now includes the `b777200lr → b7778x` pair.

## 4 · `era.js` comment

Now points at `tools/era-calendar-test.mjs` for Tailwinds and notes that the golden master lives in Headwinds.

## 5 · The four held-back ranges

`b707320` 10,650 → **9,260** km (Boeing headline, 141 passengers in two classes) and `tu204` 6,500 → **4,600** km (210 passengers). `casacn235` stays at 4,355, with no figure on the catalogue's basis to replace it. `b727200f` stays unchanged because its payload and range sources disagree. Range stranding (Addenda 5 and 6) covers any live route these changes affect.

## 6 · Turboprops off the blanket multiplier

29 propeller types were given their own figure: 0.95 × a verified real burn, where the source had at least medium confidence. 14 went up and 15 came down. The largest moves: `do228` +72%, `c46` +65%, `atr72f` +45% (the ATR 72F was never raised with the ATR 72), `dc3`/`c47` −33%, `bn2islander` −25%, `l188` −24%. `atr42` stays at 137.18: the only published figure is a max-cruise fuel flow (811 kg/h against about 600 typical), and using it put the ATR 42 behind the CRJ-200 per seat, which the generation test caught. A twins guard now keeps `atr72` and `atr72f` together.

## 7 · Runway convention

The catalogue's rule, taken from its own class medians, is `runwayFt` ≈ 0.85 × real MTOW takeoff field length for short-haul types (narrowbodies, regional jets and light freighters) and ≈ 1.00 × for long-haul types. 21 types were more than 15% off that rule and are now at the edge of the ±15% band, so each moves as little as possible. Largest moves: `b747400d` 9,800 → 7,500, `tu204` 7,200 → 5,700, `b737900er` 5,700 → 7,100, `b737200` 5,000 → 6,150. `b737500` and `c919` are documented exceptions. The new `tools/aircraft-runway-convention-test.mjs` holds 127 real takeoff lengths (123 in Headwinds, which has no business jets). It checks the band, checks the class medians, and checks that STOL types keep their short-field figures. The tick never checks runways, so routes already flying are grandfathered and the new figures bind at route creation and reassignment.

## 8 · Widebody capital band: fixed narrowly, not compressed

Measured again. The spread is 12.1× per seat on leases (15× on purchase price, set by the buy-only 747-100). Compressing it was rejected for three reasons.

- **Real lease markets span more than this game does.** A new A350-900 leases for about 8.5× a 25-year-old 767-300ER. In the game the comparable pair is 5.9×.
- **The sweep shows no harm per airframe.** Cheap old widebodies win nothing. The 767-300 wins zero missions on both the grid and realistic demand.
- **Where old metal leads, it leads on return on capital.** Return on capital (surplus before ownership ÷ price) runs from 2.2× the widebody median (A310-300) down to 0.29× (A350-900ULR). That is the used market working, with age-driven maintenance already charged.

What *was* wrong was inside cohorts, and that is fixed:

- `a310300` $11M/$27k → **$18M/$43k**. It was cheaper than the older, shorter-ranged A310-200 ($15M), which made it the best return on capital in the game.
- `il96300` $50M/$109k → **$30M/$65k**, the A340-300's $91k/seat at the same age. It burns 80% more per seat.

The new `tools/aircraft-pricing-guard-test.mjs` is the passenger mirror of the freighter spread guard. It checks four things:

- within a family, the newer variant never sells for less per seat;
- the 777-200ER and -200LR arrive at the same age;
- a used frame never costs more per seat than new metal of the type that replaces it;
- in an era world, no closed widebody costs more new than 1.5× the dearest open-line widebody per seat.

Four of its five checks fail on HEAD. `aircraft-consistency-test`'s price floor now treats a used frame from the 2010+ generation against the band below, because its $180k/seat floor is a new-metal floor.

## 9 · A380: no price change, one era fix

Measured against the game's real market sizes (`baseCityPairDemand`, at 25%, 50% and 100% capture) rather than the grid's 60–60,000:

- **It wins 11 of 69 decided missions (15.9%), all long-haul trunks carrying 13,000+ passengers a week, at a median margin of 1.23.** It never wins short-haul or thin routes.
- **It has the second-worst return on capital among widebodies** (0.34× median).
- **Two 777-300ERs beat one A380 per dollar.** On JFK–LHR at 26,200 passengers a week, two 777-300ERs splitting the market earn $3.57M on $806k of ownership. One A380 earns $2.71M on $740k.

So it is not dominant for a player who is short of capital, which is every player until late game. Cutting it to a used price (about $100–170M on any consistent rule) would make it dominant, as it would the 777-300ER at a used price. Both therefore keep new-metal prices on purpose, and are flagged `pricedAsNew`. `eraPriceScale` returns 1 for them. Before this fix, era worlds added the 2.5× new-build premium on top of a price that was already new: a 2010 A380 cost **$762M** and a 2005 777-300ER $425M.

Not fixed, noted: the same era double-premium check across other categories flags `casacn235`, `a330200f`, `b7478f`, `l410` and `do228`. Each needs a judgement on whether its catalogue price is a used or a new figure.

## 10 · The vintage cliff is a ramp

`vintageDeliveredAgeWeeks` now ramps delivered age linearly from the published band at 35 years closed (`VINTAGE_RAMP_FROM_YEARS`) to the 20-year floor at 50, then on to the 30-year cap as before. Buy-only stays a hard line at 50 years, because that rule is about lessor behaviour, not wear. `isVintage` membership is unchanged. Examples: the Il-18 now arrives at 19.5y instead of 16y (maintenance 2.89× instead of 2.28×), and the 727-200 at 17.9y instead of 16y. `era-availability-test` gains a *no cliff* check: age never falls, and it never jumps more than a year per year closed.

## 11 · Lease vs buy: not a defect

Engine terms: straight-line value to a 10% floor at 30 years, 0.8% hull insurance on book value, a 5% selling fee, 4 weeks' lease as a redelivery charge, 12 weeks' refundable deposit, aircraft finance at 6.5% on 70% of value, and no interest on cash. On those terms, owning costs **0.4–0.6× leasing** over holds of two years or more when the cash is idle, and **0.6–0.85×** with aircraft finance. Leasing costs about 10–13% a year of the price. Aircraft return 50–370% a year on their best missions. So leasing is the cheaper way to fund growth, and buying is the better use of idle cash. That is how aviation finance works in reality. The lever that would keep leasing competitive late in the game is interest on idle cash, which is a design decision that touches every save's P&L. It is left for Dave to decide.

## 12 · Headwinds: rivals counted capacity that wasn't flying

`toRivalSpecs` and `toHumanCompetitor` (and `cargoRoutesOf`) in `apps/headwinds-server/src/lib/humanRivals.mjs` built every rival's offer from every route in their blob. `rivalOffersFor` counts a human competitor even without a spec, so both views needed the fix. `flyingThisWeek(state)` now mirrors the tick:

- the route is in season this month (the rival's own calendar);
- the aircraft is in service, or back this week, since `tickPrep` runs the downtime countdowns before the revenue sim;
- the route is not retired, and every leg is in range.

A route covered by a reserve already names the reserve, so it is judged on the tail actually flying it. End to end, a rival grounded for four weeks had been taking **$11,964 a week** of revenue from a JFK–BOS competitor in the test world, relative to a rival that flies nothing. The new `tools/rival-capacity-flying-test.mjs` has 9 checks, 7 of which were verified failing on HEAD. `rival-map-test`'s freight fixture now uses freighters that can reach its JFK–LHR lane.

A rival that flies nothing still costs a competitor something through brand and share of voice. That is outside this item.

## Headwinds port and golden masters

The 66 field edits were derived from Tailwinds' pre→post data and replayed with every old value verified (66/66). The vintage-ramp and `pricedAsNew` engine hunks were applied by patch. The test changes were ported by hand where the files had diverged. Both golden masters (`run.mjs` and `beta-world`) stay PARITY OK with the rival fix on HEAD's catalogue. With the catalogue changes both hashes moved while their projections stayed identical: AI competitors fly catalogue types, so their cash and share prices shift. This is an intended balance change, and both were re-baselined with `--update`.

## Mission sweep, before and after this round (corrected model)

| | before | after |
|---|---|---|
| distinct winners | 28 | 28 |
| top share | A380 18.4% | A380 18.5% |
| largest real margin over #2 | ×1.24 (A380) | ×1.24 (A380) |

(The Dash 7's ×16 is the Barra grid artefact from Addendum 4.) No new dominant choice appears. The largest movement is inside the turboprop mix, where the Q400 moves up and the Saab 2000 and Short 360 move down with their real burns.
