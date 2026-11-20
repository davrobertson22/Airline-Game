# Standard turn times — design

Status: **built in Tailwinds 2026-11-20** (packages 1–3; Headwinds port not done). Code: models/turnTimes.js, utils/simulation.js (turnaroundHours, routePressureBlockHours, fleetTurnMix, turnTimeEffectsOf, turnTimeBreaches, turnTimeClassSummary), components/TurnTimes.jsx, tools/turn-times-test.mjs.

Players set their own standard ground turn per aircraft class, within limits.
Short turns fly more rotations under the block-hour cap but cost on-time
performance and staff morale; long turns do the reverse.

## Decisions (Dave, 2026-11-20)

- **Granularity:** a fleet-wide standard per aircraft class, plus an optional
  per-route override.
- **Saves:** all saves. The default is today's table, so nothing moves until a
  player changes a value.
- **Rivals:** budget-tier AI rivals run quick turns; legacy and premium rivals
  stay on standard turns.
- **Headwinds:** Tailwinds first, port after.

## Today

- `turnaroundHours(type)` (utils/simulation.js) is a fixed table by category
  (TP 30, RJ 40, NB 50, WB 90, DD/SST 120 min; freighters 45–105 by payload).
- Turnaround counts toward block time, so toward the weekly block-hour cap.
  `blockTimeHours`, `routeBlockHours` and `maxFrequency` have ~55 callers
  (GameContext 17, simulation 22, planners, schedule, map).
- On-time rate (`laborEffects`, data/labor.js) = 0.55 + 0.45 × morale blend
  (pilots .5 / ground .3 / cabin .2) − utilisation pressure − events − crew
  shortfall + station bonus + reserve bonus, clamped 0.35–1.
- Morale converges each week toward `moraleTarget(pay)` (+ reserve lift,
  grievances) in the GameContext tick.
- Far-end holds (route.schedule.hold) are ground time, not block time, and
  carry no OTP effect. They stay separate from turn times.

## Limits (minutes; 5-minute steps)

| Class | Min | Standard | Max |
|---|---|---|---|
| Turboprop | 20 | 30 | 50 |
| Regional jet | 25 | 40 | 70 |
| Narrowbody | 30 | 50 | 80 |
| Widebody | 60 | 90 | 150 |
| Double deck | 80 | 120 | 180 |
| Supersonic | 90 | 120 | 180 |
| Freighter (per payload band) | 65% of std | std | 160% of std |

The floors sit near real quick turns (Ryanair's 25-minute 737 turn, Southwest's
historic 10-minute turn being a 1970s outlier we don't allow).

## Effects

Let `d` be the turn's deviation from standard, normalised so the floor is −1
and the ceiling is +1. Each aircraft's `d` is weighted by its assigned weekly
block hours. That gives the fleet figure `D` (so a padded spare does nothing).

- **On-time rate (direct, transient like stationOtpBonus):**
  short `−0.08 × |D|^1.0`; long `+0.04 × D^0.6` (diminishing returns).
- **Morale target:** ground staff short `−12 × |D|`, long `+6 × D^0.6`;
  cabin crew at a third of that. It goes through the existing lagged morale
  update, so the effect builds over weeks. Morale already feeds OTP, so the
  direct OTP terms are kept small to avoid double punishment.
- **Utilisation pressure:** `avgUtilization` is computed with the *standard*
  turn; any padding above standard counts as slack. Without this, a longer
  turn would raise utilisation and *lower* OTP, the opposite of what we want.
  Turns shorter than standard do count in full.
- Shorter turns also mean more rotations, so more landing fees and crew hours.
  That falls out of the existing cost model; nothing new is needed.

## Engine plumbing

- `turnaroundHours(type, turn)` takes an optional resolved turn in minutes.
  Callers for the player pass `playerTurnMinutes(state, type, route)`:
  route override → class standard → table. Rivals pass their tier's turn
  (budget: narrowbody and regional jet at 80% of standard; others standard).
  No argument means the table, so every untouched caller keeps today's maths.
- State: `state.turnTimes = { byClass: { 'Narrow Body': 40, ... } }` and
  `route.schedule.turnMin` for overrides. Absent means standard, so old saves
  need no migration.
- The block-cap guard: a change that would push any aircraft over its
  weekly block cap is refused. The UI lists the routes that would break
  ("Cut 2 frequencies on SFO–LAX or keep 50 min"), and nothing is trimmed
  silently.
- The schedule builder (models/schedule.js `turnMin`), timetable, globe map,
  route planner, max-frequency and recommender all read the resolved turn.

## UI

- **Operations → Turn times card:** one slider per class the fleet flies,
  showing the standard, the current value, flights/week gained or lost across
  the fleet, and the projected OTP and ground-morale change.
- **Route detail:** an override field ("Turn at far end: fleet standard /
  custom"), with the same preview for that route.
- The OTP breakdown in Finance and Route detail gains a "Turn times" line.

## Tests

- Default `turnTimes` = byte-identical simulation on a fixture save.
- Limits are clamped and stepped; per-route override wins over class.
- Padding does not raise utilisation pressure; shortening does.
- Block-weighted `D`: a padded idle aircraft moves nothing.
- The block-cap guard refuses a change that breaks a route.
- Budget rivals' max frequency rises by the expected amount.

## Packages

1. Engine: resolved turn plumbing, OTP/morale effects, utilisation fix, tests.
2. UI: Operations card, route override, OTP breakdown line, devlog entry.
3. Rivals: budget quick turns.
4. Headwinds port (after Tailwinds ships).
