/* ============================================================================
 * check-deploy.mjs — the pre-flight for things that break ONLY in production.
 *
 *   node scripts/check-deploy.mjs      (first step of `npm test`)
 *
 * Every check here is a failure mode that is invisible in local development
 * and was paid for by another app on the kit (GameHub setup/LESSONS.md):
 *
 *   1.4  a module missing from sw.js SHELL works perfectly until someone
 *        installs the app and opens it on a plane — so walk the import graph
 *   2.2  an icon whose real pixel size disagrees with the manifest makes the
 *        app silently uninstallable — so read the PNG's IHDR
 *   1.2  a weakened no-store on sw.js lets a broken worker outlive its fix
 *   1.6  an inline script or style is silently blocked by the CSP
 *   P3   bumping the build number without the cache (or the reverse) makes
 *        the UI claim a build the phone is not running
 *   ---  a file the HTML, manifest or worker names that is not in the repo
 *        (locally you may have it; the deploy will 404 it)
 *   ---  Math.random() inside js/sim/ breaks deterministic replays
 *
 * Each failure prints what is wrong and where; any failure exits non-zero.
 * ========================================================================= */

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname, normalize, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { parseHeaders, headersFor } from "../test/serve.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
const problems = [];
const fail = (msg) => problems.push(msg);
let checks = 0;
const check = (cond, msg) => { checks++; if (!cond) fail(msg); };

