/* ============================================================================
 * levels.js — the three slice levels (Cut, Flu, Broken bone) and the life map
 * around them.
 *
 * A level plays one illness or injury from start to finish, and each PHASE is
 * one stage of the real response (docs/DESIGN.md, "Waves are the phases of
 * the illness"). The phase copy is educational content, so it is written to
 * be read by a ten-year-old and checked by a doctor: `fact` is what just
 * happened in the body (shown after the phase), `hint` is what to do now
 * (shown as the phase starts), `recap` is one line for the end screen, where
 * the player sees the whole arc retold.
 *
 * TEN WORDS, HARD LIMIT. Every string a player reads here — intro, teaches,
 * coach text, hint, fact, recap, lose tip — is at most ten words, and
 * test/unit/copy.test.mjs fails on the eleventh. People skim game cards; a
 * fact that needs a paragraph is a fact for the Field Guide, not a card.
 *
 * `icon` names a sprite (js/render/sprites.js) that stands for the level or
 * the phase on cards and on the life map, so a card can show instead of tell.
 * `scene` picks how the map is painted (js/render/scenes.js): the level looks
 * like the tissue it defends — skin, airway, bone — not like a grid.
 *
 * IDs ARE PERMANENT. Progress is saved against level ids and phase ids.
 *
 * ---- Map legend (9 columns × 16 rows, row 0 at the top) --------------------
 *   .  tissue — open, Sentries can be placed here
 *   :  airway space (Flu) — open, Sentries can be placed here
 *   S  skin             W  wound (bacteria get in here)
 *   V  blood vessel     O  vessel opening (Responders arrive here)
 *   B  bloodstream / deeper tissue — the goal; a threat that reaches it
 *                        costs Host Health
 *   A  airway lining cell (Flu) — what the virus infects
 *   K  Barracks (a lymph node)
 *   X  bone             F  fracture
 * Only `.` and `:` accept a Sentry. Nothing blocks movement: cells squeeze
 * through tissue, so every unit moves in straight lines.
 *
 * ---- Spawn `where` vocabulary ----------------------------------------------
 *   wound      a random point in the W tiles
 *   top        a random point along the top edge
 *   fracture   a random point near the F tiles
 *   bone       a random point along the X tiles
 *   pus        inside a random blob of pus (falls back to the wound)
 *   deadTiles  a random dead airway cell (falls back to the lining)
 *
 * ---- Coaching --------------------------------------------------------------
 *   A level's `coach` is a list of steps shown one at a time (js/battle.js).
 *   when: "calm" | "phase:<id>" | "event:<type>"   when the step can show
 *   done: { placed | deployed(+count) | phase | seconds | trainingStarted |
 *           trained | ok }   what completes it; `ok` shows a "Got it" button
 *   hold: true      the clock stops while this step is up (tutorials only —
 *                   the bots never see the coach, so this is UI-side)
 *   unlock: cellId  the toolbar shows this cell only from this step on
 *   expires: "phase:<id>"  an event step is skipped once this phase starts
 *   cell: cellId    the toolbar card to pulse;  at: [x, y]  a ring to tap
 *   text            ten words; *stars* mark the word to highlight
 *   A level with `tutorial: true` skips the loadout screen on first play.
 *
 * ---- Optional phase behaviour ------------------------------------------------
 *   trickle: {type, every, where, until?}  one more threat every `every`
 *            seconds for the whole phase — or, with `until` (a Fingerprint
 *            id), only while that Fingerprint is untrained
 *   regrow: s      dead airway cells grow back after this many seconds
 *   healing        the level's Healing bar can fill during this phase
 *   builders       Bone Builders walk in and work the fracture
 *
 * ---- Phase end conditions (ALL listed must hold) ----------------------------
 *   after: s         at least this long since the phase started
 *   spawnsDone       every spawn scheduled for the phase has happened
 *   cleared: [types] none of these threat types are left on the map
 *   trained: id      the Barracks has finished training this Fingerprint
 *   healed: pct      the Healing bar has reached this
 * ========================================================================= */

