/* ============================================================================
 * game.js — the rules of a level. PURE: no DOM, no clock, no Math.random.
 *
 * The whole game is `state = createGame(level, {seed, loadout})`, then
 * `step(state)` twenty times a second, with the player's taps arriving as
 * commands (`deploy`, `order`, `retire`, `skipCalm`, `continueInterlude`).
 * The browser, the unit tests and the balance bots all drive it the same way,
 * which is what makes a bot's "this level is winnable" mean something about
 * the level a person plays.
 *
 * Three rules for editing this file:
 *
 * 1. Every tunable number lives in js/data/. A literal here is a rule of the
 *    game ("a tile's centre is +0.5"), never a balance value.
 * 2. Randomness only through random(state) (js/sim/rng.js). Replays must not
 *    drift, or the tests cannot fail for the right reason.
 * 3. The renderer and UI READ state; only the functions exported here WRITE
 *    it. That keeps "what happened" in one place, reported through
 *    `state.events` (drained by the UI each frame for sound, particles and
 *    coaching).
 *
 * Distances are in tiles, time in seconds (see js/sim/map.js).
 * ========================================================================= */

import { CELLS, NEUTRALS } from "../data/cells.js";
import { THREATS, HOST, SIGNAL, ALARM, HEALING } from "../data/threats.js";
import { parseMap, isPlaceableTile, clampToMap, fractureCentre, MAP_W } from "./map.js";
import { seedFrom, random, randRange, randPick } from "./rng.js";

/* 20 ticks a second (docs/DESIGN.md, Tech plan). The renderer interpolates
 * between ticks, so motion is smooth at 60 fps while the rules stay cheap. */
export const TICK = 1 / 20;

/* A revealed threat stays visible this long after it leaves every Scout's
 * sight, so a group does not flicker out mid-tap. */
export const REVEAL_LINGER = 5;

/* A Scout announces newly revealed threats at most this often. */
const PING_COOLDOWN = 4;

/* Close enough to count as "arrived" at a point. */
const ARRIVE = 0.12;

/* ------------------------------------------------------------------------ */
/* creation                                                                  */
/* ------------------------------------------------------------------------ */

export function createGame(level, opts = {}) {
  const map = parseMap(level.map);
  const state = {
    level,
    map,
    loadout: [...(opts.loadout || Object.keys(CELLS))],
    rng: seedFrom(level.id, opts.seed ?? 1),
    t: 0,
    tick: 0,
    // calm → phase → interlude → phase → … → won | lost
    mode: "calm",
    calmLeft: level.calm ?? 0,
    phaseIndex: -1,
    phaseT: 0,
    queue: [],
    trickled: 0,
    host: HOST.max,
    signal: SIGNAL.start,
    alarm: 0,
    alarmTarget: 0,
    storm: 0,
    healing: 0,
    healState: "idle",
    healBlockers: 0,
    units: [],
    threats: [],
    lining: {},
    fingerprints: {},
    copies: 0,
    nextId: 1,
    events: [],
    stats: {
      hostLoss: { leak: 0, burst: 0, alarm: 0, storm: 0 },
      kills: 0, leaks: 0, bursts: 0, infections: 0, splits: 0,
      deployed: {}, peakAlarm: 0, stormCount: 0,
      // Threats that arrived from the phase schedule (not splits or bursts),
      // by type — what the level data promised, for the tests to check.
      spawned: {}, trickled: {},
    },
    outcome: null,
  };
  for (const tile of map.lining) state.lining[tile.i] = { status: "healthy", regrow: 0 };
  if (level.barracks) {
    state.fingerprints[level.barracks.fingerprint] = {
      status: "unknown", carrier: null, trainStarted: null, trainEnds: null,
    };
  }
  // Fingerprints the body already knows (a Veteran from an earlier level).
  // Not used by the three slice levels; kept so later levels and the tests
  // can start with specialists trained.
  for (const fp of opts.known || []) {
    if (state.fingerprints[fp]) state.fingerprints[fp].status = "ready";
  }
  if (state.calmLeft <= 0) startPhase(state, 0);
  return state;
}

/* ------------------------------------------------------------------------ */
/* the tick                                                                  */
/* ------------------------------------------------------------------------ */

export function step(state, dt = TICK) {
  if (state.mode !== "calm" && state.mode !== "phase") return;

  state.t += dt;
  state.tick += 1;
  for (const u of state.units) { u.px = u.x; u.py = u.y; }
  for (const th of state.threats) { th.px = th.x; th.py = th.y; }

  if (state.mode === "calm") {
    state.calmLeft -= dt;
  } else {
    state.phaseT += dt;
    runQueue(state);
  }

  updateDetection(state, dt);
  updateUnits(state, dt);
  updateThreats(state, dt);
  separate(state);
  sweep(state);
  updateAlarm(state, dt);
  sweep(state);            // a cytokine storm can kill cells
  updateLining(state, dt);
  updateHealing(state, dt);
  updateBarracks(state);
  regenSignal(state, dt);

  if (state.host <= 0) return lose(state);
  if (state.mode === "calm") {
    if (state.calmLeft <= 0) startPhase(state, 0);
  } else if (phaseDone(state)) {
    endPhase(state);
  }
}

/* ------------------------------------------------------------------------ */
/* commands — the only ways the player changes the world                     */
/* ------------------------------------------------------------------------ */

