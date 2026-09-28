/* ============================================================================
 * copy.test.mjs — every string a player reads is short.
 *
 * The rule: TEN WORDS AT MOST per card, hint, description or tip. People do
 * not read game cards; they glance at them. This walks every player-facing
 * field in js/data/ and the static paragraphs in index.html and fails on the
 * eleventh word, naming the string, so a longer sentence cannot slip back in
 * with a content edit.
 *
 * A "word" is any whitespace-separated token containing a letter or digit,
 * so a spaced dash (" — ") or a lone "·" is punctuation, not a word, and
 * "{name}" counts as one word (it becomes one).
 * ========================================================================= */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LEVELS } from "../../js/data/levels.js";
import { CELLS, NEUTRALS } from "../../js/data/cells.js";
import { THREATS } from "../../js/data/threats.js";
import { TERMS } from "../../js/data/guide.js";

export const MAX_WORDS = 10;

export function wordCount(text) {
  return String(text).split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

function collect() {
  const out = [];
  const add = (where, text) => { if (text) out.push([where, text]); };
  for (const l of LEVELS) {
    add(`${l.id}.intro`, l.intro);
    add(`${l.id}.teaches`, l.teaches);
    for (const c of l.coach || []) add(`${l.id}.coach.${c.id}`, c.text);
    for (const p of l.phases) {
      add(`${l.id}.${p.id}.hint`, p.hint);
      add(`${l.id}.${p.id}.fact`, p.fact);
      add(`${l.id}.${p.id}.recap`, p.recap);
    }
    for (const [k, v] of Object.entries(l.loseTips || {})) add(`${l.id}.loseTips.${k}`, v);
  }
  for (const c of [...Object.values(CELLS), ...Object.values(NEUTRALS)]) {
    add(`cell ${c.id}.line`, c.line);
    add(`cell ${c.id}.job`, c.job);
    add(`cell ${c.id}.realJob`, c.realJob);
  }
  for (const t of Object.values(THREATS)) {
    add(`threat ${t.id}.line`, t.line);
    add(`threat ${t.id}.realJob`, t.realJob);
  }
  for (const t of TERMS) add(`${t.id}.line`, t.line);
  return out;
}

test("the word counter counts words, not punctuation", () => {
  assert.equal(wordCount("Skin broke. Bacteria slipped in — a clot plugs the gap."), 10);
  assert.equal(wordCount("{name}, age 6, cuts a knee."), 6);
  assert.equal(wordCount("  ·  "), 0);
});

test(`every player-facing string in js/data/ is at most ${MAX_WORDS} words`, () => {
  const strings = collect();
  assert.ok(strings.length > 80, `only ${strings.length} strings collected — the walker missed something`);
  const long = strings.filter(([, s]) => wordCount(s) > MAX_WORDS);
  assert.deepEqual(long.map(([w, s]) => `${w} (${wordCount(s)}): ${s}`), []);
});

test("every level phase and level has an icon the sprites can draw", async () => {
  const { ICON_TYPES } = await import("../../js/render/sprites.js");
  for (const l of LEVELS) {
    assert.ok(ICON_TYPES.includes(l.icon), `${l.id} icon ${l.icon}`);
    for (const p of l.phases) assert.ok(ICON_TYPES.includes(p.icon), `${l.id}.${p.id} icon ${p.icon}`);
  }
});

test(`the static paragraphs in index.html are at most ${MAX_WORDS} words`, () => {
  const html = readFileSync(new URL("../../index.html", import.meta.url), "utf8").replace(/<!--[\s\S]*?-->/g, "");
  const paras = [...html.matchAll(/<p[^>]*>([^<]*)<\/p>/g)].map((m) => m[1].trim()).filter(Boolean);
  assert.ok(paras.length >= 2, "expected some static copy in index.html");
  const long = paras.filter((p) => wordCount(p) > MAX_WORDS);
  assert.deepEqual(long, []);
});
