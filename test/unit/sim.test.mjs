/* ============================================================================
 * sim.test.mjs — the rules, one at a time, on fixture levels.
 *
 *   node --test test/unit/
 *
 * Rules for this file (GameHub setup/LESSONS.md Part 7):
 *   - Numbers come from js/data/, never retyped here (7.5): a tuning change
 *     must not turn a test red; a broken rule must.
 *   - Every assertion here has been watched failing against a deliberately
 *     broken rule before it was trusted (7.2). CLAUDE.md lists the breaks.
 *   - Assert the promise ("a cell holds off at most N"), not the mechanism.
 * ========================================================================= */

import test from "node:test";
import assert from "node:assert/strict";
import * as G from "../../js/sim/game.js";
import { THREATS, ALARM, SIGNAL, HOST } from "../../js/data/threats.js";
import { CELLS } from "../../js/data/cells.js";
import { LEVELS } from "../../js/data/levels.js";
import { playLevel } from "../bots.mjs";
import { loadoutFor } from "../../scripts/balance.mjs";
import { fixtureLevel, phase, run, runUntil, count, openRows } from "./fixtures.mjs";

const { TICK } = G;

function digest(state) {
  return JSON.stringify({
    t: state.t.toFixed(2),
    host: state.host.toFixed(3),
    mode: state.mode,
    stats: state.stats,
    units: state.units.map((u) => [u.type, u.x.toFixed(3), u.y.toFixed(3)]),
  });
}

test("a replay with the same seed is identical; a different seed is not", () => {
  const level = LEVELS[0];
  const a = playLevel(level, { skill: "good", seed: 3, loadout: loadoutFor(level) });
  const b = playLevel(level, { skill: "good", seed: 3, loadout: loadoutFor(level) });
  const c = playLevel(level, { skill: "good", seed: 4, loadout: loadoutFor(level) });
  assert.equal(digest(a.state), digest(b.state));
  assert.notEqual(digest(a.state), digest(c.state));
});

test("bacteria split every splitAfter seconds and stop at maxGen", () => {
  const B = THREATS.bacterium;
  const s = G.createGame(fixtureLevel({ phases: [phase([{ at: 0, type: "bacterium", count: 1, where: "top" }])] }), { seed: 1 });
  // No goal on this map, so nothing leaves; no cells, so nothing kills.
  run(s, B.splitAfter - 0.3);
  assert.equal(count(s, "bacterium"), 1, "no split before splitAfter");
  run(s, 0.6);
  assert.equal(count(s, "bacterium"), 2, "one split at splitAfter");
  run(s, B.splitAfter * (B.maxGen + 3));
  assert.equal(count(s, "bacterium"), 2 ** B.maxGen, "splitting stops at maxGen");
});

test("a Responder cannot be aimed at a hidden threat until a Scout reveals it", () => {
  const s = G.createGame(fixtureLevel({ phases: [phase([{ at: 0, type: "bacterium", count: 1, where: "top" }])] }),
    { seed: 2, loadout: ["rusher", "scout"] });
  run(s, TICK);
  const bug = s.threats.find((t) => t.type === "bacterium");
  assert.equal(G.isVisible(s, bug), false, "starts hidden");
  const sent = G.deploy(s, "rusher", bug.x, bug.y, bug.id);
  assert.ok(sent.ok);
  for (const id of sent.ids) {
    const u = G.unitById(s, id);
    assert.equal(u.order.targetId, undefined, "a hidden target becomes a move order");
  }
  s.signal = SIGNAL.max;
  const scout = G.deploy(s, "scout", Math.max(1.5, bug.x), bug.y + 1.5);
  assert.ok(scout.ok, `scout placed: ${scout.reason}`);
  run(s, TICK);
  assert.equal(G.isVisible(s, bug), true, "revealed within sight");
  assert.equal(G.order(s, sent.ids, bug.x, bug.y, bug.id), sent.ids.length);
  for (const id of sent.ids) assert.equal(G.unitById(s, id).order.targetId, bug.id);
});

