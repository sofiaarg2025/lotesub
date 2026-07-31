'use strict';

const APP_VERSION = '2.0.0';
const DB_NAME = 'ot-mtto-gestion-db';
const DB_VERSION = 1;
const OPEN_STATUSES = ['PENDIENTE','PROGRAMADO','EN PROCESO','EN COMPRA','STAND BY','PAUSADO'];
const CLOSED_STATUSES = ['FINALIZADO','CERRADO','COMPLETADO'];
const DEFAULT_SETTINGS = {
  id: 'app',
  userName: 'Administrador local',
  role: 'Administrador',
  statuses: ['PENDIENTE','PROGRAMADO','EN PROCESO','EN COMPRA','STAND BY','FINALIZADO'],
  types: ['CORRECTIVO','PREVENTIVO','MEJORA'],
  criticalities: ['A','B','C'],
  seeded: false
};

const state = {
  db: null,
  orders: [],
  audit: [],
  settings: {...DEFAULT_SETTINGS},
  filtered: [],
  view: 'dashboard',
  orderScope: 'active',
  selected: new Set(),
  sort: {key:'date', dir:'desc'},
  page: 1,
  pageSize: 20,
  editingId: null,
  detailId: null,
  charts: {},
  deferredInstallPrompt: null,
  pendingAttachments: []
};

