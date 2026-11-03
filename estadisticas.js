// ── ESTADÍSTICAS: cada persona tiene las suyas; se grafean solas con su tendencia.
// Las ve y las rellena la propia persona y quien la revisa (los mismos permisos que el plan de batalla).
const ES={persona:leeLS('es_persona',''),abierta:leeLS('es_abierta',''),per:{}};
const esGuarda=()=>{guardaLS('es_persona',ES.persona);guardaLS('es_abierta',ES.abierta);};
const PER={dia:{n:'Días',uno:'día'},semana:{n:'Semanas',uno:'semana'},mes:{n:'Meses',uno:'mes'}};
const MESES=['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
const VERDE='#16803c',ROJO='#c0392b',GRIS='#a3968c';

// Periodos: cada valor va al día, al lunes de su semana o al día 1 de su mes
function perIni(p,iso){if(p==='mes')return iso.slice(0,8)+'01';if(p==='semana'){const d=new Date(iso+'T12:00:00Z');d.setUTCDate(d.getUTCDate()-((d.getUTCDay()+6)%7));return d.toISOString().slice(0,10);}return iso;}
function perMas(p,iso,n){if(p==='mes'){let y=+iso.slice(0,4),m=+iso.slice(5,7)-1+n;y+=Math.floor(m/12);m=((m%12)+12)%12;return y+'-'+String(m+1).padStart(2,'0')+'-01';}return pbIso(iso,n*(p==='semana'?7:1));}
function perIdx(p,iso){if(p==='mes')return +iso.slice(0,4)*12+(+iso.slice(5,7)-1);const d=Math.round(new Date(iso+'T12:00:00Z')/864e5);return p==='semana'?Math.round(d/7):d;}
function perCorto(p,iso){const d=+iso.slice(8,10),m=MESES[+iso.slice(5,7)-1];return p==='mes'?m+' '+iso.slice(2,4):d+' '+m;}
function perLargo(p,iso,hoy){const ini=perIni(p,hoy);if(iso===ini)return p==='dia'?'Hoy':p==='semana'?'Esta semana':'Este mes';
 if(iso===perMas(p,ini,-1))return p==='dia'?'Ayer':p==='semana'?'La semana pasada':'El mes pasado';
 if(p==='mes'){const t=new Date(iso+'T12:00:00').toLocaleDateString('es-ES',{month:'long',year:'numeric'});return t.charAt(0).toUpperCase()+t.slice(1);}
 return (p==='semana'?'Semana del ':'')+perCorto(p,iso)+(iso.slice(0,4)!==hoy.slice(0,4)?' '+iso.slice(0,4):'');}
const num=v=>{const n=Number(v);return Number.isInteger(n)?n.toLocaleString('es-ES'):n.toLocaleString('es-ES',{maximumFractionDigits:2});};

// Tendencia: la recta que mejor encaja con todos los valores (mínimos cuadrados)
function tendencia(pts){if(pts.length<2)return null;const n=pts.length,sx=pts.reduce((a,p)=>a+p.x,0),sy=pts.reduce((a,p)=>a+p.y,0),sxx=pts.reduce((a,p)=>a+p.x*p.x,0),sxy=pts.reduce((a,p)=>a+p.x*p.y,0),den=n*sxx-sx*sx;
 if(!den)return null;const m=(n*sxy-sx*sy)/den;return {m,b:(sy-m*sx)/n};}
const bueno=(est,d)=>d===0?null:(d>0)===(est.sentido==='positiva');
const colorDe=b=>b===null?GRIS:b?VERDE:ROJO;

// La gráfica (SVG). mini = la pequeña de la tarjeta
function grafica(est,vals,hoy,mini){const W=mini?300:340,H=mini?84:200,L=mini?4:38,R=mini?4:10,T=mini?8:12,B=mini?8:30;
 const V=[...vals].sort((a,b)=>a.periodo_inicio<b.periodo_inicio?-1:1);
 if(!V.length)return `<svg class="es-g${mini?' mini':''}" viewBox="0 0 ${W} ${H}"><text x="${W/2}" y="${H/2+4}" text-anchor="middle" class="es-vacia">Aún sin datos</text></svg>`;
 const pts=V.map(v=>({x:perIdx(est.periodo,v.periodo_inicio),y:Number(v.valor),v}));
 const x0=pts[0].x,x1=Math.max(pts[pts.length-1].x,perIdx(est.periodo,perIni(est.periodo,hoy)),x0+1);
 let y0=Math.min(...pts.map(p=>p.y)),y1=Math.max(...pts.map(p=>p.y));if(y0>=0&&!mini)y0=0;if(y0===y1){y1=y0+1;if(y0>0)y0=0;}
 const pad=(y1-y0)*.08;y1+=pad;if(y0<0||mini)y0-=pad;
 const X=x=>L+(x-x0)/(x1-x0)*(W-L-R),Y=y=>T+(1-(y-y0)/(y1-y0))*(H-T-B);
 let s='';
 if(!mini){for(let i=0;i<=3;i++){const v=y0+(y1-y0)*i/3,y=Y(v);s+=`<line x1="${L}" x2="${W-R}" y1="${y}" y2="${y}" class="es-rej"/><text x="${L-6}" y="${y+3.5}" text-anchor="end" class="es-ej">${num(Math.round(v*10)/10)}</text>`;}
  s+=`<text x="${L}" y="${H-8}" class="es-ej">${escH(perCorto(est.periodo,V[0].periodo_inicio))}</text><text x="${W-R}" y="${H-8}" text-anchor="end" class="es-ej">${escH(perCorto(est.periodo,perIni(est.periodo,hoy)))}</text>`;}
 const t=tendencia(pts);
 if(t){const c=colorDe(bueno(est,t.m));s+=`<line x1="${X(x0)}" y1="${Y(t.m*x0+t.b)}" x2="${X(x1)}" y2="${Y(t.m*x1+t.b)}" stroke="${c}" class="es-ten"/>`;}
 for(let i=1;i<pts.length;i++){const a=pts[i-1],b=pts[i];s+=`<line x1="${X(a.x)}" y1="${Y(a.y)}" x2="${X(b.x)}" y2="${Y(b.y)}" stroke="${colorDe(bueno(est,b.y-a.y))}" class="es-lin"/>`;}
 pts.forEach((p,i)=>{if(mini&&i<pts.length-1&&pts.length>12)return;s+=`<circle cx="${X(p.x)}" cy="${Y(p.y)}" r="${mini?2.6:3.6}" class="es-pt"/>`;});
 return `<svg class="es-g${mini?' mini':''}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">${s}</svg>`;}

function textoTendencia(est,vals){const pts=vals.map(v=>({x:perIdx(est.periodo,v.periodo_inicio),y:Number(v.valor)})),t=tendencia(pts);
 if(!t)return {txt:vals.length?'Con un dato más verás la tendencia':'Apunta el primer dato',c:GRIS};
 const b=bueno(est,Math.abs(t.m)<1e-9?0:t.m);if(b===null)return {txt:'Tendencia estable',c:GRIS};
 return {txt:(t.m>0?'Tendencia al alza':'Tendencia a la baja')+(b?' · bien':' · a mejorar'),c:colorDe(b)};}

async function renderEstadisticas(wrap){const box=ce('div','es');wrap.appendChild(box);box.innerHTML='<div class="rp-c" style="color:var(--mut);font-size:13px">Cargando…</div>';
 const yo=S.yo.id;if(ES.persona&&!visibles().some(m=>m.id===ES.persona)){ES.persona='';ES.abierta='';esGuarda();}
 const persona=()=>ES.persona||yo,hoy=hoyMad();
 let E=[],VAL={};
 const carga=async()=>{const {data,error}=await sb.from('pb_estadisticas').select('*').eq('persona',persona()).order('creado');
  if(!box.isConnected)return;if(error){box.innerHTML='<div class="rp-c">No se ha podido cargar. Vuelve a intentarlo.</div>';return;}
  E=data||[];VAL={};E.forEach(e=>VAL[e.id]=[]);
  if(E.length){const {data:v}=await sb.from('pb_valores').select('*').in('estadistica_id',E.map(e=>e.id)).order('periodo_inicio');(v||[]).forEach(x=>(VAL[x.estadistica_id]=VAL[x.estadistica_id]||[]).push(x));}
  if(ES.abierta&&!E.some(e=>e.id===ES.abierta)){ES.abierta='';esGuarda();}
  pinta3();};
 window._esRecargar=carga;
 const quien=()=>{const V=visibles();return V.length>1?`<div class="pb-who">${V.map(m=>`<button type="button" data-p="${m.id}" class="${m.id===persona()?'on':''}">${m.id===yo?'Yo':escH(pri(m.nombre))}</button>`).join('')}</div>`:'';};
 const ultimo=e=>{const v=VAL[e.id]||[];if(!v.length)return '';const a=v[v.length-1],p=v[v.length-2],d=p?Number(a.valor)-Number(p.valor):0;
  return `<div class="es-ult"><b>${num(a.valor)}</b>${p&&d?`<i style="color:${colorDe(bueno(e,d))}">${d>0?'▲':'▼'} ${num(Math.abs(d))}</i>`:''}<small>${escH(perLargo(e.periodo,a.periodo_inicio,hoy))}</small></div>`;};
 const pinta3=()=>{const y=window.scrollY;const yoMismo=persona()===yo,nom=pri(nomDe(persona()));
  if(ES.abierta){detalle(E.find(e=>e.id===ES.abierta));return;}
  const act=E.filter(e=>!e.archivada),arc=E.filter(e=>e.archivada);
  const tarj=e=>{const tt=textoTendencia(e,VAL[e.id]||[]);return `<button type="button" class="rp-c es-c" data-e="${e.id}"><div class="es-ch"><div><small>${escH(e.puesto||'Estadística')}</small><b>${escH(e.nombre)}</b></div>${ultimo(e)}</div>${grafica(e,VAL[e.id]||[],hoy,true)}<div class="es-pie"><span style="color:${tt.c}">${escH(tt.txt)}</span><em>${escH(e.eje_y)} · ${PER[e.periodo].n.toLowerCase()}</em></div></button>`;};
  box.innerHTML=quien()+`<div class="rp-c"><div class="eq-h"><div><small>Estadísticas</small><b>${yoMismo?'Tus estadísticas':'Estadísticas de '+escH(nom)}</b></div><button class="bt" id="esNueva">+ Nueva</button></div>
   ${!act.length?`<p class="eq-p">${yoMismo?'Crea tu primera estadística: lo que produce tu puesto (cursos completados, pacientes nuevos…). Apuntas el dato cada día, semana o mes y se grafea sola con su tendencia.':'Aún no tiene estadísticas. Puedes crearle una.'}</p>`:''}</div>
   ${act.map(tarj).join('')}${arc.length?`<details class="es-arc"><summary>Archivadas (${arc.length})</summary>${arc.map(tarj).join('')}</details>`:''}`;
  box.querySelectorAll('.pb-who button').forEach(b=>b.onclick=()=>{ES.persona=b.dataset.p===yo?'':b.dataset.p;ES.abierta='';esGuarda();carga();});
  box.querySelector('#esNueva').onclick=()=>editarEst(null);
  box.querySelectorAll('[data-e]').forEach(b=>b.onclick=()=>{ES.abierta=b.dataset.e;esGuarda();pinta3();window.scrollTo(0,0);});
  window.scrollTo(0,y);};
 // Una estadística en grande: gráfica, apuntar el dato y la lista de datos
 const detalle=e=>{if(!e){ES.abierta='';esGuarda();return pinta3();}
  const vals=VAL[e.id]||[],tt=textoTendencia(e,vals),actual=perIni(e.periodo,hoy);
  let sel=ES.per[e.id]||actual;if(sel>actual)sel=actual;
  const de=p=>vals.find(v=>v.periodo_inicio===p);
  box.innerHTML=quien()+`<button type="button" class="es-atras"><svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg>Estadísticas</button>
   <div class="rp-c"><div class="eq-h"><div><small>${escH(e.puesto||'Estadística')}</small><b>${escH(e.nombre)}</b></div><button class="mas3" aria-label="Opciones">⋯</button></div>
    <div class="es-sen"><span class="es-tag ${e.sentido}">${e.sentido==='positiva'?'Positiva · si sube, es bueno':'Negativa · si sube, es malo'}</span><span style="color:${tt.c};font-weight:600">${escH(tt.txt)}</span></div>
    <div class="es-gw"><span class="es-ey">${escH(e.eje_y)}</span>${grafica(e,vals,hoy,false)}</div><div class="es-ex">${PER[e.periodo].n}</div>
    <div class="es-ley"><span><i style="background:${VERDE}"></i>Va bien</span><span><i style="background:${ROJO}"></i>Va mal</span><span><i class="dash"></i>Tendencia</span></div></div>
   <div class="rp-c"><div class="es-ap"><small>Apuntar el dato</small>
    <div class="es-per"><button type="button" class="pb-fl" data-m="-1" aria-label="Anterior"><svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg></button><b>${escH(perLargo(e.periodo,sel,hoy))}</b><button type="button" class="pb-fl" data-m="1" aria-label="Siguiente"${sel>=actual?' disabled':''}><svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg></button></div>
    <div class="es-in"><input class="i" inputmode="decimal" autocomplete="off" placeholder="${escH(e.eje_y)}" value="${de(sel)?escH(String(de(sel).valor).replace('.',',')):''}"><button class="bt" id="esGuardar">${de(sel)?'Cambiar':'Guardar'}</button></div>
    ${de(sel)?'<button type="button" class="lnk" id="esQuitar" style="margin-top:10px">Quitar el dato de este periodo</button>':''}</div></div>
   ${vals.length?`<div class="rp-c"><div class="eq-h"><div><small>Datos</small><b>${vals.length} apuntado${vals.length===1?'':'s'}</b></div></div>${[...vals].reverse().slice(0,24).map((v,i,A)=>{const p=A[i+1],d=p?Number(v.valor)-Number(p.valor):0;return `<button type="button" class="es-fila${v.periodo_inicio===sel?' on':''}" data-p="${v.periodo_inicio}"><span>${escH(perLargo(e.periodo,v.periodo_inicio,hoy))}</span><b>${num(v.valor)}</b><i style="color:${p&&d?colorDe(bueno(e,d)):'transparent'}">${p&&d?(d>0?'▲':'▼'):'·'}</i></button>`;}).join('')}</div>`:''}`;
  box.querySelector('.es-atras').onclick=()=>{ES.abierta='';esGuarda();pinta3();};
  box.querySelectorAll('.pb-who button').forEach(b=>b.onclick=()=>{ES.persona=b.dataset.p===yo?'':b.dataset.p;ES.abierta='';esGuarda();carga();});
  box.querySelectorAll('.es-per [data-m]').forEach(b=>b.onclick=()=>{ES.per[e.id]=perMas(e.periodo,sel,+b.dataset.m);detalle(e);});
  box.querySelectorAll('.es-fila').forEach(b=>b.onclick=()=>{ES.per[e.id]=b.dataset.p;detalle(e);box.querySelector('.es-in input').focus();});
  const inp=box.querySelector('.es-in input'),bt=box.querySelector('#esGuardar');
  const guarda=async()=>{const t=inp.value.trim().replace(/\s/g,'').replace(/\.(?=\d{3}(\D|$))/g,'').replace(',','.');const v=Number(t);if(!t||!isFinite(v)){toast('Escribe un número',false);inp.focus();return;}bt.disabled=true;
   const {data,error}=await sb.from('pb_valores').upsert({estadistica_id:e.id,periodo_inicio:sel,valor:v,por:yo},{onConflict:'estadistica_id,periodo_inicio'}).select().single();
   bt.disabled=false;if(error){toast('No se ha podido guardar',false);return;}
   VAL[e.id]=vals.filter(x=>x.periodo_inicio!==sel).concat(data).sort((a,b)=>a.periodo_inicio<b.periodo_inicio?-1:1);toast('Guardado');detalle(e);};
  bt.onclick=guarda;inp.onkeydown=ev=>{if(ev.key==='Enter'){ev.preventDefault();guarda();}};
  const q=box.querySelector('#esQuitar');if(q)q.onclick=()=>pregunta('¿Quitar el dato de '+perLargo(e.periodo,sel,hoy).toLowerCase()+'?',{si:'Quitar'}).then(async ok=>{if(!ok)return;const {error}=await sb.from('pb_valores').delete().eq('estadistica_id',e.id).eq('periodo_inicio',sel);if(error){toast('No se ha podido',false);return;}VAL[e.id]=vals.filter(x=>x.periodo_inicio!==sel);detalle(e);});
  box.querySelector('.mas3').onclick=()=>{const m=modal(`<h3>${escH(e.nombre)}</h3><div style="margin-top:10px">
   <button class="op" data-a="ed"><svg viewBox="0 0 24 24"><path d="M4 20h4L18.5 9.5a2.8 2.8 0 0 0-4-4L4 16z"/></svg>Cambiar la estadística</button>
   <button class="op" data-a="ar"><svg viewBox="0 0 24 24"><path d="M4 7h16v13H4zM2 3h20v4H2zM10 12h4"/></svg>${e.archivada?'Sacar de archivadas':'Archivar'}</button>
   <button class="op rojo" data-a="bo"><svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>Borrar con todos sus datos</button></div>`);
   m.querySelector('[data-a="ed"]').onclick=()=>{m.remove();editarEst(e);};
   m.querySelector('[data-a="ar"]').onclick=async()=>{m.remove();const {error}=await sb.from('pb_estadisticas').update({archivada:!e.archivada}).eq('id',e.id);if(error){toast('No se ha podido',false);return;}e.archivada=!e.archivada;toast(e.archivada?'Archivada':'Vuelve a estar activa');ES.abierta='';esGuarda();pinta3();};
   m.querySelector('[data-a="bo"]').onclick=()=>{m.remove();pregunta('¿Borrar «'+e.nombre+'» y todos sus datos?',{sub:'No se puede deshacer. Si solo quieres que no salga, archívala.',si:'Borrar'}).then(async ok=>{if(!ok)return;const {error}=await sb.from('pb_estadisticas').delete().eq('id',e.id);if(error){toast('No se ha podido',false);return;}ES.abierta='';esGuarda();carga();});};};};
 // Crear o cambiar una estadística
 const editarEst=e=>{const per=persona(),pm=M(per)||{},v={puesto:e?e.puesto:(pm.puesto||''),nombre:e?e.nombre:'',eje_y:e?e.eje_y:'',periodo:e?e.periodo:'semana',sentido:e?e.sentido:'positiva'};
  const m=modal(`<h3>${e?'Cambiar la estadística':'Nueva estadística'}${per===yo?'':' para '+escH(pri(pm.nombre))}</h3>
   <label class="l">Puesto</label><input class="i" name="puesto" maxlength="60" value="${escH(v.puesto)}" placeholder="Ej.: Recepción, Fisioterapeuta…">
   <label class="l">Nombre de la estadística</label><input class="i" name="nombre" maxlength="80" value="${escH(v.nombre)}" placeholder="Ej.: Cursos completados">
   <label class="l">Qué se mide (columna vertical)</label><input class="i" name="eje_y" maxlength="60" value="${escH(v.eje_y)}" placeholder="Ej.: Nº de cursos">
   <label class="l">Cada cuánto se apunta (columna horizontal)</label><div class="chs es-op" data-k="periodo">${Object.keys(PER).map(k=>`<button type="button" data-v="${k}" class="${v.periodo===k?'on':''}">${IC.ck}${PER[k].n}</button>`).join('')}</div>
   <label class="l">¿Es positiva o negativa?</label><div class="es-sn" data-k="sentido">
    <button type="button" data-v="positiva" class="${v.sentido==='positiva'?'on':''}"><svg viewBox="0 0 24 24"><path d="M4 17l6-6 4 4 6-7M20 8v5M20 8h-5"/></svg><span><b>Positiva</b><small>Si sube, es bueno</small></span></button>
    <button type="button" data-v="negativa" class="${v.sentido==='negativa'?'on':''}"><svg viewBox="0 0 24 24"><path d="M4 7l6 6 4-4 6 7M20 16v-5M20 16h-5"/></svg><span><b>Negativa</b><small>Si sube, es malo</small></span></button></div>
   ${e&&(VAL[e.id]||[]).length?'<p style="margin-top:10px">Si cambias cada cuánto se apunta, los datos que ya tienes se quedan en su fecha.</p>':''}
   <div class="err"></div><div class="bts"><button class="bt sec" data-x>Cancelar</button><button class="bt" data-ok>${e?'Guardar':'Crear'}</button></div>`);
  m.querySelectorAll('[data-k]').forEach(g=>g.querySelectorAll('button').forEach(b=>b.onclick=()=>{v[g.dataset.k]=b.dataset.v;g.querySelectorAll('button').forEach(x=>x.classList.toggle('on',x===b));}));
  m.querySelector('[data-x]').onclick=()=>m.remove();
  m.querySelector('[data-ok]').onclick=async ev=>{const g=n=>m.querySelector(`[name="${n}"]`).value.trim();v.puesto=g('puesto');v.nombre=g('nombre');v.eje_y=g('eje_y');
   if(!v.nombre||!v.eje_y){m.querySelector('.err').textContent='Pon el nombre y qué se mide';return;}ev.target.disabled=true;
   const campos={puesto:v.puesto||null,nombre:v.nombre,eje_y:v.eje_y,periodo:v.periodo,sentido:v.sentido};
   const r=e?await sb.from('pb_estadisticas').update(campos).eq('id',e.id).select().single():await sb.from('pb_estadisticas').insert({...campos,equipo_id:S.yo.equipo_id,persona:per,por:yo}).select().single();
   if(r.error){ev.target.disabled=false;m.querySelector('.err').textContent='No se ha podido guardar';return;}
   m.remove();toast(e?'Guardada':'Creada');ES.abierta=r.data.id;esGuarda();carga();};};
 carga();}
