const SB_URL='https://fpgkqyegpiyzmtdcgdgw.supabase.co',SB_KEY='sb_publishable_cJkpkohEZh7Kyxss3LrwAA_uRYnWdN6';
const sb=window.supabase.createClient(SB_URL,SB_KEY,{auth:{persistSession:true,autoRefreshToken:true,storageKey:'plan-batalla'}});
const $app=document.getElementById('app');
const escH=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ce=(t,c)=>{const e=document.createElement(t);if(c)e.className=c;return e;};
const ini=n=>String(n||'?').trim().charAt(0).toUpperCase();
const pri=n=>String(n||'').split(' ')[0];
const IC={ck:'<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>'};
const guardaLS=(k,v)=>{try{localStorage.setItem('pb_'+k,JSON.stringify(v));}catch(e){}};
const leeLS=(k,d)=>{try{const v=localStorage.getItem('pb_'+k);return v==null?d:JSON.parse(v);}catch(e){return d;}};

// Contraseñas: botón del ojo para ver lo que has escrito
const OJO='<svg viewBox="0 0 24 24"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',OJO_NO='<svg viewBox="0 0 24 24"><path d="M3 3l18 18M10.6 5.1A10.9 10.9 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6C3.9 8.3 2 12 2 12s3.6 7 10 7a9.7 9.7 0 0 0 4.4-1.1M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';
function ojos(root){(root||document).querySelectorAll('input[type="password"]:not([data-ojo])').forEach(i=>{i.dataset.ojo=1;const w=ce('span','pw');i.parentNode.insertBefore(w,i);w.appendChild(i);
 const b=ce('button','pw-b');b.type='button';b.setAttribute('aria-label','Ver la contraseña');b.innerHTML=OJO;w.appendChild(b);
 b.onmousedown=e=>e.preventDefault();b.onclick=()=>{const ver=i.type==='password';i.type=ver?'text':'password';b.innerHTML=ver?OJO_NO:OJO;b.setAttribute('aria-label',ver?'Ocultar la contraseña':'Ver la contraseña');};});}
function toast(t,ok){const e=ce('div','toast '+(ok===false?'err':'ok'));e.textContent=t;document.body.appendChild(e);setTimeout(()=>e.remove(),2600);}
function modal(html){const m=ce('div','mod');m.innerHTML=`<div class="hoja">${html}</div>`;m.addEventListener('click',e=>{if(e.target===m)m.remove();});document.body.appendChild(m);return m;}
function pregunta(txt,o){o=o||{};return new Promise(res=>{const m=modal(`<h3>${escH(txt)}</h3>${o.sub?`<p>${escH(o.sub)}</p>`:''}<div class="bts"><button class="bt sec" data-r="0">Cancelar</button><button class="bt" data-r="1">${escH(o.si||'Sí')}</button></div>`);
 m.querySelectorAll('[data-r]').forEach(b=>b.onclick=()=>{m.remove();res(b.dataset.r==='1');});m.addEventListener('click',e=>{if(e.target===m)res(false);});});}

// Foto o inicial
const pTag=(m,vac)=>m&&m.puesto?`<span class="pto">${escH(m.puesto)}</span>`:(vac?'<span class="pto vac">Sin puesto</span>':'');
const avHTML=(m,st)=>`<span class="av"${st?` style="${st}"`:''}>${m&&m.foto?`<img src="${escH(m.foto)}" alt="">`:escH(ini(m?m.nombre:'?'))}</span>`;
function eligeFoto(){return new Promise(res=>{const i=ce('input');i.type='file';i.accept='image/*';i.onchange=()=>res(i.files&&i.files[0]||null);i.click();});}
async function subirFoto(nombre){const f=await eligeFoto();if(!f)return null;
 const img=await new Promise((ok,ko)=>{const u=URL.createObjectURL(f),x=new Image();x.onload=()=>ok(x);x.onerror=ko;x.src=u;});
 const t=320,c=document.createElement('canvas');c.width=c.height=t;const lado=Math.min(img.width,img.height);
 c.getContext('2d').drawImage(img,(img.width-lado)/2,(img.height-lado)/2,lado,lado,0,0,t,t);
 const blob=await new Promise(r=>c.toBlob(r,'image/jpeg',.85));const ruta=`${S.yo.equipo_id}/${nombre}-${Date.now()}.jpg`;
 const {error}=await sb.storage.from('pb-fotos').upload(ruta,blob,{contentType:'image/jpeg',upsert:true});if(error){toast('No se ha podido subir la foto',false);return null;}
 return sb.storage.from('pb-fotos').getPublicUrl(ruta).data.publicUrl;}