/**
 * Deploy a cell. Sentries go on the tile under (x, y). Responders arrive at
 * the vessel opening nearest (x, y) and head for `targetId` (a visible threat
 * they can fight) or, failing that, the point itself.
 *
 * Returns { ok: true, ids, x, y } or { ok: false, reason } where reason is
 * one of: not-now, not-in-loadout, needs-training, no-signal, terrain,
 * occupied.
 */
export function deploy(state, cellId, x, y, targetId = null) {
  if (state.mode !== "calm" && state.mode !== "phase") return { ok: false, reason: "not-now" };
  const def = CELLS[cellId];
  if (!def || !state.loadout.includes(cellId)) return { ok: false, reason: "not-in-loadout" };
  if (def.needsFingerprint && fingerprintStatus(state, def.needsFingerprint) !== "ready") {
    return { ok: false, reason: "needs-training" };
  }
  if (state.signal + 1e-9 < def.cost) return { ok: false, reason: "no-signal" };

  if (def.kind === "sentry") {
    const spot = placementCheck(state, cellId, x, y);
    if (!spot.ok) return spot;
    state.signal -= def.cost;
    const u = addUnit(state, cellId, spot.x, spot.y);
    countDeploy(state, cellId);
    emit(state, "deploy", { cell: cellId, ids: [u.id], x: spot.x, y: spot.y });
    return { ok: true, ids: [u.id], x: spot.x, y: spot.y };
  }

  let target = targetId != null ? threatById(state, targetId) : null;
  if (target && !canTarget(state, def, target, null)) target = null;
  const [tx, ty] = clampToMap(target ? target.x : x, target ? target.y : y);
  const gate = nearestOpening(state, tx, ty);
  state.signal -= def.cost;
  const squad = state.nextId++;
  const n = def.squad || 1;
  const ids = [];
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + random(state) * 0.6;
    const u = addUnit(state, cellId, gate.x + Math.cos(a) * 0.22, gate.y + Math.sin(a) * 0.22, {
      squad,
      postX: tx,
      postY: ty,
      order: target ? { targetId: target.id, lx: target.x, ly: target.y } : { x: tx, y: ty },
    });
    ids.push(u.id);
  }
  countDeploy(state, cellId);
  emit(state, "deploy", { cell: cellId, ids, x: tx, y: ty, from: gate });
  return { ok: true, ids, x: tx, y: ty };
}

/** Redirect Responders to a visible threat, or to a point they then guard. */
export function order(state, unitIds, x, y, targetId = null) {
  const target = targetId != null ? threatById(state, targetId) : null;
  let moved = 0;
  for (const id of unitIds) {
    const u = unitById(state, id);
    if (!u || u.dead || u.kind !== "responder") continue;
    const def = CELLS[u.type];
    if (target && canTarget(state, def, target, null)) {
      u.order = { targetId: target.id, lx: target.x, ly: target.y };
    } else {
      const [cx, cy] = clampToMap(x, y);
      u.order = { x: cx, y: cy };
    }
    u.target = null;
    moved++;
  }
  if (moved) emit(state, "order", { ids: [...unitIds], x, y, targetId });
  return moved;
}

/** Retire a Sentry. The only way to lower the Alarm a Siren is holding up. */
export function retire(state, unitId) {
  const u = unitById(state, unitId);
  if (!u || u.dead || u.kind !== "sentry") return false;
  emit(state, "retire", { cell: u.type, x: u.x, y: u.y });
  killUnit(state, u, "retire");
  sweep(state);
  return true;
}

/** Start the first phase now instead of waiting out the calm countdown. */
export function skipCalm(state) {
  if (state.mode !== "calm") return false;
  state.calmLeft = 0;
  startPhase(state, 0);
  return true;
}

/** Leave the between-phases pause and start the next phase. */
export function continueInterlude(state) {
  if (state.mode !== "interlude") return false;
  startPhase(state, state.phaseIndex + 1);
  return true;
}

/* ------------------------------------------------------------------------ */
/* queries for the UI, bots and tests (read-only)                            */
/* ------------------------------------------------------------------------ */

export function currentPhase(state) {
  return state.phaseIndex >= 0 ? state.level.phases[state.phaseIndex] : null;
}

export function fingerprintStatus(state, fp) {
  return state.fingerprints[fp]?.status || "none";
}

export function isVisible(state, th) {
  return !THREATS[th.type].hidden || th.seenUntil >= state.t;
}

export function threatById(state, id) {
  for (const th of state.threats) if (th.id === id && !th.dead) return th;
  return null;
}

export function unitById(state, id) {
  for (const u of state.units) if (u.id === id && !u.dead) return u;
  return null;
}

/** Can a Sentry go here? Snaps to the tile centre. */
export function placementCheck(state, cellId, x, y) {
  const def = CELLS[cellId];
  if (!def) return { ok: false, reason: "not-in-loadout" };
  if (def.kind !== "sentry") return { ok: true, x, y };
  const cx = Math.floor(x) + 0.5;
  const cy = Math.floor(y) + 0.5;
  if (!isPlaceableTile(state.map, cx, cy)) return { ok: false, reason: "terrain", x: cx, y: cy };
  const taken = state.units.some((u) => !u.dead && u.kind === "sentry" &&
    Math.abs(u.postX - cx) < 0.5 && Math.abs(u.postY - cy) < 0.5);
  if (taken) return { ok: false, reason: "occupied", x: cx, y: cy };
  return { ok: true, x: cx, y: cy };
}

