/* ============================================================================
 * store.test.mjs — the save file survives everything a real device throws
 * at it. The localStorage paths are covered by test/smoke.mjs in a real
 * browser; these are the pure parts, runnable under Node.
 * ========================================================================= */

import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultState, normalise, exportState, importState, recordResult, isUnlocked,
  cleanName, markSeen, NAME_MAX,
} from "../../js/store.js";
import { LEVELS } from "../../js/data/levels.js";

test("a save missing a field added later comes back with the default, not undefined", () => {
  const old = defaultState();
  delete old.settings.hints;
  delete old.tester;
  const back = normalise(old);
  assert.equal(back.settings.hints, defaultState().settings.hints);
  assert.deepEqual(back.tester, defaultState().tester);
});

test("stored choices win over defaults (defaults go UNDER, never over)", () => {
  const s = defaultState();
  s.settings.sound = false;
  s.person.name = "Jill";
  const back = normalise(s);
  assert.equal(back.settings.sound, false);
  assert.equal(back.person.name, "Jill");
});

test("wrong-shaped collections are coerced, not trusted", () => {
  const back = normalise({ v: 1, progress: [], seen: "nope", loadouts: { cut: "scout" }, settings: null,
    person: { name: 42 } });
  assert.deepEqual(back.progress, {});
  assert.deepEqual(back.seen, {});
  assert.deepEqual(back.loadouts, {});
  assert.equal(back.settings.sound, true);
  assert.equal(back.person.name, "42");
});

test("a progress record with junk in it is clamped", () => {
  const back = normalise({ v: 1, progress: { cut: { stars: 9, best: -5, wins: "x" } } });
  assert.deepEqual(back.progress.cut, { stars: 3, best: 0, wins: 0, plays: 0, lastPlayed: 0 });
});

test("export round-trips; another app's file and a future version are refused", () => {
  const s = defaultState();
  s.person.name = "Billy";
  s.progress.cut = { stars: 2, best: 71, wins: 1, plays: 3, lastPlayed: 5 };
  const back = importState(exportState(s));
  assert.equal(back.person.name, "Billy");
  assert.equal(back.progress.cut.stars, 2);
  assert.equal(importState(JSON.stringify({ app: "popcorn", v: 1, state: s })), null);
  assert.equal(importState(JSON.stringify({ app: "immunedefense", v: 1, state: { ...s, v: 99 } })), null);
  assert.equal(importState("{ not json"), null);
});

test("results keep the best, count every play, and award a Veteran once", () => {
  const s = defaultState();
  recordResult(s, "flu", { won: true, stars: 2, host: 60, rewards: { veteran: "flu" } });
  const first = s.veterans.flu;
  recordResult(s, "flu", { won: false, stars: 0, host: 0 });
  recordResult(s, "flu", { won: true, stars: 1, host: 40, rewards: { veteran: "flu" } });
  assert.equal(s.progress.flu.stars, 2);
  assert.equal(s.progress.flu.best, 60);
  assert.equal(s.progress.flu.plays, 3);
  assert.equal(s.progress.flu.wins, 2);
  assert.equal(s.veterans.flu, first, "the Veteran keeps its first date");
});

test("levels unlock in order, and the tester switch opens them all", () => {
  const s = defaultState();
  assert.equal(isUnlocked(s, LEVELS[0].id), true);
  assert.equal(isUnlocked(s, LEVELS[1].id), false);
  recordResult(s, LEVELS[0].id, { won: false });
  assert.equal(isUnlocked(s, LEVELS[1].id), false, "a loss does not unlock the next level");
  recordResult(s, LEVELS[0].id, { won: true, stars: 1, host: 10 });
  assert.equal(isUnlocked(s, LEVELS[1].id), true);
  assert.equal(isUnlocked(s, LEVELS[2].id), false);
  s.tester.unlockAll = true;
  assert.equal(isUnlocked(s, LEVELS[2].id), true);
});

test("names are trimmed, squeezed and capped", () => {
  assert.equal(cleanName("  Jill   Ann  "), "Jill Ann");
  assert.equal(cleanName("x".repeat(40)).length, NAME_MAX);
  assert.equal(cleanName(undefined), "");
});

test("markSeen only reports a change the first time", () => {
  const s = defaultState();
  assert.equal(markSeen(s, ["cell:scout"]), true);
  assert.equal(markSeen(s, ["cell:scout"]), false);
});
