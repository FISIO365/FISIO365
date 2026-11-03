// ── ESTADÍSTICAS: cada persona tiene las suyas; se grafean solas con su tendencia.
// Cada cosa se apunta con su fecha y hora; el valor de cada periodo es la suma de lo apuntado.
// La semana va de jueves a las 14:00 a jueves a las 14:00 (hora de Madrid).
// 7R: cómo vamos esta semana comparado con la semana pasada justo en este mismo punto.
// Las ve y las rellena la propia persona y quien la revisa (los mismos permisos que el plan de batalla).
const ES={persona:leeLS('es_persona',''),abierta:leeLS('es_abierta',''),ver:{},dia7:{},cuando:{},cant:{}};
const esGuarda=()=>{guardaLS('es_persona',ES.persona);guardaLS('es_abierta',ES.abierta);};
const PER={dia:{n:'Días'},semana:{n:'Semanas'},mes:{n:'Meses'}};
const MESES=['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
const DSEM=['dom','lun','mar','mié','jue','vie','sáb'];
const VERDE='#16803c',ROJO='#c0392b',GRIS='#a3968c',HD=864e5,HS=7*HD;

// Hora de Madrid como «hora de pared» (ms): así los cortes de jueves 14:00 caen siempre donde tocan
const _fM=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
function madMs(t){const p={};_fM.formatToParts(new Date(t)).forEach(x=>p[x.type]=x.value);return Date.UTC(+p.year,+p.month-1,+p.day,+p.hour%24,+p.minute,+p.second);}
function realMs(L){let r=L;for(let i=0;i<3;i++)r=L-(madMs(r)-r);return r;}
const ymd=L=>new Date(L).toISOString().slice(0,10);
const hhmm=L=>new Date(L).toISOString().slice(11,16);
const dLargo=L=>{const d=new Date(L);return DSEM[d.getUTCDay()]+' '+d.getUTCDate()+' '+MESES[d.getUTCMonth()];};

// Periodos (en hora de pared): inicio, siguiente, clave e índice para la gráfica
function perIni(p,L){const d=new Date(L),y=d.getUTCFullYear(),m=d.getUTCMonth(),dd=d.getUTCDate();
 if(p==='mes')return Date.UTC(y,m,1);if(p==='dia')return Date.UTC(y,m,dd);
 let t=Date.UTC(y,m,dd-((d.getUTCDay()-4+7)%7),14);if(t>L)t-=HS;return t;}
function perSig(p,s){if(p==='mes'){const d=new Date(s);return Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,1);}return s+(p==='semana'?HS:HD);}
function perAnt(p,s){if(p==='mes'){const d=new Date(s);return Date.UTC(d.getUTCFullYear(),d.getUTCMonth()-1,1);}return s-(p==='semana'?HS:HD);}
function perIdx(p,s){if(p==='mes'){const d=new Date(s);return d.getUTCFullYear()*12+d.getUTCMonth();}return Math.round(s/(p==='semana'?HS:HD));}
function perCorto(p,s){const d=new Date(s);return p==='mes'?MESES[d.getUTCMonth()]+' '+String(d.getUTCFullYear()).slice(2):d.getUTCDate()+' '+MESES[d.getUTCMonth()];}
function perLargo(p,s,ahora){const ini=perIni(p,ahora);
 if(s===ini)return p==='dia'?'Hoy':p==='semana'?'Esta semana':'Este mes';
 if(s===perAnt(p,ini))return p==='dia'?'Ayer':p==='semana'?'La semana pasada':'El mes pasado';
 if(p==='mes'){const d=new Date(s);return MESES[d.getUTCMonth()]+' '+d.getUTCFullYear();}
 return p==='semana'?'Semana del '+dLargo(s):dLargo(s);}
const num=v=>{const n=Math.round(Number(v)*100)/100;return Number.isInteger(n)?n.toLocaleString('es-ES'):n.toLocaleString('es-ES',{maximumFractionDigits:2});};
const suma=(A,a,b)=>A.reduce((t,x)=>x.L>=a&&x.L<=b?t+Number(x.cantidad):t,0);

