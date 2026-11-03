// jobNotesShape.js — the shape of a job's Job Notes (`data.jobNotes[]`) and the
// one-time migration from the legacy PhaseInstructions, in ONE place.
//
// WHY THIS EXISTS (v603, 2026-11-03, Duet write access — connector decision D9, ship 4)
// -----------------------------------------------------------------------------------
// Claude Duet can now add a job note from a chat, through the duetApi Cloud
// Function. The app has a migration trap here: a job whose `jobNotes` is empty
// and whose `jobNotesMigratedAt` is unset shows its old rough / finish
// instructions AS notes (built in memory by buildMigratedJobNotes), and the
// FIRST write of `jobNotes` from the app persists that whole in-memory list and
// stamps `jobNotesMigratedAt`. A server that appended one note to an empty
// array would make those legacy notes vanish from the screen for good. So the
// server has to materialize the migrated notes with the SAME code the app
// uses, and that code lives here. These five functions moved out of App.js
// unchanged (jobNoteHtmlToText, jobNoteLooksLikeHtml, buildMigratedJobNotes,
// sanitizeJobNotesForDisplay, normalizeJobNotes); the only change is that the
// id maker and the clock are parameters, because App.js has its own uid()
// counter and the server has its own id rule.
//
// Pure, CommonJS, no requires: the CRA bundle imports it (App.js), the Cloud
// Functions require a copy, and scripts/duet-notes-test.js drives the exact
// file that ships. COPIED to functions/jobNotesShape.js by
// scripts/job-notes-sync.js — edit THIS file only; the prebuild refuses to
// build while the two differ.
//
// Nothing here touches Firestore.
"use strict";

