/* ============================================================================
 * levels.js — the three slice levels (Cut, Flu, Broken bone) and the life map
 * around them.
 *
 * A level plays one illness or injury from start to finish, and each PHASE is
 * one stage of the real response (docs/DESIGN.md, "Waves are the phases of
 * the illness"). The phase copy is educational content, so it is written to
 * be read by a ten-year-old and checked by a doctor: `fact` is what just
 * happened in the body (shown after the phase), `hint` is what to do now
 * (shown as it starts), `recap` is one line for the end screen, where the
 * player sees the whole arc retold.
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
    threatKind: "An injury from outside",
    intro: "{name}, age 6, falls off a bike and cuts a knee.",
    teaches: "Finding a threat first, then sending the right cells at it.",
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
    healing: { x: 4.5, y: 1.4, radius: 2.2, rate: 2.5, blockers: ["bacterium", "pus"], label: "Wound closing" },
    barracks: null,
    coach: [
      { id: "place-scout", when: "calm", cell: "scout", at: [4.5, 4.5],
        text: "Tap Scout, then tap the ring. Bacteria are invisible until a Scout is near them — it can see 3 tiles.",
        done: { placed: "scout" } },
      { id: "place-devourer", when: "calm", cell: "devourer", at: [4.5, 3.5],
        text: "Now a Devourer between the Scout and the wound. It swallows what comes close, and keeps bacteria off the Scout.",
        done: { placed: "devourer" } },
      { id: "wait", when: "calm",
        text: "Ready. Tap Start when you are — or wait for the timer.",
        done: { phase: "breach" } },
      { id: "rush", when: "phase:rush", cell: "rusher",
        text: "The big wave. Tap Rusher, then tap a revealed group of bacteria to send three in.",
        done: { deployed: "rusher", count: 2 } },
      { id: "select", when: "phase:rush",
        text: "Tip: tap a Rusher, then tap somewhere else to redirect it. Drag a box to grab several.",
        done: { seconds: 9 } },
      { id: "pus", when: "phase:cleanup",
        text: "Pus is dead Rushers. Devourers eat it — and the bacteria hiding inside.",
        done: { seconds: 9 } },
    ],
    phases: [
      {
        id: "breach", name: "The breach", bodyTime: "Minutes",
        hint: "Bacteria are slipping in through the cut. Keep a Scout near the wound so you can see them.",
        fact: "Skin is the body's wall. The moment it breaks, bacteria from the surface get in, a clot starts to plug the gap, and the cells already living in the tissue sense the damage.",
        recap: "Bacteria got in through the cut, and cells living in the tissue sensed them.",
        spawns: [{ at: 0, type: "bacterium", count: 6, every: 2.4, where: "wound" }],
        end: { after: 22, spawnsDone: true },
      },
      {
        id: "rush", name: "The rush", bodyTime: "Hours to day 2",
        hint: "Here comes the big wave. Send Rushers at every group a Scout reveals.",
        fact: "Neutrophils are the body's first responders. Within hours they pour out of nearby blood vessels by the thousands, attack the bacteria, and die in the fight.",
        recap: "Neutrophils rushed in from the blood and attacked.",
        spawns: [
          { at: 0, type: "bacterium", count: 12, every: 0.6, where: "wound" },
          { at: 14, type: "bacterium", count: 12, every: 0.6, where: "wound" },
        ],
        end: { after: 22, spawnsDone: true, cleared: ["bacterium"] },
      },
      {
        id: "cleanup", name: "Cleanup", bodyTime: "Days 2–5",
        hint: "Pus is dead Rushers, and a few bacteria are hiding in it. Devourers eat both.",
        fact: "Pus is mostly dead neutrophils. Macrophages take over the cleanup, eating the leftover bacteria and the fallen neutrophils so the tissue can heal.",
        recap: "Macrophages ate the last bacteria and cleared the pus.",
        spawns: [{ at: 2, type: "bacterium", count: 5, every: 2.5, where: "pus" }],
        end: { after: 16, spawnsDone: true, cleared: ["bacterium"] },
      },
      {
        id: "closing", name: "Closing up", bodyTime: "Days 3–21",
        hint: "Keep bacteria and pus away from the wound so new skin can grow over it.",
        fact: "New tissue grows in from the edges, a scab protects it, and the wound seals. Over the next weeks the scar slowly gets stronger.",
        recap: "New tissue grew in from the edges and the wound sealed.",
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
      leak: "Bacteria kept reaching the bloodstream. Put Devourers between the wound and the bottom, and send Rushers at every group a Scout reveals — early, before they split.",
    },
  },

  {
    id: "flu",
    stage: "childhood",
    age: 7,
    title: "Flu",
    threatKind: "A germ",
    intro: "{name}, age 7, catches the flu from a classmate.",
    teaches: "Viruses hide inside your own cells, so the body has to learn a new enemy.",
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
        text: "The virus drifts down the airway. Put a Scout in the airway, just above the lining.",
        done: { placed: "scout" } },
      { id: "place-devourer", when: "calm", cell: "devourer", at: [2.5, 3.2],
        text: "Devourers in the airway swallow viruses before they get inside a cell.",
        done: { placed: "devourer" } },
      { id: "sample", when: "phase:blind",
        text: "Only a Scout can carry the virus's Fingerprint to the Barracks. Keep one right next to the infection.",
        done: { trainingStarted: true } },
      { id: "training", when: "event:training",
        text: "The Barracks is training Bounty Hunters against this flu. Hold on — slow the spread with Devourers and Rushers.",
        done: { trained: true } },
      { id: "hunters", when: "event:trained", cell: "hunter",
        text: "Bounty Hunters ready! Tap Bounty Hunter, then tap an infected cell. Every kill makes a copy.",
        done: { deployed: "hunter", count: 1 } },
    ],
    phases: [
      {
        id: "spread", name: "Silent spread", bodyTime: "Days 0–2",
        hint: "Viruses drift in and slip inside the cells lining the airway, where most of your cells can't reach them.",
        fact: "A flu virus can't copy itself on its own. It slips into the cells lining the airway and turns each one into a factory for new viruses — before there are any symptoms at all.",
        recap: "The virus slipped into airway cells before there were any symptoms.",
        spawns: [{ at: 0, type: "virus", count: 8, every: 1.3, where: "top" }],
        end: { after: 20, spawnsDone: true },
      },
      {
        id: "blind", name: "Fighting blind", bodyTime: "Days 1–4",
        hint: "Infected cells burst out new viruses, and nothing you have can stop them. A Scout next to the virus will carry its Fingerprint to the Barracks.",
        fact: "Infected cells burst and release new viruses. Fever and aches start. Meanwhile a dendritic cell has carried a sample of the virus to a lymph node, where the body starts training specialists against this exact strain.",
        recap: "Infected cells burst, and a Scout carried the virus's Fingerprint to the lymph node.",
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
        id: "counter", name: "The counterattack", bodyTime: "Days 5–8",
        hint: "Bounty Hunters are trained. Aim them at infected cells — every kill makes a copy.",
        fact: "Killer T cells trained against this exact flu arrive, multiply every time they find their target, and destroy infected cells before they can burst.",
        recap: "Trained killer T cells multiplied and destroyed the infected cells.",
        spawns: [{ at: 6, type: "virus", count: 14, every: 1.1, where: "top" }],
        end: { spawnsDone: true, cleared: ["virus", "infected"] },
      },
      {
        id: "mopup", name: "Mop-up and memory", bodyTime: "Days 8–14",
        hint: "Bacteria are using the damaged lining to get deeper. Rushers and Devourers can handle them.",
        regrow: 10,     // seconds for a dead airway cell to grow back
        fact: "Flu damages the airway lining, and bacteria sometimes take advantage — that is how a flu can turn into pneumonia. As the lining regrows, memory cells stay behind for next time.",
        recap: "Bacteria tried the damaged lining, and memory cells stayed behind.",
        spawns: [{ at: 3, type: "bacterium", count: 5, every: 3, where: "deadTiles" }],
        end: { spawnsDone: true, cleared: ["bacterium"] },
      },
    ],
    rewards: { veteran: "flu" },
    loseTips: {
      burst: "Too many infected cells burst. Get a Scout into the airway early so the Barracks can start training sooner, and use Devourers and Rushers to catch viruses before they get inside.",
      leak: "Bacteria got through the damaged lining. Keep a Devourer or a squad of Rushers below the lining for the last phase.",
    },
  },

  {
    id: "broken-bone",
    stage: "childhood",
    age: 9,
    title: "Broken bone",
    threatKind: "Damage from inside",
    intro: "{name}, age 9, falls from a tree and breaks an arm.",
    teaches: "The immune system cleans up and starts repair — and inflammation has to stop.",
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
    healing: { x: 4.5, y: 8, radius: 2, rate: 1, blockers: ["debris", "pus"], label: "Bone healing", alarmBands: true },
    barracks: null,
    coach: [
      { id: "place-devourer", when: "calm", cell: "devourer", at: [4.5, 6.2],
        text: "Nothing is coming from outside this time. Put a Devourer right next to the break.",
        done: { placed: "devourer" } },
      { id: "place-siren", when: "calm", cell: "siren", at: [2.5, 4.5],
        text: "Sirens raise the Alarm. More Alarm means more Signal — but past 60 it hurts. Try one.",
        done: { placed: "siren" } },
      { id: "alarm", when: "phase:inflammation",
        text: "Debris adds to the Alarm too. Clear it with Rushers and Devourers before the meter passes 60.",
        done: { seconds: 10 } },
      { id: "band", when: "phase:rebuild",
        text: "Bone Builders work best with the Alarm between 20 and 60. Tap a Siren to retire it if the meter runs high.",
        done: { seconds: 12 } },
    ],
    phases: [
      {
        id: "break", name: "The break", bodyTime: "Hours",
        hint: "The break spills debris — dead cells and bone fragments. Every piece raises the Alarm.",
        fact: "When a bone breaks, blood pools into a clot around the break and dying cells release danger signals. Those signals are the start of inflammation.",
        recap: "The bone broke, and dying cells sent out danger signals.",
        spawns: [{ at: 0.5, type: "debris", count: 18, every: 0.1, where: "fracture" }],
        end: { after: 20, spawnsDone: true },
      },
      {
        id: "inflammation", name: "Inflammation", bodyTime: "Days 1–7",
        hint: "You need inflammation now: it brings in Signal faster. Clear the debris with Rushers and Devourers.",
        fact: "Inflammation is the swelling, heat and redness around an injury. It brings in neutrophils and macrophages to clear the dead tissue, and it calls in the cells that rebuild.",
        recap: "Inflammation brought in cells to clear away the dead tissue.",
        spawns: [
          { at: 5, type: "debris", count: 7, every: 0.3, where: "fracture" },
          { at: 25, type: "debris", count: 6, every: 0.3, where: "fracture" },
          { at: 45, type: "debris", count: 5, every: 0.3, where: "fracture" },
        ],
        end: { after: 60, spawnsDone: true },
      },
      {
        id: "rebuild", name: "Rebuilding", bodyTime: "Weeks 2–12",
        hint: "Bone Builders are closing the break. Keep the Alarm between 20 and 60 and the break clear of debris.",
        fact: "Once the cleanup is done, inflammation has to settle. Repair cells bridge the gap — first with soft callus, then with hard bone. Too much inflammation now slows healing down.",
        recap: "Inflammation settled, and repair cells bridged the gap with new bone.",
        healing: true,
        builders: true,
        spawns: [],
        // Fragments keep breaking loose for as long as the rebuild takes, so
        // healing at half speed (Alarm under 20) means twice the cleanup.
        trickle: { type: "debris", every: 9, where: "fracture" },
        end: { healed: 70 },
      },
      {
        id: "remodel", name: "Remodeling", bodyTime: "Months",
        hint: "Loose fragments break off as the bone reshapes. Clear them while the Healing bar finishes.",
        fact: "For months afterward, bone-eating cells (cousins of macrophages) and bone-building cells reshape the lump of new bone until it is nearly as good as before.",
        recap: "Bone cells reshaped the new bone over the following months.",
        healing: true,
        builders: true,
        spawns: [{ at: 2, type: "debris", count: 6, every: 4, where: "bone" }],
        end: { healed: 100 },
      },
    ],
    loseTips: {
      alarm: "The Alarm stayed above 60 too long, and the inflammation itself hurt. Clear debris faster, and retire a Siren (tap it) when the meter runs high.",
      storm: "The Alarm hit 100 and set off a cytokine storm. Fewer Sirens, and clear the debris that keeps the meter up.",
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
