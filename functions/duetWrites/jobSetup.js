"use strict";
// Duet write access (D9), ship 9: job setup — a job from a Simpro candidate,
// projects and buildings, the job-info scalars, Job Sections, archive /
// unarchive. PURE planners — given what Duet asked and the live docs the
// transaction read (the job, the candidates list, the project, the sibling
// buildings, the jobs that carry a Simpro #), they return either a refusal or
// exactly what to write, copied from the app's own handlers in src/App.js
// (mapped 2026-11-03; the notes folder's "08-10 map" §B is the line source):
//   • importSimproCandidate (~L74496): j = stampDivision(blankJob() |
//     blankQuickJob()); temp ped → tempPed:true; name, address (blank when it
//     equals the name — importableAddress), simproNo = String(simproId),
//     customer, division from the Business Group hint (commercial sets the
//     key, resi deletes it, no hint → the device's mode — here Duet's
//     `division` arg, required), simproBusinessGroup, foreman "Unassigned",
//     _importedFromSimpro:true, imported_at ISO; setDoc(jobs/<j.id>,
//     stampWrite({data:j, updated_at})) create-only; then the candidates list
//     rewritten without that one. The loader keys jobs by data.id, so the doc
//     id IS j.id. The commercial Drive chain (runDriveChain) is the app's own
//     fire-and-forget after the create — NOT run here (said in the answer).
//   • Job Info scalars (~L36896 division: "" reads as resi, the key is never
//     deleted by the patch funnel; the text boxes write the string); the
//     running-contact tap gcRunningToggle (shared jobShape.js) for
//     gcContactLead / gcContactLead2 — each is a TAP, so a set is composed of
//     the taps the app would need, in order.
//   • jobSectionPatch (shared jobShape.js): {hiddenSections:{...cur,[key]:bool}}
//     + the legacy flag (panelized → noPanelizedLighting, tapeLight →
//     noTapeLight, keypads → panelizedLighting.noKeypadLoads, techLighting →
//     panelizedLighting.excludeFromLutronHub). The server writes the ONE
//     panelizedLighting flag as a dotted key instead of the spread map — the
//     same resulting doc, without rewriting the loads arrays.
//   • Archive: the app has NO archive / unarchive handler for jobs (deleteJob
//     hard-deletes; archived / archivedAt / archivedBy / deleted are only
//     READ — isInactiveJob, the Job Board gate, the project building lists,
//     every chase). Duet's shape, agreed with Koy as reversible:
//     {archived:true, archivedAt: ISO, archivedBy:"Koy"} and
//     {archived:false, archivedAt:"", archivedBy:""}. Never `deleted`.
//   • Projects (~L39080 / ~L73753–73790): the project literal {id:"prj_"+uid,
//     name, division:"commercial"|"", gc, address, notes:"", simproNo,
//     createdAt, createdBy}; the source job's patch {projectGroupId,
//     projectRole:"site", simproFolder:"", name: buildingJobName(name, "Site /
//     Shared")}; patchProject's fields (simproNo, notes, archived +
//     archivedBy + archivedAt); createBuilding line for line (conflict,
//     duplicate short name, blankJob + the copied fields, buildingJobName,
//     simproLead, hiddenSections + legacy flags); join = {projectGroupId,
//     projectRole:"", simproLead:false, simproFolder:""}.
// No Firestore here: api.js does the transaction (tx.create for the two job
// creates and the project create — a second write to the same id fails);
// scripts/duet-jobsetup-test.js drives these with fixtures.
const JS = require("../jobShape.js");
const { applyPunchTicks } = require("../punchTicks.js");
const { punchOpen } = require("./punch.js");
const { ME, cleanText } = require("./needs.js");

