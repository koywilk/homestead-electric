// Service size calculation: NEC 220.82 optional method, single-family dwelling, 120/240 V.
// Pure functions only. No React, no DOM, so it can run in the browser, a server, or a test.

export const SIZES = [100, 125, 150, 200, 225, 400, 600];

export const RANGE = { gas: 0, range: 12000, cook_wall: 14400, cook_double: 17600 };
export const RANGE_LABEL = {
  gas: "Gas range",
  range: "Electric / induction range (12 kW)",
  cook_wall: "Cooktop + wall oven (14.4 kW)",
  cook_double: "Cooktop + double oven (17.6 kW)",
  undecided: "Undecided (gas or electric)",
};
export const RANGE_SHORT = { gas: "gas", range: "electric range", cook_wall: "cooktop + wall oven", cook_double: "cooktop + double oven" };
export const DRYER = { gas: 0, elec: 5500 };
export const DRYER_LABEL = { gas: "Gas", elec: "Electric (5.5 kW)", undecided: "Undecided" };
export const WH = { gas: 0, tank: 4500, hpwh: 4500, tankless: 27000 };
export const WH_LABEL = {
  gas: "Gas (tank or tankless)",
  tank: "Electric tank (4.5 kW)",
  hpwh: "Heat pump water heater (4.5 kW)",
  tankless: "Electric tankless (27 kW)",
  undecided: "Undecided (gas or electric tank)",
};
export const HEAT_LABEL = {
  gas: "Gas furnace",
  hp: "Heat pump + electric backup",
  baseboard: "Electric baseboard / resistance",
  undecided: "Undecided (gas or heat pump)",
};
export const COOL_LABEL = { ac: "Central AC", none: "None / mini-splits only" };
export const TIER_LABEL = ["Standard / spec", "Upgraded", "Custom / luxury"];
export const ENUMS = {
  heat: ["gas", "hp", "baseboard", "undecided"],
  cool: ["ac", "none"],
  range: ["gas", "range", "cook_wall", "cook_double", "undecided"],
  dryer: ["gas", "elec", "undecided"],
  wh: ["gas", "tank", "hpwh", "tankless", "undecided"],
};

