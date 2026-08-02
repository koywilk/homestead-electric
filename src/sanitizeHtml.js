// sanitizeHtml.js — the single HTML sanitization boundary for this app.
//
// WHY THIS EXISTS (Stage 2a, 2026-07-31)
// --------------------------------------
// Rich text is the STORAGE FORMAT for punch items, question answers, job
// scope/material/notes and CO fields: RichEditor is a contenteditable div whose
// HTML is read verbatim on every keystroke and written straight to Firestore.
// Seven places in App.js render that stored HTML raw. Rendering those values as
// plain React text is not an option — it would blank the formatting on every
// value already stored.
//
// At the same time firestore.rules currently allows ANY unauthenticated caller
// to write jobs/* and homeowner_requests/*. So an outsider can store markup and
// have it execute in a crew or admin browser. The verified path was:
//   public share <textarea> (App.js:43924)
//     -> saveHomeownerRequest (App.js:43742)
//     -> office adoption (App.js:24425)
//     -> raw render (App.js:27863)  <- executes in an admin session
//
// This module is the fix that does not depend on the rules being tightened
// first: every value is sanitized at the RENDER boundary, so markup that is
// already stored is neutralized on the way to the screen. Rules hardening
// (Stage 3/4) is still coming; this is deliberately independent of it.
//
// CommonJS on purpose. The CRA bundle imports it AND scripts/sanitize-test.js
// requires it directly under plain node, so the thing shipped to the crew is
// the exact thing under test — no copy to drift. Same pattern as
// functions/gcPortal.js + scripts/gcportal-test.js.

"use strict";

const _dompurify = require("dompurify");
// In a browser the package's default export is already bootstrapped against the
// real window and exposes .sanitize. Under node it is a bare factory that has
// to be handed a window (jsdom, in the tests). Handle both, plus the webpack
// ESM-interop wrapper.
const createDOMPurify =
  _dompurify && _dompurify.default ? _dompurify.default : _dompurify;

// ── Allowlist ───────────────────────────────────────────────────────────────
// Scoped to what RichEditor can actually emit (App.js:4694-4712):
//   bold / italic / underline           -> b strong i em u
//   bullet + numbered list              -> ul ol li
//   foreColor with no styleWithCSS      -> <font color="#RRGGBB">
//   contenteditable's own line handling -> br p div span
// `s`/`strike` and `a` are not reachable from the toolbar but do arrive by
// paste, and both are safe under this allowlist. Everything else — script,
// iframe, img, svg, object, form, style, and every event-handler attribute —
// is dropped. img in particular is excluded on purpose: it is the payload in
// the `<img src=x onerror=...>` class of attack and the app renders real
// attachments through its own photo components, never through stored markup.
const ALLOWED_TAGS = [
  "b", "strong", "i", "em", "u", "s", "strike",
  "ul", "ol", "li",
  "br", "p", "div", "span", "font", "a",
  // Paste fidelity (Koy's call, 2026-07-31): crew members paste formatted
  // blocks out of Word/email into punch items and answers. Without these the
  // text survived but the structure was flattened — and because RichEditor
  // hydrates from sanitized HTML, that flattening became permanent on the next
  // keystroke. None of these is a script vector.
  "h1", "h2", "h3", "h4",
  "table", "thead", "tbody", "tfoot", "tr", "td", "th", "caption",
];

// `color` covers the <font color> that execCommand('foreColor') actually
// produces in this app (there is no styleWithCSS call anywhere in App.js).
// `style` is allowed only so pasted content keeps its text colour — and it is
// re-validated by SAFE_STYLE below rather than trusted.
const ALLOWED_ATTR = ["style", "color", "href", "target", "rel", "colspan", "rowspan"];

