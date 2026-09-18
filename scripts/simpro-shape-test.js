// Simpro list-shape helper tests — run: node scripts/simpro-shape-test.js (prebuild chain)
"use strict";
const S = require("../functions/simproShape.js");
const assert = require("assert");
const eq = (a, b, msg) => assert.strictEqual(JSON.stringify(a), JSON.stringify(b), msg);
// The bug (2026-09-17): /jobs/?columns=Site returns a STUB {ID, Name}; the old
// code wrote Site.Name into the address, and on this tenant the site name is
// often the job name ("Wise Flooring"). A site name is never an address.
eq(S.candidateSiteInfo({ ID: 6767, Name: "Wise Flooring" }), { address: "", siteId: "6767" }, "stub site -> blank address + siteId to resolve (never Site.Name)");
eq(S.candidateSiteInfo({ ID: 6906, Name: "4641 South Fortuna Way Holladay" }), { address: "", siteId: "6906" }, "even an address-looking site NAME is not used");
eq(S.candidateSiteInfo({ ID: 1, Name: "x", Address: "12 Main St, Draper, UT" }), { address: "12 Main St, Draper, UT", siteId: "1" }, "inline string address wins");
eq(S.candidateSiteInfo({ ID: 2, Address: { Address: "4641 South Fortuna Way", City: "Holladay", State: "UT", PostalCode: "84124", Country: "United States" } }), { address: "4641 South Fortuna Way, Holladay, UT, 84124", siteId: "2" }, "structured address joins Address, City, State, PostalCode");
eq(S.candidateSiteInfo({ ID: 3, Address: { City: "Draper" } }), { address: "Draper", siteId: "3" }, "partial structured address");
eq(S.candidateSiteInfo(null), { address: "", siteId: "" }, "no site");
eq(S.candidateSiteInfo({ Name: "no id" }), { address: "", siteId: "" }, "stub without id");
// The client-side guard for candidates cached by the OLD refresh: an address
// that is just the job name is treated as blank so the auto-pull fills it.
eq(S.importableAddress({ name: "Wise Flooring - Draper", address: "Wise Flooring - Draper" }), "", "address == name -> blank");
eq(S.importableAddress({ name: "Wise Flooring", address: " wise flooring " }), "", "case/space-insensitive");
eq(S.importableAddress({ name: "Wise Flooring", address: "12 Main St" }), "12 Main St", "real address kept");
eq(S.importableAddress({ name: "X", address: "" }), "", "blank stays blank");
eq(S.importableAddress(null), "", "null-safe");
console.log("simpro-shape-test ok");
