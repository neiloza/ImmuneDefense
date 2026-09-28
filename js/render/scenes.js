/* ============================================================================
 * scenes.js — each level painted as the tissue it defends.
 *
 * The sim thinks in a 9 × 16 grid and never looks at any of this. The
 * renderer asks this module to paint the static background once per resize
 * and to draw the few things that change with the game (the wound closing,
 * the airway lining dying and regrowing, the fracture knitting) every frame.
 * Everything here is decoration over the same tile positions the sim uses:
 * a vessel meanders, but it still passes through every opening tile where
 * Responders arrive; the lining is drawn as tall packed cells, but there is
 * still exactly one per A tile.
 *
 * Three scenes, chosen by `level.scene` (js/data/levels.js):
 *   skin    a cross-section of skin: stratum corneum and epidermis on top,
 *           dermis with collagen, hair follicles, a sweat gland, fat lobules
 *           lower down, a big vessel (the bloodstream) along the bottom, and
 *           a V-shaped cut through the surface that clots and scabs
 *   airway  the wall of a bronchus: the lumen with a mucus blanket, a
 *           three-tier ciliated epithelium on a basement membrane, capillary
 *           web, smooth muscle, a cartilage plate, and alveoli (the deeper
 *           lung) at the bottom
 *   bone    a long bone in an arm: striated muscle in fascicles, fascia, a
 *           periosteum, compact cortex with osteons, a marrow cavity, and a
 *           jagged break that fills with a hematoma and grows a callus
 *
 * Coordinates handed in are pixels with the map's top-left at (0,0); `T` is
 * the tile size. All colours come from the palette (css/tokens.css).
 * ========================================================================= */

import { MAP_W, MAP_H } from "../sim/map.js";
import { mix, withAlpha } from "./palette.js";
import { roundRect } from "./sprites.js";

const TAU = Math.PI * 2;

