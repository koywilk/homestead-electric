// Dashboard "Automated docs" (v535): which doc in each automation's Drive
// folder is the newest one of its kind. Pure, so scripts/autodocs-test.js can
// check it against real folder listings. The folders are fixed here; the
// callable never takes a folder id from the caller.
"use strict";

const AUTO_DOC_SOURCES = [
  { key: "monday",    folder: "17WmRG9qdErbJcvl4vDShRjSduJOZARZ0", prefix: "Monday Office Meeting — " },
  { key: "wednesday", folder: "1tAFxgYFL7su4xDviMDvPo0Xe355tGaRR", prefix: "Weekly Lead Meeting — " },
  { key: "friday",    folder: "1q107o80DtOadifPymLZzzImSMQBf74_3", prefix: "Friday Strategy Prep — " },
];

// files: Drive files of one folder ({id, name, createdTime, modifiedTime, webViewLink}).
// Newest by createdTime among names starting with the prefix ("SUPERSEDED …"
// copies don't match); a later "(v2)" of the same day wins because it was made later.
function pickLatest(files, prefix) {
  let best = null;
  (files || []).forEach(f => {
    if (!f || !f.id || !String(f.name || "").startsWith(prefix)) return;
    if (!best || String(f.createdTime || "") > String(best.createdTime || "")) best = f;
  });
  if (!best) return null;
  return {
    id: best.id,
    name: best.name,
    url: best.webViewLink || `https://docs.google.com/document/d/${best.id}/edit`,
    createdTime: best.createdTime || "",
    modifiedTime: best.modifiedTime || "",
  };
}

module.exports = { AUTO_DOC_SOURCES, pickLatest };
