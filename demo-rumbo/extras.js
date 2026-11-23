// ── PRODUCTOS DE CADA PUESTO: lo que produce cada puesto, y debajo de cada producto sus subproductos.
// Los ve todo el equipo; los cambia la propia persona, su jefe o quien administra.
const PR={L:[]};
async function cargaProductos(){const {data}=await sb.from('pb_productos').select('*').eq('equipo_id',S.yo.equipo_id).order('orden').order('creado');PR.L=data||[];}
const prDe=p=>PR.L.filter(x=>x.persona===p&&!x.padre);
const subDe=id=>PR.L.filter(x=>x.padre===id);
const puedePr=p=>puedeEst(p)||!!S.yo.admin;
const IC_PR='<svg viewBox="0 0 24 24"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9"/></svg>';
function chipProductos(p){const n=prDe(p).length;return `<button type="button" class="pr-chip" data-pr="${p}">${IC_PR}${n?n+' producto'+(n===1?'':'s'):'Productos'}</button>`;}
function abreProductos(pid){const p=M(pid);if(!p)return;const ed=puedePr(pid);
 const m=modal('<div class="pr-box"></div>');const box=m.querySelector('.pr-box');
 const pinta=()=>{const L=prDe(pid);
  box.innerHTML=`<small class="cd-k">Productos del puesto</small><h3>${escH(p.puesto||'Puesto de '+pri(p.nombre))}</h3><p>${pid===S.yo.id?'Lo que produce tu puesto':'Lo que produce el puesto de '+escH(pri(p.nombre))}. Debajo de cada producto, sus subproductos: lo que hay que conseguir para llegar a él.</p>
   <div class="pr-l">${L.map((x,i)=>`<div class="pr-p" data-id="${x.id}"><div class="pr-f"><span class="pr-n">${i+1}</span><b class="pr-t"${ed?' data-ed':''}>${escH(x.texto)}</b>${ed?`<button type="button" class="pr-x" aria-label="Quitar"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>`:''}</div>
    <div class="pr-s">${subDe(x.id).map(s=>`<div class="pr-f sub" data-id="${s.id}"><span class="pr-d"></span><span class="pr-t"${ed?' data-ed':''}>${escH(s.texto)}</span>${ed?`<button type="button" class="pr-x" aria-label="Quitar"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>`:''}</div>`).join('')}
     ${ed?`<form class="pr-add sub" data-padre="${x.id}"><input class="i" maxlength="200" placeholder="+ Subproducto"><button class="pr-ok" aria-label="Añadir">${IC.ck}</button></form>`:''}</div></div>`).join('')||`<p class="vacio">${ed?'Aún no hay productos. Escribe el primero aquí abajo.':'Aún no tiene productos.'}</p>`}</div>
   ${ed?`<form class="pr-add" data-padre=""><input class="i" maxlength="200" placeholder="+ Producto del puesto"><button class="pr-ok" aria-label="Añadir">${IC.ck}</button></form>`:''}
   <div class="bts"><button class="bt" data-x>Listo</button></div>`;
  box.querySelector('[data-x]').onclick=()=>{m.remove();refrescaPr();};
  box.querySelectorAll('.pr-add').forEach(f=>f.onsubmit=async e=>{e.preventDefault();const i=f.querySelector('input'),t=i.value.trim();if(!t)return;const padre=f.dataset.padre||null;
   const orden=(padre?subDe(padre):prDe(pid)).length;const {data,error}=await sb.from('pb_productos').insert({equipo_id:S.yo.equipo_id,persona:pid,padre,texto:t,orden}).select().single();
   if(error){toast('No se ha podido guardar',false);return;}PR.L.push(data);pinta();const n=box.querySelector(`.pr-add[data-padre="${padre||''}"] input`);n&&n.focus();});
  box.querySelectorAll('.pr-x').forEach(b=>b.onclick=()=>{const id=b.closest('[data-id]').dataset.id,x=PR.L.find(z=>z.id===id);if(!x)return;
   const n=subDe(id).length;pregunta('¿Quitar «'+x.texto+'»?',{sub:n?'Se quitan también sus '+n+' subproducto'+(n===1?'':'s')+'.':'',si:'Quitar'}).then(async ok=>{if(!ok)return;const {error}=await sb.from('pb_productos').delete().eq('id',id);if(error){toast('No se ha podido',false);return;}PR.L=PR.L.filter(z=>z.id!==id&&z.padre!==id);pinta();});});
  box.querySelectorAll('.pr-t[data-ed]').forEach(t=>t.onclick=()=>{const id=t.closest('[data-id]').dataset.id,x=PR.L.find(z=>z.id===id);if(!x)return;
   const k=modal(`<h3>${x.padre?'Cambiar el subproducto':'Cambiar el producto'}</h3><input class="i" maxlength="200" value="${escH(x.texto)}"><div class="bts"><button class="bt sec" data-x>Cancelar</button><button class="bt" data-ok>Guardar</button></div>`);
   const i=k.querySelector('input');i.focus();k.querySelector('[data-x]').onclick=()=>k.remove();
   const ok=async()=>{const v=i.value.trim();if(!v)return;k.remove();if(v===x.texto)return;const {error}=await sb.from('pb_productos').update({texto:v}).eq('id',id);if(error){toast('No se ha podido',false);return;}x.texto=v;pinta();};
   k.querySelector('[data-ok]').onclick=ok;i.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();ok();}};});};
 pinta();m.addEventListener('click',e=>{if(e.target===m)refrescaPr();});}
