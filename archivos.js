// ── ARCHIVOS: lo que queda guardado de cada uno (sus condiciones y sus planes de batalla de cada semana).
// Cada uno ve los suyos; quien está por encima (y quien ve todo el equipo) ve también los de su gente.
const AR={persona:leeLS('ar_persona','')};
const arGuarda=()=>guardaLS('ar_persona',AR.persona);
const lunesDe=d=>pbIso(d,-((new Date(d+'T12:00:00Z').getUTCDay()+6)%7));

function renderArchivos(wrap){const box=ce('div','ar');wrap.appendChild(box);const yo=S.yo.id,V=verEst();
 if(AR.persona&&AR.persona!=='*'&&!V.some(m=>m.id===AR.persona)){AR.persona='';arGuarda();}
 if(AR.persona==='*'&&V.length<2){AR.persona='';arGuarda();}
 const tabs=()=>V.length>1?`<div class="es-tabs ar-tabs"><button type="button" data-p="" class="${!AR.persona?'on':''}">Yo</button><button type="button" data-p="*" class="${AR.persona?'on':''}">${veTodo()?'Todo el equipo':'Mi equipo'}</button></div>`:'';
 const tabsOn=()=>box.querySelectorAll('.ar-tabs button').forEach(b=>b.onclick=()=>{if(AR.persona===b.dataset.p)return;AR.persona=b.dataset.p;arGuarda();pinta1();});
 const pinta1=()=>{if(AR.persona==='*')return gente();carpeta(AR.persona||yo);};
 // La gente cuyos archivos puedes ver
 const gente=()=>{const L=V.filter(m=>m.id!==yo);
  box.innerHTML=tabs()+`<div class="rp-c pb-eq">${L.map(m=>`<button type="button" class="pb-eqf" data-p="${m.id}" style="padding-left:${Math.min(3,m._niv||0)*12}px">${avHTML(m)}<span class="tx"><b>${escH(m.nombre)}</b>${pTag(m)}</span><svg class="ar-car" viewBox="0 0 24 24"><path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2.2h7a2 2 0 0 1 2 2v7.8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/></svg><svg class="chev" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg></button>`).join('')}</div>`;
  tabsOn();box.querySelectorAll('[data-p]').forEach(b=>{if(b.closest('.ar-tabs'))return;b.onclick=()=>{AR.persona=b.dataset.p;arGuarda();pinta1();window.scrollTo(0,0);};});};
 // La carpeta de una persona
 const carpeta=async p=>{const m=M(p)||{nombre:'—'},yoMismo=p===yo;
  const cabH=`${tabs()}${yoMismo?'':`<button type="button" class="pb-vol"><svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg>${veTodo()?'Todo el equipo':'Mi equipo'}</button>`}
   <div class="ar-cab">${avHTML(m)}<div><small>Archivos</small><b>${yoMismo?'Tus archivos':escH(m.nombre)}</b>${pTag(m)}</div></div>`;
  box.innerHTML=cabH+'<div class="rp-c" style="color:var(--mut);font-size:13px">Cargando…</div>';const on=()=>{tabsOn();const v=box.querySelector('.pb-vol');if(v)v.onclick=()=>{AR.persona='*';arGuarda();pinta1();};};on();
  const desde=new Date(Date.now()-26*7*864e5).toISOString();
  const [c,t,pe]=await Promise.all([sb.from('pb_condiciones').select('id,persona,est_nombre,semana,condicion,para,creado').eq('persona',p).order('semana',{ascending:false}).limit(200),
   sb.from('pb_tareas').select('id,texto,hecha_en,dia').eq('persona',p).eq('hecha',true).gte('hecha_en',desde).order('hecha_en'),
   sb.from('pb_tareas').select('id,texto,dia').eq('persona',p).eq('hecha',false).lte('dia',hoyMad()).order('dia')]);
  if(!box.isConnected||(AR.persona||yo)!==p)return;
  if(c.error||t.error){box.innerHTML=cabH+'<div class="rp-c">No se ha podido cargar. Vuelve a intentarlo.</div>';on();return;}
  const C=(c.data||[]).sort((a,b)=>a.semana<b.semana?1:a.semana>b.semana?-1:0);
  // Planes por semana (de lunes a domingo), la más reciente arriba
  const hoy=hoyMad(),lunHoy=lunesDe(hoy),S7={};S7[lunHoy]=[];(t.data||[]).forEach(x=>{const l=lunesDe(diaMad(x.hecha_en));(S7[l]=S7[l]||[]).push(x);});
  const sem=Object.keys(S7).sort().reverse();
  box.innerHTML=cabH+`<div class="rp-c"><div class="ar-h"><span class="ar-ic"><svg viewBox="0 0 24 24"><path d="M7 3.5h7l4 4V20a.5.5 0 0 1-.5.5h-10.5a.5.5 0 0 1-.5-.5V4a.5.5 0 0 1 .5-.5z"/><path d="M14 3.5V8h4M9 12.5h6M9 16h6"/></svg></span><div><b>Condiciones</b><small>${C.length?C.length+' guardada'+(C.length>1?'s':''):'Aún no hay ninguna'}</small></div></div>
    ${C.map(x=>`<button type="button" class="ar-f" data-cv="${x.id}"><span class="ar-d">${escH(fechaSem(x.semana))}</span><span class="tx"><b>${escH(x.est_nombre)}</b><small>${(x.para||[]).length?'Enviada a '+x.para.map(id=>escH(pri(nomDe(id)))).join(', '):'Guardada'}</small></span>${condChip(x.condicion)}</button>`).join('')}</div>
   <div class="rp-c"><div class="ar-h"><span class="ar-ic"><svg viewBox="0 0 24 24"><path d="M6 3h11a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6z"/><path d="M6 3v18M9.5 8.5l1.5 1.5 3-3M9.5 14.5l1.5 1.5 3-3"/></svg></span><div><b>Planes de batalla</b><small>Lo hecho cada semana, con su hora</small></div></div>
    ${sem.map(l=>{const n=S7[l].length;return `<button type="button" class="ar-f" data-s="${l}"><span class="ar-d">${l===lunHoy?'Ahora':escH(dLargoIso(l))}</span><span class="tx"><b>${l===lunHoy?'Esta semana':'Semana del '+escH(dLargoIso(l))}</b><small>del ${escH(dLargoIso(l))} al ${escH(dLargoIso(pbIso(l,6)))}</small></span><em class="ar-n">${n} hecha${n===1?'':'s'}</em></button>`;}).join('')}</div>`;
  on();box.querySelectorAll('[data-cv]').forEach(b=>b.onclick=()=>abreCond(b.dataset.cv));
  box.querySelectorAll('[data-s]').forEach(b=>b.onclick=()=>verPlanSemana(m,b.dataset.s,S7[b.dataset.s]||[],b.dataset.s===lunHoy?(pe.data||[]):[]));};
 pinta1();}

