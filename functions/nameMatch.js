"use strict";
// Resolve a person's display name (as stored on a job/RT/punch/need) to a user
// record in settings/users. v432: replaces five copies of a loose inline match
// that (a) could pick a DEACTIVATED user, (b) had no word boundary ("jo smith"
// matched "josh"), and (c) sent to whoever came first when two people share a
// first name. Now RT assignees can be anyone in the company, so collisions got
// likelier (Koy 2026-09-23).
//
// Order: exact full name → unique word-boundary match (a first name stored for
// someone whose record has a last name, or vice versa). Active users only.
// Ambiguous → the first candidate, but `ambiguous: true` so callers can log it
// (a push still goes out — notifications must never silently drop).
const norm = (s) => String(s || "").toLowerCase().trim().replace(/\s+/g, " ");

function matchUserByName(users, name) {
  const n = norm(name);
  if (!n) return { user: null, ambiguous: false };
  const live = (users || []).filter(u => u && u.name && u.active !== false);
  const exact = live.filter(u => norm(u.name) === n);
  if (exact.length) return { user: exact[0], ambiguous: exact.length > 1 };
  const near = live.filter(u => {
    const un = norm(u.name);
    return un.startsWith(n + " ") || n.startsWith(un + " ");
  });
  return { user: near[0] || null, ambiguous: near.length > 1 };
}

function findUserByName(users, name, log) {
  const { user, ambiguous } = matchUserByName(users, name);
  if (ambiguous && typeof log === "function") log(name, user && user.name);
  return user;
}

module.exports = { matchUserByName, findUserByName };
