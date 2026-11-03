// ── GUÍA DE RUMBO: qué es la app y para qué sirve cada sección.
// NORMA: cada cambio que note el equipo (pantalla, botón, flujo o texto) se actualiza aquí en el mismo cambio.
// Si la guía cambia de verdad, sube GUIA_VER: a quien ya la vio le sale «Novedades en la guía» una vez.
const GUIA_VER=1;
const GUIA=[
 {k:'que',t:'¿Qué es Rumbo?',ic:'<circle cx="12" cy="12" r="9"/><path d="M15.6 8.4l-2.1 5.1-5.1 2.1 2.1-5.1z"/>',
  h:`<p>Rumbo es la app del equipo. En un solo sitio tienes <b>lo que tienes que hacer hoy</b>, <b>cómo van tus números</b> y <b>lo que se pasa a tu senior</b>.</p>
   <p>Cada persona tiene su puesto y su jefe directo (su senior). Lo que ve cada uno lo decide quien administra el equipo.</p>`},
 {k:'ritmo',t:'El ritmo: cada día, cada noche y cada jueves',ic:'<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 10h16"/>',
  h:`<ul><li><b>Durante el día:</b> apuntas tus tareas en el Plan y las vas tachando. Lo que no hagas pasa solo al día siguiente.</li>
   <li><b>Cada noche:</b> pasas tu <b>BP/7R</b> a tu senior: lo que has hecho, lo pendiente y cómo vas frente a la semana pasada.</li>
   <li><b>Cada jueves desde las 14:00:</b> cierra la semana. Eliges la <b>condición</b> de cada estadística, la escribes y la guardas o se la envías a quien quieras.</li></ul>
   <p>Arriba de tu Plan ves siempre si ya has pasado el BP/7R de hoy y las condiciones de la semana.</p>`},
 {k:'plan',tab:'plan',t:'Plan',ic:'<path d="M6 3h11a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6z"/><path d="M6 3v18M9.5 8.5l1.5 1.5 3-3M9.5 14.5l1.5 1.5 3-3"/>',
  h:`<p>Tu <b>plan de batalla</b>: las tareas de cada día en una hoja de cuaderno.</p>
   <ul><li>Escribe en el primer renglón libre y pulsa ✓. Con la barra de al lado puedes poner <b>negrita</b>, <u>subrayado</u> o <mark>fosforito</mark>.</li>
   <li>Toca el círculo para tacharla. La flecha la pasa al día siguiente y la ✕ la quita.</li>
   <li>En la semana de arriba eliges el día: los días pasados muestran lo que se hizo y a qué hora.</li>
   <li>Las tareas que te pone tu senior salen con «Puesta por…» y solo las puedes marcar como hechas.</li>
   <li>Al final de la hoja de hoy está el botón para <b>pasar tu BP/7R</b>.</li>
   <li>En <b>Mi equipo</b> ves el plan de tu gente y les puedes poner tareas.</li></ul>`},
 {k:'est',tab:'est',t:'Estadísticas',ic:'<path d="M4 4v16h16"/><path d="M7.5 15l3.5-4 3 2.5L19 8"/>',
  h:`<p>Lo que produce tu puesto, en números. Cada persona tiene una <b>estadística principal</b> (★) y las secundarias que quiera.</p>
   <ul><li>La semana va de <b>jueves a las 14:00 a jueves a las 14:00</b>.</li>
   <li>Para sumar, escribe cuántos y pulsa «+ Apuntar». Si se te olvidó apuntarlo en su momento, toca «¿fue otro día?» y elige el día y la hora.</li>
   <li><b>La 7R</b> compara lo que llevas ahora con lo que llevabas la semana pasada a esta misma hora. Debajo ves cuánto te falta para superar la semana pasada entera.</li>
   <li>La gráfica muestra cada semana con su tendencia: verde si va bien, roja si va mal. Las negativas (por ejemplo, cancelaciones) van bien cuando bajan.</li>
   <li>En los ⋯ de una estadística puedes cambiarla, hacerla principal o archivarla.</li></ul>`},
 {k:'cond',tab:'est',t:'Condiciones (los jueves)',ic:'<path d="M7 3.5h7l4 4V20a.5.5 0 0 1-.5.5h-10.5a.5.5 0 0 1-.5-.5V4a.5.5 0 0 1 .5-.5z"/><path d="M14 3.5V8h4M9 12.5h6M9 16h6"/>',
  h:`<p>Cuando cierra la semana, en cada estadística sale <b>«Elige tu condición»</b>.</p>
   <ul><li>Ves con cuánto cerró la semana y la gráfica, y eliges la condición del listado.</li>
   <li>La escribes como en un documento, con títulos, listas, negrita y fosforito. Lo escrito no se pierde aunque cierres.</li>
   <li>Si eliges a alguien, se la envías; si no, se guarda solo en tus Archivos.</li>
   <li>Cada condición sale en <b>PDF</b> con tu nombre, tu puesto, la estadística y la condición.</li></ul>`},
 {k:'bp',t:'BP/7R (cada noche)',ic:'<path d="M4 12l16-8-6 16-2.5-6.5z"/><path d="M11.5 13.5L20 4"/>',
  h:`<p>Al acabar el día, en tu Plan pulsa <b>«Enviar mi BP/7R»</b>. Se prepara solo con:</p>
   <ul><li>la <b>7R</b> de cada estadística (esta semana frente a la pasada a esta hora),</li><li>lo <b>hecho hoy</b>, con la hora,</li><li>lo que queda <b>sin hacer</b>,</li><li>y una nota, si quieres.</li></ul>
   <p>Tu senior sale ya marcado. Si haces más cosas después, puedes reenviarlo.</p>`},
 {k:'ctl',tab:'ctl',t:'Control',ic:'<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1M8.5 11l1.5 1.5 3-3M8.5 16.5h7"/>',
  h:`<p>Solo para quien tiene gente a su cargo. De un vistazo ves:</p>
   <ul><li><b>BP/7R:</b> cada persona y cada día de la semana. ✓ verde si lo envió (tócalo para verlo), ✕ si no, y un círculo de puntos si hoy aún no.</li>
   <li><b>Condiciones del jueves:</b> cuántas tiene cada uno de las que le tocan.</li></ul>
   <p>Con las flechas ves semanas anteriores.</p>`},
 {k:'arch',tab:'arch',t:'Archivos',ic:'<path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2.2h7a2 2 0 0 1 2 2v7.8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
  h:`<p>Lo que queda guardado de cada uno:</p>
   <ul><li><b>Condiciones:</b> todas las que has escrito, por semana, enviadas o solo guardadas.</li>
   <li><b>Planes de batalla:</b> cada semana, lo que se hizo cada día y a qué hora.</li></ul>
   <p>Todo se descarga en PDF. Quien está por encima ve también los archivos de su gente.</p>`},
 {k:'equipo',tab:'equipo',t:'Equipo',ic:'<circle cx="9" cy="8.5" r="3"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0M16 5.8a3 3 0 0 1 0 5.4M17.5 14a5.5 5.5 0 0 1 3 5"/>',
  h:`<p>La gente del equipo, con su puesto, y el <b>organigrama</b>: cada uno debajo de su jefe.</p>
   <p>Lo gestiona <b>quien administra</b> el equipo, que es una sola persona. Puede:</p>
   <ul><li>dar de alta y de baja a la gente, cambiar puestos y contraseñas;</li>
   <li>mover a alguien en el organigrama: se toca y se elige debajo de quién va;</li>
   <li>poner nombre al equipo, a los grupos y fotos;</li>
   <li>decidir en <b>«Quién ve qué»</b> lo que ve cada uno: su gente directa, toda su rama, todo el equipo o personas sueltas.</li></ul>
   <p><b>Ver no es poder cambiar:</b> las tareas y estadísticas de alguien solo las toca esa persona o su jefe directo.</p>`},
 {k:'bandeja',t:'Bandeja',ic:'<path d="M4 13l2.4-7.4A2.2 2.2 0 0 1 8.5 4h7a2.2 2.2 0 0 1 2.1 1.6L20 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><path d="M4 13h4.5l1.5 2.5h4l1.5-2.5H20"/>',
  h:`<p>El botón de arriba a la derecha. Ahí te llegan los <b>BP/7R</b> y las <b>condiciones</b> que te envían, con un número cuando hay alguno sin leer. En «Mías» tienes las tuyas.</p>`}];

