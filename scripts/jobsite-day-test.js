// jobsite-day-test.js — src/jobsiteDay.js (SW v653, the My jobsite card on My Day).
// Real-shaped rows from 2026-11-19: 1291 Ashcraft, Louis Hoffman lead, Daegan foreman, six people
// booked in Simpro 7:00–5:00, nobody booked Friday.
"use strict";
const J = require("../src/jobsiteDay.js");
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.error("FAIL " + m); } else console.log("ok   " + m); };

const blk = (s, e, h) => ({ StartTime: s, EndTime: e, Hrs: h });
const sch = (name, ref, date, blocks, pid) => ({ Type: "job", Reference: ref, Date: date, Staff: { Name: name }, Blocks: blocks, ...(pid ? { Project: { ProjectID: pid } } : {}) });
const entries = [
  sch("Louis Hoffman", "1291-17551", "2026-11-19", [blk("07:00", "17:00", 10)]),
  sch("Daegan Smith", "1291-17551", "2026-11-19", [blk("07:00", "16:30", 9.5), blk("16:30", "17:00", 0.5)]),
  sch("Callen Jakeman", "1291-17551", "2026-11-19", [blk("07:00", "17:00", 10)], 1291),
  sch("James Coleman Christen", "1291-17551", "2026-11-19", [blk("07:00", "16:30", 9.5), blk("16:30", "17:00", 0.5)]),
  sch("Keegan Wilkinson", "889-4734", "2026-11-19", [blk("07:00", "17:00", 10)]),
  { Type: "activity", Date: "2026-11-19", Staff: { Name: "Office" }, Blocks: [] },
];
const it = (id, text, extra) => ({ id, text, done: false, ...extra });
const job = {
  id: "1772863221803", name: "Ashcraft", simproNo: "1291", lead: "Louis Hoffman", foreman: "Daegan Smith",
  roughPunch: { main: { general: [it("r1", "Nail plate", { done: true, checkedAt: "4/10/2026" })] } },
  finishPunch: {
    upper: { general: [], rooms: [{ name: "Gym", items: [it("f1", "1x can trim not working"), it("f2", "Install black floor plug", { waiting: true, waitingOn: "Flooring" })] }] },
    main: {
      general: [it("f3", "Check that radon fan is on", { assignedTo: "James Coleman Christen" }), it("f4", "Label A/Cs")],
      rooms: [
        { name: "Master bathroom", items: [
          it("f5", "Toilet room install tape light", { assignedTo: "Callen Jakeman" }),
          it("f6", "Change this to a Regular GFCI", { assignedTo: "Callen Jakeman", done: true, checkedAt: "11/18/2026" }),
          it("f7", "Old done item", { assignedTo: "Callen Jakeman", done: true, checkedAt: "11/2/2026" }),
          it("f8", "Install toe kick", { waiting: true, waitingOn: "Cabinets", assignedTo: "Callen Jakeman" }),
          it("f9", "Voided", { voided: true, assignedTo: "Callen Jakeman" }),
        ] },
        { name: "Staircase/Mudroom hall", items: [it("f10", "Stairs install wafers", { assignedTo: "Daegan" })] },
        { name: "Guest suite 2", items: [it("f11", "Troubleshoot bedside pendants", { assignedTo: "Trever Worley" })] },
      ],
    },
    extras: [{ key: "extra_ext", label: "Exterior" }],
    extra_ext: { general: [it("f12", "Install back deck heater outlet", { waiting: true })] },
  },
};
const now = new Date(2026, 10, 19, 8);

ok(J.entryJobNo(entries[0]) === "1291", "job number from the Simpro reference");
ok(J.entryJobNo(entries[2]) === "1291", "job number from Project.ProjectID when sent");
ok(J.clock("16:30") === "4:30 PM" && J.clock("07:00") === "7:00 AM", "clock times read like the app");

const booked = J.bookedOn(entries, "1291", "2026-11-19");
ok(booked.length === 4, "four people booked on 1291 (Keegan is on 889, activity rows skipped)");
const dae = booked.find(p => p.name === "Daegan Smith");
ok(dae && dae.hours === "7:00 AM – 5:00 PM", "split normal + overtime blocks join into one window");

const card = J.buildJobsiteDay(job, entries, "2026-11-19", now);
ok(card.people[0].name === "Louis Hoffman" && card.people[0].lead, "the lead is listed first");
ok(card.counts.onSite === 4, "4 on site");
const callen = card.people.find(p => p.name === "Callen Jakeman");
ok(callen.open.length === 1 && callen.open[0].id === "f5", "Callen: his open item only (waiting and voided ones left out)");
ok(callen.done.length === 1 && callen.done[0].id === "f6", "Callen: done this week shows Nov 18, not Nov 2");
const dsm = card.people.find(p => p.name === "Daegan Smith");
ok(dsm.open.length === 1 && dsm.open[0].id === "f10", "a first-name assignment (Daegan) lands on Daegan Smith");
ok(card.notHere.length === 1 && card.notHere[0].name === "Trever Worley", "Trever has open items but isn't booked: Not here today");
ok(card.unassigned.map(i => i.id).join() === "f1,f4", "unassigned = open, not waiting, nobody on it");
ok(card.waiting.map(i => i.id).join() === "f2,f8,f12", "waiting includes extras floors and items with no reason typed");
ok(card.waiting.find(i => i.id === "f8").waitingOn === "Cabinets", "waiting keeps its reason");
ok(card.unassigned[0].room === "Gym" && card.unassigned[1].room === "Main · General", "rooms and general rows labelled");
ok(card.counts.assignedOpen === 4 && card.counts.unassigned === 2 && card.counts.waiting === 3, "counts add up");

const fri = J.buildJobsiteDay(job, entries, "2026-11-20", now);
ok(fri.people.length === 0 && fri.counts.onSite === 0, "Friday: nobody booked yet");
ok(fri.notHere.length === 4, "Friday: everyone with open items shows under Not here");

ok(J.cardDays(now).join() === "2026-11-19,2026-11-20", "Thursday: today + Friday");
ok(J.cardDays(new Date(2026, 10, 20, 8)).join() === "2026-11-20,2026-11-23", "Friday: today + Monday");
ok(J.cardDays(new Date(2026, 10, 22, 8)).join() === "2026-11-22,2026-11-23", "Sunday: today + Monday");

const jobs = [job, { id: "x", name: "Other", simproNo: "889", lead: "Keegan Wilkinson" }, { id: "q", type: "quote", simproNo: "1291", lead: "Louis Hoffman" }];
ok(J.jobsiteJobs("Louis Hoffman", "jrforeman", jobs, entries, ["2026-11-19", "2026-11-20"]).map(j => j.id).join() === "1772863221803", "Louis gets 1291 (quotes skipped)");
ok(J.jobsiteJobs("Daegan Smith", "foreman", jobs, entries, ["2026-11-19"]).length === 1, "the job's foreman gets it too");
ok(J.jobsiteJobs("Callen Jakeman", "crew", jobs, entries, ["2026-11-19"]).length === 0, "crew don't get the card");
ok(J.jobsiteJobs("Louis Hoffman", "jrforeman", jobs, entries, ["2026-11-24"]).length === 0, "no card when nobody is booked either day");
ok(J.jobsiteJobs("Louis Hoffman", "admin", jobs, entries, ["2026-11-19"]).length === 0, "office doesn't get it");

if (fails) { console.error(`${fails} failed`); process.exit(1); }
console.log("jobsite-day: all passed");
