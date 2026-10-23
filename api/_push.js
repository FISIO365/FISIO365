"use strict";
// Utilidades compartidas para los avisos (push) de la app y del panel
const webpush = require('web-push');
const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const BASE_ID = 'appsrGnHpFt8sVD5A';
const TABLAS = { paciente: 'tbldBVgClS4HY2mOJ', fisio: 'tbl2mLUrnaKCFTs6g' };
webpush.setVapidDetails('mailto:info@fisioterapia365.com', process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);

const idValido = (s) => /^rec[A-Za-z0-9]{14}$/.test(s || '');

// Lee la suscripción guardada de un paciente o fisio
async function leerSub(tipo, id) {
  if (!idValido(id)) return null;
  const r = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${TABLAS[tipo]}/${id}`, { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } });
  if (!r.ok) return null;
  const d = await r.json();
  const s = d.fields?.PushSubscription;
  try { return s ? JSON.parse(s) : null; } catch (e) { return null; }
}

// Envía un aviso. url = a dónde lleva al tocarlo. Devuelve true/false
async function enviar(sub, { title, body, url, tag }) {
  if (!sub) return false;
  try {
    await webpush.sendNotification(sub, JSON.stringify({ title: title || 'FISIO365', body: body || '', url: url || '/', tag: tag || '' }));
    return true;
  } catch (e) { return false; }
}

async function avisar(tipo, id, datos) { return enviar(await leerSub(tipo, id), datos); }


// ── Saldo de sesiones (bonos) por paciente ──
// saldo = sesiones pagadas (facturas emitidas desde el panel + «SESIONES BONO PREVIO») − sesiones gastadas
// Gastan sesión las citas REALIZADA y CITA PERDIDA desde el día de la primera factura emitida desde el panel.
const FACTURAS = 'tblJw7suXLERn8AFQ';
const CITAS = 'tblTPlcuiSjQngkaD';
const PACIENTES_T = 'tbldBVgClS4HY2mOJ';
const GASTA = ['REALIZADA', 'CITA PERDIDA'];

async function todosAT(tabla, query) {
  let recs = [], off = '';
  do {
    const r = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${tabla}?${query}&pageSize=100${off ? '&offset=' + off : ''}`, { headers: { Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}` } });
    const d = await r.json();
    if (d.error) throw new Error(d.error.message || 'Airtable');
    recs = recs.concat(d.records || []); off = d.offset || '';
  } while (off);
  return recs;
}
const sesionesDe = f => {
  let n = 0;
  if (/^Sesi/i.test(f['CONCEPTO 1'] || '')) n += Number(f['Nº SESIONES 1'] || 0);
  if (/^Sesi/i.test(f['CONCEPTO 2'] || '')) n += Number(f['Nº SESIONES 2'] || 0);
  return n;
};
const fechaCobro = f => f['FECHA DE COBRO'] || f['FECHA'] || '';

// Facturas emitidas (todas o de un paciente) y fecha de inicio del control
async function facturasEmitidas(pacId) {
  const filtro = pacId ? `AND({ESTADO}='Emitida',{PacienteId}='${pacId}')` : `{ESTADO}='Emitida'`;
  return todosAT(FACTURAS, `filterByFormula=${encodeURIComponent(filtro)}`);
}
async function inicioControl() {
  const r = await todosAT(FACTURAS, `filterByFormula=${encodeURIComponent(`{ESTADO}='Emitida'`)}&fields[]=FECHA DE COBRO&fields[]=FECHA`);
  const fechas = r.map(x => fechaCobro(x.fields)).filter(Boolean).sort();
  return fechas[0] || '';
}
async function citasGastadas(inicio, pacId) {
  const conds = [`OR(${GASTA.map(e => `TRIM({ESTADO})='${e}'`).join(',')})`, `IS_AFTER({FECHA},DATEADD('${inicio}',-1,'days'))`];
  if (pacId) conds.push(`FIND('${pacId}',ARRAYJOIN({PacienteRec}))`);
  return todosAT(CITAS, `filterByFormula=${encodeURIComponent('AND(' + conds.join(',') + ')')}&fields[]=FECHA&fields[]=ESTADO&fields[]=PREF.&fields[]=RELACIÓN - CITA`);
}

async function saldoPaciente(pacId) {
  const inicio = await inicioControl();
  if (!inicio) return { activo: false };
  const [facs, citas, pac] = await Promise.all([
    facturasEmitidas(pacId), citasGastadas(inicio, pacId),
    fetch(`https://api.airtable.com/v0/${BASE_ID}/${PACIENTES_T}/${pacId}`, { headers: { Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}` } }).then(r => r.json())
  ]);
  const previo = Number((pac.fields || {})['SESIONES BONO PREVIO'] || 0);
  const pagadas = facs.reduce((t, r) => t + sesionesDe(r.fields), 0) + previo;
  const gastadas = citas.length;
  return { activo: true, inicio, pagadas, gastadas, saldo: pagadas - gastadas };
}

