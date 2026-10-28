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
  const facs = facsTodas.filter(r => saldo.fechaCobro(r.fields) === ayer.fecha);
  const canceladas = citas.filter(c => /CANCEL|NO ASIST|PERDIDA/i.test(est(c)) && (c.fields['RELACIÓN - CITA'] || []).length);
  // Caja por forma de pago
  const caja = {}; facs.forEach(r => { const m = (r.fields['MODO DE PAGO'] && r.fields['MODO DE PAGO'].name) || r.fields['MODO DE PAGO'] || 'Sin indicar'; caja[m] = (caja[m] || 0) + Number(r.fields['TOTAL'] || 0); });
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
  const hora = t => t ? new Date(t).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' }) : '';
  const cita = c => ({ id: c.id, pacienteId: (c.fields['RELACIÓN - CITA'] || [])[0] || '', nombre: c.fields['your-name'] || '', fisio: fisioDe(c.fields['PREF.']), hora: String(c.fields['HORA'] || '').slice(0, 5), estado: D.est(c) });
  return {
    fecha, hechas: D.hechas, nFacturas: D.facs.length, total: D.total, caja: D.caja,
    fisios: Object.entries(D.rep || {}).map(([f, x]) => { const e = (D.envs || {})[String(f).split(' ')[0].toLowerCase()];
      return { fisio: f, hechas: x.hechas, enviado: e ? hora(e.enviado) : '', noMarcados: e ? String(e.marcados || '').split('\n').filter(l => l.startsWith('✗')).map(l => l.slice(2)) : [], nota: e && e.nota || '',
        pendiente: (x.checks || []).filter(c => !c.aviso && c.items.length).map(c => ({ k: c.k, t: c.t, items: c.items.map(i => ({ id: i.id || '', nombre: i.nombre || '', extra: i.extra || '' })) })) }; }),
    rendDia: D.rendDia, rendSemana: D.rendSemana,
    sinFacturar: D.sf && D.sf.activo ? D.sf.lista.map(x => ({ id: x.id || '', nombre: x.nombre, fisio: x.fisio, n: -x.saldo })) : null,
    sinMarcar: D.sinMarcar.map(cita), canceladas: D.canceladas.map(cita),
    fuera: D.fuera.map(d => ({ nombre: d.contact_name || '—', total: Number(d.total || 0) })),
    borradores: D.borradores.slice(0, 40).map(d => ({ nombre: d.contact_name || '—', fecha: String(d.date || '').slice(0, 10) })),
    facturas: D.facs.map(r => ({ num: r.fields['Nº FACTURA'] || '', concepto: [r.fields['CONCEPTO 1'], r.fields['CONCEPTO 2']].filter(Boolean).join(' + '), pago: (r.fields['MODO DE PAGO'] && r.fields['MODO DE PAGO'].name) || r.fields['MODO DE PAGO'] || '', total: Number(r.fields['TOTAL'] || 0) }))
  };
}
// Último día con citas antes de hoy (para abrir el reporte en el último día de trabajo)
async function ultimoDiaConCitas() {
  for (let n = 1; n <= 7; n++) { const f = madrid(-n).fecha; const c = await todos(CITAS_TABLE, `filterByFormula=${encodeURIComponent(`AND(DATETIME_FORMAT({FECHA},'YYYY-MM-DD')='${f}',TRIM({ESTADO})='REALIZADA')`)}&fields[]=FECHA&maxRecords=1`); if (c.length) return f; }
  return madrid(-1).fecha;
}
async function resumenFacturacion(ayer) {
  const { sf, rendDia, rendSemana, est, hechas, sinMarcar, facs, canceladas, caja, rep, envs, borradores, fuera, total } = await datosDia(ayer);
  const fila = (a, b, c) => `<tr><td style="padding:8px 0;border-bottom:1px solid #eee">${a}</td><td style="padding:8px 0;border-bottom:1px solid #eee;color:#7d6a60">${b}</td><td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right;font-weight:600">${c}</td></tr>`;
  const fechaTxt = `${DIAS[ayer.dia]} ${+ayer.fecha.slice(8)}/${+ayer.fecha.slice(5, 7)}`;
  const html = `<div style="font-family:Arial,sans-serif;background:#f7f3ef;padding:24px"><div style="max-width:560px;margin:0 auto;background:#fff;border-radius:16px;padding:24px;color:#1a1a1a">
  <div style="font-size:12px;color:#c2552e;font-weight:700;letter-spacing:1px">RESUMEN DIARIO</div>
  <h2 style="margin:6px 0 18px;font-size:20px">${fechaTxt}</h2>
  <p style="margin:0 0 4px">Sesiones hechas: <b>${hechas}</b> · Facturas emitidas: <b>${facs.length}</b> (${eur(total)})</p>
  ${Object.keys(caja).length ? `<p style="margin:6px 0 0;font-size:13.5px;color:#5c4f47">Caja: ${Object.entries(caja).map(([m, t]) => `${escH(m)} <b>${eur(t)}</b>`).join(' · ')}</p>` : ''}
  ${(() => { const fs = Object.entries(rep); if (!fs.length) return '';
    return `<h3 style="margin:22px 0 6px;font-size:15px">Check-list de los fisios</h3><table style="width:100%;border-collapse:collapse;font-size:13.5px">${fs.map(([f, x]) => { const e = envs[String(f).split(' ')[0].toLowerCase()];
      const noMarc = e ? String(e.marcados || '').split('\n').filter(l => l.startsWith('✗')).map(l => l.slice(2)) : [];
      const vistos = x.checks.filter(c => !c.aviso && c.items.length).map(c => `${escH(c.t)}: ${c.items.map(i => escH(i.nombre) + (i.extra ? ' (' + escH(i.extra) + ')' : '')).join(', ')}`);
      const estado = e ? `<b style="color:#16803c">✓ Enviado ${new Date(e.enviado).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' })}</b>` : `<b style="color:#b42318">✗ No ha enviado el check-list</b>`;
      return `<tr><td style="padding:10px 0;border-bottom:1px solid #eee;vertical-align:top"><b>${escH(f)}</b><br><span style="color:#7d6a60;font-size:12px">${x.hechas} ${x.hechas === 1 ? 'sesión hecha' : 'sesiones hechas'}</span></td><td style="padding:10px 0 10px 10px;border-bottom:1px solid #eee">${estado}${noMarc.length ? `<br><span style="color:#b45309">Sin marcar: ${noMarc.map(escH).join(' · ')}</span>` : e ? '<br><span style="color:#16803c">Todo marcado</span>' : ''}${vistos.length ? `<br><span style="color:#b42318">El panel ve pendiente → ${vistos.join(' · ')}</span>` : ''}${e && e.nota ? `<br><span style="color:#5c4f47">Nota: «${escH(e.nota)}»</span>` : ''}</td></tr>`; }).join('')}</table>`; })()}
  ${tablaRendimiento(rendDia, 'Rendimiento del día', true)}
  ${rendSemana ? tablaRendimiento(rendSemana, 'Rendimiento de la semana pasada', true) : ''}
  <p style="margin:8px 0 0;font-size:11px;color:#9b8f86">Reagendan = de los pacientes atendidos, cuántos tienen otra cita apuntada después · Faltas = no asistió o cita perdida</p>
  ${!sf.activo ? '' : sf.lista.length ? `<h3 style="margin:22px 0 6px;font-size:15px;color:#b42318">⚠️ Sesiones sin facturar (${sf.lista.reduce((t, x) => t - x.saldo, 0)})</h3><table style="width:100%;border-collapse:collapse;font-size:14px">${sf.lista.map(x => fila(escH(x.nombre), escH(x.fisio), (-x.saldo) + ' sin facturar')).join('')}</table>` : `<p style="margin:18px 0 0;color:#16803c;font-weight:600">✓ No hay sesiones sin facturar</p>`}
  ${sinMarcar.length ? `<h3 style="margin:22px 0 6px;font-size:15px;color:#b45309">Citas de ayer sin marcar (siguen en «Pendiente»): ${sinMarcar.length}</h3><table style="width:100%;border-collapse:collapse;font-size:14px">${sinMarcar.map(c => fila(escH(c.fields['your-name'] || ''), escH(fisioDe(c.fields['PREF.'])), escH(String(c.fields['HORA'] || '').slice(0, 5)))).join('')}</table>` : ''}
  ${fuera.length ? `<h3 style="margin:22px 0 6px;font-size:15px;color:#b42318">⚠️ Tickets de ayer hechos en Holded fuera del panel: ${fuera.length}</h3><p style="margin:0;font-size:13px;color:#5c4f47">No cuentan en el saldo de sesiones: ${fuera.map(d => escH((d.contact_name || '—') + ' ' + (d.total ? Number(d.total).toFixed(2) + ' €' : ''))).join(' · ')}</p>` : ''}
  ${borradores.length ? `<h3 style="margin:22px 0 6px;font-size:15px;color:#b45309">Tickets en borrador por aprobar en Holded: ${borradores.length}</h3><p style="margin:0;font-size:13px;color:#5c4f47">${borradores.slice(0, 30).map(d => escH((d.contact_name || '—') + ' · ' + String(d.date || '').slice(0, 10).split('-').reverse().join('/'))).join(' · ')}</p>` : ''}
  ${canceladas.length ? `<h3 style="margin:22px 0 6px;font-size:15px">Citas de ayer canceladas o que no vinieron: ${canceladas.length}</h3><table style="width:100%;border-collapse:collapse;font-size:14px">${canceladas.map(c => fila(escH(c.fields['your-name'] || ''), escH(fisioDe(c.fields['PREF.'])) + ' · ' + escH(est(c).toLowerCase()), escH(String(c.fields['HORA'] || '').slice(0, 5)))).join('')}</table>` : ''}
  ${facs.length ? `<h3 style="margin:22px 0 6px;font-size:15px">Facturas emitidas</h3><table style="width:100%;border-collapse:collapse;font-size:14px">${facs.map(r => fila(escH(r.fields['Nº FACTURA'] || ''), escH([r.fields['CONCEPTO 1'], r.fields['CONCEPTO 2']].filter(Boolean).join(' + ')) + (r.fields['MODO DE PAGO'] ? ' · ' + escH(r.fields['MODO DE PAGO']) : ''), eur(r.fields['TOTAL']))).join('')}</table>` : ''}
  </div></div>`;
  // Por email (además, el panel lo enseña en «Reporte diario»)
  const r = await fetch('https://api.brevo.com/v3/smtp/email', { method: 'POST', headers: { 'api-key': process.env.BREVO_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sender: { name: 'FISIO365', email: 'info@fisioterapia365.com' }, to: (await (SCH.emailsResumen ? SCH.emailsResumen() : Promise.resolve(String(process.env.RESUMEN_EMAIL || 'fisio365gestion@gmail.com').split(/[,;\s]+/).filter(Boolean)))).map(email => ({ email })), subject: `Resumen ${fechaTxt}${Object.keys(rep).some(f => !envs[String(f).split(' ')[0].toLowerCase()]) ? ' · ✗ falta algún check-list' : ''}${sf.lista.length ? ' · ⚠️ ' + sf.lista.length + ' pacientes sin facturar' : ''}${rendSemana ? ' · + semana' : ''}`, htmlContent: html }) });
  const email = r.ok ? 'enviado' : 'error brevo ' + r.status + ' ' + (await r.text().catch(() => '')).slice(0, 300);
  return email;
}

module.exports = async function handler(req, res) {
  const esCron = req.headers['authorization'] === `Bearer ${process.env.CRON_SECRET}`;
  const esPanel = false;
  if (!esCron) return res.status(401).json({ ok: false });
  // Resumen de facturación: 7:00 UTC (8 h en invierno, 9 h en verano), de las citas de ayer
  if (/resumen=1/.test(req.url || '')) {
    const ayer = madrid(-1);
    if (esPanel && horaMadrid() < 8) return res.status(200).json({ ok: true, saltado: 'Aún es pronto' });
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
module.exports.ultimoDiaConCitas = ultimoDiaConCitas;
