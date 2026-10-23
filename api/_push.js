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
  if (pacId) conds.push(`{PacienteId}='${pacId}'`);
  return todosAT(CITAS, `filterByFormula=${encodeURIComponent('AND(' + conds.join(',') + ')')}&fields[]=PacienteId&fields[]=FECHA&fields[]=ESTADO&fields[]=PREF.&fields[]=RELACIÓN - CITA`);
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
    const id = c.fields['PacienteId'] || (c.fields['RELACIÓN - CITA'] || [])[0]; if (!id) return;
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


const saldo = { saldoPaciente, sinFacturar, facturasEmitidas, sesionesDe, fechaCobro };
module.exports = { leerSub, enviar, avisar, idValido, TABLAS, BASE_ID, saldo };
