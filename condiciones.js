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

// Escribir la condición y enviarla
function escribeCond(e,A,hecho){const yo=S.yo.id,ahora=madMs(Date.now()),cs=condSemana(e,A,ahora),d=cs.valor-cs.ant,b=bueno(e,d);
 const para=new Set(dependeDe(yo)),gente=S.miembros.filter(m=>m.activo&&m.id!==yo).sort((a,b)=>(para.has(b.id)-para.has(a.id))||a.nombre.localeCompare(b.nombre,'es'));
 let elegida=leeLS('cd_borr_'+e.id+cs.semana+'_c','');
 const m=modal(`<div class="cd-w"><small class="cd-k">Condición · ${escH(e.nombre)}</small><h3>Semana del ${escH(fechaSem(ymd(cs.s0)))} al ${escH(fechaSem(cs.semana))}</h3>
  <div class="cd-nums"><div><small>Cerró con</small><b>${num(cs.valor)}</b></div><div><small>La anterior</small><b class="ant">${num(cs.ant)}</b></div><div><small>Diferencia</small><b style="color:${colorDe(b)}">${d>0?'+':d<0?'−':''}${num(Math.abs(d))}</b></div></div>
  <div class="cd-g">${graficaCond({puntos:cs.puntos,sentido:e.sentido})}</div>
  <label class="l">¿En qué condición estás?</label><div class="cd-lista">${COND.map(([n,k])=>`<button type="button" data-c="${escH(n)}" style="--k:${k}" class="${n===elegida?'on':''}"><i></i>${escH(n)}</button>`).join('')}</div>
  <div class="cd-esc"${elegida?'':' hidden'}><label class="l">Escribe tu condición</label><textarea class="i cd-ta" rows="7" maxlength="20000" placeholder="Escríbela aquí…"></textarea>
  <label class="l">¿A quién se la envías?</label><div class="chs cd-para">${gente.map(p=>`<button type="button" data-p="${p.id}" class="${para.has(p.id)?'on':''}">${IC.ck}${escH(pri(p.nombre))}${p.puesto?` <em class="op-v">${escH(p.puesto)}</em>`:''}</button>`).join('')}</div></div>
  <div class="err"></div><div class="bts"><button class="bt sec" data-x>Cancelar</button><button class="bt" data-ok${elegida?'':' disabled'}>Enviar</button></div></div>`);
 m.querySelector('.hoja').classList.add('ancha');
 const ta=m.querySelector('.cd-ta'),k='cd_borr_'+e.id+cs.semana;ta.value=leeLS(k,'');
 const crece=()=>{ta.style.height='auto';ta.style.height=Math.max(150,ta.scrollHeight+2)+'px';};
 ta.oninput=()=>{guardaLS(k,ta.value);crece();};
 m.querySelectorAll('.cd-lista button').forEach(x=>x.onclick=()=>{elegida=x.dataset.c;guardaLS(k+'_c',elegida);m.querySelectorAll('.cd-lista button').forEach(y=>y.classList.toggle('on',y===x));
  const w=m.querySelector('.cd-esc'),nuevo=w.hidden;w.hidden=false;m.querySelector('[data-ok]').disabled=false;if(nuevo){crece();setTimeout(()=>{w.scrollIntoView({behavior:'smooth',block:'start'});ta.focus({preventScroll:true});},60);}});
 if(elegida)setTimeout(crece,0);
 m.querySelectorAll('.cd-para [data-p]').forEach(x=>x.onclick=()=>{const id=x.dataset.p;para.has(id)?para.delete(id):para.add(id);x.classList.toggle('on',para.has(id));});
 m.querySelector('[data-x]').onclick=()=>m.remove();
 m.querySelector('[data-ok]').onclick=async ev=>{const er=m.querySelector('.err'),t=ta.value.trim();er.textContent='';
  if(!elegida){er.textContent='Elige la condición';return;}if(!t){er.textContent='Escribe tu condición';ta.focus();return;}if(!para.size){er.textContent='Elige a quién se la envías';return;}
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
  <div class="cv-n" style="--k:${condColor(c.condicion)}">${escH(c.condicion)}</div>
  <div class="cv-p">${avHTML(p)}<div><b>${escH(p.nombre)}</b>${pTag(p)}</div></div>
  <div class="cd-nums"><div><small>Estadística</small><b class="tx">${escH(c.est_nombre)}</b></div><div><small>Cerró con</small><b>${num(c.valor)}</b></div><div><small>La anterior</small><b class="ant">${num(c.valor_ant)}</b></div></div>
  ${(c.puntos||[]).length?`<div class="cd-g">${graficaCond(c)}</div>`:''}
  <div class="cv-t">${escH(c.texto).replace(/\n/g,'<br>')}</div>
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
 cab();let y=92;
 f('m',9,MUT);doc.text('CONDICIÓN',X,y,{charSpace:1.2});y+=34;
 f('b',32,K);doc.text(c.condicion,X,y);y+=30;
 // Persona y puesto
 f('m',13,INK);doc.text(p.nombre,X,y);
 if(p.puesto){const wn=doc.getTextWidth(p.nombre);f('m',9,CO);const wp=doc.getTextWidth(p.puesto)+16;doc.setFillColor(249,231,223);doc.roundedRect(X+wn+10,y-11,wp,16,8,8,'F');doc.text(p.puesto,X+wn+18,y);}
 y+=22;
 // Datos de la semana
 doc.setFillColor(...CR);doc.roundedRect(X,y,CW,66,12,12,'F');
 const d=Number(c.valor)-Number(c.valor_ant),bn=bueno({sentido:c.sentido},d),col=bn===null?MUT:bn?[22,128,60]:[192,57,43];
 const cel=(i,lab,val,cc,sub)=>{const cx=X+18+i*(CW-36)/3;f('m',7.5,MUT);doc.text(lab.toUpperCase(),cx,y+22,{charSpace:.8});f('b',i===0?11:17,cc||INK);
  const v=i===0?doc.splitTextToSize(val,(CW-36)/3-12).slice(0,2):[val];doc.text(v,cx,y+(i===0&&v.length>1?37:43));if(sub){f('r',8,MUT);doc.text(sub,cx,y+56);}};
 cel(0,'Estadística',c.est_nombre);cel(1,'Cerró con',num(c.valor),INK,c.eje_y||'');cel(2,'La anterior',num(c.valor_ant),MUT,(d>0?'+':d<0?'−':'')+num(Math.abs(d))+' de diferencia');
 y+=88;
 // Gráfica
 if((c.puntos||[]).length){const png=await svgPNG(graficaCond(c),340,210);if(png){const gh=CW*226/340*.72,gw=gh*340/226;doc.addImage(png,'PNG',X+(CW-gw)/2,y,gw,gh);y+=gh+26;}}
 // Lo escrito
 f('m',9,CO);doc.text('MI CONDICIÓN',X,y,{charSpace:1.2});y+=8;doc.setDrawColor(...CO);doc.setLineWidth(.8);doc.line(X,y,X+28,y);y+=22;
 f('r',11,[40,36,33]);const LH=17.5;
 for(const par of String(c.texto).split(/\n/)){const L=par.trim()?doc.splitTextToSize(par,CW):[''];for(const l of L){if(y>H-72){doc.addPage();cab();y=80;f('r',11,[40,36,33]);}doc.text(l,X,y);y+=LH;}y+=par.trim()?5:0;}
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
