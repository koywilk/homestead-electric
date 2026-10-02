// Service Size ↔ the shared load profile (public/tools/shared/load-profile.js).
// Pure functions: a profile in, a state out, and back. No DOM, no storage.
// The profile is how the three Tools fill each other (2026-10-02).
import LP from "../../../public/tools/shared/load-profile.js";
import { ITEMS, RANGE, RANGE_LABEL, WH_LABEL, effective, normalizeState } from "./calc.js";

export { LP };
export const SOURCE = "service-size";
const TAG = { "appliance-loads": "loads", "generator-sizing": "generator", "service-size": "service" };

const num = (v, d = 0) => { const x = parseFloat(v); return Number.isFinite(x) && x > 0 ? x : d; };
const ITEM_BY_ID = Object.fromEntries(ITEMS.map((it) => [it.id, it]));

// kind → Extras item id. Kinds not listed go to the big-appliance / HVAC selects,
// to the free-form extras, or to "covered by the standard allowances".
const KIND_ITEM = { ev: "ev", hottub: "hottub", swimspa: "swimspa", pool: "pool", steam: "steam", sauna: "sauna", plunge: "plunge",
  snowmelt: "snowmelt", wellpump: "well", sump: "ejector", elevator: "elevator", floorheat: "floor", shop: "shop", minisplit: "minisplit",
  warm: "warm", speed: "speed" };
// Item id → kind, for toProfile.
const ITEM_KIND = { ev: "ev", ev2: "ev", hottub: "hottub", swimspa: "swimspa", pool: "pool", steam: "steam", sauna: "sauna", plunge: "plunge",
  snowmelt: "snowmelt", well: "wellpump", ejector: "sump", elevator: "elevator", floor: "floorheat", shop: "shop", minisplit: "minisplit",
  warm: "warm", speed: "speed", garageheat: "electricheat", dw2: "dishwasher", kitchenette: "other" };
const MOTOR_KINDS = ["pool", "hottub", "swimspa", "plunge", "wellpump", "sump", "elevator", "heatpump", "minisplit", "ac"];

const vaText = (l) => (l.volts && l.amps ? `${l.volts} V × ${l.amps} A` : "");

