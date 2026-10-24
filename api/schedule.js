const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const BASE_ID = 'appsrGnHpFt8sVD5A';
const PLAN_TABLE = 'tblvgE0a4gsrj4Vhp';
const FISIOS_TABLE = 'tbl2mLUrnaKCFTs6g';
const INFORMES_TABLE = 'tblwvWQxXNJPdR0Iv';
const BIBLIO_TABLE = 'tbloqn3ts872ueJSE';

const HOLDED_KEY = process.env.HOLDED_API_KEY;
const { saldoPaciente, rendimiento, inicioControl } = require('./_push').saldo;
const PACIENTES = 'tbldBVgClS4HY2mOJ';
const HOLDED_URL = 'https://api.holded.com/api/invoicing/v1';

let cacheContactos = null, cacheT = 0;

const holded = async path => {
  const r = await fetch(HOLDED_URL + path, { headers: { key: HOLDED_KEY, accept: 'application/json' } });
  if (!r.ok) throw new Error('Holded ' + r.status);
  return r.json();
};
const normDni = t => String(t || '').toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/^ES/, '');
const soloDigitos = t => String(t || '').replace(/\D/g, '').slice(-9);

async function contactos() {
  if (cacheContactos && Date.now() - cacheT < 10 * 60 * 1000) return cacheContactos;
  let todos = [];
  for (let page = 1; page <= 40; page++) {
    const lote = await holded('/contacts?page=' + page);
    if (!Array.isArray(lote) || !lote.length) break;
    todos = todos.concat(lote);
    if (lote.length < 500) break;
  }
  cacheContactos = todos; cacheT = Date.now();
  return todos;
}

