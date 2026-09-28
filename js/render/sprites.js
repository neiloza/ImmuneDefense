/* ============================================================================
 * sprites.js — every cell and threat, drawn in code.
 *
 * Readability rules from docs/DESIGN.md (Art direction), which beat style
 * every time:
 *
 *   SILHOUETTE FIRST. Each thing has an outline you can name at 24 px in
 *   grayscale: Devourer = big blob with pseudopods; Rusher = small bean with
 *   a lobed nucleus; Scout = star with long arms; Siren = round with a
 *   granule halo; Bounty Hunter = spiky oval with one big eye; Bacterium =
 *   rod with a tail; Virus = spiked ball; Debris = shards; Pus = cream blob.
 *   If you change a shape, check it still reads in the loadout screen's
 *   32 px icons — that is where it will fail first.
 *
 *   FRIEND VS ENEMY BY COLOUR FAMILY. Your cells are pale with purple nuclei
 *   (hematoxylin); threats are acid green / yellow / orange. And never colour
 *   alone: every threat also has angry eyes or no face, every ally a friendly
 *   one.
 *
 * All functions take pixel coordinates and a pixel radius `r` (the def's
 * `radius` in tiles × the tile size). `t` is seconds, for idle motion.
 * Drawing is deterministic for a given (seed, t), so a replay looks the same.
 * ========================================================================= */

import { withAlpha } from "./palette.js";

const TAU = Math.PI * 2;

/* ---- shared bits -------------------------------------------------------- */