// DOMPurify 3.x delegates style-attribute parsing to the host environment's
// CSS engine, which means its behaviour differs between a real browser and the
// jsdom used by scripts/sanitize-test.js — verified: jsdom lets
// `background:url(javascript:alert(1))` through untouched. Rather than trust an
// engine we cannot faithfully test, every surviving style attribute is
// re-checked against this allowlist in a hook we control. Deterministic,
// browser-independent, and covered by the test suite.
//
// HISTORY WORTH KEEPING: the first version validated the whole attribute with
// ONE regex whose tail was `\s*;?\s*$` — two adjacent ambiguous quantifiers,
// which made it quadratic. Measured 10ms @4k, 38ms @8k, 144ms @16k; a ~320KB
// field (well inside Firestore's 1MB limit) cost seconds. Because jobs/* is
// anonymously writable and this runs SYNCHRONOUSLY in React render, one stored
// field would have frozen every crew phone and the public share page on every
// load. Hence sanitizeStyle() below splits per-declaration instead, and each
// sub-pattern is anchored with a group that cannot itself match whitespace, so
// the surrounding \s* can never be ambiguous with it. Do not merge these back
// into one big regex.
const SAFE_COLOR = /^\s*(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]{1,64}\)|[a-z]{3,20})\s*$/i;
const STYLE_PROPS = {
  "color": SAFE_COLOR,
  "background-color": SAFE_COLOR,
  "font-weight": /^\s*(bold|bolder|lighter|normal|[1-9]00)\s*$/i,
  "text-align": /^\s*(left|right|center|justify)\s*$/i,
};

const MAX_DECLS = 8;
const MAX_DECL_VALUE = 64;
// Longest legitimate value here is a short colour declaration. Capping before
// any regex runs means no future edit to them can reintroduce a stall.
const MAX_ATTR = 256;

/**
 * Validate a style attribute one declaration at a time and rebuild it from only
 * what passed. Split-then-check is deliberate: the previous single regex over
 * the whole attribute backtracked quadratically, and a stored 320KB field froze
 * the main thread for every viewer. Splitting keeps the work linear in the
 * attribute length, and every sub-pattern only ever sees a short bounded value.
 * Returns "" to mean "drop the attribute entirely".
 */
function sanitizeStyle(value) {
  const raw = String(value || "");
  if (!raw || raw.length > MAX_ATTR) return "";
  const parts = raw.split(";");
  if (parts.length > MAX_DECLS) return "";
  const kept = [];
  for (let i = 0; i < parts.length; i++) {
    const decl = parts[i];
    if (!decl.trim()) continue;                  // tolerate trailing/repeated ;
    const c = decl.indexOf(":");
    if (c === -1) continue;                       // malformed -> skip this decl
    const prop = decl.slice(0, c).trim().toLowerCase();
    const val = decl.slice(c + 1).trim();
    const rule = STYLE_PROPS[prop];
    // Unknown property, oversized value, or a value that fails its rule: drop
    // the WHOLE attribute rather than silently keeping a partial one.
    if (!rule || val.length > MAX_DECL_VALUE || !rule.test(val)) continue;
    kept.push(prop + ":" + val);
  }
  return kept.join(";");
}

const SAFE_SPAN = /^[1-9][0-9]?$/;   // colspan / rowspan


const PURIFY_CONFIG = {
  ALLOWED_TAGS,
  ALLOWED_ATTR,
  // Reject unknown protocols outright; this is what turns
  // <a href="javascript:alert(1)"> into an inert <a>.
  // `\/(?![\/\\])` allows a same-site path like /job/123 but rejects a
  // PROTOCOL-RELATIVE //evil.example, which a bare `\/` would have let through
  // as an offsite link on the public share pages.
  ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|tel:|#|\/(?![\/\\]))/i,
  // Tell DOMPurify `color` is presentational, not a URL — otherwise the regexp
  // above is applied to it and strips every named/rgb colour. See the hook.
  // Anything NOT listed here gets ALLOWED_URI_REGEXP applied to it, even when
  // it is plainly not a URL. That is what silently ate <font color="red">, and
  // then colspan="2" — the value simply does not look like a URL, so it was
  // dropped. These three are presentational/numeric and are validated by shape
  // in the hook below instead.
  ADD_URI_SAFE_ATTR: ["color", "colspan", "rowspan"],
  // Both default to TRUE in DOMPurify, which would let data-* and aria-*
  // through regardless of ALLOWED_ATTR. Nothing here needs them, and data-*
  // is a clobbering / CSS-attribute-selector surface, so close it explicitly.
  ALLOW_DATA_ATTR: false,
  ALLOW_ARIA_ATTR: false,
  // Never let sanitized output carry DOM clobbering handles.
  SANITIZE_DOM: true,
  KEEP_CONTENT: true,
  RETURN_TRUSTED_TYPE: false,
};

