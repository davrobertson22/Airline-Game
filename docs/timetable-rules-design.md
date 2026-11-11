# Timetables That Matter: Design

Status: **proposal for the parts not yet built.** Written 2026-11-10 from a
Discord suggestion ("Better Scheduling Mode"), corrected the same evening
after reading Headwinds.

- The typed timetable editor is built in both games (see the last section).
- **Hub connection waves already exist in Headwinds** as hub banks (shipped
  2026-11-05, new worlds, flag `hubBanksWorld`). The first draft of this
  document designed them from scratch without having seen that. §5 is now a
  port plan for Tailwinds, not a new design.
- **Peak-hour demand and slot pricing** (§3, §4) are new for both games and
  nothing of them is built.

Scope chosen by Dave (2026-11-10): peak-hour demand and slot pricing, and hub
connection waves. Night curfews were suggested too and are left out (§10).
The automatic timetable must stay competent: a player who never opens the
Schedule page is not punished, and a player who tunes it gains a modest edge.

New games and new worlds only.

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
- In Tailwinds, connections are worked out per hub from frequency alone.
  Every pair of the player's routes at a hub connects, with a fixed 1.5 hour
  connect time (`CONNECT_TIME_HOURS`), and an A to C itinerary through the hub
  is sold at the lower of its two legs' frequencies. Rival one-stop
  itineraries work the same way where the hub package is on.
- In Headwinds worlds with hub banks, connections already come from the
  timetable (§5). Everything else in this list is the same in both games.
- AI rivals have no timetable at all.
- New Tailwinds games cap aircraft at 100 block hours a week, so a tail has
  about 68 hours of ground time a week to arrange. There is room to move
  flights around without flying less.

## 2. Principles

These govern the new peak-hour rules (§3, §4). Hub banks follow Headwinds'
rules as built (§5).

1. **The tick stays weekly.** The timetable is boiled down to a few factors
   per route, and the existing weekly model consumes them.
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

## 5. Hub connection waves: port Headwinds' hub banks

Headwinds has had this since 2026-11-05 in new worlds. The rules, from its
engine (`packages/engine/src/models/schedule.js`, "Hub banks" and
"Connections from the timetable") and its devlog:

- A bank is a time of day at a hub. Flights land in the hour before it and
  leave in the hour after, so any inbound makes any outbound.
- Every designated hub, focus cities included, is banked by default: 3 banks
  a day, 4 at bigger hubs, 6 at the biggest (`autoBankCount`). The player can
  pick 3, 4 or 6, set custom times (up to 8, at least 90 minutes apart, hub
  local time), or choose Rolling for no banks.
- **The automatic timetable banks for you.** Each rotation through a banked
  hub leaves on a departure wave, and the aircraft waits at the far end, up
  to 4 hours, or overnight for the day's first bank, so that it comes back
  for an arrival wave. That waiting is the cost of banking: a busy tail fits
  fewer rotations.
- **Connections come from the timetable.** A connection works when the
  inbound lands 40 minutes to 6 hours before the onward flight leaves. How
  many of the possible connections work, and the real wait, decide how the
  itinerary competes. A pair the timetable never connects sells nothing.
- By its own devlog, the automatic banks connect nearly as many passengers as
  the old every-pair assumption did, and a hub left on Rolling connects far
  fewer. That is the "automatic stays competent" rule, already met.
- The Schedule page has a panel per hub: a 24-hour strip of arrivals and
  departures with banks shaded, connections a week, average wait, connecting
  passengers and how long aircraft wait for banks. A flight moved off a bank
  is marked, and Snap to the bank puts it back.

Two of the four ideas in the Discord post are therefore covered there: waves,
and aircraft sleeping at the outstation to make the morning bank.

### What the Tailwinds port involves

- A world flag for new games, as in Headwinds (`hubBanksWorld`), set at
  `START_GAME`, with a setup-screen option to turn it off.
- `models/schedule.js`: Tailwinds' copy was ported from Headwinds before
  banks existed. It needs the bank section, the banked automatic week and the
  timetable connections. The typed-time code in Tailwinds must then ask the
  week for a rotation's length (`durAt`), as the Headwinds copy already does.
- **Charters.** Tailwinds only. A charter is a fixed block the customer
  times; the banked week has to place round it, and a charter never waits
  for a bank. This is the one piece with no Headwinds answer.
- The connection maths in the tick and in every preview (`network.js`,
  `pairShare.js`, the Route Finder), kept in step as CLAUDE.md requires.
- AI rivals. Headwinds worlds are mostly other players, who all have
  timetables. Tailwinds rivals are all AI with none. Proposed: rival hubs
  connect at the rate the automatic banks achieve, so the player neither
  gains nor loses against them by default.
- The hub panel, the bank settings, Snap to the bank, guides and Help.
- Utilisation. Banked tails fit fewer rotations, and new Tailwinds games
  already cap aircraft at 100 block hours a week. The two need checking
  together on real saves before this ships.

## 6. The automatic timetable and peak hours

With banks, the automatic timetable already has a shape: flights cluster at
bank times. Peak-hour demand and slot pricing (§3, §4) then need only two
things from it.

- **Where the banks sit.** The preset bank times decide whether a hub's waves
  land in peak or off-peak bands. Presets should put the first and last
  banks on the business peaks, so an untouched hub scores par on demand.
  Custom bank times, which already exist in Headwinds, become the player's
  lever: move the banks off the peaks to save on slots, or keep them there
  for business demand.
- **Routes that touch no banked hub**, and Rolling hubs, are placed as today,
  with two additions: keep short-haul departures and long-haul arrivals out
  of the night band where the tail's week allows, and spread an airline's
  departures on one pair through the day (§3, bunching).

