#!/usr/bin/env node
/* claude-reports-test.js — gate for Reports in the Claude tab (SW v616).
 *
 * Koy, 2026-11-05: reports "easily accessable from the claude section in
 * dashboard", "from here on any reports will go there as well organized
 * neatly"; 2026-11-06: "Yes, build it". His standing rule: no cost or margin
 * dollars outside the owners and admins (foremen may see margin %).
 *
 * Covers: functions/duetWrites/reports.js (filing, the dollar guard, the job
 * read from Command Center, replace-by-title, archive, the owners-only cut in
 * both callable modes), duetApi's report path through a fake io, the rules
 * block, and src/reportMd.js (the text-only reader).
 */
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const RP = require("../functions/duetWrites/reports.js");
const MD = require("../src/reportMd.js");

let n = 0;
const check = (label, fn) => Promise.resolve().then(fn).then(() => { n++; console.log("  ok  " + label); }, (e) => { console.error("  FAIL " + label + "\n       " + (e && e.stack || e)); process.exit(1); });

const NOW = "2026-11-06T18:40:00.000Z";
const ROSE = { simproNo: "889", name: "Rose Residence", archived: false };
const base = { jobId: "1755000000001", type: "plan", title: "889 Rose Residence: Finish Game Plan", content: "# Plan\n\nFinish at **15% margin** by Dec 1.", ownersOnly: false, forWho: "Keegan" };

