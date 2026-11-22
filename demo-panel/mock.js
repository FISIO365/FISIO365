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
var CONV=PAC.slice(0,6).map(function(p,i){return{pacienteId:p.id,pacienteNombre:p.nombre,de:'paciente',sinLeer:i<2?1:0,ultimo:new Date(Date.now()-i*3600e3*5).toISOString(),texto:['¡Gracias! Así lo hago','¿Puedo hacer los ejercicios si me duele un poco?','Perfecto, nos vemos el jueves','Te mando la foto de la postura','Hoy he hecho la racha completa 💪','¿Cambiamos la cita al viernes?'][i]}});
function data(u,m,body){
 var a=(u.match(/action=([a-z0-9\-]+)/)||[])[1]||'',p=(u.match(/\/api\/([a-z\-]+)/)||[])[1];
 if(p==='fisios'&&m==='POST')return{ok:true,fisio:{id:'recFisioLaura00001'.slice(0,17),nombre:'Laura',role:'fisio',direccion:false,accesos:{agenda:true,pacientes:true,chat:true,ejercicios:true,estadisticas:true,checklist:true,rendimiento:false,school:false,callin:false,captacion:false,admin:false}},apiToken:'demo'};
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
 if(p==='chat'&&a==='conversaciones')return{ok:true,conversaciones:CONV};
 return {ok:true};
}
var f0=window.fetch.bind(window);
window.fetch=function(u,o){var url=String(u&&u.url||u);if(url.indexOf('/api/')<0)return f0(u,o);
 var m=(o&&o.method)||'GET',d=data(url,m.toUpperCase(),o&&o.body);
 if(m.toUpperCase()!=='GET'&&!/\/api\/fisios/.test(url)&&!/seg-agenda-dia/.test(url))try{window.__demoAviso&&window.__demoAviso()}catch(e){}
 return new Promise(function(res){setTimeout(function(){res(d===null?new Response('',{status:404}):new Response(JSON.stringify(d),{status:200,headers:{'Content-Type':'application/json'}}))},120)})};
window.__demoAviso=function(){if(performance.now()<5000)return;var t=document.getElementById('demoToast');if(!t){t=document.createElement('div');t.id='demoToast';t.style.cssText='position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:99999;background:#16120F;color:#fff;font:600 14px/1.3 Poppins,system-ui,sans-serif;padding:12px 18px;border-radius:999px;box-shadow:0 10px 30px rgba(0,0,0,.25);transition:opacity .3s';document.body.appendChild(t)}t.textContent='Es una demo: no se guarda nada';t.style.opacity=1;clearTimeout(t._h);t._h=setTimeout(function(){t.style.opacity=0},2200)};
})();
