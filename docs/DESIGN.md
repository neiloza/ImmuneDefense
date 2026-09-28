# Immune Defense — Game Design Doc

Sep 27, 2026 (copied into this repo 2026-09-28)

> **This is the design as written before the build.** Where it and the code
> disagree, the code is the fact and this is the claim (GameHub `setup/`
> rule). In particular every number below was a first-pass guess: the tuned
> values live in `js/data/`, and `CLAUDE.md` records where the build departs
> from this document and why.

## Overview

You are the immune system of a person you name yourself. Each level is one event in their life, from a cut knee at age 6 to the illnesses of old age, and you win by defending the body the way it actually defends itself. It is tower defense crossed with light real-time strategy: you choose a **loadout** of cells before each level, then deploy them during it. **Sentries** are stationary cells that float in place and fight on their own. **Responders** are active cells that go wherever you aim them.

Working title: *Immune Defense* (placeholder; candidates *Clonal*, *First Responders*, *Host*, trademark check needed).

**Your person.** At the start, the player names the human they protect (Billy, Jill, their own name). The name runs through the game: level intros ("Billy, age 7, catches the flu from a classmate"), the Host Health bar ("Billy: feeling rough"), and the life timeline on the level map. Protecting someone you named makes the stakes personal.

**Design pillars**

1. **The biology is the rules.** Every mechanic maps to something real. If a rule has no biological basis, cut it or flag it.
2. **Plain names, real knowledge.** Cells are named for their job (Devourer, Bouncer, Bounty Hunter). The real name sits underneath, so players learn function first and jargon second.
3. **Fast and general vs. slow and precise.** Innate units work now; adaptive units must be trained on a specific enemy but hit far harder. Balancing the two is the core strategy.
4. **Fighting hard hurts you too.** The Alarm meter speeds you up but damages your own tissue. Overreacting is a way to lose.
5. **Every level teaches one thing.** A player who finishes a chapter can explain, in plain words, how the body fights that illness.

**Platform:** browser game in GameHub (desktop and phone, touch-first), then packaged as a PWA per the house starter kit.

## Core loop

A level is a short series of waves on one tissue map. You choose a loadout before it starts; during it, you can deploy any cell in the loadout whenever you can afford it.

**Scouts find the threat, then you decide what to send.**

```
MAIN LOOP (every phase)
Pick your loadout → Place Sentries → Scouts detect threat → Deploy and aim Responders → Cells fight → Phase cleared
                          ↑                                                                               |
                          └──────────────────────────────── next phase ───────────────────────────────────┘

LEARNING TRACK (during the fight, from the Flu level on)
Scout takes a sample → Barracks trains (the learning lag) → Specialist unlocked (e.g. Bounty Hunter) → ready to deploy
```

The main loop repeats every wave. The learning track, from the Flu level on, unlocks specialist cells mid-level.

**Loadout.** Before each level you pick which unlocked cells to bring, up to a slot limit (3 slots at first, growing to 6). Nothing is random: every cell in the loadout can be deployed the whole level. New cells unlock one at a time, so players are never handed more than one new thing to learn.

**Two kinds of cells.**

- **Sentries (stationary).** Placed on any open tissue tile. They float gently in place and fight whatever comes near. These are the towers.
- **Responders (active).** Enter from the nearest blood vessel and go where you aim them. Tap a Responder (or drag to select a group), then tap a target; they travel there, attack, and hold that spot until given a new order.

**Detect, then respond.** Threats are hidden until a Scout finds them; before that, they show only as a symptom on the tissue (redness, swelling). A Scout that spots enemies pings you and reveals them, and only revealed enemies can be targeted. This is the real order of events: the body senses a threat first, then recruits the cells that fit it.

**Calm phase.** Each level opens with about 15 seconds before the threat appears, so you can place Sentries (Scouts first).

**Signal** (the energy). Deploying a cell costs Signal, which refills over time.

**Alarm** (from the Broken bone level). An inflammation meter from 0 to 100. Higher Alarm refills Signal faster, because inflammation is how the body calls in more cells. Above 60 it damages your person's tissue. At 100 you get a cytokine storm: heavy damage everywhere for several seconds.

**Learning lag** (from the Flu level). A Scout that touches a new kind of enemy takes its Fingerprint and leaves its post to carry it to the Barracks. After a training timer, the matching specialist cell unlocks in your deploy tray for the rest of the level.

