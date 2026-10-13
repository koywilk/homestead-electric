// Dashboard automated docs (v535): pickLatest() against the real listings of
// the packet and Monday folders on 2026-10-13. Run: node scripts/autodocs-test.js
// Exit 0 = all pass. Wired into `prebuild`.
"use strict";
const assert = require("assert");
const { AUTO_DOC_SOURCES, pickLatest } = require("../functions/autoDocs.js");
const packet = [
  { id: "1vu6", name: "Lead Meeting Prep — Wed, Oct 7", createdTime: "2026-10-06T12:00:12.605Z" },
  { id: "1f94", name: "Weekly Strategy Meeting — 2026-10-08", createdTime: "2026-10-09T01:54:59.115Z" },
  { id: "1kp3", name: "SUPERSEDED 7:04p — Weekly Strategy Meeting — 2026-10-08", createdTime: "2026-10-09T00:04:02.676Z" },
  { id: "1yXJ", name: "Oct 9, 2026 | Weekly Strategy/Scheduling Meeting — Prep", createdTime: "2026-10-09T00:28:29.813Z" },
  { id: "1dB_", name: "Lead Meeting Prep — Wed, Sep 9", createdTime: "2026-09-08T20:45:44.403Z" },
  { id: "fp1", name: "Friday Packet — Oct 2, 2026", createdTime: "2026-10-02T11:30:04.000Z" },
  { id: "fp2", name: "Friday Packet — Oct 9, 2026", createdTime: "2026-10-09T11:30:04.000Z", webViewLink: "https://docs.google.com/document/d/fp2/edit?usp=drivesdk" },
];
const monday = [
  { id: "1g2P", name: "Monday Office Meeting — 2026-10-12 (v2)", createdTime: "2026-10-12T21:16:18.725Z" },
  { id: "1aZj", name: "Monday Office Meeting — 2026-10-12", createdTime: "2026-10-12T19:36:22.554Z" },
  { id: "1bEc", name: "Monday Office Meeting — 2026-10-05 (v2)", createdTime: "2026-10-05T21:59:26.154Z" },
];
const pre = (k) => AUTO_DOC_SOURCES.find(s => s.key === k).prefix;
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
ok(pickLatest(packet, pre("lead")).id === "1vu6", "lead prep: newest Lead Meeting Prep");
ok(pickLatest(packet, pre("strategy")).id === "1f94", "strategy: the real one, not SUPERSEDED or the hand-made Prep doc");
ok(pickLatest(packet, pre("packet")).id === "fp2", "packet: newest Friday Packet");
ok(pickLatest(packet, pre("packet")).url.includes("/fp2/"), "packet: keeps Drive's link");
ok(pickLatest(monday, pre("monday")).id === "1g2P", "monday: the (v2) made later the same day wins");
ok(pickLatest(monday, pre("monday")).url === "https://docs.google.com/document/d/1g2P/edit", "monday: builds a link when Drive gives none");
ok(pickLatest([], pre("monday")) === null && pickLatest(undefined, "x") === null, "empty or missing listing gives null");
ok(new Set(AUTO_DOC_SOURCES.map(s => s.key)).size === AUTO_DOC_SOURCES.length, "keys are unique");
console.log(`autodocs-test: ${n} checks passed`);