function eyes(ctx, x, y, size, gap, look = 0, angry = false, ink = "#24172b") {
  for (const side of [-1, 1]) {
    const ex = x + side * gap;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.ellipse(ex, y, size, size * 1.15, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = ink;
    ctx.beginPath();
    ctx.arc(ex + Math.cos(look) * size * 0.35, y + Math.sin(look) * size * 0.3, size * 0.55, 0, TAU);
    ctx.fill();
    if (angry) {
      ctx.strokeStyle = ink;
      ctx.lineWidth = Math.max(1, size * 0.45);
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(ex - size * 1.1, y - size * (side === -1 ? 1.7 : 1.1));
      ctx.lineTo(ex + size * 1.1, y - size * (side === -1 ? 1.1 : 1.7));
      ctx.stroke();
    }
  }
}

function blob(ctx, x, y, r, t, seed, lobes, depth, points = 28) {
  ctx.beginPath();
  for (let i = 0; i <= points; i++) {
    const a = (i / points) * TAU;
    const k = 1 +
      depth * Math.sin(lobes * a + t * 1.3 + seed * TAU) +
      depth * 0.4 * Math.sin(3 * a - t * 0.9 + seed * 3.1);
    const px = x + Math.cos(a) * r * k;
    const py = y + Math.sin(a) * r * k;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

function outlineFill(ctx, fill, stroke, width) {
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = width;
  ctx.stroke();
}

/* ---- your cells ----------------------------------------------------------- */

export function drawDevourer(ctx, pal, x, y, r, t, seed, o = {}) {
  blob(ctx, x, y, r, t, seed, 5, 0.12);
  outlineFill(ctx, pal.allyBody, pal.allyOutline, Math.max(1, r * 0.09));
  // Swallowed bits, so a Devourer that has been eating looks it.
  const bits = Math.min(4, o.kills || 0);
  ctx.fillStyle = withAlpha(pal.debris, 0.55);
  for (let k = 0; k < bits; k++) {
    const a = seed * 9 + k * 1.9 + t * 0.2;
    ctx.beginPath();
    ctx.arc(x + Math.cos(a) * r * 0.5, y + Math.sin(a) * r * 0.45 + r * 0.15, r * 0.09, 0, TAU);
    ctx.fill();
  }
  // Kidney-shaped nucleus.
  ctx.fillStyle = pal.allyNucleus;
  ctx.beginPath();
  ctx.ellipse(x - r * 0.28, y + r * 0.26, r * 0.32, r * 0.2, -0.5, 0, TAU);
  ctx.fill();
  eyes(ctx, x + r * 0.08, y - r * 0.18, r * 0.13, r * 0.24, o.look ?? Math.PI / 2);
}

export function drawRusher(ctx, pal, x, y, r, t, seed, o = {}) {
  const h = o.heading ?? 0;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(h);
  ctx.beginPath();
  ctx.ellipse(0, 0, r * 1.12, r * 0.9, 0, 0, TAU);
  outlineFill(ctx, pal.allyBody, pal.allyOutline, Math.max(1, r * 0.12));
  // The lobed nucleus is the neutrophil's signature: three beads on a string.
  ctx.fillStyle = pal.allyNucleus;
  for (let k = 0; k < 3; k++) {
    ctx.beginPath();
    ctx.arc(-r * 0.45 + k * r * 0.3, r * 0.22 + Math.sin(k * 2 + seed * 5) * r * 0.1, r * 0.2, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
  eyes(ctx, x + Math.cos(h) * r * 0.25, y + Math.sin(h) * r * 0.25 - r * 0.2, r * 0.2, r * 0.3, h);
}

export function drawScout(ctx, pal, x, y, r, t, seed, o = {}) {
  // Long waving arms (dendrites) first, body on top.
  ctx.strokeStyle = pal.allyOutline;
  ctx.lineCap = "round";
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * TAU - Math.PI / 2 + Math.sin(t * 0.9 + k * 1.7 + seed * 4) * 0.18;
    const bend = Math.sin(t * 1.2 + k) * 0.35;
    const x1 = x + Math.cos(a) * r * 0.9;
    const y1 = y + Math.sin(a) * r * 0.9;
    const x2 = x + Math.cos(a + bend * 0.4) * r * 1.75;
    const y2 = y + Math.sin(a + bend * 0.4) * r * 1.75;
    ctx.lineWidth = Math.max(1.5, r * 0.34);
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x1, y1); ctx.stroke();
    ctx.lineWidth = Math.max(1, r * 0.18);
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  }
  ctx.fillStyle = pal.allyBody;
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * TAU - Math.PI / 2 + Math.sin(t * 0.9 + k * 1.7 + seed * 4) * 0.18;
    ctx.beginPath();
    ctx.arc(x + Math.cos(a) * r * 0.8, y + Math.sin(a) * r * 0.8, Math.max(1, r * 0.13), 0, TAU);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(x, y, r * 0.78, 0, TAU);
  outlineFill(ctx, pal.allyBody, pal.allyOutline, Math.max(1, r * 0.1));
  ctx.fillStyle = pal.allyNucleus;
  ctx.beginPath();
  ctx.ellipse(x, y + r * 0.34, r * 0.34, r * 0.18, 0, 0, TAU);
  ctx.fill();
  // Big eyes: it is a lookout.
  eyes(ctx, x, y - r * 0.08, r * 0.2, r * 0.27, o.look ?? Math.PI / 2);
  if (o.carrying) drawFingerprint(ctx, pal, x, y - r * 1.55, r * 0.55);
}

export function drawSiren(ctx, pal, x, y, r, t, seed) {
  // Granule halo, slowly turning.
  ctx.fillStyle = withAlpha(pal.allyNucleus, 0.75);
  for (let k = 0; k < 9; k++) {
    const a = (k / 9) * TAU + t * 0.4 + seed;
    ctx.beginPath();
    ctx.arc(x + Math.cos(a) * r * 1.32, y + Math.sin(a) * r * 1.32, Math.max(1, r * 0.11), 0, TAU);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  outlineFill(ctx, pal.allyBody, pal.allyOutline, Math.max(1, r * 0.1));
  // Packed with granules (histamine).
  ctx.fillStyle = pal.allyNucleus;
  for (let k = 0; k < 8; k++) {
    const a = k * 2.4 + seed * 7;
    const d = r * (0.35 + 0.25 * ((k * 37) % 7) / 7);
    ctx.beginPath();
    ctx.arc(x + Math.cos(a) * d, y + Math.sin(a) * d * 0.8 + r * 0.15, Math.max(1, r * 0.09), 0, TAU);
    ctx.fill();
  }
  eyes(ctx, x, y - r * 0.28, r * 0.17, r * 0.26, Math.PI / 2);
}

export function drawHunter(ctx, pal, x, y, r, t, seed, o = {}) {
  const spikes = 12;
  ctx.beginPath();
  for (let i = 0; i <= spikes * 2; i++) {
    const a = (i / (spikes * 2)) * TAU + t * 0.25 + seed;
    const k = i % 2 === 0 ? 1.22 : 0.98;
    const px = x + Math.cos(a) * r * k * 1.08;
    const py = y + Math.sin(a) * r * k * 0.94;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
  outlineFill(ctx, pal.allyBody, pal.allyOutline, Math.max(1, r * 0.1));
  // A lymphocyte is mostly nucleus — and this one has a single big eye in it.
  ctx.fillStyle = pal.allyNucleus;
  ctx.beginPath();
  ctx.arc(x, y + r * 0.05, r * 0.62, 0, TAU);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.ellipse(x, y, r * 0.38, r * 0.34, 0, 0, TAU);
  ctx.fill();
  const look = o.heading ?? Math.PI / 2;
  ctx.fillStyle = "#24172b";
  ctx.beginPath();
  ctx.arc(x + Math.cos(look) * r * 0.12, y + Math.sin(look) * r * 0.1, r * 0.18, 0, TAU);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(x + r * 0.08, y - r * 0.08, r * 0.06, 0, TAU);
  ctx.fill();
}

export function drawBuilder(ctx, pal, x, y, r, t, seed, o = {}) {
  const bob = o.working ? Math.sin(t * 6 + seed * 5) * r * 0.08 : 0;
  const yy = y + bob;
  roundRect(ctx, x - r, yy - r * 0.85, r * 2, r * 1.8, r * 0.45);
  outlineFill(ctx, pal.builder, pal.boneShade, Math.max(1, r * 0.1));
  ctx.fillStyle = pal.allyNucleus;
  ctx.beginPath();
  ctx.arc(x - r * 0.35, yy + r * 0.35, r * 0.22, 0, TAU);
  ctx.fill();
  eyes(ctx, x + r * 0.05, yy - r * 0.05, r * 0.16, r * 0.26, Math.PI / 2);
  // Hard hat. It is a builder.
  ctx.fillStyle = "#f2c230";
  ctx.beginPath();
  ctx.arc(x, yy - r * 0.8, r * 0.62, Math.PI, 0);
  ctx.fill();
  ctx.fillRect(x - r * 0.85, yy - r * 0.84, r * 1.7, r * 0.16);
}

/* ---- threats -------------------------------------------------------------- */

export function drawBacterium(ctx, pal, x, y, r, t, seed, o = {}) {
  const h = o.heading ?? Math.PI / 2;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(h);
  // Tail (flagellum) behind it, whipping.
  ctx.strokeStyle = pal.enemyDark;
  ctx.lineWidth = Math.max(1, r * 0.16);
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-r * 1.1, 0);
  for (let k = 1; k <= 6; k++) {
    ctx.lineTo(-r * 1.1 - k * r * 0.28, Math.sin(t * 12 + k * 1.3 + seed * 6) * r * 0.32);
  }
  ctx.stroke();
  roundRect(ctx, -r * 1.2, -r * 0.62, r * 2.4, r * 1.24, r * 0.62);
  outlineFill(ctx, pal.enemy, pal.enemyDark, Math.max(1, r * 0.14));
  ctx.restore();
  eyes(ctx, x + Math.cos(h) * r * 0.45, y + Math.sin(h) * r * 0.45 - r * 0.12, r * 0.22, r * 0.28, h, true);
}

export function drawVirus(ctx, pal, x, y, r, t, seed) {
  const spin = t * 0.8 + seed * TAU;
  ctx.strokeStyle = pal.enemyAltDark;
  ctx.lineWidth = Math.max(1, r * 0.2);
  ctx.fillStyle = pal.enemyAltDark;
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * TAU + spin;
    const x1 = x + Math.cos(a) * r;
    const y1 = y + Math.sin(a) * r;
    const x2 = x + Math.cos(a) * r * 1.55;
    const y2 = y + Math.sin(a) * r * 1.55;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.beginPath(); ctx.arc(x2, y2, Math.max(1, r * 0.24), 0, TAU); ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  outlineFill(ctx, pal.enemyAlt, pal.enemyAltDark, Math.max(1, r * 0.18));
  if (r >= 7) eyes(ctx, x, y - r * 0.05, r * 0.22, r * 0.3, Math.PI / 2, true);
}

/* An infected airway cell: the tile itself goes sickly and the virus shows
 * through, pulsing faster as it nears bursting (`p` = 0…1 of the timer). */
export function drawInfected(ctx, pal, x, y, size, t, seed, p = 0) {
  const pulse = 0.5 + 0.5 * Math.sin(t * (4 + p * 10) + seed * 6);
  roundRect(ctx, x - size * 0.46, y - size * 0.46, size * 0.92, size * 0.92, size * 0.2);
  ctx.fillStyle = withAlpha(pal.enemy, 0.55 + 0.25 * pulse * p);
  ctx.fill();
  ctx.strokeStyle = pal.enemyDark;
  ctx.lineWidth = Math.max(1, size * 0.05);
  ctx.stroke();
  const n = 2 + Math.floor(p * 3);
  for (let k = 0; k < n; k++) {
    const a = k * 2.3 + seed * 5 + t * 0.5;
    drawVirus(ctx, pal, x + Math.cos(a) * size * 0.2, y + Math.sin(a) * size * 0.18, size * 0.09, t, seed + k);
  }
}

export function drawDebris(ctx, pal, x, y, r, t, seed) {
  ctx.fillStyle = pal.debris;
  ctx.strokeStyle = withAlpha("#3b2a20", 0.45);
  ctx.lineWidth = Math.max(1, r * 0.1);
  for (let k = 0; k < 3; k++) {
    const a0 = seed * 11 + k * 2.1;
    const cx = x + Math.cos(a0) * r * 0.45;
    const cy = y + Math.sin(a0) * r * 0.4;
    const s = r * (0.55 - k * 0.1);
    ctx.beginPath();
    for (let v = 0; v < 5; v++) {
      const a = a0 + (v / 5) * TAU;
      const d = s * (0.7 + 0.5 * (((seed * 97 + k * 13 + v * 7) % 10) / 10));
      const px = cx + Math.cos(a) * d;
      const py = cy + Math.sin(a) * d;
      if (v === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
}

export function drawPus(ctx, pal, x, y, r, t, seed) {
  blob(ctx, x, y, r, t * 0.3, seed, 4, 0.1, 20);
  outlineFill(ctx, pal.pus, withAlpha(pal.enemyAltDark, 0.5), Math.max(1, r * 0.08));
  ctx.fillStyle = withAlpha(pal.allyNucleus, 0.45);
  for (let k = 0; k < 3; k++) {
    const a = seed * 13 + k * 2.2;
    ctx.beginPath();
    ctx.arc(x + Math.cos(a) * r * 0.42, y + Math.sin(a) * r * 0.36, Math.max(1, r * 0.13), 0, TAU);
    ctx.fill();
  }
}

/* A carried Fingerprint: a little whorl. Also the Barracks' training icon. */
export function drawFingerprint(ctx, pal, x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.strokeStyle = pal.accent;
  ctx.lineWidth = Math.max(1, r * 0.13);
  for (let k = 1; k <= 3; k++) {
    ctx.beginPath();
    ctx.arc(x, y + r * 0.1, r * 0.22 * k, Math.PI * 1.1, Math.PI * 1.9 + k * 0.2);
    ctx.stroke();
  }
}

/* ---- dispatch ------------------------------------------------------------- */

const DRAW = {
  devourer: drawDevourer,
  rusher: drawRusher,
  scout: drawScout,
  siren: drawSiren,
  hunter: drawHunter,
  builder: drawBuilder,
  bacterium: drawBacterium,
  virus: drawVirus,
  debris: drawDebris,
  pus: drawPus,
};

export function drawThing(ctx, pal, type, x, y, r, t, seed, o) {
  const fn = DRAW[type];
  if (fn) fn(ctx, pal, x, y, r, t, seed, o);
}

/* Draw one thing centred in a small canvas, for the tray, the loadout screen
 * and the Field Guide. Same functions as the map, so they cannot disagree. */
export function drawIcon(canvas, pal, type, { t = 0.6, scale = 1 } = {}) {
  const dpr = Math.min(2, (typeof window !== "undefined" && window.devicePixelRatio) || 1);
  const w = canvas.clientWidth || canvas.width || 40;
  const h = canvas.clientHeight || canvas.height || 40;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const s = Math.min(w, h);
  // Per-shape fit: arms and halos need room outside the body radius.
  const fit = { scout: 0.26, siren: 0.3, devourer: 0.36, bacterium: 0.24, virus: 0.26, builder: 0.34, hunter: 0.34 }[type] ?? 0.34;
  if (type === "infected") {
    drawInfected(ctx, pal, w / 2, h / 2, s * 0.9 * scale, t, 0.3, 0.6);
    return;
  }
  drawThing(ctx, pal, type, w / 2, h / 2, s * fit * scale, t, 0.3,
    { heading: type === "bacterium" ? -0.35 : 0, look: Math.PI / 2 });
}

export function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}
