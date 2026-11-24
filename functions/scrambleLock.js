"use strict";
// scrambleLock.js — one booking at a time per person and day (v682).
//
// Grok's review, 2026-11-24: "two people booking the same person at the same second". Book rebuilds its entries and checks
// them against Simpro right before it writes, but two confirms landing together can both pass that check and both write.
// Before a booking reads Simpro, it takes a short lock on each person-day it is about to write (a doc in
// scrambleBookLocks, written only by the server). A second booking for the same person and day while the first is still
// going is refused with a plain message; once the first finishes, the second one's check sees the first one's entries in
// Simpro and refuses the overlap as it always did. A lock that was never released (a crash) expires on its own.
const COL = "scrambleBookLocks";
const TTL_MS = 3 * 60 * 1000;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

class Busy extends Error { constructor(msg, key) { super(msg); this.busy = true; this.key = key || ""; } }

const keyOf = (p) => `${Number(p.staffId)}_${String(p.date)}`;
// [{ staffId, date }] → sorted, de-duplicated lock keys; anything that isn't a person and a date is ignored
function uniqueKeys(pairs) {
  return [...new Set((pairs || []).filter(p => p && Number(p.staffId) > 0 && ISO.test(String(p.date))).map(keyOf))].sort();
}
// The person-days a booking request would write: each day's own people, else everyone picked.
function pairsOf(days, ids) {
  const out = [];
  (days || []).forEach(d => { if (!d || !ISO.test(String(d.date))) return;
    const who = Array.isArray(d.staffIds) && d.staffIds.length ? d.staffIds : ids;
    (who || []).forEach(id => out.push({ staffId: Number(id), date: d.date })); });
  return out;
}
// Pure: the first key someone else holds right now ("" when none). docs: { key: { owner, until } }
function heldBy(docs, keys, owner, now) {
  for (const k of keys) { const d = docs && docs[k]; if (d && Number(d.until) > now && d.owner !== owner) return k; }
  return "";
}
const busyMessage = (key) => `Another booking for the same person on ${String(key).split("_")[1] || "that day"} is going into Simpro right now. Nothing was written. Wait a minute, then preview again.`;

// Takes the locks for a booking. Returns an async release() (or null when there is nothing to lock). Throws Busy when
// someone else holds one of them. Every lock is taken together or not at all.
async function take(db, pairs, by, now) {
  const keys = uniqueKeys(pairs); if (!keys.length) return null;
  const t = now == null ? Date.now() : now, mine = `${String(by || "server").slice(0, 40)}#${Math.random().toString(36).slice(2, 10)}`;
  await db.runTransaction(async (tx) => {
    const snaps = await Promise.all(keys.map(k => tx.get(db.collection(COL).doc(k))));
    const docs = {}; snaps.forEach((s, i) => { if (s && s.exists) docs[keys[i]] = s.data(); });
    const busy = heldBy(docs, keys, mine, t);
    if (busy) throw new Busy(busyMessage(busy), busy);
    keys.forEach(k => tx.set(db.collection(COL).doc(k), { owner: mine, by: String(by || "").slice(0, 60), until: t + TTL_MS }));
  });
  return async () => {
    try { await Promise.all(keys.map(async (k) => { const ref = db.collection(COL).doc(k), s = await ref.get(); if (s && s.exists && (s.data() || {}).owner === mine) await ref.delete(); })); }
    catch (e) { /* the lock expires by itself in a few minutes */ }
  };
}

module.exports = { COL, TTL_MS, Busy, keyOf, uniqueKeys, pairsOf, heldBy, busyMessage, take };
