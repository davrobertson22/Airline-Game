// era.js — the historical era curves (ERA_MODE_PLAN.md §3.3).
//
// A world created with tickConfig.startYear (baked into every airline blob as
// state.startYear) runs on a real calendar: week 1 of year 1 is January of
// startYear. Three things read these curves:
//
//   demand — eraDemandIndex replaces the classic compounding pairDemandGrowth
//            (market.js short-circuits to it via setEraStartYear), so a 1950
//            world starts at ~5% of 2026 traffic and grows along history
//            rather than upward from an arbitrary year 1.
//   fares  — eraFareIndex feeds setFareIndex at the reducer entry, scaling the
//            whole reference ladder: real yield per km was ~6.5x today's in
//            1950. The published index is gamma-compressed (γ≈0.31) BOTH for
//            balance and because setFareIndex hard-clamps at 2.0.
//   fuel   — eraFuelMean replaces the OU walk's reversion target through 2026:
//            cheap and flat to 1972, the 1973/1979 shocks, the 1986-99 glut,
//            the 2008 spike, COVID. After 2026 it returns null and the walk
//            reverts to the procedural FUEL_BASE_INDEX — history is written,
//            the future is not.
//
// EVERY function returns its neutral value (null) when calYear is null: a
// classic world never touches an era branch. That is the parity invariant —
// tools/era-calendar-test.mjs guards it here. (This used to point at
// tools/golden-master/run.mjs, which Tailwinds no longer carries; the golden
// master lives on in the Headwinds repo, where the same rule applies.)
//
// The anchor values are the calibration surface for tools/era-balance-test.mjs
// (load factor 60-85% and consistent return-on-capital per decade). Tune them
// there, not by feel.

// Piecewise-linear interpolation over [year, value] anchors, clamped at the ends.
function lerp(anchors, x) {
  if (x <= anchors[0][0]) return anchors[0][1];
  const last = anchors[anchors.length - 1];
  if (x >= last[0]) return last[1];
  for (let i = 1; i < anchors.length; i++) {
    const [x1, v1] = anchors[i - 1], [x2, v2] = anchors[i];
    if (x <= x2) return v1 + (v2 - v1) * (x - x1) / (x2 - x1);
  }
  return last[1];
}

// World passenger traffic relative to 2026, compressed with γ_demand = 0.50 so
// the early decades are small rather than uninhabitable (raw 1950 RPKs are
// ~0.3% of 2026; the index plays at 5.4%).
export const ERA_DEMAND_ANCHORS = [
  [1930, 0.020], [1950, 0.054], [1960, 0.105], [1970, 0.217], [1980, 0.333],
  [1990, 0.439], [2000, 0.557], [2010, 0.696], [2019, 0.942], [2026, 1.000],
  [2050, 1.480], [2100, 2.200],
];

export function eraDemandIndex(calYear) {
  if (calYear == null) return null;
  return lerp(ERA_DEMAND_ANCHORS, calYear);
}

// Real yield relative to 2026, compressed with γ_yield ≈ 0.31. The ceiling is
// dictated by setFareIndex's hard clamp at 2.0 (market.js:751) — anything
// above it is silently swallowed — so the rest of the period's economics live
// in the aircraft COST data (fuel burn, crew, cruise speed), where they belong.
// Measured against tools/era-balance-test.mjs: the first cut (γ≈0.31, 1950 at
// 1.79) made the propliner decades print money — cheap airframes, cheap fuel
// and a 79% fare premium compounded into ~8x the modern return on capital.
// γ≈0.20 keeps the period feel (1950 fares 55% over the modern ladder) while
// holding the early-era RoC premium inside the balance test's ceiling.
export const ERA_FARE_ANCHORS = [
  [1930, 1.62], [1950, 1.55], [1960, 1.42], [1970, 1.30], [1980, 1.22],
  [1990, 1.13], [2000, 1.06], [2010, 1.01], [2019, 1.00], [2026, 1.00],
  [2050, 0.96], [2100, 0.92],
];

export function eraFareIndex(calYear) {
  if (calYear == null) return null;
  return Math.max(0.90, Math.min(1.95, lerp(ERA_FARE_ANCHORS, calYear)));
}

// Jet-fuel mean index the weekly OU walk reverts to, through 2026. The weekly
// volatility (fuel.js σ = 0.04) rides on top, so no two worlds see the same
// 1973 — the shape is history, the texture is the world's own seed. Null past
// 2026: the walk reverts to the procedural FUEL_BASE_INDEX from wherever the
// scripted era left it.
export const ERA_FUEL_ANCHORS = [
  [1950, 0.45], [1972, 0.46], [1973, 0.62], [1974, 0.95], [1976, 0.92],
  [1978, 0.95], [1980, 1.42], [1981, 1.45], [1982, 1.30], [1985, 1.10],
  [1986, 0.60], [1990, 0.68], [1993, 0.55], [1998, 0.45], [1999, 0.55],
  [2000, 0.75], [2002, 0.70], [2005, 1.25], [2008, 1.85], [2009, 0.95],
  [2011, 1.40], [2014, 1.30], [2015, 0.80], [2016, 0.65], [2019, 0.78],
  [2020, 0.45], [2021, 0.85], [2022, 1.50], [2023, 1.15], [2026, 1.00],
];

