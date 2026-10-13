// Dashboard "Automated docs" (v535): which doc in each automation's Drive
// folder is the newest one of its kind. Pure, so scripts/autodocs-test.js can
// check it against real folder listings. The folders are fixed here; the
// callable never takes a folder id from the caller.
"use strict";

const AUTO_DOC_SOURCES = [
  { key: "packet",   folder: "1cDkt_N-TA6Z4gggjR6ywooz6GDh6OlDb", prefix: "Friday Packet — " },
  { key: "lead",     folder: "1cDkt_N-TA6Z4gggjR6ywooz6GDh6OlDb", prefix: "Lead Meeting Prep — " },
  { key: "strategy", folder: "1cDkt_N-TA6Z4gggjR6ywooz6GDh6OlDb", prefix: "Weekly Strategy Meeting — " },
  { key: "monday",   folder: "1-_A2XYgbz85O83K1Hwspka4KCnYeZQYP", prefix: "Monday Office Meeting — " },
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
