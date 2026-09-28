# Immune Defense — development notes

This file is for sessions picking up work on Immune Defense. Read
[`README.md`](./README.md) first for the mission and the architecture, and
[`docs/DESIGN.md`](./docs/DESIGN.md) for the game design — this file tracks
*where development actually stands*.

## Before you debug anything

Three things, in this order. Each one is a debugging round somebody already
lost:

1. **Get the build number off the device.** It is the chip next to the title
   and the last line of Settings, read from the worker's cache. A screenshot
   that cannot date itself is not evidence — it cannot tell a live bug from a
   stale install.
2. **Read [`docs/BUGLOG.md`](./docs/BUGLOG.md).** The thing you are about to
   try may already be in there marked *RULED OUT* or *MADE IT WORSE*.
3. **Look your symptom up in GameHub's `setup/LESSONS.md`** (repo
   `neiloza/GameHub`) — bugs already paid for, indexed by symptom rather than
   by cause.

And when you write up what you did: **finding a mechanism is not confirming a
cause.** Say which one you have.

## Current status (as of 2026-09-28)

**Build 5. The first playable slice, after polish, scene, and
"make it kind" passes.** Build 5 took the body off flesh tones altogether
(the owner found even pastel pink disturbing): tissue and muscle are
lavender, the airway sky blue, bone ivory, the app chrome lavender-white;
only the skin surface is a thin peach band and only blood keeps a coral.
The rule is written at the top of `css/tokens.css`: **the body is not
pink.** Built from the design in
[`docs/DESIGN.md`](./docs/DESIGN.md); nobody has played it on a real phone
yet (see *Waiting on a human*).

Build 4 answered four notes from the owner:

- **Not gross.** The body palette went pastel (`css/tokens.css`, with the
  reasoning in its header): coral vessels, rose blood, salmon muscle, a soft
  red clot, a lilac bruise, pale bone chips for debris, a cream puddle with
  a sleeping face for pus. The sweat gland (it read as a worm) is gone, hair
  is warm brown, the vignette is lighter, and soft motes drift up through
  the tissue. Threats stay vivid; the body never is.
- **A real tutorial.** Coach steps gained `hold` (the clock stops while the
  step is up), `unlock` (the toolbar shows a cell only from that step on),
  `done: { ok: true }` (a "Got it" button) and `expires`. Cut is
  `tutorial: true`: it skips the loadout on first play and introduces
  Scout → Devourer → Rusher one at a time, each met, placed and watched
  working before the next appears; Flu and Broken bone pause to introduce
  the Bounty Hunter and the Siren. Hints off = everything at once.
- **Descriptions that land.** Every cell has `verb` + `what` (the headline,
  "**Sees** hidden bacteria") and `how` ("Tap it, then tap a target.").
  `*stars*` in any copy render as a highlight (`rich()` in `js/ui.js`).
- **A toolbar, not a tray.** Bigger cards, a one-line strip above them that
  always says what the chosen cell does and how to deploy it (or why a tap
  was refused — those no longer toast), "?" slots for cells the tutorial
  has not introduced yet.

Build 3 (scenes) painted each level as the tissue it defends, in
`js/render/scenes.js`, chosen by `level.scene`: Cut is a skin cross-section
(stratum corneum, epidermis with rete ridges, dermis with collagen, hair
follicles with sebaceous glands, a sweat gland, fat lobules, a V-shaped cut
that clots, scabs and closes); Flu is a bronchial wall (mucus blanket,
three-tier ciliated epithelium on a basement membrane, capillary web,
smooth muscle, a cartilage plate, alveoli as the "deeper lung"); Broken
bone is an arm (striated muscle in fascicles, fascia, periosteum, compact
cortex with osteons, marrow with fat cells, a jagged break that fills with
hematoma and grows a callus). Vessels meander and branch capillaries but
still pass through every opening tile. The sim is untouched.

Build 2 (the polish pass) changed, on top of build 1:

- **Every player-facing string is ten words or fewer** — cards, hints,
  facts, recaps, tips, cell and threat descriptions, Field Guide terms,
  toasts, settings notes. `test/unit/copy.test.mjs` fails on the eleventh
  word. The between-phase card is now icon + one fact line + a "Next: …"
  button; the phase's hint moved onto the phase banner, where it is read at
  the moment it applies.