// Todos los pacientes con saldo negativo (sesiones hechas sin facturar)
async function sinFacturar() {
  const inicio = await inicioControl();
  if (!inicio) return { activo: false, lista: [] };
  const [facs, citas, previos] = await Promise.all([
    facturasEmitidas(''), citasGastadas(inicio, ''),
    todosAT(PACIENTES_T, `filterByFormula=${encodeURIComponent('{SESIONES BONO PREVIO}>0')}&fields[]=SESIONES BONO PREVIO`)
  ]);
  const s = {};
  const de = id => (s[id] = s[id] || { pagadas: 0, gastadas: 0, nombre: '', fisio: '', ultima: '' });
  previos.forEach(p => { de(p.id).pagadas += Number(p.fields['SESIONES BONO PREVIO'] || 0); });
  facs.forEach(r => { const id = r.fields['PacienteId']; if (id) de(id).pagadas += sesionesDe(r.fields); });
  citas.forEach(c => {
    const id = (c.fields['RELACIÓN - CITA'] || [])[0]; if (!id) return;
    const x = de(id); x.gastadas++;
    const f = c.fields['FECHA'] || '';
    if (f >= x.ultima) { x.ultima = f; const pf = c.fields['PREF.']; x.fisio = (pf && typeof pf === 'object' ? pf.name : pf) || ''; }
  });
  const lista = Object.entries(s).map(([id, x]) => ({ id, ...x, saldo: x.pagadas - x.gastadas })).filter(x => x.saldo < 0);
  if (lista.length) {
    const nombres = await todosAT(PACIENTES_T, `filterByFormula=${encodeURIComponent('OR(' + lista.map(x => `RECORD_ID()='${x.id}'`).join(',') + ')')}&fields[]=FULL NAME`).catch(() => []);
    const n = Object.fromEntries(nombres.map(p => [p.id, p.fields['FULL NAME'] || '']));
    lista.forEach(x => { x.nombre = n[x.id] || '—'; });
  }
  lista.sort((a, b) => a.saldo - b.saldo);
  return { activo: true, inicio, lista };
}



