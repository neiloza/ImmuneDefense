/* ============================================================================
 * rng.js — the simulation's only source of randomness.
 *
 * The sim must be a pure function of (level, seed, commands): the unit tests
 * and the balance bots replay whole levels and compare results, and a replay
 * that drifts is a test that cannot fail for the right reason. So:
 *
 *   - NEVER call Math.random() anywhere under js/sim/. Everything random goes
 *     through random(state), whose position lives IN the game state.
 *   - Do not swap mulberry32 for anything else without re-running
 *     `npm run balance`: the tuned numbers in js/data/ were measured against
 *     this exact sequence, and a different generator is a different set of
 *     levels (GameHub setup/LESSONS.md 3.10 — a shuffle seed must stay a pure
 *     function of the seed).
 * ========================================================================= */

/* FNV-1a over a string, so a level id plus a numeric seed becomes a uint32. */
export function seedFrom(text, n = 0) {
  let h = 0x811c9dc5;
  const s = `${text}:${n}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/* mulberry32, with its state stored as `state.rng` so it survives in the
 * game state and a saved state resumes the same sequence. */
export function random(state) {
  state.rng = (state.rng + 0x6d2b79f5) >>> 0;
  let t = state.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function randRange(state, lo, hi) {
  return lo + (hi - lo) * random(state);
}

export function randPick(state, list) {
  if (!list.length) return undefined;
  return list[Math.floor(random(state) * list.length) % list.length];
}
