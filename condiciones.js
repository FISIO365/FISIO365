// ── CONDICIONES: cuando cierra la semana (jueves 14:00), cada uno elige en qué condición está con cada
// estadística semanal, la escribe y se la envía a quien quiera del equipo. Llega a su bandeja y sale en PDF.
const COND=[['Poder','#0f6b3a'],['Cambio de poder','#16803c'],['Afluencia','#2e9a55'],['Operación normal','#6aa84f'],['Emergencia','#d29c00'],['Peligro','#e07b00'],
 ['Inexistencia','#c2552e'],['Riesgo','#b03a2e'],['Duda','#8e3b5b'],['Enemigo','#6b2d5c'],['Traición','#4a2b4f'],['Confusión','#5b5550']];
const condColor=n=>(COND.find(c=>c[0]===n)||[0,'#5b5550'])[1];
const condChip=(n,cl)=>`<span class="cd-chip${cl?' '+cl:''}" style="--k:${condColor(n)}">${escH(n)}</span>`;
const fechaSem=s=>{const d=new Date(s+'T12:00:00Z');return DSEM[d.getUTCDay()]+' '+d.getUTCDate()+' '+MESES[d.getUTCMonth()];};

// La semana que acaba de cerrar (la de jueves 14:00 a jueves 14:00 anterior a la actual)
function condSemana(e,A,ahora){const fin=perIni('semana',ahora),s0=fin-HS,v=(a,b)=>A.reduce((t,x)=>x.L>=a&&x.L<b?t+Number(x.cantidad):t,0);
 return {s0,fin,semana:ymd(fin),valor:v(s0,fin),ant:v(s0-HS,s0),hay:A.some(x=>x.L<fin),
  puntos:totales(e,A,ahora).filter(x=>x.s<=s0).slice(-12).map(x=>({s:x.s,v:x.v}))};}
const graficaCond=c=>{const P=(Array.isArray(c.puntos)?c.puntos:[]).map(p=>({s:Number(p.s)||0,v:Number(p.v)||0,actual:false}));return P.length?grafica({periodo:'semana',sentido:c.sentido==='negativa'?'negativa':'positiva'},P,0,false):'';};

// La tarjeta «Condición» en el detalle de una estadística semanal
function condTarjeta(e,A,ahora,L){const yo=S.yo.id,propio=e.persona===yo,cs=condSemana(e,A,ahora);
 const ya=L.find(c=>c.semana===cs.semana&&c.persona===e.persona),ant=L.filter(c=>c!==ya).slice(0,8);
 if(!propio&&!L.length)return '';
 let h=`<div class="rp-c cd-card"><div class="eq-h"><div><small>Condición · jueves 14:00</small><b>Semana que cerró el ${escH(fechaSem(cs.semana))}</b></div></div>`;
 if(ya)h+=`<button type="button" class="cd-ya" data-cv="${ya.id}">${condChip(ya.condicion,'gr')}<em>Ver o descargar el PDF</em><svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg></button>`;
 else if(propio&&cs.hay)h+=`<p class="eq-p">Cerró con <b>${num(cs.valor)}</b> (la anterior, ${num(cs.ant)}). ¿En qué condición estás? La eliges, la escribes y se la envías a quien quieras.</p><button type="button" class="bt full cd-elige">Elegir mi condición</button>`;
 else if(propio)h+=`<p class="eq-p">La primera condición la eliges cuando cierre la semana, el jueves a las 14:00.</p>`;
 else h+=`<p class="eq-p">Aún no te ha enviado la condición de esta semana.</p>`;
 if(ant.length)h+=`<div class="cd-hist"><small>Anteriores</small>${ant.map(c=>`<button type="button" data-cv="${c.id}"><span>${escH(fechaSem(c.semana))}</span>${condChip(c.condicion)}</button>`).join('')}</div>`;
 return h+'</div>';}

