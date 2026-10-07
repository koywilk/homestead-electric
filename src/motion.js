// src/motion.js
// Homestead motion polish. PRESENTATIONAL ONLY: nothing in this file reads or writes
// Firestore, touches a save path, or adds a job field. It only draws and animates.
// Written against App.js at commit 30e999f (SW v480).
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";

const h = React.createElement;
const EASE = "cubic-bezier(.2,.8,.2,1)";
// One MediaQueryList for the whole session; .matches stays live. Callers hit this on every row render.
let _mql = null;
// Raw phone setting (Reduce Motion in iOS Accessibility / Android "Remove animations").
export const heReducedRaw = () => {
  try {
    if (!_mql) _mql = window.matchMedia("(prefers-reduced-motion: reduce)");
    return _mql.matches;
  } catch (e) { return false; }
};
// v496: the in-app override. Koy's phone has Reduce Motion on, which silently turned every animation off
// (the v487 strike "didn't show on my iPhone"). Settings menu → "Animations: always on" sets this.
// Koy (2026-10-02, "All of them" not showing): motion is ON by default for everyone, whatever the phone
// says. The Settings (⋯) menu lets a person turn it OFF on their device ("he_motion_off"); only then does
// the app go still. The phone's Reduce Motion setting is shown in the menu but no longer silently wins.
const OFF_KEY = "he_motion_off";
export const heMotionOff = () => { try { return localStorage.getItem(OFF_KEY) === "1"; } catch (e) { return false; } };
export const heSetMotionOff = (off) => {
  try { if (off) localStorage.setItem(OFF_KEY, "1"); else localStorage.removeItem(OFF_KEY); } catch (e) { /* ignore */ }
  try { document.documentElement.classList.toggle("he-still", !!off); } catch (e) { /* ignore */ }
};
export const heReduced = () => heMotionOff();
if (typeof document !== "undefined" && heMotionOff()) { try { document.documentElement.classList.add("he-still"); } catch (e) { /* ignore */ } }

