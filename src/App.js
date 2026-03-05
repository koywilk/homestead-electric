import { useState, useEffect, useRef } from "react";
import { supabase } from "./supabase";

const C = {
  bg:"#09090f", surface:"#0f1018", card:"#13151f", border:"#1c1f2e",
  muted:"#2e3347", text:"#e0e6f5", dim:"#5a6480", accent:"#e8a020",
  blue:"#3b82f6", green:"#22c55e", red:"#ef4444", purple:"#a78bfa",
  orange:"#f97316", teal:"#14b8a6", rough:"#3b82f6", finish:"#a78bfa",
};

const JOB_ID = "homestead-jobs-v1";
const ROUGH_STAGES  = ['0%', '5%', '10%', '15%', '20%', '25%', '30%', '35%', '40%', '45%', '50%', '55%', '60%', '65%', '70%', '75%', '80%', '85%', '90%', '95%', '100%'];
const FINISH_STAGES = ['0%', '5%', '10%', '15%', '20%', '25%', '30%', '35%', '40%', '45%', '50%', '55%', '60%', '65%', '70%', '75%', '80%', '85%', '90%', '95%', '100%'];
const WIRE_SIZES    = ["","14 AWG","12 AWG","10 AWG","8 AWG","6 AWG","4 AWG","2 AWG","1/0","2/0","3/0","4/0"];
const CO_STATUSES   = ["Pending","CO Created","CO Sent (office)","Approved","Denied","Work Completed"];
const PULLED_OPTS   = ["","Pulled"];
const DRIVER_SIZES  = ["","20W","40W","60W","96W","192W","288W"];

const TEAM = [
  { name:"Josh",   email:"josh@homesteadelectric.net"   },
  { name:"Brady",  email:"brady@homesteadelectric.net"  },
  { name:"Koy",    email:"koy@homesteadelectric.net"    },
  { name:"Justin", email:"justin@homesteadelectric.net" },
  { name:"Vasa",   email:"vasa@homesteadelectric.net"   },
  { name:"Colby",  email:"colby@homesteadelectric.net"  },
];

let _uid = Date.now();
const uid = () => String(++_uid);

const newHRRow     = (num) => ({ id:uid(), num, wire:"", name:"", status:"" });
const newCP4Row    = (num) => ({ id:uid(), num, name:"", module:"", status:"" });
const newKPRow     = (num) => ({ id:uid(), num, name:"" });
const emptyPunch   = ()    => ({ upper:[], main:[], basement:[] });

const FOREMEN = ["Koy", "Vasa", "Colby"];
const FOREMEN_COLORS = {"Koy":"#3b82f6","Vasa":"#a78bfa","Colby":"#22c55e"};

const blankJob = () => ({
  id:uid(), name:"", address:"", gc:"", phone:"", simproNo:"", foreman:"Koy", flagged:false,
  planLink:"", redlineLink:"", lightingLink:"", panelLink:"", qcLink:"", matterportLink:"",
  uploadedFiles:[],
  roughStage:"0%", roughQuestions:{ upper:[], main:[], basement:[] },
  roughPunch:emptyPunch(), roughMaterials:[], roughUpdates:[], roughNotes:"",
  finishStage:"0%",
  finishPunch:emptyPunch(), finishMaterials:[], finishUpdates:[], finishNotes:"",
  finishQuestions:{ upper:[], main:[], basement:[] },
  changeOrders:[], returnTrips:[],
  homeRuns:{
    main:    Array.from({length:10},(_,i)=>newHRRow(i+1)),
    basement:Array.from({length:10},(_,i)=>newHRRow(i+1)),
    upper:   Array.from({length:10},(_,i)=>newHRRow(i+1)),
  },
  panelCounts:{ meter:"", panelA:"", panelB:"", dedicated:"" },
  panelizedLighting:{
    mainKeypad:     Array.from({length:10},(_,i)=>newKPRow(i+1)),
    basementKeypad: Array.from({length:10},(_,i)=>newKPRow(i+1)),
    upperKeypad:    Array.from({length:10},(_,i)=>newKPRow(i+1)),
    cp4Loads:       Array.from({length:10},(_,i)=>newCP4Row(i+1)),
  },
  tapeLights:[], loadMappingNotes:"",
});