// g: "appl" = fixed appliance, 220.82(B)(3)
//    "res"  = resistance space heat, 220.82(C) at 65% (40% with 4+ separately controlled units)
//    "hvac" = heat pump that both heats and cools, 220.82(C) at 100%
// qty and st are the defaults for [standard, upgraded, luxury].
export const ITEMS = [
  { cat: "Kitchen", id: "dw2", name: "Second dishwasher", va: 1200, qty: [1, 1, 1], st: ["no", "no", "maybe"], g: "appl" },
  { cat: "Kitchen", id: "warm", name: "Warming drawer", va: 1000, qty: [1, 1, 1], st: ["no", "maybe", "maybe"], g: "appl" },
  { cat: "Kitchen", id: "speed", name: "Speed / steam oven", va: 3000, qty: [1, 1, 1], st: ["no", "no", "maybe"], g: "appl" },
  { cat: "Kitchen", id: "kitchenette", name: "Basement or ADU kitchen", note: '30" range, dishwasher, 2 SA circuits', va: 12200, qty: [1, 1, 1], st: ["no", "maybe", "maybe"], g: "appl" },
  { cat: "EV & garage", id: "ev", name: "EV charger, 48 A", note: "11.5 kW on a 60 A circuit", va: 11520, qty: [1, 1, 1], st: ["maybe", "yes", "yes"], g: "appl" },
  { cat: "EV & garage", id: "ev2", name: "Second EV charger, 48 A", va: 11520, qty: [1, 1, 1], st: ["no", "no", "maybe"], g: "appl" },
  { cat: "EV & garage", id: "garageheat", name: "Garage heater", note: "Counts as space heat", va: 5000, qty: [1, 1, 1], st: ["no", "maybe", "maybe"], g: "res" },
  { cat: "EV & garage", id: "shop", name: "Shop / welder receptacle", note: "50 A, 240 V", va: 9600, qty: [1, 1, 1], st: ["no", "no", "maybe"], g: "appl" },
  { cat: "EV & garage", id: "minisplit", name: "Mini-split heat pump", note: "Bonus room, garage, or ADU", va: 2400, qty: [1, 1, 1], st: ["no", "no", "maybe"], g: "hvac" },
  { cat: "Bath & wellness", id: "floor", name: "Heated bathroom floors", note: "Each thermostat is a separate unit", va: 800, qty: [1, 2, 3], st: ["no", "maybe", "yes"], g: "res" },
  { cat: "Bath & wellness", id: "steam", name: "Steam shower generator", va: 9000, qty: [1, 1, 1], st: ["no", "no", "maybe"], g: "appl" },
  { cat: "Bath & wellness", id: "sauna", name: "Sauna heater", va: 8000, qty: [1, 1, 1], st: ["no", "no", "maybe"], g: "appl" },
  { cat: "Bath & wellness", id: "plunge", name: "Cold plunge chiller", note: "About 1 HP, 240 V", va: 1900, qty: [1, 1, 1], st: ["no", "no", "maybe"], g: "appl" },
  { cat: "Outdoor", id: "hottub", name: "Hot tub", note: "50 A GFCI disconnect", va: 7500, qty: [1, 1, 1], st: ["maybe", "maybe", "yes"], g: "appl" },
  { cat: "Outdoor", id: "swimspa", name: "Swim spa", va: 12000, qty: [1, 1, 1], st: ["no", "no", "maybe"], g: "appl" },
  { cat: "Outdoor", id: "pool", name: "Pool pump + heat pump heater", va: 8000, qty: [1, 1, 1], st: ["no", "no", "maybe"], g: "appl" },
  { cat: "Outdoor", id: "snowmelt", name: "Driveway / walk snowmelt", note: "About 40 W per sq ft", va: 40, unit: "sq ft", qty: [400, 400, 600], st: ["no", "no", "maybe"], g: "appl" },
  { cat: "Site & utility", id: "well", name: "Well pump", note: "1½ HP, 240 V", va: 2400, qty: [1, 1, 1], st: ["no", "no", "no"], g: "appl" },
  { cat: "Site & utility", id: "ejector", name: "Sewage ejector", va: 1200, qty: [1, 1, 1], st: ["no", "no", "no"], g: "appl" },
  { cat: "Site & utility", id: "elevator", name: "Residential elevator", va: 4000, qty: [1, 1, 1], st: ["no", "no", "maybe"], g: "appl" },
];
const ITEM_BY_ID = Object.fromEntries(ITEMS.map((it) => [it.id, it]));

// An item missing from a state (e.g. a record saved before the item was added to ITEMS) counts as "no".
const itemState = (state, it) => state.items?.[it.id] || { va: it.va, qty: it.qty[0], status: "no" };
// Free-form loads that came from another tool (Appliance Loads / Generator Sizing): {id, name, va, qty, status, note}.
const extrasOf = (state) => (Array.isArray(state.extras) ? state.extras : []);

const num = (v, d = 0) => {
  const x = parseFloat(v);
  return Number.isFinite(x) && x >= 0 ? x : d;
};
export const fmt = (n) => Math.round(n).toLocaleString("en-US");

export function autoTons(sqft) {
  return Math.max(2, Math.ceil((sqft / 600) * 2) / 2);
}

export function tierItems(tier) {
  return Object.fromEntries(
    ITEMS.map((it) => [it.id, { va: it.va, qty: it.qty[tier], status: it.st[tier] }])
  );
}

export function defaultState(tier = 1) {
  return {
    job: "",
    sqft: 3200,
    tier,
    sac: [2, 3, 4][tier],
    laundry: 1,
    heat: "gas",
    cool: "ac",
    tonsAuto: true,
    tons: autoTons(3200),
    stripAuto: true,
    strip: 20,
    range: "undecided",
    dryer: "elec",
    dryerQty: 1,
    wh: "gas",
    whQty: 1,
    target: 100, // max % of service the calculated load may use
    sizeFor: "max", // "max" = confirmed + maybes, "base" = confirmed only
    solar: false,
    items: tierItems(tier),
    plan: null, // what was read from plans: {source, areas, findings, questions, notInCalc}
    planFields: [], // state keys filled from plans
    extras: [], // loads from another tool with no fixed item of their own; counted like fixed appliances
    fill: null, // {source, tag, label, at, covered, notes, placed, needVA} when filled from another tool
    fillFields: [], // state keys that fill set
  };
}

