/* ============================================================================
 * serve.mjs — a static server small enough not to be a dependency, that
 * applies the REAL production _headers file to every response.
 *
 * That second part is the point. The CSP in _headers is strict enough to
 * break the app, and the way that breaks is silent in production: an inline
 * script or a new origin that the policy refuses fires nothing you would see
 * on a phone. Serving every test through the same headers Cloudflare will
 * send is how the suite finds that first (GameHub setup/LESSONS.md 1.6).
 *
 * _headers format (Cloudflare Pages): a path pattern on its own line, then
 * indented "Name: value" lines. `*` in a pattern matches anything. Later
 * blocks add to earlier ones; a header set twice keeps the later value,
 * which is how the more specific blocks below `/*` override it.
 * ========================================================================= */

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = fileURLToPath(new URL("..", import.meta.url));

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};

export function parseHeaders(text) {
  const rules = [];
  let current = null;
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (!line.trim() || line.trim().startsWith("#")) continue;
    if (!/^\s/.test(line)) {
      current = { pattern: line.trim(), headers: [] };
      rules.push(current);
    } else if (current) {
      const i = line.indexOf(":");
      if (i > 0) current.headers.push([line.slice(0, i).trim(), line.slice(i + 1).trim()]);
    }
  }
  return rules;
}

function matches(pattern, path) {
  const re = new RegExp("^" + pattern.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$");
  return re.test(path);
}

export function headersFor(rules, path) {
  const out = {};
  for (const r of rules) {
    if (!matches(r.pattern, path)) continue;
    for (const [k, v] of r.headers) out[k.toLowerCase()] = [k, v];
  }
  return Object.fromEntries(Object.values(out));
}

/** Serve the repo on a random free port. Resolves to the http.Server. */
export function serve({ root = ROOT, headersFile = join(ROOT, "_headers") } = {}) {
  const rules = parseHeaders(readFileSync(headersFile, "utf8"));
  const server = createServer(async (req, res) => {
    try {
      const urlPath = decodeURIComponent(req.url.split("?")[0]);
      const rel = normalize(urlPath);               // collapses any ../
      const filePath = join(root, rel === "/" || rel === "\\" ? "index.html" : rel);
      if (!filePath.startsWith(root)) { res.writeHead(403).end(); return; }
      const body = await readFile(filePath);
      const logical = rel === "/" ? "/index.html" : urlPath;
      const headers = {
        "Content-Type": TYPES[extname(filePath)] || "application/octet-stream",
        ...headersFor(rules, logical),
      };
      // The root document gets the same headers as /index.html.
      if (rel === "/") Object.assign(headers, headersFor(rules, "/"));
      res.writeHead(200, headers).end(body);
    } catch {
      res.writeHead(404, { "Content-Type": "text/plain" }).end("not found");
    }
  });
  return new Promise((ok) => server.listen(0, "127.0.0.1", () => ok(server)));
}
