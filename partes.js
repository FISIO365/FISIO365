// ── BP/7R: cada noche, cada uno pasa a su senior su plan de batalla del día (lo hecho y lo pendiente) y su 7R.
// Los jueves después de las 14:00 se pasan las estadísticas con su condición (condiciones.js).
// Quien está por encima ve quién lo ha pasado y quién no.
const fechaLarga=d=>{const t=new Date(d+'T12:00:00').toLocaleDateString('es-ES',{weekday:'long',day:'numeric',month:'long'});return t.charAt(0).toUpperCase()+t.slice(1);};
const horaMad=t=>new Date(t).toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit',timeZone:'Europe/Madrid'});

// 7R de las estadísticas semanales de una persona: lo que lleva esta semana frente a la pasada a esta misma hora
async function datos7R(p){const {data:E}=await sb.from('pb_estadisticas').select('id,nombre,eje_y,sentido,principal').eq('persona',p).eq('periodo','semana').eq('archivada',false);
 if(!E||!E.length)return [];const ahora=madMs(Date.now()),ini=perIni('semana',ahora);
 const {data:A}=await sb.from('pb_apuntes').select('estadistica_id,en,cantidad').in('estadistica_id',E.map(e=>e.id)).gte('en',new Date(realMs(ini-HS)).toISOString());
 const L=(A||[]).map(x=>({...x,L:madMs(x.en)}));
 return E.sort((a,b)=>(b.principal?1:0)-(a.principal?1:0)).map(e=>{const r=sieteR(e,L.filter(x=>x.estadistica_id===e.id),ahora,ahora);return {nombre:e.nombre,eje:e.eje_y,sentido:e.sentido,principal:!!e.principal,este:r.este,antes:r.antes};});}

// La tarjeta del final del día en tu plan: enviar el BP/7R o ver que ya está enviado
async function pintaBP(el,r){if(!el)return;const yo=S.yo.id,hoy=hoyMad();
 const {data}=await sb.from('pb_partes').select('id,para,creado').eq('persona',yo).eq('dia',hoy).maybeSingle();if(!el.isConnected)return;
 const tarde=new Date().getHours()>=18;
 el.innerHTML=data?`<div class="rp-c bp-ok"><span class="bp-ic ok">${IC.ck}</span><div><b>BP/7R de hoy enviado</b><small>${(data.para||[]).length?'A '+data.para.map(id=>escH(pri(nomDe(id)))).join(', ')+' · ':''}a las ${horaMad(data.creado)}</small></div><button type="button" class="lnk" data-v>Ver</button><button type="button" class="lnk" data-e>Reenviar</button></div>`
  :`<div class="rp-c bp-env${tarde?' urge':''}"><div class="bp-t"><span class="bp-ic"><svg viewBox="0 0 24 24"><path d="M4 12l16-8-6 16-2.5-6.5z"/><path d="M11.5 13.5L20 4"/></svg></span><div><b>Pasa tu BP/7R de hoy</b><small>Al acabar el día, envía a tu senior lo que has hecho y cómo vas frente a la semana pasada.</small></div></div><button type="button" class="bt full" data-e>Enviar mi BP/7R</button></div>`;
 const e=el.querySelector('[data-e]');if(e)e.onclick=()=>enviarBP(r,()=>pintaBP(el,r));
 const v=el.querySelector('[data-v]');if(v)v.onclick=()=>abreParte(data.id);}