test("a cell holds off at most `holds` bacteria; the rest slip past it", () => {
  const rows = openRows();
  rows[0] = "V...W....";
  rows[15] = "BBBBBBBBB";
  const s = G.createGame(fixtureLevel({
    map: rows,
    phases: [phase([{ at: 0.5, type: "bacterium", count: 7, every: 0.05, where: "wound" }])],
  }), { seed: 5, loadout: ["siren"] });
  const siren = G.deploy(s, "siren", 4.5, 3.5);
  assert.ok(siren.ok);
  let most = 0;
  let passed = 0;
  for (let i = 0; i < 20 / TICK; i++) {
    G.step(s);
    G.drainEvents(s);
    const held = s.threats.filter((t) => t.latched === siren.ids[0]).length;
    most = Math.max(most, held);
    passed = Math.max(passed, s.threats.filter((t) => t.type === "bacterium" && t.y > 6).length);
  }
  assert.equal(most, CELLS.siren.holds, "fills up to its limit and no further");
  assert.ok(passed >= 1, "the rest walk past");
});

test("Alarm above the healing band costs Host Health at the documented rate", () => {
  const s = G.createGame(fixtureLevel({ alarm: true }), { seed: 1 });
  s.alarm = 80;                  // nothing is raising it, so it falls
  const over = 80 - ALARM.healHigh;
  // Alarm falls linearly at fallRate; damage is (alarm - high)/10 per second,
  // so the loss is the area of a triangle: over² / (2·fall) / 10.
  const expected = (over * over) / (2 * ALARM.fallRate) / 10 * ALARM.damagePer10Over;
  run(s, over / ALARM.fallRate + 1);
  assert.ok(Math.abs(HOST.max - s.host - expected) < 0.25, `lost ${(HOST.max - s.host).toFixed(2)}, expected ${expected.toFixed(2)}`);
  assert.ok(s.alarm <= ALARM.healHigh);
});

test("the Alarm reaching 100 sets off a cytokine storm with the documented cost", () => {
  const S = ALARM.storm;
  const s = G.createGame(fixtureLevel({ alarm: true }), { seed: 1, loadout: ["siren"] });
  s.signal = 1000;
  const need = Math.ceil(S.at / CELLS.siren.alarm);
  for (let k = 0; k < need; k++) assert.ok(G.deploy(s, "siren", 2.5 + (k % 5), 2.5 + Math.floor(k / 5) * 2).ok);
  const hit = runUntil(s, (st, ev) => ev.some((e) => e.type === "storm"), 60);
  assert.ok(hit.ok, "a storm happens");
  const hpBefore = s.units.map((u) => u.hp);
  const lossBefore = s.stats.hostLoss.storm;
  const end = runUntil(s, (st, ev) => ev.some((e) => e.type === "stormEnd"), S.seconds + 1);
  assert.ok(end.ok, "and ends");
  assert.equal(s.alarm, S.resetTo, "the meter lands at resetTo");
  assert.ok(Math.abs(s.stats.hostLoss.storm - lossBefore - S.hostPerSecond * S.seconds) < 0.2, "host cost");
  const dealt = hpBefore[0] - (s.units[0]?.hp ?? 0);
  assert.ok(Math.abs(dealt - S.cellsPerSecond * S.seconds) < 1, `each cell takes ${S.cellsPerSecond * S.seconds}, took ${dealt}`);
});

function healingFixture() {
  const rows = openRows();
  return fixtureLevel({
    map: rows,
    alarm: true,
    healing: { x: 4.5, y: 8, radius: 2, rate: 1, blockers: ["debris", "pus"], alarmBands: true },
    phases: [phase([], { healing: true })],
  });
}

function healRateWith(sirens) {
  const s = G.createGame(healingFixture(), { seed: 1, loadout: ["siren"] });
  s.signal = 1000;
  for (let k = 0; k < sirens; k++) G.deploy(s, "siren", 2.5 + k, 2.5);
  run(s, 30);                    // let the meter settle on its target
  const before = s.healing;
  run(s, 10);
  return { perSecond: (s.healing - before) / 10, state: s.healState, alarm: s.alarm };
}

