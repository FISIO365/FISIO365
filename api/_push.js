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
//   Ocupación = realizadas / huecos. Huecos = HORAS POR DÍA de los días que ha trabajado, menos sus horas de call-in y vídeos
//   (días con algo en su agenda; festivos y vacaciones no cuentan).
// Reagendan = pacientes atendidos en el periodo que tienen otra cita después de su última sesión.
const NO_FISIO = /NO HAY FISIO|TODOS|\?\?|FIESTA|^$/i;
const nomFisio = v => { if (Array.isArray(v)) v = v[0]; v = v && typeof v === 'object' ? v.name : String(v || ''); return v.trim(); };
async function rendimiento(desde, hasta) {
  const pid = c => (c.fields['RELACIÓN - CITA'] || [])[0] || '';
  const est = c => String((c.fields['ESTADO'] && c.fields['ESTADO'].name) || c.fields['ESTADO'] || '').trim();
  const rango = `AND(IS_AFTER({FECHA},DATEADD('${desde}',-1,'days')),IS_BEFORE({FECHA},DATEADD('${hasta}',1,'days')))`;
  const [citas, fisiosT] = await Promise.all([
    todosAT(CITAS, `filterByFormula=${encodeURIComponent(rango)}&fields[]=ESTADO&fields[]=PREF.&fields[]=RELACIÓN - CITA&fields[]=FECHA&fields[]=HORA`),
    todosAT('tbl2mLUrnaKCFTs6g', 'fields[]=Name&fields[]=HORAS SEMANA&fields[]=HORAS POR DÍA').catch(() => [])
  ]);
  // Huecos = horas de cada día de la semana («HORAS POR DÍA» del fisio; 1 h = 1 sesión) sumadas en los días del periodo.
  // Si no tiene «HORAS POR DÍA», se reparte «HORAS SEMANA» de lunes a viernes.
  const DSEM = ['dom', 'lun', 'mar', 'mie', 'jue', 'vie', 'sab'];
  const horasDia = {}; // fisio -> [h dom, h lun, ...]
  fisiosT.forEach(f => {
    const n = String(f.fields['Name'] || '').split(' ')[0].toLowerCase(); if (!n) return;
    const v = [0, 0, 0, 0, 0, 0, 0]; let alguno = false;
    String(f.fields['HORAS POR DÍA'] || '').split('\n').forEach(l => {
      const t = l.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const d = DSEM.findIndex(x => t.startsWith(x)); const m = t.match(/(\d+(?:[.,]\d+)?)/);
      if (d >= 0 && m) { v[d] = parseFloat(m[1].replace(',', '.')); alguno = true; }
    });
    if (!alguno && Number(f.fields['HORAS SEMANA']) > 0) { const h = Number(f.fields['HORAS SEMANA']) / 5; for (let d = 1; d <= 5; d++) v[d] = h; alguno = true; }
    if (alguno) horasDia[n] = v;
  });
  // Solo cuentan los días en que el fisio tiene algo en la agenda (festivos, vacaciones o días libres no suman huecos)
  const diasCon = {}; // fisio -> Set(fecha)
  citas.forEach(c => { if (/BLOQUEAD|COMIDA|REPROGRAMADA|POR REAGENDAR/i.test(est(c))) return; const n = nomFisio(c.fields['PREF.']).toLowerCase(); (diasCon[n] = diasCon[n] || new Set()).add(String(c.fields['FECHA']).slice(0, 10)); });
  const capacidad = n => { const v = horasDia[n]; if (!v) return 0; let t = 0; (diasCon[n] || new Set()).forEach(f => { t += v[new Date(f + 'T12:00:00Z').getUTCDay()]; }); return Math.round(t); };
  const R = {};
  const cuenta = n => true;
  const de = n => (R[n] = R[n] || { fisio: n, realizadas: 0, callin: 0, videos: 0, huecos: 0, perdidas: 0, noAsistio: 0, canceladas: 0, atendidos: 0, reagendan: 0, lista: [] });
  const realizadas = citas.filter(c => est(c) === 'REALIZADA' && pid(c));
  citas.forEach(c => {
    const n = nomFisio(c.fields['PREF.']); if (NO_FISIO.test(n) || !cuenta(n)) return;
    const e = est(c), x = de(n);
    if (e === 'REALIZADA') x.realizadas++; else if (e === 'CALL-IN') x.callin++; else if (e === 'VIDEOS' || e === 'VÍDEOS') x.videos++; else if (e === 'CITA PERDIDA') x.perdidas++; else if (e === 'NO ASISTIÓ') x.noAsistio++; else if (e === 'CANCELADA') x.canceladas++;
  });
  // Reagendan: de los pacientes que ha atendido en el periodo, cuántos tienen otra cita después
  // de su última sesión con él en el periodo (pendiente, realizada, perdida o no asistió).
  const ultima = {}; // fisio|paciente -> última fecha atendida en el periodo
  realizadas.forEach(c => { const n = nomFisio(c.fields['PREF.']); if (NO_FISIO.test(n)) return; const k = n + '|' + pid(c), f = String(c.fields['FECHA']).slice(0, 10); if (!ultima[k] || f > ultima[k]) ultima[k] = f; });
  const pacs = [...new Set(realizadas.map(c => pid(c)))];
  const futuras = {}; // paciente -> fecha más lejana con cita
  for (let i = 0; i < pacs.length; i += 40) {
    const lote = pacs.slice(i, i + 40);
    const r = await todosAT(CITAS, `filterByFormula=${encodeURIComponent(`AND(OR(${['PENDIENTE', 'REALIZADA', 'CITA PERDIDA', 'NO ASISTIÓ'].map(e => `TRIM({ESTADO})='${e}'`).join(',')}),IS_AFTER({FECHA},'${desde}'),OR(${lote.map(id => `FIND('${id}',ARRAYJOIN({PacienteRec}))`).join(',')}))`)}&fields[]=RELACIÓN - CITA&fields[]=FECHA`).catch(() => []);
    r.forEach(c => { const f = String(c.fields['FECHA']).slice(0, 10); (c.fields['RELACIÓN - CITA'] || []).forEach(id => { if (!futuras[id] || f > futuras[id]) futuras[id] = f; }); });
  }
  const sinCita = [];
  Object.entries(ultima).forEach(([k, f]) => {
    const [n, id] = k.split('|'); const x = de(n);
    x.atendidos++;
    if (futuras[id] && futuras[id] > f) x.reagendan++; else { x.lista.push({ id, ultima: f }); sinCita.push(id); }
  });
  // Nombres de los que no han reagendado
  const nombres = {};
  const ids = [...new Set(sinCita)];
  for (let i = 0; i < ids.length; i += 40) {
    const r = await todosAT(PACIENTES_T, `filterByFormula=${encodeURIComponent('OR(' + ids.slice(i, i + 40).map(id => `RECORD_ID()='${id}'`).join(',') + ')')}&fields[]=FULL NAME&fields[]=WHATSAPP`).catch(() => []);
    r.forEach(p => { nombres[p.id] = { nombre: p.fields['FULL NAME'] || '—', tel: p.fields['WHATSAPP'] || '' }; });
  }
  Object.values(R).forEach(x => { x.lista = x.lista.map(p => ({ ...p, ...(nombres[p.id] || { nombre: '—' }) })).sort((a, b) => b.ultima.localeCompare(a.ultima)); });
  return Object.values(R).filter(x => x.realizadas || x.callin || x.videos).map(x => { const k = x.fisio.toLowerCase(); return { ...x, huecos: Math.max(0, capacidad(k) - x.callin - x.videos), sinHoras: !horasDia[k] }; }).sort((a, b) => b.realizadas - a.realizadas);
}

const saldo = { saldoPaciente, sinFacturar, facturasEmitidas, sesionesDe, fechaCobro, rendimiento, inicioControl };
module.exports = { leerSub, enviar, avisar, idValido, TABLAS, BASE_ID, saldo };
