// ── Accessibility layer (axe audit, 2026-10-08) ──────────────────────
// An axe-core scan of the live app found the same few problems on every
// screen. This file fixes the app-wide ones in one place instead of
// hand-editing hundreds of call sites in App.js:
//
//   1. readableInk(): bright foreman colors (lime #84cc16 = 1.8:1) and
//      lane colors drawn as text on the light theme. Darkens a color just
//      enough to reach 4.5:1 on the page background, same hue. Colors
//      that already pass come back unchanged.
//   2. Clickable boxes: hundreds of <div onClick> with an inline
//      cursor:pointer that a keyboard or screen reader can't reach. They
//      get role="button" + tabindex="0", and Enter / Space clicks them.
//      Boxes that hold their own buttons or inputs are skipped (a
//      role="button" would hide those children from a screen reader).
//   3. Unnamed dropdowns: a <select> with no label gets an aria-label
//      from the label text drawn next to it (or its title).
//   4. A visible focus ring for keyboard users only (:focus-visible —
//      taps and mouse clicks never show it).
//
// Read-only with respect to data: it only sets DOM attributes React
// doesn't manage, and never touches state, saves or Firestore.

const _inkCache = new Map();

function _rgb(hex) {
  const h = String(hex).trim().replace("#", "");
  const full = h.length === 3 ? h.split("").map(c => c + c).join("") : h.slice(0, 6);
  if (!/^[0-9a-f]{6}$/i.test(full)) return null;
  return [0, 2, 4].map(i => parseInt(full.substr(i, 2), 16));
}
function _lum(rgb) {
  const c = rgb.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function _contrast(a, b) {
  const x = _lum(a), y = _lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

// Darken `color` toward black until it reads at `min`:1 on `bg`.
// Non-hex input (rgba(), var(--x), undefined) is returned as-is.
export function readableInk(color, bg = "#F4F6F8", min = 4.5) {
  if (!color) return color;
  const key = color + "|" + bg + "|" + min;
  if (_inkCache.has(key)) return _inkCache.get(key);
  const fg = _rgb(color), back = _rgb(bg);
  let out = color;
  if (fg && back && _contrast(fg, back) < min) {
    let cur = fg;
    for (let i = 1; i <= 20; i++) {
      const k = 1 - i * 0.04;
      cur = fg.map(v => Math.round(v * k));
      if (_contrast(cur, back) >= min) break;
    }
    out = "#" + cur.map(v => v.toString(16).padStart(2, "0")).join("");
  }
  _inkCache.set(key, out);
  return out;
}

const FOCUS_CSS = `
:where(button,a,[role=button],[role=tab],[tabindex]):focus-visible{outline:2px solid #3B5BA5 !important;outline-offset:2px}
@media (pointer:coarse){.he-tap{min-height:40px}.he-tap-sq{min-height:40px;min-width:40px;justify-content:center}}
`;

const HAS_ROLE = "button,a[href],input,select,textarea,summary,label,[role],[tabindex],[contenteditable]";
const INNER_CONTROLS = "button,a[href],input,select,textarea,[role=button],[tabindex]";
const POINTER = '[style*="cursor: pointer"]';

function _makeKeyboardable(el) {
  if (el.style.cursor !== "pointer") {
    if (el.hasAttribute("data-he-kb")) { el.removeAttribute("data-he-kb"); el.removeAttribute("role"); el.removeAttribute("tabindex"); }
    return;
  }
  if (el.hasAttribute("data-he-kb") || el.matches(HAS_ROLE) || el.querySelector(INNER_CONTROLS)) return;
  el.setAttribute("role", "button");
  el.setAttribute("tabindex", "0");
  el.setAttribute("data-he-kb", "");
}

const _txt = s => (s || "").replace(/\s+/g, " ").trim();
function _labelFor(el) {
  const short = n => { const s = n && !n.matches("input,select,textarea,button") ? _txt(n.textContent) : ""; return s && s.length <= 40 ? s : ""; };
  return short(el.previousElementSibling)
    || (el.parentElement && !el.parentElement.previousElementSibling?.querySelector("input,select,textarea") && short(el.parentElement.previousElementSibling))
    || _txt(el.title)
    || _txt(el.options && el.options[0] && el.options[0].textContent);
}
function _nameSelect(el) {
  if (el.getAttribute("aria-label") || el.getAttribute("aria-labelledby") || (el.labels && el.labels.length)) return;
  const name = _labelFor(el);
  if (name) el.setAttribute("aria-label", name);
}

function _scan(root) {
  if (!root || root.nodeType !== 1) return;
  if (root.matches(POINTER)) _makeKeyboardable(root);
  root.querySelectorAll(POINTER).forEach(_makeKeyboardable);
  if (root.tagName === "SELECT") _nameSelect(root);
  root.querySelectorAll("select").forEach(_nameSelect);
}

export function installA11y() {
  if (typeof document === "undefined" || window.__heA11y) return;
  window.__heA11y = true;
  const st = document.createElement("style");
  st.setAttribute("data-he-a11y", "");
  st.textContent = FOCUS_CSS;
  document.head.appendChild(st);

  // Enter / Space on a keyboard-enabled box clicks it, like a real button.
  // Only when the box itself has focus — typing inside a field is untouched.
  document.addEventListener("keydown", e => {
    const t = e.target;
    if ((e.key === "Enter" || e.key === " ") && t && t.hasAttribute && t.hasAttribute("data-he-kb")) {
      e.preventDefault();
      t.click();
    }
  });

  const start = () => {
    _scan(document.body);
    new MutationObserver(records => {
      for (const r of records) {
        if (r.type === "attributes") { if (r.target.nodeType === 1) _makeKeyboardable(r.target); continue; }
        r.addedNodes.forEach(_scan);
      }
    }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["style"] });
  };
  if (document.body) start(); else document.addEventListener("DOMContentLoaded", start);
}
