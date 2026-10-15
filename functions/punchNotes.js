"use strict";
// Punch-item notes from share-link recipients (2026-10-15).
// homeowner_requests/{jobId}.punchNotes = { "<punchKey>_<itemId>": [
//   { id, text, by, share, at, ackBy?, ackAt? } ] }
// written by the public punch share page (append) and the office "Got it"
// (ack stamps). onQuestionAnswered pushes the job's lead + foreman for each
// NEW note — an ack, an edit or a re-save of the same note is never "new".
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const PUNCH_KEYS = ["roughPunch", "finishPunch", "qcPunch"];
const STAGE_OF = { roughPunch: "Rough", finishPunch: "Finish", qcPunch: "QC" };

// Split "<punchKey>_<itemId>" — item ids can contain "_", punch keys can't.
function splitNoteKey(key) {
  const k = String(key || "");
  const pk = PUNCH_KEYS.find(p => k.startsWith(p + "_"));
  return pk ? { punchKey: pk, itemId: k.slice(pk.length + 1) } : null;
}

// Notes present in `after` whose id wasn't in `before` (per key).
function newPunchNotes(before, after) {
  const out = [];
  if (!isObj(after)) return out;
  const b = isObj(before) ? before : {};
  Object.keys(after).forEach(key => {
    const parts = splitNoteKey(key);
    if (!parts || !Array.isArray(after[key])) return;
    const seen = new Set((Array.isArray(b[key]) ? b[key] : []).filter(isObj).map(n => n.id));
    after[key].forEach(n => {
      if (!isObj(n) || !n.id || seen.has(n.id)) return;
      if (typeof n.text !== "string" || !n.text.trim()) return;
      out.push({ key, ...parts, note: n });
    });
  });
  return out;
}

// The item's text on the job (for the push body). Walks every floor of the
// stage's punch: general, hotcheck, rooms[].items. "" when not found.
function punchItemText(job, punchKey, itemId) {
  const punch = isObj(job) && isObj(job[punchKey]) ? job[punchKey] : {};
  for (const floor of Object.values(punch)) {
    if (!isObj(floor)) continue;
    const lists = [floor.general, floor.hotcheck, ...((Array.isArray(floor.rooms) ? floor.rooms : []).map(r => isObj(r) ? r.items : null))];
    for (const list of lists) {
      if (!Array.isArray(list)) continue;
      const it = list.find(i => isObj(i) && i.id === itemId);
      if (it) return String(it.text || "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
    }
  }
  return "";
}

function punchNoteNotification(job, found) {
  const jobName = (isObj(job) && job.name) || "a job";
  const item = punchItemText(job, found.punchKey, found.itemId);
  const who = String(found.note.by || "Share link").slice(0, 60);
  const text = String(found.note.text).trim().slice(0, 120);
  return {
    title: `Punch note on ${jobName}`,
    body: `${who}: "${text}"${item ? ` — on: ${item.slice(0, 80)}` : ""}`,
    section: STAGE_OF[found.punchKey] || "Rough",
  };
}

module.exports = { newPunchNotes, punchItemText, punchNoteNotification, splitNoteKey };
