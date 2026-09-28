/* ============================================================================
 * app.js — boot and wiring. Everything else is a module this file connects.
 *
 *   js/sim/        the rules (pure; also run by the tests and the bots)
 *   js/render/     the canvas art
 *   js/battle.js   the battle screen
 *   js/screens.js  the life map, loadout, Field Guide, Settings
 *   js/store.js    progress on this device
 *
 * Accounts and the $5 unlock from the GameHub kit are deliberately NOT wired
 * in yet: the kit's own order of work puts them after the app is worth
 * buying, and this is the first playable slice. The free/paid line is an open
 * decision recorded in CLAUDE.md. Until then the app makes no network request
 * of any kind beyond its own files.
 * ========================================================================= */

import { initTabs, initSheets, toast, showView, closeSheet } from "./ui.js";
import { initInstall } from "./install.js";
import {
  loadState, saveState, requestPersistence, recordResult,
} from "./store.js";
import { LEVELS, levelById } from "./data/levels.js";
import { runningBuild } from "./version.js";
import { setSoundEnabled, unlockAudio } from "./audio.js";
import { createScreens } from "./screens.js";
import { createBattle } from "./battle.js";

let state = loadState();

const app = {
  get state() { return state; },
  persist() { saveState(state); },
  replaceState(next) {
    state = next;
    saveState(state);
    setSoundEnabled(state.settings.sound);
    screens.renderAll();
  },
  setSound(on) {
    state.settings.sound = !!on;
    setSoundEnabled(state.settings.sound);
    saveState(state);
  },
  recordResult(levelId, outcome) {
    recordResult(state, levelId, outcome);
    saveState(state);
  },
  nextLevelAfter(levelId) {
    const i = LEVELS.findIndex((l) => l.id === levelId);
    return i >= 0 && i < LEVELS.length - 1 ? LEVELS[i + 1] : null;
  },
  startLevel(levelId, loadout) {
    const level = levelById(levelId);
    if (level) battle.start(level, loadout);
  },
};

let screens;
let battle;

function boot() {
  requestPersistence();
  setSoundEnabled(state.settings.sound);

  initTabs("life");
  initSheets();
  initInstall({ onInstalled: () => toast("Immune Defense is on your home screen.") });

  screens = createScreens(app);
  battle = createBattle({
    app,
    onOpenGuide: (levelId) => screens.openLevelGuide(levelId),
    onExit: (result) => {
      screens.renderAll();
      showView("life");
      if (result && result.next) screens.openLoadout(result.next);
    },
  });

  screens.renderAll();
  document.addEventListener("view:change", (e) => {
    // The Field Guide learns things during battles; redraw it when shown.
    if (e.detail?.name === "guide") screens.renderGuide();
  });

  // The build on this device, read from the worker's cache rather than from
  // a constant (js/version.js explains why).
  runningBuild().then((b) => { const chip = document.getElementById("build-chip"); if (chip) chip.textContent = b; });

  // Browsers only start audio from a gesture; the first touch anywhere will do.
  document.addEventListener("pointerdown", unlockAudio, { passive: true });

  if (!state.person.name) screens.openNameSheet(true);

  // Register the worker after `load` so it never competes with first paint.
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").then(() => {
        runningBuild().then((b) => { const chip = document.getElementById("build-chip"); if (chip) chip.textContent = b; });
      }).catch(() => {});
    });
  }

  // ?level=<id> opens that level's loadout directly — a tester's shortcut.
  const want = new URLSearchParams(location.search).get("level");
  if (want && levelById(want) && state.person.name) {
    closeSheet("name-sheet");
    screens.openLoadout(want);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}

export { app };