async function enviarBP(r,hecho){const yo=S.yo.id,hoy=hoyMad(),jefes=new Set(dependeDe(yo));
 const gente=S.miembros.filter(m=>m.activo&&m.id!==yo).sort((a,b)=>(jefes.has(b.id)-jefes.has(a.id))||a.nombre.localeCompare(b.nombre,'es'));
 const m=modal('<h3>Tu BP/7R de hoy</h3><p>Preparándolo…</p>');m.querySelector('.hoja').classList.add('ancha');
 let R7=[];try{R7=await datos7R(yo);}catch(_){}
 const hechas=(r.hechas||[]).map(x=>({t:x.t,h:x.hechaEn})),pend=(r.pendientes||[]).map(x=>({t:x.t}));
 const pt={persona:yo,dia:hoy,hechas,pendientes:pend,sieter:R7,creado:new Date().toISOString(),para:[...jefes]};
 m.querySelector('.hoja').innerHTML=`<small class="cd-k">BP/7R · ${escH(fechaLarga(hoy))}</small><h3 style="margin-top:4px">Esto es lo que vas a enviar</h3>
  <div class="bp-cuerpo">${cuerpoParte(pt)}</div>
  <label class="l">¿Quieres añadir algo? <span style="font-weight:500;color:var(--mut)">(opcional)</span></label><textarea class="i bp-nota" rows="3" maxlength="5000" placeholder="Algo que tu senior deba saber…"></textarea>
  <label class="l">¿A quién se lo envías?</label><div class="chs cd-para">${gente.map(p=>`<button type="button" data-p="${p.id}" class="${jefes.has(p.id)?'on':''}">${IC.ck}${escH(pri(p.nombre))}${p.puesto?` <em class="op-v">${escH(p.puesto)}</em>`:''}</button>`).join('')}</div>
  <div class="err"></div><div class="bts"><button class="bt sec" data-x>Cancelar</button><button class="bt" data-ok>Enviar</button></div>`;
 const para=jefes;m.querySelectorAll('.cd-para [data-p]').forEach(b=>b.onclick=()=>{const id=b.dataset.p;para.has(id)?para.delete(id):para.add(id);b.classList.toggle('on',para.has(id));});
 m.querySelector('[data-x]').onclick=()=>m.remove();
 m.querySelector('[data-ok]').onclick=async ev=>{if(!para.size){m.querySelector('.err').textContent='Elige a quién se lo envías (normalmente, tu senior)';return;}ev.target.disabled=true;
  const fila={equipo_id:S.yo.equipo_id,persona:yo,dia:hoy,para:[...para],leida:[],nota:m.querySelector('.bp-nota').value.trim()||null,hechas,pendientes:pend,sieter:R7,creado:new Date().toISOString()};
  const {error}=await sb.from('pb_partes').upsert(fila,{onConflict:'persona,dia'});
  if(error){ev.target.disabled=false;m.querySelector('.err').textContent='No se ha podido enviar';return;}
  m.remove();toast('BP/7R enviado a '+[...para].map(id=>pri(nomDe(id))).join(', '));hecho&&hecho();};}

// Lo que lleva un BP/7R: su 7R, lo hecho (con la hora), lo pendiente y la nota
function cuerpoParte(pt){const R=pt.sieter||[],H=pt.hechas||[],P=pt.pendientes||[];
 return `${R.length?`<div class="bp-sec">7R · cómo va la semana</div><div class="bp-7r"><div class="r7f cab"><span>Estadística</span><b>Esta semana</b><b class="ant">La pasada a esta hora</b><i></i></div>${R.map(x=>{const d=Number(x.este)-Number(x.antes),b=bueno({sentido:x.sentido},d);return `<div class="r7f"><span>${x.principal?'<em class="g">★ principal</em>':''}${escH(x.nombre)}</span><b>${num(x.este)}</b><b class="ant">${num(x.antes)}</b><i style="color:${colorDe(b)}">${d?(d>0?'▲ ':'▼ ')+num(Math.abs(d)):'='}</i></div>`;}).join('')}</div>`:''}
  <div class="bp-sec">Hecho hoy · ${H.length}</div>${H.length?H.map(x=>`<div class="ar-t"><span class="ok">${IC.ck}</span><span class="tx">${condIn(x.t)}</span><em>${x.h?horaMad(x.h):''}</em></div>`).join(''):'<p class="vacio" style="padding:6px 0">Hoy no se ha marcado nada como hecho.</p>'}
  ${P.length?`<div class="bp-sec">Sin hacer · ${P.length}</div>${P.map(x=>`<div class="ar-t pe"><span class="ok"></span><span class="tx">${condIn(x.t)}</span></div>`).join('')}`:''}
  ${pt.nota?`<div class="bp-sec">Nota</div><p class="bp-nt">${escH(pt.nota).replace(/\n/g,'<br>')}</p>`:''}`;}

async function abreParte(id){const {data,error}=await sb.from('pb_partes').select('*').eq('id',id).maybeSingle();if(error||!data){toast('No se ha podido abrir',false);return;}verParte(data);}
function verParte(pt){const yo=S.yo.id,p=M(pt.persona)||{nombre:'—'};
 if((pt.para||[]).includes(yo)&&!(pt.leida||[]).includes(yo))sb.rpc('pb_parte_leido',{c:pt.id}).then(()=>contarCond());
 const m=modal(`<small class="cd-k">BP/7R · ${escH(fechaLarga(pt.dia))}</small>
  <div class="cv-p" style="margin-top:12px">${avHTML(p)}<div><small>De</small><b>${escH(p.nombre)}${pt.persona===yo?' <i>(tú)</i>':''}</b>${pTag(p)}</div></div>
  <div class="bp-cuerpo">${cuerpoParte(pt)}</div>
  <p class="cv-pie">${(pt.para||[]).length?'Para '+pt.para.map(id=>id===yo?'ti':escH(pri(nomDe(id)))).join(', ')+' · ':''}enviado a las ${horaMad(pt.creado)}</p>
  <div class="bts"><button class="bt" data-x>Cerrar</button></div>`);
 m.querySelector('.hoja').classList.add('ancha');m.querySelector('[data-x]').onclick=()=>m.remove();}