// ── Email composer modal ──────────────────────────────────────
function EmailModal({ subject, body, onClose }) {
  const [selected, setSelected] = useState([]);
  const [customEmail, setCustomEmail] = useState("");
  const [customList, setCustomList] = useState([]);
  const [customErr, setCustomErr] = useState("");

  const toggle = (email) =>
    setSelected(s => s.includes(email) ? s.filter(e=>e!==email) : [...s, email]);

  const addCustom = () => {
    const val = customEmail.trim().toLowerCase();
    if (!val) return;
    const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val);
    if (!valid) { setCustomErr("Enter a valid email address"); return; }
    if (customList.includes(val) || TEAM.map(t=>t.email).includes(val)) {
      setCustomErr("Already in list"); return;
    }
    setCustomList(l=>[...l, val]);
    setSelected(s=>[...s, val]);
    setCustomEmail("");
    setCustomErr("");
  };

  const removeCustom = (email) => {
    setCustomList(l=>l.filter(e=>e!==email));
    setSelected(s=>s.filter(e=>e!==email));
  };

  const allRecipients = [...selected];

  const send = () => {
    if (!allRecipients.length) return;
    const uri = `mailto:${allRecipients.join(",")}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    const a = document.createElement("a");
    a.href = uri;
    a.setAttribute("target", "_blank");
    a.setAttribute("rel", "noopener noreferrer");
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    onClose();
  };

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",zIndex:400,
      display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
      <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:16,
        width:"100%",maxWidth:440,padding:24,boxShadow:"0 24px 60px rgba(0,0,0,0.6)",
        maxHeight:"90vh",overflowY:"auto"}}>

        <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:20,letterSpacing:"0.06em",
          color:C.text,marginBottom:4}}>Send Email</div>
        <div style={{fontSize:12,color:C.dim,marginBottom:16}}>Select recipients</div>

        {/* Team list */}
        <div style={{marginBottom:12}}>
          {TEAM.map(t=>(
            <div key={t.email} onClick={()=>toggle(t.email)}
              style={{display:"flex",alignItems:"center",gap:10,padding:"9px 12px",
                borderRadius:8,marginBottom:6,cursor:"pointer",
                background:selected.includes(t.email)?`${C.blue}18`:C.surface,
                border:`1px solid ${selected.includes(t.email)?C.blue:C.border}`,
                transition:"all 0.15s"}}>
              <div style={{width:18,height:18,borderRadius:4,
                border:`2px solid ${selected.includes(t.email)?C.blue:C.muted}`,
                background:selected.includes(t.email)?C.blue:"none",
                display:"flex",alignItems:"center",justifyContent:"center",
                flexShrink:0,transition:"all 0.15s"}}>
                {selected.includes(t.email)&&<span style={{color:"#000",fontSize:11,fontWeight:700}}>✓</span>}
              </div>
              <div>
                <div style={{fontSize:13,fontWeight:600,color:C.text}}>{t.name}</div>
                <div style={{fontSize:11,color:C.dim}}>{t.email}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Custom recipients */}
        <div style={{borderTop:`1px solid ${C.border}`,paddingTop:12,marginBottom:12}}>
          <div style={{fontSize:10,color:C.dim,fontWeight:700,letterSpacing:"0.1em",marginBottom:8}}>
            ADD ANOTHER RECIPIENT
          </div>
          <div style={{display:"flex",gap:8,marginBottom:6}}>
            <input value={customEmail} onChange={e=>{setCustomEmail(e.target.value);setCustomErr("");}}
              onKeyDown={e=>e.key==="Enter"&&addCustom()}
              placeholder="name@example.com"
              style={{flex:1,background:C.surface,border:`1px solid ${customErr?C.red:C.border}`,
                borderRadius:7,color:C.text,padding:"7px 10px",fontSize:12,fontFamily:"inherit",outline:"none"}}
              onFocus={e=>e.target.style.borderColor=customErr?C.red:C.accent}
              onBlur={e=>e.target.style.borderColor=customErr?C.red:C.border}/>
            <button onClick={addCustom}
              style={{background:C.accent,border:"none",borderRadius:7,color:"#000",fontWeight:700,
                padding:"7px 14px",fontSize:12,cursor:"pointer",fontFamily:"inherit",whiteSpace:"nowrap"}}>
              + Add
            </button>
          </div>
          {customErr&&<div style={{fontSize:11,color:C.red,marginBottom:6}}>{customErr}</div>}
          {customList.map(email=>(
            <div key={email} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 10px",
              background:`${C.accent}15`,border:`1px solid ${C.accent}44`,borderRadius:7,marginBottom:5}}>
              <span style={{flex:1,fontSize:12,color:C.text}}>{email}</span>
              <button onClick={()=>removeCustom(email)}
                style={{background:"none",border:"none",color:C.muted,cursor:"pointer",fontSize:13}}>✕</button>
            </div>
          ))}
        </div>

        {/* Preview */}
        <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,
          padding:10,marginBottom:16,maxHeight:110,overflowY:"auto"}}>
          <div style={{fontSize:10,color:C.dim,marginBottom:3,fontWeight:700,letterSpacing:"0.08em"}}>SUBJECT</div>
          <div style={{fontSize:12,color:C.text,marginBottom:8}}>{subject}</div>
          <div style={{fontSize:10,color:C.dim,marginBottom:3,fontWeight:700,letterSpacing:"0.08em"}}>PREVIEW</div>
          <div style={{fontSize:11,color:C.dim,whiteSpace:"pre-wrap",lineHeight:1.5}}>
            {body.slice(0,180)}{body.length>180?"…":""}
          </div>
        </div>

        {allRecipients.length>0&&(
          <div style={{fontSize:11,color:C.dim,marginBottom:10}}>
            To: <span style={{color:C.text}}>{allRecipients.join(", ")}</span>
          </div>
        )}

        <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
          <button onClick={onClose}
            style={{background:"none",border:`1px solid ${C.border}`,borderRadius:8,color:C.dim,
              padding:"8px 16px",fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>Cancel</button>
          <button onClick={send} disabled={!allRecipients.length}
            style={{background:allRecipients.length?C.blue:"#1e2030",border:"none",borderRadius:8,
              color:allRecipients.length?C.text:C.muted,padding:"8px 20px",fontSize:12,fontWeight:700,
              cursor:allRecipients.length?"pointer":"not-allowed",fontFamily:"inherit",transition:"all 0.15s"}}>
            ✉ Open in Mail App
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Atoms ─────────────────────────────────────────────────────
const Pill = ({label,color}) => (
  <span style={{fontSize:10,fontWeight:700,letterSpacing:"0.06em",padding:"2px 8px",borderRadius:99,
    background:`${color}22`,color,border:`1px solid ${color}44`,whiteSpace:"nowrap"}}>{label}</span>
);

const SectionHead = ({label,color=C.dim,action=null}) => (
  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",
    borderBottom:`1px solid ${color}33`,paddingBottom:5,marginBottom:12,marginTop:4}}>
    <div style={{fontSize:10,fontWeight:800,letterSpacing:"0.14em",color,textTransform:"uppercase"}}>{label}</div>
    {action&&<div style={{display:"flex",gap:6}}>{action}</div>}
  </div>
);

const Inp = ({value,onChange,placeholder,style={}}) => (
  <input value={value??""} onChange={onChange} placeholder={placeholder}
    style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:7,color:C.text,
      padding:"6px 10px",fontSize:12,fontFamily:"inherit",width:"100%",outline:"none",...style}}
    onFocus={e=>e.target.style.borderColor=C.accent}
    onBlur={e=>e.target.style.borderColor=C.border}/>
);

const Sel = ({value,onChange,options,style={}}) => (
  <select value={value??""} onChange={onChange}
    style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:7,color:C.text,
      padding:"6px 10px",fontSize:12,fontFamily:"inherit",outline:"none",width:"100%",...style}}>
    {options.map(o=><option key={o.value??o} value={o.value??o}>{o.label??o}</option>)}
  </select>
);

const TA = ({value,onChange,placeholder,rows=3}) => (
  <textarea value={value??""} onChange={onChange} placeholder={placeholder} rows={rows}
    style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:7,color:C.text,
      padding:"7px 10px",fontSize:12,fontFamily:"inherit",width:"100%",outline:"none",resize:"vertical"}}
    onFocus={e=>e.target.style.borderColor=C.accent}
    onBlur={e=>e.target.style.borderColor=C.border}/>
);

const Btn = ({onClick,children,variant="ghost",style={}}) => {
  const vs = {
    ghost:  {background:"none",border:`1px solid ${C.border}`,color:C.dim},
    primary:{background:C.accent,border:"none",color:"#000",fontWeight:700},
    add:    {background:`${C.green}15`,border:`1px dashed ${C.green}55`,color:C.green},
    email:  {background:"none",border:`1px solid ${C.blue}55`,color:C.blue},
  };
  return (
    <button onClick={onClick}
      style={{borderRadius:7,padding:"6px 14px",fontSize:12,cursor:"pointer",fontFamily:"inherit",
        transition:"opacity 0.15s",...vs[variant],...style}}
      onMouseEnter={e=>e.currentTarget.style.opacity=".7"}
      onMouseLeave={e=>e.currentTarget.style.opacity="1"}>
      {children}
    </button>
  );
};

const StageBar = ({stages,current,color}) => {
  const pct = parseInt(current)||0;
  // interpolate red(0%) -> yellow(50%) -> green(100%)
  const r = pct < 50 ? 220 : Math.round(220 - (pct-50)/50 * 186);
  const g = pct < 50 ? Math.round(40 + (pct/50) * 175) : 215;
  const b = 40;
  const barColor = `rgb(${r},${g},${b})`;
  return (
    <div style={{display:"flex",gap:6,alignItems:"center"}}>
      <div style={{flex:1,height:5,background:C.border,borderRadius:99,overflow:"hidden"}}>
        <div style={{height:"100%",width:`${pct}%`,background:barColor,borderRadius:99,transition:"width 0.4s, background 0.4s"}}/>
      </div>
      <span style={{fontSize:10,color:barColor,whiteSpace:"nowrap",fontWeight:600,minWidth:28,textAlign:"right"}}>{current}</span>
    </div>
  );
};

// ── Punch List ────────────────────────────────────────────────
function PunchItems({items, onChange}) {
  const [draft, setDraft] = useState("");
  const add = () => { if(!draft.trim()) return; onChange([...items,{id:uid(),text:draft,done:false}]); setDraft(""); };
  return (
    <div style={{paddingLeft:12}}>
      {items.map(item=>(
        <div key={item.id} style={{display:"flex",alignItems:"center",gap:8,marginBottom:5}}>
          <input type="checkbox" checked={item.done}
            onChange={()=>onChange(items.map(i=>i.id===item.id?{...i,done:!i.done}:i))}
            style={{accentColor:C.green,width:14,height:14,cursor:"pointer",flexShrink:0}}/>
          <span style={{flex:1,fontSize:12,color:item.done?C.muted:C.text,
            textDecoration:item.done?"line-through":"none"}}>{item.text}</span>
          <button onClick={()=>onChange(items.filter(i=>i.id!==item.id))}
            style={{background:"none",border:"none",color:C.muted,cursor:"pointer",fontSize:12}}>✕</button>
        </div>
      ))}
      <div style={{display:"flex",gap:6,marginTop:4}}>
        <Inp value={draft} onChange={e=>setDraft(e.target.value)} placeholder="Add item…" style={{flex:1}}/>
        <Btn onClick={add} variant="primary">+</Btn>
      </div>
    </div>
  );
}

function PunchFloor({floorData, onChange, floorLabel, floorColor}) {
  const norm = (v) => {
    if(v && typeof v==='object' && !Array.isArray(v)) return v;
    return { general: Array.isArray(v) ? v : [], rooms: [] };
  };
  const data    = norm(floorData);
  const general = data.general || [];
  const rooms   = data.rooms   || [];

  const [collapsed, setCollapsed] = useState(false);
  const [roomDraft, setRoomDraft] = useState("");

  const updGeneral = (v) => onChange({...data, general:v});
  const addRoom    = () => {
    if(!roomDraft.trim()) return;
    const newData = {...data, rooms:[...rooms,{id:uid(),name:roomDraft,items:[]}]};
    onChange(newData);
    setRoomDraft("");
  };
  const updRoom = (id, items) => {
    const newData = {...data, rooms:rooms.map(r=>r.id===id?{...r,items}:r)};
    onChange(newData);
  };
  const delRoom = (id) => {
    const newData = {...data, rooms:rooms.filter(r=>r.id!==id)};
    onChange(newData);
  };

  const openCount = general.filter(i=>!i.done).length +
    rooms.reduce((a,r)=>a+(r.items||[]).filter(i=>!i.done).length, 0);

  return (
    <div style={{marginBottom:16,border:`1px solid ${floorColor}33`,borderRadius:10,overflow:"hidden"}}>
      <div onClick={()=>setCollapsed(c=>!c)}
        style={{display:"flex",alignItems:"center",gap:10,padding:"10px 14px",
          background:`${floorColor}10`,cursor:"pointer",userSelect:"none"}}>
        <div style={{width:8,height:8,borderRadius:"50%",background:floorColor,flexShrink:0}}/>
        <span style={{fontWeight:700,fontSize:13,color:floorColor,flex:1}}>{floorLabel}</span>
        {openCount>0&&<span style={{fontSize:10,background:`${C.red}22`,color:C.red,
          borderRadius:99,padding:"2px 8px",fontWeight:700}}>{openCount} open</span>}
        <span style={{color:floorColor,fontSize:12}}>{collapsed?"▸":"▾"}</span>
      </div>

      {!collapsed&&(
        <div style={{padding:"12px 14px"}}>
          <div style={{fontSize:10,color:C.dim,fontWeight:700,letterSpacing:"0.08em",marginBottom:6}}>GENERAL</div>
          <PunchItems items={general} onChange={updGeneral}/>

          {rooms.map(room=>(
            <div key={room.id} style={{marginTop:14,background:C.surface,
              border:`1px solid ${C.border}`,borderRadius:8,padding:10}}>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
                <span style={{fontSize:12,fontWeight:700,color:C.text,flex:1}}>🚪 {room.name}</span>
                {(room.items||[]).filter(i=>!i.done).length>0&&
                  <span style={{fontSize:10,background:`${C.red}22`,color:C.red,
                    borderRadius:99,padding:"2px 6px",fontWeight:700}}>
                    {(room.items||[]).filter(i=>!i.done).length} open
                  </span>}
                <button onClick={()=>delRoom(room.id)}
                  style={{background:"none",border:"none",color:C.muted,cursor:"pointer",fontSize:11}}>✕</button>
              </div>
              <PunchItems items={room.items||[]} onChange={v=>updRoom(room.id,v)}/>
            </div>
          ))}

          <div style={{display:"flex",gap:6,marginTop:12}}>
            <Inp value={roomDraft} onChange={e=>setRoomDraft(e.target.value)}
              placeholder="Add room (e.g. Master Bath)…" style={{flex:1}}
              onKeyDown={e=>e.key==="Enter"&&addRoom()}/>
            <Btn onClick={addRoom} variant="add" style={{whiteSpace:"nowrap"}}>+ Room</Btn>
          </div>
        </div>
      )}
    </div>
  );
}

function PunchSection({punch, onChange, jobName, phase, onEmail}) {
  // normalize: floors can be old array format or new {general,rooms} format
  const norm = (v) => (v && typeof v==='object' && !Array.isArray(v)) ? v : {general: Array.isArray(v)?v:[], rooms:[]};
  const upper    = norm(punch.upper);
  const main     = norm(punch.main);
  const basement = norm(punch.basement);

  const countOpen = (f) => (f.general||[]).filter(i=>!i.done).length +
    (f.rooms||[]).reduce((a,r)=>a+r.items.filter(i=>!i.done).length,0);
  const totalOpen = countOpen(upper)+countOpen(main)+countOpen(basement);

  const flatItems = (f,label) => [
    ...(f.general||[]).filter(i=>!i.done).map(i=>`[${label}] ${i.text}`),
    ...(f.rooms||[]).flatMap(r=>r.items.filter(i=>!i.done).map(i=>`[${label} - ${r.name}] ${i.text}`)),
  ];

  const handleEmail = () => {
    const all = [
      ...flatItems(upper,"Upper"),
      ...flatItems(main,"Main"),
      ...flatItems(basement,"Basement"),
    ];
    const subject = `${jobName} — ${phase} Punch List`;
    const body = `Hi,\n\nOpen ${phase} punch list items for ${jobName}:\n\n${all.map(i=>`• ${i}`).join("\n")}\n\nPlease review and complete.\n\nThanks`;
    onEmail({subject, body});
  };

  return (
    <div>
      <div style={{display:"flex",justifyContent:"flex-end",marginBottom:8}}>
        {totalOpen>0&&(
          <Btn onClick={handleEmail} variant="email" style={{fontSize:11,padding:"4px 10px"}}>
            ✉ Email Punch List ({totalOpen} open)
          </Btn>
        )}
      </div>
      <PunchFloor floorData={upper}    onChange={v=>onChange({...punch,upper:v})}
        floorLabel="Upper Level" floorColor={C.blue}/>
      <PunchFloor floorData={main}     onChange={v=>onChange({...punch,main:v})}
        floorLabel="Main Level"  floorColor={C.accent}/>
      <PunchFloor floorData={basement} onChange={v=>onChange({...punch,basement:v})}
        floorLabel="Basement"    floorColor={C.purple}/>
    </div>
  );
}

// ── Material Orders ───────────────────────────────────────────
function MaterialOrders({orders,onChange}) {
  const add = () => onChange([...orders,{id:uid(),date:"",po:"",pickupDate:"",items:""}]);
  const upd = (id,p) => onChange(orders.map(o=>o.id===id?{...o,...p}:o));
  const del = (id)   => onChange(orders.filter(o=>o.id!==id));
  return (
    <div>
      {orders.map((o,i)=>(
        <div key={o.id} style={{background:C.surface,border:`1px solid ${C.border}`,
          borderRadius:10,padding:14,marginBottom:12}}>
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:10}}>
            <span style={{fontSize:12,color:C.accent,fontWeight:700}}>PO #{i+1}</span>
            <button onClick={()=>del(o.id)}
              style={{background:"none",border:"none",color:C.muted,cursor:"pointer",fontSize:11}}>Remove</button>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:10}}>
            {[["date","Date Ordered","MM/DD/YY"],["po","PO #","PO-001"],["pickupDate","Pick Up Date","MM/DD/YY"]].map(([k,l,ph])=>(
              <div key={k}>
                <div style={{fontSize:10,color:C.dim,marginBottom:3}}>{l}</div>
                <Inp value={o[k]} onChange={e=>upd(o.id,{[k]:e.target.value})} placeholder={ph}/>
              </div>
            ))}
          </div>
          <div style={{fontSize:10,color:C.dim,marginBottom:4}}>Material List <span style={{color:C.muted}}>(copy & paste into Simpro)</span></div>
          <TA value={o.items} onChange={e=>upd(o.id,{items:e.target.value})}
            placeholder={"- 20A breaker x4\n- 12/2 wire 250ft"} rows={4}/>
        </div>
      ))}
      <Btn onClick={add} variant="ghost" style={{width:"100%",borderStyle:"dashed"}}>+ Add PO</Btn>
    </div>
  );
}

// ── Daily Updates ─────────────────────────────────────────────
function DailyUpdates({updates,onChange,jobName,onEmail}) {
  const [d,setD] = useState({date:"",text:""});
  const add = () => { if(!d.text.trim()) return; onChange([{id:uid(),...d},...updates]); setD({date:"",text:""}); };
  const handleEmail = () => {
    const recent = updates.slice(0,5);
    const body = `Hi,\n\nJob Update — ${jobName}\n\n${recent.map(u=>`${u.date||"—"}: ${u.text}`).join("\n\n")}\n\nThanks`;
    onEmail({subject:`${jobName} — Job Update`, body});
  };
  return (
    <div>
      <div style={{display:"flex",justifyContent:"flex-end",marginBottom:8}}>
        {updates.length>0&&(
          <Btn onClick={handleEmail} variant="email" style={{fontSize:11,padding:"4px 10px"}}>✉ Email Updates</Btn>
        )}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"130px 1fr auto",gap:8,marginBottom:12,alignItems:"flex-end"}}>
        <div>
          <div style={{fontSize:10,color:C.dim,marginBottom:3}}>Date</div>
          <Inp value={d.date} onChange={e=>setD(p=>({...p,date:e.target.value}))} placeholder="MM/DD/YY"/>
        </div>
        <div>
          <div style={{fontSize:10,color:C.dim,marginBottom:3}}>Update</div>
          <Inp value={d.text} onChange={e=>setD(p=>({...p,text:e.target.value}))}
            placeholder="Key items completed and where the job is at…"/>
        </div>
        <Btn onClick={add} variant="primary">+ Log</Btn>
      </div>
      {updates.map(u=>(
        <div key={u.id} style={{display:"flex",gap:10,padding:"8px 12px",background:C.surface,
          borderRadius:8,marginBottom:6,border:`1px solid ${C.border}`}}>
          <span style={{fontSize:11,color:C.accent,whiteSpace:"nowrap",fontWeight:600,flexShrink:0}}>{u.date||"—"}</span>
          <span style={{flex:1,fontSize:12,color:C.text,lineHeight:1.5}}>{u.text}</span>
          <button onClick={()=>onChange(updates.filter(x=>x.id!==u.id))}
            style={{background:"none",border:"none",color:C.muted,cursor:"pointer",fontSize:11,flexShrink:0}}>✕</button>
        </div>
      ))}
    </div>
  );
}

// ── Change Orders ─────────────────────────────────────────────
function ChangeOrders({orders,onChange,jobName,onEmail}) {
  const add = () => onChange([...orders,{id:uid(),date:"",desc:"",task:"",material:"",time:"",status:"Pending",sendTo:""}]);
  const upd = (id,p) => onChange(orders.map(o=>o.id===id?{...o,...p}:o));
  const del = (id)   => onChange(orders.filter(o=>o.id!==id));
  const sc  = {"Pending":C.accent,"CO Created":C.orange,"CO Sent (office)":C.blue,
               "Approved":C.green,"Denied":C.red,"Work Completed":C.purple};

  const emailCO = (o, i) => {
    const subject = `${jobName} — Change Order #${i+1}`;
    const body = `Hi,\n\nChange Order #${i+1} — ${jobName}\n\nDate: ${o.date||"—"}\nSend CO To: ${o.sendTo||"—"}\nDescription: ${o.desc||"—"}\nTask: ${o.task||"—"}\nMaterial Needed: ${o.material||"—"}\nEstimated Time: ${o.time||"—"}\nStatus: ${o.status}\n\nPlease review and confirm.\n\nThanks`;
    onEmail({subject, body});
  };

  return (
    <div>
      {orders.map((o,i)=>(
        <div key={o.id} style={{background:C.surface,border:`1px solid ${C.border}`,
          borderRadius:10,padding:14,marginBottom:12}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
            <span style={{fontSize:12,color:C.accent,fontWeight:700}}>CO #{i+1}</span>
            <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
              <Pill label={o.status} color={sc[o.status]||C.dim}/>
              <Btn onClick={()=>emailCO(o,i)} variant="email" style={{fontSize:11,padding:"3px 9px"}}>✉ Email CO</Btn>
              <button onClick={()=>del(o.id)}
                style={{background:"none",border:"none",color:C.muted,cursor:"pointer",fontSize:11}}>Remove</button>
            </div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
            <div>
              <div style={{fontSize:10,color:C.dim,marginBottom:3}}>Date Created</div>
              <Inp value={o.date} onChange={e=>upd(o.id,{date:e.target.value})} placeholder="MM/DD/YY"/>
            </div>
            <div>
              <div style={{fontSize:10,color:C.dim,marginBottom:3}}>Status</div>
              <Sel value={o.status} onChange={e=>upd(o.id,{status:e.target.value})} options={CO_STATUSES}/>
            </div>
          </div>
          <div style={{marginBottom:8}}>
            <div style={{fontSize:10,color:C.dim,marginBottom:3}}>Send CO To</div>
            <Inp value={o.sendTo||""} onChange={e=>upd(o.id,{sendTo:e.target.value})}
              placeholder="e.g. John Smith / GC / Homeowner…"/>
          </div>
          <div style={{marginBottom:8}}>
            <div style={{fontSize:10,color:C.dim,marginBottom:3}}>Description of Task</div>
            <Inp value={o.desc} onChange={e=>upd(o.id,{desc:e.target.value})} placeholder="Describe the change order…"/>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
            {[["task","Task (In Field)","Field task"],["material","Material Needed","Materials…"],["time","Estimated Time","e.g. 3 hrs"]].map(([k,l,ph])=>(
              <div key={k}>
                <div style={{fontSize:10,color:C.dim,marginBottom:3}}>{l}</div>
                <Inp value={o[k]} onChange={e=>upd(o.id,{[k]:e.target.value})} placeholder={ph}/>
              </div>
            ))}
          </div>
        </div>
      ))}
      <Btn onClick={add} variant="ghost" style={{width:"100%",borderStyle:"dashed"}}>+ Add Change Order</Btn>
    </div>
  );
}

