// src/motion.js
// Homestead motion polish. PRESENTATIONAL ONLY: nothing in this file reads or writes
// Firestore, touches a save path, or adds a job field. It only draws and animates.
// Written against App.js at commit 30e999f (SW v480).
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";

const h = React.createElement;
const EASE = "cubic-bezier(.2,.8,.2,1)";
// One MediaQueryList for the whole session; .matches stays live. Callers hit this on every row render.
let _mql = null;
export const heReduced = () => {
  try {
    if (!_mql) _mql = window.matchMedia("(prefers-reduced-motion: reduce)");
    return _mql.matches;
  } catch (e) { return false; }
};

/* ───────────────────────── CSS (injected once) ───────────────────────── */
const CSS = `
:root{--he-t:1;--he-ease:cubic-bezier(.2,.8,.2,1);--he-spring:cubic-bezier(.34,1.45,.5,1)}
@media (prefers-reduced-motion: reduce){:root{--he-t:.01}}

/* remote change flash + who-changed-it tag */
.he-flash{animation:he-m-flash calc(1900ms*var(--he-t)) ease-out}
@keyframes he-m-flash{
  from{box-shadow:0 0 0 3px rgba(242,169,0,.55),inset 0 0 0 999px rgba(242,169,0,.2)}
  to{box-shadow:0 0 0 0 rgba(242,169,0,0),inset 0 0 0 999px rgba(242,169,0,0)}}
.he-flash-by{display:inline-block;font-size:10px;font-weight:700;color:#8A5A00;white-space:nowrap;
  animation:he-m-by calc(6000ms*var(--he-t)) ease both}
@keyframes he-m-by{0%{opacity:0;transform:translateY(4px)}5%{opacity:1;transform:none}88%{opacity:1}100%{opacity:0}}
@media (prefers-reduced-motion: reduce){.he-flash-by{animation:none;opacity:1}}

/* list enter + bar grow */
.he-rise{animation:he-m-rise calc(320ms*var(--he-t)) var(--he-ease) backwards}
@keyframes he-m-rise{from{opacity:0;transform:translateY(10px)}}
.he-grow{transform-origin:left center;animation:he-m-grow calc(700ms*var(--he-t)) var(--he-ease) backwards}
@keyframes he-m-grow{from{transform:scaleX(0)}}

/* pill change ring */
.he-pop{animation:he-m-pop calc(520ms*var(--he-t)) ease-out}
@keyframes he-m-pop{0%{box-shadow:0 0 0 0 currentColor}100%{box-shadow:0 0 0 7px transparent}}

/* punch check-off */
.he-row-done{animation:he-m-rowdone calc(900ms*var(--he-t)) ease-out}
@keyframes he-m-rowdone{from{box-shadow:0 0 0 3px rgba(21,128,61,.35)}to{box-shadow:0 0 0 0 rgba(21,128,61,0)}}
.he-row-done .he-ptext{animation:he-m-strike calc(400ms*var(--he-t)) linear}
@keyframes he-m-strike{0%,97%{text-decoration-color:transparent}100%{text-decoration-color:currentColor}}
.he-strike-line{position:fixed;height:1px;transform-origin:left center;pointer-events:none;z-index:2147483000;
  animation:he-m-wipe 380ms linear both}
@keyframes he-m-wipe{from{transform:scaleX(0)}}
.he-check-pop{animation:he-m-checkpop calc(380ms*var(--he-t)) var(--he-spring)}
@keyframes he-m-checkpop{0%{transform:scale(1)}45%{transform:scale(1.4)}100%{transform:scale(1)}}

/* sheets */
.he-sheet{animation:he-m-sheet calc(380ms*var(--he-t)) var(--he-spring) backwards}
@keyframes he-m-sheet{from{transform:translateY(100%)}}
.he-dialog{animation:he-m-dialog calc(240ms*var(--he-t)) var(--he-ease) backwards}
@keyframes he-m-dialog{from{opacity:0;transform:translateY(6px) scale(.97)}}
.he-scrim{animation:he-m-fade calc(220ms*var(--he-t)) ease backwards}
@keyframes he-m-fade{from{opacity:0}}
.he-grab-hint{position:absolute;top:5px;left:50%;width:36px;height:4px;margin-left:-18px;border-radius:2px;
  background:rgba(120,130,145,.45);pointer-events:none}

/* skeleton */
.he-skel{border-radius:10px;background:linear-gradient(90deg,#E3E7EC 0,#F2F4F7 50%,#E3E7EC 100%);
  background-size:200% 100%;animation:he-m-shimmer calc(1100ms*var(--he-t)) linear infinite}
@keyframes he-m-shimmer{to{background-position:-200% 0}}
@media (prefers-reduced-motion: reduce){.he-skel{animation:none}}

/* save chip */
.he-ico{width:12px;height:12px;flex:none;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.he-ico-in{animation:he-m-iconin calc(240ms*var(--he-t)) var(--he-spring) backwards}
@keyframes he-m-iconin{from{opacity:0;transform:scale(.5)}}
.he-ico-spin{animation:he-m-spin calc(800ms*var(--he-t)) linear infinite}
@keyframes he-m-spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion: reduce){.he-ico-spin{animation:none}}
.he-ico-draw path{stroke-dasharray:1;animation:he-m-draw calc(380ms*var(--he-t)) var(--he-ease) backwards}
@keyframes he-m-draw{from{stroke-dashoffset:1}}
.he-shake{animation:he-m-shake calc(380ms*var(--he-t))}
@keyframes he-m-shake{0%,100%{transform:translateX(0)}20%{transform:translateX(-4px)}40%{transform:translateX(4px)}60%{transform:translateX(-2px)}80%{transform:translateX(2px)}}

/* tab highlight */
.he-tab-ink{position:absolute;left:0;border-radius:8px 8px 0 0;pointer-events:none;z-index:0}
.he-tab-ink-anim{transition:transform calc(320ms*var(--he-t)) var(--he-ease),width calc(320ms*var(--he-t)) var(--he-ease)}
`;

