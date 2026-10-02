// Run: npm test   (plain Node, no test framework)
// The shared handoff module (public/tools/shared/load-profile.js) and Service Size's profile mapping.
import assert from "node:assert/strict";
import LP from "../../../public/tools/shared/load-profile.js";

let n = 0;
const test = (name, fn) => { fn(); n++; console.log("ok -", name); };

test("classify: sheet-style names land on the right kind", () => {
  const cases = [
    ["Laundry · LG Wash Tower", "dryer"], ["Laundry · Gas dryer", "covered"], ["Laundry · Washer", "covered"],
    ["Kitchen · Wolf 48\" Dual Fuel Range", "range"], ["Kitchen · Induction cooktop", "cooktop"],
    ["Kitchen · Double wall oven", "doubleoven"], ["Kitchen · Wall oven", "walloven"], ["Kitchen · Speed oven", "speed"],
    ["Kitchen · Sub-Zero refrigerator", "covered"], ["Kitchen · Microwave drawer", "speed"], ["Kitchen · Warming drawer", "warm"],
    ["Kitchen · Dishwasher", "dishwasher"], ["Garage · Tesla Wall Connector", "ev"], ["Garage · EV charger", "ev"],
    ["Mech · Rinnai tankless water heater", "wh_tankless"], ["Mech · Heat pump water heater", "wh_hpwh"], ["Mech · 50 gal water heater", "wh_tank"],
    ["Mech · AC condenser", "ac"], ["Mech · Heat pump", "heatpump"], ["Bonus · Mini split", "minisplit"], ["Mech · Furnace", "airhandler"],
    ["Garage · Unit heater", "electricheat"], ["Primary bath · Floor heat", "floorheat"], ["Driveway · Snowmelt", "snowmelt"],
    ["Basement · Steam shower generator", "steam"], ["Basement · Sauna", "sauna"], ["Basement · Cold plunge", "plunge"],
    ["Patio · Hot tub", "hottub"], ["Patio · Swim spa", "swimspa"], ["Yard · Pool pump", "pool"],
    ["Site · Well pump", "wellpump"], ["Basement · Sewage ejector", "sump"], ["Mech · Recirc pump", "booster"],
    ["Hall · Elevator", "elevator"], ["Garage · Door opener", "garage"], ["Shop · Welder", "shop"], ["Studio · Kiln", "other"],
  ];
  for (const [name, kind] of cases) assert.equal(LP.classify(name, {}), kind, name);
});

test("classify: a water heater over 15 kVA is tankless; motor words make an unknown load a motor", () => {
  assert.equal(LP.classify("Mech · Water heater", { va: 27000 }), "wh_tankless");
  assert.equal(LP.classify("Mech · Water heater", { volts: 240, amps: 112 }), "wh_tankless");
  assert.equal(LP.kindInfo("other").motorIf.test("Studio · Vacuum pump"), true);
  assert.equal(LP.kindInfo("other").motorIf.test("Studio · Kiln"), false);
});

test("vaOf: volts × amps, null when either is missing", () => {
  assert.equal(LP.vaOf({ volts: 240, amps: 24 }), 5760);
  assert.equal(LP.vaOf({ volts: null, amps: 24 }), null);
  assert.equal(LP.vaOf({ volts: 240, amps: 0 }), null);
  assert.equal(LP.vaOf({ volts: "240", amps: "12.5" }), 3000);
});

const PRESETS = {
  ac:{name:"A/C condenser (2–3 ton)",va:6000,motor:true,surge:3,category:"cooling"},
  ac_large:{name:"A/C condenser (4–5 ton)",va:9600,motor:true,surge:3,category:"cooling"},
  heatpump:{name:"Heat pump",va:7200,motor:true,surge:3,category:"heating"},
  wh:{name:"Electric water heater",va:4500,motor:false,surge:1,category:"general"},
  tankless:{name:"Electric tankless WH",va:27000,motor:false,surge:1,category:"general"},
  dryer:{name:"Electric dryer",va:5500,motor:true,surge:1.2,category:"general"},
  range:{name:"Range / oven",va:8000,motor:false,surge:1,category:"general"},
  evse:{name:"EV charger (48A)",va:11520,motor:false,surge:1,category:"general"},
  pool:{name:"Pool / spa pump",va:2000,motor:true,surge:3,category:"general"},
  generic_motor:{name:"Other motor",va:1500,motor:true,surge:3,category:"general"},
  generic:{name:"Other resistive load",va:1500,motor:false,surge:1,category:"general"},
};