// «Ver en la app»: te lleva a la sección, marca la parte que explica y deja un botón para volver a la guía
const GUIA_VER_EN={plan:{tab:'plan',el:'.pb-hoja'},est:{tab:'est',el:'.es-c'},cond:{tab:'est',el:'.cd-ban,.cd-card,.es-c'},bp:{tab:'plan',el:'#pbBP .rp-c'},
 ctl:{tab:'ctl',el:'.ct-t'},arch:{tab:'arch',el:'.ar-cab'},equipo:{tab:'equipo',el:'#org'},bandeja:{fn:()=>bandejaCond()},que:{tab:'plan',el:'.nav'},ritmo:{tab:'plan',el:'#pbEst .rp-c'}};
function guiaVer(k){const v=GUIA_VER_EN[k];if(!v)return;document.querySelectorAll('.mod').forEach(m=>m.remove());
 if(v.tab){if(v.tab==='plan'){PB.persona='';PB.dia='';PB._ini=0;pbGuarda();}if(v.tab==='est'){ES.persona='';ES.abierta='';esGuarda();}if(v.tab==='arch'){AR.persona='';arGuarda();}
  S.tab=v.tab;guardaLS('tab',S.tab);pinta0();window.scrollTo(0,0);}
 if(v.fn)setTimeout(v.fn,50);
 if(v.el){let n=0;const busca=()=>{const e=document.querySelector(v.el);if(e&&e.offsetHeight){e.scrollIntoView({behavior:'smooth',block:'center'});e.classList.remove('gu-luz');void e.offsetWidth;e.classList.add('gu-luz');setTimeout(()=>e.classList.remove('gu-luz'),2600);}else if(n++<20)setTimeout(busca,150);};setTimeout(busca,250);}
 const g=GUIA.find(x=>x.k===k);let b=document.getElementById('guVuelve');if(b)b.remove();
 b=ce('div','gu-vuelve');b.id='guVuelve';b.innerHTML=`<button type="button" class="gu-v1"><svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg>Volver a la guía</button><span>${escH(g?g.t.replace(/ \(.*\)/,''):'')}</span><button type="button" class="gu-x" aria-label="Cerrar"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>`;
 document.body.appendChild(b);b.querySelector('.gu-v1').onclick=()=>{b.remove();document.querySelectorAll('.mod').forEach(m=>m.remove());guia(k);};b.querySelector('.gu-x').onclick=()=>b.remove();}
