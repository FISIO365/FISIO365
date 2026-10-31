// Compara la app de verdad (Airtable) con esta versión (Postgres): las mismas lecturas del panel y de la app del paciente,
// con datos reales, y devuelve las diferencias. Solo lecturas. Lo usa /api/schedule?action=pg-comparar (con MIGRAR_KEY).
const PROD = 'https://app.fisioterapia365.com';
const madrid = (d = 0) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date(Date.now() + d * 864e5));
// Campos que cambian solos entre dos llamadas (horas de generación, tiempos, firmas de enlaces, adjuntos…)
const VOLATIL = /^(t|ts|ahora|generado|tiempo|ms|hoyHora|actualizado|cache|fresco|_t|url|firmado|token|sig|enlace|link|mini|thumbnails|k)$/i;
function norm(x) {
  if (Array.isArray(x)) return x.map(norm);
  if (x && typeof x === 'object') { const o = {}; for (const k of Object.keys(x).sort()) { if (VOLATIL.test(k)) continue; o[k] = norm(x[k]); } return o; }
  if (typeof x === 'string' && /\/api\/schedule\?action=archivo|airtableusercontent|supabase\.co\/storage/.test(x)) return '«adjunto»';
  return x;
}
function difs(a, b, p = '', out = []) {
  if (out.length >= 6) return out;
  if (JSON.stringify(a) === JSON.stringify(b)) return out;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) { out.push(`${p || '·'}: ${a.length} elementos en la de verdad, ${b.length} en la nueva`); }
    const sa = a.map(x => JSON.stringify(x)), sb = new Set(b.map(x => JSON.stringify(x)));
    if (a.length === b.length && sa.every(x => sb.has(x))) { out.push(`${p || '·'}: mismo contenido, distinto orden`); return out; }
    for (let i = 0; i < Math.min(a.length, b.length) && out.length < 6; i++) difs(a[i], b[i], `${p}[${i}]`, out);
    return out;
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) { if (out.length >= 6) break; if (!(k in b)) out.push(`${p}.${k}: falta en la nueva`); else if (!(k in a)) out.push(`${p}.${k}: sobra en la nueva`); else difs(a[k], b[k], `${p}.${k}`, out); }
    return out;
  }
  out.push(`${p || '·'}: ${JSON.stringify(a).slice(0, 90)} ≠ ${JSON.stringify(b).slice(0, 90)}`); return out;
}
async function pedir(base, ruta, F) {
  const t0 = Date.now();
  try { const r = await F(base + ruta, { headers: { 'x-comparar': '1' } }); const txt = await r.text(); let j = null; try { j = JSON.parse(txt); } catch (_) {}
    return { st: r.status, j, txt: j ? '' : txt.slice(0, 120), ms: Date.now() - t0 }; }
  catch (e) { return { st: 0, txt: String(e.message || e).slice(0, 120), ms: Date.now() - t0 }; }
}
async function lista(F, P) { // P: { pwd, self }
  const pw = encodeURIComponent(P.pwd), hoy = madrid(), sem = madrid(7), ant = madrid(-30), mes = hoy.slice(0, 7);
  // Ids reales sacados de la de verdad: pacientes de la agenda, un fisio, una ficha con adjuntos…
  const ag = (await pedir(PROD, `/api/schedule?action=seg-agenda-dia&pwd=${pw}&desde=${madrid(-7)}&hasta=${sem}`, F)).j || {};
  const citas = (ag.citas || []).filter(c => c.pacienteId);
  const pacs = [...new Set(citas.map(c => c.pacienteId))].slice(0, 4);
  const fis = (await pedir(PROD, `/api/fisios?pwd=${pw}`, F)).j; const fisL = Array.isArray(fis) ? fis : (fis && (fis.fisios || fis.records)) || [];
  const fisioId = (fisL[0] && (fisL[0].id)) || ''; const fisioNom = (fisL[0] && (fisL[0].nombre || fisL[0].name)) || 'Sara';
  const c0 = citas[0] || {};
  const R = [
    ['schedule', `version`], ['schedule', `clinica-pub`], ['schedule', `config-pub`], ['schedule', `estados&pwd=${pw}`],
    ['schedule', `seg-agenda-dia&pwd=${pw}`], ['schedule', `seg-agenda-dia&pwd=${pw}&fecha=${hoy}`], ['schedule', `seg-agenda-dia&pwd=${pw}&fecha=${madrid(1)}`], ['schedule', `seg-agenda-dia&pwd=${pw}&fecha=${madrid(2)}`],
    ['schedule', `seg-agenda-dia&pwd=${pw}&desde=${hoy}&hasta=${sem}`], ['schedule', `seg-agenda-dia&pwd=${pw}&desde=${ant}&hasta=${hoy}`],
    ['schedule', `seg-agenda-num&pwd=${pw}&desde=${ant}&hasta=${sem}&pago=1`], ['schedule', `seg-agenda-altas&pwd=${pw}`], ['schedule', `seg-agenda-ejpend&pwd=${pw}`],
    ['schedule', `seg-agenda-enc-nuevas&pwd=${pw}`], ['schedule', `seg-agenda-encuestas&pwd=${pw}&fecha=${hoy}`], ['schedule', `seg-agenda-pagos&pwd=${pw}&t=1`],
    ['schedule', `seg-agenda-recordatorios&pwd=${pw}&fechas=${hoy},${madrid(1)}`], ['schedule', `seg-agenda-resenas&pwd=${pw}`], ['schedule', `seg-agenda-sorteo&pwd=${pw}&mes=${mes}`],
    ['schedule', `seg-agenda-tipos&pwd=${pw}`], ['schedule', `seg-agenda-val-fisios&pwd=${pw}&mes=${mes}`], ['schedule', `seg-app-pendientes&pwd=${pw}`],
    ['schedule', `seg-cap&pwd=${pw}`], ['schedule', `seg-cap-avisos&pwd=${pw}`], ['schedule', `seg-config&pwd=${pw}`], ['schedule', `seg-conocido&pwd=${pw}&desde=${ant}`],
    ['schedule', `seg-consent-pendientes&pwd=${pw}`], ['schedule', `seg-consent-buscar&pwd=${pw}&q=ma`], ['schedule', `seg-estadisticas&pwd=${pw}&semanas=8`],
    ['schedule', `seg-gastos&pwd=${pw}`], ['schedule', `seg-ingresos-detalle&pwd=${pw}&desde=${ant}&hasta=${hoy}`], ['schedule', `seg-ingresos-todo&pwd=${pw}`],
    ['schedule', `seg-lista&pwd=${pw}`], ['schedule', `seg-lista&pwd=${pw}&desde=${ant}&hasta=${hoy}`], ['schedule', `seg-referidos&pwd=${pw}&t=1`], ['schedule', `seg-referidos-resueltos&pwd=${pw}`],
    ['schedule', `seg-sin-anotar&pwd=${pw}`], ['schedule', `seg-sinevo-lista&pwd=${pw}`], ['schedule', `seg-tareas&pwd=${pw}`], ['schedule', `seg-ultimas&pwd=${pw}`], ['schedule', `seg-vales&pwd=${pw}&t=1`],
    ['schedule', `rendimiento&pwd=${pw}&desde=${ant}&hasta=${hoy}`], ['schedule', `rendimiento&dinero=1&pwd=${pw}&desde=${ant}&hasta=${hoy}`],
    ['schedule', `horas&pwd=${pw}&fisio=${encodeURIComponent(fisioNom)}&desde=${ant}&hasta=${hoy}`], ['schedule', `seg-cierre&pwd=${pw}&fisio=${encodeURIComponent(fisioNom)}`],
    ['fisios', `lista-publica`], ['fisios', `version&pwd=${pw}`], ['fisios', `&pwd=${pw}`, '/api/fisios?pwd=' + pw],
    ['chat', `conversaciones&pwd=${pw}&fisioId=${fisioId}`], ['chat', `sin-leer&pwd=${pw}&fisioId=${fisioId}`],
    ['pacientes', `buscar&pwd=${pw}&q=mar`], ['pacientes', `get-mensajes-fisio&pwd=${pw}&fisioId=${fisioId}`], ['pacientes', `get-mensajes-fisio&pwd=${pw}&fisioId=${fisioId}&soloCount=1`],
    ['progreso', '', `/api/progreso?pwd=${pw}&fisioId=${fisioId}`], ['reservar', '', `/api/reservar`], ['ejercicios', '', `/api/ejercicios?pwd=${pw}`],
  ];
  if (c0.pacienteId) R.push(['schedule', `seg-agenda-pack&pwd=${pw}&pacienteId=${c0.pacienteId}&fecha=${c0.fecha || hoy}&hora=${encodeURIComponent(c0.hora || '10:00')}`]);
  for (const p of pacs) R.push(
    ['schedule', `seg-ficha&pwd=${pw}&id=${p}`], ['schedule', `ficha-facturas&pwd=${pw}&pacienteId=${p}`], ['schedule', `seg-agenda-dia&pwd=${pw}&pacienteId=${p}&desde=2020-01-01&hasta=2030-12-31`],
    ['schedule', `seg-agenda-num&pwd=${pw}&pacienteId=${p}&desde=2020-01-01&hasta=2030-12-31&pago=1`], ['schedule', `seg-sinevo&pwd=${pw}&id=${p}`],
    ['pacientes', `get-informes&pwd=${pw}&pacienteId=${p}`], ['pacientes', `get-diario&pwd=${pw}&pacienteId=${p}`], ['pacientes', `get-mensajes&pacienteId=${p}`],
    ['pacientes', `get-notificaciones&pacienteId=${p}`], ['pacientes', `get-tareas&pacienteId=${p}`], ['pacientes', `get-puntos&pacienteId=${p}`],
    ['chat', `chats&pacienteId=${p}&asignado=`], ['chat', `hilo&pwd=${pw}&pacienteId=${p}`], ['citas', '', `/api/citas?patientId=${p}`],
    ['diario', `get-mensajes&patientId=${p}`], ['schedule', `mis-documentos&patientId=${p}`], ['schedule', `mis-regalos&patientId=${p}`], ['schedule', `facturas&patientId=${p}`],
    ['progreso', '', `/api/progreso?pacienteId=${p}`], ['schedule', '', `/api/schedule?patientId=${p}`]);
  return R.map(([fn, a, ruta]) => ruta || `/api/${fn}?action=${a}`);
}
async function comparar({ fetch: F, pwd, self, desde = 0, cuantas = 25, rutas = null }) {
  const L = rutas || await lista(F, { pwd, self });
  const parte = L.slice(desde, desde + cuantas), res = [];
  for (let i = 0; i < parte.length; i += 5) {
    await Promise.all(parte.slice(i, i + 5).map(async ruta => {
      const [a, b] = await Promise.all([pedir(PROD, ruta, F), pedir(self, ruta, F)]);
      const sinPwd = ruta.replace(/pwd=[^&]*/, 'pwd=…');
      const D = a.st !== b.st ? [`estado ${a.st} ≠ ${b.st}${b.txt ? ' · ' + b.txt : ''}`] : (a.j && b.j ? difs(norm(a.j), norm(b.j)) : (a.txt === b.txt ? [] : ['respuesta distinta (no JSON)']));
      res.push({ ruta: sinPwd, ok: !D.length, estado: a.st, ms: [a.ms, b.ms], difs: D });
    }));
  }
  return { total: L.length, desde, hasta: desde + parte.length, mal: res.filter(r => !r.ok), bien: res.filter(r => r.ok).map(r => `${r.ruta.slice(0, 70)} (${r.ms[0]}→${r.ms[1]} ms)`), rutas: desde === 0 ? L.map(r => r.replace(/pwd=[^&]*/, 'pwd=…')) : undefined };
}
module.exports = { comparar, lista };
