const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const BASE_ID = 'appsrGnHpFt8sVD5A';
const PLAN_TABLE = 'tblvgE0a4gsrj4Vhp';
const FISIOS_TABLE = 'tbl2mLUrnaKCFTs6g';
const INFORMES_TABLE = 'tblwvWQxXNJPdR0Iv';
const BIBLIO_TABLE = 'tbloqn3ts872ueJSE';

const HOLDED_KEY = process.env.HOLDED_API_KEY;
const { saldoPaciente, rendimiento, inicioControl, sinFacturar } = require('./_push').saldo;
const PACIENTES = 'tbldBVgClS4HY2mOJ';
const HOLDED_URL = 'https://api.holded.com/api/v2'; // API nueva de Holded (clave «Bearer»)

let cacheContactos = null; // (ya no se descargan todos: se buscan por DNI, email o móvil)

const holdedErr = async (r, path) => { const t = await r.text().catch(() => ''); let m = t; try { const j = JSON.parse(t); m = j.message || j.detail || j.error || j.info || (j.errors && JSON.stringify(j.errors)) || t; } catch (_) {} return new Error('Holded ' + r.status + ' en ' + path.split('?')[0] + (m ? ': ' + String(typeof m === 'string' ? m : JSON.stringify(m)).slice(0, 160) : '')); };
const holded = async path => {
  const r = await fetch(HOLDED_URL + path, { headers: { Authorization: 'Bearer ' + HOLDED_KEY, accept: 'application/json' } });
  if (!r.ok) throw await holdedErr(r, path);
  return r.json();
};
// PDF (Holded lo devuelve en binario) → base64
const holdedPdf = async path => {
  const r = await fetch(HOLDED_URL + path, { headers: { Authorization: 'Bearer ' + HOLDED_KEY, accept: 'application/pdf' } });
  if (!r.ok) throw await holdedErr(r, path);
  return Buffer.from(await r.arrayBuffer()).toString('base64');
};
// Listado con páginas (cursor)
const holdedTodos = async (path, max = 20) => {
  let out = [], cursor = null;
  for (let i = 0; i < max; i++) {
    const d = await holded(cursor ? path + (path.includes('?') ? '&' : '?') + 'cursor=' + encodeURIComponent(cursor) : path);
    out = out.concat(Array.isArray(d) ? d : (d.items || d.data || []));
    if (Array.isArray(d)) break;
    if (!d.has_more || !d.cursor) break; cursor = d.cursor;
  }
  return out;
};
const normDni = t => String(t || '').toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/^ES/, '');
const soloDigitos = t => String(t || '').replace(/\D/g, '').slice(-9);
// Importe del ticket: «total» puede venir como texto, número u objeto; si no, se calcula con las líneas
const aNum = v => { if (v == null) return NaN; if (typeof v === 'object') v = v.amount ?? v.value ?? v.total; return Number(String(v).replace(/\s/g, '').replace(/,(\d{1,2})$/, '.$1')); };
const importeDoc = d => { for (const k of ['total', 'total_amount', 'amount', 'grand_total']) { const n = aNum(d[k]); if (n > 0) return n; }
  const p = (aNum(d.payments_total) || 0) + (aNum(d.payments_pending) || 0); if (p > 0) return p;
  const l = (d.lines || []).reduce((t, x) => t + (aNum(x.price) || 0) * (aNum(x.units) || 1) * (1 - (aNum(x.discount) || 0) / 100), 0); return Math.round(l * 100) / 100 || 0; };
// Ausencias del equipo (vacaciones, festivos…) que tocan un rango de fechas — tabla AUSENCIAS (Administración)
let _ausC = { t: 0, v: null };
async function ausenciasEn(desde, hasta) {
  if (!_ausC.v || Date.now() - _ausC.t > 60e3) { const d = await at(`tblkezm4bTQ4jJf1X?pageSize=100&filterByFormula=${encodeURIComponent(`NOT(IS_BEFORE({HASTA},DATEADD(TODAY(),-400,'days')))`)}`); if (d.error) throw new Error(d.error.message);
    _ausC = { t: Date.now(), v: (d.records || []).map(r => ({ fisio: r.fields.FISIO || '', desde: r.fields.DESDE || '', hasta: r.fields.HASTA || r.fields.DESDE || '', tipo: (r.fields.TIPO && r.fields.TIPO.name) || r.fields.TIPO || '', nota: r.fields.NOTA || '', hd: r.fields['HORA DESDE'] || '', hh: r.fields['HORA HASTA'] || '' })) }; }
  return _ausC.v.filter(a => a.desde && a.desde <= hasta && a.hasta >= desde);
}
// Gastos al mes desde las cuentas bancarias conectadas en Holded: suma de los movimientos negativos (salidas)
const fechaMov = m => { for (const k of ['date', 'operation_date', 'value_date', 'booking_date', 'created_at']) { const v = m[k]; if (v == null || v === '') continue;
  if (typeof v === 'number' || /^\d{9,13}$/.test(String(v))) { const n = Number(v); return new Date(n < 1e12 ? n * 1000 : n).toISOString().slice(0, 10); }
  const t = String(v).slice(0, 10); if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t; } return ''; };
// Concepto del movimiento del banco (Holded lo da con nombres distintos según el banco)
const textoMov = m => { for (const k of ['description', 'desc', 'concept', 'concepto', 'notes', 'reference', 'counterpart', 'counterpart_name', 'name', 'title']) { const v = m[k]; if (typeof v === 'string' && v.trim()) return v.trim().replace(/\s+/g, ' ').slice(0, 140); if (v && typeof v === 'object' && typeof v.name === 'string') return v.name.slice(0, 140); }
  const o = Object.entries(m).filter(([k, v]) => typeof v === 'string' && v.trim() && !/id$|^id|iban|currency|date|status|type|account/i.test(k)).map(([, v]) => v.trim()); return (o[0] || '').slice(0, 140); };
const importeMov = m => { for (const k of ['amount', 'value', 'total', 'quantity']) { const n = aNum(m[k]); if (!isNaN(n) && n !== 0) return n; } return 0; };
let _gasH = { t: 0, v: null };
async function gastosBancoMeses() {
  if (_gasH.v && Date.now() - _gasH.t < 15 * 60e3) return _gasH.v;
  // Solo la cuenta de la SL (FOURTH DYNAMIC S.L., acabada en 2638)
  const cuentas = (await holdedTodos('/treasury/accounts?limit=100', 3)).filter(c => c && (/fourth\s*dynamic/i.test(c.name || c.alias || '') || /2638$/.test(String(c.iban || '').replace(/\s/g, ''))));
  const e = {}, g = {}, nombres = [], fallos = [], det = [], lista = {};
  for (const c of cuentas) { const id = c && (c.id || c._id); if (!id) continue; const nom = c.name || c.alias || c.bank_name || c.iban || 'Cuenta'; nombres.push(nom);
    let mv = [];
    try { mv = await holdedTodos(`/treasury/accounts/${id}/bank-movements?limit=200`, 40); } catch (e) { fallos.push(e.message); det.push({ nombre: nom, error: e.message.slice(0, 160) }); continue; }
    const vistos = new Set(); let rep = 0, ent = 0, sal = 0, ini = '', fin = '', gm = {};
    mv.forEach(m => { const mid = m && (m.id || m._id); if (mid && vistos.has(mid)) { rep++; return; } if (mid) vistos.add(mid);
      const n = importeMov(m), f = fechaMov(m); if (!f) return; if (!ini || f < ini) ini = f; if (f > fin) fin = f;
      if (n > 0) { ent += n; e[f.slice(0, 7)] = Math.round(((e[f.slice(0, 7)] || 0) + n) * 100) / 100; } if (!(n < 0)) return; sal -= n; (lista[f.slice(0, 7)] = lista[f.slice(0, 7)] || []).push({ f, v: Math.round(-n * 100) / 100, t: textoMov(m) }); gm[f.slice(0, 7)] = (gm[f.slice(0, 7)] || 0) - n; g[f.slice(0, 7)] = Math.round(((g[f.slice(0, 7)] || 0) - n) * 100) / 100; });
    det.push({ nombre: nom, iban: String(c.iban || '').slice(-4), tipo: c.type || c.kind || '', saldo: aNum(c.balance ?? c.current_balance ?? c.amount), n: mv.length, repetidos: rep, entradas: Math.round(ent), salidas: Math.round(sal), desde: ini, hasta: fin,
      octubre: Math.round(gm['2026-10'] || 0) }); }
  const v = { fuente: 'banco', meses: Object.entries(g).map(([m, x]) => ({ m, v: x })).sort((a, b) => a.m.localeCompare(b.m)), entradas: Object.entries(e).map(([m, x]) => ({ m, v: x })).sort((a, b) => a.m.localeCompare(b.m)), lista, cuentas: nombres, det, error: !nombres.length ? 'No se encuentra la cuenta de FOURTH DYNAMIC S.L. en Holded' : (fallos.length === nombres.length ? fallos[0] : null) };
  _gasH = { t: Date.now(), v }; return v;
}
// Si la clave no puede leer el banco: gastos = compras y gastos registrados en Holded (menos sus rectificativas)
async function gastosComprasMeses() {
  const g = {}, suma = (L, sg) => { const vistos = new Set(); L.forEach(d => { if (!d || (d.id && vistos.has(d.id))) return; if (d.id) vistos.add(d.id);
    const f = fechaMov(d); if (!f) return; g[f.slice(0, 7)] = Math.round(((g[f.slice(0, 7)] || 0) + sg * Math.abs(importeDoc(d))) * 100) / 100; }); };
  suma(await holdedTodos('/purchases?limit=200', 40), 1);
  try { suma(await holdedTodos('/purchase-refunds?limit=200', 20), -1); } catch (e) {}
  return { fuente: 'compras', meses: Object.entries(g).map(([m, x]) => ({ m, v: x })).sort((a, b) => a.m.localeCompare(b.m)), error: null };
}
// Ingresos por día desde Holded: todos los tickets de venta (también borradores), menos los anulados con
// rectificativa (salen «Pagado»: en la clínica no se marcan los cobros) y los de pacientes de prueba
const HOLDED_DESDE = '2026-10-01'; // desde aquí los ingresos salen de Holded; antes, de las tablas que llevabais a mano
let _ingH = { t: 0, k: '', v: null };
async function ingresosHoldedDias(desde, hasta) {
  const k = desde + '|' + hasta; if (_ingH.k === k && Date.now() - _ingH.t < 10 * 60e3) return _ingH.v;
  const tk = await holdedTodos(`/sales-receipts?limit=200&start_date=${desde}&end_date=${hasta}`, 40);
  const vistos = new Set(), dias = {};
  tk.forEach(d => { if (!d || !d.id || vistos.has(d.id)) return; vistos.add(d.id);
    const f = String(d.date || '').slice(0, 10); if (f < desde || f > hasta || d.status === 'completed' || /\btest\b|prueba/i.test(d.contact_name || '')) return;
    dias[f] = Math.round(((dias[f] || 0) + importeDoc(d)) * 100) / 100; });
  _ingH = { t: Date.now(), k, v: dias }; return dias;
}
const docTipo = t => t === 'invoice' ? 'invoices' : 'sales-receipts';

// Busca contactos de Holded por un filtro exacto (code = DNI/NIF, email, mobile, phone)
async function buscarContactos(campo, valor) {
  if (!valor) return [];
  return holdedTodos('/contacts?limit=100&' + campo + '=' + encodeURIComponent(valor), 3).catch(e => { if (/ 40[13] /.test(e.message)) throw e; return []; });
}
async function contactoPorDni(dni) {
  const n = normDni(dni); if (n.length < 8) return [];
  const vistos = new Map();
  for (const v of new Set([n, String(dni || '').trim().toUpperCase()])) (await buscarContactos('code', v)).forEach(c => vistos.set(c.id, c));
  return [...vistos.values()];
}