// Control para quien está por encima: quién ha pasado el BP/7R de un día y quién tiene las condiciones del jueves
async function controlDe(ids,dia){const ahora=madMs(Date.now()),sem=ymd(perIni('semana',ahora));
 const [a,b,c]=await Promise.all([sb.from('pb_partes').select('id,persona,creado').in('persona',ids).eq('dia',dia),
  sb.from('pb_estadisticas').select('id,persona').in('persona',ids).eq('periodo','semana').eq('archivada',false),
  sb.from('pb_condiciones').select('persona,estadistica_id').in('persona',ids).eq('semana',sem)]);
 const bp={},co={};(a.data||[]).forEach(x=>bp[x.persona]=x);
 ids.forEach(id=>{const E=(b.data||[]).filter(x=>x.persona===id),C=new Set((c.data||[]).filter(x=>x.persona===id).map(x=>x.estadistica_id));co[id]={tot:E.length,hechas:E.filter(e=>C.has(e.id)).length};});
 return {bp,co,sem};}

// ── CONTROL: quién ha pasado el BP/7R cada día de la semana y quién tiene las condiciones del jueves
const CT={sem:0};
function renderControl(wrap){const box=ce('div','ct');wrap.appendChild(box);const yo=S.yo.id;
 const pinta=async()=>{const L=verEst().filter(m=>m.id!==yo),ids=L.map(m=>m.id),hoy=hoyMad(),lun=pbIso(lunesDe(hoy),7*CT.sem),D=[...Array(7)].map((_,i)=>pbIso(lun,i));
  // El jueves de esa semana: si aún no han dado las 14:00, el de la semana anterior
  let ju=D[3];const ahoraM=madMs(Date.now());if(ju>hoy||(ju===hoy&&new Date(ahoraM).getUTCHours()<14))ju=pbIso(ju,-7);
  const cab=`<div class="es-cab"><div><b>Control</b><small class="ct-sub">Quién ha pasado su BP/7R y su condición</small></div></div>
   <div class="rp-c ct-sem"><button type="button" class="pb-fl" data-s="-1" aria-label="Semana anterior"><svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg></button><b>${CT.sem===0?'Esta semana':'Semana del '+escH(dLargoIso(lun))}<small>del ${escH(dLargoIso(lun))} al ${escH(dLargoIso(D[6]))}</small></b><button type="button" class="pb-fl" data-s="1" aria-label="Semana siguiente"${CT.sem>=0?' disabled':''}><svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg></button></div>`;
  const nav=()=>box.querySelectorAll('.ct-sem [data-s]').forEach(b=>b.onclick=()=>{CT.sem=Math.min(0,CT.sem+ +b.dataset.s);pinta();});
  if(!L.length){box.innerHTML=cab+'<div class="rp-c"><p class="vacio">No tienes a nadie a tu cargo. Lo que ve cada uno lo decide quien administra, en Equipo › Quién ve qué.</p></div>';nav();return;}
  box.innerHTML=cab+'<div class="rp-c" style="color:var(--mut);font-size:13px">Cargando…</div>';nav();
  const [a,b,c]=await Promise.all([sb.from('pb_partes').select('id,persona,dia,creado').in('persona',ids).gte('dia',D[0]).lte('dia',D[6]),
   sb.from('pb_estadisticas').select('id,persona').in('persona',ids).eq('periodo','semana').eq('archivada',false),
   sb.from('pb_condiciones').select('id,persona,estadistica_id').in('persona',ids).eq('semana',ju)]);
  if(!box.isConnected)return;
  if(a.error||b.error||c.error){box.innerHTML=cab+'<div class="rp-c">No se ha podido cargar. <button type="button" class="lnk" style="display:inline;padding:0" data-r>Reintentar</button></div>';nav();box.querySelector('[data-r]').onclick=pinta;return;}
  const BP={};(a.data||[]).forEach(x=>BP[x.persona+'|'+x.dia]=x);
  const hoyBP=L.filter(m=>BP[m.id+'|'+hoy]).length;
  const co=id=>{const E=(b.data||[]).filter(x=>x.persona===id),C=(c.data||[]).filter(x=>x.persona===id),H=new Set(C.map(x=>x.estadistica_id));return {tot:E.length,h:E.filter(e=>H.has(e.id)).length,C};};
  const conE=L.filter(m=>co(m.id).tot),okC=conE.filter(m=>{const x=co(m.id);return x.h>=x.tot;}).length;
  box.innerHTML=cab+`<div class="rp-c"><div class="ct-h"><div><small class="cd-k">Cada noche</small><b>BP/7R</b></div>${CT.sem===0?`<span class="ct-n${hoyBP===L.length?' ok':''}">Hoy ${hoyBP} de ${L.length}</span>`:''}</div>
    <div class="ct-t"><div class="ct-r cab"><span></span>${D.map(d=>`<i class="${d===hoy?'hoy':''}">${DSEM[new Date(d+'T12:00:00Z').getUTCDay()].slice(0,1).toUpperCase()}<small>${new Date(d+'T12:00:00Z').getUTCDate()}</small></i>`).join('')}</div>
    ${L.map(m=>`<div class="ct-r"><span class="ct-q">${avHTML(m)}<span><b>${escH(pri(m.nombre))}</b>${m.puesto?`<small>${escH(m.puesto)}</small>`:''}</span></span>${D.map(d=>{const x=BP[m.id+'|'+d];
      return x?`<button type="button" class="ct-d si" data-bp="${x.id}" title="Enviado a las ${horaMad(x.creado)}">${IC.ck}</button>`:d>hoy?'<i class="ct-d fut"></i>':d===hoy?'<i class="ct-d pen" title="Aún no lo ha enviado"></i>':'<i class="ct-d no" title="No lo envió"><svg viewBox="0 0 24 24"><path d="M7 7l10 10M17 7L7 17"/></svg></i>';}).join('')}</div>`).join('')}</div>
    <div class="ct-ley"><span><i class="ct-d si">${IC.ck}</i>Enviado (tócalo para verlo)</span><span><i class="ct-d no"><svg viewBox="0 0 24 24"><path d="M7 7l10 10M17 7L7 17"/></svg></i>No lo envió</span><span><i class="ct-d pen"></i>Hoy, aún no</span></div></div>
   <div class="rp-c"><div class="ct-h"><div><small class="cd-k">Los jueves desde las 14:00</small><b>Condiciones del ${escH(fechaSem(ju))}</b></div>${conE.length?`<span class="ct-n${okC===conE.length?' ok':''}">${okC} de ${conE.length}</span>`:''}</div>
    ${L.map(m=>{const x=co(m.id);return `<button type="button" class="ct-c" data-a="${m.id}">${avHTML(m)}<span class="tx"><b>${escH(m.nombre)}</b>${pTag(m)}</span>${x.tot?`<span class="ct-st ${x.h>=x.tot?'si':'no'}">${x.h>=x.tot?'✓ ':''}${x.h} de ${x.tot}</span>`:'<span class="ct-st na">Sin estadísticas</span>'}</button>`;}).join('')}</div>`;
  nav();box.querySelectorAll('[data-bp]').forEach(b=>b.onclick=()=>abreParte(b.dataset.bp));
  box.querySelectorAll('[data-a]').forEach(b=>b.onclick=()=>{const x=co(b.dataset.a);if(x.C.length===1)return abreCond(x.C[0].id);AR.persona=b.dataset.a;arGuarda();S.tab='arch';guardaLS('tab','arch');pinta0();});};
 pinta();}

