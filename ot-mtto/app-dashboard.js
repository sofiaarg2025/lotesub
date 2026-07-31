function debounce(fn,ms){let t;return(...args)=>{clearTimeout(t);t=setTimeout(()=>fn(...args),ms)}}

function switchView(view){
  state.view=view; $$('.view').forEach(v=>v.classList.toggle('active',v.id===`view-${view}`));
  $$('.nav-item[data-view],.bottom-item[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===view));
  $('sidebar').classList.remove('open');
  if(view==='dashboard') renderDashboard(); if(view==='orders') renderOrders(); if(view==='assets') renderAssets(); if(view==='people') renderPeople(); if(view==='audit') renderAudit(); if(view==='settings') renderSettings();
  window.scrollTo({top:0,behavior:'smooth'});
}

function getFilters(){return {from:$('fDateFrom').value,to:$('fDateTo').value,sector:$('fSector').value,equipment:$('fEquipment').value,type:$('fType').value,status:$('fStatus').value,criticality:$('fCriticality').value,supervisor:$('fSupervisor').value,executor:$('fExecutor').value,age:$('fAge').value,q:norm($('globalSearch').value)}}
function getFilteredOrders(includeArchived=false){
  const f=getFilters();
  return state.orders.filter(o=>{
    if(!includeArchived && o.archived) return false;
    if(f.from && o.date<f.from) return false; if(f.to && o.date>f.to) return false;
    if(f.sector && norm(o.sector)!==norm(f.sector)) return false; if(f.equipment && norm(o.equipment)!==norm(f.equipment)) return false;
    if(f.type && norm(o.type)!==norm(f.type)) return false; if(f.status && norm(o.status)!==norm(f.status)) return false;
    if(f.criticality && norm(o.criticality)!==norm(f.criticality)) return false; if(f.supervisor && norm(o.supervisor)!==norm(f.supervisor)) return false; if(f.executor && norm(o.executor)!==norm(f.executor)) return false;
    const age=ageDays(o); if(f.age==='0-7' && age>7) return false; if(f.age==='8-30' && (age<8||age>30)) return false; if(f.age==='31-90' && (age<31||age>90)) return false; if(f.age==='90+' && age<=90) return false;
    if(f.q){const hay=norm([o.ot,o.date,o.sector,o.equipment,o.assetCode,o.requester,o.type,o.description,o.criticality,o.status,o.supervisor,o.executor,o.comments].join(' '));if(!hay.includes(f.q)) return false;}
    return true;
  });
}

async function refreshAll(){
  state.filtered=getFilteredOrders(false); populateFilterOptions(); renderSummary();
  if(state.view==='dashboard') renderDashboard(); if(state.view==='orders') renderOrders(); if(state.view==='assets') renderAssets(); if(state.view==='people') renderPeople(); if(state.view==='audit') renderAudit();
  $('storageStatus').textContent=`${state.orders.length} OTs · v${APP_VERSION}`;
}
function renderSummary(){const total=state.filtered.length;const open=state.filtered.filter(o=>!isClosed(o)).length;$('resultSummary').textContent=`${total} órdenes · ${open} abiertas`;$('resultSummary').title='Resultado de los filtros';}

function populateFilterOptions(){
  const preserve={};['fSector','fEquipment','fType','fStatus','fCriticality','fSupervisor','fExecutor'].forEach(id=>preserve[id]=$(id).value);
  setOptions('fSector',unique(state.orders.map(o=>o.sector)),'Todos'); setOptions('fEquipment',unique(state.orders.map(o=>o.equipment)),'Todos');
  setOptions('fType',unique([...state.settings.types,...state.orders.map(o=>norm(o.type))]),'Todos'); setOptions('fStatus',unique([...state.settings.statuses,...state.orders.map(o=>norm(o.status))]),'Todos');
  setOptions('fCriticality',unique([...state.settings.criticalities,...state.orders.map(o=>norm(o.criticality))]),'Todas'); setOptions('fSupervisor',unique(state.orders.map(o=>normalizePerson(o.supervisor))),'Todos'); setOptions('fExecutor',unique(state.orders.map(o=>normalizePerson(o.executor))),'Todos');
  Object.entries(preserve).forEach(([id,v])=>{if([...$(id).options].some(o=>o.value===v))$(id).value=v});
  setDatalist('sectorList',unique(state.orders.map(o=>o.sector))); setDatalist('equipmentList',unique(state.orders.map(o=>o.equipment))); setDatalist('peopleList',unique(state.orders.flatMap(o=>[o.requester,o.supervisor,o.executor]).map(normalizePerson)));
  populateOrderSelects();
}
function setOptions(id,values,first){const el=$(id);el.innerHTML=`<option value="">${first}</option>${values.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('')}`}
function setDatalist(id,values){$(id).innerHTML=values.map(v=>`<option value="${esc(v)}"></option>`).join('')}
function populateOrderSelects(){
  const sets=[['otType',state.settings.types],['otStatus',state.settings.statuses],['otCriticality',state.settings.criticalities],['bulkNewStatus',state.settings.statuses]];
  sets.forEach(([id,vals])=>{const current=$(id).value;$(id).innerHTML=vals.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('');if(vals.includes(current))$(id).value=current});
}
function resetFilters(){['fDateFrom','fDateTo','fSector','fEquipment','fType','fStatus','fCriticality','fSupervisor','fExecutor','fAge','globalSearch'].forEach(id=>$(id).value='');state.page=1;refreshAll()}
function setFilterAndOrders(filter,value){const map={status:'fStatus',type:'fType',criticality:'fCriticality',sector:'fSector',equipment:'fEquipment'};if(map[filter])$(map[filter]).value=value;state.page=1;switchView('orders');refreshAll()}

function groupCount(arr,keyFn){const m=new Map();arr.forEach(x=>{const k=keyFn(x)||'Sin dato';m.set(k,(m.get(k)||0)+1)});return [...m.entries()].sort((a,b)=>b[1]-a[1])}
function average(nums){const v=nums.filter(n=>Number.isFinite(n));return v.length?v.reduce((a,b)=>a+b,0)/v.length:0}
function mttr(orders){return average(orders.filter(isClosed).map(o=>daysBetween(o.date,o.completionDate)).filter(n=>n!==null))}
function mtbf(orders){
  const dates=orders.filter(o=>norm(o.type)==='CORRECTIVO').map(o=>o.date).filter(Boolean).sort(); if(dates.length<2)return 0;
  const gaps=[];for(let i=1;i<dates.length;i++)gaps.push(daysBetween(dates[i-1],dates[i]));return average(gaps);
}
function availabilityEstimate(orders){const down=orders.reduce((s,o)=>s+(Number(o.actualHours)||0),0);const dates=orders.map(o=>o.date).filter(Boolean).sort();const span=Math.max(1,dates.length?daysBetween(dates[0],todayISO()):365);return Math.max(0,100-(down/(span*24))*100)}

function renderDashboard(){
  const orders=state.filtered;const total=orders.length;const closed=orders.filter(isClosed);const open=orders.filter(o=>!isClosed(o));const overdue=open.filter(isOverdue);const urgent=open.filter(o=>norm(o.criticality)==='A');const avgAge=average(open.map(ageDays));const closure=total?closed.length/total*100:0;const planned=orders.reduce((s,o)=>s+(Number(o.plannedHours)||0),0);const actual=orders.reduce((s,o)=>s+(Number(o.actualHours)||0),0);const preventive=orders.filter(o=>norm(o.type)==='PREVENTIVO');const preventiveOnTime=preventive.filter(o=>isClosed(o)&&(!o.dueDate||!o.completionDate||o.completionDate<=o.dueDate)).length;const preventiveCompliance=preventive.length?preventiveOnTime/preventive.length*100:0;
  const kpis=[
    ['Total de OT',total,'Órdenes emitidas','☷','var(--blue)'],['OT abiertas',open.length,`${overdue.length} vencidas`,'⚠','var(--red)'],['Tasa de cierre',`${fmtNumber(closure,1)}%`,`${closed.length} finalizadas`,'✓','var(--green)'],['Edad promedio',`${fmtNumber(avgAge,0)} d`,'De las OT abiertas','◷','var(--orange)'],['Urgentes abiertas',urgent.length,'Criticidad A','!','var(--red)'],['MTTR',`${fmtNumber(mttr(orders),1)} d`,'Tiempo medio de reparación','⌁','var(--purple)'],['Cumpl. preventivo',`${fmtNumber(preventiveCompliance,1)}%`,`${preventiveOnTime}/${preventive.length||0} en término`,'▣','var(--green)'],['Horas reales',fmtNumber(actual,1),`${fmtNumber(planned,1)} h planificadas`,'◴','var(--blue)'],['Sectores',unique(orders.map(o=>o.sector)).length,'Con actividad','⌂','var(--purple)'],['Equipos',unique(orders.map(o=>o.equipment)).length,'Activos involucrados','⚙','var(--orange)'],['Correctivos',orders.filter(o=>norm(o.type)==='CORRECTIVO').length,'Órdenes por falla','↯','var(--red)'],['Reincidentes',countRecurrentEquipment(orders),'Equipos con 2+ correctivos','↺','var(--orange)']
  ];
  $('kpiGrid').innerHTML=kpis.map(k=>`<article class="kpi-card" style="--accent:${k[4]}"><div class="kpi-top"><span class="kpi-label">${k[0]}</span><span class="kpi-icon">${k[3]}</span></div><div class="kpi-value">${k[1]}</div><div class="kpi-foot">${k[2]}</div></article>`).join('');
  renderAlerts(open,overdue,urgent); renderCharts(orders); renderInsights(orders,{open,overdue,urgent,closure,avgAge,actual,planned,preventiveCompliance});
}
function countRecurrentEquipment(orders){return groupCount(orders.filter(o=>norm(o.type)==='CORRECTIVO'),o=>norm(o.equipment)).filter(x=>x[1]>=2).length}
function renderAlerts(open,overdue,urgent){
  const a=[];if(urgent.length)a.push(`<div class="alert danger"><span>⚠</span><div><strong>${urgent.length} OT urgentes abiertas</strong><small>Requieren priorización por criticidad A.</small></div></div>`);
  if(overdue.length)a.push(`<div class="alert warning"><span>◷</span><div><strong>${overdue.length} OT vencidas</strong><small>${overdue.filter(o=>ageDays(o)>90).length} superan 90 días de antigüedad.</small></div></div>`);
  if(!open.length)a.push(`<div class="alert info"><span>✓</span><div><strong>Sin backlog en el filtro actual</strong><small>No hay órdenes abiertas para los criterios seleccionados.</small></div></div>`);
  $('alertsPanel').innerHTML=a.join('');
}
function chartColors(n){const base=['#b30000','#2563eb','#16803a','#d97706','#7c3aed','#64748b','#0f766e','#be185d'];return Array.from({length:n},(_,i)=>base[i%base.length])}
function destroyChart(id){if(state.charts[id]){state.charts[id].destroy();delete state.charts[id]}}
function makeChart(id,config){destroyChart(id);const canvas=$(id);if(!canvas||typeof Chart==='undefined')return;state.charts[id]=new Chart(canvas.getContext('2d'),config)}
function renderCharts(orders){
  const months=new Map();orders.forEach(o=>{const m=(o.date||'').slice(0,7)||'Sin fecha';if(!months.has(m))months.set(m,{issued:0,closed:0,open:0});const x=months.get(m);x.issued++;isClosed(o)?x.closed++:x.open++});const monthLabels=[...months.keys()].sort();
  makeChart('monthlyChart',{type:'line',data:{labels:monthLabels,datasets:[{label:'Emitidas',data:monthLabels.map(m=>months.get(m).issued),borderColor:'#2563eb',backgroundColor:'rgba(37,99,235,.12)',tension:.3,fill:true},{label:'Finalizadas',data:monthLabels.map(m=>months.get(m).closed),borderColor:'#16803a',tension:.3},{label:'Abiertas',data:monthLabels.map(m=>months.get(m).open),borderColor:'#b30000',tension:.3}]},options:chartOptions({onClick:(e,els)=>{if(!els.length)return;const m=monthLabels[els[0].index];$('fDateFrom').value=`${m}-01`;$('fDateTo').value=lastDayOfMonth(m);switchView('orders');refreshAll()}})});
  const status=groupCount(orders,o=>norm(o.status));donutChart('statusChart',status,(label)=>setFilterAndOrders('status',label));
  const types=groupCount(orders,o=>norm(o.type));donutChart('typeChart',types,(label)=>setFilterAndOrders('type',label));
  const crit=groupCount(orders,o=>norm(o.criticality));donutChart('criticalityChart',crit,(label)=>setFilterAndOrders('criticality',label));
  const ages=[['0–7',0],['8–30',0],['31–90',0],['>90',0]];orders.filter(o=>!isClosed(o)).forEach(o=>{const d=ageDays(o);ages[d<=7?0:d<=30?1:d<=90?2:3][1]++});barChart('ageChart',ages,'Antigüedad',null,true);
  const sectors=groupCount(orders.filter(o=>!isClosed(o)),o=>o.sector).slice(0,10);barChart('sectorBacklogChart',sectors,'Abiertas',label=>setFilterAndOrders('sector',label),true);
  const equipment=groupCount(orders.filter(o=>norm(o.type)==='CORRECTIVO'),o=>o.equipment).slice(0,10);barChart('equipmentChart',equipment,'Correctivos',label=>setFilterAndOrders('equipment',label),true);
  const hp=groupCount(orders,o=>(o.date||'').slice(0,7)).slice().sort((a,b)=>a[0].localeCompare(b[0])).slice(-12).map(([m])=>m);const planned=hp.map(m=>orders.filter(o=>(o.date||'').startsWith(m)).reduce((s,o)=>s+(Number(o.plannedHours)||0),0));const actual=hp.map(m=>orders.filter(o=>(o.date||'').startsWith(m)).reduce((s,o)=>s+(Number(o.actualHours)||0),0));
  makeChart('hoursChart',{type:'bar',data:{labels:hp,datasets:[{label:'Planificadas',data:planned,backgroundColor:'#94a3b8'},{label:'Reales',data:actual,backgroundColor:'#b30000'}]},options:chartOptions()});
}
function chartOptions(extra={}){return {responsive:true,maintainAspectRatio:false,interaction:{mode:'nearest',intersect:false},plugins:{legend:{position:'bottom',labels:{boxWidth:10,font:{size:10}}},tooltip:{callbacks:{label:(ctx)=>`${ctx.dataset.label||ctx.label}: ${fmtNumber(ctx.parsed.y??ctx.parsed,1)}`}}},scales:{x:{ticks:{font:{size:9},maxRotation:45,minRotation:0},grid:{display:false}},y:{beginAtZero:true,ticks:{precision:0,font:{size:9}},grid:{color:'#eef1f4'}}},...extra}}
function donutChart(id,data,onClick){makeChart(id,{type:'doughnut',data:{labels:data.map(x=>x[0]),datasets:[{data:data.map(x=>x[1]),backgroundColor:chartColors(data.length),borderWidth:2,borderColor:'#fff'}]},options:{responsive:true,maintainAspectRatio:false,cutout:'62%',plugins:{legend:{position:'bottom',labels:{boxWidth:10,font:{size:9}}}},onClick:(e,els)=>{if(els.length&&onClick)onClick(data[els[0].index][0])}}})}
function barChart(id,data,label,onClick,horizontal=false){makeChart(id,{type:'bar',data:{labels:data.map(x=>x[0]),datasets:[{label,data:data.map(x=>x[1]),backgroundColor:chartColors(data.length),borderRadius:5}]},options:chartOptions({indexAxis:horizontal?'y':'x',onClick:(e,els)=>{if(els.length&&onClick)onClick(data[els[0].index][0])}})})}
function lastDayOfMonth(ym){const [y,m]=ym.split('-').map(Number);return new Date(y,m,0).toISOString().slice(0,10)}
function renderInsights(orders,m){
  const list=[];const sector=groupCount(m.open,o=>o.sector)[0];const eq=groupCount(orders.filter(o=>norm(o.type)==='CORRECTIVO'),o=>o.equipment)[0];
  if(sector)list.push(['Mayor backlog',`${sector[0]} concentra ${sector[1]} órdenes abiertas.`]);if(eq)list.push(['Equipo más recurrente',`${eq[0]} registra ${eq[1]} correctivos en el período.`]);
  list.push(['Tasa de cierre',`${fmtNumber(m.closure,1)}%. ${m.closure>=85?'Nivel favorable.':'Conviene reforzar el cierre del backlog.'}`]);
  list.push(['Antigüedad',`La edad promedio de las órdenes abiertas es ${fmtNumber(m.avgAge,0)} días.`]);
  if(m.planned)list.push(['Desvío de horas',`Se ejecutaron ${fmtNumber(m.actual,1)} h frente a ${fmtNumber(m.planned,1)} h planificadas (${fmtNumber((m.actual/m.planned)*100,1)}%).`]);
  list.push(['Preventivos',`Cumplimiento estimado en término: ${fmtNumber(m.preventiveCompliance,1)}%.`]);
  $('executiveInsights').innerHTML=list.map(x=>`<div class="insight"><strong>${esc(x[0])}</strong><p>${esc(x[1])}</p></div>`).join('');
}
