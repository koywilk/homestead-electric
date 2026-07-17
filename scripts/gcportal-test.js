// GC Portal projection unit tests — run: node scripts/gcportal-test.js
// Guards the outbound wall (functions/gcPortal.js). Exit 0 = all pass.
"use strict";
const {
  gcKeyOf, stripHtml, hashOf, makeToken, makeSlug, cleanLogoUrl, projectJobForPortal, jobBelongsToLink,
} = require("../functions/gcPortal.js");

let failures = 0;
function t(name, cond, detail) {
  if (cond) { console.log("  ok  " + name); }
  else { failures++; console.error("  FAIL " + name + (detail ? " — " + detail : "")); }
}

// ── fixture: a job shaped like real docs (incl. everything that must NOT leak)
const FIXTURE = {
  name: "Kwellerish <b>Residence</b>",
  address: "1042 W Skyridge Dr",
  simproNo: "1107",
  updated_at: "2026-07-16T12:00:00.000Z",
  gc: "  Robison  ",
  archived: false,
  // ---- forbidden internals (leak-guard targets) ----
  simproMargin: 42.5,
  simproMarginIsEst: false,
  netPL: 129000,
  roughNotes: "SECRET internal note about pricing",
  finishNotes: "SECRET finish note",
  accessNote: "lockbox code 4421",
  statusUpdate: "internal only",
  dailyUpdates: [{ text: "internal daily" }],
  foreman: "Keegan Wilkinson",
  lead: "Gage Lund",
  flagNote: "GC is slow to pay",
  panelBeforeGen: { secret: true },
  // ---- allowed content ----
  roughStage: "60%", roughStatus: "inprogress", roughStatusDate: "",
  roughProjectedStart: "6/4/2026", roughScheduledEnd: "",
  roughInspectionResult: "pass", roughInspectionDate: "7/1/2026",
  finishStage: "0%", finishStatus: "", finishStatusDate: "",
  finishProjectedStart: "9/1/2026", finishScheduledEnd: "",
  finalInspectionResult: "", finalInspectionDate: "",
  qcStatus: "fixed", finishQcStatus: "",
  matterportStatus: "scheduled",
  matterportLink: "https://my.matterport.com/show/?m=abc123",
  matterportLinks: [
    { label: "Rough as-built", url: "https://my.matterport.com/show/?m=abc123" },
    { label: "bad", url: "javascript:alert(1)" },
    { label: "insecure", url: "http://my.matterport.com/show/?m=plain" },
  ],
  changeOrders: [
    { coStatus: "pending", quote: "Q-1", desc: "secret co detail" },
    { coStatus: "completed", desc: "done co" },
  ],
  roughPunch: {
    main: {
      rooms: [{
        name: "Garage",
        items: [
          { id: "1", text: "Outlets <div>different heights</div>&nbsp;", done: true, fromQC: true, checkedBy: "Gage Lund", addedBy: "Koy Wilkinson" },
          { id: "2", text: "normal crew punch item", done: false },
        ],
      }],
      general: [{ id: "3", text: "Move wafers&nbsp;closet", done: true, fromQC: true, checkedBy: "Trever Worley" }],
      hotcheck: [],
    },
    upper: { rooms: [], general: [{ id: "4", text: "open general item", done: false }], hotcheck: [] },
  },
  finishPunch: { main: { rooms: [], general: [], hotcheck: [] } },
  returnTrips: [
    {
      id: "rt1",
      scope: "A few outlets need to move for cabinets&nbsp;<div>Locations from Austin&nbsp;</div>",
      material: "SECRET 30' 12/2 material list",
      assignedTo: "Gage Lund",
      rtStatus: "needs", needsSchedule: true, rtScheduled: false,
      scheduledDate: "", rtStatusDate: "7/31/2026",
      needsByStart: "", needsByEnd: "",
      signedOff: false, signedOffDate: "",
      punch: [
        { id: "p1", text: "<p style=\"font-size:17px\">extend laundry outlets</p>", done: false },
        { id: "p2", text: "raise 2 outlets", done: false },
      ],
      photos: [{ url: "https://firebasestorage.example/x.jpg" }],
    },
  ],
  roughQuestions: {
    upper: [
      { id: "q1", question: "Heights for <b>stair lights</b>?", done: false, for: "Haley" },
      { id: "q2", question: "Garage door openers", done: true, for: "Mark Wintzer Team", answer: "side mount SECRET-ish" },
    ],
    main: [
      { id: "q3", question: "Sauna specs", done: false, for: "Mark Wintzer Team" },
      { id: "q4", question: "answered one", done: true },
    ],
    // internal, NEVER shared (not in any share's ids; `for` matches no share
    // name) → must be invisible to the GC (audience gate).
    basement: [
      { id: "qInt", question: "SECRET internal: check margin before quoting Robison extra runs", done: false, for: "Office" },
    ],
  },
  finishQuestions: { upper: [], main: [], basement: [] },
  questionShares: [
    { id: "s1", name: "Haley - Design", ids: ["q1", "q2", "q4"], createdAt: "2026-07-01", updatedAt: "2026-07-07" },
    { id: "s2", name: "Team", ids: ["q3", "zzz-unknown"], createdAt: "2026-07-14" },
  ],
};