/* ---- index.html ------------------------------------------------------------ */
// Comments stripped first: the comment explaining "no inline <script>" must
// not itself trip the check for one.
const html = read("index.html").replace(/<!--[\s\S]*?-->/g, "");
const refs = [...html.matchAll(/(?:href|src)="([^"#?]+)"/g)].map((m) => m[1]).filter((u) => !/^(https?:|data:|mailto:)/.test(u));
for (const u of refs) check(existsSync(join(ROOT, u)), `index.html references ${u}, which is not in the repo`);
check(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(html), "index.html has an inline <script>; the CSP (script-src 'self') blocks it silently");
check(!/\sstyle="/i.test(html), "index.html has a style=\"\" attribute; the CSP (style-src 'self') blocks it silently");
check(!/<style[\s>]/i.test(html), "index.html has a <style> element; the CSP blocks it silently");
for (const tag of ["viewport-fit=cover", "apple-mobile-web-app-capable", "theme-color", "rel=\"manifest\"", "apple-touch-icon"]) {
  check(html.includes(tag), `index.html is missing ${tag} (house rule 1)`);
}

/* ---- manifest -------------------------------------------------------------- */
const manifest = JSON.parse(read("manifest.webmanifest"));
for (const k of ["name", "short_name", "description", "start_url", "scope", "background_color", "theme_color", "categories"]) {
  check(manifest[k], `manifest is missing ${k}`);
}
check(manifest.display === "standalone", "manifest display must be standalone");
check(manifest.orientation === "portrait", "manifest orientation must be portrait");

function pngSize(rel) {
  const buf = readFileSync(join(ROOT, rel));
  // PNG signature, then the IHDR chunk: width and height are big-endian at 16 and 20.
  if (buf.readUInt32BE(0) !== 0x89504e47 || buf.toString("ascii", 12, 16) !== "IHDR") return null;
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
}
const sizesSeen = new Set();
for (const icon of manifest.icons || []) {
  check(existsSync(join(ROOT, icon.src)), `manifest icon ${icon.src} is not in the repo`);
  if (!existsSync(join(ROOT, icon.src)) || icon.type !== "image/png") continue;
  const real = pngSize(icon.src);
  check(real && `${real[0]}x${real[1]}` === icon.sizes,
    `${icon.src} is really ${real ? real.join("x") : "not a PNG"} but the manifest says ${icon.sizes} — Chrome checks the declared size and the install offer silently never appears`);
  sizesSeen.add(`${icon.sizes}:${icon.purpose || "any"}`);
}
check(sizesSeen.has("192x192:any") && sizesSeen.has("512x512:any"), "manifest needs a 192 and a 512 PNG (Chrome's installability criteria)");
check([...sizesSeen].some((s) => s.endsWith(":maskable")), "manifest needs a maskable icon, or Android letterboxes the mark");
if (existsSync(join(ROOT, "icons/apple-touch-icon.png"))) {
  const t = pngSize("icons/apple-touch-icon.png");
  check(t && t[0] === 180 && t[1] === 180, "apple-touch-icon.png should be 180x180");
}

/* ---- the service worker and the import graph ------------------------------- */
const sw = read("sw.js");
const shellMatch = /var SHELL = \[([\s\S]*?)\];/.exec(sw);
check(shellMatch, "could not find the SHELL list in sw.js");
const shell = shellMatch ? [...shellMatch[1].matchAll(/"([^"]+)"/g)].map((m) => normalize(m[1]).replace(/^\.\//, "")) : [];
for (const s of shell) if (s !== "." && s !== "./") check(existsSync(join(ROOT, s)), `sw.js SHELL lists ${s}, which is not in the repo`);

function walk(entry, seen = new Set()) {
  if (seen.has(entry)) return seen;
  seen.add(entry);
  const src = read(entry);
  for (const m of src.matchAll(/(?:^|\n)\s*(?:import|export)\s[^;]*?from\s+["'](\.[^"']+)["']/g)) {
    walk(normalize(join(dirname(entry), m[1])), seen);
  }
  for (const m of src.matchAll(/(?:^|\n)\s*import\s+["'](\.[^"']+)["']/g)) {
    walk(normalize(join(dirname(entry), m[1])), seen);
  }
  return seen;
}
const graph = [...walk("js/app.js")];
for (const mod of graph) check(shell.includes(mod), `${mod} is imported by the app but missing from sw.js SHELL — it will be missing offline (LESSONS 1.4)`);
for (const css of [...html.matchAll(/href="\.\/(css\/[^"]+)"/g)].map((m) => m[1])) {
  check(shell.includes(css), `${css} is linked from index.html but missing from sw.js SHELL`);
}

/* ---- the build number ------------------------------------------------------- */
const version = read("js/version.js");
const build = Number((/export const BUILD = (\d+);/.exec(version) || [])[1]);
const cache = (/var CACHE = "immunedefense-b(\d+)";/.exec(sw) || [])[1];
check(Number.isFinite(build) && String(build) === cache,
  `js/version.js BUILD (${build}) and sw.js CACHE (b${cache}) disagree — bump them together (LESSONS P3)`);

/* ---- _headers ---------------------------------------------------------------- */
const rules = parseHeaders(read("_headers"));
const swHeaders = headersFor(rules, "/sw.js");
check(/no-store/.test(swHeaders["Cache-Control"] || ""), "_headers must serve /sw.js with Cache-Control: no-store (LESSONS 1.2)");
check(headersFor(rules, "/manifest.webmanifest")["Content-Type"] === "application/manifest+json",
  "_headers must serve the manifest as application/manifest+json (LESSONS 1.8)");
const csp = headersFor(rules, "/index.html")["Content-Security-Policy"] || "";
check(csp.includes("default-src 'self'"), "_headers must ship a CSP");
check(!/unsafe-inline|unsafe-eval/.test(csp), "the CSP must not allow unsafe-inline or unsafe-eval");
check(!/max-age=[1-9]/.test(headersFor(rules, "/js/app.js")["Cache-Control"] || ""),
  "/js/* must not carry a long max-age, or the worker never sees a new deploy (LESSONS 1.9)");

/* ---- the simulation stays deterministic -------------------------------------- */
for (const f of readdirSync(join(ROOT, "js/sim"))) {
  const src = read(`js/sim/${f}`).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  check(!/Math\.random\s*\(/.test(src), `js/sim/${f} calls Math.random() — replays and tests stop being deterministic`);
}

/* ---- every script parses ------------------------------------------------------ */
function jsFiles(dir) {
  return readdirSync(join(ROOT, dir)).flatMap((f) => {
    const rel = join(dir, f);
    if (statSync(join(ROOT, rel)).isDirectory()) return jsFiles(rel);
    return /\.(m?js)$/.test(f) ? [rel] : [];
  });
}
for (const f of [...jsFiles("js"), "sw.js"]) {
  const res = spawnSync(process.execPath, ["--check", join(ROOT, f)], { encoding: "utf8" });
  check(res.status === 0, `${f} does not parse: ${(res.stderr || "").split("\n").find((l) => /Error/.test(l)) || ""}`);
}

/* ---- report ------------------------------------------------------------------ */
if (problems.length) {
  console.error(`\ncheck-deploy: ${problems.length} problem(s)\n` + problems.map((p) => `  ✗ ${p}`).join("\n") + "\n");
  process.exit(1);
}
console.log(`check-deploy: ${checks} checks, all fine (${graph.length} modules in the import graph, all in SHELL).`);
