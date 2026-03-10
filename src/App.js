import { useState, useEffect, useRef } from "react";

// Register service worker for offline support
if("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/service-worker.js").catch(()=>{});
  });
}
import { initializeApp } from "firebase/app";
import { getFirestore, doc, setDoc, deleteDoc, getDoc, collection, getDocs, onSnapshot } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyAQl6V74U502_ZHF3h_1W0yYDuKr2mLI5Q",
  authDomain: "homestead-electric.firebaseapp.com",
  projectId: "homestead-electric",
  storageBucket: "homestead-electric.firebasestorage.app",
  messagingSenderId: "318598172684",
  appId: "1:318598172684:web:b2ef548d952faabccd9e29"
};

const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);

const C = {
  bg:"#f1f5f9", surface:"#ffffff", card:"#ffffff", border:"#e2e8f0",
  muted:"#cbd5e1", text:"#0f172a", dim:"#64748b", accent:"#d97706",
  blue:"#2563eb", green:"#16a34a", red:"#dc2626", purple:"#0ea5e9",
  orange:"#ea580c", teal:"#0d9488", rough:"#2563eb", finish:"#0ea5e9",
};

const JOB_ID = "homestead-jobs-v1";
const ROUGH_STAGES  = ['0%', '5%', '10%', '15%', '20%', '25%', '30%', '35%', '40%', '45%', '50%', '55%', '60%', '65%', '70%', '75%', '80%', '85%', '90%', '95%', '100%'];
const FINISH_STAGES = ['0%', '5%', '10%', '15%', '20%', '25%', '30%', '35%', '40%', '45%', '50%', '55%', '60%', '65%', '70%', '75%', '80%', '85%', '90%', '95%', '100%'];
const WIRE_SIZES = ["","14/2","14/3","12/2","12/3","10/2","10/3","8/2","8/3","6/2","6/3","4/2","4/3","2/2","2/3","1/0","2/0","3/0","4/0"];
const WIRE_COLORS = {
  "14/2": "#e8e8e8", "14/3": "#3b82f6",
  "12/2": "#f5d020", "12/3": "#9b59b6",
  "10/2": "#f4820a", "10/3": "#f4a0c0",
  "8/2":  "#444444", "8/3":  "#444444",
  "6/2":  "#444444", "6/3":  "#444444",
  "4/2":  "#444444", "4/3":  "#444444",
  "2/2":  "#444444", "2/3":  "#444444",
  "1/0":  "#444444", "2/0":  "#444444", "3/0": "#444444", "4/0": "#444444",
};
const WIRE_TEXT = {
  "14/2": "#111", "14/3": "#fff",
  "12/2": "#111", "12/3": "#fff",
  "10/2": "#111", "10/3": "#111",
  "8/2":  "#fff", "8/3":  "#fff",
  "6/2":  "#fff", "6/3":  "#fff",
  "4/2":  "#fff", "4/3":  "#fff",
  "2/2":  "#fff", "2/3":  "#fff",
  "1/0":  "#fff", "2/0":  "#fff", "3/0": "#fff", "4/0": "#fff",
};
const CO_STATUSES   = ["Pending","CO Created","CO Sent (office)","Approved","Denied","Work Completed"];
const PULLED_OPTS   = ["","Pulled","Need Specs"];
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

const newHRRow     = (num) => ({ id:uid(), num, wire:"", name:"", status:"", panel:"" });
const newCP4Row    = (num) => ({ id:uid(), num, name:"", module:"", status:"" });
const newKPRow     = (num) => ({ id:uid(), num, name:"" });
const emptyPunch   = ()    => ({ upper:[], main:[], basement:[] });

const FOREMEN = ["Koy", "Vasa", "Colby"];
const FOREMEN_COLORS = {"Koy":"#3b82f6","Vasa":"#eab308","Colby":"#22c55e"};