/* A seeded generator for texture, so the same level always looks the same. */
export function textureRandom(seedText) {
  let seed = 1;
  for (const ch of seedText) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

/* ---- vessels ---------------------------------------------------------------
 * A vessel wanders a little as it runs down its column, but straightens to
 * pass dead through every opening's centre, so the arrival ring the player
 * learns sits on the vessel it belongs to. */

export function vesselX(env, col, y) {
  const near = env.map.openings
    .filter((o) => Math.floor(o.x) === col)
    .reduce((d, o) => Math.min(d, Math.abs(o.y - y)), 9);
  const damp = Math.min(1, near * 1.4);
  const wobble = Math.sin(y * 1.9 + col * 2.1) * 0.09 + Math.sin(y * 0.7 + col) * 0.05;
  return (col + 0.5 + wobble * damp) * env.T;
}

function vesselRuns(map) {
  const runs = [];
  for (let x = 0; x < MAP_W; x++) {
    let run = null;
    for (let y = 0; y <= MAP_H; y++) {
      const ch = y < MAP_H ? map.rows[y][x] : null;
      const isV = ch === "V" || ch === "O";
      if (isV && !run) run = { col: x, y0: y };
      if (!isV && run) { run.y1 = y; runs.push(run); run = null; }
    }
  }
  return runs;
}

function vesselPath(g, env, run) {
  g.beginPath();
  for (let y = run.y0; y <= run.y1 + 0.001; y += 0.2) {
    const px = vesselX(env, run.col, y);
    if (y === run.y0) g.moveTo(px, y * env.T); else g.lineTo(px, y * env.T);
  }
}

function paintVessels(g, env, rnd) {
  const { pal, T } = env;
  for (const run of vesselRuns(env.map)) {
    const inward = run.col < MAP_W / 2 ? 1 : -1;
    // Capillaries branch off into the tissue before the tube goes on top.
    g.strokeStyle = withAlpha(pal.vessel, 0.6);
    g.lineCap = "round";
    for (let k = 0; k < 2; k++) {
      const y = run.y0 + 0.8 + rnd() * Math.max(0.5, run.y1 - run.y0 - 1.6);
      if (env.map.openings.some((o) => Math.floor(o.x) === run.col && Math.abs(o.y - y) < 0.7)) continue;
      const sx = vesselX(env, run.col, y) + inward * T * 0.28;
      const sy = y * T;
      const ex = sx + inward * T * (0.9 + rnd() * 0.8);
      const ey = sy + (rnd() - 0.5) * T * 1.2;
      g.lineWidth = Math.max(1, T * 0.06);
      g.beginPath();
      g.moveTo(sx, sy);
      g.quadraticCurveTo(sx + inward * T * 0.5, sy + (ey - sy) * 0.2, ex, ey);
      g.stroke();
      g.lineWidth = Math.max(1, T * 0.035);
      g.beginPath();
      g.moveTo(ex, ey);
      g.quadraticCurveTo(ex + inward * T * 0.3, ey - T * 0.3, ex + inward * T * 0.5, ey - T * 0.15);
      g.moveTo(ex, ey);
      g.quadraticCurveTo(ex + inward * T * 0.2, ey + T * 0.3, ex + inward * T * 0.55, ey + T * 0.25);
      g.stroke();
    }
    // The tube: wall, blood, a gloss stripe so it reads as round.
    g.lineCap = "butt";
    g.lineJoin = "round";
    vesselPath(g, env, run);
    g.strokeStyle = pal.vesselDark; g.lineWidth = T * 0.66; g.stroke();
    vesselPath(g, env, run);
    g.strokeStyle = pal.blood; g.lineWidth = T * 0.46; g.stroke();
    vesselPath(g, env, run);
    g.strokeStyle = pal.vessel; g.lineWidth = T * 0.62; g.setLineDash([]); g.globalAlpha = 0.35; g.stroke(); g.globalAlpha = 1;
    g.save();
    g.translate(-T * 0.12, 0);
    vesselPath(g, env, run);
    g.strokeStyle = withAlpha("#ffffff", 0.18); g.lineWidth = T * 0.08; g.stroke();
    g.restore();
  }
  // Openings: a gap in the inner wall, and a ring so players learn that this
  // is where Responders arrive.
  for (const o of env.map.openings) {
    const px = o.x * T;
    const py = o.y * T;
    const inward = o.x < MAP_W / 2 ? 1 : -1;
    g.fillStyle = withAlpha(pal.blood, 0.9);
    g.fillRect(px + inward * T * 0.2 - (inward > 0 ? 0 : T * 0.16), py - T * 0.2, T * 0.16, T * 0.4);
    g.strokeStyle = withAlpha(pal.allyOutline, 0.9);
    g.lineWidth = Math.max(1.5, T * 0.06);
    g.setLineDash([T * 0.1, T * 0.08]);
    g.beginPath(); g.arc(px + inward * T * 0.32, py, T * 0.3, 0, TAU); g.stroke();
    g.setLineDash([]);
  }
}

/* The wide vessel along the bottom (Cut): the bloodstream a leak reaches. */
function paintBloodstream(g, env) {
  const { pal, T, w, h, map } = env;
  if (map.goalY == null) return;
  const top = map.goalY * T;
  const tube = g.createLinearGradient(0, top, 0, h);
  tube.addColorStop(0, pal.vesselDark);
  tube.addColorStop(0.25, pal.blood);
  tube.addColorStop(0.55, mix(pal.blood, pal.rbc, 0.25));
  tube.addColorStop(1, pal.vesselDark);
  g.fillStyle = tube;
  g.fillRect(0, top, w, h - top);
  g.fillStyle = pal.vessel;
  g.fillRect(0, top, w, Math.max(2, T * 0.1));
  g.fillStyle = withAlpha("#ffffff", 0.14);
  g.fillRect(0, top + T * 0.3, w, T * 0.07);
}

/* Cells in the blood: per frame, along every vessel and the bottom band. */
export function drawFlow(ctx, env, t) {
  const { pal, T, map } = env;
  // Red blood cells as little dimpled discs: friendly, not gory.
  const disc = (x, y, r) => {
    ctx.fillStyle = withAlpha(pal.rbc, 0.95);
    ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.75, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = withAlpha("#ffffff", 0.35);
    ctx.beginPath(); ctx.ellipse(x, y, r * 0.42, r * 0.3, 0, 0, TAU); ctx.fill();
  };
  for (const run of vesselRuns(map)) {
    const len = run.y1 - run.y0;
    for (let k = 0; k < len * 1.2; k++) {
      const yy = run.y0 + ((k / 1.2 + t * 0.9) % len);
      disc(vesselX(env, run.col, yy) + Math.sin(k * 3.1) * T * 0.05, yy * T, T * 0.11);
    }
  }
  if (map.goalY != null && env.level.scene !== "airway") {
    for (let k = 0; k < 14; k++) {
      const xx = ((k * 0.73 + t * 0.8) % MAP_W);
      const yy = map.goalY + 0.3 + ((k * 37) % 5) / 8;
      disc(xx * T, yy * T, T * 0.14);
    }
  }
}

/* Soft motes drifting up through the tissue: the body is alive and well,
 * and the calm before a wave should feel like something worth keeping. */
export function drawAmbient(ctx, env, t) {
  const { T, w, h } = env;
  for (let k = 0; k < 12; k++) {
    const x = ((k * 0.377 + Math.sin(t * 0.3 + k) * 0.02) % 1) * w;
    const y = ((1 - ((t * 0.018 * (1 + (k % 3) * 0.4) + k * 0.61) % 1)) * h);
    const a = 0.18 + 0.18 * (0.5 + 0.5 * Math.sin(t * 1.7 + k * 2.1));
    ctx.fillStyle = withAlpha("#ffffff", a);
    ctx.beginPath();
    ctx.arc(x, y, T * (0.035 + (k % 4) * 0.012), 0, TAU);
    ctx.fill();
  }
}

/* ---- shared texture -------------------------------------------------------- */

function faintCells(g, env, rnd, count, allowed) {
  const { pal, T, w, h, map } = env;
  for (let k = 0; k < count; k++) {
    const x = rnd() * w;
    const y = rnd() * h;
    const ch = map.rows[Math.min(MAP_H - 1, Math.floor(y / T))][Math.min(MAP_W - 1, Math.floor(x / T))];
    if (!allowed.includes(ch)) continue;
    const r = T * (0.16 + rnd() * 0.18);
    const rot = rnd() * 3;
    g.fillStyle = withAlpha(pal.tissueShade, 0.5);
    g.beginPath(); g.ellipse(x, y, r, r * 0.7, rot, 0, TAU); g.fill();
    g.fillStyle = withAlpha("#ffffff", 0.35);
    g.beginPath(); g.ellipse(x - r * 0.25, y - r * 0.25, r * 0.45, r * 0.28, rot, 0, TAU); g.fill();
    g.fillStyle = withAlpha(pal.allyNucleus, 0.12);
    g.beginPath(); g.arc(x + r * 0.2, y, r * 0.26, 0, TAU); g.fill();
  }
}

function wavyLine(g, x0, x1, y, amp, freq, phase, step) {
  g.beginPath();
  for (let x = x0; x <= x1; x += step) g.lineTo(x, y + Math.sin(x * freq + phase) * amp);
  g.stroke();
}

function vignette(g, env) {
  const { pal, w, h } = env;
  const vg = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.45, w / 2, h / 2, Math.max(w, h) * 0.75);
  vg.addColorStop(0, withAlpha(pal.ink, 0));
  vg.addColorStop(1, withAlpha(pal.ink, 0.09));
  g.fillStyle = vg;
  g.fillRect(0, 0, w, h);
}

