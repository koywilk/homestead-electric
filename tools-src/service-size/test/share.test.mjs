// Run: npm test   (plain Node, no test framework)
// The print link (v502): the calculator's state travels in #s=… and comes back whole.
import assert from "node:assert/strict";
import { defaultState, normalizeState, analyze } from "../src/calc.js";
import { applyProfile } from "../src/profile.js";
import { encodeState, encodeStateSync, decodeState, parsePrintHash, buildPrintUrl } from "../src/share.js";

let n = 0;
const test = async (name, fn) => { await fn(); n++; console.log("ok -", name); };

const big = applyProfile(defaultState(2), { v: 1, source: "appliance-loads", at: "2026-10-02T10:00:00Z", label: "#1438 Miller Residence",
  job: { no: "1438", name: "Miller Residence - Alpine", address: "1732 East Elk Ridge Lane" }, house: { sqft: 17000, sac: 0, laundry: 0 }, hvac: null, service: null, sizeFor: null,
  loads: Array.from({ length: 130 }, (_, i) => ({ name: i % 7 === 0 ? `Sauna ${i}` : `Bedroom ${i} lights`, kind: "", qty: 1, volts: 120, amps: null, va: null, status: "yes", confidence: "none" })) });

await test("compressed round trip keeps the state whole and much shorter than JSON", async () => {
  const enc = await encodeState(big);
  assert.equal(enc[0], "z");
  assert.ok(enc.length < JSON.stringify(big).length, `compressed ${enc.length} should be shorter than json ${JSON.stringify(big).length}`);
  assert.ok(/^[A-Za-z0-9_-]+$/.test(enc), "url-safe");
  const back = await decodeState(enc);
  assert.deepEqual(back, JSON.parse(JSON.stringify(big)));
  assert.equal(analyze(normalizeState(back)).rec, analyze(big).rec);
});

await test("plain round trip (no CompressionStream) also works", async () => {
  const enc = encodeStateSync(big);
  assert.equal(enc[0], "j");
  const back = await decodeState(enc);
  assert.equal(back.job, big.job); assert.equal(back.sqft, 17000); assert.equal(Object.keys(back.items).length, Object.keys(big.items).length);
});

await test("garbage decodes to null, never throws", async () => {
  assert.equal(await decodeState(""), null);
  assert.equal(await decodeState("zNOTBASE64!!"), null);
  assert.equal(await decodeState("j" + Buffer.from("[1,2]").toString("base64url")), null, "an array is not a state");
});

await test("hash parsing and the print url", async () => {
  assert.deepEqual(parsePrintHash("#s=zABC&print=office"), { s: "zABC", print: "office" });
  assert.deepEqual(parsePrintHash("#s=zABC&print=customer"), { s: "zABC", print: "customer" });
  assert.deepEqual(parsePrintHash("#s=zABC"), { s: "zABC", print: "" });
  assert.deepEqual(parsePrintHash(""), { s: "", print: "" });
  assert.equal(buildPrintUrl("/tools/service-size/", "zABC", "office"), "/tools/service-size/#s=zABC&print=office");
  assert.equal(buildPrintUrl("/tools/service-size/", "zABC", "weird"), "/tools/service-size/#s=zABC&print=customer");
});

console.log(`\n${n} tests passed`);