const $ = (id) => document.getElementById(id);
const $$ = (selector, root=document) => [...root.querySelectorAll(selector)];
const uid = () => crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const todayISO = () => new Date().toISOString().slice(0,10);
const norm = (v='') => String(v ?? '').trim().replace(/\s+/g,' ').toUpperCase();
const normalizePerson = (v='') => String(v ?? '').trim().replace(/\s+/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
const esc = (v='') => String(v ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const fmtNumber = (v, digits=0) => new Intl.NumberFormat('es-AR',{maximumFractionDigits:digits,minimumFractionDigits:digits}).format(Number(v)||0);
const fmtDate = (v) => {
  if(!v) return '—';
  const d = new Date(`${String(v).slice(0,10)}T12:00:00`);
  return Number.isNaN(d.getTime()) ? String(v) : new Intl.DateTimeFormat('es-AR').format(d);
};
const fmtDateTime = (v) => {
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '—' : new Intl.DateTimeFormat('es-AR',{dateStyle:'short',timeStyle:'short'}).format(d);
};
const daysBetween = (a,b) => {
  if(!a || !b) return null;
  const d1 = new Date(`${String(a).slice(0,10)}T12:00:00`), d2 = new Date(`${String(b).slice(0,10)}T12:00:00`);
  if(Number.isNaN(d1.getTime()) || Number.isNaN(d2.getTime())) return null;
  return Math.max(0, Math.round((d2-d1)/86400000));
};
const isClosed = (o) => CLOSED_STATUSES.includes(norm(o.status));
const ageDays = (o) => daysBetween(o.date, isClosed(o) ? (o.completionDate || o.updatedAt?.slice(0,10) || todayISO()) : todayISO()) ?? 0;
const isOverdue = (o) => !isClosed(o) && o.dueDate && o.dueDate < todayISO();
const toNumber = (v) => {
  if(typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const s = String(v ?? '').replace(/\./g,'').replace(',','.').replace(/[^0-9.-]/g,'');
  return Number(s) || 0;
};
const unique = (arr) => [...new Set(arr.filter(Boolean))].sort((a,b)=>String(a).localeCompare(String(b),'es'));
const downloadBlob = (blob, filename) => {
  const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href=url; a.download=filename; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1500);
};

function toast(message, type='default', timeout=3500){
  const el=document.createElement('div'); el.className=`toast ${type}`; el.innerHTML=`<span>${esc(message)}</span><button aria-label="Cerrar">✕</button>`;
  el.querySelector('button').onclick=()=>el.remove(); $('toastRegion').appendChild(el); setTimeout(()=>el.remove(),timeout);
}

function openDB(){
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(DB_NAME,DB_VERSION);
    req.onupgradeneeded=()=>{
      const db=req.result;
      if(!db.objectStoreNames.contains('orders')) db.createObjectStore('orders',{keyPath:'id'});
      if(!db.objectStoreNames.contains('audit')) db.createObjectStore('audit',{keyPath:'id'});
      if(!db.objectStoreNames.contains('settings')) db.createObjectStore('settings',{keyPath:'id'});
    };
    req.onsuccess=()=>resolve(req.result); req.onerror=()=>reject(req.error);
  });
}
function tx(store, mode='readonly'){return state.db.transaction(store,mode).objectStore(store)}
function idbGetAll(store){return new Promise((res,rej)=>{const r=tx(store).getAll();r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
function idbGet(store,key){return new Promise((res,rej)=>{const r=tx(store).get(key);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
function idbPut(store,value){return new Promise((res,rej)=>{const r=tx(store,'readwrite').put(value);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
function idbDelete(store,key){return new Promise((res,rej)=>{const r=tx(store,'readwrite').delete(key);r.onsuccess=()=>res();r.onerror=()=>rej(r.error)})}
function idbClear(store){return new Promise((res,rej)=>{const r=tx(store,'readwrite').clear();r.onsuccess=()=>res();r.onerror=()=>rej(r.error)})}
async function idbBulkPut(store,values){
  return new Promise((res,rej)=>{const tr=state.db.transaction(store,'readwrite');const s=tr.objectStore(store);values.forEach(v=>s.put(v));tr.oncomplete=()=>res();tr.onerror=()=>rej(tr.error)});
}

async function audit(action, order, details){
  const item={id:uid(),ts:new Date().toISOString(),action,orderId:order?.id||'',ot:order?.ot||'',user:state.settings.userName,role:state.settings.role,details};
  await idbPut('audit',item); state.audit.unshift(item); renderAudit();
}

function demoOrders(){
  const now=new Date(); const ago=(days)=>new Date(now.getTime()-days*86400000).toISOString().slice(0,10); const ahead=(days)=>new Date(now.getTime()+days*86400000).toISOString().slice(0,10);
  const base=[
    ['2601',ago(3),ahead(2),'EVISCERADO','NORIA DE EVISCERADO','CORRECTIVO','A','EN PROCESO','Revisar sincronización y tensión de cadena de la noria.','Mariano Torres','D. Sensano',4,2],
    ['2602',ago(12),ago(4),'PELADO','REPASADORA 2','CORRECTIVO','A','PENDIENTE','Reparar motor y verificar sistema de transmisión de la repasadora.','Mariano Torres','',6,0],
    ['2603',ago(18),ago(2),'SALA DE CHILLER','PRE-CHILLER','MEJORA','B','EN COMPRA','Instalar alarma de comunicación entre pre-chiller y chiller.','Lautaro Alveira','',10,0],
    ['2604',ago(32),ago(20),'SUBPRODUCTO','DIGESTOR DE PLUMAS','CORRECTIVO','A','FINALIZADO','Reparar pérdida de vapor en la tapa frontal del digestor.','Fernando Caro','H. Sandoval',8,9],
    ['2605',ago(45),ago(30),'COLGADO','LAVADORA DE JAULAS','PREVENTIVO','B','FINALIZADO','Realizar mantenimiento preventivo integral de bombas y filtros.','Lautaro Alveira','P. Rodríguez',12,11],
    ['2606',ago(67),ago(40),'CLASIFICADO','GRADER','CORRECTIVO','B','FINALIZADO','Revisar ficha y conexión eléctrica de balanza del grader.','Mariano Torres','M. Reyes',3,2],
    ['2607',ago(95),ago(80),'SALA DE TROZADO','TERMOEMPAQUETADORA','CORRECTIVO','A','STAND BY','Cambiar cintas superior e inferior de la cuchilla de sellado.','Mariano Torres','',5,0],
    ['2608',ago(8),ahead(7),'SALA DE MENUDO','EMBOLSADORA DE MENUDOS','CORRECTIVO','B','PROGRAMADO','Revisar burlete de la mordaza y asegurar su fijación.','Lautaro Alveira','P. Kempa',2,0],
    ['2609',ago(120),ago(115),'SUBPRODUCTO','MOLINO DE PLUMAS','PREVENTIVO','C','FINALIZADO','Inspeccionar rodamientos, lubricación y estado general.','Fernando Caro','O. Pacheco',7,6],
    ['2610',ago(2),ahead(1),'HARINA','EXTRACTOR','CORRECTIVO','A','PENDIENTE','Poner en marcha el extractor del sector de harina.','Fernando Caro','',3,0],
    ['2611',ago(150),ago(142),'PELADO','REPASADORA 2','CORRECTIVO','B','FINALIZADO','Cambiar correa y alinear cabezal del motor 3.','Mariano Torres','M. Reyes',4,4],
    ['2612',ago(210),ago(202),'PELADO','REPASADORA 2','CORRECTIVO','B','FINALIZADO','Reparar juego en el cabezal del motor 3.','Mariano Torres','M. Reyes',5,6]
  ];
  return base.map((r,i)=>({id:uid(),ot:r[0],date:r[1],dueDate:r[2],sector:r[3],equipment:r[4],assetCode:`EQ-${String(i+1).padStart(3,'0')}`,requester:'Producción',type:r[5],criticality:r[6],status:r[7],description:r[8],supervisor:r[9],executor:r[10],plannedHours:r[11],actualHours:r[12],completionDate:CLOSED_STATUSES.includes(r[7])?r[2]:'',comments:'',attachments:[],archived:false,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}));
}

async function init(){
  try{
    state.db=await openDB();
    state.settings={...DEFAULT_SETTINGS,...(await idbGet('settings','app')||{})};
    state.orders=await idbGetAll('orders'); state.audit=(await idbGetAll('audit')).sort((a,b)=>b.ts.localeCompare(a.ts));
    if(!state.orders.length && !state.settings.seeded){
      state.orders=demoOrders(); await idbBulkPut('orders',state.orders); state.settings.seeded=true; await idbPut('settings',state.settings);
      await audit('DATOS_DEMO',null,'Se cargaron datos de demostración iniciales.');
    }
    bindEvents(); applySettingsToUI(); await refreshAll(); registerPWA(); $('storageStatus').textContent=`${state.orders.length} OTs · v${APP_VERSION}`;
  }catch(err){console.error(err);toast('No se pudo iniciar la base local. Revise los permisos del navegador.','error',7000);$('storageStatus').textContent='Error de almacenamiento';}
}

document.addEventListener('DOMContentLoaded',init);

function bindEvents(){
  $$('.nav-item[data-view],.bottom-item[data-view]').forEach(b=>b.addEventListener('click',()=>switchView(b.dataset.view)));
  $('menuBtn').onclick=()=> $('sidebar').classList.toggle('open');
  $('toggleFiltersBtn').onclick=()=> $('filtersPanel').classList.toggle('open');
  ['fDateFrom','fDateTo','fSector','fEquipment','fType','fStatus','fCriticality','fSupervisor','fExecutor','fAge'].forEach(id=>$(id).addEventListener('change',()=>{state.page=1;refreshAll()}));
  $('globalSearch').addEventListener('input',debounce(()=>{state.page=1;refreshAll()},220));
  $('resetFiltersBtn').onclick=resetFilters;
  ['newOtBtn','ordersNewBtn','mobileNewBtn'].forEach(id=>$(id).onclick=()=>openOtForm());
  $('dashboardRefreshBtn').onclick=refreshAll;
  $('importInput').addEventListener('change',e=>importFile(e.target.files[0]).finally(()=>e.target.value=''));
  $('exportExcelBtn').onclick=exportExcel; $('exportCsvBtn').onclick=exportCSV; $('printDashboardBtn').onclick=()=>{switchView('dashboard');setTimeout(()=>window.print(),150)}; $('backupBtn').onclick=backupJSON; $('settingsBackupBtn').onclick=backupJSON;
  $('restoreInput').addEventListener('change',e=>restoreBackup(e.target.files[0]).finally(()=>e.target.value=''));
  $('exportAuditBtn').onclick=exportAudit;
  $('loadDemoBtn').onclick=loadDemoData; $('clearDataBtn').onclick=clearAllData;
  $('saveUserSettingsBtn').onclick=saveUserSettings; $('saveCatalogsBtn').onclick=saveCatalogs;
  $('otForm').addEventListener('submit',saveOrderFromForm); $('otAttachments').addEventListener('change',handleAttachments);
  $$('[data-close-dialog]').forEach(b=>b.onclick=()=>$(b.dataset.closeDialog).close());
  $('detailEditBtn').onclick=()=>{const id=state.detailId;$('detailDialog').close();openOtForm(id)};
  $('bulkStatusBtn').onclick=()=>openBulkStatus(); $('bulkArchiveBtn').onclick=bulkArchive;
  $('bulkStatusForm').addEventListener('submit',applyBulkStatus);
  $('selectAllOrders').addEventListener('change',toggleSelectAll);
  $('prevPageBtn').onclick=()=>{state.page=Math.max(1,state.page-1);renderOrders()};
  $('nextPageBtn').onclick=()=>{state.page++;renderOrders()};
  $('pageSize').onchange=()=>{state.pageSize=Number($('pageSize').value);state.page=1;renderOrders()};
  $$('.segment[data-order-scope]').forEach(b=>b.onclick=()=>{state.orderScope=b.dataset.orderScope;state.page=1;state.selected.clear();$$('.segment').forEach(x=>x.classList.toggle('active',x===b));renderOrders()});
  $$('th[data-sort]').forEach(th=>th.onclick=()=>sortOrders(th.dataset.sort));
  $('notifyBtn').onclick=requestNotifications;
  window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();state.deferredInstallPrompt=e;$('installBtn').classList.remove('hidden')});
  $('installBtn').onclick=installApp;
}