export const LEVELS = [
  {
    id: "cut",
    stage: "childhood",
    age: 6,
    title: "Cut",
    icon: "bacterium",
    scene: "skin",
    threatKind: "Outside injury",
    intro: "{name}, age 6, cuts a knee falling off a bike.",
    teaches: "Find the threat first, then send the right cells.",
    slots: 3,
    newCells: ["scout", "devourer", "rusher"],
    requiredCells: [],
    alarm: false,
    calm: 15,
    map: [
      "SSSWWWSSS",
      "SSSWWWSSS",
      "V........",
      "V........",
      "O........",
      "V........",
      "V........",
      "V........",
      "O........",
      "V........",
      "V........",
      "V........",
      "O........",
      "V........",
      "V........",
      "BBBBBBBBB",
    ],
    goalLabel: "Bloodstream",
    // The wound heals in the last phase: the bar fills while no bacterium or
    // pus is within `radius` of the wound.
    healing: { x: 4.5, y: 1.4, radius: 2.2, rate: 2.5, blockers: ["bacterium", "pus"], label: "Wound" },
    barracks: null,
    // The tutorial. One cell at a time: a step with `hold` freezes the clock
    // until it is done, so nothing happens on the map while the player reads;
    // `unlock` puts the next cell in the toolbar only when the coach reaches
    // it; `done: { ok: true }` waits for a "Got it" tap. A cell is introduced
    // (what it does), placed (how to use it), then watched working before
    // the next one appears.
    tutorial: true,
    coach: [
      { id: "meet-scout", when: "calm", hold: true, unlock: "scout", cell: "scout",
        text: "This is a *Scout*. It finds hidden bacteria.",
        done: { ok: true } },
      { id: "place-scout", when: "calm", hold: true, cell: "scout", at: [4.5, 4.5],
        text: "Tap *Scout*, then tap the *ring*.",
        done: { placed: "scout" } },
      { id: "meet-devourer", when: "calm", hold: true, unlock: "devourer", cell: "devourer",
        text: "Scouts only *look*. A *Devourer* eats.",
        done: { ok: true } },
      { id: "place-devourer", when: "calm", hold: true, cell: "devourer", at: [4.5, 3.5],
        text: "Tap *Devourer*, then tap the ring by the wound.",
        done: { placed: "devourer" } },
      { id: "wait", when: "calm",
        text: "Bacteria are coming. Tap *Start* when ready.",
        done: { phase: "breach" } },
      { id: "spotted", when: "event:ping", hold: true, expires: "phase:rush",
        text: "Spotted! The Devourer eats what comes *close*.",
        done: { ok: true } },
      { id: "meet-rusher", when: "phase:rush", hold: true, unlock: "rusher", cell: "rusher",
        text: "A big wave! Meet the *Rusher*: cheap, fast, aimed.",
        done: { ok: true } },
      { id: "rush", when: "phase:rush", cell: "rusher",
        text: "Tap *Rusher*, then tap a group of bacteria.",
        done: { deployed: "rusher", count: 1 } },
      { id: "more", when: "phase:rush", cell: "rusher",
        text: "Rushers die after a few kills. *Send more.*",
        done: { deployed: "rusher", count: 3 } },
      { id: "select", when: "phase:rush",
        text: "Tap a Rusher, then tap where to *send* it.",
        done: { seconds: 9 } },
      { id: "pus", when: "phase:cleanup",
        text: "*Pus* hides bacteria. Devourers eat both.",
        done: { seconds: 9 } },
      { id: "closing", when: "phase:closing",
        text: "Keep the wound *clear* so skin regrows.",
        done: { seconds: 8 } },
    ],
    phases: [
      {
        id: "breach", name: "The breach", bodyTime: "Minutes", icon: "bacterium",
        hint: "Keep a Scout near the wound.",
        fact: "Skin broke. Bacteria slipped in; a clot plugs the gap.",
        recap: "Bacteria got in through the cut.",
        spawns: [{ at: 0, type: "bacterium", count: 6, every: 2.4, where: "wound" }],
        end: { after: 22, spawnsDone: true },
      },
      {
        id: "rush", name: "The rush", bodyTime: "Hours to day 2", icon: "rusher",
        hint: "Big wave. Send Rushers at every group.",
        fact: "Neutrophils pour in from the blood and die fighting.",
        recap: "Neutrophils rushed in and attacked.",
        spawns: [
          { at: 0, type: "bacterium", count: 12, every: 0.6, where: "wound" },
          { at: 14, type: "bacterium", count: 12, every: 0.6, where: "wound" },
        ],
        end: { after: 22, spawnsDone: true, cleared: ["bacterium"] },
      },
      {
        id: "cleanup", name: "Cleanup", bodyTime: "Days 2–5", icon: "devourer",
        hint: "Devourers eat pus and the bacteria inside.",
        fact: "Pus is dead neutrophils. Macrophages eat it and the leftovers.",
        recap: "Macrophages cleared the pus and stragglers.",
        spawns: [{ at: 2, type: "bacterium", count: 5, every: 2.5, where: "pus" }],
        end: { after: 16, spawnsDone: true, cleared: ["bacterium"] },
      },
      {
        id: "closing", name: "Closing up", bodyTime: "Days 3–21", icon: "heal",
        hint: "Keep the wound clear so skin can regrow.",
        fact: "New skin grows in from the edges under a scab.",
        recap: "New skin sealed the wound.",
        healing: true,
        spawns: [
          { at: 5, type: "bacterium", count: 1, where: "wound" },
          { at: 13, type: "bacterium", count: 1, where: "wound" },
          { at: 21, type: "bacterium", count: 1, where: "wound" },
        ],
        end: { spawnsDone: true, cleared: ["bacterium"], healed: 100 },
      },
    ],
    loseTips: {
      leak: "Devourers below the wound. Rushers on every group, early.",
    },
  },

  {
    id: "flu",
    stage: "childhood",
    age: 7,
    title: "Flu",
    icon: "virus",
    scene: "airway",
    threatKind: "A germ",
    intro: "{name}, age 7, catches the flu at school.",
    teaches: "Viruses hide inside your cells. The body must learn them.",
    slots: 4,
    newCells: ["hunter"],
    requiredCells: [],
    alarm: false,
    calm: 15,
    map: [
      ":::::::::",
      ":::::::::",
      ":::::::::",
      ":::::::::",
      ":::::::::",
      "AAAAAAAAA",
      "AAAAAAAAA",
      "AAAAAAAAA",
      "V........",
      "O........",
      "V.......K",
      "V.......K",
      "O........",
      "V........",
      "V........",
      "BBBBBBBBB",
    ],
    goalLabel: "Deeper lung",
    healing: null,
    // The lymph node in the neck. A Scout carrying the virus's Fingerprint
    // walks here; training takes `trainTime` seconds, then Bounty Hunters
    // unlock for the rest of the level.
    // `samples` is which threat types carry this Fingerprint: a Scout that
    // touches either a free virus or an infected cell can take it.
    barracks: { x: 8.5, y: 11, fingerprint: "flu", samples: ["virus", "infected"], trainTime: 24, label: "Barracks" },
    coach: [
      { id: "place-scout", when: "calm", cell: "scout", at: [4.5, 3.6],
        text: "Put a *Scout* in the airway, above the lining.",
        done: { placed: "scout" } },
      { id: "place-devourer", when: "calm", cell: "devourer", at: [2.5, 3.2],
        text: "*Devourers* in the airway eat viruses before they enter cells.",
        done: { placed: "devourer" } },
      { id: "sample", when: "phase:blind", hold: true,
        text: "Only a *Scout* can carry the virus's Fingerprint.",
        done: { ok: true } },
      { id: "sample-go", when: "phase:blind",
        text: "Keep a Scout *beside* the infection to grab it.",
        done: { trainingStarted: true } },
      { id: "training", when: "event:training",
        text: "Barracks *training*. Slow the spread with Devourers and Rushers.",
        done: { trained: true } },
      { id: "meet-hunter", when: "event:trained", hold: true, cell: "hunter",
        text: "*Bounty Hunters* ready. They kill infected cells.",
        done: { ok: true } },
      { id: "hunters", when: "event:trained", cell: "hunter",
        text: "Tap *Bounty Hunter*, then tap an infected cell.",
        done: { deployed: "hunter", count: 1 } },
    ],
    phases: [
      {
        id: "spread", name: "Silent spread", bodyTime: "Days 0–2", icon: "virus",
        hint: "Viruses slip inside airway cells. Watch the lining.",
        fact: "The virus turns airway cells into factories. No symptoms yet.",
        recap: "The virus hid inside airway cells.",
        spawns: [{ at: 0, type: "virus", count: 8, every: 1.3, where: "top" }],
        end: { after: 20, spawnsDone: true },
      },
      {
        id: "blind", name: "Fighting blind", bodyTime: "Days 1–4", icon: "fingerprint",
        hint: "Infected cells burst. Get a Scout next to the virus.",
        fact: "Fever starts. Dendritic cells carry a sample to lymph nodes.",
        recap: "A Scout carried the Fingerprint to the Barracks.",
        spawns: [{ at: 2, type: "virus", count: 10, every: 1.6, where: "top" }],
        // Until the body has learned the virus, it keeps coming and the lining
        // keeps repairing itself. Without both, a player who never samples
        // could run the lining out of cells to infect: the damage stops, no
        // virus is left to sample, and the level can neither be won nor lost.
        trickle: { type: "virus", every: 4, where: "top", until: "trained" },
        regrow: 30,
        end: { after: 15, trained: "flu" },
      },
      {
        id: "counter", name: "The counterattack", bodyTime: "Days 5–8", icon: "hunter",
        hint: "Aim Bounty Hunters at infected cells. Each kill copies.",
        fact: "Killer T cells multiply and destroy infected cells.",
        recap: "Killer T cells destroyed the infected cells.",
        spawns: [{ at: 6, type: "virus", count: 14, every: 1.1, where: "top" }],
        end: { spawnsDone: true, cleared: ["virus", "infected"] },
      },
      {
        id: "mopup", name: "Mop-up and memory", bodyTime: "Days 8–14", icon: "star",
        hint: "Bacteria use the damaged lining. Rushers and Devourers.",
        regrow: 10,     // seconds for a dead airway cell to grow back
        fact: "Bacteria can exploit the damage — that's pneumonia. Memory cells remain.",
        recap: "Memory cells stayed behind for next time.",
        spawns: [{ at: 3, type: "bacterium", count: 5, every: 3, where: "deadTiles" }],
        end: { spawnsDone: true, cleared: ["bacterium"] },
      },
    ],
    rewards: { veteran: "flu" },
    loseTips: {
      burst: "Get a Scout into the airway early. Devourers catch viruses.",
      leak: "Keep a Devourer below the lining for the last phase.",
    },
  },

  {
    id: "broken-bone",
    stage: "childhood",
    age: 9,
    title: "Broken bone",
    icon: "debris",
    scene: "bone",
    threatKind: "Inside damage",
    intro: "{name}, age 9, breaks an arm falling from a tree.",
    teaches: "Clean up, rebuild — and know when to stop inflammation.",
    slots: 4,
    newCells: ["siren"],
    requiredCells: ["siren"],
    alarm: true,
    calm: 15,
    map: [
      "V.......V",
      "V.......V",
      "O.......O",
      "V.......V",
      "V.......V",
      "V.......V",
      "O.......O",
      "XXXXFXXXX",
      "XXXXFXXXX",
      "O.......O",
      "V.......V",
      "V.......V",
      "V.......V",
      "O.......O",
      "V.......V",
      "V.......V",
    ],
    goalLabel: null,
    healing: { x: 4.5, y: 8, radius: 2, rate: 1, blockers: ["debris", "pus"], label: "Bone", alarmBands: true },
    barracks: null,
    coach: [
      { id: "place-devourer", when: "calm", cell: "devourer", at: [4.5, 6.2],
        text: "Nothing comes from outside. Put a *Devourer* beside the break.",
        done: { placed: "devourer" } },
      { id: "meet-siren", when: "calm", hold: true, cell: "siren",
        text: "Meet the *Siren*. It raises the *Alarm*.",
        done: { ok: true } },
      { id: "siren-rule", when: "calm", hold: true, cell: "siren",
        text: "More Alarm, more Signal. Past *60* it hurts.",
        done: { ok: true } },
      { id: "place-siren", when: "calm", cell: "siren", at: [2.5, 4.5],
        text: "Tap *Siren*, then tap the ring.",
        done: { placed: "siren" } },
      { id: "alarm", when: "phase:inflammation",
        text: "Debris raises the Alarm too. Clear it before *60*.",
        done: { seconds: 10 } },
      { id: "band", when: "phase:rebuild",
        text: "Builders like Alarm *20–60*. Tap a Siren to retire it.",
        done: { seconds: 12 } },
    ],
    phases: [
      {
        id: "break", name: "The break", bodyTime: "Hours", icon: "debris",
        hint: "The break spills debris. Every piece raises the Alarm.",
        fact: "Blood clots around the break. Dying cells send danger signals.",
        recap: "The bone broke; cells sent danger signals.",
        spawns: [{ at: 0.5, type: "debris", count: 18, every: 0.1, where: "fracture" }],
        end: { after: 20, spawnsDone: true },
      },
      {
        id: "inflammation", name: "Inflammation", bodyTime: "Days 1–7", icon: "alarm",
        hint: "Inflammation helps now. Clear debris with Rushers and Devourers.",
        fact: "Swelling and heat bring in cleanup crews and the builders.",
        recap: "Inflammation brought in the cleanup crew.",
        spawns: [
          { at: 5, type: "debris", count: 7, every: 0.3, where: "fracture" },
          { at: 25, type: "debris", count: 6, every: 0.3, where: "fracture" },
          { at: 45, type: "debris", count: 5, every: 0.3, where: "fracture" },
        ],
        end: { after: 60, spawnsDone: true },
      },
      {
        id: "rebuild", name: "Rebuilding", bodyTime: "Weeks 2–12", icon: "builder",
        hint: "Builders are bridging the gap. Keep Alarm between 20–60.",
        fact: "Inflammation must settle. Soft callus forms, then hard bone.",
        recap: "Builders bridged the gap with new bone.",
        healing: true,
        builders: true,
        spawns: [],
        // Fragments keep breaking loose for as long as the rebuild takes, so
        // healing at half speed (Alarm under 20) means twice the cleanup.
        trickle: { type: "debris", every: 9, where: "fracture" },
        end: { healed: 70 },
      },
      {
        id: "remodel", name: "Remodeling", bodyTime: "Months", icon: "heal",
        hint: "Fragments break loose. Clear them while healing finishes.",
        fact: "For months, bone cells reshape the lump until it's strong.",
        recap: "Bone cells reshaped it over months.",
        healing: true,
        builders: true,
        spawns: [{ at: 2, type: "debris", count: 6, every: 4, where: "bone" }],
        end: { healed: 100 },
      },
    ],
    loseTips: {
      alarm: "Alarm sat above 60 too long. Retire a Siren sooner.",
      storm: "Alarm hit 100: cytokine storm. Fewer Sirens, faster cleanup.",
    },
  },
];

