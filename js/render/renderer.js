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
import { MAP_W, MAP_H, fractureCentre, isPlaceableTile } from "../sim/map.js";
import { isVisible, currentPhase } from "../sim/game.js";
import { readPalette, mix, withAlpha } from "./palette.js";
import {
  drawThing, drawInfected, drawFingerprint, roundRect,
} from "./sprites.js";

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
    paintBackground(g, w, h);

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

  function paintBackground(g, w, h) {
    const T = tile;
    const rows = map.rows;
    let seed = 1;
    for (const ch of level.id) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };

    // Base tissue everywhere, lit softly from the top left.
    const light = g.createLinearGradient(0, 0, w, h);
    light.addColorStop(0, mix(pal.tissue, "#ffffff", 0.18));
    light.addColorStop(0.5, pal.tissue);
    light.addColorStop(1, mix(pal.tissue, pal.tissueShade, 0.55));
    g.fillStyle = light;
    g.fillRect(0, 0, w, h);

    // Airway space (Flu): cool, pale, with strands of mucus.
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        if (rows[y][x] === ":") { g.fillStyle = pal.airway; g.fillRect(x * T, y * T, T + 1, T + 1); }
      }
    }
    if (map.tiles.some((t) => t.ch === ":")) {
      const airRows = map.tiles.filter((t) => t.ch === ":").map((t) => t.y);
      const airBot = (Math.max(...airRows) + 1) * T;
      const mist = g.createLinearGradient(0, 0, 0, airBot);
      mist.addColorStop(0, withAlpha("#ffffff", 0.5));
      mist.addColorStop(1, withAlpha("#ffffff", 0));
      g.fillStyle = mist;
      g.fillRect(0, 0, w, airBot);
      g.strokeStyle = withAlpha(pal.allyOutline, 0.22);
      g.lineWidth = 1.5;
      for (let k = 0; k < 7; k++) {
        const y0 = (0.6 + k * 0.62) * T;
        g.beginPath();
        for (let x = 0; x <= w; x += T / 3) g.lineTo(x, y0 + Math.sin(x / T * 1.7 + k) * T * 0.12);
        g.stroke();
      }
      // Drifting motes, so the air reads as air.
      g.fillStyle = withAlpha("#ffffff", 0.7);
      for (let k = 0; k < 24; k++) {
        g.beginPath(); g.arc(rnd() * w, rnd() * airBot, T * (0.02 + rnd() * 0.04), 0, TAU); g.fill();
      }
    }

    // Tissue texture: faint cells with pale nuclei, like a stained slide.
    for (let k = 0; k < 110; k++) {
      const x = rnd() * w;
      const y = rnd() * h;
      const ch = rows[Math.min(MAP_H - 1, Math.floor(y / T))][Math.min(MAP_W - 1, Math.floor(x / T))];
      if (ch !== "." && ch !== "K" && ch !== "V" && ch !== "O") continue;
      const r = T * (0.18 + rnd() * 0.2);
      const rot = rnd() * 3;
      g.fillStyle = withAlpha(pal.tissueShade, 0.5);
      g.beginPath(); g.ellipse(x, y, r, r * 0.8, rot, 0, TAU); g.fill();
      g.fillStyle = withAlpha("#ffffff", 0.35);
      g.beginPath(); g.ellipse(x - r * 0.25, y - r * 0.25, r * 0.45, r * 0.3, rot, 0, TAU); g.fill();
      g.fillStyle = withAlpha(pal.allyNucleus, 0.12);
      g.beginPath(); g.arc(x + r * 0.2, y, r * 0.28, 0, TAU); g.fill();
    }

    // Skin: layered bands across the S/W rows. The wound itself is drawn per
    // frame, because it closes as the level heals.
    const skinRows = [...new Set(map.tiles.filter((t) => t.ch === "S" || t.ch === "W").map((t) => t.y))];
    if (skinRows.length) {
      const top = Math.min(...skinRows) * T;
      const bot = (Math.max(...skinRows) + 1) * T;
      const sk = g.createLinearGradient(0, top, 0, bot);
      sk.addColorStop(0, pal.skinDeep);
      sk.addColorStop(0.2, pal.skin);
      sk.addColorStop(1, mix(pal.skin, pal.tissue, 0.35));
      g.fillStyle = sk;
      g.fillRect(0, top, w, bot - top);
      g.strokeStyle = withAlpha(pal.skinDeep, 0.6);
      g.lineWidth = 1;
      for (let k = 1; k < 4; k++) {
        const yy = top + (bot - top) * (k / 4);
        g.beginPath();
        for (let x = 0; x <= w; x += T / 4) g.lineTo(x, yy + Math.sin(x / T * 2.1 + k) * T * 0.06);
        g.stroke();
      }
      // A few hairs on the surface: unmistakably skin.
      g.strokeStyle = withAlpha(pal.ink, 0.35);
      g.lineWidth = Math.max(1, T * 0.04);
      g.lineCap = "round";
      for (let k = 0; k < 9; k++) {
        const hx = rnd() * w;
        if (map.wound.some((c) => hx > c.x * T - T * 0.3 && hx < (c.x + 1) * T + T * 0.3)) continue;
        g.beginPath();
        g.moveTo(hx, top + T * 0.05);
        g.quadraticCurveTo(hx + T * 0.15, top - T * 0.15, hx + T * 0.32, top - T * 0.22);
        g.stroke();
      }
      // A wavy boundary into the tissue below.
      g.fillStyle = mix(pal.skin, pal.tissue, 0.35);
      g.beginPath();
      g.moveTo(0, bot);
      for (let x = 0; x <= w; x += T / 4) g.lineTo(x, bot + Math.sin(x / T * 2.4) * T * 0.1 + T * 0.06);
      g.lineTo(w, bot - 1);
      g.lineTo(0, bot - 1);
      g.fill();
    }

    // Bone (Broken bone): a thick horizontal band with a cortical edge and
    // spongy texture. The fracture gap is drawn per frame.
    const boneTiles = map.tiles.filter((t) => t.ch === "X" || t.ch === "F");
    if (boneTiles.length) {
      const top = Math.min(...boneTiles.map((t) => t.y)) * T;
      const bot = (Math.max(...boneTiles.map((t) => t.y)) + 1) * T;
      const bn = g.createLinearGradient(0, top, 0, bot);
      bn.addColorStop(0, mix(pal.bone, "#ffffff", 0.3));
      bn.addColorStop(0.5, pal.bone);
      bn.addColorStop(1, mix(pal.bone, pal.boneShade, 0.45));
      g.fillStyle = bn;
      g.fillRect(0, top + T * 0.08, w, bot - top - T * 0.16);
      g.strokeStyle = pal.boneShade;
      g.lineWidth = Math.max(2, T * 0.1);
      g.beginPath(); g.moveTo(0, top + T * 0.1); g.lineTo(w, top + T * 0.1); g.stroke();
      g.beginPath(); g.moveTo(0, bot - T * 0.1); g.lineTo(w, bot - T * 0.1); g.stroke();
      g.fillStyle = withAlpha(pal.boneShade, 0.55);
      for (let k = 0; k < 40; k++) {
        const x = rnd() * w;
        const y = top + T * 0.3 + rnd() * (bot - top - T * 0.6);
        g.beginPath(); g.ellipse(x, y, T * (0.06 + rnd() * 0.08), T * 0.05, rnd() * 3, 0, TAU); g.fill();
      }
      label(g, "Bone", T * 0.2, top + T * 0.45, T);
    }

    // Blood vessels: a tube down each column that holds V/O tiles.
    for (let x = 0; x < MAP_W; x++) {
      let run = null;
      for (let y = 0; y <= MAP_H; y++) {
        const ch = y < MAP_H ? rows[y][x] : null;
        const isV = ch === "V" || ch === "O";
        if (isV && !run) run = { y0: y };
        if (!isV && run) { vessel(g, x, run.y0, y, T); run = null; }
      }
    }
    // Openings: a gap in the inner wall, and a ring so players learn that
    // this is where Responders arrive.
    for (const o of map.openings) {
      const px = o.x * T;
      const py = o.y * T;
      const inward = o.x < MAP_W / 2 ? 1 : -1;
      g.fillStyle = pal.tissue;
      g.fillRect(px + inward * T * 0.2 - (inward > 0 ? 0 : T * 0.14), py - T * 0.22, T * 0.14, T * 0.44);
      g.strokeStyle = withAlpha(pal.allyOutline, 0.9);
      g.lineWidth = Math.max(1.5, T * 0.06);
      g.setLineDash([T * 0.1, T * 0.08]);
      g.beginPath(); g.arc(px + inward * T * 0.32, py, T * 0.3, 0, TAU); g.stroke();
      g.setLineDash([]);
    }

    // The bloodstream / goal band along the bottom.
    const goal = map.tiles.filter((t) => t.ch === "B");
    if (goal.length) {
      const top = Math.min(...goal.map((t) => t.y)) * T;
      const bl = g.createLinearGradient(0, top, 0, h);
      bl.addColorStop(0, pal.vesselDark);
      bl.addColorStop(0.35, pal.blood);
      bl.addColorStop(1, pal.blood);
      g.fillStyle = bl;
      g.fillRect(0, top, w, h - top);
      g.fillStyle = pal.vessel;
      g.fillRect(0, top, w, Math.max(2, T * 0.1));
      // Its label is drawn per frame, above the moving blood cells.
    }

    // Labels a first-time player needs.
    if (map.wound.length) {
      const wx = Math.max(...map.wound.map((t) => t.x)) + 1;
      label(g, "Wound", wx * T + T * 0.1, T * 0.62, T);
    }
    if (map.tiles.some((t) => t.ch === ":")) label(g, "Airway", T * 0.2, T * 0.45, T);
    if (map.lining.length) label(g, "Airway lining", T * 0.2, (map.liningTop - 0.42) * T, T);

    // A vignette: the eye goes to the middle, where the fight is.
    const vg = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.45, w / 2, h / 2, Math.max(w, h) * 0.75);
    vg.addColorStop(0, withAlpha(pal.ink, 0));
    vg.addColorStop(1, withAlpha(pal.ink, 0.16));
    g.fillStyle = vg;
    g.fillRect(0, 0, w, h);
  }

  function vessel(g, x, y0, y1, T) {
    const cx = (x + 0.5) * T;
    const halfW = T * 0.3;
    // A tube: dark wall, blood, and a gloss stripe so it reads as round.
    g.fillStyle = pal.vesselDark;
    g.fillRect(cx - halfW, y0 * T, halfW * 2, (y1 - y0) * T);
    const tube = g.createLinearGradient(cx - halfW, 0, cx + halfW, 0);
    tube.addColorStop(0, pal.vesselDark);
    tube.addColorStop(0.35, pal.blood);
    tube.addColorStop(0.7, pal.blood);
    tube.addColorStop(1, pal.vesselDark);
    g.fillStyle = tube;
    g.fillRect(cx - halfW * 0.7, y0 * T, halfW * 1.4, (y1 - y0) * T);
    g.fillStyle = withAlpha("#ffffff", 0.16);
    g.fillRect(cx - halfW * 0.45, y0 * T, halfW * 0.22, (y1 - y0) * T);
    g.strokeStyle = pal.vessel;
    g.lineWidth = Math.max(1.5, T * 0.07);
    g.beginPath(); g.moveTo(cx - halfW, y0 * T); g.lineTo(cx - halfW, y1 * T); g.stroke();
    g.beginPath(); g.moveTo(cx + halfW, y0 * T); g.lineTo(cx + halfW, y1 * T); g.stroke();
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
    ctx.fillStyle = mix(pal.tissueShade, pal.ink, 0.12);
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
    drawFracture(state, t);
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

  function drawBloodFlow(t) {
    const T = tile;
    ctx.fillStyle = withAlpha(pal.rbc, 0.9);
    // Down each vessel column.
    for (let x = 0; x < MAP_W; x++) {
      const cells = map.tiles.filter((c) => c.x === x && (c.ch === "V" || c.ch === "O"));
      if (!cells.length) continue;
      const y0 = Math.min(...cells.map((c) => c.y));
      const y1 = Math.max(...cells.map((c) => c.y)) + 1;
      const len = y1 - y0;
      for (let k = 0; k < len * 1.2; k++) {
        const yy = y0 + ((k / 1.2 + t * 0.9) % len);
        ctx.beginPath();
        ctx.ellipse((x + 0.5) * T + Math.sin(k * 3.1) * T * 0.06, yy * T, T * 0.1, T * 0.07, 0, 0, TAU);
        ctx.fill();
      }
    }
    // Along the bloodstream band.
    if (map.goalY != null) {
      for (let k = 0; k < 14; k++) {
        const xx = ((k * 0.73 + t * 0.8) % MAP_W);
        const yy = map.goalY + 0.35 + ((k * 37) % 5) / 9;
        ctx.beginPath();
        ctx.ellipse(xx * T, yy * T, T * 0.13, T * 0.09, 0, 0, TAU);
        ctx.fill();
      }
    }
  }

  function drawWound(state) {
    if (!map.wound.length) return;
    const T = tile;
    const xs = map.wound.map((c) => c.x);
    const ys = map.wound.map((c) => c.y);
    const x0 = Math.min(...xs) * T;
    const x1 = (Math.max(...xs) + 1) * T;
    const y0 = Math.min(...ys) * T;
    const y1 = (Math.max(...ys) + 1) * T;
    // The gap narrows as the Healing bar fills, and a scab crosses it.
    const heal = level.healing ? state.healing / 100 : 0;
    const cx = (x0 + x1) / 2;
    const half = ((x1 - x0) / 2) * (1 - heal * 0.85);
    const depth = ctx.createLinearGradient(0, y0, 0, y1 + T * 0.2);
    depth.addColorStop(0, pal.clot);
    depth.addColorStop(1, mix(pal.clot, pal.ink, 0.35));
    ctx.fillStyle = depth;
    ctx.beginPath();
    ctx.moveTo(cx - half, y0);
    for (let k = 0; k <= 8; k++) {
      const yy = y0 + ((y1 - y0 + T * 0.2) * k) / 8;
      ctx.lineTo(cx - half * (0.75 + 0.25 * Math.sin(k * 2.3)), yy);
    }
    for (let k = 8; k >= 0; k--) {
      const yy = y0 + ((y1 - y0 + T * 0.2) * k) / 8;
      ctx.lineTo(cx + half * (0.75 + 0.25 * Math.cos(k * 1.9)), yy);
    }
    ctx.closePath();
    ctx.fill();
    // Reddened, swollen edges.
    ctx.strokeStyle = withAlpha(pal.tissueInflamed, 0.6);
    ctx.lineWidth = Math.max(2, T * 0.12);
    ctx.stroke();
    if (heal > 0.02) {
      ctx.fillStyle = withAlpha(pal.skinDeep, Math.min(1, heal * 1.4));
      roundRect(ctx, cx - half - T * 0.1, y0, half * 2 + T * 0.2, T * 0.35 + heal * T * 0.4, T * 0.15);
      ctx.fill();
    }
  }

  function drawLining(state, t) {
    if (!map.lining.length) return;
    const T = tile;
    for (const c of map.lining) {
      const cell = state.lining[c.i];
      const x = c.x * T;
      const y = c.y * T;
      if (cell.status === "dead") {
        // A hole: grey, broken, and — while regrowing — a pink cell rising.
        ctx.fillStyle = withAlpha(pal.liningDead, 0.9);
        roundRect(ctx, x + T * 0.08, y + T * 0.08, T * 0.84, T * 0.84, T * 0.14);
        ctx.fill();
        ctx.strokeStyle = withAlpha(pal.ink, 0.25);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x + T * 0.25, y + T * 0.3); ctx.lineTo(x + T * 0.5, y + T * 0.55); ctx.lineTo(x + T * 0.72, y + T * 0.35);
        ctx.stroke();
        if (cell.regrow > 0) {
          const k = cell.regrow;
          ctx.fillStyle = withAlpha(pal.lining, 0.9);
          roundRect(ctx, x + T * (0.5 - 0.42 * k), y + T * (0.9 - 0.82 * k), T * 0.84 * k, T * 0.82 * k, T * 0.12);
          ctx.fill();
        }
        continue;
      }
      // Healthy (or infected — the infected overlay is drawn with threats).
      const g = ctx.createLinearGradient(x, y, x, y + T);
      g.addColorStop(0, mix(pal.lining, "#ffffff", 0.25));
      g.addColorStop(1, pal.lining);
      ctx.fillStyle = g;
      roundRect(ctx, x + T * 0.05, y + T * 0.04, T * 0.9, T * 0.92, T * 0.16);
      ctx.fill();
      ctx.strokeStyle = withAlpha(pal.allyOutline, 0.9);
      ctx.lineWidth = Math.max(1, T * 0.04);
      ctx.stroke();
      ctx.fillStyle = withAlpha(pal.allyNucleus, 0.55);
      ctx.beginPath();
      ctx.ellipse(x + T * 0.5, y + T * 0.66, T * 0.16, T * 0.11, 0, 0, TAU);
      ctx.fill();
      // Cilia on the airway face, beating.
      if (c.y === map.liningTop) {
        ctx.strokeStyle = withAlpha(pal.allyOutline, 0.95);
        ctx.lineWidth = Math.max(1, T * 0.035);
        for (let k = 0; k < 5; k++) {
          const bx = x + T * (0.15 + k * 0.175);
          const sway = Math.sin(t * 5 + k + c.x) * T * 0.07;
          ctx.beginPath();
          ctx.moveTo(bx, y + T * 0.06);
          ctx.quadraticCurveTo(bx + sway, y - T * 0.08, bx + sway * 1.6, y - T * 0.2);
          ctx.stroke();
        }
      }
    }
  }

  function drawFracture(state, t) {
    const c = fractureCentre(map);
    if (!c) return;
    const T = tile;
    const heal = state.healing / 100;
    const cols = map.fracture.map((f) => f.x);
    const x0 = Math.min(...cols) * T;
    const x1 = (Math.max(...cols) + 1) * T;
    const rowsY = map.fracture.map((f) => f.y);
    const y0 = Math.min(...rowsY) * T + T * 0.08;
    const y1 = (Math.max(...rowsY) + 1) * T - T * 0.08;
    // A jagged gap full of clotted blood…
    ctx.fillStyle = pal.hematoma;
    ctx.beginPath();
    ctx.moveTo(x0 + T * 0.1, y0);
    for (let k = 0; k <= 6; k++) ctx.lineTo(x0 + T * (0.1 + 0.25 * ((k % 2) ? 1 : 0)), y0 + ((y1 - y0) * k) / 6);
    for (let k = 6; k >= 0; k--) ctx.lineTo(x1 - T * (0.1 + 0.25 * ((k % 2) ? 0 : 1)), y0 + ((y1 - y0) * k) / 6);
    ctx.closePath();
    ctx.fill();
    // …that callus (new bone) fills in from both sides as it heals.
    if (heal > 0) {
      const half = ((x1 - x0) / 2) * Math.min(1, heal * 1.05);
      ctx.fillStyle = pal.callus;
      ctx.fillRect(x0, y0, half, y1 - y0);
      ctx.fillRect(x1 - half, y0, half, y1 - y0);
      ctx.fillStyle = withAlpha(pal.boneShade, 0.6);
      for (let k = 0; k < 6; k++) {
        const yy = y0 + ((y1 - y0) * (k + 0.5)) / 6;
        ctx.beginPath(); ctx.arc(x0 + half * 0.5, yy, T * 0.05, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.arc(x1 - half * 0.5, yy, T * 0.05, 0, TAU); ctx.fill();
      }
    }
  }

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