function label(g, env, text, x, y, color) {
  const T = env.T;
  g.font = `700 ${Math.max(9, Math.round(T * 0.28))}px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`;
  g.fillStyle = color || withAlpha(env.pal.ink, 0.5);
  g.textBaseline = "middle";
  g.fillText(text, x, y);
}

/* ---- SKIN (Cut) ------------------------------------------------------------ */

function paintSkin(g, env, rnd) {
  const { pal, T, w, h, map } = env;
  const skinBot = 2 * T;                 // the S/W rows
  const fatTop = 11 * T;
  const goalTop = map.goalY != null ? map.goalY * T : h;

  // Dermis: eosin pink, lit from the surface, warmer just under the skin.
  const derm = g.createLinearGradient(0, 0, 0, goalTop);
  derm.addColorStop(0, mix(pal.skin, pal.tissue, 0.35));
  derm.addColorStop(0.25, pal.tissue);
  derm.addColorStop(1, mix(pal.tissue, pal.tissueShade, 0.5));
  g.fillStyle = derm;
  g.fillRect(0, 0, w, h);

  // Collagen: faint wavy fibres running across the dermis.
  g.lineWidth = Math.max(1, T * 0.05);
  for (let k = 0; k < 16; k++) {
    const y = skinBot + rnd() * (fatTop - skinBot);
    g.strokeStyle = withAlpha(pal.skinDeep, 0.16 + rnd() * 0.12);
    wavyLine(g, -T, w + T, y, T * (0.08 + rnd() * 0.1), (0.9 + rnd()) / T, rnd() * 6, T / 4);
  }
  faintCells(g, env, rnd, 50, ["."]);

  // Hypodermis: fat lobules above the bloodstream.
  for (let k = 0; k < 26; k++) {
    const x = rnd() * w;
    const y = fatTop + T * 0.3 + rnd() * (goalTop - fatTop - T * 0.5);
    if (map.rows[Math.min(MAP_H - 1, Math.floor(y / T))][Math.min(MAP_W - 1, Math.floor(x / T))] !== ".") continue;
    const r = T * (0.22 + rnd() * 0.2);
    g.fillStyle = withAlpha(pal.fat, 0.85);
    g.strokeStyle = withAlpha(pal.fatLine, 0.7);
    g.lineWidth = Math.max(1, T * 0.04);
    g.beginPath(); g.ellipse(x, y, r, r * 0.85, rnd() * 3, 0, TAU); g.fill(); g.stroke();
  }

  // Hair follicles: a sheath from deep in the dermis up through the skin, a
  // bulb at the bottom, a sebaceous gland at the side, and the hair itself.
  for (const fx of [1.55 * T, 7.55 * T]) {
    const depth = 3.4 * T;
    g.fillStyle = withAlpha(pal.skinDeep, 0.55);
    roundRect(g, fx - T * 0.17, T * 0.3, T * 0.34, depth - T * 0.3, T * 0.17);
    g.fill();
    g.beginPath(); g.ellipse(fx, depth, T * 0.24, T * 0.2, 0, 0, TAU); g.fill();
    g.fillStyle = withAlpha(pal.fat, 0.9);
    g.strokeStyle = withAlpha(pal.fatLine, 0.8);
    g.lineWidth = Math.max(1, T * 0.04);
    for (let k = 0; k < 3; k++) {
      g.beginPath(); g.ellipse(fx + T * (0.32 + k * 0.14), T * (1.35 + (k % 2) * 0.16), T * 0.13, T * 0.11, 0, 0, TAU); g.fill(); g.stroke();
    }
    g.strokeStyle = pal.hair;
    g.lineWidth = Math.max(1.2, T * 0.05);
    g.lineCap = "round";
    g.beginPath();
    g.moveTo(fx, depth - T * 0.1);
    g.quadraticCurveTo(fx + T * 0.05, T * 0.6, fx + T * 0.2, -T * 0.3);
    g.stroke();
  }

  // The epidermis: a layered band with an undulating base (rete ridges), a
  // pale flaky stratum corneum on top, interrupted by the cut.
  const eTop = 0;
  const eBot = T * 0.62;
  g.fillStyle = pal.epidermis;
  g.beginPath();
  g.moveTo(0, eTop);
  g.lineTo(w, eTop);
  for (let x = w; x >= 0; x -= T / 6) g.lineTo(x, eBot + Math.sin(x / T * 5.2) * T * 0.09);
  g.closePath();
  g.fill();
  g.fillStyle = pal.corneum;
  g.fillRect(0, eTop, w, T * 0.16);
  g.strokeStyle = withAlpha(pal.skinDeep, 0.35);
  g.lineWidth = 1;
  for (let k = 1; k < 4; k++) wavyLine(g, 0, w, T * (0.16 + k * 0.11), T * 0.02, 6 / T, k, T / 6);
  // Basal cells along the epidermis base, drawn as small dark ovals.
  g.fillStyle = withAlpha(pal.allyNucleus, 0.18);
  for (let x = T * 0.1; x < w; x += T * 0.19) {
    g.beginPath(); g.ellipse(x, eBot - T * 0.08 + Math.sin(x / T * 5.2) * T * 0.09, T * 0.06, T * 0.08, 0, 0, TAU); g.fill();
  }
  // Small hairs on the surface, away from the cut.
  g.strokeStyle = pal.hair;
  g.lineWidth = Math.max(1, T * 0.045);
  for (let k = 0; k < 8; k++) {
    const hx = rnd() * w;
    if (map.wound.some((c) => hx > c.x * T - T * 0.4 && hx < (c.x + 1) * T + T * 0.4)) continue;
    g.beginPath();
    g.moveTo(hx, T * 0.06);
    g.quadraticCurveTo(hx + T * 0.15, -T * 0.12, hx + T * 0.32, -T * 0.25);
    g.stroke();
  }

  // The cut itself: a V through the epidermis into the dermis. The clot and
  // scab are drawn per frame (drawWound); this is the gap they sit in.
  if (map.wound.length) {
    const xs = map.wound.map((c) => c.x);
    const cx = ((Math.min(...xs) + Math.max(...xs) + 1) / 2) * T;
    woundPath(g, T, cx, 1, 0);
    g.fillStyle = mix(pal.tissue, pal.tissueInflamed, 0.3);
    g.fill();
    // A little pink around the edges, no more.
    g.strokeStyle = withAlpha(pal.tissueInflamed, 0.5);
    g.lineWidth = Math.max(2, T * 0.12);
    g.stroke();
  }

  paintBloodstream(g, env);
  paintVessels(g, env, rnd);
  if (map.wound.length) {
    const wx = Math.max(...map.wound.map((c) => c.x)) + 1;
    label(g, env, "Wound", wx * T + T * 0.35, T * 0.9);
  }
  label(g, env, "Skin", T * 0.15, T * 0.3, withAlpha(pal.ink, 0.45));
}

