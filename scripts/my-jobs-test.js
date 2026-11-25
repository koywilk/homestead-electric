// my-jobs-test.js — src/myJobs.js (SW v686, the My Jobs page at /myjobs).
// Crew Board shapes from 2026-11-25: Daegan is a foreman with Louis (jr. foreman) and an apprentice
// on his crew; Keegan is a foreman with his own lead; an Unassigned lead; an admin.
"use strict";
const MJ = require("../src/myJobs.js");
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.error("FAIL " + m); } else console.log("ok   " + m); };

const users = [
  { id: "u1", name: "Daegan Smith", title: "foreman" },
  { id: "u2", name: "Louis Hoffman", title: "jrforeman", foremanId: "u1" },
  { id: "u3", name: "Gage Apprentice", title: "crew", foremanId: "u1" },
  { id: "u4", name: "Keegan Jones", title: "foreman" },
  { id: "u5", name: "Austin Lead", title: "lead", foremanId: "u4" },
  { id: "u6", name: "Noah Loner", title: "lead" },
  { id: "u7", name: "Koy", title: "admin" },
  { id: "u8", name: "Old Guy", title: "crew", foremanId: "u1", active: false },
];
const jobs = [
  { id: "a", simproNo: "1435", name: "Hardman Residence", foreman: "Daegan", lead: "" },
  { id: "b", simproNo: "1224", name: "Jimenez Residence", foreman: "Louis Hoffman", lead: "Gage" },
  { id: "c", simproNo: "1300", name: "Keegan Job", foreman: "Keegan", lead: "Austin Lead" },
  { id: "d", simproNo: "1100", name: "Gage Led", foreman: "Somebody", lead: "Gage Apprentice" },
  { id: "e", simproNo: "1001", name: "Archived Daegan", foreman: "Daegan", archived: true },
  { id: "f", simproNo: "", name: "Quote Daegan", foreman: "Daegan", type: "quote" },
  { id: "g", simproNo: "999", name: "Temp ped Daegan", foreman: "Daegan", tempPed: true },
  { id: "h", simproNo: "1500", name: "Noah's", foreman: "Noah Loner" },
  { id: "i", simproNo: "1600", name: "Old Guy job", foreman: "Old Guy" },
  { id: "k", simproNo: "1700", name: "Daeganson Partial", foreman: "Daegansonny" },
];
const ids = (r) => r.rows.map(x => x.job.id).join(",");

const dae = MJ.myJobsFor({ id: "u1", name: "Daegan Smith" }, users, jobs);
ok(dae.title === "foreman" && dae.crew.join() === "Gage Apprentice,Louis Hoffman", "a foreman's crew comes from the Crew Board (active people only)");
ok(ids(dae) === "a,b,d", "a foreman sees their own jobs and every job their crew runs or leads, newest number first");
ok(!dae.rows.some(x => x.job.id === "i"), "a deactivated crew member's job is not on it");
ok(!dae.rows.some(x => x.job.id === "k"), "a name inside another name is not a match");
ok(!dae.rows.some(x => ["e", "f", "g"].includes(x.job.id)), "archived, quotes and temp peds stay off");
ok(dae.rows.find(x => x.job.id === "d").via === "lead", "a job reached through its lead says so");

const louis = MJ.myJobsFor({ id: "u2", name: "Louis Hoffman" }, users, jobs);
ok(louis.title === "jrforeman" && ids(louis) === "b", "a jr. foreman sees only the jobs they run or lead");
const austin = MJ.myJobsFor({ id: "u5", name: "Austin Lead" }, users, jobs);
ok(ids(austin) === "c", "a lead sees only the job they lead, not their foreman's others");
const noah = MJ.myJobsFor({ id: "u6", name: "Noah Loner" }, users, jobs);
ok(ids(noah) === "h", "an Unassigned lead still sees their own job");
const kee = MJ.myJobsFor({ id: "u4", name: "Keegan Jones" }, users, jobs);
ok(ids(kee) === "c", "Keegan's crew job shows once");
ok(MJ.myJobsFor(null, users, jobs).rows.length === 0, "nobody signed in, no jobs");

ok(MJ.showsMyJobsLink(users[0]) && MJ.showsMyJobsLink(users[1]) && MJ.showsMyJobsLink(users[4]), "the link shows for foremen, jr. foremen and leads");
ok(!MJ.showsMyJobsLink(users[2]) && !MJ.showsMyJobsLink(users[6]), "not for crew or admins");
ok(!MJ.showsMyJobsLink({ ...users[0], active: false }), "not for a deactivated foreman");

const reps = [
  { id: "rep_1", jobNo: "1435", title: "1435 Hardman: Finish plan", updatedAt: "2026-11-25T10:00:00Z" },
  { id: "rep_2", jobNo: "1435", title: "Foreman packet, week of 11/24", updatedAt: "2026-11-25T09:00:00Z" },
  { id: "rep_3", jobNo: "#1435", title: "Post-rough-in report", updatedAt: "2026-11-20T09:00:00Z" },
  { id: "rep_4", jobNo: "1435", title: "Margin watch", updatedAt: "2026-11-24T09:00:00Z" },
  { id: "rep_5", jobNo: "1435", title: "Margin watch", updatedAt: "2026-11-25T11:00:00Z" },
  { id: "rep_6", jobNo: "1435", title: "Money report", ownersOnly: true, updatedAt: "2026-11-25T12:00:00Z" },
  { id: "rep_7", jobNo: "1435", title: "Shared off", shareOff: true, updatedAt: "2026-11-25T12:00:00Z" },
  { id: "rep_8", jobNo: "1435", title: "Archived plan", archived: true, updatedAt: "2026-11-25T12:00:00Z" },
  { id: "rep_9", jobNo: "14350", title: "Other job finish plan", updatedAt: "2026-11-25T12:00:00Z" },
  { id: "rep_10", jobNo: "1435", title: "Material report", updatedAt: "2026-11-23T12:00:00Z" },
  { id: "rep_11", jobNo: "1435", title: "Finish-in plan, upper floor", updatedAt: "2026-11-23T12:00:00Z" },
];
const g = MJ.reportsByGroup(reps, "1435");
ok(g.map(x => x.key).join() === "finish,packet,postrough,margin,other", "groups in order, empty ones left off");
ok(g[0].reports.map(r => r.id).join() === "rep_1,rep_11", "finish plans, newest first");
ok(g[3].reports.map(r => r.id).join() === "rep_5,rep_4", "margin watch, newest first");
const all = g.flatMap(x => x.reports.map(r => r.id));
ok(!all.includes("rep_6"), "owners-only never shows");
ok(!all.includes("rep_7") && !all.includes("rep_8"), "shared-off and archived never show");
ok(!all.includes("rep_9"), "exact job number only");
ok(MJ.reportsByGroup(reps, "").length === 0, "a job with no number has no reports");
ok(MJ.reportName(reps[0]) === "Finish plan", "the job number in front comes off the name");
ok(MJ.reportName(reps[1]) === "Foreman packet, week of 11/24", "other names stay");

if (fails) { console.error(`\nmy-jobs-test: ${fails} failed`); process.exit(1); }
console.log("\nmy-jobs-test: all passed");
