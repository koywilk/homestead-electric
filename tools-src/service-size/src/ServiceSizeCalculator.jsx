import { useMemo, useRef, useState } from "react";
import {
  ITEMS, SIZES, RANGE_LABEL, RANGE_SHORT, DRYER_LABEL, WH_LABEL, HEAT_LABEL, COOL_LABEL, TIER_LABEL,
  normalizeState, tierItems, effective, analyze, bidNote, applyPlan, toRecord, sizeLabel, fmt,
} from "./calc.js";
import "./ServiceSizeCalculator.css";

/**
 * Service size calculator (NEC 220.82) with "drop plans" reading.
 *
 * Props
 *   apiPath       where the Vercel function lives (default "/api/read-plans")
 *   accessKey     optional; sent as x-plans-key if PLANS_ACCESS_KEY is set on the server
 *   initialState  optional; a saved `inputs` object, or the result of applyPlan(...)
 *   onSave        optional async (record, state) => void. Shows a Save button. record = toRecord(state, analysis)
 */
export default function ServiceSizeCalculator({ apiPath = "/api/read-plans", accessKey, initialState, onSave }) {
  const [s, setS] = useState(() => normalizeState(initialState || {}));
  const [busy, setBusy] = useState(null); // progress text while reading plans
  const [err, setErr] = useState("");
  const [over, setOver] = useState(false);
  const [copied, setCopied] = useState("");
  const [saveMsg, setSaveMsg] = useState("");
  const ctl = useRef(null);
  const noteRef = useRef(null);

  const a = useMemo(() => analyze(s), [s]);
  const note = useMemo(() => bidNote(s, a), [s, a]);
  const eff = effective(s);

  const set = (k) => (e) => {
    const v = e.target.type === "checkbox" ? e.target.checked : e.target.value;
    setS((p) => ({ ...p, [k]: v }));
  };
  const setItem = (id, patch) => setS((p) => ({ ...p, items: { ...p.items, [id]: { ...p.items[id], ...patch } } }));
  const setTier = (e) => {
    const tier = Number(e.target.value);
    setS((p) => ({ ...p, tier, sac: [2, 3, 4][tier], items: tierItems(tier) }));
  };
  const fromPlans = (k) => s.planFields?.includes(k);
  const Tag = ({ k }) => (fromPlans(k) ? <span className="ssc-tag">plans</span> : null);

  async function onFiles(fileList) {
    if (ctl.current) return;
    const files = [...fileList]; // copy now: the input's FileList is cleared right after this call
    setErr("");
    ctl.current = new AbortController();
    try {
      setBusy("Reading file…");
      // Loaded on first use so pdf.js stays out of the main bundle.
      const { readPlans } = await import("./readPlans.js");
      const plan = await readPlans(files, { apiPath, accessKey, onProgress: setBusy, signal: ctl.current.signal });
      const name = files.map((f) => f.name).join(", ");
      setS((p) => applyPlan(p, plan, name));
    } catch (e) {
      if (e?.name === "AbortError") return;
      if (typeof navigator !== "undefined" && navigator.onLine === false) setErr("Reading plans needs an internet connection. The calculator itself works offline.");
      else setErr(e?.message || "Something went wrong reading the plans.");
    } finally {
      setBusy(null);
      ctl.current = null;
    }
  }

  async function copyNote() {
    try {
      await navigator.clipboard.writeText(note);
      setCopied("Copied");
      setTimeout(() => setCopied(""), 2000);
    } catch {
      noteRef.current?.select();
      setCopied("Selected. Press Ctrl+C or ⌘C to copy.");
    }
  }

  async function save() {
    setSaveMsg("Saving…");
    try {
      await onSave(toRecord(s, a), s);
      setSaveMsg("Saved");
    } catch (e) {
      setSaveMsg(e?.message || "Couldn't save. Try again.");
    }
  }

  // Gauge
  const D = a.max.amps > 420 || a.rec === 600 ? 640 : 440;
  const pos = (x) => (Math.min(x, D) / D) * 100;
  const bl = pos(a.base.amps), ml = pos(a.max.amps), close = Math.abs(ml - bl) < 14;
  let lastLab = -99;
  const ticks = SIZES.filter((x) => x <= D).map((x) => {
    const p = pos(x);
    const lab = x === a.rec || (p - lastLab >= 7 && !(a.rec && Math.abs(pos(a.rec) - p) < 7));
    if (lab) lastLab = p;
    return { x, p, lab };
  });

  const cats = [...new Set(ITEMS.map((it) => it.cat))];
  const plan = s.plan;
  const countedSqft = plan?.areas?.filter((x) => x.counted).reduce((n, x) => n + x.sqft, 0) || 0;

  return (
    <div className="ssc">
      <div className="ssc-grid">
        <div className="ssc-col">
          {/* Drop zone */}
          <section className="ssc-panel">
            <h2>Start from plans <span className="ssc-ref">PDF or photos</span></h2>
            <label
              className={"ssc-drop" + (over ? " over" : "")}
              onDragOver={(e) => { e.preventDefault(); setOver(true); }}
              onDragLeave={() => setOver(false)}
              onDrop={(e) => { e.preventDefault(); setOver(false); onFiles(e.dataTransfer.files); }}
            >
              <input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" multiple
                onChange={(e) => { onFiles(e.target.files); e.target.value = ""; }} />
              <span className="ssc-drop-main">Drop a plan set here</span>
              <span className="ssc-drop-sub">or click to choose a file. Claude reads the sheets and fills in the calculator.</span>
            </label>
            {busy && (
              <div className="ssc-prog">
                <span className="ssc-spin" aria-hidden="true" />
                <span className="ssc-grow">{busy}</span>
                <button type="button" className="ssc-btn ghost small" onClick={() => ctl.current?.abort()}>Stop</button>
              </div>
            )}
            {err && <p className="ssc-err">{err}</p>}
          </section>

          {plan && (
            <section className="ssc-panel">
              <h2>What the plans show <span className="ssc-ref">{plan.source}</span></h2>
              <div className="ssc-plan-grid">
                <div>
                  <div className="ssc-lbl">Floor areas</div>
                  <table className="ssc-areas"><tbody>
                    {plan.areas.map((x, i) => (
                      <tr key={i}>
                        <td>{x.label}{x.estimated && <span className="ssc-est">est.</span>}{!x.counted && <small> (not counted)</small>}</td>
                        <td className="n">{fmt(x.sqft)}</td>
                      </tr>
                    ))}
                    {plan.areas.length ? (
                      <tr className="tot"><td>Counted in calc</td><td className="n">{fmt(countedSqft)}</td></tr>
                    ) : (<tr><td className="ssc-empty">No floor areas found.</td></tr>)}
                  </tbody></table>
                </div>
                <div>
                  <div className="ssc-lbl">Found on the sheets</div>
                  <ul className="ssc-finds">
                    {plan.findings.length ? plan.findings.map((f, i) => (
                      <li key={i}><span className={"ssc-conf " + f.confidence}>{f.confidence}</span>
                        <span>{f.what}{f.where && <small> {f.where}</small>}</span></li>
                    )) : <li className="ssc-empty">Nothing specific found.</li>}
                  </ul>
                </div>
              </div>
              <div className="ssc-plan-grid" style={{ marginTop: 14 }}>
                <div>
                  <div className="ssc-lbl">Ask the owner or builder</div>
                  <ul className="ssc-asks">{plan.questions.length ? plan.questions.map((q, i) => <li key={i}>{q}</li>) : <li className="ssc-empty">Nothing open.</li>}</ul>
                </div>
                <div>
                  <div className="ssc-lbl">Seen but not in this calculation</div>
                  <ul className="ssc-asks">{plan.notInCalc.length ? plan.notInCalc.map((q, i) => <li key={i}>{q}</li>) : <li className="ssc-empty">Nothing extra.</li>}</ul>
                </div>
              </div>
              <p className="ssc-hint" style={{ marginTop: 12 }}>Fields filled from the plans are marked <span className="ssc-tag">plans</span>. Check them and edit anything that's wrong.</p>
            </section>
          )}

          <section className="ssc-panel">
            <h2>The house</h2>
            <div className="ssc-fields">
              <label className="ssc-field wide"><span className="ssc-lbl">Job name<Tag k="job" /></span>
                <input type="text" value={s.job} onChange={set("job")} placeholder="e.g. Miller Residence" /></label>
              <label className="ssc-field"><span className="ssc-lbl">Living area, sq ft<Tag k="sqft" /></span>
                <input type="number" min="0" step="50" value={s.sqft} onChange={set("sqft")} />
                <span className="ssc-hint">Include unfinished basement that can be finished later</span></label>
              <label className="ssc-field"><span className="ssc-lbl">Finish level<Tag k="tier" /></span>
                <select value={s.tier} onChange={setTier}>{TIER_LABEL.map((t, i) => <option key={i} value={i}>{t}</option>)}</select>
                <span className="ssc-hint">Changing this resets the extras list</span></label>
              <label className="ssc-field"><span className="ssc-lbl">Small-appliance circuits<Tag k="sac" /></span>
                <input type="number" min="2" step="1" value={s.sac} onChange={set("sac")} />
                <span className="ssc-hint">Kitchen, pantry, dining. Minimum 2</span></label>
              <label className="ssc-field"><span className="ssc-lbl">Laundry circuits<Tag k="laundry" /></span>
                <input type="number" min="1" step="1" value={s.laundry} onChange={set("laundry")} /></label>
            </div>
          </section>

          <section className="ssc-panel">
            <h2>Heating &amp; cooling <span className="ssc-ref">220.82(C)</span></h2>
            <div className="ssc-fields">
              <label className="ssc-field"><span className="ssc-lbl">Heating<Tag k="heat" /></span>
                <select value={s.heat} onChange={set("heat")}>{Object.entries(HEAT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
              <label className="ssc-field"><span className="ssc-lbl">Cooling<Tag k="cool" /></span>
                <select value={s.cool} onChange={set("cool")} disabled={s.heat === "hp"}>{Object.entries(COOL_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                {s.heat === "hp" && <span className="ssc-hint">The heat pump provides cooling</span>}</label>
              <div className="ssc-field"><label className="ssc-lbl" htmlFor="ssc-tons">Total tonnage<Tag k="tons" /></label>
                <input id="ssc-tons" type="number" min="0" step="0.5" value={s.tonsAuto ? eff.tons : s.tons} disabled={s.tonsAuto} onChange={set("tons")} />
                <label className="ssc-check"><input type="checkbox" checked={s.tonsAuto} onChange={(e) => setS((p) => ({ ...p, tonsAuto: e.target.checked, tons: eff.tons }))} /> Estimate from sq ft</label></div>
              <div className="ssc-field"><label className="ssc-lbl" htmlFor="ssc-strip">Backup heat strips, kW total</label>
                <input id="ssc-strip" type="number" min="0" step="5" value={s.stripAuto ? eff.strip : s.strip} disabled={s.stripAuto} onChange={set("strip")} />
                <label className="ssc-check"><input type="checkbox" checked={s.stripAuto} onChange={(e) => setS((p) => ({ ...p, stripAuto: e.target.checked, strip: eff.strip }))} /> 10 kW per system</label></div>
            </div>
          </section>

          <section className="ssc-panel">
            <h2>Big appliances</h2>
            <div className="ssc-fields">
              <label className="ssc-field"><span className="ssc-lbl">Cooking<Tag k="range" /></span>
                <select value={s.range} onChange={set("range")}>{Object.entries(RANGE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
              <label className="ssc-field"><span className="ssc-lbl">Dryer<Tag k="dryer" /></span>
                <select value={s.dryer} onChange={set("dryer")}>{Object.entries(DRYER_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
              <label className="ssc-field"><span className="ssc-lbl">Dryers<Tag k="dryerQty" /></span>
                <input type="number" min="1" step="1" value={s.dryerQty} onChange={set("dryerQty")} /></label>
              <label className="ssc-field"><span className="ssc-lbl">Water heater<Tag k="wh" /></span>
                <select value={s.wh} onChange={set("wh")}>{Object.entries(WH_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
              <label className="ssc-field"><span className="ssc-lbl">Water heaters<Tag k="whQty" /></span>
                <input type="number" min="1" step="1" value={s.whQty} onChange={set("whQty")} /></label>
            </div>
            <p className="ssc-hint" style={{ marginTop: 12 }}>Dishwasher, disposal, and built-in microwave are always counted (3,600 VA).</p>
          </section>

          <section className="ssc-panel">
            <h2>Extras</h2>
            <div className="ssc-legend">
              <span><b>Yes</b> known or on the plans</span>
              <span><b>Maybe</b> could happen; counted in the "with maybes" number</span>
              <span><b>No</b> not planned</span>
            </div>
            <div className="ssc-rowhead"><span>Item</span><span>VA each</span><span>Qty</span><span>Status</span><span>Adds</span></div>
            {cats.map((cat) => (
              <div key={cat}>
                <div className="ssc-cat">{cat}</div>
                {ITEMS.filter((it) => it.cat === cat).map((it) => {
                  const it2 = s.items[it.id] || { va: it.va, qty: it.qty[0], status: "no" };
                  const d = a.impacts[it.id];
                  return (
                    <div className="ssc-row" key={it.id}>
                      <div className="nm"><b>{it.name}{it2.fromPlans && <span className="ssc-tag">plans</span>}</b>
                        {(it2.planNote || it.note) && <small>{it2.planNote || it.note}</small>}</div>
                      <div className="va"><input type="number" min="0" step={it.unit ? 5 : 100} value={it2.va} aria-label={`${it.name} VA`}
                        onChange={(e) => setItem(it.id, { va: e.target.value })} /></div>
                      <div className="qty"><input type="number" min="0" step={it.unit ? 50 : 1} value={it2.qty} aria-label={`${it.name} quantity`}
                        onChange={(e) => setItem(it.id, { qty: e.target.value })} />{it.unit && <span className="ssc-unit">{it.unit}</span>}</div>
                      <div className="ssc-seg" role="group" aria-label={`${it.name} status`}>
                        {["yes", "maybe", "no"].map((v) => (
                          <button key={v} type="button" data-v={v} aria-pressed={it2.status === v} onClick={() => setItem(it.id, { status: v })}>
                            {v[0].toUpperCase() + v.slice(1)}
                          </button>
                        ))}
                      </div>
                      <div className={"impact" + (it2.status !== "no" ? " on" : "")}>{d > 0.5 ? `+${Math.round(d)} A` : "<1 A"}</div>
                    </div>
                  );
                })}
              </div>
            ))}
            <p className="ssc-hint" style={{ marginTop: 12 }}>VA values are typical nameplates. Replace them with the real spec sheet when you have it. "Adds" is how many calculated amps the item adds with maybes included.</p>
          </section>

          <section className="ssc-panel">
            <h2>Settings</h2>
            <div className="ssc-fields">
              <label className="ssc-field"><span className="ssc-lbl">Size so the calculated load is at most</span>
                <select value={s.target} onChange={(e) => setS((p) => ({ ...p, target: Number(e.target.value) }))}>
                  <option value={100}>100% of service (code minimum)</option><option value={90}>90% of service</option><option value={80}>80% of service</option>
                </select></label>
              <label className="ssc-field"><span className="ssc-lbl">Size the service for</span>
                <select value={s.sizeFor} onChange={set("sizeFor")}><option value="max">Confirmed + maybes</option><option value="base">Confirmed only</option></select></label>
              <div className="ssc-field"><span className="ssc-lbl">Future solar</span>
                <label className="ssc-check"><input type="checkbox" checked={s.solar} onChange={set("solar")} /> Owner may add solar</label></div>
            </div>
          </section>
        </div>

        {/* Results */}
        <aside className="ssc-results">
          <div className="ssc-rec">
            <div className="ssc-lbl">Recommended service</div>
            <div className="ssc-big">{sizeLabel(a.rec)}<small>A</small></div>
            <div className="ssc-basis">
              {s.sizeFor === "max" ? "Covers confirmed loads plus every maybe" : "Covers confirmed loads only"}
              {a.target < 100 ? `, loaded to no more than ${a.target}%` : ""}.
            </div>
            <span className={"ssc-chip " + a.status.kind}>{a.status.text}</span>
          </div>

          <div className="ssc-panel">
            <div className="ssc-gauge">
              <div className="track" />
              <div className="fill" style={{ width: ml + "%" }} />
              <div className="fill base" style={{ width: bl + "%" }} />
              {ticks.map((t) => (
                <div key={t.x} className={"tick" + (t.x === a.rec ? " sel" : "")} style={{ left: t.p + "%" }}>{t.lab && <span>{t.x}</span>}</div>
              ))}
              <div className="mk" style={{ left: bl + "%", ...(close ? { top: -2, transform: "translateX(-100%)" } : {}) }}>{Math.round(a.base.amps)}</div>
              <div className="mk max" style={{ left: ml + "%", ...(close ? { top: -2, transform: "translateX(0)" } : {}) }}>{Math.round(a.max.amps)}{a.max.amps > D ? " ›" : ""}</div>
            </div>
            <div className="ssc-scn">
              <span className="h">Scenario</span><span className="h n">Calc.</span><span className="h n">Min. service</span>
              <span><i className="dot" style={{ background: "var(--ssc-ink)" }} />Confirmed only</span><span className="n">{Math.round(a.base.amps)} A</span><span className="n">{sizeLabel(a.codeBase)} A</span>
              <span><i className="dot" style={{ background: "var(--ssc-copper)" }} />With maybes</span><span className="n">{Math.round(a.max.amps)} A</span><span className="n">{sizeLabel(a.codeMax)} A</span>
            </div>
          </div>

          <div className="ssc-panel">
            <h2>Room left</h2>
            <div className="ssc-head">
              {a.headroom ? (
                <>At {a.rec} A there is <b>{fmt(a.headroom.amps)} A</b> of calculated room. That is about <b>{a.headroom.kw.toFixed(1)} kW</b> of appliance nameplate, since added appliances count at 40%
                  {a.headroom.evs > 0 ? `, or ${a.headroom.evs} more 48 A EV charger${a.headroom.evs > 1 ? "s" : ""}.` : ". Not enough for another 48 A EV charger."}</>
              ) : "The calculated load is beyond a 600 A residential service."}
            </div>
          </div>

          <div className="ssc-panel">
            <h2>Owner changes that bump the size</h2>
            <ul className="ssc-watch">
              {a.whatifs.length ? a.whatifs.slice(0, 7).map((w) => (
                <li key={w.label}><span>{w.label}</span><span className="to">→ {w.to} A</span></li>
              )) : <li className="ssc-empty">No single item marked No would push this past {sizeLabel(a.rec)} A.</li>}
            </ul>
          </div>

          {a.flags.length > 0 && (
            <div className="ssc-panel">
              <h2>Check before you bid</h2>
              <ul className="ssc-flags">{a.flags.map((f, i) => <li key={i}>{f}</li>)}</ul>
            </div>
          )}
        </aside>
      </div>

      <div className="ssc-lower">
        <section className="ssc-panel">
          <h2>Load calculation <span className="ssc-ref">220.82(B) + (C)</span></h2>
          <div className="ssc-tblwrap"><CalcTable s={s} b={a.base} m={a.max} /></div>
        </section>
        <section className="ssc-panel">
          <h2>Bid note</h2>
          <p className="ssc-hint" style={{ margin: "-6px 0 10px" }}>Paste into the proposal so the service size and its assumptions are on record.</p>
          <textarea ref={noteRef} readOnly value={note} />
          <div className="ssc-btnrow">
            <button type="button" className="ssc-btn" onClick={copyNote}>Copy bid note</button>
            {onSave && <button type="button" className="ssc-btn ghost" onClick={save}>Save to job</button>}
            <span className="ssc-status" aria-live="polite">{copied || saveMsg}</span>
          </div>
        </section>
      </div>
    </div>
  );
}

function CalcTable({ s, b, m }) {
  const rn = (r) => RANGE_SHORT[r.range];
  const hvn = (r) => `${r.hvacWhich} governs · ${HEAT_LABEL[r.heat].toLowerCase()}`;
  const rows = [
    ["General lighting & receptacles", b.general, m.general, "", `${fmt(Number(s.sqft) || 0)} sq ft × 3 VA`],
    ["Small-appliance & laundry circuits", b.circuits, m.circuits, "", `${b.sac + b.laundry} circuits × 1,500 VA`],
    ["Dishwasher, disposal, microwave", b.basics, m.basics],
    ["Cooking", b.rangeVA, m.rangeVA, "", `${rn(b)} / ${rn(m)}`],
    ["Dryer", b.dryerVA, m.dryerVA, "", b.dryerQty > 1 ? `${b.dryerQty} dryers` : ""],
    ["Water heating", b.whVA, m.whVA, "", b.whQty > 1 ? `${b.whQty} units` : ""],
    ["Other appliances", b.other, m.other, "", m.otherList.join(", ") || "none"],
    ["Subtotal, 220.82(B)", b.B, m.B, "sum"],
    ["First 10,000 VA at 100%", b.first, m.first],
    ["Remainder at 40%", b.rest, m.rest],
    ["Heating or cooling, largest, 220.82(C)", b.hvac, m.hvac, "", `${hvn(b)} / ${hvn(m)}`],
    ["Total", b.total, m.total, "total"],
  ];
  return (
    <table className="ssc-calc">
      <thead><tr><th>Load</th><th className="n">Confirmed VA</th><th className="n">With maybes VA</th></tr></thead>
      <tbody>
        {rows.map(([label, bv, mv, cls, note]) => (
          <tr key={label} className={cls || ""}><td>{label}{note && <><br /><small>{note}</small></>}</td><td className="n">{fmt(bv)}</td><td className="n">{fmt(mv)}</td></tr>
        ))}
        <tr className="total"><td>÷ 240 V</td><td className="n">{Math.round(b.amps)} A</td><td className="n">{Math.round(m.amps)} A</td></tr>
      </tbody>
    </table>
  );
}
