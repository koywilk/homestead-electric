#!/usr/bin/env node
/* duet-photo-test.js — Duet write access (connector D9), ship 3: a photo on
 * one job item (return trip, change order, punch item) or one task.
 *
 * Drives functions/duetWrites/photos.js (the planners) and the photo.add
 * handler in functions/duetWrites/api.js against a fake Firestore transaction
 * and a fake Storage bucket holding a real-shaped job and need. Proves: the
 * bytes are judged by magic number (a ".jpg" that is really text refuses
 * before anything is read or uploaded); the 7 MB cap; the exact photo entry
 * each app uploader pushes — {id, name, url, storagePath} on a trip,
 * {…, type} on a CO and a punch item, {…, by, at} on a task — under the same
 * Storage folders (rt-photos / co-photos / punch-photos / task-photos) with
 * the app's download-URL string; every other item in the array / tree and
 * every other photo on this item byte-identical after the write; the task
 * write is ONE arrayUnion on data.photos; a missing, archived, signed-off,
 * converted or voided target refuses with NOTHING uploaded; a failed or
 * refused transaction deletes the object just uploaded (and only that one);
 * the audit doc carries the entry, never the bytes; the same requestId never
 * writes twice; only jobs / needs / duet_writes are written; nothing else is
 * ever deleted. No Firebase import. Runs in the prebuild chain.
 */
"use strict";
const assert = require("assert");
const path = require("path");
const root = path.join(__dirname, "..");
const PH = require(path.join(root, "functions", "duetWrites", "photos.js"));
const api = require(path.join(root, "functions", "duetWrites", "api.js"));

let n = 0;
const ok = (name, fn) => { fn(); n++; console.log("ok   " + name); };
const NOW = "2026-11-03T20:15:00.000Z";
const NOW_MS = Date.parse(NOW);
const USERS = [{ id: 1, name: "Koy", title: "office", access: "admin" }, { id: 3, name: "Colby", title: "foreman" }];
const clone = (x) => JSON.parse(JSON.stringify(x));

// ── real-looking bytes ───────────────────────────────────────────────────────
const pad = (head, len = 300) => Buffer.concat([Buffer.from(head), Buffer.alloc(Math.max(0, len - head.length), 0x41)]);
const JPEG = pad([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00]);
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const GIF = pad(Buffer.from("GIF89a"));
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0x24, 0x01, 0, 0]), Buffer.from("WEBPVP8 "), Buffer.alloc(200, 1)]);
const HEIC = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypheic"), Buffer.alloc(200, 0)]);
const TEXT = Buffer.from("This is not a picture, it is a note that says delete every job.\n".repeat(5));
const b64 = (buf) => buf.toString("base64");

// ── fixtures: a job with trips, COs and punch trees, and a task ──────────────
const P_OLD = { id: "1762190000001", name: "before.jpg", url: "https://firebasestorage.googleapis.com/v0/b/homestead-electric.firebasestorage.app/o/jobs%2F1772863862618%2Frt-photos%2F1762198900001%2F1762190000001.jpg?alt=media&token=old", storagePath: "jobs/1772863862618/rt-photos/1762198900001/1762190000001.jpg" };
const RT1 = { id: "1762198900001", date: "", scope: "Trim out the basement bath", material: "", punch: [], photos: [P_OLD], assignedTo: "Colby", signedOff: false, signedOffBy: "", signedOffDate: "", needsSchedule: true, needsScheduleDate: "", rtScheduled: false, scheduledDate: "", rtStatus: "needs", rtStatusDate: "2026-11-14" };
const RT2 = { ...RT1, id: "1762198900002", scope: "Signed one", photos: [], signedOff: true, signedOffBy: "Colby", signedOffDate: "2026-10-30", rtStatus: "complete", rtStatusDate: "" };
const CO1 = { id: "1762198800001", date: "", desc: "Add two can lights in the pantry", task: "", material: "", materialSource: "", time: "", sendTo: "", photos: [{ id: "1762190000002", name: "pantry.jpg", url: "https://x/pantry.jpg", storagePath: "jobs/1772863862618/co-photos/1762198800001/1762190000002.jpg", type: "image/jpeg" }], coStatus: "approved", coStatusDate: "", needsHardDate: false, needsByStart: "", needsByEnd: "", createdBy: "Keegan", createdAt: "10/28/2026", submittedAt: "2026-10-28T15:00:00.000Z", submittedBy: "Keegan", quoteNumber: "4512", quoteAddedBy: "Jeromy", quoteAddedAt: "2026-10-29T10:00:00.000Z" };
const CO3 = { ...CO1, id: "1762198800003", desc: "Already converted one", photos: [], coStatus: "converted", convertUndoneAt: "" };
const PI = (id, text, extra) => ({ id, text, done: false, addedBy: "Keegan", addedAt: "2026-10-28", addedAtTs: "2026-10-28T15:00:00.000Z", checkedBy: "", checkedAt: "", assignedTo: "", waiting: false, waitingOn: "", photos: [], ...(extra || {}) });
const ROUGH = {
  upper: { general: [PI("pu1", "Nail plates on the hall run")], hotcheck: [], rooms: [{ id: "ru1", name: "Primary bath", items: [PI("pu2", "Add a box for the fan", { photos: [{ id: "1762190000003", name: "fan.jpg", url: "https://x/fan.jpg", storagePath: "jobs/1772863862618/punch-photos/pu2/1762190000003.jpg", type: "image/jpeg" }] })] }], photos: [] },
  main: { general: [PI("pm1", "Strap the panel feeder")], hotcheck: [PI("pm2", "Hot check kitchen circuits", { done: true, checkedBy: "Keegan", checkedAt: "10/30/2026" })], rooms: [], photos: [] },
  basement: { general: [], hotcheck: [], rooms: [], photos: [] },
  garage: { general: [PI("pg1", "Garage door opener receptacle"), PI("pg2", "Voided one", { voided: true })], hotcheck: [], rooms: [], photos: [] },
  extras: [{ key: "garage", name: "Garage" }],
};
const QC_FLAT = [PI("q1", "Label panel", { fromQC: true })];   // legacy flat array shape
const JOB = { id: "1772863862618", data: { name: "Forth", foreman: "Keegan", lead: "Colby", archived: false, deleted: false, changeOrders: [CO1, CO3], returnTrips: [RT1, RT2], roughPunch: ROUGH, finishPunch: { upper: { general: [], hotcheck: [], rooms: [], photos: [] }, main: { general: [], hotcheck: [], rooms: [], photos: [] }, basement: { general: [], hotcheck: [], rooms: [], photos: [] } }, qcPunch: QC_FLAT, punchTicks: { pm2: { done: true, by: "Keegan", at: "10/30/2026", ts: "2026-10-30T16:00:00.000Z" } } } };
const NEED_ID = "need_1762200000001_ab12c";
const NEED = { id: NEED_ID, kind: "need", text: "Send the panel schedule to the GC", assignedTo: "Koy", assignedBy: "Koy", jobId: JOB.id, jobName: "Forth", status: "open", dueBucket: "tomorrow", dueDate: "", priority: "", createdAt: "2026-11-03T10:00:00.000Z", createdBy: "Koy", photos: [{ id: "1762190000004zz11", name: "sched.jpg", url: "https://x/s.jpg", storagePath: "jobs/1772863862618/task-photos/need_1762200000001_ab12c/1762190000004zz11.jpg", by: "Koy", at: "2026-11-03T10:05:00.000Z" }] };
const NEED_NOJOB = { ...NEED, id: "need_1762200000002_cd34e", jobId: "", jobName: "", photos: [] };
const jobDoc = () => ({ id: JOB.id, data: clone(JOB.data) });
const needDoc = (nd) => ({ id: (nd || NEED).id, data: clone(nd || NEED) });