const refuse = (why) => ({ refused: why });
const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const T = (v) => cleanText(v);
const SIMPRO_ID = /^\d{1,9}$/;
const PROJECT_ID = /^prj_\d{10,15}$/;
const IMPORT_KINDS = ["job", "tempped", "quick"];
const DIVISIONS = ["commercial", "resi"];
const isCommercial = (j) => !!j && j.division === "commercial";
// The app's three "+ New" buttons = three uid() seeds; the server's uid is a
// millisecond counter seeded at the call (String(++n), the app's own shape),
// bumped past any id already seen.
function idMinter(nowMs, taken) {
  const seen = new Set((taken || []).map(String));
  let n = Math.floor(nowMs);
  while (seen.has(String(n))) n += 1;
  return () => { n += 1; return String(n); };
}
// Live = the archive gate every list applies (projectBuildings, simproNoConflict).
const live = (j) => !!j && !j.archived && !j.deleted;
// A job's open work, for the archive guard. Punch with the check-off slots
// applied (what the app shows); COs the office still owes something on; trips
// not signed off and not complete.
const OPEN_CO = ["needs_sending", "pending", "approved", "scheduled"];
function openWork(data) {
  const shown = applyPunchTicks(data || {});
  const punch = punchOpen(shown.roughPunch) + punchOpen(shown.finishPunch) + punchOpen(shown.qcPunch);
  const cos = (Array.isArray(data && data.changeOrders) ? data.changeOrders : []).filter(c => c && OPEN_CO.includes(String(c.coStatus || "")));
  const trips = (Array.isArray(data && data.returnTrips) ? data.returnTrips : []).filter(r => r && !r.signedOff && String(r.rtStatus || "") !== "complete");
  return { punch, cos: cos.map(c => ({ coId: String(c.id), status: c.coStatus, desc: String(c.desc || "").slice(0, 80) })), trips: trips.map(r => ({ rtId: String(r.id), status: r.rtStatus || "", scope: String(r.scope || "").slice(0, 80) })) };
}