let _instance = null;
let _hooksBound = false;

function bindHooks(inst) {
  if (_hooksBound || !inst || typeof inst.addHook !== "function") return;
  // Any surviving link opens in a new tab without handing the opener a window
  // reference. Applied here rather than at each call site so a future render
  // site cannot forget it.
  inst.addHook("afterSanitizeAttributes", (node) => {
    if (!node || typeof node.hasAttribute !== "function") return;

    // Re-validate style ourselves — see SAFE_STYLE. Anything that is not a
    // lone colour declaration is dropped; the element and its text stay.
    // The length check runs FIRST so an oversized value is discarded without
    // the regex ever seeing it.
    if (node.hasAttribute("style")) {
      const cleaned = sanitizeStyle(node.getAttribute("style"));
      if (cleaned) node.setAttribute("style", cleaned);
      else node.removeAttribute("style");
    }

    // colspan/rowspan keep pasted tables readable; digits only.
    ["colspan", "rowspan"].forEach((a) => {
      if (node.hasAttribute(a) && !SAFE_SPAN.test(node.getAttribute(a) || "")) {
        node.removeAttribute(a);
      }
    });

    // `color` is presentational, not a URI — but it is not in DOMPurify's
    // DEFAULT_URI_SAFE_ATTRIBUTES, so without ADD_URI_SAFE_ATTR below DOMPurify
    // ran ALLOWED_URI_REGEXP against it and silently dropped every non-hex
    // value: <font color="red"> and <font color="rgb(1,2,3)"> both lost their
    // colour, while <font color="#B23A3A"> survived only by accident (because
    // "#" happens to be an alternative in that URI pattern). Since
    // execCommand('foreColor') is exactly what the crew's colour swatches emit,
    // that was silent formatting loss on real stored data. Now marked URI-safe
    // and validated as a colour instead.
    if (node.hasAttribute("color")) {
      const cv = node.getAttribute("color") || "";
      if (cv.length > MAX_ATTR || !SAFE_COLOR.test(cv)) node.removeAttribute("color");
    }

    if (node.tagName === "A" && node.hasAttribute("href")) {
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener noreferrer");
    }
  });
  _hooksBound = true;
}

/**
 * Point the sanitizer at an explicit window. Only needed outside a browser —
 * scripts/sanitize-test.js calls this with a jsdom window. In the app the
 * real window is picked up automatically.
 */
// A DOMPurify instance is only trustworthy if it can actually sanitize.
// In an environment it does not support, DOMPurify hands back an object with
// isSupported === false and NO .sanitize — calling it would throw inside React
// render, i.e. a blank screen triggered by an anonymous Firestore write.
// Checking capability (not truthiness) is what makes the fail-closed promise real.
function usable(inst) {
  return !!inst && typeof inst.sanitize === "function" && inst.isSupported !== false;
}

function configureSanitizer(win) {
  let cand = null;
  try { cand = createDOMPurify(win); } catch (e) { cand = null; }
  _instance = usable(cand) ? cand : null;
  _hooksBound = false;
  _cache.clear();               // never carry results across a sanitizer swap
  if (_instance) bindHooks(_instance);
  return _instance;
}

function purifier() {
  if (_instance) return _instance;
  let cand = null;
  // Browser: the default export is already bootstrapped against the real window.
  if (usable(createDOMPurify)) {
    cand = createDOMPurify;
  } else if (typeof window !== "undefined" && window && window.document) {
    try { cand = createDOMPurify(window); } catch (e) { cand = null; }
  }
  if (!usable(cand)) return null;   // -> caller falls back to escapeHtml
  _instance = cand;
  bindHooks(_instance);
  return _instance;
}

/**
 * Entity-escape a string so it can be embedded in HTML as literal text.
 * Used on write paths that adopt plain-text answers from outside parties, so
 * a homeowner typing "5 < 6" reads correctly instead of being swallowed as a
 * tag. Mirrors the escape already applied to the FieldInk sibling path at
 * App.js:24243.
 */
