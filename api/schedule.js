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

// ── Citas «Por reagendar» que ya tienen otra cita apuntada → pasan solas a «Reprogramada» ──
let _reagT = 0;
async function revisarPorReagendar(forzar) {
  if (!forzar && Date.now() - _reagT < 5 * 60e3) return 0; _reagT = Date.now();
  const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const pr = await capTodos(CIT_T, `filterByFormula=${encodeURIComponent("TRIM({ESTADO})='POR REAGENDAR'")}&fields[]=FECHA&fields[]=PacienteRec`);
  const pids = [...new Set(pr.flatMap(c => c.fields['PacienteRec'] || []))]; if (!pids.length) return 0;
  const otras = [];
  for (let i = 0; i < pids.length; i += 15) {
    const lote = pids.slice(i, i + 15);
    otras.push(...await capTodos(CIT_T, `filterByFormula=${encodeURIComponent(`AND(OR(TRIM({ESTADO})='PENDIENTE',TRIM({ESTADO})='REALIZADA',TRIM({ESTADO})='CITA DUDOSA'),OR(${lote.map(id => `FIND('${id}',ARRAYJOIN({PacienteRec}))`).join(',')}))`)}&fields[]=FECHA&fields[]=PacienteRec`).catch(() => []));
  }
  const cambiar = pr.filter(c => { const f = String(c.fields['FECHA'] || '').slice(0, 10), ps = c.fields['PacienteRec'] || [];
    return ps.length && otras.some(o => o.id !== c.id && (o.fields['PacienteRec'] || []).some(id => ps.includes(id)) && (String(o.fields['FECHA'] || '').slice(0, 10) >= f || String(o.fields['FECHA'] || '').slice(0, 10) >= hoy)); });
  for (let i = 0; i < cambiar.length; i += 10) await at(CIT_T, { method: 'PATCH', body: JSON.stringify({ records: cambiar.slice(i, i + 10).map(c => ({ id: c.id, fields: { ESTADO: 'REPROGRAMADA' } })), typecast: true }) }).catch(() => {});
  return cambiar.length;
}

