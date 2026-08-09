// Solo news log — the world's story, kept instead of thrown away.
// ----------------------------------------------------------------------------
// WHY THIS EXISTS
// The simulation already generates a great deal of news every week: the AI
// carriers start fare wars, launch and cut routes, open second hubs, run
// marketing blitzes, go into distress, merge and fail; world events open and
// close; your own aircraft arrive, break and come out of heavy checks.
//
// Until now ALL of it lived for exactly one screen. The Weekly Debrief showed
// the first six competitor lines and nothing else, and the moment you clicked
// through it was gone — no way to ask "when did that fare war actually start?"
// or "what did the board pay me for that objective?".
//
// This module turns that week's raw report into durable news rows. The reducer
// appends them to `state.newsLog`, capped, and the News tab reads them back.
//
// DETERMINISM: no wall clock. Items are stamped with the GAME week they belong
// to and ordered by it, never by Date.now(). The reducer must stay a pure
// function of (state, action) — a real timestamp in here would make saves
// non-reproducible and every replay/simulation harness unrepeatable. It also
// happens to be the right call for the player: in a game where you control the
// clock, "Year 3 · Week 14" means something and "3 hours ago" does not.

/**
 * How many items a save keeps.
 *
 * Measured against a real game: a world with no player activity still generates
 * ~2.4 items a week once the AI carriers get going, so 250 is roughly two game
 * years. Raising it is cheap in code and not in save size — these live in
 * localStorage alongside statsHistory.
 */
export const NEWS_LOG_CAP = 250;

/** A fleet intake of this many aircraft at once is headline news. */
const BIG_INTAKE = 5;

// AI carrier events by how much they should interrupt you. Every competitor
// event already carries a written `description`, so the news tab prints that
// rather than re-authoring the sentence in two places.
const COMPETITOR_TIER = {
  bankrupt: 1, merger: 1, startup: 1, fireSale: 1, fareWar: 1, secondHub: 1,
  fareWarEnd: 2, mktBlitz: 2, launch: 2, cut: 2, recovered: 2,
  allianceJoin: 2, allianceLeave: 2,
  quality: 3, boost: 3,
};

// High-volume competitor actions. A busy world produces roughly five route
// launches a week, almost always one each from five DIFFERENT carriers — so
// grouping per carrier collapses nothing. These roll up per WEEK instead: one
// "carriers launched 5 new routes" line you can open, rather than five lines
// that bury the fare war underneath them. The rarer events (fare wars, mergers,
// failures, distress) are never rolled — each one matters on its own.
const ROLLABLE_COMPETITOR = new Set(['launch', 'cut', 'boost']);

const ROLLUP_VERB = { launch: 'launched', cut: 'withdrew from', boost: 'added capacity on' };

const COMPETITOR_ICON = {
  bankrupt: '📉', merger: '🤝', startup: '🚀', fireSale: '🏷️', recovered: '📈',
  fareWar: '⚔️', fareWarEnd: '🕊️', mktBlitz: '📣', secondHub: '🏛️',
  launch: '🛫', cut: '🛬', boost: '📈', quality: '⭐',
  allianceJoin: '🤝', allianceLeave: '💔',
};

/**
 * Turn one week's report into news rows.
 *
 * Everything is passed in rather than read off state, so this stays pure and
 * testable without constructing a whole game.
 *
 * @returns {object[]} rows, oldest-first within the week
 */