// Totales por periodo, desde el primer apunte hasta el periodo actual (los periodos sin nada cuentan 0)
function totales(e,A,ahora){if(!A.length)return [];const fin=perIni(e.periodo,ahora);let s=perIni(e.periodo,Math.min(...A.map(x=>x.L)));const R=[];let n=0;
 while(s<=fin&&n++<400){const sig=perSig(e.periodo,s);R.push({s,v:A.reduce((t,x)=>x.L>=s&&x.L<sig?t+Number(x.cantidad):t,0),actual:s===fin});s=sig;}return R;}

// Tendencia: la recta que mejor encaja (mínimos cuadrados) con los periodos ya cerrados
function tendencia(pts){if(pts.length<2)return null;const n=pts.length,sx=pts.reduce((a,p)=>a+p.x,0),sy=pts.reduce((a,p)=>a+p.y,0),sxx=pts.reduce((a,p)=>a+p.x*p.x,0),sxy=pts.reduce((a,p)=>a+p.x*p.y,0),den=n*sxx-sx*sx;
 if(!den)return null;const m=(n*sxy-sx*sy)/den;return {m,b:(sy-m*sx)/n};}
const bueno=(e,d)=>Math.abs(d)<1e-9?null:(d>0)===(e.sentido==='positiva');
const colorDe=b=>b===null?GRIS:b?VERDE:ROJO;
function textoTendencia(e,T){const C=T.filter(x=>!x.actual),t=tendencia(C.map(x=>({x:perIdx(e.periodo,x.s),y:x.v})));
 if(!t)return {txt:T.length?'La tendencia sale con dos '+(e.periodo==='mes'?'meses':e.periodo==='dia'?'días':'semanas')+' cerrados':'Apunta el primer dato',c:GRIS};
 const b=bueno(e,t.m);if(b===null)return {txt:'Tendencia estable',c:GRIS};
 return {txt:(t.m>0?'Tendencia al alza':'Tendencia a la baja')+(b?' · bien':' · a mejorar'),c:colorDe(b)};}

// La gráfica (SVG). mini = la pequeña de la tarjeta. El periodo en curso sale con el punto hueco
function grafica(e,T,ahora,mini){const W=mini?300:340,H=mini?84:200,L=mini?4:38,R=mini?6:10,Tp=mini?8:12,B=mini?8:30;
 if(!T.length)return `<svg class="es-g${mini?' mini':''}" viewBox="0 0 ${W} ${H}"><text x="${W/2}" y="${H/2+4}" text-anchor="middle" class="es-vacia">Aún sin datos</text></svg>`;
 const pts=T.map(x=>({x:perIdx(e.periodo,x.s),y:x.v,a:x.actual,s:x.s}));
 const x0=pts[0].x,x1=Math.max(pts[pts.length-1].x,x0+1);
 let y0=Math.min(...pts.map(p=>p.y)),y1=Math.max(...pts.map(p=>p.y));if(y0>=0)y0=0;if(y0===y1)y1=y0+1;y1+=(y1-y0)*.08;
 const X=x=>L+(x-x0)/(x1-x0)*(W-L-R),Y=y=>Tp+(1-(y-y0)/(y1-y0))*(H-Tp-B);
 let s='';
 if(!mini){for(let i=0;i<=3;i++){const v=y0+(y1-y0)*i/3,y=Y(v);s+=`<line x1="${L}" x2="${W-R}" y1="${y}" y2="${y}" class="es-rej"/><text x="${L-6}" y="${y+3.5}" text-anchor="end" class="es-ej">${num(Math.round(v*10)/10)}</text>`;}
  s+=`<text x="${L}" y="${H-8}" class="es-ej">${escH(perCorto(e.periodo,pts[0].s))}</text><text x="${W-R}" y="${H-8}" text-anchor="end" class="es-ej">${escH(perCorto(e.periodo,pts[pts.length-1].s))}</text>`;}
 const C=pts.filter(p=>!p.a),t=tendencia(C);
 if(t){const xa=C[0].x,xb=x1;s+=`<line x1="${X(xa)}" y1="${Y(t.m*xa+t.b)}" x2="${X(xb)}" y2="${Y(t.m*xb+t.b)}" stroke="${colorDe(bueno(e,t.m))}" class="es-ten"/>`;}
 for(let i=1;i<pts.length;i++){const a=pts[i-1],b=pts[i];s+=b.a?`<line x1="${X(a.x)}" y1="${Y(a.y)}" x2="${X(b.x)}" y2="${Y(b.y)}" class="es-lin enc"/>`:`<line x1="${X(a.x)}" y1="${Y(a.y)}" x2="${X(b.x)}" y2="${Y(b.y)}" stroke="${colorDe(bueno(e,b.y-a.y))}" class="es-lin"/>`;}
 pts.forEach((p,i)=>{if(mini&&!p.a&&i<pts.length-1&&pts.length>12)return;s+=`<circle cx="${X(p.x)}" cy="${Y(p.y)}" r="${mini?2.6:3.6}" class="es-pt${p.a?' enc':''}"/>`;});
 return `<svg class="es-g${mini?' mini':''}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">${s}</svg>`;}

