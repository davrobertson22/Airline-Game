# Timetables That Matter: Design

Status: **proposal, nothing built.** Written 2026-11-10 from a Discord
suggestion ("Better Scheduling Mode"). The first half of that suggestion, a
timetable editor you can type into, is built in Tailwinds (see "What is
already built"). This document covers the half that changes the game.

Scope chosen by Dave (2026-11-10): **peak-hour demand and slot pricing**, and
**hub connection waves**. Night curfews and overnighting at outstations were
suggested too and are left out of this design (§10). The automatic timetable
must stay competent: a player who never opens the Schedule page is not
punished, and a player who tunes it gains a modest edge.

Intended for both games, Tailwinds first. New games and new worlds only.

## 1. Where things stand

- The weekly tick never reads a time of day. `models/schedule.js` turns each
  route's weekly frequency into a timetable for the Schedule page and the
  departure board, and nothing else.
- A route stores only the departures the player has set (`schedule.starts`,
  minutes into the UTC week). Every other flight is placed automatically:
  evenly spaced round the week, the first leaving between 06:00 and 09:00
  local at the first route's origin. The automatic placement knows nothing
  about rush hours or about what else lands at the hub.
- Frequency already sells seats. In demand model v4, `scheduleConvenience(f)`
  scales a pair's demand by how many departures a week it gets, and frequency
  share wins passengers on a contested pair. Both assume the departures are
  usefully spread through the day; nothing checks that they are.
- Landing fees are charged per departure from a table of aircraft category by
  airport tier (`LANDING_FEE_PER_DEPARTURE`: a narrow body pays $2,400 a
  movement at a major airport and $3,800 at a mega one), the same at 03:00 as
  at 08:00. On a short trunk they come to roughly a tenth to a sixth of
  revenue, so they are big enough to steer behaviour.
- Connections are worked out per hub from frequency alone. Every pair of the
  player's routes at a hub connects, with a fixed 1.5 hour connect time
  (`CONNECT_TIME_HOURS`), and an A to C itinerary through the hub is sold at
  the lower of its two legs' frequencies. Rival one-stop itineraries work the
  same way where the hub package is on.
- AI rivals have no timetable at all.
- New Tailwinds games cap aircraft at 100 block hours a week, so a tail has
  about 68 hours of ground time a week to arrange. There is room to move
  flights around without flying less.

## 2. Principles

1. **The tick stays weekly.** The timetable is boiled down to a few factors
   per route and per hub pair, and the existing weekly model consumes them.
   No flight-by-flight simulation.
2. **Automatic is par.** Every factor is calibrated so the automatic timetable
   scores 1.0, give or take a couple of percent. That is a test, not a hope
   (§8). Tuning by hand can beat par by a bounded amount.
3. **More downside than upside.** A silly timetable (everything at 03:00) is
   clearly worse. A good one is a little better. This keeps the edge modest
   and stops timetabling becoming the only thing that matters.
4. **Rivals fly at par.** AI airlines get factor 1.0 everywhere. They gain
   and lose nothing from the feature and need no new AI.
5. **Bounded, and behind a flag.** Each factor has a hard floor and cap. All
   of it sits behind a world flag that only a new game sets, so existing
   saves and the golden master are untouched.

## 3. Peak-hour demand

Each departure is scored by when it leaves and when it arrives, in local time
at each end, separately for business and leisure travellers.

| Local departure | Business, short haul | Leisure, short haul |
|---|---|---|
| 06:30 to 09:00 | 1.05 | 1.00 |
| 09:00 to 16:00 | 0.95 | 1.02 |
| 16:00 to 19:30 | 1.05 | 1.00 |
| 19:30 to 22:30 | 0.92 | 0.96 |
| 22:30 to 05:30 | 0.70 | 0.80 |
| 05:30 to 06:30 | 0.92 | 0.90 |

- "Short haul" is a sector under about four hours. Past that, the departure
  time matters less and the arrival time more: an overnight flight that lands
  between 05:30 and 10:00 is a good flight, one that lands at 02:00 is not.
  Long sectors use an arrival-time table of the same shape, and the two are
  blended by sector length.
- A route's score for a segment is the average over every flight it flies,
  both directions. The return leg counts.
- The score multiplies the place where frequency already enters demand, so a
  route at par behaves exactly as it does today. Proposed bounds per route:
  **0.80 to 1.04**.
- **Bunching.** Two departures on the same pair in the same direction less
  than an hour apart serve the same travellers. Frequency fed to
  `scheduleConvenience` and to frequency share is counted as effective
  frequency: a departure within 60 minutes of the previous one on that pair
  counts as half a departure. This is across all of an airline's aircraft on
  the pair, which is what makes spreading a 14-a-day trunk through the day a
  real job. The automatic timetable must spread them (§6).

Figures in the table are proposals to calibrate, not final.

## 4. Slot pricing by hour

The landing fee at each end of a flight is multiplied by the time band the
movement falls in, local time at that airport.

| Band | Mega | Major | Regional |
|---|---|---|---|
| Peak (06:30 to 09:30, 16:30 to 20:00) | 1.35 | 1.20 | 1.00 |
| Day (09:30 to 16:30) | 0.90 | 0.95 | 1.00 |
| Evening (20:00 to 23:00) | 0.85 | 0.90 | 1.00 |
| Night (23:00 to 06:30) | 0.60 | 0.75 | 1.00 |

- Calibrated so the automatic timetable's total landing bill is what it is
  today (par). Tuning moves money between bands, it does not add a new cost.
- This is the trade the suggestion asked for. A premium airline buys the
  peaks because its business travellers pay for them. A low-cost airline with
  mostly leisure demand can fly at midday and late evening, give up little
  demand and save 10 to 25 percent of its landing fees at big airports.
  Calibration target: on a business-heavy trunk the peaks win; on a leisure
  route off-peak wins; break-even at roughly 35 to 40 percent business share.
- **Price only, no scarcity.** There is no limited pool of peak slots to bid
  for or to hoard. That would be a much bigger system (allocation, fairness
  between players in Headwinds, and the same hoarding worry as the order
  book), and the price already produces the behaviour.
- Gate rent and the slot count per gate do not change.

## 5. Hub connection waves

Today any two routes at a hub connect. With this on, a connection exists only
if the timetable makes it.

For a hub H and two spokes A and C:

- Take every arrival at H from A in the week. For each, find the next
  departure to C. The wait between them scores:
  - shorter than the minimum connect time (45 minutes; 75 where either leg is
    long haul): no connection;
  - from the minimum up to an hour past it: 1.0;
  - then falling steadily, to 0.4 at four hours and to nothing at six.
- Do the same for C to A. The pair's **connection quality** q is the average
  score over all arrivals in both directions. Better hub tiers can shorten
  the minimum connect time, which gives hub upgrades something new to do.
- q replaces the two things that are fixed today:
  - the itinerary's sellable frequency, today the lower of its two legs'
    frequencies, is multiplied by q over par, where par is the q the
    automatic timetable achieves on a reference set of airlines. Bounded
    **0 to 1.15**;
  - the connect time in the trip-time penalty becomes the real average wait
    instead of 1.5 hours.
- So a hub on the automatic timetable sells what it sells today. A hub whose
  banks are tuned by hand sells up to 15 percent more connecting frequency.
  A spoke that lands after everything has left sells none.
- Rival hubs stay at par. A candidate route in the Route Finder is not
  timetabled yet, so its forecast assumes par connections; the forecast is
  then honest for anyone on the automatic timetable.
- Rotations stay rigid in this version: out, turn, back, turn, as charged
  today. The player tunes waves by choosing when rotations leave. Holding an
  aircraft at the outstation to hit a later bank is the natural next step and
  is the same mechanism as overnighting (§10).

### Cost

The tick needs every tail's week. `airlineWeeks` is already cached per tail by
route signature, so it is rebuilt only for tails whose routes changed. The
arrivals and departures per hub and spoke are built once per state change and
reused by every Route Finder forecast row. Scoring a hub's top 150 markets is
a few thousand binary searches.

## 6. The automatic timetable, version 2

This is the piece the whole design rests on. If the automatic timetable is
not good, "automatic stays competent" is false and every casual player loses
a few percent for nothing.

- **Avoid the dead hours.** Rotations are placed so that short-haul
  departures and long-haul arrivals stay out of the night band where the
  tail's week allows it.
- **Spread a pair through the day.** All of an airline's departures on one
  pair are spaced across the operating day, not just within each tail's
  morning wave as now.
- **A bank clock per hub.** Each hub gets fixed bank times from its tier
  alone (a focus city two a day, a fortress hub eight). A rotation that
  touches the hub is nudged, within a few hours of where even spacing would
  put it, so that it either leaves at a bank time or lands 45 to 90 minutes
  before one, whichever scores better. Because the clock depends only on the
  hub, each tail is still timetabled on its own. Adding a route never
  reshuffles the rest of the airline, and the per-tail cache keeps working.
- Still a pure function of the airline's state, the same on every device and
  on the Headwinds server.
- Under the flag only. Existing saves keep today's automatic timetable to the
  minute.

## 7. What the player sees

- **Schedule page.** With a flight selected, the timeline shades the peak and
  night bands at that route's origin. The panel shows the flight's demand
  score, its slot band at each end and what connects to it.
- **Hub view.** A new view on the Schedule page: for one hub, arrivals and
  departures by hour through the day, so banks are visible, and a list of the
  biggest connections that just miss ("BNE arrives 08:10, MEL left 07:55,
  about 140 passengers a week").
- **Route detail.** One line: timetable demand 1.02, slot cost 1.12, 86
  percent of arrivals connect.
- **Advisor.** Tips for the worst cases only: flights in the dead hours, a
  spoke that misses the bank, a trunk with bunched departures.
- **Reset to automatic** already exists and becomes "let the game do it".

## 8. Tests that define done

- Flag off: golden master parity, byte for byte.
- **Competent automatic.** Over a few hundred generated airlines of different
  shapes, the automatic timetable scores at least 0.97 on demand, at most
  1.03 of par on landing fees and at least par on connection quality.
- **Bounded edge.** On reference airlines, the best timetable found by search
  is worth no more than about 5 percent of profit over automatic.
- A deliberately bad timetable is worse, by a bounded amount.
- Same state, same factors, on every device.
- Tick and Route Finder time on the large reference saves do not move by more
  than a few percent.

## 9. Build order

| Package | What | Changes the game? |
|---|---|---|
| T0 | Typed timetable editor. Built in Tailwinds; port to Headwinds. | No |
| T1 | Scoring engine and read-outs. The Schedule page, hub view and route detail show what a timetable would be worth. | No. Shows numbers only |
| T2 | Automatic timetable version 2, under the flag. | No |
| T3 | Peak-hour demand and slot pricing take effect in new games. | Yes |
| T4 | Hub waves take effect in new games. | Yes |
| T5 | Headwinds port: server guard, world flag, tick. | Yes |

T1 before T3 is deliberate. Players and Dave see the scores on real airlines
for a release before anything depends on them, and the par calibration is
done on real saves instead of guesses.

Guides to update when T3 ships: `public/strategy.html` says demand and
connections are worked out from weekly frequency, not clock times. The
in-game Help and the Schedule page's own "it doesn't change demand or costs"
line change at the same time.

## 10. Left out

- **Night curfews.** Not chosen. They fit this design cleanly later: a curfew
  is a band the scheduler cannot use at that airport, on top of the slot
  price table.
- **Overnighting at outstations.** Not chosen. It needs a rotation that can
  hold at the spoke, which §5 also wants for tighter banks. If waves prove
  popular this is the follow-up.
- **Slot scarcity and slot auctions.** See §4.
- **Timetables for AI rivals.** Rivals fly at par.

## 11. Decisions for Dave

1. **Size of the edge.** Proposed: demand 0.80 to 1.04 per route, landing
   fees 0.60 to 1.35 by band, connections 0 to 1.15 per hub pair, adding up
   to no more than about 5 percent of profit over automatic. Bigger, smaller?
2. **One flag or two.** Proposed: one flag, `timetableRules`, with a version
   number like the demand model (1 is peak hours and slots, 2 adds waves), so
   T3 and T4 can ship separately but a game carries one setting.
3. **Bunching** (§3). Recommended, because without it a pair's departures can
   all leave together at 08:00 and score well. It does add work to the
   automatic timetable.
4. **Regular timetables.** The suggestion mentions premium airlines having
   fixed departures. A small business bonus (about 1 percent) for a route
   that leaves at the same clock times every day would reward that and the
   new week editor. Recommended as a later addition, not in T3.
5. **Hub tier and minimum connect time** (§5). Should better hubs connect
   faster? Recommended yes, modestly (45 minutes down to 35 at a fortress).
6. **Headwinds.** Every airline there is a player with a timetable, so the
   contest is symmetric. Should peak prices at an airport rise with how many
   players use that hour? Proposed: no in the first version.
7. **T1 first.** Ship the read-outs a release ahead of the effects, as §9
   proposes, or go straight to effects?

## What is already built (T0, Tailwinds, 2026-11-10)

Operations ▸ Schedule: click a flight and the panel takes

- a typed departure time for that flight, on its own day (local time at the
  route's origin; 07:30, 0730, 19 and 7pm all read);
- the route's whole week as rows of a time and the days it flies, set in one
  go. A 14 a week route is two times typed once. Ten a week is a daily row
  and a three-day row.

Two departures closer than a round trip are refused with the earliest time
that works. A time taken by a flight the player set on another route, or by a
charter, moves that day's flight to the nearest free time and says so; with
no room within twelve hours the flight is left automatic. Cosmetic like the
rest of the editor: no world flag, all saves.

Code: `models/schedule.js` (`parseClock`, `timetableRows`,
`pinsForTimetable`, `blockerFor`), `components/ScheduleTimeline.jsx`
(`TimetableForm`, `timetableNotice`). Tests: `tools/schedule-test.mjs` (54,
16 new) and `tools/schedule-ui-test.mjs` (24, 7 new); the new ones fail on
the code before the change. Checked in Chromium at desktop and phone widths:
typing, set, single-day change, clashes, guards, nudge, drag, reload.

Not ported to Headwinds yet (its folder was not linked to the session).
