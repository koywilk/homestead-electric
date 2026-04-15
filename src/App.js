// BUILD_v9_FIXED
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { initializeApp } from "firebase/app";
import { getFirestore, doc, setDoc, updateDoc, deleteDoc, getDoc, collection, getDocs, onSnapshot, arrayUnion } from "firebase/firestore";
import { getStorage, ref, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";
import { getMessaging, getToken, onMessage } from "firebase/messaging";
import { getFunctions, httpsCallable } from "firebase/functions";

// ── FCM setup ─────────────────────────────────────────────────────────────────
// VAPID key — generate in Firebase Console → Project Settings → Cloud Messaging
// → Web Push certificates → Generate key pair, then paste it here.
const VAPID_KEY = "BH3basT0whtC0V2OkJ0vdbcGBvPC1W5Qo6hqFMr1Hg0KX07Vvj_wtuiMDlcf28wp5x0dN8s0Frep7Tnr1xlujuc";


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

const db        = getFirestore(firebaseApp);
const storage   = getStorage(firebaseApp);
const messaging = ("serviceWorker" in navigator) ? getMessaging(firebaseApp) : null;
const functions = getFunctions(firebaseApp);

/**
 * Request notification permission, get FCM token, and save it to the user's
 * record in Firestore (settings/users → list[].fcmTokens).
 * Tokens are stored as an array so every device the user logs in on gets
 * notifications. Capped at 10 tokens to avoid unbounded growth.
 * Called once after the user selects their identity at login.
 */
async function registerFCMToken(userId) {
  if (!messaging || !VAPID_KEY || VAPID_KEY === "PASTE_YOUR_VAPID_KEY_HERE") return;
  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return;
    const token = await getToken(messaging, { vapidKey: VAPID_KEY });
    if (!token) return;
    const snap = await getDoc(doc(db, "settings", "users"));
    if (!snap.exists()) return;
    const list = (snap.data().list || []).map(u => {
      if (u.id !== userId) return u;
      // Collect all existing tokens (support legacy single-token field)
      const existing = Array.isArray(u.fcmTokens) ? u.fcmTokens
        : u.fcmToken ? [u.fcmToken] : [];
      // Add new token if not already present, cap at 10
      const merged = existing.includes(token) ? existing : [...existing, token];
      return { ...u, fcmTokens: merged.slice(-10) };
    });
    await setDoc(doc(db, "settings", "users"), { list });
  } catch (e) {
    console.warn("[HE] FCM registration skipped:", e.message);
  }
}

// Handle foreground messages (app is open) — show a brief alert-style banner.
// Reads from payload.data since we send data-only messages to prevent double notifications.
// Also forwards jobId + section so the toast can deep-link on tap.
if (messaging) {
  onMessage(messaging, payload => {
    const title   = payload.data?.title   || payload.notification?.title;
    const body    = payload.data?.body    || payload.notification?.body;
    const jobId   = payload.data?.jobId   || "";
    const section = payload.data?.section || "";
    if (title || body) {
      const ev = new CustomEvent("he-push", { detail: { title, body, jobId, section } });
      window.dispatchEvent(ev);
    }
  });
}
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
  {value:"waiting_date",label:"Awaiting Start Date",                  color:"#ca8a04"},
  {value:"date_confirmed",label:"Start Date Set",                     color:"#f97316", hasDate:true},
  {value:"scheduled",  label:"Scheduled",                            color:"#2563eb", hasDate:true},
  {value:"inprogress", label:"In Progress",                          color:"#7dd3fc", hasDate:true},
  {value:"waiting",    label:"On Hold",                              color:"#ca8a04", dashed:true},
  {value:"complete",   label:"Complete",                             color:"#22c55e"},
];
const FINISH_STATUSES = ROUGH_STATUSES;
const CO_STATUSES_NEW = [
  {value:"needs_sending", label:"Needs to be Sent",       color:"#dc2626"},
  {value:"simpro_task",   label:"Task Made in SimPro",     color:"#f97316"},
  {value:"pending",       label:"Sent — Pending Approval", color:"#ca8a04"},
  {value:"approved",      label:"Approved",                color:"#16a34a"},
  {value:"scheduled",     label:"Scheduled",               color:"#2563eb", hasDate:true},
  {value:"completed",     label:"Work Completed",          color:"#22c55e"},
  {value:"converted",     label:"Converted to RT",         color:"#6b7280"},
  {value:"denied",        label:"Denied",                  color:"#dc2626"},
];
const RT_STATUSES = [
  {value:"",          label:"— set status —",        color:null},
  {value:"needs",     label:"Needs to be Scheduled", color:"#dc2626"},
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
const MATTERPORT_STATUSES = [
  {value:"",          label:"— set status —",           color:null},
  {value:"needs",     label:"Needs to be Scheduled",    color:"#dc2626", hasDate:true},
  {value:"scheduled", label:"Scan Scheduled",           color:"#2563eb", hasDate:true},
  {value:"complete",  label:"Scan Complete",            color:"#22c55e"},
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
const PREP_CHECKLIST_ITEMS = [
  {key:"redlinePlans",   label:"Redline Plans Up to Date"},
  {key:"cabinetPlans",   label:"Cabinet Plans Received"},
  {key:"applianceSpecs", label:"Appliance Specs Received"},
  {key:"plansUploaded",  label:"Plans Uploaded to App & SimPro"},
  {key:"readyToHandOff", label:"Ready to Hand Off to Foreman"},
];
const allPrepDone = (job) => {
  if (job.prepChecklist) {
    const c = job.prepChecklist;
    return !!(c.redlinePlans && c.cabinetPlans && c.applianceSpecs && c.plansUploaded && c.readyToHandOff);
  }
  return (job.prepStage||"") === "Job Prep Complete";
};

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

const C4_MODULE_TYPES   = ["","8-Ch Dimmer","8-Ch Relay","0-10V Dimmer"];
const LUT_MODULE_TYPES  = ["","LQSE-2ECO","LQSE-4A","LQSE-S8","LQSE-T5","LQSE-2DAL"];
const CRES_MODULE_TYPES = ["","ZUMNET-200","ZUMLINK-200"];
const SAV_MODULE_TYPES  = ["","LMD-8120","LMD-4120","SPM-Q2APD10","SPM-Q4FHD10"];
const LOAD_TYPES        = ["","Dimming","Switching","MLV","ELV","LED","Fluorescent","Relay","0-10V"];
const PHASE_OPTS        = ["","A","B","C"];

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

const newCP4Row    = (num) => ({ id:uid(), num, name:"", moduleType:"", mod:"", ch:"", loadType:"", watts:"", keypad:"", bus:"", pdu:"", chainPos:"", panel:"", breaker:"", phase:"", status:"" });

const newLoadRow   = (num) => ({ id:uid(), num, name:"", ch:"", loadType:"", watts:"", keypad:"", pulled:false });

const newModuleObj = (modNum) => ({ id:uid(), modNum:String(modNum), moduleType:"", panel:"", breaker:"", phase:"", bus:"", pdu:"", chainPos:"", loads:[newLoadRow(1)] });

// Migrates old flat-row format → new module-block format (safe to run on already-migrated data)
const migrateFloorToModules = (arr) => {
  if (!arr || arr.length===0) return [];
  if (arr[0]?.loads !== undefined) return arr; // already new format
  const map={}, order=[];
  arr.forEach(r=>{
    const key = r.mod||r.module||"1";
    if(!map[key]){
      map[key]={ id:uid(), modNum:key, moduleType:r.moduleType||"", panel:r.panel||"", breaker:r.breaker||"", phase:r.phase||"", bus:r.bus||"", pdu:r.pdu||"", chainPos:r.chainPos||"", loads:[] };
      order.push(key);
    }
    if(r.name||r.ch) map[key].loads.push({ id:r.id||uid(), num:map[key].loads.length+1, name:r.name||"", ch:r.ch||"", loadType:r.loadType||"", watts:r.watts||"", keypad:r.keypad||"", pulled:r.status==="Pulled"||r.pulled||false });
  });
  return order.map(k=>({ ...map[k], loads: map[k].loads.length ? map[k].loads : [newLoadRow(1)] }));
};

const newKPRow         = (num) => ({ id:uid(), num, name:"", status:"" });
const newCentralLoad   = ()    => ({ id:uid(), name:"", location:"", loadType:"", watts:"", pulled:false });

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
  "quotes.view":     ["admin","manager","standard"],
  "quotes.convert":  ["admin"],
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
// ── Notification preferences ──────────────────────────────────
const NOTIF_CATEGORIES = [
  { label:"Job Assignments", items:[
    { key:"job_assigned",      label:"Job assigned to you",                  roles:["foreman","lead","crew"] },
    { key:"lead_assigned",     label:"Lead assigned to job",                 roles:["admin","manager","foreman"] },
    { key:"quote_converted",   label:"Quote converted to job",               roles:["admin","manager"] },
  ]},
  { label:"Job Status", items:[
    { key:"ready_invoice",     label:"Ready to invoice",                     roles:["admin","manager","foreman"] },
    { key:"prep_complete",     label:"Job prep complete",                    roles:["admin","manager","foreman"] },
  ]},
  { label:"QC & Inspections", items:[
    { key:"qc_ready",          label:"QC walk ready to schedule",            roles:["admin","manager"] },
    { key:"qc_passed",         label:"QC passed",                            roles:["admin","manager","foreman"] },
    { key:"matterport",        label:"Matterport scan complete",             roles:["admin","manager"] },
  ]},
  { label:"Change Orders", items:[
    { key:"co_new",            label:"New change order created",             roles:["admin","manager","foreman"] },
    { key:"co_approved",       label:"Change order approved",                roles:["admin","manager","foreman","lead"] },
    { key:"co_completed",      label:"Change order work completed",          roles:["admin","manager"] },
  ]},
  { label:"Return Trips", items:[
    { key:"rt_assigned",       label:"Return trip assigned",                 roles:["admin","manager","foreman"] },
    { key:"rt_signed",         label:"Return trip signed off",               roles:["admin","manager"] },
  ]},
  { label:"Updates & Questions", items:[
    { key:"job_question",      label:"New question on job",                  roles:["admin","manager","foreman"] },
    { key:"daily_update",      label:"Daily update added",                   roles:["admin","manager"] },
    { key:"question_answered", label:"Question answered",                    roles:["admin","manager","foreman","lead"] },
  ]},
  { label:"Reminders", items:[
    { key:"reminder_plans",    label:"Plans check (2 days before start)",    roles:["admin","manager"] },
    { key:"reminder_prep",     label:"Prep incomplete reminder",             roles:["admin","manager"] },
    { key:"reminder_po",       label:"Daily PO reminder (1 PM weekdays)",    roles:["lead"] },
    { key:"reminder_daily",    label:"Daily update reminder (4:30 PM)",      roles:["lead"] },
  ]},
];

const getNotifDefaults = (title) => {
  const prefs = {};
  NOTIF_CATEGORIES.forEach(cat => cat.items.forEach(item => {
    prefs[item.key] = item.roles.includes(title||"crew");
  }));
  return prefs;
};

function UserManagement({ users, onSave }) {
  const [list,    setList]    = useState(users);
  const [editing, setEditing] = useState(null);
  const [showPin, setShowPin] = useState({});

  useEffect(()=>setList(users),[users]);

  const newUser = () => {
    const u = { id:"u_"+Date.now(), name:"", title:"foreman", access:"standard", pin:"", notifPrefs: getNotifDefaults("foreman") };
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
                  {/* Foreman assignment — for crew/lead */}
                  {(title==="crew"||title==="lead") && (
                    <div>
                      <div style={{fontSize:10,color:C.dim,marginBottom:4,fontWeight:700,letterSpacing:"0.08em"}}>FOREMAN (crew assignment)</div>
                      <select value={u.foremanId||""} onChange={e=>upd(u.id,{foremanId:e.target.value})}
                        style={{width:"100%",background:C.surface,border:`1px solid ${C.border}`,
                          borderRadius:7,color:C.text,padding:"8px 10px",fontSize:13,
                          fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}>
                        <option value="">— Unassigned —</option>
                        {list.filter(f=>(f.title||f.role)==="foreman"||f.role==="foreman").map(f=>(
                          <option key={f.id} value={f.id}>{f.name}</option>
                        ))}
                      </select>
                      <div style={{fontSize:10,color:C.muted,marginTop:3}}>Which foreman's crew they belong to</div>
                    </div>
                  )}
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
                  {/* Notification Preferences */}
                  {(()=>{
                    const prefs = u.notifPrefs || getNotifDefaults(title);
                    const setKey = (key, val) => upd(u.id, {notifPrefs:{...prefs,[key]:val}});
                    const applyDefaults = () => upd(u.id, {notifPrefs: getNotifDefaults(title)});
                    const allOn  = NOTIF_CATEGORIES.every(cat=>cat.items.every(item=>prefs[item.key]!==false));
                    const allOff = NOTIF_CATEGORIES.every(cat=>cat.items.every(item=>prefs[item.key]===false));
                    return (
                      <div style={{border:`1px solid ${C.border}`,borderRadius:9,overflow:"hidden"}}>
                        <div style={{background:C.surface,padding:"8px 12px",display:"flex",alignItems:"center",justifyContent:"space-between",gap:8}}>
                          <span style={{fontSize:11,fontWeight:700,color:C.text,letterSpacing:"0.04em"}}>🔔 Notifications</span>
                          <div style={{display:"flex",gap:6}}>
                            <button onClick={applyDefaults}
                              style={{fontSize:10,padding:"3px 9px",borderRadius:6,border:`1px solid ${C.border}`,
                                background:"none",color:C.dim,cursor:"pointer",fontFamily:"inherit"}}>
                              Reset to role defaults
                            </button>
                            <button onClick={()=>{ const all={}; NOTIF_CATEGORIES.forEach(c=>c.items.forEach(i=>all[i.key]=true)); upd(u.id,{notifPrefs:all}); }}
                              style={{fontSize:10,padding:"3px 9px",borderRadius:6,border:`1px solid ${C.border}`,
                                background:allOn?`${C.accent}18`:"none",color:allOn?C.accent:C.dim,cursor:"pointer",fontFamily:"inherit"}}>
                              All on
                            </button>
                            <button onClick={()=>{ const all={}; NOTIF_CATEGORIES.forEach(c=>c.items.forEach(i=>all[i.key]=false)); upd(u.id,{notifPrefs:all}); }}
                              style={{fontSize:10,padding:"3px 9px",borderRadius:6,border:`1px solid ${C.border}`,
                                background:allOff?`${C.red}18`:"none",color:allOff?C.red:C.dim,cursor:"pointer",fontFamily:"inherit"}}>
                              All off
                            </button>
                          </div>
                        </div>
                        <div style={{padding:"10px 12px",display:"flex",flexDirection:"column",gap:10}}>
                          {NOTIF_CATEGORIES.map(cat=>(
                            <div key={cat.label}>
                              <div style={{fontSize:9,fontWeight:800,color:C.dim,letterSpacing:"0.1em",
                                textTransform:"uppercase",marginBottom:5}}>{cat.label}</div>
                              <div style={{display:"flex",flexDirection:"column",gap:4}}>
                                {cat.items.map(item=>{
                                  const on = prefs[item.key] !== false;
                                  const isDefault = item.roles.includes(title);
                                  return (
                                    <label key={item.key} style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer"}}>
                                      <input type="checkbox" checked={on} onChange={e=>setKey(item.key,e.target.checked)}
                                        style={{width:14,height:14,accentColor:C.accent,cursor:"pointer",flexShrink:0}}/>
                                      <span style={{fontSize:11,color:on?C.text:C.muted}}>{item.label}</span>
                                      {!isDefault&&on&&<span style={{fontSize:9,color:C.orange,fontWeight:700}}>custom</span>}
                                      {isDefault&&!on&&<span style={{fontSize:9,color:C.dim,fontWeight:700}}>off</span>}
                                    </label>
                                  );
                                })}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })()}

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

  changeOrders:[], returnTrips:[], roughInspectionResult:"", roughInspectionDate:"", roughInspectionItems:[], finalInspectionResult:"", finalInspectionDate:"", finalInspectionItems:[], roughStatus:"", roughStatusDate:"", roughScheduledEnd:"", roughProjectedStart:"", finishStatus:"", finishStatusDate:"", finishScheduledEnd:"", finishProjectedStart:"", qcStatus:"", qcStatusDate:"", qcSignedOff:false, qcSignedOffBy:"", qcSignedOffDate:"", roughQCTaskFired:false, roughStartConfirmed:false, finishStartConfirmed:false, roughNeedsHardDate:false, roughNeedsByStart:"", roughNeedsByEnd:"", finishNeedsHardDate:false, finishNeedsByStart:"", finishNeedsByEnd:"", readyToSchedule:false, readyToInvoice:false, invoiceDismissed:false, matterportDismissed:false, taskDueDates:{}, roughOnHold:false, finishOnHold:false, tempPed:false, hasTempPed:false, tempPedNumber:"", tempPedStatus:"", tempPedScheduledDate:"",

  homeRuns:{

    main:    Array.from({length:10},(_,i)=>newHRRow(i+1)),

    basement:Array.from({length:10},(_,i)=>newHRRow(i+1)),

    upper:   Array.from({length:10},(_,i)=>newHRRow(i+1)),

  },

  panelCounts:{ meter:"", panelA:"", panelB:"", dedicated:"" },

  panelizedLighting:{

    loads:          [],

    mainKeypad:     Array.from({length:10},(_,i)=>newKPRow(i+1)),

    basementKeypad: Array.from({length:10},(_,i)=>newKPRow(i+1)),

    upperKeypad:    Array.from({length:10},(_,i)=>newKPRow(i+1)),

    cp4Loads:       Array.from({length:10},(_,i)=>newCP4Row(i+1)),

    extraFloors:    [],

  },

  tapeLights:[], loadMappingNotes:"",

});

// Generate the next quote number (Q-001, Q-002, …) based on existing quotes
const nextQuoteNumber = (allJobs) => {
  const nums = (allJobs||[])
    .filter(j => j.type==="quote" && j.quoteNumber)
    .map(j => parseInt((j.quoteNumber||"").replace(/\D/g,""))||0);
  const n = nums.length ? Math.max(...nums)+1 : 1;
  return `Q-${String(n).padStart(3,"0")}`;
};


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


// Detect mobile once at module level
const ON_MOBILE = /iphone|ipad|ipod|android/i.test(navigator.userAgent);

// Plain-text bottom-sheet for single-line Inp fields on mobile
const MobileInpSheet = ({initialValue, placeholder, onDone, onCancel, addMode}) => {
  const [draft, setDraft] = useState(initialValue || "");
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.72)",zIndex:99999,
      display:"flex",flexDirection:"column",justifyContent:"flex-end",
      WebkitTapHighlightColor:"transparent"}}
      onClick={e=>{if(e.target===e.currentTarget) onCancel();}}>
      <div style={{background:C.surface,borderTopLeftRadius:18,borderTopRightRadius:18,
        overflow:"hidden",boxShadow:"0 -8px 40px rgba(0,0,0,0.45)"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",
          padding:"13px 16px",borderBottom:`1px solid ${C.border}`}}>
          <button onClick={onCancel}
            style={{background:"none",border:"none",color:C.dim,fontSize:15,
              fontFamily:"inherit",fontWeight:600,cursor:"pointer",padding:"2px 8px"}}>
            Cancel
          </button>
          <button onClick={()=>onDone(draft)}
            style={{background:C.accent,border:"none",color:"#fff",fontSize:15,
              fontFamily:"inherit",fontWeight:700,cursor:"pointer",padding:"6px 22px",borderRadius:8}}>
            {addMode ? "Add" : "Done"}
          </button>
        </div>
        <input autoFocus value={draft} onChange={e=>setDraft(e.target.value)}
          placeholder={placeholder}
          style={{display:"block",width:"100%",boxSizing:"border-box",padding:"16px",fontSize:17,
            fontFamily:"inherit",background:"transparent",border:"none",outline:"none",color:C.text}}/>
        <div style={{height:"env(safe-area-inset-bottom,16px)"}}/>
      </div>
    </div>
  );
};

// onAdd: optional — when provided, button label becomes "Add" and fires onAdd after saving
const Inp = ({value, onChange, placeholder, style={}, onAdd, onBlur, onKeyDown}) => {
  const [modal, setModal] = useState(false);
  return (
    <>
      <input value={value??""} onChange={onChange} placeholder={placeholder}
        style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:7,color:C.text,
          padding:"6px 10px",fontSize:12,fontFamily:"inherit",width:"100%",outline:"none",...style}}
        onFocus={e=>{
          e.target.style.borderColor=C.accent;
          if(ON_MOBILE){e.target.blur();setModal(true);}
        }}
        onBlur={e=>{e.target.style.borderColor=C.border; onBlur&&onBlur(e);}}
        onKeyDown={onKeyDown}/>
      {modal&&<MobileInpSheet initialValue={value??""} placeholder={placeholder}
        addMode={!!onAdd}
        onDone={v=>{onChange({target:{value:v}});if(onAdd)onAdd();if(onBlur)onBlur(v);setModal(false);}}
        onCancel={()=>setModal(false)}/>}
    </>
  );
};

// ── Rich Text ─────────────────────────────────────────────────
// Preset colors available in the toolbar
const RICH_COLORS = ["#ef4444","#f97316","#eab308","#22c55e","#3b82f6","#8b5cf6","#ec4899","#94a3b8"];

// Display helper — renders stored HTML safely; falls back to plain text for old values
const RichText = ({html, style={}}) => {
  if(!html) return null;
  return (html.includes("<") || html.includes("&"))
    ? <span dangerouslySetInnerHTML={{__html:html}} style={style}/>
    : <span style={style}>{html}</span>;
};

// Core rich text editor: contenteditable div + formatting toolbar
// Works inline on desktop AND inside the mobile sheet
const RichEditor = ({htmlValue, onHtmlChange, placeholder, autoFocus=false, minRows=3, onBlur, onEnterKey}) => {
  const ref = useRef(null);
  const focused = useRef(false);
  const savedRange = useRef(null);
  const [active, setActive] = useState({});

  // Sync prop → DOM only when the user isn't actively typing
  useEffect(()=>{
    if(ref.current && !focused.current){
      const html = htmlValue || "";
      if(ref.current.innerHTML !== html) ref.current.innerHTML = html;
    }
  },[htmlValue]);

  useEffect(()=>{ if(autoFocus && ref.current) ref.current.focus(); },[]);

  // Save selection + update active-format state whenever user moves cursor or selects text
  const syncState = () => {
    const sel = window.getSelection();
    if(sel?.rangeCount > 0 && ref.current?.contains(sel.anchorNode)){
      savedRange.current = sel.getRangeAt(0).cloneRange();
    }
    try {
      setActive({
        bold:      document.queryCommandState('bold'),
        italic:    document.queryCommandState('italic'),
        underline: document.queryCommandState('underline'),
        ul:        document.queryCommandState('insertUnorderedList'),
        ol:        document.queryCommandState('insertOrderedList'),
      });
    } catch(e){}
  };

  // Restore saved selection then run the command — fixes iOS losing selection on toolbar tap
  const exec = (cmd, val) => {
    const el = ref.current;
    if(!el) return;
    el.focus();
    const run = () => {
      if(savedRange.current){
        try{ const sel=window.getSelection(); sel?.removeAllRanges(); sel?.addRange(savedRange.current); }catch(e){}
      }
      try{ document.execCommand(cmd, false, val ?? null); }catch(e){}
      onHtmlChange(el.innerHTML || "");
      setTimeout(syncState, 0);
    };
    if(ON_MOBILE) setTimeout(run, 20); else run();
  };

  // List commands fail silently on iOS WebKit — use insertHTML as fallback
  const execList = (cmd) => {
    const el = ref.current;
    if(!el) return;
    el.focus();
    const run = () => {
      if(savedRange.current){
        try{ const sel=window.getSelection(); sel?.removeAllRanges(); sel?.addRange(savedRange.current); }catch(e){}
      }
      try{ document.execCommand(cmd, false, null); }catch(e){}
      if(ON_MOBILE && !document.queryCommandState(cmd)){
        try{ const tag=cmd==='insertUnorderedList'?'ul':'ol'; document.execCommand('insertHTML',false,`<${tag}><li><br></li></${tag}>`); }catch(e){}
      }
      onHtmlChange(el.innerHTML || "");
      setTimeout(syncState, 0);
    };
    if(ON_MOBILE) setTimeout(run, 20); else run();
  };

  const empty = !htmlValue?.replace(/<[^>]*>/g,"")?.trim();
  const btnPad = ON_MOBILE ? "6px 11px" : "3px 7px";
  const btnFont = ON_MOBILE ? 13 : 11;
  const swatchSize = ON_MOBILE ? 22 : 14;

  const TB = ({label, title, action, on=false, s={}}) => (
    <button title={title} onPointerDown={e=>{e.preventDefault(); e.stopPropagation(); action();}}
      style={{
        background: on ? C.accent+"28" : "none",
        border: `1px solid ${on ? C.accent : C.border}`,
        borderRadius:5, color: on ? C.accent : C.text,
        fontSize:btnFont, fontFamily:"inherit", cursor:"pointer",
        padding:btnPad, lineHeight:1.3, whiteSpace:"nowrap",
        transition:"all 0.1s", WebkitTapHighlightColor:"transparent", ...s
      }}>
      {label}
    </button>
  );

  return (
    <div style={{border:`1px solid ${C.border}`,borderRadius:7,overflow:"hidden",background:C.surface}}>
      <div onPointerDown={e=>e.stopPropagation()}
        style={{display:"flex",gap:4,padding:"5px 8px",flexWrap:"wrap",alignItems:"center",
        borderBottom:`1px solid ${C.border}`}}>
        <TB label="B" title="Bold"      action={()=>exec('bold')}      on={active.bold}      s={{fontWeight:900}}/>
        <TB label="I" title="Italic"    action={()=>exec('italic')}    on={active.italic}    s={{fontStyle:"italic"}}/>
        <TB label="U" title="Underline" action={()=>exec('underline')} on={active.underline} s={{textDecoration:"underline"}}/>
        <div style={{width:1,height:16,background:C.border,margin:"0 2px",flexShrink:0}}/>
        <TB label="• List"  title="Bullet list"   action={()=>execList('insertUnorderedList')} on={active.ul}/>
        <TB label="1. List" title="Numbered list" action={()=>execList('insertOrderedList')}   on={active.ol}/>
        <div style={{width:1,height:16,background:C.border,margin:"0 2px",flexShrink:0}}/>
        <span style={{fontSize:9,color:C.dim,fontWeight:700,letterSpacing:"0.06em",marginRight:2}}>COLOR</span>
        {RICH_COLORS.map(c=>(
          <button key={c} onPointerDown={e=>{e.preventDefault(); e.stopPropagation(); exec('foreColor',c);}}
            style={{width:swatchSize,height:swatchSize,borderRadius:99,background:c,flexShrink:0,
              border:"1.5px solid rgba(255,255,255,0.2)",cursor:"pointer",padding:0,
              WebkitTapHighlightColor:"transparent"}}/>
        ))}
        <div style={{width:1,height:16,background:C.border,margin:"0 2px",flexShrink:0}}/>
        <TB label="✕ clear" title="Clear formatting" action={()=>exec('removeFormat')} s={{color:C.dim,fontSize:ON_MOBILE?11:10}}/>
      </div>
      <div style={{position:"relative"}}>
        {empty&&<div style={{position:"absolute",inset:0,padding:"7px 10px",fontSize:12,
          color:C.dim,pointerEvents:"none",fontFamily:"inherit",lineHeight:1.6}}>
          {placeholder}
        </div>}
        <div ref={ref} contentEditable suppressContentEditableWarning
          onFocus={()=>{focused.current=true;}}
          onBlur={()=>{
            const sel=window.getSelection();
            if(sel?.rangeCount>0&&ref.current?.contains(sel.anchorNode)) savedRange.current=sel.getRangeAt(0).cloneRange();
            focused.current=false;
            onBlur&&onBlur(ref.current?.innerHTML||"");
          }}
          onInput={()=>onHtmlChange(ref.current?.innerHTML||"")}
          onPaste={e=>{
            e.preventDefault();
            // Strip heading tags, large fonts, and block-level formatting on paste
            // to prevent big text from appearing when pasting from Word/web
            let html = e.clipboardData.getData('text/html');
            if(html) {
              // Remove heading tags, replace with their content
              html = html.replace(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi, '$1<br>');
              // Remove font-size styles
              html = html.replace(/font-size\s*:[^;"]*/gi, '');
              // Remove large <font size=> attributes
              html = html.replace(/<font[^>]*size\s*=\s*["']?[4-9]["']?[^>]*>/gi, '<span>');
              // Strip everything except basic inline tags
              html = html.replace(/<(?!\/?(?:b|strong|i|em|u|span|br|a|ul|ol|li|div|p)\b)[^>]+>/gi, '');
              document.execCommand('insertHTML', false, html);
            } else {
              const text = e.clipboardData.getData('text/plain');
              document.execCommand('insertText', false, text);
            }
            onHtmlChange(ref.current?.innerHTML||"");
          }}
          onKeyDown={e=>{
            if(e.key==='Enter' && !e.shiftKey && onEnterKey && !active.ul && !active.ol){
              e.preventDefault();
              onEnterKey(ref.current?.innerHTML||"");
            }
          }}
          onSelect={syncState} onKeyUp={syncState} onMouseUp={syncState} onPointerUp={syncState} onTouchEnd={syncState}
          style={{minHeight:minRows*22,padding:"7px 10px",fontSize:12,fontFamily:"inherit",
            color:C.text,outline:"none",lineHeight:1.6,wordBreak:"break-word"}}/>
      </div>
    </div>
  );
};

// Mobile sheet wrapping the rich editor for TA fields
const MAT_SOURCES = ["","Shop","Home Depot","CED","Platt","Amazon","Other"];
const RichMobileSheet = ({initialHtml, initialMaterial='', initialMatSource='', placeholder, onDone, onCancel, addMode, showMaterial=false}) => {
  const [html, setHtml] = useState(initialHtml || "");
  const [material, setMaterial] = useState(initialMaterial || "");
  const [matSource, setMatSource] = useState(initialMatSource || "");

  // Auto-save when phone locks or user switches apps
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        onDone(html, material, matSource);
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [html, material, matSource]);

  // Save draft on cancel if there's content — nothing is ever discarded
  const handleCancel = () => {
    const hasContent = (html||"").replace(/<[^>]*>/g,"").trim() || material.trim();
    if (hasContent) onDone(html, material, matSource);
    else onCancel();
  };

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.72)",zIndex:99999,
      display:"flex",flexDirection:"column",justifyContent:"flex-end",
      WebkitTapHighlightColor:"transparent"}}>
      <div style={{background:C.surface,borderTopLeftRadius:18,borderTopRightRadius:18,
        maxHeight:"85vh",display:"flex",flexDirection:"column",
        boxShadow:"0 -8px 40px rgba(0,0,0,0.45)",overflow:"hidden"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",
          padding:"13px 16px",borderBottom:`1px solid ${C.border}`,flexShrink:0}}>
          <button onClick={handleCancel}
            style={{background:"none",border:"none",color:C.dim,fontSize:15,
              fontFamily:"inherit",fontWeight:600,cursor:"pointer",padding:"2px 8px"}}>
            Cancel
          </button>
          <button onClick={()=>onDone(html, material, matSource)}
            style={{background:C.accent,border:"none",color:"#fff",fontSize:15,
              fontFamily:"inherit",fontWeight:700,cursor:"pointer",padding:"6px 22px",borderRadius:8}}>
            {addMode ? "Add" : "Done"}
          </button>
        </div>
        <div style={{overflow:"auto",padding:12,flexGrow:1}}>
          <RichEditor htmlValue={html} onHtmlChange={setHtml} placeholder={placeholder} autoFocus minRows={6}/>
          {showMaterial && (
            <div style={{marginTop:14,paddingTop:12,borderTop:`1px solid ${C.border}`}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:5}}>
                <div style={{fontSize:12,color:C.dim}}>
                  Material needed: <span style={{fontWeight:400,opacity:0.7}}>one item per line</span>
                </div>
                <select value={matSource} onChange={e=>setMatSource(e.target.value)}
                  style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:7,
                    color:matSource?C.accent:C.dim,padding:"4px 8px",fontSize:11,
                    fontFamily:"inherit",outline:"none",cursor:"pointer"}}>
                  {MAT_SOURCES.map(s=><option key={s} value={s}>{s||"— source —"}</option>)}
                </select>
              </div>
              <textarea value={material} onChange={e=>setMaterial(e.target.value)}
                placeholder={"20A breaker x2\n12/2 wire 50ft\nPlaster ring x4"}
                rows={3}
                style={{width:"100%",boxSizing:"border-box",fontSize:13,
                  border:`1px solid ${C.border}`,borderRadius:8,padding:"8px 10px",
                  background:C.card,color:C.text,outline:"none",
                  fontFamily:"inherit",resize:"vertical",lineHeight:1.5}}/>
            </div>
          )}
        </div>
        <div style={{height:"env(safe-area-inset-bottom,12px)",flexShrink:0}}/>
      </div>
    </div>
  );
};

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


// TA: full rich text area — toolbar always visible on desktop, sheet on mobile
const TA = ({value, onChange, placeholder, rows=3, onAdd, onBlur}) => {
  const [modal, setModal] = useState(false);

  if(ON_MOBILE) return (
    <>
      {/* Tap target shows rendered content */}
      <div onClick={()=>setModal(true)}
        style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:7,
          minHeight:rows*22,padding:"7px 10px",fontSize:12,fontFamily:"inherit",
          cursor:"text",lineHeight:1.6,wordBreak:"break-word",
          color:value?.replace(/<[^>]*>/g,"")?.trim() ? C.text : C.dim}}>
        {value?.replace(/<[^>]*>/g,"")?.trim()
          ? <span dangerouslySetInnerHTML={{__html:value}}/>
          : (placeholder || "Tap to edit…")}
      </div>
      {modal&&<RichMobileSheet initialHtml={value||""} placeholder={placeholder}
        addMode={!!onAdd}
        onDone={html=>{onChange({target:{value:html}});if(onAdd)onAdd();if(onBlur)onBlur(html);setModal(false);}}
        onCancel={()=>setModal(false)}/>}
    </>
  );

  // Desktop: inline rich editor with toolbar always visible
  return (
    <RichEditor
      htmlValue={value||""}
      onHtmlChange={html=>onChange({target:{value:html}})}
      placeholder={placeholder}
      minRows={rows}
      onBlur={onBlur}/>
  );
};


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


function NeedsAttention({jobs, onSelectJob}) {
  const [open, setOpen] = useState(false);

  const today = new Date(); today.setHours(0,0,0,0);
  const daysAway = (dateStr) => {
    if(!dateStr) return null;
    const d = new Date(dateStr); d.setHours(0,0,0,0);
    return Math.round((d-today)/(1000*60*60*24));
  };

  const flatPunchWaiting = (punch) => {
    const items = [];
    ['upper','main','basement'].forEach(floor => {
      const f = punch?.[floor] || {};
      const gen = f.general||[];
      const hc  = f.hotcheck||[];
      const rooms = f.rooms||[];
      [...gen,...hc].forEach(i=>{ if(!i.done&&i.waiting) items.push({text:i.text,floor,room:null,waitingOn:i.waitingOn}); });
      rooms.forEach(r=>(r.items||[]).forEach(i=>{ if(!i.done&&i.waiting) items.push({text:i.text,floor,room:r.name,waitingOn:i.waitingOn}); }));
    });
    return items;
  };

  const flatQuestions = (qs) => {
    const items = [];
    ['upper','main','basement'].forEach(floor => {
      (qs?.[floor]||[]).forEach(q=>{ if(!q.done && !(q.answer||'').trim()) items.push({question:q.question,floor}); });
    });
    return items;
  };

  const stripHtml = (s) => (s||'').replace(/<[^>]*>/g,'').replace(/&nbsp;/g,' ').trim();

  // Gather all attention items
  const startingSoon=[], unanswered=[], unsentPOs=[], waitingItems=[], pendingCOs=[], unscheduledRTs=[];

  jobs.forEach(job => {
    if(parseStage(job.finishStage)===100) return; // skip completed jobs

    const name = job.name||'Unnamed';

    // Starting soon — rough scheduled within 14 days, prep not done
    const da = daysAway(job.roughScheduledDate);
    if(da!==null && da>=0 && da<=14 && (job.prepStage||'')!=='Job Prep Complete') {
      startingSoon.push({job, name, label: da===0?'TODAY':da===1?'Tomorrow':`${da} days`, urgent: da<=2});
    }

    // Unanswered questions
    const rqs = flatQuestions(job.roughQuestions);
    const fqs = flatQuestions(job.finishQuestions);
    if(rqs.length) unanswered.push({job, name, count:rqs.length, phase:'Rough', questions:rqs});
    if(fqs.length) unanswered.push({job, name, count:fqs.length, phase:'Finish', questions:fqs});

    // Unsent POs
    const roughPOs = (job.roughMaterials||[]).filter(o=>o.needsOrder&&!o.ordered&&!o.pickedUp);
    const finPOs   = (job.finishMaterials||[]).filter(o=>o.needsOrder&&!o.ordered&&!o.pickedUp);
    if(roughPOs.length) unsentPOs.push({job, name, count:roughPOs.length, phase:'Rough', orders:roughPOs});
    if(finPOs.length)   unsentPOs.push({job, name, count:finPOs.length, phase:'Finish', orders:finPOs});

    // Waiting punch items
    const rw = flatPunchWaiting(job.roughPunch);
    const fw = flatPunchWaiting(job.finishPunch);
    const qw = flatPunchWaiting(job.qcPunch);
    if(rw.length) waitingItems.push({job, name, count:rw.length, phase:'Rough', items:rw});
    if(fw.length) waitingItems.push({job, name, count:fw.length, phase:'Finish', items:fw});
    if(qw.length) waitingItems.push({job, name, count:qw.length, phase:'QC', items:qw});

    // Pending COs — needs_sending or pending, not approved/completed/converted
    const pendCOs = (job.changeOrders||[]).filter(co=>{
      const s = co.coStatus||'needs_sending';
      return s==='needs_sending'||s==='pending'||s==='needs';
    });
    if(pendCOs.length) pendingCOs.push({job, name, count:pendCOs.length, cos:pendCOs});

    // Unscheduled return trips
    const urt = (job.returnTrips||[]).filter(r=>!r.signedOff&&!r.rtScheduled&&(r.scope||r.date));
    if(urt.length) unscheduledRTs.push({job, name, count:urt.length, trips:urt});
  });

  const total = startingSoon.length+unanswered.length+unsentPOs.length+waitingItems.length+pendingCOs.length+unscheduledRTs.length;

  const SectionHeader = ({icon, label, count, color}) => count===0 ? null : (
    <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:8,marginTop:14}}>
      <span style={{fontSize:12}}>{icon}</span>
      <span style={{fontSize:11,fontWeight:800,color,letterSpacing:'0.06em',textTransform:'uppercase'}}>{label}</span>
      <span style={{fontSize:10,fontWeight:700,background:`${color}22`,color,borderRadius:99,padding:'1px 7px',border:`1px solid ${color}44`}}>{count}</span>
    </div>
  );

  const JobRow = ({job, name, badge, badgeColor, detail, urgent}) => (
    <div onClick={()=>onSelectJob(job)}
      style={{display:'flex',alignItems:'flex-start',gap:10,padding:'8px 12px',marginBottom:5,
        background: urgent?'rgba(220,38,38,0.05)':C.surface,
        border:`1px solid ${urgent?'rgba(220,38,38,0.3)':C.border}`,
        borderLeft:`3px solid ${badgeColor}`,
        borderRadius:8,cursor:'pointer',transition:'background 0.1s'}}
      onMouseEnter={e=>e.currentTarget.style.background=urgent?'rgba(220,38,38,0.08)':`${C.border}66`}
      onMouseLeave={e=>e.currentTarget.style.background=urgent?'rgba(220,38,38,0.05)':C.surface}>
      <div style={{flex:1,minWidth:0}}>
        <div style={{fontSize:12,fontWeight:700,color:C.text,marginBottom:2}}>{name}</div>
        {detail&&<div style={{fontSize:10,color:C.dim,lineHeight:1.4}}>{detail}</div>}
      </div>
      {badge&&<span style={{fontSize:10,fontWeight:700,background:`${badgeColor}20`,color:badgeColor,
        borderRadius:99,padding:'2px 8px',border:`1px solid ${badgeColor}44`,whiteSpace:'nowrap',flexShrink:0}}>
        {badge}
      </span>}
    </div>
  );

  if(total===0) return (
    <div style={{padding:'14px 26px 0'}}>
      <div style={{background:'rgba(22,163,74,0.06)',border:'1px solid rgba(22,163,74,0.25)',
        borderRadius:10,padding:'12px 16px',display:'flex',alignItems:'center',gap:10}}>
        <span style={{fontSize:16}}>✅</span>
        <span style={{fontSize:13,fontWeight:600,color:'#16a34a'}}>All clear — nothing needs attention right now</span>
      </div>
    </div>
  );

  return (
    <div style={{padding:'16px 26px 0'}}>
      <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,overflow:'hidden'}}>
        {/* Header */}
        <div onClick={()=>setOpen(o=>!o)} style={{display:'flex',alignItems:'center',gap:10,
          padding:'12px 16px',cursor:'pointer',userSelect:'none',
          background:'rgba(220,38,38,0.04)',borderBottom:open?`1px solid ${C.border}`:'none'}}>
          <span style={{fontSize:16}}>🔔</span>
          <span style={{fontSize:13,fontWeight:800,color:C.text,flex:1}}>Needs Attention</span>
          <span style={{fontSize:12,fontWeight:700,background:'rgba(220,38,38,0.15)',color:'#dc2626',
            borderRadius:99,padding:'2px 10px',border:'1px solid rgba(220,38,38,0.3)'}}>{total}</span>
          <span style={{color:C.dim,fontSize:12}}>{open?'▾':'▸'}</span>
        </div>

        {open&&(
          <div style={{padding:'4px 16px 16px'}}>

            {/* Starting Soon */}
            <SectionHeader icon="🚀" label="Starting Soon — Prep Incomplete" count={startingSoon.length} color="#dc2626"/>
            {startingSoon.map(({job,name,label,urgent})=>(
              <JobRow key={job.id} job={job} name={name}
                badge={label} badgeColor="#dc2626" urgent={urgent}
                detail={`Rough scheduled · Prep stage: ${job.prepStage||'Not started'}`}/>
            ))}

            {/* Unanswered Questions */}
            <SectionHeader icon="❓" label="Unanswered Questions" count={unanswered.length} color={C.orange}/>
            {unanswered.map(({job,name,count,phase,questions})=>(
              <JobRow key={job.id+phase} job={job} name={name}
                badge={`${count} ${phase}`} badgeColor={C.orange}
                detail={questions.slice(0,2).map(q=>stripHtml(q.question)).filter(Boolean).join(' · ')+(questions.length>2?` +${questions.length-2} more`:'')}/>
            ))}

            {/* Unsent POs */}
            <SectionHeader icon="📦" label="Unsent Purchase Orders" count={unsentPOs.length} color={C.blue}/>
            {unsentPOs.map(({job,name,count,phase,orders})=>(
              <JobRow key={job.id+phase} job={job} name={name}
                badge={`${count} PO${count>1?'s':''} · ${phase}`} badgeColor={C.blue}
                detail={orders.map(o=>o.source||'No supplier').join(', ')}/>
            ))}

            {/* Waiting Punch Items */}
            <SectionHeader icon="⏸" label="On Hold — Waiting on Something" count={waitingItems.length} color="#ca8a04"/>
            {waitingItems.map(({job,name,count,phase,items})=>(
              <JobRow key={job.id+phase} job={job} name={name}
                badge={`${count} waiting · ${phase}`} badgeColor="#ca8a04"
                detail={items.slice(0,2).map(i=>i.waitingOn||stripHtml(i.text)).filter(Boolean).join(' · ')+(items.length>2?` +${items.length-2} more`:'')}/>
            ))}

            {/* Pending COs */}
            <SectionHeader icon="📋" label="Change Orders Pending" count={pendingCOs.length} color={C.purple||'#7c3aed'}/>
            {pendingCOs.map(({job,name,count,cos})=>(
              <JobRow key={job.id} job={job} name={name}
                badge={`${count} CO${count>1?'s':''}`} badgeColor={C.purple||'#7c3aed'}
                detail={cos.slice(0,2).map(co=>co.desc||co.task||'No description').filter(Boolean).join(' · ')}/>
            ))}

            {/* Unscheduled Return Trips */}
            <SectionHeader icon="🔄" label="Unscheduled Return Trips" count={unscheduledRTs.length} color={C.teal||'#0d9488'}/>
            {unscheduledRTs.map(({job,name,count,trips})=>(
              <JobRow key={job.id} job={job} name={name}
                badge={`${count} RT${count>1?'s':''}`} badgeColor={C.teal||'#0d9488'}
                detail={trips.slice(0,2).map(t=>t.scope||'No scope').filter(Boolean).join(' · ')}/>
            ))}

          </div>
        )}
      </div>
    </div>
  );
}


function PhaseInstructions({items, onChange, color, placeholder}) {
  const list = Array.isArray(items) ? items : [];
  const add  = () => onChange([...list, {id:uid(), label:'', text:''}]);
  const upd  = (id, p) => onChange(list.map(e => e.id===id ? {...e,...p} : e));
  const del  = (id) => onChange(list.filter(e => e.id!==id));

  const QUICK_LABELS = ['Plate Colors','Devices','All Rooms','Master Bath','Kitchen','Living Room','Master Bed','Garage','Basement','Exterior'];

  return (
    <div>
      {list.map((entry, i) => (
        <div key={entry.id} style={{marginBottom:10, border:`1.5px solid ${entry.text||entry.label ? color+'55' : C.border}`,
          borderLeft:`3px solid ${entry.text||entry.label ? color : C.border}`,
          borderRadius:8, overflow:'hidden',
          background: entry.text||entry.label ? color+'08' : C.surface}}>
          {/* Label row */}
          <div style={{display:'flex',alignItems:'center',gap:6,padding:'6px 10px',
            borderBottom:`1px solid ${entry.text||entry.label ? color+'33' : C.border}`}}>
            <input value={entry.label} onChange={e=>upd(entry.id,{label:e.target.value})}
              placeholder="Label / Room…"
              style={{flex:1,background:'transparent',border:'none',outline:'none',
                fontSize:12,fontWeight:700,color:entry.label?C.text:C.dim,fontFamily:'inherit'}}/>
            <button onClick={()=>del(entry.id)}
              style={{background:'none',border:'none',cursor:'pointer',color:C.dim,
                fontSize:13,lineHeight:1,padding:'0 2px',fontFamily:'inherit'}}>×</button>
          </div>
          {/* Quick label chips (only if label is empty) */}
          {!entry.label && (
            <div style={{display:'flex',flexWrap:'wrap',gap:4,padding:'5px 10px',
              borderBottom:`1px solid ${C.border}`}}>
              {QUICK_LABELS.map(l=>(
                <button key={l} onClick={()=>upd(entry.id,{label:l})}
                  style={{fontSize:9,padding:'2px 7px',borderRadius:99,border:`1px solid ${color}44`,
                    background:`${color}10`,color:color,cursor:'pointer',fontFamily:'inherit',fontWeight:600}}>
                  {l}
                </button>
              ))}
            </div>
          )}
          {/* Text body */}
          <textarea value={entry.text} onChange={e=>upd(entry.id,{text:e.target.value})}
            placeholder="Notes, colors, device placement, instructions…"
            rows={Math.max(2, (entry.text||'').split('\n').length + 1)}
            style={{width:'100%',boxSizing:'border-box',background:'transparent',border:'none',
              outline:'none',padding:'8px 11px',fontSize:12,fontFamily:'inherit',
              color:C.text,resize:'vertical',lineHeight:1.55}}/>
        </div>
      ))}
      <button onClick={add}
        style={{width:'100%',background:'transparent',border:`1px dashed ${color}55`,
          borderRadius:8,padding:'7px',fontSize:11,fontWeight:700,color:color,
          cursor:'pointer',fontFamily:'inherit',marginTop:list.length?0:2}}>
        + Add Instruction / Note
      </button>
    </div>
  );
}


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

  if (v && typeof v === 'object' && !Array.isArray(v) && ('general' in v || 'rooms' in v || 'hotcheck' in v)) {

    return { general: Array.isArray(v.general) ? v.general : [], rooms: Array.isArray(v.rooms) ? v.rooms : [], hotcheck: Array.isArray(v.hotcheck) ? v.hotcheck : [] };

  }

  return { general: Array.isArray(v) ? v : [], rooms: [], hotcheck: [] };

}


function PunchItems({ items, onChange, filterIds=null, onAddMaterial, jobId }) {

  const safeItems = Array.isArray(items) ? items : [];

  const [addHtml,       setAddHtml]       = useState('');
  const [addOpen,       setAddOpen]       = useState(false);
  const [addKey,        setAddKey]        = useState(0);
  const [addMaterial,   setAddMaterial]   = useState('');
  const [addMatSource,  setAddMatSource]  = useState('');
  const [editingId,     setEditingId]     = useState(null);
  const [editHtml,      setEditHtml]      = useState('');
  const [editMaterial,  setEditMaterial]  = useState('');
  const [editMatSource, setEditMatSource] = useState('');
  const [waitingEditId,   setWaitingEditId]   = useState(null);
  const [waitingText,     setWaitingText]     = useState('');
  const [materialEditId,  setMaterialEditId]  = useState(null);
  const [materialText,    setMaterialText]    = useState('');
  const [mobileSheet,   setMobileSheet]   = useState(null);
  const [uploadingId,   setUploadingId]   = useState(null);
  const [lightboxPhoto, setLightboxPhoto] = useState(null);

  const handlePhotoUpload = async (itemId, files) => {
    if(!files||!files.length||!jobId) return;
    setUploadingId(itemId);
    const newPhotos = [];
    for(const file of Array.from(files)) {
      try {
        const photoId = uid();
        const ext = file.name.split('.').pop()||'jpg';
        const storagePath = `jobs/${jobId}/punch-photos/${itemId}/${photoId}.${ext}`;
        const storageRef = ref(storage, storagePath);
        await uploadBytes(storageRef, file);
        const url = await getDownloadURL(storageRef);
        newPhotos.push({id:photoId, name:file.name, url, storagePath});
      } catch(e) { console.error('Punch photo upload failed:', e); }
    }
    if(newPhotos.length) {
      onChange(safeItems.map(i => i.id===itemId ? {...i, photos:[...(i.photos||[]),...newPhotos]} : i));
    }
    setUploadingId(null);
  };

  const removePhoto = (itemId, photoId) => {
    onChange(safeItems.map(i => i.id===itemId ? {...i, photos:(i.photos||[]).filter(p=>p.id!==photoId)} : i));
  };

  const commitAdd = (html, keepOpen=false, materialOverride=undefined, matSourceOverride=undefined) => {
    if (!(html||"").replace(/<[^>]*>/g,"").trim()) return;
    const who = getIdentity();
    const newItem = { id: uid(), text: html, done: false, addedBy: who?.name||"" };
    const mat = (materialOverride !== undefined ? materialOverride : addMaterial) || "";
    const src = (matSourceOverride !== undefined ? matSourceOverride : addMatSource) || "";
    if (mat.trim()) {
      newItem.materialNeeded = mat.trim();
      if (src) newItem.materialSource = src;
      // Format as HTML list lines for the PO (TA component renders HTML)
      const formatted = mat.trim().split('\n').filter(Boolean)
        .map(l => l.trim().startsWith('- ') ? l.trim() : `- ${l.trim()}`).join('<br>');
      onAddMaterial && onAddMaterial(formatted, src);
    }
    onChange([...safeItems, newItem]);
    setAddHtml('');
    setAddMaterial('');
    if (keepOpen) {
      setAddKey(k => k + 1);
    } else {
      setAddOpen(false);
      setMobileSheet(null);
    }
  };

  const commitEdit = (id, html, material=undefined, matSource=undefined) => {
    if ((html||"").replace(/<[^>]*>/g,"").trim()) {
      const patch = { text: html };
      if (material !== undefined) patch.materialNeeded = material.trim();
      if (matSource !== undefined) patch.materialSource = matSource;
      onChange(safeItems.map(i => i.id === id ? { ...i, ...patch } : i));
    }
    setEditingId(null);
    setEditMaterial('');
    setEditMatSource('');
    setMobileSheet(null);
  };

  const commitWaiting = (id, text) => {
    onChange(safeItems.map(i => i.id === id ? { ...i, waiting: true, waitingOn: text.trim() } : i));
    setWaitingEditId(null);
    setWaitingText('');
  };

  const clearWaiting = (id) => {
    onChange(safeItems.map(i => i.id === id ? { ...i, waiting: false, waitingOn: '' } : i));
  };

  const commitMaterial = (id, text) => {
    onChange(safeItems.map(i => i.id === id ? { ...i, materialNeeded: text.trim() } : i));
    setMaterialEditId(null);
    setMaterialText('');
  };

  return (

    <div style={{ paddingLeft: 8 }}>

      {safeItems.map(item => (

        <div key={item.id} style={{ marginBottom: 6 }}>

          {/* ── Main item row ── */}
          <div style={{ display: 'flex', alignItems: editingId===item.id ? 'flex-start' : 'center', gap: 8 }}>

            <input type="checkbox" checked={!!item.done}
              onChange={() => {
                const nowDone = !item.done;
                const who = getIdentity();
                onChange(safeItems.map(i => i.id === item.id ? {
                  ...i, done: nowDone,
                  checkedBy: nowDone ? (who?.name||"") : "",
                  checkedAt: nowDone ? new Date().toLocaleDateString("en-US") : "",
                  waiting: nowDone ? false : i.waiting,
                } : i));
              }}
              style={{ accentColor: C.green, width: 14, height: 14, cursor: 'pointer', flexShrink: 0,
                marginTop: editingId===item.id ? 3 : 0 }} />

            {editingId === item.id && !ON_MOBILE ? (
              <div style={{ flex: 1 }}
                onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) commitEdit(item.id, editHtml, editMaterial); }}>
                <RichEditor htmlValue={editHtml} onHtmlChange={setEditHtml} autoFocus minRows={2} placeholder="Edit item…"/>
                <div style={{display:'flex',flexDirection:'column',gap:3,marginTop:6}}>
                  <span style={{fontSize:11,color:C.dim}}>Material needed: <span style={{fontWeight:400,opacity:0.7}}>(one item per line)</span></span>
                  <textarea value={editMaterial} onChange={e=>setEditMaterial(e.target.value)}
                    placeholder={"20A breaker x2\n12/2 wire 50ft"}
                    rows={2}
                    style={{width:'100%',boxSizing:'border-box',fontSize:11,border:`1px solid ${C.border}`,
                      borderRadius:5,padding:'5px 8px',background:C.surface,color:C.text,
                      outline:'none',fontFamily:'inherit',resize:'vertical',lineHeight:1.5}}/>
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                  <Btn onClick={() => commitEdit(item.id, editHtml, editMaterial)} variant="primary" style={{ fontSize: 11, padding: '3px 12px' }}>Save</Btn>
                  <button onClick={() => { setEditingId(null); setEditMaterial(''); }}
                    style={{ background: 'none', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 12 }}>Cancel</button>
                </div>
              </div>
            ) : (
              <div style={{flex:1,display:"flex",flexDirection:"column",gap:1}}>
                <span onClick={() => {
                  if (item.done) return;
                  if (ON_MOBILE) { setMobileSheet({ mode: 'edit', id: item.id, html: item.text, material: item.materialNeeded||'' }); }
                  else           { setEditingId(item.id); setEditHtml(item.text); setEditMaterial(item.materialNeeded||''); }
                }}
                  style={{ fontSize: 12, color: item.done ? C.muted : C.text,
                    textDecoration: item.done ? 'line-through' : 'none',
                    cursor: item.done ? 'default' : 'text',
                    borderRadius: 4, padding: '2px 4px', transition: 'background 0.1s' }}
                  onMouseEnter={e=>{if(!item.done)e.target.style.background=C.border+'66'}}
                  onMouseLeave={e=>e.target.style.background='transparent'}>
                  <RichText html={item.text}/>
                </span>
                {(item.addedBy||item.checkedBy||(filterIds!=null))&&(
                  <span style={{fontSize:9,color:C.dim,paddingLeft:4,display:'flex',alignItems:'center',gap:5,flexWrap:'wrap'}}>
                    {item.addedBy&&!item.done&&<span>added by {item.addedBy}</span>}
                    {item.checkedBy&&item.done&&<span style={{color:C.green}}>✓ checked by {item.checkedBy}{item.checkedAt?" · "+item.checkedAt:""}</span>}
                    {filterIds!=null&&<span style={{fontWeight:700,borderRadius:99,padding:'1px 6px',lineHeight:1.6,
                      background:filterIds.has(item.id)?'#dcfce7':'#f3f4f6',
                      color:filterIds.has(item.id)?'#16a34a':'#9ca3af'}}>
                      {filterIds.has(item.id)?'Shared':'Not shared'}
                    </span>}
                  </span>
                )}
              </div>
            )}

            {/* Waiting toggle — only on open items */}
            {!item.done && (
              <button
                onClick={() => item.waiting ? clearWaiting(item.id) : (setWaitingEditId(item.id), setWaitingText(''))}
                title={item.waiting ? "Clear waiting status" : "Mark as waiting on something"}
                style={{ background: item.waiting ? '#fef3c7' : 'none',
                  border: item.waiting ? '1px solid #fcd34d' : '1px solid transparent',
                  borderRadius: 4, cursor:'pointer', fontSize:10, flexShrink:0,
                  padding:'1px 6px', color: item.waiting ? '#92400e' : C.muted,
                  fontFamily:'inherit', fontWeight: item.waiting ? 700 : 400 }}>
                {item.waiting ? 'Waiting ×' : 'Wait'}
              </button>
            )}

            {/* Photo upload button */}
            {jobId && (
              <label title="Add photo" style={{cursor:'pointer',flexShrink:0,lineHeight:1}}>
                <input type="file" accept="image/*" multiple style={{display:'none'}}
                  onChange={e=>handlePhotoUpload(item.id, e.target.files)}/>
                <span style={{fontSize:13,opacity:uploadingId===item.id?0.4:((item.photos||[]).length>0?1:0.4),
                  filter:(item.photos||[]).length>0?'none':'grayscale(1)'}}>
                  {uploadingId===item.id ? '⏳' : '📷'}
                  {(item.photos||[]).length>0&&<sup style={{fontSize:8,fontWeight:700,color:C.blue}}>{(item.photos||[]).length}</sup>}
                </span>
              </label>
            )}

            <button onClick={() => { if(!window.confirm("Delete this punch item?")) return; onChange(safeItems.filter(i => i.id !== item.id)); }}
              style={{ background: 'none', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 12, flexShrink: 0 }}>✕</button>

          </div>

          {/* ── Waiting badges ── */}
          {item.waiting && !item.done && (
            <div style={{marginLeft:22,marginTop:2,display:'flex',alignItems:'center',gap:6,flexWrap:'wrap'}}>
              <span style={{fontSize:10,fontWeight:700,background:'#fef3c7',color:'#92400e',
                borderRadius:99,padding:'2px 8px',border:'1px solid #fcd34d'}}>
                {item.waitingOn ? `Waiting on: ${item.waitingOn}` : 'Waiting'}
              </span>
              <button onClick={()=>{setWaitingEditId(item.id);setWaitingText(item.waitingOn||'');}}
                style={{fontSize:9,background:'none',border:'none',color:C.muted,cursor:'pointer',textDecoration:'underline',padding:0}}>
                edit
              </button>
            </div>
          )}
          {item.materialNeeded && !item.done && (
            <div style={{marginLeft:22,marginTop:2,display:'flex',alignItems:'center',gap:6,flexWrap:'wrap'}}>
              <span style={{fontSize:10,fontWeight:600,background:'#eff6ff',color:'#1d4ed8',
                borderRadius:99,padding:'2px 8px',border:'1px solid #bfdbfe'}}>
                Material: {item.materialNeeded}
              </span>
              {item.materialSource && (
                <span style={{fontSize:10,fontWeight:700,background:`${C.accent}18`,color:C.accent,
                  borderRadius:99,padding:'2px 8px'}}>
                  {item.materialSource}
                </span>
              )}
              <button onClick={()=>{setMaterialEditId(item.id);setMaterialText(item.materialNeeded||'');}}
                style={{fontSize:9,background:'none',border:'none',color:C.muted,cursor:'pointer',textDecoration:'underline',padding:0}}>
                edit
              </button>
            </div>
          )}

          {/* ── Inline material edit ── */}
          {materialEditId === item.id && (
            <div style={{display:'flex',flexDirection:'column',gap:4,marginTop:4,marginLeft:22,
              borderLeft:`2px solid #3b82f6`,paddingLeft:8}}>
              <textarea autoFocus value={materialText} onChange={e=>setMaterialText(e.target.value)}
                onKeyDown={e=>{ if(e.key==='Escape') setMaterialEditId(null); }}
                placeholder="One item per line"
                rows={3}
                style={{fontSize:11,border:`1px solid #93c5fd`,borderRadius:5,padding:'5px 8px',
                  background:'#eff6ff',color:'#1e40af',outline:'none',fontFamily:'inherit',resize:'vertical',lineHeight:1.5}}/>
              <div style={{display:'flex',gap:8}}>
                <button onClick={()=>commitMaterial(item.id,materialText)}
                  style={{fontSize:11,background:'#3b82f6',color:'#fff',border:'none',borderRadius:5,
                    padding:'3px 12px',cursor:'pointer',fontFamily:'inherit'}}>Save</button>
                <button onClick={()=>setMaterialEditId(null)}
                  style={{fontSize:11,background:'none',border:'none',color:C.muted,cursor:'pointer',fontFamily:'inherit'}}>Cancel</button>
              </div>
            </div>
          )}

          {/* ── Inline waiting reason input ── */}
          {waitingEditId === item.id && (
            <div style={{display:'flex',gap:6,alignItems:'center',marginTop:4,marginLeft:22,
              borderLeft:`2px solid #f59e0b`,paddingLeft:8}}>
              <input autoFocus value={waitingText} onChange={e=>setWaitingText(e.target.value)}
                onKeyDown={e=>{ if(e.key==='Enter'){e.preventDefault();commitWaiting(item.id,waitingText);} if(e.key==='Escape') setWaitingEditId(null); }}
                onBlur={()=>commitWaiting(item.id,waitingText)}
                placeholder="What are you waiting on?"
                style={{flex:1,fontSize:11,border:`1px solid #f59e0b`,borderRadius:5,padding:'5px 8px',
                  background:'#fffbeb',color:'#78350f',outline:'none',fontFamily:'inherit'}}/>
            </div>
          )}

          {/* ── Photo thumbnails ── */}
          {(item.photos||[]).length>0&&(
            <div style={{display:'flex',flexWrap:'wrap',gap:6,marginTop:6,marginLeft:22}}>
              {(item.photos||[]).map(photo=>(
                <div key={photo.id} style={{position:'relative',borderRadius:6,overflow:'hidden',
                  border:`1px solid ${C.border}`,flexShrink:0}}>
                  <img src={photo.url} alt={photo.name}
                    onClick={()=>setLightboxPhoto(photo.url)}
                    style={{width:64,height:64,objectFit:'cover',cursor:'pointer',display:'block'}}/>
                  <button onClick={()=>removePhoto(item.id,photo.id)}
                    style={{position:'absolute',top:1,right:1,background:'rgba(0,0,0,0.55)',
                      border:'none',borderRadius:99,width:16,height:16,cursor:'pointer',
                      color:'#fff',fontSize:10,lineHeight:1,padding:0,display:'flex',
                      alignItems:'center',justifyContent:'center'}}>×</button>
                </div>
              ))}
              <label style={{width:64,height:64,border:`1px dashed ${C.border}`,borderRadius:6,
                display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',
                fontSize:20,color:C.dim,flexShrink:0}}>
                <input type="file" accept="image/*" multiple style={{display:'none'}}
                  onChange={e=>handlePhotoUpload(item.id, e.target.files)}/>
                +
              </label>
            </div>
          )}

        </div>

      ))}

      {addOpen && !ON_MOBILE ? (
        <div style={{ marginTop: 6 }}
          onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) commitAdd(addHtml); }}>
          <RichEditor key={addKey} htmlValue={addHtml} onHtmlChange={setAddHtml} placeholder="Add punch item… (Enter to save and add next)" autoFocus minRows={2}
            onEnterKey={html => commitAdd(html, true)}/>
          {/* Material needed */}
          <div style={{display:'flex',flexDirection:'column',gap:3,marginTop:6}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <span style={{fontSize:11,color:C.dim,whiteSpace:'nowrap'}}>Material needed: <span style={{fontWeight:400,opacity:0.7}}>(one item per line)</span></span>
              <select value={addMatSource} onChange={e=>setAddMatSource(e.target.value)}
                style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:6,
                  color:addMatSource?C.accent:C.dim,padding:"3px 7px",fontSize:10,
                  fontFamily:"inherit",outline:"none",cursor:"pointer"}}>
                {MAT_SOURCES.map(s=><option key={s} value={s}>{s||"— source —"}</option>)}
              </select>
            </div>
            <textarea value={addMaterial} onChange={e=>setAddMaterial(e.target.value)}
              placeholder={"20A breaker x2\n12/2 wire 50ft\nPlaster ring x4"}
              rows={3}
              style={{width:'100%',boxSizing:'border-box',fontSize:11,border:`1px solid ${C.border}`,borderRadius:5,
                padding:'5px 8px',background:C.surface,color:C.text,outline:'none',
                fontFamily:'inherit',resize:'vertical',lineHeight:1.5}}/>
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 6, alignItems:'center' }}>
            <Btn onClick={() => commitAdd(addHtml)} variant="primary" style={{ fontSize: 11, padding: '3px 12px' }}>Add</Btn>
            <button onClick={() => { setAddOpen(false); setAddHtml(''); setAddMaterial(''); setAddMatSource(''); }}
              style={{ background: 'none', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 12 }}>Cancel</button>
            <span style={{fontSize:10,color:C.muted,marginLeft:2}}>↵ Enter = save &amp; next · Shift+Enter = new line</span>
          </div>
        </div>
      ) : !addOpen && (
        <Btn onClick={() => {
          if (ON_MOBILE) setMobileSheet({ mode: 'add' });
          else           { setAddOpen(true); setAddHtml(''); setAddMaterial(''); setAddMatSource(''); }
        }} variant="add" style={{ fontSize: 11, padding: '4px 12px', marginTop: 4 }}>+ Add Item</Btn>
      )}

      {mobileSheet && (
        <RichMobileSheet
          initialHtml={mobileSheet.mode === 'edit' ? mobileSheet.html : ''}
          initialMaterial={mobileSheet.material||''}
          placeholder={mobileSheet.mode === 'add' ? "Add punch item…" : "Edit item…"}
          addMode={mobileSheet.mode === 'add'}
          showMaterial={mobileSheet.mode === 'add' ? !!onAddMaterial : true}
          initialMatSource={mobileSheet.matSource||''}
          onDone={(html, mat, src) => mobileSheet.mode === 'add'
            ? commitAdd(html, false, mat, src)
            : commitEdit(mobileSheet.id, html, mat, src)}
          onCancel={() => setMobileSheet(null)}/>
      )}

      {/* Lightbox */}
      {lightboxPhoto&&(
        <div onClick={()=>setLightboxPhoto(null)}
          style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.85)',zIndex:9999,
            display:'flex',alignItems:'center',justifyContent:'center',cursor:'zoom-out'}}>
          <img src={lightboxPhoto} alt="punch photo"
            style={{maxWidth:'94vw',maxHeight:'90vh',borderRadius:8,objectFit:'contain'}}/>
          <button onClick={()=>setLightboxPhoto(null)}
            style={{position:'absolute',top:16,right:20,background:'rgba(255,255,255,0.15)',
              border:'none',color:'#fff',fontSize:24,cursor:'pointer',borderRadius:99,
              width:36,height:36,display:'flex',alignItems:'center',justifyContent:'center'}}>×</button>
        </div>
      )}

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


function PunchFloor({ floorKey, floorData, onFloorChange, floorLabel, floorColor, showHotcheck=false, filterIds=null, onAddMaterial, onAddQuestion, jobId }) {

  const data = normFloor(floorData);

  const [collapsed,       setCollapsed]      = useState(false);
  const [roomDraft,       setRoomDraft]      = useState('');
  const [openQFor,        setOpenQFor]       = useState(null); // 'general' | room.id | null
  const [questionDraft,   setQuestionDraft]  = useState('');
  const [qConfirmedFor,   setQConfirmedFor]  = useState(null);

  const submitQuestion = (sectionId) => {
    if (!questionDraft.trim() || !onAddQuestion) return;
    onAddQuestion(questionDraft.trim());
    setQuestionDraft('');
    setOpenQFor(null);
    setQConfirmedFor(sectionId);
    setTimeout(() => setQConfirmedFor(null), 2500);
  };

  const qBtn = (sectionId) => onAddQuestion ? (
    <button onClick={e=>{e.stopPropagation();setOpenQFor(openQFor===sectionId?null:sectionId);setQuestionDraft('');}}
      style={{background:'none',border:`1px solid ${C.orange}66`,borderRadius:99,cursor:'pointer',
        color:C.orange,fontSize:9,fontWeight:800,padding:'1px 6px',fontFamily:'inherit',lineHeight:1.4,
        opacity: openQFor===sectionId ? 1 : 0.65}}>
      ? Q
    </button>
  ) : null;

  const qInput = (sectionId) => openQFor===sectionId ? (
    <div style={{display:'flex',gap:5,margin:'5px 0 8px'}}>
      <Inp value={questionDraft} autoFocus
        onChange={e=>setQuestionDraft(e.target.value)}
        placeholder="Type question and press Enter…"
        style={{flex:1,fontSize:11}}
        onKeyDown={e=>{
          if(e.key==='Enter') submitQuestion(sectionId);
          if(e.key==='Escape'){setOpenQFor(null);setQuestionDraft('');}
        }}/>
      <Btn onClick={()=>submitQuestion(sectionId)} variant="ghost"
        style={{fontSize:10,padding:'3px 8px',borderColor:C.orange,color:C.orange,whiteSpace:'nowrap'}}>
        Add
      </Btn>
      <button onClick={()=>{setOpenQFor(null);setQuestionDraft('');}}
        style={{background:'none',border:'none',color:C.dim,cursor:'pointer',fontSize:13,padding:'0 2px'}}>✕</button>
    </div>
  ) : null;


  const openCount    = data.general.filter(i => !i.done).length +
    (showHotcheck ? data.hotcheck.filter(i => !i.done).length : 0) +
    data.rooms.reduce((a, r) => a + (Array.isArray(r.items) ? r.items.filter(i => !i.done).length : 0), 0);
  const waitingCount = data.general.filter(i => !i.done && i.waiting).length +
    (showHotcheck ? data.hotcheck.filter(i => !i.done && i.waiting).length : 0) +
    data.rooms.reduce((a, r) => a + (Array.isArray(r.items) ? r.items.filter(i => !i.done && i.waiting).length : 0), 0);


  const setGeneral = (general) => onFloorChange(floorKey, { ...data, general });
  const setHotcheck = (hotcheck) => onFloorChange(floorKey, { ...data, hotcheck });

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
        {waitingCount > 0 && <span style={{ fontSize: 10, background: '#fef3c7', color: '#92400e',
          borderRadius: 99, padding: '2px 8px', fontWeight: 700, border: '1px solid #fcd34d' }}>{waitingCount} waiting</span>}

        <span style={{ color: floorColor, fontSize: 12 }}>{collapsed ? '▸' : '▾'}</span>

      </div>

      {!collapsed && (

        <div style={{ padding: '12px 14px' }}>

          <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:4}}>
            <span style={{ fontSize: 10, color: C.dim, fontWeight: 700, letterSpacing: '0.08em' }}>GENERAL</span>
            {qBtn('general')}
            {qConfirmedFor==='general'&&<span style={{fontSize:9,fontWeight:700,color:'#16a34a'}}>✓ added</span>}
          </div>
          {qInput('general')}

          <PunchItems items={data.general} onChange={setGeneral} filterIds={filterIds} onAddMaterial={onAddMaterial} jobId={jobId}/>

          {showHotcheck && (
            <div style={{ marginTop: 12, background: `rgba(220,38,38,0.06)`, border: `1px solid rgba(220,38,38,0.25)`, borderRadius: 8, padding: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 10, fontWeight: 800, color: '#dc2626', letterSpacing: '0.08em' }}>⚡ HOT CHECK</span>
                {data.hotcheck.filter(i => !i.done).length > 0 && (
                  <span style={{ fontSize: 10, background: 'rgba(220,38,38,0.15)', color: '#dc2626', borderRadius: 99, padding: '2px 7px', fontWeight: 700 }}>
                    {data.hotcheck.filter(i => !i.done).length} open
                  </span>
                )}
              </div>
              <PunchItems items={data.hotcheck} onChange={setHotcheck} filterIds={filterIds} onAddMaterial={onAddMaterial} jobId={jobId}/>
            </div>
          )}

          {data.rooms.map(room => (

            <div key={room.id} style={{ marginTop: 12, background: C.surface,

              border: `1px solid ${C.border}`, borderRadius: 8, padding: 10 }}>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>

                <RoomNameEdit name={room.name} onSave={v=>onFloorChange(floorKey,{...data,rooms:data.rooms.map(r=>r.id===room.id?{...r,name:v}:r)})}/>

                {(Array.isArray(room.items) ? room.items : []).filter(i => !i.done).length > 0 &&
                  <span style={{ fontSize: 10, background: `${C.red}22`, color: C.red,
                    borderRadius: 99, padding: '2px 6px', fontWeight: 700 }}>
                    {room.items.filter(i => !i.done).length} open
                  </span>}
                {(Array.isArray(room.items) ? room.items : []).filter(i => !i.done && i.waiting).length > 0 &&
                  <span style={{ fontSize: 10, background: '#fef3c7', color: '#92400e',
                    borderRadius: 99, padding: '2px 6px', fontWeight: 700, border: '1px solid #fcd34d' }}>
                    {room.items.filter(i => !i.done && i.waiting).length} waiting
                  </span>}
                {qBtn(room.id)}
                {qConfirmedFor===room.id&&<span style={{fontSize:9,fontWeight:700,color:'#16a34a'}}>✓ added</span>}

              </div>
              {qInput(room.id)}

              <PunchItems items={Array.isArray(room.items) ? room.items : []}

                onChange={v => setRoomItems(room.id, v)} filterIds={filterIds} onAddMaterial={onAddMaterial} jobId={jobId}/>

              <button onClick={() => { if(!window.confirm(`Remove room "${room.name}" and all its punch items?`)) return; delRoom(room.id); }}
                style={{ display: 'block', marginTop: 6, marginLeft: 'auto', background: 'none', border: 'none',
                  color: C.muted, cursor: 'pointer', fontSize: 11, textDecoration: 'underline', fontFamily: 'inherit' }}>
                Remove {room.name}
              </button>

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


function PunchSection({ punch, onChange, jobName, phase, onEmail, showHotcheck=false, filterIds=null, onAddMaterial, onAddQuestion, jobId }) {

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

  const countOpen    = (f) => f.general.filter(i => !i.done).length +
    (showHotcheck ? (f.hotcheck||[]).filter(i => !i.done).length : 0) +
    f.rooms.reduce((a, r) => a + (Array.isArray(r.items) ? r.items.filter(i => !i.done).length : 0), 0);
  const countWaiting = (f) => f.general.filter(i => !i.done && i.waiting).length +
    (showHotcheck ? (f.hotcheck||[]).filter(i => !i.done && i.waiting).length : 0) +
    f.rooms.reduce((a, r) => a + (Array.isArray(r.items) ? r.items.filter(i => !i.done && i.waiting).length : 0), 0);

  const totalOpen    = countOpen(upper) + countOpen(main) + countOpen(basement) +
    extras.reduce((sum,e) => sum + countOpen(normFloor(punch[e.key])), 0);
  const totalWaiting = countWaiting(upper) + countWaiting(main) + countWaiting(basement) +
    extras.reduce((sum,e) => sum + countWaiting(normFloor(punch[e.key])), 0);

  const getAllItemIds = () => {
    const ids = [];
    const addFloor = (f) => {
      const d = normFloor(f);
      d.general.forEach(i=>ids.push(i.id));
      if(showHotcheck) (d.hotcheck||[]).forEach(i=>ids.push(i.id));
      d.rooms.forEach(r=>(r.items||[]).forEach(i=>ids.push(i.id)));
    };
    addFloor(punch.upper); addFloor(punch.main); addFloor(punch.basement);
    (punch.extras||[]).forEach(e=>addFloor(punch[e.key]));
    return ids;
  };
  const allItemIds = getAllItemIds();
  const sharedCount = filterIds ? allItemIds.filter(id=>filterIds.has(id)).length : 0;

  const stripHtml = (html) => (html||"").replace(/<[^>]*>/g,"").replace(/&nbsp;/g," ").replace(/&amp;/g,"&").trim();

  const flatItems = (f, label) => [
    ...f.general.filter(i => !i.done).map(i => `[${label}] ${stripHtml(i.text)}`),
    ...f.rooms.flatMap(r => (r.items||[]).filter(i => !i.done).map(i => `[${label} - ${r.name}] ${stripHtml(i.text)}`)),
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

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>

        <div style={{display:'flex',alignItems:'center',gap:6}}>
          {filterIds!=null && (
            <span style={{fontSize:10,fontWeight:600,color:sharedCount===allItemIds.length?C.green:C.muted}}>
              {sharedCount} of {allItemIds.length} shared
            </span>
          )}
          {totalWaiting > 0 && (
            <span style={{fontSize:10,fontWeight:700,background:'#fef3c7',color:'#92400e',
              borderRadius:99,padding:'2px 8px',border:'1px solid #fcd34d'}}>
              {totalWaiting} waiting
            </span>
          )}
        </div>

        {totalOpen > 0 && (

          <Btn onClick={handleEmail} variant="email" style={{ fontSize: 11, padding: '4px 10px' }}>

            ✉ Email Punch List ({totalOpen} open)

          </Btn>

        )}

      </div>

      <PunchFloor floorKey="upper"    floorData={upper}    onFloorChange={handleFloorChange} floorLabel="Upper Level" floorColor={C.blue}    showHotcheck={showHotcheck} filterIds={filterIds} onAddMaterial={onAddMaterial} onAddQuestion={onAddQuestion ? t=>onAddQuestion('upper',t) : null} jobId={jobId}/>

      <PunchFloor floorKey="main"     floorData={main}     onFloorChange={handleFloorChange} floorLabel="Main Level"  floorColor={C.accent}  showHotcheck={showHotcheck} filterIds={filterIds} onAddMaterial={onAddMaterial} onAddQuestion={onAddQuestion ? t=>onAddQuestion('main',t) : null} jobId={jobId}/>

      <PunchFloor floorKey="basement" floorData={basement} onFloorChange={handleFloorChange} floorLabel="Basement"    floorColor={C.purple}  showHotcheck={showHotcheck} filterIds={filterIds} onAddMaterial={onAddMaterial} onAddQuestion={onAddQuestion ? t=>onAddQuestion('basement',t) : null} jobId={jobId}/>

      {extras.map((e,i)=>(
        <div key={e.key}>
          <PunchFloor
            floorKey={e.key}
            floorData={normFloor(punch[e.key])}
            onFloorChange={handleFloorChange}
            floorLabel={e.label}
            floorColor={FLOOR_COLORS[i % FLOOR_COLORS.length]}
            showHotcheck={showHotcheck}
            filterIds={filterIds}
            onAddMaterial={onAddMaterial}
            onAddQuestion={onAddQuestion ? t=>onAddQuestion('main',t) : null} jobId={jobId}/>
          <button onClick={()=>{
            if(!window.confirm(`Remove "${e.label}" and all its punch items? This cannot be undone.`)) return;
            removeFloor(e.key);
          }}
            style={{display:"block",margin:"2px 0 6px auto",background:"none",border:"none",
              color:C.muted,cursor:"pointer",fontSize:11,padding:"2px 8px",fontFamily:"inherit",
              textDecoration:"underline"}}>
            Remove {e.label}
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

function poItemsPreview(items) {
  const plain = (items||"").replace(/<br\s*\/?>/gi,'\n').replace(/<[^>]*>/g,'')
    .replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').trim();
  const lines = plain.split('\n').map(l=>l.trim()).filter(Boolean);
  if (!lines.length) return "";
  return lines.length > 1 ? `${lines[0]} + ${lines.length-1} more` : lines[0];
}

function MaterialOrders({orders,onChange}) {
  const safeOrders = Array.isArray(orders) ? orders : [];

  const [collapsed, setCollapsed] = useState(() => {
    const m = {};
    safeOrders.forEach(o => { if(o.pickedUp) m[o.id] = true; });
    return m;
  });

  const SOURCES = ["","Shop","Home Depot","CED","Platt","Amazon","Other"];
  const add = () => onChange([...safeOrders, {id:uid(),date:"",po:"",pickupDate:"",source:"",items:"",pickedUp:false,needsOrder:true}]);

  const upd = (id, p) => {
    onChange(safeOrders.map(o => o.id===id ? {...o,...p} : o));
    if(p.pickedUp === true)  setCollapsed(c => ({...c, [id]: true}));
    if(p.pickedUp === false) setCollapsed(c => ({...c, [id]: false}));
  };

  const del = (id) => { if(!window.confirm("Remove this purchase order?")) return; onChange(safeOrders.filter(o => o.id!==id)); };

  const toggle = (id) => setCollapsed(c => ({...c, [id]: !c[id]}));

  return (
    <div>
      <Btn onClick={add} variant="ghost" style={{width:"100%",borderStyle:"dashed",marginBottom:12}}>+ Add PO</Btn>

      {safeOrders.map((o,i) => {
        const isCollapsed = !!collapsed[o.id];
        // Three states (in priority order): pickedUp > ordered > needsOrder
        const cardBg     = o.pickedUp ? "rgba(22,163,74,0.05)"
                         : o.ordered  ? "rgba(59,130,246,0.05)"
                         : o.needsOrder ? "rgba(234,88,12,0.06)"
                         : C.surface;
        const cardBorder = o.pickedUp ? "1px solid #16a34a44"
                         : o.ordered  ? "1px solid #3b82f644"
                         : o.needsOrder ? "1px solid #ea580c66"
                         : `1px solid ${C.border}`;
        return (
          <div key={o.id} style={{background:cardBg, border:cardBorder, borderRadius:10, marginBottom:12, overflow:"hidden"}}>

            {/* ── Header (always visible, click to expand/collapse) ── */}
            <div onClick={()=>toggle(o.id)}
              style={{display:"flex",alignItems:"center",gap:8,padding:"10px 14px",cursor:"pointer",userSelect:"none"}}>
              <span style={{fontSize:12,color:C.accent,fontWeight:700}}>PO #{i+1}</span>
              {o.po && <span style={{fontSize:11,color:C.muted}}>#{o.po}</span>}
              {o.needsOrder && !o.ordered && !o.pickedUp && (
                <span style={{fontSize:10,fontWeight:700,background:"#ea580c22",color:"#ea580c",
                  borderRadius:99,padding:"1px 8px"}}>{o.source==="Shop" ? "Needs to be Picked Up" : "Need to Order"}</span>
              )}
              {o.ordered && !o.pickedUp && (
                <span style={{fontSize:10,fontWeight:700,background:"#3b82f622",color:"#1d4ed8",
                  borderRadius:99,padding:"1px 8px"}}>Order Sent</span>
              )}
              {o.pickedUp && (
                <span style={{fontSize:10,fontWeight:700,background:"#16a34a22",color:"#16a34a",
                  borderRadius:99,padding:"1px 8px"}}>Picked Up</span>
              )}
              {o.source && (
                <span style={{fontSize:10,fontWeight:700,background:`${C.accent}18`,color:C.accent,
                  borderRadius:99,padding:"1px 8px"}}>{o.source}</span>
              )}
              {isCollapsed && o.items && (
                <span style={{fontSize:11,color:C.muted,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",minWidth:0}}>
                  {poItemsPreview(o.items)}
                </span>
              )}
              <span style={{marginLeft:"auto",color:C.muted,fontSize:12,flexShrink:0}}>{isCollapsed ? "▸" : "▾"}</span>
              <button onClick={e=>{e.stopPropagation();del(o.id);}}
                style={{background:"none",border:"none",color:C.muted,cursor:"pointer",fontSize:11,padding:"0 2px"}}>Remove</button>
            </div>

            {/* ── Expanded body ── */}
            {!isCollapsed && (
              <div style={{padding:"0 14px 14px"}}>
                <div style={{display:"grid",gridTemplateColumns:ON_MOBILE?"1fr 1fr":"1fr 1fr 1fr 1fr",gap:8,marginBottom:10}}>
                  <div>
                    <div style={{fontSize:10,color:C.dim,marginBottom:3}}>Source</div>
                    <select value={o.source||""} onChange={e=>upd(o.id,{source:e.target.value})}
                      style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:7,
                        color:o.source?C.accent:C.dim,padding:"6px 8px",fontSize:12,
                        fontFamily:"inherit",outline:"none",width:"100%",cursor:"pointer"}}>
                      {SOURCES.map(s=><option key={s} value={s}>{s||"— source —"}</option>)}
                    </select>
                  </div>
                  <div>
                    <div style={{fontSize:10,color:C.dim,marginBottom:3}}>Date Ordered</div>
                    <DateInp value={o.date} onChange={e=>upd(o.id,{date:e.target.value})}/>
                  </div>
                  <div>
                    <div style={{fontSize:10,color:C.dim,marginBottom:3}}>PO #</div>
                    <Inp value={o.po} onChange={e=>upd(o.id,{po:e.target.value})} placeholder="PO-001"/>
                  </div>
                  <div>
                    <div style={{fontSize:10,color:C.dim,marginBottom:3}}>Pick Up Date</div>
                    <DateInp value={o.pickupDate} onChange={e=>upd(o.id,{pickupDate:e.target.value})}/>
                  </div>
                </div>

                <div style={{fontSize:10,color:C.dim,marginBottom:4}}>Material List <span style={{color:C.muted}}>(copy & paste into Simpro)</span></div>
                <TA value={o.items} onChange={e=>upd(o.id,{items:e.target.value})}
                  placeholder={"- 20A breaker x4\n- 12/2 wire 250ft"} rows={4}/>

                {/* ── Status checkboxes ── */}
                <div style={{display:"flex",gap:16,marginTop:10,flexWrap:"wrap"}}>
                  {o.source==="Shop" ? (<>
                    <label style={{display:"flex",alignItems:"center",gap:6,cursor:"pointer",fontSize:12,color:C.text}}>
                      <input type="checkbox" checked={!!o.needsOrder} onChange={e=>upd(o.id,{needsOrder:e.target.checked})}
                        style={{accentColor:"#ea580c",width:14,height:14,cursor:"pointer"}}/>
                      Needs to be picked up
                    </label>
                    <div style={{display:"flex",flexDirection:"column",gap:2}}>
                      <label style={{display:"flex",alignItems:"center",gap:6,cursor:"pointer",fontSize:12,color:C.text}}>
                        <input type="checkbox" checked={!!o.pickedUp} onChange={e=>{
                          const val=e.target.checked; const who=getIdentity();
                          upd(o.id,{pickedUp:val,pickedUpBy:val?(who?.name||""):"",pickedUpAt:val?new Date().toLocaleDateString("en-US"):""});
                        }} style={{accentColor:"#16a34a",width:14,height:14,cursor:"pointer"}}/>
                        Picked up
                      </label>
                      {o.pickedUp&&o.pickedUpBy&&(
                        <span style={{fontSize:9,color:"#16a34a",fontWeight:600,paddingLeft:20}}>✓ by {o.pickedUpBy}{o.pickedUpAt?" · "+o.pickedUpAt:""}</span>
                      )}
                    </div>
                  </>) : (<>
                    <label style={{display:"flex",alignItems:"center",gap:6,cursor:"pointer",fontSize:12,color:C.text}}>
                      <input type="checkbox" checked={!!o.needsOrder} onChange={e=>upd(o.id,{needsOrder:e.target.checked})}
                        style={{accentColor:"#ea580c",width:14,height:14,cursor:"pointer"}}/>
                      Need to order before return
                    </label>
                    <label style={{display:"flex",alignItems:"center",gap:6,cursor:"pointer",fontSize:12,color:C.text}}>
                      <input type="checkbox" checked={!!o.deliveredToShop} onChange={e=>upd(o.id,{deliveredToShop:e.target.checked})}
                        style={{accentColor:"#8b5cf6",width:14,height:14,cursor:"pointer"}}/>
                      Delivered to shop
                    </label>
                    <div style={{display:"flex",flexDirection:"column",gap:2}}>
                      <label style={{display:"flex",alignItems:"center",gap:6,cursor:"pointer",fontSize:12,color:C.text}}>
                        <input type="checkbox" checked={!!o.ordered} onChange={e=>{
                          const val=e.target.checked; const who=getIdentity();
                          upd(o.id,{ordered:val,orderedBy:val?(who?.name||""):"",orderedAt:val?new Date().toLocaleDateString("en-US"):""});
                        }} style={{accentColor:"#3b82f6",width:14,height:14,cursor:"pointer"}}/>
                        Order sent to supplier
                      </label>
                      {o.ordered&&o.orderedBy&&(
                        <span style={{fontSize:9,color:"#3b82f6",fontWeight:600,paddingLeft:20}}>✓ by {o.orderedBy}{o.orderedAt?" · "+o.orderedAt:""}</span>
                      )}
                    </div>
                    <div style={{display:"flex",flexDirection:"column",gap:2}}>
                      <label style={{display:"flex",alignItems:"center",gap:6,cursor:"pointer",fontSize:12,color:C.text}}>
                        <input type="checkbox" checked={!!o.pickedUp} onChange={e=>{
                          const val=e.target.checked; const who=getIdentity();
                          upd(o.id,{pickedUp:val,pickedUpBy:val?(who?.name||""):"",pickedUpAt:val?new Date().toLocaleDateString("en-US"):""});
                        }} style={{accentColor:"#16a34a",width:14,height:14,cursor:"pointer"}}/>
                        Picked up
                      </label>
                      {o.pickedUp&&o.pickedUpBy&&(
                        <span style={{fontSize:9,color:"#16a34a",fontWeight:600,paddingLeft:20}}>✓ by {o.pickedUpBy}{o.pickedUpAt?" · "+o.pickedUpAt:""}</span>
                      )}
                    </div>
                  </>)}
                </div>
              </div>
            )}
          </div>
        );
      })}

      <Btn onClick={add} variant="ghost" style={{width:"100%",borderStyle:"dashed"}}>+ Add PO</Btn>
    </div>
  );
}


// ── Material Tally ────────────────────────────────────────────
// Field-use count list: add items by name, tap +/− to count, copy all as "Nx Item"
function MaterialTally({items, onChange, onAddToPO}) {
  const safe = Array.isArray(items) ? items : [];
  const [draft, setDraft] = useState("");
  const [copied, setCopied] = useState(false);
  const [addedToPO, setAddedToPO] = useState(false);

  const addItem = (nameArg) => {
    const name = typeof nameArg === "string" ? nameArg : draft;
    if (!name.trim()) return;
    onChange([...safe, {id: uid(), name: name.trim(), count: 0}]);
    setDraft("");
  };

  const updCount = (id, delta) =>
    onChange(safe.map(i => i.id === id ? {...i, count: Math.max(0, (i.count||0) + delta)} : i));

  const updName = (id, name) =>
    onChange(safe.map(i => i.id === id ? {...i, name} : i));

  const del = (id) => onChange(safe.filter(i => i.id !== id));

  const copyList = () => {
    const text = safe.map(i => `${i.count||0}x ${i.name}`).join("\n");
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  };

  const btnBase = {
    width: ON_MOBILE ? 44 : 36, height: ON_MOBILE ? 44 : 36,
    borderRadius: 8, fontSize: ON_MOBILE ? 22 : 18, fontWeight: 700,
    cursor: "pointer", fontFamily: "inherit", lineHeight: 1,
    display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
  };

  return (
    <div>
      <div style={{display:"flex",gap:6,marginBottom:10}}>
        <Inp value={draft} onChange={e=>setDraft(e.target.value)}
          placeholder="Add item…" style={{flex:1}}
          onBlur={addItem}
          onKeyDown={e=>e.key==="Enter"&&addItem()}/>
        <Btn onClick={addItem} variant="primary" style={{padding:"6px 14px",flexShrink:0}}>+</Btn>
      </div>

      {safe.map(item=>(
        <div key={item.id} style={{display:"flex",gap:8,alignItems:"center",marginBottom:7,
          padding:"8px 10px",background:C.surface,border:`1px solid ${C.border}`,borderRadius:9}}>
          <input value={item.name} onChange={e=>updName(item.id,e.target.value)}
            style={{flex:1,background:"transparent",border:"none",fontSize:13,color:C.text,
              outline:"none",fontFamily:"inherit",minWidth:0}}
            placeholder="Item name"/>
          <button onClick={()=>updCount(item.id,-1)}
            style={{...btnBase,border:`1px solid ${C.border}`,background:C.card,color:C.text}}>−</button>
          <span style={{fontSize:ON_MOBILE?18:16,fontWeight:700,color:C.text,
            minWidth:ON_MOBILE?36:28,textAlign:"center"}}>{item.count||0}</span>
          <button onClick={()=>updCount(item.id,1)}
            style={{...btnBase,border:`1px solid ${C.accent}`,background:`${C.accent}18`,color:C.accent}}>+</button>
          <button onClick={()=>del(item.id)}
            style={{background:"none",border:"none",color:C.muted,cursor:"pointer",
              fontSize:16,padding:"0 2px",lineHeight:1,flexShrink:0}}>×</button>
        </div>
      ))}

      {safe.length>0&&(
        <div style={{display:"flex",gap:8,marginTop:6,flexWrap:"wrap"}}>
          <button onClick={copyList}
            style={{flex:1,padding:"10px",borderRadius:8,
              border:`1px solid ${copied?"#16a34a55":C.border}`,
              background:copied?"#16a34a18":C.surface,
              color:copied?"#16a34a":C.dim,fontSize:12,fontWeight:700,
              cursor:"pointer",fontFamily:"inherit",transition:"all 0.2s"}}>
            {copied?"Copied":"Copy List"}
          </button>
          {onAddToPO&&(
            <button onClick={()=>{
              const counted = safe.filter(i=>(i.count||0)>0);
              if(!counted.length){ alert("No items with a count yet. Add counts first."); return; }
              const formatted = counted.map(i=>`- ${i.count}x ${i.name}`).join('<br>');
              onAddToPO(formatted);
              setAddedToPO(true);
              setTimeout(()=>setAddedToPO(false),2000);
            }}
              style={{flex:1,padding:"10px",borderRadius:8,
                border:`1px solid ${addedToPO?"#16a34a55":"#3b82f644"}`,
                background:addedToPO?"#16a34a18":"#eff6ff",
                color:addedToPO?"#16a34a":"#1d4ed8",fontSize:12,fontWeight:700,
                cursor:"pointer",fontFamily:"inherit",transition:"all 0.2s"}}>
              {addedToPO?"Added to PO":"Add to PO"}
            </button>
          )}
          <button onClick={()=>{ if(!window.confirm("Reset all counts to zero?")) return; onChange(safe.map(i=>({...i,count:0}))); }}
            style={{padding:"10px 14px",borderRadius:8,
              border:`1px solid ${C.border}`,background:C.surface,
              color:C.muted,fontSize:12,fontWeight:700,
              cursor:"pointer",fontFamily:"inherit"}}>
            Clear
          </button>
        </div>
      )}
    </div>
  );
}

// ── Daily Updates ─────────────────────────────────────────────

function DailyUpdates({updates,onChange,jobName,onEmail}) {

  const [d,setD]           = useState({date:"",text:""});

  const [showPicker,setShowPicker] = useState(false);

  const [selected,setSelected]     = useState([]);

  const add = (textArg) => { const text = typeof textArg==='string' ? textArg : d.text; if(!text.trim()) return; const who=getIdentity(); onChange([{id:uid(),date:d.date,text,addedBy:who?.name||""},...updates]); setD({date:"",text:""}); };

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
            onBlur={add}
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

          <div style={{display:"flex",flexDirection:"column",alignItems:"flex-start",flexShrink:0,gap:2}}>
            <span style={{fontSize:11,color:C.accent,whiteSpace:"nowrap",fontWeight:600}}>{u.date||"—"}</span>
            {u.addedBy&&<span style={{fontSize:9,color:C.dim,whiteSpace:"nowrap"}}>by {u.addedBy}</span>}
          </div>

          <span style={{flex:1,fontSize:12,color:C.text,lineHeight:1.5}}>{u.text}</span>

          {!showPicker&&<button onClick={()=>{ if(!window.confirm("Delete this daily update?")) return; onChange(updates.filter(x=>x.id!==u.id)); }}

            style={{background:"none",border:"none",color:C.muted,cursor:"pointer",fontSize:11,flexShrink:0}}>✕</button>}

        </div>

      ))}

    </div>

  );

}


// ── Change Orders ─────────────────────────────────────────────

function ChangeOrders({orders, onChange, jobName, jobSimproNo, onEmail, roughStatus, finishStatus}) {

  const [expandedCOs, setExpandedCOs] = useState({});
  const toggleCO = (id) => setExpandedCOs(v=>({...v,[id]:!v[id]}));

  const add = () => {
    const creator = getIdentity();
    onChange([...orders, {
      id:uid(), date:"", desc:"", task:"", material:"", time:"", sendTo:"",
      coStatus:"needs_sending", coStatusDate:"",
      needsHardDate:false, needsByStart:"", needsByEnd:"",
      createdBy: creator?.name || "",
      createdAt: new Date().toLocaleDateString("en-US"),
    }]);
  };

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

  // Sort newest first — use createdAt date desc, fall back to insertion order (reversed)
  const sortedOrders = [...orders]
    .map((o, idx) => ({...o, _idx: idx}))
    .sort((a, b) => {
      const da = a.createdAt ? new Date(a.createdAt) : null;
      const db = b.createdAt ? new Date(b.createdAt) : null;
      if (da && db) return db - da;
      if (da) return -1;
      if (db) return 1;
      return b._idx - a._idx; // no dates — reverse insertion order (newer = higher index)
    });

  return (
    <div>
      {sortedOrders.map((o, i) => {
        const coDef = getStatusDef(CO_STATUSES_NEW, o.coStatus||"pending");
        const isConverted  = o.coStatus === "converted";
        const isCompleted  = o.coStatus === "completed";
        const isApproved   = o.coStatus === "approved";
        const showConvert  = (isApproved || o.coStatus==="needs") && !crewOnSite;
        // Completed COs collapse by default; converted ones always show their note
        const isCollapsed  = isCompleted && !expandedCOs[o.id];

        return (
          <div key={o.id} style={{
            background: isCompleted ? "#16a34a0a" : isConverted ? "var(--surface)" : "var(--card)",
            border:`1px solid ${isCompleted?"#16a34a44":isConverted?"var(--border)":coDef.color?coDef.color+"33":"var(--border)"}`,
            borderLeft:`3px solid ${isCompleted?"#16a34a":isConverted?"#6b7280":coDef.color||"var(--border)"}`,
            borderRadius:11, padding:14, marginBottom:12,
            opacity: isConverted ? 0.6 : 1,
          }}>

            {/* Header */}
            <div
              onClick={isCompleted ? ()=>toggleCO(o.id) : undefined}
              style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:isCollapsed?0:10,flexWrap:"wrap",gap:8,cursor:isCompleted?"pointer":"default"}}>
              <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                <span style={{fontSize:12,color:isCompleted?"#16a34a":"var(--accent)",fontWeight:700}}>Change Order #{o._idx+1}</span>
                {isCompleted&&<span style={{fontSize:10,fontWeight:700,color:"#16a34a",background:"#16a34a18",borderRadius:99,padding:"2px 8px",border:"1px solid #16a34a33"}}>✓ WORK COMPLETED</span>}
                {isConverted&&<span style={{fontSize:10,fontWeight:700,color:"#6b7280",background:"#6b728018",borderRadius:99,padding:"2px 8px",border:"1px solid #6b728033"}}>CONVERTED TO RT</span>}
                {o.desc&&isCollapsed&&<span style={{fontSize:11,color:"var(--dim)",fontStyle:"italic"}}>{o.desc}</span>}
                {!isCollapsed&&o.createdBy&&<span style={{fontSize:10,color:"var(--dim)"}}>created by <b>{o.createdBy}</b>{o.createdAt?" · "+o.createdAt:""}</span>}
              </div>
              <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
                {isCompleted&&<span style={{fontSize:11,color:"#16a34a88"}}>{isCollapsed?"▸":"▾"}</span>}
                {!isConverted&&!isCompleted&&jobSimproNo&&<Btn onClick={()=>{
                  const msg=`Change Order #${o._idx+1} — ${jobName}\n\nDescription: ${o.desc||"—"}\nTask: ${o.task||"—"}\nMaterial: ${o.material||"—"}\nEstimated Time: ${o.time||"—"}\nSend To: ${o.sendTo||"—"}\nStatus: ${o.coStatus||"Pending"}`;
                  navigator.clipboard.writeText(msg).catch(()=>{});
                  window.open(`https://homesteadelectric.simprosuite.com/staff/editProject.php?jobID=${jobSimproNo}`,"_blank");
                }} variant="simpro" style={{fontSize:11,padding:"3px 9px"}}>Simpro</Btn>}
                {!isConverted&&!isCompleted&&<Btn onClick={()=>chatCO(o,o._idx)} variant="chat" style={{fontSize:11,padding:"3px 9px"}}>Chat</Btn>}
                {!isConverted&&!isCompleted&&<Btn onClick={()=>emailCO(o,o._idx)} variant="email" style={{fontSize:11,padding:"3px 9px"}}>Email CO</Btn>}
                {!isCollapsed&&<button onClick={e=>{e.stopPropagation(); if(!window.confirm("Delete this change order?")) return; del(o.id); }} style={{background:"none",border:"none",color:"var(--muted)",cursor:"pointer",fontSize:11}}>Remove</button>}
              </div>
            </div>

            {/* Collapsed completed view — just shows the undo button */}
            {isCollapsed&&(
              <div style={{marginTop:6,display:"flex",justifyContent:"flex-end"}}>
                <button onClick={e=>{e.stopPropagation();upd(o.id,{coStatus:"approved"});}}
                  style={{background:"none",border:"1px solid #16a34a44",borderRadius:7,
                    color:"#16a34a",fontSize:11,padding:"3px 10px",cursor:"pointer",
                    fontFamily:"inherit",fontWeight:600}}>
                  ↩ Undo Complete
                </button>
              </div>
            )}

            {/* Body — hidden when collapsed */}
            {!isCollapsed&&<>

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
                        <button onClick={()=>convertToRT(o,o._idx)} style={{
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
                <div style={{display:"grid",gridTemplateColumns:ON_MOBILE?"1fr":"1fr 1fr 1fr",gap:8,marginBottom:8}}>
                  <div>
                    <div style={{fontSize:10,color:"var(--dim)",marginBottom:3}}>Estimated Time</div>
                    <Inp value={o.time||""} onChange={e=>upd(o.id,{time:e.target.value})} placeholder="e.g. 3 hrs"/>
                  </div>
                  <div>
                    <div style={{fontSize:10,color:"var(--dim)",marginBottom:3}}>Task (In Field)</div>
                    <TA value={o.task||""} onChange={e=>upd(o.id,{task:e.target.value})} placeholder={"- Task 1\n- Task 2"} rows={3}/>
                  </div>
                  <div>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:3}}>
                      <div style={{fontSize:10,color:"var(--dim)"}}>Material Needed</div>
                      <select value={o.materialSource||""} onChange={e=>upd(o.id,{materialSource:e.target.value})}
                        style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:6,
                          color:o.materialSource?C.accent:C.dim,padding:"3px 7px",fontSize:10,
                          fontFamily:"inherit",outline:"none",cursor:"pointer"}}>
                        {MAT_SOURCES.map(s=><option key={s} value={s}>{s||"— source —"}</option>)}
                      </select>
                    </div>
                    <TA value={o.material||""} onChange={e=>upd(o.id,{material:e.target.value})} placeholder={"- Item 1\n- Item 2"} rows={3}/>
                  </div>
                </div>
              </>
            )}

            </>} {/* end !isCollapsed body */}
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
  const [expandedRTs, setExpandedRTs] = useState({}); // trip IDs manually expanded when signed off
  const toggleExpand = (id) => setExpandedRTs(v=>({...v,[id]:!v[id]}));

  const add = () => onChange([...trips, {id:uid(),date:"",scope:"",material:"",punch:[],photos:[],assignedTo:"",signedOff:false,signedOffBy:"",signedOffDate:"",needsSchedule:false,needsScheduleDate:"",rtScheduled:false,scheduledDate:""}]);

  const upd = (id,p) => onChange(trips.map(t=>t.id===id?{...t,...p}:t));

  const del = (id)   => onChange(trips.filter(t=>t.id!==id));


  const stripPunchHtml = (html) => (html||"").replace(/<[^>]*>/g,"").replace(/&nbsp;/g," ").replace(/&amp;/g,"&").trim();

  const chatTrip = (t,i) => {
    const punchOpen = (t.punch||[]).filter(p=>!p.done).map(p=>`• ${stripPunchHtml(p.text)}`).join("\n") || "None";
    const msg = `Return Trip #${i+1} — ${jobName}\n\nScope of Work: ${t.scope||"—"}\nMaterial Needed: ${t.material||"—"}\nOpen Punch Items:\n${punchOpen}\nAssigned To: ${t.assignedTo||"—"}\n\nhttps://homestead-electric.vercel.app/`;
    openGoogleChat(msg);
  };

  const emailTrip = (t,i) => {

    const punchLines = (t.punch||[]).filter(p=>!p.done).map(p=>`• ${stripPunchHtml(p.text)}`).join("\n") || "None";

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

      {[...trips]
        .sort((a, b) => {
          // Active trips first, signed-off to bottom
          if (a.signedOff !== b.signedOff) return a.signedOff ? 1 : -1;
          // Within active: sort by rtStatusDate/date ascending (soonest first), undated last
          const da = a.rtStatusDate || a.date || "";
          const db = b.rtStatusDate || b.date || "";
          if (da && db) return new Date(da) - new Date(db);
          if (da) return -1;
          if (db) return 1;
          return 0;
        })
        .map((t,i)=>{
        // Signed-off trips collapse to a summary row unless manually expanded
        if (t.signedOff && !expandedRTs[t.id]) {
          return (
            <div key={t.id} style={{display:"flex",alignItems:"center",gap:10,
              background:`${C.green}0a`,border:`1px solid ${C.green}33`,
              borderRadius:10,padding:"10px 14px",marginBottom:10}}>
              <span style={{fontSize:13,color:C.green}}>✓</span>
              <span style={{fontSize:12,fontWeight:700,color:C.dim}}>Return Trip {i+1}</span>
              {t.scope && <span style={{fontSize:11,color:C.dim,flex:1,
                whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
                {t.scope}
              </span>}
              <span style={{fontSize:11,color:C.green,fontWeight:600,whiteSpace:"nowrap"}}>
                Completed by {t.signedOffBy}
              </span>
              {t.signedOffDate && <span style={{fontSize:10,color:C.dim,whiteSpace:"nowrap"}}>
                {t.signedOffDate}
              </span>}
              <button onClick={()=>toggleExpand(t.id)}
                style={{background:"none",border:`1px solid ${C.border}`,borderRadius:6,
                  color:C.dim,fontSize:10,padding:"3px 8px",cursor:"pointer",
                  fontFamily:"inherit",whiteSpace:"nowrap",flexShrink:0}}>
                Show
              </button>
            </div>
          );
        }

        return (

        <div key={t.id} style={{background:t.needsSchedule?"rgba(220,38,38,0.06)":t.rtScheduled?"rgba(139,92,246,0.06)":t.signedOff?`${C.green}0a`:C.surface,

          border:t.needsSchedule?"1px solid #dc262655":t.rtScheduled?"1px solid #8b5cf655":t.signedOff?`1px solid ${C.green}33`:`1px solid ${C.border}`,

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

              {t.signedOff&&expandedRTs[t.id]&&(
                <button onClick={()=>toggleExpand(t.id)}
                  style={{background:"none",border:`1px solid ${C.border}`,borderRadius:6,
                    color:C.dim,fontSize:11,padding:"3px 8px",cursor:"pointer",fontFamily:"inherit"}}>
                  Collapse
                </button>
              )}
              {jobSimproNo&&<Btn onClick={()=>{
                const punchOpen=(t.punch||[]).filter(p=>!p.done).map(p=>`• ${stripPunchHtml(p.text)}`).join("\n")||"None";
                const msg=`Return Trip #${i+1} — ${jobName}\n\nScope of Work: ${t.scope||"—"}\nMaterial Needed: ${t.material||"—"}\nOpen Punch Items:\n${punchOpen}\nAssigned To: ${t.assignedTo||"—"}`;
                navigator.clipboard.writeText(msg).catch(()=>{});
                window.open(`https://homesteadelectric.simprosuite.com/staff/editProject.php?jobID=${jobSimproNo}`,"_blank");
              }} variant="simpro" style={{fontSize:11,padding:"3px 9px"}}>Simpro</Btn>}
              <Btn onClick={()=>chatTrip(t,i)} variant="chat" style={{fontSize:11,padding:"3px 9px"}}>Chat</Btn>
              <Btn onClick={()=>emailTrip(t,i)} variant="email" style={{fontSize:11,padding:"3px 9px"}}>Email Trip</Btn>

              <button onClick={()=>{ if(!window.confirm("Delete this return trip?")) return; del(t.id); }}

                style={{background:"none",border:"none",color:C.muted,cursor:"pointer",fontSize:11}}>Remove</button>

            </div>

          </div>

          <div style={{marginBottom:8}}>

            <div style={{fontSize:10,color:C.dim,marginBottom:3}}>Scope of Work</div>

            <TA value={t.scope} onChange={e=>upd(t.id,{scope:e.target.value})} placeholder="Describe return trip scope…" rows={2}/>

          </div>

          <div style={{marginBottom:8}}>

            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:3}}>
              <div style={{fontSize:10,color:C.dim}}>Material Needed</div>
              <select value={t.materialSource||""} onChange={e=>upd(t.id,{materialSource:e.target.value})}
                style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:6,
                  color:t.materialSource?C.accent:C.dim,padding:"3px 7px",fontSize:10,
                  fontFamily:"inherit",outline:"none",cursor:"pointer"}}>
                {MAT_SOURCES.map(s=><option key={s} value={s}>{s||"— source —"}</option>)}
              </select>
            </div>
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

        ); // end expanded trip
      })}


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
        <Inp value={r.name} onChange={e=>upd(r.id,{name:e.target.value})} placeholder="Load name…"
          onKeyDown={e=>e.key==="Enter"&&addRow()}/>
        <Sel value={r.status} onChange={e=>{
          const val=e.target.value;
          const who=getIdentity();
          upd(r.id,{status:val,
            statusBy:val?(who?.name||""):"",
            statusAt:val?new Date().toLocaleDateString("en-US"):"",
          });
        }} options={PULLED_OPTS}
          style={{color:r.status==="Pulled"?C.green:r.status==="Need Specs"?C.red:C.text,fontSize:10}}/>
      </div>
      {r.status&&r.statusBy&&(
        <div style={{paddingLeft:22,marginTop:2}}>
          <span style={{fontSize:9,color:r.status==="Pulled"?C.green:C.red,fontWeight:600}}>
            {r.status==="Pulled"?"✓":"!"} {r.statusBy}{r.statusAt?" · "+r.statusAt:""}
          </span>
        </div>
      )}
    </div>
  );

  const colHeaders = (
    <div style={{display:"grid",gridTemplateColumns:"22px 1fr 80px 22px",gap:4,marginBottom:4,padding:"0 2px"}}>
      {["#","Panel","Wire",""].map((h,i)=>(
        <div key={i} style={{fontSize:9,color:C.dim,fontWeight:700,letterSpacing:"0.08em"}}>{h}</div>
      ))}
    </div>
  );

  return (
    <div style={{marginBottom:24}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
        <div style={{fontSize:12,color:C.blue,fontWeight:700,letterSpacing:"0.06em"}}>{label}</div>
      </div>

      {colHeaders}
      {(()=>{
        const unpulled=rows.filter(r=>r.status!=="Pulled");
        const pulled=rows.filter(r=>r.status==="Pulled");
        return (<>
          {unpulled.map((r,i)=>renderRow(r,i))}
          {unpulled.length===0&&rows.length>0&&<div style={{fontSize:11,color:C.green,fontStyle:"italic",marginBottom:6}}>✓ All pulled</div>}
          {pulled.length>0&&(
            <>
              <div style={{display:'flex',alignItems:'center',gap:8,margin:'8px 0 6px'}}>
                <div style={{flex:1,height:1,background:'rgba(34,197,94,0.25)'}}/>
                <span style={{fontSize:9,fontWeight:700,color:C.green,letterSpacing:'0.08em',textTransform:'uppercase'}}>
                  Pulled ({pulled.length})
                </span>
                <div style={{flex:1,height:1,background:'rgba(34,197,94,0.25)'}}/>
              </div>
              {pulled.map((r,i)=>renderRow(r,i))}
            </>
          )}
          {rows.length===0&&<div style={{fontSize:11,color:C.muted,fontStyle:"italic"}}>No rows yet</div>}
        </>);
      })()}
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

  "10/2": {amps:30,  poles:2}, "10/3": {amps:30,  poles:2},

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

function HomeRunsTab({homeRuns, panelCounts, onHRChange, onCountChange, jobId, jobName, finishMaterials, onMatChange, breakerOverrides, onBreakersChange}) {
  const [newPanelName,    setNewPanelName]    = useState('');
  const [genLoads,        setGenLoads]        = useState([]);
  const [hoResponse,      setHoResponse]      = useState(null);
  const [showModal,       setShowModal]       = useState(false);
  const [sending,         setSending]         = useState(false);
  const [copied,          setCopied]          = useState(false);
  const [editingBreakers, setEditingBreakers] = useState(null); // panel name currently in edit mode
  const [addingPO,        setAddingPO]        = useState({});  // { [panelName]: selectedSource }
  const [poConfirm,       setPoConfirm]       = useState({});  // { [panelName]: confirmMessage }
  const showPOConfirm = (p, msg) => { setPoConfirm(v=>({...v,[p]:msg})); setTimeout(()=>setPoConfirm(v=>({...v,[p]:null})),3000); };

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
        }} style={{background:`${C.blue}15`,border:`1px solid ${C.blue}55`,borderRadius:6,
          color:C.blue,fontSize:11,fontWeight:700,padding:'4px 12px',cursor:'pointer',fontFamily:'inherit',letterSpacing:'0.05em'}}>
          Share ↗
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
        {(()=>{
          const cp=homeRuns.customPanels||DEFAULT_PANELS;

          // ── Inline panel breaker summary ──
          const extraRows=(homeRuns.extraFloors||[]).flatMap(ef=>homeRuns[ef.key]||[]);
          const allHRRows=[...(homeRuns.main||[]),...(homeRuns.upper||[]),...(homeRuns.basement||[]),...extraRows];
          const panels=getPanelOpts(cp).filter(p=>p!==""&&p!=="Meter");
          const bOvr=breakerOverrides||{};
          const panelData=panels.map(p=>{
            const rows=allHRRows.filter(r=>r.panel===p&&WIRE_BREAKER[r.wire]);
            if(!rows.length && !bOvr[p]) return null;
            const groups={};
            rows.forEach(r=>{
              const {amps,poles}=WIRE_BREAKER[r.wire];
              const key=`${amps}A ${poles===1?"1P":"2P"}`;
              if(!groups[key]) groups[key]={amps,poles,count:0,spaces:0};
              groups[key].count++; groups[key].spaces+=poles;
            });
            const autoGroups=Object.entries(groups).sort((a,b)=>a[1].amps-b[1].amps);
            const isManual=!!bOvr[p];
            // activeGroups: [{id,amps,poles,count}] — manual override or derived from auto
            const activeGroups=isManual ? bOvr[p] : autoGroups.map(([,g])=>({id:uid(),amps:g.amps,poles:g.poles,count:g.count}));
            const calcSpaces=activeGroups.reduce((s,g)=>s+(g.poles*g.count),0);
            const override=panelCounts?.[p]||"";
            const displaySpaces=override?parseInt(override,10)||calcSpaces:calcSpaces;
            return {p,displaySpaces,override,activeGroups,autoGroups,isManual};
          }).filter(Boolean);

          // helpers for breaker override editing
          const saveBreakers=(p,groups)=>{ if(onBreakersChange) onBreakersChange({...bOvr,[p]:groups}); };
          const resetBreakers=(p)=>{ if(onBreakersChange){ const n={...bOvr}; delete n[p]; onBreakersChange(n); } };
          const updBreaker=(p,id,patch)=>saveBreakers(p,(bOvr[p]||[]).map(g=>g.id===id?{...g,...patch}:g));
          const delBreaker=(p,id)=>saveBreakers(p,(bOvr[p]||[]).filter(g=>g.id!==id));
          const addBreaker=(p,currentGroups)=>saveBreakers(p,[...currentGroups,{id:uid(),amps:20,poles:1,count:1}]);
          const enterEdit=(p,activeGroups)=>{ if(!bOvr[p]) saveBreakers(p,activeGroups.map(g=>({...g,id:uid()}))); setEditingBreakers(p); };

          return (
            <>
            {/* Panel summary cards */}
            {panelData.length>0&&(
              <div style={{display:'flex',flexWrap:'wrap',gap:8,marginBottom:14}}>
                {panelData.map(({p,displaySpaces,override,activeGroups,autoGroups,isManual})=>{
                  const isEditing=editingBreakers===p;
                  const editGroups=bOvr[p]||activeGroups;
                  return (
                  <div key={p} style={{background:`${C.blue}0a`,border:`1px solid ${isManual?C.orange:C.blue}33`,
                    borderRadius:9,padding:'8px 12px',minWidth:160}}>

                    {/* Header row */}
                    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:4}}>
                      <span style={{fontSize:10,fontWeight:800,color:C.blue,letterSpacing:'0.08em',textTransform:'uppercase'}}>{p}</span>
                      <div style={{display:'flex',gap:4,alignItems:'center'}}>
                        {isManual&&<span style={{fontSize:8,fontWeight:700,color:C.orange,background:`${C.orange}18`,
                          borderRadius:99,padding:'1px 5px'}}>MANUAL</span>}
                        <button onClick={()=>isEditing?setEditingBreakers(null):enterEdit(p,activeGroups)}
                          style={{fontSize:9,background:'none',border:'none',cursor:'pointer',color:C.dim,padding:'0 2px'}}>
                          {isEditing?'✓ Done':'✏ Edit'}
                        </button>
                      </div>
                    </div>

                    {/* Space count */}
                    <div style={{fontSize:18,fontWeight:700,color:C.text,lineHeight:1,marginBottom:6}}>
                      {displaySpaces}
                      <span style={{fontSize:10,fontWeight:400,color:C.dim,marginLeft:4}}>spaces</span>
                      {override&&<span style={{fontSize:9,color:C.orange,marginLeft:4}}>override</span>}
                    </div>

                    {/* Chips (view mode) or edit rows (edit mode) */}
                    {!isEditing?(
                      <div style={{display:'flex',flexWrap:'wrap',gap:4,marginBottom:7}}>
                        {activeGroups.map((g)=>{
                          const chipColor=g.amps>=50?C.orange:g.amps>=30?C.blue:'#888';
                          return (
                            <div key={g.id} style={{display:'inline-flex',alignItems:'center',gap:3,
                              background:`${chipColor}18`,border:`1px solid ${chipColor}55`,
                              borderRadius:5,padding:'3px 7px'}}>
                              <span style={{fontSize:13,fontWeight:800,color:chipColor,lineHeight:1}}>{g.amps}A</span>
                              <span style={{fontSize:9,fontWeight:600,color:chipColor,opacity:0.7}}>{g.poles===2?'2P':'1P'}</span>
                              <span style={{fontSize:10,fontWeight:500,color:C.text,marginLeft:1}}>×{g.count}</span>
                            </div>
                          );
                        })}
                      </div>
                    ):(
                      <div style={{marginBottom:7}}>
                        {editGroups.map((g)=>{
                          const chipColor=g.amps>=50?C.orange:g.amps>=30?C.blue:'#888';
                          return (
                            <div key={g.id} style={{display:'flex',alignItems:'center',gap:4,marginBottom:5}}>
                              <input type="number" value={g.amps} min={15} max={200} step={5}
                                onChange={e=>updBreaker(p,g.id,{amps:parseInt(e.target.value)||20})}
                                style={{width:44,background:C.surface,border:`1px solid ${chipColor}66`,borderRadius:4,
                                  padding:'3px 4px',fontSize:12,fontWeight:700,color:chipColor,textAlign:'center',fontFamily:'inherit'}}/>
                              <span style={{fontSize:10,color:C.dim}}>A</span>
                              <button onClick={()=>updBreaker(p,g.id,{poles:g.poles===1?2:1})}
                                style={{fontSize:9,fontWeight:700,padding:'3px 6px',borderRadius:4,cursor:'pointer',fontFamily:'inherit',
                                  background:`${chipColor}18`,border:`1px solid ${chipColor}55`,color:chipColor}}>
                                {g.poles===2?'2P':'1P'}
                              </button>
                              <span style={{fontSize:10,color:C.dim}}>×</span>
                              <input type="number" value={g.count} min={1} max={99}
                                onChange={e=>updBreaker(p,g.id,{count:parseInt(e.target.value)||1})}
                                style={{width:36,background:C.surface,border:`1px solid ${C.border}`,borderRadius:4,
                                  padding:'3px 4px',fontSize:12,fontWeight:600,color:C.text,textAlign:'center',fontFamily:'inherit'}}/>
                              <button onClick={()=>delBreaker(p,g.id)}
                                style={{background:'none',border:'none',cursor:'pointer',color:C.dim,fontSize:14,
                                  lineHeight:1,padding:'0 2px',fontWeight:700,fontFamily:'inherit'}}>×</button>
                            </div>
                          );
                        })}
                        <div style={{display:'flex',gap:5,marginTop:2}}>
                          <button onClick={()=>addBreaker(p,editGroups)}
                            style={{fontSize:9,fontWeight:700,padding:'3px 8px',borderRadius:4,cursor:'pointer',fontFamily:'inherit',
                              background:`${C.blue}18`,border:`1px solid ${C.blue}44`,color:C.blue}}>
                            + Add Breaker
                          </button>
                          {isManual&&(
                            <button onClick={()=>{resetBreakers(p);setEditingBreakers(null);}}
                              style={{fontSize:9,padding:'3px 8px',borderRadius:4,cursor:'pointer',fontFamily:'inherit',
                                background:'none',border:`1px solid ${C.border}`,color:C.dim}}>
                              ↺ Reset to Auto
                            </button>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Space count override input */}
                    <input value={override} onChange={e=>onCountChange({...panelCounts,[p]:e.target.value})}
                      placeholder="Space count override…"
                      style={{width:'100%',background:C.surface,border:`1px solid ${C.border}`,
                        borderRadius:5,padding:'3px 6px',fontSize:10,fontFamily:'inherit',
                        outline:'none',color:C.text,boxSizing:'border-box',marginBottom:6}}/>

                    {/* Add to PO */}
                    {onMatChange&&(addingPO[p]===undefined?(
                      <button onClick={()=>setAddingPO(v=>({...v,[p]:""}))}
                        style={{width:'100%',background:`${C.blue}18`,border:`1px solid ${C.blue}44`,
                          borderRadius:5,padding:'4px 6px',fontSize:10,fontWeight:700,color:C.blue,
                          cursor:'pointer',fontFamily:'inherit'}}>
                        + Add to PO
                      </button>
                    ):(
                      <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:6,padding:'8px'}}>
                        <div style={{fontSize:10,fontWeight:700,color:C.text,marginBottom:5}}>Supplier</div>
                        <select value={addingPO[p]} onChange={e=>setAddingPO(v=>({...v,[p]:e.target.value}))}
                          style={{width:'100%',background:C.surface,border:`1px solid ${C.border}`,borderRadius:5,
                            padding:'4px 6px',fontSize:11,color:addingPO[p]?C.text:C.dim,fontFamily:'inherit',marginBottom:6}}>
                          <option value="">— choose supplier —</option>
                          {["Shop","Home Depot","CED","Platt","Amazon","Other"].map(s=>(
                            <option key={s} value={s}>{s}</option>
                          ))}
                        </select>
                        <div style={{display:'flex',gap:5}}>
                          <button onClick={()=>{
                            const src=addingPO[p];
                            if(!src) return;
                            const lines=activeGroups.map(g=>`${g.count}× ${g.amps}A ${g.poles===2?"2-pole":"1-pole"}`).join('<br>');
                            const newItems=`<b>Breakers — ${p}</b><br>${lines}`;
                            const mats=Array.isArray(finishMaterials)?[...finishMaterials]:[];
                            let targetIdx=-1;
                            mats.forEach((o,i)=>{ if(o.source===src&&!o.ordered&&!o.pickedUp) targetIdx=i; });
                            if(targetIdx>=0){
                              mats[targetIdx]={...mats[targetIdx],
                                items:(mats[targetIdx].items?mats[targetIdx].items+'<br><br>':'')+newItems};
                              showPOConfirm(p,`✓ Added to existing ${src} PO`);
                            } else {
                              mats.push({id:uid(),date:"",po:"",pickupDate:"",source:src,items:newItems,pickedUp:false,needsOrder:true,ordered:false});
                              showPOConfirm(p,`✓ Created new ${src} PO`);
                            }
                            onMatChange(mats);
                            setAddingPO(v=>({...v,[p]:undefined}));
                          }} disabled={!addingPO[p]}
                            style={{flex:1,background:`${C.blue}18`,border:`1px solid ${C.blue}44`,borderRadius:5,
                              padding:'4px 6px',fontSize:10,fontWeight:700,color:addingPO[p]?C.blue:C.dim,
                              cursor:addingPO[p]?'pointer':'default',fontFamily:'inherit'}}>
                            Add
                          </button>
                          <button onClick={()=>setAddingPO(v=>({...v,[p]:undefined}))}
                            style={{background:'none',border:`1px solid ${C.border}`,borderRadius:5,
                              padding:'4px 8px',fontSize:10,color:C.dim,cursor:'pointer',fontFamily:'inherit'}}>
                            Cancel
                          </button>
                        </div>
                      </div>
                    ))}
                    {poConfirm[p]&&(
                      <div style={{marginTop:6,fontSize:10,fontWeight:700,color:'#16a34a',
                        background:'#16a34a12',border:'1px solid #16a34a33',
                        borderRadius:5,padding:'4px 8px',textAlign:'center'}}>
                        {poConfirm[p]}
                      </div>
                    )}
                  </div>
                );})}
              </div>
            )}

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
          );
        })()}
      </Section>

      <Section label="Load Mapping Notes" color={C.blue}>
        <TA value={homeRuns.loadMappingNotes||''} onChange={e=>onHRChange({...homeRuns,loadMappingNotes:e.target.value})} placeholder="Load mapping notes…" rows={5}/>
      </Section>
    </div>
  );
}

// ── Panelized Lighting ────────────────────────────────────────

// ── Central Loads List ────────────────────────────────────────
function LoadsList({loads,onChange,floorOptions,allModules=[],assignedModMap=new Map(),onAssignToModule}) {
  const sortByType = (arr) => [...arr].sort((a,b)=>{
    const ai = LOAD_TYPES.indexOf(a.loadType||""), bi = LOAD_TYPES.indexOf(b.loadType||"");
    return (ai<0?999:ai)-(bi<0?999:bi);
  });
  const upd = (id,p) => {
    const updated = loads.map(l=>l.id===id?{...l,...p}:l);
    onChange("loadType" in p ? sortByType(updated) : updated);
  };
  const del = (id)   => onChange(loads.filter(l=>l.id!==id));

  const [selecting, setSelecting] = useState(false);
  const [selected,  setSelected]  = useState(new Set());
  const [focusLast, setFocusLast] = useState(false);
  const [batchLoc,  setBatchLoc]  = useState("");
  const [batchMod,  setBatchMod]  = useState("");
  const lastRef = useRef(null);

  const add = () => { onChange([...loads, newCentralLoad()]); setFocusLast(true); };

  const exitSelect = () => { setSelecting(false); setSelected(new Set()); setBatchLoc(""); setBatchMod(""); };

  useEffect(()=>{
    if(focusLast && lastRef.current){ lastRef.current.focus(); setFocusLast(false); }
  },[loads.length, focusLast]);

  const toggleSel  = (id) => setSelected(s=>{ const n=new Set(s); n.has(id)?n.delete(id):n.add(id); return n; });
  const allSel     = loads.length>0 && loads.every(l=>selected.has(l.id));
  const toggleAll  = () => setSelected(allSel ? new Set() : new Set(loads.map(l=>l.id)));

  const applyBatchLoc = () => {
    if(!batchLoc.trim()) return;
    onChange(loads.map(l=>selected.has(l.id)?{...l,location:batchLoc.trim()}:l));
    setSelected(new Set()); setBatchLoc("");
  };
  const applyBatchMod = () => {
    if(!batchMod||!onAssignToModule) return;
    const [floorKey,modNum,isExtraStr] = batchMod.split("|");
    onAssignToModule([...selected], modNum, floorKey, isExtraStr==="1");
    setSelected(new Set()); setBatchMod("");
  };

  const namedLoads  = loads.filter(l=>l.name.trim());
  const pulledCount = namedLoads.filter(l=>l.pulled).length;
  const pullPct     = namedLoads.length>0 ? Math.round((pulledCount/namedLoads.length)*100) : 0;
  const COL = selecting ? "20px 16px 24px 1fr 100px 72px 52px 20px" : "16px 24px 1fr 100px 72px 52px 20px";
  const mob = ON_MOBILE;

  return (
    <div style={{marginBottom:22}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
        <span style={{fontSize:10,color:C.dim,fontWeight:700,letterSpacing:"0.07em",textTransform:"uppercase"}}>
          All Loads&nbsp;<span style={{color:`${C.purple}99`,fontWeight:400,textTransform:"none"}}>— define here, assign to keypads &amp; modules below</span>
        </span>
        <div style={{display:"flex",gap:6}}>
          {loads.length>0&&(
            <button onClick={selecting?exitSelect:()=>setSelecting(true)}
              style={{fontSize:11,fontWeight:700,padding:"3px 10px",borderRadius:99,cursor:"pointer",fontFamily:"inherit",
                background:selecting?`${C.purple}18`:"none",
                border:`1px solid ${selecting?C.purple:C.border}`,
                color:selecting?C.purple:C.dim}}>
              {selecting?"✕ Cancel":"Select"}
            </button>
          )}
        </div>
      </div>

      {/* ── Action bar (visible in select mode with rows selected) ── */}
      {selecting&&selected.size>0&&(
        <div style={{background:`${C.purple}0d`,border:`1px solid ${C.purple}33`,borderRadius:8,
          padding:"8px 10px",marginBottom:10,display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
          <span style={{fontSize:11,fontWeight:700,color:C.purple,whiteSpace:"nowrap"}}>{selected.size} selected</span>
          {/* Set location */}
          <input list="pl-floor-batch" value={batchLoc} onChange={e=>setBatchLoc(e.target.value)}
            onKeyDown={e=>e.key==="Enter"&&applyBatchLoc()} placeholder="Set location…"
            style={{background:"#fff",border:`1px solid ${C.purple}44`,borderRadius:6,
              padding:"4px 8px",fontSize:11,fontFamily:"inherit",outline:"none",color:C.text,width:130}}/>
          <datalist id="pl-floor-batch">{(floorOptions||[]).map(f=><option key={f} value={f}/>)}</datalist>
          <button onClick={applyBatchLoc}
            style={{background:C.purple,color:"#fff",border:"none",borderRadius:6,
              padding:"4px 10px",fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"inherit",whiteSpace:"nowrap"}}>
            Set Location
          </button>
          {/* Add to module */}
          {allModules.length>0&&<>
            <select value={batchMod} onChange={e=>setBatchMod(e.target.value)}
              style={{background:"#fff",border:`1px solid ${C.purple}44`,borderRadius:6,
                padding:"4px 8px",fontSize:11,fontFamily:"inherit",outline:"none",
                color:batchMod?C.text:C.dim,flex:1,minWidth:160}}>
              <option value="">Add to module…</option>
              {allModules.map(m=>(
                <option key={`${m.floorKey}|${m.modNum}`} value={`${m.floorKey}|${m.modNum}|${m.isExtra?1:0}`}>
                  {m.label}
                </option>
              ))}
            </select>
            <button onClick={applyBatchMod} disabled={!batchMod}
              style={{background:batchMod?C.purple:`${C.purple}44`,color:"#fff",border:"none",borderRadius:6,
                padding:"4px 10px",fontSize:11,fontWeight:700,cursor:batchMod?"pointer":"default",
                fontFamily:"inherit",whiteSpace:"nowrap"}}>
              Add to Module
            </button>
          </>}
          <button onClick={exitSelect}
            style={{background:"none",border:"none",color:C.muted,cursor:"pointer",fontSize:11,fontFamily:"inherit"}}>
            Clear
          </button>
        </div>
      )}

      {loads.length===0 ? (
        <div style={{fontSize:11,color:C.dim,textAlign:"center",padding:"14px 0",
          border:`1px dashed ${C.border}`,borderRadius:8,background:C.surface}}>
          No loads yet — add loads, then assign them to keypads and modules
        </div>
      ) : (
        <>
          {namedLoads.length>0&&(()=>{
            // Build per-floor counts
            const byFloor = {};
            namedLoads.forEach(l=>{
              const fl = l.location||"Unassigned";
              if(!byFloor[fl]) byFloor[fl]={total:0,pulled:0};
              byFloor[fl].total++;
              if(l.pulled) byFloor[fl].pulled++;
            });
            const floors = Object.entries(byFloor);
            return (
              <div style={{marginBottom:10}}>
                {/* Total bar */}
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                  <span style={{fontSize:10,color:C.dim,fontWeight:700}}>Total</span>
                  <span style={{fontSize:11,fontWeight:700,color:pullPct===100?C.green:C.purple}}>{pulledCount}/{namedLoads.length} — {pullPct}%</span>
                </div>
                <div style={{height:5,background:C.border,borderRadius:99,overflow:"hidden",marginBottom:8}}>
                  <div style={{height:"100%",width:`${pullPct}%`,background:pullPct===100?C.green:C.purple,borderRadius:99,transition:"width 0.4s"}}/>
                </div>
                {/* Per-floor rows */}
                {floors.length>1&&floors.map(([fl,{total,pulled:p}])=>{
                  const pct = Math.round((p/total)*100);
                  return (
                    <div key={fl} style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
                      <span style={{fontSize:10,color:C.dim,width:90,flexShrink:0,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{fl}</span>
                      <div style={{flex:1,height:4,background:C.border,borderRadius:99,overflow:"hidden"}}>
                        <div style={{height:"100%",width:`${pct}%`,background:pct===100?C.green:`${C.purple}99`,borderRadius:99,transition:"width 0.4s"}}/>
                      </div>
                      <span style={{fontSize:10,fontWeight:700,color:pct===100?C.green:C.dim,whiteSpace:"nowrap"}}>{p}/{total}</span>
                    </div>
                  );
                })}
              </div>
            );
          })()}
          {!mob&&(
            <div style={{display:"grid",gridTemplateColumns:COL,gap:6,marginBottom:4,paddingBottom:4,borderBottom:`1px solid ${C.border}`,alignItems:"center"}}>
              {selecting&&<input type="checkbox" checked={allSel} onChange={toggleAll}
                style={{width:14,height:14,accentColor:C.purple,cursor:"pointer",margin:0}}/>}
              {["✓","#","Load Name","Location","Type","Watts",""].map((h,i)=>(
                <div key={i} style={{fontSize:10,color:C.dim,fontWeight:700,letterSpacing:"0.07em",textAlign:i===0?"center":"left"}}>{h}</div>
              ))}
            </div>
          )}
          {(()=>{
            // Group by floor, Unassigned first, then alpha; loads alpha within each floor
            const groups = {};
            loads.forEach(l=>{ const fl=(l.location||"").trim()||"Unassigned"; if(!groups[fl])groups[fl]=[]; groups[fl].push(l); });
            const sortedFloors = Object.keys(groups).sort((a,b)=>a==="Unassigned"?-1:b==="Unassigned"?1:a.localeCompare(b));
            sortedFloors.forEach(fl=>groups[fl].sort((a,b)=>(a.name||"").localeCompare(b.name||"")));
            const flatSorted = sortedFloors.flatMap(fl=>groups[fl]);
            const multiFloor = sortedFloors.length>1||(sortedFloors.length===1&&sortedFloors[0]!=="Unassigned");
            return (
              <>
                {sortedFloors.map(fl=>(
                  <div key={fl}>
                    {multiFloor&&(
                      <div style={{display:"flex",alignItems:"center",gap:8,margin:"10px 0 4px"}}>
                        <span style={{fontSize:10,fontWeight:800,color:C.purple,letterSpacing:"0.08em",textTransform:"uppercase",whiteSpace:"nowrap"}}>{fl}</span>
                        <div style={{flex:1,height:1,background:`${C.purple}28`}}/>
                        <span style={{fontSize:10,color:C.dim,whiteSpace:"nowrap"}}>{groups[fl].length} load{groups[fl].length!==1?"s":""}</span>
                      </div>
                    )}
                    {groups[fl].map(l=>{
                      const li=flatSorted.indexOf(l);
                      const assignedLabels=assignedModMap.has(l.name?.trim())?assignedModMap.get(l.name.trim()):null;
                      if(mob) return (
                        <div key={l.id} style={{marginBottom:6,borderRadius:8,padding:"8px 10px",
                          background:l.pulled?"rgba(34,197,94,0.08)":selecting&&selected.has(l.id)?`${C.purple}0d`:C.surface,
                          border:`1px solid ${l.pulled?"#22c55e44":C.border}`}}>
                          {/* Row 1: select + pulled + number + name + delete */}
                          <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:6}}>
                            {selecting&&<input type="checkbox" checked={selected.has(l.id)} onChange={()=>toggleSel(l.id)}
                              style={{width:16,height:16,accentColor:C.purple,cursor:"pointer",flexShrink:0}}/>}
                            <input type="checkbox" checked={!!l.pulled} onChange={e=>upd(l.id,{pulled:e.target.checked})}
                              title="Mark as pulled"
                              style={{width:18,height:18,accentColor:C.green,cursor:"pointer",flexShrink:0}}/>
                            <span style={{fontSize:11,color:C.muted,flexShrink:0}}>{li+1}.</span>
                            <input
                              ref={li===flatSorted.length-1?lastRef:null}
                              value={l.name} onChange={e=>upd(l.id,{name:e.target.value})} placeholder="Load name…"
                              onKeyDown={e=>e.key==="Enter"&&add()}
                              style={{background:"transparent",border:"none",borderBottom:`1px solid ${C.border}`,borderRadius:0,
                                color:C.text,padding:"4px 2px",fontSize:14,fontFamily:"inherit",outline:"none",
                                flex:1,minWidth:0,fontWeight:600}}/>
                            <button onClick={()=>del(l.id)} style={{background:"none",border:"none",color:C.muted,cursor:"pointer",fontSize:16,padding:"0 2px",flexShrink:0}}>✕</button>
                          </div>
                          {/* Row 2: location + type + watts + assigned badge */}
                          <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap",paddingLeft:48}}>
                            <input list="pl-floor-opts" value={l.location||""} onChange={e=>upd(l.id,{location:e.target.value})}
                              placeholder="Floor / area"
                              style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:6,color:C.text,
                                padding:"4px 8px",fontSize:11,fontFamily:"inherit",outline:"none",flex:1,minWidth:80}}/>
                            <Sel value={l.loadType||""} onChange={e=>upd(l.id,{loadType:e.target.value})} options={LOAD_TYPES}
                              style={{fontSize:11,flex:"0 0 auto"}}/>
                            <Inp value={l.watts||""} onChange={e=>upd(l.id,{watts:e.target.value})} placeholder="W"
                              style={{textAlign:"center",fontSize:11,width:46,flexShrink:0}}/>
                            {assignedLabels&&(
                              <span title={assignedLabels.join(", ")}
                                style={{fontSize:9,fontWeight:800,color:C.purple,background:`${C.purple}15`,
                                  border:`1px solid ${C.purple}33`,borderRadius:99,padding:"2px 7px",
                                  whiteSpace:"nowrap",cursor:"default"}}>
                                ✓ {assignedLabels[0]}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                      return (
                        <div key={l.id} style={{display:"grid",gridTemplateColumns:COL,gap:6,marginBottom:4,alignItems:"center",
                          borderRadius:6,padding:"2px 0",
                          background:l.pulled?"rgba(34,197,94,0.08)":selecting&&selected.has(l.id)?`${C.purple}0d`:"transparent"}}>
                          {selecting&&<input type="checkbox" checked={selected.has(l.id)} onChange={()=>toggleSel(l.id)}
                            style={{width:14,height:14,accentColor:C.purple,cursor:"pointer",margin:0}}/>}
                          <input type="checkbox" checked={!!l.pulled} onChange={e=>upd(l.id,{pulled:e.target.checked})}
                            title="Mark as pulled"
                            style={{width:15,height:15,accentColor:C.green,cursor:"pointer",margin:"0 auto",display:"block"}}/>
                          <span style={{fontSize:11,color:C.muted,textAlign:"right",paddingRight:2}}>{li+1}.</span>
                          <div style={{display:"flex",alignItems:"center",gap:4}}>
                            <input
                              ref={li===flatSorted.length-1?lastRef:null}
                              value={l.name} onChange={e=>upd(l.id,{name:e.target.value})} placeholder="Load name…"
                              onKeyDown={e=>e.key==="Enter"&&add()}
                              style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:7,color:C.text,
                                padding:"6px 10px",fontSize:12,fontFamily:"inherit",outline:"none",width:"100%",boxSizing:"border-box",
                                flex:1}}/>
                            {assignedLabels&&(
                              <span title={assignedLabels.join(", ")}
                                style={{fontSize:9,fontWeight:800,color:C.purple,background:`${C.purple}15`,
                                  border:`1px solid ${C.purple}33`,borderRadius:99,padding:"2px 6px",
                                  whiteSpace:"nowrap",flexShrink:0,cursor:"default"}}>
                                ✓ {assignedLabels[0]}
                              </span>
                            )}
                          </div>
                          <input list="pl-floor-opts" value={l.location||""} onChange={e=>upd(l.id,{location:e.target.value})}
                            placeholder="Floor / area"
                            style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:7,color:C.text,
                              padding:"6px 8px",fontSize:11,fontFamily:"inherit",outline:"none",width:"100%",boxSizing:"border-box"}}/>
                          <Sel value={l.loadType||""} onChange={e=>upd(l.id,{loadType:e.target.value})} options={LOAD_TYPES} style={{fontSize:10}}/>
                          <Inp value={l.watts||""} onChange={e=>upd(l.id,{watts:e.target.value})} placeholder="W" style={{textAlign:"center",fontSize:10}}/>
                          <button onClick={()=>del(l.id)} style={{background:"none",border:"none",color:C.muted,cursor:"pointer",fontSize:13,padding:"0 2px"}}>✕</button>
                        </div>
                      );
                    })}
                  </div>
                ))}
                <datalist id="pl-floor-opts">{(floorOptions||[]).map(f=><option key={f} value={f}/>)}</datalist>
              </>
            );
          })()}
        </>
      )}
      <button onClick={add}
        style={{background:"none",border:`1px dashed ${C.purple}44`,color:`${C.purple}88`,borderRadius:7,
          padding:7,fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"inherit",width:"100%",
          letterSpacing:"0.04em",marginTop:6}}>
        + Add Load
      </button>
    </div>
  );
}

function KeypadSection({loads,onChange,label,allLoads=[]}) {

  const dlId   = `kp-dl-${label.replace(/\W+/g,'-')}`;
  const upd    = (id,p) => onChange(loads.map(r=>r.id===id?{...r,...p}:r));

  const [focusLast, setFocusLast] = useState(false);
  const lastRef = useRef(null);
  useEffect(()=>{ if(focusLast&&lastRef.current){lastRef.current.focus();setFocusLast(false);} },[loads.length,focusLast]);

  const addRow = () => { onChange([...loads, newKPRow(loads.length+1)]); setFocusLast(true); };

  const delRow = (id) => onChange(loads.filter(r=>r.id!==id).map((r,i)=>({...r,num:i+1})));

  const namedRows = loads.filter(r=>r.name.trim());
  const pulledCount = namedRows.filter(r=>r.status==="Pulled").length;
  const pct = namedRows.length>0 ? Math.round((pulledCount/namedRows.length)*100) : 0;

  return (

    <div style={{marginBottom:22}}>

      <div style={{marginBottom:6}}>
        <div style={{fontSize:12,color:C.purple,fontWeight:700}}>{label}</div>
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

      {allLoads.length>0&&<datalist id={dlId}>{allLoads.filter(l=>l.name.trim()).map(l=><option key={l.id} value={l.name}/>)}</datalist>}

      <div style={{display:"grid",gridTemplateColumns:"36px 1fr 80px 28px",gap:6,marginBottom:6}}>

        {["#","Keypad Load Name","Status",""].map((h,i)=>(

          <div key={i} style={{fontSize:10,color:C.dim,fontWeight:700,letterSpacing:"0.08em"}}>{h}</div>

        ))}

      </div>

      {loads.map((r,ri)=>(

        <div key={r.id} style={{display:"grid",gridTemplateColumns:"36px 1fr 80px 28px",gap:6,marginBottom:4,alignItems:"center",
          borderRadius:6,padding:"3px 0",
          background:r.status==="Pulled"?"rgba(34,197,94,0.08)":r.status==="Need Specs"?"rgba(239,68,68,0.08)":"transparent"}}>

          <span style={{fontSize:11,color:C.muted,textAlign:"right",paddingRight:6}}>{r.num}.</span>

          <input ref={ri===loads.length-1?lastRef:null}
            list={allLoads.length>0?dlId:undefined}
            value={r.name} onChange={e=>upd(r.id,{name:e.target.value})} placeholder="Load name…"
            onKeyDown={e=>e.key==="Enter"&&addRow()}
            style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:7,color:C.text,
              padding:"6px 10px",fontSize:12,fontFamily:"inherit",outline:"none",width:"100%",boxSizing:"border-box"}}/>

          <Sel value={r.status||""} onChange={e=>upd(r.id,{status:e.target.value})} options={PULLED_OPTS}
            style={{color:r.status==="Pulled"?C.green:r.status==="Need Specs"?C.red:C.text,fontSize:10}}/>

          <button onClick={()=>delRow(r.id)}

            style={{background:"none",border:"none",color:C.muted,cursor:"pointer",fontSize:13,padding:"0 2px"}}>✕</button>

        </div>

      ))}

      <button onClick={addRow}
        style={{background:"none",border:`1px dashed ${C.purple}44`,color:`${C.purple}88`,borderRadius:7,
          padding:7,fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"inherit",width:"100%",
          letterSpacing:"0.04em",marginTop:4}}>
        + Add Row
      </button>

    </div>

  );

}


function PanelModulesSection({modules,onChange,system,allLoads=[]}) {

  const sys = system||"Control 4";
  const isSav = sys==="Savant", isLut = sys==="Lutron", isCres = sys==="Crestron";
  const devLabel = isCres?"Device":"Module";

  const [winW, setWinW] = useState(window.innerWidth);
  useEffect(()=>{
    const handle=()=>setWinW(window.innerWidth);
    window.addEventListener("resize",handle);
    return ()=>window.removeEventListener("resize",handle);
  },[]);
  const narrow = winW < 640;

  const updMod  = (mid,p) => onChange(modules.map(m=>m.id===mid?{...m,...p}:m));
  const delMod  = (mid)   => onChange(modules.filter(m=>m.id!==mid));
  const addMod  = ()      => onChange([...modules, newModuleObj(modules.length+1)]);

  const updLoad  = (mid,lid,p) => onChange(modules.map(m=>m.id===mid?{...m,loads:m.loads.map(l=>l.id===lid?{...l,...p}:l)}:m));
  const delLoad  = (mid,lid)   => onChange(modules.map(m=>m.id===mid?{...m,loads:m.loads.filter(l=>l.id!==lid).map((l,i)=>({...l,num:i+1}))}:m));

  const pendingFocusMid = useRef(null);
  const addLoad  = (mid) => {
    onChange(modules.map(m=>m.id===mid?{...m,loads:[...m.loads,newLoadRow(m.loads.length+1)]}:m));
    pendingFocusMid.current = mid;
  };
  const moveLoad = (fromMid,lid,toMid) => {
    if(fromMid===toMid) return;
    const load = modules.find(m=>m.id===fromMid)?.loads.find(l=>l.id===lid);
    if(!load) return;
    onChange(modules.map(m=>{
      if(m.id===fromMid) return {...m,loads:m.loads.filter(l=>l.id!==lid).map((l,i)=>({...l,num:i+1}))};
      if(m.id===toMid)   return {...m,loads:[...m.loads,{...load,num:m.loads.length+1}]};
      return m;
    }));
  };

  const moduleTypes = isLut?LUT_MODULE_TYPES:isCres?CRES_MODULE_TYPES:isSav?SAV_MODULE_TYPES:C4_MODULE_TYPES;

  const chCap = (type) => ({
    "8-Ch Dimmer":8,"8-Ch Relay":8,"LMD-8120":8,"LQSE-S8":8,
    "0-10V Dimmer":2,"LQSE-2ECO":2,"LQSE-2DAL":2,
    "LQSE-4A":4,"LMD-4120":4,"LQSE-T5":5,
  }[type]||null);

  const showKeypad = !isSav&&!isLut&&!isCres;
  const showMove = modules.length > 1;
  const rowGrid = `16px 22px 1fr 36px 70px 52px${showKeypad?" 70px":""}${showMove?" 44px":""} 20px`;
  const rowHeaders = ["","#","Load Name","Ch","Load Type","Watts",...(showKeypad?["Keypad"]:[]),...(showMove?["↗ Mod"]:[]),""];

  return (
    <div style={{marginBottom:16}}>
      {modules.map(mod=>{
        const cap = chCap(mod.moduleType);
        const named = mod.loads.filter(l=>l.name.trim());
        const pulled = named.filter(l=>l.pulled);
        return (
          <div key={mod.id} style={{border:`1px solid ${C.purple}33`,borderRadius:8,marginBottom:12,overflow:"hidden"}}>

            {/* ── Module header ── */}
            <div style={{background:`${C.purple}0d`,padding:"7px 10px",display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",borderBottom:`1px solid ${C.purple}22`}}>

              {!isSav&&(
                <>
                  <span style={{fontSize:10,fontWeight:700,color:C.purple,letterSpacing:"0.07em",textTransform:"uppercase",whiteSpace:"nowrap"}}>{devLabel}</span>
                  <Inp value={mod.modNum} onChange={e=>updMod(mod.id,{modNum:e.target.value})}
                    style={{width:36,textAlign:"center",fontSize:10,fontWeight:700,color:C.purple,background:"#fff",border:`1px solid ${C.purple}44`}}/>
                </>
              )}

              <Sel value={mod.moduleType} onChange={e=>updMod(mod.id,{moduleType:e.target.value})} options={moduleTypes}
                style={{fontSize:10,fontWeight:600,color:C.purple,background:"#fff",border:`1px solid ${C.purple}44`,width:isSav?"110px":"auto"}}/>

              {isSav&&<>
                <span style={{fontSize:10,fontWeight:700,color:C.purple,letterSpacing:"0.07em",textTransform:"uppercase"}}>Panel</span>
                <Inp value={mod.panel||""} onChange={e=>updMod(mod.id,{panel:e.target.value})} placeholder="Panel"
                  style={{width:64,fontSize:10,fontWeight:600,color:C.purple,background:"#fff",border:`1px solid ${C.purple}44`}}/>
                <span style={{fontSize:10,fontWeight:700,color:C.purple,letterSpacing:"0.07em",textTransform:"uppercase"}}>Bkr</span>
                <Inp value={mod.breaker||""} onChange={e=>updMod(mod.id,{breaker:e.target.value})} placeholder="Bkr"
                  style={{width:44,fontSize:10,fontWeight:600,color:C.purple,background:"#fff",border:`1px solid ${C.purple}44`}}/>
                <span style={{fontSize:10,fontWeight:700,color:C.purple,letterSpacing:"0.07em",textTransform:"uppercase"}}>Phase</span>
                <Sel value={mod.phase||""} onChange={e=>updMod(mod.id,{phase:e.target.value})} options={PHASE_OPTS}
                  style={{fontSize:10,fontWeight:600,color:C.purple,background:"#fff",border:`1px solid ${C.purple}44`,width:52}}/>
              </>}

              {isLut&&<>
                <span style={{fontSize:10,fontWeight:700,color:C.purple,letterSpacing:"0.07em",textTransform:"uppercase"}}>Bus</span>
                <Inp value={mod.bus||""} onChange={e=>updMod(mod.id,{bus:e.target.value})} placeholder="Bus"
                  style={{width:36,textAlign:"center",fontSize:10,fontWeight:600,color:C.purple,background:"#fff",border:`1px solid ${C.purple}44`}}/>
                <span style={{fontSize:10,fontWeight:700,color:C.purple,letterSpacing:"0.07em",textTransform:"uppercase"}}>PDU</span>
                <Inp value={mod.pdu||""} onChange={e=>updMod(mod.id,{pdu:e.target.value})} placeholder="PDU"
                  style={{width:64,fontSize:10,fontWeight:600,color:C.purple,background:"#fff",border:`1px solid ${C.purple}44`}}/>
              </>}

              {isCres&&<>
                <span style={{fontSize:10,fontWeight:700,color:C.purple,letterSpacing:"0.07em",textTransform:"uppercase"}}>Chain pos</span>
                <Inp value={mod.chainPos||""} onChange={e=>updMod(mod.id,{chainPos:e.target.value})} placeholder="Pos"
                  style={{width:36,textAlign:"center",fontSize:10,fontWeight:600,color:C.purple,background:"#fff",border:`1px solid ${C.purple}44`}}/>
              </>}

              <span style={{fontSize:10,color:`${C.purple}88`,marginLeft:"auto",whiteSpace:"nowrap"}}>
                {named.length}{cap?`/${cap}`:""} ch{pulled.length>0?` · ${pulled.length} pulled`:""}
              </span>
              <button onClick={()=>delMod(mod.id)} style={{background:"none",border:"none",color:C.muted,cursor:"pointer",fontSize:11,padding:"0 2px",flexShrink:0}}>✕</button>
            </div>

            {/* ── Load rows ── */}
            <div style={{padding:"6px 10px 4px"}}>
              {allLoads.length>0&&<datalist id={`mod-dl-${mod.id}`}>{allLoads.filter(l=>l.name.trim()).map(l=><option key={l.id} value={l.name}>{l.location?`(${l.location})`:""}</option>)}</datalist>}

              {narrow ? (
                /* Mobile: card per load */
                mod.loads.map((load,li)=>(
                  <div key={load.id} style={{
                    background:load.pulled?"rgba(34,197,94,0.08)":C.surface,
                    border:`1px solid ${load.pulled?C.green+"44":C.border}`,
                    borderRadius:8,padding:"10px 10px 8px",marginBottom:8}}>
                    {/* Row 1: checkbox + number + name + delete */}
                    <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
                      <input type="checkbox" checked={!!load.pulled} onChange={e=>{
                        const val=e.target.checked;
                        const who=getIdentity();
                        updLoad(mod.id,load.id,{pulled:val,pulledBy:val?(who?.name||""):"",pulledAt:val?new Date().toLocaleDateString("en-US"):""});
                      }} style={{width:18,height:18,accentColor:C.purple,cursor:"pointer",margin:0,flexShrink:0}}/>
                      <span style={{fontSize:11,color:C.muted,fontWeight:700,flexShrink:0}}>#{load.num}</span>
                      <input
                        ref={el=>{ if(pendingFocusMid.current===mod.id&&li===mod.loads.length-1&&el){el.focus();pendingFocusMid.current=null;} }}
                        list={allLoads.length>0?`mod-dl-${mod.id}`:undefined}
                        value={load.name} onChange={e=>updLoad(mod.id,load.id,{name:e.target.value})} placeholder="Load name…"
                        onKeyDown={e=>e.key==="Enter"&&addLoad(mod.id)}
                        style={{flex:1,background:C.surface,border:`1px solid ${C.border}`,borderRadius:7,color:C.text,
                          padding:"7px 10px",fontSize:13,fontFamily:"inherit",outline:"none",minWidth:0,boxSizing:"border-box"}}/>
                      <button onClick={()=>delLoad(mod.id,load.id)} style={{background:"none",border:"none",color:C.muted,cursor:"pointer",fontSize:16,padding:"0 2px",flexShrink:0}}>✕</button>
                    </div>
                    {/* Row 2: Ch, Load Type, Watts */}
                    <div style={{display:"grid",gridTemplateColumns:"60px 1fr 60px",gap:6,marginBottom:showKeypad||showMove?6:0}}>
                      <div>
                        <div style={{fontSize:9,color:C.dim,fontWeight:700,marginBottom:2}}>CH</div>
                        <Inp value={load.ch||""} onChange={e=>updLoad(mod.id,load.id,{ch:e.target.value})} placeholder="Ch" style={{textAlign:"center",fontSize:12}}/>
                      </div>
                      <div>
                        <div style={{fontSize:9,color:C.dim,fontWeight:700,marginBottom:2}}>LOAD TYPE</div>
                        <Sel value={load.loadType||""} onChange={e=>updLoad(mod.id,load.id,{loadType:e.target.value})} options={LOAD_TYPES} style={{fontSize:12,width:"100%"}}/>
                      </div>
                      <div>
                        <div style={{fontSize:9,color:C.dim,fontWeight:700,marginBottom:2}}>WATTS</div>
                        <Inp value={load.watts||""} onChange={e=>updLoad(mod.id,load.id,{watts:e.target.value})} placeholder="W" style={{textAlign:"center",fontSize:12}}/>
                      </div>
                    </div>
                    {/* Row 3: Keypad + Move (if applicable) */}
                    {(showKeypad||showMove)&&(
                      <div style={{display:"flex",gap:8}}>
                        {showKeypad&&<div style={{flex:1}}>
                          <div style={{fontSize:9,color:C.dim,fontWeight:700,marginBottom:2}}>KEYPAD</div>
                          <Inp value={load.keypad||""} onChange={e=>updLoad(mod.id,load.id,{keypad:e.target.value})} placeholder="Keypad" style={{fontSize:12}}/>
                        </div>}
                        {showMove&&<div style={{flex:1}}>
                          <div style={{fontSize:9,color:C.dim,fontWeight:700,marginBottom:2}}>MOVE TO</div>
                          <select value={mod.id} onChange={e=>moveLoad(mod.id,load.id,e.target.value)}
                            style={{fontSize:12,border:`1px solid ${C.border}`,borderRadius:7,padding:"6px 8px",
                              background:C.surface,color:C.text,cursor:"pointer",width:"100%",fontFamily:"inherit"}}>
                            {modules.map(m=>(
                              <option key={m.id} value={m.id}>{m.id===mod.id?"(here)":m.modNum||m.moduleType||"?"}</option>
                            ))}
                          </select>
                        </div>}
                      </div>
                    )}
                    {/* Pulled by */}
                    {load.pulled&&load.pulledBy&&(
                      <div style={{marginTop:6}}>
                        <span style={{fontSize:10,color:C.green,fontWeight:600}}>✓ pulled by {load.pulledBy}{load.pulledAt?" · "+load.pulledAt:""}</span>
                      </div>
                    )}
                  </div>
                ))
              ) : (
                /* Desktop: grid table */
                <>
                  <div style={{display:"grid",gridTemplateColumns:rowGrid,gap:4,marginBottom:4}}>
                    {rowHeaders.map((h,i)=><div key={i} style={{fontSize:10,color:C.dim,fontWeight:700,letterSpacing:"0.07em"}}>{h}</div>)}
                  </div>
                  {mod.loads.map((load,li)=>(
                    <div key={load.id} style={{marginBottom:3}}>
                      <div style={{display:"grid",gridTemplateColumns:rowGrid,gap:4,
                        alignItems:"center",borderRadius:6,padding:"2px 0",
                        background:load.pulled?"rgba(34,197,94,0.08)":"transparent"}}>
                        <input type="checkbox" checked={!!load.pulled} onChange={e=>{
                          const val=e.target.checked;
                          const who=getIdentity();
                          updLoad(mod.id,load.id,{pulled:val,pulledBy:val?(who?.name||""):"",pulledAt:val?new Date().toLocaleDateString("en-US"):""});
                        }} style={{width:15,height:15,accentColor:C.purple,cursor:"pointer",margin:0}}/>
                        <span style={{fontSize:11,color:C.muted,textAlign:"center",fontWeight:700}}>{load.num}</span>
                        <input
                          ref={el=>{ if(pendingFocusMid.current===mod.id&&li===mod.loads.length-1&&el){el.focus();pendingFocusMid.current=null;} }}
                          list={allLoads.length>0?`mod-dl-${mod.id}`:undefined}
                          value={load.name} onChange={e=>updLoad(mod.id,load.id,{name:e.target.value})} placeholder="Load name…"
                          onKeyDown={e=>e.key==="Enter"&&addLoad(mod.id)}
                          style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:7,color:C.text,
                            padding:"6px 10px",fontSize:12,fontFamily:"inherit",outline:"none",width:"100%",boxSizing:"border-box"}}/>
                        <Inp value={load.ch||""} onChange={e=>updLoad(mod.id,load.id,{ch:e.target.value})} placeholder="Ch" style={{textAlign:"center",fontSize:10}}/>
                        <Sel value={load.loadType||""} onChange={e=>updLoad(mod.id,load.id,{loadType:e.target.value})} options={LOAD_TYPES} style={{fontSize:10}}/>
                        <Inp value={load.watts||""} onChange={e=>updLoad(mod.id,load.id,{watts:e.target.value})} placeholder="W" style={{textAlign:"center",fontSize:10}}/>
                        {showKeypad&&<Inp value={load.keypad||""} onChange={e=>updLoad(mod.id,load.id,{keypad:e.target.value})} placeholder="Keypad" style={{fontSize:10}}/>}
                        {showMove&&(
                          <select value={mod.id} onChange={e=>moveLoad(mod.id,load.id,e.target.value)}
                            title="Move to module"
                            style={{fontSize:9,border:`1px solid ${C.border}`,borderRadius:4,padding:"2px 1px",
                              background:"#fff",color:C.muted,cursor:"pointer",width:"100%",fontFamily:"inherit"}}>
                            {modules.map(m=>(
                              <option key={m.id} value={m.id}>{m.id===mod.id?"(here)":m.modNum||m.moduleType||"?"}</option>
                            ))}
                          </select>
                        )}
                        <button onClick={()=>delLoad(mod.id,load.id)} style={{background:"none",border:"none",color:C.muted,cursor:"pointer",fontSize:13,padding:"0 2px"}}>✕</button>
                      </div>
                      {load.pulled&&load.pulledBy&&(
                        <div style={{paddingLeft:4,marginTop:1}}>
                          <span style={{fontSize:9,color:C.green,fontWeight:600}}>✓ pulled by {load.pulledBy}{load.pulledAt?" · "+load.pulledAt:""}</span>
                        </div>
                      )}
                    </div>
                  ))}
                </>
              )}

              <button onClick={()=>addLoad(mod.id)}
                style={{background:"none",border:"none",color:C.purple,fontSize:10,fontWeight:700,fontFamily:"inherit",
                  cursor:"pointer",padding:"4px 2px",letterSpacing:"0.04em",opacity:0.75}}>
                + Add Row to {devLabel} {mod.modNum||mod.moduleType}
              </button>
            </div>
          </div>
        );
      })}

      <button onClick={addMod}
        style={{background:"none",border:`1px dashed ${C.purple}44`,color:`${C.purple}88`,borderRadius:7,
          padding:7,fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"inherit",width:"100%",letterSpacing:"0.04em",marginTop:4}}>
        + New {devLabel}
      </button>
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

              <Inp value={l.loadName} onChange={e=>upd(l.id,{loadName:e.target.value})} placeholder="e.g. Kitchen Under-Cabinet"
                onKeyDown={e=>e.key==="Enter"&&add()} onAdd={add}/>

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
  const [collapsedFolders, setCollapsedFolders] = useState(new Set());
  const [simproSync, setSimproSync] = useState(null); // null | 'loading' | {uploaded, skipped, errors}

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
        // Auto-collapse any Archive folders
        const archiveFolders = [...new Set(allFiles.map(f => f._folder))].filter(isArchiveFolder);
        if (archiveFolders.length > 0) {
          setCollapsedFolders(new Set(archiveFolders));
        }
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

  const handlePushToSimpro = async () => {
    if (!job.simproNo) return;
    const fid = extractDriveFolderId(job.driveFolderId);
    if (!fid) return;
    if (!window.confirm(`Push new Drive plans to Simpro job #${job.simproNo}?\n\nThis only adds files — nothing in Simpro will be deleted.`)) return;
    setSimproSync("loading");
    try {
      const pushFn = httpsCallable(functions, "pushPlansToSimpro");
      const result = await pushFn({ simproJobNo: job.simproNo, driveFolderId: fid });
      setSimproSync(result.data);
    } catch (e) {
      setSimproSync({ uploaded: [], skipped: [], errors: [{ name: "Connection", error: e.message }] });
    }
  };

  const isImage = (f) => (f.mimeType || "").startsWith("image/");
  const isPDF = (f) => f.mimeType === "application/pdf" || /\.pdf$/i.test(f.name);
  const fileIcon = (f) => isPDF(f) ? "📄" : isImage(f) ? "🖼" : "📎";
  const isArchiveFolder = (name) => /archive/i.test(name);

  const toggleFolder = (name) => {
    setCollapsedFolders(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const previewUrl = (f) => `https://drive.google.com/file/d/${f.id}/preview`;
  const thumbUrl = (f) => f.thumbnailLink ? f.thumbnailLink.replace(/=s\d+/, "=s400") : `https://drive.google.com/thumbnail?id=${f.id}&sz=w400`;

  // Group files by sub-folder — Root first, Archive folders last
  const allFolderNames = [...new Set(driveFiles.map(f => f._folder))];
  const folderNames = [
    ...allFolderNames.filter(n => n === "Root"),
    ...allFolderNames.filter(n => n !== "Root" && !isArchiveFolder(n)).sort(),
    ...allFolderNames.filter(n => isArchiveFolder(n)).sort(),
  ];
  const images = driveFiles.filter(f => isImage(f));
  const docs = driveFiles.filter(f => !isImage(f));

  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div style={{ fontSize: 10, color: C.dim, fontWeight: 700, letterSpacing: "0.08em" }}>GOOGLE DRIVE PLANS</div>
        {folderId && !editingFolder && (
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            {job.simproNo && (
              <button
                onClick={handlePushToSimpro}
                disabled={simproSync === "loading"}
                style={{ background: simproSync === "loading" ? "#555" : "#f97316", border: "none", borderRadius: 6,
                  color: "#fff", cursor: simproSync === "loading" ? "not-allowed" : "pointer",
                  fontSize: 11, fontWeight: 700, padding: "3px 9px", fontFamily: "inherit",
                  opacity: simproSync === "loading" ? 0.6 : 1 }}>
                {simproSync === "loading" ? "Syncing…" : "Push to Simpro"}
              </button>
            )}
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

      {/* Simpro sync results */}
      {simproSync && simproSync !== "loading" && (
        <div style={{ marginBottom: 12, padding: "10px 14px", borderRadius: 10,
          background: simproSync.errors.length > 0 ? "rgba(239,68,68,0.06)" : "rgba(22,163,74,0.06)",
          border: `1px solid ${simproSync.errors.length > 0 ? C.red+"44" : C.green+"44"}` }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: simproSync.errors.length > 0 ? C.red : C.green }}>
              Simpro Sync Complete
            </span>
            <button onClick={() => setSimproSync(null)}
              style={{ background: "none", border: "none", color: C.dim, cursor: "pointer", fontSize: 13, padding: 0 }}>✕</button>
          </div>
          {simproSync.uploaded.length > 0 && (
            <div style={{ fontSize: 11, color: C.green, marginBottom: 2 }}>
              ✓ Uploaded {simproSync.uploaded.length} file{simproSync.uploaded.length !== 1 ? "s" : ""}
              {simproSync.uploaded.length <= 5 && (
                <span style={{ color: C.dim }}>{": " + simproSync.uploaded.join(", ")}</span>
              )}
            </div>
          )}
          {simproSync.skipped.length > 0 && (
            <div style={{ fontSize: 11, color: C.dim, marginBottom: 2 }}>
              — Skipped {simproSync.skipped.length} already in Simpro
            </div>
          )}
          {simproSync.errors.length > 0 && simproSync.errors.map((e, i) => (
            <div key={i} style={{ fontSize: 11, color: C.red, marginBottom: 2 }}>
              ✗ {e.name}: {e.error}
            </div>
          ))}
          {simproSync.uploaded.length === 0 && simproSync.errors.length === 0 && (
            <div style={{ fontSize: 11, color: C.dim }}>All files already in Simpro — nothing to add.</div>
          )}
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
        const isArchive = isArchiveFolder(folder);
        const isCollapsed = collapsedFolders.has(folder);
        const fileCount = folderImages.length + folderDocs.length;
        return (
          <div key={folder} style={{ marginBottom: 16 }}>
            {/* Folder header — clickable toggle, always shown when multiple folders */}
            {folderNames.length > 1 && (
              <div onClick={() => toggleFolder(folder)}
                style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10,
                  color: isArchive ? C.muted : C.accent,
                  fontWeight: 700, letterSpacing: "0.06em",
                  marginBottom: isCollapsed ? 0 : 8,
                  paddingBottom: isCollapsed ? 0 : 4,
                  borderBottom: isCollapsed ? "none" : `1px solid ${C.border}`,
                  cursor: "pointer", userSelect: "none",
                  opacity: isArchive ? 0.65 : 1 }}>
                <span style={{ fontSize: 11, lineHeight: 1, flexShrink: 0 }}>{isCollapsed ? "▸" : "▾"}</span>
                <span>📁 {folder === "Root" ? "Top Level" : folder}</span>
                {isArchive && (
                  <span style={{ fontStyle: "italic", fontWeight: 400, color: C.muted, letterSpacing: 0 }}>
                    — archived plans
                  </span>
                )}
                <span style={{ marginLeft: "auto", fontWeight: 400, color: C.muted, fontStyle: "normal", letterSpacing: 0 }}>
                  {fileCount} file{fileCount === 1 ? "" : "s"}
                </span>
              </div>
            )}

            {/* Collapsible content */}
            {!isCollapsed && (<>

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

            </>)}
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


const TABS = ["Job Info","Plans & Links","Rough","Finish","Home Runs","Panelized Lighting","Tape Light",

              "Change Orders","Return Trips","QC"];


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

function JobDetail({job: rawJob, onUpdate, onClose, foremenList, leadsList, canConvertQuote=false, onConvertQuote, initialTab}) {

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

  const [tab, setTab] = useState(()=>initialTab && TABS.includes(initialTab) ? initialTab : "Job Info");
  const [newLightingFloor, setNewLightingFloor] = useState("");
  const [emailData, setEmailData] = useState(null);
  const [convertPrompt, setConvertPrompt] = useState(false);
  const [convertJobNo, setConvertJobNo] = useState("");
  const [gcAnswers, setGcAnswers] = useState(null); // answers submitted by GC/homeowner via share link
  const [lvCollab, setLvCollab] = useState(null); // lighting collab data from LV company

  const [refreshing, setRefreshing] = useState(false);

  const [simproFinancials, setSimproFinancials] = useState(null);
  useEffect(() => {
    if (!job.simproNo) { setSimproFinancials(null); return; }
    const fn = httpsCallable(functions, "getSimproJobFinancials");
    fn({ simproJobNo: job.simproNo })
      .then(res => {
        console.log("[simproFinancials]", res.data);
        setSimproFinancials(res.data);
        // Cache on the job doc so the job board can show it without an extra call
        u({ simproMargin: res.data.margin, simproMarginIsEst: res.data.isEstimate });
      })
      .catch(e => { console.error("[simproFinancials error]", e); setSimproFinancials(null); });
  }, [job.simproNo]);

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
      (f.hotcheck||[]).filter(i=>!i.done).length +
      (f.rooms||[]).reduce((a,r)=>a+(Array.isArray(r.items)?r.items.filter(i=>!i.done).length:0),0);

  };

  // Total open items across all floors of a punch object
  const punchOpen = (punch) => {
    if(!punch) return 0;
    const floors = ['upper','main','basement',...(punch.extras||[]).map(e=>e.key)];
    return floors.reduce((t,k) => t + countFloor(punch[k]), 0);
  };

  const openCount = ['roughPunch','finishPunch'].reduce((total,key)=>{
    const p = job?.[key]||{};
    const extraCount = (p.extras||[]).reduce((s,e)=>s+countFloor(p[e.key]||{}),0);
    return total + countFloor(p.upper) + countFloor(p.main) + countFloor(p.basement) + extraCount;
  },0);

  const countWaitingFloor = (f) => {
    if (!f || Array.isArray(f)) return 0;
    return (f.general||[]).filter(i=>!i.done&&i.waiting).length +
      (f.hotcheck||[]).filter(i=>!i.done&&i.waiting).length +
      (f.rooms||[]).reduce((a,r)=>a+(Array.isArray(r.items)?r.items.filter(i=>!i.done&&i.waiting).length:0),0);
  };
  const waitingCount = ['roughPunch','finishPunch','qcPunch'].reduce((total,key)=>{
    const p = job?.[key]||{};
    const extraCount = (p.extras||[]).reduce((s,e)=>s+countWaitingFloor(p[e.key]||{}),0);
    return total + countWaitingFloor(p.upper) + countWaitingFloor(p.main) + countWaitingFloor(p.basement) + extraCount;
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

            <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
              <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:22,letterSpacing:"0.06em",color:C.text,lineHeight:1}}>

                {job.type==="quote"&&<span style={{fontSize:12,color:"#000",fontFamily:"'DM Sans',sans-serif",fontWeight:700,letterSpacing:"0.05em",marginRight:8,background:C.accent,borderRadius:5,padding:"2px 7px"}}>{job.quoteNumber||"QUOTE"}</span>}

                {job.simproNo&&<span style={{fontSize:13,color:C.dim,fontFamily:"'DM Sans',sans-serif",fontWeight:600,letterSpacing:"0.05em",marginRight:8}}>#{job.simproNo}</span>}

                {job.name||"New Job"}

              </div>
              {simproFinancials?.margin != null && (()=>{
                const m = simproFinancials.margin;
                const isEst = simproFinancials.isEstimate;
                const mc = m >= 15 ? "#22c55e" : m >= 10 ? C.orange : C.red;
                return (
                  <span title={`${isEst ? "Estimated" : "Actual"} net margin · Goal: 15%`}
                    style={{fontSize:11,fontWeight:800,color:mc,background:`${mc}18`,
                      border:`1px solid ${mc}44`,borderRadius:99,padding:"2px 9px",
                      fontFamily:"'DM Sans',sans-serif",letterSpacing:"0.04em",flexShrink:0}}>
                    {m.toFixed(1)}%{isEst ? " est" : ""}
                  </span>
                );
              })()}
              {(simproFinancials?.laborHoursActual != null || simproFinancials?.laborHoursEstimate != null) && (()=>{
                const ha = simproFinancials.laborHoursActual;
                const he = simproFinancials.laborHoursEstimate;
                const over = ha != null && he != null && ha > he;
                const hc = over ? C.red : "#8b5cf6";
                return (
                  <span title="Total labor hours: used / estimated"
                    style={{fontSize:11,fontWeight:800,color:hc,background:`${hc}18`,
                      border:`1px solid ${hc}44`,borderRadius:99,padding:"2px 9px",
                      fontFamily:"'DM Sans',sans-serif",letterSpacing:"0.04em",flexShrink:0}}>
                    ⏱ {ha != null ? `${Math.round(ha)}` : "?"}h / {he != null ? `${Math.round(he)}` : "?"}h est
                  </span>
                );
              })()}
            </div>

            <div style={{fontSize:11,color:C.dim,marginTop:2}}>

              {job.address ? <><AddressLink address={job.address} style={{color:C.dim}}/>{job.gc ? ` · ${job.gc}` : ""}</> : (job.gc||"No details yet")}

            </div>

            {job.accessNote&&(
              <div style={{display:"inline-flex",alignItems:"center",gap:5,marginTop:4,
                fontSize:11,color:"#92400e",background:"#fef3c7",
                border:"1px solid #fde68a",borderRadius:7,padding:"3px 9px"}}>
                <RichText html={job.accessNote}/>
              </div>
            )}

          </div>

          <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap",justifyContent:"flex-end"}}>

            {openCount>0  &&<Pill label={`${openCount} open punch`} color={C.red}/>}
            {waitingCount>0&&<span style={{fontSize:10,fontWeight:700,letterSpacing:"0.06em",padding:"2px 8px",borderRadius:99,background:"#fef3c7",color:"#92400e",border:"1px solid #fcd34d",whiteSpace:"nowrap"}}>{waitingCount} waiting</span>}

            {pendingCOs>0 &&<Pill label={`${pendingCOs} CO pending`} color={C.orange}/>}

            {(job.returnTrips||[]).filter(r=>!r.signedOff).length>0&&

              <Pill label={`${(job.returnTrips||[]).filter(r=>!r.signedOff).length} return trip${(job.returnTrips||[]).filter(r=>!r.signedOff).length>1?"s":""} pending`} color={C.red}/>}

            {qcCount>0&&<Pill label={`${qcCount} QC item${qcCount!==1?"s":""}`} color={C.red}/>}

            

            {job.type==="quote"&&canConvertQuote&&(
              convertPrompt ? (
                <div style={{display:"flex",alignItems:"center",gap:8,background:C.card,
                  border:`2px solid ${C.accent}`,borderRadius:10,padding:"8px 12px"}}>
                  <div style={{fontSize:11,fontWeight:700,color:C.accent,whiteSpace:"nowrap"}}>Simpro Job #</div>
                  <input
                    autoFocus
                    value={convertJobNo}
                    onChange={e=>setConvertJobNo(e.target.value)}
                    onKeyDown={e=>{
                      if(e.key==="Enter"&&convertJobNo.trim()) { onConvertQuote&&onConvertQuote({...job,simproNo:convertJobNo.trim()}); setConvertPrompt(false); setConvertJobNo(""); }
                      if(e.key==="Escape") { setConvertPrompt(false); setConvertJobNo(""); }
                    }}
                    placeholder="Enter job number…"
                    style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:7,
                      color:C.text,padding:"6px 10px",fontSize:13,fontFamily:"inherit",
                      outline:"none",width:160}}
                  />
                  <button
                    onClick={()=>{ if(convertJobNo.trim()){ onConvertQuote&&onConvertQuote({...job,simproNo:convertJobNo.trim()}); setConvertPrompt(false); setConvertJobNo(""); } }}
                    disabled={!convertJobNo.trim()}
                    style={{background:convertJobNo.trim()?C.accent:"#555",color:"#000",border:"none",
                      borderRadius:7,padding:"6px 14px",fontSize:12,fontWeight:700,
                      cursor:convertJobNo.trim()?"pointer":"not-allowed",fontFamily:"inherit"}}>
                    Convert
                  </button>
                  <button onClick={()=>{ setConvertPrompt(false); setConvertJobNo(""); }}
                    style={{background:"none",border:"none",color:C.dim,fontSize:16,cursor:"pointer",padding:"0 4px"}}>✕</button>
                </div>
              ) : (
                <button onClick={()=>setConvertPrompt(true)}
                  style={{background:C.accent,color:"#000",border:"none",borderRadius:8,
                    padding:"6px 14px",fontSize:12,fontWeight:700,cursor:"pointer",
                    fontFamily:"inherit",letterSpacing:"0.03em"}}>
                  Convert to Job
                </button>
              )
            )}

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

                      {/* STATUS — top */}
                      <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap",marginBottom:10}}>
                        {(simproFinancials?.roughHoursActual != null || simproFinancials?.roughHoursEstimate != null) && (()=>{
                          const ha = simproFinancials.roughHoursActual;
                          const he = simproFinancials.roughHoursEstimate;
                          const over = ha != null && he != null && ha > he;
                          const hc = over ? C.red : "#8b5cf6";
                          return (
                            <span title="Rough labor hours: used / estimated"
                              style={{fontSize:11,fontWeight:800,color:hc,background:`${hc}18`,
                                border:`1px solid ${hc}44`,borderRadius:99,padding:"2px 8px",
                                fontFamily:"'DM Sans',sans-serif",letterSpacing:"0.04em",flexShrink:0}}>
                              ⏱ {ha != null ? `${Math.round(ha)}` : "?"}h / {he != null ? `${Math.round(he)}` : "?"}h est
                            </span>
                          );
                        })()}
                        <select value={job.roughStatus||""} onChange={e=>{
                          const v=e.target.value;
                          if(v==="complete"){
                            const open=punchOpen(job.roughPunch);
                            if(open>0){alert(`Cannot mark Rough as complete — ${open} open punch item${open!==1?"s":""} remaining. Clear them first.`);return;}
                          }
                          const def=getStatusDef(ROUGH_STATUSES,v);
                          u({roughStatus:v, roughOnHold:v==="waiting", roughScheduled:v==="scheduled",
                            roughStartConfirmed:v==="date_confirmed"?true:(v==="scheduled"||v==="inprogress"||v==="complete"||v==="waiting")?job.roughStartConfirmed:false,
                            roughStatusDate:def.hasDate?job.roughStatusDate:"",
                            roughProjectedStart:v==="scheduled"?job.roughProjectedStart:job.roughProjectedStart,
                            ...(v==="scheduled"?{roughDepositDismissed:false}:{}),
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

                      {/* Compact date strip */}
                      <div style={{background:"#f3f4f6",borderRadius:8,padding:"8px 12px",display:"flex",gap:16,alignItems:"center",flexWrap:"wrap",marginBottom:10}}>
                        <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                          <span style={{fontSize:10,color:job.roughStartConfirmed?"#16a34a":C.dim,fontWeight:700,letterSpacing:"0.07em",whiteSpace:"nowrap"}}>
                            {job.roughStartConfirmed?"READY TO START":"PROJ. START"}
                          </span>
                          <DateInp value={job.roughProjectedStart||""} onChange={e=>{
                            const patch={roughProjectedStart:e.target.value};
                            if(e.target.value && !job.roughStatus) patch.roughStatus="waiting_date";
                            u(patch);
                          }} style={{fontSize:11,fontWeight:700,borderColor:(job.roughStartConfirmed?"#16a34a":C.rough)+"55",background:job.roughStartConfirmed?"#16a34a08":`${C.rough}08`,color:job.roughStartConfirmed?"#16a34a":C.rough}}/>
                          <button onClick={()=>{const confirm=!job.roughStartConfirmed;u({roughStartConfirmed:confirm,...(confirm?{roughStatus:"date_confirmed"}:(job.roughStatus==="date_confirmed"?{roughStatus:"waiting_date"}:{}))});}}
                            style={{display:"flex",alignItems:"center",gap:3,padding:"2px 7px",borderRadius:99,fontSize:9,fontWeight:700,cursor:"pointer",fontFamily:"inherit",border:"none",background:job.roughStartConfirmed?"#16a34a18":"#6b728018",color:job.roughStartConfirmed?"#16a34a":"#6b7280"}}>
                            {job.roughStartConfirmed?"✓ CONFIRMED":"○ CONFIRM"}
                          </button>
                        </div>
                        <div style={{width:1,height:20,background:C.border,flexShrink:0}}/>
                        <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                          <span style={{fontSize:10,color:C.dim,fontWeight:700,letterSpacing:"0.07em",whiteSpace:"nowrap"}}>4-WAY TARGET</span>
                          <DateInp value={job.fourWayTargetDate||""} onChange={e=>u({fourWayTargetDate:e.target.value})}
                            style={{fontSize:11,fontWeight:700,borderColor:C.rough+"55",background:`${C.rough}08`,color:C.rough}}/>
                          {["pass","fail"].map(r=>(
                            <button key={r} onClick={()=>u({roughInspectionResult:job.roughInspectionResult===r?"":r})}
                              style={{padding:"3px 9px",borderRadius:6,fontSize:10,fontWeight:700,cursor:"pointer",border:"none",fontFamily:"inherit",
                                background:job.roughInspectionResult===r?(r==="pass"?"#16a34a":"#dc2626"):(r==="pass"?"#16a34a18":"#dc262618"),
                                color:job.roughInspectionResult===r?"#fff":(r==="pass"?"#16a34a":"#dc2626")}}>
                              {r==="pass"?"✓ Pass":"✗ Fail"}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Failed items */}
                      {job.roughInspectionResult==="fail"&&(
                        <div style={{marginBottom:10,padding:"8px 10px",background:"#dc262608",border:"1px solid #dc262622",borderRadius:7}}>
                          <div style={{fontSize:10,color:"#dc2626",fontWeight:700,letterSpacing:"0.08em",marginBottom:5}}>FAILED ITEMS</div>
                          {(job.roughInspectionItems||[]).map((item,i)=>(
                            <div key={item.id} style={{display:"flex",gap:6,alignItems:"center",marginBottom:5}}>
                              <input type="checkbox" checked={!!item.done} onChange={()=>{const items=[...(job.roughInspectionItems||[])];items[i]={...items[i],done:!items[i].done};u({roughInspectionItems:items});}}/>
                              <input value={item.text} onChange={e=>{const items=[...(job.roughInspectionItems||[])];items[i]={...items[i],text:e.target.value};u({roughInspectionItems:items});}}
                                style={{flex:1,background:"transparent",border:"none",borderBottom:`1px solid ${C.border}`,fontSize:12,color:C.text,padding:"2px 4px",outline:"none",fontFamily:"inherit",textDecoration:item.done?"line-through":"none",opacity:item.done?0.5:1}}/>
                              <button onClick={()=>u({roughInspectionItems:(job.roughInspectionItems||[]).filter((_,j)=>j!==i)})} style={{background:"none",border:"none",color:C.dim,fontSize:14,cursor:"pointer",padding:"0 2px",lineHeight:1}}>×</button>
                            </div>
                          ))}
                          <div style={{display:"flex",gap:6,marginTop:5,flexWrap:"wrap"}}>
                            <button onClick={()=>u({roughInspectionItems:[...(job.roughInspectionItems||[]),{id:uid(),text:"",done:false}]})} style={{fontSize:11,padding:"3px 8px",borderRadius:5,background:C.surface,border:`1px solid ${C.border}`,color:C.text,cursor:"pointer",fontFamily:"inherit"}}>+ Item</button>
                            {(job.roughInspectionItems||[]).filter(x=>!x.done).length>0&&(
                              <button onClick={()=>{const open=(job.roughInspectionItems||[]).filter(x=>!x.done);const newRT={id:uid(),date:"",scope:"Failed 4-way inspection items",material:"",punch:open.map(x=>({id:uid(),text:x.text,done:false})),photos:[],assignedTo:"",signedOff:false,signedOffBy:"",signedOffDate:"",needsSchedule:true,needsScheduleDate:"",rtScheduled:false,scheduledDate:""};u({returnTrips:[...(job.returnTrips||[]),newRT]});}}
                                style={{fontSize:11,padding:"3px 10px",borderRadius:5,background:"#dc262618",border:"1px solid #dc262633",color:"#dc2626",cursor:"pointer",fontWeight:700,fontFamily:"inherit"}}>→ Create Return Trip</button>
                            )}
                          </div>
                        </div>
                      )}

                    </div>
                  );
                })()}
                <Sel value={job.roughStage} onChange={e=>{const v=e.target.value;const pct=parseInt(v)||0;if(v==="100%"){const open=punchOpen(job.roughPunch);if(open>0){alert(`Cannot set Rough to 100% — ${open} open punch item${open!==1?"s":""} remaining. Clear them first.`);return;}}const qcFire=pct>=80&&!job.roughQCTaskFired?{roughQCTaskFired:true}:{};const prepDone=pct>0&&job.prepStage!=="Job Prep Complete"?{prepStage:"Job Prep Complete"}:{};const invoiceFire=pct>=85&&!job.roughInvoiceFired?{roughInvoiceFired:true,roughInvoiceDismissed:false,readyToInvoice:true,readyToInvoiceDate:new Date().toLocaleDateString("en-US")}:{};const invoiceReset=pct<85?{roughInvoiceFired:false,roughInvoiceDismissed:false}:{};u({roughStage:v,...qcFire,...prepDone,...invoiceFire,...invoiceReset,...(v==="100%"?{roughStatus:"complete"}:pct>0?{roughStatus:"inprogress"}:{})});}} options={ROUGH_STAGES}/>

                <div style={{marginTop:8,marginBottom:12}}>
                  <StageBar stages={ROUGH_STAGES} current={job.roughStage} color={C.rough}/>
                </div>
                <PhaseInstructions items={job.roughInstructions} onChange={v=>u({roughInstructions:v})} color={C.rough}/>

              </Section>


              <Section label="Punch List" color={C.rough} action={
                <PunchPicker punch={job.roughPunch||{}} jobId={job.id} stage="Rough" color={C.rough} showHotcheck={false}
                  filter={job.roughPunchFilter||null} filterLabel={job.roughPunchFilterLabel||''} onSaveFilter={(v,lbl)=>u({roughPunchFilter:v,roughPunchFilterLabel:lbl})}/>
              }>

                <PunchSection punch={job.roughPunch} onChange={v=>u({roughPunch:v})}
                  jobName={job.name||"This Job"} phase="Rough" onEmail={setEmailData}
                  filterIds={job.roughPunchFilter ? new Set(job.roughPunchFilter) : null}
                  onAddMaterial={(text, source)=>{
                    const orders = job.roughMaterials || [];
                    const openEntry = [...orders].reverse().find(o=>
                      o.needsOrder&&!o.ordered&&!o.pickedUp&&
                      (source ? (o.source||"")===(source||"") : true)
                    );
                    if (openEntry) {
                      u({roughMaterials: orders.map(o=> o.id===openEntry.id
                        ? {...o, items: o.items ? o.items.replace(/(<br\s*\/?>)+$/i, '') + '<br>' + text : text}
                        : o)});
                    } else {
                      u({roughMaterials:[...orders,{id:uid(),date:"",po:"",pickupDate:"",source:source||"",items:text,pickedUp:false,needsOrder:true}]});
                    }
                  }}
                  onAddQuestion={(floor, text)=>{
                    const who = getIdentity();
                    const q = {id:uid(), question:text, answer:"", done:false, addedBy:who?.name||""};
                    const qs = job.roughQuestions || {upper:[],main:[],basement:[]};
                    u({roughQuestions:{...qs, [floor]:[...(qs[floor]||[]), q]}});
                  }}
                  jobId={job.id}/>

              </Section>

              {(job.roughPunchExternal?.length>0)&&(
                <ExternalPunchSection items={job.roughPunchExternal||[]}
                  label={job.roughPunchFilterLabel||'GC'}
                  onChange={v=>u({roughPunchExternal:v})}
                  color={C.rough}/>
              )}

              <Section label="Material Tracking" color={C.rough}>
                <MaterialOrders orders={job.roughMaterials} onChange={v=>u({roughMaterials:v})}/>
              </Section>

              <Section label="Material Count List" color={C.rough} defaultOpen={false}>
                <div style={{fontSize:12,color:C.muted,marginBottom:10}}>Tap + / − to count materials on the job. Copy the list to paste into Simpro.</div>
                <MaterialTally items={job.roughTally||[]} onChange={v=>u({roughTally:v})}
                  onAddToPO={text=>{
                    const orders = job.roughMaterials||[];
                    const open = [...orders].reverse().find(o=>o.needsOrder&&!o.ordered&&!o.pickedUp);
                    if(open) u({roughMaterials:orders.map(o=>o.id===open.id?{...o,items:o.items?o.items.replace(/(<br\s*\/?>)+$/i,'')+'<br>'+text:text}:o)});
                    else u({roughMaterials:[...orders,{id:uid(),date:"",po:"",pickupDate:"",items:text,pickedUp:false,needsOrder:true}]});
                  }}/>
              </Section>

              <Section label="Daily Job Updates" color={C.rough}>

                <DailyUpdates updates={job.roughUpdates} onChange={v=>u({roughUpdates:v})}

                  jobName={job.name||"This Job"} onEmail={setEmailData}/>

              </Section>

              <div style={{marginTop:20}}>
                <Section label="Questions" color={C.rough} action={
                  <QuestionPicker roughQuestions={job.roughQuestions} finishQuestions={job.finishQuestions} jobId={job.id} color={C.rough}
                    filter={job.questionsFilter||null} onSaveFilter={v=>u({questionsFilter:v})}/>
                }>
                  {(()=>{const m={};['upper','main','basement'].forEach(f=>(gcAnswers?.rough?.[f]||[]).forEach(a=>{if(a.answer&&!((job.roughQuestions?.[f]||[]).find(q=>q.id===a.id)?.done))m[a.id]=a.answer;}));return <QASection questions={job.roughQuestions||{upper:[],main:[],basement:[]}} onChange={v=>u({roughQuestions:v})} color={C.rough} gcAnswerMap={m} filterIds={job.questionsFilter ? new Set(job.questionsFilter) : null}/>;})()}
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

                      {/* STATUS — top */}
                      <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap",marginBottom:10}}>
                        {(simproFinancials?.finishHoursActual != null || simproFinancials?.finishHoursEstimate != null) && (()=>{
                          const ha = simproFinancials.finishHoursActual;
                          const he = simproFinancials.finishHoursEstimate;
                          const over = ha != null && he != null && ha > he;
                          const hc = over ? C.red : "#8b5cf6";
                          return (
                            <span title="Finish labor hours: used / estimated"
                              style={{fontSize:11,fontWeight:800,color:hc,background:`${hc}18`,
                                border:`1px solid ${hc}44`,borderRadius:99,padding:"2px 8px",
                                fontFamily:"'DM Sans',sans-serif",letterSpacing:"0.04em",flexShrink:0}}>
                              ⏱ {ha != null ? `${Math.round(ha)}` : "?"}h / {he != null ? `${Math.round(he)}` : "?"}h est
                            </span>
                          );
                        })()}
                        <select value={job.finishStatus||""} onChange={e=>{
                          const v=e.target.value;
                          if(v==="complete"){
                            const finishOpen=punchOpen(job.finishPunch);
                            const qcOpen=punchOpen(job.qcPunch);
                            const total=finishOpen+qcOpen;
                            if(total>0){
                              const parts=[];
                              if(finishOpen>0) parts.push(`${finishOpen} finish punch item${finishOpen!==1?"s":""}`);
                              if(qcOpen>0) parts.push(`${qcOpen} QC item${qcOpen!==1?"s":""}`);
                              alert(`Cannot mark Finish as complete — ${parts.join(" and ")} still open. Clear them first.`);
                              return;
                            }
                          }
                          const def=getStatusDef(FINISH_STATUSES,v);
                          u({finishStatus:v, finishOnHold:v==="waiting", finishScheduled:v==="scheduled",
                            finishStartConfirmed:v==="date_confirmed"?true:(v==="scheduled"||v==="inprogress"||v==="complete"||v==="waiting")?job.finishStartConfirmed:false,
                            finishStatusDate:def.hasDate?job.finishStatusDate:"",
                            finishProjectedStart:v==="scheduled"?job.finishProjectedStart:job.finishProjectedStart,
                            ...(v==="scheduled"?{finishDepositDismissed:false}:{}),
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

                      {/* Compact date strip */}
                      <div style={{background:"#f3f4f6",borderRadius:8,padding:"8px 12px",display:"flex",gap:16,alignItems:"center",flexWrap:"wrap",marginBottom:10}}>
                        <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                          <span style={{fontSize:10,color:job.finishStartConfirmed?"#16a34a":C.dim,fontWeight:700,letterSpacing:"0.07em",whiteSpace:"nowrap"}}>
                            {job.finishStartConfirmed?"READY TO START":"PROJ. START"}
                          </span>
                          <DateInp value={job.finishProjectedStart||""} onChange={e=>{
                            const patch={finishProjectedStart:e.target.value};
                            if(e.target.value && !job.finishStatus) patch.finishStatus="waiting_date";
                            u(patch);
                          }} style={{fontSize:11,fontWeight:700,borderColor:(job.finishStartConfirmed?"#16a34a":C.finish)+"55",background:job.finishStartConfirmed?"#16a34a08":`${C.finish}08`,color:job.finishStartConfirmed?"#16a34a":C.finish}}/>
                          <button onClick={()=>{const confirm=!job.finishStartConfirmed;u({finishStartConfirmed:confirm,...(confirm?{finishStatus:"date_confirmed"}:(job.finishStatus==="date_confirmed"?{finishStatus:"waiting_date"}:{}))});}}
                            style={{display:"flex",alignItems:"center",gap:3,padding:"2px 7px",borderRadius:99,fontSize:9,fontWeight:700,cursor:"pointer",fontFamily:"inherit",border:"none",background:job.finishStartConfirmed?"#16a34a18":"#6b728018",color:job.finishStartConfirmed?"#16a34a":"#6b7280"}}>
                            {job.finishStartConfirmed?"✓ CONFIRMED":"○ CONFIRM"}
                          </button>
                        </div>
                        <div style={{width:1,height:20,background:C.border,flexShrink:0}}/>
                        <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                          <span style={{fontSize:10,color:C.dim,fontWeight:700,letterSpacing:"0.07em",whiteSpace:"nowrap"}}>FINAL INSPECTION</span>
                          <DateInp value={job.finalInspectionTargetDate||""} onChange={e=>u({finalInspectionTargetDate:e.target.value})}
                            style={{fontSize:11,fontWeight:700,borderColor:C.finish+"55",background:`${C.finish}08`,color:C.finish}}/>
                          {["pass","fail"].map(r=>(
                            <button key={r} onClick={()=>u({finalInspectionResult:job.finalInspectionResult===r?"":r})}
                              style={{padding:"3px 9px",borderRadius:6,fontSize:10,fontWeight:700,cursor:"pointer",border:"none",fontFamily:"inherit",
                                background:job.finalInspectionResult===r?(r==="pass"?"#16a34a":"#dc2626"):(r==="pass"?"#16a34a18":"#dc262618"),
                                color:job.finalInspectionResult===r?"#fff":(r==="pass"?"#16a34a":"#dc2626")}}>
                              {r==="pass"?"✓ Pass":"✗ Fail"}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Failed items */}
                      {job.finalInspectionResult==="fail"&&(
                        <div style={{marginBottom:10,padding:"8px 10px",background:"#dc262608",border:"1px solid #dc262622",borderRadius:7}}>
                          <div style={{fontSize:10,color:"#dc2626",fontWeight:700,letterSpacing:"0.08em",marginBottom:5}}>FAILED ITEMS</div>
                          {(job.finalInspectionItems||[]).map((item,i)=>(
                            <div key={item.id} style={{display:"flex",gap:6,alignItems:"center",marginBottom:5}}>
                              <input type="checkbox" checked={!!item.done} onChange={()=>{const items=[...(job.finalInspectionItems||[])];items[i]={...items[i],done:!items[i].done};u({finalInspectionItems:items});}}/>
                              <input value={item.text} onChange={e=>{const items=[...(job.finalInspectionItems||[])];items[i]={...items[i],text:e.target.value};u({finalInspectionItems:items});}}
                                style={{flex:1,background:"transparent",border:"none",borderBottom:`1px solid ${C.border}`,fontSize:12,color:C.text,padding:"2px 4px",outline:"none",fontFamily:"inherit",textDecoration:item.done?"line-through":"none",opacity:item.done?0.5:1}}/>
                              <button onClick={()=>u({finalInspectionItems:(job.finalInspectionItems||[]).filter((_,j)=>j!==i)})} style={{background:"none",border:"none",color:C.dim,fontSize:14,cursor:"pointer",padding:"0 2px",lineHeight:1}}>×</button>
                            </div>
                          ))}
                          <div style={{display:"flex",gap:6,marginTop:5,flexWrap:"wrap"}}>
                            <button onClick={()=>u({finalInspectionItems:[...(job.finalInspectionItems||[]),{id:uid(),text:"",done:false}]})} style={{fontSize:11,padding:"3px 8px",borderRadius:5,background:C.surface,border:`1px solid ${C.border}`,color:C.text,cursor:"pointer",fontFamily:"inherit"}}>+ Item</button>
                            {(job.finalInspectionItems||[]).filter(x=>!x.done).length>0&&(
                              <button onClick={()=>{const open=(job.finalInspectionItems||[]).filter(x=>!x.done);const newRT={id:uid(),date:"",scope:"Failed final inspection items",material:"",punch:open.map(x=>({id:uid(),text:x.text,done:false})),photos:[],assignedTo:"",signedOff:false,signedOffBy:"",signedOffDate:"",needsSchedule:true,needsScheduleDate:"",rtScheduled:false,scheduledDate:""};u({returnTrips:[...(job.returnTrips||[]),newRT]});}}
                                style={{fontSize:11,padding:"3px 10px",borderRadius:5,background:"#dc262618",border:"1px solid #dc262633",color:"#dc2626",cursor:"pointer",fontWeight:700,fontFamily:"inherit"}}>→ Create Return Trip</button>
                            )}
                          </div>
                        </div>
                      )}

                    </div>
                  );
                })()}
                <Sel value={job.finishStage} onChange={e=>{const v=e.target.value;const pct=parseInt(v)||0;if(v==="100%"){const finishOpen=punchOpen(job.finishPunch);const qcOpen=punchOpen(job.qcPunch);const total=finishOpen+qcOpen;if(total>0){const parts=[];if(finishOpen>0)parts.push(`${finishOpen} finish punch item${finishOpen!==1?"s":""}`);if(qcOpen>0)parts.push(`${qcOpen} QC item${qcOpen!==1?"s":""}`);alert(`Cannot set Finish to 100% — ${parts.join(" and ")} still open. Clear them first.`);return;}}const invoiceFire=pct>=85&&!job.finishInvoiceFired?{finishInvoiceFired:true,finishInvoiceDismissed:false,readyToInvoice:true,readyToInvoiceDate:new Date().toLocaleDateString("en-US")}:{};const invoiceReset=pct<85?{finishInvoiceFired:false,finishInvoiceDismissed:false}:{};u({finishStage:v,...invoiceFire,...invoiceReset,...(v==="100%"?{finishStatus:"complete"}:pct>0?{finishStatus:"inprogress"}:{})});}} options={FINISH_STAGES}/>
                <div style={{marginTop:8,marginBottom:12}}><StageBar stages={FINISH_STAGES} current={job.finishStage} color={C.finish}/></div>
                <PhaseInstructions items={job.finishInstructions} onChange={v=>u({finishInstructions:v})} color={C.finish}/>
              </Section>

              <Section label="Punch List" color={C.finish} action={
                <PunchPicker punch={job.finishPunch||{}} jobId={job.id} stage="Finish" color={C.finish} showHotcheck={false}
                  filter={job.finishPunchFilter||null} filterLabel={job.finishPunchFilterLabel||''} onSaveFilter={(v,lbl)=>u({finishPunchFilter:v,finishPunchFilterLabel:lbl})}/>
              }>
                <PunchSection punch={job.finishPunch} onChange={v=>u({finishPunch:v})} jobName={job.name||"This Job"} phase="Finish" onEmail={setEmailData}
                  filterIds={job.finishPunchFilter ? new Set(job.finishPunchFilter) : null}
                  onAddMaterial={(text, source)=>{
                    const orders = job.finishMaterials || [];
                    const openEntry = [...orders].reverse().find(o=>
                      o.needsOrder&&!o.ordered&&!o.pickedUp&&
                      (source ? (o.source||"")===(source||"") : true)
                    );
                    if (openEntry) {
                      u({finishMaterials: orders.map(o=> o.id===openEntry.id
                        ? {...o, items: o.items ? o.items.replace(/(<br\s*\/?>)+$/i, '') + '<br>' + text : text}
                        : o)});
                    } else {
                      u({finishMaterials:[...orders,{id:uid(),date:"",po:"",pickupDate:"",source:source||"",items:text,pickedUp:false,needsOrder:true}]});
                    }
                  }}
                  onAddQuestion={(floor, text)=>{
                    const who = getIdentity();
                    const q = {id:uid(), question:text, answer:"", done:false, addedBy:who?.name||""};
                    const qs = job.finishQuestions || {upper:[],main:[],basement:[]};
                    u({finishQuestions:{...qs, [floor]:[...(qs[floor]||[]), q]}});
                  }}
                  jobId={job.id}/>
              </Section>

              {(job.finishPunchExternal?.length>0)&&(
                <ExternalPunchSection items={job.finishPunchExternal||[]}
                  label={job.finishPunchFilterLabel||'GC'}
                  onChange={v=>u({finishPunchExternal:v})}
                  color={C.finish}/>
              )}

              <div style={{marginTop:20}}>

                <Section label="Finish Material Tracking" color={C.finish}>
                  <MaterialOrders orders={job.finishMaterials} onChange={v=>u({finishMaterials:v})}/>
                </Section>

                <Section label="Finish Material Count List" color={C.finish} defaultOpen={false}>
                  <div style={{fontSize:12,color:C.muted,marginBottom:10}}>Tap + / − to count materials on the job. Copy the list to paste into Simpro.</div>
                  <MaterialTally items={job.finishTally||[]} onChange={v=>u({finishTally:v})}
                    onAddToPO={text=>{
                      const orders = job.finishMaterials||[];
                      const open = [...orders].reverse().find(o=>o.needsOrder&&!o.ordered&&!o.pickedUp);
                      if(open) u({finishMaterials:orders.map(o=>o.id===open.id?{...o,items:o.items?o.items.replace(/(<br\s*\/?>)+$/i,'')+'<br>'+text:text}:o)});
                      else u({finishMaterials:[...orders,{id:uid(),date:"",po:"",pickupDate:"",items:text,pickedUp:false,needsOrder:true}]});
                    }}/>
                </Section>

              </div>

              <div style={{marginTop:20}}>

                <Section label="Finish Daily Job Updates" color={C.finish}>
                <DailyUpdates updates={job.finishUpdates} onChange={v=>u({finishUpdates:v})} jobName={job.name||"This Job"} onEmail={setEmailData}/>
              </Section>

              </div>

              <div style={{marginTop:20}}>
                <Section label="Questions" color={C.finish} action={
                  <QuestionPicker roughQuestions={job.roughQuestions} finishQuestions={job.finishQuestions} jobId={job.id} color={C.finish}
                    filter={job.questionsFilter||null} onSaveFilter={v=>u({questionsFilter:v})}/>
                }>
                  {(()=>{const m={};['upper','main','basement'].forEach(f=>(gcAnswers?.finish?.[f]||[]).forEach(a=>{if(a.answer&&!((job.finishQuestions?.[f]||[]).find(q=>q.id===a.id)?.done))m[a.id]=a.answer;}));return <QASection questions={job.finishQuestions||{upper:[],main:[],basement:[]}} onChange={v=>u({finishQuestions:v})} color={C.finish} gcAnswerMap={m} filterIds={job.questionsFilter ? new Set(job.questionsFilter) : null}/>;})()}
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
              onHRChange={v=>u({homeRuns:v})} onCountChange={v=>u({panelCounts:v})}
              finishMaterials={job.finishMaterials} onMatChange={v=>u({finishMaterials:v})}
              breakerOverrides={job.breakerOverrides} onBreakersChange={v=>u({breakerOverrides:v})}/>

          )}


          {tab==="Panelized Lighting"&&(

            <div>

              {/* Share Collab Link */}
              <div style={{marginBottom:16,display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
                <button onClick={()=>{
                  const link=`${window.location.origin}/?lighting=${job.id}`;
                  navigator.clipboard.writeText(link).then(()=>alert('✓ Lighting collab link copied!\n\nThe low voltage company can view assignments and add their module/channel info.')).catch(()=>alert('Link:\n'+link));
                }} style={{background:`${C.purple}15`,border:`1px solid ${C.purple}55`,borderRadius:6,
                  color:C.purple,fontSize:11,fontWeight:700,padding:'4px 12px',cursor:'pointer',fontFamily:'inherit',letterSpacing:'0.05em'}}>
                  Share ↗
                </button>
                <span style={{fontSize:11,color:C.dim}}>LV company can add module/channel assignments</span>
              </div>

              {/* Lighting Control System Selector */}

              {(()=>{
                const sysUrls={"Control 4":"https://www.control4.com/solutions/smart-lighting","Lutron":"https://residential.lutron.com/us/en/homeworks","Savant":"https://www.savant.com/lighting/","Crestron":"https://www.crestron.com/Products/Featured-Solutions/Zum-Lighting-Control-Systems"};
                const url=sysUrls[job.lightingSystem||"Control 4"];
                return url?(
                  <div style={{marginBottom:10,display:"flex",alignItems:"center",gap:6}}>
                    <a href={url} target="_blank" rel="noopener noreferrer"
                      style={{fontSize:11,color:C.purple,textDecoration:"none",fontWeight:600,
                        background:`${C.purple}10`,border:`1px solid ${C.purple}33`,
                        borderRadius:6,padding:"3px 10px",display:"inline-flex",alignItems:"center",gap:4}}>
                      {job.lightingSystem||"Control 4"} docs ↗
                    </a>
                  </div>
                ):null;
              })()}

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

              <SectionHead label="Loads" color={C.purple}/>

              {(()=>{
                const pl = job.panelizedLighting;
                const stdFloors = [{k:"main",l:"Main"},{k:"basement",l:"Basement"},{k:"upper",l:"Upper"}];
                const allModules = [];
                stdFloors.forEach(({k,l})=>{
                  migrateFloorToModules(pl.cp4Loads?.[k]||[]).filter(m=>m.modNum||m.moduleType).forEach(m=>{
                    allModules.push({modNum:m.modNum,floorKey:k,isExtra:false,
                      label:`Mod ${m.modNum}${m.moduleType?` · ${m.moduleType}`:""} — ${l}`});
                  });
                });
                (pl.extraFloors||[]).forEach(ef=>{
                  migrateFloorToModules(pl[ef.key]||[]).filter(m=>m.modNum||m.moduleType).forEach(m=>{
                    allModules.push({modNum:m.modNum,floorKey:ef.key,isExtra:true,
                      label:`Mod ${m.modNum}${m.moduleType?` · ${m.moduleType}`:""} — ${ef.label}`});
                  });
                });
                // Build map of load name → "Mod X — Floor" label for assignment badges
                const assignedModMap = new Map();
                const _allFloorData = [
                  ...stdFloors.map(({k,l})=>({mods:migrateFloorToModules(pl.cp4Loads?.[k]||[]),fl:l})),
                  ...(pl.extraFloors||[]).map(ef=>({mods:migrateFloorToModules(pl[ef.key]||[]),fl:ef.label})),
                ];
                _allFloorData.forEach(({mods,fl})=>mods.forEach(m=>m.loads.forEach(l=>{
                  if(!l.name?.trim()) return;
                  const key=l.name.trim();
                  if(!assignedModMap.has(key)) assignedModMap.set(key,[]);
                  assignedModMap.get(key).push(`Mod ${m.modNum} · ${fl}`);
                })));
                const onAssignToModule = (selectedIds, modNum, floorKey, isExtra) => {
                  const selLoads = (pl.loads||[]).filter(l=>selectedIds.includes(l.id));
                  const raw = isExtra ? (pl[floorKey]||[]) : (pl.cp4Loads?.[floorKey]||[]);
                  const mods = migrateFloorToModules(raw);
                  const updated = mods.map(m=>{
                    if(String(m.modNum)!==String(modNum)) return m;
                    const base = m.loads.filter(l=>l.name.trim()).length===0 ? [] : m.loads;
                    const newRows = selLoads.map((sl,i)=>({...newLoadRow(base.length+i+1),name:sl.name,loadType:sl.loadType||"",watts:sl.watts||""}));
                    return {...m,loads:[...base,...newRows].map((l,i)=>({...l,num:i+1}))};
                  });
                  if(isExtra) u({panelizedLighting:{...pl,[floorKey]:updated}});
                  else u({panelizedLighting:{...pl,cp4Loads:{...(pl.cp4Loads||{}),[floorKey]:updated}}});
                };
                return (
                  <LoadsList
                    loads={pl.loads||[]}
                    onChange={v=>u({panelizedLighting:{...pl,loads:v}})}
                    floorOptions={["Main Level","Basement","Upper Level",...(pl.extraFloors||[]).map(ef=>ef.label)]}
                    allModules={allModules}
                    assignedModMap={assignedModMap}
                    onAssignToModule={onAssignToModule}/>
                );
              })()}

              <SectionHead label={`${job.lightingSystem||"Control 4"} Keypads`} color={C.purple}/>

              {(()=>{
                // Build assigned names set to filter from keypad/module suggestions
                const _pl=job.panelizedLighting;
                const _assignedNames=new Set();
                const _stdF=[{k:"main"},{k:"basement"},{k:"upper"}];
                _stdF.forEach(({k})=>migrateFloorToModules(_pl.cp4Loads?.[k]||[]).forEach(m=>m.loads.forEach(l=>{if(l.name?.trim())_assignedNames.add(l.name.trim());})));
                (_pl.extraFloors||[]).forEach(ef=>migrateFloorToModules(_pl[ef.key]||[]).forEach(m=>m.loads.forEach(l=>{if(l.name?.trim())_assignedNames.add(l.name.trim());})));
                const al=(_pl.loads||[]).filter(l=>!_assignedNames.has(l.name?.trim()||""));
                return (<>

              <KeypadSection label="Main Level Keypad Loads"
                loads={job.panelizedLighting.mainKeypad}
                allLoads={al}
                onChange={v=>u({panelizedLighting:{...job.panelizedLighting,mainKeypad:v}})}/>

              <KeypadSection label="Basement Keypad Loads"
                loads={job.panelizedLighting.basementKeypad}
                allLoads={al}
                onChange={v=>u({panelizedLighting:{...job.panelizedLighting,basementKeypad:v}})}/>

              <KeypadSection label="Upper Level Keypad Loads"
                loads={job.panelizedLighting.upperKeypad}
                allLoads={al}
                onChange={v=>u({panelizedLighting:{...job.panelizedLighting,upperKeypad:v}})}/>

              {(job.panelizedLighting.extraFloors||[]).map(ef=>(
                <KeypadSection key={ef.key} label={`${ef.label} Keypad Loads`}
                  loads={(job.panelizedLighting[ef.key+"_keypad"])||[]}
                  allLoads={al}
                  onChange={v=>u({panelizedLighting:{...job.panelizedLighting,[ef.key+"_keypad"]:v}})}/>
              ))}

              </>);})()}

              <SectionHead label={`${job.lightingSystem||"Control 4"} Panel Loads`} color={C.purple}/>

              {(()=>{
                // Filtered allLoads for module suggestions — exclude loads already in a module
                const _plM=job.panelizedLighting;
                const _anM=new Set();
                [{k:"main"},{k:"basement"},{k:"upper"}].forEach(({k})=>migrateFloorToModules(_plM.cp4Loads?.[k]||[]).forEach(m=>m.loads.forEach(l=>{if(l.name?.trim())_anM.add(l.name.trim());})));
                (_plM.extraFloors||[]).forEach(ef=>migrateFloorToModules(_plM[ef.key]||[]).forEach(m=>m.loads.forEach(l=>{if(l.name?.trim())_anM.add(l.name.trim());})));
                const alMod=(_plM.loads||[]).filter(l=>!_anM.has(l.name?.trim()||""));
                return (<>
                {[
                  {floor:"upper", defaultLabel:"Upper Level"},
                  {floor:"main",  defaultLabel:"Main Level"},
                  {floor:"basement", defaultLabel:"Basement"},
                ].map(({floor,defaultLabel})=>(
                  <div key={floor} style={{marginBottom:16}}>
                    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",
                      marginBottom:8,paddingBottom:4,borderBottom:`1px solid ${C.border}`}}>
                      <input
                        value={job.plSectionLabels?.[floor]||""}
                        onChange={e=>u({plSectionLabels:{...(job.plSectionLabels||{}),[floor]:e.target.value}})}
                        placeholder={defaultLabel}
                        style={{fontSize:11,fontWeight:700,letterSpacing:"0.08em",color:C.purple,
                          background:"none",border:"none",outline:"none",cursor:"text",
                          textTransform:"uppercase",fontFamily:"inherit",flex:1}}/>
                    </div>
                    <PanelModulesSection
                      system={job.lightingSystem||"Control 4"}
                      allLoads={alMod}
                      modules={migrateFloorToModules((job.panelizedLighting.cp4Loads?.[floor])||[])}
                      onChange={v=>u({panelizedLighting:{...job.panelizedLighting,
                        cp4Loads:{...(job.panelizedLighting.cp4Loads||{}), [floor]:v}}})}/>
                  </div>
                ))}

                {(job.panelizedLighting.extraFloors||[]).map(ef=>(
                  <div key={ef.key} style={{marginBottom:16}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",
                      marginBottom:8,paddingBottom:4,borderBottom:`1px solid ${C.border}`}}>
                      <input
                        value={ef.label}
                        onChange={e=>{
                          const newExtras=(job.panelizedLighting.extraFloors||[]).map(f=>f.key===ef.key?{...f,label:e.target.value}:f);
                          u({panelizedLighting:{...job.panelizedLighting,extraFloors:newExtras}});
                        }}
                        style={{fontSize:11,fontWeight:700,letterSpacing:"0.08em",color:C.purple,
                          background:"none",border:"none",outline:"none",cursor:"text",
                          textTransform:"uppercase",fontFamily:"inherit",flex:1}}/>
                      <button onClick={()=>{
                        const newExtras=(job.panelizedLighting.extraFloors||[]).filter(e=>e.key!==ef.key);
                        const updated={...job.panelizedLighting,extraFloors:newExtras};
                        delete updated[ef.key+"_keypad"];
                        u({panelizedLighting:updated});
                      }} style={{background:"none",border:"none",color:C.muted,cursor:"pointer",fontSize:11,flexShrink:0}}>Remove</button>
                    </div>
                    <PanelModulesSection
                      system={job.lightingSystem||"Control 4"}
                      allLoads={alMod}
                      modules={migrateFloorToModules((job.panelizedLighting[ef.key])||[])}
                      onChange={v=>u({panelizedLighting:{...job.panelizedLighting,[ef.key]:v}})}/>
                  </div>
                ))}
                </>);
              })()}

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
                      placeholder="Add panel / area…"
                      style={{flex:1,minWidth:160,background:C.surface,border:`1px solid ${C.border}`,
                        borderRadius:7,padding:"7px 10px",fontSize:12,fontFamily:"inherit",
                        outline:"none",color:C.text}}/>
                    <button onClick={addFloor}
                      style={{background:C.purple,color:"#fff",border:"none",borderRadius:7,
                        padding:"7px 14px",fontSize:12,fontWeight:700,cursor:"pointer",
                        fontFamily:"inherit",whiteSpace:"nowrap"}}>
                      + Add Panel / Area
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
                const LVBadge = ()=><span style={{fontSize:9,fontWeight:800,color:'#2563eb',background:'#ede9fe',borderRadius:4,padding:'1px 5px',marginRight:6,flexShrink:0}}>LV</span>;
                const renderLVRows = (rows) => rows&&rows.length>0?(
                  <div style={{marginBottom:8}}>
                    {rows.map((r,i)=>(
                      <div key={i} style={{display:'flex',alignItems:'flex-start',gap:8,padding:'5px 10px',
                        background:'#eff6ff',border:'1px solid #c4b5fd44',borderRadius:7,marginBottom:4}}>
                        <LVBadge/>
                        <div style={{flex:1}}>
                          <div style={{fontSize:12,color:'#6d28d9',fontWeight:600}}>{r.name||'—'}</div>
                          {r.module&&<div style={{fontSize:11,color:'#2563eb',marginTop:1}}>Module/Ch: {r.module}</div>}
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
                  <div style={{marginTop:20,padding:'14px 16px',background:'#eff6ff',
                    border:'1px solid #c4b5fd',borderRadius:12}}>
                    <div style={{fontSize:12,fontWeight:700,color:'#2563eb',marginBottom:12,display:'flex',alignItems:'center',gap:6}}>
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

              <Section label="QC Walk Checklist" color={C.teal} defaultOpen={true} action={
                <PunchPicker punch={job.qcPunch||{}} jobId={job.id} stage="QC" color={C.teal} showHotcheck={true}
                  filter={job.qcPunchFilter||null} filterLabel={job.qcPunchFilterLabel||''} onSaveFilter={(v,lbl)=>u({qcPunchFilter:v,qcPunchFilterLabel:lbl})}/>
              }>
                <PunchSection punch={job.qcPunch} onChange={v=>{const allClear=punchOpen(v)===0;u({qcPunch:v,...(job.qcStatus==="fail"&&allClear?{qcStatus:"pass"}:{})});}} jobName={job.name||"Job"} phase="QC" onEmail={({subject,body})=>{ openEmail("", subject, body); }} showHotcheck={true}
                  filterIds={job.qcPunchFilter ? new Set(job.qcPunchFilter) : null}/>
              </Section>

              {(job.qcPunchExternal?.length>0)&&(
                <ExternalPunchSection items={job.qcPunchExternal||[]}
                  label={job.qcPunchFilterLabel||'GC'}
                  onChange={v=>u({qcPunchExternal:v})}
                  color={C.teal}/>
              )}

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

              {/* Matterport */}
              <div style={{marginTop:12}}>
                <div style={{fontSize:10,color:C.dim,marginBottom:6,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                  <span>MATTERPORT</span>
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
                {/* Scan status */}
                {(()=>{const mpDef=getStatusDef(MATTERPORT_STATUSES,job.matterportStatus||"");return(
                  <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap",marginTop:8}}>
                    <span style={{fontSize:10,color:C.dim,fontWeight:700,letterSpacing:"0.07em"}}>SCAN STATUS</span>
                    <select value={job.matterportStatus||""} onChange={e=>{const v=e.target.value;const def=getStatusDef(MATTERPORT_STATUSES,v);u({matterportStatus:v,matterportStatusDate:def.hasDate?job.matterportStatusDate:""});}}
                      style={{background:mpDef.color?`${mpDef.color}18`:C.surface,color:mpDef.color||C.dim,border:`1px solid ${mpDef.color||C.border}`,borderRadius:6,padding:"4px 8px",fontSize:11,fontFamily:"inherit",fontWeight:mpDef.color?700:400,outline:"none",cursor:"pointer"}}>
                      {MATTERPORT_STATUSES.map(s=><option key={s.value} value={s.value}>{s.label}</option>)}
                    </select>
                    {mpDef.hasDate&&<DateInp value={job.matterportStatusDate||""} onChange={e=>u({matterportStatusDate:e.target.value})} style={{width:120,fontSize:11,borderColor:mpDef.color+"55",background:`${mpDef.color}08`}}/>}
                  </div>
                );})()}
              </div>

              <Section label="Pre-Job Prep" color={C.teal} defaultOpen={!allPrepDone(job)}>
                <div style={{display:"flex",flexDirection:"column",gap:8}}>
                  {PREP_CHECKLIST_ITEMS.map((item,i)=>{
                    const checked=!!((job.prepChecklist||{})[item.key]);
                    const isLast=item.key==="readyToHandOff";
                    return(
                      <label key={item.key} style={{display:"flex",alignItems:"center",gap:10,cursor:"pointer",
                        ...(isLast?{marginTop:6,paddingTop:10,borderTop:`1px solid ${C.border}`}:{})}}>
                        <input type="checkbox" checked={checked}
                          onChange={e=>{
                            const newChecklist={...(job.prepChecklist||{}),[item.key]:e.target.checked};
                            u({prepChecklist:newChecklist});
                          }}
                          style={{accentColor:C.teal,width:16,height:16,flexShrink:0}}/>
                        <span style={{fontSize:13,color:checked?C.teal:C.text,fontWeight:checked?600:400,
                          textDecoration:checked&&!isLast?"line-through":"none"}}>
                          {item.label}
                        </span>
                      </label>
                    );
                  })}
                </div>
                {allPrepDone(job)&&(
                  <div style={{marginTop:10,fontSize:11,fontWeight:700,color:C.teal}}>✓ Prep Complete — Handed Off to Foreman</div>
                )}
              </Section>

              <Section label="Admin" color={C.dim} defaultOpen={!(job.jobAccount && job.preLien)}>
                <div style={{display:"flex",flexDirection:"column",gap:10}}>
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
              </Section>

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


function QAList({questions: _questions, onChange, color, gcAnswerMap={}, filterIds=null}) {

  // guard: old data may be a string instead of array

  const questions = Array.isArray(_questions) ? _questions : [];

  const [draft, setDraft] = useState("");

  const add = (textArg) => {

    const q = typeof textArg==='string' ? textArg : draft;

    if(!q.trim()) return;

    const who = getIdentity();

    onChange([...questions, {id:uid(), question:q, answer:"", done:false, addedBy:who?.name||""}]);

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

        <div style={{flex:1,display:"flex",flexDirection:"column",gap:2}}>
          <QAInlineEdit

            value={q.question}

            done={q.done}

            label={`Q${globalIdx+1}: `}

            onSave={v=>upd(q.id,{question:v})}/>

          {q.addedBy&&<span style={{fontSize:9,color:C.dim}}>added by {q.addedBy}</span>}
          {filterIds!=null&&<span style={{fontWeight:700,borderRadius:99,padding:'1px 6px',lineHeight:1.6,fontSize:9,
            background:filterIds.has(q.id)?'#dcfce7':'#f3f4f6',
            color:filterIds.has(q.id)?'#16a34a':'#9ca3af',alignSelf:'flex-start'}}>
            {filterIds.has(q.id)?'Shared':'Not shared'}
          </span>}
        </div>

        <button onClick={()=>{ if(!window.confirm("Delete this question?")) return; del(q.id); }}

          style={{background:"none",border:"none",color:C.muted,cursor:"pointer",

            fontSize:12,flexShrink:0,padding:"0 2px"}}>✕</button>

      </div>

      {!q.done&&(

        <div style={{marginLeft:22}}>

          <div style={{fontSize:10,color:color,fontWeight:700,marginBottom:4,letterSpacing:"0.08em"}}>ANSWER</div>

          <TA value={q.answer} rows={2}
            onChange={e=>upd(q.id,{answer:e.target.value})}
            onBlur={html=>upd(q.id,{answer:html})}
            placeholder="Type answer here…"/>

        </div>

      )}

      {q.done&&q.answer&&(

        <div style={{marginLeft:22,marginTop:4,fontSize:11,color:C.dim,display:"flex",alignItems:"flex-start",gap:6}}>
          {q.gcAnswered&&<span style={{fontSize:9,fontWeight:700,color:"#16a34a",background:"#dcfce7",borderRadius:4,padding:"1px 5px",flexShrink:0,marginTop:1}}>GC</span>}
          <div style={{fontStyle:"italic",flex:1,lineHeight:1.5}} dangerouslySetInnerHTML={{__html:q.answer}}/>
        </div>

      )}

      {/* If GC has answered but it hasn't been applied yet, show a pending indicator */}
      {!q.done&&gcAnswerMap[q.id]&&(
        <div style={{marginLeft:22,marginTop:6,background:"#f0fdf4",border:"1px solid #16a34a44",borderRadius:6,padding:"6px 10px",fontSize:11}}>
          <span style={{fontSize:9,fontWeight:700,color:"#16a34a",background:"#dcfce7",borderRadius:4,padding:"1px 5px",marginRight:6}}>GC</span>
          <span style={{color:"#15803d",fontStyle:"italic"}} dangerouslySetInnerHTML={{__html:gcAnswerMap[q.id]||''}}/>

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

          onKeyDown={e=>e.key==='Enter'&&add()}
          onBlur={add}/>

        <Btn onClick={add} variant="primary">+</Btn>

      </div>

    </div>

  );

}


function QASection({questions: _questions, onChange, color, gcAnswerMap={}, filterIds=null}) {

  // guard: normalize questions to always be object with array values

  const questions = (_questions && typeof _questions === 'object' && !Array.isArray(_questions))

    ? _questions : {upper:[], main:[], basement:[]};

  const allQIds = filterIds!=null ? [
    ...(questions.upper||[]), ...(questions.main||[]), ...(questions.basement||[])
  ].map(q=>q.id) : [];
  const sharedQCount = filterIds!=null ? allQIds.filter(id=>filterIds.has(id)).length : 0;

  return (

    <div>

      {filterIds!=null&&allQIds.length>0&&(
        <div style={{fontSize:10,fontWeight:600,color:sharedQCount===allQIds.length?C.green:C.muted,marginBottom:8}}>
          {sharedQCount} of {allQIds.length} shared
        </div>
      )}

      {[["upper","Upper Level"],["main","Main Level"],["basement","Basement"]].map(([k,l])=>(

        <div key={k} style={{marginBottom:18}}>

          <div style={{fontSize:11,color:C.dim,fontWeight:600,marginBottom:8}}>{l}</div>

          <QAList

            questions={Array.isArray(questions[k]) ? questions[k] : []}

            onChange={v=>onChange({...questions,[k]:v})}

            color={color}
            gcAnswerMap={gcAnswerMap}
            filterIds={filterIds}/>

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

  // Temp Peds
  { key:"tempPedReady",    label:"Temp Peds — Ready to Schedule", color:"#8b5cf6",
    test: j => !!j.tempPed && (!j.tempPedStatus||j.tempPedStatus==="ready") },

  { key:"tempPedScheduled", label:"Temp Peds — Scheduled",           color:"#2563eb",
    test: j => !!j.tempPed && j.tempPedStatus==="scheduled" },

  // Full Jobs
  { key:"prep",         label:"Pre Job Prep",              color:"#0d9488",
    test: j => !j.tempPed && !j.quickJob && !allPrepDone(j) },

  { key:"roughNotStarted", label:"Rough — Not Started",   color:"#64748b",
    test: j => { const rs=effRS(j); return !j.tempPed && !j.quickJob && allPrepDone(j) && (!rs||rs==="waiting_date"||rs==="date_confirmed"||rs==="scheduled"); } },

  { key:"roughHold",    label:"Rough — On Hold",           color:"#ca8a04",
    test: j => !j.tempPed && !j.quickJob && effRS(j) === "waiting" },

  { key:"rough",        label:"Rough In Progress",         color:"#2563eb",
    test: j => !j.tempPed && !j.quickJob && effRS(j) === "inprogress" },

  { key:"between",      label:"In Between",                color:"#e8a020",
    test: j => { if(j.tempPed||j.quickJob) return false; const rs=effRS(j); const fs=effFS(j); return rs==="complete"&&(!fs||fs==="waiting_date"||fs==="date_confirmed"||fs==="scheduled"); } },

  { key:"finishHold",   label:"Finish — On Hold",          color:"#ca8a04",
    test: j => !j.tempPed && !j.quickJob && effFS(j) === "waiting" },

  { key:"finish",       label:"Finish In Progress",        color:"#0ea5e9",
    test: j => !j.tempPed && !j.quickJob && effFS(j) === "inprogress" },

  // All completed — quick jobs, temp peds, and full jobs in one section
  { key:"complete",     label:"Completed",                 color:"#22c55e",
    test: j => (j.quickJob && (j.quickJobStatus==="complete"||j.quickJobStatus==="invoice")) ||
               (j.tempPed && j.tempPedStatus==="completed") ||
               (!j.tempPed && !j.quickJob && effFS(j) === "complete") },

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

function UpcomingJobs({ upcoming, onChange, onDelete, onPromote, onPromoteToQuote, canManage=false, foremenList }) {
  const [editingId, setEditingId] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [winW, setWinW] = useState(window.innerWidth);
  useEffect(()=>{
    const handle=()=>setWinW(window.innerWidth);
    window.addEventListener("resize",handle);
    return ()=>window.removeEventListener("resize",handle);
  },[]);
  const narrow = winW < 700;

  const add = () => { if(!canManage) return; const j=blankUpcoming(); onChange([j,...upcoming]); setEditingId(j.id); };
  const upd = (id,patch) => { if(!canManage) return; onChange(upcoming.map(u=>u.id===id?{...u,...patch}:u)); };
  const del = (id) => {
    onChange(upcoming.filter(u=>u.id!==id));
    onDelete && onDelete(id);
    setEditingId(null);
    setConfirmDeleteId(null);
  };
  const COL = {
    name:{label:"Job Name",flex:2.5}, city:{label:"City",flex:1.2},
    sales:{label:"Sales",flex:1}, customer:{label:"Customer / GC",flex:1.5},
    notes:{label:"Notes",flex:3}, lastFollowUp:{label:"Last Follow Up",flex:1.1},
  };
  const colKeys = Object.keys(COL);

  // Shared edit form used in both layouts
  const EditForm = ({u}) => (
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
      <div style={{display:"flex",gap:8,marginTop:2,flexWrap:"wrap"}}>
        <button onClick={()=>setEditingId(null)} style={{background:C.accent,border:"none",borderRadius:7,color:"#000",fontWeight:700,padding:"6px 16px",fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>Done</button>
        <button onClick={()=>onPromote(u)} style={{background:"none",border:`1px solid ${C.green}`,borderRadius:7,color:C.green,fontWeight:700,padding:"6px 16px",fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>✓ Promote to Job</button>
        <button onClick={()=>onPromoteToQuote(u)} style={{background:"none",border:`1px solid ${C.accent}`,borderRadius:7,color:C.accent,fontWeight:700,padding:"6px 16px",fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>→ Quote</button>
        <button onClick={()=>del(u.id)} style={{background:"none",border:"none",color:C.muted,fontSize:12,cursor:"pointer",fontFamily:"inherit",marginLeft:"auto"}}>Remove</button>
      </div>
    </div>
  );

  const signedCount = upcoming.filter(u=>u.signed).length;

  // Signed toggle — saves to Firestore via parent onChange
  const toggleSigned = (u) => upd(u.id, {signed: !u.signed});

  // Signed badge used in both layouts
  const SignedBadge = () => (
    <span style={{fontSize:10,fontWeight:700,color:C.green,background:`${C.green}18`,
      borderRadius:99,padding:"2px 8px",border:`1px solid ${C.green}44`,whiteSpace:"nowrap"}}>
      ✓ SIGNED — ON BOARD
    </span>
  );

  return (
    <div>
      <div style={{padding:"24px 26px 16px",borderBottom:`1px solid ${C.border}`}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12}}>
          <div>
            <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:28,letterSpacing:"0.06em",color:C.text,lineHeight:1}}>UPCOMING JOBS</div>
            <div style={{fontSize:11,color:C.dim,marginTop:3}}>
              {upcoming.length} job{upcoming.length!==1?"s":""} in pipeline
              {signedCount>0&&<span style={{marginLeft:8,color:C.green,fontWeight:700}}>· {signedCount} signed</span>}
            </div>
          </div>
          {canManage&&<button onClick={add} style={{background:C.accent,border:"none",borderRadius:9,color:"#000",fontWeight:700,padding:"9px 20px",fontSize:13,cursor:"pointer",fontFamily:"inherit",whiteSpace:"nowrap"}}>+ Add Job</button>}
        </div>
      </div>

      {/* ── Mobile card layout ── */}
      {narrow ? (
        <div style={{padding:"12px 14px"}}>
          {upcoming.length===0&&<div style={{textAlign:"center",padding:"48px 0",color:C.muted,fontSize:13,fontStyle:"italic"}}>No upcoming jobs yet — add one above.</div>}
          {upcoming.map(u=>{
            const isEditing=editingId===u.id;
            const fc=getFC(u.foreman)||"#6b7280";
            const isSigned=!!u.signed;
            return (
              <div key={u.id} style={{
                background: isSigned ? `${C.green}08` : C.card,
                border: `1px solid ${isSigned ? C.green+"55" : C.border}`,
                borderLeft: `3px solid ${isSigned ? C.green : C.border}`,
                borderRadius:11, padding:14, marginBottom:10,
              }}>
                {isEditing ? <EditForm u={u}/> : (
                  <>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:6}}>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:14,fontWeight:700,color:C.text,marginBottom:4}}>
                          {u.name||<span style={{color:C.muted,fontStyle:"italic"}}>Untitled</span>}
                        </div>
                        <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                          {isSigned&&<SignedBadge/>}
                          {u.foreman&&<span style={{fontSize:10,fontWeight:700,color:fc,background:`${fc}18`,borderRadius:99,padding:"1px 7px",border:`1px solid ${fc}33`}}>{u.foreman}</span>}
                        </div>
                      </div>
                      <div style={{display:"flex",gap:5,alignItems:"center",marginLeft:8,flexShrink:0,flexWrap:"wrap",justifyContent:"flex-end"}}>
                        {canManage&&<button onClick={()=>toggleSigned(u)} style={{
                          background: isSigned?`${C.green}18`:"none",
                          border:`1px solid ${isSigned?C.green:C.border}`,
                          borderRadius:6,color:isSigned?C.green:C.dim,fontSize:11,
                          padding:"4px 10px",cursor:"pointer",fontFamily:"inherit",fontWeight:isSigned?700:400,
                        }}>{isSigned?"✓ Signed":"Sign"}</button>}
                        {canManage&&<button onClick={()=>setEditingId(u.id)} style={{background:"none",border:`1px solid ${C.border}`,borderRadius:6,color:C.dim,fontSize:11,padding:"4px 10px",cursor:"pointer",fontFamily:"inherit"}}>Edit</button>}
                        <button onClick={()=>onPromoteToQuote(u)} style={{background:"none",border:`1px solid ${C.accent}`,borderRadius:6,color:C.accent,fontSize:11,fontWeight:700,padding:"4px 10px",cursor:"pointer",fontFamily:"inherit"}}>Q</button>
                        <button onClick={()=>onPromote(u)} style={{background:C.green,border:"none",borderRadius:6,color:"#fff",fontSize:11,fontWeight:700,padding:"4px 10px",cursor:"pointer",fontFamily:"inherit"}}>Move to Board</button>
                        {confirmDeleteId===u.id ? (
                          <>
                            <button onClick={()=>del(u.id)} style={{background:"#ef4444",border:"none",borderRadius:5,color:"#fff",fontSize:11,fontWeight:700,cursor:"pointer",padding:"3px 8px",fontFamily:"inherit"}}>Yes</button>
                            <button onClick={()=>setConfirmDeleteId(null)} style={{background:"none",border:`1px solid ${C.border}`,borderRadius:5,color:C.dim,fontSize:11,cursor:"pointer",padding:"3px 8px",fontFamily:"inherit"}}>No</button>
                          </>
                        ) : (
                          canManage&&<button onClick={()=>setConfirmDeleteId(u.id)} style={{background:"none",border:"none",color:C.muted,fontSize:18,cursor:"pointer",padding:"0 2px",lineHeight:1,fontFamily:"inherit"}} title="Remove">×</button>
                        )}
                      </div>
                    </div>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"4px 12px",marginBottom:u.notes?6:0}}>
                      {u.city&&<div style={{fontSize:11,color:C.dim}}><span style={{color:C.muted,fontSize:10}}>City </span>{u.city}</div>}
                      {u.customer&&<div style={{fontSize:11,color:C.dim}}><span style={{color:C.muted,fontSize:10}}>Customer </span>{u.customer}</div>}
                      {u.sales&&<div style={{fontSize:11,color:C.dim}}><span style={{color:C.muted,fontSize:10}}>Sales </span>{u.sales}</div>}
                      {u.lastFollowUp&&<div style={{fontSize:11,color:C.dim}}><span style={{color:C.muted,fontSize:10}}>Follow Up </span>{u.lastFollowUp}</div>}
                    </div>
                    {u.notes&&<div style={{fontSize:12,color:C.dim,marginTop:4,lineHeight:1.4}}>{u.notes}</div>}
                  </>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        /* ── Desktop table layout ── */
        <div style={{padding:"16px 26px"}}>
          <div style={{display:"flex",alignItems:"center",gap:0,padding:"6px 12px",marginBottom:4,borderBottom:`1px solid ${C.border}`}}>
            {colKeys.map(k=>(
              <div key={k} style={{flex:COL[k].flex,fontSize:10,fontWeight:700,letterSpacing:"0.08em",color:C.dim,textTransform:"uppercase",paddingRight:12}}>{COL[k].label}</div>
            ))}
            <div style={{width:160,flexShrink:0}}/>
          </div>
          {upcoming.length===0&&<div style={{textAlign:"center",padding:"48px 0",color:C.muted,fontSize:13,fontStyle:"italic"}}>No upcoming jobs yet — add one above.</div>}
          {upcoming.map(u=>{
            const isEditing=editingId===u.id;
            const isSigned=!!u.signed;
            return (
              <div key={u.id} style={{
                display:"flex", alignItems:isEditing?"flex-start":"center", gap:0,
                padding:"6px 12px", borderRadius:8, marginBottom:3,
                background: isEditing ? C.surface : isSigned ? `${C.green}08` : "none",
                border: isEditing ? `1px solid ${C.border}` : isSigned ? `1px solid ${C.green}44` : "1px solid transparent",
                borderLeft: isSigned&&!isEditing ? `3px solid ${C.green}` : isEditing ? `1px solid ${C.border}` : "1px solid transparent",
              }}
                onMouseEnter={e=>{if(!isEditing)e.currentTarget.style.background=isSigned?`${C.green}12`:C.surface;}}
                onMouseLeave={e=>{if(!isEditing)e.currentTarget.style.background=isSigned?`${C.green}08`:"none";}}>
                {isEditing ? <EditForm u={u}/> : (
                  <>
                    <div style={{flex:2.5,paddingRight:12,overflow:"hidden"}}>
                      <div style={{fontSize:13,fontWeight:600,color:C.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                        {u.name||<span style={{color:C.muted,fontStyle:"italic"}}>Untitled</span>}
                        {u.foreman&&<span style={{marginLeft:8,fontSize:10,fontWeight:700,color:getFC(u.foreman)||"#6b7280",background:`${getFC(u.foreman)||"#6b7280"}18`,borderRadius:99,padding:"1px 7px",border:`1px solid ${getFC(u.foreman)||"#6b7280"}33`}}>{u.foreman}</span>}
                      </div>
                      {isSigned&&<div style={{marginTop:2}}><SignedBadge/></div>}
                    </div>
                    <div style={{flex:1.2,paddingRight:12,fontSize:12,color:C.dim,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{u.city||"—"}</div>
                    <div style={{flex:1,paddingRight:12,fontSize:12,color:C.dim,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{u.sales||"—"}</div>
                    <div style={{flex:1.5,paddingRight:12,fontSize:12,color:C.dim,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{u.customer||"—"}</div>
                    <div style={{flex:3,paddingRight:12,fontSize:12,color:C.dim,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{u.notes||"—"}</div>
                    <div style={{flex:1.1,paddingRight:12,fontSize:12,color:C.dim,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{u.lastFollowUp||"—"}</div>
                    <div style={{width:160,flexShrink:0,display:"flex",gap:5,justifyContent:"flex-end",alignItems:"center"}}>
                      <button onClick={()=>toggleSigned(u)} title={isSigned?"Remove signed status":"Mark as signed / on job board"} style={{
                        background: isSigned?`${C.green}18`:"none",
                        border:`1px solid ${isSigned?C.green:C.border}`,
                        borderRadius:6,color:isSigned?C.green:C.dim,fontSize:11,
                        padding:"3px 8px",cursor:"pointer",fontFamily:"inherit",fontWeight:isSigned?700:400,whiteSpace:"nowrap",
                      }}>{isSigned?"✓ Signed":"Sign"}</button>
                      <button onClick={()=>setEditingId(u.id)} style={{background:"none",border:`1px solid ${C.border}`,borderRadius:6,color:C.dim,fontSize:11,padding:"3px 8px",cursor:"pointer",fontFamily:"inherit"}}>Edit</button>
                      <button onClick={()=>onPromoteToQuote(u)} style={{background:"none",border:`1px solid ${C.accent}`,borderRadius:6,color:C.accent,fontSize:11,fontWeight:700,padding:"3px 8px",cursor:"pointer",fontFamily:"inherit"}}>Q</button>
                      <button onClick={()=>onPromote(u)} style={{background:C.green,border:"none",borderRadius:6,color:"#fff",fontSize:11,fontWeight:700,padding:"3px 8px",cursor:"pointer",fontFamily:"inherit"}}>✓</button>
                      {confirmDeleteId===u.id ? (
                        <>
                          <span style={{fontSize:10,color:C.muted,whiteSpace:"nowrap"}}>Remove?</span>
                          <button onClick={()=>del(u.id)} style={{background:"#ef4444",border:"none",borderRadius:5,color:"#fff",fontSize:11,fontWeight:700,cursor:"pointer",padding:"3px 8px",fontFamily:"inherit"}}>Yes</button>
                          <button onClick={()=>setConfirmDeleteId(null)} style={{background:"none",border:`1px solid ${C.border}`,borderRadius:5,color:C.dim,fontSize:11,cursor:"pointer",padding:"3px 8px",fontFamily:"inherit"}}>No</button>
                        </>
                      ) : (
                        <button onClick={()=>setConfirmDeleteId(u.id)} style={{background:"none",border:"none",color:C.muted,fontSize:16,cursor:"pointer",padding:"0 2px",lineHeight:1,fontFamily:"inherit"}} title="Remove">×</button>
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
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

    // (Rough/Finish invoice tasks consolidated into the single "Ready to Invoice" task above)

    // Rough complete → Matterport scan task (assigned to foreman)
    if((effRS(job)==="complete" || job.matterportStatus==="needs") && (job.matterportStatus||"")!=="complete" && !(job.matterportLinks?.length || job.matterportLink) && !job.matterportDismissed) tasks.push({
      id: job.id+"_matterport", jobId: job.id, jobName: job.name,
      type: "auto", category: "matterport", foreman,
      title: "Schedule Matterport Scan",
      desc: job.matterportStatus==="scheduled"
        ? `Scan scheduled${job.matterportStatusDate?" for "+job.matterportStatusDate:""}`
        : job.matterportStatus==="needs"&&job.matterportStatusDate ? "Needs scheduled by "+job.matterportStatusDate : "Rough is complete — schedule the Matterport scan",
      color: C.rough, cleared: false,
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
    if(!job.tempPed && job.type!=="quote" && !allPrepDone(job)) {
      const c=job.prepChecklist||{};
      const items=PREP_CHECKLIST_ITEMS;
      const doneCount=items.filter(i=>c[i.key]).length;
      const nextItem=items.find(i=>!c[i.key]);
      tasks.push({
        id: job.id+"_prep", jobId: job.id, jobName: job.name,
        type: "auto", category: "prep", foreman: "Koy",
        prepStage: job.prepStage||"",
        title: `Pre Job Prep: ${job.name||"Untitled"}`,
        desc: doneCount===0?"Not started":`${doneCount}/${items.length} complete${nextItem?` — Next: ${nextItem.label}`:""}`,
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
        {task.desc&&!task.windowLabel&&<div style={{fontSize:11,color:"var(--dim)",fontStyle:"italic",lineHeight:1.4}}><RichText html={task.desc}/></div>}
        {task.notes&&<div style={{fontSize:11,color:"var(--dim)",marginTop:2,lineHeight:1.4}}><RichText html={task.notes}/></div>}

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
  const dismissMatterport    = (jobId)     => { const job=jobs.find(j=>j.id===jobId); if(job&&onUpdateJob) onUpdateJob(jobId,{matterportDismissed:true}); };
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
    task.id.endsWith("_matterport")         ? ()=>dismissMatterport(task.jobId) :
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
                {key:'scheduling', label:'Scheduling',      icon:'📅', color:'#2563eb', cats:['rough','finish','schedule','tempped','matterport']},
                {key:'rt',         label:'Return Trips',    icon:'🔄', color:'#8b5cf6', cats:['rt']},
                {key:'co',         label:'Change Orders',   icon:'📋', color:'#dc2626', cats:['co']},
                {key:'qc',         label:'QC Walks',        icon:'✅', color:'#0d9488', cats:['qc']},
                {key:'po',         label:'Purchase Orders', icon:'📦', color:'#2563eb', cats:['po']},
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

// ── Simpro Crew Schedule ──────────────────────────────────────

function SimproCrewSchedule({ jobs, identity, users=[], foremanColors={}, onSelectJob }) {
  const [schedule, setSchedule]       = useState(null);   // raw entries from Simpro
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState(null);
  const [weekOffset, setWeekOffset]   = useState(0);      // 0 = this week, 1 = next, etc.
  const [collapsed, setCollapsed]     = useState(false); // always start open

  // Compute Mon–Sun for the displayed week
  const weekDates = useMemo(() => {
    const now = new Date();
    const day = now.getDay(); // 0=Sun
    const mon = new Date(now);
    mon.setDate(now.getDate() - (day === 0 ? 6 : day - 1) + weekOffset * 7);
    mon.setHours(0,0,0,0);
    return Array.from({length:7}, (_,i) => {
      const d = new Date(mon);
      d.setDate(mon.getDate() + i);
      return d;
    });
  }, [weekOffset]);

  const toYMD = d => d.toISOString().split("T")[0];
  const dateFrom = toYMD(weekDates[0]);
  const dateTo   = toYMD(weekDates[6]);

  // Fetch when week changes
  useEffect(() => {
    setLoading(true);
    setError(null);
    const fn = httpsCallable(functions, "getSimproSchedule");
    fn({ dateFrom, dateTo })
      .then(res => { setSchedule(res.data); setLoading(false); })
      .catch(e  => { setError(e.message);   setLoading(false); });
  }, [dateFrom, dateTo]);

  // Re-fetch when the user returns to the tab / unlocks phone
  useEffect(() => {
    const handleFocus = () => {
      const fn = httpsCallable(functions, "getSimproSchedule");
      fn({ dateFrom, dateTo })
        .then(res => setSchedule(res.data))
        .catch(() => {}); // silent — keep existing data on failure
    };
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") handleFocus();
    });
    return () => {
      window.removeEventListener("focus", handleFocus);
    };
  }, [dateFrom, dateTo]);

  // All unique staff names across job-type entries
  const allStaff = useMemo(() => {
    if (!schedule) return [];
    const names = [...new Set(
      schedule.filter(s => s.Type === "job").map(s => s.Staff?.Name).filter(Boolean)
    )].sort();
    return names;
  }, [schedule]);

  // Build staff name → crew color map using foremanId linkage
  // Each crew member's name maps to their foreman's color
  const staffColorMap = useMemo(() => {
    const map = {};
    // Map foreman user IDs → their color
    const foremanColorById = {};
    users.forEach(u => {
      const firstName = (u.name || "").split(" ")[0];
      const color = foremanColors[u.name] || foremanColors[firstName];
      if (color) foremanColorById[u.id] = color;
    });
    // For each user with a foremanId, map their name to that foreman's color
    users.forEach(u => {
      if (u.foremanId && foremanColorById[u.foremanId]) {
        // Match by first name or full name against SimPro staff names
        const firstName = (u.name || "").split(" ")[0].toLowerCase();
        allStaff.forEach(staffName => {
          if (staffName.toLowerCase().startsWith(firstName)) {
            map[staffName] = foremanColorById[u.foremanId];
          }
        });
      }
    });
    // Foremen get their own color too
    users.forEach(u => {
      const firstName = (u.name || "").split(" ")[0];
      const color = foremanColors[u.name] || foremanColors[firstName];
      if (color) {
        allStaff.forEach(staffName => {
          if (staffName.toLowerCase().startsWith(firstName.toLowerCase())) {
            map[staffName] = color;
          }
        });
      }
    });
    return map;
  }, [users, foremanColors, allStaff]);

  // Build "my crew" names — works for both foremen and crew members
  const myCrewNames = useMemo(() => {
    if (!identity?.id) return [];
    let firstNames = [];
    // Am I a foreman? (crew members have me as their foremanId)
    const asForeman = users.filter(u => u.foremanId === identity.id).map(u => (u.name||"").split(" ")[0].toLowerCase());
    if (asForeman.length > 0) {
      // Include self + all my crew
      firstNames = [...new Set([(identity.name||"").split(" ")[0].toLowerCase(), ...asForeman])];
    } else if (identity.foremanId) {
      // I'm a crew member — include my foreman + all their crew
      const foreman = users.find(u => u.id === identity.foremanId);
      const crewmates = users.filter(u => u.foremanId === identity.foremanId).map(u => (u.name||"").split(" ")[0].toLowerCase());
      const foremanFirst = foreman ? (foreman.name||"").split(" ")[0].toLowerCase() : null;
      firstNames = [...new Set([...(foremanFirst ? [foremanFirst] : []), ...crewmates, (identity.name||"").split(" ")[0].toLowerCase()])];
    }
    if (!firstNames.length) return [];
    return allStaff.filter(n => firstNames.some(c => n.toLowerCase().startsWith(c)));
  }, [users, identity, allStaff]);

  const iAmForeman = users.some(u => u.foremanId === identity?.id);
  const hasMyCrew  = myCrewNames.length > 0;

  // Build a list of all foreman crews for the dropdown — {foremanId, foremanName, color, staffNames[]}
  const foremanCrews = useMemo(() => {
    const foremen = users.filter(u => {
      const t = u.title || u.role || "";
      return t === "foreman";
    });
    return foremen.map(f => {
      const firstName = (f.name||"").split(" ")[0];
      const color = foremanColors[f.name] || foremanColors[firstName] || C.accent;
      const crewFirstNames = users
        .filter(u => u.foremanId === f.id)
        .map(u => (u.name||"").split(" ")[0].toLowerCase());
      const staffNames = allStaff.filter(n => crewFirstNames.some(c => n.toLowerCase().startsWith(c)));
      return { foremanId: f.id, foremanName: firstName, color, staffNames };
    }).filter(fc => fc.staffNames.length > 0);
  }, [users, foremanColors, allStaff]);

  const [personFilter, setPersonFilter] = useState("all");

  // Auto-default to your own foreman's crew
  useEffect(() => {
    if (personFilter !== "all") return;
    if (!identity?.id) return;
    // Am I a foreman? Find my own crew entry
    const myForeman = foremanCrews.find(fc => fc.foremanId === identity.id);
    if (myForeman) { setPersonFilter("crew_" + myForeman.foremanId); return; }
    // Am I a crew member? Find the foreman I'm assigned to
    if (identity.foremanId) {
      const myBoss = foremanCrews.find(fc => fc.foremanId === identity.foremanId);
      if (myBoss) { setPersonFilter("crew_" + myBoss.foremanId); return; }
    }
  }, [foremanCrews, identity?.id, identity?.foremanId]);

  // Match Simpro ProjectID → app job
  const jobBySimproNo = useMemo(() => {
    const map = {};
    jobs.forEach(j => { if (j.simproNo) map[String(j.simproNo)] = j; });
    return map;
  }, [jobs]);

  // Group entries by date, filtered by person
  const byDate = useMemo(() => {
    if (!schedule) return {};
    const jobEntries = schedule.filter(s => s.Type === "job");
    const crewMatch = personFilter.startsWith("crew_") ? foremanCrews.find(fc => "crew_"+fc.foremanId === personFilter) : null;
    const filtered = personFilter === "all" ? jobEntries
      : personFilter === "mycrew" ? jobEntries.filter(s => myCrewNames.includes(s.Staff?.Name))
      : crewMatch ? jobEntries.filter(s => crewMatch.staffNames.includes(s.Staff?.Name))
      : jobEntries.filter(s => s.Staff?.Name === personFilter);
    const map = {};
    filtered.forEach(s => {
      if (!map[s.Date]) map[s.Date] = [];
      map[s.Date].push(s);
    });
    return map;
  }, [schedule, personFilter, myCrewNames]);

  // For each date, one block per job showing all crew with earliest start → latest end
  const crewByDateAndJob = useMemo(() => {
    if (!schedule) return {};
    const out = {};
    weekDates.forEach(d => {
      const ymd = toYMD(d);
      const dayEntries = (schedule || []).filter(s => s.Type === "job" && s.Date === ymd);

      const byProject = {};
      dayEntries.forEach(s => {
        const pid = String(s.Project?.ProjectID || s.Reference);
        if (!byProject[pid]) byProject[pid] = [];
        byProject[pid].push(s);
      });

      const blocks = Object.entries(byProject).map(([pid, entries]) => {
        const startTimes = entries.map(s => s.Blocks?.[0]?.StartTime || "").filter(Boolean).sort();
        const endTimes   = entries.map(s => s.Blocks?.[s.Blocks?.length-1]?.EndTime || "").filter(Boolean).sort();
        const startTime  = startTimes[0] || "";
        const endTime    = endTimes[endTimes.length-1] || "";
        return { entries, ref: entries[0].Reference, projectId: pid, startTime, endTime };
      });

      out[ymd] = blocks.sort((a,b) => (a.startTime||"").localeCompare(b.startTime||""));
    });
    return out;
  }, [schedule, weekDates]);

  const todayYMD = toYMD(new Date());

  const fmtWeekday = d => d.toLocaleDateString("en-US", { weekday:"short" }).toUpperCase();
  const fmtDate    = d => d.toLocaleDateString("en-US", { month:"short", day:"numeric" });
  const fmtTime    = t => { if (!t) return ""; const [h,m] = t.split(":"); const hr=parseInt(h); return `${hr>12?hr-12:hr||12}:${m}${hr>=12?"pm":"am"}`; };

  const hasAnyThisWeek = weekDates.some(d => (crewByDateAndJob[toYMD(d)]||[]).length > 0);

  return (
    <div style={{borderBottom:`1px solid ${C.border}`,background:C.card}}>
      {/* Header row */}
      <div onClick={()=>setCollapsed(v=>!v)}
        style={{display:"flex",alignItems:"center",gap:10,padding:"12px 24px",cursor:"pointer",
          userSelect:"none"}}>
        <div style={{fontSize:11,fontWeight:800,letterSpacing:"0.12em",color:C.accent,textTransform:"uppercase"}}>
          Crew Schedule
        </div>
        {loading && <span style={{fontSize:10,color:C.dim}}>Loading…</span>}
        {!loading && !hasAnyThisWeek && !error &&
          <span style={{fontSize:10,color:C.dim}}>No jobs scheduled this week</span>}
        <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:8}}>
          {/* Crew filter */}
          {!collapsed && foremanCrews.length > 0 && (
            <select value={personFilter} onChange={e=>setPersonFilter(e.target.value)}
              onClick={e=>e.stopPropagation()}
              style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:6,
                color:C.text,fontSize:11,padding:"4px 8px",cursor:"pointer",fontFamily:"inherit"}}>
              <option value="all">Everyone</option>
              {foremanCrews.map(fc => (
                <option key={fc.foremanId} value={"crew_"+fc.foremanId}>{fc.foremanName}'s Crew</option>
              ))}
            </select>
          )}
          {/* Week nav */}
          {!collapsed && (
            <div style={{display:"flex",alignItems:"center",gap:4}} onClick={e=>e.stopPropagation()}>
              <button onClick={()=>setWeekOffset(v=>v-1)}
                style={{background:"none",border:`1px solid ${C.border}`,borderRadius:6,
                  color:C.dim,fontSize:12,width:26,height:26,cursor:"pointer",display:"flex",
                  alignItems:"center",justifyContent:"center"}}>‹</button>
              <span style={{fontSize:10,color:C.dim,minWidth:80,textAlign:"center"}}>
                {weekOffset===0?"This week":weekOffset===1?"Next week":
                  `${fmtDate(weekDates[0])} – ${fmtDate(weekDates[6])}`}
              </span>
              <button onClick={()=>setWeekOffset(v=>v+1)}
                style={{background:"none",border:`1px solid ${C.border}`,borderRadius:6,
                  color:C.dim,fontSize:12,width:26,height:26,cursor:"pointer",display:"flex",
                  alignItems:"center",justifyContent:"center"}}>›</button>
            </div>
          )}
          <span style={{fontSize:12,color:C.dim,transform:collapsed?"rotate(-90deg)":"rotate(90deg)",
            display:"inline-block",transition:"transform 0.2s"}}>›</span>
        </div>
      </div>

      {/* Schedule content */}
      {!collapsed && (
        <div style={{padding:"0 24px 16px",overflowX:"auto"}}>
          {error && <div style={{color:"#ef4444",fontSize:12,padding:"8px 0"}}>{error}</div>}
          {!error && (
            <div style={{display:"flex",gap:8,minWidth:"max-content"}}>
              {weekDates.map(d => {
                const ymd    = toYMD(d);
                const isToday = ymd === todayYMD;
                const activeCrew = personFilter.startsWith("crew_")
                  ? (foremanCrews.find(fc => "crew_"+fc.foremanId === personFilter)?.staffNames || [])
                  : [];
                const dayJobs = (crewByDateAndJob[ymd] || []).filter(g =>
                  personFilter === "all" ? true
                  : g.entries.some(e => activeCrew.includes(e.Staff?.Name))
                );
                return (
                  <div key={ymd} style={{width:160,flexShrink:0}}>
                    {/* Day header */}
                    <div style={{marginBottom:6,padding:"4px 8px",borderRadius:6,
                      background:isToday?C.accent:"transparent",
                      textAlign:"center"}}>
                      <div style={{fontSize:10,fontWeight:800,letterSpacing:"0.08em",
                        color:isToday?"#000":C.dim}}>{fmtWeekday(d)}</div>
                      <div style={{fontSize:11,fontWeight:600,color:isToday?"#000":C.text}}>
                        {fmtDate(d)}
                      </div>
                    </div>
                    {/* Job blocks */}
                    {dayJobs.length === 0
                      ? <div style={{fontSize:10,color:C.muted,textAlign:"center",padding:"8px 0",
                          fontStyle:"italic"}}>—</div>
                      : dayJobs.map(g => {
                          const appJob   = jobBySimproNo[g.projectId];
                          const jobName  = appJob?.name || g.ref || `Job #${g.projectId}`;
                          // Filter entries to only the active crew when filtered
                          const visibleEntries = personFilter === "all"
                            ? g.entries
                            : g.entries.filter(e => activeCrew.includes(e.Staff?.Name));
                          // Sort entries by start time
                          const sortedEntries = [...visibleEntries].sort((a,b) =>
                            (a.Blocks?.[0]?.StartTime||"").localeCompare(b.Blocks?.[0]?.StartTime||""));
                          // Block color from first visible entry
                          const blockColor = (() => {
                            for (const e of sortedEntries) {
                              const c = staffColorMap[e.Staff?.Name];
                              if (c) return c;
                            }
                            return C.accent;
                          })();
                          return (
                            <div key={g.projectId}
                              onClick={()=>{ if(appJob) onSelectJob(appJob); }}
                              style={{background:C.surface,border:`1px solid ${blockColor}44`,
                                borderLeft:`3px solid ${blockColor}`,borderRadius:7,
                                padding:"8px 10px",marginBottom:6,
                                cursor:appJob?"pointer":"default",
                                transition:"background 0.15s"}}
                              onMouseEnter={e=>{if(appJob)e.currentTarget.style.background=`${blockColor}11`;}}
                              onMouseLeave={e=>{e.currentTarget.style.background=C.surface;}}>
                              <div style={{fontSize:11,fontWeight:700,color:C.text,
                                whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",
                                marginBottom:5}}>{jobName}</div>
                              {sortedEntries.map(e => {
                                const fullName  = e.Staff?.Name || "";
                                const parts     = fullName.split(" ");
                                const shortName = parts.length > 1 ? `${parts[0]} ${parts[parts.length-1][0]}.` : parts[0];
                                const nameColor = staffColorMap[fullName] || C.accent;
                                const eStart    = fmtTime(e.Blocks?.[0]?.StartTime);
                                const eEnd      = fmtTime(e.Blocks?.[e.Blocks?.length-1]?.EndTime);
                                return shortName ? (
                                  <div key={fullName} style={{display:"flex",justifyContent:"space-between",
                                    alignItems:"center",marginBottom:3}}>
                                    <span style={{fontSize:10,fontWeight:700,color:nameColor}}>{shortName}</span>
                                    {(eStart||eEnd) && (
                                      <span style={{fontSize:9,color:C.dim,fontWeight:500}}>
                                        {eStart}{eEnd?`–${eEnd}`:""}
                                      </span>
                                    )}
                                  </div>
                                ) : null;
                              })}
                            </div>
                          );
                        })
                    }
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Nav View ──────────────────────────────────────────────────

function NavView({ jobs }) {
  const [search, setSearch] = useState("");
  const s = search.toLowerCase().trim();

  const active = jobs
    .filter(j => j.address)
    .filter(j => !s || (j.name||"").toLowerCase().includes(s) || (j.address||"").toLowerCase().includes(s) || (j.foreman||"").toLowerCase().includes(s) || (j.gc||"").toLowerCase().includes(s))
    .sort((a,b) => (a.name||"").localeCompare(b.name||""));

  return (
    <div style={{maxWidth:700,margin:"0 auto",padding:"20px 16px"}}>
      <div style={{fontSize:20,fontWeight:700,color:C.text,marginBottom:4}}>Navigate</div>
      <div style={{fontSize:12,color:C.dim,marginBottom:16}}>All job addresses — tap to open in Maps</div>

      <input value={search} onChange={e=>setSearch(e.target.value)}
        placeholder="Search jobs, address, foreman…"
        style={{width:"100%",boxSizing:"border-box",background:C.surface,border:`1px solid ${C.border}`,
          borderRadius:9,padding:"9px 14px",fontSize:13,fontFamily:"inherit",color:C.text,
          outline:"none",marginBottom:16}}/>

      {active.length===0&&(
        <div style={{textAlign:"center",padding:"48px 0",color:C.muted,fontSize:13,fontStyle:"italic"}}>
          {search ? "No jobs match that search." : "No jobs with addresses yet."}
        </div>
      )}

      {active.map(j=>(
        <div key={j.id} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:10,
          padding:"12px 16px",marginBottom:8,display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
          <div style={{flex:1,minWidth:160}}>
            <div style={{fontSize:13,fontWeight:700,color:C.text,marginBottom:2}}>{j.name||"Unnamed"}</div>
            {j.foreman&&<div style={{fontSize:11,color:C.dim}}>{j.foreman}</div>}
          </div>
          <AddressLink address={j.address} style={{fontSize:13,color:C.accent,fontWeight:600}}>
            {j.address} <span style={{fontSize:11,opacity:0.7}}>📍</span>
          </AddressLink>
        </div>
      ))}

      <div style={{textAlign:"center",fontSize:11,color:C.muted,marginTop:16}}>
        {active.length} job{active.length!==1?"s":""} with addresses
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

  // Simpro schedule data — which jobs are actually scheduled this month?
  const [simproSchedule, setSimproSchedule] = useState([]);
  useEffect(() => {
    const year  = calMonth.getFullYear();
    const month = String(calMonth.getMonth()+1).padStart(2,"0");
    const lastDay = new Date(year, calMonth.getMonth()+1, 0).getDate();
    const dateFrom = `${year}-${month}-01`;
    const dateTo   = `${year}-${month}-${lastDay}`;
    const fn = httpsCallable(functions, "getSimproSchedule");
    fn({ dateFrom, dateTo })
      .then(res => setSimproSchedule((res.data||[]).filter(s=>s.Type==="job")))
      .catch(() => {}); // silent — crew counts are supplementary
  }, [calMonth]);

  // Map of date (YYYY-MM-DD) → Set of Simpro ProjectIDs scheduled that day
  const simproByDate = useMemo(() => {
    const map = new Map();
    simproSchedule.forEach(entry => {
      const pid = entry.Project?.ProjectID;
      const date = entry.Date; // "YYYY-MM-DD"
      if (!pid || !date) return;
      if (!map.has(date)) map.set(date, new Set());
      map.get(date).add(String(pid));
    });
    return map;
  }, [simproSchedule]);

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
    const sno=ev.job.simproNo?String(ev.job.simproNo):null;
    const inSimpro=sno&&ev.startDate&&(simproByDate.get(ev.startDate)?.has(sno)||false);
    const notScheduled=sno&&!inSimpro;
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
        {inSimpro&&<span title="Scheduled in Simpro" style={{fontSize:7,color:"#22c55e",
          fontWeight:800,flexShrink:0,lineHeight:1}}>✓</span>}
        {notScheduled&&<span title="Not scheduled in Simpro" style={{fontSize:7,color:C.orange,
          fontWeight:800,flexShrink:0,lineHeight:1}}>!</span>}
        {ev.hardDate&&<span style={{fontSize:8,color:col,fontWeight:800,flexShrink:0}}>🔒</span>}
      </div>
    );
  };

  // ── Event Card (kanban/list) ──────────────────────────────────
  const EventCard=({ev})=>{
    const over=isOverdue(ev.startDate,ev.status);
    const col=over?C.red:ev.color;
    const fc=ev.fc;
    const sno=ev.job.simproNo?String(ev.job.simproNo):null;
    const inSimpro=sno&&ev.startDate&&(simproByDate.get(ev.startDate)?.has(sno)||false);
    const notScheduled=sno&&!inSimpro;
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
          {inSimpro&&<span title="Scheduled in Simpro" style={{fontSize:9,fontWeight:800,color:"#22c55e",
            background:"#22c55e18",borderRadius:99,padding:"2px 7px",border:"1px solid #22c55e33",
            flexShrink:0}}>✓ Simpro</span>}
          {notScheduled&&<span title="Has Simpro job # but not scheduled this month" style={{fontSize:9,
            fontWeight:700,color:C.orange,background:`${C.orange}18`,borderRadius:99,
            padding:"2px 7px",border:`1px solid ${C.orange}33`,flexShrink:0}}>Not scheduled</span>}
          {over&&<span style={{fontSize:9,fontWeight:800,color:C.red,letterSpacing:"0.07em",marginLeft:"auto"}}>OVERDUE</span>}
        </div>
        <div style={{fontWeight:700,fontSize:13,color:"var(--text)",marginBottom:3,
          overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{ev.job.name||"Untitled"}</div>
        {ev.desc&&ev.type!=="rough"&&ev.type!=="finish"&&
          <div style={{fontSize:11,color:"var(--dim)",marginBottom:4,overflow:"hidden",
            textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{ev.desc.replace(/<[^>]*>/g,"")}</div>}
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
                  <div style={{display:"flex",alignItems:"center",gap:4}}>
                    {isToday&&<span style={{fontSize:8,color:C.accent,fontWeight:800,letterSpacing:"0.08em"}}>TODAY</span>}
                    {dayEvs.length>0&&!isToday&&<span style={{fontSize:9,fontWeight:700,color:"var(--dim)"}}>{dayEvs.length}</span>}
                  </div>
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
                  fontFamily:"inherit",background:restoring?"#9ca3af":"#2563eb",color:"#fff",border:"none",
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
        setJob(jsnap.data()?.data);
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
      setJob(snap.data()?.data);
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
      setJob(snap.data()?.data);
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
  const floorLabel = (k) => job?.plSectionLabels?.[k] || (k==='main'?'Main Level':k==='basement'?'Basement':k==='upper'?'Upper Level':k);

  const SP = { accent:'#0ea5e9', accentDark:'#0284c7', accentBg:'#f0f9ff', accentBorder:'#7dd3fc',
               bg:'#f1f5f9', card:'#ffffff', border:'#e2e8f0', text:'#0f172a', dim:'#64748b', muted:'#94a3b8',
               green:'#16a34a', amber:'#d97706' };
  const inputStyle = {background:SP.bg,border:`1px solid ${SP.border}`,borderRadius:6,padding:'5px 8px',fontSize:12,fontFamily:'inherit',outline:'none',width:'100%',boxSizing:'border-box',color:SP.text};
  const lvRowStyle = {background:SP.accentBg,border:`1px solid ${SP.accentBorder}55`,borderRadius:8,padding:'8px 10px',marginBottom:6,display:'flex',gap:8,alignItems:'flex-start'};

  if(loading) return <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100vh',color:'#6b7280'}}>Loading…</div>;
  if(error)   return <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100vh',color:'#dc2626'}}>{error}</div>;

  return (
    <div style={{maxWidth:680,margin:'0 auto',padding:'28px 16px',fontFamily:"'DM Sans',system-ui,sans-serif",background:SP.bg,minHeight:'100vh'}}>
      {/* Header */}
      <div style={{background:SP.text,borderRadius:14,padding:'20px 22px',marginBottom:6}}>
        <div style={{fontSize:10,color:'rgba(255,255,255,0.45)',fontWeight:700,letterSpacing:'0.12em',marginBottom:4}}>HOMESTEAD ELECTRIC — {sys.toUpperCase()} LIGHTING</div>
        <div style={{fontSize:19,fontWeight:700,color:'#fff',marginBottom:2}}>{job?.name||'Job'}</div>
        {job?.address&&<div style={{fontSize:12,color:'rgba(255,255,255,0.55)'}}>{job.address}</div>}
        <div style={{marginTop:8,display:'inline-block',background:SP.accent,borderRadius:6,padding:'2px 10px',fontSize:10,fontWeight:700,color:'#fff',letterSpacing:'0.06em'}}>{sys}</div>
      </div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'6px 4px 14px'}}>
        <div style={{fontSize:11,color:SP.dim}}>Add your module assignments and circuit additions below. Changes save automatically.</div>
        <div style={{fontSize:11,fontWeight:600,color:saving?SP.muted:SP.green}}>{saving?'Saving…':savedAt?`✓ Saved ${savedAt.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}`:''}</div>
      </div>

      {/* Name field */}
      <div style={{background:SP.card,border:`1px solid ${SP.border}`,borderRadius:10,padding:14,marginBottom:16}}>
        <div style={{fontSize:11,fontWeight:700,color:SP.dim,marginBottom:6,letterSpacing:'0.07em'}}>YOUR NAME / COMPANY</div>
        <input value={collab.submittedBy||''} onChange={e=>saveCollab({...collab,submittedBy:e.target.value})}
          placeholder="e.g. John Smith — LV Solutions" style={{...inputStyle,fontSize:13}}/>
      </div>

      {/* Keypad sections */}
      {keypadSections.map(({key,label}) => {
        const existingRows = (pl[key]||[]).filter(r=>r.name);
        const lvRows = getSection(key);
        return (
          <div key={key} style={{background:SP.card,border:`1px solid ${SP.border}`,borderRadius:10,marginBottom:12,overflow:'hidden'}}>
            <div style={{background:SP.accent,padding:'8px 16px',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <span style={{fontSize:11,fontWeight:700,color:'#fff',letterSpacing:'0.08em'}}>{label.toUpperCase()}</span>
            </div>
            <div style={{padding:'10px 12px'}}>
              {existingRows.length>0&&(
                <div style={{marginBottom:10}}>
                  <div style={{fontSize:10,color:SP.muted,fontWeight:700,marginBottom:6,letterSpacing:'0.07em'}}>PLANNED BUTTONS</div>
                  {existingRows.map((r,i)=>(
                    <div key={r.id} style={{display:'flex',gap:8,alignItems:'center',padding:'5px 0',borderBottom:i<existingRows.length-1?`1px solid ${SP.border}`:'none'}}>
                      <span style={{fontSize:11,color:SP.muted,width:20}}>{r.num}.</span>
                      <span style={{flex:1,fontSize:12,color:SP.text,fontWeight:500}}>{r.name}</span>
                    </div>
                  ))}
                </div>
              )}
              <div style={{fontSize:10,color:SP.accent,fontWeight:700,marginBottom:6,marginTop:existingRows.length?8:0,letterSpacing:'0.07em'}}>YOUR ADDITIONS / ASSIGNMENTS</div>
              {lvRows.map(r=>(
                <div key={r.id} style={lvRowStyle}>
                  <div style={{flex:2}}><input value={r.name||''} onChange={e=>updRow(key,r.id,{name:e.target.value})} placeholder="Circuit / button name…" style={inputStyle}/></div>
                  <div style={{flex:1}}><input value={r.module||''} onChange={e=>updRow(key,r.id,{module:e.target.value})} placeholder="Module / channel…" style={inputStyle}/></div>
                  <div style={{flex:2}}><input value={r.notes||''} onChange={e=>updRow(key,r.id,{notes:e.target.value})} placeholder="Notes…" style={inputStyle}/></div>
                  <button onClick={()=>delRow(key,r.id)} style={{background:'none',border:'none',color:SP.muted,cursor:'pointer',fontSize:13,flexShrink:0}}>✕</button>
                </div>
              ))}
              <button onClick={()=>addRow(key)} style={{fontSize:11,fontWeight:700,color:SP.accent,background:SP.accentBg,border:`1px dashed ${SP.accentBorder}`,borderRadius:6,padding:'5px 14px',cursor:'pointer',fontFamily:'inherit',width:'100%',marginTop:4}}>+ Add Row</button>
            </div>
          </div>
        );
      })}

      {/* Panel load sections — module-block layout */}
      {panelFloors.map(floor => {
        const rawLoads = pl.cp4Loads?.[floor]||[];
        const extraFloorRaw = pl[floor]||[];
        const rawData = rawLoads.length ? rawLoads : extraFloorRaw;
        const mods = migrateFloorToModules(rawData);
        const hasAnyLoad = mods.some(m=>m.loads.some(l=>l.name));
        const lvKey = 'cp4_'+floor;
        const lvRows = getSection(lvKey);
        if(!hasAnyLoad&&!lvRows.length) return null;

        const isSav=sys==='Savant',isLut=sys==='Lutron',isCres=sys==='Crestron';
        const devLabel=isCres?'Device':'Module';

        return (
          <div key={floor} style={{background:SP.card,border:`1px solid ${SP.border}`,borderRadius:10,marginBottom:12,overflow:'hidden'}}>
            <div style={{background:SP.text,padding:'8px 16px',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <span style={{fontSize:11,fontWeight:700,color:'#fff',letterSpacing:'0.08em'}}>{floorLabel(floor).toUpperCase()} — PANEL LOADS</span>
              <span style={{background:SP.accent,borderRadius:5,padding:'1px 8px',fontSize:10,fontWeight:700,color:'#fff'}}>{sys}</span>
            </div>
            <div style={{padding:'10px 12px'}}>
              {hasAnyLoad&&(
                <div style={{marginBottom:12}}>
                  {mods.map(mod=>{
                    const namedLoads = mod.loads.filter(l=>l.name);
                    if(!namedLoads.length) return null;
                    const pulled = namedLoads.filter(l=>l.pulled).length;
                    return (
                      <div key={mod.id} style={{border:`1px solid ${SP.accentBorder}88`,borderRadius:8,marginBottom:8,overflow:'hidden'}}>
                        {/* Module header */}
                        <div style={{background:SP.accentBg,padding:'6px 10px',display:'flex',alignItems:'center',gap:8,flexWrap:'wrap',borderBottom:`1px solid ${SP.accentBorder}55`}}>
                          {!isSav&&<span style={{fontSize:10,fontWeight:700,color:SP.accentDark}}>{devLabel} {mod.modNum}</span>}
                          {mod.moduleType&&<span style={{fontSize:10,color:SP.accentDark,background:`${SP.accentBorder}44`,borderRadius:4,padding:'1px 6px',fontWeight:600}}>{mod.moduleType}</span>}
                          {isSav&&mod.panel&&<span style={{fontSize:10,color:SP.dim}}>Panel <b>{mod.panel}</b></span>}
                          {isSav&&mod.breaker&&<span style={{fontSize:10,color:SP.dim}}>Bkr <b>{mod.breaker}</b></span>}
                          {isSav&&mod.phase&&<span style={{fontSize:10,color:SP.dim}}>Phase <b>{mod.phase}</b></span>}
                          {isLut&&mod.bus&&<span style={{fontSize:10,color:SP.dim}}>Bus <b>{mod.bus}</b></span>}
                          {isLut&&mod.pdu&&<span style={{fontSize:10,color:SP.dim}}>PDU <b>{mod.pdu}</b></span>}
                          {isCres&&mod.chainPos&&<span style={{fontSize:10,color:SP.dim}}>Chain <b>{mod.chainPos}</b></span>}
                          <span style={{fontSize:10,color:SP.muted,marginLeft:'auto'}}>{namedLoads.length} ch{pulled>0?` · ${pulled} pulled`:''}</span>
                        </div>
                        {/* Load rows */}
                        <div style={{padding:'4px 10px 6px'}}>
                          {namedLoads.map(load=>(
                            <div key={load.id} style={{display:'grid',gridTemplateColumns:'18px 24px 1fr 36px 70px 52px',gap:6,
                              alignItems:'center',padding:'3px 0',borderBottom:`1px solid ${SP.border}`,
                              background:load.pulled?'rgba(22,163,74,0.06)':'transparent',borderRadius:4}}>
                              <span style={{fontSize:13,color:load.pulled?SP.green:SP.border,textAlign:'center'}}>{load.pulled?'✓':'○'}</span>
                              <span style={{fontSize:11,color:SP.muted,textAlign:'center',fontWeight:700}}>{load.num}</span>
                              <span style={{fontSize:12,color:SP.text,fontWeight:load.pulled?600:400}}>{load.name}</span>
                              {load.ch&&<span style={{fontSize:10,color:SP.dim,textAlign:'center',background:SP.bg,borderRadius:4,padding:'1px 4px'}}>Ch {load.ch}</span>}
                              {load.loadType&&<span style={{fontSize:10,color:SP.dim}}>{load.loadType}</span>}
                              {load.watts&&<span style={{fontSize:10,color:SP.dim}}>{load.watts}W</span>}
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* LV company additions */}
              <div style={{fontSize:10,color:SP.accent,fontWeight:700,marginBottom:6,marginTop:hasAnyLoad?8:0,letterSpacing:'0.07em'}}>YOUR ADDITIONS / NOTES</div>
              {lvRows.map(r=>(
                <div key={r.id} style={lvRowStyle}>
                  <div style={{flex:2}}><input value={r.name||''} onChange={e=>updRow(lvKey,r.id,{name:e.target.value})} placeholder="Load name…" style={inputStyle}/></div>
                  <div style={{flex:1}}><input value={r.module||''} onChange={e=>updRow(lvKey,r.id,{module:e.target.value})} placeholder="Module…" style={inputStyle}/></div>
                  <div style={{flex:2}}><input value={r.notes||''} onChange={e=>updRow(lvKey,r.id,{notes:e.target.value})} placeholder="Notes…" style={inputStyle}/></div>
                  <button onClick={()=>delRow(lvKey,r.id)} style={{background:'none',border:'none',color:SP.muted,cursor:'pointer',fontSize:13,flexShrink:0}}>✕</button>
                </div>
              ))}
              <button onClick={()=>addRow(lvKey)} style={{fontSize:11,fontWeight:700,color:SP.accent,background:SP.accentBg,border:`1px dashed ${SP.accentBorder}`,borderRadius:6,padding:'5px 14px',cursor:'pointer',fontFamily:'inherit',width:'100%',marginTop:4}}>+ Add Row</button>
            </div>
          </div>
        );
      })}

      {/* General notes */}
      <div style={{background:SP.card,border:`1px solid ${SP.border}`,borderRadius:10,padding:14,marginBottom:16}}>
        <div style={{fontSize:11,fontWeight:700,color:SP.dim,marginBottom:6,letterSpacing:'0.07em'}}>GENERAL NOTES</div>
        <textarea value={collab.notes||''} onChange={e=>saveCollab({...collab,notes:e.target.value})}
          placeholder="Any additional notes, questions, or specifications for Homestead Electric…" rows={4}
          style={{width:'100%',border:`1px solid ${SP.border}`,borderRadius:7,padding:'8px 10px',fontSize:13,fontFamily:'inherit',resize:'vertical',boxSizing:'border-box',outline:'none',color:SP.text,background:SP.bg}}/>
      </div>
      <div style={{textAlign:'center',fontSize:11,color:SP.muted}}>Changes save automatically as you type.</div>
    </div>
  );
}

// ─── Question Picker (selective share modal) ─────────────────────────────────
function QuestionPicker({ roughQuestions, finishQuestions, jobId, color, filter=null, onSaveFilter }) {
  const [open,     setOpen]     = useState(false);
  const [selected, setSelected] = useState(new Set());

  const flatQs = (qs, phase) => {
    if(!qs || typeof qs !== 'object') return [];
    return [
      ...(qs.upper||[]).map(q=>({...q, phase, floor:'Upper Level'})),
      ...(qs.main||[]).map(q=>({...q, phase, floor:'Main Level'})),
      ...(qs.basement||[]).map(q=>({...q, phase, floor:'Basement'})),
    ];
  };

  const allQs = [
    ...flatQs(roughQuestions, 'rough'),
    ...flatQs(finishQuestions, 'finish'),
  ];

  const openPicker = () => {
    // Pre-select from saved filter if one exists, otherwise select all
    const initIds = filter ? new Set(filter) : new Set(allQs.map(q=>q.id));
    setSelected(initIds);
    setOpen(true);
  };

  const toggle = (id) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleAll = (ids) => {
    setSelected(prev => {
      const allOn = ids.every(id=>prev.has(id));
      const next = new Set(prev);
      ids.forEach(id => allOn ? next.delete(id) : next.add(id));
      return next;
    });
  };

  const saveFilter = () => {
    if(!selected.size){ alert('Select at least one question.'); return; }
    if(onSaveFilter) onSaveFilter([...selected]);
    const link = `${window.location.origin}/?questions=${jobId}`;
    navigator.clipboard.writeText(link)
      .then(()=>alert('Filter saved! Link copied to clipboard.'))
      .catch(()=>alert('Filter saved!'));
    setOpen(false);
  };

  const clearFilter = () => {
    if(onSaveFilter) onSaveFilter(null);
    setOpen(false);
  };

  if(!allQs.length) return null;

  const roughQs  = allQs.filter(q=>q.phase==='rough');
  const finishQs = allQs.filter(q=>q.phase==='finish');
  const phaseColor = { rough:'#2563eb', finish:'#0ea5e9' };

  const renderGroup = (qs, label, pc) => {
    if(!qs.length) return null;
    const ids = qs.map(q=>q.id);
    const allOn = ids.every(id=>selected.has(id));
    return (
      <div style={{marginBottom:16}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',
          borderBottom:`2px solid ${pc}33`,paddingBottom:5,marginBottom:8}}>
          <span style={{fontSize:11,fontWeight:700,color:pc,letterSpacing:'0.08em'}}>{label}</span>
          <button onClick={()=>toggleAll(ids)}
            style={{fontSize:10,color:pc,background:'none',border:`1px solid ${pc}55`,borderRadius:4,
              padding:'2px 8px',cursor:'pointer',fontFamily:'inherit',fontWeight:600}}>
            {allOn?'Deselect All':'Select All'}
          </button>
        </div>
        {qs.map((q,i)=>(
          <div key={q.id} onClick={()=>toggle(q.id)}
            style={{display:'flex',alignItems:'flex-start',gap:10,padding:'8px 10px',marginBottom:4,
              borderRadius:7,cursor:'pointer',
              background:selected.has(q.id)?`${pc}10`:'#f9fafb',
              border:`1px solid ${selected.has(q.id)?pc+'44':'#e5e7eb'}`}}>
            <div style={{width:16,height:16,borderRadius:4,border:`2px solid ${selected.has(q.id)?pc:'#d1d5db'}`,
              background:selected.has(q.id)?pc:'#fff',flexShrink:0,marginTop:1,
              display:'flex',alignItems:'center',justifyContent:'center'}}>
              {selected.has(q.id)&&<span style={{color:'#fff',fontSize:9,fontWeight:900}}>✓</span>}
            </div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:10,color:'#9ca3af',fontWeight:600,marginBottom:1}}>{q.floor}</div>
              <div style={{fontSize:13,color:'#1f2937',lineHeight:1.4}}>Q{i+1}: {q.question}</div>
            </div>
          </div>
        ))}
      </div>
    );
  };

  return (
    <>
      <button onClick={openPicker}
        style={{background:`${color}15`,border:`1px solid ${color}55`,borderRadius:6,
          color,fontSize:11,fontWeight:700,padding:'4px 12px',cursor:'pointer',
          fontFamily:'inherit',letterSpacing:'0.05em'}}>
        {filter ? `Shared (${filter.length}) ↗` : 'Share ↗'}
      </button>

      {open&&(
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.55)',zIndex:9999,
          display:'flex',alignItems:'center',justifyContent:'center',padding:16}}
          onClick={e=>{if(e.target===e.currentTarget)setOpen(false);}}>
          <div style={{background:'#fff',borderRadius:14,width:'100%',maxWidth:520,
            maxHeight:'85vh',display:'flex',flexDirection:'column',overflow:'hidden',
            boxShadow:'0 20px 60px rgba(0,0,0,0.3)'}}>
            {/* Modal header */}
            <div style={{padding:'16px 20px',borderBottom:'1px solid #e5e7eb',display:'flex',
              alignItems:'center',justifyContent:'space-between',flexShrink:0}}>
              <div>
                <div style={{fontSize:15,fontWeight:700,color:'#111'}}>Select Questions to Share</div>
                <div style={{fontSize:11,color:'#9ca3af',marginTop:2}}>
                  {selected.size} of {allQs.length} selected · recipient will only see chosen questions
                </div>
              </div>
              <button onClick={()=>setOpen(false)}
                style={{background:'none',border:'none',fontSize:20,cursor:'pointer',color:'#9ca3af',padding:'0 4px',lineHeight:1}}>✕</button>
            </div>
            {/* Question list */}
            <div style={{padding:'16px 20px',overflowY:'auto',flex:1}}>
              {renderGroup(roughQs, '⚡ ROUGH PHASE', phaseColor.rough)}
              {renderGroup(finishQs, '🏁 FINISH PHASE', phaseColor.finish)}
            </div>
            {/* Footer */}
            <div style={{padding:'12px 20px',borderTop:'1px solid #e5e7eb',display:'flex',gap:8,flexShrink:0}}>
              <button onClick={saveFilter}
                style={{flex:1,background:'#1e3a5f',color:'#fff',border:'none',borderRadius:8,
                  padding:'10px 16px',fontSize:13,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>
                Save & Copy Link ({selected.size} question{selected.size!==1?'s':''})
              </button>
              {filter&&(
                <button onClick={clearFilter}
                  style={{background:'#fef2f2',color:'#dc2626',border:'1px solid #fecaca',borderRadius:8,
                    padding:'10px 12px',fontSize:12,cursor:'pointer',fontFamily:'inherit',fontWeight:600}}>
                  Share All
                </button>
              )}
              <button onClick={()=>setOpen(false)}
                style={{background:'#f3f4f6',color:'#6b7280',border:'none',borderRadius:8,
                  padding:'10px 14px',fontSize:13,fontWeight:600,cursor:'pointer',fontFamily:'inherit'}}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─── Punch Picker (selective punch list share modal) ────────────────────────
function PunchPicker({ punch, jobId, stage, color, showHotcheck, filter=null, filterLabel='', onSaveFilter }) {
  const [open,     setOpen]     = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [label,    setLabel]    = useState('');

  const normF = (f) => (f && typeof f === 'object' ? f : {});

  const FLOOR_KEYS = [
    ['upper',    'Upper Level'],
    ['main',     'Main Level'],
    ['basement', 'Basement'],
    ...((punch.extras||[]).map(e=>[e.key, e.label])),
  ];

  const stageParam = stage.toLowerCase() + 'punch';

  // Flatten every item with its floor + section labels
  const getAllItems = () => {
    const out = [];
    FLOOR_KEYS.forEach(([k, floorLabel]) => {
      const f = normF(punch[k]);
      (f.general||[]).forEach(item =>
        out.push({...item, floorKey:k, floorLabel, section:'General'})
      );
      if(showHotcheck) {
        (f.hotcheck||[]).forEach(item =>
          out.push({...item, floorKey:k, floorLabel, section:'Hot Check'})
        );
      }
      (f.rooms||[]).forEach(room =>
        (room.items||[]).forEach(item =>
          out.push({...item, floorKey:k, floorLabel, section:room.name})
        )
      );
    });
    return out;
  };

  const allItems = getAllItems();

  const openPicker = () => {
    // Pre-select from saved filter if one exists, otherwise select all
    const initIds = filter ? new Set(filter) : new Set(allItems.map(i=>i.id));
    setSelected(initIds);
    setLabel(filterLabel || '');
    setOpen(true);
  };

  const toggle = (id) => setSelected(prev => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n;
  });

  const toggleFloor = (ids) => setSelected(prev => {
    const n   = new Set(prev);
    const all = ids.every(id=>n.has(id));
    ids.forEach(id => all ? n.delete(id) : n.add(id));
    return n;
  });

  const saveFilter = () => {
    if(!selected.size){ alert('Select at least one item.'); return; }
    if(onSaveFilter) onSaveFilter([...selected], label.trim() || 'GC');
    const link = `${window.location.origin}/?${stageParam}=${jobId}`;
    navigator.clipboard.writeText(link)
      .then(()=>alert('Filter saved! Link copied to clipboard.'))
      .catch(()=>alert('Filter saved!'));
    setOpen(false);
  };

  const clearFilter = () => {
    if(onSaveFilter) onSaveFilter(null);
    setOpen(false);
  };

  if(!allItems.length) return null;

  // Group items by floor for display
  const byFloor = FLOOR_KEYS.map(([k, floorLabel]) => {
    const items = allItems.filter(i=>i.floorKey===k);
    return { k, floorLabel, items };
  }).filter(g=>g.items.length>0);

  return (
    <>
      <button onClick={openPicker}
        style={{background:`${color}15`,border:`1px solid ${color}55`,borderRadius:6,
          color,fontSize:11,fontWeight:700,padding:'4px 12px',cursor:'pointer',
          fontFamily:'inherit',letterSpacing:'0.05em'}}>
        {filter ? `Shared (${filter.length}) ↗` : 'Share ↗'}
      </button>

      {open&&(
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',zIndex:9999,
          display:'flex',alignItems:'center',justifyContent:'center',padding:16}}
          onClick={e=>{if(e.target===e.currentTarget)setOpen(false);}}>
          <div style={{background:'#fff',borderRadius:14,width:'100%',maxWidth:500,
            maxHeight:'88vh',display:'flex',flexDirection:'column',overflow:'hidden',
            boxShadow:'0 24px 64px rgba(0,0,0,0.25)'}}>

            {/* Header */}
            <div style={{padding:'18px 22px 14px',borderBottom:'1px solid #e5e7eb',flexShrink:0}}>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:4}}>
                <div style={{fontSize:15,fontWeight:700,color:'#111'}}>Share {stage} Punch List</div>
                <button onClick={()=>setOpen(false)}
                  style={{background:'none',border:'none',fontSize:18,cursor:'pointer',
                    color:'#9ca3af',lineHeight:1,padding:'0 2px'}}>✕</button>
              </div>
              <div style={{marginBottom:10}}>
                <div style={{fontSize:10,color:'#9ca3af',fontWeight:600,letterSpacing:'0.06em',marginBottom:4}}>RECIPIENT NAME</div>
                <input value={label} onChange={e=>setLabel(e.target.value)} placeholder="e.g. GC, Smith Framing…"
                  style={{width:'100%',boxSizing:'border-box',border:'1px solid #e5e7eb',borderRadius:7,
                    padding:'7px 10px',fontSize:12,fontFamily:'inherit',outline:'none',color:'#111',
                    background:'#f9fafb'}}/>
                <div style={{fontSize:10,color:'#9ca3af',marginTop:4}}>This name labels their punch list in the app and on their page.</div>
              </div>
              <div style={{fontSize:12,color:'#9ca3af'}}>
                {selected.size} of {allItems.length} items selected — recipient sees only what you choose
              </div>
            </div>

            {/* Item list */}
            <div style={{overflowY:'auto',flex:1,padding:'14px 22px'}}>
              {byFloor.map(({k, floorLabel, items})=>{
                const ids   = items.map(i=>i.id);
                const allOn = ids.every(id=>selected.has(id));
                // Group within floor by section
                const sections = [...new Set(items.map(i=>i.section))];
                return (
                  <div key={k} style={{marginBottom:18}}>
                    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',
                      marginBottom:8,paddingBottom:6,borderBottom:`1.5px solid ${color}33`}}>
                      <span style={{fontSize:11,fontWeight:700,color,letterSpacing:'0.07em'}}>
                        {floorLabel.toUpperCase()}
                      </span>
                      <button onClick={()=>toggleFloor(ids)}
                        style={{fontSize:10,color,background:'none',border:`1px solid ${color}44`,
                          borderRadius:4,padding:'2px 8px',cursor:'pointer',fontFamily:'inherit',fontWeight:600}}>
                        {allOn?'Deselect All':'Select All'}
                      </button>
                    </div>
                    {sections.map(sec=>{
                      const secItems = items.filter(i=>i.section===sec);
                      const showSec  = sections.length > 1;
                      return (
                        <div key={sec}>
                          {showSec&&(
                            <div style={{fontSize:10,color:'#9ca3af',fontWeight:600,
                              letterSpacing:'0.06em',marginBottom:4,marginTop:6}}>
                              {sec.toUpperCase()}
                            </div>
                          )}
                          {secItems.map(item=>(
                            <div key={item.id} onClick={()=>toggle(item.id)}
                              style={{display:'flex',alignItems:'flex-start',gap:10,
                                padding:'7px 10px',marginBottom:3,borderRadius:7,cursor:'pointer',
                                background:selected.has(item.id)?`${color}0d`:'#f9fafb',
                                border:`1px solid ${selected.has(item.id)?color+'33':'#e5e7eb'}`}}>
                              <div style={{width:15,height:15,borderRadius:3,flexShrink:0,marginTop:1,
                                border:`2px solid ${selected.has(item.id)?color:'#d1d5db'}`,
                                background:selected.has(item.id)?color:'#fff',
                                display:'flex',alignItems:'center',justifyContent:'center'}}>
                                {selected.has(item.id)&&
                                  <span style={{color:'#fff',fontSize:8,fontWeight:900,lineHeight:1}}>✓</span>}
                              </div>
                              <div style={{flex:1}}>
                                <span style={{fontSize:12,color:item.done?'#9ca3af':'#1f2937',
                                  textDecoration:item.done?'line-through':'none',lineHeight:1.45}}
                                  dangerouslySetInnerHTML={{__html:item.text}}/>
                                {item.done&&<span style={{marginLeft:6,fontSize:10,color:'#6ee7b7',fontWeight:600}}>✓ done</span>}
                              </div>
                            </div>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>

            {/* Footer */}
            <div style={{padding:'12px 22px',borderTop:'1px solid #e5e7eb',
              display:'flex',gap:8,flexShrink:0,flexWrap:'wrap'}}>
              <button onClick={saveFilter}
                style={{flex:1,background:'#1e3a5f',color:'#fff',border:'none',borderRadius:8,
                  padding:'10px 16px',fontSize:13,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>
                Save & Copy Link — {selected.size} item{selected.size!==1?'s':''}
              </button>
              {filter&&(
                <button onClick={clearFilter}
                  style={{background:'#fef2f2',color:'#dc2626',border:'1px solid #fecaca',borderRadius:8,
                    padding:'10px 12px',fontSize:12,cursor:'pointer',fontFamily:'inherit',fontWeight:600}}>
                  Share All
                </button>
              )}
              <button onClick={()=>setOpen(false)}
                style={{background:'#f3f4f6',color:'#6b7280',border:'none',borderRadius:8,
                  padding:'10px 14px',fontSize:13,cursor:'pointer',fontFamily:'inherit'}}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─── External Punch Section (items added by GC / recipient via share page) ───
function ExternalPunchSection({ items, label, onChange, color }) {
  if(!items||!items.length) return null;
  const identity = getIdentity();
  const checkOff = (id) => {
    const now = new Date().toLocaleDateString('en-US');
    onChange(items.map(it => it.id===id
      ? {...it, done:true, checkedBy:identity?.name||'', checkedAt:now}
      : it
    ));
  };
  const uncheck = (id) => onChange(items.map(it => it.id===id ? {...it,done:false,checkedBy:'',checkedAt:''} : it));
  const remove  = (id) => onChange(items.filter(it=>it.id!==id));
  const open    = items.filter(it=>!it.done).length;
  return (
    <Section label={`${label}'s Punch List`} color={color} defaultOpen={open>0}
      action={open>0 ? <span style={{fontSize:11,color:color,fontWeight:700}}>{open} open</span> : null}>
      {items.map(it=>(
        <div key={it.id} style={{display:'flex',alignItems:'flex-start',gap:10,padding:'9px 0',
          borderBottom:`1px solid ${C.border}`}}>
          <div onClick={()=>it.done?uncheck(it.id):checkOff(it.id)}
            style={{width:18,height:18,borderRadius:4,flexShrink:0,marginTop:1,cursor:'pointer',
              border:`2px solid ${it.done?color:C.border}`,
              background:it.done?color:'transparent',
              display:'flex',alignItems:'center',justifyContent:'center'}}>
            {it.done&&<span style={{color:'#fff',fontSize:9,fontWeight:900}}>✓</span>}
          </div>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:13,color:it.done?C.muted:C.text,
              textDecoration:it.done?'line-through':'none',lineHeight:1.45,wordBreak:'break-word'}}
              dangerouslySetInnerHTML={{__html:it.text}}/>

            <div style={{fontSize:9,color:C.muted,marginTop:3,display:'flex',gap:6,flexWrap:'wrap'}}>
              <span>added by <b>{it.addedBy||label}</b>{it.addedAt?' · '+it.addedAt:''}</span>
              {it.done&&it.checkedBy&&(
                <span style={{color:C.green}}>✓ checked by {it.checkedBy}{it.checkedAt?' · '+it.checkedAt:''}</span>
              )}
            </div>
          </div>
          <button onClick={()=>remove(it.id)}
            style={{background:'none',border:'none',color:C.muted,cursor:'pointer',fontSize:13,
              flexShrink:0,padding:'0 2px',lineHeight:1}}>✕</button>
        </div>
      ))}
    </Section>
  );
}

// ─── Punch List Share Page (read-only for contractors) ───────────────────────
function PunchSharePage({ jobId, stage }) {
  const [job,          setJob]          = useState(null);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState(null);
  const [newItemText,  setNewItemText]  = useState('');
  const [addingItem,   setAddingItem]   = useState(false);
  const [addedCount,   setAddedCount]   = useState(0);

  useEffect(() => {
    const unsub = onSnapshot(doc(db,'jobs',jobId), snap => {
      if(!snap.exists()){ setError('This punch list is not available.'); setLoading(false); return; }
      setJob(snap.data()?.data);
      setLoading(false);
    }, () => { setError('Failed to load. Please try again.'); setLoading(false); });
    return () => unsub();
  }, [jobId]);

  const stageColor   = stage==='Rough' ? '#2563eb' : stage==='Finish' ? '#0ea5e9' : '#0d9488';
  const punchKey     = stage==='Rough' ? 'roughPunch' : stage==='Finish' ? 'finishPunch' : 'qcPunch';
  const showHotcheck = stage==='QC';
  const punch        = job?.[punchKey] || {};

  // Filter from Firestore — saved by crew via Share picker
  const filterIds = (() => {
    const raw = job?.[punchKey + 'Filter'];
    if (!Array.isArray(raw) || raw.length === 0) return null;
    return new Set(raw);
  })();

  const normF = (f) => f && typeof f==='object' ? f : {};
  const FLOOR_KEYS = [
    ['upper','Upper Level'],
    ['main','Main Level'],
    ['basement','Basement'],
    ...((punch.extras||[]).map(e=>[e.key, e.label])),
  ];

  const vis  = (items) => filterIds ? (items||[]).filter(i=>filterIds.has(i.id)) : (items||[]);
  const countFloorItems = (f) => {
    const nf = normF(f);
    return vis(nf.general).length + (showHotcheck?vis(nf.hotcheck).length:0) +
      (nf.rooms||[]).reduce((s,r)=>s+vis(r.items).length, 0);
  };
  const countDone = (f) => {
    const nf = normF(f);
    return vis(nf.general).filter(i=>i.done).length + (showHotcheck?vis(nf.hotcheck).filter(i=>i.done).length:0) +
      (nf.rooms||[]).reduce((s,r)=>s+vis(r.items).filter(i=>i.done).length, 0);
  };
  const totalItems = FLOOR_KEYS.reduce((s,[k])=>s+countFloorItems(punch[k]),0);
  const doneItems  = FLOOR_KEYS.reduce((s,[k])=>s+countDone(punch[k]),0);
  const pct = totalItems>0 ? Math.round(doneItems/totalItems*100) : 0;

  const renderItems = (items) => (items||[]).map(item=>(
    <div key={item.id} style={{padding:'8px 0',borderBottom:'1px solid #f3f4f6'}}>
      <div style={{display:'flex',alignItems:'flex-start',gap:8}}>
        <div style={{width:16,height:16,borderRadius:4,border:`2px solid ${item.done?stageColor:'#d1d5db'}`,
          background:item.done?stageColor:'#fff',flexShrink:0,marginTop:1,display:'flex',alignItems:'center',justifyContent:'center'}}>
          {item.done&&<span style={{color:'#fff',fontSize:9,fontWeight:900,lineHeight:1}}>✓</span>}
        </div>
        <span style={{fontSize:13,color:item.done?'#9ca3af':'#1f2937',textDecoration:item.done?'line-through':'none',lineHeight:1.45}} dangerouslySetInnerHTML={{__html:item.text}}/>
      </div>
      {item.waiting && !item.done && (
        <div style={{marginLeft:24,marginTop:4}}>
          <span style={{fontSize:11,fontWeight:700,background:'#fef3c7',color:'#92400e',
            borderRadius:99,padding:'2px 9px',border:'1px solid #fcd34d'}}>
            ⏳ {item.waitingOn ? `Waiting on: ${item.waitingOn}` : 'Waiting'}
          </span>
        </div>
      )}
    </div>
  ));

  if(loading) return <div style={{textAlign:'center',padding:60,color:'#9ca3af',fontFamily:'system-ui,sans-serif'}}>Loading…</div>;
  if(error)   return <div style={{textAlign:'center',padding:60,color:'#ef4444',fontFamily:'system-ui,sans-serif'}}>{error}</div>;

  return (
    <div style={{maxWidth:640,margin:'0 auto',padding:'28px 16px',fontFamily:'system-ui,sans-serif',background:'#f3f4f6',minHeight:'100vh'}}>
      {/* Header */}
      <div style={{background:'#1e3a5f',borderRadius:14,padding:'20px 22px',marginBottom:22}}>
        <div style={{fontSize:10,color:'rgba(255,255,255,0.55)',fontWeight:700,letterSpacing:'0.12em',marginBottom:4}}>
          HOMESTEAD ELECTRIC · {stage.toUpperCase()} PUNCH LIST
        </div>
        <div style={{fontSize:19,fontWeight:700,color:'#fff',marginBottom:2}}>{job?.name||'Project'}</div>
        {job?.address&&<div style={{fontSize:12,color:'rgba(255,255,255,0.65)',marginBottom:8}}>{job.address}</div>}
        {/* Progress bar */}
        <div style={{marginTop:10}}>
          <div style={{display:'flex',justifyContent:'space-between',fontSize:11,color:'rgba(255,255,255,0.7)',marginBottom:5}}>
            <span>{doneItems} of {totalItems} items complete</span>
            <span style={{fontWeight:700,color:pct===100?'#4ade80':'rgba(255,255,255,0.9)'}}>{pct}%</span>
          </div>
          <div style={{background:'rgba(255,255,255,0.15)',borderRadius:4,height:6}}>
            <div style={{background:pct===100?'#4ade80':stageColor,width:`${pct}%`,height:6,borderRadius:4,transition:'width 0.3s'}}/>
          </div>
        </div>
      </div>

      {totalItems===0 ? (
        <div style={{textAlign:'center',padding:'48px 20px',color:'#9ca3af',background:'#fff',borderRadius:12}}>
          <div style={{fontSize:32,marginBottom:12}}>📋</div>
          No punch list items yet. Check back later — this page updates automatically.
        </div>
      ) : (
        FLOOR_KEYS.map(([k, label]) => {
          const f = normF(punch[k]);
          const general   = vis(f.general);
          const hotcheck  = showHotcheck ? vis(f.hotcheck) : [];
          const rooms     = (f.rooms||[]).map(r=>({...r,items:vis(r.items)})).filter(r=>r.items.length>0);
          if(!general.length && !hotcheck.length && !rooms.length) return null;
          const floorTotal = general.length + hotcheck.length + rooms.reduce((s,r)=>s+r.items.length,0);
          const floorDone  = general.filter(i=>i.done).length + hotcheck.filter(i=>i.done).length + rooms.reduce((s,r)=>s+r.items.filter(i=>i.done).length,0);
          return (
            <div key={k} style={{background:'#fff',borderRadius:12,marginBottom:14,overflow:'hidden',boxShadow:'0 1px 3px rgba(0,0,0,0.06)'}}>
              <div style={{background:stageColor,padding:'9px 16px',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <span style={{fontSize:12,fontWeight:700,color:'#fff',letterSpacing:'0.07em'}}>{label.toUpperCase()}</span>
                <span style={{fontSize:11,color:'rgba(255,255,255,0.8)'}}>{floorDone}/{floorTotal} done</span>
              </div>
              <div style={{padding:'4px 16px 10px'}}>
                {general.length>0&&(
                  <>
                    {(hotcheck.length>0||rooms.length>0)&&<div style={{fontSize:10,color:'#9ca3af',fontWeight:600,marginTop:10,marginBottom:0,letterSpacing:'0.06em'}}>GENERAL</div>}
                    {renderItems(general)}
                  </>
                )}
                {hotcheck.length>0&&(
                  <>
                    <div style={{fontSize:10,color:'#9ca3af',fontWeight:600,marginTop:10,marginBottom:0,letterSpacing:'0.06em'}}>⚡ HOT CHECK</div>
                    {renderItems(hotcheck)}
                  </>
                )}
                {rooms.map(room=>(
                  <div key={room.id||room.name}>
                    <div style={{fontSize:10,color:'#9ca3af',fontWeight:600,marginTop:10,marginBottom:0,letterSpacing:'0.06em'}}>{(room.name||'').toUpperCase()}</div>
                    {renderItems(room.items)}
                  </div>
                ))}
              </div>
            </div>
          );
        })
      )}
      <div style={{textAlign:'center',fontSize:11,color:'#9ca3af',marginTop:8}}>
        This list updates in real time as items are completed.
      </div>

      {/* ── Add Item Section ── */}
      {(()=>{
        const externalKey = punchKey + 'External';
        const labelKey    = punchKey + 'FilterLabel';
        const myLabel     = job?.[labelKey] || 'GC';
        const existingExternal = job?.[externalKey] || [];

        const submitItem = async () => {
          const text = newItemText.trim();
          if(!text) return;
          setAddingItem(true);
          try {
            const newItem = {
              id: Math.random().toString(36).slice(2)+Date.now().toString(36),
              text,
              addedBy: myLabel,
              addedAt: new Date().toLocaleDateString('en-US'),
              done: false, checkedBy: '', checkedAt: '',
            };
            await updateDoc(doc(db,'jobs',jobId), {
              [`data.${externalKey}`]: arrayUnion(newItem),
            });
            setNewItemText('');
            setAddedCount(c=>c+1);
          } catch(e) {
            alert('Failed to submit. Check your connection and try again.');
          }
          setAddingItem(false);
        };

        return (
          <div style={{background:'#fff',borderRadius:12,marginTop:20,padding:'18px 18px',
            boxShadow:'0 1px 3px rgba(0,0,0,0.06)'}}>
            <div style={{fontSize:13,fontWeight:700,color:'#1e293b',marginBottom:4}}>Add an Item</div>
            <div style={{fontSize:12,color:'#9ca3af',marginBottom:12}}>
              Items you add here will appear as <b style={{color:'#1e293b'}}>{myLabel}'s Punch List</b> in the app for the Homestead team.
            </div>
            <textarea value={newItemText} onChange={e=>setNewItemText(e.target.value)}
              placeholder="Describe the item…"
              rows={3}
              style={{width:'100%',boxSizing:'border-box',border:'1px solid #e5e7eb',borderRadius:8,
                padding:'10px 12px',fontSize:13,fontFamily:'system-ui,sans-serif',
                color:'#1f2937',resize:'vertical',outline:'none',lineHeight:1.5,
                background:'#f9fafb',marginBottom:10}}/>
            <button onClick={submitItem} disabled={addingItem||!newItemText.trim()}
              style={{width:'100%',background:newItemText.trim()?stageColor:'#d1d5db',
                border:'none',borderRadius:8,color:'#fff',fontWeight:700,
                fontSize:13,padding:'11px',cursor:newItemText.trim()?'pointer':'not-allowed',
                fontFamily:'system-ui,sans-serif',opacity:addingItem?0.6:1}}>
              {addingItem?'Submitting…':'Submit Item'}
            </button>
            {addedCount>0&&(
              <div style={{textAlign:'center',fontSize:12,color:'#16a34a',fontWeight:600,marginTop:10}}>
                ✓ {addedCount} item{addedCount!==1?'s':''} submitted — Homestead will see {addedCount!==1?'them':'it'} right away.
              </div>
            )}
            {existingExternal.length>0&&(
              <div style={{marginTop:16,borderTop:'1px solid #f3f4f6',paddingTop:14}}>
                <div style={{fontSize:10,fontWeight:700,color:'#9ca3af',letterSpacing:'0.08em',marginBottom:8}}>
                  YOUR SUBMITTED ITEMS ({existingExternal.length})
                </div>
                {existingExternal.map(it=>(
                  <div key={it.id} style={{display:'flex',alignItems:'flex-start',gap:8,
                    padding:'7px 0',borderBottom:'1px solid #f9fafb'}}>
                    <div style={{width:14,height:14,borderRadius:3,flexShrink:0,marginTop:2,
                      border:`2px solid ${it.done?stageColor:'#d1d5db'}`,
                      background:it.done?stageColor:'transparent',
                      display:'flex',alignItems:'center',justifyContent:'center'}}>
                      {it.done&&<span style={{color:'#fff',fontSize:7,fontWeight:900}}>✓</span>}
                    </div>
                    <div style={{flex:1}}>
                      <span style={{fontSize:12,color:it.done?'#9ca3af':'#374151',
                        textDecoration:it.done?'line-through':'none',lineHeight:1.4}}
                        dangerouslySetInnerHTML={{__html:it.text}}/>
                      {it.done&&<span style={{marginLeft:6,fontSize:10,color:'#6ee7b7',fontWeight:600}}> ✓ resolved</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}

function QuestionsSharePage({ jobId }) {
  const [job,            setJob]           = useState(null);
  const [loading,        setLoading]       = useState(true);
  const [error,          setError]         = useState(null);
  const draftKey = `he_qdraft_${jobId}_${new URLSearchParams(window.location.search).get('share')||'x'}`;
  const [answers,        setAnswers]       = useState(() => { try { return JSON.parse(localStorage.getItem(draftKey)||'{}'); } catch(e) { return {}; } });
  const [submitting,     setSubmitting]    = useState(false);
  const [submitted,      setSubmitted]     = useState(false);
  const [respondentName, setRespondentName]= useState('');
  const [nameErr,        setNameErr]       = useState(false);
  const [prevAnsweredBy, setPrevAnsweredBy]= useState('');
  // Track which questions have a committed answer (updated on textarea blur, not every keystroke)
  // so cards don't jump around while you're mid-sentence.
  const [answeredIds, setAnsweredIds] = useState(() => {
    try { const d=JSON.parse(localStorage.getItem(draftKey)||'{}'); return new Set(Object.keys(d).filter(id=>d[id]?.trim())); }
    catch(e){ return new Set(); }
  });

  useEffect(() => {
    if(Object.keys(answers).length) localStorage.setItem(draftKey, JSON.stringify(answers));
  }, [answers]);

  // Filter from Firestore — saved by crew via Share picker
  const filterIds = (() => {
    const raw = job?.questionsFilter;
    if (!Array.isArray(raw) || raw.length === 0) return null;
    return new Set(raw);
  })();

  // Live listener — questions update in real-time as crew adds them
  useEffect(() => {
    const unsub = onSnapshot(doc(db,'jobs',jobId), snap => {
      if(!snap.exists()){ setError('This questions form is not available.'); setLoading(false); return; }
      setJob(snap.data()?.data);
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
        const aSet = new Set();
        ['rough','finish'].forEach(phase => {
          ['upper','main','basement'].forEach(floor => {
            (qa[phase]?.[floor] || []).forEach(a => {
              if(a.answer) { ans[a.id] = a.answer; if(a.answer.trim()) aSet.add(a.id); }
            });
          });
        });
        setAnswers(ans);
        setAnsweredIds(prev => new Set([...prev, ...aSet]));
      }
    }).catch(()=>{});
  }, [jobId]);

  const handleSubmit = async () => {
    if(!respondentName.trim()){ setNameErr(true); return; }
    setSubmitting(true);
    try {
      // Always fetch existing doc first so we can safely merge answers
      const ex = await getDoc(doc(db,'homeowner_requests',jobId));
      const existingData = ex.exists() ? ex.data() : {};
      const existingQA   = existingData.questionAnswers || {};

      // mergeFloor: for each question, use the new answer only if it was shown
      // to this recipient (i.e., it's in filterIds, or no filter was applied).
      // Questions that weren't shown keep whatever answer was already saved.
      const mergeFloor = (allQs, existingFloor) => {
        const exMap = {};
        (existingFloor || []).forEach(a => { exMap[a.id] = a; });
        return (allQs || []).map(q => {
          if(!filterIds || filterIds.has(q.id)) {
            return { id:q.id, question:q.question, answer:answers[q.id]||'' };
          }
          // Not shown to this recipient — preserve existing answer
          return exMap[q.id] || { id:q.id, question:q.question, answer:'' };
        });
      };

      const questionAnswers = {
        ...existingQA,
        rough: {
          upper:    mergeFloor(job?.roughQuestions?.upper,    existingQA.rough?.upper),
          main:     mergeFloor(job?.roughQuestions?.main,     existingQA.rough?.main),
          basement: mergeFloor(job?.roughQuestions?.basement, existingQA.rough?.basement),
        },
        finish: {
          upper:    mergeFloor(job?.finishQuestions?.upper,    existingQA.finish?.upper),
          main:     mergeFloor(job?.finishQuestions?.main,     existingQA.finish?.main),
          basement: mergeFloor(job?.finishQuestions?.basement, existingQA.finish?.basement),
        },
        answeredBy: respondentName.trim(),
        answeredAt: new Date().toISOString(),
      };

      await setDoc(doc(db,'homeowner_requests',jobId), {
        ...existingData,
        jobId, jobName:job?.name||'', questionAnswers,
      });
      try { localStorage.removeItem(draftKey); } catch(e){}
      setSubmitted(true);
    } catch(e){ alert('Failed to submit. Please try again.'); }
    setSubmitting(false);
  };

  const roughQs = (job ? [
    ...(job.roughQuestions?.upper||[]).map(q=>({...q,floor:'Upper Level'})),
    ...(job.roughQuestions?.main||[]).map(q=>({...q,floor:'Main Level'})),
    ...(job.roughQuestions?.basement||[]).map(q=>({...q,floor:'Basement'})),
  ] : []).filter(q=>!filterIds || filterIds.has(q.id));
  const finishQs = (job ? [
    ...(job.finishQuestions?.upper||[]).map(q=>({...q,floor:'Upper Level'})),
    ...(job.finishQuestions?.main||[]).map(q=>({...q,floor:'Main Level'})),
    ...(job.finishQuestions?.basement||[]).map(q=>({...q,floor:'Basement'})),
  ] : []).filter(q=>!filterIds || filterIds.has(q.id));
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
              {[...roughQs].sort((a,b)=>((answeredIds.has(a.id)||!!a.done||!!(a.answer?.trim()))?1:0)-((answeredIds.has(b.id)||!!b.done||!!(b.answer?.trim()))?1:0)).map((q,i)=>{
                const isAns=answeredIds.has(q.id)||!!q.done||!!(q.answer?.trim());
                return (
                  <div key={q.id} style={{...cardStyle,borderLeft:`3px solid ${isAns?'#16a34a':'#2563eb'}`,opacity:isAns?0.72:1,transition:'opacity 0.2s,border-color 0.2s'}}>
                    <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:3}}>
                      <div style={{fontSize:10,color:'#9ca3af',fontWeight:600}}>{q.floor}</div>
                      {isAns&&<div style={{fontSize:10,fontWeight:700,color:'#16a34a',background:'#dcfce7',borderRadius:99,padding:'1px 8px'}}>✓ Answered</div>}
                    </div>
                    <div style={{fontSize:14,fontWeight:600,color:'#111',marginBottom:10}}>Q{i+1}: {q.question}</div>
                    <textarea value={answers[q.id]||''} onChange={e=>setAnswers(a=>({...a,[q.id]:e.target.value}))}
                      onBlur={e=>{if(e.target.value.trim())setAnsweredIds(s=>new Set([...s,q.id]));else setAnsweredIds(s=>{const n=new Set(s);n.delete(q.id);return n;});}}
                      placeholder="Type your answer here…" rows={3} style={taStyle}/>
                  </div>
                );
              })}
            </div>
          )}

          {finishQs.length>0&&(
            <div style={{marginBottom:20}}>
              <div style={{fontSize:11,fontWeight:700,color:'#0ea5e9',letterSpacing:'0.08em',marginBottom:10,paddingBottom:6,borderBottom:'2px solid #0ea5e933'}}>🏁 FINISH PHASE</div>
              {[...finishQs].sort((a,b)=>((answeredIds.has(a.id)||!!a.done||!!(a.answer?.trim()))?1:0)-((answeredIds.has(b.id)||!!b.done||!!(b.answer?.trim()))?1:0)).map((q,i)=>{
                const isAns=answeredIds.has(q.id)||!!q.done||!!(q.answer?.trim());
                return (
                  <div key={q.id} style={{...cardStyle,borderLeft:`3px solid ${isAns?'#16a34a':'#0ea5e9'}`,opacity:isAns?0.72:1,transition:'opacity 0.2s,border-color 0.2s'}}>
                    <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:3}}>
                      <div style={{fontSize:10,color:'#9ca3af',fontWeight:600}}>{q.floor}</div>
                      {isAns&&<div style={{fontSize:10,fontWeight:700,color:'#16a34a',background:'#dcfce7',borderRadius:99,padding:'1px 8px'}}>✓ Answered</div>}
                    </div>
                    <div style={{fontSize:14,fontWeight:600,color:'#111',marginBottom:10}}>Q{i+1}: {q.question}</div>
                    <textarea value={answers[q.id]||''} onChange={e=>setAnswers(a=>({...a,[q.id]:e.target.value}))}
                      onBlur={e=>{if(e.target.value.trim())setAnsweredIds(s=>new Set([...s,q.id]));else setAnsweredIds(s=>{const n=new Set(s);n.delete(q.id);return n;});}}
                      placeholder="Type your answer here…" rows={3} style={taStyle}/>
                  </div>
                );
              })}
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

  // Punch list share page routes — ?roughpunch / ?finishpunch / ?qcpunch
  const rpParam = new URLSearchParams(window.location.search).get("roughpunch");
  if(rpParam) return <PunchSharePage jobId={rpParam} stage="Rough"/>;
  const fpParam = new URLSearchParams(window.location.search).get("finishpunch");
  if(fpParam) return <PunchSharePage jobId={fpParam} stage="Finish"/>;
  const qcpParam = new URLSearchParams(window.location.search).get("qcpunch");
  if(qcpParam) return <PunchSharePage jobId={qcpParam} stage="QC"/>;

  // ── Identity ──────────────────────────────────────────────────
  const [identity, setIdentity] = useState(()=>getIdentity());
  // Re-register FCM token on every load so token refreshes are always captured.
  // Previously only ran on explicit login — missed token changes on already-logged-in devices.
  useEffect(()=>{ if(identity?.id) registerFCMToken(identity.id); }, [identity?.id]);

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
  // pendingUpcomingDeletes / pendingUpcomingSaves no longer needed — upcoming uses one-time load


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

    // Upcoming jobs stored as a single doc — real-time listener so all users stay in sync.
    // Single doc means deletions/edits are atomic (no per-document race).
    const unsubUpcoming = onSnapshot(doc(db,"settings","upcoming_jobs"), async snap => {
      if(snap.exists() && (snap.data().items||[]).length > 0) {
        setUpcoming(snap.data().items || []);
      } else if(!snap.exists()) {
        // First-time migration: pull from old per-document upcoming collection
        try {
          const oldSnap = await getDocs(collection(db,"upcoming"));
          const migrated = oldSnap.docs
            .map(d=>{ const data=d.data().data; if(!data) return null; return {...data, id:d.id}; })
            .filter(Boolean);
          if(migrated.length > 0) {
            setUpcoming(migrated);
            setDoc(doc(db,"settings","upcoming_jobs"),{items:migrated,updated_at:new Date().toISOString()});
          }
        } catch(e){ console.error("Upcoming migration error:", e); }
      }
    }, err => console.error("Upcoming listener error:", err));

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
      // Wipe ALL previous daily backups to free space before saving today's
      const keysToRemove = [];
      for(let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if(k?.startsWith("he_daily_backup_") && k !== key) keysToRemove.push(k);
      }
      keysToRemove.forEach(k => { try { localStorage.removeItem(k); } catch(e){} });
      // Also clear the rolling hejobs_backup to reclaim space — Firestore is the source of truth
      try { localStorage.removeItem('hejobs_backup'); } catch(e){}
      // Save a minimal version: just id, name, type, quoteNumber, foreman, roughStatus, finishStatus
      const compact = jobs.map(j => ({
        id:j.id, name:j.name, address:j.address, gc:j.gc, foreman:j.foreman,
        type:j.type, quoteNumber:j.quoteNumber, simproNo:j.simproNo,
        roughStatus:j.roughStatus, finishStatus:j.finishStatus,
        roughStage:j.roughStage, finishStage:j.finishStage,
        prepStage:j.prepStage, updated_at:j.updated_at,
      }));
      try {
        localStorage.setItem(key, JSON.stringify({savedAt: new Date().toISOString(), count: jobs.length, jobs: compact}));
        console.log(`[HE] Daily safety backup saved: ${jobs.length} jobs (${today})`);
      } catch(e) { console.warn("[HE] Daily backup failed:", e); }
    }
  }, [jobs.length]);


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

  // Save the entire upcoming list as one document — no per-item deletes needed
  const saveAllUpcoming = async (list) => {
    try { await setDoc(doc(db,"settings","upcoming_jobs"),{items:list,updated_at:new Date().toISOString()}); }
    catch(e){ console.error("saveAllUpcoming error:",e); }
  };
  // Keep these names for call-site compatibility but they now just save the full list
  const saveUpcomingItem = (_item) => {}; // no-op — caller uses onChange which calls saveAllUpcoming
  const deleteUpcomingItem = (_id) => {};  // no-op — deletion is handled via onChange → saveAllUpcoming

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
  const [showUtilMenu, setShowUtilMenu] = useState(false);
  const goHome            = () =>  { setView("home");           setActiveForeman(null); setSearch(""); setStageF("All"); setFlagOnly(false); };
  const openSchedule      = () =>  { setView("schedule");      setActiveForeman(null); setSearch(""); setStageF("All"); setFlagOnly(false); };
  const openUpcoming      = () =>  { setView("upcoming");      setActiveForeman(null); setSearch(""); setStageF("All"); setFlagOnly(false); };
  const openTasks         = () =>  { setView("tasks");         setActiveForeman(null); setSearch(""); setStageF("All"); setFlagOnly(false); };
  const openNav           = () =>  { setView("nav");           setActiveForeman(null); setSearch(""); setStageF("All"); setFlagOnly(false); };
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

    const countQCFloor = (f) => { if(!f) return 0; return (f.general||[]).filter(i=>!i.done).length + (f.hotcheck||[]).filter(i=>!i.done).length + (f.rooms||[]).reduce((a,r)=>a+(r.items||[]).filter(i=>!i.done).length,0); };

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
    const isQuote  = job.type==="quote";
    const rowBg    = isQuote ? `rgba(232,144,26,0.07)` : BG[priority];
    const rowLbord = isQuote ? C.accent : LBORD[priority];
    const rowBord  = isQuote ? `1px dashed ${C.accent}` : BORD[priority];

    return (

      <div className="job-row" onClick={()=>setSelected(job)}
        style={{background:rowBg,border:rowBord,borderRadius:14,padding:"13px 16px",marginBottom:8,borderLeft:`3px solid ${rowLbord}`}}>

        <div style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>

          <div style={{flex:"0 0 210px",minWidth:140}}>

            <div style={{display:"flex",alignItems:"center",gap:7}}>

              {job.type==="quote"&&<span style={{fontSize:10,fontWeight:700,color:"#000",background:C.accent,borderRadius:4,padding:"1px 6px",flexShrink:0}}>{job.quoteNumber||"Q"}</span>}

              <span style={{fontWeight:600,fontSize:13,color:C.text}}>{job.name||"Untitled Job"}</span>

              {job.simproMargin!=null&&(()=>{
                const m=job.simproMargin, isEst=job.simproMarginIsEst;
                const mc=m>=15?"#22c55e":m>=10?C.orange:C.red;
                return <span title={`${isEst?"Estimated":"Actual"} net margin · Goal: 15%`}
                  style={{fontSize:10,fontWeight:800,color:mc,background:`${mc}18`,
                    border:`1px solid ${mc}44`,borderRadius:99,padding:"1px 7px",flexShrink:0}}>
                  {m.toFixed(1)}%{isEst?" est":""}
                </span>;
              })()}

            </div>

            <div style={{fontSize:11,color:C.dim,marginTop:1}}>

              {isQuote&&<span style={{color:C.accent,fontWeight:700,marginRight:6,letterSpacing:"0.04em"}}>QUOTE</span>}

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
            {job.matterportStatus&&job.matterportStatus!=="complete"&&<Pill label={job.matterportStatus==="scheduled"&&job.matterportStatusDate?"Matterport: "+fmtDisplay(job.matterportStatusDate):("Matterport: "+(getStatusDef(MATTERPORT_STATUSES,job.matterportStatus).label||job.matterportStatus))} color={getStatusDef(MATTERPORT_STATUSES,job.matterportStatus).color||C.dim}/>}
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


  // ── Notification deep-link state ─────────────────────────────────────────
  // openTab: passed as initialTab to JobDetail when opening via a notification
  const [openTab, setOpenTab] = useState(null);

  // ── Helper: open a job by ID and jump to a section ───────────────────────
  const openJobById = useCallback((jobId, section) => {
    if (!jobId) return;
    const job = jobs.find(j => j.id === jobId);
    if (job) {
      setOpenTab(section || null);
      setSelected(job);
    }
  }, [jobs]);

  // ── On mount: check URL params for deep-link (background notification tap) ─
  const [pendingNav, setPendingNav] = useState(() => {
    const p = new URLSearchParams(window.location.search);
    const jobId   = p.get("jobId");
    const section = p.get("section") || "";
    if (jobId) {
      // Clean the URL so refreshing doesn't re-trigger navigation
      const clean = window.location.pathname;
      window.history.replaceState({}, "", clean);
      return { jobId, section };
    }
    return null;
  });

  // Once jobs are loaded, apply any pending navigation from URL params
  useEffect(() => {
    if (!pendingNav || !jobs.length) return;
    openJobById(pendingNav.jobId, pendingNav.section);
    setPendingNav(null);
  }, [jobs, pendingNav, openJobById]);

  // ── Listen for postMessage from SW (app was already open when notif tapped) ─
  useEffect(() => {
    const handler = e => {
      if (e.data?.type === "HE_NOTIF_CLICK" && e.data.jobId) {
        openJobById(e.data.jobId, e.data.section);
      }
    };
    navigator.serviceWorker?.addEventListener("message", handler);
    return () => navigator.serviceWorker?.removeEventListener("message", handler);
  }, [openJobById]);

  // ── Foreground push notification toast ───────────────────────────────────
  const [pushToast, setPushToast] = useState(null);
  useEffect(() => {
    const handler = e => {
      setPushToast(e.detail);
      setTimeout(() => setPushToast(null), 5000);
    };
    window.addEventListener("he-push", handler);
    return () => window.removeEventListener("he-push", handler);
  }, []);

  // ── Identity gate — show UserPicker if no identity saved ────
  if(!identity) {
    return <UserPicker users={users}
      onSelect={m => { saveIdentity(m); setIdentity(m); registerFCMToken(m.id); }}
      onSavePin={async (updated) => {
        // Save the new PIN into the users list in Firestore
        const newList = users.map(u => u.id===updated.id ? updated : u);
        await saveUsers(newList);
      }}
    />;
  }

  return (

    <div style={{minHeight:"100vh",background:C.bg,fontFamily:"'DM Sans',sans-serif",color:C.text,position:"relative"}}>
      {/* Push notification foreground toast — tap to open the relevant job */}
      {pushToast && (
        <div onClick={() => {
          if (pushToast.jobId) openJobById(pushToast.jobId, pushToast.section);
          setPushToast(null);
        }} style={{
          position:"fixed", top:16, left:"50%", transform:"translateX(-50%)",
          zIndex:99999, background:"#1e293b", color:"#f8fafc",
          borderRadius:12, padding:"12px 18px", maxWidth:360, width:"90%",
          boxShadow:"0 8px 32px #0008", cursor:"pointer",
          display:"flex", flexDirection:"column", gap:2,
        }}>
          <div style={{fontWeight:700, fontSize:14}}>{pushToast.title}</div>
          {pushToast.body && <div style={{fontSize:13, color:"#cbd5e1"}}>{pushToast.body}</div>}
          {pushToast.jobId && <div style={{fontSize:11, color:"#94a3b8", marginTop:2}}>Tap to open →</div>}
        </div>
      )}

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
              {key:"nav",label:"📍 Nav"},
              {key:"upcoming",label:"Upcoming"},
              ...(can(identity,"quotes.view")?[{key:"quotes",label:"Quotes"}]:[]),
              {key:"tasks",label:"Tasks"},
              ...(contractorUsers.length>0?[{key:"subcontractors",label:contractorUsers.length===1?contractorUsers[0].name.split(" ")[0]:"Subcontractors"}]:[]),
              ...(can(identity,"settings.view")?[{key:"settings",label:"⚙ Settings"}]:[]),
            ]
        ).map(({key,label})=>{
          const active = view===key;
          return (
            <button key={key} onClick={key==="home"?goHome:key==="schedule"?openSchedule:key==="upcoming"?openUpcoming:key==="quotes"?()=>setView("quotes"):key==="tasks"?openTasks:key==="nav"?openNav:key==="subcontractors"?openSubcontractor:openSettings}
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

                {/* ⋯ utility menu */}
                <div style={{position:"relative"}}>
                  <button onClick={()=>setShowUtilMenu(v=>!v)}
                    style={{background:"none",border:`1px solid ${C.border}`,borderRadius:8,
                      color:C.dim,fontSize:16,fontWeight:700,padding:"6px 12px",cursor:"pointer",
                      fontFamily:"inherit",lineHeight:1}}>
                    ⋯
                  </button>
                  {showUtilMenu&&(
                    <>
                      <div style={{position:"fixed",inset:0,zIndex:49}} onClick={()=>setShowUtilMenu(false)}/>
                      <div style={{position:"absolute",right:0,top:"calc(100% + 6px)",zIndex:50,
                        background:C.card,border:`1px solid ${C.border}`,borderRadius:10,
                        boxShadow:"0 8px 24px rgba(0,0,0,0.3)",minWidth:160,overflow:"hidden"}}>
                        <button onClick={()=>{setShowUtilMenu(false);localStorage.removeItem("he_identity");setIdentity(null);}}
                          style={{display:"block",width:"100%",textAlign:"left",background:"none",border:"none",
                            borderBottom:`1px solid ${C.border}`,color:C.text,fontSize:12,fontWeight:600,
                            padding:"10px 16px",cursor:"pointer",fontFamily:"inherit"}}>
                          🔒 Lock
                        </button>
                        <button onClick={()=>{setShowUtilMenu(false);backupByEmail();}}
                          style={{display:"block",width:"100%",textAlign:"left",background:"none",border:"none",
                            borderBottom:`1px solid ${C.border}`,color:C.text,fontSize:12,fontWeight:600,
                            padding:"10px 16px",cursor:"pointer",fontFamily:"inherit"}}>
                          Backup
                        </button>
                        <button onClick={()=>{setShowUtilMenu(false);window.location.reload();}}
                          style={{display:"block",width:"100%",textAlign:"left",background:"none",border:"none",
                            borderBottom:getAccess(identity)==="admin"?`1px solid ${C.border}`:"none",
                            color:C.text,fontSize:12,fontWeight:600,
                            padding:"10px 16px",cursor:"pointer",fontFamily:"inherit"}}>
                          ↻ Refresh
                        </button>
                        {getAccess(identity)==="admin"&&(
                          <button onClick={async()=>{
                              setShowUtilMenu(false);
                              try {
                                const result = await syncDriveFoldersToJobs(jobs, updateJob);
                                const msg = `Drive Sync Complete!\n\n` +
                                  `${result.matched.length} new match${result.matched.length===1?"":"es"} linked` +
                                  (result.matched.length > 0 ? ":\n" + result.matched.map(m=>`  ${m.folderName} → ${m.jobName}`).join("\n") : "") +
                                  `\n${result.skipped.length} already linked` +
                                  (result.ambiguous.length > 0 ? `\n${result.ambiguous.length} ambiguous (skipped):\n` + result.ambiguous.map(a=>`  ${a.jobName}: ${a.folders.join(", ")}`).join("\n") : "") +
                                  `\n\n${result.total} Drive folders scanned`;
                                alert(msg);
                              } catch(e) { alert("Drive sync failed: " + e.message); }
                            }}
                            style={{display:"block",width:"100%",textAlign:"left",background:"none",border:"none",
                              color:C.blue,fontSize:12,fontWeight:600,
                              padding:"10px 16px",cursor:"pointer",fontFamily:"inherit"}}>
                            Sync Drive
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </div>
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

          {/* ── SIMPRO CREW SCHEDULE ── */}
          <SimproCrewSchedule
            jobs={jobs}
            identity={identity}
            users={users}
            foremanColors={_foremanColors}
            onSelectJob={(j)=>setSelected(j)}
          />

          <NeedsAttention jobs={jobs} onSelectJob={(j)=>setSelected(j)}/>

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
                const homeFiltered = (s ? jobs.filter(j=>
                  (j.name||"").toLowerCase().includes(s)||
                  (j.address||"").toLowerCase().includes(s)||
                  (j.gc||"").toLowerCase().includes(s)||
                  (j.foreman||"").toLowerCase().includes(s)||
                  (j.simproNo||"").toLowerCase().includes(s)
                ) : jobs);
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
              const _clearedTab = new Set(jobs.flatMap(j=>j.clearedTasks||[]));
              const fTasks = computeTasks(jobs)
                .filter(t=>t.foreman===activeForeman && t.category!=="prep" && !_clearedTab.has(t.id))
                .concat((manualTasks||[]).filter(t=>t.foreman===activeForeman));
              const prepTasks = computeTasks(jobs).filter(t=>t.foreman==="Koy"&&t.category==="prep"&&!_clearedTab.has(t.id));
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
                  <StageSectionList jobs={filtered} JobRow={JobRow} TempPedCard={TempPedCard} onSelectJob={(j)=>setSelected(j)} onSaveJob={(updated,patch)=>{ setJobs(js=>js.map(j=>j.id===updated.id?updated:j)); saveJob(updated,patch); }} onDeleteJob={(id)=>deleteJob(id)} fc={_foremanColors[activeForeman]} startCollapsed={true}/>
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
                const _clearedFTC = new Set(jobs.flatMap(j=>j.clearedTasks||[]));
                const fTasks = computeTasks(jobs)
                  .filter(t=>t.foreman===activeForeman && t.category!=="prep" && !_clearedFTC.has(t.id))
                  .concat((manualTasks||[]).filter(t=>t.foreman===activeForeman));
                const prepTasks = computeTasks(jobs).filter(t=>t.foreman==="Koy"&&t.category==="prep"&&!_clearedFTC.has(t.id));
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
        : <JobDetail key={selected.id} job={selected} onUpdate={updateJob} onClose={()=>{flushJob(selected);setSelected(null);setOpenTab(null);}} foremenList={_foremen} leadsList={_leads}
            canConvertQuote={can(identity,"quotes.convert")}
            initialTab={openTab}
            onConvertQuote={(q)=>{
              // q already has simproNo set from the prompt
              const updated={...q, type:""};
              setJobs(js=>js.map(j=>j.id===q.id?updated:j));
              saveJob(updated,{type:"", simproNo:q.simproNo||""});
              setSelected(updated);
            }}
          />)}

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
                        startCollapsed={true}
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

      {view==="quotes"&&can(identity,"quotes.view")&&(
        <div style={{padding:"18px 16px"}}>
          <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:16,flexWrap:"wrap"}}>
            <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:28,letterSpacing:"0.06em",color:C.accent,lineHeight:1}}>Quotes</div>
            <div style={{fontSize:11,color:C.dim}}>{jobs.filter(j=>j.type==="quote").length} quote{jobs.filter(j=>j.type==="quote").length!==1?"s":""}</div>
            {can(identity,"quotes.view")&&(
              <button onClick={()=>{
                const j=blankJob();
                j.type="quote";
                j.quoteNumber=nextQuoteNumber(jobs);
                j.foreman="Unassigned";
                setJobs(js=>[j,...js]);
                setSelected(j);
              }}
                style={{marginLeft:"auto",background:C.accent,color:"#000",border:"none",borderRadius:8,
                  padding:"8px 16px",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit",
                  letterSpacing:"0.03em"}}>+ New Quote</button>
            )}
          </div>
          <StageSectionList
            jobs={jobs.filter(j=>j.type==="quote")}
            JobRow={JobRow}
            TempPedCard={TempPedCard}
            onSelectJob={(j)=>setSelected(j)}
            onSaveJob={(updated,patch)=>{ setJobs(js=>js.map(j=>j.id===updated.id?updated:j)); saveJob(updated,patch); }}
            onDeleteJob={(id)=>deleteJob(id)}
            startCollapsed={true}
          />
        </div>
      )}

      {view==="nav"&&<NavView jobs={jobs}/>}

      {view==="upcoming"&&can(identity,"pipeline.view")&&(
        <UpcomingJobs
          upcoming={upcoming}
          canManage={can(identity,"pipeline.manage")}
          foremenList={_foremen}
          onDelete={(id)=>{ deleteUpcomingItem(id); }}
          onChange={(next)=>{
            setUpcoming(next);
            saveAllUpcoming(next);
          }}
          onPromote={(u)=>{
            const j=blankJob();
            j.name=u.name||""; j.address=u.city||""; j.gc=u.customer||""; j.foreman=u.foreman||"Unassigned";
            const next=upcoming.filter(x=>x.id!==u.id);
            setJobs(js=>[j,...js]); setSelected(j); setUpcoming(next);
            setView("home"); saveJob(j); saveAllUpcoming(next);
          }}
          onPromoteToQuote={(u)=>{
            const j=blankJob();
            j.name=u.name||""; j.address=u.city||""; j.gc=u.customer||""; j.foreman=u.foreman||"Unassigned";
            j.type="quote"; j.quoteNumber=nextQuoteNumber(jobs);
            const next=upcoming.filter(x=>x.id!==u.id);
            setJobs(js=>[j,...js]); setSelected(j); setUpcoming(next);
            setView("quotes"); saveJob(j); saveAllUpcoming(next);
          }}
        />
      )}

      {view==="settings"&&can(identity,"settings.view")&&(
        <div>
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