// Hoy en Madrid
const hoyMad=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Madrid'}).format(new Date());
const diaMad=iso=>iso?new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Madrid'}).format(new Date(iso)):'';
const pbIso=(iso,n)=>{const d=new Date(iso+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
const pbDias=(a,b)=>Math.round((new Date(b+'T12:00:00Z')-new Date(a+'T12:00:00Z'))/864e5);
function pbViene(dia,hoy){const n=pbDias(dia,hoy);if(n<=0)return '';if(n===1)return 'Viene de ayer';
 if(n<7)return 'Viene del '+new Date(dia+'T12:00:00').toLocaleDateString('es-ES',{weekday:'long'});return 'Lleva '+n+' días';}

// Llamada a la función de altas
async function fn(body){const {data:{session}}=await sb.auth.getSession();const h={'Content-Type':'application/json',apikey:SB_KEY};if(session)h.Authorization='Bearer '+session.access_token;
 const r=await fetch(SB_URL+'/functions/v1/plan-equipo',{method:'POST',headers:h,body:JSON.stringify(body)});let j={};try{j=await r.json();}catch(e){}if(!j.ok)throw new Error(j.error||'No se ha podido');return j;}

// ── Estado
const S={yo:null,equipo:null,miembros:[],permisos:[],tab:leeLS('tab','plan')};
const M=id=>S.miembros.find(m=>m.id===id);
const nomDe=id=>(M(id)||{}).nombre||'Alguien';
const supervisa=p=>S.permisos.some(x=>x.quien===S.yo.id&&x.a_quien===p&&(M(p)||{}).activo);
// Quien administra (o a quien se lo da) ve las estadísticas de todo el equipo; solo las rellena quien la lleva o su jefe
// Quién ve a quién (lo elige quien administra): su gente directa, toda su rama, todo el equipo, y además personas sueltas
const veTodo=()=>!!(S.yo&&(S.yo.admin||S.yo.ve==='todos'));
const rama=id=>{const R=new Set(),va=q=>S.permisos.filter(x=>x.quien===q).forEach(x=>{const m=M(x.a_quien);if(m&&m.activo&&!R.has(x.a_quien)&&x.a_quien!==id){R.add(x.a_quien);va(x.a_quien);}});va(id);return R;};
function veA(m){const act=S.miembros.filter(x=>x.activo&&x.id!==m.id);if(m.admin||m.ve==='todos')return new Set(act.map(x=>x.id));
 const R=m.ve==='rama'?rama(m.id):new Set(S.permisos.filter(x=>x.quien===m.id&&(M(x.a_quien)||{}).activo).map(x=>x.a_quien));
 (S.veExtra||[]).filter(x=>x.quien===m.id&&(M(x.a_quien)||{}).activo).forEach(x=>R.add(x.a_quien));return R;}
const veTxt=m=>{if(m.admin)return 'Ve a todo el equipo (administra)';const n=veA(m).size,ex=(S.veExtra||[]).filter(x=>x.quien===m.id).length;
 return (m.ve==='todos'?'Ve a todo el equipo':m.ve==='rama'?'Ve toda su rama':'Ve a su gente directa')+(ex&&m.ve!=='todos'?' y '+ex+' más':'')+(m.ve==='todos'?'':` · ${n} persona${n===1?'':'s'}`);};
const puedeEst=p=>p===S.yo.id||supervisa(p);
// Todo el equipo en el orden del organigrama (cada jefe con su gente debajo)
function ordenOrg(){const act=S.miembros.filter(m=>m.activo),ids=new Set(act.map(m=>m.id)),jefe={};
 act.forEach(m=>{const d=S.permisos.filter(x=>x.a_quien===m.id&&ids.has(x.quien)).map(x=>x.quien).sort((a,b)=>nomDe(a).localeCompare(nomDe(b),'es'));jefe[m.id]=d[0]||null;});
 act.forEach(m=>{const v=new Set([m.id]);let p=jefe[m.id];while(p){if(v.has(p)){jefe[m.id]=null;break;}v.add(p);p=jefe[p];}});
 const R=[],va=(id,n)=>{act.filter(m=>jefe[m.id]===id).sort((a,b)=>a.nombre.localeCompare(b.nombre,'es')).forEach(m=>{R.push(m);m._niv=n;va(m.id,n+1);});};va(null,0);return R;}
const verEst=()=>{const v=veA(S.yo);return [S.yo,...ordenOrg().filter(m=>v.has(m.id))];};
const visibles=()=>[S.yo,...S.miembros.filter(m=>m.id!==S.yo.id&&m.activo&&supervisa(m.id)).sort((a,b)=>a.nombre.localeCompare(b.nombre,'es'))];

async function arranca(){const {data:{session}}=await sb.auth.getSession();if(!session)return pantallaEntrar();
 const {data:me,error}=await sb.from('pb_miembros').select('*').eq('user_id',session.user.id).maybeSingle();
 if(error){$app.innerHTML='<div class="cargando">No se ha podido cargar. Revisa la conexión y vuelve a abrir.</div>';return;}
 if(!me||!me.activo)return pantallaSinEquipo(session.user,me);
 S.yo=me;await cargaEquipo();pinta();}
async function cargaEquipo(){const [e,m,p,x]=await Promise.all([sb.from('pb_equipos').select('*').eq('id',S.yo.equipo_id).single(),sb.from('pb_miembros').select('*').eq('equipo_id',S.yo.equipo_id),sb.from('pb_permisos').select('*').eq('equipo_id',S.yo.equipo_id),sb.from('pb_ve_extra').select('*').eq('equipo_id',S.yo.equipo_id)]);
 S.equipo=e.data;S.miembros=m.data||[];S.permisos=p.data||[];S.veExtra=(x.data)||[];S.yo=M(S.yo.id)||S.yo;}
sb.auth.onAuthStateChange(ev=>{if(ev==='SIGNED_OUT'){S.yo=null;pantallaEntrar();}});

// ── Entrar / crear equipo
const ICONO='<svg viewBox="0 0 24 24"><path d="M6 3h11a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6z"/><path d="M6 3v18M9.5 8.5l1.5 1.5 3-3M9.5 14.5l1.5 1.5 3-3"/></svg>';
// La hojita de cuaderno de la entrada: las tareas se van tachando solas
function hojita(){const f=new Date().toLocaleDateString('es-ES',{weekday:'long',day:'numeric',month:'long',timeZone:'Europe/Madrid'});
 const T=['Llamar a la gestoría','Revisar la <mark>agenda</mark>','<b>Plan de la semana</b>'];
 return `<div class="hj"><div class="hj-f">${escH(f.charAt(0).toUpperCase()+f.slice(1))}</div>${T.map((t,i)=>`<div class="hj-l" style="--d:${.6+i*.9}s"><span class="hj-c">${IC.ck}</span><span class="hj-t">${t}</span></div>`).join('')}<div class="hj-l"></div></div>`;}
function pantallaEntrar(){$app.innerHTML=`<div class="ent"><div class="box">${hojita()}<h1>Plan de <em>batalla</em></h1><p class="sub">Tus tareas del día. Lo que no hagas pasa solo al día siguiente.</p>
 <form id="fe" class="ent-c"><label class="l">Email</label><input class="i" type="email" name="email" autocomplete="email" required>
 <label class="l">Contraseña</label><input class="i" type="password" name="pass" autocomplete="current-password" required>
 <button class="bt full" style="margin-top:18px">Entrar</button><div class="err"></div>
 <p class="nota">¿No recuerdas la contraseña? Pídele a quien administra tu equipo que te ponga una nueva.</p></form>
 <button class="lnk" id="nuevo">Crear un equipo nuevo</button></div></div>`;
 const f=$app.querySelector('#fe');f.onsubmit=async e=>{e.preventDefault();const b=f.querySelector('button'),er=f.querySelector('.err');b.disabled=true;er.textContent='';
  const {error}=await sb.auth.signInWithPassword({email:f.email.value.trim(),password:f.pass.value});b.disabled=false;
  if(error){er.textContent=/invalid/i.test(error.message)?'Email o contraseña incorrectos':'No se ha podido entrar';return;}arranca();};
 $app.querySelector('#nuevo').onclick=()=>pantallaCrear(null);ojos($app);}
function pantallaCrear(user){$app.innerHTML=`<div class="ent"><div class="box">${hojita()}<h1>Crea tu <em>equipo</em></h1><p class="sub">Tú serás quien lo administra: añades a la gente y decides quién revisa a quién.</p>
 <form id="fc" class="ent-c"><label class="l">Nombre del equipo</label><input class="i" name="equipo" maxlength="60" placeholder="Ej.: Clínica, Casa, Oficina…" required>
 <label class="l">Tu nombre</label><input class="i" name="nombre" maxlength="40" autocomplete="given-name" required>
 ${user?'':`<label class="l">Tu email</label><input class="i" type="email" name="email" autocomplete="email" required>
 <label class="l">Contraseña (mínimo 8)</label><input class="i" type="password" name="pass" minlength="8" autocomplete="new-password" required>`}
 <button class="bt full" style="margin-top:18px">Crear equipo</button><div class="err"></div></form>
 <button class="lnk" id="vol">${user?'Salir':'Ya tengo cuenta, entrar'}</button></div></div>`;
 const f=$app.querySelector('#fc');f.onsubmit=async e=>{e.preventDefault();const b=f.querySelector('button'),er=f.querySelector('.err');b.disabled=true;er.textContent='';
  try{await fn({accion:'crear-equipo',equipo:f.equipo.value,nombre:f.nombre.value,email:user?undefined:f.email.value,password:user?undefined:f.pass.value});
   if(!user){const {error}=await sb.auth.signInWithPassword({email:f.email.value.trim(),password:f.pass.value});if(error)throw error;}
   arranca();}catch(x){b.disabled=false;er.textContent=x.message;}};
 $app.querySelector('#vol').onclick=()=>user?sb.auth.signOut():pantallaEntrar();ojos($app);}
function pantallaSinEquipo(user,me){if(me&&!me.activo){$app.innerHTML=`<div class="ent"><div class="box"><div class="ic">${ICONO}</div><h1>Sin acceso</h1><p class="sub">Te han dado de baja del equipo. Si es un error, habla con quien lo administra.</p><button class="bt full" id="sal">Salir</button></div></div>`;$app.querySelector('#sal').onclick=()=>sb.auth.signOut();return;}
 pantallaCrear(user);}

// ── Pantalla principal
const pinta0=()=>pinta();
function pinta(){
 const n=window._pend||0;
 $app.innerHTML=`<div class="wrap"><div class="top"><div class="top-e">${S.equipo&&S.equipo.foto?`<img class="top-f" src="${escH(S.equipo.foto)}" alt="">`:''}<button type="button" class="top-n" id="topN" aria-label="Cambiar el nombre del equipo"><small>Plan de batalla</small><b>${escH(S.equipo?S.equipo.nombre:'')}${S.yo.admin?'<svg viewBox="0 0 24 24"><path d="M4 20h4L18.5 9.5a2.8 2.8 0 0 0-4-4L4 16z"/></svg>':''}</b></button></div><div class="top-d"><button class="cd-btn" id="cdB" aria-label="Condiciones" title="Condiciones"><svg viewBox="0 0 24 24"><path d="M4 13l2.4-7.4A2.2 2.2 0 0 1 8.5 4h7a2.2 2.2 0 0 1 2.1 1.6L20 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><path d="M4 13h4.5l1.5 2.5h4l1.5-2.5H20"/></svg><i id="nCd" hidden></i></button><button class="yo-btn" id="yo" aria-label="Tu cuenta">${S.yo.foto?`<img src="${escH(S.yo.foto)}" alt="">`:escH(ini(S.yo.nombre))}</button></div></div>
  <div id="cont"></div></div>
  <nav class="nav" style="grid-template-columns:repeat(${verEst().length>1?5:4},1fr)">${[
   ['plan','Plan','<path d="M6 3h11a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6z"/><path d="M6 3v18M9.5 8.5l1.5 1.5 3-3M9.5 14.5l1.5 1.5 3-3"/>'],
   ['est','Estadísticas','<path d="M4 4v16h16"/><path d="M7.5 15l3.5-4 3 2.5L19 8"/>'],
   verEst().length>1?['ctl','Control','<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1M8.5 11l1.5 1.5 3-3M8.5 16.5h7"/>']:null,
   ['arch','Archivos','<path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2.2h7a2 2 0 0 1 2 2v7.8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>'],
   ['equipo','Equipo','<circle cx="9" cy="8.5" r="3"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0M16 5.8a3 3 0 0 1 0 5.4M17.5 14a5.5 5.5 0 0 1 3 5"/>']
  ].filter(Boolean).map(([k,t,ic])=>`<button data-t="${k}" class="${S.tab===k?'on':''}"><span class="nav-i"><svg viewBox="0 0 24 24">${ic}</svg>${k==='plan'?`<i id="nPend"${n?'':' hidden'}>${n}</i>`:''}</span>${t}</button>`).join('')}</nav>`;
 $app.querySelectorAll('.nav button').forEach(b=>b.onclick=()=>{if(S.tab===b.dataset.t){window.scrollTo({top:0,behavior:'smooth'});return;}S.tab=b.dataset.t;guardaLS('tab',S.tab);pinta();window.scrollTo(0,0);});
 $app.querySelector('#yo').onclick=menuCuenta;$app.querySelector('#cdB').onclick=bandejaCond;$app.querySelector('#topN').onclick=()=>S.yo.admin?nombreEquipo():soloAdmin();contarCond();
 const c=$app.querySelector('#cont');if(S.tab==='equipo')renderEquipo(c);else if(S.tab==='est')renderEstadisticas(c);else if(S.tab==='arch')renderArchivos(c);else if(S.tab==='ctl'&&verEst().length>1)renderControl(c);else renderPlan(c);}
function badge(n){window._pend=n;const e=document.getElementById('nPend');if(e){e.textContent=n;e.hidden=!n;}}

function menuCuenta(){const m=modal(`<h3>${escH(S.yo.nombre)}</h3><p>${escH(S.yo.email)}</p><div style="margin-top:10px">
 <button class="op" data-a="foto"><svg viewBox="0 0 24 24"><path d="M4 8a2 2 0 0 1 2-2h2l1.5-2h5L16 6h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><circle cx="12" cy="12.5" r="3.5"/></svg>${S.yo.foto?'Cambiar mi foto':'Poner mi foto'}</button>
 <button class="op" data-a="clave"><svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>Cambiar mi contraseña</button>
 <button class="op" data-a="inst"><svg viewBox="0 0 24 24"><path d="M12 3v12M7 10l5 5 5-5M5 21h14"/></svg>Instalar en el móvil</button>
 <button class="op rojo" data-a="salir"><svg viewBox="0 0 24 24"><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5M15 12H4"/></svg>Salir</button></div>`);
 m.querySelector('[data-a="salir"]').onclick=()=>{m.remove();sb.auth.signOut();};
 m.querySelector('[data-a="foto"]').onclick=async()=>{m.remove();const u=await subirFoto('p-'+S.yo.id);if(!u)return;const {error}=await sb.rpc('pb_mi_foto',{url:u});if(error){toast('No se ha podido guardar',false);return;}await cargaEquipo();pinta();toast('Foto puesta');};
 m.querySelector('[data-a="inst"]').onclick=()=>{m.remove();modal(`<h3>Instalar en el móvil</h3><p><b>iPhone:</b> en Safari, toca el botón Compartir y luego «Añadir a pantalla de inicio».<br><br><b>Android:</b> en Chrome, toca los tres puntos y luego «Instalar aplicación» o «Añadir a pantalla de inicio».</p><div class="bts"><button class="bt" onclick="this.closest('.mod').remove()">Entendido</button></div>`);};
 m.querySelector('[data-a="clave"]').onclick=()=>{m.remove();const k=modal(`<h3>Cambiar mi contraseña</h3><label class="l">Contraseña nueva (mínimo 8)</label><input class="i" type="password" minlength="8" autocomplete="new-password"><div class="err"></div><div class="bts"><button class="bt sec" data-x>Cancelar</button><button class="bt" data-ok>Guardar</button></div>`);
  ojos(k);k.querySelector('[data-x]').onclick=()=>k.remove();k.querySelector('[data-ok]').onclick=async e=>{const v=k.querySelector('input').value;if(v.length<8){k.querySelector('.err').textContent='Mínimo 8 caracteres';return;}e.target.disabled=true;
   const {error}=await sb.auth.updateUser({password:v});if(error){e.target.disabled=false;k.querySelector('.err').textContent='No se ha podido cambiar';return;}k.remove();toast('Contraseña cambiada');};};}

// ── PLAN DE BATALLA: las tareas del día de cada uno. Lo que no se hace pasa solo al día siguiente.
// Cada uno se apunta las suyas; quien tiene permiso elige a quién mira y le puede poner tareas.
const PB={persona:leeLS('persona',''),dia:leeLS('dia',''),d:null,sem:0};
const pbGuarda=()=>{guardaLS('persona',PB.persona);guardaLS('dia',PB.dia);};
async function datosPlan(p){const hoy=hoyMad(),cols='id,persona,dia,texto,hecha,hecha_en,por,creado';
 const [a,b]=await Promise.all([sb.from('pb_tareas').select(cols).eq('persona',p).eq('hecha',false).order('dia').order('creado'),
  sb.from('pb_tareas').select(cols).eq('persona',p).eq('hecha',true).gte('hecha_en',new Date(Date.now()-40*36e5).toISOString()).order('hecha_en')]);
 if(a.error||b.error)throw new Error('carga');
 const it=x=>({id:x.id,persona:x.persona,dia:x.dia,t:x.texto,hecha:x.hecha,hechaEn:x.hecha_en,por:x.por});
 const P=(a.data||[]).map(it);
 return {hoy,persona:p,pendientes:P.filter(x=>x.dia<=hoy),proximas:P.filter(x=>x.dia>hoy),hechas:(b.data||[]).map(it).filter(x=>diaMad(x.hechaEn)===hoy)};}
async function datosPasado(p,dia){const ini=new Date(pbIso(dia,-1)+'T00:00:00Z').toISOString(),fin=new Date(pbIso(dia,2)+'T00:00:00Z').toISOString();
 const {data,error}=await sb.from('pb_tareas').select('id,persona,dia,texto,hecha,hecha_en,por').eq('persona',p).eq('hecha',true).gte('hecha_en',ini).lt('hecha_en',fin).order('hecha_en');
 if(error)throw new Error('carga');return (data||[]).filter(x=>diaMad(x.hecha_en)===dia).map(x=>({id:x.id,persona:x.persona,dia:x.dia,t:x.texto,hecha:true,hechaEn:x.hecha_en,por:x.por}));}
async function contarMias(){try{const {count}=await sb.from('pb_tareas').select('id',{count:'exact',head:true}).eq('persona',S.yo.id).eq('hecha',false).lte('dia',hoyMad());badge(count||0);}catch(e){}}

function renderPlan(wrap){const box=ce('div','pb');wrap.appendChild(box);
 box.innerHTML='<div class="rp-c" style="color:var(--mut);font-size:13px">Cargando…</div>';
 const yo=S.yo.id;
 if(PB.persona&&(PB.persona==='*'?verEst().length<2:!verEst().some(m=>m.id===PB.persona))){PB.persona='';pbGuarda();}
 const persona=()=>PB.persona||yo;
 // Pestañas «Yo» / «Mi equipo» (solo si tienes gente a tu cargo)
 const tabsP=()=>verEst().length>1?`<div class="es-tabs pb-tabs"><button type="button" data-p="" class="${!PB.persona?'on':''}">Yo</button><button type="button" data-p="*" class="${PB.persona?'on':''}">${veTodo()?'Todo el equipo':'Mi equipo'+(S.yo.grupo?' · '+escH(S.yo.grupo):'')}</button></div>`:'';
 const tabsOn=()=>box.querySelectorAll('.pb-tabs button').forEach(b=>b.onclick=()=>{if(PB.persona===b.dataset.p)return;PB.persona=b.dataset.p;PB.dia='';PB._ini=0;pbGuarda();carga();});
 // Mi equipo: la gente a tu cargo, con su puesto y cómo va hoy. Tocas a alguien y ves su plan
 const pintaEq=async()=>{const L=verEst().filter(m=>m.id!==yo);
  box.innerHTML=tabsP()+'<div class="rp-c" style="color:var(--mut);font-size:13px">Cargando…</div>';tabsOn();
  const hoy=hoyMad(),ids=L.map(m=>m.id),cd=PB.ctl&&PB.ctl<=hoy?PB.ctl:hoy;let a,b,K={bp:{},co:{}};
  try{[a,b,K]=await Promise.all([sb.from('pb_tareas').select('persona').in('persona',ids).eq('hecha',false).lte('dia',hoy),sb.from('pb_tareas').select('persona,hecha_en').in('persona',ids).eq('hecha',true).gte('hecha_en',new Date(Date.now()-40*36e5).toISOString()),controlDe(ids,cd)]);if(a.error||b.error)throw 0;}
  catch(e){if(box.isConnected){box.innerHTML=tabsP()+'<div class="rp-c">No se ha podido cargar. Vuelve a intentarlo.</div>';tabsOn();}return;}
  if(!box.isConnected||PB.persona!=='*')return;
  const P={},H={};(a.data||[]).forEach(x=>P[x.persona]=(P[x.persona]||0)+1);(b.data||[]).filter(x=>diaMad(x.hecha_en)===hoy).forEach(x=>H[x.persona]=(H[x.persona]||0)+1);
  const nBP=L.filter(m=>K.bp[m.id]).length,conE=L.filter(m=>K.co[m.id]&&K.co[m.id].tot),nCo=conE.filter(m=>K.co[m.id].hechas>=K.co[m.id].tot).length,dTx=cd===hoy?'hoy':cd===pbIso(hoy,-1)?'ayer':dLargoIso(cd);
  box.innerHTML=tabsP()+`<div hidden><small class="cd-k">Control</small>
    <div class="ctl-f"><span><b>BP/7R de ${escH(dTx)}</b><small>Lo han pasado ${nBP} de ${L.length}</small></span><div class="es-per"><button type="button" class="pb-fl" data-cd="-1" aria-label="Día anterior"><svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg></button><button type="button" class="pb-fl" data-cd="1" aria-label="Día siguiente"${cd>=hoy?' disabled':''}><svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg></button></div></div>
    <div class="ctl-f"><span><b>Condiciones del ${escH(fechaSem(K.sem||hoy))}</b><small>${conE.length?`Las tienen todas ${nCo} de ${conE.length}`:'Nadie tiene estadísticas semanales'}</small></span></div></div>
   <div class="rp-c pb-eq">${L.map(m=>{const p=P[m.id]||0,h=H[m.id]||0,t=p+h,bp=K.bp[m.id],co=K.co[m.id]||{tot:0,hechas:0};return `<button type="button" class="pb-eqf" data-p="${m.id}" style="padding-left:${Math.min(3,m._niv||0)*12}px">${avHTML(m)}<span class="tx"><b>${escH(m.nombre)}</b>${pTag(m)}</span><span class="pb-eqn">${t?`<b>${h} de ${t}</b><span class="rp-bar${h===t?' ok':''}"><i style="width:${Math.round(h/t*100)}%"></i></span>`:'<em>Sin tareas hoy</em>'}</span><svg class="chev" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg></button>`;}).join('')}</div>`;
  box.querySelectorAll('[data-cd]').forEach(b=>b.onclick=()=>{PB.ctl=pbIso(cd,+b.dataset.cd);if(PB.ctl>hoy)PB.ctl=hoy;pintaEq();});
  box.querySelectorAll('[data-bp]').forEach(b=>b.onclick=ev=>{ev.stopPropagation();abreParte(b.dataset.bp);});
  tabsOn();box.querySelectorAll('.pb-eqf').forEach(x=>x.onclick=()=>{PB.persona=x.dataset.p;PB.dia='';PB._ini=0;pbGuarda();carga();});contarMias();};
 const carga=async()=>{if(PB.persona==='*')return pintaEq();let r;try{r=await datosPlan(persona());}catch(e){if(!box.isConnected)return;box.innerHTML='<div class="rp-c">No se ha podido cargar. Vuelve a intentarlo.</div>';return;}
  if(!box.isConnected)return;PB.d=r;PB.pas={};pinta2();contarMias();};
 box._recargar=carga;window._planRecargar=carga;
 // Formato de las tareas: **negrita**, __subrayado__, ==fosforito==
 const fmt=t=>escH(t).replace(/\*\*(.+?)\*\*/g,'<b>$1</b>').replace(/__(.+?)__/g,'<u>$1</u>').replace(/==(.+?)==/g,'<mark>$1</mark>');
 const herr=`<span class="pb-fmt"><button type="button" data-f="b" title="Negrita" aria-label="Negrita"><b>B</b></button><button type="button" data-f="u" title="Subrayar" aria-label="Subrayar"><u>S</u></button><button type="button" data-f="h" title="Fosforito" aria-label="Fosforito"><svg viewBox="0 0 24 24"><path d="m14.5 4.5 5 5L11 18l-5.5.5L6 13z"/><path d="M4 21h7"/></svg></button></span>`;
 const r0=()=>PB.d||{};
 // Quién puede cambiar, mover o quitar una tarea: quien revisa a esa persona, o la propia persona si se la puso ella
 const puede=x=>supervisa(x.persona)||(x.persona===yo&&(!x.por||x.por===yo));
 const fila=(x,hoy,solo)=>{const tags=[];if(solo&&x.hechaEn)tags.push(`<i>${new Date(x.hechaEn).toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit',timeZone:'Europe/Madrid'})}</i>`);
  if(x.por&&x.por!==x.persona)tags.push(`<i class="dir">Puesta por ${x.por===yo?'ti':escH(pri(nomDe(x.por)))}</i>`);
  const v=!x.hecha&&pbViene(x.dia,hoy);if(v)tags.push(`<i class="arr">${v}</i>`);
  const p=puede(x);
  return `<div class="pb-it${x.hecha?' ok':''}${solo?' solo':''}" data-id="${x.id}"><button type="button" class="pb-ck" aria-label="${x.hecha?'Desmarcar':'Hecha'}"${solo?' disabled':''}>${IC.ck}</button>
   <div class="pb-tx"><div class="pb-t${p?'':' fija'}"${x.hecha||!p?'':' title="Toca para escribir o dar formato"'}>${fmt(x.t)}</div>${tags.length?`<div class="pb-tg">${tags.join('')}</div>`:''}</div>
   ${!x.hecha&&p?`<div class="pb-ac"><button type="button" class="pb-man" title="Pasar al día siguiente" aria-label="Pasar al día siguiente"><svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg></button><button type="button" class="pb-del" title="Quitar" aria-label="Quitar"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>`:''}</div>`;};
 // Lee lo escrito (con su formato) y lo pasa a texto con marcas
 const lee=el=>{const R=[],st=n=>{let b=false,u=false,h=false;for(let e=n.parentElement;e&&e!==el.parentElement;e=e.parentElement){const c=getComputedStyle(e);if(!b&&(+c.fontWeight>=600||c.fontWeight==='bold'))b=true;if(String(c.textDecorationLine||c.textDecoration).includes('underline'))u=true;if(e===el)break;}h=fosAnc(n.parentElement,el)!=null;return {b,u,h};};
  const w=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);let n;while((n=w.nextNode())){const s=n.nodeValue.replace(/\s+/g,' ');if(!s)continue;const e=st(n),l=R[R.length-1];if(l&&l.b===e.b&&l.u===e.u&&l.h===e.h)l.t+=s;else R.push({...e,t:s});}
  return R.map(r=>{let t=r.t.replace(/\*\*|__|==/g,'');if(!t.trim())return t;const a=t.match(/^\s*/)[0],z=t.match(/\s*$/)[0];t=t.trim();if(r.h)t='=='+t+'==';if(r.u)t='__'+t+'__';if(r.b)t='**'+t+'**';return a+t+z;}).join('').replace(/\s+/g,' ').trim();};
 // ¿Está con fosforito? El elemento más cercano que lo decida: <mark> o fondo de color = sí; fondo quitado a mano = no
 const fosAnc=(e,ed)=>{for(;e&&e!==ed&&ed.contains(e);e=e.parentElement){const st=e.style||{};if(st.backgroundColor==='transparent'||st.backgroundImage==='none')return null;if(e.tagName==='MARK')return e;const c=getComputedStyle(e).backgroundColor;if(c&&!/^(transparent|rgba\(0, 0, 0, 0\))$/.test(c))return e;}return null;};
 const limpio=t=>String(t||'').replace(/\*\*|__|==/g,'').trim();
 // Herramientas de formato sobre lo seleccionado (si no hay nada seleccionado, se aplica a lo que escribas después)
 const formatea=(ed,f)=>{ed.focus();try{document.execCommand('styleWithCSS',false,f==='h');}catch(_){}
  if(f==='h'){const sel=getSelection();if(!sel.rangeCount)return;const rg=sel.getRangeAt(0),nd=x=>x&&(x.nodeType===3?x.parentElement:x);
   const a1=fosAnc(nd(rg.startContainer),ed),a2=fosAnc(nd(rg.endContainer),ed);
   let hay=!!(a1||a2);if(!hay&&!rg.collapsed){const w=document.createTreeWalker(ed,NodeFilter.SHOW_TEXT);let n;while((n=w.nextNode()))if(rg.intersectsNode(n)&&n.nodeValue.trim()&&fosAnc(n.parentElement,ed)){hay=true;break;}}
   if(!hay){if(!rg.collapsed)document.execCommand('hiliteColor',false,'#ffe680');}
   else if(rg.collapsed){const m=a1;if(m){const pa=m.parentNode;while(m.firstChild)pa.insertBefore(m.firstChild,m);pa.removeChild(m);pa.normalize();}}
   else{const fr=rg.extractContents();fr.querySelectorAll('mark').forEach(m=>{while(m.firstChild)m.parentNode.insertBefore(m.firstChild,m);m.remove();});fr.querySelectorAll('span').forEach(x=>{x.style.backgroundColor='';});
    const sp=document.createElement('span');sp.style.backgroundColor='transparent';sp.style.backgroundImage='none';sp.appendChild(fr);rg.insertNode(sp);
    const m=fosAnc(sp.parentElement,ed);if(m&&m.tagName==='MARK'){const r2=document.createRange();r2.setStartAfter(sp);r2.setEndAfter(m.lastChild||sp);const der=r2.extractContents();const pa=m.parentNode;pa.insertBefore(sp,m.nextSibling);if(der.textContent){const m2=document.createElement('mark');m2.appendChild(der);pa.insertBefore(m2,sp.nextSibling);}if(!m.textContent)m.remove();}
    sel.removeAllRanges();const r3=document.createRange();r3.selectNodeContents(sp);sel.addRange(r3);}}
  else document.execCommand(f==='b'?'bold':'underline');
  ed.dispatchEvent(new Event('input'));marcaHerr();};
 // Los botones se encienden si lo que tienes seleccionado ya tiene ese formato
 const marcaHerr=()=>{const sel=getSelection();if(!sel.rangeCount)return;const n=sel.anchorNode,e=n&&(n.nodeType===3?n.parentElement:n),ed=e&&e.closest&&e.closest('.pb-in,.pb-t[contenteditable="true"]');if(!ed)return;const bar=ed.closest('.pb-esc,.pb-it');if(!bar)return;
  const on={b:document.queryCommandState('bold'),u:document.queryCommandState('underline'),h:!!fosAnc(e,ed)};bar.querySelectorAll('.pb-fmt button').forEach(b=>b.classList.toggle('on',!!on[b.dataset.f]));};
 if(!window._pbSelOn){window._pbSelOn=1;document.addEventListener('selectionchange',()=>{try{marcaHerr();}catch(_){}});}
 const prepara=(ed,bar,guarda,cancela)=>{
  bar.querySelectorAll('.pb-fmt button').forEach(b=>{b.onmousedown=e=>e.preventDefault();b.onclick=()=>formatea(ed,b.dataset.f);});
  ed.addEventListener('paste',e=>{e.preventDefault();const t=(e.clipboardData||window.clipboardData).getData('text/plain').replace(/\s+/g,' ');document.execCommand('insertText',false,t);});
  ed.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();guarda();}else if(e.key==='Escape'&&cancela){e.preventDefault();cancela();}
   else if((e.ctrlKey||e.metaKey)&&['b','u'].includes(e.key.toLowerCase())){e.preventDefault();formatea(ed,e.key.toLowerCase());}});};
 const pinta2=()=>{const r=r0(),hoy=r.hoy,X0=r.proximas||[];
  if(!PB.dia||(!PB._ini&&PB.dia<hoy))PB.dia=hoy;
  if(!PB._ini){PB._ini=1;const l0=pbIso(hoy,-((new Date(hoy+'T12:00:00').getDay()+6)%7));PB.sem=(Math.floor((new Date(PB.dia+'T12:00:00Z')-new Date(l0+'T12:00:00Z'))/6048e5));}
  const sel=PB.dia,enHoy=sel===hoy,enPas=sel<hoy,enMan=sel>hoy;
  PB.pas=PB.pas||{};if(enPas&&!PB.pas[sel]){PB.pas[sel]='cargando';datosPasado(r.persona,sel).then(L=>{PB.pas[sel]=L;if(box.isConnected&&PB.dia===sel)pinta2();}).catch(()=>{PB.pas[sel]=[];toast('No se ha podido cargar ese día',false);});}
  const PH=enPas&&Array.isArray(PB.pas[sel])?PB.pas[sel]:[];
  const P=enHoy?(r.pendientes||[]):enPas?[]:X0.filter(x=>x.dia===sel),H=enHoy?(r.hechas||[]):enPas?PH:[];
  const totH=(r.pendientes||[]).length+(r.hechas||[]).length,hechH=(r.hechas||[]).length,yoMismo=r.persona===yo;
  const nom=pri(nomDe(r.persona));
  const fechaTxt=new Date(sel+'T12:00:00').toLocaleDateString('es-ES',{weekday:'long',day:'numeric',month:'long'});
  let h='';const edPl=puedeEst(r.persona);
  h+=tabsP();if(!yoMismo)h+=`<button type="button" class="pb-vol"><svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg>${veTodo()?'Todo el equipo':'Mi equipo'}</button>`;
  // Agenda: la semana con sus días; se elige el día y se ve (y se escribe en) su hoja
  const lun=pbIso(hoy,-((new Date(hoy+'T12:00:00').getDay()+6)%7)+7*PB.sem),D7=[...Array(7)].map((_,i)=>pbIso(lun,i));
  const cuenta=d=>d===hoy?(r.pendientes||[]).length:X0.filter(x=>x.dia===d).length;
  const mesTxt=(()=>{const a=new Date(D7[0]+'T12:00:00'),b=new Date(D7[6]+'T12:00:00'),m=x=>x.toLocaleDateString('es-ES',{month:'long'});return m(a)===m(b)?m(a):m(a)+' – '+m(b);})();
  h+=`<div class="rp-c pb-cab"><div class="pb-hd"><div class="pb-hq">${yoMismo?'':avHTML(M(r.persona))}<div><small>Plan de batalla</small><b>${yoMismo?'Tu plan':'Plan de '+escH(nom)}</b>${pTag(M(r.persona))}</div></div>${enHoy&&totH?`<span class="rp-n${hechH===totH?' ok':''}">${hechH} de ${totH}</span>`:(!enHoy||PB.sem?`<button type="button" class="pb-hoy">Volver a hoy</button>`:'')}</div>
   <div class="pb-ag"><button type="button" class="pb-fl" data-s="-1" aria-label="Semana anterior"${PB.sem<=-104?' disabled':''}><svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg></button>
    <div class="pb-sem"><div class="pb-mes">${escH(mesTxt)}</div><div class="pb-dias">${D7.map(d=>{const dt=new Date(d+'T12:00:00'),n=cuenta(d),pas=d<hoy;return `<button type="button" data-d="${d}" class="${d===sel?'on ':''}${d===hoy?'hoy ':''}${pas?'pas':''}"><small>${dt.toLocaleDateString('es-ES',{weekday:'short'}).replace('.','').slice(0,3)}</small><b>${dt.getDate()}</b><i>${n&&!pas?'<em></em>'.repeat(Math.min(n,3)):''}</i></button>`;}).join('')}</div></div>
    <button type="button" class="pb-fl" data-s="1" aria-label="Semana siguiente"><svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg></button></div>
   ${enHoy&&totH?`<div class="rp-bar${hechH===totH?' ok':''}"><i style="width:${Math.round(hechH/totH*100)}%"></i></div>`:''}</div>`;
  // La hoja de cuaderno del día: fecha arriba a la derecha, renglones y margen. Se escribe en el primer renglón libre
  const nLin=enPas?H.length+2:P.length+H.length+(H.length?1:0)+1+(enHoy&&!P.length&&H.length?1:0),lineas='<div class="pb-lin"></div>'.repeat(Math.max(0,7-nLin));
  const esc=`<div class="pb-esc"><span class="pb-ck0"><svg viewBox="0 0 24 24"><path d="M12 6v12M6 12h12"/></svg></span><div class="pb-in" contenteditable="true" role="textbox" spellcheck="true" data-ph="${yoMismo?'Escribe una tarea…':'Tarea para '+escH(nom)+'…'}"></div>${herr}<button type="button" class="pb-mas" aria-label="Apuntar">${IC.ck.replace('<svg','<svg')}</button></div>`;
  h+=`<div class="rp-c pb-hoja${enMan?' man':''}${enPas?' pas':''}"><div class="pb-fe">${escH(fechaTxt.charAt(0).toUpperCase()+fechaTxt.slice(1))}</div>
   ${enPas?`<div class="pb-sec">${PB.pas[sel]==='cargando'?'Cargando…':H.length?'Lo que se hizo este día':'Este día no se marcó nada como hecho'}</div>${H.map(x=>fila(x,hoy,true)).join('')}`:`${P.map(x=>fila(x,hoy,!edPl)).join('')}${edPl?esc:`<p class="es-solo pb-solo">Solo lo puedes ver: el plan de ${escH(nom)} lo lleva ${escH(nom)} o quien lo tiene a su cargo.</p>`}
   ${enHoy&&!P.length&&H.length?`<div class="pb-bien">${yoMismo?'¡Todo hecho por hoy!':'Lo ha hecho todo.'}</div>`:''}
   ${H.length?`<div class="pb-sec">Hecho hoy</div>${H.map(x=>fila(x,hoy,!edPl)).join('')}`:''}`}${lineas}</div>`;
  const ed0=box.querySelector('.pb-esc .pb-in'),html0=ed0?ed0.innerHTML:'',foco=document.activeElement===ed0;
  if(enHoy&&yoMismo){h+='<div id="pbBP"></div>';h=h.replace('<div class="rp-c pb-cab">','<div id="pbEst"></div><div class="rp-c pb-cab">');}
  box.innerHTML=h;
  if(enHoy&&yoMismo){pintaBP(box.querySelector('#pbBP'),r);pintaEstado(box.querySelector('#pbEst'));}
  const escF=box.querySelector('.pb-esc')||ce('div'),inp=escF.querySelector('.pb-in')||ce('div');inp.innerHTML=html0;
  const llena=()=>{const t=limpio(inp.textContent);escF.classList.toggle('con',!!t);if(!t&&!inp.querySelector('br,b,u,span,mark'))inp.innerHTML='';};llena();inp.addEventListener('input',llena);
  if(foco){inp.focus();const s=getSelection();s.selectAllChildren(inp);s.collapseToEnd();}
  inp.addEventListener('focus',()=>escF.classList.add('foco'));inp.addEventListener('blur',()=>setTimeout(()=>{if(document.activeElement!==inp)escF.classList.remove('foco');},150));
  tabsOn();{const b=box.querySelector('.pb-vol');if(b)b.onclick=()=>{PB.persona='*';PB.dia='';PB._ini=0;pbGuarda();carga();};}
  box.querySelectorAll('.pb-dias button').forEach(b=>b.onclick=()=>{if(PB.dia===b.dataset.d)return;PB.dia=b.dataset.d;pbGuarda();pinta2();});
  box.querySelectorAll('.pb-fl').forEach(b=>b.onclick=()=>{PB.sem=Math.max(-104,PB.sem+ +b.dataset.s);pinta2();});
  {const b=box.querySelector('.pb-hoy');if(b)b.onclick=()=>{PB.dia=hoy;PB.sem=0;pbGuarda();pinta2();};}
  const mas=escF.querySelector('.pb-mas')||ce('button');
  const anade=async()=>{const t=lee(inp);if(!limpio(t)){inp.focus();return;}if(limpio(t).length>200){toast('Demasiado larga: máximo 200 letras',false);return;}mas.disabled=true;
   const {data,error}=await sb.from('pb_tareas').insert({equipo_id:S.yo.equipo_id,persona:r.persona,dia:sel,texto:t,por:yo}).select('id,persona,dia,texto,hecha,hecha_en,por').single();
   mas.disabled=false;if(error){toast('No se ha podido apuntar',false);return;}
   inp.innerHTML='';const it={id:data.id,persona:data.persona,dia:data.dia,t:data.texto,hecha:false,por:data.por};if(it.dia>hoy)PB.d.proximas.push(it);else PB.d.pendientes.push(it);pinta2();const n=box.querySelector('.pb-esc .pb-in');n&&n.focus();contarMias();};
  mas.onmousedown=e=>e.preventDefault();mas.onclick=anade;prepara(inp,escF,anade);
  const buscar=id=>{const L=[PB.d.pendientes,PB.d.hechas,PB.d.proximas];for(const l of L){const i=(l||[]).findIndex(x=>x.id===id);if(i>=0)return [l,i];}return [null,-1];};
  const guardaBD=async(q,msg)=>{const {error}=await q;if(error){toast(/marcar como hecha/.test(error.message)?'Esta tarea te la han puesto: solo la puedes marcar':msg||'No se ha podido',false);carga();return false;}contarMias();return true;};
  box.querySelectorAll('.pb-it:not(.solo) .pb-ck').forEach(b=>b.onclick=()=>{const id=b.closest('.pb-it').dataset.id,[l,i]=buscar(id);if(!l)return;const x=l[i];
   x.hecha=!x.hecha;x.hechaEn=x.hecha?new Date().toISOString():'';l.splice(i,1);
   if(x.hecha)PB.d.hechas.push(x);else (x.dia>hoy?PB.d.proximas:PB.d.pendientes).push(x);
   b.closest('.pb-it').classList.toggle('ok',x.hecha);setTimeout(pinta2,x.hecha?350:0);guardaBD(sb.from('pb_tareas').update({hecha:x.hecha}).eq('id',id));});
  box.querySelectorAll('.pb-man').forEach(b=>b.onclick=()=>{const id=b.closest('.pb-it').dataset.id,[l,i]=buscar(id);if(!l)return;const x=l.splice(i,1)[0];x.dia=pbIso(x.dia<hoy?hoy:x.dia,1);PB.d.proximas.push(x);pinta2();
   guardaBD(sb.from('pb_tareas').update({dia:x.dia}).eq('id',id)).then(ok=>ok&&toast('Pasada al día siguiente'));});
  box.querySelectorAll('.pb-del').forEach(b=>b.onclick=()=>{const id=b.closest('.pb-it').dataset.id;pregunta('¿Quitar esta tarea del plan?',{si:'Quitar'}).then(ok=>{if(!ok)return;const [l,i]=buscar(id);if(l)l.splice(i,1);pinta2();guardaBD(sb.from('pb_tareas').delete().eq('id',id));});});
  // Tocar una tarea: se escribe encima, como en el cuaderno, y se le puede dar formato
  box.querySelectorAll('.pb-it:not(.ok) .pb-t:not(.fija)').forEach(tx=>tx.onclick=ev=>{const it=tx.closest('.pb-it');if(it.classList.contains('ed'))return;const [l,i]=buscar(it.dataset.id);if(!l)return;const x=l[i];
   box.querySelectorAll('.pb-it.ed').forEach(o=>o!==it&&o._fuera&&o._fuera());
   it.classList.add('ed');tx.contentEditable='true';tx.spellcheck=true;const ac=it.querySelector('.pb-ac');const bar=document.createElement('div');bar.className='pb-edb';bar.innerHTML=herr+'<button type="button" class="pb-mas" aria-label="Guardar">'+IC.ck+'</button>';
   if(ac)ac.style.display='none';it.appendChild(bar);tx.focus();const s=getSelection();
   let rp=null;try{rp=document.caretRangeFromPoint?document.caretRangeFromPoint(ev.clientX,ev.clientY):(()=>{const c=document.caretPositionFromPoint(ev.clientX,ev.clientY);if(!c)return null;const r=document.createRange();r.setStart(c.offsetNode,c.offset);return r;})();}catch(_){}
   if(rp&&tx.contains(rp.startContainer)){s.removeAllRanges();s.addRange(rp);}else{s.selectAllChildren(tx);s.collapseToEnd();}
   let hecho=false;const fin=()=>{hecho=true;tx.contentEditable='false';it.classList.remove('ed');bar.remove();if(ac)ac.style.display='';delete it._fuera;};
   const guarda=async()=>{if(hecho)return;const t=lee(tx);if(!limpio(t)){toast('Escribe la tarea (o quítala con la ✕)',false);tx.focus();return;}if(t===x.t){fin();tx.innerHTML=fmt(x.t);return;}
    if(limpio(t).length>200){toast('Demasiado larga: máximo 200 letras',false);return;}
    const ant=x.t;x.t=t;fin();tx.innerHTML=fmt(t);if(!(await guardaBD(sb.from('pb_tareas').update({texto:t}).eq('id',x.id)))){x.t=ant;}};
   const cancela=()=>{fin();tx.innerHTML=fmt(x.t);};
   it._fuera=guarda;bar.querySelector('.pb-mas').onmousedown=e=>e.preventDefault();bar.querySelector('.pb-mas').onclick=guarda;prepara(tx,bar,guarda,cancela);
   tx.addEventListener('blur',()=>setTimeout(()=>{if(!hecho&&!it.contains(document.activeElement))guarda();},200));});
 };
 carga();}

