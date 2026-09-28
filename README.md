# Immune Defense

Be the immune system of someone you name. A tower defense game where every
level is a real illness, and you win the way the body really does.

This file is the mission and the architecture. Where development actually
stands — what works, what is broken, what is waiting on a person — is in
[`CLAUDE.md`](./CLAUDE.md). The full design is in
[`docs/DESIGN.md`](./docs/DESIGN.md).

## Core mission

A game that leaves a player able to explain, in plain words, how the body
fights a cut, a cold and a broken bone. Cells are named for their job —
Scout, Devourer, Rusher, Bounty Hunter, Siren — with the real name
(dendritic cell, macrophage, neutrophil, killer T cell, mast cell) always
underneath, so function comes first and the jargon sticks to it afterwards.

**The biology is the rules.** Every mechanic maps to something real: threats
stay hidden until a Scout finds them, the body has to *learn* a virus before
it can kill infected cells, inflammation speeds everything up but damages the
tissue past a point. If a rule has no biological basis, it is cut or flagged.

It refuses the things this family of apps refuses: no ads, no tracking, no
accounts required, no dark patterns. Nothing leaves the device.

## How it works

1. **Name your person** (Billy, Jill, anyone). The game follows them through
   their life, starting in childhood.
2. **Pick a level** from their life map — Cut (age 6), Flu (age 7), Broken
   bone (age 9) — and a **loadout** of cells to bring.
3. **Place Sentries** during a short calm before the threat arrives. Sentries
   stay where you put them and fight on their own.
4. **Deploy and aim Responders** as the threat shows itself: tap a cell in the
   tray, then tap the map (or drag straight from the tray). Tap a squad to
   select it and tap again to redirect; drag a box to grab several.
5. Each level plays **the illness from start to finish as phases** — the
   breach, the rush, the cleanup, the healing — with a card between phases
   saying what just happened in the body.
6. The end card **retells the whole arc**, and the Field Guide keeps every
   cell, threat and fact you have met.

## Structure

The app is plain files: no build step, no framework, no runtime
dependencies. It was scaffolded from the GameHub starter kit
(`neiloza/GameHub` → `setup/starter-kit/`) and keeps its house rules.

| Path | What it is |
|---|---|
| `index.html` | The shell: head tags, topbar, views, tab bar, the battle layer, sheets |
| `css/tokens.css` | The palette — for the HTML **and** the canvas. Retheming happens here only |
| `css/base.css`, `css/components.css` | The kit's reset, geometry and shell vocabulary |
| `css/game.css` | Life map, loadout, Field Guide, settings, battle |
| `js/app.js` | Boot and wiring |
| `js/sim/` | **The rules**: a pure, seeded, deterministic simulation (no DOM) |
| `js/data/` | **Every number and every word** the game uses: cells, threats, levels, guide |
| `js/render/` | The canvas: each level painted as its tissue, procedural cell art, effects |
| `js/battle.js` | The battle screen: loop, touch input, HUD, tray, coaching, cards |
| `js/screens.js` | Life map, loadout, Field Guide, Settings, naming |
| `js/store.js` | Progress on this device: `immunedefense:v1`, migrations, export/import |
| `js/audio.js` | Placeholder synthesised sound |
| `js/version.js` | The build number, read back from the worker's cache |
| `sw.js` | Service worker (network-first) |
| `_headers` | Production headers, including a strict CSP |
| `test/` | Unit tests, scripted bots, the browser smoke test |
| `scripts/` | Deploy pre-flight, docs check, balance report, mutation check |

Two rules shape the writing: cells are named for their job with the real
name underneath, and **nothing a player reads in play is longer than ten
words** — a test enforces it. Longer explanations live in the Field Guide.

The one idea that shapes everything: **the game is a pure function of
(level, seed, taps).** The same `js/sim/game.js` runs in the browser, in the
unit tests, and under the scripted bots that measure how hard each level is.
The battle screen owns no rules; it sends commands and draws what the sim
says happened.

## Running locally

```bash
npm install          # dev tools only — nothing ships to the browser
npm run serve        # then open http://localhost:8000/
```

The page must be served over http (ES modules), so double-clicking
`index.html` will not work. Useful URL switches while testing:
`?level=flu` opens a level's loadout directly, `?debug` exposes a read-only
`window.__immune` for tests, `?seed=7` fixes the randomness. Settings →
*For testers* → *Unlock all levels* opens every level.

## Testing

```bash
npm test             # deploy checks, docs check, unit tests, browser smoke test
npm run balance      # how hard each level is, measured with bots (a report, not a test)
node scripts/mutation-check.mjs   # proves the unit tests can fail
```

See [`CLAUDE.md`](./CLAUDE.md#testing) for what each layer covers and the
rules for extending them.

## Icons

```bash
npm run icons
```

Reads `icons/source.svg` and writes the full set, including the 192 and 512
PNGs Chrome requires and the maskable copies Android needs. Every PNG is
byte-verified opaque. Never hand-edit one; change the SVG and re-run.

## Deploying

Cloudflare Pages → `immunedefense.thewizardofoza.com`.

| Setting | Value |
|---|---|
| Production branch | `main` |
| Framework preset | **None** |
| Build command | *(empty)* |
| Build output directory | `/` |

Then one CNAME at the registrar pointing the subdomain at the `*.pages.dev`
hostname. Nameservers do not move — other apps share the domain.

Everything at the repo root is published, `test/` and `docs/` included.
That is harmless (dev-only, never loaded by the app, marked `noindex` in
`_headers` and disallowed in `robots.txt`) but worth knowing.
