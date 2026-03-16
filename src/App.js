import { useState, useEffect, useRef } from "react";

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

const HO_WIRE_AMPS = {"14/2":15,"14/3":15,"12/2":20,"12/3":20,"10/2":30,"10/3":30,"8/2":40,"8/3":40,"6/2":50,"6/3":50,"4/2":70,"4/3":70,"2/2":95,"2/3":95,"1/0":125,"2/0":150,"3/0":175,"4/0":200};
const C = {
  bg:"#f1f5f9", surface:"#ffffff", card:"#ffffff", border:"#e2e8f0",
  muted:"#cbd5e1", text:"#0f172a", dim:"#64748b", accent:"#d97706",
  blue:"#2563eb", green:"#16a34a", red:"#dc2626", purple:"#0ea5e9",
  orange:"#ea580c", teal:"#0d9488", rough:"#2563eb", finish:"#0ea5e9",
};

const JOB_ID = "homestead-jobs-v1";
const ROUGH_STATUSES = [
  {value:"",          label:"— set status —",       color:null},
  {value:"ready",     label:"Ready to Start",        color:"#ca8a04", hasDate:true},
  {value:"scheduled", label:"Scheduled",             color:"#2563eb", hasDate:true},
  {value:"waiting",   label:"Waiting on Items",      color:"#ca8a04", dashed:true},
  {value:"inprogress",label:"In Progress",           color:"#7dd3fc"},
  {value:"invoice",   label:"Ready to Invoice",      color:"#ea580c"},
  {value:"complete",  label:"Complete",              color:"#22c55e"},
];
const FINISH_STATUSES = ROUGH_STATUSES;
const CO_STATUSES_NEW = [
  {value:"pending",   label:"Pending",               color:"#ca8a04"},
  {value:"scheduled", label:"Scheduled",             color:"#2563eb", hasDate:true},
  {value:"completed", label:"Work Completed",        color:"#22c55e"},
  {value:"denied",    label:"Denied",                color:"#dc2626"},
];
const RT_STATUSES = [
  {value:"",          label:"— set status —",        color:null},
  {value:"needs",     label:"Needs to be Scheduled", color:"#dc2626", hasDate:true},
  {value:"scheduled", label:"Scheduled",             color:"#8b5cf6", hasDate:true},
  {value:"complete",  label:"Complete",              color:"#22c55e"},
];
const QC_STATUSES = [
  {value:"",          label:"— set status —",        color:null},
  {value:"scheduled", label:"QC Scheduled",          color:"#2563eb", hasDate:true},
  {value:"completed", label:"QC Completed",          color:"#8b5cf6", hasDate:true},
  {value:"pass",      label:"QC Pass",               color:"#22c55e"},
  {value:"fail",      label:"QC Fail",               color:"#dc2626"},
];
const getStatusDef = (arr, val) => arr.find(x=>x.value===val)||{};

const PREP_STAGES   = ['Redline Walk Scheduled','Redline Walk Completed','Redline CO Doc Made','Redline Plans Made','Redline CO Sent','Redline CO Signed','Redline Plans Need to be Updated','Job Prep Complete'];
const PREP_STAGE_ALERT = 'Redline Plans Need to be Updated';
const ROUGH_STAGES  = ['0%','5%','10%','15%','20%','25%','30%','35%','40%','45%','50%','55%','60%','65%','70%','75%','80%','85%','90%','95%','100%'];
const FINISH_STAGES = ['0%','5%','10%','15%','20%','25%','30%','35%','40%','45%','50%','55%','60%','65%','70%','75%','80%','85%','90%','95%','100%'];
const parseStage = (s) => s==='Scheduled' ? 1 : (parseInt(s)||0);

const WIRE_SIZES = ["","14/2","14/3","12/2","12/3","10/2","10/3","8/2","8/3","6/2","6/3","4/2","4/3","2/2","2/3","1/0","2/0","3/0","4/0","#1","#2","#3","#4"];
const WIRE_COLORS = {
  "14/2":"#e8e8e8","14/3":"#3b82f6","12/2":"#f5d020","12/3":"#9b59b6",
  "10/2":"#f4820a","10/3":"#f4a0c0","8/2":"#444444","8/3":"#444444",
  "6/2":"#444444","6/3":"#444444","4/2":"#444444","4/3":"#444444",
  "2/2":"#444444","2/3":"#444444","1/0":"#444444","2/0":"#444444",
  "3/0":"#444444","4/0":"#444444","#1":"#444444","#2":"#444444","#3":"#444444","#4":"#444444",
};
const WIRE_TEXT = {
  "14/2":"#111","14/3":"#fff","12/2":"#111","12/3":"#fff","10/2":"#111","10/3":"#111",
  "8/2":"#fff","8/3":"#fff","6/2":"#fff","6/3":"#fff","4/2":"#fff","4/3":"#fff",
  "2/2":"#fff","2/3":"#fff","1/0":"#fff","2/0":"#fff","3/0":"#fff","4/0":"#fff",
  "#1":"#fff","#2":"#fff","#3":"#fff","#4":"#fff",
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

const newHRRow  = (num) => ({ id:uid(), num, wire:"", name:"", status:"", panel:"" });
const newCP4Row = (num) => ({ id:uid(), num, name:"", module:"", status:"" });
const newKPRow  = (num) => ({ id:uid(), num, name:"" });
const emptyPunch = ()   => ({ upper:[], main:[], basement:[] });

const FOREMEN = ["Koy", "Vasa", "Colby"];
const FOREMEN_COLORS = {"Koy":"#3b82f6","Vasa":"#f97316","Colby":"#22c55e"};

const blankJob = () => ({
  id:uid(), name:"", address:"", gc:"", phone:"", simproNo:"", foreman:"Koy", lead:"", flagged:false, flagNote:"",
  planLink:"", redlineLink:"", lightingLink:"", panelLink:"", qcLink:"", matterportLink:"",
  uploadedFiles:[],
  prepStage:"", roughStage:"0%", finishStage:"0%", roughScheduled:false, finishScheduled:false,
  roughScheduledDate:"", finishScheduledDate:"", prepStartDate:"", finishStartDate:"",
  roughQuestions:{ upper:[], main:[], basement:[] },
  roughPunch:emptyPunch(), roughMaterials:[], roughUpdates:[], roughNotes:"",
  qcPunch:emptyPunch(),
  finishPunch:emptyPunch(), finishMaterials:[], finishUpdates:[], finishNotes:"",
  finishQuestions:{ upper:[], main:[], basement:[] },
  changeOrders:[], returnTrips:[],
  roughStatus:"", roughStatusDate:"", roughProjectedStart:"",
  finishStatus:"", finishStatusDate:"", finishProjectedStart:"",
  qcStatus:"", qcStatusDate:"",
  readyToSchedule:false, readyToInvoice:false, roughOnHold:false, finishOnHold:false,
  tempPed:false, tempPedNumber:"",
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
    extraFloors:    [],
  },
  tapeLights:[], loadMappingNotes:"",
});

// ── Google Chat helper ────────────────────────────────────────
// Copies a pre-formatted message to clipboard, then opens Google Chat.
// Google Chat has no external pre-fill deep-link support, so copy+open
// is the most reliable cross-device approach.
const openGoogleChat = (message) => {
  navigator.clipboard.writeText(message).catch(()=>{
    const ta = document.createElement("textarea");
    ta.value = message;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  });
  window.open("https://chat.google.com", "_blank");
};

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
    openEmail(allRecipients.join(","), subject, body);
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
        <div style={{borderTop:`1px solid ${C.border}`,paddingTop:12,marginBottom:12}}>
          <div style={{fontSize:10,color:C.dim,fontWeight:700,letterSpacing:"0.1em",marginBottom:8}}>ADD ANOTHER RECIPIENT</div>
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
    borderBottom:`2px solid ${color}44`,paddingBottom:7,marginBottom:14,marginTop:8}}>
    <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:20,letterSpacing:"0.08em",color}}>{label}</div>
    {action&&<div style={{display:"flex",gap:6}}>{action}</div>}
  </div>
);

function Section({label, color=C.dim, action=null, defaultOpen=false, children}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{marginBottom:4}}>
      <div onClick={()=>setOpen(o=>!o)}
        style={{display:"flex",alignItems:"center",justifyContent:"space-between",
          borderBottom:`2px solid ${color}44`,paddingBottom:7,marginBottom:open?14:0,marginTop:8,
          cursor:"pointer",userSelect:"none"}}>
        <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:20,letterSpacing:"0.08em",color}}>{label}</div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          {action&&<div onClick={e=>e.stopPropagation()} style={{display:"flex",gap:6}}>{action}</div>}
          <span style={{color,fontSize:14,fontWeight:700,marginLeft:4}}>{open?"▾":"▸"}</span>
        </div>
      </div>
      {open&&<div>{children}</div>}
    </div>
  );
}

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
    chat:   {background:"none",border:`1px solid #25d36655`,color:"#25d366"},
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
  const isScheduled = current === "Scheduled";
  const pct = isScheduled ? 0 : (parseInt(current)||0);
  const r = pct < 50 ? 220 : Math.round(220 - (pct-50)/50 * 186);
  const g = pct < 50 ? Math.round(40 + (pct/50) * 175) : 215;
  const b = 40;
  const barColor = isScheduled ? "#f97316" : `rgb(${r},${g},${b})`;
  return (
    <div style={{display:"flex",gap:6,alignItems:"center"}}>
      <div style={{flex:1,height:5,background:C.border,borderRadius:99,overflow:"hidden"}}>
        <div style={{height:"100%",width:isScheduled?"100%":`${pct}%`,
          background:isScheduled?"rgba(249,115,22,0.25)":barColor,
          borderRadius:99,transition:"width 0.4s, background 0.4s"}}/>
      </div>
      <span style={{fontSize:10,color:barColor,whiteSpace:"nowrap",fontWeight:600,minWidth:28,textAlign:"right"}}>{current}</span>
    </div>
  );
};

// ── Punch List ────────────────────────────────────────────────
function normFloor(v) {
  if (v && typeof v === 'object' && !Array.isArray(v) && ('general' in v || 'rooms' in v)) {
    return { general: Array.isArray(v.general) ? v.general : [], rooms: Array.isArray(v.rooms) ? v.rooms : [] };
  }
  return { general: Array.isArray(v) ? v : [], rooms: [] };
}

