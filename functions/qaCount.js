"use strict";
// Count answered questions in homeowner_requests.questionAnswers (v432).
// Shape: { rough: { upper:[…], main:[…], basement:[…], <extra>:[…] },
//          finish: {…}, answeredBy: "Name", answeredAt: "ISO" | null }.
// The old inline counter walked EVERY top-level value, so the answeredBy STRING
// was split into characters and "K".forEach threw — onQuestionAnswered crashed
// on every job that had ever been submitted, and no "Question answered" push
// went out (errors on record since at least 2026-09-02). Only plain-object
// phases and array floors count now; anything else is skipped.
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

function countAnswers(qa) {
  let n = 0;
  if (!isObj(qa)) return 0;
  Object.values(qa).forEach(phase => {
    if (!isObj(phase)) return;
    Object.values(phase).forEach(floor => {
      if (!Array.isArray(floor)) return;
      floor.forEach(a => { if (a && typeof a.answer === "string" && a.answer.trim()) n++; });
    });
  });
  return n;
}

module.exports = { countAnswers };
