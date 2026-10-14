// Weekly Lead Meeting doc (v536): weeklyModel() keeps only jobs whose margin
// moved since last week, labels "was", trims the done groups, and returns the
// history to save. Margins below are the real ones from the Oct 7 doc.
// Run: node scripts/leadmeetingdoc-test.js — exit 0 = all pass. Wired into prebuild.
"use strict";
const assert = require("assert");
const fp = require("../functions/foremanMeetingPrep.js");
const { weeklyModel, meetingYmd } = require("../functions/leadMeetingDoc.js");
const row = (name, sn, phase, margin, extra) => ({ name, sn, phase, cur: { used: 100, est: 120, ratio: 0.83 }, rough: null, finish: null, extras: null, stage: 50, margin, marginEst: false, ratio: 0.83, ...(extra || {}) });
const model = () => ({
  heading: "Oct 14, 2026 | Foreman + Lead Meeting", generated: "Oct 13, 2026, 4:00 PM",
  carried: { from: "", rows: [], error: false }, needs: { bodies: [], tasks: [], error: false },
  schedule: { days: [], error: false }, inspections: { passed: [], failed: [], error: false },
  upcoming: { pastDue: [], soon: [], error: false }, shipped: { rows: [], more: 0, error: false }, pto: { rows: [], error: false },
  hours: {
    rough: [row("Miller Residence - Alpine", "1438", "rough", 64), row("Koplin Residence - Mapleton", "1443", "rough", 69.4), row("Oak Hill 5 - Alpine", "1454", "rough", 83), row("No Number", "", "rough", 40), row("No Margin", "1500", "rough", null)],
    finish: [row("Nguyen Residence", "1230", "finish", 11)],
    other: [], roughDone: [],
    completed: [row("Wood Residence Remodel", "1300", "completed", 2, { done: new Date(2026, 9, 8) }), row("Old Job", "1200", "completed", 20, { done: new Date(2026, 8, 20) })],
    error: false,
  },
});
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
const hist = { lastYmd: "2026-10-06", jobs: {
  "1438": [{ d: "2026-09-29", m: 70 }, { d: "2026-10-06", m: 72 }],   // moved 72 → 64
  "1443": [{ d: "2026-10-06", m: 69.2 }],                            // 69 → 69: not moved
  "1230": [{ d: "2026-09-29", m: 16 }],                              // none last week, two weeks ago 16 → 11
  "9999": [{ d: "2026-05-01", m: 30 }],                              // stale: dropped from history
} };
const out = weeklyModel(model(), hist, "2026-10-13");
const names = (k) => out.model.hours[k].map(r => r.name);
ok(names("rough").join() === "Miller Residence - Alpine", "rough keeps only Miller (Koplin unchanged, Oak Hill new mid-history, no-number and no-margin dropped)");
ok(out.model.hours.rough[0].was.margin === 72 && out.model.hours.rough[0].was.label === "last week", "Miller was 72% last week");
ok(names("finish").join() === "Nguyen Residence" && out.model.hours.finish[0].was.label === "two weeks ago", "Nguyen falls back to two weeks ago");
ok(names("completed").join() === "Wood Residence Remodel", "completed keeps only jobs done since the last doc");
ok(out.moved === 2, "two margins moved");
ok(out.model.heading === "Oct 14, 2026 | Weekly Lead Meeting" && meetingYmd(model().heading) === "2026-10-14", "heading and title date");
ok(out.history.lastYmd === "2026-10-13" && !out.history.jobs["9999"], "history dated today, stale job dropped");
ok(out.history.jobs["1438"].slice(-1)[0].m === 64 && out.history.jobs["1454"][0].m === 83 && out.history.jobs["1300"][0].m === 2, "history records every margin, any bucket");
ok(!out.history.jobs[""] && !out.history.jobs["1500"], "no number / no margin never stored");
const text = fp.renderLines(out.model).map(l => l.text).join("\n");
ok(text.includes("(was 72% last week)") && text.includes("Only jobs whose margin moved since 2026-10-06") && text.includes("Finish completed since last meeting"), "rendered doc carries the was-label, note and titles");
// The running notes doc renders exactly as before (no note, no was, normal titles).
const plain = fp.renderLines(model()).map(l => l.text).join("\n");
ok(!plain.includes("was ") && !plain.includes("Only jobs whose margin") && plain.includes("Finish completed in the last 30 days") && plain.includes("Koplin"), "notes-doc section unchanged");
// First run: everything with a margin is listed and flagged.
const first = weeklyModel(model(), {}, "2026-10-13");
ok(first.model.hours.rough.length === 3 && first.model.hours.rough.every(r => r.firstTracked), "first run lists every job with a margin");
ok(fp.renderLines(first.model).map(l => l.text).join("\n").includes("(first week tracked)"), "first run is labelled");
// Same-day re-run replaces today's entry instead of stacking.
const again = weeklyModel(model(), out.history, "2026-10-13");
ok(again.history.jobs["1438"].filter(e => e.d === "2026-10-13").length === 1, "re-run the same day doesn't duplicate");
console.log(`leadmeetingdoc-test: ${n} checks passed`);
