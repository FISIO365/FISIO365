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

// ── RESERVAS DE LA WEB ─────────────────────────────────────────────────────
// El formulario de la web crea una fila nueva en CITAS con los datos en your-name / your-phone / your-email /
// your-message / your-file y sin paciente. Aquí se busca (o se crea) el paciente, la cita se pone en el hueco
// libre de esa hora si lo hay (y se borra la fila nueva) y los archivos pasan a los documentos del paciente.
const CIT_T = 'tblTPlcuiSjQngkaD';
let webEnCurso = null;
function procesarWeb() { if (!webEnCurso) webEnCurso = _procesarWeb().finally(() => { webEnCurso = null; }); return webEnCurso; }
async function _procesarWeb() {
  const todosW = async (t, query) => { let recs = [], off = ''; do { const d = await at(`${t}?${query}&pageSize=100${off ? '&offset=' + off : ''}`); if (d.error) throw new Error(d.error.message || 'Airtable'); recs = recs.concat(d.records || []); off = d.offset || ''; } while (off); return recs; };
  const nm = v => (v && typeof v === 'object' && !Array.isArray(v)) ? (v.name || '') : (v || '');
  const pend = await todosW(CIT_T, `filterByFormula=${encodeURIComponent(`AND({your-name}!='',ARRAYJOIN({RELACIÓN - CITA})='',{RESERVA}='',{ESTADO}='',IS_AFTER(CREATED_TIME(),DATEADD(TODAY(),-60,'days')))`)}`);
  let hechas = 0, sinHueco = 0;
  for (const r of pend) {
    try {
      const F = r.fields, nombre = String(F['your-name'] || '').trim().replace(/\s+/g, ' ');
      const tel = String(F['your-phone'] || '').replace(/\D/g, '').slice(-9), email = String(F['your-email'] || '').trim().toLowerCase();
      // 1. Paciente: por teléfono, si no por email, si no por nombre exacto; si no existe, se crea
      const conds = [];
      if (tel.length === 9) conds.push(`RIGHT(REGEX_REPLACE({TELF}&'','[^0-9]',''),9)='${tel}'`, `RIGHT(REGEX_REPLACE({WHATSAPP}&'','[^0-9]',''),9)='${tel}'`);
      if (/^[^@\s']+@[^@\s']+\.[^@\s']+$/.test(email)) conds.push(`LOWER({EMAIL}&'')='${email}'`);
      if (!conds.length && nombre) conds.push(`LOWER({FULL NAME}&'')='${nombre.toLowerCase().replace(/'/g, "\\'")}'`);
      let pac = null;
      if (conds.length) { const ps = await todosW(PACIENTES, `filterByFormula=${encodeURIComponent(`OR(${conds.join(',')})`)}&fields[]=FULL%20NAME&fields[]=TELF&fields[]=WHATSAPP&fields[]=DOCUS`);
        pac = ps.find(p => tel && String((p.fields.TELF || '') + ' ' + (p.fields.WHATSAPP || '')).replace(/\D/g, '').includes(tel)) || ps[0] || null; }
      if (!pac) {
        const nf = { 'FULL NAME': nombre || 'Paciente web' };
        if (tel) { nf.TELF = String(F['your-phone']).trim(); nf.WHATSAPP = String(F['your-phone']).trim(); }
        if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) nf.EMAIL = email;
        const c = await at(PACIENTES, { method: 'POST', body: JSON.stringify({ records: [{ fields: nf }], typecast: true }) });
        if (c.error) throw new Error(c.error.message); pac = c.records[0];
      }
      // 2. Archivos de la web → documentos del paciente
      const files = (F['your-file'] || []).filter(a => a.url);
      if (files.length) { const prev = (pac.fields && pac.fields.DOCUS || []).map(a => ({ id: a.id })); await at(`${PACIENTES}/${pac.id}`, { method: 'PATCH', body: JSON.stringify({ fields: { DOCUS: [...prev, ...files.map(a => ({ url: a.url, filename: a.filename }))] } }) }); }
      // 3. Cita: al hueco libre de esa hora si lo hay
      const fecha = String(F.FECHA || '').slice(0, 10), m = String(F.HORA || '').match(/(\d{1,2}):(\d{2})/), hora = m ? m[1].padStart(2, '0') + ':' + m[2] : '';
      const msg = String(F['your-message'] || '').trim();
      const nota = ['Reserva web', msg].filter(Boolean).join(': ');
      const base = { ESTADO: 'PENDIENTE ', 'RELACIÓN - CITA': [pac.id], RESERVA: 'RESERVADA POR LA WEB' };
      let libre = null;
      if (fecha && hora) {
        const dia = await todosW(CIT_T, `filterByFormula=${encodeURIComponent(`DATETIME_FORMAT({FECHA},'YYYY-MM-DD')='${fecha}'`)}&fields[]=HORA&fields[]=ESTADO&fields[]=PREF.&fields[]=NOTAS&fields[]=RELACI%C3%93N%20-%20CITA`);
        const hh = x => { const k = String(x || '').match(/(\d{1,2}):(\d{2})/); return k ? k[1].padStart(2, '0') + ':' + k[2] : ''; };
        const carga = f => dia.filter(x => nm(x.fields['PREF.']) === f && (x.fields['RELACIÓN - CITA'] || []).length && /PENDIENTE|REALIZADA/.test(nm(x.fields.ESTADO))).length;
        libre = dia.filter(x => x.id !== r.id && hh(x.fields.HORA) === hora && /^(CITA LIBRE|LIBRE - SIN BOMBA)$/.test(String(nm(x.fields.ESTADO)).trim()) && nm(x.fields['PREF.']) && !/NO HAY|TODOS|\?\?|FIESTA/i.test(nm(x.fields['PREF.'])))
          .sort((a, b) => carga(nm(a.fields['PREF.'])) - carga(nm(b.fields['PREF.'])))[0] || null;
      }
      if (libre) {
        const f = Object.assign({}, base, { NOTAS: [libre.fields.NOTAS, nota].filter(Boolean).join('\n') });
        if (files.length) f['your-file'] = files.map(a => ({ url: a.url, filename: a.filename }));
        const u = await at(`${CIT_T}/${libre.id}`, { method: 'PATCH', body: JSON.stringify({ fields: f, typecast: true }) });
        if (u.error) throw new Error(u.error.message);
        await at(`${CIT_T}/${r.id}`, { method: 'DELETE' });
      } else {
        const u = await at(`${CIT_T}/${r.id}`, { method: 'PATCH', body: JSON.stringify({ fields: Object.assign({}, base, { NOTAS: [F.NOTAS, nota].filter(Boolean).join('\n') }), typecast: true }) });
        if (u.error) throw new Error(u.error.message);
        sinHueco++;
      }
      hechas++;
    } catch (e) { console.log('reserva web', r.id, e.message); }
  }
  return { hechas, sinHueco };
}

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

  // Versión publicada: el panel la compara al volver a la app para recargarse si hay una nueva
  // Lo llama la automatización de Airtable al entrar una reserva por la web (y el panel al abrir la agenda)
  if (action === 'web-procesar') { try { const r = await procesarWeb(); return res.status(200).json({ ok: true, ...r }); } catch (e) { return res.status(500).json({ ok: false, error: e.message }); } }
  if (action === 'version') { res.setHeader('Cache-Control', 'no-store'); return res.status(200).json({ v: (process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 12) }); }

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
    try { const [fisios, ini] = await Promise.all([rendimiento(desde, hasta, !!req.query.fresco), inicioControl().catch(() => '')]); return res.status(200).json({ ok: true, fisios, conPack: !!ini }); }
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
      // ── AGENDA: citas de un día, dar/mover/cancelar citas (tabla CITAS: cada fila es una hora de un fisio) ──
      if (action.startsWith('seg-agenda')) {
        const TIP = 'tbltoikmBZwHYQcpD', nmA = v => (v && typeof v === 'object' && !Array.isArray(v)) ? (v.name || '') : (v || '');
        const okF = f => /^\d{4}-\d{2}-\d{2}$/.test(f || ''), okH = h => /^\d{1,2}:\d{2}$/.test(h || ''), okId = x => /^rec[A-Za-z0-9]{14}$/.test(x || '');
        const hh = h => { const m = String(h || '').match(/(\d{1,2}):(\d{2})/); return m ? m[1].padStart(2, '0') + ':' + m[2] : String(h || ''); };
        const ACTIVA = e => /PENDIENTE|REALIZADA|DUDOSA|POR REAGENDAR/i.test(e || '');
        const LIBRE = e => /^(CITA LIBRE|LIBRE - SIN BOMBA)$/.test(String(e || '').trim());
        const CAMPOS_C = ['FECHA', 'HORA', 'ESTADO', 'PREF.', 'RELACIÓN - CITA', 'TIPO DE CITA', 'NOTAS', 'CONFIR', 'RESERVA'].map(f => 'fields[]=' + encodeURIComponent(f)).join('&');
        const delDia = async (fecha) => todosT(CIT, `filterByFormula=${encodeURIComponent(`DATETIME_FORMAT({FECHA},'YYYY-MM-DD')='${fecha}'`)}&${CAMPOS_C}`);
        const enHora = (rows, hora, fisio) => rows.filter(r => hh(r.fields['HORA']) === hh(hora) && String(nmA(r.fields['PREF.'])).toLowerCase() === String(fisio).toLowerCase());
        const nueva = async (fecha, hora, fisio, extra) => { const d = await at(CIT, { method: 'POST', body: JSON.stringify({ records: [{ fields: Object.assign({ FECHA: fecha, HORA: hh(hora), 'PREF.': fisio }, extra) }], typecast: true }) }); if (d.error) throw new Error(d.error.message || 'No se ha podido crear'); return d.records[0]; };
        const patch = async (id, fields) => { const d = await at(`${CIT}/${id}`, { method: 'PATCH', body: JSON.stringify({ fields, typecast: true }) }); if (d.error) throw new Error(d.error.message || 'No se ha podido guardar'); return d; };
        // Ocupar una hora: si hay un hueco libre en esa hora se usa esa fila; si no, se crea una nueva
        const ocupar = async (fecha, hora, fisio, campos, forzar) => {
          const rows = enHora(await delDia(fecha), hora, fisio);
          const choca = rows.filter(r => ACTIVA(String(nmA(r.fields['ESTADO']))));
          if (choca.length && !forzar) { const pids = choca.flatMap(r => r.fields['RELACIÓN - CITA'] || []); let n = ''; if (pids[0]) { const p0 = await at(`${PACIENTES}/${pids[0]}`); n = (p0.fields || {})['FULL NAME'] || ''; } return { conflicto: true, con: n }; }
          const sinPac = rows.filter(r => !(r.fields['RELACIÓN - CITA'] || []).length && !/CANCELADA|REPROGRAMADA|PERDIDA/.test(String(nmA(r.fields['ESTADO']))));
          const lib = sinPac.find(r => LIBRE(nmA(r.fields['ESTADO']))) || sinPac[0];
          if (lib) { const tipos = campos['TIPO DE CITA']; const f2 = Object.assign({}, campos); if (tipos) f2['TIPO DE CITA'] = tipos; await patch(lib.id, f2); return { id: lib.id }; }
          const r = await nueva(fecha, hora, fisio, campos); return { id: r.id };
        };
        const tiposDe = async (names) => { // nombres → ids de TIPO DE CITA (se crean si no existen)
          const out = []; for (const n0 of (names || []).map(x => String(x).trim()).filter(Boolean).slice(0, 6)) {
            const f = await at(`${TIP}?filterByFormula=${encodeURIComponent(`{Name}='${n0.replace(/'/g, "\\'")}'`)}&pageSize=1&fields[]=Name`);
            if (f.records && f.records[0]) out.push(f.records[0].id); else { const c = await at(TIP, { method: 'POST', body: JSON.stringify({ records: [{ fields: { Name: n0 } }] }) }); if (c.records && c.records[0]) out.push(c.records[0].id); }
          } return out; };

        // La opción de comida en Airtable lleva emoji y un carácter invisible: se copia tal cual de una fila que ya la tenga
        const estadoComida = async () => { if (global._estCom) return global._estCom; const d = await at(`${CIT}?filterByFormula=${encodeURIComponent("FIND('COMIDA',{ESTADO}&'')")}&maxRecords=1&fields[]=ESTADO`); const e = d.records && d.records[0] && nmA(d.records[0].fields.ESTADO); return (global._estCom = e || 'COMIDAAA 🥗\u200B'); };
        if (action === 'seg-agenda-tipos') { // etiquetas de tipo de cita, las más usadas primero
          const rs = await todosT(TIP, `fields[]=Name&fields[]=CITAS`);
          const tipos = rs.map(r => ({ n: String(r.fields.Name || '').trim(), u: (r.fields.CITAS || []).length })).filter(t => t.n && t.n.length <= 30 && /[A-Za-zÁÉÍÓÚÑáéíóúñ0-9]/.test(t.n) && !/^[.0!]+$/.test(t.n));
          const vist = {}; tipos.forEach(t => { const k = t.n.toUpperCase(); vist[k] = vist[k] ? { n: vist[k].n, u: vist[k].u + t.u } : t; });
          return res.status(200).json({ ok: true, tipos: Object.values(vist).sort((a, b) => b.u - a.u).slice(0, 400).map(t => t.n) });
        }
        if (action === 'seg-agenda-dia') {
          await procesarWeb().catch(() => {});
          let rows, limitado = false;
          if (okF(q.fecha)) rows = await delDia(q.fecha);
          else { // rango de fechas, un paciente y/o un fisio (vista de lista)
            const cond = ['{FECHA}'];
            if (okF(q.desde)) cond.push(`NOT(IS_BEFORE({FECHA},DATETIME_PARSE('${q.desde}','YYYY-MM-DD')))`);
            if (okF(q.hasta)) cond.push(`NOT(IS_AFTER({FECHA},DATETIME_PARSE('${q.hasta}','YYYY-MM-DD')))`);
            if (okId(q.pacienteId)) cond.push(`FIND('${q.pacienteId}',ARRAYJOIN({PacienteRec}))`);
            if (q.fisio && /^[A-Za-zÁÉÍÓÚÑáéíóúñ ]{2,20}$/.test(q.fisio)) cond.push(`{PREF.}='${q.fisio}'`);
            if (cond.length < 2) return res.status(400).json({ ok: false, error: 'Elige fechas o un paciente' });
            const MAX = 2500;
            rows = await todosT(CIT, `filterByFormula=${encodeURIComponent(cond.length > 1 ? `AND(${cond.join(',')})` : cond[0])}&${CAMPOS_C}&sort[0][field]=FECHA&sort[0][direction]=desc&maxRecords=${MAX}`);
            limitado = rows.length >= MAX;
          }
          const pids = [...new Set(rows.flatMap(r => r.fields['RELACIÓN - CITA'] || []))], tids = [...new Set(rows.flatMap(r => r.fields['TIPO DE CITA'] || []))];
          const nomP = {}, nomT = {};
          const porLotes = async (tabla, ids, campo, dest) => { const lotes = []; for (let i = 0; i < ids.length; i += 50) lotes.push(ids.slice(i, i + 50)); for (let k = 0; k < lotes.length; k += 4) await Promise.all(lotes.slice(k, k + 4).map(async t => { const rs = await todosT(tabla, `filterByFormula=${encodeURIComponent('OR(' + t.map(x => `RECORD_ID()='${x}'`).join(',') + ')')}&fields[]=${encodeURIComponent(campo)}`); rs.forEach(r => dest[r.id] = r.fields[campo] || ''); })); };
          await Promise.all([porLotes(PACIENTES, pids, 'FULL NAME', nomP), porLotes(TIP, tids, 'Name', nomT)]);
          return res.status(200).json({ ok: true, hoy: hoyF, limitado, citas: rows.map(r => { const F = r.fields; const pid = (F['RELACIÓN - CITA'] || [])[0] || ''; return { id: r.id, fecha: String(F['FECHA'] || '').slice(0, 10), hora: hh(F['HORA']), estado: String(nmA(F['ESTADO'])).trim(), fisio: nmA(F['PREF.']), pacienteId: pid, paciente: pid ? (nomP[pid] || '') : '', tipos: (F['TIPO DE CITA'] || []).map(t => nomT[t]).filter(Boolean), notas: F['NOTAS'] || '', confirmada: (F['CONFIR'] || []).some(x => /CONFIRMADA/.test(nmA(x))), app: /APP/.test(nmA(F['RESERVA'])), web: /WEB/.test(nmA(F['RESERVA'])) }; }) });
        }
        if (req.method !== 'POST') return res.status(405).json({ ok: false });
        if (action === 'seg-agenda-dar') { // dar cita en una hora (o en un hueco libre concreto)
          if (!okId(q.pacienteId) || !okF(q.fecha) || !okH(q.hora) || !q.fisio) return res.status(400).json({ ok: false, error: 'Faltan datos' });
          const campos = { ESTADO: 'PENDIENTE ', 'RELACIÓN - CITA': [q.pacienteId] };
          if (q.notas) campos.NOTAS = String(q.notas).slice(0, 2000);
          if (q.tipos && q.tipos.length) campos['TIPO DE CITA'] = await tiposDe(q.tipos);
          const r = await ocupar(q.fecha, q.hora, q.fisio, campos, !!q.forzar);
          if (r.conflicto) return res.status(200).json({ ok: false, conflicto: true, error: `A esa hora ${q.fisio} ya tiene a ${r.con || 'otro paciente'}` });
          return res.status(200).json({ ok: true, id: r.id });
        }
        if (action === 'seg-agenda-huecos') { // abrir varias horas de golpe (libres o bloqueadas), sin pisar lo que ya hay
          const fechas = (q.fechas || []).filter(okF).slice(0, 60), horas = (q.horas || []).map(hh).filter(okH).slice(0, 24);
          if (!q.fisio || !fechas.length || !horas.length || !/^(CITA LIBRE|LIBRE - SIN BOMBA|CITA BLOQUEADA|DIA BLOQUEADO|FRANJA BLOQUEADA)$/.test(q.estado || '')) return res.status(400).json({ ok: false, error: 'Faltan datos' });
          const nuevos = []; let saltadas = 0;
          for (const f of fechas) {
            const rows = await delDia(f);
            for (const h of horas) {
              const ya = enHora(rows, h, q.fisio).some(r => !/CANCELADA|REPROGRAMADA|CITA PERDIDA/.test(String(nmA(r.fields['ESTADO']))));
              if (ya) { saltadas++; continue; }
              nuevos.push({ fields: { FECHA: f, HORA: h, 'PREF.': q.fisio, ESTADO: q.estado, ...(q.notas ? { NOTAS: String(q.notas) } : {}) } });
            }
          }
          for (let i = 0; i < nuevos.length; i += 10) { const d = await at(CIT, { method: 'POST', body: JSON.stringify({ records: nuevos.slice(i, i + 10), typecast: true }) }); if (d.error) throw new Error(d.error.message || 'No se han podido crear'); }
          return res.status(200).json({ ok: true, creadas: nuevos.length, saltadas });
        }
        if (action === 'seg-agenda-hueco') { // dejar una hora libre (para la app), bloqueada, etc.
          if (!okF(q.fecha) || !okH(q.hora) || !q.fisio || !/^(CITA LIBRE|LIBRE - SIN BOMBA|CITA BLOQUEADA|FRANJA BLOQUEADA|DIA BLOQUEADO|CALL-IN|COMIDA|VIDEOS)$/.test(q.estado || '')) return res.status(400).json({ ok: false, error: 'Datos no válidos' });
          const r = await nueva(q.fecha, q.hora, q.fisio, { ESTADO: q.estado === 'COMIDA' ? await estadoComida() : q.estado, ...(q.notas ? { NOTAS: String(q.notas) } : {}) }); return res.status(200).json({ ok: true, id: r.id });
        }
        if (action === 'seg-agenda-editar') { // estado, confirmada, notas, etiquetas; opcional dejar el hueco libre
          if (!okId(q.id)) return res.status(400).json({ ok: false });
          const cur = await at(`${CIT}/${q.id}`); if (cur.error) return res.status(404).json({ ok: false, error: 'Cita no encontrada' });
          const f = {};
          if (q.estado) { if (!/^(PENDIENTE|REALIZADA|NO ASISTIÓ|CANCELADA|POR REAGENDAR|CITA DUDOSA|REPROGRAMADA|CITA PERDIDA|CITA LIBRE|LIBRE - SIN BOMBA|CITA BLOQUEADA|FRANJA BLOQUEADA|DIA BLOQUEADO|CALL-IN|COMIDA|VIDEOS)$/.test(q.estado)) return res.status(400).json({ ok: false, error: 'Estado no válido' }); f.ESTADO = q.estado === 'PENDIENTE' ? 'PENDIENTE ' : q.estado === 'COMIDA' ? await estadoComida() : q.estado; }
          if (q.confirmada != null) f.CONFIR = q.confirmada ? ['CONFIRMADA'] : [];
          if (q.notas != null) f.NOTAS = String(q.notas).slice(0, 2000);
          if (Array.isArray(q.tipos)) f['TIPO DE CITA'] = await tiposDe(q.tipos);
          if (q.liberar) { // el paciente queda en su fila (cancelada…) y se crea un hueco libre en esa hora
            const c = cur.fields; await nueva(String(c.FECHA).slice(0, 10), hh(c.HORA), nmA(c['PREF.']), { ESTADO: 'CITA LIBRE' });
          }
          if (Object.keys(f).length) await patch(q.id, f);
          return res.status(200).json({ ok: true });
        }
        if (action === 'seg-agenda-mover') { // cambiar día/hora/fisio: la original queda REPROGRAMADA y se da la nueva
          if (!okId(q.id) || !okF(q.fecha) || !okH(q.hora) || !q.fisio) return res.status(400).json({ ok: false, error: 'Faltan datos' });
          const cur = await at(`${CIT}/${q.id}`); if (cur.error) return res.status(404).json({ ok: false, error: 'Cita no encontrada' });
          const c = cur.fields, pid = (c['RELACIÓN - CITA'] || [])[0];
          if (!pid) return res.status(400).json({ ok: false, error: 'Esta cita no tiene paciente' });
          const campos = { ESTADO: 'PENDIENTE ', 'RELACIÓN - CITA': [pid] };
          if (c['TIPO DE CITA']) campos['TIPO DE CITA'] = c['TIPO DE CITA'];
          if (c.NOTAS) campos.NOTAS = c.NOTAS;
          const r = await ocupar(q.fecha, q.hora, q.fisio, campos, !!q.forzar);
          if (r.conflicto) return res.status(200).json({ ok: false, conflicto: true, error: `A esa hora ${q.fisio} ya tiene a ${r.con || 'otro paciente'}` });
          await patch(q.id, { ESTADO: 'REPROGRAMADA' });
          if (q.liberar) await nueva(String(c.FECHA).slice(0, 10), hh(c.HORA), nmA(c['PREF.']), { ESTADO: 'CITA LIBRE' });
          return res.status(200).json({ ok: true, id: r.id });
        }
        if (action === 'seg-agenda-borrar') { // solo huecos (libres/bloqueados), nunca citas con paciente
          if (!okId(q.id)) return res.status(400).json({ ok: false });
          const cur = await at(`${CIT}/${q.id}`); if (cur.error) return res.status(404).json({ ok: false });
          if ((cur.fields['RELACIÓN - CITA'] || []).length && !q.conPaciente) return res.status(400).json({ ok: false, error: 'Esta cita tiene paciente' });
          if (q.liberar) { const c = cur.fields; await nueva(String(c.FECHA).slice(0, 10), hh(c.HORA), nmA(c['PREF.']), { ESTADO: 'CITA LIBRE' }); }
          const d = await at(`${CIT}/${q.id}`, { method: 'DELETE' }); return res.status(200).json({ ok: !d.error });
        }
        return res.status(400).json({ ok: false, error: 'Acción no válida' });
      }
      // ── ESTADÍSTICAS DEL CENTRO (semanas de lunes a domingo) ──
      if (action === 'seg-estadisticas' || action === 'seg-estadisticas-guardar') {
        const EST_T = 'tblE7NWfZmxcou5mV', TIP = 'tbltoikmBZwHYQcpD';
        const nmS = v => (v && typeof v === 'object' && !Array.isArray(v)) ? (v.name || '') : (v || '');
        const mv = (f, n) => { const d = new Date(f + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
        const lunes = f => mv(f, -((new Date(f + 'T12:00:00Z').getUTCDay() + 6) % 7));
        if (action === 'seg-estadisticas-guardar') {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(q.semana || '')) return res.status(400).json({ ok: false });
          const sem = lunes(q.semana), f = {};
          const num = v => (v === '' || v == null) ? null : Number(String(v).replace(',', '.'));
          if ('ingresos' in q) f['INGRESOS'] = num(q.ingresos);
          if ('resenas' in q) f['RESEÑAS GOOGLE'] = num(q.resenas);
          if ('quejas' in q) f['QUEJAS'] = num(q.quejas);
          if ('notas' in q) f['NOTAS'] = String(q.notas || '');
          const ya = await todosT(EST_T, `filterByFormula=${encodeURIComponent(`DATETIME_FORMAT({SEMANA},'YYYY-MM-DD')='${sem}'`)}`);
          const d = ya[0] ? await at(`${EST_T}/${ya[0].id}`, { method: 'PATCH', body: JSON.stringify({ fields: f }) }) : await at(EST_T, { method: 'POST', body: JSON.stringify({ records: [{ fields: Object.assign({ SEMANA: sem }, f) }] }) });
          global._estCaches = {};
          return res.status(200).json({ ok: !d.error, error: d.error && d.error.message });
        }
        const N = Math.min(Math.max(+q.semanas || 12, 4), 52);
        const lun0 = lunes(hoyF), desde = mv(lun0, -7 * (N - 1)), hasta = mv(lun0, 6), futuro = mv(hoyF, 60);
        const key = `${desde}|${N}`;
        { const ca = (global._estCaches || {})[key]; if (!q.fresco && ca && Date.now() - ca.t < 30 * 60000) return res.status(200).json(ca.data); }
        const rangoF = (campo, a, b) => `AND(NOT(IS_BEFORE({${campo}},DATETIME_PARSE('${a}','YYYY-MM-DD'))),NOT(IS_AFTER({${campo}},DATETIME_PARSE('${b}','YYYY-MM-DD'))))`;
        const [citas, nuevosP, llam, man] = await Promise.all([
          (async () => { // por trozos de 2 semanas en paralelo (4 a la vez) para que vaya rápido
            const campos = ['FECHA', 'HORA', 'ESTADO', 'PREF.', 'RELACIÓN - CITA', 'TIPO DE CITA'].map(f => 'fields[]=' + encodeURIComponent(f)).join('&');
            const tr = []; for (let a = desde; a <= futuro; a = mv(a, 14)) tr.push([a, mv(a, 13) < futuro ? mv(a, 13) : futuro]);
            const out = []; for (let i = 0; i < tr.length; i += 4) (await Promise.all(tr.slice(i, i + 4).map(([a, b]) => todosT(CIT, `filterByFormula=${encodeURIComponent(rangoF('FECHA', a, b))}&${campos}`)))).forEach(x => out.push(...x));
            return out; })(),
          todosT(PACIENTES, `filterByFormula=${encodeURIComponent(`NOT(IS_BEFORE(CREATED_TIME(),DATETIME_PARSE('${desde}','YYYY-MM-DD')))`)}&fields[]=FULL%20NAME`),
          todosT(LLA, `filterByFormula=${encodeURIComponent(`NOT(IS_BEFORE({FECHA},DATETIME_PARSE('${mv(desde, -1)}','YYYY-MM-DD')))`)}&fields[]=FECHA&fields[]=RESULTADO&fields[]=RESE%C3%91A`).catch(() => []),
          todosT(EST_T, `filterByFormula=${encodeURIComponent(rangoF('SEMANA', mv(desde, -400), hasta))}`).catch(() => [])
        ]);
        // Etiquetas (tipo de cita) para saber si una cita es de bono («3/10»)
        const tids = [...new Set(citas.flatMap(c => c.fields['TIPO DE CITA'] || []))], nomT = {};
        for (let i = 0; i < tids.length; i += 50) { const t = tids.slice(i, i + 50); (await todosT(TIP, `filterByFormula=${encodeURIComponent('OR(' + t.map(x => `RECORD_ID()='${x}'`).join(',') + ')')}&fields[]=Name`)).forEach(r => nomT[r.id] = r.fields.Name || ''); }
        const esBono = c => (c.fields['TIPO DE CITA'] || []).some(t => /^\s*\d+\s*\/\s*(4|5|6|8|10|12|15|20)\s*$/.test(nomT[t] || ''));
        const C = citas.map(c => ({ f: String(c.fields.FECHA || '').slice(0, 10), h: String(c.fields.HORA || '').slice(0, 5), e: String(nmS(c.fields.ESTADO)).trim(), fisio: nmS(c.fields['PREF.']), pid: (c.fields['RELACIÓN - CITA'] || [])[0] || '', bono: esBono(c) })).filter(c => c.f);
        const porPac = {}; C.forEach(c => { if (c.pid) (porPac[c.pid] = porPac[c.pid] || []).push(c); });
        Object.values(porPac).forEach(L => L.sort((a, b) => a.f.localeCompare(b.f)));
        // Primera visita real: primera sesión hecha del paciente (sin ninguna sesión hecha antes del periodo)
        const prim = {}; Object.entries(porPac).forEach(([pid, L]) => { const x = L.find(c => c.f >= desde && /REALIZADA/.test(c.e)); if (x && !L.some(c => c.f < desde && /REALIZADA/.test(c.e))) prim[pid] = x; });
        const cand = Object.keys(prim), conAntes = new Set();
        const lotesP = []; for (let i = 0; i < cand.length; i += 40) lotesP.push(cand.slice(i, i + 40));
        for (let i = 0; i < lotesP.length; i += 4) (await Promise.all(lotesP.slice(i, i + 4).map(t => todosT(CIT, `filterByFormula=${encodeURIComponent(`AND({ESTADO}='REALIZADA',IS_BEFORE({FECHA},DATETIME_PARSE('${desde}','YYYY-MM-DD')),OR(${t.map(id => `FIND('${id}',ARRAYJOIN({PacienteRec}))`).join(',')}))`)}&fields[]=RELACI%C3%93N%20-%20CITA`).catch(() => [])))).forEach(rs => rs.forEach(r => (r.fields['RELACIÓN - CITA'] || []).forEach(id => conAntes.add(id))));
        // Ocupación: horas de trabajo a la semana de Jonathan, Sara y Juan (campo HORAS SEMANA de FISIO)
        // Solo cuentan los días que cada fisio trabaja de verdad: un día sin ninguna fila en su agenda (vacaciones, festivo, baja…) no suma horas
        const fisT = await todosT(FISIOS_TABLE, `fields[]=Name&fields[]=${encodeURIComponent('HORAS SEMANA')}&fields[]=${encodeURIComponent('HORAS POR DÍA')}`).catch(() => []);
        const EQUIPO = ['jonathan', 'sara', 'juan'], DSEM = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
        const horario = {}; fisT.forEach(f => { const k = String(f.fields.Name || '').split(' ')[0].toLowerCase(); if (!EQUIPO.includes(k)) return; const h = {};
          String(f.fields['HORAS POR DÍA'] || '').split('\n').forEach(l => { const m = l.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().match(/(lunes|martes|miercoles|jueves|viernes|sabado|domingo)\D*(\d+(?:[.,]\d+)?)/); if (m) h[DSEM.indexOf(m[1])] = +m[2].replace(',', '.'); });
          if (!Object.keys(h).length && +f.fields['HORAS SEMANA']) [1, 2, 3, 4, 5].forEach(d => h[d] = +f.fields['HORAS SEMANA'] / 5);
          horario[k] = h; });
        const trabaja = new Set(C.filter(c => !/DIA BLOQUEADO/.test(c.e) && (c.pid || /LIBRE|PENDIENTE|REALIZADA/.test(c.e))).map(c => String(c.fisio).toLowerCase() + '|' + c.f));
        const semanas = [];
        for (let k = 0; k < N; k++) {
          const a = mv(desde, 7 * k), b = mv(a, 6), en = f => f >= a && f <= b;
          const enS = C.filter(c => en(c.f));
          const real = enS.filter(c => /REALIZADA/.test(c.e));
          const dias = {}; real.forEach(c => dias[c.f] = (dias[c.f] || 0) + 1);
          const atend = [...new Set(real.map(c => c.pid).filter(Boolean))];
          const conBono = atend.filter(pid => real.some(c => c.pid === pid && c.bono)).length;
          const nuevos = nuevosP.filter(p => en(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date(p.createdTime))));
          const fis = {}; let vin = 0, reag = 0, pack = 0, suelta = 0;
          Object.entries(prim).forEach(([pid, p0]) => {
            if (!en(p0.f) || conAntes.has(pid)) return;
            vin++; const fz = p0.fisio || '—'; fis[fz] = fis[fz] || { vinieron: 0, reagendaron: 0 }; fis[fz].vinieron++;
            const sig = porPac[pid].filter(c => c !== p0 && c.f >= p0.f && /PENDIENTE|REALIZADA/.test(c.e));
            if (sig.length) { reag++; fis[fz].reagendaron++; }
          });
          const ocup = enS.filter(c => c.pid && EQUIPO.includes(String(c.fisio).toLowerCase()) && /REALIZADA|PENDIENTE/.test(c.e)).length;
          // Capacidad de cada fisio y día = su horario − horas bloqueadas (comida, vídeos, bloqueos…); si ese día no tiene nada en la agenda, no trabaja.
          // Si ese día tiene más horas abiertas en la agenda que su horario (horas extra), cuentan las de la agenda.
          let cap = 0; for (let d = 0; d < 7; d++) { const f = mv(a, d), dw = new Date(f + 'T12:00:00Z').getUTCDay(); EQUIPO.forEach(k => {
            if (!trabaja.has(k + '|' + f)) return;
            const filas = C.filter(c => c.f === f && String(c.fisio).toLowerCase() === k);
            const hBloq = new Set(filas.filter(c => /BLOQUEAD|COMIDA|VIDEOS|CALL-IN/i.test(c.e)).map(c => c.h)).size;
            const hAbiertas = new Set(filas.filter(c => !/BLOQUEAD|COMIDA|VIDEOS|CALL-IN/i.test(c.e)).map(c => c.h)).size;
            cap += Math.max((horario[k] && horario[k][dw] || 0) - hBloq, hAbiertas, 0); }); }
          const ll = llam.filter(r => { const x = r.fields.FECHA; if (!x) return false; const d = String(x).includes('T') ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date(x)) : String(x).slice(0, 10); return en(d); });
          const m = man.find(r => String(r.fields.SEMANA || '').slice(0, 10) === a);
          semanas.push({ semana: a, sesiones: real.length, dias, atendidos: atend.length, conBono, noVino: enS.filter(c => /NO ASIST|PERDIDA/.test(c.e)).length, canceladas: enS.filter(c => /CANCELADA/.test(c.e)).length,
            nuevos: nuevos.length, vinieron: vin, reagendaron: reag, porFisio: fis, ocupadas: ocup, capacidad: cap, ocupacion: cap ? Math.round(ocup * 100 / cap) : null,
            recuperadas: ll.filter(r => /RECUPERADA/.test(nmS(r.fields.RESULTADO))).length, resenasPedidas: ll.filter(r => r.fields['RESEÑA']).length,
            ingresos: m && m.fields.INGRESOS != null ? m.fields.INGRESOS : null, resenas: m && m.fields['RESEÑAS GOOGLE'] != null ? m.fields['RESEÑAS GOOGLE'] : null, quejas: m && m.fields.QUEJAS != null ? m.fields.QUEJAS : null, notas: m ? (m.fields.NOTAS || '') : '' });
        }
        const data = { ok: true, hoy: hoyF, semanas };
        global._estCache = { key, t: Date.now(), data }; (global._estCaches = global._estCaches || {})[key] = global._estCache;
        return res.status(200).json(data);
      }
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
      if (action === 'seg-ficha') {
        if (!/^rec[A-Za-z0-9]{14}$/.test(q.id || '')) return res.status(400).json({ ok: false });
        const pac = await at(`${PACIENTES}/${q.id}`);
        if (pac.error) return res.status(404).json({ ok: false, error: 'No encontrado' });
        const F = pac.fields || {}, nm = v => (v && typeof v === 'object' && !Array.isArray(v)) ? (v.name || '') : (v || '');
        const llIds = F['LLAMADAS SARA'] || [];
        const [citas, segs, llams, saldo] = await Promise.all([
          todosT(CIT, `filterByFormula=${encodeURIComponent(`FIND('${q.id}',ARRAYJOIN({PacienteRec}))`)}&fields[]=FECHA&fields[]=HORA&fields[]=ESTADO&fields[]=PREF.&fields[]=NOTAS&sort[0][field]=FECHA&sort[0][direction]=desc`).catch(() => []),
          todosT(SEG, `filterByFormula=${encodeURIComponent(`FIND('${q.id}',ARRAYJOIN({PacRec}))`)}&sort[0][field]=FECHA DE LLAMADA&sort[0][direction]=desc`).catch(() => []),
          llIds.length ? todosT(LLA, `filterByFormula=${encodeURIComponent('OR(' + llIds.slice(0, 60).map(id => `RECORD_ID()='${id}'`).join(',') + ')')}&sort[0][field]=FECHA&sort[0][direction]=desc`).catch(() => []) : [],
          saldoPaciente(q.id).catch(() => ({ activo: false }))
        ]);
        const diaMad = x => { const s2 = String(x || ''); if (!s2.includes('T')) return { f: s2.slice(0, 10), h: '' }; const pz = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(s2)).reduce((o, p) => (o[p.type] = p.value, o), {}); return { f: `${pz.year}-${pz.month}-${pz.day}`, h: `${pz.hour === '24' ? '00' : pz.hour}:${pz.minute}` }; };
        // Si ya ha vuelto a reservar, el «No reagenda» se desmarca solo
        if (F['POR QUÉ NO REAGENDA']) {
          const vuelve = citas.some(c => { const f = String(c.fields['FECHA'] || '').slice(0, 10), e = String(nm(c.fields['ESTADO'])).toUpperCase(); return (f > hoyF && !/CANCEL|REPROGRAM|NO ASIST/.test(e)) || (f === hoyF && /PENDIENTE/.test(e)); });
          if (vuelve) { await at(`${PACIENTES}/${q.id}`, { method: 'PATCH', body: JSON.stringify({ fields: { 'POR QUÉ NO REAGENDA': '', 'POR QUÉ FECHA': null, 'POR QUÉ FISIO': '' } }) }).catch(() => {}); F['POR QUÉ NO REAGENDA'] = ''; F['POR QUÉ FECHA'] = ''; F['POR QUÉ FISIO'] = ''; }
        }
        return res.status(200).json({ ok: true, hoy: hoyF, saldo,
          paciente: { id: pac.id, pin: F['PIN'] || '', nombre: F['FULL NAME'] || '', tel: F['WHATSAPP'] || F['TELF'] || '', telf: F['TELF'] || '', whatsapp: F['WHATSAPP'] || '', pin: F['PIN'] || '', email: F['EMAIL'] || '', dni: F['DNI'] || '', cumple: F['CUMPLE'] || '', alta: pac.createdTime || '', estados: F['ESTADO'] || [],
            historial: F['HISTORIAL CLÍNICO'] || '', historialMod: F['HISTORIAL ACTUALIZADO'] || '', notas: F['NOTAS'] || '', porQue: F['POR QUÉ NO REAGENDA'] || '', porQueFecha: F['POR QUÉ FECHA'] || '', porQueFisio: F['POR QUÉ FISIO'] || '', bonoPrevio: F['SESIONES BONO PREVIO'] || 0, colab: F['COLAB'] || '', resena: !!F['RESEÑA POSITIVA'],
            archivos: (F['DOCUS'] || []).map(a => ({ nombre: a.filename || 'archivo', url: a.url, tipo: a.type || '', tam: a.size || 0, mini: (a.thumbnails && ((a.thumbnails.large && a.thumbnails.large.url) || (a.thumbnails.small && a.thumbnails.small.url))) || '' })) },
          citas: citas.map(c => ({ id: c.id, fecha: String(c.fields['FECHA'] || '').slice(0, 10), hora: c.fields['HORA'] || '', estado: String(nm(c.fields['ESTADO'])).trim(), fisio: nm(c.fields['PREF.']), nota: c.fields['NOTAS'] || '' })),
          seguimiento: segs.map(r => ({ id: r.id, fecha: r.fields['FECHA DE LLAMADA'] || '', nota: r.fields['NOTAS'] || '', hecho: !!r.fields['HECHO'], quien: nm(r.fields['RESPONSABLE']) })),
          llamadas: llams.map(r => { const d = diaMad(r.fields['FECHA']); return { fecha: d.f, hora: d.h, quien: nm(r.fields['QUIEN LLAMA']), resultado: String(nm(r.fields['RESULTADO'])).trim(), nota: r.fields['NOTAS'] || '', resena: !!r.fields['RESEÑA'] }; }) });
      }
      if (action === 'seg-sin-anotar') {
        // Pacientes cuya última sesión realizada (últimos 14 días) es posterior a la última vez que se tocó su HISTORIAL CLÍNICO
        const cs = await todosT(CIT, `filterByFormula=${encodeURIComponent(`AND(TRIM({ESTADO})='REALIZADA',IS_AFTER({FECHA},DATEADD(TODAY(),-15,'days')),NOT(IS_AFTER({FECHA},TODAY())))`)}&fields[]=FECHA&fields[]=HORA&fields[]=PREF.&fields[]=RELACIÓN - CITA`);
        const nm2 = v => (v && typeof v === 'object') ? (v.name || '') : (v || '');
        const ult = {}; cs.forEach(c => { const pid = (c.fields['RELACIÓN - CITA'] || [])[0]; if (!pid) return; const f = String(c.fields['FECHA'] || '').slice(0, 10); if (!ult[pid] || f > ult[pid].fecha) ult[pid] = { fecha: f, hora: c.fields['HORA'] || '', fisio: nm2(c.fields['PREF.']) }; });
        const pids = Object.keys(ult), info = {};
        const lotes = []; for (let i = 0; i < pids.length; i += 40) lotes.push(pids.slice(i, i + 40));
        (await Promise.all(lotes.map(l => todosT(PACIENTES, `filterByFormula=${encodeURIComponent('OR(' + l.map(id => `RECORD_ID()='${id}'`).join(',') + ')')}&fields[]=FULL NAME&fields[]=HISTORIAL ACTUALIZADO`).catch(() => [])))).forEach(r => r.forEach(p => { info[p.id] = { nombre: p.fields['FULL NAME'] || '—', mod: p.fields['HISTORIAL ACTUALIZADO'] || '' }; }));
        const diaMad = x => x ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(x)) : '';
        const out = pids.filter(id => info[id] && diaMad(info[id].mod) < ult[id].fecha).map(id => ({ pacienteId: id, nombre: info[id].nombre, fecha: ult[id].fecha, hora: ult[id].hora, fisio: ult[id].fisio, historialMod: diaMad(info[id].mod) }));
        return res.status(200).json({ ok: true, sesiones: out.sort((a, b) => a.fecha.localeCompare(b.fecha)) });
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
      if (action === 'seg-ficha-guardar') {
        if (!/^rec[A-Za-z0-9]{14}$/.test(q.id || '')) return res.status(400).json({ ok: false });
        const MAPA = { tel: 'TELF', whatsapp: 'WHATSAPP', email: 'EMAIL', dni: 'DNI', cumple: 'CUMPLE', notas: 'NOTAS', historial: 'HISTORIAL CLÍNICO', nombre: 'FULL NAME', pin: 'PIN' };
        const f = {}; Object.entries(q.campos || {}).forEach(([k, v]) => { if (!MAPA[k]) return; v = String(v ?? '').trim(); if (k === 'cumple') f[MAPA[k]] = /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null; else if (k === 'email') f[MAPA[k]] = v ? v.toLowerCase() : null; else if (k === 'pin') { if (v && !/^\d{4,6}$/.test(v)) return; f[MAPA[k]] = v; } else if (k === 'whatsapp') f[MAPA[k]] = v || null; else f[MAPA[k]] = v; });
        if (!Object.keys(f).length) return res.status(400).json({ ok: false, error: 'Nada que guardar' });
        const d = await at(`${PACIENTES}/${q.id}`, { method: 'PATCH', body: JSON.stringify({ fields: f, typecast: true }) });
        return res.status(200).json({ ok: !d.error, error: d.error && (d.error.message || d.error.type) });
      }
      if (action === 'seg-historial-anadir') {
        // Añade una entrada fechada al final del HISTORIAL CLÍNICO (no borra nada de lo anterior)
        if (!/^rec[A-Za-z0-9]{14}$/.test(q.id || '') || !String(q.texto || '').trim()) return res.status(400).json({ ok: false, error: 'Falta el texto' });
        const pac = await at(`${PACIENTES}/${q.id}`);
        if (pac.error) return res.status(404).json({ ok: false, error: 'No encontrado' });
        const prev = String((pac.fields || {})['HISTORIAL CLÍNICO'] || '').replace(/\s+$/, '');
        const [y, m, dd] = (/^\d{4}-\d{2}-\d{2}$/.test(q.fecha || '') ? q.fecha : hoyF).split('-');
        const cab = `**Sesión ${+dd}/${+m}/${y}${q.fisio ? ' · ' + String(q.fisio).slice(0, 40) : ''}**`;
        const nuevo = (prev ? prev + '\n\n' : '') + cab + '\n' + String(q.texto).trim();
        const d = await at(`${PACIENTES}/${q.id}`, { method: 'PATCH', body: JSON.stringify({ fields: { 'HISTORIAL CLÍNICO': nuevo } }) });
        return res.status(200).json({ ok: !d.error, historial: nuevo, error: d.error && (d.error.message || d.error.type) });
      }
      if (action === 'seg-paciente-crear') {
        const nombre = String(q.nombre || '').trim().replace(/\s+/g, ' ');
        const tel = String(q.tel || '').replace(/\D/g, '').replace(/^0034|^34(?=\d{9}$)/, '');
        if (nombre.length < 3) return res.status(400).json({ ok: false, error: 'Escribe nombre y apellidos' });
        if (!/^\d{9,13}$/.test(tel)) return res.status(400).json({ ok: false, error: 'El teléfono no parece correcto' });
        const email = String(q.email || '').trim().toLowerCase();
        if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ ok: false, error: 'El email no parece correcto' });
        if (!q.forzar) {
          const esc = v => String(v).replace(/'/g, "\\'");
          const conds = [`RIGHT(REGEX_REPLACE({TELF}&'','[^0-9]',''),9)='${tel.slice(-9)}'`, `RIGHT(REGEX_REPLACE({WHATSAPP}&'','[^0-9]',''),9)='${tel.slice(-9)}'`, `LOWER(TRIM({FULL NAME}))='${esc(nombre.toLowerCase())}'`]; if (email) conds.push(`LOWER(TRIM({EMAIL}&''))='${esc(email)}'`);
          const ya = await todosT(PACIENTES, `filterByFormula=${encodeURIComponent('OR(' + conds.join(',') + ')')}&fields[]=FULL NAME&fields[]=TELF&fields[]=EMAIL&maxRecords=5`).catch(() => []);
          if (ya.length) return res.status(200).json({ ok: false, duplicado: ya.map(r => ({ id: r.id, nombre: r.fields['FULL NAME'] || '', tel: r.fields['TELF'] || '', email: r.fields['EMAIL'] || '' })) });
        }
        const f = { 'FULL NAME': nombre, TELF: tel, WHATSAPP: tel };
        if (email) f.EMAIL = email;
        if (q.dni) f.DNI = String(q.dni).trim().toUpperCase();
        if (/^\d{4}-\d{2}-\d{2}$/.test(q.cumple || '')) f.CUMPLE = q.cumple;
        if (q.notas) f.NOTAS = String(q.notas);
        const est = (Array.isArray(q.estados) ? q.estados : []).filter(x => /^rec[A-Za-z0-9]{14}$/.test(x)); if (est.length) f.ESTADO = est;
        let pin = ''; if (q.acceso && email) { pin = String(Math.floor(1000 + Math.random() * 9000)); f.PIN = pin; }
        const d = await at(PACIENTES, { method: 'POST', body: JSON.stringify({ records: [{ fields: f }], typecast: true }) });
        if (d.error || !d.records) return res.status(200).json({ ok: false, error: (d.error && (d.error.message || d.error.type)) || 'No se ha podido crear' });
        return res.status(200).json({ ok: true, paciente: { id: d.records[0].id, nombre, email, pin, telefono: tel, estados: est } });
      }
      if (action === 'seg-ficha-archivo') {
        if (!/^rec[A-Za-z0-9]{14}$/.test(q.id || '') || !q.file) return res.status(400).json({ ok: false, error: 'Falta el archivo' });
        const r = await fetch(`https://content.airtable.com/v0/${BASE_ID}/${q.id}/fldTMnwMj4c1C2835/uploadAttachment`, { method: 'POST', headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ contentType: String(q.tipo || 'application/octet-stream'), file: String(q.file), filename: String(q.nombre || 'archivo').slice(0, 120) }) });
        const d = await r.json().catch(() => ({}));
        return res.status(200).json({ ok: r.ok && !d.error, error: d.error && (d.error.message || d.error.type) });
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
        if (q.resultado === 'Cita recuperada' && /^rec[A-Za-z0-9]{14}$/.test(q.pacienteId || '')) await at(`${PACIENTES}/${q.pacienteId}`, { method: 'PATCH', body: JSON.stringify({ fields: { 'POR QUÉ NO REAGENDA': '', 'POR QUÉ FECHA': null, 'POR QUÉ FISIO': '' } }) }).catch(() => {});
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
    const d = await at(`${PACIENTES}/${q.pacienteId}`, { method: 'PATCH', body: JSON.stringify({ fields: String(q.nota || '').trim() ? { 'POR QUÉ NO REAGENDA': String(q.nota || '').slice(0, 2000), 'POR QUÉ FECHA': hoyF, 'POR QUÉ FISIO': String(q.fisio || '') } : { 'POR QUÉ NO REAGENDA': '', 'POR QUÉ FECHA': null, 'POR QUÉ FISIO': '' } }) });
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