// Merge a profile from Appliance Loads or Generator Sizing into a state.
export function applyProfile(prev, p) {
  const s = normalizeState({ ...prev, items: { ...prev.items } });
  // A fresh fill owns the tags: clear the previous fill's marks (statuses stay).
  for (const id of Object.keys(s.items)) { const { fromFill, fillNote, ...rest } = s.items[id]; void fromFill; void fillNote; s.items[id] = rest; }
  const src = p.source;
  const from = LP.SOURCES[src] || "another tool";
  const fields = [];
  const set = (k, v) => { s[k] = v; fields.push(k); };
  const covered = [], notes = [];

  if (p.job && p.job.name) set("job", String(p.job.name).slice(0, 80));
  if (p.house) {
    if (num(p.house.sqft) > 0) set("sqft", Math.round(num(p.house.sqft)));
    if (num(p.house.sac) >= 2) set("sac", Math.round(num(p.house.sac)));
    if (num(p.house.laundry) >= 1) set("laundry", Math.round(num(p.house.laundry)));
  }
  if (p.hvac) {
    if (["gas", "hp", "baseboard", "undecided"].includes(p.hvac.heat)) set("heat", p.hvac.heat);
    if (["ac", "none"].includes(p.hvac.cool)) set("cool", p.hvac.cool);
    if (num(p.hvac.tons) > 0) { s.tonsAuto = false; set("tons", num(p.hvac.tons)); }
  }

  const loads = (p.loads || []).filter(Boolean).map((l) => ({
    ...l, name: String(l.name || "Appliance"), kind: l.kind || LP.classify(l.name, l),
    va: num(l.va) || LP.vaOf(l) || 0, qty: Math.max(1, Math.round(num(l.qty) || 1)),
  }));
  const by = (k) => loads.filter((l) => l.kind === k);
  const count = (k) => by(k).reduce((n, l) => n + l.qty, 0);
  const sumVA = (ls) => ls.reduce((n, l) => n + l.va * l.qty, 0);

  // Cooking
  const hasRange = by("range").length > 0, hasTop = by("cooktop").length > 0, hasDbl = by("doubleoven").length > 0, hasWall = by("walloven").length > 0;
  if (hasRange) set("range", "range");
  else if (hasTop && hasDbl) set("range", "cook_double");
  else if (hasTop && hasWall) set("range", "cook_wall");
  else if (hasTop || hasWall || hasDbl) { set("range", "range"); notes.push(`Only a ${hasTop ? "cooktop" : "wall oven"} was listed; counted as a 12 kW range.`); }
  // Dryer
  const dryers = count("dryer");
  if (dryers) { set("dryer", "elec"); set("dryerQty", dryers); }
  // Water heater: tankless wins, then heat pump, then tank; count every unit
  const nTankless = count("wh_tankless"), nHpwh = count("wh_hpwh"), nTank = count("wh_tank");
  if (nTankless + nHpwh + nTank) { set("wh", nTankless ? "tankless" : nHpwh ? "hpwh" : "tank"); set("whQty", nTankless + nHpwh + nTank); }
  // HVAC from the loads, only when the profile carried no explicit hvac block
  if (!p.hvac) {
    const hasHP = by("heatpump").length > 0;
    if (hasHP) set("heat", "hp");
    else if (by("ac").length) set("cool", "ac");
    const eh = by("electricheat").filter((l) => !/garage/i.test(l.name));
    if (eh.length && !hasHP) { set("heat", "baseboard"); notes.push("Electric heat was listed; heating set to electric resistance."); }
  }

  // Items
  const items = { ...s.items };
  const putItem = (id, l, patch) => {
    const it = ITEM_BY_ID[id]; if (!it) return;
    const cur = { ...(items[id] || { va: it.va, qty: it.qty[0], status: "no" }) };
    items[id] = { ...cur, status: l.status === "maybe" ? "maybe" : "yes", fromFill: true,
      fillNote: `From ${from}: ${l.name}${vaText(l) ? " · " + vaText(l) : ""}`, ...patch };
  };
  const units = (ls) => ls.flatMap((l) => Array.from({ length: l.qty }, () => l));
  const evs = units(by("ev"));
  if (evs[0]) putItem("ev", evs[0], evs[0].va ? { va: evs[0].va, qty: 1 } : { qty: 1 });
  if (evs[1]) putItem("ev2", evs[1], evs[1].va ? { va: evs[1].va, qty: 1 } : { qty: 1 });
  const dws = units(by("dishwasher"));
  if (dws[1]) putItem("dw2", dws[1], dws[1].va ? { va: dws[1].va, qty: dws.length - 1 } : { qty: dws.length - 1 });
  const gh = by("electricheat").filter((l) => /garage/i.test(l.name));
  if (gh.length) { const va = sumVA(gh), qty = gh.reduce((n, l) => n + l.qty, 0); putItem("garageheat", gh[0], va ? { va: Math.round(va / qty), qty } : { qty }); }
  for (const [kind, id] of Object.entries(KIND_ITEM)) {
    if (kind === "ev") continue;
    const ls = by(kind); if (!ls.length) continue;
    const va = sumVA(ls), qty = ls.reduce((n, l) => n + l.qty, 0), l = ls[0];
    if (id === "snowmelt") putItem(id, l, va ? { va: 40, qty: Math.max(1, Math.round(va / 40)) } : {});
    else putItem(id, l, va ? { va: Math.round(va / qty), qty } : { qty });
  }
  s.items = items;

  // Extras (no fixed row of their own) and covered (inside the standard allowances)
  const firstDW = loads.findIndex((l) => l.kind === "dishwasher");
  const extras = [];
  loads.forEach((l, i) => {
    if (l.kind === "covered" || l.kind === "airhandler" || l.kind === "garage" || (l.kind === "dishwasher" && i === firstDW)) { covered.push(l.name); return; }
    if (l.kind === "other" || l.kind === "booster") {
      extras.push({ id: `x_${src}_${i}`, name: l.name, va: Math.round(l.va), qty: l.qty, status: l.status === "maybe" ? "maybe" : "yes", note: l.va ? vaText(l) : "needs VA" });
    }
  });
  s.extras = extras;
  s.fill = { source: src, tag: TAG[src] || "tool", label: p.label || from, at: p.at || new Date().toISOString(), covered, notes,
    placed: loads.length - covered.length - extras.length, needVA: extras.filter((x) => !x.va).length };
  s.fillFields = fields;
  return s;
}