// ── Rendimiento por fisio (de las citas de CITAS) ──
// Huecos de un fisio en un día = horas desde su primera hasta su última cita de la agenda,
//   menos las horas que solo tienen comida o bloqueo. Ocupación = realizadas / huecos.
// Primera visita = primera cita REALIZADA del paciente en el centro.
//   Pack = ese mismo día se le emite una factura con 2 o más sesiones.
//   Repite = sin pack, pero tiene otra cita después. Se pierde = ni pack ni otra cita.
const NO_FISIO = /NO HAY FISIO|TODOS|\?\?|FIESTA|^$/i;
const nomFisio = v => { if (Array.isArray(v)) v = v[0]; v = v && typeof v === 'object' ? v.name : String(v || ''); return v.trim(); };
async function rendimiento(desde, hasta) {
  const pid = c => (c.fields['RELACIÓN - CITA'] || [])[0] || '';
  const est = c => String((c.fields['ESTADO'] && c.fields['ESTADO'].name) || c.fields['ESTADO'] || '').trim();
  const rango = `AND(IS_AFTER({FECHA},DATEADD('${desde}',-1,'days')),IS_BEFORE({FECHA},DATEADD('${hasta}',1,'days')))`;
  const [citas, fisiosT] = await Promise.all([
    todosAT(CITAS, `filterByFormula=${encodeURIComponent(rango)}&fields[]=ESTADO&fields[]=PREF.&fields[]=RELACIÓN - CITA&fields[]=FECHA&fields[]=HORA`),
    todosAT('tbl2mLUrnaKCFTs6g', 'fields[]=Name&fields[]=HORARIO').catch(() => [])
  ]);
  // HORARIO de cada fisio: «Lunes 9-14 16-20» → horas de trabajo por día de la semana (0 = domingo)
  const DIAS_N = ['dom', 'lun', 'mar', 'mi', 'jue', 'vie', 'sá'];
  const horario = {};
  fisiosT.forEach(f => {
    const n = String(f.fields['Name'] || '').split(' ')[0].toLowerCase(); const txt = String(f.fields['HORARIO'] || ''); if (!n || !txt.trim()) return;
    const h = {};
    txt.split('\n').forEach(l => {
      const t = l.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); const d = ['dom', 'lun', 'mar', 'mie', 'jue', 'vie', 'sab'].findIndex(x => t.startsWith(x)); if (d < 0) return;
      const horas = new Set(); (t.match(/(\d{1,2})(?:[:.]\d{2})?\s*-\s*(\d{1,2})(?:[:.]\d{2})?/g) || []).forEach(r => { const [a, b] = r.split('-').map(x => parseInt(x)); for (let k = a; k < b; k++) horas.add(k); });
      h[d] = horas;
    });
    horario[n] = h;
  });
  const R = {};
  const de = n => (R[n] = R[n] || { fisio: n, realizadas: 0, huecos: 0, perdidas: 0, noAsistio: 0, canceladas: 0, nuevos: [], packs: 0, repiten: 0, pierden: 0 });
  // Huecos por fisio y día, a partir de su agenda
  const BLOQ = /BLOQUEAD|COMIDA|^pen$|^09:00$/i;
  const agenda = {};
  citas.forEach(c => {
    const n = nomFisio(c.fields['PREF.']); if (NO_FISIO.test(n)) return;
    const m = String(c.fields['HORA'] || '').match(/(\d{1,2}):(\d{2})/); if (!m) return;
    const k = n + '|' + String(c.fields['FECHA']).slice(0, 10), h = +m[1];
    const a = (agenda[k] = agenda[k] || { n, fecha: String(c.fields['FECHA']).slice(0, 10), horas: {} });
    const x = (a.horas[h] = a.horas[h] || { libre: false, bloq: false, hecha: false });
    const e = est(c);
    if (BLOQ.test(e)) x.bloq = true; else x.libre = true;
    if (e === 'REALIZADA') x.hecha = true;
  });
  const disponible = x => x.hecha || (x.libre && !x.bloq);
  Object.values(agenda).forEach(a => {
    const hs = Object.keys(a.horas).map(Number).filter(h => disponible(a.horas[h]));
    if (!hs.length) return;
    // Con HORARIO: huecos = sus horas de ese día, menos comida/bloqueos de la agenda
    const hor = horario[a.n.toLowerCase()], dow = new Date(a.fecha + 'T12:00:00Z').getUTCDay();
    if (hor && hor[dow]) { let n = 0; hor[dow].forEach(h => { if (!a.horas[h] || disponible(a.horas[h])) n++; }); de(a.n).huecos += Math.max(n, hs.length); de(a.n).conHorario = true; return; }
    // Horas con agenda + huecos sueltos de 1 hora entre citas. Si hay 2 o más horas seguidas
    // sin nada (p. ej. el parón de un horario partido), no cuentan como huecos.
    const ini = Math.min(...hs), fin = Math.max(...hs);
    let n = 0;
    for (let h = ini; h <= fin; h++) {
      if (a.horas[h]) { if (disponible(a.horas[h])) n++; continue; }
      const solo = !!a.horas[h - 1] && !!a.horas[h + 1];
      if (solo) n++;
    }
    de(a.n).huecos += n;
  });
  const realizadas = citas.filter(c => est(c) === 'REALIZADA' && pid(c));
  citas.forEach(c => {
    const n = nomFisio(c.fields['PREF.']); if (NO_FISIO.test(n)) return;
    const e = est(c), x = de(n);
    if (e === 'REALIZADA') x.realizadas++; else if (e === 'CITA PERDIDA') x.perdidas++; else if (e === 'NO ASISTIÓ') x.noAsistio++; else if (e === 'CANCELADA') x.canceladas++;
  });
  // Primeras visitas: pacientes con realizada en el periodo y sin ninguna realizada antes
  const pacs = [...new Set(realizadas.map(c => pid(c)))];
  const previos = new Set();
  for (let i = 0; i < pacs.length; i += 40) {
    const lote = pacs.slice(i, i + 40);
    const r = await todosAT(CITAS, `filterByFormula=${encodeURIComponent(`AND(TRIM({ESTADO})='REALIZADA',IS_BEFORE({FECHA},'${desde}'),OR(${lote.map(id => `FIND('${id}',ARRAYJOIN({PacienteRec}))`).join(',')}))`)}&fields[]=RELACIÓN - CITA`);
    r.forEach(c => (c.fields['RELACIÓN - CITA'] || []).forEach(x => previos.add(x)));
  }
  const primera = {};
  realizadas.slice().sort((a, b) => String(a.fields['FECHA']).localeCompare(String(b.fields['FECHA']))).forEach(c => { const id = pid(c); if (!previos.has(id) && !primera[id]) primera[id] = c; });
  const nuevos = Object.keys(primera);
  if (nuevos.length) {
    const facs = await todosAT(FACTURAS, `filterByFormula=${encodeURIComponent(`AND({ESTADO}='Emitida',OR(${nuevos.map(id => `{PacienteId}='${id}'`).join(',')}))`)}`).catch(() => []);
    const despues = await todosAT(CITAS, `filterByFormula=${encodeURIComponent(`AND(OR(${['PENDIENTE', 'REALIZADA', 'CITA PERDIDA', 'NO ASISTIÓ', 'REPROGRAMADA', 'POR REAGENDAR'].map(e => `TRIM({ESTADO})='${e}'`).join(',')}),IS_AFTER({FECHA},'${desde}'),OR(${nuevos.map(id => `FIND('${id}',ARRAYJOIN({PacienteRec}))`).join(',')}))`)}&fields[]=RELACIÓN - CITA&fields[]=FECHA`).catch(() => []);
    nuevos.forEach(id => {
      const c = primera[id], dia = String(c.fields['FECHA']).slice(0, 10), n = nomFisio(c.fields['PREF.']);
      if (NO_FISIO.test(n)) return;
      const x = de(n); x.nuevos.push(id);
      const pack = facs.some(r => r.fields['PacienteId'] === id && fechaCobro(r.fields) === dia && sesionesDe(r.fields) >= 2);
      const vuelve = despues.some(r => (r.fields['RELACIÓN - CITA'] || []).includes(id) && String(r.fields['FECHA']).slice(0, 10) > dia);
      if (pack) x.packs++; else if (vuelve) x.repiten++; else x.pierden++;
    });
  }
  return Object.values(R).filter(x => x.realizadas || x.nuevos.length).map(x => ({ ...x, nuevos: x.nuevos.length })).sort((a, b) => b.realizadas - a.realizadas);
}

const saldo = { saldoPaciente, sinFacturar, facturasEmitidas, sesionesDe, fechaCobro, rendimiento, inicioControl };
module.exports = { leerSub, enviar, avisar, idValido, TABLAS, BASE_ID, saldo };