function refrescaPr(){if(S.tab==='equipo')renderEquipoOtraVez();}

// ── ALARMAS: una tarea puede tener hora. Si lleva aviso, a esa hora (o un rato antes) suena en el móvil, aunque Rumbo esté cerrado.
const VAPID='BPTvLesfrnlH2cRtuqktpa_tghYpbzHMZEUERnvFmAiEjricNd9zxuC8ue0-8l4Eb4VqlKs_YRLniXL0fgkqwGU';
const AVISOS=[[0,'A la hora'],[5,'5 min antes'],[15,'15 min antes'],[30,'30 min antes'],[60,'1 h antes'],[null,'Sin aviso']];
const IC_RELOJ='<svg viewBox="0 0 24 24"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2M5 4.5 3 6.5M19 4.5l2 2"/></svg>';
const hhmm5=h=>String(h||'').slice(0,5);
const avisoTxt=a=>a==null?'':a===0?'aviso a la hora':'aviso '+(a>=60?a/60+' h':a+' min')+' antes';
const esIOS=()=>/iphone|ipad|ipod/i.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
const instalada=()=>window.matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
const pushPosible=()=>'serviceWorker' in navigator&&'PushManager' in window&&'Notification' in window;
async function avisosActivos(){try{if(!pushPosible()||Notification.permission!=='granted')return false;const r=await navigator.serviceWorker.ready;return !!(await r.pushManager.getSubscription());}catch(e){return false;}}
const b64=s=>{const p='='.repeat((4-s.length%4)%4),b=atob((s+p).replace(/-/g,'+').replace(/_/g,'/'));return Uint8Array.from([...b].map(c=>c.charCodeAt(0)));};
// Se llama desde un toque (los navegadores solo dejan pedir permiso así)
async function activaAvisos(){
 if(!pushPosible()){modal(esIOS()&&!instalada()?`<h3>Primero, instala Rumbo</h3><p>En el iPhone los avisos solo llegan con Rumbo instalado: en Safari, toca <b>Compartir</b> y luego <b>«Añadir a pantalla de inicio»</b>. Ábrela desde el icono y actívalos desde tu inicial, arriba a la derecha.</p><div class="bts"><button class="bt" onclick="this.closest('.mod').remove()">Entendido</button></div>`:`<h3>Este navegador no puede</h3><p>Abre Rumbo en Chrome (Android u ordenador) o instálala en el iPhone para recibir los avisos.</p><div class="bts"><button class="bt" onclick="this.closest('.mod').remove()">Entendido</button></div>`);return false;}
 try{const per=await Notification.requestPermission();if(per!=='granted'){toast('Sin permiso no te pueden llegar los avisos',false);return false;}
  const r=await navigator.serviceWorker.ready;let s=await r.pushManager.getSubscription();if(!s)s=await r.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:b64(VAPID)});
  const j=s.toJSON();const {error}=await sb.rpc('pb_push_guardar',{ep:j.endpoint,k:j.keys.p256dh,a:j.keys.auth});if(error)throw error;toast('Avisos activados en este móvil');return true;}
 catch(e){toast('No se han podido activar los avisos',false);return false;}}
