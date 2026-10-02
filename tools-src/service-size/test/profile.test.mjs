// Run: npm test   (plain Node, no test framework)
// The shared handoff module (public/tools/shared/load-profile.js) and Service Size's profile mapping.
import assert from "node:assert/strict";
import LP from "../../../public/tools/shared/load-profile.js";
import { defaultState, analyze, normalizeState } from "../src/calc.js";
import { applyProfile, toProfile, fillSummary } from "../src/profile.js";

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

// ---- Service Size mapping -------------------------------------------------
const appl = (loads, extra) => ({ v: 1, source: "appliance-loads", at: "2026-10-02T10:00:00Z", label: "#1438 Miller Residence",
  job: { no: "1438", name: "Miller Residence", address: "1 Elm" }, house: null, hvac: null, service: null, sizeFor: null, loads, ...(extra || {}) });
const L = (name, volts, amps, qty = 1, o = {}) => ({ name, kind: "", qty, volts, amps, va: volts && amps ? volts * amps : null, status: "yes", ...o });

test("applyProfile from Appliance Loads: big appliances, items, extras, covered", () => {
  const p = appl([
    L("Kitchen · Induction cooktop", 240, 40), L("Kitchen · Wall oven", 240, 20),
    L("Laundry · Dryer", 240, 24, 2), L("Mech · Tankless water heater", 240, 112),
    L("Garage · EV charger", 240, 48), L("Garage · Tesla Wall Connector", 240, 48),
    L("Kitchen · Refrigerator", 120, 6), L("Kitchen · Dishwasher", 120, 12), L("Pantry · Dishwasher", 120, 12),
    L("Studio · Kiln", 240, 40), L("Garage · Unit heater", null, null),
    L("Mech · AC condenser", 240, 35), L("Driveway · Snowmelt", 240, 50),
  ]);
  const s = applyProfile(defaultState(), p);
  assert.equal(s.job, "Miller Residence");
  assert.equal(s.range, "cook_wall"); assert.equal(s.dryer, "elec"); assert.equal(s.dryerQty, 2);
  assert.equal(s.wh, "tankless"); assert.equal(s.whQty, 1);
  assert.equal(s.cool, "ac"); assert.equal(s.heat, defaultState().heat, "no heat pump seen: heating untouched");
  assert.equal(s.items.ev.status, "yes"); assert.equal(s.items.ev.va, 11520); assert.equal(s.items.ev2.status, "yes");
  assert.equal(s.items.dw2.status, "yes"); assert.equal(s.items.dw2.qty, 1);
  assert.equal(s.items.garageheat.status, "yes"); assert.equal(s.items.garageheat.va, 5000, "no amps on the sheet: keeps the default VA");
  assert.equal(s.items.snowmelt.status, "yes"); assert.equal(s.items.snowmelt.qty, 300); assert.equal(s.items.snowmelt.va, 40);
  assert.ok(s.items.ev.fromFill && /Appliance Loads/.test(s.items.ev.fillNote));
  assert.equal(s.extras.length, 1); assert.equal(s.extras[0].name, "Studio · Kiln"); assert.equal(s.extras[0].va, 9600); assert.equal(s.extras[0].status, "yes");
  assert.deepEqual(s.fill.covered, ["Kitchen · Refrigerator", "Kitchen · Dishwasher"]);
  assert.equal(s.fill.tag, "loads");
  for (const k of ["job", "range", "dryer", "dryerQty", "wh", "whQty", "cool"]) assert.ok(s.fillFields.includes(k), k);
  assert.ok(!s.fillFields.includes("sqft"), "no house data in an appliance profile");
  assert.ok(fillSummary(s).includes("1 added under Extras"), fillSummary(s));
  assert.doesNotThrow(() => analyze(s));
});

test("applyProfile: an unknown load with no amps becomes an extra that needs VA, never dropped", () => {
  const s = applyProfile(defaultState(), appl([L("Studio · Kiln", null, null)]));
  assert.equal(s.extras.length, 1); assert.equal(s.extras[0].va, 0); assert.equal(s.extras[0].note, "needs VA");
  assert.ok(fillSummary(s).includes("1 need VA"), fillSummary(s));
});

test("applyProfile twice: the second fill owns the tags, statuses from the first stay", () => {
  const first = applyProfile(defaultState(), appl([L("Patio · Hot tub", 240, 40)]));
  const second = applyProfile(first, appl([L("Basement · Sauna", 240, 30)], { label: "#1439 Other" }));
  assert.equal(second.items.hottub.status, "yes"); assert.ok(!second.items.hottub.fromFill);
  assert.ok(second.items.sauna.fromFill); assert.equal(second.fill.label, "#1439 Other");
});