const blankJob = () => ({
  id:uid(), name:"", address:"", gc:"", phone:"", simproNo:"", foreman:"Koy", lead:"", flagged:false,
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
    const gmailUrl = `https://mail.google.com/mail/?view=cm&to=${encodeURIComponent(allRecipients.join(","))}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.open(gmailUrl, "_blank");
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
// Simple helpers to ensure data is always the right shape
function normFloor(v) {
  if (v && typeof v === 'object' && !Array.isArray(v) && ('general' in v || 'rooms' in v)) {
    return { general: Array.isArray(v.general) ? v.general : [], rooms: Array.isArray(v.rooms) ? v.rooms : [] };
  }
  return { general: Array.isArray(v) ? v : [], rooms: [] };
}

function PunchItems({ items, onChange }) {
  const safeItems = Array.isArray(items) ? items : [];
  const [draft, setDraft] = useState('');
  const add = () => {
    if (!draft.trim()) return;
    const next = [...safeItems, { id: uid(), text: draft, done: false }];
    onChange(next);
    setDraft('');
  };
  return (
    <div style={{ paddingLeft: 8 }}>
      {safeItems.map(item => (
        <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
          <input type="checkbox" checked={!!item.done}
            onChange={() => onChange(safeItems.map(i => i.id === item.id ? { ...i, done: !i.done } : i))}
            style={{ accentColor: C.green, width: 14, height: 14, cursor: 'pointer', flexShrink: 0 }} />
          <span style={{ flex: 1, fontSize: 12, color: item.done ? C.muted : C.text,
            textDecoration: item.done ? 'line-through' : 'none' }}>{item.text}</span>
          <button onClick={() => onChange(safeItems.filter(i => i.id !== item.id))}
            style={{ background: 'none', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 12 }}>✕</button>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
        <Inp value={draft} onChange={e => setDraft(e.target.value)}
          placeholder="Add item…" style={{ flex: 1 }}
          onKeyDown={e => e.key === 'Enter' && add()} />
        <Btn onClick={add} variant="primary">+</Btn>
      </div>
    </div>
  );
}

function PunchFloor({ floorKey, floorData, onFloorChange, floorLabel, floorColor }) {
  const data = normFloor(floorData);
  const [collapsed, setCollapsed] = useState(false);
  const [roomDraft, setRoomDraft] = useState('');

  const openCount = data.general.filter(i => !i.done).length +
    data.rooms.reduce((a, r) => a + (Array.isArray(r.items) ? r.items.filter(i => !i.done).length : 0), 0);

  const setGeneral = (general) => onFloorChange(floorKey, { ...data, general });
  const addRoom = () => {
    if (!roomDraft.trim()) return;
    onFloorChange(floorKey, { ...data, rooms: [...data.rooms, { id: uid(), name: roomDraft, items: [] }] });
    setRoomDraft('');
  };
  const setRoomItems = (roomId, items) => {
    onFloorChange(floorKey, { ...data, rooms: data.rooms.map(r => r.id === roomId ? { ...r, items } : r) });
  };
  const delRoom = (roomId) => {
    onFloorChange(floorKey, { ...data, rooms: data.rooms.filter(r => r.id !== roomId) });
  };

  return (
    <div style={{ marginBottom: 14, border: `1px solid ${floorColor}33`, borderRadius: 10, overflow: 'hidden' }}>
      <div onClick={() => setCollapsed(c => !c)}
        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
          background: `${floorColor}10`, cursor: 'pointer', userSelect: 'none' }}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: floorColor, flexShrink: 0 }} />
        <span style={{ fontWeight: 700, fontSize: 13, color: floorColor, flex: 1 }}>{floorLabel}</span>
        {openCount > 0 && <span style={{ fontSize: 10, background: `${C.red}22`, color: C.red,
          borderRadius: 99, padding: '2px 8px', fontWeight: 700 }}>{openCount} open</span>}
        <span style={{ color: floorColor, fontSize: 12 }}>{collapsed ? '▸' : '▾'}</span>
      </div>
      {!collapsed && (
        <div style={{ padding: '12px 14px' }}>
          <div style={{ fontSize: 10, color: C.dim, fontWeight: 700, letterSpacing: '0.08em', marginBottom: 6 }}>GENERAL</div>
          <PunchItems items={data.general} onChange={setGeneral} />
          {data.rooms.map(room => (
            <div key={room.id} style={{ marginTop: 12, background: C.surface,
              border: `1px solid ${C.border}`, borderRadius: 8, padding: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: C.text, flex: 1 }}>{room.name}</span>
                {(Array.isArray(room.items) ? room.items : []).filter(i => !i.done).length > 0 &&
                  <span style={{ fontSize: 10, background: `${C.red}22`, color: C.red,
                    borderRadius: 99, padding: '2px 6px', fontWeight: 700 }}>
                    {room.items.filter(i => !i.done).length} open
                  </span>}
                <button onClick={() => delRoom(room.id)}
                  style={{ background: 'none', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 11 }}>✕</button>
              </div>
              <PunchItems items={Array.isArray(room.items) ? room.items : []}
                onChange={v => setRoomItems(room.id, v)} />
            </div>
          ))}
          <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
            <Inp value={roomDraft} onChange={e => setRoomDraft(e.target.value)}
              placeholder="Add room (e.g. Master Bath)…" style={{ flex: 1 }}
              onKeyDown={e => e.key === 'Enter' && addRoom()} />
            <Btn onClick={addRoom} variant="add" style={{ whiteSpace: 'nowrap' }}>+ Room</Btn>
          </div>
        </div>
      )}
    </div>
  );
}

function PunchSection({ punch, onChange, jobName, phase, onEmail }) {
  const upper    = normFloor(punch.upper);
  const main     = normFloor(punch.main);
  const basement = normFloor(punch.basement);

  const handleFloorChange = (floorKey, newFloorData) => {
    onChange({ upper, main, basement, [floorKey]: newFloorData });
  };

  const countOpen = (f) => f.general.filter(i => !i.done).length +
    f.rooms.reduce((a, r) => a + (Array.isArray(r.items) ? r.items.filter(i => !i.done).length : 0), 0);
  const totalOpen = countOpen(upper) + countOpen(main) + countOpen(basement);

  const flatItems = (f, label) => [
    ...f.general.filter(i => !i.done).map(i => `[${label}] ${i.text}`),
    ...f.rooms.flatMap(r => (r.items||[]).filter(i => !i.done).map(i => `[${label} - ${r.name}] ${i.text}`)),
  ];

  const handleEmail = () => {
    const all = [...flatItems(upper,'Upper'), ...flatItems(main,'Main'), ...flatItems(basement,'Basement')];
    const subject = `${jobName} — ${phase} Punch List`;
    const body = `Hi,\n\nOpen ${phase} punch list items for ${jobName}:\n\n${all.map(i=>`• ${i}`).join('\n')}\n\nPlease review and complete.\n\nThanks\n\nView job board: https://homestead-electric.vercel.app/`;
    onEmail({ subject, body });
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
        {totalOpen > 0 && (
          <Btn onClick={handleEmail} variant="email" style={{ fontSize: 11, padding: '4px 10px' }}>
            ✉ Email Punch List ({totalOpen} open)
          </Btn>
        )}
      </div>
      <PunchFloor floorKey="upper"    floorData={upper}    onFloorChange={handleFloorChange} floorLabel="Upper Level" floorColor={C.blue}/>
      <PunchFloor floorKey="main"     floorData={main}     onFloorChange={handleFloorChange} floorLabel="Main Level"  floorColor={C.accent}/>
      <PunchFloor floorKey="basement" floorData={basement} onFloorChange={handleFloorChange} floorLabel="Basement"    floorColor={C.purple}/>
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
    const body = `Hi,\n\nJob Update — ${jobName}\n\n${recent.map(u=>`${u.date||"—"}: ${u.text}`).join("\n\n")}\n\nThanks\n\nView job board: https://homestead-electric.vercel.app/`;
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
    const body = `Hi,\n\nChange Order #${i+1} — ${jobName}\n\nDate: ${o.date||"—"}\nSend CO To: ${o.sendTo||"—"}\nDescription: ${o.desc||"—"}\nTask: ${o.task||"—"}\nMaterial Needed: ${o.material||"—"}\nEstimated Time: ${o.time||"—"}\nStatus: ${o.status}\n\nPlease review and confirm.\n\nThanks\n\nView job board: https://homestead-electric.vercel.app/`;
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


function ReturnTripExtras({trip, onUpd}) {
  const [tab, setTab] = useState("Assign Work");
  return (
    <div style={{marginTop:14,borderTop:`1px solid ${C.border}`,paddingTop:14}}>
      <div style={{display:"flex",gap:6,marginBottom:12}}>
        {["Assign Work","Sign Off"].map(t=>(
          <button key={t} onClick={()=>setTab(t)}
            style={{padding:"5px 14px",borderRadius:7,fontSize:11,cursor:"pointer",
              fontFamily:"inherit",fontWeight:tab===t?700:400,
              background:tab===t?C.purple:`${C.purple}15`,
              border:`1px solid ${tab===t?C.purple:`${C.purple}33`}`,
              color:tab===t?"#fff":C.dim,transition:"all 0.15s"}}>
            {t}
          </button>
        ))}
      </div>

      {tab==="Assign Work"&&(
        <div>
          {(trip.assignments||[]).map((a,i)=>(
            <div key={a.id} style={{background:C.card,border:`1px solid ${a.done?C.green+"55":C.border}`,
              borderRadius:10,padding:12,marginBottom:10,borderLeft:`3px solid ${a.done?C.green:C.purple}`}}>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
                <input type="checkbox" checked={!!a.done}
                  onChange={()=>onUpd({assignments:(trip.assignments||[]).map(x=>x.id===a.id?{...x,done:!x.done}:x)})}
                  style={{accentColor:C.green,width:15,height:15,cursor:"pointer",flexShrink:0}}/>
                <span style={{fontSize:11,fontWeight:700,color:a.done?C.green:C.purple,flex:1}}>
                  Task #{i+1}{a.done?" ✓ Done":""}
                </span>
                <button onClick={()=>onUpd({assignments:(trip.assignments||[]).filter(x=>x.id!==a.id)})}
                  style={{background:"none",border:"none",color:C.muted,cursor:"pointer",fontSize:11}}>Remove</button>
              </div>
              <div style={{marginBottom:8}}>
                <div style={{fontSize:10,color:C.dim,marginBottom:3}}>Assign To</div>
                <Inp value={a.person||""} placeholder="Name…"
                  onChange={e=>onUpd({assignments:(trip.assignments||[]).map(x=>x.id===a.id?{...x,person:e.target.value}:x)})}/>
              </div>
              <div>
                <div style={{fontSize:10,color:C.dim,marginBottom:3}}>Task Description</div>
                <TA value={a.task||""} rows={2} placeholder="Describe the work to be completed…"
                  onChange={e=>onUpd({assignments:(trip.assignments||[]).map(x=>x.id===a.id?{...x,task:e.target.value}:x)})}/>
              </div>
            </div>
          ))}
          <Btn onClick={()=>onUpd({assignments:[...(trip.assignments||[]),{id:uid(),person:"",task:"",done:false}]})}
            variant="add" style={{width:"100%",borderStyle:"dashed"}}>+ Add Assignment</Btn>
        </div>
      )}

      {tab==="Sign Off"&&(
        <div>
          {(trip.signoffs||[]).map((s,i)=>(
            <div key={s.id} style={{background:C.card,border:`1px solid ${C.green}33`,
              borderRadius:10,padding:12,marginBottom:10,borderLeft:`3px solid ${C.green}`}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                <span style={{fontSize:11,fontWeight:700,color:C.green}}>Sign-off #{i+1}</span>
                <button onClick={()=>onUpd({signoffs:(trip.signoffs||[]).filter(x=>x.id!==s.id)})}
                  style={{background:"none",border:"none",color:C.muted,cursor:"pointer",fontSize:11}}>Remove</button>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
                <div>
                  <div style={{fontSize:10,color:C.dim,marginBottom:3}}>Technician Name</div>
                  <Inp value={s.person||""} placeholder="Name…"
                    onChange={e=>onUpd({signoffs:(trip.signoffs||[]).map(x=>x.id===s.id?{...x,person:e.target.value}:x)})}/>
                </div>
                <div>
                  <div style={{fontSize:10,color:C.dim,marginBottom:3}}>Date Completed</div>
                  <Inp value={s.completedDate||""} placeholder="MM/DD/YY"
                    onChange={e=>onUpd({signoffs:(trip.signoffs||[]).map(x=>x.id===s.id?{...x,completedDate:e.target.value}:x)})}/>
                </div>
              </div>
              <div style={{marginBottom:8}}>
                <div style={{fontSize:10,color:C.dim,marginBottom:3}}>Work Completed</div>
                <TA value={s.task||""} rows={2} placeholder="Describe what was completed…"
                  onChange={e=>onUpd({signoffs:(trip.signoffs||[]).map(x=>x.id===s.id?{...x,task:e.target.value}:x)})}/>
              </div>
              <div>
                <div style={{fontSize:10,color:C.dim,marginBottom:3}}>Initials</div>
                <Inp value={s.initials||""} placeholder="e.g. KM" style={{width:80}}
                  onChange={e=>onUpd({signoffs:(trip.signoffs||[]).map(x=>x.id===s.id?{...x,initials:e.target.value}:x)})}/>
              </div>
            </div>
          ))}
          <Btn onClick={()=>onUpd({signoffs:[...(trip.signoffs||[]),{id:uid(),person:"",task:"",completedDate:"",initials:""}]})}
            variant="add" style={{width:"100%",borderStyle:"dashed"}}>+ Add Sign-off</Btn>
        </div>
      )}
    </div>
  );
}

// ── Return Trips ──────────────────────────────────────────────
function ReturnTrips({trips,onChange,jobName,onEmail}) {
  const [viewPhoto, setViewPhoto] = useState(null);
  const add = () => onChange([...trips,{id:uid(),date:"",scope:"",material:"",punch:[],photos:[],assignedTo:"",signedOff:false,signedOffBy:"",signedOffDate:""}]);
  const upd = (id,p) => onChange(trips.map(t=>t.id===id?{...t,...p}:t));
  const del = (id)   => onChange(trips.filter(t=>t.id!==id));

  const emailTrip = (t,i) => {
    const punchLines = (t.punch||[]).filter(p=>!p.done).map(p=>`• ${p.text}`).join("\n") || "None";
    const subject = `${jobName} — Return Trip #${i+1}`;
    const body = `Hi,\n\nReturn Trip #${i+1} — ${jobName}\n\nDate: ${t.date||"—"}\nScope of Work:\n${t.scope||"—"}\n\nMaterial Needed:\n${t.material||"—"}\n\nPunch List:\n${punchLines}\n\nThanks\n\nView job board: https://homestead-electric.vercel.app/`;
    onEmail({subject, body});
  };

  const addPhotos = (id, files) => {
    const trip = trips.find(t=>t.id===id);
    const existing = trip?.photos||[];
    let done=0; const newPhotos=[];
    const total = files.length;
    Array.from(files).forEach(file=>{
      const img = new Image();
      const reader = new FileReader();
      reader.onload = ev => {
        img.onload = () => {
          // Resize to max 800px wide and compress
          const MAX = 800;
          const scale = Math.min(1, MAX / Math.max(img.width, img.height));
          const canvas = document.createElement('canvas');
          canvas.width  = Math.round(img.width  * scale);
          canvas.height = Math.round(img.height * scale);
          canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.6);
          newPhotos.push({id:uid(), name:file.name, dataUrl});
          done++;
          if(done===total) upd(id,{photos:[...existing,...newPhotos]});
        };
        img.src = ev.target.result;
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
          {/* Punch List */}
          <div style={{fontSize:10,color:C.dim,fontWeight:700,marginBottom:6,letterSpacing:"0.08em"}}>PUNCH LIST</div>
          <PunchItems items={t.punch||[]} onChange={v=>upd(t.id,{punch:v})}/>

          {/* Photos */}
          <div style={{marginTop:14}}>
            <div style={{fontSize:10,color:C.dim,fontWeight:700,marginBottom:8,letterSpacing:"0.08em"}}>PHOTOS</div>
            {(t.photos||[]).length>0&&(
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(90px,1fr))",gap:8,marginBottom:10}}>
                {(t.photos||[]).map(p=>(
                  <div key={p.id} style={{position:"relative"}}>
                    <img src={p.dataUrl} alt={p.name}
                      onClick={()=>setViewPhoto(p.dataUrl)}
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

          {/* Assigned To */}
          <div style={{marginTop:12,padding:"10px 12px",background:`${C.purple}10`,
            border:`1px solid ${C.purple}33`,borderRadius:8}}>
            <div style={{fontSize:10,color:C.purple,fontWeight:700,marginBottom:6,letterSpacing:"0.08em"}}>ASSIGNED TO</div>
            <Inp value={t.assignedTo||""} onChange={e=>upd(t.id,{assignedTo:e.target.value})}
              placeholder="Technician name…"/>
          </div>

          {/* Sign Off */}
          <div style={{marginTop:10,padding:"10px 12px",
            background:t.signedOff?`${C.green}12`:`${C.surface}`,
            border:`1px solid ${t.signedOff?C.green+"55":C.border}`,borderRadius:8}}>
            <div style={{fontSize:10,color:t.signedOff?C.green:C.dim,fontWeight:700,
              marginBottom:8,letterSpacing:"0.08em"}}>SIGN OFF</div>
            {!t.signedOff?(
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr auto",gap:8,alignItems:"flex-end"}}>
                <div>
                  <div style={{fontSize:10,color:C.dim,marginBottom:3}}>Name</div>
                  <Inp value={t.signedOffBy||""} onChange={e=>upd(t.id,{signedOffBy:e.target.value})}
                    placeholder="Your name…"/>
                </div>
                <div>
                  <div style={{fontSize:10,color:C.dim,marginBottom:3}}>Date</div>
                  <Inp value={t.signedOffDate||""} onChange={e=>upd(t.id,{signedOffDate:e.target.value})}
                    placeholder="MM/DD/YY"/>
                </div>
                <button
                  onClick={()=>upd(t.id,{signedOff:true})}
                  disabled={!t.signedOffBy||!t.signedOffDate}
                  style={{background:(!t.signedOffBy||!t.signedOffDate)?C.surface:C.green,
                    border:`1px solid ${(!t.signedOffBy||!t.signedOffDate)?C.border:C.green}`,
                    borderRadius:8,color:(!t.signedOffBy||!t.signedOffDate)?C.muted:"#000",
                    padding:"7px 14px",fontSize:12,fontWeight:700,cursor:(!t.signedOffBy||!t.signedOffDate)?"not-allowed":"pointer",
                    fontFamily:"inherit",whiteSpace:"nowrap"}}>
                  ✓ Sign Off
                </button>
              </div>
            ):(
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12}}>
                <div>
                  <span style={{fontSize:13,color:C.green,fontWeight:700}}>✓ Completed by {t.signedOffBy}</span>
                  <span style={{fontSize:11,color:C.dim,marginLeft:10}}>{t.signedOffDate}</span>
                </div>
                <button onClick={()=>upd(t.id,{signedOff:false})}
                  style={{background:"none",border:`1px solid ${C.border}`,borderRadius:6,
                    color:C.muted,fontSize:11,padding:"3px 8px",cursor:"pointer",fontFamily:"inherit"}}>
                  Undo
                </button>
              </div>
            )}
          </div>
        </div>
      ))}
      <Btn onClick={add} variant="ghost" style={{width:"100%",borderStyle:"dashed"}}>+ Add Return Trip</Btn>
      {viewPhoto&&(
        <div onClick={()=>setViewPhoto(null)}
          style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.95)",zIndex:1000,
            display:"flex",alignItems:"center",justifyContent:"center"}}>
          <button onClick={()=>setViewPhoto(null)}
            style={{position:"absolute",top:16,right:16,background:"rgba(255,255,255,0.15)",
              border:"none",borderRadius:"50%",color:"#fff",fontSize:22,width:40,height:40,
              cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
          <img src={viewPhoto} alt="photo"
            style={{maxWidth:"100%",maxHeight:"100vh",objectFit:"contain",borderRadius:8}}
            onClick={e=>e.stopPropagation()}/>
        </div>
      )}
    </div>
  );
}


// ── Panel Feeds ───────────────────────────────────────────────
function PanelFeeds({feeds, onChange}) {
  const add = () => onChange([...feeds, {id:uid(), from:"", to:"", wire:""}]);
  const upd = (id,p) => onChange(feeds.map(f=>f.id===id?{...f,...p}:f));
  const del = (id)   => onChange(feeds.filter(f=>f.id!==id));
  return (
    <div>
      {feeds.length>0&&(
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 110px 28px",
          gap:6,marginBottom:6,padding:"0 2px"}}>
          {["From","To","Wire",""].map((h,i)=>(
            <div key={i} style={{fontSize:10,color:C.dim,fontWeight:700,letterSpacing:"0.08em"}}>{h}</div>
          ))}
        </div>
      )}
      {feeds.map(f=>(
        <div key={f.id} style={{display:"grid",gridTemplateColumns:"1fr 1fr 110px 28px",
          gap:6,marginBottom:6,alignItems:"center"}}>
          <Inp value={f.from} onChange={e=>upd(f.id,{from:e.target.value})} placeholder="e.g. Meter"/>
          <Inp value={f.to}   onChange={e=>upd(f.id,{to:e.target.value})}   placeholder="e.g. Panel A"/>
          <div style={{position:"relative"}}>
            <select value={f.wire} onChange={e=>upd(f.id,{wire:e.target.value})}
              style={{background:WIRE_COLORS[f.wire]||C.surface,
                color:f.wire?(WIRE_TEXT[f.wire]||C.text):C.dim,
                border:`1px solid ${WIRE_COLORS[f.wire]||C.border}`,
                borderRadius:7,padding:"6px 10px",fontSize:12,fontFamily:"inherit",
                outline:"none",width:"100%",fontWeight:f.wire?700:400}}>
              {WIRE_SIZES.map(o=><option key={o} value={o}
                style={{background:WIRE_COLORS[o]||"#f1f5f9",color:WIRE_TEXT[o]||"#0f172a"}}>
                {o||"— wire —"}
              </option>)}
            </select>
          </div>
          <button onClick={()=>del(f.id)}
            style={{background:"none",border:"none",color:C.muted,cursor:"pointer",fontSize:13,padding:"0 2px"}}>✕</button>
        </div>
      ))}
      <Btn onClick={add} variant="add" style={{borderStyle:"dashed",marginTop:4}}>+ Add Panel Feed</Btn>
    </div>
  );
}

// ── Home Runs ─────────────────────────────────────────────────
const PANEL_OPTS = ["","Meter","Panel A","Panel B","Panel C","Panel D","Dedicated Loads"];
const LEADS = ["","Keegan","Daegan","Gage","Abe","Louis","Jonathan","Braden","Treycen"];
const PANEL_ORDER = {"":0,"Panel A":1,"Panel B":2,"Panel C":3,"Panel D":4,"Dedicated Loads":5};
const WIRE_ORDER  = {"":0,"14/2":1,"14/3":2,"12/2":3,"12/3":4,"10/2":5,"10/3":6,"8/2":7,"8/3":8,"6/2":9,"6/3":10,"4/2":11,"4/3":12,"2/2":13,"2/3":14,"1/0":15,"2/0":16,"3/0":17,"4/0":18};

function HomeRunLevel({rows,onChange,label}) {
  const sortRows = (arr) => [...arr].sort((a,b)=>{
    const pd = (PANEL_ORDER[a.panel]||0)-(PANEL_ORDER[b.panel]||0);
    if(pd!==0) return pd;
    return (WIRE_ORDER[a.wire]||0)-(WIRE_ORDER[b.wire]||0);
  }).map((r,i)=>({...r,num:i+1}));

  const upd    = (id,p) => { const updated = rows.map(r=>r.id===id?{...r,...p}:r); onChange(('wire' in p||'panel' in p) ? sortRows(updated) : updated); };
  const addRow = () => onChange([...rows, newHRRow(rows.length+1)]);
  const delRow = (id) => onChange(sortRows(rows.filter(r=>r.id!==id)));

  // Group by panel for display
  const panels = PANEL_OPTS.filter(p=>p&&rows.some(r=>r.panel===p));
  const unassigned = rows.filter(r=>!r.panel);
  const groups = [
    ...panels.map(p=>({panel:p, rows:rows.filter(r=>r.panel===p)})),
    ...(unassigned.length?[{panel:"", rows:unassigned}]:[])
  ];

  const renderRow = (r) => (
    <div key={r.id} style={{marginBottom:6,paddingBottom:6,
      borderBottom:`1px solid ${C.border}`,
      borderRadius:7,padding:"6px 4px",
      background:r.status==="Pulled"?"rgba(34,197,94,0.08)":r.status==="Need Specs"?"rgba(239,68,68,0.1)":"none",
      border:r.status==="Pulled"?`1px solid rgba(34,197,94,0.3)`:r.status==="Need Specs"?`1px solid rgba(239,68,68,0.3)`:`1px solid transparent`}}>
      {/* Row 1: number, panel, wire, delete */}
      <div style={{display:"grid",gridTemplateColumns:"22px 1fr 80px 22px",gap:4,marginBottom:3,alignItems:"center"}}>
        <span style={{fontSize:10,color:C.muted,textAlign:"right"}}>{r.num}.</span>
        <select value={r.panel||""} onChange={e=>upd(r.id,{panel:e.target.value})}
          style={{background:C.surface,color:r.panel?C.accent:C.dim,border:`1px solid ${C.border}`,
            borderRadius:6,padding:"4px 5px",fontSize:10,fontFamily:"inherit",outline:"none",width:"100%"}}>
          {PANEL_OPTS.map(o=><option key={o} value={o}>{o||"— panel —"}</option>)}
        </select>
        <select value={r.wire} onChange={e=>upd(r.id,{wire:e.target.value})}
          style={{background:WIRE_COLORS[r.wire]||C.surface,
            color:r.wire?(WIRE_TEXT[r.wire]||C.text):C.dim,
            border:`1px solid ${WIRE_COLORS[r.wire]||C.border}`,
            borderRadius:6,padding:"4px 5px",fontSize:10,fontFamily:"inherit",
            outline:"none",width:"100%",fontWeight:r.wire?700:400}}>
          {WIRE_SIZES.map(o=><option key={o} value={o}
            style={{background:WIRE_COLORS[o]||"#f1f5f9",color:WIRE_TEXT[o]||"#0f172a"}}>
            {o||"— wire —"}
          </option>)}
        </select>
        <button onClick={()=>delRow(r.id)}
          style={{background:"none",border:"none",color:C.muted,cursor:"pointer",fontSize:13,padding:0}}>✕</button>
      </div>
      {/* Row 2: load name + status */}
      <div style={{display:"grid",gridTemplateColumns:"22px 1fr 80px",gap:4,alignItems:"center"}}>
        <span/>
        <Inp value={r.name} onChange={e=>upd(r.id,{name:e.target.value})} placeholder="Load name…"/>
        <Sel value={r.status} onChange={e=>upd(r.id,{status:e.target.value})} options={PULLED_OPTS}
          style={{color:r.status==="Pulled"?C.green:r.status==="Need Specs"?C.red:C.text,fontSize:10}}/>
      </div>
    </div>
  );

  return (
    <div style={{marginBottom:24}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
        <div style={{fontSize:12,color:C.blue,fontWeight:700,letterSpacing:"0.06em"}}>{label}</div>
        <Btn onClick={addRow} variant="add" style={{fontSize:11,padding:"3px 10px"}}>+ Add Row</Btn>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"22px 1fr 80px 22px",gap:4,marginBottom:4,padding:"0 2px"}}>
        {["#","Panel","Wire",""].map((h,i)=>(
          <div key={i} style={{fontSize:9,color:C.dim,fontWeight:700,letterSpacing:"0.08em"}}>{h}</div>
        ))}
      </div>
      {groups.map(g=>(
        <div key={g.panel||"unassigned"}>
          {g.panel&&(
            <div style={{fontSize:10,color:C.accent,fontWeight:700,letterSpacing:"0.1em",
              textTransform:"uppercase",padding:"6px 0 4px",marginTop:4,
              borderBottom:`1px solid ${C.border}`,marginBottom:4}}>
              {g.panel}
            </div>
          )}
          {g.rows.map(renderRow)}
        </div>
      ))}
      {rows.length===0&&<div style={{fontSize:11,color:C.muted,fontStyle:"italic"}}>No rows yet</div>}
    </div>
  );
}

