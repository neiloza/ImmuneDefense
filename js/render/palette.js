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
  bg: "#f9f6fc", ink: "#24172b", inkSoft: "#58465f", accent: "#5b3690",
  tissue: "#e9e2f4", tissueShade: "#d6cbeb", tissueInflamed: "#f2a6a0",
  skin: "#f4dcc8", skinDeep: "#e8c0a8", clot: "#e07b7b",
  vessel: "#e8887e", vesselDark: "#d46f6a", blood: "#f09a90", rbc: "#f8c0b6",
  airway: "#eaf2fb", lining: "#d8c8ee", liningDead: "#c9c3cf",
  bone: "#f6f0e2", boneShade: "#dcd2ba", hematoma: "#a78bd0", callus: "#efe6d0",
  node: "#b79ad6",
  epidermis: "#f1c9ae", corneum: "#f8e6d6", hair: "#8a6350", fat: "#fbf1d8", fatLine: "#eadfbf",
  mucus: "#e0ebf7", muscle: "#d8c4ea", muscleDark: "#c2a9dd", muscleLight: "#e9dcf5", fascia: "#f5eefb",
  cartilage: "#d3e3ea", cartilageDark: "#a9c2cd", marrow: "#f7e3c0", alveoli: "#e8def3",
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
