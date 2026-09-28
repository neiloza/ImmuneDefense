/* ============================================================================
 * mutation-check.mjs — prove the unit tests can fail.
 *
 *   node scripts/mutation-check.mjs
 *
 * House rule (GameHub setup/APP_DESIGN_RULES.md 12, LESSONS 7.2): every
 * assertion must be able to fail, and "if a new test goes green first try,
 * find out why before you believe it" (LESSONS 7.3). This script does that
 * mechanically: it breaks one rule at a time in the source, runs the unit
 * tests, and reports any break the suite FAILED TO NOTICE. Then it puts the
 * file back.
 *
 * Not part of `npm test` — it runs the suite once per mutation, which is
 * slow. Run it after changing tests or rules. Every file it touches is
 * restored in a finally block, but if you kill it mid-run, `git diff js/`
 * shows what to revert.
 * ========================================================================= */

import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const GAME = "js/sim/game.js";
const RNG = "js/sim/rng.js";
const STORE = "js/store.js";
const LEVELS_JS = "js/data/levels.js";

/* [label, file, find, replace] — `find` must occur exactly once. */
const MUTATIONS = [
  ["randomness leaks in", RNG, "  state.rng = (state.rng + 0x6d2b79f5) >>> 0;", "  state.rng = (state.rng + 0x6d2b79f5 + Math.floor(Math.random() * 2)) >>> 0;"],
  ["splitting ignores maxGen", GAME, "th.clock >= def.splitAfter && th.gen < def.maxGen", "th.clock >= def.splitAfter"],
  ["hidden threats are targetable", GAME, "  if (isVisible(state, th)) return true;\n  return !!unit", "  return true;\n  return !!unit"],
  ["no latch capacity", GAME, "u.kind !== \"neutral\" && (state._held.get(u.id) || 0) < (CELLS[u.type]?.holds ?? 2));", "u.kind !== \"neutral\");"],
  ["alarm damage doubled", GAME, "hurtHost(state, (over / 10) * ALARM.damagePer10Over * dt, \"alarm\");", "hurtHost(state, (over / 5) * ALARM.damagePer10Over * dt, \"alarm\");"],
  ["storm does not reset the meter", GAME, "      state.alarm = S.resetTo;\n", ""],
  ["no half-speed healing", GAME, "mult = HEALING.lowBandFactor;", "mult = 1;"],
  ["debris does not block healing", GAME, "  if (blockers) { state.healState = \"blocked\"; return; }", "  if (false) { state.healState = \"blocked\"; return; }"],
  ["training takes a second longer", GAME, "fp.trainEnds = state.t + b.trainTime;", "fp.trainEnds = state.t + b.trainTime + 1;"],
  ["a lost carrier keeps the sample", GAME, "      fp.status = \"unknown\";\n      fp.carrier = null;\n      emit(state, \"sampleLost\"", "      fp.carrier = null;\n      emit(state, \"sampleLost\""],
  ["copies are uncapped", GAME, "if (!def.copyCap || state.copies >= def.copyCap) return;", "if (!def.copyCap) return;"],
  ["sentries stack", GAME, "  if (taken) return { ok: false, reason: \"occupied\", x: cx, y: cy };", ""],
  ["signal refills twice as fast", GAME, "state.signal + SIGNAL.perSecond * boost * dt", "state.signal + SIGNAL.perSecond * 2 * boost * dt"],
  ["sirens count double", GAME, "if (!u.dead && u.type === \"siren\") target += CELLS.siren.alarm;", "if (!u.dead && u.type === \"siren\") target += CELLS.siren.alarm * 2;"],
  ["rushers live forever", GAME, "if (def.life && u.age >= def.life) { killUnit(state, u, \"expired\"); return; }", ""],
  ["every other spawn dropped", GAME, "    spawnThreat(state, s.type, s.where);\n    state.stats.spawned", "    if (state.queue.length % 2) spawnThreat(state, s.type, s.where);\n    state.stats.spawned"],
  // The store.
  ["settings defaults go over, not under", STORE, "out.settings = { ...d.settings, ...obj(s.settings) };", "out.settings = obj(s.settings);"],
  ["progress is not clamped", STORE, "return Math.min(hi, Math.max(lo, n));", "return n;"],
  ["another app's backup is accepted", STORE, "parsed.app !== APP ||", ""],
  ["a worse result overwrites the best", STORE, "rec.stars = Math.max(rec.stars, outcome.stars || 0);", "rec.stars = outcome.stars || 0;"],
  ["every level is open", STORE, "return (state.progress[prev]?.wins || 0) > 0;", "return true;"],
  // The level data: without the trickle, a Flu player who never samples the
  // virus runs the lining out of cells and the level can never end.
  ["Flu's virus trickle removed", LEVELS_JS, "        trickle: { type: \"virus\", every: 4, where: \"top\", until: \"trained\" },\n", ""],
];

const survivors = [];
for (const [label, rel, find, replace] of MUTATIONS) {
  const path = join(ROOT, rel);
  const original = readFileSync(path, "utf8");
  const hits = original.split(find).length - 1;
  if (hits !== 1) {
    console.log(`  SKIP  ${label} — pattern found ${hits} times in ${rel} (update this script)`);
    survivors.push(`${label} (pattern missing)`);
    continue;
  }
  try {
    writeFileSync(path, original.replace(find, replace));
    const res = spawnSync(process.execPath, ["--test", "test/unit/*.test.mjs"], { cwd: ROOT, encoding: "utf8" });
    const caught = res.status !== 0;
    const failing = (res.stdout.match(/^not ok \d+ - (.+)$/gm) || []).map((l) => l.replace(/^not ok \d+ - /, ""));
    console.log(`  ${caught ? "ok  " : "MISS"}  ${label}${caught ? `  → ${failing.slice(0, 2).join("; ")}` : ""}`);
    if (!caught) survivors.push(label);
  } finally {
    writeFileSync(path, original);
  }
}
console.log(survivors.length ? `\n${survivors.length} mutation(s) went unnoticed:\n  ${survivors.join("\n  ")}\n` : "\nEvery mutation was caught.\n");
process.exit(survivors.length ? 1 : 0);
