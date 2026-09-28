/* ============================================================================
 * renderer.js — draws a game state onto the battle canvas.
 *
 * READ-ONLY with respect to the game: it looks at `state` and never writes to
 * it (js/sim/game.js owns every change). Its own bookkeeping — particles,
 * facing directions, birth times, the pre-rendered background — lives in
 * this closure.
 *
 * Layout: the 9 × 16 tile map is fitted inside the canvas at the largest
 * whole size that fits, centred, with a darker tissue frame around it. All
 * drawing is in CSS pixels; the context is scaled by devicePixelRatio (capped
 * at 2 — beyond that a phone spends battery on pixels nobody can see).
 *
 * The sim ticks at 20 Hz; `draw(state, alpha)` interpolates every position
 * between the previous tick (px, py) and the current one (x, y) by `alpha`,
 * so motion is smooth at the display's frame rate.
 *
 * ---- Motion that is not in the sim ----------------------------------------
 * The sim knows positions and hit points. Everything that makes those feel
 * physical is added here from what the renderer can see or is told:
 *   - a thing it has never drawn before POPS in (scale 0 → 1 with overshoot);
 *   - a unit whose hp dropped since last frame JITTERS for a moment;
 *   - a Devourer near an "eat" event GULPS (sprites.js draws the squash);
 *   - a thing that died leaves a GHOST that shrinks and fades where it was
 *     (the sim removes it the same tick, so the ghost is the renderer's);
 *   - leaks, bursts and the storm SHAKE the map a little.
 * All of it is off under prefers-reduced-motion, except the ghosts, which are
 * the only way to see where something died.
 * ========================================================================= */

import { CELLS, NEUTRALS } from "../data/cells.js";
import { THREATS, ALARM } from "../data/threats.js";
import { MAP_W, MAP_H, isPlaceableTile } from "../sim/map.js";
import { isVisible, currentPhase } from "../sim/game.js";
import { readPalette, mix, withAlpha } from "./palette.js";
import {
  drawThing, drawInfected, drawFingerprint, roundRect,
} from "./sprites.js";
import {
  paintScene, frameColor, drawFlow,
  drawWound as sceneWound, drawLining as sceneLining, drawFracture as sceneFracture,
} from "./scenes.js";

const TAU = Math.PI * 2;
const POP_SECONDS = 0.32;
const HURT_SECONDS = 0.22;
const GULP_SECONDS = 0.35;

/* Ease-out with a little overshoot: things arrive with a bounce. */
function popEase(k) {
  const c = 1.7;
  const x = k - 1;
  return 1 + (c + 1) * x * x * x + c * x * x;
}