/* The life map. The slice builds Childhood's first three levels; the rest are
 * shown greyed so a player can see where the game is going (docs/DESIGN.md,
 * "Campaign: a life"). `later` entries are labels only — no ids, nothing is
 * saved against them yet. */
export const STAGES = [
  { id: "childhood", name: "Childhood", ages: "6–12",
    levels: ["cut", "flu", "broken-bone"],
    later: ["Chickenpox", "Food poisoning", "Rusty nail"] },
  { id: "teen", name: "Teen years", ages: "13–19",
    levels: [], later: ["Hay fever", "Asthma", "Peanut allergy"] },
  { id: "young-adult", name: "Young adult", ages: "20–35",
    levels: [], later: ["Flu again", "New flu strain", "Traveler's diarrhea", "C. diff"] },
  { id: "adulthood", name: "Adulthood", ages: "35–55",
    levels: [], later: ["Celiac", "Rheumatoid arthritis", "Tuberculosis", "Hepatitis", "HIV", "Lupus"] },
  { id: "later-life", name: "Later life", ages: "55+",
    levels: [], later: ["Kidney infection", "Cancer", "Shingles", "Transplant", "Sepsis"] },
];

export function levelById(id) {
  return LEVELS.find((l) => l.id === id) || null;
}

export function levelIndex(id) {
  return LEVELS.findIndex((l) => l.id === id);
}

/* Every cell a player has met by the time they reach `levelId`: the union of
 * each earlier-or-equal level's `newCells`. DERIVED from progress rather than
 * stored, so a save can never disagree with the level list. */
export function cellsAvailableAt(levelId) {
  const idx = levelIndex(levelId);
  const out = [];
  for (let i = 0; i <= idx && i < LEVELS.length; i++) {
    for (const c of LEVELS[i].newCells) if (!out.includes(c)) out.push(c);
  }
  return out;
}

/* "{name}" in level copy becomes the player's person. Kept in one place so the
 * loadout sheet, the battle intro and the end screen all say the same thing. */
export function personalise(text, name) {
  return String(text || "").split("{name}").join(name || "Billy");
}