// ── Return Trips ──────────────────────────────────────────────
function ReturnTrips({trips,onChange,jobName,onEmail}) {
  const add = () => onChange([...trips,{id:uid(),date:"",scope:"",material:"",punch:[],photos:[]}]);
  const upd = (id,p) => onChange(trips.map(t=>t.id===id?{...t,...p}:t));
  const del = (id)   => onChange(trips.filter(t=>t.id!==id));

  const emailTrip = (t,i) => {
    const punchLines = (t.punch||[]).filter(p=>!p.done).map(p=>`• ${p.text}`).join("\n") || "None";
    const subject = `${jobName} — Return Trip #${i+1}`;
    const body = `Hi,\n\nReturn Trip #${i+1} — ${jobName}\n\nDate: ${t.date||"—"}\nScope of Work:\n${t.scope||"—"}\n\nMaterial Needed:\n${t.material||"—"}\n\nPunch List:\n${punchLines}\n\nThanks`;
    onEmail({subject, body});
  };

  const addPhotos = (id, files) => {
    const trip = trips.find(t=>t.id===id);
    const existing = trip?.photos||[];
    let done=0; const newPhotos=[];
    Array.from(files).forEach(file=>{
      const reader = new FileReader();
      reader.onload = ev => {
        newPhotos.push({id:uid(),name:file.name,dataUrl:ev.target.result});
        done++;
        if(done===files.length) upd(id,{photos:[...existing,...newPhotos]});
      };
      reader.readAsDataURL(file);
    });
  };

  return (
    <div>
      {trips.map((t,i)=>(
        <div key={t.id} style={{background:C.surface,border:`1px solid ${C.border}`,
          borderRadius:10,padding:14,marginBottom:14}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
            <span style={{fontSize:12,color:C.purple,fontWeight:700}}>Return Trip #{i+1}</span>
            <div style={{display:"flex",gap:8}}>
              <Btn onClick={()=>emailTrip(t,i)} variant="email" style={{fontSize:11,padding:"3px 9px"}}>✉ Email Trip</Btn>
              <button onClick={()=>del(t.id)}
                style={{background:"none",border:"none",color:C.muted,cursor:"pointer",fontSize:11}}>Remove</button>
            </div>
          </div>
          <div style={{marginBottom:8}}>
            <div style={{fontSize:10,color:C.dim,marginBottom:3}}>Date</div>
            <Inp value={t.date} onChange={e=>upd(t.id,{date:e.target.value})} placeholder="MM/DD/YY"/>
          </div>
          <div style={{marginBottom:8}}>
            <div style={{fontSize:10,color:C.dim,marginBottom:3}}>Scope of Work</div>
            <TA value={t.scope} onChange={e=>upd(t.id,{scope:e.target.value})} placeholder="Describe return trip scope…" rows={2}/>
          </div>
          <div style={{marginBottom:8}}>
            <div style={{fontSize:10,color:C.dim,marginBottom:3}}>Material Needed</div>
            <TA value={t.material} onChange={e=>upd(t.id,{material:e.target.value})} placeholder="List materials needed…" rows={2}/>
          </div>
          <div style={{fontSize:10,color:C.dim,fontWeight:700,marginBottom:6,letterSpacing:"0.08em"}}>PUNCH LIST</div>
          <PunchItems items={t.punch||[]} onChange={v=>upd(t.id,{punch:v})}/>
          <div style={{marginTop:14}}>
            <div style={{fontSize:10,color:C.dim,fontWeight:700,marginBottom:8,letterSpacing:"0.08em"}}>PHOTOS</div>
            {(t.photos||[]).length>0&&(
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(90px,1fr))",gap:8,marginBottom:10}}>
                {(t.photos||[]).map(p=>(
                  <div key={p.id} style={{position:"relative"}}>
                    <img src={p.dataUrl} alt={p.name}
                      onClick={()=>{const w=window.open("","_blank");w.document.write(`<html><body style="margin:0;background:#000"><img src="${p.dataUrl}" style="max-width:100%;max-height:100vh;display:block;margin:auto"></body></html>`);}}
                      style={{width:"100%",aspectRatio:"1",objectFit:"cover",borderRadius:8,
                        border:`1px solid ${C.border}`,cursor:"pointer"}}/>
                    <button onClick={()=>upd(t.id,{photos:(t.photos||[]).filter(x=>x.id!==p.id)})}
                      style={{position:"absolute",top:3,right:3,background:"rgba(0,0,0,0.7)",
                        border:"none",borderRadius:"50%",color:"#fff",width:20,height:20,
                        cursor:"pointer",fontSize:11,display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
                  </div>
                ))}
              </div>
            )}
            <label style={{display:"flex",alignItems:"center",gap:8,padding:"8px 12px",
              background:`${C.purple}12`,border:`1px dashed ${C.purple}55`,borderRadius:8,
              cursor:"pointer",fontSize:12,color:C.purple,fontWeight:600}}>
              📷 Add Photos
              <input type="file" accept="image/*" multiple style={{display:"none"}}
                onChange={e=>{addPhotos(t.id,e.target.files);e.target.value="";}}/>
            </label>
          </div>
        </div>
      ))}
      <Btn onClick={add} variant="ghost" style={{width:"100%",borderStyle:"dashed"}}>+ Add Return Trip</Btn>
    </div>
  );
}

// ── Home Runs ─────────────────────────────────────────────────
function HomeRunLevel({rows,onChange,label}) {
  const WIRE_ORDER = {"":0,"14 AWG":1,"12 AWG":2,"10 AWG":3,"8 AWG":4,"6 AWG":5,"4 AWG":6,"2 AWG":7,"1/0":8,"2/0":9,"3/0":10,"4/0":11};
  const sortByWire = (arr) => [...arr].sort((a,b)=>(WIRE_ORDER[a.wire]||0)-(WIRE_ORDER[b.wire]||0)).map((r,i)=>({...r,num:i+1}));
  const upd    = (id,p) => { const updated = rows.map(r=>r.id===id?{...r,...p}:r); onChange('wire' in p ? sortByWire(updated) : updated); };
  const addRow = () => onChange([...rows, newHRRow(rows.length+1)]);
  const delRow = (id) => {
    const filtered = rows.filter(r=>r.id!==id).map((r,i)=>({...r,num:i+1}));
    onChange(filtered);
  };
  return (
    <div style={{marginBottom:24}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
        <div style={{fontSize:12,color:C.blue,fontWeight:700,letterSpacing:"0.06em"}}>{label}</div>
        <Btn onClick={addRow} variant="add" style={{fontSize:11,padding:"3px 10px"}}>+ Add Row</Btn>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"36px 100px 1fr 90px 28px",gap:6,marginBottom:6,padding:"0 2px"}}>
        {["#","Wire Size","Load Name","Status",""].map((h,i)=>(
          <div key={i} style={{fontSize:10,color:C.dim,fontWeight:700,letterSpacing:"0.08em"}}>{h}</div>
        ))}
      </div>
      {rows.map(r=>(
        <div key={r.id} style={{display:"grid",gridTemplateColumns:"36px 100px 1fr 90px 28px",
          gap:6,marginBottom:4,alignItems:"center"}}>
          <span style={{fontSize:11,color:C.muted,textAlign:"right",paddingRight:6}}>{r.num}.</span>
          <Sel value={r.wire}   onChange={e=>upd(r.id,{wire:e.target.value})}   options={WIRE_SIZES}/>
          <Inp value={r.name}   onChange={e=>upd(r.id,{name:e.target.value})}   placeholder="Load name…"/>
          <Sel value={r.status} onChange={e=>upd(r.id,{status:e.target.value})} options={PULLED_OPTS}
            style={{color:r.status==="Pulled"?C.green:C.text}}/>
          <button onClick={()=>delRow(r.id)}
            style={{background:"none",border:"none",color:C.muted,cursor:"pointer",fontSize:13,padding:"0 2px"}}>✕</button>
        </div>
      ))}
    </div>
  );
}

function HomeRunsTab({homeRuns,panelCounts,onHRChange,onCountChange}) {
  return (
    <div>
      <SectionHead label="Home Runs" color={C.blue}/>
      {[["main","Main Level Loads"],["basement","Basement Level Loads"],["upper","Upper Level Loads"]].map(([k,l])=>(
        <HomeRunLevel key={k} label={l} rows={homeRuns[k]||[]}
          onChange={v=>onHRChange({...homeRuns,[k]:v})}/>
      ))}
      <SectionHead label="Panel Breaker Counts" color={C.blue}/>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
        {[["meter","Meter Breaker Count"],["panelA","Panel A Breaker Count"],
          ["panelB","Panel B Breaker Count"],["dedicated","Dedicated Loads Panel Breaker Count"]].map(([k,l])=>(
          <div key={k}>
            <div style={{fontSize:10,color:C.dim,marginBottom:4}}>{l}</div>
            <Inp value={panelCounts[k]} onChange={e=>onCountChange({...panelCounts,[k]:e.target.value})} placeholder="Count…"/>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Panelized Lighting ────────────────────────────────────────
function KeypadSection({loads,onChange,label}) {
  const upd    = (id,p) => onChange(loads.map(r=>r.id===id?{...r,...p}:r));
  const addRow = () => onChange([...loads, newKPRow(loads.length+1)]);
  const delRow = (id) => onChange(loads.filter(r=>r.id!==id).map((r,i)=>({...r,num:i+1})));
  return (
    <div style={{marginBottom:22}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
        <div style={{fontSize:12,color:C.purple,fontWeight:700}}>{label}</div>
        <Btn onClick={addRow} variant="add" style={{fontSize:11,padding:"3px 10px"}}>+ Add Row</Btn>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"36px 1fr 28px",gap:6,marginBottom:6}}>
        {["#","Keypad Load Name",""].map((h,i)=>(
          <div key={i} style={{fontSize:10,color:C.dim,fontWeight:700,letterSpacing:"0.08em"}}>{h}</div>
        ))}
      </div>
      {loads.map(r=>(
        <div key={r.id} style={{display:"grid",gridTemplateColumns:"36px 1fr 28px",gap:6,marginBottom:4,alignItems:"center"}}>
          <span style={{fontSize:11,color:C.muted,textAlign:"right",paddingRight:6}}>{r.num}.</span>
          <Inp value={r.name} onChange={e=>upd(r.id,{name:e.target.value})} placeholder="Load name…"/>
          <button onClick={()=>delRow(r.id)}
            style={{background:"none",border:"none",color:C.muted,cursor:"pointer",fontSize:13,padding:"0 2px"}}>✕</button>
        </div>
      ))}
    </div>
  );
}

function CP4LoadsSection({loads,onChange}) {
  const upd    = (id,p) => onChange(loads.map(r=>r.id===id?{...r,...p}:r));
  const addRow = () => onChange([...loads, newCP4Row(loads.length+1)]);
  const delRow = (id) => onChange(loads.filter(r=>r.id!==id).map((r,i)=>({...r,num:i+1})));
  return (
    <div style={{marginBottom:22}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
        <div style={{fontSize:12,color:C.purple,fontWeight:700}}>Lighting Control Panel Loads (Control 4)</div>
        <Btn onClick={addRow} variant="add" style={{fontSize:11,padding:"3px 10px"}}>+ Add Row</Btn>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"36px 1fr 90px 90px 28px",gap:6,marginBottom:6}}>
        {["#","Load Name","Module #","Status",""].map((h,i)=>(
          <div key={i} style={{fontSize:10,color:C.dim,fontWeight:700,letterSpacing:"0.08em"}}>{h}</div>
        ))}
      </div>
      {loads.map(r=>(
        <div key={r.id} style={{display:"grid",gridTemplateColumns:"36px 1fr 90px 90px 28px",
          gap:6,marginBottom:4,alignItems:"center"}}>
          <span style={{fontSize:11,color:C.muted,textAlign:"right",paddingRight:6}}>{r.num}.</span>
          <Inp value={r.name}   onChange={e=>upd(r.id,{name:e.target.value})}   placeholder="Load name…"/>
          <Inp value={r.module} onChange={e=>upd(r.id,{module:e.target.value})} placeholder="Module…"/>
          <Sel value={r.status} onChange={e=>upd(r.id,{status:e.target.value})} options={PULLED_OPTS}
            style={{color:r.status==="Pulled"?C.green:C.text}}/>
          <button onClick={()=>delRow(r.id)}
            style={{background:"none",border:"none",color:C.muted,cursor:"pointer",fontSize:13,padding:"0 2px"}}>✕</button>
        </div>
      ))}
    </div>
  );
}

// ── Tape Light ────────────────────────────────────────────────
function TapeLightSection({lights,onChange}) {
  const emptyTL  = () => ({id:uid(),loadName:"",driverLoc:"",length:"",trackLense:"",driverSize:""});
  const add      = () => onChange([...lights, emptyTL()]);
  const upd      = (id,p) => onChange(lights.map(l=>l.id===id?{...l,...p}:l));
  const del      = (id)   => onChange(lights.filter(l=>l.id!==id));
  return (
    <div>
      <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:10,
        padding:12,marginBottom:16,fontSize:11,color:C.dim,lineHeight:1.8}}>
        <div style={{color:C.teal,fontWeight:700,marginBottom:4,fontSize:12}}>GM Tape Lighting Specs</div>
        <div>Driver Sizing: <span style={{color:C.text}}>1.5W per foot of GM tape light</span></div>
        <div>Routered / visible → <span style={{color:C.text}}>order track w/ flange</span></div>
        <div>Behind cabinet lip → <span style={{color:C.text}}>order standard GM track</span></div>
        <div style={{marginTop:4,color:C.dim,fontWeight:600}}>Driver Sizes: 20W · 40W · 60W · 96W · 192W · 288W</div>
      </div>
      {lights.map((l,i)=>(
        <div key={l.id} style={{background:C.surface,border:`1px solid ${C.border}`,
          borderRadius:10,padding:14,marginBottom:12}}>
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:10}}>
            <span style={{fontSize:12,color:C.teal,fontWeight:700}}>Tape Light #{i+1}</span>
            <button onClick={()=>del(l.id)}
              style={{background:"none",border:"none",color:C.muted,cursor:"pointer",fontSize:11}}>Remove</button>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
            <div>
              <div style={{fontSize:10,color:C.dim,marginBottom:3}}>Load Name</div>
              <Inp value={l.loadName} onChange={e=>upd(l.id,{loadName:e.target.value})} placeholder="e.g. Kitchen Under-Cabinet"/>
            </div>
            <div>
              <div style={{fontSize:10,color:C.dim,marginBottom:3}}>Driver Location</div>
              <Inp value={l.driverLoc} onChange={e=>upd(l.id,{driverLoc:e.target.value})} placeholder="Location…"/>
            </div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
            <div>
              <div style={{fontSize:10,color:C.dim,marginBottom:3}}>Length of Tape</div>
              <Inp value={l.length} onChange={e=>upd(l.id,{length:e.target.value})} placeholder="e.g. 24ft"/>
            </div>
            <div>
              <div style={{fontSize:10,color:C.dim,marginBottom:3}}>Track + Lense Finish</div>
              <Inp value={l.trackLense} onChange={e=>upd(l.id,{trackLense:e.target.value})} placeholder="Flange / Standard…"/>
            </div>
            <div>
              <div style={{fontSize:10,color:C.dim,marginBottom:3}}>Driver Size Needed</div>
              <Sel value={l.driverSize} onChange={e=>upd(l.id,{driverSize:e.target.value})} options={DRIVER_SIZES}/>
            </div>
          </div>
        </div>
      ))}
      <Btn onClick={add} variant="ghost" style={{width:"100%",borderStyle:"dashed"}}>+ Add Tape Light Location</Btn>
    </div>
  );
}