/* The V of the cut, `open` = 1 fully open … 0 closed, `depth` in tiles. */
function woundPath(g, T, cx, open, seed) {
  const topHalf = T * 1.35 * open;
  const depth = T * (2.25 - (1 - open) * 1.1);
  g.beginPath();
  g.moveTo(cx - topHalf, -1);
  for (let k = 1; k <= 6; k++) {
    const f = k / 6;
    g.lineTo(cx - topHalf * (1 - f) * (0.85 + 0.15 * Math.sin(k * 2.3 + seed)) - T * 0.08, depth * f);
  }
  for (let k = 6; k >= 1; k--) {
    const f = k / 6;
    g.lineTo(cx + topHalf * (1 - f) * (0.85 + 0.15 * Math.cos(k * 1.9 + seed)) + T * 0.08, depth * f);
  }
  g.lineTo(cx + topHalf, -1);
  g.closePath();
}

/* Per frame: the clot filling the cut, narrowing as Healing fills, and the
 * scab that forms over it. */
export function drawWound(ctx, env, state) {
  const { pal, T, map, level } = env;
  if (!map.wound.length) return;
  const xs = map.wound.map((c) => c.x);
  const cx = ((Math.min(...xs) + Math.max(...xs) + 1) / 2) * T;
  const heal = level.healing ? state.healing / 100 : 0;
  const open = 1 - heal * 0.88;
  woundPath(ctx, T, cx, open, 0);
  const g = ctx.createLinearGradient(0, 0, 0, T * 2.3);
  g.addColorStop(0, mix(pal.clot, "#ffffff", 0.15));
  g.addColorStop(1, mix(pal.clot, pal.ink, 0.12));
  ctx.fillStyle = g;
  ctx.fill();
  // A soft sheen, so the clot reads as smooth rather than raw.
  ctx.fillStyle = withAlpha("#ffffff", 0.18);
  ctx.beginPath();
  ctx.ellipse(cx - T * 0.35 * open, T * 0.45, T * 0.3 * open, T * 0.14, -0.5, 0, TAU);
  ctx.fill();
  if (heal > 0.02) {
    // The scab: a warm brown crust across the top, thickening as it heals,
    // with new pink skin creeping in beneath it from both edges.
    const half = T * 1.35 * open + T * 0.15;
    ctx.fillStyle = withAlpha(mix(pal.clot, pal.hair, 0.6), Math.min(1, heal * 1.6));
    roundRect(ctx, cx - half, -T * 0.05, half * 2, T * (0.22 + heal * 0.2), T * 0.12);
    ctx.fill();
    ctx.fillStyle = withAlpha(pal.epidermis, Math.min(1, heal * 1.2));
    ctx.fillRect(cx - half - T * 0.1, T * 0.17, T * 0.1 + half * heal * 0.9, T * 0.45);
    ctx.fillRect(cx + half - half * heal * 0.9, T * 0.17, T * 0.1 + half * heal * 0.9, T * 0.45);
  }
}