// ── 1. job.createFromSimpro ───────────────────────────────────────────────────
// args: { simproId, kind?: job|tempped|quick, division?: commercial|resi }
// ctx:  { nowIso, candidates (settings/simproCandidates.candidates or null), conflicts (live jobs carrying that Simpro #), takenIds? }
// Returns {refused} | { job, docId, candidatesAfter, cand, division, kind, wasIgnored, fields }
function planCreateFromSimpro(args, ctx) {
  const a = args || {};
  const simproId = String(a.simproId == null ? "" : a.simproId).replace(/^#/, "").trim();
  if (!SIMPRO_ID.test(simproId)) return refuse("simproId must be the Simpro job number of a candidate in the Simpro inbox (cc_list_simpro_candidates).");
  const kind = a.kind == null || a.kind === "" ? "job" : String(a.kind);
  if (!IMPORT_KINDS.includes(kind)) return refuse(`kind must be one of ${IMPORT_KINDS.join(", ")} (the inbox's Import → / Temp Ped / Quick Job buttons).`);
  if (a.division != null && a.division !== "" && !DIVISIONS.includes(String(a.division))) return refuse(`division must be commercial or resi.`);
  if (!Array.isArray(ctx.candidates)) return refuse("There is no Simpro candidates list yet (settings/simproCandidates) — the Simpro inbox poller hasn't run. Nothing was written.");
  const cand = ctx.candidates.find(c => c && String(c.simproId) === simproId);
  if (!cand) return refuse(`Simpro #${simproId} isn't in the Simpro inbox — it may already be imported, or the poller hasn't seen it yet (cc_list_simpro_candidates shows what's there). Nothing was written.`);
  const clash = JS.simproNoConflict(ctx.conflicts || [], simproId);
  if (clash) return refuse(`Simpro #${simproId} already belongs to ${clash.name || "a live job"} (${clash.id || "?"}). Nothing was written.`);
  // Division: the candidate's Business Group hint first (the poller's divisionHint); no hint → Duet's arg stands in for the device's mode.
  let division;
  if (cand.divisionHint === "commercial") division = "commercial";
  else if (cand.divisionHint === "resi") division = "resi";
  else if (a.division) division = String(a.division);
  else return refuse(`Simpro #${simproId} (${cand.name || "?"}) has no Business Group hint${cand.businessGroup ? ` (group "${cand.businessGroup}" isn't mapped)` : ""}. In the app the import takes the device's current mode; here say division: commercial or resi. Nothing was written.`);
  const uid = idMinter(Date.parse(ctx.nowIso), ctx.takenIds);
  const j = kind === "quick" ? JS.blankQuickJob(uid) : JS.blankJob(uid);     // stampDivision: commercial mode adds division:"commercial"; resi writes no key
  if (division === "commercial") j.division = "commercial"; else delete j.division;
  if (kind === "tempped") j.tempPed = true;
  j.name = cand.name || "";
  j.address = JS.importableAddress(cand);
  j.simproNo = String(cand.simproId || "");
  j.customer = cand.customer || "";
  if (cand.businessGroup) j.simproBusinessGroup = String(cand.businessGroup);
  j.foreman = "Unassigned";
  j._importedFromSimpro = true;
  j.imported_at = ctx.nowIso;
  const candidatesAfter = ctx.candidates.filter(c => String(c && c.simproId) !== simproId);
  const fields = { name: j.name, address: j.address, simproNo: j.simproNo, customer: j.customer, division: division === "commercial" ? "commercial" : null, simproBusinessGroup: j.simproBusinessGroup || "", foreman: j.foreman, tempPed: !!j.tempPed, quickJob: !!j.quickJob, _importedFromSimpro: true, imported_at: j.imported_at };
  return { job: j, docId: j.id, candidatesAfter, cand, division, kind, wasIgnored: !!cand.ignored, fields };
}

// ── 2. job.setInfo ────────────────────────────────────────────────────────────
// ONE scalar per call. name (never blank), address, gc, gcContact, phone,
// gcContact2, phone2, customer, simproNo (conflict-checked), simproQuoteNo,
// division (commercial | resi → "", the patch funnel's value), gcContactLead /
// gcContactLead2 (a contact id from gcContacts[], composed from the app's taps).
const INFO_TEXT = { name: 120, address: 300, gc: 120, gcContact: 120, phone: 60, gcContact2: 120, phone2: 60, customer: 160, simproQuoteNo: 20 };
const INFO_FIELDS = [...Object.keys(INFO_TEXT), "simproNo", "division", "gcContactLead", "gcContactLead2"];
// args: { field, value }   ctx: { job, conflicts (live jobs carrying the new Simpro #) }
function planSetInfo(args, ctx) {
  const a = args || {};
  const job = ctx.job;
  if (!job || !job.data) return refuse("That job doesn't exist in Command Center (or has no data). Nothing was written.");
  if (job.data.archived || job.data.deleted) return refuse(`${job.data.name || "That job"} is archived — changes go on live jobs only (cc_archive_job with archived:false brings it back). Nothing was written.`);
  const field = String(a.field || "");
  if (!INFO_FIELDS.includes(field)) return refuse(`field must be one of ${INFO_FIELDS.join(", ")}. gcContacts itself is Simpro's (replaced on every pull); other fields come in ship 11.`);
  if (a.value != null && typeof a.value !== "string" && typeof a.value !== "number") return refuse("value must be text.");
  const d = job.data;
  const raw = a.value == null ? "" : String(a.value);
  const result = (fields, before, extra) => ({ fields, before, after: { ...fields }, result: { field, changed: Object.keys(fields), ...(extra || {}) } });
  if (field in INFO_TEXT) {
    const v = T(raw).slice(0, INFO_TEXT[field]);
    if (field === "name" && !v) return refuse("name can't be blank — every list and the Drive folder match key off it. Nothing was written.");
    if (field === "name" && d.projectGroupId && d.projectRole === "site") return refuse(`${d.name} is a project's Site / Shared job — its name is the project's "<Project> · Site / Shared". Rename the project instead. Nothing was written.`);
    if (String(d[field] == null ? "" : d[field]) === v) return { noop: true, result: { field, [field]: v } };
    return result({ [field]: v }, { [field]: d[field] === undefined ? null : d[field] }, { from: d[field] == null ? "" : d[field], to: v });
  }
  if (field === "simproNo") {
    const n = T(raw).replace(/^#/, "").trim().slice(0, 20);
    if (n && !/^\d+$/.test(n)) return refuse("simproNo must be the Simpro job number (digits), or \"\" to clear it.");
    if (String(d.simproNo || "").replace(/^#/, "").trim() === n) return { noop: true, result: { field, simproNo: n } };
    if (n) { const clash = JS.simproNoConflict((ctx.conflicts || []).filter(j => j && j.id !== job.id), n, d.projectGroupId || undefined); if (clash) return refuse(`Simpro #${n} already belongs to ${clash.name || "a live job"} (${clash.id || "?"}). Nothing was written.`); }
    return result({ simproNo: n }, { simproNo: d.simproNo === undefined ? null : d.simproNo }, { from: d.simproNo || "", to: n, note: n ? "The Simpro auto-pull fills blank address / GC / contacts from Simpro when the job is next opened in the app." : undefined });
  }
  if (field === "division") {
    const want = raw === "commercial" ? "commercial" : (raw === "" || raw === "resi" || raw === "residential") ? "" : null;
    if (want === null) return refuse("division must be commercial or resi.");
    const cur = d.division === "commercial" ? "commercial" : "";
    if (cur === want) return { noop: true, result: { field, division: want || "resi" } };
    return result({ division: want }, { division: d.division === undefined ? null : d.division }, { from: cur || "resi", to: want || "resi", note: "\"\" reads as residential — the app's patch funnel never deletes the key." });
  }
  // gcContactLead / gcContactLead2: compose the app's taps.
  const contacts = Array.isArray(d.gcContacts) ? d.gcContacts : [];
  const keys = contacts.map((c, i) => JS.gcContactKey(c, i));
  const k = T(raw);
  if (k && !keys.includes(k)) return refuse(`"${k}" isn't a contact on ${d.name}'s Simpro contact list. Contact ids: ${keys.length ? contacts.map((c, i) => `${keys[i]} (${String(c.name || "").slice(0, 40)}${c.role ? ", " + String(c.role).slice(0, 30) : ""})`).join("; ") : "none — pull the job from Simpro first"}. Nothing was written.`);
  let cur = { ...d };
  const taps = [];
  const tap = (key) => { const r = JS.gcRunningToggle(cur, key); if (r.full) return refuse("Both running-contact slots are taken — the app refuses a third. Clear one first. Nothing was written."); if (r.patch) { Object.assign(cur, r.patch); taps.push(key); } return null; };
  const one = String(d.gcContactLead || ""), two = String(d.gcContactLead2 || "");
  if (field === "gcContactLead") {
    if (!k) { if (!one) return { noop: true, result: { field, gcContactLead: "" } }; const r = tap(one); if (r) return r; }
    else if (k === one) return { noop: true, result: { field, gcContactLead: k } };
    else if (!one) { const r = tap(k); if (r) return r; }
    else {
      // Slot 1 is someone else: clear slot 2 (if any), clear slot 1 (nothing left to promote), tap k into slot 1, put slot 2 back.
      if (two && two !== k) { const r = tap(two); if (r) return r; }
      let r = tap(cur.gcContactLead); if (r) return r;            // clears slot 1 (promotes nothing: slot 2 is empty now, or was k)
      if (String(cur.gcContactLead || "") === k) { /* k was slot 2 and got promoted */ }
      else { r = tap(k); if (r) return r; }
      if (two && two !== k && String(cur.gcContactLead2 || "") !== two) { r = tap(two); if (r) return r; }
    }
  } else {
    if (!k) { if (!two) return { noop: true, result: { field, gcContactLead2: "" } }; const r = tap(two); if (r) return r; }
    else if (k === two) return { noop: true, result: { field, gcContactLead2: k } };
    else if (k === one) return refuse(`${k} is already the first running contact (gcContactLead). Set gcContactLead to someone else first, or clear it. Nothing was written.`);
    else if (!one) return refuse("The first running-contact slot is empty — the app's tap would land there. Set gcContactLead first. Nothing was written.");
    else { if (two) { const r = tap(two); if (r) return r; } const r = tap(k); if (r) return r; }
  }
  const MIRROR = ["gcContactLead", "gcContactLead2", "gcContact", "phone", "gcContact2", "phone2"];
  const fields = {}, before = {};
  for (const f of MIRROR) { const nv = cur[f] === undefined ? "" : cur[f]; const ov = d[f] === undefined ? "" : d[f]; if (String(nv) !== String(ov)) { fields[f] = nv; before[f] = d[f] === undefined ? null : d[f]; } }
  if (!Object.keys(fields).length) return { noop: true, result: { field, [field]: k } };
  return result(fields, before, { to: k, taps, mirrored: Object.keys(fields).filter(f => f !== field) });
}

// ── 3. job.setSection ─────────────────────────────────────────────────────────
// args: { key, hidden }   ctx: { job }
function planSetSection(args, ctx) {
  const a = args || {};
  const job = ctx.job;
  if (!job || !job.data) return refuse("That job doesn't exist in Command Center (or has no data). Nothing was written.");
  if (job.data.archived || job.data.deleted) return refuse(`${job.data.name || "That job"} is archived — changes go on live jobs only. Nothing was written.`);
  if (typeof a.hidden !== "boolean") return refuse("hidden must be true (turn the section off) or false (turn it back on).");
  const d = job.data;
  const comm = isCommercial(d);
  const list = JS.JOB_SECTION_DEFS.filter(s => (comm ? !!s.commercial : !s.commercial));
  const def = JS.JOB_SECTION_DEF_BY_KEY[String(a.key || "")];
  if (!def || !list.includes(def)) return refuse(`key must be one of the Job Sections this ${comm ? "commercial" : "residential"} job has: ${list.map(s => `${s.key} (${s.label}${s.parent ? ", under " + s.parent : ""})`).join(", ")}. Nothing was written.`);
  if (def.lutronOnly && String(d.lightingSystem || "") !== "Lutron") return refuse(`${def.label} only applies to Lutron jobs (lightingSystem "Lutron"); ${d.name} is ${d.lightingSystem ? `"${d.lightingSystem}"` : "not marked Lutron"}, so the app doesn't show that switch. Nothing was written.`);
  const curHidden = JS.isSectionOwnHidden(d, def.key);
  if (curHidden === a.hidden) return { noop: true, result: { key: def.key, label: def.label, hidden: a.hidden } };
  const patch = JS.jobSectionPatch(d, def.key, a.hidden);
  // The server writes the ONE panelizedLighting flag as a dotted key (same doc, loads arrays untouched).
  const fields = {}, before = {}, after = {};
  fields.hiddenSections = patch.hiddenSections; before.hiddenSections = d.hiddenSections === undefined ? null : d.hiddenSections; after.hiddenSections = patch.hiddenSections;
  const legacy = def.legacy || null;
  if (legacy && legacy.top) { fields[legacy.top] = patch[legacy.top]; before[legacy.top] = d[legacy.top] === undefined ? null : d[legacy.top]; after[legacy.top] = patch[legacy.top]; }
  if (legacy && legacy.pl) { const k = "panelizedLighting." + legacy.pl; fields[k] = patch.panelizedLighting[legacy.pl]; before[k] = d.panelizedLighting && d.panelizedLighting[legacy.pl] !== undefined ? d.panelizedLighting[legacy.pl] : null; after[k] = fields[k]; }
  const parentHidden = def.parent ? (JS.isSectionOwnHidden(d, def.parent) || false) : false;
  return { fields, before, after, result: { key: def.key, label: def.label, hidden: a.hidden, legacyFlag: legacy ? (legacy.top || "panelizedLighting." + legacy.pl) : null, parent: def.parent || null, parentHidden: def.parent ? parentHidden : undefined, note: a.hidden ? "Hiding never deletes: the section's data stays on the job and comes back exactly when turned on." : undefined } };
}

// ── 4. job.archive ────────────────────────────────────────────────────────────
// args: { archived: boolean, force? }   ctx: { job, nowIso }
function planArchive(args, ctx) {
  const a = args || {};
  const job = ctx.job;
  if (!job || !job.data) return refuse("That job doesn't exist in Command Center (or has no data). Nothing was written.");
  if (job.data.deleted) return refuse(`${job.data.name || "That job"} is marked deleted — Duet never touches deleted jobs. Nothing was written.`);
  if (typeof a.archived !== "boolean") return refuse("archived must be true (archive) or false (unarchive).");
  const d = job.data;
  const isArchived = !!(d.archived || d.archivedAt);
  if (a.archived === isArchived) return { noop: true, result: { archived: isArchived, archivedAt: d.archivedAt || "", archivedBy: d.archivedBy || "" } };
  const before = { archived: d.archived === undefined ? null : d.archived, archivedAt: d.archivedAt === undefined ? null : d.archivedAt, archivedBy: d.archivedBy === undefined ? null : d.archivedBy };
  if (a.archived) {
    const open = openWork(d);
    const blockers = [];
    if (open.punch) blockers.push(`${open.punch} open punch item${open.punch === 1 ? "" : "s"}`);
    if (open.cos.length) blockers.push(`${open.cos.length} open change order${open.cos.length === 1 ? "" : "s"} (${open.cos.map(c => `#${c.coId} ${c.status}`).join(", ")})`);
    if (open.trips.length) blockers.push(`${open.trips.length} open return trip${open.trips.length === 1 ? "" : "s"} (${open.trips.map(r => `#${r.rtId}${r.status ? " " + r.status : ""}`).join(", ")})`);
    if (blockers.length && a.force !== true) return refuse(`${d.name || "That job"} still has ${blockers.join("; ")}. Archiving hides it from every board and chase. Say force:true to archive anyway. Nothing was written.`);
    const fields = { archived: true, archivedAt: ctx.nowIso, archivedBy: ME };
    return { fields, before, after: { ...fields }, result: { archived: true, archivedAt: ctx.nowIso, archivedBy: ME, forced: blockers.length ? true : undefined, openWork: blockers.length ? open : undefined, note: "Reversible: cc_archive_job with archived:false clears the three fields. Nothing is deleted. The job leaves the Job Board, My Day, Needs Attention, the project building list and every chase." } };
  }
  const fields = { archived: false, archivedAt: "", archivedBy: "" };
  return { fields, before, after: { ...fields }, result: { archived: false, wasArchivedAt: d.archivedAt || "", wasArchivedBy: d.archivedBy || "", note: "Back on the Job Board and every list as it was." } };
}

// ── 5. project.create ─────────────────────────────────────────────────────────
// args: { jobId, name }   ctx: { job, projects (every project doc's data, or []), nowIso, takenIds? }
function planCreateProject(args, ctx) {
  const a = args || {};
  const job = ctx.job;
  if (!job || !job.data) return refuse("That job doesn't exist in Command Center (or has no data). Nothing was written.");
  const d = job.data;
  if (d.archived || d.deleted) return refuse(`${d.name || "That job"} is archived. Nothing was written.`);
  if (d.type === "quote" || d.tempPed || d.quickJob) return refuse(`Make this a project isn't offered on ${d.type === "quote" ? "a quote" : d.tempPed ? "a temp ped job" : "a quick job"} (the app hides the Project section there). Nothing was written.`);
  if (d.projectGroupId) return refuse(`${d.name} is already in project ${d.projectGroupId}. Nothing was written.`);
  const name = T(a.name).slice(0, 120);
  if (!name) return refuse("name is the project's name (the job becomes its Site / Shared building). Nothing was written.");
  const division = isCommercial(d) ? "commercial" : "";
  const dup = (ctx.projects || []).find(p => p && !p.archived && String(p.name || "").trim().toLowerCase() === name.toLowerCase() && String(p.division || "") === division);
  if (dup) return refuse(`A ${division || "residential"} project named "${name}" already exists (${dup.id}) — use cc_join_project to add this job to it, or pick another name. Nothing was written.`);
  const uid = idMinter(Date.parse(ctx.nowIso), ctx.takenIds);
  const p = { id: "prj_" + uid(), name, division, gc: d.gc || "", address: d.address || "", notes: "", simproNo: String(d.simproNo || ""), createdAt: ctx.nowIso, createdBy: ME };
  const jobPatch = { projectGroupId: p.id, projectRole: "site", simproFolder: "", name: JS.buildingJobName(name, "Site / Shared") };
  const before = { projectGroupId: d.projectGroupId === undefined ? null : d.projectGroupId, projectRole: d.projectRole === undefined ? null : d.projectRole, simproFolder: d.simproFolder === undefined ? null : d.simproFolder, name: d.name === undefined ? null : d.name };
  return { project: p, jobPatch, before, after: { ...jobPatch }, result: { projectId: p.id, name, division: division || "resi", simproNo: p.simproNo, siteJobId: job.id, siteJobName: jobPatch.name, wasName: d.name || "", note: "The job is now the project's Site / Shared building and keeps everything on it. Add buildings with cc_create_building." } };
}

// ── 6. project.patch ──────────────────────────────────────────────────────────
// args: { projectId, simproNo? | notes? | archived? }  — ONE per call.  ctx: { project (data or null), conflicts (jobs carrying the new Simpro #), nowIso }
function planPatchProject(args, ctx) {
  const a = args || {};
  const p = ctx.project;
  if (!p) return refuse("That project doesn't exist (cc_list_projects shows them). Nothing was written.");
  const given = ["simproNo", "notes", "archived"].filter(k => a[k] !== undefined);
  if (given.length !== 1) return refuse("Give exactly one of simproNo, notes or archived per call.");
  const k = given[0];
  if (k !== "archived" && p.archived) return refuse(`${p.name || "That project"} is archived. Nothing was written.`);
  let patch;
  if (k === "simproNo") {
    const n = T(a.simproNo).replace(/^#/, "").trim().slice(0, 20);
    if (n && !/^\d+$/.test(n)) return refuse("simproNo must be the Simpro job number (digits), or \"\" to clear it.");
    if (String(p.simproNo || "") === n) return { noop: true, result: { field: k, simproNo: n } };
    if (n) { const clash = JS.simproNoConflict(ctx.conflicts || [], n, p.id); if (clash) return refuse(`Simpro #${n} already belongs to ${clash.name || "a live job"} outside this project. Nothing was written.`); }
    patch = { simproNo: n };
  } else if (k === "notes") {
    if (typeof a.notes !== "string") return refuse("notes must be text.");
    const v = T(a.notes).slice(0, 2000);
    if (String(p.notes || "") === v) return { noop: true, result: { field: k } };
    patch = { notes: v };
  } else {
    if (typeof a.archived !== "boolean") return refuse("archived must be true or false.");
    if (!!p.archived === a.archived) return { noop: true, result: { field: k, archived: a.archived } };
    patch = a.archived ? { archived: true, archivedBy: ME, archivedAt: ctx.nowIso } : { archived: false, archivedBy: "", archivedAt: "" };
  }
  const before = {}; Object.keys(patch).forEach(f => { before[f] = p[f] === undefined ? null : p[f]; });
  return { patch, before, after: { ...patch }, result: { field: k, changed: Object.keys(patch), ...(k === "archived" ? { note: a.archived ? "The project grouping goes away and its buildings show as normal jobs again. No job and nothing inside a job is deleted. Reversible with archived:false." : "The grouping is back." } : {}) } };
}

// ── 7. project.createBuilding ─────────────────────────────────────────────────
// args: { projectId, name, shareSimpro?, simproFolder?, ownSimproNo?, hiddenSections? }
// ctx:  { project (data), siblings (live jobs with projectGroupId = project), conflicts (live jobs carrying ownSimproNo), nowIso, takenIds? }
function planCreateBuilding(args, ctx) {
  const a = args || {};
  const project = ctx.project;
  if (!project) return refuse("That project doesn't exist (cc_list_projects shows them). Nothing was written.");
  if (project.archived) return refuse(`${project.name || "That project"} is archived. Nothing was written.`);
  const short = T(a.name).slice(0, 80);
  if (!short) return refuse("Name the building first.");
  if (a.shareSimpro != null && typeof a.shareSimpro !== "boolean") return refuse("shareSimpro must be true or false.");
  if (a.hiddenSections != null && (!isObj(a.hiddenSections) || Object.values(a.hiddenSections).some(v => typeof v !== "boolean"))) return refuse("hiddenSections must be a map of section key → true/false.");
  const share = a.shareSimpro === true;
  if (share && !project.simproNo) return refuse(`${project.name} has no Simpro # to share — give the building its own (ownSimproNo) or set the project's first (cc_patch_project). Nothing was written.`);
  const siblings = JS.projectBuildings(ctx.siblings || [], project.id);
  const ownNo = String(a.ownSimproNo || "").replace(/^#/, "").trim();
  if (ownNo && !/^\d+$/.test(ownNo)) return refuse("ownSimproNo must be the Simpro job number (digits).");
  if (!share && ownNo) { const clash = JS.simproNoConflict(ctx.conflicts || [], ownNo, project.id); if (clash) return refuse(`Simpro #${ownNo} already belongs to ${clash.name || "a live job"}. Make that job part of the project instead (cc_join_project). Nothing was written.`); }
  if (siblings.some(b => JS.buildingShortName(b, project).toLowerCase() === short.toLowerCase())) return refuse(`${project.name} already has a ${short}. Nothing was written.`);
  // Section keys: the project's division decides which the app's form shows (top-level switches only).
  const hidden = { ...(a.hiddenSections || {}) };
  const comm = project.division === "commercial";
  const allowed = JS.JOB_SECTION_DEFS.filter(s => (comm ? !!s.commercial : !s.commercial) && !s.parent && !(s.lutronOnly)).map(s => s.key);
  const bad = Object.keys(hidden).filter(k => !allowed.includes(k));
  if (bad.length) return refuse(`hiddenSections keys for a ${comm ? "commercial" : "residential"} building must be among ${allowed.join(", ")} (got ${bad.join(", ")}). Nothing was written.`);
  const src = siblings.find(b => b.projectRole === "site") || siblings[0] || null;
  const pick = (k) => (src && src[k] !== undefined && src[k] !== "") ? src[k] : (project[k] !== undefined ? project[k] : undefined);
  const uid = idMinter(Date.parse(ctx.nowIso), ctx.takenIds);
  const j = JS.blankJob(uid);
  if (project.division === "commercial") j.division = "commercial"; else delete j.division;
  j.name = JS.buildingJobName(project.name, short);
  j.projectGroupId = project.id;
  j.simproNo = share ? String(project.simproNo || "") : ownNo;
  j.simproFolder = share && project.simproNo ? String(a.simproFolder || short).trim() : "";
  if (j.simproFolder && !siblings.some(b => JS.isSimproJoinable(b) && String(b.simproNo || "") === String(project.simproNo || ""))) j.simproLead = true;
  ["address", "gc", "phone", "gcContacts", "gcContactLead", "gcContactLead2", "gcContact2", "phone2", "gcContactLabels", "customer"].forEach(k => { const v = pick(k); if (v !== undefined) j[k] = v; });
  j.foreman = (src && src.foreman) || "Unassigned";
  j.hiddenSections = { ...hidden };
  // Legacy-backed switches (Panelized Lighting, Tape Light …) read their old flag, not hiddenSections: write it too, via the registry's own patch.
  Object.keys(j.hiddenSections).filter(k => j.hiddenSections[k]).forEach(k => Object.assign(j, JS.jobSectionPatch(j, k, true)));
  const fields = { name: j.name, projectGroupId: j.projectGroupId, simproNo: j.simproNo, simproFolder: j.simproFolder, simproLead: !!j.simproLead, division: j.division || null, foreman: j.foreman, copiedFrom: src ? src.id : "project", copied: ["address", "gc", "phone", "gcContacts", "gcContactLead", "gcContactLead2", "gcContact2", "phone2", "gcContactLabels", "customer"].filter(k => j[k] !== undefined && pick(k) !== undefined), hiddenSections: j.hiddenSections };
  return { job: j, docId: j.id, fields, result: { jobId: j.id, name: j.name, shortName: short, projectId: project.id, projectName: project.name, simproNo: j.simproNo, sharedSimpro: share, simproFolder: j.simproFolder, simproLead: !!j.simproLead, division: j.division || "resi", foreman: j.foreman, copiedFrom: src ? { jobId: src.id, name: src.name || "" } : "the project record", hiddenSections: Object.keys(j.hiddenSections).filter(k => j.hiddenSections[k]), buildingsNow: siblings.length + 1 } };
}

// ── 8. project.join ───────────────────────────────────────────────────────────
// args: { jobId, projectId }   ctx: { job, project }
function planJoinProject(args, ctx) {
  const job = ctx.job, p = ctx.project;
  if (!job || !job.data) return refuse("That job doesn't exist in Command Center (or has no data). Nothing was written.");
  const d = job.data;
  if (d.archived || d.deleted) return refuse(`${d.name || "That job"} is archived. Nothing was written.`);
  if (!p) return refuse("That project doesn't exist (cc_list_projects shows them). Nothing was written.");
  if (p.archived) return refuse(`${p.name || "That project"} is archived. Nothing was written.`);
  if (d.projectGroupId === p.id) return { noop: true, result: { projectId: p.id, projectRole: d.projectRole || "" } };
  if (d.projectGroupId) return refuse(`${d.name} is already in project ${d.projectGroupId} — Leave project is done from the app. Nothing was written.`);
  if (d.type === "quote" || d.tempPed || d.quickJob) return refuse(`The Project section isn't offered on ${d.type === "quote" ? "a quote" : d.tempPed ? "a temp ped job" : "a quick job"}. Nothing was written.`);
  if (String(p.division || "") !== (isCommercial(d) ? "commercial" : "")) return refuse(`${p.name} is a ${p.division === "commercial" ? "commercial" : "residential"} project and ${d.name} is ${isCommercial(d) ? "commercial" : "residential"} — the app only lists same-division projects. Nothing was written.`);
  const fields = { projectGroupId: p.id, projectRole: "", simproLead: false, simproFolder: "" };
  const before = {}; Object.keys(fields).forEach(f => { before[f] = d[f] === undefined ? null : d[f]; });
  const shares = !!(p.simproNo && String(d.simproNo || "").trim() === String(p.simproNo).trim());
  return { fields, before, after: { ...fields }, result: { projectId: p.id, projectName: p.name, sharesSimpro: shares, note: shares ? `It carries the project's shared Simpro #${p.simproNo} — pick its Simpro folder for plans from the app's Project section.` : `It becomes a building of ${p.name} and keeps its own name, Simpro #${d.simproNo || "(none)"}, plans and everything on it. Nothing moves.` } };
}

module.exports = { SIMPRO_ID, PROJECT_ID, IMPORT_KINDS, DIVISIONS, INFO_FIELDS, INFO_TEXT, OPEN_CO, idMinter, live, openWork,
  planCreateFromSimpro, planSetInfo, planSetSection, planArchive, planCreateProject, planPatchProject, planCreateBuilding, planJoinProject };
