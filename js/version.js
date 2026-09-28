/* ============================================================================
 * version.js — the single source of truth for the build number.
 *
 * Bump BUILD and `CACHE` in sw.js TOGETHER on every deploy.
 * scripts/check-deploy.mjs fails the build if they drift, because bumping
 * one without the other is worse than having no version at all: the UI would
 * claim a build the phone is not running.
 *
 * The number the UI SHOWS is read from caches.keys(), not from this constant
 * (see runningBuild below). That detail is the whole point: a page served
 * from a stale cache would otherwise report the number it was built with
 * rather than the one it is running — which is precisely the case worth
 * catching. GameHub setup/LESSONS.md P3: three debugging rounds were once
 * spent not knowing whether a screenshot showed a bug or an old install.
 * ========================================================================= */

export const APP_SLUG = "immunedefense";
export const BUILD = 5;

/* The cache name sw.js uses for this build. Kept derivable from BUILD so the
 * drift check has one rule to enforce. */
export const CACHE_NAME = `${APP_SLUG}-b${BUILD}`;

/* What is actually running on this device. Resolves to a short string such
 * as "b3" (from the live cache) or "b3·dev" when no worker cache exists yet
 * (first visit, a local server, or a browser without service workers). Never
 * rejects: it is decoration on a toolbar, not something to crash over. */
export async function runningBuild() {
  try {
    if (typeof caches === "undefined") return `b${BUILD}·dev`;
    const keys = await caches.keys();
    const mine = keys
      .map((k) => /^immunedefense-b(\d+)$/.exec(k))
      .filter(Boolean)
      .map((m) => Number(m[1]))
      .sort((a, b) => b - a);
    if (!mine.length) return `b${BUILD}·dev`;
    // If the cache disagrees with the code, say both: that IS the bug report.
    return mine[0] === BUILD ? `b${BUILD}` : `b${mine[0]} (code b${BUILD})`;
  } catch {
    return `b${BUILD}·?`;
  }
}
