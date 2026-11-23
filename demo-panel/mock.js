/* Demo del panel de FISIO365 para Mandarina: datos inventados, no se guarda nada. */
(function(){
try{localStorage.setItem('f365_panel_sesion',JSON.stringify({n:'Laura',p:'demo'}));localStorage.setItem('f365_panel_avisos_no',String(Date.now()));localStorage.setItem('f365_curso_av',new Date().toISOString().slice(0,10));}catch(e){}
try{if(navigator.serviceWorker){navigator.serviceWorker.register=function(){return Promise.reject(new Error('demo'))};}}catch(e){}

var R=function(n){var s=n;return function(){s=(s*9301+49297)%233280;return s/233280}};
var pad=function(n){return String(n).padStart(2,'0')};
var hoy=function(d){var x=new Date();x.setDate(x.getDate()+(d||0));return x.getFullYear()+'-'+pad(x.getMonth()+1)+'-'+pad(x.getDate())};
var ID=function(p,i){return 'rec'+p+String(i).padStart(11,'0')};
var NOM=['Lucía Martín Sanz','Javier Romero Gil','Carmen Navarro Ruiz','Pablo Ortega Díaz','Marta Serrano López','David Molina Castro','Elena Vidal Torres','Sergio Blanco Ramos','Paula Iglesias Mora','Raúl Delgado Vega','Cristina Pascual Rey','Álvaro Herrera Cano','Nuria Fuentes Prieto','Iván Cabrera León','Sara Méndez Rubio','Óscar Campos Soler','Irene Vázquez Peña','Hugo Calvo Lozano','Laia Ferrer Costa','Andrés Moreno Bravo','Claudia Gallego Rius','Tomás Herrero Bosch','Alba Domínguez Pons','Víctor Santos Vila','Noelia Crespo Font','Jordi Marín Roca','Rocío Peña Gimeno','Daniel Arias Mas'];
var MOT=['Dolor lumbar al estar sentado','Cervicalgia y dolor de cabeza','Esguince de tobillo jugando a pádel','Tendinopatía del hombro','Rehabilitación de rodilla tras cirugía','Fascitis plantar','Contractura en trapecios','Epicondilitis','Ciática','Readaptación tras rotura de isquios'];
var EST=[{id:'recEstadoActivo0001',nombre:'Activo'},{id:'recEstadoAlta000001',nombre:'Alta'},{id:'recEstadoPend000001',nombre:'Pendiente de continuar'},{id:'recEstadoUnica00001',nombre:'Sesión única'}].map(function(e){e.id=e.id.slice(0,17);return e});
var FIS=['Laura','Marc','Ana','Pol'];
var PAC=NOM.map(function(n,i){var r=R(i+7);return{id:ID('Pac',i),nombre:n,email:n.split(' ')[0].toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'')+'@ejemplo.com',pin:String(1000+i*37),telefono:'6'+String(10000000+i*3711).slice(0,8),estados:[EST[i%5===0?1:i%7===0?2:0].id],creado:hoy(-60+i)+'T10:00:00.000Z',foto:''}});
var SES=['Fisioterapia convencional','Fisioterapia avanzada','Suelo pélvico','Readaptación deportiva'];
var HORAS=['09:00','10:00','11:00','12:00','13:00','16:00','17:00','18:00','19:00'];
function dia(f){var seed=0;for(var i=0;i<f.length;i++)seed=(seed*31+f.charCodeAt(i))%100000;var r=R(seed),c=[],k=0,pas=f<hoy(0);
 FIS.forEach(function(fi){HORAS.forEach(function(h){k++;if(r()<0.18){c.push({id:'c'+f+k,fecha:f,hora:h,estado:'CITA LIBRE',fisio:fi,pacienteId:'',paciente:'',tipos:[],sesion:'',notas:''});return}
  var p=PAC[Math.floor(r()*PAC.length)];c.push({id:'c'+f+k,fecha:f,hora:h,estado:pas?'REALIZADA':'PENDIENTE',fisio:fi,pacienteId:p.id,paciente:p.nombre,tipos:[],sesion:SES[Math.floor(r()*4)],notas:'',confirmada:r()<.65,app:r()<.2,web:r()<.1})})});return c}
function ficha(id){var i=PAC.findIndex(function(p){return p.id===id});if(i<0)i=0;var p=PAC[i],r=R(i+3),cit=[];
 for(var d=-49;d<=14;d+=7){var f=hoy(d+(i%5));cit.push({id:'cf'+i+d,fecha:f,hora:HORAS[i%9],estado:f<hoy(0)?'REALIZADA':'PENDIENTE',fisio:FIS[i%4],nota:''})}
 cit.reverse();
 return{ok:true,hoy:hoy(0),saldo:{activo:true,restantes:3,total:10,tipo:'Pack 10 · Fisioterapia avanzada'},consent:{estado:'ok',rojo:[],salud:[],docs:[{id:'d1',tipo:'primera',fecha:hoy(-40),firmante:''}],porConfirmar:[],marketing:{conocido:'Google'}},referidos:null,premios:[],aMedias:[],pendPago:[],carpetas:null,
 paciente:{id:p.id,pin:p.pin,nombre:p.nombre,tel:p.telefono,telf:p.telefono,whatsapp:p.telefono,email:p.email,dni:'',cumple:'',foto:'',ultimoAcceso:hoy(-1)+'T19:20:00.000Z',appUsada:true,appInstalada:true,alta:p.creado,estados:p.estados,motivo:MOT[i%MOT.length],
 historial:hoy(-14).split('-').reverse().join('/')+' · '+FIS[i%4]+': Valoración inicial. Dolor 6/10. Plan: terapia manual + ejercicio.\n'+hoy(-7).split('-').reverse().join('/')+' · '+FIS[i%4]+': Mejor que la semana pasada. Dolor 3/10. Subimos carga en los ejercicios.',historialMod:hoy(-7),notas:'',porQue:'',porQueHist:[],bonoPrevio:0,colab:'',resena:i%3===0,archivos:[]},
 citas:cit,seguimiento:[],llamadas:[]}}
var EJ=[['Puente de glúteo','Cadera y glúteo'],['Gato-camello','Lumbar'],['Plancha frontal','Core'],['Retracción cervical','Cervical'],['Estiramiento de trapecio','Cervical'],['Rotación externa con goma','Hombro'],['Sentadilla a la silla','Rodilla'],['Extensión de rodilla sentado','Rodilla'],['Equilibrio a una pierna','Equilibrio'],['Elevación de talones','Tobillo y pie'],['Rodar la planta con pelota','Tobillo y pie'],['Bird-dog','Core'],['Puente lateral','Core'],['Zancada hacia atrás','Rodilla'],['Péndulo de Codman','Hombro']].map(function(e,i){return{id:ID('Eje',i),nombre:e[0],name:e[0],zona:e[1],categoria:e[1],series:3,reps:12,descripcion:'Hazlo despacio y sin dolor.',video:''}});
var CONV=PAC.slice(0,6).map(function(p,i){return{pacienteId:p.id,pacienteNombre:p.nombre,de:'paciente',sinLeer:i<2?1:0,ultimo:TSH(i*5),texto:['¡Gracias! Así lo hago','¿Puedo hacer los ejercicios si me duele un poco?','Perfecto, nos vemos el jueves','Te mando la foto de la postura','Hoy he hecho la racha completa 💪','¿Cambiamos la cita al viernes?'][i]}});
function TSH(h){var d=new Date();var hh=[10,12,13,16,17,18,19][Math.round(h)%7],mm=(h*17)%60|0;var dd=Math.floor(h/24);if(h<24&&hh>d.getHours()){hh=Math.max(9,d.getHours()-1-Math.round(h)%2)}d.setDate(d.getDate()-dd);d.setHours(hh,mm,0,0);return d.toISOString()}
function data(u,m,body){
 var b={};try{b=typeof body==='string'?JSON.parse(body):{}}catch(e){}
 var a=(u.match(/action=([a-z0-9\-]+)/)||[])[1]||'',p=(u.match(/\/api\/([a-z\-]+)/)||[])[1];
 if(p==='fisios'&&m==='POST')return{ok:true,fisio:{id:'recFisioLaura00001'.slice(0,17),nombre:'Laura',role:'direccion',direccion:true,accesos:{agenda:true,pacientes:true,chat:true,ejercicios:true,estadisticas:true,checklist:true,rendimiento:true,school:true,callin:true,captacion:true,admin:true,facturacion:true,comunicaciones:true}},apiToken:'demo'};
 if(p==='fisios')return{ok:true,fisios:FIS.map(function(n,i){return{id:ID('Fis',i),nombre:n,role:'fisio',colegiado:String(12345+i)}})};
 if(p==='schedule'&&a==='clinica-pub')return null;
 if(p==='schedule'&&a==='alta-estado')return{ok:true,vacia:false};
 if(p==='pacientes'&&!a)return{ok:true,pacientes:PAC};
 if(p==='pacientes'&&a==='buscar')return{ok:true,pacientes:[]};
 if(p==='ejercicios')return{ok:true,ejercicios:EJ};
 if(a==='estados')return{ok:true,estados:EST};
 if(a==='seg-agenda-dia'){var f=(u.match(/fecha=([0-9\-]+)/)||[])[1];if(f)return{ok:true,hoy:hoy(0),citas:dia(f),revisar:[],espera:[],ausencias:[],alertas:{},cumples:{},debenPagar:{},sinConsent:[],conConsent:[],precioEsp:{},salud:{}};
  var d0=(u.match(/desde=([0-9\-]+)/)||[])[1]||hoy(0),d1=(u.match(/hasta=([0-9\-]+)/)||[])[1]||d0,L=[],x=new Date(d0+'T12:00:00');for(var n=0;n<40;n++){var ff=x.toISOString().slice(0,10);if(ff>d1)break;L=L.concat(dia(ff));x.setDate(x.getDate()+1)}return{ok:true,hoy:hoy(0),citas:L,revisar:[],espera:[]}}
 if(a==='seg-ficha'){var id=(u.match(/[?&]id=([A-Za-z0-9]+)/)||[])[1];return ficha(id)}

 // ---------- dirección ----------
 if(a==='rendimiento'){var d0=(u.match(/desde=([0-9\-]+)/)||[])[1],d1=(u.match(/hasta=([0-9\-]+)/)||[])[1];var nd=Math.max(1,Math.round((new Date(d1)-new Date(d0))/864e5)+1);
  return{ok:true,conPack:true,fisios:FIS.map(function(fi,j){var r=R(j+nd),h=Math.round(nd*6.2*(5/7)),re=Math.round(h*(.78+r()*.17));
   return{fisio:fi,realizadas:re,huecos:h,atendidos:Math.round(re*.62),reagendan:Math.round(re*.62*(.8+r()*.12)),noAsistio:Math.round(r()*3),perdidas:0,canceladas:Math.round(1+r()*4),callin:0,videos:0,
   lista:PAC.slice(j*3,j*3+2+Math.round(r()*2)).map(function(p,k){return{id:p.id,nombre:p.nombre,ultima:hoy(-3-k*4),tel:p.telefono,nota:k===0?'Se va de viaje, vuelve en diciembre':'',notaFecha:k===0?hoy(-1):'',notaFisio:k===0?fi:''}})}})}}
 if(a==='horas')return{ok:true,registros:[],banco:0};
 if(a==='seg-estadisticas'){var L=[],x=new Date();x.setDate(x.getDate()-((x.getDay()+6)%7));for(var w=11;w>=0;w--){var y=new Date(x);y.setDate(y.getDate()-7*w);var r=R(w+5),ses=Math.round(118+r()*40),cap=150;
   var pf={},pfs={},dd={};FIS.forEach(function(fi,j){var o=Math.round(ses/4+(r()-.5)*8);pf[fi.toLowerCase()]={cap:cap/4,ocup:o,extra:0};var v=1+Math.round(r()*3),rg=Math.max(0,v-Math.round(r()*1.4));pfs[fi]={vinieron:v,reagendaron:rg,pac:[]}});for(var k=0;k<5;k++){var q=new Date(y);q.setDate(q.getDate()+k);dd[q.toISOString().slice(0,10)]=Math.round(ses/5+(r()-.5)*6)}
   var vt=0,rt=0;FIS.forEach(function(fi){vt+=pfs[fi].vinieron;rt+=pfs[fi].reagendaron});L.push({semana:y.toISOString().slice(0,10),sesiones:ses,dias:dd,atendidos:Math.round(ses*.6),conBono:Math.round(ses*.35),noVino:Math.round(r()*4),canceladas:Math.round(3+r()*6),nuevos:Math.round(8+r()*9),vinieron:vt,reagendaron:rt,porFisio:pfs,prod:pf,ocupadas:ses,capacidad:cap,ocupacion:Math.round(ses*100/cap),recuperadas:Math.round(r()*4),resenasPedidas:Math.round(4+r()*6),ingresos:Math.round(ses*66+r()*600),ingresosHolded:true,resenas:Math.round(r()*5),quejas:0,notas:''})}
   return{ok:true,hoy:hoy(0),semanas:L,nombres:{},ingDias:{},incompleto:false}}
 if(a==='plan-dia')return{ok:true,hoy:hoy(0),persona:'Laura',dir:true,equipo:FIS,
   pendientes:[{id:'t1',t:'Llamar a los 3 pacientes que no han reagendado',dia:hoy(0),hecha:false,por:'Laura',dir:true,nota:''},{id:'t2',t:'Pedir material a Fisaude (gomas y cremas)',dia:hoy(0),hecha:false,por:'Laura',dir:false,nota:''},{id:'t3',t:'Revisar la agenda de la semana que viene',dia:hoy(-1),hecha:false,por:'Laura',dir:false,nota:''}],
   hechas:[{id:'t4',t:'Enviar huecos libres por WhatsApp',dia:hoy(0),hecha:true,hechaEn:new Date().toISOString(),por:'Laura',dir:false,nota:''}],
   proximas:[{id:'t5',t:'Reunión de equipo',dia:hoy(2),hecha:false,por:'Laura',dir:true,nota:''}]};
 if(a==='seg-com-buzon'||a==='seg-com-hilo'){var ts=TSH;
   var H=[
   {id:'h1',num:'C-014',tipo:'Informe',modo:'leer',req:false,asunto:'Horario de Navidad',de:'Laura',para:['Marc','Ana','Pol'],ultima:ts(20),fecha:ts(20),extracto:'Del 24 al 31 abrimos de 9 a 14 h. El resto, horario normal.',leido:{Marc:true,Ana:true},hecho:{Marc:true,Ana:true},recibido:{},abierta:true,pendienteMio:false,noLeido:false,nResp:0,ultimoDe:'',limite:'',datos:{},
    msgs:[{de:'Laura',fecha:ts(20),cuerpo:'Hola equipo,\n\nDel 24 al 31 de diciembre abrimos de 9 a 14 h. El resto de días, horario normal.\n\nConfirmad que lo habéis leído, porfa.',adjuntos:[]}]},
   {id:'h2',num:'C-015',tipo:'Ausencia',asunto:'Día libre · viernes 12 de diciembre',de:'Marc',para:['Laura'],ultima:ts(5),fecha:ts(5),extracto:'¿Puedo coger libre el viernes 12? Tengo un torneo con el club.',leido:{},hecho:{},recibido:{},abierta:true,puedeAprobar:true,resolucion:'',pendienteMio:true,noLeido:true,nResp:0,ultimoDe:'',limite:'',ausencia:{que:'Día libre',desde:'',hasta:''},datos:{},
    msgs:[{de:'Marc',fecha:ts(5),cuerpo:'¿Puedo coger libre el viernes 12? Tengo un torneo con el club. Ya he hablado con Pol por si alguien necesita cita ese día.',adjuntos:[]}]},
   {id:'h3',num:'C-013',tipo:'Tareas',modo:'hacer',req:true,asunto:'Antes de cerrar el mes',de:'Laura',para:['Ana','Pol'],ultima:ts(50),fecha:ts(50),extracto:'Facturas al día y consentimientos firmados.',leido:{Ana:true,Pol:true},hecho:{Ana:true},recibido:{Ana:true,Pol:true},abierta:true,pendienteMio:false,noLeido:false,nResp:1,ultimoDe:'Ana',limite:hoy(3),
    datos:{items:[{t:'Facturas del mes al día',por:'Ana'},{t:'Consentimientos firmados',por:'Ana'},{t:'Revisar packs a medias',por:''}]},
    msgs:[{de:'Laura',fecha:ts(50),cuerpo:'Antes del día 30: facturas al día, consentimientos firmados y repasar los packs a medias.',adjuntos:[]},{de:'Ana',fecha:ts(30),cuerpo:'Facturas y consentimientos hechos ✓',adjuntos:[]}]},
   {id:'h4',num:'C-012',tipo:'Informe',modo:'responder',req:true,asunto:'¿Qué día os va mejor para la formación?',de:'Pol',para:['Laura','Marc','Ana'],ultima:ts(28),fecha:ts(28),extracto:'Martes o jueves por la tarde. Decidme antes del viernes.',leido:{Laura:true,Marc:true},hecho:{Marc:true},recibido:{},abierta:true,pendienteMio:true,noLeido:false,nResp:1,ultimoDe:'Marc',limite:hoy(2),datos:{},
    msgs:[{de:'Pol',fecha:ts(28),cuerpo:'Para la formación de vendaje: ¿martes o jueves por la tarde? Decidme antes del viernes.',adjuntos:[]},{de:'Marc',fecha:ts(26),cuerpo:'Jueves mejor 👍',adjuntos:[]}]}];
   if(a==='seg-com-hilo'){var h=H.filter(function(x){return x.id===b.id})[0]||H[0];return{ok:true,yo:'Laura',hilo:h}}
   return{ok:true,yo:'Laura',equipo:FIS,pruebasSchool:0,hilos:H}}
 if(a==='compra-lista')return{ok:true,pendientes:[{id:'k1',producto:'Gomas elásticas (media)',cantidad:'4',por:'Ana',fecha:hoy(-1),nota:'',enlace:'',comprado:false},{id:'k2',producto:'Crema de masaje 1 L',cantidad:'2',por:'Pol',fecha:hoy(0),nota:'',enlace:'',comprado:false}],comprados:[]};
 if(a==='reporte-dia'){var f=b.fecha||hoy(-1);
   var rend=FIS.map(function(fi,k){var at=[6,5,7,4][k];return{fisio:fi,realizadas:[7,6,8,5][k],huecos:8,atendidos:at,reagendan:at-[1,0,2,1][k],noAsistio:k==2?1:0,perdidas:0,lista:[]}});
   return{ok:true,reporte:{fecha:f,hechas:26,nFacturas:19,total:1384,caja:{'Tarjeta':812,'Bizum':340,'Efectivo':232},
   fisios:FIS.map(function(fi,k){return{fisio:fi,hechas:[7,6,8,5][k],enviado:k<3?'20:'+(12+k*9):'',noMarcados:k==1?['Ejercicios de Pablo Ortega']:[],pendiente:k==2?[{t:'Ejercicios en la app',k:'ejercicios',items:[{id:PAC[3].id,nombre:PAC[3].nombre}]}]:[],nota:k==0?'Faltan gomas elásticas medianas':''}}),
   sinFacturar:[{id:PAC[6].id,nombre:PAC[6].nombre,fisio:'Pol',n:1}],fuera:[],borradores:[],
   sinMarcar:[{id:'cx1',pacienteId:PAC[8].id,nombre:PAC[8].nombre,fisio:'Pol',hora:'19:00'}],
   canceladas:[{pacienteId:PAC[9].id,nombre:PAC[9].nombre,fisio:'Ana',estado:'CANCELADA',hora:'11:00',proxima:hoy(2)},{pacienteId:PAC[11].id,nombre:PAC[11].nombre,fisio:'Marc',estado:'NO ASISTIÓ',hora:'17:30',proxima:'',enLlamar:false,alta:''}],
   atrasado:[{fisio:'Marc',tareas:1,llamadas:1,maxDias:2,items:[{tipo:'tarea',texto:'Llamar a la mutua de Elena',dias:2},{tipo:'llamada',paciente:PAC[12].nombre,pacienteId:PAC[12].id,dias:1}]}],
   sinEjercicios:[],rendDia:rend,rendSemana:rend.map(function(x){return Object.assign({},x,{realizadas:x.realizadas*4,huecos:36,atendidos:x.atendidos*4,reagendan:x.reagendan*4})}),
   facturas:PAC.slice(0,6).map(function(p,k){return{num:'T-2026-0'+(812+k),concepto:'Sesión de fisioterapia · '+p.nombre,pago:['Tarjeta','Bizum','Efectivo'][k%3],total:[60,60,55,275,60,60][k]}})}}}
 if(a==='cambios-lista'){var ts2=TSH;
   var c=function(p,f,h,e,fi){return{pacienteId:p.id,paciente:p.nombre,fecha:f,hora:h,estado:e,fisio:fi}};
   return{ok:true,sinCopia:[],cambios:[
   {n:1,t:ts2(1),esCita:true,accion:'editar',campos:['HORA'],antes:c(PAC[2],hoy(1),'10:00','PENDIENTE','Marc'),despues:c(PAC[2],hoy(1),'12:00','PENDIENTE','Marc')},
   {n:2,t:ts2(3),esCita:true,accion:'editar',campos:['ESTADO'],antes:c(PAC[5],hoy(0),'11:00','PENDIENTE','Ana'),despues:c(PAC[5],hoy(0),'11:00','CANCELADA','Ana')},
   {n:3,t:ts2(4),esCita:true,accion:'crear',campos:[],antes:null,despues:c(PAC[7],hoy(2),'18:30','PENDIENTE','Pol')},
   {n:4,t:ts2(7),esCita:true,accion:'editar',campos:['FISIO'],antes:c(PAC[10],hoy(3),'09:00','PENDIENTE','Laura'),despues:c(PAC[10],hoy(3),'09:00','PENDIENTE','Pol')},
   {n:5,t:ts2(9),esCita:true,accion:'editar',campos:['ESTADO'],antes:c(PAC[13],hoy(0),'17:00','PENDIENTE','Laura'),despues:c(PAC[13],hoy(0),'17:00','REALIZADA','Laura')}]}}
 if(a==='fac-inicio')return{ok:true,modo:'propio',config:{actividades:[{id:'principal',nombre:'Fisioterapia'}],iva:21},
   series:[{id:'F',nombre:'Facturas',tipo:'completa',prefijo:'F-2026-'},{id:'T',nombre:'Tickets',tipo:'simplificada',prefijo:'T-2026-'},{id:'R',nombre:'Rectificativas',tipo:'rectificativa',prefijo:'R-2026-'}],
   tipos:[],conceptos:[{id:'c1',nombre:'Sesión de fisioterapia',precio:60,iva:0},{id:'c2',nombre:'Pack 5 sesiones',precio:275,iva:0},{id:'c3',nombre:'Suelo pélvico',precio:65,iva:0}],disenos:[],exenciones:[{id:'E1',nombre:'Exenta (art. 20 LIVA, sanitaria)'}],ivas:[0,4,10,21]};
 if(a==='fac-holded-auto')return{ok:true};
 if(a==='fac-lista'){var tk=/clase=tickets/.test(u),L=[];for(var k=0;k<(tk?22:7);k++){var p=PAC[(k*5)%PAC.length],t=tk?[60,60,55,275,65,60][k%6]:[275,60,520,60,130,275,60][k];L.push({id:'fx'+k,codigo:(tk?'T-2026-0':'F-2026-0')+(tk?812-k:143-k),fecha:hoy(-Math.floor(k*(tk?1:3))),tipo:tk?'simplificada':'completa',estado:'emitida',cliente:{nombre:p.nombre,nif:tk?'':'4'+String(7712345+k*911)+'K'},base:t,cuota:0,total:t,pagos:{estado:k==3&&!tk?'pendiente':'pagada'}})}return{ok:true,facturas:L}}
 if(a==='fac-gas-lista'){var G=[['Fisaude','Material','Gomas, cremas y vendaje',184.3],['Alquiler local','Alquiler','Noviembre',1250],['Endesa','Suministros','Luz octubre',96.4],['Movistar','Suministros','Fibra y móvil',62.9],['Gestoría','Servicios profesionales','Cuota mensual',145.2],['Seguro RC','Seguros','Póliza anual',38.5]];
   return{ok:true,categorias:['Material','Alquiler','Suministros','Servicios profesionales','Seguros'],cuentas:[{id:'b1',nombre:'Cuenta principal'}],esperados:[],gastos:G.map(function(g,k){var base=Math.round(g[3]/1.21*100)/100;return{id:'g'+k,fecha:hoy(-k*4),categoria:g[1],proveedor:{nombre:g[0],nif:''},concepto:g[2],numero:'',cuenta:'b1',base:base,cuota:Math.round((g[3]-base)*100)/100,total:g[3],pago:{estado:'pagado'}}})}}
 if(a==='seg-adm-equipo'){var H={L:8,M:8,X:8,J:8,V:6};var acc={agenda:true,pacientes:true,chat:true,ejercicios:true,estadisticas:false,checklist:true,rendimiento:false,school:true,callin:true,captacion:false,admin:false,facturacion:false,comunicaciones:true};
   return{ok:true,equipo:FIS.map(function(n,i){return{id:ID('Fis',i),nombre:n,role:'fisio',direccion:i==0,colegiado:String(12345+i),email:n.toLowerCase()+'@clinica-demo.es',horas:H,baja:'',foto:'',contrato:null,accesos:i==0?Object.fromEntries(Object.keys(acc).map(function(k){return[k,true]})):Object.assign({},acc,{captacion:i==3})}}),ausencias:[{id:'au1',fisio:'Marc',que:'Vacaciones',desde:hoy(18),hasta:hoy(25),estado:'Aprobada'}],dias:[],accesos:{}}}
 if(a==='seg-ingresos-rango'||a==='seg-nuevos-rango'){var d0=(u.match(/desde=([0-9\-]+)/)||[])[1],d1=(u.match(/hasta=([0-9\-]+)/)||[])[1];var nd=Math.max(1,Math.round((new Date(d1)-new Date(d0))/864e5)+1),wd=Math.max(1,Math.round(nd*5/7));
   if(a==='seg-ingresos-rango')return{ok:true,total:Math.round(wd*(1720+((nd*37)%260)))};
   var vi=Math.max(1,Math.round(wd*2.1)),rg=Math.round(vi*.78);return{ok:true,nuevos:Math.round(wd*2.4),vinieron:vi,reagendaron:rg,conversion:Math.round(rg*100/vi)}}
 if(a==='seg-eq-sinleer')return{ok:true,items:[]};
 if(a==='seg-eq-ficha')return{ok:true,clubs:[],partes:[],enUso:[]};
 if(a==='seg-cap')return{ok:true,hoy:hoy(0),contactos:PAC.slice(10,15).map(function(p,i){return{id:'cc'+i,fecha:hoy(-i),nombre:p.nombre,medio:['WhatsApp','Teléfono','Web','Instagram','En persona'][i],mensaje:['Pregunta por suelo pélvico','Dolor de espalda, quiere cita','Precio de un pack de 5','Lesión de rodilla jugando a fútbol','Info para su madre'][i],citado:i%2?'Sí':'No',motivo:'',motivoTipo:'',tel:p.telefono,por:FIS[i%4],archivado:false,llamar:i%2?'':hoy(1),llamarQuien:'Laura',llamarNota:''}}),espera:[],negocios:[],libres:[],clubs:[]};
 if(a==='seg-lista')return{ok:true,hoy:hoy(0),pendientes:PAC.slice(4,9).map(function(p,i){return{id:'s'+i,pacienteId:p.id,nombre:p.nombre,tel:p.telefono,fecha:hoy(i-1),nota:['Ver cómo sigue de la rodilla','No ha reagendado tras 3 sesiones','Preguntar por la cervical','Pack a medias','Alta reciente: revisión'][i],responsable:FIS[i%4],ult:null,hist:[]}}),hechas:[]};
 if(a==='seg-ultimas')return{ok:true,ultimas:[]};
 if(a==='seg-agenda-enc-nuevas')return{ok:true,lista:[]};
 if(a==='seg-agenda-val-fisios')return{ok:true,mes:hoy(0).slice(0,7),resenas:12,fisios:FIS.map(function(f,i){return{fisio:f,enc:4-i,mej:i%2,resena:3-i%3,media:9.6-i*.2}})};
 if(a==='seg-agenda-sorteo')return{ok:true,mes:hoy(0).slice(0,7),participantes:[],ganadores:[]};
 if(a==='seg-agenda-talleres')return{ok:true,hoy:hoy(0),talleres:[],atlas:[],interes:[]};
 if(a==='seg-tareas')return{ok:true,hoy:hoy(0),tareas:[]};
 if(a==='seg-agenda-num')return{ok:true,num:{},pago:{}};
 if(p==='chat'&&a==='conversaciones')return{ok:true,conversaciones:CONV};
 return {ok:true};
}
var f0=window.fetch.bind(window);window.__apilog=[];
window.fetch=function(u,o){var url=String(u&&u.url||u);if(url.indexOf('/api/')<0)return f0(u,o);
 var m=(o&&o.method)||'GET',d=data(url,m.toUpperCase(),o&&o.body);window.__apilog.push(m+' '+url.replace(location.origin,''));
 if(m.toUpperCase()!=='GET'&&!/\/api\/fisios/.test(url)&&!/seg-agenda-dia/.test(url))try{window.__demoAviso&&window.__demoAviso()}catch(e){}
 return new Promise(function(res){setTimeout(function(){res(d===null?new Response('',{status:404}):new Response(JSON.stringify(d),{status:200,headers:{'Content-Type':'application/json'}}))},120)})};
var __tap=0;addEventListener('pointerdown',function(){__tap=Date.now()},true);window.__demoAviso=function(){if(Date.now()-__tap>1500)return;var t=document.getElementById('demoToast');if(!t){t=document.createElement('div');t.id='demoToast';t.style.cssText='position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:99999;background:#16120F;color:#fff;font:600 14px/1.3 Poppins,system-ui,sans-serif;padding:12px 18px;border-radius:999px;box-shadow:0 10px 30px rgba(0,0,0,.25);transition:opacity .3s';document.body.appendChild(t)}t.textContent='Es una demo: no se guarda nada';t.style.opacity=1;clearTimeout(t._h);t._h=setTimeout(function(){t.style.opacity=0},2200)};
})();
