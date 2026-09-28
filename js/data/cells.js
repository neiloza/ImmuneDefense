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
    line: "Reveals hidden threats nearby and alerts you.",
    job: "Finds threats. Only a Scout can carry a Fingerprint to the Barracks.",
    realJob: "Samples invaders and carries them to a lymph node to show the T cells.",
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
    line: "Big stationary eater. Swallows whatever comes close.",
    job: "Engulfs bacteria, free viruses, debris and pus that come near its post.",
    realJob: "Engulfs microbes and dead cells. “Macrophage” is Greek for “big eater”.",
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
    line: "Raises the Alarm, which calls in help faster.",
    job: "Adds to the Alarm while it lives. More Alarm, more Signal — and more damage past 60.",
    realJob: "Releases histamine that drives inflammation — and allergies.",
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
    line: "Cheap, fast attacker you aim at threats. Dies after a few kills.",
    job: "Sent in threes to whatever you tap. Dies after 3 kills or 20 seconds — and leaves pus.",
    realJob: "The first cells to arrive; they die in the fight. Pus is mostly dead neutrophils.",
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
    line: "Aimed at infected cells. Each kill makes a copy.",
    job: "Kills only infected cells carrying its Fingerprint, and copies itself on every kill.",
    realJob: "Kills infected cells showing its one target, and multiplies when it finds it.",
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
    job: "Arrives on its own once the break is cleaned up, and lays down new bone.",
    realJob: "Builds new bone — first a soft callus bridging the break, then hard bone.",
  },
};

export const CELL_ORDER = ["scout", "devourer", "rusher", "hunter", "siren"];

export function cellDef(id) {
  return CELLS[id] || null;
}
