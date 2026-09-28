/* ============================================================================
 * guide.js — the Field Guide's own words: the plain-English terms and what
 * each maps to in real biology (docs/DESIGN.md, "Terms").
 *
 * Cells and threats are NOT repeated here — the guide reads them straight
 * out of cells.js and threats.js, so a rename in one place reaches every
 * screen. This file only holds what exists nowhere else.
 *
 * Entries unlock the first time the player meets them (store.js `seen`,
 * keyed by these ids, which are therefore permanent). Each `line` is ten
 * words at most (test/unit/copy.test.mjs).
 * ========================================================================= */

export const TERMS = [
  {
    id: "term:signal", name: "Signal", realName: "Cytokines",
    line: "Chemical calls for help. Deploys cost it; it refills.",
  },
  {
    id: "term:host", name: "Host Health", realName: "How your person feels",
    line: "How your person feels. Leaks, bursts and storms lower it.",
  },
  {
    id: "term:hidden", name: "Hidden threats", realName: "Detection",
    line: "Threats stay a faint glow until a Scout is near.",
  },
  {
    id: "term:fingerprint", name: "Fingerprint", realName: "Antigen",
    line: "One invader's unique shape. Scouts carry it to train specialists.",
  },
  {
    id: "term:barracks", name: "Barracks", realName: "Lymph node",
    line: "Where specialists train against a Fingerprint. Takes days.",
  },
  {
    id: "term:veteran", name: "Veteran", realName: "Memory cell",
    line: "Specialists that stay behind. Next time, ready from the start.",
  },
  {
    id: "term:alarm", name: "Alarm", realName: "Inflammation",
    line: "Inflammation. Speeds Signal and repair; above 60 it damages.",
  },
  {
    id: "term:healing", name: "Healing", realName: "Tissue repair",
    line: "Repair after the threat clears. Debris and pus block it.",
  },
];

/* Which terms each level introduces. The guide unlocks them when the level is
 * first played, so the words are there the moment the HUD uses them. */
export const TERMS_BY_LEVEL = {
  "cut": ["term:signal", "term:host", "term:hidden", "term:healing"],
  "flu": ["term:fingerprint", "term:barracks", "term:veteran"],
  "broken-bone": ["term:alarm"],
};
