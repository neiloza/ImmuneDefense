/* ============================================================================
 * smoke.mjs — the regression net, in a real browser.
 *
 *   npm test          (after check-deploy, check-docs and the unit tests)
 *   npm run test:smoke
 *
 * From the GameHub kit, extended for a game. Two halves:
 *
 *   THE SHELL — boots, exactly one view, tabs switch, content clears the tab
 *   bar, the install sheet, the worker, the save surviving corrupt, future
 *   and wrong-shaped data, and — once installed — booting OFFLINE.
 *
 *   THE GAME — naming your person, the loadout, a tap-deploy and a DRAG-
 *   deploy, Escape closing only the topmost sheet, leaving the app pausing
 *   the battle, the battle layout at a short phone, and one whole level
 *   (Cut) played to the end card through the app's own running game.
 *
 * Everything is served through the REAL production _headers (test/serve.mjs):
 * the CSP is strict enough to break the app, and a CSP violation is a console
 * error, which fails the run.
 *
 * Four rules for extending this file (LESSONS Part 7):
 *   - every assertion must be able to fail — break the thing, watch it go red;
 *   - raise EXPECTED_CHECKS when you add checks (a truncated run must fail);
 *   - assert the promise, not the mechanism;
 *   - wait for a state, never sleep for one.
 *
 * Chromium is at /opt/pw-browsers/chromium in the agent sandbox; do NOT run
 * `playwright install` there. On a laptop, run `npx playwright install
 * chromium` once, or this dies at launch and prints a scary "0/1 passed".
 * ========================================================================= */

import { chromium } from "playwright";
import { serve } from "./serve.mjs";

/* A floor, not a total: a run that dies half way still prints a tally, and
 * "41/44 passed" reads almost exactly like a healthy run (LESSONS 7.1). */
