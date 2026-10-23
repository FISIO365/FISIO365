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
 set(8.5,'normal',GRIS);txt('Informe de valoración · '+fecha,W-mr,24,{align:'right'});
 doc.setDrawColor(...LINEA);doc.setLineWidth(.3);doc.line(ml,31,W-mr,31);

 // ── Datos del paciente ──
 y=42;
 const col=(lab,val,x,extra)=>{set(7.5,'medium',GRIS);txt(lab,x,y);set(11.5,'bold',NEG);txt(doc.splitTextToSize(String(val||'—'),tw/3-6)[0],x,y+6.5);if(extra){set(8,'normal',GRIS);txt(extra,x,y+11.5);}};
 col('Paciente',pacNom,ml);col('Zona valorada',tipoLabel,ml+tw/3);col('Fisioterapeuta',fisioNom||'—',ml+2*tw/3,colNum);
 y+=24;
 doc.setDrawColor(...LINEA);doc.line(ml,y,W-mr,y);
 y+=13;

 // ── Contenido ──
 const lineas=String(informe||'').replace(/\r/g,'').split('\n').map(l=>l.trim()).filter(Boolean);
 const esTitulo=l=>/^[A-ZÁÉÍÓÚÑÜ0-9 ,\/·()-]{5,}$/.test(l)&&!/^- /.test(l);
 let enSencillo=false,bloque=[],primero=true;
 const titulo=t=>{sitio(20);if(!primero)y+=6;primero=false;set(9,'bold',NAR);txt(t.toUpperCase(),ml,y,{charSpace:.4});y+=7;};
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
 lineas.forEach(l=>{
  if(esTitulo(l)){if(enSencillo&&bloque.length){cajaSencillo(bloque.join(' '));bloque=[];}enSencillo=/SENCILL/.test(l);if(!enSencillo)titulo(l);return;}
  if(enSencillo){bloque.push(l.replace(/^- /,''));return;}
  if(/^- /.test(l))parrafo(l.slice(2),true);else parrafo(l,false);
 });
 if(enSencillo&&bloque.length)cajaSencillo(bloque.join(' '));

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
window.InformePDF={async generar(o){
 await cargarJsPDF();
 window._pdfRec=await cargarRecursosPDF();
 const col=o.colegiado?('Colegiado nº '+o.colegiado):'';
 return _generarPDF(o.paciente||'',o.informe||'',o.zona||'Valoración fisioterapéutica',o.fisio||'',col,o.fecha||new Date().toLocaleDateString('es-ES'),o.modo||'descargar');
}};
})();
