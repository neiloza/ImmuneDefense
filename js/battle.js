/* ============================================================================
 * battle.js — the battle screen: the loop, touch input, the HUD, the deploy
 * tray, coaching, and the cards between phases.
 *
 * It owns no rules. Every change to the world goes through a command from
 * js/sim/game.js (deploy, order, retire, skipCalm, continueInterlude), so
 * what a person can do here is exactly what the bots in test/bots.mjs can do
 * — which is what lets the bots' results mean something.
 *
 * ---- The loop -------------------------------------------------------------
 * requestAnimationFrame drives drawing; the sim advances in fixed 1/20 s
 * ticks from an accumulator (so a slow frame runs two ticks, a fast one
 * none), capped at 8 ticks per frame so a long stall — a backgrounded tab —
 * cannot become a burst of a hundred ticks the player never saw.
 *
 * ---- Touch -----------------------------------------------------------------
 * GameHub setup/LESSONS.md Part 4 is about exactly this, and three of its
 * rules are load-bearing here:
 *   - The canvas takes POINTER CAPTURE on pointerdown, so a drag that leaves
 *     it still tracks; the decision (tap vs drag) is taken at pointerup from
 *     distance travelled, never from a module-wide "busy" flag (4.1).
 *   - pointercancel is handled: the browser can steal a pointer mid-gesture,
 *     and a stolen gesture must not leave a ghost or a box behind (4.3).
 *   - The canvas is `touch-action: none` (game.css), so the browser never
 *     tries to scroll or zoom under a drag-select.
 * ========================================================================= */

import { CELLS, NEUTRALS } from "./data/cells.js";
import { THREATS } from "./data/threats.js";
import { personalise } from "./data/levels.js";
import { TERMS_BY_LEVEL } from "./data/guide.js";
import {
  createGame, step, deploy, order, retire, skipCalm, continueInterlude,
  drainEvents, currentPhase, fingerprintStatus, pickThreat, pickUnit,
  placementCheck, isVisible, TICK,
} from "./sim/game.js";
import { createRenderer } from "./render/renderer.js";
import { drawIcon } from "./render/sprites.js";
import { h, toast, openSheet, closeSheet, topSheet } from "./ui.js";
import { playEvents, alarmPulse, unlockAudio } from "./audio.js";
import { markSeen } from "./store.js";

const MAX_TICKS_PER_FRAME = 8;
const TAP_SLOP = 12;            // px a finger may wander and still be a tap

