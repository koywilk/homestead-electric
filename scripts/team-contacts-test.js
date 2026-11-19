// Team phone list (SW v655): the Simpro + app merge, phone and email cleaning, who may read it,
// and that nothing writes contacts into Firestore. Run by prebuild.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const M = require("../functions/teamContacts.js");

// cleaning
assert.strictEqual(M.cleanPhone("801-555-1234"), "(801) 555-1234");
assert.strictEqual(M.cleanPhone("(801) 555-1234"), "(801) 555-1234");
assert.strictEqual(M.cleanPhone("1 801 555 1234"), "(801) 555-1234");
assert.strictEqual(M.cleanPhone(""), "");
assert.strictEqual(M.cleanPhone("ext 22"), "ext 22", "odd numbers kept as typed");
assert.strictEqual(M.dialOf("(801) 555-1234"), "8015551234");
assert.strictEqual(M.dialOf("ext 22"), "");
assert.strictEqual(M.cleanEmail(" Sam@Example.com "), "sam@example.com");
assert.strictEqual(M.cleanEmail("not an email"), "");
assert.strictEqual(M.cleanEmail("a@b.com, c@d.com"), "", "one address only");

const pc = (Email, CellPhone = "", WorkPhone = "") => ({ Email, CellPhone, WorkPhone });
const simpro = [
  { ID: 1, Name: "Sam  Field", Archived: false, PrimaryContact: pc("sam@x.com", "8015550001") },
  { ID: 2, Name: "Lee Lead", Archived: false, PrimaryContact: pc("lee@x.com", "", "801-555-0002") },
  { ID: 3, Name: "Gone Guy", Archived: true, PrimaryContact: pc("gone@x.com", "8015550003") },
  { ID: 4, Name: "Off Person", Archived: false, PrimaryContact: pc("off@x.com", "8015550004") },
  { ID: 5, Name: "Office Lady", Archived: false, PrimaryContact: pc("office@x.com") },
  { ID: 6, Name: "Con Tractor", Archived: false, PrimaryContact: pc("con@x.com", "8015550006") },
  { ID: 7, Name: "Sam Field", Archived: false, PrimaryContact: pc("dupe@x.com") },
];
const team = [
  { id: "sam", name: "Sam Field", title: "crew", access: "limited" },
  { id: "lee", name: "lee lead", title: "lead", access: "standard" },
  { id: "off", name: "Off Person", title: "crew", active: false },
  { id: "con", name: "Con Tractor", title: "foreman", access: "contractor" },
  { id: "new", name: "New Hire", title: "crew", access: "limited" },
  { id: "", name: "" },
];
const rows = M.buildContacts(simpro, team);
const by = Object.fromEntries(rows.map(r => [r.name, r]));
assert.deepStrictEqual(Object.keys(by).sort(), ["New Hire", "Office Lady", "Sam Field", "lee lead"].sort());
assert.deepStrictEqual(by["Sam Field"], { name: "Sam Field", teamId: "sam", title: "crew", email: "sam@x.com", phone: "(801) 555-0001", inSimpro: true });
assert.strictEqual(by["lee lead"].phone, "(801) 555-0002", "work phone when no cell");
assert.strictEqual(by["lee lead"].teamId, "lee", "matched ignoring case");
assert.ok(!by["Gone Guy"], "archived in Simpro left out");
assert.ok(!by["Off Person"], "deactivated in the app left out");
assert.ok(!by["Con Tractor"], "contractors left out");
assert.deepStrictEqual(by["Office Lady"], { name: "Office Lady", teamId: "", title: "", email: "office@x.com", phone: "", inSimpro: true });
assert.deepStrictEqual(by["New Hire"], { name: "New Hire", teamId: "new", title: "crew", email: "", phone: "", inSimpro: false });
assert.strictEqual(rows.filter(r => r.name === "Sam Field").length, 1, "one row per person");
assert.deepStrictEqual(rows.map(r => r.name), [...rows.map(r => r.name)].sort((a, b) => a.localeCompare(b)), "sorted");
assert.deepStrictEqual(M.buildContacts(null, null), []);

// who may read
assert.ok(M.mayRead({ name: "Sam", access: "limited" }));
assert.ok(!M.mayRead({ name: "Con", access: "contractor" }));
assert.ok(!M.mayRead({ name: "Off", active: false }));
assert.ok(!M.mayRead(null));

// the callable is PIN-gated, read-only, and contacts never go into Firestore
const idx = fs.readFileSync(path.join(__dirname, "../functions/index.js"), "utf8");
const at = idx.indexOf("exports.teamContacts");
assert.ok(at > 0, "teamContacts callable exported");
const body = idx.slice(at, idx.indexOf("\n});", at));
assert.ok(/requireMember\(data\)/.test(body), "live PIN required");
assert.ok(/mayRead\(/.test(body), "contractors refused");
assert.ok(!/\.set\(|\.update\(|\.add\(|simproReq(WithRetry)?\("(POST|PATCH|PUT|DELETE)"/.test(body), "read-only");
const app = fs.readFileSync(path.join(__dirname, "../src/App.js"), "utf8");
assert.ok(app.includes('memberCallable("teamContacts"'), "app reads contacts through the callable");
assert.ok(!/teamContacts[^\n]{0,200}(setDoc|updateDoc|addDoc)/.test(app), "app never saves contacts");

console.log("team-contacts-test: ok");