export function buildWeekNews({
  year, week, absWeek,
  newEvents = [], expiredEvents = [], competitorEvents = [],
  deliveries = [], checksCompleted = [], checksForced = [], failures = [],
  completedObjectives = [], profit = null, bestProfitBefore = null,
}) {
  const rows = [];
  const at = { absWeek, year, week };

  // ── The world ──────────────────────────────────────────────────────────────
  for (const ev of newEvents) {
    rows.push({
      ...at, category: 'world', kind: 'event_started', tier: 1,
      subject: ev.name ?? 'World event',
      icon: ev.icon ?? '🌍',
      data: {
        eventId: ev.id ?? null,
        type: ev.type ?? null,
        description: ev.resolvedDesc ?? ev.description ?? null,
      },
    });
  }
  for (const ev of expiredEvents) {
    rows.push({
      ...at, category: 'world', kind: 'event_ended', tier: 1,
      subject: ev.name ?? 'World event',
      icon: ev.icon ?? '🌍',
      data: { eventId: ev.id ?? null, type: ev.type ?? null },
    });
  }

  // ── The competition ────────────────────────────────────────────────────────
  const rollups = new Map();
  for (const ev of competitorEvents) {
    // Older saves and a couple of call sites push bare strings.
    if (typeof ev === 'string') {
      rows.push({
        ...at, category: 'competitors', kind: 'competitor_note', tier: 2,
        subject: null, icon: '✈️', data: { description: ev },
      });
      continue;
    }
    if (ROLLABLE_COMPETITOR.has(ev.type)) {
      if (!rollups.has(ev.type)) rollups.set(ev.type, { ev, entries: [] });
      rollups.get(ev.type).entries.push({
        airline: ev.name ?? null,
        routeKey: ev.routeKey ?? null,
        description: ev.description ?? null,
      });
      continue;
    }
    rows.push({
      ...at,
      category: 'competitors',
      kind: `competitor_${ev.type ?? 'note'}`,
      tier: COMPETITOR_TIER[ev.type] ?? 2,
      subject: ev.name ?? null,
      icon: COMPETITOR_ICON[ev.type] ?? '✈️',
      data: {
        eventType: ev.type ?? null,
        description: ev.description ?? null,
        routeKey: ev.routeKey ?? null,
        airport: ev.airport ?? null,
      },
    });
  }
  for (const { ev, entries } of rollups.values()) {
    const single = entries.length === 1;
    rows.push({
      ...at,
      category: 'competitors',
      kind: `competitor_${ev.type}`,
      tier: COMPETITOR_TIER[ev.type] ?? 2,
      // One move keeps the carrier as the subject and the AI's own sentence,
      // which reads better than anything a template would produce.
      subject: single ? (entries[0].airline ?? null) : null,
      icon: COMPETITOR_ICON[ev.type] ?? '✈️',
      data: {
        eventType: ev.type,
        verb: ROLLUP_VERB[ev.type] ?? 'changed',
        total: entries.length,
        entries: entries.slice(0, 20),
        // Route keys alone, so the News tab's "near my network" filter can match
        // a rolled item against the player's own city pairs.
        routes: entries.map((e) => e.routeKey).filter(Boolean).slice(0, 20),
        description: single ? (entries[0].description ?? null) : null,
      },
    });
  }

  // ── Your fleet ─────────────────────────────────────────────────────────────
  if (deliveries.length > 0) {
    const byType = {};
    for (const a of deliveries) byType[a.typeId] = (byType[a.typeId] ?? 0) + 1;
    rows.push({
      ...at, category: 'fleet', kind: 'delivery_arrived',
      tier: deliveries.length >= BIG_INTAKE ? 1 : 2,
      subject: null, icon: '✈️',
      data: {
        total: deliveries.length,
        byType,
        names: deliveries.slice(0, 8).map((a) => a.name).filter(Boolean),
      },
    });
  }

  // An unplanned grounding costs you a schedule — that is always headline news.
  if (checksForced.length > 0) {
    rows.push({
      ...at, category: 'fleet', kind: 'check_forced', tier: 1,
      subject: null, icon: '🛠️',
      data: {
        total: checksForced.length,
        checkTypes: [...new Set(checksForced.map((c) => c.checkType))],
        names: checksForced.slice(0, 8).map((c) => c.name).filter(Boolean),
      },
    });
  }
  if (checksCompleted.length > 0) {
    rows.push({
      ...at, category: 'fleet', kind: 'check_completed', tier: 2,
      subject: null, icon: '✅',
      data: {
        total: checksCompleted.length,
        checkTypes: [...new Set(checksCompleted.map((c) => c.checkType))],
        names: checksCompleted.slice(0, 8).map((c) => c.name).filter(Boolean),
      },
    });
  }
  for (const f of failures) {
    rows.push({
      ...at, category: 'fleet', kind: 'mechanical_failure',
      tier: (f.weeksGrounded ?? 0) >= 2 ? 1 : 2,
      subject: f.aircraftName ?? null,
      icon: f.icon ?? '⚠️',
      data: {
        label: f.label ?? 'Mechanical fault',
        tailNumber: f.tailNumber ?? null,
        weeksGrounded: f.weeksGrounded ?? 0,
        severity: f.severity ?? null,
      },
    });
  }

  // ── Your company ───────────────────────────────────────────────────────────
  for (const o of completedObjectives) {
    rows.push({
      ...at, category: 'company', kind: 'objective_complete', tier: 1,
      subject: null, icon: o.icon ?? '🏅',
      data: { title: o.title ?? o.id, reward: o.reward ?? 0, desc: o.desc ?? null },
    });
  }

  // A record week only counts once you have a record to beat, and only when the
  // week is actually profitable — "best loss yet" is not a milestone.
  if (Number.isFinite(profit) && Number.isFinite(bestProfitBefore)
      && profit > 0 && profit > bestProfitBefore) {
    rows.push({
      ...at, category: 'company', kind: 'record_week', tier: 1,
      subject: null, icon: '🏆',
      data: { profit: Math.round(profit), previousBest: Math.round(bestProfitBefore) },
    });
  }

  // Stable, replay-safe ids: position within the week is deterministic because
  // the rows are built in a fixed order from a deterministic report.
  return rows.map((r, i) => ({ ...r, id: `w${absWeek}-${i}` }));
}

/**
 * News rows for the one-off over-cap schedule trim — ONE per aircraft, never
 * one per frequency decrement.
 *
 * This migration edits schedules the player paid launch costs for, so the
 * record has to be durable. A toast is drained by the next screen; a news row
 * is still there next week when they wonder why a route got smaller.
 *
 * Stamped with the save's own game week, like every other row (no wall clock).
 */
export function scheduleTrimNews(notices, { absWeek = 0, year = 1, week = 1 } = {}) {
  return (notices ?? [])
    .filter(n => (n?.cuts ?? []).length > 0)
    .map((n, i) => ({
      id: `trim${absWeek}-${i}`,
      absWeek, year, week,
      category: 'fleet', kind: 'schedule_trim', tier: 1,
      subject: n.tailNumber || n.name || 'An aircraft',
      icon: '⏱',
      data: {
        aircraft:   n.tailNumber || n.name || null,
        aircraftId: n.aircraftId ?? null,
        capHours:   n.capHours ?? null,
        peakBefore: n.peakBefore ?? null,
        peakAfter:  n.peakAfter ?? null,
        cuts: (n.cuts ?? []).map(c => ({
          origin: c.origin, destination: c.destination, cargo: !!c.cargo,
          fromFrequency: c.fromFrequency, toFrequency: c.toFrequency, closed: !!c.closed,
        })),
      },
    }));
}

/**
 * Append this week's rows to the log, newest LAST, capped.
 *
 * Stored oldest-first so appending is a push and the cap trims from the front;
 * the News tab reverses for display.
 */
export function appendNews(log, rows, cap = NEWS_LOG_CAP) {
  if (!rows || rows.length === 0) return Array.isArray(log) ? log : [];
  const next = [...(Array.isArray(log) ? log : []), ...rows];
  return next.length > cap ? next.slice(next.length - cap) : next;
}
