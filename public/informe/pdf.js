// Generador del PDF del informe (diseño de marca). Lo usa la app del paciente.
(function(){
let _pdfRecursos=null;
function cargarRecursosPDF(){
 if(_pdfRecursos) return _pdfRecursos;
 const b64=async u=>{const r=await fetch(u);if(!r.ok)throw new Error(u);const buf=new Uint8Array(await r.arrayBuffer());let s='';for(let i=0;i<buf.length;i+=0x8000)s+=String.fromCharCode.apply(null,buf.subarray(i,i+0x8000));return btoa(s);};
 _pdfRecursos=Promise.all(['/informe/Poppins-Regular.ttf','/informe/Poppins-Medium.ttf','/informe/Poppins-Bold.ttf','/informe/logo.png'].map(b64))
  .then(([reg,med,bold,logo])=>({reg,med,bold,logo})).catch(e=>{_pdfRecursos=null;return null;});
 return _pdfRecursos;
}
function _generarPDF(pacNom,informe,tipoLabel,fisioNom,colNum,fecha,modo){
 const {jsPDF}=window.jspdf;
 const doc=new jsPDF({unit:'mm',format:'a4'});
 const R=window._pdfRec;
 let F='helvetica';
 if(R){try{doc.addFileToVFS('P-R.ttf',R.reg);doc.addFont('P-R.ttf','Poppins','normal');doc.addFileToVFS('P-M.ttf',R.med);doc.addFont('P-M.ttf','Poppins','medium');doc.addFileToVFS('P-B.ttf',R.bold);doc.addFont('P-B.ttf','Poppins','bold');F='Poppins';}catch(e){F='helvetica';}}
 const fw=w=>F==='Poppins'?w:(w==='medium'?'bold':w);
 const W=210,H=297,ml=24,mr=24,tw=W-ml-mr,FOOT=26;
 const NAR=[194,85,46],NEG=[26,26,26],TXT=[60,52,47],GRIS=[125,112,104],CREMA=[247,244,240],LINEA=[232,225,218];
 let y=0;
 const txt=(t,x,yy,o)=>doc.text(t,x,yy,o);
 const set=(sz,w,c)=>{doc.setFont(F,fw(w));doc.setFontSize(sz);doc.setTextColor(...c);};
 const sitio=h=>{if(y+h>H-FOOT){doc.addPage();y=26;}};

 // ── Cabecera discreta ──
 if(R&&R.logo){try{doc.addImage('data:image/png;base64,'+R.logo,'PNG',ml,20,26,4.6);}catch(e){set(13,'bold',NAR);txt('FISIO365',ml,24.5);}}
 else{set(13,'bold',NAR);txt('FISIO365',ml,24.5);}
 const esTto=/fisioterap[eé]utico/i.test(String(tipoLabel||''));
 set(8.5,'normal',GRIS);txt((esTto?'Informe fisioterapéutico':'Informe de valoración')+' · '+fecha,W-mr,24,{align:'right'});
 doc.setDrawColor(...LINEA);doc.setLineWidth(.3);doc.line(ml,31,W-mr,31);

 // ── Datos del paciente ──
 y=42;
 const col=(lab,val,x,extra)=>{set(7.5,'medium',GRIS);txt(lab,x,y);set(11.5,'bold',NEG);txt(doc.splitTextToSize(String(val||'—'),tw/3-6)[0],x,y+6.5);if(extra){set(8,'normal',GRIS);txt(extra,x,y+11.5);}};
 col('Paciente',pacNom,ml);if(esTto)col('Fecha',fecha,ml+tw/3);else col('Zona valorada',tipoLabel,ml+tw/3);col('Fisioterapeuta',fisioNom||'—',ml+2*tw/3,colNum);
 y+=24;
 doc.setDrawColor(...LINEA);doc.line(ml,y,W-mr,y);
 y+=13;

 // ── Contenido ──
 const lineas=String(informe||'').replace(/\r/g,'').split('\n').map(l=>l.trim()).filter(Boolean);
 const esTitulo=l=>(/^[A-ZÁÉÍÓÚÑÜ0-9 ,\/·()-]{5,}$/.test(l)||(/^[^.;]{3,45}:$/.test(l)&&l.split(/\s+/).length<=5))&&!/^- /.test(l);
 let enSencillo=false,bloque=[],primero=true;
 const titulo=t=>{t=t.replace(/:$/,'');sitio(20);if(!primero)y+=6;primero=false;set(9,'bold',NAR);txt(t.toUpperCase(),ml,y,{charSpace:.4});y+=7;};
 const parrafo=(t,bullet)=>{
  set(10.5,'normal',TXT);
  const x=bullet?ml+6:ml,ancho=bullet?tw-6:tw;
  const ls=doc.splitTextToSize(t,ancho);
  ls.forEach((l,i)=>{sitio(7);if(bullet&&i===0){set(10.5,'normal',GRIS);txt('–',ml+.5,y);set(10.5,'normal',TXT);}txt(l,x,y);y+=6;});
  y+=2;
 };
 const cajaSencillo=t=>{
  set(10.5,'normal',TXT);const ls=doc.splitTextToSize(t,tw-20);const h=ls.length*6+22;
  sitio(h+10);y+=8;
  doc.setFillColor(...CREMA);doc.roundedRect(ml,y,tw,h,5,5,'F');
  set(9,'bold',NAR);txt('EN PALABRAS SENCILLAS',ml+10,y+11,{charSpace:.4});
  set(10.5,'normal',TXT);ls.forEach((l,i)=>txt(l,ml+10,y+19+i*6));
  y+=h+6;
 };
 // Sección sin texto (informe en blanco): deja renglones para escribir a mano
 const renglones=()=>{doc.setDrawColor(...LINEA);doc.setLineWidth(.25);for(let k=0;k<4;k++){sitio(10);y+=9;doc.line(ml,y,W-mr,y);}y+=6;};
 lineas.forEach((l,i)=>{
  if(esTitulo(l)&&!/SENCILL/.test(l)&&i>0&&esTitulo(lineas[i-1])&&!/SENCILL/.test(lineas[i-1]))renglones();
  if(esTitulo(l)&&!/SENCILL/.test(l)&&(i===lineas.length-1||esTitulo(lineas[i+1])))sitio(66); // título + renglones, juntos en la misma página
  if(esTitulo(l)){if(enSencillo&&bloque.length){cajaSencillo(bloque.join(' '));bloque=[];}enSencillo=/SENCILL/.test(l);if(!enSencillo)titulo(l);return;}
  if(enSencillo){bloque.push(l.replace(/^- /,''));return;}
  if(/^- /.test(l))parrafo(l.slice(2),true);else parrafo(l,false);
 });
 if(enSencillo&&bloque.length)cajaSencillo(bloque.join(' '));
 if(lineas.length&&esTitulo(lineas[lineas.length-1])&&!enSencillo)renglones();

 // ── Pie ──
 const n=doc.getNumberOfPages();
 for(let i=1;i<=n;i++){
  doc.setPage(i);
  set(7.5,'normal',GRIS);txt('FISIO365 · Gran de Sant Andreu, 163 · Barcelona · 672 89 39 49 · fisioterapia365.com',ml,H-14);
  if(n>1)txt(`${i} / ${n}`,W-mr,H-14,{align:'right'});
 }

 const nombrePdf='Informe_'+pacNom.replace(/\s+/g,'_')+'_'+fecha.replace(/\//g,'-')+'.pdf';
 if(modo==='ver'){const u=doc.output('bloburl');if(window._pdfWin&&!window._pdfWin.closed){window._pdfWin.location.href=u;window._pdfWin=null;}else window.open(u,'_blank');return {nombre:nombrePdf};}
 if(modo==='base64'){return {nombre:nombrePdf,base64:doc.output('datauristring').split(',')[1]};}
 doc.save(nombrePdf);return {nombre:nombrePdf};
}
function cargarJsPDF(){
 if(window.jspdf&&window.jspdf.jsPDF)return Promise.resolve();
 return new Promise((ok,ko)=>{const s=document.createElement('script');s.src='https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';s.onload=()=>window.jspdf&&window.jspdf.jsPDF?ok():ko(new Error('jsPDF'));s.onerror=()=>ko(new Error('jsPDF'));document.head.appendChild(s);});
}
// Recibí firmado (lo descarga el panel)
function _recibiPDF(o){
 const {jsPDF}=window.jspdf;const doc=new jsPDF({unit:'mm',format:'a4'});const R=window._pdfRec;let F='helvetica';
 if(R){try{doc.addFileToVFS('P-R.ttf',R.reg);doc.addFont('P-R.ttf','Poppins','normal');doc.addFileToVFS('P-B.ttf',R.bold);doc.addFont('P-B.ttf','Poppins','bold');F='Poppins';}catch(e){}}
 const W=210,ml=24,mr=24,tw=W-ml-mr,NAR=[194,85,46],NEG=[26,26,26],TXT=[60,52,47],GRIS=[125,112,104],LIN=[232,225,218];
 const set=(sz,w,c)=>{doc.setFont(F,w);doc.setFontSize(sz);doc.setTextColor(...c);};
 if(R&&R.logo){try{doc.addImage('data:image/png;base64,'+R.logo,'PNG',ml,20,26,4.6);}catch(e){}}else{set(13,'bold',NAR);doc.text('FISIO365',ml,24.5);}
 set(8.5,'normal',GRIS);doc.text('Recibí de entrega de informe',W-mr,24,{align:'right'});doc.setDrawColor(...LIN);doc.setLineWidth(.3);doc.line(ml,31,W-mr,31);
 let y=48;set(18,'bold',NEG);doc.text('Recibí',ml,y);y+=12;
 const fila=(l,v)=>{set(8,'normal',GRIS);doc.text(l,ml,y);set(11,'bold',NEG);const ls=doc.splitTextToSize(String(v||'—'),tw-50);doc.text(ls,ml+50,y);y+=Math.max(9,ls.length*5.5+3);};
 const d=new Date(o.fecha);const fh=isNaN(d)?String(o.fecha||''):d.toLocaleString('es-ES',{timeZone:'Europe/Madrid',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
 fila('Paciente',o.paciente);fila('Documento',(/fisioterap/i.test(o.tipo||'')?'Informe fisioterapéutico':(o.tipo||'Informe'))+(o.fechaInforme?' del '+o.fechaInforme:''));fila('Fisioterapeuta',o.fisio);
 const canal={app:'En la app de FISIO365',whatsapp:'Enlace enviado por WhatsApp',email:'Enlace enviado por email',mano:'En mano, en la clínica',enlace:'Enlace personal'}[(o.datos||{}).canal]||'—';
 fila('Forma de entrega',canal);fila('Identificación',(o.datos||{}).verificado||'—');fila('Firmado el',fh);
 y+=6;doc.setDrawColor(...LIN);doc.line(ml,y,W-mr,y);y+=12;
 set(11,'normal',TXT);const tx=doc.splitTextToSize((o.datos&&o.datos.texto)||'Confirmo que he recibido mi informe fisioterapéutico de FISIO365.',tw);doc.text(tx,ml,y);y+=tx.length*6+10;
 set(8,'normal',GRIS);doc.text('Firma del paciente',ml,y);y+=4;
 if(o.firma){try{const im=new Image();im.src=o.firma;const r=(im.naturalHeight||200)/(im.naturalWidth||600);const w=80;doc.addImage(o.firma,'PNG',ml,y,w,Math.min(45,w*r));y+=Math.min(45,w*r)+4;}catch(e){}}
 doc.setDrawColor(...LIN);doc.line(ml,y,ml+90,y);
 if(o.datos&&(o.datos.ip||o.datos.nav)){y+=14;set(7,'normal',GRIS);doc.text(doc.splitTextToSize('Registro técnico: '+[o.datos.ip?'IP '+o.datos.ip:'',o.datos.nav||''].filter(Boolean).join(' · '),tw),ml,y);}
 set(7.5,'normal',GRIS);doc.text('FISIO365 · Fourth Dynamic, S.L. · Gran de Sant Andreu, 163 · Barcelona · 672 89 39 49',ml,283);
 doc.save('Recibi_'+String(o.paciente||'paciente').replace(/\s+/g,'_')+'.pdf');
}
window.InformePDF={async generar(o){
 await cargarJsPDF();
 window._pdfRec=await cargarRecursosPDF();
 const col=o.colegiado?('Colegiado nº '+o.colegiado):'';
 return _generarPDF(o.paciente||'',o.informe||'',o.zona||'Valoración fisioterapéutica',o.fisio||'',col,o.fecha||new Date().toLocaleDateString('es-ES'),o.modo||'descargar');
},async recibi(o){await cargarJsPDF();window._pdfRec=await cargarRecursosPDF();return _recibiPDF(o);}};
})();
