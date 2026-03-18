// BUILD_v9_FIXED
import { useState, useEffect, useRef, createPortal } from "react";
import { initializeApp } from "firebase/app";
import { getFirestore, doc, setDoc, deleteDoc, getDoc, collection, getDocs, onSnapshot } from "firebase/firestore";




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



const HO_WIRE_AMPS = {"14/2":15,"14/3":15,"12/2":20,"12/3":20,"10/2":30,"10/3":30,"8/2":40,"8/3":40,"6/2":50,"6/3":50,"4/2":70,"4/3":70,"2/2":95,"2/3":95,"1/0":125,"2/0":150,"3/0":175,"4/0":200};

const C = {

  bg:"#f1f5f9", surface:"#ffffff", card:"#ffffff", border:"#e2e8f0",

  muted:"#cbd5e1", text:"#0f172a", dim:"#64748b", accent:"#d97706",

  blue:"#2563eb", green:"#16a34a", red:"#dc2626", purple:"#0ea5e9",

  orange:"#ea580c", teal:"#0d9488", rough:"#2563eb", finish:"#0ea5e9",

};



const JOB_ID = "homestead-jobs-v1";

const ROUGH_STATUSES = [
  {value:"",           label:"— set status —",                        color:null},
  {value:"waiting_date",label:"Waiting for Start Date Confirmation",  color:"#ca8a04"},
  {value:"date_confirmed",label:"Start Date Confirmed — Needs to Schedule", color:"#f97316", hasDate:true},
  {value:"scheduled",  label:"Scheduled",                            color:"#2563eb", hasDate:true},
  {value:"waiting",    label:"Waiting on Items",                     color:"#ca8a04", dashed:true},
  {value:"inprogress", label:"In Progress",                          color:"#7dd3fc"},
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
var FOREMEN        = DEFAULT_FOREMEN;
var FOREMEN_COLORS = DEFAULT_FOREMEN_COLORS;
var LEADS          = DEFAULT_LEADS;
var LEAD_COLORS    = DEFAULT_LEAD_COLORS;

// Helper getters — always return current values even after settings update
const getFC = (name) => (FOREMEN_COLORS[name]||"#6b7280");
const getForemenList = () => FOREMEN;
const getLeadsList = () => LEADS;
const getLeadFC = (name) => (LEAD_COLORS[name]||"#6b7280");
const COLOR_OPTIONS = ["#3b82f6","#f97316","#22c55e","#8b5cf6","#ec4899","#14b8a6","#f59e0b","#ef4444","#06b6d4","#a855f7","#84cc16","#f43f5e"];

// ── Identity & Permissions ────────────────────────────────────
const IDENTITY_KEY = "he_identity"; // localStorage key — persists forever
const USERS_KEY    = "he_users";    // Firestore + localStorage user list

// Default users — Koy is admin to start, everyone else added in-app
const DEFAULT_USERS = [
  { id:"koy",  name:"Koy",  role:"admin", pin:"" },
];

const ROLE_LABELS = {
  admin:   "Admin",
  justin:  "Justin",
  jeromy:  "Jeromy",
  foreman: "Foreman",
  lead:    "Lead",
  crew:    "Crew",
};

const ROLE_OPTIONS = ["admin","foreman","lead","crew"];

// Permission map — feature -> roles that have access
const PERMISSIONS = {
  "home.view":         ["admin","justin","jeromy","foreman","lead","crew"],
  "home.edit":         ["admin","justin","jeromy","foreman","lead","crew"],
  "tasks.view":        ["admin","justin","jeromy","foreman"],
  "tasks.setDueDate":  ["admin","justin","foreman"],
  "tasks.addTask":     ["admin","justin","jeromy","foreman"],
  "schedule.view":     ["admin","justin","jeromy","foreman"],
  "schedule.edit":     ["admin","justin","foreman"],
  "pipeline.view":     ["admin","justin","foreman"],
  "pipeline.manage":   ["admin","justin"],
  "job.delete":        ["admin"],
  "co.edit":           ["admin","justin","jeromy","foreman","lead","crew"],
  "reports.view":      ["admin","justin","jeromy","foreman"],
  "foreman.cards":     ["admin","justin","jeromy","foreman","lead","crew"],
  "users.manage":      ["admin","justin"],
  "settings.view":     ["admin","justin"],
};

// Check if a user (identity object) can do a feature
const can = (identity, feature) => {
  if(!identity) return false;
  const allowed = PERMISSIONS[feature] || [];
  return allowed.includes(identity.role);
};

// Read/write identity from localStorage (persists forever)
const getIdentity = () => {
  try { return JSON.parse(localStorage.getItem(IDENTITY_KEY)||"null"); } catch { return null; }
};
const saveIdentity = (member) => {
  localStorage.setItem(IDENTITY_KEY, JSON.stringify(member));
};

// ── UserPicker — name list + PIN entry ───────────────────────
function UserPicker({ users, onSelect }) {
  const [step, setStep]       = useState("pick");   // "pick" | "pin"
  const [chosen, setChosen]   = useState(null);
  const [pin, setPin]         = useState("");
  const [error, setError]     = useState(false);

  const pickUser = (u) => {
    // If user has no PIN set, let them straight in
    if(!u.pin) { onSelect(u); return; }
    setChosen(u); setPin(""); setError(false); setStep("pin");
  };

  const submitPin = (entered) => {
    if(entered === chosen.pin) {
      onSelect(chosen);
    } else {
      setError(true);
      setPin("");
      setTimeout(()=>setError(false), 1200);
    }
  };

  const handleKey = (k) => {
    if(k==="⌫") { setPin(p=>p.slice(0,-1)); return; }
    if(k==="") return;
    const next = pin+k;
    setPin(next);
    if(next.length===4) submitPin(next);
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

        {step==="pin" && (
          <>
            <div style={{fontSize:14,color:C.text,fontWeight:600,marginBottom:4}}>{chosen?.name}</div>
            <div style={{fontSize:12,color:C.dim,marginBottom:24}}>Enter your PIN</div>
            <div style={{display:"flex",justifyContent:"center",gap:14,marginBottom:8}}>
              {[0,1,2,3].map(i=>(
                <div key={i} style={{width:13,height:13,borderRadius:"50%",
                  background:pin.length>i?(error?"#dc2626":C.accent):C.surface,
                  border:`2px solid ${pin.length>i?(error?"#dc2626":C.accent):C.border}`,
                  transition:"all 0.15s"}}/>
              ))}
            </div>
            <div style={{height:22,marginBottom:16}}>
              {error&&<div style={{fontSize:11,color:"#dc2626",fontWeight:700,letterSpacing:"0.06em"}}>INCORRECT PIN</div>}
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:16}}>
              {["1","2","3","4","5","6","7","8","9","","0","⌫"].map((k,idx)=>(
                <button key={idx} onClick={()=>handleKey(k)}
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
            <button onClick={()=>{setStep("pick");setChosen(null);setPin("");}}
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
  const [list, setList]       = useState(users);
  const [editing, setEditing] = useState(null); // user id being edited
  const [showPin, setShowPin] = useState({});

  useEffect(()=>setList(users),[users]);

  const newUser = () => {
    const u = { id:"u_"+Date.now(), name:"", role:"crew", pin:"" };
    setList(l=>[...l,u]);
    setEditing(u.id);
  };

  const upd = (id, patch) => setList(l=>l.map(u=>u.id===id?{...u,...patch}:u));

  const del = (id) => {
    if(!window.confirm("Remove this user?")) return;
    const next = list.filter(u=>u.id!==id);
    setList(next);
    onSave(next);
  };

  const save = () => { onSave(list); setEditing(null); };

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

      <div style={{display:"flex",flexDirection:"column",gap:10}}>
        {list.map(u=>{
          const isEditing = editing===u.id;
          return (
            <div key={u.id} style={{background:C.card,border:`1px solid ${isEditing?C.accent:C.border}`,
              borderRadius:12,padding:"14px 16px",transition:"border-color 0.15s"}}>
              {isEditing ? (
                <div style={{display:"flex",flexDirection:"column",gap:10}}>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                    <div>
                      <div style={{fontSize:10,color:C.dim,marginBottom:4,fontWeight:700,letterSpacing:"0.08em"}}>NAME</div>
                      <input value={u.name} onChange={e=>upd(u.id,{name:e.target.value})}
                        placeholder="Full name…"
                        style={{width:"100%",background:C.surface,border:`1px solid ${C.border}`,
                          borderRadius:7,color:C.text,padding:"7px 10px",fontSize:13,
                          fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}/>
                    </div>
                    <div>
                      <div style={{fontSize:10,color:C.dim,marginBottom:4,fontWeight:700,letterSpacing:"0.08em"}}>ROLE</div>
                      <select value={u.role} onChange={e=>upd(u.id,{role:e.target.value})}
                        style={{width:"100%",background:C.surface,border:`1px solid ${C.border}`,
                          borderRadius:7,color:C.text,padding:"7px 10px",fontSize:13,
                          fontFamily:"inherit",outline:"none",boxSizing:"border-box"}}>
                        {ROLE_OPTIONS.map(r=><option key={r} value={r}>{ROLE_LABELS[r]||r}</option>)}
                      </select>
                    </div>
                  </div>
                  <div>
                    <div style={{fontSize:10,color:C.dim,marginBottom:4,fontWeight:700,letterSpacing:"0.08em"}}>PIN (4 digits)</div>
                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                      <input
                        type={showPin[u.id]?"text":"password"}
                        value={u.pin}
                        onChange={e=>{ const v=e.target.value.replace(/\D/g,"").slice(0,4); upd(u.id,{pin:v}); }}
                        placeholder="e.g. 1234"
                        maxLength={4}
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
                    <div style={{width:36,height:36,borderRadius:"50%",background:`${C.accent}22`,
                      display:"flex",alignItems:"center",justifyContent:"center",
                      fontSize:14,fontWeight:700,color:C.accent}}>
                      {u.name?u.name[0].toUpperCase():"?"}
                    </div>
                    <div>
                      <div style={{fontSize:14,fontWeight:600,color:C.text}}>{u.name||"Unnamed"}</div>
                      <div style={{fontSize:11,color:C.dim}}>{ROLE_LABELS[u.role]||u.role} · PIN: {u.pin?"••••":"not set"}</div>
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

// Legacy compat — keep AUTH_KEY so old sessions don't crash
const AUTH_KEY = "he_auth";
const getAuthSession = () => null;
const setAuthSession = () => {};



const blankJob = () => ({

  id:uid(), name:"", address:"", gc:"", phone:"", simproNo:"", foreman:"Koy", lead:"", flagged:false, flagNote:"",

  planLink:"", redlineLink:"", lightingLink:"", panelLink:"", qcLink:"", matterportLink:"",

  uploadedFiles:[],

  prepStage:"", roughStage:"0%", finishStage:"0%", roughScheduled:false, finishScheduled:false, roughScheduledDate:"", finishScheduledDate:"", prepStartDate:"", finishStartDate:"", roughQuestions:{ upper:[], main:[], basement:[] },

  roughPunch:emptyPunch(), roughMaterials:[], roughUpdates:[], roughNotes:"",

  qcPunch:emptyPunch(),

  finishStage:"0%",

  finishPunch:emptyPunch(), finishMaterials:[], finishUpdates:[], finishNotes:"",

  finishQuestions:{ upper:[], main:[], basement:[] },

  changeOrders:[], returnTrips:[], roughStatus:"", roughStatusDate:"", roughProjectedStart:"", finishStatus:"", finishStatusDate:"", finishProjectedStart:"", qcStatus:"", qcStatusDate:"", qcSignedOff:false, qcSignedOffBy:"", qcSignedOffDate:"", roughQCTaskFired:false, roughStartConfirmed:false, finishStartConfirmed:false, roughNeedsHardDate:false, roughNeedsByStart:"", roughNeedsByEnd:"", finishNeedsHardDate:false, finishNeedsByStart:"", finishNeedsByEnd:"", readyToSchedule:false, readyToInvoice:false, invoiceDismissed:false, taskDueDates:{}, roughOnHold:false, finishOnHold:false, tempPed:false, hasTempPed:false, tempPedNumber:"", tempPedStatus:"", tempPedScheduledDate:"",

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

// DateInp — always a calendar date picker, same styling as Inp
const DateInp = ({value,onChange,style={}}) => (
  <input type="date" value={toYMD(value)} onChange={onChange}
    style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:7,color:C.text,
      padding:"6px 10px",fontSize:12,fontFamily:"inherit",width:"100%",outline:"none",
      colorScheme:"dark",...style}}
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

  const add = () => onChange([{
    id:uid(), date:"", desc:"", task:"", material:"", time:"", sendTo:"",
    coStatus:"pending", coStatusDate:"",
    needsHardDate:false, needsByStart:"", needsByEnd:"",
  }, ...orders]);

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
                          ⚠ Crew not on site — set a schedule window then convert to Return Trip
                        </div>
                        {/* Window / Hard date picker */}
                        <div style={{marginBottom:8}}>
                          <div style={{display:"flex",gap:10,alignItems:"center",marginBottom:6,flexWrap:"wrap"}}>
                            <label style={{display:"flex",alignItems:"center",gap:5,fontSize:11,color:"var(--dim)",cursor:"pointer"}}>
                              <input type="radio" name={`co_type_${o.id}`} checked={!o.needsHardDate} onChange={()=>upd(o.id,{needsHardDate:false})} style={{accentColor:"#f97316"}}/>
                              Date Window
                            </label>
                            <label style={{display:"flex",alignItems:"center",gap:5,fontSize:11,color:"var(--dim)",cursor:"pointer"}}>
                              <input type="radio" name={`co_type_${o.id}`} checked={!!o.needsHardDate} onChange={()=>upd(o.id,{needsHardDate:true})} style={{accentColor:"#f97316"}}/>
                              Hard Date
                            </label>
                          </div>
                          {!o.needsHardDate?(
                            <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
                              <DateInp value={o.needsByStart||""} onChange={e=>upd(o.id,{needsByStart:e.target.value})}
                                style={{width:138,fontSize:11,borderColor:"#f9731655",background:"#f9731608"}}/>
                              <span style={{fontSize:11,color:"var(--dim)"}}>–</span>
                              <DateInp value={o.needsByEnd||""} onChange={e=>upd(o.id,{needsByEnd:e.target.value})}
                                style={{width:138,fontSize:11,borderColor:"#f9731655",background:"#f9731608"}}/>
                            </div>
                          ):(
                            <DateInp value={o.needsByStart||""} onChange={e=>upd(o.id,{needsByStart:e.target.value})}
                              style={{width:138,fontSize:11,borderColor:"#f9731655",background:"#f9731608"}}/>
                          )}
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

function ReturnTrips({trips,onChange,jobName,jobSimproNo,onEmail}) {

  const [viewPhoto, setViewPhoto] = useState(null);

  const add = () => onChange([{id:uid(),date:"",scope:"",material:"",punch:[],photos:[],assignedTo:"",signedOff:false,signedOffBy:"",signedOffDate:"",needsSchedule:false,needsScheduleDate:"",rtScheduled:false,scheduledDate:""},...trips]);

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
                            <div style={{fontSize:9,fontWeight:700,letterSpacing:"0.07em",color:rtDef.color}}>SCHEDULED DATE</div>
                            <DateInp value={t.rtStatusDate||""} onChange={e=>upd(t.id,{rtStatusDate:e.target.value})}
                              style={{width:140,fontSize:11,borderColor:rtDef.color+"55",background:`${rtDef.color}08`}}/>
                          </div>
                        )}
                      </div>
                      {t.rtStatus==="needs"&&(
                        <div style={{marginTop:8,padding:"8px 10px",background:"#dc262608",border:"1px solid #dc262633",borderRadius:8}}>
                          <div style={{fontSize:9,fontWeight:700,color:"#dc2626",letterSpacing:"0.08em",marginBottom:6}}>NEEDS TO BE SCHEDULED BY</div>
                          <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:6,flexWrap:"wrap"}}>
                            <label style={{display:"flex",alignItems:"center",gap:5,fontSize:11,color:C.dim,cursor:"pointer"}}>
                              <input type="radio" name={`rt_type_${t.id}`} checked={!t.needsHardDate} onChange={()=>upd(t.id,{needsHardDate:false})} style={{accentColor:"#dc2626"}}/>
                              Date Range
                            </label>
                            <label style={{display:"flex",alignItems:"center",gap:5,fontSize:11,color:C.dim,cursor:"pointer"}}>
                              <input type="radio" name={`rt_type_${t.id}`} checked={!!t.needsHardDate} onChange={()=>upd(t.id,{needsHardDate:true})} style={{accentColor:"#dc2626"}}/>
                              Hard Date
                            </label>
                          </div>
                          {!t.needsHardDate?(
                            <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
                              <input type="date" style={{width:130,fontSize:11,borderRadius:7,border:"1px solid #dc262655",background:"#dc262608",color:"var(--text)",padding:"4px 8px",fontFamily:"inherit",outline:"none",colorScheme:"dark"}} value={t.needsByStart||""} onChange={e=>upd(t.id,{needsByStart:e.target.value})}/>
                              <span style={{fontSize:11,color:C.dim}}>–</span>
                              <input type="date" style={{width:130,fontSize:11,borderRadius:7,border:"1px solid #dc262655",background:"#dc262608",color:"var(--text)",padding:"4px 8px",fontFamily:"inherit",outline:"none",colorScheme:"dark"}} value={t.needsByEnd||""} onChange={e=>upd(t.id,{needsByEnd:e.target.value})}/>
                            </div>
                          ):(
                            <input type="date" style={{width:130,fontSize:11,borderRadius:7,border:"1px solid #dc262655",background:"#dc262608",color:"var(--text)",padding:"4px 8px",fontFamily:"inherit",outline:"none",colorScheme:"dark"}} value={t.needsByStart||""} onChange={e=>upd(t.id,{needsByStart:e.target.value})}/>
                          )}
                        </div>
                      )}
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

function HomeRunsTab({homeRuns,panelCounts,onHRChange,onCountChange,jobId,jobName}) {

  const [hoResponse,     setHoResponse]     = useState(null);
  const [showHoModal,    setShowHoModal]     = useState(false);
  const [linkCopied,     setLinkCopied]      = useState(false);
  const [newPanelName,   setNewPanelName]    = useState("");
  const [showSendModal,  setShowSendModal]   = useState(false);
  const [recommended,    setRecommended]     = useState({});  // id -> bool

  const hoLink = `https://homestead-electric.vercel.app/?homeowner=${jobId}`;

  // All rows from all floors, filtered to named ones
  const getAllRows = () => [
    ...(homeRuns.main||[]),
    ...(homeRuns.upper||[]),
    ...(homeRuns.basement||[]),
    ...(homeRuns.extraFloors||[]).flatMap(e=>homeRuns[e.key]||[]),
  ].filter(r=>r.name||r.panel);

  const openSendModal = () => {
    const init = {};
    getAllRows().forEach(r=>{ if(r.recommended) init[r.id]=true; });
    setRecommended(init);
    setShowSendModal(true);
  };

  const copyLink = async () => {
    // Build updated homeRuns with recommended flags stamped onto each row
    const applyRec = (arr) => (arr||[]).map(r=>({...r, recommended:!!recommended[r.id]}));
    const updatedHomeRuns = {
      ...homeRuns,
      main:     applyRec(homeRuns.main),
      upper:    applyRec(homeRuns.upper),
      basement: applyRec(homeRuns.basement),
      ...(homeRuns.extraFloors||[]).reduce((acc,e)=>({...acc,[e.key]:applyRec(homeRuns[e.key])}),{}),
    };
    // Update local React state immediately
    onHRChange(updatedHomeRuns);
    // Flush directly to Firestore NOW — don't wait for the debounced saveJob
    try {
      const snap = await getDoc(doc(db,"jobs",jobId));
      if(snap.exists()) {
        const jobData = snap.data().data;
        await setDoc(doc(db,"jobs",jobId),{
          data: {...jobData, homeRuns: updatedHomeRuns},
          updated_at: new Date().toISOString()
        });
      }
    } catch(e) { console.error("Failed to save recommendations:", e); }
    // Now copy the link
    navigator.clipboard.writeText(hoLink).then(()=>{
      setLinkCopied(true);
      setShowSendModal(false);
      setTimeout(()=>setLinkCopied(false),2500);
    });
  };

  const toggleRec = (id) => setRecommended(r=>({...r,[id]:!r[id]}));

  const resetResponse = async () => {
    if(!window.confirm("Clear the homeowner's response so they can redo it? This cannot be undone.")) return;
    try {
      await deleteDoc(doc(db,"homeowner_requests",jobId));
      setHoResponse(null);
      setShowHoModal(false);
      alert("Response cleared. You can now resend the link to the homeowner.");
    } catch(e) {
      alert("Error clearing response: "+e.message);
    }
  };

  const checkResponse = async () => {
    try {
      const snap = await getDoc(doc(db,"homeowner_requests",jobId));
      if(snap.exists()&&snap.data().submitted) {
        setHoResponse(snap.data());
        setShowHoModal(true);
      } else {
        alert("No response submitted yet.");
      }
    } catch(e){ alert("Failed to check response."); }
  };


  const allRows = [...(homeRuns.main||[]),...(homeRuns.upper||[]),...(homeRuns.basement||[]),
    ...(homeRuns.extraFloors||[]).flatMap(e=>homeRuns[e.key]||[])];

  const total   = allRows.length;

  const pulled  = allRows.filter(r=>r.status==="Pulled").length;

  const pct     = total > 0 ? Math.round((pulled/total)*100) : 0;



  return (

    <div>

      {/* Send to Homeowner */}
      <div style={{marginBottom:16,padding:"12px 14px",background:C.surface,border:`0.5px solid ${C.border}`,borderRadius:10}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:10}}>
          <div>
            <div style={{fontSize:12,fontWeight:500,color:C.text,marginBottom:2}}>Generator load selection</div>
            <div style={{fontSize:11,color:C.dim}}>Share a link so the homeowner can choose &amp; prioritize circuits</div>
          </div>
          <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
            <button onClick={openSendModal}
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

      {/* ── Send to Homeowner Modal — rendered via portal to escape overflow:hidden parents ── */}
      {showSendModal&&createPortal(
        <div onClick={()=>setShowSendModal(false)}
          style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",zIndex:99999,
            display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
          <div onClick={e=>e.stopPropagation()}
            style={{background:C.card,borderRadius:14,width:"100%",maxWidth:460,
              maxHeight:"88vh",display:"flex",flexDirection:"column",
              border:`1px solid ${C.border}`,overflow:"hidden"}}>

            {/* Modal header */}
            <div style={{padding:"18px 20px 14px",borderBottom:`1px solid ${C.border}`,flexShrink:0}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:6}}>
                <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:22,letterSpacing:"0.06em",color:C.text}}>
                  SELECT RECOMMENDED LOADS
                </div>
                <button onClick={()=>setShowSendModal(false)}
                  style={{background:"none",border:"none",color:C.muted,fontSize:18,cursor:"pointer",padding:"0 4px"}}>✕</button>
              </div>
              <div style={{fontSize:12,color:C.dim,lineHeight:1.5}}>
                Star the circuits you want to highlight as recommended. The homeowner will see a <span style={{color:"#f59e0b",fontWeight:700}}>★ WE RECOMMEND</span> badge on those circuits when they open the link.
              </div>
            </div>

            {/* Load list */}
            <div style={{overflowY:"auto",flex:1,padding:"12px 16px"}}>
              {getAllRows().length===0&&(
                <div style={{textAlign:"center",padding:"32px 0",color:C.muted,fontSize:13}}>
                  No loads found — add home run rows first
                </div>
              )}
              {(()=>{
                // Group by floor label
                const floors = [
                  {label:"Main Level",   rows:homeRuns.main||[]},
                  {label:"Upper Level",  rows:homeRuns.upper||[]},
                  {label:"Basement",     rows:homeRuns.basement||[]},
                  ...(homeRuns.extraFloors||[]).map(e=>({label:e.label,rows:homeRuns[e.key]||[]})),
                ].filter(f=>f.rows.filter(r=>r.name||r.panel).length>0);

                return floors.map(floor=>(
                  <div key={floor.label} style={{marginBottom:16}}>
                    <div style={{fontSize:10,fontWeight:700,color:C.dim,letterSpacing:"0.08em",marginBottom:8}}>
                      {floor.label.toUpperCase()}
                    </div>
                    {floor.rows.filter(r=>r.name||r.panel).map(r=>{
                      const isRec = !!recommended[r.id];
                      const WIRE_AMPS_Q = {"14/2":15,"14/3":15,"12/2":20,"12/3":20,"10/2":30,"10/3":30,"8/2":40,"8/3":40,"6/2":50,"6/3":50,"4/2":70,"4/3":70,"2/2":95,"2/3":95,"1/0":125,"2/0":150,"3/0":175,"4/0":200};
                      return (
                        <div key={r.id}
                          onClick={()=>toggleRec(r.id)}
                          style={{display:"flex",alignItems:"center",gap:12,padding:"10px 12px",
                            borderRadius:10,marginBottom:6,cursor:"pointer",
                            background:isRec?"#fffbeb":C.surface,
                            border:`1px solid ${isRec?"#f59e0b":C.border}`,
                            transition:"all 0.15s"}}>
                          {/* Star toggle */}
                          <div style={{width:28,height:28,borderRadius:"50%",flexShrink:0,
                            display:"flex",alignItems:"center",justifyContent:"center",
                            background:isRec?"#f59e0b":C.card,
                            border:`1px solid ${isRec?"#f59e0b":C.border}`,
                            fontSize:14,color:isRec?"#fff":C.muted,transition:"all 0.15s"}}>
                            ★
                          </div>
                          <div style={{flex:1,minWidth:0}}>
                            <div style={{fontSize:13,fontWeight:600,color:C.text}}>{r.name||"Unnamed"}</div>
                            <div style={{fontSize:11,color:C.dim,display:"flex",gap:8,flexWrap:"wrap"}}>
                              {r.panel&&<span>{r.panel}</span>}
                              {r.wire&&<span>{r.wire}</span>}
                              {r.wire&&WIRE_AMPS_Q[r.wire]&&<span style={{color:"#f59e0b",fontWeight:600}}>{WIRE_AMPS_Q[r.wire]}A</span>}
                            </div>
                          </div>
                          {isRec&&(
                            <span style={{fontSize:9,fontWeight:700,color:"#92400e",background:"#fef3c7",
                              border:"0.5px solid #fde68a",borderRadius:99,padding:"2px 8px",
                              letterSpacing:"0.06em",flexShrink:0}}>
                              RECOMMENDED
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ));
              })()}
            </div>

            {/* Footer */}
            <div style={{padding:"14px 16px",borderTop:`1px solid ${C.border}`,flexShrink:0,
              display:"flex",alignItems:"center",justifyContent:"space-between",gap:10}}>
              <div style={{fontSize:11,color:C.dim}}>
                {Object.values(recommended).filter(Boolean).length} recommended
                {" · "}{getAllRows().length} total circuits
              </div>
              <div style={{display:"flex",gap:8}}>
                <button onClick={()=>setShowSendModal(false)}
                  style={{background:"none",border:`1px solid ${C.border}`,borderRadius:8,
                    color:C.dim,fontSize:12,padding:"8px 16px",cursor:"pointer",fontFamily:"inherit"}}>
                  Cancel
                </button>
                <button onClick={copyLink}
                  style={{background:"#1e293b",border:"none",borderRadius:8,color:"#fff",
                    fontSize:12,fontWeight:700,padding:"8px 20px",cursor:"pointer",fontFamily:"inherit"}}>
                  Copy link &amp; send
                </button>
              </div>
            </div>
          </div>
        </div>
      , document.body)}

      {/* Homeowner Response Modal */}
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
              <div key={it.id||i} style={{background:"#f8fafc",border:"0.5px solid #e2e8f0",
                borderRadius:8,padding:"9px 12px",marginBottom:5}}>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <div style={{width:20,height:20,borderRadius:"50%",background:"#fef3c7",
                    border:"0.5px solid #fde68a",display:"flex",alignItems:"center",
                    justifyContent:"center",fontSize:10,fontWeight:500,color:"#b45309",flexShrink:0}}>
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
                  <div key={it.id||i} style={{border:"0.5px solid #f1f5f9",borderRadius:8,
                    padding:"8px 12px",marginBottom:4,opacity:0.55}}>
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

      {/* ── Panel Manager ── */}
      {(()=>{
        const cPanels = homeRuns.customPanels || DEFAULT_PANELS;
        const addPanel = () => {
          const n = newPanelName.trim();
          if(!n || cPanels.includes(n)) return;
          onHRChange({...homeRuns, customPanels:[...cPanels, n]});
          setNewPanelName("");
        };
        const removePanel = (p) => {
          onHRChange({...homeRuns, customPanels: cPanels.filter(x=>x!==p)});
        };
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
                    style={{background:"none",border:"none",cursor:"pointer",color:C.dim,
                      fontSize:14,lineHeight:1,padding:"0 2px",fontWeight:700}}>×</button>
                </div>
              ))}
            </div>
            <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
              <input
                value={newPanelName}
                onChange={e=>setNewPanelName(e.target.value)}
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
        {(homeRuns.extraFloors||[]).map((ef,i)=>(
          <div key={ef.key} style={{position:"relative"}}>
            <HomeRunLevel
              label={ef.label}
              rows={homeRuns[ef.key]||[]}
              customPanels={cp}
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
function TempPedDetail({ job: rawJob, onUpdate, onClose }) {
  const [job, setJob] = useState(()=>normalizeJob(rawJob));
  const jobRef = useRef(job);
  useEffect(()=>{ jobRef.current = job; }, [job]);
  useEffect(()=>{ setJob(normalizeJob(rawJob)); }, [rawJob?.id]);

  const u = patch => {
    const updated = {...jobRef.current, ...patch};
    jobRef.current = updated;
    setJob(updated);
    onUpdate(updated);
  };

  const [signOffName, setSignOffName] = useState("");
  const [viewPhoto, setViewPhoto] = useState(null);

  const tpDef   = getStatusDef(TEMP_PED_STATUSES, job.tempPedStatus||"");
  const color   = tpDef.color || "#8b5cf6";
  const foreman = job.foreman||"Koy";
  const fc      = (({"Koy":"#3b82f6","Vasa":"#f97316","Colby":"#22c55e","Keegan":"#3b82f6","Gage":"#3b82f6","Daegan":"#3b82f6","Braden":"#22c55e","Treycen":"#22c55e","Jon":"#22c55e","Vasa":"#f97316","Abe":"#f97316","Louis":"#f97316","Jacob":"#6b7280"})[foreman]||"#6b7280")||"#6b7280";

  // Photo handling — compress to max 800px / 0.65 quality to stay under Firestore 1MB limit
  const addPhotos = (files) => {
    const arr = Array.from(files);
    let done = 0; const newPhotos = [];
    arr.forEach(file => {
      const reader = new FileReader();
      reader.onload = ev => {
        const img = new Image();
        img.onload = () => {
          const MAX = 800;
          let w = img.width, h = img.height;
          if(w > MAX || h > MAX) {
            if(w > h) { h = Math.round(h * MAX / w); w = MAX; }
            else { w = Math.round(w * MAX / h); h = MAX; }
          }
          const canvas = document.createElement("canvas");
          canvas.width = w; canvas.height = h;
          canvas.getContext("2d").drawImage(img, 0, 0, w, h);
          const dataUrl = canvas.toDataURL("image/jpeg", 0.65);
          newPhotos.push({id:uid(), name:file.name, dataUrl});
          done++;
          if(done===arr.length) u({tempPedPhotos:[...(job.tempPedPhotos||[]),...newPhotos]});
        };
        img.src = ev.target.result;
      };
      reader.readAsDataURL(file);
    });
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
              {[job.address,job.gc].filter(Boolean).join(" · ")||"No details yet"}
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
                <Sel value={job.foreman||"Koy"} onChange={e=>u({foreman:e.target.value})} options={[...["Koy","Vasa","Colby"],"Unassigned"]}/>
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
          </div>

          {/* Photos */}
          <div style={{marginBottom:24}}>
            <div style={{fontSize:10,fontWeight:800,color:C.dim,letterSpacing:"0.12em",marginBottom:12}}>PHOTOS</div>
            {(job.tempPedPhotos||[]).length>0&&(
              <div style={{display:"flex",flexWrap:"wrap",gap:8,marginBottom:10}}>
                {(job.tempPedPhotos||[]).map(p=>(
                  <div key={p.id} style={{position:"relative",width:80,height:80}}>
                    <img src={p.dataUrl} alt={p.name} onClick={()=>setViewPhoto(p.dataUrl)}
                      style={{width:80,height:80,objectFit:"cover",borderRadius:8,cursor:"pointer",
                        border:`1px solid ${C.border}`}}/>
                    <button onClick={()=>u({tempPedPhotos:(job.tempPedPhotos||[]).filter(x=>x.id!==p.id)})}
                      style={{position:"absolute",top:-5,right:-5,background:"#dc2626",border:"none",
                        borderRadius:"50%",color:"#fff",width:18,height:18,fontSize:10,
                        cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",
                        lineHeight:1}}>✕</button>
                  </div>
                ))}
              </div>
            )}
            <label style={{display:"inline-flex",alignItems:"center",gap:6,
              background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,
              padding:"7px 14px",cursor:"pointer",fontSize:11,fontWeight:600,color:C.dim}}>
              + Add Photos
              <input type="file" accept="image/*" multiple style={{display:"none"}}
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

  const saveNow = () => onUpdate({...job});

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

              {[job.address,job.gc].filter(Boolean).join(" · ")||"No details yet"}

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
                            <span style={{fontSize:10,color:C.dim,fontWeight:700,letterSpacing:"0.08em"}}>PROJECTED START</span>
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
                          <DateInp value={job.roughProjectedStart||""} onChange={e=>u({roughProjectedStart:e.target.value})}
                            style={{fontSize:13,fontWeight:700,
                              borderColor:(job.roughStartConfirmed?"#16a34a":C.rough)+"55",
                              background:job.roughStartConfirmed?"#16a34a08":`${C.rough}08`,
                              color:job.roughStartConfirmed?"#16a34a":C.rough}}/>
                          {job.roughStartConfirmed&&<div style={{fontSize:9,color:"#16a34a",fontWeight:700,marginTop:3,letterSpacing:"0.06em"}}>✓ START DATE CONFIRMED</div>}
                        </div>
                      </div>
                      <div style={{fontSize:10,color:C.dim,fontWeight:700,letterSpacing:"0.08em",marginBottom:6}}>STATUS</div>
                      <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                        <select value={job.roughStatus||""} onChange={e=>{
                          const v=e.target.value;
                          const def=getStatusDef(ROUGH_STATUSES,v);
                          u({roughStatus:v, roughOnHold:v==="waiting", roughScheduled:v==="scheduled",
                            roughStartConfirmed:v==="date_confirmed"?true:(v==="scheduled"||v==="inprogress"||v==="complete")?job.roughStartConfirmed:false,
                            roughStatusDate:def.hasDate?job.roughStatusDate:"",
                            readyToInvoice:v==="invoice"?true:(job.roughStatus==="invoice"?false:job.readyToInvoice),
                            ...(v==="invoice"&&!job.readyToInvoice?{readyToInvoiceDate:new Date().toLocaleDateString("en-US")}:{}),
                            roughProjectedStart:v==="scheduled"?job.roughProjectedStart:job.roughProjectedStart});
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
                      </div>
                      {(job.roughStatus==="date_confirmed"||job.roughStatus==="waiting_date"||job.roughStatus==="scheduled")&&(
                        <div style={{marginTop:8,padding:"8px 10px",background:"#dc262608",border:"1px solid #dc262633",borderRadius:8}}>
                          <div style={{fontSize:9,fontWeight:700,color:"#dc2626",letterSpacing:"0.08em",marginBottom:6}}>SCHEDULE WINDOW / DATE</div>
                          <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:6,flexWrap:"wrap"}}>
                            <label style={{display:"flex",alignItems:"center",gap:5,fontSize:11,color:C.dim,cursor:"pointer"}}>
                              <input type="radio" checked={!job.roughNeedsHardDate} onChange={()=>u({roughNeedsHardDate:false})} style={{accentColor:"#dc2626"}}/>
                              Date Range
                            </label>
                            <label style={{display:"flex",alignItems:"center",gap:5,fontSize:11,color:C.dim,cursor:"pointer"}}>
                              <input type="radio" checked={!!job.roughNeedsHardDate} onChange={()=>u({roughNeedsHardDate:true})} style={{accentColor:"#dc2626"}}/>
                              Hard Date
                            </label>
                          </div>
                          {!job.roughNeedsHardDate?(
                            <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
                              <input type="date" style={{width:130,fontSize:11,borderRadius:7,border:"1px solid #dc262655",background:"#dc262608",color:"var(--text)",padding:"4px 8px",fontFamily:"inherit",outline:"none",colorScheme:"dark"}} value={job.roughNeedsByStart||""} onChange={e=>u({roughNeedsByStart:e.target.value})}/>
                              <span style={{fontSize:11,color:C.dim}}>–</span>
                              <input type="date" style={{width:130,fontSize:11,borderRadius:7,border:"1px solid #dc262655",background:"#dc262608",color:"var(--text)",padding:"4px 8px",fontFamily:"inherit",outline:"none",colorScheme:"dark"}} value={job.roughNeedsByEnd||""} onChange={e=>u({roughNeedsByEnd:e.target.value})}/>
                            </div>
                          ):(
                            <input type="date" style={{width:130,fontSize:11,borderRadius:7,border:"1px solid #dc262655",background:"#dc262608",color:"var(--text)",padding:"4px 8px",fontFamily:"inherit",outline:"none",colorScheme:"dark"}} value={job.roughNeedsByStart||""} onChange={e=>u({roughNeedsByStart:e.target.value})}/>
                          )}
                        </div>
                      )}

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
                          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:5}}>
                            <span style={{fontSize:10,color:C.dim,fontWeight:700,letterSpacing:"0.08em"}}>PROJECTED START</span>
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
                          <DateInp value={job.finishProjectedStart||""} onChange={e=>u({finishProjectedStart:e.target.value})}
                            style={{fontSize:13,fontWeight:700,
                              borderColor:(job.finishStartConfirmed?"#16a34a":C.finish)+"55",
                              background:job.finishStartConfirmed?"#16a34a08":`${C.finish}08`,
                              color:job.finishStartConfirmed?"#16a34a":C.finish}}/>
                          {job.finishStartConfirmed&&<div style={{fontSize:9,color:"#16a34a",fontWeight:700,marginTop:3,letterSpacing:"0.06em"}}>✓ START DATE CONFIRMED</div>}
                        </div>
                      </div>
                      <div style={{fontSize:10,color:C.dim,fontWeight:700,letterSpacing:"0.08em",marginBottom:6}}>STATUS</div>
                      <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                        <select value={job.finishStatus||""} onChange={e=>{
                          const v=e.target.value;
                          const def=getStatusDef(FINISH_STATUSES,v);
                          u({finishStatus:v, finishOnHold:v==="waiting", finishScheduled:v==="scheduled",
                            finishStartConfirmed:v==="date_confirmed"?true:(v==="scheduled"||v==="inprogress"||v==="complete")?job.finishStartConfirmed:false,
                            finishStatusDate:def.hasDate?job.finishStatusDate:"",
                            readyToInvoice:v==="invoice"?true:(job.finishStatus==="invoice"?false:job.readyToInvoice),
                            ...(v==="invoice"&&!job.readyToInvoice?{readyToInvoiceDate:new Date().toLocaleDateString("en-US")}:{}),
                            finishProjectedStart:v==="scheduled"?job.finishProjectedStart:job.finishProjectedStart});
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
                      </div>
                      {(job.finishStatus==="date_confirmed"||job.finishStatus==="waiting_date"||job.finishStatus==="scheduled")&&(
                        <div style={{marginTop:8,padding:"8px 10px",background:"#dc262608",border:"1px solid #dc262633",borderRadius:8}}>
                          <div style={{fontSize:9,fontWeight:700,color:"#dc2626",letterSpacing:"0.08em",marginBottom:6}}>SCHEDULE WINDOW / DATE</div>
                          <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:6,flexWrap:"wrap"}}>
                            <label style={{display:"flex",alignItems:"center",gap:5,fontSize:11,color:C.dim,cursor:"pointer"}}>
                              <input type="radio" checked={!job.finishNeedsHardDate} onChange={()=>u({finishNeedsHardDate:false})} style={{accentColor:"#dc2626"}}/>
                              Date Range
                            </label>
                            <label style={{display:"flex",alignItems:"center",gap:5,fontSize:11,color:C.dim,cursor:"pointer"}}>
                              <input type="radio" checked={!!job.finishNeedsHardDate} onChange={()=>u({finishNeedsHardDate:true})} style={{accentColor:"#dc2626"}}/>
                              Hard Date
                            </label>
                          </div>
                          {!job.finishNeedsHardDate?(
                            <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
                              <input type="date" style={{width:130,fontSize:11,borderRadius:7,border:"1px solid #dc262655",background:"#dc262608",color:"var(--text)",padding:"4px 8px",fontFamily:"inherit",outline:"none",colorScheme:"dark"}} value={job.finishNeedsByStart||""} onChange={e=>u({finishNeedsByStart:e.target.value})}/>
                              <span style={{fontSize:11,color:C.dim}}>–</span>
                              <input type="date" style={{width:130,fontSize:11,borderRadius:7,border:"1px solid #dc262655",background:"#dc262608",color:"var(--text)",padding:"4px 8px",fontFamily:"inherit",outline:"none",colorScheme:"dark"}} value={job.finishNeedsByEnd||""} onChange={e=>u({finishNeedsByEnd:e.target.value})}/>
                            </div>
                          ):(
                            <input type="date" style={{width:130,fontSize:11,borderRadius:7,border:"1px solid #dc262655",background:"#dc262608",color:"var(--text)",padding:"4px 8px",fontFamily:"inherit",outline:"none",colorScheme:"dark"}} value={job.finishNeedsByStart||""} onChange={e=>u({finishNeedsByStart:e.target.value})}/>
                          )}
                        </div>
                      )}

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
                      u({changeOrders:updatedCOs, returnTrips:[newRT, ...(job.returnTrips||[])]});
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
                <ReturnTrips trips={job.returnTrips} onChange={v=>u({returnTrips:v})} jobName={job.name||"This Job"} jobSimproNo={job.simproNo} onEmail={setEmailData}/>
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

                    <Inp value={job[k]} onChange={e=>u({[k]:e.target.value})} placeholder={l}/>

                  </div>

                ))}

              <div>

                <div style={{fontSize:10,color:C.dim,marginBottom:3}}>Foreman</div>

                <Sel value={job.foreman||"Koy"} onChange={e=>u({foreman:e.target.value})} options={[...["Koy","Vasa","Colby"],"Unassigned"]}/>

              </div>

              <div>

                <div style={{fontSize:10,color:C.dim,marginBottom:3}}>Lead</div>

{["Keegan","Gage","Daegan","Colby","Braden","Treycen","Jon","Vasa","Abe","Louis","Jacob"].length>0
                  ? <Sel value={job.lead||""} onChange={e=>u({lead:e.target.value})} options={["", ...LEADS]} placeholder="Select lead…"/>
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

        <div style={{marginLeft:22,marginTop:4,fontSize:11,color:C.dim,fontStyle:"italic"}}>{q.answer}</div>

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

function TempPedCard({ job, onOpen, onUpdate, onDelete }) {
  const tpDef = getStatusDef(TEMP_PED_STATUSES, job.tempPedStatus||"");
  const color = tpDef.color || "#8b5cf6";
  const foreman = job.foreman||"Koy";
  const fc = (({"Koy":"#3b82f6","Vasa":"#f97316","Colby":"#22c55e","Keegan":"#3b82f6","Gage":"#3b82f6","Daegan":"#3b82f6","Braden":"#22c55e","Treycen":"#22c55e","Jon":"#22c55e","Vasa":"#f97316","Abe":"#f97316","Louis":"#f97316","Jacob":"#6b7280"})[foreman]||"#6b7280") || "#6b7280";

  const upd = (patch) => onUpdate({...job, ...patch});

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
            {job.address&&<span>{job.address}</span>}
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
                  color:"var(--text)",fontFamily:"inherit",outline:"none",colorScheme:"dark"}}
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

  { key:"tempPedReady",    label:"Temp Peds — Ready to Schedule", color:"#8b5cf6",
    test: j => !!j.tempPed && (!j.tempPedStatus||j.tempPedStatus==="ready") },

  { key:"tempPedScheduled", label:"Temp Peds — Scheduled",           color:"#7c3aed",
    test: j => !!j.tempPed && j.tempPedStatus==="scheduled" },

  { key:"tempPedDone",     label:"Temp Peds — Completed",            color:"#16a34a",
    test: j => !!j.tempPed && j.tempPedStatus==="completed" },

  { key:"prep",         label:"Pre Job Prep",              color:"#0d9488",
    test: j => !j.tempPed && (j.prepStage||"") !== "Job Prep Complete" },

  { key:"roughNotStarted", label:"Rough — Not Started",   color:"#64748b",
    test: j => { const rs=effRS(j); return !j.tempPed && (j.prepStage||"")==="Job Prep Complete" && (!rs||rs==="waiting_date"||rs==="date_confirmed"||rs==="scheduled"); } },

  { key:"roughHold",    label:"Rough — On Hold",           color:"#ca8a04",
    test: j => effRS(j) === "waiting" },

  { key:"rough",        label:"Rough In Progress",         color:"#2563eb",
    test: j => effRS(j) === "inprogress" },

  { key:"roughInvoice", label:"Rough — Ready to Invoice",  color:"#ea580c",
    test: j => effRS(j) === "invoice" },

  { key:"between",      label:"In Between",                color:"#e8a020",
    test: j => { const rs=effRS(j); const fs=effFS(j); return rs==="complete"&&(!fs||fs==="waiting_date"||fs==="date_confirmed"||fs==="scheduled"); } },

  { key:"finishHold",   label:"Finish — On Hold",          color:"#ca8a04",
    test: j => effFS(j) === "waiting" },

  { key:"finish",       label:"Finish In Progress",        color:"#0ea5e9",
    test: j => effFS(j) === "inprogress" },

  { key:"finishInvoice",label:"Finish — Ready to Invoice", color:"#ea580c",
    test: j => effFS(j) === "invoice" },

  { key:"complete",     label:"Completed",                 color:"#22c55e",
    test: j => effFS(j) === "complete" },

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
              job.tempPed
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

const ALL_STAGES = ROUGH_STAGES;



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



// ── Homeowner Generator Load Selection Page ───────────────────
function HomeownerPage({ jobId }) {
  const [job,        setJob]        = useState(null);
  const [items,      setItems]      = useState([]);
  const [submitted,  setSubmitted]  = useState(false);
  const [loading,    setLoading]    = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error,      setError]      = useState(null);
  const [signature,  setSignature]  = useState("");
  const [sigError,   setSigError]   = useState(false);
  const dragIdx = useRef(null);

  // Wire size → amps lookup
  const WIRE_AMPS = {
    "14/2":15,"14/3":15,"12/2":20,"12/3":20,"10/2":30,"10/3":30,
    "8/2":40,"8/3":40,"6/2":50,"6/3":50,"4/2":70,"4/3":70,
    "2/2":95,"2/3":95,"1/0":125,"2/0":150,"3/0":175,"4/0":200,
  };

  useEffect(()=>{
    async function load() {
      try {
        const snap = await getDoc(doc(db,"jobs",jobId));
        if(!snap.exists()){ setError("Job not found."); setLoading(false); return; }
        const j = snap.data().data;
        setJob(j);
        const rows = [
          ...(j.homeRuns?.main||[]),
          ...(j.homeRuns?.upper||[]),
          ...(j.homeRuns?.basement||[]),
          ...(j.homeRuns?.extraFloors||[]).flatMap(e=>j.homeRuns?.[e.key]||[]),
        ].filter(r=>r.name||r.panel).map((r,i)=>({...r, priority:i+1, included:true, notes:""}));
        setItems(rows);
        const reqSnap = await getDoc(doc(db,"homeowner_requests",jobId));
        if(reqSnap.exists()&&reqSnap.data().submitted){
          setSubmitted(true);
          const saved = reqSnap.data().items;
          if(saved) setItems(saved);
        }
      } catch(e){ setError("Failed to load. Please try again."); }
      setLoading(false);
    }
    load();
  },[jobId]);

  const toggle   = (id) => setItems(its=>its.map(it=>it.id===id?{...it,included:!it.included}:it));
  const setNotes = (id,v) => setItems(its=>its.map(it=>it.id===id?{...it,notes:v}:it));

  const onDragStart = (i) => { dragIdx.current = i; };
  const onDragOver  = (e,i) => {
    e.preventDefault();
    if(dragIdx.current===null||dragIdx.current===i) return;
    setItems(its=>{
      const arr=[...its];
      const [moved]=arr.splice(dragIdx.current,1);
      arr.splice(i,0,moved);
      dragIdx.current=i;
      return arr.map((it,idx)=>({...it,priority:idx+1}));
    });
  };
  const onDragEnd = () => { dragIdx.current=null; };

  const submit = async () => {
    if(!signature.trim()){ setSigError(true); return; }
    setSigError(false);
    setSubmitting(true);
    try {
      await setDoc(doc(db,"homeowner_requests",jobId),{
        jobId, jobName: job?.name||"", submitted:true,
        submittedAt: new Date().toISOString(),
        signature: signature.trim(),
        items: items.map((it,i)=>({...it,priority:i+1})),
      });
      setSubmitted(true);
    } catch(e){ alert("Failed to submit. Please try again."); }
    setSubmitting(false);
  };

  const A = "#b45309";  // amber text
  const AB = "#fef3c7"; // amber bg light
  const included = items.filter(it=>it.included);
  const excluded = items.filter(it=>!it.included);

  // ── Generator size calculator ─────────────────────────────
  const WIRE_AMPS_MAP = {
    "14/2":15,"14/3":15,"12/2":20,"12/3":20,"10/2":30,"10/3":30,
    "8/2":40,"8/3":40,"6/2":50,"6/3":50,"4/2":70,"4/3":70,
    "2/2":95,"2/3":95,"1/0":125,"2/0":150,"3/0":175,"4/0":200,
  };
  // Estimate watts from amps — use 240V for 2-pole (large), 120V for single pole
  // Conservative: use 80% of breaker rating as running load
  const estimateWatts = (wire) => {
    if(!wire||!WIRE_AMPS_MAP[wire]) return 0;
    const amps = WIRE_AMPS_MAP[wire];
    const is2pole = wire.endsWith("/3")||amps>=30;
    const volts = is2pole ? 240 : 120;
    return Math.round(amps * volts * 0.8);
  };
  const totalWatts = included.reduce((sum,it)=>sum+estimateWatts(it.wire),0);
  const totalKW    = (totalWatts/1000).toFixed(1);
  // Generator sizing: add 25% headroom for startup surge
  const surgeKW    = Math.ceil(totalWatts*1.25/1000);
  const genSize = surgeKW<=11?"11 kW":surgeKW<=14?"14 kW":surgeKW<=17?"17 kW":surgeKW<=20?"20 kW":surgeKW<=22?"22 kW":surgeKW<=24?"24 kW":surgeKW<=26?"26 kW":surgeKW<=36?"36 kW":">36 kW — consult engineer";

  const base = {fontFamily:"system-ui,-apple-system,sans-serif",minHeight:"100vh",
    background:"#f8fafc",color:"#1e293b"};

  const cardStyle = {background:"#fff",border:"0.5px solid #e2e8f0",borderRadius:10,
    marginBottom:6,padding:"12px 14px"};

  if(loading) return (
    <div style={{...base,display:"flex",alignItems:"center",justifyContent:"center"}}>
      <div style={{fontSize:14,color:"#94a3b8"}}>Loading…</div>
    </div>
  );
  if(error) return (
    <div style={{...base,display:"flex",alignItems:"center",justifyContent:"center",padding:32,textAlign:"center"}}>
      <div style={{fontSize:14,color:"#dc2626"}}>{error}</div>
    </div>
  );
  if(submitted) return (
    <div style={{...base,display:"flex",flexDirection:"column",alignItems:"center",
      justifyContent:"center",padding:40,textAlign:"center"}}>
      <div style={{width:56,height:56,borderRadius:"50%",background:"#f0fdf4",
        border:"0.5px solid #bbf7d0",display:"flex",alignItems:"center",
        justifyContent:"center",fontSize:24,marginBottom:20}}>✓</div>
      <div style={{fontSize:20,fontWeight:500,color:"#1e293b",marginBottom:8}}>Selections received</div>
      <div style={{fontSize:14,color:"#64748b",maxWidth:320,lineHeight:1.6}}>
        Thank you, <strong>{items[0]?.signature||signature||"homeowner"}</strong>. Homestead Electric has received your generator load selections and will be in touch to confirm the final plan.
      </div>
      <div style={{marginTop:40,fontSize:11,color:"#cbd5e1",letterSpacing:"0.06em"}}>HOMESTEAD ELECTRIC</div>
    </div>
  );

  return (
    <div style={{...base,maxWidth:500,margin:"0 auto",padding:"0 0 80px"}}>

      {/* Header */}
      <div style={{padding:"24px 20px 20px",borderBottom:"0.5px solid #e2e8f0"}}>
        <div style={{fontSize:10,fontWeight:500,color:"#94a3b8",letterSpacing:"0.1em",marginBottom:6}}>HOMESTEAD ELECTRIC</div>
        <div style={{fontSize:20,fontWeight:500,color:"#1e293b",marginBottom:4}}>{job?.name||"Generator load selection"}</div>
        <div style={{fontSize:13,color:"#64748b",lineHeight:1.55}}>
          A standby generator powers select circuits in your home during an outage — but not everything can run at once due to capacity limits. Review the circuits below, choose which ones matter most to you, and rank them by priority. Homestead Electric will use your selections to finalize the generator plan.
        </div>
      </div>

      {/* How it works */}
      <div style={{margin:"0 16px",marginTop:16,padding:"12px 14px",
        background:AB,border:`0.5px solid #fde68a`,borderRadius:10}}>
        <div style={{fontSize:12,fontWeight:500,color:A,marginBottom:4}}>How to complete this form</div>
        <div style={{fontSize:12,color:"#92400e",lineHeight:1.6}}>
          1. Toggle circuits off if you don't want them on the generator.<br/>
          2. Drag the handle on the left to reorder — most important at the top.<br/>
          3. Add a note to any circuit if helpful.<br/>
          4. Sign your name at the bottom and tap Submit.
        </div>
      </div>

      <div style={{padding:"20px 16px 0"}}>

        {/* Generator size calculator — only show when wire data exists to calculate from */}
        {included.length>0&&totalWatts>0&&(
          <div style={{marginBottom:16,padding:"14px 16px",background:"#1e293b",borderRadius:12,
            border:"0.5px solid #334155"}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,flexWrap:"wrap"}}>
              <div>
                <div style={{fontSize:10,fontWeight:600,color:"#64748b",letterSpacing:"0.08em",marginBottom:4}}>
                  ESTIMATED GENERATOR SIZE NEEDED
                </div>
                <div style={{fontSize:26,fontWeight:700,color:"#f59e0b",lineHeight:1}}>
                  {genSize}
                </div>
                <div style={{fontSize:11,color:"#64748b",marginTop:4}}>
                  {included.length} circuit{included.length!==1?"s":""} · ~{totalKW} kW running · {surgeKW} kW w/ startup surge
                </div>
              </div>
              <div style={{textAlign:"right"}}>
                <div style={{fontSize:10,color:"#64748b",marginBottom:6}}>Running load by circuit</div>
                {included.filter(it=>estimateWatts(it.wire)>0).slice(0,5).map(it=>(
                  <div key={it.id} style={{fontSize:11,color:"#94a3b8",marginBottom:2,display:"flex",gap:8,justifyContent:"flex-end"}}>
                    <span style={{color:"#cbd5e1"}}>{it.name||"Unnamed"}</span>
                    <span style={{color:"#f59e0b",fontWeight:600}}>{(estimateWatts(it.wire)/1000).toFixed(1)}kW</span>
                  </div>
                ))}
                {included.filter(it=>estimateWatts(it.wire)>0).length>5&&(
                  <div style={{fontSize:10,color:"#475569"}}>+{included.filter(it=>estimateWatts(it.wire)>0).length-5} more…</div>
                )}
              </div>
            </div>
            <div style={{marginTop:10,fontSize:10,color:"#475569",lineHeight:1.5}}>
              * Estimate based on 80% of breaker ratings at rated voltage with 25% surge headroom. Final sizing determined by Homestead Electric.
            </div>
          </div>
        )}

        {/* ON GENERATOR */}
        <div style={{fontSize:10,fontWeight:500,color:"#94a3b8",letterSpacing:"0.08em",marginBottom:10}}>
          ON GENERATOR · {included.length} circuit{included.length!==1?"s":""}
        </div>

        {included.length===0&&(
          <div style={{textAlign:"center",padding:"24px 0",fontSize:13,color:"#94a3b8",
            border:"0.5px dashed #e2e8f0",borderRadius:10,marginBottom:12}}>
            No circuits selected — add some back below
          </div>
        )}

        {items.map((it,i)=> it.included ? (
          <div key={it.id}
            draggable
            onDragStart={()=>onDragStart(i)}
            onDragOver={e=>onDragOver(e,i)}
            onDragEnd={onDragEnd}
            style={{...cardStyle,cursor:"grab",userSelect:"none",
              borderLeft:it.recommended?"3px solid #f59e0b":"0.5px solid #e2e8f0",
              background:it.recommended?"#fffbeb":"#fff"}}>
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              {/* Drag handle */}
              <div style={{color:"#cbd5e1",fontSize:15,flexShrink:0,lineHeight:1}}>⠿</div>
              {/* Priority badge */}
              <div style={{width:22,height:22,borderRadius:"50%",background:"#fef3c7",
                border:"0.5px solid #fde68a",display:"flex",alignItems:"center",
                justifyContent:"center",fontSize:10,fontWeight:500,color:A,flexShrink:0}}>
                {i+1}
              </div>
              {/* Info */}
              <div style={{flex:1,minWidth:0}}>
                <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:2,flexWrap:"wrap"}}>
                  <span style={{fontSize:13,fontWeight:500,color:"#1e293b"}}>
                    {it.name||"Unnamed circuit"}
                  </span>
                  {it.recommended&&(
                    <span style={{fontSize:9,fontWeight:700,color:"#92400e",background:"#fef3c7",
                      border:"0.5px solid #fde68a",borderRadius:99,padding:"1px 7px",
                      letterSpacing:"0.06em",whiteSpace:"nowrap"}}>
                      ★ WE RECOMMEND
                    </span>
                  )}
                </div>
                <div style={{fontSize:11,color:"#94a3b8",display:"flex",gap:8}}>
                  {it.panel&&<span>{it.panel}</span>}
                  {it.wire&&<span>{it.wire}</span>}
                  {it.wire&&WIRE_AMPS[it.wire]&&(
                    <span style={{color:A,fontWeight:500}}>{WIRE_AMPS[it.wire]}A</span>
                  )}
                  {estimateWatts(it.wire)>0&&(
                    <span style={{color:"#64748b"}}>~{(estimateWatts(it.wire)/1000).toFixed(1)}kW</span>
                  )}
                </div>
              </div>
              <button onClick={()=>toggle(it.id)}
                style={{background:"none",border:"0.5px solid #e2e8f0",borderRadius:7,
                  padding:"4px 10px",fontSize:11,cursor:"pointer",color:"#94a3b8",
                  flexShrink:0,fontFamily:"inherit"}}>
                Remove
              </button>
            </div>
            <div style={{marginTop:8,paddingLeft:32}}>
              <input value={it.notes||""} onChange={e=>setNotes(it.id,e.target.value)}
                placeholder="Add a note (optional)…"
                style={{width:"100%",boxSizing:"border-box",border:"0.5px solid #e2e8f0",
                  borderRadius:7,padding:"6px 10px",fontSize:12,fontFamily:"inherit",
                  color:"#1e293b",background:"#f8fafc",outline:"none"}}/>
            </div>
          </div>
        ) : null)}

        {/* NOT ON GENERATOR */}
        {excluded.length>0&&(
          <>
            <div style={{fontSize:10,fontWeight:500,color:"#cbd5e1",letterSpacing:"0.08em",
              margin:"20px 0 10px"}}>
              NOT ON GENERATOR · {excluded.length}
            </div>
            {items.map((it,i)=> !it.included ? (
              <div key={it.id}
                style={{...cardStyle,opacity:0.6}}>
                <div style={{display:"flex",alignItems:"center",gap:10}}>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:13,color:"#64748b",marginBottom:2}}>
                      {it.name||"Unnamed circuit"}
                    </div>
                    <div style={{fontSize:11,color:"#94a3b8",display:"flex",gap:8}}>
                      {it.panel&&<span>{it.panel}</span>}
                      {it.wire&&<span>{it.wire}</span>}
                      {it.wire&&WIRE_AMPS[it.wire]&&<span>{WIRE_AMPS[it.wire]}A</span>}
                    </div>
                  </div>
                  <button onClick={()=>toggle(it.id)}
                    style={{background:"none",border:`0.5px solid #fde68a`,borderRadius:7,
                      padding:"4px 10px",fontSize:11,cursor:"pointer",color:A,
                      flexShrink:0,fontFamily:"inherit"}}>
                    Add back
                  </button>
                </div>
              </div>
            ) : null)}
          </>
        )}

        {/* Signature */}
        <div style={{marginTop:28,padding:"16px",background:"#fff",
          border:`0.5px solid ${sigError?"#fca5a5":"#e2e8f0"}`,borderRadius:10}}>
          <div style={{fontSize:12,fontWeight:500,color:"#1e293b",marginBottom:4}}>
            Sign off on your selections
          </div>
          <div style={{fontSize:12,color:"#64748b",marginBottom:12,lineHeight:1.5}}>
            By typing your full name below, you confirm these are the circuits you'd like included on your generator. Homestead Electric will use this as authorization to proceed with the plan.
          </div>
          <input
            value={signature}
            onChange={e=>{ setSignature(e.target.value); if(e.target.value.trim()) setSigError(false); }}
            placeholder="Type your full name…"
            style={{width:"100%",boxSizing:"border-box",border:`0.5px solid ${sigError?"#fca5a5":"#e2e8f0"}`,
              borderRadius:7,padding:"10px 12px",fontSize:14,fontFamily:"Georgia,serif",
              color:"#1e293b",background:"#f8fafc",outline:"none"}}/>
          {sigError&&(
            <div style={{fontSize:11,color:"#dc2626",marginTop:6}}>Please sign your name to submit.</div>
          )}
        </div>

        {/* Submit */}
        <button onClick={submit} disabled={submitting}
          style={{width:"100%",marginTop:12,padding:"14px",
            background:submitting?"#e2e8f0":"#1e293b",
            border:"none",borderRadius:10,
            color:submitting?"#94a3b8":"#fff",
            fontSize:14,fontWeight:500,cursor:submitting?"not-allowed":"pointer",
            fontFamily:"inherit",letterSpacing:"0.01em"}}>
          {submitting?"Submitting…":"Submit my selections"}
        </button>
        <div style={{textAlign:"center",marginTop:14,fontSize:10,color:"#cbd5e1",letterSpacing:"0.08em"}}>
          HOMESTEAD ELECTRIC
        </div>
      </div>
    </div>
  );
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

function UpcomingJobs({ upcoming, onChange, onPromote, canManage=false }) {
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
                        {getForemenList().map(f=><option key={f} value={f}>{f}</option>)}
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

function computeTasks(jobs) {
  const tasks = [];
  jobs.forEach(job => {
    const foreman = job.foreman || "Koy";
    const rs = job.roughStatus || "";
    const fs = job.finishStatus || "";

    // Rough — waiting for date OR date confirmed: fire scheduling task
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

    // QC Walk — fires once when rough hits 80%+, clears when qcStatus=scheduled
    if(job.roughQCTaskFired && job.qcStatus !== "scheduled" && job.qcStatus !== "complete") tasks.push({
      id: job.id+"_qc_walk", jobId: job.id, jobName: job.name,
      type: "auto", category: "qc", foreman,
      title: "Schedule QC Walk",
      desc: `Rough is at ${job.roughStage||"80%+"} — time to schedule the QC walk`,
      color: C.teal, cleared: false,
    });

    // FIX 4: Final QC Walk — fires when finish hits 80%+
    const finishPct = parseInt(job.finishStage)||0;
    if(finishPct>=80 && job.qcStatus !== "scheduled" && job.qcStatus !== "complete") tasks.push({
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
        const d = (str=>{ const m=str.match(/^(\d{4})-(\d{2})-(\d{2})$/); if(m) return new Date(+m[1],+m[2]-1,+m[3]); const m2=str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/); if(m2) return new Date(+m2[2],+m2[1]-1,+(m2[3].length===2?"20"+m2[3]:m2[3])); return null; })(betweenDate);
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
        const d = (str=>{ const m=str.match(/^(\d{4})-(\d{2})-(\d{2})$/); if(m) return new Date(+m[1],+m[2]-1,+m[3]); const m2=str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/); if(m2) return new Date(+m2[2],+m2[1]-1,+(m2[3].length===2?"20"+m2[3]:m2[3])); return null; })(invDate);
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

function TaskCard({ task, jobs, onSelectJob, onDismiss, onSetDueDate }) {
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
                  background:"var(--surface)",color:"var(--text)",fontFamily:"inherit",width:130,outline:"none",colorScheme:"dark"}}
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

function AddTaskForm({ defaultForeman, onAdd, onCancel }) {
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
            {getForemenList().map(f=><option key={f} value={f}>{f}</option>)}
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
                  {job.address&&<span style={{fontSize:10,color:"var(--dim)"}}>{job.address}</span>}
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
function ForemanTaskCard({ isKoy, fTasks, prepTasks, jobs, manualTasks, onManualTasksChange, onSelectJob, onUpdateJob, activeForeman }) {
  const [open, setOpen] = useState(true);
  const [tab, setTab]   = useState(isKoy ? "prep" : "tasks");

  const totalCount = fTasks.length + (isKoy ? prepTasks.length : 0);
  const overdueCount = fTasks.filter(t=>{ const u=URGENCY(t.dueDate); return u&&u.days<0; }).length;

  return (
    <div style={{margin:"0 0 16px",border:"1px solid #dc262633",borderRadius:12,overflow:"hidden"}}>
      {/* Header — always visible, click to collapse */}
      <div onClick={()=>setOpen(v=>!v)}
        style={{display:"flex",alignItems:"center",gap:8,padding:"12px 16px",
          background:"#dc262608",cursor:"pointer",userSelect:"none"}}>
        <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:16,letterSpacing:"0.08em",color:"#dc2626"}}>
          OPEN TASKS
        </div>
        <div style={{background:"#dc262618",border:"1px solid #dc262633",borderRadius:99,
          padding:"1px 8px",fontSize:11,color:"#dc2626",fontWeight:700}}>{totalCount}</div>
        {overdueCount>0&&(
          <div style={{background:"#dc262618",border:"1px solid #dc262633",borderRadius:99,
            padding:"1px 8px",fontSize:11,color:"#dc2626",fontWeight:700}}>⚠ {overdueCount} overdue</div>
        )}
        <div style={{marginLeft:"auto",fontSize:13,color:"#dc2626",opacity:0.7}}>{open?"▾":"▸"}</div>
      </div>

      {open && (
        <div style={{padding:"12px 14px"}}>
          {/* Tab bar — only for Koy */}
          {isKoy && (
            <div style={{display:"flex",gap:6,marginBottom:12}}>
              {[["prep","Job Prep",prepTasks.length],["tasks","Tasks",fTasks.length]].map(([k,label,count])=>(
                <button key={k} onClick={e=>{e.stopPropagation();setTab(k);}}
                  style={{padding:"5px 14px",borderRadius:7,fontSize:12,cursor:"pointer",
                    fontFamily:"inherit",fontWeight:tab===k?700:500,
                    background:tab===k?"#dc2626":"transparent",
                    border:`1px solid ${tab===k?"#dc2626":"#dc262644"}`,
                    color:tab===k?"#fff":"#dc2626",transition:"all 0.15s",
                    display:"flex",alignItems:"center",gap:6}}>
                  {label}
                  {count>0&&(
                    <span style={{background:tab===k?"rgba(255,255,255,0.25)":"#dc262618",
                      borderRadius:99,padding:"0px 6px",fontSize:10,fontWeight:700}}>
                      {count}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}

          {/* Prep tab — Koy only */}
          {isKoy && tab==="prep" && (
            prepTasks.length===0
              ? <div style={{fontSize:12,color:"var(--muted)",textAlign:"center",padding:"16px 0"}}>✓ All prep complete</div>
              : <PrepTaskList jobs={jobs} onSelectJob={onSelectJob} onUpdateJob={onUpdateJob}/>
          )}

          {/* Tasks tab — all foremen */}
          {(!isKoy || tab==="tasks") && (
            fTasks.length===0
              ? <div style={{fontSize:12,color:"var(--muted)",textAlign:"center",padding:"16px 0"}}>✓ No open tasks</div>
              : <Tasks
                  jobs={jobs}
                  manualTasks={manualTasks}
                  onManualTasksChange={onManualTasksChange}
                  onSelectJob={onSelectJob}
                  onUpdateJob={onUpdateJob}
                  filterForeman={activeForeman}
                />
          )}
        </div>
      )}
    </div>
  );
}

function Tasks({ jobs, manualTasks, onManualTasksChange, onSelectJob, onUpdateJob, filterForeman, compact }) {
  const [showAdd, setShowAdd] = useState(false);
  const [collapsedForemen, setCollapsedForemen] = useState({});
  const toggleForeman = (f) => setCollapsedForemen(c=>({...c,[f]:!c[f]}));

  const handleSetDueDate = (taskId, date) => {
    // Manual task — update in the list (persists to Firestore via manualTasks collection)
    const isManual = (manualTasks||[]).find(t => t.id === taskId);
    if(isManual) {
      onManualTasksChange((manualTasks||[]).map(t => t.id===taskId ? {...t, dueDate:date} : t));
      return;
    }
    // Auto-task — find which job owns this task and save due date to job.taskDueDates map
    const autoTasks = computeTasks(jobs);
    const task = autoTasks.find(t => t.id === taskId);
    if(task && task.jobId && onUpdateJob) {
      const job = jobs.find(j => j.id === task.jobId);
      if(job) {
        const existing = job.taskDueDates || {};
        onUpdateJob(task.jobId, { taskDueDates: {...existing, [taskId]: date} });
      }
    }
  };

  const handleAdd = (t) => {
    const task = { id: uid(), title: t.title, foreman: t.foreman,
      notes: t.notes, dueDate: t.dueDate||"", type:"manual", category:"manual",
      color: "#6b7280", cleared:false, createdAt: new Date().toISOString() };
    onManualTasksChange([...(manualTasks||[]), task]);
    setShowAdd(false);
  };

  const dismissManual = (id) => {
    onManualTasksChange((manualTasks||[]).filter(t=>t.id!==id));
  };

  const dismissInvoiceTask = (jobId) => {
    const job = jobs.find(j=>j.id===jobId);
    if(!job||!onUpdateJob) return;
    onUpdateJob(jobId, invoiceSentPatch(job));
  };

  const dismissCODoneTask = (jobId, coId) => {
    // Mark co as invoice-dismissed by adding to job's coDismissed set
    const job = jobs.find(j=>j.id===jobId);
    if(!job||!onUpdateJob) return;
    const dismissed = [...(job.coDoneDismissed||[]), coId];
    onUpdateJob(jobId, {coDoneDismissed: dismissed});
  };

  const dismissRTDoneTask = (jobId, rtId) => {
    const job = jobs.find(j=>j.id===jobId);
    if(!job||!onUpdateJob) return;
    const dismissed = [...(job.rtDoneDismissed||[]), rtId];
    onUpdateJob(jobId, {rtDoneDismissed: dismissed});
  };

  // Build a merged due-date map from all jobs' taskDueDates
  const allTaskDueDates = jobs.reduce((acc, j) => ({...acc, ...(j.taskDueDates||{})}), {});

  const autoTasks = computeTasks(jobs);
  const allTasks = [
    ...autoTasks.map(t => { const manual = allTaskDueDates[t.id]; return manual !== undefined ? {...t, dueDate: manual||t.dueDate||""} : t; }),
    ...(manualTasks||[]).map(t=>({...t,type:"manual"}))
  ].filter(t => t.category !== "prep" && (!filterForeman || t.foreman === filterForeman));

  // Sort: overdue first, then by dueDate, then undated
  const sorted = [...allTasks].sort((a,b) => {
    const ua = URGENCY(a.dueDate), ub = URGENCY(b.dueDate);
    if(ua&&ub) return ua.days - ub.days;
    if(ua) return -1; if(ub) return 1;
    return 0;
  });

  const foremanList = filterForeman ? [filterForeman] : [...["Koy","Vasa","Colby"],"Unassigned"];
  const totalCount = allTasks.length;
  const overdueCount = sorted.filter(t=>{ const u=URGENCY(t.dueDate); return u&&u.days<0; }).length;

  return (
    <div>
      {!compact&&!filterForeman&&(
        <div style={{padding:"24px 26px 16px",borderBottom:"1px solid var(--border)"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,flexWrap:"wrap"}}>
            <div>
              <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:28,letterSpacing:"0.06em",color:"var(--text)",lineHeight:1}}>TASKS</div>
              <div style={{display:"flex",gap:8,marginTop:4,flexWrap:"wrap"}}>
                <span style={{fontSize:11,color:"var(--dim)"}}>{totalCount} open</span>
                {overdueCount>0&&<span style={{fontSize:11,fontWeight:700,color:"#dc2626",background:"#dc262612",borderRadius:99,padding:"1px 8px",border:"1px solid #dc262633"}}>⚠ {overdueCount} overdue</span>}
              </div>
            </div>
            <button onClick={()=>setShowAdd(v=>!v)} style={{background:"var(--accent)",border:"none",borderRadius:9,color:"#000",fontWeight:800,padding:"9px 22px",fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>+ Add Task</button>
          </div>
        </div>
      )}

      <div style={{padding:filterForeman||compact?"0":"16px 26px"}}>
        {showAdd&&<AddTaskForm defaultForeman={filterForeman||"Koy"} onAdd={handleAdd} onCancel={()=>setShowAdd(false)}/>}

        {/* Ready to Invoice — filter to assigned foreman only (or all if no filter) */}
        {(()=>{
          const invoiceJobs = jobs.filter(j=>j.readyToInvoice&&(!filterForeman||(j.foreman||"Koy")===filterForeman));
          if(!invoiceJobs.length) return null;
          return (
            <div style={{marginBottom:24}}>
              <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12,paddingBottom:8,borderBottom:"2px solid #ea580c33"}}>
                <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:18,letterSpacing:"0.08em",color:"#ea580c"}}>READY TO INVOICE</div>
                <div style={{background:"#ea580c18",border:"1px solid #ea580c33",borderRadius:99,padding:"2px 10px",fontSize:11,color:"#ea580c",fontWeight:700}}>{invoiceJobs.length} job{invoiceJobs.length!==1?"s":""}</div>
              </div>
              {invoiceJobs.map(job=>{
                const foreman = job.foreman||"Koy";
                const fc = (({"Koy":"#3b82f6","Vasa":"#f97316","Colby":"#22c55e","Keegan":"#3b82f6","Gage":"#3b82f6","Daegan":"#3b82f6","Braden":"#22c55e","Treycen":"#22c55e","Jon":"#22c55e","Vasa":"#f97316","Abe":"#f97316","Louis":"#f97316","Jacob":"#6b7280"})[foreman]||"#6b7280")||"#6b7280";
                const isTP = job.tempPed;
                return (
                  <div key={job.id}
                    style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,
                      padding:"11px 14px",borderRadius:10,marginBottom:6,
                      background:"#ea580c08",border:"1px solid #ea580c33",borderLeft:"3px solid #ea580c"}}>
                    <div onClick={()=>onSelectJob(job)} style={{flex:1,cursor:"pointer"}}
                      onMouseEnter={e=>e.currentTarget.style.opacity="0.8"}
                      onMouseLeave={e=>e.currentTarget.style.opacity="1"}>
                      <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:2}}>
                        <span style={{fontSize:13,fontWeight:700,color:"var(--text)"}}>{job.name||"Untitled Job"}</span>
                        {isTP&&<span style={{fontSize:9,fontWeight:800,color:"#8b5cf6",background:"#8b5cf618",borderRadius:99,padding:"1px 6px",border:"1px solid #8b5cf633"}}>TEMP PED</span>}
                      </div>
                      <div style={{fontSize:11,color:"var(--dim)",display:"flex",gap:8}}>
                        {job.address&&<span>{job.address}</span>}
                        <span style={{fontWeight:700,color:fc}}>{foreman}</span>
                      </div>
                    </div>
                    <div style={{display:"flex",gap:8,alignItems:"center",flexShrink:0}}>
                      <button onClick={()=>onSelectJob(job)}
                        style={{fontSize:11,fontWeight:600,color:"#ea580c",background:"none",
                          border:"1px solid #ea580c44",borderRadius:7,padding:"5px 10px",
                          cursor:"pointer",fontFamily:"inherit",whiteSpace:"nowrap"}}>
                        Open →
                      </button>
                      <button onClick={()=>{ if(onUpdateJob) onUpdateJob(job.id, invoiceSentPatch(job)); }}
                        style={{fontSize:11,fontWeight:700,color:"#fff",background:"#ea580c",
                          border:"none",borderRadius:7,padding:"5px 14px",
                          cursor:"pointer",fontFamily:"inherit",whiteSpace:"nowrap"}}>
                        ✓ Invoice Sent
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })()}

        {/* Pre Job Prep tracker — all foremen */}
        {/* Pre Job Prep — always goes to Koy, hidden from other foremen */}
        {(!filterForeman || filterForeman==="Koy") && (()=>{
          return (
            <div style={{marginBottom:24}}>
              <PrepTaskList jobs={jobs} onSelectJob={onSelectJob} onUpdateJob={onUpdateJob}/>
            </div>
          );
        })()}

        {/* Tasks grouped by foreman */}
        {!filterForeman&&(
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}>
            <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:18,letterSpacing:"0.06em",color:"var(--dim)"}}>ALL TASKS</div>
            {!showAdd&&<button onClick={()=>setShowAdd(true)} style={{background:"none",border:"1px solid var(--border)",borderRadius:7,color:"var(--dim)",fontSize:11,padding:"5px 12px",cursor:"pointer",fontFamily:"inherit",fontWeight:600}}>+ Add Task</button>}
          </div>
        )}

        {totalCount===0&&(
          <div style={{textAlign:"center",padding:"40px 0",color:"var(--muted)"}}>
            <div style={{fontSize:22,marginBottom:6}}>✓</div>
            <div style={{fontSize:13}}>No open tasks{filterForeman?` for ${filterForeman}`:""}</div>
          </div>
        )}

        {filterForeman ? (
          // Flat list for foreman view
          <div>
            {filterForeman&&<div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
              <div style={{fontSize:11,fontWeight:700,color:"var(--dim)",letterSpacing:"0.06em"}}>TASKS</div>
              <button onClick={()=>setShowAdd(v=>!v)} style={{background:"none",border:"1px solid var(--border)",borderRadius:7,color:"var(--dim)",fontSize:11,padding:"4px 12px",cursor:"pointer",fontFamily:"inherit",fontWeight:600}}>+ Add Task</button>
            </div>}
            {showAdd&&filterForeman&&<AddTaskForm defaultForeman={filterForeman} onAdd={handleAdd} onCancel={()=>setShowAdd(false)}/>}
            {sorted.map(task=>(
              <TaskCard key={task.id} task={task} jobs={jobs} onSelectJob={onSelectJob}
                onDismiss={
                  task.type==="manual" ? ()=>dismissManual(task.id) :
                  task.category==="invoice" ? ()=>dismissInvoiceTask(task.jobId) :
                  task.id.endsWith("_done") && task.coId ? ()=>dismissCODoneTask(task.jobId, task.coId) :
                  task.id.endsWith("_done") && task.rtId ? ()=>dismissRTDoneTask(task.jobId, task.rtId) :
                  null
                }
                onSetDueDate={handleSetDueDate}/>
            ))}
          </div>
        ) : (
          // Grouped by foreman
          foremanList.map(f=>{
            const fc = (({"Koy":"#3b82f6","Vasa":"#f97316","Colby":"#22c55e","Keegan":"#3b82f6","Gage":"#3b82f6","Daegan":"#3b82f6","Braden":"#22c55e","Treycen":"#22c55e","Jon":"#22c55e","Vasa":"#f97316","Abe":"#f97316","Louis":"#f97316","Jacob":"#6b7280"})[f]||"#6b7280")||"#6b7280";
            const fTasks = sorted.filter(t=>t.foreman===f);
            const fOverdue = fTasks.filter(t=>{ const u=URGENCY(t.dueDate); return u&&u.days<0; }).length;
            if(fTasks.length===0) return null;
            const fCollapsed = !!collapsedForemen[f];
            return (
              <div key={f} style={{marginBottom:28}}>
                <div onClick={()=>toggleForeman(f)} style={{display:"flex",alignItems:"center",gap:8,marginBottom:fCollapsed?0:12,paddingBottom:8,borderBottom:`2px solid ${fc}33`,cursor:"pointer",userSelect:"none"}}>
                  <div style={{width:9,height:9,borderRadius:"50%",background:fc}}/>
                  <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:18,letterSpacing:"0.08em",color:fc}}>{f}</div>
                  <div style={{background:`${fc}18`,border:`1px solid ${fc}33`,borderRadius:99,padding:"1px 8px",fontSize:11,color:fc,fontWeight:700}}>{fTasks.length}</div>
                  {fOverdue>0&&<div style={{background:"#dc262618",border:"1px solid #dc262633",borderRadius:99,padding:"1px 8px",fontSize:11,color:"#dc2626",fontWeight:700}}>⚠ {fOverdue} overdue</div>}
                  <div style={{marginLeft:"auto",fontSize:12,color:fc,opacity:0.7,paddingRight:4}}>{fCollapsed?"▸":"▾"}</div>
                </div>
                {!fCollapsed&&fTasks.map(task=>(
                  <TaskCard key={task.id} task={task} jobs={jobs} onSelectJob={onSelectJob}
                    onDismiss={
                      task.type==="manual" ? ()=>dismissManual(task.id) :
                      task.category==="invoice" ? ()=>dismissInvoiceTask(task.jobId) :
                      task.id.endsWith("_done") && task.coId ? ()=>dismissCODoneTask(task.jobId, task.coId) :
                      task.id.endsWith("_done") && task.rtId ? ()=>dismissRTDoneTask(task.jobId, task.rtId) :
                      null
                    }
                    onSetDueDate={handleSetDueDate}/>
                ))}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ── Scheduling Forecast ───────────────────────────────────────

function SchedulingForecast({ jobs, onSelectJob }) {
  const [foremanTab, setForemanTab] = useState("All");
  const [viewMode,   setViewMode]   = useState("calendar"); // kanban | list | calendar
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

      // ── Rough ──
      if(rs&&rs!=="complete"&&rs!=="invoice") {
        const rsDef=getStatusDef(ROUGH_STATUSES,rs);
        const start=job.roughNeedsByStart||job.roughProjectedStart||job.roughStatusDate||"";
        const end=job.roughNeedsHardDate?"":job.roughNeedsByEnd||"";
        if(start||rs==="waiting_date"||rs==="date_confirmed") events.push({
          id:job.id+"_rough", job, type:"rough",
          label:"ROUGH", color:rsDef.color||C.rough, fc,
          startDate:start, endDate:end,
          hardDate:!!job.roughNeedsHardDate,
          status:rs, statusLabel:rsDef.label,
          desc:rsDef.label,
        });
      }

      // ── Finish ──
      if(fs&&fs!=="complete"&&fs!=="invoice") {
        const fsDef=getStatusDef(FINISH_STATUSES,fs);
        const start=job.finishNeedsByStart||job.finishProjectedStart||job.finishStatusDate||"";
        const end=job.finishNeedsHardDate?"":job.finishNeedsByEnd||"";
        if(start||fs==="waiting_date"||fs==="date_confirmed") events.push({
          id:job.id+"_finish", job, type:"finish",
          label:"FINISH", color:fsDef.color||C.finish, fc,
          startDate:start, endDate:end,
          hardDate:!!job.finishNeedsHardDate,
          status:fs, statusLabel:fsDef.label,
          desc:fsDef.label,
        });
      }

      // ── Return Trips ──
      (job.returnTrips||[]).filter(r=>!r.signedOff&&r.rtStatus!=="complete"&&(r.scope||r.rtStatus||r.needsByStart||r.rtStatusDate)).forEach((rt,i)=>{
        const start=rt.needsByStart||rt.rtStatusDate||rt.date||"";
        const end=rt.needsHardDate?"":rt.needsByEnd||"";
        const rtDef=getStatusDef(RT_STATUSES,rt.rtStatus||"needs");
        events.push({
          id:job.id+"_rt_"+rt.id, job, type:"rt",
          label:"RT "+(i+1), color:rtDef.color||"#8b5cf6", fc,
          startDate:start, endDate:end,
          hardDate:!!rt.needsHardDate,
          status:rt.rtStatus||"", statusLabel:rt.rtStatus||"needs scheduling",
          desc:rt.scope||"Return trip",
        });
      });

      // ── Change Orders ──
      (job.changeOrders||[]).filter(co=>co.coStatus&&co.coStatus!=="completed"&&co.coStatus!=="denied"&&co.coStatus!=="converted").forEach((co,i)=>{
        const start=co.needsByStart||co.coStatusDate||"";
        const end=co.needsHardDate?"":co.needsByEnd||"";
        const coDef=getStatusDef(CO_STATUSES_NEW,co.coStatus||"pending");
        events.push({
          id:job.id+"_co_"+co.id, job, type:"co",
          label:"CO "+(i+1), color:coDef.color||C.accent, fc,
          startDate:start, endDate:end,
          hardDate:!!co.needsHardDate,
          status:co.coStatus||"pending", statusLabel:coDef.label||co.coStatus,
          desc:co.desc||"Change order",
        });
      });

      // ── QC Walk ──
      if(job.roughQCTaskFired&&job.qcStatus&&job.qcStatus!=="complete") {
        const start=job.qcStatusDate||"";
        events.push({
          id:job.id+"_qc", job, type:"qc",
          label:"QC", color:getStatusDef(QC_STATUSES,job.qcStatus||"").color||C.teal, fc,
          startDate:start, endDate:"",
          hardDate:false,
          status:job.qcStatus, statusLabel:job.qcStatus,
          desc:"QC Walk",
        });
      }
    });
    return events;
  };

  const foremanTabs=["All",...getForemenList(),"Unassigned"];
  const filteredJobs=foremanTab==="All"?jobs
    :foremanTab==="Unassigned"?jobs.filter(j=>!j.foreman||j.foreman==="Unassigned")
    :jobs.filter(j=>(j.foreman||"Koy")===foremanTab);

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
          {(ev.startDate||ev.endDate)&&(
            <span style={{fontSize:10,fontWeight:700,color:over?C.red:"var(--dim)",marginLeft:"auto",
              background:ev.hardDate?"#dc262612":"transparent",
              borderRadius:6,padding:ev.hardDate?"2px 6px":"0",
              border:ev.hardDate?"1px solid #dc262633":"none"}}>
              {ev.hardDate?"🔒 ":ev.endDate?"📅 ":""}{fmtDate(ev.startDate)||""}{ev.endDate&&!ev.hardDate?" – "+(fmtDate(ev.endDate)||""):""}
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
    if(ev.endDate&&!ev.hardDate){
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
            {[{k:"kanban",l:"Kanban"},{k:"list",l:"List"},{k:"calendar",l:"📅 Calendar"}].map(({k,l})=>(
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
              :jobs.filter(j=>(j.foreman||"Koy")===f)
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

      {/* ── LIST ── */}
      {viewMode==="list"&&(()=>{
        const sorted=[...allEvents].sort((a,b)=>{
          if(!a.startDate&&!b.startDate) return 0;
          if(!a.startDate) return 1; if(!b.startDate) return -1;
          const da=parseAnyDate(a.startDate), db=parseAnyDate(b.startDate);
          return (da||0)-(db||0);
        });
        return (
          <div style={{padding:"20px 26px",maxWidth:900}}>
            {sorted.length===0&&<div style={{textAlign:"center",padding:"60px 0",color:"var(--muted)",fontSize:13}}>Nothing to schedule.</div>}
            {sorted.map(ev=><EventCard key={ev.id} ev={ev}/>)}
          </div>
        );
      })()}

      {/* ── CALENDAR ── */}
      {viewMode==="calendar"&&<CalendarView/>}
    </div>
  );
}

function SettingsPage({ COLOR_OPTIONS, onSave }) {
  const [foremen,       setForemen]       = useState([...getForemenList()]);
  const [foremanColors, setForemanColors] = useState({...FOREMEN_COLORS}); // eslint-disable-line
  const [leads,         setLeads]         = useState([...getLeadsList()]);
  const [leadColors,    setLeadColors]    = useState({...LEAD_COLORS});
  const [newForeman,    setNewForeman]    = useState("");
  const [newLead,       setNewLead]       = useState("");
  const [saved,         setSaved]         = useState(false);

  const save = async () => {
    await onSave(foremen, foremanColors, leads, leadColors);
    setSaved(true); setTimeout(()=>setSaved(false), 2000);
  };

  const Section = ({title, children}) => (
    <div style={{marginBottom:32}}>
      <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:20,letterSpacing:"0.08em",
        color:C.text,marginBottom:14,paddingBottom:8,borderBottom:`2px solid ${C.border}`}}>{title}</div>
      {children}
    </div>
  );

  const PersonRow = ({name, color, onColorChange, onDelete}) => (
    <div style={{display:"flex",alignItems:"center",gap:10,padding:"10px 14px",
      background:C.card,borderRadius:10,marginBottom:8,border:`1px solid ${C.border}`,
      borderLeft:`3px solid ${color}`}}>
      <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:18,letterSpacing:"0.06em",
        color:color,flex:1}}>{name}</div>
      <div style={{display:"flex",gap:5,flexWrap:"wrap",maxWidth:220}}>
        {COLOR_OPTIONS.map(col=>(
          <div key={col} onClick={()=>onColorChange(col)}
            style={{width:20,height:20,borderRadius:"50%",background:col,cursor:"pointer",
              border:col===color?"3px solid white":"2px solid transparent",
              boxShadow:col===color?`0 0 0 2px ${col}`:"none",flexShrink:0}}/>
        ))}
      </div>
      <button onClick={onDelete}
        style={{background:"none",border:"1px solid #dc262644",borderRadius:7,color:"#dc2626",
          fontSize:11,padding:"4px 10px",cursor:"pointer",fontFamily:"inherit",fontWeight:600,flexShrink:0}}>
        Remove
      </button>
    </div>
  );

  return (
    <div style={{padding:"24px 20px 60px",maxWidth:600,margin:"0 auto"}}>
      <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:28,letterSpacing:"0.08em",
        color:C.text,marginBottom:24}}>SETTINGS</div>

      <Section title="Foremen">
        {foremen.map(name=>(
          <PersonRow key={name} name={name} color={foremanColors[name]||"#6b7280"}
            onColorChange={col=>setForemanColors(fc=>({...fc,[name]:col}))}
            onDelete={()=>{ setForemen(f=>f.filter(x=>x!==name)); setForemanColors(fc=>{const n={...fc};delete n[name];return n;}); }}/>
        ))}
        <div style={{display:"flex",gap:8,marginTop:4}}>
          <input value={newForeman} onChange={e=>setNewForeman(e.target.value)}
            placeholder="New foreman name"
            onKeyDown={e=>{ if(e.key==="Enter"&&newForeman.trim()){ setForemen(f=>[...f,newForeman.trim()]); setForemanColors(fc=>({...fc,[newForeman.trim()]:"#6b7280"})); setNewForeman(""); }}}
            style={{flex:1,background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,
              padding:"8px 12px",fontSize:13,fontFamily:"inherit",color:C.text,outline:"none"}}/>
          <button onClick={()=>{ if(!newForeman.trim()) return; setForemen(f=>[...f,newForeman.trim()]); setForemanColors(fc=>({...fc,[newForeman.trim()]:"#6b7280"})); setNewForeman(""); }}
            style={{background:C.accent,border:"none",borderRadius:8,color:"#000",fontSize:13,
              fontWeight:700,padding:"8px 16px",cursor:"pointer",fontFamily:"inherit"}}>
            + Add
          </button>
        </div>
      </Section>

      <Section title="Leads">
        {leads.map(name=>(
          <PersonRow key={name} name={name} color={leadColors[name]||"#6b7280"}
            onColorChange={col=>setLeadColors(lc=>({...lc,[name]:col}))}
            onDelete={()=>{ setLeads(l=>l.filter(x=>x!==name)); setLeadColors(lc=>{const n={...lc};delete n[name];return n;}); }}/>
        ))}
        <div style={{display:"flex",gap:8,marginTop:4}}>
          <input value={newLead} onChange={e=>setNewLead(e.target.value)}
            placeholder="New lead name"
            onKeyDown={e=>{ if(e.key==="Enter"&&newLead.trim()){ setLeads(l=>[...l,newLead.trim()]); setLeadColors(lc=>({...lc,[newLead.trim()]:"#6b7280"})); setNewLead(""); }}}
            style={{flex:1,background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,
              padding:"8px 12px",fontSize:13,fontFamily:"inherit",color:C.text,outline:"none"}}/>
          <button onClick={()=>{ if(!newLead.trim()) return; setLeads(l=>[...l,newLead.trim()]); setLeadColors(lc=>({...lc,[newLead.trim()]:"#6b7280"})); setNewLead(""); }}
            style={{background:C.accent,border:"none",borderRadius:8,color:"#000",fontSize:13,
              fontWeight:700,padding:"8px 16px",cursor:"pointer",fontFamily:"inherit"}}>
            + Add
          </button>
        </div>
      </Section>

      <button onClick={save}
        style={{width:"100%",background:saved?"#16a34a":C.accent,border:"none",borderRadius:10,
          color:saved?"#fff":"#000",fontSize:15,fontWeight:700,padding:"14px",
          cursor:"pointer",fontFamily:"inherit",transition:"background 0.3s"}}>
        {saved?"✓ Saved!":"Save Changes"}
      </button>
    </div>
  );
}

function App() {
  // Homeowner page route — ?homeowner=JOB_ID
  const hoParam = new URLSearchParams(window.location.search).get("homeowner");
  if(hoParam) return <HomeownerPage jobId={hoParam}/>;

  // ── Identity ──────────────────────────────────────────────────
  const [identity, setIdentity] = useState(()=>getIdentity());
  const authMode = identity ? "office" : "locked"; // compat for remaining authMode refs
  const setAuthMode = () => {}; // no-op legacy compat

  // ── Users (team members) — loaded from Firestore ─────────────
  const [users, setUsers] = useState(DEFAULT_USERS);

  useEffect(()=>{
    getDoc(doc(db,"settings","users")).then(snap=>{
      if(snap.exists()&&snap.data().list?.length) {
        setUsers(snap.data().list);
      }
    }).catch(()=>{});
  },[]);

  const saveUsers = async (list) => {
    setUsers(list);
    // If current identity was removed or role changed, update it
    if(identity) {
      const updated = list.find(u=>u.id===identity.id);
      if(updated) { saveIdentity(updated); setIdentity(updated); }
    }
    try { await setDoc(doc(db,"settings","users"),{list}); } catch(e){ console.error(e); }
  };

  // ── Settings (foremen + leads) ─────────────────────────────
  const [_foremen,        set_foremen]        = useState(DEFAULT_FOREMEN);
  const [_foremanColors,  set_foremanColors]  = useState(DEFAULT_FOREMEN_COLORS);
  const [_leads,          set_leads]          = useState(DEFAULT_LEADS);
  const [_leadColors,     set_leadColors]     = useState(DEFAULT_LEAD_COLORS);

  // Sync S object after state settles (not during render)
  useEffect(()=>{
    FOREMEN=_foremen; FOREMEN_COLORS=_foremanColors;
    LEADS=_leads; LEAD_COLORS=_leadColors;
  },[_foremen,_foremanColors,_leads,_leadColors]);

  useEffect(()=>{
    getDoc(doc(db,"settings","main")).then(snap=>{
      if(snap.exists()){
        const d = snap.data();
        const f  = d.foremen       || DEFAULT_FOREMEN;
        const fc = d.foremanColors || DEFAULT_FOREMEN_COLORS;
        const l  = d.leads         || DEFAULT_LEADS;
        const lc = d.leadColors    || DEFAULT_LEAD_COLORS;
        FOREMEN=f; FOREMEN_COLORS=fc; LEADS=l; LEAD_COLORS=lc;
        set_foremen(f); set_foremanColors(fc); set_leads(l); set_leadColors(lc);
      }
    });
  },[]);

  const saveSettings = async(foremen, foremanColors, leads, leadColors) => {
    await setDoc(doc(db,"settings","main"),{foremen,foremanColors,leads,leadColors});
    FOREMEN=foremen; FOREMEN_COLORS=foremanColors; LEADS=leads; LEAD_COLORS=leadColors;
    set_foremen(foremen); set_foremanColors(foremanColors);
    set_leads(leads); set_leadColors(leadColors);
  };

  // submitPin removed — replaced by UserPicker identity system

  const [jobs,     setJobs]     = useState([]);
  const [upcoming, setUpcoming] = useState([]);
  const [manualTasks, setManualTasks] = useState([]);

  const [selected, setSelected] = useState(null);

  const [search,   setSearch]   = useState("");

  const [stageF,   setStageF]   = useState("All");

  const [flagOnly, setFlagOnly] = useState(false);

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

          const loaded = migrate(snap.docs.map(d=>d.data().data).filter(Boolean));

          // One-time fix v2: clear tempPed:true from any job that has a foreman assigned
          // Real temp peds never have a foreman — they're standalone cards
          const TEMPPED_FIX_KEY = "heTempPedFixed_v3";
          if(!localStorage.getItem(TEMPPED_FIX_KEY)) {
            const toFix = loaded.filter(j => j.tempPed === true && j.foreman && j.foreman !== "");
            if(toFix.length > 0) {
              toFix.forEach(job => {
                const fixed = {...job, tempPed:false, hasTempPed: job.hasTempPed||false};
                setDoc(doc(db,"jobs",job.id),{data:sanitize(fixed),updated_at:new Date().toISOString()}).catch(()=>{});
              });
              console.log(`[HE] v3: Cleared tempPed flag from ${toFix.length} job(s) with foreman assigned`);
            }
            localStorage.setItem(TEMPPED_FIX_KEY,"1");
          }

          setJobs(loaded);

          // Never overwrite the selected job from snapshot — JobDetail manages its own state

          // Just keep the jobs list in sync for the home screen

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

    return () => { unsub(); unsubUpcoming(); unsubTasks(); }; // cleanup on unmount

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

      saveTimers.current[job.id] = null;

      try {

        await setDoc(doc(db,"jobs",job.id),{data:sanitize(job),updated_at:new Date().toISOString()});

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

  const flushJob = async (job) => {
    if(!job) return;
    clearTimeout(saveTimers.current[job.id]);
    try { await setDoc(doc(db,"jobs",job.id),{data:sanitize(job),updated_at:new Date().toISOString()}); } catch(e){}
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

    jobsRef.current.forEach(job=>{

      clearTimeout(saveTimers.current[job.id]);

      setDoc(doc(db,"jobs",job.id),{data:sanitize(job),updated_at:new Date().toISOString()}).catch(e=>console.error(e));

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

  const complete   = jobs.filter(j=>parseStage(j.finishStage)===100).length;

  const pendingCOs = jobs.reduce((a,j)=>a+(j.changeOrders||[]).filter(c=>c.coStatus!=="completed"&&c.coStatus!=="denied"&&c.coStatus!=="converted").length,0);

  const syncColor  = {idle:C.muted,saving:C.accent,saved:C.green,error:C.red}[syncStatus];

  const syncLabel  = {idle:"All changes saved",saving:"Saving…",saved:"✓ Saved",error:"Save failed"}[syncStatus];



  // view: "home" = main page, "foreman" = foreman-specific page

  const [view, setView] = useState("home");
  const [activeForeman, setActiveForeman] = useState(null);

  const openForeman  = (f) => { setActiveForeman(f); setView("foreman");   setSearch(""); setStageF("All"); setFlagOnly(false); };
  const [crewView, setCrewView] = useState(null); // foreman name or null
  const goHome       = () =>  { setView("home");     setActiveForeman(null); setSearch(""); setStageF("All"); setFlagOnly(false); };
  const openSchedule = () =>  { setView("schedule"); setActiveForeman(null); setSearch(""); setStageF("All"); setFlagOnly(false); };
  const openUpcoming = () =>  { setView("upcoming"); setActiveForeman(null); setSearch(""); setStageF("All"); setFlagOnly(false); };
  const openTasks    = () =>  { setView("tasks");    setActiveForeman(null); setSearch(""); setStageF("All"); setFlagOnly(false); };
  const openSettings = () =>  { setView("settings"); setActiveForeman(null); setSearch(""); setStageF("All"); setFlagOnly(false); };





  const viewJobs = view==="foreman" ? jobs.filter(j=>activeForeman==="Unassigned"?(!j.foreman||j.foreman==="Unassigned"):(j.foreman||"Koy")===activeForeman) : jobs;



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

    const qcItems = countQCFloor(job.qcPunch?.upper) + countQCFloor(job.qcPunch?.main) + countQCFloor(job.qcPunch?.basement);

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
              <div style={{marginTop:4,fontSize:12,color:"#dc2626",fontWeight:700}}>
                Projected Start - {job.roughProjectedStart}
              </div>
            )}
          </div>

          <div style={{flex:"1 1 190px",minWidth:150}}>
            <div style={{fontSize:9,color:C.finish,marginBottom:4,fontWeight:700,letterSpacing:"0.1em"}}>FINISH</div>
            <StageBar stages={FINISH_STAGES} current={job.finishStage} color={C.finish}/>
            {job.finishProjectedStart&&(
              <div style={{marginTop:4,fontSize:12,color:"#dc2626",fontWeight:700}}>
                Projected Start - {job.finishProjectedStart}
              </div>
            )}
          </div>

          <div style={{display:"flex",gap:5,flexWrap:"wrap",alignItems:"center"}}>

            {hasRT&&<Pill label="Return trip needed" color="#dc2626"/>}
            {prepAlert&&<Pill label="Redline plans need update" color="#dc2626"/>}
            {hasRTSch&&!hasRT&&<Pill label="Return trip scheduled" color="#8b5cf6"/>}
            {rs&&!(rs==="complete"&&fs&&fs!=="waiting_date"&&fs!=="date_confirmed")&&<Pill label={rs==="scheduled"&&job.roughStatusDate?"Rough: "+job.roughStatusDate:rs==="date_confirmed"&&job.roughStatusDate?"Rough: "+job.roughStatusDate:("Rough: "+(getStatusDef(ROUGH_STATUSES,rs).label||rs))} color={getStatusDef(ROUGH_STATUSES,rs).color||C.dim}/>}
            {fs&&<Pill label={fs==="scheduled"&&job.finishStatusDate?"Finish: "+job.finishStatusDate:("Finish: "+(getStatusDef(FINISH_STATUSES,fs).label||fs))} color={getStatusDef(FINISH_STATUSES,fs).color||C.dim}/>}
            {open>0   &&<Pill label={`${open} open`} color={C.red}/>}

            {pendCO>0 &&<Pill label={`${pendCO} CO`} color={C.orange}/>}

            {pendRT>0 &&<Pill label={`${pendRT} return trip${pendRT>1?'s':''}`} color={C.red}/>}

            {qcItems>0&&<Pill label={`${qcItems} QC`} color={C.red}/>}

            {(job.uploadedFiles||[]).length>0&&<Pill label={`${job.uploadedFiles.length} files`} color={C.green}/>}

          </div>

          <div style={{display:"flex",alignItems:"center",gap:6,marginLeft:"auto",flexShrink:0}}>

            {_foremen.filter(f=>f!==foreman).map(f2=>(

              <button key={f2} onClick={e=>{e.stopPropagation();updateJob({...job,foreman:f2});}}

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
    return <UserPicker users={users} onSelect={m => { saveIdentity(m); setIdentity(m); }} />;
  }



  return (

    <div style={{minHeight:"100vh",background:C.bg,fontFamily:"'DM Sans',sans-serif",color:C.text,position:"relative"}}>

      <div style={{position:"fixed",inset:0,backgroundImage:"url(/icon-192.png)",

        backgroundRepeat:"no-repeat",backgroundPosition:"center center",

        backgroundSize:"320px 320px",opacity:0.15,pointerEvents:"none",zIndex:0}}/>



      {/* ── TOP NAV BAR ── */}
      <div style={{display:"flex",gap:6,padding:"8px 10px",borderBottom:`1px solid ${C.border}`,background:C.card,position:"sticky",top:0,zIndex:90,overflowX:"auto",scrollbarWidth:"none",alignItems:"center"}}>
        {[{key:"home",label:"Job Board"},{key:"schedule",label:"Forecast"},{key:"upcoming",label:"Upcoming"},{key:"tasks",label:"Tasks"},...(can(identity,"settings.view")?[{key:"settings",label:"⚙ Settings"}]:[])].map(({key,label})=>{
          const active = view===key;
          return (
            <button key={key} onClick={key==="home"?goHome:key==="schedule"?openSchedule:key==="upcoming"?openUpcoming:key==="tasks"?openTasks:openSettings}
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
            {identity.name} · {ROLE_LABELS[identity.role]||identity.role}
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

        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=Bebas+Neue&display=swap');

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
              </div>

            </div>
          </div>



          <div style={{padding:"28px 26px"}}>

            <div style={{fontSize:10,color:C.dim,fontWeight:800,letterSpacing:"0.14em",marginBottom:14,textTransform:"uppercase"}}>Pipeline Overview</div>

            {(()=>{

              const prepJobs = jobs.filter(j=>{const r=parseStage(j.roughStage);return r===0;});

              const nsJobs   = [];

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
                const fc    = _foremanColors[f];
                const fJobs = jobs.filter(j=>(j.foreman||"Koy")===f);
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
                      {jobs.filter(j=>(j.foreman||"Koy")===crewView).length} jobs
                    </div>
                  </div>
                  <button onClick={()=>setCrewView(null)}
                    style={{background:"none",border:`1px solid ${C.border}`,borderRadius:8,
                      color:C.dim,fontSize:16,width:34,height:34,cursor:"pointer",
                      display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
                </div>

                {/* Lead-grouped job cards */}
                {(()=>{
                  const crewJobs = jobs.filter(j=>(j.foreman||"Koy")===crewView);
                  const fc2 = _foremanColors[crewView]||"#6b7280";
                  if(crewJobs.length===0) return (
                    <div style={{textAlign:"center",color:C.dim,padding:"60px 0",fontSize:13}}>
                      No jobs assigned to {crewView}
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
                            job.tempPed
                              ? <TempPedCard key={job.id} job={job} onOpen={(j)=>setSelected(j)} onUpdate={(updated)=>{ setJobs(js=>js.map(j=>j.id===updated.id?updated:j)); saveJob(updated); }}/>
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
              <StageSectionList jobs={jobs} JobRow={JobRow} TempPedCard={TempPedCard} onSelectJob={(j)=>setSelected(j)} onSaveJob={(updated)=>{ setJobs(js=>js.map(j=>j.id===updated.id?updated:j)); saveJob(updated); }} onDeleteJob={(id)=>deleteJob(id)} startCollapsed={true}/>
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

                {jobs.filter(j=>activeForeman==="Unassigned"?(!j.foreman||j.foreman==="Unassigned"):(j.foreman||"Koy")===activeForeman).length} job sites

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

                const fJobs = jobs.filter(j=>activeForeman==="Unassigned"?(!j.foreman||j.foreman==="Unassigned"):(j.foreman||"Koy")===activeForeman);

                const fDone = fJobs.filter(j=>parseStage(j.finishStage)===100).length;

                const fPrep    = fJobs.filter(j=>{const r=parseStage(j.roughStage);return r===0;}).length;

                const fRough   = fJobs.filter(j=>parseInt(j.roughStage)>0&&parseInt(j.roughStage)<100&&parseInt(j.finishStage)===0).length;

                const fBetween = fJobs.filter(j=>parseInt(j.roughStage)===100&&parseInt(j.finishStage)===0).length;

                const fFinish  = fJobs.filter(j=>parseInt(j.finishStage)>0&&parseInt(j.finishStage)<100).length;

                const fNotStarted = 0;

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

                  style={{background:_foremanColors[activeForeman]||"#6b7280",border:"none",borderRadius:9,color:"#000",

                    fontWeight:700,padding:"10px 24px",fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>

                  + Add First Job

                </button>

              </div>

            ):(

              <>
              {/* Tasks + Prep mini-card for this foreman, tabbed for Koy */}
              {(()=>{
                const isKoy = activeForeman === "Koy";
                const fTasks = computeTasks(jobs)
                  .filter(t=>t.foreman===activeForeman && t.category!=="prep")
                  .concat((manualTasks||[]).filter(t=>t.foreman===activeForeman));
                const prepTasks = computeTasks(jobs).filter(t=>t.foreman==="Koy"&&t.category==="prep");
                const totalCount = isKoy ? fTasks.length + prepTasks.length : fTasks.length;
                if(totalCount===0&&!isKoy) return null;
                if(totalCount===0&&isKoy&&prepTasks.length===0) return null;

                return (
                  <ForemanTaskCard
                    isKoy={isKoy}
                    fTasks={fTasks}
                    prepTasks={prepTasks}
                    jobs={jobs}
                    manualTasks={manualTasks}
                    onManualTasksChange={(next)=>{ next.forEach(t=>{ if(!manualTasks.find(m=>m.id===t.id)) saveManualTask(t); }); manualTasks.forEach(t=>{ if(!next.find(m=>m.id===t.id)) deleteManualTask(t.id); }); setManualTasks(next); }}
                    onSelectJob={(job)=>setSelected(job)}
                    onUpdateJob={(jobId,patch)=>{ const job=jobs.find(j=>j.id===jobId); if(job) updateJob({...job,...patch}); }}
                    activeForeman={activeForeman}
                  />
                );
              })()}
              <StageSectionList jobs={filtered} JobRow={JobRow} TempPedCard={TempPedCard} onSelectJob={(j)=>setSelected(j)} onSaveJob={(updated)=>{ setJobs(js=>js.map(j=>j.id===updated.id?updated:j)); saveJob(updated); }} onDeleteJob={(id)=>deleteJob(id)} fc={_foremanColors[activeForeman]} startCollapsed={false}/>
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
                        <button onClick={()=>{ updateJob({...job,...invoiceSentPatch(job)}); }}
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



      {selected&&(selected.tempPed
        ? <TempPedDetail key={selected.id} job={selected} onUpdate={updateJob} onClose={()=>setSelected(null)}/>
        : <JobDetail key={selected.id} job={selected} onUpdate={updateJob} onClose={()=>setSelected(null)}/>)}

      {view==="schedule"&&can(identity,"schedule.view")&&(
        <SchedulingForecast jobs={jobs} canEdit={can(identity,"schedule.edit")} onSelectJob={(job)=>setSelected(job)}/>
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
          onUpdateJob={(jobId,patch)=>{ const job=jobs.find(j=>j.id===jobId); if(job) updateJob({...job,...patch}); }}
        />
      )}

      {view==="upcoming"&&can(identity,"pipeline.view")&&(
        <UpcomingJobs
          upcoming={upcoming}
          canManage={can(identity,"pipeline.manage")}
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
            j.name=u.name||""; j.address=u.city||""; j.gc=u.customer||""; j.foreman="";
            setJobs(js=>[j,...js]); setSelected(j); setUpcoming(prev=>prev.filter(x=>x.id!==u.id));
            setView("home"); saveJob(j); deleteUpcomingItem(u.id);
          }}
        />
      )}

      {view==="settings"&&can(identity,"settings.view")&&(
        <div>
          <SettingsPage
            COLOR_OPTIONS={COLOR_OPTIONS}
            onSave={saveSettings}
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