// ── Legal era start years ───────────────────────────────────────────────────
//
// Discord 2026-09-11 (Lancelotbronner), in a 1930 world: "there are no planes
// available so I can't create routes but my competitors are somehow creating
// very profitable routes with no planes assigned." Both halves were one cause —
// a start year the game does not actually model.
//
// The picker used to accept anything from 1930, an arbitrary round number. The
// floor is the first year the ERA MODEL is defined for, and that is the first
// fuel anchor above: demand and fare curves carry a 1930 point, but there is no
// fuel history before 1950, so a pre-1950 world runs on a flat extrapolation of
// the 1950 price. tools/era-balance-test.mjs calibrates from 1950 too, and the
// earliest preset is 1950 — every part of the era system was built from there.
//
// Derived from ERA_FUEL_ANCHORS rather than hardcoded, so extending the fuel
// history backwards moves the floor with it. The catalogue is the other
// constraint (the oldest airliner is the 1936 DC-3, so 1950 clears it with room
// for five types); tools/era-start-floor-test.mjs asserts BOTH, and will fail
// if the fuel history is ever extended below what the aircraft data supports.
export const ERA_MIN_START_YEAR = ERA_FUEL_ANCHORS[0][0];

/** Latest era start year the curves are defined for. */
export const ERA_MAX_START_YEAR = 2100;

/** Is this a legal era start year? (null = classic, always legal.) */
export function isLegalEraStartYear(year) {
  return year == null
    || (Number.isInteger(year) && year >= ERA_MIN_START_YEAR && year <= ERA_MAX_START_YEAR);
}

// ── The horizon ──────────────────────────────────────────────────────────────
// An era world is a RUN, not a sandbox: it closes at the end of calendar year
// 2050 and the player is ranked on market cap against whoever is still flying.
// A shared DATE rather than a fixed length per start year, so every era game is
// racing the same clock and two runs are comparable: a 2000 start is a 51-year
// run, a 1950 start a century.
//
// Classic worlds (startYear null) have no calendar and stay endless on purpose.
// Every branch here is dead for them; tools/horizon-test.mjs holds that as an
// invariant. Do not make any of this reachable without a startYear.
export const HORIZON_YEAR = 2050;

// Latest start year the picker offers for a NEW era game, leaving a run worth
// playing (11 years at the ceiling). Deliberately NOT a change to
// ERA_MAX_START_YEAR: that constant decides which SAVES are legal, and
// reconcileState clamps an out-of-range save onto it — lowering it would
// silently rewrite the calendar of an existing far-future world. This one only
// gates the picker.
export const ERA_MAX_NEW_START_YEAR = 2040;

/** Whole calendar years an era run lasts, or null in a classic world. */
export function runLengthYears(startYear) {
  if (!Number.isInteger(startYear)) return null;
  return HORIZON_YEAR - startYear + 1;
}

/**
 * Is this the final week of the run? True only once the world has flown all of
 * week 52 of HORIZON_YEAR. `year` is the 1-based ordinal game year, not the
 * calendar year — the same convention as calendarYear() in utils/simulation.js.
 * Classic worlds (startYear null) are never at a horizon.
 */
export function horizonReached(startYear, year, week) {
  if (!Number.isInteger(startYear)) return false;
  return (startYear + (year - 1)) >= HORIZON_YEAR && week >= 52;
}

/**
 * Is this world ALREADY past the horizon? Only true for a save made before the
 * horizon existed — a world started past 2050, or one played beyond it. Those
 * are grandfathered at load (reconcileState sets horizonExempt) rather than
 * having a verdict dropped on them mid-game.
 */
export function pastHorizon(startYear, year) {
  if (!Number.isInteger(startYear)) return false;
  return (startYear + (year - 1)) > HORIZON_YEAR;
}

export function eraFuelMean(calYear) {
  if (calYear == null || calYear > 2026) return null;
  return lerp(ERA_FUEL_ANCHORS, calYear);
}

// The classic clamp floor (0.55) sits above the 1950-72 and 2020 means; era
// worlds widen it so the cheap-fuel decades are actually cheap.
export const ERA_FUEL_MIN_INDEX = 0.35;