// Contactos de Holded que corresponden al paciente (por DNI, email o móvil)
async function contactosDelPaciente(patientId) {
  const r = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${PACIENTES}/${patientId}`, { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } });
  if (!r.ok) return [];
  const f = (await r.json()).fields || {};
  const email = String(f['EMAIL'] || '').trim().toLowerCase();
  const tel = soloDigitos(f['WHATSAPP'] || f['TELF']);
  const ids = new Set();
  (await contactoPorDni(f['DNI'])).forEach(c => ids.add(c.id));
  if (!ids.size) (await buscarContactos('email', email)).filter(c => String(c.email || '').trim().toLowerCase() === email).forEach(c => ids.add(c.id));
  if (!ids.size && tel.length === 9) for (const v of [tel, '+34' + tel, '+34 ' + tel, tel.replace(/(\d{3})(\d{2})(\d{2})(\d{2})/, '$1 $2 $3 $4'), tel.replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3')])
    for (const campo of ['mobile', 'phone']) (await buscarContactos(campo, v)).forEach(c => ids.add(c.id));
  return [...ids];
}


// ── EMITIR FACTURA (botón de la tabla FACTURAS de Airtable) ─────────────────
// Se crea en Holded como ticket de venta (factura simplificada con DNI), en la serie por defecto,
// con el número que asigna Holded y nunca con fecha anterior a la última emitida.
const FACTURAS_TABLE = 'tblJw7suXLERn8AFQ';
// De momento los tickets se crean en BORRADOR y se aprueban a mano en Holded (para revisar unos días). Poner false para que salgan ya aprobados.
const HOLDED_BORRADOR = true;
// Texto legal que va en cada ticket (Holded no pone el de su plantilla cuando se crea por la API)
const TEXTO_RGPD = 'Protección de datos: Responsable: Fourth Dynamic, S.L., C/ Gran de Sant Andreu 163, 08030 Barcelona. Finalidad: gestionar la relación contractual y la facturación. Puede ejercer sus derechos de acceso, rectificación, supresión, limitación, portabilidad y oposición escribiendo a info@fisioterapia365.com, y reclamar ante la AEPD. (RGPD UE 2016/679 y LOPDGDD 3/2018)';
const FF = { fecha: 'fldQ17bGOMaS0XaxJ', fechaVieja: 'fldqZyXkxhGRS1qvn', paciente: 'fldbmNoGhedI6ySSb', c1: 'fld3lRaKQbUYcW5qY', n1: 'fldWj0dUmJzTn0lgr', p1: 'fldu2QiBD9hM5scRC', c2: 'fldlkX8RO7crsVOye', n2: 'fldOW7e0lHx3Tfu4X', p2: 'fldkYc6HBh9E1YjUv', notas: 'fldoi8INIByEPPpMn', estado: 'fld2nvRuSlR97LhbN', num: 'fldcTFAHH31Lsz53c', pdf: 'fld8jBu2P4sPB21ZC', aNombre: 'fldBW06oApJQaNlN9', aNif: 'fld6VO3g0KrFpAi6P', aDir: 'fldFK7NwsZ5AUY6qp', holdedId: 'fld4ds1kfoPbbCtVg' };
let emitiendo = Promise.resolve();
// Si Airtable dice «demasiadas peticiones» (429), espera y lo reintenta
const at = async (path, opt = {}) => { for (let i = 0; ; i++) { const r = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${path}`, { ...opt, headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': 'application/json', ...(opt.headers || {}) } }); if (r.status === 429 && i < 4) { await new Promise(z => setTimeout(z, 600 * (i + 1))); continue; } return r.json(); } };
const holdedPost = async (path, body) => { const r = await fetch(HOLDED_URL + path, { method: 'POST', headers: { Authorization: 'Bearer ' + HOLDED_KEY, accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }); if (!r.ok) throw await holdedErr(r, path); return r.json().catch(() => ({})); };
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
let _ultimas = { t: 0, v: null };
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
    ...p.map(r => { const F = r.fields, pid = (F['PACIENTE'] || [])[0] || ''; return { id: r.id, tabla: 'esperaP', pacienteId: pid, nombre: (info[pid] || {}).nombre || '—', tel: (info[pid] || {}).tel || '', fecha: F['FECHA SOLICITUD'] || String(r.createdTime).slice(0, 10), nota: F['NOTAS'] || '', disp: F['DISPONIBILIDAD'] || '', dias: (F['DIAS'] || []).map(cNm), franja: (F['FRANJA'] || []).map(cNm), horario: F['HORARIO'] || '', nopuede: F['NO PUEDE'] || '', ofrecido: F['OFRECIDO'] || '', fisio: F['FISIO'] || '', estado: est(F, false), aviso: F['ÚLTIMO AVISO'] || '' }; }),
    ...n.map(r => { const F = r.fields; return { id: r.id, tabla: 'esperaN', pacienteId: '', nombre: F['NOMBRE'] || 'Sin nombre', tel: F['TELF'] || '', fecha: F['FECHA SOLICITUD'] || String(r.createdTime).slice(0, 10), nota: F['NOTAS'] || '', disp: F['DISPONIBILIDAD'] || '', dias: (F['DIAS'] || []).map(cNm), franja: (F['FRANJA'] || []).map(cNm), horario: F['HORARIO'] || '', nopuede: F['NO PUEDE'] || '', ofrecido: F['OFRECIDO'] || '', fisio: F['FISIO'] || '', estado: est(F, cNm(F['PERDIDO?']) === 'SÍ'), aviso: F['ÚLTIMO AVISO'] || '' }; })
  ].sort((a, b) => b.fecha.localeCompare(a.fecha));
  // Si alguien de la lista ya tiene cita (dada después de apuntarse), pasa solo a «Ya tiene cita»
  try {
    const esp = v.filter(e => e.estado === 'ESPERANDO');
    if (esp.length) {
      const sinPac = esp.filter(e => !e.pacienteId && String(e.tel || '').replace(/\D/g, '').length >= 9), pidTel = {};
      if (sinPac.length) { const tels = [...new Set(sinPac.map(e => String(e.tel).replace(/\D/g, '').slice(-9)))];
        (await capTodos(PACIENTES, `filterByFormula=${encodeURIComponent('OR(' + tels.slice(0, 30).flatMap(t => [`RIGHT(REGEX_REPLACE({TELF}&'','[^0-9]',''),9)='${t}'`, `RIGHT(REGEX_REPLACE({WHATSAPP}&'','[^0-9]',''),9)='${t}'`]).join(',') + ')')}&fields[]=TELF&fields[]=WHATSAPP`).catch(() => [])).forEach(p => [p.fields['TELF'], p.fields['WHATSAPP']].forEach(t => { const d = String(t || '').replace(/\D/g, '').slice(-9); if (d.length === 9) pidTel[d] = p.id; })); }
      const quien = esp.map(e => ({ e, pid: e.pacienteId || pidTel[String(e.tel || '').replace(/\D/g, '').slice(-9)] || '' })).filter(x => x.pid);
      const pids = [...new Set(quien.map(x => x.pid))], citas = {};
      for (let i = 0; i < pids.length; i += 15) { const lote = pids.slice(i, i + 15);
        (await capTodos('tblTPlcuiSjQngkaD', `filterByFormula=${encodeURIComponent(`AND(OR(TRIM({ESTADO})='PENDIENTE',TRIM({ESTADO})='REALIZADA'),OR(${lote.map(id => `FIND('${id}',ARRAYJOIN({PacienteRec}))`).join(',')}))`)}&fields[]=FECHA&fields[]=PacienteRec`).catch(() => [])).forEach(c => (c.fields['PacienteRec'] || []).forEach(id => { if (lote.includes(id)) (citas[id] = citas[id] || []).push({ fecha: String(c.fields['FECHA'] || '').slice(0, 10), creada: String(c.createdTime || '').slice(0, 10) }); })); }
      for (const { e, pid } of quien.slice(0, 20)) {
        const c = (citas[pid] || []).filter(c => c.creada >= e.fecha && c.fecha >= e.fecha).sort((a, b) => a.fecha.localeCompare(b.fecha))[0];
        if (!c) continue;
        const T = e.tabla === 'esperaP' ? CAP.esperaP : CAP.esperaN;
        const r = await at(`${T}/${e.id}`, { method: 'PATCH', body: JSON.stringify({ fields: { ESTADO: 'CITADO', NOTAS: [e.nota, `Ya tiene cita el ${c.fecha.split('-').reverse().join('/')} (se quitó sola de la lista)`].filter(Boolean).join(' · ') }, typecast: true }) }).catch(() => ({ error: 1 }));
        if (!r.error) { e.estado = 'CITADO'; e.nota = [e.nota, `Ya tiene cita el ${c.fecha.split('-').reverse().join('/')}`].filter(Boolean).join(' · '); }
      }
    }
  } catch (err) {}
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


// ── JUSTIFICANTES E INFORMES DE SESIONES (solo con citas REALIZADA de la agenda) ──
const JUST_T = 'tblPXzcT8105MfqvB';
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DIAS_S = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const fLarga = f => { const d = new Date(f + 'T12:00:00Z'); return `${DIAS_S[d.getUTCDay()]} ${d.getUTCDate()} de ${MESES[d.getUTCMonth()]} de ${d.getUTCFullYear()}`; };
const fCorta = f => { const d = new Date(f + 'T12:00:00Z'); return `${d.getUTCDate()} de ${MESES[d.getUTCMonth()]} de ${d.getUTCFullYear()}`; };
const masUnaHora = h => { const m = /^(\d{1,2}):(\d{2})/.exec(h || ''); return m ? String((+m[1] + 1) % 24).padStart(2, '0') + ':' + m[2] : ''; };
function paginaJustificante(D, tk, C) {
  C = C || CONF_DEF.clinica;
  const e = escHtml, ses = D.sesiones || [], just = D.tipo !== 'informe', una = ses.length === 1;
  const fisioTxt = x => x.fisio ? `${e(x.fisio)}${x.colegiado ? ` · Nº colegiado ${e(x.colegiado)}` : ''}` : '';
  const tarjetas = just ? ses.map(x => `<div class="s"><div class="sf"><b>${e(fLarga(x.fecha).charAt(0).toUpperCase() + fLarga(x.fecha).slice(1))}</b><span>${x.hora ? `de ${e(x.hora)} a ${e(masUnaHora(x.hora))} h` : ''}</span></div>${x.fisio ? `<div class="sp"><small>Fisioterapeuta</small>${fisioTxt(x)}</div>` : ''}</div>`).join('')
    : `<table><thead><tr><th>Nº</th><th>Fecha</th><th>Horario</th><th>Fisioterapeuta</th></tr></thead><tbody>${ses.map((x, i) => `<tr><td>${i + 1}</td><td>${e(fCorta(x.fecha))}</td><td>${x.hora ? `${e(x.hora)}–${e(masUnaHora(x.hora))}` : ''}</td><td>${fisioTxt(x)}</td></tr>`).join('')}</tbody></table>`;
  const quien = `<b>${e(D.paciente || '')}</b>${D.dni ? `, con DNI <b>${e(D.dni)}</b>,` : ''}`;
  const texto = just
    ? `FISIO365 Centro de Fisioterapia certifica que ${quien} ha asistido ${una ? 'a una sesión de fisioterapia' : `a las siguientes ${ses.length} sesiones de fisioterapia`} en nuestro centro:`
    : `FISIO365 Centro de Fisioterapia certifica que ${quien} ha realizado <b>${ses.length} ${ses.length === 1 ? 'sesión' : 'sesiones'}</b> de fisioterapia en nuestro centro${ses.length > 1 ? ` entre el ${e(fCorta(ses[0].fecha))} y el ${e(fCorta(ses[ses.length - 1].fecha))}` : ''}:`;
  const titulo = just ? 'Justificante de asistencia' : 'Informe de sesiones realizadas';
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${titulo} · FISIO365</title>
<meta name="robots" content="noindex"><meta property="og:title" content="${titulo} · FISIO365"><meta property="og:description" content="Documento de FISIO365 Centro de Fisioterapia. Ábrelo para verlo y descargarlo en PDF."><meta property="og:image" content="https://app.fisioterapia365.com/icons/icon-512.png">
<link rel="icon" href="/icons/favicon-cara.png"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
@page{size:A4;margin:0}*{box-sizing:border-box}html{background:#e9e4dd}body{margin:0;font-family:Poppins,sans-serif;color:#1e2a38;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.bar{position:sticky;top:0;z-index:2;display:flex;justify-content:center;gap:10px;padding:12px;background:rgba(233,228,221,.92);backdrop-filter:blur(8px)}.bar button{font-family:inherit;font-size:14px;font-weight:700;border:none;border-radius:14px;padding:12px 22px;cursor:pointer;background:#c2552e;color:#fff}
.hoja{width:210mm;min-height:297mm;margin:0 auto 24px;background:#fff;padding:20mm 20mm 16mm;display:flex;flex-direction:column;box-shadow:0 6px 30px rgba(30,42,56,.12)}
.cab{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;padding-bottom:9mm;border-bottom:1.5px solid #1e2a38}
.logo{font-size:26px;font-weight:800;letter-spacing:-.5px;line-height:1}.logo span{color:#c2552e}.logo small{display:block;font-size:10.5px;font-weight:500;letter-spacing:.14em;text-transform:uppercase;color:#7d6a60;margin-top:6px}
.dat{text-align:right;font-size:9.5px;line-height:1.6;color:#5c4f47}
h1{font-size:25px;font-weight:800;letter-spacing:-.4px;margin:13mm 0 2mm}.ref{font-size:10px;color:#9b8f86;margin-bottom:9mm;letter-spacing:.04em}
p{font-size:13px;line-height:1.85;text-align:justify;margin:0 0 7mm;color:#2c3a4a}p b{color:#1e2a38}
.s{display:flex;justify-content:space-between;align-items:center;gap:16px;background:#f5f2ee;border-left:4px solid #c2552e;border-radius:12px;padding:5mm 6mm;margin-bottom:3.5mm;break-inside:avoid}
.sf b{display:block;font-size:14px;font-weight:700}.sf span{font-size:12.5px;color:#5c4f47}.sp{text-align:right;font-size:11.5px;line-height:1.45;color:#2c3a4a}.sp small{display:block;font-size:9px;letter-spacing:.12em;text-transform:uppercase;color:#9b8f86}
table{width:100%;border-collapse:collapse;font-size:11.5px;margin-bottom:6mm}th{text-align:left;font-size:9px;letter-spacing:.12em;text-transform:uppercase;color:#7d6a60;font-weight:600;padding:0 3mm 2.5mm;border-bottom:1.5px solid #1e2a38}td{padding:2.6mm 3mm;border-bottom:1px solid #ece6df}tr:nth-child(even) td{background:#faf8f5}td:first-child{color:#c2552e;font-weight:700;width:10mm}
.fin{margin-top:6mm}.pie{margin-top:auto;padding-top:8mm;border-top:1px solid #ece6df;display:flex;justify-content:space-between;gap:16px;font-size:9px;color:#9b8f86;line-height:1.5}
.marco{display:flex;justify-content:center;padding:4px 0 24px}.esc{transform-origin:top left}.esc .hoja{margin:0}
@media print{html,body{background:#fff}.bar{display:none}.marco{display:block;padding:0;height:auto!important}.esc{transform:none!important;width:auto!important}.hoja{margin:0;box-shadow:none}}
</style></head><body>
<div class="bar"><button type="button" onclick="window.print()">Descargar PDF</button></div>
<div class="marco"><div class="esc"><div class="hoja">
<div class="cab"><div class="logo">FISIO<span>365</span><small>Centro de Fisioterapia</small></div><div class="dat">${e(C.razon)} · NIF ${e(C.nif)}<br>${e(C.direccion)}<br>${e(C.tel)} · ${e(C.email)}</div></div>
<h1>${titulo}</h1><div class="ref">Barcelona, ${e(fCorta(D.emitido || ''))}</div>
<p>${texto}</p>
${tarjetas}
<p class="fin">Y para que así conste a los efectos oportunos, se expide el presente documento en Barcelona, a ${e(fCorta(D.emitido || ''))}.</p>
<div class="pie"><span>Documento generado a partir del registro de citas de FISIO365.</span><span>Ref. ${e(String(tk).slice(0, 8).toUpperCase())}</span></div>
</div></div></div>
<script>(function(){var m=document.querySelector('.marco'),e=document.querySelector('.esc'),h=document.querySelector('.hoja');function aj(){e.style.transform='';m.style.height='';var w=h.offsetWidth,hh=h.offsetHeight,k=Math.min(1,(window.innerWidth-24)/w);e.style.transform='scale('+k+')';e.style.width=w+'px';m.style.height=(hh*k+28)+'px';m.style.justifyContent=k<1?'flex-start':'center';m.style.paddingLeft=k<1?'12px':'0';}aj();window.addEventListener('resize',aj);if(document.fonts)document.fonts.ready.then(aj);})();</script>
</body></html>`;
}

// ── CIERRE DEL DÍA: checklist de cada fisio (lo imprescindible antes de irse) ──
const CIERRES_T = 'tblmJMoILPnxXzD8w';
// Puntos del reporte diario (los que tienen «auto» los comprueba también el panel)
const REPORTE_ITEMS = [
  { k: 'cobrar', t: 'He registrado en el panel **todos los cobros** del día', auto: 'cobrar' },
  { k: 'marcar', t: 'He actualizado el **estado de todas mis citas** del día', auto: 'marcar' },
  { k: 'ejercicios', t: 'Mis pacientes tienen su **programa de ejercicios** actualizado en la app', auto: 'ejercicios' },
  { k: 'consent', t: 'Las primeras visitas han firmado el **consentimiento**', auto: 'consent' },
  { k: 'anamnesis', t: 'He hecho la **anamnesis** a las primeras visitas', auto: 'anamnesis' },
  { k: 'app', t: 'He dado **acceso a la app** a los pacientes nuevos del día y la han **instalado en su móvil**', auto: 'app' },
  { k: 'proxima', t: 'Si alguien **no ha reagendado**, he apuntado por qué y lo he **pasado a seguimiento**', auto: 'proxima' },
  { k: 'llamadas', t: 'He hecho mis **llamadas de seguimiento** de hoy y he apuntado el resultado', auto: 'llamadas' },
  { k: 'chat', t: 'He contestado los **mensajes del chat** de mis pacientes', auto: 'chat' },
  { k: 'tareas', t: 'He hecho mis **tareas pendientes** de hoy', auto: 'tareas' },
  { k: 'nomejora', t: 'Si algún paciente **no mejora como se esperaba**, he empezado el **protocolo de no mejora** (si no hay ninguno, márcalo igual)' },
  { k: 'historia', t: 'He actualizado todas las **historias clínicas** de hoy' },
  { k: 'manana', t: 'He revisado mi **agenda de mañana** (primeras visitas, citas por confirmar y huecos)' },
  { k: 'limpieza', t: 'He dejado la **cabina limpia** y lista para mañana', sub: ['**Mesa y muebles** limpios y sin polvo', '**Grifo** limpio', '**Papelera** vacía', '**Papelera, rulo y taburete** sobre la camilla', '**Trapo** doblado en su sitio (se cambia cada semana)', '**Toalla de manos** colgada en su sitio (se cambia cada semana)', '**Cables** bien recogidos, ninguno por el suelo', '**Máquinas** apagadas y en su sitio', '**Carrito** ordenado y bien presentado'] },
];
// Ajustes editables desde Administración (tabla AJUSTES: CLAVE + VALOR en JSON)
const AJ_T = 'tblMxPEXHLmnaBnYb';
const OTROS_G = 'tblvdXDRDmLrThdWZ'; // ⚙ APP · OTROS GASTOS (efectivo, otras tarjetas…)
let _aj = { t: 0, v: null };
async function ajustes() {
  if (_aj.v && Date.now() - _aj.t < 60e3) return _aj.v;
  const d = await at(`${AJ_T}?pageSize=100`); if (d.error) throw new Error(d.error.message);
  const v = {}; (d.records || []).forEach(r => { try { v[r.fields.CLAVE] = { id: r.id, v: JSON.parse(r.fields.VALOR || 'null') }; } catch (e) {} });
  _aj = { t: Date.now(), v }; return v;
}
async function ajuste(clave, def) { try { const a = (await ajustes())[clave]; return a && a.v != null ? a.v : def; } catch (e) { return def; } }
async function guardarAjuste(clave, valor, quien) {
  const a = (await ajustes())[clave], fields = { CLAVE: clave, VALOR: JSON.stringify(valor), 'CAMBIADO POR': String(quien || '') };
  const d = a ? await at(`${AJ_T}/${a.id}`, { method: 'PATCH', body: JSON.stringify({ fields }) }) : await at(AJ_T, { method: 'POST', body: JSON.stringify({ records: [{ fields }] }) });
  _aj = { t: 0, v: null }; if (d.error) throw new Error(d.error.message); return true;
}
// Ajustes de la clínica (Administración › Listas y ajustes). Lo que no se haya cambiado sale de aquí.
// Enlace de confirmar cita: firma corta para que nadie pueda confirmar citas ajenas cambiando el id
function firmaCita(id) { return require('crypto').createHmac('sha256', String(process.env.AIRTABLE_TOKEN || 'fisio365')).update('cita:' + id).digest('hex').slice(0, 10); }
const enlaceConfirmar = id => `https://app.fisioterapia365.com/c/${id}-${firmaCita(id)}`;
function paginaConfirmar(D, C) {
  const e = t => String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'], MES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const fl = D.fecha ? (() => { const d = new Date(D.fecha + 'T12:00:00Z'); return `${DIAS[d.getUTCDay()]} ${d.getUTCDate()} de ${MES[d.getUTCMonth()]}`; })() : '';
  const tel = String(C.tel || '').replace(/\s/g, '');
  const cuerpo = D.error && !D.fecha ? `<h1>Vaya…</h1><p>${e(D.error)}</p>`
    : `<p class="hola">${D.pila ? 'Hola, ' + e(D.pila) : 'Hola'} 👋</p><p class="sub">${D.inactiva ? '' : D.confirmada ? '' : '¿Nos confirmas que vienes a tu cita?'}</p><div class="cita"><small>Tu cita en FISIO365</small><b>${e(fl.charAt(0).toUpperCase() + fl.slice(1))}</b><b>a las ${e(D.hora)}</b>${D.fisio ? `<span>Con ${e(D.fisio)}</span>` : ''}</div>
      ${D.error ? `<p class="err">${e(D.error)}</p>` : ''}
      ${D.inactiva ? `<p>Esta cita ya no está activa.</p>` : D.confirmada ? `<div class="ok">✓ ${D.recien ? '¡Gracias! Tu cita está confirmada' : 'Tu cita ya está confirmada'}</div><p class="peq">Te esperamos.</p>`
        : `<form method="post"><button type="submit">Confirmo que voy</button></form>`}`;
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Tu cita · FISIO365</title>
<meta property="og:title" content="Confirma tu cita en FISIO365"><meta property="og:description" content="${e(fl ? (fl.charAt(0).toUpperCase() + fl.slice(1)) + ' a las ' + (D.hora || '') : 'Tu cita en FISIO365')}"><meta property="og:image" content="https://app.fisioterapia365.com/icono.png"><meta property="og:type" content="website">
<link rel="icon" href="https://app.fisioterapia365.com/icons/favicon-48.png"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&display=swap" rel="stylesheet">
<style>*{box-sizing:border-box}body{margin:0;font-family:Poppins,system-ui,sans-serif;background:#efebe5;color:#141414;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
.c{background:#fff;border-radius:24px;padding:28px 22px;max-width:400px;width:100%;box-shadow:0 10px 30px rgba(20,20,20,.06);text-align:center}
.logo{display:block;width:84px;height:84px;border-radius:22px;margin:0 auto 18px}.hola{font-size:22px;font-weight:700;margin:0 0 4px}.sub{font-size:15px;color:#5c4f47;margin:0 0 18px;min-height:2px}
.cita{background:#f3efea;border-radius:18px;padding:18px 14px;display:flex;flex-direction:column;gap:2px;margin-bottom:20px}.cita small{font-size:12px;color:#7d6a60;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px}.cita b{font-size:20px;line-height:1.3}.cita span{margin-top:6px;color:#5c4f47}
button{width:100%;font-family:inherit;font-size:16px;font-weight:600;color:#fff;background:#c2552e;border:none;border-radius:14px;padding:16px;cursor:pointer}
.ok{background:#e8f6ec;color:#16803c;font-weight:600;border-radius:14px;padding:16px}.err{color:#b42318}.peq{font-size:14px;color:#7d6a60;margin:12px 0 0}
.pie{margin-top:22px;font-size:12.5px;color:#7d6a60;line-height:1.6}.pie a{color:#7d6a60}h1{font-size:20px}</style></head>
<body><div class="c"><img class="logo" src="https://app.fisioterapia365.com/icono.png" alt="FISIO365">${cuerpo}<div class="pie">${e(C.direccion || '')}${tel ? `<br>¿Dudas? Llámanos al <a href="tel:+34${e(tel)}">${e(C.tel)}</a>` : ''}</div></div></body></html>`;
}
const CONF_DEF = {
  listas: {
    conceptos: [{ n: 'Sesión de fisioterapia', p: '' }, { n: 'Sesión de fisioterapia avanzada', p: '' }, { n: 'Sesión de suelo pélvico', p: '' }, { n: 'Sesión de readaptación deportiva', p: '' }, { n: 'Plus aplicación colágeno', p: '' }, { n: 'Otros', p: '' }],
    pagos: ['Tarjeta', 'Efectivo', 'Bizum', 'Transferencia'],
    motivos: ['Busca ecografía', 'Sanitas', 'Adeslas', 'Otros seguros', 'No tenemos disponibilidad', 'Pide precios', 'Solo pide info', 'Quiere algo que no tenemos'],
    negocios: ['FARMACIA', 'PODÓLOGO', 'CLÍNICA DENTAL', 'CLÍNICA ESTÉTICA', 'GIMNASIO', 'OTRO'],
    zonas: ['Cervical', 'Hombro', 'Codo, muñeca y mano', 'Dorsal', 'Lumbar', 'Cadera y glúteo', 'Rodilla', 'Tobillo y pie', 'Core', 'Equilibrio', 'Neurodinamia', 'Respiración', 'General']
  },
  tarjeta: { importe: 10, meses: 6 },
  holded: { borrador: true, rgpd: TEXTO_RGPD },
  clinica: { razon: 'Fourth Dynamic, S.L.', nif: 'B56503592', direccion: 'C/ Gran de Sant Andreu, 163 · 08030 Barcelona', tel: '672 89 39 49', email: 'info@fisioterapia365.com' },
  cancelacion: { horas: 24, texto: 'Si no puedes venir, avísanos con al menos 24 horas de antelación para poder dar tu hora a otra persona.' }
};
async function conf() { const g = await ajuste('config', null) || {}; const o = {}; Object.keys(CONF_DEF).forEach(k => { o[k] = Object.assign({}, CONF_DEF[k], g[k] || {}); }); o.listas = Object.assign({}, CONF_DEF.listas, (g.listas || {})); return o; }
// Check-list: la guardada en Administración (los puntos de siempre conservan su comprobación automática)
async function checklistTodos() {
  const g = await ajuste('checklist', null); if (!Array.isArray(g) || !g.length) return REPORTE_ITEMS.map(x => Object.assign({}, x));
  return g.filter(x => x && x.k && x.t).map(x => { const b = REPORTE_ITEMS.find(y => y.k === x.k); return { k: String(x.k), t: String(x.t), sub: Array.isArray(x.sub) && x.sub.length ? x.sub.map(String) : undefined, auto: b && b.auto, off: !!x.off }; });
}
const checklistItems = async () => (await checklistTodos()).filter(x => !x.off).map(({ off, ...x }) => x);
const EMAILS_DEF = () => String(process.env.RESUMEN_EMAIL || 'fisio365gestion@gmail.com').split(/[,;\s]+/).filter(Boolean);
async function emailsResumen() { const e = await ajuste('emails_resumen', null); return Array.isArray(e) && e.length ? e : EMAILS_DEF(); }
const nmSel = v => String((v && typeof v === 'object') ? (v.name || '') : (v || '')).trim();
const fisioKey = n => String(n || '').trim().split(' ')[0].toLowerCase();
const orIds = (ids, campo) => 'OR(' + ids.map(id => `FIND('${id}',ARRAYJOIN({${campo}}))`).join(',') + ')';
async function lotes(ids, fn, n = 15) { const out = []; for (let i = 0; i < ids.length; i += n) out.push(...await fn(ids.slice(i, i + n))); return out; }
async function cierreDia(fecha, soloFisio) {
  const citas = await capTodos(CIT_T, `filterByFormula=${encodeURIComponent(`DATETIME_FORMAT({FECHA},'YYYY-MM-DD')='${fecha}'`)}&fields[]=ESTADO&fields[]=HORA&fields[]=PREF.&fields[]=RELACIÓN - CITA&fields[]=your-name`);
  const conPac = citas.filter(c => (c.fields['RELACIÓN - CITA'] || []).length && nmSel(c.fields['PREF.']) && (!soloFisio || fisioKey(nmSel(c.fields['PREF.'])) === fisioKey(soloFisio)));
  const est = c => nmSel(c.fields['ESTADO']).toUpperCase();
  const hechas = conPac.filter(c => est(c) === 'REALIZADA');
  const P = [...new Set(hechas.map(c => c.fields['RELACIÓN - CITA'][0]))];
  const todosP = [...new Set(conPac.map(c => c.fields['RELACIÓN - CITA'][0]))];
  const [nombres, segs, futuras, previas, planes, sf, cons] = await Promise.all([
    lotes(todosP, ids => capTodos(PACIENTES, `filterByFormula=${encodeURIComponent('OR(' + ids.map(id => `RECORD_ID()='${id}'`).join(',') + ')')}&fields[]=FULL NAME&fields[]=ÚLTIMO ACCESO APP`), 40).catch(() => []),
    lotes(P, ids => capTodos('tblu9YxiktpAh5w87', `filterByFormula=${encodeURIComponent(`AND(NOT({HECHO}),${orIds(ids, 'PacRec')})`)}&fields[]=PacRec`)).catch(() => []),
    lotes(P, ids => capTodos(CIT_T, `filterByFormula=${encodeURIComponent(`AND(TRIM({ESTADO})='PENDIENTE',IS_AFTER({FECHA},'${fecha}'),${orIds(ids, 'PacienteRec')})`)}&fields[]=PacienteRec`)).catch(() => []),
    lotes(P, ids => capTodos(CIT_T, `filterByFormula=${encodeURIComponent(`AND(TRIM({ESTADO})='REALIZADA',IS_BEFORE({FECHA},'${fecha}'),${orIds(ids, 'PacienteRec')})`)}&fields[]=PacienteRec`)).catch(() => []),
    lotes(P, ids => capTodos(PLAN_TABLE, `filterByFormula=${encodeURIComponent(`AND(LEN({Ejercicios}&'')>2,OR(${ids.map(id => `{PacienteID}='${id}'`).join(',')}))`)}&fields[]=PacienteID`)).catch(() => []),
    sinFacturar().catch(() => ({ activo: false, lista: [] })),
    consTodos().catch(() => [])
  ]);
  // Lo que es de cada fisio aunque no sea de un paciente de hoy: llamadas, tareas y mensajes
  const nuevos = P.filter(id => !new Set(previas.flatMap(c => c.fields['PacienteRec'] || [])).has(id));
  const [segPend, tarPend, msgs, fisT, anam] = await Promise.all([
    capTodos('tblu9YxiktpAh5w87', `filterByFormula=${encodeURIComponent(`AND(NOT({HECHO}),NOT(IS_AFTER({FECHA DE LLAMADA},'${fecha}')))`)}&fields[]=RESPONSABLE&fields[]=PACIENTE&fields[]=PacRec`).catch(() => []),
    capTodos('tblxPpPSvj15NWqNT', `filterByFormula=${encodeURIComponent(`AND(NOT({HECHO}),NOT(IS_AFTER({FECHA},'${fecha}')))`)}&fields[]=TAREA&fields[]=PARA&fields[]=PACIENTE`).catch(() => []),
    capTodos('tblIsWo3g6x1QzJyl', `filterByFormula=${encodeURIComponent(`AND(NOT({Visto}),{Tipo}!="fisio",OR({Tipo}!="chat",{De}!="fisio"))`)}&fields[]=PacienteId&fields[]=PacienteNombre&fields[]=FisioId`).catch(() => []),
    at('tbl2mLUrnaKCFTs6g?fields[]=Name').catch(() => ({})),
    lotes(nuevos, ids => capTodos('tblF4as0orW1b6KIw', `filterByFormula=${encodeURIComponent('OR(' + ids.map(id => `{PacienteID}='${id}'`).join(',') + ')')}&fields[]=PacienteID`)).catch(() => [])
  ]);
  const idFisio = Object.fromEntries((fisT.records || []).map(r => [fisioKey(r.fields.Name), r.id]));
  const conAnam = new Set(anam.map(r => String(r.fields['PacienteID'] || '')));
  const nomLink = v => (Array.isArray(v) ? v : []).map(x => (x && x.name) || x).filter(Boolean).join(', ');
  const nom = Object.fromEntries(nombres.map(p => [p.id, p.fields['FULL NAME'] || '']));
  const conFutura = new Set([...futuras.flatMap(c => c.fields['PacienteRec'] || []), ...segs.flatMap(r => r.fields['PacRec'] || [])]);
  const usaApp = new Set(nombres.filter(p => p.fields['ÚLTIMO ACCESO APP']).map(p => p.id));
  const yaVino = new Set(previas.flatMap(c => c.fields['PacienteRec'] || []));
  const conPlan = new Set(planes.map(r => String(r.fields['PacienteID'] || '')));
  const debe = new Map((sf.lista || []).map(x => [x.id, -x.saldo]));
  const conCons = new Set(cons.flatMap(c => c.pac || []));
  const porFisio = {};
  conPac.forEach(c => { const f = nmSel(c.fields['PREF.']); (porFisio[f] = porFisio[f] || []).push(c); });
  const out = {};
  for (const [fisio, cs] of Object.entries(porFisio)) {
    const it = (c, extra) => { const id = c.fields['RELACIÓN - CITA'][0]; return { id, nombre: nom[id] || c.fields['your-name'] || '—', hora: String(c.fields['HORA'] || '').slice(0, 5), extra: extra || '' }; };
    const hs = cs.filter(c => est(c) === 'REALIZADA');
    const uni = arr => { const v = new Set(); return arr.filter(x => !v.has(x.id) && v.add(x.id)); };
    const checks = [
      { k: 'marcar', t: 'Citas marcadas', d: 'Todas las citas del día con su estado (hecha, no vino…)', items: cs.filter(c => ['PENDIENTE', 'CITA DUDOSA'].includes(est(c))).map(c => it(c)) },
      { k: 'cobrar', t: 'Todo cobrado', d: sf.activo ? 'Cada sesión hecha está pagada (pack o cobro desde el panel)' : 'El control de cobros empezará con el primer cobro desde el panel', items: sf.activo ? uni(hs.filter(c => debe.has(c.fields['RELACIÓN - CITA'][0])).map(c => it(c, debe.get(c.fields['RELACIÓN - CITA'][0]) + ' sin cobrar'))) : [] },
      { k: 'ejercicios', t: 'Ejercicios en la app', d: 'Cada paciente de hoy tiene su programa cargado', items: uni(hs.filter(c => !conPlan.has(c.fields['RELACIÓN - CITA'][0])).map(c => it(c))) },
      { k: 'consent', t: 'Consentimiento firmado', d: 'Las primeras visitas tienen el consentimiento', items: uni(hs.filter(c => { const id = c.fields['RELACIÓN - CITA'][0]; return !yaVino.has(id) && !conCons.has(id); }).map(c => it(c, 'primera visita'))) },
      { k: 'app', t: 'App a los nuevos', d: 'Los pacientes nuevos del día ya han entrado en la app', items: uni(hs.filter(c => { const id = c.fields['RELACIÓN - CITA'][0]; return !yaVino.has(id) && !usaApp.has(id); }).map(c => it(c, 'aún no ha entrado'))) },
      { k: 'anamnesis', t: 'Anamnesis', d: 'Las primeras visitas tienen su anamnesis', items: uni(hs.filter(c => { const id = c.fields['RELACIÓN - CITA'][0]; return !yaVino.has(id) && !conAnam.has(id); }).map(c => it(c, 'primera visita'))) },
      { k: 'llamadas', t: 'Llamadas de seguimiento', d: 'Llamadas de hoy (o atrasadas) con su resultado', items: segPend.filter(r => fisioKey(nmSel(r.fields['RESPONSABLE'])) === fisioKey(fisio)).map(r => ({ id: (r.fields['PacRec'] || [])[0] || '', nombre: nomLink(r.fields['PACIENTE']) || '—', extra: 'sin resultado' })) },
      { k: 'chat', t: 'Chat', d: 'Mensajes de pacientes sin leer', items: (() => { const fid = idFisio[fisioKey(fisio)]; const v = new Map(); msgs.filter(m => fid && m.fields['FisioId'] === fid).forEach(m => { const id = m.fields['PacienteId'] || ''; const x = v.get(id) || { id, nombre: m.fields['PacienteNombre'] || '—', n: 0 }; x.n++; v.set(id, x); }); return [...v.values()].map(x => ({ id: x.id, nombre: x.nombre, extra: x.n + (x.n > 1 ? ' mensajes' : ' mensaje') })); })() },
      { k: 'tareas', t: 'Tareas', d: 'Tareas de hoy o atrasadas', items: tarPend.filter(r => fisioKey(nmSel(r.fields['PARA'])) === fisioKey(fisio)).map(r => ({ id: '', nombre: String(r.fields['TAREA'] || 'Tarea').slice(0, 60), extra: nomLink(r.fields['PACIENTE']) })) },
      { k: 'proxima', t: 'Próxima cita o seguimiento', d: 'Quien no reagenda, pasa a seguimiento con el motivo', items: uni(hs.filter(c => !conFutura.has(c.fields['RELACIÓN - CITA'][0])).map(c => it(c, 'sin cita ni seguimiento'))) },
    ];
    out[fisio] = { citas: cs.length, hechas: hs.length, checks, pendientes: checks.filter(x => !x.aviso).reduce((t, x) => t + x.items.length, 0) };
  }
  return out;
}
async function cierresEnviados(fecha) {
  const r = await capTodos(CIERRES_T, `filterByFormula=${encodeURIComponent(`DATETIME_FORMAT({FECHA},'YYYY-MM-DD')='${fecha}'`)}`).catch(() => []);
  const m = {}; r.forEach(x => { const k = fisioKey(x.fields['FISIO']); if (!m[k] || String(x.fields['ENVIADO'] || '') > String(m[k].enviado || '')) m[k] = { id: x.id, fisio: x.fields['FISIO'] || '', enviado: x.fields['ENVIADO'] || '', pendientes: Number(x.fields['PENDIENTES'] || 0), detalle: x.fields['DETALLE'] || '', nota: x.fields['NOTA'] || '', marcados: x.fields['MARCADOS'] || '' }; });
  return m;
}

// Tarjetas regalo (10 €) que el paciente tiene sin usar: con código y sin caducar, o ganadas (el recomendado ya vino)
async function tarjetasActivas(F) {
  const ids = (F['HA RECOMENDADO'] || []).slice(0, 40); if (!ids.length) return [];
  const hoy = new Date().toISOString().slice(0, 10);
  const d = await at(`tblr27u3cvtzfyqI6?filterByFormula=${encodeURIComponent('OR(' + ids.map(i => `RECORD_ID()='${i}'`).join(',') + ')')}`);
  const sinCod = (d.records || []).filter(r => !r.fields['CÓDIGO'] && !r.fields['IGNORAR'] && (r.fields['PACIENTE'] || []).length), vinieron = new Set();
  if (sinCod.length) { const ps = sinCod.slice(0, 15).map(r => r.fields['PACIENTE'][0]);
    const c = await at(`tblTPlcuiSjQngkaD?filterByFormula=${encodeURIComponent(`AND(TRIM({ESTADO})='REALIZADA',OR(${ps.map(id => `FIND('${id}',ARRAYJOIN({PacienteRec}))`).join(',')}))`)}&fields[]=PacienteRec&pageSize=100`);
    (c.records || []).forEach(x => (x.fields['PacienteRec'] || []).forEach(id => vinieron.add(id))); }
  const mesesT = Number((await conf().catch(() => CONF_DEF)).tarjeta.meses) || 6;
  const cad6 = (() => { const c = new Date(); c.setMonth(c.getMonth() + mesesT); return c.toISOString().slice(0, 10); })();
  return (d.records || []).filter(r => !r.fields['CANJEADA'] && ((r.fields['CÓDIGO'] && (!r.fields['CADUCA'] || r.fields['CADUCA'] >= hoy)) || (!r.fields['CÓDIGO'] && !r.fields['IGNORAR'] && vinieron.has((r.fields['PACIENTE'] || [])[0]))))
    .map(r => ({ id: r.id, codigo: r.fields['CÓDIGO'] || '', caduca: r.fields['CADUCA'] || cad6, por: String(r.fields['Nombre'] || '').trim() }));
}

// Fisio que atiende al paciente (el de su última sesión; si no, quien cobra) con su nº de colegiado
async function fisioDelPaciente(pacId, quien, elegido) {
  const nm = v => String((v && v.name) || v || '').trim();
  const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date());
  let pref = '';
  if (elegido !== undefined) { if (!String(elegido || '').trim()) return ''; quien = elegido; } else try {
    const c = await at(`${CIT_T}?filterByFormula=${encodeURIComponent(`AND(FIND('${pacId}',ARRAYJOIN({PacienteRec})),OR(TRIM({ESTADO})='REALIZADA',TRIM({ESTADO})='PENDIENTE'),NOT(IS_AFTER({FECHA},'${hoy}')))`)}&sort[0][field]=FECHA&sort[0][direction]=desc&pageSize=1&fields[]=PREF.&fields[]=FECHA`);
    pref = nm((((c.records || [])[0] || {}).fields || {})['PREF.']);
  } catch (e) {}
  const buscar = String(pref || quien || '').trim().toLowerCase(); if (!buscar) return '';
  const d = await at(`tbl2mLUrnaKCFTs6g?fields[]=Name&fields[]=NºColegiado`).catch(() => ({}));
  const fs = (d.records || []).map(r => r.fields || {}).filter(f => f.Name);
  const f = fs.find(x => x.Name.trim().toLowerCase() === buscar) || fs.find(x => x.Name.trim().toLowerCase().split(' ')[0] === buscar.split(' ')[0]);
  if (!pref && !(f && f['NºColegiado'])) return elegido ? 'Fisioterapeuta: ' + String(elegido).trim() : ''; // quien cobra solo cuenta si es fisio (no recepción)
  if (!f) return pref ? 'Fisioterapeuta: ' + pref.charAt(0) + pref.slice(1).toLowerCase() : '';
  return 'Fisioterapeuta: ' + f.Name.trim() + (f['NºColegiado'] ? ' · Nº de colegiado ' + String(f['NºColegiado']).trim() : '');
}

async function emitirFactura(recId, quien, fisioSel, descuento) {
  const CF = await conf().catch(() => CONF_DEF), borradorH = CF.holded.borrador !== false, rgpdH = String(CF.holded.rgpd || TEXTO_RGPD);
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

  // Fecha: hoy, o la de la fila si es anterior a hoy y no anterior al último ticket emitido
  const isoMad = d => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  const hoyIso = isoMad(new Date());
  const ult = await holded('/sales-receipts?limit=1&sort=-date&approval_status=approved').catch(() => ({}));
  const ultima = (ult.items || [])[0];
  const ultFecha = ultima && ultima.date ? String(ultima.date).slice(0, 10) : '';
  let fecha = hoyIso;
  const fFila = f[FF.fecha] || f[FF.fechaVieja];
  if (fFila) {
    const fd = String(fFila).slice(0, 10);
    if (fd > hoyIso) throw new Error('La fecha no puede ser futura');
    if (ultFecha && fd < ultFecha) throw new Error('La fecha es anterior a la última factura emitida (' + ultFecha.split('-').reverse().join('/') + '). Deja la fecha vacía para usar la de hoy.');
    fecha = fd;
  }
  // Impuesto: el mismo que lleva el último ticket (sanitaria exenta → sin impuesto)
  const l0 = ultima && (ultima.lines || [])[0];
  const taxes = l0 && Array.isArray(l0.taxes) && l0.taxes.length ? l0.taxes.map(t => typeof t === 'string' ? t : (t && (t.key || t.id))).filter(Boolean) : null;

  // Contacto: «Facturar a» si está rellenado; si no, el paciente (por DNI)
  let datos;
  if (String(f[FF.aNombre] || '').trim()) {
    datos = { name: String(f[FF.aNombre]).trim(), code: normDni(f[FF.aNif]), address: String(f[FF.aDir] || '').trim() };
  } else {
    const pac = await at(`${PACIENTES}/${pacId}`);
    const pf = pac.fields || {};
    // Sin DNI también se puede (ticket / factura simplificada): se busca su contacto en Holded por email o móvil, o se crea sin DNI
    datos = { name: String(pf['FULL NAME'] || '').trim(), code: normDni(pf['DNI'] || ''), email: pf['EMAIL'] || '', mobile: pf['WHATSAPP'] || pf['TELF'] || '', sinDni: !pf['DNI'] };
  }
  if (!datos.code && !datos.sinDni) throw new Error('Falta el DNI/NIF de quien recibe la factura');
  let contactId = datos.code ? ((await contactoPorDni(datos.code))[0] || {}).id : (await contactosDelPaciente(pacId).catch(() => []))[0];
  if (!contactId) {
    const body = { name: datos.name, type: 'client' }; if (datos.code) body.code = datos.code;
    if (datos.email) body.email = datos.email;
    if (datos.mobile) body.mobile = datos.mobile;
    if (datos.address) body.bill_address = { address: datos.address };
    const c = await holdedPost('/contacts', body);
    contactId = c.id;
  }

  const fisioTxt = await fisioDelPaciente(pacId, quien, fisioSel).catch(() => '');
  const items = lineas.map(l => { const it = { name: l.concepto === 'Otros' && notas ? notas.split('\n')[0].slice(0, 120) : l.concepto, units: l.uds, price: l.precio }; if (taxes) it.taxes = taxes; return it; });
  if (descuento) { const it = { name: descuento.texto, units: 1, price: -Math.abs(descuento.importe) }; if (taxes) it.taxes = taxes; items.push(it); }
  const doc = await holdedPost('/sales-receipts', { contact_id: contactId, contact_name: datos.name, date: fecha, notes: [fisioTxt, notas, rgpdH].filter(Boolean).join('\n\n\n'), currency: 'EUR', language: 'es', items });
  const docId = doc.id;
  if (!docId) throw new Error('Holded no ha devuelto el ticket creado');
  let creado = await holded('/sales-receipts/' + docId).catch(() => ({}));
  // Si se ha quedado en borrador (sin número), se aprueba para que coja el siguiente número de la serie
  if (!borradorH && !creado.document_number) { await holdedPost('/sales-receipts/' + docId + '/approve', {}).catch(() => {}); creado = await holded('/sales-receipts/' + docId).catch(() => creado); }
  const borrador = !creado.document_number;
  const num = creado.document_number || 'Borrador';
  const campos = { [FF.estado]: 'Emitida', [FF.num]: String(num), [FF.fecha]: fecha, [FF.fechaVieja]: fecha, [FF.holdedId]: String(docId) };
  await at(`${FACTURAS_TABLE}/${recId}`, { method: 'PATCH', body: JSON.stringify({ fields: campos, typecast: true }) });
  if (!borrador) try {
    const pdf = await holdedPdf('/sales-receipts/' + docId + '/pdf');
    if (pdf) await fetch(`https://content.airtable.com/v0/${BASE_ID}/${recId}/${FF.pdf}/uploadAttachment`, { method: 'POST', headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ contentType: 'application/pdf', file: pdf, filename: 'Factura_' + String(num).replace(/[^\w-]/g, '_') + '.pdf' }) });
  } catch (e) {}
  return { num, borrador, otro: !!String(f[FF.aNombre] || '').trim(), total: lineas.reduce((t, l) => t + l.uds * l.precio, 0) - (descuento ? Math.abs(descuento.importe) : 0) };
}

async function listarFacturas(ids, conBorradores) {
  let facturas = [];
  // Tickets de venta (lo habitual: llevan DNI y sirven como factura) y, por si acaso, facturas completas
  for (const cid of ids) for (const tipoDoc of ['salesreceipt', 'invoice']) {
    const docs = await holdedTodos('/' + docTipo(tipoDoc) + '?limit=100&contact_id=' + encodeURIComponent(cid), 5).catch(e => { if (tipoDoc === 'salesreceipt') throw e; return []; });
    docs.forEach(d => {
      if (d.contact_id !== cid || (!d.document_number && !conBorradores)) return; // solo suyos y ya aprobados (el panel ve también los borradores)
      facturas.push({ id: d.id, tipo: tipoDoc, numero: d.document_number || '', borrador: !d.document_number, fecha: d.date ? Math.floor(Date.parse(String(d.date).slice(0, 10) + 'T12:00:00Z') / 1000) : 0, total: importeDoc(d), pagada: d.status === 'completed', concepto: ((d.lines || [])[0] || {}).name || d.description || '' });
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
  // Confirmar cita (enlace del recordatorio por WhatsApp). Solo confirma: para cambiar o anular hay que llamar.
  // Al abrir el enlace no se confirma nada (WhatsApp abre los enlaces para la vista previa): hace falta pulsar el botón.
  if (action === 'cita-confirmar') {
    const id = String(req.query.id || ''), sg = String(req.query.s || '');
    res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('X-Robots-Tag', 'noindex');
    const C = (await conf().catch(() => CONF_DEF)).clinica || CONF_DEF.clinica;
    if (!/^rec[A-Za-z0-9]{14}$/.test(id) || sg !== firmaCita(id)) return res.status(404).send(paginaConfirmar({ error: 'Este enlace no es válido.' }, C));
    const r = await at(`tblTPlcuiSjQngkaD/${id}`);
    if (r.error) return res.status(404).send(paginaConfirmar({ error: 'No encontramos esta cita.' }, C));
    const F = r.fields || {}, est = String((F['ESTADO'] && F['ESTADO'].name) || F['ESTADO'] || '').toUpperCase();
    const fecha = String(F['FECHA'] || '').slice(0, 10), hora = String(F['HORA'] || '').replace(/^(\d):/, '0$1:').slice(0, 5);
    const fisio = String((F['PREF.'] && F['PREF.'].name) || F['PREF.'] || '').trim().split(' ')[0];
    const pid = (F['RELACIÓN - CITA'] || [])[0]; let pila = '';
    if (pid) { const p = await at(`${PACIENTES}/${pid}`).catch(() => ({})); const P = p.fields || {}; pila = (String(P['NOMBRE'] || '').trim() || String(P['FULL NAME'] || '').trim()).split(/\s+/)[0] || ''; }
    const hoyC = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const D = { pila: pila ? pila.charAt(0).toUpperCase() + pila.slice(1).toLowerCase() : '', fecha, hora, fisio: fisio ? fisio.charAt(0).toUpperCase() + fisio.slice(1).toLowerCase() : '' };
    if (!/PENDIENTE/.test(est) || fecha < hoyC) return res.status(200).send(paginaConfirmar({ ...D, inactiva: true }, C));
    let conf0 = (F['CONFIR'] || []).some(x => /CONFIRMADA/i.test(x.name || x));
    if (req.method === 'POST' && !conf0) {
      const u = await at(`tblTPlcuiSjQngkaD/${id}`, { method: 'PATCH', body: JSON.stringify({ fields: { CONFIR: ['CONFIRMADA'] } }) });
      if (u.error) return res.status(500).send(paginaConfirmar({ ...D, error: 'No se ha podido confirmar. Inténtalo de nuevo en un momento.' }, C));
      conf0 = true;
    }
    return res.status(200).send(paginaConfirmar({ ...D, confirmada: conf0, recien: req.method === 'POST' }, C));
  }
  // Justificante / informe de sesiones (enlace privado que va por WhatsApp)
  if (action === 'doc-pagina') {
    const tk = String(req.query.t || ''); if (!/^[A-Za-z0-9]{24}$/.test(tk)) return res.status(404).send('No encontrado');
    const r = await at(`${JUST_T}?filterByFormula=${encodeURIComponent(`{TOKEN}='${tk}'`)}&maxRecords=1`);
    const rec = (r.records || [])[0]; if (!rec) return res.status(404).send('Documento no encontrado');
    let D = {}; try { D = JSON.parse(rec.fields['DATOS'] || '{}'); } catch (e) {}
    res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('X-Robots-Tag', 'noindex');
    return res.status(200).send(paginaJustificante(D, tk, (await conf().catch(() => CONF_DEF)).clinica));
  }
  // Tarjeta regalo pública (el enlace que va por WhatsApp; la vista previa enseña la imagen)
  if (action === 'tarjeta-img' || action === 'tarjeta-pagina') {
    const id = String(req.query.id || ''); if (!/^rec[A-Za-z0-9]{14}$/.test(id)) return res.status(404).end();
    const r = await at(`tblr27u3cvtzfyqI6/${id}`); const a = r.fields && (r.fields['TARJETA IMG'] || [])[0];
    // Sin la imagen guardada la página se enseña igual (con la tarjeta dibujada); solo falla si la tarjeta no existe
    if (!r.fields || !r.fields['CÓDIGO']) return res.status(404).send('Tarjeta no encontrada');
    if (action === 'tarjeta-img' && !a) return res.redirect(302, 'https://app.fisioterapia365.com/icons/icon-512.png');
    if (action === 'tarjeta-img') { const im = await fetch(a.url); res.setHeader('Content-Type', a.type || 'image/jpeg'); res.setHeader('Cache-Control', 'public, max-age=86400'); return res.status(200).send(Buffer.from(await im.arrayBuffer())); }
    const impP = Number((await conf().catch(() => CONF_DEF)).tarjeta.importe) || 10;
    const img = `https://app.fisioterapia365.com/api/schedule?action=tarjeta-img&id=${id}`, cad = String(r.fields['CADUCA'] || '').split('-').reverse().join('/');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Tarjeta regalo · FISIO365</title>
<meta property="og:title" content="Tarjeta regalo de ${impP} €"><meta property="og:description" content="FISIO365 · Te lo descontamos en tu próxima sesión"><meta property="og:image" content="${img}"><meta property="og:image:width" content="1080"><meta property="og:image:height" content="1080"><meta property="og:image:type" content="image/jpeg"><meta property="og:type" content="website"><meta name="twitter:card" content="summary">
<link rel="icon" href="/icons/favicon-cara.png"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@500;700&display=swap" rel="stylesheet">
<style>body{margin:0;background:#f5f2ee;font-family:Poppins,sans-serif;color:#1a1a1a;display:flex;justify-content:center}main{max-width:440px;width:100%;padding:28px 16px;box-sizing:border-box}img{width:100%;border-radius:20px;box-shadow:0 10px 30px rgba(194,85,46,.25);display:block}h1{font-size:20px;margin:22px 0 6px}p{font-size:15px;line-height:1.5;color:#5c4f47;margin:0 0 18px}a{display:block;text-align:center;background:#1a1a1a;color:#fff;text-decoration:none;font-weight:700;border-radius:14px;padding:14px}.tj{aspect-ratio:1;border-radius:20px;background:linear-gradient(135deg,#de8257,#c2552e);color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;box-shadow:0 10px 30px rgba(194,85,46,.25)}.tj b{font-size:22px}.tj small{font-size:13px;letter-spacing:.2em;opacity:.9;margin-top:4px}.tj strong{font-size:84px;line-height:1.1;margin:14px 0 4px}.tj span{font-size:17px;font-weight:600}.tj em{font-style:normal;font-size:16px;margin-top:22px}.tj i{font-style:normal;font-size:13px;opacity:.85;margin-top:4px}</style></head>
<body><main>${a ? `<img src="${img}" alt="Tarjeta regalo de ${impP} €">` : `<div class="tj"><b>FISIO365</b><small>TARJETA REGALO</small><strong>${impP} €</strong><span>de descuento en tu próxima sesión</span>${r.fields['Nombre de quien recomendó'] ? `<em>Para ${String(r.fields['Nombre de quien recomendó']).split(' ')[0].replace(/[<>&"]/g, '')}</em>` : ''}${cad ? `<i>Válida hasta el ${cad}</i>` : ''}</div>`}<h1>¡Gracias por recomendarnos!</h1><p>Tienes ${impP} € de descuento en tu próxima sesión${cad ? ', válido hasta el ' + cad : ''}. No tienes que hacer nada: lo tenemos apuntado y te lo descontamos al pagar.</p><a href="https://app.fisioterapia365.com">Abrir mi app de FISIO365</a></main></body></html>`);
  }
  if (action === 'config-pub') { // lo que la app del paciente necesita saber (sin datos privados)
    const c = await conf().catch(() => CONF_DEF); res.setHeader('Cache-Control', 'public, max-age=300');
    return res.status(200).json({ ok: true, tarjeta: c.tarjeta, cancelacion: c.cancelacion, tel: c.clinica.tel });
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
      if (action === 'seg-config') return res.status(200).json({ ok: true, conf: await conf() });
      // ── ADMINISTRACIÓN: equipo, horarios, ausencias, accesos y contraseñas (solo quien tiene acc_admin) ──
      if (action.startsWith('seg-adm-')) {
        if (req.method !== 'POST') return res.status(405).json({ ok: false });
        const FT = FISIOS_TABLE, AUS = 'tblkezm4bTQ4jJf1X', DIAS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
        const ACC = ['agenda', 'pacientes', 'chat', 'checklist', 'callin', 'captacion', 'programas', 'ejercicios', 'anamnesis', 'rendimiento', 'estadisticas', 'school', 'admin'];
        const full = await todosT(FT, 'sort[0][field]=Name');
        const yo = full.find(r => r.fields && String(r.fields.Name || '').trim().toLowerCase() === String(q.yo || '').trim().toLowerCase());
        if (!yo || String(yo.fields.Password || '').trim() !== String(q.clave || '').trim() || !yo.fields.acc_admin || yo.fields['FECHA BAJA']) return res.status(403).json({ ok: false, error: 'Solo dirección puede entrar en Administración. Vuelve a iniciar sesión.' });
        const pila = s => String(s || '').trim().split(/\s+/)[0];
        const vista = r => { const F = r.fields || {}, horas = {};
          String(F['HORAS POR DÍA'] || '').split('\n').forEach(l => { const m = l.trim().match(/^(\S+)\s+([\d.,]+)/); if (!m) return; const d = DIAS.find(x => capNorm(x) === capNorm(m[1])); if (d) horas[d] = Number(m[2].replace(',', '.')); });
          return { id: r.id, nombre: F.Name || '', role: F.Role || 'fisio', colegiado: F['NºColegiado'] || '', tel: F['TELÉFONO'] || '', email: F.EMAIL || '', alta: F['FECHA ALTA'] || '', baja: F['FECHA BAJA'] || '', notas: F['NOTAS ADMIN'] || '',
            horas, semana: F['HORAS SEMANA'] || null, control: !!F['CONTROL HORAS'], accesos: Object.fromEntries(ACC.map(k => [k, !!F['acc_' + k]])), foto: (F.Foto && F.Foto[0] && F.Foto[0].thumbnails && F.Foto[0].thumbnails.large && F.Foto[0].thumbnails.large.url) || '',
            claveDebil: !F.Password || String(F.Password).trim().length < 6 || /^(1234|12345|123456|0000|fisio365)$/i.test(String(F.Password).trim()) }; };
        const ausencias = async () => (await todosT(AUS, `filterByFormula=${encodeURIComponent(`NOT(IS_BEFORE({HASTA},DATEADD(TODAY(),-60,'days')))`)}&sort[0][field]=DESDE&sort[0][direction]=asc`)).map(r => ({ id: r.id, fisio: r.fields.FISIO || '', desde: r.fields.DESDE || '', hasta: r.fields.HASTA || r.fields.DESDE || '', tipo: (r.fields.TIPO && r.fields.TIPO.name) || r.fields.TIPO || '', nota: r.fields.NOTA || '', por: r.fields['CREADO POR'] || '', hd: r.fields['HORA DESDE'] || '', hh: r.fields['HORA HASTA'] || '' }));
        if (action === 'seg-adm-equipo') {
          const eq = full.filter(r => r.fields && r.fields.Name).map(vista).sort((a, b) => !!a.baja - !!b.baja || (a.role === 'admin') - (b.role === 'admin') || a.nombre.localeCompare(b.nombre));
          return res.status(200).json({ ok: true, equipo: eq, ausencias: await ausencias().catch(() => []), dias: DIAS, accesos: ACC });
        }
        if (action === 'seg-adm-fisio') {
          const c = q.fisio || {}, nombre = String(c.nombre || '').trim().replace(/\s+/g, ' ');
          if (nombre.length < 2) return res.status(400).json({ ok: false, error: 'Escribe el nombre' });
          const otro = full.find(r => r.id !== c.id && r.fields && String(r.fields.Name || '').trim().toLowerCase() === nombre.toLowerCase());
          if (otro) return res.status(400).json({ ok: false, error: 'Ya hay alguien con ese nombre' });
          const mismaPila = full.find(r => r.id !== c.id && r.fields && !r.fields['FECHA BAJA'] && pila(r.fields.Name).toLowerCase() === pila(nombre).toLowerCase());
          if (mismaPila) return res.status(400).json({ ok: false, error: `Ya hay otra persona que se llama ${pila(nombre)}. En la agenda se distingue por el nombre de pila: ponle otro (por ejemplo «${pila(nombre)} M.»)` });
          const f = { Name: nombre, Role: c.role === 'admin' ? 'admin' : 'fisio', 'NºColegiado': String(c.colegiado || '').trim(), 'TELÉFONO': String(c.tel || '').trim(), 'NOTAS ADMIN': String(c.notas || '').slice(0, 5000), 'CONTROL HORAS': !!c.control };
          const em = String(c.email || '').trim(); f.EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em) ? em : null;
          f['FECHA ALTA'] = /^\d{4}-\d{2}-\d{2}$/.test(c.alta || '') ? c.alta : null;
          const h = c.horas || {}, lin = []; let tot = 0; DIAS.forEach(d => { const n = Math.max(0, Math.min(14, Number(String(h[d] || '').replace(',', '.')) || 0)); if (n) { lin.push(`${d} ${n}`); tot += n; } });
          f['HORAS POR DÍA'] = lin.join('\n'); f['HORAS SEMANA'] = Math.round(tot) || null;
          ACC.forEach(k => { if (c.accesos && k in c.accesos) f['acc_' + k] = !!c.accesos[k]; });
          if (c.id === yo.id) f.acc_admin = true; // que nadie se quite a sí mismo el acceso a Administración
          const clave = String(c.clave || '').trim();
          if (clave) { if (clave.length < 6) return res.status(400).json({ ok: false, error: 'La contraseña tiene que tener al menos 6 caracteres' }); f.Password = clave; }
          let d;
          if (c.id) { if (!/^rec[A-Za-z0-9]{14}$/.test(c.id)) return res.status(400).json({ ok: false }); d = await at(`${FT}/${c.id}`, { method: 'PATCH', body: JSON.stringify({ fields: f, typecast: true }) }); }
          else { if (!clave) return res.status(400).json({ ok: false, error: 'Ponle una contraseña para que pueda entrar' }); if (!c.accesos) ['agenda', 'pacientes', 'chat', 'checklist', 'callin', 'captacion', 'programas', 'ejercicios', 'anamnesis', 'school'].forEach(k => f['acc_' + k] = true);
            if (!f['FECHA ALTA']) f['FECHA ALTA'] = hoyF; d = await at(FT, { method: 'POST', body: JSON.stringify({ records: [{ fields: f }], typecast: true }) }); d = d.records ? d.records[0] : d; }
          if (d.error) return res.status(400).json({ ok: false, error: d.error.message || 'No se ha podido guardar' });
          // Foto: nueva (cuadrada, comprimida en el panel) o quitarla
          if ((c.foto && c.foto.b64 && String(c.foto.b64).length < 4e6) || c.quitarFoto) {
            await at(`${FT}/${d.id}`, { method: 'PATCH', body: JSON.stringify({ fields: { Foto: [] } }) });
            if (!c.quitarFoto) { const up = await fetch(`https://content.airtable.com/v0/${BASE_ID}/${d.id}/fldpL6HNfozN4T9Zw/uploadAttachment`, { method: 'POST', headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ contentType: 'image/jpeg', file: c.foto.b64, filename: 'foto-' + pila(nombre).toLowerCase() + '.jpg' }) }).catch(() => null);
              if (!up || !up.ok) return res.status(200).json({ ok: true, aviso: 'Se ha guardado, pero la foto no se ha podido subir. Prueba otra vez.', fisio: vista(d) }); }
            d = await at(`${FT}/${d.id}`);
          }
          return res.status(200).json({ ok: true, fisio: vista(d) });
        }
        if (action === 'seg-adm-acceso') { // marcar o desmarcar una sección para una persona
          const r = full.find(x => x.id === q.id); if (!r || !ACC.includes(q.k)) return res.status(400).json({ ok: false, error: 'Datos no válidos' });
          if (r.id === yo.id && q.k === 'admin' && !q.v) return res.status(400).json({ ok: false, error: 'No puedes quitarte a ti mismo el acceso a Administración' });
          const d = await at(`${FT}/${r.id}`, { method: 'PATCH', body: JSON.stringify({ fields: { ['acc_' + q.k]: !!q.v } }) });
          return res.status(200).json({ ok: !d.error, error: d.error && d.error.message });
        }
        if (action === 'seg-adm-ajustes') {
          return res.status(200).json({ ok: true, checklist: await checklistTodos(), emails: await emailsResumen(), base: REPORTE_ITEMS.map(x => x.k) });
        }
        if (action === 'seg-adm-checklist') {
          if (q.reset) { await guardarAjuste('checklist', null, yo.fields.Name); return res.status(200).json({ ok: true, checklist: await checklistTodos() }); }
          const L = (Array.isArray(q.items) ? q.items : []).slice(0, 40).map((x, i) => ({ k: /^[a-z0-9_]{2,30}$/.test(x && x.k || '') ? x.k : 'p' + Date.now().toString(36) + i, t: String(x && x.t || '').trim().slice(0, 300), sub: (Array.isArray(x && x.sub) ? x.sub : []).map(y => String(y).trim().slice(0, 200)).filter(Boolean).slice(0, 20), off: !!(x && x.off) })).filter(x => x.t);
          if (!L.filter(x => !x.off).length) return res.status(400).json({ ok: false, error: 'Deja al menos un punto' });
          if (new Set(L.map(x => x.k)).size !== L.length) return res.status(400).json({ ok: false, error: 'Puntos repetidos' });
          await guardarAjuste('checklist', L, yo.fields.Name); return res.status(200).json({ ok: true, checklist: await checklistTodos() });
        }
        if (action === 'seg-adm-emails') {
          const E = [...new Set((Array.isArray(q.emails) ? q.emails : []).map(x => String(x).trim().toLowerCase()).filter(Boolean))];
          const mal = E.find(x => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x)); if (mal) return res.status(400).json({ ok: false, error: `«${mal}» no es un email válido` });
          if (!E.length) return res.status(400).json({ ok: false, error: 'Deja al menos un email' });
          await guardarAjuste('emails_resumen', E.slice(0, 10), yo.fields.Name); return res.status(200).json({ ok: true, emails: await emailsResumen() });
        }
        if (action === 'seg-adm-config') { // guardar una parte de «Listas y ajustes»
          const sec = String(q.seccion || ''), v = q.valor || {}, cur = (await ajuste('config', null)) || {};
          const lim = (x, n) => String(x == null ? '' : x).trim().slice(0, n);
          const lista = (L, n) => [...new Set((Array.isArray(L) ? L : []).map(x => lim(x, n)).filter(Boolean))].slice(0, 60);
          if (sec === 'listas') {
            const conceptos = (Array.isArray(v.conceptos) ? v.conceptos : []).map(c => ({ n: lim(c && c.n, 80), p: c && c.p !== '' && c.p != null && !isNaN(Number(String(c.p).replace(',', '.'))) ? Number(String(c.p).replace(',', '.')) : '' })).filter(c => c.n).slice(0, 40);
            if (!conceptos.length) return res.status(400).json({ ok: false, error: 'Deja al menos un concepto' });
            const L = { conceptos, pagos: lista(v.pagos, 40), motivos: lista(v.motivos, 60), negocios: lista(v.negocios, 40), zonas: lista(v.zonas, 40) };
            if (!L.pagos.length) return res.status(400).json({ ok: false, error: 'Deja al menos una forma de pago' });
            cur.listas = L;
          } else if (sec === 'tarjeta') {
            const imp = Math.round(Number(String(v.importe).replace(',', '.')) * 100) / 100, me = Math.round(Number(v.meses));
            if (!(imp > 0 && imp <= 200) || !(me >= 1 && me <= 36)) return res.status(400).json({ ok: false, error: 'Revisa el importe y los meses' });
            cur.tarjeta = { importe: imp, meses: me };
          } else if (sec === 'holded') cur.holded = { borrador: !!v.borrador, rgpd: lim(v.rgpd, 1500) || TEXTO_RGPD };
          else if (sec === 'clinica') cur.clinica = { razon: lim(v.razon, 80), nif: lim(v.nif, 20), direccion: lim(v.direccion, 160), tel: lim(v.tel, 30), email: lim(v.email, 80) };
          else if (sec === 'cancelacion') { const h = Math.round(Number(v.horas)); if (!(h >= 0 && h <= 168)) return res.status(400).json({ ok: false, error: 'Revisa las horas' }); cur.cancelacion = { horas: h, texto: lim(v.texto, 600) }; }
          else return res.status(400).json({ ok: false, error: 'Sección no válida' });
          await guardarAjuste('config', cur, yo.fields.Name); return res.status(200).json({ ok: true, conf: await conf() });
        }
        if (action === 'seg-adm-etiquetas') { // estados del paciente y tipos de cita (son tablas: cada etiqueta es una fila)
          const T = q.tabla === 'tipos' ? 'tbltoikmBZwHYQcpD' : 'tbldOsLe8iw78Wun7', NOM = q.tabla === 'tipos' ? 'Name' : 'ESTADO', LNK = q.tabla === 'tipos' ? 'CITAS' : 'PACIENTES';
          const todasE = async () => (await todosT(T, `fields[]=${NOM}&fields[]=${LNK}`)).map(r => ({ id: r.id, n: String(r.fields[NOM] || '').trim(), uso: (r.fields[LNK] || []).length }));
          const okR = x => /^rec[A-Za-z0-9]{14}$/.test(x || '');
          if (q.op === 'nuevo' || q.op === 'renombrar') {
            const n = String(q.nombre || '').trim().replace(/\s+/g, ' ').slice(0, 40); if (n.length < 2) return res.status(400).json({ ok: false, error: 'Escribe el nombre' });
            const ya = (await todasE()).find(x => x.n.toLowerCase() === n.toLowerCase() && x.id !== q.id); if (ya) return res.status(400).json({ ok: false, error: 'Ya existe. Si quieres juntarlas, usa «Juntar con…»' });
            const d = q.op === 'nuevo' ? await at(T, { method: 'POST', body: JSON.stringify({ records: [{ fields: { [NOM]: n } }] }) }) : okR(q.id) ? await at(`${T}/${q.id}`, { method: 'PATCH', body: JSON.stringify({ fields: { [NOM]: n } }) }) : { error: { message: 'Falta cuál' } };
            if (d.error) return res.status(400).json({ ok: false, error: d.error.message });
          } else if (q.op === 'borrar') { // una o varias
            const ids = [...new Set((Array.isArray(q.ids) ? q.ids : [q.id]).filter(okR))].slice(0, 200); if (!ids.length) return res.status(400).json({ ok: false });
            const E0 = await todasE(), uso = E0.filter(x => ids.includes(x.id)).reduce((t, x) => t + x.uso, 0);
            if (uso && !q.confirmar) return res.status(200).json({ ok: false, uso, error: `Las tienen ${uso} ${q.tabla === 'tipos' ? 'citas' : 'pacientes'}. Si las borras, se les quitan.` });
            for (let i = 0; i < ids.length; i += 10) await at(`${T}?${ids.slice(i, i + 10).map(x => 'records[]=' + x).join('&')}`, { method: 'DELETE' });
          } else if (q.op === 'juntar') { // pasar todas las citas/pacientes de una o varias a la elegida y borrar las otras
            const src = [...new Set((Array.isArray(q.ids) ? q.ids : [q.id]).filter(okR))].filter(x => x !== q.a).slice(0, 100);
            if (!src.length || !okR(q.a)) return res.status(400).json({ ok: false });
            const E0 = await todasE(); if (!E0.some(x => x.id === q.a)) return res.status(400).json({ ok: false, error: 'No se encuentra la etiqueta de destino' });
            const recs = await todosT(T, `filterByFormula=${encodeURIComponent('OR(' + src.map(x => `RECORD_ID()='${x}'`).join(',') + ')')}&fields[]=${LNK}`);
            const ids = [...new Set(recs.flatMap(r => r.fields[LNK] || []))];
            if (ids.length > 900) return res.status(400).json({ ok: false, error: `Son ${ids.length} ${q.tabla === 'tipos' ? 'citas' : 'pacientes'}: demasiadas de golpe. Júntalas en grupos más pequeños.` });
            const DST = q.tabla === 'tipos' ? CIT : PACIENTES, CAMPO = q.tabla === 'tipos' ? 'TIPO DE CITA' : 'ESTADO', S = new Set(src);
            for (let i = 0; i < ids.length; i += 40) {
              const rs = await todosT(DST, `filterByFormula=${encodeURIComponent('OR(' + ids.slice(i, i + 40).map(x => `RECORD_ID()='${x}'`).join(',') + ')')}&fields[]=${encodeURIComponent(CAMPO)}`);
              const ch = rs.map(r => ({ id: r.id, fields: { [CAMPO]: [...new Set((r.fields[CAMPO] || []).map(x => S.has(x) ? q.a : x))] } }));
              for (let k = 0; k < ch.length; k += 10) { const d = await at(DST, { method: 'PATCH', body: JSON.stringify({ records: ch.slice(k, k + 10) }) }); if (d.error) return res.status(400).json({ ok: false, error: d.error.message }); }
            }
            for (let i = 0; i < src.length; i += 10) await at(`${T}?${src.slice(i, i + 10).map(x => 'records[]=' + x).join('&')}`, { method: 'DELETE' });
          }
          global._tiposCache = null;
          const L = (await todasE()).filter(x => x.n).sort((a, b) => b.uso - a.uso || a.n.localeCompare(b.n, 'es'));
          return res.status(200).json({ ok: true, etiquetas: L });
        }
        if (action === 'seg-adm-baja') {
          const r = full.find(x => x.id === q.id); if (!r) return res.status(404).json({ ok: false, error: 'No encontrado' });
          if (r.id === yo.id) return res.status(400).json({ ok: false, error: 'No puedes darte de baja a ti mismo' });
          if (q.baja) { // citas con paciente que tiene a partir de hoy (para avisar)
            const fut = await todosT(CIT, `filterByFormula=${encodeURIComponent(`AND({PREF.}='${pila(r.fields.Name).replace(/'/g, '')}',NOT(IS_BEFORE({FECHA},'${hoyF}')),{RELACIÓN - CITA}!='',FIND('PENDIENTE',{ESTADO}&''))`)}&fields[]=FECHA`).catch(() => []);
            if (fut.length && !q.confirmar) return res.status(200).json({ ok: false, citas: fut.length, error: `${pila(r.fields.Name)} tiene ${fut.length} cita${fut.length === 1 ? '' : 's'} pendiente${fut.length === 1 ? '' : 's'} a partir de hoy. Muévelas a otro fisio antes, o confirma la baja igualmente.` });
          }
          const d = await at(`${FT}/${r.id}`, { method: 'PATCH', body: JSON.stringify({ fields: { 'FECHA BAJA': q.baja ? hoyF : null } }) });
          return res.status(200).json({ ok: !d.error, error: d.error && d.error.message, fisio: !d.error && vista(d) });
        }
        if (action === 'seg-adm-ausencia') {
          const a = q.ausencia || {}, ok = x => /^\d{4}-\d{2}-\d{2}$/.test(x || '');
          if (!ok(a.desde)) return res.status(400).json({ ok: false, error: 'Elige la fecha' });
          const hasta = ok(a.hasta) && a.hasta >= a.desde ? a.hasta : a.desde;
          const horario = a.modo === 'horario'; // «trabaja otro horario ese día»: se bloquea lo que queda fuera
          const tipo = horario ? 'Cambio de horario' : ['Vacaciones', 'Festivo', 'Día libre', 'Menos horas', 'Baja', 'Formación', 'Otro'].includes(a.tipo) ? a.tipo : 'Vacaciones';
          const p2 = x => { const m = String(x || '').match(/^(\d{1,2}):(\d{2})$/); return m ? m[1].padStart(2, '0') + ':' + m[2] : ''; };
          const hd = p2(a.hd), hh2 = p2(a.hh); if ((hd || hh2 || horario) && !(hd && hh2 && hd < hh2)) return res.status(400).json({ ok: false, error: 'Revisa las horas: «desde» tiene que ser antes que «hasta»' });
          const todosF = a.fisio === 'TODOS', quien = todosF ? 'Toda la clínica' : pila(a.fisio);
          if (!todosF && !full.some(r => r.fields && pila(r.fields.Name).toLowerCase() === quien.toLowerCase())) return res.status(400).json({ ok: false, error: 'Elige el fisio' });
          const d = await at(AUS, { method: 'POST', body: JSON.stringify({ records: [{ fields: { AUSENCIA: `${tipo} · ${quien} · ${a.desde}${hasta !== a.desde ? ' → ' + hasta : ''}${hd ? ` · ${hd}-${hh2}` : ''}`, FISIO: quien, 'HORA DESDE': hd, 'HORA HASTA': hh2, DESDE: a.desde, HASTA: hasta, TIPO: tipo, NOTA: String(a.nota || '').slice(0, 2000), 'CREADO POR': String(yo.fields.Name || '') } }], typecast: true }) });
          if (d.error) return res.status(400).json({ ok: false, error: d.error.message }); _ausC = { t: 0, v: null };
          // Bloquear los huecos libres de esos días (para que no se reserven desde la app) y avisar de las citas con paciente
          const cond = [`NOT(IS_BEFORE({FECHA},'${a.desde}'))`, `NOT(IS_AFTER({FECHA},'${hasta}'))`]; if (!todosF) cond.push(`{PREF.}='${quien.replace(/'/g, '')}'`);
          const filas = await todosT(CIT, `filterByFormula=${encodeURIComponent(`AND(${cond.join(',')})`)}&fields[]=FECHA&fields[]=HORA&fields[]=ESTADO&fields[]=PREF.&fields[]=${encodeURIComponent('RELACIÓN - CITA')}`).catch(() => []);
          const est = r => String((r.fields.ESTADO && r.fields.ESTADO.name) || r.fields.ESTADO || '').trim();
          const enHoras = r => { if (!hd) return true; const x = p2(r.fields.HORA); if (!x) return false; const dentro = x >= hd && x < hh2; return horario ? !dentro : dentro; };
          filas.splice(0, filas.length, ...filas.filter(enHoras));
          const libres = filas.filter(r => /^(CITA LIBRE|LIBRE - SIN BOMBA)$/.test(est(r)) && !(r.fields['RELACIÓN - CITA'] || []).length);
          for (let i = 0; i < libres.length; i += 10) await at(CIT, { method: 'PATCH', body: JSON.stringify({ records: libres.slice(i, i + 10).map(r => ({ id: r.id, fields: { ESTADO: 'CITA BLOQUEADA', NOTAS: tipo } })), typecast: true }) });
          const conPac = filas.filter(r => (r.fields['RELACIÓN - CITA'] || []).length && /PENDIENTE/.test(est(r))).map(r => ({ fecha: String(r.fields.FECHA || '').slice(0, 10), hora: r.fields.HORA || '', fisio: (r.fields['PREF.'] && r.fields['PREF.'].name) || r.fields['PREF.'] || '' })).sort((x, y) => (x.fecha + x.hora).localeCompare(y.fecha + y.hora));
          return res.status(200).json({ ok: true, bloqueados: libres.length, conPaciente: conPac, ausencias: await ausencias().catch(() => []) });
        }
        if (action === 'seg-adm-ausencia-borrar') {
          if (!/^rec[A-Za-z0-9]{14}$/.test(q.id || '')) return res.status(400).json({ ok: false });
          const d = await at(`${AUS}/${q.id}`, { method: 'DELETE' }); _ausC = { t: 0, v: null };
          return res.status(200).json({ ok: !d.error, ausencias: await ausencias().catch(() => []) });
        }
        return res.status(400).json({ ok: false, error: 'Acción no válida' });
      }
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
          const ids = [...new Set(rs.flatMap(r => [...(r.fields['PACIENTE'] || []), ...(r.fields['RECOMENDÓ'] || [])]))], nom = {}, tel = {};
          for (let i = 0; i < ids.length; i += 40) (await todosT(PACIENTES, `filterByFormula=${encodeURIComponent('OR(' + ids.slice(i, i + 40).map(x => `RECORD_ID()='${x}'`).join(',') + ')')}&fields[]=FULL NAME&fields[]=WHATSAPP&fields[]=TELF`).catch(() => [])).forEach(p => { nom[p.id] = p.fields['FULL NAME'] || ''; tel[p.id] = p.fields['WHATSAPP'] || p.fields['TELF'] || ''; });
          const negs = {}; const nids = [...new Set(rs.flatMap(r => r.fields['NEGOCIO'] || []))];
          if (nids.length) (await todosT('tblO5y1Ikg3LIalic', `filterByFormula=${encodeURIComponent('OR(' + nids.map(x => `RECORD_ID()='${x}'`).join(',') + ')')}&fields[]=NOMBRE`).catch(() => [])).forEach(n => { negs[n.id] = n.fields['NOMBRE'] || ''; });
          const out = rs.map(r => { const F = r.fields, rid = (F['RECOMENDÓ'] || [])[0], nid = (F['NEGOCIO'] || [])[0];
            const estado = F['CANJEADA'] ? 'Tarjeta canjeada el ' + String(F['CANJEADA']).split('-').reverse().join('/') : F['CÓDIGO'] ? 'Tarjeta enviada el ' + String(F['FECHA TARJETA'] || '').split('-').reverse().join('/') : nid ? 'Negocio: ' + (negs[nid] || '') + ' · gracias enviadas' : 'Marcado «no toca tarjeta»';
            return { id: r.id, quien: rid ? nom[rid] : (nid ? negs[nid] : String(F['Nombre de quien recomendó'] || '').trim()), nuevo: nom[(F['PACIENTE'] || [])[0]] || `${F['Nombre'] || ''} ${F['Apellidos'] || ''}`.trim(), estado, canjeada: !!F['CANJEADA'], fecha: F['FECHA TARJETA'] || F['Fecha'] || '', tarjeta: !!F['CÓDIGO'] && !F['CANJEADA'], caduca: F['CADUCA'] || '', tel: rid ? tel[rid] || '' : '', nuevoNombre: String(F['Nombre'] || '').trim() }; }).sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
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
            const c = new Date(hoyF + 'T12:00:00Z'); c.setUTCMonth(c.getUTCMonth() + (Number((await conf().catch(() => CONF_DEF)).tarjeta.meses) || 6)); cad = c.toISOString().slice(0, 10);
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
          if (!up.ok) console.log('tarjeta-img subida', up.status, (await up.text().catch(() => '')).slice(0, 300));
          return res.status(200).json({ ok: true, img: up.ok, url: `https://app.fisioterapia365.com/tarjeta/${q.id}` });
        }
        if (action === 'seg-referido-canjear') {
          const r0 = await at(`${REF}/${q.id}`); if (r0.error) return res.status(404).json({ ok: false });
          const f = { CANJEADA: q.deshacer ? null : hoyF };
          if (!q.deshacer && !r0.fields['CÓDIGO']) { const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; f['CÓDIGO'] = 'F365-' + Array.from({ length: 4 }, () => A[Math.floor(Math.random() * A.length)]).join(''); const c = new Date(hoyF + 'T12:00:00Z'); c.setUTCMonth(c.getUTCMonth() + 6); f.CADUCA = c.toISOString().slice(0, 10); f['FECHA TARJETA'] = hoyF; f['Regalo entregado'] = true; }
          const d = await at(`${REF}/${q.id}`, { method: 'PATCH', body: JSON.stringify({ fields: f }) }); return res.status(200).json({ ok: !d.error }); }
        return res.status(400).json({ ok: false });
      }
      if (action === 'seg-ultimas') {
        // Última sesión hecha de cada paciente (último año) y con qué fisio. Se guarda 30 min.
        if (!_ultimas.v || Date.now() - _ultimas.t > 30 * 60e3 || q.fresco) {
          const cs = await todosT(CIT, `filterByFormula=${encodeURIComponent(`AND(TRIM({ESTADO})='REALIZADA',IS_AFTER({FECHA},DATEADD(TODAY(),-365,'days')))`)}&fields[]=FECHA&fields[]=PREF.&fields[]=PacienteRec`);
          const u = {}; cs.forEach(c => { const f = String(c.fields['FECHA'] || '').slice(0, 10); (c.fields['PacienteRec'] || []).forEach(id => { if (!u[id] || f > u[id].f) u[id] = { f, fi: cNm(c.fields['PREF.']) }; }); });
          _ultimas = { t: Date.now(), v: u };
        }
        return res.status(200).json({ ok: true, ultimas: _ultimas.v });
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
          const fin = new Date(Date.now() + 8 * 864e5).toISOString().slice(0, 10), ayer = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
          const [con, esp, neg, ref, lib] = await Promise.all([
            capTodos(CAP.contacto, `filterByFormula=${encodeURIComponent(`IS_AFTER({FECHA},'${desde}')`)}&sort[0][field]=FECHA&sort[0][direction]=desc`),
            esperaLista(true),
            capTodos(CAP.negocio, 'sort[0][field]=NOMBRE&sort[0][direction]=asc'),
            capTodos(CAP.referidos, `filterByFormula=${encodeURIComponent("{Nombre de quien recomendó}!=''")}&fields[]=Nombre de quien recomendó&fields[]=Nombre&fields[]=Apellidos&fields[]=Fecha&fields[]=NEGOCIO`).catch(() => []),
            capTodos('tblTPlcuiSjQngkaD', `filterByFormula=${encodeURIComponent(`AND(OR(TRIM({ESTADO})='CITA LIBRE',TRIM({ESTADO})='LIBRE - SIN BOMBA'),IS_AFTER({FECHA},'${ayer}'),IS_BEFORE({FECHA},'${fin}'))`)}&fields[]=FECHA&fields[]=HORA&fields[]=PREF.&fields[]=ESTADO`).catch(() => [])
          ]);
          const ahoraH = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
          const libres = lib.map(r => ({ fecha: String(r.fields['FECHA'] || '').slice(0, 10), hora: String(r.fields['HORA'] || '').replace(/^(\d):/, '0$1:').slice(0, 5), fisio: cNm(r.fields['PREF.']), sinBomba: /SIN BOMBA/.test(cNm(r.fields['ESTADO'])) }))
            .filter(h => h.fecha && h.hora && (h.fecha > hoyF || (h.fecha === hoyF && h.hora > ahoraH))).sort((a, b) => (a.fecha + a.hora).localeCompare(b.fecha + b.hora));
          const negocios = neg.map(r => { const F = r.fields, toks = capNorm(F['NOMBRE']).split(/[^a-z0-9]+/).filter(w => w.length >= 4 && !CAP_STOP.test(w));
            const vienen = ref.filter(x => (x.fields['NEGOCIO'] || []).includes(r.id) || (toks.length && (() => { const t = capNorm(x.fields['Nombre de quien recomendó']); return toks.some(w => t.includes(w)); })())).map(x => ({ nombre: [x.fields['Nombre'], x.fields['Apellidos']].filter(Boolean).join(' ').trim(), fecha: x.fields['Fecha'] || '' }));
            return { id: r.id, nombre: F['NOMBRE'] || '', tipo: cNm(F['TIPO NEGOCIO']), estado: cNm(F['ESTADO']) || 'PENDIENTE', fecha: F['FECHA'] || '', flyers: !!F['FLAYERS ENTREGADOS'], notas: F['NOTAS'] || '', direccion: F['DIRECCIÓN'] || '', contacto: F['CONTACTO'] || '', tel: F['TELF'] || '', proxima: F['PRÓXIMA VISITA'] || '', historial: F['HISTORIAL'] || '', diez: !!F['10% A SUS CLIENTES'], vienen }; });
          return res.status(200).json({ ok: true, hoy: hoyF,
            contactos: con.map(r => { const F = r.fields; return { id: r.id, fecha: F['FECHA'] || r.createdTime, nombre: F['NOMBRE'] || '', medio: cNm(F['MEDIO']), mensaje: F['MENSAJE'] || '', citado: cNm(F['CITADO']), motivo: F['MOTIVO'] || '', motivoTipo: cNm(F['MOTIVO TIPO']), tel: F['TELF'] || '', por: F['REGISTRADO POR'] || '', archivado: !!F['ARCHIVADO'] }; }),
            espera: esp, negocios, libres });
        }
        if (action === 'seg-cap-avisos') {
          const fin = new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10), ayer = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
          const [esp, lib, neg] = await Promise.all([esperaLista(), capTodos('tblTPlcuiSjQngkaD', `filterByFormula=${encodeURIComponent(`AND(OR(TRIM({ESTADO})='CITA LIBRE',TRIM({ESTADO})='LIBRE - SIN BOMBA'),IS_AFTER({FECHA},'${ayer}'),IS_BEFORE({FECHA},'${fin}'))`)}&fields[]=FECHA&fields[]=HORA&fields[]=PREF.&fields[]=ESTADO`).catch(() => []),
            capTodos(CAP.negocio, `filterByFormula=${encodeURIComponent(`AND({PRÓXIMA VISITA}!='',NOT(IS_AFTER({PRÓXIMA VISITA},TODAY())))`)}&fields[]=NOMBRE&fields[]=PRÓXIMA VISITA&fields[]=TELF&fields[]=CONTACTO`).catch(() => [])]);
          const ahoraH = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
          const libres = lib.map(r => ({ fecha: String(r.fields['FECHA'] || '').slice(0, 10), hora: String(r.fields['HORA'] || '').replace(/^(\d):/, '0$1:').slice(0, 5), fisio: cNm(r.fields['PREF.']), sinBomba: /SIN BOMBA/.test(cNm(r.fields['ESTADO'])) })).filter(h => h.fecha && h.hora && (h.fecha > hoyF || (h.fecha === hoyF && h.hora > ahoraH))).sort((a, b) => (a.fecha + a.hora).localeCompare(b.fecha + b.hora));
          return res.status(200).json({ ok: true, hoy: hoyF, espera: esp.filter(e => e.estado === 'ESPERANDO'), libres, negocios: neg.map(r => ({ id: r.id, nombre: r.fields['NOMBRE'] || '', proxima: r.fields['PRÓXIMA VISITA'] || '', tel: r.fields['TELF'] || '', contacto: r.fields['CONTACTO'] || '' })) });
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
            if (c.tel !== undefined) f['TELF'] = String(c.tel || '').slice(0, 30); if (c.archivado !== undefined) f['ARCHIVADO'] = !!c.archivado;
            if (!q.id && !f['FECHA']) f['FECHA'] = new Date().toISOString();
          } else if (q.tabla === 'negocio') {
            txt('NOMBRE', c.nombre, 120); txt('NOTAS', c.notas); txt('DIRECCIÓN', c.direccion, 200); txt('CONTACTO', c.contacto, 120); txt('HISTORIAL', c.historial, 20000);
            if (c.tel !== undefined) f['TELF'] = String(c.tel || '').slice(0, 30);
            if (c.tipo !== undefined) f['TIPO NEGOCIO'] = c.tipo || null; if (c.estado !== undefined) f['ESTADO'] = c.estado || null;
            if (c.fecha !== undefined) f['FECHA'] = okF(c.fecha) ? c.fecha : null; if (c.proxima !== undefined) f['PRÓXIMA VISITA'] = okF(c.proxima) ? c.proxima : null;
            if (c.flyers !== undefined) f['FLAYERS ENTREGADOS'] = !!c.flyers;
          } else {
            if (c.fecha !== undefined || !q.id) f['FECHA SOLICITUD'] = okF(c.fecha) ? c.fecha : hoyF;
            txt('NOTAS', c.nota); txt('DISPONIBILIDAD', c.disp, 500); txt('FISIO', c.fisio, 40); txt('NO PUEDE', c.nopuede, 5000); txt('OFRECIDO', c.ofrecido, 5000); if (c.aviso !== undefined) f['ÚLTIMO AVISO'] = okF(c.aviso) ? c.aviso : null;
            if (c.dias !== undefined) f['DIAS'] = lista(c.dias); if (c.franja !== undefined) f['FRANJA'] = lista(c.franja); if (c.horario !== undefined) f['HORARIO'] = /^(\d{2}:\d{2})?-(\d{2}:\d{2})?$/.test(c.horario || '') && c.horario !== '-' ? c.horario : ''; if (c.estado !== undefined) f['ESTADO'] = c.estado || null;
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
        if (action === 'seg-agenda-num') { // aparte de la agenda (para que nunca la frene): nº de sesión y de dónde sale (pack, suelta, sin pagar)
          if (!okF(q.desde)) return res.status(400).json({ ok: false });
          const hasta = okF(q.hasta) ? q.hasta : q.desde;
          const rows = await todosT(CIT, `filterByFormula=${encodeURIComponent(`AND({FECHA},NOT(IS_BEFORE({FECHA},DATETIME_PARSE('${q.desde}','YYYY-MM-DD'))),NOT(IS_AFTER({FECHA},DATETIME_PARSE('${hasta}','YYYY-MM-DD'))))`)}&fields[]=FECHA&fields[]=HORA&fields[]=ESTADO&fields[]=${encodeURIComponent('RELACIÓN - CITA')}`);
          const numSes = {}, pago = {}; let inicio = '';
          try {
            const pv = [...new Set(rows.map(r => (r.fields['RELACIÓN - CITA'] || [])[0]).filter(Boolean))];
            if (pv.length && pv.length <= 160) {
              const conPago = q.pago === '1'; // «Pack 3/10, Suelta, Sin pagar»: desactivado en el panel de momento
              inicio = conPago ? await inicioControl().catch(() => '') : '';
              global._sesPac = global._sesPac || {}; const C = global._sesPac, ahora = Date.now(), falta = pv.filter(id => !C[id] || ahora - C[id].t > 3 * 60e3);
              const grupos = []; for (let i = 0; i < falta.length; i += 15) grupos.push(falta.slice(i, i + 15));
              const sesDe = f => [[f['CONCEPTO 1'], f['Nº SESIONES 1'], f['PRECIO SESIÓN 1']], [f['CONCEPTO 2'], f['Nº SESIONES 2'], f['PRECIO SESIÓN 2']]].filter(([c, n]) => /^Sesi/i.test(nmA(c) || '') && Number(n) > 0).map(([c, n, pr]) => ({ n: Number(n), precio: Number(pr) || 0, concepto: nmA(c) }));
              for (let k = 0; k < grupos.length; k += 3) await Promise.all(grupos.slice(k, k + 3).map(async g => {
                const [rs, fs, ps] = await Promise.all([
                  todosT(CIT, `filterByFormula=${encodeURIComponent(`AND(OR(TRIM({ESTADO}&'')='REALIZADA',TRIM({ESTADO}&'')='PENDIENTE',TRIM({ESTADO}&'')='CITA PERDIDA'),OR(${g.map(id => `FIND('${id}',ARRAYJOIN({PacienteRec}))`).join(',')}))`)}&fields[]=FECHA&fields[]=HORA&fields[]=ESTADO&fields[]=PacienteRec`),
                  inicio ? todosT(FACTURAS_TABLE, `filterByFormula=${encodeURIComponent(`AND({ESTADO}='Emitida',OR(${g.map(id => `{PacienteId}='${id}'`).join(',')}))`)}`).catch(() => []) : Promise.resolve([]),
                  conPago ? todosT(PACIENTES, `filterByFormula=${encodeURIComponent('OR(' + g.map(id => `RECORD_ID()='${id}'`).join(',') + ')')}&fields[]=${encodeURIComponent('SESIONES BONO PREVIO')}&fields[]=${encodeURIComponent('BONO PREVIO YA USADAS')}`).catch(() => []) : Promise.resolve([])
                ]);
                const L = {}; g.forEach(id => L[id] = { citas: [], lotes: [] });
                rs.forEach(r => (r.fields['PacienteRec'] || []).forEach(id => { if (L[id]) L[id].citas.push({ id: r.id, k: String(r.fields.FECHA || '').slice(0, 10) + ' ' + hh(r.fields.HORA), e: String(nmA(r.fields.ESTADO)).trim().toUpperCase() }); }));
                ps.forEach(p => { const n = Number(p.fields['SESIONES BONO PREVIO'] || 0), u = Math.min(n, Number(p.fields['BONO PREVIO YA USADAS'] || 0)); if (L[p.id] && n - u > 0) L[p.id].lotes.push({ f: '', n: n - u, tot: n, off: u, precio: 0, previo: true }); });
                fs.sort((a, b) => String(a.fields['FECHA DE COBRO'] || a.fields['FECHA'] || '').localeCompare(String(b.fields['FECHA DE COBRO'] || b.fields['FECHA'] || ''))).forEach(r => { const id = r.fields['PacienteId']; if (!L[id]) return;
                  sesDe(r.fields).forEach(x => L[id].lotes.push({ f: r.fields['FECHA DE COBRO'] || r.fields['FECHA'] || '', n: x.n, precio: x.precio, num: r.fields['Nº FACTURA'] || '' })); });
                g.forEach(id => { L[id].citas.sort((a, b) => a.k.localeCompare(b.k)); C[id] = { t: ahora, v: L[id] }; }); }));
              rows.forEach(r => { const pid = (r.fields['RELACIÓN - CITA'] || [])[0]; if (!pid || !C[pid]) return; const e = String(nmA(r.fields['ESTADO'])).trim().toUpperCase();
                if (/CANCELADA|REPROGRAMADA|NO ASIST/.test(e)) return; const k = String(r.fields.FECHA || '').slice(0, 10) + ' ' + hh(r.fields.HORA);
                const V = C[pid].v; numSes[r.id] = V.citas.filter(x => x.k < k && x.e !== 'CITA PERDIDA').length + 1;
                if (!inicio || k.slice(0, 10) < inicio) return; // antes de empezar a cobrar desde el panel no se sabe
                // Se gastan los pagos por orden (primero el más antiguo) con las citas desde el inicio del control, en orden
                const gastan = V.citas.filter(x => x.k.slice(0, 10) >= inicio); let li = 0, usado = 0;
                for (const x of gastan) { while (li < V.lotes.length && usado >= V.lotes[li].n) { li++; usado = 0; }
                  if (x.id === r.id) { const lo = V.lotes[li];
                    pago[r.id] = !lo ? { t: 'sin', fut: e === 'PENDIENTE' && k.slice(0, 10) >= hoyF } : lo.previo ? { t: 'previo', i: usado + 1 + (lo.off || 0), n: lo.tot || lo.n } : lo.n > 1 ? { t: 'pack', i: usado + 1, n: lo.n, v: Math.round(lo.precio * 100) / 100 } : { t: 'suelta', v: lo.precio };
                    break; }
                  if (li < V.lotes.length) usado++; }
              });
            } } catch (e) { console.log('agenda-num', e.message); }
          return res.status(200).json({ ok: true, num: numSes, pago, inicio });
        }
        if (action === 'seg-agenda-pack') {
          // Al dar una cita: qué sesión del pack sería (mismo reparto que la agenda: los pagos se gastan por orden de fecha)
          if (!okId(q.pacienteId) || !okF(q.fecha)) return res.status(400).json({ ok: false });
          const inicio = await inicioControl().catch(() => '');
          if (!inicio) return res.status(200).json({ ok: true, activo: false });
          const hora = okH(q.hora) ? hh(q.hora) : '23:59', clave = q.fecha + ' ' + hora;
          const [rs, fs, pr] = await Promise.all([
            todosT(CIT, `filterByFormula=${encodeURIComponent(`AND(OR(TRIM({ESTADO}&'')='REALIZADA',TRIM({ESTADO}&'')='PENDIENTE',TRIM({ESTADO}&'')='CITA PERDIDA'),FIND('${q.pacienteId}',ARRAYJOIN({PacienteRec})),NOT(IS_BEFORE({FECHA},DATETIME_PARSE('${inicio}','YYYY-MM-DD'))))`)}&fields[]=FECHA&fields[]=HORA`),
            todosT(FACTURAS_TABLE, `filterByFormula=${encodeURIComponent(`AND({ESTADO}='Emitida',{PacienteId}='${q.pacienteId}')`)}`).catch(() => []),
            at(`${PACIENTES}/${q.pacienteId}?fields[]=${encodeURIComponent('SESIONES BONO PREVIO')}&fields[]=${encodeURIComponent('BONO PREVIO YA USADAS')}`).catch(() => ({}))
          ]);
          const lotes = [], P = pr.fields || {}, nP = Number(P['SESIONES BONO PREVIO'] || 0), uP = Math.min(nP, Number(P['BONO PREVIO YA USADAS'] || 0));
          if (nP - uP > 0) lotes.push({ n: nP - uP, tot: nP, off: uP, previo: true });
          fs.sort((a, b) => String(a.fields['FECHA DE COBRO'] || a.fields['FECHA'] || '').localeCompare(String(b.fields['FECHA DE COBRO'] || b.fields['FECHA'] || ''))).forEach(r => {
            [[r.fields['CONCEPTO 1'], r.fields['Nº SESIONES 1']], [r.fields['CONCEPTO 2'], r.fields['Nº SESIONES 2']]].forEach(([c, n]) => { if (/^Sesi/i.test(nmA(c) || '') && Number(n) > 0) lotes.push({ n: Number(n) }); }); });
          const claves = rs.map(c => String(c.fields.FECHA || '').slice(0, 10) + ' ' + hh(c.fields.HORA)).filter(k => k !== clave);
          claves.push(clave); claves.sort();
          let li = 0, usado = 0, out = { t: 'sin' };
          for (const k of claves) { while (li < lotes.length && usado >= lotes[li].n) { li++; usado = 0; }
            if (k === clave) { const lo = lotes[li]; out = !lo ? { t: 'sin' } : lo.n > 1 || lo.previo ? { t: 'pack', i: usado + 1 + (lo.off || 0), n: lo.tot || lo.n } : { t: 'suelta' }; break; }
            if (li < lotes.length) usado++; }
          const total = lotes.reduce((t, l) => t + l.n, 0);
          return res.status(200).json({ ok: true, activo: true, ...out, quedan: Math.max(0, total - claves.length) });
        }
        if (action === 'seg-agenda-recordatorios') {
          // Recordatorios por WhatsApp (en un toque): citas pendientes de las fechas pedidas, con teléfono y si ya se envió
          const fechas = String(q.fechas || '').split(',').filter(okF).slice(0, 4);
          if (!fechas.length) return res.status(400).json({ ok: false, error: 'Faltan las fechas' });
          const rows = await todosT(CIT, `filterByFormula=${encodeURIComponent(`AND(OR(${fechas.map(f => `DATETIME_FORMAT({FECHA},'YYYY-MM-DD')='${f}'`).join(',')}),FIND('PENDIENTE',UPPER({ESTADO}&'')))`)}&fields[]=FECHA&fields[]=HORA&fields[]=ESTADO&fields[]=PREF.&fields[]=${encodeURIComponent('RELACIÓN - CITA')}&fields[]=${encodeURIComponent('RECORDATORIO ENVIADO')}&fields[]=${encodeURIComponent('RECORDATORIO POR')}&fields[]=CONFIR`);
          const pids = [...new Set(rows.flatMap(r => r.fields['RELACIÓN - CITA'] || []))], pac = {};
          for (let i = 0; i < pids.length; i += 50) (await todosT(PACIENTES, `filterByFormula=${encodeURIComponent('OR(' + pids.slice(i, i + 50).map(x => `RECORD_ID()='${x}'`).join(',') + ')')}&fields[]=${encodeURIComponent('FULL NAME')}&fields[]=NOMBRE&fields[]=WHATSAPP&fields[]=TELF`)).forEach(p => { pac[p.id] = { nombre: p.fields['FULL NAME'] || '', pila: p.fields['NOMBRE'] || '', tel: p.fields['WHATSAPP'] || p.fields['TELF'] || '' }; });
          const nmR = v => (v && typeof v === 'object') ? (v.name || '') : (v || '');
          const citas = rows.map(r => { const F = r.fields, pid = (F['RELACIÓN - CITA'] || [])[0] || ''; return { id: r.id, fecha: String(F['FECHA'] || '').slice(0, 10), hora: String(F['HORA'] || '').replace(/^(\d):/, '0$1:').slice(0, 5), fisio: nmR(F['PREF.']), pacienteId: pid, ...(pac[pid] || { nombre: '', pila: '', tel: '' }), enviado: F['RECORDATORIO ENVIADO'] || '', por: F['RECORDATORIO POR'] || '', link: enlaceConfirmar(r.id), confirmada: (F['CONFIR'] || []).some(x => /CONFIRMADA/i.test(x.name || x)) }; })
            .filter(c => c.pacienteId).sort((a, b) => (a.fecha + a.hora).localeCompare(b.fecha + b.hora));
          return res.status(200).json({ ok: true, hoy: hoyF, citas });
        }
        if (action === 'seg-agenda-resenas') {
          // Pedir reseña en Google: pacientes con sesión realizada los últimos 7 días (o los ids pedidos), con si ya se les pidió / ya la dejaron
          const extra = String(q.ids || '').split(',').filter(okId).slice(0, 20);
          // solo=1: solo los pacientes pedidos (el buscador), con su última sesión; mucho más rápido
          const solo = q.solo && extra.length;
          const cs = await todosT(CIT, `filterByFormula=${encodeURIComponent(solo ? `AND(TRIM({ESTADO})='REALIZADA',NOT(IS_AFTER({FECHA},TODAY())),OR(${extra.map(x => `FIND('${x}',ARRAYJOIN({PacienteRec}))`).join(',')}))` : `AND(TRIM({ESTADO})='REALIZADA',IS_AFTER({FECHA},DATEADD(TODAY(),-8,'days')),NOT(IS_AFTER({FECHA},TODAY())))`)}&fields[]=FECHA&fields[]=PREF.&fields[]=${encodeURIComponent('RELACIÓN - CITA')}`);
          const ult = {}, nmR = v => (v && typeof v === 'object') ? (v.name || '') : (v || '');
          cs.forEach(c => { const pid = (c.fields['RELACIÓN - CITA'] || [])[0], f = String(c.fields['FECHA'] || '').slice(0, 10); if (pid && (!ult[pid] || f > ult[pid].fecha)) ult[pid] = { fecha: f, fisio: nmR(c.fields['PREF.']) }; });
          const pids = [...new Set([...Object.keys(ult), ...extra])], out = [];
          for (let i = 0; i < pids.length; i += 40) (await todosT(PACIENTES, `filterByFormula=${encodeURIComponent('OR(' + pids.slice(i, i + 40).map(x => `RECORD_ID()='${x}'`).join(',') + ')')}&fields[]=${encodeURIComponent('FULL NAME')}&fields[]=NOMBRE&fields[]=WHATSAPP&fields[]=TELF&fields[]=${encodeURIComponent('RESEÑA PEDIDA')}&fields[]=${encodeURIComponent('RESEÑA POSITIVA')}`)).forEach(p => {
            const F = p.fields; out.push({ pacienteId: p.id, nombre: F['FULL NAME'] || '', pila: F['NOMBRE'] || '', tel: F['WHATSAPP'] || F['TELF'] || '', pedida: F['RESEÑA PEDIDA'] || '', dejada: !!F['RESEÑA POSITIVA'], ultima: (ult[p.id] || {}).fecha || '', fisio: (ult[p.id] || {}).fisio || '', extra: !ult[p.id] }); });
          out.sort((a, b) => (b.ultima || '').localeCompare(a.ultima || '') || a.nombre.localeCompare(b.nombre));
          return res.status(200).json({ ok: true, hoy: hoyF, pacientes: out });
        }
        if (action === 'seg-agenda-encuestas') {
          // Encuesta de satisfacción: pacientes cuya PRIMERA sesión realizada fue ese día
          const fecha = okF(q.fecha) ? q.fecha : hoyF;
          const rows = await todosT(CIT, `filterByFormula=${encodeURIComponent(`AND(DATETIME_FORMAT({FECHA},'YYYY-MM-DD')='${fecha}',TRIM({ESTADO})='REALIZADA')`)}&fields[]=FECHA&fields[]=HORA&fields[]=PREF.&fields[]=${encodeURIComponent('RELACIÓN - CITA')}&fields[]=${encodeURIComponent('ENCUESTA ENVIADA')}`);
          const pids = [...new Set(rows.flatMap(r => r.fields['RELACIÓN - CITA'] || []))], antes = new Set(), pac = {};
          for (let i = 0; i < pids.length; i += 40) {
            const l = pids.slice(i, i + 40);
            const [ps, prev] = await Promise.all([
              todosT(PACIENTES, `filterByFormula=${encodeURIComponent('OR(' + l.map(x => `RECORD_ID()='${x}'`).join(',') + ')')}&fields[]=${encodeURIComponent('FULL NAME')}&fields[]=NOMBRE&fields[]=WHATSAPP&fields[]=TELF`),
              todosT(CIT, `filterByFormula=${encodeURIComponent(`AND(TRIM({ESTADO})='REALIZADA',IS_BEFORE({FECHA},DATETIME_PARSE('${fecha}','YYYY-MM-DD')),OR(${l.map(x => `FIND('${x}',ARRAYJOIN({PacienteRec}))`).join(',')}))`)}&fields[]=PacienteRec`)
            ]);
            ps.forEach(p => { pac[p.id] = { nombre: p.fields['FULL NAME'] || '', pila: p.fields['NOMBRE'] || '', tel: p.fields['WHATSAPP'] || p.fields['TELF'] || '' }; });
            prev.forEach(c => (c.fields['PacienteRec'] || []).forEach(x => antes.add(x)));
          }
          const nmE = v => (v && typeof v === 'object') ? (v.name || '') : (v || ''), vistos = new Set();
          const lista = rows.map(r => { const F = r.fields, pid = (F['RELACIÓN - CITA'] || [])[0] || ''; return { id: r.id, fecha, hora: String(F['HORA'] || '').replace(/^(\d):/, '0$1:').slice(0, 5), fisio: nmE(F['PREF.']), pacienteId: pid, ...(pac[pid] || { nombre: '', pila: '', tel: '' }), enviado: F['ENCUESTA ENVIADA'] || '' }; })
            .filter(c => c.pacienteId && !antes.has(c.pacienteId) && !vistos.has(c.pacienteId) && vistos.add(c.pacienteId)).sort((a, b) => a.hora.localeCompare(b.hora));
          return res.status(200).json({ ok: true, hoy: hoyF, fecha, citas: lista });
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
          const ausDia = okF(q.fecha) ? await ausenciasEn(q.fecha, q.fecha).catch(() => []) : [];

          return res.status(200).json({ ok: true, hoy: hoyF, limitado, ausencias: ausDia, alertas: alertasDia, sinConsent, espera: (esperaTodos || []).filter(e => e.estado === 'ESPERANDO').map(e => ({ id: e.id, tabla: e.tabla, nombre: e.nombre, tel: e.tel, dias: e.dias, franja: e.franja, horario: e.horario || '', nopuede: e.nopuede || '', ofrecido: e.ofrecido || '', fisio: e.fisio, disp: e.disp, nota: e.nota, fecha: e.fecha, pacienteId: e.pacienteId, aviso: e.aviso || '' })), citas: rows.map(r => { const F = r.fields; const pid = (F['RELACIÓN - CITA'] || [])[0] || ''; return { id: r.id, fecha: String(F['FECHA'] || '').slice(0, 10), hora: hh(F['HORA']), estado: String(nmA(F['ESTADO'])).trim(), fisio: nmA(F['PREF.']), pacienteId: pid, paciente: pid ? (nomP[pid] || '') : '', tipos: (F['TIPO DE CITA'] || []).map(t => nomT[t]).filter(Boolean), notas: F['NOTAS'] || '', confirmada: (F['CONFIR'] || []).some(x => /CONFIRMADA/.test(nmA(x))), app: /APP/.test(nmA(F['RESERVA'])), web: /WEB/.test(nmA(F['RESERVA'])) }; }) });
        }
        if (req.method !== 'POST') return res.status(405).json({ ok: false });
        if (action === 'seg-agenda-resena') { // apuntar que se le ha pedido la reseña en Google
          if (!okId(q.pacienteId)) return res.status(400).json({ ok: false });
          const d = await at(`${PACIENTES}/${q.pacienteId}`, { method: 'PATCH', body: JSON.stringify({ fields: { 'RESEÑA PEDIDA': q.enviado === false ? null : new Date().toISOString() } }) });
          return res.status(200).json({ ok: !d.error, error: d.error && d.error.message });
        }
        if (action === 'seg-agenda-encuesta') { // marcar que se ha enviado la encuesta de primera visita
          if (!okId(q.id)) return res.status(400).json({ ok: false });
          const d = await at(`${CIT}/${q.id}`, { method: 'PATCH', body: JSON.stringify({ fields: { 'ENCUESTA ENVIADA': q.enviado === false ? null : new Date().toISOString() } }) });
          return res.status(200).json({ ok: !d.error, error: d.error && d.error.message });
        }
        if (action === 'seg-agenda-alta') { // cancela y ya no necesita más sesiones: etiqueta ALTA y motivo apuntado (no sale en «sin próxima cita»)
          if (!okId(q.pacienteId)) return res.status(400).json({ ok: false });
          const est = await at(`tbldOsLe8iw78Wun7?fields[]=ESTADO&pageSize=100`), e = (est.records || []).find(r => /^ALTA$/i.test(String(r.fields['ESTADO'] || '').trim()));
          const pac = await at(`${PACIENTES}/${q.pacienteId}`); if (pac.error) return res.status(404).json({ ok: false, error: 'Paciente no encontrado' });
          const act = (pac.fields && pac.fields['ESTADO']) || [];
          const f = { 'POR QUÉ NO REAGENDA': String(q.nota || 'Alta: ya no necesita más sesiones').slice(0, 2000), 'POR QUÉ FECHA': hoyF, 'POR QUÉ FISIO': String(q.fisio || '').slice(0, 60) };
          if (e) f.ESTADO = [...new Set([...act, e.id])];
          const d = await at(`${PACIENTES}/${q.pacienteId}`, { method: 'PATCH', body: JSON.stringify({ fields: f }) });
          return res.status(200).json({ ok: !d.error, estados: f.ESTADO || act, error: d.error && d.error.message });
        }
        if (action === 'seg-agenda-recordatorio') { // marcar (o desmarcar) que se ha enviado el recordatorio de una o varias citas
          const ids = (Array.isArray(q.ids) ? q.ids : [q.id]).filter(okId).slice(0, 10); if (!ids.length) return res.status(400).json({ ok: false });
          const d = await at(CIT, { method: 'PATCH', body: JSON.stringify({ records: ids.map(id => ({ id, fields: { 'RECORDATORIO ENVIADO': q.enviado === false ? null : new Date().toISOString(), 'RECORDATORIO POR': q.enviado === false ? '' : String(q.por || '').slice(0, 40) } })) }) });
          return res.status(200).json({ ok: !d.error, error: d.error && d.error.message });
        }
        // Al dar cita: si estaba en «Por llamar» sale de la lista (se apunta como cita recuperada) y su etiqueta pasa a ACTIVO
        const salirDeSeguimiento = async (pid, quienTxt, fecha, hora) => {
          const abiertas = (await todosT(SEG, `filterByFormula=${encodeURIComponent(`AND(NOT({HECHO}),FIND('${pid}',ARRAYJOIN({PacRec})))`)}`).catch(() => [])).filter(r => (r.fields['PACIENTE'] || []).includes(pid));
          const est = await at(`tbldOsLe8iw78Wun7?fields[]=ESTADO&pageSize=100`); const E = {}; (est.records || []).forEach(x => { E[String(x.fields['ESTADO'] || '').trim().toUpperCase()] = x.id; });
          const pac = await at(`${PACIENTES}/${pid}?fields[]=ESTADO`); const act = (pac.fields && pac.fields['ESTADO']) || [];
          const QUITAR = ['SEGUIMIENTO', 'ABANDONO', 'PENDIENTE DE CONTINUAR', 'NO ACUDIÓ', 'ALTA'].map(n => E[n]).filter(Boolean);
          const enSeg = abiertas.length || act.some(id => QUITAR.includes(id));
          if (!enSeg) return null;
          const kq = String(quienTxt || '').trim().split(' ')[0].toLowerCase();
          const quien = ({ jonathan: 'JONY', jony: 'JONY', sara: 'SARA', ramiro: 'RAMIRO', nora: 'NORA', juan: 'JUAN' })[kq] || (kq ? kq.toUpperCase() : '');
          const [y, mo, d] = String(fecha).split('-');
          for (const r of abiertas) {
            const ll = { FECHA: new Date().toISOString(), PACIENTE: [pid], RESULTADO: 'CITA RECUPERADA ', NOTAS: `Cita dada desde la agenda para el ${d}/${mo} a las ${String(hora).slice(0, 5)}`, 'SEG ID': r.id };
            if (quien) ll['QUIEN LLAMA'] = quien;
            await at(LLA, { method: 'POST', body: JSON.stringify({ records: [{ fields: ll }], typecast: true }) });
            await at(`${SEG}/${r.id}`, { method: 'PATCH', body: JSON.stringify({ fields: { HECHO: true } }) });
          }
          const nuevo = [...new Set([...act.filter(id => !QUITAR.includes(id)), ...(E['ACTIVO'] ? [E['ACTIVO']] : [])])];
          const f = { 'POR QUÉ NO REAGENDA': '', 'POR QUÉ FECHA': null, 'POR QUÉ FISIO': '' };
          if (nuevo.join() !== act.join()) f.ESTADO = nuevo;
          await at(`${PACIENTES}/${pid}`, { method: 'PATCH', body: JSON.stringify({ fields: f }) });
          return { quitado: abiertas.length, estados: nuevo };
        };
        if (action === 'seg-agenda-dar') { global._sesPac = {}; // dar cita en una hora (o en un hueco libre concreto)
          if (!okId(q.pacienteId) || !okF(q.fecha) || !okH(q.hora) || !q.fisio) return res.status(400).json({ ok: false, error: 'Faltan datos' });
          const campos = { ESTADO: 'PENDIENTE ', 'RELACIÓN - CITA': [q.pacienteId] };
          if (q.notas) campos.NOTAS = String(q.notas).slice(0, 2000);
          if (q.tipos && q.tipos.length) campos['TIPO DE CITA'] = await tiposDe(q.tipos);
          const r = await ocupar(q.fecha, q.hora, q.fisio, campos, !!q.forzar);
          if (r.conflicto) return res.status(200).json({ ok: false, conflicto: true, error: `A esa hora ${q.fisio} ya tiene a ${r.con || 'otro paciente'}` });
          const rep = await revisarPorReagendar(true).catch(() => 0);
          const seg = await salirDeSeguimiento(q.pacienteId, q.quien, q.fecha, q.hora).catch(() => null);
          return res.status(200).json({ ok: true, id: r.id, reprogramadas: rep, seguimiento: seg });
        }
        if (action === 'seg-agenda-huecos') { // abrir varias horas de golpe (libres o bloqueadas), sin pisar lo que ya hay
          const fechas = (q.fechas || []).filter(okF).slice(0, 60), horas = (q.horas || []).map(hh).filter(okH).slice(0, 24);
          if (!q.fisio || !fechas.length || !horas.length || !/^(CITA LIBRE|LIBRE - SIN BOMBA|CITA BLOQUEADA|DIA BLOQUEADO|FRANJA BLOQUEADA)$/.test(q.estado || '')) return res.status(400).json({ ok: false, error: 'Faltan datos' });
          const nuevos = []; let saltadas = 0, ausentes = 0;
          const libre = /LIBRE/.test(q.estado), ausL = libre ? await ausenciasEn(fechas.slice().sort()[0], fechas.slice().sort().slice(-1)[0]).catch(() => []) : [];
          const p2h = x => { const m = String(x || '').match(/^(\d{1,2}):(\d{2})$/); return m ? m[1].padStart(2, '0') + ':' + m[2] : x; };
          for (const f of fechas) {
            const ausF = ausL.filter(a => a.desde <= f && a.hasta >= f && (a.fisio === 'Toda la clínica' || a.fisio.toLowerCase() === String(q.fisio).toLowerCase()));
            const rows = await delDia(f);
            for (const h of horas) {
              if (ausF.some(a => { if (!a.hd) return true; const dentro = p2h(h) >= a.hd && p2h(h) < a.hh; return a.tipo === 'Cambio de horario' ? !dentro : dentro; })) { ausentes++; continue; }
              const ya = enHora(rows, h, q.fisio).some(r => !/CANCELADA|REPROGRAMADA|CITA PERDIDA/.test(String(nmA(r.fields['ESTADO']))));
              if (ya) { saltadas++; continue; }
              nuevos.push({ fields: { FECHA: f, HORA: h, 'PREF.': q.fisio, ESTADO: q.estado, ...(q.notas ? { NOTAS: String(q.notas) } : {}) } });
            }
          }
          for (let i = 0; i < nuevos.length; i += 10) { const d = await at(CIT, { method: 'POST', body: JSON.stringify({ records: nuevos.slice(i, i + 10), typecast: true }) }); if (d.error) throw new Error(d.error.message || 'No se han podido crear'); }
          return res.status(200).json({ ok: true, creadas: nuevos.length, saltadas, ausentes });
        }
        if (action === 'seg-agenda-hueco') { // dejar una hora libre (para la app), bloqueada, etc.
          if (!okF(q.fecha) || !okH(q.hora) || !q.fisio || !/^(CITA LIBRE|LIBRE - SIN BOMBA|CITA BLOQUEADA|FRANJA BLOQUEADA|DIA BLOQUEADO|CALL-IN|COMIDA|VIDEOS)$/.test(q.estado || '')) return res.status(400).json({ ok: false, error: 'Datos no válidos' });
          const r = await nueva(q.fecha, q.hora, q.fisio, { ESTADO: q.estado === 'COMIDA' ? await estadoComida() : q.estado, ...(q.notas ? { NOTAS: String(q.notas) } : {}) }); return res.status(200).json({ ok: true, id: r.id });
        }
        if (action === 'seg-agenda-editar') { global._sesPac = {}; // estado, confirmada, notas, etiquetas; opcional dejar el hueco libre
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
        if (action === 'seg-agenda-mover') { global._sesPac = {}; // cambiar día/hora/fisio: la original queda REPROGRAMADA y se da la nueva
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
      // Ingresos desde el principio (tabla ESTADISTICAS SEMANA, una cifra por semana)
      if (action === 'seg-gasto-guardar') { // gasto apuntado a mano (no pasa por el banco de la SL)
        const v = Math.round(Number(String(q.importe || '').replace(',', '.')) * 100) / 100;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(q.fecha || '') || !(v > 0) || !String(q.concepto || '').trim()) return res.status(400).json({ ok: false, error: 'Faltan datos' });
        const f = { CONCEPTO: String(q.concepto).trim().slice(0, 200), FECHA: q.fecha, IMPORTE: v, 'PAGADO CON': String(q.pagado || 'Otro').slice(0, 40), NOTA: String(q.nota || '').slice(0, 2000) };
        if (!q.id) f['REGISTRADO POR'] = String(q.por || '').slice(0, 60);
        const d = /^rec[A-Za-z0-9]{14}$/.test(q.id || '') ? await at(`${OTROS_G}/${q.id}`, { method: 'PATCH', body: JSON.stringify({ fields: f, typecast: true }) }) : await at(OTROS_G, { method: 'POST', body: JSON.stringify({ records: [{ fields: f }], typecast: true }) });
        return res.status(200).json({ ok: !d.error, error: d.error && d.error.message });
      }
      if (action === 'seg-gasto-borrar') {
        if (!/^rec[A-Za-z0-9]{14}$/.test(q.id || '')) return res.status(400).json({ ok: false });
        const d = await at(`${OTROS_G}/${q.id}`, { method: 'DELETE' }); return res.status(200).json({ ok: !d.error });
      }
      if (action === 'seg-gastos') {
        if (!HOLDED_KEY) return res.status(200).json({ ok: false, error: 'Falta la clave de Holded' });
        try { const b = await gastosBancoMeses(); if (b.error) throw new Error(b.error);
          // Se suman los gastos apuntados a mano (efectivo, otras tarjetas…)
          const g = {}, lista = {}; (b.meses || []).forEach(x => { g[x.m] = x.v; }); Object.entries(b.lista || {}).forEach(([k, L]) => { lista[k] = L.slice(); });
          const otros = await todosT(OTROS_G, 'sort[0][field]=FECHA&sort[0][direction]=desc').catch(() => []);
          otros.forEach(r => { const F = r.fields, f = String(F['FECHA'] || '').slice(0, 10), v = Number(F['IMPORTE'] || 0); if (!f || !v) return; const k = f.slice(0, 7);
            g[k] = Math.round(((g[k] || 0) + v) * 100) / 100; (lista[k] = lista[k] || []).push({ id: r.id, f, v, t: F['CONCEPTO'] || '', man: (F['PAGADO CON'] && F['PAGADO CON'].name) || F['PAGADO CON'] || 'Otro', nota: F['NOTA'] || '', por: F['REGISTRADO POR'] || '' }); });
          return res.status(200).json(Object.assign({ ok: true }, b, { meses: Object.entries(g).map(([m, x]) => ({ m, v: x })).sort((a, c) => a.m.localeCompare(c.m)), lista })); }
        catch (e) { _gasH = { t: 0, v: null }; return res.status(200).json({ ok: false, error: /40[13]/.test(e.message) ? 'la clave de Holded todavía no tiene permiso para leer las cuentas bancarias' : e.message }); }
      }
      if (action === 'seg-ingresos-todo') {
        const rs = await todosT('tblE7NWfZmxcou5mV', `filterByFormula=${encodeURIComponent('{INGRESOS}!=BLANK()')}&fields[]=SEMANA&fields[]=INGRESOS&sort[0][field]=SEMANA&sort[0][direction]=asc`);
        // Meses: los de la base ESTADISTICAS (INCOME / MONTH), y si no se puede leer, la copia INGRESOS MES de esta base
        let ms = [], fuente = 'ESTADISTICAS';
        try { const r = await fetch(`https://api.airtable.com/v0/appR5HDJuhjQG504R/tbloIpGtMu3QVOqoU?pageSize=100`, { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } }); const d = await r.json(); if (d.error) throw 0; ms = (d.records || []).map(x => ({ m: String(x.fields['MES'] || '').slice(0, 7), v: Number(x.fields['IMPORTE'] || 0) })); }
        catch (e) { fuente = 'INGRESOS MES'; ms = (await todosT('tblSJPZroRyyWphVp', 'fields[]=MES&fields[]=IMPORTE').catch(() => [])).map(x => ({ m: String(x.fields['MES'] || '').slice(0, 7), v: Number(x.fields['IMPORTE'] || 0) })); }
        ms = ms.filter(x => x.m && x.v).sort((a, b) => a.m.localeCompare(b.m));
        // Desde octubre 2026 los meses salen de Holded (tickets de venta del mes, lunes a domingo da igual aquí: mes natural)
        let holdedMeses = [];
        if (HOLDED_KEY) try { const dias = await ingresosHoldedDias(HOLDED_DESDE, hoyF); const g = {};
          Object.entries(dias).forEach(([f, v]) => { g[f.slice(0, 7)] = (g[f.slice(0, 7)] || 0) + v; });
          holdedMeses = Object.entries(g).map(([m, v]) => ({ m, v: Math.round(v * 100) / 100 })); } catch (e) {}
        ms = ms.filter(x => x.m < HOLDED_DESDE.slice(0, 7)).concat(holdedMeses).sort((a, b) => a.m.localeCompare(b.m));
        return res.status(200).json({ ok: true, fuente, meses: ms, semanas: rs.map(r => ({ s: String(r.fields['SEMANA'] || '').slice(0, 10), v: Number(r.fields['INGRESOS'] || 0) })).filter(x => x.s) });
      }
      // Cómo nos han conocido: respuestas del formulario de primera visita (CONSENTIMIENTOS) en el periodo
      if (action === 'seg-conocido') {
        const desde = /^\d{4}-\d{2}-\d{2}$/.test(q.desde || '') ? q.desde : '2000-01-01';
        const rs = await todosT(CONS_T, `filterByFormula=${encodeURIComponent(`AND(NOT({IGNORAR}),NOT(IS_BEFORE({Creada},'${desde}')))`)}&fields[]=CONOCIDO`);
        const cnt = {}; rs.forEach(r => { const v = String(cNm(r.fields['CONOCIDO']) || '').trim() || 'Sin respuesta'; cnt[v] = (cnt[v] || 0) + 1; });
        return res.status(200).json({ ok: true, total: rs.length, datos: Object.entries(cnt).map(([k, n]) => ({ k, n })).sort((a, b) => (a.k === 'Sin respuesta') - (b.k === 'Sin respuesta') || b.n - a.n) });
      }
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
        const fisT = await todosT(FISIOS_TABLE, `fields[]=Name&fields[]=${encodeURIComponent('HORAS SEMANA')}&fields[]=${encodeURIComponent('HORAS POR DÍA')}&fields[]=Role&fields[]=${encodeURIComponent('FECHA BAJA')}`).catch(() => []);
        // Equipo = fisios con horario (Administración); si no se puede leer, los de siempre
        const eqH = fisT.filter(f => !f.fields['FECHA BAJA'] && String(f.fields.Role || 'fisio').toLowerCase() === 'fisio' && (f.fields['HORAS POR DÍA'] || Number(f.fields['HORAS SEMANA']) > 0)).map(f => String(f.fields.Name || '').split(' ')[0].toLowerCase()).filter(Boolean);
        const EQUIPO = eqH.length ? eqH : ['jonathan', 'sara', 'juan'], DSEM = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
        const horario = {}; fisT.forEach(f => { const k = String(f.fields.Name || '').split(' ')[0].toLowerCase(); if (!EQUIPO.includes(k)) return; const h = {};
          String(f.fields['HORAS POR DÍA'] || '').split('\n').forEach(l => { const m = l.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().match(/(lunes|martes|miercoles|jueves|viernes|sabado|domingo)\D*(\d+(?:[.,]\d+)?)/); if (m) h[DSEM.indexOf(m[1])] = +m[2].replace(',', '.'); });
          if (!Object.keys(h).length && +f.fields['HORAS SEMANA']) [1, 2, 3, 4, 5].forEach(d => h[d] = +f.fields['HORAS SEMANA'] / 5);
          horario[k] = h; });
        const trabaja = new Set(C.filter(c => !/DIA BLOQUEADO/.test(c.e) && (c.pid || /LIBRE|PENDIENTE|REALIZADA/.test(c.e))).map(c => String(c.fisio).toLowerCase() + '|' + c.f));
        let diasH = {}; if (HOLDED_KEY && hasta >= HOLDED_DESDE) diasH = await ingresosHoldedDias(HOLDED_DESDE, hoyF).catch(() => ({}));
        const ingH = a => { if (a < HOLDED_DESDE || !HOLDED_KEY) return undefined; let t = 0; for (let d = 0; d < 7; d++) t += diasH[mv(a, d)] || 0; return Math.round(t * 100) / 100; };
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
            ingresos: ingH(a) !== undefined ? ingH(a) : (m && m.fields.INGRESOS != null ? m.fields.INGRESOS : null), ingresosHolded: ingH(a) !== undefined, resenas: m && m.fields['RESEÑAS GOOGLE'] != null ? m.fields['RESEÑAS GOOGLE'] : null, quejas: m && m.fields.QUEJAS != null ? m.fields.QUEJAS : null, notas: m ? (m.fields.NOTAS || '') : '' });
        }
        const nombres = {}; { const ids = [...usados]; const lt = []; for (let i = 0; i < ids.length; i += 50) lt.push(ids.slice(i, i + 50));
          for (let i = 0; i < lt.length; i += 4) (await Promise.all(lt.slice(i, i + 4).map(t => todosT(PACIENTES, `filterByFormula=${encodeURIComponent('OR(' + t.map(x => `RECORD_ID()='${x}'`).join(',') + ')')}&fields[]=FULL%20NAME`).catch(() => [])))).forEach(rs => rs.forEach(r => nombres[r.id] = r.fields['FULL NAME'] || '')); }
        const data = { ok: true, hoy: hoyF, semanas, nombres };
        global._estCache = { key, t: Date.now(), data }; (global._estCaches = global._estCaches || {})[key] = global._estCache;
        return res.status(200).json(data);
      }
      if (action === 'seg-lista') {
        // Una sola vez: pacientes de la tabla de llamadas antigua que se quedaron a medias (pendiente de respuesta, volver a llamar, no contesta)
        // y no están en «Por llamar» ni han vuelto a tener cita → se ponen en «Por llamar» para hoy
        if (!(await ajuste('RESCATE_LLAMADAS_V1', null))) { try {
          const todas = await todosT(LLA, `fields[]=FECHA&fields[]=RESULTADO&fields[]=PACIENTE&fields[]=NOTAS&fields[]=QUIEN LLAMA&fields[]=SEG ID`);
          const ult = {}; todas.forEach(r => { const pid = (r.fields['PACIENTE'] || [])[0]; const f = String(r.fields['FECHA'] || ''); if (!pid || !f) return; if (!ult[pid] || f > String(ult[pid].fields['FECHA'])) ult[pid] = r; });
          const abiertos = new Set((await todosT(SEG, `filterByFormula=${encodeURIComponent('NOT({HECHO})')}&fields[]=PACIENTE`)).flatMap(r => r.fields['PACIENTE'] || []));
          const nmR = v => String((v && typeof v === 'object' ? v.name : v) || '').toUpperCase();
          let cand = Object.entries(ult).filter(([pid, r]) => /PENDIENTE|^VOLVER|^NC/.test(nmR(r.fields['RESULTADO'])) && !abiertos.has(pid));
          const conCita = new Set(), ids = cand.map(c => c[0]);
          for (let i = 0; i < ids.length; i += 30) { const lote = ids.slice(i, i + 30);
            const cs = await todosT(CIT, `filterByFormula=${encodeURIComponent(`AND(IS_AFTER({FECHA},'2026-08-01'),OR(${lote.map(id => `FIND('${id}',ARRAYJOIN({PacienteRec}))`).join(',')}))`)}&fields[]=FECHA&fields[]=ESTADO&fields[]=RELACIÓN - CITA`);
            cs.forEach(c => { const est = nmR(c.fields['ESTADO']); if (!/REALIZADA|PENDIENTE|CONFIRMADA/.test(est)) return; (c.fields['RELACIÓN - CITA'] || []).forEach(pid => { const r = ult[pid]; if (r && String(c.fields['FECHA'] || '') > String(r.fields['FECHA']).slice(0, 10)) conCita.add(pid); }); }); }
          cand = cand.filter(([pid]) => !conCita.has(pid));
          const RT = r => { const x = nmR(r); return /PENDIENTE/.test(x) ? 'Pendiente de respuesta' : /^NC/.test(x) ? 'No contesta' : 'Volver a llamar'; };
          for (let i = 0; i < cand.length; i += 10) { const lote = cand.slice(i, i + 10);
            const c = await at(SEG, { method: 'POST', body: JSON.stringify({ typecast: true, records: lote.map(([pid, r]) => { const f = String(r.fields['FECHA']).slice(0, 10).split('-');
              return { fields: { 'FECHA DE LLAMADA': hoyF, PACIENTE: [pid], NOTAS: `Recuperado de las llamadas antiguas. Última llamada (${f[2]}/${f[1]}): ${RT(r.fields['RESULTADO'])}${r.fields['NOTAS'] ? ' — ' + r.fields['NOTAS'] : ''}` } }; }) }) });
            if (c.error) throw new Error(c.error.message);
            // La llamada antigua queda enlazada a su nueva fila, para que salga como «Última llamada»
            await at(LLA, { method: 'PATCH', body: JSON.stringify({ records: c.records.map((n, k) => ({ id: lote[k][1].id, fields: { 'SEG ID': n.id } })) }) });
          }
          await guardarAjuste('RESCATE_LLAMADAS_V1', { fecha: hoyF, rescatados: cand.length, yaConCita: conCita.size }, 'panel');
        } catch (e) { console.error('rescate llamadas', e.message); } }
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
            let deNegocio = null;
            if (vino && !(vino.fields['RECOMENDÓ'] || []).length) { const negs = await todosT(CAP.negocio, `filterByFormula=${encodeURIComponent('{10% A SUS CLIENTES}')}&fields[]=NOMBRE`).catch(() => []);
              const t = capNorm(vino.fields['Nombre de quien recomendó']), ng = negs.find(n => (vino.fields['NEGOCIO'] || []).includes(n.id) || capNorm(n.fields['NOMBRE']).split(/[^a-z0-9]+/).filter(w => w.length >= 4 && !CAP_STOP.test(w)).some(w => t.includes(w)));
              if (ng) deNegocio = { nombre: ng.fields['NOMBRE'] || '' }; }
            referidos = { deNegocio, leRecomendo: vino ? { id: (vino.fields['RECOMENDÓ'] || [])[0] || '', nombre: nom[(vino.fields['RECOMENDÓ'] || [])[0]] || String(vino.fields['Nombre de quien recomendó'] || '').trim() } : null,
              haRecomendado: rr.filter(r => (r.fields['RECOMENDÓ'] || []).includes(q.id)).map(r => ({ id: r.id, nombre: nom[(r.fields['PACIENTE'] || [])[0]] || `${r.fields['Nombre'] || ''} ${r.fields['Apellidos'] || ''}`.trim(), fecha: r.fields['Fecha'] || '', codigo: r.fields['CÓDIGO'] || '', caduca: r.fields['CADUCA'] || '', canjeada: r.fields['CANJEADA'] || '', fechaTarjeta: r.fields['FECHA TARJETA'] || '', ignorar: !!r.fields['IGNORAR'], ganada: !r.fields['CÓDIGO'] && !r.fields['IGNORAR'] && vinieron.has((r.fields['PACIENTE'] || [])[0]) })) }; } }
        return res.status(200).json({ ok: true, hoy: hoyF, saldo, consent, referidos,
          paciente: { id: pac.id, pin: F['PIN'] || '', nombre: F['FULL NAME'] || '', tel: F['WHATSAPP'] || F['TELF'] || '', telf: F['TELF'] || '', whatsapp: F['WHATSAPP'] || '', pin: F['PIN'] || '', email: F['EMAIL'] || '', dni: F['DNI'] || '', cumple: F['CUMPLE'] || '', telDescartado: F['TELF FORM DESCARTADO'] || '', foto: (((F['FOTO PERFIL'] || [])[0] || {}).thumbnails || {}).large ? F['FOTO PERFIL'][0].thumbnails.large.url : (((F['FOTO PERFIL'] || [])[0] || {}).url || ''), ultimoAcceso: F['ÚLTIMO ACCESO APP'] || '', appUsada: !!(F['ÚLTIMO ACCESO APP'] || F['PushSubscription']), alta: pac.createdTime || '', estados: F['ESTADO'] || [],
            motivo: F['MOTIVO DE VISITA'] || '', historial: F['HISTORIAL CLÍNICO'] || '', historialMod: F['HISTORIAL ACTUALIZADO'] || '', notas: F['NOTAS'] || '', porQue: F['POR QUÉ NO REAGENDA'] || '', porQueFecha: F['POR QUÉ FECHA'] || '', porQueFisio: F['POR QUÉ FISIO'] || '', bonoPrevio: F['SESIONES BONO PREVIO'] || 0, colab: F['COLAB'] || '', resena: !!F['RESEÑA POSITIVA'],
            archivos: (F['DOCUS'] || []).map(a => ({ nombre: a.filename || 'archivo', url: a.url, tipo: a.type || '', tam: a.size || 0, mini: (a.thumbnails && ((a.thumbnails.large && a.thumbnails.large.url) || (a.thumbnails.small && a.thumbnails.small.url))) || '' })) },
          citas: citas.map(c => ({ id: c.id, fecha: String(c.fields['FECHA'] || '').slice(0, 10), hora: c.fields['HORA'] || '', estado: String(nm(c.fields['ESTADO'])).trim(), fisio: nm(c.fields['PREF.']), nota: c.fields['NOTAS'] || '' })),
          seguimiento: segs.map(r => ({ id: r.id, fecha: r.fields['FECHA DE LLAMADA'] || '', nota: r.fields['NOTAS'] || '', hecho: !!r.fields['HECHO'], quien: nm(r.fields['RESPONSABLE']) })),
          llamadas: llams.map(r => { const d = diaMad(r.fields['FECHA']); return { fecha: d.f, hora: d.h, quien: nm(r.fields['QUIEN LLAMA']), resultado: String(nm(r.fields['RESULTADO'])).trim(), nota: r.fields['NOTAS'] || '', resena: !!r.fields['RESEÑA'] }; }) });
      }
      // ── PROTOCOLO DE NO MEJORA («Sin evolución»): un caso por fila en ⚙ APP · SIN EVOLUCIÓN ──
      if (action.startsWith('seg-sinevo')) {
        const SEV = 'tbl0OR8AfBuvWyhTo', TAR = 'tblIXYE5ToRNY7MN4', okId = x => /^rec[A-Za-z0-9]{14}$/.test(x || '');
        if (action === 'seg-sinevo-lista') {
          // Para Tareas: casos abiertos (el fisio todavía no ha decidido cómo seguir)
          const rs = await todosT(SEV, `filterByFormula=${encodeURIComponent(`{ESTADO}='Abierto'`)}&fields[]=PACIENTE&fields[]=FISIO&fields[]=FECHA`);
          const pids = [...new Set(rs.map(r => (r.fields['PACIENTE'] || [])[0]).filter(Boolean))], nom = {};
          if (pids.length) (await todosT(PACIENTES, `filterByFormula=${encodeURIComponent('OR(' + pids.slice(0, 80).map(x => `RECORD_ID()='${x}'`).join(',') + ')')}&fields[]=FULL NAME`)).forEach(p => { nom[p.id] = p.fields['FULL NAME'] || '—'; });
          return res.status(200).json({ ok: true, casos: rs.map(r => { const p = (r.fields['PACIENTE'] || [])[0] || ''; return { id: r.id, pacienteId: p, nombre: nom[p] || '—', fisio: r.fields['FISIO'] || '', fecha: r.fields['FECHA'] || hoyF }; }).filter(c => c.pacienteId) });
        }
        const pid = q.id || q.pacienteId;
        if (!okId(pid)) return res.status(400).json({ ok: false, error: 'Paciente no válido' });
        const nmS = v => (v && typeof v === 'object' && !Array.isArray(v)) ? (v.name || '') : (v || '');
        const vistaCaso = r => { const F = r.fields || {}; let datos = {}; try { datos = JSON.parse(F['DATOS'] || '{}'); } catch (e) {}
          return { id: r.id, fecha: F['FECHA'] || '', fisio: F['FISIO'] || '', estado: nmS(F['ESTADO']) || 'Abierto', datos, informe: F['INFORME'] || '', decision: nmS(F['DECISIÓN']), nota: F['NOTA DECISIÓN'] || '', fechaDecision: F['FECHA DECISIÓN'] || '',
            decididoPor: F['DECIDIDO POR'] || '', sesDecidir: F['SESIONES AL DECIDIR'] ?? null, revisarTras: F['REVISAR TRAS'] || 3, resultado: nmS(F['RESULTADO']), fechaCierre: F['FECHA CIERRE'] || '' }; };
        const casosDe = async () => (await todosT(SEV, `filterByFormula=${encodeURIComponent(`FIND('${pid}',ARRAYJOIN({PACIENTE}))`)}&sort[0][field]=FECHA&sort[0][direction]=desc`)).filter(r => (r.fields['PACIENTE'] || []).includes(pid));
        // Etiqueta «SIN EVOLUCIÓN» del paciente (se busca por nombre en ⚙ APP · ESTADOS DEL PACIENTE)
        const etiqueta = async (poner) => {
          const est = await at(`tbldOsLe8iw78Wun7?fields[]=ESTADO&pageSize=100`);
          const e = (est.records || []).find(r => /SIN EVOLUCI/i.test(String(r.fields['ESTADO'] || ''))); if (!e) return null;
          const pac = await at(`${PACIENTES}/${pid}?fields[]=ESTADO`); const act = (pac.fields && pac.fields['ESTADO']) || [];
          const nuevo = poner ? [...new Set([...act, e.id])] : act.filter(x => x !== e.id);
          if (nuevo.length !== act.length) await at(`${PACIENTES}/${pid}`, { method: 'PATCH', body: JSON.stringify({ fields: { ESTADO: nuevo } }) });
          return nuevo;
        };
        if (action === 'seg-sinevo') {
          // Datos que se rellenan solos: anamnesis de la app, ejercicios asignados y si los hace (días marcados en la app)
          const [casos, infs, plan, hechos, citasM, saldo] = await Promise.all([
            casosDe(),
            todosT(INFORMES_TABLE, `filterByFormula=${encodeURIComponent(`{PacienteId}='${pid}'`)}&fields[]=Protocolo&fields[]=Fecha&fields[]=FisioNombre&fields[]=Informe`).catch(() => []),
            at(`${PLAN_TABLE}?filterByFormula=${encodeURIComponent(`{PacienteID}='${pid}'`)}&sort[0][field]=FechaAsignacion&sort[0][direction]=desc&maxRecords=1`).catch(() => ({})),
            todosT(TAR, `filterByFormula=${encodeURIComponent(`AND({PacienteId}='${pid}',IS_AFTER(DATETIME_PARSE({Fecha},'YYYY-MM-DD'),DATEADD(TODAY(),-60,'days')))`)}&fields[]=Fecha`).catch(() => []),
            todosT(CIT, `filterByFormula=${encodeURIComponent(`AND(FIND('${pid}',ARRAYJOIN({PacienteRec})),OR({motivo}!='',{your-message}!=''))`)}&fields[]=FECHA&fields[]=motivo&fields[]=your-message&sort[0][field]=FECHA&sort[0][direction]=asc`).catch(() => []),
            saldoPaciente(pid).catch(() => ({ activo: false }))
          ]);
          // Qué le ocurre y diagnóstico: del informe de anamnesis más reciente (si lo hay) o de lo que escribió al reservar
          const fx = t => { const m = String(t || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/); return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : ''; };
          const anaTxt = infs.filter(r => !/sin evoluci/i.test(String(r.fields['Protocolo'] || '')) && r.fields['Informe']).sort((a, b) => fx(b.fields['Fecha']).localeCompare(fx(a.fields['Fecha'])))[0];
          const seccion = (t, nom) => { const L = String(t || '').replace(/\r/g, '').split('\n'); const i = L.findIndex(l => new RegExp('^[#*\\s]*' + nom, 'i').test(l.trim())); if (i < 0) return '';
            const out = []; for (let k = i + 1; k < L.length; k++) { const l = L[k].trim(); if (/^[#*\s]*[A-ZÁÉÍÓÚÑ ]{6,}[*:]*$/.test(l)) break; out.push(l.replace(/^[-*•]\s*/, '').replace(/\*\*/g, '')); } return out.join(' ').replace(/\s+/g, ' ').trim(); };
          const motivoAna = anaTxt ? seccion(anaTxt.fields['Informe'], 'MOTIVO DE CONSULTA') : '';
          const dxAna = anaTxt ? seccion(anaTxt.fields['Informe'], 'DIAGN[ÓO]STICO FISIOTERAP') : '';
          const cm = citasM[0] ? String(citasM[0].fields['motivo'] || citasM[0].fields['your-message'] || '').trim() : '';
          const anamnesis = infs.map(r => ({ protocolo: String(r.fields['Protocolo'] || '').trim(), fecha: r.fields['Fecha'] || '', fisio: r.fields['FisioNombre'] || '' }))
            .filter(a => a.protocolo && !/sin evoluci/i.test(a.protocolo));
          const pl = ((plan.records || [])[0] || {}).fields || {};
          let ejs = []; try { ejs = JSON.parse(pl['Ejercicios'] || '[]'); } catch (e) {}
          const ejercicios = ejs.filter(x => x && x.nombre).map(x => ({ nombre: String(x.nombre).trim(), series: parseInt(x.series) || 0, reps: parseInt(x.reps) || 0, dur: parseInt(x.duracion) || 0 }));
          const dias = [...new Set(hechos.map(r => String(r.fields['Fecha'] || '').slice(0, 10)).filter(Boolean))].sort();
          const desdeD = n => { const x = new Date(hoyF + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() - n); return x.toISOString().slice(0, 10); };
          // Adherencia: días con los ejercicios hechos en las últimas 2 semanas (o desde que se le asignó el plan, si es más reciente)
          const asign = pl['FechaAsignacion'] || '', ini = asign && asign > desdeD(13) ? asign : desdeD(13);
          const ventana = Math.max(1, Math.round((new Date(hoyF) - new Date(ini)) / 864e5) + 1);
          const enVentana = dias.filter(f => f >= ini && f <= hoyF).length;
          return res.status(200).json({ ok: true, hoy: hoyF, casos: casos.map(vistaCaso),
            auto: { anamnesis, ejercicios, motivo: (motivoAna || cm).slice(0, 600), dxFisio: dxAna.slice(0, 600), saldo, planFecha: asign, planFisio: pl['FisioNombre'] || '',
              adherencia: { dias: enVentana, de: ventana, desde: ini, ultimo: dias[dias.length - 1] || '', pct: ejercicios.length ? Math.round(enVentana / ventana * 100) : null } } });
        }
        if (req.method !== 'POST') return res.status(405).json({ ok: false });
        const hoyIso = hoyF;
        if (action === 'seg-sinevo-guardar') {
          // Crea o actualiza el caso con el formulario y el informe; pone la etiqueta y lo guarda también en Informes (solo para el equipo)
          const datos = q.datos && typeof q.datos === 'object' ? q.datos : {};
          const informe = String(q.informe || '').slice(0, 20000);
          const nombre = String(q.nombre || '').trim();
          let casoId = okId(q.casoId) ? q.casoId : '';
          if (casoId) { const cur = await at(`${SEV}/${casoId}`); if (cur.error || !(cur.fields['PACIENTE'] || []).includes(pid)) return res.status(404).json({ ok: false, error: 'Caso no encontrado' });
            let prev = {}; try { prev = JSON.parse(cur.fields['DATOS'] || '{}'); } catch (e) {} if (prev._inf && !datos._inf) datos._inf = prev._inf; }
          // Informe en ⚙ APP · INFORMES (SoloFisio: el paciente no lo ve en su app)
          const infCampos = { Informe: informe };
          const infR = okId(datos._inf) ? await at(`${INFORMES_TABLE}/${datos._inf}`, { method: 'PATCH', body: JSON.stringify({ fields: infCampos }) })
            : await at(INFORMES_TABLE, { method: 'POST', body: JSON.stringify({ records: [{ fields: { ...infCampos, PacienteId: pid, PacienteNombre: nombre.toUpperCase(), FisioNombre: String(q.fisio || ''), Fecha: new Date().toLocaleDateString('es-ES', { timeZone: 'Europe/Madrid' }), Protocolo: 'Sin evolución', SoloFisio: true } }] }) });
          if (!infR.error) datos._inf = infR.id || ((infR.records || [])[0] || {}).id || datos._inf;
          const campos = { DATOS: JSON.stringify(datos), INFORME: informe };
          const d = casoId ? await at(`${SEV}/${casoId}`, { method: 'PATCH', body: JSON.stringify({ fields: campos }) })
            : await at(SEV, { method: 'POST', body: JSON.stringify({ records: [{ fields: { ...campos, CASO: `${nombre || 'Paciente'} · ${hoyIso.split('-').reverse().join('/')}`, FECHA: hoyIso, PACIENTE: [pid], FISIO: String(q.fisio || ''), ESTADO: 'Abierto' } }] }) });
          if (d.error) return res.status(400).json({ ok: false, error: d.error.message || 'No se ha podido guardar' });
          const estados = await etiqueta(true).catch(() => null);
          return res.status(200).json({ ok: true, caso: vistaCaso(casoId ? d : d.records[0]), estados });
        }
        const casoId = q.casoId;
        if (!okId(casoId)) return res.status(400).json({ ok: false });
        const cur = await at(`${SEV}/${casoId}`);
        if (cur.error || !(cur.fields['PACIENTE'] || []).includes(pid)) return res.status(404).json({ ok: false, error: 'Caso no encontrado' });
        if (action === 'seg-sinevo-decision') {
          // Tarea hecha: el fisio ya sabe cómo seguir. Se cierra el caso (si vuelve a no mejorar, se abre otro).
          const DEC = ['Cambiar enfoque', 'Cambiar de fisio', 'Derivar al médico', 'Pedir pruebas', 'Alta'];
          const nota = String(q.nota || '').trim().slice(0, 5000);
          if (!nota) return res.status(400).json({ ok: false, error: 'Escribe cómo vas a seguir' });
          const alta = q.decision === 'Alta';
          const campos = { 'NOTA DECISIÓN': nota, 'FECHA DECISIÓN': hoyIso, 'DECIDIDO POR': String(q.fisio || ''), ESTADO: 'Cerrado', 'FECHA CIERRE': hoyIso, ...(DEC.includes(q.decision) ? { 'DECISIÓN': q.decision } : {}), ...(alta ? { RESULTADO: 'Alta' } : {}) };
          const d = await at(`${SEV}/${casoId}`, { method: 'PATCH', body: JSON.stringify({ fields: campos }) });
          if (d.error) return res.status(400).json({ ok: false, error: d.error.message });
          const estados = alta ? await etiqueta(false).catch(() => null) : null;
          return res.status(200).json({ ok: true, caso: vistaCaso(d), estados });
        }
        return res.status(400).json({ ok: false });
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
      if (action === 'seg-cierre') {
        const fecha = /^\d{4}-\d{2}-\d{2}$/.test(q.fecha || '') ? q.fecha : hoyF;
        const todos = await cierreDia(fecha, q.fisio || '');
        const k = Object.keys(todos).find(f => fisioKey(f) === fisioKey(q.fisio)) || '';
        const env = (await cierresEnviados(fecha))[fisioKey(q.fisio)] || null;
        const resumen = q.todos ? { fisios: Object.entries(todos).map(([f, x]) => ({ fisio: f, citas: x.citas, pendientes: x.pendientes })), enviados: await cierresEnviados(fecha) } : null;
        return res.status(200).json({ ok: true, fecha, fisio: k || q.fisio || '', items: await checklistItems(), dia: todos[k] || { citas: 0, hechas: 0, checks: [], pendientes: 0 }, enviado: env, resumen });
      }
      if (action === 'seg-tareas') {
        const PT = 'tblxPpPSvj15NWqNT';
        const rs = await todosT(PT, `filterByFormula=${encodeURIComponent('NOT({HECHO})')}&sort[0][field]=FECHA&sort[0][direction]=asc`);
        const pids = [...new Set(rs.map(r => (r.fields['PACIENTE'] || [])[0]).filter(Boolean))], pn = {};
        for (let i = 0; i < pids.length; i += 40) (await todosT(PACIENTES, `filterByFormula=${encodeURIComponent('OR(' + pids.slice(i, i + 40).map(id => `RECORD_ID()='${id}'`).join(',') + ')')}&fields[]=FULL NAME&fields[]=WHATSAPP&fields[]=TELF`)).forEach(p => { pn[p.id] = { nombre: p.fields['FULL NAME'] || '', tel: p.fields['WHATSAPP'] || p.fields['TELF'] || '' }; });
        return res.status(200).json({ ok: true, hoy: hoyF, tareas: rs.map(r => { const pid = (r.fields['PACIENTE'] || [])[0] || ''; return { id: r.id, texto: r.fields['TAREA'] || '', fecha: r.fields['FECHA'] || hoyF, para: (r.fields['PARA'] && r.fields['PARA'].name) || r.fields['PARA'] || '', nota: r.fields['NOTA'] || '', creadaPor: r.fields['CREADA POR'] || '', pacienteId: pid, paciente: (pn[pid] || {}).nombre || '', tel: (pn[pid] || {}).tel || '' }; }) });
      }
      if (req.method !== 'POST') return res.status(405).json({ ok: false });
      if (action === 'seg-justificante') {
        const pac = q.pacienteId; if (!/^rec[A-Za-z0-9]{14}$/.test(pac || '')) return res.status(400).json({ ok: false, error: 'Falta paciente' });
        const ids = (Array.isArray(q.citas) ? q.citas : []).filter(x => /^rec[A-Za-z0-9]{14}$/.test(x)).slice(0, 100);
        if (!ids.length) return res.status(400).json({ ok: false, error: 'Elige al menos una sesión' });
        const [p, cs, fd] = await Promise.all([
          at(`${PACIENTES}/${pac}`),
          lotes(ids, l => capTodos(CIT_T, `filterByFormula=${encodeURIComponent('OR(' + l.map(id => `RECORD_ID()='${id}'`).join(',') + ')')}&fields[]=FECHA&fields[]=HORA&fields[]=ESTADO&fields[]=PREF.&fields[]=RELACIÓN - CITA`), 30),
          at('tbl2mLUrnaKCFTs6g?fields[]=Name&fields[]=NºColegiado').catch(() => ({}))
        ]);
        if (p.error) return res.status(404).json({ ok: false, error: 'Paciente no encontrado' });
        // Solo sesiones de este paciente y marcadas como REALIZADA en la agenda
        const ok = cs.filter(c => (c.fields['RELACIÓN - CITA'] || []).includes(pac) && nmSel(c.fields['ESTADO']).toUpperCase() === 'REALIZADA');
        if (ok.length !== ids.length) return res.status(200).json({ ok: false, error: 'Solo se pueden incluir sesiones de este paciente marcadas como «Realizada» en la agenda.' });
        const FS = (fd.records || []).map(r => r.fields || {});
        const sesiones = ok.map(c => { const n = nmSel(c.fields['PREF.']); const f = FS.find(x => fisioKey(x.Name) === fisioKey(n));
          return { fecha: String(c.fields['FECHA'] || '').slice(0, 10), hora: String(c.fields['HORA'] || '').slice(0, 5), fisio: f ? String(f.Name).trim() : n, colegiado: f && f['NºColegiado'] ? String(f['NºColegiado']).trim() : '' }; })
          .sort((a, b) => (a.fecha + a.hora).localeCompare(b.fecha + b.hora));
        const tipo = q.tipo === 'informe' ? 'informe' : 'justificante';
        const D = { tipo, paciente: String(p.fields['FULL NAME'] || '').trim(), dni: q.conDni === false ? '' : String(p.fields['DNI'] || '').trim().toUpperCase(), sesiones, emitido: hoyF, por: String(q.quien || '') };
        const A = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'; const tk = Array.from(require('crypto').randomBytes(24), b => A[b % A.length]).join('');
        const d = await at(JUST_T, { method: 'POST', body: JSON.stringify({ typecast: true, records: [{ fields: { DOCUMENTO: (tipo === 'informe' ? 'Informe' : 'Justificante') + ' · ' + D.paciente + ' · ' + hoyF, FECHA: new Date().toISOString(), TIPO: tipo === 'informe' ? 'Informe de sesiones' : 'Justificante de asistencia', PACIENTE: [pac], TOKEN: tk, DATOS: JSON.stringify(D), 'CREADO POR': D.por } }] }) });
        if (d.error) return res.status(200).json({ ok: false, error: 'No se ha podido guardar' });
        const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'app.fisioterapia365.com');
        return res.status(200).json({ ok: true, url: `https://${/fisioterapia365\.com|vercel\.app/.test(host) ? host : 'app.fisioterapia365.com'}/doc/${tk}`, n: sesiones.length });
      }
      if (action === 'seg-cierre-enviar') {
        const fecha = /^\d{4}-\d{2}-\d{2}$/.test(q.fecha || '') ? q.fecha : hoyF;
        if (!String(q.fisio || '').trim()) return res.status(400).json({ ok: false, error: 'Falta el fisio' });
        const todos = await cierreDia(fecha, q.fisio);
        const k = Object.keys(todos).find(f => fisioKey(f) === fisioKey(q.fisio));
        const dia = todos[k] || { checks: [], pendientes: 0 };
        const detalle = dia.checks.map(c => (c.items.length ? (c.aviso ? '• ' : '✗ ') : '✓ ') + c.t + (c.items.length ? ': ' + c.items.map(i => i.nombre + (i.extra ? ' (' + i.extra + ')' : '')).join(', ') : '')).join('\n');
        const marc = new Set(Array.isArray(q.marcados) ? q.marcados : []);
        const MARCADOS = (await checklistItems()).map(x => (marc.has(x.k) ? '✓ ' : '✗ ') + x.t.replace(/\*\*/g, '')).join('\n');
        const fields = { CIERRE: fecha + ' · ' + String(q.fisio).trim(), FECHA: fecha, FISIO: String(q.fisio).trim(), ENVIADO: new Date().toISOString(), PENDIENTES: dia.pendientes, DETALLE: detalle, NOTA: String(q.nota || '').slice(0, 2000), MARCADOS };
        const prev = (await cierresEnviados(fecha))[fisioKey(q.fisio)];
        const d = prev ? await at(`${CIERRES_T}/${prev.id}`, { method: 'PATCH', body: JSON.stringify({ fields }) }) : await at(CIERRES_T, { method: 'POST', body: JSON.stringify({ records: [{ fields }] }) });
        return res.status(200).json({ ok: !d.error, pendientes: dia.pendientes, error: d.error && (d.error.message || 'No se ha podido guardar') });
      }
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
        // Pack pagado fuera del panel: «bonoPrevio» fija el nº de sesiones; «bonoSumar» le suma un pack nuevo
        // «Tiene pack» desde una cita: pack de n sesiones y esta cita es la nº «sesion» del pack.
        // Las sesiones del pack anteriores que el panel no cuenta (de antes de empezar a facturar aquí) se apuntan como «ya usadas».
        if (q.bonoPack && /^rec[A-Za-z0-9]{14}$/.test(q.bonoPack.citaId || '')) {
          const n = Math.round(Number(q.bonoPack.n)), k = Math.round(Number(q.bonoPack.sesion) || 1);
          if (!(n > 0 && n <= 200) || !(k >= 1 && k <= n)) return res.status(400).json({ ok: false, error: 'Revisa el nº de sesiones' });
          const cit = await at(`tblTPlcuiSjQngkaD/${q.bonoPack.citaId}`); if (cit.error) return res.status(404).json({ ok: false, error: 'Cita no encontrada' });
          const hh2 = h => String(h || '').replace(/^(\d):/, '0$1:').slice(0, 5), clave = String(cit.fields.FECHA || '').slice(0, 10) + ' ' + hh2(cit.fields.HORA);
          const inicio = await inicioControl().catch(() => '');
          let m = 0;
          if (inicio) { const cs = await todosT('tblTPlcuiSjQngkaD', `filterByFormula=${encodeURIComponent(`AND(OR(TRIM({ESTADO}&'')='REALIZADA',TRIM({ESTADO}&'')='PENDIENTE',TRIM({ESTADO}&'')='CITA PERDIDA'),FIND('${q.id}',ARRAYJOIN({PacienteRec})),NOT(IS_BEFORE({FECHA},DATETIME_PARSE('${inicio}','YYYY-MM-DD'))))`)}&fields[]=FECHA&fields[]=HORA`);
            m = cs.filter(c => String(c.fields.FECHA || '').slice(0, 10) + ' ' + hh2(c.fields.HORA) < clave).length; }
          const usadas = Math.max(0, (k - 1) - m);
          const d = await at(`${PACIENTES}/${q.id}`, { method: 'PATCH', body: JSON.stringify({ fields: { 'SESIONES BONO PREVIO': n, 'BONO PREVIO YA USADAS': usadas || null } }) });
          global._sesPac = {};
          return res.status(200).json({ ok: !d.error, bonoPrevio: n, usadas, error: d.error && (d.error.message || d.error.type) });
        }
        if (q.bonoPrevio != null || q.bonoSumar != null) {
          let n = Number(q.bonoPrevio);
          if (q.bonoSumar != null) { const cur = await at(`${PACIENTES}/${q.id}?fields[]=${encodeURIComponent('SESIONES BONO PREVIO')}`); n = Number((cur.fields || {})['SESIONES BONO PREVIO'] || 0) + Number(q.bonoSumar); }
          if (!Number.isFinite(n) || n < 0 || n > 500) return res.status(400).json({ ok: false, error: 'Nº de sesiones no válido' });
          const d = await at(`${PACIENTES}/${q.id}`, { method: 'PATCH', body: JSON.stringify({ fields: Object.assign({ 'SESIONES BONO PREVIO': Math.round(n) || null }, q.bonoPrevio != null ? { 'BONO PREVIO YA USADAS': null } : {}) }) });
          global._sesPac = {};
          return res.status(200).json({ ok: !d.error, bonoPrevio: Math.round(n), error: d.error && (d.error.message || d.error.type) });
        }
        const MAPA = { tel: 'TELF', whatsapp: 'WHATSAPP', email: 'EMAIL', dni: 'DNI', cumple: 'CUMPLE', notas: 'NOTAS', motivo: 'MOTIVO DE VISITA', historial: 'HISTORIAL CLÍNICO', nombre: 'FULL NAME', pin: 'PIN', telDescartado: 'TELF FORM DESCARTADO' };
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
      // Borrar la ficha de un paciente (solo dirección). paso 'info' → qué tiene; paso 'borrar' → la borra
      if (action === 'seg-paciente-borrar') {
        if (!/^(nora|ramiro)$/i.test(String(q.quien || '').trim().split(' ')[0])) return res.status(403).json({ ok: false, error: 'Solo dirección puede borrar fichas' });
        if (!/^rec[A-Za-z0-9]{14}$/.test(q.id || '')) return res.status(400).json({ ok: false, error: 'Falta paciente' });
        const pac = await at(`${PACIENTES}/${q.id}`); if (pac.error) return res.status(404).json({ ok: false, error: 'No encontrado' });
        const F = pac.fields || {}, hoyM = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date());
        const citas = await capTodos(CIT_T, `filterByFormula=${encodeURIComponent(`FIND('${q.id}',ARRAYJOIN({PacienteRec}))`)}&fields[]=ESTADO&fields[]=FECHA`).catch(() => []);
        const est = c => String(c.fields['ESTADO'] || '').trim().toUpperCase(), fe = c => String(c.fields['FECHA'] || '').slice(0, 10);
        const info = {
          nombre: F['FULL NAME'] || '',
          realizadas: citas.filter(c => est(c) === 'REALIZADA').length,
          futuras: citas.filter(c => est(c) === 'PENDIENTE' && fe(c) >= hoyM).length,
          historial: !!String(F['HISTORIAL CLÍNICO'] || '').trim(),
          consentimientos: (await consTodos().catch(() => [])).filter(c => (c.pac || []).includes(q.id)).length,
        };
        info.clinico = info.realizadas > 0 || info.historial || info.consentimientos > 0;
        if (q.paso !== 'borrar') return res.status(200).json({ ok: true, info });
        if (info.futuras) return res.status(200).json({ ok: false, error: `Tiene ${info.futuras} cita${info.futuras > 1 ? 's' : ''} pendiente${info.futuras > 1 ? 's' : ''}. Anúlala${info.futuras > 1 ? 's' : ''} primero.` });
        if (info.clinico && String(q.confirma || '').trim().toLowerCase() !== String(info.nombre).trim().toLowerCase()) return res.status(200).json({ ok: false, error: 'Escribe su nombre completo para confirmar' });
        const d = await at(`${PACIENTES}/${q.id}`, { method: 'DELETE' });
        if (d.error) return res.status(200).json({ ok: false, error: 'No se ha podido borrar' });
        console.log('ficha borrada', q.id, info.nombre, 'por', q.quien);
        return res.status(200).json({ ok: true });
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
        // Desde Call-in puede venir sin fila de seguimiento: se usa la que tenga abierta el paciente, si la hay
        if (!/^rec[A-Za-z0-9]{14}$/.test(q.id || '')) {
          if (!/^rec[A-Za-z0-9]{14}$/.test(q.pacienteId || '')) return res.status(400).json({ ok: false });
          const ya = (await todosT(SEG, `filterByFormula=${encodeURIComponent(`AND(NOT({HECHO}),FIND('${q.pacienteId}',ARRAYJOIN({PacRec})))`)}`).catch(() => []))[0];
          if (ya) q.id = ya.id;
        }
        const MAP = { 'Cita recuperada': 'CITA RECUPERADA ', 'Volver a llamar': 'VOLVER A LLAMAR', 'No contesta': 'NC - VOLVER A LLAMAR', 'Pendiente de respuesta': 'PENDIENTE RESPUESTA ', 'Alta': 'ALTA', 'No volver a llamar': 'NO VOLVER A LLAMAR' };
        const quienMap = { jonathan: 'JONY', jony: 'JONY', sara: 'SARA', ramiro: 'RAMIRO', nora: 'NORA', juan: 'JUAN' };
        const kq = String(q.quien || '').trim().split(' ')[0].toLowerCase(), quien = quienMap[kq] || (kq ? kq.toUpperCase() : ''); // fisios nuevos: su nombre (Airtable crea la opción)
        const ll = { FECHA: new Date().toISOString(), NOTAS: String(q.nota || ''), RESULTADO: MAP[q.resultado] || q.resultado };
        if (/^rec[A-Za-z0-9]{14}$/.test(q.pacienteId || '')) ll.PACIENTE = [q.pacienteId];
        if (quien) ll['QUIEN LLAMA'] = quien;
        if (q.nuevaFecha) ll['FECHA PDTE LLAMAR'] = q.nuevaFecha;
        if (q.resena) ll['RESEÑA'] = true;
        const sigue = /^\d{4}-\d{2}-\d{2}$/.test(q.nuevaFecha || '') && ['Volver a llamar', 'No contesta', 'Pendiente de respuesta'].includes(q.resultado);
        if (!q.id) {
          // Llamada suelta (Call-in) sin seguimiento abierto: se apunta la llamada y, si hay que volver a llamar, se crea el seguimiento
          if (sigue) { const fc = { 'FECHA DE LLAMADA': q.nuevaFecha, PACIENTE: [q.pacienteId], NOTAS: String(q.nota || '') }; const rq = String(q.quien || '').trim().slice(0, 30); if (rq) fc.RESPONSABLE = rq;
            const c = await at(SEG, { method: 'POST', body: JSON.stringify({ records: [{ fields: fc }], typecast: true }) }); if (!c.error) ll['SEG ID'] = c.records[0].id; }
          const d0 = await at(LLA, { method: 'POST', body: JSON.stringify({ records: [{ fields: ll }], typecast: true }) });
          if (q.resultado === 'Cita recuperada') await at(`${PACIENTES}/${q.pacienteId}`, { method: 'PATCH', body: JSON.stringify({ fields: { 'POR QUÉ NO REAGENDA': '', 'POR QUÉ FECHA': null, 'POR QUÉ FISIO': '' } }) }).catch(() => {});
          return res.status(200).json({ ok: !d0.error, error: d0.error && d0.error.message });
        }
        ll['SEG ID'] = q.id;
        await at(LLA, { method: 'POST', body: JSON.stringify({ records: [{ fields: ll }], typecast: true }) });
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
        const MAP = { 'Cita recuperada': 'CITA RECUPERADA ', 'Volver a llamar': 'VOLVER A LLAMAR', 'No contesta': 'NC - VOLVER A LLAMAR', 'Pendiente de respuesta': 'PENDIENTE RESPUESTA ', 'Alta': 'ALTA', 'No volver a llamar': 'NO VOLVER A LLAMAR' };
        const f = {}; if (q.resultado) f.RESULTADO = MAP[q.resultado] || q.resultado; if (q.nota != null) f.NOTAS = String(q.nota); if (q.resena != null) f['RESEÑA'] = !!q.resena; { const qm = { jonathan: 'JONY', jony: 'JONY', sara: 'SARA', ramiro: 'RAMIRO', nora: 'NORA', juan: 'JUAN' }[String(q.quien || '').split(' ')[0].toLowerCase()] || String(q.quien || '').trim().split(' ')[0].toUpperCase(); if (qm) f['QUIEN LLAMA'] = qm; }
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
      const tarjetas = await tarjetasActivas(pr.fields || {}).catch(() => []);
      const saldo = await saldoPaciente(pac).catch(() => ({ activo: false }));
      const bonoPrevio = Number((pr.fields || {})['SESIONES BONO PREVIO'] || 0);
      if (!HOLDED_KEY) return res.status(200).json({ ok: true, holded: false, dni, saldo, bonoPrevio, tarjetas, facturas: [] });
      try {
        const ids = await contactosDelPaciente(pac); const facturas = await listarFacturas(ids, true);
        // Tickets borrados en Holded → su fila de FACTURAS pasa a «Anulada» y deja de contar en el saldo
        let saldo2 = saldo;
        if (ids.length) try {
          const vivos = new Set(facturas.map(x => x.id));
          const filas = await capTodos(FACTURAS_TABLE, `filterByFormula=${encodeURIComponent(`AND({ESTADO}='Emitida',{PacienteId}='${pac}',{HOLDED ID}!='')`)}&returnFieldsByFieldId=true`);
          const muertas = filas.filter(r => !String(r.fields[FF.aNombre] || '').trim() && Date.now() - Date.parse(r.createdTime) > 120e3 && !vivos.has(String(r.fields[FF.holdedId] || '')));
          for (let i = 0; i < muertas.length; i += 10) await at(FACTURAS_TABLE, { method: 'PATCH', body: JSON.stringify({ typecast: true, records: muertas.slice(i, i + 10).map(r => ({ id: r.id, fields: { [FF.estado]: 'Anulada' } })) }) });
          if (muertas.length) saldo2 = await saldoPaciente(pac).catch(() => saldo);
        } catch (e) {}
        return res.status(200).json({ ok: true, holded: true, dni, saldo: saldo2, bonoPrevio, tarjetas, enHolded: ids.length, facturas });
      }
      catch (e) { return res.status(200).json({ ok: true, holded: true, dni, saldo, bonoPrevio, tarjetas, facturas: [], error: /401|403/.test(e.message) ? 'Holded no acepta la clave (revisa la clave y sus permisos).' : 'No se han podido cargar las facturas (' + e.message + ').' }); }
    }
    if (req.method !== 'POST') return res.status(405).json({ ok: false });
    if (!HOLDED_KEY) return res.status(200).json({ ok: false, error: 'Holded todavía no está conectado (falta la clave en Vercel).' });
    const lineas = (Array.isArray(q.lineas) ? q.lineas : []).slice(0, 2);
    if (!lineas.length) return res.status(400).json({ ok: false, error: 'Falta el concepto' });
    if (q.dni && normDni(q.dni).length >= 8) await at(`${PACIENTES}/${pac}`, { method: 'PATCH', body: JSON.stringify({ fields: { DNI: String(q.dni).trim().toUpperCase() } }) });
    let descuento = null, tarjeta = null;
    if (q.tarjetaId) {
      const pr = await at(`${PACIENTES}/${pac}`);
      tarjeta = (await tarjetasActivas(pr.fields || {})).find(t => t.id === q.tarjetaId);
      if (!tarjeta) return res.status(200).json({ ok: false, error: 'Esa tarjeta regalo ya no está disponible (usada o caducada).' });
      const impT = Number((await conf().catch(() => CONF_DEF)).tarjeta.importe) || 10;
      if (lineas.reduce((t, l) => t + Number(l.uds || 0) * Number(l.precio || 0), 0) < impT) return res.status(200).json({ ok: false, error: `El cobro tiene que ser de más de ${impT} € para descontar la tarjeta.` });
      descuento = { importe: impT, texto: 'Tarjeta regalo por recomendar' + (tarjeta.por ? ' a ' + tarjeta.por.split(' ')[0] : '') };
    }
    const fa = q.facturarA || {};
    const campos = { [FF.paciente]: [pac], 'fldpruhLn03x1x6zI': pac, [FF.notas]: String(q.notas || ''), [FF.estado]: 'Pendiente' };
    if (q.modoPago) campos['fldafSkOOldJ8gH70'] = q.modoPago;
    if (/^\d{4}-\d{2}-\d{2}$/.test(q.fecha || '')) campos[FF.fecha] = q.fecha;
    if (fa.nombre) { campos[FF.aNombre] = String(fa.nombre); campos[FF.aNif] = String(fa.nif || ''); campos[FF.aDir] = String(fa.direccion || ''); }
    [[FF.c1, FF.n1, FF.p1], [FF.c2, FF.n2, FF.p2]].forEach(([c, n, pr], i) => { const l = lineas[i]; if (!l) return; campos[c] = String(l.concepto || ''); campos[n] = Number(l.uds || 0); campos[pr] = Number(l.precio || 0); });
    global._sesPac = {}; const cr = await at(FACTURAS_TABLE, { method: 'POST', body: JSON.stringify({ records: [{ fields: campos }], typecast: true }) });
    const rec = cr.records && cr.records[0] && cr.records[0].id;
    if (!rec) return res.status(500).json({ ok: false, error: (cr.error && cr.error.message) || 'No se ha podido guardar en Airtable' });
    const turno = emitiendo.then(() => emitirFactura(rec, q.quien, q.fisioElegido ? String(q.fisio || '') : undefined, descuento));
    emitiendo = turno.catch(() => {});
    try { const r = await turno;
      if (tarjeta) { const hoyT = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date()); const fT = { CANJEADA: hoyT };
        if (!tarjeta.codigo) { const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; fT['CÓDIGO'] = 'F365-' + Array.from({ length: 4 }, () => A[Math.floor(Math.random() * A.length)]).join(''); fT.CADUCA = tarjeta.caduca; }
        await at(`tblr27u3cvtzfyqI6/${tarjeta.id}`, { method: 'PATCH', body: JSON.stringify({ fields: fT }) }).catch(() => {}); }
      return res.status(200).json({ ok: true, tarjeta: !!tarjeta, num: r.num, borrador: !!r.borrador, total: r.total, otro: r.otro }); }
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
        const tarjetas = (await tarjetasActivas(F)).map(t => ({ codigo: t.codigo, caduca: t.caduca, por: t.por }));
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
        const tipoDoc = docTipo(req.query.tipo);
        const doc = await holded('/' + tipoDoc + '/' + id);
        if (!doc || !ids.includes(doc.contact_id)) return res.status(403).json({ ok: false, error: 'No autorizado' });
        const pdf = await holdedPdf('/' + tipoDoc + '/' + id + '/pdf');
        if (!pdf) return res.status(502).json({ ok: false, error: 'PDF no disponible' });
        return res.status(200).json({ ok: true, nombre: 'Factura_' + String(doc.document_number || id).replace(/[^\w-]/g, '_') + '.pdf', pdf });
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
module.exports.cierreDia = cierreDia;
module.exports.emailsResumen = emailsResumen;
module.exports.cierresEnviados = cierresEnviados;
module.exports.holdedApi = { holded: (...a) => holded(...a), holdedTodos: (...a) => holdedTodos(...a), activo: () => !!HOLDED_KEY };