test("toGeneratorRows: real VA wins, missing VA uses the preset and is flagged, covered rows are skipped, maybes follow sizeFor", () => {
  const profile = { v: 1, source: "appliance-loads", at: "2026-10-02T10:00:00Z", label: "#1438 Miller", job: { no: "1438", name: "Miller", address: "" },
    house: null, hvac: null, service: null, sizeFor: null,
    loads: [
      { name: "Laundry · Dryer", kind: "", qty: 2, volts: 240, amps: 24, va: 5760, status: "yes" },
      { name: "Mech · AC condenser", kind: "", qty: 1, volts: 240, amps: 40, va: 9600, status: "yes" },
      { name: "Kitchen · Refrigerator", kind: "", qty: 1, volts: 120, amps: 6, va: 720, status: "yes" },
      { name: "Garage · EV charger", kind: "", qty: 1, volts: null, amps: null, va: null, status: "yes" },
      { name: "Patio · Hot tub", kind: "hottub", qty: 1, volts: 240, amps: 40, va: 9600, status: "maybe" },
      { name: "Studio · Vacuum pump", kind: "", qty: 1, volts: 240, amps: 10, va: 2400, status: "yes" },
    ] };
  const r = LP.toGeneratorRows(profile, PRESETS);
  assert.deepEqual(r.skipped, ["Kitchen · Refrigerator"]);
  assert.equal(r.typical, 1);
  const by = Object.fromEntries(r.rows.map((x) => [x.name, x]));
  assert.equal(by["Laundry · Dryer"].va, 5760); assert.equal(by["Laundry · Dryer"].qty, 2); assert.equal(by["Laundry · Dryer"].key, "dryer");
  assert.equal(by["Laundry · Dryer"].category, "general"); assert.equal(by["Laundry · Dryer"].soft, false);
  assert.equal(by["Mech · AC condenser"].key, "ac_large"); assert.equal(by["Mech · AC condenser"].motor, true); assert.equal(by["Mech · AC condenser"].category, "cooling");
  assert.equal(by["Garage · EV charger"].va, 11520); assert.equal(by["Garage · EV charger"].flag, "typical VA");
  assert.equal(by["Studio · Vacuum pump"].key, "generic_motor"); assert.equal(by["Studio · Vacuum pump"].motor, true);
  assert.ok(!by["Patio · Hot tub"], "maybe is left out unless the profile sizes for maybes");
  const r2 = LP.toGeneratorRows({ ...profile, sizeFor: "max" }, PRESETS);
  const tub = r2.rows.find((x) => x.name === "Patio · Hot tub");
  assert.equal(tub.flag, "maybe"); assert.equal(tub.key, "pool"); assert.equal(tub.va, 9600);
});

test("fromGeneratorRows: preset keys keep their kind, names classify otherwise, inputs become house/service/job", () => {
  const rows = [
    { key: "wh", name: "Electric water heater", va: 4500, qty: 2, motor: false },
    { key: "", name: "Studio kiln", va: 9600, qty: 1, motor: false },
    { key: "evse", name: "EV charger (48A)", va: 11520, qty: 1, motor: false, flag: "maybe" },
  ];
  const p = LP.fromGeneratorRows(rows, { sqft: 6000, sac: 3, laundry: 2, svcA: 200, jobCust: "Miller", jobAddr: "1 Elm" });
  assert.equal(p.source, "generator-sizing");
  assert.deepEqual(p.house, { sqft: 6000, sac: 3, laundry: 2 });
  assert.deepEqual(p.service, { amps: 200 });
  assert.equal(p.job.name, "Miller"); assert.equal(p.job.address, "1 Elm");
  assert.equal(p.loads[0].kind, "wh_tank"); assert.equal(p.loads[0].qty, 2);
  assert.equal(p.loads[1].kind, "other");
  assert.equal(p.loads[2].kind, "ev"); assert.equal(p.loads[2].status, "maybe");
  assert.equal(p.label, "Miller · 3 loads");
  assert.equal(p.sizeFor, "max");
});

test("ago: minutes, hours, days", () => {
  const now = Date.parse("2026-10-02T12:00:00Z");
  assert.equal(LP.ago("2026-10-02T11:59:30Z", now), "just now");
  assert.equal(LP.ago("2026-10-02T11:40:00Z", now), "20 min ago");
  assert.equal(LP.ago("2026-10-02T09:00:00Z", now), "3 h ago");
  assert.equal(LP.ago("2026-09-30T09:00:00Z", now), "2 d ago");
  assert.equal(LP.ago("garbage", now), "");
});

test("storage: no localStorage in Node means empty profiles and a false write, never a throw", () => {
  assert.deepEqual(LP.readProfiles(), {});
  assert.equal(LP.writeProfile({ source: "service-size" }), false);
  assert.equal(LP.isVisible("generator-sizing"), true);
  assert.equal(LP.isVisible("service-size"), false);
});

console.log(`\n${n} tests passed`);
