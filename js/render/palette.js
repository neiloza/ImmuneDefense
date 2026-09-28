/* ============================================================================
 * palette.js — the canvas's colours, read out of css/tokens.css.
 *
 * One source of truth: the HTML and the canvas both take their colours from
 * the CSS custom properties, so retheming is still "edit tokens.css" and the
 * tray's cell icons can never disagree with the cells on the map. The
 * fallbacks below only matter where there is no document (the unit tests
 * import the renderer's pure helpers under Node) — keep them equal to
 * tokens.css anyway, so a missing token degrades to the right colour.
 * ========================================================================= */

const FALLBACK = {
  bg: "#fbf3f2", ink: "#24172b", inkSoft: "#58465f", accent: "#5b3690",
  tissue: "#f4dcdc", tissueShade: "#ebc9ca", tissueInflamed: "#f0a3a0",
  skin: "#f2cdbc", skinDeep: "#e5b3a0", clot: "#d9707a",
  vessel: "#e07a8a", vesselDark: "#c9667a", blood: "#ea8f9c", rbc: "#f6b6bf",
  airway: "#eef1f6", lining: "#e7c2d2", liningDead: "#c9b7ba",
  bone: "#f3ecda", boneShade: "#d8ccb0", hematoma: "#c98090", callus: "#ece1c8",
  node: "#b79ad6",
  epidermis: "#edc2ad", corneum: "#f6dfd0", hair: "#8a6350", fat: "#f9edd6", fatLine: "#e9d9b6",
  mucus: "#e3ecf5", muscle: "#f0b3a9", muscleDark: "#dc9490", muscleLight: "#f8d0c7", fascia: "#f8ece6",
  cartilage: "#cfdbe0", cartilageDark: "#9db2bd", marrow: "#f3dcae", alveoli: "#f0c9cb",
  allyBody: "#fbf7ff", allyOutline: "#b9a2d6", allyNucleus: "#6b3fa0", builder: "#ead7ad",
  enemy: "#9bcb3b", enemyDark: "#5a7d1c", enemyAlt: "#e0a526", enemyAltDark: "#9a6a0e",
  debris: "#d8cab6", pus: "#f4ecc8",
  signal: "#3a7bd5", alarm: "#d6453d", heal: "#3f9a6b", good: "#2c6349", bad: "#9a2e36",
};

/* camelCase key -> --kebab-case token. */
function tokenName(key) {
  return "--" + key.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());
}

export function readPalette() {
  const out = { ...FALLBACK };
  if (typeof document === "undefined" || typeof getComputedStyle === "undefined") return out;
  const css = getComputedStyle(document.documentElement);
  for (const key of Object.keys(FALLBACK)) {
    const v = css.getPropertyValue(tokenName(key)).trim();
    if (v) out[key] = v;
  }
  return out;
}

/* Mix two #rrggbb colours; t = 0 gives a, t = 1 gives b. */
export function mix(a, b, t) {
  const pa = parse(a);
  const pb = parse(b);
  const k = Math.max(0, Math.min(1, t));
  const c = pa.map((v, i) => Math.round(v + (pb[i] - v) * k));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

export function withAlpha(hex, alpha) {
  const [r, g, b] = parse(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function parse(color) {
  const s = String(color).trim();
  if (s.startsWith("#") && s.length === 7) {
    return [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));
  }
  if (s.startsWith("#") && s.length === 4) {
    return [1, 2, 3].map((i) => parseInt(s[i] + s[i], 16));
  }
  const m = /rgba?\(([^)]+)\)/.exec(s);
  if (m) return m[1].split(",").slice(0, 3).map((v) => parseFloat(v));
  return [0, 0, 0];
}
