// crew-briefs-index.js — SW v665. Reads docs/crew-briefs/vNNN.md (the note Koy forwards to the crew after
// every ship) and writes src/crewBriefsIndex.json: the newest 20 briefs, each section heading and its first
// line. The Lead Meeting's Training ideas use it to suggest app topics shipped since the last meeting.
// Runs in prebuild, so a ship's own brief is always in its build. Pure file read and write.
"use strict";
const fs = require("fs"), path = require("path");
const dir = path.join(__dirname, "..", "docs", "crew-briefs");
const out = path.join(__dirname, "..", "src", "crewBriefsIndex.json");
const files = fs.readdirSync(dir).map(f => /^v(\d+)\.md$/.exec(f)).filter(Boolean).map(m => +m[1]).sort((a, b) => b - a).slice(0, 20);
const list = files.map(v => {
  const lines = fs.readFileSync(path.join(dir, "v" + v + ".md"), "utf8").split(/\r?\n/);
  const heads = [];
  lines.forEach((l, i) => {
    if (!/^(NEW|FIXED|CHANGED|REMOVED|BETTER)\b/.test(l.trim())) return;
    const first = (lines.slice(i + 1).find(x => /^\s*-\s+/.test(x)) || "").replace(/^\s*-\s+/, "").trim();
    heads.push({ h: l.trim(), first: first.slice(0, 200) });
  });
  return { v, heads };
});
const text = JSON.stringify(list, null, 1) + "\n";
if (!fs.existsSync(out) || fs.readFileSync(out, "utf8") !== text) fs.writeFileSync(out, text);
console.log("crew-briefs-index: " + list.length + " briefs, newest v" + (files[0] || "?"));
