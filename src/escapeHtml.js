// escapeHtml.js — plain text → literal HTML, for WRITE paths that store text
// where the app renders rich HTML (question answers, FieldInk adoption).
//
// Lifted out of src/sanitizeHtml.js (v603, 2026-11-03, Duet write access D9
// ship 4) so the duetApi Cloud Function can escape a question's answer with
// the EXACT function the app's own answer paths use (My Day's Save answer,
// the GC / FieldInk adoption): sanitizeHtml.js needs dompurify, which the
// functions/ package does not carry, so the one function the server needs
// lives here with no requires. sanitizeHtml.js re-exports it unchanged, so
// every app caller still reads `SafeHtml.escapeHtml`.
//
// COPIED to functions/escapeHtml.js by scripts/job-notes-sync.js — edit THIS
// file only; the prebuild refuses to build while the two differ.
"use strict";

/**
 * escapeHtml(text) → text with &, <, >, ", ' turned into entities.
 * Used on write paths that adopt plain-text answers from outside parties, so
 * a homeowner typing "5 < 6" reads correctly instead of being swallowed as a
 * tag. Mirrors the escape already applied to the FieldInk sibling path at
 * App.js:24243.
 */
function escapeHtml(text) {
  return String(text == null ? "" : text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

module.exports = { escapeHtml };