function MeterLoads({loads, onChange}) {
  const add = () => onChange([...loads, {id:uid(), name:"", amps:"", notes:""}]);
  const upd = (id,p) => onChange(loads.map(r=>r.id===id?{...r,...p}:r));
  const del = (id) => onChange(loads.filter(r=>r.id!==id));
  return (
    <div style={{marginBottom:16}}>
      <div style={{display:"grid",gridTemplateColumns:"1fr 70px 1fr 24px",gap:6,marginBottom:6}}>
        {["Load Name","Amps","Notes",""].map((h,i)=>(
          <div key={i} style={{fontSize:10,color:C.dim,fontWeight:700,letterSpacing:"0.08em"}}>{h}</div>
        ))}
      </div>
      {loads.map(r=>(
        <div key={r.id} style={{display:"grid",gridTemplateColumns:"1fr 70px 1fr 24px",gap:6,marginBottom:4,alignItems:"center"}}>
          <Inp value={r.name}  onChange={e=>upd(r.id,{name:e.target.value})}  placeholder="Load name…"/>
          <Inp value={r.amps}  onChange={e=>upd(r.id,{amps:e.target.value})}  placeholder="Amps…"/>
          <Inp value={r.notes} onChange={e=>upd(r.id,{notes:e.target.value})} placeholder="Notes…"/>
          <button onClick={()=>del(r.id)}
            style={{background:"none",border:"none",color:C.muted,cursor:"pointer",fontSize:13,padding:"0 2px"}}>✕</button>
        </div>
      ))}
      <Btn onClick={add} variant="add" style={{fontSize:11,padding:"3px 10px",marginTop:6}}>+ Add Load</Btn>
    </div>
  );
}