/* ---- AIRWAY (Flu) ---------------------------------------------------------- */

function paintAirway(g, env, rnd) {
  const { pal, T, w, h, map } = env;
  const top = map.liningTop * T;              // the epithelium's apical edge
  const memb = (map.liningTop + 3) * T;       // basement membrane
  const goalTop = map.goalY != null ? map.goalY * T : h;

  // The lumen: cool, pale, misted, with strands of mucus.
  const lum = g.createLinearGradient(0, 0, 0, top);
  lum.addColorStop(0, mix(pal.airway, "#ffffff", 0.5));
  lum.addColorStop(1, pal.airway);
  g.fillStyle = lum;
  g.fillRect(0, 0, w, top);
  g.strokeStyle = withAlpha(pal.allyOutline, 0.2);
  g.lineWidth = 1.5;
  for (let k = 0; k < 7; k++) wavyLine(g, 0, w, (0.5 + k * 0.62) * T, T * 0.12, 1.7 / T, k, T / 3);
  g.fillStyle = withAlpha("#ffffff", 0.7);
  for (let k = 0; k < 24; k++) {
    g.beginPath(); g.arc(rnd() * w, rnd() * top, T * (0.02 + rnd() * 0.04), 0, TAU); g.fill();
  }
  // The mucus blanket riding on the cilia.
  g.fillStyle = withAlpha(pal.mucus, 0.85);
  g.beginPath();
  g.moveTo(0, top);
  for (let x = 0; x <= w; x += T / 5) g.lineTo(x, top - T * 0.32 + Math.sin(x / T * 3.1) * T * 0.07);
  g.lineTo(w, top);
  g.closePath();
  g.fill();

  // Under the membrane: lamina propria, pink, with a capillary web.
  const lp = g.createLinearGradient(0, memb, 0, goalTop);
  lp.addColorStop(0, mix(pal.tissue, "#ffffff", 0.1));
  lp.addColorStop(1, mix(pal.tissue, pal.tissueShade, 0.5));
  g.fillStyle = lp;
  g.fillRect(0, top, w, h - top);
  g.strokeStyle = withAlpha(pal.vessel, 0.4);
  g.lineWidth = Math.max(1, T * 0.035);
  for (let k = 0; k < 5; k++) {
    const y = memb + T * (0.25 + rnd() * 1.1);
    wavyLine(g, T * (0.9 + rnd() * 2), w, y, T * 0.12, (2 + rnd() * 2) / T, rnd() * 6, T / 5);
  }
  faintCells(g, env, rnd, 40, ["."]);

  // Smooth muscle: two bands of long spindle fibres.
  for (const y of [10.15 * T, 11.25 * T]) {
    g.fillStyle = withAlpha(pal.muscle, 0.5);
    roundRect(g, T * 0.85, y, w - T * 0.85 - T * 1.05, T * 0.42, T * 0.2);
    g.fill();
    g.strokeStyle = withAlpha(pal.muscleDark, 0.5);
    g.lineWidth = 1;
    for (let k = 0; k < 4; k++) wavyLine(g, T * 0.95, w - T * 1.1, y + T * (0.08 + k * 0.09), T * 0.015, 5 / T, k, T / 4);
    g.fillStyle = withAlpha(pal.muscleDark, 0.55);
    for (let x = T * 1.2; x < w - T * 1.2; x += T * 0.55) {
      g.beginPath(); g.ellipse(x, y + T * 0.21, T * 0.09, T * 0.035, 0, 0, TAU); g.fill();
    }
  }

  // A plate of cartilage, holding the airway open: bluish, with paired cells
  // in their lacunae.
  const cy = 12.7 * T;
  const plate = g.createLinearGradient(0, cy, 0, cy + T * 1.3);
  plate.addColorStop(0, mix(pal.cartilage, "#ffffff", 0.25));
  plate.addColorStop(1, pal.cartilage);
  g.fillStyle = plate;
  roundRect(g, T * 0.95, cy, w - T * 0.95 + T * 0.5, T * 1.3, T * 0.5);
  g.fill();
  g.strokeStyle = withAlpha(pal.cartilageDark, 0.8);
  g.lineWidth = Math.max(1.5, T * 0.06);
  g.stroke();
  g.fillStyle = withAlpha(pal.cartilageDark, 0.75);
  for (let k = 0; k < 22; k++) {
    const x = T * 1.3 + rnd() * (w - T * 1.6);
    const y = cy + T * 0.25 + rnd() * T * 0.8;
    g.beginPath(); g.ellipse(x, y, T * 0.07, T * 0.05, 0, 0, TAU); g.fill();
    g.beginPath(); g.ellipse(x + T * 0.14, y + T * 0.03, T * 0.07, T * 0.05, 0, 0, TAU); g.fill();
  }

  // The deeper lung: alveoli, a froth of thin-walled sacs.
  if (map.goalY != null) {
    g.fillStyle = pal.alveoli;
    g.fillRect(0, goalTop, w, h - goalTop);
    g.save();
    g.beginPath(); g.rect(0, goalTop, w, h - goalTop); g.clip();
    for (let k = 0; k < 26; k++) {
      const x = rnd() * w;
      const y = goalTop + rnd() * (h - goalTop);
      const r = T * (0.22 + rnd() * 0.22);
      g.fillStyle = withAlpha("#ffffff", 0.55);
      g.strokeStyle = withAlpha(pal.vessel, 0.45);
      g.lineWidth = Math.max(1, T * 0.05);
      g.beginPath(); g.ellipse(x, y, r, r * 0.85, rnd() * 3, 0, TAU); g.fill(); g.stroke();
    }
    g.restore();
    g.fillStyle = withAlpha(pal.vessel, 0.35);
    g.fillRect(0, goalTop, w, Math.max(2, T * 0.06));
  }

  // The basement membrane the epithelium stands on.
  g.strokeStyle = withAlpha(mix(pal.lining, pal.allyNucleus, 0.35), 0.9);
  g.lineWidth = Math.max(2, T * 0.1);
  wavyLine(g, 0, w, memb, T * 0.03, 4 / T, 0, T / 5);

  paintVessels(g, env, rnd);
  label(g, env, "Airway", T * 0.2, T * 0.45);
  label(g, env, "Airway lining", T * 0.2, top - T * 0.5);
}