// ── Plans & Links with PDF upload ────────────────────────────
const LINK_FIELDS = [
  ["planLink","Plans"],["redlineLink","Redline Walk / CO List"],
  ["lightingLink","Lighting Schedules"],["panelLink","Panel Schedules"],
  ["qcLink","QC Link"],["matterportLink","Matterport Link"],
];

function PlansTab({job, onUpdate}) {
  const fileRef = useRef();
  const [uploading, setUploading] = useState(false);

  const handleFileUpload = (e) => {
    const files = Array.from(e.target.files);
    if(!files.length) return;
    setUploading(true);
    let done = 0;
    const newFiles = [];
    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        newFiles.push({ id:uid(), name:file.name, dataUrl:ev.target.result, size:file.size });
        done++;
        if(done===files.length) {
          onUpdate({uploadedFiles:[...(job.uploadedFiles||[]),...newFiles]});
          setUploading(false);
        }
      };
      reader.readAsDataURL(file);
    });
    e.target.value = "";
  };

  const removeFile = (id) => onUpdate({uploadedFiles:(job.uploadedFiles||[]).filter(f=>f.id!==id)});

  const openPDF = (f) => {
    const win = window.open("","_blank");
    win.document.write(`<html><body style="margin:0;background:#111">
      <iframe src="${f.dataUrl}" style="width:100vw;height:100vh;border:none"></iframe>
      </body></html>`);
  };

  const fmtSize = (bytes) => bytes>1048576?`${(bytes/1048576).toFixed(1)} MB`:`${(bytes/1024).toFixed(0)} KB`;

  return (
    <div>
      <SectionHead label="Plans + Job Links" color={C.green}/>
      {LINK_FIELDS.map(([k,l])=>(
        <div key={k} style={{marginBottom:12}}>
          <div style={{fontSize:10,color:C.dim,marginBottom:3}}>{l}</div>
          <div style={{display:"flex",gap:8}}>
            <Inp value={job[k]||""} onChange={e=>onUpdate({[k]:e.target.value})} placeholder="Paste URL…"/>
            {job[k]&&(
              <a href={job[k]} target="_blank" rel="noreferrer"
                style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:7,
                  color:C.blue,padding:"6px 12px",fontSize:12,textDecoration:"none",whiteSpace:"nowrap"}}>
                Open ↗
              </a>
            )}
          </div>
        </div>
      ))}

      <div style={{marginTop:24}}>
        <SectionHead label="Uploaded PDFs & Files" color={C.green}/>
        <div
          onClick={()=>fileRef.current?.click()}
          style={{border:`2px dashed ${C.muted}`,borderRadius:10,padding:"24px 16px",
            textAlign:"center",cursor:"pointer",marginBottom:16,transition:"border-color 0.2s",
            background:C.surface}}
          onMouseEnter={e=>e.currentTarget.style.borderColor=C.green}
          onMouseLeave={e=>e.currentTarget.style.borderColor=C.muted}>
          <div style={{fontSize:24,marginBottom:6}}>📄</div>
          <div style={{fontSize:13,color:C.text,fontWeight:600}}>
            {uploading?"Uploading…":"Click to upload PDFs or files"}
          </div>
          <div style={{fontSize:11,color:C.dim,marginTop:4}}>Plans, schedules, specs — any file type</div>
        </div>
        <input ref={fileRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.dwg,.xlsx,.docx"
          multiple style={{display:"none"}} onChange={handleFileUpload}/>

        {(job.uploadedFiles||[]).length===0&&(
          <div style={{textAlign:"center",color:C.muted,fontSize:12,padding:"12px 0"}}>
            No files uploaded yet
          </div>
        )}

        {(job.uploadedFiles||[]).map(f=>(
          <div key={f.id} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 12px",
            background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,marginBottom:8}}>
            <span style={{fontSize:20,flexShrink:0}}>
              {f.name.endsWith(".pdf")?"📕":f.name.match(/\.(png|jpg|jpeg)$/i)?"🖼️":"📎"}
            </span>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:12,fontWeight:600,color:C.text,overflow:"hidden",
                textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{f.name}</div>
              {f.size&&<div style={{fontSize:10,color:C.dim,marginTop:1}}>{fmtSize(f.size)}</div>}
            </div>
            <button onClick={()=>openPDF(f)}
              style={{background:"none",border:`1px solid ${C.blue}55`,borderRadius:6,
                color:C.blue,cursor:"pointer",padding:"4px 10px",fontSize:11,fontFamily:"inherit"}}>
              View
            </button>
            <button onClick={()=>removeFile(f.id)}
              style={{background:"none",border:"none",color:C.muted,cursor:"pointer",fontSize:14,padding:"0 4px"}}>✕</button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Job Detail Modal ──────────────────────────────────────────
const TABS = ["Rough","Finish","Home Runs","Panelized Lighting","Tape Light",
              "Change Orders","Return Trips","Plans & Links","Job Info"];

function JobDetail({job, onUpdate, onClose}) {
  const [tab, setTab]       = useState("Rough");
  const [emailData, setEmailData] = useState(null);
  const u = patch => onUpdate({...job,...patch});

  const openCount =
    [job.roughPunch,job.finishPunch]
      .flatMap(p=>[...(p.upper||[]),...(p.main||[]),...(p.basement||[])])
      .filter(i=>!i.done).length;
  const pendingCOs = job.changeOrders.filter(c=>c.status==="Pending").length;

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.82)",zIndex:200,
      display:"flex",alignItems:"center",justifyContent:"center",padding:12}}>
      <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:18,width:"100%",
        maxWidth:940,maxHeight:"93vh",display:"flex",flexDirection:"column",overflow:"hidden",
        boxShadow:"0 40px 100px rgba(0,0,0,0.7)"}}>

        {/* Header */}
        <div style={{padding:"16px 22px",borderBottom:`1px solid ${C.border}`,display:"flex",
          justifyContent:"space-between",alignItems:"center",flexShrink:0,gap:12,flexWrap:"wrap"}}>
          <div>
            <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:22,letterSpacing:"0.06em",color:C.text,lineHeight:1}}>
              {job.name||"New Job"}
            </div>
            <div style={{fontSize:11,color:C.dim,marginTop:2}}>
              {[job.address,job.gc].filter(Boolean).join(" · ")||"No details yet"}
            </div>
          </div>
          <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap",justifyContent:"flex-end"}}>
            {openCount>0  &&<Pill label={`${openCount} open punch`} color={C.red}/>}
            {pendingCOs>0 &&<Pill label={`${pendingCOs} CO pending`} color={C.purple}/>}
            <button onClick={onClose}
              style={{background:"none",border:`1px solid ${C.border}`,borderRadius:8,
                color:C.dim,cursor:"pointer",padding:"5px 14px",fontSize:13}}>✕</button>
          </div>
        </div>

        {/* Tabs */}
        <div style={{display:"flex",gap:1,padding:"8px 22px 0",borderBottom:`1px solid ${C.border}`,
          flexShrink:0,overflowX:"auto",scrollbarWidth:"none"}}>
          {TABS.map(t=>(
            <button key={t} onClick={()=>setTab(t)}
              style={{background:tab===t?C.accent:"none",color:tab===t?"#000":C.dim,
                border:"none",borderRadius:"8px 8px 0 0",padding:"6px 13px",fontSize:11,
                fontWeight:tab===t?700:400,cursor:"pointer",fontFamily:"inherit",
                whiteSpace:"nowrap",transition:"all 0.15s"}}>
              {t}
            </button>
          ))}
        </div>

        {/* Body */}
        <div style={{flex:1,overflowY:"auto",padding:"20px 22px"}}>

          {tab==="Rough"&&(
            <div>
              <SectionHead label="Rough Stage" color={C.rough}/>
              <Sel value={job.roughStage} onChange={e=>u({roughStage:e.target.value})} options={ROUGH_STAGES}/>
              <div style={{marginTop:8,marginBottom:20}}>
                <StageBar stages={ROUGH_STAGES} current={job.roughStage} color={C.rough}/>
              </div>
              <SectionHead label="Punch List" color={C.rough}/>
              <PunchSection punch={job.roughPunch} onChange={v=>u({roughPunch:v})}
                jobName={job.name||"This Job"} phase="Rough" onEmail={setEmailData}/>
              <div style={{marginTop:20}}>
                <SectionHead label="Material Tracking — Purchase Orders → Simpro" color={C.rough}/>
                <MaterialOrders orders={job.roughMaterials} onChange={v=>u({roughMaterials:v})}/>
              </div>
              <div style={{marginTop:20}}>
                <SectionHead label="Daily Job Updates" color={C.rough}/>
                <DailyUpdates updates={job.roughUpdates} onChange={v=>u({roughUpdates:v})}
                  jobName={job.name||"This Job"} onEmail={setEmailData}/>
              </div>
              <div style={{marginTop:20}}>
                <SectionHead label="Questions" color={C.rough}/>
                <QASection
                  questions={job.roughQuestions||{upper:[],main:[],basement:[]}}
                  onChange={v=>u({roughQuestions:v})}
                  color={C.rough}/>
              </div>
              <div style={{marginTop:20}}>
                <SectionHead label="Notes (GC / Homeowner / Designer)" color={C.rough}/>
                <TA value={job.roughNotes} onChange={e=>u({roughNotes:e.target.value})}
                  placeholder="Document any changes from plans, conversations with GC, homeowner, or designer…" rows={5}/>
              </div>
            </div>
          )}

          {tab==="Finish"&&(
            <div>
              <SectionHead label="Finish Stage" color={C.finish}/>
              <Sel value={job.finishStage} onChange={e=>u({finishStage:e.target.value})} options={FINISH_STAGES}/>
              <div style={{marginTop:8,marginBottom:20}}>
                <StageBar stages={FINISH_STAGES} current={job.finishStage} color={C.finish}/>
              </div>
              <SectionHead label="Punch List" color={C.finish}/>
              <PunchSection punch={job.finishPunch} onChange={v=>u({finishPunch:v})}
                jobName={job.name||"This Job"} phase="Finish" onEmail={setEmailData}/>
              <div style={{marginTop:20}}>
                <SectionHead label="Finish Material Tracking — Purchase Orders → Simpro" color={C.finish}/>
                <MaterialOrders orders={job.finishMaterials} onChange={v=>u({finishMaterials:v})}/>
              </div>
              <div style={{marginTop:20}}>
                <SectionHead label="Finish Daily Job Updates" color={C.finish}/>
                <DailyUpdates updates={job.finishUpdates} onChange={v=>u({finishUpdates:v})}
                  jobName={job.name||"This Job"} onEmail={setEmailData}/>
              </div>
              <div style={{marginTop:20}}>
                <SectionHead label="Questions" color={C.finish}/>
                <QASection
                  questions={job.finishQuestions||{upper:[],main:[],basement:[]}}
                  onChange={v=>u({finishQuestions:v})}
                  color={C.finish}/>
              </div>
              <div style={{marginTop:20}}>
                <SectionHead label="Finish Notes (GC / Homeowner / Designer)" color={C.finish}/>
                <TA value={job.finishNotes} onChange={e=>u({finishNotes:e.target.value})}
                  placeholder="Document any changes from plans…" rows={5}/>
              </div>
            </div>
          )}

          {tab==="Home Runs"&&(
            <HomeRunsTab homeRuns={job.homeRuns} panelCounts={job.panelCounts}
              onHRChange={v=>u({homeRuns:v})} onCountChange={v=>u({panelCounts:v})}/>
          )}

          {tab==="Panelized Lighting"&&(
            <div>
              {/* Lighting Control System Selector */}
              <SectionHead label="Lighting Control System" color={C.purple}/>
              <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:16}}>
                {["Control 4","Lutron","Savant","Crestron","Other"].map(sys=>(
                  <button key={sys} onClick={()=>u({lightingSystem:sys})}
                    style={{padding:"6px 14px",borderRadius:8,fontSize:12,cursor:"pointer",
                      fontFamily:"inherit",transition:"all 0.15s",
                      background:(job.lightingSystem||"Control 4")===sys?C.purple:`${C.purple}15`,
                      border:`1px solid ${(job.lightingSystem||"Control 4")===sys?C.purple:`${C.purple}33`}`,
                      color:(job.lightingSystem||"Control 4")===sys?"#fff":C.dim,
                      fontWeight:(job.lightingSystem||"Control 4")===sys?700:400}}>
                    {sys}
                  </button>
                ))}
              </div>
              {(job.lightingSystem||"Control 4")==="Other"&&(
                <div style={{marginBottom:16}}>
                  <div style={{fontSize:10,color:C.dim,marginBottom:4}}>System Name</div>
                  <Inp value={job.lightingSystemOther||""} onChange={e=>u({lightingSystemOther:e.target.value})}
                    placeholder="Enter lighting control system name…"/>
                </div>
              )}
              <SectionHead label={`${job.lightingSystem||"Control 4"} Keypads`} color={C.purple}/>
              <KeypadSection label="Main Level Keypad Loads"
                loads={job.panelizedLighting.mainKeypad}
                onChange={v=>u({panelizedLighting:{...job.panelizedLighting,mainKeypad:v}})}/>
              <KeypadSection label="Basement Keypad Loads"
                loads={job.panelizedLighting.basementKeypad}
                onChange={v=>u({panelizedLighting:{...job.panelizedLighting,basementKeypad:v}})}/>
              <KeypadSection label="Upper Level Keypad Loads"
                loads={job.panelizedLighting.upperKeypad}
                onChange={v=>u({panelizedLighting:{...job.panelizedLighting,upperKeypad:v}})}/>
              <SectionHead label={`${job.lightingSystem||"Control 4"} Panel Loads`} color={C.purple}/>
              <CP4LoadsSection loads={job.panelizedLighting.cp4Loads}
                onChange={v=>u({panelizedLighting:{...job.panelizedLighting,cp4Loads:v}})}/>
            </div>
          )}

          {tab==="Tape Light"&&(
            <div>
              <SectionHead label="Tape Light Locations" color={C.teal}/>
              <TapeLightSection lights={job.tapeLights||[]} onChange={v=>u({tapeLights:v})}/>
              <div style={{marginTop:20}}>
                <SectionHead label="Load Mapping Notes" color={C.teal}/>
                <TA value={job.loadMappingNotes||""} onChange={e=>u({loadMappingNotes:e.target.value})}
                  placeholder="Load mapping notes…" rows={5}/>
              </div>
            </div>
          )}

          {tab==="Change Orders"&&(
            <div>
              <SectionHead label="Change Order Log" color={C.accent}/>
              <ChangeOrders orders={job.changeOrders} onChange={v=>u({changeOrders:v})}
                jobName={job.name||"This Job"} onEmail={setEmailData}/>
            </div>
          )}

          {tab==="Return Trips"&&(
            <div>
              <SectionHead label="Return Trips" color={C.purple}/>
              <ReturnTrips trips={job.returnTrips} onChange={v=>u({returnTrips:v})}
                jobName={job.name||"This Job"} onEmail={setEmailData}/>
            </div>
          )}

          {tab==="Plans & Links"&&(
            <PlansTab job={job} onUpdate={u}/>
          )}

          {tab==="Job Info"&&(
            <div>
              <SectionHead label="Job Info" color={C.dim}/>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:16}}>
                {[["name","Job Name"],["address","Address"],["gc","General Contractor"],
                  ["phone","GC Phone"],["simproNo","Simpro Job #"]].map(([k,l])=>(
                  <div key={k}>
                    <div style={{fontSize:10,color:C.dim,marginBottom:3}}>{l}</div>
                    <Inp value={job[k]} onChange={e=>u({[k]:e.target.value})} placeholder={l}/>
                  </div>
                ))}
              <div>
                <div style={{fontSize:10,color:C.dim,marginBottom:3}}>Foreman</div>
                <Sel value={job.foreman||"Koy"} onChange={e=>u({foreman:e.target.value})} options={FOREMEN}/>
              </div>
              </div>
              <label style={{display:"flex",alignItems:"center",gap:10,cursor:"pointer"}}>
                <input type="checkbox" checked={!!job.flagged} onChange={e=>u({flagged:e.target.checked})}
                  style={{accentColor:C.red,width:16,height:16}}/>
                <span style={{fontSize:13,color:C.text}}>Flag this job — needs attention</span>
              </label>
            </div>
          )}
        </div>
      </div>

      {emailData&&(
        <EmailModal subject={emailData.subject} body={emailData.body} onClose={()=>setEmailData(null)}/>
      )}
    </div>
  );
}



