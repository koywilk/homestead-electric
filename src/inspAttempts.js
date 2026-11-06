// Inspection attempts: one record per Pass / Fail on a job's rough (4-way) or
// final inspection, kept in roughInspectionAttempts / finalInspectionAttempts.
// The count on the job's inspection tile is the length of that list.
//
// Koy, 2026-11-05: "noticing jobs like kweller with 7 attempts at 4 way. thats
// not right ive just hit fail on accident multiple times. that number needs to
// be easily adjustable." Kweller's seven were mis-taps: pass, fail, pass on 8/7
// and fail, pass on 8/11, each one appended.

// A Pass / Fail tap. A change of mind the same day by the same person corrects
// that day's attempt instead of logging another one. A Failed again attempt
// (repeat) is a real second failure and is never replaced. The replacement keeps
// its own fresh id, which is how the server's failed-inspection push still sees
// a pass corrected to a fail (functions/gcNotify.js newAttempts).
function inspLogTap(attempts, att) {
  const list = Array.isArray(attempts) ? attempts : [];
  const last = list[list.length - 1];
  if (last && !last.repeat && last.date === att.date && (last.by || "") === (att.by || "")) return [...list.slice(0, -1), att];
  return [...list, att];
}

// Take out the attempt at index i: the History list's Remove.
function inspRemoveAttempt(attempts, i) {
  return (Array.isArray(attempts) ? attempts : []).filter((_, j) => j !== i);
}

// Undo of a Remove puts the list back with the removed attempt marked restored,
// so the server doesn't take it for a new failure and push it again.
function inspRestoreAttempt(before, removed) {
  return (Array.isArray(before) ? before : []).map(x => (x === removed ? { ...x, restored: true } : x));
}

module.exports = { inspLogTap, inspRemoveAttempt, inspRestoreAttempt };