// ── EQUIPO: la gente del equipo y quién está a cargo de quién.
// Tener a alguien a cargo = ver su plan y sus estadísticas y poder ponerle tareas. Lo cambia solo quien administra.
const aCargo=q=>S.permisos.filter(x=>x.quien===q&&(M(x.a_quien)||{}).activo).map(x=>x.a_quien);
const dependeDe=p=>S.permisos.filter(x=>x.a_quien===p&&(M(x.quien)||{}).activo).map(x=>x.quien);
const nombres=L=>L.map(id=>escH(pri(nomDe(id)))).join(', ');
function renderEquipo(wrap){const adm=S.yo.admin;
 const act=S.miembros.filter(m=>m.activo).sort((a,b)=>(b.id===S.yo.id)-(a.id===S.yo.id)||a.nombre.localeCompare(b.nombre,'es'));
 const baja=S.miembros.filter(m=>!m.activo).sort((a,b)=>a.nombre.localeCompare(b.nombre,'es'));
 const fila=m=>{const ac=m.activo?aCargo(m.id):[],de=m.activo?dependeDe(m.id):[];
  return `<div class="mi${m.activo?'':' baja'}" data-id="${m.id}">${avHTML(m)}<div class="tx"><b>${escH(m.nombre)}${m.id===S.yo.id?' <span style="color:var(--mut);font-weight:500">(tú)</span>':''}${m.admin?'<i class="bdg">ADMIN</i>':''}${m.activo?'':'<i class="bdg off">DE BAJA</i>'}</b>${pTag(m,adm&&m.activo)}<small>${escH(m.email||'')}</small>
   ${m.grupo?`<small class="rv-g">Grupo: ${escH(m.grupo)}</small>`:''}${de.length?`<small class="rv-d">Depende de ${nombres(de)}</small>`:''}${ac.length?`<small class="rv-a">A su cargo: ${nombres(ac)}</small>`:''}</div>${adm?'<button class="mas3" aria-label="Opciones">⋯</button>':''}</div>`;};
 wrap.innerHTML=`<div class="rp-c"><div class="eq-h"><div class="top-e">${S.equipo.foto?`<img class="top-f" src="${escH(S.equipo.foto)}" alt="">`:''}<div><small>Equipo</small><b>${escH(S.equipo.nombre)}</b></div><button class="eq-lapiz" id="eqMas" aria-label="Cambiar el nombre o la foto del equipo"><svg viewBox="0 0 24 24"><path d="M4 20h4L18.5 9.5a2.8 2.8 0 0 0-4-4L4 16z"/></svg></button></div>${adm?'<button class="bt" id="alta">+ Añadir</button>':''}</div>
   <div style="margin-top:10px">${act.map(fila).join('')}${baja.length&&adm?`<details style="margin-top:6px"><summary class="eq-p" style="cursor:pointer">De baja (${baja.length})</summary>${baja.map(fila).join('')}</details>`:''}</div></div>
  <div class="rp-c"><div class="eq-h"><div><small>Organigrama</small><b>Quién depende de quién</b></div></div>
   <p class="eq-p">${adm?'Cada persona sale debajo de su jefe, con más margen cuanto más abajo está. Para cambiar a alguien de sitio, <b>tócala</b> y elige debajo de quién va (o arrástrala por <b>⠿</b>).':'Así está organizado el equipo: cada persona sale debajo de su jefe.'}</p><div id="org" class="org"></div></div>
  <div class="rp-c"><div class="eq-h"><div><small>Permisos</small><b>Quién ve qué</b></div></div>
   <p class="eq-p">${adm?'Cada uno ve el plan, las estadísticas y los archivos de las personas que elijas aquí. Toca a alguien para cambiarlo.':'Lo que ve cada uno lo decide quien administra el equipo.'}</p>
   <div class="qv">${act.map(m=>`<button type="button" class="qv-f" data-q="${m.id}"${adm&&!m.admin?'':' disabled'}>${avHTML(m)}<span class="tx"><b>${escH(m.nombre)}${m.id===S.yo.id?' <i>(tú)</i>':''}</b><small>${escH(veTxt(m))}</small></span>${adm&&!m.admin?'<svg class="chev" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>':''}</button>`).join('')}</div></div>
  <div class="rp-c eq-ayuda"><b>¿Cómo funciona?</b><p>Quien tiene a alguien <b>a su cargo</b> ve su plan de batalla y sus estadísticas, y le puede poner tareas (esa persona solo las puede marcar como hechas).</p>
   ${adm?'<p>Para poner a alguien bajo otra persona, toca los <b>⋯</b> de esa persona y elige <b>«Depende de»</b>. O al revés: en los ⋯ de la jefa o el jefe, <b>«A su cargo»</b>.</p><p>Lo que ve cada uno se elige en <b>«Quién ve qué»</b>: solo su gente directa, toda su rama (su gente y la gente de su gente) o todo el equipo, y además personas sueltas. Ver no es poder cambiar: las tareas y las estadísticas de alguien solo las toca su jefe directo o esa persona.</p>':'<p>Las altas, bajas, puestos y quién está a cargo de quién los lleva quien administra el equipo.</p>'}</div>`;
 organigrama(wrap.querySelector('#org'),adm,act);
 wrap.querySelectorAll('.qv-f:not([disabled])').forEach(b=>b.onclick=()=>queVe(M(b.dataset.q)));
 wrap.querySelector('#eqMas').onclick=adm?opcionesEquipo:soloAdmin;
 if(!adm)return;
 wrap.querySelector('#alta').onclick=altaMiembro;
 wrap.querySelectorAll('.mi .mas3').forEach(b=>b.onclick=()=>opcionesMiembro(M(b.closest('.mi').dataset.id)));}
