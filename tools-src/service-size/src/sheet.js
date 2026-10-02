// Printable sheets for Service Size (v501): the customer copy (the size and why,
// in plain words, no price) and the office copy (everything). Pure: state and
// analysis in, rows and lines out. No DOM, so the tests can run it in Node.
import { ITEMS, SIZES, RANGE_LABEL, RANGE_SHORT, WH_LABEL, HEAT_LABEL, effective, sizeLabel, bidNote } from "./calc.js";

const num = (v, d = 0) => { const x = parseFloat(v); return Number.isFinite(x) && x >= 0 ? x : d; };
const lower = (s) => (/^[A-Z]{2}/.test(s) ? s : s.charAt(0).toLowerCase() + s.slice(1));
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// Items and extras that are still guesses: no nameplate (typical value), a sheet
// spec the sheet itself could not confirm, or an extra with no VA at all.
export function estimates(state) {
  const out = [];
  for (const it of ITEMS) {
    const st = state.items?.[it.id];
    if (!st || st.status === "no" || !st.fromFill) continue;
    const note = String(st.fillNote || "");
    if (/^Confirm spec/.test(note)) out.push({ name: it.name, why: "spec to confirm" });
    else if (!/ V × /.test(note)) out.push({ name: it.name, why: "typical value" });
  }
  for (const x of state.extras || []) {
    if (x.status === "no") continue;
    if (!num(x.va)) out.push({ name: x.name, why: "needs VA" });
    else if (/^confirm spec/.test(String(x.note || ""))) out.push({ name: x.name, why: "spec to confirm" });
  }
  return out;
}

// Where an item's number came from, for the office copy.
export function sourceOf(st, fill) {
  if (!st) return "";
  if (st.fromPlans) return "plans";
  if (st.fromFill) {
    const note = String(st.fillNote || "");
    const tag = (fill && fill.tag) || "tool";
    if (/^Confirm spec/.test(note)) return `${tag} · confirm spec`;
    if (!/ V × /.test(note)) return `${tag} · typical`;
    return `${tag} · nameplate`;
  }
  return "typed";
}

// Where the amps come from, in the scenario the size is based on, as a homeowner would name it.
// Items are listed one by one (never also as "other appliances"), so nothing is counted twice.
export function contributors(state, a, topN = 8) {
  const r = a.basis;
  const eff = effective(state);
  const out = [];
  const push = (label, va) => { if (va > 0) out.push({ label, va: Math.round(va) }); };
  push("Lighting & receptacles, whole house", r.general);
  push("Kitchen & laundry circuits", r.circuits);
  push("Dishwasher, disposal, microwave", r.basics);
  push(`Cooking (${RANGE_SHORT[r.range] || r.range})`, r.rangeVA);
  push(r.dryerQty > 1 ? `${r.dryerQty} electric dryers` : "Electric dryer", r.dryerVA);
  push(r.whQty > 1 ? `Water heating (${r.whQty})` : "Water heating", r.whVA);
  push(`${r.hvacWhich === "heating" ? "Heating" : "Cooling"}, ${eff.tons} tons${r.hvac > 0 && (r.resFactor < 1) ? "" : ""}`, r.hvac);
  const counted = (st) => st.status === "yes" || (state.sizeFor !== "base" && st.status === "maybe");
  for (const it of ITEMS) {
    const st = state.items?.[it.id];
    if (!st || !counted(st)) continue;
    if (it.g !== "appl") continue; // space heaters, floor heat and mini-splits live inside the heating / cooling bar
    push(it.name + (st.status === "maybe" ? " (allowance)" : ""), num(st.va) * num(st.qty, 1));
  }
  for (const x of state.extras || []) if (counted(x)) push(x.name + (x.status === "maybe" ? " (allowance)" : ""), num(x.va) * num(x.qty, 1));
  out.sort((p, q) => q.va - p.va);
  const top = out.slice(0, topN), rest = out.slice(topN);
  return { top, restCount: rest.length, restVA: rest.reduce((n, c) => n + c.va, 0), total: out.reduce((n, c) => n + c.va, 0), max: top.length ? top[0].va : 0 };
}

// The size ladder: standard sizes on one scale, with the confirmed and with-allowances loads marked.
export function gauge(a) {
  const D = a.max.amps > 420 || a.rec === 600 ? 640 : 440;
  const pos = (x) => (Math.min(x, D) / D) * 100;
  return {
    D, bl: pos(a.base.amps), ml: pos(a.max.amps), rec: a.rec,
    ticks: SIZES.filter((x) => x <= D).map((x) => ({ x, p: pos(x), sel: x === a.rec })),
    baseAmps: Math.round(a.base.amps), maxAmps: Math.round(a.max.amps), over: a.max.amps > D,
  };
}