// Wire → {amps, poles} mapping
const WIRE_BREAKER = {
  "14/2": {amps:15,  poles:1}, "14/3": {amps:15,  poles:2},
  "12/2": {amps:20,  poles:1}, "12/3": {amps:20,  poles:2},
  "10/2": {amps:30,  poles:1}, "10/3": {amps:30,  poles:2},
  "8/2":  {amps:40,  poles:2}, "8/3":  {amps:40,  poles:2},
  "6/2":  {amps:50,  poles:2}, "6/3":  {amps:50,  poles:2},
  "4/2":  {amps:70,  poles:2}, "4/3":  {amps:70,  poles:2},
  "2/2":  {amps:95,  poles:2}, "2/3":  {amps:95,  poles:2},
  "1/0":  {amps:125, poles:2}, "2/0":  {amps:150, poles:2},
  "3/0":  {amps:175, poles:2}, "4/0":  {amps:200, poles:2},
};

function BreakerCounts({homeRuns, panelCounts, onCountChange}) {
  const allRows = [
    ...(homeRuns.main||[]),
    ...(homeRuns.upper||[]),
    ...(homeRuns.basement||[]),
  ];

  const panels = ["Panel A","Panel B","Panel C","Panel D","Dedicated Loads"];

  // For each panel, group rows by breaker label and count poles
  const getPanelBreakers = (panel) => {
    const rows = allRows.filter(r=>r.panel===panel && WIRE_BREAKER[r.wire]);
    const groups = {};
    rows.forEach(r=>{
      const {amps,poles} = WIRE_BREAKER[r.wire];
      const label = `${amps}A ${poles===1?"Single Pole":"Double Pole"}`;
      if(!groups[label]) groups[label] = {amps,poles,spaces:0,count:0};
      groups[label].count++;
      groups[label].spaces += poles;
    });
    return groups;
  };

  const totalSpaces = (panel) => {
    const g = getPanelBreakers(panel);
    return Object.values(g).reduce((s,v)=>s+v.spaces,0);
  };

  return (
    <div style={{marginBottom:16}}>
      {panels.map(p=>{
        const groups = getPanelBreakers(p);
        const entries = Object.entries(groups).sort((a,b)=>a[1].amps-b[1].amps);
        const spaces = totalSpaces(p);
        const hasRows = allRows.some(r=>r.panel===p);
        return (
          <div key={p} style={{background:C.surface,border:`1px solid ${C.border}`,
            borderRadius:9,padding:"12px 14px",marginBottom:10}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
              <div style={{fontSize:11,color:C.accent,fontWeight:700,letterSpacing:"0.08em"}}>{p.toUpperCase()}</div>
              <div style={{fontSize:11,color:C.dim}}>
                <span style={{color:spaces>0?C.text:C.muted,fontWeight:700}}>{spaces}</span>
                <span style={{color:C.dim}}> total spaces</span>
              </div>
            </div>
            {entries.length>0 ? (
              <div style={{display:"grid",gridTemplateColumns:"1fr auto auto",gap:"4px 12px",marginBottom:8}}>
                {["Breaker Type","Qty","Spaces"].map((h,i)=>(
                  <div key={i} style={{fontSize:9,color:C.dim,fontWeight:700,letterSpacing:"0.08em",paddingBottom:3,borderBottom:`1px solid ${C.border}`}}>{h}</div>
                ))}
                {entries.map(([label,{count,spaces:sp}])=>(
                  <>
                    <div key={label+"l"} style={{fontSize:11,color:C.text}}>{label}</div>
                    <div key={label+"c"} style={{fontSize:11,color:C.accent,fontWeight:700,textAlign:"center"}}>{count}</div>
                    <div key={label+"s"} style={{fontSize:11,color:C.dim,textAlign:"center"}}>{sp}</div>
                  </>
                ))}
              </div>
            ) : (
              <div style={{fontSize:11,color:C.muted,fontStyle:"italic",marginBottom:8}}>
                {hasRows?"No wire sizes assigned":"No loads assigned to this panel"}
              </div>
            )}
            <div style={{fontSize:10,color:C.dim,marginBottom:3}}>Manual override (total spaces)</div>
            <Inp value={panelCounts?.[p]||""} placeholder="Override…"
              onChange={e=>onCountChange({...panelCounts,[p]:e.target.value})}/>
            {panelCounts?.[p]&&(
              <div style={{fontSize:10,color:C.orange,marginTop:3}}>
                ⚠ Manual: {panelCounts[p]} spaces (auto: {spaces})
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function HomeRunsTab({homeRuns,panelCounts,onHRChange,onCountChange}) {
  const allRows = [...(homeRuns.main||[]),...(homeRuns.upper||[]),...(homeRuns.basement||[])];
  const total   = allRows.length;
  const pulled  = allRows.filter(r=>r.status==="Pulled").length;
  const pct     = total > 0 ? Math.round((pulled/total)*100) : 0;

  return (
    <div>
      {total > 0 && (
        <div style={{marginBottom:20,padding:"14px 16px",background:C.surface,
          border:`1px solid ${C.border}`,borderRadius:12}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
            <span style={{fontSize:12,fontWeight:700,color:C.text}}>Home Runs Pulled</span>
            <span style={{fontSize:13,fontWeight:700,color:pct===100?C.green:C.blue}}>{pulled} / {total} — {pct}%</span>
          </div>
          <div style={{height:8,background:C.border,borderRadius:99,overflow:"hidden"}}>
            <div style={{height:"100%",width:`${pct}%`,
              background:pct===100?C.green:C.blue,
              borderRadius:99,transition:"width 0.4s ease"}}/>
          </div>
        </div>
      )}
      <SectionHead label="Panel Feeds" color={C.blue}/>
      <PanelFeeds feeds={homeRuns.panelFeeds||[]}
        onChange={v=>onHRChange({...homeRuns,panelFeeds:v})}/>
      <div style={{marginTop:24}}>
      <SectionHead label="Home Runs" color={C.blue}/>
      {[["main","Main Level Loads"],["basement","Basement Level Loads"],["upper","Upper Level Loads"]].map(([k,l])=>(
        <HomeRunLevel key={k} label={l} rows={homeRuns[k]||[]}
          onChange={v=>onHRChange({...homeRuns,[k]:v})}/>
      ))}
      </div>
      <SectionHead label="Load Mapping Notes" color={C.blue}/>
      <TA value={homeRuns.loadMappingNotes||""} onChange={e=>onHRChange({...homeRuns,loadMappingNotes:e.target.value})}
        placeholder="Load mapping notes…" rows={5}/>

      <SectionHead label="Panel Breaker Counts" color={C.blue}/>
      <BreakerCounts homeRuns={homeRuns} panelCounts={panelCounts} onCountChange={onCountChange}/>
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
  const DRIVER_OPTS = [20,40,60,96,192,288];
  const calcDriver = (length) => {
    const ft = parseFloat(length);
    if(!ft || isNaN(ft)) return "";
    const watts = ft * 1.5;
    const driver = DRIVER_OPTS.find(d => d >= watts);
    return driver ? `${driver}W` : "288W+";
  };
  const upd = (id,p) => {
    const updated = {...p};
    if(p.length !== undefined) updated.driverSize = calcDriver(p.length);
    onChange(lights.map(l=>l.id===id?{...l,...updated}:l));
  };
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
              {l.driverSize ? (
                <div style={{background:C.teal+"22",border:`1px solid ${C.teal}44`,borderRadius:7,
                  padding:"7px 10px",fontSize:13,fontWeight:700,color:C.teal,textAlign:"center"}}>
                  {l.driverSize}
                </div>
              ) : (
                <Sel value={l.driverSize} onChange={e=>upd(l.id,{driverSize:e.target.value})} options={DRIVER_SIZES}/>
              )}
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
  ["planLink","Plans"],
  ["lightingLink","Lighting Schedules"],["panelLink","Panel Schedules"],
  ["qcLink","QC Link"],["matterportLink","Matterport Link"],
];

function PlansTab({job, onUpdate}) {
  return (
    <div>
      <SectionHead label="Plans + Job Links" color={C.green}/>
      {LINK_FIELDS.map(([k,l])=>{
        const links = (job.linkSections?.[k]) || (job[k] ? [{id:k+"-0", url:job[k]}] : []);
        const setLinks = (newLinks) => onUpdate({
          linkSections:{...(job.linkSections||{}), [k]:newLinks},
          [k]: newLinks[0]?.url || ""
        });
        return (
          <div key={k} style={{marginBottom:16,background:C.surface,border:`1px solid ${C.border}`,borderRadius:9,padding:"10px 12px"}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
              <div style={{fontSize:10,color:C.dim,fontWeight:700,letterSpacing:"0.08em"}}>{l}</div>
              <button onClick={()=>setLinks([...links,{id:uid(),url:""}])}
                style={{background:"none",border:`1px solid ${C.border}`,borderRadius:6,
                  color:C.accent,fontSize:11,padding:"2px 8px",cursor:"pointer",fontFamily:"inherit"}}>
                + Add
              </button>
            </div>
            {links.length===0&&(
              <div style={{fontSize:11,color:C.muted,fontStyle:"italic"}}>No links yet</div>
            )}
            {links.map((lnk,i)=>(
              <div key={lnk.id} style={{marginBottom:8}}>
                <Inp value={lnk.label||""} placeholder="Label (optional)…"
                  style={{marginBottom:4}}
                  onChange={e=>setLinks(links.map((x,j)=>j===i?{...x,label:e.target.value}:x))}/>
                <div style={{display:"flex",gap:6,alignItems:"center"}}>
                  <Inp value={lnk.url||""} placeholder="Paste URL…"
                    onChange={e=>setLinks(links.map((x,j)=>j===i?{...x,url:e.target.value}:x))}/>
                  {lnk.url&&(
                    <a href={lnk.url} target="_blank" rel="noreferrer"
                      style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:7,
                        color:C.blue,padding:"6px 10px",fontSize:11,textDecoration:"none",whiteSpace:"nowrap",flexShrink:0}}>
                      {lnk.label||"Open ↗"}
                    </a>
                  )}
                  <button onClick={()=>setLinks(links.filter((_,j)=>j!==i))}
                    style={{background:"none",border:"none",color:C.muted,cursor:"pointer",fontSize:13,flexShrink:0}}>✕</button>
                </div>
              </div>
            ))}
          </div>
        );
      })}

      {/* Custom named link sections */}
      <div style={{marginTop:8}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
          <div style={{fontSize:10,color:C.dim,fontWeight:700,letterSpacing:"0.08em"}}>CUSTOM SECTIONS</div>
          <button onClick={()=>onUpdate({customLinks:[...(job.customLinks||[]),{id:uid(),name:"New Section",urls:[]}]})}
            style={{background:"none",border:`1px solid ${C.border}`,borderRadius:6,
              color:C.accent,fontSize:11,padding:"2px 8px",cursor:"pointer",fontFamily:"inherit"}}>
            + Add Section
          </button>
        </div>
        {(job.customLinks||[]).map((cl)=>(
          <div key={cl.id} style={{marginBottom:12,background:C.surface,border:`1px solid ${C.border}`,borderRadius:9,padding:"10px 12px"}}>
            <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:8}}>
              <Inp value={cl.name||""} placeholder="Section name…"
                onChange={e=>onUpdate({customLinks:(job.customLinks||[]).map(x=>x.id===cl.id?{...x,name:e.target.value}:x)})}/>
              <button onClick={()=>onUpdate({customLinks:(job.customLinks||[]).map(x=>x.id===cl.id?{...x,urls:[...(x.urls||[]),{id:uid(),url:""}]}:x)})}
                style={{background:"none",border:`1px solid ${C.border}`,borderRadius:6,
                  color:C.accent,fontSize:11,padding:"2px 8px",cursor:"pointer",fontFamily:"inherit",whiteSpace:"nowrap"}}>
                + Add
              </button>
              <button onClick={()=>onUpdate({customLinks:(job.customLinks||[]).filter(x=>x.id!==cl.id)})}
                style={{background:"none",border:"none",color:C.red,cursor:"pointer",fontSize:13,flexShrink:0}}>🗑</button>
            </div>
            {(cl.urls||[]).map((lnk,i)=>(
              <div key={lnk.id} style={{marginBottom:8}}>
                <Inp value={lnk.label||""} placeholder="Label (optional)…"
                  style={{marginBottom:4}}
                  onChange={e=>onUpdate({customLinks:(job.customLinks||[]).map(x=>x.id===cl.id?{...x,urls:(x.urls||[]).map((u,j)=>j===i?{...u,label:e.target.value}:u)}:x)})}/>
                <div style={{display:"flex",gap:6,alignItems:"center"}}>
                  <Inp value={lnk.url||""} placeholder="Paste URL…"
                    onChange={e=>onUpdate({customLinks:(job.customLinks||[]).map(x=>x.id===cl.id?{...x,urls:(x.urls||[]).map((u,j)=>j===i?{...u,url:e.target.value}:u)}:x)})}/>
                  {lnk.url&&(
                    <a href={lnk.url} target="_blank" rel="noreferrer"
                      style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:7,
                        color:C.blue,padding:"6px 10px",fontSize:11,textDecoration:"none",whiteSpace:"nowrap",flexShrink:0}}>
                      {lnk.label||"Open ↗"}
                    </a>
                  )}
                  <button onClick={()=>onUpdate({customLinks:(job.customLinks||[]).map(x=>x.id===cl.id?{...x,urls:(x.urls||[]).filter((_,j)=>j!==i)}:x)})}
                    style={{background:"none",border:"none",color:C.muted,cursor:"pointer",fontSize:13,flexShrink:0}}>✕</button>
                </div>
              </div>
            ))}
            {(!cl.urls||cl.urls.length===0)&&(
              <div style={{fontSize:11,color:C.muted,fontStyle:"italic"}}>No links yet — hit "+ Add"</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}


const TABS = ["Job Info","Rough","Finish","Home Runs","Panelized Lighting","Tape Light",
              "Change Orders","Return Trips","Plans & Links"];

function JobDetail({job: rawJob, onUpdate, onClose}) {
  // Defensive normalization — prevents crashes on old jobs missing fields
  const job = {
    changeOrders:[], returnTrips:[], uploadedFiles:[], customLinks:[],
    roughMaterials:[], roughUpdates:[], finishMaterials:[], finishUpdates:[],
    homeRuns:{}, roughPunch:{}, finishPunch:{},
    roughQuestions:{upper:[],main:[],basement:[]},
    finishQuestions:{upper:[],main:[],basement:[]},
    ...rawJob,
    changeOrders: rawJob?.changeOrders || [],
    returnTrips:  rawJob?.returnTrips  || [],
    uploadedFiles:rawJob?.uploadedFiles|| [],
    customLinks:  rawJob?.customLinks  || [],
    roughMaterials: rawJob?.roughMaterials || [],
    roughUpdates:   rawJob?.roughUpdates   || [],
    finishMaterials:rawJob?.finishMaterials|| [],
    finishUpdates:  rawJob?.finishUpdates  || [],
    roughPunch:  rawJob?.roughPunch  || {},
    finishPunch: rawJob?.finishPunch || {},
    homeRuns:    rawJob?.homeRuns    || {},
    roughQuestions: rawJob?.roughQuestions || {upper:[],main:[],basement:[]},
    finishQuestions:rawJob?.finishQuestions|| {upper:[],main:[],basement:[]},
  };
  const [tab, setTab]       = useState("Job Info");
  const [emailData, setEmailData] = useState(null);
  const jobRef = useRef(job);
  useEffect(()=>{ jobRef.current = job; },[job]);
  const u = patch => onUpdate({...jobRef.current,...patch});
  const saveNow = () => onUpdate({...jobRef.current});
  const [refreshing, setRefreshing] = useState(false);
  const refreshJob = async () => {
    setRefreshing(true);
    try {
      const snap = await getDocs(collection(db,"jobs"));
      const found = snap.docs.find(d=>d.id===job.id);
      if(found?.data()?.data) onUpdate(found.data().data);
    } catch(e){ console.error(e); }
    setRefreshing(false);
  };

  const countFloor = (f) => {
    if (!f) return 0;
    if (Array.isArray(f)) return f.filter(i=>!i.done).length;
    return (f.general||[]).filter(i=>!i.done).length +
      (f.rooms||[]).reduce((a,r)=>a+(Array.isArray(r.items)?r.items.filter(i=>!i.done).length:0),0);
  };
  const openCount = ['roughPunch','finishPunch'].reduce((total,key)=>{
    const p = job?.[key]||{};
    return total + countFloor(p.upper) + countFloor(p.main) + countFloor(p.basement);
  },0);
  const pendingCOs = (job.changeOrders||[]).filter(c=>c.status==="Pending").length;

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
              {job.simproNo&&<span style={{fontSize:13,color:C.dim,fontFamily:"'DM Sans',sans-serif",fontWeight:600,letterSpacing:"0.05em",marginRight:8}}>#{job.simproNo}</span>}
              {job.name||"New Job"}
            </div>
            <div style={{fontSize:11,color:C.dim,marginTop:2}}>
              {[job.address,job.gc].filter(Boolean).join(" · ")||"No details yet"}
            </div>
          </div>
          <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap",justifyContent:"flex-end"}}>
            {openCount>0  &&<Pill label={`${openCount} open punch`} color={C.red}/>}
            {pendingCOs>0 &&<Pill label={`${pendingCOs} CO pending`} color={C.purple}/>}
            
            <button onClick={refreshJob} title="Refresh"
              style={{background:"none",border:`1px solid ${C.border}`,borderRadius:8,
                color:C.dim,cursor:"pointer",padding:"5px 10px",fontSize:16,
                opacity:refreshing?0.4:1}} disabled={refreshing}>
              {refreshing?"…":"↻"}
            </button>
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
              {["upper","main","basement"].map(floor=>(
                <div key={floor} style={{marginBottom:16}}>
                  <div style={{fontSize:11,color:C.dim,fontWeight:700,letterSpacing:"0.08em",
                    textTransform:"uppercase",marginBottom:8,paddingBottom:4,
                    borderBottom:`1px solid ${C.border}`}}>{floor}</div>
                  <CP4LoadsSection
                    loads={(job.panelizedLighting.cp4Loads?.[floor])||[]}
                    onChange={v=>u({panelizedLighting:{...job.panelizedLighting,
                      cp4Loads:{...(job.panelizedLighting.cp4Loads||{}), [floor]:v}}})}/>
                </div>
              ))}
            </div>
          )}

          {tab==="Tape Light"&&(
            <div>
              <SectionHead label="Tape Light Locations" color={C.teal}/>
              <TapeLightSection lights={job.tapeLights||[]} onChange={v=>u({tapeLights:v})}/>

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
                <Sel value={job.foreman||"Koy"} onChange={e=>u({foreman:e.target.value})} options={[...FOREMEN,"Unassigned"]}/>
              </div>
              <div>
                <div style={{fontSize:10,color:C.dim,marginBottom:3}}>Lead</div>
                <Inp value={job.lead||""} onChange={e=>u({lead:e.target.value})} placeholder="Lead name…"/>
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


// ── Punch Assignment & Sign-off ───────────────────────────────
const CREW = ["Koy","Vasa","Colby","Josh","Brady","Justin"];

function PunchAssignTab({phase, assignData, onChange, color}) {
  const data = assignData || { assignments:[], signoffs:[] };
  const assignments = data.assignments || [];
  const signoffs    = data.signoffs    || [];

  const updA = (id, p) => onChange({...data, assignments: assignments.map(a=>a.id===id?{...a,...p}:a)});
  const delA = (id)    => onChange({...data, assignments: assignments.filter(a=>a.id!==id)});
  const addA = ()      => onChange({...data, assignments: [...assignments, {id:uid(), person:"", task:"", floor:"", room:"", done:false}]});

  const updS = (id, p) => onChange({...data, signoffs: signoffs.map(s=>s.id===id?{...s,...p}:s)});
  const delS = (id)    => onChange({...data, signoffs: signoffs.filter(s=>s.id!==id)});
  const addS = ()      => onChange({...data, signoffs: [...signoffs, {id:uid(), person:"", task:"", completedDate:"", initials:""}]});

  return (
    <div>
      {/* Assignments */}
      <SectionHead label="Assign Work" color={color}/>
      {assignments.map((a,i)=>(
        <div key={a.id} style={{background:C.surface,border:`1px solid ${a.done?C.green+"55":C.border}`,
          borderRadius:10,padding:12,marginBottom:10,borderLeft:`3px solid ${a.done?C.green:color}`}}>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
            <input type="checkbox" checked={!!a.done} onChange={()=>updA(a.id,{done:!a.done})}
              style={{accentColor:C.green,width:15,height:15,cursor:"pointer",flexShrink:0}}/>
            <span style={{fontSize:11,fontWeight:700,color:a.done?C.green:color,flex:1}}>
              Task #{i+1} {a.done&&"✓ Done"}
            </span>
            <button onClick={()=>delA(a.id)}
              style={{background:"none",border:"none",color:C.muted,cursor:"pointer",fontSize:11}}>Remove</button>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
            <div>
              <div style={{fontSize:10,color:C.dim,marginBottom:3}}>Assign To</div>
              <Inp value={a.person||""} onChange={e=>updA(a.id,{person:e.target.value})} placeholder="Name…"/>
            </div>
            <div>
              <div style={{fontSize:10,color:C.dim,marginBottom:3}}>Floor</div>
              <select value={a.floor} onChange={e=>updA(a.id,{floor:e.target.value})}
                style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:7,
                  color:a.floor?C.text:C.dim,padding:"6px 10px",fontSize:12,
                  fontFamily:"inherit",outline:"none",width:"100%"}}>
                <option value="">— select floor —</option>
                {["Upper Level","Main Level","Basement","All Floors"].map(f=><option key={f} value={f}>{f}</option>)}
              </select>
            </div>
          </div>
          <div style={{marginBottom:8}}>
            <div style={{fontSize:10,color:C.dim,marginBottom:3}}>Room / Area <span style={{color:C.muted}}>(optional)</span></div>
            <Inp value={a.room||""} onChange={e=>updA(a.id,{room:e.target.value})} placeholder="e.g. Master Bath, Kitchen…"/>
          </div>
          <div>
            <div style={{fontSize:10,color:C.dim,marginBottom:3}}>Task Description</div>
            <TA value={a.task||""} onChange={e=>updA(a.id,{task:e.target.value})}
              placeholder="Describe the work to be completed…" rows={2}/>
          </div>
        </div>
      ))}
      <Btn onClick={addA} variant="add" style={{width:"100%",borderStyle:"dashed",marginBottom:24}}>+ Add Assignment</Btn>

      {/* Sign-offs */}
      <SectionHead label="Sign Off — Work Completed By" color={color}/>
      {signoffs.map((s,i)=>(
        <div key={s.id} style={{background:C.surface,border:`1px solid ${C.green}33`,
          borderRadius:10,padding:12,marginBottom:10,borderLeft:`3px solid ${C.green}`}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
            <span style={{fontSize:11,fontWeight:700,color:C.green}}>Sign-off #{i+1}</span>
            <button onClick={()=>delS(s.id)}
              style={{background:"none",border:"none",color:C.muted,cursor:"pointer",fontSize:11}}>Remove</button>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
            <div>
              <div style={{fontSize:10,color:C.dim,marginBottom:3}}>Completed By</div>
              <Inp value={s.person||""} onChange={e=>updS(s.id,{person:e.target.value})} placeholder="Name…"/>
            </div>
            <div>
              <div style={{fontSize:10,color:C.dim,marginBottom:3}}>Date Completed</div>
              <Inp value={s.completedDate||""} onChange={e=>updS(s.id,{completedDate:e.target.value})} placeholder="MM/DD/YY"/>
            </div>
          </div>
          <div style={{marginBottom:8}}>
            <div style={{fontSize:10,color:C.dim,marginBottom:3}}>Work Completed</div>
            <TA value={s.task||""} onChange={e=>updS(s.id,{task:e.target.value})}
              placeholder="Describe what was completed…" rows={2}/>
          </div>
          <div>
            <div style={{fontSize:10,color:C.dim,marginBottom:3}}>Initials</div>
            <Inp value={s.initials||""} onChange={e=>updS(s.id,{initials:e.target.value})}
              placeholder="e.g. KM" style={{width:80}}/>
          </div>
        </div>
      ))}
      <Btn onClick={addS} variant="add" style={{width:"100%",borderStyle:"dashed"}}>+ Add Sign-off</Btn>
    </div>
  );
}


function PunchTabWrapper({job, u, phase, punchKey, assignKey, color, onEmail}) {
  const [punchTab, setPunchTab] = useState("Items");
  return (
    <div>
      <div style={{display:"flex",gap:6,marginBottom:14}}>
        {["Items","Assignments & Sign-offs"].map(t=>(
          <button key={t} onClick={()=>setPunchTab(t)}
            style={{padding:"5px 14px",borderRadius:7,fontSize:11,cursor:"pointer",
              fontFamily:"inherit",fontWeight:punchTab===t?700:400,
              background:punchTab===t?color:`${color}15`,
              border:`1px solid ${punchTab===t?color:`${color}33`}`,
              color:punchTab===t?"#000":C.dim,transition:"all 0.15s"}}>
            {t}
          </button>
        ))}
      </div>
      {punchTab==="Items"&&(
        <PunchSection punch={job[punchKey]} onChange={v=>u({[punchKey]:v})}
          jobName={job.name||"This Job"} phase={phase} onEmail={onEmail||(() =>{})}/>
      )}
      {punchTab==="Assignments & Sign-offs"&&(
        <PunchAssignTab phase={phase}
          assignData={job[assignKey]||{assignments:[],signoffs:[]}}
          onChange={v=>u({[assignKey]:v})} color={color}/>
      )}
    </div>
  );
}

// ── Stage Sections ────────────────────────────────────────────
const STAGE_SECTIONS = [
  { key:"rough",    label:"Rough In Progress",  color:"#3b82f6",
    test: j => { const r=parseInt(j.roughStage)||0; const f=parseInt(j.finishStage)||0; return r>0 && r<100 && f===0; } },
  { key:"between",  label:"In Between",          color:"#e8a020",
    test: j => { const r=parseInt(j.roughStage)||0; const f=parseInt(j.finishStage)||0; return r===100 && f===0; } },
  { key:"finish",   label:"Finish In Progress",  color:"#0ea5e9",
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

// ── QC Walks ──────────────────────────────────────────────────
// Deep merge two job objects — arrays are merged by id, scalars prefer local
function deepMergeJob(remote, local) {
  const merged = {...remote};
  for(const key of Object.keys(local)) {
    const lv = local[key];
    const rv = remote[key];
    if(lv === rv) continue;
    // Arrays of objects with ids — merge by id
    if(Array.isArray(lv) && Array.isArray(rv)) {
      const remoteMap = Object.fromEntries((rv||[]).filter(i=>i?.id).map(i=>[i.id,i]));
      const localMap  = Object.fromEntries((lv||[]).filter(i=>i?.id).map(i=>[i.id,i]));
      const allIds = [...new Set([...Object.keys(remoteMap),...Object.keys(localMap)])];
      merged[key] = allIds.map(id => {
        const r = remoteMap[id];
        const l = localMap[id];
        if(!l) return r; // only in remote, keep it
        if(!r) return l; // only in local, keep it
        // Both exist — merge field by field, remote status/pulled fields win
        // (field crew changes win over office edits on status fields)
        return {
          ...l,
          status: r.status || l.status,
          pulled: r.pulled !== undefined ? r.pulled : l.pulled,
        };
      });
    }
    // Nested objects (like homeRuns, panelizedLighting) — recurse
    else if(lv && rv && typeof lv==="object" && typeof rv==="object" && !Array.isArray(lv)) {
      merged[key] = deepMergeJob(rv, lv);
    }
    // Scalars — local wins
    else {
      merged[key] = lv;
    }
  }
  return merged;
}

function App() {
  const [jobs,     setJobs]     = useState([]);
  const [selected, setSelected] = useState(null);
  const [search,   setSearch]   = useState("");
  const [stageF,   setStageF]   = useState("All");
  const [flagOnly, setFlagOnly] = useState(false);
  const [syncStatus, setSyncStatus] = useState("idle");
  const saveTimer    = useRef(null);
  const initialLoad  = useRef(true);

  const jobsRef   = useRef(jobs);
  const isDirty   = useRef(false);
  const saveTimers = useRef({});
  useEffect(()=>{ jobsRef.current = jobs; },[jobs]);

  const migrate = (loaded) => {
    const roughMap  = {"Pre-Wire":"0%","Rough-In":"25%","Rough Inspection":"75%","Rough Complete":"100%"};
    const finishMap = {"Fixtures Ordered":"0%","Finish Scheduled":"20%","Finish In Progress":"50%","Punch List":"75%","CO / Final":"90%","Complete":"100%"};
    return (Array.isArray(loaded)?loaded:[]).map(j=>({...j,
      roughStage:  roughMap[j.roughStage]||(j.roughStage||"0%"),
      finishStage: finishMap[j.finishStage]||(j.finishStage||"0%"),
    }));
  };

  // Real-time listener — all devices stay in sync automatically
  useEffect(()=>{
    // Seed from localStorage while Firebase loads
    try {
      const b = localStorage.getItem('hejobs_backup');
      if(b) { const p=JSON.parse(b); if(p?.length) setJobs(migrate(p)); }
    } catch(e){}

    const unsub = onSnapshot(collection(db,"jobs"),
      (snap) => {
        if(!snap.empty) {
          const loaded = migrate(snap.docs.map(d=>d.data().data).filter(Boolean));
          setJobs(loaded);
          // Keep selected job in sync with latest data
          setSelected(sel => {
            if(!sel) return sel;
            const updated = loaded.find(j=>j.id===sel.id);
            return updated || sel;
          });
          try { localStorage.setItem('hejobs_backup', JSON.stringify(loaded)); } catch(e){}
        } else {
          // Firestore empty — restore from localStorage
          try {
            const b = localStorage.getItem('hejobs_backup');
            if(b) {
              const p = JSON.parse(b);
              if(p?.length) {
                setJobs(p);
                p.forEach(job => setDoc(doc(db,"jobs",job.id),{data:job,updated_at:new Date().toISOString()}).catch(()=>{}));
              }
            }
          } catch(e){}
        }
        initialLoad.current = false;
      },
      (err) => {
        console.error('Snapshot error:',err);
        initialLoad.current = false;
      }
    );
    return () => unsub(); // cleanup on unmount
  },[]);

  // Save a single job as its own Firestore document
  const saveJob = (job) => {
    if(initialLoad.current) return;
    isDirty.current = true;
    setSyncStatus("saving");
    // Always write to localStorage immediately
    try {
      const cur = JSON.parse(localStorage.getItem('hejobs_backup')||'[]');
      localStorage.setItem('hejobs_backup', JSON.stringify(
        cur.filter(j=>j.id!==job.id).concat(job)
      ));
    } catch(e){}
    clearTimeout(saveTimers.current[job.id]);
    saveTimers.current[job.id] = setTimeout(async()=>{
      try {
        await setDoc(doc(db,"jobs",job.id),{data:job,updated_at:new Date().toISOString()});
        isDirty.current = false;
        setSyncStatus("saved");
        setTimeout(()=>setSyncStatus("idle"),2000);
      } catch(e){
        console.error('Save error:',e?.message||e);
        setSyncStatus("error");
      }
    }, 500);
  };

  // Delete job document
  const deleteJobRemote = async (jobId) => {
    try {
      const cur = JSON.parse(localStorage.getItem('hejobs_backup')||'[]');
      localStorage.setItem('hejobs_backup', JSON.stringify(cur.filter(j=>j.id!==jobId)));
    } catch(e){}
    try { await deleteDoc(doc(db,"jobs",jobId)); } catch(e){}
  };

  // Flush all pending saves immediately
  const backupByEmail = () => {
    const data = JSON.stringify(jobsRef.current, null, 2);
    const blob = new Blob([data], {type:"application/json"});
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `homestead-backup-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    // Also open Gmail compose with instructions
    const gmailUrl = `https://mail.google.com/mail/?view=cm&su=${encodeURIComponent("Homestead Electric — Daily Backup " + new Date().toLocaleDateString())}&body=${encodeURIComponent("Backup file downloaded. Attach the file from your downloads folder.\n\nView job board: https://homestead-electric.vercel.app/")}`;
    setTimeout(()=>window.open(gmailUrl,"_blank"), 500);
  };

  const flushSaves = () => {
    jobsRef.current.forEach(job=>{
      clearTimeout(saveTimers.current[job.id]);
      setDoc(doc(db,"jobs",job.id),{data:job,updated_at:new Date().toISOString()}).catch(e=>console.error(e));
      try {
        const cur = JSON.parse(localStorage.getItem('hejobs_backup')||'[]');
        localStorage.setItem('hejobs_backup', JSON.stringify(
          cur.filter(j=>j.id!==job.id).concat(job)
        ));
      } catch(e){}
    });
  };

  // Save on background/close
  useEffect(()=>{
    const handleVisibility = ()=>{ if(document.visibilityState==='hidden' && isDirty.current) flushSaves(); };
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('beforeunload', flushSaves);
    return ()=>{
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('beforeunload', flushSaves);
    };
  },[]);


  const updateJob = updated => { setJobs(js=>js.map(j=>j.id===updated.id?updated:j)); setSelected(updated); saveJob(updated); };
  const addJob    = () => { const j=blankJob(); setJobs(js=>[j,...js]); setSelected(j); saveJob(j); };
  const deleteJob = id => {
    if(!confirm("Delete this job site?")) return;
    setJobs(js=>js.filter(j=>j.id!==id));
    if(selected?.id===id) setSelected(null);
    deleteJobRemote(id);
  };

  const openCount = j => {
    const countFloor = (f) => {
      if (!f) return 0;
      if (Array.isArray(f)) return f.filter(i=>!i.done).length;
      return (f.general||[]).filter(i=>!i.done).length +
        (f.rooms||[]).reduce((a,r)=>a+(Array.isArray(r.items)?r.items.filter(i=>!i.done).length:0),0);
    };
    return ['roughPunch','finishPunch'].reduce((total,key)=>{
      const p = j[key]||{};
      return total + countFloor(p.upper) + countFloor(p.main) + countFloor(p.basement);
    },0);
  };

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

  const viewJobs = view==="foreman" ? jobs.filter(j=>activeForeman==="Unassigned"?(!j.foreman||j.foreman==="Unassigned"):(j.foreman||"Koy")===activeForeman) : jobs;

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
    const pendCO = (job.changeOrders||[]).filter(c=>c.status==="Pending").length;
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
              {job.lead&&<span style={{color:C.accent,fontWeight:600,marginRight:6}}>· {job.lead}</span>}
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
    <div style={{minHeight:"100vh",background:C.bg,fontFamily:"'DM Sans',sans-serif",color:C.text,position:"relative"}}>
      <div style={{position:"fixed",inset:0,backgroundImage:"url(/icon-192.png)",
        backgroundRepeat:"no-repeat",backgroundPosition:"center center",
        backgroundSize:"320px 320px",opacity:0.15,pointerEvents:"none",zIndex:0}}/>

      {/* iOS Chrome banner */}
      {(()=>{
        const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
        const isChrome = /CriOS/i.test(navigator.userAgent);
        return isIOS && isChrome ? (
          <div style={{background:"#f59e0b",color:"#000",padding:"10px 16px",fontSize:12,
            display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
            <span>⚠️ For offline install, open in <strong>Safari</strong>:</span>
            <span style={{fontFamily:"monospace",fontSize:11,wordBreak:"break-all"}}>
              homestead-electric.vercel.app
            </span>
          </div>
        ) : null;
      })()}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=Bebas+Neue&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        ::-webkit-scrollbar{width:4px;height:4px;}
        ::-webkit-scrollbar-track{background:transparent;}
        ::-webkit-scrollbar-thumb{background:#cbd5e1;border-radius:4px;}
        .job-row{transition:background 0.15s,border-color 0.15s;cursor:pointer;}
        .job-row:hover{background:#f8fafc!important;border-color:#cbd5e1!important;}
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

                  <button onClick={backupByEmail}
                    style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:6,
                      color:C.dim,fontSize:11,fontWeight:600,padding:"3px 10px",cursor:"pointer",
                      fontFamily:"inherit"}}>
                    Backup
                  </button>
                  <button onClick={()=>window.location.reload()}
                    style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:6,
                      color:C.dim,fontSize:14,fontWeight:700,padding:"3px 10px",cursor:"pointer",
                      fontFamily:"inherit"}}>
                    ↻
                  </button>
                  <button onClick={()=>{const j=blankJob();j.foreman="Unassigned";setJobs(js=>[j,...js]);setSelected(j);}}
                    style={{background:C.blue,border:"none",borderRadius:6,color:"#fff",
                      fontSize:11,fontWeight:700,padding:"3px 12px",cursor:"pointer",
                      fontFamily:"inherit"}}>
                    + Add Job
                  </button>
                </div>
              </div>
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
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:14}}>
                      {[[fCOs,"Pending COs",fCOs>0?C.blue:C.muted],
                        [fFlag,"Flagged",fFlag>0?C.accent:C.muted]].map(([v,l,c])=>(
                        <div key={l} style={{background:C.surface,borderRadius:8,padding:"8px 10px"}}>
                          <div style={{fontFamily:"'Bebas Neue'",fontSize:20,color:c,lineHeight:1}}>{v}</div>
                          <div style={{fontSize:10,color:C.dim,marginTop:2}}>{l}</div>
                        </div>
                      ))}
                    </div>

                    <div style={{marginTop:14,fontSize:11,color:fc,fontWeight:600,textAlign:"right"}}>View Jobs →</div>
                  </div>
                );
              })}
              {/* Unassigned block */}
              {(()=>{
                const fc    = "#6b7280";
                const uJobs = jobs.filter(j=>!j.foreman||j.foreman==="Unassigned");
                const uOpen = uJobs.reduce((a,j)=>a+openCount(j),0);
                const uCOs  = uJobs.reduce((a,j)=>a+(j.changeOrders||[]).filter(c=>c.status==="Pending").length,0);
                const uFlag = uJobs.filter(j=>j.flagged).length;
                return (
                  <div className="foreman-card" onClick={()=>openForeman("Unassigned")}
                    style={{background:C.card,border:`1px solid ${fc}44`,borderRadius:16,padding:20,borderTop:`3px solid ${fc}`}}>
                    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
                      <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:28,letterSpacing:"0.06em",color:fc}}>Unassigned</div>
                      <div style={{background:`${fc}18`,border:`1px solid ${fc}33`,borderRadius:99,
                        padding:"3px 12px",fontSize:11,color:fc,fontWeight:700}}>
                        {uJobs.length} job{uJobs.length!==1?"s":""}
                      </div>
                    </div>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:14}}>
                      {[[uOpen,"Open Items",uOpen>0?C.red:C.muted],
                        [uCOs,"Pending COs",uCOs>0?C.purple:C.muted],
                        [uFlag,"Flagged",uFlag>0?C.accent:C.muted]].map(([v,l,c])=>(
                        <div key={l} style={{background:C.surface,borderRadius:8,padding:"8px 10px"}}>
                          <div style={{fontFamily:"'Bebas Neue'",fontSize:20,color:c,lineHeight:1}}>{v}</div>
                          <div style={{fontSize:10,color:C.dim,marginTop:2}}>{l}</div>
                        </div>
                      ))}
                    </div>
                    <div style={{marginTop:14,fontSize:11,color:fc,fontWeight:600,textAlign:"right"}}>View Jobs →</div>
                  </div>
                );
              })()}
            </div>


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
              <div style={{width:10,height:10,borderRadius:"50%",background:FOREMEN_COLORS[activeForeman]||"#6b7280",flexShrink:0}}/>
              <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:28,letterSpacing:"0.06em",
                color:FOREMEN_COLORS[activeForeman]||"#6b7280",lineHeight:1}}>{activeForeman}</div>
              <div style={{fontSize:11,color:C.dim}}>
                {jobs.filter(j=>activeForeman==="Unassigned"?(!j.foreman||j.foreman==="Unassigned"):(j.foreman||"Koy")===activeForeman).length} job sites
              </div>
              <div style={{marginLeft:"auto",display:"flex",gap:8,alignItems:"center"}}>
                <span style={{fontSize:11,color:syncColor}}>{syncLabel}</span>
                <button onClick={()=>{const j=blankJob();j.foreman=activeForeman;setJobs(js=>[j,...js]);setSelected(j);}}
                  style={{background:FOREMEN_COLORS[activeForeman]||"#6b7280",border:"none",borderRadius:9,color:"#000",
                    fontWeight:700,padding:"9px 20px",fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>
                  + New Job
                </button>
              </div>
            </div>

            <div style={{display:"flex",gap:10,marginBottom:16,flexWrap:"wrap"}}>
              {(()=>{
                const fJobs = jobs.filter(j=>activeForeman==="Unassigned"?(!j.foreman||j.foreman==="Unassigned"):(j.foreman||"Koy")===activeForeman);
                const fDone = fJobs.filter(j=>parseInt(j.finishStage)===100).length;
                const fRough   = fJobs.filter(j=>parseInt(j.roughStage)>0&&parseInt(j.roughStage)<100&&parseInt(j.finishStage)===0).length;
                const fBetween = fJobs.filter(j=>parseInt(j.roughStage)===100&&parseInt(j.finishStage)===0).length;
                const fFinish  = fJobs.filter(j=>parseInt(j.finishStage)>0&&parseInt(j.finishStage)<100).length;
                const fNotStarted = fJobs.filter(j=>parseInt(j.roughStage)===0).length;
                return [[fJobs.length,"Total Jobs",C.blue],
                  [fNotStarted,"Not Started",C.dim],
                  [fRough,"Rough",C.rough],
                  [fBetween,"In Between",C.orange],
                  [fFinish,"Finish",C.finish],
                  [fDone,"Completed",C.green]].map(([v,l,c])=>(
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
                  style={{background:FOREMEN_COLORS[activeForeman]||"#6b7280",border:"none",borderRadius:9,color:"#000",
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
export default App;