/** The visible threat nearest (x, y) within `r` of its edge, or null. */
export function pickThreat(state, x, y, r, filter = null) {
  let best = null;
  let bestD = Infinity;
  for (const th of state.threats) {
    if (th.dead || !isVisible(state, th)) continue;
    if (filter && !filter(th)) continue;
    const d = Math.hypot(th.x - x, th.y - y) - THREATS[th.type].radius;
    if (d <= r && d < bestD) { best = th; bestD = d; }
  }
  return best;
}

/** Your cell nearest (x, y) within `r` of its edge, or null. */
export function pickUnit(state, x, y, r, filter = null) {
  let best = null;
  let bestD = Infinity;
  for (const u of state.units) {
    if (u.dead || u.kind === "neutral") continue;
    if (filter && !filter(u)) continue;
    const d = Math.hypot(u.x - x, u.y - y) - radiusOf(u);
    if (d <= r && d < bestD) { best = u; bestD = d; }
  }
  return best;
}

/** Hand the UI everything that happened since it last asked. */
export function drainEvents(state) {
  const out = state.events;
  state.events = [];
  return out;
}

export function starsFor(host) {
  for (const s of HOST.stars) if (host >= s.min) return s.stars;
  return 0;
}

export function countThreats(state, types) {
  let n = 0;
  for (const th of state.threats) if (!th.dead && types.includes(th.type)) n++;
  return n;
}

/* ------------------------------------------------------------------------ */
/* phases                                                                    */
/* ------------------------------------------------------------------------ */

function startPhase(state, index) {
  const phase = state.level.phases[index];
  state.mode = "phase";
  state.phaseIndex = index;
  state.phaseT = 0;
  state.queue = expandSpawns(phase.spawns || []);
  state.trickled = 0;
  if (phase.builders) ensureBuilders(state);
  emit(state, "phaseStart", { index, id: phase.id });
}

function expandSpawns(spawns) {
  const q = [];
  for (const s of spawns) {
    const n = s.count ?? 1;
    for (let k = 0; k < n; k++) q.push({ at: s.at + k * (s.every || 0), type: s.type, where: s.where });
  }
  // Array.prototype.sort is stable, so equal times keep their written order.
  return q.sort((a, b) => a.at - b.at);
}

function runQueue(state) {
  while (state.queue.length && state.queue[0].at <= state.phaseT + 1e-9) {
    const s = state.queue.shift();
    spawnThreat(state, s.type, s.where);
    state.stats.spawned[s.type] = (state.stats.spawned[s.type] || 0) + 1;
  }
  // A trickle is not part of the queue, so it never holds up `spawnsDone`.
  const tr = currentPhase(state)?.trickle;
  if (tr && (!tr.until || fingerprintStatus(state, tr.until) !== "ready")) {
    const due = Math.floor(state.phaseT / tr.every);
    if (due > (state.trickled || 0)) {
      state.trickled = due;
      spawnThreat(state, tr.type, tr.where);
      state.stats.trickled[tr.type] = (state.stats.trickled[tr.type] || 0) + 1;
    }
  }
}

function phaseDone(state) {
  const phase = currentPhase(state);
  if (!phase) return false;
  const e = phase.end || {};
  if (e.after != null && state.phaseT < e.after) return false;
  if (e.spawnsDone && state.queue.length) return false;
  if (e.cleared && state.threats.some((th) => !th.dead && e.cleared.includes(th.type))) return false;
  if (e.trained && fingerprintStatus(state, e.trained) !== "ready") return false;
  if (e.healed != null && state.healing < e.healed - 1e-9) return false;
  return true;
}

function endPhase(state) {
  const index = state.phaseIndex;
  emit(state, "phaseEnd", { index, id: state.level.phases[index].id });
  if (index >= state.level.phases.length - 1) return win(state);
  state.mode = "interlude";
}

function win(state) {
  state.mode = "won";
  const stars = starsFor(state.host);
  state.outcome = {
    won: true,
    stars,
    host: Math.round(state.host),
    rewards: state.level.rewards || {},
    stats: state.stats,
    time: state.t,
  };
  emit(state, "won", { stars });
}

function lose(state) {
  state.mode = "lost";
  state.host = 0;
  const loss = state.stats.hostLoss;
  const cause = Object.keys(loss).reduce((a, b) => (loss[b] > loss[a] ? b : a), "leak");
  state.outcome = { won: false, stars: 0, host: 0, cause, stats: state.stats, time: state.t };
  emit(state, "lost", { cause });
}

/* ------------------------------------------------------------------------ */
/* spawning                                                                  */
/* ------------------------------------------------------------------------ */

function spawnThreat(state, type, where) {
  const [x, y] = spawnPoint(state, where);
  const extra = {};
  if (type === "bacterium") extra.gx = goalX(state, x);
  return addThreat(state, type, x, y, extra);
}