// ── Q&A Punch List ────────────────────────────────────────────
function QAList({questions: _questions, onChange, color}) {
  // guard: old data may be a string instead of array
  const questions = Array.isArray(_questions) ? _questions : [];
  const [draft, setDraft] = useState("");
  const add = () => {
    if(!draft.trim()) return;
    onChange([...questions, {id:uid(), question:draft, answer:"", done:false}]);
    setDraft("");
  };
  const upd = (id, p) => onChange(questions.map(q=>q.id===id?{...q,...p}:q));
  const del = (id) => onChange(questions.filter(q=>q.id!==id));
  return (
    <div>
      {questions.map((q,i)=>(
        <div key={q.id} style={{background:C.surface,border:`1px solid ${color}33`,
          borderRadius:10,padding:12,marginBottom:10}}>
          <div style={{display:"flex",alignItems:"flex-start",gap:8,marginBottom:8}}>
            <input type="checkbox" checked={q.done}
              onChange={()=>upd(q.id,{done:!q.done})}
              style={{accentColor:C.green,width:14,height:14,cursor:"pointer",flexShrink:0,marginTop:2}}/>
            <span style={{flex:1,fontSize:12,fontWeight:600,
              color:q.done?C.muted:C.text,
              textDecoration:q.done?"line-through":"none",lineHeight:1.4}}>
              Q{i+1}: {q.question}
            </span>
            <button onClick={()=>del(q.id)}
              style={{background:"none",border:"none",color:C.muted,cursor:"pointer",
                fontSize:12,flexShrink:0,padding:"0 2px"}}>✕</button>
          </div>
          <div style={{marginLeft:22}}>
            <div style={{fontSize:10,color:color,fontWeight:700,marginBottom:4,letterSpacing:"0.08em"}}>ANSWER</div>
            <TA value={q.answer} rows={2}
              onChange={e=>upd(q.id,{answer:e.target.value})}
              placeholder="Type answer here…"/>
          </div>
        </div>
      ))}
      <div style={{display:"flex",gap:6,marginTop:4}}>
        <Inp value={draft} onChange={e=>setDraft(e.target.value)}
          placeholder="Add a question…" style={{flex:1}}/>
        <Btn onClick={add} variant="primary">+</Btn>
      </div>
    </div>
  );
}

