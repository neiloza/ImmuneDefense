/* ============================================================================
 * guide.js — the Field Guide's own words: the plain-English terms and what
 * each maps to in real biology (docs/DESIGN.md, "Terms").
 *
 * Cells and threats are NOT repeated here — the guide reads them straight
 * out of cells.js and threats.js, so a rename in one place reaches every
 * screen. This file only holds what exists nowhere else.
 *
 * Entries unlock the first time the player meets them (store.js `seen`,
 * keyed by these ids, which are therefore permanent).
 * ========================================================================= */

export const TERMS = [
  {
    id: "term:signal", name: "Signal", realName: "Cytokines",
    line: "The chemical messages that call cells in. Every cell you deploy costs Signal, and it refills over time.",
  },
  {
    id: "term:host", name: "Host Health", realName: "How your person feels",
    line: "Threats that reach the bloodstream, cells that burst, and runaway inflammation all make your person feel worse.",
  },
  {
    id: "term:hidden", name: "Hidden threats", realName: "Detection",
    line: "The body can't fight what it hasn't found. Threats stay a faint redness until a Scout is close enough to reveal them.",
  },
  {
    id: "term:fingerprint", name: "Fingerprint", realName: "Antigen",
    line: "The unique shape of one invader. A Scout samples it and carries it to the Barracks, which trains specialists against that one shape.",
  },
  {
    id: "term:barracks", name: "Barracks", realName: "Lymph node",
    line: "Where Scouts bring Fingerprints and specialists are trained. Training takes time — the real delay is several days.",
  },
  {
    id: "term:veteran", name: "Veteran", realName: "Memory cell",
    line: "Specialists that stay behind after a win. Next time the same invader shows up, the body is ready from the start — which is how vaccines work.",
  },
  {
    id: "term:alarm", name: "Alarm", realName: "Inflammation",
    line: "Swelling, heat and redness. It speeds up Signal and repair, but above 60 it damages the tissue, and at 100 it becomes a cytokine storm.",
  },
  {
    id: "term:healing", name: "Healing", realName: "Tissue repair",
    line: "Once the threat is cleared, the body rebuilds. Debris and pus in the way stop it; so does too much inflammation.",
  },
];

/* Which terms each level introduces. The guide unlocks them when the level is
 * first played, so the words are there the moment the HUD uses them. */
export const TERMS_BY_LEVEL = {
  "cut": ["term:signal", "term:host", "term:hidden", "term:healing"],
  "flu": ["term:fingerprint", "term:barracks", "term:veteran"],
  "broken-bone": ["term:alarm"],
};