// ── Texto con formato, como un documento: **negrita**, __subrayado__, ==fosforito==, «# » título y «- » lista
const condIn=t=>escH(t).replace(/\*\*(.+?)\*\*/g,'<b>$1</b>').replace(/__(.+?)__/g,'<u>$1</u>').replace(/==(.+?)==/g,'<mark>$1</mark>');
function condHTML(t){let h='',ul=false;for(const l of String(t||'').split('\n')){
 if(/^- /.test(l)){if(!ul){h+='<ul>';ul=true;}h+=`<li>${condIn(l.slice(2))||'<br>'}</li>`;continue;}
 if(ul){h+='</ul>';ul=false;}h+=/^# /.test(l)?`<h3>${condIn(l.slice(2))}</h3>`:`<div>${condIn(l)||'<br>'}</div>`;}
 return h+(ul?'</ul>':'');}
// Del editor a texto con marcas (se lee una copia, con sus estilos reales)
function condMarks(ed){const cp=ed.cloneNode(true);cp.removeAttribute('contenteditable');cp.style.cssText='position:fixed;left:-9999px;top:0;width:500px';document.body.appendChild(cp);
 const fondo=e=>{const c=getComputedStyle(e).backgroundColor;return c&&!/^(transparent|rgba\(0, 0, 0, 0\))$/.test(c);};
 const inl=blk=>{const R=[],w=document.createTreeWalker(blk,NodeFilter.SHOW_TEXT);let n;
  while((n=w.nextNode())){const t=n.nodeValue.replace(/\s+/g,' ');if(!t)continue;let b=false,u=false,h=false;
   for(let e=n.parentElement;e&&e!==blk;e=e.parentElement){const c=getComputedStyle(e);if(+c.fontWeight>=600)b=true;if(String(c.textDecorationLine||c.textDecoration).includes('underline'))u=true;if(fondo(e))h=true;}
   const l=R[R.length-1];if(l&&l.b===b&&l.u===u&&l.h===h)l.t+=t;else R.push({b,u,h,t});}
  return R.map(r=>{let t=r.t.replace(/\*\*|__|==/g,'');if(!t.trim())return t;const a=t.match(/^\s*/)[0],z=t.match(/\s*$/)[0];t=t.trim();if(r.h)t='=='+t+'==';if(r.u)t='__'+t+'__';if(r.b)t='**'+t+'**';return a+t+z;}).join('').replace(/ +/g,' ').trim();};
 const out=[],BLK=/^(DIV|P|H[1-6]|UL|OL|LI|BLOCKQUOTE)$/;let suelto=null;
 const corta=()=>{if(suelto){out.push(inl(suelto));suelto.remove();suelto=null;}};
 const va=par=>{[...par.childNodes].forEach(nd=>{
  if(nd.nodeType===1&&BLK.test(nd.tagName)){corta();
   if(nd.tagName==='UL'||nd.tagName==='OL'){[...nd.children].forEach(li=>out.push('- '+inl(li)));return;}
   if([...nd.children].some(x=>BLK.test(x.tagName))){va(nd);return;}
   out.push((/^H/.test(nd.tagName)?'# ':nd.tagName==='LI'?'- ':'')+inl(nd));return;}
  if(nd.nodeType===1&&nd.tagName==='BR'&&!suelto){out.push('');return;}
  if(!suelto){suelto=document.createElement('div');par.insertBefore(suelto,nd);}suelto.appendChild(nd);});corta();};
 va(cp);cp.remove();
 while(out.length&&!out[out.length-1].replace(/^[#-] /,'').trim())out.pop();
 return out.map(l=>/^[#-] $/.test(l)?'':l).join('\n');}
// Barra de formato del documento
function condBarra(bar,ed){
 const fos=()=>{const s=getSelection();if(!s.rangeCount)return false;let e=s.anchorNode;e=e&&(e.nodeType===3?e.parentElement:e);for(;e&&e!==ed;e=e.parentElement){if(e.tagName==='MARK')return true;const c=getComputedStyle(e).backgroundColor;if(c&&!/^(transparent|rgba\(0, 0, 0, 0\))$/.test(c))return true;}return false;};
 const blq=()=>{const s=getSelection();if(!s.rangeCount)return '';let e=s.anchorNode;e=e&&(e.nodeType===3?e.parentElement:e);for(;e&&e!==ed;e=e.parentElement)if(/^(H3|LI)$/.test(e.tagName))return e.tagName;return '';};
 const marca=()=>{if(!ed.contains(getSelection().anchorNode))return;const on={b:document.queryCommandState('bold'),u:document.queryCommandState('underline'),h:fos(),t:blq()==='H3',l:blq()==='LI'};bar.querySelectorAll('button').forEach(b=>b.classList.toggle('on',!!on[b.dataset.f]));};
 bar.querySelectorAll('button').forEach(b=>{b.onmousedown=ev=>ev.preventDefault();b.onclick=()=>{ed.focus();const f=b.dataset.f;
  try{document.execCommand('styleWithCSS',false,f==='h');}catch(_){}
  if(f==='b')document.execCommand('bold');else if(f==='u')document.execCommand('underline');
  else if(f==='h')document.execCommand('hiliteColor',false,fos()?'transparent':'#ffe680');
  else if(f==='t')document.execCommand('formatBlock',false,blq()==='H3'?'p':'h3');
  else if(f==='l')document.execCommand('insertUnorderedList');
  ed.dispatchEvent(new Event('input'));marca();};});
 // Como en Word: después de un título, la línea siguiente ya es texto normal
 ed.addEventListener('keydown',ev=>{if(ev.key==='Enter'&&!ev.shiftKey&&blq()==='H3')setTimeout(()=>{if(blq()==='H3'){document.execCommand('formatBlock',false,'p');if(document.queryCommandState('bold'))document.execCommand('bold');marca();}},0);});
 document.addEventListener('selectionchange',marca);}

// Escribir la condición y enviarla
function escribeCond(e,A,hecho){const yo=S.yo.id,ahora=madMs(Date.now()),cs=condSemana(e,A,ahora),d=cs.valor-cs.ant,b=bueno(e,d);
 const para=new Set(dependeDe(yo)),gente=S.miembros.filter(m=>m.activo&&m.id!==yo).sort((a,b)=>(para.has(b.id)-para.has(a.id))||a.nombre.localeCompare(b.nombre,'es'));
 let elegida=leeLS('cd_borr_'+e.id+cs.semana+'_c','');
 const m=modal(`<div class="cd-w"><small class="cd-k">Condición · ${escH(e.nombre)}</small><h3>Semana del ${escH(fechaSem(ymd(cs.s0)))} al ${escH(fechaSem(cs.semana))}</h3>
  <div class="cd-nums"><div><small>Cerró con</small><b>${num(cs.valor)}</b></div><div><small>La anterior</small><b class="ant">${num(cs.ant)}</b></div><div><small>Diferencia</small><b style="color:${colorDe(b)}">${d>0?'+':d<0?'−':''}${num(Math.abs(d))}</b></div></div>
  <div class="cd-g">${graficaCond({puntos:cs.puntos,sentido:e.sentido})}</div>
  <label class="l">¿En qué condición estás?</label><div class="cd-lista">${COND.map(([n,k])=>`<button type="button" data-c="${escH(n)}" style="--k:${k}" class="${n===elegida?'on':''}"><i></i>${escH(n)}</button>`).join('')}</div>
  <div class="cd-esc"${elegida?'':' hidden'}><label class="l">Escribe tu condición</label><div class="cd-doc"><div class="cd-bar">
   <button type="button" data-f="b" title="Negrita" aria-label="Negrita"><b>B</b></button><button type="button" data-f="u" title="Subrayar" aria-label="Subrayar"><u>S</u></button>
   <button type="button" data-f="h" title="Fosforito" aria-label="Fosforito"><svg viewBox="0 0 24 24"><path d="m14.5 4.5 5 5L11 18l-5.5.5L6 13z"/><path d="M4 21h7"/></svg></button><i></i>
   <button type="button" data-f="t" title="Título" aria-label="Título"><svg viewBox="0 0 24 24"><path d="M5 6h14M12 6v13"/></svg></button><button type="button" data-f="l" title="Lista" aria-label="Lista"><svg viewBox="0 0 24 24"><circle cx="5" cy="7" r="1.2"/><circle cx="5" cy="12" r="1.2"/><circle cx="5" cy="17" r="1.2"/><path d="M9.5 7H20M9.5 12H20M9.5 17H20"/></svg></button></div>
   <div class="cd-ed cd-txt" contenteditable="true" role="textbox" aria-multiline="true" spellcheck="true" data-ph="Escríbela aquí. Puedes poner títulos, listas, negrita…"></div></div>
  <label class="l">¿A quién se la envías?</label><div class="chs cd-para">${gente.map(p=>`<button type="button" data-p="${p.id}" class="${para.has(p.id)?'on':''}">${IC.ck}${escH(pri(p.nombre))}${p.puesto?` <em class="op-v">${escH(p.puesto)}</em>`:''}</button>`).join('')}</div></div>
  <div class="err"></div><div class="bts"><button class="bt sec" data-x>Cancelar</button><button class="bt" data-ok${elegida?'':' disabled'}>Enviar</button></div></div>`);
 m.querySelector('.hoja').classList.add('ancha');
 const ed=m.querySelector('.cd-ed'),k='cd_borr_'+e.id+cs.semana;ed.innerHTML=condHTML(leeLS(k,''));
 const vacio=()=>ed.classList.toggle('vacio',!ed.textContent.trim()&&!ed.querySelector('li'));vacio();
 ed.addEventListener('input',()=>{vacio();guardaLS(k,condMarks(ed));});
 ed.addEventListener('paste',ev=>{ev.preventDefault();document.execCommand('insertText',false,(ev.clipboardData||window.clipboardData).getData('text/plain'));});
 condBarra(m.querySelector('.cd-bar'),ed);
 m.querySelectorAll('.cd-lista button').forEach(x=>x.onclick=()=>{elegida=x.dataset.c;guardaLS(k+'_c',elegida);m.querySelectorAll('.cd-lista button').forEach(y=>y.classList.toggle('on',y===x));
  const w=m.querySelector('.cd-esc'),nuevo=w.hidden;w.hidden=false;m.querySelector('[data-ok]').disabled=false;if(nuevo)setTimeout(()=>w.scrollIntoView({behavior:'smooth',block:'start'}),60);});
 m.querySelectorAll('.cd-para [data-p]').forEach(x=>x.onclick=()=>{const id=x.dataset.p;para.has(id)?para.delete(id):para.add(id);x.classList.toggle('on',para.has(id));});
 m.querySelector('[data-x]').onclick=()=>m.remove();
 m.querySelector('[data-ok]').onclick=async ev=>{const er=m.querySelector('.err'),t=condMarks(ed).trim();er.textContent='';
  if(!elegida){er.textContent='Elige la condición';return;}if(!t.replace(/\*\*|__|==|^[#-] /gm,'').trim()){er.textContent='Escribe tu condición';ed.focus();return;}if(!para.size){er.textContent='Elige a quién se la envías';return;}
  ev.target.disabled=true;
  const fila={equipo_id:S.yo.equipo_id,persona:yo,estadistica_id:e.id,est_nombre:e.nombre,eje_y:e.eje_y,sentido:e.sentido,semana:cs.semana,valor:cs.valor,valor_ant:cs.ant,puntos:cs.puntos,condicion:elegida,texto:t,para:[...para]};
  const {data,error}=await sb.from('pb_condiciones').insert(fila).select().single();
  if(error){ev.target.disabled=false;er.textContent='No se ha podido enviar';return;}
  guardaLS(k,'');guardaLS(k+'_c','');m.remove();toast('Enviada a '+[...para].map(id=>pri(nomDe(id))).join(', '));hecho&&hecho(data);verCond(data);};}

// Ver una condición (la tuya o una que te han enviado)
async function abreCond(id){const {data,error}=await sb.from('pb_condiciones').select('*').eq('id',id).maybeSingle();if(error||!data){toast('No se ha podido abrir',false);return;}verCond(data);}
function verCond(c){const yo=S.yo.id,p=M(c.persona)||{nombre:'—'},d=Number(c.valor)-Number(c.valor_ant),b=bueno({sentido:c.sentido},d);
 if(c.para&&c.para.includes(yo)&&!(c.leida||[]).includes(yo)){sb.rpc('pb_cond_leida',{c:c.id}).then(()=>contarCond());}
 const comp=!!(navigator.canShare&&navigator.canShare({files:[new File([''],'a.pdf',{type:'application/pdf'})]}));
 const m=modal(`<div class="cv"><small class="cd-k">Condición · semana que cerró el ${escH(fechaSem(c.semana))}</small>
  <div class="cv-p">${avHTML(p)}<div><small>De</small><b>${escH(p.nombre)}${c.persona===yo?' <i>(tú)</i>':''}</b>${pTag(p)}</div></div>
  <div class="cv-dos"><div><small>Estadística</small><b>${escH(c.est_nombre)}</b></div><div><small>Condición</small><b class="cv-n" style="--k:${condColor(c.condicion)}">${escH(c.condicion)}</b></div></div>
  <div class="cv-t cd-txt">${condHTML(c.texto)}</div>
  <p class="cv-pie">${c.persona===yo?'Enviada a ':'Para '}${(c.para||[]).map(id=>id===yo?'ti':escH(pri(nomDe(id)))).join(', ')} · ${escH(new Date(c.creado).toLocaleString('es-ES',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',timeZone:'Europe/Madrid'}))}</p>
  <div class="bts"><button class="bt${comp?' sec':''}" data-pdf>Descargar PDF</button>${comp?'<button class="bt" data-sh>Compartir</button>':''}</div>
  ${c.persona===yo?'<button class="lnk cv-bo" data-bo>Borrar esta condición</button>':''}</div>`);
 m.querySelector('.hoja').classList.add('ancha');
 m.querySelector('[data-pdf]').onclick=ev=>condPDFsale(c,false,ev.target);
 const sh=m.querySelector('[data-sh]');if(sh)sh.onclick=ev=>condPDFsale(c,true,ev.target);
 const bo=m.querySelector('[data-bo]');if(bo)bo.onclick=()=>pregunta('¿Borrar esta condición?',{sub:'Dejará de verla también quien la recibió.',si:'Borrar'}).then(async ok=>{if(!ok)return;const {error}=await sb.from('pb_condiciones').delete().eq('id',c.id);if(error){toast('No se ha podido',false);return;}m.remove();toast('Borrada');window._esRecargar&&window._esRecargar();});}

// Bandeja: las que te han enviado y las que has enviado tú
let _cdTab='rec';
async function bandejaCond(){const yo=S.yo.id,m=modal('<h3>Condiciones</h3><p>Cargando…</p>');m.querySelector('.hoja').classList.add('ancha');
 const {data,error}=await sb.from('pb_condiciones').select('id,persona,est_nombre,semana,condicion,para,leida,creado').order('creado',{ascending:false}).limit(150);
 if(!m.isConnected)return;if(error){m.querySelector('.hoja').innerHTML='<h3>Condiciones</h3><p>No se ha podido cargar.</p>';return;}
 const R=(data||[]).filter(c=>(c.para||[]).includes(yo)),E=(data||[]).filter(c=>c.persona===yo),nuevas=R.filter(c=>!(c.leida||[]).includes(yo)).length;
 const pinta=()=>{const L=_cdTab==='rec'?R:E;
  m.querySelector('.hoja').innerHTML=`<h3>Condiciones</h3><div class="es-tabs" style="margin-top:12px"><button type="button" data-t="rec" class="${_cdTab==='rec'?'on':''}">Recibidas${nuevas?' · '+nuevas+' nueva'+(nuevas>1?'s':''):''}</button><button type="button" data-t="env" class="${_cdTab==='env'?'on':''}">Enviadas</button></div>
   ${L.length?`<div class="cd-band">${L.map(c=>{const p=M(c.persona)||{nombre:'—'},nu=_cdTab==='rec'&&!(c.leida||[]).includes(yo);
    return `<button type="button" class="cd-f${nu?' nu':''}" data-cv="${c.id}">${avHTML(p)}<span class="tx"><b>${_cdTab==='rec'?escH(p.nombre):'Para '+(c.para||[]).map(id=>escH(pri(nomDe(id)))).join(', ')}</b>${_cdTab==='rec'?pTag(p):''}<small>${escH(c.est_nombre)} · semana del ${escH(fechaSem(c.semana))}</small></span>${condChip(c.condicion)}</button>`;}).join('')}</div>`
   :`<p class="vacio">${_cdTab==='rec'?'Aún no te han enviado ninguna. Cuando alguien te envíe su condición, te llega aquí.':'Aún no has enviado ninguna. Los jueves a las 14:00, cuando cierra la semana, la eliges desde cada estadística.'}</p>`}
   <div class="bts"><button class="bt sec" data-x>Cerrar</button></div>`;
  m.querySelectorAll('[data-t]').forEach(b=>b.onclick=()=>{_cdTab=b.dataset.t;pinta();});
  m.querySelector('[data-x]').onclick=()=>m.remove();
  m.querySelectorAll('[data-cv]').forEach(b=>b.onclick=()=>{m.remove();abreCond(b.dataset.cv);});};
 if(!R.length&&E.length)_cdTab='env';pinta();}
async function contarCond(){try{const yo=S.yo.id;const {count}=await sb.from('pb_condiciones').select('id',{count:'exact',head:true}).contains('para',[yo]).not('leida','cs',`{${yo}}`);
 const e=document.getElementById('nCd');if(e){e.textContent=count||0;e.hidden=!count;}}catch(_){}}

// ── PDF (jsPDF con Poppins, todo en local)
const _js={};function cargaJs(u){return _js[u]||(_js[u]=new Promise((ok,ko)=>{const s=document.createElement('script');s.src=u;s.onload=ok;s.onerror=()=>{delete _js[u];ko(new Error('js'));};document.head.appendChild(s);}));}
const _fu={};async function fuenteB64(u){if(_fu[u])return _fu[u];const a=new Uint8Array(await (await fetch(u)).arrayBuffer());let s='';for(let i=0;i<a.length;i+=0x8000)s+=String.fromCharCode.apply(null,a.subarray(i,i+0x8000));return _fu[u]=btoa(s);}
// La gráfica (SVG con los estilos de la app) pasada a imagen
function svgPNG(svg,w,h){return new Promise(ok=>{let css='';for(const sh of document.styleSheets){try{for(const r of sh.cssRules)if(r.selectorText&&/\.es-/.test(r.selectorText))css+=r.cssText;}catch(_){}}
 const rs=getComputedStyle(document.documentElement);css=css.replace(/var\((--[\w-]+)\)/g,(_,v)=>rs.getPropertyValue(v).trim()||'#c2552e');
 svg=svg.replace(/viewBox="0 0 (\d+) (\d+)"/,(_,a,b)=>`viewBox="0 -8 ${a} ${+b+16}"`);h+=16*w/340;
 svg=svg.replace('<svg ',`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" font-family="Poppins, Helvetica, Arial, sans-serif" `).replace(/(<svg[^>]*>)/,`$1<style>${css}</style>`);
 const im=new Image();im.onload=()=>{const c=document.createElement('canvas');c.width=w*3;c.height=h*3;const x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,c.width,c.height);x.drawImage(im,0,0,c.width,c.height);ok(c.toDataURL('image/png'));};
 im.onerror=()=>ok(null);im.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);});}
async function condPDF(c){await cargaJs('/lib/jspdf.umd.min.js');const {jsPDF}=window.jspdf,doc=new jsPDF({unit:'pt',format:'a4'});
 let F='helvetica',st={r:'normal',m:'bold',b:'bold'};
 try{const [r,md,b]=await Promise.all(['Regular','Medium','Bold'].map(x=>fuenteB64('/lib/Poppins-'+x+'.ttf')));
  doc.addFileToVFS('P-R.ttf',r);doc.addFont('P-R.ttf','Poppins','normal');doc.addFileToVFS('P-M.ttf',md);doc.addFont('P-M.ttf','Poppins','medium');doc.addFileToVFS('P-B.ttf',b);doc.addFont('P-B.ttf','Poppins','bold');F='Poppins';st={r:'normal',m:'medium',b:'bold'};}catch(_){}
 const W=595.28,H=841.89,X=50,CW=W-2*X,hex=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16));
 const CO=[194,85,46],INK=[26,26,26],MUT=[128,118,110],CR=[245,242,238],K=hex(condColor(c.condicion));
 const f=(s,z,col)=>{doc.setFont(F,st[s]);doc.setFontSize(z);doc.setTextColor(...(col||INK));};
 const p=M(c.persona)||{nombre:'—'},eq=(S.equipo&&S.equipo.nombre)||'';
 const cab=()=>{doc.setFillColor(...CO);doc.rect(0,0,W,6,'F');f('m',8,CO);doc.text(('Plan de batalla'+(eq?' · '+eq:'')).toUpperCase(),X,40,{charSpace:1.2});
  f('r',8.5,MUT);doc.text('Semana que cerró el '+fechaSem(c.semana)+' a las 14:00',W-X,40,{align:'right'});};
 cab();let y=96;
 // De quién es y su puesto
 f('m',9,MUT);doc.text('DE',X,y,{charSpace:1.2});y+=30;
 f('b',26,INK);doc.text(p.nombre,X,y);y+=14;
 if(p.puesto){f('m',10,CO);const wp=doc.getTextWidth(p.puesto)+20;doc.setFillColor(249,231,223);doc.roundedRect(X,y,wp,20,10,10,'F');doc.text(p.puesto,X+10,y+14);y+=20;}
 y+=22;
 // La estadística y la condición
 doc.setFillColor(...CR);doc.roundedRect(X,y,CW,82,12,12,'F');const cw=(CW-40)/2,c2=X+20+cw+10;
 f('m',7.5,MUT);doc.text('ESTADÍSTICA',X+20,y+26,{charSpace:.8});doc.text('CONDICIÓN',c2,y+26,{charSpace:.8});
 f('b',14,INK);const en=doc.splitTextToSize(c.est_nombre,cw-10).slice(0,2);doc.text(en,X+20,y+(en.length>1?46:52));
 doc.setFillColor(...K);doc.circle(c2+5,y+47,4.5,'F');f('b',20,K);doc.text(c.condicion,c2+16,y+54);
 y+=110;
 // Lo escrito
 f('m',9,CO);doc.text(('Lo que escribe '+pri(p.nombre)).toUpperCase(),X,y,{charSpace:1.2});y+=8;doc.setDrawColor(...CO);doc.setLineWidth(.8);doc.line(X,y,X+28,y);y+=22;
 const TX=[40,36,33],LH=17.5;
 const salto=n=>{if(y+n>H-60){doc.addPage();cab();y=80;}};
 const linea=(txt,x0,ancho,base)=>{ // pinta un párrafo con negrita/subrayado/fosforito, partiendo en líneas
  const P=String(txt).split(/(\*\*|__|==)/);let b=false,u=false,h=false;const W=[];
  for(const t of P){if(t==='**'){b=!b;continue;}if(t==='__'){u=!u;continue;}if(t==='=='){h=!h;continue;}t.split(/(\s+)/).forEach(w=>{if(w)W.push({w,b:b||base.b,u,h});});}
  let x=x0;salto(LH);const fin=()=>{y+=base.lh;x=x0;salto(base.lh);};
  for(const it of W){const sp=/^\s+$/.test(it.w);f(it.b?'b':'r',base.z,base.col);const ww=doc.getTextWidth(sp?' ':it.w);
   if(sp){if(x>x0)x+=ww;continue;}if(x+ww>x0+ancho&&x>x0)fin();
   if(it.h){doc.setFillColor(255,230,128);doc.rect(x-1,y-base.z*.82,ww+2,base.z*1.12,'F');}
   f(it.b?'b':'r',base.z,base.col);doc.text(it.w,x,y);
   if(it.u){doc.setDrawColor(...base.col);doc.setLineWidth(.6);doc.line(x,y+2,x+ww,y+2);}
   x+=ww;}
  y+=base.lh;};
 const norm={z:11,lh:LH,col:TX};
 for(const l of String(c.texto).split('\n')){
  if(/^# /.test(l)){y+=6;salto(30);linea(l.slice(2),X,CW,{z:13.5,lh:20,col:INK,b:true});y+=2;}
  else if(/^- /.test(l)){salto(LH);f('b',11,CO);doc.text('•',X+3,y);linea(l.slice(2),X+16,CW-16,norm);}
  else if(!l.trim())y+=LH*.6;
  else{linea(l,X,CW,norm);y+=4;}}
 // Pie en todas las páginas
 const n=doc.getNumberOfPages(),fc=new Date(c.creado),cuando=(isNaN(fc)||fc.getFullYear()<2000?new Date():fc).toLocaleString('es-ES',{day:'numeric',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'Europe/Madrid'});
 const pie=`${p.nombre} · ${cuando} · Para ${(c.para||[]).map(id=>nomDe(id)).join(', ')}`;
 for(let i=1;i<=n;i++){doc.setPage(i);doc.setDrawColor(230,224,218);doc.setLineWidth(.6);doc.line(X,H-46,W-X,H-46);f('r',8,MUT);doc.text(doc.splitTextToSize(pie,CW-50)[0],X,H-30);if(n>1)doc.text(i+' / '+n,W-X,H-30,{align:'right'});}
 return doc.output('blob');}
async function condPDFsale(c,comp,bt){const t0=bt&&bt.textContent;if(bt){bt.disabled=true;bt.textContent='Preparando…';}
 try{const bl=await condPDF(c),nom=('Condicion '+c.condicion+' - '+nomDe(c.persona)+' - '+c.est_nombre+' - '+c.semana).normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^\w\- ]+/g,'').slice(0,90)+'.pdf';
  const fl=new File([bl],nom,{type:'application/pdf'});
  if(comp){try{await navigator.share({files:[fl],title:'Condición: '+c.condicion});}catch(e){if(e&&e.name!=='AbortError')toast('No se ha podido compartir',false);}}
  else{const u=URL.createObjectURL(bl),a=document.createElement('a');a.href=u;a.download=nom;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),6e4);}}
 catch(e){toast('No se ha podido hacer el PDF',false);}
 finally{if(bt){bt.disabled=false;bt.textContent=t0;}}}