**Clonal copies.** Each time a Bounty Hunter kills a matching target, it spawns a copy of itself (capped per level).

**Win and lose.** **Host Health** is how your person is feeling. Enemies that reach their goal, and Alarm damage, drain it. Clear all waves (or fill the Healing bar, on repair levels) with Host Health above 0 to win; 1–3 stars for how much health is left.

**Waves are the phases of the illness.** A level plays one illness or injury from start to finish, and each wave is one stage of the real response, announced with a banner in body time ("Day 3: the rush"). Most levels follow the same arc, so players learn to recognize it:

1. **Breach or exposure.** The threat gets in. Resident Sentries and Scouts are the only defense.
2. **Alarm and rush.** The body sounds the alarm and the first Responders flood in.
3. **Counterattack.** Trained specialists arrive, for threats the fast responders can't finish (germs, not injuries).
4. **Cleanup and repair.** Dead cells and debris are cleared and tissue rebuilds. The Alarm has to come down.
5. **Memory.** Winning leaves Veterans for the next time this threat appears.

Between phases there is a short pause with one Field Guide line about what just happened in the body.

## Cast and naming

Every unit is named for its job, using one theme: the body is a city, and the cells are its security force. Mixing themes (fantasy here, military there) brings back the confusion the renaming is meant to remove.

**Naming rules**

- The name says the job in one or two plain words.
- Every cell's loadout tile shows the game name large and the real name small, plus one line on what it really does.
- The **Field Guide** (in-game codex) unlocks each real cell's entry the first time you use it.

**Sentries** (stationary: placed on open tissue, float in place, fight on their own)

| Game name | Real name | Job in game | Real job |
| --- | --- | --- | --- |
| Devourer | Macrophage | Big stationary eater; engulfs enemies and debris that come near | Engulfs microbes and dead cells. "Macrophage" is Greek for "big eater" |
| Scout | Dendritic cell | Reveals hidden enemies nearby and alerts you; carries a Fingerprint to the Barracks | Samples invaders and presents them to T cells in lymph nodes |
| Siren | Mast cell | Raises the Alarm, which calls in help faster | Releases histamine; drives inflammation and allergies |

**Responders** (active: enter from blood vessels and go where you aim them)

| Game name | Real name | Job in game | Real job |
| --- | --- | --- | --- |
| Rusher | Neutrophil | Cheap, fast attacker you aim at enemies; dies after a few kills | First cells to arrive; die in the fight (pus is mostly dead neutrophils) |
| Recruit | Monocyte | Slow walker that becomes a Devourer where it settles | Leaves the blood and matures into a macrophage in tissue |
| Patcher | Platelet | Seals a breach so no more enemies spawn from it | Clots wounds (not an immune cell, but essential to cuts) |
| Grenadier | Eosinophil | Area damage vs. big parasites | Releases toxic granules against worms |
| Bouncer | Natural killer cell | Kills any cell hiding its ID badge | Kills cells missing their MHC I "ID" marker |
| Commander | Helper T cell | Doesn't fight; buffs and speeds up nearby units | Coordinates the immune response with signals |
| Bounty Hunter | Killer T cell | Aimed at infected cells; kills only those matching its Fingerprint and copies itself on kills | Kills infected cells showing its one target; multiplies when it finds it |
| Marksman | B cell | Fires Marker darts that slow enemies and make them take extra damage | Makes antibodies that tag and neutralize targets |
| Armory | Plasma cell | Upgraded Marksman: a stationary dart factory | A B cell turned antibody factory |
| Peacekeeper | Regulatory T cell | Lowers the Alarm; prevents friendly fire | Calms the response and prevents autoimmunity |
| Veteran | Memory cell | Carries over between levels; adaptive cells ready from the start | Remembers past enemies; the basis of vaccines |

**Terms**

| Game term | Real term |
| --- | --- |
| Fingerprint | Antigen |
| ID badge | MHC |
| Marker dart | Antibody |
| Signal | Cytokines |
| Alarm | Inflammation |
| Barracks | Lymph node |
| Academy | Thymus |
| Heat Wave (spell) | Fever |
| Chain Reaction (spell) | Complement system |

## Enemies

Each enemy family forces a different answer, so no single deck wins every level. Enemies keep everyday names (bacteria, virus) because players already know them; individual strains get short nicknames per level.

