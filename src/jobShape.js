// jobShape.js — a NEW job's defaults (blankJob / blankQuickJob and the row
// factories they call), the Projects one-liners, the Job Sections registry's
// pure half, and the GC running-contact toggle, in ONE place.
//
// WHY THIS EXISTS (v608, 2026-11-03, Duet write access — connector decision D9, ship 9)
// --------------------------------------------------------------------------
// Claude Duet can now create a job from a Simpro candidate, make a project
// and its buildings, set job info fields, hide a job section and archive /
// unarchive a job from a chat, through the duetApi Cloud Function. A job doc
// the server creates has to carry EVERY default a phone's blankJob() carries
// — the same 71 ids, the same ten home-run rows per floor, the same keypad and
// CP4 rows, the same empty punch floors — or the loader's normalizeJob and
// every tab tell a different story for a Duet-made job. So the factories the
// app's own "+ New" buttons, importSimproCandidate and createBuilding use live
// here, and the Cloud Function requires a byte-identical copy.
//
// What moved here from App.js, SAME CODE, imported back by App.js:
//   emptyPunch, newHRRow, newKPRow, newCP4Row (now take the app's uid() as
//   their first argument), blankJob(uid), blankQuickJob(uid, type);
//   isSimproJoinable, projectBuildings, buildingJobName, buildingShortName,
//   simproNoConflict (the Projects one-liners, unchanged text);
//   gcContactKey, gcRunningToggle (the running-contact tap, unchanged text);
//   jobSectionPatch — now reads the legacy flag spec from JOB_SECTION_DEFS
//   below (key / label / commercial / parent / legacy for every JOB_SECTIONS
//   entry; App.js keeps JOB_SECTIONS with its hasData closures and
//   scripts/duet-jobsetup-test.js pins the two lists equal).
//
// Pure, CommonJS, no requires: the CRA bundle imports it (App.js), the Cloud
// Functions require a copy, and scripts/duet-jobsetup-test.js drives the exact
// file that ships. COPIED to functions/jobShape.js by scripts/job-shape-sync.js
// — edit THIS file only; the prebuild refuses to build while the two differ.
//
// Nothing here touches Firestore. Callers decide the write (the app's
// stampWrite({data, updated_at}) setDoc; duetApi's create-only transaction).
"use strict";

// ── Row factories (App.js ~L3412 / L4349 / L5580) — `uid` is the caller's id minter ──
const emptyPunch   = ()    => ({ upper:[], main:[], basement:[] });
const newHRRow     = (uid, num) => ({ id:uid(), num, wire:"", name:"", status:"", panel:"" });
const newCP4Row    = (uid, num) => ({ id:uid(), num, name:"", moduleType:"", mod:"", ch:"", loadType:"", watts:"", keypad:"", bus:"", pdu:"", chainPos:"", panel:"", breaker:"", phase:"", status:"" });
const newKPRow     = (uid, num) => ({ id:uid(), num, name:"", status:"" });

// ── blankJob (App.js ~L6487) — the first uid() is the job's id = its doc id ──
const blankJob = (uid) => ({

  // simproNo = Simpro JOB number. simproQuoteNo = Simpro QUOTE number, used only
  // while the record is type "quote" — Simpro numbers the two separately, so
  // they must never share a field (a quote # in simproNo can match an unrelated
  // real job and pull its financials). A quote earns its simproNo at conversion.
  id:uid(), name:"", address:"", gc:"", phone:"", gcContacts:[], gcContactLead:"", gcContactLead2:"", gcContact2:"", phone2:"", gcContactLabels:{}, simproNo:"", simproQuoteNo:"", foreman:"Koy", lead:"", flagged:false, flagNote:"",

  planLink:"", redlineLink:"", lightingLink:"", panelLink:"", qcLink:"", matterportLink:"", matterportLinks:[], driveFolderId:"",

  uploadedFiles:[],

  prepStage:"", roughStage:"0%", finishStage:"0%", roughScheduled:false, finishScheduled:false, roughScheduledDate:"", finishScheduledDate:"", prepStartDate:"", finishStartDate:"", roughQuestions:{ upper:[], main:[], basement:[] },

  roughPunch:emptyPunch(), roughMaterials:[], roughUpdates:[], roughNotes:"",

  qcPunch:emptyPunch(),

  finishPunch:emptyPunch(), finishMaterials:[], finishUpdates:[], finishNotes:"",

  finishQuestions:{ upper:[], main:[], basement:[] },

  changeOrders:[], returnTrips:[], roughInspectionResult:"", roughInspectionDate:"", roughInspectionItems:[], roughInspectionAttempts:[], finalInspectionResult:"", finalInspectionDate:"", finalInspectionItems:[], finalInspectionAttempts:[], roughStatus:"", roughStatusDate:"", roughScheduledEnd:"", roughProjectedStart:"", finishStatus:"", finishStatusDate:"", finishScheduledEnd:"", finishProjectedStart:"", qcStatus:"", qcStatusDate:"", qcSignedOff:false, qcSignedOffBy:"", qcSignedOffDate:"", roughQCTaskFired:false, roughStartConfirmed:false, finishStartConfirmed:false, roughNeedsHardDate:false, roughNeedsByStart:"", roughNeedsByEnd:"", finishNeedsHardDate:false, finishNeedsByStart:"", finishNeedsByEnd:"", readyToSchedule:false, readyToInvoice:false, invoiceDismissed:false, matterportDismissed:false, taskDueDates:{}, roughOnHold:false, finishOnHold:false, tempPed:false, hasTempPed:false, tempPedNumber:"", tempPedStatus:"", tempPedScheduledDate:"",

  homeRuns:{

    main:    Array.from({length:10},(_,i)=>newHRRow(uid, i+1)),

    basement:Array.from({length:10},(_,i)=>newHRRow(uid, i+1)),

    upper:   Array.from({length:10},(_,i)=>newHRRow(uid, i+1)),

  },

  panelCounts:{ meter:"", panelA:"", panelB:"", dedicated:"" },

  panelizedLighting:{

    loads:          [],

    mainKeypad:     Array.from({length:10},(_,i)=>newKPRow(uid, i+1)),

    basementKeypad: Array.from({length:10},(_,i)=>newKPRow(uid, i+1)),

    upperKeypad:    Array.from({length:10},(_,i)=>newKPRow(uid, i+1)),

    cp4Loads:       Array.from({length:10},(_,i)=>newCP4Row(uid, i+1)),

    extraFloors:    [],

  },

  tapeLights:[], loadMappingNotes:"",

});