- **Sprites** have shaded bodies, drop shadows, blinking eyes with
  catchlights, cheeks on your cells; Rushers stretch and leave speed lines;
  Devourers gulp; bacteria wriggle; virus spikes pulse. Four symbol icons
  (heal, alarm, star, fingerprint) stand for phases on cards.
- **Motion:** things pop in, hit units jitter, kills leave a shrinking
  ghost, bursts and leaks shake the map, the Alarm past 60 burns the edges,
  the heal zone sparkles; in the HTML, meters ease, the Host bar flashes on
  a hit, stars pop in one by one, the recap list slides in, the tray button
  the coach means pulses, buttons press. All off under
  `prefers-reduced-motion` (CSS block at the end of `game.css`; the canvas
  reads `ui.reducedMotion`).
- **Backgrounds:** lit gradients, a vignette, glossy vessels, hairs on the
  skin, motes in the airway.
- Level cards and the loadout head carry the level's threat icon.

Built and working in a desktop Chromium with a phone viewport:

- **Three levels, each a whole illness in four phases:** Cut (the breach →
  the rush → cleanup → closing up), Flu (silent spread → fighting blind →
  the counterattack → mop-up and memory), Broken bone (the break →
  inflammation → rebuilding → remodeling). A card between phases says what
  just happened in the body; the end card retells the arc.
- **Five cells** (Scout, Devourer, Siren as Sentries; Rusher, Bounty Hunter
  as aimed Responders), **five threats** (bacterium, flu virus, infected
  airway cell, debris, pus), neutral Bone Builders.
- **Mechanics:** hidden threats until a Scout reveals them; Scouts carrying
  the virus's Fingerprint to the Barracks, training, then Bounty Hunters that
  copy themselves on kills; bacteria that split and latch onto cells; the
  Alarm meter with its 20–60 healing band and cytokine storm; Healing bars;
  retiring a Sentry.
- **Controls:** tap the tray then the map, or drag from the tray onto the
  map; tap a squad to select, tap a threat or a spot to send it; drag a box
  to select several; Escape/pause; 1×/2× speed; auto-pause when the app is
  left.
- **Screens:** naming your person (first launch), the life map (later life
  stages shown greyed), the loadout picker, the Field Guide (unlocks as you
  meet things), Settings (rename, sound, hints, backup/restore/reset, a
  tester switch that unlocks every level).
- **Coaching** in all three levels, off with the Hints switch; Cut is a
  held, one-cell-at-a-time tutorial (see Build 4 above).
- **PWA:** installable, works offline, network-first worker, real icon set,
  strict CSP in `_headers`, build number in the UI.
- **Tests:** 37 unit tests (every rule watched failing by
  `scripts/mutation-check.mjs`, 23 mutations), a 62-check browser smoke
  test that plays the Cut tutorial's first steps by hand and the level to
  the end, deploy and docs pre-flights. `npm test` is green.

### Difficulty, as measured by bots (2026-09-28, `npm run balance`, 20 seeds)

| Level | idle | casual (reacts every 2 s) | good (every 0.5 s) |
|---|---|---|---|
| Cut | loses 20/20 | wins 20/20, all ★★★ | wins 20/20, all ★★★ |
| Flu | loses 20/20 | wins 16/20: ★×7, ★★×8, ★★★×1 | wins 20/20: ★★★×10, ★★×8, ★×2 |
| Broken bone | loses 20/20 | wins 20/20, all ★★★ (slowly: ~5 min) | wins 20/20, all ★★★ |

Broken bone also has a *reckless* bot that piles on Sirens and never retires
one: it loses 20/20. Bots are a proxy — they aim perfectly and never
hesitate — so these are floors on difficulty, not the difficulty a person
feels. **Treat them as a starting point for playtesting, not a verdict.**

## Where the build departs from docs/DESIGN.md, and why

The doc is the design as written before the build; the code is the fact.
Every number in `js/data/` has been tuned since the doc's first pass — read
the data, not the doc, for values. The behavioural departures:

- **The Alarm is a target-seeking meter** (`js/data/threats.js` ALARM). Its
  target is the sum of what is raising it *right now* — 12 per living Siren,
  3 per piece of debris or pus — and the meter moves toward it (fast up, slow
  down). The doc had it accumulate per enemy-second, which made its value
  depend on history the player cannot see. A target the player can count is
  a decision.
