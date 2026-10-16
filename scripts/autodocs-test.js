// Dashboard automated docs (v535, folders re-pointed 2026-10-15): pickLatest() against
// listings shaped like the real Meeting Prep folders. Run: node scripts/autodocs-test.js
// Exit 0 = all pass. Wired into `prebuild`.
"use strict";
const assert = require("assert");
const { AUTO_DOC_SOURCES, pickLatest } = require("../functions/autoDocs.js");
const monday = [
  { id: "1g2P", name: "Monday Office Meeting — 2026-10-12 (v2)", createdTime: "2026-10-12T21:16:18.725Z" },
  { id: "1aZj", name: "Monday Office Meeting — 2026-10-12", createdTime: "2026-10-12T19:36:22.554Z" },
  { id: "1bEc", name: "Monday Office Meeting — 2026-10-05 (v2)", createdTime: "2026-10-05T21:59:26.154Z" },
];
const wednesday = [
  { id: "wl2", name: "Weekly Lead Meeting — 2026-10-21", createdTime: "2026-10-20T22:05:00Z", webViewLink: "https://docs.google.com/document/d/wl2/edit?usp=drivesdk" },
  { id: "wl1", name: "Weekly Lead Meeting — 2026-10-14", createdTime: "2026-10-13T22:05:00Z" },
  { id: "wlt", name: "Weekly Lead Meeting — 2026-10-21 (test)", createdTime: "2026-10-20T23:30:00Z" },   // test copy is newer but still the same prefix: documents the (test) hazard
  { id: "wls", name: "SUPERSEDED 7:04p — Weekly Lead Meeting — 2026-10-21", createdTime: "2026-10-21T01:00:00Z" },
];
const friday = [
  { id: "fs2", name: "Friday Strategy Prep — 2026-10-23", createdTime: "2026-10-23T12:00:04.000Z", webViewLink: "https://docs.google.com/document/d/fs2/edit?usp=drivesdk" },
  { id: "fs1", name: "Friday Strategy Prep — 2026-10-16", createdTime: "2026-10-16T12:00:04.000Z" },
  { id: "fst", name: "TEST — Friday Strategy Prep — 2026-10-23", createdTime: "2026-10-23T13:00:00.000Z" },
  { id: "fsp", name: "PREVIEW — Friday Strategy Prep — 2026-10-23", createdTime: "2026-10-23T14:00:00.000Z" },
  { id: "fsx", name: "SUPERSEDED — Friday Strategy Prep — 2026-10-16", createdTime: "2026-10-24T00:00:00.000Z" },
  { id: "fsf", name: "Friday Strategy Prep — 2026-10-09 (fallback)", createdTime: "2026-10-09T12:00:04.000Z" },
];
const src = (k) => AUTO_DOC_SOURCES.find(s => s.key === k);
const pre = (k) => src(k).prefix;
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
ok(AUTO_DOC_SOURCES.length === 3 && AUTO_DOC_SOURCES.map(s => s.key).join() === "monday,wednesday,friday", "exactly three sources: monday, wednesday, friday");
ok(src("monday").folder === "17WmRG9qdErbJcvl4vDShRjSduJOZARZ0" && src("wednesday").folder === "1tAFxgYFL7su4xDviMDvPo0Xe355tGaRR" && src("friday").folder === "1q107o80DtOadifPymLZzzImSMQBf74_3", "each source points at its own Meeting Prep folder");
ok(pre("monday") === "Monday Office Meeting — " && pre("wednesday") === "Weekly Lead Meeting — " && pre("friday") === "Friday Strategy Prep — ", "prefixes");
ok(pickLatest(monday, pre("monday")).id === "1g2P", "monday: the (v2) made later the same day wins");
ok(pickLatest(monday, pre("monday")).url === "https://docs.google.com/document/d/1g2P/edit", "monday: builds a link when Drive gives none");
ok(pickLatest(wednesday, pre("wednesday")).id === "wlt", "wednesday: newest by createdTime among names that START with the prefix; SUPERSEDED does not win");
ok(pickLatest(wednesday.filter(f => f.id !== "wlt"), pre("wednesday")).id === "wl2", "wednesday: real doc wins once the test copy is gone");
ok(pickLatest(wednesday.filter(f => f.id !== "wlt"), pre("wednesday")).url.includes("/wl2/"), "wednesday: keeps Drive's link");
ok(pickLatest(friday, pre("friday")).id === "fs2", "friday: real doc wins; TEST / PREVIEW / SUPERSEDED prefixes do not match");
ok(pickLatest(friday, pre("friday")).url.includes("/fs2/"), "friday: keeps Drive's link");
ok(pickLatest([friday[2], friday[3], friday[4]], pre("friday")) === null, "friday: only TEST / PREVIEW / SUPERSEDED copies gives null");
ok(pickLatest([], pre("monday")) === null && pickLatest(undefined, "x") === null, "empty or missing listing gives null");
ok(new Set(AUTO_DOC_SOURCES.map(s => s.key)).size === AUTO_DOC_SOURCES.length, "keys are unique");
console.log(`autodocs-test: ${n} checks passed`);