function spawnPoint(state, where) {
  const m = state.map;
  switch (where) {
    case "wound": {
      const rows = m.wound.map((t) => t.y);
      const deepest = Math.max(...rows);
      const tile = randPick(state, m.wound.filter((t) => t.y === deepest));
      return [tile.x + randRange(state, 0.15, 0.85), tile.y + randRange(state, 0.3, 0.9)];
    }
    case "top":
      return [randRange(state, 0.5, 8.5), 0.25];
    case "fracture": {
      const c = fractureCentre(m) || { x: 4.5, y: 8 };
      const a = random(state) * Math.PI * 2;
      const r = randRange(state, 0.35, 2.1);
      return clampToMap(c.x + Math.cos(a) * r * 1.25, c.y + Math.sin(a) * r * 0.85);
    }
    case "bone": {
      const tile = randPick(state, m.bone) || { x: 4, y: 8 };
      return [tile.x + randRange(state, 0.2, 0.8), tile.y + randRange(state, 0.2, 0.8)];
    }
    case "pus": {
      const blobs = state.threats.filter((th) => !th.dead && th.type === "pus");
      const blob = randPick(state, blobs);
      if (blob) return [blob.x + randRange(state, -0.15, 0.15), blob.y + randRange(state, -0.15, 0.15)];
      return spawnPoint(state, "wound");
    }
    case "deadTiles": {
      const dead = m.lining.filter((t) => state.lining[t.i]?.status === "dead");
      const tile = randPick(state, dead.length ? dead : m.lining);
      return [tile.x + randRange(state, 0.25, 0.75), tile.y + randRange(state, 0.25, 0.75)];
    }
    default:
      return [4.5, 1];
  }
}

/* Where along the goal a bacterium is heading. Spread across the width so a
 * wave fans out as it sinks — a single file down the middle would make one
 * well-placed Devourer the whole answer. */
function goalX(state, x) {
  return Math.min(8.2, Math.max(0.8, x + randRange(state, -3.2, 3.2)));
}

function ensureBuilders(state) {
  const have = state.units.filter((u) => !u.dead && u.type === "builder").length;
  const c = fractureCentre(state.map);
  if (!c || have >= 2) return;
  const posts = [{ x: c.x - 0.85, y: c.y }, { x: c.x + 0.85, y: c.y }];
  for (let k = have; k < 2; k++) {
    const post = posts[k];
    const gate = nearestOpening(state, post.x, post.y);
    addUnit(state, "builder", gate.x, gate.y, { postX: post.x, postY: post.y });
  }
  emit(state, "builders", {});
}

/* ------------------------------------------------------------------------ */
/* detection                                                                 */
/* ------------------------------------------------------------------------ */

function updateDetection(state, dt) {
  const scouts = state.units.filter((u) => !u.dead && u.type === "scout");
  if (!scouts.length) return;
  const sight = CELLS.scout.sight;
  for (const s of scouts) s.pingCd = Math.max(0, s.pingCd - dt);
  for (const th of state.threats) {
    if (th.dead || !THREATS[th.type].hidden) continue;
    for (const s of scouts) {
      if (dist2(s, th) > sight * sight) continue;
      const wasVisible = th.seenUntil >= state.t;
      th.seenUntil = state.t + REVEAL_LINGER;
      if (!wasVisible) {
        emit(state, "reveal", { threat: th.type, id: th.id });
        if (s.pingCd <= 0) {
          emit(state, "ping", { x: th.x, y: th.y, threat: th.type, scout: s.id });
          s.pingCd = PING_COOLDOWN;
        }
      }
      break;
    }
  }
}

/* ------------------------------------------------------------------------ */
/* your cells                                                                */
/* ------------------------------------------------------------------------ */

function updateUnits(state, dt) {
  // Hunters copy themselves mid-loop; new cells start acting next tick.
  const n = state.units.length;
  for (let k = 0; k < n; k++) {
    const u = state.units[k];
    if (u.dead) continue;
    u.age += dt;
    if (u.type === "scout") updateScout(state, u, dt);
    else if (u.type === "devourer") updateDevourer(state, u, dt);
    else if (u.type === "rusher" || u.type === "hunter") updateResponder(state, u, dt);
    else if (u.type === "builder") moveToward(u, u.postX, u.postY, NEUTRALS.builder.speed, dt);
    // Sirens do not act; they exist, and the Alarm counts them.
  }
}

function updateScout(state, s, dt) {
  const def = CELLS.scout;
  const b = state.level.barracks;

  if (s.task === "carry" && b) {
    const d = moveToward(s, b.x, b.y, def.carrySpeed, dt);
    if (d <= 0.35) {
      const fp = state.fingerprints[s.carrying];
      if (fp && fp.status === "carrying") {
        fp.status = "training";
        fp.carrier = null;
        fp.trainStarted = state.t;
        fp.trainEnds = state.t + b.trainTime;
        emit(state, "training", { fingerprint: s.carrying, ends: fp.trainEnds });
      }
      s.carrying = null;
      s.task = "return";
    }
    return;
  }

  if (s.task === "return") {
    const d = moveToward(s, s.postX, s.postY, def.carrySpeed, dt);
    if (d <= ARRIVE) { s.x = s.postX; s.y = s.postY; s.task = "post"; }
    return;
  }

  // At its post. The first Scout to touch an unknown invader takes its
  // Fingerprint and walks it to the Barracks — leaving its post unwatched
  // while it goes, which is the real cost of the learning track.
  if (!b) return;
  const fp = state.fingerprints[b.fingerprint];
  if (!fp || fp.status !== "unknown") return;
  const th = nearestThreat(state, s.x, s.y, def.sampleRange, (t) => b.samples.includes(t.type));
  if (!th) return;
  fp.status = "carrying";
  fp.carrier = s.id;
  s.carrying = b.fingerprint;
  s.task = "carry";
  emit(state, "sample", { fingerprint: b.fingerprint, x: s.x, y: s.y });
}

