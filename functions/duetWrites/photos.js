"use strict";
// Duet write access (D9), ship 3: a photo onto one job item. PURE planners —
// given the bytes Duet sent, the live doc and what the server knows (clock,
// rand), they return either a refusal or exactly what to write, copied from
// the app's own uploaders in src/App.js: ReturnTrips.addPhotos (rt-photos/,
// entry {id, name, url, storagePath}), PhotoAttacher on a change order
// (co-photos/, {id, name, url, storagePath, type}), PunchList.handlePhotoUpload
// (punch-photos/, same shape as the CO), and addNeedPhotos (task-photos/,
// {id, name, url, storagePath, by, at}, ONE arrayUnion on data.photos). No
// Firestore or Storage here: api.js uploads the object and runs the
// transaction, scripts/duet-photo-test.js drives these with fixtures.
//
// The bytes are checked by their magic numbers, not the name Duet gave them:
// a ".jpg" that is really text is refused before anything is uploaded. 7 MB
// raw is the cap (a gen-1 HTTPS function takes a 10 MB body; base64 is a
// third bigger). No recompression: the app's _gcPrepUpload runs in the
// browser and functions/ has no image library — the file is stored as sent.
const { walkTree, TREES } = require("../punchTicks.js");
const { newItemId } = require("./jobItems.js");
const { ME } = require("./needs.js");

const refuse = (why) => ({ refused: why });
const MAX_BYTES = 7 * 1024 * 1024;
const MAX_NAME = 120;
const TARGETS = ["rt", "co", "punch", "task"];
const BUCKET = "homestead-electric.firebasestorage.app";   // src/App.js firebaseConfig.storageBucket

// Magic numbers for the image kinds a phone sends. HEIC/HEIF is the ISO
// base-media "ftyp" box with one of Apple's brands at byte 8.
const HEIC_BRANDS = ["heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs"];
const HEIF_BRANDS = ["mif1", "msf1"];
function sniffImage(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return { type: "image/jpeg", ext: "jpg" };
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]))) return { type: "image/png", ext: "png" };
  const head6 = buf.slice(0, 6).toString("latin1");
  if (head6 === "GIF87a" || head6 === "GIF89a") return { type: "image/gif", ext: "gif" };
  if (buf.slice(0, 4).toString("latin1") === "RIFF" && buf.slice(8, 12).toString("latin1") === "WEBP") return { type: "image/webp", ext: "webp" };
  if (buf.slice(4, 8).toString("latin1") === "ftyp") {
    const brand = buf.slice(8, 12).toString("latin1").toLowerCase();
    if (HEIC_BRANDS.includes(brand)) return { type: "image/heic", ext: "heic" };
    if (HEIF_BRANDS.includes(brand)) return { type: "image/heif", ext: "heif" };
  }
  return null;
}

// The name the app would have kept (file.name): no path parts, no control
// characters, trimmed, capped; the detected extension added when it has none.
function cleanFileName(name, ext) {
  let n = String(name == null ? "" : name).replace(/[\u0000-\u001F\u007F]/g, "").replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, " ").trim();
  n = n.replace(/^\.+/, "").slice(0, MAX_NAME).trim();
  if (!n) return `photo.${ext}`;
  if (!/\.[a-z0-9]{1,5}$/i.test(n)) n = `${n.slice(0, MAX_NAME - ext.length - 1)}.${ext}`;
  return n;
}

// Base64 from the connector → the bytes, checked. Same rules as
// materialPO/rules.js decodeReceiptPhoto, widened to the image kinds the app's
// isImage() renders.
function decodePhoto(args) {
  const a = args || {};
  if (typeof a.data !== "string") return refuse("data must be the photo as a base64 string.");
  const raw = a.data.replace(/^data:[a-z0-9.+/-]+;base64,/i, "").replace(/\s+/g, "");
  if (!raw) return refuse("The photo came through empty. Nothing was written.");
  if (raw.length > Math.ceil(MAX_BYTES * 4 / 3) + 8) return refuse(`That photo is over 7 MB — too big to add from Duet. Nothing was written.`);
  if (!/^[A-Za-z0-9+/]+=*$/.test(raw)) return refuse("The photo didn't come through as base64. Nothing was written.");
  const buf = Buffer.from(raw, "base64");
  if (buf.length > MAX_BYTES) return refuse(`That photo is over 7 MB — too big to add from Duet. Nothing was written.`);
  const kind = sniffImage(buf);
  if (!kind) return refuse(`That file isn't a picture (JPEG, PNG, WebP, HEIC or GIF)${a.name ? ` — "${String(a.name).slice(0, 60)}"` : ""}. Nothing was written.`);
  return { buf, type: kind.type, ext: kind.ext, name: cleanFileName(a.name, kind.ext), size: buf.length };
}

