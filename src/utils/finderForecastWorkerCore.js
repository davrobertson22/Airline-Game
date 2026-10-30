/**
 * What a Route Finder forecast worker does with a message — kept free of any
 * worker API so a test can drive it in-process (tools/finder-worker-pool-test).
 *
 *   { type: 'state', id, state }        hold this state; later jobs name it by id
 *   { type: 'price', jobId, stateId, ctx, rows }
 *       → { type: 'result', jobId, results: [[key, projection|null], ...] }
 *       → { type: 'result', jobId, missing: true }   when stateId is not the one held
 *
 * `ctx` is finderForecastContext's INPUT ({ aircraftTypeId, aircraft,
 * weeklyFrequency, gameDate, capHours }); the context is rebuilt here so the
 * worker prices with the identical sum the main thread would.
 */
import { finderForecastContext, forecastCandidate } from '../models/routeFinder.js';
import { setDemandModel } from './market.js';
import { applyDemandWorld } from '../data/demandWorld.js';

// A worker is its own module world: the main thread's module-level demand
// knobs (demand model version, randomized-demand world) never reach it, so they
// are set here from the held state before pricing — otherwise a v2 game's
// finder would rank routes on classic demand.
function syncDemandModules(state) {
  setDemandModel(state?.demandModel);
  applyDemandWorld(state?.demandWorld ?? null);
}

export function createForecastWorkerCore() {
  let heldId = null;
  let held = null;
  return function handle(msg) {
    if (!msg || typeof msg !== 'object') return null;
    if (msg.type === 'state') {
      heldId = msg.id;
      held = msg.state;
      return null;
    }
    if (msg.type === 'price') {
      if (msg.stateId !== heldId || !held) return { type: 'result', jobId: msg.jobId, missing: true };
      syncDemandModules(held);
      const ctx = finderForecastContext(msg.ctx);
      const results = (msg.rows ?? []).map((r) => {
        try { return [r.key, forecastCandidate(held, r, ctx)]; }
        catch { return [r.key, null]; }
      });
      return { type: 'result', jobId: msg.jobId, results };
    }
    return null;
  };
}