console.log("gcKeyOf:");
t("normalizes case+space", gcKeyOf("  Robison  ") === "robison");
t("collapses inner whitespace", gcKeyOf("Mark   Wintzer\tCompany") === "mark wintzer company");
t("empty-safe", gcKeyOf(null) === "");

console.log("stripHtml:");
t("strips tags+entities", stripHtml("Outlets <div>diff</div>&nbsp;heights") === "Outlets diff heights");
t("strips style-heavy p", stripHtml('<p style="x">extend</p>') === "extend");
// XSS regression (Piece 1 review): entity-encoded markup must NOT re-materialize
t("no re-materialized tag", !/[<>]/.test(stripHtml("&lt;img src=x onerror=alert(1)&gt;")), stripHtml("&lt;img src=x onerror=alert(1)&gt;"));
t("no double-encoded script", !/[<>]/.test(stripHtml("&lt;b&gt;&amp;lt;script&amp;gt;alert(1)&amp;lt;/script&amp;gt;&lt;/b&gt;")), stripHtml("&lt;b&gt;&amp;lt;script&amp;gt;alert(1)&amp;lt;/script&amp;gt;&lt;/b&gt;"));
t("drops unterminated trailing tag", !/[<>]/.test(stripHtml("see plans <not closed")), stripHtml("see plans <not closed"));
t("benign angle text survives readably", stripHtml("run 12/2 &lt;- from panel") === "run 12/2 - from panel", stripHtml("run 12/2 &lt;- from panel"));

console.log("hash/token/slug:");
t("hash stable", hashOf({ a: 1, b: [1, 2] }) === hashOf({ b: [1, 2], a: 1 }));
t("hash differs on change", hashOf({ a: 1 }) !== hashOf({ a: 2 }));
t("token unguessable-ish", makeToken().length === 20 && makeToken() !== makeToken());
const slug = makeSlug("Robison Build Co");
t("slug shape", /^robison-build-co-[a-z0-9]{4}$/.test(slug), slug);

console.log("jobBelongsToLink (membership):");
const L = { gcKey: "robison", jobIdsInclude: [], jobIdsExclude: [] };
t("matches by gcKey", jobBelongsToLink("j1", { gc: "Robison " }, L) === true);
t("non-match excluded", jobBelongsToLink("j1", { gc: "Someone Else" }, L) === false);
t("exclude hides a match", jobBelongsToLink("j1", { gc: "Robison" }, { ...L, jobIdsExclude: ["j1"] }) === false);
t("include force-adds a non-match", jobBelongsToLink("j2", { gc: "Other" }, { ...L, jobIdsInclude: ["j2"] }) === true);
t("exclude beats include", jobBelongsToLink("j3", { gc: "Robison" }, { ...L, jobIdsInclude: ["j3"], jobIdsExclude: ["j3"] }) === false);
t("null-safe", jobBelongsToLink("j", null, L) === false && jobBelongsToLink("j", {}, null) === false);

console.log("projection:");
const v = projectJobForPortal("1773092930059", FIXTURE);
t("returns a view", !!v);
t("identity fields", v.id === "1773092930059" && v.name === "Kwellerish Residence" && v.simproNo === "1107");
t("archived excluded", projectJobForPortal("x", { ...FIXTURE, archived: true }) === null);

console.log("leak-guard (forbidden content must be absent):");
const json = JSON.stringify(v).toLowerCase();
[
  ["simpromargin", "margin field"], ["netpl", "net P/L"], ["129000", "P/L value"],
  ["42.5", "margin value"], ["secret", "any SECRET string"], ["lockbox", "access note"],
  ["internal", "internal notes"], ["slow to pay", "flag note"], ["material", "RT material list"],
  ["30' 12/2", "material contents"], ["keegan", "foreman name"], ["dailyupdates", "daily updates"],
  ["panelbeforegen", "panel snapshot"], ["side mount secret", "answer text (answers not in v1 mirror)"],
].forEach(([needle, label]) => t("no leak: " + label, !json.includes(needle), "found '" + needle + "'"));