// The app's download URL for an object with a Firebase download token
// (firebase-admin getDownloadURL builds the same string from the token).
function downloadUrl(bucketName, storagePath, token) {
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(storagePath)}?alt=media&token=${token}`;
}

const byId = (arr, id) => (Array.isArray(arr) ? arr : []).findIndex(x => x && String(x.id) === String(id));
const jobGate = (job) => {
  if (!job || !job.data) return refuse("That job doesn't exist in Command Center (or has no data). Nothing was written.");
  if (job.data.archived || job.data.deleted) return refuse(`${job.data.name || "That job"} is archived — changes go on live jobs only. Nothing was written.`);
  return null;
};

// Find a punch item by id in the job's three trees (walkTree covers every
// floor, extras included, general / hotcheck / rooms); a legacy flat array is
// searched too. Returns the tree name and the item, or null.
function findPunch(data, itemId) {
  for (const tree of TREES) {
    const t = data[tree];
    if (!t) continue;
    if (Array.isArray(t)) { const i = byId(t, itemId); if (i >= 0) return { tree, item: t[i] }; continue; }
    let hit = null;
    walkTree(t, it => { if (!hit && it && typeof it === "object" && String(it.id) === String(itemId)) hit = it; });
    if (hit) return { tree, item: hit };
  }
  return null;
}

// Where the photo goes, and whether it may: the item (by id) on the live doc,
// the Storage folder the app's own uploader uses for that item, and the field
// the write lands in. `doc` is { id, data } for a job, { id, data } for a need.
function locate(target, itemId, doc) {
  if (!TARGETS.includes(target)) return refuse(`target must be one of ${TARGETS.join(", ")}.`);
  const id = String(itemId || "");
  if (target === "task") {
    if (!doc || !doc.data) return refuse("That task doesn't exist (it may have been deleted). Nothing was written.");
    const need = doc.data;
    return { kind: "need", field: "photos", item: need, photos: Array.isArray(need.photos) ? need.photos : [], folder: `jobs/${need.jobId || "_tasks"}/task-photos/${doc.id}`, label: "the task", jobId: need.jobId || "" };
  }
  const g = jobGate(doc); if (g) return g;
  const data = doc.data, name = data.name || "that job";
  if (target === "rt") {
    const trips = Array.isArray(data.returnTrips) ? data.returnTrips : [];
    const i = byId(trips, id);
    if (i < 0) return refuse(`No return trip with id ${id} on ${name}. Nothing was written.`);
    if (trips[i].signedOff) return refuse(`Return trip #${i + 1} is signed off — it's closed. Nothing was written.`);
    return { kind: "job", field: "returnTrips", item: trips[i], photos: Array.isArray(trips[i].photos) ? trips[i].photos : [], folder: `jobs/${doc.id}/rt-photos/${id}`, label: `return trip #${i + 1}`, number: i + 1 };
  }
  if (target === "co") {
    const orders = Array.isArray(data.changeOrders) ? data.changeOrders : [];
    const i = byId(orders, id);
    if (i < 0) return refuse(`No change order with id ${id} on ${name}. Nothing was written.`);
    if (orders[i].coStatus === "converted") return refuse(`Change order #${i + 1} was converted to a return trip — the app hides its photos; add the photo to the return trip instead.`);
    return { kind: "job", field: "changeOrders", item: orders[i], photos: Array.isArray(orders[i].photos) ? orders[i].photos : [], folder: `jobs/${doc.id}/co-photos/${id}`, label: `change order #${i + 1}`, number: i + 1 };
  }
  const hit = findPunch(data, id);
  if (!hit) return refuse(`No punch item with id ${id} on ${name} (rough, finish or QC). Nothing was written.`);
  if (hit.item.voided) return refuse(`That punch item is voided. Nothing was written.`);
  return { kind: "job", field: hit.tree, item: hit.item, photos: Array.isArray(hit.item.photos) ? hit.item.photos : [], folder: `jobs/${doc.id}/punch-photos/${id}`, label: `the ${hit.tree.replace("Punch", "")} punch item`, tree: hit.tree };
}