if (typeof document !== "undefined" && !document.getElementById("he-motion-css")) {
  const st = document.createElement("style");
  st.id = "he-motion-css";
  st.textContent = CSS;
  document.head.appendChild(st);
}

/* ─────────────────── 1. Save state chip (replaces the plain sync text) ─────────────────── */
// status: "idle" | "saving" | "saved" | "error" (the existing syncStatus values).
// onRetry is optional; on "error" the chip becomes tappable and calls it.
export function HeSyncChip({ status, label, color, onRetry, style }) {
  const svg = (key, cls, kids) => h("svg", { key, className: cls, viewBox: "0 0 16 16", "aria-hidden": true }, kids);
  const icon =
    status === "saving" ? svg("s", "he-ico he-ico-spin", h("circle", { cx: 8, cy: 8, r: 6, strokeDasharray: "22 40" })) :
    status === "saved"  ? svg("ok", "he-ico he-ico-in he-ico-draw", h("path", { d: "M3.5 8.5l3 3 6-7", pathLength: 1 })) :
    status === "error"  ? svg("err", "he-ico he-ico-in", h("path", { d: "M4.5 4.5l7 7M11.5 4.5l-7 7" })) :
    null;
  const tappable = status === "error" && typeof onRetry === "function";
  return h("span", {
    key: status,                                   // remount per state so the icon animation replays
    className: status === "error" ? "he-shake" : undefined,
    role: tappable ? "button" : undefined,
    title: tappable ? "Tap to retry" : undefined,
    onClick: tappable ? onRetry : undefined,
    style: Object.assign({ display: "inline-flex", alignItems: "center", gap: 4, color, cursor: tappable ? "pointer" : "default" }, style),
  }, icon, label);
}

/* ─────────────────── 2. Remote change flash ─────────────────── */
// Module-level store. Written from the jobs snapshot handler, read at render time.
// Because JobRow is re-created on every App render (it is declared inside App), the flash is
// resumed from a negative animation-delay on every remount so it never restarts or vanishes.
const FLASH_MS = 1900, TAG_MS = 6000;
const flashes = new Map();      // jobId -> { t0, by }
const lastUpdated = new Map();  // jobId -> last seen updated_at (dedupes metadata-only snapshot fires)

export function heNoteRemoteJobChanges(snap) {
  try {
    if (!snap || typeof snap.docChanges !== "function") return;
    const me = localStorage.getItem("he_device_id");
    const now = Date.now();
    snap.docChanges().forEach((ch) => {
      // doc.get(field) reads one field; doc.data() would deserialize the whole job a second time
      // (the load handler already does that once per changed doc, and on first load that is every job).
      const upd = ch.doc.get("updated_at") || "";
      const prev = lastUpdated.get(ch.doc.id);
      lastUpdated.set(ch.doc.id, upd);
      if (ch.type !== "modified" || prev === undefined) return;      // first sight / not an edit
      if (ch.doc.metadata && ch.doc.metadata.hasPendingWrites) return; // our own optimistic write
      if (upd === prev) return;                                       // metadata-only fire
      const dev = ch.doc.get("device");
      if (!dev || dev === me) return;                                 // own device or server-side write
      flashes.set(ch.doc.id, { t0: now, by: ch.doc.get("saved_by") || "" });
    });
  } catch (e) { /* presentation only: never let this reach the snapshot handler */ }
}

