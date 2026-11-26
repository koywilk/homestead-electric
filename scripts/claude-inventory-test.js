#!/usr/bin/env node
/* claude-inventory-test.js — gate for "Everything Claude runs" in the Claude tab (SW v689).
 *
 * Koy, 2026-11-25: every Claude automation, feature, sheet, doc and page on one list
 * with its link and a walkthrough, marked when it's "not being pulled yet", including
 * files shared with him. His rules: no dollar or pay figures outside owners/admins;
 * jobs by number and name.
 *
 * Checks the data file's shape (every row has a group, title and a plain what-it-does;
 * links are https Google / claude.ai / app links only; no dollar amounts in the words),
 * that Koy-only rows (Shared with me, his claude.ai pages) never reach another admin,
 * and that claudeWork in functions/index.js sends it.
 */
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const INV = require("../functions/claudeInventory.js");
const D = INV.DATA;

let n = 0;
const check = (label, fn) => { try { fn(); n++; console.log("  ok  " + label); } catch (e) { console.error("  FAIL " + label + "\n       " + (e && e.stack || e)); process.exit(1); } };

check("data file has its groups and a checked date", () => {
  assert.deepStrictEqual(D.groups.map(g => g.k), INV.GROUPS);
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(D.checkedAt));
});

check("every row: unique id, known group, title and what it does", () => {
  const ids = new Set();
  D.items.forEach(it => {
    assert.ok(it.id && !ids.has(it.id), `duplicate or missing id ${it.id}`); ids.add(it.id);
    assert.ok(INV.GROUPS.includes(it.group), `${it.id}: unknown group ${it.group}`);
    assert.ok(it.title && it.title.length <= 140, `${it.id}: title`);
    assert.ok(it.what && it.what.length <= 600, `${it.id}: what`);
  });
});

check("automations say on or off; an on one says when it runs", () => {
  D.items.filter(it => it.group === "autos").forEach(it => {
    assert.ok(typeof it.on === "boolean", `${it.id}: on/off`);
    if (it.on) assert.ok(it.when, `${it.id}: when`);
    assert.ok(!("pulled" in it), `${it.id}: automations use on/off, not pulled`);
  });
});

check("links are https Google, claude.ai or app links, and every one passes the server check", () => {
  D.items.filter(it => it.link).forEach(it => assert.ok(INV.LINK_OK.test(it.link), `${it.id}: link ${it.link}`));
  assert.ok(!INV.LINK_OK.test("http://docs.google.com/document/d/abc/edit"));
  assert.ok(!INV.LINK_OK.test("https://evil.example/claude.ai/artifact/x"));
  assert.strictEqual(INV.row({ id: "x", group: "files", title: "t", what: "w", link: "https://bad.example/" }).link, "");
});

check("no dollar amounts in any words", () => {
  const money = /\$\s?\d|\d\s?(k|K)\b|\bdollars?\b/;
  D.items.forEach(it => ["title", "what", "from", "note"].forEach(f => assert.ok(!money.test(it[f] || ""), `${it.id}.${f}: ${it[f]}`)));
});

check("Koy gets every row; another admin gets no Shared with me group and no Koy-only row", () => {
  const koy = INV.inventoryFor({ id: "koy" });
  assert.strictEqual(koy.items.length, D.items.length);
  assert.ok(koy.groups.some(g => g.k === "shared"));
  const josh = INV.inventoryFor({ id: "josh" });
  assert.ok(!josh.groups.some(g => g.k === "shared"));
  assert.ok(josh.items.length > 0 && josh.items.every(r => !r.koyOnly && r.group !== "shared"));
  // a shared row is Koy-only even if the data forgets to say so
  assert.ok(INV.row({ id: "s", group: "shared", title: "t", what: "w" }).koyOnly);
  // no viewer at all gets nothing Koy-only either
  assert.ok(INV.inventoryFor(null).items.every(r => !r.koyOnly));
  // no link to a bonus, profit share or pay sheet reaches a non-Koy admin
  assert.ok(josh.items.every(r => !/bonus|profit share/i.test(r.title)));
});

check("not pulled yet: defaults to pulled; false only where the data says so", () => {
  const r = INV.row({ id: "a", group: "files", title: "t", what: "w" });
  assert.strictEqual(r.pulled, true);
  assert.strictEqual(INV.row({ id: "b", group: "files", title: "t", what: "w", pulled: false }).pulled, false);
  assert.ok(D.items.some(it => it.pulled === false));
});

check("the inventory's counts match its Nov 25 check (27 on, 14 off, 10 features)", () => {
  const autos = D.items.filter(it => it.group === "autos");
  assert.strictEqual(autos.filter(a => a.on).length, 27);
  assert.strictEqual(autos.filter(a => !a.on).length, 14); // the Etsy pair is one row; the test probe is left off
  assert.strictEqual(D.items.filter(it => it.group === "app").length, 10);
});

check("claudeWork sends the inventory, built for the caller", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "functions", "index.js"), "utf8");
  assert.ok(/require\("\.\/claudeInventory\.js"\)/.test(src));
  assert.ok(/inventory: _claudeInventory\.inventoryFor\(user\)/.test(src));
});

check("the app shows it in the Claude tab and leaves Koy-only and money rows off in owners' and Foreman view", () => {
  const app = fs.readFileSync(path.join(__dirname, "..", "src", "App.js"), "utf8");
  assert.ok(app.includes('fold("everything", "Everything Claude runs"'));
  assert.ok(app.includes("const hideKoy = !isKoy || claudeOwners, hideMoney = !!fview;"));
  assert.ok(!app.includes("1biUeQIHX15BPIg6LXat2Xlkgk8zmMbqY22uIF3sewPU"), "Profit Share link must stay off the app bundle");
});

console.log(`claude-inventory-test: ${n} checks passed`);