function updateDevourer(state, d, dt) {
  const def = CELLS.devourer;
  d.cd = Math.max(0, d.cd - dt);
  const edible = (th) => def.targets.includes(th.type);

  // Anything in reach gets swallowed — revealed or not. A Devourer does not
  // need a Scout; it needs something to bump into.
  const meal = nearestThreat(state, d.x, d.y, def.reach, edible);
  if (meal) {
    if (d.cd <= 0) {
      d.cd = def.eatEvery;
      d.kills += 1;
      emit(state, "eat", { x: meal.x, y: meal.y, threat: meal.type, id: meal.id });
      killThreat(state, meal, d, "eaten");
    }
    return;
  }

  // Otherwise creep toward the nearest food near its post, never straying
  // further than `leash` — real macrophages crawl, but a Sentry that wandered
  // off would stop being where the player put it.
  const food = nearestThreat(state, d.postX, d.postY, def.forage, edible);
  let tx = d.postX;
  let ty = d.postY;
  if (food) {
    const dx = food.x - d.postX;
    const dy = food.y - d.postY;
    const len = Math.hypot(dx, dy) || 1;
    const lim = Math.min(len, def.leash);
    tx = d.postX + (dx / len) * lim;
    ty = d.postY + (dy / len) * lim;
  }
  moveToward(d, tx, ty, def.creepSpeed, dt);
}

function updateResponder(state, u, dt) {
  const def = CELLS[u.type];
  if (def.life && u.age >= def.life) { killUnit(state, u, "expired"); return; }

  let target = null;

  // 1. An ordered target: chase it while it lives. When it dies, hold the
  //    spot where it was last seen ("hold that spot until given a new order").
  if (u.order && u.order.targetId != null) {
    const th = threatById(state, u.order.targetId);
    if (th) {
      target = th;
      u.order.lx = th.x;
      u.order.ly = th.y;
    } else {
      u.postX = u.order.lx ?? u.postX;
      u.postY = u.order.ly ?? u.postY;
      u.order = null;
    }
  }

  // 2. An ordered point: go there, fighting only what is actually touching.
  if (!target && u.order && u.order.x != null) {
    const touching = nearestTargetable(state, u, def, u.x, u.y, def.reach + 0.05);
    if (touching) {
      target = touching;
    } else {
      const d = moveToward(u, u.order.x, u.order.y, def.speed, dt);
      if (d <= ARRIVE) { u.postX = u.order.x; u.postY = u.order.y; u.order = null; }
      return;
    }
  }

  // 3. Guarding: keep a valid target inside the leash, or find the nearest.
  if (!target) {
    const cur = u.target != null ? threatById(state, u.target) : null;
    const post = { x: u.postX, y: u.postY };
    if (cur && canTarget(state, def, cur, u) && Math.sqrt(dist2(cur, post)) <= def.leash + 0.5) {
      target = cur;
    } else {
      target = nearestTargetable(state, u, def, u.postX, u.postY, def.leash);
    }
  }

  u.target = target ? target.id : null;
  if (!target) { moveToward(u, u.postX, u.postY, def.speed, dt); return; }

  const reach = def.reach + THREATS[target.type].radius;
  if (Math.sqrt(dist2(u, target)) > reach) {
    moveToward(u, target.x, target.y, def.speed, dt, reach * 0.85);
    return;
  }

  target.hp -= def.dps * dt;
  if (target.hp > 0) return;

  const killedOrder = u.order && u.order.targetId === target.id;
  const kx = target.x;
  const ky = target.y;
  killThreat(state, target, u, "killed");
  u.kills += 1;
  if (killedOrder) { u.postX = kx; u.postY = ky; u.order = null; }
  u.target = null;
  if (u.type === "hunter") tryCopy(state, u);
  if (def.maxKills && u.kills >= def.maxKills) killUnit(state, u, "spent");
}

/* Clonal expansion: a Bounty Hunter that finds its target copies itself. */
function tryCopy(state, u) {
  const def = CELLS[u.type];
  if (!def.copyCap || state.copies >= def.copyCap) return;
  state.copies += 1;
  const a = random(state) * Math.PI * 2;
  const twin = addUnit(state, u.type, u.x + Math.cos(a) * 0.35, u.y + Math.sin(a) * 0.35, {
    squad: u.squad, postX: u.postX, postY: u.postY,
  });
  emit(state, "copy", { x: twin.x, y: twin.y, id: twin.id, copies: state.copies });
}

/* ------------------------------------------------------------------------ */
/* threats                                                                   */
/* ------------------------------------------------------------------------ */

function updateThreats(state, dt) {
  // How many bacteria each cell is already holding off. A cell full up is
  // walked past — which is what stops two Devourers under the wound from
  // being the whole answer to a wave.
  state._held = new Map();
  for (const th of state.threats) {
    if (!th.dead && th.latched != null) state._held.set(th.latched, (state._held.get(th.latched) || 0) + 1);
  }
  const n = state.threats.length;
  for (let k = 0; k < n; k++) {
    const th = state.threats[k];
    if (th.dead) continue;
    th.age += dt;
    if (th.type === "bacterium") updateBacterium(state, th, dt);
    else if (th.type === "virus") updateVirus(state, th, dt);
    else if (th.type === "infected") updateInfected(state, th);
    else if (th.type === "pus" && th.age >= THREATS.pus.decayAfter) {
      th.dead = true;
      emit(state, "drain", { x: th.x, y: th.y });
    }
  }
}