// ── ORGANIGRAMA: cada persona cuelga de su jefe (la primera persona de quien depende). Se arrastra para cambiarlo.
function organigrama(box,adm,act){
 const ids=new Set(act.map(m=>m.id));
 const jefe={};act.forEach(m=>{const d=dependeDe(m.id).filter(q=>ids.has(q)).sort((a,b)=>nomDe(a).localeCompare(nomDe(b),'es'));jefe[m.id]=d[0]||null;});
 // Evitar círculos (A depende de B y B de A): el que cierra el círculo pasa arriba
 act.forEach(m=>{const vis=new Set([m.id]);let p=jefe[m.id];while(p){if(vis.has(p)){jefe[m.id]=null;break;}vis.add(p);p=jefe[p];}});
 const hijos=p=>act.filter(m=>jefe[m.id]===p).sort((a,b)=>a.nombre.localeCompare(b.nombre,'es'));
 const otros=p=>dependeDe(p).filter(q=>ids.has(q)&&q!==jefe[p]);
 const nodo=m=>{const H=hijos(m.id),o=otros(m.id);return `<div class="org-n"><div class="org-c" data-id="${m.id}">${adm?'<span class="org-h" aria-label="Arrastrar">⠿</span>':''}${avHTML(m)}<span class="org-t"><b>${escH(m.nombre)}${m.id===S.yo.id?' <i>(tú)</i>':''}</b>${pTag(m)}${o.length?`<small>también de ${nombres(o)}</small>`:''}</span></div>${H.length?`<div class="org-k">${m.grupo?`<button type="button" class="org-gr" data-g="${m.id}"${adm?'':' disabled'}>${escH(m.grupo)}${adm?'<svg viewBox="0 0 24 24"><path d="M4 20h4L18.5 9.5a2.8 2.8 0 0 0-4-4L4 16z"/></svg>':''}</button>`:adm?`<button type="button" class="org-gr vac" data-g="${m.id}">+ Nombre de su grupo</button>`:''}${H.map(nodo).join('')}</div>`:''}</div>`;};
 box.innerHTML=`${adm?'<div class="org-raiz" data-id="">Arriba del todo</div>':''}${hijos(null).map(nodo).join('')||'<p class="vacio">Aún no hay nadie.</p>'}`;
 if(!adm)return;
 const desc=(a,b)=>{let p=jefe[b];while(p){if(p===a)return true;p=jefe[p];}return false;};
 const mover=async(id,nuevo)=>{const ant=dependeDe(id);if(nuevo===jefe[id]&&!otros(id).length)return;await guardaCargos(nuevo&&!ant.includes(nuevo)?[[nuevo,id]]:[],ant.filter(q=>q!==nuevo).map(q=>[q,id]));};
 box.querySelectorAll('.org-gr[data-g]').forEach(g=>g.onclick=ev=>{ev.stopPropagation();if(adm)editaGrupo(M(g.dataset.g));});
 box.querySelectorAll('.org-c').forEach(c=>c.addEventListener('click',ev=>{if(ev.target.closest('.org-h'))return;const id=c.dataset.id,p=M(id);
  const L=act.filter(m=>m.id!==id&&!desc(id,m.id)).sort((a,b)=>a.nombre.localeCompare(b.nombre,'es'));
  const m=modal(`<h3>¿Debajo de quién va ${escH(pri(p.nombre))}?</h3><p>Quien elijas la tendrá a su cargo. La gente que ${escH(pri(p.nombre))} tiene debajo se mueve con ella.</p><div style="margin-top:10px">
   <button class="op${!jefe[id]?' on':''}" data-j=""><svg viewBox="0 0 24 24"><path d="M12 19V5M5 12l7-7 7 7"/></svg>Arriba del todo (sin jefe)</button>
   ${L.map(x=>`<button class="op${jefe[id]===x.id?' on':''}" data-j="${x.id}">${avHTML(x,'width:28px;height:28px;font-size:12px')}${escH(x.nombre)}${x.puesto?` <em class="op-v">${escH(x.puesto)}</em>`:''}</button>`).join('')}</div>`);
  m.querySelectorAll('[data-j]').forEach(b=>b.onclick=()=>{m.remove();mover(id,b.dataset.j||null);});}));
 box.querySelectorAll('.org-h').forEach(h=>{h.addEventListener('pointerdown',ev=>{ev.preventDefault();const c=h.closest('.org-c'),id=c.dataset.id;
  const g=c.cloneNode(true);g.classList.add('org-g');document.body.appendChild(g);const r=c.getBoundingClientRect(),dx=ev.clientX-r.left,dy=ev.clientY-r.top;g.style.width=r.width+'px';
  const mueve=e=>{g.style.left=(e.clientX-dx)+'px';g.style.top=(e.clientY-dy)+'px';g.style.display='none';const t=document.elementFromPoint(e.clientX,e.clientY);g.style.display='';
   box.querySelectorAll('.sobre').forEach(x=>x.classList.remove('sobre'));const d=t&&t.closest('.org-c,.org-raiz');if(d&&box.contains(d)&&d.dataset.id!==id&&!(d.dataset.id&&desc(id,d.dataset.id)))d.classList.add('sobre');
   if(e.clientY<60)window.scrollBy(0,-12);else if(e.clientY>innerHeight-60)window.scrollBy(0,12);};
  mueve(ev);c.classList.add('org-fuera');
  const suelta=async()=>{document.removeEventListener('pointermove',mueve);document.removeEventListener('pointerup',suelta);document.removeEventListener('pointercancel',suelta);g.remove();c.classList.remove('org-fuera');
   const d=box.querySelector('.sobre');if(!d)return;d.classList.remove('sobre');mover(id,d.dataset.id||null);};
  document.addEventListener('pointermove',mueve);document.addEventListener('pointerup',suelta);document.addEventListener('pointercancel',suelta);});});}