// Use for any state that comes from outside (initialState, a saved record): fills in defaults,
// and makes sure every current ITEMS id exists so older records don't break the page.
export function normalizeState(saved = {}) {
  const tier = [0, 1, 2].includes(Number(saved.tier)) ? Number(saved.tier) : 1;
  return {
    ...defaultState(tier),
    ...saved,
    tier,
    items: { ...tierItems(tier), ...(saved.items || {}) },
    plan: saved.plan || null,
    planFields: Array.isArray(saved.planFields) ? saved.planFields : [],
    extras: (Array.isArray(saved.extras) ? saved.extras : []).filter((x) => x && x.id).map((x) => ({
      id: String(x.id), name: String(x.name || "Appliance"), va: num(x.va), qty: num(x.qty, 1) || 1,
      status: ["yes", "maybe", "no"].includes(x.status) ? x.status : "yes", note: String(x.note || ""),
    })),
    fill: saved.fill && typeof saved.fill === "object" ? saved.fill : null,
    fillFields: Array.isArray(saved.fillFields) ? saved.fillFields : [],
  };
}

// Tonnage and strip heat, after the "estimate" checkboxes are applied.
export function effective(state) {
  const sqft = num(state.sqft);
  const tons = state.tonsAuto ? autoTons(sqft) : num(state.tons);
  const systems = Math.max(1, Math.ceil(tons / 5));
  const strip = state.stripAuto ? 10 * systems : num(state.strip);
  return { sqft, tons, systems, strip };
}

// scn: "base" = confirmed only, "max" = confirmed + maybes.
// ov lets a what-if override item statuses ({items: {id: "yes"}}) or selections ({sel: {wh: "tankless"}}).
export function calc(state, scn, ov = {}) {
  const { sqft, tons, systems, strip } = effective(state);
  const sel = { heat: state.heat, range: state.range, dryer: state.dryer, wh: state.wh, ...(ov.sel || {}) };
  const und = (v, b, m) => (v === "undecided" ? (scn === "max" ? m : b) : v);
  const heat = und(sel.heat, "gas", "hp");
  const range = und(sel.range, "gas", "range");
  const dryer = und(sel.dryer, "gas", "elec");
  const wh = und(sel.wh, "gas", "tank");
  const dryerQty = Math.max(1, Math.round(num(state.dryerQty, 1)));
  const whQty = Math.max(1, Math.round(num(state.whQty, 1)));
  const sac = Math.max(2, Math.round(num(state.sac, 2)));
  const laundry = Math.max(1, Math.round(num(state.laundry, 1)));
  const inc = (it) => {
    const st = (ov.items && ov.items[it.id]) || itemState(state, it).status || "no";
    return st === "yes" || (scn === "max" && st === "maybe");
  };

  const r = { heat, range, dryer, wh, dryerQty, whQty, sac, laundry, tons, systems, strip };
  r.general = sqft * 3;
  r.circuits = (sac + laundry) * 1500;
  r.basics = 3600; // dishwasher 1,200 + disposal 900 + built-in microwave 1,500
  r.rangeVA = RANGE[range];
  r.dryerVA = DRYER[dryer] * dryerQty;
  r.whVA = WH[wh] * whQty;
  r.other = 0;
  r.otherList = [];
  let res = 0, resUnits = 0, mini = 0;
  for (const it of ITEMS) {
    if (!inc(it)) continue;
    const s = itemState(state, it);
    const va = num(s.va) * num(s.qty);
    if (it.g === "appl") { r.other += va; r.otherList.push(it.name); }
    else if (it.g === "res") { res += va; resUnits += it.unit ? 1 : num(s.qty); }
    else if (it.g === "hvac") { mini += va; }
  }
  for (const x of extrasOf(state)) {
    const st = (ov.extras && ov.extras[x.id]) || x.status || "yes";
    if (!(st === "yes" || (scn === "max" && st === "maybe"))) continue;
    const va = num(x.va) * (num(x.qty, 1) || 1);
    r.other += va; r.otherList.push(x.name);
  }
  if (heat === "baseboard") { res += sqft * 10; resUnits += Math.max(4, Math.ceil(sqft / 250)); }

  r.B = r.general + r.circuits + r.basics + r.rangeVA + r.dryerVA + r.whVA + r.other;
  r.first = Math.min(r.B, 10000);
  r.rest = 0.4 * Math.max(r.B - 10000, 0);
  r.part1 = r.first + r.rest;

  const comp = tons * 1500, blower = systems * 1000;
  const resFactor = resUnits >= 4 ? 0.4 : 0.65;
  let cool = 0, heatL = 0;
  if (heat === "hp") { cool = comp + blower; heatL = comp + blower + 0.65 * strip * 1000; }
  else {
    if (state.cool === "ac") cool = comp + blower;
    heatL = heat === "gas" ? blower : state.cool === "ac" ? blower : 0;
  }
  heatL += resFactor * res + mini;
  cool += mini;
  r.cool = cool; r.heatL = heatL; r.resFactor = resFactor;
  r.hvac = Math.max(cool, heatL);
  r.hvacWhich = heatL > cool ? "heating" : "cooling";
  r.total = r.part1 + r.hvac;
  r.amps = r.total / 240;
  return r;
}

