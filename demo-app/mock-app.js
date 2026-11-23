/* Demo de la app del paciente de FISIO365 para Mandarina: datos inventados, no se guarda nada. */
(function(){
const HOY = new Date();
const iso = d => d.toISOString().slice(0, 10);
const dmy = d => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
const dia = n => { const d = new Date(HOY); d.setDate(d.getDate() + n); return d; };

const PAC = { id: 'recPruebaLaura0001', nombre: 'Lucía Martín', email: 'lucia.martin@ejemplo.com', equipo: [] };
const FISIO = { id: 'recFisioLaura00001', nombre: 'Laura', colegiado: '' };
const EJ = [
  { id: 'e1', name: 'Puente de glúteo', series: 3, reps: 12, descanso: 45, desc: 'Sube despacio y aprieta glúteos arriba 2 segundos.', explica: 'Túmbate boca arriba con las rodillas dobladas. Sube la cadera hasta alinear rodillas, cadera y hombros.' },
  { id: 'e2', name: 'Plancha frontal', series: 3, duracion: 30, descanso: 30, desc: 'Si molesta la zona lumbar, apoya las rodillas.', explica: 'Apoya antebrazos y puntas de los pies. Mantén el cuerpo recto, sin hundir la zona lumbar.' },
  { id: 'e3', name: 'Bird-dog', series: 3, reps: 10, descanso: 30, desc: 'Estira brazo y pierna contrarios sin mover la pelvis.', explica: 'A cuatro patas, estira a la vez un brazo y la pierna contraria. Aguanta 2 segundos y cambia.' },
  { id: 'e4', name: 'Gato-camello', series: 2, reps: 10, descanso: 20, desc: 'Movimiento suave, sin forzar el final.', explica: 'A cuatro patas, redondea la espalda hacia arriba y luego déjala caer suavemente.' },
];
const CITAS = [
  { id: 'c1', fecha: dmy(dia(1)), hora: '18:00', fisio: 'Laura', estado: 'PENDIENTE', tipo: 'Fisioterapia' },
  { id: 'c2', fecha: dmy(dia(8)), hora: '18:00', fisio: 'Laura', estado: 'PENDIENTE', tipo: 'Fisioterapia' },
  { id: 'c3', fecha: dmy(dia(-7)), hora: '18:00', fisio: 'Laura', estado: 'REALIZADA', tipo: 'Fisioterapia' },
  { id: 'c4', fecha: dmy(dia(-14)), hora: '17:00', fisio: 'Laura', estado: 'REALIZADA', tipo: 'Fisioterapia' },
  { id: 'c5', fecha: dmy(dia(-31)), hora: '17:30', fisio: 'Laura', estado: 'REALIZADA', tipo: 'Primera visita' },
];
const tareas = []; for (let i = 1; i <= 9; i++) tareas.push({ fecha: iso(dia(-i)) }); [12, 13, 16, 17, 18, 22, 23].forEach(i => tareas.push({ fecha: iso(dia(-i)) }));
const huecos = []; [[1, ['10:00', '19:00']], [2, ['17:00']], [3, ['12:00', '18:00']], [4, ['09:00', '16:00']]].forEach(([n, hs]) => hs.forEach((h, i) => huecos.push({ id: `recHueco${n}${i}000000000`.slice(0, 17), fecha: iso(dia(n)), hora: h, fisio: 'Laura' })));
const t0 = n => new Date(HOY.getTime() - n * 60000).toISOString();
const HILO = [
  { id: 'm1', de: 'paciente', texto: 'Hola, en la plancha frontal me molesta un poco la zona lumbar al final de la serie. ¿Es normal?', fecha: t0(60 * 14), leido: true },
  { id: 'm2', de: 'fisio', fisioId: FISIO.id, fisioNombre: 'Laura', texto: '¡Hola Lucía! Es normal si aún te cuesta mantener el abdomen activo. Prueba a apoyar las rodillas y bajar a 20 segundos esta semana. Lo revisamos en la próxima sesión 😊', fecha: t0(60 * 13), leido: true },
  { id: 'm3', de: 'paciente', texto: 'Perfecto, así lo hago. ¡Gracias!', fecha: t0(60 * 12.9), leido: true },
];
let BODY = null;
const misRes = () => { try { return JSON.parse(localStorage.getItem('mand_demo_res') || '[]'); } catch (e) { return []; } };
const API = (u, method) => {
  const q = u.searchParams, a = q.get('action') || '', p = u.pathname;
  if (p === '/api/login') return { ok: true, patient: PAC };
  if (p === '/api/schedule' && !a && q.get('patientId')) return { ok: true, ejercicios: EJ, fisio: FISIO, mensajeFisio: 'Esta semana céntrate en el puente: sube despacio y aguanta arriba.', ultimaSession: '' };
  if (p === '/api/citas') return { ok: true, citas: CITAS.concat(misRes().map((x, i) => ({ id: 'r' + i, fecha: x.fecha.split('-').reverse().join('/'), hora: x.hora, fisio: x.fisio, estado: 'PENDIENTE', tipo: 'Fisioterapia' }))) };
  if (p === '/api/pacientes' && a === 'get-tareas') return { ok: true, tareas };
  if (p === '/api/pacientes' && a === 'get-notificaciones') return { ok: true, notificaciones: [] };
  if (p === '/api/pacientes' && a === 'get-mensajes') return { ok: true, mensajes: [] };
  if (p === '/api/pacientes' && a === 'get-puntos') return { ok: true, puntos: 0 };
  if (p === '/api/chat' && a === 'chats') return { ok: true, chats: [{ id: FISIO.id, nombre: 'Laura', tuyo: true, texto: HILO[2].texto, de: 'paciente', ultimo: HILO[2].fecha, sinLeer: 0 }, { id: 'admin', nombre: 'Recepción', admin: true, texto: '', ultimo: '' }] };
  if (p === '/api/chat' && a === 'hilo') return { ok: true, mensajes: HILO, fisio: FISIO };
  if (p === '/api/fisios') return { ok: true, fisios: [{ id: FISIO.id, nombre: 'Laura' }, { id: 'recFisioMarc00001', nombre: 'Marc' }] };
  if (p === '/api/reservar' && method === 'GET') { const R = misRes(); return { ok: true, huecos: huecos.filter(h => !R.some(x => x.fecha === h.fecha && x.hora === h.hora)) }; }
  if (p === '/api/reservar' && method === 'POST') { const h = huecos.find(x => x.id === (BODY || {}).huecoId); if (h) { const R = misRes(); R.push({ fecha: h.fecha, hora: h.hora, fisio: h.fisio, t: Date.now() }); try { localStorage.setItem('mand_demo_res', JSON.stringify(R)); } catch (e) {} } return { ok: true }; }
  if (p === '/api/schedule' && a === 'mis-documentos') return { ok: true, docs: [{ id: 'd1', tipo: 'Primera visita', fecha: iso(dia(-31)) }] };
  if (p === '/api/schedule' && a === 'facturas') return { ok: true, facturas: [{ id: 'f1', numero: 'T-0412', fecha: dia(-7).getTime() / 1000, concepto: 'Sesión de fisioterapia', total: 65 }, { id: 'f2', numero: 'T-0387', fecha: dia(-14).getTime() / 1000, concepto: 'Sesión de fisioterapia', total: 65 }] };
  if (p === '/api/schedule' && a === 'informes') return { ok: true, informes: [{ fecha: dmy(dia(-31)), tipo: 'lumbar', fisioNombre: 'Laura' }] };
  if (p === '/api/schedule' && a === 'mis-regalos') return { ok: true, tarjetas: [] };
  if (p === '/api/schedule' && a === 'talleres-app') return { ok: true, talleres: [] };
  if (p === '/api/dolor') return { ok: true, registros: [] };
  if (p === '/api/schedule' && a === 'clinica-pub') return { ok: true, clinica: { marca: 'FISIO365' }, pares: [] };
  return { ok: true };
};


try{if(window.Notification)Object.defineProperty(Notification,'permission',{get:function(){return 'default'}});}catch(e){}
try{localStorage.setItem('fisio365_patient',JSON.stringify(PAC));localStorage.setItem('f365_visto_'+PAC.id,'1');localStorage.setItem('f365_inst_'+PAC.id,'1');localStorage.setItem('f365_lang','es');localStorage.setItem('hechos_'+PAC.id+'_'+iso(HOY),JSON.stringify(['e1']));}catch(e){}
try{if(navigator.serviceWorker){navigator.serviceWorker.register=function(){return Promise.reject(new Error('demo'))};}}catch(e){}
var f0=window.fetch.bind(window);
window.fetch=function(u,o){var url=String(u&&u.url||u);if(url.indexOf('/api/')<0)return f0(u,o);var U=new URL(url,location.href),m=((o&&o.method)||'GET').toUpperCase();
 try{BODY=o&&typeof o.body==='string'?JSON.parse(o.body):null}catch(e){BODY=null}var d=API(U,m);return new Promise(function(res){setTimeout(function(){res(new Response(JSON.stringify(d),{status:200,headers:{'Content-Type':'application/json'}}))},120)})};
})();
