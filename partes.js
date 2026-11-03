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