// Convert legacy rich-text HTML (from PhaseInstructions) into readable plain
// text with line breaks preserved. Used during migration so the new Job
// Notes surface doesn't show raw <p>, <br>, &nbsp;, style="..." markup.
// Idempotent — plain text round-trips unchanged.
function jobNoteHtmlToText(s) {
  if (!s) return '';
  let t = String(s);
  // No tags and no entities → already plain text, short-circuit.
  if (!/[<&]/.test(t)) return t;
  // Normalize block-level breaks BEFORE stripping tags.
  t = t.replace(/<\s*br\s*\/?\s*>/gi, '\n');
  t = t.replace(/<\/\s*(p|div|li|h[1-6]|tr)\s*>/gi, '\n');
  t = t.replace(/<\s*li[^>]*>/gi, '• ');
  // Strip every remaining tag.
  t = t.replace(/<[^>]+>/g, '');
  // Decode the handful of entities the legacy editor emits.
  t = t.replace(/&nbsp;/gi, ' ')
       .replace(/&amp;/gi, '&')
       .replace(/&lt;/gi, '<')
       .replace(/&gt;/gi, '>')
       .replace(/&quot;/gi, '"')
       .replace(/&#39;/gi, "'")
       .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
       .replace(/&[a-z0-9]+;/gi, ' ');
  // Clean up whitespace: collapse runs of spaces, trim each line, cap blank
  // runs to a single blank line, trim the whole thing.
  t = t.replace(/[ \t]+/g, ' ');
  t = t.split('\n').map(x => x.trim()).join('\n');
  t = t.replace(/\n{3,}/g, '\n\n');
  return t.trim();
}

// Returns true if a string looks like it contains HTML markup. Used to
// decide whether to run jobNoteHtmlToText on lines already in Firestore
// (users whose jobNotesMigratedAt was stamped before this cleanup).
function jobNoteLooksLikeHtml(s) {
  if (!s) return false;
  return /<\s*(p|br|div|li|ul|ol|span|b|i|strong|em|a|h[1-6])\b[^>]*>/i.test(s)
      || /<\/\s*(p|div|li|ul|ol|span|b|i|strong|em|a|h[1-6])\s*>/i.test(s)
      || /&(nbsp|amp|lt|gt|quot|#\d+);/i.test(s);
}

// The app passes its own uid() (App.js: String(++_uid) seeded from Date.now());
// this fallback has the same shape for callers that don't.
let _uid = Date.now();
const defaultUid = () => String(++_uid);

// Job Notes migration (spec §"Replacement of PhaseInstructions"):
//   1. A job with saved jobNotes shows them as is.
//   2. A job with none and no jobNotesMigratedAt shows its legacy
//      roughInstructions / finishInstructions as notes, built here in memory.
//   3. On first write of `jobNotes`, the `u()` helper in JobDetail stamps
//      `jobNotesMigratedAt`. After that timestamp exists, we do NOT
//      re-materialize migrated notes even if the user empties the list —
//      that's an intentional clear, not a virgin state.
//   4. Raw HTML preserved verbatim in `lines[0].text` — no parsing. A
//      later "Split on bullets" action (V2) can opt-in to splitting.
function buildMigratedJobNotes(raw, uid = defaultUid, now = new Date().toISOString()) {
  const out = [];
  const pushFromInstructions = (arr, phase) => {
    (Array.isArray(arr) ? arr : []).forEach((entry) => {
      if (!entry) return;
      const rawLabel = (entry.label || '').trim();
      const rawText  = entry.text || '';
      // Convert legacy rich-text HTML to readable plain text (preserving line
      // breaks). Anything that's already plain text round-trips unchanged.
      const label    = jobNoteHtmlToText(rawLabel);
      const txt      = jobNoteHtmlToText(rawText);
      // Skip truly empty scratch rows so we don't migrate placeholders.
      const hasContent = label.length > 0 || txt.length > 0;
      if (!hasContent) return;
      out.push({
        id: uid(),
        title: label || 'Migrated note',
        phase,
        createdAt: now,
        createdBy: '',
        updatedAt: now,
        lines: [{
          id: uid(),
          text: txt,
          createdAt: now,
          photos: [],
          promoted: null,
        }],
        photos: [],
        archived: false,
        deleted: false,
        migratedFrom: { phase, originalId: entry.id || null },
      });
    });
  };
  pushFromInstructions(raw?.roughInstructions,  'rough');
  pushFromInstructions(raw?.finishInstructions, 'finish');
  return out;
}

// In-memory only: for users whose migration ran before the HTML→plain text
// cleanup shipped, their stored jobNotes still carry raw <p>/<br>/&nbsp;
// markup. Strip it on load so the UI renders clean text. Doesn't write back
// to Firestore (non-destructive); the next explicit edit persists the
// cleaned version. Idempotent — plain-text notes round-trip untouched.
function sanitizeJobNotesForDisplay(list) {
  if (!Array.isArray(list)) return [];
  let changed = false;
  const out = list.map(n => {
    if (!n) return n;
    let note = n;
    if (jobNoteLooksLikeHtml(n.title)) {
      note = { ...note, title: jobNoteHtmlToText(n.title) };
      changed = true;
    }
    if (Array.isArray(n.lines)) {
      let linesChanged = false;
      const nextLines = n.lines.map(l => {
        if (l && jobNoteLooksLikeHtml(l.text)) {
          linesChanged = true;
          return { ...l, text: jobNoteHtmlToText(l.text) };
        }
        return l;
      });
      if (linesChanged) {
        note = { ...note, lines: nextLines };
        changed = true;
      }
    }
    return note;
  });
  return changed ? out : list;
}

function normalizeJobNotes(raw, uid = defaultUid) {
  // Explicit saved list — trust it, but sanitize legacy HTML on display.
  if (Array.isArray(raw?.jobNotes) && raw.jobNotes.length > 0) {
    return sanitizeJobNotesForDisplay(raw.jobNotes);
  }
  // Migration already ran and was persisted — respect empty state.
  if (raw?.jobNotesMigratedAt) return Array.isArray(raw?.jobNotes) ? raw.jobNotes : [];
  // Virgin — materialize from legacy PhaseInstructions (in-memory only
  // until the first u({jobNotes:...}) write stamps jobNotesMigratedAt).
  return buildMigratedJobNotes(raw, uid);
}

// Is this job still in the "virgin" state, where the notes on screen are
// built from the legacy instructions and have never been saved? The first
// write of jobNotes (from a phone or from duetApi) must carry the whole
// migrated list plus the jobNotesMigratedAt stamp.
function jobNotesNeedMigration(raw) {
  if (Array.isArray(raw?.jobNotes) && raw.jobNotes.length > 0) return false;
  if (raw?.jobNotesMigratedAt) return false;
  return true;
}

module.exports = { jobNoteHtmlToText, jobNoteLooksLikeHtml, buildMigratedJobNotes, sanitizeJobNotesForDisplay, normalizeJobNotes, jobNotesNeedMigration };