// El equipo: cambiarle el nombre o la foto (quien administra)
// ¿A quién ve esta persona? Tres opciones claras + personas sueltas, y debajo la lista de a quién verá
function queVe(p){if(!p)return;let ve=p.ve||'directos';const ex=new Set((S.veExtra||[]).filter(x=>x.quien===p.id).map(x=>x.a_quien));
 const otros=S.miembros.filter(m=>m.activo&&m.id!==p.id).sort((a,b)=>a.nombre.localeCompare(b.nombre,'es')),dir=new Set(aCargo(p.id)),ram=rama(p.id);
 const OP=[['directos','Su gente directa','Las personas que tiene a su cargo',dir.size],['rama','Toda su rama','Su gente y la gente de su gente, hasta abajo',ram.size],['todos','Todo el equipo','Todas las personas del equipo',otros.length]];
 const m=modal(`<h3>¿A quién ve ${escH(pri(p.nombre))}?</h3><p>Verá su plan de batalla, sus estadísticas y sus archivos. Ver no es poder cambiar.</p>
  <div class="qv-op">${OP.map(([k,t,d,n])=>`<button type="button" data-v="${k}"><i></i><span><b>${t}</b><small>${d}</small></span><em>${n}</em></button>`).join('')}</div>
  <div class="qv-ex"><label class="l">Y además, estas personas</label><div class="chs" id="qvEx">${otros.map(o=>`<button type="button" data-p="${o.id}">${IC.ck}${escH(pri(o.nombre))}</button>`).join('')}</div></div>
  <div class="qv-res"></div>
  <div class="bts"><button class="bt sec" data-x>Cancelar</button><button class="bt" data-ok>Guardar</button></div>`);
 m.querySelector('.hoja').classList.add('ancha');
 const pinta=()=>{m.querySelectorAll('.qv-op button').forEach(b=>b.classList.toggle('on',b.dataset.v===ve));
  const base=ve==='todos'?new Set(otros.map(o=>o.id)):ve==='rama'?ram:dir;
  m.querySelector('.qv-ex').hidden=ve==='todos';
  m.querySelectorAll('#qvEx [data-p]').forEach(b=>{const id=b.dataset.p,inc=base.has(id);b.classList.toggle('on',inc||ex.has(id));b.disabled=inc;});
  const fin=otros.filter(o=>base.has(o.id)||(ve!=='todos'&&ex.has(o.id)));
  m.querySelector('.qv-res').innerHTML=`<small>${escH(pri(p.nombre))} verá a ${fin.length===otros.length?'todo el equipo':fin.length?fin.length+' persona'+(fin.length>1?'s':''):'nadie más'}</small>${fin.length&&fin.length<otros.length?`<div>${fin.map(o=>`<span>${avHTML(o)}${escH(pri(o.nombre))}</span>`).join('')}</div>`:''}`;};
 m.querySelectorAll('.qv-op button').forEach(b=>b.onclick=()=>{ve=b.dataset.v;pinta();});
 m.querySelectorAll('#qvEx [data-p]').forEach(b=>b.onclick=()=>{const id=b.dataset.p;ex.has(id)?ex.delete(id):ex.add(id);pinta();});
 m.querySelector('[data-x]').onclick=()=>m.remove();
 m.querySelector('[data-ok]').onclick=async ev=>{ev.target.disabled=true;
  const r1=await sb.from('pb_miembros').update({ve}).eq('id',p.id).select('id');
  const ant=new Set((S.veExtra||[]).filter(x=>x.quien===p.id).map(x=>x.a_quien)),pon=[...ex].filter(id=>!ant.has(id)),qui=[...ant].filter(id=>!ex.has(id));
  const r2=qui.length?await sb.from('pb_ve_extra').delete().eq('quien',p.id).in('a_quien',qui):{};
  const r3=pon.length?await sb.from('pb_ve_extra').insert(pon.map(a=>({equipo_id:S.yo.equipo_id,quien:p.id,a_quien:a}))):{};
  if(r1.error||r2.error||r3.error||!(r1.data||[]).length){ev.target.disabled=false;toast('No se ha podido guardar',false);return;}
  m.remove();toast('Guardado: '+pri(p.nombre)+' '+veTxt({...p,ve}).charAt(0).toLowerCase()+veTxt({...p,ve}).slice(1).replace(/ · .*/,''));await cargaEquipo();renderEquipoOtraVez();};
 pinta();}