export function sheetData(state, a) {
  const eff = effective(state);
  const und = (v) => v === "undecided";

  // What drives the size, in words a homeowner recognizes.
  const drivers = [];
  if (state.range !== "gas") drivers.push(und(state.range) ? "Range (gas or electric still undecided; counted electric in the allowances)" : RANGE_LABEL[state.range]);
  if (state.dryer !== "gas") {
    const n = Math.max(1, Math.round(num(state.dryerQty, 1)));
    drivers.push(und(state.dryer) ? "Dryer (gas or electric still undecided)" : n > 1 ? `${n} electric dryers` : "Electric dryer");
  }
  if (state.wh !== "gas") {
    const n = Math.max(1, Math.round(num(state.whQty, 1)));
    drivers.push(und(state.wh) ? "Water heater (gas or electric still undecided)" : `${WH_LABEL[state.wh]}${n > 1 ? ` (${n})` : ""}`);
  }
  const hvac = und(state.heat)
    ? `Heating fuel still undecided; counted as a heat pump in the allowances, about ${eff.tons} tons`
    : `${HEAT_LABEL[state.heat]}${state.heat !== "hp" && state.cool === "ac" ? " with central air" : ""}, about ${eff.tons} tons across ${eff.systems} system${eff.systems === 1 ? "" : "s"}`;
  drivers.push(hvac);
  for (const it of ITEMS) {
    const st = state.items?.[it.id];
    if (!st || st.status !== "yes") continue;
    const q = num(st.qty, 1);
    drivers.push(it.unit ? `${it.name} (about ${Math.round(q)} ${it.unit})` : q > 1 ? `${it.name} (${Math.round(q)})` : it.name);
  }
  for (const x of state.extras || []) if (x.status === "yes") drivers.push(x.qty > 1 ? `${x.name} (${x.qty})` : x.name);

  // Allowances: maybes and undecided fuels, when the size covers them.
  const allowances = [];
  if (state.sizeFor !== "base") {
    for (const it of ITEMS) { const st = state.items?.[it.id]; if (st && st.status === "maybe") allowances.push(it.name); }
    for (const x of state.extras || []) if (x.status === "maybe") allowances.push(x.name);
    if (und(state.heat)) allowances.push("Heat pump heating");
    if (und(state.range)) allowances.push("Electric range");
    if (und(state.dryer)) allowances.push("Electric dryer");
    if (und(state.wh)) allowances.push("Electric water heater");
  }

  // Owner choices that would push the size up.
  const changes = (a.whatifs || []).slice(0, 5).map((w) => ({ label: cap(w.label), to: `${w.to} A` }));

  // Office rows: every item that counts, with its number and where it came from.
  const rows = [];
  for (const it of ITEMS) {
    const st = state.items?.[it.id];
    if (!st || st.status === "no") continue;
    rows.push({ name: it.name, va: Math.round(num(st.va)), qty: num(st.qty, 1), unit: it.unit || "", status: st.status, source: sourceOf(st, state.fill), adds: Math.round(a.impacts?.[it.id] || 0) });
  }
  for (const x of state.extras || []) {
    if (x.status === "no") continue;
    rows.push({ name: x.name, va: Math.round(num(x.va)), qty: num(x.qty, 1), unit: "", status: x.status, source: num(x.va) ? (/^confirm spec/.test(String(x.note || "")) ? `${state.fill?.tag || "tool"} · confirm spec` : `${state.fill?.tag || "tool"} · nameplate`) : "needs VA", adds: Math.round(a.impacts?.[x.id] || 0) });
  }

  return {
    eff, drivers, allowances, changes, rows,
    contrib: contributors(state, a),
    gauge: gauge(a),
    headroom: a.headroom,
    estimates: estimates(state),
    rec: sizeLabel(a.rec),
    basisAmps: Math.round(a.basis.amps), confirmedAmps: Math.round(a.base.amps), maxAmps: Math.round(a.max.amps),
    sizedFor: state.sizeFor === "base" ? "base" : "max",
    target: a.target,
    note: bidNote(state, a),
    today: new Date().toLocaleDateString("en-US"),
    plainWhy: "The code adds up the general lighting and receptacle load, the kitchen and laundry circuits, and every fixed appliance; it counts the first 10,000 VA in full and 40% of the rest, then adds the larger of heating or cooling. The result is divided by 240 volts to get amps, and the service is the next standard size above that.",
  };
}
export { lower };
