/* ============================================================================
 * balance.mjs — how hard is each level, measured rather than guessed.
 *
 *   npm run balance            (20 seeds per level per bot)
 *   npm run balance -- 50      (more seeds)
 *
 * Plays every level with each scripted bot (test/bots.mjs) across many seeds
 * and prints win rate, star spread, Host Health left and time taken. This is
 * a REPORT, not a test: the targets below print as gaps, they do not fail the
 * build. "A target that fails the build on day one just gets lowered"
 * (GameHub setup/LESSONS.md, Part 0). The pass/fail floor lives in
 * test/unit/levels.test.mjs, and it is deliberately looser.
 *
 * Targets, from docs/DESIGN.md "What the slice must prove":
 *   idle    loses every level (the level has teeth)
 *   casual  usually wins, usually not with 3 stars
 *   good    wins almost always, mostly 2–3 stars
 *   time    each level 4–7 minutes for a person (bots are faster)
 * ========================================================================= */

import { pathToFileURL } from "node:url";
import { LEVELS, cellsAvailableAt } from "../js/data/levels.js";
import { playLevel } from "../test/bots.mjs";

const seeds = Number(process.argv[2]) || 20;
const skills = ["idle", "casual", "good", "reckless"];

export function loadoutFor(level) {
  // Bots bring the level's required cells, then its new ones, then whatever
  // else fits — skipping Bounty Hunters where there is no Barracks to train
  // them. The same shape a sensible player picks on the loadout screen.
  const pick = [...level.requiredCells];
  const add = (c) => { if (pick.length < level.slots && !pick.includes(c)) pick.push(c); };
  for (const c of level.newCells) add(c);
  for (const c of cellsAvailableAt(level.id)) if (c !== "hunter" || level.barracks) add(c);
  return pick;
}

/* Only report when run directly; the unit tests import loadoutFor(). */
if (import.meta.url === pathToFileURL(process.argv[1] || "").href) report();

function report() {
console.log(`\n${seeds} seeds per level per bot\n`);
for (const level of LEVELS) {
  const loadout = loadoutFor(level);
  console.log(`${level.title}  (loadout: ${loadout.join(", ")})`);
  for (const skill of skills) {
    // "reckless" only differs from "casual" where a level has a tempting
    // mistake scripted (Broken bone's Sirens); elsewhere it is noise.
    if (skill === "reckless" && level.id !== "broken-bone") continue;
    const runs = [];
    const t0 = Date.now();
    for (let seed = 1; seed <= seeds; seed++) runs.push(playLevel(level, { skill, seed, loadout }));
    const ms = Date.now() - t0;
    const won = runs.filter((r) => r.won);
    const stars = [0, 1, 2, 3].map((s) => runs.filter((r) => r.stars === s).length);
    const avg = (xs) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0);
    const stuck = runs.filter((r) => r.stuck).length;
    console.log(
      `  ${skill.padEnd(7)} won ${String(won.length).padStart(3)}/${seeds}` +
      `  stars 0:${stars[0]} 1:${stars[1]} 2:${stars[2]} 3:${stars[3]}` +
      `  host ${String(avg(won.map((r) => r.host))).padStart(3)}` +
      `  time ${String(avg(runs.map((r) => r.time))).padStart(4)}s` +
      (stuck ? `  STUCK ${stuck}` : "") +
      `  (${(ms / seeds).toFixed(0)} ms/run)`
    );
  }
  console.log("");
}
}