function updateBacterium(state, th, dt) {
  const def = THREATS.bacterium;

  th.clock += dt;
  if (th.clock >= def.splitAfter && th.gen < def.maxGen) {
    th.clock = 0;
    th.gen += 1;
    const a = random(state) * Math.PI * 2;
    addThreat(state, "bacterium", th.x + Math.cos(a) * 0.3, th.y + Math.sin(a) * 0.3, {
      gen: th.gen,
      seenUntil: th.seenUntil,
      gx: goalX(state, th.x),
    });
    state.stats.splits += 1;
    emit(state, "split", { x: th.x, y: th.y });
  }

  // Latched onto one of your cells: stay on it and bite.
  let host = th.latched != null ? unitById(state, th.latched) : null;
  if (host && Math.sqrt(dist2(host, th)) > def.latchRange + radiusOf(host) + 0.25) host = null;
  if (!host) {
    if (th.latched != null) state._held.set(th.latched, Math.max(0, (state._held.get(th.latched) || 1) - 1));
    th.latched = null;
    host = nearestUnitEdge(state, th.x, th.y, def.latchRange, (u) =>
      u.kind !== "neutral" && (state._held.get(u.id) || 0) < (CELLS[u.type]?.holds ?? 2));
    if (host) {
      th.latched = host.id;
      state._held.set(host.id, (state._held.get(host.id) || 0) + 1);
    }
  }
  if (host) {
    moveToward(th, host.x, host.y, def.speed, dt, radiusOf(host) + def.radius * 0.6);
    host.hp -= def.bite * dt;
    if (host.hp <= 0) killUnit(state, host, "bitten");
    return;
  }

  const goalY = state.map.goalY;
  if (goalY == null) {
    moveToward(th, th.gx, th.y + Math.sin(th.age + th.seed * 6.3), def.speed * 0.4, dt);
    return;
  }
  const wobble = Math.sin(th.age * 1.7 + th.seed * 6.283) * 0.35;
  moveToward(th, th.gx + wobble, goalY + 0.6, def.speed, dt);
  if (th.y >= goalY) {
    th.dead = true;
    state.stats.leaks += 1;
    hurtHost(state, def.hostDamage, "leak");
    emit(state, "leak", { x: th.x, y: th.y, damage: def.hostDamage });
  }
}

function updateVirus(state, th, dt) {
  const def = THREATS.virus;
  if (th.age >= def.life) {
    th.dead = true;
    emit(state, "fizzle", { x: th.x, y: th.y });
    return;
  }
  let tile = th.tile >= 0 ? state.lining[th.tile] : null;
  if (!tile || tile.status !== "healthy" || !isExposed(state, th.tile)) {
    th.tile = pickLiningTarget(state, th);
    tile = th.tile >= 0 ? state.lining[th.tile] : null;
  }
  if (!tile) {
    // Nothing left to infect: drift and fall apart.
    moveToward(th, th.x + Math.sin(th.age * 2 + th.seed * 6) * 0.5, th.y + 0.3, def.speed * 0.3, dt);
    return;
  }
  const cx = (th.tile % MAP_W) + 0.5;
  const cy = Math.floor(th.tile / MAP_W) + 0.5;
  const d = moveToward(th, cx, cy, def.speed, dt);
  if (d <= def.infectRange) infect(state, th, th.tile);
}

/* A lining cell can be reached from the airway (the top row), or once a
 * neighbour has died and opened a hole. That makes the infection move as a
 * FRONT down from the airway, which is both closer to life and something a
 * player can get ahead of. */
function isExposed(state, i) {
  const m = state.map;
  const x = i % MAP_W;
  const y = Math.floor(i / MAP_W);
  if (y === m.liningTop) return true;
  const n = [];
  if (y > 0) n.push(i - MAP_W);
  if (y < 15) n.push(i + MAP_W);
  if (x > 0) n.push(i - 1);
  if (x < MAP_W - 1) n.push(i + 1);
  return n.some((j) => state.lining[j]?.status === "dead");
}

function pickLiningTarget(state, th) {
  const options = [];
  for (const tile of state.map.lining) {
    const cell = state.lining[tile.i];
    if (cell.status !== "healthy" || !isExposed(state, tile.i)) continue;
    const d = dist2(th, { x: tile.x + 0.5, y: tile.y + 0.5 });
    options.push({ i: tile.i, d });
  }
  if (!options.length) return -1;
  options.sort((a, b) => a.d - b.d || a.i - b.i);
  // One of the three nearest, so a burst spreads instead of queueing on one cell.
  return options[Math.floor(random(state) * Math.min(3, options.length))].i;
}

function infect(state, virus, i) {
  state.lining[i].status = "infected";
  const x = (i % MAP_W) + 0.5;
  const y = Math.floor(i / MAP_W) + 0.5;
  addThreat(state, "infected", x, y, { tile: i, seenUntil: virus.seenUntil });
  virus.dead = true;
  state.stats.infections += 1;
  emit(state, "infect", { x, y });
}

function updateInfected(state, th) {
  const def = THREATS.infected;
  if (th.age < def.burstAfter) return;
  th.dead = true;
  const cell = state.lining[th.tile];
  if (cell) { cell.status = "dead"; cell.regrow = 0; }
  state.stats.bursts += 1;
  hurtHost(state, def.hostDamage, "burst");
  addThreat(state, "debris", th.x + randRange(state, -0.2, 0.2), th.y + randRange(state, -0.2, 0.2));
  for (let k = 0; k < def.burstCount; k++) {
    const a = (k / def.burstCount) * Math.PI * 2 + random(state);
    addThreat(state, "virus", th.x + Math.cos(a) * 0.3, th.y + Math.sin(a) * 0.3, { seenUntil: th.seenUntil });
  }
  emit(state, "burst", { x: th.x, y: th.y, damage: def.hostDamage });
}