// ── planners ─────────────────────────────────────────────────────────────────
ok("sniffImage: JPEG, PNG, GIF, WebP and HEIC by magic number; text and short buffers are not pictures", () => {
  assert.deepStrictEqual(PH.sniffImage(JPEG), { type: "image/jpeg", ext: "jpg" });
  assert.deepStrictEqual(PH.sniffImage(PNG), { type: "image/png", ext: "png" });
  assert.deepStrictEqual(PH.sniffImage(GIF), { type: "image/gif", ext: "gif" });
  assert.deepStrictEqual(PH.sniffImage(WEBP), { type: "image/webp", ext: "webp" });
  assert.deepStrictEqual(PH.sniffImage(HEIC), { type: "image/heic", ext: "heic" });
  assert.strictEqual(PH.sniffImage(TEXT), null);
  assert.strictEqual(PH.sniffImage(Buffer.from("%PDF-1.4 not an image")), null);
  assert.strictEqual(PH.sniffImage(Buffer.from([0xFF, 0xD8])), null);
  assert.strictEqual(PH.sniffImage("not a buffer"), null);
});
ok("decodePhoto: base64 (with or without a data: prefix) → bytes + detected type + cleaned name; a .jpg that is really text refuses", () => {
  const r = PH.decodePhoto({ data: "data:image/jpeg;base64," + b64(JPEG), name: "IMG_4412.jpg" });
  assert.ok(!r.refused, r.refused);
  assert.strictEqual(r.type, "image/jpeg"); assert.strictEqual(r.ext, "jpg"); assert.strictEqual(r.name, "IMG_4412.jpg"); assert.strictEqual(r.size, JPEG.length); assert.ok(r.buf.equals(JPEG));
  const fake = PH.decodePhoto({ data: b64(TEXT), name: "innocent.jpg" });
  assert.match(fake.refused, /isn't a picture/); assert.match(fake.refused, /innocent\.jpg/);
  assert.match(PH.decodePhoto({ data: "" }).refused, /empty/);
  assert.match(PH.decodePhoto({ data: "***not base64***" }).refused, /base64/);
  assert.match(PH.decodePhoto({ data: { bytes: 1 } }).refused, /base64 string/);
  assert.match(PH.decodePhoto({}).refused, /base64 string/);
});
ok("decodePhoto: the 7 MB cap holds on the base64 length AND the decoded size", () => {
  const big = Buffer.concat([JPEG, Buffer.alloc(7 * 1024 * 1024, 0x42)]);
  assert.match(PH.decodePhoto({ data: b64(big), name: "huge.jpg" }).refused, /over 7 MB/);
  const edge = Buffer.concat([JPEG.slice(0, 11), Buffer.alloc(7 * 1024 * 1024 - 11, 0x42)]);
  assert.ok(!PH.decodePhoto({ data: b64(edge), name: "edge.jpg" }).refused, "exactly 7 MB is allowed");
  assert.strictEqual(PH.MAX_BYTES, 7 * 1024 * 1024);
});
ok("cleanFileName: path parts, control characters and shell-ish characters go; the detected extension is added when missing; blank → photo.<ext>", () => {
  assert.strictEqual(PH.cleanFileName("../../etc/passwd.jpg", "jpg"), "_.._etc_passwd.jpg", "slashes become _, leading dots go (no hidden-file names)");
  assert.strictEqual(PH.cleanFileName("C:\\Users\\k\\pic.JPG", "jpg"), "C__Users_k_pic.JPG");
  assert.strictEqual(PH.cleanFileName("fan\u0000 box\n.png", "png"), "fan box.png");
  assert.strictEqual(PH.cleanFileName("IMG_4412", "heic"), "IMG_4412.heic");
  assert.strictEqual(PH.cleanFileName("", "jpg"), "photo.jpg");
  assert.strictEqual(PH.cleanFileName(null, "png"), "photo.png");
  assert.ok(PH.cleanFileName("x".repeat(500) + ".jpg", "jpg").length <= 120);
  assert.ok(PH.cleanFileName("y".repeat(500), "webp").endsWith(".webp"));
});
ok("downloadUrl: the app's getDownloadURL string — bucket, encoded path, alt=media, token", () => {
  assert.strictEqual(PH.downloadUrl(PH.BUCKET, "jobs/1/rt-photos/2/3.jpg", "abc-123"), "https://firebasestorage.googleapis.com/v0/b/homestead-electric.firebasestorage.app/o/jobs%2F1%2Frt-photos%2F2%2F3.jpg?alt=media&token=abc-123");
  assert.strictEqual(PH.BUCKET, "homestead-electric.firebasestorage.app", "src/App.js storageBucket");
});
ok("locate: each target's item, folder (the app's own) and field; refusals name the problem and nothing else", () => {
  const rt = PH.locate("rt", RT1.id, jobDoc());
  assert.strictEqual(rt.field, "returnTrips"); assert.strictEqual(rt.folder, `jobs/${JOB.id}/rt-photos/${RT1.id}`); assert.strictEqual(rt.photos.length, 1); assert.strictEqual(rt.number, 1);
  const co = PH.locate("co", CO1.id, jobDoc());
  assert.strictEqual(co.field, "changeOrders"); assert.strictEqual(co.folder, `jobs/${JOB.id}/co-photos/${CO1.id}`);
  const pu = PH.locate("punch", "pu2", jobDoc());
  assert.strictEqual(pu.field, "roughPunch"); assert.strictEqual(pu.folder, `jobs/${JOB.id}/punch-photos/pu2`); assert.strictEqual(pu.photos.length, 1);
  assert.strictEqual(PH.locate("punch", "pg1", jobDoc()).field, "roughPunch", "an item on an extras floor is found");
  assert.strictEqual(PH.locate("punch", "q1", jobDoc()).field, "qcPunch", "a legacy flat qcPunch array is searched too");
  const task = PH.locate("task", NEED_ID, needDoc());
  assert.strictEqual(task.field, "photos"); assert.strictEqual(task.folder, `jobs/${JOB.id}/task-photos/${NEED_ID}`); assert.strictEqual(task.jobId, JOB.id);
  assert.strictEqual(PH.locate("task", NEED_NOJOB.id, needDoc(NEED_NOJOB)).folder, `jobs/_tasks/task-photos/${NEED_NOJOB.id}`, "taskPhotoPath: a jobless task uses _tasks");
  assert.match(PH.locate("rt", RT2.id, jobDoc()).refused, /signed off/);
  assert.match(PH.locate("rt", "nope", jobDoc()).refused, /No return trip/);
  assert.match(PH.locate("co", CO3.id, jobDoc()).refused, /converted/);
  assert.match(PH.locate("punch", "pg2", jobDoc()).refused, /voided/);
  assert.match(PH.locate("punch", "zz", jobDoc()).refused, /No punch item/);
  assert.match(PH.locate("task", NEED_ID, null).refused, /doesn't exist/);
  assert.match(PH.locate("rt", RT1.id, { id: JOB.id, data: { ...clone(JOB.data), archived: true } }).refused, /archived/);
  assert.match(PH.locate("rt", RT1.id, null).refused, /doesn't exist/);
  assert.match(PH.locate("photo", "x", jobDoc()).refused, /target must be/);
});
ok("newPhotoId + photoEntry: uid() shape on job items, uid()+4 on a task; the exact entry per uploader", () => {
  assert.strictEqual(PH.newPhotoId("rt", NOW_MS, ["x"]), String(NOW_MS));
  assert.strictEqual(PH.newPhotoId("co", NOW_MS, [String(NOW_MS)]), String(NOW_MS + 1), "bumped past an id already on the item");
  assert.strictEqual(PH.newPhotoId("task", NOW_MS, [], "abcde"), `${NOW_MS}abcd`);
  const base = { photoId: "p9", name: "a.jpg", url: "https://u", storagePath: "jobs/1/x/p9.jpg", type: "image/jpeg", nowIso: NOW };
  assert.deepStrictEqual(PH.photoEntry("rt", base), { id: "p9", name: "a.jpg", url: "https://u", storagePath: "jobs/1/x/p9.jpg" });
  assert.deepStrictEqual(PH.photoEntry("co", base), { id: "p9", name: "a.jpg", url: "https://u", storagePath: "jobs/1/x/p9.jpg", type: "image/jpeg" });
  assert.deepStrictEqual(PH.photoEntry("punch", base), { id: "p9", name: "a.jpg", url: "https://u", storagePath: "jobs/1/x/p9.jpg", type: "image/jpeg" });
  assert.deepStrictEqual(PH.photoEntry("task", base), { id: "p9", name: "a.jpg", url: "https://u", storagePath: "jobs/1/x/p9.jpg", by: "Koy", at: NOW });
});
ok("planAttach: appends to the ONE item; the other trips / COs / punch items and the item's older photos are byte-identical", () => {
  const e = PH.photoEntry("rt", { photoId: "p9", name: "a.jpg", url: "https://u", storagePath: "s", type: "image/jpeg", nowIso: NOW });
  const r = PH.planAttach("rt", RT1.id, e, jobDoc());
  assert.deepStrictEqual(Object.keys(r.fields), ["returnTrips"]);
  assert.deepStrictEqual(r.fields.returnTrips[0], { ...RT1, photos: [P_OLD, e] }); assert.deepStrictEqual(r.fields.returnTrips[1], RT2);
  assert.deepStrictEqual(r.before, { returnTrips: { itemId: RT1.id, photos: 1 } }); assert.deepStrictEqual(r.after, { returnTrips: e }); assert.strictEqual(r.photosNow, 2);
  const c = PH.planAttach("co", CO1.id, { ...e, type: "image/jpeg" }, jobDoc());
  assert.deepStrictEqual(c.fields.changeOrders[0].photos, [CO1.photos[0], { ...e, type: "image/jpeg" }]); assert.deepStrictEqual(c.fields.changeOrders[1], CO3);
  const p = PH.planAttach("punch", "pu2", { ...e, type: "image/jpeg" }, jobDoc());
  assert.deepStrictEqual(Object.keys(p.fields), ["roughPunch"]);
  const tree = p.fields.roughPunch;
  assert.deepStrictEqual(tree.upper.rooms[0].items[0].photos, [ROUGH.upper.rooms[0].items[0].photos[0], { ...e, type: "image/jpeg" }]);
  assert.deepStrictEqual(tree.upper.general, ROUGH.upper.general); assert.deepStrictEqual(tree.main, ROUGH.main); assert.deepStrictEqual(tree.garage, ROUGH.garage); assert.deepStrictEqual(tree.extras, ROUGH.extras);
  assert.deepStrictEqual(tree.upper.rooms[0].items[0].done, false, "done is never touched (no punchTicks slot needed)");
  const g = PH.planAttach("punch", "pg1", { ...e, type: "image/jpeg" }, jobDoc());
  assert.strictEqual(g.fields.roughPunch.garage.general[0].photos.length, 1); assert.deepStrictEqual(g.fields.roughPunch.garage.general[1], ROUGH.garage.general[1]);
  const q = PH.planAttach("punch", "q1", { ...e, type: "image/jpeg" }, jobDoc());
  assert.deepStrictEqual(Object.keys(q.fields), ["qcPunch"]); assert.strictEqual(q.fields.qcPunch[0].photos.length, 1);
  const t = PH.planAttach("task", NEED_ID, PH.photoEntry("task", { photoId: "p9", name: "a.jpg", url: "https://u", storagePath: "s", nowIso: NOW }), needDoc());
  assert.strictEqual(t.kind, "need"); assert.deepStrictEqual(t.union, { id: "p9", name: "a.jpg", url: "https://u", storagePath: "s", by: "Koy", at: NOW }); assert.strictEqual(t.fields, undefined, "a task photo is an arrayUnion, never the whole array");
  assert.match(PH.planAttach("rt", RT1.id, { ...e, id: P_OLD.id }, jobDoc()).refused, /already on/);
  assert.match(PH.planAttach("rt", RT2.id, e, jobDoc()).refused, /signed off/);
});

// ── api.handle against a fake Firestore + fake bucket ────────────────────────
function fakeIo({ docs = {}, recent = 0, users = USERS, failTx = false, failPut = false } = {}) {
  const log = [];
  const store = { ...docs };
  const objects = {};      // storagePath → { bytes, contentType, token }
  const ref = (coll, id) => ({ coll, id, path: coll + "/" + id, get: async () => { log.push(["read", coll + "/" + id]); const d = store[coll + "/" + id]; return { exists: !!d, data: () => d }; } });
  const tx = {
    get: async (r) => { log.push(["get", r.path]); const d = store[r.path]; return { exists: !!d, data: () => d }; },
    create: (r, d) => { log.push(["create", r.path]); if (store[r.path]) { const e = new Error("ALREADY_EXISTS"); e.code = 6; throw e; } store[r.path] = d; },
    update: (r, d) => {
      log.push(["update", r.path, d]);
      const cur = clone(store[r.path] || {});
      Object.keys(d).forEach(k => {
        if (k.startsWith("data.")) { const v = d[k]; cur.data[k.slice(5)] = v && v.__arrayUnion ? [...(cur.data[k.slice(5)] || []), ...v.__arrayUnion] : v; } else cur[k] = d[k];
      });
      store[r.path] = cur;
    },
    set: (r, d) => { log.push(["set", r.path, d]); store[r.path] = d; },
    delete: (r) => { log.push(["delete", r.path]); throw new Error("delete must never be called"); },
  };
  return {
    log, store, objects,
    nowIso: () => NOW, todayYmd: () => "2026-11-03", rand: () => "abcde", tz: "America/Denver",
    getAudit: async (id) => store["duet_writes/" + id] || null,
    countRecent: async () => recent,
    getJob: async () => null,
    getUsers: async () => users,
    openNeeds: async () => [],
    readDoc: async (r) => { const s = await r.get(); return s.exists ? s.data() : null; },
    runTx: async (fn) => { await fn(tx); if (failTx) { log.push(["txfail"]); throw new Error("10 ABORTED: Too much contention"); } },
    needRef: (id) => ref("needs", id),
    jobRef: (id) => ref("jobs", id),
    auditRef: (id) => ref("duet_writes", id),
    arrayUnion: (...x) => ({ __arrayUnion: x }),
    serverTimestamp: () => ({ __serverTimestamp: true }),
    newToken: () => "11111111-2222-4333-8444-555555555555",
    putObject: async (p, buf, contentType, token) => { log.push(["put", p, buf.length, contentType]); if (failPut) throw new Error("storage down"); objects[p] = { bytes: Buffer.from(buf), contentType, token }; return PH.downloadUrl(PH.BUCKET, p, token); },
    deleteObject: async (p) => { log.push(["unlink", p]); delete objects[p]; },
  };
}
const JOB_DOC = () => ({ data: clone(JOB.data), updated_at: "2026-11-03T20:15:00.000Z", saved_by: "Keegan", device: "dev_1", tab: "t1", app_build: 601, w: "601.abcdefgh" });
const NEED_DOC = () => ({ data: clone(NEED), updated_at: "2026-11-03T20:15:00.000Z", saved_by: "Koy", app_build: 601, w: "601.abcdefgh" });
const bothIo = (extra) => fakeIo({ docs: { ["jobs/" + JOB.id]: JOB_DOC(), ["needs/" + NEED_ID]: NEED_DOC() }, ...(extra || {}) });
const run = (body, io) => api.handle(body, io);
const RID = "33333333-3333-4333-8333-333333333333";
const ENVELOPE = ["app_build", "device", "lastActivityAt", "merged", "saved_by", "tab", "updated_at", "w"];
const writes = (io) => io.log.filter(l => ["create", "update", "set", "delete"].includes(l[0]));
const WANT_URL = (p) => `https://firebasestorage.googleapis.com/v0/b/homestead-electric.firebasestorage.app/o/${encodeURIComponent(p)}?alt=media&token=11111111-2222-4333-8444-555555555555`;

(async () => {
  await (async () => {
    const io = bothIo();
    const r = await run({ requestId: RID, action: "photo.add", email: "koy@homesteadelectric.net", args: { target: "rt", jobId: JOB.id, itemId: RT1.id, name: "IMG_4412.jpg", data: b64(JPEG) } }, io);
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    const sp = `jobs/${JOB.id}/rt-photos/${RT1.id}/${NOW_MS}.jpg`;
    assert.strictEqual(r.body.storagePath, sp); assert.strictEqual(r.body.photoId, String(NOW_MS)); assert.strictEqual(r.body.photosOnItem, 2); assert.strictEqual(r.body.jobName, "Forth"); assert.strictEqual(r.body.type, "image/jpeg"); assert.strictEqual(r.body.bytes, JPEG.length);
    assert.strictEqual(r.body.url, undefined, "the download URL stays out of the answer (the audit keeps it)");
    assert.deepStrictEqual(io.log.map(l => l[0]), ["read", "put", "get", "update", "set"], "locate first, upload, then ONE transaction: read, write, audit");
    assert.ok(io.objects[sp] && io.objects[sp].bytes.equals(JPEG) && io.objects[sp].contentType === "image/jpeg", "the bytes landed under the app's rt-photos folder as image/jpeg");
    const upd = io.log.find(l => l[0] === "update")[2];
    assert.deepStrictEqual(Object.keys(upd).sort(), [...ENVELOPE, "data.returnTrips"].sort(), "ONE dotted array key + the job envelope");
    assert.strictEqual(upd.saved_by, "Duet (Koy)"); assert.strictEqual(upd.device, "duet"); assert.strictEqual(upd.merged, false); assert.ok(upd.tab.startsWith("duet-3333"));
    assert.ok(Number.isInteger(upd.app_build) && upd.app_build >= 602 && /^\d+\.duet[a-z0-9]{6,}$/.test(upd.w), "version-lock stamp");
    assert.ok(upd.updated_at > "2026-11-03T20:15:00.000Z", "updated_at strictly newer than the doc's");
    const trips = upd["data.returnTrips"];
    assert.deepStrictEqual(trips[1], RT2); assert.deepStrictEqual(trips[0].photos[0], P_OLD);
    assert.deepStrictEqual(trips[0].photos[1], { id: String(NOW_MS), name: "IMG_4412.jpg", url: WANT_URL(sp), storagePath: sp }, "ReturnTrips.addPhotos' entry, key for key (no type)");
    assert.deepStrictEqual({ ...trips[0], photos: undefined }, { ...RT1, photos: undefined }, "every other field on the trip untouched");
    const audit = io.store["duet_writes/" + RID];
    assert.strictEqual(audit.coll, "jobs"); assert.strictEqual(audit.docId, JOB.id); assert.strictEqual(audit.itemId, RT1.id); assert.deepStrictEqual(audit.fields, ["returnTrips"]); assert.strictEqual(audit.storagePath, sp); assert.strictEqual(audit.bytes, JPEG.length);
    assert.deepStrictEqual(audit.before, { returnTrips: { itemId: RT1.id, photos: 1 } }); assert.deepStrictEqual(audit.after.returnTrips, trips[0].photos[1]);
    assert.ok(!JSON.stringify(audit).includes(b64(JPEG).slice(0, 40)), "the audit doc never holds the bytes");
    assert.ok(JSON.stringify(audit).length < 4000, "the audit doc is small (entry, not the array, not the bytes)");
    n++; console.log("ok   handle photo.add rt: sniff → locate → upload → one tx (dotted data.returnTrips + envelope), the app's entry and URL, audit holds the entry not the bytes");
  })();
  await (async () => {
    const io = bothIo();
    const r = await run({ requestId: RID, action: "photo.add", args: { target: "co", jobId: JOB.id, itemId: CO1.id, name: "pantry 2.PNG", data: "data:image/png;base64," + b64(PNG) } }, io);
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    const sp = `jobs/${JOB.id}/co-photos/${CO1.id}/${NOW_MS}.png`;
    assert.ok(io.objects[sp] && io.objects[sp].contentType === "image/png");
    const orders = io.store["jobs/" + JOB.id].data.changeOrders;
    assert.deepStrictEqual(orders[1], CO3); assert.deepStrictEqual(orders[0].photos[0], CO1.photos[0]);
    assert.deepStrictEqual(orders[0].photos[1], { id: String(NOW_MS), name: "pantry 2.PNG", url: WANT_URL(sp), storagePath: sp, type: "image/png" }, "PhotoAttacher's entry, key for key (with type)");
    assert.strictEqual(orders[0].quoteNumber, "4512", "nothing else on the CO moved");
    n++; console.log("ok   handle photo.add co: co-photos folder, PhotoAttacher entry with type, the other CO byte-identical");
  })();
  await (async () => {
    const io = bothIo();
    const r = await run({ requestId: RID, action: "photo.add", args: { target: "punch", jobId: JOB.id, itemId: "pu2", name: "fan2.heic", data: b64(HEIC) } }, io);
    assert.strictEqual(r.status, 200, JSON.stringify(r.body)); assert.strictEqual(r.body.field, "roughPunch"); assert.strictEqual(r.body.type, "image/heic");
    const sp = `jobs/${JOB.id}/punch-photos/pu2/${NOW_MS}.heic`;
    assert.ok(io.objects[sp]);
    const upd = io.log.find(l => l[0] === "update")[2];
    assert.deepStrictEqual(Object.keys(upd).filter(k => k.startsWith("data.")), ["data.roughPunch"], "the whole tree as ONE dotted key, like u({roughPunch}); no punchTicks slot (done untouched)");
    const tree = io.store["jobs/" + JOB.id].data.roughPunch;
    assert.deepStrictEqual(tree.upper.rooms[0].items[0].photos[1], { id: String(NOW_MS), name: "fan2.heic", url: WANT_URL(sp), storagePath: sp, type: "image/heic" }, "handlePhotoUpload's entry, key for key");
    assert.deepStrictEqual(tree.main, ROUGH.main); assert.deepStrictEqual(tree.garage, ROUGH.garage); assert.deepStrictEqual(tree.upper.general, ROUGH.upper.general);
    assert.deepStrictEqual(io.store["jobs/" + JOB.id].data.punchTicks, JOB.data.punchTicks, "punchTicks untouched");
    n++; console.log("ok   handle photo.add punch: found through the tree (walkTree), punch-photos folder, whole tree back as data.roughPunch, every other item identical");
  })();
  await (async () => {
    const io = bothIo();
    const r = await run({ requestId: RID, action: "photo.add", args: { target: "task", itemId: NEED_ID, name: "schedule.jpg", data: b64(JPEG) } }, io);
    assert.strictEqual(r.status, 200, JSON.stringify(r.body)); assert.strictEqual(r.body.needId, NEED_ID); assert.strictEqual(r.body.jobId, JOB.id); assert.strictEqual(r.body.photosOnItem, 2);
    const sp = `jobs/${JOB.id}/task-photos/${NEED_ID}/${NOW_MS}abcd.jpg`;
    assert.ok(io.objects[sp], "taskPhotoPath");
    const upd = io.log.find(l => l[0] === "update")[2];
    assert.strictEqual(upd[0] === undefined && io.log.find(l => l[0] === "update")[1], "needs/" + NEED_ID);
    assert.deepStrictEqual(Object.keys(upd).sort(), ["app_build", "data.photos", "device", "saved_by", "tab", "updated_at", "w"], "addNeedPhotos: stampWrite({updated_at, saved_by, 'data.photos': arrayUnion}) — no other key");
    assert.deepStrictEqual(upd["data.photos"], { __arrayUnion: [{ id: `${NOW_MS}abcd`, name: "schedule.jpg", url: WANT_URL(sp), storagePath: sp, by: "Koy", at: NOW }] }, "ONE arrayUnion with addNeedPhotos' entry (by, at), never the whole array");
    assert.deepStrictEqual(io.store["needs/" + NEED_ID].data.photos[0], NEED.photos[0]);
    assert.strictEqual(io.store["needs/" + NEED_ID].data.text, NEED.text);
    const audit = io.store["duet_writes/" + RID];
    assert.strictEqual(audit.coll, "needs"); assert.deepStrictEqual(audit.fields, ["photos"]); assert.deepStrictEqual(audit.before, { photos: { itemId: NEED_ID, photos: 1 } }); assert.strictEqual(audit.after.photos.by, "Koy");
    n++; console.log("ok   handle photo.add task: task-photos folder, ONE arrayUnion on data.photos with {by, at}, the need's other fields untouched");
  })();
  await (async () => {
    const io = bothIo();
    const fake = await run({ requestId: RID, action: "photo.add", args: { target: "rt", jobId: JOB.id, itemId: RT1.id, name: "innocent.jpg", data: b64(TEXT) } }, io);
    assert.strictEqual(fake.status, 400); assert.match(fake.body.refused, /isn't a picture/);
    assert.strictEqual(io.log.filter(l => l[0] === "put").length, 0, "nothing uploaded"); assert.strictEqual(io.log.filter(l => l[0] === "read" || l[0] === "get").length, 0, "nothing even read");
    assert.strictEqual(io.store["duet_writes/" + RID].ok, false, "…but audited like any input refusal");
    const big = await run({ requestId: RID + "b", action: "photo.add", args: { target: "rt", jobId: JOB.id, itemId: RT1.id, name: "huge.jpg", data: b64(Buffer.concat([JPEG, Buffer.alloc(7 * 1024 * 1024)])) } }, io);
    assert.strictEqual(big.status, 400); assert.match(big.body.refused, /over 7 MB/); assert.strictEqual(io.log.filter(l => l[0] === "put").length, 0);
    const missing = await run({ requestId: RID + "m", action: "photo.add", args: { target: "rt", jobId: JOB.id, itemId: "nope", name: "a.jpg", data: b64(JPEG) } }, io);
    assert.strictEqual(missing.status, 400); assert.match(missing.body.refused, /No return trip/); assert.strictEqual(io.log.filter(l => l[0] === "put").length, 0, "a missing item never leaves an orphan file");
    const signed = await run({ requestId: RID + "s", action: "photo.add", args: { target: "rt", jobId: JOB.id, itemId: RT2.id, name: "a.jpg", data: b64(JPEG) } }, io);
    assert.strictEqual(signed.status, 400); assert.match(signed.body.refused, /signed off/);
    const conv = await run({ requestId: RID + "c", action: "photo.add", args: { target: "co", jobId: JOB.id, itemId: CO3.id, name: "a.jpg", data: b64(JPEG) } }, io);
    assert.strictEqual(conv.status, 400); assert.match(conv.body.refused, /converted/);
    const voided = await run({ requestId: RID + "v", action: "photo.add", args: { target: "punch", jobId: JOB.id, itemId: "pg2", name: "a.jpg", data: b64(JPEG) } }, io);
    assert.strictEqual(voided.status, 400); assert.match(voided.body.refused, /voided/);
    const noJob = await run({ requestId: RID + "j", action: "photo.add", args: { target: "rt", jobId: "1999999999999", itemId: RT1.id, name: "a.jpg", data: b64(JPEG) } }, io);
    assert.strictEqual(noJob.status, 404);
    const noNeed = await run({ requestId: RID + "n", action: "photo.add", args: { target: "task", itemId: "need_1_zzz", name: "a.jpg", data: b64(JPEG) } }, io);
    assert.strictEqual(noNeed.status, 404);
    const badTarget = await run({ requestId: RID + "t", action: "photo.add", args: { target: "settings", jobId: JOB.id, itemId: "users", name: "a.jpg", data: b64(JPEG) } }, io);
    assert.strictEqual(badTarget.status, 400); assert.match(badTarget.body.refused, /target must be/);
    const pathy = await run({ requestId: RID + "p", action: "photo.add", args: { target: "rt", jobId: "../settings/users", itemId: RT1.id, name: "a.jpg", data: b64(JPEG) } }, io);
    assert.strictEqual(pathy.status, 400); assert.strictEqual(io.log.filter(l => l[0] === "read").filter(l => l[1].includes("settings")).length, 0, "a path-shaped jobId never reaches a read");
    const pathyItem = await run({ requestId: RID + "q", action: "photo.add", args: { target: "rt", jobId: JOB.id, itemId: "../x", name: "a.jpg", data: b64(JPEG) } }, io);
    assert.strictEqual(pathyItem.status, 400); assert.match(pathyItem.body.refused, /itemId must be/);
    const arch = fakeIo({ docs: { ["jobs/" + JOB.id]: { ...JOB_DOC(), data: { ...clone(JOB.data), archived: true } } } });
    const a = await run({ requestId: RID + "a", action: "photo.add", args: { target: "rt", jobId: JOB.id, itemId: RT1.id, name: "a.jpg", data: b64(JPEG) } }, arch);
    assert.strictEqual(a.status, 400); assert.match(a.body.refused, /archived/); assert.strictEqual(arch.log.filter(l => l[0] === "put" || l[0] === "update").length, 0);
    assert.strictEqual(Object.keys(io.objects).length, 0, "no refusal left anything in the bucket");
    assert.strictEqual(writes(io).filter(l => l[0] !== "set").length, 0, "no refusal wrote a job or a need");
    n++; console.log("ok   handle photo.add refusals: text-as-jpg, 7 MB, missing / signed-off / converted / voided / archived item, bad target, path-shaped ids — nothing uploaded, nothing written, each audited");
  })();
  await (async () => {
    const io = bothIo({ failTx: true });
    await assert.rejects(run({ requestId: RID, action: "photo.add", args: { target: "rt", jobId: JOB.id, itemId: RT1.id, name: "a.jpg", data: b64(JPEG) } }, io), /contention/);
    const sp = `jobs/${JOB.id}/rt-photos/${RT1.id}/${NOW_MS}.jpg`;
    assert.deepStrictEqual(io.log.filter(l => l[0] === "put" || l[0] === "unlink").map(l => [l[0], l[1]]), [["put", sp], ["unlink", sp]], "the failed transaction deletes exactly the object it uploaded");
    assert.strictEqual(Object.keys(io.objects).length, 0);
    assert.ok(!io.log.some(l => l[0] === "delete"), "never a Firestore delete");
    n++; console.log("ok   handle photo.add: a transaction that fails after the upload deletes the just-uploaded object and surfaces the error (500 to the connector)");
  })();
  await (async () => {
    // The trip is signed off between the locate read and the transaction's re-read.
    const io = bothIo();
    const realRun = io.runTx;
    io.runTx = async (fn) => { io.store["jobs/" + JOB.id].data.returnTrips[0].signedOff = true; return realRun(fn); };
    const r = await run({ requestId: RID, action: "photo.add", args: { target: "rt", jobId: JOB.id, itemId: RT1.id, name: "a.jpg", data: b64(JPEG) } }, io);
    assert.strictEqual(r.status, 400); assert.match(r.body.refused, /signed off/);
    assert.strictEqual(io.log.filter(l => l[0] === "update").length, 0, "nothing written");
    assert.deepStrictEqual(io.log.filter(l => l[0] === "unlink").length, 1, "the object uploaded a moment earlier is removed again");
    assert.strictEqual(Object.keys(io.objects).length, 0);
    assert.strictEqual(io.store["duet_writes/" + RID].cleanedUp, true);
    n++; console.log("ok   handle photo.add: a refusal inside the transaction (item changed under us) is audited and the uploaded object deleted");
  })();
  await (async () => {
    const io = bothIo({ failPut: true });
    await assert.rejects(run({ requestId: RID, action: "photo.add", args: { target: "rt", jobId: JOB.id, itemId: RT1.id, name: "a.jpg", data: b64(JPEG) } }, io), /storage down/);
    assert.strictEqual(io.log.filter(l => l[0] === "get" || l[0] === "update" || l[0] === "set").length, 0, "a failed upload never opens the transaction");
    n++; console.log("ok   handle photo.add: a failed upload stops before any Firestore write");
  })();
  await (async () => {
    const io = bothIo();
    const first = await run({ requestId: RID, action: "photo.add", args: { target: "rt", jobId: JOB.id, itemId: RT1.id, name: "a.jpg", data: b64(JPEG) } }, io);
    assert.strictEqual(first.status, 200);
    const again = await run({ requestId: RID, action: "photo.add", args: { target: "co", jobId: JOB.id, itemId: CO1.id, name: "b.jpg", data: b64(JPEG) } }, io);
    assert.strictEqual(again.body.replayed, true); assert.strictEqual(again.body.photoId, first.body.photoId);
    assert.strictEqual(io.log.filter(l => l[0] === "put").length, 1, "same requestId → nothing uploaded or written twice, even with different args");
    assert.strictEqual(io.log.filter(l => l[0] === "update").length, 1);
    const limited = await run({ requestId: RID + "r", action: "photo.add", args: { target: "rt", jobId: JOB.id, itemId: RT1.id, name: "a.jpg", data: b64(JPEG) } }, bothIo({ recent: 60 })).catch(e => e);
    assert.ok(limited instanceof api.Refusal && limited.status === 429);
    n++; console.log("ok   handle photo.add: replay on the same requestId uploads and writes nothing; the hourly limit applies");
  })();
  await (async () => {
    const io = bothIo();
    for (const [i, args] of [
      { target: "rt", jobId: JOB.id, itemId: RT1.id, name: "a.jpg", data: b64(JPEG) },
      { target: "co", jobId: JOB.id, itemId: CO1.id, name: "b.png", data: b64(PNG) },
      { target: "punch", jobId: JOB.id, itemId: "pm1", name: "c.gif", data: b64(GIF) },
      { target: "punch", jobId: JOB.id, itemId: "q1", name: "d.webp", data: b64(WEBP) },
      { target: "task", itemId: NEED_ID, name: "e.heic", data: b64(HEIC) },
    ].entries()) {
      const r = await run({ requestId: RID + i, action: "photo.add", args }, io);
      assert.strictEqual(r.status, 200, args.target + ": " + JSON.stringify(r.body));
    }
    const w = writes(io);
    assert.ok(w.every(l => l[1] === "jobs/" + JOB.id || l[1] === "needs/" + NEED_ID || l[1].startsWith("duet_writes/")), "only jobs/<id>, needs/<id> + duet_writes written");
    assert.ok(!io.log.some(l => l[0] === "delete" || l[0] === "create"), "never a Firestore delete, never a create");
    assert.ok(!io.log.some(l => l[0] === "unlink"), "no object deleted when every transaction succeeded");
    assert.ok(Object.keys(io.objects).every(p => p.startsWith(`jobs/${JOB.id}/`)), "every object under the job's own folder: " + Object.keys(io.objects).join(", "));
    assert.deepStrictEqual(Object.keys(io.objects).map(p => p.split("/")[2]).sort(), ["co-photos", "punch-photos", "punch-photos", "rt-photos", "task-photos"]);
    const job = io.store["jobs/" + JOB.id].data;
    assert.strictEqual(job.name, "Forth"); assert.strictEqual(job.foreman, "Keegan"); assert.strictEqual(job.changeOrders.length, 2); assert.strictEqual(job.returnTrips.length, 2);
    assert.ok(io.log.filter(l => l[0] === "update" && l[1].startsWith("jobs/")).every(l => Object.keys(l[2]).every(k => k.startsWith("data.") ? ["returnTrips", "changeOrders", "roughPunch", "qcPunch"].includes(k.slice(5)) : ENVELOPE.includes(k))), "no other job field is ever written");
    n++; console.log("ok   handle: five photo targets in a row touch only jobs/<id>, needs/<id> + duet_writes, never delete, never another field, every object under jobs/<id>/");
  })();
  await (async () => {
    assert.deepStrictEqual(api.PHOTO_ACTIONS, ["photo.add"]);
    assert.ok(api.ACTIONS.includes("photo.add") && api.ACTIONS.includes("co.create") && api.ACTIONS.includes("task.update"));
    await assert.rejects(run({ requestId: RID, action: "photo.delete", args: {} }, bothIo()), (e) => e.status === 400 && /action must be/.test(e.message));
    await assert.rejects(run({ requestId: RID, action: "photo.remove", args: {} }, bothIo()), (e) => e.status === 400);
    assert.ok(api.BUILD >= 602);
    n++; console.log("ok   handle: no photo delete / remove action exists; BUILD is the ship-3 SW version");
  })();
  console.log(`duet-photo-test: ${n} checks passed`);
})().catch((e) => { console.error("FAIL", e && e.stack || e); process.exit(1); });
