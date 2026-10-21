// Runs the current receiver derivations, never a copied implementation.
// Covers new imports and existing rows without writing a job or bridge record.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'App.js'), 'utf8');
const start = src.indexOf('// ── ccloads SUGGEST derivations');
const end = src.indexOf('// ── end ccloads SUGGEST derivations');
if (start < 0 || end < start) throw new Error('Receiver derivation markers missing');
const ctx = vm.createContext({});
vm.runInContext(src.slice(start, end), ctx);
const {ccLightingMeta, ccLightingRow, ccLightingLabel, ccMethodLabel, ccWallboxLabel,
  ccKeypadLabel, ccWallboxSystemOrder, ccLoadDest, ccLoadImportRows, ccWallboxImportRows,
  ccLoadSyncPlan, ccKeypadRowFields, ccKeypadPrefillPlan, ccKeypadFillPatch,
  ccLoadReconcileRemovals} = ctx;
let checks = 0;
const plain = value => JSON.parse(JSON.stringify(value));
const eq = (label, actual, expected) => { checks++; assert.deepStrictEqual(plain(actual), plain(expected), label); };
const ok = (label, condition) => { checks++; assert.ok(condition, label); };
const floors = ['Main Level', 'Basement', 'Upper Level'];
const c4 = {lightingSystem:'control4',c4Collection:'contemporary'};
const field = (patch = {}) => ({id:'f1',loadId:'001',name:'Cans',room:'Kitchen',floor:'Main Level',method:'wallbox',control:'dimmer',...c4,...patch});
const applyAuto = (row, plan) => ({...row,...(plan.auto.find(p => p.id === row.id)?.patch || {})});

// Explicit metadata wins; partial/older publishers never erase known choices.
eq('validated C4 metadata only', ccLightingMeta({...c4, office:{confirmed:true}, by:'other'}), c4);
eq('source Lutron clears obsolete Control4 collection', ccLightingMeta({lightingSystem:'lutron'}, c4), {lightingSystem:'lutron',c4Collection:null});
eq('partial C4 source retains previous collection', ccLightingMeta({lightingSystem:'control4'},c4), c4);
eq('unknown collection retains valid previous collection', ccLightingMeta({lightingSystem:'control4',c4Collection:'unrecognized'},c4), c4);
eq('unknown source retains saved system', ccLightingMeta({lightingSystem:'unknown'},c4), c4);
eq('missing source retains saved metadata', ccLightingMeta(null,c4), c4);
eq('unrecognized values do not manufacture metadata', ccLightingMeta({lightingSystem:'unknown',c4Collection:'lux'}), {});
eq('first C4 record without collection does not invent one', ccLightingMeta({lightingSystem:'control4'}), {lightingSystem:'control4'});
eq('Lutron fallback remains Lutron', ccLightingMeta({}, {lightingSystem:'lutron',c4Collection:'lux'}), {lightingSystem:'lutron',c4Collection:null});
eq('raw C4 method label', ccMethodLabel(field()), 'Control4 Contemporary');
eq('Lux label', ccLightingLabel({lightingSystem:'control4',c4Collection:'lux'}), 'Control4 Lux');
eq('C4 collection unknown label', ccLightingLabel({lightingSystem:'control4'}), 'Control4');
eq('legacy system absent keeps prior RA3 label', ccLightingLabel({}), 'RA3');
eq('explicit Lutron label', ccLightingLabel({lightingSystem:'lutron'}), 'RA3');
eq('standard never relabeled as smart system', ccWallboxLabel(field({method:'switch'})), 'Standard');
eq('panel role stays panel', ccMethodLabel(field({method:'panel'})), 'Panel');
eq('tape role stays tape', ccMethodLabel(field({method:'tape'})), 'Tape');
eq('unknown method remains update-required', ccMethodLabel({control:'dimmer',...c4}), 'Update FieldInk');

// Routing remains physical-method based, independent of manufacturer.
const inputs = [field(),field({id:'standard',method:'switch'}),field({id:'panel',method:'panel',control:'panel'}),field({id:'tape',method:'tape',tapeFt:25})];
eq('routes physical methods', inputs.map(ccLoadDest), ['wallbox','wallbox','loads','loads']);
let ids = 0;
const wb = ccWallboxImportRows(inputs,[],()=>`w${++ids}`,floors).rows;
const panels = ccLoadImportRows(inputs,[],()=>({id:`p${++ids}`}),floors).rows;
eq('wallbox only imports wallbox and standard', wb.map(r=>r.fieldLoadId), ['f1','standard']);
eq('panel list only imports panel and tape', panels.map(r=>r.fieldLoadId), ['panel','tape']);
for (const row of [...wb,...panels]) {
 eq('import retains system '+row.id, ccLightingMeta(row),c4);
 ok('import snapshot retains existing description-only shape '+row.id, Object.keys(row.fieldSnap).sort().join(',')==='location,name,room');
}
eq('tape retains feet and LED type', {feet:panels[1].tapeFt,type:panels[1].loadType}, {feet:25,type:'LED'});
eq('repeat wallbox import is idempotent', ccWallboxImportRows(inputs,wb,()=> 'duplicate',floors).rows, []);
eq('repeat panel import is idempotent', ccLoadImportRows(inputs,panels,()=>({id:'duplicate'}),floors).rows, []);
eq('removed field row cannot import', ccWallboxImportRows([field({removedAt:100})],[],()=> 'removed',floors).rows, []);