| Family | Behavior | What counters it | Real basis |
| --- | --- | --- | --- |
| Bacteria | Split into two if not killed within a few seconds | Fast damage: Rushers, Devourers | Bacteria divide rapidly |
| Encapsulated bacteria | Can't be eaten until tagged | Marksman darts, then Devourers | A capsule blocks engulfing; antibodies overcome it |
| Virus | Enters a tissue tile and hides; the tile spawns more viruses over time | Bouncer, Bounty Hunter (kill the infected tile) | Viruses replicate inside host cells |
| Stealth virus | Hides its ID badge, so Bounty Hunters can't see it | Bouncer only | Some viruses suppress MHC I; NK cells catch that |
| Toxin | Not alive; drains Host Health while it exists | Marker darts only | Antitoxin antibodies neutralize toxins |
| Parasite | Slow boss with a huge health pool | Grenadiers, Chain Reaction | Worms are too big to engulf |
| Fungus | Leaves spore zones that keep spawning | Devourers stationed on the zone | Fungal spores seed new growth |
| Traitor (cancer) | Spawns from your own tissue, looks friendly until it turns | Bouncer | Tumor cells often hide their MHC |
| Foreign object | Can't be killed; slowly causes Alarm | Wall it off with Devourers, or Rushers push it out | Splinters are walled off or expelled |
| Debris | Dead cells and fragments from an internal injury; doesn't attack, but raises Alarm and blocks healing while it lies around | Devourers, Rushers aimed at piles | Macrophages clear dead tissue so repair can start |

## Campaign: a life

The campaign follows your person from childhood to old age. Each chapter is a life stage and each level is one event in it, teaching one idea and adding at most one new cell. Each level plays its illness start to finish as a series of phases. It opens with the three basic kinds of threat: an injury from outside (Cut), a germ (Flu) and damage from inside (Broken bone).

