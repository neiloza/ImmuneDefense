/* ============================================================================
 * threats.js — what attacks the body, plus the rules of the meters (Signal,
 * Alarm, Host Health). Every number the simulation uses lives here.
 *
 * Units: TILES and SECONDS, as in cells.js. `line` and `realJob` are ten
 * words at most (test/unit/copy.test.mjs).
 * ========================================================================= */

export const THREATS = {
  bacterium: {
    id: "bacterium",
    name: "Bacterium",
    hp: 30,
    radius: 0.2,
    speed: 0.55,           // tiles/s toward its goal
    hostDamage: 5,         // Host Health lost when one reaches the goal
    splitAfter: 8,         // seconds alive before it divides in two…
    maxGen: 2,             // …but a bacterium this many splits deep stops
    bite: 5,               // damage per second to a cell it has latched onto
    latchRange: 0.62,      // it grabs any of your cells this close — unless
                           // that cell is already holding off its `holds`
                           // (cells.js), in which case it slips past
    hidden: true,          // invisible until a Scout reveals it
    line: "Splits in two if not killed fast.",
    realJob: "Divides every 20 minutes in warm, wet tissue.",
  },

  virus: {
    id: "virus",
    name: "Flu virus",
    hp: 10,
    radius: 0.13,
    speed: 0.75,
    life: 16,              // a free virus that finds no cell falls apart
    infectRange: 0.5,
    hidden: true,
    line: "Slips inside airway cells, out of reach.",
    realJob: "Can't copy itself; it hijacks a living cell.",
  },

  infected: {
    id: "infected",
    name: "Infected airway cell",
    hp: 60,
    radius: 0.42,
    burstAfter: 15,        // seconds until it bursts…
    burstCount: 3,         // …releasing this many new viruses…
    hostDamage: 3,         // …and costing this much Host Health
    hidden: true,
    line: "Your own cell, hijacked. Only Bounty Hunters stop it.",
    realJob: "Becomes a virus factory, then bursts.",
  },

  debris: {
    id: "debris",
    name: "Debris",
    hp: 20,
    radius: 0.2,
    alarm: 3,              // Alarm added per piece lying around (danger signals)
    hidden: false,         // damage, not an invader — always visible
    line: "Dead bits. Raises the Alarm, blocks healing.",
    realJob: "Dying cells release danger signals that start inflammation.",
  },

  pus: {
    id: "pus",
    name: "Pus",
    hp: 20,
    radius: 0.26,
    alarm: 2,
    decayAfter: 45,        // drains away on its own eventually
    hidden: false,
    line: "Dead Rushers. Blocks healing until eaten.",
    realJob: "Mostly dead neutrophils. Macrophages clear it.",
  },
};

/* Host Health — how your person is feeling. */
export const HOST = {
  max: 100,
  // Stars for what is left at the end (docs/DESIGN.md, Shared rules).
  stars: [
    { min: 80, stars: 3 },
    { min: 50, stars: 2 },
    { min: 0.001, stars: 1 },
  ],
};

/* Signal — the energy every deploy costs. */
export const SIGNAL = {
  max: 10,
  start: 10,
  perSecond: 0.5,          // 1 every 2 s, multiplied by (1 + Alarm/100) when the Alarm exists
};

/* The Alarm (inflammation), from the Broken bone level on.
 *
 * It is a TARGET-SEEKING meter, not an accumulator: the target is the sum of
 * what is raising it right now (each Siren, each piece of debris or pus), and
 * the meter moves toward that target. The design doc's first draft had it
 * accumulate per enemy-second, which made its level depend on history the
 * player cannot see. A target the player can count — "two Sirens and five
 * pieces of debris is about 34" — is a decision; a hidden integral is not.
 */
export const ALARM = {
  riseRate: 10,            // points/s toward a higher target (danger signals are fast…)
  fallRate: 3,             // …points/s toward a lower one (inflammation lingers)
  healLow: 20,             // below this, healing runs at half speed
  healHigh: 60,            // above this, healing stops AND the tissue is damaged
  damagePer10Over: 1,      // Host Health/s for every 10 points above healHigh
  storm: {
    at: 100,               // a cytokine storm hits when the meter reaches this
    seconds: 5,
    hostPerSecond: 2,      // what the storm costs your person
    cellsPerSecond: 15,    // and every one of your cells
    resetTo: 50,           // where the meter lands afterwards
  },
};

/* Healing bars (Cut's wound, Broken bone's fracture). Rates live on the level. */
export const HEALING = {
  lowBandFactor: 0.5,      // speed multiplier below ALARM.healLow
};