export function sizeFor(amps, pct = 100) {
  for (const s of SIZES) if (s >= 100 && amps <= s * (pct / 100)) return s;
  return null; // over 600 A
}
export const sizeLabel = (s) => (s === null ? "600+" : String(s));

export function analyze(state) {
  const base = calc(state, "base");
  const max = calc(state, "max");
  const basis = state.sizeFor === "base" ? base : max;
  const target = num(state.target, 100) || 100;
  const rec = sizeFor(basis.amps, target);
  const codeBase = sizeFor(base.amps, 100);
  const codeMax = sizeFor(max.amps, 100);
  const load = rec ? basis.amps / rec : 1.1;

  let status;
  if (!rec) status = { kind: "bad", text: "Over 600 A. Engineer the service." };
  else if (load > 0.9) {
    const next = SIZES[SIZES.indexOf(rec) + 1] ?? null;
    status = { kind: "warn", text: `Tight: ${Math.round(load * 100)}% loaded. Consider ${sizeLabel(next)} A.` };
  } else status = { kind: "ok", text: `${Math.round(load * 100)}% loaded` };

  let headroom = null;
  if (rec) {
    const leftVA = rec * 240 * (target / 100) - basis.total;
    headroom = { amps: leftVA / 240, kw: leftVA / 0.4 / 1000, evs: Math.floor(leftVA / 0.4 / 11520) };
  }

  // Changes that would push the recommended size up (evaluated against the maybes scenario).
  const whatifs = [];
  const cur = sizeFor(max.amps, target);
  const test = (label, ov) => {
    const r = calc(state, "max", ov);
    const s = sizeFor(r.amps, target);
    if ((s ?? 9999) > (cur ?? 9999)) whatifs.push({ label, to: sizeLabel(s), amps: r.amps });
  };
  for (const it of ITEMS) {
    const s = itemState(state, it);
    if (s.status === "no" && num(s.qty) > 0) test(it.name, { items: { [it.id]: "yes" } });
  }
  for (const x of extrasOf(state)) if (x.status === "no" && num(x.va) > 0) test(x.name, { extras: { [x.id]: "yes" } });
  if (max.wh !== "tankless") test("Electric tankless water heater", { sel: { wh: "tankless" } });
  if (max.heat !== "hp") test("Switch to heat pump heating", { sel: { heat: "hp" } });
  if (max.range === "gas" || max.range === "range") test("Cooktop + double oven", { sel: { range: "cook_double" } });
  if (max.dryer === "gas") test("Electric dryer", { sel: { dryer: "elec" } });
  whatifs.sort((a, b) => a.amps - b.amps);

  // Calculated amps each item adds, with maybes included.
  const impacts = {};
  for (const it of ITEMS) {
    const on = calc(state, "max", { items: { [it.id]: "yes" } });
    const off = calc(state, "max", { items: { [it.id]: "no" } });
    impacts[it.id] = on.amps - off.amps;
  }
  for (const x of extrasOf(state)) {
    const on = calc(state, "max", { extras: { [x.id]: "yes" } });
    const off = calc(state, "max", { extras: { [x.id]: "no" } });
    impacts[x.id] = on.amps - off.amps;
  }

  const flags = [];
  if (max.wh === "tankless") flags.push("Whole-house electric tankless is about 27 kW per unit. Confirm it early; it often decides between 200 A and 400 A.");
  if (state.heat === "undecided") flags.push("Heating fuel is undecided. The maybes number assumes a heat pump with backup strips; gas keeps the service smaller.");
  if (rec && rec >= 400) flags.push("Above 225 A means a 320 A class meter and often a bigger transformer or longer utility lead time. Call the utility before you commit to the bid.");
  if (rec === 225) flags.push("225 A usually means a 225 A panel on a 200 A class meter. Check that the utility and meter base allow it.");
  if (state.solar) { const s = rec || 200; flags.push(`Solar: with a ${s} A bus and ${s} A main, the 120% rule allows only ${Math.round(s * 0.2)} A of backfeed. A bigger bus with a smaller main, or a supply-side connection, leaves room.`); }
  if (itemState(state, ITEM_BY_ID.snowmelt).status !== "no") flags.push("Snowmelt loads are large and run for hours. Many jobs put snowmelt on its own service or a separate meter.");
  if (max.amps - base.amps > 60) flags.push(`The maybes add ${Math.round(max.amps - base.amps)} A. Get answers on the biggest ones before you price the service.`);

  return { base, max, basis, rec, codeBase, codeMax, load, status, headroom, whatifs, impacts, flags, target };
}