// The app's photo ids: uid() (a millisecond string) on job items; uid() plus
// four random characters on task photos (addNeedPhotos).
function newPhotoId(target, nowMs, existingIds, rand) {
  if (target === "task") return `${Math.floor(nowMs)}${String(rand || "").replace(/[^a-z0-9]/gi, "").slice(0, 4).padEnd(4, "0")}`;
  return newItemId(nowMs, existingIds);
}

// The exact object each uploader pushes onto photos[] — key for key.
function photoEntry(target, { photoId, name, url, storagePath, type, nowIso }) {
  if (target === "rt") return { id: photoId, name, url, storagePath };                          // ReturnTrips.addPhotos
  if (target === "task") return { id: photoId, name, url, storagePath, by: ME, at: nowIso };    // addNeedPhotos
  return { id: photoId, name, url, storagePath, type };                                        // PhotoAttacher / handlePhotoUpload
}

// Re-run on the live doc inside the transaction: the item must still be there
// and still open; the entry is appended to ITS photos[] and the whole field
// comes back for the dotted write (a job array or punch tree), or the entry
// alone for the need's arrayUnion. Every other item, and every other photo on
// this one, is the live copy untouched.
function planAttach(target, itemId, entry, doc) {
  const loc = locate(target, itemId, doc); if (loc.refused) return loc;
  if (loc.photos.some(p => p && String(p.id) === String(entry.id))) return refuse(`A photo with id ${entry.id} is already on ${loc.label}. Nothing was written.`);
  const before = { [loc.field]: { itemId: String(itemId), photos: loc.photos.length } };
  const after = { [loc.field]: entry };
  if (loc.kind === "need") return { kind: "need", union: entry, before, after, photosNow: loc.photos.length + 1, label: loc.label, jobId: loc.jobId };
  const data = doc.data;
  const nextItem = { ...loc.item, photos: [...loc.photos, entry] };
  let value;
  if (loc.field === "returnTrips" || loc.field === "changeOrders") value = data[loc.field].map(x => x === loc.item ? nextItem : x);
  else if (Array.isArray(data[loc.field])) value = data[loc.field].map(x => x === loc.item ? nextItem : x);
  else {
    // Punch tree: copy, then swap the one item where it sits (floor / room).
    value = JSON.parse(JSON.stringify(data[loc.field]));
    let done = false;
    const swap = (list) => { if (!Array.isArray(list)) return; const i = list.findIndex(x => x && String(x.id) === String(itemId)); if (i >= 0 && !done) { list[i] = nextItem; done = true; } };
    const keys = ["upper", "main", "basement", ...((Array.isArray(value.extras) ? value.extras : []).map(e => e && e.key).filter(Boolean))];
    for (const fk of keys) { const fl = value[fk]; if (!fl || typeof fl !== "object") continue; swap(fl.general); swap(fl.hotcheck); (Array.isArray(fl.rooms) ? fl.rooms : []).forEach(r => r && swap(r.items)); }
    if (!done) return refuse(`No punch item with id ${itemId} on ${data.name || "that job"}. Nothing was written.`);
  }
  return { kind: "job", fields: { [loc.field]: value }, before, after, itemId: String(itemId), number: loc.number, photosNow: loc.photos.length + 1, label: loc.label, field: loc.field };
}

module.exports = { MAX_BYTES, TARGETS, BUCKET, sniffImage, cleanFileName, decodePhoto, downloadUrl, locate, findPunch, newPhotoId, photoEntry, planAttach };