export function createRenderer(canvas) {
  const ctx = canvas.getContext("2d");
  let pal = readPalette();
  let level = null;
  let map = null;
  let cssW = 0;
  let cssH = 0;
  let dpr = 1;
  let tile = 32;
  let ox = 0;
  let oy = 0;
  let bg = null;
  let glow = null;
  const fx = [];
  const headings = new Map();
  const born = new Map();      // id → wall-clock second first drawn
  const lastHp = new Map();    // id → hp last frame
  const hurt = new Map();      // id → second the last hit landed
  const gulp = new Map();      // devourer id → second of its last meal
  let flash = 0;
  let flashColor = "#d6453d";
  let shake = 0;
  let frameNow = 0;

  /* ---- layout ------------------------------------------------------------ */

  function resize(w, h, ratio) {
    cssW = Math.max(1, Math.floor(w));
    cssH = Math.max(1, Math.floor(h));
    dpr = Math.min(2, ratio || 1);
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    tile = Math.max(8, Math.floor(Math.min(cssW / MAP_W, cssH / MAP_H)));
    ox = Math.floor((cssW - tile * MAP_W) / 2);
    oy = Math.floor((cssH - tile * MAP_H) / 2);
    rebuild();
  }

  function setLevel(lv, m) {
    level = lv;
    map = m;
    pal = readPalette();
    headings.clear();
    born.clear();
    lastHp.clear();
    hurt.clear();
    gulp.clear();
    fx.length = 0;
    flash = 0;
    shake = 0;
    rebuild();
  }

  function toMap(px, py) { return { x: (px - ox) / tile, y: (py - oy) / tile }; }
  function toScreen(x, y) { return [ox + x * tile, oy + y * tile]; }

  /* ---- the static background ---------------------------------------------
   * Everything that never changes during a level is drawn once per resize
   * into an offscreen canvas: tissue texture, skin, vessel walls, bone, the
   * airway, labels, the vignette. The per-frame work is then one drawImage
   * plus the things that move. */

  function rebuild() {
    if (!map || !tile) return;
    const w = tile * MAP_W;
    const h = tile * MAP_H;
    bg = document.createElement("canvas");
    bg.width = Math.round(w * dpr);
    bg.height = Math.round(h * dpr);
    const g = bg.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    paintBackground(g);

    // The hidden-threat glow, pre-rendered once: a soft red smudge.
    const R = Math.max(6, Math.round(tile * 0.6));
    glow = document.createElement("canvas");
    glow.width = glow.height = Math.round(R * 2 * dpr);
    const gg = glow.getContext("2d");
    gg.setTransform(dpr, 0, 0, dpr, 0, 0);
    const grad = gg.createRadialGradient(R, R, 0, R, R, R);
    grad.addColorStop(0, withAlpha(pal.alarm, 0.38));
    grad.addColorStop(0.5, withAlpha(pal.alarm, 0.14));
    grad.addColorStop(1, withAlpha(pal.alarm, 0));
    gg.fillStyle = grad;
    gg.fillRect(0, 0, R * 2, R * 2);
  }

  function env() {
    return { pal, map, level, T: tile, w: tile * MAP_W, h: tile * MAP_H };
  }

  function paintBackground(g) {
    paintScene(g, env());
  }

  function label(g, text, x, y, T, color) {
    g.font = `700 ${Math.max(9, Math.round(T * 0.28))}px ${cssFont()}`;
    g.fillStyle = color || withAlpha(pal.ink, 0.5);
    g.textBaseline = "middle";
    g.fillText(text, x, y);
  }

  function cssFont() {
    return "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
  }

  /* ---- events → effects -------------------------------------------------- */

  function onEvents(events, state) {
    for (const e of events) {
      switch (e.type) {
        case "ping": ring(e.x, e.y, 0.3, 1.6, 0.8, pal.accent); break;
        case "reveal": break;
        case "eat": {
          burst(e.x, e.y, 5, colorOf(e.threat), 0.9);
          // The Devourer nearest the meal is the one that ate it.
          let best = null;
          let bestD = 4;
          for (const u of state.units) {
            if (u.type !== "devourer") continue;
            const d = Math.hypot(u.x - e.x, u.y - e.y);
            if (d < bestD) { best = u; bestD = d; }
          }
          if (best) gulp.set(best.id, frameNow);
          ghost(e.threat, e.id, e.x, e.y, 0.5);
          break;
        }
        case "kill":
          burst(e.x, e.y, 9, colorOf(e.threat), 1.5);
          ring(e.x, e.y, 0.1, 0.55, 0.3, "#ffffff");
          ghost(e.threat, e.id, e.x, e.y, 1);
          break;
        case "death":
          if (e.cause !== "retire") { burst(e.x, e.y, 6, pal.allyOutline, 1); ghost(e.cell, e.id, e.x, e.y, 1); }
          else ring(e.x, e.y, 0.2, 0.9, 0.5, pal.ink);
          break;
        case "leak":
          floater(e.x, e.y - 0.3, `−${e.damage}`, pal.alarm);
          flash = Math.max(flash, 0.35); flashColor = pal.alarm;
          shake = Math.max(shake, 0.5);
          break;
        case "burst":
          burst(e.x, e.y, 14, pal.enemyAlt, 2.2);
          ring(e.x, e.y, 0.2, 1.1, 0.5, pal.enemyAlt);
          floater(e.x, e.y - 0.4, `−${e.damage}`, pal.alarm);
          shake = Math.max(shake, 0.7);
          break;
        case "infect": ring(e.x, e.y, 0.1, 0.6, 0.5, pal.enemyAlt); break;
        case "split": ring(e.x, e.y, 0.1, 0.5, 0.4, pal.enemy); burst(e.x, e.y, 4, pal.enemy, 0.7); break;
        case "copy": ring(e.x, e.y, 0.1, 1.0, 0.6, pal.accent); burst(e.x, e.y, 6, pal.allyBody, 1); floater(e.x, e.y - 0.4, "+1", pal.accent); break;
        case "deploy": {
          const at = e.from || { x: e.x, y: e.y };
          ring(at.x, at.y, 0.2, 1.1, 0.5, pal.accent);
          break;
        }
        case "sample": ring(e.x, e.y, 0.2, 1.4, 0.8, pal.accent); floater(e.x, e.y - 0.5, "Fingerprint!", pal.accent); break;
        case "training":
        case "trained":
          if (state.level.barracks) ring(state.level.barracks.x, state.level.barracks.y, 0.4, 2.4, 1.2, pal.accent);
          break;
        case "storm": flash = 0.9; flashColor = pal.alarm; shake = 1.2; break;
        case "regrow": ring(e.x, e.y, 0.1, 0.5, 0.5, pal.lining); break;
        default: break;
      }
    }
    if (fx.length > 400) fx.splice(0, fx.length - 400);
  }

  function colorOf(type) {
    return { bacterium: pal.enemy, virus: pal.enemyAlt, infected: pal.enemy, debris: pal.debris, pus: pal.pus }[type] || pal.ink;
  }

  function ring(x, y, r0, r1, life, color) { fx.push({ k: "ring", x, y, r0, r1, life, age: 0, color }); }
  function floater(x, y, text, color) { fx.push({ k: "text", x, y, text, life: 1.2, age: 0, color }); }
  function ghost(type, id, x, y, scale) {
    if (!type || type === "infected") return;
    fx.push({ k: "ghost", type, x, y, scale, life: 0.3, age: 0, seed: (x * 7 + y * 13) % 1, heading: headings.get(id) ?? Math.PI / 2 });
    headings.delete(id);
  }
  function burst(x, y, n, color, speed) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + Math.sin(i * 12.9898 + x * 78.233) * 0.8;
      const v = speed * (0.5 + ((i * 7919) % 10) / 20);
      fx.push({ k: "dot", x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.5, age: 0, color, size: 0.05 + ((i * 31) % 4) * 0.015 });
    }
  }

  /* ---- the frame --------------------------------------------------------- */

  function draw(state, alpha, ui, now, dtReal) {
    if (!map || !bg) return;
    const T = tile;
    const t = now;
    frameNow = now;
    const dt = dtReal || 0;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Frame around the map.
    ctx.fillStyle = frameColor(env());
    ctx.fillRect(0, 0, cssW, cssH);

    ctx.save();
    if (shake > 0 && !ui.reducedMotion) {
      const s = shake * shake * T * 0.14;
      ctx.translate(Math.sin(t * 73) * s, Math.cos(t * 91) * s);
      shake = Math.max(0, shake - dt * 3);
    } else {
      shake = 0;
    }
    ctx.drawImage(bg, ox, oy, T * MAP_W, T * MAP_H);

    ctx.beginPath();
    ctx.rect(ox, oy, T * MAP_W, T * MAP_H);
    ctx.clip();
    ctx.translate(ox, oy);

    drawBloodFlow(t);
    if (level.goalLabel && map.goalY != null) {
      label(ctx, level.goalLabel, T * 0.2, (map.goalY + 0.62) * T, T, "#ffffff");
    }
    drawWound(state);
    drawLining(state, t);
    drawFracture(state);
    drawBarracks(state, t);
    drawAlarmTint(state, t, ui.reducedMotion);
    drawHealZone(state, t);
    if (ui.placing) drawPlacementGrid(state, ui);
    drawThreats(state, alpha, t, ui);
    drawRanges(state, alpha, ui);
    drawUnits(state, alpha, t, ui);
    drawOrders(state, alpha, ui);
    drawGhost(state, ui, t);
    drawCoach(ui, t);
    drawFx(dt, t);
    drawBox(ui);

    ctx.restore();

    if (flash > 0) {
      ctx.fillStyle = withAlpha(flashColor, Math.min(0.35, flash * 0.35));
      ctx.fillRect(0, 0, cssW, cssH);
      flash = Math.max(0, flash - (dt || 0.016) * 1.6);
    }
  }

  const lerpX = (e, a) => (e.px + (e.x - e.px) * a) * tile;
  const lerpY = (e, a) => (e.py + (e.y - e.py) * a) * tile;

  function heading(e) {
    const dx = e.x - e.px;
    const dy = e.y - e.py;
    if (dx * dx + dy * dy > 1e-6) headings.set(e.id, Math.atan2(dy, dx));
    return headings.get(e.id) ?? Math.PI / 2;
  }

  /* Scale for a thing that has just appeared: 0 → 1 with a bounce. */
  function popScale(id, t, reduced) {
    let b = born.get(id);
    if (b == null) { b = t; born.set(id, t); }
    if (reduced) return 1;
    const k = (t - b) / POP_SECONDS;
    return k >= 1 ? 1 : Math.max(0.01, popEase(Math.max(0, k)));
  }

  /* Jitter for a unit hit in the last fraction of a second. */
  function hurtOffset(u, t, reduced) {
    const prev = lastHp.get(u.id);
    if (prev != null && u.hp < prev - 0.01) hurt.set(u.id, t);
    lastHp.set(u.id, u.hp);
    if (reduced) return 0;
    const h = hurt.get(u.id);
    if (h == null || t - h > HURT_SECONDS) return 0;
    const k = 1 - (t - h) / HURT_SECONDS;
    return Math.sin(t * 90) * tile * 0.06 * k;
  }

  function shadow(x, y, r) {
    ctx.fillStyle = withAlpha(pal.ink, 0.13);
    ctx.beginPath();
    ctx.ellipse(x + r * 0.08, y + r * 0.95, r * 0.95, r * 0.36, 0, 0, TAU);
    ctx.fill();
  }

  function drawBloodFlow(t) { drawFlow(ctx, env(), t); }
  function drawWound(state) { sceneWound(ctx, env(), state); }
  function drawLining(state, t) { sceneLining(ctx, env(), state, t); }
  function drawFracture(state) { sceneFracture(ctx, env(), state); }

  function drawBarracks(state, t) {
    const b = level.barracks;
    if (!b || !map.barracks.length) return;
    const T = tile;
    const x = b.x * T;
    const y = b.y * T;
    const fp = state.fingerprints[b.fingerprint];
    // A soft halo, breathing while it trains, steady once it is ready.
    if (fp && (fp.status === "training" || fp.status === "ready")) {
      const k = fp.status === "training" ? 0.5 + 0.5 * Math.sin(t * 4) : 0.6;
      const halo = ctx.createRadialGradient(x - T * 0.1, y, T * 0.4, x - T * 0.1, y, T * 1.6);
      halo.addColorStop(0, withAlpha(pal.accent, 0.2 * k));
      halo.addColorStop(1, withAlpha(pal.accent, 0));
      ctx.fillStyle = halo;
      ctx.fillRect(x - T * 2, y - T * 2, T * 4, T * 4);
    }
    const g = ctx.createRadialGradient(x - T * 0.3, y - T * 0.4, T * 0.1, x - T * 0.1, y, T);
    g.addColorStop(0, mix(pal.node, "#ffffff", 0.35));
    g.addColorStop(1, pal.node);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(x - T * 0.1, y, T * 0.46, T * 0.95, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = pal.allyNucleus;
    ctx.lineWidth = Math.max(1.5, T * 0.06);
    ctx.stroke();
    ctx.fillStyle = withAlpha("#ffffff", 0.45);
    for (let k = 0; k < 4; k++) {
      ctx.beginPath(); ctx.arc(x - T * 0.12, y - T * 0.6 + k * T * 0.4, T * 0.13, 0, TAU); ctx.fill();
    }
    ctx.save();
    ctx.translate(x - T * 0.62, y);
    ctx.rotate(-Math.PI / 2);
    ctx.font = `800 ${Math.max(9, Math.round(T * 0.26))}px ${cssFont()}`;
    ctx.fillStyle = withAlpha(pal.allyNucleus, 0.85);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(b.label || "Barracks", 0, 0);
    ctx.restore();

    if (fp && fp.status === "training") {
      const p = Math.min(1, (state.t - fp.trainStarted) / (fp.trainEnds - fp.trainStarted));
      ctx.strokeStyle = withAlpha(pal.accent, 0.25);
      ctx.lineWidth = Math.max(3, T * 0.12);
      ctx.beginPath(); ctx.arc(x - T * 0.1, y, T * 1.1, 0, TAU); ctx.stroke();
      ctx.strokeStyle = pal.accent;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.arc(x - T * 0.1, y, T * 1.1, -Math.PI / 2, -Math.PI / 2 + p * TAU);
      ctx.stroke();
      ctx.lineCap = "butt";
      drawFingerprint(ctx, pal, x - T * 0.1, y, T * 0.3);
    } else if (fp && fp.status === "ready") {
      drawFingerprint(ctx, pal, x - T * 0.1, y, T * 0.3);
    }
  }

  function drawAlarmTint(state, t, reduced) {
    if (!level.alarm) return;
    const a = state.alarm / 100;
    if (a <= 0.01) return;
    const W = tile * MAP_W;
    const H = tile * MAP_H;
    const over = state.alarm > ALARM.healHigh;
    const pulse = over && !reduced ? 0.5 + 0.5 * Math.sin(t * 5) : 0;
    ctx.fillStyle = withAlpha(pal.tissueInflamed, Math.min(0.45, a * 0.36 + pulse * 0.06));
    ctx.fillRect(0, 0, W, H);
    // Past the band the edges burn: a red vignette that throbs.
    if (over) {
      const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.7);
      vg.addColorStop(0, withAlpha(pal.alarm, 0));
      vg.addColorStop(1, withAlpha(pal.alarm, 0.25 + 0.2 * pulse * ((state.alarm - ALARM.healHigh) / 40)));
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, W, H);
    }
  }

  function drawHealZone(state, t) {
    const H = level.healing;
    const phase = currentPhase(state);
    if (!H || !phase || !phase.healing) return;
    const T = tile;
    const color = state.healState === "healing" ? pal.heal : state.healState === "slow" ? pal.signal : pal.alarm;
    const g = ctx.createRadialGradient(H.x * T, H.y * T, H.radius * T * 0.5, H.x * T, H.y * T, H.radius * T);
    g.addColorStop(0, withAlpha(color, 0));
    g.addColorStop(1, withAlpha(color, 0.14));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(H.x * T, H.y * T, H.radius * T, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = withAlpha(color, 0.75);
    ctx.lineWidth = Math.max(1.5, T * 0.06);
    ctx.setLineDash([T * 0.18, T * 0.14]);
    ctx.lineDashOffset = state.healState === "healing" ? -t * T * 0.4 : 0;
    ctx.beginPath();
    ctx.arc(H.x * T, H.y * T, H.radius * T, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    // Sparkles while it heals: something good is happening here.
    if (state.healState === "healing") {
      ctx.fillStyle = withAlpha(color, 0.8);
      for (let k = 0; k < 6; k++) {
        const a = k * 1.05 + t * 0.6;
        const rr = H.radius * T * (0.3 + 0.6 * ((t * 0.5 + k * 0.37) % 1));
        const s = T * 0.05 * (1 - ((t * 0.5 + k * 0.37) % 1));
        ctx.beginPath(); ctx.arc(H.x * T + Math.cos(a) * rr, H.y * T + Math.sin(a) * rr, Math.max(0.5, s), 0, TAU); ctx.fill();
      }
    }
  }

  function drawPlacementGrid(state, ui) {
    const T = tile;
    const def = CELLS[ui.placing];
    if (!def || def.kind !== "sentry") return;
    for (const c of map.tiles) {
      if (!isPlaceableTile(map, c.x + 0.5, c.y + 0.5)) continue;
      const taken = state.units.some((u) => u.kind === "sentry" && Math.floor(u.postX) === c.x && Math.floor(u.postY) === c.y);
      if (taken) continue;
      ctx.fillStyle = withAlpha("#ffffff", 0.22);
      roundRect(ctx, c.x * T + T * 0.08, c.y * T + T * 0.08, T * 0.84, T * 0.84, T * 0.14);
      ctx.fill();
    }
  }

  function drawThreats(state, alpha, t, ui) {
    const T = tile;
    for (const th of state.threats) {
      const def = THREATS[th.type];
      const x = lerpX(th, alpha);
      const y = lerpY(th, alpha);
      if (!isVisible(state, th)) {
        // A faint, breathing smudge: something is there, and it is alive.
        const R = (glow.width / dpr / 2) * (1 + (ui.reducedMotion ? 0 : 0.15 * Math.sin(t * 3 + th.seed * 9)));
        ctx.drawImage(glow, x - R, y - R, R * 2, R * 2);
        continue;
      }
      const s = popScale(th.id, t, ui.reducedMotion);
      if (th.type === "infected") {
        const p = Math.min(1, th.age / THREATS.infected.burstAfter);
        drawInfected(ctx, pal, x, y, T, t, th.seed, p);
        // The burst timer, so a player can triage the oldest first.
        ctx.strokeStyle = withAlpha(pal.alarm, 0.9);
        ctx.lineWidth = Math.max(2, T * 0.07);
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.arc(x, y, T * 0.36, -Math.PI / 2, -Math.PI / 2 + p * TAU);
        ctx.stroke();
        ctx.lineCap = "butt";
        continue;
      }
      const r = def.radius * T;
      if (th.type !== "debris") shadow(x, y, r * s);
      if (s !== 1) { ctx.save(); ctx.translate(x, y); ctx.scale(s, s); ctx.translate(-x, -y); }
      drawThing(ctx, pal, th.type, x, y, r, t, th.seed, { heading: heading(th) });
      if (s !== 1) ctx.restore();
    }
  }

  function drawRanges(state, alpha, ui) {
    const T = tile;
    // A selected Scout shows its sight; placing one shows it at the ghost.
    for (const u of state.units) {
      if (u.type !== "scout" || !ui.selected?.has(u.id)) continue;
      ring2(lerpX(u, alpha), lerpY(u, alpha), CELLS.scout.sight * T, pal.accent);
    }
    if (ui.placing === "scout" && ui.ghost) {
      ring2((Math.floor(ui.ghost.x) + 0.5) * T, (Math.floor(ui.ghost.y) + 0.5) * T, CELLS.scout.sight * T, pal.accent);
    }
    if (ui.placing === "devourer" && ui.ghost) {
      ring2((Math.floor(ui.ghost.x) + 0.5) * T, (Math.floor(ui.ghost.y) + 0.5) * T, CELLS.devourer.reach * T + T * 0.3, pal.accent);
    }
  }

  function ring2(x, y, r, color) {
    ctx.fillStyle = withAlpha(color, 0.06);
    ctx.strokeStyle = withAlpha(color, 0.45);
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function drawUnits(state, alpha, t, ui) {
    const T = tile;
    // Sentries under Responders, so a squad fighting beside a Devourer is
    // never hidden behind it.
    const order = [...state.units].sort((a, b) => rank(a) - rank(b));
    for (const u of order) {
      const def = CELLS[u.type] || NEUTRALS[u.type];
      const jitter = hurtOffset(u, t, ui.reducedMotion);
      const x = lerpX(u, alpha) + jitter;
      const bob = u.kind === "sentry" && !ui.reducedMotion ? Math.sin(t * 1.4 + u.seed * 9) * T * 0.035 : 0;
      const y = lerpY(u, alpha) + bob;
      const r = def.radius * T;
      const s = popScale(u.id, t, ui.reducedMotion);
      const moving = Math.hypot(u.x - u.px, u.y - u.py) > 1e-4;
      if (ui.selected?.has(u.id)) {
        ctx.strokeStyle = pal.accent;
        ctx.lineWidth = Math.max(2, T * 0.07);
        ctx.setLineDash([T * 0.12, T * 0.09]);
        ctx.lineDashOffset = -t * 20;
        ctx.beginPath();
        ctx.arc(x, y, r + T * 0.16, 0, TAU);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (u.type === "siren" && !ui.reducedMotion) {
        const k = (t * 0.7 + u.seed) % 1;
        ctx.strokeStyle = withAlpha(pal.alarm, 0.5 * (1 - k));
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, r * (1.4 + k * 2), 0, TAU);
        ctx.stroke();
      }
      shadow(x, y - bob, r * s);
      const g = gulp.get(u.id);
      const gulpK = g != null && t - g < GULP_SECONDS && !ui.reducedMotion ? (t - g) / GULP_SECONDS : 0;
      if (s !== 1) { ctx.save(); ctx.translate(x, y); ctx.scale(s, s); ctx.translate(-x, -y); }
      drawThing(ctx, pal, u.type, x, y, r, t, u.seed, {
        heading: heading(u),
        moving: moving && u.kind === "responder",
        gulp: gulpK,
        carrying: !!u.carrying,
        kills: u.kills,
        working: u.type === "builder" && state.healState === "healing",
      });
      if (s !== 1) ctx.restore();
      if (u.hp < u.maxHp && u.kind !== "neutral") {
        const w = Math.max(T * 0.6, r * 1.6);
        const hh = Math.max(3, T * 0.09);
        const f = Math.max(0, u.hp / u.maxHp);
        ctx.fillStyle = withAlpha(pal.ink, 0.4);
        roundRect(ctx, x - w / 2 - 1, y - r - T * 0.28 - 1, w + 2, hh + 2, hh);
        ctx.fill();
        ctx.fillStyle = f > 0.5 ? pal.heal : f > 0.25 ? pal.enemyAlt : pal.alarm;
        roundRect(ctx, x - w / 2, y - r - T * 0.28, Math.max(hh, w * f), hh, hh);
        ctx.fill();
      }
    }
  }

  function rank(u) {
    return u.kind === "sentry" ? 0 : u.kind === "neutral" ? 1 : 2;
  }

  function drawOrders(state, alpha, ui) {
    if (!ui.selected || !ui.selected.size) return;
    const T = tile;
    ctx.strokeStyle = withAlpha(pal.accent, 0.55);
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 5]);
    for (const u of state.units) {
      if (!ui.selected.has(u.id) || u.kind !== "responder") continue;
      let tx = u.postX;
      let ty = u.postY;
      if (u.order && u.order.x != null) { tx = u.order.x; ty = u.order.y; }
      if (u.order && u.order.lx != null) { tx = u.order.lx; ty = u.order.ly; }
      ctx.beginPath();
      ctx.moveTo(lerpX(u, alpha), lerpY(u, alpha));
      ctx.lineTo(tx * T, ty * T);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  function drawGhost(state, ui, t) {
    if (!ui.placing || !ui.ghost) return;
    const T = tile;
    const def = CELLS[ui.placing];
    if (!def) return;
    if (def.kind === "sentry") {
      const gx = (Math.floor(ui.ghost.x) + 0.5) * T;
      const gy = (Math.floor(ui.ghost.y) + 0.5) * T;
      const ok = ui.ghostOk;
      ctx.fillStyle = withAlpha(ok ? pal.heal : pal.alarm, 0.25);
      roundRect(ctx, gx - T * 0.5, gy - T * 0.5, T, T, T * 0.16);
      ctx.fill();
      ctx.globalAlpha = ok ? 0.75 : 0.35;
      drawThing(ctx, pal, ui.placing, gx, gy, def.radius * T, t, 0.5, {});
      ctx.globalAlpha = 1;
    } else {
      const gx = ui.ghost.x * T;
      const gy = ui.ghost.y * T;
      const spin = ui.reducedMotion ? 0 : t * 1.5;
      ctx.strokeStyle = pal.accent;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(gx, gy, T * 0.45, 0, TAU);
      ctx.stroke();
      ctx.beginPath();
      for (let k = 0; k < 4; k++) {
        const a = spin + (k * Math.PI) / 2;
        ctx.moveTo(gx + Math.cos(a) * T * 0.25, gy + Math.sin(a) * T * 0.25);
        ctx.lineTo(gx + Math.cos(a) * T * 0.6, gy + Math.sin(a) * T * 0.6);
      }
      ctx.stroke();
      if (ui.ghostFrom) {
        ctx.setLineDash([4, 6]);
        ctx.lineDashOffset = -t * 20;
        ctx.strokeStyle = withAlpha(pal.accent, 0.5);
        ctx.beginPath();
        ctx.moveTo(ui.ghostFrom.x * T, ui.ghostFrom.y * T);
        ctx.lineTo(gx, gy);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }

  function drawCoach(ui, t) {
    if (!ui.coachAt) return;
    const T = tile;
    const [x, y] = ui.coachAt;
    const k = (t * 0.9) % 1;
    ctx.strokeStyle = withAlpha(pal.accent, 0.9 * (1 - k));
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x * T, y * T, T * (0.45 + k * 0.6), 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = pal.accent;
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.arc(x * T, y * T, T * 0.45, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function drawFx(dt, t) {
    const T = tile;
    for (let i = fx.length - 1; i >= 0; i--) {
      const f = fx[i];
      f.age += dt;
      const k = f.age / f.life;
      if (k >= 1) { fx.splice(i, 1); continue; }
      if (f.k === "ring") {
        ctx.strokeStyle = withAlpha(f.color, 0.8 * (1 - k));
        ctx.lineWidth = Math.max(1.5, T * 0.06);
        ctx.beginPath();
        ctx.arc(f.x * T, f.y * T, (f.r0 + (f.r1 - f.r0) * k) * T, 0, TAU);
        ctx.stroke();
      } else if (f.k === "dot") {
        f.x += f.vx * dt;
        f.y += f.vy * dt;
        f.vx *= 0.94;
        f.vy *= 0.94;
        ctx.fillStyle = withAlpha(f.color, 1 - k);
        ctx.beginPath();
        ctx.arc(f.x * T, f.y * T, Math.max(1.5, f.size * T * (1 - k * 0.5)), 0, TAU);
        ctx.fill();
      } else if (f.k === "ghost") {
        const def = THREATS[f.type] || CELLS[f.type] || NEUTRALS[f.type];
        if (!def) { fx.splice(i, 1); continue; }
        const s = (1 - k) * f.scale;
        ctx.save();
        ctx.globalAlpha = 1 - k;
        ctx.translate(f.x * T, f.y * T);
        ctx.scale(s, s);
        drawThing(ctx, pal, f.type, 0, 0, def.radius * T, t, f.seed, { heading: f.heading });
        ctx.restore();
      } else if (f.k === "text") {
        const pop = k < 0.15 ? 0.6 + (k / 0.15) * 0.4 : 1;
        ctx.font = `800 ${Math.max(11, Math.round(T * 0.42 * pop))}px ${cssFont()}`;
        ctx.textAlign = "center";
        ctx.lineWidth = 3;
        ctx.strokeStyle = withAlpha("#ffffff", 0.8 * (1 - k));
        ctx.strokeText(f.text, f.x * T, (f.y - k * 0.8) * T);
        ctx.fillStyle = withAlpha(f.color, 1 - k);
        ctx.fillText(f.text, f.x * T, (f.y - k * 0.8) * T);
        ctx.textAlign = "start";
      }
    }
  }

  function drawBox(ui) {
    if (!ui.box) return;
    const T = tile;
    const x0 = Math.min(ui.box.x0, ui.box.x1) * T;
    const y0 = Math.min(ui.box.y0, ui.box.y1) * T;
    const w = Math.abs(ui.box.x1 - ui.box.x0) * T;
    const h = Math.abs(ui.box.y1 - ui.box.y0) * T;
    ctx.fillStyle = withAlpha(pal.accent, 0.12);
    ctx.strokeStyle = pal.accent;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.fillRect(x0, y0, w, h);
    ctx.strokeRect(x0, y0, w, h);
    ctx.setLineDash([]);
  }

  return {
    resize,
    setLevel,
    toMap,
    toScreen,
    onEvents,
    draw,
    get tileSize() { return tile; },
    get mapRect() { return { x: ox, y: oy, w: tile * MAP_W, h: tile * MAP_H }; },
    get palette() { return pal; },
  };
}