/* ───────────────────────── CSS (injected once) ───────────────────────── */
const CSS = `
:root{--he-t:1;--he-ease:cubic-bezier(.2,.8,.2,1);--he-spring:cubic-bezier(.34,1.45,.5,1)}
:root.he-still{--he-t:.01}

/* remote change flash + who-changed-it tag */
.he-flash{animation:he-m-flash calc(1900ms*var(--he-t)) ease-out}
@keyframes he-m-flash{
  from{box-shadow:0 0 0 3px rgba(242,169,0,.55),inset 0 0 0 999px rgba(242,169,0,.2)}
  to{box-shadow:0 0 0 0 rgba(242,169,0,0),inset 0 0 0 999px rgba(242,169,0,0)}}
.he-flash-by{display:inline-block;font-size:10px;font-weight:700;color:#8A5A00;white-space:nowrap;
  animation:he-m-by calc(6000ms*var(--he-t)) ease both}
@keyframes he-m-by{0%{opacity:0;transform:translateY(4px)}5%{opacity:1;transform:none}88%{opacity:1}100%{opacity:0}}
:root.he-still .he-flash-by{animation:none;opacity:1}

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
.he-strike-line{position:fixed;height:2px;margin-top:-1px;border-radius:1px;transform-origin:left center;pointer-events:none;z-index:2147483000}
@keyframes he-m-wipe{from{transform:scaleX(0)}}
@keyframes he-m-linefade{to{opacity:0}}
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
:root.he-still .he-skel{animation:none}

/* save chip */
.he-ico{width:12px;height:12px;flex:none;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.he-ico-in{animation:he-m-iconin calc(240ms*var(--he-t)) var(--he-spring) backwards}
@keyframes he-m-iconin{from{opacity:0;transform:scale(.5)}}
.he-ico-spin{animation:he-m-spin calc(800ms*var(--he-t)) linear infinite}
@keyframes he-m-spin{to{transform:rotate(360deg)}}
:root.he-still .he-ico-spin{animation:none}
.he-ico-draw path{stroke-dasharray:1;animation:he-m-draw calc(380ms*var(--he-t)) var(--he-ease) backwards}
@keyframes he-m-draw{from{stroke-dashoffset:1}}
.he-shake{animation:he-m-shake calc(380ms*var(--he-t))}
@keyframes he-m-shake{0%,100%{transform:translateX(0)}20%{transform:translateX(-4px)}40%{transform:translateX(4px)}60%{transform:translateX(-2px)}80%{transform:translateX(2px)}}

/* tab highlight */
.he-tab-ink{position:absolute;left:0;border-radius:8px 8px 0 0;pointer-events:none;z-index:0}
.he-tab-ink-anim{transition:transform calc(320ms*var(--he-t)) var(--he-ease),width calc(320ms*var(--he-t)) var(--he-ease)}

/* ── v496 motion batch (Koy 2026-10-02: navigation + live + fix-confusion picks from the sampler) ── */
/* strike head: the dot that leads the wipe so the line is visible on a bright phone */
.he-strike-head{position:fixed;width:9px;height:9px;margin:-4px 0 0 -4px;border-radius:50%;pointer-events:none;z-index:2147483000}
@keyframes he-m-head{0%,85%{opacity:1}100%{opacity:0}}
@keyframes he-m-headmove{from{transform:translateX(0)}to{transform:translateX(var(--he-dx,0px))}}
/* new My Day rows drop in from above */
.he-drop{animation:he-m-drop calc(520ms*var(--he-t)) var(--he-spring) backwards}
@keyframes he-m-drop{from{opacity:0;transform:translateY(-26px)}}
/* progress bar sheen while under 100% */
.he-sheen{position:relative;overflow:hidden}
.he-sheen::after{content:"";position:absolute;inset:0;background:linear-gradient(100deg,transparent 25%,rgba(255,255,255,.55) 50%,transparent 75%);transform:translateX(-100%);animation:he-m-sheen calc(2200ms*var(--he-t)) ease-in-out infinite}
@keyframes he-m-sheen{to{transform:translateX(100%)}}
:root.he-still .he-sheen::after{animation:none}
/* fly-to-tab chip */
.he-flyer{position:fixed;z-index:2147483000;pointer-events:none;font:600 12px/1.2 system-ui;background:#fff;color:#1B1F24;border:1px solid #3B5BA5;border-radius:6px;padding:4px 8px;box-shadow:0 6px 24px rgba(27,31,36,.18);white-space:nowrap;will-change:transform}
.he-bump{animation:he-m-bump calc(420ms*var(--he-t)) var(--he-spring)}
@keyframes he-m-bump{50%{transform:scale(1.25)}}
/* anchored toast: rises out of the button you pressed */
.he-atoast{position:fixed;z-index:99997;pointer-events:none;transform:translate(-50%,0);background:#1B1F24;color:#EEF0F3;font:700 12px/1.3 system-ui;padding:7px 12px;border-radius:999px;white-space:nowrap;max-width:min(92vw,360px);overflow:hidden;text-overflow:ellipsis;box-shadow:0 10px 32px rgba(0,0,0,.35);animation:he-m-atoast calc(1800ms*var(--he-t)) var(--he-ease) forwards}
@keyframes he-m-atoast{0%{opacity:0;transform:translate(-50%,6px) scale(.7)}12%{opacity:1;transform:translate(-50%,-10px) scale(1)}78%{opacity:1;transform:translate(-50%,-16px) scale(1)}100%{opacity:0;transform:translate(-50%,-36px) scale(.92)}}
/* presence bubble (someone else has this job open) */
.he-pres{display:inline-grid;place-items:center;width:26px;height:26px;border-radius:50%;color:#fff;font:800 10px/1 system-ui;letter-spacing:.02em;flex:none;animation:he-m-presin calc(480ms*var(--he-t)) var(--he-spring) backwards,he-m-breathe 2s ease-in-out calc(480ms*var(--he-t)) infinite;box-shadow:0 0 0 0 var(--he-pres-c,rgba(176,106,44,.55))}
@keyframes he-m-presin{from{opacity:0;transform:translateX(18px)}}
@keyframes he-m-breathe{50%{box-shadow:0 0 0 7px transparent}}
:root.he-still .he-pres{animation:none}
/* undo countdown bar */
.he-cd{position:absolute;left:0;bottom:0;height:3px;width:100%;background:#66A8FF;border-radius:0 0 10px 10px;transform-origin:left;animation:he-m-cd var(--he-cd-ms,10000ms) linear forwards}
@keyframes he-m-cd{to{transform:scaleX(0)}}
/* job card → detail zoom layer */
.he-zoom{position:fixed;z-index:2147483000;pointer-events:none;background:#fff;border:1px solid #E1E4E9;border-radius:14px;overflow:hidden;will-change:transform,width,height;box-shadow:0 18px 60px rgba(27,31,36,.25)}
.he-zoom b{display:block;padding:14px 16px;font:400 22px/1 'Bebas Neue',Impact,sans-serif;letter-spacing:.04em;color:#1B1F24}

/* ── v497 batch A (Koy 2026-10-02: "I want all of them") ── */
.he-updbar{position:fixed;left:12px;right:12px;bottom:calc(14px + env(safe-area-inset-bottom,0px));z-index:99996;background:#1B1F24;color:#EEF0F3;border-radius:12px;padding:12px 14px;display:flex;justify-content:space-between;align-items:center;font:700 13px/1.3 system-ui;box-shadow:0 10px 32px rgba(0,0,0,.35);cursor:pointer;animation:he-m-updbar calc(480ms*var(--he-t)) var(--he-spring) backwards}
@keyframes he-m-updbar{from{transform:translateY(140%)}}
.he-swipe-under{user-select:none}
/* ── v497 batch C ── */
.he-ring{display:inline-grid;place-items:center;border-radius:6px;background:#E3E7EC;border:1px solid #E1E4E9;flex:none}
.he-ring i{width:26px;height:26px;border-radius:50%;border:3px solid #CDD3DB;border-top-color:#3B5BA5;animation:he-m-spin calc(900ms*var(--he-t)) linear infinite}
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
// Draws a dark line across each line of the item text, left to right, then fades it out as the
// item's own pale strike-through takes over (done text is very light, so a same-colour line is
// invisible). Lines are fixed-position elements on document.body, so nothing inside React's tree is
// added, moved or removed. Rows that are clipped, collapsed or covered are skipped.
const STRIKE_COLOR = "#1B1F24";
export function heStrikeWipe(el) {
  try {
    if (!el || heReduced()) return;
    heBuzz(12);
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
    const visible = lines.filter((l) => {
      const hit = document.elementFromPoint(l.left + Math.min(6, (l.right - l.left) / 2), l.mid);
      return !!hit && el.contains(hit);
    });
    if (!visible.length) return;
    const WIPE = 420, FADE = 520, per = WIPE / visible.length;
    el.style.textDecorationColor = "transparent";   // hold the real strike back until the wipe is done
    const made = visible.map((l, i) => {
      const d = document.createElement("span");
      d.className = "he-strike-line";
      d.setAttribute("aria-hidden", "true");
      d.style.cssText = "left:" + l.left + "px;top:" + (l.top + l.h * 0.58) + "px;width:" + (l.right - l.left) +
        "px;height:3px;margin-top:-1.5px;background:" + STRIKE_COLOR +
        ";animation:he-m-wipe calc(" + Math.round(per) + "ms*var(--he-t)) linear calc(" + Math.round(i * per) + "ms*var(--he-t)) both," +
        "he-m-linefade calc(" + FADE + "ms*var(--he-t)) ease-out calc(" + WIPE + "ms*var(--he-t)) forwards";
      document.body.appendChild(d);
      // v496: a dot leads the line across so the wipe reads on a bright phone screen.
      const hd = document.createElement("span");
      hd.className = "he-strike-head";
      hd.setAttribute("aria-hidden", "true");
      hd.style.cssText = "left:" + l.left + "px;top:" + (l.top + l.h * 0.58) + "px;background:" + STRIKE_COLOR +
        ";animation:he-m-headmove calc(" + Math.round(per) + "ms*var(--he-t)) linear calc(" + Math.round(i * per) + "ms*var(--he-t)) both," +
        "he-m-head calc(" + FADE + "ms*var(--he-t)) ease-out calc(" + WIPE + "ms*var(--he-t)) forwards";
      hd.style.setProperty("--he-dx", (l.right - l.left) + "px");
      document.body.appendChild(hd);
      d._head = hd;
      return d;
    });
    setTimeout(() => { el.style.textDecorationColor = ""; }, WIPE + 20);
    setTimeout(() => made.forEach((d) => { if (d.parentNode) d.parentNode.removeChild(d); if (d._head && d._head.parentNode) d._head.parentNode.removeChild(d._head); }), WIPE + FADE + 80);
  } catch (e) { /* presentation only */ }
}
// Drop-in replacement for the span (or div, tag="div") that holds a punch item's text. When `done`
// goes false -> true the wipe plays. `animateOnMount` plays it on first render too (rows that stay on
// screen a moment after being ticked). Everything else is passed straight through to the element.
export function HeStrikeSpan(props) {
  const { done, animateOnMount, tag, children, ...rest } = props;
  const ref = useRef(null), prev = useRef(animateOnMount ? false : !!done);
  useLayoutEffect(() => {
    if (done && !prev.current && ref.current) heStrikeWipe(ref.current);
    prev.current = !!done;
  }, [done]);
  return h(tag || "span", Object.assign({ ref }, rest), children);
}

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

/* ─────────────────── v496: haptics + last-tap tracker ─────────────────── */
// Android Chrome buzzes; iOS Safari has no web haptics, so the visual has to carry it there.
export function heBuzz(pattern) {
  try { if (!heReduced() && navigator.vibrate) navigator.vibrate(pattern || 12); } catch (e) { /* ignore */ }
}
// The element the user last pressed, and when. Lets a toast rise from the button that caused it and
// lets a "fly to tab" start from the button that was tapped, with no call-site plumbing.
const lastTap = { el: null, t: 0 };
if (typeof document !== "undefined") {
  document.addEventListener("pointerdown", (e) => {
    const t = e.target;
    lastTap.el = (t && t.closest && t.closest("button,[role=button],a,label,input,select")) || t;
    lastTap.t = Date.now();
  }, true);
}
export function heLastTap() { return { el: lastTap.el, age: Date.now() - lastTap.t }; }
const inView = (r) => r && r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < window.innerHeight && r.left < window.innerWidth;

/* ─────────────────── v496: fly a chip from the pressed button to a job tab ─────────────────── */
// tabName: the data-hetab value ("Return Trips"). label: chip text. Source defaults to the last tap.
export function heFlyToTab(tabName, label, fromEl) {
  try {
    if (heReduced()) return;
    const src = fromEl || (heLastTap().age < 2500 ? heLastTap().el : null);
    const tab = document.querySelector('[data-hetab="' + tabName + '"]');
    if (!src || !tab || !src.isConnected) return;
    const a = src.getBoundingClientRect(), b = tab.getBoundingClientRect();
    if (!inView(a)) return;
    // The tab bar scrolls sideways; if the tab is off the edge, aim at the visible edge of its bar.
    const bar = tab.parentElement, br = bar ? bar.getBoundingClientRect() : b;
    const tx = Math.max(br.left + 24, Math.min(br.right - 24, b.left + b.width / 2));
    const ty = b.top + b.height / 2;
    const f = document.createElement("span");
    f.className = "he-flyer"; f.setAttribute("aria-hidden", "true"); f.textContent = label || tabName;
    f.style.left = (a.left + a.width / 2) + "px"; f.style.top = (a.top + a.height / 2) + "px"; f.style.transform = "translate(-50%,-50%)";
    document.body.appendChild(f);
    const dx = tx - (a.left + a.width / 2), dy = ty - (a.top + a.height / 2);
    const anim = f.animate([
      { transform: "translate(-50%,-50%) translate(0,0) scale(1)", opacity: 1 },
      { transform: "translate(-50%,-50%) translate(" + (dx * 0.45) + "px," + (dy * 0.55 - 36) + "px) scale(.85)", opacity: 1, offset: 0.55 },
      { transform: "translate(-50%,-50%) translate(" + dx + "px," + dy + "px) scale(.25)", opacity: 0 },
    ], { duration: 680, easing: "cubic-bezier(.3,.7,.3,1)", fill: "forwards" });
    anim.onfinish = () => {
      if (f.parentNode) f.parentNode.removeChild(f);
      tab.classList.remove("he-bump"); void tab.offsetWidth; tab.classList.add("he-bump");
      heBuzz([14, 30, 14]);
      setTimeout(() => tab.classList.remove("he-bump"), 500);
    };
  } catch (e) { /* presentation only */ }
}

/* ─────────────────── v496: toast anchored to the button that caused it ─────────────────── */
// -> {x,y} when the toast should rise from the last pressed button, else null (corner toast).
export function heToastAnchor(detail) {
  try {
    if (heReduced()) return null;
    if (!detail || detail.anchor === false || detail.duration === 0 || detail.key != null) return null;
    if (detail.type !== "success" && detail.type !== "info") return null;
    const t = heLastTap();
    if (!t.el || t.age > 900 || !t.el.isConnected) return null;
    const r = t.el.getBoundingClientRect();
    if (!inView(r) || r.top < 48) return null;
    return { x: Math.max(16, Math.min(window.innerWidth - 16, r.left + r.width / 2)), y: r.top };
  } catch (e) { return null; }
}

/* ─────────────────── v496: job card zooms into the detail page ─────────────────── */
export function heZoomFrom(el, title) {
  try {
    if (!el || heReduced() || !el.animate) return;
    const r = el.getBoundingClientRect();
    if (!inView(r)) return;
    const z = document.createElement("div");
    z.className = "he-zoom"; z.setAttribute("aria-hidden", "true");
    const b = document.createElement("b"); b.textContent = title || ""; z.appendChild(b);
    z.style.left = r.left + "px"; z.style.top = r.top + "px"; z.style.width = r.width + "px"; z.style.height = r.height + "px";
    document.body.appendChild(z);
    const vw = window.innerWidth, vh = window.innerHeight;
    const a = z.animate([
      { transform: "translate(0,0)", width: r.width + "px", height: r.height + "px", opacity: 1 },
      { transform: "translate(" + (-r.left) + "px," + (-r.top) + "px)", width: vw + "px", height: vh + "px", opacity: 1, offset: 0.7 },
      { transform: "translate(" + (-r.left) + "px," + (-r.top) + "px)", width: vw + "px", height: vh + "px", opacity: 0 },
    ], { duration: 460, easing: EASE, fill: "forwards" });
    a.onfinish = () => { if (z.parentNode) z.parentNode.removeChild(z); };
    setTimeout(() => { if (z.parentNode) z.parentNode.removeChild(z); }, 700);
  } catch (e) { /* presentation only */ }
}

/* ─────────────────── v496: swipe between job tabs with momentum ─────────────────── */
// bodyRef: the scrolling tab body. order: tab names in bar order. setTab: the real setter. Touch only:
// a horizontal drag follows the thumb (resisted at the ends), a release past a third of the width or a
// quick flick changes tab; the existing pane ease then plays from the direction of travel.
//
// v512 (Koy: "a bunch of spots on mobile you should be able to scroll to the right"): v496 put
// touch-action: pan-y on the body so this could own sideways drags. On iPhone that also froze sideways
// scrolling of every wide table INSIDE the body (appliance loads, panel schedules, bid items), and of
// the tab itself when its content is wider than the screen. Now the body keeps normal touch behaviour
// and this listens to touch events instead: it never starts on something that scrolls sideways (or on
// a tab that is itself wider than the screen), inside a pop-up, or on a form control; once a drag is
// clearly sideways it calls preventDefault on touchmove so the page holds still while the tab follows.
export function heSwipeBlocked(target, el) {
  try {
    if (!target || !target.closest) return true;
    if (target.closest("input,textarea,select,[contenteditable=true],[data-he-noswipe],canvas")) return true;
    for (let n = target; n && n !== el; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.position === "fixed") return true;                                   // a pop-up over the tab
      if (/(auto|scroll)/.test(cs.overflowX) && n.scrollWidth > n.clientWidth + 1) return true;   // scrolls sideways itself
    }
    return el.scrollWidth > el.clientWidth + 1;                                    // the tab itself is wider than the screen
  } catch (e) { return true; }
}
export function useHeTabSwipe(bodyRef, tab, order, setTab) {
  const st = useRef({ on: false, x0: 0, y0: 0, dx: 0, t0: 0, dir: 0 });
  const cur = useRef({ tab, order, setTab });
  cur.current = { tab, order, setTab };
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return undefined;
    const settle = () => {
      el.style.transition = "transform 160ms ease-out, opacity 160ms ease-out";
      el.style.transform = ""; el.style.opacity = "";
      setTimeout(() => { el.style.transition = ""; el.style.willChange = ""; }, 180);
    };
    const start = (e) => {
      st.current.on = false;
      if (heReduced() || !e.touches || e.touches.length !== 1 || heSwipeBlocked(e.target, el)) return;
      const t = e.touches[0];
      st.current = { on: true, x0: t.clientX, y0: t.clientY, dx: 0, t0: performance.now(), dir: 0 };
    };
    const move = (e) => {
      const s = st.current; if (!s.on) return;
      if (!e.touches || e.touches.length !== 1) { s.on = false; if (s.dir === 1) settle(); return; }
      const t = e.touches[0];
      const dx = t.clientX - s.x0, dy = t.clientY - s.y0;
      if (s.dir === 0) {
        if (Math.abs(dx) < 12 && Math.abs(dy) < 12) return;
        s.dir = Math.abs(dx) > Math.abs(dy) * 1.4 ? 1 : -1;        // 1 = ours, -1 = vertical scroll
        if (s.dir === 1) { el.style.transition = "none"; el.style.willChange = "transform"; }
      }
      if (s.dir !== 1) return;
      if (e.cancelable) e.preventDefault();                          // hold the page still while the tab follows
      const { tab: tb, order: o } = cur.current, i = o.indexOf(tb);
      const atEnd = (dx > 0 && i <= 0) || (dx < 0 && i >= o.length - 1);
      s.dx = dx;
      el.style.transform = "translateX(" + (atEnd ? dx * 0.25 : dx * 0.9) + "px)";
      el.style.opacity = String(Math.max(0.55, 1 - Math.abs(dx) / (el.clientWidth * 1.6)));
    };
    const end = () => {
      const s = st.current; if (!s.on) return;
      s.on = false;
      if (s.dir !== 1) return;
      const { tab: tb, order: o, setTab: set } = cur.current, i = o.indexOf(tb), w = el.clientWidth || 1;
      const v = s.dx / Math.max(1, performance.now() - s.t0);
      let n = i;
      if ((s.dx < -w * 0.3 || v < -0.6) && i < o.length - 1) n = i + 1;
      else if ((s.dx > w * 0.3 || v > 0.6) && i > 0) n = i - 1;
      settle();
      if (n !== i) { heBuzz(8); set(o[n]); }
    };
    el.addEventListener("touchstart", start, { passive: true });
    el.addEventListener("touchmove", move, { passive: false });
    el.addEventListener("touchend", end); el.addEventListener("touchcancel", end);
    return () => { el.removeEventListener("touchstart", start); el.removeEventListener("touchmove", move); el.removeEventListener("touchend", end); el.removeEventListener("touchcancel", end); };
  }, [bodyRef]);
}

/* ─────────────────── v496: who else has this job open ─────────────────── */
// presence: job.presence map (name -> ISO). Shows a breathing initials bubble for everyone else seen
// in the last `withinMin` minutes. Pure read of the map; nothing is written.
const PRES_COLORS = ["#B06A2C", "#6A5E97", "#3E7D7A", "#B0892C", "#3E7D5A", "#B23A3A"];
export function HePresence({ presence, me, withinMin = 10 }) {
  const now = Date.now();
  const others = Object.keys(presence || {}).filter((n) => {
    if (!n || (me && n.trim().toLowerCase() === String(me).trim().toLowerCase())) return false;
    const t = new Date(presence[n]).getTime();
    return isFinite(t) && now - t < withinMin * 60000;
  }).sort();
  if (!others.length) return null;
  return h("span", { style: { display: "inline-flex", gap: 4, alignItems: "center" }, title: others.join(", ") + " also on this job" },
    others.slice(0, 4).map((n, i) => {
      const parts = n.trim().split(/\s+/), ini = (parts[0][0] || "") + (parts.length > 1 ? parts[parts.length - 1][0] : "");
      const c = PRES_COLORS[(n.charCodeAt(0) + n.length) % PRES_COLORS.length];
      const ago = Math.max(0, Math.round((now - new Date(presence[n]).getTime()) / 60000));
      return h("span", { key: n, className: "he-pres", title: n + " · " + (ago < 1 ? "just now" : ago + " min ago"), style: { background: c, "--he-pres-c": c + "88", animationDelay: (i * 70) + "ms" } }, ini.toUpperCase());
    }));
}

/* ─────────────────── v496: undo countdown bar ─────────────────── */
export function HeUndoBar({ ms = 10000 }) {
  return h("span", { className: "he-cd", "aria-hidden": true, style: { "--he-cd-ms": ms + "ms" } });
}

/* ─────────────────── v497 A: unfold on mount (collapsibles open with motion) ─────────────────── */
// Wrap the content that a dropdown reveals. On mount it grows from 0 to its height; closing still unmounts
// instantly (the content is gone, nothing to animate), which keeps the open/closed state code untouched.
export function HeUnfold(props) {
  const { tag, children, ...rest } = props;
  const ref = useRef(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || heReduced() || !el.animate) return;
    const hgt = el.scrollHeight;
    if (!hgt) return;
    el.style.overflow = "hidden";
    const a = el.animate([{ height: "0px", opacity: 0 }, { height: hgt + "px", opacity: 1 }], { duration: 300, easing: EASE });
    a.onfinish = () => { el.style.overflow = ""; };
  }, []);
  return h(tag || "div", Object.assign({ ref }, rest), children);
}

/* ─────────────────── v497 A/B: the list engine — FLIP, drop-in, text-change flash ─────────────────── */
// One MutationObserver on the whole page, flushed in a microtask (before paint). Any element with
// data-hekey="<stable id>" slides to its new spot when a commit moves it (FLIP), and drops in when it
// appears next to rows that were already there (a new need, a new reply, a new request). Any element with
// data-heflash="<id>" flashes once when its text changes (a crew cell swapping names, a CO card changing
// status). No hook per list: tag the row and the engine does the rest. useHeFlip() is kept as a no-op
// so earlier call sites still compile.
export function useHeFlip() { /* superseded by the global engine below */ }
const eng = { prev: new Map(), text: new Map(), t0: 0, queued: false, started: false, busy: new WeakSet() };
// Layout position that IGNORES transforms: a row mid-slide must not be measured mid-slide, or the next
// flush sees it "moved" again and slides it back (Koy: "wiggin out bouncing up and down"). offsetTop /
// offsetLeft are layout values, so they are stable while an animation runs.
const vrect = (el) => { let x = 0, y = 0, n = el; while (n) { x += n.offsetLeft; y += n.offsetTop; n = n.offsetParent; } return { top: y, left: x }; };
function heEngineFlush() {
  eng.queued = false;
  if (heReduced()) { eng.prev = new Map(); eng.text = new Map(); return; }
  const next = new Map(), prev = eng.prev, warm = Date.now() - eng.t0 > 1500;
  const rows = document.querySelectorAll("[data-hekey]");
  for (let i = 0; i < rows.length; i++) {
    const el = rows[i];
    if (!el.animate || !el.offsetParent) continue;          // hidden / detached: nothing to measure
    const k = el.getAttribute("data-hekey"), cur = vrect(el);
    next.set(k, cur);
    const p = prev.get(k);
    if (p) {
      if (eng.busy.has(el)) continue;                        // already sliding: let it finish, never restart
      const dy = p.top - cur.top, dx = p.left - cur.left;
      if ((Math.abs(dy) >= 2 || Math.abs(dx) >= 2) && Math.abs(dy) < 900 && Math.abs(dx) < 900) {
        eng.busy.add(el);
        const a = el.animate([{ transform: "translate(" + dx + "px," + dy + "px)" }, { transform: "none" }], { duration: 420, easing: EASE });
        a.onfinish = a.oncancel = () => eng.busy.delete(el);
      }
    } else if (warm && prev.size && !el.classList.contains("he-drop") && !el.classList.contains("he-rise")) {
      // new row beside rows that were already on the page → drop in
      const par = el.parentElement;
      let sib = false;
      if (par) { const q = par.querySelectorAll("[data-hekey]"); for (let j = 0; j < q.length; j++) { if (q[j] !== el && prev.has(q[j].getAttribute("data-hekey"))) { sib = true; break; } } }
      if (sib) { el.classList.add("he-drop"); setTimeout(() => el.classList.remove("he-drop"), 600); }
    }
  }
  eng.prev = next;
  const fl = document.querySelectorAll("[data-heflash]"), tnext = new Map();
  for (let i = 0; i < fl.length; i++) {
    const el = fl[i], k = el.getAttribute("data-heflash"), t = el.textContent;
    tnext.set(k, t);
    const was = eng.text.get(k);
    if (warm && was !== undefined && was !== t) { el.classList.remove("he-flash"); void el.offsetWidth; el.classList.add("he-flash"); setTimeout(() => el.classList.remove("he-flash"), 2000); }
  }
  eng.text = tnext;
}
// At most one flush per frame (counters that tick every frame used to flush every tick).
function heEngineQueue() { if (eng.queued) return; eng.queued = true; requestAnimationFrame(heEngineFlush); }
// REMOVED 2026-10-02 (Koy: "still doing it… fix them or remove what is still having issues"): the engine
// ran on its own on every page update and could not be made to sit still on the Job Board and the crew
// schedule with real data. Nothing starts it any more; keyed rows are inert. Tap-driven motion is untouched.
export function heStartEngine() {
  return;
  // eslint-disable-next-line no-unreachable
  if (eng.started || typeof document === "undefined" || typeof MutationObserver === "undefined") return;
  eng.started = true; eng.t0 = Date.now();
  const mo = new MutationObserver((recs) => {
    for (let i = 0; i < recs.length; i++) {
      const r = recs[i], t = r.target;
      // ignore our own fixed helpers (flyers, strike lines, ripples, zoom layers)
      if (t && t.nodeType === 1 && t.className && typeof t.className === "string" && /^he-(flyer|strike|ripple|zoom|atoast)/.test(t.className)) continue;
      heEngineQueue(); return;
    }
  });
  mo.observe(document.body, { childList: true, subtree: true, characterData: true });
  heEngineQueue();
}
// (engine auto-start removed — see heStartEngine)
// Flash one keyed row from code (e.g. after an email goes out): heFlashKey("<data-hekey>", "Sent")
export function heFlashKey(key, tag) {
  try {
    const el = document.querySelector('[data-hekey="' + String(key).replace(/"/g, '\\"') + '"]');
    if (!el || heReduced()) return;
    el.classList.remove("he-flash"); void el.offsetWidth; el.classList.add("he-flash");
    setTimeout(() => el.classList.remove("he-flash"), 2000);
    if (tag) {
      const s = document.createElement("span"); s.className = "he-flash-by"; s.textContent = tag;
      s.style.cssText = "position:absolute;right:8px;top:6px;background:#FFF3C4;border-radius:5px;padding:1px 6px";
      const cs = getComputedStyle(el); if (cs.position === "static") el.style.position = "relative";
      el.appendChild(s); setTimeout(() => { if (s.parentNode) s.parentNode.removeChild(s); }, 6000);
    }
  } catch (e) { /* presentation only */ }
}
// Fly a chip from the last tapped button to any element: heFlyTo('[data-hefly="needs-sent"]', "→ Brady")
export function heFlyTo(selector, label, fromEl) {
  try {
    if (heReduced()) return;
    const src = fromEl || (heLastTap().age < 2500 ? heLastTap().el : null);
    const to = document.querySelector(selector);
    if (!src || !to || !src.isConnected) return;
    const a = src.getBoundingClientRect(), b = to.getBoundingClientRect();
    if (!inView(a)) return;
    const tx = Math.max(16, Math.min(window.innerWidth - 16, b.left + b.width / 2)), ty = Math.max(16, Math.min(window.innerHeight - 16, b.top + b.height / 2));
    const f = document.createElement("span");
    f.className = "he-flyer"; f.setAttribute("aria-hidden", "true"); f.textContent = label || "";
    f.style.left = (a.left + a.width / 2) + "px"; f.style.top = (a.top + a.height / 2) + "px"; f.style.transform = "translate(-50%,-50%)";
    document.body.appendChild(f);
    const dx = tx - (a.left + a.width / 2), dy = ty - (a.top + a.height / 2);
    const anim = f.animate([
      { transform: "translate(-50%,-50%) translate(0,0) scale(1)", opacity: 1 },
      { transform: "translate(-50%,-50%) translate(" + (dx * 0.45) + "px," + (dy * 0.55 - 36) + "px) scale(.85)", opacity: 1, offset: 0.55 },
      { transform: "translate(-50%,-50%) translate(" + dx + "px," + dy + "px) scale(.25)", opacity: 0 },
    ], { duration: 680, easing: "cubic-bezier(.3,.7,.3,1)", fill: "forwards" });
    anim.onfinish = () => { if (f.parentNode) f.parentNode.removeChild(f); to.classList.remove("he-bump"); void to.offsetWidth; to.classList.add("he-bump"); heBuzz([14, 30, 14]); setTimeout(() => to.classList.remove("he-bump"), 500); };
  } catch (e) { /* presentation only */ }
}

/* ─────────────────── v497 A: nav view slides in from the direction of travel ─────────────────── */
// The nav bar carries data-he-nav; every sibling after it (the current view) eases in on view change.
export function useHeViewSlide(view, order) {
  const prev = useRef(view), first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; prev.current = view; return; }
    const was = prev.current; prev.current = view;
    if (heReduced()) return;
    const nav = document.querySelector("[data-he-nav]");
    if (!nav || !nav.parentElement) return;
    const dir = order.indexOf(view) >= order.indexOf(was) ? 1 : -1;
    let after = false;
    Array.prototype.forEach.call(nav.parentElement.children, (el) => {
      if (el === nav) { after = true; return; }
      if (!after || !el.animate) return;
      const cs = getComputedStyle(el);
      if (cs.position === "fixed" || cs.display === "none") return;
      el.animate([{ opacity: 0, transform: "translateX(" + dir * 22 + "px)" }, { opacity: 1, transform: "none" }], { duration: 240, easing: EASE });
    });
  }, [view]);
}

/* ─────────────────── v497 A: swipe a row right → done, left → snooze ─────────────────── */
// Spread heSwipeRowProps({ right:{label,color,fn}, left:{...} }) on the row. Touch only. A coloured
// underlay grows inside the row as the thumb drags; past 40% (or 110px) the action fires and the row
// springs back (the list's FLIP then moves it where it belongs). heJustSwiped() lets a tap handler on the
// same row ignore the click that follows a swipe.
let lastSwipeT = 0;
export const heJustSwiped = () => Date.now() - lastSwipeT < 500;
export function heSwipeRowProps(opts) {
  const st = { on: false, x0: 0, y0: 0, dx: 0, dir: 0, side: 0, cfg: null, el: null, under: null };
  const under = (el, side, cfg) => {
    const u = document.createElement("div");
    u.className = "he-swipe-under";
    u.setAttribute("aria-hidden", "true");
    u.style.cssText = "position:absolute;top:0;bottom:0;width:0;" + (side > 0 ? "left:0;justify-content:flex-start;" : "right:0;justify-content:flex-end;") +
      "background:" + cfg.color + ";color:#fff;font:800 12px system-ui;letter-spacing:.06em;display:flex;align-items:center;padding:0 12px;border-radius:inherit;overflow:hidden;white-space:nowrap;pointer-events:none";
    u.textContent = cfg.label;
    el.appendChild(u);
    return u;
  };
  const end = () => {
    if (!st.on) return;
    st.on = false;
    const el = st.el, u = st.under;
    if (st.dir !== 1 || !el) return;
    const w = el.offsetWidth || 1, hit = Math.abs(st.dx) > Math.max(110, w * 0.4);
    el.style.transition = "transform 320ms cubic-bezier(.34,1.45,.5,1)";
    el.style.transform = "";
    if (u) { u.style.transition = "width 320ms cubic-bezier(.34,1.45,.5,1)"; u.style.width = "0px"; }
    setTimeout(() => { if (el) { el.style.transition = ""; el.style.position = ""; } if (u && u.parentNode) u.parentNode.removeChild(u); }, 340);
    if (hit && st.cfg && typeof st.cfg.fn === "function") { lastSwipeT = Date.now(); heBuzz([14, 30, 14]); try { st.cfg.fn(); } catch (e) { /* caller's problem */ } }
  };
  return {
    onPointerDown: (e) => {
      if (e.pointerType !== "touch" || heReduced() || (!opts.right && !opts.left)) return;
      if (e.target && e.target.closest && e.target.closest("button,input,select,textarea,a,[data-he-noswipe]")) return;
      st.on = true; st.x0 = e.clientX; st.y0 = e.clientY; st.dx = 0; st.dir = 0; st.el = e.currentTarget; st.under = null;
    },
    onPointerMove: (e) => {
      if (!st.on) return;
      const dx = e.clientX - st.x0, dy = e.clientY - st.y0;
      if (st.dir === 0) {
        if (Math.abs(dx) < 12 && Math.abs(dy) < 12) return;
        st.dir = Math.abs(dx) > Math.abs(dy) * 1.3 ? 1 : -1;
        if (st.dir === 1) {
          const side = dx > 0 ? 1 : -1, cfg = side > 0 ? opts.right : opts.left;
          if (!cfg) { st.dir = -1; return; }
          st.side = side; st.cfg = cfg;
          st.el.style.position = "relative"; st.el.style.transition = "none";
          st.under = under(st.el, side, cfg);
          try { st.el.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ }
        }
      }
      if (st.dir !== 1) return;
      const same = (dx > 0 ? 1 : -1) === st.side;
      st.dx = same ? dx : 0;
      st.el.style.transform = "translateX(" + st.dx + "px)";
      if (st.under) { st.under.style.width = Math.abs(st.dx) + "px"; st.under.style[st.side > 0 ? "left" : "right"] = (-Math.abs(st.dx)) + "px"; }
    },
    onPointerUp: end,
    onPointerCancel: end,
  };
}

/* ─────────────────── v497 A: "update ready" (a new service worker took over) ─────────────────── */
// The app's worker calls skipWaiting + clients.claim, so a new version activates as soon as it installs; the
// page keeps running the old files until a reload. controllerchange with a previous controller = update.
export function useHeSwUpdate() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return undefined;
    const had = !!navigator.serviceWorker.controller;
    const onChange = () => { if (had) setReady(true); };
    navigator.serviceWorker.addEventListener("controllerchange", onChange);
    return () => navigator.serviceWorker.removeEventListener("controllerchange", onChange);
  }, []);
  return ready;
}

/* ─────────────────── v497 C: zoom a full-screen layer in from the last tapped thumbnail ─────────────────── */
export function heZoomIn(el) {
  try {
    if (!el || heReduced() || !el.animate) return;
    const t = heLastTap();
    const r = t.el && t.age < 1500 && t.el.isConnected ? t.el.getBoundingClientRect() : null;
    const ox = r ? (r.left + r.width / 2) + "px" : "50%", oy = r ? (r.top + r.height / 2) + "px" : "50%";
    el.style.transformOrigin = ox + " " + oy;
    el.animate([{ opacity: 0, transform: "scale(.12)" }, { opacity: 1, transform: "scale(1)" }], { duration: 300, easing: EASE });
  } catch (e) { /* presentation only */ }
}

/* ─────────────────── 7. Skeleton rows for the first load ─────────────────── */
export function HeSkeleton({ n = 5, height = 64 }) {
  const rows = [];
  for (let i = 0; i < n; i++) rows.push(h("div", { key: i, className: "he-skel", style: { height, marginBottom: 10 } }));
  return h("div", { "aria-hidden": true }, rows);
}
