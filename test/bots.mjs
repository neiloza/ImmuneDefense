/* ============================================================================
 * bots.mjs — scripted players, used by the unit tests and by
 * `npm run balance` to prove each level is winnable and has teeth.
 *
 * A bot plays through the SAME commands the touch UI sends (deploy, order,
 * retire, skipCalm, continueInterlude) and may only look at what a player can
 * see: revealed threats, the meters, its own cells. It must never read a
 * hidden threat's position — a bot that can see through the fog proves
 * nothing about the level a person plays.
 *
 * Skill levels, because "winnable" means little on its own:
 *   idle      never does anything. Every level must beat it.
 *   casual    reacts every 2 s, minimal setup, no clever tricks.
 *   good      reacts every 0.5 s and plays the lesson the level teaches.
 *   reckless  casual, plus the tempting mistake the level is about (Broken
 *             bone: pile on Sirens for Signal and never retire one).
 * ========================================================================= */

import { CELLS } from "../js/data/cells.js";
import {
  createGame, step, deploy, retire, skipCalm, continueInterlude,
  isVisible, currentPhase, fingerprintStatus, drainEvents, TICK,
} from "../js/sim/game.js";

/* ---- what a player can see ---------------------------------------------- */

function visible(state, types) {
  return state.threats.filter((th) => !th.dead && types.includes(th.type) && isVisible(state, th));
}

function mine(state, type) {
  return state.units.filter((u) => !u.dead && u.type === type);
}

/* The visible threat with the most visible neighbours — where a player's eye
 * goes first. */
function densest(list, radius = 1.5) {
  let best = null;
  let bestN = -1;
  for (const a of list) {
    let n = 0;
    for (const b of list) if (Math.hypot(a.x - b.x, a.y - b.y) <= radius) n++;
    if (n > bestN) { best = a; bestN = n; }
  }
  return best ? { target: best, n: bestN } : null;
}

function covered(state, th, type, radius) {
  return mine(state, type).some((u) => Math.hypot(u.x - th.x, u.y - th.y) <= radius ||
    (u.order && u.order.targetId === th.id));
}

function place(state, cell, spots) {
  for (const [x, y] of spots) {
    const r = deploy(state, cell, x, y);
    if (r.ok) return true;
  }
  return false;
}

/* ---- per-level plans ---------------------------------------------------- */

const PLANS = {
  cut: {
    setup: [["scout", 4.5, 3.5], ["devourer", 4.5, 5.5], ["devourer", 3.5, 4.5]],
    think(state, skill) {
      const bugs = visible(state, ["bacterium"]);
      const group = densest(bugs);
      if (group && state.signal >= CELLS.rusher.cost && !covered(state, group.target, "rusher", 1.2)) {
        if (group.n >= (skill === "good" ? 1 : 2)) deploy(state, "rusher", group.target.x, group.target.y, group.target.id);
      }
      if (skill !== "good") return;
      // A second Scout lower down, then a Devourer line across the middle.
      if (mine(state, "scout").length < 2 && state.signal >= 6) place(state, "scout", [[4.5, 8.5]]);
      if (mine(state, "devourer").length < 5 && state.signal >= 8) {
        place(state, "devourer", [[5.5, 4.5], [2.5, 8.5], [6.5, 8.5], [4.5, 11.5]]);
      }
    },
  },

  flu: {
    setup: [["scout", 4.5, 3.5], ["devourer", 2.5, 3.5], ["devourer", 6.5, 3.5]],
    think(state, skill) {
      const ready = fingerprintStatus(state, "flu") === "ready";
      if (ready) {
        const sick = visible(state, ["infected"]).sort((a, b) => b.age - a.age);
        for (const cell of sick) {
          if (state.signal < CELLS.hunter.cost) break;
          if (!covered(state, cell, "hunter", 1.0)) { deploy(state, "hunter", cell.x, cell.y, cell.id); break; }
        }
      }
      const free = visible(state, ["virus", "bacterium"]);
      const group = densest(free);
      const reserve = ready ? CELLS.hunter.cost : 0;
      if (group && state.signal >= CELLS.rusher.cost + (skill === "good" ? reserve : 0) &&
          !covered(state, group.target, "rusher", 1.2) && group.n >= 2) {
        deploy(state, "rusher", group.target.x, group.target.y, group.target.id);
      }
      if (skill !== "good") return;
      // More eyes on the lining once the first Scout has left to carry.
      if (mine(state, "scout").filter((s) => s.task === "post").length < 2 && state.signal >= 6) {
        place(state, "scout", [[2.5, 4.5], [6.5, 4.5], [4.5, 8.5]]);
      }
      if (currentPhase(state)?.id === "mopup" && mine(state, "devourer").length < 4 && state.signal >= 6) {
        place(state, "devourer", [[4.5, 10.5], [2.5, 10.5], [6.5, 10.5]]);
      }
    },
  },

  "broken-bone": {
    setup: [["devourer", 4.5, 6.5], ["siren", 2.5, 4.5], ["devourer", 4.5, 9.5]],
    think(state, skill) {
      const phase = currentPhase(state)?.id;
      // Reckless: more Sirens means more Signal, so keep adding them and never
      // retire one. The level exists to punish exactly this.
      if (skill === "reckless" && mine(state, "siren").length < 6 && state.signal >= CELLS.siren.cost) {
        place(state, "siren", [[2.5, 4.5], [6.5, 4.5], [2.5, 11.5], [6.5, 11.5], [2.5, 2.5], [6.5, 2.5]]);
      }
      const junk = visible(state, ["debris"]);
      const group = densest(junk, 1.2);
      if (group && state.signal >= CELLS.rusher.cost && !covered(state, group.target, "rusher", 1.0)) {
        deploy(state, "rusher", group.target.x, group.target.y, group.target.id);
      }
      if (skill !== "good") return;
      const sirens = mine(state, "siren");
      const healing = phase === "rebuild" || phase === "remodel";
      if (state.alarm > 56 && sirens.length) retire(state, sirens[0].id);
      else if (healing && state.alarm < 24 && sirens.length < 3 && state.signal >= 5) {
        place(state, "siren", [[2.5, 4.5], [6.5, 4.5], [2.5, 11.5], [6.5, 11.5]]);
      }
      if (mine(state, "devourer").length < 4 && state.signal >= 8) {
        place(state, "devourer", [[3.5, 6.5], [5.5, 9.5], [5.5, 6.5]]);
      }
    },
  },
};

