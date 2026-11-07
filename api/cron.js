"use strict";
// Recordatorios: vercel.json lo lanza a las 17 UTC (19 h en verano, 18 h en invierno).
// Resumen de facturación: /api/cron?resumen=1 a las 7 UTC (8 h en invierno, 9 h en verano).
//  1. Recordatorio de cita: 2 días antes, a quien tiene cita PENDIENTE pasado mañana
//     (así aún puede cambiarla o anularla con más de 24 h de margen)
//  2. Recordatorio de ejercicios, todos los días: a quien hoy aún no los ha hecho
//     (y los ha hecho en el último mes; si ese día le llega el de la cita, solo le llega ese)
const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const { enviar, BASE_ID, TABLAS } = require('./_push');
const { saldo } = require('./_push');
const SCH = require('./schedule'); // reporte diario de los fisios y Holded (mismas funciones que el panel)
const CITAS_TABLE = 'tblTPlcuiSjQngkaD';
const TAREAS_TABLE = 'tblIXYE5ToRNY7MN4'; // cada vez que un paciente pulsa «He terminado por hoy»
const AT = { Authorization: `Bearer ${AIRTABLE_TOKEN}` };

// Fecha en Madrid, desplazada n días, como YYYY-MM-DD; y día de la semana (0 = domingo)
function madrid(n = 0) {
  const d = new Date(Date.now() + n * 864e5);
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' }).formatToParts(d).map(x => [x.type, x.value]));
  return { fecha: `${p.year}-${p.month}-${p.day}`, dia: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday) };
}
const horaMadrid = () => +new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', hour: '2-digit', hour12: false }).format(new Date());
async function todos(tabla, query) {
  let recs = [], off = '';
  do {
    const r = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${tabla}?${query}&pageSize=100${off ? '&offset=' + off : ''}`, { headers: AT });
    const d = await r.json();
    if (d.error) throw new Error(d.error.message || d.error.type || 'Airtable');
    recs = recs.concat(d.records || []); off = d.offset || '';
  } while (off);
  return recs;
}
const fisioDe = v => { if (!v) return ''; if (Array.isArray(v)) v = v[0]; v = typeof v === 'object' ? v.name : String(v); return /^rec|NO HAY|TODOS|\?\?/i.test(v) ? '' : v; };
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];


const eur = n => Number(n || 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
const escH = t => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const pct = (a, b) => b ? Math.round(a * 100 / b) + '%' : '—';
function tablaRendimiento(lista, titulo, conOcup) {
  if (!lista.length) return '';
  const th = t => `<th style="text-align:left;padding:6px 6px 6px 0;font-size:11px;color:#7d6a60;font-weight:600;border-bottom:1px solid #eee">${t}</th>`;
  const td = (t, b) => `<td style="padding:8px 6px 8px 0;border-bottom:1px solid #f1ede9;${b ? 'font-weight:600' : ''}">${t}</td>`;
  const T = lista.reduce((a, x) => { a.realizadas += x.realizadas; a.atendidos += x.atendidos; a.reagendan += x.reagendan; if (!x.sinHoras) { ['huecos', 'noAsistio', 'perdidas'].forEach(k => a[k] += x[k]); a.realOcup += x.realizadas; } return a; }, { fisio: 'Total', realizadas: 0, realOcup: 0, huecos: 0, atendidos: 0, reagendan: 0, noAsistio: 0, perdidas: 0 });
  const fila = (x, tot) => x.sinHoras ? `<tr>${td(escH(x.fisio), true)}${td(x.realizadas)}${conOcup ? td('') : ''}${td(x.atendidos)}${td(pct(x.reagendan, x.atendidos))}${td('')}</tr>`
    : `<tr>${td(escH(x.fisio), true)}${td(conOcup ? (tot ? x.realOcup : x.realizadas) + ' / ' + x.huecos + (tot && x.realOcup !== x.realizadas ? ' (' + x.realizadas + ' total)' : '') : x.realizadas)}${conOcup ? td(pct(tot ? x.realOcup : x.realizadas, x.huecos)) : ''}${td(x.atendidos)}${td(pct(x.reagendan, x.atendidos))}${td(x.noAsistio + x.perdidas)}</tr>`;
  const noReag = lista.filter(x => x.lista && x.lista.length).map(x => `<p style="margin:8px 0 0;font-size:12.5px"><b>${escH(x.fisio)}</b> · no han reagendado: ${x.lista.map(p => escH(p.nombre)).join(', ')}</p>`).join('');
  return `<h3 style="margin:24px 0 8px;font-size:15px">${titulo}</h3><div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px;white-space:nowrap"><tr>${th('Fisio')}${th(conOcup ? 'Hechas / huecos' : 'Hechas')}${conOcup ? th('Ocupación') : ''}${th('Atendidos')}${th('Reagendan')}${th('Faltas')}</tr>${lista.map(x => fila(x)).join('')}${lista.length > 1 ? fila(T, true) : ''}</table></div>${noReag}`;
}
const masDias = (f, n) => { const d = new Date(f + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const diaDe = f => ({ fecha: f, dia: new Date(f + 'T12:00:00Z').getUTCDay() });
// Todos los datos de un día cerrado (lo usan el email y la sección «Reporte diario» del panel)
async function datosDia(ayer, panel) {
  const sf = await saldo.sinFacturar();
  const rendDia = await saldo.rendimiento(ayer.fecha, ayer.fecha);
  // Semana: el domingo (lo que se envía el lunes) y, en el panel, también al ver un viernes
  const conSemana = ayer.dia === 0 || (panel && ayer.dia === 5);
  const rendSemana = conSemana ? await saldo.rendimiento(masDias(ayer.fecha, ayer.dia === 0 ? -6 : -4), ayer.fecha) : null;
  const citas = await todos(CITAS_TABLE, `filterByFormula=${encodeURIComponent(`DATETIME_FORMAT({FECHA},'YYYY-MM-DD')='${ayer.fecha}'`)}&fields[]=ESTADO&fields[]=PREF.&fields[]=RELACIÓN - CITA&fields[]=HORA&fields[]=your-name`);
  const est = c => String((c.fields['ESTADO'] && c.fields['ESTADO'].name) || c.fields['ESTADO'] || '').trim();
  const hechas = citas.filter(c => ['REALIZADA', 'CITA PERDIDA'].includes(est(c))).length;
  const sinMarcar = citas.filter(c => est(c) === 'PENDIENTE' && (c.fields['RELACIÓN - CITA'] || []).length);
  const facsTodas = await saldo.facturasEmitidas('');
  const delDia = facsTodas.filter(r => saldo.fechaCobro(r.fields) === ayer.fecha);
  // Packs «con factura por sesión»: el cobro entra en caja el día que paga (sin ticket); los tickets de cada sesión no son dinero nuevo
  const facs = delDia.filter(r => !(r.fields['POR SESION'] && !r.fields['EN PACK'])), cobros = delDia.filter(r => !(r.fields['POR SESION'] && r.fields['EN PACK']));
  const canceladas = citas.filter(c => /CANCEL|NO ASIST|PERDIDA/i.test(est(c)) && (c.fields['RELACIÓN - CITA'] || []).length);
  // Caja por forma de pago
  const caja = {}; cobros.forEach(r => { const m = (r.fields['MODO DE PAGO'] && r.fields['MODO DE PAGO'].name) || r.fields['MODO DE PAGO'] || 'Sin indicar';
    // «Varias»: cada parte a su forma de pago (PAGO DESGLOSE = «Tarjeta: 300 · Efectivo: 190»)
    const D = String(r.fields['PAGO DESGLOSE'] || '').split('·').map(x => x.split(':')).filter(x => x.length === 2 && Number(x[1]) > 0);
    if (m === 'Varias' && D.length) D.forEach(([k, v]) => { k = k.trim(); caja[k] = (caja[k] || 0) + Number(v); });
    else caja[m] = (caja[m] || 0) + Number(r.fields['TOTAL'] || 0); });
  // Reporte diario de cada fisio (lo que marcó y lo que ve el panel)
  let rep = {}, envs = {};
  try { [rep, envs] = await Promise.all([SCH.cierreDia(ayer.fecha), SCH.cierresEnviados(ayer.fecha)]); } catch (e) { console.log('reporte', e.message); }
  // Holded: borradores por aprobar y tickets de ayer hechos fuera del panel
  let borradores = [], fuera = [];
  if (SCH.holdedApi && SCH.holdedApi.activo()) {
    try { borradores = await SCH.holdedApi.holdedTodos('/sales-receipts?limit=100&approval_status=draft', 5); } catch (e) {}
    try { const deAyer = await SCH.holdedApi.holdedTodos(`/sales-receipts?limit=100&start_date=${ayer.fecha}&end_date=${ayer.fecha}`, 5);
      const ids = new Set(facsTodas.map(r => String(r.fields['HOLDED ID'] || '')).filter(Boolean)); fuera = deAyer.filter(d => !ids.has(d.id)); } catch (e) {}
  }
  const total = facs.reduce((t, r) => t + Number(r.fields['TOTAL'] || 0), 0);
  return { sf, rendDia, rendSemana, citas, est, hechas, sinMarcar, facs, canceladas, caja, rep, envs, borradores, fuera, total };
}
// Para el panel: lo mismo en datos simples
async function reporteDia(fecha) {
  const ayer = diaDe(fecha), D = await datosDia(ayer, true);
  // Nombres de los pacientes (el campo de nombre de la cita a veces va vacío) y, de los que cancelaron o no vinieron, si ya tienen otra cita o están en «Por llamar»
  const pids = [...new Set([...D.sinMarcar, ...D.canceladas].map(c => (c.fields['RELACIÓN - CITA'] || [])[0]).filter(Boolean))];
  const nomP = {}, prox = {}, enLlamar = new Set(), cerrado = {}, vino = new Set();
  if (pids.length) {
    const orIds = k => 'OR(' + pids.slice(0, 60).map(id => k(id)).join(',') + ')';
    const [ps, fut, segs, ests, prev] = await Promise.all([
      todos(TABLAS.paciente, `filterByFormula=${encodeURIComponent(orIds(id => `RECORD_ID()='${id}'`))}&fields[]=${encodeURIComponent('FULL NAME')}&fields[]=ESTADO`).catch(() => []),
      todos(CITAS_TABLE, `filterByFormula=${encodeURIComponent(`AND(IS_AFTER({FECHA},'${fecha}'),OR(TRIM({ESTADO})='PENDIENTE',TRIM({ESTADO})='CITA DUDOSA'),${orIds(id => `FIND('${id}',ARRAYJOIN({PacienteRec}))`)})`)}&fields[]=FECHA&fields[]=${encodeURIComponent('RELACIÓN - CITA')}`).catch(() => []),
      todos('tblu9YxiktpAh5w87', `filterByFormula=${encodeURIComponent(`AND(NOT({HECHO}),${orIds(id => `FIND('${id}',ARRAYJOIN({PacRec}))`)})`)}&fields[]=PACIENTE`).catch(() => []),
      // Nombres de los estados: de alta, que dejaron el tratamiento o que no llegaron a venir ya está decidido, no hace falta llamarlos
      todos('tbldOsLe8iw78Wun7', 'fields[]=ESTADO').catch(() => []),
      // ¿Ha venido alguna vez? (si no, era su primera visita: no es paciente todavía)
      todos(CITAS_TABLE, `filterByFormula=${encodeURIComponent(`AND(TRIM({ESTADO})='REALIZADA',${orIds(id => `FIND('${id}',ARRAYJOIN({PacienteRec}))`)})`)}&fields[]=${encodeURIComponent('RELACIÓN - CITA')}`).catch(() => [])]);
    prev.forEach(c => (c.fields['RELACIÓN - CITA'] || []).forEach(id => vino.add(id)));
    const nomE = {}; ests.forEach(e => { nomE[e.id] = String(e.fields.ESTADO || '').trim().toUpperCase(); });
    const CERR = { 'ALTA': 'De alta', 'ABANDONO': 'Dejó el tratamiento', 'NO ACUDIÓ': 'No llegó a venir' };
    ps.forEach(p => { const e = (p.fields.ESTADO || []).map(x => nomE[x] || (x && x.name ? String(x.name).toUpperCase() : '')).find(n => CERR[n]); if (e) cerrado[p.id] = CERR[e]; });
    ps.forEach(p => { nomP[p.id] = p.fields['FULL NAME'] || ''; });
    fut.forEach(c => { const f = String(c.fields.FECHA || '').slice(0, 10); (c.fields['RELACIÓN - CITA'] || []).forEach(id => { if (!prox[id] || f < prox[id]) prox[id] = f; }); });
    segs.forEach(r => (r.fields.PACIENTE || []).forEach(id => enLlamar.add(id)));
  }
  // Atrasado por fisio (ahora mismo): tareas y llamadas de seguimiento sin hacer cuya fecha ya ha pasado
  const atrasado = await (async () => { try {
    const hoyA = madrid(0).fecha, nm = v => String((v && typeof v === 'object' ? (Array.isArray(v) ? (v[0] && (v[0].name || v[0])) : v.name) : v) || '').trim(), key = v => nm(v).split(/\s+/)[0].toLowerCase();
    const [tar, seg] = await Promise.all([
      todos('tblxPpPSvj15NWqNT', `filterByFormula=${encodeURIComponent(`AND(NOT({HECHO}),IS_BEFORE({FECHA},'${hoyA}'))`)}&fields[]=TAREA&fields[]=PARA&fields[]=PACIENTE&fields[]=FECHA`).catch(() => []),
      todos('tblu9YxiktpAh5w87', `filterByFormula=${encodeURIComponent(`AND(NOT({HECHO}),IS_BEFORE({FECHA DE LLAMADA},'${hoyA}'))`)}&fields[]=RESPONSABLE&fields[]=PACIENTE&fields[]=PacRec&fields[]=${encodeURIComponent('FECHA DE LLAMADA')}`).catch(() => [])]);
    const ids = [...new Set([...tar, ...seg].flatMap(r => [...(r.fields.PACIENTE || []), ...(r.fields.PacRec || [])]).filter(x => typeof x === 'string' && /^rec/.test(x)))];
    const nomA = {}; for (let i = 0; i < ids.length; i += 40) (await todos(TABLAS.paciente, `filterByFormula=${encodeURIComponent('OR(' + ids.slice(i, i + 40).map(id => `RECORD_ID()='${id}'`).join(',') + ')')}&fields[]=${encodeURIComponent('FULL NAME')}`).catch(() => [])).forEach(p => { nomA[p.id] = p.fields['FULL NAME'] || ''; });
    const dias = f => Math.max(0, Math.round((new Date(hoyA + 'T12:00:00Z') - new Date(String(f).slice(0, 10) + 'T12:00:00Z')) / 864e5));
    const G = {};
    const add = (who, it) => { const k = key(who) || 'sin asignar'; const g = G[k] = G[k] || { fisio: nm(who) || 'Sin asignar', tareas: 0, llamadas: 0, maxDias: 0, items: [] }; g[it.tipo === 'tarea' ? 'tareas' : 'llamadas']++; g.maxDias = Math.max(g.maxDias, it.dias); g.items.push(it); };
    tar.forEach(r => { const pid = (r.fields.PACIENTE || [])[0]; add(r.fields.PARA, { tipo: 'tarea', texto: String(r.fields.TAREA || 'Tarea').slice(0, 120), pacienteId: typeof pid === 'string' ? pid : '', paciente: nomA[pid] || '', dias: dias(r.fields.FECHA) }); });
    seg.forEach(r => { const pid = (r.fields.PacRec || r.fields.PACIENTE || [])[0]; add(r.fields.RESPONSABLE, { tipo: 'llamada', texto: 'Llamada de seguimiento', pacienteId: typeof pid === 'string' ? pid : '', paciente: nomA[pid] || '', dias: dias(r.fields['FECHA DE LLAMADA']) }); });
    return Object.values(G).map(g => (g.items.sort((a, b) => b.dias - a.dias), g)).sort((a, b) => b.maxDias - a.maxDias);
  } catch (e) { return null; } })();
  // «No han reagendado»: por qué (lo que apuntó el fisio) y cómo está ahora (en seguimiento, con cita, de alta… o sin explicar)
  await (async () => { try {
    const L = [...(D.rendDia || []), ...(D.rendSemana || [])].flatMap(x => x.lista || []), ids = [...new Set(L.map(p => p.id).filter(id => /^rec[A-Za-z0-9]{14}$/.test(id || '')))];
    if (!ids.length) return;
    const orI = (l, k) => 'OR(' + l.map(id => k(id)).join(',') + ')', info = {}, conSeg = new Set(), conCita = new Set();
    for (let i = 0; i < ids.length; i += 40) { const l = ids.slice(i, i + 40);
      const [ps, sg, ct, es] = await Promise.all([
        todos(TABLAS.paciente, `filterByFormula=${encodeURIComponent(orI(l, id => `RECORD_ID()='${id}'`))}&fields[]=${encodeURIComponent('POR QUÉ NO REAGENDA')}&fields[]=ESTADO`).catch(() => []),
        todos('tblu9YxiktpAh5w87', `filterByFormula=${encodeURIComponent(`AND(NOT({HECHO}),${orI(l, id => `FIND('${id}',ARRAYJOIN({PacRec}))`)})`)}&fields[]=PacRec`).catch(() => []),
        todos(CITAS_TABLE, `filterByFormula=${encodeURIComponent(`AND(OR(TRIM({ESTADO})='PENDIENTE',TRIM({ESTADO})='CITA DUDOSA'),NOT(IS_BEFORE({FECHA},TODAY())),${orI(l, id => `FIND('${id}',ARRAYJOIN({PacienteRec}))`)})`)}&fields[]=${encodeURIComponent('RELACIÓN - CITA')}`).catch(() => []),
        i ? Promise.resolve(null) : todos('tbldOsLe8iw78Wun7', 'fields[]=ESTADO').catch(() => [])]);
      if (es) es.forEach(e => { info['_e' + e.id] = String(e.fields.ESTADO || '').trim().toUpperCase(); });
      ps.forEach(p => { info[p.id] = { porQue: String(p.fields['POR QUÉ NO REAGENDA'] || '').trim(), est: (p.fields.ESTADO || []).map(x => info['_e' + x] || '') }; });
      sg.forEach(r => (r.fields.PacRec || []).forEach(id => conSeg.add(id))); ct.forEach(c => (c.fields['RELACIÓN - CITA'] || []).forEach(id => conCita.add(id)));
    }
    L.forEach(p => { const x = info[p.id] || { porQue: '', est: [] };
      p.porQue = x.porQue;
      p.situacion = conCita.has(p.id) ? 'Ya tiene cita' : conSeg.has(p.id) ? 'En seguimiento' : x.est.includes('ALTA') ? 'De alta' : x.est.includes('ABANDONO') ? 'Dejó el tratamiento' : x.est.includes('NO ACUDIÓ') ? 'No llegó a venir' : '';
    });
  } catch (e) {} })();
  const hora = t => t ? new Date(t).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' }) : '';
  const cita = c => { const pid = (c.fields['RELACIÓN - CITA'] || [])[0] || ''; return { id: c.id, pacienteId: pid, proxima: prox[pid] || '', enLlamar: enLlamar.has(pid), alta: cerrado[pid] || '', nuncaVino: !!pid && !vino.has(pid), nombre: nomP[pid] || c.fields['your-name'] || '', fisio: fisioDe(c.fields['PREF.']), hora: String(c.fields['HORA'] || '').slice(0, 5), estado: D.est(c) }; };
  return {
    fecha, hechas: D.hechas, nFacturas: D.facs.length, total: D.total, caja: D.caja,
    fisios: Object.entries(D.rep || {}).map(([f, x]) => { const e = (D.envs || {})[String(f).split(' ')[0].toLowerCase()];
      return { fisio: f, hechas: x.hechas, enviado: e ? hora(e.enviado) : '', noMarcados: e ? String(e.marcados || '').split('\n').filter(l => l.startsWith('✗')).map(l => l.slice(2)) : [], nota: e && e.nota || '',
        pendiente: (x.checks || []).filter(c => !c.aviso && c.items.length).map(c => ({ k: c.k, t: c.t, items: c.items.map(i => ({ id: i.id || '', nombre: i.nombre || '', extra: i.extra || '' })) })) }; }),
    rendDia: D.rendDia, rendSemana: D.rendSemana, atrasado,
    sinFacturar: D.sf && D.sf.activo ? D.sf.lista.map(x => ({ id: x.id || '', nombre: x.nombre, fisio: x.fisio, n: -x.saldo })) : null,
    sinMarcar: D.sinMarcar.map(cita), canceladas: D.canceladas.map(cita),
    fuera: D.fuera.map(d => ({ nombre: d.contact_name || '—', total: SCH.importeDoc ? SCH.importeDoc(d) : Number(d.total || 0) })),
    borradores: D.borradores.slice(0, 40).map(d => ({ nombre: d.contact_name || '—', fecha: String(d.date || '').slice(0, 10) })),
    facturas: D.facs.map(r => ({ num: r.fields['Nº FACTURA'] || '', concepto: [r.fields['CONCEPTO 1'], r.fields['CONCEPTO 2']].filter(Boolean).join(' + '), pago: r.fields['PAGO DESGLOSE'] || (r.fields['MODO DE PAGO'] && r.fields['MODO DE PAGO'].name) || r.fields['MODO DE PAGO'] || '', total: Number(r.fields['TOTAL'] || 0) }))
  };
}
// Último día con citas antes de hoy (para abrir el reporte en el último día de trabajo)
async function ultimoDiaConCitas() {
  for (let n = 1; n <= 7; n++) { const f = madrid(-n).fecha; const c = await todos(CITAS_TABLE, `filterByFormula=${encodeURIComponent(`AND(DATETIME_FORMAT({FECHA},'YYYY-MM-DD')='${f}',TRIM({ESTADO})='REALIZADA')`)}&fields[]=FECHA&maxRecords=1`); if (c.length) return f; }
  return madrid(-1).fecha;
}
// Email del Daily report: lo mismo y en el mismo orden que la sección del panel (arriba lo que falta para cerrar el día)
const capT = t => String(t || '').toLowerCase().replace(/(^|[\s\-'])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
const pila = f => String(f || '').trim().split(/\s+/)[0] || '';
function htmlReporte(R, fechaTxt) {
  const URL = 'https://app.fisioterapia365.com/fisio?s=rdia';
  const C = { coral: '#c2552e', tx: '#1f1a17', mu: '#7d6a60', ln: '#efe7e0', crema: '#faf6f2', ok: '#16803c', okBg: '#eef8f0', mal: '#b42318', malBg: '#fdf0ee', amb: '#b45309', ambBg: '#fdf6e7' };
  const pl = (n, a, b) => n + ' ' + (n === 1 ? a : b);
  const SF = R.sinFacturar || [], nSF = SF.reduce((t, x) => t + x.n, 0), cSin = R.canceladas.filter(c => c.pacienteId && !c.proxima && !c.enLlamar && !c.alta);
  const noEnv = R.fisios.filter(f => !f.enviado), conPend = R.fisios.filter(f => f.noMarcados.length || f.pendiente.length), atViejo = (R.atrasado || []).filter(g => g.maxDias > 3);
  const FALTA = [
    nSF && ['Cobros', pl(nSF, 'sesión sin facturar', 'sesiones sin facturar'), SF.map(x => capT(x.nombre)).slice(0, 4).join(', ') + (SF.length > 4 ? '…' : ''), 'mal'],
    R.fuera.length && ['Cobros', pl(R.fuera.length, 'ticket hecho fuera del panel', 'tickets hechos fuera del panel'), 'Revisa que estén bien', 'mal'],
    R.sinMarcar.length && ['Agenda', pl(R.sinMarcar.length, 'cita sin marcar', 'citas sin marcar'), '¿Vino o no vino?', 'amb'],
    cSin.length && ['Agenda', pl(cSin.length, 'cancelación sin próxima cita', 'cancelaciones sin próxima cita'), cSin.map(c => capT(c.nombre)).slice(0, 4).join(', '), 'amb'],
    noEnv.length && ['Equipo', pl(noEnv.length, 'check-list sin enviar', 'check-lists sin enviar'), noEnv.map(f => pila(f.fisio)).join(', '), 'mal'],
    conPend.length && ['Equipo', pl(conPend.length, 'fisio con cosas por hacer', 'fisios con cosas por hacer'), conPend.map(f => pila(f.fisio)).join(', '), 'amb'],
    atViejo.length && ['Atrasos', 'Tareas o llamadas atrasadas más de 3 días', atViejo.map(g => /^sin asignar$/i.test(g.fisio) ? 'sin asignar' : pila(g.fisio)).join(', '), 'amb'],
    R.borradores.length && ['Cobros', pl(R.borradores.length, 'ticket en borrador por aprobar', 'tickets en borrador por aprobar'), 'En Holded', 'amb']].filter(Boolean);
  const box = (inner, bg, bd) => `<div style="background:${bg || '#fff'};border:1px solid ${bd || C.ln};border-radius:14px;padding:14px 16px;margin:0 0 12px">${inner}</div>`;
  const h3 = (t, col) => `<div style="margin:26px 0 10px;font-size:15px;font-weight:700;color:${col || C.tx}">${t}</div>`;
  const chip = (t, k) => `<span style="display:inline-block;padding:2px 9px;border-radius:99px;font-size:11.5px;font-weight:600;background:${C[k + 'Bg'] || C.crema};color:${C[k] || C.mu};white-space:nowrap">${t}</span>`;
  const row = (a, b, c) => `<tr><td style="padding:9px 0;border-top:1px solid ${C.ln};font-size:14px;vertical-align:top">${a}${b ? `<div style="font-size:12px;color:${C.mu};margin-top:2px">${b}</div>` : ''}</td><td style="padding:9px 0 9px 10px;border-top:1px solid ${C.ln};text-align:right;vertical-align:top;font-size:13px;white-space:nowrap">${c || ''}</td></tr>`;
  const tabla = filas => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">${filas.map((f, i) => i ? f : f.replace(/border-top:1px solid [^;]+;/g, 'border-top:0;')).join('')}</table>`;
  // Lo que falta
  const estado = FALTA.length
    ? box(`<div style="font-size:16px;font-weight:700;margin-bottom:2px">Faltan ${FALTA.length} ${FALTA.length === 1 ? 'cosa' : 'cosas'} para cerrar el día</div><div style="font-size:12.5px;color:${C.mu};margin-bottom:10px">Ábrelo en el panel para arreglarlas o mandarlas como tarea.</div>
      ${FALTA.map(([ic, t, sub, k]) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;margin-top:8px"><tr><td style="background:${C[k + 'Bg']};border-left:3px solid ${C[k]};border-radius:10px;padding:10px 12px"><div style="font-size:11px;font-weight:700;letter-spacing:.5px;color:${C[k]};text-transform:uppercase">${ic}</div><div style="font-size:14px;font-weight:600;margin-top:1px">${escH(t)}</div>${sub ? `<div style="font-size:12.5px;color:${C.mu};margin-top:1px">${escH(sub)}</div>` : ''}</td></tr></table>`).join('')}`, '#fff', C.ln)
    : box(`<div style="font-size:16px;font-weight:700;color:${C.ok}">✓ Todo hecho. El día está cerrado al 100%.</div><div style="font-size:12.5px;color:${C.mu};margin-top:2px">Cobros, citas, check-lists y seguimientos, en orden.</div>`, C.okBg, '#cfe9d6');
  // Números
  const env = R.fisios.filter(f => f.enviado).length, nf = R.fisios.length;
  const kpi = (n, t, k) => `<td width="50%" style="padding:4px"><div style="background:${k ? C[k + 'Bg'] : C.crema};border-radius:12px;padding:12px 12px 10px"><div style="font-size:20px;font-weight:700;color:${k ? C[k] : C.tx}">${n}</div><div style="font-size:12px;color:${C.mu}">${t}</div></div></td>`;
  const caja = Object.entries(R.caja || {});
  const numeros = `${h3('Números del día')}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 -4px"><tr>${kpi(R.hechas, 'sesiones hechas')}${kpi(R.nFacturas, 'facturas emitidas')}</tr><tr>${kpi(eur(R.total), 'facturado')}${kpi(nf ? env + '/' + nf : '—', 'check-lists enviados', nf && env < nf ? 'mal' : '')}</tr></table>
    ${caja.length ? `<div style="margin-top:8px;font-size:13px;color:${C.mu}">${caja.map(([m, t]) => `<span style="display:inline-block;margin:4px 6px 0 0;padding:4px 10px;border:1px solid ${C.ln};border-radius:99px">${escH(m)} <b style="color:${C.tx}">${eur(t)}</b></span>`).join('')}</div>` : ''}`;
  // Check-list de cada fisio
  const fisios = nf ? h3('Check-list de los fisios') + R.fisios.map(f => box(
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="vertical-align:top"><div style="font-size:14.5px;font-weight:700">${escH(f.fisio)}</div><div style="font-size:12px;color:${C.mu}">${pl(f.hechas, 'sesión hecha', 'sesiones hechas')}</div></td><td style="text-align:right;vertical-align:top">${f.enviado ? chip('✓ Enviado ' + escH(f.enviado), 'ok') : chip('✗ No enviado', 'mal')}</td></tr></table>
    ${f.enviado ? (f.noMarcados.length ? `<div style="margin-top:8px;font-size:13px;color:${C.amb}"><b>Sin marcar:</b> ${f.noMarcados.map(escH).join(' · ')}</div>` : `<div style="margin-top:8px;font-size:13px;color:${C.ok}">Todo marcado</div>`) : ''}
    ${f.pendiente.length ? `<div style="margin-top:10px;padding-top:8px;border-top:1px dashed ${C.ln}"><div style="font-size:11px;font-weight:700;letter-spacing:.5px;color:${C.mal};text-transform:uppercase;margin-bottom:4px">Le falta</div>${f.pendiente.map(c => `<div style="font-size:13px;margin-top:5px"><b>${escH(c.t)}</b> <span style="color:${C.mu}">(${c.items.length})</span><div style="color:${C.mu};font-size:12.5px;margin-top:1px">${c.items.map(i => escH(capT(i.nombre)) + (i.extra ? ' <i>' + escH(i.extra) + '</i>' : '')).join(' · ')}</div></div>`).join('')}</div>` : ''}
    ${f.nota ? `<div style="margin-top:8px;font-size:13px;color:${C.mu}"><b style="color:${C.tx}">Nota:</b> «${escH(f.nota)}»</div>` : ''}`, f.enviado ? '#fff' : C.malBg, f.enviado ? C.ln : '#f3d3cd')).join('') : '';
  // Atrasado
  const at = R.atrasado && R.atrasado.length ? h3('Atrasado por fisio <span style="font-weight:400;font-size:12px;color:' + C.mu + '">· tareas y llamadas sin hacer de días anteriores</span>', R.atrasado.some(g => g.maxDias > 3) ? C.mal : '') + R.atrasado.map(g => box(
    `<div style="font-size:14px"><b>${/^sin asignar$/i.test(g.fisio) ? 'Sin asignar' : escH(pila(g.fisio))}</b> <span style="color:${C.mu};font-size:12.5px">· ${[g.tareas ? pl(g.tareas, 'tarea', 'tareas') : '', g.llamadas ? pl(g.llamadas, 'llamada', 'llamadas') : ''].filter(Boolean).join(' · ')} · la más antigua hace ${pl(g.maxDias, 'día', 'días')}</span></div>
    ${tabla(g.items.slice(0, 6).map(it => row((it.tipo === 'tarea' ? escH(it.texto) : '📞 Llamada de seguimiento') + (it.paciente ? ' · ' + escH(capT(it.paciente)) : ''), '', `<span style="color:${it.dias > 3 ? C.mal : C.mu}">hace ${pl(it.dias, 'día', 'días')}</span>`)))}${g.items.length > 6 ? `<div style="font-size:12px;color:${C.mu};margin-top:6px">y ${g.items.length - 6} más</div>` : ''}`, g.maxDias > 3 ? C.malBg : '#fff', g.maxDias > 3 ? '#f3d3cd' : C.ln)).join('')
    : R.atrasado ? box(`<div style="font-size:13.5px;color:${C.ok};font-weight:600">✓ Atrasado por fisio: nada. Todo lo de días anteriores está hecho.</div>`, C.okBg, '#cfe9d6') : '';
  const sec = (t, k, filas) => filas.length ? h3(t, C[k]) + box(tabla(filas)) : '';
  const sinFac = R.sinFacturar ? (SF.length ? sec(`Sesiones sin facturar ahora mismo (${nSF})`, 'mal', SF.map(x => row(escH(capT(x.nombre)), escH(x.fisio), `<b>${x.n}</b>`))) : box(`<div style="font-size:13.5px;color:${C.ok};font-weight:600">✓ No hay sesiones sin facturar</div>`, C.okBg, '#cfe9d6')) : '';
  const sinMar = sec(`Citas sin marcar (siguen en «Pendiente»): ${R.sinMarcar.length}`, 'amb', R.sinMarcar.map(c => row(escH(capT(c.nombre)), escH(c.fisio), escH(c.hora))));
  const fuera = sec(`Tickets hechos en Holded fuera del panel: ${R.fuera.length}`, 'mal', R.fuera.map(d => row(escH(d.nombre), '', eur(d.total))));
  const borr = sec(`Tickets en borrador por aprobar en Holded: ${R.borradores.length}`, 'amb', R.borradores.slice(0, 12).map(d => row(escH(d.nombre), '', escH(d.fecha.split('-').reverse().join('/')))));
  const canc = sec(`Canceladas o no vinieron: ${R.canceladas.length}`, cSin.length ? 'amb' : '', R.canceladas.map(c => row(escH(capT(c.nombre || 'Paciente')), escH(c.fisio) + ' · ' + escH(String(c.estado).toLowerCase()) + ' · ' + escH(c.hora),
    c.proxima ? chip('✓ Cita el ' + c.proxima.slice(8) + '/' + c.proxima.slice(5, 7), 'ok') : c.enLlamar ? chip('En «Por llamar»', '') : c.alta ? chip(escH(c.alta), '') : c.pacienteId ? chip(c.nuncaVino ? '1ª visita · nunca vino' : 'Sin próxima cita', 'amb') : '')));
  const rend = (L, t) => { if (!L || !L.length) return '';
    const th = x => `<td style="padding:0 4px 6px 0;font-size:11px;color:${C.mu};font-weight:600">${x}</td>`, td = (x, b) => `<td style="padding:7px 4px 7px 0;border-top:1px solid ${C.ln};font-size:13px;${b ? 'font-weight:600' : ''}">${x}</td>`;
    const noR = L.filter(x => x.lista && x.lista.length).map(x => `<div style="font-size:12.5px;margin-top:8px"><b>${escH(pila(x.fisio))}</b> <span style="color:${C.mu}">· no han reagendado:</span> ${x.lista.map(p => escH(capT(p.nombre)) + (p.situacion ? ` <span style="color:${C.ok}">(${escH(p.situacion.toLowerCase())})</span>` : '')).join(', ')}</div>`).join('');
    return box(`<div style="font-size:13px;font-weight:700;margin-bottom:8px">${t}</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr>${th('Fisio')}${th('Hechas')}${th('Ocup.')}${th('Reagendan')}${th('Faltas')}</tr>${L.map(x => `<tr>${td(escH(pila(x.fisio)), 1)}${td(x.realizadas + (x.sinHoras ? '' : '/' + x.huecos))}${td(x.sinHoras ? '—' : pct(x.realizadas, x.huecos))}${td(pct(x.reagendan, x.atendidos))}${td((x.noAsistio || 0) + (x.perdidas || 0))}</tr>`).join('')}</table>${noR}`); };
  const facs = sec('Facturas emitidas', '', R.facturas.map(f => row(escH(f.num), escH(f.concepto) + (f.pago ? ' · ' + escH(f.pago) : ''), `<b>${eur(f.total)}</b>`)));
  const btn = t => `<a href="${URL}" style="display:inline-block;background:${C.coral};color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:11px 20px;border-radius:99px">${t}</a>`;
  return `<div style="font-family:Poppins,Arial,Helvetica,sans-serif;background:#f7f1eb;padding:20px 12px;color:${C.tx}"><div style="max-width:560px;margin:0 auto">
  <div style="background:#fff;border:1px solid ${C.ln};border-radius:18px;padding:20px 18px;margin-bottom:12px">
   <div style="font-size:11.5px;color:${C.coral};font-weight:700;letter-spacing:1.2px">DAILY REPORT</div>
   <div style="font-size:22px;font-weight:700;margin:4px 0 14px;text-transform:capitalize">${escH(fechaTxt)}</div>
   ${estado}
   <div style="text-align:center;margin-top:4px">${btn('Abrir en el panel')}</div>
  </div>
  <div style="background:#fff;border:1px solid ${C.ln};border-radius:18px;padding:4px 18px 18px">
   ${numeros}${fisios}${at}${sinFac ? (SF.length ? sinFac : '<div style="height:14px"></div>' + sinFac) : ''}${sinMar}${fuera}${borr}${canc}
   ${R.rendDia && R.rendDia.length ? h3('Rendimiento') : ''}${rend(R.rendDia, 'Del día')}${rend(R.rendSemana, 'De la semana')}
   ${R.rendDia && R.rendDia.length ? `<div style="font-size:11px;color:#9b8f86;margin-top:-4px">Reagendan = de los atendidos, cuántos tienen otra cita apuntada · Faltas = no asistió o cita perdida</div>` : ''}
   ${facs}
   <div style="text-align:center;margin-top:22px">${btn('Abrir el Daily report')}</div>
  </div>
  <div style="text-align:center;font-size:11px;color:#9b8f86;margin-top:12px">FISIO365 · Te llega cada mañana con el día anterior</div>
 </div></div>`;
}
async function resumenFacturacion(ayer, soloA) {
  const R = await reporteDia(ayer.fecha);
  const fechaTxt = `${DIAS[ayer.dia]} ${+ayer.fecha.slice(8)}/${+ayer.fecha.slice(5, 7)}`;
  const html = htmlReporte(R, fechaTxt);
  const SF = R.sinFacturar || [], noEnv = R.fisios.some(f => !f.enviado);
  const to = soloA ? [soloA] : await (SCH.emailsResumen ? SCH.emailsResumen() : Promise.resolve(String(process.env.RESUMEN_EMAIL || 'fisio365gestion@gmail.com').split(/[,;\s]+/).filter(Boolean)));
  // Por email (además, el panel lo enseña en «Daily report»)
  const r = await fetch('https://api.brevo.com/v3/smtp/email', { method: 'POST', headers: { 'api-key': process.env.BREVO_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sender: { name: 'FISIO365', email: 'info@fisioterapia365.com' }, to: to.map(email => ({ email })), subject: `Daily report · ${fechaTxt}${noEnv ? ' · ✗ falta algún check-list' : ''}${SF.length ? ' · ⚠️ ' + SF.length + ' sin facturar' : ''}${R.rendSemana ? ' · + semana' : ''}`, htmlContent: html }) });
  return r.ok ? 'enviado' : 'error brevo ' + r.status + ' ' + (await r.text().catch(() => '')).slice(0, 300);
}

module.exports = async function handler(req, res) {
  const esCron = req.headers['authorization'] === `Bearer ${process.env.CRON_SECRET}`;
  const esPanel = false;
  if (!esCron) return res.status(401).json({ ok: false });
  // Serie de formación (School): 7:30 UTC de lunes a viernes = 8:30 en invierno. Aviso del módulo de hoy a los fisios
  if (/serie=1/.test(req.url || '')) {
    const S = require('./_serie.json'), hoy = madrid(0);
    if (hoy.dia === 0 || hoy.dia === 6) return res.status(200).json({ ok: true, saltado: 'Fin de semana' });
    let n = 0; for (let d = new Date(S.inicio + 'T12:00:00Z'); d.toISOString().slice(0, 10) <= hoy.fecha; d.setUTCDate(d.getUTCDate() + 1)) { const w = d.getUTCDay(); if (w > 0 && w < 6) n++; }
    if (n < 1 || n > S.modulos.length) return res.status(200).json({ ok: true, saltado: 'Fuera de la serie' });
    if (!/forzar=1/.test(req.url || '') && (await SCH.ajuste('serie_enviado', '').catch(() => '')) === hoy.fecha) return res.status(200).json({ ok: true, ya: true });
    await SCH.guardarAjuste('serie_enviado', hoy.fecha, 'cron').catch(() => {});
    // La tarea del día por Comunicaciones (Pendientes del buzón y del check-list); se marca hecha sola al terminar el módulo
    const EQ = await todos(TABLAS.fisio, `filterByFormula=${encodeURIComponent('AND({FECHA BAJA}="",LOWER({Role})="fisio")')}&fields[]=Name&fields[]=PushSubscription`).catch(() => []);
    const pilaN = x => { const p = String(x || '').trim().split(/\s+/)[0] || ''; return p.charAt(0).toUpperCase() + p.slice(1).toLowerCase(); };
    const para = [...new Set(EQ.map(f => pilaN(f.fields.Name)).filter(Boolean))];
    let k = n - 1, curso = '', ii = 0; { let o = 0; for (const [c, len] of S.cursos) { if (k < o + len) { curso = c; ii = k - o; break; } o += len; } }
    if (para.length) await fetch(`https://api.airtable.com/v0/${BASE_ID}/tbl2qRD3WsvQVPrwX`, { method: 'POST', headers: { ...AT, 'Content-Type': 'application/json' }, body: JSON.stringify({ typecast: true, records: [{ fields: {
      ASUNTO: `Módulo de hoy: ${S.modulos[n - 1]}`, TIPO: 'Comunicado', DE: 'School', PARA: para.join(', '), FECHA: new Date().toISOString(), MODO: 'hacer', 'REQUIERE ACCIÓN': true, 'FECHA LÍMITE': hoy.fecha,
      CUERPO: `Hoy toca el módulo ${n} de ${S.modulos.length} de la formación del panel: «${S.modulos[n - 1]}». Son unos 5 minutos, con preguntas al final.\n\nTócalo en «Hacer el módulo». Cuando lo termines, esta tarea se marca como hecha sola.`,
      DATOS: JSON.stringify({ school: { k, curso, i: ii, titulo: S.modulos[n - 1] } }), 'LEÍDO': '{}', HECHO: '{}', RECIBIDO: '{}', ESTADO: 'Abierta' } }] }) }).catch(() => {});
    const F = EQ.filter(f => f.fields.PushSubscription);
    const titulo = S.modulos[n - 1]; let ok = 0;
    for (const f of F) { let sub = null; try { sub = JSON.parse(f.fields.PushSubscription); } catch (e) {} if (await enviar(sub, { title: 'School · Módulo de hoy', body: `«${titulo}» (${n} de ${S.modulos.length}). Unos 5 minutos.`, url: '/fisio?s=school', tag: 'serie' })) ok++; }
    console.log('serie', hoy.fecha, n, titulo, ok + '/' + F.length);
    return res.status(200).json({ ok: true, n, titulo, enviados: ok, fisios: F.length });
  }
  // Resumen de facturación: 7:00 UTC (8 h en invierno, 9 h en verano), de las citas de ayer
  if (/resumen=1/.test(req.url || '')) {
    const ayer = madrid(-1);
    if (esPanel && horaMadrid() < 8) return res.status(200).json({ ok: true, saltado: 'Aún es pronto' });
    // Vales regalo que hoy hay que mandar a quien los recibe (cada vale se manda una sola vez)
    try { const nv = SCH.valesDelDia ? await SCH.valesDelDia() : 0; if (nv) console.log('vales regalo enviados', nv); } catch (e) { console.log('vales regalo', e.message); }
    if (!/forzar=1/.test(req.url || '') && (await SCH.ajuste('resumen_enviado', '').catch(() => '')) === ayer.fecha) return res.status(200).json({ ok: true, ya: true });
    await SCH.guardarAjuste('resumen_enviado', ayer.fecha, esCron ? 'cron' : 'panel').catch(() => {}); // se apunta antes para no mandarlo dos veces si entran varios a la vez
    const etapas = await SCH.repasoEtapas().catch(e => ({ error: e.message })); // Activo → Pendiente de continuar
    try { const resumen = await resumenFacturacion(ayer); if (!/^enviado/.test(resumen)) await SCH.guardarAjuste('resumen_enviado', '', 'error').catch(() => {}); console.log('resumen', ayer.fecha, resumen, esCron ? 'cron' : 'panel'); return res.status(200).json({ ok: true, etapas, resumen }); }
    catch (e) { await SCH.guardarAjuste('resumen_enviado', '', 'error').catch(() => {}); console.log('resumen error', e.message); return res.status(500).json({ ok: false, error: e.message }); }
  }
  // Recordatorios: 17:00 UTC (19 h en verano, 18 h en invierno)
  if (![18, 19].includes(horaMadrid()) && !/forzar=1/.test(req.url || '')) return res.status(200).json({ ok: true, saltado: 'Fuera de hora' });
  const hoy = madrid(0), dia = madrid(2), hace30 = madrid(-30);
  const out = { citas: 0, ejercicios: 0, errores: 0 };
  try {
    // Pacientes con avisos activados
    const pacs = await todos(TABLAS.paciente, `filterByFormula=${encodeURIComponent('{PushSubscription}!=""')}&fields[]=PushSubscription&fields[]=UltimaSession`);
    const subDe = {}; pacs.forEach(p => { try { subDe[p.id] = JSON.parse(p.fields.PushSubscription); } catch (e) {} });

    // 1. Citas de pasado mañana
    const citas = await todos(CITAS_TABLE, `filterByFormula=${encodeURIComponent(`AND(DATETIME_FORMAT({FECHA},'YYYY-MM-DD')='${dia.fecha}',TRIM({ESTADO})='PENDIENTE')`)}&fields[]=HORA&fields[]=${encodeURIComponent('PREF.')}&fields[]=${encodeURIComponent('RELACIÓN - CITA')}&sort[0][field]=HORA`);
    const yaAvisado = new Set();
    for (const c of citas) {
      const pid = (c.fields['RELACIÓN - CITA'] || [])[0];
      if (!pid || !subDe[pid] || yaAvisado.has(pid)) continue;
      yaAvisado.add(pid);
      const hora = String(c.fields['HORA'] || '').slice(0, 5), fisio = fisioDe(c.fields['PREF.']);
      const ok = await enviar(subDe[pid], {
        title: 'Pasado mañana tienes cita',
        body: `${DIAS[dia.dia].replace(/^./, m => m.toUpperCase())} ${+dia.fecha.slice(8)}${hora ? ' a las ' + hora : ''}${fisio ? ' con ' + fisio : ''}.`,
        url: '/?s=citas', tag: 'cita'
      });
      ok ? out.citas++ : out.errores++;
    }

    // 2. Ejercicios: todos los días, solo a quien hoy aún no los ha hecho
    const hechoHoy = new Set();
    pacs.forEach(p => { if (String(p.fields.UltimaSession || '').slice(0, 10) >= hoy.fecha) hechoHoy.add(p.id); });
    // Tareas de la más reciente a la más antigua; se para al llegar a antes de hoy
    let off = '', seguir = true;
    do {
      const r = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${TAREAS_TABLE}?fields[]=PacienteId&fields[]=Fecha&sort[0][field]=Fecha&sort[0][direction]=desc&pageSize=100${off ? '&offset=' + off : ''}`, { headers: AT });
      const d = await r.json();
      if (d.error) throw new Error('Tareas: ' + (d.error.message || d.error));
      for (const t of (d.records || [])) {
        const f = String(t.fields?.Fecha || '').slice(0, 10);
        if (f >= hoy.fecha) hechoHoy.add(t.fields?.PacienteId || '');
        else if (f) { seguir = false; break; }
      }
      off = d.offset || '';
    } while (off && seguir);
    for (const p of pacs) {
      if (hechoHoy.has(p.id) || !subDe[p.id] || yaAvisado.has(p.id)) continue;
      // Solo pacientes en tratamiento: que hayan hecho ejercicios en el último mes
      const ult = String(p.fields.UltimaSession || '').slice(0, 10);
      if (!ult || ult < hace30.fecha) continue;
      const ok = await enviar(subDe[p.id], {
        title: '¿Hacemos los ejercicios?',
        body: 'Hoy aún no los has hecho. Son solo unos minutos y es lo que más te ayuda a mejorar.',
        url: '/?s=hoy', tag: 'ejercicios'
      });
      ok ? out.ejercicios++ : out.errores++;
    }
    return res.status(200).json({ ok: true, fecha: hoy.fecha, ...out });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message, ...out });
  }
};

module.exports.reporteDia = reporteDia;
module.exports.htmlReporte = htmlReporte;
module.exports.ultimoDiaConCitas = ultimoDiaConCitas;