// ── blankQuickJob (App.js ~L6553) ──
const blankQuickJob = (uid, type = "service") => ({
  id: uid(), name: "", address: "", gc: "", phone: "", simproNo: "",
  foreman: "Koy", lead: "", flagged: false, flagNote: "",
  quickJob: true,
  quickJobType: type,
  quickJobStatus: "new",
  quickJobDate: "",
  quickJobEndDate: "",
  scope: "",
  material: "",
  notes: "",
  photos: [],
  signedOff: false, signedOffBy: "", signedOffDate: "",
  readyToInvoice: false, invoiceDismissed: false, invoiceSent: false,
  readyToInvoiceDate: "",
  accessNote: "",
  taskDueDates: {},
  changeOrders: [], returnTrips: [],
});

// ── Projects one-liners (App.js ~L3398–3405; scripts/projects-dryrun.js tests them verbatim) ──
const isSimproJoinable = (j) => !(j && j.projectGroupId && j.simproFolder) || !!(j && j.simproLead);
const projectBuildings = (jobs, pid) => (jobs || []).filter(j => j && pid && j.projectGroupId === pid && !j.archived && !j.deleted).sort((a, b) => ((a.projectRole === "site") !== (b.projectRole === "site")) ? (a.projectRole === "site" ? -1 : 1) : String(a.name || "").localeCompare(String(b.name || ""), undefined, { numeric: true }));
const buildingJobName = (projectName, buildingName) => `${String(projectName || "").trim()} · ${String(buildingName || "").trim()}`;
const buildingShortName = (job, project) => { const n = String((job && job.name) || ""); const p = String((project && project.name) || "").trim(); return p && n.startsWith(p + " · ") ? n.slice(p.length + 3) : n; };
const simproNoConflict = (jobs, no, pid) => { const n = String(no || "").replace(/^#/, "").trim(); if (!n) return null; return (jobs || []).find(j => j && !j.archived && !j.deleted && String(j.simproNo || "").replace(/^#/, "").trim() === n && (!pid || j.projectGroupId !== pid)) || null; };

// ── Simpro import: a cached candidate's address equal to its name is blank (functions/simproShape.js importableAddress, App.js ~L74514) ──
const importableAddress = (cand) => { const norm = (x) => String(x || "").replace(/\s+/g, " ").trim().toLowerCase(); const a = String((cand && cand.address) || "").trim(); return !a || norm(a) === norm(cand && cand.name) ? "" : a; };

// ── GC running contacts (App.js ~L2895–2930) ──
// Slot 1 = gcContactLead, mirrored into the GC Contact / GC Phone boxes; slot 2
// = gcContactLead2, mirrored into gcContact2 / phone2. Both keyed by the Simpro
// contact ID and kept BESIDE gcContacts, because every Simpro pull replaces that
// list wholesale.
const gcContactKey = (c, i) => String(c.id || c.email || c.name || i);
// A tap on contact `k` → { patch } to apply (null = nothing to do), or
// { full:true } when both slots are taken and the tap must be refused rather
// than silently bumping someone out.
const gcRunningToggle = (job, k) => {
  const list = Array.isArray(job && job.gcContacts) ? job.gcContacts : [];
  const find = (key) => { for (let i = 0; i < list.length; i++) if (gcContactKey(list[i], i) === key) return list[i]; return null; };
  const one = String((job && job.gcContactLead)  || "");
  const two = String((job && job.gcContactLead2) || "");
  if (k === one) {
    // Clearing slot 1 while a second is set PROMOTES the second, so the boxes
    // the crew actually calls from never go empty while somebody is still marked.
    if (two) {
      const c2 = find(two);
      return { patch: { gcContactLead: two, gcContactLead2: "",
        gcContact: c2 ? (c2.name || "") : String(job.gcContact2 || ""),
        phone:     c2 ? (c2.phone || "") : String(job.phone2 || ""),
        gcContact2: "", phone2: "" } };
    }
    // Clearing leaves the typed boxes alone — same as it always did.
    return { patch: { gcContactLead: "" } };
  }
  if (k === two) return { patch: { gcContactLead2: "" } };
  const c = find(k);
  if (!c) return { patch: null };
  if (!one) return { patch: { gcContactLead: k, gcContact: c.name || "", phone: c.phone || "" } };
  if (!two) return { patch: { gcContactLead2: k, gcContact2: c.name || "", phone2: c.phone || "" } };
  return { full: true };
};

// ── Job Sections — the registry's pure half (App.js JOB_SECTIONS ~L29949) ──
// One row per switch: key, label, commercial (the panel lists commercial
// sections for commercial jobs and residential ones otherwise), parent (a
// sub-switch of Panelized Lighting), legacy = the OLD flag that is the source
// of truth for that switch: {top: name} = job[name], {pl: name} =
// job.panelizedLighting[name]. appliesTo in App.js (Lutron-only Tech
// Lighting's link) is kept there; duetApi mirrors it by lightingSystem.
// hasData / asyncHasData / where / confirmOff stay in App.js (render + confirm
// only). scripts/duet-jobsetup-test.js pins key / label / commercial / parent /
// legacy of every App.js entry to this list, in order.
const JOB_SECTION_DEFS = [
  { key:"commMaterials", label:"Materials", commercial:true },
  { key:"jobstart", label:"Job Start (pre-con checklist)", commercial:true },
  { key:"commPower", label:"Power", commercial:true },
  { key:"commLighting", label:"Lighting", commercial:true },
  { key:"commGear", label:"Gear", commercial:true },
  { key:"commUnderground", label:"Underground", commercial:true },
  { key:"commSubmittals", label:"Gear & Submittals", commercial:true },
  { key:"commRfis", label:"RFIs", commercial:true },
  { key:"panelized", label:"Panelized Lighting", legacy:{ top:"noPanelizedLighting" } },
  { key:"keypads", label:"Keypads", parent:"panelized", legacy:{ pl:"noKeypadLoads" } },
  { key:"panelLoads", label:"Panel Loads", parent:"panelized" },
  { key:"techLighting", label:"Tech Lighting's link", parent:"panelized", legacy:{ pl:"excludeFromLutronHub" }, lutronOnly:true },
  { key:"lvCollab", label:"LV Collab Link", parent:"panelized" },
  { key:"loadsShare", label:"Loads Share Link", parent:"panelized" },
  { key:"tapeLight", label:"Tape Light", legacy:{ top:"noTapeLight" } },
  { key:"generator", label:"Generator" },
  { key:"panelSchedules", label:"Panel Schedules" },
  { key:"liveView", label:"Live View Link" },
  { key:"matterport", label:"Matterport" },
  { key:"tempPed", label:"Temp Pedestal" },
  { key:"materials", label:"Material Tracking" },
];
const JOB_SECTION_DEF_BY_KEY = Object.fromEntries(JOB_SECTION_DEFS.map(s => [s.key, s]));
// The legacy accessors (App.js topFlag / plFlag), from the spec above.
const legacyOf = (key) => {
  const l = JOB_SECTION_DEF_BY_KEY[key] && JOB_SECTION_DEF_BY_KEY[key].legacy;
  if (!l) return null;
  if (l.top) return { get: (j) => !!j[l.top], set: (j, v) => ({ [l.top]: !!v }) };
  return { get: (j) => !!(j.panelizedLighting && j.panelizedLighting[l.pl]), set: (j, v) => ({ panelizedLighting: { ...(j.panelizedLighting || {}), [l.pl]: !!v } }) };
};
// The switch's OWN state (ignores the parent). Legacy-backed switches read
// the legacy flag; the rest read hiddenSections.
const isSectionOwnHidden = (job, key) => {
  if (!job) return false;
  const legacy = legacyOf(key);
  if (legacy) return legacy.get(job);
  return !!(job.hiddenSections || {})[key];
};
// Patch for one toggle. Always spreads the current map so a second switch
// never wipes the first; legacy-backed switches write their old flag too.
const jobSectionPatch = (job, key, hidden) => {
  const patch = { hiddenSections: { ...(job?.hiddenSections || {}), [key]: !!hidden } };
  const legacy = legacyOf(key);
  if (legacy) Object.assign(patch, legacy.set(job || {}, hidden));
  return patch;
};

module.exports = { emptyPunch, newHRRow, newCP4Row, newKPRow, blankJob, blankQuickJob,
  isSimproJoinable, projectBuildings, buildingJobName, buildingShortName, simproNoConflict, importableAddress,
  gcContactKey, gcRunningToggle,
  JOB_SECTION_DEFS, JOB_SECTION_DEF_BY_KEY, legacyOf, isSectionOwnHidden, jobSectionPatch };