// Lo que solo cambia quien administra: se explica a los demás en vez de esconderlo
function soloAdmin(){const a=S.miembros.find(x=>x.admin&&x.activo);modal(`<h3>Lo cambia ${a?escH(pri(a.nombre)):'quien administra'}</h3><p>El nombre del equipo, la foto, los grupos y los puestos los cambia ${a?escH(a.nombre)+', que administra el equipo':'quien administra el equipo'}. Pídeselo a ${a?escH(pri(a.nombre)):'esa persona'}.</p><div class="bts"><button class="bt" onclick="this.closest('.mod').remove()">Entendido</button></div>`);}
// Nombre del grupo de gente que lleva una persona (sale en el organigrama y en «Mi equipo»)
function editaGrupo(p){const k=modal(`<h3>Grupo de ${escH(pri(p.nombre))}</h3><p>El nombre del grupo de gente que lleva ${escH(pri(p.nombre))} (por ejemplo «Recepción» o «Fisios mañana»).</p><label class="l">Nombre del grupo</label><input class="i" maxlength="40" value="${escH(p.grupo||'')}" placeholder="Ej.: Recepción"><div class="bts"><button class="bt sec" data-x>Cancelar</button><button class="bt" data-ok>Guardar</button></div>`);
 k.querySelector('input').focus();k.querySelector('[data-x]').onclick=()=>k.remove();
 k.querySelector('[data-ok]').onclick=async()=>{const v=k.querySelector('input').value.trim();k.remove();const {error}=await sb.from('pb_miembros').update({grupo:v||null}).eq('id',p.id);if(error){toast('No se ha podido',false);return;}toast(v?'Grupo guardado':'Grupo quitado');await cargaEquipo();if(p.id===S.yo.id)pinta();else renderEquipoOtraVez();};}