| Stage | Age | Levels (last = boss) | What it teaches | New cells and mechanics |
| --- | --- | --- | --- | --- |
| 1. Childhood | 6–12 | Cut → Flu → Broken bone → Chickenpox → Food poisoning → **Rusty nail** (tetanus: a toxin only a vaccine's Veterans can beat) | The three kinds of threat; the body learns; vaccines | Scout, Devourer, Rusher · Barracks and Bounty Hunter · Siren and the Alarm · Patcher, Marksman, Veterans |
| 2. Teen years | 13–19 | Hay fever → Asthma (the path narrows) → **Peanut allergy** (a harmless enemy; too much Alarm = anaphylaxis = loss) | Overreacting is the disease | Peacekeeper |
| 3. Young adult | 20–35 | Flu again (childhood Veterans make it easy) → New flu strain → Traveler's diarrhea → **C. diff** (takes over after antibiotics kill your allies) | Memory, and why flu shots are yearly; not all bacteria are enemies | Friendly microbiome, Antibiotics, Grenadier |
| 4. Adulthood | 35–55 | Celiac → Rheumatoid arthritis → Tuberculosis (contain it, can't kill it) → Hepatitis → HIV → **Lupus** | Friendly fire; containment; an enemy that attacks your command | Academy, Bouncer, Commander, Devourer walls |
| 5. Later life | 55+ | Kidney infection → Cancer (early catch → spread → immunotherapy) → **Shingles** (the childhood chickenpox wakes up) → Transplant → **Sepsis** (finale: the Alarm is the real enemy) | Traitors from inside; sleeper agents; your own response can kill you | Traitor enemies, engineered Bounty Hunters, whole-body map |

**One life, so progress carries forward.** Veterans earned against the childhood Flu make the young-adult reinfection easy. The chickenpox beaten at 8 returns as shingles at 60. Vaccines earned in childhood pre-train one Fingerprint for any later level.

**Lifestyle events come from the patient profile.** A night out, chronic drinking and cirrhosis are not forced on every player's person. They appear as extra levels when the Alcoholic profile is chosen, and the other profiles add their own events the same way.

## Patient profiles (difficulty)

There are five difficulties, and each damages a different part of the immune system instead of just adding enemy health. Every level can be played on any profile. The order below is a gameplay ranking, easiest first, not a medical claim.

| Difficulty | What it damages | Real effect | Game rules |
| --- | --- | --- | --- |
| Healthy | Nothing | Baseline | Standard Signal and Alarm limits |
| Smoker | Barriers and lungs | Smoke paralyzes the airways' mucus escalator and weakens lung macrophages; narrowed vessels slow healing | Lung maps: no passive clearing, Devourers eat 30% slower. All maps: Responders take 30% longer to arrive, Patchers work 50% slower |
| Obese | The alarm system and memory | Fat tissue drives chronic low-grade inflammation; weaker vaccine responses; slower wound healing | Alarm never drops below 25. Veterans 30% weaker. Tissue regenerates 50% slower. Fat-tissue tiles add Alarm over time |
| Alcoholic | Responders and the gut wall | Neutrophils recruited slower and less effective; lung macrophages weakened; gut wall leaks bacteria | Rushers arrive 2 s late, 1 fewer per deploy. Signal −20%. A "leaky gut" edge spawns extra enemies. Barracks trains 30% slower |
| Meth head | Everything, erratically | Skin picking and injection open wounds; needles carry bloodborne infections; dry mouth; sleep loss and malnutrition. Direct immune suppression is shown mostly in animal studies | New breaches open mid-wave. Some enemies spawn directly in the blood lanes. Signal swings between spikes and crashes. All units −10% |

All percentages are first-pass tuning numbers for playtesting.

**Signature matchups** (achievements, hardest-level bragging rights): Smoker × Flu, Alcoholic × Hepatitis, Obese × Sepsis, Meth head × Cut.

**Later:** stack two profiles as an endgame challenge mode.

**Labels.** A profile applies to the person the player named, so the game reads "Billy · Smoker". That keeps the bluntness while making the habit something that happens to a person the player cares about, not a joke about a type of person. The labels above are still working labels; decide before any store copy or art (see Open questions).

## Vertical slice: Cut, Flu, Broken bone

The first build is the first three Childhood levels on the Healthy profile. They cover the three kinds of threat (an injury from outside, a germ, damage from inside) and between them exercise every core system: loadout, Sentries, aimed Responders, detection, the learning track and the Alarm. Each level adds exactly one system.

**Slice content:** 5 cells (Scout, Devourer and Siren as Sentries; Rusher and Bounty Hunter as Responders), 4 threats (Bacterium, Flu virus, Infected airway cell, Debris including Pus), neutral Bone Builders, 3 maps, the name-your-person screen and the loadout screen.

### Shared rules

- **Map:** portrait, 9 × 16 tiles of open tissue. No fixed track: enemies move toward their goal through the tissue, and Sentries can go on any open tile. Blood vessels run along each map; Responders enter from the nearest vessel opening, so where the vessels are shapes each level.
- **Controls:** tap a cell in the deploy tray, then tap a tile (Sentry) or a revealed enemy (Responder). Tap a deployed Responder, or drag to select several, then tap a new target to redirect them.
- **Detection:** enemies more than 3 tiles from every Scout are hidden, shown only as faint redness. Revealed enemies stay visible 5 s after leaving Scout range. Devourers still hit anything in reach; only Responders need a revealed target.
- **Signal:** max 10, starts full, refills 1 every 2 s. Once the Alarm exists (level 3), refill is multiplied by (1 + Alarm / 100).
- **Host Health:** 100. Stars: 3 at ≥ 80, 2 at ≥ 50, 1 at > 0.

Body times below are approximate and compressed into minutes of play.

### Level 1: Cut (about 5 minutes)

- **Intro:** "Billy, age 6, falls off a bike and cuts a knee."
- **Teaches:** the loadout screen, placing Sentries, detect-then-respond, aiming, and the four stages of wound healing.
- **Loadout:** 3 slots, filled with the only 3 cells (Scout, Devourer, Rusher). The screen still appears so players learn it exists.
- **Map:** skin across the top with one wound; tissue below; one vessel down the left side; the bloodstream (the goal) along the bottom.

| Phase | Body time | In the body | In the game |
| --- | --- | --- | --- |
| 1. The breach | Minutes | Skin breaks, bacteria get in, a clot starts forming, and resident cells sense the damage | 15 s calm phase with prompts to place a Scout by the wound and a Devourer beside it. Then a trickle of 6 Bacteria, hidden until the Scout pings |
| 2. The rush | Hours to day 2 | Neutrophils flood in from the blood and attack | The big wave: 16 Bacteria in two groups. Prompt to deploy Rushers and tap a revealed group |
| 3. Cleanup | Days 2–5 | Macrophages take over, eating the last bacteria and the dead neutrophils (pus) | Every Rusher that died leaves a Pus blob (Debris). A few Bacteria hide in it; Devourers have to clear it |
| 4. Closing up | Days 3–21 | New tissue grows and the wound seals | The Healing bar fills while the wound is clear of Bacteria and Pus. 3 last Bacteria try to slip in before it seals. The level ends when the bar is full |

### Level 2: Flu (about 6 minutes)

- **Intro:** "Billy, age 7, catches the flu from a classmate."
- **Teaches:** viruses hide inside your own cells; the body has to learn a new enemy; memory.
- **New:** Barracks and Bounty Hunter. The loadout shows Bounty Hunter in a 4th slot, greyed out as "needs training".
- **Map:** the airway lining: rows of airway cells (tiles) across the middle; virus drifts in from the top; the Barracks (a lymph node in the neck) sits at the right edge.

| Phase | Body time | In the body | In the game |
| --- | --- | --- | --- |
| 1. Silent spread | Days 0–2 | Virus lands in the airway and slips into cells. No symptoms yet | 8 viruses drift in, visible only near Scouts. Devourers catch a few free viruses, but most get inside airway cells |
| 2. Fighting blind | Days 1–4 | Infected cells burst out new virus. Fever and aches start. A dendritic cell carries a sample to the lymph node | Infected cells burst after 12 s, releasing 4 viruses each (12 more arrive too). Each burst costs a little Host Health: Billy feels sick. A Scout leaves to carry the Fingerprint and Barracks training starts (40 s). Innate cells can only slow the spread |
| 3. The counterattack | Days 5–8 | Killer T cells arrive, multiply and destroy infected cells | Bounty Hunter unlocks. Aim them at infected cells; each kill copies the Hunter. A last surge of 16 viruses |
| 4. Mop-up and memory | Days 8–14 | Dead airway cells are cleared. Bacteria may exploit the damaged lining. Memory cells form | Dead-cell Debris, plus a few Bacteria on damaged tiles (a secondary infection) for Rushers and Devourers. Winning awards a Flu Veteran for later in life |

### Level 3: Broken bone (about 6 minutes)

- **Intro:** "Billy, age 9, falls from a tree and breaks an arm."
- **Teaches:** the immune system cleans up and starts repair, not just fights germs; inflammation is necessary, but it has to stop.
- **New:** Siren, the Alarm meter, the Healing bar, and Bone Builders (neutral repair cells that arrive on their own).
- **Map:** inside the arm: a bone with a fracture across the middle, tissue around it, vessels on both sides. No wound; nothing comes from outside.
- **Win:** fill the Healing bar. It fills 1% per second while no Debris is within 2 tiles of the fracture and Alarm is between 20 and 60; half speed when Alarm is under 20; stopped above 60.

| Phase | Body time | In the body | In the game |
| --- | --- | --- | --- |
| 1. The break | Hours | Bone and tissue break, blood pools into a clot, and dying cells send out danger signals | 15 s calm, then a big burst of Debris from the fracture. The Alarm starts rising on its own from the damage |
| 2. Inflammation | Days 1–7 | Neutrophils, then macrophages, clear the dead tissue. The inflammation also calls in the repair cells | Debris pulses every 20 s. Place Sirens to push the Alarm past 20 and call in enough help; healing can't start below 20 |
| 3. Rebuilding | Weeks 2–12 | Inflammation settles and repair cells bridge the gap, first with soft callus, then hard bone | Bone Builders start closing the fracture, but only while the Alarm is 20–60 and the zone is clear. You have to let the Alarm fall |
| 4. Remodeling | Months | Bone-eating cells, cousins of macrophages, reshape the new bone | Short finale: leftover fragments break loose; Devourers clear them while the Healing bar finishes |

### First-pass stats

| Cell | Kind | Cost (Signal) | HP | Attack | Reach | Speed (tiles/s) | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Scout | Sentry | 3 | 80 | none | sees 3 tiles | drifts; 1 while carrying | Reveals enemies; leaves automatically to carry a new Fingerprint |
| Devourer | Sentry | 4 | 300 | 12 damage/s; eats a Bacterium or Debris every 1.5 s | 1 tile | drifts | Hits anything in reach, revealed or not |
| Siren | Sentry | 3 | 120 | none | 3 tiles | drifts | +2 Alarm/s while enemies or Debris are in range |
| Rusher | Responder | 2 | 40 each, 3 per deploy | 10 damage/s | melee | 2.5 | Dies after 3 kills or 20 s |
| Bounty Hunter | Responder | 4 | 80 | 20 damage/s, infected cells only | melee | 1.2 | Locked until training ends; copies itself on each kill (max 12) |

| Threat | HP | Speed (tiles/s) | Host damage | Behavior |
| --- | --- | --- | --- | --- |
| Bacterium | 30 | 1.0 | 5 on reaching the bloodstream | Splits in two after 8 s alive (2 generations max); 4 damage/s to cells |
| Flu virus | 10 | 0.8 | none directly | Enters an airway cell on contact; can only be hit while outside a cell |
| Infected airway cell | 60 | 0 | 3 per burst | Bursts after 12 s, releasing 4 viruses; only Bounty Hunters can damage it |
| Debris | 20 | 0 | none directly | +0.5 Alarm/s per piece; blocks healing within 2 tiles. Pus (left by dead Rushers) counts as Debris |

### What the slice must prove

1. Playtesters explain what Scout, Devourer, Rusher and Bounty Hunter do from the name and tile alone.
2. After each level, playtesters can retell its phases in order in their own words ("bacteria got in, neutrophils rushed them, macrophages cleaned up, the wound closed"). This is the educational test.
3. Aiming Responders with a thumb on a phone, mid-fight, feels quick and precise.
4. Players start placing Scouts first on their own: detect-then-respond makes sense without repeated prompts.
5. The Bounty Hunter unlock in Flu feels like a turning point, not a chore.
6. In Broken bone, players deliberately manage the Alarm: Sirens early, then back off.
7. 60 fps on a mid-range phone with 150 units on screen; each level lands between 4 and 7 minutes.

## Art and audio direction

The look is a stained microscope slide with personality. Cells are soft rounded shapes in the pink-and-purple palette of real lab stains, with simple eyes, so they feel alive without becoming little people (the route *Cells at Work!* already took).

**Readability rules** (these beat style every time)

- **Silhouette first.** Every unit has a distinct outline, recognizable at 24 px in grayscale: Devourer = big blob with pseudopods, Rusher = small bean with a lobed nucleus, Scout = star with long arms, Siren = round with a granule halo, Marksman = oval with a dart launcher, Patcher = flat disc, Bounty Hunter = spiky oval with one big eye.
- **Friend vs. enemy by color family.** Your cells are pale with purple nuclei, like a real blood smear. Enemies are acid green, yellow and orange, so they read as "gross" and never blend in.
- **Size = importance.** Bosses and Sentries are large, swarm units small.
- **Status on the unit.** Tagged enemies glow with a marker ring; enemies carrying a known Fingerprint show a small icon.
- **Never color alone.** Every color meaning also has a shape or icon, for color-blind players.

**Alarm is shown on the tissue, not just a meter.** As Alarm rises, the background swells redder and pulses. Players see inflammation, which teaches what it is.

**Portrait UI layout**

- **Top bar:** your person's name and Host Health ("Billy: feeling rough"), phase timeline ("Day 3 of 14: the rush"), Alarm meter (from Broken bone).
- **Middle:** the map. Selected Responders glow; a line shows where they are headed.
- **Bottom:** Signal bar and the deploy tray with every cell in the loadout, each showing game name, small real name and cost. A tile greys out when you can't afford it or it still needs training.
- **Before the level:** the loadout screen: unlocked cells on one side, your slots on the other, and the level intro line for your person.
- **First launch:** name your person.

**Palette (starting tokens)**

| Token | Use | Value |
| --- | --- | --- |
| tissue | Map background | #F4DCDC |
| tissue-inflamed | Background at high Alarm | #E88A8A |
| vessel | Blood vessel lines | #C0405A |
| ally-body | Your cells | #FBF7FF |
| ally-nucleus | Your cells' nuclei | #6B3FA0 |
| enemy | Bacteria | #9BCB3B |
| enemy-alt | Encapsulated bacteria, bosses | #E0A526 |
| signal | Signal bar, deploy costs | #3A7BD5 |
| alarm | Alarm meter | #D6453D |

**Rendering for the slice:** all art is drawn in code (canvas shapes) so there is no asset pipeline to build. Hand-drawn sprites replace it once the silhouettes are proven.

**Audio for the slice:** placeholder only. One soft sound per cell deployed, a squelch when a Devourer eats, a rising tone as Alarm climbs past 60.

## Tech plan

The slice is built as a zero-dependency canvas game in its own repo, `neiloza/ImmuneDefense`, scaffolded from GameHub's `setup/starter-kit/`. This follows the house rules in `setup/APP_DESIGN_RULES.md`: vanilla JS modules, portrait and phone-first, tests on `node --test`, pure functions at the edges.

**Where it lives** *(changed 2026-09-28 — the repo was created before the build started, so the "prototype inside GameHub first" step was skipped)*

1. **This repo** is the app: an installable PWA from day one, meant for `immunedefense.thewizardofoza.com`.
2. **GameHub** gets a card pointing at that subdomain once it resolves (the same path Animas took). The code is not kept in both places.

**Architecture**

| Module | Job | Rule |
| --- | --- | --- |
| `data/` (units, enemies, levels) | Every number in this doc | Tuning never touches logic |
| `sim/` | The whole game state and rules: movement, targeting, combat, Signal, Alarm, Barracks | Pure and deterministic: fixed 20 ticks per second, seeded randomness, no DOM. Same inputs always give the same result |
| `render/` | Draws the sim state to canvas at 60 fps, smoothing between ticks | Reads state, never changes it |
| `ui/` | Loadout screen, deploy tray, meters, selecting and aiming units | Turns taps into commands (`deploy`, `orderAttack`) for the sim |
| `main.js` | Game loop, name-your-person screen, level select, saved progress in `localStorage` | Thin glue |

**Tests** (`node --test`, on the sim only)

- Bacteria split on time and stop after 2 generations.
- Alarm damage and cytokine storm math match this doc.
- Bounty Hunter unlocks exactly when Barracks training finishes, and copies stop at the cap.
- Hidden enemies can't be targeted until a Scout reveals them; the Healing bar fills at the right rate in each Alarm band.
- Phases advance in order with the spawns the level data lists. A scripted bot beats each slice level on 1 star, so no level ships unwinnable.

**Performance:** a spatial grid for targeting and object pools for units and projectiles, to hold 150 units at 60 fps on a mid-range phone.

## Open questions and risks

**Decisions needed**

- [ ] Final title, after a trademark and app-store name check.
- [ ] Deploy limit: Signal (an energy that refills) is kept from the earlier design. Alternatives are a fixed cell budget per level, or a cooldown per cell type.
- [ ] Scouts carrying a Fingerprint: do they leave automatically (slice default), or does the player send them, trading detection now for specialists later?
- [ ] Can players move Sentries once placed? The slice says no.
- [ ] Your person: name only, or also appearance? Level intro text avoids pronouns, so the name alone works.
- [ ] Difficulty labels: keep "Alcoholic / Smoker / Obese / Meth head", or use clinical labels. Must be settled before store copy and art. App stores rate drug and alcohol references higher regardless of labels (check the exact rating tiers).
- [ ] Monetization: under the house rule (free version complete, one $5 unlock), what does the unlock add? Candidates: patient profiles beyond Healthy, or life stages after Childhood.

**Risks**

| Risk | Why it matters | Mitigation |
| --- | --- | --- |
| Too little player agency | Auto-fighting units can feel like watching | Skill lives in loadout choice, Sentry placement, aiming Responders, Alarm control and when to invest in Scouts; the slice's success criteria test this |
| Visual noise | 150 small cells on a phone screen | Silhouette and color rules above; tested in the slice |
| Tone | Disease and addiction content can read as mocking or preachy | The disease is always the villain, never the patient |
| Medical accuracy | The educational pitch collapses if the biology is wrong | Review below |

**Medical accuracy review.** Every Field Guide entry, chapter intro and patient-profile "real effect" line gets checked by a physician or immunologist before launch. The areas most likely to be subtly wrong: the alcohol, obesity and meth effects, the cancer and HIV mechanics, and the anaphylaxis framing. The slice's content (cuts, neutrophils, macrophages, platelets, antibodies) is well established and lower risk.