function QASection({questions: _questions, onChange, color}) {
  // guard: normalize questions to always be object with array values
  const questions = (_questions && typeof _questions === 'object' && !Array.isArray(_questions))
    ? _questions : {upper:[], main:[], basement:[]};
  return (
    <div>
      {[["upper","Upper Level"],["main","Main Level"],["basement","Basement"]].map(([k,l])=>(
        <div key={k} style={{marginBottom:18}}>
          <div style={{fontSize:11,color:C.dim,fontWeight:600,marginBottom:8}}>{l}</div>
          <QAList
            questions={Array.isArray(questions[k]) ? questions[k] : []}
            onChange={v=>onChange({...questions,[k]:v})}
            color={color}/>
        </div>
      ))}
    </div>
  );
}

// ── Stage Sections ────────────────────────────────────────────
const STAGE_SECTIONS = [
  { key:"rough",    label:"Rough In Progress",  color:"#3b82f6",
    test: j => { const r=parseInt(j.roughStage)||0; const f=parseInt(j.finishStage)||0; return r>0 && r<100 && f===0; } },
  { key:"between",  label:"In Between",          color:"#e8a020",
    test: j => { const r=parseInt(j.roughStage)||0; const f=parseInt(j.finishStage)||0; return r===100 && f===0; } },
  { key:"finish",   label:"Finish In Progress",  color:"#a78bfa",
    test: j => { const f=parseInt(j.finishStage)||0; return f>0 && f<100; } },
  { key:"complete", label:"Completed",           color:"#22c55e",
    test: j => parseInt(j.finishStage)===100 },
  { key:"notstarted", label:"Not Started",       color:"#5a6480",
    test: j => { const r=parseInt(j.roughStage)||0; return r===0; } },
];

