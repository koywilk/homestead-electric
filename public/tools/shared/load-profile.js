// Homestead Electric · Tools · shared load profile (2026-10-02).
// How the three Tools talk to each other: a device-local "load profile" in ONE
// localStorage key, keyed by the tool that wrote it. Appliance Loads (native),
// Generator Sizing and Service Size (iframes) are all same-origin, so this key
// is a shared mailbox. Nothing here touches Firestore or any job.
// Loaded as a classic <script> by the generator page (window.HELoadProfile),
// bundled into Service Size by esbuild, and require()-d by the Node tests in
// tools-src/service-size/test/profile.test.mjs.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.HELoadProfile = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  var KEY = "he_tools_profile_v1";
  var VISIBLE_KEY = "he_tools_visible_v1";
  var SOURCES = { "appliance-loads": "Appliance Loads", "service-size": "Service Size", "generator-sizing": "Generator Sizing" };

  // Canonical appliance kinds. Order matters: the FIRST regex that matches wins,
  // so the specific kinds sit above the general ones (speed oven before oven,
  // wash tower before washer, heat pump water heater before heat pump).
  // gen = generator preset key (null = never sent to the generator).
  var KINDS = [
    ["speed",        /speed oven|steam oven|microwave drawer|convection microwave|advantium/i, { gen: "generic" }],
    ["warm",         /warming drawer|plate warmer/i, { gen: "generic" }],
    ["dryer",        /wash ?tower|washer ?\/ ?dryer|washer[- ]dryer|laundry (center|tower)/i, { gen: "dryer" }],
    ["covered",      /gas dryer|refrigerat|fridge|freezer|microwave|disposal|disposer|\bhood\b|wine|beverage|ice ?maker|\bwasher\b|washing machine|compactor|coffee|under ?counter/i, { gen: null }],
    ["dryer",        /dryer/i, { gen: "dryer" }],
    ["wh_hpwh",      /heat ?pump water heater|hybrid water heater|hpwh/i, { gen: "wh" }],
    ["wh_tankless",  /tankless|on[- ]demand|instant(aneous)? water/i, { gen: "tankless" }],
    ["wh_tank",      /water heater|\bwh\b|hot water tank/i, { gen: "wh" }],
    ["range",        /\brange\b|\bstove\b|dual[- ]fuel/i, { gen: "range" }],
    ["doubleoven",   /double (wall )?oven/i, { gen: "walloven" }],
    ["walloven",     /\boven\b/i, { gen: "walloven" }],
    ["cooktop",      /cook ?top|range ?top|induction/i, { gen: "cooktop" }],
    ["dishwasher",   /dish ?washer|\bdw\b/i, { gen: "dishwasher" }],
    ["ev",           /\bev\b|evse|car charger|vehicle charg|tesla|wall connector|chargepoint|level ?2 charg/i, { gen: "evse" }],
    ["snowmelt",     /snow ?melt|heat ?trace|de-?ic|ice melt/i, { gen: "snowmelt" }],
    ["floorheat",    /floor (heat|warm)|radiant floor|heated floor|warm ?floor|in-?floor|nuheat|ditra/i, { gen: "electricheat" }],
    ["minisplit",    /mini[- ]?split|ductless/i, { gen: "minisplit" }],
    ["heatpump",     /heat ?pump/i, { gen: "heatpump" }],
    ["electricheat", /electric furnace|baseboard|unit heater|wall heater|garage heater|resistance heat|space heater|cove heater|strip heat|electric heat/i, { gen: "electricheat" }],
    ["ac",           /condenser|condensing unit|\ba\/c\b|\bac\b|air condition|\bhvac\b/i, { gen: "ac" }],
    ["airhandler",   /air handler|furnace|blower|\bfau\b|\bahu\b/i, { gen: "airhandler" }],
    ["sauna",        /sauna/i, { gen: "generic" }],
    ["steam",        /steam (shower|gen|unit|bath)|steamist|mr\.? ?steam/i, { gen: "generic" }],
    ["plunge",       /cold plunge|plunge|chiller/i, { gen: "generic_motor" }],
    ["swimspa",      /swim ?spa/i, { gen: "pool" }],
    ["hottub",       /hot ?tub|\bspa\b|jacuzzi/i, { gen: "pool" }],
    ["pool",         /pool/i, { gen: "pool" }],
    ["wellpump",     /well pump|\bwell\b/i, { gen: "wellpump" }],
    ["sump",         /sump|sewage|ejector|grinder|lift station/i, { gen: "sump" }],
    ["booster",      /booster|circulat|recirc|\bcirc\b/i, { gen: "booster" }],
    ["elevator",     /elevator|\blift\b|dumbwaiter/i, { gen: "elevator" }],
    ["garage",       /garage door|door opener|\bopener\b/i, { gen: "garage" }],
    ["shop",         /welder|compressor|shop recep|table saw|dust collect/i, { gen: "generic_motor" }],
    ["other",        /.^/, { gen: "generic", motorIf: /pump|motor|compressor|\bfan\b|blower|vacuum/i }]
  ];
  var INFO = {};
  KINDS.forEach(function (k) { if (!INFO[k[0]]) INFO[k[0]] = k[2]; });
  function kindInfo(kind) { return INFO[kind] || INFO.other; }

  function num(v) { var x = parseFloat(v); return isFinite(x) && x > 0 ? x : 0; }
  // Nameplate VA per unit from volts × amps; null when either is missing.
  function vaOf(o) { var v = num(o && o.volts), a = num(o && o.amps); return v && a ? Math.round(v * a) : null; }

  function classify(name, o) {
    var s = String(name || "");
    var kind = "other";
    for (var i = 0; i < KINDS.length; i++) { if (KINDS[i][1].test(s)) { kind = KINDS[i][0]; break; } }
    var va = num(o && o.va) || vaOf(o) || 0;
    if ((kind === "wh_tank" || kind === "wh_hpwh") && va >= 15000) kind = "wh_tankless";
    return kind;
  }

  // Generator preset key → kind, for rows that were added from the page's picker.
  var PRESET_KIND = { ac: "ac", ac_large: "ac", heatpump: "heatpump", minisplit: "minisplit", airhandler: "airhandler",
    electricheat: "electricheat", snowmelt: "snowmelt", wh: "wh_tank", tankless: "wh_tankless", dryer: "dryer", range: "range",
    cooktop: "cooktop", walloven: "walloven", dishwasher: "dishwasher", evse: "ev", wellpump: "wellpump", booster: "booster",
    sump: "sump", pool: "pool", elevator: "elevator", garage: "garage", generic_motor: "other", generic: "other" };
  function kindFromPresetKey(key) { return PRESET_KIND[key] || ""; }

  // ---- storage (every call guarded: private mode / blocked storage just means "nothing to fill from") ----
  function store() { try { return typeof localStorage !== "undefined" ? localStorage : null; } catch (e) { return null; } }
  function readProfiles() {
    var ls = store(); if (!ls) return {};
    try { var raw = JSON.parse(ls.getItem(KEY) || "{}"); return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}; } catch (e) { return {}; }
  }
  function writeProfile(p) {
    var ls = store(); if (!ls || !p || !SOURCES[p.source]) return false;
    try { var all = readProfiles(); all[p.source] = p; ls.setItem(KEY, JSON.stringify(all)); return true; } catch (e) { return false; }
  }
  // cb(profiles) now, and again whenever ANOTHER window (the app, the other
  // iframe, an own-tab copy) writes the key. Returns an unsubscribe.
  function onProfiles(cb) {
    cb(readProfiles());
    if (typeof window === "undefined") return function () {};
    var h = function (e) { if (!e || e.key === null || e.key === KEY) cb(readProfiles()); };
    window.addEventListener("storage", h);
    return function () { window.removeEventListener("storage", h); };
  }
  function readVisible() {
    var ls = store(); if (!ls) return null;
    try { var v = JSON.parse(ls.getItem(VISIBLE_KEY) || "null"); return Array.isArray(v) ? v : null; } catch (e) { return null; }
  }
  function writeVisible(keys) { var ls = store(); if (!ls) return; try { ls.setItem(VISIBLE_KEY, JSON.stringify(keys || [])); } catch (e) {} }
  // Service Size is a per-user grant; when the app never told us the list, assume only the other two.
  function isVisible(key) { var v = readVisible(); return v ? v.indexOf(key) >= 0 : key !== "service-size"; }

  function ago(iso, nowMs) {
    var t = Date.parse(iso || ""); if (!isFinite(t)) return "";
    var m = Math.floor(((nowMs || Date.now()) - t) / 60000);
    if (m < 1) return "just now"; if (m < 60) return m + " min ago";
    var h = Math.round(m / 60); if (h < 24) return h + " h ago";
    return Math.round(h / 24) + " d ago";
  }

  // Inside the Tools tab: ask the app shell to switch the chip. In an own tab: go there.
  function openTool(key) {
    try {
      if (typeof window !== "undefined" && window.parent && window.parent !== window) {
        window.parent.postMessage({ type: "he-tools-open", key: key }, window.location.origin);
        return;
      }
      if (typeof window !== "undefined" && key !== "appliance-loads") window.location.href = "/tools/" + key + "/";
    } catch (e) {}
  }

  // ---- generator mapping ----------------------------------------------------
  // profile → rows for the generator page. PRESETS is the page's own table,
  // passed in so this file never carries a copy of Josh's numbers.
  function toGeneratorRows(profile, PRESETS) {
    var rows = [], skipped = [], typical = 0;
    var loads = (profile && profile.loads) || [];
    for (var i = 0; i < loads.length; i++) {
      var l = loads[i]; if (!l) continue;
      var kind = l.kind || classify(l.name, l);
      var info = kindInfo(kind);
      if (!info.gen) { skipped.push(l.name); continue; }
      if (l.status === "maybe" && profile.sizeFor !== "max") continue;
      var va = num(l.va) || vaOf(l) || 0;
      var key = info.gen;
      if (kind === "ac" && va >= 8000 && PRESETS.ac_large) key = "ac_large";
      if (kind === "other" && info.motorIf.test(l.name || "") && PRESETS.generic_motor) key = "generic_motor";
      var pre = PRESETS[key] || PRESETS.generic;
      var row = {};
      for (var k in pre) row[k] = pre[k];
      row.key = key; row.name = String(l.name || pre.name); row.qty = Math.max(1, Math.round(num(l.qty) || 1)); row.soft = false;
      if (typeof l.motor === "boolean" && kind === "other") row.motor = l.motor;
      if (va) row.va = va; else { typical++; row.flag = "typical VA"; }
      if (l.status === "maybe") row.flag = "maybe";
      rows.push(row);
    }
    return { rows: rows, skipped: skipped, typical: typical };
  }

  // generator rows + inputs → profile. inputs: {sqft, sac, laundry, svcA, jobCust, jobAddr}
  function fromGeneratorRows(rows, inputs) {
    var inp = inputs || {};
    var loads = (rows || []).map(function (r) {
      return { name: String(r.name || ""), model: "", kind: kindFromPresetKey(r.key) || classify(r.name, { va: r.va }),
        qty: Math.max(1, Math.round(num(r.qty) || 1)), volts: null, amps: null, va: num(r.va) || null,
        motor: !!r.motor, status: r.flag === "maybe" ? "maybe" : "yes", note: "" };
    });
    var name = String(inp.jobCust || "").trim();
    return { v: 1, source: "generator-sizing", at: new Date().toISOString(),
      label: (name || "Generator Sizing") + " · " + loads.length + " load" + (loads.length === 1 ? "" : "s"),
      job: { no: "", name: name, address: String(inp.jobAddr || "").trim() },
      house: { sqft: num(inp.sqft), sac: num(inp.sac), laundry: num(inp.laundry) },
      hvac: null, service: num(inp.svcA) ? { amps: num(inp.svcA) } : null, sizeFor: "max", loads: loads };
  }

  return { KEY: KEY, VISIBLE_KEY: VISIBLE_KEY, SOURCES: SOURCES, KINDS: KINDS, kindInfo: kindInfo, classify: classify, vaOf: vaOf,
    kindFromPresetKey: kindFromPresetKey, readProfiles: readProfiles, writeProfile: writeProfile, onProfiles: onProfiles,
    readVisible: readVisible, writeVisible: writeVisible, isVisible: isVisible, ago: ago, openTool: openTool,
    toGeneratorRows: toGeneratorRows, fromGeneratorRows: fromGeneratorRows };
});