// 7R: esta semana hasta el corte, comparada con la semana pasada hasta el mismo punto
function sieteR(e,A,ahora,corte){const ini=perIni('semana',ahora),este=suma(A,ini,corte),antes=suma(A,ini-HS,corte-HS);return {ini,este,antes,d:este-antes};}
function grafica7R(e,A,ahora,corte){const W=340,H=130,L=8,R=8,T=10,B=22,ini=perIni('semana',ahora),fin=ini+HS;
 const acum=(a,b)=>{const P=[[0,0]];let t=0;A.filter(x=>x.L>=a&&x.L<b).sort((p,q)=>p.L-q.L).forEach(x=>{t+=Number(x.cantidad);P.push([x.L-a,t]);});return P;};
 const pa=acum(ini-HS,ini);pa.push([HS,pa[pa.length-1][1]]);const pe=acum(ini,Math.min(ahora,fin)+1);pe.push([Math.min(ahora,fin)-ini,pe[pe.length-1][1]]);
 const max=Math.max(1,...pa.map(p=>p[1]),...pe.map(p=>p[1]))*1.1,mn=Math.min(0,...pa.map(p=>p[1]),...pe.map(p=>p[1]));
 const X=x=>L+x/HS*(W-L-R),Y=y=>T+(1-(y-mn)/(max-mn))*(H-T-B);
 const esc=P=>P.map((p,i)=>(i?`H${X(p[0]).toFixed(1)}V${Y(p[1]).toFixed(1)}`:`M${X(p[0]).toFixed(1)} ${Y(p[1]).toFixed(1)}`)).join('');
 // Rayas a medianoche de cada día y el nombre del día en medio de su tramo (el jueves empieza a las 14:00)
 const d0=new Date(ini),m0=Date.UTC(d0.getUTCFullYear(),d0.getUTCMonth(),d0.getUTCDate());let s='';
 for(let k=0;k<=7;k++){const a=Math.max(ini,m0+k*HD),b=Math.min(fin,m0+(k+1)*HD);if(b<=a)continue;if(k>0)s+=`<line x1="${X(a-ini)}" x2="${X(a-ini)}" y1="${T}" y2="${H-B}" class="es-rej"/>`;
  if(b-a>=HD/3)s+=`<text x="${X((a+b)/2-ini)}" y="${H-7}" text-anchor="middle" class="es-ej">${DSEM[new Date(m0+k*HD).getUTCDay()]}</text>`;}
 const xc=X(corte-ini);
 s+=`<path d="${esc(pa)}" class="es-7a"/><path d="${esc(pe)}" class="es-7e"/><line x1="${xc}" x2="${xc}" y1="${T-4}" y2="${H-B}" class="es-7c"/>`;
 return `<svg class="es-g es-7g" viewBox="0 0 ${W} ${H}">${s}</svg>`;}