function StageSectionList({ jobs, JobRow, fc }) {
  const [collapsed, setCollapsed] = useState({});
  const toggle = key => setCollapsed(c=>({...c,[key]:!c[key]}));

  return (
    <div>
      {STAGE_SECTIONS.map(sec => {
        const sJobs = jobs.filter(sec.test);
        if(sJobs.length===0) return null;
        const isCollapsed = collapsed[sec.key];
        return (
          <div key={sec.key} style={{marginBottom:24}}>
            <div
              onClick={()=>toggle(sec.key)}
              style={{display:"flex",alignItems:"center",gap:10,marginBottom:10,
                paddingBottom:8,borderBottom:`2px solid ${sec.color}33`,cursor:"pointer",
                userSelect:"none"}}>
              <div style={{width:8,height:8,borderRadius:"50%",background:sec.color,flexShrink:0}}/>
              <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:18,
                letterSpacing:"0.08em",color:sec.color}}>{sec.label}</div>
              <div style={{background:`${sec.color}18`,border:`1px solid ${sec.color}33`,
                borderRadius:99,padding:"2px 10px",fontSize:11,color:sec.color,fontWeight:700}}>
                {sJobs.length}
              </div>
              <div style={{marginLeft:"auto",color:sec.color,fontSize:13,fontWeight:700}}>
                {isCollapsed ? "▸" : "▾"}
              </div>
            </div>
            {!isCollapsed && sJobs.map(job=>(
              <JobRow key={job.id} job={job} fc={fc||undefined} showForeman={!fc}/>
            ))}
          </div>
        );
      })}
    </div>
  );
}

// ── Main Dashboard ────────────────────────────────────────────
const ALL_STAGES = ROUGH_STAGES;

