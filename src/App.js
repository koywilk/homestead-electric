// BUILD_v9_FIXED
import { useState, useEffect, useRef } from "react";
import { initializeApp } from "firebase/app";
import { getFirestore, doc, setDoc, updateDoc, deleteDoc, getDoc, collection, getDocs, onSnapshot } from "firebase/firestore";
import { getStorage, ref, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";


// Register service worker for offline support

if("serviceWorker" in navigator) {

  window.addEventListener("load", () => {

    navigator.serviceWorker.register("/service-worker.js").catch(()=>{});

  });

}


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
const storage = getStorage(firebaseApp);
window.__HE_DB = db;

// Check what Firestore ACTUALLY has for a job
window.__HE_CHECK = async(name)=>{
  const snap = await getDocs(collection(db,"jobs"));
  const found = snap.docs.map(d=>({id:d.id,...d.data()})).find(j=>j.data?.name?.includes(name||'Jeremy Ranch'));
  if(found) { console.log('Firestore has:',{foreman:found.data.foreman, lead:found.data.lead, name:found.data.name}); return found.data; }
  else { console.log('Job not found'); return null; }
};

// Compare localStorage backup vs Firestore for all jobs
window.__HE_COMPARE = async()=>{
  const backup=JSON.parse(localStorage.getItem('hejobs_backup')||'[]');
  const snap = await getDocs(collection(db,"jobs"));
  const fsJobs = snap.docs.map(d=>{ const raw=d.data(); return raw?.data||null; }).filter(Boolean);
  let diffs=0;
  backup.forEach(bj=>{
    const fj=fsJobs.find(f=>f.id===bj.id||f.name===bj.name);
    if(fj && fj.foreman!==bj.foreman){
      console.log('MISMATCH: '+bj.name+' — backup: '+bj.foreman+' | firestore: '+fj.foreman);
      diffs++;
    }
  });
  console.log(diffs===0?'All foremen match!':diffs+' mismatches found');
};

window.__HE_RESTORE = async()=>{
  const b=localStorage.getItem('hejobs_backup');
  if(!b){console.log('No backup');return;}
  const jobs=JSON.parse(b);
  console.log('Restoring '+jobs.length+' jobs...');
  let c=0;
  for(const job of jobs){
    const clean=Object.fromEntries(Object.entries(job).filter(([,v])=>v!==undefined));
    await setDoc(doc(db,"jobs",job.id),{data:clean,updated_at:new Date().toISOString()});
    c++;
    if(c%10===0) console.log(c+'/'+jobs.length);
  }
  console.log('DONE — restored '+c+' jobs to Firestore');
  // Verify it stuck
  console.log('Verifying...');
  await window.__HE_CHECK('Jeremy Ranch');
  alert('Restored '+c+' jobs! Refresh the page.');
};

// Offline persistence is enabled by default in Firebase v10+ web SDK
// Multi-tab support via enableMultiTabIndexedDbPersistence is deprecated
// If you upgrade to firebase v11+, use initializeFirestore with persistenceSettings instead


const HO_WIRE_AMPS = {"14/2":15,"14/3":15,"12/2":20,"12/3":20,"10/2":30,"10/3":30,"8/2":40,"8/3":40,"6/2":50,"6/3":50,"4/2":70,"4/3":70,"2/2":95,"2/3":95,"1/0":125,"2/0":150,"3/0":175,"4/0":200};

const C = {

  bg:"#f1f5f9", surface:"#ffffff", card:"#ffffff", border:"#e2e8f0",

  muted:"#cbd5e1", text:"#0f172a", dim:"#64748b", accent:"#d97706",

  blue:"#2563eb", green:"#16a34a", red:"#dc2626", purple:"#0ea5e9",

  orange:"#ea580c", teal:"#0d9488", rough:"#2563eb", finish:"#0ea5e9",

};


const ROUGH_STATUSES = [
  {value:"",           label:"— set status —",                        color:null},
  {value:"waiting_date",label:"Waiting for Start Date Confirmation",  color:"#ca8a04"},
  {value:"date_confirmed",label:"Start Date Confirmed — Needs to Schedule", color:"#f97316", hasDate:true},
  {value:"scheduled",  label:"Scheduled",                            color:"#2563eb", hasDate:true},
  {value:"waiting",    label:"Waiting on Items",                     color:"#ca8a04", dashed:true},
  {value:"inprogress", label:"In Progress",                          color:"#7dd3fc", hasDate:true},
  {value:"invoice",    label:"Ready to Invoice",                     color:"#ea580c"},
  {value:"complete",   label:"Complete",                             color:"#22c55e"},
];
const FINISH_STATUSES = ROUGH_STATUSES;
const CO_STATUSES_NEW = [
  {value:"needs_sending", label:"Needs to be Sent",       color:"#dc2626"},
  {value:"pending",       label:"Sent — Pending Approval", color:"#ca8a04"},
  {value:"approved",      label:"Approved",                color:"#16a34a"},
  {value:"scheduled",     label:"Scheduled",               color:"#2563eb", hasDate:true},
  {value:"completed",     label:"Work Completed",          color:"#22c55e"},
  {value:"converted",     label:"Converted to RT",         color:"#6b7280"},
  {value:"denied",        label:"Denied",                  color:"#dc2626"},
];
const RT_STATUSES = [
  {value:"",          label:"— set status —",        color:null},
  {value:"needs",     label:"Needs to be Scheduled", color:"#dc2626", hasDate:true},
  {value:"scheduled", label:"Scheduled",             color:"#8b5cf6", hasDate:true},
  {value:"complete",  label:"Complete",              color:"#22c55e"},
];
const QC_STATUSES = [
  {value:"",          label:"— set status —",        color:null},
  {value:"needs",     label:"Needs to be Scheduled", color:"#dc2626"},
  {value:"scheduled", label:"QC Scheduled",          color:"#2563eb", hasDate:true},
  {value:"completed", label:"QC Completed",          color:"#8b5cf6", hasDate:true},
  {value:"pass",      label:"QC Pass",               color:"#22c55e"},
  {value:"fail",      label:"QC Fail",               color:"#dc2626"},
];
const TEMP_PED_STATUSES = [
  {value:"",          label:"— set status —",       color:null},
  {value:"ready",     label:"Ready to Schedule",    color:"#ca8a04"},
  {value:"scheduled", label:"Scheduled",            color:"#2563eb", hasDate:true},
  {value:"completed", label:"Completed",            color:"#22c55e"},
];
const QUICK_JOB_STATUSES = [
  {value:"new",       label:"New",                  color:"#6b7280"},
  {value:"scheduled", label:"Scheduled",            color:"#2563eb", hasDate:true},
  {value:"inprogress",label:"In Progress",          color:"#7dd3fc"},
  {value:"complete",  label:"Complete",             color:"#22c55e"},
  {value:"invoice",   label:"Ready to Invoice",     color:"#ea580c"},
];
const QUICK_JOB_TYPES = [
  {value:"service",    label:"Service Call",    color:"#f97316"},
  {value:"panel",      label:"Panel Upgrade",   color:"#2563eb"},
  {value:"tempped",    label:"Temp Ped Pickup", color:"#8b5cf6"},
  {value:"other",      label:"Other",           color:"#6b7280"},
];
const getStatusDef = (arr, val) => arr.find(x=>x.value===val)||{};

const PREP_STAGES   = ['Redline Walk Scheduled','Redline Walk Completed','Redline CO Doc Made','Redline Plans Made','Redline CO Sent','Redline CO Signed','Redline Plans Need to be Updated','Job Prep Complete'];
const PREP_STAGE_ALERT = 'Redline Plans Need to be Updated';

const ROUGH_STAGES  = ['0%', '5%', '10%', '15%', '20%', '25%', '30%', '35%', '40%', '45%', '50%', '55%', '60%', '65%', '70%', '75%', '80%', '85%', '90%', '95%', '100%'];

const FINISH_STAGES = ['0%', '5%', '10%', '15%', '20%', '25%', '30%', '35%', '40%', '45%', '50%', '55%', '60%', '65%', '70%', '75%', '80%', '85%', '90%', '95%', '100%'];
// parseStage: roughScheduled/finishScheduled flags move job into in-progress section
const parseStage = (s) => s==='Scheduled' ? 1 : (parseInt(s)||0);

const WIRE_SIZES = ["","14/2","14/3","12/2","12/3","10/2","10/3","8/2","8/3","6/2","6/3","4/2","4/3","2/2","2/3","1/0","2/0","3/0","4/0","#1","#2","#3","#4"];

const WIRE_COLORS = {

  "14/2": "#e8e8e8", "14/3": "#3b82f6",

  "12/2": "#f5d020", "12/3": "#9b59b6",

  "10/2": "#f4820a", "10/3": "#f4a0c0",

  "8/2":  "#444444", "8/3":  "#444444",

  "6/2":  "#444444", "6/3":  "#444444",

  "4/2":  "#444444", "4/3":  "#444444",

  "2/2":  "#444444", "2/3":  "#444444",

  "1/0":  "#444444", "2/0":  "#444444", "3/0": "#444444", "4/0": "#444444",

  "#1": "#444444", "#2": "#444444", "#3": "#444444", "#4": "#444444",

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

  "#1": "#fff", "#2": "#fff", "#3": "#fff", "#4": "#fff",

};

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

const newKPRow     = (num) => ({ id:uid(), num, name:"", status:"" });

const emptyPunch   = ()    => ({ upper:[], main:[], basement:[] });


const DEFAULT_FOREMEN = ["Koy", "Vasa", "Colby"];
const DEFAULT_FOREMEN_COLORS = {"Koy":"#3b82f6","Vasa":"#f97316","Colby":"#22c55e"};
const DEFAULT_LEADS = ["Keegan","Gage","Daegan","Colby","Braden","Treycen","Jon","Vasa","Abe","Louis","Jacob"];
const DEFAULT_LEAD_COLORS = {
  "Keegan":"#3b82f6","Gage":"#3b82f6","Daegan":"#3b82f6",
  "Colby":"#22c55e","Braden":"#22c55e","Treycen":"#22c55e","Jon":"#22c55e",
  "Vasa":"#f97316","Abe":"#f97316","Louis":"#f97316",
  "Jacob":"#6b7280"
};
// Module-level settings — mutated by App.saveSettings and load
let FOREMEN        = DEFAULT_FOREMEN;
let FOREMEN_COLORS = DEFAULT_FOREMEN_COLORS;
let LEADS          = DEFAULT_LEADS;
let LEAD_COLORS    = DEFAULT_LEAD_COLORS;

// Helper getters — always return current values even after settings update
const getFC = (name) => (FOREMEN_COLORS[name]||"#6b7280");
const getForemenList = () => FOREMEN;
const getLeadsList = () => LEADS;
const getLeadFC = (name) => (LEAD_COLORS[name]||"#6b7280");
const COLOR_OPTIONS = ["#3b82f6","#f97316","#22c55e","#8b5cf6","#ec4899","#14b8a6","#f59e0b","#ef4444","#06b6d4","#a855f7","#84cc16","#f43f5e"];

// ── Identity & Permissions ────────────────────────────────────
const IDENTITY_KEY   = "he_identity";
const IDENTITY_TTL   = 24 * 60 * 60 * 1000; // 24 hours in ms
const USERS_KEY    = "he_users";    // Firestore + localStorage user list

// Default users — Koy is admin to start, everyone else added in-app
const DEFAULT_USERS = [
  { id:"koy", name:"Koy Wilkinson", role:"admin", pin:"" },
];

// ── Title = field role (who they are on site) ────────────────
const TITLE_OPTIONS = ["admin","foreman","lead","crew"];
const TITLE_LABELS  = { admin:"Admin", foreman:"Foreman", lead:"Lead", crew:"Crew" };

// ── Access = what they can do in the app ─────────────────────
const ACCESS_OPTIONS = ["admin","manager","standard","limited","contractor"];
const ACCESS_LABELS  = { admin:"Admin", manager:"Manager", standard:"Standard", limited:"Limited", contractor:"Contractor" };

// Legacy role field compat (old users only have role, not title+access)
const ROLE_LABELS = {
  admin:"Admin", justin:"Admin", jeromy:"Admin",
  foreman:"Foreman", lead:"Lead", crew:"Crew",
};
const ROLE_OPTIONS = ["admin","foreman","lead","crew"];

// Permission map — keyed by access level
// admin    = full access
// manager  = everything except delete jobs
// standard = foreman-level (cards, tasks, schedule, pipeline view)
// limited  = home + job editing only (lead/crew)
const PERMISSIONS = {
  "home.view":       ["admin","manager","standard","limited"],
  "home.edit":       ["admin","manager","standard","limited"],
  "co.edit":         ["admin","manager","standard","limited"],
  "foreman.cards":   ["admin","manager","standard","limited"],
  "tasks.view":      ["admin","manager","standard"],
  "tasks.addTask":   ["admin","manager","standard"],
  "tasks.setDueDate":["admin","manager","standard"],
  "schedule.view":   ["admin","manager","standard"],
  "schedule.edit":   ["admin","manager"],
  "pipeline.view":   ["admin","manager","standard"],
  "pipeline.manage": ["admin","manager"],
  "reports.view":    ["admin","manager","standard"],
  "settings.view":   ["admin","manager"],
  "users.manage":    ["admin","manager"],
  "job.delete":      ["admin"],
};

// Resolve access level from user object (supports legacy role-only users)
const getAccess = (user) => {
  if(!user) return "limited";
  if(user.access) return user.access;
  // Legacy: map old role to access level
  const legacyMap = { admin:"admin", justin:"admin", jeromy:"manager",
                      foreman:"standard", lead:"limited", crew:"limited" };
  return legacyMap[user.role] || "limited";
};

// Check if a user (identity object) can do a feature
const can = (identity, feature) => {
  if(!identity) return false;
  const access  = getAccess(identity);
  const allowed = PERMISSIONS[feature] || [];
  return allowed.includes(access);
};

// Read identity — returns null if missing or older than 24h
const getIdentity = () => {
  try {
    const raw = localStorage.getItem(IDENTITY_KEY);
    if(!raw) return null;
    const stored = JSON.parse(raw);
    if(!stored) return null;
    if(Date.now() - (stored.pinVerifiedAt||0) > IDENTITY_TTL) {
      localStorage.removeItem(IDENTITY_KEY);
      return null;
    }
    return stored;
  } catch { return null; }
};
const saveIdentity = (member) => {
  localStorage.setItem(IDENTITY_KEY, JSON.stringify({...member, pinVerifiedAt: Date.now()}));
};

// ── UserPicker — name list + PIN entry ───────────────────────
function UserPicker({ users, onSelect, onSavePin }) {
  const [step, setStep]         = useState("pick");   // "pick" | "pin" | "create" | "confirm"
  const [chosen, setChosen]     = useState(null);
  const [pin, setPin]           = useState("");
  const [firstPin, setFirstPin] = useState("");
  const [error, setError]       = useState(false);
  const [saving, setSaving]     = useState(false);

  const pickUser = (u) => {
    if(!u.pin) {
      // No PIN yet — prompt to create one
      setChosen(u); setPin(""); setFirstPin(""); setError(false); setStep("create");
      return;
    }
    setChosen(u); setPin(""); setError(false); setStep("pin");
  };

  const submitPin = (entered) => {
    if(entered === chosen.pin) {
      onSelect(chosen);
    } else {
      setError(true); setPin("");
      setTimeout(()=>setError(false), 1200);
    }
  };

  const submitCreate = (entered) => {
    // First entry — move to confirm step
    setFirstPin(entered); setPin(""); setStep("confirm");
  };

  const submitConfirm = async (entered) => {
    if(entered !== firstPin) {
      setError(true); setPin("");
      setTimeout(()=>{ setError(false); setStep("create"); setFirstPin(""); }, 1200);
      return;
    }
    // PINs match — save and log in
    setSaving(true);
    const updated = {...chosen, pin: entered};
    await onSavePin(updated);
    onSelect(updated);
  };

  const handleKey = (k) => {
    if(k==="⌫") { setPin(p=>p.slice(0,-1)); return; }
    if(k==="") return;
    const next = pin+k;
    setPin(next);
    if(next.length===4) {
      if(step==="pin")     submitPin(next);
      if(step==="create")  submitCreate(next);
      if(step==="confirm") submitConfirm(next);
    }
  };

  return (
    <div style={{minHeight:"100vh",background:C.bg,fontFamily:"'DM Sans',sans-serif",
      display:"flex",alignItems:"center",justifyContent:"center",padding:32,
      backgroundImage:"url(/icon-192.png)",backgroundRepeat:"no-repeat",
      backgroundPosition:"center center",backgroundSize:"420px 420px",
      backgroundBlendMode:"overlay"}}>
      <div style={{width:"100%",maxWidth:340,textAlign:"center"}}>
        <img src="/icon-192.png" alt="Homestead Electric"
          style={{width:90,height:90,marginBottom:16,opacity:0.95,borderRadius:18,
            boxShadow:"0 8px 32px rgba(0,0,0,0.4)"}}/>
        <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:32,letterSpacing:"0.1em",
          color:C.text,lineHeight:1,marginBottom:4}}>HOMESTEAD ELECTRIC</div>
        <div style={{fontSize:12,color:C.dim,letterSpacing:"0.04em",marginBottom:32}}>
          COMMAND CENTER
        </div>

        {step==="pick" && (
          <>
            <div style={{fontSize:13,color:C.dim,marginBottom:16}}>Who are you?</div>
            <div style={{display:"flex",flexDirection:"column",gap:10}}>
              {users.map(u=>(
                <button key={u.id} onClick={()=>pickUser(u)}
                  style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,
                    padding:"14px 20px",fontSize:15,fontWeight:600,cursor:"pointer",
                    fontFamily:"inherit",color:C.text,textAlign:"left",
                    display:"flex",alignItems:"center",justifyContent:"space-between",
                    transition:"all 0.15s"}}
                  onMouseEnter={e=>{e.currentTarget.style.borderColor=C.accent;e.currentTarget.style.background="#fffbeb";}}
                  onMouseLeave={e=>{e.currentTarget.style.borderColor=C.border;e.currentTarget.style.background=C.card;}}>
                  <span>{u.name}</span>
                  <span style={{fontSize:11,color:C.dim,fontWeight:400,background:C.surface,
                    border:`1px solid ${C.border}`,borderRadius:99,padding:"2px 10px"}}>
                    {ROLE_LABELS[u.role]||u.role}
                  </span>
                </button>
              ))}
            </div>
          </>
        )}

        {(step==="pin"||step==="create"||step==="confirm") && (
          <>
            <div style={{fontSize:14,color:C.text,fontWeight:600,marginBottom:4}}>{chosen?.name}</div>
            <div style={{fontSize:12,color:C.dim,marginBottom:24}}>
              {step==="pin"     && "Enter your PIN"}
              {step==="create"  && "Create a 4-digit PIN"}
              {step==="confirm" && (error ? "PINs don't match — try again" : "Confirm your PIN")}
            </div>
            <div style={{display:"flex",justifyContent:"center",gap:14,marginBottom:8}}>
              {[0,1,2,3].map(i=>(
                <div key={i} style={{width:13,height:13,borderRadius:"50%",
                  background:pin.length>i?(error?"#dc2626":C.accent):C.surface,
                  border:`2px solid ${pin.length>i?(error?"#dc2626":C.accent):C.border}`,
                  transition:"all 0.15s"}}/>
              ))}
            </div>
            <div style={{height:22,marginBottom:16}}>
              {step==="pin"&&error&&<div style={{fontSize:11,color:"#dc2626",fontWeight:700,letterSpacing:"0.06em"}}>INCORRECT PIN</div>}
              {saving&&<div style={{fontSize:11,color:C.accent,fontWeight:600}}>Saving…</div>}
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:16}}>
              {["1","2","3","4","5","6","7","8","9","","0","⌫"].map((k,idx)=>(
                <button key={idx} onClick={()=>handleKey(k)} disabled={saving}
                  style={{padding:"18px 0",fontSize:k==="⌫"?16:22,fontWeight:k==="⌫"?400:300,
                    fontFamily:"'DM Sans',sans-serif",
                    background:k?"rgba(0,0,0,0.04)":"transparent",
                    border:k?"1px solid rgba(0,0,0,0.08)":"none",
                    borderRadius:14,cursor:k?"pointer":"default",
                    color:k?C.text:"transparent",transition:"background 0.1s"}}
                  onMouseEnter={e=>{if(k)e.currentTarget.style.background="rgba(0,0,0,0.08)";}}
                  onMouseLeave={e=>{if(k)e.currentTarget.style.background=k?"rgba(0,0,0,0.04)":"transparent";}}>
                  {k}
                </button>
              ))}
            </div>
            <button onClick={()=>{setStep("pick");setChosen(null);setPin("");setFirstPin("");}}
              style={{fontSize:12,color:C.dim,background:"none",border:"none",cursor:"pointer",fontFamily:"inherit"}}>
              ← Back
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ── User Management (inside Settings) ───────────────────────
function UserManagement({ users, onSave }) {
  const [list,    setList]    = useState(users);
  const [editing, setEditing] = useState(null);
  const [showPin, setShowPin] = useState({});

  useEffect(()=>setList(users),[users]);

  const newUser = () => {
    const u = { id:"u_"+Date.now(), name:"", title:"foreman", access:"standard", pin:"" };
    setList(l=>[...l,u]);
    setEditing(u.id);
  };

  const upd  = (id, patch) => setList(l=>l.map(u=>u.id===id?{...u,...patch}:u));
  const del  = (id) => { if(!window.confirm("Remove this person?")) return; const next=list.filter(u=>u.id!==id); setList(next); onSave(next); };
  const save = () => { onSave(list); setEditing(null); };

  // Access level colors
  const accessColor = { admin:C.red, manager:"#8b5cf6", standard:C.blue, limited:C.dim };

  return (
    <div>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:20}}>
        <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:22,letterSpacing:"0.06em",color:C.text}}>
          TEAM MEMBERS
        </div>
        <button onClick={newUser}
          style={{background:C.accent,border:"none",borderRadius:9,color:"#000",
            fontWeight:700,padding:"8px 18px",fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>
          + Add Person
        </button>
      </div>

      <div style={{fontSize:11,color:C.dim,marginBottom:16,lineHeight:1.5}}>
        <strong>Title</strong> = field role (appears on home screen cards) &nbsp;·&nbsp;
        <strong>Access</strong> = what they can see and do in the app
      </div>

      <div style={{display:"flex",flexDirection:"column",gap:10}}>
        {list.map(u=>{
          const isEditing = editing===u.id;
          const access    = getAccess(u);
          const title     = u.title || (["admin","justin","jeromy"].includes(u.role) ? "admin" : ["foreman","lead","crew"].includes(u.role) ? u.role : "crew");
          return (
            <div key={u.id} style={{background:C.card,border:`1px solid ${isEditing?C.accent:C.border}`,
              borderRadius:12,padding:"14px 16px",transition:"border-color 0.15s",
              borderLeft:`3px solid ${accessColor[access]||C.dim}`}}>
              {isEditing ? (
                <div style={{display:"flex",flexDirection:"column",gap:12}}>
                  {/* Name */}
                  <div>
                    <div style={{fontSize:10,color:C.dim,marginBottom:4,fontWeight:700,letterSpacing:"0.08em"}}>FULL NAME</div>
                    <input value={u.name} onChange={e=>upd(u.id,{name:e.target.value})}
                      placeholder="First and last name…"
                      style={{width:"100%",background:C.surface,border:`1px solid ${C.border}`,
                        borderRadius:7,color:C.text,padding:"8px 10px",fontSize:13,
                        fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}/>
                  </div>
                  {/* Title + Access */}
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                    <div>
                      <div style={{fontSize:10,color:C.dim,marginBottom:4,fontWeight:700,letterSpacing:"0.08em"}}>TITLE</div>
                      <select value={title} onChange={e=>upd(u.id,{title:e.target.value})}
                        style={{width:"100%",background:C.surface,border:`1px solid ${C.border}`,
                          borderRadius:7,color:C.text,padding:"8px 10px",fontSize:13,
                          fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}>
                        {TITLE_OPTIONS.map(t=><option key={t} value={t}>{TITLE_LABELS[t]}</option>)}
                      </select>
                      <div style={{fontSize:10,color:C.muted,marginTop:3}}>Field role — which card group they appear in</div>
                    </div>
                    <div>
                      <div style={{fontSize:10,color:C.dim,marginBottom:4,fontWeight:700,letterSpacing:"0.08em"}}>ACCESS LEVEL</div>
                      <select value={access} onChange={e=>upd(u.id,{access:e.target.value})}
                        style={{width:"100%",background:C.surface,border:`1px solid ${accessColor[access]||C.border}44`,
                          borderRadius:7,color:accessColor[access]||C.text,padding:"8px 10px",fontSize:13,
                          fontWeight:700,fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}>
                        {ACCESS_OPTIONS.map(a=><option key={a} value={a} style={{color:C.text,fontWeight:400}}>{ACCESS_LABELS[a]}</option>)}
                      </select>
                      <div style={{fontSize:10,color:C.muted,marginTop:3}}>What they can see and do</div>
                    </div>
                  </div>
                  {/* Access description */}
                  <div style={{fontSize:11,color:C.dim,background:C.surface,borderRadius:8,padding:"8px 12px",
                    border:`1px solid ${accessColor[access]||C.border}33`}}>
                    {access==="admin"    && "Full access — everything including delete jobs and manage team"}
                    {access==="manager"  && "Everything except delete jobs — can manage settings and pipeline"}
                    {access==="standard" && "Can view all cards, add tasks, see schedule and pipeline (no manage)"}
                    {access==="limited"  && "Home screen and job editing only — no settings, pipeline, or tasks"}
                  </div>
                  {/* PIN */}
                  <div>
                    <div style={{fontSize:10,color:C.dim,marginBottom:4,fontWeight:700,letterSpacing:"0.08em"}}>PIN (4 digits)</div>
                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                      <input
                        type={showPin[u.id]?"text":"password"}
                        value={u.pin||""}
                        onChange={e=>{ const v=e.target.value.replace(/\D/g,"").slice(0,4); upd(u.id,{pin:v}); }}
                        placeholder="e.g. 1234" maxLength={4}
                        style={{width:100,background:C.surface,border:`1px solid ${C.border}`,
                          borderRadius:7,color:C.text,padding:"7px 10px",fontSize:13,
                          fontFamily:"inherit",outline:"none",letterSpacing:"0.2em"}}/>
                      <button onClick={()=>setShowPin(s=>({...s,[u.id]:!s[u.id]}))}
                        style={{background:"none",border:`1px solid ${C.border}`,borderRadius:7,
                          color:C.dim,fontSize:11,padding:"6px 10px",cursor:"pointer",fontFamily:"inherit"}}>
                        {showPin[u.id]?"Hide":"Show"}
                      </button>
                    </div>
                    <div style={{fontSize:10,color:C.muted,marginTop:4}}>Leave blank for no PIN required</div>
                  </div>
                  <div style={{display:"flex",gap:8,marginTop:4}}>
                    <button onClick={save}
                      style={{background:C.accent,border:"none",borderRadius:8,color:"#000",
                        fontWeight:700,padding:"8px 18px",fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>
                      Save
                    </button>
                    <button onClick={()=>setEditing(null)}
                      style={{background:"none",border:`1px solid ${C.border}`,borderRadius:8,
                        color:C.dim,padding:"8px 14px",fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>
                      Cancel
                    </button>
                    {u.id!=="koy"&&(
                      <button onClick={()=>del(u.id)}
                        style={{background:"none",border:"none",color:"#dc2626",fontSize:12,
                          cursor:"pointer",fontFamily:"inherit",marginLeft:"auto"}}>
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                  <div style={{display:"flex",alignItems:"center",gap:12}}>
                    <div style={{width:36,height:36,borderRadius:"50%",
                      background:`${accessColor[access]||C.dim}22`,
                      display:"flex",alignItems:"center",justifyContent:"center",
                      fontSize:14,fontWeight:700,color:accessColor[access]||C.dim}}>
                      {u.name?u.name[0].toUpperCase():"?"}
                    </div>
                    <div>
                      <div style={{fontSize:14,fontWeight:600,color:C.text}}>{u.name||"Unnamed"}</div>
                      <div style={{fontSize:11,color:C.dim,display:"flex",gap:8,alignItems:"center",marginTop:2}}>
                        <span style={{background:`${accessColor[access]||C.dim}15`,color:accessColor[access]||C.dim,
                          borderRadius:99,padding:"1px 8px",fontSize:10,fontWeight:700}}>
                          {ACCESS_LABELS[access]||access}
                        </span>
                        <span>{TITLE_LABELS[title]||title}</span>
                        <span style={{color:C.muted}}>PIN: {u.pin?"••••":"not set"}</span>
                      </div>
                    </div>
                  </div>
                  <button onClick={()=>setEditing(u.id)}
                    style={{background:"none",border:`1px solid ${C.border}`,borderRadius:8,
                      color:C.dim,fontSize:12,padding:"6px 14px",cursor:"pointer",fontFamily:"inherit"}}>
                    Edit
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Legacy auth stubs removed — identity system replaced them


const blankJob = () => ({

  id:uid(), name:"", address:"", gc:"", phone:"", simproNo:"", foreman:"Koy", lead:"", flagged:false, flagNote:"",

  planLink:"", redlineLink:"", lightingLink:"", panelLink:"", qcLink:"", matterportLink:"", matterportLinks:[], driveFolderId:"",

  uploadedFiles:[],

  prepStage:"", roughStage:"0%", finishStage:"0%", roughScheduled:false, finishScheduled:false, roughScheduledDate:"", finishScheduledDate:"", prepStartDate:"", finishStartDate:"", roughQuestions:{ upper:[], main:[], basement:[] },

  roughPunch:emptyPunch(), roughMaterials:[], roughUpdates:[], roughNotes:"",

  qcPunch:emptyPunch(),

  finishPunch:emptyPunch(), finishMaterials:[], finishUpdates:[], finishNotes:"",

  finishQuestions:{ upper:[], main:[], basement:[] },

  changeOrders:[], returnTrips:[], roughStatus:"", roughStatusDate:"", roughScheduledEnd:"", roughProjectedStart:"", finishStatus:"", finishStatusDate:"", finishScheduledEnd:"", finishProjectedStart:"", qcStatus:"", qcStatusDate:"", qcSignedOff:false, qcSignedOffBy:"", qcSignedOffDate:"", roughQCTaskFired:false, roughStartConfirmed:false, finishStartConfirmed:false, roughNeedsHardDate:false, roughNeedsByStart:"", roughNeedsByEnd:"", finishNeedsHardDate:false, finishNeedsByStart:"", finishNeedsByEnd:"", readyToSchedule:false, readyToInvoice:false, invoiceDismissed:false, taskDueDates:{}, roughOnHold:false, finishOnHold:false, tempPed:false, hasTempPed:false, tempPedNumber:"", tempPedStatus:"", tempPedScheduledDate:"",

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


const blankQuickJob = (type = "service") => ({
  id: uid(), name: "", address: "", gc: "", phone: "", simproNo: "",
  foreman: "Koy", lead: "", flagged: false, flagNote: "",
  quickJob: true,
  quickJobType: type,
  quickJobStatus: "new",
  quickJobDate: "",
  quickJobEndDate: "",
  scope: "",
  material: "",
  notes: "",
  photos: [],
  signedOff: false, signedOffBy: "", signedOffDate: "",
  readyToInvoice: false, invoiceDismissed: false, invoiceSent: false,
  readyToInvoiceDate: "",
  accessNote: "",
  taskDueDates: {},
  changeOrders: [], returnTrips: [],
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

    borderBottom:`2px solid ${color}44`,paddingBottom:7,marginBottom:14,marginTop:8}}>

    <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:20,letterSpacing:"0.08em",color}}>{label}</div>

    {action&&<div style={{display:"flex",gap:6}}>{action}</div>}

  </div>

);


// Collapsible section wrapper — collapsed by default

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

// Time ago helper for "updated X ago" display
const timeAgo = (isoStr) => {
  if(!isoStr) return "";
  const d = new Date(isoStr);
  if(isNaN(d.getTime())) return "";
  const mins = Math.floor((Date.now()-d.getTime())/60000);
  if(mins < 1) return "just now";
  if(mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins/60);
  if(hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs/24);
  if(days < 7) return `${days}d ago`;
  return d.toLocaleDateString("en-US",{month:"short",day:"numeric"});
};

// Convert any date string (MM/DD/YY, MM/DD/YYYY) to YYYY-MM-DD for type="date" inputs
const toYMD = (str) => {
  if(!str) return "";
  if(/^\d{4}-\d{2}-\d{2}$/.test(str)) return str; // already YYYY-MM-DD
  const m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if(!m) return "";
  let [,mo,dy,yr] = m;
  if(yr.length===2) yr="20"+yr;
  return `${yr}-${mo.padStart(2,"0")}-${dy.padStart(2,"0")}`;
};

// Format any date string for display as M/D/YYYY
const fmtDisplay = (str) => {
  if(!str) return "";
  // Already M/D/YYYY or M/D/YY
  if(/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(str)) return str;
  // YYYY-MM-DD → M/D/YYYY
  const m = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(m) return `${parseInt(m[2])}/${parseInt(m[3])}/${m[1]}`;
  return str;
};

// DateInp — always a calendar date picker, same styling as Inp
const DateInp = ({value,onChange,style={}}) => (
  <input type="date" value={toYMD(value)} onChange={e=>{
    // Convert YYYY-MM-DD from browser to M/D/YYYY for storage
    const ymd = e.target.value;
    const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const display = m ? `${parseInt(m[2])}/${parseInt(m[3])}/${m[1]}` : ymd;
    onChange({...e, target:{...e.target, value: display}});
  }}
    style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:7,color:C.text,
      padding:"6px 10px",fontSize:12,fontFamily:"inherit",width:"100%",outline:"none",
      colorScheme:"light",...style}}
    onFocus={e=>e.target.style.borderColor=C.accent}
    onBlur={e=>e.target.style.borderColor=C.border}/>
);


const Sel = ({value,onChange,options:rawOpts,style={}}) => {
  const opts = rawOpts || [];
  // Case-insensitive value matching: find the option that matches ignoring case
  const raw = (value ?? "").toString();
  const matched = opts.find(o => {
    if(o == null) return false;
    const ov = (o.value ?? o ?? "").toString();
    return ov === raw || ov.toLowerCase() === raw.toLowerCase();
  });
  const resolved = matched ? (matched.value ?? matched) : raw;
  return (
    <select value={resolved} onChange={onChange}
      style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:7,color:C.text,
        padding:"6px 10px",fontSize:12,fontFamily:"inherit",outline:"none",width:"100%",...style}}>
      {opts.filter(o=>o!=null).map(o=><option key={o.value??o} value={o.value??o}>{o.label??o}</option>)}
    </select>
  );
};


const TA = ({value,onChange,placeholder,rows=3}) => (

  <textarea value={value??""} onChange={onChange} placeholder={placeholder} rows={rows}

    style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:7,color:C.text,

      padding:"7px 10px",fontSize:12,fontFamily:"inherit",width:"100%",outline:"none",resize:"vertical"}}

    onFocus={e=>e.target.style.borderColor=C.accent}

    onBlur={e=>e.target.style.borderColor=C.border}/>

);


// Clickable address that opens in Google Maps or Apple Maps (user choice)
const AddressLink = ({address, children, style={}}) => {
  if(!address) return null;
  const encoded = encodeURIComponent(address);
  const googleUrl = `https://www.google.com/maps/search/?api=1&query=${encoded}`;
  const appleUrl = `https://maps.apple.com/?q=${encoded}`;
  const handleClick = (e) => {
    e.stopPropagation();
    // On iOS/macOS Safari, Apple Maps is native; elsewhere default to Google
    const isApple = /iPad|iPhone|iPod|Macintosh/.test(navigator.userAgent);
    if(isApple) {
      const choice = window.confirm("Open in Apple Maps?\n\nOK = Apple Maps\nCancel = Google Maps");
      window.open(choice ? appleUrl : googleUrl, "_blank");
    } else {
      window.open(googleUrl, "_blank");
    }
  };
  return (
    <span onClick={handleClick} style={{cursor:"pointer",textDecoration: children ? "none" : "underline",textDecorationStyle:"dotted",textUnderlineOffset:2,...style}}>
      {children || <>{address} <span style={{fontSize:10,opacity:0.7}}>📍</span></>}
    </span>
  );
};

const Btn = ({onClick,children,variant="ghost",style={}}) => {

  const vs = {

    ghost:  {background:"none",border:`1px solid ${C.border}`,color:C.dim},

    primary:{background:C.accent,border:"none",color:"#000",fontWeight:700},

    add:    {background:`${C.green}15`,border:`1px dashed ${C.green}55`,color:C.green},

    email:  {background:"none",border:`1px solid ${C.blue}55`,color:C.blue},
    chat:   {background:"none",border:`1px solid #25d36655`,color:"#25d366"},
    simpro: {background:"none",border:`1px solid #f9731655`,color:"#f97316"},

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

  // interpolate red(0%) -> yellow(50%) -> green(100%)

  const r = pct < 50 ? 220 : Math.round(220 - (pct-50)/50 * 186);

  const g = pct < 50 ? Math.round(40 + (pct/50) * 175) : 215;

  const b = 40;

  const barColor = isScheduled ? "#f97316" : `rgb(${r},${g},${b})`;

  return (

    <div style={{display:"flex",gap:6,alignItems:"center"}}>

      <div style={{flex:1,height:5,background:C.border,borderRadius:99,overflow:"hidden"}}>

        <div style={{height:"100%",width:isScheduled?"100%":`${pct}%`,background:isScheduled?"rgba(249,115,22,0.25)":barColor,borderRadius:99,transition:"width 0.4s, background 0.4s"}}/>

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

                borderRadius: 4, padding: '2px 4px',

                transition: 'background 0.1s' }}

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

  // Extra custom floors stored as punch.extras = [{key, label}]
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
          <PunchFloor
            floorKey={e.key}
            floorData={normFloor(punch[e.key])}
            onFloorChange={handleFloorChange}
            floorLabel={e.label}
            floorColor={FLOOR_COLORS[i % FLOOR_COLORS.length]}/>
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
        <Btn onClick={()=>setAddingFloor(true)} variant="add"
          style={{fontSize:11,padding:"4px 12px",marginTop:8}}>
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

  const [d,setD]           = useState({date:"",text:""});

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

          <Btn onClick={handleEmail} variant="primary" style={{fontSize:11,padding:"4px 10px"}}>

            Send ({selected.length})

          </Btn>

        )}

        {showPicker&&selected.length===0&&(

          <Btn onClick={handleEmail} variant="primary" style={{fontSize:11,padding:"4px 10px"}}>

            Send Last 5

          </Btn>

        )}

      </div>

      <div style={{display:"grid",gridTemplateColumns:"130px 1fr auto",gap:8,marginBottom:12,alignItems:"flex-end"}}>

        <div>

          <div style={{fontSize:10,color:C.dim,marginBottom:3}}>Date of Update</div>

          <DateInp value={d.date} onChange={e=>setD(p=>({...p,date:e.target.value}))}/>

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

          style={{display:"flex",gap:10,padding:"8px 12px",background:showPicker&&selected.includes(u.id)?C.blue+"18":C.surface,

            borderRadius:8,marginBottom:6,border:`1px solid ${showPicker&&selected.includes(u.id)?C.blue:C.border}`,

            cursor:showPicker?"pointer":"default",transition:"all 0.15s"}}>

          {showPicker&&(

            <div style={{width:16,height:16,borderRadius:4,border:`2px solid ${selected.includes(u.id)?C.blue:C.border}`,

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

function ChangeOrders({orders, onChange, jobName, jobSimproNo, onEmail, roughStatus, finishStatus}) {

  const add = () => onChange([...orders, {
    id:uid(), date:"", desc:"", task:"", material:"", time:"", sendTo:"",
    coStatus:"needs_sending", coStatusDate:"",
    needsHardDate:false, needsByStart:"", needsByEnd:"",
  }]);

  const upd = (id, p) => onChange(orders.map(o => o.id===id ? {...o,...p} : o));
  const del = (id)    => onChange(orders.filter(o => o.id!==id));

  const crewOnSite = roughStatus==="inprogress" || finishStatus==="inprogress";

  const chatCO = (o, i) => {
    const msg = `Change Order #${i+1} — ${jobName}\n\nDescription: ${o.desc||"—"}\nTask: ${o.task||"—"}\nMaterial: ${o.material||"—"}\nEstimated Time: ${o.time||"—"}\nSend To: ${o.sendTo||"—"}\nStatus: ${o.coStatus||"Pending"}\n\nhttps://homestead-electric.vercel.app/`;
    openGoogleChat(msg);
  };

  const emailCO = (o, i) => {
    const subject = `${jobName} — Change Order #${i+1}`;
    const body = `Change Order #${i+1} — ${jobName}\n\nDate: ${o.date||"—"}\nSend CO To: ${o.sendTo||"—"}\nDescription: ${o.desc||"—"}\nTask: ${o.task||"—"}\nMaterial Needed: ${o.material||"—"}\nEstimated Time: ${o.time||"—"}\nStatus: ${o.coStatus||"Pending"}\n\nPlease review and confirm.\n\nThanks\n\nView job board: https://homestead-electric.vercel.app/`;
    onEmail({subject, body});
  };

  // Convert CO → Return Trip
  const convertToRT = (o, i) => {
    // Mark CO as converted
    upd(o.id, {coStatus:"converted"});
    // Build a new return trip pre-filled from CO data
    const newRT = {
      id: uid(),
      scope: o.desc||"",
      task: o.task||"",
      material: o.material||"",
      time: o.time||"",
      assignedTo: "",
      rtStatus: "needs",
      rtStatusDate: "",
      needsHardDate: o.needsHardDate||false,
      needsByStart: o.needsByStart||"",
      needsByEnd: o.needsByEnd||"",
      notes: `Converted from Change Order #${i+1}${o.desc?" — "+o.desc:""}`,
      punch: [],
      photos: [],
    };
    // We signal the parent to add the RT — pass via a special onChange shape
    onChange(orders.map(co => co.id===o.id ? {...co, coStatus:"converted"} : co), newRT, true); // true = add to top
  };

  return (
    <div>
      {orders.map((o, i) => {
        const coDef = getStatusDef(CO_STATUSES_NEW, o.coStatus||"pending");
        const isConverted = o.coStatus === "converted";
        const isApproved  = o.coStatus === "approved";
        const showConvert = (isApproved || o.coStatus==="needs") && !crewOnSite;

        return (
          <div key={o.id} style={{
            background: isConverted ? "var(--surface)" : "var(--card)",
            border:`1px solid ${isConverted?"var(--border)":coDef.color?coDef.color+"33":"var(--border)"}`,
            borderLeft:`3px solid ${isConverted?"#6b7280":coDef.color||"var(--border)"}`,
            borderRadius:11, padding:14, marginBottom:12,
            opacity: isConverted ? 0.6 : 1,
          }}>

            {/* Header */}
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10,flexWrap:"wrap",gap:8}}>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <span style={{fontSize:12,color:"var(--accent)",fontWeight:700}}>Change Order #{i+1}</span>
                {isConverted&&<span style={{fontSize:10,fontWeight:700,color:"#6b7280",background:"#6b728018",borderRadius:99,padding:"2px 8px",border:"1px solid #6b728033"}}>CONVERTED TO RT</span>}
              </div>
              <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
                {!isConverted&&jobSimproNo&&<Btn onClick={()=>{
                  const msg=`Change Order #${i+1} — ${jobName}\n\nDescription: ${o.desc||"—"}\nTask: ${o.task||"—"}\nMaterial: ${o.material||"—"}\nEstimated Time: ${o.time||"—"}\nSend To: ${o.sendTo||"—"}\nStatus: ${o.coStatus||"Pending"}`;
                  navigator.clipboard.writeText(msg).catch(()=>{});
                  window.open(`https://homesteadelectric.simprosuite.com/staff/editProject.php?jobID=${jobSimproNo}`,"_blank");
                }} variant="simpro" style={{fontSize:11,padding:"3px 9px"}}>Simpro</Btn>}
                {!isConverted&&<Btn onClick={()=>chatCO(o,i)} variant="chat" style={{fontSize:11,padding:"3px 9px"}}>Chat</Btn>}
                {!isConverted&&<Btn onClick={()=>emailCO(o,i)} variant="email" style={{fontSize:11,padding:"3px 9px"}}>Email CO</Btn>}
                <button onClick={()=>del(o.id)} style={{background:"none",border:"none",color:"var(--muted)",cursor:"pointer",fontSize:11}}>Remove</button>
              </div>
            </div>

            {/* Status row */}
            {!isConverted&&(
              <div style={{marginBottom:10}}>

                {/* Status pill buttons */}
                <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:10}}>
                  {CO_STATUSES_NEW.filter(s=>s.value!=="converted").map(s=>{
                    const active = (o.coStatus||"needs_sending")===s.value;
                    return (
                      <button key={s.value} onClick={()=>{
                        const patch={coStatus:s.value};
                        if(!getStatusDef(CO_STATUSES_NEW,s.value).hasDate) patch.coStatusDate="";
                        // Switching away from approved clears the schedule window
                        if(s.value!=="approved"&&s.value!=="scheduled") { patch.needsByStart=""; patch.needsByEnd=""; patch.needsHardDate=false; }
                        upd(o.id,patch);
                      }} style={{
                        padding:"4px 12px",fontSize:11,fontWeight:active?700:500,
                        borderRadius:99,border:`1px solid ${active?s.color:"var(--border)"}`,
                        background:active?`${s.color}22`:"none",
                        color:active?s.color:"var(--dim)",cursor:"pointer",fontFamily:"inherit",
                        transition:"all 0.15s",
                      }}>{s.label}</button>
                    );
                  })}
                </div>

                {/* Needs to be Sent — due date */}
                {(o.coStatus||"needs_sending")==="needs_sending"&&(
                  <div style={{padding:"8px 12px",borderRadius:8,marginBottom:8,
                    background:"#dc262608",border:"1px solid #dc262633"}}>
                    <div style={{fontSize:9,fontWeight:700,color:"#dc2626",letterSpacing:"0.08em",marginBottom:6}}>SEND BY DATE</div>
                    <DateInp value={o.coStatusDate||""} onChange={e=>upd(o.id,{coStatusDate:e.target.value})}
                      style={{width:140,fontSize:11,borderColor:"#dc262655",background:"#dc262608"}}/>
                  </div>
                )}

                {/* Scheduled date picker */}
                {o.coStatus==="scheduled"&&(
                  <div style={{padding:"8px 12px",borderRadius:8,marginBottom:8,
                    background:"#2563eb08",border:"1px solid #2563eb33"}}>
                    <div style={{fontSize:9,fontWeight:700,color:"#2563eb",letterSpacing:"0.08em",marginBottom:6}}>SCHEDULED DATE</div>
                    <DateInp value={o.coStatusDate||""} onChange={e=>upd(o.id,{coStatusDate:e.target.value})}
                      style={{width:140,fontSize:11,borderColor:"#2563eb55",background:"#2563eb08"}}/>
                  </div>
                )}

                {/* Approved — branch on crew on site */}
                {isApproved&&(
                  <div style={{padding:"10px 12px",borderRadius:8,marginBottom:8,
                    background:crewOnSite?"#16a34a08":"#f9731608",
                    border:`1px solid ${crewOnSite?"#16a34a33":"#f9731633"}`}}>
                    {crewOnSite?(
                      <>
                        <div style={{fontSize:11,fontWeight:700,color:"#16a34a",marginBottom:8}}>
                          ✓ Crew is on site — mark work complete when done
                        </div>
                        <button onClick={()=>upd(o.id,{coStatus:"completed",needsByStart:"",needsByEnd:"",needsHardDate:false})}
                          style={{background:"#16a34a",border:"none",borderRadius:8,color:"#fff",
                            fontSize:11,fontWeight:700,padding:"7px 16px",cursor:"pointer",fontFamily:"inherit"}}>
                          ✓ Mark Work Completed
                        </button>
                      </>
                    ):(
                      <>
                        <div style={{fontSize:11,fontWeight:700,color:"#f97316",marginBottom:6}}>
                          ⚠ Crew not on site — convert to Return Trip to schedule
                        </div>
                        <button onClick={()=>convertToRT(o,i)} style={{
                          background:"#8b5cf618",border:"1px solid #8b5cf633",
                          borderRadius:8,color:"#8b5cf6",fontSize:11,fontWeight:700,
                          padding:"7px 14px",cursor:"pointer",fontFamily:"inherit",
                          display:"flex",alignItems:"center",gap:6,
                        }}>
                          🔄 Convert to Return Trip
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Converted note + undo */}
            {isConverted&&(
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,marginBottom:8,flexWrap:"wrap"}}>
                <div style={{fontSize:11,color:"#6b7280",fontStyle:"italic"}}>
                  Converted to Return Trip — see Return Trips tab.
                </div>
                <button onClick={()=>upd(o.id,{coStatus:"approved"})}
                  style={{background:"none",border:"1px solid #ca8a0455",borderRadius:7,
                    color:"#ca8a04",fontSize:11,padding:"4px 10px",cursor:"pointer",
                    fontFamily:"inherit",fontWeight:600,whiteSpace:"nowrap"}}>
                  ↩ Undo Convert
                </button>
              </div>
            )}

            {/* Fields — hidden when converted */}
            {!isConverted&&(
              <>
                <div style={{marginBottom:8}}>
                  <div style={{fontSize:10,color:"var(--dim)",marginBottom:3}}>Send CO To</div>
                  <Inp value={o.sendTo||""} onChange={e=>upd(o.id,{sendTo:e.target.value})} placeholder="e.g. John Smith / GC / Homeowner…"/>
                </div>
                <div style={{marginBottom:8}}>
                  <div style={{fontSize:10,color:"var(--dim)",marginBottom:3}}>Description of Task</div>
                  <Inp value={o.desc||""} onChange={e=>upd(o.id,{desc:e.target.value})} placeholder="Describe the change order…"/>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:8}}>
                  <div>
                    <div style={{fontSize:10,color:"var(--dim)",marginBottom:3}}>Estimated Time</div>
                    <Inp value={o.time||""} onChange={e=>upd(o.id,{time:e.target.value})} placeholder="e.g. 3 hrs"/>
                  </div>
                  <div>
                    <div style={{fontSize:10,color:"var(--dim)",marginBottom:3}}>Task (In Field)</div>
                    <TA value={o.task||""} onChange={e=>upd(o.id,{task:e.target.value})} placeholder={"- Task 1\n- Task 2"} rows={3}/>
                  </div>
                  <div>
                    <div style={{fontSize:10,color:"var(--dim)",marginBottom:3}}>Material Needed</div>
                    <TA value={o.material||""} onChange={e=>upd(o.id,{material:e.target.value})} placeholder={"- Item 1\n- Item 2"} rows={3}/>
                  </div>
                </div>
              </>
            )}
          </div>
        );
      })}

      <Btn onClick={add} variant="ghost" style={{marginTop:4}}>+ Add Change Order</Btn>
    </div>
  );
}

// ── Return Trips ──────────────────────────────────────────────

function ReturnTrips({trips,onChange,jobName,jobSimproNo,onEmail,jobId}) {

  const [viewPhoto, setViewPhoto] = useState(null);

  const add = () => onChange([...trips, {id:uid(),date:"",scope:"",material:"",punch:[],photos:[],assignedTo:"",signedOff:false,signedOffBy:"",signedOffDate:"",needsSchedule:false,needsScheduleDate:"",rtScheduled:false,scheduledDate:""}]);

  const upd = (id,p) => onChange(trips.map(t=>t.id===id?{...t,...p}:t));

  const del = (id)   => onChange(trips.filter(t=>t.id!==id));


  const chatTrip = (t,i) => {
    const punchOpen = (t.punch||[]).filter(p=>!p.done).map(p=>`• ${p.text}`).join("\n") || "None";
    const msg = `Return Trip #${i+1} — ${jobName}\n\nScope of Work: ${t.scope||"—"}\nMaterial Needed: ${t.material||"—"}\nOpen Punch Items:\n${punchOpen}\nAssigned To: ${t.assignedTo||"—"}\n\nhttps://homestead-electric.vercel.app/`;
    openGoogleChat(msg);
  };

  const emailTrip = (t,i) => {

    const punchLines = (t.punch||[]).filter(p=>!p.done).map(p=>`• ${p.text}`).join("\n") || "None";

    const subject = `${jobName} — Return Trip #${i+1}`;

    const body = `Return Trip #${i+1} — ${jobName}\n\nDate: ${t.date||"—"}\nScope of Work:\n${t.scope||"—"}\n\nMaterial Needed:\n${t.material||"—"}\n\nPunch List:\n${punchLines}\n\nThanks\n\nView job board: https://homestead-electric.vercel.app/`;

    onEmail({subject, body});

  };


  const [uploading, setUploading] = useState(false);

  const addPhotos = async (id, files) => {
    if(!jobId) { alert("Cannot upload photos — job ID missing. Save the job first."); return; }
    const trip = trips.find(t=>t.id===id);
    const existing = trip?.photos||[];
    const newPhotos = [];
    setUploading(true);

    for(const file of Array.from(files)) {
      try {
        const photoId = uid();
        const ext = file.name.split(".").pop() || "jpg";
        const storagePath = `jobs/${jobId}/rt-photos/${id}/${photoId}.${ext}`;
        const storageRef = ref(storage, storagePath);
        await uploadBytes(storageRef, file);
        const url = await getDownloadURL(storageRef);
        newPhotos.push({id:photoId, name:file.name, url, storagePath});
      } catch(e) {
        console.error("RT photo upload failed:", e);
        alert(`Failed to upload ${file.name}. Check connection.`);
      }
    }

    if(newPhotos.length > 0) {
      upd(id, {photos:[...existing, ...newPhotos]});
    }
    setUploading(false);
  };

  const deletePhoto = async (tripId, photo) => {
    // Delete from Firebase Storage if it has a storagePath (new photos)
    if(photo.storagePath) {
      try { await deleteObject(ref(storage, photo.storagePath)).catch(()=>{}); } catch(e){}
    }
    const trip = trips.find(t=>t.id===tripId);
    upd(tripId, {photos:(trip?.photos||[]).filter(x=>x.id!==photo.id)});
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
              <span style={{fontSize:12,color:C.purple,fontWeight:700}}>Return Trip</span>
              {!t.signedOff&&(
                <>
                  {(()=>{
                    const rtDef = getStatusDef(RT_STATUSES, t.rtStatus||"");
                    return (
                      <>
                      <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                        <select value={t.rtStatus||""} onChange={e=>{
                          const v=e.target.value;
                          const patch={rtStatus:v,rtScheduled:v==="scheduled",needsSchedule:v==="needs",
                            rtStatusDate:getStatusDef(RT_STATUSES,v).hasDate?t.rtStatusDate:""};
                          if(v==="scheduled") { patch.needsByStart=""; patch.needsByEnd=""; patch.needsHardDate=false; }
                          upd(t.id,patch);
                        }} style={{background:rtDef.color?`${rtDef.color}18`:C.surface,
                          color:rtDef.color||C.dim,border:`1px solid ${rtDef.color||C.border}`,
                          borderRadius:7,padding:"5px 8px",fontSize:11,fontFamily:"inherit",
                          fontWeight:rtDef.color?700:400,outline:"none",cursor:"pointer"}}>
                          {RT_STATUSES.map(s=><option key={s.value} value={s.value}>{s.label}</option>)}
                        </select>
                        {rtDef.hasDate&&(
                          <div style={{display:"flex",flexDirection:"column",gap:2}}>
                            <div style={{fontSize:9,fontWeight:700,letterSpacing:"0.07em",color:rtDef.color}}>
                              {t.rtStatus==="needs"?"WORK TO BE COMPLETED BY":"SCHEDULED DATE"}
                            </div>
                            <DateInp value={t.rtStatusDate||""} onChange={e=>upd(t.id,{rtStatusDate:e.target.value})}
                              style={{width:140,fontSize:11,borderColor:rtDef.color+"55",background:`${rtDef.color}08`}}/>
                          </div>
                        )}
                      </div>
                
                      </>
                    );
                  })()}
                </>
              )}
            </div>

            <div style={{display:"flex",gap:8}}>

              {jobSimproNo&&<Btn onClick={()=>{
                const punchOpen=(t.punch||[]).filter(p=>!p.done).map(p=>`• ${p.text}`).join("\n")||"None";
                const msg=`Return Trip #${i+1} — ${jobName}\n\nScope of Work: ${t.scope||"—"}\nMaterial Needed: ${t.material||"—"}\nOpen Punch Items:\n${punchOpen}\nAssigned To: ${t.assignedTo||"—"}`;
                navigator.clipboard.writeText(msg).catch(()=>{});
                window.open(`https://homesteadelectric.simprosuite.com/staff/editProject.php?jobID=${jobSimproNo}`,"_blank");
              }} variant="simpro" style={{fontSize:11,padding:"3px 9px"}}>Simpro</Btn>}
              <Btn onClick={()=>chatTrip(t,i)} variant="chat" style={{fontSize:11,padding:"3px 9px"}}>Chat</Btn>
              <Btn onClick={()=>emailTrip(t,i)} variant="email" style={{fontSize:11,padding:"3px 9px"}}>Email Trip</Btn>

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

                    <img src={p.url||p.dataUrl} alt={p.name}

                      onClick={()=>setViewPhoto(p.url||p.dataUrl)}

                      style={{width:"100%",aspectRatio:"1",objectFit:"cover",borderRadius:8,

                        border:`1px solid ${C.border}`,cursor:"pointer"}}/>

                    <button onClick={()=>deletePhoto(t.id,p)}

                      style={{position:"absolute",top:3,right:3,background:"rgba(0,0,0,0.7)",

                        border:"none",borderRadius:"50%",color:"#fff",width:20,height:20,

                        cursor:"pointer",fontSize:11,display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>

                  </div>

                ))}

              </div>

            )}

            {uploading&&<div style={{fontSize:11,color:C.accent,fontWeight:600,marginBottom:8,
              padding:"6px 10px",background:`${C.accent}12`,border:`1px solid ${C.accent}33`,
              borderRadius:7}}>⏳ Uploading photos...</div>}

            <div style={{display:"flex",gap:6}}>
              <label style={{display:"flex",alignItems:"center",gap:8,padding:"8px 12px",
                background:`${C.purple}12`,border:`1px dashed ${C.purple}55`,borderRadius:8,
                cursor:uploading?"not-allowed":"pointer",opacity:uploading?0.5:1,
                fontSize:12,color:C.purple,fontWeight:600}}>
                📷 Add Photos
                <input type="file" accept="image/*" multiple style={{display:"none"}}
                  disabled={uploading}
                  onChange={e=>{addPhotos(t.id,e.target.files);e.target.value="";}}/>
              </label>
              <label style={{display:"flex",alignItems:"center",gap:8,padding:"8px 12px",
                background:`${C.teal}12`,border:`1px dashed ${C.teal}55`,borderRadius:8,
                cursor:uploading?"not-allowed":"pointer",opacity:uploading?0.5:1,
                fontSize:12,color:C.teal,fontWeight:600}}>
                📸 Take Photo
                <input type="file" accept="image/*" capture="environment" style={{display:"none"}}
                  disabled={uploading}
                  onChange={e=>{addPhotos(t.id,e.target.files);e.target.value="";}}/>
              </label>
            </div>

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

                  <div style={{fontSize:10,color:C.dim,marginBottom:3}}>Date Signed Off</div>

                  <DateInp value={t.signedOffDate||""} onChange={e=>upd(t.id,{signedOffDate:e.target.value})}

                    style={{width:130}}/>

                </div>

                <button

                  onClick={()=>upd(t.id,{signedOff:true, rtStatus:"complete"})}

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

                  <span style={{fontSize:11,color:C.dim,marginLeft:10}}>{fmtDisplay(t.signedOffDate)}</span>

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

const HR_LEADS = ["","Keegan","Daegan","Gage","Abe","Louis","Jonathan","Braden","Treycen"];

const PANEL_ORDER_BASE = {"":0,"Meter":0.5,"Dedicated Loads":999};
const getPanelOpts = (customPanels) => ["","Meter",...(customPanels&&customPanels.length?customPanels:DEFAULT_PANELS),"Dedicated Loads"];
const getPanelOrder = (customPanels) => {
  const opts = getPanelOpts(customPanels);
  const order = {};
  opts.forEach((p,i)=>{ order[p]=i; });
  return order;
};

const WIRE_ORDER  = {"":0,"14/2":1,"14/3":2,"12/2":3,"12/3":4,"10/2":5,"10/3":6,"8/2":7,"8/3":8,"6/2":9,"6/3":10,"4/2":11,"4/3":12,"2/2":13,"2/3":14,"1/0":15,"2/0":16,"3/0":17,"4/0":18};


function HomeRunLevel({rows,onChange,label,customPanels}) {

  const panelOrder = getPanelOrder(customPanels);
  const sortRows = (arr) => [...arr].sort((a,b)=>{
    // Sort by wire size descending (larger wire first), then alphabetically by name
    const wd = (WIRE_ORDER[b.wire]||0)-(WIRE_ORDER[a.wire]||0);
    if(wd!==0) return wd;
    return (a.name||"").toLowerCase().localeCompare((b.name||"").toLowerCase());
  }).map((r,i)=>({...r,num:i+1}));

  const upd    = (id,p) => { const updated = rows.map(r=>r.id===id?{...r,...p}:r); onChange(('wire' in p||'panel' in p) ? sortRows(updated) : updated.map((r,i)=>({...r,num:i+1}))); };
  const addRow = () => onChange([...rows, newHRRow(rows.length+1)]);
  const delRow = (id) => onChange(sortRows(rows.filter(r=>r.id!==id)));


  const renderRow = (r, flatIdx) => (
    <div key={r.id}
      style={{marginBottom:6,paddingBottom:6,
        borderRadius:7,padding:"6px 4px",
        background:r.status==="Pulled"?"rgba(34,197,94,0.08)":r.status==="Need Specs"?"rgba(239,68,68,0.1)":"none",
        border:r.status==="Pulled"?`1px solid rgba(34,197,94,0.3)`:r.status==="Need Specs"?`1px solid rgba(239,68,68,0.3)`:`1px solid transparent`}}>
      {/* Row 1: drag handle, number, panel, wire, delete */}
      <div style={{display:"grid",gridTemplateColumns:"22px 1fr 80px 22px",gap:4,marginBottom:3,alignItems:"center"}}>
        <span style={{fontSize:10,color:C.muted,textAlign:"right"}}>{r.num}.</span>
        <select value={r.panel||""} onChange={e=>upd(r.id,{panel:e.target.value})}
          style={{background:C.surface,color:r.panel?C.accent:C.dim,border:`1px solid ${C.border}`,
            borderRadius:6,padding:"4px 5px",fontSize:10,fontFamily:"inherit",outline:"none",width:"100%"}}>
          {getPanelOpts(customPanels).map(o=><option key={o} value={o}>{o||"— panel —"}</option>)}
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

  // Flat list with indices for drag tracking
  const flatRows = rows.map((r,i)=>({r,i}));

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

      {flatRows.map(({r,i})=>renderRow(r,i))}
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

// ── Generator constants ───────────────────────────────────────
const GEN_SIZES_W = [7500, 10000, 14000, 20000, 22000, 24000, 26000];
const genRecommend = (w) => GEN_SIZES_W.find(s=>s>=w) || GEN_SIZES_W[GEN_SIZES_W.length-1];
const genFmtKw     = (w) => (w/1000).toFixed(1).replace(/\.0$/,'')+'kW';
const wireWatts    = (wire) => {
  const b=WIRE_BREAKER[wire]; if(!b) return 0;
  return b.poles===2 ? b.amps*240 : b.amps*120;
};


function BreakerCounts({homeRuns, panelCounts, onCountChange}) {

  const extraRows = (homeRuns.extraFloors||[]).flatMap(ef=>homeRuns[ef.key]||[]);

  const allRows = [

    ...(homeRuns.main||[]),

    ...(homeRuns.upper||[]),

    ...(homeRuns.basement||[]),

    ...extraRows,

  ];


  const panels = getPanelOpts(homeRuns.customPanels||DEFAULT_PANELS).filter(p=>p!==""&&p!=="Meter");


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

// ── Generator Load Section ────────────────────────────────────
function GeneratorLoadSection({ homeRuns, genLoads, onSave }) {
  // KEY FIX: local state so ★ toggle and checkboxes update instantly
  const [loads, setLoads] = useState(genLoads || []);
  const [dragIdx, setDragIdx] = useState(null);
  const [overIdx, setOverIdx] = useState(null);

  // Sync from parent only when genLoads identity changes (Firestore load)
  const prevRef = useRef(genLoads);
  useEffect(() => {
    if (genLoads !== prevRef.current) {
      prevRef.current = genLoads;
      setLoads(genLoads || []);
    }
  });

  const commit = (next) => { setLoads(next); onSave(next); };

  const importFromHR = () => {
    const rows = [
      ...(homeRuns.main||[]),
      ...(homeRuns.upper||[]),
      ...(homeRuns.basement||[]),
      ...(homeRuns.extraFloors||[]).flatMap(e=>homeRuns[e.key]||[]),
    ].filter(r=>(r.name||'').trim() && r.wire);
    const existing = new Set(loads.map(l=>l.name));
    const added = rows.filter(r=>!existing.has(r.name)).map(r=>({
      id: uid(), name: r.name, wire: r.wire,
      watts: wireWatts(r.wire), recommended: false, included: true,
    }));
    if (!added.length) { alert('No new named+wired loads to import.'); return; }
    commit([...loads, ...added]);
  };

  const toggle  = (id, key) => commit(loads.map(l=>l.id===id?{...l,[key]:!l[key]}:l));
  const updName = (id, name) => commit(loads.map(l=>l.id===id?{...l,name}:l));
  const updWire = (id, wire) => commit(loads.map(l=>l.id===id?{...l,wire,watts:wireWatts(wire)}:l));
  const updWatts= (id, watts) => commit(loads.map(l=>l.id===id?{...l,watts:parseFloat(watts)||0}:l));
  const del     = (id) => commit(loads.filter(l=>l.id!==id));
  const addRow  = () => commit([...loads,{id:uid(),name:'',wire:'',watts:0,recommended:false,included:true}]);

  const onDragStart = (i) => setDragIdx(i);
  const onDragOver  = (e,i) => { e.preventDefault(); setOverIdx(i); };
  const onDrop      = (i) => {
    if (dragIdx===null||dragIdx===i) { setDragIdx(null); setOverIdx(null); return; }
    const next=[...loads]; const [m]=next.splice(dragIdx,1); next.splice(i,0,m);
    commit(next); setDragIdx(null); setOverIdx(null);
  };


  return (
    <div>
      <div style={{display:'flex',gap:8,marginBottom:12,flexWrap:'wrap',alignItems:'center'}}>
        <button onClick={importFromHR}
          style={{background:`${C.blue}15`,border:`1px solid ${C.blue}44`,borderRadius:8,
            color:C.blue,fontSize:12,fontWeight:700,padding:'7px 14px',cursor:'pointer',fontFamily:'inherit'}}>
          ⬇ Import from Home Runs
        </button>
        <button onClick={addRow}
          style={{background:`${C.green}12`,border:`1px dashed ${C.green}55`,borderRadius:8,
            color:C.green,fontSize:12,fontWeight:600,padding:'7px 14px',cursor:'pointer',fontFamily:'inherit'}}>
          + Add Manually
        </button>
        {loads.length>0&&(
          <button onClick={()=>{if(window.confirm('Clear all loads?')) commit([]);}}
            style={{marginLeft:'auto',background:'none',border:`1px solid ${C.border}`,borderRadius:8,
              color:C.muted,fontSize:11,padding:'6px 12px',cursor:'pointer',fontFamily:'inherit'}}>
            Clear All
          </button>
        )}
      </div>

      {loads.length===0&&(
        <div style={{textAlign:'center',padding:'24px',color:C.muted,fontSize:12,fontStyle:'italic',
          border:`1px dashed ${C.border}`,borderRadius:10,marginBottom:12}}>
          No loads yet — import from Home Runs or add manually
        </div>
      )}

      {loads.map((load,i)=>(
        <div key={load.id}
          draggable
          onDragStart={()=>onDragStart(i)}
          onDragOver={e=>onDragOver(e,i)}
          onDrop={()=>onDrop(i)}
          onDragEnd={()=>{setDragIdx(null);setOverIdx(null);}}
          style={{
            display:'flex',alignItems:'center',gap:7,padding:'8px 10px',
            borderRadius:10,marginBottom:5,cursor:'grab',
            background:overIdx===i?`${C.accent}12`:load.recommended?`${C.accent}08`:C.surface,
            border:`1px solid ${overIdx===i?C.accent:load.recommended?`${C.accent}44`:C.border}`,
            borderLeft:`3px solid ${load.recommended?C.accent:load.included?C.blue:C.muted}`,
            opacity:load.included?1:0.45,transition:'border-color 0.1s,background 0.1s',
          }}>
          <span style={{fontSize:13,color:C.muted,cursor:'grab',userSelect:'none',flexShrink:0}}>⠿</span>
          <span style={{fontSize:10,fontWeight:700,color:C.dim,minWidth:14,textAlign:'center',flexShrink:0}}>{i+1}</span>
          <input type="checkbox" checked={!!load.included} onChange={()=>toggle(load.id,'included')}
            style={{accentColor:C.blue,width:13,height:13,flexShrink:0,cursor:'pointer'}}/>
          <input value={load.name||''} onChange={e=>updName(load.id,e.target.value)}
            placeholder="Load name…"
            style={{flex:1,minWidth:60,background:'transparent',border:'none',
              borderBottom:`1px solid ${C.border}`,color:C.text,fontSize:12,
              fontFamily:'inherit',outline:'none',padding:'2px 4px'}}/>
          <select value={load.wire||''} onChange={e=>updWire(load.id,e.target.value)}
            style={{background:WIRE_COLORS[load.wire]||C.surface,
              color:load.wire?(WIRE_TEXT[load.wire]||C.text):C.dim,
              border:`1px solid ${C.border}`,borderRadius:6,
              padding:'3px 4px',fontSize:10,fontFamily:'inherit',outline:'none',
              flexShrink:0,width:60}}>
            {WIRE_SIZES.map(o=>(
              <option key={o} value={o}
                style={{background:WIRE_COLORS[o]||'#f1f5f9',color:WIRE_TEXT[o]||'#0f172a'}}>
                {o||'wire'}
              </option>
            ))}
          </select>
          <input value={load.watts||0} onChange={e=>updWatts(load.id,e.target.value)}
            style={{width:50,background:'transparent',border:`1px solid ${C.border}`,borderRadius:6,
              color:C.accent,fontSize:11,fontWeight:700,fontFamily:'inherit',outline:'none',
              padding:'3px 5px',textAlign:'right',flexShrink:0}}/>
          <span style={{fontSize:9,color:C.dim,flexShrink:0}}>W</span>
          {/* ★ Recommended — KEY FIX: reads from local `load` which updates immediately */}
          <button onClick={()=>toggle(load.id,'recommended')}
            title={load.recommended?'Remove recommendation':'Mark recommended'}
            style={{
              background:load.recommended?`${C.accent}22`:'none',
              border:`1px solid ${load.recommended?C.accent:C.border}`,
              borderRadius:6,color:load.recommended?C.accent:C.muted,
              fontSize:13,padding:'2px 7px',cursor:'pointer',flexShrink:0,
              fontWeight:load.recommended?800:400,transition:'all 0.15s',
            }}>★</button>
          <button onClick={()=>del(load.id)}
            style={{background:'none',border:'none',color:C.muted,cursor:'pointer',
              fontSize:12,flexShrink:0,padding:'0 2px'}}>✕</button>
        </div>
      ))}

    </div>
  );
}

function HomeRunsTab({homeRuns, panelCounts, onHRChange, onCountChange, jobId, jobName}) {
  const [newPanelName, setNewPanelName] = useState('');
  const [genLoads,     setGenLoads]     = useState([]);
  const [hoResponse,   setHoResponse]   = useState(null);
  const [showModal,    setShowModal]    = useState(false);
  const [sending,      setSending]      = useState(false);
  const [copied,       setCopied]       = useState(false);

  const hoLink = `https://homestead-electric.vercel.app/?homeowner=${jobId}`;

  useEffect(()=>{
    getDoc(doc(db,'homeowner_requests',jobId)).then(snap=>{
      if(snap.exists()){
        if(snap.data().genLoads) setGenLoads(snap.data().genLoads);
        if(snap.data().submitted) setHoResponse(snap.data());
      }
    }).catch(()=>{});
  },[jobId]);

  // Debounced Firestore save
  const saveGenLoads = (next) => {
    setGenLoads(next);
    clearTimeout(window._genSave);
    window._genSave = setTimeout(()=>{
      getDoc(doc(db,'homeowner_requests',jobId)).then(snap=>{
        const ex = snap.exists()?snap.data():{};
        setDoc(doc(db,'homeowner_requests',jobId),{...ex,genLoads:next}).catch(()=>{});
      }).catch(()=>{});
    },800);
  };

  const send = async () => {
    if (!genLoads.length) { alert('Add loads first.'); return; }
    setSending(true);
    try {
      await setDoc(doc(db,'homeowner_requests',jobId),{
        jobId, jobName:jobName||'', genLoads,
        submitted:false, submittedAt:null, signature:'', signedDate:'', items:[],
        sentAt:new Date().toISOString(),
      });
      await navigator.clipboard.writeText(hoLink);
      setCopied(true); setTimeout(()=>setCopied(false),3000);
    } catch(e){ alert('Failed. Check connection.'); }
    setSending(false);
  };

  const resend = async () => {
    const msg = hoResponse?.submitted
      ? 'Homeowner already submitted. Reset and resend?'
      : 'Resend link with current load list?';
    if (!window.confirm(msg)) return;
    setSending(true);
    try {
      await setDoc(doc(db,'homeowner_requests',jobId),{
        jobId, jobName:jobName||'', genLoads,
        submitted:false, submittedAt:null, signature:'', signedDate:'', items:[],
        sentAt:new Date().toISOString(),
      });
      setHoResponse(null); setShowModal(false);
      await navigator.clipboard.writeText(hoLink);
      setCopied(true); setTimeout(()=>setCopied(false),3000);
    } catch(e){ alert('Failed. Check connection.'); }
    setSending(false);
  };

  const checkResponse = async () => {
    try {
      const snap = await getDoc(doc(db,'homeowner_requests',jobId));
      if(snap.exists()&&snap.data().submitted){ setHoResponse(snap.data()); setShowModal(true); }
      else alert('No response yet.');
    } catch(e){ alert('Failed to check.'); }
  };

  const allRows=[...(homeRuns.main||[]),...(homeRuns.upper||[]),...(homeRuns.basement||[]),
    ...(homeRuns.extraFloors||[]).flatMap(e=>homeRuns[e.key]||[])];
  const total=allRows.length, pulled=allRows.filter(r=>r.status==='Pulled').length;
  const pct=total>0?Math.round((pulled/total)*100):0;

  return (
    <div>
      {/* Generator Load Selection */}
      <Section label="Generator Load Selection" color={C.accent} defaultOpen={true}>
        {hoResponse?.submitted&&(
          <div style={{background:`${C.green}12`,border:`1px solid ${C.green}44`,borderRadius:10,
            padding:'10px 14px',marginBottom:14,display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
            <div style={{flex:1}}>
              <div style={{fontSize:12,fontWeight:700,color:C.green}}>✓ Homeowner Submitted</div>
              <div style={{fontSize:11,color:C.dim,marginTop:2}}>
                {hoResponse.signature} · {hoResponse.signedDate}
                {' · '}{(hoResponse.items||[]).filter(i=>i.included).length} circuits selected
              </div>
            </div>
            <button onClick={()=>setShowModal(true)}
              style={{background:'none',border:`1px solid ${C.green}44`,borderRadius:7,
                color:C.green,fontSize:11,fontWeight:600,padding:'5px 12px',cursor:'pointer',fontFamily:'inherit'}}>
              View
            </button>
            <button onClick={resend} disabled={sending}
              style={{background:'none',border:`1px solid ${C.border}`,borderRadius:7,
                color:C.dim,fontSize:11,padding:'5px 12px',cursor:'pointer',fontFamily:'inherit'}}>
              🔄 Resend
            </button>
          </div>
        )}

        <GeneratorLoadSection homeRuns={homeRuns} genLoads={genLoads} onSave={saveGenLoads}/>

        <div style={{marginTop:14,display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
          {!hoResponse?.submitted?(
            <button onClick={send} disabled={sending||!genLoads.length}
              style={{background:genLoads.length?C.accent:C.muted,border:'none',borderRadius:9,
                color:'#000',fontSize:13,fontWeight:700,padding:'10px 22px',
                cursor:genLoads.length?'pointer':'not-allowed',fontFamily:'inherit',
                opacity:sending?0.6:1}}>
              {sending?'⏳ Sending…':'🔗 Send to Homeowner'}
            </button>
          ):(
            <button onClick={resend} disabled={sending}
              style={{background:'none',border:`1px solid ${C.accent}55`,borderRadius:9,
                color:C.accent,fontSize:12,fontWeight:700,padding:'8px 18px',
                cursor:'pointer',fontFamily:'inherit',opacity:sending?0.6:1}}>
              {sending?'⏳ Resending…':'🔄 Reset & Resend'}
            </button>
          )}
          {copied&&<span style={{fontSize:12,color:C.green,fontWeight:700}}>✓ Link copied!</span>}
        </div>

        <div style={{marginTop:10,display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
          <button onClick={()=>{navigator.clipboard.writeText(hoLink);setCopied(true);setTimeout(()=>setCopied(false),2000);}}
            style={{background:'none',border:`1px solid ${C.border}`,borderRadius:6,color:C.dim,
              fontSize:11,padding:'3px 10px',cursor:'pointer',fontFamily:'inherit'}}>
            🔗 Copy link
          </button>
          <button onClick={()=>window.open(hoLink,'_blank')}
            style={{background:'none',border:`1px solid ${C.border}`,borderRadius:6,color:C.dim,
              fontSize:11,padding:'3px 10px',cursor:'pointer',fontFamily:'inherit'}}>
            Preview
          </button>
          {!hoResponse?.submitted&&(
            <button onClick={checkResponse}
              style={{background:'none',border:`1px solid ${C.border}`,borderRadius:6,color:C.dim,
                fontSize:11,padding:'3px 10px',cursor:'pointer',fontFamily:'inherit'}}>
              Check for response
            </button>
          )}
        </div>
      </Section>

      {/* Response modal */}
      {showModal&&hoResponse&&(
        <div onClick={()=>setShowModal(false)}
          style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.45)',zIndex:9999,
            display:'flex',alignItems:'center',justifyContent:'center',padding:16}}>
          <div onClick={e=>e.stopPropagation()}
            style={{background:'#fff',borderRadius:14,padding:22,maxWidth:460,width:'100%',
              maxHeight:'85vh',overflowY:'auto',border:'0.5px solid #e2e8f0'}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:4}}>
              <div style={{fontSize:14,fontWeight:600,color:'#1e293b'}}>Homeowner Selections</div>
              <button onClick={()=>setShowModal(false)}
                style={{background:'none',border:'none',fontSize:16,cursor:'pointer',color:'#94a3b8'}}>✕</button>
            </div>
            <div style={{fontSize:11,color:'#94a3b8',marginBottom:14}}>
              Signed: {hoResponse.signature} · {hoResponse.signedDate}
            </div>
            <button onClick={resend} disabled={sending}
              style={{width:'100%',marginBottom:14,background:'none',border:`1px solid ${C.border}`,
                borderRadius:8,color:C.dim,fontSize:12,padding:'8px',cursor:'pointer',fontFamily:'inherit'}}>
              🔄 Reset &amp; Resend
            </button>

                        <div style={{fontSize:10,fontWeight:600,color:'#94a3b8',letterSpacing:'0.08em',marginBottom:8}}>
              ON GENERATOR · {(hoResponse.items||[]).filter(i=>i.included).length}
            </div>
            {(hoResponse.items||[]).filter(i=>i.included).map((it,idx)=>(
              <div key={it.id||idx} style={{background:'#f8fafc',border:'0.5px solid #e2e8f0',
                borderRadius:8,padding:'9px 12px',marginBottom:5}}>
                <div style={{display:'flex',alignItems:'center',gap:8}}>
                  <div style={{width:20,height:20,borderRadius:'50%',background:'#fef3c7',
                    border:'0.5px solid #fde68a',display:'flex',alignItems:'center',
                    justifyContent:'center',fontSize:10,fontWeight:600,color:'#b45309',flexShrink:0}}>
                    {it.priority||idx+1}
                  </div>
                  <div style={{flex:1}}>
                    <div style={{fontSize:13,fontWeight:500,color:'#1e293b',display:'flex',alignItems:'center',gap:6,flexWrap:'wrap'}}>
                      {it.name||'Unnamed'}
                      {it.recommended&&<span style={{fontSize:9,fontWeight:800,color:'#b45309',
                        background:'#fef3c7',borderRadius:99,padding:'1px 6px',border:'0.5px solid #fde68a'}}>★ REC</span>}
                    </div>
                    <div style={{fontSize:11,color:'#94a3b8',marginTop:2}}>
                      {it.wire||''}{it.watts?` · ${it.watts}W`:''}
                    </div>
                    {it.notes&&<div style={{fontSize:11,color:'#64748b',marginTop:2,fontStyle:'italic'}}>"{it.notes}"</div>}
                  </div>
                </div>
              </div>
            ))}
            {(hoResponse.items||[]).filter(i=>!i.included).length>0&&(
              <>
                <div style={{fontSize:10,fontWeight:600,color:'#cbd5e1',letterSpacing:'0.08em',margin:'12px 0 8px'}}>
                  NOT ON GENERATOR · {(hoResponse.items||[]).filter(i=>!i.included).length}
                </div>
                {(hoResponse.items||[]).filter(i=>!i.included).map((it,idx)=>(
                  <div key={it.id||idx} style={{background:'#f8fafc',border:'0.5px solid #e2e8f0',
                    borderRadius:8,padding:'8px 12px',marginBottom:4,opacity:0.55}}>
                    <div style={{fontSize:12,color:'#64748b'}}>{it.name||'Unnamed'}</div>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      )}

      {/* Pull progress */}
      {total>0&&(
        <div style={{marginBottom:20,padding:'14px 16px',background:C.surface,
          border:`1px solid ${C.border}`,borderRadius:12}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
            <span style={{fontSize:12,fontWeight:700,color:C.text}}>Home Runs Pulled</span>
            <span style={{fontSize:13,fontWeight:700,color:pct===100?C.green:C.blue}}>{pulled} / {total} — {pct}%</span>
          </div>
          <div style={{height:8,background:C.border,borderRadius:99,overflow:'hidden'}}>
            <div style={{height:'100%',width:`${pct}%`,background:pct===100?C.green:C.blue,
              borderRadius:99,transition:'width 0.4s ease'}}/>
          </div>
        </div>
      )}

      {/* Share Live View */}
      <div style={{marginBottom:16,display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
        <button onClick={()=>{
          const link=`${window.location.origin}/?homeruns=${jobId}`;
          navigator.clipboard.writeText(link).then(()=>alert('✓ Live view link copied!\n\nAnyone with this link can see Home Runs in real time (view only).')).catch(()=>alert('Link:\n'+link));
        }} style={{background:`${C.blue}15`,border:`1px solid ${C.blue}44`,borderRadius:8,
          color:C.blue,fontSize:12,fontWeight:700,padding:'7px 14px',cursor:'pointer',fontFamily:'inherit'}}>
          📤 Share Live View
        </button>
        <span style={{fontSize:11,color:C.dim}}>Anyone with the link can see pull status in real time</span>
      </div>

      {/* Panels */}
      {(()=>{
        const cP=homeRuns.customPanels||DEFAULT_PANELS;
        const addP=()=>{ const n=newPanelName.trim(); if(!n||cP.includes(n)) return; onHRChange({...homeRuns,customPanels:[...cP,n]}); setNewPanelName(''); };
        return (
          <Section label="Panels" color={C.blue} defaultOpen={false}>
            <div style={{display:'flex',flexWrap:'wrap',gap:6,marginBottom:10}}>
              {cP.map(p=>(
                <div key={p} style={{display:'flex',alignItems:'center',gap:4,
                  background:`${C.blue}15`,border:`1px solid ${C.blue}44`,
                  borderRadius:20,padding:'4px 10px 4px 12px',fontSize:12,color:C.blue,fontWeight:600}}>
                  {p}
                  <button onClick={()=>onHRChange({...homeRuns,customPanels:cP.filter(x=>x!==p)})}
                    style={{background:'none',border:'none',cursor:'pointer',color:C.dim,
                      fontSize:14,lineHeight:1,padding:'0 2px',fontWeight:700}}>×</button>
                </div>
              ))}
            </div>
            <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
              <input value={newPanelName} onChange={e=>setNewPanelName(e.target.value)}
                onKeyDown={e=>e.key==='Enter'&&addP()}
                placeholder="e.g. Panel E, Sub Panel…"
                style={{flex:1,minWidth:180,background:C.surface,border:`1px solid ${C.border}`,
                  borderRadius:7,padding:'7px 10px',fontSize:12,fontFamily:'inherit',outline:'none',color:C.text}}/>
              <button onClick={addP}
                style={{background:C.blue,color:'#fff',border:'none',borderRadius:7,
                  padding:'7px 14px',fontSize:12,fontWeight:700,cursor:'pointer'}}>+ Add Panel</button>
              <button onClick={()=>onHRChange({...homeRuns,customPanels:DEFAULT_PANELS})}
                style={{background:'none',border:`1px solid ${C.border}`,borderRadius:7,
                  padding:'7px 12px',fontSize:11,color:C.dim,cursor:'pointer'}}>Reset</button>
            </div>
            <div style={{fontSize:11,color:C.muted,marginTop:8}}>"Meter" and "Dedicated Loads" always available.</div>
          </Section>
        );
      })()}

      <Section label="Home Runs" color={C.blue} defaultOpen={true}>
        {(()=>{ const cp=homeRuns.customPanels||DEFAULT_PANELS; return (
          <>
          {[['main','Main Level Loads'],['basement','Basement Level Loads'],['upper','Upper Level Loads']].map(([k,l])=>(
            <HomeRunLevel key={k} label={l} rows={homeRuns[k]||[]} customPanels={cp} onChange={v=>onHRChange({...homeRuns,[k]:v})}/>
          ))}
          {(homeRuns.extraFloors||[]).map((ef)=>(
            <div key={ef.key} style={{position:'relative'}}>
              <HomeRunLevel label={ef.label} rows={homeRuns[ef.key]||[]} customPanels={cp}
                onChange={v=>onHRChange({...homeRuns,[ef.key]:v})}/>
              <button onClick={()=>{ const ne=(homeRuns.extraFloors||[]).filter(e=>e.key!==ef.key); const u={...homeRuns,extraFloors:ne}; delete u[ef.key]; onHRChange(u); }}
                style={{position:'absolute',top:0,right:0,background:'none',border:'none',
                  color:C.muted,cursor:'pointer',fontSize:11,padding:'2px 6px',fontFamily:'inherit'}}>
                Remove
              </button>
            </div>
          ))}
          <HRAddFloor homeRuns={homeRuns} onHRChange={onHRChange}/>
          </>
        ); })()}
      </Section>

      <Section label="Load Mapping Notes" color={C.blue}>
        <TA value={homeRuns.loadMappingNotes||''} onChange={e=>onHRChange({...homeRuns,loadMappingNotes:e.target.value})} placeholder="Load mapping notes…" rows={5}/>
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

  const namedRows = loads.filter(r=>r.name.trim());
  const pulledCount = namedRows.filter(r=>r.status==="Pulled").length;
  const pct = namedRows.length>0 ? Math.round((pulledCount/namedRows.length)*100) : 0;

  return (

    <div style={{marginBottom:22}}>

      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:6}}>

        <div style={{fontSize:12,color:C.purple,fontWeight:700}}>{label}</div>

        <Btn onClick={addRow} variant="add" style={{fontSize:11,padding:"3px 10px"}}>+ Add Row</Btn>

      </div>

      {/* Pull progress — only shown when there are named rows */}
      {namedRows.length>0&&(
        <div style={{marginBottom:10}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
            <span style={{fontSize:10,color:C.dim}}>Pull progress</span>
            <span style={{fontSize:11,fontWeight:700,color:pct===100?C.green:C.purple}}>{pulledCount}/{namedRows.length} — {pct}%</span>
          </div>
          <div style={{height:5,background:C.border,borderRadius:99,overflow:"hidden"}}>
            <div style={{height:"100%",width:`${pct}%`,background:pct===100?C.green:C.purple,borderRadius:99,transition:"width 0.4s"}}/>
          </div>
        </div>
      )}

      <div style={{display:"grid",gridTemplateColumns:"36px 1fr 80px 28px",gap:6,marginBottom:6}}>

        {["#","Keypad Load Name","Status",""].map((h,i)=>(

          <div key={i} style={{fontSize:10,color:C.dim,fontWeight:700,letterSpacing:"0.08em"}}>{h}</div>

        ))}

      </div>

      {loads.map(r=>(

        <div key={r.id} style={{display:"grid",gridTemplateColumns:"36px 1fr 80px 28px",gap:6,marginBottom:4,alignItems:"center",
          borderRadius:6,padding:"3px 0",
          background:r.status==="Pulled"?"rgba(34,197,94,0.08)":r.status==="Need Specs"?"rgba(239,68,68,0.08)":"transparent"}}>

          <span style={{fontSize:11,color:C.muted,textAlign:"right",paddingRight:6}}>{r.num}.</span>

          <Inp value={r.name} onChange={e=>upd(r.id,{name:e.target.value})} placeholder="Load name…"/>

          <Sel value={r.status||""} onChange={e=>upd(r.id,{status:e.target.value})} options={PULLED_OPTS}
            style={{color:r.status==="Pulled"?C.green:r.status==="Need Specs"?C.red:C.text,fontSize:10}}/>

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

// ── Google Drive Files Section ─────────────────────────────────
const DRIVE_API_KEY = firebaseConfig.apiKey; // reuse Firebase API key (must enable Drive API in Cloud Console)

function extractDriveFolderId(input) {
  if (!input) return "";
  const match = input.match(/folders\/([a-zA-Z0-9_-]+)/);
  if (match) return match[1];
  if (/^[a-zA-Z0-9_-]{10,}$/.test(input.trim())) return input.trim();
  return "";
}

// Recursively fetch all files from a Drive folder and its sub-folders
async function fetchDriveFilesRecursive(folderId, folderName, depth) {
  if (depth > 3) return []; // safety limit
  const url = `https://www.googleapis.com/drive/v3/files?q='${folderId}'+in+parents+and+trashed=false&key=${DRIVE_API_KEY}&fields=files(id,name,mimeType,thumbnailLink,size,modifiedTime,webViewLink)&pageSize=100&supportsAllDrives=true&includeItemsFromAllDrives=true&orderBy=name`;
  const resp = await fetch(url);
  const data = await resp.json();
  if (data.error) throw new Error(data.error.message || "Could not load Drive files");
  const files = data.files || [];
  const folders = files.filter(f => f.mimeType === "application/vnd.google-apps.folder");
  const nonFolders = files.filter(f => f.mimeType !== "application/vnd.google-apps.folder")
    .map(f => ({ ...f, _folder: folderName }));
  // Recurse into each sub-folder
  const subResults = await Promise.all(
    folders.map(sf => fetchDriveFilesRecursive(sf.id, sf.name, depth + 1))
  );
  return [...nonFolders, ...subResults.flat()];
}

// Parent Drive folder containing all job plan folders
const DRIVE_PARENT_FOLDER_ID = "1laC4udt1sBdV-_QUMzzbKJfD03q4_Ml3";

// Normalize a name for fuzzy matching: lowercase, strip #numbers, common suffixes, extra whitespace
function normalizeName(name) {
  return (name || "").toLowerCase()
    .replace(/#\d+\s*[-–—]?\s*/g, "")  // strip #1260 - prefix
    .replace(/\b(plans|residence|home|house|electrical)\b/gi, "")
    .replace(/[^a-z0-9]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Match a Drive folder name to a job name
function namesMatch(driveName, jobName) {
  const dn = normalizeName(driveName);
  const jn = normalizeName(jobName);
  if (!dn || !jn) return false;
  // Check if either contains the other
  if (dn.includes(jn) || jn.includes(dn)) return true;
  // Check if all words of the job name appear in the folder name
  const jobWords = jn.split(" ").filter(w => w.length > 2);
  if (jobWords.length > 0 && jobWords.every(w => dn.includes(w))) return true;
  return false;
}

async function syncDriveFoldersToJobs(jobs, updateJob) {
  // 1. Fetch all folders in the parent Drive folder
  const url = `https://www.googleapis.com/drive/v3/files?q='${DRIVE_PARENT_FOLDER_ID}'+in+parents+and+mimeType='application/vnd.google-apps.folder'+and+trashed=false&key=${DRIVE_API_KEY}&fields=files(id,name)&pageSize=200&supportsAllDrives=true&includeItemsFromAllDrives=true&orderBy=name`;
  const resp = await fetch(url);
  const data = await resp.json();
  if (data.error) throw new Error(data.error.message || "Could not load Drive folders");
  const driveFolders = data.files || [];

  // 2. Match folders to jobs that don't already have a driveFolderId
  const results = { matched: [], skipped: [], ambiguous: [] };
  for (const job of jobs) {
    if (job.driveFolderId) { results.skipped.push(job.name); continue; }
    const matches = driveFolders.filter(df => namesMatch(df.name, job.name));
    if (matches.length === 1) {
      results.matched.push({ jobName: job.name, folderName: matches[0].name, folderId: matches[0].id });
    } else if (matches.length > 1) {
      results.ambiguous.push({ jobName: job.name, folders: matches.map(m => m.name) });
    }
  }

  // 3. Apply matches
  for (const match of results.matched) {
    const job = jobs.find(j => j.name === match.jobName);
    if (job) { const patch = { driveFolderId: match.folderId }; updateJob({ ...job, ...patch }, patch); }
  }

  return { total: driveFolders.length, ...results };
}

function DriveFilesSection({ job, onUpdate }) {
  const [driveFiles, setDriveFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [viewFile, setViewFile] = useState(null);
  const [folderInput, setFolderInput] = useState(job.driveFolderId || "");
  const [editingFolder, setEditingFolder] = useState(!job.driveFolderId);

  const folderId = extractDriveFolderId(job.driveFolderId);

  useEffect(() => {
    if (!folderId) { setDriveFiles([]); return; }
    let cancelled = false;
    setLoading(true);
    setError("");
    fetchDriveFilesRecursive(folderId, "Root", 0)
      .then(allFiles => {
        if (cancelled) return;
        setDriveFiles(allFiles);
        setLoading(false);
      })
      .catch(e => {
        if (cancelled) return;
        setError(e.message || "Network error loading Drive files");
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [folderId]);

  const handleSaveFolder = () => {
    const id = extractDriveFolderId(folderInput);
    onUpdate({ driveFolderId: id || folderInput.trim() });
    setEditingFolder(false);
  };

  const handleRemoveFolder = () => {
    if (!window.confirm("Remove Google Drive folder link?")) return;
    onUpdate({ driveFolderId: "" });
    setFolderInput("");
    setEditingFolder(true);
    setDriveFiles([]);
  };

  const isImage = (f) => (f.mimeType || "").startsWith("image/");
  const isPDF = (f) => f.mimeType === "application/pdf" || /\.pdf$/i.test(f.name);
  const fileIcon = (f) => isPDF(f) ? "📄" : isImage(f) ? "🖼" : "📎";

  const previewUrl = (f) => `https://drive.google.com/file/d/${f.id}/preview`;
  const thumbUrl = (f) => f.thumbnailLink ? f.thumbnailLink.replace(/=s\d+/, "=s400") : `https://drive.google.com/thumbnail?id=${f.id}&sz=w400`;

  // Group files by sub-folder
  const folderNames = [...new Set(driveFiles.map(f => f._folder))];
  const images = driveFiles.filter(f => isImage(f));
  const docs = driveFiles.filter(f => !isImage(f));

  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div style={{ fontSize: 10, color: C.dim, fontWeight: 700, letterSpacing: "0.08em" }}>GOOGLE DRIVE PLANS</div>
        {folderId && !editingFolder && (
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={() => setEditingFolder(true)}
              style={{ background: "none", border: `1px solid ${C.border}`, borderRadius: 6,
                color: C.dim, cursor: "pointer", fontSize: 11, padding: "3px 8px", fontFamily: "inherit" }}>
              Edit
            </button>
            <button onClick={handleRemoveFolder}
              style={{ background: "none", border: `1px solid ${C.red}44`, borderRadius: 6,
                color: C.red, cursor: "pointer", fontSize: 11, padding: "3px 8px", fontFamily: "inherit" }}>
              Remove
            </button>
          </div>
        )}
      </div>

      {/* Folder URL input */}
      {editingFolder && (
        <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
          <input value={folderInput} onChange={e => setFolderInput(e.target.value)}
            placeholder="Paste Google Drive folder URL..."
            style={{ flex: 1, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 7,
              padding: "8px 12px", fontSize: 12, color: C.text, fontFamily: "inherit", outline: "none" }} />
          <button onClick={handleSaveFolder} disabled={!folderInput.trim()}
            style={{ background: C.blue, border: "none", borderRadius: 7, color: "#fff",
              fontSize: 11, fontWeight: 600, padding: "8px 16px", cursor: "pointer",
              opacity: folderInput.trim() ? 1 : 0.4, fontFamily: "inherit" }}>
            Link Folder
          </button>
        </div>
      )}

      {/* Connected folder indicator */}
      {folderId && !editingFolder && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, padding: "8px 12px",
          background: `${C.green}10`, border: `1px solid ${C.green}33`, borderRadius: 8 }}>
          <span style={{ fontSize: 14 }}>📁</span>
          <span style={{ fontSize: 11, color: C.green, fontWeight: 600, flex: 1 }}>
            Drive folder linked{driveFiles.length > 0 ? ` — ${driveFiles.length} file${driveFiles.length === 1 ? "" : "s"}` : ""}
            {folderNames.length > 1 ? ` across ${folderNames.length} folders` : ""}
          </span>
          <a href={`https://drive.google.com/drive/folders/${folderId}`} target="_blank" rel="noreferrer"
            style={{ fontSize: 11, color: C.blue, fontWeight: 600, textDecoration: "none" }}>
            Open in Drive ↗
          </a>
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div style={{ fontSize: 11, color: C.accent, fontWeight: 600, padding: "16px",
          textAlign: "center", border: `1px dashed ${C.border}`, borderRadius: 10 }}>
          Loading Drive files...
        </div>
      )}

      {/* Error state */}
      {error && (
        <div style={{ fontSize: 11, color: C.red, padding: "12px",
          background: `${C.red}10`, border: `1px solid ${C.red}33`, borderRadius: 8, marginBottom: 12 }}>
          {error}. Make sure the folder is shared as "Anyone with the link can view" and the Drive API is enabled.
        </div>
      )}

      {/* Empty state */}
      {folderId && !loading && !error && driveFiles.length === 0 && (
        <div style={{ fontSize: 11, color: C.muted, fontStyle: "italic", padding: "16px",
          textAlign: "center", border: `1px dashed ${C.border}`, borderRadius: 10 }}>
          No files found in this Drive folder
        </div>
      )}

      {/* Files grouped by sub-folder */}
      {folderNames.map(folder => {
        const folderImages = images.filter(f => f._folder === folder);
        const folderDocs = docs.filter(f => f._folder === folder);
        if (folderImages.length === 0 && folderDocs.length === 0) return null;
        return (
          <div key={folder} style={{ marginBottom: 16 }}>
            {/* Folder header — only show if there are multiple folders */}
            {folderNames.length > 1 && (
              <div style={{ fontSize: 10, color: C.accent, fontWeight: 700, letterSpacing: "0.06em",
                marginBottom: 8, paddingBottom: 4, borderBottom: `1px solid ${C.border}` }}>
                📁 {folder === "Root" ? "Top Level" : folder}
              </div>
            )}

            {/* Images grid */}
            {folderImages.length > 0 && (
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 9, color: C.dim, fontWeight: 700, letterSpacing: "0.08em", marginBottom: 8 }}>IMAGES</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(100px,1fr))", gap: 8 }}>
                  {folderImages.map(f => (
                    <div key={f.id} style={{ position: "relative", cursor: "pointer" }} onClick={() => setViewFile(f)}>
                      <img src={thumbUrl(f)} alt={f.name}
                        style={{ width: "100%", aspectRatio: "1", objectFit: "cover", borderRadius: 8,
                          border: `1px solid ${C.border}`, background: C.surface }} />
                      <div style={{ fontSize: 9, color: C.dim, marginTop: 3, overflow: "hidden",
                        textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Documents list */}
            {folderDocs.length > 0 && (
              <div>
                <div style={{ fontSize: 9, color: C.dim, fontWeight: 700, letterSpacing: "0.08em", marginBottom: 8 }}>DOCUMENTS</div>
                {folderDocs.map(f => (
                  <div key={f.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px",
                    background: C.surface, border: `1px solid ${C.border}`, borderRadius: 9, marginBottom: 6 }}>
                    <span style={{ fontSize: 18, flexShrink: 0 }}>{fileIcon(f)}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: C.text, overflow: "hidden",
                        textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</div>
                      <div style={{ fontSize: 10, color: C.muted }}>
                        {f.size ? (Number(f.size) < 1024 * 1024 ? Math.round(Number(f.size) / 1024) + " KB" : (Number(f.size) / (1024 * 1024)).toFixed(1) + " MB") : ""}
                      </div>
                    </div>
                    {(isPDF(f) || isImage(f)) && (
                      <button onClick={() => setViewFile(f)}
                        style={{ fontSize: 11, fontWeight: 600, color: C.accent, background: `${C.accent}12`,
                          border: `1px solid ${C.accent}44`, borderRadius: 7, padding: "5px 10px",
                          cursor: "pointer", flexShrink: 0, fontFamily: "inherit" }}>
                        View
                      </button>
                    )}
                    <a href={f.webViewLink || `https://drive.google.com/file/d/${f.id}/view`} target="_blank" rel="noreferrer"
                      style={{ fontSize: 11, fontWeight: 600, color: C.blue, textDecoration: "none",
                        border: `1px solid ${C.blue}44`, borderRadius: 7, padding: "5px 10px",
                        flexShrink: 0 }}>
                      Open ↗
                    </a>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {/* Inline viewer (lightbox) */}
      {viewFile && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.95)", zIndex: 1000,
          display: "flex", flexDirection: "column", padding: 0 }}>
          {/* Header bar */}
          <div style={{ display: "flex", alignItems: "center", padding: "12px 16px", gap: 12,
            background: "rgba(255,255,255,0.08)", flexShrink: 0 }}>
            <span style={{ fontSize: 14, color: "#fff", fontWeight: 600, flex: 1, overflow: "hidden",
              textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {viewFile._folder && viewFile._folder !== "Root" ? `${viewFile._folder} / ` : ""}{viewFile.name}
            </span>
            <a href={viewFile.webViewLink || `https://drive.google.com/file/d/${viewFile.id}/view`}
              target="_blank" rel="noreferrer"
              style={{ fontSize: 12, color: C.blue, fontWeight: 600, textDecoration: "none",
                border: `1px solid ${C.blue}66`, borderRadius: 7, padding: "5px 12px", flexShrink: 0 }}>
              Open in Drive ↗
            </a>
            <button onClick={() => setViewFile(null)}
              style={{ background: "rgba(255,255,255,0.15)", border: "none", borderRadius: "50%",
                color: "#fff", fontSize: 20, width: 36, height: 36, cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>✕</button>
          </div>
          {/* Content */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", overflow: "hidden", padding: 16 }}>
            {isImage(viewFile) ? (<>
              <img src={thumbUrl(viewFile).replace(/=s\d+/, "=s1600")} alt={viewFile.name}
                style={{ maxWidth: "95vw", maxHeight: "calc(95vh - 120px)", objectFit: "contain" }} />
              <a href={`https://drive.google.com/uc?export=view&id=${viewFile.id}`} target="_blank" rel="noreferrer"
                style={{ marginTop: 12, fontSize: 12, color: C.blue, fontWeight: 600, textDecoration: "none",
                  border: `1px solid ${C.blue}66`, borderRadius: 7, padding: "6px 16px", background: "rgba(0,0,0,0.4)" }}>
                Open full size (pinch-to-zoom) ↗
              </a>
            </>) : (
              <iframe src={previewUrl(viewFile)} title={viewFile.name}
                style={{ width: "100%", height: "100%", border: "none" }}
                allow="autoplay" />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const LINK_FIELDS = [

  ["planLink","Plans"],

  ["lightingLink","Lighting Schedules"],["panelLink","Panel Schedules"],

["matterportLink","Matterport Link"],

];


// ── File Upload Section (Firebase Storage) ────────────────────
function FileUploadSection({ jobId, files, onChange }) {
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState("");
  const [viewFile, setViewFile] = useState(null);

  const handleUpload = async (inputFiles) => {
    if (!inputFiles || inputFiles.length === 0) return;
    setUploading(true);
    const newFiles = [];
    for (const file of Array.from(inputFiles)) {
      try {
        setUploadProgress(`Uploading ${file.name}...`);
        const fileId = uid();
        const ext = file.name.split(".").pop() || "file";
        const storagePath = `jobs/${jobId}/plans/${fileId}.${ext}`;
        const storageRef = ref(storage, storagePath);
        await uploadBytes(storageRef, file);
        const url = await getDownloadURL(storageRef);
        newFiles.push({
          id: fileId,
          name: file.name,
          url,
          storagePath,
          type: file.type || "application/octet-stream",
          size: file.size,
          uploadedAt: new Date().toISOString(),
        });
      } catch (e) {
        console.error("Upload failed:", e);
        alert(`Failed to upload ${file.name}. Check your connection and try again.`);
      }
    }
    if (newFiles.length > 0) {
      onChange([...(files || []), ...newFiles]);
    }
    setUploading(false);
    setUploadProgress("");
  };

  const handleDelete = async (file) => {
    if (!window.confirm(`Delete ${file.name}?`)) return;
    try {
      if (file.storagePath) {
        const storageRef = ref(storage, file.storagePath);
        await deleteObject(storageRef).catch(() => {}); // ok if already deleted
      }
    } catch (e) { console.warn("Storage delete failed:", e); }
    onChange((files || []).filter(f => f.id !== file.id));
  };

  const isImage = (file) => (file.type || "").startsWith("image/") || /\.(jpg|jpeg|png|gif|webp|heic)$/i.test(file.name);
  const isPDF = (file) => (file.type || "") === "application/pdf" || /\.pdf$/i.test(file.name);
  const fileIcon = (file) => isPDF(file) ? "📄" : isImage(file) ? "🖼" : "📎";

  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div style={{ fontSize: 10, color: C.dim, fontWeight: 700, letterSpacing: "0.08em" }}>UPLOADED FILES</div>
        <div style={{ display: "flex", gap: 6 }}>
          {/* File upload */}
          <label style={{ display: "inline-flex", alignItems: "center", gap: 5,
            background: `${C.blue}15`, border: `1px solid ${C.blue}44`, borderRadius: 7,
            padding: "5px 12px", fontSize: 11, fontWeight: 600, color: C.blue,
            cursor: uploading ? "not-allowed" : "pointer", opacity: uploading ? 0.5 : 1,
            fontFamily: "inherit" }}>
            📎 Upload Files
            <input type="file" multiple accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.dwg,.dxf"
              style={{ display: "none" }} disabled={uploading}
              onChange={e => { handleUpload(e.target.files); e.target.value = ""; }} />
          </label>
          {/* Camera capture */}
          <label style={{ display: "inline-flex", alignItems: "center", gap: 5,
            background: `${C.teal}15`, border: `1px solid ${C.teal}44`, borderRadius: 7,
            padding: "5px 12px", fontSize: 11, fontWeight: 600, color: C.teal,
            cursor: uploading ? "not-allowed" : "pointer", opacity: uploading ? 0.5 : 1,
            fontFamily: "inherit" }}>
            📷 Take Photo
            <input type="file" accept="image/*" capture="environment"
              style={{ display: "none" }} disabled={uploading}
              onChange={e => { handleUpload(e.target.files); e.target.value = ""; }} />
          </label>
        </div>
      </div>

      {uploading && (
        <div style={{ fontSize: 11, color: C.accent, fontWeight: 600, marginBottom: 10,
          padding: "8px 12px", background: `${C.accent}12`, border: `1px solid ${C.accent}33`,
          borderRadius: 8 }}>
          ⏳ {uploadProgress || "Uploading..."}
        </div>
      )}

      {(!files || files.length === 0) && !uploading && (
        <div style={{ fontSize: 11, color: C.muted, fontStyle: "italic", padding: "16px",
          textAlign: "center", border: `1px dashed ${C.border}`, borderRadius: 10 }}>
          No files uploaded yet — use the buttons above to upload plans, photos, or documents
        </div>
      )}

      {/* Image grid */}
      {(files || []).filter(f => isImage(f)).length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 9, color: C.dim, fontWeight: 700, letterSpacing: "0.08em", marginBottom: 8 }}>IMAGES</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(100px,1fr))", gap: 8 }}>
            {(files || []).filter(f => isImage(f)).map(f => (
              <div key={f.id} style={{ position: "relative" }}>
                <img src={f.url} alt={f.name}
                  onClick={() => setViewFile(f)}
                  style={{ width: "100%", aspectRatio: "1", objectFit: "cover", borderRadius: 8,
                    border: `1px solid ${C.border}`, cursor: "pointer" }} />
                <button onClick={() => handleDelete(f)}
                  style={{ position: "absolute", top: -5, right: -5, background: "#dc2626",
                    border: "none", borderRadius: "50%", color: "#fff", width: 18, height: 18,
                    fontSize: 10, cursor: "pointer", display: "flex", alignItems: "center",
                    justifyContent: "center", lineHeight: 1 }}>✕</button>
                <div style={{ fontSize: 9, color: C.dim, marginTop: 3, overflow: "hidden",
                  textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Document list */}
      {(files || []).filter(f => !isImage(f)).length > 0 && (
        <div>
          <div style={{ fontSize: 9, color: C.dim, fontWeight: 700, letterSpacing: "0.08em", marginBottom: 8 }}>DOCUMENTS</div>
          {(files || []).filter(f => !isImage(f)).map(f => (
            <div key={f.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px",
              background: C.surface, border: `1px solid ${C.border}`, borderRadius: 9, marginBottom: 6 }}>
              <span style={{ fontSize: 18, flexShrink: 0 }}>{fileIcon(f)}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: C.text, overflow: "hidden",
                  textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</div>
                <div style={{ fontSize: 10, color: C.muted }}>
                  {f.size ? (f.size < 1024 * 1024 ? Math.round(f.size / 1024) + " KB" : (f.size / (1024 * 1024)).toFixed(1) + " MB") : ""}
                </div>
              </div>
              <a href={f.url} target="_blank" rel="noreferrer"
                style={{ fontSize: 11, fontWeight: 600, color: C.blue, textDecoration: "none",
                  border: `1px solid ${C.blue}44`, borderRadius: 7, padding: "5px 10px",
                  flexShrink: 0 }}>
                Open ↗
              </a>
              <button onClick={() => handleDelete(f)}
                style={{ background: "none", border: "none", color: C.muted, cursor: "pointer",
                  fontSize: 13, flexShrink: 0 }}>✕</button>
            </div>
          ))}
        </div>
      )}

      {/* Lightbox */}
      {viewFile && (
        <div onClick={() => setViewFile(null)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.95)", zIndex: 1000,
            display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}>
          <button onClick={() => setViewFile(null)}
            style={{ position: "absolute", top: 16, right: 16, background: "rgba(255,255,255,0.15)",
              border: "none", borderRadius: "50%", color: "#fff", fontSize: 22, width: 40, height: 40,
              cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1001 }}>✕</button>
          {isImage(viewFile) ? (
            <div onClick={e => e.stopPropagation()}
              style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 16 }}>
              <img src={viewFile.url} alt={viewFile.name}
                style={{ maxWidth: "95vw", maxHeight: "calc(95vh - 60px)", objectFit: "contain", borderRadius: 8 }} />
              <a href={viewFile.url} target="_blank" rel="noreferrer"
                style={{ marginTop: 12, fontSize: 12, color: C.blue, fontWeight: 600, textDecoration: "none",
                  border: `1px solid ${C.blue}66`, borderRadius: 7, padding: "6px 16px", background: "rgba(0,0,0,0.4)" }}>
                Open full size (pinch-to-zoom) ↗
              </a>
            </div>
          ) : (
            <div onClick={e => e.stopPropagation()}
              style={{ background: "#fff", borderRadius: 12, padding: 24, textAlign: "center" }}>
              <div style={{ fontSize: 48, marginBottom: 12 }}>{fileIcon(viewFile)}</div>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>{viewFile.name}</div>
              <a href={viewFile.url} target="_blank" rel="noreferrer"
                style={{ fontSize: 13, color: C.blue, fontWeight: 600 }}>Open file ↗</a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PlansTab({job, onUpdate}) {

  return (

    <div>

      {/* Google Drive Plans */}
      <DriveFilesSection job={job} onUpdate={onUpdate} />

      {/* Divider between Drive and uploads */}
      <div style={{ borderTop: `1px solid ${C.border}`, marginBottom: 16, paddingTop: 16 }}>
        {/* File Uploads — Firebase Storage */}
        <FileUploadSection
          jobId={job.id}
          files={job.planFiles || []}
          onChange={v => onUpdate({ planFiles: v })}
        />
      </div>

      <div style={{ fontSize: 10, color: C.dim, fontWeight: 700, letterSpacing: "0.08em", marginBottom: 12,
        paddingTop: 16, borderTop: `1px solid ${C.border}` }}>
        LINKS
      </div>

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

                <div style={{display:"flex",gap:6,alignItems:"center"}}>

                  {lnk.url ? (

                    <a href={lnk.url} target="_blank" rel="noreferrer"

                      style={{flex:1,background:C.blue+"11",border:`1px solid ${C.blue}33`,borderRadius:7,

                        color:C.blue,padding:"7px 12px",fontSize:12,fontWeight:600,

                        textDecoration:"none",whiteSpace:"nowrap",overflow:"hidden",

                        textOverflow:"ellipsis"}}>

                      {lnk.label||"Open ↗"}

                    </a>

                  ) : (

                    <Inp value={lnk.url||""} placeholder="Paste URL…" style={{flex:1}}

                      onChange={e=>setLinks(links.map((x,j)=>j===i?{...x,url:e.target.value}:x))}/>

                  )}

                  <button onClick={()=>setLinks(links.map((x,j)=>j===i?{...x,url:""}:x))}

                    title="Edit URL"

                    style={{background:"none",border:`1px solid ${C.border}`,borderRadius:6,

                      color:C.dim,cursor:"pointer",fontSize:11,padding:"4px 8px",flexShrink:0}}>

                    ✎

                  </button>

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

                  <button onClick={()=>onUpdate({customLinks:(job.customLinks||[]).map(x=>x.id===cl.id?{...x,urls:(x.urls||[]).map((u,j)=>j===i?{...u,url:""}:u)}:x)})}

                    title="Edit URL"

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
  changeOrders: (raw?.changeOrders||[]).map(o=>({
    needsHardDate:false, needsByStart:"", needsByEnd:"",
    coStatus:"", coStatusDate:"", ...o,
    needsHardDate: o.needsHardDate??false,
    needsByStart:  o.needsByStart||"",
    needsByEnd:    o.needsByEnd||"",
  })),
  returnTrips: (raw?.returnTrips||[]).map(t=>({
    needsHardDate:false, needsByStart:"", needsByEnd:"",
    rtStatus:"", rtStatusDate:"", ...t,
    needsHardDate: t.needsHardDate??false,
    needsByStart:  t.needsByStart||"",
    needsByEnd:    t.needsByEnd||"",
  })),
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
  roughStartConfirmed:   raw?.roughStartConfirmed   ?? false,
  finishStartConfirmed:  raw?.finishStartConfirmed  ?? false,
  roughNeedsHardDate:    raw?.roughNeedsHardDate    ?? false,
  roughNeedsByStart:     raw?.roughNeedsByStart     || "",
  roughNeedsByEnd:       raw?.roughNeedsByEnd       || "",
  finishNeedsHardDate:   raw?.finishNeedsHardDate   ?? false,
  finishNeedsByStart:    raw?.finishNeedsByStart    || "",
  finishNeedsByEnd:      raw?.finishNeedsByEnd      || "",
  finishStatusDate:     raw?.finishStatusDate     || "",
  finishProjectedStart: raw?.finishProjectedStart || "",
  qcStatusDate:         raw?.qcStatusDate         || "",
});


// ── Temp Ped Detail ────────────────────────────────────────────
// ── Quick Job Detail ───────────────────────────────────────────
function QuickJobDetail({ job: rawJob, onUpdate, onClose, foremenList, leadsList }) {
  const [job, setJob] = useState(()=>({...normalizeJob(rawJob), quickJob:true}));
  const jobRef = useRef(job);
  useEffect(() => { jobRef.current = job; }, [job]);
  useEffect(() => { setJob({...normalizeJob(rawJob), quickJob:true}); }, [rawJob?.id, rawJob?.updated_at, rawJob?.foreman, rawJob?.lead]);

  const u = patch => {
    const updated = {...jobRef.current, ...patch};
    jobRef.current = updated;
    setJob(updated);
    onUpdate(updated, patch);
  };

  const [viewPhoto, setViewPhoto] = useState(null);
  const [emailData, setEmailData] = useState(null);

  const qjDef = getStatusDef(QUICK_JOB_STATUSES, job.quickJobStatus || "new");
  const typeDef = QUICK_JOB_TYPES.find(t => t.value === job.quickJobType) || QUICK_JOB_TYPES[3];
  const foreman = job.foreman || "Koy";

  // Photo handling — upload to Firebase Storage
  const [qjUploading, setQjUploading] = useState(false);
  const addPhotos = async (files) => {
    const existing = job.photos || [];
    const newPhotos = [];
    setQjUploading(true);
    for(const file of Array.from(files)) {
      try {
        const photoId = uid();
        const ext = file.name.split(".").pop() || "jpg";
        const storagePath = `jobs/${job.id}/photos/${photoId}.${ext}`;
        const storageRef = ref(storage, storagePath);
        await uploadBytes(storageRef, file);
        const url = await getDownloadURL(storageRef);
        newPhotos.push({id:photoId, name:file.name, url, storagePath});
      } catch(e) { console.error("Photo upload failed:", e); alert(`Failed to upload ${file.name}.`); }
    }
    if(newPhotos.length > 0) u({ photos: [...existing, ...newPhotos] });
    setQjUploading(false);
  };
  const deleteJobPhoto = async (photo) => {
    if(photo.storagePath) { try { await deleteObject(ref(storage, photo.storagePath)).catch(()=>{}); } catch(e){} }
    u({ photos: (job.photos || []).filter(x => x.id !== photo.id) });
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.82)", zIndex: 400,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 12 }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>

      <div onClick={e => e.stopPropagation()} style={{
        background: C.card, border: `1px solid ${C.border}`, borderRadius: 18,
        width: "100%", maxWidth: 680, maxHeight: "93vh", display: "flex",
        flexDirection: "column", overflow: "hidden", boxShadow: "0 40px 100px rgba(0,0,0,0.7)"
      }}>

        {/* Header */}
        <div style={{ padding: "16px 22px", borderBottom: `1px solid ${C.border}`,
          display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0, gap: 12 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
              <span style={{ fontSize: 10, fontWeight: 800, color: typeDef.color, letterSpacing: "0.08em",
                background: typeDef.color + "18", borderRadius: 99, padding: "2px 8px",
                border: `1px solid ${typeDef.color}33` }}>
                {typeDef.label.toUpperCase()}
              </span>
              <span style={{ fontSize: 10, fontWeight: 800, color: "#6b7280", letterSpacing: "0.08em",
                background: "#6b728018", borderRadius: 99, padding: "2px 8px",
                border: "1px solid #6b728033" }}>
                QUICK JOB
              </span>
              {job.readyToInvoice && (
                <span style={{ fontSize: 10, fontWeight: 800, color: "#ea580c", background: "#ea580c12",
                  borderRadius: 99, padding: "2px 8px", border: "1px solid #ea580c33" }}>READY TO INVOICE</span>
              )}
            </div>
            <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 22, letterSpacing: "0.06em",
              color: C.text, lineHeight: 1 }}>{job.name || "New Quick Job"}</div>
            <div style={{ fontSize: 11, color: C.dim, marginTop: 2 }}>
              {job.address ? <><AddressLink address={job.address} style={{color:C.dim}}/>{job.gc ? ` · ${job.gc}` : ""}</> : (job.gc||"No details yet")}
            </div>
          </div>
          <button onClick={onClose}
            style={{ background: "none", border: `1px solid ${C.border}`, borderRadius: 8,
              color: C.dim, cursor: "pointer", padding: "5px 14px", fontSize: 13, flexShrink: 0 }}>✕</button>
        </div>

        {/* Status bar */}
        <div style={{ padding: "12px 22px", borderBottom: `1px solid ${C.border}`,
          background: C.surface, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", flexShrink: 0 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: C.dim, letterSpacing: "0.08em" }}>STATUS</span>
          {QUICK_JOB_STATUSES.map(s => {
            const active = (job.quickJobStatus || "new") === s.value;
            return (
              <button key={s.value} onClick={() => {
                const patch = { quickJobStatus: s.value };
                if (s.value === "invoice") { patch.readyToInvoice = true; patch.readyToInvoiceDate = new Date().toLocaleDateString("en-US"); }
                if (s.value === "complete") { patch.readyToInvoice = true; patch.readyToInvoiceDate = new Date().toLocaleDateString("en-US"); }
                if (!s.hasDate) { patch.quickJobDate = job.quickJobDate; }
                u(patch);
              }} style={{
                padding: "5px 14px", fontSize: 11, fontWeight: active ? 700 : 500,
                borderRadius: 99, border: `1px solid ${active ? s.color : C.border}`,
                background: active ? `${s.color}22` : "none",
                color: active ? s.color : C.dim, cursor: "pointer", fontFamily: "inherit",
                transition: "all 0.15s",
              }}>{s.label}</button>
            );
          })}
        </div>

        {/* Scheduled date row */}
        {(job.quickJobStatus === "scheduled" || job.quickJobStatus === "inprogress") && (
          <div style={{ padding: "10px 22px", borderBottom: `1px solid ${C.border}`,
            background: `${C.blue}06`, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", flexShrink: 0 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", color: C.blue }}>SCHEDULED DATE</div>
              <DateInp value={job.quickJobDate || ""} onChange={e => u({ quickJobDate: e.target.value })}
                style={{ width: 140, fontSize: 11, borderColor: C.blue + "55", background: C.blue + "08" }} />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", color: C.blue }}>END DATE</div>
              <DateInp value={job.quickJobEndDate || ""} onChange={e => u({ quickJobEndDate: e.target.value })}
                style={{ width: 140, fontSize: 11, borderColor: C.blue + "55", background: C.blue + "08" }} />
            </div>
          </div>
        )}

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "20px 22px" }}>

          {/* Job Info */}
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 10, fontWeight: 800, color: C.dim, letterSpacing: "0.12em", marginBottom: 12 }}>JOB INFO</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
              {[["name", "Job Name"], ["address", "Address"], ["gc", "General Contractor / Customer"], ["phone", "Phone"], ["simproNo", "Simpro Job #"]].map(([k, l]) => (
                <div key={k}>
                  <div style={{ fontSize: 10, color: C.dim, marginBottom: 3 }}>{l}</div>
                  <Inp value={job[k] || ""} onChange={e => u({ [k]: e.target.value })} placeholder={l} />
                </div>
              ))}
              <div>
                <div style={{ fontSize: 10, color: C.dim, marginBottom: 3 }}>Foreman</div>
                <Sel value={job.foreman || "Koy"} onChange={e => u({ foreman: e.target.value })} options={[...(foremenList || getForemenList()), "Unassigned"]} />
              </div>
              <div>
                <div style={{ fontSize: 10, color: C.dim, marginBottom: 3 }}>Lead</div>
                <Sel value={job.lead || ""} onChange={e => u({ lead: e.target.value })} options={["", ...(leadsList || LEADS)]} />
              </div>
              <div>
                <div style={{ fontSize: 10, color: C.dim, marginBottom: 3 }}>Job Type</div>
                <select value={job.quickJobType || "service"} onChange={e => u({ quickJobType: e.target.value })}
                  style={{ width: "100%", background: C.surface, border: `1px solid ${C.border}`,
                    borderRadius: 7, color: C.text, padding: "7px 10px", fontSize: 12,
                    fontFamily: "inherit", outline: "none", cursor: "pointer" }}>
                  {QUICK_JOB_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
            </div>
            {/* Access Note */}
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 10, color: C.dim, marginBottom: 3 }}>Access Note (gate code, keybox, entry instructions)</div>
              <textarea value={job.accessNote || ""} onChange={e => u({ accessNote: e.target.value })}
                placeholder="e.g. Gate code: 1234 · Keybox on front door"
                rows={2} style={{ width: "100%", boxSizing: "border-box", background: C.surface,
                  border: `1px solid ${job.accessNote ? "#f59e0b" : C.border}`,
                  borderRadius: 8, padding: "8px 10px", fontSize: 12, fontFamily: "inherit",
                  color: C.text, resize: "vertical", outline: "none", lineHeight: 1.5 }} />
            </div>
            {/* Matterport links */}
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 10, color: C.dim, marginBottom: 6, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span>Matterport Links</span>
                <span onClick={() => {
                  const links = [...(job.matterportLinks || [])];
                  if (!links.length && job.matterportLink) links.push({ label: "Main", url: job.matterportLink });
                  links.push({ label: "", url: "" });
                  u({ matterportLinks: links });
                }} style={{ cursor: "pointer", fontSize: 10, fontWeight: 700, color: C.accent, padding: "2px 8px",
                  border: `1px solid ${C.accent}33`, borderRadius: 5, background: `${C.accent}10` }}>+ Add</span>
              </div>
              {(job.matterportLinks && job.matterportLinks.length > 0 ? job.matterportLinks : (job.matterportLink ? [{ label: "Main", url: job.matterportLink }] : [])).map((ml, mi) => (
                <div key={mi} style={{ display: "flex", gap: 4, alignItems: "center", marginBottom: 4 }}>
                  <Inp value={ml.label || ""} onChange={e => {
                    const links = [...(job.matterportLinks || (job.matterportLink ? [{ label: "Main", url: job.matterportLink }] : []))];
                    links[mi] = { ...links[mi], label: e.target.value };
                    u({ matterportLinks: links, matterportLink: links[0]?.url || "" });
                  }} placeholder="Label (e.g. Pool House)" style={{ width: 120, flexShrink: 0 }} />
                  <div style={{ flex: 1 }}>
                    <Inp value={ml.url || ""} onChange={e => {
                      const links = [...(job.matterportLinks || (job.matterportLink ? [{ label: "Main", url: job.matterportLink }] : []))];
                      links[mi] = { ...links[mi], url: e.target.value };
                      u({ matterportLinks: links, matterportLink: links[0]?.url || "" });
                    }} placeholder="Paste Matterport URL…" />
                  </div>
                  {ml.url && <a href={ml.url} target="_blank" rel="noopener noreferrer"
                    onClick={e => e.stopPropagation()}
                    style={{ fontSize: 11, fontWeight: 700, color: "#8b5cf6", background: "#8b5cf615", border: "1px solid #8b5cf633",
                      borderRadius: 7, padding: "6px 10px", textDecoration: "none", whiteSpace: "nowrap", cursor: "pointer" }}>
                    Open 🔗</a>}
                  <span onClick={() => {
                    const links = [...(job.matterportLinks || (job.matterportLink ? [{ label: "Main", url: job.matterportLink }] : []))];
                    links.splice(mi, 1);
                    u({ matterportLinks: links, matterportLink: links[0]?.url || "" });
                  }} style={{ cursor: "pointer", fontSize: 14, color: "#ef4444", padding: "4px", lineHeight: 1, flexShrink: 0 }}>✕</span>
                </div>
              ))}
              {!(job.matterportLinks?.length) && !job.matterportLink && <div style={{ fontSize: 11, color: C.muted, fontStyle: "italic" }}>No Matterport links yet — click + Add</div>}
            </div>
          </div>

          {/* Scope & Material */}
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 10, fontWeight: 800, color: C.dim, letterSpacing: "0.12em", marginBottom: 12 }}>SCOPE OF WORK</div>
            <TA value={job.scope || ""} onChange={e => u({ scope: e.target.value })}
              placeholder="Describe what needs to be done..." rows={4} />
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 10, color: C.dim, marginBottom: 3 }}>Material Needed</div>
              <TA value={job.material || ""} onChange={e => u({ material: e.target.value })}
                placeholder="List materials needed..." rows={3} />
            </div>
          </div>

          {/* Notes */}
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 10, fontWeight: 800, color: C.dim, letterSpacing: "0.12em", marginBottom: 12 }}>NOTES</div>
            <TA value={job.notes || ""} onChange={e => u({ notes: e.target.value })}
              placeholder="Additional notes, updates, follow-up..." rows={4} />
          </div>

          {/* Photos */}
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 10, fontWeight: 800, color: C.dim, letterSpacing: "0.12em", marginBottom: 12 }}>PHOTOS</div>
            {(job.photos || []).length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
                {(job.photos || []).map(p => (
                  <div key={p.id} style={{ position: "relative", width: 80, height: 80 }}>
                    <img src={p.url||p.dataUrl} alt={p.name} onClick={() => setViewPhoto(p.url||p.dataUrl)}
                      style={{ width: 80, height: 80, objectFit: "cover", borderRadius: 8, cursor: "pointer",
                        border: `1px solid ${C.border}` }} />
                    <button onClick={() => deleteJobPhoto(p)}
                      style={{ position: "absolute", top: -5, right: -5, background: "#dc2626", border: "none",
                        borderRadius: "50%", color: "#fff", width: 18, height: 18, fontSize: 10,
                        cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
                  </div>
                ))}
              </div>
            )}
            {qjUploading&&<div style={{fontSize:11,color:C.accent,fontWeight:600,marginBottom:8,
              padding:"6px 10px",background:`${C.accent}12`,border:`1px solid ${C.accent}33`,
              borderRadius:7}}>⏳ Uploading...</div>}
            <label style={{ display: "inline-flex", alignItems: "center", gap: 6,
              background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8,
              padding: "7px 14px", cursor: qjUploading?"not-allowed":"pointer",
              opacity: qjUploading?0.5:1, fontSize: 11, fontWeight: 600, color: C.dim }}>
              + Add Photos
              <input type="file" accept="image/*" multiple style={{ display: "none" }}
                disabled={qjUploading}
                onChange={e => { addPhotos(e.target.files); e.target.value = ""; }} />
            </label>
          </div>

          {/* Sign-off / Complete */}
          <div style={{ borderTop: `2px solid ${C.border}`, paddingTop: 20 }}>
            <div style={{ fontSize: 10, fontWeight: 800, color: C.dim, letterSpacing: "0.12em", marginBottom: 12 }}>
              SIGN-OFF & COMPLETE
            </div>
            {job.signedOff ? (
              <div style={{ background: `${C.green}12`, border: `1px solid ${C.green}33`,
                borderRadius: 10, padding: "12px 16px", display: "flex", alignItems: "center",
                justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: C.green }}>Completed & Signed Off</div>
                  <div style={{ fontSize: 11, color: C.dim, marginTop: 2 }}>
                    By {job.signedOffBy} · {job.signedOffDate}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  {job.readyToInvoice && !job.invoiceSent && (
                    <button onClick={() => u({ invoiceSent: true, readyToInvoice: false, invoiceDismissed: true, quickJobStatus: "invoice" })}
                      style={{ background: "#ea580c", border: "none", borderRadius: 7,
                        color: "#fff", fontSize: 11, fontWeight: 700, padding: "6px 14px",
                        cursor: "pointer", fontFamily: "inherit" }}>
                      ✓ Invoice Sent
                    </button>
                  )}
                  {job.invoiceSent && (
                    <span style={{ fontSize: 11, fontWeight: 700, color: "#16a34a", background: "#16a34a12",
                      borderRadius: 99, padding: "4px 12px", border: "1px solid #16a34a33" }}>
                      ✓ Invoice Sent
                    </span>
                  )}
                  <button onClick={() => u({ signedOff: false, signedOffBy: "", signedOffDate: "",
                    quickJobStatus: "inprogress", readyToInvoice: false, invoiceSent: false })}
                    style={{ background: "none", border: `1px solid ${C.border}`, borderRadius: 7,
                      color: C.dim, fontSize: 11, padding: "4px 10px", cursor: "pointer", fontFamily: "inherit" }}>
                    Undo
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <Inp value={job.signedOffBy || ""} onChange={e => u({ signedOffBy: e.target.value })}
                  placeholder="Completed by..." style={{ flex: "1 1 180px", minWidth: 140 }} />
                <button onClick={() => {
                  if (!job.signedOffBy?.trim()) return;
                  u({ signedOff: true, signedOffDate: new Date().toLocaleDateString("en-US"),
                    quickJobStatus: "complete", readyToInvoice: true,
                    readyToInvoiceDate: new Date().toLocaleDateString("en-US") });
                }} disabled={!job.signedOffBy?.trim()}
                  style={{ background: job.signedOffBy?.trim() ? C.green : "#374151", border: "none",
                    borderRadius: 8, color: job.signedOffBy?.trim() ? "#000" : C.dim, fontSize: 12,
                    fontWeight: 700, padding: "9px 20px", cursor: job.signedOffBy?.trim() ? "pointer" : "default",
                    fontFamily: "inherit", whiteSpace: "nowrap" }}>
                  Mark Complete
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Photo lightbox */}
      {viewPhoto && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.95)", zIndex: 1000,
          display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={() => setViewPhoto(null)}>
          <img src={viewPhoto} alt="photo"
            style={{ maxWidth: "95vw", maxHeight: "95vh", objectFit: "contain", borderRadius: 8 }} />
        </div>
      )}

      {emailData && <EmailModal subject={emailData.subject} body={emailData.body} onClose={() => setEmailData(null)} />}
    </div>
  );
}

function TempPedDetail({ job: rawJob, onUpdate, onClose, foremenList }) {
  const [job, setJob] = useState(()=>normalizeJob(rawJob));
  const jobRef = useRef(job);
  useEffect(()=>{ jobRef.current = job; }, [job]);
  useEffect(()=>{ setJob(normalizeJob(rawJob)); }, [rawJob?.id, rawJob?.updated_at, rawJob?.foreman, rawJob?.lead]);

  const u = patch => {
    const updated = {...jobRef.current, ...patch};
    jobRef.current = updated;
    setJob(updated);
    onUpdate(updated, patch);
  };

  const [signOffName, setSignOffName] = useState("");
  const [viewPhoto, setViewPhoto] = useState(null);

  const tpDef   = getStatusDef(TEMP_PED_STATUSES, job.tempPedStatus||"");
  const color   = tpDef.color || "#8b5cf6";
  const foreman = job.foreman||"Koy";
  const fc      = (({"Koy":"#3b82f6","Vasa":"#f97316","Colby":"#22c55e","Keegan":"#3b82f6","Gage":"#3b82f6","Daegan":"#3b82f6","Braden":"#22c55e","Treycen":"#22c55e","Jon":"#22c55e","Vasa":"#f97316","Abe":"#f97316","Louis":"#f97316","Jacob":"#6b7280"})[foreman]||"#6b7280")||"#6b7280";

  // Photo handling — upload to Firebase Storage
  const [tpUploading, setTpUploading] = useState(false);
  const addPhotos = async (files) => {
    const existing = job.tempPedPhotos || [];
    const newPhotos = [];
    setTpUploading(true);
    for(const file of Array.from(files)) {
      try {
        const photoId = uid();
        const ext = file.name.split(".").pop() || "jpg";
        const storagePath = `jobs/${job.id}/photos/${photoId}.${ext}`;
        const storageRef = ref(storage, storagePath);
        await uploadBytes(storageRef, file);
        const url = await getDownloadURL(storageRef);
        newPhotos.push({id:photoId, name:file.name, url, storagePath});
      } catch(e) { console.error("Photo upload failed:", e); alert(`Failed to upload ${file.name}.`); }
    }
    if(newPhotos.length > 0) u({tempPedPhotos:[...existing, ...newPhotos]});
    setTpUploading(false);
  };
  const deleteTpPhoto = async (photo) => {
    if(photo.storagePath) { try { await deleteObject(ref(storage, photo.storagePath)).catch(()=>{}); } catch(e){} }
    u({tempPedPhotos: (job.tempPedPhotos || []).filter(x => x.id !== photo.id)});
  };

  const handleSignOff = () => {
    if(!signOffName.trim()) return;
    u({
      tempPedStatus:"completed",
      tempPedSignedOff:true,
      tempPedSignedOffBy:signOffName.trim(),
      tempPedSignedOffDate:new Date().toLocaleDateString("en-US"),
      readyToInvoice:true,
    });
    setSignOffName("");
  };

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.82)",zIndex:400,
      display:"flex",alignItems:"center",justifyContent:"center",padding:12}}
      onClick={e=>{if(e.target===e.currentTarget)onClose();}}>

      <div onClick={e=>e.stopPropagation()} style={{
        background:C.card,border:`1px solid ${C.border}`,borderRadius:18,
        width:"100%",maxWidth:620,maxHeight:"93vh",display:"flex",
        flexDirection:"column",overflow:"hidden",boxShadow:"0 40px 100px rgba(0,0,0,0.7)"
      }}>

        {/* Header */}
        <div style={{padding:"16px 22px",borderBottom:`1px solid ${C.border}`,
          display:"flex",justifyContent:"space-between",alignItems:"center",flexShrink:0,gap:12}}>
          <div>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:2}}>
              <span style={{fontSize:10,fontWeight:800,color:"#8b5cf6",letterSpacing:"0.08em",
                background:"#8b5cf618",borderRadius:99,padding:"2px 8px",border:"1px solid #8b5cf633"}}>
                TEMP PED {job.tempPedNumber?"#"+job.tempPedNumber:""}
              </span>
              {job.tempPedStatus==="completed"&&(
                <span style={{fontSize:10,fontWeight:800,color:C.green,background:`${C.green}18`,
                  borderRadius:99,padding:"2px 8px",border:`1px solid ${C.green}33`}}>COMPLETE</span>
              )}
              {job.readyToInvoice&&(
                <span style={{fontSize:10,fontWeight:800,color:"#ea580c",background:"#ea580c12",
                  borderRadius:99,padding:"2px 8px",border:"1px solid #ea580c33"}}>READY TO INVOICE</span>
              )}
            </div>
            <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:22,letterSpacing:"0.06em",
              color:C.text,lineHeight:1}}>{job.name||"New Temp Ped"}</div>
            <div style={{fontSize:11,color:C.dim,marginTop:2}}>
              {job.address ? <><AddressLink address={job.address} style={{color:C.dim}}/>{job.gc ? ` · ${job.gc}` : ""}</> : (job.gc||"No details yet")}
            </div>
          </div>
          <button onClick={onClose}
            style={{background:"none",border:`1px solid ${C.border}`,borderRadius:8,
              color:C.dim,cursor:"pointer",padding:"5px 14px",fontSize:13,flexShrink:0}}>✕</button>
        </div>

        {/* Status bar */}
        <div style={{padding:"10px 22px",borderBottom:`1px solid ${C.border}`,
          background:C.surface,display:"flex",alignItems:"center",gap:10,flexWrap:"wrap",flexShrink:0}}>
          <span style={{fontSize:10,fontWeight:700,color:C.dim,letterSpacing:"0.08em"}}>STATUS</span>
          {TEMP_PED_STATUSES.filter(s=>s.value).map(s=>{
            const active = job.tempPedStatus===s.value;
            return (
              <button key={s.value} onClick={()=>{
                  const patch = {tempPedStatus:s.value};
                  if(s.value==="completed") { patch.readyToInvoice=true; }
                  if(s.value!=="scheduled") patch.tempPedScheduledDate="";
                  u(patch);
                }}
                style={{
                  padding:"5px 14px",fontSize:11,fontWeight:active?700:500,
                  borderRadius:99,border:`1px solid ${active?s.color:C.border}`,
                  background:active?`${s.color}22`:"none",
                  color:active?s.color:C.dim,cursor:"pointer",fontFamily:"inherit",
                  transition:"all 0.15s",
                }}>
                {s.label}
              </button>
            );
          })}
          {job.tempPedStatus==="scheduled"&&(
            <div style={{display:"flex",flexDirection:"column",gap:2}}>
              <div style={{fontSize:9,fontWeight:700,letterSpacing:"0.07em",color:"#2563eb"}}>SCHEDULED DATE</div>
              <DateInp value={job.tempPedScheduledDate||""} onChange={e=>u({tempPedScheduledDate:e.target.value})}
                style={{fontSize:11,padding:"4px 10px",width:140,
                  borderColor:"#2563eb55",background:"#2563eb08"}}/>
            </div>
          )}
        </div>

        {/* Body */}
        <div style={{flex:1,overflowY:"auto",padding:"20px 22px"}}>

          {/* Job Info */}
          <div style={{marginBottom:24}}>
            <div style={{fontSize:10,fontWeight:800,color:C.dim,letterSpacing:"0.12em",marginBottom:12}}>JOB INFO</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
              {[["name","Job Name"],["address","Address"],["gc","General Contractor"],["phone","GC Phone"],["simproNo","Simpro Job #"],["lead","Lead"]].map(([k,l])=>(
                <div key={k}>
                  <div style={{fontSize:10,color:C.dim,marginBottom:3}}>{l}</div>
                  <Inp value={job[k]||""} onChange={e=>u({[k]:e.target.value})} placeholder={l}/>
                </div>
              ))}
              <div>
                <div style={{fontSize:10,color:C.dim,marginBottom:3}}>Foreman</div>
                <Sel value={job.foreman||"Koy"} onChange={e=>u({foreman:e.target.value})} options={[...(foremenList||getForemenList()),"Unassigned"]}/>
              </div>
              <div>
                <div style={{fontSize:10,color:C.dim,marginBottom:3}}>Temp Ped #</div>
                <select value={job.tempPedNumber||""} onChange={e=>u({tempPedNumber:e.target.value})}
                  style={{width:"100%",background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,
                    color:job.tempPedNumber?C.text:C.dim,padding:"8px 10px",fontSize:13,
                    fontFamily:"inherit",outline:"none",cursor:"pointer"}}>
                  <option value="">Select #</option>
                  {["1","2","3","4","5","6","7","8","9","10"].map(n=><option key={n} value={n}>{n}</option>)}
                </select>
              </div>
            </div>
            <div style={{marginTop:10}}>
              <div style={{fontSize:10,color:C.dim,marginBottom:3}}>Notes</div>
              <textarea value={job.notes||""} onChange={e=>u({notes:e.target.value})}
                placeholder="Job notes…" rows={4}
                style={{width:"100%",background:C.surface,border:`1px solid ${C.border}`,
                  borderRadius:8,color:C.text,padding:"8px 10px",fontSize:12,
                  fontFamily:"inherit",resize:"vertical",outline:"none",lineHeight:1.5}}/>
            </div>
            {/* Matterport links */}
            <div style={{marginTop:10}}>
              <div style={{fontSize:10,color:C.dim,marginBottom:6,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                <span>Matterport Links</span>
                <span onClick={()=>{
                  const links=[...(job.matterportLinks||[])];
                  if(!links.length && job.matterportLink) links.push({label:"Main",url:job.matterportLink});
                  links.push({label:"",url:""});
                  u({matterportLinks:links});
                }} style={{cursor:"pointer",fontSize:10,fontWeight:700,color:C.accent,padding:"2px 8px",
                  border:`1px solid ${C.accent}33`,borderRadius:5,background:`${C.accent}10`}}>+ Add</span>
              </div>
              {(job.matterportLinks && job.matterportLinks.length>0 ? job.matterportLinks : (job.matterportLink ? [{label:"Main",url:job.matterportLink}] : [])).map((ml,mi)=>(
                <div key={mi} style={{display:"flex",gap:4,alignItems:"center",marginBottom:4}}>
                  <Inp value={ml.label||""} onChange={e=>{
                    const links=[...(job.matterportLinks||(job.matterportLink?[{label:"Main",url:job.matterportLink}]:[]))];
                    links[mi]={...links[mi],label:e.target.value};
                    u({matterportLinks:links, matterportLink:links[0]?.url||""});
                  }} placeholder="Label (e.g. Pool House)" style={{width:120,flexShrink:0}}/>
                  <div style={{flex:1}}>
                    <Inp value={ml.url||""} onChange={e=>{
                      const links=[...(job.matterportLinks||(job.matterportLink?[{label:"Main",url:job.matterportLink}]:[]))];
                      links[mi]={...links[mi],url:e.target.value};
                      u({matterportLinks:links, matterportLink:links[0]?.url||""});
                    }} placeholder="Paste Matterport URL…"/>
                  </div>
                  {ml.url&&<a href={ml.url} target="_blank" rel="noopener noreferrer"
                    onClick={e=>e.stopPropagation()}
                    style={{fontSize:11,fontWeight:700,color:"#8b5cf6",background:"#8b5cf615",border:"1px solid #8b5cf633",
                      borderRadius:7,padding:"6px 10px",textDecoration:"none",whiteSpace:"nowrap",cursor:"pointer"}}>
                    Open 🔗</a>}
                  <span onClick={()=>{
                    const links=[...(job.matterportLinks||(job.matterportLink?[{label:"Main",url:job.matterportLink}]:[]))];
                    links.splice(mi,1);
                    u({matterportLinks:links, matterportLink:links[0]?.url||""});
                  }} style={{cursor:"pointer",fontSize:14,color:"#ef4444",padding:"4px",lineHeight:1,flexShrink:0}}>✕</span>
                </div>
              ))}
              {!(job.matterportLinks?.length) && !job.matterportLink && <div style={{fontSize:11,color:C.muted,fontStyle:"italic"}}>No Matterport links yet — click + Add</div>}
            </div>
          </div>

          {/* Photos */}
          <div style={{marginBottom:24}}>
            <div style={{fontSize:10,fontWeight:800,color:C.dim,letterSpacing:"0.12em",marginBottom:12}}>PHOTOS</div>
            {(job.tempPedPhotos||[]).length>0&&(
              <div style={{display:"flex",flexWrap:"wrap",gap:8,marginBottom:10}}>
                {(job.tempPedPhotos||[]).map(p=>(
                  <div key={p.id} style={{position:"relative",width:80,height:80}}>
                    <img src={p.url||p.dataUrl} alt={p.name} onClick={()=>setViewPhoto(p.url||p.dataUrl)}
                      style={{width:80,height:80,objectFit:"cover",borderRadius:8,cursor:"pointer",
                        border:`1px solid ${C.border}`}}/>
                    <button onClick={()=>deleteTpPhoto(p)}
                      style={{position:"absolute",top:-5,right:-5,background:"#dc2626",border:"none",
                        borderRadius:"50%",color:"#fff",width:18,height:18,fontSize:10,
                        cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",
                        lineHeight:1}}>✕</button>
                  </div>
                ))}
              </div>
            )}
            {tpUploading&&<div style={{fontSize:11,color:C.accent,fontWeight:600,marginBottom:8,
              padding:"6px 10px",background:`${C.accent}12`,border:`1px solid ${C.accent}33`,
              borderRadius:7}}>⏳ Uploading...</div>}
            <label style={{display:"inline-flex",alignItems:"center",gap:6,
              background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,
              padding:"7px 14px",cursor:tpUploading?"not-allowed":"pointer",
              opacity:tpUploading?0.5:1,fontSize:11,fontWeight:600,color:C.dim}}>
              + Add Photos
              <input type="file" accept="image/*" multiple style={{display:"none"}}
                disabled={tpUploading}
                onChange={e=>{addPhotos(e.target.files);e.target.value="";}}/>
            </label>
          </div>

          {/* Sign-off / Complete */}
          <div style={{borderTop:`2px solid ${C.border}`,paddingTop:20}}>
            <div style={{fontSize:10,fontWeight:800,color:C.dim,letterSpacing:"0.12em",marginBottom:12}}>
              SIGN-OFF & COMPLETE
            </div>
            {job.tempPedSignedOff ? (
              <div style={{background:`${C.green}12`,border:`1px solid ${C.green}33`,
                borderRadius:10,padding:"12px 16px",display:"flex",alignItems:"center",
                justifyContent:"space-between",gap:10,flexWrap:"wrap"}}>
                <div>
                  <div style={{fontSize:12,fontWeight:700,color:C.green}}>Completed & Signed Off</div>
                  <div style={{fontSize:11,color:C.dim,marginTop:2}}>
                    By {job.tempPedSignedOffBy} · {job.tempPedSignedOffDate}
                  </div>
                </div>
                <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                  {job.readyToInvoice&&!job.invoiceSent&&(
                    <button onClick={()=>u({invoiceSent:true,readyToInvoice:false,invoiceDismissed:true})}
                      style={{background:"#ea580c",border:"none",borderRadius:7,
                        color:"#fff",fontSize:11,fontWeight:700,padding:"6px 14px",cursor:"pointer",fontFamily:"inherit"}}>
                      ✓ Invoice Sent
                    </button>
                  )}
                  {job.invoiceSent&&(
                    <span style={{fontSize:11,fontWeight:700,color:"#16a34a",background:"#16a34a12",
                      borderRadius:99,padding:"4px 12px",border:"1px solid #16a34a33"}}>
                      ✓ Invoice Sent
                    </span>
                  )}
                  <button onClick={()=>u({tempPedSignedOff:false,tempPedSignedOffBy:"",
                    tempPedSignedOffDate:"",tempPedStatus:"scheduled",readyToInvoice:false,invoiceSent:false})}
                    style={{background:"none",border:`1px solid ${C.border}`,borderRadius:7,
                      color:C.dim,fontSize:11,padding:"4px 10px",cursor:"pointer",fontFamily:"inherit"}}>
                    Undo
                  </button>
                </div>
              </div>
            ) : (
              <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                <Inp value={signOffName} onChange={e=>setSignOffName(e.target.value)}
                  placeholder="Completed by…"
                  style={{flex:"1 1 180px",minWidth:140}}/>
                <button onClick={handleSignOff} disabled={!signOffName.trim()}
                  style={{background:signOffName.trim()?C.green:"#374151",border:"none",
                    borderRadius:8,color:signOffName.trim()?"#000":C.dim,fontSize:12,
                    fontWeight:700,padding:"9px 20px",cursor:signOffName.trim()?"pointer":"default",
                    fontFamily:"inherit",transition:"all 0.2s",whiteSpace:"nowrap"}}>
                  Mark Complete
                </button>
              </div>
            )}
          </div>

        </div>
      </div>

      {/* Photo lightbox */}
      {viewPhoto&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.95)",zIndex:1000,
          display:"flex",alignItems:"center",justifyContent:"center"}}
          onClick={()=>setViewPhoto(null)}>
          <img src={viewPhoto} alt="photo"
            style={{maxWidth:"95vw",maxHeight:"95vh",objectFit:"contain",borderRadius:8}}/>
        </div>
      )}
    </div>
  );
}

function JobDetail({job: rawJob, onUpdate, onClose, foremenList, leadsList}) {

  const [job, setJob] = useState(()=>normalizeJob(rawJob));

  // Re-sync local state when Firestore pushes updated data
  useEffect(()=>{ setJob(normalizeJob(rawJob)); }, [rawJob?.id, rawJob?.updated_at, rawJob?.foreman, rawJob?.lead]);

  const jobRef = useRef(job);
  useEffect(()=>{ jobRef.current = job; }, [job]);

  const u = patch => {
    const updated = {...jobRef.current, ...patch};
    jobRef.current = updated;
    setJob(updated);
    onUpdate(updated, patch);
  };

  const [tab, setTab] = useState("Job Info");
  const [newLightingFloor, setNewLightingFloor] = useState("");
  const [emailData, setEmailData] = useState(null);
  const [gcAnswers, setGcAnswers] = useState(null); // answers submitted by GC/homeowner via share link
  const [lvCollab, setLvCollab] = useState(null); // lighting collab data from LV company

  const [refreshing, setRefreshing] = useState(false);

  // Live listener for GC question answers + LV lighting collab
  useEffect(() => {
    const unsub = onSnapshot(doc(db,'homeowner_requests',job.id), snap => {
      if(snap.exists() && snap.data().questionAnswers) setGcAnswers(snap.data().questionAnswers);
      else setGcAnswers(null);
      if(snap.exists() && snap.data().lightingCollab) setLvCollab(snap.data().lightingCollab);
      else setLvCollab(null);
    }, ()=>{});
    return ()=>unsub();
  }, [job.id]);

  // Auto-apply GC answers — mark each answered question as done and fill in the answer
  const appliedGcRef = useRef(null);
  useEffect(() => {
    if(!gcAnswers?.answeredAt) return;
    if(appliedGcRef.current === gcAnswers.answeredAt) return; // already applied this batch
    appliedGcRef.current = gcAnswers.answeredAt;
    const applyPhase = (current, gcPhase) => {
      let changed = false;
      const updated = {};
      ['upper','main','basement'].forEach(floor => {
        updated[floor] = (current?.[floor]||[]).map(q => {
          const gcAns = (gcPhase?.[floor]||[]).find(a=>a.id===q.id);
          if(gcAns?.answer && !q.done) { changed=true; return {...q, answer:gcAns.answer, done:true, gcAnswered:true}; }
          return q;
        });
      });
      return {updated, changed};
    };
    const {updated:newRough, changed:rc} = applyPhase(jobRef.current.roughQuestions, gcAnswers.rough);
    const {updated:newFinish, changed:fc} = applyPhase(jobRef.current.finishQuestions, gcAnswers.finish);
    if(rc) u({roughQuestions: newRough});
    if(fc) u({finishQuestions: newFinish});
  }, [gcAnswers?.answeredAt]);

  const refreshJob = async () => {

    setRefreshing(true);

    try {

      const snap = await getDoc(doc(db,"jobs",job.id));

      if(snap.exists()&&snap.data()?.data) {
        // Only update local state — do NOT write back to Firestore (it's already there)
        const fresh = normalizeJob(snap.data().data);
        jobRef.current = fresh;
        setJob(fresh);
      }

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

  const pendingCOs = (job.changeOrders||[]).filter(c=>c.coStatus!=="completed"&&c.coStatus!=="denied"&&c.coStatus!=="converted").length;

  const qcCount = countFloor(job.qcPunch?.upper||{}) + countFloor(job.qcPunch?.main||{}) + countFloor(job.qcPunch?.basement||{}) +
    (job.qcPunch?.extras||[]).reduce((s,e)=>s+countFloor(job.qcPunch?.[e.key]||{}),0);


  return (

    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.82)",zIndex:400,

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

              {job.address ? <><AddressLink address={job.address} style={{color:C.dim}}/>{job.gc ? ` · ${job.gc}` : ""}</> : (job.gc||"No details yet")}

            </div>

            {job.accessNote&&(
              <div style={{display:"inline-flex",alignItems:"center",gap:5,marginTop:4,
                fontSize:11,color:"#92400e",background:"#fef3c7",
                border:"1px solid #fde68a",borderRadius:7,padding:"3px 9px"}}>
                {job.accessNote}
              </div>
            )}

          </div>

          <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap",justifyContent:"flex-end"}}>

            {openCount>0  &&<Pill label={`${openCount} open punch`} color={C.red}/>}

            {pendingCOs>0 &&<Pill label={`${pendingCOs} CO pending`} color={C.orange}/>}

            {(job.returnTrips||[]).filter(r=>!r.signedOff).length>0&&

              <Pill label={`${(job.returnTrips||[]).filter(r=>!r.signedOff).length} return trip${(job.returnTrips||[]).filter(r=>!r.signedOff).length>1?"s":""} pending`} color={C.red}/>}

            {qcCount>0&&<Pill label={`${qcCount} QC item${qcCount!==1?"s":""}`} color={C.red}/>}

            

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

              <Section label="Rough Stage" color={C.rough} defaultOpen={true}>
                {(()=>{
                  const rsDef = getStatusDef(ROUGH_STATUSES, job.roughStatus);
                  return (
                    <div style={{marginBottom:12}}>
                      <div style={{display:"flex",gap:16,marginBottom:12,flexWrap:"wrap"}}>
                        <div style={{flex:1,minWidth:140}}>
                          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:5}}>
                            <span style={{fontSize:10,color:job.roughStartConfirmed?"#16a34a":C.dim,fontWeight:700,letterSpacing:"0.08em"}}>
                              {job.roughStartConfirmed ? "READY TO START" : "PROJECTED START"}
                            </span>
                            <button onClick={()=>{
                              const confirm=!job.roughStartConfirmed;
                              u({roughStartConfirmed:confirm,
                                ...(confirm?{roughStatus:"date_confirmed"}:
                                  (job.roughStatus==="date_confirmed"?{roughStatus:"waiting_date"}:{}))
                              });
                            }}
                              style={{display:"flex",alignItems:"center",gap:4,padding:"2px 8px",borderRadius:99,
                                fontSize:9,fontWeight:700,cursor:"pointer",fontFamily:"inherit",border:"none",
                                background:job.roughStartConfirmed?"#16a34a18":"#6b728018",
                                color:job.roughStartConfirmed?"#16a34a":"#6b7280",
                                transition:"all 0.15s"}}>
                              {job.roughStartConfirmed ? "✓ CONFIRMED" : "○ CONFIRM"}
                            </button>
                          </div>
                          <DateInp value={job.roughProjectedStart||""} onChange={e=>{
                              const patch={roughProjectedStart:e.target.value};
                              // Auto-advance to "Waiting for Start Date Confirmation" when a date is entered and no status is set yet
                              if(e.target.value && !job.roughStatus) patch.roughStatus="waiting_date";
                              u(patch);
                            }}
                            style={{fontSize:13,fontWeight:700,
                              borderColor:(job.roughStartConfirmed?"#16a34a":C.rough)+"55",
                              background:job.roughStartConfirmed?"#16a34a08":`${C.rough}08`,
                              color:job.roughStartConfirmed?"#16a34a":C.rough}}/>
                          {job.roughStartConfirmed&&<div style={{fontSize:9,color:"#16a34a",fontWeight:700,marginTop:3,letterSpacing:"0.06em"}}>✓ START DATE CONFIRMED</div>}
                        </div>
                        <div style={{flex:1,minWidth:140}}>
                          <div style={{fontSize:10,color:C.dim,fontWeight:700,letterSpacing:"0.08em",marginBottom:5}}>4-WAY TARGET DATE</div>
                          <DateInp value={job.fourWayTargetDate||""} onChange={e=>u({fourWayTargetDate:e.target.value})}
                            style={{fontSize:13,fontWeight:700,borderColor:C.rough+"55",background:`${C.rough}08`,color:C.rough}}/>
                        </div>
                      </div>
                      <div style={{fontSize:10,color:C.dim,fontWeight:700,letterSpacing:"0.08em",marginBottom:6}}>STATUS</div>
                      <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                        <select value={job.roughStatus||""} onChange={e=>{
                          const v=e.target.value;
                          const def=getStatusDef(ROUGH_STATUSES,v);
                          u({roughStatus:v, roughOnHold:v==="waiting", roughScheduled:v==="scheduled",
                            roughStartConfirmed:v==="date_confirmed"?true:(v==="scheduled"||v==="inprogress"||v==="complete"||v==="waiting"||v==="invoice")?job.roughStartConfirmed:false,
                            roughStatusDate:def.hasDate?job.roughStatusDate:"",
                            readyToInvoice:v==="invoice"?true:(job.roughStatus==="invoice"?false:job.readyToInvoice),
                            ...(v==="invoice"&&!job.readyToInvoice?{readyToInvoiceDate:new Date().toLocaleDateString("en-US")}:{}),
                            roughProjectedStart:v==="scheduled"?job.roughProjectedStart:job.roughProjectedStart,
                            // Reset deposit dismissed when rescheduled so task reappears
                            ...(v==="scheduled"?{roughDepositDismissed:false}:{}),
                            // Reset invoice dismissed when status changes away from complete/invoice
                            ...((v!=="complete"&&v!=="invoice")?{roughInvoiceDismissed:false}:{}),
                          });
                        }} style={{background:rsDef.color?`${rsDef.color}18`:C.surface,
                          color:rsDef.color||C.dim, border:`1px solid ${rsDef.color||C.border}`,
                          borderRadius:7,padding:"7px 10px",fontSize:12,fontFamily:"inherit",
                          fontWeight:rsDef.color?700:400,outline:"none",cursor:"pointer"}}>
                          {ROUGH_STATUSES.map(s=><option key={s.value} value={s.value}>{s.label}</option>)}
                        </select>
                        {rsDef.hasDate&&job.roughStatus!=="date_confirmed"&&(
                          <div style={{display:"flex",flexDirection:"column",gap:3}}>
                            <div style={{fontSize:9,fontWeight:700,letterSpacing:"0.08em",color:rsDef.color}}>SCHEDULED DATE</div>
                            <DateInp value={job.roughStatusDate||""} onChange={e=>u({roughStatusDate:e.target.value})}
                              style={{width:130,fontSize:12,borderColor:rsDef.color+"55",background:`${rsDef.color}08`}}/>
                          </div>
                        )}
                        {rsDef.hasDate&&(job.roughStatus==="scheduled"||job.roughStatus==="inprogress")&&(
                          <div style={{display:"flex",flexDirection:"column",gap:3}}>
                            <div style={{fontSize:9,fontWeight:700,letterSpacing:"0.08em",color:rsDef.color}}>SCHEDULED END</div>
                            <DateInp value={job.roughScheduledEnd||""} onChange={e=>u({roughScheduledEnd:e.target.value})}
                              style={{width:130,fontSize:12,borderColor:rsDef.color+"55",background:`${rsDef.color}08`}}/>
                          </div>
                        )}
                      </div>


                    </div>
                  );
                })()}
                <Sel value={job.roughStage} onChange={e=>{const v=e.target.value;const pct=parseInt(v)||0;const qcFire=pct>=80&&!job.roughQCTaskFired?{roughQCTaskFired:true}:{};const prepDone=pct>0&&job.prepStage!=="Job Prep Complete"?{prepStage:"Job Prep Complete"}:{};u({roughStage:v,...qcFire,...prepDone,...(v==="100%"?{roughStatus:"complete",readyToInvoice:true,readyToInvoiceDate:new Date().toLocaleDateString("en-US")}:pct>0?{roughStatus:"inprogress"}:{})});}} options={ROUGH_STAGES}/>

                <div style={{marginTop:8,marginBottom:20}}>

                  <StageBar stages={ROUGH_STAGES} current={job.roughStage} color={C.rough}/>

                </div>

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
                <Section label="Questions" color={C.rough} action={
                  <button onClick={()=>{
                    const link=`${window.location.origin}/?questions=${job.id}`;
                    navigator.clipboard.writeText(link).then(()=>alert('Link copied! Send this to your GC or homeowner:\n\n'+link)).catch(()=>alert('Link:\n'+link));
                  }} style={{fontSize:10,fontWeight:700,color:'#fff',background:C.rough,border:'none',borderRadius:6,padding:'4px 10px',cursor:'pointer',fontFamily:'inherit',letterSpacing:'0.04em'}}>
                    📤 SHARE LINK
                  </button>
                }>
                  {(()=>{const m={};['upper','main','basement'].forEach(f=>(gcAnswers?.rough?.[f]||[]).forEach(a=>{if(a.answer&&!((job.roughQuestions?.[f]||[]).find(q=>q.id===a.id)?.done))m[a.id]=a.answer;}));return <QASection questions={job.roughQuestions||{upper:[],main:[],basement:[]}} onChange={v=>u({roughQuestions:v})} color={C.rough} gcAnswerMap={m}/>;})()}
                  {gcAnswers?.answeredBy&&<div style={{fontSize:10,color:'#16a34a',marginTop:6}}>✅ Answered by {gcAnswers.answeredBy} · {gcAnswers.answeredAt?new Date(gcAnswers.answeredAt).toLocaleDateString('en-US',{month:'short',day:'numeric'}):''}
                  </div>}
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
                          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:5}}>
                            <span style={{fontSize:10,color:job.finishStartConfirmed?"#16a34a":C.dim,fontWeight:700,letterSpacing:"0.08em"}}>
                              {job.finishStartConfirmed ? "READY TO START" : "PROJECTED START"}
                            </span>
                            <button onClick={()=>{
                              const confirm=!job.finishStartConfirmed;
                              u({finishStartConfirmed:confirm,
                                ...(confirm?{finishStatus:"date_confirmed"}:
                                  (job.finishStatus==="date_confirmed"?{finishStatus:"waiting_date"}:{}))
                              });
                            }}
                              style={{display:"flex",alignItems:"center",gap:4,padding:"2px 8px",borderRadius:99,
                                fontSize:9,fontWeight:700,cursor:"pointer",fontFamily:"inherit",border:"none",
                                background:job.finishStartConfirmed?"#16a34a18":"#6b728018",
                                color:job.finishStartConfirmed?"#16a34a":"#6b7280",
                                transition:"all 0.15s"}}>
                              {job.finishStartConfirmed ? "✓ CONFIRMED" : "○ CONFIRM"}
                            </button>
                          </div>
                          <DateInp value={job.finishProjectedStart||""} onChange={e=>{
                              const patch={finishProjectedStart:e.target.value};
                              // Auto-advance to "Waiting for Start Date Confirmation" when a date is entered and no status is set yet
                              if(e.target.value && !job.finishStatus) patch.finishStatus="waiting_date";
                              u(patch);
                            }}
                            style={{fontSize:13,fontWeight:700,
                              borderColor:(job.finishStartConfirmed?"#16a34a":C.finish)+"55",
                              background:job.finishStartConfirmed?"#16a34a08":`${C.finish}08`,
                              color:job.finishStartConfirmed?"#16a34a":C.finish}}/>
                          {job.finishStartConfirmed&&<div style={{fontSize:9,color:"#16a34a",fontWeight:700,marginTop:3,letterSpacing:"0.06em"}}>✓ START DATE CONFIRMED</div>}
                        </div>
                        <div style={{flex:1,minWidth:140}}>
                          <div style={{fontSize:10,color:C.dim,fontWeight:700,letterSpacing:"0.08em",marginBottom:5}}>FINAL INSPECTION TARGET DATE</div>
                          <DateInp value={job.finalInspectionTargetDate||""} onChange={e=>u({finalInspectionTargetDate:e.target.value})}
                            style={{fontSize:13,fontWeight:700,borderColor:C.finish+"55",background:`${C.finish}08`,color:C.finish}}/>
                        </div>
                      </div>
                      <div style={{fontSize:10,color:C.dim,fontWeight:700,letterSpacing:"0.08em",marginBottom:6}}>STATUS</div>
                      <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                        <select value={job.finishStatus||""} onChange={e=>{
                          const v=e.target.value;
                          const def=getStatusDef(FINISH_STATUSES,v);
                          u({finishStatus:v, finishOnHold:v==="waiting", finishScheduled:v==="scheduled",
                            finishStartConfirmed:v==="date_confirmed"?true:(v==="scheduled"||v==="inprogress"||v==="complete"||v==="waiting"||v==="invoice")?job.finishStartConfirmed:false,
                            finishStatusDate:def.hasDate?job.finishStatusDate:"",
                            readyToInvoice:v==="invoice"?true:(job.finishStatus==="invoice"?false:job.readyToInvoice),
                            ...(v==="invoice"&&!job.readyToInvoice?{readyToInvoiceDate:new Date().toLocaleDateString("en-US")}:{}),
                            finishProjectedStart:v==="scheduled"?job.finishProjectedStart:job.finishProjectedStart,
                            // Reset deposit dismissed when rescheduled so task reappears
                            ...(v==="scheduled"?{finishDepositDismissed:false}:{}),
                            // Reset invoice dismissed when status changes away from complete/invoice
                            ...((v!=="complete"&&v!=="invoice")?{finishInvoiceDismissed:false}:{}),
                          });
                        }} style={{background:fsDef.color?`${fsDef.color}18`:C.surface,
                          color:fsDef.color||C.dim, border:`1px solid ${fsDef.color||C.border}`,
                          borderRadius:7,padding:"7px 10px",fontSize:12,fontFamily:"inherit",
                          fontWeight:fsDef.color?700:400,outline:"none",cursor:"pointer"}}>
                          {FINISH_STATUSES.map(s=><option key={s.value} value={s.value}>{s.label}</option>)}
                        </select>
                        {fsDef.hasDate&&job.finishStatus!=="date_confirmed"&&(
                          <div style={{display:"flex",flexDirection:"column",gap:3}}>
                            <div style={{fontSize:9,fontWeight:700,letterSpacing:"0.08em",color:fsDef.color}}>SCHEDULED DATE</div>
                            <DateInp value={job.finishStatusDate||""} onChange={e=>u({finishStatusDate:e.target.value})}
                              style={{width:130,fontSize:12,borderColor:fsDef.color+"55",background:`${fsDef.color}08`}}/>
                          </div>
                        )}
                        {fsDef.hasDate&&(job.finishStatus==="scheduled"||job.finishStatus==="inprogress")&&(
                          <div style={{display:"flex",flexDirection:"column",gap:3}}>
                            <div style={{fontSize:9,fontWeight:700,letterSpacing:"0.08em",color:fsDef.color}}>SCHEDULED END</div>
                            <DateInp value={job.finishScheduledEnd||""} onChange={e=>u({finishScheduledEnd:e.target.value})}
                              style={{width:130,fontSize:12,borderColor:fsDef.color+"55",background:`${fsDef.color}08`}}/>
                          </div>
                        )}
                      </div>


                    </div>
                  );
                })()}
                <Sel value={job.finishStage} onChange={e=>{const v=e.target.value;const pct=parseInt(v)||0;u({finishStage:v,...(v==="100%"?{finishStatus:"complete",readyToInvoice:true,readyToInvoiceDate:new Date().toLocaleDateString("en-US")}:pct>0?{finishStatus:"inprogress"}:{})});}} options={FINISH_STAGES}/>
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
                <Section label="Questions" color={C.finish} action={
                  <button onClick={()=>{
                    const link=`${window.location.origin}/?questions=${job.id}`;
                    navigator.clipboard.writeText(link).then(()=>alert('Link copied! Send this to your GC or homeowner:\n\n'+link)).catch(()=>alert('Link:\n'+link));
                  }} style={{fontSize:10,fontWeight:700,color:'#fff',background:C.finish,border:'none',borderRadius:6,padding:'4px 10px',cursor:'pointer',fontFamily:'inherit',letterSpacing:'0.04em'}}>
                    📤 SHARE LINK
                  </button>
                }>
                  {(()=>{const m={};['upper','main','basement'].forEach(f=>(gcAnswers?.finish?.[f]||[]).forEach(a=>{if(a.answer&&!((job.finishQuestions?.[f]||[]).find(q=>q.id===a.id)?.done))m[a.id]=a.answer;}));return <QASection questions={job.finishQuestions||{upper:[],main:[],basement:[]}} onChange={v=>u({finishQuestions:v})} color={C.finish} gcAnswerMap={m}/>;})()}
                  {gcAnswers?.answeredBy&&<div style={{fontSize:10,color:'#16a34a',marginTop:6}}>✅ Answered by {gcAnswers.answeredBy} · {gcAnswers.answeredAt?new Date(gcAnswers.answeredAt).toLocaleDateString('en-US',{month:'short',day:'numeric'}):''}
                  </div>}
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

              {/* Share Collab Link */}
              <div style={{marginBottom:16,display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
                <button onClick={()=>{
                  const link=`${window.location.origin}/?lighting=${job.id}`;
                  navigator.clipboard.writeText(link).then(()=>alert('✓ Lighting collab link copied!\n\nThe low voltage company can view assignments and add their module/channel info.')).catch(()=>alert('Link:\n'+link));
                }} style={{background:`${C.purple}15`,border:`1px solid ${C.purple}44`,borderRadius:8,
                  color:C.purple,fontSize:12,fontWeight:700,padding:'7px 14px',cursor:'pointer',fontFamily:'inherit'}}>
                  📤 Share with LV Company
                </button>
                <span style={{fontSize:11,color:C.dim}}>LV company can add module/channel assignments</span>
              </div>

              {/* Lighting Control System Selector */}


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

              {(job.panelizedLighting.extraFloors||[]).map(ef=>(
                <KeypadSection key={ef.key} label={`${ef.label} Keypad Loads`}
                  loads={(job.panelizedLighting[ef.key+"_keypad"])||[]}
                  onChange={v=>u({panelizedLighting:{...job.panelizedLighting,[ef.key+"_keypad"]:v}})}/>
              ))}

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

              {(job.panelizedLighting.extraFloors||[]).map(ef=>(
                <div key={ef.key} style={{marginBottom:16}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",
                    marginBottom:8,paddingBottom:4,borderBottom:`1px solid ${C.border}`}}>
                    <div style={{fontSize:11,color:C.purple,fontWeight:700,letterSpacing:"0.08em",
                      textTransform:"uppercase"}}>{ef.label}</div>
                    <button onClick={()=>{
                      const newExtras=(job.panelizedLighting.extraFloors||[]).filter(e=>e.key!==ef.key);
                      const updated={...job.panelizedLighting,extraFloors:newExtras};
                      delete updated[ef.key+"_keypad"];
                      u({panelizedLighting:updated});
                    }} style={{background:"none",border:"none",color:C.muted,cursor:"pointer",fontSize:11}}>Remove</button>
                  </div>
                  <CP4LoadsSection
                    loads={(job.panelizedLighting[ef.key])||[]}
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
                      onKeyDown={e=>e.key==="Enter"&&addFloor()}
                      placeholder="Add floor / area…"
                      style={{flex:1,minWidth:160,background:C.surface,border:`1px solid ${C.border}`,
                        borderRadius:7,padding:"7px 10px",fontSize:12,fontFamily:"inherit",
                        outline:"none",color:C.text}}/>
                    <button onClick={addFloor}
                      style={{background:C.purple,color:"#fff",border:"none",borderRadius:7,
                        padding:"7px 14px",fontSize:12,fontWeight:700,cursor:"pointer",
                        fontFamily:"inherit",whiteSpace:"nowrap"}}>
                      + Add Floor / Area
                    </button>
                  </div>
                );
              })()}

              {/* LV Company Additions */}
              {lvCollab&&(()=>{
                const hasAny = [
                  ...(lvCollab.mainKeypad||[]),
                  ...(lvCollab.basementKeypad||[]),
                  ...(lvCollab.upperKeypad||[]),
                  ...(Object.keys(lvCollab).filter(k=>k.startsWith('pl_')).flatMap(k=>lvCollab[k]||[])),
                  ...(lvCollab.generalNotes?[1]:[]),
                ].length > 0;
                if(!hasAny) return null;
                const LVBadge = ()=><span style={{fontSize:9,fontWeight:800,color:'#7c3aed',background:'#ede9fe',borderRadius:4,padding:'1px 5px',marginRight:6,flexShrink:0}}>LV</span>;
                const renderLVRows = (rows) => rows&&rows.length>0?(
                  <div style={{marginBottom:8}}>
                    {rows.map((r,i)=>(
                      <div key={i} style={{display:'flex',alignItems:'flex-start',gap:8,padding:'5px 10px',
                        background:'#faf5ff',border:'1px solid #c4b5fd44',borderRadius:7,marginBottom:4}}>
                        <LVBadge/>
                        <div style={{flex:1}}>
                          <div style={{fontSize:12,color:'#6d28d9',fontWeight:600}}>{r.name||'—'}</div>
                          {r.module&&<div style={{fontSize:11,color:'#7c3aed',marginTop:1}}>Module/Ch: {r.module}</div>}
                          {r.notes&&<div style={{fontSize:11,color:'#8b5cf6',fontStyle:'italic',marginTop:1}}>"{r.notes}"</div>}
                        </div>
                      </div>
                    ))}
                  </div>
                ):null;
                const sectionLabels = {mainKeypad:'Main Keypad',basementKeypad:'Basement Keypad',upperKeypad:'Upper Keypad'};
                const sections = ['mainKeypad','basementKeypad','upperKeypad',
                  ...Object.keys(lvCollab).filter(k=>k.startsWith('pl_'))];
                return (
                  <div style={{marginTop:20,padding:'14px 16px',background:'#faf5ff',
                    border:'1px solid #c4b5fd',borderRadius:12}}>
                    <div style={{fontSize:12,fontWeight:700,color:'#7c3aed',marginBottom:12,display:'flex',alignItems:'center',gap:6}}>
                      <LVBadge/>
                      LV Company Additions
                      {lvCollab.companyName&&<span style={{fontSize:11,color:'#8b5cf6',fontWeight:400}}>· {lvCollab.companyName}</span>}
                    </div>
                    {sections.map(key=>{
                      const rows = lvCollab[key];
                      if(!rows||!rows.length) return null;
                      const label = sectionLabels[key]||(key.startsWith('pl_')?key.replace(/^pl_/,'').replace(/_\d+$/,'').replace(/_/g,' '):'Other');
                      return (
                        <div key={key} style={{marginBottom:10}}>
                          <div style={{fontSize:10,color:'#8b5cf6',fontWeight:700,letterSpacing:'0.07em',
                            textTransform:'uppercase',marginBottom:6}}>{label}</div>
                          {renderLVRows(rows)}
                        </div>
                      );
                    })}
                    {lvCollab.generalNotes&&(
                      <div style={{marginTop:6,paddingTop:10,borderTop:'1px solid #c4b5fd55'}}>
                        <div style={{fontSize:10,color:'#8b5cf6',fontWeight:700,letterSpacing:'0.07em',marginBottom:4}}>NOTES</div>
                        <div style={{fontSize:12,color:'#6d28d9',fontStyle:'italic',whiteSpace:'pre-wrap'}}>{lvCollab.generalNotes}</div>
                      </div>
                    )}
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
                <ChangeOrders
                  orders={job.changeOrders}
                  onChange={(updatedCOs, newRT) => {
                    if(newRT) {
                      u({changeOrders:updatedCOs, returnTrips:[...(job.returnTrips||[]), newRT]});
                    } else {
                      u({changeOrders:updatedCOs});
                    }
                  }}
                  jobName={job.name||"This Job"}
                  jobSimproNo={job.simproNo}
                  onEmail={setEmailData}
                  roughStatus={job.roughStatus||""}
                  finishStatus={job.finishStatus||""}
                />
              </Section>

            </div>

          )}


          {tab==="Return Trips"&&(

            <div>

              <Section label="Return Trips" color={C.purple} defaultOpen={true}>
                <ReturnTrips trips={job.returnTrips} onChange={v=>u({returnTrips:v})} jobName={job.name||"This Job"} jobSimproNo={job.simproNo} onEmail={setEmailData} jobId={job.id}/>
              </Section>

            </div>

          )}


          {tab==="Plans & Links"&&(

            <PlansTab job={job} onUpdate={u}/>

          )}


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
                        <div style={{display:"flex",flexDirection:"column",gap:2}}>
                          <div style={{fontSize:9,fontWeight:700,letterSpacing:"0.07em",color:qcDef.color}}>QC DATE</div>
                          <DateInp value={job.qcStatusDate||""} onChange={e=>u({qcStatusDate:e.target.value})}
                            style={{width:140,fontSize:12,borderColor:qcDef.color+"55",background:`${qcDef.color}08`}}/>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}

              <Section label="QC Walk Checklist" color={C.teal} defaultOpen={true}>
                <PunchSection punch={job.qcPunch} onChange={v=>u({qcPunch:v})} jobName={job.name||"Job"} phase="QC" onEmail={({subject,body})=>{ openEmail("", subject, body); }}/>
              </Section>

              <div style={{marginTop:16,padding:"14px 16px",background:job.qcSignedOff?`${C.green}10`:C.surface,border:`1px solid ${job.qcSignedOff?C.green+"55":C.border}`,borderRadius:10}}>
                <div style={{fontSize:10,fontWeight:700,letterSpacing:"0.08em",color:job.qcSignedOff?C.green:C.dim,marginBottom:10}}>QC SIGN-OFF</div>
                {job.qcSignedOff?(
                  <div style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                      <div style={{width:20,height:20,borderRadius:"50%",background:C.green,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,color:"#fff",fontWeight:700}}>✓</div>
                      <div>
                        <div style={{fontSize:13,fontWeight:700,color:C.green}}>Signed Off</div>
                        <div style={{fontSize:11,color:C.dim}}>by {job.qcSignedOffBy||"—"} · {job.qcSignedOffDate||"—"}</div>
                      </div>
                    </div>
                    <button onClick={()=>u({qcSignedOff:false,qcSignedOffBy:"",qcSignedOffDate:""})} style={{marginLeft:"auto",background:"none",border:`1px solid ${C.border}`,borderRadius:6,color:C.muted,fontSize:11,padding:"4px 10px",cursor:"pointer",fontFamily:"inherit"}}>Undo</button>
                  </div>
                ):(
                  <div style={{display:"flex",gap:8,alignItems:"flex-end",flexWrap:"wrap"}}>
                    <div style={{flex:1,minWidth:120}}>
                      <div style={{fontSize:10,color:C.dim,marginBottom:3}}>Lead Name</div>
                      <Inp value={job.qcSignedOffBy||""} onChange={e=>u({qcSignedOffBy:e.target.value})} placeholder="Lead who completed QC"/>
                    </div>
                    <div style={{minWidth:110}}>
                      <div style={{fontSize:10,color:C.dim,marginBottom:3}}>Date Signed Off</div>
                      <DateInp value={job.qcSignedOffDate||""} onChange={e=>u({qcSignedOffDate:e.target.value})} style={{width:140}}/>
                    </div>
                    <button onClick={()=>{if(job.qcSignedOffBy)u({qcSignedOff:true});}} style={{background:C.green,border:"none",borderRadius:7,color:"#fff",fontWeight:700,padding:"8px 16px",fontSize:12,cursor:"pointer",fontFamily:"inherit",whiteSpace:"nowrap"}}>✓ Sign Off</button>
                  </div>
                )}
              </div>

            </div>

          )}


          {tab==="Job Info"&&(

            <div>


              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:16}}>

                {[["name","Job Name"],["address","Address"],["gc","General Contractor"],

                  ["phone","GC Phone"],["simproNo","Simpro Job #"]].map(([k,l])=>(

                  <div key={k}>

                    <div style={{fontSize:10,color:C.dim,marginBottom:3}}>{l}</div>

                    {k==="address" ? (
                      <div style={{display:"flex",gap:4,alignItems:"center"}}>
                        <div style={{flex:1}}><Inp value={job[k]} onChange={e=>u({[k]:e.target.value})} placeholder={l}/></div>
                        {job.address && <AddressLink address={job.address} style={{fontSize:11,fontWeight:700,color:"#fff",background:"#2563eb",border:"none",borderRadius:7,padding:"7px 12px",cursor:"pointer",whiteSpace:"nowrap",display:"inline-flex",alignItems:"center",gap:4,flexShrink:0}}>📍 Maps</AddressLink>}
                      </div>
                    ) : (
                      <Inp value={job[k]} onChange={e=>u({[k]:e.target.value})} placeholder={l}/>
                    )}

                  </div>

                ))}

              <div>

                <div style={{fontSize:10,color:C.dim,marginBottom:3}}>Foreman</div>

                <Sel value={job.foreman||"Koy"} onChange={e=>u({foreman:e.target.value})} options={[...(foremenList||getForemenList()),"Unassigned"]}/>

              </div>

              <div>

                <div style={{fontSize:10,color:C.dim,marginBottom:3}}>Lead</div>

{["Keegan","Gage","Daegan","Colby","Braden","Treycen","Jon","Vasa","Abe","Louis","Jacob"].length>0
                  ? <Sel value={job.lead||""} onChange={e=>u({lead:e.target.value})} options={["", ...(leadsList||LEADS)]} placeholder="Select lead…"/>
                  : <Inp value={job.lead||""} onChange={e=>u({lead:e.target.value})} placeholder="Lead name…"/>}

              </div>

              </div>

              {/* Access note — gate code, keybox, etc. */}
              <div style={{marginTop:12}}>
                <div style={{fontSize:10,color:C.dim,marginBottom:3,display:"flex",alignItems:"center",gap:6}}>
                  ACCESS NOTE <span style={{color:C.muted,fontWeight:400,textTransform:"none",letterSpacing:"normal"}}>(gate code, keybox, entry instructions…)</span>
                </div>
                <textarea
                  value={job.accessNote||""} onChange={e=>u({accessNote:e.target.value})}
                  placeholder="e.g. Gate code: 1234 · Keybox on front door knob"
                  rows={2}
                  style={{width:"100%",boxSizing:"border-box",background:C.surface,
                    border:`1px solid ${job.accessNote?"#f59e0b":C.border}`,
                    borderRadius:8,padding:"8px 10px",fontSize:12,fontFamily:"inherit",
                    color:C.text,resize:"vertical",outline:"none",lineHeight:1.5,
                    transition:"border-color 0.15s"}}/>
              </div>

              {/* Matterport links */}
              <div style={{marginTop:12}}>
                <div style={{fontSize:10,color:C.dim,marginBottom:6,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                  <span>MATTERPORT LINKS</span>
                  <span onClick={()=>{
                    const links = [...(job.matterportLinks||[])];
                    if(!links.length && job.matterportLink) links.push({label:"Main",url:job.matterportLink});
                    links.push({label:"",url:""});
                    u({matterportLinks:links});
                  }} style={{cursor:"pointer",fontSize:10,fontWeight:700,color:C.accent,padding:"2px 8px",
                    border:`1px solid ${C.accent}33`,borderRadius:5,background:`${C.accent}10`}}>+ Add</span>
                </div>
                {(job.matterportLinks && job.matterportLinks.length > 0 ? job.matterportLinks : (job.matterportLink ? [{label:"Main",url:job.matterportLink}] : [])).map((ml,mi)=>(
                  <div key={mi} style={{display:"flex",gap:4,alignItems:"center",marginBottom:4}}>
                    <Inp value={ml.label||""} onChange={e=>{
                      const links=[...(job.matterportLinks||(job.matterportLink?[{label:"Main",url:job.matterportLink}]:[]))];
                      links[mi]={...links[mi],label:e.target.value};
                      u({matterportLinks:links, matterportLink:links[0]?.url||""});
                    }} placeholder="Label (e.g. Pool House)" style={{width:120,flexShrink:0}}/>
                    <div style={{flex:1}}>
                      <Inp value={ml.url||""} onChange={e=>{
                        const links=[...(job.matterportLinks||(job.matterportLink?[{label:"Main",url:job.matterportLink}]:[]))];
                        links[mi]={...links[mi],url:e.target.value};
                        u({matterportLinks:links, matterportLink:links[0]?.url||""});
                      }} placeholder="Paste Matterport URL…"/>
                    </div>
                    {ml.url&&<a href={ml.url} target="_blank" rel="noopener noreferrer"
                      onClick={e=>e.stopPropagation()}
                      style={{fontSize:11,fontWeight:700,color:"#8b5cf6",background:"#8b5cf615",border:"1px solid #8b5cf633",
                        borderRadius:7,padding:"6px 10px",textDecoration:"none",whiteSpace:"nowrap",cursor:"pointer"}}>
                      Open 🔗</a>}
                    <span onClick={()=>{
                      const links=[...(job.matterportLinks||(job.matterportLink?[{label:"Main",url:job.matterportLink}]:[]))];
                      links.splice(mi,1);
                      u({matterportLinks:links, matterportLink:links[0]?.url||""});
                    }} style={{cursor:"pointer",fontSize:14,color:"#ef4444",padding:"4px",lineHeight:1,flexShrink:0}}>✕</span>
                  </div>
                ))}
                {!(job.matterportLinks?.length) && !job.matterportLink && <div style={{fontSize:11,color:C.muted,fontStyle:"italic"}}>No Matterport links yet — click + Add</div>}
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
                      style={{color:s===PREP_STAGE_ALERT?"#dc2626":"inherit",
                        fontWeight:s===PREP_STAGE_ALERT?700:400}}>
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
                    <input type="checkbox" checked={!!job.hasTempPed} onChange={e=>u({hasTempPed:e.target.checked,tempPedNumber:e.target.checked?job.tempPedNumber:""})}
                      style={{accentColor:C.blue,width:16,height:16}}/>
                    <span style={{fontSize:13,color:C.text}}>Temp pedestal on site</span>
                  </label>
                  {job.hasTempPed&&(
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


// ── Q&A Punch List ────────────────────────────────────────────

function QAInlineEdit({value, done, label, onSave}) {

  const [editing, setEditing] = useState(false);

  const [text, setText] = useState(value);

  const commit = () => { if(text.trim()) onSave(text.trim()); setEditing(false); };

  if(editing) return (

    <input autoFocus value={text} onChange={e=>setText(e.target.value)}

      onBlur={commit} onKeyDown={e=>{if(e.key==='Enter')commit();if(e.key==='Escape')setEditing(false);}}

      style={{flex:1,fontSize:12,fontWeight:600,background:C.surface,border:`1px solid ${C.blue}`,

        borderRadius:6,padding:'3px 7px',color:C.text,fontFamily:'inherit',outline:'none'}}/>

  );

  return (

    <span onClick={()=>!done&&setEditing(true)}

      style={{flex:1,fontSize:12,fontWeight:600,color:C.text,

        textDecoration:'none',lineHeight:1.4,

        cursor:done?'default':'text',borderRadius:4,padding:'2px 4px',transition:'background 0.1s'}}

      onMouseEnter={e=>{if(!done)e.target.style.background=C.border+'66'}}

      onMouseLeave={e=>e.target.style.background='transparent'}>

      {label}{value}

    </span>

  );

}


function QAList({questions: _questions, onChange, color, gcAnswerMap={}}) {

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

  const open     = questions.filter(q=>!q.done);

  const answered = questions.filter(q=>q.done);

  const renderQ  = (q,i,globalIdx) => (

    <div key={q.id} style={{background:C.surface,border:`1px solid ${q.done?C.border:color+"33"}`,

      borderRadius:10,padding:12,marginBottom:10,transition:"opacity 0.2s"}}>

      <div style={{display:"flex",alignItems:"flex-start",gap:8,marginBottom:q.done?0:8}}>

        <input type="checkbox" checked={q.done}

          onChange={()=>upd(q.id,{done:!q.done})}

          style={{accentColor:C.green,width:14,height:14,cursor:"pointer",flexShrink:0,marginTop:2}}/>

        <QAInlineEdit

          value={q.question}

          done={q.done}

          label={`Q${globalIdx+1}: `}

          onSave={v=>upd(q.id,{question:v})}/>

        <button onClick={()=>del(q.id)}

          style={{background:"none",border:"none",color:C.muted,cursor:"pointer",

            fontSize:12,flexShrink:0,padding:"0 2px"}}>✕</button>

      </div>

      {!q.done&&(

        <div style={{marginLeft:22}}>

          <div style={{fontSize:10,color:color,fontWeight:700,marginBottom:4,letterSpacing:"0.08em"}}>ANSWER</div>

          <TA value={q.answer} rows={2}

            onChange={e=>upd(q.id,{answer:e.target.value})}

            placeholder="Type answer here…"/>

        </div>

      )}

      {q.done&&q.answer&&(

        <div style={{marginLeft:22,marginTop:4,fontSize:11,color:C.dim,fontStyle:"italic",display:"flex",alignItems:"flex-start",gap:6}}>
          {q.gcAnswered&&<span style={{fontSize:9,fontWeight:700,color:"#16a34a",background:"#dcfce7",borderRadius:4,padding:"1px 5px",flexShrink:0,marginTop:1}}>GC</span>}
          <span>{q.answer}</span>
        </div>

      )}

      {/* If GC has answered but it hasn't been applied yet, show a pending indicator */}
      {!q.done&&gcAnswerMap[q.id]&&(
        <div style={{marginLeft:22,marginTop:6,background:"#f0fdf4",border:"1px solid #16a34a44",borderRadius:6,padding:"6px 10px",fontSize:11}}>
          <span style={{fontSize:9,fontWeight:700,color:"#16a34a",background:"#dcfce7",borderRadius:4,padding:"1px 5px",marginRight:6}}>GC</span>
          <span style={{color:"#15803d",fontStyle:"italic"}}>{gcAnswerMap[q.id]}</span>
        </div>
      )}

    </div>

  );

  return (

    <div>

      {open.length===0&&answered.length===0&&(

        <div style={{fontSize:11,color:C.muted,fontStyle:"italic",marginBottom:8}}>No questions yet</div>

      )}

      {open.map((q,i)=>renderQ(q,i,questions.indexOf(q)))}

      {answered.length>0&&(

        <div style={{marginTop:10}}>

          <div style={{fontSize:10,fontWeight:800,letterSpacing:"0.12em",color:C.green,

            borderBottom:`1px solid ${C.green}33`,paddingBottom:4,marginBottom:8}}>

            ✓ ANSWERED ({answered.length})

          </div>

          {answered.map((q,i)=>renderQ(q,i,questions.indexOf(q)))}

        </div>

      )}

      <div style={{display:"flex",gap:6,marginTop:8}}>

        <Inp value={draft} onChange={e=>setDraft(e.target.value)}

          placeholder="Add a question…" style={{flex:1}}

          onKeyDown={e=>e.key==='Enter'&&add()}/>

        <Btn onClick={add} variant="primary">+</Btn>

      </div>

    </div>

  );

}


function QASection({questions: _questions, onChange, color, gcAnswerMap={}}) {

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

            color={color}
            gcAnswerMap={gcAnswerMap}/>

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

              <DateInp value={s.completedDate||""} onChange={e=>updS(s.id,{completedDate:e.target.value})} style={{width:140}}/>

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


// ── Temp Ped Card ─────────────────────────────────────────────

// ── Quick Job Card ─────────────────────────────────────────────
function QuickJobCard({ job, onOpen, onUpdate, onDelete }) {
  const qjDef = getStatusDef(QUICK_JOB_STATUSES, job.quickJobStatus || "new");
  const typeDef = QUICK_JOB_TYPES.find(t => t.value === job.quickJobType) || QUICK_JOB_TYPES[3];
  const color = qjDef.color || "#6b7280";
  const foreman = job.foreman || "Koy";
  const fc = getFC(foreman) || "#6b7280";

  return (
    <div style={{
      background: C.card, borderRadius: 13, padding: "13px 16px", marginBottom: 8,
      border: `1px solid ${color}33`, borderLeft: `3px solid ${color}`, cursor: "default",
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 180px", minWidth: 140, cursor: "pointer" }} onClick={() => onOpen(job)}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
            <span style={{ fontSize: 10, fontWeight: 800, color: typeDef.color, letterSpacing: "0.06em",
              background: typeDef.color + "18", borderRadius: 99, padding: "1px 7px",
              border: `1px solid ${typeDef.color}33` }}>{typeDef.label.toUpperCase()}</span>
            <span style={{ fontSize: 9, fontWeight: 700, color: "#6b7280", background: "#6b728015",
              borderRadius: 99, padding: "1px 6px", border: "1px solid #6b728022" }}>QUICK</span>
          </div>
          <div style={{ fontWeight: 700, fontSize: 13, color: C.text, marginBottom: 2 }}>{job.name || "Untitled Job"}</div>
          <div style={{ fontSize: 11, color: C.dim, display: "flex", gap: 8, flexWrap: "wrap" }}>
            {job.address && <AddressLink address={job.address} style={{color:C.dim}}/>}
            <span style={{ fontWeight: 700, color: fc }}>{foreman}</span>
            {job.lead && <span style={{ color: C.accent }}>· {job.lead}</span>}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end", flexShrink: 0 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: qjDef.color,
            background: qjDef.color + "18", borderRadius: 99, padding: "2px 10px",
            border: `1px solid ${qjDef.color}33` }}>{qjDef.label}</span>
          {job.quickJobDate && (
            <span style={{ fontSize: 10, color: C.dim }}>
              {fmtDisplay(job.quickJobDate)}{job.quickJobEndDate ? " – " + fmtDisplay(job.quickJobEndDate) : ""}
            </span>
          )}
          {job.readyToInvoice && !job.invoiceSent && (
            <span style={{ fontSize: 10, fontWeight: 800, color: "#ea580c", background: "#ea580c12",
              borderRadius: 99, padding: "2px 10px", border: "1px solid #ea580c33" }}>
              READY TO INVOICE
            </span>
          )}
          {job.invoiceSent && (
            <span style={{ fontSize: 10, fontWeight: 800, color: "#16a34a", background: "#16a34a12",
              borderRadius: 99, padding: "2px 10px", border: "1px solid #16a34a33" }}>
              ✓ INVOICE SENT
            </span>
          )}
          {onDelete && (
            <button onClick={e => { e.stopPropagation(); if (window.confirm("Delete this quick job?")) onDelete(job.id); }}
              style={{ background: "none", border: "1px solid #dc262633", borderRadius: 6,
                color: "#dc2626", fontSize: 10, fontWeight: 600, padding: "3px 8px",
                cursor: "pointer", fontFamily: "inherit" }}>Delete</button>
          )}
        </div>
      </div>
    </div>
  );
}

function TempPedCard({ job, onOpen, onUpdate, onDelete }) {
  const tpDef = getStatusDef(TEMP_PED_STATUSES, job.tempPedStatus||"");
  const color = tpDef.color || "#8b5cf6";
  const foreman = job.foreman||"Koy";
  const fc = (({"Koy":"#3b82f6","Vasa":"#f97316","Colby":"#22c55e","Keegan":"#3b82f6","Gage":"#3b82f6","Daegan":"#3b82f6","Braden":"#22c55e","Treycen":"#22c55e","Jon":"#22c55e","Vasa":"#f97316","Abe":"#f97316","Louis":"#f97316","Jacob":"#6b7280"})[foreman]||"#6b7280") || "#6b7280";

  const upd = (patch) => onUpdate({...job, ...patch}, patch);

  return (
    <div style={{
      background:"var(--card)", borderRadius:13, padding:"13px 16px", marginBottom:8,
      border:`1px solid ${color}33`, borderLeft:`3px solid ${color}`,
      cursor:"default",
    }}>
      <div style={{display:"flex",alignItems:"flex-start",gap:12,flexWrap:"wrap"}}>

        {/* Left: name + meta */}
        <div style={{flex:"1 1 180px",minWidth:140,cursor:"pointer"}} onClick={()=>onOpen(job)}>
          <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:2}}>
            <span style={{fontSize:11,fontWeight:800,color:"#8b5cf6",letterSpacing:"0.06em"}}>TEMP PED</span>
            {job.tempPedNumber&&<span style={{fontSize:11,fontWeight:700,color:"#8b5cf6",background:"#8b5cf618",borderRadius:99,padding:"1px 7px",border:"1px solid #8b5cf633"}}>#{job.tempPedNumber}</span>}
          </div>
          <div style={{fontWeight:700,fontSize:13,color:"var(--text)",marginBottom:2}}>{job.name||"Untitled Job"}</div>
          <div style={{fontSize:11,color:"var(--dim)",display:"flex",gap:8,flexWrap:"wrap"}}>
            {job.address&&<AddressLink address={job.address} style={{color:"var(--dim)"}}/>}
            <span style={{fontWeight:700,color:fc}}>{foreman}</span>
            {job.lead&&<span style={{color:"var(--accent)"}}>· {job.lead}</span>}
          </div>
        </div>

        {/* Right: status control */}
        <div style={{display:"flex",flexDirection:"column",gap:6,alignItems:"flex-end",flexShrink:0}}>
          <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
            <select value={job.tempPedStatus||""} onChange={e=>{
              const v = e.target.value;
              const patch = {tempPedStatus: v};
              if(v==="completed") patch.readyToInvoice = true;
              if(v==="scheduled") patch.tempPedScheduledDate = job.tempPedScheduledDate||"";
              if(v!=="scheduled") patch.tempPedScheduledDate = "";
              upd(patch);
            }} style={{
              background: color ? `${color}18` : "var(--surface)",
              color: color || "var(--dim)",
              border:`1px solid ${color||"var(--border)"}`,
              borderRadius:7, padding:"5px 10px", fontSize:11,
              fontFamily:"inherit", fontWeight:700, outline:"none", cursor:"pointer",
            }}>
              {TEMP_PED_STATUSES.map(s=><option key={s.value} value={s.value}>{s.label}</option>)}
            </select>

            {(job.tempPedStatus==="scheduled")&&(
              <input
                type="date"
                value={toYMD(job.tempPedScheduledDate||"")}
                onChange={e=>upd({tempPedScheduledDate:e.target.value})}
                style={{width:140,fontSize:11,padding:"5px 8px",borderRadius:7,
                  border:`1px solid ${"#2563eb"}55`,background:"#2563eb08",
                  color:"var(--text)",fontFamily:"inherit",outline:"none",colorScheme:"light"}}
              />
            )}
          </div>

          {/* Completed → ready to invoice banner */}
          {job.tempPedStatus==="completed"&&!job.readyToInvoice&&(
            <div style={{fontSize:10,color:"#ea580c",fontWeight:600}}>→ Marked Ready to Invoice</div>
          )}
          {job.readyToInvoice&&job.tempPedStatus==="completed"&&!job.invoiceSent&&(
            <div style={{fontSize:10,fontWeight:800,color:"#ea580c",background:"#ea580c12",borderRadius:99,padding:"2px 10px",border:"1px solid #ea580c33"}}>
              READY TO INVOICE
            </div>
          )}
          {job.invoiceSent&&(
            <div style={{fontSize:10,fontWeight:800,color:"#16a34a",background:"#16a34a12",borderRadius:99,padding:"2px 10px",border:"1px solid #16a34a33"}}>
              ✓ INVOICE SENT
            </div>
          )}
          {onDelete&&(
            <button onClick={e=>{e.stopPropagation();if(window.confirm("Delete this temp ped job?")) onDelete(job.id);}}
              style={{marginTop:4,background:"none",border:"1px solid #dc262633",borderRadius:6,
                color:"#dc2626",fontSize:10,fontWeight:600,padding:"3px 8px",cursor:"pointer",
                fontFamily:"inherit"}}>
              Delete
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Stage Sections ────────────────────────────────────────────

// Effective status — falls back to deriving from % if no status stored
const effRS = j => {
  if(j.tempPed) {
    const s = j.tempPedStatus||"";
    if(s==="completed") return "complete";
    if(s==="scheduled") return "scheduled";
    if(s==="ready") return "waiting_date";
    return "";
  }
  if(j.roughStatus) return j.roughStatus;
  const p=parseInt(j.roughStage)||0; return p===100?"complete":p>0?"inprogress":"";
}; // date_confirmed triggers scheduling task
const effFS = j => {
  if(j.tempPed) return ""; // temp peds don't have a finish stage
  if(j.finishStatus) return j.finishStatus;
  const p=parseInt(j.finishStage)||0; return p===100?"complete":p>0?"inprogress":"";
};

const STAGE_SECTIONS = [

  // Quick Jobs
  { key:"quickNew",        label:"Quick Jobs — New",              color:"#6b7280",
    test: j => !!j.quickJob && (j.quickJobStatus||"new")==="new" },

  { key:"quickScheduled",  label:"Quick Jobs — Scheduled",        color:"#2563eb",
    test: j => !!j.quickJob && j.quickJobStatus==="scheduled" },

  { key:"quickInProgress", label:"Quick Jobs — In Progress",      color:"#0ea5e9",
    test: j => !!j.quickJob && j.quickJobStatus==="inprogress" },

  { key:"quickComplete",   label:"Quick Jobs — Complete",         color:"#22c55e",
    test: j => !!j.quickJob && (j.quickJobStatus==="complete"||j.quickJobStatus==="invoice") },

  // Temp Peds
  { key:"tempPedReady",    label:"Temp Peds — Ready to Schedule", color:"#8b5cf6",
    test: j => !!j.tempPed && (!j.tempPedStatus||j.tempPedStatus==="ready") },

  { key:"tempPedScheduled", label:"Temp Peds — Scheduled",           color:"#7c3aed",
    test: j => !!j.tempPed && j.tempPedStatus==="scheduled" },

  { key:"tempPedDone",     label:"Temp Peds — Completed",            color:"#16a34a",
    test: j => !!j.tempPed && j.tempPedStatus==="completed" },

  // Full Jobs
  { key:"prep",         label:"Pre Job Prep",              color:"#0d9488",
    test: j => !j.tempPed && !j.quickJob && (j.prepStage||"") !== "Job Prep Complete" },

  { key:"roughNotStarted", label:"Rough — Not Started",   color:"#64748b",
    test: j => { const rs=effRS(j); return !j.tempPed && !j.quickJob && (j.prepStage||"")==="Job Prep Complete" && (!rs||rs==="waiting_date"||rs==="date_confirmed"||rs==="scheduled"); } },

  { key:"roughHold",    label:"Rough — On Hold",           color:"#ca8a04",
    test: j => !j.tempPed && !j.quickJob && effRS(j) === "waiting" },

  { key:"rough",        label:"Rough In Progress",         color:"#2563eb",
    test: j => !j.tempPed && !j.quickJob && effRS(j) === "inprogress" },

  { key:"roughInvoice", label:"Rough — Ready to Invoice",  color:"#ea580c",
    test: j => !j.tempPed && !j.quickJob && effRS(j) === "invoice" },

  { key:"between",      label:"In Between",                color:"#e8a020",
    test: j => { if(j.tempPed||j.quickJob) return false; const rs=effRS(j); const fs=effFS(j); return rs==="complete"&&(!fs||fs==="waiting_date"||fs==="date_confirmed"||fs==="scheduled"); } },

  { key:"finishHold",   label:"Finish — On Hold",          color:"#ca8a04",
    test: j => !j.tempPed && !j.quickJob && effFS(j) === "waiting" },

  { key:"finish",       label:"Finish In Progress",        color:"#0ea5e9",
    test: j => !j.tempPed && !j.quickJob && effFS(j) === "inprogress" },

  { key:"finishInvoice",label:"Finish — Ready to Invoice", color:"#ea580c",
    test: j => !j.tempPed && !j.quickJob && effFS(j) === "invoice" },

  { key:"complete",     label:"Completed",                 color:"#22c55e",
    test: j => !j.tempPed && !j.quickJob && effFS(j) === "complete" },

];


function StageSectionList({ jobs, JobRow, TempPedCard, onSelectJob, onSaveJob, onDeleteJob, fc, startCollapsed=true }) {

  const initCollapsed = () => Object.fromEntries(STAGE_SECTIONS.map(s=>[s.key,startCollapsed]));
  const [collapsed, setCollapsed] = useState(initCollapsed);

  const toggle = key => setCollapsed(c=>({...c,[key]:!c[key]}));


  return (

    <div>

      {STAGE_SECTIONS.map(sec => {

        const sJobs = (() => {
          const filtered = jobs.filter(sec.test);
          // Get the most relevant date for a job in this section
          const getDate = j => {
            const rs = effRS(j), fs = effFS(j);
            // Prefer projected start dates, fall back to status dates
            if(fs==="scheduled"||fs==="date_confirmed"||fs==="inprogress") return j.finishProjectedStart||j.finishStatusDate||j.roughProjectedStart||j.roughStatusDate||"";
            if(rs==="scheduled"||rs==="date_confirmed"||rs==="inprogress") return j.roughProjectedStart||j.roughStatusDate||"";
            return j.roughProjectedStart||j.roughStatusDate||j.finishProjectedStart||j.finishStatusDate||"";
          };
          return filtered.sort((a,b)=>{
            const da=getDate(a), db=getDate(b);
            if(!da&&!db) return 0;
            if(!da) return 1;
            if(!db) return -1;
            return new Date(da)-new Date(db);
          });
        })();

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
              job.quickJob
                ? <QuickJobCard key={job.id} job={job} onOpen={onSelectJob} onUpdate={onSaveJob} onDelete={onDeleteJob}/>
                : job.tempPed
                ? <TempPedCard key={job.id} job={job} onOpen={onSelectJob} onUpdate={onSaveJob} onDelete={onDeleteJob}/>
                : <JobRow key={job.id} job={job} fc={fc||undefined} showForeman={!fc}/>
            ))}

          </div>

        );

      })}

    </div>

  );

}


// ── Main Dashboard ────────────────────────────────────────────

// ALL_STAGES removed — use ROUGH_STAGES directly


// ── QC Walks ──────────────────────────────────────────────────

// Detect mobile device

const isMobile = () => /iphone|ipad|ipod|android/i.test(navigator.userAgent);


// Open Google Chat — copies message to clipboard and opens Google Chat
const openGoogleChat = (message) => {
  navigator.clipboard.writeText(message).catch(()=>{});
  window.open("https://chat.google.com", "_blank");
};

// Open email — uses mailto on mobile (opens native mail app), Gmail compose on desktop

const openEmail = (to, subject, body) => {

  if(isMobile()) {

    window.location.href = `mailto:${encodeURIComponent(to||"")}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

  } else {

    const url = `https://mail.google.com/mail/?view=cm&to=${encodeURIComponent(to||"")}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

    window.open(url, "_blank");

  }

};


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


// ── Upcoming Jobs ─────────────────────────────────────────────

function blankUpcoming() {
  return { id: uid(), name:"", city:"", sales:"", customer:"", notes:"", lastFollowUp:"", foreman:"" };
}

const SEED_UPCOMING = [
  {id:"seed1",  name:"#2048 - Discovery Ridge Lot 317",                               city:"Kimball Junction",    sales:"Justin", customer:"Milar",                   notes:"No hole yet. Joint venture between customer/Milar.", lastFollowUp:"10/8/25",  foreman:""},
  {id:"seed2",  name:"#1990 - Kesse Residence",                                        city:"Francis",             sales:"Justin", customer:"LL&L",                    notes:"At foundation",                                      lastFollowUp:"11/5/25",  foreman:""},
  {id:"seed3",  name:"#1937 - Navarro Residence",                                      city:"American Fork",       sales:"Justin", customer:"Butterfield",              notes:"Working on road improvements before they can start",  lastFollowUp:"11/17/25", foreman:""},
  {id:"seed4",  name:"#1938 Corbin Church",                                            city:"Provo",               sales:"Justin", customer:"Butterfield",              notes:"Still in development phase",                         lastFollowUp:"11/17/25", foreman:""},
  {id:"seed5",  name:"#1770 - England Home",                                           city:"Draper",              sales:"Justin", customer:"Greentech",                notes:"Framing. Pending update.",                            lastFollowUp:"1/26/26",  foreman:""},
  {id:"seed6",  name:"#1590 - Becker Residence",                                       city:"Park City",           sales:"Justin", customer:"Mark Wintzer Company",     notes:"Rough expected to begin 4/1/26",                      lastFollowUp:"12/5/25",  foreman:""},
  {id:"seed7",  name:"#994 - Smith Residence - Detached Garage/Remodeled Barn",        city:"Cottonwood Heights",  sales:"Josh",   customer:"Black Cactus Construction", notes:"Framing. Pending update.",                           lastFollowUp:"",         foreman:""},
  {id:"seed8",  name:"#1981 - Meyers Residence",                                       city:"Holladay",            sales:"Josh",   customer:"Eastgate Homes",           notes:"Permitting",                                         lastFollowUp:"9/26/25",  foreman:""},
  {id:"seed9",  name:"#1862 - Colton Residence",                                       city:"Holladay",            sales:"Josh",   customer:"United Contractors",        notes:"Foundation",                                        lastFollowUp:"12/2/25",  foreman:""},
  {id:"seed10", name:"#1896 - Casten-Vought Residence",                                city:"Mapleton",            sales:"Justin", customer:"Farnsworth Construction",  notes:"Electrical Rough Scheduled for 02/26",               lastFollowUp:"12/3/25",  foreman:""},
  {id:"seed11", name:"#2067 - Rule & O'Mara Residence",                                city:"Midway",              sales:"Justin", customer:"Mark Wintzer Company",     notes:"No idea on timeline",                                lastFollowUp:"1/5/26",   foreman:""},
  {id:"seed12", name:"#2249 - The Hide Out - Hideout",                                 city:"Hideout",             sales:"Justin", customer:"Black Oak Builders",        notes:"Any day now 2/2/26",                                lastFollowUp:"1/27/26",  foreman:""},
  {id:"seed13", name:"#1809 - Tuhaye Hollow",                                          city:"Kamas",               sales:"Josh",   customer:"The Housley Group",        notes:"",                                                   lastFollowUp:"",         foreman:""},
];

function UpcomingJobs({ upcoming, onChange, onPromote, canManage=false, foremenList }) {
  const [editingId, setEditingId] = useState(null);
  const add = () => { if(!canManage) return; const j=blankUpcoming(); onChange([j,...upcoming]); setEditingId(j.id); };
  const upd = (id,patch) => { if(!canManage) return; onChange(upcoming.map(u=>u.id===id?{...u,...patch}:u)); };
  const del = (id) => { if(!canManage) return; onChange(upcoming.filter(u=>u.id!==id)); setEditingId(null); };
  const COL = {
    name:{label:"Job Name",flex:2.5}, city:{label:"City",flex:1.2},
    sales:{label:"Sales",flex:1}, customer:{label:"Customer / GC",flex:1.5},
    notes:{label:"Notes",flex:3}, lastFollowUp:{label:"Last Follow Up",flex:1.1},
  };
  const colKeys = Object.keys(COL);
  return (
    <div>
      <div style={{padding:"24px 26px 16px",borderBottom:`1px solid ${C.border}`}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12}}>
          <div>
            <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:28,letterSpacing:"0.06em",color:C.text,lineHeight:1}}>UPCOMING JOBS</div>
            <div style={{fontSize:11,color:C.dim,marginTop:3}}>{upcoming.length} job{upcoming.length!==1?"s":""} in pipeline</div>
          </div>
          {canManage&&<button onClick={add} style={{background:C.accent,border:"none",borderRadius:9,color:"#000",fontWeight:700,padding:"9px 20px",fontSize:13,cursor:"pointer",fontFamily:"inherit",whiteSpace:"nowrap"}}>+ Add Job</button>}
        </div>
      </div>
      <div style={{padding:"16px 26px"}}>
        <div style={{display:"flex",alignItems:"center",gap:0,padding:"6px 12px",marginBottom:4,borderBottom:`1px solid ${C.border}`}}>
          {colKeys.map(k=>(
            <div key={k} style={{flex:COL[k].flex,fontSize:10,fontWeight:700,letterSpacing:"0.08em",color:C.dim,textTransform:"uppercase",paddingRight:12}}>{COL[k].label}</div>
          ))}
          <div style={{width:110,flexShrink:0}}/>
        </div>
        {upcoming.length===0&&<div style={{textAlign:"center",padding:"48px 0",color:C.muted,fontSize:13,fontStyle:"italic"}}>No upcoming jobs yet — add one above.</div>}
        {upcoming.map(u=>{
          const isEditing=editingId===u.id;
          return (
            <div key={u.id} style={{display:"flex",alignItems:isEditing?"flex-start":"center",gap:0,padding:"8px 12px",borderRadius:8,marginBottom:2,background:isEditing?C.surface:"none",border:isEditing?`1px solid ${C.border}`:"1px solid transparent"}}
              onMouseEnter={e=>{if(!isEditing)e.currentTarget.style.background=C.surface;}}
              onMouseLeave={e=>{if(!isEditing)e.currentTarget.style.background="none";}}>
              {isEditing?(
                <div style={{flex:1,display:"flex",flexDirection:"column",gap:10}}>
                  <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
                    <div style={{flex:2.5,minWidth:160}}><div style={{fontSize:10,color:C.dim,marginBottom:3}}>Job Name</div><Inp value={u.name} onChange={e=>upd(u.id,{name:e.target.value})} placeholder="Job name"/></div>
                    <div style={{flex:1.2,minWidth:100}}><div style={{fontSize:10,color:C.dim,marginBottom:3}}>City</div><Inp value={u.city} onChange={e=>upd(u.id,{city:e.target.value})} placeholder="City"/></div>
                    <div style={{flex:1,minWidth:90}}><div style={{fontSize:10,color:C.dim,marginBottom:3}}>Sales</div><Inp value={u.sales} onChange={e=>upd(u.id,{sales:e.target.value})} placeholder="Sales rep"/></div>
                    <div style={{flex:1.5,minWidth:130}}><div style={{fontSize:10,color:C.dim,marginBottom:3}}>Customer / GC</div><Inp value={u.customer} onChange={e=>upd(u.id,{customer:e.target.value})} placeholder="Customer or GC"/></div>
                    <div style={{flex:1.1,minWidth:110}}><div style={{fontSize:10,color:C.dim,marginBottom:3}}>Last Follow Up</div><DateInp value={u.lastFollowUp} onChange={e=>upd(u.id,{lastFollowUp:e.target.value})}/></div>
                    <div style={{flex:1,minWidth:120}}><div style={{fontSize:10,color:C.dim,marginBottom:3}}>Foreman</div>
                      <select value={u.foreman||""} onChange={e=>upd(u.id,{foreman:e.target.value})} style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:7,color:C.text,padding:"7px 10px",fontSize:12,fontFamily:"inherit",outline:"none",cursor:"pointer",width:"100%"}}>
                        <option value="">— unassigned —</option>
                        {(foremenList||getForemenList()).map(f=><option key={f} value={f}>{f}</option>)}
                      </select>
                    </div>
                  </div>
                  <div><div style={{fontSize:10,color:C.dim,marginBottom:3}}>Notes</div><TA value={u.notes} onChange={e=>upd(u.id,{notes:e.target.value})} placeholder="Status, timeline, notes…" rows={2}/></div>
                  <div style={{display:"flex",gap:8,marginTop:2}}>
                    <button onClick={()=>setEditingId(null)} style={{background:C.accent,border:"none",borderRadius:7,color:"#000",fontWeight:700,padding:"6px 16px",fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>Done</button>
                    <button onClick={()=>{if(window.confirm("Promote to active job?"))onPromote(u);}} style={{background:"none",border:`1px solid ${C.green}`,borderRadius:7,color:C.green,fontWeight:700,padding:"6px 16px",fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>✓ Promote to Job</button>
                    <button onClick={()=>del(u.id)} style={{background:"none",border:"none",color:C.muted,fontSize:12,cursor:"pointer",fontFamily:"inherit",marginLeft:"auto"}}>Remove</button>
                  </div>
                </div>
              ):(
                <>
                  <div style={{flex:2.5,paddingRight:12,fontSize:13,fontWeight:600,color:C.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                    {u.name||<span style={{color:C.muted,fontStyle:"italic"}}>Untitled</span>}
                    {u.foreman&&<span style={{marginLeft:8,fontSize:10,fontWeight:700,color:getFC(u.foreman)||"#6b7280",background:`${getFC(u.foreman)||"#6b7280"}18`,borderRadius:99,padding:"1px 7px",border:`1px solid ${getFC(u.foreman)||"#6b7280"}33`}}>{u.foreman}</span>}
                  </div>
                  <div style={{flex:1.2,paddingRight:12,fontSize:12,color:C.dim,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{u.city||"—"}</div>
                  <div style={{flex:1,paddingRight:12,fontSize:12,color:C.dim,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{u.sales||"—"}</div>
                  <div style={{flex:1.5,paddingRight:12,fontSize:12,color:C.dim,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{u.customer||"—"}</div>
                  <div style={{flex:3,paddingRight:12,fontSize:12,color:C.dim,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{u.notes||"—"}</div>
                  <div style={{flex:1.1,paddingRight:12,fontSize:12,color:C.dim,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{u.lastFollowUp||"—"}</div>
                  <div style={{width:110,flexShrink:0,display:"flex",gap:6,justifyContent:"flex-end"}}>
                    <button onClick={()=>setEditingId(u.id)} style={{background:"none",border:`1px solid ${C.border}`,borderRadius:6,color:C.dim,fontSize:11,padding:"4px 10px",cursor:"pointer",fontFamily:"inherit"}}>Edit</button>
                    <button onClick={()=>{if(window.confirm("Promote to active job?"))onPromote(u);}} style={{background:C.green,border:"none",borderRadius:6,color:"#fff",fontSize:11,fontWeight:700,padding:"4px 10px",cursor:"pointer",fontFamily:"inherit"}}>✓</button>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}


// ── Tasks Engine ─────────────────────────────────────────────

// Build the patch to mark a job's invoice as sent and clear to complete
const invoiceSentPatch = (job) => {
  const patch = { invoiceSent:true, readyToInvoice:false, invoiceDismissed:true };
  if(job.roughStatus==="invoice") patch.roughStatus = "complete";
  if(job.finishStatus==="invoice") patch.finishStatus = "complete";
  return patch;
};

// Module-level foreman matching — used by Tasks and other components outside App
const matchesForeman = (job, name) => {
  const jf = (job.foreman||"").trim().toLowerCase();
  const n  = (name||"").trim().toLowerCase();
  if(!jf || !n) return false;
  if(jf === n) return true;
  if(n.startsWith(jf+" ")) return true;
  if(jf.startsWith(n+" ")) return true;
  const nameParts = n.split(" ");
  if(nameParts.some(part => part === jf || part.includes(jf) || jf.includes(part))) return true;
  return false;
};

function computeTasks(jobs) {
  const tasks = [];
  jobs.forEach(job => {
    const foreman = job.foreman || "Koy";
    const rs = job.roughStatus || "";
    const fs = job.finishStatus || "";

    // Rough — waiting for date OR date confirmed: fire scheduling task
    if(rs === "scheduled" && !job.roughDepositDismissed) {
      tasks.push({
        id: job.id+"_rough_deposit", jobId: job.id, jobName: job.name,
        type: "auto", category: "invoice", foreman,
        title: "Material Deposit — Rough",
        desc: "Rough is scheduled — collect material deposit before start",
        dueDate: job.roughStatusDate||"",
        color: C.orange, cleared: false,
      });
    }
    // Rough scheduled — 14 days before start, fire "Confirm Start Date" task
    if(rs === "scheduled" && job.roughStatusDate && !job.roughStartConfirmed) {
      const startD = parseAnyDate(job.roughStatusDate);
      if(startD) {
        const daysUntil = Math.floor((startD.getTime() - Date.now()) / (1000*60*60*24));
        if(daysUntil <= 14) {
          tasks.push({
            id: job.id+"_rough_confirm_start", jobId: job.id, jobName: job.name,
            type: "auto", category: "rough", foreman,
            title: "Confirm Rough Start Date",
            desc: daysUntil <= 0
              ? `Rough was scheduled to start ${job.roughStatusDate} — confirm with GC`
              : `Rough starts in ${daysUntil} day${daysUntil!==1?"s":""} (${job.roughStatusDate}) — confirm with GC`,
            dueDate: job.roughStatusDate,
            color: daysUntil <= 3 ? C.red : C.rough, cleared: false,
          });
        }
      }
    }
    if(rs === "waiting_date") {
      tasks.push({
        id: job.id+"_rough_waiting", jobId: job.id, jobName: job.name,
        type: "auto", category: "rough", foreman,
        title: "Get Rough Start Date",
        desc: "Waiting for start date confirmation from GC/homeowner",
        color: C.rough, cleared: false,
      });
    }
    if(rs === "date_confirmed") {
      const rHard = job.roughNeedsHardDate;
      const rStart = job.roughNeedsByStart||"";
      const rEnd   = job.roughNeedsByEnd||"";
      const rWindowLabel = rHard
        ? (rStart ? `Hard date: ${rStart}` : "")
        : (rStart||rEnd) ? `Window: ${rStart}${rEnd?" – "+rEnd:""}` : "";
      // Use start of window as dueDate for sorting
      const rDueDate = rStart || "";
      tasks.push({
        id: job.id+"_rough_needs", jobId: job.id, jobName: job.name,
        type: "auto", category: "rough", foreman,
        title: "Schedule Rough",
        needsHardDate: rHard, needsByStart: rStart, needsByEnd: rEnd,
        windowLabel: rWindowLabel,
        dueDate: rDueDate,
        desc: rWindowLabel || "Start date confirmed — needs to be scheduled",
        color: C.rough, cleared: false,
      });
      tasks.push({
        id: job.id+"_rough_po", jobId: job.id, jobName: job.name,
        type: "auto", category: "po", foreman,
        title: "Order Job Start PO",
        needsHardDate: rHard, needsByStart: rStart, needsByEnd: rEnd,
        windowLabel: rWindowLabel,
        dueDate: rDueDate,
        desc: rWindowLabel || "Order materials PO for rough start",
        color: "#8b5cf6", cleared: false,
      });
    }

    // Finish — waiting for date OR date confirmed: fire scheduling task
    if(fs === "scheduled" && !job.finishDepositDismissed) {
      tasks.push({
        id: job.id+"_finish_deposit", jobId: job.id, jobName: job.name,
        type: "auto", category: "invoice", foreman,
        title: "Material Deposit — Finish",
        desc: "Finish is scheduled — collect material deposit before start",
        dueDate: job.finishStatusDate||"",
        color: C.orange, cleared: false,
      });
    }
    // Finish scheduled — 14 days before start, fire "Confirm Start Date" task
    if(fs === "scheduled" && job.finishStatusDate && !job.finishStartConfirmed) {
      const startD = parseAnyDate(job.finishStatusDate);
      if(startD) {
        const daysUntil = Math.floor((startD.getTime() - Date.now()) / (1000*60*60*24));
        if(daysUntil <= 14) {
          tasks.push({
            id: job.id+"_finish_confirm_start", jobId: job.id, jobName: job.name,
            type: "auto", category: "finish", foreman,
            title: "Confirm Finish Start Date",
            desc: daysUntil <= 0
              ? `Finish was scheduled to start ${job.finishStatusDate} — confirm with GC`
              : `Finish starts in ${daysUntil} day${daysUntil!==1?"s":""} (${job.finishStatusDate}) — confirm with GC`,
            dueDate: job.finishStatusDate,
            color: daysUntil <= 3 ? C.red : C.finish, cleared: false,
          });
        }
      }
    }
    if(fs === "waiting_date") {
      tasks.push({
        id: job.id+"_finish_waiting", jobId: job.id, jobName: job.name,
        type: "auto", category: "finish", foreman,
        title: "Get Finish Start Date",
        desc: "Waiting for finish start date confirmation",
        color: C.finish, cleared: false,
      });
    }
    if(fs === "date_confirmed") {
      const fHard = job.finishNeedsHardDate;
      const fStart = job.finishNeedsByStart||"";
      const fEnd   = job.finishNeedsByEnd||"";
      const fWindowLabel = fHard
        ? (fStart ? `Hard date: ${fStart}` : "")
        : (fStart||fEnd) ? `Window: ${fStart}${fEnd?" – "+fEnd:""}` : "";
      const fDueDate = fStart || "";
      tasks.push({
        id: job.id+"_finish_needs", jobId: job.id, jobName: job.name,
        type: "auto", category: "finish", foreman,
        title: "Schedule Finish",
        needsHardDate: fHard, needsByStart: fStart, needsByEnd: fEnd,
        windowLabel: fWindowLabel,
        dueDate: fDueDate,
        desc: fWindowLabel || "Start date confirmed — needs to be scheduled",
        color: C.finish, cleared: false,
      });
      tasks.push({
        id: job.id+"_finish_po", jobId: job.id, jobName: job.name,
        type: "auto", category: "po", foreman,
        title: "Order Job Start PO",
        needsHardDate: fHard, needsByStart: fStart, needsByEnd: fEnd,
        windowLabel: fWindowLabel,
        dueDate: fDueDate,
        desc: fWindowLabel || "Order materials PO for finish start",
        color: "#8b5cf6", cleared: false,
      });
    }

    // QC Walk — fires once when rough hits 80%+, clears when qcStatus=scheduled/completed/pass/fail
    if(job.roughQCTaskFired && !["scheduled","completed","pass","fail"].includes(job.qcStatus)) tasks.push({
      id: job.id+"_qc_walk", jobId: job.id, jobName: job.name,
      type: "auto", category: "qc", foreman,
      title: "Schedule QC Walk",
      desc: `Rough is at ${job.roughStage||"80%+"} — time to schedule the QC walk`,
      color: C.teal, cleared: false,
    });

    // FIX 4: Final QC Walk — fires when finish hits 80%+
    const finishPct = parseInt(job.finishStage)||0;
    if(finishPct>=80 && !["scheduled","completed","pass","fail"].includes(job.qcStatus)) tasks.push({
      id: job.id+"_final_qc_walk", jobId: job.id, jobName: job.name,
      type: "auto", category: "qc", foreman,
      title: "Schedule Final QC Walk",
      desc: `Finish is at ${job.finishStage||"80%+"} — time to schedule the final QC walk`,
      color: C.teal, cleared: false,
    });

    // FIX 5: Open punch items when phase marked complete or ready to invoice
    const roughPct2 = parseInt(job.roughStage)||0;
    const countPunchItems = (punch) => {
      if(!punch) return 0;
      const countFloor = (f) => {
        if(!f) return 0;
        if(Array.isArray(f)) return f.filter(i=>!i.done).length;
        return (f.general||[]).filter(i=>!i.done).length +
          (f.rooms||[]).reduce((a,r)=>a+(Array.isArray(r.items)?r.items.filter(i=>!i.done).length:0),0);
      };
      return countFloor(punch.upper)+countFloor(punch.main)+countFloor(punch.basement)+
        (punch.extras||[]).reduce((s,e)=>s+countFloor(punch[e.key]||{}),0);
    };
    const openRoughPunch = countPunchItems(job.roughPunch);
    const openFinishPunch = countPunchItems(job.finishPunch);
    if(openRoughPunch>0 && (rs==="complete"||rs==="invoice")) tasks.push({
      id: job.id+"_punch_rough_warn", jobId: job.id, jobName: job.name,
      type: "auto", category: "punch", foreman,
      title: `${openRoughPunch} Open Rough Punch Item${openRoughPunch>1?"s":""}`,
      desc: "Rough is marked complete or ready to invoice but punch items are still open",
      color: C.red, cleared: false,
    });
    if(openFinishPunch>0 && (fs==="complete"||fs==="invoice")) tasks.push({
      id: job.id+"_punch_finish_warn", jobId: job.id, jobName: job.name,
      type: "auto", category: "punch", foreman,
      title: `${openFinishPunch} Open Finish Punch Item${openFinishPunch>1?"s":""}`,
      desc: "Finish is marked complete or ready to invoice but punch items are still open",
      color: C.red, cleared: false,
    });

    // FIX 6: "In Between" too long — fires after 2 months
    if(rs==="complete" && (!fs||fs===""||fs==="waiting_date"||fs==="ready")) {
      const betweenDate = job.roughStatusDate||job.roughProjectedStart||"";
      if(betweenDate) {
        const d = parseAnyDate(betweenDate);
        if(d) {
          const daysBetween = Math.floor((Date.now()-d.getTime())/(1000*60*60*24));
          if(daysBetween>=60) tasks.push({
            id: job.id+"_in_between_long", jobId: job.id, jobName: job.name,
            type: "auto", category: "schedule", foreman,
            title: "In Between — Over 2 Months",
            desc: `Rough completed ${daysBetween} days ago — finish has not been scheduled`,
            color: C.orange, cleared: false,
          });
        }
      }
    }

    // FIX 2b: Ready to Invoice stale — fires after 5 days with no action
    if(job.readyToInvoice && !job.invoiceDismissed) {
      const invDate = job.readyToInvoiceDate||"";
      if(invDate) {
        const d = parseAnyDate(invDate);
        if(d) {
          const daysStale = Math.floor((Date.now()-d.getTime())/(1000*60*60*24));
          if(daysStale>=5) tasks.push({
            id: job.id+"_invoice_stale", jobId: job.id, jobName: job.name,
            type: "auto", category: "invoice", foreman,
            title: `Invoice Overdue — ${daysStale} Days`,
            desc: "Job has been ready to invoice for more than 5 days — follow up",
            color: "#dc2626", cleared: false,
          });
        }
      }
    }

    // Change Orders
    const rs2 = effRS(job), fs2 = effFS(job);
    (job.changeOrders||[]).forEach((co, i) => {

      // Needs to be sent — fires immediately on new CO
      if((co.coStatus||"needs_sending")==="needs_sending") tasks.push({
        id: job.id+"_co_"+co.id+"_send", jobId: job.id, jobName: job.name,
        type: "auto", category: "co", foreman,
        title: `Send Change Order #${i+1}`,
        desc: co.desc ? `CO: ${co.desc}` : "Draft and send the change order",
        color: "#dc2626", cleared: false,
        dueDate: co.coStatusDate||"",
      });

      // Approved — context-aware: crew on site → complete, no crew → convert to RT
      if(co.coStatus === "approved") {
        const crewOnSite = rs2 === "inprogress" || fs2 === "inprogress";
        tasks.push({
          id: job.id+"_co_"+co.id+"_approved", jobId: job.id, jobName: job.name,
          type: "auto", category: "co", foreman,
          title: crewOnSite
            ? `CO #${i+1} Approved — mark work complete`
            : `CO #${i+1} Approved — convert to Return Trip`,
          desc: co.desc ? `CO: ${co.desc}` : undefined,
          color: "#16a34a", cleared: false,
        });
      }

      // Scheduled (after convert to RT and RT gets scheduled date on CO)
      if(co.coStatus === "scheduled") {
        // Build window label from the co dates
        let coWindowLabel = "";
        if(co.needsHardDate && co.needsByStart) {
          const d = parseAnyDate(co.needsByStart);
          coWindowLabel = d ? "🔒 "+d.toLocaleDateString("en-US",{month:"short",day:"numeric"}) : "";
        } else if(co.needsByStart) {
          const s = parseAnyDate(co.needsByStart), e = parseAnyDate(co.needsByEnd||co.needsByStart);
          if(s) coWindowLabel = "📅 "+s.toLocaleDateString("en-US",{month:"short",day:"numeric"})+(e&&co.needsByEnd?" – "+e.toLocaleDateString("en-US",{month:"short",day:"numeric"}):"");
        }
        // Scheduled task clears when coStatusDate is set
        if(!co.coStatusDate) tasks.push({
          id: job.id+"_co_"+co.id+"_sched", jobId: job.id, jobName: job.name,
          type: "auto", category: "co", foreman,
          title: `Schedule CO #${i+1} Return Trip`,
          desc: co.desc ? `CO: ${co.desc}` : "Set the scheduled date for this return trip",
          color: "#2563eb", cleared: false,
          windowLabel: coWindowLabel||undefined,
          needsHardDate: co.needsHardDate||false,
        });
      }
    });

    // Ready to Invoice — fires when readyToInvoice is true and not yet dismissed
    if(job.readyToInvoice && !job.invoiceDismissed) tasks.push({
      id: job.id+"_invoice", jobId: job.id, jobName: job.name,
      type: "auto", category: "invoice", foreman,
      title: "Ready to Invoice",
      desc: job.tempPed ? "Temp ped completed" : effFS(job)==="complete" ? "Finish complete" : "Rough complete",
      color: "#ea580c", cleared: false,
    });

    // Rough complete → invoice rough-in task
    if((rs==="complete"||rs==="invoice") && !job.roughInvoiceDismissed) tasks.push({
      id: job.id+"_rough_invoice", jobId: job.id, jobName: job.name,
      type: "auto", category: "invoice", foreman,
      title: "Invoice Rough-In",
      desc: "Rough is complete — ready to invoice rough-in",
      color: "#ea580c", cleared: false,
    });

    // Finish complete → invoice finish task
    if((fs==="complete"||fs==="invoice") && !job.finishInvoiceDismissed) tasks.push({
      id: job.id+"_finish_invoice", jobId: job.id, jobName: job.name,
      type: "auto", category: "invoice", foreman,
      title: "Invoice Finish",
      desc: "Finish is complete — ready to invoice finish",
      color: "#ea580c", cleared: false,
    });

    // CO individually completed → merge/invoice task
    const coDoneDismissed = job.coDoneDismissed||[];
    (job.changeOrders||[]).forEach((co, i) => {
      if(co.coStatus === "completed" && !coDoneDismissed.includes(co.id)) tasks.push({
        id: job.id+"_co_"+co.id+"_done", jobId: job.id, jobName: job.name,
        type: "auto", category: "co", foreman,
        coId: co.id,
        title: `CO #${i+1} Complete — merge or invoice`,
        desc: co.desc ? `CO: ${co.desc}` : undefined,
        color: "#16a34a", cleared: false,
      });
    });

    // RT individually completed → merge/invoice task
    const rtDoneDismissed = job.rtDoneDismissed||[];
    (job.returnTrips||[]).forEach((rt, i) => {
      if(rt.rtStatus === "complete" && !rtDoneDismissed.includes(rt.id)) tasks.push({
        id: job.id+"_rt_"+rt.id+"_done", jobId: job.id, jobName: job.name,
        type: "auto", category: "rt", foreman,
        rtId: rt.id,
        title: `Return Trip #${i+1} Complete — merge or invoice`,
        desc: rt.scope ? `Scope: ${rt.scope}` : undefined,
        color: "#16a34a", cleared: false,
        dueDate: rt.rtStatusDate||"",
      });
    });

    // Temp Ped scheduling task
    if(job.tempPed && job.tempPedStatus === "ready") tasks.push({
      id: job.id+"_tempped_sched", jobId: job.id, jobName: job.name,
      type: "auto", category: "tempped", foreman,
      title: `Schedule Temp Ped${job.tempPedNumber?" #"+job.tempPedNumber:""}`,
      desc: "Temp ped is ready to be scheduled",
      color: "#8b5cf6", cleared: false,
    });

    // Quick Job tasks
    if(job.quickJob) {
      const qjs = job.quickJobStatus || "new";
      const typeDef = QUICK_JOB_TYPES.find(t=>t.value===job.quickJobType) || QUICK_JOB_TYPES[3];
      if(qjs === "new") tasks.push({
        id: job.id+"_quick_schedule", jobId: job.id, jobName: job.name,
        type: "auto", category: "schedule", foreman,
        title: `Schedule ${typeDef.label}: ${job.name||"Untitled"}`,
        desc: job.scope || "New quick job needs to be scheduled",
        color: typeDef.color, cleared: false,
      });
      if(qjs === "scheduled" && job.quickJobDate) {
        const startD = parseAnyDate(job.quickJobDate);
        if(startD) {
          const daysUntil = Math.floor((startD.getTime() - Date.now()) / (1000*60*60*24));
          if(daysUntil <= 3) tasks.push({
            id: job.id+"_quick_upcoming", jobId: job.id, jobName: job.name,
            type: "auto", category: "schedule", foreman,
            title: `${typeDef.label} ${daysUntil<=0?"Today/Overdue":"in "+daysUntil+" day"+(daysUntil!==1?"s":"")}`,
            desc: job.scope || job.name || "Quick job coming up",
            dueDate: job.quickJobDate,
            color: daysUntil <= 0 ? C.red : typeDef.color, cleared: false,
          });
        }
      }
      if((qjs === "complete" || qjs === "invoice") && job.readyToInvoice && !job.invoiceDismissed) tasks.push({
        id: job.id+"_quick_invoice", jobId: job.id, jobName: job.name,
        type: "auto", category: "invoice", foreman,
        title: `Invoice ${typeDef.label}: ${job.name||"Untitled"}`,
        desc: "Quick job complete — ready to invoice",
        color: "#ea580c", cleared: false,
      });
    }

    // Return Trips needing scheduling
    (job.returnTrips||[]).forEach((rt, i) => {
      if(rt.rtStatus === "needs" && !rt.signedOff) {
        // Build window label like the scheduling forecast does
        let rtWindowLabel = "";
        if(rt.needsHardDate && rt.needsByStart) {
          const d = parseAnyDate(rt.needsByStart);
          rtWindowLabel = d ? "🔒 "+d.toLocaleDateString("en-US",{month:"short",day:"numeric"}) : "";
        } else if(rt.needsByStart) {
          const s = parseAnyDate(rt.needsByStart), e = parseAnyDate(rt.needsByEnd||rt.needsByStart);
          if(s) rtWindowLabel = "📅 "+s.toLocaleDateString("en-US",{month:"short",day:"numeric"})+(e&&rt.needsByEnd?" – "+e.toLocaleDateString("en-US",{month:"short",day:"numeric"}):"");
        }
        tasks.push({
          id: job.id+"_rt_"+rt.id+"_needs", jobId: job.id, jobName: job.name,
          type: "auto", category: "rt", foreman,
          title: `Schedule Return Trip #${i+1}`,
          desc: rt.scope ? `Scope: ${rt.scope}` : "Return trip needs to be scheduled",
          color: "#8b5cf6", cleared: false,
          dueDate: rt.rtStatusDate||"",
          windowLabel: rtWindowLabel||undefined,
          needsHardDate: rt.needsHardDate||false,
        });
      }
      if(rt.rtStatus === "scheduled" && !rt.signedOff) tasks.push({
        id: job.id+"_rt_"+rt.id+"_sched", jobId: job.id, jobName: job.name,
        type: "auto", category: "rt", foreman,
        title: `Return Trip #${i+1} — Get Sign-Off`,
        desc: rt.scope ? `Scope: ${rt.scope}` : "Return trip is scheduled — confirm completion & sign off",
        color: "#8b5cf6", cleared: false,
        dueDate: rt.rtStatusDate||"",
      });
    });

    // Pre Job Prep — always assigned to Koy regardless of job foreman
    if(!job.tempPed && (job.prepStage||"") !== "Job Prep Complete") {
      tasks.push({
        id: job.id+"_prep", jobId: job.id, jobName: job.name,
        type: "auto", category: "prep", foreman: "Koy",
        prepStage: job.prepStage||"",
        title: `Pre Job Prep: ${job.name||"Untitled"}`,
        desc: job.prepStage ? `Stage: ${job.prepStage}` : "Not started",
        color: "#0d9488", cleared: false,
      });
    }
  });
  return tasks;
}

// ── Tasks Component ───────────────────────────────────────────

const parseAnyDate = (str) => {
  if(!str) return null;
  // YYYY-MM-DD (from date picker) — parse as LOCAL date to avoid UTC midnight shift
  const ymd = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(ymd) return new Date(+ymd[1], +ymd[2]-1, +ymd[3]);
  // MM/DD/YY or MM/DD/YYYY
  const mdy = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if(mdy) {
    let [,m,d,y] = mdy;
    if(y.length===2) y = "20"+y;
    return new Date(+y, +m-1, +d);
  }
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
};
const URGENCY = (dueDateStr) => {
  if(!dueDateStr) return null;
  const due = parseAnyDate(dueDateStr); if(!due) return null;
  due.setHours(0,0,0,0);
  const today = new Date(); today.setHours(0,0,0,0);
  const diff = Math.round((due - today) / 86400000);
  if(diff < 0)  return {label:"OVERDUE", color:"#dc2626", bg:"#dc262618", level:"overdue", days: diff};
  if(diff === 0) return {label:"DUE TODAY", color:"#dc2626", bg:"#dc262618", level:"critical", days: 0};
  if(diff === 1) return {label:"DUE TOMORROW", color:"#ea580c", bg:"#ea580c15", level:"critical", days: 1};
  if(diff <= 3) return {label:`DUE IN ${diff} DAYS`, color:"#ca8a04", bg:"#ca8a0418", level:"warning", days: diff};
  if(diff <= 7) return {label:`DUE IN ${diff} DAYS`, color:"#2563eb", bg:"#2563eb10", level:"soon", days: diff};
  return {label:`DUE ${due.toLocaleDateString("en-US",{month:"short",day:"numeric"})}`, color:"#6b7280", bg:"transparent", level:"fine", days: diff};
};

function TaskCard({ task, jobs, onSelectJob, onDismiss, onSetDueDate, onManualClear }) {
  const [editingDate, setEditingDate] = useState(false);
  const [dateVal, setDateVal] = useState(task.dueDate||"");
  // localDueDate keeps color in sync immediately on save without waiting for Firebase round-trip
  const [localDueDate, setLocalDueDate] = useState(task.dueDate||"");
  // Sync if parent prop changes (e.g. Firebase comes back with a different value)
  useEffect(() => { setLocalDueDate(task.dueDate||""); }, [task.dueDate]);

  const urg = URGENCY(localDueDate);
  const isOverdue  = urg && urg.level === "overdue";
  const isCritical = urg && urg.level === "critical";  // today or tomorrow — red
  const isWarning  = urg && urg.level === "warning";   // 2-3 days — yellow
  const isUrgent   = isCritical || isWarning;

  const CATEGORY_LABELS = {
    rough:"Rough", finish:"Finish", qc:"QC Walk", co:"Change Order",
    rt:"Return Trip", manual:"Manual Task", prep:"Pre Job Prep", po:"Purchase Order", tempped:"Temp Ped", invoice:"Invoice"
  };

  const saveDate = () => {
    if(onSetDueDate) onSetDueDate(task.id, dateVal);
    setLocalDueDate(dateVal);   // instant local update — no Firebase wait
    setEditingDate(false);
  };

  return (
    <div
      className={isCritical||isOverdue?"task-pulse":isWarning?"task-warn":""}
      style={{
      display:"flex", alignItems:"flex-start", gap:12,
      padding:"12px 14px", borderRadius:11, marginBottom:6,
      background: isOverdue||isCritical ? "#dc262610" : isWarning ? "#ca8a0410" : "var(--card)",
      border:`1px solid ${isOverdue||isCritical?"#dc262644":isWarning?"#ca8a0444":task.color+"22"}`,
      borderLeft:`4px solid ${isOverdue||isCritical?"#dc2626":isWarning?"#ca8a04":task.color}`,
      boxShadow: isOverdue||isCritical?"0 0 12px #dc262622, 0 2px 8px #dc262614":isWarning?"0 0 10px #ca8a0420, 0 2px 6px #ca8a0412":"none",
      transition:"transform 0.12s, box-shadow 0.12s",
    }}
    onMouseEnter={e=>{e.currentTarget.style.transform="translateY(-1px)";e.currentTarget.style.boxShadow=`0 4px 14px ${task.color}18`;}}
    onMouseLeave={e=>{e.currentTarget.style.transform="";e.currentTarget.style.boxShadow=isOverdue||isCritical?"0 0 12px #dc262622, 0 2px 8px #dc262614":isWarning?"0 0 10px #ca8a0420, 0 2px 6px #ca8a0412":"none";}}>

      {/* Color dot / urgency indicator */}
      <div style={{width: isCritical||isOverdue?10:isWarning?9:8, height: isCritical||isOverdue?10:isWarning?9:8,
        borderRadius:"50%",
        background:isOverdue||isCritical?"#dc2626":isWarning?"#ca8a04":task.color,
        flexShrink:0, marginTop:4,
        boxShadow: isCritical||isOverdue?"0 0 6px #dc2626":isWarning?"0 0 5px #ca8a04":"none"}}/>

      <div style={{flex:1,minWidth:0}}>
        {/* Category + urgency row */}
        <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:4,flexWrap:"wrap"}}>
          <span style={{fontSize:9,fontWeight:800,color:task.color,background:`${task.color}18`,borderRadius:99,padding:"2px 8px",border:`1px solid ${task.color}28`,letterSpacing:"0.07em"}}>
            {(CATEGORY_LABELS[task.category]||task.category).toUpperCase()}
          </span>
          {urg&&!editingDate&&(
            <span onClick={()=>{setEditingDate(true);setDateVal(task.dueDate||"");}}
              style={{fontSize:9,fontWeight:800,color:urg.color,background:urg.bg,borderRadius:99,padding:"2px 8px",border:`1px solid ${urg.color}33`,letterSpacing:"0.07em",cursor:"pointer"}}
              title="Click to edit due date">
              {urg.label} ✏
            </span>
          )}
          {!urg&&!editingDate&&onSetDueDate&&(
            <span onClick={()=>{setEditingDate(true);setDateVal("");}}
              style={{fontSize:9,color:"var(--muted)",cursor:"pointer",padding:"2px 6px",borderRadius:99,border:"1px dashed var(--border)"}}
              title="Set due date">
              + due date
            </span>
          )}
          {editingDate&&(
            <div style={{display:"flex",alignItems:"center",gap:4}}>
              <input
                autoFocus
                type="date"
                value={dateVal}
                onChange={e=>{setDateVal(e.target.value);if(e.target.value){if(onSetDueDate)onSetDueDate(task.id,e.target.value);setLocalDueDate(e.target.value);setEditingDate(false);}}}
                onKeyDown={e=>{if(e.key==="Escape")setEditingDate(false);}}
                style={{fontSize:11,border:"1px solid var(--accent)",borderRadius:6,padding:"2px 7px",
                  background:"var(--surface)",color:"var(--text)",fontFamily:"inherit",width:130,outline:"none",colorScheme:"light"}}
              />
              <button onClick={saveDate}
                style={{fontSize:10,fontWeight:700,background:"var(--accent)",border:"none",
                  borderRadius:5,color:"#000",padding:"3px 8px",cursor:"pointer",fontFamily:"inherit"}}>
                Set
              </button>
              {task.dueDate&&(
                <button onClick={()=>{if(onSetDueDate)onSetDueDate(task.id,"");setLocalDueDate("");setEditingDate(false);}}
                  style={{fontSize:10,background:"none",border:"1px solid var(--border)",borderRadius:5,
                    color:"var(--muted)",padding:"3px 7px",cursor:"pointer",fontFamily:"inherit"}}>
                  Clear
                </button>
              )}
              <button onClick={()=>setEditingDate(false)}
                style={{fontSize:10,background:"none",border:"none",color:"var(--muted)",cursor:"pointer",fontFamily:"inherit"}}>
                ✕
              </button>
            </div>
          )}
          {task.foreman&&task.foreman!=="Unassigned"&&(()=>{const fc=getFC(task.foreman)||"#6b7280";return(<span style={{fontSize:9,fontWeight:700,color:fc,background:`${fc}18`,borderRadius:99,padding:"2px 7px",border:`1px solid ${fc}33`,letterSpacing:"0.04em"}}>{task.foreman.split(" ")[0]}</span>);})()}
          {task.type==="manual"&&<span style={{fontSize:9,color:"#6b7280",letterSpacing:"0.06em",fontWeight:600}}>MANUAL</span>}
        </div>

        {/* Title */}
        <div style={{fontSize:13,fontWeight:700,color:"var(--text)",marginBottom:task.jobName||task.desc||task.notes?3:0,lineHeight:1.3}}>
          {task.title}
        </div>

        {/* Job link */}
        {task.jobName&&(
          <div onClick={()=>{const job=jobs.find(j=>j.id===task.jobId);if(job&&onSelectJob)onSelectJob(job);}}
            style={{fontSize:11,color:"var(--accent)",cursor:"pointer",marginBottom:task.desc?2:0,fontWeight:600,display:"flex",alignItems:"center",gap:4}}>
            <span style={{opacity:0.6,fontSize:10}}>↗</span>{task.jobName}
          </div>
        )}

        {task.windowLabel&&(
          <div style={{display:"flex",alignItems:"center",gap:6,marginTop:4,marginBottom:2}}>
            <span style={{fontSize:10,fontWeight:800,
              color:task.needsHardDate?"#dc2626":"#ca8a04",
              background:task.needsHardDate?"#dc262615":"#ca8a0415",
              border:`1px solid ${task.needsHardDate?"#dc262644":"#ca8a0444"}`,
              borderRadius:99,padding:"2px 10px",letterSpacing:"0.04em",whiteSpace:"nowrap"}}>
              {task.needsHardDate?"🔒 ":"📅 "}{task.windowLabel}
            </span>
          </div>
        )}
        {task.desc&&!task.windowLabel&&<div style={{fontSize:11,color:"var(--dim)",fontStyle:"italic",lineHeight:1.4}}>{task.desc}</div>}
        {task.notes&&<div style={{fontSize:11,color:"var(--dim)",marginTop:2,lineHeight:1.4}}>{task.notes}</div>}

        {task.category==="prep"&&task.prepStage&&(
          <div style={{marginTop:6}}>
            <span style={{fontSize:10,fontWeight:700,color:task.prepStage===PREP_STAGE_ALERT?"#dc2626":"#0d9488",background:task.prepStage===PREP_STAGE_ALERT?"#dc262610":"#0d948810",borderRadius:99,padding:"2px 10px",border:`1px solid ${task.prepStage===PREP_STAGE_ALERT?"#dc262633":"#0d948833"}`}}>
              {task.prepStage===PREP_STAGE_ALERT?"⚠ "+task.prepStage:task.prepStage}
            </span>
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div style={{flexShrink:0,display:"flex",flexDirection:"column",gap:4,alignItems:"flex-end"}}>
        {onDismiss&&(
          <button onClick={onDismiss}
            style={{background:"var(--surface)",border:"1px solid var(--border)",borderRadius:7,color:"var(--dim)",fontSize:11,padding:"5px 11px",cursor:"pointer",fontFamily:"inherit",fontWeight:600,whiteSpace:"nowrap"}}>
            ✓ Done
          </button>
        )}
        {!onDismiss&&task.type!=="manual"&&task.jobId&&(
          <button onClick={()=>{
            const job=jobs.find(j=>j.id===task.jobId);
            if(!job||!onManualClear) return;
            onManualClear(task.jobId, [...(job.clearedTasks||[]), task.id]);
          }}
            style={{background:"#16a34a12",border:"1px solid #16a34a44",borderRadius:7,color:"#16a34a",fontSize:11,padding:"5px 11px",cursor:"pointer",fontFamily:"inherit",fontWeight:600,whiteSpace:"nowrap"}}>
            ✓ Mark Done
          </button>
        )}
        {task.jobId&&onSelectJob&&(
          <button onClick={()=>{const job=jobs.find(j=>j.id===task.jobId);if(job)onSelectJob(job);}}
            style={{background:"none",border:"1px solid var(--border)",borderRadius:7,color:"var(--dim)",fontSize:11,padding:"5px 11px",cursor:"pointer",fontFamily:"inherit",whiteSpace:"nowrap"}}>
            Open →
          </button>
        )}
      </div>
    </div>
  );
}

function AddTaskForm({ defaultForeman, onAdd, onCancel, foremenList }) {
  const [t, setT] = useState({title:"", foreman:defaultForeman||"Koy", notes:"", dueDate:""});
  return (
    <div style={{padding:"14px 16px",background:"var(--surface)",border:"1px solid var(--border)",borderRadius:12,marginBottom:16}}>
      <div style={{fontSize:11,fontWeight:700,color:"var(--dim)",letterSpacing:"0.08em",marginBottom:12}}>NEW TASK</div>
      <div style={{display:"flex",gap:10,flexWrap:"wrap",marginBottom:10}}>
        <div style={{flex:3,minWidth:180}}>
          <div style={{fontSize:10,color:"var(--dim)",marginBottom:3}}>Task</div>
          <Inp value={t.title} onChange={e=>setT(x=>({...x,title:e.target.value}))} placeholder="What needs to be done?"/>
        </div>
        <div style={{flex:1,minWidth:110}}>
          <div style={{fontSize:10,color:"var(--dim)",marginBottom:3}}>Assign To</div>
          <select value={t.foreman} onChange={e=>setT(x=>({...x,foreman:e.target.value}))}
            style={{background:"var(--surface)",border:"1px solid var(--border)",borderRadius:7,color:"var(--text)",padding:"7px 10px",fontSize:12,fontFamily:"inherit",outline:"none",cursor:"pointer",width:"100%"}}>
            {(foremenList||getForemenList()).map(f=><option key={f} value={f}>{f}</option>)}
          </select>
        </div>
        <div style={{flex:1,minWidth:110}}>
          <div style={{fontSize:10,color:"var(--dim)",marginBottom:3}}>Due Date</div>
          <DateInp value={t.dueDate} onChange={e=>setT(x=>({...x,dueDate:e.target.value}))}/>
        </div>
      </div>
      <div style={{marginBottom:12}}>
        <div style={{fontSize:10,color:"var(--dim)",marginBottom:3}}>Notes</div>
        <TA value={t.notes} onChange={e=>setT(x=>({...x,notes:e.target.value}))} placeholder="Additional context..." rows={2}/>
      </div>
      <div style={{display:"flex",gap:8}}>
        <button onClick={()=>{if(t.title.trim())onAdd(t);}} style={{background:"var(--accent)",border:"none",borderRadius:7,color:"#000",fontWeight:800,padding:"8px 20px",fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>Add Task</button>
        <button onClick={onCancel} style={{background:"none",border:"1px solid var(--border)",borderRadius:7,color:"var(--dim)",padding:"8px 14px",fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>Cancel</button>
      </div>
    </div>
  );
}

function PrepTaskList({ jobs, onSelectJob, onUpdateJob }) {
  // All jobs in pre-job prep (not complete) — includes ones with no stage set yet
  const prepJobs = jobs.filter(j => !j.tempPed && (j.prepStage||"") !== "Job Prep Complete")
    .sort((a,b) => {
      const ai = PREP_STAGES.indexOf(a.prepStage);
      const bi = PREP_STAGES.indexOf(b.prepStage);
      // Jobs with no stage set go to bottom
      if(ai === -1 && bi === -1) return (a.name||"").localeCompare(b.name||"");
      if(ai === -1) return 1;
      if(bi === -1) return -1;
      return ai - bi;
    });

  const completeJobs = jobs.filter(j => j.prepStage === "Job Prep Complete");

  const stageColor = (stage) => {
    if(stage === PREP_STAGE_ALERT) return "#dc2626";
    if(stage === "Job Prep Complete") return "#16a34a";
    const idx = PREP_STAGES.indexOf(stage);
    const pct = idx / (PREP_STAGES.length - 1);
    if(pct < 0.3) return "#ca8a04";
    if(pct < 0.7) return "#2563eb";
    return "#0d9488";
  };

  return (
    <div>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16,paddingBottom:10,borderBottom:"2px solid #2563eb22"}}>
        <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:18,letterSpacing:"0.08em",color:"#2563eb"}}>PRE JOB PREP TRACKER</div>
        <div style={{background:"#2563eb18",border:"1px solid #2563eb33",borderRadius:99,padding:"2px 10px",fontSize:11,color:"#2563eb",fontWeight:700}}>{prepJobs.length} not complete</div>
        {completeJobs.length>0&&<div style={{background:"#16a34a18",border:"1px solid #16a34a33",borderRadius:99,padding:"2px 10px",fontSize:11,color:"#16a34a",fontWeight:700}}>✓ {completeJobs.length} complete</div>}
      </div>

      {prepJobs.length===0&&(
        <div style={{textAlign:"center",padding:"32px 0",color:"var(--muted)",fontSize:12,fontStyle:"italic"}}>No jobs in pre-job prep</div>
      )}

      {prepJobs.map(job => {
        const stage = job.prepStage||"";
        const stageIdx = PREP_STAGES.indexOf(stage);
        const pct = stageIdx >= 0 ? Math.round((stageIdx / (PREP_STAGES.length-1)) * 100) : 0;
        const sc = stageColor(stage);
        const fc = getFC(job.foreman||"Koy")||"#6b7280";
        return (
          <div key={job.id} style={{marginBottom:10,padding:"14px 16px",background:"var(--card)",border:`1px solid ${sc}33`,borderRadius:12,borderLeft:`3px solid ${sc}`}}
            onMouseEnter={e=>{e.currentTarget.style.boxShadow=`0 4px 16px ${sc}18`;}}
            onMouseLeave={e=>{e.currentTarget.style.boxShadow="none";}}>
            <div style={{display:"flex",alignItems:"flex-start",gap:10,marginBottom:10}}>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:13,fontWeight:700,color:"var(--text)",marginBottom:3,cursor:"pointer"}}
                  onClick={()=>onSelectJob(job)}>{job.name||"Untitled Job"}</div>
                <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
                  {job.address&&<AddressLink address={job.address} style={{fontSize:10,color:"var(--dim)"}}/>}
                  <span style={{fontSize:10,fontWeight:700,color:fc,background:`${fc}15`,borderRadius:99,padding:"1px 7px",border:`1px solid ${fc}28`}}>{job.foreman||"Koy"}</span>
                </div>
              </div>
              <div style={{display:"flex",gap:6,alignItems:"center",flexShrink:0}}>
                <select value={stage} onChange={e=>onUpdateJob(job.id,{prepStage:e.target.value,...(e.target.value===PREP_STAGE_ALERT?{readyToSchedule:false}:{})})}
                  style={{background:sc+"12",border:`1px solid ${sc}55`,borderRadius:7,color:sc,padding:"5px 8px",fontSize:11,fontFamily:"inherit",fontWeight:700,outline:"none",cursor:"pointer",maxWidth:200}}>
                  <option value="">— select —</option>
                  {PREP_STAGES.map(s=><option key={s} value={s}>{s===PREP_STAGE_ALERT?"⚠ "+s:s}</option>)}
                </select>
                <button onClick={()=>onSelectJob(job)} style={{background:"none",border:"1px solid var(--border)",borderRadius:7,color:"var(--dim)",fontSize:11,padding:"5px 10px",cursor:"pointer",fontFamily:"inherit",whiteSpace:"nowrap"}}>Open →</button>
              </div>
            </div>
            {/* Progress bar */}
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <div style={{flex:1,height:5,background:"var(--border)",borderRadius:99,overflow:"hidden"}}>
                <div style={{width:`${pct}%`,height:"100%",background:sc,borderRadius:99,transition:"width 0.3s"}}/>
              </div>
              <span style={{fontSize:10,fontWeight:700,color:sc,minWidth:28,textAlign:"right"}}>{pct}%</span>
            </div>
            {stage===PREP_STAGE_ALERT&&(
              <div style={{marginTop:8,fontSize:10,fontWeight:700,color:"#dc2626",display:"flex",alignItems:"center",gap:5}}>
                <span>⚠</span> Redline Plans Need to be Updated
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── ForemanTaskCard — collapsible task card shown on foreman page ──
// For Koy it shows two tabs: Prep | Tasks. For others just Tasks.
function ForemanTaskCard({ isKoy, fTasks, prepTasks, jobs, manualTasks, onManualTasksChange, onSelectJob, onUpdateJob, activeForeman, foremenList }) {
  const [prepOpen,  setPrepOpen]  = useState(false); // starts collapsed
  const [tasksOpen, setTasksOpen] = useState(true);  // starts expanded

  const overdueCount = fTasks.filter(t=>{ const u=URGENCY(t.dueDate); return u&&u.days<0; }).length;

  const SectionHeader = ({label, count, overdue, open, onToggle, color}) => (
    <div onClick={onToggle}
      style={{display:"flex",alignItems:"center",gap:8,padding:"10px 14px",
        background:`${color}08`,borderBottom:open?`1px solid ${color}22`:"none",
        cursor:"pointer",userSelect:"none"}}>
      <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:14,letterSpacing:"0.08em",color}}>{label}</div>
      {count>0&&<div style={{background:`${color}18`,border:`1px solid ${color}33`,borderRadius:99,
        padding:"1px 8px",fontSize:11,color,fontWeight:700}}>{count}</div>}
      {overdue>0&&<div style={{background:"#dc262618",border:"1px solid #dc262633",borderRadius:99,
        padding:"1px 8px",fontSize:11,color:"#dc2626",fontWeight:700}}>⚠ {overdue}</div>}
      <div style={{marginLeft:"auto",fontSize:12,color,opacity:0.6}}>{open?"▾":"▸"}</div>
    </div>
  );

  return (
    <div style={{margin:"0 0 16px",border:"1px solid #dc262633",borderRadius:12,overflow:"hidden"}}>

      {/* Job Prep section — Koy only, starts collapsed */}
      {isKoy && (
        <>
          <SectionHeader
            label="JOB PREP"
            count={prepTasks.length}
            overdue={0}
            open={prepOpen}
            onToggle={()=>setPrepOpen(v=>!v)}
            color="#f59e0b"
          />
          {prepOpen && (
            <div style={{padding:"12px 14px",borderBottom:"1px solid #dc262322"}}>
              {prepTasks.length===0
                ? <div style={{fontSize:12,color:"var(--muted)",textAlign:"center",padding:"12px 0"}}>✓ All prep complete</div>
                : <PrepTaskList jobs={jobs} onSelectJob={onSelectJob} onUpdateJob={onUpdateJob}/>
              }
            </div>
          )}
        </>
      )}

      {/* Tasks section — all foremen, starts expanded */}
      <SectionHeader
        label="TASKS"
        count={fTasks.length}
        overdue={overdueCount}
        open={tasksOpen}
        onToggle={()=>setTasksOpen(v=>!v)}
        color="#dc2626"
      />
      {tasksOpen && (
        <div style={{padding:"12px 14px"}}>
          {fTasks.length===0
            ? <div style={{fontSize:12,color:"var(--muted)",textAlign:"center",padding:"12px 0"}}>✓ No open tasks</div>
            : <Tasks
                jobs={jobs}
                manualTasks={manualTasks}
                onManualTasksChange={onManualTasksChange}
                onSelectJob={onSelectJob}
                onUpdateJob={onUpdateJob}
                filterForeman={activeForeman}
                foremenList={foremenList}
              />
          }
        </div>
      )}
    </div>
  );
}

function Tasks({ jobs, manualTasks, onManualTasksChange, onSelectJob, onUpdateJob, filterForeman, compact, foremenList }) {
  const [showAdd,          setShowAdd]          = useState(false);
  const [collapsedForemen, setCollapsedForemen] = useState({});
  const [catFilter,        setCatFilter]        = useState("all");
  const [prepOpen,         setPrepOpen]         = useState(false); // collapsed by default
  const toggleForeman = (f) => setCollapsedForemen(c=>({...c,[f]:!c[f]}));

  const handleSetDueDate = (taskId, date) => {
    const isManual = (manualTasks||[]).find(t => t.id === taskId);
    if(isManual) { onManualTasksChange((manualTasks||[]).map(t => t.id===taskId ? {...t, dueDate:date} : t)); return; }
    const autoTasks = computeTasks(jobs);
    const task = autoTasks.find(t => t.id === taskId);
    if(task && task.jobId && onUpdateJob) {
      const job = jobs.find(j => j.id === task.jobId);
      if(job) onUpdateJob(task.jobId, { taskDueDates: {...(job.taskDueDates||{}), [taskId]: date} });
    }
  };

  const handleAdd = (t) => {
    const task = { id: uid(), title: t.title, foreman: t.foreman,
      notes: t.notes, dueDate: t.dueDate||"", type:"manual", category:"manual",
      color: "#6b7280", cleared:false, createdAt: new Date().toISOString() };
    onManualTasksChange([...(manualTasks||[]), task]);
    setShowAdd(false);
  };

  const dismissManual        = (id)        => { onManualTasksChange((manualTasks||[]).filter(t=>t.id!==id)); };
  const dismissInvoiceTask   = (jobId)     => { const job=jobs.find(j=>j.id===jobId); if(job&&onUpdateJob) onUpdateJob(jobId, invoiceSentPatch(job)); };
  const dismissRoughDeposit  = (jobId)     => { const job=jobs.find(j=>j.id===jobId); if(job&&onUpdateJob) onUpdateJob(jobId,{roughDepositDismissed:true}); };
  const dismissFinishDeposit = (jobId)     => { const job=jobs.find(j=>j.id===jobId); if(job&&onUpdateJob) onUpdateJob(jobId,{finishDepositDismissed:true}); };
  const dismissRoughInvoice  = (jobId)     => { const job=jobs.find(j=>j.id===jobId); if(job&&onUpdateJob) onUpdateJob(jobId,{roughInvoiceDismissed:true}); };
  const dismissFinishInvoice = (jobId)     => { const job=jobs.find(j=>j.id===jobId); if(job&&onUpdateJob) onUpdateJob(jobId,{finishInvoiceDismissed:true}); };
  const handleManualClear    = (jobId, clearedTasks) => { if(onUpdateJob) onUpdateJob(jobId,{clearedTasks}); };
  const dismissCODoneTask    = (jobId,coId)=> { const job=jobs.find(j=>j.id===jobId); if(job&&onUpdateJob) onUpdateJob(jobId,{coDoneDismissed:[...(job.coDoneDismissed||[]),coId]}); };
  const dismissRTDoneTask    = (jobId,rtId)=> { const job=jobs.find(j=>j.id===jobId); if(job&&onUpdateJob) onUpdateJob(jobId,{rtDoneDismissed:[...(job.rtDoneDismissed||[]),rtId]}); };

  const allTaskDueDates = jobs.reduce((acc,j)=>({...acc,...(j.taskDueDates||{})}),{});
  // Build set of manually cleared task IDs across all jobs
  const allClearedTasks = new Set(jobs.flatMap(j=>j.clearedTasks||[]));

  const autoTasks = computeTasks(jobs);
  const allTasks = [
    ...autoTasks.map(t=>{ const d=allTaskDueDates[t.id]; return d!==undefined?{...t,dueDate:d||t.dueDate||""}:t; }),
    ...(manualTasks||[]).map(t=>({...t,type:"manual"}))
  ].filter(t => t.category !== "prep" && (!filterForeman || t.foreman === filterForeman) && !allClearedTasks.has(t.id));

  const URGENCY_FN = (due) => {
    if(!due) return null;
    const d=(str=>{ const m=str.match(/^(\d{4})-(\d{2})-(\d{2})$/); if(m) return new Date(+m[1],+m[2]-1,+m[3]); const m2=str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/); if(m2) return new Date(+m2[2],+m2[1]-1,+(m2[3].length===2?"20"+m2[3]:m2[3])); return null; })(due);
    if(!d) return null;
    const days=Math.floor((d-new Date().setHours(0,0,0,0))/(1000*60*60*24));
    return {days,color:days<0?"#dc2626":days<=3?"#ea580c":days<=7?"#ca8a04":"#16a34a",label:days<0?`${Math.abs(days)}d overdue`:days===0?"Due today":days===1?"Due tomorrow":`Due in ${days}d`};
  };

  // Separate invoice tasks from regular tasks
  const isInvoiceCat = (t) => t.category==="invoice" || t.id.endsWith("_rough_deposit") || t.id.endsWith("_finish_deposit");
  const invoiceTasks = allTasks.filter(isInvoiceCat);
  const otherTasks   = allTasks.filter(t=>!isInvoiceCat(t));

  // Ready to Invoice jobs (the job-level flag, separate from task list)
  const invoiceJobs = jobs.filter(j=>j.readyToInvoice&&(!filterForeman||matchesForeman(j,filterForeman)));

  const sorted = [...otherTasks].sort((a,b)=>{
    const ua=URGENCY_FN(a.dueDate), ub=URGENCY_FN(b.dueDate);
    if(ua&&ub) return ua.days-ub.days; if(ua) return -1; if(ub) return 1; return 0;
  });
  const sortedInvoice = [...invoiceTasks].sort((a,b)=>{
    const ua=URGENCY_FN(a.dueDate), ub=URGENCY_FN(b.dueDate);
    if(ua&&ub) return ua.days-ub.days; if(ua) return -1; if(ub) return 1; return 0;
  });

  const foremanList = filterForeman ? [filterForeman] : [...(foremenList||getForemenList()),"Unassigned"];
  const totalInvoice = invoiceTasks.length + invoiceJobs.length;
  const totalOther   = otherTasks.length;
  const overdueCount = sorted.filter(t=>{ const u=URGENCY_FN(t.dueDate); return u&&u.days<0; }).length;

  const dismissFor = (task) =>
    task.type==="manual"                    ? ()=>dismissManual(task.id) :
    task.id.endsWith("_rough_deposit")      ? ()=>dismissRoughDeposit(task.jobId) :
    task.id.endsWith("_finish_deposit")     ? ()=>dismissFinishDeposit(task.jobId) :
    task.id.endsWith("_rough_invoice")      ? ()=>dismissRoughInvoice(task.jobId) :
    task.id.endsWith("_finish_invoice")     ? ()=>dismissFinishInvoice(task.jobId) :
    task.category==="invoice"               ? ()=>dismissInvoiceTask(task.jobId) :
    task.id.endsWith("_done")&&task.coId   ? ()=>dismissCODoneTask(task.jobId,task.coId) :
    task.id.endsWith("_done")&&task.rtId   ? ()=>dismissRTDoneTask(task.jobId,task.rtId) :
    null;

  // ── Invoice section — collapsible ────────────────────────────
  const [invoiceCollapsed, setInvoiceCollapsed] = useState(false);

  const InvoiceSection = () => {
    if(totalInvoice===0 && invoiceJobs.length===0) return null;
    const count = invoiceJobs.length + sortedInvoice.length;
    return (
      <div style={{marginBottom:24}}>
        <div onClick={()=>setInvoiceCollapsed(c=>!c)}
          style={{display:"flex",alignItems:"center",gap:8,marginBottom:invoiceCollapsed?0:12,
            paddingBottom:8,borderBottom:"2px solid #ea580c33",cursor:"pointer",userSelect:"none"}}>
          <div style={{width:9,height:9,borderRadius:"50%",background:"#ea580c"}}/>
          <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:18,letterSpacing:"0.08em",color:"#ea580c"}}>
            READY TO INVOICE
          </div>
          <div style={{background:"#ea580c18",border:"1px solid #ea580c33",borderRadius:99,
            padding:"1px 8px",fontSize:11,color:"#ea580c",fontWeight:700}}>{count}</div>
          <div style={{marginLeft:"auto",fontSize:12,color:"#ea580c",opacity:0.7,paddingRight:4}}>
            {invoiceCollapsed?"▸":"▾"}
          </div>
        </div>
        {!invoiceCollapsed&&(
          <>
            {/* Job-level ready to invoice */}
            {invoiceJobs.map(job=>{
              const fc = getFC(job.foreman)||"#6b7280";
              return (
                <div key={job.id}
                  style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,
                    padding:"11px 14px",borderRadius:10,marginBottom:6,
                    background:"#ea580c08",border:"1px solid #ea580c33",borderLeft:"3px solid #ea580c"}}>
                  <div onClick={()=>onSelectJob(job)} style={{flex:1,cursor:"pointer"}}>
                    <div style={{fontSize:13,fontWeight:700,color:"var(--text)",marginBottom:2}}>
                      {job.name||"Untitled Job"}
                    </div>
                    <div style={{fontSize:11,color:"var(--dim)",display:"flex",gap:8}}>
                      {job.address&&<AddressLink address={job.address} style={{color:"var(--dim)"}}/>}
                      <span style={{fontWeight:700,color:fc}}>{job.foreman}</span>
                    </div>
                  </div>
                  <div style={{display:"flex",gap:8,alignItems:"center",flexShrink:0}}>
                    <button onClick={()=>onSelectJob(job)}
                      style={{fontSize:11,fontWeight:600,color:"#ea580c",background:"none",
                        border:"1px solid #ea580c44",borderRadius:7,padding:"5px 10px",
                        cursor:"pointer",fontFamily:"inherit"}}>
                      Open →
                    </button>
                    <button onClick={()=>{ if(onUpdateJob) onUpdateJob(job.id,invoiceSentPatch(job)); }}
                      style={{fontSize:11,fontWeight:700,color:"#fff",background:"#ea580c",
                        border:"none",borderRadius:7,padding:"5px 14px",
                        cursor:"pointer",fontFamily:"inherit"}}>
                      ✓ Invoice Sent
                    </button>
                  </div>
                </div>
              );
            })}
            {/* Invoice-category tasks (deposits, stale alerts, etc.) */}
            {sortedInvoice.map(task=>(
              <TaskCard key={task.id} task={task} jobs={jobs} onSelectJob={onSelectJob}
                onDismiss={dismissFor(task)} onSetDueDate={handleSetDueDate} onManualClear={handleManualClear}/>
            ))}
          </>
        )}
      </div>
    );
  };

  return (
    <div>
      {!compact&&!filterForeman&&(
        <div style={{padding:"24px 26px 16px",borderBottom:"1px solid var(--border)"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,flexWrap:"wrap"}}>
            <div>
              <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:28,letterSpacing:"0.06em",color:"var(--text)",lineHeight:1}}>TASKS</div>
              <div style={{display:"flex",gap:8,marginTop:4,flexWrap:"wrap",alignItems:"center"}}>
                <span style={{fontSize:11,color:"var(--dim)"}}>{totalOther} task{totalOther!==1?"s":""}</span>
                {totalInvoice>0&&<span style={{fontSize:11,fontWeight:700,color:"#ea580c",background:"#ea580c12",borderRadius:99,padding:"1px 8px",border:"1px solid #ea580c33"}}>💰 {totalInvoice} invoice</span>}
                {overdueCount>0&&<span style={{fontSize:11,fontWeight:700,color:"#dc2626",background:"#dc262612",borderRadius:99,padding:"1px 8px",border:"1px solid #dc262633"}}>⚠ {overdueCount} overdue</span>}
              </div>
            </div>
            <div style={{display:"flex",gap:8,alignItems:"center"}}>
              {/* Category filter dropdown */}
              <select value={catFilter} onChange={e=>setCatFilter(e.target.value)}
                style={{background:"var(--surface)",border:"1px solid var(--border)",borderRadius:8,
                  color:catFilter==="invoice"?"#ea580c":"var(--dim)",
                  padding:"7px 12px",fontSize:12,fontFamily:"inherit",outline:"none",
                  fontWeight:catFilter!=="all"?700:400,cursor:"pointer"}}>
                <option value="all">All Categories</option>
                <option value="invoice">💰 Ready to Invoice</option>
                <option value="other">Tasks Only</option>
              </select>
              <button onClick={()=>setShowAdd(v=>!v)}
                style={{background:"var(--accent)",border:"none",borderRadius:9,color:"#000",
                  fontWeight:800,padding:"9px 22px",fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>
                + Add Task
              </button>
            </div>
          </div>
        </div>
      )}

      <div style={{padding:filterForeman||compact?"0":"16px 26px"}}>
        {showAdd&&<AddTaskForm defaultForeman={filterForeman||"Koy"} onAdd={handleAdd} onCancel={()=>setShowAdd(false)} foremenList={foremenList}/>}

        {/* Pre Job Prep — only on main Tasks page (not foreman filter), collapsible, starts collapsed */}
        {!filterForeman&&catFilter!=="invoice"&&(()=>{
          const prepJobs = jobs.filter(j=>!j.tempPed&&(j.prepStage||"")!=="Job Prep Complete");
          if(prepJobs.length===0) return null;
          return (
            <div style={{marginBottom:24}}>
              <div onClick={()=>setPrepOpen(v=>!v)}
                style={{display:"flex",alignItems:"center",gap:8,marginBottom:prepOpen?12:0,
                  paddingBottom:8,borderBottom:"2px solid #0d948833",cursor:"pointer",userSelect:"none"}}>
                <div style={{width:9,height:9,borderRadius:"50%",background:"#0d9488"}}/>
                <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:18,letterSpacing:"0.08em",color:"#0d9488"}}>
                  PRE JOB PREP
                </div>
                <div style={{background:"#0d948818",border:"1px solid #0d948833",borderRadius:99,
                  padding:"1px 8px",fontSize:11,color:"#0d9488",fontWeight:700}}>{prepJobs.length}</div>
                <div style={{marginLeft:"auto",fontSize:12,color:"#0d9488",opacity:0.7,paddingRight:4}}>
                  {prepOpen?"▾":"▸"}
                </div>
              </div>
              {prepOpen&&<PrepTaskList jobs={jobs} onSelectJob={onSelectJob} onUpdateJob={onUpdateJob}/>}
            </div>
          );
        })()}

        {/* Ready to Invoice section — shown unless filtered to "other" */}
        {catFilter!=="other"&&<InvoiceSection/>}

        {/* Regular tasks — shown unless filtered to "invoice" */}
        {catFilter!=="invoice"&&(
          <>
            {totalOther===0&&(
              <div style={{textAlign:"center",padding:"40px 0",color:"var(--muted)"}}>
                <div style={{fontSize:22,marginBottom:6}}>✓</div>
                <div style={{fontSize:13}}>No open tasks{filterForeman?` for ${filterForeman}`:""}</div>
              </div>
            )}

            {filterForeman ? (
              <div>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
                  <div style={{fontSize:11,fontWeight:700,color:"var(--dim)",letterSpacing:"0.06em"}}>TASKS</div>
                  <button onClick={()=>setShowAdd(v=>!v)} style={{background:"none",border:"1px solid var(--border)",borderRadius:7,color:"var(--dim)",fontSize:11,padding:"4px 12px",cursor:"pointer",fontFamily:"inherit",fontWeight:600}}>+ Add Task</button>
                </div>
                {showAdd&&<AddTaskForm defaultForeman={filterForeman} onAdd={handleAdd} onCancel={()=>setShowAdd(false)} foremenList={foremenList}/>}
                {sorted.map(task=>(
                  <TaskCard key={task.id} task={task} jobs={jobs} onSelectJob={onSelectJob}
                    onDismiss={dismissFor(task)} onSetDueDate={handleSetDueDate} onManualClear={handleManualClear}/>
                ))}
              </div>
            ) : (
              [
                {key:'scheduling', label:'Scheduling',      icon:'📅', color:'#2563eb', cats:['rough','finish','schedule','tempped']},
                {key:'rt',         label:'Return Trips',    icon:'🔄', color:'#8b5cf6', cats:['rt']},
                {key:'co',         label:'Change Orders',   icon:'📋', color:'#dc2626', cats:['co']},
                {key:'qc',         label:'QC Walks',        icon:'✅', color:'#0d9488', cats:['qc']},
                {key:'po',         label:'Purchase Orders', icon:'📦', color:'#7c3aed', cats:['po']},
                {key:'punch',      label:'Open Punch',      icon:'⚠️', color:'#ea580c', cats:['punch']},
                {key:'manual',     label:'Manual Tasks',    icon:'📝', color:'#6b7280', cats:['manual']},
              ].map(group=>{
                const groupTasks = sorted.filter(t=>group.cats.includes(t.category));
                if(groupTasks.length===0) return null;
                const gc = group.color;
                const isCollapsed = !!collapsedForemen[group.key];
                const overdue = groupTasks.filter(t=>{ const u=URGENCY_FN(t.dueDate); return u&&u.days<0; }).length;
                return (
                  <div key={group.key} style={{marginBottom:28}}>
                    <div onClick={()=>toggleForeman(group.key)}
                      style={{display:"flex",alignItems:"center",gap:8,marginBottom:isCollapsed?0:12,
                        paddingBottom:8,borderBottom:`2px solid ${gc}33`,cursor:"pointer",userSelect:"none"}}>
                      <span style={{fontSize:14,lineHeight:1}}>{group.icon}</span>
                      <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:18,letterSpacing:"0.08em",color:gc}}>{group.label}</div>
                      <div style={{background:`${gc}18`,border:`1px solid ${gc}33`,borderRadius:99,padding:"1px 8px",fontSize:11,color:gc,fontWeight:700}}>{groupTasks.length}</div>
                      {overdue>0&&<div style={{background:"#dc262618",border:"1px solid #dc262633",borderRadius:99,padding:"1px 8px",fontSize:11,color:"#dc2626",fontWeight:700}}>⚠ {overdue} overdue</div>}
                      <div style={{marginLeft:"auto",fontSize:12,color:gc,opacity:0.7,paddingRight:4}}>{isCollapsed?"▸":"▾"}</div>
                    </div>
                    {!isCollapsed&&groupTasks.map(task=>(
                      <TaskCard key={task.id} task={task} jobs={jobs} onSelectJob={onSelectJob}
                        onDismiss={dismissFor(task)} onSetDueDate={handleSetDueDate} onManualClear={handleManualClear}/>
                    ))}
                  </div>
                );
              })
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Scheduling Forecast ───────────────────────────────────────

function SchedulingForecast({ jobs, onSelectJob, foremenList }) {
  const [foremanTab, setForemanTab] = useState("All");
  const [viewMode,   setViewMode]   = useState("calendar"); // kanban | week | attention | calendar
  const [calMonth,   setCalMonth]   = useState(() => { const d=new Date(); d.setDate(1); d.setHours(0,0,0,0); return d; });
  const [calDayDetail, setCalDayDetail] = useState(null); // date string YYYY-MM-DD for expanded day

  const today = new Date(); today.setHours(0,0,0,0);
  const todayStr = today.toISOString().split("T")[0];

  const startOfWeek=(d)=>{ const dt=new Date(d); dt.setHours(0,0,0,0); dt.setDate(dt.getDate()-dt.getDay()); return dt; };
  const thisWeekStart=startOfWeek(today);
  const nextWeekStart=new Date(thisWeekStart); nextWeekStart.setDate(thisWeekStart.getDate()+7);
  const twoWeeksStart=new Date(thisWeekStart); twoWeeksStart.setDate(thisWeekStart.getDate()+14);

  const getBucket=(dateStr,status)=>{
    const d=parseAnyDate(dateStr); if(!d) return "nodate";
    const c=new Date(d); c.setHours(0,0,0,0);
    if(c<thisWeekStart && status!=="inprogress") return "overdue";
    if(c<nextWeekStart) return "thisWeek";
    if(c<twoWeeksStart) return "nextWeek";
    return "later";
  };

  const fmtDate=(str)=>{ const d=parseAnyDate(str); if(!d) return null; return d.toLocaleDateString("en-US",{month:"short",day:"numeric"}); };
  const fmtFull=(str)=>{ const d=parseAnyDate(str); if(!d) return null; return d.toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric",year:"numeric"}); };
  const isOverdue=(str,status)=>{ if(status==="inprogress") return false; const d=parseAnyDate(str); if(!d) return false; const c=new Date(d); c.setHours(0,0,0,0); return c<today; };
  const fmtYMD=(d)=>{ if(!d) return ''; const dt=new Date(d); return isNaN(dt)?'':dt.toISOString().split("T")[0]; };

  // ── Build "events" — one per schedulable item (not per job) ──────────────
  // Each event: { id, job, type, label, color, startDate, endDate, status, desc, hardDate }
  const buildEvents=(jobList)=>{
    const events=[];
    jobList.filter(j=>!j.tempPed).forEach(job=>{
      const rs=effRS(job), fs=effFS(job);
      const fc=getFC(job.foreman||"Koy");

      // ── Quick Jobs ──
      if(job.quickJob) {
        const qjs = job.quickJobStatus || "new";
        if(qjs !== "invoice" && !(qjs === "complete" && job.invoiceSent)) {
          const typeDef = QUICK_JOB_TYPES.find(t=>t.value===job.quickJobType) || QUICK_JOB_TYPES[3];
          const qjDef = getStatusDef(QUICK_JOB_STATUSES, qjs);
          const start = job.quickJobDate || "";
          if(start || qjs === "new") events.push({
            id:job.id+"_quick", job, type:"quick",
            label:typeDef.label.toUpperCase(), color:qjDef.color||typeDef.color, fc,
            startDate:start,
            endDate:(qjs==="scheduled"||qjs==="inprogress")?job.quickJobEndDate||"":"",
            hardDate:false,
            status:qjs, statusLabel:qjDef.label||"New",
            desc:job.scope||qjDef.label||"Quick Job",
          });
        }
        return; // skip rough/finish for quick jobs
      }

      // ── Rough ──
      // ── Rough — include invoice status ──
      // Show on forecast if: has a status (not complete), OR has a projected start date
      const hasRoughDate = !!(job.roughProjectedStart || job.roughStatusDate);
      if((rs&&rs!=="complete") || (!rs && hasRoughDate && parseInt(job.roughStage||"0")< 100)) {
        const rsDef=getStatusDef(ROUGH_STATUSES,rs);
        // Date priority: when scheduled, use the scheduled date first; otherwise projected start
        const start=(rs==="scheduled"||rs==="inprogress")
          ? (job.roughStatusDate||job.roughProjectedStart||"")
          : (job.roughProjectedStart||job.roughStatusDate||"");
        const isInv=rs==="invoice";
        if(start||rs==="waiting_date"||rs==="date_confirmed"||rs==="scheduled"||rs==="inprogress"||isInv) events.push({
          id:job.id+"_rough", job, type:"rough",
          label:"ROUGH", color:isInv?"#ea580c":rsDef.color||C.rough, fc,
          startDate:isInv?job.readyToInvoiceDate||start:start,
          endDate:(rs==="scheduled"||rs==="inprogress")?job.roughScheduledEnd||"":"",
          hardDate:false,
          status:rs, statusLabel:isInv?"Ready to Invoice":(rsDef.label||"Projected"),
          desc:isInv?"Ready to Invoice":(rsDef.label||"Projected start date set"),
        });
      }

      // ── Finish — include invoice status ──
      // Show on forecast if: has a status (not complete), OR has a projected start date
      const hasFinishDate = !!(job.finishProjectedStart || job.finishStatusDate);
      if((fs&&fs!=="complete") || (!fs && hasFinishDate && parseInt(job.finishStage||"0") < 100)) {
        const fsDef=getStatusDef(FINISH_STATUSES,fs);
        // Date priority: when scheduled, use the scheduled date first; otherwise projected start
        const start=(fs==="scheduled"||fs==="inprogress")
          ? (job.finishStatusDate||job.finishProjectedStart||"")
          : (job.finishProjectedStart||job.finishStatusDate||"");
        const isInv=fs==="invoice";
        if(start||fs==="waiting_date"||fs==="date_confirmed"||fs==="scheduled"||fs==="inprogress"||isInv) events.push({
          id:job.id+"_finish", job, type:"finish",
          label:"FINISH", color:isInv?"#ea580c":fsDef.color||C.finish, fc,
          startDate:isInv?job.readyToInvoiceDate||start:start,
          endDate:(fs==="scheduled"||fs==="inprogress")?job.finishScheduledEnd||"":"",
          hardDate:false,
          status:fs, statusLabel:isInv?"Ready to Invoice":(fsDef.label||"Projected"),
          desc:isInv?"Ready to Invoice":(fsDef.label||"Projected start date set"),
        });
      }

      // ── Ready to Invoice (job-level flag, not phase-specific) ──
      if(job.readyToInvoice&&!job.invoiceDismissed&&rs!=="invoice"&&fs!=="invoice") {
        events.push({
          id:job.id+"_invoice", job, type:"invoice",
          label:"INVOICE", color:"#ea580c", fc,
          startDate:job.readyToInvoiceDate||"", endDate:"",
          hardDate:false,
          status:"invoice", statusLabel:"Ready to Invoice",
          desc:"Ready to Invoice",
        });
      }

      // ── Return Trips ──
      (job.returnTrips||[]).filter(r=>!r.signedOff&&r.rtStatus!=="complete"&&(r.scope||r.rtStatus||r.rtStatusDate||r.date)).forEach((rt,i)=>{
        const start=rt.rtStatusDate||rt.date||"";
        const rtDef=getStatusDef(RT_STATUSES,rt.rtStatus||"needs");
        const statusLabel=rt.rtStatus==="needs"?"Needs to be Scheduled":rtDef.label||rt.rtStatus||"needs scheduling";
        events.push({
          id:job.id+"_rt_"+rt.id, job, type:"rt",
          label:"RT "+(i+1), color:rtDef.color||"#8b5cf6", fc,
          startDate:start, endDate:"",
          hardDate:false,
          status:rt.rtStatus||"", statusLabel,
          desc:rt.scope||"Return trip",
          rtNeedsDate: rt.rtStatus==="needs"?rt.rtStatusDate:"",
        });
      });

      // ── Change Orders ──
      (job.changeOrders||[]).filter(co=>co.coStatus&&co.coStatus!=="completed"&&co.coStatus!=="denied"&&co.coStatus!=="converted").forEach((co,i)=>{
        const start=co.coStatusDate||"";
        const coDef=getStatusDef(CO_STATUSES_NEW,co.coStatus||"pending");
        events.push({
          id:job.id+"_co_"+co.id, job, type:"co",
          label:"CO "+(i+1), color:coDef.color||C.accent, fc,
          startDate:start, endDate:"",
          hardDate:false,
          status:co.coStatus||"pending", statusLabel:coDef.label||co.coStatus,
          desc:co.desc||"Change order",
        });
      });

      // ── QC Walk — show for all active statuses including scheduled ──
      if(job.roughQCTaskFired&&job.qcStatus&&!["completed","pass","fail"].includes(job.qcStatus)) {
        const qcDef=getStatusDef(QC_STATUSES,job.qcStatus||"");
        const start=job.qcStatusDate||"";
        events.push({
          id:job.id+"_qc", job, type:"qc",
          label:"QC", color:qcDef.color||C.teal, fc,
          startDate:start, endDate:"",
          hardDate:false,
          status:job.qcStatus, statusLabel:qcDef.label||job.qcStatus,
          desc:"QC Walk",
        });
      }
    });
    return events;
  };

  const foremanTabs=["All",...(foremenList||getForemenList()),"Unassigned"];
  const matchesForemanTab = (job, tab) => {
    const jf = (job.foreman||"").trim().toLowerCase();
    const t  = (tab||"").trim().toLowerCase();
    if(jf===t) return true;
    if(t.startsWith(jf+" ")||jf.startsWith(t+" ")) return true;
    const parts = t.split(" ");
    return parts.some(p=>p&&(p===jf||p.includes(jf)||jf.includes(p)));
  };
  const filteredJobs=foremanTab==="All"?jobs
    :foremanTab==="Unassigned"?jobs.filter(j=>!j.foreman||j.foreman==="Unassigned")
    :jobs.filter(j=>matchesForemanTab(j,foremanTab));

  const allEvents=buildEvents(filteredJobs);

  // bucket by startDate for kanban
  const getBucketForEvent=(ev)=>{
    if(!ev.startDate) return "nodate";
    return getBucket(ev.startDate, ev.status);
  };

  const BUCKETS=[
    {key:"overdue",  label:"Overdue",    color:C.red},
    {key:"thisWeek", label:"This Week",  color:C.green},
    {key:"nextWeek", label:"Next Week",  color:C.blue},
    {key:"later",    label:"Later",      color:C.dim},
    {key:"nodate",   label:"Needs Date", color:"#ca8a04"},
  ];

  // ── Event pill (compact, used in calendar cells) ──────────────
  const EventPill=({ev,mini})=>{
    const over=isOverdue(ev.startDate,ev.status);
    const col=over?C.red:ev.color;
    return (
      <div onClick={e=>{e.stopPropagation();onSelectJob(ev.job);}}
        style={{display:"flex",alignItems:"center",gap:4,padding:mini?"2px 6px":"3px 8px",
          borderRadius:99,marginBottom:2,cursor:"pointer",
          background:col+"18",border:`1px solid ${col}33`,
          transition:"background 0.1s"}}
        onMouseEnter={e=>e.currentTarget.style.background=col+"30"}
        onMouseLeave={e=>e.currentTarget.style.background=col+"18"}>
        <span style={{width:6,height:6,borderRadius:"50%",background:col,flexShrink:0,display:"block"}}/>
        <span style={{fontSize:mini?9:10,fontWeight:700,color:col,flexShrink:0}}>{ev.label}</span>
        <span style={{fontSize:mini?9:10,color:"var(--text)",fontWeight:600,
          overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",flex:1}}>
          {ev.job.name||"Untitled"}
        </span>
        {ev.hardDate&&<span style={{fontSize:8,color:col,fontWeight:800,flexShrink:0}}>🔒</span>}
      </div>
    );
  };

  // ── Event Card (kanban/list) ──────────────────────────────────
  const EventCard=({ev})=>{
    const over=isOverdue(ev.startDate,ev.status);
    const col=over?C.red:ev.color;
    const fc=ev.fc;
    return (
      <div onClick={()=>onSelectJob(ev.job)}
        style={{background:"var(--card)",borderRadius:12,padding:"11px 13px",marginBottom:6,cursor:"pointer",
          border:`1px solid ${over?C.red+"44":col+"22"}`,borderLeft:`3px solid ${col}`,
          transition:"transform 0.1s,box-shadow 0.1s"}}
        onMouseEnter={e=>{e.currentTarget.style.transform="translateY(-1px)";e.currentTarget.style.boxShadow=`0 4px 12px ${col}18`;}}
        onMouseLeave={e=>{e.currentTarget.style.transform="";e.currentTarget.style.boxShadow="";}}>
        <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:6}}>
          <span style={{fontSize:9,fontWeight:800,color:col,background:col+"18",borderRadius:99,
            padding:"2px 8px",border:`1px solid ${col}28`,letterSpacing:"0.07em",flexShrink:0}}>{ev.label}</span>
          <span style={{fontSize:9,fontWeight:700,color:fc,background:fc+"15",borderRadius:99,
            padding:"2px 7px",border:`1px solid ${fc}28`,flexShrink:0}}>{ev.job.foreman||"Koy"}</span>
          {over&&<span style={{fontSize:9,fontWeight:800,color:C.red,letterSpacing:"0.07em",marginLeft:"auto"}}>OVERDUE</span>}
        </div>
        <div style={{fontWeight:700,fontSize:13,color:"var(--text)",marginBottom:3,
          overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{ev.job.name||"Untitled"}</div>
        {ev.desc&&ev.type!=="rough"&&ev.type!=="finish"&&
          <div style={{fontSize:11,color:"var(--dim)",marginBottom:4,overflow:"hidden",
            textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{ev.desc}</div>}
        <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap",marginTop:2}}>
          <span style={{fontSize:10,fontWeight:700,color:ev.statusLabel?col:"var(--dim)"}}>{ev.statusLabel}</span>
          {ev.startDate&&(
            <span style={{fontSize:10,fontWeight:700,color:over?C.red:"var(--dim)",marginLeft:"auto"}}>
              {ev.type==="rt"&&ev.status==="needs"?"Due: ":""}{fmtDate(ev.startDate)||""}{ev.endDate?" \u2013 "+fmtDate(ev.endDate):""}
            </span>
          )}
        </div>
      </div>
    );
  };

  // ── CALENDAR helpers ──────────────────────────────────────────
  // Returns true if an event "covers" a given date (for window events)
  const eventCoversDate=(ev,dateStr)=>{
    if(!ev.startDate) return false;
    const start=parseAnyDate(ev.startDate);
    if(!start) return false;
    start.setHours(0,0,0,0);
    const target=parseAnyDate(dateStr);
    if(!target) return false;
    target.setHours(0,0,0,0);
    if(ev.endDate){
      const end=parseAnyDate(ev.endDate);
      if(end){ end.setHours(0,0,0,0); return target>=start&&target<=end; }
    }
    return fmtYMD(start)===dateStr;
  };

  const eventsForDate=(dateStr)=>allEvents.filter(ev=>eventCoversDate(ev,dateStr));

  // ── Calendar view ─────────────────────────────────────────────
  const CalendarView=()=>{
    const year=calMonth.getFullYear();
    const month=calMonth.getMonth();
    const firstDay=new Date(year,month,1).getDay(); // 0=Sun
    const daysInMonth=new Date(year,month+1,0).getDate();
    const prevMonth=()=>setCalMonth(new Date(year,month-1,1));
    const nextMonth=()=>setCalMonth(new Date(year,month+1,1));
    const monthLabel=calMonth.toLocaleDateString("en-US",{month:"long",year:"numeric"});

    // Build grid: leading blanks + days
    const cells=[];
    for(let i=0;i<firstDay;i++) cells.push(null);
    for(let d=1;d<=daysInMonth;d++) cells.push(d);

    return (
      <div style={{padding:"16px 20px"}}>
        {/* Month nav */}
        <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:16}}>
          <button onClick={prevMonth} style={{background:"none",border:`1px solid ${C.border}`,borderRadius:8,
            color:"var(--dim)",padding:"6px 14px",cursor:"pointer",fontSize:16,fontFamily:"inherit"}}>‹</button>
          <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:24,letterSpacing:"0.06em",
            color:"var(--text)",flex:1,textAlign:"center"}}>{monthLabel.toUpperCase()}</div>
          <button onClick={()=>setCalMonth(new Date(today.getFullYear(),today.getMonth(),1))}
            style={{background:"none",border:`1px solid ${C.accent}`,borderRadius:8,
            color:C.accent,padding:"6px 14px",cursor:"pointer",fontSize:11,fontFamily:"inherit",fontWeight:700}}>TODAY</button>
          <button onClick={nextMonth} style={{background:"none",border:`1px solid ${C.border}`,borderRadius:8,
            color:"var(--dim)",padding:"6px 14px",cursor:"pointer",fontSize:16,fontFamily:"inherit"}}>›</button>
        </div>

        {/* Day headers */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:2,marginBottom:4}}>
          {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map(d=>(
            <div key={d} style={{textAlign:"center",fontSize:10,fontWeight:700,
              color:"var(--dim)",letterSpacing:"0.06em",padding:"4px 0"}}>{d}</div>
          ))}
        </div>

        {/* Calendar grid */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:2}}>
          {cells.map((day,i)=>{
            if(!day) return <div key={"blank"+i}/>;
            const dateStr=`${year}-${String(month+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
            const dayEvs=eventsForDate(dateStr);
            const isToday=dateStr===todayStr;
            const isWeekend=new Date(year,month,day).getDay()===0||new Date(year,month,day).getDay()===6;
            const isSelected=calDayDetail===dateStr;
            const hasOverdue=dayEvs.some(ev=>isOverdue(ev.startDate,ev.status)&&fmtYMD(parseAnyDate(ev.startDate)===dateStr||ev.startDate===dateStr));
            return (
              <div key={dateStr} onClick={()=>setCalDayDetail(isSelected?null:dateStr)}
                style={{minHeight:80,borderRadius:8,padding:"6px 6px 4px",cursor:"pointer",
                  background:isSelected?C.accent+"18":isToday?C.accent+"0A":isWeekend?"var(--surface)":"var(--card)",
                  border:`1px solid ${isSelected?C.accent+"55":isToday?C.accent+"33":C.border}`,
                  opacity:isWeekend&&dayEvs.length===0?0.5:1,
                  transition:"background 0.1s"}}
                onMouseEnter={e=>{ if(!isSelected) e.currentTarget.style.background=C.accent+"10"; }}
                onMouseLeave={e=>{ e.currentTarget.style.background=isSelected?C.accent+"18":isToday?C.accent+"0A":isWeekend?"var(--surface)":"var(--card)"; }}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:4}}>
                  <span style={{fontSize:11,fontWeight:isToday?800:600,
                    color:isToday?C.accent:isWeekend?"var(--muted)":"var(--text)"}}>{day}</span>
                  {isToday&&<span style={{fontSize:8,color:C.accent,fontWeight:800,letterSpacing:"0.08em"}}>TODAY</span>}
                  {dayEvs.length>0&&!isToday&&<span style={{fontSize:9,fontWeight:700,color:"var(--dim)"}}>{dayEvs.length}</span>}
                </div>
                {dayEvs.slice(0,3).map(ev=><EventPill key={ev.id} ev={ev} mini/>)}
                {dayEvs.length>3&&<div style={{fontSize:9,color:"var(--muted)",paddingLeft:4}}>+{dayEvs.length-3} more</div>}
              </div>
            );
          })}
        </div>

        {/* Day detail panel */}
        {calDayDetail&&(()=>{
          const dayEvs=eventsForDate(calDayDetail);
          const dt=parseAnyDate(calDayDetail);
          const label=dt?dt.toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric",year:"numeric"}):"";
          return (
            <div style={{marginTop:16,padding:"16px 18px",background:"var(--card)",
              borderRadius:14,border:`1px solid ${C.accent}33`}}>
              <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14}}>
                <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:18,
                  letterSpacing:"0.06em",color:C.accent}}>{label.toUpperCase()}</div>
                <div style={{marginLeft:"auto",fontSize:11,color:"var(--dim)"}}>{dayEvs.length} item{dayEvs.length!==1?"s":""}</div>
                <button onClick={()=>setCalDayDetail(null)}
                  style={{background:"none",border:"none",color:"var(--muted)",fontSize:16,cursor:"pointer",padding:"0 4px"}}>✕</button>
              </div>
              {dayEvs.length===0
                ?<div style={{fontSize:12,color:"var(--muted)",fontStyle:"italic"}}>Nothing scheduled this day.</div>
                :dayEvs.map(ev=><EventCard key={ev.id} ev={ev}/>)
              }
            </div>
          );
        })()}
      </div>
    );
  };

  return (
    <div>
      {/* ── Header ── */}
      <div style={{padding:"20px 26px 0",borderBottom:`1px solid ${C.border}`}}>
        <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:14,flexWrap:"wrap"}}>
          <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:28,letterSpacing:"0.06em",color:"var(--text)",lineHeight:1}}>SCHEDULING FORECAST</div>
          <div style={{fontSize:11,color:"var(--dim)"}}>{allEvents.length} item{allEvents.length!==1?"s":""}</div>
          <div style={{marginLeft:"auto",display:"flex",gap:4}}>
            {[{k:"kanban",l:"Kanban"},{k:"week",l:"📋 Week"},{k:"attention",l:"⚠️ Attention"},{k:"calendar",l:"📅 Calendar"}].map(({k,l})=>(
              <button key={k} onClick={()=>setViewMode(k)}
                style={{padding:"6px 14px",borderRadius:8,fontSize:11,fontWeight:viewMode===k?700:500,
                  cursor:"pointer",fontFamily:"inherit",border:`1px solid ${viewMode===k?C.accent:C.border}`,
                  background:viewMode===k?C.accent:"none",color:viewMode===k?"#fff":"var(--dim)",transition:"all 0.15s"}}>
                {l}
              </button>
            ))}
          </div>
        </div>
        {/* Foreman tabs */}
        <div style={{display:"flex",gap:6,overflowX:"auto",scrollbarWidth:"none",paddingBottom:1}}>
          {foremanTabs.map(f=>{
            const fc2=f==="All"?C.accent:getFC(f)||"#6b7280";
            const ct=f==="All"?allEvents.length:buildEvents(
              f==="Unassigned"?jobs.filter(j=>!j.foreman||j.foreman==="Unassigned")
              :jobs.filter(j=>matchesForemanTab(j,f))
            ).length;
            return (
              <button key={f} onClick={()=>setForemanTab(f)}
                style={{padding:"7px 16px",borderRadius:"8px 8px 0 0",fontSize:12,cursor:"pointer",
                  fontFamily:"inherit",fontWeight:foremanTab===f?700:400,whiteSpace:"nowrap",
                  background:foremanTab===f?fc2:"none",border:`1px solid ${foremanTab===f?fc2:C.border}`,
                  borderBottom:"none",color:foremanTab===f?"#fff":"var(--dim)",transition:"all 0.15s"}}>
                {f} <span style={{opacity:0.8,fontSize:10}}>({ct})</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── KANBAN ── */}
      {viewMode==="kanban"&&(
        <div style={{padding:"20px 26px",overflowX:"auto"}}>
          {allEvents.length===0
            ?<div style={{textAlign:"center",padding:"60px 0",color:"var(--muted)",fontSize:13}}>Nothing to schedule.</div>
            :<div style={{display:"grid",gridTemplateColumns:"repeat(5,minmax(230px,1fr))",gap:14,minWidth:900}}>
              {BUCKETS.map(bucket=>{
                const bEvs=allEvents.filter(ev=>getBucketForEvent(ev)===bucket.key);
                return (
                  <div key={bucket.key}>
                    <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12,
                      paddingBottom:8,borderBottom:`2px solid ${bucket.color}55`}}>
                      <div style={{width:8,height:8,borderRadius:"50%",background:bucket.color,flexShrink:0}}/>
                      <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:15,
                        letterSpacing:"0.08em",color:bucket.color}}>{bucket.label}</div>
                      <div style={{marginLeft:"auto",background:`${bucket.color}18`,border:`1px solid ${bucket.color}33`,
                        borderRadius:99,padding:"1px 8px",fontSize:11,color:bucket.color,fontWeight:700}}>
                        {bEvs.length}
                      </div>
                    </div>
                    {bEvs.length===0
                      ?<div style={{fontSize:11,color:"var(--muted)",fontStyle:"italic",padding:"16px 0",
                          textAlign:"center",border:`1px dashed ${C.border}`,borderRadius:10}}>Empty</div>
                      :bEvs.map(ev=><EventCard key={ev.id} ev={ev}/>)
                    }
                  </div>
                );
              })}
            </div>
          }
        </div>
      )}

      {/* ── WEEK AT A GLANCE ── */}
      {viewMode==="week"&&(()=>{
        // Build 7 days starting from this week's Sunday
        const weekDays=[];
        for(let i=0;i<7;i++){
          const d=new Date(thisWeekStart);
          d.setDate(thisWeekStart.getDate()+i);
          weekDays.push(d);
        }
        const dayNames=["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
        const shortDay=["SUN","MON","TUE","WED","THU","FRI","SAT"];

        return (
          <div style={{padding:"20px 26px"}}>
            {/* Week header */}
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:18}}>
              <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:20,letterSpacing:"0.06em",color:"var(--text)"}}>
                WEEK OF {thisWeekStart.toLocaleDateString("en-US",{month:"long",day:"numeric"}).toUpperCase()}
              </div>
              <div style={{fontSize:11,color:"var(--dim)"}}>{allEvents.length} total items</div>
            </div>

            {/* Day rows */}
            <div style={{display:"flex",flexDirection:"column",gap:6}}>
              {weekDays.map((dayDate,idx)=>{
                const dateStr=fmtYMD(dayDate);
                const dayEvs=allEvents.filter(ev=>eventCoversDate(ev,dateStr));
                const isToday2=dateStr===todayStr;
                const isPast=dayDate<today&&!isToday2;
                const isWeekend2=idx===0||idx===6;

                // Group by type for summary chips
                const typeCounts={};
                dayEvs.forEach(ev=>{
                  const t=ev.type==="quick"?"Quick":ev.type==="rough"?"Rough":ev.type==="finish"?"Finish":
                    ev.type==="rt"?"RT":ev.type==="co"?"CO":ev.type==="qc"?"QC":ev.type==="invoice"?"Invoice":ev.type;
                  typeCounts[t]=(typeCounts[t]||0)+1;
                });

                const overdueEvs=dayEvs.filter(ev=>isOverdue(ev.startDate,ev.status));

                return (
                  <div key={dateStr} style={{
                    background:isToday2?"var(--card)":isPast?"var(--surface)":"var(--card)",
                    borderRadius:12,padding:"14px 16px",
                    border:`1px solid ${isToday2?C.accent+"55":C.border}`,
                    opacity:isPast&&dayEvs.length===0?0.4:isPast?0.7:1,
                    borderLeft:isToday2?`3px solid ${C.accent}`:`3px solid transparent`}}>

                    {/* Day header */}
                    <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:dayEvs.length>0?10:0}}>
                      <div style={{display:"flex",alignItems:"baseline",gap:6,minWidth:140}}>
                        <span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:16,letterSpacing:"0.06em",
                          color:isToday2?C.accent:isWeekend2?"var(--muted)":"var(--text)"}}>{shortDay[idx]}</span>
                        <span style={{fontSize:12,fontWeight:600,
                          color:isToday2?C.accent:"var(--dim)"}}>
                          {dayDate.toLocaleDateString("en-US",{month:"short",day:"numeric"})}
                        </span>
                        {isToday2&&<span style={{fontSize:9,fontWeight:800,color:C.accent,
                          background:C.accent+"18",borderRadius:99,padding:"1px 8px",letterSpacing:"0.08em"}}>TODAY</span>}
                      </div>

                      {/* Type summary chips */}
                      <div style={{display:"flex",gap:4,flex:1,flexWrap:"wrap"}}>
                        {Object.entries(typeCounts).map(([type,count])=>{
                          const chipColor=type==="Rough"?C.rough||"#2563eb":type==="Finish"?C.finish||"#16a34a":
                            type==="Quick"?"#f59e0b":type==="RT"?"#8b5cf6":type==="CO"?C.accent:
                            type==="QC"?C.teal:type==="Invoice"?"#ea580c":"var(--dim)";
                          return (
                            <span key={type} style={{fontSize:10,fontWeight:700,color:chipColor,
                              background:chipColor+"15",border:`1px solid ${chipColor}28`,
                              borderRadius:99,padding:"2px 8px"}}>
                              {count} {type}
                            </span>
                          );
                        })}
                      </div>

                      {/* Overdue warning */}
                      {overdueEvs.length>0&&(
                        <span style={{fontSize:10,fontWeight:800,color:C.red,
                          background:C.red+"15",borderRadius:99,padding:"2px 10px",
                          border:`1px solid ${C.red}28`,flexShrink:0}}>
                          {overdueEvs.length} OVERDUE
                        </span>
                      )}

                      {dayEvs.length===0&&(
                        <span style={{fontSize:11,color:"var(--muted)",fontStyle:"italic"}}>
                          {isWeekend2?"Weekend — nothing scheduled":"Nothing scheduled"}
                        </span>
                      )}
                    </div>

                    {/* Event pills for the day */}
                    {dayEvs.length>0&&(
                      <div style={{display:"flex",flexDirection:"column",gap:2}}>
                        {dayEvs.map(ev=>(
                          <div key={ev.id} onClick={()=>onSelectJob(ev.job)}
                            style={{display:"flex",alignItems:"center",gap:8,padding:"5px 10px",
                              borderRadius:8,cursor:"pointer",background:"var(--surface)",
                              border:`1px solid ${C.border}`,transition:"background 0.1s"}}
                            onMouseEnter={e=>e.currentTarget.style.background=ev.color+"12"}
                            onMouseLeave={e=>e.currentTarget.style.background="var(--surface)"}>
                            <span style={{width:7,height:7,borderRadius:"50%",
                              background:isOverdue(ev.startDate,ev.status)?C.red:ev.color,flexShrink:0}}/>
                            <span style={{fontSize:10,fontWeight:800,
                              color:isOverdue(ev.startDate,ev.status)?C.red:ev.color,
                              letterSpacing:"0.05em",minWidth:48}}>{ev.label}</span>
                            <span style={{fontSize:11,fontWeight:600,color:"var(--text)",
                              overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",flex:1}}>
                              {ev.job.name||"Untitled"}
                            </span>
                            <span style={{fontSize:10,fontWeight:600,
                              color:isOverdue(ev.startDate,ev.status)?C.red:ev.color,flexShrink:0}}>
                              {ev.statusLabel}
                            </span>
                            <span style={{fontSize:9,fontWeight:700,color:ev.fc,
                              background:ev.fc+"15",borderRadius:99,padding:"1px 6px",
                              border:`1px solid ${ev.fc}20`,flexShrink:0}}>{ev.job.foreman||"Koy"}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* ── NEEDS ATTENTION ── */}
      {viewMode==="attention"&&(()=>{
        // Categorize events that need attention
        const overdueItems=allEvents.filter(ev=>isOverdue(ev.startDate,ev.status));
        const needsDateItems=allEvents.filter(ev=>!ev.startDate||ev.status==="waiting_date");
        const needsScheduling=allEvents.filter(ev=>
          (ev.status==="date_confirmed")||(ev.type==="rt"&&ev.status==="needs"));
        const invoiceItems=allEvents.filter(ev=>ev.type==="invoice"||ev.status==="invoice");
        const pendingCOs=allEvents.filter(ev=>ev.type==="co"&&(ev.status==="pending"||ev.status==="sent"));
        const thisWeekItems=allEvents.filter(ev=>{
          if(!ev.startDate) return false;
          const bucket=getBucket(ev.startDate,ev.status);
          return bucket==="thisWeek"&&ev.status!=="inprogress";
        });

        const sections=[
          {key:"overdue",label:"OVERDUE",icon:"🔴",color:C.red,
            desc:"Past the start date with no completion",items:overdueItems},
          {key:"needsDate",label:"NEEDS DATE",icon:"📅",color:"#ca8a04",
            desc:"Waiting for a start date or date confirmation",items:needsDateItems},
          {key:"needsSched",label:"READY TO SCHEDULE",icon:"📋",color:"#f97316",
            desc:"Date confirmed — needs to be put on the schedule",items:needsScheduling},
          {key:"invoices",label:"READY TO INVOICE",icon:"💰",color:"#ea580c",
            desc:"Work complete — invoice hasn't been sent",items:invoiceItems},
          {key:"cos",label:"PENDING CHANGE ORDERS",icon:"📝",color:C.accent,
            desc:"Change orders waiting to be sent or approved",items:pendingCOs},
          {key:"upcoming",label:"COMING UP THIS WEEK",icon:"⏰",color:C.green,
            desc:"Scheduled this week but not yet started",items:thisWeekItems},
        ].filter(s=>s.items.length>0);

        const totalAttention=overdueItems.length+needsDateItems.length+needsScheduling.length
          +invoiceItems.length+pendingCOs.length;

        return (
          <div style={{padding:"20px 26px"}}>
            {/* Summary bar */}
            <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:20,flexWrap:"wrap"}}>
              <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:20,letterSpacing:"0.06em",color:"var(--text)"}}>
                NEEDS ATTENTION
              </div>
              {totalAttention>0?(
                <span style={{fontSize:12,fontWeight:800,color:C.red,
                  background:C.red+"15",borderRadius:99,padding:"3px 12px",
                  border:`1px solid ${C.red}28`}}>
                  {totalAttention} item{totalAttention!==1?"s":""} need action
                </span>
              ):(
                <span style={{fontSize:12,fontWeight:600,color:C.green,
                  background:C.green+"15",borderRadius:99,padding:"3px 12px",
                  border:`1px solid ${C.green}28`}}>
                  All clear — nothing needs immediate attention
                </span>
              )}
            </div>

            {/* Quick stat boxes */}
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:8,marginBottom:20}}>
              {[
                {label:"Overdue",count:overdueItems.length,color:C.red},
                {label:"Needs Date",count:needsDateItems.length,color:"#ca8a04"},
                {label:"Ready to Schedule",count:needsScheduling.length,color:"#f97316"},
                {label:"Ready to Invoice",count:invoiceItems.length,color:"#ea580c"},
                {label:"Pending COs",count:pendingCOs.length,color:C.accent},
              ].map(stat=>(
                <div key={stat.label} style={{background:"var(--card)",borderRadius:10,padding:"12px 14px",
                  border:`1px solid ${stat.count>0?stat.color+"33":C.border}`,textAlign:"center"}}>
                  <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:28,
                    color:stat.count>0?stat.color:"var(--muted)",lineHeight:1}}>{stat.count}</div>
                  <div style={{fontSize:10,fontWeight:700,color:stat.count>0?stat.color:"var(--muted)",
                    letterSpacing:"0.06em",marginTop:4}}>{stat.label.toUpperCase()}</div>
                </div>
              ))}
            </div>

            {/* Sections */}
            {sections.length===0&&(
              <div style={{textAlign:"center",padding:"60px 0",color:"var(--muted)",fontSize:13}}>
                Nothing needs attention right now. You're all caught up!
              </div>
            )}

            {sections.map(section=>(
              <div key={section.key} style={{marginBottom:20}}>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10,
                  paddingBottom:8,borderBottom:`2px solid ${section.color}44`}}>
                  <span style={{fontSize:14}}>{section.icon}</span>
                  <span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:16,
                    letterSpacing:"0.06em",color:section.color}}>{section.label}</span>
                  <span style={{fontSize:11,fontWeight:700,color:section.color,
                    background:section.color+"15",borderRadius:99,padding:"1px 8px",
                    border:`1px solid ${section.color}28`}}>{section.items.length}</span>
                  <span style={{fontSize:11,color:"var(--dim)",marginLeft:4}}>{section.desc}</span>
                </div>
                {section.items.map(ev=><EventCard key={ev.id} ev={ev}/>)}
              </div>
            ))}
          </div>
        );
      })()}

      {/* ── CALENDAR ── */}
      {viewMode==="calendar"&&<CalendarView/>}

      {/* ── Color Key ── */}
      <div style={{padding:"16px 26px 32px",borderTop:"1px solid var(--border)",marginTop:8}}>
        <div style={{fontSize:10,fontWeight:700,color:"var(--dim)",letterSpacing:"0.1em",marginBottom:12}}>COLOR KEY</div>
        <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
          {[
            {color:"#ca8a04", label:"Waiting for Date",       desc:"Waiting for start date confirmation from GC/homeowner"},
            {color:"#f97316", label:"Date Confirmed",         desc:"Start date confirmed — needs to be scheduled"},
            {color:"#2563eb", label:"Scheduled",              desc:"Rough or finish is scheduled with a date set"},
            {color:"#7dd3fc", label:"In Progress",            desc:"Crew is actively working on rough or finish"},
            {color:"#ea580c", label:"Ready to Invoice",       desc:"Work complete — invoice has not been sent yet"},
            {color:"#dc2626", label:"Needs Scheduling (RT)",  desc:"Return trip needs to be scheduled"},
            {color:"#8b5cf6", label:"RT Scheduled",           desc:"Return trip has been scheduled"},
            {color:"#dc2626", label:"CO — Needs Sending",     desc:"Change order drafted but not sent yet"},
            {color:"#ca8a04", label:"CO — Pending Approval",  desc:"Change order sent, waiting for approval"},
            {color:"#16a34a", label:"CO — Approved",          desc:"Change order approved, awaiting completion"},
            {color:C.teal,    label:"QC Walk",                desc:"Quality control walk needs to be scheduled or is scheduled"},
            {color:C.red,     label:"Overdue",                desc:"Start date has passed with no completion"},
          ].map(({color,label,desc})=>(
            <div key={label} style={{display:"flex",alignItems:"flex-start",gap:8,
              padding:"8px 12px",borderRadius:9,background:"var(--surface)",
              border:"1px solid var(--border)",flex:"1 1 200px",minWidth:180}}>
              <div style={{width:10,height:10,borderRadius:"50%",background:color,flexShrink:0,marginTop:3}}/>
              <div>
                <div style={{fontSize:12,fontWeight:700,color:"var(--text)",marginBottom:2}}>{label}</div>
                <div style={{fontSize:11,color:"var(--dim)",lineHeight:1.4}}>{desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Settings ─────────────────────────────────────────────────
// Three module-level components so React never sees new types mid-render
function SettingsGroupHead({label}) {
  return (
    <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:20,letterSpacing:"0.08em",
      color:"#0f172a",marginBottom:14,paddingBottom:8,borderBottom:"2px solid #e2e8f0"}}>
      {label}
    </div>
  );
}

function SettingsRoleBadge({label, color}) {
  return (
    <span style={{fontSize:9,fontWeight:700,color:"#fff",background:color||"#64748b",
      borderRadius:99,padding:"2px 8px",letterSpacing:"0.06em",flexShrink:0}}>
      {label}
    </span>
  );
}

function SettingsPersonRow({user, color, colorOptions, onColorChange}) {
  const accessColors = { admin:"#ef4444", manager:"#8b5cf6", standard:"#2563eb", limited:"#64748b" };
  const titleLabels  = { foreman:"Foreman", lead:"Lead", crew:"Crew" };
  const title  = user.title || (["admin","justin","jeromy"].includes(user.role) ? "admin" : ["foreman","lead","crew"].includes(user.role) ? user.role : "crew");
  const access = getAccess(user);
  return (
    <div style={{display:"flex",alignItems:"center",gap:10,padding:"11px 14px",
      background:"#ffffff",borderRadius:10,marginBottom:8,
      border:"1px solid #e2e8f0",borderLeft:`3px solid ${color}`}}>
      <div style={{flex:1,display:"flex",alignItems:"center",gap:6,minWidth:0,flexWrap:"wrap"}}>
        <span style={{fontSize:14,fontWeight:600,color:"#0f172a",
          overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
          {user.name}
        </span>
        <SettingsRoleBadge label={titleLabels[title]||title} color={color}/>
        <SettingsRoleBadge label={ACCESS_LABELS[access]||access} color={accessColors[access]||"#64748b"}/>
      </div>
      <div style={{display:"flex",gap:5,flexWrap:"wrap",maxWidth:200,flexShrink:0}}>
        {colorOptions.map(col=>(
          <div key={col} onClick={()=>onColorChange(col)}
            style={{width:20,height:20,borderRadius:"50%",background:col,cursor:"pointer",
              border:color===col?"3px solid white":"2px solid transparent",
              boxShadow:color===col?`0 0 0 2px ${col}`:"none",flexShrink:0}}/>
        ))}
      </div>
    </div>
  );
}

function ActivityLog({ jobs }) {
  const [filter, setFilter] = useState("");
  // Sort by most recently updated
  const sorted = [...jobs]
    .filter(j => j.updated_at)
    .sort((a,b) => (b.updated_at||"").localeCompare(a.updated_at||""));
  const filtered = filter
    ? sorted.filter(j => (j.name||"").toLowerCase().includes(filter.toLowerCase()) || (j._saved_by||"").toLowerCase().includes(filter.toLowerCase()))
    : sorted;

  const timeAgo = (iso) => {
    if(!iso) return "—";
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff/60000);
    if(mins < 1) return "just now";
    if(mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins/60);
    if(hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs/24);
    return `${days}d ago`;
  };

  const fmtDate = (iso) => {
    if(!iso) return "—";
    try {
      const d = new Date(iso);
      return d.toLocaleDateString("en-US",{month:"short",day:"numeric"}) + " " + d.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"});
    } catch(e) { return iso; }
  };

  return (
    <div style={{padding:"20px 26px"}}>
      <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:26,letterSpacing:"0.06em",color:C.text,marginBottom:4}}>Activity Log</div>
      <div style={{fontSize:12,color:C.muted,marginBottom:12}}>Shows who last edited each job and when. Updated in real time.</div>
      <input placeholder="Filter by job name or person..." value={filter} onChange={e=>setFilter(e.target.value)}
        style={{width:"100%",maxWidth:400,padding:"8px 12px",borderRadius:8,border:`1px solid ${C.border}`,background:C.surface,color:C.text,fontSize:13,fontFamily:"inherit",marginBottom:16,outline:"none"}}/>
      <div style={{overflowX:"auto",borderRadius:10,border:`1px solid ${C.border}`}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:13,fontFamily:"inherit"}}>
          <thead>
            <tr style={{background:C.surface,borderBottom:`2px solid ${C.border}`}}>
              <th style={{textAlign:"left",padding:"10px 12px",fontWeight:700,color:C.muted,fontSize:11,textTransform:"uppercase",letterSpacing:"0.05em"}}>Job</th>
              <th style={{textAlign:"left",padding:"10px 12px",fontWeight:700,color:C.muted,fontSize:11,textTransform:"uppercase",letterSpacing:"0.05em",width:130}}>Last Edited By</th>
              <th style={{textAlign:"left",padding:"10px 12px",fontWeight:700,color:C.muted,fontSize:11,textTransform:"uppercase",letterSpacing:"0.05em",width:100}}>When</th>
              <th style={{textAlign:"left",padding:"10px 12px",fontWeight:700,color:C.muted,fontSize:11,textTransform:"uppercase",letterSpacing:"0.05em",width:150}}>Date</th>
              <th style={{textAlign:"left",padding:"10px 12px",fontWeight:700,color:C.muted,fontSize:11,textTransform:"uppercase",letterSpacing:"0.05em",width:90}}>Foreman</th>
              <th style={{textAlign:"left",padding:"10px 12px",fontWeight:700,color:C.muted,fontSize:11,textTransform:"uppercase",letterSpacing:"0.05em",width:90}}>Lead</th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0,100).map(job => (
              <tr key={job.id} style={{borderBottom:`1px solid ${C.border}22`}}>
                <td style={{padding:"8px 12px",color:C.text,fontWeight:600}}>{job.name||"(untitled)"}</td>
                <td style={{padding:"8px 12px",color:job._saved_by?C.text:C.muted}}>{job._saved_by||"—"}</td>
                <td style={{padding:"8px 12px",color:C.muted,fontSize:12}}>{timeAgo(job.updated_at)}</td>
                <td style={{padding:"8px 12px",color:C.muted,fontSize:11}}>{fmtDate(job.updated_at)}</td>
                <td style={{padding:"8px 12px",color:C.text,fontSize:12}}>{job.foreman||"—"}</td>
                <td style={{padding:"8px 12px",color:C.text,fontSize:12}}>{job.lead||"—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{marginTop:10,fontSize:11,color:C.muted}}>{filtered.length} entries — most recent first</div>
    </div>
  );
}

function BulkEditTable({ jobs, foremenList, leadsList, onUpdateJob }) {
  const [filter, setFilter] = useState("");
  const filtered = filter
    ? jobs.filter(j => (j.name||"").toLowerCase().includes(filter.toLowerCase()) || (j.foreman||"").toLowerCase().includes(filter.toLowerCase()))
    : jobs;
  const sorted = [...filtered].sort((a,b) => (a.foreman||"").localeCompare(b.foreman||"") || (a.name||"").localeCompare(b.name||""));
  return (
    <div style={{padding:"20px 26px"}}>
      <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:26,letterSpacing:"0.06em",color:C.text,marginBottom:12}}>Bulk Edit — Foreman & Lead</div>
      <input placeholder="Filter by job name or foreman..." value={filter} onChange={e=>setFilter(e.target.value)}
        style={{width:"100%",maxWidth:400,padding:"8px 12px",borderRadius:8,border:`1px solid ${C.border}`,background:C.surface,color:C.text,fontSize:13,fontFamily:"inherit",marginBottom:16,outline:"none"}}/>
      <div style={{overflowX:"auto",borderRadius:10,border:`1px solid ${C.border}`}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:13,fontFamily:"inherit"}}>
          <thead>
            <tr style={{background:C.surface,borderBottom:`2px solid ${C.border}`}}>
              <th style={{textAlign:"left",padding:"10px 12px",fontWeight:700,color:C.muted,fontSize:11,textTransform:"uppercase",letterSpacing:"0.05em"}}>Job Name</th>
              <th style={{textAlign:"left",padding:"10px 12px",fontWeight:700,color:C.muted,fontSize:11,textTransform:"uppercase",letterSpacing:"0.05em",width:180}}>Foreman</th>
              <th style={{textAlign:"left",padding:"10px 12px",fontWeight:700,color:C.muted,fontSize:11,textTransform:"uppercase",letterSpacing:"0.05em",width:180}}>Lead</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(job => (
              <tr key={job.id} style={{borderBottom:`1px solid ${C.border}22`}}>
                <td style={{padding:"8px 12px",color:C.text,fontWeight:600}}>{job.name||"(untitled)"}</td>
                <td style={{padding:"6px 8px"}}>
                  <Sel value={job.foreman||""} onChange={e=>{const patch={foreman:e.target.value}; onUpdateJob({...job,...patch},patch);}} options={[...(foremenList||[]),"Unassigned"]}/>
                </td>
                <td style={{padding:"6px 8px"}}>
                  <Sel value={job.lead||""} onChange={e=>{const patch={lead:e.target.value}; onUpdateJob({...job,...patch},patch);}} options={["Lead TBD",...(leadsList||[])]}/>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{marginTop:10,fontSize:11,color:C.muted}}>{sorted.length} jobs shown — changes save automatically</div>
    </div>
  );
}

function SettingsPage({ COLOR_OPTIONS, onSave, users, colorOverrides, jobs, upcoming, manualTasks, onRestoreFromBackup, onRestoreFromFile }) {
  const [colors, setColors] = useState({...colorOverrides});
  const [saved,  setSaved]  = useState(false);
  const [restoring, setRestoring] = useState(false);
  const fileInputRef = useRef(null);

  // ── Data Backup Export ──
  const exportBackup = () => {
    const backup = {
      exportedAt: new Date().toISOString(),
      version: "v1",
      jobs: jobs || [],
      upcoming: upcoming || [],
      manualTasks: manualTasks || [],
      users: users || [],
      colorOverrides: colors,
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const date = new Date().toISOString().split("T")[0];
    a.href = url;
    a.download = `homestead-backup-${date}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Sync if parent colorOverrides changes (e.g. on load)
  useEffect(()=>{ setColors({...colorOverrides}); }, [JSON.stringify(colorOverrides)]);

  const getT = (u) => {
    if(u.title) return u.title;
    if(["admin","justin","jeromy"].includes(u.role)) return "admin";
    if(["foreman","lead","crew"].includes(u.role)) return u.role;
    return "crew";
  };
  const foremanUsers = (users||[]).filter(u=>getT(u)==="foreman");
  const leadUsers    = (users||[]).filter(u=>getT(u)==="lead");
  const crewUsers    = (users||[]).filter(u=>getT(u)==="crew");

  const getColor = (name) => {
    if(colors[name]) return colors[name];
    const first = name.split(" ")[0];
    return colors[first]||"#6b7280";
  };

  const setColor = (name, col) => setColors(prev=>({...prev,[name]:col}));

  const save = async () => {
    await onSave(colors);
    setSaved(true); setTimeout(()=>setSaved(false),2000);
  };

  const adminUsers  = (users||[]).filter(u=>getT(u)==="admin");
  const noUsers = adminUsers.length===0 && foremanUsers.length===0 && leadUsers.length===0 && crewUsers.length===0;

  return (
    <div style={{padding:"24px 20px 60px",maxWidth:600,margin:"0 auto"}}>
      <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:28,letterSpacing:"0.08em",
        color:"#0f172a",marginBottom:6}}>SETTINGS</div>
      <div style={{fontSize:12,color:"#64748b",marginBottom:24,lineHeight:1.5}}>
        Team members are grouped by role. Assign a color to each person — it appears on their card and throughout the app.
        To add or remove people, use the <strong>Team Members</strong> section below.
      </div>

      {/* Data Backup */}
      <div style={{marginBottom:32,padding:"16px 18px",background:"#f0fdf4",borderRadius:12,
        border:"1px solid #bbf7d0"}}>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
          <span style={{fontSize:16}}>💾</span>
          <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:16,letterSpacing:"0.06em",color:"#166534"}}>DATA BACKUP</div>
        </div>
        <div style={{fontSize:11,color:"#15803d",marginBottom:12,lineHeight:1.5}}>
          Download a full backup of all jobs, tasks, and settings. Do this regularly to protect your data.
        </div>
        <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
          <button onClick={exportBackup}
            style={{padding:"10px 20px",borderRadius:8,fontSize:13,fontWeight:700,cursor:"pointer",
              fontFamily:"inherit",background:"#16a34a",color:"#fff",border:"none",
              display:"flex",alignItems:"center",gap:8}}>
            📥 Download Backup ({(jobs||[]).length} jobs)
          </button>
          {onRestoreFromBackup&&(
            <button disabled={restoring} onClick={async()=>{
              const backupRaw=localStorage.getItem('hejobs_backup');
              if(!backupRaw){alert('No backup found');return;}
              const backupJobs=JSON.parse(backupRaw);
              if(!confirm(`Restore ${backupJobs.length} jobs from local backup? This will overwrite current Firestore data with your cached version.`)) return;
              setRestoring(true);
              const count=await onRestoreFromBackup();
              setRestoring(false);
              if(count>0){alert(`Restored ${count} jobs! Refreshing...`);window.location.reload();}
            }}
              style={{padding:"10px 20px",borderRadius:8,fontSize:13,fontWeight:700,cursor:"pointer",
                fontFamily:"inherit",background:restoring?"#9ca3af":"#dc2626",color:"#fff",border:"none",
                display:"flex",alignItems:"center",gap:8}}>
              {restoring?"⏳ Restoring...":"🔄 Restore from Local Backup"}
            </button>
          )}
          {onRestoreFromFile&&(
            <>
              <input type="file" accept=".json" ref={fileInputRef} style={{display:"none"}} onChange={async(e)=>{
                const file=e.target.files[0];
                if(!file) return;
                try {
                  const text=await file.text();
                  const parsed=JSON.parse(text);
                  // Support both formats: {jobs:[...]} or raw array [...]
                  const jobsArr=Array.isArray(parsed)?parsed:(parsed.jobs||[]);
                  if(!jobsArr.length){alert('No jobs found in file');return;}
                  if(!confirm(`Restore ${jobsArr.length} jobs from "${file.name}"? This will overwrite current Firestore data.`)) return;
                  setRestoring(true);
                  const count=await onRestoreFromFile(jobsArr);
                  setRestoring(false);
                  if(count>0){alert(`Restored ${count} jobs from file! Refreshing...`);window.location.reload();}
                }catch(err){setRestoring(false);alert('Failed to read file: '+err.message);}
                e.target.value='';
              }}/>
              <button disabled={restoring} onClick={()=>fileInputRef.current?.click()}
                style={{padding:"10px 20px",borderRadius:8,fontSize:13,fontWeight:700,cursor:"pointer",
                  fontFamily:"inherit",background:restoring?"#9ca3af":"#7c3aed",color:"#fff",border:"none",
                  display:"flex",alignItems:"center",gap:8}}>
                {restoring?"⏳ Restoring...":"📂 Restore from File"}
              </button>
              <button onClick={async()=>{
                if(!window.confirm("This will force every device using the app to reload and get the latest version. Continue?")) return;
                try {
                  await setDoc(doc(db,"config","app"),{version:"force-update-"+Date.now()});
                  alert("Done! All devices will reload in a few seconds.");
                } catch(e) { alert("Failed: "+e.message); }
              }} style={{padding:"10px 20px",borderRadius:8,fontSize:13,fontWeight:700,cursor:"pointer",
                fontFamily:"inherit",background:"#dc2626",color:"#fff",border:"none",
                display:"flex",alignItems:"center",gap:8}}>
                🔄 Force Update All Devices
              </button>
            </>
          )}
        </div>
      </div>

      {noUsers && (
        <div style={{fontSize:13,color:"#94a3b8",fontStyle:"italic",marginBottom:24,
          padding:"16px",background:"#f8fafc",borderRadius:10,border:"1px dashed #e2e8f0"}}>
          No team members yet. Add people in the Team Members section below, then assign them roles.
        </div>
      )}

      {adminUsers.length>0 && (
        <div style={{marginBottom:32}}>
          <SettingsGroupHead label="Admin"/>
          {adminUsers.map(u=>(
            <SettingsPersonRow key={u.id} user={u}
              color={getColor(u.name)}
              colorOptions={COLOR_OPTIONS}
              onColorChange={col=>setColor(u.name,col)}/>
          ))}
        </div>
      )}

      {foremanUsers.length>0 && (
        <div style={{marginBottom:32}}>
          <SettingsGroupHead label="Foremen"/>
          {foremanUsers.map(u=>(
            <SettingsPersonRow key={u.id} user={u}
              color={getColor(u.name)}
              colorOptions={COLOR_OPTIONS}
              onColorChange={col=>setColor(u.name,col)}/>
          ))}
        </div>
      )}

      {leadUsers.length>0 && (
        <div style={{marginBottom:32}}>
          <SettingsGroupHead label="Leads"/>
          {leadUsers.map(u=>(
            <SettingsPersonRow key={u.id} user={u}
              color={getColor(u.name)}
              colorOptions={COLOR_OPTIONS}
              onColorChange={col=>setColor(u.name,col)}/>
          ))}
        </div>
      )}

      {crewUsers.length>0 && (
        <div style={{marginBottom:32}}>
          <SettingsGroupHead label="Crew"/>
          {crewUsers.map(u=>(
            <SettingsPersonRow key={u.id} user={u}
              color={getColor(u.name)}
              colorOptions={COLOR_OPTIONS}
              onColorChange={col=>setColor(u.name,col)}/>
          ))}
        </div>
      )}

      <button onClick={save}
        style={{width:"100%",background:saved?"#16a34a":"#d97706",border:"none",borderRadius:10,
          color:saved?"#fff":"#000",fontSize:15,fontWeight:700,padding:"14px",
          cursor:"pointer",fontFamily:"inherit",transition:"background 0.3s"}}>
        {saved?"✓ Saved!":"Save Changes"}
      </button>
    </div>
  );
}

// ── Homeowner Generator Load Selection Page ──────────────────
function HomeownerPage({ jobId }) {
  const [job,        setJob]        = useState(null);
  const [genLoads,   setGenLoads]   = useState([]);
  const [items,      setItems]      = useState([]); // homeowner's working list
  const [submitted,  setSubmitted]  = useState(false);
  const [loading,    setLoading]    = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error,      setError]      = useState(null);
  const [sigName,    setSigName]    = useState('');
  const [sigDate,    setSigDate]    = useState('');
  const [sigErr,     setSigErr]     = useState(false);
  const dragIdx = useRef(null);

  useEffect(()=>{
    (async()=>{
      try {
        const jsnap = await getDoc(doc(db,'jobs',jobId));
        if(!jsnap.exists()){ setError('Job not found.'); setLoading(false); return; }
        setJob(jsnap.data().data);
        const rsnap = await getDoc(doc(db,'homeowner_requests',jobId));
        if(rsnap.exists()&&rsnap.data().submitted){
          setSubmitted(true);
          setItems(rsnap.data().items||[]);
          setGenLoads(rsnap.data().genLoads||[]);
        } else {
          const gl = rsnap.exists()?(rsnap.data().genLoads||[]):[];
          setGenLoads(gl);
          setItems(gl.map((l,i)=>({...l,priority:i+1,included:true,notes:''})));
        }
      } catch(e){ setError('Failed to load. Please try again.'); }
      setLoading(false);
    })();
  },[jobId]);

  const glById = {};
  genLoads.forEach(g=>{ glById[g.id]=g; });

  // KEY FIX: all interactions use local state → instant UI, no round-trip wait
  const toggle  = (id) => setItems(its=>its.map(it=>it.id===id?{...it,included:!it.included}:it));
  const setNote = (id,v) => setItems(its=>its.map(it=>it.id===id?{...it,notes:v}:it));

  const onDragStart = (i) => { dragIdx.current=i; };
  const onDragOver  = (e,i) => {
    e.preventDefault();
    if(dragIdx.current===null||dragIdx.current===i) return;
    setItems(its=>{
      const a=[...its]; const [m]=a.splice(dragIdx.current,1); a.splice(i,0,m);
      dragIdx.current=i;
      return a.map((x,idx)=>({...x,priority:idx+1}));
    });
  };
  const onDragEnd = ()=>{ dragIdx.current=null; };

  const included = items.filter(it=>it.included);
  const excluded = items.filter(it=>!it.included);

  const submit = async () => {
    if(!sigName.trim()||!sigDate){ setSigErr(true); return; }
    setSigErr(false); setSubmitting(true);
    try {
      await setDoc(doc(db,'homeowner_requests',jobId),{
        jobId, jobName:job?.name||'', submitted:true,
        submittedAt:new Date().toISOString(),
        signature:sigName.trim(), signedDate:sigDate,
        items:items.map((it,i)=>({...it,priority:i+1})),
        genLoads,
      });
      setSubmitted(true);
    } catch(e){ alert('Failed to submit. Please try again.'); }
    setSubmitting(false);
  };

  const A='#b45309', AB='#fef3c7';
  const base={fontFamily:'system-ui,-apple-system,sans-serif',minHeight:'100vh',background:'#f8fafc',color:'#1e293b'};
  const card={background:'#fff',border:'0.5px solid #e2e8f0',borderRadius:10,marginBottom:6,padding:'12px 14px'};

  if(loading) return <div style={{...base,display:'flex',alignItems:'center',justifyContent:'center'}}><div style={{fontSize:14,color:'#94a3b8'}}>Loading…</div></div>;
  if(error)   return <div style={{...base,display:'flex',alignItems:'center',justifyContent:'center',padding:32,textAlign:'center'}}><div style={{fontSize:14,color:'#dc2626'}}>{error}</div></div>;
  if(submitted) return (
    <div style={{...base,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',padding:40,textAlign:'center'}}>
      <div style={{width:56,height:56,borderRadius:'50%',background:'#f0fdf4',border:'0.5px solid #bbf7d0',display:'flex',alignItems:'center',justifyContent:'center',fontSize:24,marginBottom:20}}>✓</div>
      <div style={{fontSize:20,fontWeight:500,marginBottom:8}}>Selections received</div>
      <div style={{fontSize:14,color:'#64748b',maxWidth:320,lineHeight:1.6}}>
        Thank you. Homestead Electric has your generator load selections.
      </div>
      <div style={{marginTop:40,fontSize:11,color:'#cbd5e1',letterSpacing:'0.06em'}}>HOMESTEAD ELECTRIC</div>
    </div>
  );

  return (
    <div style={{...base,maxWidth:500,margin:'0 auto',padding:'0 0 80px'}}>
      {/* Header */}
      <div style={{padding:'24px 20px 20px',borderBottom:'0.5px solid #e2e8f0'}}>
        <div style={{fontSize:10,fontWeight:500,color:'#94a3b8',letterSpacing:'0.1em',marginBottom:6}}>HOMESTEAD ELECTRIC</div>
        <div style={{fontSize:20,fontWeight:500,marginBottom:4}}>{job?.name||'Generator Load Selection'}</div>
        <div style={{fontSize:13,color:'#64748b',lineHeight:1.55}}>
          Review the circuits below — check the ones you want on your generator, drag to reorder by priority (most important first), and submit when done.
        </div>
      </div>

      {/* Instructions */}
      <div style={{margin:'16px 16px 0',padding:'12px 14px',background:AB,border:'0.5px solid #fde68a',borderRadius:10}}>
        <div style={{fontSize:12,fontWeight:500,color:A,marginBottom:4}}>How to complete</div>
        <div style={{fontSize:12,color:'#92400e',lineHeight:1.6}}>
          ★ = Recommended by Homestead Electric<br/>
          Check/uncheck circuits · Drag ⠿ to reorder · Sign &amp; submit
        </div>
      </div>

      <div style={{padding:'20px 16px 0'}}>

        {/* ON GENERATOR */}
        <div style={{fontSize:10,fontWeight:500,color:'#94a3b8',letterSpacing:'0.08em',marginBottom:10}}>
          ON GENERATOR · {included.length}
        </div>
        {included.length===0&&(
          <div style={{textAlign:'center',padding:'20px',fontSize:13,color:'#94a3b8',
            border:'0.5px dashed #e2e8f0',borderRadius:10,marginBottom:12}}>
            No circuits selected
          </div>
        )}
        {items.map((it,i)=>!it.included?null:(
          <div key={it.id} draggable
            onDragStart={()=>onDragStart(i)}
            onDragOver={e=>onDragOver(e,i)}
            onDragEnd={onDragEnd}
            style={{...card,cursor:'grab',userSelect:'none',
              borderLeft:`3px solid ${it.recommended?A:'#e2e8f0'}`}}>
            <div style={{display:'flex',alignItems:'center',gap:10}}>
              <div style={{color:'#cbd5e1',fontSize:15,flexShrink:0}}>⠿</div>
              <div style={{width:22,height:22,borderRadius:'50%',background:AB,border:'0.5px solid #fde68a',
                display:'flex',alignItems:'center',justifyContent:'center',
                fontSize:10,fontWeight:500,color:A,flexShrink:0}}>
                {included.indexOf(it)+1}
              </div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:13,fontWeight:500,display:'flex',alignItems:'center',gap:6,flexWrap:'wrap',marginBottom:2}}>
                  {it.name||'Unnamed'}
                  {it.recommended&&<span style={{fontSize:9,fontWeight:700,color:A,background:AB,
                    borderRadius:99,padding:'1px 7px',border:'0.5px solid #fde68a',flexShrink:0}}>★ Recommended</span>}
                </div>
                <div style={{fontSize:11,color:'#94a3b8',display:'flex',gap:8}}>
                  {it.wire&&<span>{it.wire}</span>}
                  {it.watts>0&&<span style={{color:A,fontWeight:500}}>{it.watts}W</span>}
                </div>
              </div>
              <button onClick={()=>toggle(it.id)}
                style={{background:'none',border:'0.5px solid #e2e8f0',borderRadius:7,
                  padding:'4px 10px',fontSize:11,cursor:'pointer',color:'#94a3b8',
                  flexShrink:0,fontFamily:'inherit'}}>
                Remove
              </button>
            </div>
            <div style={{marginTop:8,paddingLeft:32}}>
              <input value={it.notes||''} onChange={e=>setNote(it.id,e.target.value)}
                placeholder="Add a note (optional)…"
                style={{width:'100%',boxSizing:'border-box',border:'0.5px solid #e2e8f0',
                  borderRadius:7,padding:'6px 10px',fontSize:12,fontFamily:'inherit',
                  color:'#1e293b',background:'#f8fafc',outline:'none'}}/>
            </div>
          </div>
        ))}

        {/* NOT ON GENERATOR */}
        {excluded.length>0&&(
          <>
            <div style={{fontSize:10,fontWeight:500,color:'#cbd5e1',letterSpacing:'0.08em',margin:'20px 0 10px'}}>
              NOT ON GENERATOR · {excluded.length}
            </div>
            {items.map(it=>it.included?null:(
              <div key={it.id} style={{...card,opacity:0.6}}>
                <div style={{display:'flex',alignItems:'center',gap:10}}>
                  <div style={{flex:1,fontSize:13,color:'#94a3b8'}}>{it.name||'Unnamed'}</div>
                  <button onClick={()=>toggle(it.id)}
                    style={{background:'none',border:'0.5px solid #e2e8f0',borderRadius:7,
                      padding:'4px 10px',fontSize:11,cursor:'pointer',color:A,
                      flexShrink:0,fontFamily:'inherit'}}>
                    Add back
                  </button>
                </div>
              </div>
            ))}
          </>
        )}

        {/* Sign off */}
        <div style={{marginTop:28,paddingTop:20,borderTop:'0.5px solid #e2e8f0'}}>
          <div style={{fontSize:13,fontWeight:500,marginBottom:4}}>Sign &amp; Submit</div>
          <div style={{fontSize:12,color:'#64748b',marginBottom:14,lineHeight:1.5}}>
            By submitting you confirm these circuits represent your generator load selection.
          </div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:14}}>
            <div>
              <div style={{fontSize:10,color:'#64748b',marginBottom:4}}>Full Name</div>
              <input value={sigName} onChange={e=>{setSigName(e.target.value);setSigErr(false);}}
                placeholder="Your name…"
                style={{width:'100%',boxSizing:'border-box',
                  border:`0.5px solid ${sigErr&&!sigName.trim()?'#dc2626':'#e2e8f0'}`,
                  borderRadius:9,padding:'10px 12px',fontSize:13,fontFamily:'inherit',
                  color:'#1e293b',background:'#fff',outline:'none'}}/>
            </div>
            <div>
              <div style={{fontSize:10,color:'#64748b',marginBottom:4}}>Date</div>
              <input type="date" value={sigDate} onChange={e=>setSigDate(e.target.value)}
                style={{width:'100%',boxSizing:'border-box',
                  border:`0.5px solid ${sigErr&&!sigDate?'#dc2626':'#e2e8f0'}`,
                  borderRadius:9,padding:'10px 12px',fontSize:13,fontFamily:'inherit',
                  color:'#1e293b',background:'#fff',outline:'none',colorScheme:'light'}}/>
            </div>
          </div>
          {sigErr&&<div style={{fontSize:11,color:'#dc2626',marginBottom:10}}>Please enter your name and date.</div>}
          <button onClick={submit} disabled={submitting}
            style={{width:'100%',padding:'15px',borderRadius:10,
              background:submitting?'#e2e8f0':'#1e293b',border:'none',
              color:submitting?'#94a3b8':'#fff',fontSize:14,fontWeight:500,
              cursor:submitting?'not-allowed':'pointer',fontFamily:'inherit'}}>
            {submitting?'Submitting…':'Submit my selections'}
          </button>
          <div style={{textAlign:'center',marginTop:14,fontSize:10,color:'#cbd5e1',letterSpacing:'0.06em'}}>
            HOMESTEAD ELECTRIC
          </div>
        </div>
      </div>
    </div>
  );
}


// ── Questions Share Page (public) ─────────────────────────────
// ── Home Runs Share Page (view-only) ──────────────────────────
function HomeRunsSharePage({ jobId }) {
  const [job, setJob] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const unsub = onSnapshot(doc(db,'jobs',jobId), snap => {
      if(!snap.exists()){ setError('Not found.'); setLoading(false); return; }
      setJob(snap.data().data);
      setLoading(false);
    }, () => { setError('Failed to load.'); setLoading(false); });
    return () => unsub();
  }, [jobId]);

  if(loading) return <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100vh',color:'#6b7280',fontSize:14}}>Loading…</div>;
  if(error)   return <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100vh',color:'#dc2626',fontSize:14}}>{error}</div>;

  const hr = job?.homeRuns || {};
  const floors = [
    {key:'main', label:'Main Level'},
    {key:'basement', label:'Basement'},
    {key:'upper', label:'Upper Level'},
    ...((hr.extraFloors||[]).map(ef=>({key:ef.key, label:ef.label}))),
  ];
  const allRows = floors.flatMap(f => hr[f.key]||[]);
  const pulled = allRows.filter(r=>r.status==='Pulled').length;
  const pct = allRows.length>0 ? Math.round((pulled/allRows.length)*100) : 0;

  const wireChip = (wire) => {
    const bg = WIRE_COLORS[wire]||'#f1f5f9';
    const col = WIRE_TEXT[wire]||'#0f172a';
    return wire ? <span style={{background:bg,color:col,borderRadius:5,padding:'1px 7px',fontSize:11,fontWeight:700}}>{wire}</span> : null;
  };

  return (
    <div style={{maxWidth:700,margin:'0 auto',padding:'28px 16px',fontFamily:'system-ui,sans-serif',background:'#f3f4f6',minHeight:'100vh'}}>
      <div style={{background:'#1e3a5f',borderRadius:14,padding:'20px 22px',marginBottom:22}}>
        <div style={{fontSize:10,color:'rgba(255,255,255,0.55)',fontWeight:700,letterSpacing:'0.12em',marginBottom:4}}>HOMESTEAD ELECTRIC — HOME RUNS</div>
        <div style={{fontSize:19,fontWeight:700,color:'#fff',marginBottom:2}}>{job?.name||'Job'}</div>
        {job?.address&&<div style={{fontSize:12,color:'rgba(255,255,255,0.65)'}}>{job.address}</div>}
      </div>

      {allRows.length>0&&(
        <div style={{background:'#fff',border:'1px solid #e5e7eb',borderRadius:10,padding:'14px 16px',marginBottom:16}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
            <span style={{fontSize:12,fontWeight:700,color:'#111'}}>Pull Progress</span>
            <span style={{fontSize:13,fontWeight:700,color:pct===100?'#16a34a':'#2563eb'}}>{pulled} / {allRows.length} — {pct}%</span>
          </div>
          <div style={{height:8,background:'#e5e7eb',borderRadius:99,overflow:'hidden'}}>
            <div style={{height:'100%',width:`${pct}%`,background:pct===100?'#16a34a':'#2563eb',borderRadius:99,transition:'width 0.4s'}}/>
          </div>
        </div>
      )}

      {floors.map(f => {
        const rows = (hr[f.key]||[]).filter(r=>r.name||r.panel||r.wire);
        if(!rows.length) return null;
        return (
          <div key={f.key} style={{background:'#fff',border:'1px solid #e5e7eb',borderRadius:10,marginBottom:12,overflow:'hidden'}}>
            <div style={{background:'#2563eb',padding:'8px 16px'}}>
              <span style={{fontSize:11,fontWeight:700,color:'#fff',letterSpacing:'0.08em'}}>{f.label.toUpperCase()}</span>
            </div>
            <div style={{padding:'0 4px'}}>
              {rows.map((r,i) => (
                <div key={r.id} style={{display:'flex',alignItems:'center',gap:8,padding:'9px 12px',borderBottom:i<rows.length-1?'1px solid #f3f4f6':'none',background:r.status==='Pulled'?'#f0fdf4':'#fff'}}>
                  <span style={{fontSize:11,color:'#9ca3af',width:22,flexShrink:0,textAlign:'right'}}>{r.num}.</span>
                  <span style={{flex:1,fontSize:13,fontWeight:600,color:'#111'}}>{r.name||<span style={{color:'#9ca3af',fontStyle:'italic'}}>Unnamed</span>}</span>
                  {r.panel&&<span style={{fontSize:11,color:'#6b7280',background:'#f3f4f6',borderRadius:5,padding:'2px 7px'}}>{r.panel}</span>}
                  {wireChip(r.wire)}
                  {r.status==='Pulled'&&<span style={{fontSize:11,fontWeight:700,color:'#16a34a'}}>✓</span>}
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {allRows.length===0&&<div style={{textAlign:'center',padding:'48px 20px',color:'#9ca3af',background:'#fff',borderRadius:12}}>No home runs have been added yet.</div>}
    </div>
  );
}

// ── Lighting Collab Share Page ─────────────────────────────────
function LightingSharePage({ jobId }) {
  const [job,        setJob]       = useState(null);
  const [loading,    setLoading]   = useState(true);
  const [error,      setError]     = useState(null);
  const [collab,     setCollab]    = useState({sections:{},notes:'',submittedBy:''});
  const [saving,     setSaving]    = useState(false);
  const [savedAt,    setSavedAt]   = useState(null);
  const saveTimer = useRef(null);

  useEffect(() => {
    const unsub = onSnapshot(doc(db,'jobs',jobId), snap => {
      if(!snap.exists()){ setError('Not found.'); setLoading(false); return; }
      setJob(snap.data().data);
      setLoading(false);
    }, () => { setError('Failed to load.'); setLoading(false); });
    return () => unsub();
  }, [jobId]);

  useEffect(() => {
    getDoc(doc(db,'homeowner_requests',jobId)).then(snap => {
      if(snap.exists()&&snap.data().lightingCollab) setCollab(snap.data().lightingCollab);
    }).catch(()=>{});
  }, [jobId]);

  const saveCollab = (next) => {
    setCollab(next);
    clearTimeout(saveTimer.current);
    setSaving(true);
    saveTimer.current = setTimeout(async()=>{
      try {
        const ex = await getDoc(doc(db,'homeowner_requests',jobId));
        await setDoc(doc(db,'homeowner_requests',jobId),{
          ...(ex.exists()?ex.data():{}),
          jobId, jobName:job?.name||'',
          lightingCollab:{...next, savedAt:new Date().toISOString()},
        });
        setSavedAt(new Date());
      } catch(e){}
      setSaving(false);
    },800);
  };

  const getSection = (key) => collab.sections?.[key] || [];
  const setSection = (key, rows) => saveCollab({...collab, sections:{...collab.sections,[key]:rows}});
  const addRow = (key) => setSection(key,[...getSection(key),{id:uid(),name:'',module:'',notes:'',addedByLV:true}]);
  const updRow = (key,id,patch) => setSection(key,getSection(key).map(r=>r.id===id?{...r,...patch}:r));
  const delRow = (key,id) => setSection(key,getSection(key).filter(r=>r.id!==id));

  const sys = job?.lightingSystem||'Control 4';
  const pl = job?.panelizedLighting||{};

  const keypadSections = [
    {key:'mainKeypad',     label:'Main Level Keypad'},
    {key:'basementKeypad', label:'Basement Keypad'},
    {key:'upperKeypad',    label:'Upper Level Keypad'},
    ...((pl.extraFloors||[]).map(ef=>({key:ef.key+'_keypad',label:`${ef.label} Keypad`}))),
  ];
  const panelFloors = ['main','basement','upper',...((pl.extraFloors||[]).map(ef=>ef.key))];
  const floorLabel = (k) => k==='main'?'Main Level':k==='basement'?'Basement':k==='upper'?'Upper Level':k;

  const inputStyle = {background:'#f9fafb',border:'1px solid #e5e7eb',borderRadius:6,padding:'5px 8px',fontSize:12,fontFamily:'inherit',outline:'none',width:'100%',boxSizing:'border-box'};
  const lvRowStyle = {background:'#faf5ff',border:'1px solid #a78bfa44',borderRadius:8,padding:'8px 10px',marginBottom:6,display:'flex',gap:8,alignItems:'flex-start'};

  if(loading) return <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100vh',color:'#6b7280'}}>Loading…</div>;
  if(error)   return <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100vh',color:'#dc2626'}}>{error}</div>;

  return (
    <div style={{maxWidth:680,margin:'0 auto',padding:'28px 16px',fontFamily:'system-ui,sans-serif',background:'#f3f4f6',minHeight:'100vh'}}>
      <div style={{background:'#4c1d95',borderRadius:14,padding:'20px 22px',marginBottom:6}}>
        <div style={{fontSize:10,color:'rgba(255,255,255,0.55)',fontWeight:700,letterSpacing:'0.12em',marginBottom:4}}>HOMESTEAD ELECTRIC — {sys.toUpperCase()} LIGHTING</div>
        <div style={{fontSize:19,fontWeight:700,color:'#fff',marginBottom:2}}>{job?.name||'Job'}</div>
        {job?.address&&<div style={{fontSize:12,color:'rgba(255,255,255,0.65)'}}>{job.address}</div>}
      </div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'6px 4px 14px'}}>
        <div style={{fontSize:11,color:'#6b7280'}}>Add your module assignments and circuit additions below. Changes save automatically.</div>
        <div style={{fontSize:11,fontWeight:600,color:saving?'#9ca3af':'#16a34a'}}>{saving?'Saving…':savedAt?`✓ Saved ${savedAt.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}`:''}</div>
      </div>

      {/* Name field */}
      <div style={{background:'#fff',border:'1px solid #e5e7eb',borderRadius:10,padding:14,marginBottom:16}}>
        <div style={{fontSize:11,fontWeight:700,color:'#374151',marginBottom:6}}>YOUR NAME / COMPANY</div>
        <input value={collab.submittedBy||''} onChange={e=>saveCollab({...collab,submittedBy:e.target.value})}
          placeholder="e.g. John Smith — LV Solutions" style={{...inputStyle,fontSize:13}}/>
      </div>

      {/* Keypad sections */}
      {keypadSections.map(({key,label}) => {
        const existingRows = (pl[key]||[]).filter(r=>r.name);
        const lvRows = getSection(key);
        return (
          <div key={key} style={{background:'#fff',border:'1px solid #e5e7eb',borderRadius:10,marginBottom:12,overflow:'hidden'}}>
            <div style={{background:'#4c1d95',padding:'8px 16px',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <span style={{fontSize:11,fontWeight:700,color:'#fff',letterSpacing:'0.08em'}}>{label.toUpperCase()}</span>
              <span style={{fontSize:10,color:'rgba(255,255,255,0.6)'}}>{sys}</span>
            </div>
            <div style={{padding:'10px 12px'}}>
              {existingRows.length>0&&(
                <div style={{marginBottom:10}}>
                  <div style={{fontSize:10,color:'#9ca3af',fontWeight:600,marginBottom:6}}>PLANNED BUTTONS</div>
                  {existingRows.map((r,i)=>(
                    <div key={r.id} style={{display:'flex',gap:8,alignItems:'center',padding:'5px 0',borderBottom:i<existingRows.length-1?'1px solid #f3f4f6':'none'}}>
                      <span style={{fontSize:11,color:'#9ca3af',width:20}}>{r.num}.</span>
                      <span style={{flex:1,fontSize:12,color:'#374151',fontWeight:500}}>{r.name}</span>
                    </div>
                  ))}
                </div>
              )}
              <div style={{fontSize:10,color:'#7c3aed',fontWeight:700,marginBottom:6,marginTop:existingRows.length?8:0}}>YOUR ADDITIONS / ASSIGNMENTS</div>
              {lvRows.map(r=>(
                <div key={r.id} style={lvRowStyle}>
                  <div style={{flex:2}}><input value={r.name||''} onChange={e=>updRow(key,r.id,{name:e.target.value})} placeholder="Circuit / button name…" style={inputStyle}/></div>
                  <div style={{flex:1}}><input value={r.module||''} onChange={e=>updRow(key,r.id,{module:e.target.value})} placeholder="Module / channel…" style={inputStyle}/></div>
                  <div style={{flex:2}}><input value={r.notes||''} onChange={e=>updRow(key,r.id,{notes:e.target.value})} placeholder="Notes…" style={inputStyle}/></div>
                  <button onClick={()=>delRow(key,r.id)} style={{background:'none',border:'none',color:'#9ca3af',cursor:'pointer',fontSize:13,flexShrink:0}}>✕</button>
                </div>
              ))}
              <button onClick={()=>addRow(key)} style={{fontSize:11,fontWeight:700,color:'#7c3aed',background:'#faf5ff',border:'1px dashed #a78bfa',borderRadius:6,padding:'5px 14px',cursor:'pointer',fontFamily:'inherit',width:'100%',marginTop:4}}>+ Add Row</button>
            </div>
          </div>
        );
      })}

      {/* Panel load sections */}
      {panelFloors.map(floor => {
        const existingRows = (pl.cp4Loads?.[floor]||[]).filter(r=>r.name||r.module);
        const lvKey = 'cp4_'+floor;
        const lvRows = getSection(lvKey);
        if(!existingRows.length&&!lvRows.length&&getSection(lvKey).length===0) return null;
        return (
          <div key={floor} style={{background:'#fff',border:'1px solid #e5e7eb',borderRadius:10,marginBottom:12,overflow:'hidden'}}>
            <div style={{background:'#5b21b6',padding:'8px 16px',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <span style={{fontSize:11,fontWeight:700,color:'#fff',letterSpacing:'0.08em'}}>{floorLabel(floor).toUpperCase()} PANEL LOADS</span>
              <span style={{fontSize:10,color:'rgba(255,255,255,0.6)'}}>{sys}</span>
            </div>
            <div style={{padding:'10px 12px'}}>
              {existingRows.length>0&&(
                <div style={{marginBottom:10}}>
                  <div style={{fontSize:10,color:'#9ca3af',fontWeight:600,marginBottom:6}}>PLANNED LOADS</div>
                  {existingRows.map((r,i)=>(
                    <div key={r.id} style={{display:'flex',gap:8,alignItems:'center',padding:'5px 0',borderBottom:i<existingRows.length-1?'1px solid #f3f4f6':'none'}}>
                      <span style={{fontSize:11,color:'#9ca3af',width:20}}>{r.num}.</span>
                      <span style={{flex:1,fontSize:12,color:'#374151',fontWeight:500}}>{r.name}</span>
                      {r.module&&<span style={{fontSize:11,color:'#7c3aed',background:'#faf5ff',borderRadius:4,padding:'1px 6px'}}>{r.module}</span>}
                    </div>
                  ))}
                </div>
              )}
              <div style={{fontSize:10,color:'#7c3aed',fontWeight:700,marginBottom:6,marginTop:existingRows.length?8:0}}>YOUR ADDITIONS / ASSIGNMENTS</div>
              {lvRows.map(r=>(
                <div key={r.id} style={lvRowStyle}>
                  <div style={{flex:2}}><input value={r.name||''} onChange={e=>updRow(lvKey,r.id,{name:e.target.value})} placeholder="Load name…" style={inputStyle}/></div>
                  <div style={{flex:1}}><input value={r.module||''} onChange={e=>updRow(lvKey,r.id,{module:e.target.value})} placeholder="Module…" style={inputStyle}/></div>
                  <div style={{flex:2}}><input value={r.notes||''} onChange={e=>updRow(lvKey,r.id,{notes:e.target.value})} placeholder="Notes…" style={inputStyle}/></div>
                  <button onClick={()=>delRow(lvKey,r.id)} style={{background:'none',border:'none',color:'#9ca3af',cursor:'pointer',fontSize:13,flexShrink:0}}>✕</button>
                </div>
              ))}
              <button onClick={()=>addRow(lvKey)} style={{fontSize:11,fontWeight:700,color:'#7c3aed',background:'#faf5ff',border:'1px dashed #a78bfa',borderRadius:6,padding:'5px 14px',cursor:'pointer',fontFamily:'inherit',width:'100%',marginTop:4}}>+ Add Row</button>
            </div>
          </div>
        );
      })}

      {/* General notes */}
      <div style={{background:'#fff',border:'1px solid #e5e7eb',borderRadius:10,padding:14,marginBottom:16}}>
        <div style={{fontSize:11,fontWeight:700,color:'#374151',marginBottom:6}}>GENERAL NOTES</div>
        <textarea value={collab.notes||''} onChange={e=>saveCollab({...collab,notes:e.target.value})}
          placeholder="Any additional notes, questions, or specifications for Homestead Electric…" rows={4}
          style={{width:'100%',border:'1px solid #e5e7eb',borderRadius:7,padding:'8px 10px',fontSize:13,fontFamily:'inherit',resize:'vertical',boxSizing:'border-box',outline:'none'}}/>
      </div>
      <div style={{textAlign:'center',fontSize:11,color:'#9ca3af'}}>Changes save automatically as you type.</div>
    </div>
  );
}

function QuestionsSharePage({ jobId }) {
  const [job,            setJob]           = useState(null);
  const [loading,        setLoading]       = useState(true);
  const [error,          setError]         = useState(null);
  const [answers,        setAnswers]       = useState({});
  const [submitting,     setSubmitting]    = useState(false);
  const [submitted,      setSubmitted]     = useState(false);
  const [respondentName, setRespondentName]= useState('');
  const [nameErr,        setNameErr]       = useState(false);
  const [prevAnsweredBy, setPrevAnsweredBy]= useState('');

  // Live listener — questions update in real-time as crew adds them
  useEffect(() => {
    const unsub = onSnapshot(doc(db,'jobs',jobId), snap => {
      if(!snap.exists()){ setError('This questions form is not available.'); setLoading(false); return; }
      setJob(snap.data().data);
      setLoading(false);
    }, () => { setError('Failed to load. Please try again.'); setLoading(false); });
    return () => unsub();
  }, [jobId]);

  // Pre-load any previously submitted answers
  useEffect(() => {
    getDoc(doc(db,'homeowner_requests',jobId)).then(snap => {
      if(snap.exists() && snap.data().questionAnswers) {
        const qa = snap.data().questionAnswers;
        setPrevAnsweredBy(qa.answeredBy || '');
        const ans = {};
        ['rough','finish'].forEach(phase => {
          ['upper','main','basement'].forEach(floor => {
            (qa[phase]?.[floor] || []).forEach(a => { if(a.answer) ans[a.id] = a.answer; });
          });
        });
        setAnswers(ans);
      }
    }).catch(()=>{});
  }, [jobId]);

  const handleSubmit = async () => {
    if(!respondentName.trim()){ setNameErr(true); return; }
    setSubmitting(true);
    const buildPhase = (qs) => {
      const r = {};
      ['upper','main','basement'].forEach(floor => {
        r[floor] = (qs?.[floor] || []).map(q => ({id:q.id, question:q.question, answer:answers[q.id]||''}));
      });
      return r;
    };
    const questionAnswers = {
      rough: buildPhase(job?.roughQuestions),
      finish: buildPhase(job?.finishQuestions),
      answeredBy: respondentName.trim(),
      answeredAt: new Date().toISOString(),
    };
    try {
      const ex = await getDoc(doc(db,'homeowner_requests',jobId));
      await setDoc(doc(db,'homeowner_requests',jobId), {
        ...(ex.exists()?ex.data():{}),
        jobId, jobName:job?.name||'', questionAnswers,
      });
      setSubmitted(true);
    } catch(e){ alert('Failed to submit. Please try again.'); }
    setSubmitting(false);
  };

  const roughQs = job ? [
    ...(job.roughQuestions?.upper||[]).map(q=>({...q,floor:'Upper Level'})),
    ...(job.roughQuestions?.main||[]).map(q=>({...q,floor:'Main Level'})),
    ...(job.roughQuestions?.basement||[]).map(q=>({...q,floor:'Basement'})),
  ] : [];
  const finishQs = job ? [
    ...(job.finishQuestions?.upper||[]).map(q=>({...q,floor:'Upper Level'})),
    ...(job.finishQuestions?.main||[]).map(q=>({...q,floor:'Main Level'})),
    ...(job.finishQuestions?.basement||[]).map(q=>({...q,floor:'Basement'})),
  ] : [];
  const hasQs = roughQs.length+finishQs.length > 0;

  const cardStyle = {background:'#fff',border:'1px solid #e5e7eb',borderRadius:10,padding:16,marginBottom:12};
  const taStyle = {width:'100%',border:'1px solid #d1d5db',borderRadius:7,padding:'8px 10px',fontSize:13,fontFamily:'inherit',resize:'vertical',boxSizing:'border-box',outline:'none'};

  if(loading) return <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100vh',color:'#6b7280',fontSize:14}}>Loading…</div>;
  if(error)   return <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100vh',color:'#dc2626',fontSize:14,padding:24,textAlign:'center'}}>{error}</div>;
  if(submitted) return (
    <div style={{maxWidth:600,margin:'0 auto',padding:'60px 24px',textAlign:'center',fontFamily:'system-ui,sans-serif'}}>
      <div style={{fontSize:48,marginBottom:16}}>✅</div>
      <div style={{fontSize:22,fontWeight:700,color:'#111',marginBottom:8}}>Answers Submitted</div>
      <div style={{fontSize:14,color:'#6b7280',lineHeight:1.6}}>Thank you, {respondentName}. Homestead Electric has received your responses and will follow up if needed.</div>
    </div>
  );

  return (
    <div style={{maxWidth:640,margin:'0 auto',padding:'28px 16px',fontFamily:'system-ui,sans-serif',background:'#f3f4f6',minHeight:'100vh'}}>
      <div style={{background:'#1e3a5f',borderRadius:14,padding:'20px 22px',marginBottom:22}}>
        <div style={{fontSize:10,color:'rgba(255,255,255,0.55)',fontWeight:700,letterSpacing:'0.12em',marginBottom:4}}>HOMESTEAD ELECTRIC</div>
        <div style={{fontSize:19,fontWeight:700,color:'#fff',marginBottom:2}}>{job?.name||'Project Questions'}</div>
        {job?.address&&<div style={{fontSize:12,color:'rgba(255,255,255,0.65)'}}>{job.address}</div>}
      </div>

      {prevAnsweredBy&&<div style={{background:'#fef3c7',border:'1px solid #f59e0b',borderRadius:8,padding:'10px 14px',marginBottom:16,fontSize:12,color:'#92400e'}}>✏️ You previously submitted answers as <b>{prevAnsweredBy}</b>. You can update them below and resubmit.</div>}

      {!hasQs ? (
        <div style={{textAlign:'center',padding:'48px 20px',color:'#9ca3af',background:'#fff',borderRadius:12}}>
          <div style={{fontSize:32,marginBottom:12}}>📋</div>
          No questions have been added yet. Check back later — this page updates automatically.
        </div>
      ) : (
        <>
          <div style={{fontSize:13,color:'#6b7280',marginBottom:18,lineHeight:1.6}}>Please answer the questions below. Your responses go directly to our team. This page updates automatically if new questions are added.</div>

          {roughQs.length>0&&(
            <div style={{marginBottom:20}}>
              <div style={{fontSize:11,fontWeight:700,color:'#2563eb',letterSpacing:'0.08em',marginBottom:10,paddingBottom:6,borderBottom:'2px solid #2563eb33'}}>⚡ ROUGH PHASE</div>
              {roughQs.map((q,i)=>(
                <div key={q.id} style={{...cardStyle,borderLeft:'3px solid #2563eb'}}>
                  <div style={{fontSize:10,color:'#9ca3af',fontWeight:600,marginBottom:3}}>{q.floor}</div>
                  <div style={{fontSize:14,fontWeight:600,color:'#111',marginBottom:10}}>Q{i+1}: {q.question}</div>
                  <textarea value={answers[q.id]||''} onChange={e=>setAnswers(a=>({...a,[q.id]:e.target.value}))} placeholder="Type your answer here…" rows={3} style={taStyle}/>
                </div>
              ))}
            </div>
          )}

          {finishQs.length>0&&(
            <div style={{marginBottom:20}}>
              <div style={{fontSize:11,fontWeight:700,color:'#0ea5e9',letterSpacing:'0.08em',marginBottom:10,paddingBottom:6,borderBottom:'2px solid #0ea5e933'}}>🏁 FINISH PHASE</div>
              {finishQs.map((q,i)=>(
                <div key={q.id} style={{...cardStyle,borderLeft:'3px solid #0ea5e9'}}>
                  <div style={{fontSize:10,color:'#9ca3af',fontWeight:600,marginBottom:3}}>{q.floor}</div>
                  <div style={{fontSize:14,fontWeight:600,color:'#111',marginBottom:10}}>Q{i+1}: {q.question}</div>
                  <textarea value={answers[q.id]||''} onChange={e=>setAnswers(a=>({...a,[q.id]:e.target.value}))} placeholder="Type your answer here…" rows={3} style={taStyle}/>
                </div>
              ))}
            </div>
          )}

          <div style={{...cardStyle,marginBottom:12}}>
            <div style={{fontSize:11,fontWeight:700,color:'#374151',marginBottom:6}}>YOUR NAME *</div>
            <input value={respondentName} onChange={e=>{setRespondentName(e.target.value);setNameErr(false);}} placeholder="Enter your name before submitting"
              style={{width:'100%',border:`1px solid ${nameErr?'#dc2626':'#d1d5db'}`,borderRadius:7,padding:'8px 10px',fontSize:13,fontFamily:'inherit',outline:'none',boxSizing:'border-box'}}/>
            {nameErr&&<div style={{color:'#dc2626',fontSize:11,marginTop:4}}>Please enter your name</div>}
          </div>

          <button onClick={handleSubmit} disabled={submitting}
            style={{width:'100%',background:'#1e3a5f',color:'#fff',border:'none',borderRadius:10,padding:14,fontSize:15,fontWeight:700,cursor:submitting?'not-allowed':'pointer',fontFamily:'inherit',opacity:submitting?0.7:1,marginBottom:16}}>
            {submitting?'Submitting…':'Submit Answers'}
          </button>
          <div style={{textAlign:'center',fontSize:11,color:'#9ca3af'}}>Questions update live — new questions added by our team will appear here automatically.</div>
        </>
      )}
    </div>
  );
}

function App() {
  // Homeowner page route — ?homeowner=JOB_ID
  const hoParam = new URLSearchParams(window.location.search).get("homeowner");
  if(hoParam) return <HomeownerPage jobId={hoParam}/>;

  // Questions share page route — ?questions=JOB_ID
  const qParam = new URLSearchParams(window.location.search).get("questions");
  if(qParam) return <QuestionsSharePage jobId={qParam}/>;

  // Home Runs share page route — ?homeruns=JOB_ID
  const hrParam = new URLSearchParams(window.location.search).get("homeruns");
  if(hrParam) return <HomeRunsSharePage jobId={hrParam}/>;

  // Lighting collab share page route — ?lighting=JOB_ID
  const ltParam = new URLSearchParams(window.location.search).get("lighting");
  if(ltParam) return <LightingSharePage jobId={ltParam}/>;

  // ── Identity ──────────────────────────────────────────────────
  const [identity, setIdentity] = useState(()=>getIdentity());
  // Legacy auth stubs removed — identity system handles this now

  // ── Users (team members) — loaded from Firestore ─────────────
  const [users, setUsers] = useState(DEFAULT_USERS);

  useEffect(()=>{
    // ── Load users ────────────────────────────────────────────
    const BAD_IDS = new Set([
      "josh_cloward","keegan","daegan","gage","treycen","jonathan","braden","colby",
      "fonoivasa","abraham","asher","austin","bailey","brady","braxton","callen",
      "isaiah","jacob_nuffer","jacob_spackman","jakob","james","noah","payton",
    ]);
    getDoc(doc(db,"settings","users")).then(snap=>{
      const raw = snap.exists()&&snap.data().list ? snap.data().list : [];
      const cleaned = raw.filter(u=>!BAD_IDS.has(u.id));

      // ── One-time merge: add missing employees (v1) ──────────────
      const MERGE_KEY = "heUserMerge_v1";
      if(!localStorage.getItem(MERGE_KEY)) {
        const ALL_EMPLOYEES = [
          { id:"abraham_tristan",        name:"Abraham Tristan" },
          { id:"asher_miller",           name:"Asher Miller" },
          { id:"austin_schut",           name:"Austin Schut" },
          { id:"bailey_smith",           name:"Bailey Smith" },
          { id:"braden_davis",           name:"Braden Davis" },
          { id:"brady_nelson",           name:"Brady Nelson" },
          { id:"braxton_raven",          name:"Braxton Raven" },
          { id:"callen_jakeman",         name:"Callen Jakeman" },
          { id:"colby_fogh",            name:"Colby Fogh" },
          { id:"daegan_smith",           name:"Daegan Smith" },
          { id:"fonoivasa_mataafa",      name:"Fonoivasa Mataafa" },
          { id:"gage_lund",             name:"Gage Lund" },
          { id:"isaiah_miller",          name:"Isaiah Miller" },
          { id:"jacob_nuffer",           name:"Jacob Nuffer" },
          { id:"jacob_spackman",         name:"Jacob Spackman" },
          { id:"jakob_bingham",          name:"Jakob Bingham" },
          { id:"james_coleman_christen", name:"James Coleman Christen" },
          { id:"jeromy_cloward",         name:"Jeromy Cloward" },
          { id:"jonathan_harding",       name:"Jonathan Harding" },
          { id:"josh_cloward",           name:"Josh Cloward" },
          { id:"justin_cloward",         name:"Justin Cloward" },
          { id:"keegan_wilkinson",       name:"Keegan Wilkinson" },
          { id:"koy_wilkinson",          name:"Koy Wilkinson" },
          { id:"lisa_brown",             name:"Lisa Brown" },
          { id:"louis_hoffman",          name:"Louis Hoffman" },
          { id:"noah_davis",             name:"Noah Davis" },
          { id:"payton_bolda",           name:"Payton Bolda" },
          { id:"treycen_rollene",        name:"Treycen Rollene" },
        ];
        const existingNames = new Set(cleaned.map(u=>(u.name||"").toLowerCase()));
        const existingIds   = new Set(cleaned.map(u=>u.id));
        const toAdd = ALL_EMPLOYEES
          .filter(e => !existingNames.has(e.name.toLowerCase()) && !existingIds.has(e.id))
          .map(e => ({ ...e, title:"crew", access:"limited", pin:"" }));
        if(toAdd.length > 0) {
          const merged = [...cleaned, ...toAdd];
          setUsers(merged);
          setDoc(doc(db,"settings","users"),{list:merged}).catch(()=>{});
          console.log(`[HE] Added ${toAdd.length} missing employee(s):`, toAdd.map(u=>u.name).join(", "));
        } else {
          setUsers(cleaned.length ? cleaned : DEFAULT_USERS);
        }
        localStorage.setItem(MERGE_KEY, "1");
      } else {
        setUsers(cleaned.length ? cleaned : DEFAULT_USERS);
      }

      if(cleaned.length !== raw.length)
        setDoc(doc(db,"settings","users"),{list:cleaned}).catch(()=>{});
    }).catch(()=>{});

    // ── Load color overrides only from settings/main ───────────
    // Name lists are ALWAYS derived from users by role — never stored separately
    getDoc(doc(db,"settings","main")).then(snap=>{
      if(!snap.exists()) return;
      const d = snap.data();
      const colors = {...(d.colorOverrides||d.foremanColors||{}),
                      ...(d.leadColors||{})};
      if(Object.keys(colors).length)
        set_colorOverrides(prev=>({...prev,...colors}));
    }).catch(()=>{});
  },[]);

  const saveUsers = async (list) => {
    setUsers(list);
    if(identity) {
      const updated = list.find(u=>u.id===identity.id);
      if(updated) { saveIdentity(updated); setIdentity(updated); }
    }
    try { await setDoc(doc(db,"settings","users"),{list}); } catch(e){ console.error(e); }
  };

  // ── Color overrides (keyed by full name) ─────────────────────
  const [_colorOverrides, set_colorOverrides] = useState({
    "Koy":"#3b82f6","Koy Wilkinson":"#3b82f6",
    "Vasa":"#f97316","Fonoivasa Mataafa":"#f97316",
    "Colby":"#22c55e","Colby Fogh":"#22c55e",
  });

  // Derive foremen/leads from users list by role
  // Derive groups from title field (new) with fallback to role (legacy)
  const getTitle = (u) => {
    if(u.title) return u.title;
    if(["admin","justin","jeromy"].includes(u.role)) return "admin";
    if(["foreman","lead","crew"].includes(u.role)) return u.role;
    return "crew";
  };
  const _foremanUsers = users.filter(u=>getTitle(u)==="foreman");
  const _leadUsers    = users.filter(u=>getTitle(u)==="lead");
  const _crewUsers    = users.filter(u=>getTitle(u)==="crew");

  // Full-name lists for dropdowns/display
  const _foremen = _foremanUsers.map(u=>u.name);
  const _leads   = _leadUsers.map(u=>u.name);

  // Normalize foreman/lead names to match the canonical casing from users list
  // Fixes issues where "Vasa mataafa" != "Vasa Mataafa" in dropdowns
  const _allPeople = users.map(u=>u.name).filter(Boolean);
  const normalizeName = (val) => {
    if(!val) return val;
    const match = _allPeople.find(p => p.toLowerCase() === val.toLowerCase());
    return match || val;
  };

  // Build color map: try full name, then first name
  const getPersonColor = (name) => {
    if(_colorOverrides[name]) return _colorOverrides[name];
    const first = name.split(" ")[0];
    if(_colorOverrides[first]) return _colorOverrides[first];
    return "#6b7280";
  };

  // Sync module-level globals (used by legacy code that reads FOREMEN/LEADS directly)
  const _foremanColors = {};
  const _leadColors    = {};
  _foremen.forEach(n=>{ _foremanColors[n]=getPersonColor(n); });
  _leads.forEach(n=>  { _leadColors[n]   =getPersonColor(n); });

  // Keep module-level vars in sync so legacy getForemenList()/LEADS refs still work
  // Wrapped in useEffect to avoid mutations during render
  useEffect(()=>{
    FOREMEN        = _foremen.length ? _foremen : DEFAULT_FOREMEN;
    FOREMEN_COLORS = _foremanColors;
    LEADS          = _leads.length   ? _leads   : DEFAULT_LEADS;
    LEAD_COLORS    = _leadColors;
  });

  // Job foreman matching: support both full name and first-name-only (legacy jobs)
  const matchesForeman = (job, name) => {
    const jf = (job.foreman||"").trim().toLowerCase();
    const n  = (name||"").trim().toLowerCase();
    if(!jf || !n) return false;
    if(jf === n) return true;
    // "Koy" matches "Koy Wilkinson" — job first name is prefix of full name
    if(n.startsWith(jf+" ")) return true;
    // "Koy Wilkinson" matches "Koy" — full name starts with job value
    if(jf.startsWith(n+" ")) return true;
    // "Vasa" matches "Fonoivasa Mataafa" — job value appears anywhere in full name words
    const nameParts = n.split(" ");
    if(nameParts.some(part => part === jf || part.includes(jf) || jf.includes(part))) return true;
    return false;
  };

  const saveSettings = async(colorOverrides) => {
    set_colorOverrides(colorOverrides);
    await setDoc(doc(db,"settings","main"),{colorOverrides}).catch(()=>{});
  };


  // submitPin removed — replaced by UserPicker identity system

  const [jobs,     setJobs]     = useState([]);
  const [upcoming, setUpcoming] = useState([]);
  const [manualTasks, setManualTasks] = useState([]);

  const [selected, setSelected] = useState(null);

  const [search,   setSearch]   = useState("");

  const [stageF,   setStageF]   = useState("All");

  const [flagOnly, setFlagOnly] = useState(false);

  const [foremanViewTab, setForemanViewTab] = useState("jobs");

  const [stageModal, setStageModal] = useState(null);

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

    return (Array.isArray(loaded)?loaded:[]).map(j=>{
      const migrated = {...j,
        roughStage:  roughMap[j.roughStage]||(j.roughStage||"0%"),
        finishStage: finishMap[j.finishStage]||(j.finishStage||"0%"),
      };
      return normalizeJob(migrated);
    });

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

          const loaded = migrate(snap.docs.map(d=>{const raw=d.data(); return raw?.data ? {...raw.data, updated_at:raw.updated_at||"", _saved_by:raw.saved_by||"", _device:raw.device||""} : null;}).filter(Boolean));

          // Normalize foreman/lead names to match canonical casing from users list
          // This prevents "Vasa mataafa" showing as wrong person in dropdowns
          loaded.forEach(j => {
            if(j.foreman) { const fixed = normalizeName(j.foreman); if(fixed !== j.foreman) j.foreman = fixed; }
            if(j.lead)    { const fixed = normalizeName(j.lead);    if(fixed !== j.lead)    j.lead = fixed; }
          });

          // One-time fix v2: DISABLED — was using setDoc (full overwrite) which can wipe data
          // when localStorage is cleared and the fix re-runs. If needed, use updateDoc with dot-notation.
          // The fix has already run on all devices, so this is safe to leave disabled.

          // Merge snapshot data with any pending local edits
          // Jobs with active save timers should keep their local version
          setJobs(prev => {
            const pendingIds = new Set(Object.keys(saveTimers.current).filter(k => saveTimers.current[k]));
            if(pendingIds.size === 0) return loaded;
            return loaded.map(sj => {
              if(pendingIds.has(sj.id)) {
                const local = prev.find(p => p.id === sj.id);
                return local || sj;
              }
              return sj;
            });
          });

          // Keep selected job in sync with Firestore updates
          setSelected(prev => {
            if(!prev) return null;
            // Don't overwrite if there's a pending save for this job
            if(saveTimers.current[prev.id]) return prev;
            const updated = loaded.find(j => j.id === prev.id);
            return updated ? normalizeJob(updated) : prev;
          });

          // Auto-advance: one-time — if rough complete and finish has no status for 60+ days,
          // set finish to "waiting_date" so the "Get Finish Start Date" task fires
          const ADVANCE_KEY = "heAutoAdvanceFinish_v1";
          if(!localStorage.getItem(ADVANCE_KEY)) {
            let advancedCount = 0;
            loaded.forEach(job => {
              if(job.tempPed) return;
              const rs = job.roughStatus || (parseInt(job.roughStage)===100?"complete":"");
              const fs = job.finishStatus || "";
              if(rs !== "complete") return;
              if(fs && fs !== "" && fs !== "ready") return; // already has a finish status
              const betweenDate = job.roughStatusDate || job.roughProjectedStart || "";
              if(!betweenDate) return;
              const parseD = (str) => {
                const m1 = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
                if(m1) return new Date(+m1[1],+m1[2]-1,+m1[3]);
                const m2 = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
                if(m2) return new Date(+(m2[3].length===2?"20"+m2[3]:m2[3]),+m2[1]-1,+m2[2]);
                return null;
              };
              const d = parseD(betweenDate);
              if(!d) return;
              const daysBetween = Math.floor((Date.now() - d.getTime()) / (1000*60*60*24));
              if(daysBetween >= 60) {
                updateDoc(doc(db,"jobs",job.id),{"data.finishStatus":"waiting_date",updated_at:new Date().toISOString()}).catch(()=>{});
                advancedCount++;
              }
            });
            if(advancedCount > 0) console.log(`[HE] Auto-advanced ${advancedCount} job(s) finish to waiting_date`);
            localStorage.setItem(ADVANCE_KEY, "1");
          }

          // Never overwrite the selected job from snapshot — JobDetail manages its own state

          // Just keep the jobs list in sync for the home screen

          // Only update localStorage backup if Firestore has real data
          // Never let a smaller/stale snapshot overwrite a larger backup
          try {
            const existingBackup = JSON.parse(localStorage.getItem('hejobs_backup')||'[]');
            if(loaded.length >= existingBackup.length || loaded.length > 3) {
              localStorage.setItem('hejobs_backup', JSON.stringify(loaded));
            } else {
              console.warn(`[HE] Firestore returned ${loaded.length} jobs but backup has ${existingBackup.length} — NOT overwriting backup`);
            }
          } catch(e){}

        } else {

          // Firestore appears empty — DO NOT blindly restore from localStorage
          // This can overwrite real data if there's a brief network glitch
          // Only restore if we've NEVER had jobs before (truly new install)
          console.warn("[HE] Firestore snapshot was empty. NOT restoring from localStorage to prevent data loss.");
          console.warn("[HE] If this is a new install, add your first job manually.");

        }

        initialLoad.current = false;

      },

      (err) => {

        console.error('Snapshot error:',err);

        initialLoad.current = false;

      }

    );

    // Load upcoming jobs from Firestore
    const unsubUpcoming = onSnapshot(collection(db,"upcoming"),
      async (snap) => {
        const loaded = snap.docs.map(d=>d.data().data).filter(Boolean);
        // Merge seed jobs in — add any seed job not already present by id
        const loadedIds = new Set(loaded.map(u=>u.id));
        const missing = SEED_UPCOMING.filter(s=>!loadedIds.has(s.id));
        if(missing.length > 0) {
          for(const item of missing) {
            try { await setDoc(doc(db,"upcoming",item.id),{data:item,updated_at:new Date().toISOString()}); } catch(e){}
          }
          // snapshot will re-fire with the new docs, so no need to setUpcoming here
        } else {
          setUpcoming(loaded);
        }
      },
      (err) => { console.error("Upcoming snapshot error:",err); }
    );

    // Load manual tasks from Firestore
    const unsubTasks = onSnapshot(collection(db,"manualTasks"),
      (snap) => { const loaded=snap.docs.map(d=>d.data().data).filter(Boolean); setManualTasks(loaded); },
      (err) => { console.error("Tasks snapshot error:",err); }
    );

    // Force-reload: watch config/app for version changes AFTER initial load
    let firstVersionSeen = null;
    const unsubVersion = onSnapshot(doc(db,"config","app"), (snap) => {
      if(!snap.exists()) return;
      const v = snap.data()?.version || "";
      if(!v) return;
      if(firstVersionSeen === null) { firstVersionSeen = v; return; } // first load — just record it
      if(v !== firstVersionSeen) {
        console.log(`[HE] App version changed (${firstVersionSeen} → ${v}) — reloading...`);
        window.location.reload();
      }
    }, ()=>{});

    return () => { unsub(); unsubUpcoming(); unsubTasks(); unsubVersion(); }; // cleanup on unmount

  },[]);

  // Automatic daily safety backup — separate from the normal rolling backup
  // Kept under a dated key so it can't be accidentally overwritten
  useEffect(() => {
    if(!jobs.length) return;
    const today = new Date().toISOString().split("T")[0];
    const key = `he_daily_backup_${today}`;
    if(!localStorage.getItem(key)) {
      // Clean up old backups FIRST to free space, then save today's
      const cutoff = new Date(Date.now() - 3*86400000).toISOString().split("T")[0];
      const keysToRemove = [];
      for(let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if(k?.startsWith("he_daily_backup_") && k !== key) {
          const d = k.replace("he_daily_backup_","");
          if(d < cutoff) keysToRemove.push(k);
        }
      }
      keysToRemove.forEach(k => { try { localStorage.removeItem(k); } catch(e){} });
      // Save a compact version (no uploaded file blobs) to avoid quota issues
      const compact = jobs.map(j => {const c={...j}; delete c.uploadedFiles; return c;});
      try {
        localStorage.setItem(key, JSON.stringify({savedAt: new Date().toISOString(), count: jobs.length, jobs: compact}));
        console.log(`[HE] Daily safety backup saved: ${jobs.length} jobs (${today})`);
      } catch(e) { console.warn("[HE] Daily backup failed (storage still full after cleanup):", e); }
    }
  }, [jobs.length > 0]);


  // Save a single job — uses field-level merge when a patch is provided
  // so concurrent edits to different fields don't overwrite each other
  const pendingPatches = useRef({}); // jobId → accumulated patch fields

  const saveJob = (job, patch) => {

    if(initialLoad.current) return;

    isDirty.current = true;

    setSyncStatus("saving");

    // Accumulate patches for this job so we only write changed fields
    if(patch) {
      pendingPatches.current[job.id] = {...(pendingPatches.current[job.id]||{}), ...patch};
    }

    // Always write to localStorage immediately

    try {

      const cur = JSON.parse(localStorage.getItem('hejobs_backup')||'[]');

      localStorage.setItem('hejobs_backup', JSON.stringify(

        cur.filter(j=>j.id!==job.id).concat(job)

      ));

    } catch(e){}

    clearTimeout(saveTimers.current[job.id]);

    saveTimers.current[job.id] = setTimeout(async()=>{

      saveTimers.current[job.id] = null;

      try {

        // Tag every save with device identity so we can trace who changed what
        const deviceId = localStorage.getItem('he_device_id') || (() => { const id = 'dev_' + Math.random().toString(36).slice(2,8); localStorage.setItem('he_device_id', id); return id; })();
        const accumulated = pendingPatches.current[job.id];
        delete pendingPatches.current[job.id];

        if(accumulated && Object.keys(accumulated).length > 0) {
          // Patch mode: only write the fields that changed.
          // updateDoc with dot-notation is the correct Firebase API for this — it touches ONLY
          // the specified nested fields and leaves everything else in Firestore untouched.
          const patch = {updated_at:new Date().toISOString(),saved_by:identity?.name||"unknown",device:deviceId};
          Object.entries(sanitize(accumulated)).forEach(([k,v]) => { patch["data."+k] = v; });
          try {
            await updateDoc(doc(db,"jobs",job.id), patch);
          } catch(notFound) {
            // Document doesn't exist yet (new job created but first setDoc hasn't landed) — create it now
            if(notFound?.code === 'not-found') {
              await setDoc(doc(db,"jobs",job.id), {data:sanitize(job), updated_at:patch.updated_at, saved_by:patch.saved_by, device:patch.device});
            } else { throw notFound; }
          }
        } else {
          // No patch — new job or unpatch'd save path. Write all current fields via dot-notation updateDoc
          // so we never wipe Firestore fields another user added that aren't in our local snapshot.
          const sanitized = sanitize(job);
          // Check estimated size before saving
          const estimatedSize = JSON.stringify(sanitized).length;
          if(estimatedSize > 900000) {
            console.warn(`[HE] Job ${job.name} is ${Math.round(estimatedSize/1024)}KB — approaching Firestore 1MB limit`);
            if(estimatedSize > 1000000) {
              console.error(`[HE] Job ${job.name} exceeds 1MB (${Math.round(estimatedSize/1024)}KB) — photos may need to be removed`);
              setSyncStatus("error");
              alert(`Save failed: "${job.name}" is too large (${Math.round(estimatedSize/1024)}KB). Try removing some photos — each photo adds to the document size. Firebase Storage for photos is coming soon.`);
              return;
            }
          }
          const meta = {updated_at:new Date().toISOString(),saved_by:identity?.name||"unknown",device:deviceId};
          const fullPatch = {...meta};
          Object.entries(sanitized).forEach(([k,v]) => { fullPatch["data."+k] = v; });
          try {
            await updateDoc(doc(db,"jobs",job.id), fullPatch);
          } catch(notFound) {
            // New document — create it with full structure
            if(notFound?.code === 'not-found') {
              await setDoc(doc(db,"jobs",job.id), {data:sanitized, ...meta});
            } else { throw notFound; }
          }
        }

        isDirty.current = false;

        setSyncStatus("saved");

        setTimeout(()=>setSyncStatus("idle"),2000);

      } catch(e){

        console.error('Save error:',e?.message||e);
        const msg = e?.message || "";
        if(msg.includes("exceeds the maximum") || msg.includes("too large") || msg.includes("INVALID_ARGUMENT")) {
          setSyncStatus("error");
          alert(`Save failed: "${job.name}" document is too large for Firestore. Try removing photos to reduce size.`);
        } else {
          setSyncStatus("error");
        }

      }

    }, 500);

  };


  // Delete job document

  const flushJob = async (job) => {
    if(!job) return;
    // If there's a pending save timer, flush accumulated patches
    if(saveTimers.current[job.id]) {
      clearTimeout(saveTimers.current[job.id]);
      saveTimers.current[job.id] = null;
      const accumulated = pendingPatches.current[job.id];
      delete pendingPatches.current[job.id];
      if(accumulated && Object.keys(accumulated).length > 0) {
        const patch = {updated_at:new Date().toISOString()};
        Object.entries(sanitize(accumulated)).forEach(([k,v]) => { patch["data."+k] = v; });
        try {
          await updateDoc(doc(db,"jobs",job.id), patch);
        } catch(e) {
          if(e?.code === 'not-found') {
            // New doc — create it
            try { await setDoc(doc(db,"jobs",job.id), {data:sanitize(job), updated_at:patch.updated_at}); } catch(e2){console.error('[HE] flushJob create error:',e2?.message);}
          } else { console.error('[HE] flushJob save error:',e?.message); }
        }
      }
      // No else — never do a full overwrite from flushJob, it can wipe other users' data
    }
  };

  const deleteJobRemote = async (jobId) => {

    try {

      const cur = JSON.parse(localStorage.getItem('hejobs_backup')||'[]');

      localStorage.setItem('hejobs_backup', JSON.stringify(cur.filter(j=>j.id!==jobId)));

    } catch(e){}

    try { await deleteDoc(doc(db,"jobs",jobId)); } catch(e){}

  };


  const saveManualTask = async (task) => {
    try { await setDoc(doc(db,"manualTasks",task.id),{data:task,updated_at:new Date().toISOString()}); } catch(e){}
  };
  const deleteManualTask = async (id) => {
    try { await deleteDoc(doc(db,"manualTasks",id)); } catch(e){}
  };

  const saveUpcomingItem = async (item) => {
    try { await setDoc(doc(db,"upcoming",item.id),{data:item,updated_at:new Date().toISOString()}); } catch(e){ console.error(e); }
  };
  const deleteUpcomingItem = async (id) => {
    try { await deleteDoc(doc(db,"upcoming",id)); } catch(e){}
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

    const gmailSubject = "Homestead Electric — Daily Backup " + new Date().toLocaleDateString();

    const gmailBody = "Backup file downloaded. Attach the file from your downloads folder.\n\nView job board: https://homestead-electric.vercel.app/";

    setTimeout(()=>openEmail("", gmailSubject, gmailBody), 500);

  };


  const flushSaves = () => {

    // Only flush jobs that have pending save timers — avoids overwriting other users' changes
    const pendingIds = new Set(Object.keys(saveTimers.current).filter(k => saveTimers.current[k]));
    if(pendingIds.size === 0) return;

    jobsRef.current.filter(job => pendingIds.has(job.id)).forEach(job=>{

      clearTimeout(saveTimers.current[job.id]);
      saveTimers.current[job.id] = null;

      // Use accumulated patches if available — never do full overwrite
      const accumulated = pendingPatches.current[job.id];
      delete pendingPatches.current[job.id];
      if(accumulated && Object.keys(accumulated).length > 0) {
        const patch = {updated_at:new Date().toISOString()};
        Object.entries(sanitize(accumulated)).forEach(([k,v]) => { patch["data."+k] = v; });
        updateDoc(doc(db,"jobs",job.id), patch).catch(e => {
          if(e?.code === 'not-found') {
            setDoc(doc(db,"jobs",job.id), {data:sanitize(job), updated_at:patch.updated_at}).catch(e2=>console.error('[HE] flushSaves create error:',e2?.message));
          } else { console.error('[HE] flushSaves error:',e?.message); }
        });
      }
      // If no accumulated patches, skip — don't overwrite with potentially stale data

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

    const handleVisibility = ()=>{ if(document.visibilityState==='hidden') flushSaves(); };

    document.addEventListener('visibilitychange', handleVisibility);

    window.addEventListener('beforeunload', flushSaves);

    return ()=>{

      document.removeEventListener('visibilitychange', handleVisibility);

      window.removeEventListener('beforeunload', flushSaves);

    };

  },[]);


  const updateJob = (updated, patch) => { setJobs(js=>js.map(j=>j.id===updated.id?updated:j)); setSelected(updated); saveJob(updated, patch); };

  // addJob removed — inline in each button instead

  const deleteJob = id => {

    if(!window.confirm("Delete this job site?")) return;

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

      return total + countFloor(p.upper) + countFloor(p.main) + countFloor(p.basement) + ((p.extras||[]).reduce((s,e)=>s+countFloor(p[e.key]),0));

    },0);

  };


  const totalOpen  = jobs.reduce((a,j)=>a+openCount(j),0);

  const flagged    = jobs.filter(j=>j.flagged).length;

  const complete   = jobs.filter(j=>parseStage(j.finishStage)===100).length;

  const pendingCOs = jobs.reduce((a,j)=>a+(j.changeOrders||[]).filter(c=>c.coStatus!=="completed"&&c.coStatus!=="denied"&&c.coStatus!=="converted").length,0);

  const syncColor  = {idle:C.muted,saving:C.accent,saved:C.green,error:C.red}[syncStatus];

  const syncLabel  = {idle:"All changes saved",saving:"Saving…",saved:"✓ Saved",error:"Save failed"}[syncStatus];


  // view: "home" = main page, "foreman" = foreman-specific page

  const [view, setView] = useState("home");
  const [activeForeman, setActiveForeman] = useState(null);

  const openForeman  = (f) => { setActiveForeman(f); setView("foreman");   setSearch(""); setStageF("All"); setFlagOnly(false); };
  const [crewView, setCrewView] = useState(null); // foreman name or null
  const goHome            = () =>  { setView("home");           setActiveForeman(null); setSearch(""); setStageF("All"); setFlagOnly(false); };
  const openSchedule      = () =>  { setView("schedule");      setActiveForeman(null); setSearch(""); setStageF("All"); setFlagOnly(false); };
  const openUpcoming      = () =>  { setView("upcoming");      setActiveForeman(null); setSearch(""); setStageF("All"); setFlagOnly(false); };
  const openTasks         = () =>  { setView("tasks");         setActiveForeman(null); setSearch(""); setStageF("All"); setFlagOnly(false); };
  const openSettings      = () =>  { setView("settings");      setActiveForeman(null); setSearch(""); setStageF("All"); setFlagOnly(false); };
  const openSubcontractor = () =>  { setView("subcontractors");setActiveForeman(null); setSearch(""); setStageF("All"); setFlagOnly(false); };

  // ── Contractor users + access helpers ─────────────────────────
  const contractorUsers = (users||[]).filter(u => getAccess(u) === "contractor");
  const isContractor = getAccess(identity) === "contractor";

  // Force contractors to subcontractor view (lock them out of all other views)
  useEffect(() => {
    if(isContractor) setView("subcontractors");
  }, [isContractor]);


  const viewJobs = view==="foreman" ? jobs.filter(j=>activeForeman==="Unassigned"?(!j.foreman||j.foreman==="Unassigned"):matchesForeman(j,activeForeman)) : jobs;


  const filtered = viewJobs.filter(j=>{

    const s  = search.toLowerCase();

    const ms = !s||j.name.toLowerCase().includes(s)||j.address.toLowerCase().includes(s)||j.gc.toLowerCase().includes(s);

    const mf = !flagOnly||j.flagged;

    const rPct = parseStage(j.roughStage);

    const fPct = parseStage(j.finishStage);

    const mt =

      stageF==="All"    ? true :

      stageF==="rough"  ? (rPct>0 && rPct<100 && fPct===0) :

      stageF==="between"? (rPct===100 && fPct===0) :

      stageF==="finish" ? (fPct>0 && fPct<100) : true;

    return ms&&mf&&mt;

  });


  const JobRow = ({job, fc, showForeman=false}) => {

    const open      = openCount(job);

    const pendCO    = (job.changeOrders||[]).filter(c=>c.coStatus!=="completed"&&c.coStatus!=="denied"&&c.coStatus!=="converted").length;

    const pendRT    = (job.returnTrips||[]).filter(r=>!r.signedOff).length;

    const countQCFloor = (f) => { if(!f) return 0; return (f.general||[]).filter(i=>!i.done).length + (f.rooms||[]).reduce((a,r)=>a+(r.items||[]).filter(i=>!i.done).length,0); };

    const qcItems = countQCFloor(job.qcPunch?.upper) + countQCFloor(job.qcPunch?.main) + countQCFloor(job.qcPunch?.basement) + ((job.qcPunch?.extras||[]).reduce((s,e)=>s+countQCFloor(job.qcPunch?.[e.key]),0));

    const foreman = job.foreman||"Koy";

    const rowFc = fc || _foremanColors[foreman];

    const hasRT      = (job.returnTrips||[]).some(r=>!r.signedOff&&!r.rtScheduled&&(r.scope||r.date));
    const hasRTSch   = (job.returnTrips||[]).some(r=>!r.signedOff&&r.rtScheduled&&(r.scope||r.date));
    const prepAlert  = job.prepStage===PREP_STAGE_ALERT;
    const rs = effRS(job);
    const fs = effFS(job);
    const isInvoice  = rs==="invoice"||fs==="invoice";
    const isWaiting  = rs==="waiting"||fs==="waiting";
    const isSched    = rs==="scheduled"||fs==="scheduled";
    const isReady    = rs==="date_confirmed"||fs==="date_confirmed"||rs==="waiting_date"||fs==="waiting_date";
    // Priority: red alerts > RT scheduled > invoice > waiting > scheduled > ready
    const priority = (hasRT||prepAlert)?"red":hasRTSch?"purple":isInvoice?"invoice":isWaiting?"hold":isSched?"sched":isReady?"ready":"none";
    const BG    = {red:"rgba(220,38,38,0.18)",purple:"rgba(139,92,246,0.10)",invoice:"rgba(234,88,12,0.10)",hold:"rgba(234,179,8,0.12)",sched:"rgba(37,99,235,0.08)",ready:"rgba(202,138,4,0.08)",none:C.card};
    const LBORD = {red:"#dc2626",purple:"#8b5cf6",invoice:"#ea580c",hold:"#ca8a04",sched:"#2563eb",ready:"#ca8a04",none:rowFc};
    const BORD  = {red:"2px solid #dc2626",purple:"2px solid #8b5cf6",invoice:"2px solid #ea580c",hold:"1px dashed #ca8a04",sched:"1px dashed #2563eb",ready:"1px dashed #ca8a04",none:`1px solid ${C.border}`};
    const rowBg    = BG[priority];
    const rowLbord = LBORD[priority];
    const rowBord  = BORD[priority];

    return (

      <div className="job-row" onClick={()=>setSelected(job)}
        style={{background:rowBg,border:rowBord,borderRadius:14,padding:"13px 16px",marginBottom:8,borderLeft:`3px solid ${rowLbord}`}}>

        <div style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>

          <div style={{flex:"0 0 210px",minWidth:140}}>

            <div style={{display:"flex",alignItems:"center",gap:7}}>

              <span style={{fontWeight:600,fontSize:13,color:C.text}}>{job.name||"Untitled Job"}</span>

            </div>

            <div style={{fontSize:11,color:C.dim,marginTop:1}}>

              {showForeman&&<span style={{color:rowFc,fontWeight:600,marginRight:6}}>{foreman}</span>}

              {job.lead&&<span style={{color:C.accent,fontWeight:600,marginRight:6}}>· {job.lead}</span>}

              {job.gc||"No GC set"}

              {job.updated_at&&<span style={{color:C.dim,marginLeft:6,fontSize:11,fontWeight:500}}>· {timeAgo(job.updated_at)}</span>}

            </div>

            {job.flagged&&job.flagNote&&(
              <div style={{fontSize:11,color:C.accent,marginTop:4,fontWeight:500,
                background:"#fffbeb",border:`1px solid ${C.accent}44`,
                borderRadius:6,padding:"4px 8px",display:"inline-block",maxWidth:"100%"}}>
                ⚑ {job.flagNote}
              </div>
            )}

          </div>

          {job.prepStage&&(parseStage(job.roughStage)===0)&&(
            <div style={{flex:"0 0 auto",maxWidth:160}}>
              <div style={{fontSize:9,color:C.teal,marginBottom:4,fontWeight:700,letterSpacing:"0.1em"}}>PREP</div>
              <div style={{fontSize:10,color:C.teal,fontWeight:600,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{job.prepStage}</div>
            </div>
          )}

          <div style={{flex:"1 1 150px",minWidth:130}}>
            <div style={{fontSize:9,color:C.rough,marginBottom:4,fontWeight:700,letterSpacing:"0.1em"}}>ROUGH</div>
            <StageBar stages={ROUGH_STAGES} current={job.roughStage} color={C.rough}/>
            {job.roughProjectedStart&&(
              <div style={{marginTop:4,fontSize:12,fontWeight:700,
                color:job.roughStartConfirmed?"#16a34a":"#dc2626"}}>
                {job.roughStartConfirmed?"Ready: ":"Projected: "}{fmtDisplay(job.roughProjectedStart)}
              </div>
            )}
          </div>

          <div style={{flex:"1 1 190px",minWidth:150}}>
            <div style={{fontSize:9,color:C.finish,marginBottom:4,fontWeight:700,letterSpacing:"0.1em"}}>FINISH</div>
            <StageBar stages={FINISH_STAGES} current={job.finishStage} color={C.finish}/>
            {job.finishProjectedStart&&(
              <div style={{marginTop:4,fontSize:12,fontWeight:700,
                color:job.finishStartConfirmed?"#16a34a":"#dc2626"}}>
                {job.finishStartConfirmed?"Ready: ":"Projected: "}{fmtDisplay(job.finishProjectedStart)}
              </div>
            )}
          </div>

          <div style={{display:"flex",gap:5,flexWrap:"wrap",alignItems:"center"}}>

            {hasRT&&<Pill label="Return trip needed" color="#dc2626"/>}
            {prepAlert&&<Pill label="Redline plans need update" color="#dc2626"/>}
            {hasRTSch&&!hasRT&&<Pill label="Return trip scheduled" color="#8b5cf6"/>}
            {rs&&!(rs==="complete"&&fs&&fs!=="waiting_date"&&fs!=="date_confirmed")&&<Pill label={rs==="scheduled"&&job.roughStatusDate?"Rough: "+fmtDisplay(job.roughStatusDate):rs==="date_confirmed"&&job.roughStatusDate?"Rough: "+fmtDisplay(job.roughStatusDate):("Rough: "+(getStatusDef(ROUGH_STATUSES,rs).label||rs))} color={getStatusDef(ROUGH_STATUSES,rs).color||C.dim}/>}
            {fs&&<Pill label={fs==="scheduled"&&job.finishStatusDate?"Finish: "+fmtDisplay(job.finishStatusDate):("Finish: "+(getStatusDef(FINISH_STATUSES,fs).label||fs))} color={getStatusDef(FINISH_STATUSES,fs).color||C.dim}/>}
            {open>0   &&<Pill label={`${open} open`} color={C.red}/>}

            {pendCO>0 &&<Pill label={`${pendCO} CO`} color={C.orange}/>}

            {pendRT>0 &&<Pill label={`${pendRT} return trip${pendRT>1?'s':''}`} color={C.red}/>}

            {qcItems>0&&<Pill label={`${qcItems} QC`} color={C.red}/>}

            {(job.uploadedFiles||[]).length>0&&<Pill label={`${job.uploadedFiles.length} files`} color={C.green}/>}

          </div>

          <div style={{display:"flex",alignItems:"center",gap:6,marginLeft:"auto",flexShrink:0}}>

            {_foremen.filter(f=>f!==foreman).map(f2=>(

              <button key={f2} onClick={e=>{e.stopPropagation();const patch={foreman:f2};updateJob({...job,...patch},patch);}}

                style={{background:"none",border:`1px solid ${_foremanColors[f2]}44`,borderRadius:6,

                  color:_foremanColors[f2],fontSize:10,padding:"3px 8px",cursor:"pointer",

                  fontFamily:"inherit",whiteSpace:"nowrap",transition:"opacity 0.15s"}}

                onMouseEnter={e=>e.currentTarget.style.opacity=".7"}

                onMouseLeave={e=>e.currentTarget.style.opacity="1"}>→ {f2}</button>

            ))}

            {can(identity,"job.delete")&&(
              <button onClick={e=>{e.stopPropagation();deleteJob(job.id);}}

                style={{background:"none",border:"none",color:C.muted,cursor:"pointer",

                  fontSize:15,padding:"4px 8px",opacity:0.45,transition:"opacity 0.15s"}}

                onMouseEnter={e=>e.currentTarget.style.opacity="1"}

                onMouseLeave={e=>e.currentTarget.style.opacity="0.45"}>🗑</button>
            )}

          </div>

        </div>

      </div>
    );

  };


  // ── Identity gate — show UserPicker if no identity saved ────
  if(!identity) {
    return <UserPicker users={users}
      onSelect={m => { saveIdentity(m); setIdentity(m); }}
      onSavePin={async (updated) => {
        // Save the new PIN into the users list in Firestore
        const newList = users.map(u => u.id===updated.id ? updated : u);
        await saveUsers(newList);
      }}
    />;
  }




  return (

    <div style={{minHeight:"100vh",background:C.bg,fontFamily:"'DM Sans',sans-serif",color:C.text,position:"relative"}}>

      <div style={{position:"fixed",inset:0,backgroundImage:"url(/icon-192.png)",

        backgroundRepeat:"no-repeat",backgroundPosition:"center center",

        backgroundSize:"320px 320px",opacity:0.15,pointerEvents:"none",zIndex:0}}/>


      {/* ── TOP NAV BAR ── */}
      <div style={{display:"flex",gap:6,padding:"8px 10px",borderBottom:`1px solid ${C.border}`,background:C.card,position:"sticky",top:0,zIndex:90,overflowX:"auto",scrollbarWidth:"none",alignItems:"center"}}>
        {(isContractor
          ? [{key:"subcontractors", label:"My Jobs"}]
          : [
              {key:"home",label:"Job Board"},
              {key:"schedule",label:"Forecast"},
              {key:"upcoming",label:"Upcoming"},
              {key:"tasks",label:"Tasks"},
              ...(contractorUsers.length>0?[{key:"subcontractors",label:contractorUsers.length===1?contractorUsers[0].name.split(" ")[0]:"Subcontractors"}]:[]),
              ...(can(identity,"settings.view")?[{key:"settings",label:"⚙ Settings"}]:[]),
            ]
        ).map(({key,label})=>{
          const active = view===key;
          return (
            <button key={key} onClick={key==="home"?goHome:key==="schedule"?openSchedule:key==="upcoming"?openUpcoming:key==="tasks"?openTasks:key==="subcontractors"?openSubcontractor:openSettings}
              style={{
                padding:"7px 16px",fontSize:12,fontWeight:active?700:500,fontFamily:"inherit",
                cursor:"pointer",whiteSpace:"nowrap",border:"none",borderRadius:8,
                background: active ? C.accent : "transparent",
                color: active ? "#000" : C.dim,
                transition:"all 0.15s",letterSpacing:"0.02em",
                boxShadow: active ? `0 2px 8px ${C.accent}55` : "none",
              }}>
              {label}
            </button>
          );
        })}
        <div style={{marginLeft:"auto",flexShrink:0,display:"flex",alignItems:"center",gap:8}}>
          <span style={{fontSize:11,color:C.dim,background:C.surface,border:`1px solid ${C.border}`,
            borderRadius:99,padding:"4px 12px",whiteSpace:"nowrap"}}>
            {identity.name} · {ACCESS_LABELS[getAccess(identity)]||getAccess(identity)}
          </span>
          <button onClick={()=>{localStorage.removeItem("he_identity");setIdentity(null);}}
            style={{fontSize:11,color:C.dim,background:"none",border:`1px solid ${C.border}`,
              borderRadius:99,padding:"4px 10px",cursor:"pointer",fontFamily:"inherit",whiteSpace:"nowrap"}}
            title="Switch user">
            ↩ Switch
          </button>
        </div>
      </div>

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

        @keyframes taskPulse {
          0%,100% { box-shadow: 0 0 12px rgba(220,38,38,0.13), 0 2px 8px rgba(220,38,38,0.08); }
          50%      { box-shadow: 0 0 22px rgba(220,38,38,0.30), 0 2px 14px rgba(220,38,38,0.18); }
        }
        @keyframes taskWarn {
          0%,100% { box-shadow: 0 0 10px rgba(202,138,4,0.12), 0 2px 6px rgba(202,138,4,0.08); }
          50%      { box-shadow: 0 0 18px rgba(202,138,4,0.28), 0 2px 10px rgba(202,138,4,0.16); }
        }
        .task-pulse { animation: taskPulse 2s ease-in-out infinite; }
        .task-warn  { animation: taskWarn 2.5s ease-in-out infinite; }

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

          {/* ── HOME HEADER ── */}
          <div style={{padding:"20px 24px 16px",borderBottom:`1px solid ${C.border}`,background:C.card}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,flexWrap:"wrap"}}>

              {/* Title block */}
              <div>
                <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:28,letterSpacing:"0.08em",color:C.text,lineHeight:1,display:"flex",alignItems:"center",gap:10}}>
                  HOMESTEAD ELECTRIC
                </div>
                <div style={{display:"flex",alignItems:"center",gap:10,marginTop:4}}>
                  <span style={{fontSize:11,color:C.dim}}>{jobs.length} job sites</span>
                  <span style={{width:3,height:3,borderRadius:"50%",background:C.border,display:"inline-block"}}/>
                  <span style={{fontSize:11,color:syncColor,fontWeight:500}}>{syncLabel}</span>
                </div>
              </div>

              {/* Action buttons */}
              <div style={{display:"flex",gap:6,alignItems:"center"}}>

                <button onClick={()=>{localStorage.removeItem("he_identity");setIdentity(null);}}
                  style={{background:"none",border:`1px solid ${C.border}`,borderRadius:8,
                    color:C.dim,fontSize:11,fontWeight:600,padding:"6px 12px",cursor:"pointer",
                    fontFamily:"inherit"}}>
                  🔒 Lock
                </button>
                <button onClick={backupByEmail}
                  style={{background:"none",border:`1px solid ${C.border}`,borderRadius:8,
                    color:C.dim,fontSize:11,fontWeight:600,padding:"6px 12px",cursor:"pointer",
                    fontFamily:"inherit"}}>
                  Backup
                </button>
                <button onClick={()=>window.location.reload()}
                  style={{background:"none",border:`1px solid ${C.border}`,borderRadius:8,
                    color:C.dim,fontSize:14,fontWeight:700,padding:"6px 10px",cursor:"pointer",
                    fontFamily:"inherit"}}>
                  ↻
                </button>
                {getAccess(identity)==="admin"&&(
                <button onClick={async()=>{
                    try {
                      const btn = document.activeElement; if(btn) btn.disabled = true;
                      const result = await syncDriveFoldersToJobs(jobs, updateJob);
                      const msg = `Drive Sync Complete!\n\n` +
                        `${result.matched.length} new match${result.matched.length===1?"":"es"} linked` +
                        (result.matched.length > 0 ? ":\n" + result.matched.map(m=>`  ${m.folderName} → ${m.jobName}`).join("\n") : "") +
                        `\n${result.skipped.length} already linked` +
                        (result.ambiguous.length > 0 ? `\n${result.ambiguous.length} ambiguous (skipped):\n` + result.ambiguous.map(a=>`  ${a.jobName}: ${a.folders.join(", ")}`).join("\n") : "") +
                        `\n\n${result.total} Drive folders scanned`;
                      alert(msg);
                      if(btn) btn.disabled = false;
                    } catch(e) { alert("Drive sync failed: " + e.message); }
                  }}
                  style={{background:"none",border:`1px solid ${C.blue}44`,borderRadius:8,
                    color:C.blue,fontSize:11,fontWeight:600,padding:"6px 12px",cursor:"pointer",
                    fontFamily:"inherit"}}>
                  Sync Drive
                </button>
                )}
                <button onClick={()=>{const j=blankJob();j.foreman="Unassigned";setJobs(js=>[j,...js]);setSelected(j);}}
                  style={{background:C.accent,border:"none",borderRadius:8,color:"#000",
                    fontSize:12,fontWeight:700,padding:"7px 16px",cursor:"pointer",
                    fontFamily:"inherit",boxShadow:`0 2px 8px ${C.accent}44`,letterSpacing:"0.02em"}}>
                  + New Job
                </button>
                <button onClick={()=>{const j=blankJob();j.foreman="Unassigned";j.tempPed=true;setJobs(js=>[j,...js]);setSelected(j);}}
                  style={{background:"#8b5cf6",border:"none",borderRadius:8,color:"#fff",
                    fontSize:12,fontWeight:700,padding:"7px 16px",cursor:"pointer",
                    fontFamily:"inherit",boxShadow:"0 2px 8px #8b5cf644",letterSpacing:"0.02em"}}>
                  + Temp Ped
                </button>
                <button onClick={()=>{const j=blankQuickJob();j.foreman="Unassigned";setJobs(js=>[j,...js]);setSelected(j);}}
                  style={{background:"#f97316",border:"none",borderRadius:8,color:"#fff",
                    fontSize:12,fontWeight:700,padding:"7px 16px",cursor:"pointer",
                    fontFamily:"inherit",boxShadow:"0 2px 8px #f9731644",letterSpacing:"0.02em"}}>
                  + Quick Job
                </button>
              </div>

            </div>
          </div>


          <div style={{padding:"28px 26px"}}>

            <div style={{fontSize:10,color:C.dim,fontWeight:800,letterSpacing:"0.14em",marginBottom:14,textTransform:"uppercase"}}>Pipeline Overview</div>

            {(()=>{

              const prepJobs = jobs.filter(j=>{const r=parseStage(j.roughStage);return r===0;});

              const nsJobs   = jobs.filter(j=>{const rs=j.roughStatus||"";return rs!==""&&parseStage(j.roughStage)===0&&!prepJobs.includes(j);});

              const roJobs   = jobs.filter(j=>{const r=parseStage(j.roughStage);const f=parseStage(j.finishStage);return r>0&&r<100&&f===0;});

              const btwJobs  = jobs.filter(j=>{const r=parseStage(j.roughStage);const f=parseStage(j.finishStage);return r===100&&f===0;});

              const finJobs  = jobs.filter(j=>{const f=parseStage(j.finishStage);return f>0&&f<100;});

              const donJobs  = jobs.filter(j=>(parseStage(j.finishStage))===100);

              return (

                <div style={{display:"flex",gap:8,marginBottom:24,flexWrap:"wrap"}}>

                  {[

                    [jobs.length,"Total",C.text,jobs],

                    [prepJobs.length,"Pre Job Prep",C.teal,prepJobs],

                    [nsJobs.length,"Not Started","#5a6480",nsJobs],

                    [roJobs.length,"Rough",C.rough,roJobs],

                    [btwJobs.length,"In Between",C.orange,btwJobs],

                    [finJobs.length,"Finish",C.finish,finJobs],

                    [donJobs.length,"Completed",C.green,donJobs],

                  ].map(([v,l,c,filt])=>(

                    <div key={l} onClick={()=>filt&&filt.length>0&&setStageModal({label:l,color:c,jobs:filt})}

                      style={{background:C.card,border:`1px solid ${c}33`,borderRadius:10,

                        padding:"10px 18px",display:"flex",gap:10,alignItems:"center",flex:"1 1 120px",

                        cursor:filt&&filt.length>0?"pointer":"default",transition:"transform 0.1s,box-shadow 0.1s"}}

                      onMouseEnter={e=>{if(filt&&filt.length>0){e.currentTarget.style.transform="translateY(-2px)";e.currentTarget.style.boxShadow=`0 6px 20px ${c}22`;}}}

                      onMouseLeave={e=>{e.currentTarget.style.transform="";e.currentTarget.style.boxShadow="";}}>

                      <span style={{fontFamily:"'Bebas Neue'",fontSize:28,color:c,lineHeight:1}}>{v}</span>

                      <span style={{fontSize:11,color:C.dim,lineHeight:1.3}}>{l}</span>

                    </div>

                  ))}

                </div>

              );

            })()}

            {stageModal&&(

              <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:200,

                display:"flex",alignItems:"flex-start",justifyContent:"center",padding:"40px 16px",overflowY:"auto"}}

                onClick={e=>{if(e.target===e.currentTarget)setStageModal(null);}}>

                <div style={{background:C.bg,borderRadius:16,width:"100%",maxWidth:700,

                  padding:24,boxShadow:"0 24px 64px rgba(0,0,0,0.4)"}}>

                  <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:20}}>

                    <div style={{width:10,height:10,borderRadius:"50%",background:stageModal.color}}/>

                    <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:24,

                      letterSpacing:"0.08em",color:stageModal.color}}>{stageModal.label}</div>

                    <div style={{background:`${stageModal.color}18`,border:`1px solid ${stageModal.color}33`,

                      borderRadius:99,padding:"2px 10px",fontSize:11,color:stageModal.color,fontWeight:700}}>

                      {stageModal.jobs.length} job{stageModal.jobs.length!==1?"s":""}

                    </div>

                    <button onClick={()=>setStageModal(null)}

                      style={{marginLeft:"auto",background:"none",border:`1px solid ${C.border}`,

                        borderRadius:8,color:C.dim,fontSize:18,width:32,height:32,cursor:"pointer"}}>✕</button>

                  </div>

                  {stageModal.jobs.map(job=>(

                    <JobRow key={job.id} job={job} showForeman={true}/>

                  ))}

                </div>

              </div>

            )}

            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))",gap:10,marginBottom:40,alignItems:"start"}}>

              {_foremen.map(f=>{
                const fc    = getPersonColor(f);
                const fJobs = jobs.filter(j=>matchesForeman(j,f));
                const fCOs  = fJobs.reduce((a,j)=>a+(j.changeOrders||[]).filter(c=>c.coStatus!=="completed"&&c.coStatus!=="denied"&&c.coStatus!=="converted").length,0);
                const fRT   = fJobs.filter(j=>(j.returnTrips||[]).some(r=>!r.signedOff&&(r.scope||r.date))).length;
                const rAvg  = fJobs.length ? Math.round(fJobs.reduce((a,j)=>a+parseStage(j.roughStage),0)/fJobs.length) : 0;
                const fnAvg = fJobs.length ? Math.round(fJobs.reduce((a,j)=>a+parseStage(j.finishStage),0)/fJobs.length) : 0;
                return (
                  <div key={f}>
                    {/* Main card */}
                    <div className="foreman-card" onClick={()=>openForeman(f)}
                      style={{background:C.card,border:`1px solid ${fc}33`,borderRadius:12,
                        padding:"14px 16px",borderTop:`3px solid ${fc}`}}>
                      {/* Name + count */}
                      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
                        <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:22,letterSpacing:"0.06em",color:fc,lineHeight:1}}>{f}</div>
                        <div style={{background:`${fc}18`,border:`1px solid ${fc}33`,borderRadius:99,
                          padding:"2px 9px",fontSize:10,color:fc,fontWeight:700}}>
                          {fJobs.length}
                        </div>
                      </div>
                      {/* Stats row */}
                      <div style={{display:"flex",gap:6,marginBottom:10,flexWrap:"wrap"}}>
                        {[[fCOs,"COs",fCOs>0?C.blue:C.muted],[fRT,"RTs",fRT>0?"#dc2626":C.muted]].map(([v,l,col])=>(
                          <div key={l} style={{background:C.surface,borderRadius:7,padding:"5px 8px",flex:1,minWidth:44}}>
                            <div style={{fontFamily:"'Bebas Neue'",fontSize:18,color:col,lineHeight:1}}>{v}</div>
                            <div style={{fontSize:9,color:C.dim,marginTop:1}}>{l}</div>
                          </div>
                        ))}
                      </div>
                      {/* Rough / Finish progress bars */}
                      <div style={{display:"flex",gap:6,marginTop:8}}>
                        <div style={{flex:1}}>
                          <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
                            <span style={{fontSize:9,color:C.dim}}>Rough</span>
                            <span style={{fontSize:9,color:C.rough,fontWeight:600}}>{rAvg}%</span>
                          </div>
                          <div style={{height:4,background:`${C.rough}22`,borderRadius:4,overflow:"hidden"}}>
                            <div style={{height:"100%",width:`${rAvg}%`,background:C.rough,borderRadius:4,transition:"width 0.3s"}}/>
                          </div>
                        </div>
                        <div style={{flex:1}}>
                          <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
                            <span style={{fontSize:9,color:C.dim}}>Finish</span>
                            <span style={{fontSize:9,color:C.finish,fontWeight:600}}>{fnAvg}%</span>
                          </div>
                          <div style={{height:4,background:`${C.finish}22`,borderRadius:4,overflow:"hidden"}}>
                            <div style={{height:"100%",width:`${fnAvg}%`,background:C.finish,borderRadius:4,transition:"width 0.3s"}}/>
                          </div>
                        </div>
                      </div>

                      <div style={{marginTop:10,fontSize:10,color:fc,fontWeight:600,textAlign:"right",opacity:0.7}}>View →</div>
                    </div>
                    {/* Crew Access */}
                    <div onClick={e=>{e.stopPropagation();setCrewView(f);}}
                      style={{marginTop:4,background:C.surface,border:`1px dashed ${fc}44`,
                        borderRadius:8,padding:"6px 12px",cursor:"pointer",
                        display:"flex",alignItems:"center",justifyContent:"space-between",
                        transition:"background 0.15s"}}
                      onMouseEnter={e=>e.currentTarget.style.background=`${fc}10`}
                      onMouseLeave={e=>e.currentTarget.style.background=C.surface}>
                      <span style={{fontSize:10,fontWeight:600,color:C.dim}}>Crew Access</span>
                      <span style={{fontSize:9,color:C.dim,opacity:0.5}}>→</span>
                    </div>
                  </div>
                );
              })}

              {/* Unassigned */}
              {(()=>{
                const fc    = "#6b7280";
                const uJobs = jobs.filter(j=>!j.foreman||j.foreman==="Unassigned");
                const uCOs  = uJobs.reduce((a,j)=>a+(j.changeOrders||[]).filter(c=>c.coStatus!=="completed"&&c.coStatus!=="denied"&&c.coStatus!=="converted").length,0);
                return (
                  <div>
                    <div className="foreman-card" onClick={()=>openForeman("Unassigned")}
                      style={{background:C.card,border:`1px solid ${fc}33`,borderRadius:12,
                        padding:"14px 16px",borderTop:`3px solid ${fc}`}}>
                      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
                        <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:22,letterSpacing:"0.06em",color:fc,lineHeight:1}}>Unassigned</div>
                        <div style={{background:`${fc}18`,border:`1px solid ${fc}33`,borderRadius:99,
                          padding:"2px 9px",fontSize:10,color:fc,fontWeight:700}}>
                          {uJobs.length}
                        </div>
                      </div>
                      <div style={{display:"flex",gap:6,marginBottom:10}}>
                        <div style={{background:C.surface,borderRadius:7,padding:"5px 8px",flex:1}}>
                          <div style={{fontFamily:"'Bebas Neue'",fontSize:18,color:uCOs>0?C.blue:C.muted,lineHeight:1}}>{uCOs}</div>
                          <div style={{fontSize:9,color:C.dim,marginTop:1}}>COs</div>
                        </div>
                      </div>
                      <div style={{fontSize:10,color:fc,fontWeight:600,textAlign:"right",opacity:0.7}}>View →</div>
                    </div>
                  </div>

                );

              })()}

            </div>


            {/* ── CREW VIEW MODAL ── */}
            {crewView&&(
              <div style={{position:"fixed",inset:0,background:C.bg,zIndex:300,
                display:"flex",flexDirection:"column",overflowY:"auto"}}>

                {/* Crew header */}
                <div style={{background:C.card,borderBottom:`1px solid ${C.border}`,
                  padding:"14px 18px",position:"sticky",top:0,zIndex:10,display:"flex",
                  alignItems:"center",justifyContent:"space-between",gap:12}}>
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:22,
                      letterSpacing:"0.08em",color:_foremanColors[crewView]||"#6b7280"}}>
                      {crewView} — Jobs
                    </div>
                    <div style={{background:`${_foremanColors[crewView]||"#6b7280"}18`,
                      border:`1px solid ${_foremanColors[crewView]||"#6b7280"}33`,
                      borderRadius:99,padding:"2px 10px",fontSize:11,
                      color:_foremanColors[crewView]||"#6b7280",fontWeight:700}}>
                      {jobs.filter(j=>matchesForeman(j,crewView)).length} jobs
                    </div>
                  </div>
                  <button onClick={()=>setCrewView(null)}
                    style={{background:"none",border:`1px solid ${C.border}`,borderRadius:8,
                      color:C.dim,fontSize:16,width:34,height:34,cursor:"pointer",
                      display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
                </div>

                {/* Search within crew view */}
                <div style={{padding:"10px 18px 0"}}>
                  <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search jobs…"
                    style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,color:C.text,
                      padding:"7px 12px",fontSize:12,fontFamily:"inherit",outline:"none",width:"100%",maxWidth:300}}/>
                </div>

                {/* Lead-grouped job cards */}
                {(()=>{
                  const s = search.toLowerCase();
                  const crewJobs = jobs.filter(j=>matchesForeman(j,crewView)).filter(j=>
                    !s||(j.name||"").toLowerCase().includes(s)||(j.address||"").toLowerCase().includes(s)||(j.gc||"").toLowerCase().includes(s)
                  );
                  const fc2 = _foremanColors[crewView]||"#6b7280";
                  if(crewJobs.length===0) return (
                    <div style={{textAlign:"center",color:C.dim,padding:"60px 0",fontSize:13}}>
                      {search ? "No matching jobs" : `No jobs assigned to ${crewView}`}
                    </div>
                  );
                  // Group by lead — jobs with no lead go under "Unassigned"
                  const leadMap = {};
                  crewJobs.forEach(j=>{
                    const lead = j.lead||"";
                    if(!leadMap[lead]) leadMap[lead]=[];
                    leadMap[lead].push(j);
                  });
                  // Sort: named leads alphabetically, unassigned last
                  const leadKeys = Object.keys(leadMap).sort((a,b)=>{
                    if(!a) return 1; if(!b) return -1;
                    return a.localeCompare(b);
                  });
                  return (
                    <div style={{padding:"16px 16px 60px",maxWidth:700,width:"100%",margin:"0 auto"}}>
                      {leadKeys.map(lead=>(
                        <div key={lead||"__none"} style={{marginBottom:28}}>
                          {/* Lead header */}
                          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12,
                            paddingBottom:8,borderBottom:`2px solid ${lead?fc2+"55":C.border}`}}>
                            <div style={{width:30,height:30,borderRadius:"50%",
                              background:lead?fc2+"22":C.surface,
                              border:`2px solid ${lead?fc2+"66":C.border}`,
                              display:"flex",alignItems:"center",justifyContent:"center",
                              fontSize:13,fontWeight:800,color:lead?fc2:C.dim,flexShrink:0}}>
                              {lead?lead[0].toUpperCase():"?"}
                            </div>
                            <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:20,
                              letterSpacing:"0.06em",color:lead?fc2:C.dim}}>
                              {lead||"No Lead Assigned"}
                            </div>
                            <div style={{background:lead?fc2+"18":C.surface,
                              border:`1px solid ${lead?fc2+"33":C.border}`,
                              borderRadius:99,padding:"2px 9px",fontSize:10,
                              color:lead?fc2:C.dim,fontWeight:700}}>
                              {leadMap[lead].length} job{leadMap[lead].length!==1?"s":""}
                            </div>
                          </div>
                          {/* Jobs under this lead */}
                          {leadMap[lead].map(job=>(
                            job.quickJob
                              ? <QuickJobCard key={job.id} job={job} onOpen={(j)=>setSelected(j)} onUpdate={(updated,patch)=>{ setJobs(js=>js.map(j=>j.id===updated.id?updated:j)); saveJob(updated,patch); }}/>
                              : job.tempPed
                              ? <TempPedCard key={job.id} job={job} onOpen={(j)=>setSelected(j)} onUpdate={(updated,patch)=>{ setJobs(js=>js.map(j=>j.id===updated.id?updated:j)); saveJob(updated,patch); }}/>
                              : <JobRow key={job.id} job={job} fc={fc2} showForeman={false}/>
                          ))}
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
            )}

            {/* ── ALL JOBS BY SECTION ── */}
            <div style={{padding:"0 26px 32px"}}>
              <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:22,letterSpacing:"0.08em",
                color:C.dim,marginBottom:16,marginTop:32,paddingTop:24,borderTop:`1px solid ${C.border}`}}>
                ALL JOBS
              </div>
              <div style={{display:"flex",gap:8,marginBottom:16,flexWrap:"wrap",alignItems:"center"}}>
                <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search jobs, GC, address…"
                  style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,color:C.text,
                    padding:"7px 12px",fontSize:12,fontFamily:"inherit",outline:"none",width:220}}/>
                {search&&<button onClick={()=>setSearch("")}
                  style={{background:"none",border:`1px solid ${C.border}`,borderRadius:8,color:C.dim,
                    padding:"6px 10px",fontSize:11,cursor:"pointer",fontFamily:"inherit"}}>Clear</button>}
              </div>
              {(()=>{
                const s = search.toLowerCase();
                const homeFiltered = s ? jobs.filter(j=>
                  (j.name||"").toLowerCase().includes(s)||
                  (j.address||"").toLowerCase().includes(s)||
                  (j.gc||"").toLowerCase().includes(s)||
                  (j.foreman||"").toLowerCase().includes(s)||
                  (j.simproNo||"").toLowerCase().includes(s)
                ) : jobs;
                return <StageSectionList jobs={homeFiltered} JobRow={JobRow} TempPedCard={TempPedCard} onSelectJob={(j)=>setSelected(j)} onSaveJob={(updated,patch)=>{ setJobs(js=>js.map(j=>j.id===updated.id?updated:j)); saveJob(updated,patch); }} onDeleteJob={(id)=>deleteJob(id)} startCollapsed={true}/>;
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

              <div style={{width:10,height:10,borderRadius:"50%",background:_foremanColors[activeForeman]||"#6b7280",flexShrink:0}}/>

              <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:28,letterSpacing:"0.06em",

                color:_foremanColors[activeForeman]||"#6b7280",lineHeight:1}}>{activeForeman}</div>

              <div style={{fontSize:11,color:C.dim}}>

                {jobs.filter(j=>activeForeman==="Unassigned"?(!j.foreman||j.foreman==="Unassigned"):matchesForeman(j,activeForeman)).length} job sites

              </div>

              <div style={{marginLeft:"auto",display:"flex",gap:8,alignItems:"center"}}>

                <span style={{fontSize:11,color:syncColor}}>{syncLabel}</span>

                <button onClick={()=>{const j=blankJob();j.foreman=activeForeman;setJobs(js=>[j,...js]);setSelected(j);}}

                  style={{background:_foremanColors[activeForeman]||"#6b7280",border:"none",borderRadius:9,color:"#000",

                    fontWeight:700,padding:"9px 20px",fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>

                  + New Job

                </button>

              </div>

            </div>


            <div style={{display:"flex",gap:10,marginBottom:16,flexWrap:"wrap"}}>

              {(()=>{

                const fJobs = jobs.filter(j=>activeForeman==="Unassigned"?(!j.foreman||j.foreman==="Unassigned"):matchesForeman(j,activeForeman));

                const fDone = fJobs.filter(j=>parseStage(j.finishStage)===100).length;

                const fPrep    = fJobs.filter(j=>{const r=parseStage(j.roughStage);return r===0;}).length;

                const fRough   = fJobs.filter(j=>parseInt(j.roughStage)>0&&parseInt(j.roughStage)<100&&parseInt(j.finishStage)===0).length;

                const fBetween = fJobs.filter(j=>parseInt(j.roughStage)===100&&parseInt(j.finishStage)===0).length;

                const fFinish  = fJobs.filter(j=>parseInt(j.finishStage)>0&&parseInt(j.finishStage)<100).length;

                const fNotStarted = fJobs.filter(j=>{const rs=j.roughStatus||"";return rs!==""&&parseStage(j.roughStage)===0;}).length - fPrep;

                return [[fJobs.length,"Total Jobs",C.blue],

                  [fPrep,"Pre Job Prep",C.teal],

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

            {/* ── Jobs | Tasks tab bar ── */}
            {(()=>{
              const isKoy = activeForeman === "Koy";
              const fTasks = computeTasks(jobs)
                .filter(t=>t.foreman===activeForeman && t.category!=="prep")
                .concat((manualTasks||[]).filter(t=>t.foreman===activeForeman));
              const prepTasks = computeTasks(jobs).filter(t=>t.foreman==="Koy"&&t.category==="prep");
              const taskCount = isKoy ? fTasks.length + prepTasks.length : fTasks.length;
              const fc = _foremanColors[activeForeman]||"#6b7280";
              return (
                <div style={{display:"flex",gap:0,borderBottom:`2px solid ${C.border}`,marginTop:8}}>
                  {[["jobs","Jobs"],["tasks",`Tasks${taskCount>0?` (${taskCount})`:""}`]].map(([key,label])=>(
                    <button key={key} onClick={()=>setForemanViewTab(key)}
                      style={{background:"none",border:"none",borderBottom:foremanViewTab===key?`2px solid ${fc}`:"2px solid transparent",
                        color:foremanViewTab===key?fc:C.dim,fontSize:13,fontWeight:foremanViewTab===key?700:500,
                        padding:"10px 20px",cursor:"pointer",fontFamily:"inherit",marginBottom:-2,
                        letterSpacing:"0.02em"}}>
                      {label}
                    </button>
                  ))}
                </div>
              );
            })()}

          </div>

          {/* ── JOBS TAB ── */}
          {foremanViewTab==="jobs"&&(
            <div>
              <div style={{padding:"14px 26px 0"}}>
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

              <div style={{padding:"0 26px 14px"}}>
                {filtered.length===0?(
                  <div style={{textAlign:"center",padding:"60px 0",color:C.muted}}>
                    <div style={{fontSize:13,marginBottom:20}}>No jobs yet for {activeForeman}</div>
                    <button onClick={()=>{const j=blankJob();j.foreman=activeForeman;setJobs(js=>[j,...js]);setSelected(j);}}
                      style={{background:_foremanColors[activeForeman]||"#6b7280",border:"none",borderRadius:9,color:"#000",
                        fontWeight:700,padding:"10px 24px",fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>
                      + Add First Job
                    </button>
                  </div>
                ):(
                  <>
                  <StageSectionList jobs={filtered} JobRow={JobRow} TempPedCard={TempPedCard} onSelectJob={(j)=>setSelected(j)} onSaveJob={(updated,patch)=>{ setJobs(js=>js.map(j=>j.id===updated.id?updated:j)); saveJob(updated,patch); }} onDeleteJob={(id)=>deleteJob(id)} fc={_foremanColors[activeForeman]} startCollapsed={false}/>
              {(()=>{
                const invoiceJobs = filtered.filter(j=>effRS(j)==="invoice"||effFS(j)==="invoice");
                return invoiceJobs.length>0?(
                  <div style={{marginTop:8,marginBottom:20}}>
                    <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8,padding:"10px 14px",
                      background:"rgba(234,88,12,0.08)",border:"1px solid rgba(234,88,12,0.3)",
                      borderRadius:10}}>
                      <div style={{width:10,height:10,borderRadius:"50%",background:"#ea580c",flexShrink:0}}/>
                      <div style={{fontSize:12,fontWeight:700,color:"#ea580c",letterSpacing:"0.04em",flex:1}}>
                        READY TO INVOICE
                      </div>
                      <div style={{fontSize:11,color:"#ea580c",fontWeight:600,
                        background:"rgba(234,88,12,0.15)",borderRadius:99,padding:"2px 8px"}}>
                        {invoiceJobs.length}
                      </div>
                    </div>
                    {invoiceJobs.map(job=>(
                      <div key={job.id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,marginBottom:6}}>
                        <div style={{flex:1}}><JobRow job={job}/></div>
                        <button onClick={()=>{ const patch=invoiceSentPatch(job); updateJob({...job,...patch},patch); }}
                          style={{flexShrink:0,fontSize:11,fontWeight:700,color:"#fff",background:"#ea580c",
                            border:"none",borderRadius:7,padding:"5px 12px",cursor:"pointer",fontFamily:"inherit",whiteSpace:"nowrap"}}>
                          ✓ Invoice Sent
                        </button>
                      </div>
                    ))}
                  </div>
                ):null;
              })()}
              </>

            )}

          </div>
          </div>
          )}

          {/* ── TASKS TAB ── */}
          {foremanViewTab==="tasks"&&(
            <div style={{padding:"14px 26px"}}>
              {(()=>{
                const isKoy = activeForeman === "Koy";
                const fTasks = computeTasks(jobs)
                  .filter(t=>t.foreman===activeForeman && t.category!=="prep")
                  .concat((manualTasks||[]).filter(t=>t.foreman===activeForeman));
                const prepTasks = computeTasks(jobs).filter(t=>t.foreman==="Koy"&&t.category==="prep");
                return (
                  <ForemanTaskCard
                    isKoy={isKoy}
                    fTasks={fTasks}
                    prepTasks={prepTasks}
                    jobs={jobs}
                    manualTasks={manualTasks}
                    onManualTasksChange={(next)=>{ next.forEach(t=>{ if(!manualTasks.find(m=>m.id===t.id)) saveManualTask(t); }); manualTasks.forEach(t=>{ if(!next.find(m=>m.id===t.id)) deleteManualTask(t.id); }); setManualTasks(next); }}
                    onSelectJob={(job)=>setSelected(job)}
                    onUpdateJob={(jobId,patch)=>{ const job=jobs.find(j=>j.id===jobId); if(job) updateJob({...job,...patch},patch); }}
                    activeForeman={activeForeman}
                    foremenList={_foremen}
                  />
                );
              })()}
            </div>
          )}

        </div>

      )}


      {selected&&(selected.quickJob
        ? <QuickJobDetail key={selected.id} job={selected} onUpdate={updateJob} onClose={()=>{flushJob(selected);setSelected(null);}} foremenList={_foremen} leadsList={_leads}/>
        : selected.tempPed
        ? <TempPedDetail key={selected.id} job={selected} onUpdate={updateJob} onClose={()=>{flushJob(selected);setSelected(null);}} foremenList={_foremen}/>
        : <JobDetail key={selected.id} job={selected} onUpdate={updateJob} onClose={()=>{flushJob(selected);setSelected(null);}} foremenList={_foremen} leadsList={_leads}/>)}

      {/* ── SUBCONTRACTORS TAB ── */}
      {view==="subcontractors"&&(()=>{
        // Which contractors to show: contractors see only themselves; admins see all
        const visibleContractors = isContractor
          ? contractorUsers.filter(u=>(u.name||"").toLowerCase()===(identity.name||"").toLowerCase())
          : contractorUsers;

        if(visibleContractors.length===0) return (
          <div style={{textAlign:"center",padding:"60px 0",color:C.dim}}>
            <div style={{fontSize:22,marginBottom:8}}>👷</div>
            <div style={{fontSize:14,fontWeight:600,marginBottom:6}}>No subcontractors yet</div>
            <div style={{fontSize:12}}>Add a user with "Contractor" access in Settings, then assign jobs to them.</div>
          </div>
        );

        return (
          <div>
            {visibleContractors.map(contractor => {
              const cColor = getFC(contractor.name) || "#6b7280";
              const cJobs = jobs.filter(j =>
                !j.tempPed &&
                (j.foreman||"").toLowerCase() === (contractor.name||"").toLowerCase()
              );
              const firstName = contractor.name.split(" ")[0];

              return (
                <div key={contractor.id}>
                  {/* Section header */}
                  <div style={{padding:"18px 26px 0",borderBottom:`1px solid ${C.border}`}}>
                    <div style={{display:"flex",alignItems:"center",gap:14,marginBottom:16,flexWrap:"wrap"}}>
                      <div style={{width:10,height:10,borderRadius:"50%",background:cColor,flexShrink:0}}/>
                      <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:28,letterSpacing:"0.06em",
                        color:cColor,lineHeight:1}}>{contractor.name}</div>
                      <div style={{fontSize:11,color:C.dim}}>{cJobs.length} job{cJobs.length!==1?"s":""}</div>
                      {!isContractor&&(
                        <div style={{marginLeft:"auto",display:"flex",gap:8,alignItems:"center"}}>
                          <span style={{fontSize:11,color:syncColor}}>{syncLabel}</span>
                          <button onClick={()=>{const j=blankJob();j.foreman=contractor.name;setJobs(js=>[j,...js]);setSelected(j);}}
                            style={{background:cColor,border:"none",borderRadius:9,color:"#fff",
                              fontWeight:700,padding:"9px 20px",fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>
                            + New Job
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Job list */}
                  <div style={{padding:"14px 26px"}}>
                    {cJobs.length===0 ? (
                      <div style={{textAlign:"center",padding:"40px 0",color:C.dim}}>
                        <div style={{fontSize:13,marginBottom:16}}>No jobs assigned to {firstName} yet</div>
                        {!isContractor&&(
                          <button onClick={()=>{const j=blankJob();j.foreman=contractor.name;setJobs(js=>[j,...js]);setSelected(j);}}
                            style={{background:cColor,border:"none",borderRadius:9,color:"#fff",
                              fontWeight:700,padding:"10px 24px",fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>
                            + Assign First Job
                          </button>
                        )}
                      </div>
                    ) : (
                      <StageSectionList
                        jobs={cJobs}
                        JobRow={JobRow}
                        TempPedCard={TempPedCard}
                        onSelectJob={(j)=>setSelected(j)}
                        onSaveJob={(updated,patch)=>{ setJobs(js=>js.map(j=>j.id===updated.id?updated:j)); saveJob(updated,patch); }}
                        onDeleteJob={isContractor?null:(id)=>deleteJob(id)}
                        fc={cColor}
                        startCollapsed={false}
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })()}

      {view==="schedule"&&can(identity,"schedule.view")&&(
        <SchedulingForecast jobs={jobs} canEdit={can(identity,"schedule.edit")} onSelectJob={(job)=>setSelected(job)} foremenList={_foremen}/>
      )}

      {view==="tasks"&&can(identity,"tasks.view")&&(
        <Tasks
          jobs={jobs}
          manualTasks={manualTasks}
          onManualTasksChange={(next)=>{
            next.forEach(t=>{ if(!manualTasks.find(m=>m.id===t.id)) saveManualTask(t); });
            manualTasks.forEach(t=>{ if(!next.find(m=>m.id===t.id)) deleteManualTask(t.id); });
            setManualTasks(next);
          }}
          onSelectJob={(job)=>setSelected(job)}
          onUpdateJob={(jobId,patch)=>{ const job=jobs.find(j=>j.id===jobId); if(job) updateJob({...job,...patch},patch); }}
          foremenList={_foremen}
        />
      )}

      {view==="upcoming"&&can(identity,"pipeline.view")&&(
        <UpcomingJobs
          upcoming={upcoming}
          canManage={can(identity,"pipeline.manage")}
          foremenList={_foremen}
          onChange={(next)=>{
            next.forEach(item=>{
              const prev=upcoming.find(u=>u.id===item.id);
              if(!prev||JSON.stringify(prev)!==JSON.stringify(item)) saveUpcomingItem(item);
            });
            upcoming.forEach(item=>{ if(!next.find(u=>u.id===item.id)) deleteUpcomingItem(item.id); });
            setUpcoming(next);
          }}
          onPromote={(u)=>{
            const j=blankJob();
            j.name=u.name||""; j.address=u.city||""; j.gc=u.customer||""; j.foreman=u.foreman||"Unassigned";
            setJobs(js=>[j,...js]); setSelected(j); setUpcoming(prev=>prev.filter(x=>x.id!==u.id));
            setView("home"); saveJob(j); deleteUpcomingItem(u.id);
          }}
        />
      )}

      {view==="settings"&&can(identity,"settings.view")&&(
        <div>
          <BulkEditTable jobs={jobs} foremenList={_foremen} leadsList={_leads} onUpdateJob={updateJob}/>
          <div style={{height:1,background:C.border,margin:"0 26px"}}/>
          <ActivityLog jobs={jobs}/>
          <div style={{height:1,background:C.border,margin:"0 26px"}}/>
          <SettingsPage
            COLOR_OPTIONS={COLOR_OPTIONS}
            users={users}
            colorOverrides={_colorOverrides}
            onSave={saveSettings}
            jobs={jobs}
            upcoming={upcoming}
            manualTasks={manualTasks}
            onRestoreFromBackup={async()=>{
              try {
                const b=localStorage.getItem('hejobs_backup');
                if(!b){alert('No backup found in localStorage');return 0;}
                const backupJobs=JSON.parse(b);
                if(!backupJobs||!backupJobs.length){alert('Backup is empty');return 0;}
                for(const job of backupJobs){
                  await setDoc(doc(db,"jobs",job.id),{data:sanitize(job),updated_at:new Date().toISOString()});
                }
                return backupJobs.length;
              }catch(e){console.error('Restore failed:',e);alert('Restore failed: '+e.message);return 0;}
            }}
            onRestoreFromFile={async(jobsArr)=>{
              try {
                if(!jobsArr||!jobsArr.length){alert('No jobs in file');return 0;}
                const ts = new Date().toISOString();
                for(const job of jobsArr){
                  if(job.foreman) job.foreman = normalizeName(job.foreman);
                  if(job.lead) job.lead = normalizeName(job.lead);
                  const clean=Object.fromEntries(Object.entries(job).filter(([,v])=>v!==undefined));
                  await setDoc(doc(db,"jobs",job.id),{data:clean,updated_at:ts});
                }
                // Bump version to force ALL other clients to reload (picks up new code + fresh data)
                await setDoc(doc(db,"config","app"),{version:"restore-"+Date.now()});
                return jobsArr.length;
              }catch(e){console.error('File restore failed:',e);alert('Restore failed: '+e.message);return 0;}
            }}
          />
          {can(identity,"users.manage")&&(
            <div style={{padding:"0 26px 40px"}}>
              <div style={{borderTop:`1px solid ${C.border}`,paddingTop:32,marginTop:8}}>
                <UserManagement users={users} onSave={saveUsers}/>
              </div>
            </div>
          )}
        </div>
      )}

    </div>

  );

}

export default App;