- **Sirens raise the Alarm for as long as they live**, not only with enemies
  in range, and **any Sentry can be retired** (tap it). Without both, the
  Broken bone lesson — inflammation is needed, then has to stop — had no
  control to express it.
- **Devourers creep** up to 1.4 tiles from their post to eat what is nearby.
  A strictly stationary eater with a 1-tile reach cleaned almost nothing.
- **A cell holds off only so many bacteria** (`holds` in `js/data/cells.js`);
  the rest walk past. Without it, two Devourers under the wound absorbed every
  wave and the rush never needed Rushers.
- **Flu keeps sending virus, and the lining keeps regrowing, until the virus
  is learned** (`trickle` and `regrow` on the "Fighting blind" phase). The
  first build soft-locked: a player who never sampled could run the lining
  out of cells, the damage stopped, and the level could be neither won nor
  lost. A unit test and the mutation check now guard this.
- **Broken bone's fragments keep breaking off for as long as rebuilding
  takes**, so healing at half speed (Alarm under 20) costs twice the cleanup.
- **The battle hides the topbar and tab bar** — a deliberate exception to
  GameHub house rule 3, reasoned in a comment in `index.html`.
- **Accounts and the $5 unlock are not wired in.** The kit's order of work
  puts them after the app is worth buying; the kit's account/sync modules
  were removed at scaffold time. The free/paid line is undecided (below).

## Open issues

- **Balance is bot-measured only.** The casual bot gets three stars on Cut
  and Broken bone, so for a *bot* they are easy. People are slower and
  imprecise, so this may be right for levels 1 and 3 — or they may be too
  soft. Flu is the spike: the casual bot loses one run in five. Needs a
  playtest before any retuning.
- **Broken bone can drag** (~5 minutes for a player who keeps one Siren and
  heals at half speed). The design target is 4–7 minutes; check with people.
- **The coach text and the selection pop-up sit over the bottom row of the
  map.** On Cut that is the bloodstream edge, where leaks happen. Compact,
  but still in the way; a person should say whether it matters.
- **Audio is placeholder** synthesis (`js/audio.js`), off by default until
  touched. It has only been checked for "does not throw", never listened to.
- **Performance at scale is unmeasured.** The design target is 60 fps with
  150 units on a mid-range phone. The sim is brute-force O(n²) and costs
  ~10 ms per whole level on a desktop CPU — fine — but canvas drawing on a
  real phone is the unknown.
- **Medical accuracy is unreviewed.** All Field Guide text and phase facts
  are written from general knowledge. Settings says so to the player.

## What to do next

Ordered by leverage. Everything here an agent can do alone.

1. **Act on playtest notes** once *Waiting on a human* item 3 comes back —
   retune `js/data/` and re-run `npm run balance`; keep `npm test` green.
2. **The next Childhood levels** — Chickenpox, Food poisoning, Rusty nail
   (tetanus) — which bring the Patcher, Marksman, encapsulated bacteria and
   Veterans (docs/DESIGN.md, Campaign). The Veteran reward already exists in
   the save; `createGame(level, { known: [...] })` already starts a level with
   a Fingerprint trained.
3. **Haptics on Android** (`navigator.vibrate` on deploy and on a leak), off
   with the sound switch.
