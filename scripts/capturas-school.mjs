// Capturas de la app del paciente para School (public/img/school/app-*.jpg) con datos de prueba.
// Uso: node scripts/capturas-school.mjs            (todas)
//      node scripts/capturas-school.mjs app-02-hoy (solo esas)
// No toca datos reales: sirve public/ en local y responde a /api/* con datos inventados («Laura Martín», fisio Sara).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'public');
const SAL = path.join(RAIZ, 'img', 'school');
const HOY = new Date('2026-11-09T09:40:00+01:00'); // lunes
const iso = d => d.toISOString().slice(0, 10);
const dmy = d => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
const dia = n => { const d = new Date(HOY); d.setDate(d.getDate() + n); return d; };

const PAC = { id: 'recPruebaLaura0001', nombre: 'Laura Martín', email: 'laura.martin@ejemplo.com', equipo: [] };
const FISIO = { id: 'recFisioSara000001', nombre: 'Sara', colegiado: '' };
const EJ = [
  { id: 'e1', name: 'Puente de glúteo', series: 3, reps: 12, descanso: 45, desc: 'Sube despacio y aprieta glúteos arriba 2 segundos.', explica: 'Túmbate boca arriba con las rodillas dobladas. Sube la cadera hasta alinear rodillas, cadera y hombros.' },
  { id: 'e2', name: 'Plancha frontal', series: 3, duracion: 30, descanso: 30, desc: 'Si molesta la zona lumbar, apoya las rodillas.', explica: 'Apoya antebrazos y puntas de los pies. Mantén el cuerpo recto, sin hundir la zona lumbar.' },
  { id: 'e3', name: 'Bird-dog', series: 3, reps: 10, descanso: 30, desc: 'Estira brazo y pierna contrarios sin mover la pelvis.', explica: 'A cuatro patas, estira a la vez un brazo y la pierna contraria. Aguanta 2 segundos y cambia.' },
  { id: 'e4', name: 'Gato-camello', series: 2, reps: 10, descanso: 20, desc: 'Movimiento suave, sin forzar el final.', explica: 'A cuatro patas, redondea la espalda hacia arriba y luego déjala caer suavemente.' },
];
const CITAS = [
  { id: 'c1', fecha: dmy(dia(1)), hora: '18:00', fisio: 'Sara', estado: 'PENDIENTE', tipo: 'Fisioterapia' },
  { id: 'c2', fecha: dmy(dia(8)), hora: '18:00', fisio: 'Sara', estado: 'PENDIENTE', tipo: 'Fisioterapia' },
  { id: 'c3', fecha: dmy(dia(-7)), hora: '18:00', fisio: 'Sara', estado: 'REALIZADA', tipo: 'Fisioterapia' },
  { id: 'c4', fecha: dmy(dia(-14)), hora: '17:00', fisio: 'Sara', estado: 'REALIZADA', tipo: 'Fisioterapia' },
  { id: 'c5', fecha: dmy(dia(-31)), hora: '17:30', fisio: 'Sara', estado: 'REALIZADA', tipo: 'Primera visita' },
];
const tareas = []; for (let i = 1; i <= 9; i++) tareas.push({ fecha: iso(dia(-i)) }); [12, 13, 16, 17, 18, 22, 23].forEach(i => tareas.push({ fecha: iso(dia(-i)) }));
const huecos = []; [[1, ['10:00', '19:30']], [2, ['17:00']], [3, ['12:30', '18:30']], [4, ['09:00', '16:00']]].forEach(([n, hs]) => hs.forEach((h, i) => huecos.push({ id: `recHueco${n}${i}000000000`.slice(0, 17), fecha: iso(dia(n)), hora: h, fisio: 'Sara' })));
const t0 = n => new Date(HOY.getTime() - n * 60000).toISOString();
const HILO = [
  { id: 'm1', de: 'paciente', texto: 'Hola Sara, en la plancha frontal me molesta un poco la zona lumbar al final de la serie. ¿Es normal?', fecha: t0(60 * 14), leido: true },
  { id: 'm2', de: 'fisio', fisioId: FISIO.id, fisioNombre: 'Sara', texto: '¡Hola Laura! Es normal si aún te cuesta mantener el abdomen activo. Prueba a apoyar las rodillas y bajar a 20 segundos esta semana. Lo revisamos en la próxima sesión 😊', fecha: t0(60 * 13), leido: true },
  { id: 'm3', de: 'paciente', texto: 'Perfecto, así lo hago. ¡Gracias!', fecha: t0(60 * 12.9), leido: true },
];
const API = (u, method) => {
  const q = u.searchParams, a = q.get('action') || '', p = u.pathname;
  if (p === '/api/login') return { ok: true, patient: PAC };
  if (p === '/api/schedule' && !a && q.get('patientId')) return { ok: true, ejercicios: EJ, fisio: FISIO, mensajeFisio: 'Esta semana céntrate en el puente: sube despacio y aguanta arriba.', ultimaSession: '' };
  if (p === '/api/citas') return { ok: true, citas: CITAS };
  if (p === '/api/pacientes' && a === 'get-tareas') return { ok: true, tareas };
  if (p === '/api/pacientes' && a === 'get-notificaciones') return { ok: true, notificaciones: [] };
  if (p === '/api/pacientes' && a === 'get-mensajes') return { ok: true, mensajes: [] };
  if (p === '/api/pacientes' && a === 'get-puntos') return { ok: true, puntos: 0 };
  if (p === '/api/chat' && a === 'chats') return { ok: true, chats: [{ id: FISIO.id, nombre: 'Sara', tuyo: true, texto: HILO[2].texto, de: 'paciente', ultimo: HILO[2].fecha, sinLeer: 0 }, { id: 'admin', nombre: 'Recepción', admin: true, texto: '', ultimo: '' }] };
  if (p === '/api/chat' && a === 'hilo') return { ok: true, mensajes: HILO, fisio: FISIO };
  if (p === '/api/fisios') return { ok: true, fisios: [{ id: FISIO.id, nombre: 'Sara' }, { id: 'recFisioJona00001', nombre: 'Jonathan' }] };
  if (p === '/api/reservar' && method === 'GET') return { ok: true, huecos };
  if (p === '/api/schedule' && a === 'mis-documentos') return { ok: true, docs: [{ id: 'd1', tipo: 'Primera visita', fecha: iso(dia(-31)) }] };
  if (p === '/api/schedule' && a === 'facturas') return { ok: true, facturas: [{ id: 'f1', numero: 'T-0412', fecha: dia(-7).getTime() / 1000, concepto: 'Sesión de fisioterapia', total: 65 }, { id: 'f2', numero: 'T-0387', fecha: dia(-14).getTime() / 1000, concepto: 'Sesión de fisioterapia', total: 65 }] };
  if (p === '/api/schedule' && a === 'informes') return { ok: true, informes: [{ fecha: dmy(dia(-31)), tipo: 'lumbar', fisioNombre: 'Sara' }] };
  if (p === '/api/schedule' && a === 'mis-regalos') return { ok: true, tarjetas: [] };
  if (p === '/api/schedule' && a === 'talleres-app') return { ok: true, talleres: [] };
  if (p === '/api/dolor') return { ok: true, registros: [] };
  if (p === '/api/schedule' && a === 'clinica-pub') return { ok: true, clinica: { marca: 'FISIO365' }, pares: [] };
  return { ok: true };
};

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.mp4': 'video/mp4', '.woff2': 'font/woff2' };
const srv = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname.startsWith('/api/')) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(API(u, req.method))); }
  let f = path.join(RAIZ, decodeURIComponent(u.pathname)); if (u.pathname === '/') f = path.join(RAIZ, 'index.html');
  if (!f.startsWith(RAIZ) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
});
await new Promise(r => srv.listen(0, r)); const BASE = `http://localhost:${srv.address().port}`;

