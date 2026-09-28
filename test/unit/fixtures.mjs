/* ============================================================================
 * fixtures.mjs — tiny hand-built levels for testing one rule at a time.
 *
 * Real levels mix every mechanic, so a failing test on one of them says
 * "something is wrong somewhere". A fixture holds everything still except
 * the rule under test. Maps use the same legend as js/data/levels.js.
 * ========================================================================= */

import { step, drainEvents, TICK } from "../../js/sim/game.js";

/* Open tissue with a vessel down the left (openings at rows 4, 8, 12). */
export function openRows() {
  return Array.from({ length: 16 }, (_, y) => ([4, 8, 12].includes(y) ? "O" : "V") + "........");
}

export function fixtureLevel(over = {}) {
  return {
    id: "fixture",
    title: "Fixture",
    stage: "test",
    age: 0,
    threatKind: "",
    intro: "",
    teaches: "",
    slots: 5,
    newCells: ["scout", "devourer", "rusher", "hunter", "siren"],
    requiredCells: [],
    alarm: false,
    calm: 0,
    map: openRows(),
    goalLabel: null,
    healing: null,
    barracks: null,
    coach: [],
    phases: [{ id: "only", name: "Only", bodyTime: "", hint: "", fact: "", recap: "", spawns: [], end: { after: 1e9 } }],
    ...over,
  };
}

export function phase(spawns, extra = {}) {
  return { id: "only", name: "Only", bodyTime: "", hint: "", fact: "", recap: "", spawns, end: { after: 1e9 }, ...extra };
}

/* Step `seconds` of game time; returns every event seen. */
export function run(state, seconds) {
  const events = [];
  const n = Math.round(seconds / TICK);
  for (let i = 0; i < n; i++) {
    step(state, TICK);
    events.push(...drainEvents(state));
  }
  return events;
}

/* Step until `pred(state, events)` is true or `limit` seconds pass. */
export function runUntil(state, pred, limit = 120) {
  const events = [];
  const n = Math.round(limit / TICK);
  for (let i = 0; i < n; i++) {
    step(state, TICK);
    const ev = drainEvents(state);
    events.push(...ev);
    if (pred(state, ev)) return { ok: true, events };
  }
  return { ok: false, events };
}

export function count(state, type) {
  return state.threats.filter((t) => !t.dead && t.type === type).length;
}