test("healing runs full speed inside the Alarm band, half below it, not at all above", () => {
  const lvl = healingFixture().healing;
  const inBand = healRateWith(Math.ceil(ALARM.healLow / CELLS.siren.alarm));
  assert.ok(inBand.alarm >= ALARM.healLow && inBand.alarm <= ALARM.healHigh, `alarm ${inBand.alarm}`);
  assert.ok(Math.abs(inBand.perSecond - lvl.rate) < 0.01, `in band: ${inBand.perSecond}`);
  const low = healRateWith(0);
  assert.ok(Math.abs(low.perSecond - lvl.rate * 0.5) < 0.01, `below band: ${low.perSecond}`);
  const high = healRateWith(Math.ceil((ALARM.healHigh + 5) / CELLS.siren.alarm));
  assert.equal(high.perSecond, 0, "above band");
  assert.equal(high.state, "too-high");
});

test("debris near the wound blocks healing until it is cleared", () => {
  const rows = openRows();
  rows[7] = "V...F....";
  const level = fixtureLevel({
    map: rows,
    healing: { x: 4.5, y: 7.5, radius: 2, rate: 1, blockers: ["debris"] },
    phases: [phase([{ at: 0, type: "debris", count: 1, where: "fracture" }], { healing: true })],
  });
  const s = G.createGame(level, { seed: 1 });
  run(s, 5);
  assert.equal(s.healing, 0);
  assert.equal(s.healState, "blocked");
});

function fluFixture() {
  const rows = [
    ":::::::::", ":::::::::", ":::::::::", ":::::::::", ":::::::::",
    "AAAAAAAAA", "AAAAAAAAA", "AAAAAAAAA",
    "V........", "O........", "V.......K", "V.......K", "O........", "V........", "V........", "BBBBBBBBB",
  ];
  return fixtureLevel({
    map: rows,
    barracks: { x: 8.5, y: 11, fingerprint: "flu", samples: ["virus", "infected"], trainTime: 24 },
    phases: [phase([{ at: 0, type: "virus", count: 6, every: 1, where: "top" }])],
  });
}

test("Bounty Hunters unlock exactly when Barracks training finishes", () => {
  const level = fluFixture();
  const s = G.createGame(level, { seed: 3, loadout: ["scout", "hunter"] });
  assert.equal(G.deploy(s, "hunter", 4.5, 6.5).reason, "needs-training");
  assert.ok(G.deploy(s, "scout", 4.5, 4.5).ok);
  const started = runUntil(s, (st, ev) => ev.some((e) => e.type === "training"), 60);
  assert.ok(started.ok, "a Scout carried the Fingerprint in");
  // Due time from the LEVEL DATA, not from the sim's own event: a test that
  // compared against the sim's reported end time agreed with a sim that
  // trained a second late (scripts/mutation-check.mjs caught it).
  const due = started.events.find((e) => e.type === "training").t + level.barracks.trainTime;
  assert.equal(G.deploy(s, "hunter", 4.5, 6.5).reason, "needs-training", "still training");
  const done = runUntil(s, (st, ev) => ev.some((e) => e.type === "trained"), 60);
  assert.ok(done.ok);
  const at = done.events.find((e) => e.type === "trained").t;
  assert.ok(Math.abs(at - due) <= TICK + 1e-9, `trained at ${at}, due ${due}`);
  s.signal = SIGNAL.max;
  assert.ok(G.deploy(s, "hunter", 4.5, 6.5).ok);
});

test("losing the Scout that carries a Fingerprint puts it back to unknown", () => {
  const s = G.createGame(fluFixture(), { seed: 3, loadout: ["scout"] });
  G.deploy(s, "scout", 4.5, 4.5);
  runUntil(s, (st) => G.fingerprintStatus(st, "flu") === "carrying", 60);
  const carrier = s.units.find((u) => u.carrying);
  assert.ok(carrier);
  G.retire(s, carrier.id);
  assert.equal(G.fingerprintStatus(s, "flu"), "unknown");
});