const b = await chromium.launch();
async function nueva(logueado = true) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'es-ES', timezoneId: 'Europe/Madrid', permissions: ['notifications'] });
  const p = await ctx.newPage();
  await p.clock.install({ time: HOY }); await p.clock.resume();
  await p.addInitScript(([pac, logueado, hoy]) => {
    try { if (window.Notification) Object.defineProperty(Notification, 'permission', { get: () => 'default' }); } catch (e) {}
    try {
      if (logueado) localStorage.setItem('fisio365_patient', JSON.stringify(pac));
      localStorage.setItem('f365_visto_' + pac.id, '1'); localStorage.setItem('f365_inst_' + pac.id, '1');
      localStorage.setItem('f365_lang', 'es');
      localStorage.setItem(`hechos_${pac.id}_${hoy}`, JSON.stringify(['e1']));
    } catch (e) {}
  }, [PAC, logueado, iso(HOY)]);
  await p.goto(BASE + '/index.html', { waitUntil: 'networkidle' }); await p.waitForTimeout(1200);
  await p.evaluate(() => { try { document.getElementById('appScreen').style.opacity = '1'; if (window.hechos && window.ejercicios !== undefined) {} } catch (e) {} });
  if (logueado) await p.evaluate(() => { try { hechos.add('e1'); renderEjercicios(); } catch (e) {} });
  return p;
}
const foto = async (p, n) => { await p.waitForTimeout(700); await p.screenshot({ path: path.join(SAL, n + '.jpg'), type: 'jpeg', quality: 88 }); console.log('ok', n); };
const SEC = async (p, s) => { await p.evaluate(s => showSection(s), s); await p.waitForTimeout(900); };