async function renderEstadisticas(wrap){const box=ce('div','es');wrap.appendChild(box);box.innerHTML='<div class="rp-c" style="color:var(--mut);font-size:13px">Cargando…</div>';
 const yo=S.yo.id;if(ES.persona&&!visibles().some(m=>m.id===ES.persona)){ES.persona='';ES.abierta='';esGuarda();}
 const persona=()=>ES.persona||yo;
 let E=[],AP={};
 const carga=async()=>{const {data,error}=await sb.from('pb_estadisticas').select('*').eq('persona',persona()).order('creado');
  if(!box.isConnected)return;if(error){box.innerHTML='<div class="rp-c">No se ha podido cargar. Vuelve a intentarlo.</div>';return;}
  E=data||[];AP={};E.forEach(e=>AP[e.id]=[]);
  if(E.length){const {data:a}=await sb.from('pb_apuntes').select('*').in('estadistica_id',E.map(e=>e.id)).order('en');(a||[]).forEach(x=>{x.L=madMs(x.en);(AP[x.estadistica_id]=AP[x.estadistica_id]||[]).push(x);});}
  if(ES.abierta&&!E.some(e=>e.id===ES.abierta)){ES.abierta='';esGuarda();}
  pinta3();};
 window._esRecargar=carga;
 const quien=()=>{const V=visibles();return V.length>1?`<div class="pb-who">${V.map(m=>`<button type="button" data-p="${m.id}" class="${m.id===persona()?'on':''}">${m.id===yo?'Yo':escH(pri(m.nombre))}</button>`).join('')}</div>`:'';};
 const chipsQuien=()=>box.querySelectorAll('.pb-who button').forEach(b=>b.onclick=()=>{ES.persona=b.dataset.p===yo?'':b.dataset.p;ES.abierta='';esGuarda();carga();});
 const pinta3=()=>{if(ES.abierta)return detalle(E.find(e=>e.id===ES.abierta));
  const y=window.scrollY,ahora=madMs(Date.now()),yoMismo=persona()===yo,nom=pri(nomDe(persona()));
  const act=E.filter(e=>!e.archivada),arc=E.filter(e=>e.archivada);
  const tarj=e=>{const A=AP[e.id]||[],T=totales(e,A,ahora),tt=textoTendencia(e,T),cur=T.length?T[T.length-1]:null;
   let der='';if(e.periodo==='semana'){const r=sieteR(e,A,ahora,ahora);der=`<div class="es-ult"><b>${num(r.este)}</b>${r.d?`<i style="color:${colorDe(bueno(e,r.d))}">${r.d>0?'▲':'▼'} ${num(Math.abs(r.d))} <span>7R</span></i>`:'<i style="color:'+GRIS+'">= <span>7R</span></i>'}<small>Esta semana</small></div>`;}
   else if(cur){der=`<div class="es-ult"><b>${num(cur.v)}</b><small>${escH(perLargo(e.periodo,cur.s,ahora))}</small></div>`;}
   return `<button type="button" class="rp-c es-c" data-e="${e.id}"><div class="es-ch"><div><small>${escH(e.puesto||'Estadística')}</small><b>${escH(e.nombre)}</b></div>${der}</div>${grafica(e,T,ahora,true)}<div class="es-pie"><span style="color:${tt.c}">${escH(tt.txt)}</span><em>${escH(e.eje_y)} · ${PER[e.periodo].n.toLowerCase()}</em></div></button>`;};
  box.innerHTML=quien()+`<div class="rp-c"><div class="eq-h"><div><small>Estadísticas</small><b>${yoMismo?'Tus estadísticas':'Estadísticas de '+escH(nom)}</b></div><button class="bt" id="esNueva">+ Nueva</button></div>
   ${!act.length?`<p class="eq-p">${yoMismo?'Crea tu primera estadística: lo que produce tu puesto (cursos completados, pacientes nuevos…). Vas apuntando lo que haces y se grafea sola, semana a semana (de jueves a las 14:00 a jueves a las 14:00), con su tendencia y su 7R.':'Aún no tiene estadísticas. Puedes crearle una.'}</p>`:''}</div>
   ${act.map(tarj).join('')}${arc.length?`<details class="es-arc"><summary>Archivadas (${arc.length})</summary>${arc.map(tarj).join('')}</details>`:''}`;
  chipsQuien();box.querySelector('#esNueva').onclick=()=>editarEst(null);
  box.querySelectorAll('[data-e]').forEach(b=>b.onclick=()=>{ES.abierta=b.dataset.e;esGuarda();pinta3();window.scrollTo(0,0);});
  window.scrollTo(0,y);};

 // Una estadística en grande: gráfica, 7R, apuntar y lo apuntado
 const detalle=e=>{if(!e){ES.abierta='';esGuarda();return pinta3();}
  const y=window.scrollY,ahora=madMs(Date.now()),A=AP[e.id]||[],T=totales(e,A,ahora),tt=textoTendencia(e,T),actual=perIni(e.periodo,ahora);
  let ver=ES.ver[e.id]||actual;if(ver>actual)ver=actual;
  // 7R: el día que se mira (por defecto hoy) a la hora de ahora
  let r7='';if(e.periodo==='semana'){const ini=actual,nd=Math.floor((ahora-ini)/HD+1e-9),hoyI=Math.floor((Date.UTC(new Date(ahora).getUTCFullYear(),new Date(ahora).getUTCMonth(),new Date(ahora).getUTCDate())-Date.UTC(new Date(ini).getUTCFullYear(),new Date(ini).getUTCMonth(),new Date(ini).getUTCDate()))/HD);
   const tod=ahora-Date.UTC(new Date(ahora).getUTCFullYear(),new Date(ahora).getUTCMonth(),new Date(ahora).getUTCDate());
   let di=ES.dia7[e.id];if(di==null||di>hoyI)di=hoyI;
   const diaIni=i=>Date.UTC(new Date(ini).getUTCFullYear(),new Date(ini).getUTCMonth(),new Date(ini).getUTCDate()+i);
   const corte=Math.min(ahora,Math.max(ini,diaIni(di)+tod)),R=sieteR(e,A,ahora,corte),b=bueno(e,R.d);
   r7=`<div class="rp-c es-7"><div class="eq-h"><div><small>7R</small><b>Cómo vamos frente a la semana pasada</b></div></div>
    <div class="chs es-7d">${[...Array(hoyI+1)].map((_,i)=>`<button type="button" data-i="${i}" class="${i===di?'on':''}">${DSEM[new Date(diaIni(i)).getUTCDay()]} ${new Date(diaIni(i)).getUTCDate()}</button>`).join('')}</div>
    <div class="es-7n"><div><small>Esta semana · hasta el ${escH(dLargo(corte))} a las ${hhmm(corte)}</small><b>${num(R.este)}</b></div><div><small>La semana pasada · hasta el ${escH(dLargo(corte-HS))} a las ${hhmm(corte-HS)}</small><b class="ant">${num(R.antes)}</b></div></div>
    <div class="es-7r" style="color:${colorDe(b)}">${R.d?`${R.d>0?'▲':'▼'} ${num(Math.abs(R.d))} ${R.d>0?'más':'menos'} que la semana pasada a estas horas${b?' · bien':' · a mejorar'}`:'Igual que la semana pasada a estas horas'}</div>
    ${grafica7R(e,A,ahora,corte)}<div class="es-ley"><span><i style="background:var(--c)"></i>Esta semana</span><span><i class="dash"></i>Semana pasada</span></div>
    <p class="es-not">La semana va de jueves a las 14:00 a jueves a las 14:00.</p></div>`;}
  // Lo apuntado en el periodo que se mira
  const fin=perSig(e.periodo,ver),Av=A.filter(x=>x.L>=ver&&x.L<fin).sort((a,b)=>b.L-a.L),totV=Av.reduce((t,x)=>t+Number(x.cantidad),0);
  const cu=ES.cuando[e.id]||null;
  box.innerHTML=quien()+`<button type="button" class="es-atras"><svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg>Estadísticas</button>
   <div class="rp-c"><div class="eq-h"><div><small>${escH(e.puesto||'Estadística')}</small><b>${escH(e.nombre)}</b></div><button class="mas3" aria-label="Opciones">⋯</button></div>
    <div class="es-sen"><span class="es-tag ${e.sentido}">${e.sentido==='positiva'?'Positiva · si sube, es bueno':'Negativa · si sube, es malo'}</span>${A.length?`<span style="color:${tt.c};font-weight:600">${escH(tt.txt)}</span>`:''}</div></div>
   <div class="rp-c"><div class="es-ap"><small>Apuntar ${escH(e.eje_y.toLowerCase())}</small>
    <div class="es-in"><input class="i" inputmode="decimal" autocomplete="off" placeholder="¿Cuántos? Ej.: 1" value="${escH(ES.cant[e.id]||'')}"><button class="bt" id="esGuardar">Apuntar</button></div>
    <div class="es-cu"><span>Cuándo:</span><div class="chs"><button type="button" data-c="ahora" class="${cu?'':'on'}">${IC.ck}Ahora</button><button type="button" data-c="otro" class="${cu?'on':''}">${IC.ck}Otro momento</button></div></div>
    ${cu?`<div class="es-mo"><div class="es-per"><button type="button" class="pb-fl" data-d="-1" aria-label="Día anterior"><svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg></button><b>${escH(dLargo(cu))}</b><button type="button" class="pb-fl" data-d="1" aria-label="Día siguiente"${cu+HD>ahora?' disabled':''}><svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg></button></div>
     <div class="es-per"><button type="button" class="pb-fl" data-h="-1" aria-label="Una hora antes"><svg viewBox="0 0 24 24"><path d="M6 12h12"/></svg></button><b>${hhmm(cu)}</b><button type="button" class="pb-fl" data-h="1" aria-label="Una hora después"${cu+36e5>ahora?' disabled':''}><svg viewBox="0 0 24 24"><path d="M12 6v12M6 12h12"/></svg></button></div></div>`:''}</div></div>
   ${r7&&A.length?r7:''}
   ${A.length?`<div class="rp-c"><div class="eq-h"><div><small>Gráfica</small><b>${escH(e.eje_y)} por ${e.periodo==='semana'?'semana':e.periodo==='dia'?'día':'mes'}</b></div></div><div class="es-gw"><span class="es-ey">${escH(e.eje_y)}</span>${grafica(e,T,ahora,false)}</div><div class="es-ex">${PER[e.periodo].n}${e.periodo==='semana'?' (de jueves 14:00 a jueves 14:00)':''}</div>
    <div class="es-ley"><span><i style="background:${VERDE}"></i>Va bien</span><span><i style="background:${ROJO}"></i>Va mal</span><span><i class="dash"></i>Tendencia</span><span><i class="hue"></i>En curso</span></div></div>`:`<div class="rp-c eq-ayuda"><b>¿Cómo funciona?</b><p>Cada vez que hagas algo de esta estadística, apúntalo arriba (por ejemplo, <b>1</b> por cada curso completado). La app lo suma por ${e.periodo==='semana'?'semanas (de jueves a las 14:00 a jueves a las 14:00)':e.periodo==='dia'?'días':'meses'} y hace la gráfica con su tendencia${e.periodo==='semana'?', y te compara con la semana pasada a la misma hora (7R)':''}.</p></div>`}
   ${A.length?`<div class="rp-c"><div class="es-per"><button type="button" class="pb-fl" data-v="-1" aria-label="Anterior"${T.length&&ver<=T[0].s?' disabled':''}><svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg></button><b>${escH(perLargo(e.periodo,ver,ahora))}<small>Total: ${num(totV)}</small></b><button type="button" class="pb-fl" data-v="1" aria-label="Siguiente"${ver>=actual?' disabled':''}><svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg></button></div>
    ${Av.length?Av.map(x=>`<div class="es-fila" data-id="${x.id}"><span>${escH(dLargo(x.L))} · ${hhmm(x.L)}${x.por&&x.por!==e.persona?` <em>· ${escH(pri(nomDe(x.por)))}</em>`:''}</span><b>${Number(x.cantidad)>0?'+':''}${num(x.cantidad)}</b><button type="button" class="es-x" aria-label="Quitar"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>`).join(''):'<p class="vacio">Nada apuntado en este periodo.</p>'}</div>`:''}`;
  box.querySelector('.es-atras').onclick=()=>{ES.abierta='';esGuarda();pinta3();};chipsQuien();
  box.querySelectorAll('.es-7d [data-i]').forEach(b=>b.onclick=()=>{ES.dia7[e.id]=+b.dataset.i;detalle(e);});
  box.querySelectorAll('[data-v]').forEach(b=>b.onclick=()=>{ES.ver[e.id]=+b.dataset.v<0?perAnt(e.periodo,ver):perSig(e.periodo,ver);detalle(e);});
  box.querySelectorAll('[data-c]').forEach(b=>b.onclick=()=>{ES.cuando[e.id]=b.dataset.c==='otro'?(Math.floor(ahora/36e5)*36e5):null;detalle(e);});
  box.querySelectorAll('[data-d]').forEach(b=>b.onclick=()=>{ES.cuando[e.id]=Math.min(ahora,cu+ +b.dataset.d*HD);detalle(e);});
  box.querySelectorAll('[data-h]').forEach(b=>b.onclick=()=>{ES.cuando[e.id]=Math.min(ahora,cu+ +b.dataset.h*36e5);detalle(e);});
  const inp=box.querySelector('.es-in input'),bt=box.querySelector('#esGuardar');inp.oninput=()=>{ES.cant[e.id]=inp.value;};
  const guarda=async()=>{const t=inp.value.trim().replace(/\s/g,'').replace(/\.(?=\d{3}(\D|$))/g,'').replace(',','.');const v=Number(t);if(!t||!isFinite(v)){toast('Escribe un número',false);inp.focus();return;}bt.disabled=true;
   const en=cu?new Date(realMs(cu)).toISOString():new Date().toISOString();
   const {data,error}=await sb.from('pb_apuntes').insert({estadistica_id:e.id,en,cantidad:v,por:yo}).select().single();
   bt.disabled=false;if(error){toast('No se ha podido apuntar',false);return;}
   data.L=madMs(data.en);A.push(data);AP[e.id]=A;ES.cant[e.id]='';ES.ver[e.id]=perIni(e.periodo,data.L);toast('Apuntado');detalle(e);};
  bt.onclick=guarda;inp.onkeydown=ev=>{if(ev.key==='Enter'){ev.preventDefault();guarda();}};
  box.querySelectorAll('.es-x').forEach(b=>b.onclick=()=>{const id=b.closest('.es-fila').dataset.id,x=A.find(z=>z.id===id);if(!x)return;
   pregunta('¿Quitar este apunte ('+num(x.cantidad)+')?',{si:'Quitar'}).then(async ok=>{if(!ok)return;const {error}=await sb.from('pb_apuntes').delete().eq('id',id);if(error){toast('No se ha podido',false);return;}AP[e.id]=A.filter(z=>z.id!==id);detalle(e);});});
  box.querySelector('.mas3').onclick=()=>{const m=modal(`<h3>${escH(e.nombre)}</h3><div style="margin-top:10px">
   <button class="op" data-a="ed"><svg viewBox="0 0 24 24"><path d="M4 20h4L18.5 9.5a2.8 2.8 0 0 0-4-4L4 16z"/></svg>Cambiar la estadística</button>
   <button class="op" data-a="ar"><svg viewBox="0 0 24 24"><path d="M4 7h16v13H4zM2 3h20v4H2zM10 12h4"/></svg>${e.archivada?'Sacar de archivadas':'Archivar'}</button>
   <button class="op rojo" data-a="bo"><svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>Borrar con todos sus datos</button></div>`);
   m.querySelector('[data-a="ed"]').onclick=()=>{m.remove();editarEst(e);};
   m.querySelector('[data-a="ar"]').onclick=async()=>{m.remove();const {error}=await sb.from('pb_estadisticas').update({archivada:!e.archivada}).eq('id',e.id);if(error){toast('No se ha podido',false);return;}e.archivada=!e.archivada;toast(e.archivada?'Archivada':'Vuelve a estar activa');ES.abierta='';esGuarda();pinta3();};
   m.querySelector('[data-a="bo"]').onclick=()=>{m.remove();pregunta('¿Borrar «'+e.nombre+'» y todos sus datos?',{sub:'No se puede deshacer. Si solo quieres que no salga, archívala.',si:'Borrar'}).then(async ok=>{if(!ok)return;const {error}=await sb.from('pb_estadisticas').delete().eq('id',e.id);if(error){toast('No se ha podido',false);return;}ES.abierta='';esGuarda();carga();});};};
  window.scrollTo(0,y);};

 // Crear o cambiar una estadística
 const editarEst=e=>{const per=persona(),pm=M(per)||{},v={puesto:e?e.puesto:(pm.puesto||''),nombre:e?e.nombre:'',eje_y:e?e.eje_y:'',periodo:e?e.periodo:'semana',sentido:e?e.sentido:'positiva'};
  const m=modal(`<h3>${e?'Cambiar la estadística':'Nueva estadística'}${per===yo?'':' para '+escH(pri(pm.nombre))}</h3>
   <label class="l">Puesto</label><input class="i" name="puesto" maxlength="60" value="${escH(v.puesto||'')}" placeholder="Ej.: Recepción, Fisioterapeuta…">
   <label class="l">Nombre de la estadística</label><input class="i" name="nombre" maxlength="80" value="${escH(v.nombre)}" placeholder="Ej.: Cursos completados">
   <label class="l">¿Qué cuentas? (columna vertical)</label><input class="i" name="eje_y" maxlength="60" value="${escH(v.eje_y)}" placeholder="Ej.: nº de cursos, pacientes, euros"><p class="es-ayu">Lo que vas sumando cada vez que apuntas. Aquí no va un número.</p>
   <label class="l">Columna horizontal</label><div class="chs es-op" data-k="periodo">${[['semana','Semanas (jue 14:00 a jue 14:00)'],['dia','Días'],['mes','Meses']].map(([k,t])=>`<button type="button" data-v="${k}" class="${v.periodo===k?'on':''}">${IC.ck}${t}</button>`).join('')}</div>
   <label class="l">¿Es positiva o negativa?</label><div class="es-sn" data-k="sentido">
    <button type="button" data-v="positiva" class="${v.sentido==='positiva'?'on':''}"><svg viewBox="0 0 24 24"><path d="M4 17l6-6 4 4 6-7M20 8v5M20 8h-5"/></svg><span><b>Positiva</b><small>Si sube, es bueno</small></span></button>
    <button type="button" data-v="negativa" class="${v.sentido==='negativa'?'on':''}"><svg viewBox="0 0 24 24"><path d="M4 7l6 6 4-4 6 7M20 16v-5M20 16h-5"/></svg><span><b>Negativa</b><small>Si sube, es malo</small></span></button></div>
   <div class="err"></div><div class="bts"><button class="bt sec" data-x>Cancelar</button><button class="bt" data-ok>${e?'Guardar':'Crear'}</button></div>`);
  m.querySelectorAll('[data-k]').forEach(g=>g.querySelectorAll('button').forEach(b=>b.onclick=()=>{v[g.dataset.k]=b.dataset.v;g.querySelectorAll('button').forEach(x=>x.classList.toggle('on',x===b));}));
  m.querySelector('[data-x]').onclick=()=>m.remove();
  m.querySelector('[data-ok]').onclick=async ev=>{const g=n=>m.querySelector(`[name="${n}"]`).value.trim();v.puesto=g('puesto');v.nombre=g('nombre');v.eje_y=g('eje_y');
   if(!v.nombre||!v.eje_y){m.querySelector('.err').textContent='Pon el nombre y qué cuentas';return;}
   if(/^[\d\s.,]+$/.test(v.eje_y)){m.querySelector('.err').textContent='En «¿Qué cuentas?» va lo que cuentas (por ejemplo «nº de cursos»), no una cantidad';return;}ev.target.disabled=true;
   const campos={puesto:v.puesto||null,nombre:v.nombre,eje_y:v.eje_y,periodo:v.periodo,sentido:v.sentido};
   const r=e?await sb.from('pb_estadisticas').update(campos).eq('id',e.id).select().single():await sb.from('pb_estadisticas').insert({...campos,equipo_id:S.yo.equipo_id,persona:per,por:yo}).select().single();
   if(r.error){ev.target.disabled=false;m.querySelector('.err').textContent='No se ha podido guardar';return;}
   m.remove();toast(e?'Guardada':'Creada');ES.abierta=(r.data&&r.data.id)||(e&&e.id)||'';esGuarda();carga();};};
 carga();}