// Contactos de Holded que corresponden al paciente (por email o por móvil)
async function contactosDelPaciente(patientId) {
  const r = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${PACIENTES}/${patientId}`, { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } });
  if (!r.ok) return [];
  const f = (await r.json()).fields || {};
  const email = String(f['EMAIL'] || '').trim().toLowerCase();
  const tel = soloDigitos(f['WHATSAPP'] || f['TELF']);
  const dni = normDni(f['DNI']);
  const lista = await contactos();
  return lista.filter(c => {
    if (dni && dni.length >= 8 && normDni(c.code || c.vatnumber) === dni) return true;
    const ce = String(c.email || '').trim().toLowerCase();
    if (email && ce && ce === email) return true;
    if (tel && tel.length === 9 && (soloDigitos(c.mobile) === tel || soloDigitos(c.phone) === tel)) return true;
    return false;
  }).map(c => c.id);
}


// ── EMITIR FACTURA (botón de la tabla FACTURAS de Airtable) ─────────────────
// Se crea en Holded como ticket de venta (factura simplificada con DNI), en la serie por defecto,
// con el número que asigna Holded y nunca con fecha anterior a la última emitida.
const FACTURAS_TABLE = 'tblJw7suXLERn8AFQ';
const FF = { fecha: 'fldQ17bGOMaS0XaxJ', fechaVieja: 'fldqZyXkxhGRS1qvn', paciente: 'fldbmNoGhedI6ySSb', c1: 'fld3lRaKQbUYcW5qY', n1: 'fldWj0dUmJzTn0lgr', p1: 'fldu2QiBD9hM5scRC', c2: 'fldlkX8RO7crsVOye', n2: 'fldOW7e0lHx3Tfu4X', p2: 'fldkYc6HBh9E1YjUv', notas: 'fldoi8INIByEPPpMn', estado: 'fldWyEjNGH9CCRfmM', num: 'fldcTFAHH31Lsz53c', pdf: 'fld8jBu2P4sPB21ZC', aNombre: 'fldBW06oApJQaNlN9', aNif: 'fld6VO3g0KrFpAi6P', aDir: 'fldFK7NwsZ5AUY6qp' };
let emitiendo = Promise.resolve();
// Si Airtable dice «demasiadas peticiones» (429), espera y lo reintenta
const at = async (path, opt = {}) => { for (let i = 0; ; i++) { const r = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${path}`, { ...opt, headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': 'application/json', ...(opt.headers || {}) } }); if (r.status === 429 && i < 4) { await new Promise(z => setTimeout(z, 600 * (i + 1))); continue; } return r.json(); } };
const holdedPost = async (path, body) => { const r = await fetch(HOLDED_URL + path, { method: 'POST', headers: { key: HOLDED_KEY, accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const d = await r.json().catch(() => ({})); if (!r.ok || d.status === 0) throw new Error(d.info || d.message || ('Holded ' + r.status)); return d; };
const pagina = (ok, titulo, texto) => `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${titulo}</title><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600&display=swap" rel="stylesheet"><style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f7f3ef;font-family:Poppins,sans-serif;color:#1a1a1a;padding:16px;box-sizing:border-box}.c{background:#fff;border-radius:20px;padding:32px 28px;max-width:420px;width:100%;text-align:center}.i{width:56px;height:56px;border-radius:50%;margin:0 auto 14px;display:flex;align-items:center;justify-content:center;font-size:28px;color:#fff;background:${ok ? '#16a34a' : '#c2552e'}}h1{font-size:20px;margin:0 0 8px}p{margin:0;color:#6b5f57;line-height:1.5}</style></head><body><div class="c"><div class="i">${ok ? '✓' : '!'}</div><h1>${titulo}</h1><p>${texto}</p><p style="margin-top:16px;font-size:13px">Ya puedes cerrar esta pestaña.</p></div></body></html>`;
const escHtml = t => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function emitirFactura(recId) {
  const rec = await at(`${FACTURAS_TABLE}/${recId}?returnFieldsByFieldId=true`);
  if (rec.error) throw new Error('No encuentro esa fila de FACTURAS');
  const f = rec.fields || {};
  const nombreSel = v => (v && typeof v === 'object' ? v.name : v) || '';
  if (f[FF.num]) return { ya: true, num: f[FF.num] };
  const pacId = (f[FF.paciente] || [])[0];
  if (!pacId) throw new Error('Falta elegir el PACIENTE');
  const lineas = [];
  for (const [c, n, pr] of [[FF.c1, FF.n1, FF.p1], [FF.c2, FF.n2, FF.p2]]) {
    const concepto = nombreSel(f[c]), uds = Number(f[n] || 0), precio = Number(f[pr] || 0);
    if (!concepto && !uds && !precio) continue;
    if (!concepto || !uds || !precio) throw new Error('Cada línea necesita concepto, nº de sesiones y precio');
    lineas.push({ concepto, uds, precio });
  }
  if (!lineas.length) throw new Error('Falta la línea 1 (concepto, nº de sesiones y precio)');
  const notas = String(f[FF.notas] || '').trim();

  // Fecha: hoy, o la de la fila si es anterior a hoy y no anterior a la última factura emitida
  const ahora = Math.floor(Date.now() / 1000);
  const recientes = await holded('/documents/salesreceipt?starttmp=' + (ahora - 400 * 86400) + '&endtmp=' + (ahora + 86400)).catch(() => []);
  const ultima = (Array.isArray(recientes) ? recientes : []).filter(d => !d.draft).sort((a, b) => (b.date || 0) - (a.date || 0))[0];
  let fecha = ahora;
  const fFila = f[FF.fecha] || f[FF.fechaVieja];
  if (fFila) {
    const fd = Math.floor(new Date(fFila + 'T12:00:00Z').getTime() / 1000);
    if (fd > ahora + 86400) throw new Error('La fecha no puede ser futura');
    if (ultima && ultima.date && fd < ultima.date - 43200) throw new Error('La fecha es anterior a la última factura emitida (' + new Date(ultima.date * 1000).toLocaleDateString('es-ES') + '). Deja la fecha vacía para usar la de hoy.');
    if (fd < ahora - 43200) fecha = fd;
  }
  // IVA: el mismo que lleva la última factura de la serie (sanitaria exenta → 0)
  const tax = ultima && ultima.products && ultima.products[0] && ultima.products[0].tax != null ? Number(ultima.products[0].tax) : 0;

  // Contacto: «Facturar a» si está rellenado; si no, el paciente (por DNI)
  let datos;
  if (String(f[FF.aNombre] || '').trim()) {
    datos = { name: String(f[FF.aNombre]).trim(), code: normDni(f[FF.aNif]), address: String(f[FF.aDir] || '').trim() };
  } else {
    const pac = await at(`${PACIENTES}/${pacId}`);
    const pf = pac.fields || {};
    if (!pf['DNI']) throw new Error('El paciente no tiene DNI en Airtable');
    datos = { name: String(pf['FULL NAME'] || '').trim(), code: normDni(pf['DNI']), email: pf['EMAIL'] || '', mobile: pf['WHATSAPP'] || pf['TELF'] || '' };
  }
  if (!datos.code) throw new Error('Falta el DNI/NIF de quien recibe la factura');
  const lista = await contactos();
  let contacto = lista.find(c => normDni(c.code || c.vatnumber) === datos.code);
  let contactId = contacto && contacto.id;
  if (!contactId) {
    const body = { name: datos.name, code: datos.code, type: 'client', isperson: !/^[A-HJ-NP-SUVW]/.test(datos.code) };
    if (datos.email) body.email = datos.email;
    if (datos.mobile) body.mobile = datos.mobile;
    if (datos.address) body.billAddress = { address: datos.address };
    const c = await holdedPost('/contacts', body);
    contactId = c.id; cacheContactos = null;
  }

  const doc = await holdedPost('/documents/salesreceipt', {
    contactId, date: fecha, notes: notas,
    items: lineas.map(l => ({ name: l.concepto === 'Otros' && notas ? notas.split('\n')[0].slice(0, 120) : l.concepto, units: l.uds, subtotal: l.precio, tax }))
  });
  const docId = doc.id;
  const creado = await holded('/documents/salesreceipt/' + docId).catch(() => ({}));
  const num = creado.docNumber || doc.invoiceNum || docId;
  const campos = { [FF.estado]: 'Emitida', [FF.num]: String(num), [FF.fecha]: new Date(fecha * 1000).toISOString().slice(0, 10), [FF.fechaVieja]: new Date(fecha * 1000).toISOString().slice(0, 10) };
  await at(`${FACTURAS_TABLE}/${recId}`, { method: 'PATCH', body: JSON.stringify({ fields: campos, typecast: true }) });
  try {
    const pdf = await holded('/documents/salesreceipt/' + docId + '/pdf');
    if (pdf && pdf.data) await fetch(`https://content.airtable.com/v0/${BASE_ID}/${recId}/${FF.pdf}/uploadAttachment`, { method: 'POST', headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ contentType: 'application/pdf', file: pdf.data, filename: 'Factura_' + String(num).replace(/[^\w-]/g, '_') + '.pdf' }) });
  } catch (e) {}
  return { num, otro: !!String(f[FF.aNombre] || '').trim(), total: lineas.reduce((t, l) => t + l.uds * l.precio, 0) };
}

async function listarFacturas(ids) {
  let facturas = [];
  // Tickets de venta (lo habitual: llevan DNI y sirven como factura) y facturas
  for (const cid of ids) for (const tipoDoc of ['salesreceipt', 'invoice']) {
    const docs = await holded('/documents/' + tipoDoc + '?contactid=' + encodeURIComponent(cid)).catch(() => []);
    (Array.isArray(docs) ? docs : []).forEach(d => {
      if (d.draft) return;
      facturas.push({ id: d.id, tipo: tipoDoc, numero: d.docNumber || '', fecha: d.date || 0, total: Number(d.total || 0), pagada: d.status === 1, concepto: (d.products && d.products[0] && d.products[0].name) || d.desc || '' });
    });
  }
  facturas.sort((a, b) => b.fecha - a.fecha);
  return facturas;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { patientId, action } = req.query;

  if (action === 'emitir') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    const { rec, k } = req.query;
    if (!process.env.EMITIR_TOKEN || k !== process.env.EMITIR_TOKEN) return res.status(401).send(pagina(false, 'Enlace no válido', 'Este botón no está bien configurado.'));
    if (!HOLDED_KEY) return res.status(200).send(pagina(false, 'Holded no está conectado', 'Falta añadir la clave de Holded en Vercel.'));
    if (!/^rec[A-Za-z0-9]{14}$/.test(rec || '')) return res.status(400).send(pagina(false, 'Fila no válida', 'No se ha podido identificar la factura.'));
    // De una en una, para que la numeración salga siempre en orden
    const turno = emitiendo.then(() => emitirFactura(rec));
    emitiendo = turno.catch(() => {});
    try {
      const r = await turno;
      if (r.ya) return res.status(200).send(pagina(true, 'Ya estaba emitida', 'Esta factura ya se emitió con el número ' + escHtml(r.num) + '. No se ha creado otra.'));
      return res.status(200).send(pagina(true, 'Factura ' + escHtml(r.num) + ' emitida', 'Creada en Holded por ' + r.total.toLocaleString('es-ES', { minimumFractionDigits: 2 }) + ' €.' + (r.otro ? ' Va a nombre de otra persona, así que no aparece en la app del paciente.' : ' Ya le aparece al paciente en su app.')));
    } catch (e) {
      try { await at(`${FACTURAS_TABLE}/${rec}`, { method: 'PATCH', body: JSON.stringify({ fields: { [FF.estado]: 'Error' }, typecast: true }) }); } catch (x) {}
      return res.status(200).send(pagina(false, 'No se ha emitido', escHtml(e.message)));
    }
  }

  // ── PANEL: rendimiento de los fisios ──
  if (action === 'rendimiento') {
    if (!process.env.FISIO_PASSWORD || String(req.query.pwd || '').trim() !== process.env.FISIO_PASSWORD.trim()) return res.status(401).json({ ok: false, error: 'No autorizado' });
    const { desde, hasta } = req.query;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(desde || '') || !/^\d{4}-\d{2}-\d{2}$/.test(hasta || '')) return res.status(400).json({ ok: false, error: 'Fechas no válidas' });
    try { const [fisios, ini] = await Promise.all([rendimiento(desde, hasta), inicioControl().catch(() => '')]); return res.status(200).json({ ok: true, fisios, conPack: !!ini }); }
    catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
  }

  // ── PANEL: SEGUIMIENTO (lista de pacientes a llamar) y LLAMADAS ──
  if (action && action.startsWith('seg-')) {
    const q = req.method === 'POST' ? (req.body || {}) : req.query;
    if (!process.env.FISIO_PASSWORD || String(q.pwd || '').trim() !== process.env.FISIO_PASSWORD.trim()) return res.status(401).json({ ok: false, error: 'No autorizado' });
    const SEG = 'tblu9YxiktpAh5w87', LLA = 'tbla5rZTwMkMpAiaI', CIT = 'tblTPlcuiSjQngkaD';
    const todosT = async (t, query) => { let recs = [], off = ''; do { const d = await at(`${t}?${query}&pageSize=100${off ? '&offset=' + off : ''}`); if (d.error) throw new Error(d.error.message || 'Airtable'); recs = recs.concat(d.records || []); off = d.offset || ''; } while (off); return recs; };
    const hoyF = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    try {
      if (action === 'seg-lista') {
        const pendP = todosT(SEG, `filterByFormula=${encodeURIComponent('NOT({HECHO})')}&sort[0][field]=FECHA DE LLAMADA&sort[0][direction]=asc`);
        const prevP = todosT(LLA, `filterByFormula=${encodeURIComponent(`AND({SEG ID}!='',IS_AFTER({FECHA},DATEADD(TODAY(),-180,'days')))`)}&sort[0][field]=FECHA&sort[0][direction]=desc`).catch(() => []);
        const conRango = /^\d{4}-\d{2}-\d{2}$/.test(q.desde || '') && /^\d{4}-\d{2}-\d{2}$/.test(q.hasta || '');
        const mvD = (f, n) => { const d = new Date(f + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
        const rgo = conRango ? `AND(IS_AFTER({FECHA},DATETIME_PARSE('${mvD(q.desde, -1)}','YYYY-MM-DD')),IS_BEFORE({FECHA},DATETIME_PARSE('${mvD(q.hasta, 2)}','YYYY-MM-DD')))` : `IS_AFTER({FECHA},DATEADD(TODAY(),-30,'days'))`;
        const diaMad = x => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(x));
        const llamP = todosT(LLA, `filterByFormula=${encodeURIComponent(rgo)}&sort[0][field]=FECHA&sort[0][direction]=desc`);
        const [pend, llamRaw, prev] = await Promise.all([pendP, llamP, prevP]);
        const llam = llamRaw.filter(r => { if (!conRango) return true; const f = r.fields['FECHA']; if (!f) return false; const d = String(f).includes('T') ? diaMad(f) : String(f).slice(0, 10); return d >= q.desde && d <= q.hasta; });
        // Última llamada de cada fila pendiente (para ver en «Por llamar» qué pasó la vez anterior)
        const segIds = new Set(pend.map(r => r.id)), ultLl = {};
        if (segIds.size) {
          prev.forEach(r => { const sid = r.fields['SEG ID']; if (!segIds.has(sid) || ultLl[sid]) return; const fx = String(r.fields['FECHA'] || ''); ultLl[sid] = { fecha: fx.includes('T') ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(fx)) : fx.slice(0, 10), quien: (r.fields['QUIEN LLAMA'] && r.fields['QUIEN LLAMA'].name) || r.fields['QUIEN LLAMA'] || '', resultado: String((r.fields['RESULTADO'] && r.fields['RESULTADO'].name) || r.fields['RESULTADO'] || '').trim(), nota: r.fields['NOTAS'] || '' }; }); }
        const ids = [...new Set([...pend, ...llam].map(r => ((r.fields['PACIENTE'] || [])[0])).filter(Boolean))];
        const pacInfo = {}, fisioDe = {};
        const lotes = []; for (let i = 0; i < ids.length; i += 40) lotes.push(ids.slice(i, i + 40));
        await Promise.all(lotes.map(async lote => {
          const [ps, cs] = await Promise.all([
            todosT(PACIENTES, `filterByFormula=${encodeURIComponent('OR(' + lote.map(id => `RECORD_ID()='${id}'`).join(',') + ')')}&fields[]=FULL NAME&fields[]=WHATSAPP&fields[]=TELF`),
            todosT(CIT, `filterByFormula=${encodeURIComponent(`AND(TRIM({ESTADO})='REALIZADA',OR(${lote.map(id => `FIND('${id}',ARRAYJOIN({PacienteRec}))`).join(',')}))`)}&fields[]=FECHA&fields[]=PREF.&fields[]=RELACIÓN - CITA`)
          ]);
          ps.forEach(p => { pacInfo[p.id] = { nombre: p.fields['FULL NAME'] || '—', tel: p.fields['WHATSAPP'] || p.fields['TELF'] || '' }; });
          cs.forEach(c => { const f = String(c.fields['FECHA'] || ''); const pf = c.fields['PREF.']; const n = (pf && typeof pf === 'object' ? pf.name : pf) || ''; (c.fields['RELACIÓN - CITA'] || []).forEach(id => { if (!fisioDe[id] || f > fisioDe[id].f) fisioDe[id] = { f, n }; }); });
        }));
        const info = id => ({ pacienteId: id || '', ...(pacInfo[id] || { nombre: '—', tel: '' }), fisio: (fisioDe[id] || {}).n || '', ultima: (fisioDe[id] || {}).f || '' });
        return res.status(200).json({ ok: true, hoy: hoyF,
          pendientes: pend.map(r => ({ id: r.id, ult: ultLl[r.id] || null, fecha: r.fields['FECHA DE LLAMADA'] || '', nota: r.fields['NOTAS'] || '', responsable: (r.fields['RESPONSABLE'] && r.fields['RESPONSABLE'].name) || r.fields['RESPONSABLE'] || '', ...info((r.fields['PACIENTE'] || [])[0]) })),
          hechas: llam.map(r => { const fx = String(r.fields['FECHA'] || ''); let fecha = fx.slice(0, 10), hora = ''; if (fx.includes('T')) { const dt = new Date(fx); const pz = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(dt).reduce((o, p) => (o[p.type] = p.value, o), {}); fecha = `${pz.year}-${pz.month}-${pz.day}`; hora = `${pz.hour === '24' ? '00' : pz.hour}:${pz.minute}`; } return ({ id: r.id, segId: r.fields['SEG ID'] || '', fecha, hora, quien: (r.fields['QUIEN LLAMA'] && r.fields['QUIEN LLAMA'].name) || r.fields['QUIEN LLAMA'] || '', resultado: String((r.fields['RESULTADO'] && r.fields['RESULTADO'].name) || r.fields['RESULTADO'] || '').trim(), nota: r.fields['NOTAS'] || '', resena: !!r.fields['RESEÑA'] || /rese[ñn]a/i.test(String(r.fields['NOTAS'] || '')), ...info((r.fields['PACIENTE'] || [])[0]) }); }) });
      }
      if (action === 'seg-tareas') {
        const PT = 'tblxPpPSvj15NWqNT';
        const rs = await todosT(PT, `filterByFormula=${encodeURIComponent('NOT({HECHO})')}&sort[0][field]=FECHA&sort[0][direction]=asc`);
        const pids = [...new Set(rs.map(r => (r.fields['PACIENTE'] || [])[0]).filter(Boolean))], pn = {};
        for (let i = 0; i < pids.length; i += 40) (await todosT(PACIENTES, `filterByFormula=${encodeURIComponent('OR(' + pids.slice(i, i + 40).map(id => `RECORD_ID()='${id}'`).join(',') + ')')}&fields[]=FULL NAME&fields[]=WHATSAPP&fields[]=TELF`)).forEach(p => { pn[p.id] = { nombre: p.fields['FULL NAME'] || '', tel: p.fields['WHATSAPP'] || p.fields['TELF'] || '' }; });
        return res.status(200).json({ ok: true, hoy: hoyF, tareas: rs.map(r => { const pid = (r.fields['PACIENTE'] || [])[0] || ''; return { id: r.id, texto: r.fields['TAREA'] || '', fecha: r.fields['FECHA'] || hoyF, para: (r.fields['PARA'] && r.fields['PARA'].name) || r.fields['PARA'] || '', nota: r.fields['NOTA'] || '', creadaPor: r.fields['CREADA POR'] || '', pacienteId: pid, paciente: (pn[pid] || {}).nombre || '', tel: (pn[pid] || {}).tel || '' }; }) });
      }
      if (req.method !== 'POST') return res.status(405).json({ ok: false });
      if (action === 'seg-crear') {
        if (!/^rec[A-Za-z0-9]{14}$/.test(q.pacienteId || '') || !/^\d{4}-\d{2}-\d{2}$/.test(q.fecha || '')) return res.status(400).json({ ok: false, error: 'Faltan datos' });
        const fc = { 'FECHA DE LLAMADA': q.fecha, PACIENTE: [q.pacienteId], NOTAS: String(q.nota || '') }; if (q.responsable) fc.RESPONSABLE = String(q.responsable);
        // Si ya está en «Por llamar», se actualiza esa fila en vez de duplicar al paciente
        const ya = (await todosT(SEG, `filterByFormula=${encodeURIComponent(`AND(NOT({HECHO}),FIND('${q.pacienteId}',ARRAYJOIN({PacRec})))`)}`).catch(() => []))[0];
        if (ya) { const nota0 = String(ya.fields['NOTAS'] || '').trim(), nota1 = String(q.nota || '').trim(); const f = { 'FECHA DE LLAMADA': q.fecha, NOTAS: nota1 && !nota0.includes(nota1) ? (nota0 ? nota0 + '\n' + nota1 : nota1) : nota0 }; if (q.responsable) f.RESPONSABLE = String(q.responsable);
          const d = await at(`${SEG}/${ya.id}`, { method: 'PATCH', body: JSON.stringify({ fields: f, typecast: true }) }); return res.status(200).json({ ok: !d.error, actualizado: true, error: d.error && d.error.message }); }
        const d = await at(SEG, { method: 'POST', body: JSON.stringify({ records: [{ fields: fc }], typecast: true }) });
        return res.status(200).json({ ok: !d.error, error: d.error && d.error.message });
      }
      if (action === 'seg-tarea-guardar' || action === 'seg-tarea-hecha' || action === 'seg-tarea-borrar') {
        const PT = 'tblxPpPSvj15NWqNT';
        if (action === 'seg-tarea-hecha' || action === 'seg-tarea-borrar') { if (!/^rec[A-Za-z0-9]{14}$/.test(q.id || '')) return res.status(400).json({ ok: false });
          const d = action === 'seg-tarea-borrar' ? await at(`${PT}/${q.id}`, { method: 'DELETE' }) : await at(`${PT}/${q.id}`, { method: 'PATCH', body: JSON.stringify({ fields: { HECHO: q.hecho !== false } }) });
          return res.status(200).json({ ok: !d.error }); }
        const texto = String(q.texto || '').trim().slice(0, 300); if (!texto) return res.status(400).json({ ok: false, error: 'Escribe la tarea' });
        const f = { TAREA: texto, NOTA: String(q.nota || ''), FECHA: /^\d{4}-\d{2}-\d{2}$/.test(q.fecha || '') ? q.fecha : hoyF, PARA: q.para ? String(q.para) : null, PACIENTE: /^rec[A-Za-z0-9]{14}$/.test(q.pacienteId || '') ? [q.pacienteId] : [] };
        if (!q.id) f['CREADA POR'] = String(q.creadaPor || '');
        const d = q.id && /^rec[A-Za-z0-9]{14}$/.test(q.id) ? await at(`${PT}/${q.id}`, { method: 'PATCH', body: JSON.stringify({ fields: f, typecast: true }) }) : await at(PT, { method: 'POST', body: JSON.stringify({ records: [{ fields: f }], typecast: true }) });
        return res.status(200).json({ ok: !d.error, error: d.error && d.error.message });
      }
      if (action === 'seg-resultado') {
        if (!/^rec[A-Za-z0-9]{14}$/.test(q.id || '')) return res.status(400).json({ ok: false });
        const MAP = { 'Cita recuperada': 'CITA RECUPERADA ', 'Volver a llamar': 'VOLVER A LLAMAR', 'No contesta': 'NC - VOLVER A LLAMAR', 'Pendiente de respuesta': 'PENDIENTE RESPUESTA ', 'Alta': 'ALTA' };
        const quienMap = { jonathan: 'JONY', jony: 'JONY', sara: 'SARA', ramiro: 'RAMIRO', nora: 'NORA', juan: 'JUAN' };
        const quien = quienMap[String(q.quien || '').split(' ')[0].toLowerCase()];
        const ll = { FECHA: new Date().toISOString(), NOTAS: String(q.nota || ''), RESULTADO: MAP[q.resultado] || q.resultado };
        if (/^rec[A-Za-z0-9]{14}$/.test(q.pacienteId || '')) ll.PACIENTE = [q.pacienteId];
        if (quien) ll['QUIEN LLAMA'] = quien;
        if (q.nuevaFecha) ll['FECHA PDTE LLAMAR'] = q.nuevaFecha;
        if (q.resena) ll['RESEÑA'] = true;
        ll['SEG ID'] = q.id;
        await at(LLA, { method: 'POST', body: JSON.stringify({ records: [{ fields: ll }], typecast: true }) });
        const sigue = /^\d{4}-\d{2}-\d{2}$/.test(q.nuevaFecha || '') && ['Volver a llamar', 'No contesta', 'Pendiente de respuesta'].includes(q.resultado);
        const campos = sigue ? { 'FECHA DE LLAMADA': q.nuevaFecha } : { HECHO: true };
        const d = await at(`${SEG}/${q.id}`, { method: 'PATCH', body: JSON.stringify({ fields: campos }) });
        return res.status(200).json({ ok: !d.error, error: d.error && d.error.message });
      }
      if (action === 'seg-editar') {
        if (!/^rec[A-Za-z0-9]{14}$/.test(q.id || '')) return res.status(400).json({ ok: false });
        const f = {}; if (/^\d{4}-\d{2}-\d{2}$/.test(q.fecha || '')) f['FECHA DE LLAMADA'] = q.fecha; if (q.nota != null) f.NOTAS = String(q.nota); if (q.responsable != null) f.RESPONSABLE = q.responsable || null;
        const d = await at(`${SEG}/${q.id}`, { method: 'PATCH', body: JSON.stringify({ fields: f, typecast: true }) });
        return res.status(200).json({ ok: !d.error });
      }
      if (action === 'seg-editar-llamada') {
        if (!/^rec[A-Za-z0-9]{14}$/.test(q.id || '')) return res.status(400).json({ ok: false });
        const MAP = { 'Cita recuperada': 'CITA RECUPERADA ', 'Volver a llamar': 'VOLVER A LLAMAR', 'No contesta': 'NC - VOLVER A LLAMAR', 'Pendiente de respuesta': 'PENDIENTE RESPUESTA ', 'Alta': 'ALTA' };
        const f = {}; if (q.resultado) f.RESULTADO = MAP[q.resultado] || q.resultado; if (q.nota != null) f.NOTAS = String(q.nota); if (q.resena != null) f['RESEÑA'] = !!q.resena; { const qm = { jonathan: 'JONY', jony: 'JONY', sara: 'SARA', ramiro: 'RAMIRO', nora: 'NORA', juan: 'JUAN' }[String(q.quien || '').split(' ')[0].toLowerCase()]; if (qm) f['QUIEN LLAMA'] = qm; }
        const d = await at(`${LLA}/${q.id}`, { method: 'PATCH', body: JSON.stringify({ fields: f, typecast: true }) });
        // Volver a «Por llamar»: reabre su fila de SEGUIMIENTO (por SEG ID o, si es antigua, la última del paciente)
        if (q.reabrir) {
          let segId = /^rec[A-Za-z0-9]{14}$/.test(q.segId || '') ? q.segId : '';
          if (!segId && /^rec[A-Za-z0-9]{14}$/.test(q.pacienteId || '')) {
            const cand = await todosT(SEG, `filterByFormula=${encodeURIComponent(`AND({HECHO},FIND('${q.pacienteId}',ARRAYJOIN({PacRec})))`)}&sort[0][field]=FECHA DE LLAMADA&sort[0][direction]=desc`).catch(() => []);
            segId = (cand[0] || {}).id || '';
          }
          if (segId) await at(`${SEG}/${segId}`, { method: 'PATCH', body: JSON.stringify({ fields: { HECHO: false, 'FECHA DE LLAMADA': /^\d{4}-\d{2}-\d{2}$/.test(q.fecha || '') ? q.fecha : hoyF } }) });
          else if (/^rec[A-Za-z0-9]{14}$/.test(q.pacienteId || '')) await at(SEG, { method: 'POST', body: JSON.stringify({ records: [{ fields: { PACIENTE: [q.pacienteId], 'FECHA DE LLAMADA': hoyF, NOTAS: String(q.nota || '') } }] }) });
        }
        return res.status(200).json({ ok: !d.error, error: d.error && d.error.message });
      }
      return res.status(400).json({ ok: false });
    } catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
  }

  // ── PANEL: ESTADO de los pacientes (etiquetas de la tabla ESTADO) ──
  if (action === 'estados' || action === 'estado-paciente') {
    const q = req.method === 'POST' ? (req.body || {}) : req.query;
    if (!process.env.FISIO_PASSWORD || String(q.pwd || '').trim() !== process.env.FISIO_PASSWORD.trim()) return res.status(401).json({ ok: false, error: 'No autorizado' });
    if (action === 'estados') {
      const d = await at(`tbldOsLe8iw78Wun7?fields[]=ESTADO&pageSize=100`);
      return res.status(200).json({ ok: true, estados: (d.records || []).map(r => ({ id: r.id, nombre: String(r.fields['ESTADO'] || '').trim() })).filter(e => e.nombre).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')) });
    }
    if (req.method !== 'POST' || !/^rec[A-Za-z0-9]{14}$/.test(q.pacienteId || '')) return res.status(400).json({ ok: false });
    const ids = (Array.isArray(q.estados) ? q.estados : []).filter(x => /^rec[A-Za-z0-9]{14}$/.test(x));
    const d = await at(`${PACIENTES}/${q.pacienteId}`, { method: 'PATCH', body: JSON.stringify({ fields: { ESTADO: ids } }) });
    return res.status(200).json({ ok: !d.error, error: d.error && d.error.message });
  }

  // ── PANEL: el fisio explica por qué un paciente no ha reagendado ──
  if (action === 'nota-reagenda' && req.method === 'POST') {
    const q = req.body || {};
    if (!process.env.FISIO_PASSWORD || String(q.pwd || '').trim() !== process.env.FISIO_PASSWORD.trim()) return res.status(401).json({ ok: false, error: 'No autorizado' });
    if (!/^rec[A-Za-z0-9]{14}$/.test(q.pacienteId || '')) return res.status(400).json({ ok: false });
    const hoyF = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const d = await at(`${PACIENTES}/${q.pacienteId}`, { method: 'PATCH', body: JSON.stringify({ fields: { 'POR QUÉ NO REAGENDA': String(q.nota || '').slice(0, 2000), 'POR QUÉ FECHA': hoyF, 'POR QUÉ FISIO': String(q.fisio || '') } }) });
    return res.status(200).json({ ok: !d.error, fecha: hoyF, error: d.error && d.error.message });
  }

  // ── PANEL: control de horas de los fisios (tabla HORAS FISIOS) ──
  if (action === 'horas' || action === 'horas-guardar' || action === 'horas-borrar') {
    const q = req.method === 'POST' ? (req.body || {}) : req.query;
    if (!process.env.FISIO_PASSWORD || String(q.pwd || '').trim() !== process.env.FISIO_PASSWORD.trim()) return res.status(401).json({ ok: false, error: 'No autorizado' });
    const T = 'tblrLdMdmTXvM84Kt';
    const fisio = String(q.fisio || '').trim();
    try {
      if (action === 'horas') {
        if (!fisio) return res.status(400).json({ ok: false });
        const esc = fisio.replace(/'/g, "\\'");
        let recs = [], off = '';
        do { const d = await at(`${T}?filterByFormula=${encodeURIComponent(`LOWER({FISIO})=LOWER('${esc}')`)}&pageSize=100${off ? '&offset=' + off : ''}`); recs = recs.concat(d.records || []); off = d.offset || ''; } while (off);
        const todos = recs.map(r => ({ id: r.id, fecha: r.fields['FECHA'] || '', tipo: r.fields['TIPO'] || '', horas: Number(r.fields['HORAS'] || 0), banco: !!r.fields['BANCO'], nota: r.fields['NOTA'] || '', por: r.fields['REGISTRADO POR'] || '' }));
        const { desde, hasta } = q;
        const banco = todos.filter(r => r.banco && (!hasta || r.fecha <= hasta)).reduce((t, r) => t + r.horas, 0);
        const registros = todos.filter(r => (!desde || r.fecha >= desde) && (!hasta || r.fecha <= hasta)).sort((a, b) => a.fecha.localeCompare(b.fecha));
        return res.status(200).json({ ok: true, registros, banco });
      }
      if (req.method !== 'POST') return res.status(405).json({ ok: false });
      if (action === 'horas-borrar') {
        if (!/^rec[A-Za-z0-9]{14}$/.test(q.id || '')) return res.status(400).json({ ok: false });
        await fetch(`https://api.airtable.com/v0/${BASE_ID}/${T}/${q.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } });
        return res.status(200).json({ ok: true });
      }
      if (!fisio || !/^\d{4}-\d{2}-\d{2}$/.test(q.fecha || '')) return res.status(400).json({ ok: false, error: 'Faltan datos' });
      const campos = { FECHA: q.fecha, FISIO: fisio, TIPO: String(q.tipo || 'Otro'), HORAS: Number(q.horas || 0), BANCO: !!q.banco, NOTA: String(q.nota || ''), 'REGISTRADO POR': String(q.por || '') };
      const ex = /^rec[A-Za-z0-9]{14}$/.test(q.id || '');
      const d = await at(`${T}${ex ? '/' + q.id : ''}`, { method: ex ? 'PATCH' : 'POST', body: JSON.stringify(ex ? { fields: campos, typecast: true } : { records: [{ fields: campos }], typecast: true }) });
      if (d.error) return res.status(500).json({ ok: false, error: d.error.message || 'Airtable' });
      return res.status(200).json({ ok: true, id: ex ? q.id : d.records[0].id });
    } catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
  }

  // ── PANEL: facturas de la ficha y emitir desde el panel ──
  if (action === 'ficha-facturas' || action === 'facturar') {
    const q = req.method === 'POST' ? (req.body || {}) : req.query;
    if (!process.env.FISIO_PASSWORD || String(q.pwd || '').trim() !== process.env.FISIO_PASSWORD.trim()) return res.status(401).json({ ok: false, error: 'No autorizado' });
    const pac = q.pacienteId || patientId;
    if (!/^rec[A-Za-z0-9]{14}$/.test(pac || '')) return res.status(400).json({ ok: false, error: 'Falta paciente' });
    if (action === 'ficha-facturas') {
      const pr = await at(`${PACIENTES}/${pac}`);
      const dni = (pr.fields || {})['DNI'] || '';
      const saldo = await saldoPaciente(pac).catch(() => ({ activo: false }));
      if (!HOLDED_KEY) return res.status(200).json({ ok: true, holded: false, dni, saldo, facturas: [] });
      try { return res.status(200).json({ ok: true, holded: true, dni, saldo, facturas: await listarFacturas(await contactosDelPaciente(pac)) }); }
      catch (e) { return res.status(200).json({ ok: true, holded: true, dni, saldo, facturas: [], error: 'No se han podido cargar las facturas' }); }
    }
    if (req.method !== 'POST') return res.status(405).json({ ok: false });
    if (!HOLDED_KEY) return res.status(200).json({ ok: false, error: 'Holded todavía no está conectado (falta la clave en Vercel).' });
    const lineas = (Array.isArray(q.lineas) ? q.lineas : []).slice(0, 2);
    if (!lineas.length) return res.status(400).json({ ok: false, error: 'Falta el concepto' });
    if (q.dni && normDni(q.dni).length >= 8) await at(`${PACIENTES}/${pac}`, { method: 'PATCH', body: JSON.stringify({ fields: { DNI: String(q.dni).trim().toUpperCase() } }) });
    const fa = q.facturarA || {};
    const campos = { [FF.paciente]: [pac], 'fldpruhLn03x1x6zI': pac, [FF.notas]: String(q.notas || ''), [FF.estado]: 'Pendiente' };
    if (q.modoPago) campos['fldafSkOOldJ8gH70'] = q.modoPago;
    if (/^\d{4}-\d{2}-\d{2}$/.test(q.fecha || '')) campos[FF.fecha] = q.fecha;
    if (fa.nombre) { campos[FF.aNombre] = String(fa.nombre); campos[FF.aNif] = String(fa.nif || ''); campos[FF.aDir] = String(fa.direccion || ''); }
    [[FF.c1, FF.n1, FF.p1], [FF.c2, FF.n2, FF.p2]].forEach(([c, n, pr], i) => { const l = lineas[i]; if (!l) return; campos[c] = String(l.concepto || ''); campos[n] = Number(l.uds || 0); campos[pr] = Number(l.precio || 0); });
    const cr = await at(FACTURAS_TABLE, { method: 'POST', body: JSON.stringify({ records: [{ fields: campos }], typecast: true }) });
    const rec = cr.records && cr.records[0] && cr.records[0].id;
    if (!rec) return res.status(500).json({ ok: false, error: (cr.error && cr.error.message) || 'No se ha podido guardar en Airtable' });
    const turno = emitiendo.then(() => emitirFactura(rec));
    emitiendo = turno.catch(() => {});
    try { const r = await turno; return res.status(200).json({ ok: true, num: r.num, total: r.total, otro: r.otro }); }
    catch (e) {
      try { await at(`${FACTURAS_TABLE}/${rec}`, { method: 'PATCH', body: JSON.stringify({ fields: { [FF.estado]: 'Error' }, typecast: true }) }); } catch (x) {}
      return res.status(200).json({ ok: false, error: e.message });
    }
  }

  if (!patientId) return res.status(400).json({ error: 'Falta patientId' });

  // ── FACTURAS DEL PACIENTE (Holded, solo lectura) ─────────────────────────
  if (action === 'facturas') {
    const id = req.query.id;
    if (!/^rec[A-Za-z0-9]{14}$/.test(patientId || '')) return res.status(400).json({ ok: false, error: 'Falta paciente' });
  if (!HOLDED_KEY) return res.status(200).json({ ok: false, sinConfigurar: true, facturas: [] });
    try {
      const ids = await contactosDelPaciente(patientId);
      if (id) {
        if (!/^[a-f0-9]{24}$/i.test(id)) return res.status(400).json({ ok: false, error: 'Factura no válida' });
        const tipoDoc = req.query.tipo === 'invoice' ? 'invoice' : 'salesreceipt';
        const doc = await holded('/documents/' + tipoDoc + '/' + id);
        if (!doc || !ids.includes(doc.contact)) return res.status(403).json({ ok: false, error: 'No autorizado' });
        const pdf = await holded('/documents/' + tipoDoc + '/' + id + '/pdf');
        if (!pdf || !pdf.data) return res.status(502).json({ ok: false, error: 'PDF no disponible' });
        return res.status(200).json({ ok: true, nombre: 'Factura_' + String(doc.docNumber || id).replace(/[^\w-]/g, '_') + '.pdf', pdf: pdf.data });
      }
      const facturas = await listarFacturas(ids);
      return res.status(200).json({ ok: true, facturas });
    } catch (e) {
      return res.status(500).json({ ok: false, error: 'No se han podido cargar las facturas' });
    }
  }

  // ── LISTAR INFORMES DEL PACIENTE ─────────────────────────────────────────
  if (action === 'informes') {
    try {
      const fields = 'fields[]=PacienteId&fields[]=PacienteNombre&fields[]=FisioNombre&fields[]=Fecha&fields[]=Informe&fields[]=Protocolo&fields[]=SoloFisio';
      let allRecords = [];
      let offset = null;
      do {
        const off = offset ? '&offset='+offset : '';
        const r = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${INFORMES_TABLE}?${fields}&sort[0][field]=Fecha&sort[0][direction]=desc&pageSize=100${off}`,
          { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } });
        const data = await r.json();
        console.log('Airtable response sample:', JSON.stringify(data.records?.[0]?.fields));
        allRecords = allRecords.concat(data.records || []);
        offset = data.offset || null;
      } while (offset);
      const colPorNombre = {};
      try {
        const fr = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${FISIOS_TABLE}?fields[]=Name&fields[]=${encodeURIComponent('NºColegiado')}`, { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } });
        const fdat = await fr.json();
        (fdat.records || []).forEach(f => { const n = String(f.fields['Name'] || '').trim().toLowerCase(); if (n) colPorNombre[n] = f.fields['NºColegiado'] || ''; });
      } catch(e) {}
      const informes = allRecords
        .filter(rec => (rec.fields['PacienteId'] || rec.fields['fldDR9XqkJ9oA3WK0'] || '') === patientId && !rec.fields['SoloFisio'])
        .map(rec => ({
          id: rec.id,
          fecha: rec.fields['Fecha'] || '-',
          tipo: rec.fields['Protocolo'] || '-',
          fisioNombre: rec.fields['FisioNombre'] || '-',
          fisioColegiado: colPorNombre[String(rec.fields['FisioNombre'] || '').trim().toLowerCase()] || '',
          contenido: rec.fields['Informe'] || ''
        }));
      return res.status(200).json({ ok: true, informes });
    } catch(e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  // ── GET PROGRAMA ─────────────────────────────────────────────────────────
  try {
    const planUrl = `https://api.airtable.com/v0/${BASE_ID}/${PLAN_TABLE}?filterByFormula={PacienteID}="${patientId}"&sort[0][field]=FechaAsignacion&sort[0][direction]=desc&maxRecords=1`;
    const planRes = await fetch(planUrl, { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } });
    const planData = await planRes.json();
    if (!planData.records?.length) return res.status(200).json({ ejercicios: [], fisio: null, mensajeFisio: '', ultimaSession: '' });
    const plan = planData.records[0].fields;
    let ejercicios = [];
    try { ejercicios = JSON.parse(plan['Ejercicios'] || '[]'); } catch(e) { ejercicios = []; }
    ejercicios = ejercicios.map((ej, i) => {
      let ytId = '';
      try {
        const ytUrl = (ej.youtubeUrl || '').trim();
        const ytMatch = ytUrl.match(/(?:v=|youtu\.be\/|shorts\/)\s*([\w-]{6,})/);
        if (ytMatch) ytId = ytMatch[1].trim();
      } catch(e) { ytId = ''; }
      return {
        id: `ej_${i}`,
        name: ej.nombre || '',
        zona: ej.zona || '',
        series: parseInt(ej.series) || 0,
        reps: parseInt(ej.reps) || 0,
        dur: parseInt(ej.duracion) || 0,
        descanso: ej.v2 ? (parseInt(ej.descanso) || 0) : 0, // los programas antiguos traían 30 s puestos solos
        desc: ej.descripcion || '',
        ytId,
        imagen: ej.imagen || '',
      };
    });

    // Rellenar vídeo/imagen desde la biblioteca en los ejercicios que no lo traen
    if (ejercicios.some(e => !e.ytId)) {
      try {
        const norm = s => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
        const F_NOMBRE = 'flda62z2UH2gXmmky', F_IMG = 'fldXYCWY9gPOh657M', F_YT = 'fldfB2hp9Ndjr0xAP';
        const biblio = {};
        let offset = null;
        do {
          const u = `https://api.airtable.com/v0/${BASE_ID}/${BIBLIO_TABLE}?returnFieldsByFieldId=true&fields[]=${F_NOMBRE}&fields[]=${F_IMG}&fields[]=${F_YT}&pageSize=100${offset ? '&offset=' + offset : ''}`;
          const br = await fetch(u, { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } });
          const bd = await br.json();
          (bd.records || []).forEach(rec => {
            const f = rec.fields || {};
            const k = norm(f[F_NOMBRE]);
            if (k) biblio[k] = { yt: f[F_YT] || '', img: f[F_IMG]?.[0]?.url || '' };
          });
          offset = bd.offset || null;
        } while (offset);
        ejercicios = ejercicios.map(ej => {
          if (ej.ytId) return ej;
          const b = biblio[norm(ej.name)];
          if (!b) return ej;
          const m = (b.yt || '').trim().match(/(?:v=|youtu\.be\/|shorts\/)\s*([\w-]{6,})/);
          return { ...ej, ytId: m ? m[1].trim() : '', imagen: ej.imagen || b.img };
        });
      } catch(e) {}
    }

    let fisio = null;
    try {
      const fisioId = plan['FisioID'];
      if (fisioId) {
        const fisioRes = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${FISIOS_TABLE}/${fisioId}`, {
          headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` }
        });
        if (fisioRes.ok) {
          const fd = await fisioRes.json();
          fisio = {
            id: fisioId,
            nombre: fd.fields['Name'] || '',
            colegiado: fd.fields['NºColegiado'] || '',
            foto: fd.fields['Foto']?.[0]?.url || ''
          };
        }
      }
    } catch(e) { fisio = null; }
    return res.status(200).json({
      ejercicios,
      fisio,
      mensajeFisio: plan['MensajeFisio'] || '',
      ultimaSession: plan['UltimaSession'] || ''
    });
  } catch(e) {
    return res.status(200).json({ ejercicios: [], fisio: null, mensajeFisio: '', ultimaSession: '' });
  }
}