/* Demo de Rumbo para Mandarina: base de datos inventada en memoria. No se conecta a nada ni guarda nada. */
(function(){
var hoyD=new Date();
function iso(d){return d.toISOString();}
function dia(n){var d=new Date();d.setDate(d.getDate()+n);return d.toISOString().slice(0,10);}
var EQ='eq1';
var P=[['m1','Laura','Dirección',true,'todos'],['m2','Marc','Ventas',false,'directa'],['m3','Ana','Atención al cliente',false,'directa'],['m4','Pol','Administración',false,'directa'],['m5','Clara','Marketing',false,'directa'],['m6','Hugo','Ventas',false,'directa']];
var DB={
 pb_equipos:[{id:EQ,nombre:'Estudio Norte',foto:null}],
 pb_miembros:P.map(function(p,i){return{id:p[0],user_id:'u'+(i+1),equipo_id:EQ,nombre:p[1],puesto:p[2],admin:p[3],ve:p[4],activo:true,email:p[1].toLowerCase()+'@ejemplo.com',foto:null,grupo:i<1?null:(i<2||i==5?'Ventas':'Oficina')}}),
 pb_permisos:[['m1','m2'],['m1','m3'],['m1','m4'],['m1','m5'],['m2','m6']].map(function(x,i){return{id:'p'+i,equipo_id:EQ,quien:x[0],a_quien:x[1]}}),
 pb_ve_extra:[],pb_tareas:[],pb_estadisticas:[],pb_apuntes:[],pb_condiciones:[],pb_partes:[],pb_productos:[],pb_push:[]
};
var T=[['m1',0,'Revisar las cifras de la semana con el equipo','09:30'],['m1',0,'Llamar a los 3 clientes con presupuesto pendiente',null],['m1',0,'Preparar la reunión del jueves',null],['m1',1,'Cerrar el plan de marketing de diciembre',null],['m1',-1,'Enviar la propuesta a Estudio Arce',null],
 ['m2',0,'Seguimiento de 8 presupuestos',null],['m2',0,'Visita a cliente nuevo','12:00'],['m3',0,'Responder todos los correos antes de las 11',null],['m3',0,'Encuesta de satisfacción a los clientes de la semana',null],['m4',0,'Facturas del mes al día',null],['m5',0,'Publicar 2 posts y 1 reel',null],['m6',0,'10 llamadas a contactos nuevos',null]];
T.forEach(function(t,i){DB.pb_tareas.push({id:'t'+i,equipo_id:EQ,persona:t[0],dia:dia(t[1]),texto:t[2],hecha:false,hecha_en:null,por:'m1',nota:null,hora:t[3],aviso:t[3]?10:null,creado:iso(new Date(Date.now()-864e5*(3-i%3)))});});
[['m1','Contestar a la gestoría'],['m1','Revisar la web nueva'],['m2','Llamar a Grupo Sol'],['m3','Pedir 3 reseñas en Google']].forEach(function(t,i){DB.pb_tareas.push({id:'th'+i,equipo_id:EQ,persona:t[0],dia:dia(0),texto:t[1],hecha:true,hecha_en:iso(new Date(Date.now()-36e5*(2+i))),por:t[0],nota:null,hora:null,aviso:null,creado:iso(new Date(Date.now()-864e5))});});
var ES=[['m1','Facturación','€',1,true,4200,600],['m1','Clientes nuevos','clientes',1,false,9,3],['m2','Presupuestos cerrados','presupuestos',1,true,7,3],['m3','Clientes contentos','encuestas',1,true,22,5],['m4','Facturas cobradas a tiempo','%',1,true,82,8],['m5','Contactos desde redes','contactos',1,true,30,8],['m6','Llamadas hechas','llamadas',1,true,60,15]];
var seed=7;function r(){seed=(seed*9301+49297)%233280;return seed/233280;}
ES.forEach(function(e,i){var id='e'+i;DB.pb_estadisticas.push({id:id,equipo_id:EQ,persona:e[0],nombre:e[1],eje_y:e[2],sentido:e[3]>0?'sube':'baja',periodo:'semana',principal:e[4],archivada:false,por:'m1',creado:iso(new Date(Date.now()-864e5*120))});
 for(var w=12;w>=0;w--){for(var d=0;d<5;d++){var t=new Date(Date.now()-(w*7+d)*864e5);t.setHours(12,0,0,0);if(t>hoyD)continue;var base=e[5]*(0.7+0.3*(12-w)/12)/5;var v=Math.max(0,Math.round(base+(r()-0.45)*e[6]/2));if(e[2]==='%')v=Math.min(100,Math.round(e[5]*(0.85+0.15*(12-w)/12)+(r()-0.5)*e[6]));DB.pb_apuntes.push({id:'a'+i+'_'+w+'_'+d,estadistica_id:id,en:iso(t),cantidad:e[2]==='%'?(d==0?v:0):v,por:e[0]});}}});
// el % solo un apunte por semana
DB.pb_apuntes=DB.pb_apuntes.filter(function(a){var e=DB.pb_estadisticas.filter(function(x){return x.id===a.estadistica_id})[0];return !(e.eje_y==='%'&&a.cantidad===0)});
[['m2','m1'],['m3','m1'],['m6','m2']].forEach(function(x,i){DB.pb_partes.push({id:'pt'+i,equipo_id:EQ,persona:x[0],dia:dia(-1),para:[x[1]],leida:[],creado:iso(new Date(Date.now()-36e5*14)),hecho:'Todo lo previsto hecho.',manana:'Seguimiento de presupuestos y llamadas.',no_hecho:''});});
var uid=0;function nid(){return 'n'+(++uid)+Date.now().toString(36);}
function match(row,f){var v=row[f.c];switch(f.op){case'eq':return v===f.v||String(v)===String(f.v);case'neq':return v!==f.v;case'in':return f.v.indexOf(v)>=0;case'gte':return v!=null&&v>=f.v;case'gt':return v!=null&&v>f.v;case'lte':return v!=null&&v<=f.v;case'lt':return v!=null&&v<f.v;case'is':return v==f.v;case'cs':return Array.isArray(v)&&f.v.every(function(x){return v.indexOf(x)>=0});case'not':return !match(row,f.inner);case'or':return f.list.some(function(g){return match(row,g)});}return true;}
function parseOr(s){return s.split(',').map(function(p){var m=p.match(/^([a-z_]+)\.([a-z]+)\.(.*)$/);if(!m)return{c:'x',op:'eq',v:null};var v=m[3];if(m[2]==='cs')v=v.replace(/[{}]/g,'').split(',').filter(Boolean);return{c:m[1],op:m[2],v:v};});}
function Q(t){this.t=t;this.f=[];this.o=[];this.act='select';this.lim=null;this.one=null;this.opts={};}
var q=Q.prototype;
q.select=function(c,o){if(this.act==='select'){this.opts=o||{};}this.ret=true;return this;};
['eq','neq','gte','gt','lte','lt','is'].forEach(function(k){q[k]=function(c,v){this.f.push({c:c,op:k,v:v});return this;};});
q.in=function(c,v){this.f.push({c:c,op:'in',v:v});return this;};
q.contains=function(c,v){this.f.push({c:c,op:'cs',v:v});return this;};
q.not=function(c,op,v){var val=v;if(op==='cs')val=String(v).replace(/[{}]/g,'').split(',').filter(Boolean);this.f.push({op:'not',inner:{c:c,op:op,v:val}});return this;};
q.or=function(s){this.f.push({op:'or',list:parseOr(s)});return this;};
q.order=function(c,o){this.o.push([c,!(o&&o.ascending===false)]);return this;};
q.limit=function(n){this.lim=n;return this;};q.range=function(a,b){this.lim=b-a+1;return this;};
q.single=function(){this.one='s';return this;};q.maybeSingle=function(){this.one='m';return this;};
q.insert=function(rows){this.act='insert';this.rows=[].concat(rows);return this;};
q.upsert=function(rows,o){this.act='upsert';this.rows=[].concat(rows);this.oc=(o&&o.onConflict||'id').split(',');return this;};
q.update=function(v){this.act='update';this.val=v;return this;};
q.delete=function(){this.act='delete';return this;};
q.then=function(res,rej){return Promise.resolve(this.run()).then(res,rej);};
q.run=function(){var T=DB[this.t]||(DB[this.t]=[]),self=this,ok=function(r){return self.f.every(function(f){return match(r,f)})};var out;
 if(this.act==='insert'){out=this.rows.map(function(r){var n=Object.assign({id:nid(),creado:iso(new Date())},r);T.push(n);return n;});aviso();}
 else if(this.act==='upsert'){out=this.rows.map(function(r){var ex=T.filter(function(x){return self.oc.every(function(k){return x[k]===r[k]})})[0];if(ex){Object.assign(ex,r);return ex;}var n=Object.assign({id:nid(),creado:iso(new Date())},r);T.push(n);return n;});aviso();}
 else if(this.act==='update'){out=T.filter(ok);out.forEach(function(r){Object.assign(r,self.val)});aviso();}
 else if(this.act==='delete'){out=T.filter(ok);DB[this.t]=T.filter(function(r){return !ok(r)});aviso();}
 else{out=T.filter(ok);this.o.slice().reverse().forEach(function(o){out=out.slice().sort(function(a,b){var x=a[o[0]],y=b[o[0]];if(x==y)return 0;if(x==null)return 1;if(y==null)return -1;return (x<y?-1:1)*(o[1]?1:-1);});});if(this.lim)out=out.slice(0,this.lim);}
 out=JSON.parse(JSON.stringify(out));
 if(this.opts.head)return{data:null,count:out.length,error:null};
 if(this.one)return{data:out[0]||null,error:(this.one==='s'&&!out[0])?{message:'no rows'}:null};
 return{data:out,count:out.length,error:null};};
var session={user:{id:'u1',email:'laura@ejemplo.com'},access_token:'demo'};
var client={from:function(t){return new Q(t);},rpc:function(){return Promise.resolve({data:null,error:null});},
 auth:{getSession:function(){return Promise.resolve({data:{session:session},error:null});},getUser:function(){return Promise.resolve({data:{user:session.user},error:null});},onAuthStateChange:function(){return{data:{subscription:{unsubscribe:function(){}}}};},signOut:function(){return Promise.resolve({error:null});},signInWithPassword:function(){return Promise.resolve({data:{session:session},error:null});},updateUser:function(){return Promise.resolve({data:{},error:null});}},
 storage:{from:function(){return{upload:function(){return Promise.resolve({data:{path:'demo'},error:null});},getPublicUrl:function(){return{data:{publicUrl:''}};},createSignedUrl:function(){return Promise.resolve({data:{signedUrl:''},error:null});},remove:function(){return Promise.resolve({data:null,error:null});}};}},
 functions:{invoke:function(){return Promise.resolve({data:{ok:true},error:null});}}};
window.supabase={createClient:function(){return client;}};
try{localStorage.setItem('pb_guia_vista','99');}catch(e){}
try{if(navigator.serviceWorker){navigator.serviceWorker.register=function(){return Promise.reject(new Error('demo'))};}}catch(e){}
try{if(window.Notification)Object.defineProperty(Notification,'permission',{get:function(){return 'default'}});}catch(e){}
var __tap=0;addEventListener('pointerdown',function(){__tap=Date.now()},true);
var tAv=0;function aviso(){if(Date.now()-__tap>1500)return;clearTimeout(tAv);tAv=setTimeout(function(){var d=document.getElementById('demoAv');if(!d){d=document.createElement('div');d.id='demoAv';d.style.cssText='position:fixed;left:50%;bottom:86px;transform:translateX(-50%);z-index:99999;background:#1E1A17;color:#fff;font:500 13px Poppins,system-ui,sans-serif;padding:9px 16px;border-radius:999px;box-shadow:0 8px 20px -8px rgba(0,0,0,.5);transition:opacity .3s;white-space:nowrap';document.body.appendChild(d);}d.textContent='Es una demo: no se guarda nada';d.style.opacity=1;clearTimeout(d._t);d._t=setTimeout(function(){d.style.opacity=0},2200);},60);}
})();