const EXPECTED_CHECKS = 62;

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass: !!pass, detail });
  console.log(`  ${pass ? "ok  " : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) " +
  "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile Safari/604.1";

let server;
let browser;

/* Wait for a condition in the page, rather than sleeping for it. */
async function until(page, fn, arg, timeout = 15000) {
  try {
    await page.waitForFunction(fn, arg, { timeout, polling: 100 });
    return true;
  } catch {
    return false;
  }
}

try {
  server = await serve();
  const base = `http://127.0.0.1:${server.address().port}/`;
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium",
    args: ["--disable-background-networking", "--disable-component-update"],
  }).catch(() => chromium.launch());

  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent: IPHONE_UA,
  });

  const problems = [];
  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error") problems.push(`console: ${m.text()}`); });
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("response", (r) => { if (r.status() >= 400) problems.push(`${r.status()}: ${r.url()}`); });

  /* ======================================================================
   * First launch
   * ==================================================================== */
  console.log("\nfirst launch");
  await page.goto(base + "?debug&seed=7", { waitUntil: "networkidle" });

  check("boots with exactly one view showing", (await page.locator(".view.active").count()) === 1);
  check("asks who you are protecting", await page.locator("#name-sheet").isVisible());
  await page.keyboard.press("Escape");
  check("the naming sheet cannot be dismissed without an answer", await page.locator("#name-sheet").isVisible());
  await page.fill("#name-input", "  Jill  ");
  await page.click("#name-save");
  check("naming closes the sheet", await until(page, () => document.getElementById("name-sheet").hidden));
  check("the life map is theirs", (await page.locator("#life-title").textContent()) === "Jill's life",
    await page.locator("#life-title").textContent());
  check("level 1 is open and the rest are locked",
    (await page.locator(".level-card:not([disabled])").count()) === 1 &&
    (await page.locator(".level-card[disabled]").count()) === 2);

  /* ======================================================================
   * The shell
   * ==================================================================== */
  console.log("\nshell");
  const secondTab = page.locator(".tab").nth(1);
  const wanted = await secondTab.getAttribute("data-view");
  await secondTab.click();
  const activeCount = await page.locator(".view.active").count();
  check("switching leaves exactly one view active", activeCount === 1, `${activeCount} active`);
  check("the switched-to view is the active one",
    (await page.locator(".view.active").first().getAttribute("id")) === `view-${wanted}`);
  check("active tab marks aria-current", (await secondTab.getAttribute("aria-current")) === "page");
  check("the Field Guide starts mostly locked", (await page.locator("#guide-list .guide-entry.is-locked").count()) > 5);
  await page.locator(".tab").nth(0).click();

  /*
   * The check Forest's notes warn about: tall content overlapping the fixed
   * tab bar because a container lost its bottom padding. Make the page tall,
   * scroll to the bottom, and assert the last line clears the bar. (NOT that
   * the bar's bottom equals the viewport height — for a position:fixed;
   * bottom:0 element that is true by construction and can never fail.)
   */
  const layout = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    const view = document.querySelector(".view.active");
    const probe = document.createElement("div");
    probe.id = "__probe";
    probe.style.height = "1600px";
    const tail = document.createElement("div");
    tail.textContent = "last line of content";
    view.append(probe, tail);
    window.scrollTo(0, document.documentElement.scrollHeight);
    return new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => {
      const tailBox = tail.getBoundingClientRect();
      const barTop = document.querySelector(".tabbar").getBoundingClientRect().top;
      probe.remove(); tail.remove();
      window.scrollTo(0, 0);
      done({
        hScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        tailBottom: Math.round(tailBox.bottom), barTop: Math.round(barTop),
        bg: root.backgroundColor,
        safeB: root.getPropertyValue("--safe-b").trim(),
      });
    })));
  });
  check("no horizontal scroll", !layout.hScroll);
  check("content at the bottom clears the tab bar", layout.tailBottom <= layout.barTop,
    `content ends at ${layout.tailBottom}, bar starts at ${layout.barTop}`);
  check("root paints a background", layout.bg !== "rgba(0, 0, 0, 0)", layout.bg);
  check("the safe-area token exists", !!layout.safeB);

  console.log("\ninstall offer");
  check("offer is visible on iOS", await page.locator("#install-btn").isVisible());
  await page.locator("#install-btn").click();
  check("sheet opens", await until(page, () => !document.getElementById("install-overlay").hidden));
  check("sheet draws the share glyph", (await page.locator("#install-body svg.install-glyph").count()) > 0);
  await page.keyboard.press("Escape");
  check("Escape closes the sheet", await until(page, () => document.getElementById("install-overlay").hidden));

  console.log("\nservice worker");
  check("worker activates", await until(page, async () => {
    const r = await navigator.serviceWorker.getRegistration();
    return !!(r && r.active && navigator.serviceWorker.controller);
  }, null, 20000) || await (async () => { await page.reload({ waitUntil: "networkidle" }); return until(page, () => !!navigator.serviceWorker.controller); })());
  await page.reload({ waitUntil: "networkidle" });
  const chip = await page.locator("#build-chip").textContent();
  const version = await page.evaluate(async () => (await import("./js/version.js")).BUILD);
  check("the build chip reads the running build from the cache", chip === `b${version}`, `chip says "${chip}"`);

  /* ======================================================================
   * The save
   * ==================================================================== */
  console.log("\nsave");
  const store = await page.evaluate(async () => {
    const s = await import("./js/store.js");
    const out = {};
    const keep = localStorage.getItem(s.STORAGE_KEY);
    out.namespacedKey = s.STORAGE_KEY === "immunedefense:v1";
    const fresh = s.loadState();
    fresh.settings.sound = false;
    s.saveState(fresh);
    out.roundTrip = s.loadState().settings.sound === false;
    localStorage.setItem(s.STORAGE_KEY, "{ not json");
    out.survivesCorrupt = s.loadState().settings.sound === true;
    localStorage.setItem(s.STORAGE_KEY, JSON.stringify({ v: 9999, person: { name: "Future" } }));
    out.survivesFuture = s.loadState().person.name === "";
    localStorage.setItem(s.STORAGE_KEY, JSON.stringify({ nope: true }));
    out.survivesGarbage = s.loadState().v === 1;
    // A save written before a field existed must come back whole (LESSONS 3.2).
    localStorage.setItem(s.STORAGE_KEY, JSON.stringify({ v: 1, person: { name: "Old" }, settings: { sound: false } }));
    const old = s.loadState();
    out.oldSaveWhole = old.person.name === "Old" && old.settings.sound === false && old.settings.hints === true && typeof old.progress === "object";
    out.persistResolves = typeof (await s.requestPersistence()) === "boolean";
    if (keep) localStorage.setItem(s.STORAGE_KEY, keep); else localStorage.removeItem(s.STORAGE_KEY);
    return out;
  }).catch((err) => { check("store never throws", false, String(err).split("\n")[0]); return {}; });
  check("key is namespaced and versioned", store.namespacedKey);
  check("saves and reloads", store.roundTrip);
  check("survives corrupt JSON", store.survivesCorrupt);
  check("leaves a future version alone and runs on defaults", store.survivesFuture);
  check("survives an unrecognised shape", store.survivesGarbage);
  check("an old save missing newer fields comes back whole", store.oldSaveWhole);
  check("persistence request resolves, never throws", store.persistResolves);

  /* ======================================================================
   * A battle
   * ==================================================================== */
  console.log("\nthe tutorial");
  await page.locator(".level-card:not([disabled])").first().click();
  check("Cut skips the loadout on first play and opens on the intro card",
    await until(page, () => window.__immune?.card === "intro" && document.getElementById("loadout-sheet").hidden));
  check("the intro names the person", (await page.locator("#battle-card").textContent()).includes("Jill, age 6"));
  await page.click("#card-go");
  check("Begin starts the calm phase", await until(page, () => window.__immune.card === null && window.__immune.game.mode === "calm"));
  check("the toolbar shows only the Scout at first", await until(page, () =>
    document.querySelectorAll(".tray-cell:not(.is-upcoming)").length === 1 &&
    document.querySelector(".tray-cell:not(.is-upcoming)").dataset.cell === "scout"));
  check("the first tip holds the clock and waits for Got it", await until(page, () =>
    !document.getElementById("coach-ok").hidden && window.__immune.game.t === 0));
  await page.click("#coach-ok");

  const painted = await page.evaluate(() => {
    const c = document.getElementById("battle-canvas");
    const ctx = c.getContext("2d");
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    const colours = new Set();
    for (let i = 0; i < d.length; i += 4 * 997) colours.add(`${d[i]},${d[i + 1]},${d[i + 2]}`);
    return colours.size;
  });
  check("the map is painted", painted > 20, `${painted} distinct colours sampled`);

  // Tap-deploy: tap the tray, tap the map.
  const at = (x, y) => page.evaluate(([mx, my]) => window.__immune.mapToClient(mx, my), [x, y]);
  await page.click('.tray-cell[data-cell="scout"]');
  let p = await at(4.5, 5.5);
  await page.mouse.click(p.x, p.y);
  check("tap tray, tap map: a Scout is placed", await until(page, () => window.__immune.game.units.some((u) => u.type === "scout")));
  check("the Devourer unlocks once the Scout is placed", await until(page, () =>
    document.querySelector('.tray-cell[data-cell="devourer"]:not(.is-upcoming)') && !document.getElementById("coach-ok").hidden));
  await page.click("#coach-ok");

  // Drag-deploy: press on the tray, move onto the map, let go.
  const tray = await page.locator('.tray-cell[data-cell="devourer"]').boundingBox();
  p = await at(4.5, 3.5);
  await page.mouse.move(tray.x + tray.width / 2, tray.y + tray.height / 2);
  await page.mouse.down();
  await page.mouse.move(tray.x + tray.width / 2, tray.y - 40, { steps: 4 });
  await page.mouse.move(p.x, p.y, { steps: 8 });
  await page.mouse.up();
  check("drag from the tray onto the map: a Devourer is placed", await until(page,
    () => window.__immune.game.units.some((u) => u.type === "devourer" && Math.abs(u.postY - 3.5) < 0.01)));

  // A tap on terrain refuses, with a reason in the toolbar's strip.
  await page.click('.tray-cell[data-cell="scout"]');
  p = await at(0.5, 7.5);
  await page.mouse.click(p.x, p.y);
  check("a Sentry on a vessel is refused, and says why",
    await until(page, () => /open tissue/.test(document.getElementById("tray-strip").textContent)));

  console.log("\nsheets");
  await page.click("#hud-pause");
  check("pause opens the pause sheet", await until(page, () => !document.getElementById("pause-sheet").hidden && window.__immune.paused));
  await page.click("#pause-guide");
  check("the Field Guide opens over it", await until(page, () => !document.getElementById("entry-sheet").hidden));
  await page.keyboard.press("Escape");
  check("Escape closes only the topmost sheet", await until(page,
    () => document.getElementById("entry-sheet").hidden && !document.getElementById("pause-sheet").hidden));
  await page.keyboard.press("Escape");
  check("a second Escape resumes the battle", await until(page,
    () => document.getElementById("pause-sheet").hidden && !window.__immune.paused));

  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  check("leaving the app pauses the battle", await until(page, () => window.__immune.paused));
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
  });
  await page.click("#pause-resume");

  console.log("\na whole level");
  // Play the app's own game with the good bot, fast, stepping the sim
  // directly; click through each card the UI raises.
  const drive = () => page.evaluate(async () => {
    const G = await import("./js/sim/game.js");
    const B = await import("./test/bots.mjs");
    const g = window.__immune.game;
    for (let i = 0; i < 20 * 90 && (g.mode === "calm" || g.mode === "phase"); i++) {
      if (i % 10 === 0) B.driveOnce(g, "good");
      G.step(g);
    }
    return g.mode;
  });
  let cards = 0;
  for (let round = 0; round < 12; round++) {
    const mode = await drive();
    if (mode === "interlude") {
      await until(page, () => window.__immune.card === "interlude");
      cards++;
      await page.click("#card-go");
      await until(page, () => window.__immune.card === null);
    }
    if (mode === "won" || mode === "lost") break;
  }
  check("every phase ended on a between-phase card", cards === 3, `${cards} cards`);
  check("the level ends on the end card", await until(page, () => window.__immune.card === "end"));
  const endText = await page.locator("#battle-card").textContent();
  check("Cut is won", /Jill is better/.test(endText), endText.slice(0, 60));
  check("the end card retells what happened in the body",
    (await page.locator("#battle-card .card-recap li").count()) === 4);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("immunedefense:v1")).progress.cut);
  check("the result is saved", saved && saved.wins === 1 && saved.stars >= 1, JSON.stringify(saved));
  await page.click("#card-go");
  check("Next opens Flu's loadout", await until(page,
    () => !document.getElementById("loadout-sheet").hidden && /Flu/.test(document.getElementById("loadout-title").textContent)));
  check("Flu offers the Bounty Hunter as needing training",
    /Needs training|New/.test(await page.locator("#loadout-body").textContent()) &&
    (await page.locator("#loadout-body .cell-tile").count()) === 4);
  await page.locator("#loadout-body .cell-tile").nth(0).click();
  check("un-picking a cell blocks Start", await page.locator(".loadout-start").isDisabled());
  await page.locator("#loadout-body .cell-tile").nth(0).click();
  await page.keyboard.press("Escape");
  check("the life map shows the win", (await page.locator(".level-card .level-stars .on").count()) >= 1);
  check("the Field Guide learned what was met",
    (await page.locator(".tab").nth(1).click(), await page.locator("#guide-list .guide-entry:not(.is-locked)").count()) >= 4);
  await page.locator(".tab").nth(0).click();

  /* ======================================================================
   * A short phone
   * ==================================================================== */
  console.log("\nshort phone (375×667)");
  await page.setViewportSize({ width: 375, height: 667 });
  await page.locator(".level-card:not([disabled])").nth(1).click();
  await until(page, () => !document.getElementById("loadout-sheet").hidden);
  await page.click(".loadout-start");
  await until(page, () => window.__immune?.card === "intro");
  await page.click("#card-go");
  const geo = await page.evaluate(() => {
    const stage = document.getElementById("battle-stage").getBoundingClientRect();
    const tray = document.querySelector(".battle-tray").getBoundingClientRect();
    const hud = document.querySelector(".battle-hud").getBoundingClientRect();
    const buttons = [...document.querySelectorAll(".tray-cell")].map((b) => b.getBoundingClientRect());
    return {
      stageH: Math.round(stage.height), hudBottom: Math.round(hud.bottom), stageTop: Math.round(stage.top),
      stageBottom: Math.round(stage.bottom), trayTop: Math.round(tray.top), trayBottom: Math.round(tray.bottom),
      innerH: innerHeight, minButton: Math.min(...buttons.map((b) => Math.min(b.width, b.height))),
      hScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    };
  });
  check("the map gets real height on a short phone", geo.stageH > 300, `${geo.stageH}px`);
  check("the HUD, map and tray do not overlap", geo.hudBottom <= geo.stageTop && geo.stageBottom <= geo.trayTop,
    JSON.stringify(geo));
  check("the tray fits on screen", geo.trayBottom <= geo.innerH, `tray ends at ${geo.trayBottom} of ${geo.innerH}`);
  check("every tray button is at least 44px", geo.minButton >= 44, `smallest side ${geo.minButton}px`);
  check("no horizontal scroll in a battle", !geo.hScroll);
  const trayTexts = await page.locator(".tray-name").allTextContents();
  check("Flu's tray shows four cells", trayTexts.length === 4, trayTexts.join(", "));
  await page.click("#hud-pause");
  await page.click("#pause-quit");
  check("leaving a level returns to the life map", await until(page, () => document.getElementById("battle").hidden &&
    document.querySelector(".view.active")?.id === "view-life"));

  /* ======================================================================
   * Installed and offline
   * ==================================================================== */
  console.log("\noffline");
  await ctx.setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
  check("boots offline from the worker's cache", await until(page, () => document.querySelectorAll(".view.active").length === 1));
  await page.locator(".level-card:not([disabled])").first().click();
  await until(page, () => !document.getElementById("loadout-sheet").hidden);
  await page.click(".loadout-start");
  check("and a level still starts offline", await until(page, () => window.__immune?.card === "intro"));
  await ctx.setOffline(false);

  console.log("\nerrors");
  check("no console errors, page errors or 4xx", problems.length === 0, problems.slice(0, 4).join(" | "));
} catch (err) {
  check("run completed without an unexpected error", false, String(err).split("\n")[0]);
} finally {
  await browser?.close();
  server?.close();
}

const failed = results.filter((r) => !r.pass);
if (results.length < EXPECTED_CHECKS) {
  console.log(`\nFAIL  only ${results.length} of at least ${EXPECTED_CHECKS} checks ran — the run was cut short`);
}
console.log(`\n${results.length - failed.length}/${results.length} passed\n`);
process.exit(failed.length || results.length < EXPECTED_CHECKS ? 1 : 0);
