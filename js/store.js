/* ============================================================================
 * store.js — the player's progress, on the player's device.
 *
 * From the kit (GameHub setup/starter-kit), with the invariants that came
 * with it — each one is a bug another app already paid for:
 *
 * 1. ONE namespaced, versioned key: "immunedefense:v1". An incompatible shape
 *    change bumps the version and adds a migration; old bytes are never
 *    silently reinterpreted.
 * 2. EVERY access is guarded. Private mode, a quota error or corrupt JSON must
 *    never crash the app: reads fall back to defaults, writes no-op.
 * 3. Defaults are spread UNDER stored state, never over it — so changing a
 *    default only reaches devices that never saved one — and that applies
 *    one level down too (settings, person), because a field added to
 *    `settings` in a later build must not come back `undefined` for everyone
 *    who saved before it existed (LESSONS 3.1, 3.2).
 * 4. Collections are COERCED on load, not trusted: a hand-edited backup with
 *    an array where a map belongs must not throw at the first `in` (3.3).
 * 5. Store decisions, never content: `progress` maps a permanent level id to
 *    the best result; `seen` maps a guide entry id to when it was first met.
 *    Level text, stats and names all come from js/data/, so a content fix in
 *    a later deploy reaches everyone without touching their save (3.8).
 * ========================================================================= */

import { LEVELS } from "./data/levels.js";

const APP = "immunedefense";
const VERSION = 1;
export const STORAGE_KEY = `${APP}:v${VERSION}`;

export const NAME_MAX = 16;

/* The shape of a brand-new player. A function, not a shared object — a
 * shared default gets mutated by the first thing that touches it. */
export function defaultState() {
  return {
    v: VERSION,
    createdAt: Date.now(),
    // Empty name = not chosen yet, which is what shows the naming sheet.
    person: { name: "" },
    // levelId -> { stars, best, wins, plays, lastPlayed }
    progress: {},
    // fingerprint id -> timestamp earned (a Veteran)
    veterans: {},
    // guide entry id -> timestamp first met
    seen: {},
    // levelId -> [cellId…] the last loadout used there
    loadouts: {},
    settings: { sound: true, hints: true, speed: 1 },
    // Tester tools. Off for real players; see Settings.
    tester: { unlockAll: false },
  };
}

/* ---------------------------------------------------------------------------
 * Migrations, keyed by the version being migrated FROM. Never delete one:
 * that strands anyone who has not opened the app since — which, for a
 * local-first app with no backup, means losing their data permanently.
 * ------------------------------------------------------------------------- */
const MIGRATIONS = {
  // 1: (old) => ({ ...old, v: 2, newField: {} }),
};

function migrate(data) {
  let state = data;
  while (state.v < VERSION && MIGRATIONS[state.v]) state = MIGRATIONS[state.v](state);
  // A save from a FUTURE version (a newer deploy on another device, then an
  // older cached one here) is left alone, not "fixed" — worst case this
  // session runs on defaults and the newer save survives untouched.
  if (state.v !== VERSION) return null;
  return state;
}

/* Defaults under stored, one level deep, with every collection coerced. */
export function normalise(stored) {
  const d = defaultState();
  const s = stored && typeof stored === "object" ? stored : {};
  const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
  const out = { ...d, ...s, v: VERSION };
  out.person = { ...d.person, ...obj(s.person) };
  out.person.name = cleanName(out.person.name);
  out.settings = { ...d.settings, ...obj(s.settings) };
  out.tester = { ...d.tester, ...obj(s.tester) };
  out.veterans = obj(s.veterans);
  out.seen = obj(s.seen);

  // Progress: each record coerced to the right shape. An unknown level id is
  // kept rather than dropped — a later build may know it.
  out.progress = {};
  for (const [id, rec] of Object.entries(obj(s.progress))) {
    const r = obj(rec);
    out.progress[id] = {
      stars: clampInt(r.stars, 0, 3),
      best: clampInt(r.best, 0, 100),
      wins: clampInt(r.wins, 0, 1e6),
      plays: clampInt(r.plays, 0, 1e6),
      lastPlayed: Number.isFinite(r.lastPlayed) ? r.lastPlayed : 0,
    };
  }

  out.loadouts = {};
  for (const [id, list] of Object.entries(obj(s.loadouts))) {
    if (Array.isArray(list)) out.loadouts[id] = list.filter((c) => typeof c === "string").slice(0, 8);
  }
  return out;
}

function clampInt(v, lo, hi) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}

export function cleanName(name) {
  return String(name ?? "").replace(/\s+/g, " ").trim().slice(0, NAME_MAX);
}

/* --- raw, guarded primitives --------------------------------------------- */

export function readString(key) {
  if (typeof window === "undefined") return null;
  try { return localStorage.getItem(key); } catch { return null; }
}

export function writeString(key, value) {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(key, value); } catch { /* store unavailable */ }
}

/* --- the player's state --------------------------------------------------- */

export function loadState() {
  const raw = readString(STORAGE_KEY);
  if (!raw) return defaultState();
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return defaultState(); }
  if (!parsed || typeof parsed !== "object" || typeof parsed.v !== "number") return defaultState();
  const migrated = migrate(parsed);
  if (!migrated) return defaultState();
  return normalise(migrated);
}

export function saveState(state) {
  writeString(STORAGE_KEY, JSON.stringify(state));
}

/* --- progress helpers (they edit `state`; the caller saves) -------------- */

export function recordResult(state, levelId, outcome) {
  const rec = state.progress[levelId] || { stars: 0, best: 0, wins: 0, plays: 0, lastPlayed: 0 };
  rec.plays += 1;
  rec.lastPlayed = Date.now();
  if (outcome && outcome.won) {
    rec.wins += 1;
    rec.stars = Math.max(rec.stars, outcome.stars || 0);
    rec.best = Math.max(rec.best, outcome.host || 0);
    const vet = outcome.rewards && outcome.rewards.veteran;
    if (vet && !state.veterans[vet]) state.veterans[vet] = Date.now();
  }
  state.progress[levelId] = rec;
}

export function markSeen(state, ids) {
  let changed = false;
  for (const id of ids) {
    if (!state.seen[id]) { state.seen[id] = Date.now(); changed = true; }
  }
  return changed;
}

/* A level is open if it is the first, the one before it has been won, or the
 * tester switch is on. Derived, never stored, so it cannot disagree with the
 * level list. */
export function isUnlocked(state, levelId) {
  if (state.tester.unlockAll) return true;
  const idx = LEVELS.findIndex((l) => l.id === levelId);
  if (idx <= 0) return idx === 0;
  const prev = LEVELS[idx - 1].id;
  return (state.progress[prev]?.wins || 0) > 0;
}

/* ---------------------------------------------------------------------------
 * Ask the browser not to evict this data. A floor, not a safety net: it does
 * not survive "clear site data", a deleted app or a lost phone. Export below
 * is the net, and it is never behind any paywall (house rule 7).
 * ------------------------------------------------------------------------- */
export async function requestPersistence() {
  if (typeof navigator === "undefined" || !navigator.storage?.persist) return false;
  try {
    if (await navigator.storage.persisted?.()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export function exportState(state) {
  return JSON.stringify({ app: APP, v: VERSION, exportedAt: Date.now(), state }, null, 2);
}

export function importState(json) {
  try {
    const parsed = JSON.parse(json);
    if (!parsed || parsed.app !== APP || !parsed.state || typeof parsed.state !== "object") return null;
    const migrated = migrate({ v: parsed.state.v ?? parsed.v, ...parsed.state });
    return migrated ? normalise(migrated) : null;
  } catch {
    return null;
  }
}