async function guardaEquipo(c,ok){const {data,error}=await sb.from('pb_equipos').update(c).eq('id',S.equipo.id).select('id');if(error||!data||!data.length){toast(error?'No se ha podido guardar':'Solo lo puede cambiar quien administra el equipo',false);return false;}await cargaEquipo();pinta();toast(ok);return true;}
function nombreEquipo(){const k=modal(`<h3>Nombre del equipo</h3><p>Sale arriba del todo, en los PDF y en la ficha del equipo.</p><label class="l">Nombre</label><input class="i" maxlength="60" value="${escH(S.equipo.nombre)}"><div class="err"></div><div class="bts"><button class="bt sec" data-x>Cancelar</button><button class="bt" data-ok>Guardar</button></div>`);
 const i=k.querySelector('input');i.focus();i.select();k.querySelector('[data-x]').onclick=()=>k.remove();
 const ok=async()=>{const v=i.value.trim();if(!v){k.querySelector('.err').textContent='Escribe un nombre';return;}k.remove();await guardaEquipo({nombre:v},'Nombre del equipo cambiado');};
 k.querySelector('[data-ok]').onclick=ok;i.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();ok();}};}
function opcionesEquipo(){const m=modal(`<h3>${escH(S.equipo.nombre)}</h3><div style="margin-top:10px">
 <button class="op" data-a="nom"><svg viewBox="0 0 24 24"><path d="M4 20h4L18.5 9.5a2.8 2.8 0 0 0-4-4L4 16z"/></svg>Cambiar el nombre del equipo</button>
 <button class="op" data-a="foto"><svg viewBox="0 0 24 24"><path d="M4 8a2 2 0 0 1 2-2h2l1.5-2h5L16 6h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><circle cx="12" cy="12.5" r="3.5"/></svg>${S.equipo.foto?'Cambiar la foto del equipo':'Poner una foto o logo del equipo'}</button>
 ${S.equipo.foto?'<button class="op rojo" data-a="sinfoto"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>Quitar la foto del equipo</button>':''}</div>`);
 const guarda=guardaEquipo;
 m.querySelector('[data-a="nom"]').onclick=()=>{m.remove();nombreEquipo();};
 m.querySelector('[data-a="foto"]').onclick=async()=>{m.remove();const u=await subirFoto('equipo');if(u)guarda({foto:u},'Foto puesta');};
 const q=m.querySelector('[data-a="sinfoto"]');if(q)q.onclick=()=>{m.remove();guarda({foto:null},'Foto quitada');};}
// Elegir varias personas (chips). Devuelve la lista elegida o null si se cancela
function eligePersonas(titulo,sub,ini,excluir){return new Promise(res=>{const sel=new Set(ini);const L=S.miembros.filter(m=>m.activo&&m.id!==excluir).sort((a,b)=>a.nombre.localeCompare(b.nombre,'es'));
 const m=modal(`<h3>${escH(titulo)}</h3><p>${escH(sub)}</p><div class="chs" style="margin-top:14px">${L.map(p=>`<button type="button" data-p="${p.id}" class="${sel.has(p.id)?'on':''}">${IC.ck}${escH(p.nombre)}</button>`).join('')||'<span class="eq-p">Aún no hay nadie más en el equipo.</span>'}</div>
  <div class="bts"><button class="bt sec" data-x>Cancelar</button><button class="bt" data-ok>Guardar</button></div>`);
 m.querySelectorAll('[data-p]').forEach(b=>b.onclick=()=>{const id=b.dataset.p;sel.has(id)?sel.delete(id):sel.add(id);b.classList.toggle('on',sel.has(id));});
 m.querySelector('[data-x]').onclick=()=>{m.remove();res(null);};m.querySelector('[data-ok]').onclick=()=>{m.remove();res([...sel]);};
 m.addEventListener('click',e=>{if(e.target===m)res(null);});});}
// Guarda quién está a cargo de quién: pares [jefe, persona] que tienen que quedar y los que hay que quitar
async function guardaCargos(poner,quitar){let ok=true;
 if(poner.length){const r=await sb.from('pb_permisos').upsert(poner.map(([q,a])=>({equipo_id:S.yo.equipo_id,quien:q,a_quien:a})),{onConflict:'quien,a_quien',ignoreDuplicates:true});if(r.error)ok=false;}
 for(const [q,a] of quitar){const r=await sb.from('pb_permisos').delete().eq('quien',q).eq('a_quien',a);if(r.error)ok=false;}
 await cargaEquipo();renderEquipoOtraVez();toast(ok?'Guardado':'No se ha podido guardar todo',ok);}
function renderEquipoOtraVez(){const c=document.getElementById('cont');if(!c||S.tab!=='equipo')return;const y=window.scrollY;c.innerHTML='';renderEquipo(c);window.scrollTo(0,y);}
const claveSug=()=>'batalla'+String(Math.floor(1000+Math.random()*9000));
function altaMiembro(){const jefes=new Set([S.yo.id]),L=S.miembros.filter(x=>x.activo).sort((a,b)=>(b.id===S.yo.id)-(a.id===S.yo.id)||a.nombre.localeCompare(b.nombre,'es'));
 const m=modal(`<h3>Añadir a alguien</h3><p>Le creas la cuenta y le pasas el acceso por WhatsApp.</p>
 <label class="l">Nombre</label><input class="i" name="nombre" maxlength="40" autocomplete="off">
 <label class="l">Puesto</label><input class="i" name="puesto" maxlength="60" autocomplete="off" placeholder="Ej.: Recepción, Fisioterapeuta, Coordinación…">
 <label class="l">Email</label><input class="i" name="email" type="email" autocomplete="off">
 <label class="l">Contraseña para entrar (la puede cambiar luego)</label><input class="i" name="pass" value="${claveSug()}" autocomplete="off">
 <label class="l">¿De quién depende? <span style="font-weight:500;color:var(--mut)">(lo tendrá a su cargo)</span></label><div class="chs" id="jefes">${L.map(p=>`<button type="button" data-p="${p.id}" class="${jefes.has(p.id)?'on':''}">${IC.ck}${p.id===S.yo.id?'Yo':escH(pri(p.nombre))}</button>`).join('')}</div>
 <div class="err"></div><div class="bts"><button class="bt sec" data-x>Cancelar</button><button class="bt" data-ok>Añadir</button></div>`);
 m.querySelectorAll('#jefes [data-p]').forEach(b=>b.onclick=()=>{const id=b.dataset.p;jefes.has(id)?jefes.delete(id):jefes.add(id);b.classList.toggle('on',jefes.has(id));});
 m.querySelector('[data-x]').onclick=()=>m.remove();
 m.querySelector('[data-ok]').onclick=async e=>{const b=e.target,v=n=>m.querySelector(`[name="${n}"]`).value.trim();b.disabled=true;m.querySelector('.err').textContent='';
  try{const r=await fn({accion:'alta',nombre:v('nombre'),email:v('email'),password:v('pass')});m.remove();
   if(r.id&&v('puesto'))await sb.from('pb_miembros').update({puesto:v('puesto')}).eq('id',r.id);
   if(r.id&&jefes.size)await sb.from('pb_permisos').upsert([...jefes].map(q=>({equipo_id:S.yo.equipo_id,quien:q,a_quien:r.id})),{onConflict:'quien,a_quien',ignoreDuplicates:true});
   await cargaEquipo();renderEquipoOtraVez();
   acceso(v('nombre'),v('email'),r.existia?'':v('pass'));}catch(x){b.disabled=false;m.querySelector('.err').textContent=x.message;}};}