4. **A GameHub hub card** pointing at the subdomain, once item 1 below
   exists (in the GameHub repo's `js/games.js`, the way Animas is listed).

## Waiting on a human

**Everything here is blocked on something an agent cannot do from a sandbox: a
credential, a file that needs downloading, a judgement call, or a check against
the real world. Nothing in this list is waiting on code.**

That sentence is the entry test. If a capable agent with this repo and no
outside access could finish it, it belongs in "What to do next". Ordered by
leverage.

- [ ] **Create the hosting project and point `immunedefense.` at it.** Until
      this exists there is no URL, so the game cannot be installed on a phone
      or shared with playtesters — which blocks everything below.
      Needs Cloudflare and registrar logins.
      1. Cloudflare → **Workers & Pages → Create → Pages → Connect to Git** →
         this repo.
      2. Framework preset **None**, build command **empty**, output directory
         **`/`**, production branch **`main`** (see the branch item below).
      3. Note the `*.pages.dev` hostname, then add a CNAME for
         `immunedefense` at the registrar pointing at it.
      Trap: a `package.json` in the repo makes Cloudflare offer
      `npm run build` — there is no such script and the deploy fails. Keep the
      build command empty. And decline Cloudflare's offer to take over the DNS
      zone: other apps share the domain.
      Check after deploy: `curl -sI https://immunedefense.thewizardofoza.com/sw.js`
      must show `cache-control: no-store` — if not, `_headers` was not picked
      up (usually the output directory is not `/`).

- [ ] **Decide what `main` is.** The repo was empty when this work started, so
      the first push created `claude/immune-tower-defense-game-kf4gsx` as its
      only branch, and GitHub made it the default. Either rename it to `main`
      in GitHub (Settings → Branches) or ask a session to push `main`.
      Needs a decision about the repo; an agent should not push `main` unasked.

- [ ] **Play all three levels on a real iPhone and a real Android phone.**
      The smoke test drives a desktop Chromium where safe-area insets are zero,
      thumbs are perfectly precise and there is no GPU to run out of.
      1. Install from the URL (Safari → Share → Add to Home Screen; Chrome's
         install prompt). Launch from the icon: no address bar, nothing under
         the notch or the home indicator.
      2. Play Cut, Flu and Broken bone. Note: can a thumb hit a bacterium?
         Does drag-from-tray feel natural? Is Flu's rush of Bounty Hunters
         smooth, or does it stutter?
      3. Turn sound on (Settings) and listen — it has never been heard.
      4. Force-quit mid-battle and reopen: progress saved, nothing broken.
      Trap: report the build chip with every screenshot.

- [ ] **Run a small playtest (3–5 people, ideally including children).**
      The slice exists to answer the questions in docs/DESIGN.md "What the
      slice must prove". Watch without helping, then ask:
      1. What does a Scout / Devourer / Rusher / Bounty Hunter do? (From the
         name and tile alone.)
      2. After each level: what happened in the body, in order?
      3. Did they start placing Scouts first on their own? Did the Bounty
         Hunter unlock feel like a turning point? Did they ever retire a Siren?
      4. How long did each level take, and where did they get stuck?
      Write the answers into this file, dated.

- [ ] **Medical accuracy review** of every `fact`, `realJob` and term in
      `js/data/` (and docs/DESIGN.md) by a physician or immunologist. The
      educational pitch depends on it. The slice's biology (wound healing,
      neutrophils, macrophages, dendritic cells, killer T cells, fracture
      repair) is well established, so this is about wording, not premise.

- [ ] **Decide the open design questions** in docs/DESIGN.md, which are taste,
      not code: final title, difficulty-profile labels, whether Signal stays
      as the deploy limit, whether Scouts leave automatically, and **what the
      $5 unlock would add** (house rule 7: the free version stays complete and
      export is never gated). Write the free/paid line under Invariants when
      decided.

- [ ] *(recurring — never tick)* **Re-read this list when you pick the project
      back up.** Entries go stale silently.

## File map