/* Per frame: the epithelium, one cell per A tile, in three tiers — tall
 * ciliated cells on top, goblet cells full of mucus in the middle, small
 * basal cells on the membrane — packed tight so it reads as tissue. A dead
 * cell is a grey hole; while it regrows a pink cell rises to fill it. */
export function drawLining(ctx, env, state, t) {
  const { pal, T, map } = env;
  if (!map.lining.length) return;
  for (const c of map.lining) {
    const cell = state.lining[c.i];
    const tier = c.y - map.liningTop;
    const jitter = ((c.i * 7919) % 7) / 7 - 0.5;
    const x = c.x * T + jitter * T * 0.05;
    const y = c.y * T;
    if (cell.status === "dead") {
      ctx.fillStyle = withAlpha(pal.liningDead, 0.9);
      roundRect(ctx, x + T * 0.06, y + T * 0.06, T * 0.88, T * 0.88, T * 0.18);
      ctx.fill();
      ctx.strokeStyle = withAlpha(pal.ink, 0.25);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + T * 0.25, y + T * 0.3); ctx.lineTo(x + T * 0.5, y + T * 0.55); ctx.lineTo(x + T * 0.72, y + T * 0.35);
      ctx.stroke();
      if (cell.regrow > 0) {
        const k = cell.regrow;
        ctx.fillStyle = withAlpha(pal.lining, 0.9);
        roundRect(ctx, x + T * (0.5 - 0.44 * k), y + T * (0.94 - 0.88 * k), T * 0.88 * k, T * 0.88 * k, T * 0.18);
        ctx.fill();
      }
      continue;
    }
    const grad = ctx.createLinearGradient(x, y, x, y + T);
    grad.addColorStop(0, mix(pal.lining, "#ffffff", 0.3));
    grad.addColorStop(1, pal.lining);
    ctx.fillStyle = grad;
    ctx.strokeStyle = withAlpha(pal.allyOutline, 0.9);
    ctx.lineWidth = Math.max(1, T * 0.04);
    if (tier === 0) {
      // Ciliated columnar: tall, rounded top, nucleus low, cilia beating.
      const hh = T * (1.0 + jitter * 0.08);
      roundRect(ctx, x + T * 0.03, y + T * 0.02, T * 0.94, hh, T * 0.3);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = withAlpha(pal.allyNucleus, 0.55);
      ctx.beginPath(); ctx.ellipse(x + T * 0.5, y + T * 0.7, T * 0.15, T * 0.2, 0, 0, TAU); ctx.fill();
      ctx.strokeStyle = withAlpha(pal.allyOutline, 0.95);
      ctx.lineWidth = Math.max(1, T * 0.035);
      for (let k = 0; k < 6; k++) {
        const bx = x + T * (0.12 + k * 0.15);
        const sway = Math.sin(t * 5 + k + c.x) * T * 0.07;
        ctx.beginPath();
        ctx.moveTo(bx, y + T * 0.04);
        ctx.quadraticCurveTo(bx + sway, y - T * 0.1, bx + sway * 1.6, y - T * 0.24);
        ctx.stroke();
      }
    } else if (tier === 1) {
      // Goblet cells (every other one) bulge with mucus; the rest are the
      // middle of the columnar cells.
      roundRect(ctx, x + T * 0.03, y - T * 0.02, T * 0.94, T * 1.02, T * 0.2);
      ctx.fill(); ctx.stroke();
      if (c.x % 2 === 0) {
        ctx.fillStyle = withAlpha(pal.mucus, 0.95);
        ctx.beginPath(); ctx.ellipse(x + T * 0.5, y + T * 0.36, T * 0.3, T * 0.28, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = withAlpha(pal.allyNucleus, 0.55);
        ctx.beginPath(); ctx.ellipse(x + T * 0.5, y + T * 0.8, T * 0.16, T * 0.1, 0, 0, TAU); ctx.fill();
      } else {
        ctx.fillStyle = withAlpha(pal.allyNucleus, 0.45);
        ctx.beginPath(); ctx.ellipse(x + T * 0.5, y + T * 0.5, T * 0.14, T * 0.2, 0, 0, TAU); ctx.fill();
      }
    } else {
      // Basal cells: small, round, mostly nucleus, sitting on the membrane.
      roundRect(ctx, x + T * 0.03, y + T * 0.02, T * 0.94, T * 0.96, T * 0.2);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = withAlpha(pal.allyNucleus, 0.5);
      ctx.beginPath(); ctx.ellipse(x + T * 0.5, y + T * 0.55, T * 0.24, T * 0.26, 0, 0, TAU); ctx.fill();
    }
  }
}