(async () => {
  console.log("claude-reports-test");

  await check("files a plan: number and name come from the job, not the caller", () => {
    const p = RP.planFile({ ...base }, ROSE, null, NOW);
    assert(!p.refused, p.refused);
    assert(/^rep_[0-9a-f]{24}$/.test(p.id));
    assert.strictEqual(p.doc.jobNo, "889");
    assert.strictEqual(p.doc.jobName, "Rose Residence");
    assert.strictEqual(p.doc.version, 1);
    assert.strictEqual(p.doc.filedAt, NOW);
    assert.strictEqual(p.doc.ownersOnly, false);
    assert.strictEqual(p.replaced, false);
  });

  await check("a dollar figure needs ownersOnly", () => {
    for (const c of ["Sell $161,631.06", "costs $ 12 more", "-$300 credit", "USD 400"]) {
      const p = RP.planFile({ ...base, content: c }, ROSE, null, NOW);
      assert(p.refused && /dollar/.test(p.refused), c);
    }
    assert(RP.planFile({ ...base, title: "Rose $5k" }, ROSE, null, NOW).refused);
    const ok = RP.planFile({ ...base, content: "Sell $161,631.06", ownersOnly: true }, ROSE, null, NOW);
    assert(!ok.refused && ok.doc.ownersOnly === true);
    // Margin % and hours are fine for everyone.
    assert(!RP.planFile({ ...base, content: "31.1% margin, 213 hours cap, 15%" }, ROSE, null, NOW).refused);
  });

  await check("refuses: no job, no number, bad type, empty, too long, unknown field, bad ownersOnly", () => {
    assert(RP.planFile({ ...base }, null, null, NOW).refused);
    assert(RP.planFile({ ...base }, { name: "No number" }, null, NOW).refused);
    assert(RP.planFile({ ...base, jobId: "" }, ROSE, null, NOW).refused);
    assert(RP.planFile({ ...base, type: "memo" }, ROSE, null, NOW).refused);
    assert(RP.planFile({ ...base, title: "  " }, ROSE, null, NOW).refused);
    assert(RP.planFile({ ...base, content: "" }, ROSE, null, NOW).refused);
    assert(RP.planFile({ ...base, content: "x".repeat(RP.MAX_CONTENT + 1) }, ROSE, null, NOW).refused);
    assert(RP.planFile({ ...base, jobNo: "889" }, ROSE, null, NOW).refused);
    assert(RP.planFile({ ...base, ownersOnly: "yes" }, ROSE, null, NOW).refused);
    assert(RP.planFile({ ...base, key: "bad key!" }, ROSE, null, NOW).refused);
  });

  await check("same job + type + title is the same report: replaced, filedAt kept, version up", () => {
    const a = RP.fileId(base), b = RP.fileId({ ...base, title: base.title.toUpperCase(), content: "new" });
    assert.strictEqual(a.id, b.id);
    assert.notStrictEqual(a.id, RP.fileId({ ...base, type: "material" }).id);
    const first = RP.planFile(base, ROSE, null, "2026-11-05T10:00:00.000Z");
    const again = RP.planFile({ ...base, content: "v2" }, ROSE, first.doc, NOW);
    assert.strictEqual(again.id, first.id);
    assert.strictEqual(again.replaced, true);
    assert.strictEqual(again.doc.filedAt, "2026-11-05T10:00:00.000Z");
    assert.strictEqual(again.doc.updatedAt, NOW);
    assert.strictEqual(again.doc.version, 2);
    assert.strictEqual(RP.fileId({ ...base, key: "rose-plan-1" }).id, "rep_rose-plan-1");
    assert(RP.planFile({ ...base, key: "rose-plan-1" }, ROSE, { ...first.doc, jobId: "other" }, NOW).refused);
  });

  await check("content keeps line breaks, drops other control characters", () => {
    const p = RP.planFile({ ...base, content: "a\r\nb\u0007c\n\n\n\n\nd" }, ROSE, null, NOW);
    assert.strictEqual(p.doc.content, "a\nbc\n\n\nd");
  });

  await check("archive flips archived only; a repeat is a no-op; unknown id refused", () => {
    const prior = RP.planFile(base, ROSE, null, NOW).doc;
    const p = RP.planArchive({ id: "rep_abcdef123456" }, prior, NOW);
    assert.deepStrictEqual(Object.keys(p.patch).sort(), ["archived", "archivedAt", "updatedAt"]);
    assert.strictEqual(p.patch.archived, true);
    assert(RP.planArchive({ id: "rep_abcdef123456" }, { ...prior, archived: true }, NOW).noop);
    assert.strictEqual(RP.planArchive({ id: "rep_abcdef123456", archived: false }, { ...prior, archived: true }, NOW).patch.archived, false);
    assert(RP.planArchive({ id: "nope" }, prior, NOW).refused);
    assert(RP.planArchive({ id: "rep_abcdef123456" }, null, NOW).refused);
  });

  await check("callable cut: owners-only reports reach admins alone, in list and one mode", () => {
    const plan = RP.planFile(base, ROSE, null, "2026-11-05T10:00:00.000Z").doc;
    const money = RP.planFile({ ...base, type: "margin", title: "Rose margin math", content: "Sell $161,631.06", ownersOnly: true, forWho: "Josh" }, ROSE, null, NOW).doc;
    const old = { ...RP.planFile({ ...base, title: "old" }, ROSE, null, NOW).doc, archived: true };
    const rows = [["rep_plan00000001", plan], ["rep_money0000001", money], ["rep_old000000001", old]];
    const crew = RP.buildList(rows, { isAdmin: false });
    assert.deepStrictEqual(crew.map(r => r.id), ["rep_plan00000001"]);
    const admin = RP.buildList(rows, { isAdmin: true });
    assert.deepStrictEqual(admin.map(r => r.id), ["rep_money0000001", "rep_plan00000001"], "newest first, archived left out");
    assert(admin.every(r => !("content" in r)), "the list never carries bodies");
    assert(JSON.stringify(crew).indexOf("161") === -1);
    const no = RP.buildOne("rep_money0000001", money, { isAdmin: false });
    assert.deepStrictEqual(no, { ok: false, notFound: true }, "a non-admin can't tell it exists");
    const yes = RP.buildOne("rep_money0000001", money, { isAdmin: true });
    assert(yes.ok && /161,631/.test(yes.report.content) && yes.report.typeLabel === "Margin math");
  });

  await check("duetApi: report.file reads the job, writes one claude_reports doc, nothing else", async () => {
    const api = require("../functions/duetWrites/api.js");
    const writes = [];
    const store = {};
    const io = {
      nowIso: () => NOW,
      getJobData: async (id) => (id === base.jobId ? ROSE : null),
      getReport: async (id) => store[id] || null,
      setReport: async (id, doc) => { writes.push(["set", id]); store[id] = doc; },
      patchReport: async (id, patch) => { writes.push(["patch", id]); store[id] = { ...store[id], ...patch }; },
      getAudit: async () => { throw new Error("reports never touch duet_writes"); },
      countRecent: async () => { throw new Error("reports aren't in the hourly limit"); },
      runTx: async () => { throw new Error("no transaction for a report"); },
    };
    const r = await api.handle({ requestId: "req_report_0001", action: "report.file", args: { ...base } }, io);
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(r.body.simproNo, "889");
    assert.strictEqual(r.body.replaced, false);
    const again = await api.handle({ requestId: "req_report_0002", action: "report.file", args: { ...base, content: "v2" } }, io);
    assert.strictEqual(again.body.reportId, r.body.reportId);
    assert.strictEqual(again.body.version, 2);
    const money = await api.handle({ requestId: "req_report_0003", action: "report.file", args: { ...base, content: "$100" } }, io);
    assert.strictEqual(money.status, 400);
    const nojob = await api.handle({ requestId: "req_report_0004", action: "report.file", args: { ...base, jobId: "999" } }, io);
    assert.strictEqual(nojob.status, 400);
    const arch = await api.handle({ requestId: "req_report_0005", action: "report.archive", args: { id: r.body.reportId } }, io);
    assert.strictEqual(arch.body.archived, true);
    assert.deepStrictEqual(writes.map(w => w[0]), ["set", "set", "patch"]);
    assert(api.ACTIONS.includes("report.file") && api.ACTIONS.includes("report.archive"));
  });

  await check("rules: claude_reports has no client access, catch-all still last", () => {
    const rules = fs.readFileSync(path.join(__dirname, "..", "firestore.rules"), "utf8");
    const m = /match \/claude_reports\/\{id\} \{\s*allow read, write: if false;\s*\}/.exec(rules);
    assert(m, "explicit deny block");
    assert(rules.lastIndexOf("match /{document=**}") > m.index, "catch-all stays after it");
  });

  await check("reader: headings, lists, tables, bold; links and tags stay text", () => {
    const b = MD.parseReportMd([
      "# 889 Rose Residence: Finish Game Plan", "", "For Keegan. Updated Nov 5.", "", "## Hours: the cap", "",
      "- **Next week (Nov 9 to 12):** you, Austin, Gage", "- **The cap:** 213 hours", "", "1. Order only what's on the bid list.", "2. Return extras to CED.", "",
      "| Line | Bid | Left |", "| --- | --- | --- |", "| Base Finish | 60% | 40% |", "| **Total** |  | **26%** |", "",
      "See [the plan](https://example.com/x) and <script>alert(1)</script> *now*.",
    ].join("\n"));
    assert.deepStrictEqual(b.map(x => x.t), ["h", "p", "h", "ul", "ol", "table", "p"]);
    assert.strictEqual(b[0].level, 1);
    assert.deepStrictEqual(b[3].items[0][0], { text: "Next week (Nov 9 to 12):", b: true });
    assert.strictEqual(b[4].items.length, 2);
    assert.strictEqual(b[5].head.length, 3);
    assert.strictEqual(b[5].rows.length, 2);
    assert.deepStrictEqual(b[5].rows[1][2], [{ text: "26%", b: true }]);
    const last = b[6].runs.map(r => r.text).join("");
    assert.strictEqual(last, "See the plan and <script>alert(1)</script> now.");
  });

  await check("reader: a loose list (blank lines between items) is one list", () => {
    const b = MD.parseReportMd("1. one\n\n2. two\n\n3. three");
    assert.deepStrictEqual(b.map(x => x.t), ["ol"]);
    assert.strictEqual(b[0].items.length, 3);
  });

  await check("the app draws reports as text: no dangerouslySetInnerHTML in OdReport", () => {
    const app = fs.readFileSync(path.join(__dirname, "..", "src", "App.js"), "utf8");
    const i = app.indexOf("function OdReport(");
    assert(i > 0);
    const fn = app.slice(i, app.indexOf("\n}\n", i));
    assert(!/dangerouslySetInnerHTML|SafeHtml|innerHTML/.test(fn));
    assert(/memberCallable\("claudeReports"/.test(app), "reads through the live-PIN callable");
    assert(!/collection\(db, "claude_reports"\)|doc\(db, "claude_reports"/.test(app), "never reads Firestore directly");
  });

  // ── v667 Copy and Share ─────────────────────────────────────────────────────
  const WATCH = [
    "# 889 Rose Residence: Margin Watch", "",
    "- Rough: 94% done, net margin 31%", "- Finish hours: 88% of bid, close to over",
    "- Material spent: 14,820 of 16,500", "- Labor cost to date: 9,240", "- Bid hours 213, used 190 hours",
    "- Sell $161,631", "- Payton on finish for 3 days", "",
    "| Phase | Hours | Cost | Margin |", "| --- | --- | --- | --- |", "| Rough | 120 | 9,240 | 31% |", "| Finish | 80 | 4,100 | 18% |",
  ].join("\n");

  await check("foreman copy: dollar and cost lines go, margin %, hours and days stay", () => {
    const f = RP.foremanSafe(WATCH);
    for (const gone of ["14,820", "9,240", "161", "4,100", "Cost"]) assert(f.content.indexOf(gone) === -1, gone);
    for (const kept of ["net margin 31%", "88% of bid", "Bid hours 213, used 190 hours", "Payton on finish for 3 days", "| Phase | Hours | Margin |", "| Rough | 120 | 31% |"]) assert(f.content.indexOf(kept) >= 0, kept);
    assert.strictEqual(f.cut, 4, "3 lines + 1 table column");
    assert.strictEqual(RP.foremanSafe("All margin, 31%. 213 hours.").cut, 0);
    assert(RP.moneyText("Contract value 48,000") && RP.moneyText("Revenue 12k") && RP.moneyText("USD 400"));
    assert(!RP.moneyText("Order 3 boxes of 12/2") && !RP.moneyText("Rough net margin 31%") && !RP.moneyText("Payton, 2 days"));
  });

  await check("filing: a cost figure without $ needs ownersOnly too", () => {
    const p = RP.planFile({ ...base, content: "Material spent: 14,820 of 16,500" }, ROSE, null, NOW);
    assert(p.refused && /cost figures/.test(p.refused));
    assert(!RP.planFile({ ...base, content: "Material spent: 14,820", ownersOnly: true }, ROSE, null, NOW).refused);
    assert(!RP.planFile({ ...base, content: "Finish hours 88% of bid. Net margin 18%." }, ROSE, null, NOW).refused);
    assert(RP.planFile({ ...base, title: "Rose labor cost 9,240" }, ROSE, null, NOW).refused);
  });

  await check("callable: non-admins get only the foreman copy; admins get both", () => {
    // A report filed before v667 could hold a cost line with no $ sign.
    const old = { ...RP.planFile({ ...base, content: "Hours ok" }, ROSE, null, NOW).doc, content: WATCH.replace("- Sell $161,631\n", "") };
    const crew = RP.buildOne("rep_watch0000001", old, { isAdmin: false });
    assert(crew.ok && crew.report.foremanCopy === true);
    assert(crew.report.content.indexOf("14,820") === -1 && crew.report.content.indexOf("9,240") === -1);
    assert(!("foremanContent" in crew.report));
    const adm = RP.buildOne("rep_watch0000001", old, { isAdmin: true });
    assert(adm.report.content.indexOf("14,820") >= 0, "admins see the full text");
    assert(adm.report.foremanContent.indexOf("14,820") === -1 && adm.report.foremanCut > 0);
    const own = RP.buildOne("rep_money0000001", { ...old, ownersOnly: true, content: "Sell $1" }, { isAdmin: true });
    assert.strictEqual(own.report.foremanContent, "", "owners-only has no foreman copy");
  });

  await check("share link: archived or shared-off reads as not found to non-admins; admins still open it", () => {
    const d = RP.planFile(base, ROSE, null, NOW).doc;
    assert.deepStrictEqual(RP.buildOne("rep_plan00000001", { ...d, shareOff: true }, { isAdmin: false }), { ok: false, notFound: true });
    assert.deepStrictEqual(RP.buildOne("rep_plan00000001", { ...d, archived: true }, { isAdmin: false }), { ok: false, notFound: true });
    assert(RP.buildOne("rep_plan00000001", { ...d, shareOff: true }, { isAdmin: true }).ok);
    assert.deepStrictEqual(RP.buildList([["rep_plan00000001", { ...d, shareOff: true }]], { isAdmin: false }), []);
    assert.strictEqual(RP.buildList([["rep_plan00000001", { ...d, shareOff: true }]], { isAdmin: true })[0].shareOff, true);
  });

  await check("share switch: off / on, owners-only can't be shared, a new version keeps it off", () => {
    const d = RP.planFile(base, ROSE, null, NOW).doc;
    const off = RP.planShare({ id: "rep_plan00000001", share: false }, d, NOW);
    assert.deepStrictEqual(off.patch, { shareOff: true, shareOffAt: NOW });
    assert(RP.planShare({ id: "rep_plan00000001", share: false }, { ...d, shareOff: true }, NOW).noop);
    assert.deepStrictEqual(RP.planShare({ id: "rep_plan00000001", share: true }, { ...d, shareOff: true }, NOW).patch, { shareOff: false, shareOffAt: "" });
    assert(RP.planShare({ id: "rep_plan00000001", share: true }, { ...d, ownersOnly: true, shareOff: true }, NOW).refused);
    assert(RP.planShare({ id: "bad", share: false }, d, NOW).refused);
    assert(RP.planShare({ id: "rep_plan00000001", share: "no" }, d, NOW).refused);
    assert(RP.planShare({ id: "rep_plan00000001", share: false }, null, NOW).refused);
    const again = RP.planFile({ ...base, content: "v2" }, ROSE, { ...d, shareOff: true, shareOffAt: NOW }, NOW);
    assert.strictEqual(again.doc.shareOff, true);
    const fn = fs.readFileSync(path.join(__dirname, "..", "functions", "index.js"), "utf8");
    const i = fn.indexOf("exports.claudeReports");
    const body = fn.slice(i, fn.indexOf("\n});", i));
    assert(/typeof data\.share === "boolean"[\s\S]*if \(!isAdmin\) throw/.test(body), "only admins switch sharing");
    assert(/"shareOff"\)\.get\(\)/.test(body), "the list reads shareOff");
  });

  await check("copy as text: job number and name first, no markdown marks, tables read as lines", () => {
    const meta = { jobNo: "889", jobName: "Rose Residence", title: "889 Rose Residence: Margin Watch", updatedAt: "2026-11-19T18:00:00Z" };
    const t = MD.reportToText(RP.foremanSafe(WATCH).content, meta, "text");
    const lines = t.split("\n");
    assert(/^#889 Rose Residence: Margin Watch \(Nov 1[89]\)$/.test(lines[0]), lines[0]);
    assert(lines.includes("- Rough: 94% done, net margin 31%"));
    assert(lines.includes("- Rough: Hours 120, Margin 31%"));
    assert(!/[|*]|^#{2,}/m.test(t.split("\n").slice(1).join("\n")), "no pipes, stars or heading marks");
    assert.strictEqual(lines.filter(l => /Margin Watch/.test(l)).length, 1, "the report's own first heading isn't repeated");
    const e = MD.reportToText("## Next\n- Keep 2 on finish", meta, "email");
    assert.deepStrictEqual(e.split("\n"), ["Subject: #889 Rose Residence: Margin Watch", "", "Next", "• Keep 2 on finish"]);
    assert.strictEqual(MD.reportHead({ jobNo: "1430", jobName: "Brandt Residence", title: "Post-Rough-In Report" }), "#1430 Brandt Residence: Post-Rough-In Report");
  });

  await check("app: Copy for foreman copies the server's foreman text; the link page reads through the callable", () => {
    const app = fs.readFileSync(path.join(__dirname, "..", "src", "App.js"), "utf8");
    const i = app.indexOf("function OdReport(");
    const fn = app.slice(i, app.indexOf("\n}\n", i));
    assert(/whoNow === "foreman" \? body\.foremanContent : body\.content/.test(fn), "foreman copy = server foremanContent");
    assert(/canOwners = !fview/.test(fn), "Foreman view never offers the full copy");
    assert(/canShare = !body\.ownersOnly && !fview/.test(fn), "owners-only reports have no link");
    const j = app.indexOf("function ReportLinkView(");
    const lv = app.slice(j, app.indexOf("\n}\n", j));
    assert(/memberCallable\("claudeReports", identity\)\(\{ id \}\)/.test(lv));
    assert(!/dangerouslySetInnerHTML|innerHTML|setDoc|updateDoc|addDoc/.test(lv), "read-only, text only");
  });

  console.log(`claude-reports-test: ${n} passed`);
})();