export function createBattle({ app, onExit, onOpenGuide }) {
  const $ = (id) => document.getElementById(id);
  const el = {
    root: $("battle"), stage: $("battle-stage"), canvas: $("battle-canvas"),
    name: $("hud-name"), mood: $("hud-mood"), host: $("hud-host"), hostFill: $("hud-host-fill"),
    speed: $("hud-speed"), pause: $("hud-pause"),
    track: $("phase-track"), phaseLabel: $("phase-label"),
    alarmBlock: $("alarm-block"), alarmMeter: $("alarm-meter"), alarmFill: $("alarm-fill"), alarmNum: $("alarm-num"),
    healBlock: $("heal-block"), healMeter: $("heal-meter"), healFill: $("heal-fill"), healNum: $("heal-num"), healName: $("heal-name"),
    calmBar: $("calm-bar"), calmText: $("calm-text"), calmStart: $("calm-start"),
    coach: $("coach"), coachText: $("coach-text"),
    banner: $("banner"), bannerKicker: $("banner-kicker"), bannerTitle: $("banner-title"),
    info: $("info-pop"), infoIcon: $("info-icon"), infoName: $("info-name"), infoReal: $("info-real"),
    infoLine: $("info-line"), infoRetire: $("info-retire"), infoClose: $("info-close"),
    signalBar: $("signal-bar"), signalFill: $("signal-fill"), signalNum: $("signal-num"),
    tray: $("tray"), cardWrap: $("card-wrap"), card: $("battle-card"),
    pauseSound: $("pause-sound"), pausePhase: $("pause-phase"),
  };
  const renderer = createRenderer(el.canvas);
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  let game = null;
  let level = null;
  let loadout = [];
  let seedOverride = null;
  let raf = 0;
  let lastNow = 0;
  let acc = 0;
  let paused = false;
  let cardKind = null;           // "intro" | "interlude" | "end" | null
  let infoFor = null;            // { kind: "unit"|"threat"|"selection", id }
  let bannerTimer = 0;
  let pingToasted = false;
  let seenDirty = false;
  const hud = {};                // last values written, to skip no-op DOM writes

  const ui = {
    selected: new Set(),
    placing: null,
    ghost: null,
    ghostOk: false,
    ghostFrom: null,
    coachAt: null,
    box: null,
    reducedMotion,
  };
  const coach = { index: 0, shownAt: 0, baseline: {}, events: new Set() };

  /* ---- lifecycle ---------------------------------------------------------- */

  function start(levelDef, chosen, { seed } = {}) {
    level = levelDef;
    loadout = [...chosen];
    const s = seed ?? seedOverride ?? Math.floor(Math.random() * 1e9);
    game = createGame(level, { seed: s, loadout });
    paused = false;
    acc = 0;
    pingToasted = false;
    ui.selected.clear();
    ui.placing = null;
    ui.ghost = null;
    ui.box = null;
    closeInfo();
    coach.index = 0;
    coach.shownAt = 0;
    coach.baseline = {};
    coach.events = new Set();
    for (const k of Object.keys(hud)) delete hud[k];

    // The Field Guide learns the words this level's HUD uses the moment it
    // starts, so "Signal" is never a word without an entry.
    if (markSeen(app.state, TERMS_BY_LEVEL[level.id] || [])) seenDirty = true;

    document.body.classList.add("in-battle");
    el.root.hidden = false;
    el.name.textContent = app.state.person.name || "Billy";
    el.speed.textContent = `${app.state.settings.speed || 1}×`;
    buildTrack();
    buildTray();
    el.alarmBlock.hidden = !level.alarm;
    el.healBlock.hidden = true;
    renderer.setLevel(level, game.map);
    fit();
    showIntroCard();
    cancelAnimationFrame(raf);
    lastNow = performance.now();
    raf = requestAnimationFrame(frame);
  }

  function exit(result) {
    cancelAnimationFrame(raf);
    raf = 0;
    for (const id of ["pause-sheet", "entry-sheet"]) closeSheet(id);
    el.root.hidden = true;
    el.cardWrap.hidden = true;
    document.body.classList.remove("in-battle");
    const finished = game;
    game = null;
    cardKind = null;
    if (seenDirty) { seenDirty = false; app.persist(); }
    onExit?.(result, finished, level);
  }

  function restart() {
    closeSheet("pause-sheet");
    start(level, loadout);
  }

  function fit() {
    const r = el.stage.getBoundingClientRect();
    renderer.resize(r.width, r.height, window.devicePixelRatio || 1);
  }
  new ResizeObserver(() => { if (game) fit(); }).observe(el.stage);
  const hudEl = el.root.querySelector(".battle-hud");
  new ResizeObserver(() => {
    document.documentElement.style.setProperty("--hud-h", `${Math.round(hudEl.getBoundingClientRect().bottom)}px`);
  }).observe(hudEl);

  /* ---- the frame ------------------------------------------------------------ */

  function running() {
    return game && !paused && !cardKind && (game.mode === "calm" || game.mode === "phase");
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.1, Math.max(0, (now - lastNow) / 1000));
    lastNow = now;
    if (!game) return;

    if (running()) {
      acc += dt * (app.state.settings.speed || 1);
      let n = 0;
      while (acc >= TICK && n < MAX_TICKS_PER_FRAME) { step(game, TICK); acc -= TICK; n++; }
      if (n === MAX_TICKS_PER_FRAME) acc = 0;
    }

    const events = drainEvents(game);
    if (events.length) handleEvents(events);

    const alpha = running() ? Math.min(1, acc / TICK) : 1;
    ui.coachAt = coachTarget();
    renderer.draw(game, alpha, ui, now / 1000, dt);
    updateHud(now);
    if (level.alarm && running()) alarmPulse(game.alarm);
  }

  /* ---- events from the sim ----------------------------------------------- */

  function handleEvents(events) {
    renderer.onEvents(events, game);
    playEvents(events);
    for (const e of events) {
      coach.events.add(e.type);
      switch (e.type) {
        case "deploy":
          // Counted from the sim's event, not from the tray handler, so a
          // deploy made any way at all moves the coaching on.
          coach.baseline[`deployed:${e.cell}`] = (coach.baseline[`deployed:${e.cell}`] || 0) + 1;
          if (markSeen(app.state, [`cell:${e.cell}`])) seenDirty = true;
          break;
        case "reveal":
          if (markSeen(app.state, [`threat:${e.threat}`])) seenDirty = true;
          break;
        case "ping":
          if (!pingToasted) { pingToasted = true; toast("A Scout spotted something. Revealed threats can be targeted."); }
          break;
        case "sample":
          toast("A Scout took the virus's Fingerprint. It's walking to the Barracks.");
          break;
        case "sampleLost":
          toast("The Scout carrying the Fingerprint was lost. Another Scout must take a new sample.");
          break;
        case "training":
          if (markSeen(app.state, ["term:fingerprint", "term:barracks"])) seenDirty = true;
          break;
        case "trained":
          showBanner("The Barracks", "Bounty Hunters ready");
          break;
        case "storm":
          showBanner("Alarm hit 100", "Cytokine storm!");
          break;
        case "builders":
          if (markSeen(app.state, ["cell:builder"])) seenDirty = true;
          break;
        case "phaseStart": {
          const p = level.phases[e.index];
          showBanner(p.bodyTime, p.name);
          break;
        }
        case "phaseEnd": {
          const p = level.phases[e.index];
          if (markSeen(app.state, [`fact:${level.id}:${p.id}`])) seenDirty = true;
          break;
        }
        default: break;
      }
    }
    // Cards come after the loop above so a phase that ends and a level that
    // ends in the same tick show the right one.
    if (game.mode === "interlude" && cardKind !== "interlude") showInterludeCard();
    if ((game.mode === "won" || game.mode === "lost") && cardKind !== "end") showEndCard();
    if (seenDirty && !running()) { seenDirty = false; app.persist(); }
  }

  /* ---- HUD ------------------------------------------------------------------ */

  function set(key, value, write) {
    if (hud[key] === value) return;
    hud[key] = value;
    write(value);
  }

  function mood(hp) {
    if (hp >= 90) return "feeling fine";
    if (hp >= 70) return "a little off";
    if (hp >= 50) return "feeling rough";
    if (hp >= 25) return "really unwell";
    return "very sick";
  }

  function updateHud(now) {
    const hp = Math.round(game.host);
    set("host", hp, (v) => {
      el.hostFill.style.transform = `scaleX(${Math.max(0, v) / 100})`;
      el.host.setAttribute("aria-valuenow", String(v));
      el.host.classList.toggle("is-low", v < 50 && v >= 25);
      el.host.classList.toggle("is-critical", v < 25);
      el.mood.textContent = mood(v);
    });

    const phase = currentPhase(game);
    set("phase", `${game.mode}:${game.phaseIndex}`, () => {
      [...el.track.children].forEach((pip, i) => {
        pip.classList.toggle("is-done", i < game.phaseIndex || game.mode === "won");
        pip.classList.toggle("is-now", i === game.phaseIndex && game.mode !== "won");
      });
      el.phaseLabel.textContent = game.mode === "calm"
        ? "Before it starts — place your Sentries"
        : phase ? `${phase.bodyTime} · ${phase.name}` : "";
    });

    if (level.alarm) {
      const a = Math.round(game.alarm);
      set("alarm", a, (v) => {
        el.alarmFill.style.transform = `scaleX(${v / 100})`;
        el.alarmNum.textContent = String(v);
        el.alarmMeter.setAttribute("aria-valuenow", String(v));
      });
    }

    const healing = level.healing && phase && phase.healing;
    set("healShown", !!healing, (v) => { el.healBlock.hidden = !v; });
    if (healing) {
      const p = Math.floor(game.healing);
      set("heal", `${p}:${game.healState}`, () => {
        el.healFill.style.transform = `scaleX(${game.healing / 100})`;
        el.healNum.textContent = `${p}%`;
        el.healName.textContent = level.healing.label || "Healing";
        el.healMeter.setAttribute("aria-valuenow", String(p));
        el.healMeter.classList.toggle("is-blocked", game.healState === "blocked" || game.healState === "too-high");
      });
    }

    const sig = Math.floor(game.signal);
    set("signalFill", Math.round(game.signal * 20), () => {
      el.signalFill.style.transform = `scaleX(${game.signal / 10})`;
    });
    set("signal", sig, (v) => {
      el.signalNum.textContent = String(v);
      el.signalBar.setAttribute("aria-valuenow", String(v));
    });

    const calm = game.mode === "calm" && !cardKind;
    set("calmShown", calm, (v) => { el.calmBar.hidden = !v; });
    if (calm) set("calmLeft", Math.ceil(game.calmLeft), (v) => { el.calmText.textContent = `Threat arrives in ${Math.max(0, v)}s`; });

    updateTray();
    updateCoach(now);
    if (infoFor?.kind === "selection") refreshSelectionInfo();
  }

  function buildTrack() {
    el.track.replaceChildren(...level.phases.map(() => h("li", { class: "phase-pip" })));
  }

  /* ---- the deploy tray ----------------------------------------------------- */

  function buildTray() {
    el.tray.replaceChildren();
    for (const id of loadout) {
      const def = CELLS[id];
      const icon = h("canvas", { class: "tray-icon", width: 34, height: 34, "aria-hidden": "true" });
      const btn = h("button", {
        class: "tray-cell",
        type: "button",
        dataset: { cell: id },
        "aria-label": `${def.name} (${def.realName}), costs ${def.cost} Signal`,
      },
      h("span", { class: "tray-kind", text: def.kind === "sentry" ? "Sentry" : "Aim" }),
      h("span", { class: "tray-cost", text: String(def.cost) }),
      icon,
      h("span", { class: "tray-name", text: def.name }),
      h("span", { class: "tray-real", text: def.realName }),
      h("span", { class: "tray-lock", hidden: true }));
      el.tray.append(btn);
      wireTrayButton(btn, id);
      requestAnimationFrame(() => drawIcon(icon, renderer.palette, id));
    }
  }

  function trayLock(id) {
    const def = CELLS[id];
    if (!def.needsFingerprint) return null;
    const fp = game.fingerprints[def.needsFingerprint];
    if (!fp) return "No Barracks here";
    if (fp.status === "ready") return null;
    if (fp.status === "training") return `Training ${Math.max(0, Math.ceil(fp.trainEnds - game.t))}s`;
    if (fp.status === "carrying") return "Sample on its way";
    return "Needs training";
  }

  function updateTray() {
    for (const btn of el.tray.children) {
      const id = btn.dataset.cell;
      const def = CELLS[id];
      const lock = trayLock(id);
      const poor = game.signal + 1e-9 < def.cost;
      const key = `${id}:${lock}:${poor}:${ui.placing === id}`;
      if (btn.dataset.key === key) continue;
      btn.dataset.key = key;
      btn.classList.toggle("is-locked", !!lock);
      btn.classList.toggle("is-poor", poor && !lock);
      btn.classList.toggle("is-selected", ui.placing === id);
      const tag = btn.querySelector(".tray-lock");
      tag.hidden = !lock;
      tag.textContent = lock || "";
      btn.setAttribute("aria-pressed", ui.placing === id ? "true" : "false");
    }
  }

  function selectTrayCell(id) {
    const lock = trayLock(id);
    if (lock) {
      toast(lockExplanation(id, lock));
      return;
    }
    ui.placing = ui.placing === id ? null : id;
    ui.selected.clear();
    if (infoFor?.kind === "selection") closeInfo();
    ui.ghost = null;
    hud.tray = null;
  }

  function lockExplanation(id, lock) {
    if (lock === "No Barracks here") return `${CELLS[id].name}s need a Barracks to train them, and there is none in this level.`;
    if (lock.startsWith("Training")) return `The Barracks is training ${CELLS[id].name}s. ${lock.replace("Training ", "")} to go.`;
    if (lock === "Sample on its way") return "A Scout is carrying the Fingerprint to the Barracks.";
    return `${CELLS[id].name}s must be trained first: a Scout has to carry the virus's Fingerprint to the Barracks.`;
  }

  /* Tray buttons: tap to select, then tap the map — OR drag straight from the
   * tray onto the map and let go, Clash Royale style. With touch the browser
   * captures the pointer to the button on pointerdown, so both moves and the
   * release arrive here even over the canvas; with a mouse we capture
   * explicitly. Where the release lands decides what it was. */
  function wireTrayButton(btn, id) {
    let drag = null;
    btn.addEventListener("pointerdown", (e) => {
      unlockAudio();
      if (!game || cardKind) return;
      try { btn.setPointerCapture(e.pointerId); } catch { /* fine */ }
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, wasPlacing: ui.placing === id, moved: false };
      if (!trayLock(id) && ui.placing !== id) selectTrayCell(id);
    });
    btn.addEventListener("pointermove", (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > TAP_SLOP) drag.moved = true;
      if (drag.moved && ui.placing === id) updateGhostFromClient(e.clientX, e.clientY);
    });
    const finish = (e, cancelled) => {
      if (!drag || e.pointerId !== drag.id) return;
      const d = drag;
      drag = null;
      if (cancelled) { ui.ghost = null; return; }
      if (d.moved) {
        const p = clientToMap(e.clientX, e.clientY);
        if (p && ui.placing === id) tryDeploy(id, p.x, p.y);
        ui.ghost = null;
        return;
      }
      // A plain tap: toggle. (pointerdown already selected an unselected cell.)
      if (trayLock(id)) { selectTrayCell(id); return; }
      if (d.wasPlacing) { ui.placing = null; ui.ghost = null; }
    };
    btn.addEventListener("pointerup", (e) => finish(e, false));
    btn.addEventListener("pointercancel", (e) => finish(e, true));
    // Keyboard: Enter/Space on the focused button selects it.
    btn.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); selectTrayCell(id); }
    });
  }

  function clientToMap(cx, cy) {
    const r = el.canvas.getBoundingClientRect();
    if (cx < r.left || cx > r.right || cy < r.top || cy > r.bottom) return null;
    const m = renderer.toMap(cx - r.left, cy - r.top);
    if (m.x < 0 || m.y < 0 || m.x > 9 || m.y > 16) return null;
    return m;
  }

  function updateGhostFromClient(cx, cy) {
    const p = clientToMap(cx, cy);
    if (!p) { ui.ghost = null; return; }
    ui.ghost = p;
    const def = CELLS[ui.placing];
    if (!def) return;
    if (def.kind === "sentry") {
      ui.ghostOk = placementCheck(game, ui.placing, p.x, p.y).ok;
      ui.ghostFrom = null;
    } else {
      ui.ghostOk = true;
      let best = null;
      let bestD = Infinity;
      for (const o of game.map.openings) {
        const d = Math.hypot(o.x - p.x, o.y - p.y);
        if (d < bestD) { best = o; bestD = d; }
      }
      ui.ghostFrom = best;
    }
  }

  function tryDeploy(id, x, y) {
    const def = CELLS[id];
    const target = def.kind === "responder"
      ? pickThreat(game, x, y, 0.5, (th) => def.targets.includes(th.type))
      : null;
    const res = deploy(game, id, x, y, target ? target.id : null);
    if (res.ok) {
      ui.placing = null;
      ui.ghost = null;
      return true;
    }
    const why = {
      "no-signal": `Not enough Signal — ${def.name} costs ${def.cost}.`,
      "terrain": "Sentries go on open tissue — not on skin, vessels, bone or the lining.",
      "occupied": "There is already a Sentry there.",
      "needs-training": lockExplanation(id, trayLock(id) || "Needs training"),
    }[res.reason];
    if (why) toast(why);
    return false;
  }

  /* ---- the canvas ----------------------------------------------------------- */

  let press = null;

  el.canvas.addEventListener("pointerdown", (e) => {
    unlockAudio();
    if (!game || cardKind) return;
    try { el.canvas.setPointerCapture(e.pointerId); } catch { /* fine */ }
    const p = localPoint(e);
    press = { id: e.pointerId, sx: e.clientX, sy: e.clientY, start: p, moved: false };
    if (ui.placing) updateGhostFromClient(e.clientX, e.clientY);
  });

  el.canvas.addEventListener("pointermove", (e) => {
    if (!press || e.pointerId !== press.id) {
      // Mouse hover while placing: show where it would go.
      if (ui.placing && e.pointerType === "mouse") updateGhostFromClient(e.clientX, e.clientY);
      return;
    }
    if (Math.hypot(e.clientX - press.sx, e.clientY - press.sy) > TAP_SLOP) press.moved = true;
    if (ui.placing) { updateGhostFromClient(e.clientX, e.clientY); return; }
    if (press.moved) {
      const p = localPoint(e);
      ui.box = { x0: press.start.x, y0: press.start.y, x1: p.x, y1: p.y };
    }
  });

  el.canvas.addEventListener("pointerup", (e) => {
    if (!press || e.pointerId !== press.id) return;
    const p = localPoint(e);
    const moved = press.moved;
    press = null;
    if (ui.placing) {
      if (clientToMap(e.clientX, e.clientY)) tryDeploy(ui.placing, p.x, p.y);
      if (e.pointerType !== "mouse") ui.ghost = null;
      return;
    }
    if (moved && ui.box) {
      boxSelect(ui.box);
      ui.box = null;
      return;
    }
    tap(p.x, p.y);
  });

  el.canvas.addEventListener("pointercancel", () => {
    press = null;
    ui.box = null;
    if (ui.placing) ui.ghost = null;
  });

  el.canvas.addEventListener("pointerleave", (e) => {
    if (e.pointerType === "mouse" && !press) ui.ghost = null;
  });

  function localPoint(e) {
    const r = el.canvas.getBoundingClientRect();
    return renderer.toMap(e.clientX - r.left, e.clientY - r.top);
  }

  function boxSelect(box) {
    const x0 = Math.min(box.x0, box.x1);
    const x1 = Math.max(box.x0, box.x1);
    const y0 = Math.min(box.y0, box.y1);
    const y1 = Math.max(box.y0, box.y1);
    ui.selected.clear();
    for (const u of game.units) {
      if (u.kind === "responder" && u.x >= x0 && u.x <= x1 && u.y >= y0 && u.y <= y1) ui.selected.add(u.id);
    }
    if (ui.selected.size) showSelectionInfo();
    else closeInfo();
  }

  function tap(x, y) {
    if (x < 0 || y < 0 || x > 9 || y > 16) return;
    const TOUCH = 0.45;   // tiles of forgiveness around a thing, for thumbs

    // With Responders selected, a tap is an order — unless it lands on one
    // of your own Responders, which changes the selection instead.
    const mineHit = pickUnit(game, x, y, TOUCH, (u) => u.kind === "responder");
    if (ui.selected.size) {
      if (mineHit) { toggleSquad(mineHit); return; }
      const ids = [...ui.selected].filter((id) => game.units.some((u) => u.id === id));
      if (!ids.length) { ui.selected.clear(); closeInfo(); return; }
      const target = pickThreat(game, x, y, TOUCH);
      order(game, ids, x, y, target ? target.id : null);
      return;
    }

    if (mineHit) { toggleSquad(mineHit); return; }
    const sentry = pickUnit(game, x, y, TOUCH, (u) => u.kind === "sentry");
    if (sentry) { showUnitInfo(sentry); return; }
    const th = pickThreat(game, x, y, TOUCH);
    if (th) { showThreatInfo(th); return; }
    closeInfo();
  }

  function toggleSquad(u) {
    const squad = game.units.filter((v) => v.kind === "responder" && v.squad === u.squad).map((v) => v.id);
    const allIn = squad.every((id) => ui.selected.has(id));
    if (allIn) squad.forEach((id) => ui.selected.delete(id));
    else squad.forEach((id) => ui.selected.add(id));
    ui.placing = null;
    if (ui.selected.size) showSelectionInfo(); else closeInfo();
  }

  /* ---- the info pop-up ------------------------------------------------------ */

  function showInfo(kind, id, iconType, name, real, line, retireable) {
    infoFor = { kind, id };
    el.info.hidden = false;
    el.infoName.textContent = name;
    el.infoReal.textContent = real;
    el.infoLine.textContent = line;
    el.infoRetire.hidden = !retireable;
    drawIcon(el.infoIcon, renderer.palette, iconType);
  }

  function showUnitInfo(u) {
    const def = CELLS[u.type] || NEUTRALS[u.type];
    const extra = u.type === "siren" && level.alarm
      ? ` Adds ${CELLS.siren.alarm} to the Alarm while it lives — retire it to let the Alarm fall.`
      : "";
    showInfo("unit", u.id, u.type, def.name, def.realName, (def.line || def.job || "") + extra, u.kind === "sentry");
  }

  function showThreatInfo(th) {
    const def = THREATS[th.type];
    showInfo("threat", th.id, th.type, def.name, "Threat", def.line, false);
  }

  function showSelectionInfo() {
    infoFor = { kind: "selection" };
    el.info.hidden = false;
    el.infoRetire.hidden = true;
    refreshSelectionInfo(true);
  }

  function refreshSelectionInfo(force) {
    const live = [...ui.selected].filter((id) => game.units.some((u) => u.id === id));
    if (live.length !== ui.selected.size) {
      ui.selected = new Set(live);
      if (!live.length) { closeInfo(); return; }
    }
    const types = new Set(live.map((id) => game.units.find((u) => u.id === id).type));
    const key = `${live.length}:${[...types].join()}`;
    if (!force && hud.selKey === key) return;
    hud.selKey = key;
    const one = types.size === 1 ? CELLS[[...types][0]] : null;
    el.infoName.textContent = `${live.length} ${one ? one.name + (live.length > 1 ? "s" : "") : "cells"} selected`;
    el.infoReal.textContent = "Tap a threat or a spot to send them";
    el.infoLine.textContent = "";
    drawIcon(el.infoIcon, renderer.palette, one ? one.id : "rusher");
  }

  function closeInfo() {
    infoFor = null;
    el.info.hidden = true;
    hud.selKey = null;
  }

  el.infoClose.addEventListener("click", () => {
    if (infoFor?.kind === "selection") ui.selected.clear();
    closeInfo();
  });
  el.infoRetire.addEventListener("click", () => {
    if (infoFor?.kind === "unit" && game) retire(game, infoFor.id);
    closeInfo();
  });

  /* ---- coaching ------------------------------------------------------------ */

  function coachSteps() {
    if (!app.state.settings.hints) return [];
    return level.coach || [];
  }

  function stepActive(s) {
    if (s.when === "calm") return game.mode === "calm";
    if (s.when.startsWith("phase:")) return currentPhase(game)?.id === s.when.slice(6) && game.mode === "phase";
    if (s.when.startsWith("event:")) return coach.events.has(s.when.slice(6)) && game.mode === "phase";
    return false;
  }

  function stepExpired(s) {
    if (s.when === "calm") return game.mode !== "calm";
    if (s.when.startsWith("phase:")) {
      const idx = level.phases.findIndex((p) => p.id === s.when.slice(6));
      return game.phaseIndex > idx;
    }
    return false;
  }

  function stepDone(s, now) {
    const d = s.done || {};
    if (d.placed) return game.units.some((u) => u.type === d.placed);
    if (d.deployed) return (coach.baseline[`deployed:${d.deployed}`] || 0) >= (d.count || 1);
    if (d.phase) return currentPhase(game)?.id === d.phase && game.mode === "phase";
    if (d.seconds) return coach.shownAt && now - coach.shownAt > d.seconds * 1000;
    if (d.trainingStarted) {
      const st = fingerprintStatus(game, level.barracks?.fingerprint);
      return st === "training" || st === "ready";
    }
    if (d.trained) return fingerprintStatus(game, level.barracks?.fingerprint) === "ready";
    return false;
  }

  function currentCoach(now) {
    const steps = coachSteps();
    while (coach.index < steps.length) {
      const s = steps[coach.index];
      if (stepExpired(s)) { coach.index++; coach.shownAt = 0; continue; }
      if (!stepActive(s)) return null;
      if (!coach.shownAt) coach.shownAt = now;
      if (stepDone(s, now)) { coach.index++; coach.shownAt = 0; continue; }
      return s;
    }
    return null;
  }

  function updateCoach(now) {
    const s = cardKind || paused ? null : currentCoach(now);
    set("coach", s ? s.id : null, () => {
      el.coach.hidden = !s;
      if (s) el.coachText.textContent = personalise(s.text, app.state.person.name);
    });
  }

  function coachTarget() {
    const s = cardKind || paused || !game ? null : currentCoach(performance.now());
    if (!s || !s.at) return null;
    return s.at;
  }

  /* ---- banners and cards ----------------------------------------------------- */

  function showBanner(kicker, title) {
    el.bannerKicker.textContent = kicker;
    el.bannerTitle.textContent = title;
    el.banner.hidden = false;
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => { el.banner.hidden = true; }, reducedMotion ? 1800 : 2300);
  }

  function showCard(kind, nodes, focusId) {
    cardKind = kind;
    clearTimeout(bannerTimer);
    el.banner.hidden = true;
    el.card.replaceChildren(...nodes);
    el.cardWrap.hidden = false;
    closeInfo();
    ui.placing = null;
    ui.ghost = null;
    const f = focusId ? el.card.querySelector(`#${focusId}`) : el.card.querySelector("button");
    f?.focus({ preventScroll: true });
  }

  function hideCard() {
    cardKind = null;
    el.cardWrap.hidden = true;
    lastNow = performance.now();
  }

  function who() { return app.state.person.name || "Billy"; }

  function showIntroCard() {
    showCard("intro", [
      h("p", { class: "card-kicker", text: `${level.threatKind} · Age ${level.age}` }),
      h("h2", { class: "card-title", id: "card-title", text: level.title }),
      h("p", { class: "card-copy", text: personalise(level.intro, who()) }),
      h("p", { class: "card-fact", text: level.teaches }),
      h("p", { class: "card-next", text: `First, place your Sentries. The threat arrives in ${level.calm} seconds — or tap Start when ready.` }),
      h("div", { class: "card-actions" },
        h("button", { class: "btn btn-primary btn-block", id: "card-go", onclick: () => { unlockAudio(); hideCard(); } }, "Begin")),
    ], "card-go");
  }

  function showInterludeCard() {
    const done = level.phases[game.phaseIndex];
    const next = level.phases[game.phaseIndex + 1];
    showCard("interlude", [
      h("p", { class: "card-kicker", text: `Phase ${game.phaseIndex + 1} of ${level.phases.length} complete · ${done.bodyTime}` }),
      h("h2", { class: "card-title", id: "card-title", text: done.name }),
      h("p", { class: "card-fact", text: done.fact }),
      h("p", { class: "card-next" },
        h("strong", { text: `Next: ${next.name} (${next.bodyTime}). ` }),
        personalise(next.hint, who())),
      h("div", { class: "card-actions" },
        h("button", {
          class: "btn btn-primary btn-block", id: "card-go",
          onclick: () => { continueInterlude(game); hideCard(); },
        }, "Continue")),
    ], "card-go");
  }

  function showEndCard() {
    const o = game.outcome;
    const name = who();
    const stars = h("p", { class: "card-stars", "aria-label": `${o.stars} of 3 stars` },
      ...[1, 2, 3].map((k) => h("span", { class: k <= o.stars ? "on" : "", text: "★" })));
    const reached = o.won ? level.phases : level.phases.slice(0, Math.max(0, game.phaseIndex));
    const recap = reached.length
      ? [h("p", { class: "card-copy", text: `What happened in ${name}'s body:` }),
        h("ol", { class: "card-recap" }, ...reached.map((p) => h("li", { text: p.recap })))]
      : [];
    const nodes = [];
    if (o.won) {
      nodes.push(
        h("p", { class: "card-kicker", text: `${level.title} · won` }),
        h("h2", { class: "card-title", id: "card-title", text: `${name} is better!` }),
        stars,
        h("p", { class: "card-copy", text: `Health left: ${o.host}. ${o.stars === 3 ? "Barely a scratch." : o.stars === 2 ? "A rough few days, but through it." : "A close one."}` }),
        ...recap,
      );
      if (o.rewards?.veteran) {
        nodes.push(h("p", { class: "card-reward", text: `${name} now carries a Veteran for this flu. Next time it shows up, Bounty Hunters will be ready from the start — that is how vaccines work.` }));
      }
      const nextLevel = app.nextLevelAfter(level.id);
      nodes.push(h("div", { class: "card-actions" },
        nextLevel ? h("button", { class: "btn btn-primary btn-block", id: "card-go", onclick: () => exit({ next: nextLevel.id }) }, `Next: ${nextLevel.title}`) : null,
        !nextLevel ? h("p", { class: "card-copy", text: `That's the end of ${name}'s childhood so far. More of their life is coming.` }) : null,
        h("button", { class: "btn btn-block", onclick: () => restart() }, "Play again"),
        h("button", { class: `btn btn-block ${nextLevel ? "" : "btn-primary"}`, id: nextLevel ? null : "card-go", onclick: () => exit({}) }, `${name}'s life`)));
    } else {
      const tip = (level.loseTips || {})[o.cause] || Object.values(level.loseTips || {})[0] || "";
      nodes.push(
        h("p", { class: "card-kicker", text: `${level.title} · lost` }),
        h("h2", { class: "card-title", id: "card-title", text: `${name} got much sicker.` }),
        h("p", { class: "card-copy", text: "The body lost this round. Try again — here's what went wrong:" }),
        h("p", { class: "card-fact", text: tip }),
        ...recap,
        h("div", { class: "card-actions" },
          h("button", { class: "btn btn-primary btn-block", id: "card-go", onclick: () => restart() }, "Try again"),
          h("button", { class: "btn btn-block", onclick: () => exit({}) }, `${name}'s life`)),
      );
    }
    showCard("end", nodes, "card-go");
    app.recordResult(level.id, o);
  }

  /* ---- pause, speed, visibility ------------------------------------------- */

  function pause() {
    if (!game || cardKind || paused) return;
    paused = true;
    const p = currentPhase(game);
    el.pausePhase.textContent = game.mode === "calm"
      ? `${level.title}: placing Sentries.`
      : `${level.title}: ${p ? `${p.name} (${p.bodyTime})` : ""}.`;
    el.pauseSound.textContent = `Sound: ${app.state.settings.sound ? "on" : "off"}`;
    openSheet("pause-sheet", { onClosed: () => { paused = false; lastNow = performance.now(); } });
  }

  el.pause.addEventListener("click", pause);
  el.speed.addEventListener("click", () => {
    const next = (app.state.settings.speed || 1) === 1 ? 2 : 1;
    app.state.settings.speed = next;
    app.persist();
    el.speed.textContent = `${next}×`;
    el.speed.setAttribute("aria-label", `Game speed, currently ${next === 1 ? "normal" : "double"}`);
  });
  el.calmStart.addEventListener("click", () => { if (game) skipCalm(game); });

  $("pause-restart").addEventListener("click", restart);
  $("pause-quit").addEventListener("click", () => { closeSheet("pause-sheet"); exit({ abandoned: true }); });
  $("pause-guide").addEventListener("click", () => onOpenGuide?.(level.id));
  el.pauseSound.addEventListener("click", () => {
    app.setSound(!app.state.settings.sound);
    el.pauseSound.textContent = `Sound: ${app.state.settings.sound ? "on" : "off"}`;
  });

  // Leaving the app mid-battle pauses it. A phone call must not cost a level.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && game && running()) pause();
  });

  // Keyboard: Escape pauses when nothing else is open (ui.js closes the
  // topmost sheet first and stops the event, so this only sees a bare press).
  document.addEventListener("keydown", (e) => {
    if (!game || e.key !== "Escape" || topSheet()) return;
    if (ui.placing || ui.selected.size) { ui.placing = null; ui.selected.clear(); closeInfo(); return; }
    if (!cardKind) pause();
  });

  /* ---- test hook -------------------------------------------------------------
   * Only with ?debug in the URL (the smoke test uses it). Read-only views of
   * the running game plus a seed override, so a test can place a cell and
   * then check the world changed, without screen-scraping a canvas. */
  const params = new URLSearchParams(location.search);
  if (params.has("debug")) {
    if (params.get("seed")) seedOverride = Number(params.get("seed"));
    window.__immune = {
      get game() { return game; },
      get ui() { return ui; },
      get card() { return cardKind; },
      get paused() { return paused; },
      mapToClient(x, y) {
        const r = el.canvas.getBoundingClientRect();
        const [px, py] = renderer.toScreen(x, y);
        return { x: r.left + px, y: r.top + py };
      },
      isVisible: (th) => isVisible(game, th),
    };
  }

  return {
    start,
    pause,
    get active() { return !!game; },
  };
}
