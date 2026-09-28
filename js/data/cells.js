/* ============================================================================
 * cells.js — the player's cells. Every number the simulation uses for them
 * lives here and nowhere else, so tuning never touches logic.
 *
 * Distances are in TILES (the map is 9 × 16 tiles), times in SECONDS, damage
 * per second as `dps`. The design doc's first-pass stats are the starting
 * point; where a value here differs, the doc is the claim and this is the
 * fact (see CLAUDE.md "Where the build departs from the design doc").
 *
 * Naming rule (docs/DESIGN.md, "Cast and naming"): the game name says the job
 * in one or two plain words, and the real name sits underneath it everywhere
 * the cell is shown. Both strings live here so the tray, the loadout screen
 * and the Field Guide can never disagree.
 *
 * The words, shortest first, because a player skims and a paragraph is not
 * read (all TEN WORDS AT MOST, enforced by test/unit/copy.test.mjs):
 *   verb + what   the headline everywhere — "Sees hidden bacteria" — with the
 *                 verb set in bold so the one thing the cell DOES is the one
 *                 thing the eye lands on
 *   how           how to use it, one line ("Tap it, then tap a target.")
 *   line          a fuller one-liner for the loadout and Field Guide tiles
 *   job / realJob the Field Guide entry, in the game and in real life
 *
 * `id`s are PERMANENT. Saves and loadouts point at them (house rule: store
 * decisions, never content). Rename a cell by changing `name`, never `id`.
 * ========================================================================= */

export const CELLS = {
  scout: {
    id: "scout",
    name: "Scout",
    realName: "Dendritic cell",
    kind: "sentry",
    cost: 3,
    hp: 110,
    radius: 0.34,          // body size, for drawing and for bacteria latching on
    holds: 2,              // bacteria it can hold off at once before the rest slip past
    sight: 3,              // hidden threats inside this radius are revealed
    sampleRange: 1.3,      // touching distance for taking a Fingerprint
    carrySpeed: 1.6,       // tiles/s while walking a Fingerprint to the Barracks
    targets: [],
    verb: "Sees",
    what: "hidden bacteria",
    how: "Place it near danger.",
    line: "Spots hidden threats nearby.",
    job: "Reveals hidden threats. Carries Fingerprints to the Barracks.",
    realJob: "Samples invaders and shows them to T cells.",
    goodAgainst: ["Hidden threats"],
  },

  devourer: {
    id: "devourer",
    name: "Devourer",
    realName: "Macrophage",
    kind: "sentry",
    cost: 4,
    hp: 300,
    radius: 0.46,
    holds: 3,
    reach: 1.15,           // engulfs anything this close, revealed or not
    eatEvery: 2.0,         // one small thing swallowed per this many seconds
    forage: 2.3,           // notices food this far from its post…
    leash: 1.4,            // …and creeps at most this far to reach it
    creepSpeed: 0.55,
    // What it can swallow. Infected airway cells are NOT here: the virus is
    // hidden inside a living cell of Billy's own, which is exactly why the
    // body needs Bounty Hunters (docs/DESIGN.md, Flu level).
    targets: ["bacterium", "virus", "debris", "pus"],
    verb: "Eats",
    what: "what comes close",
    how: "Place it. It stays put.",
    line: "Big, slow eater. Swallows what comes close.",
    job: "Eats bacteria, viruses, debris and pus near its post.",
    realJob: "Eats microbes and dead cells. Greek for “big eater”.",
    goodAgainst: ["Bacteria", "Debris", "Pus"],
  },

  siren: {
    id: "siren",
    name: "Siren",
    realName: "Mast cell",
    kind: "sentry",
    cost: 3,
    hp: 120,
    radius: 0.32,
    holds: 2,
    // A Siren adds this much to the Alarm for as long as it is alive. The
    // Alarm is a target-seeking meter (see ALARM in threats.js): a flat,
    // countable contribution is something a player can reason about — "each
    // Siren is worth about 12" — where a rate would not be.
    alarm: 12,
    targets: [],
    verb: "Raises",
    what: "the Alarm",
    how: "Place it. Retire it later.",
    line: "Raises the Alarm for faster Signal.",
    job: "Adds 12 Alarm while alive. Past 60, it hurts.",
    realJob: "Releases histamine, which drives inflammation and allergies.",
    goodAgainst: ["Slow Signal"],
  },

  rusher: {
    id: "rusher",
    name: "Rusher",
    realName: "Neutrophil",
    kind: "responder",
    cost: 2,
    squad: 3,              // one deploy sends this many
    hp: 40,
    radius: 0.22,
    holds: 2,
    dps: 12,
    speed: 2.5,
    reach: 0.55,
    sense: 1.0,            // notices unrevealed threats this close
    leash: 2.5,            // guards this far around where it was sent
    life: 20,              // seconds from deploy, then it dies…
    maxKills: 3,           // …or after this many kills, whichever is first
    leavesPus: true,       // every Rusher that dies becomes a blob of pus
    targets: ["bacterium", "virus", "debris"],
    verb: "Chases",
    what: "what you tap",
    how: "Tap it, then tap a target.",
    line: "Cheap squad you aim. Dies after a few kills.",
    job: "Three per deploy. Dies after 3 kills, leaving pus.",
    realJob: "First to arrive; dies fighting. Pus is dead neutrophils.",
    goodAgainst: ["Bacteria", "Free viruses", "Debris"],
  },

  hunter: {
    id: "hunter",
    name: "Bounty Hunter",
    realName: "Killer T cell",
    kind: "responder",
    cost: 4,
    squad: 1,
    hp: 80,
    radius: 0.28,
    holds: 2,
    dps: 22,
    speed: 1.3,
    reach: 0.6,
    sense: 1.6,            // recognises its target this close, revealed or not
    leash: 3,
    copyCap: 12,           // clonal copies per level, so the swarm stays readable
    // Locked until the Barracks has trained against this Fingerprint.
    needsFingerprint: "flu",
    targets: ["infected"],
    verb: "Hunts",
    what: "infected cells",
    how: "Tap it, then tap an infected cell.",
    line: "Aim at infected cells. Each kill makes a copy.",
    job: "Kills infected cells with its Fingerprint. Copies itself per kill.",
    realJob: "Kills infected cells showing its target, then multiplies.",
    goodAgainst: ["Infected cells"],
  },
};

/* Neutral cells the player never deploys. Kept here so the Field Guide and
 * the renderer read their names from one place. */
export const NEUTRALS = {
  builder: {
    id: "builder",
    name: "Bone Builder",
    realName: "Osteoblast",
    radius: 0.3,
    speed: 0.8,
    job: "Arrives once the break is clean. Lays new bone.",
    realJob: "Builds soft callus first, then hard bone.",
  },
};

export const CELL_ORDER = ["scout", "devourer", "rusher", "hunter", "siren"];

export function cellDef(id) {
  return CELLS[id] || null;
}
