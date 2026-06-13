// ── Board Objectives ─────────────────────────────────────────────────────────
//
// Two phases:
//   'strategic'  — Year 1 milestones: build the foundation (operational goals)
//   'financial'  — Year 2+ targets:   grow and optimise (KPI goals)
//
// Each template has:
//   id          unique string (stored in state)
//   phase       'strategic' | 'financial'
//   title       short name
//   desc        one-line explanation shown in UI
//   icon        emoji
//   reward      cash bonus on completion ($)
//   check(snap) → boolean — receives a snapshot of relevant state fields;
//                 returns true when the objective is met
//
// The `check` function receives:
//   {
//     routes            array of route records
//     fleet             array of fleet records (including delivered this tick)
//     gates             { [code]: gateCount }
//     financialHistory  array of history entries (newest last)
//     lastReport        the weekly tick report
//     weekProfit        after-tax profit this tick
//     year              current year after advance
//     week              current week after advance
//   }

import { getAirport } from './airports.js';

export const OBJECTIVE_TEMPLATES = [

  // ── Phase 1: Strategic milestones ─────────────────────────────────────────
  // Goal: establish a functioning airline in Year 1

  {
    id:     'first_route',
    phase:  'strategic',
    title:  'First Departure',
    desc:   'Launch your first route',
    icon:   '✈️',
    reward: 50_000,
    check: ({ routes }) => routes.length >= 1,
  },

  {
    id:     'first_profit',
    phase:  'strategic',
    title:  'In the Black',
    desc:   'Achieve a profitable week',
    icon:   '💚',
    reward: 200_000,
    check: ({ weekProfit }) => weekProfit > 0,
  },

  {
    id:     'fleet_3',
    phase:  'strategic',
    title:  'Growing Fleet',
    desc:   'Operate 3 or more aircraft',
    icon:   '🛫',
    reward: 100_000,
    check: ({ fleet }) => fleet.filter(a => a.status !== 'retired').length >= 3,
  },

  {
    id:     'airports_4',
    phase:  'strategic',
    title:  'Network Builder',
    desc:   'Serve 4 or more airports (gates required)',
    icon:   '🏛️',
    reward: 150_000,
    check: ({ gates }) => Object.values(gates).filter(n => n > 0).length >= 4,
  },

  {
    id:     'routes_5',
    phase:  'strategic',
    title:  'Route Network',
    desc:   'Operate 5 or more city pairs',
    icon:   '🗺️',
    reward: 250_000,
    check: ({ routes }) => {
      const pairs = new Set(routes.map(r => {
        const [a, b] = [r.origin, r.destination].sort();
        return `${a}-${b}`;
      }));
      return pairs.size >= 5;
    },
  },

  {
    id:     'profitable_quarter',
    phase:  'strategic',
    title:  'Profitable Quarter',
    desc:   'Achieve 4 consecutive profitable weeks',
    icon:   '📈',
    reward: 500_000,
    check: ({ financialHistory }) => {
      if (financialHistory.length < 4) return false;
      return financialHistory.slice(-4).every(h => (h.profit ?? 0) > 0);
    },
  },

  // ── Phase 2: Financial targets ─────────────────────────────────────────────
  // Goal: scale and optimise from Year 2 onwards

  {
    id:     'revenue_500k',
    phase:  'financial',
    title:  'Revenue Milestone',
    desc:   'Generate $500K in a single week',
    icon:   '💰',
    reward: 200_000,
    check: ({ lastReport }) => (lastReport?.totalRevenue ?? 0) >= 500_000,
  },

  {
    id:     'revenue_1m',
    phase:  'financial',
    title:  'Million Dollar Week',
    desc:   'Generate $1M in a single week',
    icon:   '🤑',
    reward: 300_000,
    check: ({ lastReport }) => (lastReport?.totalRevenue ?? 0) >= 1_000_000,
  },

  {
    id:     'profit_margin_15',
    phase:  'financial',
    title:  'Healthy Margins',
    desc:   'Achieve 15%+ operating profit margin in a week',
    icon:   '📊',
    reward: 250_000,
    check: ({ lastReport, weekProfit }) => {
      const rev = lastReport?.totalRevenue ?? 0;
      if (rev <= 0) return false;
      return weekProfit / rev >= 0.15;
    },
  },

  {
    id:     'fleet_10',
    phase:  'financial',
    title:  'Major Carrier',
    desc:   'Operate 10 or more aircraft',
    icon:   '🛩️',
    reward: 500_000,
    check: ({ fleet }) => fleet.filter(a => a.status !== 'retired').length >= 10,
  },

  {
    id:     'international',
    phase:  'financial',
    title:  'Going Global',
    desc:   'Serve airports in 3 or more countries',
    icon:   '🌍',
    reward: 350_000,
    check: ({ routes }) => {
      const countries = new Set(
        routes.flatMap(r => [
          getAirport(r.origin)?.country,
          getAirport(r.destination)?.country,
        ]).filter(Boolean)
      );
      return countries.size >= 3;
    },
  },

  {
    id:     'revenue_2m',
    phase:  'financial',
    title:  'Industry Leader',
    desc:   'Generate $2M in a single week',
    icon:   '🏆',
    reward: 750_000,
    check: ({ lastReport }) => (lastReport?.totalRevenue ?? 0) >= 2_000_000,
  },
];

/** All objective IDs in order */
export const OBJECTIVE_IDS = OBJECTIVE_TEMPLATES.map(t => t.id);

/** Look up a template by id */
export function getObjective(id) {
  return OBJECTIVE_TEMPLATES.find(t => t.id === id) ?? null;
}

/**
 * Build the initial objectives array for a new game.
 * Returns [{ id, completed: false, completedWeek: null, completedYear: null }]
 */
export function initialObjectives() {
  return OBJECTIVE_TEMPLATES.map(t => ({
    id:             t.id,
    completed:      false,
    completedWeek:  null,
    completedYear:  null,
  }));
}

/**
 * Build the initial objectives array for an existing (upgraded) game.
 * Any objective that is ALREADY met is silently pre-marked completed
 * (no reward, no toast) so the player only earns credit going forward.
 */
export function initialObjectivesForState(snap) {
  return OBJECTIVE_TEMPLATES.map(t => {
    let alreadyMet = false;
    try { alreadyMet = t.check(snap); } catch { /* ignore */ }
    return {
      id:            t.id,
      completed:     alreadyMet,
      completedWeek: alreadyMet ? snap.week  : null,
      completedYear: alreadyMet ? snap.year  : null,
      legacy:        alreadyMet,   // flag: completed before objectives were enabled
    };
  });
}

/**
 * Check all uncompleted objectives against a state snapshot.
 * Returns { newlyCompleted: [id, ...] }
 */
export function checkObjectives(objectives, snap) {
  const newlyCompleted = [];

  for (const obj of objectives) {
    if (obj.completed) continue;
    const tmpl = getObjective(obj.id);
    if (!tmpl) continue;
    try {
      if (tmpl.check(snap)) {
        newlyCompleted.push(obj.id);
      }
    } catch {
      // silently skip if check throws (e.g. missing data on old saves)
    }
  }

  return { newlyCompleted };
}