| File | Owns |
|---|---|
| `index.html` | Shell: head tags, topbar, views, tab bar, battle layer, sheets |
| `manifest.webmanifest` | Install metadata and icons |
| `sw.js` | Service worker (network-first) and the SHELL list |
| `_headers` | Production headers: CSP, `no-store` on the worker, caching |
| `robots.txt` | Keeps dev-only folders out of search |
| `css/tokens.css` | The palette for HTML and canvas. Retheme here only |
| `css/base.css` | Reset, safe areas, dvh, motion, focus, `[hidden]` |
| `css/components.css` | The kit's shared shell vocabulary |
| `css/game.css` | Life map, loadout, guide, settings, battle |
| `js/app.js` | Boot and wiring |
| `js/version.js` | BUILD, and the build read back from the cache |
| `js/store.js` | Save: `immunedefense:v1`, normalise, migrations, export/import |
| `js/ui.js` | Views, the sheet stack (topmost-only Escape), toasts, `h()` |
| `js/install.js` | The kit's add-to-home-screen decision table |
| `js/audio.js` | Placeholder synthesised sound |
| `js/screens.js` | Life map, loadout, Field Guide, Settings, naming |
| `js/battle.js` | Battle screen: loop, input, HUD, tray, coaching, cards |
| `js/sim/game.js` | The rules: state, step, commands, queries |
| `js/sim/map.js` | Map legend parsing and tile helpers |
| `js/sim/rng.js` | The seeded random generator |
| `js/data/cells.js` | Your cells: every stat and every word |
| `js/data/threats.js` | Threats, and the Signal / Alarm / Host Health rules |
| `js/data/levels.js` | The three levels, their phases and coaching, the life map |
| `js/data/guide.js` | Field Guide terms |
| `js/render/renderer.js` | Draws a game state onto the canvas |
| `js/render/scenes.js` | Each level painted as its tissue: skin, airway, bone; vessels; the wound, lining and fracture |
| `js/render/sprites.js` | Every cell and threat, drawn in code, plus the card symbols; `ICON_TYPES` |
| `js/render/palette.js` | Reads the palette out of `css/tokens.css` |
| `icons/source.svg` | The one icon source; `npm run icons` builds the rest |
| `icons/build-icons.cjs` | The kit's opaque-verified icon builder |
| `test/unit/` | Unit tests (`node --test`): sim, levels, store, copy length |
| `test/bots.mjs` | Scripted players: idle, casual, good, reckless |
| `test/serve.mjs` | Static server that applies the real `_headers` |
| `test/smoke.mjs` | The browser smoke test |
| `scripts/check-deploy.mjs` | Production-only failure modes, checked locally |
| `scripts/check-docs.mjs` | Doc links, anchors and this file map resolve |
| `scripts/balance.mjs` | Difficulty report from the bots |
| `scripts/mutation-check.mjs` | Breaks rules on purpose; the unit tests must notice |
| `docs/DESIGN.md` | The game design (pre-build; the code wins) |
| `docs/BUGLOG.md` | Every attempt at a recurring bug, and how each turned out |

## Invariants — do not break these

### The simulation

- **`js/sim/` is pure.** No DOM, no clock, no `Math.random()` (the deploy
  check fails on one). Replays must be exact, or the tests and the bots stop
  meaning anything.
- **Only the commands in `js/sim/game.js` change the world** — `deploy`,
  `order`, `retire`, `skipCalm`, `continueInterlude`. The UI, the bots and the
  tests all go through them; the renderer only reads. That is what makes
  "the bot won" evidence about the level a person plays.
- **Every balance number lives in `js/data/`.** A literal in `js/sim/` is a
  rule of the game, never a tuning value. Tests import the numbers rather
  than retyping them (LESSONS 7.5), so a retune never turns a test red — a
  broken rule does.
- **Every level must be winnable and must punish doing nothing, and none may
  soft-lock.** Asserted in `test/unit/levels.test.mjs`. A level that can be
  neither won nor lost is the worst bug this game can ship.

### Content ids

- **Ids are permanent**: level ids (`cut`, `flu`, `broken-bone`), phase ids,
  cell ids, threat ids, and guide keys (`cell:scout`, `threat:virus`,
  `term:alarm`, `fact:<level>:<phase>`). Saves point at them. Rename by
  changing the display name, never the id.

### The store

- **State key is `immunedefense:v1`.** Bump the version AND add a migration
  in `js/store.js` if the shape changes incompatibly; never delete an old
  migration.
- **`normalise()` spreads defaults UNDER stored state, one level deep, and
  coerces every collection.** A field added later must not come back
  `undefined` for everyone who saved before it existed.
- **A save from a future version is left alone**, not migrated.
- **Store decisions, never content**: progress by level id, seen-at by guide
  key. Text and stats come from `js/data/`.
- **Export is never gated**, whatever the free/paid line becomes.

### The worker, the CSP and the deploy

- **Every module is in `sw.js` SHELL** — `scripts/check-deploy.mjs` walks the
  import graph and fails otherwise (LESSONS 1.4). Bump `CACHE` in `sw.js` and
  `BUILD` in `js/version.js` together.
- **`sw.js` is served `no-store`** (`_headers`).
- **No inline script, no `style=""`, no `<style>`, no `eval`/`new Function`**
  — the CSP has no `'unsafe-inline'` or `'unsafe-eval'`. JavaScript may set
  styles through the CSSOM (`el.style.x = …`), which the CSP allows. This
  applies to test helpers run in the page too: the smoke test's own first
  draft used `new Function` and the CSP (correctly) refused it.
