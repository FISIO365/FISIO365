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
    // Si Airtable dice «demasiadas peticiones» (429) se espera y se reintenta; nunca se da por buena una página que ha fallado
    // (antes una página con error se tomaba como «no hay más» y salían menos citas de las que hay)
    let r, d;
    for (let i = 0; ; i++) {
      r = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${tabla}?${query}&pageSize=100${off ? '&offset=' + off : ''}`, { headers: { Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}` } });
      if (r.status === 429 && i < 6) { await new Promise(z => setTimeout(z, 700 * (i + 1))); continue; }
      break;
    }
    d = await r.json().catch(() => ({}));
    if (!r.ok || d.error || d.errors) throw new Error((d.error && (d.error.message || d.error)) || 'Airtable ' + r.status);
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
  // Pack pagado fuera del panel: cuenta lo que le quedaba cuando el panel empezó a contar (total − ya usadas antes)
  const previo = Math.max(0, Number((pac.fields || {})['SESIONES BONO PREVIO'] || 0) - Number((pac.fields || {})['BONO PREVIO YA USADAS'] || 0));
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
    todosAT(PACIENTES_T, `filterByFormula=${encodeURIComponent('{SESIONES BONO PREVIO}>0')}&fields[]=SESIONES BONO PREVIO&fields[]=BONO PREVIO YA USADAS`)
  ]);
  const s = {};
  const de = id => (s[id] = s[id] || { pagadas: 0, gastadas: 0, nombre: '', fisio: '', ultima: '' });
  previos.forEach(p => { de(p.id).pagadas += Math.max(0, Number(p.fields['SESIONES BONO PREVIO'] || 0) - Number(p.fields['BONO PREVIO YA USADAS'] || 0)); });
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
//   Ocupación = realizadas / huecos. Huecos = HORAS POR DÍA de los días que ha trabajado (con algo en su agenda).
//   Call-in y vídeos aparte, no cuentan.
// Reagendan = pacientes atendidos en el periodo que tienen otra cita después de su última sesión.
const NO_FISIO = /NO HAY FISIO|TODOS|\?\?|FIESTA|^$/i;
const nomFisio = v => { if (Array.isArray(v)) v = v[0]; v = v && typeof v === 'object' ? v.name : String(v || ''); return v.trim(); };
async function rendimiento(desde, hasta, _fresco, opts) {
  const pid = c => (c.fields['RELACIÓN - CITA'] || [])[0] || '';
  const est = c => String((c.fields['ESTADO'] && c.fields['ESTADO'].name) || c.fields['ESTADO'] || '').trim();
  const rango = `AND(IS_AFTER({FECHA},DATEADD('${desde}',-1,'days')),IS_BEFORE({FECHA},DATEADD('${hasta}',1,'days')))`;
  const [citas, fisiosT, ausT] = await Promise.all([
    todosAT(CITAS, `filterByFormula=${encodeURIComponent(rango)}&fields[]=ESTADO&fields[]=PREF.&fields[]=RELACIÓN - CITA&fields[]=FECHA&fields[]=HORA${opts && opts.dinero ? '&fields[]=IMPORTE SESIÓN' : ''}`),
    todosAT('tbl2mLUrnaKCFTs6g', 'fields[]=Name&fields[]=HORAS SEMANA&fields[]=HORAS POR DÍA&fields[]=CONTROL HORAS').catch(() => []),
    // Cambios puntuales de horario (Administración › Vacaciones y horarios)
    todosAT('tblkezm4bTQ4jJf1X', `filterByFormula=${encodeURIComponent(`AND(NOT(IS_BEFORE({HASTA},'${desde}')),NOT(IS_AFTER({DESDE},'${hasta}')))`)}`).catch(() => [])
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
  const diasCon = {};
  // Días trabajados = días con al menos una sesión hecha (REALIZADA). Los demás no cuentan (no estaba trabajando).
  citas.forEach(c => { if (est(c) !== 'REALIZADA' || !pid(c)) return; const n = nomFisio(c.fields['PREF.']).toLowerCase(); (diasCon[n] = diasCon[n] || new Set()).add(String(c.fields['FECHA']).slice(0, 10)); });
  // Horas de un día concreto: su horario, cambiado por lo apuntado en Vacaciones y horarios («trabaja otro horario» = esas horas; «falta unas horas» = se restan; todo el día = 0)
  const aus = (ausT || []).map(r => ({ fisio: String(r.fields.FISIO || ''), desde: r.fields.DESDE || '', hasta: r.fields.HASTA || r.fields.DESDE || '', tipo: (r.fields.TIPO && r.fields.TIPO.name) || r.fields.TIPO || '', hd: r.fields['HORA DESDE'] || '', hh: r.fields['HORA HASTA'] || '' }));
  const durH = x => { const [h1, m1] = String(x.hd).split(':').map(Number), [h2, m2] = String(x.hh).split(':').map(Number); return Math.max(0, (h2 * 60 + m2 - h1 * 60 - m1) / 60); };
  const horasDe = (n, f) => { const v = horasDia[n]; let h = v ? v[new Date(f + 'T12:00:00Z').getUTCDay()] : 0;
    aus.filter(x => x.desde <= f && x.hasta >= f && (x.fisio === 'Toda la clínica' || x.fisio.toLowerCase() === n)).forEach(x => { if (x.tipo === 'Cambio de horario' && x.hd) h = durH(x); else if (x.hd) h = Math.max(0, h - durH(x)); else h = 0; });
    return h; };
  // Sesiones hechas por fisio y día: si un día hace más que su horario, ese día cuenta como las horas que hizo (100 %)
  const realDia = {}; citas.forEach(c => { if (est(c) !== 'REALIZADA' || !pid(c)) return; const n = nomFisio(c.fields['PREF.']).toLowerCase(), f = String(c.fields['FECHA']).slice(0, 10); (realDia[n] = realDia[n] || {})[f] = ((realDia[n] || {})[f] || 0) + 1; });
  const capacidad = n => { if (!horasDia[n]) return 0; let t = 0; (diasCon[n] || new Set()).forEach(f => { t += Math.max(horasDe(n, f), (realDia[n] || {})[f] || 0); }); return Math.round(t); };
  // Control de horas día a día (fisios con «CONTROL HORAS»): horas hechas (sesiones + call-in + vídeos) frente a las que le tocaban
  const control = new Set(fisiosT.filter(f => f.fields['CONTROL HORAS']).map(f => String(f.fields['Name'] || '').split(' ')[0].toLowerCase()));
  const hechasDia = {}; // fisio -> {fecha: horas}
  citas.forEach(c => { const e = est(c); if (!['REALIZADA', 'CALL-IN', 'VIDEOS', 'VÍDEOS'].includes(e) || (e === 'REALIZADA' && !pid(c))) return; const n = nomFisio(c.fields['PREF.']).toLowerCase(); const f = String(c.fields['FECHA']).slice(0, 10); (hechasDia[n] = hechasDia[n] || {})[f] = ((hechasDia[n] || {})[f] || 0) + 1; });
  const hoyISO = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  // Detalle de cada día para el informe de horas: sesiones, call-in, vídeos, faltas, primera y última hora con algo hecho
  const det = {}; const hh = x => { const m = String(x || '').match(/(\d{1,2}):(\d{2})/); return m ? m[1].padStart(2, '0') + ':' + m[2] : ''; };
  citas.forEach(c => { const e = est(c), n = nomFisio(c.fields['PREF.']).toLowerCase(), f = String(c.fields['FECHA']).slice(0, 10), x = ((det[n] = det[n] || {})[f] = det[n][f] || { ses: 0, callin: 0, videos: 0, noVino: 0, canceladas: 0, ini: '', fin: '' });
    if (e === 'REALIZADA' && pid(c)) x.ses++; else if (e === 'CALL-IN') x.callin++; else if (e === 'VIDEOS' || e === 'VÍDEOS') x.videos++; else if (e === 'NO ASISTIÓ' || e === 'CITA PERDIDA') x.noVino++; else if (e === 'CANCELADA') x.canceladas++; else return;
    if (!['REALIZADA', 'CALL-IN', 'VIDEOS', 'VÍDEOS'].includes(e)) return; const h = hh(c.fields['HORA']); if (!h) return; if (!x.ini || h < x.ini) x.ini = h; if (!x.fin || h > x.fin) x.fin = h; });
  const din = opts && opts.dinero ? await valorSesiones(citas, hasta, opts.precios || {}, opts) : null;
  if (din) din.lista.forEach(q => { const x = ((det[q.n] = det[q.n] || {})[q.f] = det[q.n][q.f] || { ses: 0, callin: 0, videos: 0, noVino: 0, canceladas: 0, ini: '', fin: '' }); if (q.e !== 'REALIZADA') return; x.eur = (x.eur || 0) + (q.eur || 0); if (!q.real) x.eurEst = (x.eurEst || 0) + (q.eur || 0); });
  const cambioDe = (n, f) => aus.filter(x => x.desde <= f && x.hasta >= f && (x.fisio === 'Toda la clínica' || x.fisio.toLowerCase() === n)).map(x => x.tipo === 'Cambio de horario' && x.hd ? `Otro horario ${x.hd}–${x.hh}` : x.hd ? `Falta ${x.hd}–${x.hh}` : (x.tipo || 'No trabaja') + (x.fisio === 'Toda la clínica' ? ' (clínica)' : '')).join(' · ');
  const diario = n => {
    if (!horasDia[n]) return null;
    // Solo días cerrados: hoy todavía no ha terminado y no puede salir como «no vino» ni como horas de menos
    const ayerISO = new Date(new Date(hoyISO + 'T12:00:00Z').getTime() - 864e5).toISOString().slice(0, 10);
    const v = horasDia[n], out = [], fin = hasta < hoyISO ? hasta : ayerISO;
    for (let d = new Date(desde + 'T12:00:00Z'); d <= new Date(fin + 'T12:00:00Z'); d = new Date(d.getTime() + 864e5)) {
      const f = d.toISOString().slice(0, 10), toca = horasDe(n, f), hechas = (hechasDia[n] || {})[f] || 0, trabajo = (diasCon[n] || new Set()).has(f);
      const cambio = cambioDe(n, f), dd = (det[n] || {})[f] || {};
      if (!toca && !hechas && !cambio) continue;
      out.push({ fecha: f, toca, base: v[d.getUTCDay()], hechas, libre: toca > 0 && !trabajo, cambio, ses: dd.ses || 0, callin: dd.callin || 0, videos: dd.videos || 0, noVino: dd.noVino || 0, canceladas: dd.canceladas || 0, eur: Math.round((dd.eur || 0) * 100) / 100, eurEst: Math.round((dd.eurEst || 0) * 100) / 100, ini: dd.ini || '', fin: dd.fin ? (() => { const [a, b] = dd.fin.split(':').map(Number); return String(a + 1).padStart(2, '0') + ':' + String(b).padStart(2, '0'); })() : '' });
    }
    return out;
  };
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
    const r = await todosAT(PACIENTES_T, `filterByFormula=${encodeURIComponent('OR(' + ids.slice(i, i + 40).map(id => `RECORD_ID()='${id}'`).join(',') + ')')}&fields[]=FULL NAME&fields[]=WHATSAPP&fields[]=POR QUÉ NO REAGENDA&fields[]=POR QUÉ FECHA&fields[]=POR QUÉ FISIO`).catch(() => []);
    r.forEach(p => { nombres[p.id] = { nombre: p.fields['FULL NAME'] || '—', tel: p.fields['WHATSAPP'] || '', nota: p.fields['POR QUÉ NO REAGENDA'] || '', notaFecha: p.fields['POR QUÉ FECHA'] || '', notaFisio: p.fields['POR QUÉ FISIO'] || '' }; });
  }
  Object.values(R).forEach(x => { x.lista = x.lista.map(p => ({ ...p, ...(nombres[p.id] || { nombre: '—' }) })).sort((a, b) => b.ultima.localeCompare(a.ultima)); });
  return Object.values(R).filter(x => x.realizadas || x.callin || x.videos).map(x => { const k = x.fisio.toLowerCase(); const r = { ...x, huecos: capacidad(k), sinHoras: !horasDia[k], dias: diario(k), control: control.has(k) };
    if (din) { const L = din.lista.filter(q => q.n === k), S = L.filter(q => q.e === 'REALIZADA'), P = L.filter(q => q.e !== 'REALIZADA'), su = a => Math.round(a.reduce((t, q) => t + (q.eur || 0), 0) * 100) / 100;
      r.dinero = { total: su(S), real: su(S.filter(q => q.real)), estimado: su(S.filter(q => !q.real)), sesReal: S.filter(q => q.real).length, sesEst: S.filter(q => !q.real && q.eur).length, sinPrecio: S.filter(q => !q.eur).length, perdidas: P.length, perdidasEur: su(P), sesiones: L.map(({ n, ...q }) => q) }; }
    return r; }).sort((a, b) => b.realizadas - a.realizadas);
}

// ── Dinero que representa cada sesión hecha (informe de horas de cada fisio) ──
// Cada sesión vale lo que pagó ese paciente por ella:
//   · importe puesto a mano en la cita («IMPORTE SESIÓN») → manda siempre
//   · si no, gasta por orden de fecha una de las sesiones que el paciente ha pagado:
//       cobros del panel (FACTURAS emitidas) + tickets de Holded (desde que se usa Holded) que no vienen del panel.
//       Precio por sesión = lo que pagó ÷ sesiones de ese cobro (packs incluidos). Un cobro vale para sesiones desde 14 días antes.
//   · si no hay cobro que le toque → estimado: el último precio que pagó ese paciente o la tarifa de «Sesión de fisioterapia»
async function valorSesiones(citasRango, hasta, precios, opts) {
  opts = opts || {};
  const pid = c => (c.fields['RELACIÓN - CITA'] || [])[0] || '';
  const est = c => String((c.fields['ESTADO'] && c.fields['ESTADO'].name) || c.fields['ESTADO'] || '').trim();
  const hora = c => { const m = String(c.fields['HORA'] || '').match(/(\d{1,2}):(\d{2})/); return m ? m[1].padStart(2, '0') + ':' + m[2] : ''; };
  const num = v => Number(String(v == null ? '' : v).replace(',', '.')) || 0;
  const gast = citasRango.filter(c => GASTA.includes(est(c)) && pid(c));
  const pacs = [...new Set(gast.map(pid))];
  if (!pacs.length) return { lista: [] };
  const lotes = async (fn) => { let out = []; for (let i = 0; i < pacs.length; i += 40) out = out.concat(await fn(pacs.slice(i, i + 40))); return out; };
  const ini = [await inicioControl().catch(() => ''), opts.desdeCobros || ''].filter(Boolean).sort()[0] || '';
  const [facs, pacT, previas] = await Promise.all([
    facturasEmitidas('').catch(() => []),
    lotes(ids => todosAT(PACIENTES_T, `filterByFormula=${encodeURIComponent('OR(' + ids.map(id => `RECORD_ID()='${id}'`).join(',') + ')')}&fields[]=FULL NAME&fields[]=SESIONES BONO PREVIO&fields[]=BONO PREVIO YA USADAS&fields[]=DNI&fields[]=EMAIL&fields[]=WHATSAPP&fields[]=TELF`).catch(() => [])),
    ini ? lotes(ids => todosAT(CITAS, `filterByFormula=${encodeURIComponent(`AND(OR(${GASTA.map(e => `TRIM({ESTADO})='${e}'`).join(',')}),IS_AFTER({FECHA},DATEADD('${ini}',-1,'days')),IS_BEFORE({FECHA},DATEADD('${hasta}',1,'days')),OR(${ids.map(id => `FIND('${id}',ARRAYJOIN({PacienteRec}))`).join(',')}))`)}&fields[]=FECHA&fields[]=HORA&fields[]=ESTADO&fields[]=RELACIÓN - CITA&fields[]=IMPORTE SESIÓN`).catch(() => [])) : []
  ]);
  const freq = {}; facs.forEach(r => { const f = r.fields; if (String(f['CONCEPTO 1'] || '').trim() === 'Sesión de fisioterapia' && num(f['Nº SESIONES 1']) === 1) { const p = num(f['PRECIO SESIÓN 1']); if (p) freq[p] = (freq[p] || 0) + 1; } });
  const ref = num(precios['Sesión de fisioterapia']) || Number(Object.keys(freq).sort((a, b) => freq[b] - freq[a])[0] || 0);
  const nombre = {}, cola = {}, ultimoP = {};
  const mete = (id, u) => { (cola[id] = cola[id] || []).push(u); if (u.p) ultimoP[id] = u.p; };
  pacT.forEach(p => { nombre[p.id] = p.fields['FULL NAME'] || '—'; const prev = Math.max(0, num(p.fields['SESIONES BONO PREVIO']) - num(p.fields['BONO PREVIO YA USADAS'])); for (let i = 0; i < prev; i++) mete(p.id, { f: '', p: 0, o: 'Pack pagado antes' }); });
  // Cobros del panel
  const yaHolded = new Set();
  facs.forEach(r => { const f = r.fields, id = f['PacienteId']; if (f['HOLDED ID']) yaHolded.add(String(f['HOLDED ID'])); if (!id || !pacs.includes(id)) return; const fc = fechaCobro(f);
    [[f['CONCEPTO 1'], f['Nº SESIONES 1'], f['PRECIO SESIÓN 1']], [f['CONCEPTO 2'], f['Nº SESIONES 2'], f['PRECIO SESIÓN 2']]].forEach(([c, n, p]) => { if (!/^Sesi/i.test(String(c || ''))) return;
      n = num(n); p = num(p); for (let i = 0; i < n; i++) mete(id, { f: fc, p, o: 'Cobro del panel' + (n > 1 ? ` · pack de ${n}` : '') }); }); });
  // Tickets de Holded hechos fuera del panel
  if (opts.cobros) { try { const h = await opts.cobros(pacT, yaHolded); Object.entries(h).forEach(([id, us]) => us.forEach(u => mete(id, u))); } catch (e) { console.log('cobros Holded', e.message); } }
  Object.values(cola).forEach(q => q.sort((a, b) => a.f.localeCompare(b.f)));
  const mas14 = f => new Date(new Date(f + 'T12:00:00Z').getTime() + 14 * 864e5).toISOString().slice(0, 10);
  const toma = {}, manual = {};
  previas.concat(citasRango.filter(c => GASTA.includes(est(c)) && pid(c) && !previas.some(x => x.id === c.id)))
    .sort((a, b) => (String(a.fields['FECHA']).slice(0, 10) + hora(a) + a.id).localeCompare(String(b.fields['FECHA']).slice(0, 10) + hora(b) + b.id))
    .forEach(c => { if (c.fields['IMPORTE SESIÓN'] != null && c.fields['IMPORTE SESIÓN'] !== '') { manual[c.id] = num(c.fields['IMPORTE SESIÓN']); return; }
      const q = cola[pid(c)]; if (!q || !q.length) return; const lim = mas14(String(c.fields['FECHA']).slice(0, 10)); const k = q.findIndex(u => u.f <= lim); if (k >= 0) toma[c.id] = q.splice(k, 1)[0]; });
  const lista = gast.map(c => { const id = pid(c), f = String(c.fields['FECHA']).slice(0, 10), u = toma[c.id];
    let eur = 0, real = false, o, man = false;
    if (c.id in manual || (c.fields['IMPORTE SESIÓN'] != null && c.fields['IMPORTE SESIÓN'] !== '')) { eur = c.id in manual ? manual[c.id] : num(c.fields['IMPORTE SESIÓN']); real = true; man = true; o = 'Puesto a mano'; }
    else if (u && u.p) { eur = u.p; real = true; o = u.o; }
    else { eur = ultimoP[id] || ref || 0; o = u ? u.o : 'Sin cobro encontrado'; }
    return { id: c.id, n: nomFisio(c.fields['PREF.']).toLowerCase(), f, h: hora(c), e: est(c), pac: nombre[id] || '—', eur, real, man, o };
  }).sort((a, b) => (a.f + a.h).localeCompare(b.f + b.h));
  return { lista, ref };
}

const saldo = { saldoPaciente, sinFacturar, facturasEmitidas, sesionesDe, fechaCobro, rendimiento, inicioControl };
module.exports = { leerSub, enviar, avisar, idValido, TABLAS, BASE_ID, saldo };