// Era demand factor — REPLACES classic pairDemandGrowth (never stacks with
// it, or growth counts twice), and it is the ABSOLUTE index, not a ratio from
// the start year. The classic gravity model's base pool represents roughly
// today's traffic (a classic world starts at modern demand and compounds up),
// so the era factor must scale the LEVEL: a 1950 world runs at 5.4% of the
// classic pool and reaches 148% by 2050. Two consequences worth knowing:
//   - the factor stays inside [0.054, 2.2] across any legal era, a NARROWER
//     absolute band than classic's own 3.0 growth cap, so gates, slots and
//     aircraft sizing never see a demand level the model wasn't built for;
//   - an incumbent still grows ~27x across the full century, which is the
//     compounding-advantage question ERA_MODE_PLAN.md §3.3 flags — era slices
//     remain the recommended product.
// The cap is a guard for far-future custom worlds, not a lever.
export const ERA_DEMAND_GROWTH_CAP = 8.0;

export function eraDemandGrowthFactor(startYear, absWeek) {
  if (!Number.isInteger(startYear)) return 1;
  const w = Math.max(1, Number(absWeek) || 1);
  const idx = eraDemandIndex(startYear + Math.floor((w - 1) / 52));
  return Math.min(ERA_DEMAND_GROWTH_CAP, Math.max(0.02, idx));
}

// ── Era money and pax scales (phase 3, ERA_MODE_PLAN.md §4) ──────────────────
// The constant-dollar decision covers aircraft prices and per-flight economics;
// it deliberately does NOT cover the game's fixed-dollar progression furniture,
// which is calibrated against a 2026-scale airline. These three scales are the
// NARROW, NAMED set that moves with the era — nothing else does.
//
//   eraRevenueScale — demand x fare: what a week of flying is worth vs 2026.
//                     Scales revenue/profit/cash/market-cap objective targets.
//   eraPaxScale     — demand alone. Scales passenger-count targets.
//   eraCapitalScale — sqrt(revenue scale), floored at 0.25 and capped at 1.
//                     Scales starting capital, objective rewards and the fixed
//                     cost floors. Sqrt, not linear: capital buys AIRCRAFT and
//                     aircraft prices stay in constant dollars, so a linear cut
//                     would hand a 1950 founder cash that cannot buy one DC-3.
// All three return null for a classic world — the parity invariant.

export function eraRevenueScale(calYear) {
  if (calYear == null) return null;
  return Math.max(0.05, eraDemandIndex(calYear) * eraFareIndex(calYear));
}

export function eraPaxScale(calYear) {
  if (calYear == null) return null;
  return Math.max(0.02, eraDemandIndex(calYear));
}

export function eraCapitalScale(calYear) {
  if (calYear == null) return null;
  return Math.max(0.25, Math.min(1, Math.sqrt(eraRevenueScale(calYear))));
}


// Fixed-overhead scale for an era year: gate rents, wages, MRO contracts, hub
// investment, HQ, insurance, route launch and marketing floors all run at this
// fraction of their modern-dollar level. The SQUARE ROOT of the capital scale
// (1950: 0.54, 1978: 0.78) — a gentler cut than capital, on purpose: the
// 1950 playtest showed that scaling overheads all the way down to the capital
// scale (0.29) left the early decades printing money. Null in classic.
export function eraOverheadScale(calYear) {
  const c = eraCapitalScale(calYear);
  return c == null ? null : Math.sqrt(c);
}

// Seed capital for an era start: the modern-equivalent figure × capitalScale,
// then FLOORED to a whole million (never below $1M). The floor is deliberate —
// playtesting showed the early decades generous once fixed overheads were
// scaled, so a 1950 airline opens on a round $2M rather than $2.89M, 1978 on
// $6M rather than $6.18M (from the $10M modern figure; the $15M-era numbers
// were $4M and $9M). Classic (calYear null) returns the modern figure as is.
export function eraSeedCapital(modernCapital, calYear) {
  const scale = eraCapitalScale(calYear);
  if (scale == null) return modernCapital;
  return Math.max(1_000_000, Math.floor(modernCapital * scale / 1_000_000) * 1_000_000);
}

// Headwinds: the admin's "Starting capital" knob is the LITERAL amount a founding
// airline receives in an era world — $4M typed means $4M in 1950 (Dave's call,
// 2026-08-31). A player joining later in the world's life is scaled from that
// figure by how far the era's capital scale has moved since the world opened,
// so a 1970 joiner to a 1950 world is not handicapped against airlines that
// have had twenty years to grow. Classic worlds (startYear null) return the knob.
export function eraJoinCapital(knob, startYear, calYear) {
  const s0 = eraCapitalScale(startYear);
  const s1 = eraCapitalScale(calYear);
  if (s0 == null || s1 == null || s0 <= 0) return knob;
  return Math.max(100_000, Math.round(knob * (s1 / s0) / 100_000) * 100_000);
}