Still a pure function of the airline's state, the same on every device and
on the Headwinds server, and under a flag so existing saves and worlds keep
today's timetable to the minute.

## 7. What the player sees

- **Hub banks (T1, Tailwinds).** What Headwinds players have now: the hub
  panel on the Schedule page with its 24-hour strip, the bank settings, the
  marker on flights that miss a bank and Snap to the bank.
- **Peak hours (T2 on).** With a flight selected, the timeline shades the
  peak and night bands at that route's origin, and the panel shows the
  flight's demand score and its slot band at each end. The hub strip shades
  the same bands, so it is plain which banks are peak banks.
- **Route detail.** One line: timetable demand 1.02, slot cost 1.12.
- **Advisor.** Tips for the worst cases only: flights in the dead hours, a
  trunk with bunched departures.
- **Reset to automatic** already exists and stays the "let the game do it"
  button.

## 8. Tests that define done

- Flag off: golden master parity, byte for byte, in both repos.
- **Hub banks in Tailwinds** carry over Headwinds' own bank and connection
  tests, plus new ones for charters on a banked tail.
- **Competent automatic.** Over a few hundred generated airlines of different
  shapes, the automatic timetable scores at least 0.97 on peak-hour demand
  and at most 1.03 of par on landing fees.
- **Bounded edge.** On reference airlines, the best timetable found by search
  is worth no more than a few percent of profit over automatic.
- A deliberately bad timetable is worse, by a bounded amount.
- Same state, same factors, on every device and on the server.
- Tick and Route Finder time on the large reference saves do not move by more
  than a few percent.

## 9. Build order

| Package | What | Changes the game? |
|---|---|---|
| T0 | Typed timetable editor. Built in both games. | No |
| T1 | Port hub banks from Headwinds to Tailwinds, new games only. | Yes, Tailwinds |
| T2 | Peak-hour scoring and read-outs in both games: the Schedule page and route detail show what a timetable would be worth. | No. Shows numbers only |
| T3 | Peak-hour demand and slot pricing take effect in new games and worlds. | Yes, both |

T1 is a port of code that is live and tested, so it can start as soon as the
charter question is settled. T2 before T3 is deliberate: players and Dave see
the scores on real airlines for a release before anything depends on them,
and par is calibrated on real saves instead of guesses.

Guides to update when T1 ships in Tailwinds: `public/strategy.html` says
demand and connections are worked out from weekly frequency, not clock times.
The in-game Help and the Schedule page's own "it doesn't change demand or
costs" line change at the same time.

## 10. Left out

- **Night curfews.** Not chosen. They fit cleanly later: a curfew is a band
  the scheduler cannot use at that airport, on top of the slot price table.
- **Overnighting as a choice.** Headwinds' banked week already holds an
  aircraft overnight at the outstation when that makes the first bank. A
  control for the player to ask for it on a given route is not in this
  design.
- **Slot scarcity and slot auctions.** See §4.
- **Timetables for AI rivals.** Rivals fly at par.

## 11. Decisions for Dave

1. **Port hub banks to Tailwinds as they are** (§5), on by default for new
   games with a setup option to turn them off? Recommended yes.
2. **Charters and banks.** Proposed: a charter keeps its fixed times and
   never waits for a bank; the tail's own flights are banked round it.
3. **Size of the peak-hour edge.** Proposed: demand 0.80 to 1.04 per route,
   landing fees 0.60 to 1.35 by band, adding up to no more than a few percent
   of profit over automatic. Bigger, smaller?
4. **One flag or two.** Banks have their own flag in Headwinds already.
   Proposed: a second flag, `peakHours`, for §3 and §4, so the two can ship
   and be switched separately.
5. **Bunching** (§3). Recommended, because without it a pair's departures can
   all leave together at 08:00 and score well. It adds work to the automatic
   timetable.
6. **Regular timetables.** The suggestion mentions premium airlines having
   fixed departures. A small business bonus (about 1 percent) for a route
   that leaves at the same clock times every day would reward that and the
   week editor. Recommended as a later addition, not in T3.
7. **Headwinds.** Should peak prices at an airport rise with how many
   players use that hour? Proposed: no in the first version.
8. **T2 first.** Ship the read-outs a release ahead of the effects, or go
   straight to effects?

## What is already built (T0, 2026-11-10)

Operations ▸ Schedule, in both games: click a flight and the panel takes

- a typed departure time for that flight, on its own day (local time at the
  route's origin; 07:30, 0730, 19 and 7pm all read);
- the route's whole week as rows of a time and the days it flies, set in one
  go. A 14 a week route is two times typed once. Ten a week is a daily row
  and a three-day row.

Two departures closer than a round trip are refused with the earliest time
that works. A time taken by a flight the player set on another route (or, in
Tailwinds, by a charter) moves that day's flight to the nearest free time and
says so; with no room within twelve hours the flight is left automatic. In
Headwinds bank worlds the round trip includes the wait for the bank. No
world flag, all saves and worlds.

Code: `models/schedule.js` (`parseClock`, `timetableRows`,
`pinsForTimetable`, `blockerFor`), `components/ScheduleTimeline.jsx`
(`TimetableForm`, `timetableNotice`).

- Tailwinds: committed as `33be8b1`. `tools/schedule-test.mjs` (54, 16 new)
  and `tools/schedule-ui-test.mjs` (24, 7 new).
- Headwinds: built, waiting on Dave's commit. `tools/schedule-test.mjs` (48,
  17 new, two of them for bank worlds) and `tools/schedule-ui-test.mjs` (20,
  8 new). Golden master PARITY OK.
- Both checked in Chromium at desktop and phone widths: typing, set,
  single-day change, clashes, guards, nudge, drag, reload; Headwinds also in
  a bank world.
