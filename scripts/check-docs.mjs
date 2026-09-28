/* ============================================================================
 * check-docs.mjs — the docs point at things that exist.
 *
 *   node scripts/check-docs.mjs      (in `npm test`)
 *
 * From Wander (GameHub setup/APP_DESIGN_RULES.md rule 14, last paragraph):
 * every relative link between the docs resolves, every #anchor is a real
 * heading, and every path in CLAUDE.md's file map exists. It cannot check
 * that what the docs SAY is still true — that is what the dated status
 * section is for — but it is why the navigation can be trusted at all.
 * ========================================================================= */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const docs = ["README.md", "CLAUDE.md", ...readdirSync(join(ROOT, "docs")).filter((f) => f.endsWith(".md")).map((f) => `docs/${f}`)]
  .filter((f) => existsSync(join(ROOT, f)));

/* GitHub's heading slugs: lowercase, punctuation dropped, spaces to dashes. */
function slug(text) {
  return text.trim().toLowerCase()
    .replace(/[`*_]/g, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s/g, "-");
}

function anchorsOf(file) {
  const text = readFileSync(join(ROOT, file), "utf8").replace(/```[\s\S]*?```/g, "");
  const seen = new Map();
  const out = new Set();
  for (const m of text.matchAll(/^#{1,6}\s+(.+)$/gm)) {
    const base = slug(m[1]);
    const n = seen.get(base) || 0;
    seen.set(base, n + 1);
    out.add(n ? `${base}-${n}` : base);
  }
  return out;
}

const problems = [];
let links = 0;
for (const file of docs) {
  const text = readFileSync(join(ROOT, file), "utf8").replace(/```[\s\S]*?```/g, "");
  for (const m of text.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
    const target = m[1];
    if (/^(https?:|mailto:)/.test(target)) continue;
    links++;
    const [path, anchor] = target.split("#");
    const resolved = path ? join(dirname(file), path) : file;
    if (!existsSync(join(ROOT, resolved))) { problems.push(`${file}: link to ${target} — no such file`); continue; }
    if (anchor && resolved.endsWith(".md") && !anchorsOf(resolved).has(anchor)) {
      problems.push(`${file}: link to ${target} — no heading "#${anchor}" in ${resolved}`);
    }
  }
}

// CLAUDE.md's file map: every path in the first column must exist.
let mapped = 0;
if (existsSync(join(ROOT, "CLAUDE.md"))) {
  const text = readFileSync(join(ROOT, "CLAUDE.md"), "utf8");
  const section = /## File map([\s\S]*?)(\n## |$)/.exec(text);
  if (!section) problems.push("CLAUDE.md has no \"## File map\" section");
  else {
    for (const m of section[1].matchAll(/^\|\s*`([^`]+)`/gm)) {
      mapped++;
      if (!existsSync(join(ROOT, m[1]))) problems.push(`CLAUDE.md file map lists ${m[1]} — no such path`);
    }
  }
}

if (problems.length) {
  console.error(`\ncheck-docs: ${problems.length} problem(s)\n` + problems.map((p) => `  ✗ ${p}`).join("\n") + "\n");
  process.exit(1);
}
console.log(`check-docs: ${links} links and ${mapped} file-map paths across ${docs.length} docs, all resolve.`);