// -> null, or { className, delay (ms, may be negative), by, active }
export function heFlashFor(jobId) {
  const f = flashes.get(jobId);
  if (!f) return null;
  const el = Date.now() - f.t0;
  if (el > TAG_MS) { flashes.delete(jobId); return null; }
  return { className: el < FLASH_MS ? "he-flash" : "", delay: -el, by: f.by, active: el < FLASH_MS };
}

/* ─────────────────── Enter animations that survive remounting rows ─────────────────── */
// First time a key is seen, it plays once, staggered 40ms per item within a burst (first 10 only).
// Later renders (including remounts) resume at the right phase or return null.
const seen = new Map();
let burstT = 0, burstN = 0;
export function heEnter(key, opts) {
  const o = Object.assign({ cls: "he-rise", dur: 320, delay: 0, stagger: true }, opts);
  if (heReduced()) return null;
  const now = Date.now();
  let t0 = seen.get(key);
  if (t0 === undefined) {
    let slot = 0;
    if (o.stagger) {
      if (now - burstT > 250) { burstT = now; burstN = 0; } else { burstN++; }
      slot = burstN;
    }
    t0 = slot > 10 ? now - 100000 : now + slot * 40 + o.delay;   // items past the 10th just appear
    seen.set(key, t0);
  }
  const el = now - t0;
  if (el >= o.dur) return null;
  return { className: o.cls, delay: -el };
}

/* ─────────────────── 3. Count up (Today pulse tiles, any number) ─────────────────── */
export function useHeCountUp(value, ms = 800) {
  const ok = typeof value === "number" && isFinite(value);
  const [shown, setShown] = useState(() => (ok && heReduced() ? value : 0));
  const cur = useRef(ok && heReduced() ? value : 0);
  useEffect(() => {
    if (!ok) return undefined;
    if (heReduced() || cur.current === value) { cur.current = value; setShown(value); return undefined; }
    const from = cur.current, t0 = performance.now();
    let raf;
    const tick = (now) => {
      const p = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - p, 3);
      const v = Math.round(from + (value - from) * e);
      cur.current = v; setShown(v);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, ms, ok]);
  return ok ? shown : value;
}
export function HeCount({ value, ms }) { return h(React.Fragment, null, useHeCountUp(value, ms)); }

/* ─────────────────── 4. Pop ring when a value changes (Pill, StatusPill) ─────────────────── */
export function useHePop(dep) {
  const ref = useRef(null), first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const el = ref.current;
    if (!el || heReduced()) return;
    el.classList.remove("he-pop"); void el.offsetWidth; el.classList.add("he-pop");
  }, [dep]);
  return ref;
}

/* ─────────────────── 5. Job Detail tab highlight + panel ease ─────────────────── */
// containerRef: the scrolling tab bar. Each tab button needs data-hetab={tabName}.
// Returns null until measured; while null the buttons keep their own accent background.
export function useHeTabInk(containerRef, activeKey, tabsKey) {
  const [ink, setInk] = useState(null);
  useLayoutEffect(() => {
    const c = containerRef.current;
    if (!c) return undefined;
    const measure = () => {
      const btn = Array.prototype.find.call(c.querySelectorAll("[data-hetab]"), (b) => b.getAttribute("data-hetab") === activeKey);
      if (!btn) { setInk((p) => (p === null ? p : null)); return; }
      const next = { x: btn.offsetLeft, y: btn.offsetTop, w: btn.offsetWidth, h: btn.offsetHeight };
      setInk((p) => (p && p.x === next.x && p.y === next.y && p.w === next.w && p.h === next.h ? p : Object.assign({ moved: !!p }, next)));
    };
    measure();
    // The tab buttons animate font-weight (transition: all 0.15s), so their widths are still
    // changing when we first measure. Measure again once that settles.
    const settle = setTimeout(measure, 200);
    let ro;
    if (typeof ResizeObserver !== "undefined") { ro = new ResizeObserver(measure); ro.observe(c); }
    window.addEventListener("resize", measure);
    return () => { clearTimeout(settle); if (ro) ro.disconnect(); window.removeEventListener("resize", measure); };
  }, [containerRef, activeKey, tabsKey]);
  return ink;
}
export function HeTabInk({ ink, color }) {
  if (!ink) return null;
  return h("span", {
    className: "he-tab-ink" + (ink.moved && !heReduced() ? " he-tab-ink-anim" : ""),
    style: { top: ink.y, height: ink.h, width: ink.w, transform: "translateX(" + ink.x + "px)", background: color },
    "aria-hidden": true,
  });
}
// Eases the tab body in from the direction of travel. Uses the Web Animations API on the
// existing wrapper, so nothing remounts and no tab state is lost.
export function useHePaneEase(ref, tab, order) {
  const prev = useRef(tab), first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; prev.current = tab; return; }
    const el = ref.current, was = prev.current;
    prev.current = tab;
    if (!el || !el.animate || heReduced()) return;
    const dir = order.indexOf(tab) >= order.indexOf(was) ? 1 : -1;
    el.animate([{ opacity: 0, transform: "translateX(" + dir * 14 + "px)" }, { opacity: 1, transform: "none" }], { duration: 220, easing: EASE });
  }, [tab]);
}