/* ---- one decision, on somebody else's game ------------------------------
 * The smoke test uses this to play the app's OWN running game in a real
 * browser (it imports this file over HTTP, so it shares the app's sim module
 * instance): place the opening Sentries as Signal allows, start, then think. */
export function driveOnce(state, skill = "good") {
  const plan = PLANS[state.level.id];
  if (!plan || (state.mode !== "calm" && state.mode !== "phase")) return;
  const next = plan.setup.find(([cell, x, y]) => !mine(state, cell).some((u) =>
    Math.abs(u.postX - x) < 0.5 && Math.abs(u.postY - y) < 0.5));
  if (next && state.mode === "calm" && state.signal >= CELLS[next[0]].cost) deploy(state, next[0], next[1], next[2]);
  if (!next && state.mode === "calm") skipCalm(state);
  if (state.mode === "phase") plan.think(state, skill);
}

/* ---- the runner ---------------------------------------------------------- */

/**
 * Play one level. Returns the final state plus a summary. `limit` is in
 * simulated seconds and exists so a stuck level fails a test instead of
 * hanging it.
 */
export function playLevel(level, { skill = "good", seed = 1, loadout, limit = 900 } = {}) {
  const plan = PLANS[level.id];
  const state = createGame(level, { seed, loadout });
  const every = skill === "good" ? 0.5 : skill === "reckless" ? 1 : 2;
  let nextThink = 0;
  let setupDone = skill === "idle";

  while (state.mode !== "won" && state.mode !== "lost" && state.t < limit) {
    if (state.mode === "interlude") { continueInterlude(state); continue; }
    if (skill !== "idle" && plan) {
      if (!setupDone) {
        // Place the opening Sentries as Signal allows, then start.
        const next = plan.setup.find(([cell, x, y]) => !mine(state, cell).some((u) =>
          Math.abs(u.postX - x) < 0.5 && Math.abs(u.postY - y) < 0.5));
        if (next) {
          if (state.signal >= CELLS[next[0]].cost) deploy(state, next[0], next[1], next[2]);
        } else {
          setupDone = true;
          if (skill === "good") skipCalm(state);
        }
      }
      if (state.mode === "phase" && state.t >= nextThink) {
        plan.think(state, skill);
        nextThink = state.t + every;
      }
    }
    step(state, TICK);
    drainEvents(state);
  }
  return {
    state,
    won: state.mode === "won",
    stars: state.outcome?.stars ?? 0,
    host: Math.round(state.host),
    time: Math.round(state.t),
    phase: state.phaseIndex,
    stuck: state.mode !== "won" && state.mode !== "lost",
  };
}