export function bidNote(state, a) {
  // Lowercase the first letter unless it starts an acronym (EV, ADU).
  const lower = (s) => (/^[A-Z]{2}/.test(s) ? s : s.charAt(0).toLowerCase() + s.slice(1));
  const xs = extrasOf(state);
  const maybes = [...ITEMS.filter((it) => itemState(state, it).status === "maybe").map((it) => it.name), ...xs.filter((x) => x.status === "maybe").map((x) => x.name)].map(lower);
  const yes = [...ITEMS.filter((it) => itemState(state, it).status === "yes").map((it) => it.name), ...xs.filter((x) => x.status === "yes").map((x) => x.name)].map(lower);
  const und = [];
  if (state.heat === "undecided") und.push("heat pump heating");
  if (state.range === "undecided") und.push("electric range");
  if (state.dryer === "undecided") und.push("electric dryer");
  if (state.wh === "undecided") und.push("electric water heater");
  const allow = state.sizeFor === "max" ? [...maybes, ...und] : [];
  const heatTxt = state.heat === "undecided" ? "heating fuel TBD" : lower(HEAT_LABEL[state.heat]);
  const { tons } = effective(state);
  const lines = [
    `SERVICE SIZE: ${state.job || "(job name)"}`,
    `Recommended: ${sizeLabel(a.rec)} A, 120/240 V single-phase`,
    ``,
    `Basis: NEC 220.82 optional dwelling calculation, ${fmt(num(state.sqft))} sq ft, ${heatTxt}${state.heat !== "hp" && state.cool === "ac" ? " with central AC" : ""}, about ${tons} tons.`,
    `Calculated load: ${Math.round(a.base.amps)} A for confirmed items; ${Math.round(a.max.amps)} A with allowances.`,
    ``,
    `Included: ${yes.length ? yes.join(", ") : "standard kitchen and laundry loads"}.`,
  ];
  if (allow.length) lines.push(`Allowances included in this size: ${allow.join(", ")}.`);
  if (state.sizeFor === "base" && (maybes.length || und.length)) lines.push(`NOT included in this size: ${[...maybes, ...und].join(", ")}.`);
  if (a.whatifs.length) lines.push(``, `Would require a larger service if added: ${a.whatifs.slice(0, 5).map((w) => `${lower(w.label)} (${w.to} A)`).join("; ")}.`);
  const out = state.plan?.notInCalc || [];
  if (out.length) lines.push(``, `Not included in this calculation: ${out.slice(0, 6).join("; ")}.`);
  lines.push(``, `Service size to be confirmed once appliance and equipment selections are final. Loads added beyond the above may require a change order.`);
  return lines.join("\n");
}