// One line for the status area after a fill.
export function fillSummary(s) {
  const f = s.fill; if (!f) return "";
  const parts = [`${f.placed} placed`];
  if (s.extras.length) parts.push(`${s.extras.length} added under Extras`);
  if (f.needVA) parts.push(`${f.needVA} need VA`);
  if (f.covered.length) parts.push(`${f.covered.length} covered by the standard allowances`);
  return `Filled from ${LP.SOURCES[f.source] || f.source} (${f.label}): ${parts.join(", ")}.${f.notes.length ? " " + f.notes.join(" ") : ""}`;
}

// Service Size state → profile (for the generator). HVAC VA uses the same figures the calc uses.
export function toProfile(state, a) {
  const { sqft, tons, systems, strip } = effective(state);
  const loads = [];
  const push = (kind, name, va, qty, status, motor) => loads.push({ name, model: "", kind, qty: qty || 1, volts: null, amps: null,
    va: Math.round(va) || null, motor: !!motor, status: status || "yes", note: "" });
  const und = (v) => v === "undecided";
  const comp = tons * 1500 + systems * 1000;
  if (state.heat === "hp" || und(state.heat)) {
    push("heatpump", "Heat pump", comp, 1, und(state.heat) ? "maybe" : "yes", true);
    push("electricheat", "Backup heat strips", strip * 1000, 1, und(state.heat) ? "maybe" : "yes", false);
  } else {
    if (state.cool === "ac") push("ac", "Central AC", comp, 1, "yes", true);
    if (state.heat === "baseboard") push("electricheat", "Electric resistance heat", sqft * 10, 1, "yes", false);
  }
  if (state.range !== "gas") { const r = und(state.range) ? "range" : state.range; push("range", RANGE_LABEL[r], RANGE[r], 1, und(state.range) ? "maybe" : "yes", false); }
  if (state.dryer !== "gas") push("dryer", "Electric dryer", 5500, Math.max(1, Math.round(num(state.dryerQty, 1))), und(state.dryer) ? "maybe" : "yes", true);
  if (state.wh !== "gas") {
    const w = und(state.wh) ? "tank" : state.wh;
    push(w === "tankless" ? "wh_tankless" : w === "hpwh" ? "wh_hpwh" : "wh_tank", WH_LABEL[w], w === "tankless" ? 27000 : 4500,
      Math.max(1, Math.round(num(state.whQty, 1))), und(state.wh) ? "maybe" : "yes", false);
  }
  for (const it of ITEMS) {
    const st = state.items?.[it.id]; if (!st || st.status === "no") continue;
    const va = num(st.va) * num(st.qty, 1);
    if (!va) continue;
    const kind = ITEM_KIND[it.id] || "other";
    const motor = MOTOR_KINDS.includes(kind);
    if (it.unit || it.id === "floor") push(kind, it.name, va, 1, st.status, motor);
    else push(kind, it.name, num(st.va), Math.max(1, Math.round(num(st.qty, 1))), st.status, motor);
  }
  for (const x of state.extras || []) { if (x.status === "no" || !num(x.va)) continue; push(LP.classify(x.name, x), x.name, num(x.va), Math.max(1, Math.round(num(x.qty, 1))), x.status, false); }
  const name = String(state.job || "").trim();
  return { v: 1, source: SOURCE, at: new Date().toISOString(), label: `${name || "Service Size"} · ${a.rec ? a.rec + " A" : "600+ A"}`,
    job: { no: "", name, address: "" }, house: { sqft, sac: Math.round(num(state.sac, 2)), laundry: Math.round(num(state.laundry, 1)) },
    hvac: { heat: state.heat, cool: state.heat === "hp" ? "ac" : state.cool, tons }, service: a.rec ? { amps: a.rec } : null,
    sizeFor: state.sizeFor === "base" ? "base" : "max", loads };
}
