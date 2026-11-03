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
const visibles=()=>[S.yo,...S.miembros.filter(m=>m.id!==S.yo.id&&m.activo&&supervisa(m.id)).sort((a,b)=>a.nombre.localeCompare(b.nombre,'es'))];

async function arranca(){const {data:{session}}=await sb.auth.getSession();if(!session)return pantallaEntrar();
 const {data:me,error}=await sb.from('pb_miembros').select('*').eq('user_id',session.user.id).maybeSingle();
 if(error){$app.innerHTML='<div class="cargando">No se ha podido cargar. Revisa la conexión y vuelve a abrir.</div>';return;}
 if(!me||!me.activo)return pantallaSinEquipo(session.user,me);
 S.yo=me;await cargaEquipo();pinta();}
async function cargaEquipo(){const [e,m,p]=await Promise.all([sb.from('pb_equipos').select('*').eq('id',S.yo.equipo_id).single(),sb.from('pb_miembros').select('*').eq('equipo_id',S.yo.equipo_id),sb.from('pb_permisos').select('*').eq('equipo_id',S.yo.equipo_id)]);
 S.equipo=e.data;S.miembros=m.data||[];S.permisos=p.data||[];S.yo=M(S.yo.id)||S.yo;}
sb.auth.onAuthStateChange(ev=>{if(ev==='SIGNED_OUT'){S.yo=null;pantallaEntrar();}});

// ── Entrar / crear equipo
const ICONO='<svg viewBox="0 0 24 24"><path d="M6 3h11a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6z"/><path d="M6 3v18M9.5 8.5l1.5 1.5 3-3M9.5 14.5l1.5 1.5 3-3"/></svg>';
function pantallaEntrar(){$app.innerHTML=`<div class="ent"><div class="box"><div class="ic">${ICONO}</div><h1>Plan de batalla</h1><p class="sub">Tus tareas del día. Lo que no hagas pasa solo al día siguiente.</p>
 <form id="fe"><label class="l">Email</label><input class="i" type="email" name="email" autocomplete="email" required>
 <label class="l">Contraseña</label><input class="i" type="password" name="pass" autocomplete="current-password" required>
 <button class="bt full" style="margin-top:18px">Entrar</button><div class="err"></div></form>
 <p class="nota">¿No recuerdas la contraseña? Pídele a quien administra tu equipo que te ponga una nueva.</p>
 <button class="lnk" id="nuevo">Crear un equipo nuevo</button></div></div>`;
 const f=$app.querySelector('#fe');f.onsubmit=async e=>{e.preventDefault();const b=f.querySelector('button'),er=f.querySelector('.err');b.disabled=true;er.textContent='';
  const {error}=await sb.auth.signInWithPassword({email:f.email.value.trim(),password:f.pass.value});b.disabled=false;
  if(error){er.textContent=/invalid/i.test(error.message)?'Email o contraseña incorrectos':'No se ha podido entrar';return;}arranca();};
 $app.querySelector('#nuevo').onclick=()=>pantallaCrear(null);ojos($app);}