function acceso(nombre,email,pass){const txt=`Hola ${pri(nombre)}, ya tienes tu Plan de batalla 💪\n\nEntra aquí: ${location.origin}\nEmail: ${email}\n${pass?'Contraseña: '+pass+'\n\nCuando entres, puedes cambiarla tocando tu inicial (arriba a la derecha).':'Contraseña: la de tu cuenta de siempre.'}`;
 const m=modal(`<h3>Listo, ${escH(pri(nombre))} ya está en el equipo</h3><p>Pásale esto para que entre:</p><div class="msg">${escH(txt)}</div>
 <div class="bts"><button class="bt sec" data-c>Copiar</button><a class="bt" style="text-decoration:none;justify-content:center" href="https://wa.me/?text=${encodeURIComponent(txt)}" target="_blank" rel="noopener">WhatsApp</a></div>
 <button class="lnk" data-x>Cerrar</button>`);
 m.querySelector('[data-x]').onclick=()=>m.remove();
 m.querySelector('[data-c]').onclick=()=>{navigator.clipboard&&navigator.clipboard.writeText(txt).then(()=>toast('Copiado'),()=>toast('No se ha podido copiar',false));};}
function opcionesMiembro(p){if(!p)return;const yo=p.id===S.yo.id;
 const m=modal(`<h3>${escH(p.nombre)}</h3><p>${escH(p.email)}</p><div style="margin-top:10px">
  ${p.activo?`<button class="op" data-a="dep"><svg viewBox="0 0 24 24"><path d="M12 19V5M5 12l7-7 7 7"/></svg>Depende de…${dependeDe(p.id).length?` <em class="op-v">${nombres(dependeDe(p.id))}</em>`:''}</button>
  <button class="op" data-a="car"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12l7 7 7-7"/></svg>A su cargo…${aCargo(p.id).length?` <em class="op-v">${nombres(aCargo(p.id))}</em>`:''}</button>`:''}
  ${p.activo&&!yo?`<button class="op" data-a="adm"><svg viewBox="0 0 24 24"><path d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z"/></svg>Pasarle la administración</button>`:''}
  ${p.activo&&!p.admin?`<button class="op" data-a="vt"><svg viewBox="0 0 24 24"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/></svg>Qué puede ver… <em class="op-v">${escH(veTxt(p))}</em></button>`:''}
  ${yo?'':`<button class="op" data-a="clave"><svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>Ponerle una contraseña nueva</button>`}
  <button class="op" data-a="nom"><svg viewBox="0 0 24 24"><path d="M4 20h4L18.5 9.5a2.8 2.8 0 0 0-4-4L4 16z"/></svg>Cambiar el nombre</button>
  <button class="op" data-a="fot"><svg viewBox="0 0 24 24"><path d="M4 8a2 2 0 0 1 2-2h2l1.5-2h5L16 6h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><circle cx="12" cy="12.5" r="3.5"/></svg>${p.foto?'Cambiar la foto':'Ponerle una foto'}</button>
  <button class="op" data-a="gru"><svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M3 19c0-3 2.7-5 6-5s6 2 6 5M15 14.5c2.8 0 5 1.6 5 4"/></svg>${p.grupo?'Cambiar el nombre de su grupo':'Ponerle nombre a su grupo'}${p.grupo?` <em class="op-v">${escH(p.grupo)}</em>`:''}</button>
  <button class="op" data-a="pue"><svg viewBox="0 0 24 24"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18"/></svg>${p.puesto?'Cambiar el puesto':'Ponerle un puesto'}</button>
  ${yo?'':(p.activo?`<button class="op rojo" data-a="baja"><svg viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM17 8l5 5M22 8l-5 5"/></svg>Dar de baja</button>`:`<button class="op" data-a="alta"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>Volver a dar de alta</button>`)}</div>`);
 const upd=async(campos,ok)=>{m.remove();const {error}=await sb.from('pb_miembros').update(campos).eq('id',p.id);if(error){toast(/administrador/.test(error.message)?'Tiene que quedar al menos un administrador':'No se ha podido',false);return;}toast(ok);await cargaEquipo();if(p.id===S.yo.id)pinta();else renderEquipoOtraVez();};
 const on=(a,f)=>{const b=m.querySelector(`[data-a="${a}"]`);if(b)b.onclick=f;};
 on('vt',()=>{m.remove();queVe(p);});
 on('dep',()=>{m.remove();const ant=dependeDe(p.id);eligePersonas('¿De quién depende '+pri(p.nombre)+'?','Quien elijas lo tendrá a su cargo: verá su plan y sus estadísticas y le podrá poner tareas.',ant,p.id).then(L=>{if(!L)return;
  guardaCargos(L.filter(q=>!ant.includes(q)).map(q=>[q,p.id]),ant.filter(q=>!L.includes(q)).map(q=>[q,p.id]));});});
 on('car',()=>{m.remove();const ant=aCargo(p.id);eligePersonas('¿Quién está a cargo de '+pri(p.nombre)+'?','Verá su plan y sus estadísticas y les podrá poner tareas.',ant,p.id).then(L=>{if(!L)return;
  guardaCargos(L.filter(a=>!ant.includes(a)).map(a=>[p.id,a]),ant.filter(a=>!L.includes(a)).map(a=>[p.id,a]));});});
 on('adm',()=>{m.remove();pregunta('¿Pasarle la administración a '+pri(p.nombre)+'?',{sub:'Será quien dé de alta y de baja, cambie puestos y decida quién revisa a quién. Tú dejarás de poder hacerlo.',si:'Pasársela'}).then(async ok=>{if(!ok)return;
  const a=await sb.from('pb_miembros').update({admin:true}).eq('id',p.id);if(a.error){toast('No se ha podido',false);return;}
  const b=await sb.from('pb_miembros').update({admin:false}).eq('id',S.yo.id);if(b.error){toast('No se ha podido',false);}
  toast('Ahora administra '+pri(p.nombre));await cargaEquipo();pinta();});});
 on('baja',()=>{m.remove();pregunta('¿Dar de baja a '+pri(p.nombre)+'?',{sub:'Ya no podrá entrar. Sus tareas se guardan por si vuelve.',si:'Dar de baja'}).then(ok=>ok&&upd({activo:false},'Dado de baja'));});
 on('alta',()=>upd({activo:true},'Vuelve a estar en el equipo'));
 on('nom',()=>{m.remove();const k=modal(`<h3>Cambiar el nombre</h3><label class="l">Nombre</label><input class="i" maxlength="40" value="${escH(p.nombre)}"><div class="bts"><button class="bt sec" data-x>Cancelar</button><button class="bt" data-ok>Guardar</button></div>`);
  k.querySelector('[data-x]').onclick=()=>k.remove();k.querySelector('[data-ok]').onclick=()=>{const v=k.querySelector('input').value.trim();if(!v)return;k.remove();upd({nombre:v},'Nombre cambiado');};});
 on('fot',async()=>{m.remove();const u=await subirFoto('p-'+p.id);if(u)upd({foto:u},'Foto puesta');});
 on('gru',()=>{m.remove();const k=modal(`<h3>Grupo de ${escH(pri(p.nombre))}</h3><p>El nombre del grupo de gente que lleva ${escH(pri(p.nombre))} (por ejemplo «Recepción» o «Fisios mañana»). Sale en el organigrama.</p><label class="l">Nombre del grupo</label><input class="i" maxlength="40" value="${escH(p.grupo||'')}" placeholder="Ej.: Recepción"><div class="bts"><button class="bt sec" data-x>Cancelar</button><button class="bt" data-ok>Guardar</button></div>`);
  k.querySelector('[data-x]').onclick=()=>k.remove();k.querySelector('[data-ok]').onclick=()=>{const v=k.querySelector('input').value.trim();k.remove();upd({grupo:v||null},v?'Grupo guardado':'Grupo quitado');};});
 on('pue',()=>{m.remove();const k=modal(`<h3>Puesto de ${escH(pri(p.nombre))}</h3><p>Sale en su ficha y en sus estadísticas. Si cambia de puesto, lo cambias aquí.</p><label class="l">Puesto</label><input class="i" maxlength="60" value="${escH(p.puesto||'')}" placeholder="Ej.: Recepción, Coordinación…"><div class="bts"><button class="bt sec" data-x>Cancelar</button><button class="bt" data-ok>Guardar</button></div>`);
  k.querySelector('[data-x]').onclick=()=>k.remove();k.querySelector('[data-ok]').onclick=()=>{const v=k.querySelector('input').value.trim();k.remove();upd({puesto:v||null},'Puesto guardado');};});
 on('clave',()=>{m.remove();const pass=claveSug();const k=modal(`<h3>Contraseña nueva para ${escH(pri(p.nombre))}</h3><label class="l">Contraseña</label><input class="i" value="${pass}" autocomplete="off"><div class="err"></div><div class="bts"><button class="bt sec" data-x>Cancelar</button><button class="bt" data-ok>Guardar</button></div>`);
  k.querySelector('[data-x]').onclick=()=>k.remove();k.querySelector('[data-ok]').onclick=async e=>{const v=k.querySelector('input').value.trim();e.target.disabled=true;
   try{await fn({accion:'clave',miembro:p.id,password:v});k.remove();acceso(p.nombre,p.email,v);}catch(x){e.target.disabled=false;k.querySelector('.err').textContent=x.message;}};});}

// Al volver a la app: se refresca sin moverte de donde estabas
document.addEventListener('visibilitychange',async()=>{if(document.visibilityState!=='visible'||!S.yo)return;
 try{await cargaEquipo();}catch(e){}
 if(S.tab==='plan'&&window._planRecargar&&!document.querySelector('.pb-it.ed')&&!(document.activeElement&&document.activeElement.classList.contains('pb-in')&&document.activeElement.textContent.trim()))window._planRecargar();
 else if(S.tab==='equipo')renderEquipoOtraVez();
 else if(S.tab==='est'&&window._esRecargar&&!document.querySelector('.mod'))window._esRecargar();});
if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});
window.addEventListener('DOMContentLoaded',arranca);