// Arriba de tu plan de hoy: lo que ya has enviado y lo que te falta
async function pintaEstado(el){if(!el)return;const yo=S.yo.id,hoy=hoyMad(),ahoraM=madMs(Date.now()),ju=ymd(perIni('semana',ahoraM));
 const [a,b,c]=await Promise.all([sb.from('pb_partes').select('id,creado').eq('persona',yo).eq('dia',hoy).maybeSingle(),
  sb.from('pb_estadisticas').select('id').eq('persona',yo).eq('periodo','semana').eq('archivada',false),
  sb.from('pb_condiciones').select('estadistica_id').eq('persona',yo).eq('semana',ju)]);
 if(!el.isConnected)return;const bp=a.data,tot=(b.data||[]).length,H=new Set((c.data||[]).map(x=>x.estadistica_id)),h=(b.data||[]).filter(e=>H.has(e.id)).length;
 el.innerHTML=`<div class="rp-c pb-est"><button type="button" class="pb-es ${bp?'si':'no'}" data-k="bp"><span>${bp?IC.ck:'<i></i>'}</span><b>BP/7R de hoy</b><small>${bp?'Enviado a las '+horaMad(bp.creado):'Sin enviar'}</small></button>
  ${tot?`<button type="button" class="pb-es ${h>=tot?'si':'no'}" data-k="co"><span>${h>=tot?IC.ck:'<i></i>'}</span><b>Condiciones</b><small>${h>=tot?'Hechas · jue '+new Date(ju+'T12:00:00Z').getUTCDate():h+' de '+tot+' · jue '+new Date(ju+'T12:00:00Z').getUTCDate()}</small></button>`:''}</div>`;
 el.querySelector('[data-k="bp"]').onclick=()=>{const t=document.querySelector('#pbBP');if(t)t.scrollIntoView({behavior:'smooth',block:'center'});};
 const k=el.querySelector('[data-k="co"]');if(k)k.onclick=()=>{S.tab='est';guardaLS('tab','est');ES.persona='';ES.abierta='';esGuarda();pinta0();};}