export default function App() {
  const [jobs,     setJobs]     = useState([]);
  const [selected, setSelected] = useState(null);
  const [search,   setSearch]   = useState("");
  const [stageF,   setStageF]   = useState("All");
  const [flagOnly, setFlagOnly] = useState(false);
  const [syncStatus, setSyncStatus] = useState("idle");
  const saveTimer    = useRef(null);
  const initialLoad  = useRef(true);

  useEffect(()=>{
    (async()=>{
      try {
        const { data } = await supabase.from('jobs').select('data').eq('id', JOB_ID).single();
        if(data?.data) {
          const loaded = Array.isArray(data.data) ? data.data : [];
          const roughMap  = {"Pre-Wire":"0%","Rough-In":"25%","Rough Inspection":"75%","Rough Complete":"100%"};
          const finishMap = {"Fixtures Ordered":"0%","Finish Scheduled":"20%","Finish In Progress":"50%","Punch List":"75%","CO / Final":"90%","Complete":"100%"};
          const migrated = loaded.map(j=>({...j,
            roughStage:  roughMap[j.roughStage]||(j.roughStage||"0%"),
            finishStage: finishMap[j.finishStage]||(j.finishStage||"0%"),
          }));
          setJobs(migrated);
        }
      } catch(e){ console.error('Load error:',e); }
      initialLoad.current = false;
    })();
  },[]);

  useEffect(()=>{
    if(initialLoad.current) return;
    setSyncStatus("saving");
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async()=>{
      try {
        await supabase.from('jobs').upsert({id:JOB_ID,data:jobs,updated_at:new Date().toISOString()});
        setSyncStatus("saved");
        setTimeout(()=>setSyncStatus("idle"),2500);
      } catch(e){ console.error('Save error:',e); setSyncStatus("error"); }
    },800);
  },[jobs]);

  const updateJob = updated => { setJobs(js=>js.map(j=>j.id===updated.id?updated:j)); setSelected(updated); };
  const addJob    = () => { const j=blankJob(); setJobs(js=>[j,...js]); setSelected(j); };
  const deleteJob = id => {
    if(!confirm("Delete this job site?")) return;
    setJobs(js=>js.filter(j=>j.id!==id));
    if(selected?.id===id) setSelected(null);
  };

  const openCount = j =>
    [j.roughPunch,j.finishPunch]
      .flatMap(p=>[...(p.upper||[]),...(p.main||[]),...(p.basement||[])])
      .filter(i=>!i.done).length;

  const totalOpen  = jobs.reduce((a,j)=>a+openCount(j),0);
  const flagged    = jobs.filter(j=>j.flagged).length;
  const complete   = jobs.filter(j=>parseInt(j.finishStage)===100).length;
  const pendingCOs = jobs.reduce((a,j)=>a+j.changeOrders.filter(c=>c.status==="Pending").length,0);
  const syncColor  = {idle:C.muted,saving:C.accent,saved:C.green,error:C.red}[syncStatus];
  const syncLabel  = {idle:"All changes saved",saving:"Saving…",saved:"✓ Saved",error:"Save failed"}[syncStatus];

  // view: "home" = main page, "foreman" = foreman-specific page
  const [view, setView] = useState("home");
  const [activeForeman, setActiveForeman] = useState(null);

  const openForeman = (f) => { setActiveForeman(f); setView("foreman"); setSearch(""); setStageF("All"); setFlagOnly(false); };
  const goHome = () => { setView("home"); setActiveForeman(null); setSearch(""); setStageF("All"); setFlagOnly(false); };

  const viewJobs = view==="foreman" ? jobs.filter(j=>(j.foreman||"Koy")===activeForeman) : jobs;

  const filtered = viewJobs.filter(j=>{
    const s  = search.toLowerCase();
    const ms = !s||j.name.toLowerCase().includes(s)||j.address.toLowerCase().includes(s)||j.gc.toLowerCase().includes(s);
    const mf = !flagOnly||j.flagged;
    const rPct = parseInt(j.roughStage)||0;
    const fPct = parseInt(j.finishStage)||0;
    const mt =
      stageF==="All"    ? true :
      stageF==="rough"  ? (rPct>0 && rPct<100 && fPct===0) :
      stageF==="between"? (rPct===100 && fPct===0) :
      stageF==="finish" ? (fPct>0 && fPct<100) : true;
    return ms&&mf&&mt;
  });

  const JobRow = ({job, fc, showForeman=false}) => {
    const open   = openCount(job);
    const pendCO = job.changeOrders.filter(c=>c.status==="Pending").length;
    const foreman = job.foreman||"Koy";
    const rowFc = fc || FOREMEN_COLORS[foreman];
    return (
      <div className="job-row" onClick={()=>setSelected(job)}
        style={{background:C.card,border:`1px solid ${job.flagged?C.accent+"66":C.border}`,
          borderRadius:14,padding:"13px 16px",marginBottom:8,borderLeft:`3px solid ${job.flagged?C.accent:rowFc}`}}>
        <div style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
          <div style={{flex:"0 0 210px",minWidth:140}}>
            <div style={{display:"flex",alignItems:"center",gap:7}}>
              {job.flagged&&<span style={{color:C.accent,fontSize:12}}>⚑</span>}
              <span style={{fontWeight:600,fontSize:13,color:C.text}}>{job.name||"Untitled Job"}</span>
            </div>
            <div style={{fontSize:11,color:C.dim,marginTop:1}}>
              {showForeman&&<span style={{color:rowFc,fontWeight:600,marginRight:6}}>{foreman}</span>}
              {job.gc||"No GC set"}
            </div>
          </div>
          <div style={{flex:"1 1 150px",minWidth:130}}>
            <div style={{fontSize:9,color:C.rough,marginBottom:4,fontWeight:700,letterSpacing:"0.1em"}}>ROUGH</div>
            <StageBar stages={ROUGH_STAGES} current={job.roughStage} color={C.rough}/>
          </div>
          <div style={{flex:"1 1 190px",minWidth:150}}>
            <div style={{fontSize:9,color:C.finish,marginBottom:4,fontWeight:700,letterSpacing:"0.1em"}}>FINISH</div>
            <StageBar stages={FINISH_STAGES} current={job.finishStage} color={C.finish}/>
          </div>
          <div style={{display:"flex",gap:5,flexWrap:"wrap",alignItems:"center"}}>
            {open>0   &&<Pill label={`${open} open`} color={C.red}/>}
            {pendCO>0 &&<Pill label={`${pendCO} CO`} color={C.purple}/>}
            {(job.uploadedFiles||[]).length>0&&<Pill label={`${job.uploadedFiles.length} files`} color={C.green}/>}
          </div>
          <div style={{display:"flex",alignItems:"center",gap:6,marginLeft:"auto",flexShrink:0}}>
            {FOREMEN.filter(f=>f!==foreman).map(f2=>(
              <button key={f2} onClick={e=>{e.stopPropagation();updateJob({...job,foreman:f2});}}
                style={{background:"none",border:`1px solid ${FOREMEN_COLORS[f2]}44`,borderRadius:6,
                  color:FOREMEN_COLORS[f2],fontSize:10,padding:"3px 8px",cursor:"pointer",
                  fontFamily:"inherit",whiteSpace:"nowrap",transition:"opacity 0.15s"}}
                onMouseEnter={e=>e.currentTarget.style.opacity=".7"}
                onMouseLeave={e=>e.currentTarget.style.opacity="1"}>→ {f2}</button>
            ))}
            <button onClick={e=>{e.stopPropagation();deleteJob(job.id);}}
              style={{background:"none",border:"none",color:C.muted,cursor:"pointer",
                fontSize:15,padding:"4px 8px",opacity:0.45,transition:"opacity 0.15s"}}
              onMouseEnter={e=>e.currentTarget.style.opacity="1"}
              onMouseLeave={e=>e.currentTarget.style.opacity="0.45"}>🗑</button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div style={{minHeight:"100vh",background:C.bg,fontFamily:"'DM Sans',sans-serif",color:C.text}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=Bebas+Neue&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        ::-webkit-scrollbar{width:4px;height:4px;}
        ::-webkit-scrollbar-track{background:transparent;}
        ::-webkit-scrollbar-thumb{background:#252838;border-radius:4px;}
        .job-row{transition:background 0.15s,border-color 0.15s;cursor:pointer;}
        .job-row:hover{background:#161926!important;border-color:#252838!important;}
        .foreman-card{transition:transform 0.15s,box-shadow 0.15s;cursor:pointer;}
        .foreman-card:hover{transform:translateY(-3px);box-shadow:0 12px 32px rgba(0,0,0,0.4);}
      `}</style>

      {/* ── HOME PAGE ── */}
      {view==="home"&&(
        <div>
          <div style={{padding:"24px 26px 20px",borderBottom:`1px solid ${C.border}`}}>
            <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",flexWrap:"wrap",gap:12,marginBottom:20}}>
              <div>
                <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:32,letterSpacing:"0.06em",color:C.text,lineHeight:1}}>
                  HOMESTEAD ELECTRIC
                </div>
                <div style={{fontSize:11,color:C.dim,marginTop:3,display:"flex",gap:16,alignItems:"center"}}>
                  <span>{jobs.length} total job sites</span>
                  <span style={{color:syncColor}}>{syncLabel}</span>
                </div>
              </div>
            </div>
            <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
              {[[totalOpen,"Open Punch Items",totalOpen>0?C.red:C.green],
                [flagged,"Flagged",flagged>0?C.accent:C.muted],
                [pendingCOs,"Pending COs",pendingCOs>0?C.purple:C.muted],
                [complete,"Complete",C.green],
                [jobs.length,"Total Jobs",C.blue]].map(([v,l,c])=>(
                <div key={l} style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:10,
                  padding:"8px 16px",display:"flex",gap:10,alignItems:"center"}}>
                  <span style={{fontFamily:"'Bebas Neue'",fontSize:24,color:c,lineHeight:1}}>{v}</span>
                  <span style={{fontSize:11,color:C.dim}}>{l}</span>
                </div>
              ))}
            </div>
          </div>

          <div style={{padding:"28px 26px"}}>
            <div style={{fontSize:10,color:C.dim,fontWeight:800,letterSpacing:"0.14em",marginBottom:16}}>
              TAP A FOREMAN TO VIEW THEIR JOBS
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(240px,1fr))",gap:16,marginBottom:40}}>
              {FOREMEN.map(f=>{
                const fc    = FOREMEN_COLORS[f];
                const fJobs = jobs.filter(j=>(j.foreman||"Koy")===f);
                const fOpen = fJobs.reduce((a,j)=>a+openCount(j),0);
                const fCOs  = fJobs.reduce((a,j)=>a+j.changeOrders.filter(c=>c.status==="Pending").length,0);
                const fFlag = fJobs.filter(j=>j.flagged).length;
                const rAvg  = fJobs.length ? Math.round(fJobs.reduce((a,j)=>a+(parseInt(j.roughStage)||0),0)/fJobs.length) : 0;
                const fnAvg = fJobs.length ? Math.round(fJobs.reduce((a,j)=>a+(parseInt(j.finishStage)||0),0)/fJobs.length) : 0;
                return (
                  <div key={f} className="foreman-card" onClick={()=>openForeman(f)}
                    style={{background:C.card,border:`1px solid ${fc}44`,borderRadius:16,padding:20,borderTop:`3px solid ${fc}`}}>
                    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
                      <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:28,letterSpacing:"0.06em",color:fc}}>{f}</div>
                      <div style={{background:`${fc}18`,border:`1px solid ${fc}33`,borderRadius:99,
                        padding:"3px 12px",fontSize:11,color:fc,fontWeight:700}}>
                        {fJobs.length} job{fJobs.length!==1?"s":""}
                      </div>
                    </div>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:14}}>
                      {[[fOpen,"Open Items",fOpen>0?C.red:C.muted],
                        [fCOs,"Pending COs",fCOs>0?C.purple:C.muted],
                        [fFlag,"Flagged",fFlag>0?C.accent:C.muted]].map(([v,l,c])=>(
                        <div key={l} style={{background:C.surface,borderRadius:8,padding:"8px 10px"}}>
                          <div style={{fontFamily:"'Bebas Neue'",fontSize:20,color:c,lineHeight:1}}>{v}</div>
                          <div style={{fontSize:10,color:C.dim,marginTop:2}}>{l}</div>
                        </div>
                      ))}
                    </div>
                    <div style={{marginBottom:8}}>
                      <div style={{display:"flex",justifyContent:"space-between",fontSize:10,color:C.dim,marginBottom:3}}>
                        <span>Avg Rough</span><span style={{color:C.rough}}>{rAvg}%</span>
                      </div>
                      <div style={{height:4,background:C.border,borderRadius:99,overflow:"hidden"}}>
                        <div style={{height:"100%",width:`${rAvg}%`,background:C.rough,borderRadius:99}}/>
                      </div>
                    </div>
                    <div>
                      <div style={{display:"flex",justifyContent:"space-between",fontSize:10,color:C.dim,marginBottom:3}}>
                        <span>Avg Finish</span><span style={{color:C.finish}}>{fnAvg}%</span>
                      </div>
                      <div style={{height:4,background:C.border,borderRadius:99,overflow:"hidden"}}>
                        <div style={{height:"100%",width:`${fnAvg}%`,background:C.finish,borderRadius:99}}/>
                      </div>
                    </div>
                    <div style={{marginTop:14,fontSize:11,color:fc,fontWeight:600,textAlign:"right"}}>View Jobs →</div>
                  </div>
                );
              })}
            </div>

            <div style={{fontSize:10,color:C.dim,fontWeight:800,letterSpacing:"0.14em",marginBottom:16}}>ALL JOBS</div>
            {jobs.length===0?(
              <div style={{textAlign:"center",padding:"40px 0",color:C.muted,fontSize:13}}>
                No jobs yet — open a foreman to add jobs
              </div>
            ):(
              <StageSectionList jobs={jobs} JobRow={JobRow} fc={null}/>
            )}
          </div>
        </div>
      )}

      {/* ── FOREMAN PAGE ── */}
      {view==="foreman"&&(
        <div>
          <div style={{padding:"18px 26px 0",borderBottom:`1px solid ${C.border}`}}>
            <div style={{display:"flex",alignItems:"center",gap:14,marginBottom:16,flexWrap:"wrap"}}>
              <button onClick={goHome}
                style={{background:"none",border:`1px solid ${C.border}`,borderRadius:8,color:C.dim,
                  padding:"6px 14px",fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>← Back</button>
              <div style={{width:10,height:10,borderRadius:"50%",background:FOREMEN_COLORS[activeForeman],flexShrink:0}}/>
              <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:28,letterSpacing:"0.06em",
                color:FOREMEN_COLORS[activeForeman],lineHeight:1}}>{activeForeman}</div>
              <div style={{fontSize:11,color:C.dim}}>
                {jobs.filter(j=>(j.foreman||"Koy")===activeForeman).length} job sites
              </div>
              <div style={{marginLeft:"auto",display:"flex",gap:8,alignItems:"center"}}>
                <span style={{fontSize:11,color:syncColor}}>{syncLabel}</span>
                <button onClick={()=>{const j=blankJob();j.foreman=activeForeman;setJobs(js=>[j,...js]);setSelected(j);}}
                  style={{background:FOREMEN_COLORS[activeForeman],border:"none",borderRadius:9,color:"#000",
                    fontWeight:700,padding:"9px 20px",fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>
                  + New Job
                </button>
              </div>
            </div>

            <div style={{display:"flex",gap:10,marginBottom:16,flexWrap:"wrap"}}>
              {(()=>{
                const fJobs = jobs.filter(j=>(j.foreman||"Koy")===activeForeman);
                const fOpen = fJobs.reduce((a,j)=>a+openCount(j),0);
                const fCOs  = fJobs.reduce((a,j)=>a+j.changeOrders.filter(c=>c.status==="Pending").length,0);
                const fFlag = fJobs.filter(j=>j.flagged).length;
                const fDone = fJobs.filter(j=>parseInt(j.finishStage)===100).length;
                return [[fJobs.length,"Jobs",FOREMEN_COLORS[activeForeman]],
                  [fOpen,"Open Items",fOpen>0?C.red:C.green],
                  [fCOs,"Pending COs",fCOs>0?C.purple:C.muted],
                  [fFlag,"Flagged",fFlag>0?C.accent:C.muted],
                  [fDone,"Complete",C.green]].map(([v,l,c])=>(
                  <div key={l} style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:10,
                    padding:"8px 16px",display:"flex",gap:10,alignItems:"center"}}>
                    <span style={{fontFamily:"'Bebas Neue'",fontSize:24,color:c,lineHeight:1}}>{v}</span>
                    <span style={{fontSize:11,color:C.dim}}>{l}</span>
                  </div>
                ));
              })()}
            </div>

            <div style={{display:"flex",gap:8,paddingBottom:14,flexWrap:"wrap",alignItems:"center"}}>
              <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search jobs, GC, address…"
                style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,color:C.text,
                  padding:"7px 12px",fontSize:12,fontFamily:"inherit",outline:"none",width:220}}/>
              <select value={stageF} onChange={e=>setStageF(e.target.value)}
                style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,color:C.text,
                  padding:"7px 12px",fontSize:12,fontFamily:"inherit",outline:"none"}}>
                <option value="All">All Jobs</option>
                <option value="rough">Rough In Progress</option>
                <option value="between">In Between</option>
                <option value="finish">Finish In Progress</option>
              </select>
              <button onClick={()=>setFlagOnly(f=>!f)}
                style={{background:flagOnly?`${C.accent}22`:C.surface,
                  border:`1px solid ${flagOnly?C.accent:C.border}`,borderRadius:8,
                  color:flagOnly?C.accent:C.dim,padding:"7px 14px",fontSize:12,
                  cursor:"pointer",fontFamily:"inherit"}}>
                ⚑ {flagOnly?"Flagged Only":"All Jobs"}
              </button>
            </div>
          </div>

          <div style={{padding:"14px 26px"}}>
            {filtered.length===0?(
              <div style={{textAlign:"center",padding:"60px 0",color:C.muted}}>
                <div style={{fontSize:13,marginBottom:20}}>No jobs yet for {activeForeman}</div>
                <button onClick={()=>{const j=blankJob();j.foreman=activeForeman;setJobs(js=>[j,...js]);setSelected(j);}}
                  style={{background:FOREMEN_COLORS[activeForeman],border:"none",borderRadius:9,color:"#000",
                    fontWeight:700,padding:"10px 24px",fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>
                  + Add First Job
                </button>
              </div>
            ):(
              <StageSectionList jobs={filtered} JobRow={JobRow} fc={FOREMEN_COLORS[activeForeman]}/>
            )}
          </div>
        </div>
      )}

      {selected&&<JobDetail job={selected} onUpdate={updateJob} onClose={()=>setSelected(null)}/>}
    </div>
  );
}
