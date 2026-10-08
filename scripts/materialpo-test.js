// Crew POs from the app — rules tests. Run: node scripts/materialpo-test.js (prebuild chain).
// Shapes come from Homestead's real Simpro data (2026-10-08): job 1438 sections,
// the vendors list, and CED's live PO email.
"use strict";
const R = require("../functions/materialPO/rules.js");
const assert = require("assert");
const eq = (a, b, m) => assert.strictEqual(JSON.stringify(a), JSON.stringify(b), m);
let n = 0; const t = (name, fn) => { fn(); n++; };

t("suppliers", () => {
  eq(R.supplierRule("CED"), { kind: "email", simproName: "CED" }, "CED emails");
  eq(R.supplierRule(" home depot ").kind, "number", "Home Depot is a store run");
  eq(R.supplierRule("Amazon").kind, "number", "Amazon is a store run");
  eq(R.supplierRule("ACE").simproName, "ACE Hardware", "ACE alias");
  for (const s of ["Shop", "Platt", "Other", "", null]) eq(R.supplierRule(s), null, `${s} can't be sent`);
});

t("vendor match never grabs Ace Rentals", () => {
  const vendors = [{ ID: 4, Name: "Ace Rentals" }, { ID: 97, Name: "ACE Hardware" }, { ID: 13, Name: "CED", Email: "x@y.com" }, { ID: 30, Name: "Home Depot" }];
  eq(R.vendorFor(R.supplierRule("ACE"), vendors).ID, 97, "ACE → ACE Hardware");
  eq(R.vendorFor(R.supplierRule("CED"), vendors).ID, 13, "CED");
  eq(R.vendorFor(R.supplierRule("Amazon"), vendors), null, "missing vendor → null");
  eq(R.vendorFor(null, vendors), null, "no rule → null");
});

t("cost center: Base section first, phase by company cost center", () => {
  // Job 1438, trimmed: Base has Rough In (18864) then Finish (18865); a later
  // change-order section also has rough lines that must never win.
  const sections = [
    { ID: 25615, DisplayOrder: 4, ccs: [{ ID: 18961, Name: "Concrete Floor Boxes (x6)", CostCenter: { Name: "Residential (Rough In)" } }] },
    { ID: 25087, DisplayOrder: 1, ccs: [
      { ID: 18864, Name: "Rough In ", CostCenter: { Name: "Residential (Rough In)" } },
      { ID: 18865, Name: "Finish", CostCenter: { Name: "Residential (Finish)" } },
    ] },
    { ID: 26506, DisplayOrder: 5, ccs: [{ ID: 19061, Name: "22KW Generator", CostCenter: { Name: "Residential (Generators)" } }] },
  ];
  eq(R.pickCostCenter(sections, "rough").id, 18864, "rough → Base Rough In");
  eq(R.pickCostCenter(sections, "rough").name, "Rough In", "name trimmed");
  eq(R.pickCostCenter(sections, "finish").id, 18865, "finish → Base Finish");
  eq(R.pickCostCenter([{ ID: 1, DisplayOrder: 1, ccs: [{ ID: 9, Name: "Gear", CostCenter: { Name: "Commercial (Rough In)" } }] }], "rough").id, 9, "commercial rough");
  eq(R.pickCostCenter([{ ID: 1, ccs: [{ ID: 9, CostCenter: { Name: "Residential (Generators)" } }] }], "rough"), null, "no match → null");
  eq(R.pickCostCenter(sections, "gear"), null, "unknown phase → null");
});

t("card list → clean lines", () => {
  eq(R.itemsToLines("10x 3&rsquo;0 spanners<br>20x single gang nail ons&nbsp;<br><br>1000&rsquo; 14/2 romex (250&rsquo; rolls)"),
    ["10x 3'0 spanners", "20x single gang nail ons", "1000' 14/2 romex (250' rolls)"], "br + entities");
  eq(R.itemsToLines("<div>a</div><div>b &amp; c</div>"), ["a", "b & c"], "divs");
  eq(R.itemsToLines(""), [], "empty");
  eq(R.itemsToLines(null), [], "null");
  eq(R.itemsToLines(Array(300).fill("x").join("<br>")).length, 200, "capped at 200 lines");
});