function PunchItems({ items, onChange }) {
  const safeItems = Array.isArray(items) ? items : [];
  const [draft, setDraft] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState('');
  const add = () => {
    if (!draft.trim()) return;
    onChange([...safeItems, { id: uid(), text: draft, done: false }]);
    setDraft('');
  };
  const startEdit = (item) => { setEditingId(item.id); setEditText(item.text); };
  const commitEdit = (id) => {
    if (editText.trim()) onChange(safeItems.map(i => i.id === id ? { ...i, text: editText.trim() } : i));
    setEditingId(null);
  };
  return (
    <div style={{ paddingLeft: 8 }}>
      {safeItems.map(item => (
        <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
          <input type="checkbox" checked={!!item.done}
            onChange={() => onChange(safeItems.map(i => i.id === item.id ? { ...i, done: !i.done } : i))}
            style={{ accentColor: C.green, width: 14, height: 14, cursor: 'pointer', flexShrink: 0 }} />
          {editingId === item.id ? (
            <input autoFocus value={editText} onChange={e=>setEditText(e.target.value)}
              onBlur={()=>commitEdit(item.id)} onKeyDown={e=>{if(e.key==='Enter')commitEdit(item.id);if(e.key==='Escape')setEditingId(null);}}
              style={{flex:1,fontSize:12,background:C.surface,border:`1px solid ${C.blue}`,borderRadius:6,
                padding:'3px 7px',color:C.text,fontFamily:'inherit',outline:'none'}}/>
          ) : (
            <span onClick={()=>!item.done&&startEdit(item)}
              style={{ flex: 1, fontSize: 12, color: item.done ? C.muted : C.text,
                textDecoration: item.done ? 'line-through' : 'none',
                cursor: item.done ? 'default' : 'text',
                borderRadius: 4, padding: '2px 4px', transition: 'background 0.1s' }}
              onMouseEnter={e=>{if(!item.done)e.target.style.background=C.border+'66'}}
              onMouseLeave={e=>e.target.style.background='transparent'}>
              {item.text}
            </span>
          )}
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

function RoomNameEdit({name, onSave}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(name);
  const commit = () => { if(text.trim()) onSave(text.trim()); setEditing(false); };
  if(editing) return (
    <input autoFocus value={text} onChange={e=>setText(e.target.value)}
      onBlur={commit} onKeyDown={e=>{if(e.key==='Enter')commit();if(e.key==='Escape')setEditing(false);}}
      style={{flex:1,fontSize:12,fontWeight:700,background:C.surface,border:`1px solid ${C.blue}`,
        borderRadius:6,padding:'3px 7px',color:C.text,fontFamily:'inherit',outline:'none'}}/>
  );
  return (
    <span onClick={()=>setEditing(true)}
      style={{fontSize:12,fontWeight:700,color:C.text,flex:1,cursor:'text',
        borderRadius:4,padding:'2px 4px',transition:'background 0.1s'}}
      onMouseEnter={e=>e.target.style.background=C.border+'66'}
      onMouseLeave={e=>e.target.style.background='transparent'}>
      {name}
    </span>
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
                <RoomNameEdit name={room.name} onSave={v=>onFloorChange(floorKey,{...data,rooms:data.rooms.map(r=>r.id===room.id?{...r,name:v}:r)})}/>
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
  const extras = punch.extras || [];
  const [newFloorName, setNewFloorName] = useState("");
  const [addingFloor,  setAddingFloor]  = useState(false);
  const FLOOR_COLORS = [C.teal, C.purple, C.blue, C.accent, C.green];
  const handleFloorChange = (floorKey, newFloorData) => {
    const extraData = {};
    extras.forEach(e => { extraData[e.key] = normFloor(punch[e.key]); });
    onChange({ upper, main, basement, extras, ...extraData, [floorKey]: newFloorData });
  };
  const addFloor = () => {
    const label = newFloorName.trim();
    if(!label) return;
    const key = "extra_" + label.toLowerCase().replace(/[^a-z0-9]/g,"_") + "_" + Date.now();
    const newExtras = [...extras, {key, label}];
    const extraData = {};
    extras.forEach(e => { extraData[e.key] = normFloor(punch[e.key]); });
    onChange({ upper, main, basement, extras: newExtras, ...extraData, [key]: normFloor(undefined) });
    setNewFloorName("");
    setAddingFloor(false);
  };
  const removeFloor = (key) => {
    const newExtras = extras.filter(e=>e.key!==key);
    const extraData = {};
    newExtras.forEach(e => { extraData[e.key] = normFloor(punch[e.key]); });
    const updated = { upper, main, basement, extras: newExtras, ...extraData };
    delete updated[key];
    onChange(updated);
  };
  const countOpen = (f) => f.general.filter(i => !i.done).length +
    f.rooms.reduce((a, r) => a + (Array.isArray(r.items) ? r.items.filter(i => !i.done).length : 0), 0);
  const totalOpen = countOpen(upper) + countOpen(main) + countOpen(basement) +
    extras.reduce((sum,e) => sum + countOpen(normFloor(punch[e.key])), 0);
  const flatItems = (f, label) => [
    ...f.general.filter(i => !i.done).map(i => `[${label}] ${i.text}`),
    ...f.rooms.flatMap(r => (r.items||[]).filter(i => !i.done).map(i => `[${label} - ${r.name}] ${i.text}`)),
  ];
  const handleEmail = () => {
    const all = [
      ...flatItems(upper,'Upper'), ...flatItems(main,'Main'), ...flatItems(basement,'Basement'),
      ...extras.flatMap(e => flatItems(normFloor(punch[e.key]), e.label)),
    ];
    const subject = `${jobName} — ${phase} Punch List`;
    const body = `Open ${phase} punch list items for ${jobName}:\n\n${all.map(i=>`• ${i}`).join('\n')}\n\nPlease review and complete.\n\nThanks\n\nView job board: https://homestead-electric.vercel.app/`;
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
      {extras.map((e,i)=>(
        <div key={e.key} style={{position:"relative"}}>
          <PunchFloor floorKey={e.key} floorData={normFloor(punch[e.key])} onFloorChange={handleFloorChange}
            floorLabel={e.label} floorColor={FLOOR_COLORS[i % FLOOR_COLORS.length]}/>
          <button onClick={()=>removeFloor(e.key)}
            style={{position:"absolute",top:6,right:0,background:"none",border:"none",
              color:C.muted,cursor:"pointer",fontSize:12,padding:"2px 6px",fontFamily:"inherit"}}>
            Remove
          </button>
        </div>
      ))}
      {addingFloor ? (
        <div style={{display:"flex",gap:8,alignItems:"center",marginTop:8}}>
          <input value={newFloorName} onChange={e=>setNewFloorName(e.target.value)}
            onKeyDown={e=>{ if(e.key==="Enter") addFloor(); if(e.key==="Escape") setAddingFloor(false); }}
            placeholder="Floor / area name…" autoFocus
            style={{flex:1,border:`1px solid ${C.border}`,borderRadius:7,padding:"6px 10px",
              fontSize:12,fontFamily:"inherit",color:C.text,background:C.surface,outline:"none"}}/>
          <Btn onClick={addFloor} variant="add" style={{fontSize:11,padding:"5px 12px"}}>Add</Btn>
          <button onClick={()=>setAddingFloor(false)}
            style={{background:"none",border:"none",color:C.muted,cursor:"pointer",fontSize:13}}>✕</button>
        </div>
      ) : (
        <Btn onClick={()=>setAddingFloor(true)} variant="add" style={{fontSize:11,padding:"4px 12px",marginTop:8}}>
          + Add Floor / Area
        </Btn>
      )}
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
      <Btn onClick={add} variant="ghost" style={{width:"100%",borderStyle:"dashed",marginBottom:12}}>+ Add Change Order</Btn>
      {orders.map((o,i)=>(
        <div key={o.id} style={{background:o.needsSchedule?"rgba(220,38,38,0.06)":o.coScheduled?"rgba(22,163,74,0.06)":C.surface,
          border:o.needsSchedule?"1px solid #dc262655":o.coScheduled?"1px solid #16a34a55":`1px solid ${C.border}`,
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
  const [d,setD]                   = useState({date:"",text:""});
  const [showPicker,setShowPicker] = useState(false);
  const [selected,setSelected]     = useState([]);
  const add = () => { if(!d.text.trim()) return; onChange([{id:uid(),...d},...updates]); setD({date:"",text:""}); };
  const toggleSelect = (id) => setSelected(s=>s.includes(id)?s.filter(x=>x!==id):[...s,id]);
  const handleEmail = () => {
    const toSend = selected.length>0 ? updates.filter(u=>selected.includes(u.id)) : updates.slice(0,5);
    const body = `Job Update — ${jobName}\n\n${toSend.map(u=>`${u.date||"—"}: ${u.text}`).join("\n\n")}\n\nThanks\n\nView job board: https://homestead-electric.vercel.app/`;
    onEmail({subject:`${jobName} — Job Update`, body});
    setShowPicker(false);
    setSelected([]);
  };
  return (
    <div>
      <div style={{display:"flex",justifyContent:"flex-end",marginBottom:8,gap:8}}>
        {updates.length>0&&(
          <Btn onClick={()=>setShowPicker(p=>!p)} variant="email" style={{fontSize:11,padding:"4px 10px"}}>
            ✉ {showPicker?"Cancel":"Select Updates to Email"}
          </Btn>
        )}
        {showPicker&&selected.length>0&&(
          <Btn onClick={handleEmail} variant="primary" style={{fontSize:11,padding:"4px 10px"}}>Send ({selected.length})</Btn>
        )}
        {showPicker&&selected.length===0&&(
          <Btn onClick={handleEmail} variant="primary" style={{fontSize:11,padding:"4px 10px"}}>Send Last 5</Btn>
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
        <div key={u.id} onClick={()=>showPicker&&toggleSelect(u.id)}
          style={{display:"flex",gap:10,padding:"8px 12px",
            background:showPicker&&selected.includes(u.id)?C.blue+"18":C.surface,
            borderRadius:8,marginBottom:6,
            border:`1px solid ${showPicker&&selected.includes(u.id)?C.blue:C.border}`,
            cursor:showPicker?"pointer":"default",transition:"all 0.15s"}}>
          {showPicker&&(
            <div style={{width:16,height:16,borderRadius:4,
              border:`2px solid ${selected.includes(u.id)?C.blue:C.border}`,
              background:selected.includes(u.id)?C.blue:"transparent",flexShrink:0,marginTop:1,
              display:"flex",alignItems:"center",justifyContent:"center"}}>
              {selected.includes(u.id)&&<span style={{color:"#fff",fontSize:10,fontWeight:700}}>✓</span>}
            </div>
          )}
          <span style={{fontSize:11,color:C.accent,whiteSpace:"nowrap",fontWeight:600,flexShrink:0}}>{u.date||"—"}</span>
          <span style={{flex:1,fontSize:12,color:C.text,lineHeight:1.5}}>{u.text}</span>
          {!showPicker&&<button onClick={()=>onChange(updates.filter(x=>x.id!==u.id))}
            style={{background:"none",border:"none",color:C.muted,cursor:"pointer",fontSize:11,flexShrink:0}}>✕</button>}
        </div>
      ))}
    </div>
  );
}

// ── Change Orders ─────────────────────────────────────────────
function ChangeOrders({orders,onChange,jobName,onEmail}) {
  const add = () => onChange([{id:uid(),date:"",desc:"",task:"",material:"",time:"",status:"Pending",sendTo:"",
    needsSchedule:false,needsScheduleDate:"",coScheduled:false,scheduledDate:""},...orders]);
  const upd = (id,p) => onChange(orders.map(o=>o.id===id?{...o,...p}:o));
  const del = (id)   => onChange(orders.filter(o=>o.id!==id));

  // ── Send individual CO to Google Chat ──────────────────────
  const chatCO = (o, i) => {
    const lines = [`💬 *Change Order #${i} — ${jobName}*`, ``];
    if (o.date)     lines.push(`📅 Date: ${o.date}`);
    if (o.sendTo)   lines.push(`👤 Send To: ${o.sendTo}`);
    if (o.desc)     lines.push(`📝 Description: ${o.desc}`);
    if (o.task)     lines.push(`🔧 Task:\n${o.task}`);
    if (o.material) lines.push(`📦 Materials:\n${o.material}`);
    if (o.time)     lines.push(`⏱ Est. Time: ${o.time}`);
    const coStatusLabel = getStatusDef(CO_STATUSES_NEW, o.coStatus||"pending").label || o.coStatus || "Pending";
    lines.push(`📊 Status: ${coStatusLabel}`);
    lines.push(``);
    lines.push(`🔗 https://homestead-electric.vercel.app/`);
    openGoogleChat(lines.join("\n"));
  };

  const emailCO = (o, i) => {
    const subject = `${jobName} — Change Order #${i+1}`;
    const body = `Change Order #${i+1} — ${jobName}\n\nDate: ${o.date||"—"}\nSend CO To: ${o.sendTo||"—"}\nDescription: ${o.desc||"—"}\nTask: ${o.task||"—"}\nMaterial Needed: ${o.material||"—"}\nEstimated Time: ${o.time||"—"}\nStatus: ${o.status}\n\nPlease review and confirm.\n\nThanks\n\nView job board: https://homestead-electric.vercel.app/`;
    onEmail({subject, body});
  };

  return (
    <div>
      {orders.map((o,i)=>(
        <div key={o.id} style={{background:C.surface,border:`1px solid ${C.border}`,
          borderRadius:10,padding:14,marginBottom:12}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
            <span style={{fontSize:12,color:C.accent,fontWeight:700}}>Change Order #{i+1}</span>
            <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
              {/* Google Chat button */}
              <button onClick={()=>chatCO(o,i+1)} title="Copy message & open Google Chat"
                style={{background:"none",border:`1px solid #25d36655`,borderRadius:7,
                  color:"#128c7e",cursor:"pointer",fontSize:11,padding:"3px 9px",
                  fontFamily:"inherit",display:"flex",alignItems:"center",gap:4}}>
                💬 Chat
              </button>
              <Btn onClick={()=>emailCO(o,i)} variant="email" style={{fontSize:11,padding:"3px 9px"}}>✉ Email CO</Btn>
              <button onClick={()=>del(o.id)}
                style={{background:"none",border:"none",color:C.muted,cursor:"pointer",fontSize:11}}>Remove</button>
            </div>
          </div>
          <div style={{marginBottom:8}}>
            {(()=>{
              const coDef = getStatusDef(CO_STATUSES_NEW, o.coStatus||"pending");
              return (
                <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                  <select value={o.coStatus||"pending"} onChange={e=>{
                    const v=e.target.value;
                    upd(o.id,{coStatus:v,coStatusDate:getStatusDef(CO_STATUSES_NEW,v).hasDate?o.coStatusDate:""});
                  }} style={{background:coDef.color?`${coDef.color}18`:C.surface,
                    color:coDef.color||C.dim,border:`1px solid ${coDef.color||C.border}`,
                    borderRadius:7,padding:"5px 8px",fontSize:11,fontFamily:"inherit",
                    fontWeight:coDef.color?700:400,outline:"none",cursor:"pointer"}}>
                    {CO_STATUSES_NEW.map(s=><option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                  {coDef.hasDate&&(
                    <Inp value={o.coStatusDate||""} onChange={e=>upd(o.id,{coStatusDate:e.target.value})}
                      placeholder="Date MM/DD/YY"
                      style={{width:120,fontSize:11,borderColor:coDef.color+"55",background:`${coDef.color}08`}}/>
                  )}
                </div>
              );
            })()}
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
            {[["time","Estimated Time","e.g. 3 hrs"]].map(([k,l,ph])=>(
              <div key={k}>
                <div style={{fontSize:10,color:C.dim,marginBottom:3}}>{l}</div>
                <Inp value={o[k]} onChange={e=>upd(o.id,{[k]:e.target.value})} placeholder={ph}/>
              </div>
            ))}
            <div>
              <div style={{fontSize:10,color:C.dim,marginBottom:3}}>Task (In Field)</div>
              <TA value={o.task} onChange={e=>upd(o.id,{task:e.target.value})} placeholder={"- Task 1\n- Task 2"} rows={3}/>
            </div>
            {[[]].map(()=>(<div key="spacer2"/>))}
            <div>
              <div style={{fontSize:10,color:C.dim,marginBottom:3}}>Material Needed</div>
              <TA value={o.material} onChange={e=>upd(o.id,{material:e.target.value})} placeholder={"- Item 1\n- Item 2"} rows={3}/>
            </div>
            {[[]].map(()=>(<div key="spacer"/>))}
          </div>
        </div>
      ))}
      <Btn onClick={add} variant="ghost" style={{width:"100%",borderStyle:"dashed",marginTop:4}}>+ Add Change Order</Btn>
    </div>
  );
}

// ── Return Trips ──────────────────────────────────────────────
function ReturnTrips({trips,onChange,jobName,onEmail}) {
  const [viewPhoto, setViewPhoto] = useState(null);
  const add = () => onChange([{id:uid(),date:"",scope:"",material:"",punch:[],photos:[],assignedTo:"",
    signedOff:false,signedOffBy:"",signedOffDate:"",needsSchedule:false,needsScheduleDate:"",
    rtScheduled:false,scheduledDate:""},...trips]);
  const upd = (id,p) => onChange(trips.map(t=>t.id===id?{...t,...p}:t));
  const del = (id)   => onChange(trips.filter(t=>t.id!==id));

  // ── Send individual Return Trip to Google Chat ─────────────
  const chatTrip = (t, i) => {
    const rtStatusLabel = getStatusDef(RT_STATUSES, t.rtStatus||"").label || "—";
    const lines = [`🔁 *Return Trip #${i} — ${jobName}*`, ``];
    if (t.rtStatusDate) lines.push(`📅 Date: ${t.rtStatusDate}`);
    if (t.assignedTo)   lines.push(`👷 Assigned To: ${t.assignedTo}`);
    if (t.scope)        lines.push(`📝 Scope of Work:\n${t.scope}`);
    if (t.material)     lines.push(`📦 Materials Needed:\n${t.material}`);
    const openPunch = (t.punch||[]).filter(p=>!p.done);
    if (openPunch.length > 0) lines.push(`🔧 Open Punch Items:\n${openPunch.map(p=>`• ${p.text}`).join("\n")}`);
    lines.push(`📊 Status: ${rtStatusLabel}`);
    if (t.signedOff) lines.push(`✅ Signed off by ${t.signedOffBy} on ${t.signedOffDate}`);
    lines.push(``);
    lines.push(`🔗 https://homestead-electric.vercel.app/`);
    openGoogleChat(lines.join("\n"));
  };

  const emailTrip = (t,i) => {
    const punchLines = (t.punch||[]).filter(p=>!p.done).map(p=>`• ${p.text}`).join("\n") || "None";
    const subject = `${jobName} — Return Trip #${i+1}`;
    const body = `Return Trip #${i+1} — ${jobName}\n\nDate: ${t.date||"—"}\nScope of Work:\n${t.scope||"—"}\n\nMaterial Needed:\n${t.material||"—"}\n\nPunch List:\n${punchLines}\n\nThanks\n\nView job board: https://homestead-electric.vercel.app/`;
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
      <Btn onClick={add} variant="ghost" style={{width:"100%",borderStyle:"dashed",marginBottom:12}}>+ Add Return Trip</Btn>
      {trips.map((t,i)=>(
        <div key={t.id} style={{background:t.needsSchedule?"rgba(220,38,38,0.06)":t.rtScheduled?"rgba(139,92,246,0.06)":C.surface,
          border:t.needsSchedule?"1px solid #dc262655":t.rtScheduled?"1px solid #8b5cf655":`1px solid ${C.border}`,
          borderRadius:10,padding:14,marginBottom:14}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
            <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
              <span style={{fontSize:12,color:C.purple,fontWeight:700}}>Return Trip #{i+1}</span>
              {!t.signedOff&&(
                <>
                  {(()=>{
                    const rtDef = getStatusDef(RT_STATUSES, t.rtStatus||"");
                    return (
                      <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                        <select value={t.rtStatus||""} onChange={e=>{
                          const v=e.target.value;
                          upd(t.id,{rtStatus:v,rtScheduled:v==="scheduled",needsSchedule:v==="needs",
                            rtStatusDate:getStatusDef(RT_STATUSES,v).hasDate?t.rtStatusDate:""});
                        }} style={{background:rtDef.color?`${rtDef.color}18`:C.surface,
                          color:rtDef.color||C.dim,border:`1px solid ${rtDef.color||C.border}`,
                          borderRadius:7,padding:"5px 8px",fontSize:11,fontFamily:"inherit",
                          fontWeight:rtDef.color?700:400,outline:"none",cursor:"pointer"}}>
                          {RT_STATUSES.map(s=><option key={s.value} value={s.value}>{s.label}</option>)}
                        </select>
                        {rtDef.hasDate&&(
                          <Inp value={t.rtStatusDate||""} onChange={e=>upd(t.id,{rtStatusDate:e.target.value})}
                            placeholder="Date MM/DD/YY"
                            style={{width:120,fontSize:11,borderColor:rtDef.color+"55",background:`${rtDef.color}08`}}/>
                        )}
                      </div>
                    );
                  })()}
                </>
              )}
            </div>
            <div style={{display:"flex",gap:6,alignItems:"center"}}>
              {/* Google Chat button */}
              <button onClick={()=>chatTrip(t,i+1)} title="Copy message & open Google Chat"
                style={{background:"none",border:`1px solid #25d36655`,borderRadius:7,
                  color:"#128c7e",cursor:"pointer",fontSize:11,padding:"3px 9px",
                  fontFamily:"inherit",display:"flex",alignItems:"center",gap:4}}>
                💬 Chat
              </button>
              <Btn onClick={()=>emailTrip(t,i)} variant="email" style={{fontSize:11,padding:"3px 9px"}}>✉ Email Trip</Btn>
              <button onClick={()=>del(t.id)}
                style={{background:"none",border:"none",color:C.muted,cursor:"pointer",fontSize:11}}>Remove</button>
            </div>
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
                    <img src={p.dataUrl} alt={p.name} onClick={()=>setViewPhoto(p.dataUrl)}
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
          <div style={{marginTop:12,padding:"10px 12px",background:`${C.purple}10`,
            border:`1px solid ${C.purple}33`,borderRadius:8}}>
            <div style={{fontSize:10,color:C.purple,fontWeight:700,marginBottom:6,letterSpacing:"0.08em"}}>ASSIGNED TO</div>
            <Inp value={t.assignedTo||""} onChange={e=>upd(t.id,{assignedTo:e.target.value})} placeholder="Technician name…"/>
          </div>
          <div style={{marginTop:10,padding:"10px 12px",
            background:t.signedOff?`${C.green}12`:`${C.surface}`,
            border:`1px solid ${t.signedOff?C.green+"55":C.border}`,borderRadius:8}}>
            <div style={{fontSize:10,color:t.signedOff?C.green:C.dim,fontWeight:700,
              marginBottom:8,letterSpacing:"0.08em"}}>SIGN OFF</div>
            {!t.signedOff?(
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr auto",gap:8,alignItems:"flex-end"}}>
                <div>
                  <div style={{fontSize:10,color:C.dim,marginBottom:3}}>Name</div>
                  <Inp value={t.signedOffBy||""} onChange={e=>upd(t.id,{signedOffBy:e.target.value})} placeholder="Your name…"/>
                </div>
                <div>
                  <div style={{fontSize:10,color:C.dim,marginBottom:3}}>Date</div>
                  <Inp value={t.signedOffDate||""} onChange={e=>upd(t.id,{signedOffDate:e.target.value})} placeholder="MM/DD/YY"/>
                </div>
                <button onClick={()=>upd(t.id,{signedOff:true})}
                  disabled={!t.signedOffBy||!t.signedOffDate}
                  style={{background:(!t.signedOffBy||!t.signedOffDate)?C.surface:C.green,
                    border:`1px solid ${(!t.signedOffBy||!t.signedOffDate)?C.border:C.green}`,
                    borderRadius:8,color:(!t.signedOffBy||!t.signedOffDate)?C.muted:"#000",
                    padding:"7px 14px",fontSize:12,fontWeight:700,
                    cursor:(!t.signedOffBy||!t.signedOffDate)?"not-allowed":"pointer",
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

// ── Home Runs ─────────────────────────────────────────────────
const DEFAULT_PANELS = ["Panel A","Panel B","Panel C","Panel D"];
const LEADS = ["","Keegan","Daegan","Gage","Abe","Louis","Jonathan","Braden","Treycen"];
const PANEL_ORDER_BASE = {"":0,"Meter":0.5,"Dedicated Loads":999};
const getPanelOpts = (customPanels) => ["","Meter",...(customPanels&&customPanels.length?customPanels:DEFAULT_PANELS),"Dedicated Loads"];
const getPanelOrder = (customPanels) => {
  const opts = getPanelOpts(customPanels);
  const order = {};
  opts.forEach((p,i)=>{ order[p]=i; });
  return order;
};
const WIRE_ORDER = {"":0,"14/2":1,"14/3":2,"12/2":3,"12/3":4,"10/2":5,"10/3":6,"8/2":7,"8/3":8,"6/2":9,"6/3":10,"4/2":11,"4/3":12,"2/2":13,"2/3":14,"1/0":15,"2/0":16,"3/0":17,"4/0":18};

function HomeRunLevel({rows,onChange,label,customPanels}) {
  const sortRows = (arr) => [...arr].sort((a,b)=>{
    const wd = (WIRE_ORDER[b.wire]||0)-(WIRE_ORDER[a.wire]||0);
    if(wd!==0) return wd;
    return (a.name||"").toLowerCase().localeCompare((b.name||"").toLowerCase());
  }).map((r,i)=>({...r,num:i+1}));
  const upd    = (id,p) => { const updated = rows.map(r=>r.id===id?{...r,...p}:r); onChange(('wire' in p||'panel' in p) ? sortRows(updated) : updated.map((r,i)=>({...r,num:i+1}))); };
  const addRow = () => onChange([...rows, newHRRow(rows.length+1)]);
  const delRow = (id) => onChange(sortRows(rows.filter(r=>r.id!==id)));
  const renderRow = (r) => (
    <div key={r.id} style={{marginBottom:6,paddingBottom:6,borderRadius:7,padding:"6px 4px",
      background:r.status==="Pulled"?"rgba(34,197,94,0.08)":r.status==="Need Specs"?"rgba(239,68,68,0.1)":"none",
      border:r.status==="Pulled"?`1px solid rgba(34,197,94,0.3)`:r.status==="Need Specs"?`1px solid rgba(239,68,68,0.3)`:`1px solid transparent`}}>
      <div style={{display:"grid",gridTemplateColumns:"22px 1fr 80px 22px",gap:4,marginBottom:3,alignItems:"center"}}>
        <span style={{fontSize:10,color:C.muted,textAlign:"right"}}>{r.num}.</span>
        <select value={r.panel||""} onChange={e=>upd(r.id,{panel:e.target.value})}
          style={{background:C.surface,color:r.panel?C.accent:C.dim,border:`1px solid ${C.border}`,
            borderRadius:6,padding:"4px 5px",fontSize:10,fontFamily:"inherit",outline:"none",width:"100%"}}>
          {getPanelOpts(customPanels).map(o=><option key={o} value={o}>{o||"— panel —"}</option>)}
        </select>
        <select value={r.wire} onChange={e=>upd(r.id,{wire:e.target.value})}
          style={{background:WIRE_COLORS[r.wire]||C.surface,color:r.wire?(WIRE_TEXT[r.wire]||C.text):C.dim,
            border:`1px solid ${WIRE_COLORS[r.wire]||C.border}`,borderRadius:6,padding:"4px 5px",fontSize:10,
            fontFamily:"inherit",outline:"none",width:"100%",fontWeight:r.wire?700:400}}>
          {WIRE_SIZES.map(o=><option key={o} value={o}
            style={{background:WIRE_COLORS[o]||"#f1f5f9",color:WIRE_TEXT[o]||"#0f172a"}}>
            {o||"— wire —"}
          </option>)}
        </select>
        <button onClick={()=>delRow(r.id)}
          style={{background:"none",border:"none",color:C.muted,cursor:"pointer",fontSize:13,padding:0}}>✕</button>
      </div>
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
      </div>
      <div style={{display:"grid",gridTemplateColumns:"22px 1fr 80px 22px",gap:4,marginBottom:4,padding:"0 2px"}}>
        {["#","Panel","Wire",""].map((h,i)=>(
          <div key={i} style={{fontSize:9,color:C.dim,fontWeight:700,letterSpacing:"0.08em"}}>{h}</div>
        ))}
      </div>
      {rows.map(r=>renderRow(r))}
      {rows.length===0&&<div style={{fontSize:11,color:C.muted,fontStyle:"italic"}}>No rows yet</div>}
      <Btn onClick={addRow} variant="add" style={{fontSize:11,padding:"3px 10px",marginTop:6}}>+ Add Row</Btn>
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

const WIRE_BREAKER = {
  "14/2":{amps:15,poles:1},"14/3":{amps:15,poles:2},"12/2":{amps:20,poles:1},"12/3":{amps:20,poles:2},
  "10/2":{amps:30,poles:1},"10/3":{amps:30,poles:2},"8/2":{amps:40,poles:2},"8/3":{amps:40,poles:2},
  "6/2":{amps:50,poles:2},"6/3":{amps:50,poles:2},"4/2":{amps:70,poles:2},"4/3":{amps:70,poles:2},
  "2/2":{amps:95,poles:2},"2/3":{amps:95,poles:2},"1/0":{amps:125,poles:2},"2/0":{amps:150,poles:2},
  "3/0":{amps:175,poles:2},"4/0":{amps:200,poles:2},
};

function BreakerCounts({homeRuns, panelCounts, onCountChange}) {
  const extraRows = (homeRuns.extraFloors||[]).flatMap(ef=>homeRuns[ef.key]||[]);
  const allRows = [...(homeRuns.main||[]),...(homeRuns.upper||[]),...(homeRuns.basement||[]),...extraRows];
  const panels = getPanelOpts(homeRuns.customPanels||DEFAULT_PANELS).filter(p=>p!==""&&p!=="Meter");
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
          <div key={p} style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:9,padding:"12px 14px",marginBottom:10}}>
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

function HRAddFloor({homeRuns, onHRChange}) {
  const [adding, setAdding] = useState(false);
  const [name,   setName]   = useState("");
  const add = () => {
    const label = name.trim();
    if(!label) return;
    const key = "hr_extra_" + label.toLowerCase().replace(/[^a-z0-9]/g,"_") + "_" + Date.now();
    onHRChange({...homeRuns, extraFloors:[...(homeRuns.extraFloors||[]),{key,label}], [key]:[]});
    setName(""); setAdding(false);
  };
  if(!adding) return (
    <Btn onClick={()=>setAdding(true)} variant="add" style={{fontSize:11,padding:"4px 12px",marginTop:4}}>
      + Add Floor / Area
    </Btn>
  );
  return (
    <div style={{display:"flex",gap:8,alignItems:"center",marginTop:8}}>
      <input value={name} onChange={e=>setName(e.target.value)}
        onKeyDown={e=>{if(e.key==="Enter")add();if(e.key==="Escape")setAdding(false);}}
        placeholder="Floor or area name…" autoFocus
        style={{flex:1,border:`1px solid ${C.border}`,borderRadius:7,padding:"6px 10px",
          fontSize:12,fontFamily:"inherit",color:C.text,background:C.surface,outline:"none"}}/>
      <Btn onClick={add} variant="add" style={{fontSize:11,padding:"5px 12px"}}>Add</Btn>
      <button onClick={()=>setAdding(false)}
        style={{background:"none",border:"none",color:C.muted,cursor:"pointer",fontSize:13}}>✕</button>
    </div>
  );
}

function HomeRunsTab({homeRuns,panelCounts,onHRChange,onCountChange,jobId,jobName}) {
  const [hoResponse, setHoResponse] = useState(null);
  const [showHoModal, setShowHoModal] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [newPanelName, setNewPanelName] = useState("");
  const hoLink = `https://homestead-electric.vercel.app/?homeowner=${jobId}`;
  const copyLink = () => {
    navigator.clipboard.writeText(hoLink).then(()=>{ setLinkCopied(true); setTimeout(()=>setLinkCopied(false),2000); });
  };
  const resetResponse = async () => {
    if(!window.confirm("Clear the homeowner's response so they can redo it? This cannot be undone.")) return;
    try {
      await deleteDoc(doc(db,"homeowner_requests",jobId));
      setHoResponse(null); setShowHoModal(false);
      alert("Response cleared. You can now resend the link to the homeowner.");
    } catch(e) { alert("Error clearing response: "+e.message); }
  };
  const checkResponse = async () => {
    try {
      const snap = await getDoc(doc(db,"homeowner_requests",jobId));
      if(snap.exists()&&snap.data().submitted) { setHoResponse(snap.data()); setShowHoModal(true); }
      else { alert("No response submitted yet."); }
    } catch(e){ alert("Failed to check response."); }
  };
  const allRows = [...(homeRuns.main||[]),...(homeRuns.upper||[]),...(homeRuns.basement||[]),
    ...(homeRuns.extraFloors||[]).flatMap(e=>homeRuns[e.key]||[])];
  const total  = allRows.length;
  const pulled = allRows.filter(r=>r.status==="Pulled").length;
  const pct    = total > 0 ? Math.round((pulled/total)*100) : 0;
  return (
    <div>
      <div style={{marginBottom:16,padding:"12px 14px",background:C.surface,border:`0.5px solid ${C.border}`,borderRadius:10}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:10}}>
          <div>
            <div style={{fontSize:12,fontWeight:500,color:C.text,marginBottom:2}}>Generator load selection</div>
            <div style={{fontSize:11,color:C.dim}}>Share a link so the homeowner can choose &amp; prioritize circuits</div>
          </div>
          <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
            <button onClick={copyLink}
              style={{background:linkCopied?"#16a34a":"#1e293b",border:"none",borderRadius:7,color:"#fff",
                fontWeight:500,fontSize:11,padding:"6px 12px",cursor:"pointer",fontFamily:"inherit"}}>
              {linkCopied?"✓ Copied":"Copy link"}
            </button>
            <button onClick={()=>window.open(hoLink,"_blank")}
              style={{background:"none",border:`0.5px solid ${C.border}`,borderRadius:7,color:C.dim,
                fontWeight:500,fontSize:11,padding:"6px 12px",cursor:"pointer",fontFamily:"inherit"}}>
              Preview
            </button>
            <button onClick={checkResponse}
              style={{background:"none",border:`0.5px solid ${C.border}`,borderRadius:7,color:C.dim,
                fontWeight:500,fontSize:11,padding:"6px 12px",cursor:"pointer",fontFamily:"inherit"}}>
              View response
            </button>
          </div>
        </div>
      </div>
      {showHoModal&&hoResponse&&(
        <div onClick={()=>setShowHoModal(false)}
          style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.4)",zIndex:9999,
            display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
          <div onClick={e=>e.stopPropagation()}
            style={{background:"#fff",borderRadius:12,padding:22,maxWidth:440,width:"100%",
              maxHeight:"82vh",overflowY:"auto",border:"0.5px solid #e2e8f0"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
              <div style={{fontSize:14,fontWeight:500,color:"#1e293b"}}>Homeowner selections</div>
              <button onClick={()=>setShowHoModal(false)}
                style={{background:"none",border:"none",fontSize:16,cursor:"pointer",color:"#94a3b8",padding:0}}>✕</button>
            </div>
            <div style={{fontSize:11,color:"#94a3b8",marginBottom:10}}>
              Submitted {hoResponse.submittedAt?new Date(hoResponse.submittedAt).toLocaleString():""}
            </div>
            <button onClick={resetResponse}
              style={{width:"100%",marginBottom:14,background:"none",border:`1px solid ${C.border}`,
                borderRadius:7,padding:"7px 12px",fontSize:11,fontWeight:500,color:C.dim,
                cursor:"pointer",fontFamily:"inherit"}}>
              🔄 Reset &amp; resend — let homeowner redo their selections
            </button>
            {hoResponse.signature&&(
              <div style={{fontSize:12,color:"#64748b",marginBottom:14,padding:"8px 10px",
                background:"#f8fafc",borderRadius:7,border:"0.5px solid #e2e8f0"}}>
                Signed by: <span style={{fontFamily:"Georgia,serif",color:"#1e293b"}}>{hoResponse.signature}</span>
              </div>
            )}
            <div style={{fontSize:10,fontWeight:500,color:"#94a3b8",letterSpacing:"0.08em",marginBottom:8}}>
              ON GENERATOR · {(hoResponse.items||[]).filter(i=>i.included).length}
            </div>
            {(hoResponse.items||[]).filter(i=>i.included).map((it,i)=>(
              <div key={it.id||i} style={{background:"#f8fafc",border:"0.5px solid #e2e8f0",borderRadius:8,padding:"9px 12px",marginBottom:5}}>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <div style={{width:20,height:20,borderRadius:"50%",background:"#fef3c7",border:"0.5px solid #fde68a",
                    display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:500,color:"#b45309",flexShrink:0}}>
                    {it.priority||i+1}
                  </div>
                  <div style={{flex:1}}>
                    <div style={{fontSize:13,fontWeight:500,color:"#1e293b"}}>{it.name||"Unnamed"}</div>
                    <div style={{fontSize:11,color:"#94a3b8",display:"flex",gap:6}}>
                      {it.panel&&<span>{it.panel}</span>}
                      {it.wire&&<span>{it.wire}</span>}
                      {it.wire&&HO_WIRE_AMPS[it.wire]&&<span style={{color:"#b45309",fontWeight:500}}>{HO_WIRE_AMPS[it.wire]}A</span>}
                    </div>
                    {it.notes&&<div style={{fontSize:11,color:"#64748b",marginTop:2}}>"{it.notes}"</div>}
                  </div>
                </div>
              </div>
            ))}
            {(hoResponse.items||[]).filter(i=>!i.included).length>0&&(
              <>
                <div style={{fontSize:10,fontWeight:500,color:"#cbd5e1",letterSpacing:"0.08em",margin:"12px 0 8px"}}>
                  NOT ON GENERATOR · {(hoResponse.items||[]).filter(i=>!i.included).length}
                </div>
                {(hoResponse.items||[]).filter(i=>!i.included).map((it,i)=>(
                  <div key={it.id||i} style={{border:"0.5px solid #f1f5f9",borderRadius:8,padding:"8px 12px",marginBottom:4,opacity:0.55}}>
                    <div style={{fontSize:12,color:"#94a3b8"}}>{it.name||"Unnamed"}</div>
                    <div style={{fontSize:11,color:"#cbd5e1",display:"flex",gap:6}}>
                      {it.panel&&<span>{it.panel}</span>}
                      {it.wire&&<span>{it.wire}</span>}
                      {it.wire&&HO_WIRE_AMPS[it.wire]&&<span>{HO_WIRE_AMPS[it.wire]}A</span>}
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      )}
      {total > 0 && (
        <div style={{marginBottom:20,padding:"14px 16px",background:C.surface,border:`1px solid ${C.border}`,borderRadius:12}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
            <span style={{fontSize:12,fontWeight:700,color:C.text}}>Home Runs Pulled</span>
            <span style={{fontSize:13,fontWeight:700,color:pct===100?C.green:C.blue}}>{pulled} / {total} — {pct}%</span>
          </div>
          <div style={{height:8,background:C.border,borderRadius:99,overflow:"hidden"}}>
            <div style={{height:"100%",width:`${pct}%`,background:pct===100?C.green:C.blue,borderRadius:99,transition:"width 0.4s ease"}}/>
          </div>
        </div>
      )}
      {(()=>{
        const cPanels = homeRuns.customPanels || DEFAULT_PANELS;
        const addPanel = () => {
          const n = newPanelName.trim();
          if(!n || cPanels.includes(n)) return;
          onHRChange({...homeRuns, customPanels:[...cPanels, n]});
          setNewPanelName("");
        };
        const removePanel = (p) => { onHRChange({...homeRuns, customPanels: cPanels.filter(x=>x!==p)}); };
        const resetPanels = () => onHRChange({...homeRuns, customPanels: DEFAULT_PANELS});
        return (
          <Section label="Panels" color={C.blue} defaultOpen={false}>
            <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:10}}>
              {cPanels.map(p=>(
                <div key={p} style={{display:"flex",alignItems:"center",gap:4,
                  background:`${C.blue}15`,border:`1px solid ${C.blue}44`,
                  borderRadius:20,padding:"4px 10px 4px 12px",fontSize:12,color:C.blue,fontWeight:600}}>
                  {p}
                  <button onClick={()=>removePanel(p)}
                    style={{background:"none",border:"none",cursor:"pointer",color:C.dim,fontSize:14,lineHeight:1,padding:"0 2px",fontWeight:700}}>×</button>
                </div>
              ))}
            </div>
            <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
              <input value={newPanelName} onChange={e=>setNewPanelName(e.target.value)}
                onKeyDown={e=>e.key==="Enter"&&addPanel()}
                placeholder="e.g. Panel E, Sub Panel, Shed Panel…"
                style={{flex:1,minWidth:180,background:C.surface,border:`1px solid ${C.border}`,
                  borderRadius:7,padding:"7px 10px",fontSize:12,fontFamily:"inherit",outline:"none",color:C.text}}/>
              <button onClick={addPanel}
                style={{background:C.blue,color:"#fff",border:"none",borderRadius:7,
                  padding:"7px 14px",fontSize:12,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap"}}>
                + Add Panel
              </button>
              <button onClick={resetPanels}
                style={{background:"none",border:`1px solid ${C.border}`,borderRadius:7,
                  padding:"7px 12px",fontSize:11,color:C.dim,cursor:"pointer",whiteSpace:"nowrap"}}>
                Reset to defaults
              </button>
            </div>
            <div style={{fontSize:11,color:C.muted,marginTop:8}}>
              "Meter" and "Dedicated Loads" are always available. Add as many panels as needed.
            </div>
          </Section>
        );
      })()}
      <Section label="Home Runs" color={C.blue} defaultOpen={true}>
        {(()=>{ const cp = homeRuns.customPanels||DEFAULT_PANELS; return (
          <>
            {[["main","Main Level Loads"],["basement","Basement Level Loads"],["upper","Upper Level Loads"]].map(([k,l])=>(
              <HomeRunLevel key={k} label={l} rows={homeRuns[k]||[]} customPanels={cp} onChange={v=>onHRChange({...homeRuns,[k]:v})}/>
            ))}
            {(homeRuns.extraFloors||[]).map((ef)=>(
              <div key={ef.key} style={{position:"relative"}}>
                <HomeRunLevel label={ef.label} rows={homeRuns[ef.key]||[]} customPanels={cp}
                  onChange={v=>onHRChange({...homeRuns,[ef.key]:v})}/>
                <button onClick={()=>{
                    const newExtras=(homeRuns.extraFloors||[]).filter(e=>e.key!==ef.key);
                    const updated={...homeRuns,extraFloors:newExtras};
                    delete updated[ef.key];
                    onHRChange(updated);
                  }}
                  style={{position:"absolute",top:0,right:0,background:"none",border:"none",
                    color:C.muted,cursor:"pointer",fontSize:11,padding:"2px 6px",fontFamily:"inherit"}}>
                  Remove
                </button>
              </div>
            ))}
            <HRAddFloor homeRuns={homeRuns} onHRChange={onHRChange}/>
          </>
        ); })()}
      </Section>
      <Section label="Load Mapping Notes" color={C.blue}>
        <TA value={homeRuns.loadMappingNotes||""} onChange={e=>onHRChange({...homeRuns,loadMappingNotes:e.target.value})} placeholder="Load mapping notes…" rows={5}/>
      </Section>
      <Section label="Panel Breaker Counts" color={C.blue}>
        <BreakerCounts homeRuns={homeRuns} panelCounts={panelCounts} onCountChange={onCountChange}/>
      </Section>
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
        <div key={r.id} style={{display:"grid",gridTemplateColumns:"36px 1fr 90px 90px 28px",gap:6,marginBottom:4,alignItems:"center"}}>
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
  const del = (id) => onChange(lights.filter(l=>l.id!==id));
  return (
    <div>
      <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:10,padding:12,marginBottom:16,fontSize:11,color:C.dim,lineHeight:1.8}}>
        <div style={{color:C.teal,fontWeight:700,marginBottom:4,fontSize:12}}>GM Tape Lighting Specs</div>
        <div>Driver Sizing: <span style={{color:C.text}}>1.5W per foot of GM tape light</span></div>
        <div>Routered / visible → <span style={{color:C.text}}>order track w/ flange</span></div>
        <div>Behind cabinet lip → <span style={{color:C.text}}>order standard GM track</span></div>
        <div style={{marginTop:4,color:C.dim,fontWeight:600}}>Driver Sizes: 20W · 40W · 60W · 96W · 192W · 288W</div>
      </div>
      {lights.map((l,i)=>(
        <div key={l.id} style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:10,padding:14,marginBottom:12}}>
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:10}}>
            <span style={{fontSize:12,color:C.teal,fontWeight:700}}>Tape Light #{i+1}</span>
            <button onClick={()=>del(l.id)} style={{background:"none",border:"none",color:C.muted,cursor:"pointer",fontSize:11}}>Remove</button>
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

// ── Plans & Links ────────────────────────────────────────────
const LINK_FIELDS = [
  ["planLink","Plans"],
  ["lightingLink","Lighting Schedules"],
  ["panelLink","Panel Schedules"],
  ["matterportLink","Matterport Link"],
];

function PlansTab({job, onUpdate}) {
  return (
    <div>
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
            {links.length===0&&(<div style={{fontSize:11,color:C.muted,fontStyle:"italic"}}>No links yet</div>)}
            {links.map((lnk,i)=>(
              <div key={lnk.id} style={{marginBottom:8}}>
                <div style={{display:"flex",gap:6,alignItems:"center"}}>
                  {lnk.url ? (
                    <a href={lnk.url} target="_blank" rel="noreferrer"
                      style={{flex:1,background:C.blue+"11",border:`1px solid ${C.blue}33`,borderRadius:7,
                        color:C.blue,padding:"7px 12px",fontSize:12,fontWeight:600,
                        textDecoration:"none",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
                      {lnk.label||"Open ↗"}
                    </a>
                  ) : (
                    <Inp value={lnk.url||""} placeholder="Paste URL…" style={{flex:1}}
                      onChange={e=>setLinks(links.map((x,j)=>j===i?{...x,url:e.target.value}:x))}/>
                  )}
                  <button onClick={()=>setLinks(links.map((x,j)=>j===i?{...x,url:""}:x))} title="Edit URL"
                    style={{background:"none",border:`1px solid ${C.border}`,borderRadius:6,
                      color:C.dim,cursor:"pointer",fontSize:11,padding:"4px 8px",flexShrink:0}}>✎</button>
                  <Inp value={lnk.label||""} placeholder="Label…" style={{width:100,flexShrink:0}}
                    onChange={e=>setLinks(links.map((x,j)=>j===i?{...x,label:e.target.value}:x))}/>
                  <button onClick={()=>setLinks(links.filter((_,j)=>j!==i))}
                    style={{background:"none",border:"none",color:C.muted,cursor:"pointer",fontSize:13,flexShrink:0}}>✕</button>
                </div>
              </div>
            ))}
          </div>
        );
      })}
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
                <div style={{display:"flex",gap:6,alignItems:"center"}}>
                  {lnk.url ? (
                    <a href={lnk.url} target="_blank" rel="noreferrer"
                      style={{flex:1,background:C.blue+"11",border:`1px solid ${C.blue}33`,borderRadius:7,
                        color:C.blue,padding:"7px 12px",fontSize:12,fontWeight:600,
                        textDecoration:"none",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
                      {lnk.label||"Open ↗"}
                    </a>
                  ) : (
                    <Inp value={lnk.url||""} placeholder="Paste URL…" style={{flex:1}}
                      onChange={e=>onUpdate({customLinks:(job.customLinks||[]).map(x=>x.id===cl.id?{...x,urls:(x.urls||[]).map((u,j)=>j===i?{...u,url:e.target.value}:u)}:x)})}/> 
                  )}
                  <button onClick={()=>onUpdate({customLinks:(job.customLinks||[]).map(x=>x.id===cl.id?{...x,urls:(x.urls||[]).map((u,j)=>j===i?{...u,url:""}:u)}:x)})} title="Edit URL"
                    style={{background:"none",border:`1px solid ${C.border}`,borderRadius:6,
                      color:C.dim,cursor:"pointer",fontSize:11,padding:"4px 8px",flexShrink:0}}>✎</button>
                  <Inp value={lnk.label||""} placeholder="Label…" style={{width:100,flexShrink:0}}
                    onChange={e=>onUpdate({customLinks:(job.customLinks||[]).map(x=>x.id===cl.id?{...x,urls:(x.urls||[]).map((u,j)=>j===i?{...u,label:e.target.value}:u)}:x)})}/> 
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
              "Change Orders","Return Trips","Plans & Links","QC"];

const sanitize = (obj) => {
  if(Array.isArray(obj)) return obj.map(sanitize);
  if(obj && typeof obj === "object") return Object.fromEntries(Object.entries(obj).filter(([,v])=>v!==undefined).map(([k,v])=>[k,sanitize(v)]));
  return obj;
};

const normalizeJob = (raw) => ({
  changeOrders:[], returnTrips:[], uploadedFiles:[], customLinks:[],
  roughMaterials:[], roughUpdates:[], finishMaterials:[], finishUpdates:[],
  homeRuns:{}, roughPunch:{}, finishPunch:{}, qcPunch:{},
  roughQuestions:{upper:[],main:[],basement:[]},
  finishQuestions:{upper:[],main:[],basement:[]},
  ...raw,
  changeOrders: raw?.changeOrders || [],
  returnTrips:  raw?.returnTrips  || [],
  uploadedFiles:raw?.uploadedFiles|| [],
  customLinks:  raw?.customLinks  || [],
  roughMaterials: raw?.roughMaterials || [],
  roughUpdates:   raw?.roughUpdates   || [],
  finishMaterials:raw?.finishMaterials|| [],
  finishUpdates:  raw?.finishUpdates  || [],
  roughPunch:  raw?.roughPunch  || {},
  finishPunch: raw?.finishPunch || {},
  homeRuns:    raw?.homeRuns    || {},
  roughQuestions: raw?.roughQuestions || {upper:[],main:[],basement:[]},
  finishQuestions:raw?.finishQuestions|| {upper:[],main:[],basement:[]},
  roughStatus:     raw?.roughStatus     || (()=>{ const p=parseInt(raw?.roughStage)||0;  return p===100?"complete":p>0?"inprogress":""; })(),
  finishStatus:    raw?.finishStatus    || (()=>{ const p=parseInt(raw?.finishStage)||0; return p===100?"complete":p>0?"inprogress":""; })(),
  roughStatusDate:      raw?.roughStatusDate      || "",
  roughProjectedStart:  raw?.roughProjectedStart  || "",
  finishStatusDate:     raw?.finishStatusDate     || "",
  finishProjectedStart: raw?.finishProjectedStart || "",
  qcStatusDate:         raw?.qcStatusDate         || "",
});

function JobDetail({job: rawJob, onUpdate, onClose}) {
  const [job, setJob] = useState(()=>normalizeJob(rawJob));
  const jobRef = useRef(job);
  useEffect(()=>{ jobRef.current = job; }, [job]);
  const u = patch => {
    const updated = {...jobRef.current, ...patch};
    jobRef.current = updated;
    setJob(updated);
    onUpdate(updated);
  };
  const [tab, setTab] = useState("Job Info");
  const [newLightingFloor, setNewLightingFloor] = useState("");
  const [emailData, setEmailData] = useState(null);
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
    const extraCount = (p.extras||[]).reduce((s,e)=>s+countFloor(p[e.key]||{}),0);
    return total + countFloor(p.upper) + countFloor(p.main) + countFloor(p.basement) + extraCount;
  },0);
  const pendingCOs = (job.changeOrders||[]).filter(c=>c.status!=="Work Completed"&&c.status!=="Denied").length;
  const qcCount = countFloor(job.qcPunch?.upper||{}) + countFloor(job.qcPunch?.main||{}) + countFloor(job.qcPunch?.basement||{}) +
    (job.qcPunch?.extras||[]).reduce((s,e)=>s+countFloor(job.qcPunch?.[e.key]||{}),0);

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.82)",zIndex:200,
      display:"flex",alignItems:"center",justifyContent:"center",padding:12}}
      onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
      <div onClick={e=>e.stopPropagation()} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:18,width:"100%",
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
            {pendingCOs>0 &&<Pill label={`${pendingCOs} CO pending`} color={C.orange}/>}
            {(job.returnTrips||[]).filter(r=>!r.signedOff).length>0&&
              <Pill label={`${(job.returnTrips||[]).filter(r=>!r.signedOff).length} return trip${(job.returnTrips||[]).filter(r=>!r.signedOff).length>1?"s":""} pending`} color={C.red}/>}
            {qcCount>0&&<Pill label={`${qcCount} QC item${qcCount!==1?"s":""}`} color={C.red}/>}
            <button onClick={refreshJob} title="Refresh"
              style={{background:"none",border:`1px solid ${C.border}`,borderRadius:8,
                color:C.dim,cursor:"pointer",padding:"5px 10px",fontSize:16,opacity:refreshing?0.4:1}} disabled={refreshing}>
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
              <Section label="Rough Stage" color={C.rough} defaultOpen={true}>
                {(()=>{
                  const rsDef = getStatusDef(ROUGH_STATUSES, job.roughStatus);
                  return (
                    <div style={{marginBottom:12}}>
                      <div style={{display:"flex",gap:16,marginBottom:12,flexWrap:"wrap"}}>
                        <div style={{flex:1,minWidth:140}}>
                          <div style={{fontSize:10,color:C.dim,fontWeight:700,letterSpacing:"0.08em",marginBottom:5}}>PROJECTED START</div>
                          <Inp value={job.roughProjectedStart||""} onChange={e=>u({roughProjectedStart:e.target.value})}
                            placeholder="MM/DD/YY"
                            style={{fontSize:13,fontWeight:700,borderColor:C.rough+"55",background:`${C.rough}08`,color:C.rough}}/>
                        </div>
                      </div>
                      <div style={{fontSize:10,color:C.dim,fontWeight:700,letterSpacing:"0.08em",marginBottom:6}}>STATUS</div>
                      <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                        <select value={job.roughStatus||""} onChange={e=>{
                          const v=e.target.value;
                          const def=getStatusDef(ROUGH_STATUSES,v);
                          u({roughStatus:v, roughOnHold:v==="waiting", roughScheduled:v==="scheduled",
                            roughStatusDate:def.hasDate?job.roughStatusDate:"",
                            readyToInvoice:v==="invoice"?true:(job.roughStatus==="invoice"?false:job.readyToInvoice)});
                        }} style={{background:rsDef.color?`${rsDef.color}18`:C.surface,
                          color:rsDef.color||C.dim, border:`1px solid ${rsDef.color||C.border}`,
                          borderRadius:7,padding:"7px 10px",fontSize:12,fontFamily:"inherit",
                          fontWeight:rsDef.color?700:400,outline:"none",cursor:"pointer"}}>
                          {ROUGH_STATUSES.map(s=><option key={s.value} value={s.value}>{s.label}</option>)}
                        </select>
                        {rsDef.hasDate&&(
                          <Inp value={job.roughStatusDate||""} onChange={e=>u({roughStatusDate:e.target.value})}
                            placeholder="Date MM/DD/YY"
                            style={{width:130,fontSize:12,borderColor:rsDef.color+"55",background:`${rsDef.color}08`}}/>
                        )}
                      </div>
                    </div>
                  );
                })()}
                <Sel value={job.roughStage} onChange={e=>{const v=e.target.value;const pct=parseInt(v)||0;u({roughStage:v,...(v==="100%"?{roughStatus:"complete"}:pct>0?{roughStatus:"inprogress"}:{})});}} options={ROUGH_STAGES}/>
                <div style={{marginTop:8,marginBottom:20}}><StageBar stages={ROUGH_STAGES} current={job.roughStage} color={C.rough}/></div>
              </Section>
              <Section label="Punch List" color={C.rough}>
                <PunchSection punch={job.roughPunch} onChange={v=>u({roughPunch:v})}
                  jobName={job.name||"This Job"} phase="Rough" onEmail={setEmailData}/>
              </Section>
              <Section label="Material Tracking" color={C.rough}>
                <MaterialOrders orders={job.roughMaterials} onChange={v=>u({roughMaterials:v})}/>
              </Section>
              <Section label="Daily Job Updates" color={C.rough}>
                <DailyUpdates updates={job.roughUpdates} onChange={v=>u({roughUpdates:v})}
                  jobName={job.name||"This Job"} onEmail={setEmailData}/>
              </Section>
              <div style={{marginTop:20}}>
                <Section label="Questions" color={C.rough}>
                  <QASection questions={job.roughQuestions||{upper:[],main:[],basement:[]}} onChange={v=>u({roughQuestions:v})} color={C.rough}/>
                </Section>
              </div>
              <div style={{marginTop:20}}>
                <Section label="Rough Notes" color={C.rough}>
                  <TA value={job.roughNotes} onChange={e=>u({roughNotes:e.target.value})} placeholder="Document any changes from plans, conversations with GC, homeowner, or designer…" rows={5}/>
                </Section>
              </div>
            </div>
          )}

          {tab==="Finish"&&(
            <div>
              <Section label="Finish Stage" color={C.finish} defaultOpen={true}>
                {(()=>{
                  const fsDef = getStatusDef(FINISH_STATUSES, job.finishStatus);
                  return (
                    <div style={{marginBottom:12}}>
                      <div style={{display:"flex",gap:16,marginBottom:12,flexWrap:"wrap"}}>
                        <div style={{flex:1,minWidth:140}}>
                          <div style={{fontSize:10,color:C.dim,fontWeight:700,letterSpacing:"0.08em",marginBottom:5}}>PROJECTED START</div>
                          <Inp value={job.finishProjectedStart||""} onChange={e=>u({finishProjectedStart:e.target.value})}
                            placeholder="MM/DD/YY"
                            style={{fontSize:13,fontWeight:700,borderColor:C.finish+"55",background:`${C.finish}08`,color:C.finish}}/>
                        </div>
                      </div>
                      <div style={{fontSize:10,color:C.dim,fontWeight:700,letterSpacing:"0.08em",marginBottom:6}}>STATUS</div>
                      <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                        <select value={job.finishStatus||""} onChange={e=>{
                          const v=e.target.value;
                          const def=getStatusDef(FINISH_STATUSES,v);
                          u({finishStatus:v, finishOnHold:v==="waiting", finishScheduled:v==="scheduled",
                            finishStatusDate:def.hasDate?job.finishStatusDate:"",
                            readyToInvoice:v==="invoice"?true:(job.finishStatus==="invoice"?false:job.readyToInvoice)});
                        }} style={{background:fsDef.color?`${fsDef.color}18`:C.surface,
                          color:fsDef.color||C.dim, border:`1px solid ${fsDef.color||C.border}`,
                          borderRadius:7,padding:"7px 10px",fontSize:12,fontFamily:"inherit",
                          fontWeight:fsDef.color?700:400,outline:"none",cursor:"pointer"}}>
                          {FINISH_STATUSES.map(s=><option key={s.value} value={s.value}>{s.label}</option>)}
                        </select>
                        {fsDef.hasDate&&(
                          <Inp value={job.finishStatusDate||""} onChange={e=>u({finishStatusDate:e.target.value})}
                            placeholder="Date MM/DD/YY"
                            style={{width:130,fontSize:12,borderColor:fsDef.color+"55",background:`${fsDef.color}08`}}/>
                        )}
                      </div>
                    </div>
                  );
                })()}
                <Sel value={job.finishStage} onChange={e=>{const v=e.target.value;const pct=parseInt(v)||0;u({finishStage:v,...(v==="100%"?{finishStatus:"complete"}:pct>0?{finishStatus:"inprogress"}:{})});}} options={FINISH_STAGES}/>
                <div style={{marginTop:8,marginBottom:20}}><StageBar stages={FINISH_STAGES} current={job.finishStage} color={C.finish}/></div>
              </Section>
              <Section label="Punch List" color={C.finish}>
                <PunchSection punch={job.finishPunch} onChange={v=>u({finishPunch:v})} jobName={job.name||"This Job"} phase="Finish" onEmail={setEmailData}/>
              </Section>
              <div style={{marginTop:20}}>
                <Section label="Finish Material Tracking" color={C.finish}>
                  <MaterialOrders orders={job.finishMaterials} onChange={v=>u({finishMaterials:v})}/>
                </Section>
              </div>
              <div style={{marginTop:20}}>
                <Section label="Finish Daily Job Updates" color={C.finish}>
                  <DailyUpdates updates={job.finishUpdates} onChange={v=>u({finishUpdates:v})} jobName={job.name||"This Job"} onEmail={setEmailData}/>
                </Section>
              </div>
              <div style={{marginTop:20}}>
                <Section label="Questions" color={C.finish}>
                  <QASection questions={job.finishQuestions||{upper:[],main:[],basement:[]}} onChange={v=>u({finishQuestions:v})} color={C.finish}/>
                </Section>
              </div>
              <div style={{marginTop:20}}>
                <Section label="Finish Notes" color={C.finish}>
                  <TA value={job.finishNotes} onChange={e=>u({finishNotes:e.target.value})} placeholder="Document any changes from plans…" rows={5}/>
                </Section>
              </div>
            </div>
          )}

          {tab==="Home Runs"&&(
            <HomeRunsTab homeRuns={job.homeRuns} panelCounts={job.panelCounts} jobId={job.id} jobName={job.name}
              onHRChange={v=>u({homeRuns:v})} onCountChange={v=>u({panelCounts:v})}/>
          )}

          {tab==="Panelized Lighting"&&(
            <div>
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
              <KeypadSection label="Main Level Keypad Loads" loads={job.panelizedLighting.mainKeypad}
                onChange={v=>u({panelizedLighting:{...job.panelizedLighting,mainKeypad:v}})}/>
              <KeypadSection label="Basement Keypad Loads" loads={job.panelizedLighting.basementKeypad}
                onChange={v=>u({panelizedLighting:{...job.panelizedLighting,basementKeypad:v}})}/>
              <KeypadSection label="Upper Level Keypad Loads" loads={job.panelizedLighting.upperKeypad}
                onChange={v=>u({panelizedLighting:{...job.panelizedLighting,upperKeypad:v}})}/>
              {(job.panelizedLighting.extraFloors||[]).map(ef=>(
                <KeypadSection key={ef.key} label={`${ef.label} Keypad Loads`}
                  loads={(job.panelizedLighting[ef.key+"_keypad"])||[]}
                  onChange={v=>u({panelizedLighting:{...job.panelizedLighting,[ef.key+"_keypad"]:v}})}/>
              ))}
              <SectionHead label={`${job.lightingSystem||"Control 4"} Panel Loads`} color={C.purple}/>
              {["upper","main","basement"].map(floor=>(
                <div key={floor} style={{marginBottom:16}}>
                  <div style={{fontSize:11,color:C.dim,fontWeight:700,letterSpacing:"0.08em",
                    textTransform:"uppercase",marginBottom:8,paddingBottom:4,borderBottom:`1px solid ${C.border}`}}>{floor}</div>
                  <CP4LoadsSection
                    loads={(job.panelizedLighting.cp4Loads?.[floor])||[]}
                    onChange={v=>u({panelizedLighting:{...job.panelizedLighting,
                      cp4Loads:{...(job.panelizedLighting.cp4Loads||{}), [floor]:v}}})}/>
                </div>
              ))}
              {(job.panelizedLighting.extraFloors||[]).map(ef=>(
                <div key={ef.key} style={{marginBottom:16}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",
                    marginBottom:8,paddingBottom:4,borderBottom:`1px solid ${C.border}`}}>
                    <div style={{fontSize:11,color:C.purple,fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase"}}>{ef.label}</div>
                    <button onClick={()=>{
                      const newExtras=(job.panelizedLighting.extraFloors||[]).filter(e=>e.key!==ef.key);
                      const updated={...job.panelizedLighting,extraFloors:newExtras};
                      delete updated[ef.key+"_keypad"];
                      u({panelizedLighting:updated});
                    }} style={{background:"none",border:"none",color:C.muted,cursor:"pointer",fontSize:11}}>Remove</button>
                  </div>
                  <CP4LoadsSection loads={(job.panelizedLighting[ef.key])||[]}
                    onChange={v=>u({panelizedLighting:{...job.panelizedLighting,[ef.key]:v}})}/>
                </div>
              ))}
              {(()=>{
                const addFloor = () => {
                  const label = newLightingFloor.trim();
                  if(!label) return;
                  const key = "pl_"+label.toLowerCase().replace(/[^a-z0-9]/g,"_")+"_"+Date.now();
                  const newExtras=[...(job.panelizedLighting.extraFloors||[]),{key,label}];
                  u({panelizedLighting:{...job.panelizedLighting,extraFloors:newExtras,[key]:[],[key+"_keypad"]:[]}});
                  setNewLightingFloor("");
                };
                return (
                  <div style={{display:"flex",gap:8,alignItems:"center",marginTop:8,flexWrap:"wrap"}}>
                    <input value={newLightingFloor} onChange={e=>setNewLightingFloor(e.target.value)}
                      onKeyDown={e=>e.key==="Enter"&&addFloor()} placeholder="Add floor / area…"
                      style={{flex:1,minWidth:160,background:C.surface,border:`1px solid ${C.border}`,
                        borderRadius:7,padding:"7px 10px",fontSize:12,fontFamily:"inherit",outline:"none",color:C.text}}/>
                    <button onClick={addFloor}
                      style={{background:C.purple,color:"#fff",border:"none",borderRadius:7,
                        padding:"7px 14px",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit",whiteSpace:"nowrap"}}>
                      + Add Floor / Area
                    </button>
                  </div>
                );
              })()}
            </div>
          )}

          {tab==="Tape Light"&&(
            <div>
              <Section label="Tape Light Locations" color={C.teal} defaultOpen={true}>
                <TapeLightSection lights={job.tapeLights||[]} onChange={v=>u({tapeLights:v})}/>
              </Section>
            </div>
          )}

          {tab==="Change Orders"&&(
            <div>
              <Section label="Change Order Log" color={C.accent} defaultOpen={true}>
                <ChangeOrders orders={job.changeOrders} onChange={v=>u({changeOrders:v})} jobName={job.name||"This Job"} onEmail={setEmailData}/>
              </Section>
            </div>
          )}

          {tab==="Return Trips"&&(
            <div>
              <Section label="Return Trips" color={C.purple} defaultOpen={true}>
                <ReturnTrips trips={job.returnTrips} onChange={v=>u({returnTrips:v})} jobName={job.name||"This Job"} onEmail={setEmailData}/>
              </Section>
            </div>
          )}

          {tab==="Plans & Links"&&(<PlansTab job={job} onUpdate={u}/>)}

          {tab==="QC"&&(
            <div>
              {(()=>{
                const qcDef = getStatusDef(QC_STATUSES, job.qcStatus||"");
                return (
                  <div style={{marginBottom:16,padding:"12px 14px",background:C.surface,border:`1px solid ${C.border}`,borderRadius:9}}>
                    <div style={{fontSize:10,color:C.dim,fontWeight:700,letterSpacing:"0.08em",marginBottom:8}}>QC STATUS</div>
                    <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                      <select value={job.qcStatus||""} onChange={e=>{
                        const v=e.target.value;
                        u({qcStatus:v,qcStatusDate:getStatusDef(QC_STATUSES,v).hasDate?job.qcStatusDate:""});
                      }} style={{background:qcDef.color?`${qcDef.color}18`:C.surface,
                        color:qcDef.color||C.dim,border:`1px solid ${qcDef.color||C.border}`,
                        borderRadius:7,padding:"7px 10px",fontSize:12,fontFamily:"inherit",
                        fontWeight:qcDef.color?700:400,outline:"none",cursor:"pointer"}}>
                        {QC_STATUSES.map(s=><option key={s.value} value={s.value}>{s.label}</option>)}
                      </select>
                      {qcDef.hasDate&&(
                        <Inp value={job.qcStatusDate||""} onChange={e=>u({qcStatusDate:e.target.value})}
                          placeholder="Date MM/DD/YY"
                          style={{width:130,fontSize:12,borderColor:qcDef.color+"55",background:`${qcDef.color}08`}}/>
                      )}
                    </div>
                  </div>
                );
              })()}
              <Section label="QC Walk Checklist" color={C.teal} defaultOpen={true}>
                <PunchSection punch={job.qcPunch} onChange={v=>u({qcPunch:v})} jobName={job.name||"Job"} phase="QC" onEmail={({subject,body})=>{ openEmail("", subject, body); }}/>
              </Section>
            </div>
          )}

          {tab==="Job Info"&&(
            <div>
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
              <div style={{marginTop:16}}>
                <div style={{fontSize:10,color:C.dim,fontWeight:700,letterSpacing:"0.1em",marginBottom:8}}>PRE JOB PREP STAGE</div>
                <select value={job.prepStage||""} onChange={e=>u({prepStage:e.target.value,...(e.target.value===PREP_STAGE_ALERT?{readyToSchedule:false}:{})})}
                  style={{background:job.prepStage===PREP_STAGE_ALERT?"#fef2f2":C.surface,
                    color:job.prepStage===PREP_STAGE_ALERT?"#dc2626":job.prepStage?C.text:C.dim,
                    border:`1px solid ${job.prepStage===PREP_STAGE_ALERT?"#dc2626":C.border}`,
                    borderRadius:7,padding:"7px 10px",fontSize:12,fontFamily:"inherit",
                    fontWeight:job.prepStage===PREP_STAGE_ALERT?700:400,
                    outline:"none",width:"100%",cursor:"pointer"}}>
                  <option value="">— select stage —</option>
                  {PREP_STAGES.map(s=>(
                    <option key={s} value={s}
                      style={{color:s===PREP_STAGE_ALERT?"#dc2626":"inherit",fontWeight:s===PREP_STAGE_ALERT?700:400}}>
                      {s===PREP_STAGE_ALERT?"⚠ "+s:s}
                    </option>
                  ))}
                </select>
                {job.prepStage&&(
                  <div style={{marginTop:10,display:"flex",gap:6,alignItems:"flex-start",flexWrap:"wrap"}}>
                    {PREP_STAGES.map((s,i)=>(
                      <div key={s} style={{display:"flex",alignItems:"center",gap:4}}>
                        <div style={{width:10,height:10,borderRadius:"50%",flexShrink:0,
                          background:s===PREP_STAGE_ALERT&&job.prepStage===s?"#dc2626":PREP_STAGES.indexOf(job.prepStage)>=i?C.teal:C.border}}/>
                        <span style={{fontSize:10,
                          color:s===PREP_STAGE_ALERT&&job.prepStage===s?"#dc2626":PREP_STAGES.indexOf(job.prepStage)>=i?C.teal:C.dim,
                          fontWeight:PREP_STAGES.indexOf(job.prepStage)===i?700:400}}>{s===PREP_STAGE_ALERT?"⚠ "+s:s}</span>
                        {i<PREP_STAGES.length-1&&<span style={{color:C.border,fontSize:10}}>›</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:10,marginTop:16}}>
                <label style={{display:"flex",alignItems:"center",gap:10,cursor:"pointer"}}>
                  <input type="checkbox" checked={!!job.jobAccount} onChange={e=>u({jobAccount:e.target.checked})}
                    style={{accentColor:C.teal,width:16,height:16}}/>
                  <span style={{fontSize:13,color:C.text}}>Job account created</span>
                </label>
                <label style={{display:"flex",alignItems:"center",gap:10,cursor:"pointer"}}>
                  <input type="checkbox" checked={!!job.preLien} onChange={e=>u({preLien:e.target.checked})}
                    style={{accentColor:C.teal,width:16,height:16}}/>
                  <span style={{fontSize:13,color:C.text}}>Pre-lien filed</span>
                </label>
                <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
                  <label style={{display:"flex",alignItems:"center",gap:10,cursor:"pointer"}}>
                    <input type="checkbox" checked={!!job.tempPed} onChange={e=>u({tempPed:e.target.checked,tempPedNumber:e.target.checked?job.tempPedNumber:""})}
                      style={{accentColor:C.blue,width:16,height:16}}/>
                    <span style={{fontSize:13,color:C.text}}>Temp pedestal installed</span>
                  </label>
                  {job.tempPed&&(
                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                      <span style={{fontSize:12,color:C.dim}}>Ped #</span>
                      <select value={job.tempPedNumber||""} onChange={e=>u({tempPedNumber:e.target.value})}
                        style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:7,
                          padding:"4px 10px",fontSize:12,fontFamily:"inherit",color:job.tempPedNumber?C.blue:C.dim,
                          fontWeight:job.tempPedNumber?700:400,outline:"none",cursor:"pointer"}}>
                        <option value="">— select —</option>
                        {Array.from({length:100},(_,i)=>String(i+1)).map(n=>(
                          <option key={n} value={n}>Ped #{n}</option>
                        ))}
                      </select>
                      {job.tempPedNumber&&(
                        <span style={{fontSize:12,color:C.blue,fontWeight:700}}>#{job.tempPedNumber}</span>
                      )}
                    </div>
                  )}
                </div>
              </div>
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

// ── QA Components ─────────────────────────────────────────────
function QAInlineEdit({ value, onChange, placeholder, done }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value);
  const commit = () => { if (text.trim()) onChange(text.trim()); setEditing(false); };
  if (editing) return (
    <input autoFocus value={text} onChange={e => setText(e.target.value)}
      onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
      style={{ flex: 1, fontSize: 12, background: '#1e2030', border: `1px solid #3b82f6`, borderRadius: 6,
        padding: '3px 7px', color: '#f1f5f9', fontFamily: 'inherit', outline: 'none' }} />
  );
  return (
    <span onClick={() => !done && setEditing(true)}
      style={{ flex: 1, fontSize: 12, color: done ? '#64748b' : '#f1f5f9',
        textDecoration: done ? 'line-through' : 'none',
        cursor: done ? 'default' : 'text', borderRadius: 4, padding: '2px 4px' }}>
      {value || <span style={{ color: '#475569', fontStyle: 'italic' }}>{placeholder}</span>}
    </span>
  );
}

function QAList({ items, onChange }) {
  const safeItems = Array.isArray(items) ? items : [];
  const [newQ, setNewQ] = useState('');
  const open = safeItems.filter(i => !i.answered);
  const answered = safeItems.filter(i => i.answered);
  const add = () => {
    if (!newQ.trim()) return;
    onChange([...safeItems, { id: uid(), question: newQ, answer: '', answered: false }]);
    setNewQ('');
  };
  const upd = (id, p) => onChange(safeItems.map(i => i.id === id ? { ...i, ...p } : i));
  const del = (id) => onChange(safeItems.filter(i => i.id !== id));
  const renderItem = (item) => (
    <div key={item.id} style={{ marginBottom: 10, background: item.answered ? 'rgba(22,163,74,0.06)' : 'rgba(239,68,68,0.06)',
      border: `1px solid ${item.answered ? 'rgba(22,163,74,0.3)' : 'rgba(239,68,68,0.3)'}`, borderRadius: 8, padding: '10px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: item.answered ? 0 : 6 }}>
        <input type="checkbox" checked={!!item.answered}
          onChange={() => upd(item.id, { answered: !item.answered })}
          style={{ accentColor: '#16a34a', width: 15, height: 15, cursor: 'pointer', flexShrink: 0 }} />
        <QAInlineEdit value={item.question} done={item.answered}
          onChange={v => upd(item.id, { question: v })} placeholder="Enter question…" />
        <button onClick={() => del(item.id)}
          style={{ background: 'none', border: 'none', color: '#475569', cursor: 'pointer', fontSize: 12 }}>✕</button>
      </div>
      {!item.answered && (
        <div style={{ paddingLeft: 23 }}>
          <textarea value={item.answer || ''} onChange={e => upd(item.id, { answer: e.target.value })}
            placeholder="Answer / resolution…" rows={2}
            style={{ width: '100%', background: '#0f1117', border: '1px solid #334155', borderRadius: 6,
              color: '#f1f5f9', padding: '6px 8px', fontSize: 11, fontFamily: 'inherit', resize: 'vertical', outline: 'none' }} />
        </div>
      )}
    </div>
  );
  return (
    <div>
      {open.map(renderItem)}
      {answered.length > 0 && (
        <details style={{ marginTop: 8 }}>
          <summary style={{ fontSize: 11, color: '#475569', cursor: 'pointer', marginBottom: 8 }}>
            {answered.length} answered
          </summary>
          {answered.map(renderItem)}
        </details>
      )}
      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
        <input value={newQ} onChange={e => setNewQ(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && add()} placeholder="Add question…"
          style={{ flex: 1, background: '#1e2030', border: '1px solid #334155', borderRadius: 7,
            color: '#f1f5f9', padding: '6px 10px', fontSize: 12, fontFamily: 'inherit', outline: 'none' }} />
        <button onClick={add}
          style={{ background: '#d97706', border: 'none', borderRadius: 7, color: '#000',
            fontWeight: 700, padding: '6px 14px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>+</button>
      </div>
    </div>
  );
}

function QASection({ questions, onChange, color }) {
  const safe = { upper: [], main: [], basement: [], ...(questions || {}) };
  const extras = safe.extras || [];
  const [newFloor, setNewFloor] = useState('');
  const [addingFloor, setAddingFloor] = useState(false);
  const addFloor = () => {
    const label = newFloor.trim();
    if (!label) return;
    const key = 'qa_' + label.toLowerCase().replace(/[^a-z0-9]/g, '_') + '_' + Date.now();
    onChange({ ...safe, extras: [...extras, { key, label }], [key]: [] });
    setNewFloor(''); setAddingFloor(false);
  };
  const removeFloor = (key) => {
    const updated = { ...safe, extras: extras.filter(e => e.key !== key) };
    delete updated[key];
    onChange(updated);
  };
  const FLOOR_COLORS = [color || C.blue, C.purple, C.teal, C.accent, C.green];
  return (
    <div>
      {[['upper', 'Upper Level'], ['main', 'Main Level'], ['basement', 'Basement']].map(([k, l], i) => (
        <div key={k} style={{ marginBottom: 14, border: `1px solid ${FLOOR_COLORS[i]}33`, borderRadius: 10, overflow: 'hidden' }}>
          <div style={{ padding: '10px 14px', background: `${FLOOR_COLORS[i]}10` }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: FLOOR_COLORS[i], marginBottom: 8 }}>{l}</div>
            <QAList items={safe[k]} onChange={v => onChange({ ...safe, [k]: v })} />
          </div>
        </div>
      ))}
      {extras.map((e, i) => (
        <div key={e.key} style={{ marginBottom: 14, border: `1px solid ${FLOOR_COLORS[(i + 3) % FLOOR_COLORS.length]}33`, borderRadius: 10, overflow: 'hidden' }}>
          <div style={{ padding: '10px 14px', background: `${FLOOR_COLORS[(i + 3) % FLOOR_COLORS.length]}10` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: FLOOR_COLORS[(i + 3) % FLOOR_COLORS.length] }}>{e.label}</div>
              <button onClick={() => removeFloor(e.key)}
                style={{ background: 'none', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 11 }}>Remove</button>
            </div>
            <QAList items={safe[e.key] || []} onChange={v => onChange({ ...safe, [e.key]: v })} />
          </div>
        </div>
      ))}
      {addingFloor ? (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
          <input value={newFloor} onChange={e => setNewFloor(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') addFloor(); if (e.key === 'Escape') setAddingFloor(false); }}
            placeholder="Floor / area name…" autoFocus
            style={{ flex: 1, border: `1px solid ${C.border}`, borderRadius: 7, padding: '6px 10px',
              fontSize: 12, fontFamily: 'inherit', color: C.text, background: C.surface, outline: 'none' }} />
          <Btn onClick={addFloor} variant="add" style={{ fontSize: 11, padding: '5px 12px' }}>Add</Btn>
          <button onClick={() => setAddingFloor(false)}
            style={{ background: 'none', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 13 }}>✕</button>
        </div>
      ) : (
        <Btn onClick={() => setAddingFloor(true)} variant="add" style={{ fontSize: 11, padding: '4px 12px', marginTop: 8 }}>
          + Add Floor / Area
        </Btn>
      )}
    </div>
  );
}

// ── Stage logic ────────────────────────────────────────────────
const effRS = j => {
  if (j.roughStatus) return j.roughStatus;
  const p = parseInt(j.roughStage) || 0;
  return p === 100 ? "complete" : p > 0 ? "inprogress" : "";
};
const effFS = j => {
  if (j.finishStatus) return j.finishStatus;
  const p = parseInt(j.finishStage) || 0;
  return p === 100 ? "complete" : p > 0 ? "inprogress" : "";
};

const STAGE_SECTIONS = [
  { key:"prep",         label:"Pre Job Prep",             color:"#8b5cf6", test: j => j.prepStage && effRS(j)==="" },
  { key:"roughNotStarted", label:"Rough Not Started",     color:"#64748b", test: j => !j.prepStage && effRS(j)==="" && effFS(j)==="" },
  { key:"roughHold",    label:"Rough On Hold",            color:"#f59e0b", test: j => effRS(j)==="waiting" },
  { key:"rough",        label:"Rough In Progress",        color:"#2563eb", test: j => ["ready","scheduled","inprogress"].includes(effRS(j)) && effRS(j)!=="waiting" },
  { key:"roughInvoice", label:"Rough — Ready to Invoice", color:"#ea580c", test: j => effRS(j)==="invoice" },
  { key:"between",      label:"Between Rough & Finish",   color:"#0d9488", test: j => effRS(j)==="complete" && effFS(j)==="" },
  { key:"finishHold",   label:"Finish On Hold",           color:"#f59e0b", test: j => effFS(j)==="waiting" },
  { key:"finish",       label:"Finish In Progress",       color:"#0ea5e9", test: j => ["ready","scheduled","inprogress"].includes(effFS(j)) && effFS(j)!=="waiting" },
  { key:"finishInvoice",label:"Finish — Ready to Invoice",color:"#ea580c", test: j => effFS(j)==="invoice" },
  { key:"complete",     label:"Complete",                 color:"#22c55e", test: j => effFS(j)==="complete" },
];

function StageSectionList({ jobs, onSelectJob, filterForeman }) {
  const [collapsed, setCollapsed] = useState({});
  const toggle = key => setCollapsed(c => ({ ...c, [key]: !c[key] }));
  const filtered = filterForeman ? jobs.filter(j => j.foreman === filterForeman) : jobs;

  return (
    <div>
      {STAGE_SECTIONS.map(sec => {
        const secJobs = filtered.filter(sec.test).sort((a, b) => {
          const activeDate = (j) => {
            const rs = effRS(j), fs = effFS(j);
            if (["ready","scheduled","inprogress","waiting"].includes(rs)) return j.roughProjectedStart || "";
            if (["ready","scheduled","inprogress","waiting"].includes(fs)) return j.finishProjectedStart || "";
            if (rs === "complete") return j.finishProjectedStart || "";
            return j.roughProjectedStart || j.finishProjectedStart || "";
          };
          const da = activeDate(a);
          const db = activeDate(b);
          return da.localeCompare(db);
        });
        if (secJobs.length === 0) return null;
        const isCollapsed = collapsed[sec.key];
        return (
          <div key={sec.key} style={{ marginBottom: 12 }}>
            <div onClick={() => toggle(sec.key)}
              style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 14px",
                background: `${sec.color}14`, border: `1px solid ${sec.color}44`, borderRadius: 10,
                cursor: "pointer", userSelect: "none", marginBottom: isCollapsed ? 0 : 6 }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: sec.color, flexShrink: 0 }} />
              <span style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 16, letterSpacing: "0.06em", color: sec.color, flex: 1 }}>
                {sec.label}
              </span>
              <span style={{ fontSize: 11, background: `${sec.color}22`, color: sec.color,
                borderRadius: 99, padding: "2px 9px", fontWeight: 700 }}>{secJobs.length}</span>
              <span style={{ color: sec.color, fontSize: 12 }}>{isCollapsed ? "▸" : "▾"}</span>
            </div>
            {!isCollapsed && secJobs.map(j => (
              <JobRow key={j.id} job={j} onClick={() => onSelectJob(j)} sec={sec} />
            ))}
          </div>
        );
      })}
    </div>
  );
}

function JobRow({ job: j, onClick, sec }) {
  const rs = effRS(j), fs = effFS(j);
  const openPunch = (punch) => {
    if (!punch) return 0;
    const countFloor = f => {
      if (!f) return 0;
      if (Array.isArray(f)) return f.filter(i => !i.done).length;
      return (f.general || []).filter(i => !i.done).length +
        (f.rooms || []).reduce((a, r) => a + (Array.isArray(r.items) ? r.items.filter(i => !i.done).length : 0), 0);
    };
    return countFloor(punch.upper) + countFloor(punch.main) + countFloor(punch.basement) +
      (punch.extras || []).reduce((s, e) => s + countFloor(punch[e.key] || {}), 0);
  };
  const totalOpen = openPunch(j.roughPunch) + openPunch(j.finishPunch);
  const pendingCOs = (j.changeOrders || []).filter(c => c.coStatus !== "completed" && c.coStatus !== "denied").length;
  const pendingRTs = (j.returnTrips || []).filter(r => !r.signedOff).length;
  const foremanColor = FOREMEN_COLORS[j.foreman] || C.dim;
  const rsDef = getStatusDef(ROUGH_STATUSES, rs);
  const fsDef = getStatusDef(FINISH_STATUSES, fs);
  // Projected start date — show whichever phase is active
  const projDate = (["ready","scheduled","inprogress","waiting"].includes(rs) ? j.roughProjectedStart : null)
    || (["ready","scheduled","inprogress","waiting"].includes(fs) ? j.finishProjectedStart : null)
    || j.roughProjectedStart || j.finishProjectedStart || "";
  // Left accent border color based on status
  const accentColor = j.flagged ? C.red : sec.color;
  return (
    <div onClick={onClick}
      style={{ background: C.card,
        border: `1px solid ${C.border}`,
        borderLeft: `4px solid ${accentColor}`,
        borderRadius: 9, padding: "10px 14px", marginBottom: 5, cursor: "pointer",
        transition: "background 0.15s", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}
      onMouseEnter={e => e.currentTarget.style.background = `${accentColor}0d`}
      onMouseLeave={e => e.currentTarget.style.background = C.card}>
      <div style={{ flex: 1, minWidth: 160 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
          {j.flagged && <span style={{ fontSize: 13 }} title={j.flagNote || "Flagged"}>🚩</span>}
          <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{j.name || "Unnamed"}</span>
          {j.simproNo && <span style={{ fontSize: 10, color: C.dim }}>#{j.simproNo}</span>}
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 11, color: C.dim }}>{j.address || "No address"}</span>
          {projDate && (
            <span style={{ fontSize: 11, fontWeight: 700, color: accentColor,
              background: `${accentColor}18`, border: `1px solid ${accentColor}44`,
              borderRadius: 5, padding: "1px 6px" }}>
              📅 {projDate}
            </span>
          )}
        </div>
      </div>
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        {j.foreman && (
          <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 99,
            background: `${foremanColor}22`, color: foremanColor, border: `1px solid ${foremanColor}44` }}>
            {j.foreman}
          </span>
        )}
        {rsDef.color && <Pill label={`R: ${rsDef.label}`} color={rsDef.color} />}
        {fsDef.color && <Pill label={`F: ${fsDef.label}`} color={fsDef.color} />}
        {totalOpen > 0 && <Pill label={`${totalOpen} punch`} color={C.red} />}
        {pendingCOs > 0 && <Pill label={`${pendingCOs} CO`} color={C.orange} />}
        {pendingRTs > 0 && <Pill label={`${pendingRTs} RT`} color={C.purple} />}
      </div>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────
const isMobile = () => /iphone|ipad|ipod|android/i.test(navigator.userAgent);

const openEmail = (to, subject, body) => {
  const encodedSubject = encodeURIComponent(subject);
  const encodedBody    = encodeURIComponent(body);
  if (isMobile()) {
    window.location.href = `mailto:${to}?subject=${encodedSubject}&body=${encodedBody}`;
  } else {
    window.open(`https://mail.google.com/mail/?view=cm&to=${encodeURIComponent(to)}&su=${encodedSubject}&body=${encodedBody}`, "_blank");
  }
};

const deepMergeJob = (remote, local) => {
  if (!remote) return local;
  if (!local)  return remote;
  const mergeArr = (rem, loc, key = "id") => {
    if (!Array.isArray(loc)) return rem;
    if (!Array.isArray(rem)) return loc;
    const map = {};
    rem.forEach(item => { if (item?.[key]) map[item[key]] = item; });
    loc.forEach(item => { if (item?.[key]) map[item[key]] = { ...(map[item[key]] || {}), ...item }; });
    return Object.values(map);
  };
  return {
    ...remote, ...local,
    changeOrders: mergeArr(remote.changeOrders, local.changeOrders),
    returnTrips:  mergeArr(remote.returnTrips,  local.returnTrips),
    roughMaterials: mergeArr(remote.roughMaterials, local.roughMaterials),
    finishMaterials: mergeArr(remote.finishMaterials, local.finishMaterials),
    roughUpdates:  mergeArr(remote.roughUpdates,  local.roughUpdates),
    finishUpdates: mergeArr(remote.finishUpdates, local.finishUpdates),
  };
};

// ── Homeowner Page ─────────────────────────────────────────────
function HomeownerPage({ jobId }) {
  const [job,         setJob]         = useState(null);
  const [loading,     setLoading]     = useState(true);
  const [items,       setItems]       = useState([]);
  const [dragging,    setDragging]    = useState(null);
  const [signature,   setSignature]   = useState("");
  const [submitted,   setSubmitted]   = useState(false);
  const [submitting,  setSubmitting]  = useState(false);
  const [alreadyDone, setAlreadyDone] = useState(false);
  const [error,       setError]       = useState("");

  useEffect(() => {
    (async () => {
      try {
        // Check if already submitted
        const hoSnap = await getDoc(doc(db, "homeowner_requests", jobId));
        if (hoSnap.exists() && hoSnap.data().submitted) { setAlreadyDone(true); setLoading(false); return; }
        // Load job
        const snap = await getDocs(collection(db, "jobs"));
        const found = snap.docs.find(d => d.id === jobId);
        if (!found) { setError("Job not found."); setLoading(false); return; }
        const jobData = found.data().data || found.data();
        setJob(jobData);
        const allRows = [
          ...(jobData.homeRuns?.main     || []),
          ...(jobData.homeRuns?.upper    || []),
          ...(jobData.homeRuns?.basement || []),
          ...((jobData.homeRuns?.extraFloors || []).flatMap(ef => jobData.homeRuns?.[ef.key] || [])),
        ].filter(r => r.name);
        setItems(allRows.map((r, i) => ({ ...r, included: true, priority: i + 1, notes: "" })));
      } catch (e) { setError("Failed to load. Please try again."); }
      setLoading(false);
    })();
  }, [jobId]);

  const handleDragStart = (id) => setDragging(id);
  const handleDragOver  = (e, id) => {
    e.preventDefault();
    if (!dragging || dragging === id) return;
    const from = items.findIndex(i => i.id === dragging);
    const to   = items.findIndex(i => i.id === id);
    if (from === -1 || to === -1) return;
    const reordered = [...items];
    const [moved] = reordered.splice(from, 1);
    reordered.splice(to, 0, moved);
    setItems(reordered.map((it, idx) => ({ ...it, priority: idx + 1 })));
  };
  const handleDragEnd = () => setDragging(null);

  const submit = async () => {
    if (!signature.trim()) { alert("Please sign before submitting."); return; }
    setSubmitting(true);
    try {
      await setDoc(doc(db, "homeowner_requests", jobId), {
        submitted: true, submittedAt: new Date().toISOString(),
        signature: signature.trim(), items,
        jobName: job?.name || "", jobId,
      });
      setSubmitted(true);
    } catch (e) { alert("Failed to submit. Please try again."); }
    setSubmitting(false);
  };

  if (loading) return (
    <div style={{ minHeight: "100vh", background: "#f8fafc", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ fontSize: 14, color: "#64748b" }}>Loading…</div>
    </div>
  );
  if (alreadyDone) return (
    <div style={{ minHeight: "100vh", background: "#f8fafc", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ background: "#fff", border: "0.5px solid #e2e8f0", borderRadius: 16, padding: 32, maxWidth: 480, width: "100%", textAlign: "center" }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>✅</div>
        <div style={{ fontSize: 20, fontWeight: 600, color: "#1e293b", marginBottom: 8 }}>Already Submitted</div>
        <div style={{ fontSize: 14, color: "#64748b" }}>Your generator load selections have already been submitted. Contact Homestead Electric if you need to make changes.</div>
      </div>
    </div>
  );
  if (error) return (
    <div style={{ minHeight: "100vh", background: "#f8fafc", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ fontSize: 14, color: "#dc2626" }}>{error}</div>
    </div>
  );
  if (submitted) return (
    <div style={{ minHeight: "100vh", background: "#f8fafc", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ background: "#fff", border: "0.5px solid #e2e8f0", borderRadius: 16, padding: 32, maxWidth: 480, width: "100%", textAlign: "center" }}>
        <div style={{ fontSize: 40, marginBottom: 16 }}>🎉</div>
        <div style={{ fontSize: 22, fontWeight: 700, color: "#1e293b", marginBottom: 8 }}>Thank you!</div>
        <div style={{ fontSize: 14, color: "#64748b" }}>Your generator load selections have been submitted to Homestead Electric. We'll be in touch soon.</div>
      </div>
    </div>
  );

  const included = items.filter(i => i.included).sort((a, b) => a.priority - b.priority);
  const excluded = items.filter(i => !i.included);
  const totalAmps = included.reduce((sum, it) => sum + (HO_WIRE_AMPS[it.wire] || 0), 0);

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc", fontFamily: "'DM Sans',sans-serif" }}>
      <div style={{ background: "#1e293b", padding: "16px 24px", display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 22, letterSpacing: "0.1em", color: "#f59e0b" }}>HOMESTEAD</div>
        <div style={{ fontSize: 11, color: "#94a3b8", letterSpacing: "0.08em" }}>ELECTRIC</div>
      </div>
      <div style={{ maxWidth: 600, margin: "0 auto", padding: "24px 16px" }}>
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 24, fontWeight: 700, color: "#1e293b", marginBottom: 4 }}>
            Generator Load Selection
          </div>
          {job?.name && <div style={{ fontSize: 14, color: "#64748b" }}>{job.name}{job.address ? ` · ${job.address}` : ""}</div>}
        </div>
        <div style={{ background: "#fff", border: "0.5px solid #e2e8f0", borderRadius: 12, padding: 16, marginBottom: 20, fontSize: 13, color: "#475569", lineHeight: 1.7 }}>
          <strong style={{ color: "#1e293b" }}>Instructions:</strong> Below is a list of electrical circuits in your home. 
          Please check the circuits you'd like to be on the generator, then drag to prioritize them (most important first). 
          The generator has a limited capacity, so we'll work from top to bottom.
        </div>
        {items.length === 0 && (
          <div style={{ textAlign: "center", padding: 40, color: "#94a3b8", fontSize: 14 }}>
            No home run circuits have been added to this job yet. Contact Homestead Electric.
          </div>
        )}
        {included.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", letterSpacing: "0.08em", marginBottom: 10 }}>
              ON GENERATOR ({included.length}) · ~{totalAmps}A total
            </div>
            {included.map(item => (
              <div key={item.id} draggable
                onDragStart={() => handleDragStart(item.id)}
                onDragOver={e => handleDragOver(e, item.id)}
                onDragEnd={handleDragEnd}
                style={{ background: "#fff", border: `1px solid ${dragging === item.id ? "#f59e0b" : "#e2e8f0"}`,
                  borderRadius: 10, padding: "12px 14px", marginBottom: 8, cursor: "grab",
                  opacity: dragging === item.id ? 0.5 : 1, transition: "border-color 0.15s" }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                  <div style={{ width: 24, height: 24, borderRadius: "50%", background: "#fef3c7", border: "1px solid #fde68a",
                    display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11,
                    fontWeight: 700, color: "#b45309", flexShrink: 0, marginTop: 1 }}>
                    {item.priority}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <span style={{ fontSize: 14, fontWeight: 600, color: "#1e293b" }}>{item.name}</span>
                      {item.wire && (
                        <span style={{ fontSize: 11, padding: "1px 6px", borderRadius: 5,
                          background: WIRE_COLORS[item.wire] || "#f1f5f9", color: WIRE_TEXT[item.wire] || "#1e293b",
                          fontWeight: 700 }}>{item.wire}</span>
                      )}
                      {HO_WIRE_AMPS[item.wire] && (
                        <span style={{ fontSize: 11, color: "#b45309", fontWeight: 700 }}>{HO_WIRE_AMPS[item.wire]}A</span>
                      )}
                    </div>
                    {item.panel && <div style={{ fontSize: 11, color: "#94a3b8" }}>{item.panel}</div>}
                    <textarea value={item.notes || ""} onChange={e => setItems(items.map(i => i.id === item.id ? { ...i, notes: e.target.value } : i))}
                      placeholder="Any notes about this circuit…" rows={1}
                      style={{ width: "100%", marginTop: 6, background: "#f8fafc", border: "0.5px solid #e2e8f0",
                        borderRadius: 6, color: "#475569", padding: "5px 8px", fontSize: 12,
                        fontFamily: "inherit", resize: "vertical", outline: "none" }} />
                  </div>
                  <button onClick={() => setItems(items.map(i => i.id === item.id ? { ...i, included: false } : i))}
                    style={{ background: "none", border: "1px solid #e2e8f0", borderRadius: 6,
                      color: "#94a3b8", cursor: "pointer", padding: "4px 8px", fontSize: 11, flexShrink: 0 }}>
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        {excluded.length > 0 && (
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#cbd5e1", letterSpacing: "0.08em", marginBottom: 10 }}>
              NOT ON GENERATOR ({excluded.length})
            </div>
            {excluded.map(item => (
              <div key={item.id}
                style={{ background: "#f8fafc", border: "0.5px solid #f1f5f9", borderRadius: 10,
                  padding: "10px 14px", marginBottom: 6, display: "flex", alignItems: "center", gap: 10, opacity: 0.6 }}>
                <div style={{ flex: 1 }}>
                  <span style={{ fontSize: 13, color: "#94a3b8" }}>{item.name}</span>
                  {item.wire && <span style={{ fontSize: 11, color: "#cbd5e1", marginLeft: 8 }}>{item.wire}</span>}
                </div>
                <button onClick={() => setItems(items.map(i => i.id === item.id ? { ...i, included: true, priority: included.length + 1 } : i))}
                  style={{ background: "none", border: "1px solid #e2e8f0", borderRadius: 6,
                    color: "#64748b", cursor: "pointer", padding: "4px 8px", fontSize: 11, flexShrink: 0 }}>
                  Add
                </button>
              </div>
            ))}
          </div>
        )}
        <div style={{ background: "#fff", border: "0.5px solid #e2e8f0", borderRadius: 12, padding: 20, marginBottom: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#1e293b", marginBottom: 8 }}>Signature</div>
          <div style={{ fontSize: 12, color: "#64748b", marginBottom: 10 }}>By typing your name, you confirm your generator load selections above.</div>
          <input value={signature} onChange={e => setSignature(e.target.value)} placeholder="Type your full name…"
            style={{ width: "100%", border: "0.5px solid #e2e8f0", borderRadius: 8, padding: "10px 14px",
              fontSize: 16, fontFamily: "Georgia, serif", color: "#1e293b", outline: "none", background: "#f8fafc" }} />
        </div>
        <button onClick={submit} disabled={submitting || !signature.trim()}
          style={{ width: "100%", background: signature.trim() && !submitting ? "#d97706" : "#e2e8f0",
            border: "none", borderRadius: 10, color: signature.trim() && !submitting ? "#000" : "#94a3b8",
            fontWeight: 700, fontSize: 15, padding: "14px", cursor: signature.trim() && !submitting ? "pointer" : "not-allowed",
            fontFamily: "inherit", transition: "all 0.15s" }}>
          {submitting ? "Submitting…" : "Submit My Selections ✓"}
        </button>
      </div>
    </div>
  );
}

// ── Main App ───────────────────────────────────────────────────
export default function App() {
  const hoParam = new URLSearchParams(window.location.search).get("homeowner");
  if (hoParam) return <HomeownerPage jobId={hoParam} />;

  const [jobs,        setJobs]        = useState([]);
  const [selectedJob, setSelectedJob] = useState(null);
  const [view,        setView]        = useState("home");
  const [foremanView, setForemanView] = useState(FOREMEN[0]);
  const [search,      setSearch]      = useState("");
  const [stageFilter, setStageFilter] = useState("");
  const [showNewJob,  setShowNewJob]  = useState(false);
  const [syncing,     setSyncing]     = useState(false);
  const pendingRef = useRef({});
  const timerRef   = useRef({});
  const jobsRef    = useRef([]);

  useEffect(() => { jobsRef.current = jobs; }, [jobs]);

  // ── Firestore real-time listener ──────────────────────────
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "jobs"), (snap) => {
      const remote = {};
      snap.docs.forEach(d => { remote[d.id] = d.data().data || d.data(); });
      setJobs(prev => {
        const merged = Object.values(remote).map(rj => {
          const local = prev.find(j => j.id === rj.id);
          if (!local) return normalizeJob(rj);
          return normalizeJob(deepMergeJob(rj, local));
        });
        // Keep local-only jobs not yet synced
        prev.forEach(lj => { if (!remote[lj.id]) merged.push(lj); });
        return merged;
      });
    });
    // Also load from localStorage as initial fallback
    try {
      const stored = localStorage.getItem(JOB_ID);
      if (stored) {
        const parsed = JSON.parse(stored);
        setJobs(prev => prev.length > 0 ? prev : parsed.map(normalizeJob));
      }
    } catch(e) {}
    return () => unsub();
  }, []);

  // ── Persist to localStorage ───────────────────────────────
  useEffect(() => {
    try { localStorage.setItem(JOB_ID, JSON.stringify(jobs)); } catch(e) {}
  }, [jobs]);

  // ── Debounced Firestore save ──────────────────────────────
  const saveJob = (job) => {
    pendingRef.current[job.id] = job;
    clearTimeout(timerRef.current[job.id]);
    timerRef.current[job.id] = setTimeout(async () => {
      const toSave = pendingRef.current[job.id];
      if (!toSave) return;
      delete pendingRef.current[job.id];
      try {
        await setDoc(doc(db, "jobs", toSave.id), { data: sanitize(toSave) });
      } catch(e) { console.error("Save failed:", e); }
    }, 500);
  };

  const flushSaves = async () => {
    const pending = Object.values(pendingRef.current);
    if (pending.length === 0) return;
    await Promise.allSettled(pending.map(job =>
      setDoc(doc(db, "jobs", job.id), { data: sanitize(job) })
    ));
    pendingRef.current = {};
    Object.values(timerRef.current).forEach(clearTimeout);
    timerRef.current = {};
  };

  useEffect(() => {
    const handler = () => flushSaves();
    document.addEventListener("visibilitychange", handler);
    window.addEventListener("beforeunload", handler);
    return () => {
      document.removeEventListener("visibilitychange", handler);
      window.removeEventListener("beforeunload", handler);
    };
  }, []);

  const deleteJobRemote = async (jobId) => {
    try { await deleteDoc(doc(db, "jobs", jobId)); } catch(e) { console.error(e); }
  };

  const handleUpdate = (updated) => {
    setJobs(prev => prev.map(j => j.id === updated.id ? updated : j));
    if (selectedJob?.id === updated.id) setSelectedJob(updated);
    saveJob(updated);
  };

  const addJob = () => {
    const j = blankJob();
    setJobs(prev => [j, ...prev]);
    setSelectedJob(j);
    saveJob(j);
    setShowNewJob(false);
  };

  const backupByEmail = () => {
    const json = JSON.stringify(jobs, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = `homestead-backup-${new Date().toISOString().slice(0,10)}.json`;
    a.click(); URL.revokeObjectURL(url);
    openEmail("", "Homestead Electric — Job Data Backup", "Attached is the latest job data backup.");
  };

  const foremanStats = (name) => {
    const fJobs = jobs.filter(j => j.foreman === name);
    const rough = fJobs.filter(j => ["ready","scheduled","inprogress"].includes(effRS(j))).length;
    const finish = fJobs.filter(j => ["ready","scheduled","inprogress"].includes(effFS(j))).length;
    const invoice = fJobs.filter(j => effRS(j)==="invoice" || effFS(j)==="invoice").length;
    const holds = fJobs.filter(j => effRS(j)==="waiting" || effFS(j)==="waiting").length;
    const openPunch = (punch) => {
      if (!punch) return 0;
      const cf = f => {
        if (!f) return 0;
        if (Array.isArray(f)) return f.filter(i => !i.done).length;
        return (f.general||[]).filter(i=>!i.done).length + (f.rooms||[]).reduce((a,r)=>a+(Array.isArray(r.items)?r.items.filter(i=>!i.done).length:0),0);
      };
      return cf(punch.upper)+cf(punch.main)+cf(punch.basement)+(punch.extras||[]).reduce((s,e)=>s+cf(punch[e.key]||{}),0);
    };
    const punch = fJobs.reduce((s,j)=>s+openPunch(j.roughPunch)+openPunch(j.finishPunch),0);
    return { total:fJobs.length, rough, finish, invoice, holds, punch };
  };

  // ── Filtered jobs for foreman view ────────────────────────
  const visibleJobs = jobs.filter(j => {
    if (j.foreman !== foremanView) return false;
    if (search && !`${j.name} ${j.address} ${j.gc} ${j.simproNo}`.toLowerCase().includes(search.toLowerCase())) return false;
    if (stageFilter) {
      const sec = STAGE_SECTIONS.find(s => s.key === stageFilter);
      if (sec && !sec.test(j)) return false;
    }
    return true;
  });

  return (
    <div style={{ minHeight:"100vh", background:C.bg, fontFamily:"'DM Sans',sans-serif", color:C.text }}>
      <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet"/>

      {/* Nav */}
      <div style={{ background:C.surface, borderBottom:`1px solid ${C.border}`, padding:"0 16px",
        display:"flex", alignItems:"center", justifyContent:"space-between", height:52, position:"sticky", top:0, zIndex:100 }}>
        <div style={{ display:"flex", alignItems:"center", gap:12 }}>
          <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:22, letterSpacing:"0.1em", color:C.accent }}>HOMESTEAD</div>
          <div style={{ fontSize:10, color:C.dim, letterSpacing:"0.12em", fontWeight:700 }}>ELECTRIC</div>
        </div>
        <div style={{ display:"flex", gap:6, alignItems:"center" }}>
          {["home","foreman"].map(v=>(
            <button key={v} onClick={()=>setView(v)}
              style={{ background:view===v?C.accent:"none", border:`1px solid ${view===v?C.accent:C.border}`,
                borderRadius:7, color:view===v?"#000":C.dim, padding:"5px 14px", fontSize:12,
                fontWeight:view===v?700:400, cursor:"pointer", fontFamily:"inherit", textTransform:"capitalize" }}>
              {v==="home"?"🏠 Overview":"👷 Foreman"}
            </button>
          ))}
          <button onClick={addJob}
            style={{ background:C.green, border:"none", borderRadius:7, color:"#fff", fontWeight:700,
              padding:"5px 14px", fontSize:12, cursor:"pointer", fontFamily:"inherit" }}>
            + Job
          </button>
        </div>
      </div>

      {/* Home / Overview */}
      {view==="home"&&(
        <div style={{ maxWidth:1100, margin:"0 auto", padding:"20px 16px" }}>
          {/* Foreman Cards */}
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))", gap:12, marginBottom:24 }}>
            {FOREMEN.map(name=>{
              const s = foremanStats(name);
              const fc = FOREMEN_COLORS[name] || C.dim;
              return (
                <div key={name} onClick={()=>{ setForemanView(name); setView("foreman"); }}
                  style={{ background:C.card, border:`1px solid ${fc}44`, borderRadius:12, padding:"14px 16px",
                    cursor:"pointer", transition:"border-color 0.15s" }}
                  onMouseEnter={e=>e.currentTarget.style.borderColor=fc}
                  onMouseLeave={e=>e.currentTarget.style.borderColor=fc+"44"}>
                  <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:10 }}>
                    <div style={{ width:10, height:10, borderRadius:"50%", background:fc }} />
                    <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:18, letterSpacing:"0.06em", color:fc }}>{name}</div>
                  </div>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:4 }}>
                    {[
                      ["Jobs", s.total, C.text],
                      ["Rough", s.rough, C.rough],
                      ["Finish", s.finish, C.finish],
                      ["Invoice", s.invoice, C.orange],
                      ["On Hold", s.holds, "#f59e0b"],
                      ["Punch", s.punch, s.punch>0?C.red:C.muted],
                    ].map(([l,v,c])=>(
                      <div key={l} style={{ padding:"5px 8px", background:C.surface, borderRadius:7, border:`1px solid ${C.border}` }}>
                        <div style={{ fontSize:9, color:C.dim, fontWeight:700, letterSpacing:"0.08em" }}>{l}</div>
                        <div style={{ fontSize:16, fontWeight:700, color:c }}>{v}</div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          {/* All Jobs */}
          <div style={{ marginBottom:12, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
            <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:22, letterSpacing:"0.06em", color:C.dim }}>All Jobs ({jobs.length})</div>
            <button onClick={backupByEmail}
              style={{ background:"none", border:`1px solid ${C.border}`, borderRadius:7, color:C.dim,
                fontSize:11, padding:"5px 10px", cursor:"pointer", fontFamily:"inherit" }}>
              ⬇ Backup
            </button>
          </div>
          <StageSectionList jobs={jobs} onSelectJob={j=>setSelectedJob(j)} filterForeman={null}/>
        </div>
      )}

      {/* Foreman View */}
      {view==="foreman"&&(
        <div style={{ maxWidth:900, margin:"0 auto", padding:"20px 16px" }}>
          {/* Foreman Tabs */}
          <div style={{ display:"flex", gap:6, marginBottom:16, flexWrap:"wrap" }}>
            {FOREMEN.map(name=>{
              const fc = FOREMEN_COLORS[name]||C.dim;
              const active = foremanView===name;
              const s = foremanStats(name);
              return (
                <button key={name} onClick={()=>setForemanView(name)}
                  style={{ background:active?`${fc}22`:"none", border:`1px solid ${active?fc:C.border}`,
                    borderRadius:9, padding:"7px 16px", fontSize:13, cursor:"pointer", fontFamily:"inherit",
                    color:active?fc:C.dim, fontWeight:active?700:400, display:"flex", alignItems:"center", gap:8 }}>
                  <div style={{ width:8, height:8, borderRadius:"50%", background:active?fc:C.border }} />
                  {name}
                  <span style={{ fontSize:11, color:active?fc:C.muted }}>{s.total}</span>
                </button>
              );
            })}
          </div>
          {/* Filters */}
          <div style={{ display:"flex", gap:8, marginBottom:16, flexWrap:"wrap" }}>
            <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search jobs…"
              style={{ flex:1, minWidth:160, background:C.surface, border:`1px solid ${C.border}`,
                borderRadius:7, padding:"7px 10px", fontSize:12, fontFamily:"inherit", outline:"none", color:C.text }}/>
            <select value={stageFilter} onChange={e=>setStageFilter(e.target.value)}
              style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:7,
                color:stageFilter?C.text:C.dim, padding:"7px 10px", fontSize:12, fontFamily:"inherit", outline:"none" }}>
              <option value="">All stages</option>
              {STAGE_SECTIONS.map(s=><option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </div>
          <StageSectionList jobs={visibleJobs} onSelectJob={j=>setSelectedJob(j)} filterForeman={null}/>
          {visibleJobs.length===0&&(
            <div style={{ textAlign:"center", padding:48, color:C.muted, fontSize:14 }}>
              No jobs found for {foremanView}{search?` matching "${search}"`:""}
            </div>
          )}
        </div>
      )}

      {/* Job Detail Modal */}
      {selectedJob&&(
        <JobDetail
          job={selectedJob}
          onUpdate={handleUpdate}
          onClose={()=>setSelectedJob(null)}
        />
      )}
    </div>
  );
}