// Existing office values, including fields absent from FieldInk, are sacrosanct.
const legacy = {id:'w-old',fieldLoadId:'f1',origin:'fieldink',name:'Kitchen Cans',room:'Kitchen',location:'Main Level',device:'Switch',method:'wallbox',pulled:true,pulledBy:'Crew',pulledAt:'2026-10-20',assign:{panelId:'P',moduleId:'M',zone:2},watts:88,fieldSnap:{name:'Kitchen Cans',room:'Kitchen',location:'Main Level'}};
const frozen = JSON.stringify(legacy);
const projected = ccLightingRow(legacy,field());
eq('legacy row display sees live C4',ccWallboxLabel(projected),'Control4 Contemporary');
eq('projection leaves original unchanged',JSON.stringify(legacy),frozen);
for(const key of ['name','room','location','device','method','pulled','pulledBy','pulledAt','assign','watts','fieldSnap']) eq('projection preserves office '+key, projected[key],legacy[key]);
const hydration = ccLoadSyncPlan([legacy],{f1:field()},floors,'wallbox');
eq('metadata-only sync has one automatic patch',hydration.auto.length,1);
eq('metadata-only sync adds no manual prompt',hydration.manual,[]);
eq('metadata-only patch only carries metadata',hydration.auto[0].patch,c4);
const hydrated = applyAuto(legacy,hydration);
eq('metadata hydration is idempotent',ccLoadSyncPlan([hydrated],{f1:field()},floors,'wallbox'),{auto:[],manual:[]});
eq('missing bridge does not clear metadata',ccLoadSyncPlan([hydrated],{},floors,'wallbox'),{auto:[],manual:[]});
eq('older publisher does not clear metadata',ccLoadSyncPlan([hydrated],{f1:field({lightingSystem:undefined,c4Collection:undefined})},floors,'wallbox'),{auto:[],manual:[]});
const lutron = ccLoadSyncPlan([hydrated],{f1:field({lightingSystem:'lutron',c4Collection:undefined})},floors,'wallbox');
eq('explicit Lutron transition clears saved C4 collection',lutron.auto[0].patch,{lightingSystem:'lutron',c4Collection:null});
eq('explicit Lutron transition becomes stable',ccLoadSyncPlan([applyAuto(hydrated,lutron)],{f1:field({lightingSystem:'lutron'})},floors,'wallbox'),{auto:[],manual:[]});
eq('wrong destination does not auto-update',ccLoadSyncPlan([legacy],{f1:field()},floors,'loads'),{auto:[],manual:[]});
eq('removed row does not auto-update metadata',ccLoadSyncPlan([legacy],{f1:field({removedAt:100})},floors,'wallbox'),{auto:[],manual:[]});

// Metadata hydration must not swallow an existing manual field-change prompt.
for (const withSnapshot of [true,false]) {
 const row={...legacy,name:'Office custom name'}; if(!withSnapshot)delete row.fieldSnap;
 const inbox={f1:field({name:'New field name'})};
 const first=ccLoadSyncPlan([row],inbox,floors,'wallbox');
 eq('manual name change exists before metadata hydration '+withSnapshot,first.manual[0].changes.map(c=>c.key),['name']);
 const updated=applyAuto(row,first);
 eq('office custom name survives hydration '+withSnapshot,updated.name,'Office custom name');
 eq('metadata hydration preserves snapshot presence '+withSnapshot,Object.prototype.hasOwnProperty.call(updated,'fieldSnap'),withSnapshot);
 const second=ccLoadSyncPlan([updated],inbox,floors,'wallbox');
 eq('manual name change still pending after metadata hydration '+withSnapshot,second.manual[0].changes.map(c=>c.key),['name']);
 eq('metadata second pass does not loop '+withSnapshot,second.auto,[]);
}
const mixedRow={...legacy,name:'Office custom name'};
const mixedInbox={f1:field({name:'New field name',room:'Dining',floor:'Upper Level'})};
const mixedPlan=ccLoadSyncPlan([mixedRow],mixedInbox,floors,'wallbox');
const mixedUpdated=applyAuto(mixedRow,mixedPlan);
eq('mixed auto room and floor follow field', {room:mixedUpdated.room,location:mixedUpdated.location},{room:'Dining',location:'Upper Level'});
eq('snapshot name does not advance past manual decision',mixedUpdated.fieldSnap.name,legacy.fieldSnap.name);
eq('manual name remains offered after other fields auto-update',ccLoadSyncPlan([mixedUpdated],mixedInbox,floors,'wallbox').manual[0].changes.map(c=>c.key),['name']);