t("dates and pickup line", () => {
  eq(R.shortDate("2026-10-09"), "Fri 10/9", "short date");
  eq(R.shortDate("2026-02-31"), "", "impossible date");
  eq(R.shortDate("10/9/2026"), "", "wrong format");
  eq(R.cardDateToIso("10/9/2026"), "2026-10-09", "card M/D/YYYY");
  eq(R.cardDateToIso("2026-10-09"), "2026-10-09", "already ISO");
  eq(R.cardDateToIso("soon"), "", "junk");
  eq(R.pickupLine({ get: "willcall", date: "2026-10-09" }), "For will call on Fri 10/9 please.", "will call");
  eq(R.pickupLine({ get: "deliver", date: "2026-10-09" }), "Please deliver to the job on Fri 10/9.", "deliver");
  eq(R.pickupLine({ get: "willcall", date: "" }), "For will call please.", "no date");
});

t("supplier notes escape what the crew typed", () => {
  const h = R.vendorNotesHtml(["<b>2x</b> boxes", "a & b"], "For will call please.");
  assert(h.startsWith("<div>For will call please.</div><div>&nbsp;</div>"), "pickup first");
  assert(h.includes("<div>&lt;b&gt;2x&lt;/b&gt; boxes</div>") && h.includes("<div>a &amp; b</div>"), "escaped");
});

t("recipients: test sends ONLY to the test inbox", () => {
  const base = { vendorEmail: "homestead@cedaf.com", bids: "bids@homesteadelectric.net", senderEmail: "keegan@homesteadelectric.net" };
  eq(R.recipients({ ...base, mode: "test", testTo: "koy@example.com" }), { to: ["koy@example.com"], cc: [], replyTo: "" }, "test → only testTo, nobody copied");
  eq(R.recipients({ ...base, mode: "test", testTo: "" }), null, "test with no inbox → nothing sends");
  eq(R.recipients({ ...base, mode: "live", testTo: "koy@example.com" }),
    { to: ["homestead@cedaf.com"], cc: ["bids@homesteadelectric.net", "keegan@homesteadelectric.net"], replyTo: "keegan@homesteadelectric.net" }, "live → CED, cc bids@ + sender");
  eq(R.recipients({ ...base, mode: "live", senderEmail: "" }).cc, ["bids@homesteadelectric.net"], "live, no sender email");
  eq(R.recipients({ ...base, mode: "live", vendorEmail: "" }), null, "live, supplier has no email → nothing sends");
  eq(R.recipients({ ...base, mode: "off", testTo: "koy@example.com" }), null, "off → nothing");
});

t("email: test banner only in test, list escaped, subject like Simpro's", () => {
  const args = { poNo: "7241", jobName: "Miller Residence", supplierName: "CED", lines: ["10x <spanners>"], pickup: "For will call on Fri 10/9 please.",
    sender: { name: "Keegan Wilkinson", position: "Project Lead", phone: "(801) 874-9395", email: "keegan@homesteadelectric.net" },
    intended: { to: "homestead@cedaf.com", cc: "bids@homesteadelectric.net, keegan@homesteadelectric.net" } };
  const live = R.buildPoEmail({ ...args, mode: "live" });
  eq(live.subject, "PO 7241 – Miller Residence – Homestead Electric", "live subject");
  assert(!/TEST/.test(live.html), "no test banner live");
  assert(live.html.includes("10x &lt;spanners&gt;") && !live.html.includes("<spanners>"), "list escaped");
  assert(live.html.includes("Project Lead") && live.text.includes("(801) 874-9395"), "signature");
  assert(live.text.includes("- 10x <spanners>"), "plain text list");
  const test = R.buildPoEmail({ ...args, mode: "test" });
  eq(test.subject, "[TEST] PO 7241 – Miller Residence – Homestead Electric", "test subject");
  assert(test.html.includes("TEST from the Command Center") && test.html.includes("homestead@cedaf.com"), "test banner says where it would go");
});

t("test always wins for the email", () => {
  eq(R.emailMode("live", "live"), "live", "live + live");
  eq(R.emailMode("test", "live"), "test", "switched back to test: a live PO's retry goes only to the test inbox");
  eq(R.emailMode("live", "test"), "test", "a test PO stays a test email");
  eq(R.emailMode("test", "test"), "test", "test");
  eq(R.emailMode("off", "live"), "test", "anything unexpected falls back to test");
  eq(R.emailMode(undefined, undefined), "test", "missing → test");
});

t("one key per card", () => {
  eq(R.logKey("job_abc", "rough", "1791484665123"), "job-abc_rough_1791484665123", "underscore in job id can't break the key");
  eq(R.logKey("J1", "finish", "17"), "J1_finish_17", "finish");
  eq(R.logKey("J1", "gear", "17"), "", "bad phase");
  eq(R.logKey("", "rough", "17"), "", "no job");
  eq(R.logKey("J1", "rough", ""), "", "no card");
});

console.log(`materialpo-test: ${n} groups passed`);