test("clonal copies stop at copyCap", () => {
  const level = fluFixture();
  level.phases = [phase([{ at: 0, type: "virus", count: 40, every: 0.5, where: "top" }])];
  const s = G.createGame(level, { seed: 4, loadout: ["hunter", "scout"], known: ["flu"] });
  s.signal = 1000;
  G.deploy(s, "scout", 2.5, 4.5);
  G.deploy(s, "scout", 6.5, 4.5);
  for (let x = 1.5; x <= 7.5; x += 3) G.deploy(s, "hunter", x, 6.5);
  run(s, 120);
  assert.equal(s.copies, CELLS.hunter.copyCap, "the cap is reached — and not passed");
  assert.ok(s.units.filter((u) => u.type === "hunter").length <= 3 + CELLS.hunter.copyCap);
});

test("Sentries snap to a tile and refuse terrain and occupied tiles", () => {
  const s = G.createGame(fixtureLevel(), { seed: 1, loadout: ["scout"] });
  s.signal = 1000;
  const a = G.deploy(s, "scout", 3.9, 5.2);
  assert.deepEqual([a.x, a.y], [3.5, 5.5]);
  assert.equal(G.deploy(s, "scout", 3.2, 5.9).reason, "occupied");
  assert.equal(G.deploy(s, "scout", 0.5, 5.5).reason, "terrain", "vessel column");
});

test("deploying costs Signal, and it refills at the documented rate", () => {
  const s = G.createGame(fixtureLevel(), { seed: 1, loadout: ["devourer"] });
  assert.equal(s.signal, SIGNAL.start);
  G.deploy(s, "devourer", 4.5, 4.5);
  assert.equal(s.signal, SIGNAL.start - CELLS.devourer.cost);
  run(s, 2);
  assert.ok(Math.abs(s.signal - (SIGNAL.start - CELLS.devourer.cost + 2 * SIGNAL.perSecond)) < 1e-6);
  s.signal = 0;
  assert.equal(G.deploy(s, "devourer", 5.5, 5.5).reason, "no-signal");
});

test("retiring a Siren lowers the Alarm target by its contribution", () => {
  const s = G.createGame(fixtureLevel({ alarm: true }), { seed: 1, loadout: ["siren"] });
  s.signal = 1000;
  const a = G.deploy(s, "siren", 2.5, 2.5);
  G.deploy(s, "siren", 4.5, 2.5);
  run(s, TICK);
  assert.equal(s.alarmTarget, 2 * CELLS.siren.alarm);
  assert.ok(G.retire(s, a.ids[0]));
  run(s, TICK);
  assert.equal(s.alarmTarget, CELLS.siren.alarm);
});

test("a Rusher dies at the end of its life and leaves pus", () => {
  const s = G.createGame(fixtureLevel(), { seed: 1, loadout: ["rusher"] });
  const r = G.deploy(s, "rusher", 5, 5);
  run(s, CELLS.rusher.life - 0.5);
  assert.equal(s.units.filter((u) => u.type === "rusher").length, CELLS.rusher.squad);
  run(s, 1);
  assert.equal(s.units.filter((u) => u.type === "rusher").length, 0);
  assert.equal(count(s, "pus"), r.ids.length);
});

test("phases run in order and spawn exactly what the level data schedules", () => {
  for (const level of LEVELS) {
    const res = playLevel(level, { skill: "good", seed: 2, loadout: loadoutFor(level) });
    assert.ok(res.won, `${level.id} won by the good bot`);
    const expected = {};
    for (const p of level.phases) for (const sp of p.spawns || []) expected[sp.type] = (expected[sp.type] || 0) + (sp.count ?? 1);
    assert.deepEqual(res.state.stats.spawned, expected, `${level.id} spawned`);
    assert.equal(res.state.phaseIndex, level.phases.length - 1, `${level.id} reached the last phase`);
  }
});