// ── CONSENTIMIENTOS (formularios Tally) ────────────────────────────────────
// CONSENTIMIENTOS = formulario de primera visita (lo crea la integración de Tally).
// OTROS CONSENTIMIENTOS = suelo pélvico y alta oncológica: el panel los trae solo de Tally (API) y los guarda ahí.
// Se emparejan con el paciente por email, DNI o teléfono (últimos 9 dígitos) y nombre, y quedan enlazados (columna PACIENTE).
const CONS_T = 'tbl8uv04zFAk5L5bA', CONS_O = 'tblBBSyxl2IZMyU7I';
const TALLY_FORMS = { Gex8jo: 'Suelo pélvico', Dq4gE5: 'Alta oncológica' };
const C_SALUD = [['MARCAPASOS', 'Marcapasos'], ['EMBARAZO', 'Embarazo'], ['CÁNCER', 'Cáncer'], ['MEDICAMENTO CUAGULACIÓN', 'Toma anticoagulantes'], ['ARRITMIAS', 'Arritmias'], ['HIPERTENSIÓN', 'Hipertensión'], ['PROBLEMAS CIRCULACIÓN', 'Problemas de circulación'], ['PRÓTESIS', 'Prótesis'], ['FRACTURAS/CIRUGÍA', 'Fracturas o cirugías'], ['ENFERMEDAD NEUROLÓGICA', 'Enfermedad neurológica'], ['ALERGIA', 'Alergias'], ['DOLOR CRÓNICO', 'Dolor crónico']];
const nuevoPin = () => String(1000 + Math.floor(Math.random() * 9000));
const cNm = v => (v && typeof v === 'object') ? (v.name || '') : (v || '');
const cDig = v => String(v || '').replace(/\D/g, '').slice(-9);
const cTxt = v => String(v || '').trim().toLowerCase();
const cEsc = v => String(v || '').replace(/\\/g, '').replace(/'/g, "\\'");
const DIAS_EMBARAZO = 300; // un «embarazo» marcado hace más de ~10 meses ya no se tiene en cuenta
const fBr = f => String(f || '').slice(0, 10).split('-').reverse().join('/');
function consentResumen(r, tabla) {
  const F = r.fields || {}, otro = tabla === CONS_O;
  const fecha = String((otro ? F['FECHA'] : F['Creada']) || r.createdTime || '').slice(0, 10);
  const tipo = otro ? (cNm(F['TIPO']) || 'Suelo pélvico') : 'Primera visita';
  const viejo = fecha && (Date.now() - new Date(fecha + 'T12:00:00Z')) / 864e5 > DIAS_EMBARAZO;
  const salud = [], rojo = [];
  C_SALUD.forEach(([k, t]) => { const v = cNm(F[k]).trim(); if (!/^s[ií]$|^alta$/i.test(v)) return;
    if (k === 'EMBARAZO' && viejo) { salud.push({ k, t: 'Embarazo (marcado el ' + fBr(fecha) + ')', grave: false }); return; }
    if (k === 'ARRITMIAS' && salud.some(x => x.k === 'HIPERTENSIÓN')) return;
    const alta = /^alta$/i.test(v); salud.push({ k, alta, t: alta ? t + ' (ya de alta)' : t, grave: !alta && ['MARCAPASOS', 'EMBARAZO', 'CÁNCER'].includes(k) });
    if (!alta && ['MARCAPASOS', 'EMBARAZO', 'CÁNCER'].includes(k)) rojo.push(t); });
  const sp = cNm(F['SUELO PÉLVICO']).trim();
  const nombre = String(F['﻿NOMBRE'] || F['NOMBRE'] || '') + ' ' + String(F['APELLIDOS'] || '');
  return { id: r.id, tabla: otro ? CONS_O : CONS_T, tipo, fecha, salud, rojo, sueloPelvico: tipo === 'Suelo pélvico' || /^s[ií]$/i.test(sp), aceptaSP: !!F['ACEPTACIÓN S.P.'],
    fechaAlta: F['FECHA ALTA'] || '', notasSalud: F['NOTAS SALUD'] || '', sub: String(F['SUBMISSION ID'] || '').trim(), papel: !!F['PAPEL'], ignorar: !!F['IGNORAR'], noDe: String(F['NO ES DE'] || '').split(/[\s,]+/).filter(Boolean),
    marketing: otro ? null : { conocido: cNm(F['CONOCIDO']), newsletter: cNm(F['NEWSLETTER']), imagenes: cNm(F['IMAGENES']), citas: cNm(F['CITAS']) },
    email: cTxt(F['EMAIL']), dni: cTxt(F['DNI']).replace(/\s/g, ''), tel: cDig(F['TELF']), telRes: cDig(F['TELF RESERVA']), tels: [cDig(F['TELF']), cDig(F['TELF RESERVA'])].filter((t, i, a) => t.length === 9 && a.indexOf(t) === i), telRaw: String(F['TELF'] || '').trim(), raw: { DNI: F['DNI'] || '', EMAIL: F['EMAIL'] || '', NACIMIENTO: F['NACIMIENTO'] || '', TELF: F['TELF'] || '' }, nombre: cTxt(nombre).replace(/\s+/g, ' ') };
}
// Trae de Tally las respuestas nuevas de suelo pélvico y alta oncológica (como mucho cada minuto)
let _syncT = 0;
async function syncTally(subsYa) {
  const KEY = process.env.TALLY_API_KEY; if (!KEY || Date.now() - _syncT < 60e3) return 0; _syncT = Date.now();
  let n = 0;
  for (const [form, tipo] of Object.entries(TALLY_FORMS)) {
    for (let page = 1; page <= 5; page++) {
      const d = await fetch(`https://api.tally.so/forms/${form}/submissions?filter=completed&page=${page}&limit=50`, { headers: { Authorization: `Bearer ${KEY}` } }).then(x => x.ok ? x.json() : null).catch(() => null);
      if (!d) break;
      const qs = d.questions || [], tit = id => { const q0 = qs.find(q => q.id === id) || {}; return capNorm(q0.title || q0.label || '').trim(); };
      let pend = (d.submissions || []).filter(s => s.isCompleted !== false && s.id && /^[A-Za-z0-9]+$/.test(s.id) && !subsYa.has(s.id));
      // Otra copia del panel puede haberlas guardado ya: se mira en Airtable antes de crear nada
      if (pend.length) { const ya = await capTodos(CONS_O, `filterByFormula=${encodeURIComponent('OR(' + pend.map(s => `{SUBMISSION ID}='${s.id}'`).join(',') + ')')}&fields[]=SUBMISSION ID`).catch(() => null);
        if (!ya) break; ya.forEach(r => subsYa.add(String(r.fields['SUBMISSION ID'] || ''))); pend = pend.filter(s => !subsYa.has(s.id)); }
      const recs = pend.map(s => {
        const f = { TIPO: tipo, 'SUBMISSION ID': s.id, 'FORM ID': form, FECHA: String(s.submittedAt || '').slice(0, 10) };
        (s.responses || []).forEach(x => { const t = tit(x.questionId), a = x.answer !== undefined ? x.answer : x.value;
          const arr = Array.isArray(a) ? a : (a == null ? [] : [a]);
          const txt = arr.filter(v => typeof v !== 'object').join(', ').trim(), files = arr.filter(v => v && typeof v === 'object' && v.url).map(v => ({ url: v.url, filename: v.name || 'archivo' }));
          if (t === 'nombre') f.NOMBRE = txt; else if (t === 'apellidos') f.APELLIDOS = txt; else if (/^nif|nie$/.test(t)) f.DNI = txt; else if (/telefono/.test(t)) f.TELF = txt; else if (t === 'email') f.EMAIL = txt;
          else if (/fecha del alta/.test(t)) { if (/^\d{4}-\d{2}-\d{2}/.test(txt)) f['FECHA ALTA'] = txt.slice(0, 10); }
          else if (/informe/.test(t)) { if (files.length) f.INFORME = files; }
          else if (t === 'firma') { if (files.length) f.FIRMA = files.slice(0, 1); }
          else if (t === 'fecha') { if (/^\d{4}-\d{2}-\d{2}/.test(txt)) f.FECHA = txt.slice(0, 10); }
          else if (/embarazada/.test(t)) f.EMBARAZO = txt; else if (/marcapasos/.test(t)) f.MARCAPASOS = txt; else if (/circulatorios/.test(t)) f['PROBLEMAS CIRCULACIÓN'] = txt;
          else if (/hipertension/.test(t)) f['HIPERTENSIÓN'] = txt; else if (/protesis/.test(t)) f['PRÓTESIS'] = txt; else if (/fracturas/.test(t)) f['FRACTURAS/CIRUGÍA'] = txt;
          else if (/cancer/.test(t)) f['CÁNCER'] = txt; else if (/neurologicas/.test(t)) f['ENFERMEDAD NEUROLÓGICA'] = txt; else if (/coagulacion/.test(t)) f['MEDICAMENTO CUAGULACIÓN'] = txt;
          else if (/alergias/.test(t)) f.ALERGIA = txt; else if (/dolor cronico/.test(t)) f['DOLOR CRÓNICO'] = txt; else if (/algo mas/.test(t)) f['NOTAS SALUD'] = txt;
          else if (/confirma lo siguiente/.test(t)) { if (arr.length >= 2) f['ACEPTACIÓN S.P.'] = true; } });
        if (tipo === 'Alta oncológica') f['CÁNCER'] = 'Alta';
        return { fields: f }; });
      for (let i = 0; i < recs.length; i += 10) { const r = await at(CONS_O, { method: 'POST', body: JSON.stringify({ records: recs.slice(i, i + 10), typecast: true }) }); if (!r.error) { n += (r.records || []).length; recs.slice(i, i + 10).forEach(x => subsYa.add(x.fields['SUBMISSION ID'])); } }
      if (!d.hasMore) break;
    }
  }
  // Primera visita: el «teléfono de la reserva» (si la cita se cogió con el móvil de un familiar) se copia a CONSENTIMIENTOS
  n += await syncTelReserva(KEY).catch(() => 0);
  return n;
}
const _resYa = new Set();
async function syncTelReserva(KEY) {
  const d = await fetch(`https://api.tally.so/forms/b5j1M2/submissions?filter=completed&page=1&limit=50`, { headers: { Authorization: `Bearer ${KEY}` } }).then(x => x.ok ? x.json() : null).catch(() => null);
  if (!d) return 0;
  const q = (d.questions || []).find(q0 => /se reservo la cita/.test(capNorm(q0.title || q0.label || ''))); if (!q) return 0;
  const tel = {}; (d.submissions || []).forEach(s => { if (!s.id || _resYa.has(s.id) || !/^[A-Za-z0-9]+$/.test(s.id)) return; const x = (s.responses || []).find(r => r.questionId === q.id); const v = String((x && (x.answer !== undefined ? x.answer : x.value)) || '').trim(); if (v.replace(/\D/g, '').length >= 9) tel[s.id] = v.slice(0, 30); else _resYa.add(s.id); });
  const ids = Object.keys(tel); if (!ids.length) return 0;
  const rs = await capTodos(CONS_T, `filterByFormula=${encodeURIComponent('OR(' + ids.map(i => `{SUBMISSION ID}='${i}'`).join(',') + ')')}&fields[]=SUBMISSION ID&fields[]=TELF RESERVA`).catch(() => null); if (!rs) return 0;
  const upd = rs.filter(r => !r.fields['TELF RESERVA']).map(r => ({ id: r.id, fields: { 'TELF RESERVA': tel[String(r.fields['SUBMISSION ID'] || '').trim()] } })).filter(r => r.fields['TELF RESERVA']);
  rs.forEach(r => _resYa.add(String(r.fields['SUBMISSION ID'] || '').trim()));
  let n = 0; for (let i = 0; i < upd.length; i += 10) { const r = await at(CONS_T, { method: 'PATCH', body: JSON.stringify({ records: upd.slice(i, i + 10) }) }); if (!r.error) n += upd.slice(i, i + 10).length; }
  return n;
}
// Todos los consentimientos en memoria (10 min) y las respuestas nuevas de Tally (cada minuto)
let _cons = { t: 0, v: null, p: null };
async function consTodos(forzar) {
  const fresco = _cons.v && Date.now() - _cons.t < 3 * 60e3;
  if (!forzar && fresco && (!process.env.TALLY_API_KEY || Date.now() - _syncT < 60e3)) return _cons.v;
  if (_cons.p) return _cons.p;
  _cons.p = (async () => {
    const leer = async () => { const [a, b] = await Promise.all([capTodos(CONS_T, 'sort[0][field]=Creada&sort[0][direction]=desc'), capTodos(CONS_O, 'sort[0][field]=FECHA&sort[0][direction]=desc').catch(() => [])]);
      return [...a.map(r => ({ ...consentResumen(r, CONS_T), pac: r.fields['PACIENTE'] || [] })), ...b.filter((r, i) => { const sb = String(r.fields['SUBMISSION ID'] || ''); return !sb || !b.some((o, j) => String(o.fields['SUBMISSION ID'] || '') === sb && ((o.fields['PACIENTE'] || []).length > (r.fields['PACIENTE'] || []).length || (j < i && (o.fields['PACIENTE'] || []).length === (r.fields['PACIENTE'] || []).length))); }).map(r => ({ ...consentResumen(r, CONS_O), pac: r.fields['PACIENTE'] || [] }))].sort((x, y) => y.fecha.localeCompare(x.fecha)); };
    let v = fresco && !forzar ? _cons.v : await leer();
    const nuevos = await syncTally(new Set(v.map(c => c.sub).filter(Boolean))).catch(() => 0);
    if (nuevos) v = await leer();
    _cons = { t: fresco && !forzar && !nuevos ? _cons.t : Date.now(), v, p: null }; if (nuevos) _alertas.t = 0; return v;
  })().catch(e => { _cons.p = null; if (_cons.v) return _cons.v; throw e; });
  return _cons.p;
}
const nomToks = t => capNorm(t).split(/[^a-z0-9ñ]+/).filter(w => w.length >= 3 && !/^(del|las|los|que)$/.test(w));
const nombresCuadran = (a, b) => { const A = nomToks(a), B = nomToks(b); return A.some(w => B.includes(w)); };
// Para un paciente: los que ya tiene enlazados, los libres que son suyos seguro (buenos) y los que comparten teléfono/email/DNI pero no el nombre (dudosos)
function emparejar(P, pacId, lista, altaPac) {
  const enl = lista.filter(c => c.pac.includes(pacId));
  const email = cTxt(P['EMAIL']), dni = cTxt(P['DNI']).replace(/\s/g, ''), tels = [cDig(P['TELF']), cDig(P['WHATSAPP'])].filter(t => t.length === 9), nombre = P['FULL NAME'] || '';
  const libres = lista.filter(c => !c.pac.length && !(c.noDe || []).includes(pacId));
  const cands = libres.filter(c => (email && c.email === email) || (dni.length >= 6 && c.dni === dni) || c.tels.some(t => tels.includes(t)));
  const n = capNorm(nombre).replace(/\s+/g, ' ').trim();
  // Teléfono, email o DNI iguales bastan para enlazarlo aunque lo firme con otro nombre, siempre que el formulario sea
  // de después de crear la ficha (los antiguos con otro nombre son de otra persona o pruebas: esos se preguntan)
  const desde = altaPac ? new Date(new Date(altaPac).getTime() - 3 * 864e5).toISOString().slice(0, 10) : '';
  const buenos = [...new Set([...cands.filter(c => nombresCuadran(c.nombre, nombre) || (desde && c.fecha >= desde)), ...(n.split(' ').length >= 2 ? libres.filter(c => capNorm(c.nombre) === n) : [])])];
  return { enl, buenos, dudosos: cands.filter(c => !buenos.includes(c)) };
}
// Mismo formulario repetido (la importación de mayo duplicó filas, o Tally lo mandó dos veces): mismo envío, o mismo nombre + fecha + teléfono/DNI
const mismoForm = (a, b) => a.id !== b.id && a.tabla === b.tabla && ((a.sub && a.sub === b.sub) || (a.nombre && a.nombre === b.nombre && a.fecha === b.fecha && ((a.tel && a.tel === b.tel) || (a.dni && a.dni === b.dni))));
const enlazarCons = async (consId, pacId) => { const c0 = (_cons.v || []).find(x => x.id === consId), T = c0 ? c0.tabla : CONS_T;
  let d = await at(`${T}/${consId}`, { method: 'PATCH', body: JSON.stringify({ fields: { PACIENTE: pacId ? [pacId] : [] } }) });
  if (d.error && !c0) d = await at(`${CONS_O}/${consId}`, { method: 'PATCH', body: JSON.stringify({ fields: { PACIENTE: pacId ? [pacId] : [] } }) });
  if (c0) { c0.pac = pacId ? [pacId] : [];
    // sus copias van con él
    const copias = (_cons.v || []).filter(x => mismoForm(x, c0));
    for (const x of copias.slice(0, 5)) { const r = await at(`${x.tabla}/${x.id}`, { method: 'PATCH', body: JSON.stringify({ fields: { PACIENTE: pacId ? [pacId] : [] } }) }).catch(() => ({ error: 1 })); if (!r.error) x.pac = pacId ? [pacId] : []; } }
  if (pacId && !d.error) await rellenarPaciente(pacId, d.fields || {}).catch(() => {});
  _alertas.t = 0; return !d.error; };
// Al enlazar un formulario, los datos que le faltaban al paciente (DNI, email, cumpleaños, teléfono) se rellenan con los del formulario.
// Lo que ya tenía no se toca (el formulario lo puede haber rellenado un familiar).
async function rellenarPaciente(pacId, CF) {
  const p = await at(`${PACIENTES}/${pacId}`); if (p.error) return; // (el GET de un registro no admite fields[])
  const P = p.fields || {}, f = {};
  const dni = String(CF['DNI'] || '').trim().toUpperCase(), email = String(CF['EMAIL'] || '').trim().toLowerCase(), nac = String(CF['NACIMIENTO'] || '').slice(0, 10), tel = String(CF['TELF'] || '').replace(/[^\d+]/g, '');
  if (!P['DNI'] && dni.length >= 6 && !/^0+$/.test(dni)) f['DNI'] = dni;
  if (!P['EMAIL'] && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) f['EMAIL'] = email;
  if (!P['CUMPLE'] && /^\d{4}-\d{2}-\d{2}$/.test(nac)) f['CUMPLE'] = nac;
  if (!P['TELF'] && !P['WHATSAPP'] && tel.replace(/\D/g, '').length >= 9) f['TELF'] = tel;
  if (Object.keys(f).length) { const r = await at(`${PACIENTES}/${pacId}`, { method: 'PATCH', body: JSON.stringify({ fields: f, typecast: true }) }); if (r.error) return {}; }
  return f;
}
const consPublico = (x, estado) => { if (!x) return null; const c = { ...x, estado }; ['email', 'dni', 'tel', 'tels', 'telRes', 'pac', 'sub', 'raw'].forEach(k => delete c[k]); c.nombreForm = x.nombre; delete c.nombre; return c; };
// Junta todos los formularios de un paciente: la salud sale del último de primera visita o suelo pélvico; el alta oncológica quita el cáncer
function resumenPaciente(enl) {
  if (!enl.length) return null;
  const docs = enl.slice().sort((a, b) => b.fecha.localeCompare(a.fecha));
  const base = docs.find(c => c.tipo !== 'Alta oncológica' && !c.papel) || docs.find(c => c.tipo !== 'Alta oncológica') || docs[0], alta = docs.find(c => c.tipo === 'Alta oncológica');
  const prim = docs.find(c => c.tipo === 'Primera visita' && !c.papel);
  const out = { ...base, salud: base.salud.slice(), rojo: base.rojo.slice() };
  if (alta && base !== alta && alta.fecha >= base.fecha) { out.salud = out.salud.filter(x => x.k !== 'CÁNCER'); out.salud.push({ k: 'ALTA', alta: true, t: 'Alta oncológica' + (alta.fechaAlta ? ' (' + fBr(alta.fechaAlta) + ')' : '') + ' ✓', grave: false }); out.rojo = out.rojo.filter(x => x !== 'Cáncer'); }
  out.aceptaSP = docs.some(c => c.aceptaSP); out.sueloPelvico = docs.some(c => c.sueloPelvico);
  out.marketing = (prim || {}).marketing || null; out.fechaPrimera = prim ? prim.fecha : '';
  out.docs = docs.map(c => ({ id: c.id, tipo: c.tipo, fecha: c.fecha, firmante: c.papel ? '' : capNorm(c.nombre).trim(), papel: c.papel }));
  out.soloPapel = !!base.papel;
  { const ct = docs.find(c => !c.papel && c.telRaw); out.telForm = ct ? ct.telRaw : ''; }
  out.cancerActivo = out.salud.some(x => x.k === 'CÁNCER' && !x.alta);
  return out;
}
async function consentDe(P, pacId, altaPac) {
  let lista = await consTodos();
  // La lista está en memoria (puede ser de hace unos minutos y de otra copia del servidor): lo enlazado se toma de la propia ficha
  // y los candidatos se vuelven a leer de Airtable, para no volver a enlazar ni preguntar lo que ya se ha dicho que no es suyo
  { const ids = new Set(); Object.values(P || {}).forEach(v => { if (Array.isArray(v)) v.forEach(x => { if (typeof x === 'string' && /^rec/.test(x)) ids.add(x); }); });
    lista.forEach(c => { const tiene = ids.has(c.id); if (tiene && !c.pac.includes(pacId)) c.pac = [...c.pac, pacId]; else if (!tiene && c.pac.includes(pacId)) c.pac = c.pac.filter(x => x !== pacId); });
    const pre = emparejar(P, pacId, lista, altaPac), cand = [...pre.buenos, ...pre.dudosos].slice(0, 20);
    for (const T of [CONS_T, CONS_O]) { const cs = cand.filter(c => c.tabla === T); if (!cs.length) continue;
      const rs = await capTodos(T, `filterByFormula=${encodeURIComponent('OR(' + cs.map(c => `RECORD_ID()='${c.id}'`).join(',') + ')')}&fields[]=PACIENTE&fields[]=NO ES DE`).catch(() => null);
      if (rs) cs.forEach(c => { const r = rs.find(x => x.id === c.id); if (!r) return; c.pac = r.fields['PACIENTE'] || []; c.noDe = String(r.fields['NO ES DE'] || '').split(/[\s,]+/).filter(Boolean); }); } }
  const { enl, buenos, dudosos } = emparejar(P, pacId, lista, altaPac);
  for (const c of buenos.slice(0, 6)) if (await enlazarCons(c.id, pacId).catch(() => false)) enl.push(c);
  if (!enl.length) return dudosos.length ? consPublico(dudosos[0], 'dudoso') : null;
  // Si le faltan datos personales que están en sus formularios (p. ej. enlazados antes), se rellenan ahora
  let rell = {};
  if (!P['DNI'] || !P['EMAIL'] || !P['CUMPLE'] || (!P['TELF'] && !P['WHATSAPP'])) {
    const src = enl.slice().sort((a, b) => b.fecha.localeCompare(a.fecha)).filter(c => !c.papel && c.raw), mix = {};
    ['DNI', 'EMAIL', 'NACIMIENTO', 'TELF'].forEach(k => { const c = src.find(x => x.raw[k]); if (c) mix[k] = c.raw[k]; });
    if (Object.keys(mix).length) rell = await rellenarPaciente(pacId, mix).catch(() => ({})) || {};
  }
  const out = consPublico(resumenPaciente(enl), 'enlazado'); out.rellenado = rell;
  // Formularios con su mismo teléfono/email/DNI pero otro nombre (p. ej. lo rellenó un familiar): se preguntan en la ficha
  out.porConfirmar = dudosos.filter(c => !enl.some(e => e.sub && e.sub === c.sub)).slice(0, 5).map(c => ({ id: c.id, tipo: c.tipo, fecha: c.fecha, nombre: c.nombre }));
  return out;
}
// Pacientes con marcapasos, embarazo o cáncer (para marcarlos en rojo en la agenda). Se guarda 20 min.
let _alertas = { t: 0, m: null, p: null };
async function alertasSalud() {
  if (_alertas.m && Date.now() - _alertas.t < 20 * 60e3) return _alertas.m;
  if (_alertas.p) return _alertas.p;
  _alertas.p = (async () => {
    const todos = async (t, q2) => { let recs = [], off = ''; do { const d = await at(`${t}?${q2}&pageSize=100${off ? '&offset=' + off : ''}`); if (d.error) throw new Error(d.error.message || 'Airtable'); recs = recs.concat(d.records || []); off = d.offset || ''; } while (off); return recs; };
    const lista = await consTodos(), m = {}, porPac = {};
    lista.forEach(c => c.pac.forEach(id => { (porPac[id] = porPac[id] || []).push(c); }));
    Object.entries(porPac).forEach(([id, cs]) => { const r = resumenPaciente(cs); if (r && r.rojo.length) m[id] = r.rojo; });
    const cs = lista.filter(c => !c.pac.length && c.rojo.length);
    const conds = []; cs.forEach(c => { if (c.email) conds.push(`LOWER(TRIM({EMAIL}))='${cEsc(c.email)}'`); if (c.dni.length >= 6) conds.push(`SUBSTITUTE(LOWER(TRIM({DNI})),' ','')='${cEsc(c.dni)}'`); c.tels.forEach(t => conds.push(`RIGHT(REGEX_REPLACE({TELF}&'','[^0-9]',''),9)='${t}'`, `RIGHT(REGEX_REPLACE({WHATSAPP}&'','[^0-9]',''),9)='${t}'`)); });
    const pacs = []; for (let i = 0; i < conds.length; i += 40) pacs.push(...await todos(PACIENTES, `filterByFormula=${encodeURIComponent('OR(' + conds.slice(i, i + 40).join(',') + ')')}&fields[]=EMAIL&fields[]=DNI&fields[]=TELF&fields[]=WHATSAPP`));
    pacs.forEach(p => { if (porPac[p.id]) return; const F = p.fields, e = cTxt(F['EMAIL']), d = cTxt(F['DNI']).replace(/\s/g, ''), ts = [cDig(F['TELF']), cDig(F['WHATSAPP'])].filter(t => t.length === 9);
      cs.forEach(c => { if ((e && c.email === e) || (d.length >= 6 && c.dni === d) || c.tels.some(t => ts.includes(t))) m[p.id] = [...new Set([...(m[p.id] || []), ...c.rojo])]; }); });
    _alertas = { t: Date.now(), m, p: null }; return m;
  })().catch(e => { _alertas.p = null; return _alertas.m || {}; });
  return _alertas.p;
}
// Datos completos de un consentimiento para crear su PDF (con la firma). La firma se trae de Tally la primera vez y se guarda en Airtable.
async function datosConsent(id) {
  let r = await at(`${CONS_T}/${id}`); if (r.error) r = await at(`${CONS_O}/${id}`); if (r.error) return null; const T = (r.fields && (r.fields['TIPO'] || r.fields['FECHA ALTA'] !== undefined || r.fields['Creada'] === undefined && r.fields['FECHA'])) ? CONS_O : CONS_T; // Airtable devuelve el registro aunque la tabla de la URL no sea la suya
  const F = r.fields || {}, KEY = T === CONS_T ? process.env.TALLY_API_KEY : '', otro = T === CONS_O;
  let firmaUrl = ((F['FIRMA'] || [])[0] || {}).url || '', tutor = '', tutorNif = '', recomendo = '';
  const sub = String(F['SUBMISSION ID'] || '').trim(), form = cNm(F['FORM ID']).trim() || 'b5j1M2';
  if (KEY && sub && /^[A-Za-z0-9]+$/.test(sub) && /^[A-Za-z0-9]+$/.test(form)) {
    const t = await fetch(`https://api.tally.so/forms/${form}/submissions/${sub}`, { headers: { Authorization: `Bearer ${KEY}` } }).then(x => x.ok ? x.json() : null).catch(() => null);
    if (t) {
      const qs = t.questions || (t.data && t.data.questions) || [], subm = t.submission || t.data || t, resp = subm.responses || [];
      const lab = id => { const x = qs.find(z => z.id === id); return capNorm(x && (x.title || x.label) || ''); };
      const val = a => Array.isArray(a) ? a.map(v => typeof v === 'object' ? '' : v).join(', ') : (typeof a === 'object' ? '' : String(a ?? ''));
      resp.forEach(x => { const l = lab(x.questionId), a = x.answer !== undefined ? x.answer : x.value;
        if (/tutor/.test(l) && /nif/.test(l)) tutorNif = val(a); else if (/tutor/.test(l)) tutor = val(a); else if (/recomend/.test(l)) recomendo = val(a);
        if (!firmaUrl) { const enc = JSON.stringify(a || ''); const m = enc.match(/https:\/\/storage\.tally\.so\/[^"]+\.png[^"]*/); if (m && (/firma|signature/.test(l) || x.type === 'SIGNATURE' || !l)) firmaUrl = m[0].replace(/\\u0026/g, '&'); } });
      if (firmaUrl && !(F['FIRMA'] || []).length) await at(`${CONS_T}/${id}`, { method: 'PATCH', body: JSON.stringify({ fields: { FIRMA: [{ url: firmaUrl, filename: 'firma.png' }] } }) }).catch(() => {});
    }
  }
  let firma = '';
  if (firmaUrl) { try { const im = await fetch(firmaUrl); if (im.ok) firma = `data:${im.headers.get('content-type') || 'image/png'};base64,` + Buffer.from(await im.arrayBuffer()).toString('base64'); } catch (e) {} }
  const resp = {}; Object.keys(F).forEach(k => { const v = F[k]; if (v && typeof v === 'object' && !Array.isArray(v) && v.name) resp[k] = v.name; else if (typeof v === 'string' && v.length < 60) resp[k] = v; });
  return { ok: true, tally: !!process.env.TALLY_API_KEY, pac: F['PACIENTE'] || [], papel: !!F['PAPEL'], doc: { id: r.id, tipo: otro ? (cNm(F['TIPO']) || 'Suelo pélvico') : 'Primera visita', fechaAlta: F['FECHA ALTA'] || '', notasSalud: F['NOTAS SALUD'] || '', informe: (F['INFORME'] || []).map(a => ({ url: a.url, nombre: a.filename || 'informe' })), nombre: String(F['﻿NOMBRE'] || F['NOMBRE'] || '').trim(), apellidos: String(F['APELLIDOS'] || '').trim(), dni: String(F['DNI'] || '').trim(), nacimiento: F['NACIMIENTO'] || '', email: F['EMAIL'] || '', tel: F['TELF'] || '', fecha: (otro ? F['FECHA'] : F['Creada']) || String(r.createdTime || '').slice(0, 10), aceptaSP: !!F['ACEPTACIÓN S.P.'], resp, firma, tutor, tutorNif, recomendo } };
}

// ── CAPTACIÓN: contactos sin cita, lista de espera y negocios del barrio ─────
const CAP = { contacto: 'tblgsMcknBLDyfWHu', esperaP: 'tbl5ksXlpfsSTZk5i', esperaN: 'tblAvnUMOvVo4OBne', negocio: 'tblO5y1Ikg3LIalic', referidos: 'tblr27u3cvtzfyqI6' };
const capTodos = async (t, q2) => { let recs = [], off = ''; do { const d = await at(`${t}?${q2}&pageSize=100${off ? '&offset=' + off : ''}`); if (d.error) throw new Error(d.error.message || 'Airtable'); recs = recs.concat(d.records || []); off = d.offset || ''; } while (off); return recs; };
let _espera = { t: 0, v: null };
async function esperaLista(forzar) {
  if (!forzar && _espera.v && Date.now() - _espera.t < 5 * 60e3) return _espera.v;
  const [p, n] = await Promise.all([capTodos(CAP.esperaP, 'sort[0][field]=FECHA SOLICITUD&sort[0][direction]=desc'), capTodos(CAP.esperaN, 'sort[0][field]=FECHA SOLICITUD&sort[0][direction]=desc')]);
  const pids = [...new Set(p.map(r => (r.fields['PACIENTE'] || [])[0]).filter(Boolean))], info = {};
  for (let i = 0; i < pids.length; i += 40) (await capTodos(PACIENTES, `filterByFormula=${encodeURIComponent('OR(' + pids.slice(i, i + 40).map(id => `RECORD_ID()='${id}'`).join(',') + ')')}&fields[]=FULL NAME&fields[]=WHATSAPP&fields[]=TELF`)).forEach(x => { info[x.id] = { nombre: x.fields['FULL NAME'] || '', tel: x.fields['WHATSAPP'] || x.fields['TELF'] || '' }; });
  const est = (F, perdido) => { const e = cNm(F['ESTADO']); if (e) return e; return perdido ? 'YA NO' : 'ESPERANDO'; };
  const v = [
    ...p.map(r => { const F = r.fields, pid = (F['PACIENTE'] || [])[0] || ''; return { id: r.id, tabla: 'esperaP', pacienteId: pid, nombre: (info[pid] || {}).nombre || '—', tel: (info[pid] || {}).tel || '', fecha: F['FECHA SOLICITUD'] || String(r.createdTime).slice(0, 10), nota: F['NOTAS'] || '', disp: F['DISPONIBILIDAD'] || '', dias: (F['DIAS'] || []).map(cNm), franja: (F['FRANJA'] || []).map(cNm), fisio: F['FISIO'] || '', estado: est(F, false) }; }),
    ...n.map(r => { const F = r.fields; return { id: r.id, tabla: 'esperaN', pacienteId: '', nombre: F['NOMBRE'] || 'Sin nombre', tel: F['TELF'] || '', fecha: F['FECHA SOLICITUD'] || String(r.createdTime).slice(0, 10), nota: F['NOTAS'] || '', disp: F['DISPONIBILIDAD'] || '', dias: (F['DIAS'] || []).map(cNm), franja: (F['FRANJA'] || []).map(cNm), fisio: F['FISIO'] || '', estado: est(F, cNm(F['PERDIDO?']) === 'SÍ') }; })
  ].sort((a, b) => b.fecha.localeCompare(a.fecha));
  _espera = { t: Date.now(), v }; return v;
}
const capNorm = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const CAP_STOP = /^(farmacia|clinica|clinic|centro|dental|estetica|podologia|podologo|institut|institus|odontologics|barcelona|sant|andreu|gran|de|del|la|el|les|los|y|i)$/;

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
        const nf = { 'FULL NAME': nombre || 'Paciente web', PIN: nuevoPin() };
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
  // Tarjeta regalo pública (el enlace que va por WhatsApp; la vista previa enseña la imagen)
  if (action === 'tarjeta-img' || action === 'tarjeta-pagina') {
    const id = String(req.query.id || ''); if (!/^rec[A-Za-z0-9]{14}$/.test(id)) return res.status(404).end();
    const r = await at(`tblr27u3cvtzfyqI6/${id}`); const a = r.fields && (r.fields['TARJETA IMG'] || [])[0];
    if (!a) return res.status(404).send('Tarjeta no encontrada');
    if (action === 'tarjeta-img') { const im = await fetch(a.url); res.setHeader('Content-Type', a.type || 'image/jpeg'); res.setHeader('Cache-Control', 'public, max-age=86400'); return res.status(200).send(Buffer.from(await im.arrayBuffer())); }
    const img = `https://app.fisioterapia365.com/api/schedule?action=tarjeta-img&id=${id}`, cad = String(r.fields['CADUCA'] || '').split('-').reverse().join('/');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Tarjeta regalo · FISIO365</title>
<meta property="og:title" content="Tarjeta regalo de 10 €"><meta property="og:description" content="FISIO365 · Te lo descontamos en tu próxima sesión"><meta property="og:image" content="${img}"><meta property="og:image:width" content="1080"><meta property="og:image:height" content="1080"><meta property="og:image:type" content="image/jpeg"><meta property="og:type" content="website"><meta name="twitter:card" content="summary">
<link rel="icon" href="/icons/favicon-cara.png"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@500;700&display=swap" rel="stylesheet">
<style>body{margin:0;background:#f5f2ee;font-family:Poppins,sans-serif;color:#1a1a1a;display:flex;justify-content:center}main{max-width:440px;width:100%;padding:28px 16px;box-sizing:border-box}img{width:100%;border-radius:20px;box-shadow:0 10px 30px rgba(194,85,46,.25);display:block}h1{font-size:20px;margin:22px 0 6px}p{font-size:15px;line-height:1.5;color:#5c4f47;margin:0 0 18px}a{display:block;text-align:center;background:#1a1a1a;color:#fff;text-decoration:none;font-weight:700;border-radius:14px;padding:14px}</style></head>
<body><main><img src="${img}" alt="Tarjeta regalo de 10 €"><h1>¡Gracias por recomendarnos!</h1><p>Tienes 10 € de descuento en tu próxima sesión${cad ? ', válido hasta el ' + cad : ''}. No tienes que hacer nada: lo tenemos apuntado y te lo descontamos al pagar.</p><a href="https://app.fisioterapia365.com">Abrir mi app de FISIO365</a></main></body></html>`);
  }
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
      // ── CONSENTIMIENTOS: buscar, enlazar y pendientes ──
      if (action === 'seg-consent-buscar') {
        const t = capNorm(q.q || '').trim(), td = String(q.q || '').replace(/\D/g, '');
        if (t.length < 2) return res.status(200).json({ ok: true, res: [] });
        const lista = await consTodos();
        const r = lista.filter(c => capNorm(c.nombre).includes(t) || (c.email && c.email.includes(t)) || (td.length >= 4 && (c.tel.includes(td.slice(-9)) || (c.telRes && c.telRes.includes(td.slice(-9))) || c.dni.includes(td)))).slice(0, 15);
        const pids = [...new Set(r.flatMap(c => c.pac))], nom = {};
        if (pids.length) (await capTodos(PACIENTES, `filterByFormula=${encodeURIComponent('OR(' + pids.map(id => `RECORD_ID()='${id}'`).join(',') + ')')}&fields[]=FULL NAME`)).forEach(p => { nom[p.id] = p.fields['FULL NAME'] || ''; });
        return res.status(200).json({ ok: true, res: r.map(c => ({ id: c.id, tipo: c.tipo, nombre: c.nombre, fecha: c.fecha, tel: c.tel, email: c.email, de: c.pac.map(id => nom[id] || '').filter(Boolean).join(', ') })) });
      }
      // ── REFERIDOS: tarjeta regalo de 10 € para quien recomienda, cuando el recomendado viene a su primera sesión ──
      if (action.startsWith('seg-referido')) {
        const REF = 'tblr27u3cvtzfyqI6', okId = x => /^rec[A-Za-z0-9]{14}$/.test(x || '');
        if (action === 'seg-referidos') {
          const desde = new Date(Date.now() - 120 * 864e5).toISOString().slice(0, 10);
          const rs = await todosT(REF, `filterByFormula=${encodeURIComponent(`AND({Nombre de quien recomendó}!='',NOT({IGNORAR}),{CÓDIGO}='',NOT({Regalo entregado}),IS_AFTER({Fecha},'${desde}'))`)}`);
          if (!rs.length) return res.status(200).json({ ok: true, porDar: [] });
          const cons = await consTodos(), pacsAll = await todosT(PACIENTES, 'fields[]=FULL NAME&fields[]=WHATSAPP&fields[]=TELF');
          const nomP = id => ((pacsAll.find(p => p.id === id) || {}).fields || {})['FULL NAME'] || '';
          const tokP = pacsAll.map(p => ({ id: p.id, t: nomToks(p.fields['FULL NAME'] || ''), creado: p.createdTime, tel: p.fields['WHATSAPP'] || p.fields['TELF'] || '' }));
          // 1) Paciente nuevo: el del formulario de ese día con ese nombre (ya enlazado); si no, por nombre completo
          for (const r of rs) { const F = r.fields; if ((F['PACIENTE'] || []).length) continue;
            const nm = `${F['Nombre'] || ''} ${F['Apellidos'] || ''}`, fe = String(F['Fecha'] || '').slice(0, 10);
            const c = cons.find(c => c.tipo === 'Primera visita' && c.pac.length === 1 && Math.abs(new Date(c.fecha) - new Date(fe)) <= 3 * 864e5 && nombresCuadran(c.nombre, nm) && nomToks(nm).filter(t => nomToks(c.nombre).includes(t)).length >= 2);
            let pid = c ? c.pac[0] : '';
            if (!pid) { const tk = nomToks(nm); const m = tokP.filter(p => tk.length >= 2 && tk.every(t => p.t.includes(t))); if (m.length === 1) pid = m[0].id; }
            if (pid) { const u = await at(`${REF}/${r.id}`, { method: 'PATCH', body: JSON.stringify({ fields: { PACIENTE: [pid] } }) }); if (!u.error) F['PACIENTE'] = [pid]; } }
          // 2) Quién recomendó: si su nombre (2 palabras o más) cuadra con un único paciente, se enlaza solo; si no, se proponen
          const sug = {};
          for (const r of rs) { const F = r.fields; if ((F['RECOMENDÓ'] || []).length) continue;
            const tk = nomToks(String(F['Nombre de quien recomendó'] || '').replace(/\(.*?\)/g, ' ')); if (!tk.length) { sug[r.id] = []; continue; }
            const nuevo = (F['PACIENTE'] || [])[0];
            const m = tokP.filter(p => p.id !== nuevo && tk.every(t => p.t.includes(t)));
            if (tk.length >= 2 && m.length === 1) { const u = await at(`${REF}/${r.id}`, { method: 'PATCH', body: JSON.stringify({ fields: { 'RECOMENDÓ': [m[0].id] } }) }); if (!u.error) { F['RECOMENDÓ'] = [m[0].id]; continue; } }
            const parc = tokP.filter(p => p.id !== nuevo && tk.some(t => p.t.includes(t))).map(p => ({ p, n: tk.filter(t => p.t.includes(t)).length })).sort((a, b) => b.n - a.n).slice(0, 6);
            sug[r.id] = (m.length ? m.slice(0, 6) : parc.map(x => x.p)).map(p => ({ id: p.id, nombre: nomP(p.id) })); }
          // 3) ¿Ha venido ya el recomendado? (primera sesión realizada)
          const nuevos = [...new Set(rs.map(r => (r.fields['PACIENTE'] || [])[0]).filter(Boolean))], prim = {};
          for (let i = 0; i < nuevos.length; i += 15) { const lote = nuevos.slice(i, i + 15);
            (await todosT(CIT, `filterByFormula=${encodeURIComponent(`AND(TRIM({ESTADO})='REALIZADA',OR(${lote.map(id => `FIND('${id}',ARRAYJOIN({PacienteRec}))`).join(',')}))`)}&fields[]=FECHA&fields[]=PacienteRec`).catch(() => [])).forEach(c => { const f = String(c.fields['FECHA'] || '').slice(0, 10); (c.fields['PacienteRec'] || []).forEach(id => { if (lote.includes(id) && (!prim[id] || f < prim[id])) prim[id] = f; }); }); }
          const porDar = rs.filter(r => prim[(r.fields['PACIENTE'] || [])[0]]).map(r => { const F = r.fields, nid = F['PACIENTE'][0], rid = (F['RECOMENDÓ'] || [])[0] || '';
            const rp = rid ? tokP.find(p => p.id === rid) : null;
            return { id: r.id, nuevo: { id: nid, nombre: nomP(nid) }, primera: prim[nid], texto: String(F['Nombre de quien recomendó'] || '').trim(), recomendo: rid ? { id: rid, nombre: nomP(rid), tel: rp ? rp.tel : '' } : null, sugeridos: sug[r.id] || [] }; });
          return res.status(200).json({ ok: true, porDar });
        }
        if (action === 'seg-referidos-resueltos') {
          // Las ya resueltas (tarjeta enviada o canjeada, «no toca», negocio) de los últimos 4 meses, para poder deshacerlas
          const desde = new Date(Date.now() - 120 * 864e5).toISOString().slice(0, 10);
          const rs = await todosT(REF, `filterByFormula=${encodeURIComponent(`AND({Nombre de quien recomendó}!='',OR({IGNORAR},{CÓDIGO}!='',{Regalo entregado}),IS_AFTER({Fecha},'${desde}'))`)}`);
          const ids = [...new Set(rs.flatMap(r => [...(r.fields['PACIENTE'] || []), ...(r.fields['RECOMENDÓ'] || [])]))], nom = {};
          for (let i = 0; i < ids.length; i += 40) (await todosT(PACIENTES, `filterByFormula=${encodeURIComponent('OR(' + ids.slice(i, i + 40).map(x => `RECORD_ID()='${x}'`).join(',') + ')')}&fields[]=FULL NAME`).catch(() => [])).forEach(p => { nom[p.id] = p.fields['FULL NAME'] || ''; });
          const negs = {}; const nids = [...new Set(rs.flatMap(r => r.fields['NEGOCIO'] || []))];
          if (nids.length) (await todosT('tblO5y1Ikg3LIalic', `filterByFormula=${encodeURIComponent('OR(' + nids.map(x => `RECORD_ID()='${x}'`).join(',') + ')')}&fields[]=NOMBRE`).catch(() => [])).forEach(n => { negs[n.id] = n.fields['NOMBRE'] || ''; });
          const out = rs.map(r => { const F = r.fields, rid = (F['RECOMENDÓ'] || [])[0], nid = (F['NEGOCIO'] || [])[0];
            const estado = F['CANJEADA'] ? 'Tarjeta canjeada el ' + String(F['CANJEADA']).split('-').reverse().join('/') : F['CÓDIGO'] ? 'Tarjeta enviada el ' + String(F['FECHA TARJETA'] || '').split('-').reverse().join('/') : nid ? 'Negocio: ' + (negs[nid] || '') + ' · gracias enviadas' : 'Marcado «no toca tarjeta»';
            return { id: r.id, quien: rid ? nom[rid] : (nid ? negs[nid] : String(F['Nombre de quien recomendó'] || '').trim()), nuevo: nom[(F['PACIENTE'] || [])[0]] || `${F['Nombre'] || ''} ${F['Apellidos'] || ''}`.trim(), estado, canjeada: !!F['CANJEADA'], fecha: F['FECHA TARJETA'] || F['Fecha'] || '' }; }).sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
          return res.status(200).json({ ok: true, resueltas: out });
        }
        if (req.method !== 'POST' || !okId(q.id)) return res.status(400).json({ ok: false });
        if (action === 'seg-referido-deshacer') {
          // solo canje: vuelve a estar sin usar; todo: vuelve a Tareas como si no se hubiera hecho nada (se mantiene quién recomendó)
          const f = q.soloCanje ? { CANJEADA: null } : { IGNORAR: false, NEGOCIO: [], 'CÓDIGO': '', 'FECHA TARJETA': null, CADUCA: null, CANJEADA: null, 'TARJETA IMG': [], 'Regalo entregado': false };
          const d = await at(`${REF}/${q.id}`, { method: 'PATCH', body: JSON.stringify({ fields: f }) }); return res.status(200).json({ ok: !d.error });
        }
        if (action === 'seg-referido-recomendo') { if (!okId(q.pacienteId)) return res.status(400).json({ ok: false });
          const d = await at(`${REF}/${q.id}`, { method: 'PATCH', body: JSON.stringify({ fields: { 'RECOMENDÓ': [q.pacienteId] } }) }); return res.status(200).json({ ok: !d.error }); }
        if (action === 'seg-referido-ignorar') { const d = await at(`${REF}/${q.id}`, { method: 'PATCH', body: JSON.stringify({ fields: { IGNORAR: true } }) }); return res.status(200).json({ ok: !d.error }); }
        if (action === 'seg-referido-tarjeta') {
          const r0 = await at(`${REF}/${q.id}`); if (r0.error) return res.status(404).json({ ok: false });
          let cod = r0.fields['CÓDIGO'], cad = r0.fields['CADUCA'];
          if (!cod) { const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; cod = 'F365-' + Array.from({ length: 4 }, () => A[Math.floor(Math.random() * A.length)]).join('');
            const c = new Date(hoyF + 'T12:00:00Z'); c.setUTCMonth(c.getUTCMonth() + 6); cad = c.toISOString().slice(0, 10);
            const d = await at(`${REF}/${q.id}`, { method: 'PATCH', body: JSON.stringify({ fields: { 'CÓDIGO': cod, 'FECHA TARJETA': hoyF, CADUCA: cad, 'Regalo entregado': true } }) }); if (d.error) return res.status(200).json({ ok: false }); }
          return res.status(200).json({ ok: true, codigo: cod, caduca: cad });
        }
        if (action === 'seg-referido-negocio') {
          // Nos recomendó un negocio o profesional: se apunta en NEGOCIOS DEL BARRIO (o se usa el que ya está) y no toca tarjeta
          const NEG = 'tblO5y1Ikg3LIalic', nombre = String(q.nombre || '').trim().slice(0, 100), tel = String(q.tel || '').trim().slice(0, 30); if (!nombre) return res.status(400).json({ ok: false });
          const ya = (await todosT(NEG, `filterByFormula=${encodeURIComponent(`LOWER(TRIM({NOMBRE}))='${cEsc(nombre.toLowerCase())}'`)}&fields[]=NOMBRE&fields[]=TELF&fields[]=HISTORIAL`).catch(() => []))[0];
          const linea = `${hoyF.split('-').reverse().join('/')}: nos ha recomendado a un paciente nuevo · gracias enviadas${q.regalo && q.regalo !== 'Gracias' ? ' · regalo: ' + String(q.regalo).slice(0, 40) : ''}`;
          let negId = ya && ya.id;
          const diez = /^10/.test(String(q.regalo || ''));
          if (ya) { const f = { HISTORIAL: [String(ya.fields['HISTORIAL'] || '').trim(), linea].filter(Boolean).join('\n') }; if (tel && !ya.fields['TELF']) f.TELF = tel; if (diez) f['10% A SUS CLIENTES'] = true; await at(`${NEG}/${ya.id}`, { method: 'PATCH', body: JSON.stringify({ fields: f, typecast: true }) }); }
          else { const c = await at(NEG, { method: 'POST', body: JSON.stringify({ records: [{ fields: { NOMBRE: nombre, ...(tel ? { TELF: tel } : {}), ...(diez ? { '10% A SUS CLIENTES': true } : {}), HISTORIAL: linea, FECHA: hoyF } }], typecast: true }) }); if (c.error) return res.status(200).json({ ok: false }); negId = c.records[0].id; }
          const d = await at(`${REF}/${q.id}`, { method: 'PATCH', body: JSON.stringify({ fields: { NEGOCIO: [negId], IGNORAR: true } }) });
          return res.status(200).json({ ok: !d.error, tel: tel || (ya && ya.fields['TELF']) || '' });
        }
        if (action === 'seg-referido-img') {
          const b64 = String(q.b64 || ''); if (!b64 || b64.length > 3e6) return res.status(400).json({ ok: false });
          await at(`${REF}/${q.id}`, { method: 'PATCH', body: JSON.stringify({ fields: { 'TARJETA IMG': [] } }) });
          const up = await fetch(`https://content.airtable.com/v0/${BASE_ID}/${q.id}/fldsXb167H8HWe37u/uploadAttachment`, { method: 'POST', headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ contentType: 'image/jpeg', file: b64, filename: 'tarjeta-regalo.jpg' }) }).then(x => x.json()).catch(() => ({ error: 1 }));
          return res.status(200).json({ ok: !up.error, url: `https://app.fisioterapia365.com/tarjeta/${q.id}` });
        }
        if (action === 'seg-referido-canjear') {
          const r0 = await at(`${REF}/${q.id}`); if (r0.error) return res.status(404).json({ ok: false });
          const f = { CANJEADA: q.deshacer ? null : hoyF };
          if (!q.deshacer && !r0.fields['CÓDIGO']) { const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; f['CÓDIGO'] = 'F365-' + Array.from({ length: 4 }, () => A[Math.floor(Math.random() * A.length)]).join(''); const c = new Date(hoyF + 'T12:00:00Z'); c.setUTCMonth(c.getUTCMonth() + 6); f.CADUCA = c.toISOString().slice(0, 10); f['FECHA TARJETA'] = hoyF; f['Regalo entregado'] = true; }
          const d = await at(`${REF}/${q.id}`, { method: 'PATCH', body: JSON.stringify({ fields: f }) }); return res.status(200).json({ ok: !d.error }); }
        return res.status(400).json({ ok: false });
      }
      if (action === 'seg-app-pendientes') {
        // Pacientes con sesión en los últimos 30 días que no han abierto la app, o que no tienen plan de ejercicios
        const ses = await todosT(CIT, `filterByFormula=${encodeURIComponent(`AND(TRIM({ESTADO})='REALIZADA',IS_AFTER({FECHA},DATEADD(TODAY(),-31,'days')),NOT(IS_AFTER({FECHA},TODAY())))`)}&fields[]=FECHA&fields[]=RELACIÓN - CITA&fields[]=PREF.`);
        const ult = {}; ses.forEach(c => { const pid = (c.fields['RELACIÓN - CITA'] || [])[0]; if (!pid) return; const f = String(c.fields['FECHA'] || '').slice(0, 10); if (!ult[pid] || f > ult[pid].fecha) ult[pid] = { fecha: f, fisio: cNm(c.fields['PREF.']) }; });
        const pids = Object.keys(ult), info = {};
        for (let i = 0; i < pids.length; i += 40) (await todosT(PACIENTES, `filterByFormula=${encodeURIComponent('OR(' + pids.slice(i, i + 40).map(id => `RECORD_ID()='${id}'`).join(',') + ')')}&fields[]=FULL NAME&fields[]=WHATSAPP&fields[]=TELF&fields[]=EMAIL&fields[]=PIN&fields[]=ÚLTIMO ACCESO APP&fields[]=PushSubscription&fields[]=SIN AVISO APP`)).forEach(p => { info[p.id] = p.fields; });
        const [planes, dolor] = await Promise.all([
          todosT('tblvgE0a4gsrj4Vhp', `filterByFormula=${encodeURIComponent("LEN({Ejercicios}&'')>2")}&fields[]=PacienteID`).catch(() => []),
          todosT('tblxJmnb7LHML2ZZh', 'fields[]=PacienteID').catch(() => [])]);
        const conPlan = new Set(planes.map(r => r.fields['PacienteID'])), usaApp = new Set(dolor.map(r => r.fields['PacienteID']));
        const sinApp = [], sinPlan = [];
        pids.forEach(id => { const P = info[id]; if (!P || P['SIN AVISO APP']) return;
          const x = { pacienteId: id, nombre: P['FULL NAME'] || '', tel: P['WHATSAPP'] || P['TELF'] || '', email: P['EMAIL'] || '', pin: P['PIN'] || '', ultima: ult[id].fecha, fisio: ult[id].fisio };
          if (!conPlan.has(id)) sinPlan.push(x);
          else if (!P['ÚLTIMO ACCESO APP'] && !P['PushSubscription'] && !usaApp.has(id) && !x.pin) { x.pin = nuevoPin(); x.pinNuevo = true; }
          else if (!P['ÚLTIMO ACCESO APP'] && !P['PushSubscription'] && !usaApp.has(id)) sinApp.push(x); });
        for (const x of sinApp.filter(x => x.pinNuevo).slice(0, 20)) await at(`${PACIENTES}/${x.pacienteId}`, { method: 'PATCH', body: JSON.stringify({ fields: { PIN: x.pin } }) }).catch(() => {});
        return res.status(200).json({ ok: true, sinApp, sinPlan });
      }
      if (action === 'seg-app-ignorar' && req.method === 'POST') {
        if (!/^rec[A-Za-z0-9]{14}$/.test(q.pacienteId || '')) return res.status(400).json({ ok: false });
        const d = await at(`${PACIENTES}/${q.pacienteId}`, { method: 'PATCH', body: JSON.stringify({ fields: { 'SIN AVISO APP': true } }) });
        return res.status(200).json({ ok: !d.error });
      }
      if (action === 'seg-consent-pendientes') {
        // 1) Consentimientos de los últimos 4 meses sin paciente: se enlazan solos si cuadra; si no, a Pendientes
        // 2) Pacientes con sesión realizada en los últimos 30 días sin consentimiento enlazado
        const lista = await consTodos(true); // siempre fresco: los enlaces se pueden haber hecho desde otro móvil
        const desde = new Date(Date.now() - 120 * 864e5).toISOString().slice(0, 10);
        const ses = await todosT(CIT, `filterByFormula=${encodeURIComponent(`AND(TRIM({ESTADO})='REALIZADA',IS_AFTER({FECHA},DATEADD(TODAY(),-31,'days')),NOT(IS_AFTER({FECHA},TODAY())))`)}&fields[]=FECHA&fields[]=RELACIÓN - CITA&fields[]=PREF.`);
        const ult = {}; ses.forEach(c => { const pid = (c.fields['RELACIÓN - CITA'] || [])[0]; if (!pid) return; const f = String(c.fields['FECHA'] || '').slice(0, 10); if (!ult[pid] || f < ult[pid].primera) ult[pid] = { primera: f, fisio: cNm(c.fields['PREF.']) }; });
        const enl = new Set(lista.flatMap(c => c.pac));
        const pidsSin = Object.keys(ult).filter(id => !enl.has(id)), info = {};
        for (let i = 0; i < pidsSin.length; i += 40) (await todosT(PACIENTES, `filterByFormula=${encodeURIComponent('OR(' + pidsSin.slice(i, i + 40).map(id => `RECORD_ID()='${id}'`).join(',') + ')')}&fields[]=FULL NAME&fields[]=EMAIL&fields[]=DNI&fields[]=TELF&fields[]=WHATSAPP&fields[]=FECHA&fields[]=SIN AVISO CONSENTIMIENTO`)).forEach(p => { info[p.id] = { ...p.fields, FECHA: p.fields['FECHA'] || p.createdTime }; });
        const sinCons = [], dudosos = {}; let enlazados = 0;
        const FORM_INICIO = '2026-01-08'; // los pacientes de antes firmaron en papel: salen aparte para subir el papel
        for (const id of pidsSin) { const P = info[id]; if (!P || P['SIN AVISO CONSENTIMIENTO']) continue; const antiguo = String(P['FECHA'] || '').slice(0, 10) < FORM_INICIO; const m = emparejar(P, id, lista, P['FECHA']); let ok = false;
          for (const c of m.buenos.slice(0, 4)) if (enlazados < 60 && await enlazarCons(c.id, id).catch(() => false)) { enlazados++; ok = true; }
          if (ok) continue;
          const dd = m.dudosos[0]; if (dd) dudosos[dd.id] = [...(dudosos[dd.id] || []), { id, nombre: P['FULL NAME'] || '' }];
          sinCons.push({ pacienteId: id, antiguo, nombre: P['FULL NAME'] || '', tel: P['WHATSAPP'] || P['TELF'] || '', primera: ult[id].primera, fisio: ult[id].fisio, sugerido: dd ? { id: dd.id, nombre: dd.nombre, fecha: dd.fecha } : null }); }
        // Formularios recientes sin paciente: se buscan por email/DNI/teléfono en PACIENTES y se enlazan si el nombre cuadra
        const sueltos = lista.filter(c => !c.pac.length && !c.ignorar && c.fecha >= desde && !dudosos[c.id]);
        const conds = []; sueltos.forEach(c => { if (c.email) conds.push(`LOWER(TRIM({EMAIL}))='${cEsc(c.email)}'`); if (c.dni.length >= 6) conds.push(`SUBSTITUTE(LOWER(TRIM({DNI})),' ','')='${cEsc(c.dni)}'`); c.tels.forEach(t => conds.push(`RIGHT(REGEX_REPLACE({TELF}&'','[^0-9]',''),9)='${t}'`, `RIGHT(REGEX_REPLACE({WHATSAPP}&'','[^0-9]',''),9)='${t}'`)); });
        const pc = []; for (let i = 0; i < conds.length; i += 40) pc.push(...await todosT(PACIENTES, `filterByFormula=${encodeURIComponent('OR(' + conds.slice(i, i + 40).join(',') + ')')}&fields[]=FULL NAME&fields[]=EMAIL&fields[]=DNI&fields[]=TELF&fields[]=WHATSAPP`).catch(() => []));
        for (const c of sueltos) {
          const ps = pc.filter(p => !(c.noDe || []).includes(p.id)).filter(p => { const F = p.fields, ts = [cDig(F['TELF']), cDig(F['WHATSAPP'])]; return (c.email && cTxt(F['EMAIL']) === c.email) || (c.dni.length >= 6 && cTxt(F['DNI']).replace(/\s/g, '') === c.dni) || c.tels.some(t => ts.includes(t)); });
          const bueno = ps.find(p => nombresCuadran(c.nombre, p.fields['FULL NAME'])) || (ps.length === 1 && c.fecha >= new Date(new Date(ps[0].createdTime).getTime() - 3 * 864e5).toISOString().slice(0, 10) ? ps[0] : null);
          if (bueno && enlazados < 100) { if (await enlazarCons(c.id, bueno.id).catch(() => false)) { enlazados++; enl.add(bueno.id); continue; } }
          if (ps.length) dudosos[c.id] = ps.slice(0, 5).map(p => ({ id: p.id, nombre: p.fields['FULL NAME'] || '' }));
        }
        // Antiguos: fecha de su primera visita (primera sesión realizada) para buscar el papel rápido
        const ants = sinCons.filter(x => x.antiguo).map(x => x.pacienteId), prim1 = {};
        for (let i = 0; i < ants.length; i += 15) {
          const lote = ants.slice(i, i + 15);
          const rs = await todosT(CIT, `filterByFormula=${encodeURIComponent(`AND(TRIM({ESTADO})='REALIZADA',OR(${lote.map(id => `FIND('${id}',ARRAYJOIN({PacienteRec}))`).join(',')}))`)}&fields[]=FECHA&fields[]=PacienteRec`).catch(() => []);
          rs.forEach(c => { const f = String(c.fields['FECHA'] || '').slice(0, 10); (c.fields['PacienteRec'] || []).forEach(id => { if (lote.includes(id) && f && (!prim1[id] || f < prim1[id])) prim1[id] = f; }); });
        }
        sinCons.forEach(x => { if (x.antiguo) x.primeraVisita = prim1[x.pacienteId] || String(info[x.pacienteId] && info[x.pacienteId]['FECHA'] || '').slice(0, 10); });
        // Copias sueltas de formularios ya enlazados: se enlazan al mismo paciente
        for (const c of lista.filter(c => !c.pac.length).slice(0, 2000)) { const tw = lista.find(o => o.pac.length && mismoForm(o, c)); if (tw && enlazados < 120 && await enlazarCons(c.id, tw.pac[0]).catch(() => false)) enlazados++; }
        const huerfanos = lista.filter(c => !c.pac.length && !c.ignorar && c.fecha >= desde && !lista.some(o => o.pac.length && mismoForm(o, c))).map(c => ({ id: c.id, tipo: c.tipo, nombre: c.nombre, fecha: c.fecha, tel: c.tel, telRes: c.telRes, email: c.email, sugeridos: dudosos[c.id] || [], sugerido: (dudosos[c.id] || [])[0] || null }));
        // Formularios enlazados a más de un paciente, o enlazados a alguien con otro nombre (últimos 4 meses)
        const dobles = lista.filter(c => c.pac.length > 1 && !c.ignorar), raros0 = lista.filter(c => c.pac.length === 1 && !c.ignorar && !c.papel && c.fecha >= desde);
        const idsN = [...new Set([...dobles.flatMap(c => c.pac), ...raros0.map(c => c.pac[0])])], nomP = {};
        for (let i = 0; i < idsN.length; i += 40) (await todosT(PACIENTES, `filterByFormula=${encodeURIComponent('OR(' + idsN.slice(i, i + 40).map(id => `RECORD_ID()='${id}'`).join(',') + ')')}&fields[]=FULL NAME`).catch(() => [])).forEach(p => { nomP[p.id] = p.fields['FULL NAME'] || ''; });
        const revisar = [
          ...dobles.map(c => ({ id: c.id, tipo: c.tipo, fecha: c.fecha, nombre: c.nombre, motivo: 'doble', pacientes: c.pac.map(id => ({ id, nombre: nomP[id] || '—' })) })),
          ...raros0.filter(c => nomP[c.pac[0]] && !nombresCuadran(c.nombre, nomP[c.pac[0]])).map(c => ({ id: c.id, tipo: c.tipo, fecha: c.fecha, nombre: c.nombre, motivo: 'nombre', pacientes: [{ id: c.pac[0], nombre: nomP[c.pac[0]] }] }))];
        return res.status(200).json({ ok: true, hoy: hoyF, enlazados, sinCons, huerfanos, revisar });
      }
      if (action === 'seg-consent-doc') {
        if (!/^rec[A-Za-z0-9]{14}$/.test(q.id || '')) return res.status(400).json({ ok: false });
        const d = await datosConsent(q.id); if (!d) return res.status(404).json({ ok: false });
        delete d.pac; return res.status(200).json(d);
      }
      if (action === 'seg-consent-email') {
        if (req.method !== 'POST') return res.status(405).json({ ok: false });
        const to = String(q.to || '').trim(), pdf = String(q.pdf || '');
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to) || !pdf || pdf.length > 4e6) return res.status(400).json({ ok: false, error: 'Falta el email o el PDF' });
        const nom = String(q.nombre || '').split(' ')[0];
        const html = `<div style="font-family:Arial,sans-serif;font-size:15px;color:#1a1a1a">Hola${nom ? ' ' + escHtml(nom) : ''},<br><br>Te adjuntamos una copia de ${escHtml(String(q.titulo || 'tu consentimiento informado'))} de FISIO365.<br><br>Cualquier duda, estamos en el 672 89 39 49.<br><br>Un abrazo,<br>Equipo FISIO365</div>`;
        const r = await fetch('https://api.brevo.com/v3/smtp/email', { method: 'POST', headers: { 'api-key': process.env.BREVO_API_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({ sender: { name: 'FISIO365', email: 'info@fisioterapia365.com' }, to: [{ email: to }], subject: 'Tu consentimiento · FISIO365', htmlContent: html, attachment: [{ content: pdf, name: String(q.archivo || 'Consentimiento_FISIO365.pdf').replace(/[^\w.\-áéíóúñÁÉÍÓÚÑ]/g, '_') }] }) });
        return res.status(200).json({ ok: r.ok, error: r.ok ? '' : 'No se ha podido enviar (' + r.status + ')' });
      }
      if (action === 'seg-consent-ignorar') {
        // Quitar un aviso de Pendientes sin hacer nada (pruebas, etc.)
        if (req.method !== 'POST') return res.status(405).json({ ok: false });
        if (/^rec[A-Za-z0-9]{14}$/.test(q.pacienteId || '')) { const d = await at(`${PACIENTES}/${q.pacienteId}`, { method: 'PATCH', body: JSON.stringify({ fields: { 'SIN AVISO CONSENTIMIENTO': true } }) }); return res.status(200).json({ ok: !d.error }); }
        if (!/^rec[A-Za-z0-9]{14}$/.test(q.consentId || '')) return res.status(400).json({ ok: false });
        const c0 = (_cons.v || []).find(x => x.id === q.consentId);
        let d = await at(`${c0 ? c0.tabla : CONS_T}/${q.consentId}`, { method: 'PATCH', body: JSON.stringify({ fields: { IGNORAR: true } }) });
        if (d.error && !c0) d = await at(`${CONS_O}/${q.consentId}`, { method: 'PATCH', body: JSON.stringify({ fields: { IGNORAR: true } }) });
        if (c0) c0.ignorar = true; return res.status(200).json({ ok: !d.error });
      }
      if (action === 'seg-consent-papel') {
        // Consentimiento firmado en papel: se crea en OTROS CONSENTIMIENTOS con la foto o el PDF
        if (req.method !== 'POST' || !/^rec[A-Za-z0-9]{14}$/.test(q.pacienteId || '') || !q.file) return res.status(400).json({ ok: false, error: 'Falta el archivo' });
        const tipo = ['Primera visita', 'Suelo pélvico', 'Alta oncológica'].includes(q.tipo) ? q.tipo : 'Primera visita';
        const pac = await at(`${PACIENTES}/${q.pacienteId}`); if (pac.error) return res.status(404).json({ ok: false, error: 'Paciente no encontrado' });
        const f = { TIPO: tipo, FECHA: /^\d{4}-\d{2}-\d{2}$/.test(q.fecha || '') ? q.fecha : hoyF, PACIENTE: [q.pacienteId], PAPEL: true, NOMBRE: pac.fields['FULL NAME'] || '', 'FORM ID': 'papel', TELF: String(pac.fields['TELF'] || pac.fields['WHATSAPP'] || '') };
        if (tipo === 'Alta oncológica') f['CÁNCER'] = 'Alta'; if (tipo === 'Suelo pélvico') f['ACEPTACIÓN S.P.'] = true;
        const cr = await at(CONS_O, { method: 'POST', body: JSON.stringify({ records: [{ fields: f }], typecast: true }) });
        const rid = cr.records && cr.records[0] && cr.records[0].id; if (!rid) return res.status(200).json({ ok: false, error: (cr.error && (cr.error.message || cr.error.type)) || 'No se ha podido guardar' });
        const up = await fetch(`https://content.airtable.com/v0/${BASE_ID}/${rid}/fldzmytX5WC15qRaR/uploadAttachment`, { method: 'POST', headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ contentType: String(q.tipoArchivo || 'image/jpeg'), file: String(q.file), filename: String(q.nombre || 'consentimiento.jpg').slice(0, 120) }) });
        const ud = await up.json().catch(() => ({}));
        if (!up.ok || ud.error) { await at(`${CONS_O}/${rid}`, { method: 'DELETE' }).catch(() => {}); return res.status(200).json({ ok: false, error: 'No se ha podido subir el archivo' }); }
        _cons.t = 0; _alertas.t = 0; return res.status(200).json({ ok: true, id: rid });
      }
      if (action === 'seg-consent-archivo') {
        // El archivo de un consentimiento en papel (para verlo, compartirlo o mandarlo por email)
        if (!/^rec[A-Za-z0-9]{14}$/.test(q.id || '')) return res.status(400).json({ ok: false });
        const r = await at(`${CONS_O}/${q.id}`); const a = r.fields && (r.fields['ARCHIVO'] || [])[0]; if (!a) return res.status(404).json({ ok: false, error: 'Sin archivo' });
        const im = await fetch(a.url); if (!im.ok) return res.status(200).json({ ok: false, error: 'No se ha podido abrir el archivo' });
        return res.status(200).json({ ok: true, nombre: a.filename || 'consentimiento', tipo: a.type || im.headers.get('content-type') || 'application/octet-stream', b64: Buffer.from(await im.arrayBuffer()).toString('base64') });
      }
      if (action === 'seg-consent-noes') {
        // «No es suyo»: se desenlaza (si lo estaba) y no se vuelve a enlazar ni a preguntar para ese paciente
        if (req.method !== 'POST' || !/^rec[A-Za-z0-9]{14}$/.test(q.consentId || '') || !/^rec[A-Za-z0-9]{14}$/.test(q.pacienteId || '')) return res.status(400).json({ ok: false });
        const lista = await consTodos(); const c0 = lista.find(x => x.id === q.consentId); if (!c0) return res.status(404).json({ ok: false });
        const todos = [c0, ...lista.filter(x => mismoForm(x, c0))].slice(0, 6); let ok = true;
        for (const c of todos) { const noDe = [...new Set([...(c.noDe || []), q.pacienteId])]; const f = { 'NO ES DE': noDe.join(',') }; if (c.pac.includes(q.pacienteId)) f.PACIENTE = c.pac.filter(x => x !== q.pacienteId);
          const r = await at(`${c.tabla}/${c.id}`, { method: 'PATCH', body: JSON.stringify({ fields: f }) }); if (r.error) ok = false; else { c.noDe = noDe; if (f.PACIENTE) c.pac = f.PACIENTE; } }
        _alertas.t = 0; return res.status(200).json({ ok });
      }
      if (action === 'seg-consent-enlazar') {
        if (req.method !== 'POST' || !/^rec[A-Za-z0-9]{14}$/.test(q.consentId || '') || (q.pacienteId && !/^rec[A-Za-z0-9]{14}$/.test(q.pacienteId))) return res.status(400).json({ ok: false });
        return res.status(200).json({ ok: await enlazarCons(q.consentId, q.pacienteId || '') });
      }
      // ── CAPTACIÓN ──
      if (action.startsWith('seg-cap')) {
        const okId = x => /^rec[A-Za-z0-9]{14}$/.test(x || ''), okF = f => /^\d{4}-\d{2}-\d{2}$/.test(f || '');
        if (action === 'seg-cap') {
          const desde = new Date(Date.now() - 180 * 864e5).toISOString().slice(0, 10);
          const [con, esp, neg, ref] = await Promise.all([
            capTodos(CAP.contacto, `filterByFormula=${encodeURIComponent(`IS_AFTER({FECHA},'${desde}')`)}&sort[0][field]=FECHA&sort[0][direction]=desc`),
            esperaLista(true),
            capTodos(CAP.negocio, 'sort[0][field]=NOMBRE&sort[0][direction]=asc'),
            capTodos(CAP.referidos, `filterByFormula=${encodeURIComponent("{Nombre de quien recomendó}!=''")}&fields[]=Nombre de quien recomendó&fields[]=Nombre&fields[]=Apellidos&fields[]=Fecha`).catch(() => [])
          ]);
          const negocios = neg.map(r => { const F = r.fields, toks = capNorm(F['NOMBRE']).split(/[^a-z0-9]+/).filter(w => w.length >= 4 && !CAP_STOP.test(w));
            const vienen = toks.length ? ref.filter(x => { const t = capNorm(x.fields['Nombre de quien recomendó']); return toks.some(w => t.includes(w)); }).map(x => ({ nombre: [x.fields['Nombre'], x.fields['Apellidos']].filter(Boolean).join(' ').trim(), fecha: x.fields['Fecha'] || '' })) : [];
            return { id: r.id, nombre: F['NOMBRE'] || '', tipo: cNm(F['TIPO NEGOCIO']), estado: cNm(F['ESTADO']) || 'PENDIENTE', fecha: F['FECHA'] || '', flyers: !!F['FLAYERS ENTREGADOS'], notas: F['NOTAS'] || '', direccion: F['DIRECCIÓN'] || '', contacto: F['CONTACTO'] || '', tel: F['TELF'] || '', proxima: F['PRÓXIMA VISITA'] || '', historial: F['HISTORIAL'] || '', vienen }; });
          return res.status(200).json({ ok: true, hoy: hoyF,
            contactos: con.map(r => { const F = r.fields; return { id: r.id, fecha: F['FECHA'] || r.createdTime, nombre: F['NOMBRE'] || '', medio: cNm(F['MEDIO']), mensaje: F['MENSAJE'] || '', citado: cNm(F['CITADO']), motivo: F['MOTIVO'] || '', motivoTipo: cNm(F['MOTIVO TIPO']), tel: F['TELF'] || '', por: F['REGISTRADO POR'] || '' }; }),
            espera: esp, negocios });
        }
        if (req.method !== 'POST') return res.status(405).json({ ok: false });
        const T = { contacto: CAP.contacto, esperaP: CAP.esperaP, esperaN: CAP.esperaN, negocio: CAP.negocio }[q.tabla];
        if (!T) return res.status(400).json({ ok: false, error: 'Tabla' });
        if (action === 'seg-cap-borrar') { if (!okId(q.id)) return res.status(400).json({ ok: false }); const d = await at(`${T}/${q.id}`, { method: 'DELETE' }); if (T !== CAP.contacto && T !== CAP.negocio) _espera.t = 0; return res.status(200).json({ ok: !d.error }); }
        if (action === 'seg-cap-guardar') {
          const c = q.campos || {}, f = {}, txt = (k, v, n = 2000) => { if (v !== undefined) f[k] = String(v || '').slice(0, n); };
          const lista = v => Array.isArray(v) ? v.map(String).slice(0, 7) : [];
          if (q.tabla === 'contacto') {
            if (c.fecha !== undefined) f['FECHA'] = c.fecha || new Date().toISOString();
            txt('NOMBRE', c.nombre, 120); txt('MENSAJE', c.mensaje); txt('MOTIVO', c.motivo); txt('REGISTRADO POR', c.por, 60);
            if (c.medio !== undefined) f['MEDIO'] = c.medio || null; if (c.citado !== undefined) f['CITADO'] = c.citado || null; if (c.motivoTipo !== undefined) f['MOTIVO TIPO'] = c.motivoTipo || null;
            if (c.tel !== undefined) f['TELF'] = String(c.tel || '').slice(0, 30);
            if (!q.id && !f['FECHA']) f['FECHA'] = new Date().toISOString();
          } else if (q.tabla === 'negocio') {
            txt('NOMBRE', c.nombre, 120); txt('NOTAS', c.notas); txt('DIRECCIÓN', c.direccion, 200); txt('CONTACTO', c.contacto, 120); txt('HISTORIAL', c.historial, 20000);
            if (c.tel !== undefined) f['TELF'] = String(c.tel || '').slice(0, 30);
            if (c.tipo !== undefined) f['TIPO NEGOCIO'] = c.tipo || null; if (c.estado !== undefined) f['ESTADO'] = c.estado || null;
            if (c.fecha !== undefined) f['FECHA'] = okF(c.fecha) ? c.fecha : null; if (c.proxima !== undefined) f['PRÓXIMA VISITA'] = okF(c.proxima) ? c.proxima : null;
            if (c.flyers !== undefined) f['FLAYERS ENTREGADOS'] = !!c.flyers;
          } else {
            if (c.fecha !== undefined || !q.id) f['FECHA SOLICITUD'] = okF(c.fecha) ? c.fecha : hoyF;
            txt('NOTAS', c.nota); txt('DISPONIBILIDAD', c.disp, 500); txt('FISIO', c.fisio, 40);
            if (c.dias !== undefined) f['DIAS'] = lista(c.dias); if (c.franja !== undefined) f['FRANJA'] = lista(c.franja); if (c.estado !== undefined) f['ESTADO'] = c.estado || null;
            if (q.tabla === 'esperaP') { if (c.pacienteId !== undefined) f['PACIENTE'] = okId(c.pacienteId) ? [c.pacienteId] : []; }
            else { txt('NOMBRE', c.nombre, 120); if (c.tel !== undefined) f['TELF'] = String(c.tel || '').slice(0, 30); }
            _espera.t = 0;
          }
          const d = okId(q.id) ? await at(`${T}/${q.id}`, { method: 'PATCH', body: JSON.stringify({ fields: f, typecast: true }) }) : await at(T, { method: 'POST', body: JSON.stringify({ records: [{ fields: f }], typecast: true }) });
          return res.status(200).json({ ok: !d.error, error: d.error && (d.error.message || d.error), id: d.id || (d.records && d.records[0] && d.records[0].id) });
        }
        return res.status(400).json({ ok: false });
      }
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
          await Promise.all([procesarWeb().catch(() => {}), revisarPorReagendar().catch(() => 0)]);
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
          const altaP = {};
          const porLotes = async (tabla, ids, campo, dest) => { const lotes = []; for (let i = 0; i < ids.length; i += 50) lotes.push(ids.slice(i, i + 50)); for (let k = 0; k < lotes.length; k += 4) await Promise.all(lotes.slice(k, k + 4).map(async t => { const rs = await todosT(tabla, `filterByFormula=${encodeURIComponent('OR(' + t.map(x => `RECORD_ID()='${x}'`).join(',') + ')')}&fields[]=${encodeURIComponent(campo)}`); rs.forEach(r => { dest[r.id] = r.fields[campo] || ''; if (tabla === PACIENTES) altaP[r.id] = String(r.createdTime || '').slice(0, 10); }); })); };
          const [, , alertas, esperaTodos, consL] = await Promise.all([porLotes(PACIENTES, pids, 'FULL NAME', nomP), porLotes(TIP, tids, 'Name', nomT), alertasSalud().catch(() => ({})), esperaLista().catch(() => []), consTodos().catch(() => null)]);
          const alertasDia = {}; pids.forEach(id => { if (alertas[id]) alertasDia[id] = alertas[id]; });
          // Pacientes sin ningún consentimiento enlazado (de después del formulario digital) para marcarlos en la agenda
          const conCons = new Set((consL || []).flatMap(c => c.pac)), sinConsent = consL ? pids.filter(id => !conCons.has(id) && (altaP[id] || '') >= '2026-01-08') : [];
          return res.status(200).json({ ok: true, hoy: hoyF, limitado, alertas: alertasDia, sinConsent, espera: (esperaTodos || []).filter(e => e.estado === 'ESPERANDO').map(e => ({ id: e.id, tabla: e.tabla, nombre: e.nombre, tel: e.tel, dias: e.dias, franja: e.franja, fisio: e.fisio, disp: e.disp, nota: e.nota, fecha: e.fecha, pacienteId: e.pacienteId })), citas: rows.map(r => { const F = r.fields; const pid = (F['RELACIÓN - CITA'] || [])[0] || ''; return { id: r.id, fecha: String(F['FECHA'] || '').slice(0, 10), hora: hh(F['HORA']), estado: String(nmA(F['ESTADO'])).trim(), fisio: nmA(F['PREF.']), pacienteId: pid, paciente: pid ? (nomP[pid] || '') : '', tipos: (F['TIPO DE CITA'] || []).map(t => nomT[t]).filter(Boolean), notas: F['NOTAS'] || '', confirmada: (F['CONFIR'] || []).some(x => /CONFIRMADA/.test(nmA(x))), app: /APP/.test(nmA(F['RESERVA'])), web: /WEB/.test(nmA(F['RESERVA'])) }; }) });
        }
        if (req.method !== 'POST') return res.status(405).json({ ok: false });
        if (action === 'seg-agenda-dar') { // dar cita en una hora (o en un hueco libre concreto)
          if (!okId(q.pacienteId) || !okF(q.fecha) || !okH(q.hora) || !q.fisio) return res.status(400).json({ ok: false, error: 'Faltan datos' });
          const campos = { ESTADO: 'PENDIENTE ', 'RELACIÓN - CITA': [q.pacienteId] };
          if (q.notas) campos.NOTAS = String(q.notas).slice(0, 2000);
          if (q.tipos && q.tipos.length) campos['TIPO DE CITA'] = await tiposDe(q.tipos);
          const r = await ocupar(q.fecha, q.hora, q.fisio, campos, !!q.forzar);
          if (r.conflicto) return res.status(200).json({ ok: false, conflicto: true, error: `A esa hora ${q.fisio} ya tiene a ${r.con || 'otro paciente'}` });
          const rep = await revisarPorReagendar(true).catch(() => 0);
          return res.status(200).json({ ok: true, id: r.id, reprogramadas: rep });
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
        const semanas = [], usados = new Set();
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
            vin++; const fz = p0.fisio || '—'; fis[fz] = fis[fz] || { vinieron: 0, reagendaron: 0, pac: [] }; fis[fz].vinieron++;
            const sig = porPac[pid].filter(c => c !== p0 && c.f >= p0.f && /PENDIENTE|REALIZADA/.test(c.e));
            if (sig.length) { reag++; fis[fz].reagendaron++; }
            fis[fz].pac.push({ id: pid, f: p0.f, rep: sig.length, prox: (sig.find(c => /PENDIENTE/.test(c.e)) || {}).f || '' }); usados.add(pid);
          });
          const ocup = enS.filter(c => c.pid && EQUIPO.includes(String(c.fisio).toLowerCase()) && /REALIZADA|PENDIENTE/.test(c.e)).length;
          // Capacidad de cada fisio y día = su horario − horas bloqueadas (comida, bloqueos…); si ese día no tiene nada en la agenda, no trabaja.
          // Si ese día tiene más horas abiertas en la agenda que su horario (horas extra), cuentan las de la agenda.
          const pf = {}; EQUIPO.forEach(k => pf[k] = { ses: real.filter(c => String(c.fisio).toLowerCase() === k).length, ocup: enS.filter(c => c.pid && String(c.fisio).toLowerCase() === k && /REALIZADA|PENDIENTE/.test(c.e)).length, cap: 0 });
          // Horas disponibles por día trabajado = su horario de ese día − horas bloqueadas/comida (si abre más horas en la agenda, cuentan esas).
          // Un día sin ninguna cita/hueco vivo (nada, o solo canceladas/reprogramadas: festivos, vacaciones…) no cuenta.
          let cap = 0; for (let d = 0; d < 7; d++) { const f = mv(a, d), dw = new Date(f + 'T12:00:00Z').getUTCDay(); EQUIPO.forEach(k => {
            const filas = C.filter(c => c.f === f && String(c.fisio).toLowerCase() === k);
            if (!filas.some(c => /PENDIENTE|REALIZADA|NO ASIST|PERDIDA|LIBRE|CALL-IN|VIDEOS|DUDOSA|REAGENDAR/i.test(c.e))) return;
            const hBloq = new Set(filas.filter(c => /BLOQUEAD|COMIDA/i.test(c.e)).map(c => c.h)).size;
            const hAbiertas = new Set(filas.filter(c => !/BLOQUEAD|COMIDA/i.test(c.e)).map(c => c.h)).size;
            const cd = Math.max((horario[k] && horario[k][dw] || 0) - hBloq, hAbiertas, 0); cap += cd; pf[k].cap += cd; }); }
          const ll = llam.filter(r => { const x = r.fields.FECHA; if (!x) return false; const d = String(x).includes('T') ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date(x)) : String(x).slice(0, 10); return en(d); });
          const m = man.find(r => String(r.fields.SEMANA || '').slice(0, 10) === a);
          semanas.push({ semana: a, sesiones: real.length, dias, atendidos: atend.length, conBono, noVino: enS.filter(c => /NO ASIST|PERDIDA/.test(c.e)).length, canceladas: enS.filter(c => /CANCELADA/.test(c.e)).length,
            nuevos: nuevos.length, vinieron: vin, reagendaron: reag, porFisio: fis, prod: pf, ocupadas: ocup, capacidad: cap, ocupacion: cap ? Math.round(ocup * 100 / cap) : null,
            recuperadas: ll.filter(r => /RECUPERADA/.test(nmS(r.fields.RESULTADO))).length, resenasPedidas: ll.filter(r => r.fields['RESEÑA']).length,
            ingresos: m && m.fields.INGRESOS != null ? m.fields.INGRESOS : null, resenas: m && m.fields['RESEÑAS GOOGLE'] != null ? m.fields['RESEÑAS GOOGLE'] : null, quejas: m && m.fields.QUEJAS != null ? m.fields.QUEJAS : null, notas: m ? (m.fields.NOTAS || '') : '' });
        }
        const nombres = {}; { const ids = [...usados]; const lt = []; for (let i = 0; i < ids.length; i += 50) lt.push(ids.slice(i, i + 50));
          for (let i = 0; i < lt.length; i += 4) (await Promise.all(lt.slice(i, i + 4).map(t => todosT(PACIENTES, `filterByFormula=${encodeURIComponent('OR(' + t.map(x => `RECORD_ID()='${x}'`).join(',') + ')')}&fields[]=FULL%20NAME`).catch(() => [])))).forEach(rs => rs.forEach(r => nombres[r.id] = r.fields['FULL NAME'] || '')); }
        const data = { ok: true, hoy: hoyF, semanas, nombres };
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
        const [citas, segs, llams, saldo, consent] = await Promise.all([
          todosT(CIT, `filterByFormula=${encodeURIComponent(`FIND('${q.id}',ARRAYJOIN({PacienteRec}))`)}&fields[]=FECHA&fields[]=HORA&fields[]=ESTADO&fields[]=PREF.&fields[]=NOTAS&sort[0][field]=FECHA&sort[0][direction]=desc`).catch(() => []),
          todosT(SEG, `filterByFormula=${encodeURIComponent(`FIND('${q.id}',ARRAYJOIN({PacRec}))`)}&sort[0][field]=FECHA DE LLAMADA&sort[0][direction]=desc`).catch(() => []),
          llIds.length ? todosT(LLA, `filterByFormula=${encodeURIComponent('OR(' + llIds.slice(0, 60).map(id => `RECORD_ID()='${id}'`).join(',') + ')')}&sort[0][field]=FECHA&sort[0][direction]=desc`).catch(() => []) : [],
          saldoPaciente(q.id).catch(() => ({ activo: false })),
          consentDe(F, q.id, pac.createdTime).catch(() => null)
        ]);
        // Sin PIN (p. ej. creado a mano en Airtable): se le pone uno solo para que pueda entrar en la app
        if (!String(F['PIN'] || '').trim()) { const pin = nuevoPin(); const r = await at(`${PACIENTES}/${q.id}`, { method: 'PATCH', body: JSON.stringify({ fields: { PIN: pin } }) }).catch(() => ({ error: 1 })); if (!r.error) F['PIN'] = pin; }
        if (consent && consent.rellenado) { Object.assign(F, consent.rellenado); delete consent.rellenado; }
        const diaMad = x => { const s2 = String(x || ''); if (!s2.includes('T')) return { f: s2.slice(0, 10), h: '' }; const pz = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(s2)).reduce((o, p) => (o[p.type] = p.value, o), {}); return { f: `${pz.year}-${pz.month}-${pz.day}`, h: `${pz.hour === '24' ? '00' : pz.hour}:${pz.minute}` }; };
        // Si ya ha vuelto a reservar, el «No reagenda» se desmarca solo
        if (F['POR QUÉ NO REAGENDA']) {
          const vuelve = citas.some(c => { const f = String(c.fields['FECHA'] || '').slice(0, 10), e = String(nm(c.fields['ESTADO'])).toUpperCase(); return (f > hoyF && !/CANCEL|REPROGRAM|NO ASIST/.test(e)) || (f === hoyF && /PENDIENTE/.test(e)); });
          if (vuelve) { await at(`${PACIENTES}/${q.id}`, { method: 'PATCH', body: JSON.stringify({ fields: { 'POR QUÉ NO REAGENDA': '', 'POR QUÉ FECHA': null, 'POR QUÉ FISIO': '' } }) }).catch(() => {}); F['POR QUÉ NO REAGENDA'] = ''; F['POR QUÉ FECHA'] = ''; F['POR QUÉ FISIO'] = ''; }
        }
        // Recomendaciones: quién le recomendó y a quién ha recomendado (con su tarjeta regalo)
        let referidos = null;
        { const ids = [...(F['VINO RECOMENDADO'] || []), ...(F['HA RECOMENDADO'] || [])];
          if (ids.length) { const rr = await todosT('tblr27u3cvtzfyqI6', `filterByFormula=${encodeURIComponent('OR(' + ids.slice(0, 40).map(i => `RECORD_ID()='${i}'`).join(',') + ')')}`).catch(() => []);
            const otros = [...new Set(rr.flatMap(r => [...(r.fields['PACIENTE'] || []), ...(r.fields['RECOMENDÓ'] || [])]).filter(x => x !== q.id))], nom = {};
            if (otros.length) (await todosT(PACIENTES, `filterByFormula=${encodeURIComponent('OR(' + otros.slice(0, 40).map(i => `RECORD_ID()='${i}'`).join(',') + ')')}&fields[]=FULL NAME`).catch(() => [])).forEach(p => { nom[p.id] = p.fields['FULL NAME'] || ''; });
            const vino = rr.find(r => (r.fields['PACIENTE'] || []).includes(q.id));
            const sinCod = rr.filter(r => (r.fields['RECOMENDÓ'] || []).includes(q.id) && !r.fields['CÓDIGO'] && !r.fields['IGNORAR']).map(r => (r.fields['PACIENTE'] || [])[0]).filter(Boolean), vinieron = new Set();
            if (sinCod.length) (await todosT(CIT, `filterByFormula=${encodeURIComponent(`AND(TRIM({ESTADO})='REALIZADA',OR(${sinCod.slice(0, 15).map(id => `FIND('${id}',ARRAYJOIN({PacienteRec}))`).join(',')}))`)}&fields[]=PacienteRec`).catch(() => [])).forEach(c => (c.fields['PacienteRec'] || []).forEach(id => vinieron.add(id)));
            referidos = { leRecomendo: vino ? { id: (vino.fields['RECOMENDÓ'] || [])[0] || '', nombre: nom[(vino.fields['RECOMENDÓ'] || [])[0]] || String(vino.fields['Nombre de quien recomendó'] || '').trim() } : null,
              haRecomendado: rr.filter(r => (r.fields['RECOMENDÓ'] || []).includes(q.id)).map(r => ({ id: r.id, nombre: nom[(r.fields['PACIENTE'] || [])[0]] || `${r.fields['Nombre'] || ''} ${r.fields['Apellidos'] || ''}`.trim(), fecha: r.fields['Fecha'] || '', codigo: r.fields['CÓDIGO'] || '', caduca: r.fields['CADUCA'] || '', canjeada: r.fields['CANJEADA'] || '', fechaTarjeta: r.fields['FECHA TARJETA'] || '', ignorar: !!r.fields['IGNORAR'], ganada: !r.fields['CÓDIGO'] && !r.fields['IGNORAR'] && vinieron.has((r.fields['PACIENTE'] || [])[0]) })) }; } }
        return res.status(200).json({ ok: true, hoy: hoyF, saldo, consent, referidos,
          paciente: { id: pac.id, pin: F['PIN'] || '', nombre: F['FULL NAME'] || '', tel: F['WHATSAPP'] || F['TELF'] || '', telf: F['TELF'] || '', whatsapp: F['WHATSAPP'] || '', pin: F['PIN'] || '', email: F['EMAIL'] || '', dni: F['DNI'] || '', cumple: F['CUMPLE'] || '', telDescartado: F['TELF FORM DESCARTADO'] || '', foto: (((F['FOTO PERFIL'] || [])[0] || {}).thumbnails || {}).large ? F['FOTO PERFIL'][0].thumbnails.large.url : (((F['FOTO PERFIL'] || [])[0] || {}).url || ''), ultimoAcceso: F['ÚLTIMO ACCESO APP'] || '', appUsada: !!(F['ÚLTIMO ACCESO APP'] || F['PushSubscription']), alta: pac.createdTime || '', estados: F['ESTADO'] || [],
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
        const MAPA = { tel: 'TELF', whatsapp: 'WHATSAPP', email: 'EMAIL', dni: 'DNI', cumple: 'CUMPLE', notas: 'NOTAS', historial: 'HISTORIAL CLÍNICO', nombre: 'FULL NAME', pin: 'PIN', telDescartado: 'TELF FORM DESCARTADO' };
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
        const f = { 'FULL NAME': nombre, TELF: tel, WHATSAPP: tel, PIN: nuevoPin() };
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
      if (action === 'seg-consent-quitar') {
        // Quitar embarazo o cáncer de su consentimiento (cáncer activo → «de alta» → nada)
        if (!/^rec[A-Za-z0-9]{14}$/.test(q.id || '') || !['EMBARAZO', 'CÁNCER'].includes(q.campo)) return res.status(400).json({ ok: false });
        let r = await at(`${CONS_T}/${q.id}`); if (r.error) r = await at(`${CONS_O}/${q.id}`); if (r.error) return res.status(404).json({ ok: false }); const T = (r.fields && (r.fields['TIPO'] || r.fields['FECHA ALTA'] !== undefined || r.fields['Creada'] === undefined && r.fields['FECHA'])) ? CONS_O : CONS_T; // Airtable devuelve el registro aunque la tabla de la URL no sea la suya
        const ahora = cNm(r.fields[q.campo]).trim(), nuevo = q.campo === 'CÁNCER' && /^s[ií]$/i.test(ahora) ? 'Alta' : 'No';
        const d = await at(`${T}/${q.id}`, { method: 'PATCH', body: JSON.stringify({ fields: { [q.campo]: nuevo }, typecast: true }) });
        _alertas.t = 0; _cons.t = 0; return res.status(200).json({ ok: !d.error, valor: nuevo });
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
  // ── App del paciente: sus documentos firmados (consentimientos) ──
  if (action === 'mis-documentos' || action === 'mi-documento') {
    if (!/^rec[A-Za-z0-9]{14}$/.test(patientId || '')) return res.status(400).json({ ok: false, error: 'Falta paciente' });
    try {
      if (action === 'mis-documentos') {
        const lista = await consTodos();
        const docs = lista.filter(c => c.pac.includes(patientId)).sort((a, b) => b.fecha.localeCompare(a.fecha)).map(c => ({ id: c.id, tipo: c.tipo, fecha: c.fecha, papel: c.papel }));
        return res.status(200).json({ ok: true, docs });
      }
      const id = req.query.id; if (!/^rec[A-Za-z0-9]{14}$/.test(id || '')) return res.status(400).json({ ok: false });
      const d = await datosConsent(id); if (!d || !d.pac.includes(patientId)) return res.status(404).json({ ok: false, error: 'No encontrado' });
      if (d.papel) { const r = await at(`${CONS_O}/${id}`); const a = r.fields && (r.fields['ARCHIVO'] || [])[0]; if (!a) return res.status(404).json({ ok: false });
        const im = await fetch(a.url); return res.status(200).json({ ok: true, papel: true, nombre: a.filename || 'consentimiento', tipo: a.type || 'application/octet-stream', b64: Buffer.from(await im.arrayBuffer()).toString('base64') }); }
      delete d.pac; return res.status(200).json(d);
    } catch (e) { return res.status(500).json({ ok: false, error: 'Error' }); }
  }
  // ── App del paciente: su cuenta (foto de perfil, cambiar PIN) y «la ha abierto» ──
  if (action === 'mi-cuenta' || action === 'cambiar-pin' || action === 'subir-foto' || action === 'app-visto' || action === 'mis-regalos') {
    if (!/^rec[A-Za-z0-9]{14}$/.test(patientId || '')) return res.status(400).json({ ok: false, error: 'Falta paciente' });
    const b = req.method === 'POST' ? (req.body || {}) : {};
    try {
      const p = await at(`${PACIENTES}/${patientId}`); if (p.error) return res.status(404).json({ ok: false, error: 'No encontrado' });
      const F = p.fields || {}, foto = (F['FOTO PERFIL'] || [])[0];
      const fotoUrl = foto ? ((foto.thumbnails && foto.thumbnails.large && foto.thumbnails.large.url) || foto.url) : '';
      if (action === 'app-visto') { await at(`${PACIENTES}/${patientId}`, { method: 'PATCH', body: JSON.stringify({ fields: { 'ÚLTIMO ACCESO APP': new Date().toISOString() } }) }).catch(() => {}); return res.status(200).json({ ok: true, foto: fotoUrl }); }
      if (action === 'mi-cuenta') return res.status(200).json({ ok: true, foto: fotoUrl, email: F['EMAIL'] || '' });
      if (action === 'mis-regalos') {
        const ids = (F['HA RECOMENDADO'] || []).slice(0, 40); if (!ids.length) return res.status(200).json({ ok: true, tarjetas: [] });
        const hoy = new Date().toISOString().slice(0, 10);
        const d = await at(`tblr27u3cvtzfyqI6?filterByFormula=${encodeURIComponent('OR(' + ids.map(i => `RECORD_ID()='${i}'`).join(',') + ')')}`);
        const tarjetas = (d.records || []).filter(r => r.fields['CÓDIGO'] && !r.fields['CANJEADA'] && (!r.fields['CADUCA'] || r.fields['CADUCA'] >= hoy)).map(r => ({ codigo: r.fields['CÓDIGO'], caduca: r.fields['CADUCA'] || '', por: String(r.fields['Nombre'] || '').trim() }));
        return res.status(200).json({ ok: true, tarjetas });
      }
      if (req.method !== 'POST') return res.status(405).json({ ok: false });
      if (action === 'cambiar-pin') {
        const actual = String(b.actual || '').trim(), nuevo = String(b.nuevo || '').trim();
        if (actual !== String(F['PIN'] || '').trim()) return res.status(200).json({ ok: false, error: 'El PIN actual no es correcto' });
        if (!/^\d{4}$/.test(nuevo)) return res.status(200).json({ ok: false, error: 'El PIN nuevo tiene que tener 4 números' });
        const d = await at(`${PACIENTES}/${patientId}`, { method: 'PATCH', body: JSON.stringify({ fields: { PIN: nuevo } }) });
        return res.status(200).json({ ok: !d.error, error: d.error ? 'No se ha podido guardar' : undefined });
      }
      // subir-foto: imagen ya reducida en el móvil (jpeg en base64); sustituye a la anterior
      const b64 = String(b.b64 || ''); if (!b64 || b64.length > 3e6) return res.status(400).json({ ok: false, error: 'Foto no válida' });
      await at(`${PACIENTES}/${patientId}`, { method: 'PATCH', body: JSON.stringify({ fields: { 'FOTO PERFIL': [] } }) });
      const up = await fetch(`https://content.airtable.com/v0/${BASE_ID}/${patientId}/fldHLMwQ7hVrL4mL3/uploadAttachment`, { method: 'POST', headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ contentType: 'image/jpeg', file: b64, filename: 'perfil.jpg' }) }).then(x => x.json()).catch(() => ({ error: 1 }));
      if (up.error) return res.status(200).json({ ok: false, error: 'No se ha podido subir la foto' });
      const a = ((up.fields || {})['fldHLMwQ7hVrL4mL3'] || [])[0];
      return res.status(200).json({ ok: true, foto: a ? a.url : '' });
    } catch (e) { return res.status(500).json({ ok: false, error: 'Error' }); }
  }
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