function escapeHtml(text) {
  return String(text == null ? "" : text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Sanitizing is cheap but these values render inside punch lists that can run
// to hundreds of rows and re-render on every keystroke elsewhere on the page.
// A small bounded cache keeps repeat renders of unchanged text off the parser.
const _cache = new Map();
const CACHE_LIMIT = 500;

/**
 * The one function every raw-HTML render site must call.
 *
 * Fails CLOSED: if DOMPurify cannot be initialised for any reason, the input
 * comes back entity-escaped rather than raw. A missing sanitizer degrades to
 * "formatting shows as literal markup", never to "markup executes".
 */
function sanitizeHtml(dirty) {
  if (dirty == null || dirty === "") return "";
  const input = String(dirty);
  // Nothing that could parse as markup or an entity — skip the round trip.
  if (input.indexOf("<") === -1 && input.indexOf("&") === -1) return input;

  const hit = _cache.get(input);
  if (hit !== undefined) return hit;

  const inst = purifier();
  let clean;
  let degraded = false;
  if (inst) {
    try {
      clean = String(inst.sanitize(input, PURIFY_CONFIG));
    } catch (e) {
      // Sanitizing must never throw into a React render. Escaping is the safe
      // degradation: the value shows as literal text instead of executing.
      clean = escapeHtml(input);
      degraded = true;
    }
  } else {
    clean = escapeHtml(input);
    degraded = true;
  }

  // Do NOT memoize a degraded result — otherwise one transient failure would
  // pin escaped-looking output for that value for the life of the tab, long
  // after the sanitizer recovered.
  if (!degraded) {
    if (_cache.size >= CACHE_LIMIT) _cache.clear();
    _cache.set(input, clean);
  }
  return clean;
}

// ── URL boundary (Stage 2d) ─────────────────────────────────────────────────
// React does NOT block javascript: URLs — 18.3.1 renders href="javascript:…"
// byte-for-byte with only a dev-time console warning. Photo/attachment records
// carry a `url` field and live in jobs/* and homeowner_requests/*, both of which
// any unauthenticated caller can write. So a stored record named "punchlist.pdf"
// pointing at a javascript: URL runs code in whichever crew or admin session
// clicks it. These two helpers are the URL equivalent of sanitizeHtml().

// Links and window.open: real navigable schemes only. blob:/data: are excluded
// here on purpose — a link should never hand the user a locally-minted document.
const SAFE_LINK_URL = /^(?:https?:\/\/|mailto:|tel:|\/(?![\/\\]))/i;

// Image sources additionally allow blob: and data:image, because the upload
// preview path legitimately mints those (App.js URL.createObjectURL). data: is
// restricted to image types so data:text/html cannot ride in.
const SAFE_IMG_URL = /^(?:https?:\/\/|blob:|data:image\/(?:png|jpe?g|gif|webp|avif|bmp|x-icon);|\/(?![\/\\]))/i;

function cleanUrl(u, re) {
  if (u == null) return "";
  // Strip control characters and whitespace FIRST: "java\tscript:" and
  // "java\nscript:" are treated as javascript: by browsers but would sail past
  // a naive prefix test.
  const s = String(u).replace(/[\u0000-\u0020]/g, "").trim();
  if (!s || s.length > 4096) return "";
  return re.test(s) ? s : "";
}

/** Safe for href / window.open. Returns "" when the URL is not navigable. */
function safeUrl(u) { return cleanUrl(u, SAFE_LINK_URL); }

/** Safe for <img src>. Allows blob: and data:image for local previews. */
function safeImageSrc(u) { return cleanUrl(u, SAFE_IMG_URL); }

/** Convenience for the raw-HTML render prop: sanitizeProps(value). */
function sanitizeProps(dirty) {
  return { __html: sanitizeHtml(dirty) };
}

module.exports = {
  sanitizeHtml,
  sanitizeProps,
  escapeHtml,
  safeUrl,
  safeImageSrc,
  configureSanitizer,
  ALLOWED_TAGS,
  ALLOWED_ATTR,
};