function pantallaCrear(user){$app.innerHTML=`<div class="ent"><div class="box"><div class="ic">${ICONO}</div><h1>Crea tu equipo</h1><p class="sub">Tú serás quien lo administra: añades a la gente y decides quién revisa a quién.</p>
 <form id="fc"><label class="l">Nombre del equipo</label><input class="i" name="equipo" maxlength="60" placeholder="Ej.: Clínica, Casa, Oficina…" required>
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
function pinta(){
 const n=window._pend||0;
 $app.innerHTML=`<div class="wrap"><div class="top"><div><small>Plan de batalla</small><b>${escH(S.equipo?S.equipo.nombre:'')}</b></div><button class="yo-btn" id="yo" aria-label="Tu cuenta">${escH(ini(S.yo.nombre))}</button></div>
  <div class="tabs"><button data-t="plan" class="${S.tab==='plan'?'on':''}">Plan <i id="nPend"${n?'':' hidden'}>${n}</i></button><button data-t="est" class="${S.tab==='est'?'on':''}">Estadísticas</button><button data-t="equipo" class="${S.tab==='equipo'?'on':''}">Equipo</button></div><div id="cont"></div></div>`;
 $app.querySelectorAll('.tabs button').forEach(b=>b.onclick=()=>{if(S.tab===b.dataset.t)return;S.tab=b.dataset.t;guardaLS('tab',S.tab);pinta();});
 $app.querySelector('#yo').onclick=menuCuenta;
 const c=$app.querySelector('#cont');if(S.tab==='equipo')renderEquipo(c);else if(S.tab==='est')renderEstadisticas(c);else renderPlan(c);}
function badge(n){window._pend=n;const e=document.getElementById('nPend');if(e){e.textContent=n;e.hidden=!n;}}

function menuCuenta(){const m=modal(`<h3>${escH(S.yo.nombre)}</h3><p>${escH(S.yo.email)}</p><div style="margin-top:10px">
 <button class="op" data-a="clave"><svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>Cambiar mi contraseña</button>
 <button class="op" data-a="inst"><svg viewBox="0 0 24 24"><path d="M12 3v12M7 10l5 5 5-5M5 21h14"/></svg>Instalar en el móvil</button>
 <button class="op rojo" data-a="salir"><svg viewBox="0 0 24 24"><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5M15 12H4"/></svg>Salir</button></div>`);
 m.querySelector('[data-a="salir"]').onclick=()=>{m.remove();sb.auth.signOut();};
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
 if(PB.persona&&!visibles().some(m=>m.id===PB.persona)){PB.persona='';pbGuarda();}
 const persona=()=>PB.persona||yo;
 const carga=async()=>{let r;try{r=await datosPlan(persona());}catch(e){if(!box.isConnected)return;box.innerHTML='<div class="rp-c">No se ha podido cargar. Vuelve a intentarlo.</div>';return;}
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
  let h='';const V=visibles();
  if(V.length>1)h+=`<div class="pb-who">${V.map(m=>`<button type="button" data-p="${m.id}" class="${m.id===r.persona?'on':''}">${m.id===yo?'Yo':escH(pri(m.nombre))}</button>`).join('')}</div>`;
  // Agenda: la semana con sus días; se elige el día y se ve (y se escribe en) su hoja
  const lun=pbIso(hoy,-((new Date(hoy+'T12:00:00').getDay()+6)%7)+7*PB.sem),D7=[...Array(7)].map((_,i)=>pbIso(lun,i));
  const cuenta=d=>d===hoy?(r.pendientes||[]).length:X0.filter(x=>x.dia===d).length;
  const mesTxt=(()=>{const a=new Date(D7[0]+'T12:00:00'),b=new Date(D7[6]+'T12:00:00'),m=x=>x.toLocaleDateString('es-ES',{month:'long'});return m(a)===m(b)?m(a):m(a)+' – '+m(b);})();
  h+=`<div class="rp-c pb-cab"><div class="pb-hd"><div><small>Plan de batalla</small><b>${yoMismo?'Tu plan':'Plan de '+escH(nom)}</b></div>${enHoy&&totH?`<span class="rp-n${hechH===totH?' ok':''}">${hechH} de ${totH}</span>`:(!enHoy||PB.sem?`<button type="button" class="pb-hoy">Volver a hoy</button>`:'')}</div>
   <div class="pb-ag"><button type="button" class="pb-fl" data-s="-1" aria-label="Semana anterior"${PB.sem<=-104?' disabled':''}><svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg></button>
    <div class="pb-sem"><div class="pb-mes">${escH(mesTxt)}</div><div class="pb-dias">${D7.map(d=>{const dt=new Date(d+'T12:00:00'),n=cuenta(d),pas=d<hoy;return `<button type="button" data-d="${d}" class="${d===sel?'on ':''}${d===hoy?'hoy ':''}${pas?'pas':''}"><small>${dt.toLocaleDateString('es-ES',{weekday:'short'}).replace('.','').slice(0,3)}</small><b>${dt.getDate()}</b><i>${n&&!pas?'<em></em>'.repeat(Math.min(n,3)):''}</i></button>`;}).join('')}</div></div>
    <button type="button" class="pb-fl" data-s="1" aria-label="Semana siguiente"><svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg></button></div>
   ${enHoy&&totH?`<div class="rp-bar${hechH===totH?' ok':''}"><i style="width:${Math.round(hechH/totH*100)}%"></i></div>`:''}</div>`;
  // La hoja de cuaderno del día: fecha arriba a la derecha, renglones y margen. Se escribe en el primer renglón libre
  const nLin=enPas?H.length+2:P.length+H.length+(H.length?1:0)+1+(enHoy&&!P.length&&H.length?1:0),lineas='<div class="pb-lin"></div>'.repeat(Math.max(0,7-nLin));
  const esc=`<div class="pb-esc"><span class="pb-ck0"><svg viewBox="0 0 24 24"><path d="M12 6v12M6 12h12"/></svg></span><div class="pb-in" contenteditable="true" role="textbox" spellcheck="true" data-ph="${yoMismo?'Escribe una tarea…':'Tarea para '+escH(nom)+'…'}"></div>${herr}<button type="button" class="pb-mas" aria-label="Apuntar">${IC.ck.replace('<svg','<svg')}</button></div>`;
  h+=`<div class="rp-c pb-hoja${enMan?' man':''}${enPas?' pas':''}"><div class="pb-fe">${escH(fechaTxt.charAt(0).toUpperCase()+fechaTxt.slice(1))}</div>
   ${enPas?`<div class="pb-sec">${PB.pas[sel]==='cargando'?'Cargando…':H.length?'Lo que se hizo este día':'Este día no se marcó nada como hecho'}</div>${H.map(x=>fila(x,hoy,true)).join('')}`:`${P.map(x=>fila(x,hoy)).join('')}${esc}
   ${enHoy&&!P.length&&H.length?`<div class="pb-bien">${yoMismo?'¡Todo hecho por hoy!':'Lo ha hecho todo.'}</div>`:''}
   ${H.length?`<div class="pb-sec">Hecho hoy</div>${H.map(x=>fila(x,hoy)).join('')}`:''}`}${lineas}</div>`;
  const ed0=box.querySelector('.pb-esc .pb-in'),html0=ed0?ed0.innerHTML:'',foco=document.activeElement===ed0;
  box.innerHTML=h;
  const escF=box.querySelector('.pb-esc')||ce('div'),inp=escF.querySelector('.pb-in')||ce('div');inp.innerHTML=html0;
  const llena=()=>{const t=limpio(inp.textContent);escF.classList.toggle('con',!!t);if(!t&&!inp.querySelector('br,b,u,span,mark'))inp.innerHTML='';};llena();inp.addEventListener('input',llena);
  if(foco){inp.focus();const s=getSelection();s.selectAllChildren(inp);s.collapseToEnd();}
  inp.addEventListener('focus',()=>escF.classList.add('foco'));inp.addEventListener('blur',()=>setTimeout(()=>{if(document.activeElement!==inp)escF.classList.remove('foco');},150));
  box.querySelectorAll('.pb-who button').forEach(b=>b.onclick=()=>{PB.persona=b.dataset.p===yo?'':b.dataset.p;pbGuarda();box.querySelectorAll('.pb-who button').forEach(x=>x.classList.toggle('on',x===b));carga();});
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

// ── EQUIPO: la gente del equipo y quién revisa a quién
function renderEquipo(wrap){const adm=S.yo.admin;
 const act=S.miembros.filter(m=>m.activo).sort((a,b)=>(b.id===S.yo.id)-(a.id===S.yo.id)||a.nombre.localeCompare(b.nombre,'es'));
 const baja=S.miembros.filter(m=>!m.activo).sort((a,b)=>a.nombre.localeCompare(b.nombre,'es'));
 const fila=m=>`<div class="mi${m.activo?'':' baja'}" data-id="${m.id}"><span class="av">${escH(ini(m.nombre))}</span><div class="tx"><b>${escH(m.nombre)}${m.id===S.yo.id?' <span style="color:var(--mut);font-weight:500">(tú)</span>':''}${m.admin?'<i class="bdg">ADMIN</i>':''}${m.activo?'':'<i class="bdg off">DE BAJA</i>'}</b><small>${escH([m.puesto,m.email].filter(Boolean).join(' · '))}</small>${m.activo&&S.permisos.some(x=>x.quien===m.id)?`<small class="rv-a">Revisa a ${S.permisos.filter(x=>x.quien===m.id&&(M(x.a_quien)||{}).activo).map(x=>escH(pri(nomDe(x.a_quien)))).join(', ')}</small>`:''}</div>${adm?'<button class="mas3" aria-label="Opciones">⋯</button>':''}</div>`;
 const tiene=(q,a)=>S.permisos.some(x=>x.quien===q&&x.a_quien===a);
 const rev=act.map(q=>{const otros=act.filter(a=>a.id!==q.id);const todos=otros.length&&otros.every(a=>tiene(q.id,a.id));
  if(!adm&&!otros.some(a=>tiene(q.id,a.id)))return '';
  return `<div class="rv" data-q="${q.id}"><div class="rv-q"><span class="av">${escH(ini(q.nombre))}</span><div><b>${escH(pri(q.nombre))}</b> <span>revisa y pone tareas a:</span></div></div>
   <div class="chs">${otros.map(a=>`<button type="button" data-a="${a.id}" class="${tiene(q.id,a.id)?'on':''}"${adm?'':' disabled'}>${IC.ck}${escH(pri(a.nombre))}</button>`).join('')}${adm&&otros.length>1?`<button type="button" class="todos" data-todos="${todos?0:1}">${todos?'Quitar todos':'Todos'}</button>`:''}${!otros.length?'<span class="eq-p" style="margin:0">Aún no hay nadie más en el equipo.</span>':''}</div></div>`;}).join('');
 wrap.innerHTML=`<div class="rp-c"><div class="eq-h"><div><small>Equipo</small><b>${escH(S.equipo.nombre)}</b></div>${adm?'<button class="bt" id="alta">+ Añadir</button>':''}</div>
   <div style="margin-top:10px">${act.map(fila).join('')}${baja.length&&adm?`<details style="margin-top:6px"><summary class="eq-p" style="cursor:pointer">De baja (${baja.length})</summary>${baja.map(fila).join('')}</details>`:''}</div></div>
  <div class="rp-c"><div class="eq-h"><div><small>Permisos</small><b>Quién revisa a quién</b></div></div>
   <p class="eq-p">Quien revisa a otra persona ve su plan de batalla y sus estadísticas, y le puede poner tareas (esa persona solo las puede marcar como hechas). No va en cascada: si tú revisas a Ana y Ana revisa a Luis, tú no ves a Luis salvo que lo marques aquí.${adm?'':' Las altas, bajas, puestos y permisos los lleva quien administra el equipo.'}</p>
   ${act.length<2?'<p class="vacio">Añade a la gente de tu equipo para decidir quién revisa a quién.</p>':rev||'<p class="vacio">De momento nadie revisa a nadie.</p>'}</div>`;
 if(!adm)return;
 wrap.querySelector('#alta').onclick=altaMiembro;
 wrap.querySelectorAll('.mas3').forEach(b=>b.onclick=()=>opcionesMiembro(M(b.closest('.mi').dataset.id)));
 wrap.querySelectorAll('.rv').forEach(rv=>{const q=rv.dataset.q;
  rv.querySelectorAll('[data-a]').forEach(b=>b.onclick=async()=>{const a=b.dataset.a,on=!b.classList.contains('on');b.classList.toggle('on',on);
   const res=on?await sb.from('pb_permisos').insert({equipo_id:S.yo.equipo_id,quien:q,a_quien:a}):await sb.from('pb_permisos').delete().eq('quien',q).eq('a_quien',a);
   if(res.error&&!/duplicate/i.test(res.error.message)){b.classList.toggle('on',!on);toast('No se ha podido guardar',false);return;}
   if(on)S.permisos.push({equipo_id:S.yo.equipo_id,quien:q,a_quien:a});else S.permisos=S.permisos.filter(x=>!(x.quien===q&&x.a_quien===a));renderEquipoOtraVez();});
  const t=rv.querySelector('[data-todos]');if(t)t.onclick=async()=>{const pon=t.dataset.todos==='1',otros=act.filter(a=>a.id!==q);t.disabled=true;
   const res=pon?await sb.from('pb_permisos').upsert(otros.filter(a=>!tiene(q,a.id)).map(a=>({equipo_id:S.yo.equipo_id,quien:q,a_quien:a.id})),{onConflict:'quien,a_quien',ignoreDuplicates:true}):await sb.from('pb_permisos').delete().eq('quien',q);
   if(res.error){toast('No se ha podido guardar',false);}await cargaEquipo();renderEquipoOtraVez();};});}
function renderEquipoOtraVez(){const c=document.getElementById('cont');if(!c||S.tab!=='equipo')return;const y=window.scrollY;c.innerHTML='';renderEquipo(c);window.scrollTo(0,y);}
const claveSug=()=>'batalla'+String(Math.floor(1000+Math.random()*9000));
function altaMiembro(){const m=modal(`<h3>Añadir a alguien</h3><p>Le creas la cuenta y le pasas el acceso por WhatsApp.</p>
 <label class="l">Nombre</label><input class="i" name="nombre" maxlength="40" autocomplete="off">
 <label class="l">Email</label><input class="i" name="email" type="email" autocomplete="off">
 <label class="l">Contraseña para entrar (la puede cambiar luego)</label><input class="i" name="pass" value="${claveSug()}" autocomplete="off">
 <div class="err"></div><div class="bts"><button class="bt sec" data-x>Cancelar</button><button class="bt" data-ok>Añadir</button></div>`);
 m.querySelector('[data-x]').onclick=()=>m.remove();
 m.querySelector('[data-ok]').onclick=async e=>{const b=e.target,v=n=>m.querySelector(`[name="${n}"]`).value.trim();b.disabled=true;m.querySelector('.err').textContent='';
  try{const r=await fn({accion:'alta',nombre:v('nombre'),email:v('email'),password:v('pass')});m.remove();await cargaEquipo();renderEquipoOtraVez();
   acceso(v('nombre'),v('email'),r.existia?'':v('pass'));}catch(x){b.disabled=false;m.querySelector('.err').textContent=x.message;}};}
function acceso(nombre,email,pass){const txt=`Hola ${pri(nombre)}, ya tienes tu Plan de batalla 💪\n\nEntra aquí: ${location.origin}\nEmail: ${email}\n${pass?'Contraseña: '+pass+'\n\nCuando entres, puedes cambiarla tocando tu inicial (arriba a la derecha).':'Contraseña: la de tu cuenta de siempre.'}`;
 const m=modal(`<h3>Listo, ${escH(pri(nombre))} ya está en el equipo</h3><p>Pásale esto para que entre:</p><div class="msg">${escH(txt)}</div>
 <div class="bts"><button class="bt sec" data-c>Copiar</button><a class="bt" style="text-decoration:none;justify-content:center" href="https://wa.me/?text=${encodeURIComponent(txt)}" target="_blank" rel="noopener">WhatsApp</a></div>
 <button class="lnk" data-x>Cerrar</button>`);
 m.querySelector('[data-x]').onclick=()=>m.remove();
 m.querySelector('[data-c]').onclick=()=>{navigator.clipboard&&navigator.clipboard.writeText(txt).then(()=>toast('Copiado'),()=>toast('No se ha podido copiar',false));};}
function opcionesMiembro(p){if(!p)return;const yo=p.id===S.yo.id;
 const m=modal(`<h3>${escH(p.nombre)}</h3><p>${escH(p.email)}</p><div style="margin-top:10px">
  ${p.activo&&!yo?`<button class="op" data-a="adm"><svg viewBox="0 0 24 24"><path d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z"/></svg>Pasarle la administración</button>`:''}
  ${yo?'':`<button class="op" data-a="clave"><svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>Ponerle una contraseña nueva</button>`}
  <button class="op" data-a="nom"><svg viewBox="0 0 24 24"><path d="M4 20h4L18.5 9.5a2.8 2.8 0 0 0-4-4L4 16z"/></svg>Cambiar el nombre</button>
  <button class="op" data-a="pue"><svg viewBox="0 0 24 24"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18"/></svg>${p.puesto?'Cambiar el puesto':'Ponerle un puesto'}</button>
  ${yo?'':(p.activo?`<button class="op rojo" data-a="baja"><svg viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM17 8l5 5M22 8l-5 5"/></svg>Dar de baja</button>`:`<button class="op" data-a="alta"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>Volver a dar de alta</button>`)}</div>`);
 const upd=async(campos,ok)=>{m.remove();const {error}=await sb.from('pb_miembros').update(campos).eq('id',p.id);if(error){toast(/administrador/.test(error.message)?'Tiene que quedar al menos un administrador':'No se ha podido',false);return;}toast(ok);await cargaEquipo();if(p.id===S.yo.id)pinta();else renderEquipoOtraVez();};
 const on=(a,f)=>{const b=m.querySelector(`[data-a="${a}"]`);if(b)b.onclick=f;};
 on('adm',()=>{m.remove();pregunta('¿Pasarle la administración a '+pri(p.nombre)+'?',{sub:'Será quien dé de alta y de baja, cambie puestos y decida quién revisa a quién. Tú dejarás de poder hacerlo.',si:'Pasársela'}).then(async ok=>{if(!ok)return;
  const a=await sb.from('pb_miembros').update({admin:true}).eq('id',p.id);if(a.error){toast('No se ha podido',false);return;}
  const b=await sb.from('pb_miembros').update({admin:false}).eq('id',S.yo.id);if(b.error){toast('No se ha podido',false);}
  toast('Ahora administra '+pri(p.nombre));await cargaEquipo();pinta();});});
 on('baja',()=>{m.remove();pregunta('¿Dar de baja a '+pri(p.nombre)+'?',{sub:'Ya no podrá entrar. Sus tareas se guardan por si vuelve.',si:'Dar de baja'}).then(ok=>ok&&upd({activo:false},'Dado de baja'));});
 on('alta',()=>upd({activo:true},'Vuelve a estar en el equipo'));
 on('nom',()=>{m.remove();const k=modal(`<h3>Cambiar el nombre</h3><label class="l">Nombre</label><input class="i" maxlength="40" value="${escH(p.nombre)}"><div class="bts"><button class="bt sec" data-x>Cancelar</button><button class="bt" data-ok>Guardar</button></div>`);
  k.querySelector('[data-x]').onclick=()=>k.remove();k.querySelector('[data-ok]').onclick=()=>{const v=k.querySelector('input').value.trim();if(!v)return;k.remove();upd({nombre:v},'Nombre cambiado');};});
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