test("applyProfile from Generator Sizing: house inputs land, items by preset kind, heat pump sets heating", () => {
  const PRESETS = { ac:{name:"A/C",va:6000,motor:true,surge:3,category:"cooling"}, heatpump:{name:"Heat pump",va:7200,motor:true,surge:3,category:"heating"},
    wh:{name:"WH",va:4500,motor:false,surge:1,category:"general"}, range:{name:"Range",va:8000,motor:false,surge:1,category:"general"},
    dryer:{name:"Dryer",va:5500,motor:true,surge:1.2,category:"general"}, pool:{name:"Pool",va:2000,motor:true,surge:3,category:"general"},
    evse:{name:"EV",va:11520,motor:false,surge:1,category:"general"} };
  const rows = [
    { ...PRESETS.heatpump, key: "heatpump", qty: 1 }, { ...PRESETS.wh, key: "wh", qty: 2 }, { ...PRESETS.range, key: "range", qty: 1 },
    { ...PRESETS.dryer, key: "dryer", qty: 1 }, { ...PRESETS.pool, key: "pool", qty: 1 }, { ...PRESETS.evse, key: "evse", qty: 1 },
  ];
  const p = LP.fromGeneratorRows(rows, { sqft: 6000, sac: 3, laundry: 2, svcA: 200, jobCust: "Miller", jobAddr: "" });
  const s = applyProfile(defaultState(), p);
  assert.equal(s.sqft, 6000); assert.equal(s.sac, 3); assert.equal(s.laundry, 2);
  assert.equal(s.heat, "hp"); assert.equal(s.wh, "tank"); assert.equal(s.whQty, 2); assert.equal(s.range, "range"); assert.equal(s.dryer, "elec");
  assert.equal(s.items.pool.status, "yes"); assert.equal(s.items.ev.status, "yes"); assert.equal(s.fill.tag, "generator");
  assert.deepEqual(s.extras, []);
});

test("toProfile → toGeneratorRows: HVAC, big appliances, items and extras become generator rows; maybes follow sizeFor", () => {
  const base = { ...defaultState(2), job: "Miller", sqft: 8000, heat: "hp", range: "cook_double", dryer: "elec", dryerQty: 2, wh: "tankless", sizeFor: "max",
    extras: [{ id: "x1", name: "Studio kiln", va: 9600, qty: 1, status: "yes", note: "" }] };
  const s = normalizeState({ ...base, items: { ...base.items, ev: { va: 11520, qty: 1, status: "yes" }, hottub: { va: 7500, qty: 1, status: "maybe" }, snowmelt: { va: 40, qty: 600, status: "yes" } } });
  const a = analyze(s);
  const p = toProfile(s, a);
  assert.equal(p.source, "service-size"); assert.deepEqual(p.service, a.rec ? { amps: a.rec } : null); assert.equal(p.sizeFor, "max");
  const d = defaultState(); const ad = analyze(d);
  assert.ok(ad.rec > 0); assert.deepEqual(toProfile(d, ad).service, { amps: ad.rec }, "a standard house carries its recommended size");
  assert.deepEqual(p.house, { sqft: 8000, sac: 4, laundry: 1 });
  assert.equal(p.hvac.heat, "hp"); assert.equal(p.hvac.cool, "ac");
  const hp = p.loads.find((l) => l.kind === "heatpump"); assert.ok(hp && hp.motor && hp.va > 0);
  assert.ok(p.loads.find((l) => l.kind === "electricheat" && /strip/i.test(l.name)));
  assert.ok(p.loads.find((l) => l.kind === "wh_tankless" && l.va === 27000));
  assert.ok(p.loads.find((l) => l.kind === "dryer" && l.qty === 2));
  assert.ok(p.loads.find((l) => l.kind === "range" && l.va === 17600));
  assert.ok(p.loads.find((l) => l.kind === "snowmelt" && l.va === 24000 && l.qty === 1));
  assert.ok(p.loads.find((l) => l.kind === "hottub" && l.status === "maybe"));
  assert.ok(p.loads.find((l) => l.kind === "other" && l.name === "Studio kiln"));
  const PRESETS = { heatpump:{name:"Heat pump",va:7200,motor:true,surge:3,category:"heating"}, electricheat:{name:"Heat",va:10000,motor:false,surge:1,category:"heating"},
    tankless:{name:"Tankless",va:27000,motor:false,surge:1,category:"general"}, dryer:{name:"Dryer",va:5500,motor:true,surge:1.2,category:"general"},
    walloven:{name:"Wall oven",va:4000,motor:false,surge:1,category:"general"}, cooktop:{name:"Cooktop",va:6000,motor:false,surge:1,category:"general"},
    range:{name:"Range",va:8000,motor:false,surge:1,category:"general"}, snowmelt:{name:"Snowmelt",va:12000,motor:false,surge:1,category:"heating"},
    evse:{name:"EV",va:11520,motor:false,surge:1,category:"general"}, pool:{name:"Pool",va:2000,motor:true,surge:3,category:"general"},
    generic:{name:"Other",va:1500,motor:false,surge:1,category:"general"}, generic_motor:{name:"Motor",va:1500,motor:true,surge:3,category:"general"} };
  const g = LP.toGeneratorRows(p, PRESETS);
  assert.equal(g.rows.find((r) => /hot tub/i.test(r.name)).flag, "maybe");
  assert.equal(g.rows.find((r) => r.name === "Studio kiln").key, "generic");
  const g2 = LP.toGeneratorRows({ ...p, sizeFor: "base" }, PRESETS);
  assert.ok(!g2.rows.find((r) => /hot tub/i.test(r.name)));
});

console.log(`\n${n} tests passed`);