/* ─────────────────── Strike-through wipe (punch check-off) ─────────────────── */
// Draws a thin line across each line of the item text, left to right, while the real
// line-through is held transparent by CSS (.he-row-done .he-ptext). Lines are fixed-position
// elements on document.body, so nothing inside React's tree is added, moved or removed.
// Pass heStrikeRef as the ref of the item text span only while the row is animating.
export function heStrikeWipe(el) {
  try {
    if (!el || heReduced()) return;
    // Text nodes only: a range over the whole span also returns the block boxes around the text.
    const rects = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.nodeValue || !n.nodeValue.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      Array.prototype.forEach.call(range.getClientRects(), (r) => { if (r.width > 2 && r.height > 2) rects.push(r); });
    }
    rects.sort((a, b) => (a.top - b.top) || (a.left - b.left));
    const lines = [];
    rects.forEach((r) => {
      const mid = r.top + r.height / 2;
      const l = lines.find((x) => Math.abs(x.mid - mid) < r.height * 0.6);
      if (l) { l.left = Math.min(l.left, r.left); l.right = Math.max(l.right, r.right); }
      else lines.push({ mid, top: r.top, h: r.height, left: r.left, right: r.right });
    });
    if (!lines.length) return;
    const color = getComputedStyle(el).color;
    const per = 380 / lines.length;
    const made = lines.map((l, i) => {
      const d = document.createElement("span");
      d.className = "he-strike-line";
      d.setAttribute("aria-hidden", "true");
      d.style.cssText = "left:" + l.left + "px;top:" + (l.top + l.h * 0.58) + "px;width:" + (l.right - l.left) +
        "px;background:" + color + ";animation-delay:calc(" + Math.round(i * per) + "ms*var(--he-t));animation-duration:calc(" +
        Math.round(per) + "ms*var(--he-t))";
      document.body.appendChild(d);
      return d;
    });
    setTimeout(() => made.forEach((d) => { if (d.parentNode) d.parentNode.removeChild(d); }), 420);
  } catch (e) { /* presentation only */ }
}
export const heStrikeRef = (el) => { if (el) heStrikeWipe(el); };

/* ─────────────────── 6. Bottom sheet drag-to-dismiss ─────────────────── */
// sheetRef -> the panel element. Spread handleProps on the grab handle (or header).
// Taps on buttons/inputs inside the handle area are ignored so Cancel/Done keep working.
export function useHeSheetDrag(onClose) {
  const sheetRef = useRef(null), st = useRef({ y0: 0, dy: 0, on: false }), close = useRef(onClose);
  close.current = onClose;
  const end = () => {
    const s = st.current, el = sheetRef.current;
    if (!s.on) return;
    s.on = false;
    if (!el) return;
    if (s.dy > 90) {
      el.style.transition = "transform 220ms ease-in";
      el.style.transform = "translateY(100%)";
      setTimeout(() => close.current && close.current(), 200);
    } else {
      el.style.transition = "transform 320ms cubic-bezier(.34,1.45,.5,1)";
      el.style.transform = "";
      setTimeout(() => { if (sheetRef.current) sheetRef.current.style.transition = ""; }, 340);
    }
  };
  const dragEvents = {
    onPointerDown: (e) => {
      if (e.target && e.target.closest && e.target.closest("button,input,textarea,select,a")) return;
      st.current = { y0: e.clientY, dy: 0, on: true };
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ }
      const el = sheetRef.current;
      if (el) { el.style.transition = "none"; el.style.animation = "none"; }
    },
    onPointerMove: (e) => {
      const s = st.current;
      if (!s.on) return;
      s.dy = Math.max(0, e.clientY - s.y0);
      if (sheetRef.current) sheetRef.current.style.transform = "translateY(" + s.dy + "px)";
    },
    onPointerUp: end,
    onPointerCancel: end,
  };
  // dragEvents: just the handlers (use on an element that already has its own style, e.g. a sticky header).
  // handleProps: handlers + touch-action/cursor (use on a dedicated grab handle).
  const handleProps = Object.assign({ style: { touchAction: "none", cursor: "grab" } }, dragEvents);
  return { sheetRef, handleProps, dragEvents };
}

/* ─────────────────── 7. Skeleton rows for the first load ─────────────────── */
export function HeSkeleton({ n = 5, height = 64 }) {
  const rows = [];
  for (let i = 0; i < n; i++) rows.push(h("div", { key: i, className: "he-skel", style: { height, marginBottom: 10 } }));
  return h("div", { "aria-hidden": true }, rows);
}