function updateLining(state, dt) {
  const phase = currentPhase(state);
  if (!phase || !phase.regrow) return;
  for (const tile of state.map.lining) {
    const cell = state.lining[tile.i];
    if (cell.status !== "dead") continue;
    cell.regrow += dt / phase.regrow;
    if (cell.regrow >= 1) {
      cell.status = "healthy";
      cell.regrow = 0;
      emit(state, "regrow", { x: tile.x + 0.5, y: tile.y + 0.5 });
    }
  }
}

/* ------------------------------------------------------------------------ */
/* meters                                                                    */
/* ------------------------------------------------------------------------ */

function updateAlarm(state, dt) {
  if (!state.level.alarm) return;
  const S = ALARM.storm;

  let target = 0;
  for (const u of state.units) if (!u.dead && u.type === "siren") target += CELLS.siren.alarm;
  for (const th of state.threats) if (!th.dead) target += THREATS[th.type].alarm || 0;
  target = Math.min(S.at, target);
  state.alarmTarget = target;

  if (state.storm > 0) {
    state.storm = Math.max(0, state.storm - dt);
    hurtHost(state, S.hostPerSecond * dt, "storm");
    for (const u of state.units) {
      if (u.dead || u.kind === "neutral") continue;
      u.hp -= S.cellsPerSecond * dt;
      if (u.hp <= 0) killUnit(state, u, "storm");
    }
    if (state.storm === 0) {
      state.alarm = S.resetTo;
      emit(state, "stormEnd", {});
    }
    return;
  }

  if (state.alarm < target) state.alarm = Math.min(target, state.alarm + ALARM.riseRate * dt);
  else state.alarm = Math.max(target, state.alarm - ALARM.fallRate * dt);
  state.stats.peakAlarm = Math.max(state.stats.peakAlarm, state.alarm);

  if (state.alarm >= S.at) {
    state.alarm = S.at;
    state.storm = S.seconds;
    state.stats.stormCount += 1;
    emit(state, "storm", {});
    return;
  }
  if (state.alarm > ALARM.healHigh) {
    const over = state.alarm - ALARM.healHigh;
    hurtHost(state, (over / 10) * ALARM.damagePer10Over * dt, "alarm");
  }
}

function updateHealing(state, dt) {
  const H = state.level.healing;
  const phase = currentPhase(state);
  if (!H || !phase || !phase.healing) { state.healState = "idle"; state.healBlockers = 0; return; }

  let blockers = 0;
  for (const th of state.threats) {
    if (!th.dead && H.blockers.includes(th.type) && dist2(th, H) <= H.radius * H.radius) blockers++;
  }
  state.healBlockers = blockers;
  if (blockers) { state.healState = "blocked"; return; }

  let mult = 1;
  let label = "healing";
  if (H.alarmBands && state.level.alarm) {
    if (state.alarm > ALARM.healHigh) { mult = 0; label = "too-high"; }
    else if (state.alarm < ALARM.healLow) { mult = HEALING.lowBandFactor; label = "slow"; }
  }
  state.healState = label;
  state.healing = Math.min(100, state.healing + H.rate * mult * dt);
}

function updateBarracks(state) {
  for (const [id, fp] of Object.entries(state.fingerprints)) {
    if (fp.status === "training" && state.t >= fp.trainEnds - 1e-9) {
      fp.status = "ready";
      emit(state, "trained", { fingerprint: id });
    }
  }
}

function regenSignal(state, dt) {
  const boost = state.level.alarm ? 1 + state.alarm / 100 : 1;
  state.signal = Math.min(SIGNAL.max, state.signal + SIGNAL.perSecond * boost * dt);
}

function hurtHost(state, amount, source) {
  state.host = Math.max(0, state.host - amount);
  state.stats.hostLoss[source] = (state.stats.hostLoss[source] || 0) + amount;
}

/* ------------------------------------------------------------------------ */
/* entities                                                                  */
/* ------------------------------------------------------------------------ */

function addUnit(state, type, x, y, extra = {}) {
  const def = CELLS[type] || NEUTRALS[type];
  const kind = CELLS[type] ? def.kind : "neutral";
  const hp = def.hp ?? 1;
  const u = {
    id: state.nextId++, type, kind,
    x, y, px: x, py: y,
    hp, maxHp: hp,
    postX: x, postY: y,
    order: null, target: null,
    cd: 0, age: 0, kills: 0, squad: 0,
    task: "post", carrying: null, pingCd: 0,
    seed: random(state), dead: false,
    ...extra,
  };
  state.units.push(u);
  return u;
}

function addThreat(state, type, x, y, extra = {}) {
  const def = THREATS[type];
  const [cx, cy] = clampToMap(x, y);
  const th = {
    id: state.nextId++, type,
    x: cx, y: cy, px: cx, py: cy,
    hp: def.hp, maxHp: def.hp,
    age: 0, clock: 0, gen: 0,
    latched: null, seenUntil: -1,
    gx: cx, tile: -1,
    seed: random(state), dead: false,
    ...extra,
  };
  state.threats.push(th);
  return th;
}

function killThreat(state, th, by, cause) {
  if (th.dead) return;
  th.dead = true;
  state.stats.kills += 1;
  if (th.type === "infected") {
    // The infected cell dies with the virus inside it. The lining has a hole,
    // and the dead cell is debris — but no new viruses get out.
    const cell = state.lining[th.tile];
    if (cell) { cell.status = "dead"; cell.regrow = 0; }
    addThreat(state, "debris", th.x + randRange(state, -0.15, 0.15), th.y + randRange(state, -0.15, 0.15));
  }
  emit(state, "kill", { x: th.x, y: th.y, threat: th.type, id: th.id, by: by ? by.type : null, cause });
}