console.log("allowlist content present:");
t("rough phase", v.rough.stage === "60%" && v.rough.inspection === "pass");
t("punch open counts", v.rough.punchOpen === 2 && v.finish.punchOpen === 0, JSON.stringify([v.rough.punchOpen, v.finish.punchOpen]));
t("qc items = fromQC only", v.qc.items.length === 2 && v.qc.items.every((q) => q.text && !q.text.includes("<")));
t("qc fixer first-name only", v.qc.items[0].fixedBy === "Gage" && v.qc.items[1].fixedBy === "Trever");
t("matterport keeps https links only", v.matterport.links.length === 1 && v.matterport.links[0].url.startsWith("https://"), JSON.stringify(v.matterport.links));
t("matterport label", v.matterport.links[0].label === "Rough as-built");
t("matterport statusDate projected when present", (() => {
  const withDate = projectJobForPortal("x", { ...FIXTURE, matterportStatus: "scheduled", matterportStatusDate: "7/22/2026", matterportLinks: [], matterportLink: "" });
  return withDate.matterport.status === "scheduled" && withDate.matterport.statusDate === "7/22/2026" && withDate.matterport.links.length === 0;
})());
t("matterport statusDate empty when unset", v.matterport.statusDate === "" || v.matterport.statusDate == null, JSON.stringify(v.matterport));
t("return trip scope stripped", v.returnTrips[0].scope.indexOf("<") === -1 && v.returnTrips[0].scope.includes("Locations from Austin"));
t("return trip state", v.returnTrips[0].needsSchedule === true && v.returnTrips[0].targetDate === "7/31/2026");
t("rt open items stripped", v.returnTrips[0].openItems[0] === "extend laundry outlets");
t("questions totals (shared-gated: internal q excluded)", v.questions.asked === 4 && v.questions.answered === 2 && v.questions.open === 2, JSON.stringify(v.questions));
t("questions byFor rollup", v.questions.byFor.length === 2 && v.questions.byFor.every((g) => g.openCount === 1));
t("audience gate: unshared internal question absent", !v.questions.byFor.some((g) => g.who === "Office") && !JSON.stringify(v.questions).toLowerCase().includes("check margin"), JSON.stringify(v.questions.byFor));
t("share link tracking", (() => {
  const h = v.questions.links.find((l) => l.name === "Haley - Design");
  return h && h.sent === 3 && h.answered === 2 && h.waiting === 1;
})(), JSON.stringify(v.questions.links));
t("share with unknown id doesn't crash/count", (() => {
  const s2 = v.questions.links.find((l) => l.name === "Team");
  return s2 && s2.sent === 2 && s2.answered === 0 && s2.waiting === 1;
})());
t("CO counts only, no contents", v.changeOrders.count === 2 && v.changeOrders.open === 1 && !json.includes("q-1"));

console.log("logo url gate (co-brand header):");
t("https url passes", cleanLogoUrl("https://cdn.example.com/robison.png") === "https://cdn.example.com/robison.png");
t("bundled asset path passes", cleanLogoUrl("/gc-logo-robison.png") === "/gc-logo-robison.png");
t("http rejected", cleanLogoUrl("http://x.com/a.png") === "");
t("javascript: rejected", cleanLogoUrl("javascript:alert(1)") === "");
t("data: rejected", cleanLogoUrl("data:image/png;base64,AAAA") === "");
t("protocol-relative // rejected", cleanLogoUrl("//evil.com/a.png") === "");
t("path traversal chars rejected", cleanLogoUrl("/a b.png") === "" && cleanLogoUrl("/<img>.png") === "");
t("empty/null → empty", cleanLogoUrl("") === "" && cleanLogoUrl(null) === "" && cleanLogoUrl(undefined) === "");
t("overlong rejected", cleanLogoUrl("https://x.com/" + "a".repeat(500)) === "");
t("quote inside https rejected", cleanLogoUrl('https://x.com/"onerror="alert(1)') === "");
t("backtick/control/zwsp rejected", cleanLogoUrl("https://x.com/`a.png") === "" && cleanLogoUrl("https://x.com/a.png") === "" && cleanLogoUrl("https://x.com/a​.png") === "");
t("query string still passes", cleanLogoUrl("https://cdn.example.com/logo.png?v=2&w=300") === "https://cdn.example.com/logo.png?v=2&w=300");

console.log("caps & robustness:");
const big = { ...FIXTURE, returnTrips: Array.from({ length: 99 }, (_, i) => ({ id: String(i), scope: "s", punch: [] })) };
t("returnTrips capped", projectJobForPortal("x", big).returnTrips.length === 15);
t("garbage job safe", projectJobForPortal("x", { name: null, roughPunch: "not-an-object", returnTrips: "nope", roughQuestions: 7 }) !== null);
t("null job -> null", projectJobForPortal("x", null) === null);

console.log(failures ? "\n" + failures + " FAILURES" : "\nALL PASS");
process.exit(failures ? 1 : 0);