/* ---- BONE (Broken bone) ---------------------------------------------------- */

function paintBone(g, env, rnd) {
  const { pal, T, w, h, map } = env;
  const boneTiles = map.tiles.filter((t) => t.ch === "X" || t.ch === "F");
  const bTop = Math.min(...boneTiles.map((t) => t.y)) * T;
  const bBot = (Math.max(...boneTiles.map((t) => t.y)) + 1) * T;

  // Muscle everywhere: fascicles of striated fibres running along the arm
  // (left to right, parallel to the bone), separated by pale perimysium.
  const mus = g.createLinearGradient(0, 0, w, h);
  mus.addColorStop(0, mix(pal.muscle, pal.muscleLight, 0.35));
  mus.addColorStop(1, mix(pal.muscle, pal.muscleDark, 0.3));
  g.fillStyle = mus;
  g.fillRect(0, 0, w, h);
  const fasc = T * 0.95;
  for (let y0 = -T * 0.3; y0 < h; y0 += fasc) {
    if (y0 + fasc > bTop - T * 0.35 && y0 < bBot + T * 0.35) continue;
    const phase = rnd() * 6;
    // Fibres: alternating light and dark striations inside the bundle.
    for (let k = 0; k < 7; k++) {
      const y = y0 + T * 0.12 + k * (fasc - T * 0.24) / 6;
      g.strokeStyle = withAlpha(k % 2 ? pal.muscleDark : pal.muscleLight, 0.3);
      g.lineWidth = Math.max(1, T * 0.05);
      wavyLine(g, -T, w + T, y, T * 0.03, 1.3 / T, phase, T / 3);
    }
    // Nuclei at the fibre edges.
    g.fillStyle = withAlpha(pal.allyNucleus, 0.3);
    for (let k = 0; k < 6; k++) {
      g.beginPath(); g.ellipse(rnd() * w, y0 + T * 0.1 + rnd() * (fasc - T * 0.2), T * 0.09, T * 0.035, 0, 0, TAU); g.fill();
    }
    // Perimysium between bundles.
    g.strokeStyle = withAlpha(pal.fascia, 0.75);
    g.lineWidth = Math.max(1.5, T * 0.07);
    wavyLine(g, -T, w + T, y0 + fasc, T * 0.04, 0.9 / T, phase, T / 3);
  }

  // Fascia hugging the bone, then the periosteum.
  g.fillStyle = withAlpha(pal.fascia, 0.85);
  g.fillRect(0, bTop - T * 0.3, w, T * 0.3);
  g.fillRect(0, bBot, w, T * 0.3);
  g.strokeStyle = withAlpha(pal.boneShade, 0.9);
  g.lineWidth = Math.max(2, T * 0.08);
  g.beginPath(); g.moveTo(0, bTop); g.lineTo(w, bTop); g.stroke();
  g.beginPath(); g.moveTo(0, bBot); g.lineTo(w, bBot); g.stroke();

  // Compact bone: two cortices with osteons (concentric rings around a canal).
  const cortex = T * 0.62;
  for (const [y0, y1] of [[bTop, bTop + cortex], [bBot - cortex, bBot]]) {
    const cg = g.createLinearGradient(0, y0, 0, y1);
    cg.addColorStop(0, mix(pal.bone, "#ffffff", 0.35));
    cg.addColorStop(1, pal.bone);
    g.fillStyle = cg;
    g.fillRect(0, y0, w, y1 - y0);
    for (let x = T * 0.3; x < w; x += T * 0.52) {
      const cx = x + rnd() * T * 0.1;
      const cy = (y0 + y1) / 2 + (rnd() - 0.5) * T * 0.1;
      g.strokeStyle = withAlpha(pal.boneShade, 0.7);
      g.lineWidth = 1;
      for (let r = T * 0.07; r < T * 0.24; r += T * 0.06) { g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.stroke(); }
      g.fillStyle = withAlpha(pal.rbc, 0.6);
      g.beginPath(); g.arc(cx, cy, T * 0.035, 0, TAU); g.fill();
    }
  }
  // The marrow cavity: yellow marrow with fat cells and specks of red marrow.
  const mg = g.createLinearGradient(0, bTop + cortex, 0, bBot - cortex);
  mg.addColorStop(0, mix(pal.marrow, pal.boneShade, 0.25));
  mg.addColorStop(0.3, pal.marrow);
  mg.addColorStop(1, mix(pal.marrow, pal.boneShade, 0.3));
  g.fillStyle = mg;
  g.fillRect(0, bTop + cortex, w, bBot - bTop - cortex * 2);
  for (let k = 0; k < 30; k++) {
    const x = rnd() * w;
    const y = bTop + cortex + T * 0.12 + rnd() * (bBot - bTop - cortex * 2 - T * 0.24);
    const r = T * (0.07 + rnd() * 0.1);
    g.fillStyle = withAlpha(pal.fat, 0.9);
    g.strokeStyle = withAlpha(pal.fatLine, 0.6);
    g.lineWidth = 1;
    g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill(); g.stroke();
    if (k % 4 === 0) { g.fillStyle = withAlpha(pal.rbc, 0.55); g.beginPath(); g.arc(x + r * 1.6, y + r * 0.4, T * 0.03, 0, TAU); g.fill(); }
  }
  // Spongy bone at the cortex edge: a little trabecular lace.
  g.strokeStyle = withAlpha(pal.boneShade, 0.6);
  g.lineWidth = 1;
  for (let k = 0; k < 20; k++) {
    const x = rnd() * w;
    const y = rnd() < 0.5 ? bTop + cortex + T * 0.02 : bBot - cortex - T * 0.02;
    const d = rnd() < 0.5 ? 1 : -1;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rnd() - 0.5) * T * 0.2, y + d * T * 0.12); g.stroke();
  }

  paintVessels(g, env, rnd);
  label(g, env, "Bone", T * 0.2, bTop + T * 0.35, withAlpha(pal.ink, 0.5));
  label(g, env, "Muscle", T * 0.2, T * 0.35, withAlpha("#ffffff", 0.75));
}