function killUnit(state, u, cause) {
  if (u.dead) return;
  u.dead = true;
  u.hp = 0;
  if (CELLS[u.type]?.leavesPus && cause !== "retire") addThreat(state, "pus", u.x, u.y);
  if (u.carrying) {
    const fp = state.fingerprints[u.carrying];
    if (fp && fp.status === "carrying") {
      fp.status = "unknown";
      fp.carrier = null;
      emit(state, "sampleLost", { fingerprint: u.carrying });
    }
  }
  emit(state, "death", { x: u.x, y: u.y, cell: u.type, id: u.id, cause });
}

function sweep(state) {
  if (state.units.some((u) => u.dead)) state.units = state.units.filter((u) => !u.dead);
  if (state.threats.some((th) => th.dead)) state.threats = state.threats.filter((th) => !th.dead);
}

function countDeploy(state, cellId) {
  state.stats.deployed[cellId] = (state.stats.deployed[cellId] || 0) + 1;
}

function emit(state, type, data) {
  state.events.push({ type, t: state.t, ...data });
}

/* ------------------------------------------------------------------------ */
/* geometry                                                                  */
/* ------------------------------------------------------------------------ */

function radiusOf(u) {
  return (CELLS[u.type] || NEUTRALS[u.type])?.radius ?? 0.3;
}

function dist2(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

/* Moves `e` toward (tx, ty), stopping `stopAt` short. Returns the distance
 * still to go afterwards. */
function moveToward(e, tx, ty, speed, dt, stopAt = 0) {
  const dx = tx - e.x;
  const dy = ty - e.y;
  const d = Math.hypot(dx, dy);
  if (d <= stopAt || d === 0) return d;
  const len = Math.min(speed * dt, d - stopAt);
  e.x += (dx / d) * len;
  e.y += (dy / d) * len;
  const [cx, cy] = clampToMap(e.x, e.y);
  e.x = cx;
  e.y = cy;
  return d - len;
}

function nearestOpening(state, x, y) {
  let best = null;
  let bestD = Infinity;
  for (const o of state.map.openings) {
    const d = dist2(o, { x, y });
    if (d < bestD) { best = o; bestD = d; }
  }
  return best || { x, y: 0.3 };
}

/* The nearest live threat within `r` of its edge that passes `filter`,
 * visible or not. */
function nearestThreat(state, x, y, r, filter) {
  let best = null;
  let bestD = Infinity;
  for (const th of state.threats) {
    if (th.dead || !filter(th)) continue;
    const d = Math.hypot(th.x - x, th.y - y) - THREATS[th.type].radius;
    if (d <= r && d < bestD) { best = th; bestD = d; }
  }
  return best;
}

function nearestUnitEdge(state, x, y, r, filter) {
  let best = null;
  let bestD = Infinity;
  for (const u of state.units) {
    if (u.dead || !filter(u)) continue;
    const d = Math.hypot(u.x - x, u.y - y) - radiusOf(u);
    if (d <= r && d < bestD) { best = u; bestD = d; }
  }
  return best;
}

/* Can this Responder go after this threat? It must be a kind it fights, and
 * either revealed by a Scout or close enough for the cell to sense itself. */
function canTarget(state, def, th, unit) {
  if (th.dead || !def.targets.includes(th.type)) return false;
  if (isVisible(state, th)) return true;
  return !!unit && Math.sqrt(dist2(unit, th)) <= (def.sense || 0);
}

/* Nearest threat this Responder may fight, within `r` of (cx, cy). */
function nearestTargetable(state, u, def, cx, cy, r) {
  let best = null;
  let bestD = Infinity;
  for (const th of state.threats) {
    if (!canTarget(state, def, th, u)) continue;
    if (Math.hypot(th.x - cx, th.y - cy) > r) continue;
    const d = dist2(th, u);
    if (d < bestD) { best = th; bestD = d; }
  }
  return best;
}

/* Keep moving cells from stacking into one blob: Responders push apart from
 * each other, bacteria from each other. Sentries never move for this. */
function separate(state) {
  const movers = state.units.filter((u) => !u.dead && u.kind === "responder");
  pushApart(movers, radiusOf);
  const bugs = state.threats.filter((th) => !th.dead && th.type === "bacterium" && th.latched == null);
  pushApart(bugs, () => THREATS.bacterium.radius);
}

function pushApart(list, radius) {
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    for (let j = i + 1; j < list.length; j++) {
      const b = list[j];
      const min = (radius(a) + radius(b)) * 0.9;
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      let d = Math.hypot(dx, dy);
      if (d >= min) continue;
      if (d < 1e-6) {
        // Exactly stacked: split along an angle derived from the ids, so the
        // result is deterministic without spending a random number.
        const ang = ((a.id * 7 + b.id * 13) % 360) * (Math.PI / 180);
        dx = Math.cos(ang); dy = Math.sin(ang); d = 1;
      }
      const push = (min - Math.min(d, min)) / 2;
      const nx = dx / d;
      const ny = dy / d;
      a.x -= nx * push; a.y -= ny * push;
      b.x += nx * push; b.y += ny * push;
      [a.x, a.y] = clampToMap(a.x, a.y);
      [b.x, b.y] = clampToMap(b.x, b.y);
    }
  }
}