// Explicit systems/collections get separate order counts; standard remains independent.
const order=ccWallboxSystemOrder([
 {...projected,device:'Dimmer'}, {...projected,id:'lux',c4Collection:'lux',device:'Switch'},
 {...legacy,id:'ra3',lightingSystem:'lutron',device:'Dimmer'},
 {...projected,id:'standard',method:'switch',device:'Switch'},null,{name:'',method:'wallbox'}]);
eq('mixed systems never pooled into RA3 totals',order,[{label:'Control4 Contemporary',Dimmer:1,Switch:0},{label:'Control4 Lux',Dimmer:0,Switch:1},{label:'RA3',Dimmer:1,Switch:0},{label:'Standard',Dimmer:0,Switch:1}]);

// Existing/confirmed keypads display live metadata without refilling office rows.
const keypad={label:'Entry keypad',kpType:'ra3',room:'Kitchen',sheet:'E1',floor:'Main Level',assigned:[{key:'f1',loadId:'001'}],...c4,office:{confirmed:true,confirmedBy:'Office',engraving:{f1:'Dinner'}}};
const kpFields=ccKeypadRowFields('kp1',keypad,{f1:field()});
eq('new keypad retains system/collection',ccLightingMeta(kpFields),c4);
eq('C4 ra3 storage-type labels Control4',ccKeypadLabel(kpFields),'Control4 Contemporary keypad');
eq('C4 panel role preserved in label',ccKeypadLabel({...kpFields,kpType:'panel'}),'Control4 Contemporary panel keypad');
eq('legacy panel role unchanged',ccKeypadLabel({kpType:'panel'}),'Panel keypad');
eq('keypad joins remain intact',kpFields.assigned[0].name,'Kitchen Cans');
const kpPlan=ccKeypadPrefillPlan({kp1:keypad},{f1:field()},{},floors,{});
const filled=ccKeypadFillPatch({},kpPlan,n=>({id:'kp-office',num:n,status:''}));
eq('new fill preserves metadata',ccLightingMeta(filled.mainKeypad[0]),c4);
const oldKp={...filled.mainKeypad[0],name:'Office engraving/name',status:'Pulled',pulledBy:'Crew'};delete oldKp.lightingSystem;delete oldKp.c4Collection;
const confirmed={mainKeypad:[oldKp],confirmedKeypads:{mainKeypad:true},other:'Keep'};
const before=JSON.stringify(confirmed);
const noRefill=ccKeypadPrefillPlan({kp1:keypad,kp2:{...keypad,label:'New keypad'}},{f1:field()},confirmed,floors,{});
eq('already imported confirmed keypad not refilled',noRefill.already,['kp1']);
eq('new keypad cannot overwrite confirmed section',noRefill.locked,['kp2']);
eq('confirmed fill patch writes nothing',ccKeypadFillPatch(confirmed,noRefill,()=>({id:'bad'})),{});
const display=ccLightingRow(oldKp,keypad);
eq('existing confirmed keypad shows current Control4',ccKeypadLabel(display),'Control4 Contemporary keypad');
eq('confirmed keypad office name/status preserved', {name:display.name,status:display.status,pulledBy:display.pulledBy},{name:oldKp.name,status:oldKp.status,pulledBy:oldKp.pulledBy});
eq('confirmed source section unchanged',JSON.stringify(confirmed),before);
eq('bridge confirmation and engraving untouched',keypad.office,{confirmed:true,confirmedBy:'Office',engraving:{f1:'Dinner'}});
eq('saved keypad metadata used without bridge',ccKeypadLabel(ccLightingRow(kpFields,null)),'Control4 Contemporary keypad');
eq('keypad explicit Lutron beats prior C4',ccKeypadLabel(ccLightingRow(kpFields,{lightingSystem:'lutron'})),'RA3 keypad');

// Removal/restoration keeps metadata and existing office work with the row.
const removed=ccLoadReconcileRemovals({wallboxDevices:[hydrated]},{f1:{...field(),removedAt:100,fieldUpdatedAt:101}},'wallboxDevices');
eq('removed row archived',removed.pl.wallboxDevices,[]);
eq('archive retains metadata',ccLightingMeta(removed.pl.fieldRemovedWallboxDevices[hydrated.id].load),c4);
const restored=ccLoadReconcileRemovals(removed.pl,{f1:{...field(),removedAt:null,fieldUpdatedAt:102}},'wallboxDevices');
eq('restore preserves whole original office row',restored.pl.wallboxDevices[0],hydrated);

// Guard important adapter hookups, where helper-only tests cannot catch a stale UI.
ok('wallbox derives current bridge metadata',/const list =[^\n]*ccLightingRow\(r, inboxById\[r.fieldLoadId\]\)/.test(src));
ok('filled keypad derives current bridge metadata',/const display = ccLightingRow\(row, kp\)/.test(src));
ok('filled keypad badge uses derived display',src.includes('ccKeypadLabel(display)'));
ok('inbox keypad badge uses system-aware label',src.includes('ccKeypadLabel(kp)'));
ok('wallbox count tiles use system-aware totals',src.includes('ccWallboxSystemOrder(list)'));
console.log(`ccloads-control4-test: ${checks} checks passed`);