// Merge what Claude read from the plans (see api/read-plans.js for the JSON shape) into a state.
export function applyPlan(prev, p, source) {
  const tier = [0, 1, 2].includes(Number(p.tier)) ? Number(p.tier) : prev.tier;
  const s = { ...prev, tier, sac: [2, 3, 4][tier], items: tierItems(tier) };
  const fields = [];
  const set = (k, v) => { s[k] = v; fields.push(k); };
  if (p.tier != null) fields.push("tier");
  if (p.job) set("job", String(p.job).slice(0, 80));
  if (num(p.living_sqft) > 0) set("sqft", Math.round(num(p.living_sqft)));
  if (num(p.small_appliance_circuits) >= 2) set("sac", Math.round(num(p.small_appliance_circuits)));
  if (num(p.laundry_circuits) >= 1) set("laundry", Math.round(num(p.laundry_circuits)));
  for (const k of ["heat", "cool", "range", "dryer", "wh"]) if (ENUMS[k].includes(p[k])) set(k, p[k]);
  if (num(p.dryer_qty) >= 1) set("dryerQty", Math.round(num(p.dryer_qty)));
  if (num(p.wh_qty) >= 1) set("whQty", Math.round(num(p.wh_qty)));
  if (num(p.tons) > 0) { s.tonsAuto = false; set("tons", num(p.tons)); } else s.tonsAuto = true;
  s.stripAuto = true;
  const items = p.items && typeof p.items === "object" ? p.items : {};
  for (const [id, v] of Object.entries(items)) {
    if (!ITEM_BY_ID[id] || !v || typeof v !== "object") continue;
    const cur = { ...s.items[id] };
    if (["yes", "maybe", "no"].includes(v.status)) cur.status = v.status;
    if (num(v.qty) > 0) cur.qty = num(v.qty);
    if (num(v.va) > 0) cur.va = Math.round(num(v.va));
    cur.fromPlans = true;
    cur.planNote = v.note ? String(v.note).slice(0, 120) : "";
    s.items[id] = cur;
  }
  const arr = (x, n) => (Array.isArray(x) ? x.slice(0, n) : []);
  s.plan = {
    source: source || "",
    areas: arr(p.areas, 12).map((a) => ({ label: String(a.label ?? ""), sqft: num(a.sqft), estimated: !!a.estimated, counted: a.counted !== false })),
    findings: arr(p.findings, 24).map((f) => ({ what: String(f.what ?? ""), where: String(f.where ?? ""), confidence: ["shown", "implied", "assumed"].includes(f.confidence) ? f.confidence : "assumed" })),
    questions: arr(p.questions, 12).map(String),
    notInCalc: arr(p.not_in_calc, 8).map(String),
  };
  s.planFields = fields;
  return s;
}

// Compact record for saving a job (e.g. to Firestore).
// No undefined values: Firestore rejects them.
export function toRecord(state, a) {
  const { plan, planFields, ...inputs } = state;
  return {
    job: state.job,
    sqft: num(state.sqft),
    recommendedAmps: a.rec,
    confirmedAmps: Math.round(a.base.amps),
    withMaybesAmps: Math.round(a.max.amps),
    sizedFor: state.sizeFor,
    bidNote: bidNote(state, a),
    inputs,
    plan: plan || null,
  };
}