// Un plan de batalla semanal: cada día con lo hecho y la hora; se descarga en PDF
function verPlanSemana(p,lun,L,pend){const dias=[];for(let i=0;i<7;i++){const d=pbIso(lun,i),x=L.filter(t=>diaMad(t.hecha_en)===d);if(x.length)dias.push({dia:d,L:x});}
 const hora=t=>new Date(t).toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit',timeZone:'Europe/Madrid'}),comp=puedeCompartir();
 const m=modal(`<small class="cd-k">Plan de batalla · semana del ${escH(dLargoIso(lun))} al ${escH(dLargoIso(pbIso(lun,6)))}</small>
  <div class="cv-p" style="margin-top:12px">${avHTML(p)}<div><small>De</small><b>${escH(p.nombre)}</b>${pTag(p)}</div></div>
  <div class="ar-plan cd-txt">${dias.map(d=>{const t=new Date(d.dia+'T12:00:00').toLocaleDateString('es-ES',{weekday:'long',day:'numeric',month:'long'});return `<h3>${escH(t.charAt(0).toUpperCase()+t.slice(1))}</h3>${d.L.map(x=>`<div class="ar-t"><span class="ok">${IC.ck}</span><span class="tx">${condIn(x.texto)}</span><em>${hora(x.hecha_en)}</em></div>`).join('')}`;}).join('')||'<p class="vacio">Esta semana aún no se ha marcado nada como hecho.</p>'}
   ${pend.length?`<h3>Sin hacer todavía</h3>${pend.map(x=>`<div class="ar-t pe"><span class="ok"></span><span class="tx">${condIn(x.texto)}</span></div>`).join('')}`:''}</div>
  <div class="bts"><button class="bt${comp?' sec':''}" data-pdf>Descargar PDF</button>${comp?'<button class="bt" data-sh>Compartir</button>':''}</div>`);
 m.querySelector('.hoja').classList.add('ancha');
 const sale=async(cmp,bt)=>{const t0=bt.textContent;bt.disabled=true;bt.textContent='Preparando…';
  try{await sacaPDF(await planPDF(p,lun,dias,pend),'Plan de batalla - '+p.nombre+' - semana del '+lun,cmp);}catch(e){toast('No se ha podido hacer el PDF',false);}finally{bt.disabled=false;bt.textContent=t0;}};
 m.querySelector('[data-pdf]').onclick=ev=>sale(false,ev.target);const sh=m.querySelector('[data-sh]');if(sh)sh.onclick=ev=>sale(true,ev.target);}
