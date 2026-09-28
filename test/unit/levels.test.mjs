/* ============================================================================
 * levels.test.mjs — the level data is well-formed, every level can be won,
 * and every level punishes doing nothing.
 *
 * The validator half is GameHub setup/LESSONS.md Part 9 applied to a small
 * catalog: required fields, a controlled vocabulary, uniqueness on every
 * axis. A typo in a `where` or an end condition would otherwise surface as a
 * level that silently never ends.
 *
 * The bot half is the pass/fail floor. `npm run balance` prints the full
 * difficulty report; these are the lines it must never cross:
 *   - a good player wins every level,
 *   - a player who does nothing loses every level,
 *   - piling on Sirens (Broken bone's lesson) costs health through the Alarm,
 *   - no level ever gets stuck neither won nor lost.
 * ========================================================================= */

import test from "node:test";
import assert from "node:assert/strict";
import { LEVELS, STAGES, cellsAvailableAt } from "../../js/data/levels.js";
import { CELLS } from "../../js/data/cells.js";
import { THREATS } from "../../js/data/threats.js";
import { TERMS, TERMS_BY_LEVEL } from "../../js/data/guide.js";
import { parseMap } from "../../js/sim/map.js";
import { playLevel } from "../bots.mjs";
import { loadoutFor } from "../../scripts/balance.mjs";

const WHERE = new Set(["wound", "top", "fracture", "bone", "pus", "deadTiles"]);
const END_KEYS = new Set(["after", "spawnsDone", "cleared", "trained", "healed"]);
const LEGEND = new Set([..."..:SWVOBAKXF"]);

test("level ids are unique and every stage points at real levels", () => {
  const ids = LEVELS.map((l) => l.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const s of STAGES) for (const id of s.levels) assert.ok(ids.includes(id), `${s.id} → ${id}`);
  assert.deepEqual(STAGES.flatMap((s) => s.levels), ids, "the life map shows every level, in order");
});

for (const level of LEVELS) {
  test(`${level.id}: data is well-formed`, () => {
    const map = parseMap(level.map);
    for (const row of level.map) for (const ch of row) assert.ok(LEGEND.has(ch), `unknown map character "${ch}"`);
    assert.ok(map.openings.length > 0, "Responders need somewhere to arrive");

    for (const c of [...level.newCells, ...level.requiredCells]) assert.ok(CELLS[c], `unknown cell ${c}`);
    const avail = cellsAvailableAt(level.id);
    for (const c of level.requiredCells) assert.ok(avail.includes(c), `${c} required before it is available`);
    assert.ok(level.slots >= level.requiredCells.length);
    assert.ok(level.intro.includes("{name}"), "the intro names the player's person");

    const phaseIds = level.phases.map((p) => p.id);
    assert.equal(new Set(phaseIds).size, phaseIds.length, "phase ids unique");
    assert.ok(level.phases.length >= 3, "a level plays the illness from start to finish");
    for (const p of level.phases) {
      for (const f of ["name", "bodyTime", "hint", "fact", "recap"]) assert.ok(p[f], `${p.id} missing ${f}`);
      for (const sp of p.spawns || []) {
        assert.ok(THREATS[sp.type], `${p.id}: unknown threat ${sp.type}`);
        assert.ok(WHERE.has(sp.where), `${p.id}: unknown where "${sp.where}"`);
      }
      if (p.trickle) {
        assert.ok(THREATS[p.trickle.type]);
        assert.ok(WHERE.has(p.trickle.where));
        assert.ok(p.trickle.every > 0);
      }
      const keys = Object.keys(p.end || {});
      assert.ok(keys.length > 0, `${p.id}: a phase with no end condition ends instantly`);
      for (const k of keys) assert.ok(END_KEYS.has(k), `${p.id}: unknown end condition ${k}`);
      if (p.end.trained) assert.equal(p.end.trained, level.barracks?.fingerprint, `${p.id}: trains a Fingerprint this level has`);
      if (p.end.healed != null || p.healing) assert.ok(level.healing, `${p.id}: heals on a level with no Healing bar`);
      if (p.end.cleared) for (const t of p.end.cleared) assert.ok(THREATS[t]);
    }

    for (const step of level.coach || []) {
      if (step.cell) assert.ok(CELLS[step.cell], `coach names unknown cell ${step.cell}`);
      if (step.when.startsWith("phase:")) assert.ok(phaseIds.includes(step.when.slice(6)), `coach waits for unknown phase ${step.when}`);
      if (step.done?.phase) assert.ok(phaseIds.includes(step.done.phase));
      if (step.at) assert.ok(step.at[0] >= 0 && step.at[0] <= 9 && step.at[1] >= 0 && step.at[1] <= 16);
    }
    for (const id of TERMS_BY_LEVEL[level.id] || []) assert.ok(TERMS.some((t) => t.id === id), `unknown term ${id}`);
  });
}

for (const level of LEVELS) {
  test(`${level.id}: a good player wins, doing nothing loses, and nothing gets stuck`, () => {
    const loadout = loadoutFor(level);
    for (let seed = 1; seed <= 4; seed++) {
      const good = playLevel(level, { skill: "good", seed, loadout });
      assert.ok(!good.stuck, `good bot stuck on seed ${seed} in phase ${good.phase}`);
      assert.ok(good.won, `good bot lost on seed ${seed}`);
    }
    for (let seed = 1; seed <= 3; seed++) {
      const idle = playLevel(level, { skill: "idle", seed, loadout });
      assert.ok(!idle.stuck, `doing nothing got stuck on seed ${seed} in phase ${idle.phase} — a soft-lock`);
      assert.ok(!idle.won, `doing nothing WON on seed ${seed}`);
    }
  });
}

test("broken-bone: piling on Sirens costs health through the Alarm", () => {
  const level = LEVELS.find((l) => l.id === "broken-bone");
  const loadout = loadoutFor(level);
  for (let seed = 1; seed <= 3; seed++) {
    const r = playLevel(level, { skill: "reckless", seed, loadout });
    const loss = r.state.stats.hostLoss;
    assert.ok(loss.alarm + loss.storm > 20, `seed ${seed}: the Alarm cost only ${(loss.alarm + loss.storm).toFixed(1)}`);
    const calm = playLevel(level, { skill: "good", seed, loadout });
    assert.ok(calm.host > r.host, "managing the Alarm beats ignoring it");
  }
});
