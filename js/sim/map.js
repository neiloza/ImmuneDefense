/* ============================================================================
 * map.js — turns a level's 9 × 16 character grid into something the sim and
 * the renderer can ask questions of. Legend: js/data/levels.js.
 *
 * Coordinates are in TILES with (0,0) at the top-left corner of the map, so
 * the centre of tile (tx, ty) is (tx + 0.5, ty + 0.5).
 * ========================================================================= */

export const MAP_W = 9;
export const MAP_H = 16;

/* Tiles a Sentry may sit on. Everything else — skin, vessels, bone, the
 * airway lining, the goal — is terrain. */
const PLACEABLE = new Set([".", ":"]);

export function parseMap(rows) {
  if (!Array.isArray(rows) || rows.length !== MAP_H || rows.some((r) => r.length !== MAP_W)) {
    throw new Error(`map must be ${MAP_H} rows of ${MAP_W} characters`);
  }
  const tiles = [];
  const byChar = {};
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const ch = rows[y][x];
      const tile = { i: y * MAP_W + x, x, y, ch };
      tiles.push(tile);
      (byChar[ch] || (byChar[ch] = [])).push(tile);
    }
  }
  const of = (ch) => byChar[ch] || [];
  const goal = of("B");
  const lining = of("A");
  return {
    rows,
    tiles,
    openings: of("O").map((t) => ({ x: t.x + 0.5, y: t.y + 0.5 })),
    wound: of("W"),
    lining,
    liningTop: lining.length ? Math.min(...lining.map((t) => t.y)) : null,
    fracture: of("F"),
    bone: of("X"),
    barracks: of("K"),
    goal,
    // A threat is "through" once it crosses the top edge of the goal band.
    goalY: goal.length ? Math.min(...goal.map((t) => t.y)) : null,
  };
}

export function charAt(map, x, y) {
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) return null;
  return map.rows[ty][tx];
}

export function isPlaceableTile(map, x, y) {
  return PLACEABLE.has(charAt(map, x, y));
}

export function tileIndex(x, y) {
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) return -1;
  return ty * MAP_W + tx;
}

export function clampToMap(x, y, margin = 0.15) {
  return [
    Math.min(MAP_W - margin, Math.max(margin, x)),
    Math.min(MAP_H - margin, Math.max(margin, y)),
  ];
}

/* Centre of the fracture (Broken bone), or null. */
export function fractureCentre(map) {
  if (!map.fracture.length) return null;
  const xs = map.fracture.map((t) => t.x + 0.5);
  const ys = map.fracture.map((t) => t.y + 0.5);
  return {
    x: xs.reduce((a, b) => a + b, 0) / xs.length,
    y: ys.reduce((a, b) => a + b, 0) / ys.length,
  };
}