const SHOTS = {
  'app-01-entrar': async () => { const p = await nueva(false); await p.fill('#emailInput', PAC.email); for (const [i, d] of ['1', '9', '8', '4'].entries()) await p.fill('#p' + (i + 1), d); await foto(p, 'app-01-entrar'); },
  'app-02-hoy': async () => { const p = await nueva(); await foto(p, 'app-02-hoy'); },
  'app-03-ejercicio': async () => { const p = await nueva(); await p.evaluate(() => abrirSesion(1)); await foto(p, 'app-03-ejercicio'); },
  'app-04-racha': async () => { const p = await nueva(); await SEC(p, 'progreso'); await foto(p, 'app-04-racha'); },
  'app-05-citas': async () => { const p = await nueva(); await SEC(p, 'citas'); await foto(p, 'app-05-citas'); },
  'app-05b-citas-politica': async () => { const p = await nueva(); await SEC(p, 'citas'); await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await foto(p, 'app-05b-citas-politica'); },
  'app-06-reservar': async () => { const p = await nueva(); await p.evaluate(() => abrirReserva()); await p.waitForTimeout(1200); await foto(p, 'app-06-reservar'); },
  'app-06b-reservar-confirmar': async () => { const p = await nueva(); await p.evaluate(() => abrirReserva()); await p.waitForTimeout(1200); await p.click('.rv-h:not(.off) >> nth=2'); await foto(p, 'app-06b-reservar-confirmar'); },
  'app-07-chat': async () => { const p = await nueva(); await SEC(p, 'mensajes'); await p.click('.cl-it >> nth=0'); await p.waitForTimeout(1200); await foto(p, 'app-07-chat'); },
  'app-08-documentos': async () => { const p = await nueva(); await SEC(p, 'informes'); await foto(p, 'app-08-documentos'); },
  'app-09-packs': async () => { const p = await nueva(); await p.evaluate(() => abrirPacks()); await foto(p, 'app-09-packs'); },
  'app-10-menu': async () => { const p = await nueva(); await p.click('#hamburgerBtn'); await foto(p, 'app-10-menu'); },
  'app-11-notificaciones': async () => { const p = await nueva(); await SEC(p, 'notificaciones'); await foto(p, 'app-11-notificaciones'); },
  'app-12-guia': async () => { const p = await nueva(); await SEC(p, 'guia'); await foto(p, 'app-12-guia'); },
  'app-13-instalar': async () => { const p = await nueva(); await p.evaluate(() => { document.getElementById('inBanner').classList.add('on'); const y = document.getElementById('paraTi').getBoundingClientRect().top + scrollY - 420; scrollTo(0, y); }); await foto(p, 'app-13-instalar'); },
  'app-13b-instalar-pasos': async () => { const p = await nueva(); await p.evaluate(() => mostrarInstall()); await foto(p, 'app-13b-instalar-pasos'); },
};
const quien = process.argv.slice(2); for (const [n, f] of Object.entries(SHOTS)) if (!quien.length || quien.includes(n)) { try { await f(); } catch (e) { console.log('FALLO', n, e.message.split('\n')[0]); } }
await b.close(); srv.close();
