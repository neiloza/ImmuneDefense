/* ============================================================================
 * ui.js — the shell behaviours every app in the set repeats: view switching,
 * bottom sheets, toasts. Nothing game-specific belongs here.
 * ========================================================================= */

/* --- views ---------------------------------------------------------------
 * Exactly one .view carries .active. Tabs declare their target with
 * `data-view="foo"`, which resolves to `#view-foo`. Keeping the mapping in
 * the markup means adding a tab is one button and one section, with no
 * matching switch statement to forget to update. */

export function showView(name) {
  document.querySelectorAll(".view").forEach((el) => {
    el.classList.toggle("active", el.id === `view-${name}`);
  });
  document.querySelectorAll(".tab").forEach((el) => {
    const on = el.dataset.view === name;
    el.classList.toggle("active", on);
    // aria-current, not aria-selected: these are navigation, not a tablist.
    if (on) el.setAttribute("aria-current", "page");
    else el.removeAttribute("aria-current");
  });
  window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
  document.dispatchEvent(new CustomEvent("view:change", { detail: { name } }));
}

export function initTabs(defaultView) {
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => showView(tab.dataset.view));
  });
  if (defaultView) showView(defaultView);
}

/* --- sheets --------------------------------------------------------------
 * A sheet is an .overlay containing a .overlay-backdrop and a .sheet. It
 * closes on: the close button, any [data-sheet-close] (including the
 * backdrop), and Escape. All three, always — a modal you can only leave one
 * way is a trap on some device you did not test.
 *
 * ESCAPE CLOSES THE TOPMOST OVERLAY ONLY. The kit's version closed every open
 * one, which was invisible while only one could ever be open and became a bug
 * the moment one could sit on another (GameHub setup/LESSONS.md 4.6) — here
 * the pause sheet opens over the battle, and the Field Guide can open over
 * the pause sheet. The stack below is the order sheets were opened in.
 *
 * A sheet marked [data-sticky] ignores the backdrop and Escape: the naming
 * sheet on first launch, which has to be answered (it has a default). */

const stack = [];
const onClose = new Map();

export function openSheet(id, { onClosed } = {}) {
  const overlay = document.getElementById(id);
  if (!overlay) return;
  overlay.hidden = false;
  const i = stack.indexOf(id);
  if (i >= 0) stack.splice(i, 1);
  stack.push(id);
  if (onClosed) onClose.set(id, onClosed);
  const focusable = overlay.querySelector("[autofocus]") || overlay.querySelector("[data-sheet-close]");
  focusable?.focus({ preventScroll: true });
  document.body.classList.add("sheet-open");
}

export function closeSheet(id) {
  const overlay = document.getElementById(id);
  if (!overlay || overlay.hidden) return;
  overlay.hidden = true;
  const i = stack.indexOf(id);
  if (i >= 0) stack.splice(i, 1);
  if (!stack.length) document.body.classList.remove("sheet-open");
  const cb = onClose.get(id);
  onClose.delete(id);
  cb?.();
}

export function topSheet() {
  return stack.length ? stack[stack.length - 1] : null;
}

export function initSheets() {
  document.querySelectorAll(".overlay").forEach((overlay) => {
    overlay.addEventListener("click", (e) => {
      if (overlay.hasAttribute("data-sticky")) return;
      if (e.target.closest("[data-sheet-close]")) closeSheet(overlay.id);
    });
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const top = topSheet();
    if (!top) return;
    const el = document.getElementById(top);
    if (el?.hasAttribute("data-sticky")) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    closeSheet(top);
  }, true);
}

/* --- toast ---------------------------------------------------------------
 * One element, reused. aria-live="polite" so it is announced without
 * interrupting; role="status" so it is announced at all. */

let toastTimer = null;

export function toast(message, ms = 2600) {
  let el = document.getElementById("toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    el.className = "toast";
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), ms);
}

/* Small DOM helper: create an element with properties and children. Keeps
 * screens free of innerHTML, which matters twice here — the player's name is
 * user input and must never be parsed as markup, and the CSP forbids inline
 * style attributes that innerHTML would carry in. */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (k === "dataset") Object.assign(el.dataset, v);
    else if (v === true) el.setAttribute(k, "");
    else el.setAttribute(k, String(v));
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

/* Copy with the important word marked: "Tap *Scout*, then tap the *ring*."
 * Returns the text as nodes with each *marked* run wrapped in <b class="hl">,
 * so a hint can point at the one word that matters without a single tag of
 * markup reaching innerHTML. Text is user-safe by construction: the only
 * thing that becomes an element is the highlight itself. */
export function rich(text) {
  const parts = String(text ?? "").split("*");
  return parts.map((part, i) => (i % 2 ? h("b", { class: "hl", text: part }) : document.createTextNode(part)));
}

/* Set an element's content to rich text. */
export function setRich(el, text) {
  el.replaceChildren(...rich(text));
}