/* Per frame: the break — a jagged crack through both cortices and the
 * marrow, full of clotted blood — and the callus that swells around it and
 * fills it as Healing rises. */
export function drawFracture(ctx, env, state) {
  const { pal, T, map } = env;
  if (!map.fracture.length) return;
  const heal = state.healing / 100;
  const xs = map.fracture.map((f) => f.x);
  const ys = map.fracture.map((f) => f.y);
  const cx = ((Math.min(...xs) + Math.max(...xs) + 1) / 2) * T;
  const y0 = Math.min(...ys) * T;
  const y1 = (Math.max(...ys) + 1) * T;
  const cy = (y0 + y1) / 2;
  // The callus: a rounded swelling of new bone that envelops the break.
  if (heal > 0.02) {
    const k = Math.min(1, heal * 1.15);
    ctx.fillStyle = withAlpha(pal.callus, k);
    ctx.strokeStyle = withAlpha(pal.boneShade, k);
    ctx.lineWidth = Math.max(1.5, T * 0.06);
    ctx.beginPath();
    ctx.ellipse(cx, cy, T * (0.7 + 0.5 * k), (y1 - y0) / 2 + T * (0.15 + 0.3 * k), 0, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = withAlpha(pal.boneShade, 0.5 * k);
    for (let i = 0; i < 10; i++) {
      const a = i * 1.9;
      ctx.beginPath(); ctx.arc(cx + Math.cos(a) * T * 0.7 * k, cy + Math.sin(a) * T * 0.9 * k, T * 0.04, 0, TAU); ctx.fill();
    }
  }
  // The crack: a zigzag gap that closes as it knits.
  const gap = T * 0.3 * (1 - heal) + T * 0.03;
  ctx.beginPath();
  const zig = (f) => cx + Math.sin(f * 11) * T * 0.22 + (f - 0.5) * T * 0.2;
  ctx.moveTo(zig(0) - gap, y0 - T * 0.02);
  for (let k = 1; k <= 8; k++) { const f = k / 8; ctx.lineTo(zig(f) - gap, y0 + (y1 - y0) * f); }
  for (let k = 8; k >= 0; k--) { const f = k / 8; ctx.lineTo(zig(f) + gap, y0 + (y1 - y0) * f); }
  ctx.closePath();
  const hg = ctx.createLinearGradient(0, y0, 0, y1);
  hg.addColorStop(0, mix(pal.hematoma, "#ffffff", 0.1));
  hg.addColorStop(0.5, mix(pal.hematoma, pal.ink, 0.12));
  hg.addColorStop(1, mix(pal.hematoma, "#ffffff", 0.1));
  ctx.fillStyle = hg;
  ctx.fill();
  ctx.strokeStyle = withAlpha(pal.ink, 0.2 * (1 - heal) + 0.04);
  ctx.lineWidth = Math.max(1, T * 0.04);
  ctx.stroke();
}

/* ---- the generic scene, for a level that names none ------------------------ */

function paintGeneric(g, env, rnd) {
  const { pal, w, h } = env;
  const light = g.createLinearGradient(0, 0, w, h);
  light.addColorStop(0, mix(pal.tissue, "#ffffff", 0.18));
  light.addColorStop(1, mix(pal.tissue, pal.tissueShade, 0.55));
  g.fillStyle = light;
  g.fillRect(0, 0, w, h);
  faintCells(g, env, rnd, 100, [".", "K", "V", "O"]);
  paintBloodstream(g, env);
  paintVessels(g, env, rnd);
}

const PAINTERS = { skin: paintSkin, airway: paintAirway, bone: paintBone };

/* The static background, once per resize. */
export function paintScene(g, env) {
  const rnd = textureRandom(env.level.id);
  (PAINTERS[env.level.scene] || paintGeneric)(g, env, rnd);
  vignette(g, env);
}

/* The frame around the map: a darker take on the scene's own base. */
export function frameColor(env) {
  const { pal, level } = env;
  const base = level.scene === "bone" ? pal.muscleDark : level.scene === "skin" ? pal.skinDeep : pal.tissueShade;
  return mix(base, pal.ink, 0.12);
}