- **The app makes no third-party request.** When accounts arrive, read
  GameHub `setup/INFRASTRUCTURE.md` "CSP, CORS and the service worker" first.

### Touch

- **Every `:hover` rule stays inside `@media (hover: hover)`.**
- **The canvas is `touch-action: none`** and takes pointer capture; the
  decision tap-vs-drag is made at pointerup from distance, never from a
  module-wide busy flag; `pointercancel` clears any ghost or box (LESSONS
  4.1, 4.3).
- **Escape closes only the topmost sheet** (`js/ui.js` keeps the stack;
  smoke-tested with the Field Guide open over the pause sheet).
- **`[hidden]` must always win** (`css/base.css`): any component that sets
  `display` otherwise shows "hidden" elements — that is how a Retire button
  once appeared on a selection of Rushers.

### Accounts and money

- **Undecided.** No accounts, no payment, no network. When decided, write the
  line here: what free gets, what the $5 adds, and why — house rule 7 (the
  free version is complete; export is never gated; nothing free is taken
  back).

## Conventions

- No build step, no framework, no runtime dependencies. Plain files.
- No analytics, ads, trackers or third-party anything.
- Comments explain *why*; write the paragraph if a cleanup could reintroduce
  a bug.
- **A bug that comes back gets a `docs/BUGLOG.md` entry before it gets a
  fix.**
- **One source of truth.** Colours live in `css/tokens.css` (the canvas reads
  them), numbers and words in `js/data/`, rules in `js/sim/`.
- Educational copy is written for a ten-year-old and checked by an adult who
  knows the biology. Level intros avoid pronouns — the player names the
  person, and the name alone works.
- **Ten words, hard limit, for anything a player reads in play.** Cards,
  hints, facts, recaps, tips, descriptions, toasts, settings notes.
  `test/unit/copy.test.mjs` enforces it on `js/data/` and the static
  paragraphs of `index.html`; strings built in `battle.js` and `screens.js`
  are held to it by review. If a fact needs more, it is a Field Guide entry,
  not a card. A "word" is a whitespace token with a letter or digit in it.

## Testing

```bash
npm test                        # everything below except the last two
node scripts/check-deploy.mjs   # production-only failure modes (121 checks)
node scripts/check-docs.mjs     # doc links, anchors, this file map
npm run test:unit               # 37 unit tests on the sim, data, copy and store (~1 s)
npm run test:smoke              # the browser smoke test (62 checks, ~40 s)
npm run balance                 # difficulty report (not a test)
node scripts/mutation-check.mjs # proves the unit tests can fail (~1 min)
```

What each layer is for:

- **Unit tests** test one rule at a time on fixture levels
  (`test/unit/fixtures.mjs`), plus the level-data validator and the
  winnable/has-teeth floor via the bots.
- **The smoke test** serves the app through the real `_headers` and checks
  the shell (the kit's checks), then the game: naming, loadout, tap and drag
  deploys, the sheet stack, auto-pause, a whole level played by the good bot
  through the app's own running game, a short phone, and booting offline.
  Note what the offline check does **not** prove: the smoke test reloads
  after the worker takes control, so the fetch handler has already cached
  every module. SHELL completeness is `check-deploy.mjs`'s job.
- **The mutation check** breaks 23 rules one at a time (the last lengthens
  a card to eleven words) and fails if the unit tests do not notice. Run it after changing tests or rules. Every assertion
  in the smoke test that was added in this build was also watched failing by
  hand (Escape stack, auto-pause, drag-deploy).

Rules for extending any of them (LESSONS Part 7): every assertion must be
able to fail — break the thing and watch it go red; raise `EXPECTED_CHECKS`
in `test/smoke.mjs` when you add checks; assert the promise, not the
mechanism; wait for a state, never sleep.

Chromium is at `/opt/pw-browsers/chromium` in the agent sandbox — do **not**
run `playwright install` there. Playwright is pinned to the version that
matches it. On a laptop run `npx playwright install chromium` once.

## Deploy

Cloudflare Pages → `immunedefense.thewizardofoza.com`. Framework preset
**None**, build command empty, output directory `/`. DNS stays at the
registrar; adding the subdomain is one CNAME. On each deploy, bump `CACHE`
in `sw.js` and `BUILD` in `js/version.js` together.