function guia(abre){{const b=document.getElementById('guVuelve');if(b)b.remove();}guardaLS('guia_vista',GUIA_VER);const m=modal(`<small class="cd-k">Guía</small><h3>Cómo funciona Rumbo</h3><p>Toca cada apartado para ver qué es y cómo se usa. Con «Ver en la app» vas a esa parte y luego vuelves a la guía.</p>
 <div class="gu">${GUIA.filter(g=>g.k!=='ctl'||verEst().length>1).map(g=>`<details class="gu-i"${g.k===(abre||'que')?' open':''}><summary><span class="gu-ic"><svg viewBox="0 0 24 24">${g.ic}</svg></span>${escH(g.t)}</summary><div class="gu-t cd-txt">${g.h}${GUIA_VER_EN[g.k]?`<button type="button" class="gu-ver" data-ver="${g.k}"><svg viewBox="0 0 24 24"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/></svg>Ver en la app</button>`:''}</div></details>`).join('')}</div>
 <div class="bts"><button class="bt" data-x>Entendido</button></div>`);
 m.querySelector('.hoja').classList.add('ancha');m.querySelector('[data-x]').onclick=()=>m.remove();
 m.querySelectorAll('[data-ver]').forEach(b=>b.onclick=()=>guiaVer(b.dataset.ver));
 if(abre&&abre!=='que')setTimeout(()=>{const d=m.querySelector('.gu-i[open]');if(d)d.scrollIntoView({block:'start'});},60);}
// La primera vez que alguien entra, se le abre sola (y otra vez si la guía cambia)
function guiaPrimeraVez(){const v=+leeLS('guia_vista',0);if(v<GUIA_VER)setTimeout(()=>{if(!document.querySelector('.mod'))guia();},600);}