async function desactivaAvisos(){try{const r=await navigator.serviceWorker.ready,s=await r.pushManager.getSubscription();if(s){await sb.from('pb_push').delete().eq('endpoint',s.endpoint);await s.unsubscribe();}toast('Avisos desactivados en este móvil');}catch(e){toast('No se ha podido',false);}}
async function pruebaAvisos(){const {data:{session}}=await sb.auth.getSession();try{const r=await fetch(SB_URL+'/functions/v1/rumbo-avisos?prueba=yo',{method:'POST',headers:{Authorization:'Bearer '+session.access_token,apikey:SB_KEY}});const j=await r.json();toast(j.enviados?'Enviado: te tiene que llegar ahora':'No ha llegado a ningún móvil',!!j.enviados);}catch(e){toast('No se ha podido',false);}}
async function menuAvisos(){const on=await avisosActivos();const m=modal(`<h3>Avisos en este móvil</h3><p>Cuando una tarea tiene hora y aviso, te suena aquí a su hora, aunque Rumbo esté cerrado. Si usas Rumbo en varios aparatos, actívalos en cada uno.</p>
 <div style="margin-top:10px">${on?`<button class="op" data-a="pr">${IC_RELOJ}Enviarme un aviso de prueba</button><button class="op rojo" data-a="off"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>Desactivar en este móvil</button>`:`<button class="op" data-a="on">${IC_RELOJ}Activar los avisos aquí</button>`}</div>`);
 const on1=(a,f)=>{const b=m.querySelector(`[data-a="${a}"]`);if(b)b.onclick=()=>{m.remove();f();};};on1('on',activaAvisos);on1('off',desactivaAvisos);on1('pr',pruebaAvisos);}
// Elegir la hora y el aviso de una tarea. ok({hora,aviso}) — hora null = sin hora
function eligeHora(x,ok){let h=x.hora?+x.hora.slice(0,2):(new Date().getHours()+1)%24,mi=x.hora?+x.hora.slice(3,5):0,av=x.hora?(x.aviso==null?null:x.aviso):15;
 const m=modal(`<small class="cd-k">Hora y aviso</small><h3>${escH(String(x.t||'').replace(/\*\*|__|==/g,''))}</h3>
  <label class="l">Hora</label><div class="hr-pk"><div class="es-per"><button type="button" class="pb-fl" data-h="-1" aria-label="Una hora menos"><svg viewBox="0 0 24 24"><path d="M6 12h12"/></svg></button><b data-v="h"></b><button type="button" class="pb-fl" data-h="1" aria-label="Una hora más"><svg viewBox="0 0 24 24"><path d="M12 6v12M6 12h12"/></svg></button></div><span class="hr-dp">:</span>
   <div class="es-per"><button type="button" class="pb-fl" data-m="-5" aria-label="Cinco minutos menos"><svg viewBox="0 0 24 24"><path d="M6 12h12"/></svg></button><b data-v="m"></b><button type="button" class="pb-fl" data-m="5" aria-label="Cinco minutos más"><svg viewBox="0 0 24 24"><path d="M12 6v12M6 12h12"/></svg></button></div></div>
  <label class="l">Aviso al móvil</label><div class="chs" id="hrAv">${AVISOS.map(([v,t])=>`<button type="button" data-a="${v==null?'':v}" class="${av===v?'on':''}">${IC.ck}${t}</button>`).join('')}</div>
  <div class="bts">${x.hora?'<button class="bt sec" data-q>Quitar la hora</button>':'<button class="bt sec" data-x>Cancelar</button>'}<button class="bt" data-ok>Guardar</button></div>`);
 const pon=()=>{m.querySelector('[data-v="h"]').textContent=String(h).padStart(2,'0');m.querySelector('[data-v="m"]').textContent=String(mi).padStart(2,'0');};pon();
 m.querySelectorAll('[data-h]').forEach(b=>b.onclick=()=>{h=(h+ +b.dataset.h+24)%24;pon();});
 m.querySelectorAll('[data-m]').forEach(b=>b.onclick=()=>{mi=(mi+ +b.dataset.m+60)%60;pon();});
 m.querySelectorAll('#hrAv [data-a]').forEach(b=>b.onclick=()=>{av=b.dataset.a===''?null:+b.dataset.a;m.querySelectorAll('#hrAv button').forEach(z=>z.classList.toggle('on',z===b));});
 {const c=m.querySelector('[data-x]');if(c)c.onclick=()=>m.remove();}{const q=m.querySelector('[data-q]');if(q)q.onclick=()=>{m.remove();ok({hora:null,aviso:null});};}
 m.querySelector('[data-ok]').onclick=async()=>{m.remove();ok({hora:String(h).padStart(2,'0')+':'+String(mi).padStart(2,'0'),aviso:av});
  // Si la tarea es tuya y lleva aviso, que este móvil esté listo para recibirlo
  if(av!=null&&x.persona===S.yo.id&&!(await avisosActivos())){const k=modal(`<h3>¿Activamos los avisos en este móvil?</h3><p>Para que te suene a su hora, aunque tengas Rumbo cerrado.</p><div class="bts"><button class="bt sec" data-x>Ahora no</button><button class="bt" data-ok>Activar</button></div>`);
   k.querySelector('[data-x]').onclick=()=>k.remove();k.querySelector('[data-ok]').onclick=()=>{k.remove();activaAvisos();};}};}
