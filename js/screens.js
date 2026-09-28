/* ============================================================================
 * screens.js — everything outside a battle: the life map, the loadout picker,
 * the Field Guide, Settings and the naming sheet.
 *
 * Built with h() (ui.js), never innerHTML: the player's name is user input
 * and must never be parsed as markup, and the CSP forbids the inline styles
 * innerHTML tends to smuggle in.
 * ========================================================================= */

import { CELLS, CELL_ORDER, NEUTRALS } from "./data/cells.js";
import { THREATS } from "./data/threats.js";
import { LEVELS, STAGES, levelById, cellsAvailableAt, personalise } from "./data/levels.js";
import { TERMS } from "./data/guide.js";
import { drawIcon } from "./render/sprites.js";
import { readPalette } from "./render/palette.js";
import { h, openSheet, closeSheet, showView, toast, rich } from "./ui.js";
import {
  isUnlocked, cleanName, exportState, importState, defaultState, NAME_MAX,
} from "./store.js";
import { runningBuild, BUILD } from "./version.js";

export function createScreens(app) {
  const $ = (id) => document.getElementById(id);
  let pal = readPalette();

  function who() { return app.state.person.name || "Billy"; }

  function icon(type, size = 44) {
    const c = h("canvas", { class: "cell-icon", width: size, height: size, "aria-hidden": "true" });
    requestAnimationFrame(() => drawIcon(c, pal, type));
    return c;
  }

  /* ---- the life map --------------------------------------------------------- */

  function renderLife() {
    const name = who();
    $("life-title").textContent = `${name}'s life`;
    $("life-sub").textContent = `You are ${name}'s immune system.`;

    const nextId = LEVELS.find((l) => isUnlocked(app.state, l.id) && !(app.state.progress[l.id]?.wins > 0))?.id;
    const stages = STAGES.map((stage) => {
      const levels = stage.levels.map(levelById).filter(Boolean);
      const open = levels.length > 0;
      const list = open ? h("ul", { class: "level-list" }, ...levels.map((lv) => h("li", {}, levelCard(lv, lv.id === nextId)))) : null;
      const later = stage.later.length
        ? [h("ul", { class: "later-list", "aria-label": "Coming later" }, ...stage.later.map((t) => h("li", { class: "later-item", text: t }))),
          h("p", { class: "later-note", text: "Coming later." })]
        : [];
      return h("section", { class: `stage ${open ? "" : "stage-locked"}` },
        h("div", { class: "stage-head" },
          h("h2", { class: "stage-name", text: stage.name }),
          h("span", { class: "stage-ages", text: `Ages ${stage.ages}` })),
        list,
        ...later);
    });

    const vets = Object.keys(app.state.veterans);
    const vetRow = vets.length
      ? h("div", { class: "veterans" }, ...vets.map((v) => h("span", { class: "badge badge-good", text: `Veteran: ${v === "flu" ? "Flu" : v}` })))
      : null;
    $("life-stages").replaceChildren(...(vetRow ? [vetRow] : []), ...stages);
  }

  function levelCard(lv, isNext) {
    const rec = app.state.progress[lv.id];
    const unlocked = isUnlocked(app.state, lv.id);
    const stars = rec?.stars || 0;
    return h("button", {
      class: `level-card ${isNext ? "is-next" : ""}`,
      type: "button",
      disabled: !unlocked,
      "aria-label": `${lv.title}, age ${lv.age}. ${unlocked ? `${stars} of 3 stars` : "Locked — win the level before it"}`,
      onclick: () => openLoadout(lv.id),
    },
    h("span", { class: "level-icon-wrap" }, unlocked ? icon(lv.icon, 52) : h("span", { class: "level-lock", "aria-hidden": "true", text: "🔒" })),
    h("span", { class: "level-main" },
      h("p", { class: "level-kind", text: `Age ${lv.age} · ${lv.threatKind}` }),
      h("p", { class: "level-title", text: lv.title }),
      h("p", { class: "level-intro", text: unlocked ? personalise(lv.intro, who()) : "Win the level before it." })),
    h("span", { class: "level-stars", "aria-hidden": "true" },
      ...[1, 2, 3].map((k) => h("span", { class: k <= stars ? "on" : "", text: "★" }))));
  }

  /* ---- the loadout ------------------------------------------------------------ */

  /* Cells that exist but cannot help in this level. Offered, marked, and not
   * picked by default — a Bounty Hunter in a level with no Barracks can never
   * be trained, and a loadout slot spent on it is a slot wasted without
   * anything on screen saying why. */
  function uselessHere(level, id) {
    const def = CELLS[id];
    if (def.needsFingerprint && (!level.barracks || level.barracks.fingerprint !== def.needsFingerprint)) {
      return "No use here";
    }
    return null;
  }

  function defaultPick(level) {
    const avail = cellsAvailableAt(level.id);
    const saved = (app.state.loadouts[level.id] || []).filter((c) => avail.includes(c));
    const pick = [...level.requiredCells];
    const add = (c) => { if (pick.length < level.slots && !pick.includes(c) && !uselessHere(level, c)) pick.push(c); };
    for (const c of saved) add(c);
    for (const c of level.newCells) add(c);
    for (const c of CELL_ORDER) if (avail.includes(c)) add(c);
    return pick;
  }

  function openLoadout(levelId) {
    const level = levelById(levelId);
    if (!level || !isUnlocked(app.state, levelId)) return;
    // A tutorial level on first play goes straight in: it introduces its
    // cells itself, one at a time, so a picker would be choosing between
    // things the player has not met.
    if (level.tutorial && !(app.state.progress[level.id]?.wins > 0)) {
      app.startLevel(level.id, defaultPick(level));
      return;
    }
    const avail = CELL_ORDER.filter((c) => cellsAvailableAt(level.id).includes(c));
    const usable = avail.filter((c) => !uselessHere(level, c));
    const need = Math.min(level.slots, usable.length);
    let pick = defaultPick(level);

    const count = h("p", { class: "loadout-count" });
    const start = h("button", {
      class: "btn btn-primary btn-block loadout-start", type: "button",
      onclick: () => {
        app.state.loadouts[level.id] = [...pick];
        app.persist();
        closeSheet("loadout-sheet");
        app.startLevel(level.id, pick);
      },
    });
    const grid = h("div", { class: "cell-grid" });

    function refresh() {
      grid.replaceChildren(...avail.map((id) => {
        const def = CELLS[id];
        const required = level.requiredCells.includes(id);
        const picked = pick.includes(id);
        const useless = uselessHere(level, id);
        const flag = required ? "Required" : level.newCells.includes(id) ? "New"
          : useless || (def.needsFingerprint ? "Needs training" : null);
        const kind = def.kind === "sentry" ? "Sentry" : "Aim";
        return h("button", {
          class: `cell-tile ${picked ? "is-picked" : ""} ${required ? "is-required" : ""}`,
          type: "button",
          "aria-pressed": picked ? "true" : "false",
          disabled: !!useless && !picked,
          onclick: () => {
            if (required) { toast(`${def.name} is required here.`); return; }
            if (picked) pick = pick.filter((c) => c !== id);
            else if (pick.length < level.slots) pick.push(id);
            else { toast(`Only ${level.slots} slots. Tap one to swap.`); return; }
            refresh();
          },
        },
        flag ? h("span", { class: `cell-flag ${flag === "New" ? "cell-flag-new" : ""}`, text: flag }) : null,
        icon(id),
        h("span", {},
          h("p", { class: "cell-name", text: def.name }),
          h("p", { class: "cell-real", text: def.realName }),
          h("span", { class: "cell-meta" },
            h("span", { class: `pill pill-${kind.toLowerCase()}`, text: kind }),
            h("span", { class: "pill pill-cost", text: `${def.cost} Signal` }))),
        h("p", { class: "cell-head" }, ...rich(`*${def.verb}* ${def.what}`)),
        h("p", { class: "cell-line", text: def.how }));
      }));
      count.textContent = `${pick.length} of ${level.slots} picked`;
      start.disabled = pick.length < need;
      start.textContent = pick.length < need ? `Pick ${need - pick.length} more` : `Start: ${level.title}`;
    }
    refresh();

    $("loadout-title").textContent = `${level.title} · age ${level.age}`;
    $("loadout-body").replaceChildren(
      h("div", { class: "loadout-head" },
        icon(level.icon, 56),
        h("div", {},
          h("p", { class: "loadout-intro", text: personalise(level.intro, who()) }),
          h("p", { class: "loadout-teaches", text: level.teaches }))),
      count, grid, start);
    openSheet("loadout-sheet");
  }

  /* ---- the Field Guide -------------------------------------------------------- */

  function seen(id) { return !!app.state.seen[id]; }

  function firstLevelWith(pred) {
    return LEVELS.find(pred)?.title || "a later level";
  }

  function guideEntries() {
    const cells = CELL_ORDER.map((id) => ({
      key: `cell:${id}`, type: id, name: CELLS[id].name, real: CELLS[id].realName,
      head: `*${CELLS[id].verb}* ${CELLS[id].what}`,
      line: CELLS[id].job, realJob: CELLS[id].realJob,
      where: firstLevelWith((l) => l.newCells.includes(id)),
      rows: [["Kind", CELLS[id].kind === "sentry" ? "Sentry (stays put)" : "Aimed (goes where sent)"],
        ["Costs", `${CELLS[id].cost} Signal`], ["Good against", CELLS[id].goodAgainst.join(", ")]],
    }));
    const neutral = [{
      key: "cell:builder", type: "builder", name: NEUTRALS.builder.name, real: NEUTRALS.builder.realName,
      line: NEUTRALS.builder.job, realJob: NEUTRALS.builder.realJob, where: "Broken bone", rows: [],
    }];
    const threats = Object.values(THREATS).map((t) => ({
      key: `threat:${t.id}`, type: t.id, name: t.name, real: "Threat", line: t.line, realJob: t.realJob,
      where: firstLevelWith((l) => l.phases.some((p) => (p.spawns || []).some((s) => s.type === t.id)) ||
        (t.id === "infected" && l.barracks) || (t.id === "pus" && l.newCells.includes("rusher"))),
      rows: [],
    }));
    return { cells: [...cells, ...neutral], threats };
  }

  function entryTile(e) {
    const known = seen(e.key);
    return h("button", {
      class: `cell-tile guide-entry ${known ? "" : "is-locked"}`,
      type: "button",
      disabled: !known,
      onclick: () => openEntry(e),
    },
    known ? icon(e.type) : h("span", { class: "cell-icon", "aria-hidden": "true" }),
    h("span", {},
      h("p", { class: "cell-name", text: known ? e.name : "???" }),
      h("p", { class: "cell-real", text: known ? e.real : `Meet it in ${e.where}` })),
    known && e.head ? h("p", { class: "cell-head" }, ...rich(e.head)) : null,
    known ? h("p", { class: "cell-line", text: e.line }) : null);
  }

  function openEntry(e) {
    $("entry-title").textContent = e.name;
    $("entry-body").replaceChildren(
      h("div", { class: "cell-tile is-required" },
        icon(e.type),
        h("span", {}, h("p", { class: "cell-name", text: e.name }), h("p", { class: "cell-real", text: e.real }))),
      e.head ? h("p", { class: "cell-head guide-head" }, ...rich(e.head)) : null,
      h("p", { class: "guide-real-job" }, h("strong", { text: "In the game " }), e.line),
      h("p", { class: "guide-real-job" }, h("strong", { text: "In real life " }), e.realJob),
      e.rows.length ? h("dl", { class: "guide-row" }, ...e.rows.flatMap(([k, v]) => [h("dt", { text: k }), h("dd", { text: v })])) : null,
    );
    openSheet("entry-sheet");
  }

  function renderGuide() {
    const { cells, threats } = guideEntries();
    const terms = TERMS.map((t) => {
      const known = seen(t.id);
      return h("div", { class: `cell-tile guide-entry ${known ? "" : "is-locked"}` },
        h("span", { class: "cell-icon", "aria-hidden": "true" }),
        h("span", {},
          h("p", { class: "cell-name", text: known ? t.name : "???" }),
          h("p", { class: "cell-real", text: known ? `Real name: ${t.realName}` : "Not met yet" })),
        known ? h("p", { class: "cell-line", text: t.line }) : null);
    });
    const facts = LEVELS.flatMap((l) => l.phases
      .filter((p) => seen(`fact:${l.id}:${p.id}`))
      .map((p) => h("li", {}, h("span", { class: "fact-level", text: `${l.title} — ${p.name}: ` }), p.fact)));
    $("guide-list").replaceChildren(
      h("section", { class: "guide-section" },
        h("h2", { class: "guide-section-title", text: "Your cells" }),
        h("div", { class: "cell-grid" }, ...cells.map(entryTile))),
      h("section", { class: "guide-section" },
        h("h2", { class: "guide-section-title", text: "Threats" }),
        h("div", { class: "cell-grid" }, ...threats.map(entryTile))),
      h("section", { class: "guide-section" },
        h("h2", { class: "guide-section-title", text: "Words" }),
        h("div", { class: "cell-grid" }, ...terms)),
      h("section", { class: "guide-section" },
        h("h2", { class: "guide-section-title", text: "What happens in the body" }),
        facts.length ? h("ol", { class: "fact-list" }, ...facts)
          : h("p", { class: "view-sub", text: "Finish a phase to fill this in." })),
    );
  }

  /* The pause sheet's Field Guide: this level's cells and threats only, in a
   * sheet, so the battle stays exactly where it was underneath. */
  function openLevelGuide(levelId) {
    const level = levelById(levelId);
    const { cells, threats } = guideEntries();
    const cellIds = new Set(cellsAvailableAt(levelId));
    const pick = [...cells.filter((e) => cellIds.has(e.type) || (e.type === "builder" && level.id === "broken-bone")),
      ...threats.filter((e) => seen(e.key))];
    $("entry-title").textContent = "Field Guide";
    $("entry-body").replaceChildren(
      h("div", { class: "cell-grid" }, ...pick.map((e) => {
        const known = seen(e.key);
        return h("div", { class: `cell-tile guide-entry ${known ? "" : "is-locked"}` },
          known ? icon(e.type) : h("span", { class: "cell-icon" }),
          h("span", {},
            h("p", { class: "cell-name", text: known ? e.name : "???" }),
            h("p", { class: "cell-real", text: known ? e.real : "Not met yet" })),
          known ? h("p", { class: "cell-line", text: `${e.line} Real life: ${e.realJob}` }) : null);
      })));
    openSheet("entry-sheet");
  }

  /* ---- settings --------------------------------------------------------------- */

  function toggle(label, on, onChange, note) {
    const sw = h("button", {
      class: "switch", type: "button", role: "switch", "aria-checked": on ? "true" : "false", "aria-label": label,
      onclick: () => {
        const next = sw.getAttribute("aria-checked") !== "true";
        sw.setAttribute("aria-checked", next ? "true" : "false");
        onChange(next);
      },
    });
    return h("div", {},
      h("div", { class: "settings-row" }, h("span", { class: "settings-label", text: label }), sw),
      note ? h("p", { class: "settings-note", text: note }) : null);
  }

  function renderSettings() {
    const buildLine = h("p", { class: "build-line", text: `Build ${BUILD}` });
    runningBuild().then((b) => { buildLine.textContent = `Build running on this device: ${b}`; });

    const fileInput = h("input", {
      class: "file-input", type: "file", accept: "application/json,.json", id: "import-file", "aria-hidden": "true", tabindex: "-1",
      onchange: async () => {
        const f = fileInput.files && fileInput.files[0];
        if (!f) return;
        const text = await f.text().catch(() => "");
        const next = importState(text);
        fileInput.value = "";
        if (!next) { toast("Not an Immune Defense backup."); return; }
        app.replaceState(next);
        toast("Progress restored.");
      },
    });

    $("settings-body").replaceChildren(
      h("div", { class: "panel settings-group" },
        h("h2", { class: "panel-head", text: "Your person" }),
        h("div", { class: "settings-row" },
          h("span", { class: "settings-label", text: who() }),
          h("button", { class: "btn btn-small", type: "button", onclick: () => openNameSheet(false) }, "Rename"))),
      h("div", { class: "panel settings-group" },
        h("h2", { class: "panel-head", text: "Play" }),
        toggle("Sound", app.state.settings.sound, (v) => app.setSound(v)),
        toggle("Hints", app.state.settings.hints, (v) => { app.state.settings.hints = v; app.persist(); },
          "Coaching tips during battles.")),
      h("div", { class: "panel settings-group" },
        h("h2", { class: "panel-head", text: "Your progress" }),
        h("p", { class: "settings-note", text: "Progress stays on this device. Back it up to move it." }),
        h("div", { class: "settings-actions" },
          h("button", { class: "btn btn-block", type: "button", onclick: exportProgress }, "Save a backup file"),
          h("button", { class: "btn btn-block", type: "button", onclick: () => fileInput.click() }, "Restore from a backup file"),
          fileInput,
          h("button", {
            class: "btn btn-danger btn-block", type: "button",
            onclick: () => confirm("Reset all progress? Stars, Veterans and the Guide restart.", () => {
              const fresh = defaultState();
              fresh.person.name = app.state.person.name;
              fresh.settings = { ...app.state.settings };
              app.replaceState(fresh);
              toast("Progress reset.");
            }),
          }, "Reset progress"))),
      h("div", { class: "panel settings-group" },
        h("h2", { class: "panel-head", text: "For testers" }),
        toggle("Unlock all levels", app.state.tester.unlockAll, (v) => { app.state.tester.unlockAll = v; app.persist(); renderLife(); },
          "Opens every level. Rules unchanged.")),
      h("div", { class: "panel settings-group" },
        h("h2", { class: "panel-head", text: "About" }),
        h("p", { class: "settings-note", text: "No ads, no accounts, no tracking." }),
        h("p", { class: "settings-note", text: "Biology simplified, not yet doctor-checked. Not medical advice." }),
        buildLine),
    );
  }

  function exportProgress() {
    try {
      const blob = new Blob([exportState(app.state)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = h("a", { href: url, download: `immunedefense-backup-${new Date().toISOString().slice(0, 10)}.json` });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      toast("Backup saved.");
    } catch {
      toast("Could not save a file on this device.");
    }
  }

  let confirmAction = null;
  function confirm(copy, action) {
    $("confirm-copy").textContent = copy;
    confirmAction = action;
    openSheet("confirm-sheet");
  }
  $("confirm-yes").addEventListener("click", () => {
    const act = confirmAction;
    confirmAction = null;
    closeSheet("confirm-sheet");
    act?.();
  });

  /* ---- naming your person ----------------------------------------------------- */

  function openNameSheet(first) {
    const sheet = $("name-sheet");
    if (first) sheet.setAttribute("data-sticky", "");
    else sheet.removeAttribute("data-sticky");
    const input = $("name-input");
    input.value = first ? "" : app.state.person.name;
    input.maxLength = NAME_MAX;
    $("name-title").textContent = first ? "Who are you protecting?" : "Rename your person";
    $("name-save").textContent = first ? "Start their life" : "Save";
    openSheet("name-sheet");
  }

  $("name-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = cleanName($("name-input").value) || "Billy";
    app.state.person.name = name;
    app.persist();
    $("name-sheet").removeAttribute("data-sticky");
    closeSheet("name-sheet");
    renderAll();
    showView("life");
  });

  function renderAll() {
    pal = readPalette();
    renderLife();
    renderGuide();
    renderSettings();
  }

  return { renderAll, renderLife, renderGuide, openLoadout, openNameSheet, openLevelGuide };
}
