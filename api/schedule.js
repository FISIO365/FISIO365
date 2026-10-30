const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const { BASE_ID } = require('./_base');
const PLAN_TABLE = 'tblvgE0a4gsrj4Vhp';
const FISIOS_TABLE = 'tbl2mLUrnaKCFTs6g';
const INFORMES_TABLE = 'tblwvWQxXNJPdR0Iv';
const BIBLIO_TABLE = 'tbloqn3ts872ueJSE';

const HOLDED_KEY = process.env.HOLDED_API_KEY;
const { saldoPaciente, rendimiento, inicioControl, sinFacturar, compartidos, repartoCompartido, citasDeMiembros, pcLeer } = require('./_push').saldo;
const PACIENTES = 'tbldBVgClS4HY2mOJ';
const HOLDED_URL = 'https://api.holded.com/api/v2'; // API nueva de Holded (clave «Bearer»)
// Marca de la clínica (nombre, dirección, teléfono, reseñas…): ver api/_marca.js
const MARCA = require('./_marca');
let CLI = MARCA.datos(null);
// Emails (Brevo) y textos de la IA salen con los datos de la clínica
{ const _f = global.fetch; if (_f && !_f._marca) { const nf = (u, o) => { try { if (o && typeof o.body === 'string' && /api\.brevo\.com|api\.anthropic\.com/.test(String(u))) o = Object.assign({}, o, { body: MARCA.marcar(o.body, CLI, true) }); } catch (e) {} return _f(u, o); }; nf._marca = 1; global.fetch = nf; } }

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
const importeAbs = d => { for (const k of ['total', 'total_amount', 'amount', 'grand_total']) { const n = Math.abs(aNum(d[k])); if (n > 0) return n; } return importeDoc(d); };
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
// Ingresos por día desde Holded: todos los tickets de venta (borradores y cobrados incluidos) menos sus rectificativas
const HOLDED_DESDE = '2026-10-01'; // desde aquí los ingresos salen de Holded; antes, de las tablas que llevabais a mano
let _ingH = { t: 0, k: '', v: null };
async function ingresosHoldedDias(desde, hasta) {
  const k = desde + '|' + hasta; if (_ingH.k === k && Date.now() - _ingH.t < 10 * 60e3) return _ingH.v;
  // Tickets de venta (borradores y cobrados incluidos) menos sus rectificativas (receipt-notes), sin pacientes de prueba
  const [tk, rn] = await Promise.all([holdedTodos(`/sales-receipts?limit=200&start_date=${desde}&end_date=${hasta}`, 40), holdedTodos(`/receipt-notes?limit=200&start_date=${desde}&end_date=${hasta}`, 20).catch(e => { console.error('receipt-notes', e.message); return []; })]);
  const vistos = new Set(), dias = {};
  const suma = (L, sg) => L.forEach(d => { if (!d || !d.id || vistos.has(d.id)) return; vistos.add(d.id);
    const f = String(d.date || '').slice(0, 10); if (f < desde || f > hasta || /\btest\b|prueba/i.test(d.contact_name || '')) return;
    dias[f] = Math.round(((dias[f] || 0) + sg * importeAbs(d)) * 100) / 100; });
  suma(tk, 1); suma(rn, -1);
  _ingH = { t: Date.now(), k, v: dias }; return dias;
}
// Tickets de Holded (hechos fuera del panel) → sesiones pagadas por paciente, para el valor de cada sesión del informe de horas
let _hCont = { t: 0, v: null };
async function cobrosHolded(pacT, yaPanel, desde, hasta) {
  const nrm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
  const [tk, cont] = await Promise.all([
    holdedTodos(`/sales-receipts?limit=200&start_date=${desde}&end_date=${hasta}`, 40),
    _hCont.v && Date.now() - _hCont.t < 30 * 60e3 ? _hCont.v : holdedTodos('/contacts?limit=200', 40).then(v => { _hCont = { t: Date.now(), v }; return v; }).catch(() => [])
  ]);
  const dni = {}, mail = {}, tel = {}, nom = {};
  pacT.forEach(p => { const f = p.fields || {}; const d = normDni(f['DNI']); if (d.length >= 8) dni[d] = p.id; const e = String(f['EMAIL'] || '').trim().toLowerCase(); if (e) mail[e] = p.id;
    const t = soloDigitos(f['WHATSAPP'] || f['TELF']); if (t.length === 9) tel[t] = p.id; const n = nrm(f['FULL NAME']); if (n) (nom[n] = nom[n] || []).push(p.id); });
  const porNom = n => { const l = nom[nrm(n)]; return l && l.length === 1 ? l[0] : ''; };
  const contPac = {};
  cont.forEach(c => { const id = dni[normDni(c.code || c.vatnumber || c.tax_id || c.nif)] || mail[String(c.email || '').trim().toLowerCase()] || tel[soloDigitos(c.mobile)] || tel[soloDigitos(c.phone)] || porNom(c.name); if (id) contPac[c.id] = id; });
  const out = {}; let ok = 0, sinPac = 0, sinSes = 0;
  tk.forEach(d => {
    if (!d || !d.id || yaPanel.has(String(d.id))) return; // «completed» = cobrado (conciliado con el banco): cuenta
    const f = String(d.date || '').slice(0, 10); if (f < desde || f > hasta) return;
    const cid = d.contact_id || (d.contact && typeof d.contact === 'object' ? d.contact.id : d.contact);
    const pid = contPac[cid] || porNom(d.contact_name || d.contactName); if (!pid) { sinPac++; return; }
    let n = 0;
    (d.lines || d.products || d.items || []).forEach(x => { const nm = String(x.name || x.desc || x.concept || x.product_name || x.description || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); const u = aNum(x.units) || 1;
      const m = nm.match(/(\d+)\s*(ses|sesion)/); if (m) n += +m[1] * u; else if (/sesion|valoracion|fisio|pelvi|readapt|tratamiento|masaje|bono|pack|osteo|puncion/.test(nm)) n += u; });
    if (!n) { sinSes++; return; }
    const tot = importeDoc(d); if (!tot) return; ok++;
    const p = Math.round(tot / n * 100) / 100;
    for (let i = 0; i < n; i++) (out[pid] = out[pid] || []).push({ f, p, o: 'Ticket de Holded' + (n > 1 ? ` · ${n} sesiones` : '') });
  });
  const e = tk[0] || {}, l = (e.lines || e.products || e.items || [])[0] || {};
  console.log('cobrosHolded', JSON.stringify({ tickets: tk.length, contactos: cont.length, ligados: Object.keys(contPac).length, ok, sinPac, sinSes, claves: Object.keys(e), linea: Object.keys(l), nombresLinea: tk.slice(0, 8).map(t => (t.lines || t.products || t.items || []).map(x => x.name || x.desc).join(' + ')) }));
  return out;
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

// ── ETAPA DEL PACIENTE: solo una a la vez, y se pone sola según lo que pasa ──
// Las demás etiquetas (Valoración, Fin pack, Evolución…, Mantenimiento…) no se tocan.
// «SESIÓN ÚNICA» no es etapa: convive con Alta o Pendiente de continuar; se pone al hacer la 1ª sesión sin reagendar y se quita si vuelve a tener cita
const ETAPAS_PAC = ['PACIENTE NUEVO', 'PENDIENTE DE COMENZAR', 'ACTIVO', 'SEGUIMIENTO', 'PENDIENTE DE CONTINUAR', 'ALTA', 'ABANDONO', 'NO ACUDIÓ'];
// Repaso diario: «Activo» que lleva más de 3 semanas sin venir, sin cita dada y sin estar en «Por llamar» → «Pendiente de continuar»
const SEMANAS_PDTE_CONTINUAR = 3;
async function repasoEtapas() {
  const todo = async (t, query) => { let recs = [], off = ''; do { const d = await at(`${t}?${query}&pageSize=100${off ? '&offset=' + off : ''}`); if (d.error) throw new Error(d.error.message || 'Airtable'); recs = recs.concat(d.records || []); off = d.offset || ''; } while (off); return recs; };
  const est = await at(`tbldOsLe8iw78Wun7?fields[]=ESTADO&pageSize=100`); const E = {}; (est.records || []).forEach(x => { E[String(x.fields['ESTADO'] || '').trim().toUpperCase()] = x.id; });
  if (!E['ACTIVO'] || !E['PENDIENTE DE CONTINUAR']) return { cambiados: 0 };
  const activos = await todo(PACIENTES, `filterByFormula=${encodeURIComponent("FIND('ACTIVO',ARRAYJOIN({ESTADO}))")}&fields[]=ESTADO`);
  if (!activos.length) return { cambiados: 0 };
  const dias = SEMANAS_PDTE_CONTINUAR * 7;
  // Quien ha venido en las últimas semanas o tiene cita dada
  const recientes = await todo('tblTPlcuiSjQngkaD', `filterByFormula=${encodeURIComponent(`AND(IS_AFTER({FECHA},DATEADD(TODAY(),-${dias + 1},'days')),OR(TRIM({ESTADO})='REALIZADA',TRIM({ESTADO})='PENDIENTE',TRIM({ESTADO})='CITA DUDOSA',TRIM({ESTADO})='POR REAGENDAR'))`)}&fields[]=${encodeURIComponent('RELACIÓN - CITA')}`);
  const conMovimiento = new Set(recientes.flatMap(r => r.fields['RELACIÓN - CITA'] || []));
  const enLlamar = new Set((await todo('tblu9YxiktpAh5w87', `filterByFormula=${encodeURIComponent('NOT({HECHO})')}&fields[]=PACIENTE`)).flatMap(r => r.fields['PACIENTE'] || []));
  const vida = ETAPAS_PAC.map(n => E[n]).filter(Boolean);
  const cambiar = activos.filter(p => (p.fields['ESTADO'] || []).includes(E['ACTIVO']) && !conMovimiento.has(p.id) && !enLlamar.has(p.id)).slice(0, 150);
  for (let i = 0; i < cambiar.length; i += 10) await at(PACIENTES, { method: 'PATCH', body: JSON.stringify({ records: cambiar.slice(i, i + 10).map(p => ({ id: p.id, fields: { ESTADO: [...(p.fields['ESTADO'] || []).filter(id => !vida.includes(id)), E['PENDIENTE DE CONTINUAR']] } })) }) });
  return { cambiados: cambiar.length };
}
async function ponerEtapa(pid, evento) {
  if (!/^rec[A-Za-z0-9]{14}$/.test(pid || '')) return null;
  const est = await at(`tbldOsLe8iw78Wun7?fields[]=ESTADO&pageSize=100`); const E = {}; (est.records || []).forEach(x => { E[String(x.fields['ESTADO'] || '').trim().toUpperCase()] = x.id; });
  const citasDe = async (cond, n) => ((await at(`tblTPlcuiSjQngkaD?filterByFormula=${encodeURIComponent(`AND(${cond},FIND('${pid}',ARRAYJOIN({PacienteRec})))`)}&maxRecords=${n}&fields[]=FECHA`)).records || []);
  const hechas = n => citasDe("TRIM({ESTADO})='REALIZADA'", n);
  const futura = () => citasDe("OR(TRIM({ESTADO})='PENDIENTE',TRIM({ESTADO})='CITA DUDOSA'),IS_AFTER({FECHA},DATEADD(TODAY(),-1,'days'))", 1);
  const pac = await at(`${PACIENTES}/${pid}`); const act = (pac.fields && pac.fields['ESTADO']) || [];
  let nueva = null, unica = null; // unica: true = poner «Sesión única», false = quitarla
  if (evento === 'cita') { nueva = (await hechas(1)).length ? 'ACTIVO' : 'PACIENTE NUEVO'; unica = false; }      // se le da cita
  else if (evento === 'realizada') { if ((await futura()).length) { nueva = 'ACTIVO'; unica = false; }           // hace la sesión y ya tiene otra → Activo
    else if ((await hechas(2)).length <= 1) { unica = true; if (act.includes(E['PACIENTE NUEVO'])) nueva = 'ACTIVO'; } } // 1ª sesión y no reagenda → Sesión única
  else if (evento === 'noasistio') nueva = (await futura()).length ? null : 'NO ACUDIÓ';                       // falta y no tiene otra cita
  else if (evento === 'SEGUIMIENTO' && act.includes(E['NO ACUDIÓ'])) nueva = null;                             // si no acudió, se queda «No acudió»
  else if (ETAPAS_PAC.includes(evento)) nueva = evento;                                                         // Alta, Seguimiento, Abandono…
  if ((!nueva || !E[nueva]) && unica === null) return null;
  const vida = ETAPAS_PAC.map(n => E[n]).filter(Boolean), U = E['SESIÓN ÚNICA'];
  let nuevo = nueva && E[nueva] ? [...act.filter(id => !vida.includes(id)), E[nueva]] : act.slice();
  if (U && unica === true && !nuevo.includes(U)) nuevo.push(U); if (U && unica === false) nuevo = nuevo.filter(id => id !== U);
  if (nuevo.slice().sort().join() !== act.slice().sort().join()) await at(`${PACIENTES}/${pid}`, { method: 'PATCH', body: JSON.stringify({ fields: { ESTADO: nuevo } }) });
  return { etapa: nueva, estados: nuevo };
}
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
    const todos = async (t, q2) => { let recs = [], off = ''; do { const d = await at(`${t}?${q2}&pageSize=100${off ? '&offset=' + off : ''}`); if (d.error || d.errors) throw new Error((d.error && d.error.message) || 'Airtable'); recs = recs.concat(d.records || []); off = d.offset || ''; } while (off); return recs; };
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
  tutor = tutor || String(F['TUTOR'] || ''); tutorNif = tutorNif || String(F['NIF TUTOR'] || ''); recomendo = recomendo || String(F['RECOMENDÓ'] || '');
  let firma = '';
  if (firmaUrl) { try { const im = await fetch(firmaUrl); if (im.ok) firma = `data:${im.headers.get('content-type') || 'image/png'};base64,` + Buffer.from(await im.arrayBuffer()).toString('base64'); } catch (e) {} }
  const resp = {}; Object.keys(F).forEach(k => { const v = F[k]; if (v && typeof v === 'object' && !Array.isArray(v) && v.name) resp[k] = v.name; else if (typeof v === 'string' && v.length < 60) resp[k] = v; });
  return { ok: true, tally: !!process.env.TALLY_API_KEY, pac: F['PACIENTE'] || [], papel: !!F['PAPEL'], doc: { id: r.id, tipo: otro ? (cNm(F['TIPO']) || 'Suelo pélvico') : 'Primera visita', fechaAlta: F['FECHA ALTA'] || '', notasSalud: F['NOTAS SALUD'] || '', informe: (F['INFORME'] || []).map(a => ({ url: a.url, nombre: a.filename || 'informe' })), nombre: String(F['﻿NOMBRE'] || F['NOMBRE'] || '').trim(), apellidos: String(F['APELLIDOS'] || '').trim(), dni: String(F['DNI'] || '').trim(), nacimiento: F['NACIMIENTO'] || '', email: F['EMAIL'] || '', tel: F['TELF'] || '', fecha: (otro ? F['FECHA'] : F['Creada']) || String(r.createdTime || '').slice(0, 10), aceptaSP: !!F['ACEPTACIÓN S.P.'], resp, firma, tutor, tutorNif, recomendo } };
}

// ── CAPTACIÓN: contactos sin cita, lista de espera y negocios del barrio ─────
const CAP = { contacto: 'tblgsMcknBLDyfWHu', esperaP: 'tbl5ksXlpfsSTZk5i', esperaN: 'tblAvnUMOvVo4OBne', negocio: 'tblO5y1Ikg3LIalic', referidos: 'tblr27u3cvtzfyqI6' };
const capTodos = async (t, q2) => { let recs = [], off = ''; do { const d = await at(`${t}?${q2}&pageSize=100${off ? '&offset=' + off : ''}`); if (d.error || d.errors) throw new Error((d.error && d.error.message) || 'Airtable'); recs = recs.concat(d.records || []); off = d.offset || ''; } while (off); return recs; };
let _espera = { t: 0, v: null };
async function esperaLista(forzar) {
  if (!forzar && _espera.v && Date.now() - _espera.t < 5 * 60e3) return _espera.v;
  const [p, n] = await Promise.all([capTodos(CAP.esperaP, 'sort[0][field]=FECHA SOLICITUD&sort[0][direction]=desc'), capTodos(CAP.esperaN, 'sort[0][field]=FECHA SOLICITUD&sort[0][direction]=desc')]);
  const pids = [...new Set(p.map(r => (r.fields['PACIENTE'] || [])[0]).filter(Boolean))], info = {};
  for (let i = 0; i < pids.length; i += 40) (await capTodos(PACIENTES, `filterByFormula=${encodeURIComponent('OR(' + pids.slice(i, i + 40).map(id => `RECORD_ID()='${id}'`).join(',') + ')')}&fields[]=FULL NAME&fields[]=WHATSAPP&fields[]=TELF`)).forEach(x => { info[x.id] = { nombre: x.fields['FULL NAME'] || '', tel: x.fields['WHATSAPP'] || x.fields['TELF'] || '' }; });
  const est = (F, perdido) => { const e = cNm(F['ESTADO']); if (e) return e; return perdido ? 'YA NO' : 'ESPERANDO'; };
  const v = [
    ...p.map(r => { const F = r.fields, pid = (F['PACIENTE'] || [])[0] || ''; return { id: r.id, tabla: 'esperaP', creado: r.createdTime || '', pacienteId: pid, nombre: (info[pid] || {}).nombre || '—', tel: (info[pid] || {}).tel || '', fecha: F['FECHA SOLICITUD'] || String(r.createdTime).slice(0, 10), nota: F['NOTAS'] || '', disp: F['DISPONIBILIDAD'] || '', dias: (F['DIAS'] || []).map(cNm), franja: (F['FRANJA'] || []).map(cNm), horario: F['HORARIO'] || '', nopuede: F['NO PUEDE'] || '', ofrecido: F['OFRECIDO'] || '', fisio: F['FISIO'] || '', estado: est(F, false), aviso: F['ÚLTIMO AVISO'] || '' }; }),
    ...n.map(r => { const F = r.fields; return { id: r.id, tabla: 'esperaN', creado: r.createdTime || '', pacienteId: '', nombre: F['NOMBRE'] || 'Sin nombre', tel: F['TELF'] || '', fecha: F['FECHA SOLICITUD'] || String(r.createdTime).slice(0, 10), nota: F['NOTAS'] || '', disp: F['DISPONIBILIDAD'] || '', dias: (F['DIAS'] || []).map(cNm), franja: (F['FRANJA'] || []).map(cNm), horario: F['HORARIO'] || '', nopuede: F['NO PUEDE'] || '', ofrecido: F['OFRECIDO'] || '', fisio: F['FISIO'] || '', estado: est(F, cNm(F['PERDIDO?']) === 'SÍ'), aviso: F['ÚLTIMO AVISO'] || '' }; })
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
        (await capTodos('tblTPlcuiSjQngkaD', `filterByFormula=${encodeURIComponent(`AND(TRIM({ESTADO})='REALIZADA',OR(${lote.map(id => `FIND('${id}',ARRAYJOIN({PacienteRec}))`).join(',')}))`)}&fields[]=FECHA&fields[]=PacienteRec`).catch(() => [])).forEach(c => (c.fields['PacienteRec'] || []).forEach(id => { if (lote.includes(id)) (citas[id] = citas[id] || []).push({ fecha: String(c.fields['FECHA'] || '').slice(0, 10), creada: String(c.createdTime || '') }); })); }
      for (const { e, pid } of quien.slice(0, 20)) {
        // Solo sale sola de la lista cuando ya ha venido: una sesión REALIZADA en un día posterior a apuntarse.
        // Si tiene una cita pendiente (p. ej. lejana y se apunta para adelantarla) se queda hasta que venga o la quitemos a mano.
        const c = (citas[pid] || []).filter(c => c.fecha > e.fecha).sort((a, b) => a.fecha.localeCompare(b.fecha))[0];
        if (!c) continue;
        const T = e.tabla === 'esperaP' ? CAP.esperaP : CAP.esperaN;
        const r = await at(`${T}/${e.id}`, { method: 'PATCH', body: JSON.stringify({ fields: { ESTADO: 'CITADO', NOTAS: [e.nota, `Vino el ${c.fecha.split('-').reverse().join('/')} (se quitó sola de la lista)`].filter(Boolean).join(' · ') }, typecast: true }) }).catch(() => ({ error: 1 }));
        if (!r.error) { e.estado = 'CITADO'; e.nota = [e.nota, `Vino el ${c.fecha.split('-').reverse().join('/')}`].filter(Boolean).join(' · '); }
      }
    }
  } catch (err) {}
  _espera = { t: Date.now(), v }; return v;
}
// Al darle cita a alguien que está en la lista de espera, sale solo de ella («Ya tiene cita»)
async function salirDeEspera(pid, fecha, hora) {
  const v = await esperaLista(true); let tel = '';
  const sinPac = v.filter(e => e.estado === 'ESPERANDO' && e.tabla === 'esperaN');
  if (sinPac.length) { const p = await at(`${PACIENTES}/${pid}`).catch(() => ({})); tel = String(((p.fields || {})['WHATSAPP'] || (p.fields || {})['TELF'] || '')).replace(/\D/g, '').slice(-9); }
  const mios = v.filter(e => e.estado === 'ESPERANDO' && (e.pacienteId === pid || (tel.length === 9 && String(e.tel || '').replace(/\D/g, '').slice(-9) === tel)));
  const fC = String(fecha).split('-').reverse().join('/');
  for (const e of mios) { const T = e.tabla === 'esperaP' ? CAP.esperaP : CAP.esperaN;
    const r = await at(`${T}/${e.id}`, { method: 'PATCH', body: JSON.stringify({ fields: { ESTADO: 'CITADO', NOTAS: [e.nota, `Cita dada para el ${fC} a las ${hora} (se quitó sola de la lista)`].filter(Boolean).join(' · ') }, typecast: true }) }).catch(() => ({ error: 1 }));
    if (!r.error) e.estado = 'CITADO'; }
  if (mios.length) _espera.t = 0;
  return mios.length;
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
  const todosW = async (t, query) => { let recs = [], off = ''; do { const d = await at(`${t}?${query}&pageSize=100${off ? '&offset=' + off : ''}`); if (d.error || d.errors) throw new Error((d.error && d.error.message) || 'Airtable'); recs = recs.concat(d.records || []); off = d.offset || ''; } while (off); return recs; };
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
<meta name="robots" content="noindex"><meta property="og:title" content="${just ? 'Tu justificante de asistencia' : 'Tus sesiones realizadas'} · FISIO365"><meta property="og:description" content="Toca para verlo y descargarlo en PDF."><meta property="og:image" content="https://app.fisioterapia365.com/informe/${just ? 'og-justificante' : 'og-sesiones'}.png?v=1"><meta property="og:image:width" content="600"><meta property="og:image:height" content="600"><meta property="og:type" content="website">
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
  { k: 'anamnesis', t: 'He hecho la **anamnesis** a las primeras visitas' }, // sin comprobación automática: a veces se hace fuera de la app
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
// Primeras visitas que aún no tienen el consentimiento firmado (para mandárselo con el recordatorio / en la página de confirmar)
const CONSENT_URL = 'https://app.fisioterapia365.com/consentimiento'; // antes Tally b5j1M2 (los ya enviados siguen funcionando)
async function pidenConsentimiento(pids, antesDe) {
  pids = [...new Set(pids.filter(x => /^rec[A-Za-z0-9]{14}$/.test(x || '')))]; const out = new Set(); if (!pids.length) return out;
  const yaVino = new Set();
  for (let i = 0; i < pids.length; i += 40) {
    const l = pids.slice(i, i + 40);
    const d = await capTodos('tblTPlcuiSjQngkaD', `filterByFormula=${encodeURIComponent(`AND(TRIM({ESTADO})='REALIZADA',IS_BEFORE({FECHA},'${antesDe}'),OR(${l.map(x => `FIND('${x}',ARRAYJOIN({PacienteRec}))`).join(',')}))`)}&fields[]=${encodeURIComponent('RELACIÓN - CITA')}`).catch(() => null);
    if (!d) return out; // si no se puede saber, mejor no mandarlo
    d.forEach(r => (r.fields['RELACIÓN - CITA'] || []).forEach(x => yaVino.add(x)));
  }
  let firmados = new Set(); try { (await consTodos()).forEach(c => (c.pac || []).forEach(x => firmados.add(x))); } catch (e) {}
  pids.forEach(x => { if (!yaVino.has(x) && !firmados.has(x)) out.add(x); });
  out.yaVino = yaVino; return out;
}
// Página del enlace del informe (/i/TOKEN): comprueba que es el paciente, enseña el informe y pide firmar el recibí
// Sube un archivo (base64) a un campo de adjuntos de Airtable. Fotos, PDF, Word, Excel…
const TIPOS_ADJ = /^(image\/(png|jpeg|webp|gif|heic|heif)|application\/(pdf|msword|vnd\.openxmlformats-officedocument\.(wordprocessingml\.document|spreadsheetml\.sheet|presentationml\.presentation)|vnd\.ms-excel)|text\/plain)$/;
async function subirAdjunto(recId, campo, a) {
  if (!a || !a.file || String(a.file).length > 6e6) return { error: 'El archivo es demasiado grande (máx. 4 MB)' };
  const tipo = TIPOS_ADJ.test(a.tipo || '') ? a.tipo : 'application/octet-stream';
  const r = await fetch(`https://content.airtable.com/v0/${BASE_ID}/${recId}/${campo}/uploadAttachment`, { method: 'POST', headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ contentType: tipo, file: String(a.file), filename: String(a.nombre || 'archivo').replace(/[\\/:*?"<>|]/g, '_').slice(0, 120) }) }).then(x => x.json()).catch(e => ({ error: e.message }));
  return r.error ? { error: 'No se ha podido subir ' + (a.nombre || 'el archivo') } : { ok: true };
}
const verAdj = L => (L || []).map(a => ({ url: a.url, nombre: a.filename || 'archivo', tipo: a.type || '', bytes: a.size || 0, mini: (a.thumbnails && a.thumbnails.large && a.thumbnails.large.url) || '' }));
// Nº de informe (sale en el PDF del informe y en el recibí) y huella del texto (SHA-256): si el informe cambia después de firmar, ya no coincide
const infCodigo = id => 'INF-' + String(id || '').slice(3).toUpperCase();
const infHuella = t => require('crypto').createHash('sha256').update(String(t || '').replace(/\r/g, '').trim(), 'utf8').digest('hex');
const infTextoRecibi = id => `Confirmo que he recibido mi informe fisioterapéutico de FISIO365 (nº ${infCodigo(id)}).`;
// Fecha de nacimiento del paciente (el campo se lee por su id)
async function pacNacimiento(pid) { if (!/^rec[A-Za-z0-9]{14}$/.test(pid || '')) return ''; const r = await at(`${PACIENTES}/${pid}?returnFieldsByFieldId=true`).catch(() => ({})); return String(((r || {}).fields || {}).fldkHQkEdPfWrRdJq || '').slice(0, 10); }
function paginaRecibi(tk) {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Tu informe · FISIO365</title>
<meta property="og:title" content="Tu informe · FISIO365"><meta property="og:description" content="Enlace privado. Para abrirlo te pediremos que confirmes que eres tú."><meta property="og:image" content="https://app.fisioterapia365.com/informe/og-informe-sq.png?v=1"><meta property="og:image:width" content="600"><meta property="og:image:height" content="600"><meta property="og:type" content="website">
<link rel="icon" href="/icons/favicon-cara.png"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box}body{margin:0;background:#f5f2ee;font-family:Poppins,sans-serif;color:#1a1a1a;-webkit-font-smoothing:antialiased}
main{max-width:480px;margin:0 auto;padding:26px 16px 40px}.logo{height:16px;display:block;margin:4px 2px 18px}
.card{background:#fff;border-radius:20px;padding:20px;box-shadow:0 2px 14px rgba(26,26,26,.05)}
h1{font-size:20px;margin:0 0 6px}p{font-size:14px;line-height:1.55;color:#6b5f57;margin:0 0 14px}
label{display:block;font-size:13px;font-weight:600;margin-bottom:7px}
input{width:100%;font-family:inherit;font-size:20px;letter-spacing:.3em;text-align:center;border:1.5px solid #e4ddd6;border-radius:14px;padding:13px;outline:none;background:#fff;color:#1a1a1a}input:focus{border-color:#c2552e}
input.fecha{letter-spacing:.06em}
.bt{display:block;width:100%;border:none;font-family:inherit;font-size:15px;font-weight:600;background:#c2552e;color:#fff;border-radius:99px;padding:14px;margin-top:14px;cursor:pointer}.bt:disabled{opacity:.45}
.bt2{display:block;width:100%;font-family:inherit;font-size:14px;font-weight:600;background:#fff;color:#1a1a1a;border:1.5px solid #e4ddd6;border-radius:99px;padding:12px;margin-top:10px;cursor:pointer;text-align:center;text-decoration:none}
.err{color:#b42318;font-size:13px;margin:10px 2px 0;min-height:1em}
.doc{border:1px solid #ece6df;border-radius:10px;padding:16px;max-height:46vh;overflow:auto;font-size:13px;line-height:1.6;color:#3c342f;background:#fff}
.doc .t{font-size:10.5px;font-weight:700;color:#c2552e;letter-spacing:.08em;text-transform:uppercase;margin:14px 0 4px}.doc .t:first-child{margin-top:0}.doc p{margin:0 0 6px;font-size:13px;color:#3c342f}
.dh{border-bottom:1px solid #eee6de;padding-bottom:10px;margin-bottom:14px}.dh1,.dh2{display:flex;justify-content:space-between;align-items:center;gap:10px}.dh1 img{height:12px}.dh1 span{font-size:11px;color:#7d7068}
.dh2{margin-top:8px}.dh2 b{font-size:12px;font-weight:600;color:#1a1a1a}.dh2 span{font-size:10.5px;color:#7d7068;white-space:nowrap}.nw{white-space:nowrap}
.chk{display:flex;gap:10px;align-items:flex-start;font-size:13.5px;line-height:1.45;margin:16px 0 12px;cursor:pointer}.chk input{width:20px;height:20px;flex:none;margin:1px 0 0;accent-color:#c2552e}
.sigw{position:relative}canvas{display:block;width:100%;height:150px;border:1.5px dashed #e3b9a6;border-radius:14px;background:#fdf9f6;touch-action:none}
.sigl{position:absolute;left:14px;bottom:10px;font-size:12px;color:#c8b6aa;pointer-events:none}.borra{position:absolute;right:8px;top:8px;border:none;background:#fff;border-radius:99px;font-family:inherit;font-size:12px;font-weight:600;color:#6b5f57;padding:5px 10px;cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,.08)}
.ok{width:58px;height:58px;border-radius:50%;background:#e8f5ec;color:#16803c;display:flex;align-items:center;justify-content:center;margin:10px auto 12px}.ok svg{width:28px;height:28px;fill:none;stroke:currentColor;stroke-width:2.6;stroke-linecap:round;stroke-linejoin:round}
.c{text-align:center}.pie{font-size:11.5px;color:#9a8f87;text-align:center;margin-top:18px;line-height:1.5}[hidden]{display:none!important}
</style></head><body><main><img class="logo" src="/informe/logo.png" alt="FISIO365">
<div class="card" id="v0"><p>Cargando…</p></div>
<div class="card" id="v1" hidden><h1 id="hola">Tu informe</h1><p>Para proteger tus datos de salud, confirma que eres tú.</p><label id="lab">4 últimos números de tu DNI</label><input id="dato" inputmode="numeric" autocomplete="off"><div class="err" id="e1"></div><button class="bt" id="b1">Continuar</button></div>
<div class="card" id="v2" hidden><div class="doc" id="doc"></div><label class="chk"><input type="checkbox" id="acepto"><span id="txtAcepto"></span></label><label>Firma con el dedo</label><div class="sigw"><canvas id="cv"></canvas><span class="sigl" id="sigl">Firma aquí</span><button class="borra" id="borra" type="button">Borrar</button></div><div class="err" id="e2"></div><button class="bt" id="b2" disabled>Firmar y recibir mi informe</button></div>
<div class="card c" id="v3" hidden><div class="ok"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></div><h1>Recibido</h1><p id="gracias">Ya puedes descargar tu informe.</p><button class="bt" id="b3">Descargar PDF</button><a class="bt2" href="/">Abrir la app de FISIO365</a></div>
<div class="pie">FISIO365 · Gran de Sant Andreu, 163 · Barcelona · 672 89 39 49</div></main>
<script>
const T=${JSON.stringify(tk)},$=i=>document.getElementById(i);let modo='dni',dato='',D=null;
const ver=n=>['v0','v1','v2','v3'].forEach(v=>$(v).hidden=v!==n);
const api=async(a,b)=>{const r=await fetch('/api/schedule?action='+a,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({t:T,...b})});return r.json().catch(()=>({ok:false,error:'Error de conexión'}));};
const esc=s=>String(s||'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const esTit=l=>(/^[A-ZÁÉÍÓÚÑÜ0-9 ,\\/·()-]{5,}$/.test(l)||(/^[^.;]{3,45}:$/.test(l)&&l.split(/\\s+/).length<=5))&&!/^- /.test(l);
(async()=>{const r=await api('inf-info',{});if(!r.ok){$('v0').innerHTML='<h1>Enlace no válido</h1><p>'+esc(r.error||'')+'</p>';return;}
 if(r.bloqueado){$('v0').innerHTML='<h1>Enlace bloqueado</h1><p>Por seguridad, se ha bloqueado tras varios intentos. Escríbenos y te mandamos uno nuevo.</p>';return;}
 if(r.caducado){$('v0').innerHTML='<h1>Enlace caducado</h1><p>Pídenos uno nuevo por WhatsApp y te lo mandamos al momento.</p>';return;}
 if(r.modo==='ninguno'){$('v0').innerHTML='<h1>No podemos abrirlo así</h1><p>Escríbenos y te damos el informe de otra manera.</p>';return;}
 modo=r.modo;if(r.pila)$('hola').textContent='Hola, '+r.pila;
 if(modo==='nac'){$('lab').textContent='Tu fecha de nacimiento (dd/mm/aaaa)';$('dato').classList.add('fecha');$('dato').placeholder='dd/mm/aaaa';}else{$('dato').maxLength=4;$('dato').placeholder='• • • •';}
 ver('v1');setTimeout(()=>$('dato').focus(),100);})();
$('dato').addEventListener('keydown',e=>{if(e.key==='Enter')$('b1').click();});
$('b1').onclick=async()=>{const b=$('b1');dato=$('dato').value.trim();if(!dato)return;b.disabled=true;b.textContent='Comprobando…';$('e1').textContent='';
 const r=await api('inf-ver',{dato});b.disabled=false;b.textContent='Continuar';
 if(!r.ok){$('e1').textContent=r.error||'No se ha podido comprobar';if(r.bloqueado||r.quedan===0){b.disabled=true;}return;}
 D=r;pintaDoc();if(r.firmado){fin();return;}ver('v2');prepFirma();};
function pintaDoc(){const ls=String(D.informe||'').split('\\n').map(l=>l.trim()).filter(Boolean);
 $('doc').innerHTML='<div class="dh"><div class="dh1"><img src="/informe/logo.png" alt=""><span>'+esc(D.fecha||'')+'</span></div><div class="dh2"><b>'+esc(/fisioterap/i.test(D.tipo)?'Informe fisioterapéutico':'Informe')+'</b>'+(D.codigo?'<span>Nº '+esc(D.codigo)+'</span>':'')+'</div></div>'+ls.map(l=>esTit(l)?'<div class="t">'+esc(l.replace(/:$/,''))+'</div>':'<p>'+esc(l.replace(/^- /,'– '))+'</p>').join('');
 $('txtAcepto').innerHTML=esc(D.texto).replace(/(INF-[A-Z0-9]+)/,'<span class="nw">$1</span>');}
let cv,cx,dib=false,hay=false;
function prepFirma(){cv=$('cv');const r=cv.getBoundingClientRect(),dp=window.devicePixelRatio||1;cv.width=r.width*dp;cv.height=r.height*dp;cx=cv.getContext('2d');cx.scale(dp,dp);cx.lineWidth=2.2;cx.lineCap='round';cx.lineJoin='round';cx.strokeStyle='#1a1a1a';
 const p=e=>{const b=cv.getBoundingClientRect();return[e.clientX-b.left,e.clientY-b.top];};
 cv.onpointerdown=e=>{dib=true;cv.setPointerCapture(e.pointerId);const[x,y]=p(e);cx.beginPath();cx.moveTo(x,y);};
 cv.onpointermove=e=>{if(!dib)return;const[x,y]=p(e);cx.lineTo(x,y);cx.stroke();if(!hay){hay=true;$('sigl').hidden=true;listo();}};
 cv.onpointerup=cv.onpointercancel=()=>{dib=false;};}
$('borra').onclick=()=>{if(!cx)return;cx.clearRect(0,0,cv.width,cv.height);hay=false;$('sigl').hidden=false;listo();};
const listo=()=>{$('b2').disabled=!(hay&&$('acepto').checked);};$('acepto').onchange=listo;
function firmaPng(){const w=Math.min(600,cv.width),h=Math.round(cv.height*w/cv.width),c=document.createElement('canvas');c.width=w;c.height=h;const x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,w,h);x.drawImage(cv,0,0,w,h);return c.toDataURL('image/png');}
$('b2').onclick=async()=>{const b=$('b2');b.disabled=true;b.textContent='Guardando…';$('e2').textContent='';
 const r=await api('inf-firmar',{dato,firma:firmaPng()});if(!r.ok){$('e2').textContent=r.error||'No se ha podido guardar';b.disabled=false;b.textContent='Firmar y recibir mi informe';return;}fin();};
function fin(){if(D&&D.pila)$('gracias').textContent='Gracias, '+D.pila+'. Ya puedes descargar tu informe.';ver('v3');}
$('b3').onclick=()=>{const b=$('b3');b.disabled=true;b.textContent='Preparando…';const go=()=>window.InformePDF.generar({paciente:D.paciente,informe:D.informe,zona:D.tipo,fisio:D.fisio,colegiado:D.colegiado,fecha:D.fecha,codigo:D.codigo}).catch(()=>alert('No se ha podido crear el PDF')).finally(()=>{b.disabled=false;b.textContent='Descargar PDF';});
 if(window.InformePDF)go();else{const s=document.createElement('script');s.src='/informe/pdf.js?v=3';s.onload=go;document.head.appendChild(s);}};
</script></body></html>`;
}

// ── Enlace de confirmar: vista previa con la cita (PNG), calendario (.ics) y racha de citas confirmadas ──
let _ogFonts = null;
async function ogFuentes() {
  if (_ogFonts) return _ogFonts;
  const F = require('./_fuentes'); _ogFonts = [Buffer.from(F.bold, 'base64'), Buffer.from(F.medium, 'base64')];
  return _ogFonts;
}
// Las letras se dibujan como trazos (sin depender de fuentes en el servidor)
let _ogOT = null;
function ogTipos() {
  if (_ogOT) return _ogOT;
  const ot = require('opentype.js'), F = require('./_fuentes');
  const ab = b64 => { const b = Buffer.from(b64, 'base64'); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); };
  _ogOT = { b: ot.parse(ab(F.bold)), m: ot.parse(ab(F.medium)) }; return _ogOT;
}
function ogTexto(font, txt, size, cx, y, ls, color) {
  txt = MARCA.marcar(String(txt), CLI);
  const g = font.stringToGlyphs(txt), sc = size / font.unitsPerEm; let w = 0;
  g.forEach((x, i) => { w += x.advanceWidth * sc + (i < g.length - 1 ? ls : 0); });
  let x = cx - w / 2, d = '';
  g.forEach(gl => { d += gl.getPath(x, y, size).toPathData(2); x += gl.advanceWidth * sc + ls; });
  return `<path d="${d}" fill="${color}"/>`;
}
function ogCitaSvg({ fecha, hora, fisio }) {
  const DL = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'], ML = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'], MS = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];
  const d = new Date(fecha + 'T12:00:00Z'), T = '#c2552e', K = '#2b2420', M = '#8a7d74', O = ogTipos();
  const t1 = `${DL[d.getUTCDay()]} ${d.getUTCDate()} de ${ML[d.getUTCMonth()]}`, ancho = O.b.getAdvanceWidth(t1, 100) / 100, sz = Math.min(36, Math.floor(360 / ancho));
  const t2 = 'A las ' + hora + (fisio ? ' · con ' + fisio : '');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600"><rect width="600" height="600" fill="#f6f1eb"/><rect x="60" y="60" width="480" height="480" rx="44" fill="#fff"/>`
    + `<g fill="none" stroke="${T}" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"><rect x="232" y="150" width="136" height="136" rx="22"/><path d="M232 190h136"/><path d="M270 136v28M330 136v28"/></g>`
    + ogTexto(O.m, MS[d.getUTCMonth()], 17, 300, 180, 3, T)
    + ogTexto(O.b, String(d.getUTCDate()), 62, 300, 266, 0, T)
    + ogTexto(O.b, t1, sz, 300, 384, 0, K)
    + ogTexto(O.m, t2, 23, 300, 426, 0, M)
    + ogTexto(O.m, 'Toca para confirmar', 21, 300, 466, 0, T) + `</svg>`;
}
// Vista previa (WhatsApp) del enlace de la encuesta: carita sonriente + nombre
function ogEncSvg({ pila, fisio, fin }) {
  const T = '#c2552e', K = '#2b2420', M = '#8a7d74', O = ogTipos(), t1 = pila ? `¿Qué tal, ${pila}?` : '¿Qué tal?', sz = t1.length > 15 ? Math.max(28, Math.round(40 * 15 / t1.length)) : 40;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600"><rect width="600" height="600" fill="#f6f1eb"/><rect x="60" y="60" width="480" height="480" rx="44" fill="#fff"/>`
    + `<g fill="none" stroke="${T}" stroke-width="5.5" stroke-linecap="round"><circle cx="300" cy="240" r="72"/><path d="M262 226 Q273 213 284 226"/><path d="M316 226 Q327 213 338 226"/><path d="M257 254 Q300 296 343 254"/></g>`
    + ogTexto(O.b, t1, sz, 300, 384, 0, K)
    + ogTexto(O.m, fin ? 'Tu experiencia en FISIO365' : fisio ? `Tu primera visita con ${fisio}` : 'Tu primera visita', 23, 300, 426, 0, M) + `</svg>`;
}
// Hora de Madrid → instante UTC (para el calendario)
function madridUTC(fecha, hora) {
  const [y, m, d] = fecha.split('-').map(Number), [hh, mm] = String(hora || '00:00').split(':').map(Number);
  let t = Date.UTC(y, m - 1, d, hh, mm);
  for (let i = 0; i < 2; i++) { const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(t)).map(x => [x.type, x.value]));
    const comoMadrid = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute); t += Date.UTC(y, m - 1, d, hh, mm) - comoMadrid; }
  return new Date(t);
}
const icsFecha = d => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
function calendarioCita(D, C) {
  const ini = madridUTC(D.fecha, D.hora), fin = new Date(ini.getTime() + 60 * 60e3), tit = `Fisioterapia en FISIO365${D.fisio ? ' con ' + D.fisio : ''}`, lug = String(C.direccion || '').replace(/ · /g, ', ');
  const esc = t => String(t).replace(/([,;\\])/g, '\\$1');
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//FISIO365//Citas//ES', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'BEGIN:VEVENT', `UID:${D.id}@fisioterapia365.com`, `DTSTAMP:${icsFecha(new Date())}`, `DTSTART:${icsFecha(ini)}`, `DTEND:${icsFecha(fin)}`, `SUMMARY:${esc(tit)}`, `LOCATION:${esc(lug)}`, `DESCRIPTION:${esc('Si no puedes venir, llámanos o escríbenos al ' + (C.tel || '') + '.')}`, 'BEGIN:VALARM', 'TRIGGER:-PT2H', 'ACTION:DISPLAY', `DESCRIPTION:${esc(tit)}`, 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  const g = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(tit)}&dates=${icsFecha(ini)}/${icsFecha(fin)}&location=${encodeURIComponent(lug)}`;
  return { ics, google: g };
}
// Racha: cuántas citas seguidas (hasta esta) tiene confirmadas el paciente
async function rachaConfirmadas(pid, fecha, hora) {
  try {
    const rs = []; let off = '';
    do { const d = await at(`tblTPlcuiSjQngkaD?filterByFormula=${encodeURIComponent(`AND(FIND('${pid}',ARRAYJOIN({PacienteRec})),OR(TRIM({ESTADO}&'')='REALIZADA',TRIM({ESTADO}&'')='PENDIENTE'),NOT(IS_AFTER({FECHA},DATETIME_PARSE('${fecha}','YYYY-MM-DD'))))`)}&fields[]=FECHA&fields[]=HORA&fields[]=CONFIR&pageSize=100${off ? '&offset=' + off : ''}`);
      if (d.error) throw new Error('Airtable'); rs.push(...(d.records || [])); off = d.offset || ''; } while (off && rs.length < 500);
    const k = c => String(c.fields.FECHA || '').slice(0, 10) + ' ' + String(c.fields.HORA || '').replace(/^(\d):/, '0$1:').slice(0, 5), yo = fecha + ' ' + hora;
    const L = rs.filter(c => k(c) <= yo).sort((a, b) => k(b).localeCompare(k(a)));
    let n = 0; for (const c of L) { if ((c.fields.CONFIR || []).some(x => /CONFIRMADA/i.test(x.name || x))) n++; else break; }
    return Math.max(1, n);
  } catch (e) { return 1; }
}


// ── TARJETA REGALO POR RECOMENDARNOS: página y vista previa (WhatsApp) ──
function ogTarjetaSvg({ imp, pila }) {
  const T = '#c2552e', K = '#2b2420', M = '#8a7d74', O = ogTipos(), t1 = pila ? `Gracias, ${pila}` : '¡Gracias!', sz = t1.length > 15 ? Math.max(28, Math.round(40 * 15 / t1.length)) : 40;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600"><rect width="600" height="600" fill="#f6f1eb"/><rect x="60" y="60" width="480" height="480" rx="44" fill="#fff"/>`
    + `<g fill="none" stroke="${T}" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"><rect x="232" y="176" width="136" height="104" rx="12"/><rect x="220" y="146" width="160" height="34" rx="10"/><path d="M300 146v134"/><path d="M300 146c-14-30-50-30-46-8 3 14 30 10 46 8zM300 146c14-30 50-30 46-8-3 14-30 10-46 8z"/></g>`
    + ogTexto(O.b, `${imp} € para ti`, 46, 300, 366, 0, T)
    + ogTexto(O.b, t1, sz - 10, 300, 412, 0, K)
    + ogTexto(O.m, 'por recomendarnos', 23, 300, 450, 0, M) + `</svg>`;
}
function paginaTarjeta(D) {
  const e = escHtml;
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Tu regalo · FISIO365</title>
<meta property="og:title" content="${e(D.imp)} € de regalo${D.pila ? ', ' + e(D.pila) : ''}"><meta property="og:description" content="Gracias por recomendarnos. Te lo descontamos en tu próxima sesión."><meta property="og:image" content="${e(D.og)}"><meta property="og:image:width" content="600"><meta property="og:image:height" content="600"><meta property="og:type" content="website">
<link rel="icon" href="https://app.fisioterapia365.com/icons/favicon-48.png"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>*{box-sizing:border-box}html,body{overflow-x:hidden}body{margin:0;font-family:Poppins,system-ui,sans-serif;background:#efebe5;color:#141414;min-height:100vh;display:flex;justify-content:center;padding:20px 16px}
.c{background:#fff;border-radius:26px;padding:30px 20px 24px;max-width:440px;width:100%;box-shadow:0 10px 30px rgba(20,20,20,.06);align-self:flex-start;text-align:center}
.reg{display:block;margin:0 auto;width:96px;height:96px;overflow:visible}.reg *{fill:none;stroke:#c2552e;stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round}
.reg .caja{stroke-dasharray:200;stroke-dashoffset:200;animation:dr .8s .1s ease-out forwards}.reg .tapa{transform-origin:48px 34px;animation:dr0 .01s forwards,abre .9s 1s cubic-bezier(.3,1.6,.5,1) both}.reg .lazo{opacity:0;animation:fi0 .3s .8s forwards}
.reg .tapa,.reg .lazo{stroke-dasharray:none}@keyframes abre{0%{transform:none}40%{transform:translateY(-12px) rotate(-14deg)}100%{transform:translateY(-6px) rotate(-8deg)}}
@keyframes dr{to{stroke-dashoffset:0}}@keyframes fi0{to{opacity:1}}@keyframes dr0{to{opacity:1}}
h1{font-size:23px;font-weight:700;margin:16px 0 4px;line-height:1.25}.sub{font-size:14.5px;color:#5c4f47;margin:0;line-height:1.5}
.tk{position:relative;margin:24px auto 0;background:#fdf1ea;border-radius:22px;padding:22px 18px 20px;overflow:hidden;animation:pop .6s 1.4s cubic-bezier(.3,1.5,.5,1) both}
.tk:before,.tk:after{content:'';position:absolute;top:50%;width:26px;height:26px;margin-top:-13px;border-radius:50%;background:#fff}.tk:before{left:-13px}.tk:after{right:-13px}
.tk small{display:block;font-size:11px;font-weight:700;letter-spacing:.18em;color:#c2552e}.tk b{display:block;font-size:52px;line-height:1.05;color:#c2552e;margin:6px 0 2px}.tk span{display:block;font-size:14px;color:#2b2420;font-weight:500}
.tk hr{border:none;border-top:2px dashed #f1d9cc;margin:16px 6px 12px}.tk em{display:block;font-style:normal;font-size:13px;color:#7d6a60}
@keyframes pop{from{opacity:0;transform:scale(.85)}to{opacity:1;transform:none}}
.pasos{margin:22px 0 0;text-align:left}.pa{display:flex;gap:11px;align-items:center;background:#faf7f4;border-radius:14px;padding:11px 12px;margin-bottom:7px;font-size:13.5px;color:#2b2420}.pa span{flex:none;width:32px;height:32px;border-radius:10px;background:#fff;display:flex;align-items:center;justify-content:center}.pa svg{width:18px;height:18px;fill:none;stroke:#c2552e;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}.pa small{display:block;font-size:12px;color:#7d6a60}
.bt{display:flex;align-items:center;justify-content:center;width:100%;margin-top:16px;font:600 16px Poppins,sans-serif;color:#fff;background:#c2552e;border-radius:14px;padding:15px;text-decoration:none;animation:resp 2.6s 2.2s ease-in-out infinite}@keyframes resp{0%,100%{box-shadow:0 0 0 0 rgba(194,85,46,0)}50%{box-shadow:0 0 0 7px rgba(194,85,46,.13)}}
.fi{opacity:0;transform:translateY(8px);animation:fi .5s forwards}@keyframes fi{to{opacity:1;transform:none}}.pie{margin-top:18px;font-size:12.5px;color:#7d6a60}
@media (prefers-reduced-motion:reduce){*{animation-duration:.01s!important;animation-delay:0s!important}}</style></head>
<body><div class="c"><svg class="reg" viewBox="0 0 96 96" aria-hidden="true"><path class="caja" d="M18 46h60v34a6 6 0 0 1-6 6H24a6 6 0 0 1-6-6z"/><path class="caja" d="M48 46v40"/><g class="tapa"><rect x="12" y="32" width="72" height="14" rx="5"/><path class="lazo" d="M48 32c-6-14-24-14-22-4 1.5 7 14 5 22 4zM48 32c6-14 24-14 22-4-1.5 7-14 5-22 4z"/></g></svg>
<h1 class="fi" style="animation-delay:.9s">¡Gracias${D.pila ? ', ' + e(D.pila) : ''}!</h1><p class="sub fi" style="animation-delay:1s">Por recomendarnos. Nos hace muchísima ilusión, así que aquí tienes tu regalo.</p>
<div class="tk"><small>TARJETA REGALO</small><b>${e(D.imp)} €</b><span>de descuento en tu próxima sesión</span><hr>${D.pila ? `<em>Para ${e(D.pila)}</em>` : ''}${D.cad ? `<em>Válida hasta el ${e(D.cad)}</em>` : ''}</div>
<div class="pasos fi" style="animation-delay:1.8s"><div class="pa"><span><svg viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg></span><div>No tienes que hacer nada<small>Ya lo tenemos apuntado en tu ficha</small></div></div><div class="pa"><span><svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="13" rx="3"/><path d="M3 10h18M7 15h4"/></svg></span><div>Te lo descontamos al pagar<small>En tu próxima sesión con nosotros</small></div></div></div>
<a class="bt fi" style="animation-delay:2s" href="${huecosSiempre(30)}">Reservar mi próxima sesión</a><p class="sub" style="font-size:12.5px;margin-top:10px">¿Prefieres que te lo busquemos nosotros? <a href="https://wa.me/34${String(D.tel || '672893949').replace(/\D/g, '').slice(-9)}?text=${encodeURIComponent('Hola, quiero reservar mi próxima sesión (tengo la tarjeta regalo)')}" target="_blank" rel="noopener" style="color:#c2552e;font-weight:600">Escríbenos</a></p><p class="pie">FISIO365 · ${e(D.dir)}</p></div></body></html>`;
}
// ── ENLACE PERSONAL DE LA APP (se manda por WhatsApp: ventajas, cómo instalarla y sus datos para entrar) ──
function firmaApp(id) { return require('crypto').createHmac('sha256', String(process.env.AIRTABLE_TOKEN || 'fisio365')).update('app:' + id).digest('hex').slice(0, 10); }
const enlaceApp = id => `https://app.fisioterapia365.com/a/${id}-${firmaApp(id)}`;
function ogAppSvg({ pila }) {
  const T = '#c2552e', K = '#2b2420', M = '#8a7d74', O = ogTipos(), t1 = pila ? `Tu app, ${pila}` : 'Tu app de FISIO365', sz = t1.length > 15 ? Math.max(28, Math.round(40 * 15 / t1.length)) : 40;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600"><rect width="600" height="600" fill="#f6f1eb"/><rect x="60" y="60" width="480" height="480" rx="44" fill="#fff"/>`
    + `<g fill="none" stroke="${T}" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"><rect x="256" y="160" width="88" height="152" rx="16"/><path d="M288 290h24"/><path d="M276 214 Q300 236 324 214"/><path d="M280 196h.01M320 196h.01" stroke-width="9"/></g>`
    + ogTexto(O.b, t1, sz, 300, 384, 0, K) + ogTexto(O.m, 'Tu fisio, también entre sesiones', 23, 300, 426, 0, M) + `</svg>`;
}
function paginaApp(D) {
  const J = JSON.stringify(D).replace(/</g, '\\u003c');
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Tu app · FISIO365</title>
<meta property="og:title" content="Tu app de FISIO365${D.pila ? ', ' + escHtml(D.pila) : ''}"><meta property="og:description" content="Tus ejercicios, el chat con tu fisio y tus citas. Aquí tienes tus datos para entrar."><meta property="og:image" content="${escHtml(D.url)}.png?v=1"><meta property="og:image:width" content="600"><meta property="og:image:height" content="600"><meta property="og:type" content="website">
<link rel="icon" href="https://app.fisioterapia365.com/icons/favicon-48.png"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>*{box-sizing:border-box}html,body{overflow-x:hidden;-webkit-text-size-adjust:100%}body{margin:0;font-family:Poppins,system-ui,sans-serif;background:#efebe5;color:#141414;min-height:100vh;display:flex;justify-content:center;padding:20px 16px}
.c{background:#fff;border-radius:26px;padding:28px 20px 22px;max-width:440px;width:100%;box-shadow:0 10px 30px rgba(20,20,20,.06);align-self:flex-start}
.cab{text-align:center}.mv{display:block;margin:0 auto;width:72px;height:96px;animation:sube .8s cubic-bezier(.2,.8,.3,1) both,flota 3.4s 1.4s ease-in-out infinite}.mv rect,.mv path{fill:none;stroke:#c2552e;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
.mv .cu{stroke-dasharray:140;stroke-dashoffset:140;animation:dr 1s .1s ease-out forwards}.mv .sm{stroke-dasharray:22;stroke-dashoffset:22;animation:dr .4s .9s ease-out forwards}.mv .oj{opacity:0;animation:fi0 .3s 1s forwards}
@keyframes sube{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}@keyframes flota{0%,100%{transform:none}50%{transform:translateY(-5px) rotate(-3deg)}}@keyframes dr{to{stroke-dashoffset:0}}@keyframes fi0{to{opacity:1}}
h1{font-size:23px;font-weight:700;margin:14px 0 4px;line-height:1.25}.sub{font-size:14.5px;color:#5c4f47;margin:0;line-height:1.5}
.vt{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:22px 0 0}.vt div{background:#faf7f4;border-radius:16px;padding:13px 12px}.vt span{display:flex;width:32px;height:32px;border-radius:10px;background:#fff;align-items:center;justify-content:center;margin-bottom:8px}
.vt svg,.st svg{width:18px;height:18px;fill:none;stroke:#c2552e;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}.vt b{display:block;font-size:13.5px;color:#2b2420;line-height:1.3}.vt small{display:block;font-size:12px;color:#7d6a60;line-height:1.4;margin-top:2px}
h2{font-size:15px;margin:26px 0 10px}
.acc{background:#fdf1ea;border-radius:16px;padding:2px 14px}.acc>div{display:flex;align-items:center;gap:10px;padding:11px 0}.acc>div+div{border-top:1px solid #f6dfd2}.acc .v{flex:1;min-width:0}.acc small{display:block;font-size:11.5px;color:#8a7d74}.acc b{display:block;font-size:15px;color:#2b2420;overflow-wrap:anywhere}.acc .pin b{font-size:21px;letter-spacing:.14em;color:#c2552e}
.cp{flex:none;border:none;background:#fff;border-radius:99px;padding:4px 10px;font:600 11.5px Poppins,sans-serif;color:#c2552e;cursor:pointer}
.so{display:flex;background:#faf7f4;border-radius:12px;padding:3px;gap:3px;margin-bottom:10px}.so button{flex:1;border:none;background:none;border-radius:9px;padding:9px;font:500 13px Poppins,sans-serif;color:#7d6a60;cursor:pointer}.so button.on{background:#c2552e;color:#fff;font-weight:600}
.bt{display:flex;align-items:center;justify-content:center;gap:9px;width:100%;font:600 16px Poppins,sans-serif;color:#fff;background:#c2552e;border:none;border-radius:14px;padding:15px;cursor:pointer;text-decoration:none;animation:resp 2.6s 1.5s ease-in-out infinite}@keyframes resp{0%,100%{box-shadow:0 0 0 0 rgba(194,85,46,0)}50%{box-shadow:0 0 0 7px rgba(194,85,46,.13)}}
.st{display:flex;gap:11px;align-items:center;background:#faf7f4;border-radius:14px;padding:11px 12px;margin-bottom:7px;font-size:13.5px;color:#2b2420}.st i{flex:none;width:24px;height:24px;border-radius:50%;background:#fff;color:#c2552e;font:700 12px Poppins,sans-serif;display:flex;align-items:center;justify-content:center;font-style:normal}.st svg{flex:none;margin-left:auto}
.nt{font-size:12px;color:#8a7d74;text-align:center;margin:10px 0 0}
.dud{margin-top:24px;background:#fdf1ea;border-radius:20px;padding:16px;text-align:center}.dud b{font-size:14.5px}.dud p{margin:4px 0 12px;font-size:13px;color:#7d6a60}.dud-b{display:flex;gap:8px}.dud-b a{flex:1;display:flex;align-items:center;justify-content:center;gap:7px;background:#fff;border-radius:12px;padding:10px;font:600 14px Poppins,sans-serif;color:#2b2420;text-decoration:none}.dud-b svg{width:17px;height:17px;fill:none;stroke:#c2552e;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.fi{opacity:0;transform:translateY(8px);animation:fi .5s forwards}@keyframes fi{to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){*{animation-duration:.01s!important;animation-delay:0s!important}}</style></head>
<body><div class="c" id="c"></div><script>(function(){var D=${J},C=document.getElementById('c');
function esc(t){return String(t==null?'':t).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
function sv(p){return '<svg viewBox="0 0 24 24" aria-hidden="true">'+p+'</svg>';}
var V=[['<rect x="3" y="5" width="18" height="14" rx="3"/><path d="m10 9.5 5 2.5-5 2.5z"/>','Tus ejercicios en vídeo','Preparados por tu fisio solo para ti'],['<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.6A8 8 0 1 1 21 12z"/>','Chat con tu fisio','Para cualquier duda, cuando la tengas'],['<rect x="4" y="5" width="16" height="15" rx="3"/><path d="M4 10h16M9 3v4M15 3v4"/>','Tus citas','A mano, y reserva cuando quieras'],['<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>','Tus documentos','Informes y justificantes, siempre contigo']];
var ios=/iPhone|iPad|iPod/i.test(navigator.userAgent)||(navigator.maxTouchPoints>1&&/Macintosh/.test(navigator.userAgent)),so=ios?'ios':'and';
var COMP='<path d="M12 3v12M8 7l4-4 4 4"/><path d="M6 11v8a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-8"/>',ADD='<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M12 8v8M8 12h8"/>';
function inst(){return so==='and'?'<a class="bt" href="'+D.play+'" target="_blank" rel="noopener">'+sv('<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>').replace('<svg','<svg style="width:20px;height:20px;fill:none;stroke:#fff;stroke-width:2;stroke-linecap:round;stroke-linejoin:round"')+'Descargar en Google Play</a><p class="nt">Se instala como cualquier app.</p>'
 :'<div class="st"><i>1</i><span>Abre <b>app.fisioterapia365.com</b> en Safari</span></div><div class="st"><i>2</i><span>Toca <b>Compartir</b></span>'+sv(COMP)+'</div><div class="st"><i>3</i><span>Elige <b>«Añadir a pantalla de inicio»</b></span>'+sv(ADD)+'</div><a class="bt" href="'+D.web+'" target="_blank" rel="noopener" style="margin-top:10px">Abrir en Safari</a>';}
function pinta(){C.innerHTML='<div class="cab"><svg class="mv" viewBox="0 0 48 64" aria-hidden="true"><rect class="cu" x="8" y="4" width="32" height="56" rx="7"/><path class="oj" d="M18 22h.01M30 22h.01" stroke-width="3.4"/><path class="sm" d="M17 30 Q24 37 31 30"/><path d="M20 52h8"/></svg>'
 +'<h1 class="fi" style="animation-delay:.6s">Tu app'+(D.pila?', '+esc(D.pila):'')+'</h1><p class="sub fi" style="animation-delay:.7s">Tu fisio te acompaña también entre sesiones.</p></div>'
 +'<div class="vt">'+V.map(function(v,i){return '<div class="fi" style="animation-delay:'+(.85+i*.08)+'s"><span>'+sv(v[0])+'</span><b>'+v[1]+'</b><small>'+v[2]+'</small></div>';}).join('')+'</div>'
 +'<h2 class="fi" style="animation-delay:1.2s">Tus datos para entrar</h2><div class="acc fi" style="animation-delay:1.25s"><div><div class="v"><small>Usuario</small><b>'+esc(D.usuario)+'</b></div><button class="cp" data-c="'+esc(D.usuario)+'">Copiar</button></div><div class="pin"><div class="v"><small>PIN</small><b>'+esc(D.pin)+'</b></div><button class="cp" data-c="'+esc(D.pin)+'">Copiar</button></div></div>'
 +'<h2 class="fi" style="animation-delay:1.3s">Instálala</h2><div class="fi" style="animation-delay:1.35s"><div class="so"><button data-s="and"'+(so==='and'?' class="on"':'')+'>Android</button><button data-s="ios"'+(so==='ios'?' class="on"':'')+'>iPhone</button></div><div id="in">'+inst()+'</div></div>'
 +'<div class="dud"><b>¿Te ayudamos a instalarla?</b><p>Escríbenos o llámanos y lo hacemos contigo en un minuto.</p><div class="dud-b"><a href="https://wa.me/34'+D.tel.replace(/\\D/g,'').slice(-9)+'?text='+encodeURIComponent('Hola, necesito ayuda para instalar la app')+'" target="_blank" rel="noopener">'+sv('<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.6A8 8 0 1 1 21 12z"/>')+'WhatsApp</a><a href="tel:'+D.tel.replace(/\\s/g,'')+'">'+sv('<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>')+'Llamar</a></div></div>';
 [].forEach.call(C.querySelectorAll('.so button'),function(b){b.onclick=function(){so=b.getAttribute('data-s');[].forEach.call(C.querySelectorAll('.so button'),function(x){x.classList.toggle('on',x===b);});document.getElementById('in').innerHTML=inst();};});
 [].forEach.call(C.querySelectorAll('.cp'),function(b){b.onclick=function(){var t=b.getAttribute('data-c');try{navigator.clipboard.writeText(t);}catch(e){}b.textContent='¡Copiado!';setTimeout(function(){b.textContent='Copiar';},1500);};});}
pinta();})();<\/script></body></html>`;
}
// ── RESERVAR DESDE UN ENLACE DE HUECOS LIBRES (se manda por WhatsApp; vale para pacientes y gente nueva) ──
// El enlace lleva los días y fisios elegidos al mandarlo, firmado para que no se pueda cambiar.
function firmaHuecos(k) { return require('crypto').createHmac('sha256', String(process.env.AIRTABLE_TOKEN || 'fisio365')).update('huecos:' + k).digest('hex').slice(0, 8); }
// Enlace «siempre al día»: {r:30} = desde hoy hasta dentro de 30 días, se calcula al abrirlo
const huecosDec = k => { try { const o = JSON.parse(Buffer.from(String(k), 'base64url').toString('utf8'));
    if (o && Number(o.r) > 0) { const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date()), d = new Date(hoy + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + Math.min(90, Number(o.r))); return { a: hoy, b: d.toISOString().slice(0, 10), f: Array.isArray(o.f) ? o.f.map(String) : [], p: Number(o.p) > 0 ? Number(o.p) : 0 }; }
    return o && /^\d{4}-\d{2}-\d{2}$/.test(o.a) && /^\d{4}-\d{2}-\d{2}$/.test(o.b) ? { a: o.a, b: o.b, f: Array.isArray(o.f) ? o.f.map(String) : [], p: Number(o.p) > 0 ? Number(o.p) : 0 } : null; } catch (e) { return null; } };
const huecosSiempre = (dias, f) => { const k = Buffer.from(JSON.stringify({ r: dias, f: f || [] })).toString('base64url'); return `https://app.fisioterapia365.com/h/${k}.${firmaHuecos(k)}`; };
const huecosEnlace = (a, b, f, p) => { const k = Buffer.from(JSON.stringify(Object.assign({ a, b, f: f || [] }, p > 0 ? { p } : {}))).toString('base64url'); return `https://app.fisioterapia365.com/h/${k}.${firmaHuecos(k)}`; };
const HUECO_LIBRE = /^(CITA LIBRE|LIBRE - SIN BOMBA)$/, HUECO_NOFISIO = /^(NO HAY FISIO|TODOS|\?\?|FIESTA ANIVERSARIO|JULES|NORA)$/i;
const madridAhora = () => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date()).map(x => [x.type, x.value])); return { f: `${p.year}-${p.month}-${p.day}`, h: `${String(+p.hour % 24).padStart(2, '0')}:${p.minute}` }; };
function huecoValido(F, P) {
  const nm = v => (v && typeof v === 'object') ? (v.name || '') : (v || ''), est = String(nm(F['ESTADO'])).trim(), fisio = String(nm(F['PREF.'])).trim();
  const fecha = String(F['FECHA'] || '').slice(0, 10), hora = String(F['HORA'] || '').replace(/^(\d):/, '0$1:').slice(0, 5), ya = madridAhora();
  if (!HUECO_LIBRE.test(est) || !fisio || HUECO_NOFISIO.test(fisio) || !/^\d{2}:\d{2}$/.test(hora)) return null;
  if (fecha < P.a || fecha > P.b || fecha < ya.f || (fecha === ya.f && hora <= ya.h)) return null;
  if (P.f.length && !P.f.includes(fisio)) return null;
  return { fecha, hora, fisio, sb: est === 'LIBRE - SIN BOMBA' };
}
async function huecosLibres(P) {
  const ya = madridAhora(), a = P.a > ya.f ? P.a : ya.f; let recs = [], off = '';
  do { const d = await at(`tblTPlcuiSjQngkaD?filterByFormula=${encodeURIComponent(`AND(OR(TRIM({ESTADO})='CITA LIBRE',TRIM({ESTADO})='LIBRE - SIN BOMBA'),NOT(IS_BEFORE({FECHA},DATETIME_PARSE('${a}','YYYY-MM-DD'))),NOT(IS_AFTER({FECHA},DATETIME_PARSE('${P.b}','YYYY-MM-DD'))))`)}&fields[]=FECHA&fields[]=HORA&fields[]=ESTADO&fields[]=PREF.&pageSize=100${off ? '&offset=' + off : ''}`);
    if (d.error) throw new Error('Airtable'); recs = recs.concat(d.records || []); off = d.offset || ''; } while (off && recs.length < 1500);
  const cap = t => t ? t.charAt(0).toUpperCase() + t.slice(1).toLowerCase() : '';
  return recs.map(r => { const h = huecoValido(r.fields || {}, P); return h ? { id: r.id, ...h, nombre: cap(h.fisio.split(' ')[0]) } : null; }).filter(Boolean).sort((x, y) => (x.fecha + x.hora + x.fisio).localeCompare(y.fecha + y.hora + y.fisio));
}
function ogHuecosSvg(P) {
  const T = '#c2552e', K = '#2b2420', M = '#8a7d74', O = ogTipos(), MS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const f = x => { const d = new Date(x + 'T12:00:00Z'); return `${d.getUTCDate()} ${MS[d.getUTCMonth()]}`; };
  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600"><rect width="600" height="600" fill="#f6f1eb"/><rect x="60" y="60" width="480" height="480" rx="44" fill="#fff"/>`
    + `<g fill="none" stroke="${T}" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"><rect x="236" y="150" width="128" height="122" rx="20"/><path d="M236 190h128M270 134v30M330 134v30"/><path d="M276 232l16 16 34-34"/></g>`
    + ogTexto(O.b, 'Elige tu hueco', 40, 300, 362, 0, K)
    + ogTexto(O.m, 'Toca la hora y queda reservada', 23, 300, 404, 0, M)
    + ogTexto(O.m, `Del ${f(P.a)} al ${f(P.b)}`, 21, 300, 450, 0, T) + `</svg>`;
}
function paginaHuecos(D) {
  const J = JSON.stringify(D).replace(/</g, '\\u003c');
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Reserva tu cita · FISIO365</title>
<meta property="og:title" content="Elige tu hueco en FISIO365"><meta property="og:description" content="Toca la hora que te vaya bien y queda reservada."><meta property="og:image" content="${D.url}.png?v=1"><meta property="og:image:width" content="600"><meta property="og:image:height" content="600"><meta property="og:type" content="website">
<link rel="icon" href="https://app.fisioterapia365.com/icons/favicon-48.png"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>*{box-sizing:border-box}html,body{overflow-x:hidden;-webkit-text-size-adjust:100%}body{margin:0;font-family:Poppins,system-ui,sans-serif;background:#efebe5;color:#141414;min-height:100vh;display:flex;justify-content:center;padding:20px 16px}
.c{background:#fff;border-radius:26px;padding:28px 20px 22px;max-width:440px;width:100%;box-shadow:0 10px 30px rgba(20,20,20,.06);align-self:flex-start}
.pgn{background:#fdf1ea;color:#7d4a35;border-radius:14px;padding:11px 13px;font-size:13px;line-height:1.5;margin:4px 0 8px;text-align:left}.pgn b{color:#a3441f}
.cab{text-align:center}.fc{display:block;margin:0 auto}.fc circle,.fc path{stroke:#c2552e;fill:none;stroke-width:3;stroke-linecap:round}
.fc .o{stroke-dasharray:202;stroke-dashoffset:202;animation:dr .9s cubic-bezier(.6,0,.2,1) forwards}.fc .m{stroke-dasharray:44;stroke-dashoffset:44;animation:dr .45s .7s ease-out forwards}
.fc .ey{fill:#c2552e;stroke:none;opacity:0;transform-box:fill-box;transform-origin:center;animation:fi0 .3s .9s forwards,blink 5s 3.4s infinite}.fc .ojos{animation:mira 5s 2.4s ease-in-out infinite}
@keyframes mira{0%,30%,100%{transform:none}38%,62%{transform:translateY(3.5px)}}@keyframes blink{0%,94%,100%{transform:scaleY(1)}97%{transform:scaleY(.1)}}@keyframes dr{to{stroke-dashoffset:0}}@keyframes fi0{to{opacity:1}}
h1{font-size:23px;font-weight:700;margin:14px 0 4px;line-height:1.25}.sub{font-size:14.5px;color:#5c4f47;margin:0;line-height:1.5}
.dia{display:flex;gap:14px;margin-top:14px;background:#faf7f4;border-radius:20px;padding:14px}
.tile{flex:none;width:58px;border-radius:14px;overflow:hidden;background:#fff;box-shadow:0 0 0 1.5px #efe6de;text-align:center;align-self:flex-start}
.tile i{display:block;font-style:normal;background:#c2552e;color:#fff;font-size:10px;font-weight:700;letter-spacing:.14em;padding:4px 0 3px}.tile b{display:block;font-size:24px;line-height:1;margin:7px 0 2px;color:#2b2420}.tile small{display:block;font-size:10.5px;color:#8a7d74;padding-bottom:7px}
.hz{flex:1;min-width:0}.dn{font-size:13.5px;font-weight:600;color:#2b2420;margin:2px 0 8px}
.fis{display:inline-block;font-size:11.5px;font-weight:500;color:#7d6a60;background:#fff;border-radius:99px;padding:2px 9px;margin:6px 0 7px}.fis:first-child{margin-top:0}
.hs{display:flex;flex-wrap:wrap;gap:7px}
.h{border:1.5px solid #f1d9cc;background:#fff;color:#c2552e;border-radius:12px;padding:8px 0;width:calc(33.33% - 5px);font:600 14.5px Poppins,sans-serif;cursor:pointer;transition:transform .15s,background .15s,color .15s;opacity:0;animation:pop .35s forwards}
.h:hover{background:#fdf1ea}.h:active{transform:scale(.94)}.h.on{background:#c2552e;color:#fff;border-color:#c2552e}.h.sb{border-style:dashed;color:#8a7d74;border-color:#e6ddd5}
@keyframes pop{from{opacity:0;transform:scale(.85)}to{opacity:1;transform:none}}
.pasos{display:flex;align-items:flex-start;justify-content:center;gap:6px;margin:22px 0 40px;font-size:11.5px;line-height:1.35;color:#7d6a60;text-align:center}.pasos div{flex:1;max-width:110px}.pasos span{display:flex;align-items:center;justify-content:center;width:24px;height:24px;margin:0 auto 5px;border-radius:50%;background:#fdf1ea;color:#c2552e;font-weight:700;font-size:12px}.pasos i{flex:none;width:18px;height:1.5px;background:#f1d9cc;margin-top:12px}
.ley{font-size:11.5px;color:#a3968c;margin:12px 0 0;text-align:center}
.fondo{position:fixed;inset:0;background:rgba(20,20,20,.35);display:flex;align-items:flex-end;justify-content:center;opacity:0;transition:opacity .2s;z-index:5}.fondo.on{opacity:1}
.hoja{background:#fff;border-radius:26px 26px 0 0;padding:10px 20px 24px;width:100%;max-width:440px;max-height:92vh;overflow-y:auto;overscroll-behavior:contain;transform:translateY(40px);transition:transform .3s cubic-bezier(.2,.8,.3,1)}.fondo.on .hoja{transform:none}
.asa{width:38px;height:4px;border-radius:4px;background:#e6ddd5;margin:0 auto 14px}
.sel{display:flex;gap:12px;align-items:center;background:#fdf1ea;border-radius:18px;padding:12px;margin-bottom:6px}.sel .tile{box-shadow:none}.sel small{display:block;font-size:12px;color:#8a7d74}.sel b{display:block;font-size:16px;line-height:1.3}
label{display:block;font-size:12.5px;font-weight:500;color:#7d6a60;margin:12px 0 5px}input,textarea{width:100%;min-width:0;border:1.5px solid #efe6de;background:#faf7f4;border-radius:14px;padding:11px 13px;font:400 16px Poppins,sans-serif;color:#141414;outline:none;transition:border-color .2s,background .2s}input:focus,textarea:focus{border-color:#c2552e;background:#fff}textarea{min-height:78px;resize:vertical}
.dos{display:flex;gap:8px}.dos>div{flex:1;min-width:0}.err{font-size:13px;color:#b42318;min-height:18px;margin:8px 0 0}
.bt{width:100%;font:600 16px Poppins,sans-serif;color:#fff;background:#c2552e;border:none;border-radius:14px;padding:15px;cursor:pointer;margin-top:6px;animation:resp 2.6s 1s ease-in-out infinite}.bt:disabled{opacity:.6;animation:none}@keyframes resp{0%,100%{box-shadow:0 0 0 0 rgba(194,85,46,0)}50%{box-shadow:0 0 0 7px rgba(194,85,46,.13)}}
.cancel{width:100%;background:none;border:none;color:#8a7d74;font:500 14px Poppins,sans-serif;padding:12px 12px 2px;cursor:pointer}
.ok{text-align:center;padding:6px 0 4px}.ok .tile{margin:18px auto 0;width:74px}.ok .tile b{font-size:30px}.ok .tile{animation:col 1.4s 1.2s ease-in-out both;transform-origin:50% 0}
@keyframes col{0%{transform:rotate(-12deg)}30%{transform:rotate(8deg)}55%{transform:rotate(-5deg)}78%{transform:rotate(2deg)}100%{transform:none}}
.okh{font-size:15px;font-weight:600;color:#c2552e;margin:10px 0 0}
.faq{margin-top:28px}.faq h3{display:flex;align-items:center;gap:8px;font-size:15px;margin:0 0 10px}.faq h3 svg{width:19px;height:19px}
.faq details{background:#faf7f4;border-radius:16px;margin-bottom:8px;transition:background .2s}.faq details[open]{background:#fdf6f2}
.faq summary{list-style:none;cursor:pointer;display:flex;align-items:center;gap:11px;padding:12px 14px;font-size:14px;font-weight:500;color:#2b2420}.faq summary::-webkit-details-marker{display:none}
.faq summary .ic{flex:none;width:32px;height:32px;border-radius:10px;background:#fff;display:flex;align-items:center;justify-content:center}.ic svg,.faq h3 svg{fill:none;stroke:#c2552e;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}.ic svg{width:18px;height:18px}
.faq summary .tx{flex:1}.faq summary .ch{flex:none;width:22px;height:22px;border-radius:50%;background:#fff;position:relative}.faq summary .ch:after{content:'';position:absolute;left:8px;top:6px;width:5px;height:5px;border-right:1.5px solid #c2552e;border-bottom:1.5px solid #c2552e;transform:rotate(45deg);transition:transform .2s}.faq details[open] .ch:after{transform:translate(0,3px) rotate(-135deg)}
.fa{padding:0 16px 14px 57px;font-size:13.5px;color:#5c4f47;line-height:1.55;animation:fi .3s}.fa p{margin:0 0 9px}.fa .st{margin:12px 0 4px;font-size:12px;font-weight:600;color:#c2552e}.fa ul{margin:0 0 6px;padding-left:16px}.fa li{margin:0 0 5px}.fa li::marker{color:#c2552e}.fa .pz{margin-top:8px;background:#fff;border-radius:10px;padding:7px 12px;display:inline-block}.fa .nt{font-size:12.5px;color:#8a7d74}
.fa{padding:0 14px 14px!important}.fa .in{margin:0 0 7px!important;background:#fff;border-radius:14px;padding:11px 12px;font-size:13.5px;color:#5c4f47}
.tq{display:flex;gap:11px;background:#fff;border-radius:14px;padding:11px 12px;margin-bottom:7px}.tq>div>b{display:block;font-size:13.5px;color:#2b2420;margin-bottom:2px}.tq p b{color:#2b2420}.tq p{margin:0!important;font-size:12.5px;color:#7d6a60;line-height:1.5}.tq p.inp{font-size:13.5px;color:#5c4f47}
.tqi{flex:none;width:32px;height:32px;border-radius:10px;background:#fdf1ea;display:flex;align-items:center;justify-content:center}.tqi svg{width:18px;height:18px;fill:none;stroke:#c2552e;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
.chs{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px}.chs span{background:#fff;border-radius:99px;padding:5px 11px;font-size:12px;color:#5c4f47}.chs span:before{content:'';display:inline-block;width:5px;height:5px;border-radius:50%;background:#c2552e;margin:0 6px 1px 0;vertical-align:middle}
.appc{background:#fff;border-radius:16px;padding:12px;margin:10px 0 8px;box-shadow:0 0 0 1.5px #f1d9cc}.apph{display:flex;gap:11px;align-items:center;margin-bottom:8px}.apph b{display:block;font-size:14px;color:#2b2420}.apph small{font-size:12px;color:#8a7d74}.apph .tqi{background:#c2552e}.apph .tqi svg{stroke:#fff}
.appc ul{list-style:none;margin:0;padding:0}.appc li{display:flex;gap:8px;align-items:flex-start;font-size:12.5px;color:#5c4f47;padding:5px 0;border-top:1px solid #f6f1eb}.appc li svg{flex:none;width:15px;height:15px;margin-top:2px;fill:none;stroke:#16803c;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}.appc b{color:#2b2420}
.pzf{display:flex;justify-content:space-between;align-items:center;background:#fff;border-radius:14px;padding:11px 14px}.pzf{gap:12px}.pzf span{flex:1;min-width:0;font-size:12.5px;color:#7d6a60;line-height:1.35}.pzf span small{display:block;font-size:11.5px;color:#a3968c}.pzf b{flex:none;white-space:nowrap;font-size:20px;color:#c2552e}
.big{background:#fff;border-radius:14px;padding:14px;text-align:center;margin-bottom:7px}.big b{display:block;font-size:26px;color:#c2552e;line-height:1.1}.big span{display:block;font-size:12.5px;color:#7d6a60;margin-top:3px}.big strong{color:#2b2420;font-weight:600}
.fa .st{margin:18px 2px 10px!important}
.pzs{display:flex;gap:8px}.pzs div{flex:1;background:#fff;border-radius:14px;padding:12px;text-align:center}.pzs small{display:block;font-size:11.5px;color:#8a7d74;line-height:1.3;min-height:30px}.pzs b{display:block;font-size:24px;color:#c2552e;line-height:1.1;margin:4px 0 2px}.pzs span{font-size:11.5px;color:#a3968c}
.pkt{margin:16px 0 8px!important;font-weight:600;color:#2b2420;text-align:center;font-size:13.5px}
.tabs{display:flex;background:#fff;border-radius:12px;padding:3px;gap:3px;margin-bottom:8px}.tabs button{flex:1;white-space:nowrap;border:none;background:none;border-radius:9px;padding:8px 2px;font:500 11.5px Poppins,sans-serif;color:#7d6a60;cursor:pointer}.tabs button.on{background:#c2552e;color:#fff;font-weight:600}
.pks{display:flex;gap:6px;margin-bottom:8px}.pks[hidden]{display:none}.pkc{flex:1;min-width:0;background:#fff;border-radius:14px;padding:12px 4px 10px;text-align:center;animation:fi .3s}.pkc b{display:block;font-size:22px;line-height:1;color:#2b2420}.pkc small{display:block;font-size:11px;color:#8a7d74;margin-bottom:8px}.pkc strong{display:block;font-size:15px;color:#2b2420}.pkc em{display:block;white-space:nowrap;font-style:normal;font-size:10.5px;color:#8a7d74;margin:1px 0 6px}.pkc u{display:inline-block;white-space:nowrap;text-decoration:none;font-size:10px;font-weight:600;color:#16803c;background:#ecf8f0;border-radius:99px;padding:2px 6px}
@media(max-width:360px){.fa{padding-left:16px}.fa .tf{margin-left:0}}
.tf{background:#fff;border-radius:14px;padding:12px 14px 4px;margin:0 0 10px}.tf-h{display:flex;justify-content:space-between;align-items:baseline;gap:10px;margin-bottom:6px}.tf-h b{font-size:14px;color:#2b2420;line-height:1.3}.tf-h span{flex:none;white-space:nowrap;font-weight:700;color:#c2552e;font-size:16px}.tf-h small{font-size:11px;font-weight:500;color:#8a7d74}
.pk{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:8px 0;border-top:1px solid #f6f1eb}.pk b{display:block;font-size:13.5px;color:#2b2420}.pk small{display:block;font-size:12px;color:#8a7d74}.pk .pr{text-align:right;flex:none}.pk .pr small{color:#16803c;font-weight:600}
.dud{margin-top:20px;background:#fdf1ea;border-radius:20px;padding:18px 16px;text-align:center}.dud svg.cr{width:30px;height:30px;fill:none;stroke:#c2552e;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round;display:block;margin:0 auto 6px}.dud b{font-size:15px;display:block;line-height:1.35}.dud p{margin:5px 0 14px;font-size:13px;color:#7d6a60;line-height:1.5}
.dud-b{display:flex;gap:8px}.dud-b a{flex:1;display:flex;align-items:center;justify-content:center;gap:7px;background:#fff;border-radius:12px;padding:11px;font:600 14px Poppins,sans-serif;color:#2b2420;text-decoration:none}.dud-b svg{width:17px;height:17px;fill:none;stroke:#c2552e;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.fi{opacity:0;transform:translateY(8px);animation:fi .5s forwards}@keyframes fi{to{opacity:1;transform:none}}.pie{margin-top:18px;font-size:12.5px;color:#7d6a60;line-height:1.6;text-align:center}.pie a{color:#7d6a60}
@media (prefers-reduced-motion:reduce){*{animation-duration:.01s!important;animation-delay:0s!important}}</style></head>
<body><div class="c" id="c"></div><script>(function(){var D=${J},C=document.getElementById('c');
var DS=['domingo','lunes','martes','miércoles','jueves','viernes','sábado'],MS=['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
function fl(f){var d=new Date(f+'T12:00:00');return DS[d.getDay()]+' '+d.getDate()+' de '+MS[d.getMonth()];}
var DA=['DOM','LUN','MAR','MIÉ','JUE','VIE','SÁB'],MA=['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
function tile(f){var d=new Date(f+'T12:00:00');return '<div class="tile"><i>'+DA[d.getDay()]+'</i><b>'+d.getDate()+'</b><small>'+MA[d.getMonth()]+'</small></div>';}
var IC={eur:'<path d="M17 6.5A6.5 6.5 0 1 0 17 17.5"/><path d="M5 10.5h8M5 13.5h8"/>',uno:'<rect x="4" y="5" width="16" height="15" rx="3"/><path d="M4 10h16M9 3v4M15 3v4M9.5 15l2 2 3.5-3.5"/>',man:'<path d="M7 12V6.5a1.5 1.5 0 0 1 3 0V11M10 10V5a1.5 1.5 0 0 1 3 0v6M13 10.5V6.5a1.5 1.5 0 0 1 3 0V13M16 11a1.5 1.5 0 0 1 3 0v3a7 7 0 0 1-7 7h-1a6 6 0 0 1-5-2.7L3.4 14.5a1.5 1.5 0 0 1 2.5-1.6L7 14.5"/>',ray:'<path d="M13 3 5 13.5h6L10 21l8-10.5h-6z"/>',flor:'<path d="M12 20c-4.5 0-8.5-3-8.5-8 3.5 0 6.5 2 8.5 5 2-3 5-5 8.5-5 0 5-4 8-8.5 8z"/><path d="M12 17c-2.2-3.4-2.2-7.6 0-11.5 2.2 3.9 2.2 8.1 0 11.5z"/>',pre:'<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>',rel:'<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2M9 2.5h6"/>',bol:'<path d="M5 8h14l-1 12H6z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',tar:'<rect x="3" y="6" width="18" height="13" rx="3"/><path d="M3 10h18M7 15h4"/>'};
function sm(ic,t){return '<summary><span class="ic"><svg viewBox="0 0 24 24">'+IC[ic]+'</svg></span><span class="tx">'+t+'</span><span class="ch"></span></summary>';}
var cara='<svg class="fc" width="84" height="84" viewBox="0 0 80 80" aria-hidden="true"><circle class="o" cx="40" cy="40" r="32" transform="rotate(-90 40 40)"/><g class="ojos"><ellipse class="ey" cx="30" cy="33" rx="2.6" ry="3.2"/><ellipse class="ey" cx="50" cy="33" rx="2.6" ry="3.2"/></g><path class="m" d="M30 47 Q40 54 50 47"/></svg>';
function esc(t){return String(t==null?'':t).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
var wa='https://wa.me/34'+D.tel.replace(/\\D/g,'').slice(-9)+'?text='+encodeURIComponent('Hola, tengo una duda antes de reservar mi cita');
var dudas='<div class="dud"><svg class="cr" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 14v-2a8 8 0 0 1 16 0v2"/><rect x="3" y="13" width="4" height="6" rx="1.5"/><rect x="17" y="13" width="4" height="6" rx="1.5"/><path d="M19 19c0 1.5-2 2.5-5 2.5"/></svg><b>¿Tienes dudas o prefieres hablar antes con nosotros?</b><p>Llámanos o escríbenos siempre que quieras, para cualquier cosa. Te atenderá con mucho gusto una persona de nuestro equipo, nada de robots ni contestadores.</p><div class="dud-b"><a href="'+wa+'" target="_blank" rel="noopener"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.6A8 8 0 1 1 21 12z"/></svg>WhatsApp</a><a href="tel:'+esc(D.tel.replace(/\\s/g,''))+'"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/></svg>Llamar</a></div></div>';
var pie='<div class="pie">'+esc(D.dir)+'</div>';
var PK=[['Fisioterapia convencional',65,[[5,310],[10,585],[20,1100]]],['Fisioterapia avanzada y suelo pélvico',75,[[5,345],[10,640],[20,1220]]]];
function eu(n){var t=n%1?n.toFixed(2).replace('.',','):String(n);return t.replace(/\\B(?=(\\d{3})+(?!\\d))/g,'.')+' €';}
var tarifas='<div class="pzs"><div><small>Convencional</small><b>65 €</b><span>sesión suelta</span></div><div><small>Avanzada y suelo pélvico</small><b>75 €</b><span>sesión suelta</span></div></div><p class="pkt">Con un pack, cada sesión te sale más barata</p><div class="tabs">'+PK.map(function(t,i){return '<button type="button" data-t="'+i+'"'+(i?'':' class="on"')+'>'+(i?'Avanzada / Suelo pélvico':'Convencional')+'</button>';}).join('')+'</div>'+PK.map(function(t,i){return '<div class="pks" data-p="'+i+'"'+(i?' hidden':'')+'>'+t[2].map(function(p){return '<div class="pkc"><b>'+p[0]+'</b><small>sesiones</small><strong>'+eu(p[1])+'</strong><em>'+eu(p[1]/p[0])+' / sesión</em><u>Ahorras '+eu(t[1]*p[0]-p[1])+'</u></div>';}).join('')+'</div>';}).join('');
var IC2={mano:IC.man,wave:'<path d="M2.5 12h3.5l2.5-6 4 12 2.5-6h6.5"/>',pesa:'<path d="M6.5 6.5v11M17.5 6.5v11M3.5 9v6M20.5 9v6M6.5 12h11"/>',iman:'<path d="M5 3h4v8a3 3 0 0 0 6 0V3h4v8a7 7 0 0 1-14 0z"/><path d="M5 7h4M15 7h4"/>',onda:'<circle cx="6" cy="12" r="1.5"/><path d="M10 8.5a5 5 0 0 1 0 7M13.5 6a8.5 8.5 0 0 1 0 12M17 3.5a12 12 0 0 1 0 17"/>',calor:'<path d="M8 20c-2-2-2-4 0-6s2-4 0-6M12 20c-2-2-2-4 0-6s2-4 0-6M16 20c-2-2-2-4 0-6s2-4 0-6"/>',lupa:'<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.3-4.3"/>',ropa:'<path d="M8 3 3.5 6 5.5 10 7.5 9v12h9V9l2 1 2-4L16 3a4 4 0 0 1-8 0z"/>',doc:'<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',cha:'<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.6A8 8 0 1 1 21 12z"/>',ok:'<path d="m5 12.5 4.5 4.5L19 7.5"/>'};
function T(ic,t,x){return '<div class="tq"><span class="tqi"><svg viewBox="0 0 24 24">'+IC2[ic]+'</svg></span><div><b>'+t+'</b><p>'+x+'</p></div></div>';}
function CH(t,L){return '<p class="st">'+t+'</p><div class="chs">'+L.map(function(x){return '<span>'+x+'</span>';}).join('')+'</div>';}
var APP='<div class="appc"><div class="apph"><span class="tqi"><svg viewBox="0 0 24 24"><rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M10.5 18.5h3"/></svg></span><div><b>Y además, tu app de FISIO365</b><small>Tu fisio te acompaña también entre sesiones</small></div></div><ul>'
 +['<b>Tus ejercicios en vídeo</b>, preparados por tu fisio solo para ti','<b>Chat directo con tu fisio</b> para cualquier duda','<b>Tus citas</b> a mano y reserva cuando quieras','<b>Tus informes y documentos</b>, siempre contigo'].map(function(x){return '<li><svg viewBox="0 0 24 24">'+IC2.ok+'</svg><span>'+x+'</span></li>';}).join('')+'</ul></div>';
function PZ(n,t){return '<div class="pzf"><span>'+t+'</span><b>'+n+' €</b></div>';}
var faq='<div class="faq fi" style="animation-delay:.5s"><h3>Preguntas frecuentes</h3>'
 +'<details>'+sm('eur','¿Cuánto cuesta la sesión?')+'<div class="fa">'+tarifas+'<p class="nt">Los packs se pagan de una vez y las sesiones se van gastando en cada cita.</p></div></details>'
 +'<details>'+sm('uno','¿La primera visita cuesta lo mismo?')+'<div class="fa"><div class="big"><b>Sí</b><span>mismo precio que una sesión normal, <strong>valoración incluida</strong></span></div>'
 +T('lupa','Te valoramos a fondo','Te preguntamos, te exploramos y entendemos qué te pasa y por qué.')+T('mano','Empezamos ese mismo día','No es solo una consulta: sales de la primera visita ya tratado.')+'</div></details>'
 +'<details>'+sm('man','¿Qué es la fisioterapia convencional?')+'<div class="fa"><div class="tq"><span class="tqi"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.8h.01"/></svg></span><div><p class="inp">La fisioterapia de toda la vida, hecha a fondo: <b>una hora entera contigo</b>. Tu fisio usa en cada sesión lo que tú necesites: una técnica, varias o todas.</p></div></div><p class="st">Puede incluir</p>'
 +T('mano','Terapia manual','Masaje, técnicas para soltar la musculatura, movilizaciones y estiramientos.')
 +T('wave','Neuromodulación con medkey','Tecnología de neuromodulación de última generación: lee cómo responde tu tejido y <b>adapta los impulsos en tiempo real</b>, sesión a sesión. Calma el dolor agudo y crónico, reequilibra la musculatura y mejora la circulación. Sin agujas y sin calor.')
 +T('pesa','Ejercicio terapéutico','Ejercicios pensados para ti para recuperar fuerza y movilidad, y que no vuelva a pasar.')
 +CH('Va genial para',['Dolores puntuales','Contracturas','Sobrecargas','Dolor de espalda','Dolor de cuello','Tensión muscular','Rigidez'])
 +APP+PZ(65,'Sesión suelta')+'</div></details>'
 +'<details>'+sm('ray','¿Qué es la fisioterapia avanzada?')+'<div class="fa"><div class="tq"><span class="tqi"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.8h.01"/></svg></span><div><p class="inp">Es <b>todo lo de la convencional más tecnología de última generación</b>, para recuperarte antes en las lesiones que se resisten. Tu fisio combina en cada sesión lo que tú necesites: una técnica, varias o todas.</p></div></div><p class="st">Puede incluir</p>'
 +T('mano','Terapia manual y ejercicio','Todo lo de la convencional: técnicas manuales y ejercicios pensados para ti.')
 +T('wave','Neuromodulación con medkey','Lee cómo responde tu tejido y <b>adapta los impulsos en tiempo real</b>. Calma el dolor y reequilibra la musculatura.')
 +T('iman','Bomba diamagnética','Un campo magnético muy potente que actúa sobre el agua de tus tejidos. Imagina el tejido inflamado como una esponja empapada de agua sucia: la bomba la «escurre» y deja entrar agua limpia con nutrientes. Baja el dolor y la inflamación.')
 +T('onda','Ondas de choque','Como una piedra que cae en el agua: una onda viaja por el tejido y activa sus mecanismos naturales de reparación. La controlamos al detalle, así que no duele.')
 +T('calor','Diatermia','Calor profundo por radiofrecuencia que llega a capas a las que las manos no llegan. Relaja, mejora la circulación y acelera la reparación.')
 +CH('Pensada para',['Hernias','Protusiones','Esguinces','Tendinitis','Tendinopatías','Calcificaciones','Fascitis','Lesiones que no mejoran','Inflamación','Recuperación tras lesión'])
 +APP+PZ(75,'Sesión suelta')+'</div></details>'
 +'<details>'+sm('flor','¿Qué es la fisioterapia de suelo pélvico?')+'<div class="fa"><div class="tq"><span class="tqi"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.8h.01"/></svg></span><div><p class="inp">Fisioterapia especializada en la musculatura que sostiene la vejiga, el útero y el recto. Con una fisioterapeuta formada en suelo pélvico, en un ambiente <b>tranquilo, privado y de total confianza</b>.</p></div></div>'
 +T('lupa','Valoración completa','De tu suelo pélvico y de la zona abdominal.')+T('mano','Tratamiento manual y específico','Con tecnología cuando hace falta.')+T('pesa','Ejercicios personalizados','Para casa, en tu app con vídeo.')
 +CH('Va genial para',['Pérdidas de orina','Posparto','Diástasis abdominal','Preparación al parto','Dolor pélvico','Molestias en las relaciones','Sensación de peso','Prolapsos'])
 +PZ(75,'Sesión suelta<br><small>Mismos packs que la avanzada</small>')+'</div></details>'
 +'<details>'+sm('pre','¿Cuál necesito yo?')+'<div class="fa">'+T('mano','Tranquilo, no tienes que saberlo','Reserva tu cita: en la primera visita tu fisio te valora y te dice qué te va mejor.')+T('cha','¿Prefieres hablarlo antes?','Llámanos o escríbenos cuando quieras y te orientamos.')+'</div></details>'
 +'<details>'+sm('rel','¿Cuánto dura?')+'<div class="fa"><div class="big"><b>1 h</b><span>aproximadamente, <strong>siempre con tu fisio</strong></span></div></div></details>'
 +'<details>'+sm('bol','¿Qué tengo que traer?')+'<div class="fa">'+T('ropa','Ropa cómoda','Con la que te puedas mover bien.')+T('doc','Tus pruebas, si las tienes','Informes, resonancias, radiografías, ecografías… Tráelos o envíanoslos por WhatsApp antes. Si no tienes, no pasa nada.')+'</div></details>'
 +'<details>'+sm('tar','¿Cómo se paga?')+'<div class="fa"><div class="big"><b>Como quieras</b><span>en el centro, como te vaya mejor</span></div></div></details></div>';
function lista(){var H=D.huecos;if(!H.length){C.innerHTML='<div class="cab">'+cara+'<h1>Vaya, ya no quedan huecos</h1><p class="sub">Se han ocupado todos los de estos días. Escríbenos y te buscamos otro.</p></div>'+faq+dudas+pie;return;}
 var fis={};H.forEach(function(h){fis[h.fisio]=1;});var varios=Object.keys(fis).length>1,dias={};H.forEach(function(h){(dias[h.fecha]=dias[h.fecha]||[]).push(h);});
 var html='<div class="cab">'+cara+'<h1 class="fi" style="animation-delay:.8s">Elige tu hueco</h1><p class="sub fi" style="animation-delay:.9s">Toca la hora que te vaya bien y queda reservada'+(!varios?' con '+esc(H[0].nombre):'')+'.</p></div>'
  +'<div class="pasos fi" style="animation-delay:.95s"><div><span>1</span>Toca la hora<br>que te va bien</div><i></i><div><span>2</span>Pon tu nombre<br>y teléfono</div><i></i><div><span>3</span>¡Listo,<br>reservada!</div></div>',k=0;
 Object.keys(dias).sort().forEach(function(f,i){var L=dias[f],d=new Date(f+'T12:00:00');html+='<div class="dia fi" style="animation-delay:'+(1+i*.08)+'s">'+tile(f)+'<div class="hz"><div class="dn">'+(DS[d.getDay()].charAt(0).toUpperCase()+DS[d.getDay()].slice(1))+' '+d.getDate()+' de '+MS[d.getMonth()]+'</div>';
  var gr=varios?Object.keys(L.reduce(function(a,h){a[h.nombre]=1;return a;},{})):[''];
  gr.forEach(function(n){if(varios)html+='<span class="fis">con '+esc(n)+'</span>';html+='<div class="hs">'+L.filter(function(h){return !varios||h.nombre===n;}).map(function(h){k++;return '<button class="h'+(h.sb?' sb':'')+'" style="animation-delay:'+(1.1+i*.08+Math.min(k,20)*.025)+'s" data-id="'+h.id+'">'+h.hora+(h.sb?'*':'')+'</button>';}).join('')+'</div>';});html+='</div></div>';});
 if(H.some(function(h){return h.sb;}))html+='<p class="ley">* Hora sin bomba diamagnética</p>';
 C.innerHTML=html+faq+dudas+pie;[].forEach.call(C.querySelectorAll('.h'),function(b){b.onclick=function(){[].forEach.call(C.querySelectorAll('.h'),function(x){x.classList.toggle('on',x===b);});abrir(H.filter(function(h){return h.id===b.getAttribute('data-id');})[0]);};});}
document.addEventListener('click',function(e){var b=e.target.closest&&e.target.closest('.tabs button');if(!b)return;var w=b.closest('.fa');[].forEach.call(w.querySelectorAll('.tabs button'),function(x){x.classList.toggle('on',x===b);});[].forEach.call(w.querySelectorAll('.pks'),function(x){x.hidden=x.getAttribute('data-p')!==b.getAttribute('data-t');});});
var G={};try{G=JSON.parse(localStorage.getItem('f365_res')||'{}');}catch(e){}
function abrir(h){var f=document.createElement('div');f.className='fondo';f.innerHTML='<div class="hoja"><div class="asa"></div><div class="sel">'+tile(h.fecha)+'<div><small>Tu cita</small><b>'+fl(h.fecha).replace(/^./,function(x){return x.toUpperCase();})+'<br>a las '+h.hora+'</b><small>con '+esc(h.nombre)+'</small></div></div>'
 +'<div class="dos"><div><label>Nombre</label><input id="n1" autocomplete="given-name" value="'+esc(G.n1||'')+'"></div><div><label>Apellidos</label><input id="n2" autocomplete="family-name" value="'+esc(G.n2||'')+'"></div></div>'
 +'<label>Teléfono</label><input id="tl" type="tel" inputmode="tel" autocomplete="tel" value="'+esc(G.tl||'')+'"><label>Motivo de consulta</label><textarea id="mo" placeholder="Ej.: dolor de espalda desde hace unas semanas"></textarea>'
 +(D.pago?'<p class="pgn">Esta cita se paga por adelantado (<b>'+String(D.pago).replace('.',',')+' €</b>). Al reservar te llevamos al pago (tarjeta o transferencia) y te guardamos la hora 2 h.</p>':'')+'<p class="err" id="er"></p><button class="bt" id="rs">'+(D.pago?'Reservar y pagar':'Reservar mi cita')+'</button><button class="cancel" id="cn">Elegir otra hora</button></div>';
 document.body.appendChild(f);requestAnimationFrame(function(){f.classList.add('on');});var q=function(i){return f.querySelector('#'+i);};
 [].forEach.call(f.querySelectorAll('input,textarea'),function(x){x.oninput=function(){q('er').textContent='';};});
 var cerrar=function(){[].forEach.call(C.querySelectorAll('.h.on'),function(x){x.classList.remove('on');});f.classList.remove('on');setTimeout(function(){f.remove();},200);};q('cn').onclick=cerrar;f.onclick=function(e){if(e.target===f)cerrar();};
 q('rs').onclick=function(){var d={n1:q('n1').value.trim(),n2:q('n2').value.trim(),tl:q('tl').value.trim(),mo:q('mo').value.trim()},er=q('er');
  if(!d.n1){er.textContent='Escribe tu nombre';return;}if(!d.n2){er.textContent='Escribe tus apellidos';return;}if(d.tl.replace(/\\D/g,'').length<9){er.textContent='Revisa el teléfono';return;}if(!d.mo){er.textContent='Cuéntanos brevemente el motivo de la consulta';return;}
  try{localStorage.setItem('f365_res',JSON.stringify({n1:d.n1,n2:d.n2,tl:d.tl}));}catch(e){}
  var b=this;b.disabled=true;b.textContent='Reservando…';er.textContent='';
  fetch(D.url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:h.id,nombre:d.n1,apellidos:d.n2,tel:d.tl,motivo:d.mo})}).then(function(r){return r.json();}).then(function(r){
   if(r.ok&&r.pago){b.textContent='Vamos al pago…';location.href=r.pago;return;}
   if(r.ok){f.remove();hecho(h,d.n1);return;}
   if(r.ocupado){D.huecos=D.huecos.filter(function(x){return x.id!==h.id;});f.remove();lista();setTimeout(function(){alertar(r.error);},50);return;}
   throw new Error(r.error||'');}).catch(function(e){b.disabled=false;b.textContent=D.pago?'Reservar y pagar':'Reservar mi cita';er.textContent=e.message||'No se ha podido reservar. Inténtalo de nuevo.';});};}
function alertar(t){var p=document.createElement('p');p.className='err';p.style.textAlign='center';p.textContent=t;C.insertBefore(p,C.children[1]);}
function hecho(h,n){C.innerHTML='<div class="ok"><svg class="fc" width="88" height="88" viewBox="0 0 80 80" aria-hidden="true"><circle class="o" cx="40" cy="40" r="32" transform="rotate(-90 40 40)"/><path class="fi" style="animation-delay:.9s" d="M25 35 Q30 29 35 35"/><path class="fi" style="animation-delay:.9s" d="M45 35 Q50 29 55 35"/><path class="m" d="M26 45 Q40 62 54 45"/></svg>'
 +'<h1 class="fi" style="animation-delay:1s">¡Reservada, '+esc(n.charAt(0).toUpperCase()+n.slice(1))+'!</h1><p class="sub fi" style="animation-delay:1.15s">Te esperamos el '+fl(h.fecha)+' a las '+h.hora+' con '+esc(h.nombre)+'.</p>'+tile(h.fecha)+'<p class="okh fi" style="animation-delay:1.6s">Te guardamos el sitio</p></div>'+dudas+pie;window.scrollTo(0,0);}
lista();})();<\/script></body></html>`;
}

// ── FORMULARIO DE PRIMERA VISITA PROPIO (sustituye al de Tally b5j1M2, con los mismos textos y la misma lógica) ──
async function mailCDoc(id, email, nombre, que) {
  if (!process.env.BREVO_API_KEY || !email) return { ok: false, error: 'sin clave o email' };
  const pila = String(nombre || '').trim().split(' ')[0], link = enlaceCDoc(id), t = k => ({ nombre: pila, email })[k] || '';
  try {
    const r = await fetch('https://api.brevo.com/v3/smtp/email', { method: 'POST', headers: { 'api-key': process.env.BREVO_API_KEY, 'Content-Type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ sender: { name: 'FISIO365', email: 'info@fisioterapia365.com' }, replyTo: { email: 'info@fisioterapia365.com' }, to: [{ email: t('email').toLowerCase() }], subject: 'Tu documento de FISIO365 📄',
          htmlContent: `<div style="font-family:Arial,sans-serif;font-size:15px;color:#1a1a1a;line-height:1.6;max-width:520px">Hola ${escHtml(pila)},<br><br>Te dejamos aquí ${que || 'el documento con la información y el consentimiento que aceptaste para tu primera visita'} en FISIO365. Guárdalo para tenerlo a mano y, si tienes cualquier duda sobre tu tratamiento, escríbenos cuando quieras.<br><br><a href="${link}" style="display:inline-block;background:#c2552e;color:#fff;text-decoration:none;font-weight:bold;border-radius:10px;padding:12px 18px">Ver mi documento</a><br><br>Un abrazo,<br>El equipo de FISIO365</div>` }) });
    const txt = await r.text(); console.log('mailCDoc', r.status, txt.slice(0, 300)); return { ok: r.ok, status: r.status, info: txt.slice(0, 300) };
  } catch (e) { console.log('mailCDoc error', e.message); return { ok: false, error: e.message }; }
}
function firmaCDoc(id) { return require('crypto').createHmac('sha256', String(process.env.AIRTABLE_TOKEN || 'fisio365')).update('cdoc:' + id).digest('hex').slice(0, 10); }
const enlaceCDoc = id => `https://app.fisioterapia365.com/documento/${id}-${firmaCDoc(id)}`;
const CF_SALUD = [
  ['EMBARAZO', 'Si eres mujer, ¿embarazada o en periodo de lactancia?', ['Sí', 'No', 'No aplica (hombre)']],
  ['MARCAPASOS', '¿Tienes marcapasos u otro implante electrónico?'],
  ['PROBLEMAS CIRCULACIÓN', '¿Tienes problemas circulatorios graves?'],
  ['HIPERTENSIÓN', '¿Tienes hipertensión no controlada o arritmias significativas?'],
  ['PRÓTESIS', '¿Tienes prótesis, implantes metálicos u otros materiales en la zona a tratar?'],
  ['FRACTURAS/CIRUGÍA', '¿Has tenido fracturas recientes o cirugías recientes en la zona a tratar?'],
  ['CÁNCER', '¿Has sido diagnosticado con cáncer o está recibiendo tratamiento oncológico?', ['Sí', 'No', 'Alta']],
  ['ENFERMEDAD NEUROLÓGICA', '¿Tienes enfermedades neurológicas o musculares graves?'],
  ['MEDICAMENTO CUAGULACIÓN', '¿Tomas medicación que afecte la coagulación o tenga efectos importantes sobre la circulación?'],
  ['ALERGIA', '¿Tiene alergias graves a medicamentos o materiales?'],
  ['DOLOR CRÓNICO', '¿Tienes dolor crónico o limitaciones funcionales importantes?']];
const CF_SP_TXT = ['La fisioterapia de suelo pélvico tiene como <b>objetivo </b>la valoración y tratamiento de disfunciones relacionadas con la región abdomino-pélvica, como la incontinencia urinaria o fecal, el dolor pélvico, el postparto, los prolapsos o las disfunciones sexuales, entre otras.',
  'Para ello, se realiza una valoración individualizada que <b>puede incluir una exploración </b>funcional del suelo pélvico. <b>En algunos casos, esta exploración puede requerir técnicas intracavitarias</b> (vaginales o anales), siempre realizadas con el consentimiento del paciente y respetando en todo momento su intimidad.',
  'El tratamiento puede incluir diferentes <b>técnicas </b>como terapia manual, ejercicio terapéutico, reeducación funcional, biofeedback y/o electroterapia, adaptadas a cada caso.',
  'Las técnicas utilizadas no deben ser dolorosas. No obstante, en algunos casos puede aparecer una ligera molestia o sensación de irritación tras la sesión. De forma poco frecuente, pueden aparecer molestias derivadas de la sensibilidad de la zona o del uso de dispositivos terapéuticos.',
  '<b>Es importante que el paciente informe al fisioterapeuta de cualquier condición médica relevante</b>, como embarazo, infecciones, enfermedades diagnosticadas, tratamientos farmacológicos, cirugías previas o la presencia de dispositivos electrónicos implantados.',
  'Este tipo de tratamiento puede implicar un abordaje de carácter íntimo, por lo que <b>se realiza siempre con el máximo respeto</b>, explicando previamente cada procedimiento y pudiendo el paciente retirar su consentimiento en cualquier momento.'];
const CF_SP_OK = ['He leído y comprendido la información anterior y doy mi consentimiento para la valoración y tratamiento de fisioterapia de suelo pélvico.', 'Entiendo que puedo retirar mi consentimiento en cualquier momento.'];
const CF_TRAT = ['El tratamiento de fisioterapia tiene como objetivo prevenir, recuperar y mejorar la función del aparato locomotor y otras alteraciones de la salud.',
  'En FISIO365 pueden aplicarse las siguientes técnicas:<br><u>Terapia manual</u>: movilizaciones, masoterapia, estiramientos y manipulaciones articulares.<br><u>Ejercicio terapéutico</u>: programas personalizados, supervisados y/o digitales.<br><u>Ondas de choque y bomba diamagnética, neuromodulación no invasiva y radiofrecuencia.</u>',
  'Los tratamientos pueden generar molestias temporales como dolor leve, rigidez, hematomas, cansancio, enrojecimiento o falta de mejoría.',
  'El paciente puede solicitar información adicional o retirar su consentimiento en cualquier momento.',
  'Los tratamientos serán aplicados por <b>fisioterapeutas colegiados</b>, quienes seleccionarán las técnicas adecuadas y explicarán su aplicación cuando sea necesario.'];
const CF_CANCEL = '¡A todos nos puede pasar! Si necesitas cambiar o cancelar tu cita, avísanos con <b>24H de antelación </b>y no hay ningún problema.<br>De esa manera, podemos ofrecer ese hueco a otro paciente que también lo necesita.<br>Si no avisas a tiempo, la sesión se considerará como realizada. Si no tienes bono, te pediremos el pago por adelantado en tu próxima reserva. En caso de urgencia médica, contáctanos y lo valoramos juntos.<br>¡Gracias por ayudarnos a cuidar el tiempo de todos! 🙌';
const CF_DECL = ['He recibido información clara y suficiente sobre los tratamientos fisioterapéuticos que se me pueden aplicar. Entiendo sus objetivos, beneficios y posibles riesgos. Autorizo al equipo de FISIO365 a realizar las técnicas que consideren indicadas, dentro de las mencionadas en este documento.',
  'Confirmo que los datos de salud que he facilitado son veraces y completos.', 'Declaro conocer y aceptar la política de cancelaciones de FISIO365 descrita anteriormente.',
  'Declaro conocer y aceptar que los bonos de tratamiento se ofrecen a un precio reducido respecto a la tarifa de sesión individual, no tienen fecha de caducidad y, una vez contratados, no son rembolsables.'];
const CF_RGPD = [['RESPONSABLE DEL TRATAMIENTO', 'FOURTH DYNAMIC, S.L.<br>Carrer Gran de Sant Andreu, 163<br>Sant Andreu – 08030 Barcelona<br>Teléfono: 672 893 949'],
  ['DELEGADO DE PROTECCIÓN DE DATOS', 'TECNODOSIS, S.L.<br>dpd@utpr.es'],
  ['FINALIDAD DEL TRATAMIENTO DE DATOS', 'La finalidad principal de la recogida de sus datos personales es poder prestarle correctamente los servicios solicitados. Asimismo, sus datos se utilizarán para la gestión administrativa y la facturación de los servicios realizados. La base legal que legitima el tratamiento de sus datos es la ejecución del contrato de prestación de servicios y el consentimiento expreso del paciente o de su representante legal.'],
  ['PLAZO DE CONSERVACIÓN DE LOS DATOS', 'Los datos de salud se conservarán, por obligación legal, durante un plazo mínimo de 15 años. Los datos relacionados con la gestión administrativa y la facturación de los servicios se conservarán durante los plazos establecidos en la legislación mercantil y tributaria vigente.'],
  ['Destinatarios (cesión de sus datos)', 'Le informamos que los datos recogidos pueden ser comunicados, únicamente cuando sea necesario, a la gestoría, con la finalidad exclusiva de facturar los servicios prestados y cumplir con la legislación fiscal y mercantil vigente.<br><br>Para la gestión de citas, recogida de consentimientos informados, administración de historias clínicas y gestión interna del centro, utilizamos plataformas tecnológicas de gestión y almacenamiento de datos que actúan como encargados del tratamiento, tales como Tally y Airtable, las cuales cumplen con la normativa vigente en materia de protección de datos y ofrecen garantías adecuadas conforme al Reglamento (UE) 2016/679 (RGPD). Dichos proveedores únicamente tratan los datos siguiendo nuestras instrucciones y no los utilizan para fines propios.']];
const CF_AUT = [['IMAGENES', 'Uso de imágenes', 'Autorizo a FISIO365 a utilizar fotografías o vídeos con fines docentes, informativos o para su presentación en congresos médicos, así como en su web y redes sociales.'],
  ['CITAS', 'Recordatorio de citas', 'Autorizo a FISIO365 a enviarme recordatorios de citas por WhatsApp o llamada telefónica, para ayudarme a organizar mejor mi agenda.'],
  ['NEWSLETTER', 'Información de salud y novedades del centro', 'Autorizo a FISIO365 a enviarme información de salud, ejercicios, recomendaciones para pacientes, y novedades o promociones del centro.<br><span class="nota">No vamos a llenarte de emails. Solo recibirás información útil e interesante, y puedes retirar tu consentimiento en cualquier momento 🙂</span>']];
const CF_DER = 'Puede ejercer sus derechos de acceso, rectificación, supresión, limitación, oposición y portabilidad de sus datos dirigiéndose personalmente al centro o mediante el siguiente correo electrónico: info@fisioterapia365.com<br><br>Asimismo, tiene derecho a retirar en cualquier momento los consentimientos otorgados y a presentar una reclamación ante la autoridad de control competente, la Agencia Española de Protección de Datos.<br><br>Mediante el presente documento se cumple con el deber de información legal exigido por la normativa de protección de datos y se informa al paciente del tratamiento de sus datos personales con las finalidades anteriormente indicadas.';
const CF_CONOCIDO = ['Google', 'Recomendación', 'Médico', 'Redes', 'Ubicación', 'Otro'];
const CONS_CSS = `*{box-sizing:border-box}html,body{overflow-x:hidden;-webkit-text-size-adjust:100%}body{margin:0;font-family:Poppins,system-ui,sans-serif;background:#efebe5;color:#141414;min-height:100vh;display:flex;justify-content:center;padding:20px 16px 40px}
.c{background:#fff;border-radius:26px;padding:26px 20px 22px;max-width:520px;width:100%;box-shadow:0 10px 30px rgba(20,20,20,.06);align-self:flex-start}
.cab{text-align:center}.doc{display:block;margin:0 auto;width:60px;height:60px}.doc *{fill:none;stroke:#c2552e;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}.doc .p{stroke-dasharray:150;stroke-dashoffset:150;animation:dr .9s .1s forwards}.doc .l{stroke-dasharray:20;stroke-dashoffset:20;animation:dr .4s forwards}@keyframes dr{to{stroke-dashoffset:0}}
h1{font-size:22px;font-weight:700;margin:12px 0 4px}.sub{font-size:14px;color:#5c4f47;margin:0;line-height:1.5}
.prog{display:flex;gap:6px;margin:20px 0 6px}.prog i{flex:1;height:5px;border-radius:5px;background:#f1e8e1;overflow:hidden;position:relative}.prog i.on:after{content:'';position:absolute;inset:0;background:#c2552e;animation:llena .5s ease-out}@keyframes llena{from{transform:translateX(-100%)}}
.paso{font-size:12px;color:#8a7d74;text-align:center;margin:0 0 18px}.paso b{color:#c2552e}
h2{font-size:18px;margin:6px 0 12px}h3{font-size:14.5px;margin:20px 0 8px;color:#2b2420}
.q{margin-bottom:16px}.q>label,.ql{display:block;font-size:13.5px;font-weight:500;color:#2b2420;margin-bottom:6px;line-height:1.4}.q small.op{font-weight:400;color:#a3968c}
input[type=text],input[type=email],input[type=tel],textarea{width:100%;min-width:0;border:1.5px solid #efe6de;background:#faf7f4;border-radius:14px;padding:12px 14px;font:400 16px Poppins,sans-serif;color:#141414;outline:none;transition:border-color .2s,background .2s}input:focus,textarea:focus{border-color:#c2552e;background:#fff}
.dos{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);grid-template-rows:auto auto auto;grid-auto-flow:column;column-gap:10px;margin-bottom:16px}.dos>.q{display:contents}.dos>.q>label{align-self:end}
.op2{display:flex;flex-wrap:wrap;gap:7px}.op2 button{border:1.5px solid #efe6de;background:#fff;border-radius:12px;padding:10px 16px;font:500 14px Poppins,sans-serif;color:#2b2420;cursor:pointer;transition:all .15s}.op2 button.on{background:#c2552e;border-color:#c2552e;color:#fff;transform:scale(1.03)}
.sq{background:#faf7f4;border-radius:16px;padding:13px 14px;margin-bottom:8px}.sq .ql{margin-bottom:9px}.sq .op2 button{flex:1;min-width:70px}
.chk{display:flex;gap:14px;align-items:center;font-size:13.5px;color:#2b2420;cursor:pointer;line-height:1.5;margin:8px 0;padding:14px 16px;background:#faf7f4;border:1.5px solid #efe6de;border-radius:16px;transition:border-color .2s,background .2s}.chk:has(input:checked){border-color:#c2552e;background:#fdf1ea}.chk input{-webkit-appearance:none;appearance:none;flex:none;width:24px;height:24px;margin:0;border:1.8px solid #d9c8bc;border-radius:8px;background:#fff;display:grid;place-content:center;cursor:pointer;transition:all .18s}.chk input:after{content:'';width:6px;height:11px;border:solid #fff;border-width:0 2.4px 2.4px 0;transform:rotate(45deg) scale(0);margin-top:-3px;transition:transform .18s}.chk input:checked{background:#c2552e;border-color:#c2552e}.chk input:checked:after{transform:rotate(45deg) scale(1)}.box .chk{background:#fff}.q>label.chk{display:flex;font-weight:400}
.tx{font-size:13.5px;color:#5c4f47;line-height:1.6}.tx p{margin:0 0 10px}.box{background:#faf7f4;border-radius:16px;padding:14px 16px;margin-bottom:10px}
.err{color:#b42318;font-size:12.5px;margin:0;min-height:0}.err:not(:empty){margin-top:5px}.q.mal input,.q.mal .op2 button,.sq.mal{border-color:#f0b4ad}.sq.mal{box-shadow:0 0 0 1.5px #f0b4ad}
.firma{position:relative;border:1.5px dashed #e6c9bb;background:#fdfaf8;border-radius:16px;height:180px;touch-action:none}.firma canvas{width:100%;height:100%;display:block;border-radius:16px}.firma span{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#c9b9ad;font-size:14px;pointer-events:none}.firma.ok span{display:none}
.bor{border:none;background:none;color:#8a7d74;font:500 12.5px Poppins,sans-serif;padding:6px 0;cursor:pointer}
.nav{display:flex;gap:8px;margin-top:20px}.bt{flex:1;font:600 16px Poppins,sans-serif;color:#fff;background:#c2552e;border:none;border-radius:14px;padding:15px;cursor:pointer}.bt:disabled{opacity:.6}.bk{flex:none;font:600 15px Poppins,sans-serif;background:#f6f1eb;color:#7d6a60;border:none;border-radius:14px;padding:15px 18px;cursor:pointer}
.au .ql{margin-bottom:12px}.au-h{display:flex;align-items:center;gap:10px;font-weight:600;font-size:14px;color:#2b2420;margin-bottom:6px}.au-h svg{flex:none;width:30px;height:30px;padding:6px;border-radius:10px;background:#fdf1ea;fill:none;stroke:#c2552e;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}.au-p{display:block;font-weight:400;font-size:13px;color:#5c4f47;line-height:1.55}.nota{display:block;margin-top:10px;padding:10px 12px;border-radius:12px;background:#fff;border:1px dashed #e6c9bb;color:#7d4a35;font-size:12.5px}
.fin .c{align-self:center}.fin .ok{padding:34px 0 26px}
.fecha{background:#fdf1ea;border-radius:14px;padding:12px 14px;font-size:14px;color:#2b2420}
.fi{opacity:0;transform:translateY(8px);animation:fi .45s forwards}@keyframes fi{to{opacity:1;transform:none}}
.ok{text-align:center;padding:10px 0}.ok svg{display:block;margin:0 auto}.ok circle,.ok path{fill:none;stroke:#c2552e;stroke-width:3;stroke-linecap:round}.ok .o{stroke-dasharray:202;stroke-dashoffset:202;animation:dr .9s forwards}.ok .m{stroke-dasharray:44;stroke-dashoffset:44;animation:dr .45s .7s forwards}.ok .e{opacity:0;animation:fi .3s .9s forwards}
@media (prefers-reduced-motion:reduce){*{animation-duration:.01s!important;animation-delay:0s!important}}
.up{display:flex;align-items:center;gap:12px;border:1.5px dashed #e6c9bb;background:#fdfaf8;border-radius:16px;padding:14px 16px;cursor:pointer;font-size:13.5px;color:#5c4f47}.up svg{flex:none;width:30px;height:30px;padding:6px;border-radius:10px;background:#fdf1ea;fill:none;stroke:#c2552e;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}.up input{display:none}.q>label.up{display:flex;margin:0;font-weight:400}.fl{list-style:none;margin:8px 0 0;padding:0}.fl li{display:flex;align-items:center;justify-content:space-between;gap:8px;background:#faf7f4;border-radius:12px;padding:9px 12px;margin-top:6px;font-size:13px;color:#2b2420}.fl li span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.fl button{border:none;background:none;color:#a3968c;font:500 18px Poppins,sans-serif;cursor:pointer;padding:0 4px}
textarea{min-height:90px;resize:vertical}`;
function paginaConsent(D) {
  const J = JSON.stringify(D).replace(/</g, '\\u003c');
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Primera visita · FISIO365</title>
<meta property="og:title" content="Formulario de tu primera visita"><meta property="og:description" content="Un formulario rápido con lo esencial: tus datos, tu salud y el consentimiento para el tratamiento."><meta property="og:image" content="https://app.fisioterapia365.com/consentimiento.png?v=1"><meta property="og:image:width" content="600"><meta property="og:image:height" content="600"><meta property="og:type" content="website">
<link rel="icon" href="https://app.fisioterapia365.com/icons/favicon-48.png"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>${CONS_CSS}</style></head>
<body><div class="c" id="c"></div><script>(function(){var D=${J},C=document.getElementById('c'),K='f365_cons',S={},pg=0;
try{S=JSON.parse(localStorage.getItem(K)||'{}');pg=Math.min(3,S._pg||0);}catch(e){}
function guarda(){try{var o={};for(var k in S)if(k!=='firma')o[k]=S[k];o._pg=pg;localStorage.setItem(K,JSON.stringify(o));}catch(e){}}
function esc(t){return String(t==null?'':t).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
function inp(k,l,t,ph,op){return '<div class="q" data-k="'+k+'"><label>'+l+(op?' <small class="op">(opcional)</small>':'')+'</label><input type="'+(t||'text')+'" data-i="'+k+'" value="'+esc(S[k]||'')+'"'+(ph?' placeholder="'+esc(ph)+'"':'')+(t==='tel'?' inputmode="tel"':'')+(k==='nacimiento'?' inputmode="numeric" maxlength="10" autocomplete="bday"':'')+'><p class="err"></p></div>';}
function opc(k,l,ops,cls){return '<div class="'+(cls||'q')+'" data-k="'+k+'"><div class="ql">'+l+'</div><div class="op2">'+ops.map(function(o){return '<button type="button" data-v="'+esc(o)+'"'+(S[k]===o?' class="on"':'')+'>'+esc(o)+'</button>';}).join('')+'</div><p class="err"></p></div>';}
var TIT=['Tus datos','Cuestionario de salud','Información sobre el tratamiento','Privacidad y firma'];
function cab(){return '<div class="cab"><svg class="doc" viewBox="0 0 48 48" aria-hidden="true"><path class="p" d="M28 5H13a4 4 0 0 0-4 4v30a4 4 0 0 0 4 4h22a4 4 0 0 0 4-4V16z"/><path class="p" d="M28 5v11h11"/><path class="l" style="animation-delay:.8s" d="M16 25h16"/><path class="l" style="animation-delay:.95s" d="M16 31h11"/></svg><h1>Tu primera visita</h1><p class="sub">Un formulario rápido con lo esencial: tus datos, tu salud y el consentimiento para el tratamiento.</p></div>'
 +'<div class="prog">'+[0,1,2,3].map(function(i){return '<i'+(i<=pg?' class="on"':'')+'></i>';}).join('')+'</div><p class="paso">Paso <b>'+(pg+1)+'</b> de 4 · '+TIT[pg]+'</p>';}
function p0(){var r=S.reserva_otro?'':' style="display:none"',q=S.conocido==='Recomendación'?'':' style="display:none"';
 return '<h2>'+TIT[0]+'</h2><div class="dos">'+inp('nombre','Nombre')+inp('apellidos','Apellidos')+'</div>'+inp('tutor','Nombre y apellidos del tutor legal (si procede)','text','',1)
 +'<div class="dos">'+inp('nif','NIF del paciente')+inp('niftutor','NIF del tutor legal (si procede)','text','',1)+'</div>'
 +inp('nacimiento','Fecha de nacimiento <small class="op">(día / mes / año)</small>','text','DD/MM/AAAA')+inp('email','Email','email')+inp('tel','Número de teléfono (sin espacios)','tel')
 +'<div class="q" data-k="reserva_otro"><div class="ql">Teléfono de la reserva</div><label class="chk"><input type="checkbox" data-c="reserva_otro"'+(S.reserva_otro?' checked':'')+'>La cita se reservó con un teléfono distinto al tuyo (por ejemplo, el de un familiar)</label></div>'
 +'<div id="xres"'+r+'>'+inp('telres','¿Con qué teléfono se reservó la cita?','tel','600123456')+'</div>'
 +opc('conocido','¿Cómo nos has conocido?',D.conocido)
 +'<div id="xrec"'+q+'>'+inp('recomendo','¡Genial! ¿Quién te recomendó? Le mandaremos un regalito de agradecimiento 🎁','text','Escribe su nombre y apellido')+'</div>';}
function p1(){var sp=S.sp==='Sí'?'':' style="display:none"';
 return '<h2>'+TIT[1]+'</h2><p class="tx">Por favor, marque "sí" o "no" en cada pregunta. Esta información es confidencial y nos ayuda a garantizar su seguridad durante el tratamiento.</p>'
 +D.salud.map(function(x){return opc(x[0],x[1],x[2]||['Sí','No'],'sq');}).join('')
 +opc('sp','¿Tu consulta está relacionada con el suelo pélvico (embarazo, postparto, pérdidas de orina, dolor pélvico, etc.)',['Sí','No'],'sq')
 +'<div id="xsp"'+sp+'><h3>Consentimiento informado – Fisioterapia de suelo pélvico</h3><div class="box tx">'+D.spTxt.map(function(t){return '<p>'+t+'</p>';}).join('')+'<p><b>Por favor, confirma lo siguiente:</b></p>'
 +D.spOk.map(function(t,i){return '<label class="chk"><input type="checkbox" data-c="spok'+i+'"'+(S['spok'+i]?' checked':'')+'>'+t+'</label>';}).join('')+'<p class="err" id="esp"></p></div></div>';}
function p2(){return '<h2>Información al paciente sobre el tratamiento</h2><div class="box tx">'+D.trat.map(function(t){return '<p>'+t+'</p>';}).join('')+'</div>'
 +'<h3>Política de cancelaciones</h3><div class="box tx"><p>'+D.cancel+'</p></div><h3>Declaro que:</h3><div class="box tx">'+D.decl.map(function(t){return '<p>'+t+'</p>';}).join('')+'</div>';}
function p3(){return '<h2>'+TIT[3]+'</h2>'+D.rgpd.map(function(x){return '<h3>'+x[0]+'</h3><div class="box tx"><p>'+x[1]+'</p></div>';}).join('')
 +'<h3>Tus autorizaciones</h3>'+D.aut.map(function(x,i){return opc(x[0],'<span class="au-h"><svg viewBox="0 0 24 24" aria-hidden="true">'+AUI[i]+'</svg>'+x[1]+'</span><span class="au-p">'+x[2]+'</span>',['Sí','No'],'sq au');}).join('')
 +'<h3>Derechos</h3><div class="box tx"><p>'+D.der+'</p></div>'
 +'<h3>Firma</h3><div class="q" data-k="firma"><div class="firma" id="fm"><canvas id="cv"></canvas><span>Firma aquí con el dedo</span></div><button type="button" class="bor" id="bf">Borrar firma</button><p class="err"></p></div>'
 +'<h3>Firmado en Barcelona, a la fecha indicada a continuación:</h3><div class="fecha">'+D.hoyTxt+'</div>';}
var AUI=['<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>','<rect x="4" y="5" width="16" height="15" rx="3"/><path d="M4 10h16M9 3v4M15 3v4"/><path d="M9.5 15l2 2 3.5-3.5"/>','<rect x="3" y="6" width="18" height="13" rx="3"/><path d="M4 8l8 6 8-6"/>'];
var P=[p0,p1,p2,p3];
function pinta(){C.innerHTML=cab()+'<div class="fi">'+P[pg]()+'</div><div class="nav">'+(pg?'<button type="button" class="bk" id="atr">Atrás</button>':'')+'<button type="button" class="bt" id="sig">'+(pg<3?'Siguiente':'Enviar')+'</button></div>';ata();window.scrollTo(0,0);}
function ata(){
 [].forEach.call(C.querySelectorAll('[data-i]'),function(x){x.oninput=function(){var k=x.getAttribute('data-i');if(k==='nacimiento'){var d=x.value.replace(/[^0-9]/g,'').slice(0,8),o=d.slice(0,2);if(d.length>2)o+='/'+d.slice(2,4);if(d.length>4)o+='/'+d.slice(4);if(x.value!==o)x.value=o;}S[k]=x.value;guarda();var q=x.closest('.q');if(q){q.classList.remove('mal');q.querySelector('.err').textContent='';}};});
 [].forEach.call(C.querySelectorAll('.op2'),function(g){var w=g.parentNode,k=w.getAttribute('data-k');[].forEach.call(g.querySelectorAll('button'),function(b){b.onclick=function(){S[k]=b.getAttribute('data-v');guarda();[].forEach.call(g.querySelectorAll('button'),function(x){x.classList.toggle('on',x===b);});w.classList.remove('mal');var e=w.querySelector('.err');if(e)e.textContent='';
  if(k==='conocido')document.getElementById('xrec').style.display=S.conocido==='Recomendación'?'':'none';if(k==='sp')document.getElementById('xsp').style.display=S.sp==='Sí'?'':'none';};});});
 [].forEach.call(C.querySelectorAll('[data-c]'),function(x){x.onchange=function(){var k=x.getAttribute('data-c');S[k]=x.checked;guarda();if(k==='reserva_otro')document.getElementById('xres').style.display=x.checked?'':'none';var e=document.getElementById('esp');if(e)e.textContent='';};});
 var a=document.getElementById('atr');if(a)a.onclick=function(){pg--;guarda();pinta();};
 document.getElementById('sig').onclick=sig;
 if(pg===3)firma();}
function firma(){var cv=document.getElementById('cv'),fm=document.getElementById('fm'),r=cv.getBoundingClientRect(),dp=window.devicePixelRatio||1;cv.width=r.width*dp;cv.height=r.height*dp;var x=cv.getContext('2d');x.scale(dp,dp);x.lineWidth=2.4;x.lineCap='round';x.lineJoin='round';x.strokeStyle='#1e2a38';
 var dib=false,tr=0,ul=null;function pt(e){var b=cv.getBoundingClientRect();return [e.clientX-b.left,e.clientY-b.top];}
 cv.onpointerdown=function(e){dib=true;ul=pt(e);cv.setPointerCapture(e.pointerId);};cv.onpointermove=function(e){if(!dib)return;var p=pt(e);x.beginPath();x.moveTo(ul[0],ul[1]);x.lineTo(p[0],p[1]);x.stroke();tr+=Math.hypot(p[0]-ul[0],p[1]-ul[1]);ul=p;if(tr>30){fm.classList.add('ok');S.firma=1;var q=fm.closest('.q');q.classList.remove('mal');q.querySelector('.err').textContent='';}};
 cv.onpointerup=cv.onpointercancel=function(){dib=false;};
 document.getElementById('bf').onclick=function(){x.clearRect(0,0,cv.width,cv.height);tr=0;S.firma=0;fm.classList.remove('ok');};S.firma=0;}
function mal(k,t){var w=C.querySelector('[data-k="'+k+'"]');if(!w)return;w.classList.add('mal');var e=w.querySelector('.err');if(e)e.textContent=t;}
function fNac(v){var m=String(v||'').trim().match(/^(\\d{1,2})[\\/\\-. ](\\d{1,2})[\\/\\-. ](\\d{4})$/);if(!m)return '';var d=+m[1],mo=+m[2],y=+m[3],dt=new Date(y,mo-1,d);if(dt.getDate()!==d||dt.getMonth()!==mo-1||y<1900||dt>new Date())return '';return y+'-'+String(mo).padStart(2,'0')+'-'+String(d).padStart(2,'0');}
function valida(){var ok=true,f=function(k,t){mal(k,t);ok=false;},v=function(k){return String(S[k]||'').trim();};
 if(pg===0){if(!v('nombre'))f('nombre','Escribe tu nombre');if(!v('apellidos'))f('apellidos','Escribe tus apellidos');if(v('nif').length<5)f('nif','Escribe el NIF');
  if(!fNac(v('nacimiento')))f('nacimiento','Escríbela así: 25/03/1985');if(!/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(v('email')))f('email','Revisa el email');if(v('tel').replace(/\\D/g,'').length<9)f('tel','Revisa el teléfono');
  if(S.reserva_otro&&v('telres').replace(/\\D/g,'').length<9)f('telres','Escribe el teléfono con el que se reservó');if(!S.conocido)f('conocido','Elige una opción');if(S.conocido==='Recomendación'&&!v('recomendo'))f('recomendo','Escribe su nombre y apellido');}
 if(pg===1){D.salud.forEach(function(x){if(!S[x[0]])f(x[0],'Elige una opción');});if(!S.sp)f('sp','Elige una opción');if(S.sp==='Sí'&&!(S.spok0&&S.spok1)){ok=false;var e=document.getElementById('esp');if(e)e.textContent='Marca las dos casillas para continuar';}}
 if(pg===3){D.aut.forEach(function(x){if(!S[x[0]])f(x[0],'Elige una opción');});if(!S.firma)f('firma','Firma en el recuadro');}
 if(!ok){var m=C.querySelector('.mal input,.mal .op2,.sq.mal')||C.querySelector('#esp');if(m)m.scrollIntoView({behavior:'smooth',block:'center'});}return ok;}
function sig(){if(!valida())return;if(pg<3){pg++;guarda();pinta();return;}
 var b=document.getElementById('sig');b.disabled=true;b.textContent='Enviando…';
 var o={};for(var k in S)if(k!=='_pg')o[k]=S[k];o.nacimiento=fNac(S.nacimiento);o.firma=document.getElementById('cv').toDataURL('image/png');
 fetch(D.url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(o)}).then(function(r){return r.json();}).then(function(r){if(!r.ok)throw new Error(r.error||'');
  try{localStorage.removeItem(K);}catch(e){}var n=String(S.nombre||'').trim().split(/\\s+/)[0];n=n?n.charAt(0).toUpperCase()+n.slice(1).toLowerCase():'';
  document.body.classList.add('fin');C.innerHTML='<div class="ok"><svg width="88" height="88" viewBox="0 0 80 80" aria-hidden="true"><circle class="o" cx="40" cy="40" r="32" transform="rotate(-90 40 40)"/><path class="e" d="M25 35 Q30 29 35 35"/><path class="e" d="M45 35 Q50 29 55 35"/><path class="m" d="M26 45 Q40 62 54 45"/></svg><h1 class="fi" style="animation-delay:1s">¡Listo'+(n?', '+esc(n):'')+'!</h1><p class="sub fi" style="animation-delay:1.15s">Ya lo tenemos todo. Cuando llegues, empezamos directamente con tu sesión.<br><br>Te hemos enviado una copia a tu email.</p></div>';window.scrollTo(0,0);})
 .catch(function(e){b.disabled=false;b.textContent='Enviar';alert(e.message||'No se ha podido enviar. Inténtalo de nuevo.');});}
pinta();})();<\/script></body></html>`;
}
function ogConsSvg() {
  const T = '#c2552e', K = '#2b2420', M = '#8a7d74', O = ogTipos();
  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600"><rect width="600" height="600" fill="#f6f1eb"/><rect x="60" y="60" width="480" height="480" rx="44" fill="#fff"/>`
    + `<g fill="none" stroke="${T}" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"><path d="M318 150h-62a14 14 0 0 0-14 14v118a14 14 0 0 0 14 14h88a14 14 0 0 0 14-14v-92z"/><path d="M318 150v40h40"/><path d="M268 226h64M268 252h40"/></g>`
    + ogTexto(O.b, 'Tu primera visita', 40, 300, 384, 0, K) + ogTexto(O.m, 'Tus datos, tu salud y tu firma', 23, 300, 426, 0, M) + ogTexto(O.m, 'Son 2 minutos', 21, 300, 466, 0, T) + `</svg>`;
}
function paginaCDoc(F, firmaSrc) {
  const e = escHtml, v = k => cNm(F[k]), nombre = `${String(F['﻿NOMBRE'] || F['NOMBRE'] || '').trim()} ${String(F['APELLIDOS'] || '').trim()}`.trim();
  const fila = (l, x) => x ? `<tr><td>${l}</td><td>${e(x)}</td></tr>` : '';
  const fN = x => String(x || '').slice(0, 10).split('-').reverse().join('/');
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Consentimiento · FISIO365</title>
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>*{box-sizing:border-box}body{margin:0;font-family:Poppins,system-ui,sans-serif;background:#efebe5;color:#1a1a1a;padding:20px 14px}.c{background:#fff;max-width:720px;margin:0 auto;border-radius:22px;padding:28px 24px}h1{font-size:21px;margin:0 0 2px}h2{font-size:15px;margin:22px 0 8px;color:#c2552e}.sub{color:#7d6a60;font-size:13px;margin:0 0 14px}p,li,td{font-size:13px;line-height:1.55;color:#3d3530}table{width:100%;border-collapse:collapse}td{padding:6px 0;border-bottom:1px solid #f1ebe5;vertical-align:top}td:first-child{color:#7d6a60;width:58%;padding-right:12px}.f{border:1px solid #efe6de;border-radius:14px;padding:10px;margin-top:6px;max-width:320px}.f img{width:100%;display:block}.reg{font-size:11.5px;color:#a3968c;white-space:pre-line}.bt{display:inline-block;margin-top:18px;background:#c2552e;color:#fff;border:none;border-radius:12px;padding:12px 18px;font:600 14px Poppins,sans-serif;cursor:pointer}
@media print{body{background:#fff;padding:0}.c{box-shadow:none;border-radius:0;padding:0}.bt{display:none}}</style></head><body><div class="c">
<h1>Consentimiento informado</h1><p class="sub">FISIO365 · Fourth Dynamic, S.L. · Firmado el ${e(fN(F['Creada']))}</p>
<h2>Datos del paciente</h2><table>${fila('Nombre', nombre)}${fila('NIF', F['DNI'])}${fila('Fecha de nacimiento', fN(F['NACIMIENTO']))}${fila('Email', F['EMAIL'])}${fila('Teléfono', F['TELF'])}${fila('Tutor legal', F['TUTOR'])}${fila('NIF del tutor', F['NIF TUTOR'])}${fila('Teléfono de la reserva', F['TELF RESERVA'])}${fila('¿Cómo nos has conocido?', v('CONOCIDO'))}${fila('¿Quién te recomendó?', F['RECOMENDÓ'])}</table>
<h2>Cuestionario de salud</h2><table>${CF_SALUD.map(x => fila(x[1], v(x[0]))).join('')}${fila('¿Tu consulta está relacionada con el suelo pélvico?', v('SUELO PÉLVICO'))}</table>
${/^s[ií]$/i.test(v('SUELO PÉLVICO')) ? `<h2>Consentimiento informado – Fisioterapia de suelo pélvico</h2>${(LEGAL || legalDe()).sp.map(t => `<p>${t}</p>`).join('')}${F['ACEPTACIÓN S.P.'] ? CF_SP_OK.map(t => `<p>☑ ${t}</p>`).join('') : ''}` : ''}
<h2>Información al paciente sobre el tratamiento</h2>${(LEGAL || legalDe()).trat.map(t => `<p>${t}</p>`).join('')}<h2>Política de cancelaciones</h2><p>${CF_CANCEL}</p><h2>Declaro que</h2>${(LEGAL || legalDe()).decl.map(t => `<p>${t}</p>`).join('')}
${(LEGAL || legalDe()).rgpd.map(x => `<h2>${x[0]}</h2><p>${x[1]}</p>`).join('')}
<h2>Autorizaciones</h2><table>${CF_AUT.map(x => fila(x[1] + ': ' + x[2].replace(/<[^>]+>/g, ''), v(x[0]))).join('')}</table>
<h2>Derechos</h2><p>${(LEGAL || legalDe()).der}</p>
<h2>Firma</h2>${firmaSrc ? `<div class="f"><img src="${e(firmaSrc)}" alt="Firma"></div>` : ''}<p>Firmado en Barcelona, a ${e(fN(F['Creada']))}.</p>${F['REGISTRO FIRMA'] ? `<p class="reg">${e(F['REGISTRO FIRMA'])}</p>` : ''}
<button class="bt" onclick="print()">Guardar en PDF o imprimir</button></div></body></html>`;
}

// ── FORMULARIOS DE SUELO PÉLVICO Y ALTA ONCOLÓGICA (propios, sustituyen a Tally Gex8jo y Dq4gE5) ──
const CO_SALUD_SP = [['EMBARAZO', '¿Estás embarazada o en periodo de lactancia?'], ['MARCAPASOS', '¿Tienes marcapasos u otro implante electrónico?'], ['PROBLEMAS CIRCULACIÓN', '¿Tienes problemas circulatorios graves?'], ['HIPERTENSIÓN', '¿Tienes hipertensión no controlada o arritmias significativas?'], ['PRÓTESIS', '¿Tienes prótesis, implantes metálicos u otros materiales en la zona a tratar?'], ['FRACTURAS/CIRUGÍA', '¿Has tenido fracturas o cirugías recientes en la zona a tratar?'], ['CÁNCER', '¿Has sido diagnosticado con cáncer o estás recibiendo tratamiento oncológico?', ['Sí', 'No', 'Alta']], ['ENFERMEDAD NEUROLÓGICA', '¿Tienes enfermedades neurológicas o musculares graves?'], ['MEDICAMENTO CUAGULACIÓN', '¿Tomas medicación que afecte la coagulación o tenga efectos importantes sobre la circulación?'], ['ALERGIA', '¿Tienes alergias graves a medicamentos o materiales?'], ['DOLOR CRÓNICO', '¿Tienes dolor crónico o limitaciones funcionales importantes?']];
const CO_ALTA_SIT = ['Declaro haber recibido el alta médica en la unidad oncológica correspondiente, no estar actualmente bajo tratamiento activo contra el cáncer (quimioterapia, radioterapia, inmunoterapia u otros), y que no existe contraindicación médica actual para la aplicación de terapias físicas o magnéticas.', 'Declaro asimismo que he informado al profesional de FISIO365 de mi historia clínica relevante y de los tratamientos que sigo actualmente.'];
const CO_ALTA_TRAT = ['Las terapias físicas y magnéticas (como la bomba diamagnética) son tratamientos no invasivos: no implican cirugía, inyecciones ni radiación ionizante. Su objetivo es favorecer la recuperación de los tejidos, reducir el dolor y mejorar la circulación.', 'Suelen tolerarse bien, aunque de forma excepcional pueden aparecer molestias leves, enrojecimiento, sensación de calor o una reactivación temporal del dolor. Aunque no existe evidencia de riesgo específico para personas con alta oncológica, FISIO365 no puede garantizar una respuesta clínica determinada ni se hace responsable de reacciones individuales imprevisibles.'];
const CO_ALTA_OK = ['He leído y comprendido la información anterior y he podido resolver mis dudas.', 'Autorizo voluntariamente a FISIO365 a aplicarme estos tratamientos tras mi alta oncológica, bajo mi propia responsabilidad.', 'Eximo al centro y a sus profesionales de cualquier responsabilidad derivada de efectos secundarios no previsibles, recaídas o complicaciones no atribuibles a negligencia.'];
// Textos legales editables (Administración › Textos legales). Vacío = el texto de siempre.
// Se editan como texto normal: párrafos separados por una línea en blanco; en protección de datos, la 1.ª línea de cada bloque es el título.
let LEGAL = null;
const escL = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
const parrafos = t => String(t || '').replace(/\r/g, '').split(/\n\s*\n/).map(x => x.trim()).filter(Boolean);
function legalDe(g) {
  g = g || {}; const P = k => parrafos(g[k]).map(escL);
  const rg = parrafos(g.rgpd).map(b => { const [t, ...r] = b.split('\n'); return [escL(t.trim()), escL(r.join('\n').trim())]; }).filter(x => x[0] && x[1]);
  return { trat: P('trat').length ? P('trat') : CF_TRAT, decl: P('decl').length ? P('decl') : CF_DECL, rgpd: rg.length ? rg : CF_RGPD,
    der: P('der').length ? P('der').join('<br><br>') : CF_DER, sp: P('sp').length ? P('sp') : CF_SP_TXT, altaTrat: P('altaTrat').length ? P('altaTrat') : CO_ALTA_TRAT };
}
// Lo de siempre en texto normal, para enseñarlo en el editor
const sinHtml = t => String(t).replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
const LEGAL_TXT = () => ({ trat: CF_TRAT.map(sinHtml).join('\n\n'), decl: CF_DECL.map(sinHtml).join('\n\n'), rgpd: CF_RGPD.map(x => sinHtml(x[0]) + '\n' + sinHtml(x[1])).join('\n\n'), der: sinHtml(CF_DER), sp: CF_SP_TXT.map(sinHtml).join('\n\n'), altaTrat: CO_ALTA_TRAT.map(sinHtml).join('\n\n') });
const CO_KIND = {
  sp: { tipo: 'Suelo pélvico', ruta: 'suelo-pelvico', titulo: 'Suelo pélvico', sub: 'Este formulario es para empezar el tratamiento de suelo pélvico. Incluye un repaso rápido de tu salud, por si algo ha cambiado desde tu primera visita.', ogSub: 'Tu salud al día y tu firma', que: 'el consentimiento de fisioterapia de suelo pélvico que has firmado' },
  alta: { tipo: 'Alta oncológica', ruta: 'alta-oncologica', titulo: 'Alta oncológica', sub: 'Este formulario es para pacientes que han tenido cáncer y ya tienen el alta oncológica. Solo te llevará un par de minutos.', ogSub: 'Unos datos y tu firma', que: 'el documento de alta oncológica que has firmado' }
};
function paginaConsOtro(D) {
  const J = JSON.stringify(D).replace(/</g, '\\u003c'), K = CO_KIND[D.kind];
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${K.titulo} · FISIO365</title>
<meta property="og:title" content="${K.titulo} · FISIO365"><meta property="og:description" content="${escHtml(K.sub)}"><meta property="og:image" content="https://app.fisioterapia365.com/${K.ruta}.png?v=1"><meta property="og:image:width" content="600"><meta property="og:image:height" content="600"><meta property="og:type" content="website">
<link rel="icon" href="https://app.fisioterapia365.com/icons/favicon-48.png"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>${CONS_CSS}</style></head>
<body><div class="c" id="c"></div><script>(function(){var D=${J},C=document.getElementById('c'),K='f365_'+D.kind,S={},pg=0,AL=D.kind==='alta',N=AL?2:3,FI=[];
try{S=JSON.parse(localStorage.getItem(K)||'{}');pg=Math.min(N-1,S._pg||0);}catch(e){}
function guarda(){try{var o={};for(var k in S)if(k!=='firma')o[k]=S[k];o._pg=pg;localStorage.setItem(K,JSON.stringify(o));}catch(e){}}
function esc(t){return String(t==null?'':t).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
function inp(k,l,t,ph,op,ayuda){return '<div class="q" data-k="'+k+'"><label>'+l+(op?' <small class="op">(opcional)</small>':'')+'</label>'+(ayuda?'<p class="tx" style="margin:-2px 0 8px;font-size:12.5px">'+ayuda+'</p>':'')+'<input type="'+(t||'text')+'" data-i="'+k+'" value="'+esc(S[k]||'')+'"'+(ph?' placeholder="'+esc(ph)+'"':'')+(t==='tel'?' inputmode="tel"':'')+(k==='falta'?' inputmode="numeric" maxlength="10"':'')+'><p class="err"></p></div>';}
function opc(k,l,ops,cls){return '<div class="'+(cls||'q')+'" data-k="'+k+'"><div class="ql">'+l+'</div><div class="op2">'+ops.map(function(o){return '<button type="button" data-v="'+esc(o)+'"'+(S[k]===o?' class="on"':'')+'>'+esc(o)+'</button>';}).join('')+'</div><p class="err"></p></div>';}
function chks(arr,p){return arr.map(function(t,i){return '<label class="chk"><input type="checkbox" data-c="'+p+i+'"'+(S[p+i]?' checked':'')+'>'+t+'</label>';}).join('')+'<p class="err" id="eok"></p>';}
var TIT=AL?['Tus datos','Situación médica y consentimiento']:['Tus datos','Cuestionario de salud','Consentimiento de suelo pélvico'];
function cab(){return '<div class="cab"><svg class="doc" viewBox="0 0 48 48" aria-hidden="true"><path class="p" d="M28 5H13a4 4 0 0 0-4 4v30a4 4 0 0 0 4 4h22a4 4 0 0 0 4-4V16z"/><path class="p" d="M28 5v11h11"/><path class="l" style="animation-delay:.8s" d="M16 25h16"/><path class="l" style="animation-delay:.95s" d="M16 31h11"/></svg><h1>'+D.titulo+'</h1><p class="sub">'+D.sub+'</p></div>'
 +'<div class="prog">'+TIT.map(function(x,i){return '<i'+(i<=pg?' class="on"':'')+'></i>';}).join('')+'</div><p class="paso">Paso <b>'+(pg+1)+'</b> de '+N+' · '+TIT[pg]+'</p>';}
var UPI='<path d="M12 16V5M7.5 9.5 12 5l4.5 4.5"/><path d="M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3"/>';
function p0(){return '<h2>'+TIT[0]+'</h2><div class="dos">'+inp('nombre','Nombre')+inp('apellidos','Apellidos')+'</div>'+inp('nif','NIF / NIE')+inp('tel','Número de teléfono (sin espacios)','tel','600123456')+inp('email','Email','email','','','Te enviaremos una copia del documento firmado.')
 +(AL?inp('falta','Fecha del alta oncológica (aproximada) <small class="op">(opcional · día / mes / año)</small>','text','DD/MM/AAAA')
  +'<div class="q" data-k="informe"><label>Informe de alta <small class="op">(opcional)</small></label><p class="tx" style="margin:-2px 0 8px;font-size:12.5px">Si lo tienes a mano, puedes subir una foto o el PDF del informe.</p><label class="up"><svg viewBox="0 0 24 24" aria-hidden="true">'+UPI+'</svg><span>Toca para añadir fotos o PDF</span><input type="file" id="fin" accept="image/*,application/pdf" multiple></label><ul class="fl" id="fl"></ul><p class="err"></p></div>':'');}
function p1(){return '<h2>'+TIT[1]+'</h2><p class="tx">Por favor, marca «sí» o «no» en cada pregunta. Esta información es confidencial y nos ayuda a garantizar tu seguridad durante el tratamiento.</p>'
 +D.salud.map(function(x){return opc(x[0],x[1],x[2]||['Sí','No'],'sq');}).join('')
 +'<div class="q" style="margin-top:14px"><label>¿Hay algo más de tu salud que debamos saber? <small class="op">(opcional)</small></label><textarea data-i="notas">'+esc(S.notas||'')+'</textarea></div>';}
function firmaH(){return '<h3>Firma</h3><div class="q" data-k="firma"><div class="firma" id="fm"><canvas id="cv"></canvas><span>Firma aquí con el dedo</span></div><button type="button" class="bor" id="bf">Borrar firma</button><p class="err"></p></div><h3>Fecha</h3><div class="fecha">'+D.hoyTxt+'</div>';}
function pSP(){return '<h2>Consentimiento informado – Fisioterapia de suelo pélvico</h2><div class="box tx">'+D.spTxt.map(function(t){return '<p>'+t+'</p>';}).join('')+'</div><h3>Por favor, confirma lo siguiente</h3>'+chks(D.spOk,'ok')+firmaH();}
function pAL(){return '<h2>Situación médica actual</h2><div class="box tx">'+D.sit.map(function(t){return '<p>'+t+'</p>';}).join('')+'</div><h3>Sobre el tratamiento</h3><div class="box tx">'+D.trat.map(function(t){return '<p>'+t+'</p>';}).join('')+'</div><h3>Declaro que</h3>'+chks(D.okAl,'ok')+firmaH();}
var P=AL?[p0,pAL]:[p0,p1,pSP],OKS=AL?D.okAl:D.spOk;
function pintaFI(){var l=document.getElementById('fl');if(!l)return;l.innerHTML=FI.map(function(f,i){return '<li><span>'+esc(f.name)+'</span><button type="button" data-x="'+i+'" aria-label="Quitar">×</button></li>';}).join('');[].forEach.call(l.querySelectorAll('[data-x]'),function(b){b.onclick=function(){FI.splice(+b.getAttribute('data-x'),1);pintaFI();};});}
function pinta(){C.innerHTML=cab()+'<div class="fi">'+P[pg]()+'</div><div class="nav">'+(pg?'<button type="button" class="bk" id="atr">Atrás</button>':'')+'<button type="button" class="bt" id="sig">'+(pg<N-1?'Siguiente':'Firmar y enviar')+'</button></div>';ata();window.scrollTo(0,0);}
function ata(){
 [].forEach.call(C.querySelectorAll('[data-i]'),function(x){x.oninput=function(){var k=x.getAttribute('data-i');if(k==='falta'){var d=x.value.replace(/[^0-9]/g,'').slice(0,8),o=d.slice(0,2);if(d.length>2)o+='/'+d.slice(2,4);if(d.length>4)o+='/'+d.slice(4);if(x.value!==o)x.value=o;}S[k]=x.value;guarda();var q=x.closest('.q');if(q){q.classList.remove('mal');var e=q.querySelector('.err');if(e)e.textContent='';}};});
 [].forEach.call(C.querySelectorAll('.op2'),function(g){var w=g.parentNode,k=w.getAttribute('data-k');[].forEach.call(g.querySelectorAll('button'),function(b){b.onclick=function(){S[k]=b.getAttribute('data-v');guarda();[].forEach.call(g.querySelectorAll('button'),function(x){x.classList.toggle('on',x===b);});w.classList.remove('mal');var e=w.querySelector('.err');if(e)e.textContent='';};});});
 [].forEach.call(C.querySelectorAll('[data-c]'),function(x){x.onchange=function(){S[x.getAttribute('data-c')]=x.checked;guarda();var e=document.getElementById('eok');if(e)e.textContent='';};});
 var fi=document.getElementById('fin');if(fi){fi.onchange=function(){[].forEach.call(fi.files,function(f){if(FI.length<6)FI.push(f);});fi.value='';pintaFI();};pintaFI();}
 var a=document.getElementById('atr');if(a)a.onclick=function(){pg--;guarda();pinta();};
 document.getElementById('sig').onclick=sig;
 if(pg===N-1)firma();}
function firma(){var cv=document.getElementById('cv'),fm=document.getElementById('fm'),r=cv.getBoundingClientRect(),dp=window.devicePixelRatio||1;cv.width=r.width*dp;cv.height=r.height*dp;var x=cv.getContext('2d');x.scale(dp,dp);x.lineWidth=2.4;x.lineCap='round';x.lineJoin='round';x.strokeStyle='#1e2a38';
 var dib=false,tr=0,ul=null;function pt(e){var b=cv.getBoundingClientRect();return [e.clientX-b.left,e.clientY-b.top];}
 cv.onpointerdown=function(e){dib=true;ul=pt(e);cv.setPointerCapture(e.pointerId);};cv.onpointermove=function(e){if(!dib)return;var p=pt(e);x.beginPath();x.moveTo(ul[0],ul[1]);x.lineTo(p[0],p[1]);x.stroke();tr+=Math.hypot(p[0]-ul[0],p[1]-ul[1]);ul=p;if(tr>30){fm.classList.add('ok');S.firma=1;var q=fm.closest('.q');q.classList.remove('mal');q.querySelector('.err').textContent='';}};
 cv.onpointerup=cv.onpointercancel=function(){dib=false;};
 document.getElementById('bf').onclick=function(){x.clearRect(0,0,cv.width,cv.height);tr=0;S.firma=0;fm.classList.remove('ok');};S.firma=0;}
function mal(k,t){var w=C.querySelector('[data-k="'+k+'"]');if(!w)return;w.classList.add('mal');var e=w.querySelector('.err');if(e)e.textContent=t;}
function fFe(v){var m=String(v||'').trim().match(/^(\\d{1,2})[\\/\\-. ](\\d{1,2})[\\/\\-. ](\\d{4})$/);if(!m)return '';var d=+m[1],mo=+m[2],y=+m[3],dt=new Date(y,mo-1,d);if(dt.getDate()!==d||dt.getMonth()!==mo-1||y<1950||dt>new Date())return '';return y+'-'+String(mo).padStart(2,'0')+'-'+String(d).padStart(2,'0');}
function valida(){var ok=true,f=function(k,t){mal(k,t);ok=false;},v=function(k){return String(S[k]||'').trim();};
 if(pg===0){if(!v('nombre'))f('nombre','Escribe tu nombre');if(!v('apellidos'))f('apellidos','Escribe tus apellidos');if(v('nif').length<5)f('nif','Escribe el NIF o NIE');
  if(v('tel').replace(/[^0-9]/g,'').length<9)f('tel','Revisa el teléfono');if(!/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(v('email')))f('email','Revisa el email');
  if(AL&&v('falta')&&!fFe(v('falta')))f('falta','Escríbela así: 25/03/2024');}
 if(!AL&&pg===1){D.salud.forEach(function(x){if(!S[x[0]])f(x[0],'Elige una opción');});}
 if(pg===N-1){if(!OKS.every(function(t,i){return S['ok'+i];})){ok=false;var e=document.getElementById('eok');if(e)e.textContent=OKS.length===2?'Marca las dos casillas para continuar':'Marca las tres casillas para continuar';}if(!S.firma)f('firma','Firma en el recuadro');}
 if(!ok){var m=C.querySelector('.mal input,.mal .op2,.sq.mal,.mal .firma')||document.getElementById('eok');if(m)m.scrollIntoView({behavior:'smooth',block:'center'});}return ok;}
function b64(file){return new Promise(function(res,rej){if(/^image\\//.test(file.type)&&!/gif/.test(file.type)){var im=new Image(),u=URL.createObjectURL(file);im.onload=function(){var mx=1800,w=im.width,h=im.height,s=Math.min(1,mx/Math.max(w,h)),c=document.createElement('canvas');c.width=Math.round(w*s);c.height=Math.round(h*s);c.getContext('2d').drawImage(im,0,0,c.width,c.height);URL.revokeObjectURL(u);res({name:file.name.replace(/\\.[^.]+$/,'')+'.jpg',type:'image/jpeg',data:c.toDataURL('image/jpeg',.82).split(',')[1]});};im.onerror=rej;im.src=u;}
 else{if(file.size>3.2e6)return rej(new Error('El archivo '+file.name+' es demasiado grande'));var r=new FileReader();r.onload=function(){res({name:file.name,type:file.type||'application/pdf',data:String(r.result).split(',')[1]});};r.onerror=rej;r.readAsDataURL(file);}});}
function sig(){if(!valida())return;if(pg<N-1){pg++;guarda();pinta();return;}
 var b=document.getElementById('sig');b.disabled=true;b.textContent='Enviando…';
 var o={kind:D.kind};for(var k in S)if(k!=='_pg')o[k]=S[k];if(AL)o.falta=fFe(S.falta);o.firma=document.getElementById('cv').toDataURL('image/png');
 var post=function(x){return fetch(D.url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(x)}).then(function(r){return r.json();});};
 post(o).then(function(r){if(!r.ok)throw new Error(r.error||'');var ch=Promise.resolve();FI.forEach(function(f,i){ch=ch.then(function(){b.textContent='Subiendo informe '+(i+1)+'/'+FI.length+'…';return b64(f).then(function(x){return post({kind:D.kind,archivo:1,id:r.id,s:r.s,name:x.name,type:x.type,data:x.data});}).catch(function(){});});});
  return ch.then(function(){return post({kind:D.kind,fin:1,id:r.id,s:r.s});});}).then(function(){
  try{localStorage.removeItem(K);}catch(e){}var n=String(S.nombre||'').trim().split(/\\s+/)[0];n=n?n.charAt(0).toUpperCase()+n.slice(1).toLowerCase():'';
  document.body.classList.add('fin');C.innerHTML='<div class="ok"><svg width="88" height="88" viewBox="0 0 80 80" aria-hidden="true"><circle class="o" cx="40" cy="40" r="32" transform="rotate(-90 40 40)"/><path class="e" d="M25 35 Q30 29 35 35"/><path class="e" d="M45 35 Q50 29 55 35"/><path class="m" d="M26 45 Q40 62 54 45"/></svg><h1 class="fi" style="animation-delay:1s">¡Listo'+(n?', '+esc(n):'')+'!</h1><p class="sub fi" style="animation-delay:1.15s">Ya lo tenemos todo. ¡Gracias!<br><br>Te hemos enviado una copia a tu email.</p></div>';window.scrollTo(0,0);})
 .catch(function(e){b.disabled=false;b.textContent='Firmar y enviar';alert(e.message||'No se ha podido enviar. Inténtalo de nuevo.');});}
pinta();})();<\/script></body></html>`;
}
function ogOtroSvg(kind) {
  const K = CO_KIND[kind], T = '#c2552e', Kc = '#2b2420', M = '#8a7d74', O = ogTipos();
  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600"><rect width="600" height="600" fill="#f6f1eb"/><rect x="60" y="60" width="480" height="480" rx="44" fill="#fff"/>`
    + `<g fill="none" stroke="${T}" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"><path d="M318 150h-62a14 14 0 0 0-14 14v118a14 14 0 0 0 14 14h88a14 14 0 0 0 14-14v-92z"/><path d="M318 150v40h40"/><path d="M268 226h64M268 252h40"/></g>`
    + ogTexto(O.b, K.titulo, 40, 300, 384, 0, Kc) + ogTexto(O.m, K.ogSub, 23, 300, 426, 0, M) + ogTexto(O.m, 'Son 2 minutos', 21, 300, 466, 0, T) + `</svg>`;
}
function paginaCDocOtro(F, firmaSrc) {
  const e = escHtml, v = k => cNm(F[k]), tipo = v('TIPO'), al = tipo === 'Alta oncológica', nombre = `${String(F['NOMBRE'] || '').trim()} ${String(F['APELLIDOS'] || '').trim()}`.trim();
  const fila = (l, x) => x ? `<tr><td>${l}</td><td>${e(x)}</td></tr>` : '';
  const fN = x => String(x || '').slice(0, 10).split('-').reverse().join('/');
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${e(tipo)} · FISIO365</title>
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>*{box-sizing:border-box}body{margin:0;font-family:Poppins,system-ui,sans-serif;background:#efebe5;color:#1a1a1a;padding:20px 14px}.c{background:#fff;max-width:720px;margin:0 auto;border-radius:22px;padding:28px 24px}h1{font-size:21px;margin:0 0 2px}h2{font-size:15px;margin:22px 0 8px;color:#c2552e}.sub{color:#7d6a60;font-size:13px;margin:0 0 14px}p,li,td{font-size:13px;line-height:1.55;color:#3d3530}table{width:100%;border-collapse:collapse}td{padding:6px 0;border-bottom:1px solid #f1ebe5;vertical-align:top}td:first-child{color:#7d6a60;width:58%;padding-right:12px}.f{border:1px solid #efe6de;border-radius:14px;padding:10px;margin-top:6px;max-width:320px}.f img{width:100%;display:block}.reg{font-size:11.5px;color:#a3968c;white-space:pre-line}.bt{display:inline-block;margin-top:18px;background:#c2552e;color:#fff;border:none;border-radius:12px;padding:12px 18px;font:600 14px Poppins,sans-serif;cursor:pointer}
@media print{body{background:#fff;padding:0}.c{box-shadow:none;border-radius:0;padding:0}.bt{display:none}}</style></head><body><div class="c">
<h1>${al ? 'Alta oncológica' : 'Consentimiento informado – Fisioterapia de suelo pélvico'}</h1><p class="sub">FISIO365 · Fourth Dynamic, S.L. · Firmado el ${e(fN(F['FECHA']))}</p>
<h2>Datos del paciente</h2><table>${fila('Nombre', nombre)}${fila('NIF / NIE', F['DNI'])}${fila('Teléfono', F['TELF'])}${fila('Email', F['EMAIL'])}${al ? fila('Fecha del alta oncológica', fN(F['FECHA ALTA'])) + fila('Informe de alta', (F['INFORME'] || []).length ? (F['INFORME'].length + ' archivo(s) adjunto(s)') : '') : ''}</table>
${al ? `<h2>Situación médica actual</h2>${CO_ALTA_SIT.map(t => `<p>${t}</p>`).join('')}<h2>Sobre el tratamiento</h2>${(LEGAL || legalDe()).altaTrat.map(t => `<p>${t}</p>`).join('')}<h2>Declaro que</h2>${CO_ALTA_OK.map(t => `<p>☑ ${t}</p>`).join('')}`
    : `<h2>Cuestionario de salud</h2><table>${CO_SALUD_SP.map(x => fila(x[1], v(x[0]))).join('')}${fila('¿Hay algo más de tu salud que debamos saber?', F['NOTAS SALUD'])}</table><h2>Consentimiento informado</h2>${CF_SP_TXT.map(t => `<p>${t}</p>`).join('')}${F['ACEPTACIÓN S.P.'] ? CF_SP_OK.map(t => `<p>☑ ${t}</p>`).join('') : ''}`}
<h2>Firma</h2>${firmaSrc ? `<div class="f"><img src="${e(firmaSrc)}" alt="Firma"></div>` : ''}<p>Firmado el ${e(fN(F['FECHA']))}.</p>${F['REGISTRO FIRMA'] ? `<p class="reg">${e(F['REGISTRO FIRMA'])}</p>` : ''}
<button class="bt" onclick="print()">Guardar en PDF o imprimir</button></div></body></html>`;
}

// ── PAGO POR ADELANTADO (pacientes que han fallado): enlace personal por cita, tarjeta (Stripe) o transferencia ──
const PAGO_IBAN = 'ES14 0182 2392 8002 0302 2638', PAGO_TITULAR = 'Fourth Dynamic, S.L. (FISIO365)';
function firmaPago(id) { return require('crypto').createHmac('sha256', String(process.env.AIRTABLE_TOKEN || 'fisio365')).update('pago:' + id).digest('hex').slice(0, 10); }
const enlacePago = id => `https://app.fisioterapia365.com/pago/${id}-${firmaPago(id)}`;
async function stripeApi(path, form) {
  const K = process.env.STRIPE_SECRET_KEY; if (!K) throw new Error('Falta la clave de Stripe');
  const r = await fetch('https://api.stripe.com/v1/' + path, form ? { method: 'POST', headers: { Authorization: `Bearer ${K}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form).toString() } : { headers: { Authorization: `Bearer ${K}` } });
  const d = await r.json().catch(() => ({})); if (!r.ok) { console.log('stripe', path, r.status, JSON.stringify(d).slice(0, 300)); throw new Error((d.error && d.error.message) || 'Stripe ' + r.status); } return d;
}
const pagoAhora = () => new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', dateStyle: 'short', timeStyle: 'short' }).format(new Date());
// Avisos al móvil de dirección (Ramiro y Nora) y, si se indica, del fisio de la cita
async function pagoAvisar(fisio, title, body, tag, solo) {
  try { const fl = await at('tbl2mLUrnaKCFTs6g?fields[]=Name'); const nom1 = x => String(x.fields.Name || '').trim().split(' ')[0].toLowerCase(), recs = fl.records || [];
    const ids = recs.filter(x => solo ? solo.includes(nom1(x)) : ['ramiro', 'nora'].includes(nom1(x)) || (fisio && nom1(x) === String(fisio).split(' ')[0].toLowerCase())).map(x => x.id), { avisar } = require('./_push');
    await Promise.all([...new Set(ids)].map(fid => avisar('fisio', fid, { title, body, url: '/fisio', tag }).catch(() => false))); } catch (e) {}
}
// Comprueba en Stripe si la sesión de pago se ha completado y, si es así, deja la cita pagada y confirmada
async function pagoVerificar(id, F, sid) {
  sid = sid || String(F['PAGO REF'] || ''); if (!/^cs_[A-Za-z0-9_]+$/.test(sid)) return false;
  const s = await stripeApi('checkout/sessions/' + sid).catch(() => null);
  if (!s || s.payment_status !== 'paid' || (s.metadata || {}).cita !== id) return false;
  if (((F['PAGO ESTADO'] && F['PAGO ESTADO'].name) || F['PAGO ESTADO']) === 'PAGADO') return true;
  const imp = (s.amount_total || 0) / 100, reg = String(F['PAGO REGISTRO'] || '') + `\n${pagoAhora()} · Pagado con tarjeta (Stripe) ${imp.toFixed(2).replace('.', ',')} € · ${s.payment_intent || sid}`;
  const est = String((F['ESTADO'] && F['ESTADO'].name) || F['ESTADO'] || '').trim(), f = { 'PAGO ESTADO': 'PAGADO', 'PAGO REF': String(s.payment_intent || sid), 'PAGO REGISTRO': reg.trim(), CONFIR: ['CONFIRMADA'] };
  if (/CANCELADA/.test(est)) f.ESTADO = 'PENDIENTE '; // pagó justo al caducar: se le devuelve la cita si el hueco sigue libre (se revisa a mano)
  await at(`tblTPlcuiSjQngkaD/${id}`, { method: 'PATCH', body: JSON.stringify({ fields: f, typecast: true }) });
  await pagoQuitarMarca(F);
  const pac = await pagoPaciente(F); const fis = String((F['PREF.'] && F['PREF.'].name) || F['PREF.'] || '');
  await pagoAvisar(fis, `✅ ${pac.pila || 'Un paciente'} ha pagado ${imp.toFixed(2).replace('.', ',')} €`, `Cita del ${String(F['FECHA'] || '').slice(0, 10).split('-').reverse().join('/')} a las ${String(F['HORA'] || '')}: confirmada.${/CANCELADA/.test(est) ? ' Ojo: había caducado, revisa que el hueco siga libre.' : ''}`, 'pago-' + id);
  return true;
}
async function pagoQuitarMarca(F) { const pid = (F['RELACIÓN - CITA'] || [])[0]; if (pid) await at(`${PACIENTES}/${pid}`, { method: 'PATCH', body: JSON.stringify({ fields: { 'PAGO ADELANTADO': false } }) }).catch(() => {}); }
// Un paciente que tiene que pagar por adelantado coge cita él solo (app o enlace de huecos sin pago): aviso al móvil
// para mandarle el enlace. Solo una vez por cita (queda apuntado en PAGO REGISTRO).
async function avisoFaltaEnlace(citaId) {
  try {
    const c = await at(`tblTPlcuiSjQngkaD/${citaId}`); const F = c.fields || {}; if (c.error || F['PAGO ESTADO']) return false;
    const pid = (F['RELACIÓN - CITA'] || [])[0]; if (!pid || /Aviso: falta mandar el enlace/.test(String(F['PAGO REGISTRO'] || ''))) return false;
    const p = await at(`${PACIENTES}/${pid}`); const P = p.fields || {}; if (!P['PAGO ADELANTADO']) return false;
    await at(`tblTPlcuiSjQngkaD/${citaId}`, { method: 'PATCH', body: JSON.stringify({ fields: { 'PAGO REGISTRO': (String(F['PAGO REGISTRO'] || '') + `\n${pagoAhora()} · Aviso: falta mandar el enlace de pago`).trim() } }) });
    const nombre = String(P['FULL NAME'] || '').trim(); let pila = (String(P['NOMBRE'] || '').trim() || nombre).split(/\s+/)[0] || ''; pila = pila ? pila.charAt(0).toUpperCase() + pila.slice(1).toLowerCase() : 'Un paciente';
    const fecha = String(F['FECHA'] || '').slice(0, 10), hora = String(F['HORA'] || ''), fis = (F['PREF.'] && F['PREF.'].name) || F['PREF.'] || '', d = new Date(fecha + 'T12:00:00Z'), DS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
    await pagoAvisar(fis, `💳 ${pila} tiene que pagar antes: mándale el enlace`, `Ha cogido cita el ${DS[d.getUTCDay()]} ${d.getUTCDate()}/${d.getUTCMonth() + 1} a las ${hora}${fis ? ' con ' + String(fis).charAt(0) + String(fis).slice(1).toLowerCase() : ''}. ${P['PAGO ADELANTADO MOTIVO'] || ''}`.trim(), 'falta-' + citaId, ['nora']);
    return true;
  } catch (e) { return false; }
}
async function pagoPaciente(F) {
  const pid = (F['RELACIÓN - CITA'] || [])[0]; if (!pid) return { pila: '', nombre: '', email: '' };
  const p = await at(`${PACIENTES}/${pid}`).catch(() => ({})); const P = p.fields || {}, nombre = String(P['FULL NAME'] || '').trim();
  let pila = (String(P['NOMBRE'] || '').trim() || nombre).split(/\s+/)[0] || ''; pila = pila ? pila.charAt(0).toUpperCase() + pila.slice(1).toLowerCase() : '';
  return { pila, nombre, email: String(P['EMAIL'] || '').trim() };
}
// Pagos pendientes que han pasado de las 24 h: se cancela la cita, el hueco vuelve a quedar libre y se avisa a dirección
let _pagoCad = 0;
async function caducarPagos() {
  if (Date.now() - _pagoCad < 5 * 60e3) return 0; _pagoCad = Date.now(); let n = 0;
  const rs = await at(`tblTPlcuiSjQngkaD?filterByFormula=${encodeURIComponent(`AND({PAGO ESTADO}='PENDIENTE DE PAGO',IS_BEFORE({PAGO LÍMITE},NOW()))`)}&pageSize=50`).catch(() => ({}));
  for (const r of (rs.records || [])) { const F = r.fields || {};
    if (await pagoVerificar(r.id, F).catch(() => false)) continue;
    const fecha = String(F['FECHA'] || '').slice(0, 10), hora = String(F['HORA'] || ''), fis = (F['PREF.'] && F['PREF.'].name) || F['PREF.'] || '';
    const u = await at(`tblTPlcuiSjQngkaD/${r.id}`, { method: 'PATCH', body: JSON.stringify({ fields: { ESTADO: 'CANCELADA', 'PAGO ESTADO': 'CADUCADO', NOTAS: (String(F['NOTAS'] || '') + '\nCancelada sola: no pagó en 2 h.').trim(), 'PAGO REGISTRO': (String(F['PAGO REGISTRO'] || '') + `\n${pagoAhora()} · Caducado: no pagó en el plazo`).trim() }, typecast: true }) });
    if (u.error) continue; n++;
    if (fecha >= new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date())) await at('tblTPlcuiSjQngkaD', { method: 'POST', body: JSON.stringify({ records: [{ fields: { FECHA: fecha, HORA: hora, 'PREF.': fis, ESTADO: 'CITA LIBRE' } }], typecast: true }) }).catch(() => {});
    const pac = await pagoPaciente(F);
    await pagoAvisar('', `⏰ ${pac.pila || 'Un paciente'} no ha pagado en 2 h: cita cancelada`, `${fecha.split('-').reverse().join('/')} a las ${hora}${fis ? ' con ' + fis : ''}. El hueco vuelve a estar libre.`, 'pago-' + r.id);
  }
  return n;
}
// ── FACTURA POR ENLACE (WhatsApp): /f/{r|i}{id}-{firma} → página con el PDF; ?pdf=1 descarga ──
function firmaFac(t, id) { return require('crypto').createHmac('sha256', String(process.env.AIRTABLE_TOKEN || 'fisio365')).update('fac:' + t + ':' + id).digest('hex').slice(0, 10); }
const enlaceFac = (t, id) => `https://app.fisioterapia365.com/f/${t === 'invoice' ? 'i' : 'r'}${id}-${firmaFac(t === 'invoice' ? 'invoice' : 'salesreceipt', id)}`;
function ogFacSvg({ pila }) {
  const T = '#c2552e', K = '#2b2420', M = '#8a7d74', O = ogTipos(), t1 = pila ? `Tu factura, ${pila}` : 'Tu factura', ancho = O.b.getAdvanceWidth(t1, 100) / 100, sz = Math.min(38, Math.floor(370 / ancho));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600"><rect width="600" height="600" fill="#f6f1eb"/><rect x="60" y="60" width="480" height="480" rx="44" fill="#fff"/>`
    + `<g fill="none" stroke="${T}" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"><path d="M250 150h70l40 40v110a14 14 0 0 1-14 14H250a14 14 0 0 1-14-14V164a14 14 0 0 1 14-14z"/><path d="M320 150v40h40M262 230h70M262 258h70M262 286h40"/></g>`
    + ogTexto(O.b, t1, sz, 300, 390, 0, K) + ogTexto(O.m, 'FISIO365', 23, 300, 432, 0, M) + ogTexto(O.m, 'Toca para verla y descargarla', 21, 300, 470, 0, T) + `</svg>`;
}
function paginaFactura(D) {
  const e = escHtml;
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Tu factura · FISIO365</title>
<meta property="og:title" content="Tu factura de FISIO365${D.pila ? ', ' + e(D.pila) : ''}"><meta property="og:description" content="${e(D.numero ? 'Factura ' + D.numero + ' · ' : '')}Toca para verla y descargarla."><meta property="og:image" content="${e(D.url)}.png?v=1"><meta property="og:image:width" content="600"><meta property="og:image:height" content="600"><meta property="og:type" content="website">
<link rel="icon" href="https://app.fisioterapia365.com/icons/favicon-48.png"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>*{box-sizing:border-box}body{margin:0;font-family:Poppins,system-ui,sans-serif;background:#efebe5;color:#141414;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px 16px}
.c{background:#fff;border-radius:26px;padding:28px 22px 24px;max-width:420px;width:100%;box-shadow:0 10px 30px rgba(20,20,20,.06);text-align:center}
.lg{width:92px;display:block;margin:0 auto 22px}.ic{display:block;margin:0 auto 8px;width:60px;height:60px}.ic *{fill:none;stroke:#c2552e;stroke-width:1.4;stroke-linecap:round;stroke-linejoin:round}
h1{font-size:22px;margin:6px 0 4px}.sub{font-size:14.5px;color:#5c4f47;margin:0;line-height:1.5}
.f{display:flex;justify-content:space-between;align-items:center;gap:12px;text-align:left;background:#faf7f4;border-radius:18px;padding:14px 16px;margin:20px 0 16px}.f b{display:block;font-size:15px}.f span{font-size:13px;color:#7d6a60}.f .t{font-size:20px;font-weight:700;color:#2b2420;white-space:nowrap}
.b{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;background:#c2552e;color:#fff;text-decoration:none;font-weight:600;font-size:15.5px;border-radius:99px;padding:15px}.b svg{width:19px;height:19px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.n{font-size:12.5px;color:#9a8f87;margin:16px 0 0;line-height:1.5}</style></head><body><div class="c">
<img class="lg" src="/informe/logo.png" alt="FISIO365">
<svg class="ic" viewBox="0 0 24 24"><path d="M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v5h5M9 12h6M9 15h6M9 18h3"/></svg>
<h1>Tu factura${D.pila ? ', ' + e(D.pila) : ''}</h1><p class="sub">Aquí la tienes para verla, guardarla o enviarla a tu seguro.</p>
<div class="f"><div><b>${D.numero ? 'Factura ' + e(D.numero) : 'Factura'}</b><span>${e(D.fecha || '')}${D.concepto ? ' · ' + e(D.concepto) : ''}</span></div><div class="t">${e(D.total || '')}</div></div>
<a class="b" href="${e(D.url)}?pdf=1"><svg viewBox="0 0 24 24"><path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19h14"/></svg>Ver y descargar PDF</a>
<p class="n">También la tienes siempre en tu app de FISIO365. ¿Alguna duda? Escríbenos al 672 89 39 49.</p></div></body></html>`;
}
const facDatos = d => ({ numero: d.document_number || '', fecha: (() => { const v = d.date; if (!v) return ''; const t = /^\d+$/.test(String(v)) ? new Date(+v * 1000) : new Date(String(v).slice(0, 10) + 'T12:00:00Z'); return isNaN(t) ? '' : t.toLocaleDateString('es-ES', { timeZone: 'Europe/Madrid' }); })(), total: String(Math.round(importeDoc(d) * 100) / 100).replace('.', ',') + ' €', concepto: ((d.lines || [])[0] || {}).name || '' });
// ── RESEÑA EN GOOGLE con preview propia: /g/{pacId}-{firma} → página bonita con el botón a Google ──
function firmaRes(id) { return require('crypto').createHmac('sha256', String(process.env.AIRTABLE_TOKEN || 'fisio365')).update('res:' + id).digest('hex').slice(0, 10); }
const enlaceRes = id => `https://app.fisioterapia365.com/g/${id}-${firmaRes(id)}`;
function ogResSvg({ pila }) {
  const T = '#c2552e', K = '#2b2420', M = '#8a7d74', O = ogTipos(), t1 = pila ? `¡Qué bien, ${pila}!` : '¡Qué bien que estés mejor!', ancho = O.b.getAdvanceWidth(t1, 100) / 100, sz = Math.min(40, Math.floor(370 / ancho));
  const est = (cx, cy, r) => { let d = ''; for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.45 : r; d += (i ? 'L' : 'M') + (cx + rr * Math.cos(a)).toFixed(1) + ' ' + (cy + rr * Math.sin(a)).toFixed(1); } return d + 'Z'; };
  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600"><rect width="600" height="600" fill="#f6f1eb"/><rect x="60" y="60" width="480" height="480" rx="44" fill="#fff"/>`
    + `<g fill="none" stroke="${T}" stroke-width="4" stroke-linejoin="round"><path d="${est(300, 214, 66)}"/></g>`
    + ogTexto(O.b, t1, sz, 300, 384, 0, K) + ogTexto(O.m, '¿Nos cuentas tu experiencia?', 23, 300, 428, 0, M) + ogTexto(O.m, 'Un minuto en Google · FISIO365', 21, 300, 468, 0, T) + `</svg>`;
}
function paginaResena(D) {
  const e = escHtml;
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Tu reseña · FISIO365</title>
<meta property="og:title" content="${D.pila ? '¡Qué bien, ' + e(D.pila) + '!' : '¡Qué bien que estés mejor!'}"><meta property="og:description" content="¿Nos cuentas tu experiencia en Google? Es un minuto y nos ayuda muchísimo."><meta property="og:image" content="${e(D.url)}.png?v=1"><meta property="og:image:width" content="600"><meta property="og:image:height" content="600"><meta property="og:type" content="website">
<link rel="icon" href="https://app.fisioterapia365.com/icons/favicon-app-48.png"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>*{box-sizing:border-box}body{margin:0;font-family:Poppins,system-ui,sans-serif;background:#efebe5;color:#141414;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px 16px}
.c{background:#fff;border-radius:24px;padding:36px 26px 32px;max-width:400px;width:100%;box-shadow:0 10px 30px rgba(20,20,20,.06);text-align:center}
.lg{width:92px;display:block;margin:0 auto 28px}.st{display:block;margin:0 auto 12px;width:84px;height:84px}.st path{fill:none;stroke:#c2552e;stroke-width:.9;stroke-linejoin:round;stroke-dasharray:80;stroke-dashoffset:80;animation:dr 1.1s .15s cubic-bezier(.6,0,.2,1) forwards}
@keyframes dr{to{stroke-dashoffset:0}}svg.f{display:block;margin:0 auto}svg.f circle,svg.f path{stroke:#c2552e;fill:none;stroke-width:3;stroke-linecap:round}.o{stroke-dasharray:202;stroke-dashoffset:202;animation:dr .9s cubic-bezier(.6,0,.2,1) forwards}.dm{stroke-dasharray:44;stroke-dashoffset:44;animation:dr .45s .7s ease-out forwards}.de{opacity:0;animation:fi0 .3s .9s forwards}@keyframes fi0{to{opacity:1}}.estr{display:flex;gap:8px;justify-content:center;margin:20px 0 22px}.estr svg{width:26px;height:26px;opacity:0;transform:scale(.4);animation:est .4s forwards}.estr path{fill:#c2552e}@keyframes est{60%{transform:scale(1.2);opacity:1}to{transform:scale(1);opacity:1}}.ideas{text-align:center;margin:34px 0 4px;padding-top:30px;border-top:1px solid #f1ebe5}.ideas small{display:block;font-size:12.5px;color:#8a7d74;margin-bottom:20px;line-height:1.5}.chips{display:flex;flex-wrap:wrap;gap:12px 8px;justify-content:center}.chip{border:1.5px solid #efe6de;background:#faf7f4;border-radius:99px;padding:8px 13px;font:500 13.5px Poppins,sans-serif;color:#2b2420;cursor:pointer;text-align:center}.chip:active,.chip.on{background:#fbeee7;border-color:#c2552e;color:#c2552e}.hint{font-size:13px;line-height:1.65;color:#7d6a60;margin:22px 6px 0}.hint b{color:#2b2420;font-weight:600}.ins{text-align:left;background:#faf7f4;border-radius:16px;padding:15px 18px;margin:12px 0 0;font-size:13px;line-height:1.6;color:#5c4f47}.ins b{display:block;font-size:14px;color:#2b2420;margin-bottom:4px}.fi{opacity:0;transform:translateY(8px);animation:fi .55s forwards}@keyframes fi{to{opacity:1;transform:none}}
h1{font-size:22px;margin:18px 0 10px;line-height:1.25}.sub{font-size:15px;color:#5c4f47;margin:0;line-height:1.6}
.b{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;background:#c2552e;color:#fff;text-decoration:none;font-weight:600;font-size:16px;border-radius:99px;padding:16px}.b svg{width:20px;height:20px}
.ids{background:#faf7f4;border-radius:18px;padding:18px 18px 12px;margin:28px 0 0;text-align:left}.ids b{display:block;font-size:13px;color:#8a7d74;font-weight:600;margin-bottom:12px}.ids p{margin:6px 0 4px;font-size:12.5px;color:#a3441f;font-weight:600}.ids span{display:inline-block;font-size:13px;background:#fff;border:1px solid #efe6de;border-radius:99px;padding:5px 11px;margin:0 6px 8px 0;color:#5c4f47}
.n{font-size:12.5px;color:#9a8f87;margin:32px 0 0;line-height:1.5}.reg{display:flex;flex-direction:column;gap:10px;align-items:center;text-align:center;background:#fdf1ea;border-radius:16px;padding:18px 18px;margin:32px 0 22px;font-size:12.5px;line-height:1.45;color:#7d5a48}.reg b{display:block;font-size:13.5px;color:#a3441f;margin-bottom:1px}.reg svg{flex:none;width:30px;height:30px;fill:none;stroke:#c2552e;stroke-width:1.4;stroke-linecap:round;stroke-linejoin:round;overflow:visible}.reg .tapa,.reg .caja{transform-box:fill-box;transform-origin:50% 100%}.reg .tapa{animation:tapa 3.2s 2.2s ease-in-out infinite}.reg .caja{animation:caja 3.2s 2.2s ease-in-out infinite}@keyframes tapa{0%,62%,100%{transform:none}70%{transform:translateY(-4px) rotate(-10deg)}78%{transform:translateY(-2px) rotate(7deg)}86%{transform:translateY(-1px) rotate(-3deg)}92%{transform:none}}@keyframes caja{0%,62%,100%{transform:none}70%{transform:scale(1.06,.94)}80%{transform:scale(.97,1.04)}90%{transform:none}}</style></head><body><div class="c">
<svg class="f" width="84" height="84" viewBox="0 0 80 80" aria-hidden="true"><circle class="o" cx="40" cy="40" r="32" transform="rotate(-90 40 40)"/><g class="de"><path d="M25 35 Q30 29 35 35"/><path d="M45 35 Q50 29 55 35"/></g><path class="dm" d="M26 45 Q40 62 54 45"/></svg>
<h1 class="fi" style="animation-delay:.5s">${D.pila ? '¡Qué alegría, ' + e(D.pila) + '!' : '¡Qué alegría!'}</h1>
<p class="sub fi" style="animation-delay:.65s">Nos encanta saber que estás mejor. Si te apetece contarlo, tu reseña ayuda a otras personas a encontrarnos.</p>
${CLI.opciones.sorteo ? `<div class="reg fi" style="animation-delay:1s"><svg viewBox="0 0 24 24"><g class="caja"><path d="M5 12.5v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7M12 12.5v8"/></g><g class="tapa"><rect x="3.5" y="8.5" width="17" height="4" rx="1"/><path d="M12 8.5C10.5 5 7 4.5 7 6.6 7 8.2 9.5 8.5 12 8.5zM12 8.5c1.5-3.5 5-4 5-1.9 0 1.6-2.5 1.9-5 1.9z"/></g></svg><div><b>2 sesiones gratis cada mes</b>Las sorteamos entre todos los que nos dejáis una reseña en Google: una al azar y otra a la más original.</div></div>` : ''}
<a class="b fi" id="ag" style="animation-delay:1.15s" href="${RESENA_URL}"><svg viewBox="0 0 24 24"><path fill="#fff" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.3z"/><path fill="#fff" opacity=".85" d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22z"/><path fill="#fff" opacity=".7" d="M6.4 14c-.2-.6-.3-1.3-.3-2s.1-1.4.3-2V7.4H3.1A10 10 0 0 0 2 12c0 1.6.4 3.2 1.1 4.6L6.4 14z"/><path fill="#fff" opacity=".85" d="M12 6c1.5 0 2.8.5 3.8 1.5l2.9-2.9A10 10 0 0 0 3.1 7.4L6.4 10c.8-2.3 3-4 5.6-4z"/></svg>Escribir mi reseña en Google</a>
<p class="hint fi" style="animation-delay:1.3s"><b>Cuéntalo a tu manera:</b> cómo llegaste, cómo estás ahora, alguna anécdota…${CLI.opciones.sorteo ? ' ¡Las más originales tienen premio!' : ''}</p>
${(D.ideas || []).length ? `<div class="ideas fi" style="animation-delay:1.45s"><small>¿Con prisa? Toca una frase: la copiamos y solo tienes que pegarla en Google.</small><div class="chips">${D.ideas.map(x => `<button type="button" class="chip">${e(x)}</button>`).join('')}</div></div>` : ''}
<p class="n">¡Mil gracias por confiar en nosotros!</p></div><script>(function(){var G=document.getElementById('ag'),h=G.href;
function copiar(t){try{if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(t).catch(function(){});return;}}catch(e){}try{var a=document.createElement('textarea');a.value=t;document.body.appendChild(a);a.select();document.execCommand('copy');a.remove();}catch(e){}}
function ir(t){if(t)copiar(t);try{fetch(location.pathname,{method:'POST',headers:{'Content-Type':'application/json'},body:'{"g":1}',keepalive:true});}catch(e){}setTimeout(function(){location.href=h;},t?250:120);}
G.onclick=function(ev){ev.preventDefault();ir('');};
[].forEach.call(document.querySelectorAll('.chip'),function(c){c.onclick=function(){c.classList.add('on');ir(c.textContent+'.');};});})();</script></body></html>`;
}
function paginaPago(D) {
  const e = escHtml, J = JSON.stringify(D).replace(/</g, '\\u003c');
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Reserva tu cita · FISIO365</title>
<meta property="og:title" content="Reserva tu cita${D.pila ? ', ' + e(D.pila) : ''}"><meta property="og:description" content="Confírmala con el pago para guardarte el hueco."><meta property="og:image" content="${e(D.url || '')}.png?v=1"><meta property="og:image:width" content="600"><meta property="og:image:height" content="600">
<link rel="icon" href="https://app.fisioterapia365.com/icons/favicon-48.png"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>*{box-sizing:border-box}html,body{overflow-x:hidden}body{margin:0;font-family:Poppins,system-ui,sans-serif;background:#efebe5;color:#141414;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px 16px}
.c{background:#fff;border-radius:26px;padding:26px 20px 22px;max-width:440px;width:100%;box-shadow:0 10px 30px rgba(20,20,20,.06);text-align:center}
.ic{display:block;margin:0 auto 6px;width:62px;height:62px}.ic *{fill:none;stroke:#c2552e;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}.ic .p{stroke-dasharray:160;stroke-dashoffset:160;animation:dr 1s .1s forwards}@keyframes dr{to{stroke-dashoffset:0}}
h1{font-size:22px;margin:8px 0 4px}.sub{font-size:14.5px;color:#5c4f47;margin:0;line-height:1.5}
.cita{display:flex;align-items:center;gap:14px;text-align:left;background:#faf7f4;border-radius:18px;padding:14px 16px;margin:20px 0 14px}.cita .d{flex:none;width:54px;border-radius:14px;background:#fff;border:1.5px solid #efe6de;text-align:center;padding:5px 0 6px}.cita .d small{display:block;font-size:10.5px;font-weight:600;color:#c2552e;letter-spacing:.06em}.cita .d b{font-size:22px;line-height:1.1}.cita .t b{display:block;font-size:15px}.cita .t span{font-size:13px;color:#7d6a60}
.imp{font-size:30px;font-weight:700;margin:4px 0 2px;color:#2b2420}.reloj{display:inline-flex;align-items:center;gap:7px;background:#fdf1ea;color:#a3441f;border-radius:99px;padding:7px 13px;font-size:13px;font-weight:600;margin:6px 0 16px}.reloj svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round}
.pol{text-align:left;background:#faf7f4;border-radius:16px;padding:13px 15px;font-size:13px;color:#5c4f47;line-height:1.55;margin-bottom:10px}.pol b{color:#2b2420}
.chk{display:flex;gap:12px;align-items:center;text-align:left;font-size:13.5px;line-height:1.45;cursor:pointer;padding:13px 15px;border:1.5px solid #efe6de;border-radius:16px;margin-bottom:14px;transition:all .2s}.chk:has(input:checked){border-color:#c2552e;background:#fdf1ea}.chk input{-webkit-appearance:none;appearance:none;flex:none;width:24px;height:24px;margin:0;border:1.8px solid #d9c8bc;border-radius:8px;background:#fff;display:grid;place-content:center}.chk input:after{content:'';width:6px;height:11px;border:solid #fff;border-width:0 2.4px 2.4px 0;transform:rotate(45deg) scale(0);margin-top:-3px;transition:transform .18s}.chk input:checked{background:#c2552e;border-color:#c2552e}.chk input:checked:after{transform:rotate(45deg) scale(1)}
.chk.mal{border-color:#f0b4ad;box-shadow:0 0 0 1.5px #f0b4ad}
.bt{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;font:600 16px Poppins,sans-serif;color:#fff;background:#c2552e;border:none;border-radius:14px;padding:16px;cursor:pointer;text-decoration:none}.bt:disabled{opacity:.6}.bt svg{width:20px;height:20px;fill:none;stroke:#fff;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.bt2{width:100%;font:600 15px Poppins,sans-serif;color:#7d6a60;background:#f6f1eb;border:none;border-radius:14px;padding:14px;cursor:pointer;margin-top:8px}
.mini{font-size:12px;color:#a3968c;margin:8px 0 0}
.tr{display:none;text-align:left;margin-top:14px}.tr.on{display:block;animation:fi .4s}.fila{display:flex;align-items:center;justify-content:space-between;gap:10px;background:#faf7f4;border-radius:14px;padding:11px 14px;margin-bottom:8px}.fila small{display:block;font-size:11.5px;color:#8a7d74}.fila>div{min-width:0}.fila b{font-size:14px;overflow-wrap:anywhere}.fila b.ib{font-size:13px;white-space:nowrap;letter-spacing:-.01em}.fila button{flex:none;border:1.5px solid #efe6de;background:#fff;border-radius:10px;padding:7px 11px;font:600 12.5px Poppins,sans-serif;color:#c2552e;cursor:pointer}
.err{color:#b42318;font-size:13px;min-height:18px;margin:6px 0 0}
.fi{opacity:0;transform:translateY(8px);animation:fi .5s forwards}@keyframes fi{to{opacity:1;transform:none}}
.ok circle,.ok path{fill:none;stroke:#c2552e;stroke-width:3;stroke-linecap:round}.ok .o{stroke-dasharray:202;stroke-dashoffset:202;animation:dr .9s forwards}.ok .m{stroke-dasharray:60;stroke-dashoffset:60;animation:dr .5s .7s forwards}
.wa{display:inline-block;margin-top:16px;color:#c2552e;font-weight:600;font-size:14px;text-decoration:none}
@media (prefers-reduced-motion:reduce){*{animation-duration:.01s!important;animation-delay:0s!important}}</style></head>
<body><div class="c" id="c"></div><script>(function(){var D=${J},C=document.getElementById('c');
function esc(t){return String(t==null?'':t).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
var MS=['ENE','FEB','MAR','ABR','MAY','JUN','JUL','AGO','SEP','OCT','NOV','DIC'],DL=['domingo','lunes','martes','miércoles','jueves','viernes','sábado'],ML=['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
var dt=new Date(D.fecha+'T12:00:00'),eur=function(v){return (Math.round(v*100)/100).toFixed(2).replace('.',',').replace(',00','')+' €';};
var cita='<div class="cita fi" style="animation-delay:.5s"><div class="d"><small>'+MS[dt.getMonth()]+'</small><b>'+dt.getDate()+'</b></div><div class="t"><b>'+DL[dt.getDay()].charAt(0).toUpperCase()+DL[dt.getDay()].slice(1)+' '+dt.getDate()+' de '+ML[dt.getMonth()]+'</b><span>A las '+esc(D.hora)+(D.fisio?' · con '+esc(D.fisio):'')+'</span></div></div>';
var wa='<a class="wa" href="https://wa.me/34672893949" target="_blank" rel="noopener">¿Dudas? Escríbenos por WhatsApp</a>';
function okSvg(){return '<svg class="ok" width="84" height="84" viewBox="0 0 80 80" aria-hidden="true"><circle class="o" cx="40" cy="40" r="32" transform="rotate(-90 40 40)"/><path class="m" d="M27 41l9 9 17-18"/></svg>';}
function fin(t,s){C.innerHTML=okSvg()+'<h1 class="fi" style="animation-delay:.8s">'+t+'</h1><p class="sub fi" style="animation-delay:.95s">'+s+'</p>'+cita+wa;}
if(D.estado==='PAGADO')return fin('¡Cita confirmada'+(D.pila?', '+esc(D.pila):'')+'!','Hemos recibido tu pago de '+eur(D.importe)+'. ¡Te esperamos!');
if(D.estado==='TRANSFERENCIA AVISADA')return fin('¡Gracias'+(D.pila?', '+esc(D.pila):'')+'!','En cuanto veamos la transferencia en el banco te confirmamos la cita. Tu hueco sigue guardado.');
if(D.estado==='CADUCADO'||D.caducado){C.innerHTML='<h1>El plazo ha terminado</h1><p class="sub">Esta reserva ya no está disponible. Si aún quieres venir, escríbenos y te buscamos otro hueco.</p>'+cita+wa;return;}
if(D.estado!=='PENDIENTE DE PAGO'){C.innerHTML='<h1>Vaya…</h1><p class="sub">Este enlace ya no está activo. Escríbenos y lo vemos.</p>'+wa;return;}
var lim=new Date(D.limite);
function resto(){var ms=lim-new Date();if(ms<=0)return 'Plazo terminado';var h=Math.floor(ms/36e5),m=Math.floor(ms%36e5/6e4);return 'Te guardamos el hueco '+(h?h+' h '+m+' min':m+' min')+' más';}
C.innerHTML='<svg class="ic" viewBox="0 0 48 48" aria-hidden="true"><rect class="p" x="6" y="11" width="36" height="26" rx="5"/><path class="p" d="M6 19h36M13 29h8"/></svg><h1 class="fi" style="animation-delay:.3s">Reserva tu cita'+(D.pila?', '+esc(D.pila):'')+'</h1><p class="sub fi" style="animation-delay:.4s">Para guardarte el hueco, la sesión se paga por adelantado.</p>'
 +cita+'<div class="fi" style="animation-delay:.6s"><div class="imp">'+eur(D.importe)+'</div><div class="reloj"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg><span id="rl">'+resto()+'</span></div>'
 +'<div class="pol"><b>Si necesitas cambiar o cancelar</b>, avísanos con <b>24 h de antelación</b> y movemos tu cita sin problema (o te devolvemos el pago). Si no avisas a tiempo o no vienes, la sesión se considera realizada y el pago no se devuelve.</div>'
 +'<label class="chk" id="ck"><input type="checkbox" id="ac">Entiendo y acepto estas condiciones</label>'
 +'<button class="bt" id="bt"><svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="13" rx="2.5"/><path d="M3 10h18M7 15h4"/></svg>Pagar '+eur(D.importe)+' con tarjeta</button><p class="mini">Tarjeta, Apple Pay o Google Pay · pago seguro con Stripe</p><p class="err" id="er"></p>'
 +(D.iban?'<button class="bt2" id="bt2">Prefiero pagar por transferencia</button><div class="tr" id="tr"><div class="fila"><div><small>IBAN</small><b class="ib">'+esc(D.iban)+'</b></div><button data-cp="'+esc(D.iban.replace(/ /g,''))+'">Copiar</button></div><div class="fila"><div><small>Titular</small><b>'+esc(D.titular)+'</b></div></div><div class="fila"><div><small>Concepto</small><b>'+esc(D.concepto)+'</b></div><button data-cp="'+esc(D.concepto)+'">Copiar</button></div><div class="fila"><div><small>Importe</small><b>'+eur(D.importe)+'</b></div></div><button class="bt" id="bt3" style="margin-top:6px">Ya he hecho la transferencia</button></div>':'')
 +'</div>';
setInterval(function(){var r=document.getElementById('rl');if(r)r.textContent=resto();},30000);
var ac=document.getElementById('ac'),ck=document.getElementById('ck'),er=document.getElementById('er');ac.onchange=function(){ck.classList.remove('mal');er.textContent='';};
function acepta(){if(ac.checked)return true;ck.classList.add('mal');er.textContent='Marca la casilla para continuar';ck.scrollIntoView({behavior:'smooth',block:'center'});return false;}
function post(o){return fetch(D.url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(o)}).then(function(r){return r.json();});}
document.getElementById('bt').onclick=function(){if(!acepta())return;var b=this;b.disabled=true;b.lastChild.textContent='Abriendo el pago…';
 post({op:'tarjeta',acepta:1}).then(function(r){if(!r.ok||!r.url)throw new Error(r.error||'');location.href=r.url;}).catch(function(e){b.disabled=false;b.lastChild.textContent='Pagar '+eur(D.importe)+' con tarjeta';er.textContent=e.message||'No se ha podido abrir el pago. Inténtalo otra vez.';});};
var b2=document.getElementById('bt2');if(b2)b2.onclick=function(){document.getElementById('tr').classList.add('on');b2.style.display='none';document.getElementById('tr').scrollIntoView({behavior:'smooth',block:'center'});};
[].forEach.call(C.querySelectorAll('[data-cp]'),function(x){x.onclick=function(){try{navigator.clipboard.writeText(x.getAttribute('data-cp'));}catch(e){}x.textContent='¡Copiado!';setTimeout(function(){x.textContent='Copiar';},1500);};});
var b3=document.getElementById('bt3');if(b3)b3.onclick=function(){if(!acepta())return;b3.disabled=true;b3.textContent='Enviando…';post({op:'transferencia',acepta:1}).then(function(r){if(!r.ok)throw 0;D.estado='TRANSFERENCIA AVISADA';fin('¡Gracias'+(D.pila?', '+esc(D.pila):'')+'!','En cuanto veamos la transferencia en el banco te confirmamos la cita. Tu hueco sigue guardado.');window.scrollTo(0,0);}).catch(function(){b3.disabled=false;b3.textContent='Ya he hecho la transferencia';er.textContent='No se ha podido enviar. Inténtalo otra vez.';});};
})();<\/script></body></html>`;
}
function ogPagoSvg({ pila, importe }) {
  const T = '#c2552e', K = '#2b2420', M = '#8a7d74', O = ogTipos(), t1 = pila ? `Reserva tu cita, ${pila}` : 'Reserva tu cita', ancho = O.b.getAdvanceWidth(t1, 100) / 100, sz = Math.min(38, Math.floor(370 / ancho));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600"><rect width="600" height="600" fill="#f6f1eb"/><rect x="60" y="60" width="480" height="480" rx="44" fill="#fff"/>`
    + `<g fill="none" stroke="${T}" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"><rect x="222" y="160" width="156" height="110" rx="18"/><path d="M222 194h156M246 240h40"/></g>`
    + ogTexto(O.b, t1, sz, 300, 384, 0, K) + ogTexto(O.m, 'Confírmala con el pago', 23, 300, 426, 0, M) + (importe ? ogTexto(O.m, `${String(Math.round(importe * 100) / 100).replace('.', ',')} € · tarjeta o transferencia`, 21, 300, 466, 0, T) : '') + `</svg>`;
}

// ── ENCUESTA DE PRIMERA VISITA (página propia, enlace personal por cita) ──
// Misma lógica que la de Tally: Excelente → reseña en Google (con frases para copiar); el resto → qué podemos mejorar
const RESENA_URL = 'https://search.google.com/local/writereview?placeid=ChIJCadKnf2G6AIRcmUzdzMr4nk';
function firmaEnc(id) { return require('crypto').createHmac('sha256', String(process.env.AIRTABLE_TOKEN || 'fisio365')).update('enc:' + id).digest('hex').slice(0, 10); }
const enlaceEncuesta = id => `https://app.fisioterapia365.com/e/${id}-${firmaEnc(id)}`;
function firmaFin(id) { return require('crypto').createHmac('sha256', String(process.env.AIRTABLE_TOKEN || 'fisio365')).update('fin:' + id).digest('hex').slice(0, 10); }
const enlaceFin = id => `https://app.fisioterapia365.com/v/${id}-${firmaFin(id)}`;
// Frases para la reseña de Google: naturales y con las palabras que la gente busca (fisioterapia + Sant Andreu / Barcelona + su problema)
function ideasResena({ fisio, tema, fin }) {
  const t = String(tema || '').toLowerCase();
  const porTema = /suelo p|pélvic|pelvic|diástasis|diastasis|embaraz|postparto|parto/.test(t) ? (fin ? 'Suelo pélvico, de diez' : 'Me sentí muy cómoda')
    : /hernia|lumbar|espalda|ciátic|ciatic|lumbago/.test(t) ? (fin ? 'Mi espalda lo agradece' : 'La espalda, ya mucho mejor')
    : /cervical|cuello/.test(t) ? (fin ? 'Por fin sin dolor de cuello' : 'El cuello, ya lo noto')
    : /rodilla|menisco|ligamento/.test(t) ? (fin ? 'La rodilla, como nueva' : 'La rodilla, mucho mejor')
    : /hombro/.test(t) ? (fin ? 'Hombro recuperado' : 'El hombro, ya lo noto')
    : /deport|readapt|lesi|esguince|rotura|tendin/.test(t) ? (fin ? 'Ya entreno sin molestias' : 'Para lesiones, de diez')
    : (fin ? 'Me han ayudado muchísimo' : 'Ya noto la diferencia');
  return fin
    ? [porTema, 'Volvería sin dudarlo', 'Trato muy cercano', 'Se nota que saben lo que hacen', 'Gran fisio en Sant Andreu']
    : [porTema, 'Muy majos y muy profesionales', 'Me lo explicaron todo', 'Se nota que saben lo que hacen', 'Un buen fisio en Sant Andreu'];
}
function paginaEncuesta(D) {
  const e = t => String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fin = D.modo === 'fin', J = JSON.stringify({ pila: D.pila || '', fisio: D.fisio || '', v: D.v || '', url: D.url || '', google: RESENA_URL, fin, ideas: ideasResena({ fisio: D.fisio, tema: D.tema, fin }) }).replace(/</g, '\\u003c');
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${fin ? 'Tu experiencia' : 'Tu primera visita'} · FISIO365</title>
<meta property="og:title" content="${fin ? '¿Qué tal tu experiencia' : '¿Qué tal tu primera visita'}${D.pila ? ', ' + e(D.pila) : ''}?"><meta property="og:description" content="Un toque y listo. Nos ayuda muchísimo."><meta property="og:image" content="${D.url ? e(D.url) + '.png?v=1' : 'https://app.fisioterapia365.com/informe/og-cita-v3.png'}"><meta property="og:image:width" content="600"><meta property="og:image:height" content="600"><meta property="og:type" content="website">
<link rel="icon" href="https://app.fisioterapia365.com/icons/favicon-48.png"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>*{box-sizing:border-box}body{margin:0;font-family:Poppins,system-ui,sans-serif;background:#efebe5;color:#141414;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
.c{background:#fff;border-radius:24px;padding:36px 26px 32px;max-width:400px;width:100%;box-shadow:0 10px 30px rgba(20,20,20,.06);text-align:center}
svg.f{display:block;margin:0 auto}svg.f circle,svg.f path{stroke:#c2552e;fill:none;stroke-width:3;stroke-linecap:round}svg.f .ey{fill:#c2552e;stroke:none}
.o{stroke-dasharray:202;stroke-dashoffset:202;animation:dr .9s cubic-bezier(.6,0,.2,1) forwards}.dm{stroke-dasharray:44;stroke-dashoffset:44;animation:dr .45s .7s ease-out forwards}.de{opacity:0;animation:fi0 .3s .9s forwards}
@keyframes dr{to{stroke-dashoffset:0}}@keyframes fi0{to{opacity:1}}
.fi{opacity:0;transform:translateY(8px);animation:fi .55s forwards}@keyframes fi{to{opacity:1;transform:none}}
h1{font-size:22px;font-weight:700;margin:18px 0 10px;line-height:1.25}.sub{font-size:15px;color:#5c4f47;margin:0;line-height:1.6}
.caras{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin:24px 0 8px}
.cara{border:1.5px solid #efe6de;background:#fff;border-radius:18px;padding:14px 6px 12px;cursor:pointer;font:600 14px Poppins,sans-serif;color:#2b2420;transition:transform .15s,border-color .2s,background .2s;opacity:0;animation:fi .5s forwards}
.cara svg{width:46px;height:46px;display:block;margin:0 auto 6px}.cara svg circle,.cara svg path{stroke:#c2552e;fill:none;stroke-width:3.4;stroke-linecap:round}.cara svg .ey{fill:#c2552e;stroke:none}
.cara svg{transform-origin:50% 60%}.cara .oj ellipse,.cara .oj path{transform-box:fill-box;transform-origin:center}
.k0{animation:k0 2.4s ease-in-out infinite}.k1{animation:k1 3s .4s ease-in-out infinite}.k1 .oj ellipse{animation:parpa 3.6s 1s infinite}.k2 .oj{animation:lado 3.4s .8s ease-in-out infinite}.k2 .oj ellipse{animation:parpa 4.2s 2s infinite}.k3{animation:k3 3.8s 1.2s ease-in-out infinite}.k3 .bo{transform-box:fill-box;transform-origin:center;animation:tiem 3.8s 1.2s infinite}
@keyframes k0{0%,100%{transform:none}15%{transform:translateY(-6px) rotate(-8deg) scale(1.06)}30%{transform:translateY(0) rotate(0)}42%{transform:translateY(-3px) rotate(6deg)}55%{transform:none}}
@keyframes k1{0%,100%{transform:rotate(0)}25%{transform:rotate(-7deg)}75%{transform:rotate(7deg)}}
@keyframes lado{0%,20%,100%{transform:none}30%,45%{transform:translateX(-3.5px)}60%,75%{transform:translateX(3.5px)}}
@keyframes k3{0%,60%,100%{transform:none}66%{transform:rotate(-6deg)}72%{transform:rotate(6deg)}78%{transform:rotate(-4deg)}84%{transform:none}}
@keyframes tiem{0%,60%,100%{transform:none}70%,80%{transform:scaleX(.85) translateY(1px)}}
@keyframes parpa{0%,92%,100%{transform:scaleY(1)}96%{transform:scaleY(.1)}}
.cara:hover svg{animation-duration:1.2s}
.cara.on{background:#fbeee7;border-color:#c2552e;transform:scale(1.04)}.cara.on svg{animation:bote .55s}@keyframes bote{30%{transform:scale(1.28) rotate(-10deg)}60%{transform:scale(.95) rotate(6deg)}}
.cara.off{opacity:.45!important;transform:scale(.96)}
svg.f .ey{transform-box:fill-box;transform-origin:center}.mira .ojg{animation:miraA 4.5s 2.4s ease-in-out infinite}.mira .ey{animation:fi0 .3s .9s both,parpa 4s 3.2s infinite}
@keyframes miraA{0%,25%,100%{transform:none}33%,55%{transform:translateY(3.5px)}65%,80%{transform:translate(-2px,1px)}}
.estr svg:nth-child(n){transform-origin:center}.estr.brilla svg{animation:est .4s forwards,lat 2.4s 2s ease-in-out infinite}@keyframes lat{0%,100%{transform:scale(1)}50%{transform:scale(1.15)}}
.pista{font-size:12.5px;color:#a3968c;margin:10px 0 0}
.bt{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;font:600 16px Poppins,sans-serif;color:#fff;background:#c2552e;border:none;border-radius:99px;padding:16px;cursor:pointer;text-decoration:none;animation:fi .55s 1.2s both,resp 2.6s 2s ease-in-out infinite}
@keyframes resp{0%,100%{box-shadow:0 0 0 0 rgba(194,85,46,0)}50%{box-shadow:0 0 0 7px rgba(194,85,46,.13)}}
.g{width:20px;height:20px;background:#fff;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font:700 13px Arial,sans-serif;color:#c2552e}
.estr{display:flex;gap:8px;justify-content:center;margin:20px 0 22px}.estr svg{width:26px;height:26px;opacity:0;transform:scale(.4);animation:est .4s forwards}.estr path{fill:#c2552e}
@keyframes est{60%{transform:scale(1.2);opacity:1}to{transform:scale(1);opacity:1}}
.hint{font-size:13px;line-height:1.65;color:#7d6a60;margin:22px 6px 0}.hint b{color:#2b2420;font-weight:600}.ins{text-align:left;background:#faf7f4;border-radius:16px;padding:15px 18px;margin:12px 0 0;font-size:13px;line-height:1.6;color:#5c4f47}.ins b{display:block;font-size:14px;color:#2b2420;margin-bottom:4px}.ideas{text-align:center;margin:34px 0 4px;padding-top:30px;border-top:1px solid #f1ebe5}.ideas small{display:block;font-size:12.5px;color:#8a7d74;margin-bottom:20px;line-height:1.5}
.chips{display:flex;flex-wrap:wrap;gap:12px 8px;justify-content:center}.chip{border:1.5px solid #efe6de;background:#faf7f4;border-radius:99px;padding:8px 13px;font:500 13.5px Poppins,sans-serif;color:#2b2420;cursor:pointer;text-align:center}.chip:active,.chip.on{background:#fbeee7;border-color:#c2552e;color:#c2552e}
textarea{width:100%;min-height:110px;border:1.5px solid #e6ddd5;border-radius:14px;padding:12px 14px;font:400 16px Poppins,sans-serif;color:#141414;margin:18px 0 12px;resize:vertical;outline:none}textarea:focus{border-color:#c2552e}
.bt2{width:100%;font:600 16px Poppins,sans-serif;color:#fff;background:#c2552e;border:none;border-radius:99px;padding:15px;cursor:pointer}.bt2:disabled{opacity:.6}
.n{font-size:12.5px;color:#9a8f87;margin:32px 0 0;line-height:1.5}.nota{font-size:12.5px;color:#8a7d74;margin:18px 0 0}.reg{display:flex;flex-direction:column;gap:10px;align-items:center;text-align:center;background:#fdf1ea;border-radius:16px;padding:18px 18px;margin:32px 0 22px;font-size:12.5px;line-height:1.45;color:#7d5a48}.reg b{display:block;font-size:13.5px;color:#a3441f;margin-bottom:1px}.reg svg{flex:none;width:30px;height:30px;fill:none;stroke:#c2552e;stroke-width:1.4;stroke-linecap:round;stroke-linejoin:round;overflow:visible}.reg .tapa,.reg .caja{transform-box:fill-box;transform-origin:50% 100%}.reg .tapa{animation:tapa 3.2s 2.2s ease-in-out infinite}.reg .caja{animation:caja 3.2s 2.2s ease-in-out infinite}@keyframes tapa{0%,62%,100%{transform:none}70%{transform:translateY(-4px) rotate(-10deg)}78%{transform:translateY(-2px) rotate(7deg)}86%{transform:translateY(-1px) rotate(-3deg)}92%{transform:none}}@keyframes caja{0%,62%,100%{transform:none}70%{transform:scale(1.06,.94)}80%{transform:scale(.97,1.04)}90%{transform:none}}.err{font-size:13px;color:#b42318;margin:6px 0 0;min-height:18px}
@media (prefers-reduced-motion:reduce){.o,.dm,.de,.fi,.cara,.bt,.estr svg{animation-duration:.01s!important;animation-delay:0s!important}}</style></head>
<body><div class="c" id="c">${D.error ? `<h1>Vaya…</h1><p class="sub">${e(D.error)}</p>` : ''}</div>
${D.error ? '' : `<script>(function(){var D=${J},C=document.getElementById('c');
function ojos(t){return t==='feliz'?'<path d="M25 35 Q30 29 35 35"/><path d="M45 35 Q50 29 55 35"/>':'<ellipse class="ey" cx="30" cy="33" rx="2.6" ry="3.2"/><ellipse class="ey" cx="50" cy="33" rx="2.6" ry="3.2"/>';}
var CARAS=[['Excelente','feliz','M26 45 Q40 62 54 45'],['Muy buena','n','M29 46 Q40 55 51 46'],['Normal','n','M30 49 Q40 49 50 49'],['Mejorable','n','M30 52 Q40 44 50 52']];
function grande(o,m,c){return '<svg class="f'+(c?' '+c:'')+'" width="84" height="84" viewBox="0 0 80 80" aria-hidden="true"><circle class="o" cx="40" cy="40" r="32" transform="rotate(-90 40 40)"/><g class="de"><g class="ojg">'+ojos(o)+'</g></g><path class="dm" d="'+m+'"/></svg>';}
function esc(t){return String(t).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
function enviar(o){try{return fetch(D.url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(o),keepalive:true}).then(function(r){return r.json();});}catch(e){return Promise.reject(e);}}
var nom=D.pila?', '+esc(D.pila):'';
function paso1(){C.innerHTML=grande('n','M30 47 Q40 54 50 47','mira')+'<h1 class="fi" style="animation-delay:.9s">Hola'+nom+'</h1><p class="sub fi" style="animation-delay:1s">'+(D.fin?'¿Qué tal ha sido tu experiencia en FISIO365'+(D.fisio?' con '+esc(D.fisio):'')+'?':'¿Qué tal tu primera visita'+(D.fisio?' con '+esc(D.fisio):'')+'?')+'</p><div class="caras">'+CARAS.map(function(x,i){return '<button class="cara" data-v="'+x[0]+'" style="animation-delay:'+(1.2+i*.08)+'s"><svg class="k'+i+'" viewBox="0 0 80 80" aria-hidden="true"><circle cx="40" cy="40" r="32"/><g class="oj">'+ojos(x[1])+'</g><path class="bo" d="'+x[2]+'"/></svg>'+x[0]+'</button>';}).join('')+'</div><p class="pista fi" style="animation-delay:1.7s">Un toque y listo.</p>';
 [].forEach.call(C.querySelectorAll('.cara'),function(b){b.onclick=function(){[].forEach.call(C.querySelectorAll('.cara'),function(x){x.classList.toggle('on',x===b);x.classList.toggle('off',x!==b);});var v=b.getAttribute('data-v');enviar({v:v}).catch(function(){});setTimeout(function(){v==='Excelente'?excelente():mejorar(v);},650);};});}
function copiar(t){try{if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(t).catch(function(){});return;}}catch(e){}try{var a=document.createElement('textarea');a.value=t;document.body.appendChild(a);a.select();document.execCommand('copy');a.remove();}catch(e){}}
function irGoogle(t){if(t)copiar(t);enviar({resena:1}).catch(function(){});setTimeout(function(){location.href=D.google;},t?250:60);}
function excelente(){var f=D.fisio||'El equipo',F=D.ideas&&D.ideas.length?D.ideas:D.fin?[(D.fisio?'Gracias a '+D.fisio+' estoy':'Estoy')+' mucho mejor',f+' es muy profesional','Me explicaron todo muy bien','Trato cercano y muy amable','100% recomendable']:[f+' es muy profesional',D.fisio?'Me explicó todo muy bien':'Me explicaron todo muy bien','Noté mejoría desde la primera sesión','Trato cercano y muy amable','El centro es precioso'];
 C.innerHTML=grande('feliz','M26 45 Q40 62 54 45')+'<h1 class="fi" style="animation-delay:.8s">¡Qué alegría'+nom+'!</h1><p class="sub fi" style="animation-delay:.95s">'+(D.fisio?'A '+esc(D.fisio)+' le hará muchísima ilusión. ':'')+'¿Nos lo cuentas en Google? Son 20 segundos.</p>'
 +'${CLI.opciones.sorteo ? '<div class="reg fi" style="animation-delay:1.05s"><svg viewBox="0 0 24 24"><g class="caja"><path d="M5 12.5v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7M12 12.5v8"/></g><g class="tapa"><rect x="3.5" y="8.5" width="17" height="4" rx="1"/><path d="M12 8.5C10.5 5 7 4.5 7 6.6 7 8.2 9.5 8.5 12 8.5zM12 8.5c1.5-3.5 5-4 5-1.9 0 1.6-2.5 1.9-5 1.9z"/></g></svg><div><b>2 sesiones gratis cada mes</b>Las sorteamos entre todos los que nos dejáis una reseña en Google: una al azar y otra a la más original.</div></div>' : ''}'
 +'<a class="bt" href="'+D.google+'" id="gb"><span class="g">G</span>Escribir mi reseña en Google</a>'
 +'<p class="hint fi" style="animation-delay:1.4s"><b>Cuéntalo a tu manera:</b> cómo llegaste, cómo estás ahora, alguna anécdota…${CLI.opciones.sorteo ? ' ¡Las más originales tienen premio!' : ''}</p>'
 +'<div class="ideas fi" style="animation-delay:1.8s"><small>¿Con prisa? Toca una frase: la copiamos y solo tienes que pegarla en Google.</small><div class="chips">'+F.map(function(x){return '<button class="chip">'+esc(x)+'</button>';}).join('')+'</div></div><p class="n">¡Mil gracias por confiar en nosotros!</p>';
 [].forEach.call(C.querySelectorAll('.chip'),function(c){c.onclick=function(){c.classList.add('on');irGoogle(c.textContent+'.');};});
 document.getElementById('gb').onclick=function(ev){ev.preventDefault();irGoogle('');};}
function mejorar(v){var mal=v!=='Muy buena';C.innerHTML=grande('n',mal?'M31 50 Q40 46 49 50':'M29 46 Q40 55 51 46')
 +'<h1 class="fi" style="animation-delay:.8s">'+(mal?'Gracias por contárnoslo'+nom:'¡Gracias'+nom+'!')+'</h1><p class="sub fi" style="animation-delay:.95s">'+(mal?(D.fin?'Queremos saber qué podemos hacer mejor. Cuéntanos: lo lee dirección hoy mismo.':'Queremos que tu próxima visita sea excelente. Cuéntanos qué pasó: lo lee dirección hoy mismo.'):(D.fin?'¿Qué podríamos mejorar para que tu experiencia fuera excelente?':'¿Qué podemos mejorar para que tu próxima visita sea excelente?'))+'</p>'
 +'<textarea class="fi" id="tx" style="animation-delay:1.1s" placeholder="'+(mal?'Lo que nos quieras contar…':'Cualquier detalle nos ayuda…')+'"></textarea><p class="err" id="er"></p><button class="bt2 fi" id="en" style="animation-delay:1.2s">Enviar</button>';
 var tx=document.getElementById('tx'),er=document.getElementById('er'),ido=false;tx.oninput=function(){er.textContent='';};
 // Si escribe y cierra sin pulsar «Enviar», se manda igualmente lo que haya escrito
 var alSalir=function(){var t=tx.value.trim();if(t&&!ido){ido=true;enviar({v:v,c:t}).catch(function(){});}};
 document.addEventListener('visibilitychange',function(){if(document.visibilityState==='hidden')alSalir();});window.addEventListener('pagehide',alSalir);
 document.getElementById('en').onclick=function(){var t=tx.value.trim();if(!t){er.textContent='Escribe aunque sea una frase, por favor.';tx.focus();return;}var b=this;b.disabled=true;b.textContent='Enviando…';ido=true;
  enviar({v:v,c:t}).then(function(r){if(!r||!r.ok)throw 0;gracias(mal);}).catch(function(){ido=false;b.disabled=false;b.textContent='Enviar';er.textContent='No se ha podido enviar. Inténtalo otra vez.';});};}
function gracias(mal){C.innerHTML=grande('feliz','M28 46 Q40 57 52 46')+'<h1 class="fi" style="animation-delay:.8s">¡Gracias'+nom+'!</h1><p class="sub fi" style="animation-delay:.95s">'+(mal?'Lo revisamos hoy mismo y te escribimos si hace falta. Gracias por ayudarnos a mejorar.':(D.fin?'Nos ayuda muchísimo. Y ya sabes que seguimos aquí para lo que necesites.':'Nos ayuda muchísimo. ¡Nos vemos en tu próxima sesión!'))+'</p>';}
if(D.v==='Excelente')excelente();else if(D.v&&D.yaCom)gracias(D.v!=='Muy buena');else if(D.v)mejorar(D.v);else paso1();})();<\/script>`}</body></html>`;
}
function firmaCita(id) { return require('crypto').createHmac('sha256', String(process.env.AIRTABLE_TOKEN || 'fisio365')).update('cita:' + id).digest('hex').slice(0, 10); }
const enlaceConfirmar = id => `https://app.fisioterapia365.com/c/${id}-${firmaCita(id)}`;
function paginaConfirmar(D, C) {
  const e = t => String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'], MES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const fl = D.fecha ? (() => { const d = new Date(D.fecha + 'T12:00:00Z'); return `${DIAS[d.getUTCDay()]} ${d.getUTCDate()} de ${MES[d.getUTCMonth()]}`; })() : '';
  const tel = String(C.tel || '').replace(/\s/g, '');
  const appB = !D.app ? '' : `<div class="cons app fi" style="animation-delay:2.6s"><div class="ah"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M10.5 18.5h3"/></svg><div><b>Tu app de FISIO365</b><p>Tu fisio te acompaña también entre sesiones</p></div></div>
      <div class="vt">${(D.app.ejercicios ? ['Tus ejercicios en vídeo, ya preparados', 'Chat directo con tu fisio', 'Tus citas a mano', 'Tus informes y documentos'] : ['Chat directo con tu fisio', 'Tus citas a mano', 'Ejercicios en vídeo para ti', 'Tus informes y documentos']).map(t => `<span><svg class="ck" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>${t}</span>`).join('')}</div>
      <div class="acc"><span class="u">Usuario<b>${e(D.app.usuario)}</b></span><i></i><span>PIN<b>${e(D.app.pin)}</b></span></div>
      <div class="dos"><a href="https://play.google.com/store/apps/details?id=es.fisioterapia365.app" target="_blank" rel="noopener">Android</a><a href="https://app.fisioterapia365.com" target="_blank" rel="noopener">iPhone</a></div>
      <small>iPhone: ábrela en Safari › Compartir › «Añadir a pantalla de inicio».</small></div>`;
  const cuerpo = D.error && !D.fecha ? `<h1>Vaya…</h1><p>${e(D.error)}</p>`
    : !D.inactiva && !D.confirmada && D.fecha ? (() => {
      const d = new Date(D.fecha + 'T12:00:00Z'), [H, Mi] = String(D.hora || '00:00').split(':').map(Number), gH = (H % 12) * 30 + Mi * .5 + 720, gM = Mi * 6 + 360 * Math.max(2, H % 12);
      const ojos = D.av2 ? `<path class="ce" d="M23 27 L32 23.5"/><path class="ce" d="M48 23.5 L57 27"/><ellipse class="ey" cx="30" cy="34" rx="4.3" ry="5.2"/><ellipse class="ey" cx="50" cy="34" rx="4.3" ry="5.2"/><circle class="br" cx="31.6" cy="31.8" r="1.5"/><circle class="br" cx="51.6" cy="31.8" r="1.5"/>` : `<ellipse class="ey" cx="30" cy="33" rx="2.6" ry="3.2"/><ellipse class="ey" cx="50" cy="33" rx="2.6" ry="3.2"/>`;
      return `<svg class="fc parp" id="cara" width="88" height="88" viewBox="0 0 80 80" aria-hidden="true"><circle class="o" cx="40" cy="40" r="32" transform="rotate(-90 40 40)"/><g class="ojos" id="ojos">${ojos}</g><path class="m" id="boca" d="${D.av2 ? 'M34 50 Q40 53.5 46 50' : 'M30 47 Q40 54 50 47'}"/></svg>
      <p class="hola fi" style="animation-delay:.9s">${D.av2 ? `¡${D.pila ? e(D.pila) + ', t' : 'T'}e estamos guardando el sitio!` : `Hola${D.pila ? ', ' + e(D.pila) : ''}`}</p>
      <p class="sub fi" style="animation-delay:1s">Confírmanos que vienes</p>
      <div class="hoja fi" style="animation-delay:.3s"><div class="band">${e(DIAS[d.getUTCDay()].toUpperCase())} · ${e(MES[d.getUTCMonth()].toUpperCase())}</div><div class="num">${d.getUTCDate()}</div>
       <div class="row"><svg class="clk" viewBox="0 0 30 30" aria-hidden="true"><circle cx="15" cy="15" r="12.5"/><line class="hh" x1="15" y1="15" x2="15" y2="9" style="--h:${gH}deg"/><line class="mm" x1="15" y1="15" x2="15" y2="5.5" style="--m:${gM}deg"/></svg><span class="hora">${e(D.hora)}</span></div>
       ${D.fisio ? `<div class="con">con ${e(D.fisio)}</div>` : '<div class="con"></div>'}</div>
      ${D.error ? `<p class="err">${e(D.error)}</p>` : ''}
      <form method="post" id="fcf"><button type="submit" class="bt" id="go">¡Allí estaré!</button></form>
      <p class="pista fi" style="animation-delay:2s">Un toque y lo tenemos</p>
      <script>(function(){var f=document.getElementById('fcf'),ya=false;f.onsubmit=function(ev){if(ya)return;ev.preventDefault();ya=true;var b=document.getElementById('go');b.disabled=true;b.textContent='¡Gracias!';
       var m=document.getElementById('boca');m.style.strokeDasharray='none';m.setAttribute('d','M26 45 Q40 62 54 45');var o=document.getElementById('ojos');o.style.animation='none';
       o.innerHTML='<path d="M25 35 Q30 29 35 35"/><path d="M45 35 Q50 29 55 35"/>';setTimeout(function(){f.submit();},700);};})();</script>`; })()
    : D.confirmada && !D.inactiva ? (() => { const r = Math.max(1, D.racha || 1), nd = Math.min(7, Math.max(r, 5)), lleno = Math.min(r, nd);
      const dc = (() => { const d = new Date(D.fecha + 'T12:00:00Z'); return `${DIAS[d.getUTCDay()]} ${d.getUTCDate()}`; })();
      return `<div class="okv"><svg class="sm" width="88" height="88" viewBox="0 0 80 80" aria-hidden="true"><circle class="c1" cx="40" cy="40" r="32" transform="rotate(-90 40 40)"/><path class="e1" d="M25 35 Q30 29 35 35"/><path class="e1" d="M45 35 Q50 29 55 35"/><path class="s1" d="M26 45 Q40 62 54 45"/></svg>
      <p class="okt fi" style="animation-delay:1.1s">${D.recien ? '¡Confirmada' : 'Cita confirmada'}${D.pila ? ', ' + e(D.pila) : ''}${D.recien ? '!' : ''}</p>
      <p class="oks fi" style="animation-delay:1.3s">Te esperamos el ${e(dc)} a las ${e(D.hora)}${D.fisio ? ' con ' + e(D.fisio) : ''}.</p>
      <div class="cuenta fi" style="animation-delay:1.7s"><svg class="mini" viewBox="0 0 48 48" aria-hidden="true"><rect x="8" y="11" width="32" height="29" rx="5"/><path d="M8 19h32M16 7v7M32 7v7"/><path class="tk" d="M18 29.5l4.5 4.5L31 25.5"/></svg><p class="rt">${(() => { const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date()), n = Math.round((Date.parse(D.fecha + 'T12:00:00Z') - Date.parse(hoy + 'T12:00:00Z')) / 864e5); return n <= 0 ? '<b>¡Es hoy!</b> Nos vemos en un ratito' : n === 1 ? '<b>¡Es mañana!</b> Ya queda nada' : `Faltan <b>${n} días</b>`; })()}</p></div>
      ${D.cal ? `<a class="cal fi" style="animation-delay:2.4s" href="${e(D.cal.ics)}"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M16 3v4M8 3v4M4 10h16M12 13v4M10 15h4"/></svg>Añadir a mi calendario</a><a class="gcal fi" style="animation-delay:2.5s" href="${e(D.cal.google)}" target="_blank" rel="noopener">o en Google Calendar</a>` : ''}</div>`; })()
      + (D.consent ? `<div class="cons"><b>Como es tu primera visita…</b><p>Puedes ir rellenando ya el consentimiento informado y tus datos de salud. Son 2 minutos y así, cuando llegues, empezamos directamente con tu sesión.</p><a class="btn2" href="${e(D.consent)}" target="_blank" rel="noopener">Rellenar el consentimiento</a><small>Pon tu propio teléfono en el formulario, por favor.</small></div>` : '') + appB
    : `<p class="hola">${D.pila ? 'Hola, ' + e(D.pila) : 'Hola'} 👋</p><p class="sub">${D.inactiva ? '' : D.confirmada ? '' : 'Te esperamos en FISIO365.'}</p><div class="cita"><small>Tu cita</small><b>${e(fl.charAt(0).toUpperCase() + fl.slice(1))}</b><b>a las ${e(D.hora)}</b>${D.fisio ? `<span>Con ${e(D.fisio)}</span>` : ''}</div>
      ${D.error ? `<p class="err">${e(D.error)}</p>` : ''}
      ${D.inactiva ? `<p>Esta cita ya no está activa.</p>` : D.confirmada ? `<div class="ok">✓ ${D.recien ? '¡Perfecto! Cita confirmada' : 'Tu cita está confirmada'}</div><p class="peq">Te esperamos.</p>`
        : `<form method="post"><button type="submit">¡Allí estaré!</button></form>`}
      ${!D.inactiva && D.consent ? `<div class="cons"><b>Como es tu primera visita…</b><p>Puedes ir rellenando ya el consentimiento informado y tus datos de salud. Son 2 minutos y así, cuando llegues, empezamos directamente con tu sesión.</p><a class="btn2" href="${e(D.consent)}" target="_blank" rel="noopener">Rellenar el consentimiento</a><small>Pon tu propio teléfono en el formulario, por favor.</small></div>` : ''}`;
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Tu cita · FISIO365</title>
<meta property="og:title" content="Tu cita en FISIO365"><meta property="og:description" content="${e(fl ? (fl.charAt(0).toUpperCase() + fl.slice(1)) + ' a las ' + (D.hora || '') : 'Tu cita en FISIO365')}"><meta property="og:image" content="${D.id && D.fecha ? `https://app.fisioterapia365.com/c/${D.id}-${firmaCita(D.id)}.png?g=4&v=${e(D.fecha.replace(/-/g, ''))}${e(String(D.hora || '').replace(':', ''))}${D.fisio ? '-' + e(D.fisio.toLowerCase()) : ''}` : 'https://app.fisioterapia365.com/informe/og-cita-v3.png'}"><meta property="og:image:width" content="${D.id && D.fecha ? 600 : 800}"><meta property="og:image:height" content="${D.id && D.fecha ? 600 : 800}"><meta property="og:type" content="website">
<link rel="icon" href="https://app.fisioterapia365.com/icons/favicon-48.png"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&display=swap" rel="stylesheet">
<style>*{box-sizing:border-box}body{margin:0;font-family:Poppins,system-ui,sans-serif;background:#efebe5;color:#141414;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
.c{background:#fff;border-radius:24px;padding:28px 22px;max-width:400px;width:100%;box-shadow:0 10px 30px rgba(20,20,20,.06);text-align:center}
.logo{display:block;width:84px;height:84px;border-radius:22px;margin:0 auto 18px}.hola{font-size:22px;font-weight:700;margin:0 0 4px}.sub{font-size:15px;color:#5c4f47;margin:0 0 18px;min-height:2px}
.cita{background:#f3efea;border-radius:18px;padding:18px 14px;display:flex;flex-direction:column;gap:2px;margin-bottom:20px}.cita small{font-size:12px;color:#7d6a60;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px}.cita b{font-size:20px;line-height:1.3}.cita span{margin-top:6px;color:#5c4f47}
button{width:100%;font-family:inherit;font-size:16px;font-weight:600;color:#fff;background:#c2552e;border:none;border-radius:14px;padding:16px;cursor:pointer}
.ok{background:#e8f6ec;color:#16803c;font-weight:600;border-radius:14px;padding:16px}.err{color:#b42318}.peq{font-size:14px;color:#7d6a60;margin:12px 0 0}
.cons{margin-top:18px;background:#fbf3ec;border-radius:18px;padding:18px 16px;text-align:left}.cons b{display:block;font-size:16px;margin-bottom:4px}.cons p{margin:0 0 14px;font-size:14px;color:#5c4f47;line-height:1.5}.cons small{display:block;margin-top:10px;font-size:12px;color:#7d6a60}
.cons.app{padding:14px 14px 12px;margin-top:16px}.app .ah{display:flex;gap:11px;align-items:center;margin-bottom:10px}.app .ah svg{flex:none;width:34px;height:34px;padding:6px;background:#fff;border-radius:10px;fill:none;stroke:#c2552e;stroke-width:1.7;stroke-linecap:round}.app .ah b{font-size:15px;margin:0}.app .ah p{margin:0;font-size:13px;line-height:1.4}.app .ah svg{background:#c2552e!important;stroke:#fff!important}.app .vt{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:10px}.app .vt span{display:flex;gap:6px;align-items:flex-start;background:#fff;border-radius:10px;padding:8px 9px;font-size:12px;line-height:1.3;color:#2b2420}.app .vt .ck{flex:none;width:14px;height:14px;margin-top:1px;fill:none;stroke:#16803c;stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round}
.app .acc{display:flex;align-items:center;background:#fff;border-radius:10px;padding:7px 12px;font-size:11px;color:#a3968c;margin-bottom:8px}.app .acc span{display:flex;flex-direction:column;line-height:1.3}.app .acc .u{flex:1;min-width:0}.app .acc b{font-size:13.5px;color:#141414;margin:0;word-break:break-all}.app .acc i{align-self:stretch;width:1px;background:#efe6de;margin:2px 12px}
.app .dos{display:flex;gap:8px}.app .dos a{flex:1;text-align:center;text-decoration:none;font-weight:600;font-size:13.5px;color:#1e2a38;background:#fff;border:1.2px solid #1e2a38;border-radius:10px;padding:8px}.cons.app small{margin-top:7px;font-size:11.5px}
.btn2{display:block;text-align:center;text-decoration:none;font-weight:600;font-size:15px;color:#1e2a38;background:#fff;border:1.5px solid #1e2a38;border-radius:14px;padding:13px}
.fc{display:block;margin:0 auto}.fc circle,.fc path{stroke:#c2552e;fill:none;stroke-width:3;stroke-linecap:round}.fc .ce{stroke-width:2.2}
.fc .o{stroke-dasharray:202;stroke-dashoffset:202;animation:dr .9s cubic-bezier(.6,0,.2,1) forwards}
.fc .m{stroke-dasharray:40;stroke-dashoffset:40;animation:dr .4s .7s ease-out forwards;transition:d .45s cubic-bezier(.3,1.4,.5,1)}
.fc .ey{fill:#c2552e;stroke:none;opacity:0;animation:fi0 .3s .9s forwards;transform-box:fill-box;transform-origin:center}.fc .br{fill:#fff;stroke:none;opacity:0;animation:fi0 .3s 1.1s forwards}
.fc .ce{opacity:0;animation:fi0 .3s 1s forwards}
.parp .ojos{animation:mira 5s 2.6s ease-in-out infinite}.parp .ey{animation:fi0 .3s .9s forwards,blink 5s 3.8s infinite}
@keyframes mira{0%,30%,100%{transform:none}38%,62%{transform:translateY(3.5px)}}@keyframes blink{0%,94%,100%{transform:scaleY(1)}97%{transform:scaleY(.1)}}@keyframes fi0{to{opacity:1}}
.hoja{margin:22px auto;width:210px;border-radius:20px;overflow:hidden;background:#fff;box-shadow:0 0 0 1.5px #efe6de}
.hoja .band{background:#c2552e;color:#fff;font-weight:700;font-size:12px;letter-spacing:.18em;padding:9px 0;transform:translateY(-100%);animation:band .5s .5s cubic-bezier(.2,.8,.3,1) forwards}@keyframes band{to{transform:none}}
.hoja .num{font-size:74px;font-weight:700;line-height:1;margin:12px 0 6px;color:#2b2420}.hoja .row{display:flex;align-items:center;justify-content:center;gap:9px;padding:0 0 12px}
.clk{width:30px;height:30px}.clk circle{fill:none;stroke:#c2552e;stroke-width:1.6}.clk line{stroke:#c2552e;stroke-width:1.8;stroke-linecap:round;transform-origin:15px 15px}
.clk .hh{animation:hh 1.6s .8s cubic-bezier(.3,0,.2,1) both}.clk .mm{animation:mm 1.6s .8s cubic-bezier(.3,0,.2,1) both}@keyframes hh{from{transform:rotate(0)}to{transform:rotate(var(--h))}}@keyframes mm{from{transform:rotate(0)}to{transform:rotate(var(--m))}}
.hora{font-size:22px;font-weight:700;color:#c2552e}.con{font-size:13.5px;color:#8a7d74;padding-bottom:16px;min-height:16px}
.bt{animation:fi .55s 1.6s both,resp 2.6s 2.4s ease-in-out infinite}@keyframes resp{0%,100%{box-shadow:0 0 0 0 rgba(194,85,46,0)}50%{box-shadow:0 0 0 7px rgba(194,85,46,.13)}}
.pista{font-size:12.5px;color:#a3968c;margin:10px 0 0}
.okv{padding:4px 0 2px}.sm{display:block;margin:4px auto 0}.sm circle,.sm path{stroke:#c2552e;fill:none;stroke-width:3;stroke-linecap:round}
.sm .c1{stroke-dasharray:202;stroke-dashoffset:202;animation:dr .9s cubic-bezier(.6,0,.2,1) forwards}.sm .e1{stroke-dasharray:14;stroke-dashoffset:14;animation:dr .35s .6s ease-out forwards}.sm .s1{stroke-dasharray:40;stroke-dashoffset:40;transform-origin:40px 46px;animation:dr .5s .75s cubic-bezier(.3,0,.2,1) forwards,smi .45s 1.25s ease-in-out}
@keyframes dr{to{stroke-dashoffset:0}}@keyframes smi{50%{transform:scaleX(1.18)}}
.fi{opacity:0;transform:translateY(6px);animation:fi .5s forwards}@keyframes fi{to{opacity:1;transform:none}}
.okt{font-size:23px;font-weight:700;margin:14px 0 0}.oks{font-size:15px;color:#5c4f47;margin:6px 0 0}.okv .fi{display:block}.okv a.cal.fi{display:flex}
.dots{display:flex;gap:8px;justify-content:center;margin:20px 0 8px}.dots i{width:11px;height:11px;border-radius:50%;border:1.5px solid #e2b7a6}.dots i.on{background:#c2552e;border-color:#c2552e}
.dots i.nw{animation:pop .45s 2.2s forwards}@keyframes pop{0%{transform:scale(1)}60%{transform:scale(1.55);background:#c2552e;border-color:#c2552e}100%{transform:scale(1);background:#c2552e;border-color:#c2552e}}
.rt{font-size:13.5px;color:#7d6a60;margin:0}.rt b{color:#c2552e}
.cuenta{margin:18px 0 0}.mini{display:block;width:46px;height:46px;margin:0 auto 8px;transform-origin:24px 7px;animation:col 1.4s 1.9s ease-in-out both,sal 3.2s 4s ease-in-out infinite}.mini rect,.mini path{fill:none;stroke:#c2552e;stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round}
.mini .tk{stroke-dasharray:22;stroke-dashoffset:22;animation:dr .45s 2.7s ease-out forwards}
@keyframes col{0%{transform:rotate(-14deg)}30%{transform:rotate(10deg)}55%{transform:rotate(-6deg)}78%{transform:rotate(3deg)}100%{transform:none}}
@keyframes sal{0%,70%,100%{transform:none}78%{transform:translateY(-5px) rotate(-4deg)}86%{transform:translateY(0)}92%{transform:translateY(-2px) rotate(3deg)}}
.cal{display:flex;align-items:center;justify-content:center;gap:8px;margin-top:18px;text-decoration:none;font-weight:600;font-size:15px;color:#141414;background:#fff;border:1.5px solid #e6ddd5;border-radius:14px;padding:12px}.cal svg{width:19px;height:19px;stroke:#c2552e;fill:none;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.gcal{font-size:13px;color:#7d6a60;margin-top:8px}
@media (prefers-reduced-motion:reduce){.fc .o,.fc .m,.fc .ey,.fc .br,.fc .ce,.hoja .band,.clk line,.bt,.sm .e1,.sm .c1,.sm .s1,.fi,.dots i.nw,.mini,.mini .tk{animation-duration:.01s!important;animation-delay:0s!important}}
.pie{margin-top:22px;font-size:12.5px;color:#7d6a60;line-height:1.6}.pie a{color:#7d6a60}h1{font-size:20px}</style></head>
<body><div class="c">${!D.inactiva && D.fecha ? '' : '<img class="logo" src="https://app.fisioterapia365.com/icono.png" alt="FISIO365">'}${cuerpo}<div class="pie">${e(C.direccion || '')}${tel ? `<br>¿Dudas? Llámanos al <a href="tel:+34${e(tel)}">${e(C.tel)}</a>` : ''}</div></div></body></html>`;
}
// Citas antiguas sin «TIPO DE SESIÓN»: se deduce de sus etiquetas de siempre
const sesionDeEtiquetas = L => { const t = (L || []).map(x => String(x || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim());
  return t.includes('DIASTASIS') ? 'Diástasis' : t.some(x => /^SUELO PELVICO$/.test(x)) ? 'Suelo pélvico' : t.includes('AVANZADA') ? 'Fisioterapia avanzada' : t.includes('CONVENCIONAL') ? 'Fisioterapia convencional' : ''; };
const CONF_DEF = {
  listas: {
    conceptos: [{ n: 'Sesión de fisioterapia', p: '' }, { n: 'Sesión de fisioterapia avanzada', p: '' }, { n: 'Sesión de suelo pélvico', p: '' }, { n: 'Sesión de readaptación deportiva', p: '' }, { n: 'Plus aplicación colágeno', p: '' }, { n: 'Otros', p: '' }],
    pagos: ['Tarjeta', 'Efectivo', 'Bizum', 'Transferencia'],
    motivos: ['Busca ecografía', 'Sanitas', 'Adeslas', 'Otros seguros', 'No tenemos disponibilidad', 'Pide precios', 'Solo pide info', 'Quiere algo que no tenemos'],
    negocios: ['FARMACIA', 'PODÓLOGO', 'CLÍNICA DENTAL', 'CLÍNICA ESTÉTICA', 'GIMNASIO', 'OTRO'],
    sesiones: ['Fisioterapia convencional', 'Fisioterapia avanzada', 'Suelo pélvico', 'Diástasis', 'Readaptación deportiva', 'ATM', 'Hernia/Protusión'],
    zonas: ['Cervical', 'Hombro', 'Codo, muñeca y mano', 'Dorsal', 'Lumbar', 'Cadera y glúteo', 'Rodilla', 'Tobillo y pie', 'Core', 'Equilibrio', 'Neurodinamia', 'Respiración', 'General']
  },
  tarjeta: { importe: 10, meses: 6 },
  holded: { borrador: true, rgpd: TEXTO_RGPD },
  clinica: { razon: 'Fourth Dynamic, S.L.', nif: 'B56503592', direccion: 'C/ Gran de Sant Andreu, 163 · 08030 Barcelona', tel: '672 89 39 49', email: 'info@fisioterapia365.com' },
  cancelacion: { horas: 24, texto: 'Si no puedes venir, avísanos con al menos 24 horas de antelación para poder dar tu hora a otra persona.' },
  legal: {},
  plantillas: {}, // mensajes de WhatsApp escritos por la clínica (vacío = los de siempre)
  // App del paciente: servicios con precios y packs, y promociones (Administración › App del paciente)
  app: {
    servicios: [
      { nombre: 'Fisioterapia', desc: 'Para contracturas, dolor de espalda, tirones y molestias del día a día.', suelta: 65, packs: [[5, 310], [10, 585], [20, 1100]] },
      { nombre: 'Fisioterapia avanzada', desc: 'Con tecnología (bomba diamagnética, ondas de choque) para hernias, tendinitis y lesiones que se resisten.', suelta: 75, packs: [[5, 345], [10, 640], [20, 1220]] }
    ],
    promos: [
      { etiqueta: 'Siempre disponible', titulo: 'Packs de sesiones', texto: 'Cada sesión te sale más barata: hasta 280 € de ahorro. Pagas una vez y solo te preocupas de mejorar.', boton: 'Ver packs', accion: 'packs', color: 'Naranja' },
      { etiqueta: 'Regalo', titulo: 'Regala fisioterapia', texto: 'Una tarjeta regalo para quien quieras. La preparas en 2 minutos.', boton: 'Regalar', accion: 'https://tally.so/r/WOVB0N?origen=app', color: 'Negro' }
    ]
  }
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
  const nom = Object.fromEntries(nombres.map(p => [p.id, p.fields['FULL NAME'] || '']));
  // Llamadas y tareas pueden ser de pacientes que hoy no tenían cita: se buscan sus nombres (Airtable solo devuelve el id)
  { const faltan = [...new Set([...segPend, ...tarPend].flatMap(r => [...(r.fields['PACIENTE'] || []), ...(r.fields['PacRec'] || [])]).filter(x => typeof x === 'string' && /^rec[A-Za-z0-9]{14}$/.test(x) && !nom[x]))];
    if (faltan.length) (await lotes(faltan, ids => capTodos(PACIENTES, `filterByFormula=${encodeURIComponent('OR(' + ids.map(id => `RECORD_ID()='${id}'`).join(',') + ')')}&fields[]=FULL%20NAME`)).catch(() => [])).forEach(p => { nom[p.id] = p.fields['FULL NAME'] || ''; }); }
  const nomLink = v => (Array.isArray(v) ? v : []).map(x => (x && x.name) || nom[x] || (/^rec[A-Za-z0-9]{14}$/.test(String(x)) ? '' : x)).filter(Boolean).join(', ');
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
      // (la anamnesis no se comprueba: a veces se hace fuera de la app)
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

// «No reagenda»: guarda en POR QUÉ HISTORIAL el motivo actual (y el nuevo, si lo hay) antes de cambiarlo o borrarlo
async function porQueAlHist(pid, nuevo, fisio, hoy) {
  try {
    const pr = await at(`${PACIENTES}/${pid}`); const PF = pr.fields || {};
    const L = String(PF['POR QUÉ HISTORIAL'] || '').split('\n').filter(Boolean), n0 = L.length;
    const ya = t => L.some(l => { try { return JSON.parse(l).t === t; } catch (e) { return false; } });
    if (PF['POR QUÉ NO REAGENDA'] && !ya(PF['POR QUÉ NO REAGENDA'])) L.push(JSON.stringify({ f: PF['POR QUÉ FECHA'] || '', q: PF['POR QUÉ FISIO'] || '', t: PF['POR QUÉ NO REAGENDA'] }));
    if (nuevo && !ya(nuevo.slice(0, 2000))) L.push(JSON.stringify({ f: hoy, q: fisio || '', t: nuevo.slice(0, 2000) }));
    if (L.length !== n0) await at(`${PACIENTES}/${pid}`, { method: 'PATCH', body: JSON.stringify({ fields: { 'POR QUÉ HISTORIAL': L.slice(-40).join('\n') } }) });
  } catch (e) { console.error('porque-hist', e.message); }
}
const _memo = new Map(), _pacB = { t: 0, v: null, p: null }; // _pacB: nombres y teléfonos de todos los pacientes (5 min)
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { patientId, action } = req.query;
  // Datos de la clínica (Administración › Ajustes): las páginas salen con su nombre, dirección, teléfono…
  let PLANT = {};
  try { const c0 = await conf(); CLI = MARCA.datos(c0.clinica); LEGAL = legalDe(c0.legal); PLANT = c0.plantillas || {}; } catch (e) { LEGAL = legalDe(); }
  { const _send = res.send.bind(res); res.send = b => _send(typeof b === 'string' && !/json/i.test(String(res.getHeader('Content-Type') || '')) ? MARCA.marcar(b, CLI) : b); }
  if (action === 'clinica-pub') { // lo público de la clínica para la app y el panel (nombre, teléfono, opciones…)
    const C = CLI; res.setHeader('Cache-Control', 'public, max-age=60');
    return res.status(200).json({ ok: true, clinica: { marca: C.marca, tel: C.tel, wa: C.wa, email: C.email, web: C.web, direccion: C.direccion, dirCorta: C.dirCorta, zona: C.zona, ciudad: C.ciudad, resena: 'https://search.google.com/local/writereview?placeid=' + C.googlePlace, opciones: C.opciones, color: C.color, logo: C.logoV ? '/api/schedule?action=clinica-logo&v=' + C.logoV : '', plantillas: PLANT }, pares: MARCA.pares(C) });
  }
  if (action === 'clinica-logo') { // logo subido en Administración › Ajustes
    const L = await ajuste('clinica-logo', null), m = L && String(L.data || '').match(/^data:(image\/(png|jpeg|webp|svg\+xml));base64,(.+)$/);
    if (!m) { res.setHeader('Location', '/informe/logo.png'); return res.status(302).end(); }
    res.setHeader('Content-Type', m[1]); res.setHeader('Cache-Control', 'public, max-age=86400'); return res.status(200).end(Buffer.from(m[3], 'base64'));
  }
  // Medición de velocidad: se apunta en los logs cuánto tarda cada acción (para saber qué pantallas van lentas)
  { const t0 = Date.now(); res.on('finish', () => { const ms = Date.now() - t0; console.log(`TIEMPO ${action || '-'} ${ms}ms${ms > 1500 ? ' LENTO' : ''}`); }); }
  // Respuestas de las consultas pesadas guardadas 60 s en el servidor (cualquier cambio por POST las borra)
  const postLectura = /^(seg-com-buzon|reporte-dia|compra-lista|seg-sug-lista|seg-sug-contar|seg-com-hilo|seg-wa-ia)$/.test(action || '');
  if (req.method === 'POST' && !postLectura) _memo.clear(); // solo los cambios borran lo guardado (las consultas por POST no)
  else if (/^(seg-referidos|seg-referidos-resueltos|seg-consent-pendientes|seg-app-pendientes|seg-sin-anotar|seg-cap-avisos|seg-sinevo-lista|rendimiento|seg-lista|reporte-dia)$/.test(action || '')) {
    const k = req.method === 'POST' ? action + '|' + JSON.stringify(req.body || {}) : req.url, m = _memo.get(k);
    if (m && Date.now() - m.t < 60000) return res.status(200).json(m.v);
    const j0 = res.json.bind(res);
    res.json = v => { if ((res.statusCode || 200) === 200 && v && v.ok !== false) { if (_memo.size > 60) _memo.clear(); _memo.set(k, { t: Date.now(), v }); } return j0(v); };
  }

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
    const pid = (F['RELACIÓN - CITA'] || [])[0]; let pila = '', P = {};
    if (pid) { const p = await at(`${PACIENTES}/${pid}`).catch(() => ({})); P = p.fields || {}; pila = (String(P['NOMBRE'] || '').trim() || String(P['FULL NAME'] || '').trim()).split(/\s+/)[0] || ''; }
    const hoyC = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const D = { id, av2: String(req.query.r || '') === '2', pila: pila ? pila.charAt(0).toUpperCase() + pila.slice(1).toLowerCase() : '', fecha, hora, fisio: fisio ? fisio.charAt(0).toUpperCase() + fisio.slice(1).toLowerCase() : '' };
    if (!/PENDIENTE/.test(est) || fecha < hoyC) return res.status(200).send(paginaConfirmar({ ...D, inactiva: true }, C));
    let conf0 = (F['CONFIR'] || []).some(x => /CONFIRMADA/i.test(x.name || x));
    if (req.method === 'POST' && !conf0) {
      const u = await at(`tblTPlcuiSjQngkaD/${id}`, { method: 'PATCH', body: JSON.stringify({ fields: { CONFIR: ['CONFIRMADA'] } }) });
      if (u.error) return res.status(500).send(paginaConfirmar({ ...D, error: 'No se ha podido confirmar. Inténtalo de nuevo en un momento.' }, C));
      conf0 = true;
    }
    const pide = pid ? await pidenConsentimiento([pid], fecha).catch(() => new Set()) : new Set();
    // Ya ha venido alguna vez y no tiene la app instalada: dentro le damos el acceso (como hacía el recordatorio)
    let app = null;
    if (pid && !pide.has(pid) && !(P['APP INSTALADA'] || P['PushSubscription'])) {
      const email = String(P['EMAIL'] || '').trim(), t = String(P['WHATSAPP'] || P['TELF'] || '').replace(/\D/g, '').slice(-9);
      const vino = (pide.yaVino && pide.yaVino.has(pid)) || !!(await at(`tblTPlcuiSjQngkaD?filterByFormula=${encodeURIComponent(`AND(TRIM({ESTADO})='REALIZADA',FIND('${pid}',ARRAYJOIN({PacienteRec})))`)}&maxRecords=1&fields[]=FECHA`).catch(() => ({})).then(x => (x.records || []).length));
      if (vino && (email || t.length >= 9)) {
        let pin = String(P['PIN'] || '').trim();
        if (!pin) { pin = nuevoPin(); await at(`${PACIENTES}/${pid}`, { method: 'PATCH', body: JSON.stringify({ fields: { PIN: pin } }) }).catch(() => {}); }
        const pl = await at(`tblvgE0a4gsrj4Vhp?filterByFormula=${encodeURIComponent(`AND(LEN({Ejercicios}&'')>2,{PacienteID}='${pid}')`)}&maxRecords=1&fields[]=PacienteID`).catch(() => ({}));
        app = { usuario: email || t, pin, ejercicios: !!(pl.records || []).length };
      }
    }
    const extra = conf0 ? { cal: { ics: `https://app.fisioterapia365.com/c/${id}-${firmaCita(id)}.ics`, google: calendarioCita(D, C).google } } : {};
    return res.status(200).send(paginaConfirmar({ ...D, ...extra, confirmada: conf0, recien: req.method === 'POST', consent: pide.has(pid) ? CONSENT_URL : '', app }, C));
  }
  // Enlace personal de la app (página y vista previa)
  if (action === 'app-pagina' || action === 'app-og') {
    const id = String(req.query.id || ''), sg = String(req.query.s || '');
    if (!/^rec[A-Za-z0-9]{14}$/.test(id) || sg !== firmaApp(id)) { res.setHeader('Content-Type', 'text/html; charset=utf-8'); return res.status(404).send(paginaEncuesta({ error: 'Este enlace no es válido.' })); }
    const p = await at(`${PACIENTES}/${id}`); const P = p.fields || {};
    let pila = (String(P['NOMBRE'] || '').trim() || String(P['FULL NAME'] || '').trim()).split(/\s+/)[0] || ''; pila = pila ? pila.charAt(0).toUpperCase() + pila.slice(1).toLowerCase() : '';
    if (action === 'app-og') {
      try { const { Resvg } = require('@resvg/resvg-js'); const png = new Resvg(MARCA.marcar(ogAppSvg({ pila }), CLI), { font: { loadSystemFonts: false } }).render().asPng(); res.setHeader('Content-Type', 'image/png'); res.setHeader('Cache-Control', 'public, max-age=86400'); return res.status(200).send(png); }
      catch (e) { res.setHeader('Location', 'https://app.fisioterapia365.com/informe/og-cita-v3.png'); return res.status(302).end(); }
    }
    if (p.error) { res.setHeader('Content-Type', 'text/html; charset=utf-8'); return res.status(404).send(paginaEncuesta({ error: 'No encontramos tus datos. Escríbenos y te ayudamos.' })); }
    let pin = String(P['PIN'] || '').trim(); if (!pin) { pin = nuevoPin(); await at(`${PACIENTES}/${id}`, { method: 'PATCH', body: JSON.stringify({ fields: { PIN: pin } }) }).catch(() => {}); }
    const email = String(P['EMAIL'] || '').trim(), t = String(P['WHATSAPP'] || P['TELF'] || '').replace(/\D/g, '').slice(-9);
    const C = (await conf().catch(() => CONF_DEF)).clinica || CONF_DEF.clinica;
    res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('X-Robots-Tag', 'noindex');
    return res.status(200).send(paginaApp({ pila, usuario: email || t, pin, url: enlaceApp(id), play: 'https://play.google.com/store/apps/details?id=es.fisioterapia365.app', web: 'https://app.fisioterapia365.com', tel: C.tel || '672 89 39 49' }));
  }
  // Formulario de primera visita propio (consentimiento + salud + firma) y la copia del paciente
  if (action === 'consentimiento-og') {
    try { const { Resvg } = require('@resvg/resvg-js'); const png = new Resvg(MARCA.marcar(ogConsSvg(), CLI), { font: { loadSystemFonts: false } }).render().asPng(); res.setHeader('Content-Type', 'image/png'); res.setHeader('Cache-Control', 'public, max-age=86400'); return res.status(200).send(png); }
    catch (e) { return res.redirect(302, 'https://app.fisioterapia365.com/informe/og-cita-v3.png'); }
  }
  // Formularios propios de suelo pélvico y alta oncológica
  if (action === 'cons-otro-og') {
    const kind = CO_KIND[req.query.kind] ? req.query.kind : 'sp';
    try { const { Resvg } = require('@resvg/resvg-js'); const png = new Resvg(MARCA.marcar(ogOtroSvg(kind), CLI), { font: { loadSystemFonts: false } }).render().asPng(); res.setHeader('Content-Type', 'image/png'); res.setHeader('Cache-Control', 'public, max-age=86400'); return res.status(200).send(png); }
    catch (e) { return res.redirect(302, 'https://app.fisioterapia365.com/informe/og-cita-v3.png'); }
  }
  if (action === 'cons-otro') {
    res.setHeader('Cache-Control', 'private, no-store');
    const q0 = req.method === 'POST' ? (req.body || {}) : {}, kind = CO_KIND[req.query.kind] ? req.query.kind : (CO_KIND[q0.kind] ? q0.kind : ''), K = CO_KIND[kind];
    if (!K) return res.status(404).send('No encontrado');
    const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date()), url = 'https://app.fisioterapia365.com/' + K.ruta;
    if (req.method !== 'POST') {
      const MS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'], d = new Date(hoy + 'T12:00:00Z');
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(200).send(paginaConsOtro({ kind, url, titulo: K.titulo, sub: K.sub, hoyTxt: `${d.getUTCDate()} de ${MS[d.getUTCMonth()]} de ${d.getUTCFullYear()}`, salud: CO_SALUD_SP, spTxt: LEGAL.sp, spOk: CF_SP_OK, sit: CO_ALTA_SIT, trat: LEGAL.altaTrat, okAl: CO_ALTA_OK }));
    }
    const q = q0, t = (k, n) => String(q[k] || '').trim().replace(/\s+/g, ' ').slice(0, n || 120), SN = ['Sí', 'No'], malo = m => res.status(200).json({ ok: false, error: m });
    // Pasos 2 y 3 del envío: informes adjuntos y cierre (email con la copia)
    if (q.archivo || q.fin) {
      const id = String(q.id || ''); if (!/^rec[A-Za-z0-9]{14}$/.test(id) || String(q.s || '') !== firmaCDoc(id)) return malo('Enlace no válido');
      const r = await at(`${CONS_O}/${id}`); const F = (r && r.fields) || {}; if (r.error || String(F['FECHA'] || '').slice(0, 10) !== hoy) return malo('No encontrado');
      if (q.archivo) {
        const data = String(q.data || ''), type = /^(image\/(jpeg|png|webp|heic)|application\/pdf)$/.test(q.type) ? q.type : 'application/octet-stream';
        if (!/^[A-Za-z0-9+/=]+$/.test(data) || data.length > 4.4e6) return malo('Archivo no válido');
        const up = await fetch(`https://content.airtable.com/v0/${BASE_ID}/${id}/${encodeURIComponent('INFORME')}/uploadAttachment`, { method: 'POST', headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ contentType: type, file: data, filename: String(q.name || 'informe').replace(/[^\w.\-áéíóúñÁÉÍÓÚÑ ]/g, '_').slice(0, 80) }) }).catch(() => null);
        return res.status(200).json({ ok: !!(up && up.ok) });
      }
      global._coFin = global._coFin || {}; if (!global._coFin[id]) { global._coFin[id] = 1; await mailCDoc(id, String(F['EMAIL'] || '').trim().toLowerCase(), F['NOMBRE'] || '', K.que); }
      _cons.t = 0; _alertas.t = 0;
      return res.status(200).json({ ok: true });
    }
    if (!t('nombre') || !t('apellidos')) return malo('Falta el nombre o los apellidos');
    if (t('nif').length < 5) return malo('Falta el NIF o NIE');
    const tel = t('tel').replace(/\D/g, ''); if (tel.length < 9) return malo('Revisa el teléfono');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(t('email'))) return malo('Revisa el email');
    const oks = kind === 'alta' ? CO_ALTA_OK : CF_SP_OK; if (!oks.every((x, i) => q['ok' + i])) return malo('Falta marcar las casillas del consentimiento');
    if (kind === 'sp') for (const x of CO_SALUD_SP) if (!(x[2] || SN).includes(q[x[0]])) return malo('Falta alguna respuesta del cuestionario de salud');
    const firma = String(q.firma || ''); if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(firma) || firma.length < 1500 || firma.length > 900000) return malo('Falta la firma');
    const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim(), nav = String(req.headers['user-agent'] || '').slice(0, 200);
    const ahora = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', dateStyle: 'short', timeStyle: 'medium' }).format(new Date());
    const f = { TIPO: K.tipo, NOMBRE: t('nombre'), APELLIDOS: t('apellidos'), DNI: t('nif').toUpperCase(), TELF: tel, EMAIL: t('email').toLowerCase(), FECHA: hoy, 'FORM ID': 'FISIO365',
      'REGISTRO FIRMA': `Firmado en el formulario de FISIO365 el ${ahora} (hora de Madrid)\nIP: ${ip || '—'}\nNavegador: ${nav || '—'}` };
    if (kind === 'sp') { CO_SALUD_SP.forEach(x => { f[x[0]] = q[x[0]]; }); if (t('notas', 2000)) f['NOTAS SALUD'] = String(q.notas || '').trim().slice(0, 2000); f['ACEPTACIÓN S.P.'] = true; }
    else { f['CÁNCER'] = 'Alta'; if (/^\d{4}-\d{2}-\d{2}$/.test(t('falta'))) f['FECHA ALTA'] = t('falta'); }
    const c = await at(CONS_O, { method: 'POST', body: JSON.stringify({ records: [{ fields: f }], typecast: true }) });
    if (c.error || !c.records) { console.log('cons-otro', JSON.stringify(c.error || c).slice(0, 300)); return malo('No se ha podido guardar. Inténtalo de nuevo en un momento.'); }
    const id = c.records[0].id;
    try { await fetch(`https://content.airtable.com/v0/${BASE_ID}/${id}/${encodeURIComponent('FIRMA')}/uploadAttachment`, { method: 'POST', headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ contentType: 'image/png', file: firma.split(',')[1], filename: 'firma.png' }) }); } catch (e) { console.log('firma otro', e.message); }
    _cons.t = 0;
    return res.status(200).json({ ok: true, id, s: firmaCDoc(id) });
  }
  // Reenvío de la copia (solo formularios de hoy, una vez por instancia)
  if (action === 'cdoc-mail') {
    const id = String(req.query.id || ''); global._cdocMail = global._cdocMail || {};
    if (!/^rec[A-Za-z0-9]{14}$/.test(id) || global._cdocMail[id]) return res.status(400).json({ ok: false });
    const r = await at(`${CONS_T}/${id}`); const F = (r && r.fields) || {};
    const hoyM = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date());
    if (String(F['Creada'] || '').slice(0, 10) !== hoyM || !F['EMAIL']) return res.status(400).json({ ok: false });
    global._cdocMail[id] = 1;
    return res.status(200).json(await mailCDoc(id, String(F['EMAIL']).trim().toLowerCase(), F['\ufeffNOMBRE'] || F['NOMBRE'] || ''));
  }
  if (action === 'cdoc') {
    const id = String(req.query.id || ''), sg = String(req.query.s || '');
    res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('X-Robots-Tag', 'noindex');
    if (!/^rec[A-Za-z0-9]{14}$/.test(id) || sg !== firmaCDoc(id)) return res.status(404).send(paginaEncuesta({ error: 'Este enlace no es válido.' }));
    let r = await at(`${CONS_T}/${id}`), otro = false; if (r.error) { r = await at(`${CONS_O}/${id}`); otro = true; } if (r.error) return res.status(404).send(paginaEncuesta({ error: 'No encontramos el documento.' }));
    let firmaSrc = ''; const a = ((r.fields || {})['FIRMA'] || [])[0];
    if (a && a.url) { try { const im = await fetch(a.url); if (im.ok) firmaSrc = `data:${im.headers.get('content-type') || 'image/png'};base64,` + Buffer.from(await im.arrayBuffer()).toString('base64'); } catch (e) {} }
    return res.status(200).send(otro ? paginaCDocOtro(r.fields || {}, firmaSrc) : paginaCDoc(r.fields || {}, firmaSrc));
  }
  if (action === 'consentimiento') {
    res.setHeader('Cache-Control', 'private, no-store');
    const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date());
    if (req.method !== 'POST') {
      const MS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'], d = new Date(hoy + 'T12:00:00Z');
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(200).send(paginaConsent({ url: 'https://app.fisioterapia365.com/consentimiento', hoyTxt: `${d.getUTCDate()} de ${MS[d.getUTCMonth()]} de ${d.getUTCFullYear()}`, salud: CF_SALUD, spTxt: LEGAL.sp, spOk: CF_SP_OK, trat: LEGAL.trat, cancel: CF_CANCEL, decl: LEGAL.decl, rgpd: LEGAL.rgpd, aut: CF_AUT, der: LEGAL.der, conocido: CF_CONOCIDO }));
    }
    const q = req.body || {}, t = (k, n) => String(q[k] || '').trim().replace(/\s+/g, ' ').slice(0, n || 120), SN = ['Sí', 'No'];
    const malo = m => res.status(200).json({ ok: false, error: m });
    if (!t('nombre') || !t('apellidos')) return malo('Falta el nombre o los apellidos');
    if (t('nif').length < 5) return malo('Falta el NIF');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(t('nacimiento'))) return malo('Revisa la fecha de nacimiento');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(t('email'))) return malo('Revisa el email');
    const tel = t('tel').replace(/\D/g, ''); if (tel.length < 9) return malo('Revisa el teléfono');
    if (!CF_CONOCIDO.includes(q.conocido)) return malo('Falta cómo nos has conocido');
    if (q.conocido === 'Recomendación' && !t('recomendo')) return malo('Falta quién te recomendó');
    for (const x of CF_SALUD) if (!(x[2] || SN).includes(q[x[0]])) return malo('Falta alguna respuesta del cuestionario de salud');
    if (!SN.includes(q.sp)) return malo('Falta la pregunta de suelo pélvico');
    if (q.sp === 'Sí' && !(q.spok0 && q.spok1)) return malo('Falta aceptar el consentimiento de suelo pélvico');
    for (const x of CF_AUT) if (!SN.includes(q[x[0]])) return malo('Falta alguna autorización');
    const firma = String(q.firma || ''); if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(firma) || firma.length < 1500 || firma.length > 900000) return malo('Falta la firma');
    const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim(), nav = String(req.headers['user-agent'] || '').slice(0, 200);
    const ahora = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', dateStyle: 'short', timeStyle: 'medium' }).format(new Date());
    const telRes = q.reserva_otro ? t('telres').replace(/\D/g, '').slice(-9) : '';
    const f = { 'fld2SaWhieEg0Zosd': t('nombre'), 'APELLIDOS': t('apellidos'), 'Creada': hoy, 'EMAIL': t('email').toLowerCase(), 'TELF': tel, 'NACIMIENTO': t('nacimiento'), 'DNI': t('nif').toUpperCase(),
      'CONOCIDO': q.conocido, 'IMAGENES': q.IMAGENES, 'CITAS': q.CITAS, 'NEWSLETTER': q.NEWSLETTER, 'SUELO PÉLVICO': q.sp, 'ACEPTACIÓN S.P.': q.sp === 'Sí',
      'TUTOR': t('tutor'), 'NIF TUTOR': t('niftutor').toUpperCase(), 'RECOMENDÓ': q.conocido === 'Recomendación' ? t('recomendo') : '', 'TELF RESERVA': telRes,
      'REGISTRO FIRMA': `Firmado en el formulario de FISIO365 el ${ahora} (hora de Madrid)\nIP: ${ip || '—'}\nNavegador: ${nav || '—'}` };
    CF_SALUD.forEach(x => { f[x[0]] = q[x[0]]; }); f['ARRITMIAS'] = q['HIPERTENSIÓN'];
    Object.keys(f).forEach(k => { if (f[k] === '') delete f[k]; });
    const c = await at(CONS_T, { method: 'POST', body: JSON.stringify({ records: [{ fields: f }], typecast: true }) });
    if (c.error || !c.records) { console.log('consentimiento', JSON.stringify(c.error || c).slice(0, 300)); return malo('No se ha podido guardar. Inténtalo de nuevo en un momento.'); }
    const id = c.records[0].id;
    // Firma (imagen) en su campo
    try { await fetch(`https://content.airtable.com/v0/${BASE_ID}/${id}/fldkDFTcA605QjT7N/uploadAttachment`, { method: 'POST', headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ contentType: 'image/png', file: firma.split(',')[1], filename: 'firma.png' }) }); } catch (e) { console.log('firma', e.message); }
    // Recomendación → REFERIDOS (como hacía la integración de Tally) para la tarjeta regalo
    if (q.conocido === 'Recomendación') await at('tblr27u3cvtzfyqI6', { method: 'POST', body: JSON.stringify({ records: [{ fields: { 'Nombre': t('nombre'), 'Apellidos': t('apellidos'), 'Fecha': hoy, 'Nombre de quien recomendó': t('recomendo') } }], typecast: true }) }).catch(() => {});
    // Copia para el paciente (como el email de Tally, ahora con enlace a su documento)
    await mailCDoc(id, t('email').toLowerCase(), t('nombre'));
    _cons.t = 0; _alertas.t = 0;
    return res.status(200).json({ ok: true });
  }
  // Enlace de huecos libres: página para elegir y reservar (GET) y la reserva (POST)
  if (action === 'huecos-og') {
    const k = String(req.query.k || ''), sg = String(req.query.s || ''), P = huecosDec(k);
    if (!P || sg !== firmaHuecos(k)) return res.status(404).send('No encontrado');
    try { const { Resvg } = require('@resvg/resvg-js'); const png = new Resvg(MARCA.marcar(ogHuecosSvg(P), CLI), { font: { loadSystemFonts: false } }).render().asPng(); res.setHeader('Content-Type', 'image/png'); res.setHeader('Cache-Control', 'public, max-age=86400'); return res.status(200).send(png); }
    catch (e) { res.setHeader('Location', 'https://app.fisioterapia365.com/informe/og-cita-v3.png'); return res.status(302).end(); }
  }
  if (action === 'huecos') {
    const k = String(req.query.k || ''), sg = String(req.query.s || ''), P = huecosDec(k);
    res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('X-Robots-Tag', 'noindex');
    if (!P || sg !== firmaHuecos(k)) { if (req.method === 'POST') return res.status(400).json({ ok: false, error: 'Enlace no válido' }); res.setHeader('Content-Type', 'text/html; charset=utf-8'); return res.status(404).send(paginaEncuesta({ error: 'Este enlace no es válido.' })); }
    const C = (await conf().catch(() => CONF_DEF)).clinica || CONF_DEF.clinica;
    if (req.method === 'POST') {
      const q = req.body || {}, id = String(q.id || ''), cap = t => String(t || '').trim().replace(/\s+/g, ' ').toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
      const n1 = cap(q.nombre).slice(0, 60), n2 = cap(q.apellidos).slice(0, 80), tel = String(q.tel || '').replace(/\D/g, '').replace(/^0034|^34(?=\d{9}$)/, ''), motivo = String(q.motivo || '').trim().slice(0, 1500);
      if (!/^rec[A-Za-z0-9]{14}$/.test(id) || !n1 || !n2 || tel.length < 9 || !motivo) return res.status(400).json({ ok: false, error: 'Revisa los datos, por favor.' });
      const ocupado = { ok: false, ocupado: true, error: 'Vaya, alguien acaba de coger esa hora. Elige otra, por favor.' };
      const r = await at(`tblTPlcuiSjQngkaD/${id}`); if (r.error) return res.status(200).json(ocupado);
      const h = huecoValido(r.fields || {}, P); if (!h) return res.status(200).json(ocupado);
      // Paciente: por teléfono; si no existe, se crea con nombre, teléfono y motivo
      const t9 = tel.slice(-9);
      const ps = await at(`${PACIENTES}?filterByFormula=${encodeURIComponent(`OR(RIGHT(REGEX_REPLACE({TELF}&'','[^0-9]',''),9)='${t9}',RIGHT(REGEX_REPLACE({WHATSAPP}&'','[^0-9]',''),9)='${t9}')`)}&maxRecords=1&fields[]=${encodeURIComponent('FULL NAME')}&fields[]=${encodeURIComponent('MOTIVO DE VISITA')}`).catch(() => ({}));
      let pac = (ps.records || [])[0] || null, nuevo = false;
      if (!pac) {
        const c = await at(PACIENTES, { method: 'POST', body: JSON.stringify({ records: [{ fields: { 'FULL NAME': `${n1} ${n2}`.toUpperCase(), TELF: tel, WHATSAPP: tel, PIN: nuevoPin(), 'MOTIVO DE VISITA': motivo } }], typecast: true }) });
        if (c.error || !c.records) return res.status(200).json({ ok: false, error: 'No se ha podido reservar. Llámanos y te la apuntamos.' });
        pac = c.records[0]; nuevo = true;
      } else if (!String((pac.fields || {})['MOTIVO DE VISITA'] || '').trim()) await at(`${PACIENTES}/${pac.id}`, { method: 'PATCH', body: JSON.stringify({ fields: { 'MOTIVO DE VISITA': motivo } }) }).catch(() => {});
      const nota = `Reserva por enlace de huecos${nuevo ? ' (paciente nuevo)' : ''} · Motivo: ${motivo}`;
      const fR = { ESTADO: 'PENDIENTE ', 'RELACIÓN - CITA': [pac.id], RESERVA: 'RESERVADA POR LA WEB', NOTAS: [r.fields.NOTAS, nota].filter(Boolean).join('\n') };
      if (P.p > 0) { const lim = Date.now() + 2 * 3600e3; Object.assign(fR, { 'PAGO ESTADO': 'PENDIENTE DE PAGO', 'PAGO IMPORTE': P.p, 'PAGO LÍMITE': new Date(lim).toISOString(), 'PAGO REGISTRO': `${pagoAhora()} · Reserva por enlace de huecos con pago por adelantado (${P.p.toFixed(2).replace('.', ',')} €)` }); }
      const u = await at(`tblTPlcuiSjQngkaD/${id}`, { method: 'PATCH', body: JSON.stringify({ fields: fR, typecast: true }) });
      if (u.error) return res.status(200).json({ ok: false, error: 'No se ha podido reservar. Inténtalo de nuevo.' });
      await new Promise(z => setTimeout(z, 700));
      const v = await at(`tblTPlcuiSjQngkaD/${id}`).catch(() => u);
      if (!((v.fields || {})['RELACIÓN - CITA'] || []).includes(pac.id)) return res.status(200).json(ocupado);
      // Aviso al móvil: dirección y el fisio de esa hora
      try {
        const fl = await at('tbl2mLUrnaKCFTs6g?fields[]=Name'), nom1 = x => String(x.fields.Name || '').trim().split(' ')[0].toLowerCase();
        const ids = (fl.records || []).filter(x => ['ramiro', 'nora', h.fisio.split(' ')[0].toLowerCase()].includes(nom1(x))).map(x => x.id), { avisar } = require('./_push');
        const d = new Date(h.fecha + 'T12:00:00Z'), DS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'], fis = h.fisio.charAt(0) + h.fisio.slice(1).toLowerCase();
        await Promise.all(ids.map(fid => avisar('fisio', fid, { title: `📅 Nueva reserva: ${n1} ${n2}${nuevo ? ' (nuevo)' : ''}${P.p > 0 ? ' · pendiente de pago' : ''}`, body: `${DS[d.getUTCDay()]} ${d.getUTCDate()}/${d.getUTCMonth() + 1} a las ${h.hora} con ${fis.split(' ')[0]}. ${motivo.slice(0, 90)}`, url: '/fisio', tag: 'res-' + id }).catch(() => false)));
      } catch (e) {}
      if (!(P.p > 0)) await avisoFaltaEnlace(id);
      return res.status(200).json({ ok: true, pago: P.p > 0 ? enlacePago(id) : '' });
    }
    await caducarPagos().catch(() => 0); // libera antes los huecos de quien no pagó
    const huecos = await huecosLibres(P).catch(() => []);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(paginaHuecos({ huecos, pago: P.p || 0, url: `https://app.fisioterapia365.com/h/${k}.${sg}`, tel: C.tel || '672 89 39 49', dir: C.direccion || 'C/ Gran de Sant Andreu, 163 · Barcelona' }));
  }
  // Encuesta de primera visita: página (GET) y respuestas (POST)
  // Pago por adelantado: página del paciente (GET), tarjeta/transferencia (POST) y vuelta de Stripe (?sid=)
  if (action === 'res' || action === 'res-og') {
    const id = String(req.query.id || '');
    if (!/^rec[A-Za-z0-9]{14}$/.test(id) || req.query.s !== firmaRes(id)) { res.setHeader('Location', RESENA_URL); return res.status(302).end(); }
    let pila = '', P = {}; try { const pr = await at(`${PACIENTES}/${id}`); P = pr.fields || {}; const p0 = (String(P['NOMBRE'] || '').trim() || String(P['FULL NAME'] || '').trim()).split(/\s+/)[0] || ''; pila = p0 ? p0.charAt(0).toUpperCase() + p0.slice(1).toLowerCase() : ''; } catch (e) {}
    // Queda apuntado si lo abre y si pulsa para ir a Google (para Valoraciones)
    if (req.method === 'POST') { if (P['MEJORA FECHA'] && !P['MEJORA GOOGLE']) await at(`${PACIENTES}/${id}`, { method: 'PATCH', body: JSON.stringify({ fields: { 'MEJORA GOOGLE': new Date().toISOString() } }) }).catch(() => {}); return res.status(200).json({ ok: true }); }
    if (action === 'res' && P['MEJORA FECHA'] && !P['MEJORA ABIERTA'] && !/bot|facebookexternalhit|WhatsApp|preview|crawler|spider/i.test(String(req.headers['user-agent'] || ''))) await at(`${PACIENTES}/${id}`, { method: 'PATCH', body: JSON.stringify({ fields: { 'MEJORA ABIERTA': new Date().toISOString() } }) }).catch(() => {});
    if (action === 'res-og') { const { Resvg } = require('@resvg/resvg-js'); const png = new Resvg(MARCA.marcar(ogResSvg({ pila }), CLI), { font: { loadSystemFonts: false } }).render().asPng(); res.setHeader('Content-Type', 'image/png'); res.setHeader('Cache-Control', 'public, max-age=86400'); return res.status(200).send(png); }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(paginaResena({ pila, url: enlaceRes(id), ideas: ideasResena({ tema: String(P['MOTIVO DE VISITA'] || ''), fin: true }) }));
  }
  if (action === 'fac' || action === 'fac-og') {
    const t = req.query.t === 'i' ? 'invoice' : 'salesreceipt', id = String(req.query.id || '');
    if (!/^[a-f0-9]{24}$/i.test(id) || req.query.s !== firmaFac(t, id)) return res.status(404).send('Enlace no válido');
    try {
      const doc = await holded('/' + docTipo(t) + '/' + id);
      let pila = ''; try { const nm = String(doc.contactName || doc.contact_name || '').trim().split(/\s+/)[0] || ''; pila = nm ? nm.charAt(0).toUpperCase() + nm.slice(1).toLowerCase() : ''; } catch (_) {}
      if (action === 'fac-og') { const { Resvg } = require('@resvg/resvg-js'); const png = new Resvg(MARCA.marcar(ogFacSvg({ pila }), CLI), { font: { loadSystemFonts: false } }).render().asPng(); res.setHeader('Content-Type', 'image/png'); res.setHeader('Cache-Control', 'public, max-age=86400'); return res.status(200).send(png); }
      const D = facDatos(doc);
      if (req.query.pdf) {
        const pdf = await holdedPdf('/' + docTipo(t) + '/' + id + '/pdf'); if (!pdf) return res.status(502).send('PDF no disponible');
        res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', `inline; filename="Factura_${String(D.numero || id).replace(/[^\w-]/g, '_')}.pdf"`); res.setHeader('Cache-Control', 'private, no-store');
        return res.status(200).send(Buffer.from(pdf, 'base64'));
      }
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(200).send(paginaFactura({ ...D, pila, url: enlaceFac(t, id) }));
    } catch (e) { console.error('fac', e.message); return res.status(502).send('No se ha podido cargar la factura. Inténtalo en un rato.'); }
  }
  if (action === 'pago-falta') { // lo llama la app al reservar (no hace falta clave: solo avisa si de verdad toca, y una vez)
    const id = String(req.query.id || ''); if (!/^rec[A-Za-z0-9]{14}$/.test(id)) return res.status(400).json({ ok: false });
    return res.status(200).json({ ok: true, aviso: await avisoFaltaEnlace(id) });
  }
  if (action === 'pago' || action === 'pago-og') {
    const id = String(req.query.id || ''), sg = String(req.query.s || '');
    res.setHeader('X-Robots-Tag', 'noindex');
    const mal = m => { if (req.method === 'POST') return res.status(400).json({ ok: false, error: m }); res.setHeader('Content-Type', 'text/html; charset=utf-8'); return res.status(404).send(paginaEncuesta({ error: m })); };
    if (!/^rec[A-Za-z0-9]{14}$/.test(id) || sg !== firmaPago(id)) return mal('Este enlace no es válido.');
    let r = await at(`tblTPlcuiSjQngkaD/${id}`); if (r.error) return mal('No encontramos tu cita.');
    let F = r.fields || {}; const pac = await pagoPaciente(F);
    const f0 = String((F['PREF.'] && F['PREF.'].name) || F['PREF.'] || '').trim().split(' ')[0], fisio = f0 ? f0.charAt(0).toUpperCase() + f0.slice(1).toLowerCase() : '';
    const importe = Number(F['PAGO IMPORTE'] || 0), fecha = String(F['FECHA'] || '').slice(0, 10), hora = String(F['HORA'] || '').replace(/^(\d):/, '0$1:').slice(0, 5);
    if (action === 'pago-og') {
      try { const { Resvg } = require('@resvg/resvg-js'); const png = new Resvg(MARCA.marcar(ogPagoSvg({ pila: pac.pila, importe }), CLI), { font: { loadSystemFonts: false } }).render().asPng(); res.setHeader('Content-Type', 'image/png'); res.setHeader('Cache-Control', 'public, max-age=86400'); return res.status(200).send(png); }
      catch (e) { res.setHeader('Location', 'https://app.fisioterapia365.com/informe/og-cita-v3.png'); return res.status(302).end(); }
    }
    res.setHeader('Cache-Control', 'private, no-store');
    const estadoDe = X => String((X['PAGO ESTADO'] && X['PAGO ESTADO'].name) || X['PAGO ESTADO'] || '');
    let estado = estadoDe(F);
    const caducado = estado === 'PENDIENTE DE PAGO' && F['PAGO LÍMITE'] && new Date(F['PAGO LÍMITE']) < new Date();
    if (req.method === 'POST') {
      const q = req.body || {};
      if (estado !== 'PENDIENTE DE PAGO' || caducado) return res.status(200).json({ ok: false, error: 'Esta reserva ya no está pendiente de pago.' });
      if (!q.acepta) return res.status(200).json({ ok: false, error: 'Falta aceptar las condiciones' });
      const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim(), acept = `${pagoAhora()} · Acepta la política de cancelación (IP ${ip || '—'})`;
      if (q.op === 'tarjeta') {
        if (!(importe >= 1)) return res.status(200).json({ ok: false, error: 'Falta el importe' });
        const lim = F['PAGO LÍMITE'] ? Math.floor(new Date(F['PAGO LÍMITE']).getTime() / 1000) : 0, exp = Math.max(Math.floor(Date.now() / 1000) + 31 * 60, Math.min(lim || 0, Math.floor(Date.now() / 1000) + 23.5 * 3600));
        const url = enlacePago(id), form = { mode: 'payment', locale: 'es', 'line_items[0][quantity]': '1', 'line_items[0][price_data][currency]': 'eur', 'line_items[0][price_data][unit_amount]': String(Math.round(importe * 100)), 'line_items[0][price_data][product_data][name]': `Sesión de fisioterapia · ${fecha.split('-').reverse().join('/')} ${hora}`, 'metadata[cita]': id, 'payment_intent_data[metadata][cita]': id, 'payment_intent_data[description]': `FISIO365 · ${pac.nombre || 'Paciente'} · ${fecha} ${hora}`, success_url: url + '?sid={CHECKOUT_SESSION_ID}', cancel_url: url, expires_at: String(exp) };
        if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(pac.email)) form.customer_email = pac.email;
        let ses; try { ses = await stripeApi('checkout/sessions', form); } catch (e) { return res.status(200).json({ ok: false, error: 'No se ha podido abrir el pago con tarjeta. Prueba con transferencia o escríbenos.' }); }
        await at(`tblTPlcuiSjQngkaD/${id}`, { method: 'PATCH', body: JSON.stringify({ fields: { 'PAGO REF': ses.id, 'PAGO REGISTRO': (String(F['PAGO REGISTRO'] || '') + '\n' + acept + ' · abre el pago con tarjeta').trim() } }) });
        return res.status(200).json({ ok: true, url: ses.url });
      }
      if (q.op === 'transferencia') {
        const u = await at(`tblTPlcuiSjQngkaD/${id}`, { method: 'PATCH', body: JSON.stringify({ fields: { 'PAGO ESTADO': 'TRANSFERENCIA AVISADA', 'PAGO REGISTRO': (String(F['PAGO REGISTRO'] || '') + '\n' + acept + ' · dice que ha hecho la transferencia').trim() }, typecast: true }) });
        if (!u.error) await pagoAvisar('', `🏦 ${pac.pila || 'Un paciente'} dice que ha hecho la transferencia`, `${importe.toFixed(2).replace('.', ',')} € · cita del ${fecha.split('-').reverse().join('/')} a las ${hora}. Revisa el banco y confírmala en la agenda.`, 'pago-' + id);
        return res.status(200).json({ ok: !u.error });
      }
      return res.status(400).json({ ok: false });
    }
    // Vuelta de Stripe o pago a medias: se comprueba en Stripe
    if (estado === 'PENDIENTE DE PAGO' && (req.query.sid || F['PAGO REF'])) {
      if (await pagoVerificar(id, F, String(req.query.sid || '')).catch(() => false)) { estado = 'PAGADO'; }
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(paginaPago({ url: enlacePago(id), pila: pac.pila, fisio, fecha, hora, importe, limite: F['PAGO LÍMITE'] || '', estado, caducado: caducado && estado !== 'PAGADO', iban: PAGO_IBAN, titular: PAGO_TITULAR, concepto: `Cita ${fecha.split('-').reverse().slice(0, 2).join('/')} ${String(pac.nombre || '').toLowerCase().replace(/(^|\s)\S/g, x => x.toUpperCase()).split(' ').slice(0, 2).join(' ')}`.trim().slice(0, 60) }));
  }
  // Encuesta de alta (antes «paciente feliz» en Tally): enlace personal por paciente, misma lógica que la de primera visita
  if (action === 'fin-og' || action === 'fin') {
    const id = String(req.query.id || ''), sg = String(req.query.s || '');
    res.setHeader('X-Robots-Tag', 'noindex');
    const mal = m => { if (req.method === 'POST') return res.status(400).json({ ok: false }); res.setHeader('Content-Type', 'text/html; charset=utf-8'); return res.status(404).send(paginaEncuesta({ error: m })); };
    if (!/^rec[A-Za-z0-9]{14}$/.test(id) || sg !== firmaFin(id)) return mal('Este enlace no es válido.');
    const p = await at(`${PACIENTES}/${id}`); if (p.error) return mal('No encontramos tu ficha.');
    const P = p.fields || {}, nombre = String(P['FULL NAME'] || '').trim();
    let pila = (String(P['NOMBRE'] || '').trim() || nombre).split(/\s+/)[0] || ''; pila = pila ? pila.charAt(0).toUpperCase() + pila.slice(1).toLowerCase() : '';
    const f0 = String(P['FIN FISIO'] || '').trim().split(' ')[0], fisio = f0 ? f0.charAt(0).toUpperCase() + f0.slice(1).toLowerCase() : '';
    if (action === 'fin-og') {
      try { const { Resvg } = require('@resvg/resvg-js'); const png = new Resvg(MARCA.marcar(ogEncSvg({ pila, fisio, fin: true }), CLI), { font: { loadSystemFonts: false } }).render().asPng(); res.setHeader('Content-Type', 'image/png'); res.setHeader('Cache-Control', 'public, max-age=86400'); return res.status(200).send(png); }
      catch (e) { res.setHeader('Location', 'https://app.fisioterapia365.com/informe/og-cita-v3.png'); return res.status(302).end(); }
    }
    res.setHeader('Cache-Control', 'private, no-store');
    const vOld = (P['FIN VALORACIÓN'] && P['FIN VALORACIÓN'].name) || P['FIN VALORACIÓN'] || '';
    if (req.method === 'POST') {
      const q = req.body || {}, VAL = ['Excelente', 'Muy buena', 'Normal', 'Mejorable'], f = {};
      if (q.resena) f['FIN IR A RESEÑA'] = new Date().toISOString();
      const v = VAL.includes(q.v) ? q.v : '', c = String(q.c || '').trim().slice(0, 3000);
      if (v) { f['FIN VALORACIÓN'] = v; f['FIN RESPONDIDA'] = new Date().toISOString(); }
      if (c) f['FIN COMENTARIO'] = c;
      if (!Object.keys(f).length) return res.status(400).json({ ok: false });
      const yaRes = !!P['FIN IR A RESEÑA'], vAct = v || vOld;
      const u = await at(`${PACIENTES}/${id}`, { method: 'PATCH', body: JSON.stringify({ fields: f, typecast: true }) });
      if (!u.error) {
        const quien = pila || 'Tu paciente', fl = await at('tbl2mLUrnaKCFTs6g?fields[]=Name').catch(() => ({}));
        const nom1 = x => String(x.fields.Name || '').trim().split(' ')[0].toLowerCase(), recs = fl.records || [];
        const dir = recs.filter(x => ['ramiro', 'nora'].includes(nom1(x))).map(x => x.id), fis = recs.filter(x => fisio && nom1(x) === fisio.toLowerCase()).map(x => x.id);
        const url = '/fisio?s=enc', { avisar } = require('./_push');
        const manda = (ids, title, body) => Promise.all([...new Set(ids)].map(fid => avisar('fisio', fid, { title, body, url, tag: 'fin-' + id }).catch(() => false)));
        const conF = fisio ? ` con ${fisio}` : '';
        if (q.resena && !yaRes && !v) await manda([...dir, ...fis], `⭐ ${quien} va a dejar reseña en Google`, `Alta${conF}: ${vAct || 'Excelente'}.`);
        else if (v && c) await manda(dir, `${/Normal|Mejorable/.test(v) ? '⚠️ ' : ''}${quien}: ${v}`, `«${c.slice(0, 140)}»`);
        else if (v && v !== vOld) {
          await manda(dir, `${/Normal|Mejorable/.test(v) ? '⚠️ ' : ''}Encuesta de alta · ${quien}: ${v}`, `Tratamiento${conF}.${v === 'Excelente' ? ' Le hemos llevado a la reseña de Google.' : ' Le hemos preguntado qué mejorar.'}`);
          if (/Excelente|Muy buena/.test(v)) await manda(fis.filter(x => !dir.includes(x)), `${quien} ha valorado su tratamiento: ${v}`, v === 'Excelente' ? '¡Enhorabuena! Le hemos invitado a dejar la reseña en Google.' : '¡Bien! Le hemos preguntado qué podríamos mejorar.');
        }
      }
      return res.status(200).json({ ok: !u.error });
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(paginaEncuesta({ modo: 'fin', pila, fisio, tema: String(P['MOTIVO DE VISITA'] || '') + ' ' + String(P['POR QUÉ NO REAGENDA'] || ''), v: vOld, yaCom: !!P['FIN COMENTARIO'], url: enlaceFin(id) }));
  }
  if (action === 'encuesta-og') {
    const id = String(req.query.id || ''), sg = String(req.query.s || '');
    if (!/^rec[A-Za-z0-9]{14}$/.test(id) || sg !== firmaEnc(id)) return res.status(404).send('No encontrado');
    try {
      const r = await at(`tblTPlcuiSjQngkaD/${id}`); const F = r.fields || {}, pid = (F['RELACIÓN - CITA'] || [])[0];
      const f0 = String((F['PREF.'] && F['PREF.'].name) || F['PREF.'] || '').trim().split(' ')[0], fisio = f0 ? f0.charAt(0).toUpperCase() + f0.slice(1).toLowerCase() : '';
      let pila = ''; if (pid) { const p = await at(`${PACIENTES}/${pid}`).catch(() => ({})); const P = p.fields || {}; pila = (String(P['NOMBRE'] || '').trim() || String(P['FULL NAME'] || '').trim()).split(/\s+/)[0] || ''; }
      pila = pila ? pila.charAt(0).toUpperCase() + pila.slice(1).toLowerCase() : '';
      const { Resvg } = require('@resvg/resvg-js');
      const png = new Resvg(MARCA.marcar(ogEncSvg({ pila, fisio }), CLI), { font: { loadSystemFonts: false } }).render().asPng();
      res.setHeader('Content-Type', 'image/png'); res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.status(200).send(png);
    } catch (e) { res.setHeader('Location', 'https://app.fisioterapia365.com/informe/og-cita-v3.png'); return res.status(302).end(); }
  }
  if (action === 'encuesta') {
    const id = String(req.query.id || ''), sg = String(req.query.s || '');
    res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('X-Robots-Tag', 'noindex');
    const mal = m => { if (req.method === 'POST') return res.status(400).json({ ok: false }); res.setHeader('Content-Type', 'text/html; charset=utf-8'); return res.status(404).send(paginaEncuesta({ error: m })); };
    if (!/^rec[A-Za-z0-9]{14}$/.test(id) || sg !== firmaEnc(id)) return mal('Este enlace no es válido.');
    const r = await at(`tblTPlcuiSjQngkaD/${id}`); if (r.error) return mal('No encontramos tu visita.');
    const F = r.fields || {}, pid = (F['RELACIÓN - CITA'] || [])[0];
    const f0 = String((F['PREF.'] && F['PREF.'].name) || F['PREF.'] || '').trim().split(' ')[0], fisio = f0 ? f0.charAt(0).toUpperCase() + f0.slice(1).toLowerCase() : '';
    let pila = '', nombre = '';
    let tema = String((F['TIPO DE SESIÓN'] && F['TIPO DE SESIÓN'].name) || F['TIPO DE SESIÓN'] || '') + ' ' + String(F['NOTAS'] || '');
    if (pid) { const p = await at(`${PACIENTES}/${pid}`).catch(() => ({})); const P = p.fields || {}; nombre = String(P['FULL NAME'] || '').trim(); pila = (String(P['NOMBRE'] || '').trim() || nombre).split(/\s+/)[0] || ''; tema += ' ' + String(P['MOTIVO DE VISITA'] || ''); }
    pila = pila ? pila.charAt(0).toUpperCase() + pila.slice(1).toLowerCase() : '';
    const vOld = (F['ENCUESTA VALORACIÓN'] && F['ENCUESTA VALORACIÓN'].name) || F['ENCUESTA VALORACIÓN'] || '';
    if (req.method === 'POST') {
      const q = req.body || {}, VAL = ['Excelente', 'Muy buena', 'Normal', 'Mejorable'], f = {};
      if (q.resena) f['ENCUESTA IR A RESEÑA'] = new Date().toISOString();
      const v = VAL.includes(q.v) ? q.v : '', c = String(q.c || '').trim().slice(0, 3000);
      if (v) { f['ENCUESTA VALORACIÓN'] = v; f['ENCUESTA RESPONDIDA'] = new Date().toISOString(); }
      if (c) f['ENCUESTA COMENTARIO'] = c;
      if (!Object.keys(f).length) return res.status(400).json({ ok: false });
      const yaRes = !!F['ENCUESTA IR A RESEÑA'], vAct = v || vOld;
      // Aviso al móvil del fisio (solo lo bueno: lo que haya que mejorar lo lleva dirección)
      const u = await at(`tblTPlcuiSjQngkaD/${id}`, { method: 'PATCH', body: JSON.stringify({ fields: f, typecast: true }) });
      // Notificación al móvil (además del aviso dentro del panel, en la agenda): dirección (Ramiro y Nora) lo ve todo; el fisio, solo lo bueno (lo que haya que mejorar lo lleva dirección)
      if (!u.error) {
        const quien = pila || (nombre || '').split(' ')[0] || 'Tu paciente', fl = await at('tbl2mLUrnaKCFTs6g?fields[]=Name').catch(() => ({}));
        const nom1 = x => String(x.fields.Name || '').trim().split(' ')[0].toLowerCase(), recs = fl.records || [];
        const dir = recs.filter(x => ['ramiro', 'nora'].includes(nom1(x))).map(x => x.id), fis = recs.filter(x => fisio && nom1(x) === fisio.toLowerCase()).map(x => x.id);
        const url = `/fisio?s=enc&f=${String(F['FECHA'] || '').slice(0, 10)}`, { avisar } = require('./_push');
        const manda = (ids, title, body) => Promise.all([...new Set(ids)].map(fid => avisar('fisio', fid, { title, body, url, tag: 'enc-' + id }).catch(() => false)));
        const conF = fisio ? ` con ${fisio}` : '';
        if (q.resena && !yaRes && !v) await manda([...dir, ...fis], `⭐ ${quien} va a dejar reseña en Google`, `Primera visita${conF}: ${vAct || 'Excelente'}.`);
        else if (v && c) await manda(dir, `${/Normal|Mejorable/.test(v) ? '⚠️ ' : ''}${quien}: ${v}`, `«${c.slice(0, 140)}»`);
        else if (v && v !== vOld) {
          await manda(dir, `${/Normal|Mejorable/.test(v) ? '⚠️ ' : ''}Encuesta 1ª visita · ${quien}: ${v}`, `Primera visita${conF}.${v === 'Excelente' ? ' Le hemos llevado a la reseña de Google.' : ' Le hemos preguntado qué mejorar.'}`);
          if (/Excelente|Muy buena/.test(v)) await manda(fis.filter(x => !dir.includes(x)), `${quien} ha valorado su primera visita: ${v}`, v === 'Excelente' ? '¡Enhorabuena! Le hemos invitado a dejar la reseña en Google.' : '¡Bien! Le hemos preguntado qué podríamos mejorar.');
        }
      }
      return res.status(200).json({ ok: !u.error });
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(paginaEncuesta({ pila, fisio, tema, v: vOld, yaCom: !!F['ENCUESTA COMENTARIO'], url: enlaceEncuesta(id) }));
  }
  // Vista previa del enlace de confirmar (la ve WhatsApp): una hoja de calendario con el día y la hora de la cita
  // y el archivo de calendario para «Añadir a mi calendario»
  if (action === 'cita-og' || action === 'cita-ics') {
    const id = String(req.query.id || ''), sg = String(req.query.s || '');
    if (!/^rec[A-Za-z0-9]{14}$/.test(id) || sg !== firmaCita(id)) return res.status(404).send('No encontrado');
    const r = await at(`tblTPlcuiSjQngkaD/${id}`); if (r.error) return res.status(404).send('No encontrado');
    const F = r.fields || {}, fecha = String(F['FECHA'] || '').slice(0, 10), hora = String(F['HORA'] || '').replace(/^(\d):/, '0$1:').slice(0, 5);
    const f0 = String((F['PREF.'] && F['PREF.'].name) || F['PREF.'] || '').trim().split(' ')[0], fisio = f0 ? f0.charAt(0).toUpperCase() + f0.slice(1).toLowerCase() : '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return res.status(404).send('No encontrado');
    if (action === 'cita-ics') {
      const C = (await conf().catch(() => CONF_DEF)).clinica || CONF_DEF.clinica;
      res.setHeader('Content-Type', 'text/calendar; charset=utf-8'); res.setHeader('Content-Disposition', 'inline; filename="cita-fisio365.ics"'); res.setHeader('Cache-Control', 'private, no-store');
      return res.status(200).send(calendarioCita({ id, fecha, hora, fisio }, C).ics);
    }
    try {
      const { Resvg } = require('@resvg/resvg-js');
      const png = new Resvg(MARCA.marcar(ogCitaSvg({ fecha, hora, fisio }), CLI), { font: { loadSystemFonts: false } }).render().asPng();
      res.setHeader('Content-Type', 'image/png'); res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.status(200).send(png);
    } catch (e) { res.setHeader('Cache-Control', 'no-store'); res.statusCode = 302; res.setHeader('Location', 'https://app.fisioterapia365.com/informe/og-cita-v3.png'); return res.end(); }
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
  if (action === 'tarjeta-img' || action === 'tarjeta-pagina' || action === 'tarjeta-og') {
    const id = String(req.query.id || ''); if (!/^rec[A-Za-z0-9]{14}$/.test(id)) return res.status(404).end();
    const r = await at(`tblr27u3cvtzfyqI6/${id}`); const a = r.fields && (r.fields['TARJETA IMG'] || [])[0];
    if (!r.fields || !r.fields['CÓDIGO']) return res.status(404).send('Tarjeta no encontrada');
    if (action === 'tarjeta-img' && !a) return res.redirect(302, 'https://app.fisioterapia365.com/icons/icon-512.png');
    if (action === 'tarjeta-img') { const im = await fetch(a.url); res.setHeader('Content-Type', a.type || 'image/jpeg'); res.setHeader('Cache-Control', 'public, max-age=86400'); return res.status(200).send(Buffer.from(await im.arrayBuffer())); }
    const CF = await conf().catch(() => CONF_DEF), impP = Number(CF.tarjeta.importe) || 10, cad = String(r.fields['CADUCA'] || '').split('-').reverse().join('/');
    let pila = String(r.fields['Nombre de quien recomendó'] || '').trim().split(/\s+/)[0] || ''; pila = pila ? pila.charAt(0).toUpperCase() + pila.slice(1).toLowerCase() : '';
    if (action === 'tarjeta-og') {
      try { const { Resvg } = require('@resvg/resvg-js'); const png = new Resvg(MARCA.marcar(ogTarjetaSvg({ imp: impP, pila }), CLI), { font: { loadSystemFonts: false } }).render().asPng(); res.setHeader('Content-Type', 'image/png'); res.setHeader('Cache-Control', 'public, max-age=86400'); return res.status(200).send(png); }
      catch (e) { return res.redirect(302, `https://app.fisioterapia365.com/api/schedule?action=tarjeta-img&id=${id}`); }
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(paginaTarjeta({ imp: impP, pila, cad, og: `https://app.fisioterapia365.com/tarjeta/${id}.png?v=1`, dir: ((CF.clinica || CONF_DEF.clinica).direccion) || 'C/ Gran de Sant Andreu, 163 · Barcelona', tel: (CF.clinica || CONF_DEF.clinica).tel || '672 89 39 49' }));
  }
  // ── RECIBÍ DE INFORMES: enlace /i/TOKEN (WhatsApp o email) y firma desde la app del paciente ──
  // El enlace no lleva el informe: para verlo hay que poner los 4 últimos números del DNI (o la fecha de nacimiento) y firmar el recibí.
  if (/^inf-(pagina|info|ver|firmar|recibi-app)$/.test(action || '')) {
    res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('X-Robots-Tag', 'noindex');
    const q = req.method === 'POST' ? (req.body || {}) : req.query;
    if (action === 'inf-pagina') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      const tk = String(req.query.t || ''); if (!/^[A-Za-z0-9]{20}$/.test(tk)) return res.status(404).send('Enlace no válido');
      return res.status(200).send(paginaRecibi(tk));
    }
    const ahoraIso = new Date().toISOString();
    const quienEs = () => ({ ip: String(req.headers['x-forwarded-for'] || '').split(',')[0].trim(), nav: String(req.headers['user-agent'] || '').slice(0, 200) });
    const firmaOk = f => typeof f === 'string' && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(f) && f.length > 800 && f.length < 95000;
    if ((action === 'inf-firmar' || action === 'inf-recibi-app') && req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Método no permitido' });
    if (action === 'inf-recibi-app') {
      // Desde la app del paciente (ya ha entrado con su usuario)
      const id = String(q.id || ''), pid = String(q.patientId || '');
      if (!/^rec[A-Za-z0-9]{14}$/.test(id) || !/^rec[A-Za-z0-9]{14}$/.test(pid)) return res.status(400).json({ ok: false, error: 'Datos no válidos' });
      if (!firmaOk(q.firma)) return res.status(400).json({ ok: false, error: 'Falta la firma' });
      const r = await at(`${INFORMES_TABLE}/${id}`); const F = r.fields || {};
      if (r.error || String(F['PacienteId'] || '') !== pid) return res.status(404).json({ ok: false, error: 'Informe no encontrado' });
      if (F['RECIBI FECHA']) return res.status(200).json({ ok: true, ya: true });
      const u = await at(`${INFORMES_TABLE}/${id}`, { method: 'PATCH', body: JSON.stringify({ fields: { 'RECIBI FECHA': ahoraIso, 'RECIBI FIRMA': q.firma, 'RECIBI DATOS': JSON.stringify({ canal: 'app', verificado: 'sesión de la app', codigo: infCodigo(id), huella: infHuella(F['Informe']), texto: infTextoRecibi(id), ...quienEs() }) } }) });
      if (u.error) return res.status(500).json({ ok: false, error: 'No se ha podido guardar la firma' });
      return res.status(200).json({ ok: true });
    }
    const tk = String(q.t || ''); if (!/^[A-Za-z0-9]{20}$/.test(tk)) return res.status(404).json({ ok: false, error: 'Enlace no válido' });
    const rr = await at(`${INFORMES_TABLE}?filterByFormula=${encodeURIComponent(`{ENTREGA TOKEN}='${tk}'`)}&maxRecords=1`);
    const rec = (rr.records || [])[0]; if (!rec) return res.status(404).json({ ok: false, error: 'Este enlace no es válido o el informe se ha retirado.' });
    const F = rec.fields || {}; let E = {}; try { E = JSON.parse(F['ENTREGA'] || '{}'); } catch (e) {}
    const caducado = E.enviado && (Date.now() - new Date(E.enviado).getTime()) > 30 * 864e5 && !F['RECIBI FECHA'];
    const bloqueado = (E.intentos || 0) >= 5;
    const pr = await at(`${PACIENTES}/${F['PacienteId']}`).catch(() => ({})); const P = pr.fields || {};
    const dniDig = String(P['DNI'] || '').replace(/\D/g, ''), nac = await pacNacimiento(F['PacienteId']);
    const modo = dniDig.length >= 4 ? 'dni' : /^\d{4}-\d{2}-\d{2}$/.test(nac) ? 'nac' : 'ninguno';
    const pila = (String(P['NOMBRE'] || '').trim() || String(P['FULL NAME'] || '').trim()).split(/\s+/)[0] || '';
    const pilaB = pila ? pila.charAt(0).toUpperCase() + pila.slice(1).toLowerCase() : '';
    const guardaE = async extra => { E = { ...E, ...extra }; await at(`${INFORMES_TABLE}/${rec.id}`, { method: 'PATCH', body: JSON.stringify({ fields: { ENTREGA: JSON.stringify(E) } }) }).catch(() => {}); };
    if (action === 'inf-info') return res.status(200).json({ ok: true, pila: pilaB, modo, caducado, bloqueado, firmado: !!F['RECIBI FECHA'] });
    if (caducado) return res.status(200).json({ ok: false, error: 'Este enlace ha caducado. Pídenos uno nuevo por WhatsApp.' });
    if (bloqueado) return res.status(200).json({ ok: false, bloqueado: true, error: 'Por seguridad, el enlace se ha bloqueado tras varios intentos. Escríbenos y te mandamos uno nuevo.' });
    if (modo === 'ninguno') return res.status(200).json({ ok: false, error: 'No podemos comprobar tu identidad con este enlace. Escríbenos y te lo damos de otra manera.' });
    const dato = String(q.dato || '');
    let ok = false;
    if (modo === 'dni') { const d = dato.replace(/\D/g, ''); ok = d.length === 4 && d === dniDig.slice(-4); }
    else { const m = dato.replace(/\s/g, '').match(/^(\d{1,2})[\/.-]?(\d{1,2})[\/.-]?(\d{4})$/); ok = !!m && `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` === nac; }
    if (!ok) { const n = (E.intentos || 0) + 1; await guardaE({ intentos: n }); return res.status(200).json({ ok: false, mal: true, quedan: Math.max(0, 5 - n), error: n >= 5 ? 'Por seguridad, el enlace se ha bloqueado. Escríbenos y te mandamos uno nuevo.' : (modo === 'dni' ? 'Esos números no coinciden con tu DNI.' : 'Esa fecha no coincide.') + ` Te quedan ${5 - n} intentos.` }); }
    if (action === 'inf-ver') {
      if (!E.abierto || E.intentos) await guardaE({ abierto: E.abierto || ahoraIso, intentos: 0 });
      let col = ''; try { const fr = await at(`${FISIOS_TABLE}?fields[]=Name&fields[]=${encodeURIComponent('NºColegiado')}`); const f = (fr.records || []).find(x => String(x.fields.Name || '').trim().toLowerCase() === String(F['FisioNombre'] || '').trim().toLowerCase()); col = f ? String(f.fields['NºColegiado'] || '') : ''; } catch (e) {}
      return res.status(200).json({ ok: true, pila: pilaB, paciente: String(P['FULL NAME'] || F['PacienteNombre'] || '').trim(), informe: F['Informe'] || '', tipo: F['Protocolo'] || '', fisio: F['FisioNombre'] || '', colegiado: col, fecha: F['Fecha'] || '', firmado: !!F['RECIBI FECHA'], codigo: infCodigo(rec.id), texto: infTextoRecibi(rec.id) });
    }
    // inf-firmar
    if (F['RECIBI FECHA']) return res.status(200).json({ ok: true, ya: true });
    if (!firmaOk(q.firma)) return res.status(400).json({ ok: false, error: 'Falta la firma' });
    const u = await at(`${INFORMES_TABLE}/${rec.id}`, { method: 'PATCH', body: JSON.stringify({ fields: { 'RECIBI FECHA': ahoraIso, 'RECIBI FIRMA': q.firma, 'RECIBI DATOS': JSON.stringify({ canal: E.canal || 'enlace', verificado: modo === 'dni' ? '4 últimos números del DNI' : 'fecha de nacimiento', codigo: infCodigo(rec.id), huella: infHuella(F['Informe']), texto: infTextoRecibi(rec.id), ...quienEs() }) } }) });
    if (u.error) return res.status(500).json({ ok: false, error: 'No se ha podido guardar la firma. Inténtalo de nuevo.' });
    return res.status(200).json({ ok: true });
  }
  if (action === 'config-pub') { // lo que la app del paciente necesita saber (sin datos privados)
    const c = await conf().catch(() => CONF_DEF); res.setHeader('Cache-Control', 'public, max-age=300');
    return res.status(200).json({ ok: true, tarjeta: c.tarjeta, cancelacion: c.cancelacion, tel: c.clinica.tel, app: c.app, legal: legalDe(c.legal), legalEd: Object.keys(c.legal || {}) });
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
    try { const [fisios, ini] = await Promise.all([rendimiento(desde, hasta, !!req.query.fresco, req.query.dinero === '1' ? { dinero: true, desdeCobros: HOLDED_DESDE, cobros: HOLDED_KEY ? (pacT, ya) => cobrosHolded(pacT, ya, HOLDED_DESDE, hasta) : null, precios: Object.fromEntries(((await conf().catch(() => CONF_DEF)).listas.conceptos || []).map(c => [c.n, c.p])) } : null), inicioControl().catch(() => '')]); return res.status(200).json({ ok: true, fisios, conPack: !!ini }); }
    catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
  }

  // ── PANEL: SEGUIMIENTO (lista de pacientes a llamar) y LLAMADAS ──
  if (action && action.startsWith('seg-')) {
    const q = req.method === 'POST' ? (req.body || {}) : req.query;
    if (!process.env.FISIO_PASSWORD || String(q.pwd || '').trim() !== process.env.FISIO_PASSWORD.trim()) return res.status(401).json({ ok: false, error: 'No autorizado' });
    const SEG = 'tblu9YxiktpAh5w87', LLA = 'tbla5rZTwMkMpAiaI', CIT = 'tblTPlcuiSjQngkaD';
    const todosT = async (t, query) => { let recs = [], off = ''; do { const d = await at(`${t}?${query}&pageSize=100${off ? '&offset=' + off : ''}`); if (d.error || d.errors) throw new Error((d.error && d.error.message) || 'Airtable'); recs = recs.concat(d.records || []); off = d.offset || ''; } while (off); return recs; };
    const hoyF = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    // Apunta una ausencia (vacaciones, día libre, horas, cambio de horario) en AUSENCIAS, bloquea los huecos libres de la agenda
    // y devuelve las citas con paciente que caen dentro. La usan Administración y las solicitudes aprobadas en Comunicaciones.
    const altaAusencia = async (a, equipoNombres, creadoPor) => {
      const AUS = 'tblkezm4bTQ4jJf1X';
      const ok = x => /^\d{4}-\d{2}-\d{2}$/.test(x || '');
      if (!ok(a.desde)) return { ok: false, error: 'Elige la fecha' };
      const hasta = ok(a.hasta) && a.hasta >= a.desde ? a.hasta : a.desde;
      const horario = a.modo === 'horario'; // «trabaja otro horario ese día»: se bloquea lo que queda fuera
      const tipo = horario ? 'Cambio de horario' : ['Vacaciones', 'Festivo', 'Día libre', 'Menos horas', 'Baja', 'Formación', 'Otro'].includes(a.tipo) ? a.tipo : 'Vacaciones';
      const p2 = x => { const m = String(x || '').match(/^(\d{1,2}):(\d{2})$/); return m ? m[1].padStart(2, '0') + ':' + m[2] : ''; };
      const hd = p2(a.hd), hh2 = p2(a.hh); if ((hd || hh2 || horario) && !(hd && hh2 && hd < hh2)) return { ok: false, error: 'Revisa las horas: «desde» tiene que ser antes que «hasta»' };
      const pila = s => String(s || '').trim().split(/\s+/)[0];
      const todosF = a.fisio === 'TODOS', quien = todosF ? 'Toda la clínica' : pila(a.fisio);
      if (!todosF && !equipoNombres.some(n => pila(n).toLowerCase() === quien.toLowerCase())) return { ok: false, error: 'Elige el fisio' };
      const d = await at(AUS, { method: 'POST', body: JSON.stringify({ records: [{ fields: { AUSENCIA: `${tipo} · ${quien} · ${a.desde}${hasta !== a.desde ? ' → ' + hasta : ''}${hd ? ` · ${hd}-${hh2}` : ''}`, FISIO: quien, 'HORA DESDE': hd, 'HORA HASTA': hh2, DESDE: a.desde, HASTA: hasta, TIPO: tipo, NOTA: String(a.nota || '').slice(0, 2000), 'CREADO POR': String(creadoPor || '') } }], typecast: true }) });
      if (d.error) return { ok: false, error: d.error.message }; _ausC = { t: 0, v: null };
      // Bloquear los huecos libres de esos días (para que no se reserven desde la app) y avisar de las citas con paciente
      const cond = [`NOT(IS_BEFORE({FECHA},'${a.desde}'))`, `NOT(IS_AFTER({FECHA},'${hasta}'))`]; if (!todosF) cond.push(`{PREF.}='${quien.replace(/'/g, '')}'`);
      const filas = await todosT(CIT, `filterByFormula=${encodeURIComponent(`AND(${cond.join(',')})`)}&fields[]=FECHA&fields[]=HORA&fields[]=ESTADO&fields[]=PREF.&fields[]=${encodeURIComponent('RELACIÓN - CITA')}`).catch(() => []);
      const est = r => String((r.fields.ESTADO && r.fields.ESTADO.name) || r.fields.ESTADO || '').trim();
      const enHoras = r => { if (!hd) return true; const x = p2(r.fields.HORA); if (!x) return false; const dentro = x >= hd && x < hh2; return horario ? !dentro : dentro; };
      filas.splice(0, filas.length, ...filas.filter(enHoras));
      const libres = filas.filter(r => /^(CITA LIBRE|LIBRE - SIN BOMBA)$/.test(est(r)) && !(r.fields['RELACIÓN - CITA'] || []).length);
      for (let i = 0; i < libres.length; i += 10) await at(CIT, { method: 'PATCH', body: JSON.stringify({ records: libres.slice(i, i + 10).map(r => ({ id: r.id, fields: { ESTADO: 'CITA BLOQUEADA', NOTAS: tipo } })), typecast: true }) });
      const conPac = filas.filter(r => (r.fields['RELACIÓN - CITA'] || []).length && /PENDIENTE/.test(est(r))).map(r => ({ fecha: String(r.fields.FECHA || '').slice(0, 10), hora: r.fields.HORA || '', fisio: (r.fields['PREF.'] && r.fields['PREF.'].name) || r.fields['PREF.'] || '' })).sort((x, y) => (x.fecha + x.hora).localeCompare(y.fecha + y.hora));
      return { ok: true, bloqueados: libres.length, conPaciente: conPac, id: d.records[0].id };
    };
    try {
      // Importe de una sesión puesto a mano (informe de horas). Vacío = vuelve al cálculo automático
      if (action === 'seg-importe-sesion') {
        // Una cita (id) o varias del mismo paciente (ids)
        const ids = (Array.isArray(q.ids) && q.ids.length ? q.ids : [q.id]).filter(x => /^rec[A-Za-z0-9]{14}$/.test(x || '')).slice(0, 200);
        if (!ids.length) return res.status(400).json({ ok: false, error: 'Falta la cita' });
        const v = q.importe === '' || q.importe == null ? null : Number(String(q.importe).replace(',', '.'));
        if (v !== null && (!isFinite(v) || v < 0 || v > 5000)) return res.status(400).json({ ok: false, error: 'Importe no válido' });
        const quien = String(q.verificado || '').trim().slice(0, 40);
        const cuando = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', day: 'numeric', month: 'numeric' }).format(new Date());
        const fields = { 'IMPORTE SESIÓN': v, 'IMPORTE VERIFICADO': v !== null && quien ? `${quien} · ${cuando}` : '' };
        let d = {};
        for (let i = 0; i < ids.length && !d.error; i += 10) d = await at(CIT, { method: 'PATCH', body: JSON.stringify({ records: ids.slice(i, i + 10).map(id => ({ id, fields })) }) });
        if (!d.error) return res.status(200).json({ ok: true, n: ids.length, ver: fields['IMPORTE VERIFICADO'] });
        return res.status(200).json({ ok: !d.error, error: d.error ? 'No se ha podido guardar' : undefined });
      }
      // ── COMUNICACIONES INTERNAS (com system): comunicaciones formales entre el equipo, con hilo ──
      // Tabla ⚙ APP · COMUNICACIONES. Una fila por mensaje; las respuestas llevan en HILO el id de la original.
      // En la original: LEÍDO {nombre: fecha} (última vez que cada uno abrió el hilo) y HECHO {nombre: fecha} (quién ha confirmado/resuelto).
      // ── BUZÓN DE SUGERENCIAS: pacientes (app) y equipo (panel). Lo leen quienes tienen acc_sugerencias (Administración › Accesos) ──
      if (action.startsWith('seg-sug-')) {
        if (req.method !== 'POST') return res.status(405).json({ ok: false });
        const SUG = 'tbll3K0ar1cZOcVjZ', CAPT = 'fld0coxDWYBc2WvYH', APART = ['App', 'Clínica', 'Otro'], TIPOS_S = ['Mejora', 'Fallo'];
        const ESTADOS_S = ['Nueva', 'Aceptada', 'Hecha', 'Descartada'], RESPONDIDA = "OR({ESTADO}='Aceptada',{ESTADO}='Hecha',{ESTADO}='Descartada',LEN({NOTA}&'')>0)";
        const okId = x => /^rec[A-Za-z0-9]{14}$/.test(x || ''), nm = v => (v && typeof v === 'object') ? (v.name || '') : (v || '');
        const pila = s => { const p = String(s || '').trim().split(/\s+/)[0] || ''; return p.charAt(0).toUpperCase() + p.slice(1).toLowerCase(); };
        // Quién soy: nombre + contraseña del panel
        const eq = await todosT(FISIOS_TABLE, 'fields[]=Name&fields[]=Password&fields[]=acc_sugerencias&fields[]=' + encodeURIComponent('FECHA BAJA'));
        const yoR = eq.find(r => String(r.fields.Name || '').trim().toLowerCase() === String(q.yo || '').trim().toLowerCase());
        if (!yoR || !String(q.clave || '').trim() || String(yoR.fields.Password || '').trim() !== String(q.clave || '').trim() || yoR.fields['FECHA BAJA']) return res.status(403).json({ ok: false, error: 'Vuelve a iniciar sesión.' });
        const yo = pila(yoR.fields.Name), lector = !!yoR.fields.acc_sugerencias;
        // Las del apartado App (cambios, mejoras y fallos de la app) solo le llegan a quien la desarrolla
        const DEV_APP = 'Nora', veApp = yo === DEV_APP, sinApp = "NOT({APARTADO}='App')";
        const mias = `AND({ORIGEN}='Equipo',{DE}='${yo.replace(/'/g, "\\'")}')`;
        const vista = r => { const F = r.fields || {}, c = (F.CAPTURA || [])[0];
          return { id: r.id, texto: F.TEXTO || '', origen: nm(F.ORIGEN) || 'Equipo', apartado: nm(F.APARTADO) || 'General', tipo: nm(F.TIPO), de: F['ANÓNIMA'] ? 'Anónimo' : (F.DE || ''), anonima: !!F['ANÓNIMA'], paciente: F['ANÓNIMA'] ? '' : (F.PACIENTE || ''),
            captura: c ? { url: c.url, mini: (c.thumbnails && c.thumbnails.large && c.thumbnails.large.url) || c.url } : null, adjuntos: verAdj(F.CAPTURA), estado: nm(F.ESTADO) === 'Vista' ? 'Nueva' : (nm(F.ESTADO) || 'Nueva'), respuesta: F.NOTA || '', respondidoPor: F['CAMBIADO POR'] || '',
            respuestaVista: !!F['RESPUESTA VISTA'], fecha: F.FECHA || r.createdTime || '' }; };
        if (action === 'seg-sug-contar') {
          const [nuevas, resp] = await Promise.all([
            lector ? todosT(SUG, `fields[]=RESUMEN&filterByFormula=${encodeURIComponent(veApp ? "OR({ESTADO}='Nueva',{ESTADO}='Vista',{ESTADO}='')" : `AND(OR({ESTADO}='Nueva',{ESTADO}='Vista',{ESTADO}=''),${sinApp})`)}`) : [],
            todosT(SUG, `fields[]=RESUMEN&filterByFormula=${encodeURIComponent(`AND(${mias},${RESPONDIDA},NOT({RESPUESTA VISTA}))`)}`)]);
          return res.status(200).json({ ok: true, lector, nuevas: nuevas.length, respuestas: resp.length });
        }
        if (action === 'seg-sug-lista') {
          const [rec, mi] = await Promise.all([
            lector ? todosT(SUG, `sort[0][field]=FECHA&sort[0][direction]=desc${veApp ? '' : `&filterByFormula=${encodeURIComponent(sinApp)}`}`) : [],
            todosT(SUG, `sort[0][field]=FECHA&sort[0][direction]=desc&filterByFormula=${encodeURIComponent(mias)}`)]);
          return res.status(200).json({ ok: true, yo, lector, sugerencias: rec.map(vista), mias: mi.map(vista) });
        }
        if (action === 'seg-sug-visto') { // quien la envió ha visto las respuestas
          const rs = await todosT(SUG, `fields[]=RESUMEN&filterByFormula=${encodeURIComponent(`AND(${mias},${RESPONDIDA},NOT({RESPUESTA VISTA}))`)}`);
          for (let i = 0; i < rs.length; i += 10) await at(SUG, { method: 'PATCH', body: JSON.stringify({ records: rs.slice(i, i + 10).map(r => ({ id: r.id, fields: { 'RESPUESTA VISTA': true } })) }) });
          return res.status(200).json({ ok: true, n: rs.length });
        }
        if (action === 'seg-sug-enviar') {
          const texto = String(q.texto || '').trim().slice(0, 3000); if (!texto) return res.status(400).json({ ok: false, error: 'Escribe tu sugerencia' });
          const apartado = APART.includes(q.apartado) ? q.apartado : 'Otro', tipo = apartado === 'App' && TIPOS_S.includes(q.tipo) ? q.tipo : null;
          const fields = { RESUMEN: texto.replace(/\s+/g, ' ').slice(0, 80), TEXTO: texto, ORIGEN: 'Equipo', APARTADO: apartado, DE: yo, ESTADO: 'Nueva', FECHA: new Date().toISOString() };
          if (tipo) fields.TIPO = tipo;
          const d = await at(SUG, { method: 'POST', body: JSON.stringify({ records: [{ fields }], typecast: true }) });
          const rec = d.records && d.records[0]; if (!rec) return res.status(200).json({ ok: false, error: 'No se ha podido enviar' });
          const C = q.captura || null; let sinCaptura = false;
          if (C && C.file && String(C.file).length < 6e6) {
            const up = await fetch(`https://content.airtable.com/v0/${BASE_ID}/${rec.id}/${CAPT}/uploadAttachment`, { method: 'POST', headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ contentType: /^image\/(png|jpeg|webp|gif)$/.test(C.tipo || '') ? C.tipo : 'image/jpeg', file: String(C.file), filename: String(C.nombre || 'captura.jpg').slice(0, 120) }) }).then(x => x.json()).catch(() => ({ error: 1 }));
            sinCaptura = !!up.error;
          }
          return res.status(200).json({ ok: true, id: rec.id, sinCaptura });
        }
        if (action === 'seg-sug-adjunto') { // fotos y archivos de una sugerencia del equipo (solo quien la envió)
          if (!okId(q.id)) return res.status(400).json({ ok: false, error: 'Sugerencia no válida' });
          const r = await at(`${SUG}/${q.id}`); if (r.error || pila((r.fields || {}).DE) !== yo) return res.status(403).json({ ok: false, error: 'No puedes adjuntar aquí' });
          const u = await subirAdjunto(q.id, CAPT, q.archivo); return res.status(200).json(u.ok ? { ok: true } : { ok: false, error: u.error });
        }
        if (action === 'seg-sug-estado') { // responder: Aceptada · Hecha · No se hará (Descartada), con respuesta opcional
          if (!lector) return res.status(403).json({ ok: false, error: 'No tienes acceso al buzón de sugerencias' });
          if (!okId(q.id)) return res.status(400).json({ ok: false });
          if (!veApp) { const r0 = await at(`${SUG}/${q.id}`); if (nm((r0.fields || {}).APARTADO) === 'App') return res.status(403).json({ ok: false, error: 'Esta sugerencia es solo para Nora' }); }
          const fields = { 'CAMBIADO POR': yo, 'RESPUESTA VISTA': false };
          if (q.estado !== undefined) { if (!ESTADOS_S.includes(q.estado)) return res.status(400).json({ ok: false }); fields.ESTADO = q.estado; }
          if (q.respuesta !== undefined) fields.NOTA = String(q.respuesta || '').trim().slice(0, 1500);
          const d = await at(`${SUG}/${q.id}`, { method: 'PATCH', body: JSON.stringify({ fields, typecast: true }) });
          if (d.error) return res.status(200).json({ ok: false, error: 'No se ha podido guardar' });
          return res.status(200).json({ ok: true, sugerencia: vista(d) });
        }
        return res.status(400).json({ ok: false, error: 'Acción no válida' });
      }
      if (action.startsWith('seg-com-')) {
        if (req.method !== 'POST') return res.status(405).json({ ok: false });
        const COM = 'tbl2qRD3WsvQVPrwX', TIPOS_C = ['Comunicado', 'Solicitud', 'Informe', 'Aviso', 'Ausencia', 'Tareas', 'Incidencia', 'Ayuda'];
        const CAT_INC = ['Comportamiento', 'Puntualidad', 'Calidad del trabajo', 'Material o instalaciones', 'Otro'], URG_AY = ['Hoy', 'Esta semana', 'Cuando se pueda'];
        // Solicitudes de ausencia (vacaciones, día libre, horas libres, cambio de horario): las aprueba Nora o Ramiro
        const QUE_AUS = ['Vacaciones', 'Día libre', 'Horas libres', 'Cambio de horario'], APRUEBAN_C = ['Nora'], RESERVA_C = 'Ramiro'; // administración (si lo pide Nora, va a Ramiro)
        const pilaC = s => { const p = String(s || '').trim().split(/\s+/)[0] || ''; return p.charAt(0).toUpperCase() + p.slice(1).toLowerCase(); };
        // Quién soy: nombre + contraseña del panel (como en Administración)
        const equipoRecs = await todosT(FISIOS_TABLE, 'fields[]=Name&fields[]=Password&fields[]=' + encodeURIComponent('FECHA BAJA'));
        const yoRec = equipoRecs.find(r => String(r.fields.Name || '').trim().toLowerCase() === String(q.yo || '').trim().toLowerCase());
        if (!yoRec || !String(q.clave || '').trim() || String(yoRec.fields.Password || '').trim() !== String(q.clave || '').trim() || yoRec.fields['FECHA BAJA']) return res.status(403).json({ ok: false, error: 'Vuelve a iniciar sesión.' });
        const yo = pilaC(yoRec.fields.Name);
        const equipo = [...new Set(equipoRecs.filter(r => r.fields.Name && !r.fields['FECHA BAJA']).map(r => pilaC(r.fields.Name)))].sort((a, b) => a.localeCompare(b, 'es'));
        const aprueban = APRUEBAN_C.filter(n => equipo.includes(n));
        const paraAdmin = () => { const p = aprueban.filter(n => n !== yo); return p.length ? p : (equipo.includes(RESERVA_C) && RESERVA_C !== yo ? [RESERVA_C] : []); };
        const ahora = new Date().toISOString();
        const MES_C = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
        const fC = f => { const [y, m, d] = String(f || '').split('-').map(Number); return d ? `${d} ${MES_C[m - 1]}` : ''; };
        const textoAus = a => { const dias = a.hasta && a.hasta !== a.desde ? `${fC(a.desde)} → ${fC(a.hasta)}` : fC(a.desde);
          return a.que === 'Horas libres' ? `${a.que} · ${dias} · de ${a.hd} a ${a.hh}` : a.que === 'Cambio de horario' ? `${a.que} · ${dias} · trabaja de ${a.hd} a ${a.hh}` : `${a.que} · ${dias}`; };
        const json = t => { try { const o = JSON.parse(t || '{}'); return o && typeof o === 'object' ? o : {}; } catch (e) { return {}; } };
        const nmC = v => (v && typeof v === 'object') ? (v.name || '') : (v || '');
        const listaPara = t => String(t || '').split(',').map(x => x.trim()).filter(Boolean);
        const okId = x => /^rec[A-Za-z0-9]{14}$/.test(x || '');
        const vistaMsg = r => { const F = r.fields || {}; return { id: r.id, de: F.DE || '', para: listaPara(F.PARA), cuerpo: F.CUERPO || '', fecha: F.FECHA || r.createdTime || '', adjuntos: verAdj(F.ADJUNTOS) }; };
        // Número correlativo por año entre las comunicaciones que existen: si se borra una, las demás se renumeran solas
        let SEQ_C = {};
        const numerar = roots => { const m = {}, n = {}; roots.filter(r => !r.fields.HILO && r.fields['Nº']).sort((a, b) => a.fields['Nº'] - b.fields['Nº']).forEach(r => { const y = String(r.fields.FECHA || r.createdTime || '').slice(0, 4); n[y] = (n[y] || 0) + 1; m[r.id] = n[y]; }); SEQ_C = m; };
        const vistaHilo = (root, resp) => {
          const F = root.fields || {}, para = listaPara(F.PARA), de = F.DE || '', leido = json(F['LEÍDO']), hecho = json(F.HECHO);
          const msgs = [root, ...resp].map(vistaMsg).sort((a, b) => a.fecha.localeCompare(b.fecha));
          const ult = msgs[msgs.length - 1], req = !!F['REQUIERE ACCIÓN'], abierta = nmC(F.ESTADO) !== 'Cerrada';
          const faltan = para.filter(p => !hecho[p]);
          const tipo = nmC(F.TIPO) || 'Comunicado', esAus = tipo === 'Ausencia', resolucion = esAus ? (nmC(F['RESOLUCIÓN']) || 'Pendiente') : '';
          const puedeAprobar = esAus && abierta && resolucion === 'Pendiente' && para.includes(yo) && de !== yo;
          const modo = ['leer', 'hacer', 'responder'].includes(F.MODO) ? F.MODO : (req ? 'hacer' : 'leer'), recibido = json(F.RECIBIDO);
          return { id: root.id, asunto: F.ASUNTO || '(sin asunto)', tipo, de, para, req, modo, recibido, limite: F['FECHA LÍMITE'] || '', abierta,
            num: SEQ_C[root.id] ? `COM-${String(msgs[0].fecha || '').slice(0, 4)}-${String(SEQ_C[root.id]).padStart(4, '0')}` : '', ausencia: esAus ? json(F.AUSENCIA) : null, datos: json(F.DATOS), resolucion, resueltaPor: F['RESUELTA POR'] || '', puedeAprobar,
            fecha: msgs[0].fecha, ultima: ult.fecha, ultimoDe: ult.de, nResp: resp.length, extracto: String(ult.cuerpo || '').replace(/\[\[pac:rec[A-Za-z0-9]{14}\|([^\]|]{1,80})(?:\|[a-z]{3,12})?\]\]/g, '@$1').replace(/\[\[sec:[a-z]{2,8}\|([^\]]{1,40})\]\]/g, '@$1').replace(/\s+/g, ' ').slice(0, 140),
            leido, hecho, faltan,
            noLeido: ult.de !== yo && (!leido[yo] || leido[yo] < ult.fecha),
            pendienteMio: esAus ? puedeAprobar : abierta && para.includes(yo) && !hecho[yo],
            puedeGestionar: abierta && ((tipo === 'Incidencia' && para.includes(yo)) || (tipo === 'Ayuda' && (para.includes(yo) && !json(F.DATOS).encargado || json(F.DATOS).encargado === yo || de === yo))),
            esperando: esAus ? (de === yo && abierta && resolucion === 'Pendiente') : abierta && de === yo && (faltan.length > 0 || tipo === 'Ayuda'),
            msgs };
        };
        const cargar = async () => {
          const rs = await todosT(COM, 'sort[0][field]=FECHA&sort[0][direction]=asc');
          const roots = rs.filter(r => !r.fields.HILO), porHilo = {}; numerar(roots);
          rs.filter(r => r.fields.HILO).forEach(r => { (porHilo[r.fields.HILO] = porHilo[r.fields.HILO] || []).push(r); });
          return roots.map(r => { const de0 = String((r.fields || {}).DE || '').trim(), rs = porHilo[r.id] || []; return { r, h: vistaHilo(r, de0 === yo ? rs : rs.filter(x => [de0, yo].includes(String(x.fields['DE'] || '').trim()))) }; }); // las respuestas de los compañeros solo las ve quien la envió
        };
        const participa = h => h.de === yo || h.para.includes(yo);
        const marcar = async (root, campo, extra) => { const o = json(root.fields[campo]); o[yo] = ahora; const fields = { [campo]: JSON.stringify(o), ...(extra || {}) };
          const d = await at(`${COM}/${root.id}`, { method: 'PATCH', body: JSON.stringify({ fields }) }); if (d.error) throw new Error('No se ha podido guardar'); root.fields = d.fields || root.fields; return o; };
        const buscar = async id => { if (!okId(id)) throw new Error('Comunicación no válida'); const d = await at(`${COM}/${id}`); if (d.error || !d.fields || d.fields.HILO) throw new Error('No se encuentra la comunicación'); return d; };

        if (action === 'seg-com-buzon') {
          const hs = (await cargar()).map(x => x.h).filter(participa).map(({ msgs, ...h }) => h).sort((a, b) => b.ultima.localeCompare(a.ultima));
          return res.status(200).json({ ok: true, yo, equipo, hilos: hs });
        }
        if (action === 'seg-com-hilo') {
          const root = await buscar(q.id);
          const resp = await todosT(COM, `filterByFormula=${encodeURIComponent(`{HILO}='${root.id}'`)}`);
          numerar(await todosT(COM, `filterByFormula=${encodeURIComponent("{HILO}=''")}&fields[]=${encodeURIComponent('Nº')}&fields[]=FECHA`));
          let h = vistaHilo(root, resp);
          if (!participa(h)) return res.status(403).json({ ok: false, error: 'No formas parte de esta comunicación' });
          if (h.noLeido || !h.leido[yo]) await marcar(root, 'LEÍDO');
          // Las respuestas solo las ve quien envió la comunicación: cada destinatario ve las suyas y las de quien la envió, no las de los compañeros
          const de0 = String(root.fields['DE'] || '').trim();
          h = vistaHilo(root, de0 === yo ? resp : resp.filter(r => [de0, yo].includes(String(r.fields['DE'] || '').trim())));
          return res.status(200).json({ ok: true, yo, hilo: h });
        }
        if (action === 'seg-com-enviar' && q.tipo === 'Ausencia') {
          const A = q.ausencia || {}, okF = x => /^\d{4}-\d{2}-\d{2}$/.test(x || ''), okH = x => /^\d{2}:\d{2}$/.test(x || '');
          if (!QUE_AUS.includes(A.que)) return res.status(400).json({ ok: false, error: 'Elige qué pides' });
          if (!okF(A.desde)) return res.status(400).json({ ok: false, error: 'Elige la fecha' });
          const a = { que: A.que, desde: A.desde, hasta: okF(A.hasta) && A.hasta >= A.desde ? A.hasta : A.desde, hd: '', hh: '' };
          if (A.que === 'Horas libres' || A.que === 'Cambio de horario') { if (!okH(A.hd) || !okH(A.hh) || A.hd >= A.hh) return res.status(400).json({ ok: false, error: 'Revisa las horas: «de» tiene que ser antes que «a»' }); a.hd = A.hd; a.hh = A.hh; }
          if (a.hasta < hoyF) return res.status(400).json({ ok: false, error: 'Esas fechas ya han pasado' });
          const para = paraAdmin();
          if (!para.length) return res.status(400).json({ ok: false, error: 'No hay nadie de administración a quien enviarla' });
          const motivo = String(q.cuerpo || '').trim().slice(0, 5000);
          const d = await at(COM, { method: 'POST', body: JSON.stringify({ records: [{ fields: { ASUNTO: textoAus(a), TIPO: 'Ausencia', DE: yo, PARA: para.join(', '), CUERPO: motivo || 'Solicito ' + textoAus(a).toLowerCase() + '.', FECHA: ahora,
            'REQUIERE ACCIÓN': true, AUSENCIA: JSON.stringify(a), 'RESOLUCIÓN': 'Pendiente', 'LEÍDO': JSON.stringify({ [yo]: ahora }), HECHO: '{}', ESTADO: 'Abierta' } }], typecast: true }) });
          if (d.error) return res.status(200).json({ ok: false, error: 'No se ha podido enviar' });
          return res.status(200).json({ ok: true, id: d.records[0].id });
        }
        if (action === 'seg-com-resolver') {
          // Aprobar o rechazar una solicitud de ausencia. Al aprobar: se apunta en Administración y se bloquea la agenda
          const root = await buscar(q.id), F = root.fields;
          if (nmC(F.TIPO) !== 'Ausencia') return res.status(400).json({ ok: false, error: 'No es una solicitud de ausencia' });
          if (!listaPara(F.PARA).includes(yo) || F.DE === yo) return res.status(403).json({ ok: false, error: 'Solo administración puede aprobarla' });
          if ((nmC(F['RESOLUCIÓN']) || 'Pendiente') !== 'Pendiente') return res.status(400).json({ ok: false, error: `Ya está ${String(nmC(F['RESOLUCIÓN'])).toLowerCase()}` });
          const coment = String(q.comentario || '').trim().slice(0, 5000), a = json(F.AUSENCIA);
          let texto;
          if (q.aprobar) {
            const map = { 'Vacaciones': { modo: 'dia', tipo: 'Vacaciones' }, 'Día libre': { modo: 'dia', tipo: 'Día libre' }, 'Horas libres': { modo: 'horas', tipo: 'Menos horas', hd: a.hd, hh: a.hh }, 'Cambio de horario': { modo: 'horario', hd: a.hd, hh: a.hh } }[a.que];
            if (!map) return res.status(400).json({ ok: false, error: 'La solicitud no tiene datos válidos' });
            const r = await altaAusencia({ ...map, fisio: F.DE, desde: a.desde, hasta: a.hasta, nota: `Solicitud aprobada por ${yo} (Comunicaciones)` }, equipoRecs.filter(x => x.fields.Name && !x.fields['FECHA BAJA']).map(x => x.fields.Name), yoRec.fields.Name);
            if (!r.ok) return res.status(400).json({ ok: false, error: r.error || 'No se ha podido apuntar' });
            texto = `✓ Aprobada por ${yo}.\nApuntada en Administración › Vacaciones y horarios${r.bloqueados ? ` y ${r.bloqueados === 1 ? 'bloqueado 1 hueco' : `bloqueados ${r.bloqueados} huecos`} de la agenda` : ''}.`;
            if (r.conPaciente.length) texto += `\n\nOjo: en esas fechas ${r.conPaciente.length === 1 ? 'hay 1 cita' : `hay ${r.conPaciente.length} citas`} con paciente que hay que mover:\n` + r.conPaciente.slice(0, 30).map(c => `• ${fC(c.fecha)} · ${c.hora}`).join('\n');
          } else texto = `✗ Rechazada por ${yo}.`;
          if (coment) texto += `\n\n${coment}`;
          const otros = [...new Set([F.DE, ...listaPara(F.PARA)])].filter(p => p && p !== yo);
          await at(COM, { method: 'POST', body: JSON.stringify({ records: [{ fields: { ASUNTO: 'RE: ' + (F.ASUNTO || ''), HILO: root.id, DE: yo, PARA: otros.join(', '), CUERPO: texto, FECHA: ahora } }] }) });
          const hc = json(F.HECHO); listaPara(F.PARA).forEach(p => { hc[p] = hc[p] || ahora; }); const le = json(F['LEÍDO']); le[yo] = ahora;
          const d = await at(`${COM}/${root.id}`, { method: 'PATCH', body: JSON.stringify({ fields: { 'RESOLUCIÓN': q.aprobar ? 'Aprobada' : 'Rechazada', 'RESUELTA POR': yo, ESTADO: 'Cerrada', HECHO: JSON.stringify(hc), 'LEÍDO': JSON.stringify(le) } }) });
          return res.status(200).json({ ok: !d.error, error: d.error ? 'No se ha podido guardar' : undefined });
        }
        if (action === 'seg-com-enviar' && ['Tareas', 'Incidencia', 'Ayuda'].includes(q.tipo)) {
          const tipo = q.tipo, cuerpo = String(q.cuerpo || '').trim().slice(0, 20000);
          let para = [...new Set((Array.isArray(q.para) ? q.para : []).map(pilaC))].filter(p => equipo.includes(p) && p !== yo), datos = {}, asunto = String(q.asunto || '').trim().slice(0, 140);
          if (tipo === 'Tareas') {
            const items = (Array.isArray(q.items) ? q.items : []).map(t => String(t || '').trim().slice(0, 400)).filter(Boolean).slice(0, 40);
            if (!items.length) return res.status(400).json({ ok: false, error: 'Añade al menos una tarea' });
            if (!asunto) asunto = items.length === 1 ? items[0] : `${items.length} tareas`;
            datos = { items: items.map(t => ({ t, por: '', en: '' })) };
          } else if (tipo === 'Incidencia') {
            para = paraAdmin();
            if (!para.length) return res.status(400).json({ ok: false, error: 'No hay nadie de administración a quien enviarlo' });
            const cat = CAT_INC.includes(q.cat) ? q.cat : 'Otro';
            datos = { cat, sobre: [...new Set((Array.isArray(q.sobre) ? q.sobre : []).map(pilaC))].filter(p => equipo.includes(p)) };
            if (!cuerpo) return res.status(400).json({ ok: false, error: 'Cuenta lo que ha pasado' });
            if (!asunto) asunto = cat + (datos.sobre.length ? ' · ' + datos.sobre.join(', ') : '');
          } else {
            datos = { urg: URG_AY.includes(q.urg) ? q.urg : 'Cuando se pueda', encargado: '', en: '' };
            if (!asunto) return res.status(400).json({ ok: false, error: 'Di con qué necesitas ayuda' });
          }
          if (!para.length) return res.status(400).json({ ok: false, error: 'Elige a quién se la envías' });
          const limite = /^\d{4}-\d{2}-\d{2}$/.test(q.limite || '') ? q.limite : null;
          const d = await at(COM, { method: 'POST', body: JSON.stringify({ records: [{ fields: { ASUNTO: asunto, TIPO: tipo, DE: yo, PARA: para.join(', '), CUERPO: cuerpo, FECHA: ahora,
            'REQUIERE ACCIÓN': true, 'FECHA LÍMITE': tipo === 'Tareas' ? limite : null, DATOS: JSON.stringify(datos), 'LEÍDO': JSON.stringify({ [yo]: ahora }), HECHO: '{}', ESTADO: 'Abierta' } }], typecast: true }) });
          if (d.error) return res.status(200).json({ ok: false, error: 'No se ha podido enviar' });
          return res.status(200).json({ ok: true, id: d.records[0].id });
        }
        // Tareas: marcar / desmarcar una. Cuando están todas, la carta queda hecha y se cierra
        if (action === 'seg-com-tarea') {
          const root = await buscar(q.id), F = root.fields, para0 = listaPara(F.PARA);
          if (nmC(F.TIPO) !== 'Tareas') return res.status(400).json({ ok: false, error: 'No es una lista de tareas' });
          if (F.DE !== yo && !para0.includes(yo)) return res.status(403).json({ ok: false, error: 'No formas parte de esta comunicación' });
          const D = json(F.DATOS);
          if (q.idx === 'todas') (D.items || []).forEach(x => { if (!x.por) { x.por = yo; x.en = ahora; } });
          else { const it = (D.items || [])[Number(q.idx)]; if (!it) return res.status(400).json({ ok: false, error: 'Tarea no válida' });
            if (q.hecho) { it.por = yo; it.en = ahora; } else { it.por = ''; it.en = ''; } }
          const todas = D.items.every(x => x.por), hc = {}; if (todas) para0.forEach(p => { hc[p] = ahora; });
          const le = json(F['LEÍDO']); le[yo] = ahora;
          const d = await at(`${COM}/${root.id}`, { method: 'PATCH', body: JSON.stringify({ fields: { DATOS: JSON.stringify(D), HECHO: JSON.stringify(todas ? hc : {}), ESTADO: todas ? 'Cerrada' : 'Abierta', 'LEÍDO': JSON.stringify(le) } }) });
          return res.status(200).json({ ok: !d.error, todas, error: d.error ? 'No se ha podido guardar' : undefined });
        }
        // Para dirección: marcarla como gestionada (basta con uno de dirección). Ayuda: «Me encargo» y «Resuelta»
        if (action === 'seg-com-gestion') {
          const root = await buscar(q.id), F = root.fields, para0 = listaPara(F.PARA), tipo = nmC(F.TIPO), D = json(F.DATOS), coment = String(q.comentario || '').trim().slice(0, 5000);
          const otros = [...new Set([F.DE, ...para0])].filter(p => p && p !== yo);
          const nota = async t => { await at(COM, { method: 'POST', body: JSON.stringify({ records: [{ fields: { ASUNTO: 'RE: ' + (F.ASUNTO || ''), HILO: root.id, DE: yo, PARA: otros.join(', '), CUERPO: t + (coment ? '\n\n' + coment : ''), FECHA: ahora } }] }) }); };
          const le = json(F['LEÍDO']); le[yo] = ahora;
          let fields;
          if (tipo === 'Incidencia') {
            if (!para0.includes(yo)) return res.status(403).json({ ok: false, error: 'Solo administración puede gestionarla' });
            const hc = {}; para0.forEach(p => { hc[p] = ahora; });
            await nota(`✓ Gestionada por ${yo}.`);
            fields = { HECHO: JSON.stringify(hc), ESTADO: 'Cerrada', 'RESUELTA POR': yo };
          } else if (tipo === 'Ayuda' && q.accion === 'encargo') {
            if (!para0.includes(yo)) return res.status(403).json({ ok: false, error: 'No formas parte de esta comunicación' });
            if (D.encargado && D.encargado !== yo) return res.status(400).json({ ok: false, error: `Ya se encarga ${D.encargado}` });
            D.encargado = yo; D.en = ahora; const hc = {}; para0.filter(p => p !== yo).forEach(p => { hc[p] = ahora; });
            await nota(`🙋 Me encargo yo.`);
            fields = { DATOS: JSON.stringify(D), HECHO: JSON.stringify(hc) };
          } else if (tipo === 'Ayuda' && q.accion === 'resuelta') {
            if (F.DE !== yo && D.encargado !== yo) return res.status(403).json({ ok: false, error: 'La marca como resuelta quien la pidió o quien se encarga' });
            const hc = {}; para0.forEach(p => { hc[p] = ahora; });
            await nota(`✓ Resuelta.`);
            fields = { HECHO: JSON.stringify(hc), ESTADO: 'Cerrada', 'RESUELTA POR': yo };
          } else return res.status(400).json({ ok: false, error: 'Acción no válida' });
          const d = await at(`${COM}/${root.id}`, { method: 'PATCH', body: JSON.stringify({ fields: { ...fields, 'LEÍDO': JSON.stringify(le) } }) });
          return res.status(200).json({ ok: !d.error, error: d.error ? 'No se ha podido guardar' : undefined });
        }
        if (action === 'seg-com-enviar') {
          const asunto = String(q.asunto || '').trim().slice(0, 140), cuerpo = String(q.cuerpo || '').trim().slice(0, 20000);
          const para = [...new Set((Array.isArray(q.para) ? q.para : []).map(pilaC))].filter(p => equipo.includes(p) && p !== yo);
          if (!asunto) return res.status(400).json({ ok: false, error: 'Falta el asunto' });
          if (!cuerpo) return res.status(400).json({ ok: false, error: 'Escribe el contenido' });
          if (!para.length) return res.status(400).json({ ok: false, error: 'Elige a quién se la envías' });
          const tipo = TIPOS_C.includes(q.tipo) && q.tipo !== 'Ausencia' ? q.tipo : 'Comunicado', limite = /^\d{4}-\d{2}-\d{2}$/.test(q.limite || '') ? q.limite : null;
          // Qué se pide a quien la recibe: que lo lea (acuse de recibo), que lo haga (recibido + hecho) o que conteste (respuesta escrita)
          const modo = ['leer', 'hacer', 'responder'].includes(q.modo) ? q.modo : (q.req ? 'hacer' : 'leer'), reqM = modo !== 'leer';
          const d = await at(COM, { method: 'POST', body: JSON.stringify({ records: [{ fields: { ASUNTO: asunto, TIPO: tipo, DE: yo, PARA: para.join(', '), CUERPO: cuerpo, FECHA: ahora, MODO: modo,
            'REQUIERE ACCIÓN': reqM, 'FECHA LÍMITE': reqM ? limite : null, 'LEÍDO': JSON.stringify({ [yo]: ahora }), HECHO: '{}', ESTADO: 'Abierta' } }], typecast: true }) });
          if (d.error) return res.status(200).json({ ok: false, error: 'No se ha podido enviar' });
          return res.status(200).json({ ok: true, id: d.records[0].id });
        }
        if (action === 'seg-com-adjunto') { // adjunto de una comunicación o de una respuesta: solo quien la escribió
          if (!okId(q.id)) return res.status(400).json({ ok: false, error: 'Comunicación no válida' });
          const r = await at(`${COM}/${q.id}`); if (r.error || String((r.fields || {}).DE || '') !== yo) return res.status(403).json({ ok: false, error: 'No puedes adjuntar aquí' });
          const u = await subirAdjunto(q.id, 'fldv1YBgbIinCFaiC', q.archivo); return res.status(200).json(u.ok ? { ok: true } : { ok: false, error: u.error });
        }
        if (action === 'seg-com-responder') {
          const root = await buscar(q.id), cuerpo = String(q.cuerpo || '').trim().slice(0, 20000);
          const F = root.fields, de = F.DE || '', para0 = listaPara(F.PARA);
          if (de !== yo && !para0.includes(yo)) return res.status(403).json({ ok: false, error: 'No formas parte de esta comunicación' });
          if (!cuerpo && !q.hecho && !q.recibido) return res.status(400).json({ ok: false, error: 'Escribe la respuesta' });
          const modoR = ['leer', 'hacer', 'responder'].includes(F.MODO) ? F.MODO : '';
          if (cuerpo && de !== yo && modoR !== 'responder' && !['Ausencia', 'Incidencia', 'Ayuda', 'Tareas'].includes(nmC(F.TIPO))) return res.status(400).json({ ok: false, error: 'En esta comunicación no se pide respuesta escrita' });
          // Respuestas escritas: la de un destinatario solo le llega a quien la envió; un comentario de quien la envió, a todos
          if (cuerpo) { const otros = de === yo ? para0.filter(p => p && p !== yo) : [de];
            const d = await at(COM, { method: 'POST', body: JSON.stringify({ records: [{ fields: { ASUNTO: 'RE: ' + (F.ASUNTO || ''), HILO: root.id, DE: yo, PARA: otros.join(', '), CUERPO: cuerpo, FECHA: ahora } }] }) });
            if (d.error) return res.status(200).json({ ok: false, error: 'No se ha podido enviar' }); q._respId = d.records[0].id; }
          await marcar(root, 'LEÍDO');
          if (para0.includes(yo) && (q.recibido || q.hecho || cuerpo) && !json(root.fields.RECIBIDO)[yo]) await marcar(root, 'RECIBIDO'); // acuse de recibo
          if (q.hecho && para0.includes(yo) && !['Ausencia', 'Tareas', 'Incidencia', 'Ayuda'].includes(nmC(F.TIPO))) { const hc = json(root.fields.HECHO); hc[yo] = ahora; const todos = para0.every(p => hc[p]);
            await marcar(root, 'HECHO', todos && F['REQUIERE ACCIÓN'] ? { ESTADO: 'Cerrada' } : null); }
          return res.status(200).json({ ok: true, id: q._respId || '' });
        }
        if (action === 'seg-com-hecho') {
          const root = await buscar(q.id), F = root.fields, para0 = listaPara(F.PARA);
          if (!para0.includes(yo)) return res.status(403).json({ ok: false, error: 'Solo quien la recibe puede confirmarla' });
          if (['Ausencia', 'Tareas', 'Incidencia', 'Ayuda'].includes(nmC(F.TIPO))) return res.status(400).json({ ok: false, error: 'Esta se gestiona con sus propios botones' });
          const hc = json(F.HECHO); hc[yo] = ahora; const todos = para0.every(p => hc[p]);
          await marcar(root, 'HECHO', todos && F['REQUIERE ACCIÓN'] ? { ESTADO: 'Cerrada' } : null);
          return res.status(200).json({ ok: true });
        }
        if (action === 'seg-com-estado') {
          // Cerrar o reabrir: quien la envió
          const root = await buscar(q.id);
          if ((root.fields.DE || '') !== yo) return res.status(403).json({ ok: false, error: 'Solo quien la envió puede cerrarla o reabrirla' });
          const d = await at(`${COM}/${root.id}`, { method: 'PATCH', body: JSON.stringify({ fields: { ESTADO: q.abrir ? 'Abierta' : 'Cerrada' } }) });
          return res.status(200).json({ ok: !d.error, error: d.error ? 'No se ha podido guardar' : undefined });
        }
        return res.status(400).json({ ok: false, error: 'Acción no válida' });
      }
      if (action === 'seg-config') return res.status(200).json({ ok: true, conf: await conf(), legalBase: LEGAL_TXT() });
      // ── ADMINISTRACIÓN: equipo, horarios, ausencias, accesos y contraseñas (solo quien tiene acc_admin) ──
      if (action.startsWith('seg-adm-')) {
        if (req.method !== 'POST') return res.status(405).json({ ok: false });
        const FT = FISIOS_TABLE, AUS = 'tblkezm4bTQ4jJf1X', DIAS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
        const ACC = ['agenda', 'pacientes', 'chat', 'checklist', 'callin', 'captacion', 'programas', 'ejercicios', 'anamnesis', 'rendimiento', 'estadisticas', 'school', 'sugerencias', 'admin'];
        const full = await todosT(FT, 'sort[0][field]=Name');
        const yo = full.find(r => r.fields && String(r.fields.Name || '').trim().toLowerCase() === String(q.yo || '').trim().toLowerCase());
        if (!yo || String(yo.fields.Password || '').trim() !== String(q.clave || '').trim() || !yo.fields.acc_admin || yo.fields['FECHA BAJA']) return res.status(403).json({ ok: false, error: 'Solo dirección puede entrar en Administración. Vuelve a iniciar sesión.' });
        const pila = s => String(s || '').trim().split(/\s+/)[0];
        const vista = r => { const F = r.fields || {}, horas = {};
          String(F['HORAS POR DÍA'] || '').split('\n').forEach(l => { const m = l.trim().match(/^(\S+)\s+([\d.,]+)/); if (!m) return; const d = DIAS.find(x => capNorm(x) === capNorm(m[1])); if (d) horas[d] = Number(m[2].replace(',', '.')); });
          return { id: r.id, nombre: F.Name || '', role: F.Role || 'fisio', direccion: !!F['DIRECCIÓN'], colegiado: F['NºColegiado'] || '', tel: F['TELÉFONO'] || '', email: F.EMAIL || '', alta: F['FECHA ALTA'] || '', baja: F['FECHA BAJA'] || '', notas: F['NOTAS ADMIN'] || '',
            horas, semana: F['HORAS SEMANA'] || null, control: !!F['CONTROL HORAS'], banco: !!F['BANCO HORAS'], accesos: Object.fromEntries(ACC.map(k => [k, !!F['acc_' + k]])), foto: (F.Foto && F.Foto[0] && F.Foto[0].thumbnails && F.Foto[0].thumbnails.large && F.Foto[0].thumbnails.large.url) || '',
            contrato: { tipo: (F['TIPO CONTRATO'] && F['TIPO CONTRATO'].name) || F['TIPO CONTRATO'] || '', pct: F['PORCENTAJE FISIO'] == null ? null : Number(F['PORCENTAJE FISIO']), coste: F['COSTE EMPRESA MES'] == null ? null : Number(F['COSTE EMPRESA MES']) },
            docs: (F.DOCUMENTOS || []).map(a => ({ id: a.id, nombre: a.filename || 'documento', url: a.url, tipo: a.type || '', size: a.size || 0 })),
            claveDebil: !F.Password || String(F.Password).trim().length < 4 || /^(1234|12345|123456|4321|0000|fisio365)$/i.test(String(F.Password).trim()) || /^(.)\1+$/.test(String(F.Password).trim()) }; };
        const ausencias = async () => (await todosT(AUS, `filterByFormula=${encodeURIComponent(`NOT(IS_BEFORE({HASTA},DATEADD(TODAY(),-60,'days')))`)}&sort[0][field]=DESDE&sort[0][direction]=asc`)).map(r => ({ id: r.id, fisio: r.fields.FISIO || '', desde: r.fields.DESDE || '', hasta: r.fields.HASTA || r.fields.DESDE || '', tipo: (r.fields.TIPO && r.fields.TIPO.name) || r.fields.TIPO || '', nota: r.fields.NOTA || '', por: r.fields['CREADO POR'] || '', hd: r.fields['HORA DESDE'] || '', hh: r.fields['HORA HASTA'] || '' }));
        if (action === 'seg-adm-equipo') {
          const eq = full.filter(r => r.fields && r.fields.Name).map(vista).sort((a, b) => !!a.baja - !!b.baja || (a.role === 'admin') - (b.role === 'admin') || a.nombre.localeCompare(b.nombre));
          return res.status(200).json({ ok: true, equipo: eq, ausencias: await ausencias().catch(() => []), dias: DIAS, accesos: ACC });
        }
        // Documentos del fisio (contratos, confidencialidad…): subir o borrar
        if (action === 'seg-adm-doc') {
          const fi = full.find(r => r.id === q.id); if (!fi) return res.status(404).json({ ok: false, error: 'No encuentro a esa persona' });
          if (q.op === 'subir') {
            const b64 = String(q.b64 || ''), nom = String(q.nombre || 'documento').replace(/[\\/:*?"<>|]/g, '').slice(0, 120) || 'documento';
            if (!b64 || b64.length > 4.4e6) return res.status(400).json({ ok: false, error: 'El archivo es demasiado grande (máximo unos 3 MB)' });
            const up = await fetch(`https://content.airtable.com/v0/${BASE_ID}/${fi.id}/fldSlNzar6AlmEXfP/uploadAttachment`, { method: 'POST', headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ contentType: String(q.tipo || 'application/octet-stream').slice(0, 100), file: b64, filename: nom }) }).catch(() => null);
            if (!up || !up.ok) return res.status(200).json({ ok: false, error: 'No se ha podido subir. Prueba otra vez.' });
          } else if (q.op === 'borrar') {
            const quedan = (fi.fields.DOCUMENTOS || []).filter(a => a.id !== q.doc).map(a => ({ id: a.id }));
            const d = await at(`${FT}/${fi.id}`, { method: 'PATCH', body: JSON.stringify({ fields: { DOCUMENTOS: quedan } }) }); if (d.error) return res.status(200).json({ ok: false, error: 'No se ha podido borrar' });
          } else return res.status(400).json({ ok: false });
          const d = await at(`${FT}/${fi.id}`); return res.status(200).json({ ok: true, fisio: vista(d) });
        }
        if (action === 'seg-adm-fisio') {
          const c = q.fisio || {}, nombre = String(c.nombre || '').trim().replace(/\s+/g, ' ');
          if (nombre.length < 2) return res.status(400).json({ ok: false, error: 'Escribe el nombre' });
          const otro = full.find(r => r.id !== c.id && r.fields && String(r.fields.Name || '').trim().toLowerCase() === nombre.toLowerCase());
          if (otro) return res.status(400).json({ ok: false, error: 'Ya hay alguien con ese nombre' });
          const mismaPila = full.find(r => r.id !== c.id && r.fields && !r.fields['FECHA BAJA'] && pila(r.fields.Name).toLowerCase() === pila(nombre).toLowerCase());
          if (mismaPila) return res.status(400).json({ ok: false, error: `Ya hay otra persona que se llama ${pila(nombre)}. En la agenda se distingue por el nombre de pila: ponle otro (por ejemplo «${pila(nombre)} M.»)` });
          const f = { Name: nombre, Role: c.role === 'admin' ? 'admin' : 'fisio', 'NºColegiado': String(c.colegiado || '').trim(), 'TELÉFONO': String(c.tel || '').trim(), 'NOTAS ADMIN': String(c.notas || '').slice(0, 5000), 'CONTROL HORAS': !!c.control, 'BANCO HORAS': !!c.banco, 'DIRECCIÓN': !!c.direccion, acc_admin: !!c.direccion }; // Dirección = entrar aquí + Daily report
          const em = String(c.email || '').trim(); f.EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em) ? em : null;
          f['FECHA ALTA'] = /^\d{4}-\d{2}-\d{2}$/.test(c.alta || '') ? c.alta : null;
          const h = c.horas || {}, lin = []; let tot = 0; DIAS.forEach(d => { const n = Math.max(0, Math.min(14, Number(String(h[d] || '').replace(',', '.')) || 0)); if (n) { lin.push(`${d} ${n}`); tot += n; } });
          f['HORAS POR DÍA'] = lin.join('\n'); f['HORAS SEMANA'] = Math.round(tot) || null;
          ACC.forEach(k => { if (c.accesos && k in c.accesos) f['acc_' + k] = !!c.accesos[k]; });
          if (c.contrato) { const t = c.contrato.tipo === 'Nómina' ? 'Nómina' : c.contrato.tipo === 'Autónomo' ? 'Autónomo' : null; f['TIPO CONTRATO'] = t;
            const n = v => { const x = Number(String(v == null ? '' : v).replace(',', '.')); return String(v == null ? '' : v).trim() === '' || !isFinite(x) ? null : x; };
            const pc = n(c.contrato.pct), co = n(c.contrato.coste);
            f['PORCENTAJE FISIO'] = t === 'Autónomo' && pc != null ? Math.max(0, Math.min(100, pc)) : null; f['COSTE EMPRESA MES'] = t === 'Nómina' && co != null ? Math.max(0, co) : null; }
          if (c.id === yo.id) { f.acc_admin = true; f['DIRECCIÓN'] = true; } // que nadie se quite a sí mismo Dirección
          const clave = String(c.clave || '').trim();
          if (clave) { if (clave.length < 4) return res.status(400).json({ ok: false, error: 'La contraseña tiene que tener al menos 4 caracteres' }); f.Password = clave; }
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
          const r = full.find(x => x.id === q.id); if (!r || !(ACC.includes(q.k) || q.k === 'direccion')) return res.status(400).json({ ok: false, error: 'Datos no válidos' });
          if (r.id === yo.id && (q.k === 'admin' || q.k === 'direccion') && !q.v) return res.status(400).json({ ok: false, error: 'No puedes quitarte a ti mismo Dirección' });
          // «Dirección» es una sola cosa: entrar en esta sección y ver lo de dirección (Daily report)
          const campos = q.k === 'admin' || q.k === 'direccion' ? { acc_admin: !!q.v, 'DIRECCIÓN': !!q.v } : { ['acc_' + q.k]: !!q.v };
          const d = await at(`${FT}/${r.id}`, { method: 'PATCH', body: JSON.stringify({ fields: campos }) });
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
        if (action === 'seg-adm-logo') { // subir o quitar el logo de la clínica (imagen pequeña guardada en Ajustes)
          const cur = (await ajuste('config', null)) || {}; cur.clinica = cur.clinica || {};
          if (q.quitar) { await guardarAjuste('clinica-logo', null, yo.fields.Name); cur.clinica.logoV = 0; await guardarAjuste('config', cur, yo.fields.Name); return res.status(200).json({ ok: true, conf: await conf() }); }
          const d = String(q.data || '');
          if (!/^data:image\/(png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(d)) return res.status(400).json({ ok: false, error: 'La imagen no es válida' });
          if (d.length > 95000) return res.status(400).json({ ok: false, error: 'La imagen es demasiado grande' });
          await guardarAjuste('clinica-logo', { data: d }, yo.fields.Name); cur.clinica.logoV = Date.now() % 1e9; await guardarAjuste('config', cur, yo.fields.Name);
          return res.status(200).json({ ok: true, conf: await conf() });
        }
        if (action === 'seg-adm-config') { // guardar una parte de «Listas y ajustes»
          const sec = String(q.seccion || ''), v = q.valor || {}, cur = (await ajuste('config', null)) || {};
          const lim = (x, n) => String(x == null ? '' : x).trim().slice(0, n);
          const lista = (L, n) => [...new Set((Array.isArray(L) ? L : []).map(x => lim(x, n)).filter(Boolean))].slice(0, 60);
          if (sec === 'listas') {
            const conceptos = (Array.isArray(v.conceptos) ? v.conceptos : []).map(c => ({ n: lim(c && c.n, 80), p: c && c.p !== '' && c.p != null && !isNaN(Number(String(c.p).replace(',', '.'))) ? Number(String(c.p).replace(',', '.')) : '' })).filter(c => c.n).slice(0, 40);
            if (!conceptos.length) return res.status(400).json({ ok: false, error: 'Deja al menos un concepto' });
            const L = { conceptos, pagos: lista(v.pagos, 40), motivos: lista(v.motivos, 60), negocios: lista(v.negocios, 40), zonas: lista(v.zonas, 40), sesiones: v.sesiones === undefined ? ((cur.listas && cur.listas.sesiones) || CONF_DEF.listas.sesiones) : lista(v.sesiones, 60) };
            if (!L.pagos.length) return res.status(400).json({ ok: false, error: 'Deja al menos una forma de pago' });
            cur.listas = L;
          } else if (sec === 'tarjeta') {
            const imp = Math.round(Number(String(v.importe).replace(',', '.')) * 100) / 100, me = Math.round(Number(v.meses));
            if (!(imp > 0 && imp <= 200) || !(me >= 1 && me <= 36)) return res.status(400).json({ ok: false, error: 'Revisa el importe y los meses' });
            cur.tarjeta = { importe: imp, meses: me };
          } else if (sec === 'holded') cur.holded = { borrador: !!v.borrador, rgpd: lim(v.rgpd, 1500) || TEXTO_RGPD };
          else if (sec === 'clinica') { const L = MARCA.limpio, op = v.opciones || {};
            cur.clinica = { marca: L(v.marca, 40), razon: L(v.razon, 80), nif: L(v.nif, 20), direccion: L(v.direccion, 160), dirCorta: L(v.dirCorta, 100), zona: L(v.zona, 40), ciudad: L(v.ciudad, 40), tel: L(v.tel, 30), wa: String(v.wa || '').replace(/\D/g, '').slice(0, 15), email: L(v.email, 80), web: L(v.web, 80), googlePlace: L(v.googlePlace, 80).replace(/\s/g, ''), iban: L(v.iban, 40),
              opciones: { sorteo: op.sorteo !== false, bomba: op.bomba !== false }, color: /^#[0-9a-f]{6}$/i.test(String(v.color || '')) ? String(v.color).toLowerCase() : '', logoV: (cur.clinica && cur.clinica.logoV) || 0 }; }
          else if (sec === 'app') { // servicios, precios, packs y promociones de la app del paciente
            const num = x => { const n = Number(String(x == null ? '' : x).replace(',', '.')); return isFinite(n) && n >= 0 && n <= 100000 ? Math.round(n * 100) / 100 : null; };
            const servicios = (Array.isArray(v.servicios) ? v.servicios : []).map(x => ({ nombre: lim(x && x.nombre, 60), desc: lim(x && x.desc, 300), suelta: num(x && x.suelta) || 0,
              packs: (Array.isArray(x && x.packs) ? x.packs : []).map(p => [Math.round(num(p && p[0]) || 0), num(p && p[1]) || 0]).filter(p => p[0] >= 2 && p[1] > 0).slice(0, 6) })).filter(x => x.nombre).slice(0, 12);
            const fecha = x => /^\d{4}-\d{2}-\d{2}$/.test(String(x || '')) ? String(x) : '';
            const promos = (Array.isArray(v.promos) ? v.promos : []).map(x => { const a = String((x && x.accion) || ''); return { etiqueta: lim(x && x.etiqueta, 40), titulo: lim(x && x.titulo, 80), texto: lim(x && x.texto, 300), boton: lim(x && x.boton, 30),
              accion: /^(packs|reservar|chat)$/.test(a) ? a : /^https:\/\/[^\s"'<>]+$/.test(a) ? a.slice(0, 300) : '', color: x && x.color === 'Negro' ? 'Negro' : 'Naranja', desde: fecha(x && x.desde), hasta: fecha(x && x.hasta) }; }).filter(x => x.titulo).slice(0, 12);
            cur.app = { servicios, promos };
          }
          else if (sec === 'legal') { const L = {}; ['trat', 'decl', 'rgpd', 'der', 'sp', 'altaTrat'].forEach(k => { const t = String(v[k] == null ? '' : v[k]).replace(/\r/g, '').trim().slice(0, 12000); if (t && t !== LEGAL_TXT()[k]) L[k] = t; }); cur.legal = L; }
          else if (sec === 'plantillas') { const P = {}; Object.keys(v || {}).slice(0, 30).forEach(k => { if (!/^\w{1,20}$/.test(k)) return; const t = String(v[k] == null ? '' : v[k]).replace(/\r/g, '').trim().slice(0, 2000); if (t) P[k] = t; }); cur.plantillas = P; }
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
          const r = await altaAusencia(q.ausencia || {}, full.filter(x => x.fields && x.fields.Name).map(x => x.fields.Name), yo.fields.Name);
          if (!r.ok) return res.status(400).json(r);
          return res.status(200).json({ ok: true, bloqueados: r.bloqueados, conPaciente: r.conPaciente, ausencias: await ausencias().catch(() => []) });
        }
        if (action === 'seg-adm-ausencia-quitar-dia') { // vuelve a su horario normal un día concreto (si la ausencia es de varios días, se parte)
          if (!/^rec[A-Za-z0-9]{14}$/.test(q.id || '') || !/^\d{4}-\d{2}-\d{2}$/.test(q.fecha || '')) return res.status(400).json({ ok: false });
          const r = await at(`${AUS}/${q.id}`); if (r.error) return res.status(404).json({ ok: false, error: 'No encontrada' });
          const F = r.fields, d0 = F.DESDE, d1 = F.HASTA || F.DESDE, f = q.fecha, tipo = (F.TIPO && F.TIPO.name) || F.TIPO || '';
          const mvD = (x, n) => { const t = new Date(x + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
          if (f < d0 || f > d1) return res.status(400).json({ ok: false, error: 'Ese día no está en esta ausencia' });
          const nom = (a, b) => `${tipo} · ${F.FISIO} · ${a}${b !== a ? ' → ' + b : ''}${F['HORA DESDE'] ? ` · ${F['HORA DESDE']}-${F['HORA HASTA']}` : ''}`;
          if (d0 === d1) await at(`${AUS}/${q.id}`, { method: 'DELETE' });
          else if (f === d0) await at(`${AUS}/${q.id}`, { method: 'PATCH', body: JSON.stringify({ fields: { DESDE: mvD(f, 1), AUSENCIA: nom(mvD(f, 1), d1) } }) });
          else if (f === d1) await at(`${AUS}/${q.id}`, { method: 'PATCH', body: JSON.stringify({ fields: { HASTA: mvD(f, -1), AUSENCIA: nom(d0, mvD(f, -1)) } }) });
          else { await at(`${AUS}/${q.id}`, { method: 'PATCH', body: JSON.stringify({ fields: { HASTA: mvD(f, -1), AUSENCIA: nom(d0, mvD(f, -1)) } }) });
            const cp = { FISIO: F.FISIO, DESDE: mvD(f, 1), HASTA: d1, TIPO: tipo, NOTA: F.NOTA || '', 'CREADO POR': F['CREADO POR'] || '', 'HORA DESDE': F['HORA DESDE'] || '', 'HORA HASTA': F['HORA HASTA'] || '', AUSENCIA: nom(mvD(f, 1), d1) };
            await at(AUS, { method: 'POST', body: JSON.stringify({ records: [{ fields: cp }], typecast: true }) }); }
          _ausC = { t: 0, v: null };
          // Se vuelven a abrir los huecos que se bloquearon por esta ausencia ese día
          let abiertos = 0;
          if (tipo && !q.noAbrir) { const cond = [`DATETIME_FORMAT({FECHA},'YYYY-MM-DD')='${f}'`, `TRIM({ESTADO}&'')='CITA BLOQUEADA'`, `{NOTAS}='${String(tipo).replace(/'/g, '')}'`]; if (F.FISIO !== 'Toda la clínica') cond.push(`{PREF.}='${String(F.FISIO).replace(/'/g, '')}'`);
            const bl = await todosT(CIT, `filterByFormula=${encodeURIComponent(`AND(${cond.join(',')})`)}&fields[]=ESTADO`).catch(() => []);
            for (let i = 0; i < bl.length; i += 10) await at(CIT, { method: 'PATCH', body: JSON.stringify({ records: bl.slice(i, i + 10).map(x => ({ id: x.id, fields: { ESTADO: 'CITA LIBRE', NOTAS: '' } })), typecast: true }) });
            abiertos = bl.length; }
          return res.status(200).json({ ok: true, abiertos, ausencias: await ausencias().catch(() => []) });
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
          const cons = await consTodos(), pacsAll = await (async () => { if (_pacB.v && Date.now() - _pacB.t < 300000) return _pacB.v; if (!_pacB.p) _pacB.p = todosT(PACIENTES, 'fields[]=FULL NAME&fields[]=WHATSAPP&fields[]=TELF').then(v => { _pacB.v = v; _pacB.t = Date.now(); return v; }).finally(() => { _pacB.p = null; }); return _pacB.p; })();
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
            if (c.dias !== undefined) f['DIAS'] = lista(c.dias); if (c.franja !== undefined) f['FRANJA'] = lista(c.franja); if (c.horario !== undefined) f['HORARIO'] = (/^(\d{2}:\d{2})?-(\d{2}:\d{2})?$/.test(c.horario || '') && c.horario !== '-') || /^([A-Za-zÁÉÍÓÚáéíóú,]*=(\d{2}:\d{2})?-(\d{2}:\d{2})?)(\|[A-Za-zÁÉÍÓÚáéíóú,]*=(\d{2}:\d{2})?-(\d{2}:\d{2})?)*$/.test(c.horario || '') ? String(c.horario).slice(0, 500) : ''; if (c.estado !== undefined) f['ESTADO'] = c.estado || null;
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
        const CAMPOS_C = ['FECHA', 'HORA', 'ESTADO', 'PREF.', 'RELACIÓN - CITA', 'TIPO DE CITA', 'TIPO DE SESIÓN', 'NOTAS', 'CONFIR', 'RESERVA', 'PAGO ESTADO', 'PAGO IMPORTE', 'PAGO LÍMITE'].map(f => 'fields[]=' + encodeURIComponent(f)).join('&');
        const delDia = async (fecha) => todosT(CIT, `filterByFormula=${encodeURIComponent(`DATETIME_FORMAT({FECHA},'YYYY-MM-DD')='${fecha}'`)}&${CAMPOS_C}`);
        const enHora = (rows, hora, fisio) => rows.filter(r => hh(r.fields['HORA']) === hh(hora) && String(nmA(r.fields['PREF.'])).toLowerCase() === String(fisio).toLowerCase());
        const nueva = async (fecha, hora, fisio, extra) => { const d = await at(CIT, { method: 'POST', body: JSON.stringify({ records: [{ fields: Object.assign({ FECHA: fecha, HORA: hh(hora), 'PREF.': fisio }, extra) }], typecast: true }) }); if (d.error) throw new Error(d.error.message || 'No se ha podido crear'); return d.records[0]; };
        const patch = async (id, fields) => { const d = await at(`${CIT}/${id}`, { method: 'PATCH', body: JSON.stringify({ fields, typecast: true }) }); if (d.error) throw new Error(d.error.message || 'No se ha podido guardar'); return d; };
        // Bomba diamagnética: una sola máquina para 2 pacientes. Cuenta las citas activas con paciente a esa hora (todos los fisios) que no lleven «NO BOMBA»
        const bombaLlena = async (fecha, hora, excluirId) => {
          if (CLI.opciones && CLI.opciones.bomba === false) return null; // la clínica no trabaja con bomba
          const rows = (await delDia(fecha)).filter(r => hh(r.fields['HORA']) === hh(hora) && r.id !== excluirId && (r.fields['RELACIÓN - CITA'] || []).length && ACTIVA(String(nmA(r.fields['ESTADO']))));
          if (rows.length < 2) return null;
          const [nb] = await tiposDe(['NO BOMBA']);
          const con = rows.filter(r => !(r.fields['TIPO DE CITA'] || []).includes(nb));
          if (con.length < 2) return null;
          const L = [];
          for (const r of con.slice(0, 4)) { const pid = (r.fields['RELACIÓN - CITA'] || [])[0]; let n = ''; try { const p0 = await at(`${PACIENTES}/${pid}`); n = (p0.fields || {})['FULL NAME'] || ''; } catch (e) {} L.push({ p: n, f: nmA(r.fields['PREF.']) }); }
          return { ok: false, bomba: true, n: con.length, hora: hh(hora), con: L, error: `Ya hay ${con.length === 2 ? 'dos' : con.length} pacientes con bomba a las ${hh(hora)}` };
        };
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
          const soloPac = okId(q.pacienteId) ? `,FIND('${q.pacienteId}',ARRAYJOIN({PacienteRec}))` : ''; // ficha del paciente: solo sus citas
          const rows = await todosT(CIT, `filterByFormula=${encodeURIComponent(`AND({FECHA},NOT(IS_BEFORE({FECHA},DATETIME_PARSE('${q.desde}','YYYY-MM-DD'))),NOT(IS_AFTER({FECHA},DATETIME_PARSE('${hasta}','YYYY-MM-DD')))${soloPac})`)}&fields[]=FECHA&fields[]=HORA&fields[]=ESTADO&fields[]=${encodeURIComponent('RELACIÓN - CITA')}`);
          const numSes = {}, pago = {}; let inicio = '';
          try {
            const pv = [...new Set(rows.map(r => (r.fields['RELACIÓN - CITA'] || [])[0]).filter(Boolean))];
            if (pv.length && pv.length <= 160) {
              const conPago = q.pago === '1'; // «Pack 3/10, Suelta, Sin pagar»: desactivado en el panel de momento
              inicio = conPago ? await inicioControl().catch(() => '') : '';
              global._sesPac = global._sesPac || {}; const C = global._sesPac, ahora = Date.now(), falta = pv.filter(id => q.fresco || !C[id] || ahora - C[id].t > 3 * 60e3);
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
                  sesDe(r.fields).forEach(x => L[id].lotes.push({ f: r.fields['FECHA DE COBRO'] || r.fields['FECHA'] || '', n: x.n, precio: x.precio, num: r.fields['Nº FACTURA'] || '', fid: r.id })); });
                g.forEach(id => { L[id].citas.sort((a, b) => a.k.localeCompare(b.k)); C[id] = { t: ahora, v: L[id] }; }); }));
              // Packs compartidos: las citas que cubre el pack común salen como «Pack · X de N»; el resto se reparte con lo suyo
              let cubre = new Map(), quitarLote = {};
              if (inicio) try {
                const comp = await todosT(PACIENTES, `filterByFormula=${encodeURIComponent("{PACK COMPARTE}!=''")}&fields[]=${encodeURIComponent('PACK COMPARTE')}`);
                const S = {}; comp.forEach(p => pcLeer(p.fields['PACK COMPARTE']).forEach(x => { const k = x.t + '|' + x.f; (S[k] = S[k] || { t: x.t, f: x.f, n: Number(x.n) || 0, tot: Number(x.tot) || 0, off: Number(x.off) || 0, d: x.d || '', miembros: [x.t] }).miembros.push(p.id); }));
                const shares = Object.values(S).filter(x => x.n > 0 && x.miembros.some(m => pv.includes(m)));
                if (shares.length) {
                  const todas = await citasDeMiembros([...new Set(shares.flatMap(x => x.miembros))], ['REALIZADA', 'PENDIENTE', 'CITA PERDIDA'], shares.map(x => x.d || '').sort()[0] || '');
                  cubre = repartoCompartido(shares, todas);
                  shares.forEach(x => { (quitarLote[x.t] = quitarLote[x.t] || []).push(x.f); });
                }
              } catch (e) { console.log('agenda-compartido', e.message); }
              rows.forEach(r => { const pid = (r.fields['RELACIÓN - CITA'] || [])[0]; if (!pid || !C[pid]) return; const e = String(nmA(r.fields['ESTADO'])).trim().toUpperCase();
                if (/CANCELADA|REPROGRAMADA|NO ASIST/.test(e)) return; const k = String(r.fields.FECHA || '').slice(0, 10) + ' ' + hh(r.fields.HORA);
                const V = C[pid].v; numSes[r.id] = V.citas.filter(x => x.k < k && x.e !== 'CITA PERDIDA').length + 1;
                if (!inicio || k.slice(0, 10) < inicio) return; // antes de empezar a cobrar desde el panel no se sabe
                // Se gastan los pagos por orden (primero el más antiguo) con las citas desde el inicio del control, en orden
                if (cubre.has(r.id)) { const x = cubre.get(r.id); pago[r.id] = { t: 'pack', i: (x.off || 0) + x.orden.indexOf(r.id) + 1, n: x.tot || x.n, comp: true }; return; }
                const QL = quitarLote[pid] || [], LO = V.lotes.filter(l => !QL.some(f => f === 'previo' ? l.previo : l.fid === f));
                const gastan = V.citas.filter(x => x.k.slice(0, 10) >= inicio && !cubre.has(x.id)); let li = 0, usado = 0;
                for (const x of gastan) { while (li < LO.length && usado >= LO[li].n) { li++; usado = 0; }
                  if (x.id === r.id) { const lo = LO[li];
                    pago[r.id] = !lo ? { t: 'sin', fut: e === 'PENDIENTE' && k.slice(0, 10) >= hoyF } : lo.previo ? { t: 'previo', i: usado + 1 + (lo.off || 0), n: lo.tot || lo.n } : lo.n > 1 ? { t: 'pack', i: usado + 1, n: lo.n, v: Math.round(lo.precio * 100) / 100 } : { t: 'suelta', v: lo.precio };
                    break; }
                  if (li < LO.length) usado++; }
              });
            } } catch (e) { console.log('agenda-num', e.message); }
          return res.status(200).json({ ok: true, num: numSes, pago, inicio });
        }
        const packDe = async (pid, fecha, hora0) => {
          const inicio = await inicioControl().catch(() => '');
          if (!inicio) return { activo: false };
          const hora = okH(hora0) ? hh(hora0) : '23:59', clave = fecha + ' ' + hora;
          const [rs, fs, pr] = await Promise.all([
            todosT(CIT, `filterByFormula=${encodeURIComponent(`AND(OR(TRIM({ESTADO}&'')='REALIZADA',TRIM({ESTADO}&'')='PENDIENTE',TRIM({ESTADO}&'')='CITA PERDIDA'),FIND('${pid}',ARRAYJOIN({PacienteRec})),NOT(IS_BEFORE({FECHA},DATETIME_PARSE('${inicio}','YYYY-MM-DD'))))`)}&fields[]=FECHA&fields[]=HORA`),
            todosT(FACTURAS_TABLE, `filterByFormula=${encodeURIComponent(`AND({ESTADO}='Emitida',{PacienteId}='${pid}')`)}`).catch(() => []),
            at(`${PACIENTES}/${pid}`).catch(() => ({}))
          ]);
          const lotes = [], P = pr.fields || {}, nP = Number(P['SESIONES BONO PREVIO'] || 0), uP = Math.min(nP, Number(P['BONO PREVIO YA USADAS'] || 0));
          if (nP - uP > 0) lotes.push({ n: nP - uP, tot: nP, off: uP, previo: true });
          fs.sort((a, b) => String(a.fields['FECHA DE COBRO'] || a.fields['FECHA'] || '').localeCompare(String(b.fields['FECHA DE COBRO'] || b.fields['FECHA'] || ''))).forEach(r => {
            [[r.fields['CONCEPTO 1'], r.fields['Nº SESIONES 1']], [r.fields['CONCEPTO 2'], r.fields['Nº SESIONES 2']]].forEach(([c, n]) => { if (/^Sesi/i.test(nmA(c) || '') && Number(n) > 0) lotes.push({ n: Number(n), fid: r.id }); }); });
          let claves = rs.map(c => String(c.fields.FECHA || '').slice(0, 10) + ' ' + hh(c.fields.HORA)).filter(k => k !== clave);
          // Pack compartido: primero se gasta el pack común (citas de todos por orden de fecha); lo que no cubre va a lo suyo
          const shares = await compartidos(pid).catch(() => []);
          if (shares.length) {
            const todas = await citasDeMiembros([...new Set(shares.flatMap(x => x.miembros))], ['REALIZADA', 'PENDIENTE', 'CITA PERDIDA'], shares.map(x => x.d || '').sort()[0] || '').catch(() => []);
            const ya = todas.find(c => c.pid === pid && c.k === clave); if (!ya) todas.push({ id: '__nueva', pid, k: clave });
            const cubre = repartoCompartido(shares, todas), obj = ya ? ya.id : '__nueva';
            if (cubre.has(obj)) { const x = cubre.get(obj); return { activo: true, t: 'pack', i: (x.off || 0) + x.orden.indexOf(obj) + 1, n: x.tot || x.n, quedan: x.quedan, compartido: x.miembros.filter(m => m !== pid).map(m => x.nombres[m] || '') }; }
            const tapadas = new Set(todas.filter(c => c.pid === pid && cubre.has(c.id)).map(c => c.k));
            claves = claves.filter(k => !tapadas.has(k));
            shares.filter(x => x.t === pid).forEach(x => { const i = lotes.findIndex(l => x.f === 'previo' ? l.previo : l.fid === x.f); if (i >= 0) lotes.splice(i, 1); });
          }
          claves.push(clave); claves.sort();
          let li = 0, usado = 0, out = { t: 'sin' };
          for (const k of claves) { while (li < lotes.length && usado >= lotes[li].n) { li++; usado = 0; }
            if (k === clave) { const lo = lotes[li]; out = !lo ? { t: 'sin' } : lo.n > 1 || lo.previo ? { t: 'pack', i: usado + 1 + (lo.off || 0), n: lo.tot || lo.n } : { t: 'suelta' }; break; }
            if (li < lotes.length) usado++; }
          const total = lotes.reduce((t, l) => t + l.n, 0);
          return { activo: true, ...out, quedan: Math.max(0, total - claves.length) };
        };
        if (action === 'seg-agenda-pack-compartir') { // compartir el pack de un paciente (titular) con otro · op: quitar para dejar de compartir
          if (!okId(q.titular) || !okId(q.con) || q.titular === q.con) return res.status(400).json({ ok: false, error: 'Elige otro paciente' });
          const pc = await at(`${PACIENTES}/${q.con}`); if (pc.error) return res.status(404).json({ ok: false, error: 'Paciente no encontrado' });
          let L = pcLeer((pc.fields || {})['PACK COMPARTE']);
          if (q.op === 'quitar') { L = L.filter(x => x.t !== q.titular || (q.f && x.f !== q.f)); }
          else {
            const pt = await at(`${PACIENTES}/${q.titular}`); const T = pt.fields || {};
            if (pcLeer(T['PACK COMPARTE']).length) return res.status(200).json({ ok: false, error: 'Este paciente ya usa el pack de otra persona: compártelo desde la ficha de quien lo pagó' });
            const fs = await todosT(FACTURAS_TABLE, `filterByFormula=${encodeURIComponent(`AND({ESTADO}='Emitida',{PacienteId}='${q.titular}')`)}`).catch(() => []);
            const sesF = f => [[f['CONCEPTO 1'], f['Nº SESIONES 1']], [f['CONCEPTO 2'], f['Nº SESIONES 2']]].reduce((t, [c, n]) => t + (/^Sesi/i.test(nmA(c) || '') ? Number(n) || 0 : 0), 0);
            const pk = fs.filter(r => sesF(r.fields) > 1).sort((a, b) => String(b.fields['FECHA DE COBRO'] || b.fields['FECHA'] || '').localeCompare(String(a.fields['FECHA DE COBRO'] || a.fields['FECHA'] || '')))[0];
            const nP = Number(T['SESIONES BONO PREVIO'] || 0), uP = Math.min(nP, Number(T['BONO PREVIO YA USADAS'] || 0));
            const tt = Math.round(Number(q.total) || 0), us = Math.max(0, Math.round(Number(q.usadas) || 0)), qd = tt > 0 ? tt - us : Math.round(Number(q.quedan) || 0);
            if (tt > 0 && qd <= 0) return res.status(200).json({ ok: false, error: 'Si ya han usado todas, no queda pack que compartir' });
            // Pack cobrado fuera del panel: se dice cuántas sesiones le quedan y se comparten desde hoy
            const nuevo = qd > 0 && qd <= 60 ? { t: q.titular, f: 'ext' + Date.now(), n: qd, tot: tt > 0 ? tt : qd, off: tt > 0 ? us : 0, d: hoyF } : pk ? { t: q.titular, f: pk.id, n: sesF(pk.fields), d: String(pk.fields['FECHA DE COBRO'] || pk.fields['FECHA'] || hoyF).slice(0, 10) } : nP - uP > 1 ? { t: q.titular, f: 'previo', n: nP - uP, d: '' } : null;
            if (!nuevo) return res.status(200).json({ ok: false, sinPack: true, error: 'No tiene ningún pack cobrado desde el panel' });
            if (L.some(x => x.t === nuevo.t && x.f === nuevo.f)) return res.status(200).json({ ok: false, error: 'Ya lo comparten' });
            L.push(nuevo);
          }
          const d = await at(`${PACIENTES}/${q.con}`, { method: 'PATCH', body: JSON.stringify({ fields: { 'PACK COMPARTE': L.length ? JSON.stringify(L) : '' } }) });
          return res.status(200).json({ ok: !d.error, error: d.error && d.error.message });
        }
        if (action === 'seg-agenda-pack') {
          // Al dar una cita: qué sesión del pack sería (mismo reparto que la agenda: los pagos se gastan por orden de fecha)
          if (!okId(q.pacienteId) || !okF(q.fecha)) return res.status(400).json({ ok: false });
          return res.status(200).json({ ok: true, ...(await packDe(q.pacienteId, q.fecha, q.hora)) });
        }
        if (action === 'seg-agenda-recordatorios') {
          // Recordatorios por WhatsApp (en un toque): citas pendientes de las fechas pedidas, con teléfono y si ya se envió
          const fechas = String(q.fechas || '').split(',').filter(okF).slice(0, 4);
          if (!fechas.length) return res.status(400).json({ ok: false, error: 'Faltan las fechas' });
          const rows = await todosT(CIT, `filterByFormula=${encodeURIComponent(`AND(OR(${fechas.map(f => `DATETIME_FORMAT({FECHA},'YYYY-MM-DD')='${f}'`).join(',')}),FIND('PENDIENTE',UPPER({ESTADO}&'')))`)}&fields[]=FECHA&fields[]=HORA&fields[]=ESTADO&fields[]=PREF.&fields[]=${encodeURIComponent('RELACIÓN - CITA')}&fields[]=${encodeURIComponent('RECORDATORIO ENVIADO')}&fields[]=${encodeURIComponent('RECORDATORIO POR')}&fields[]=${encodeURIComponent('2º AVISO ENVIADO')}&fields[]=${encodeURIComponent('2º AVISO POR')}&fields[]=CONFIR`);
          const pids = [...new Set(rows.flatMap(r => r.fields['RELACIÓN - CITA'] || []))], pac = {}, acc = {};
          for (let i = 0; i < pids.length; i += 50) (await todosT(PACIENTES, `filterByFormula=${encodeURIComponent('OR(' + pids.slice(i, i + 50).map(x => `RECORD_ID()='${x}'`).join(',') + ')')}&fields[]=${encodeURIComponent('FULL NAME')}&fields[]=NOMBRE&fields[]=WHATSAPP&fields[]=TELF&fields[]=EMAIL&fields[]=PIN&fields[]=${encodeURIComponent('APP INSTALADA')}&fields[]=PushSubscription`)).forEach(p => { pac[p.id] = { nombre: p.fields['FULL NAME'] || '', pila: p.fields['NOMBRE'] || '', tel: p.fields['WHATSAPP'] || p.fields['TELF'] || '' }; acc[p.id] = { app: !!(p.fields['APP INSTALADA'] || p.fields['PushSubscription']), pin: String(p.fields['PIN'] || '').trim(), email: String(p.fields['EMAIL'] || '').trim() }; });
          const nmR = v => (v && typeof v === 'object') ? (v.name || '') : (v || '');
          const citas = rows.map(r => { const F = r.fields, pid = (F['RELACIÓN - CITA'] || [])[0] || ''; return { id: r.id, fecha: String(F['FECHA'] || '').slice(0, 10), hora: String(F['HORA'] || '').replace(/^(\d):/, '0$1:').slice(0, 5), fisio: nmR(F['PREF.']), pacienteId: pid, ...(pac[pid] || { nombre: '', pila: '', tel: '' }), enviado: F['RECORDATORIO ENVIADO'] || '', por: F['RECORDATORIO POR'] || '', aviso2: F['2º AVISO ENVIADO'] || '', por2: F['2º AVISO POR'] || '', link: enlaceConfirmar(r.id), confirmada: (F['CONFIR'] || []).some(x => /CONFIRMADA/i.test(x.name || x)) }; })
            .filter(c => c.pacienteId).sort((a, b) => (a.fecha + a.hora).localeCompare(b.fecha + b.hora));
          // Primera visita sin consentimiento: el mensaje lleva también el enlace del consentimiento informado
          const pide = await pidenConsentimiento(citas.map(c => c.pacienteId), fechas.slice().sort()[0]).catch(() => new Set());
          citas.forEach(c => { if (pide.has(c.pacienteId)) { c.primera = true; c.consent = CONSENT_URL; } });
          // Ya ha venido alguna vez y nunca ha entrado en la app: el mensaje lleva también cómo entrar (se le pone PIN si no tiene)
          const ya = pide.yaVino || new Set(), nuevosPin = [];
          // Lo que cuenta es que la tenga INSTALADA (se detecta al abrirla desde la pantalla de inicio, o se marca a mano en la ficha)
          citas.forEach(c => { const a = acc[c.pacienteId]; if (!a || a.app || !ya.has(c.pacienteId)) return; const t = String(c.tel || '').replace(/\D/g, '').slice(-9);
            if (!a.email && t.length < 9) return; if (!a.pin) { a.pin = nuevoPin(); nuevosPin.push([c.pacienteId, a.pin]); }
            c.app = { url: 'https://app.fisioterapia365.com', usuario: a.email || t, pin: a.pin }; });
          // ¿Ya tiene ejercicios puestos? (cambia cómo se le cuenta la app)
          const conApp = [...new Set(citas.filter(c => c.app).map(c => c.pacienteId))];
          if (conApp.length) { const pl = await todosT('tblvgE0a4gsrj4Vhp', `filterByFormula=${encodeURIComponent(`AND(LEN({Ejercicios}&'')>2,OR(${conApp.slice(0, 60).map(id => `{PacienteID}='${id}'`).join(',')}))`)}&fields[]=PacienteID`).catch(() => []);
            const conEj = new Set(pl.map(r => String(r.fields['PacienteID'] || ''))); citas.forEach(c => { if (c.app) c.app.ejercicios = conEj.has(c.pacienteId); }); }
          for (const [id, pin] of [...new Map(nuevosPin)].slice(0, 30)) await at(`${PACIENTES}/${id}`, { method: 'PATCH', body: JSON.stringify({ fields: { PIN: pin } }) }).catch(() => {});
          return res.status(200).json({ ok: true, hoy: hoyF, citas });
        }
        if (action === 'seg-agenda-pagos') { // pestaña «Pagos» de Mensajes: a quién hay que mandar el enlace, quién no ha pagado aún, transferencias por mirar
          await caducarPagos().catch(() => 0);
          const nmP = v => (v && typeof v === 'object') ? (v.name || '') : (v || '');
          const [marc, cits] = await Promise.all([
            todosT(PACIENTES, `filterByFormula=${encodeURIComponent('{PAGO ADELANTADO}')}&fields[]=${encodeURIComponent('FULL NAME')}&fields[]=NOMBRE&fields[]=WHATSAPP&fields[]=TELF&fields[]=${encodeURIComponent('PAGO ADELANTADO MOTIVO')}`),
            todosT(CIT, `filterByFormula=${encodeURIComponent(`AND(NOT(IS_BEFORE({FECHA},'${hoyF}')),IS_BEFORE({FECHA},DATEADD(TODAY(),90,'days')),LEN(ARRAYJOIN({RELACIÓN - CITA}))>0,NOT(FIND('CANCEL',UPPER({ESTADO}&''))))`)}&fields[]=FECHA&fields[]=HORA&fields[]=${encodeURIComponent('PREF.')}&fields[]=ESTADO&fields[]=${encodeURIComponent('RELACIÓN - CITA')}&fields[]=${encodeURIComponent('PAGO ESTADO')}&fields[]=${encodeURIComponent('PAGO IMPORTE')}&fields[]=${encodeURIComponent('PAGO LÍMITE')}`)]);
          const cita = r => { const F = r.fields; return { id: r.id, estado: nmP(F.ESTADO), pacienteId: (F['RELACIÓN - CITA'] || [])[0] || '', fecha: String(F.FECHA || '').slice(0, 10), hora: hh(F.HORA), fisio: nmP(F['PREF.']), pago: nmP(F['PAGO ESTADO']) ? { estado: nmP(F['PAGO ESTADO']), importe: F['PAGO IMPORTE'] || 0, limite: F['PAGO LÍMITE'] || '', link: enlacePago(r.id) } : null }; };
          const ahoraMs = Date.now(), CL = cits.map(cita).filter(c => c.pacienteId && !/LIBRE|ASISTI|PERDIDA|REALIZADA/i.test(c.estado || '') && madridUTC(c.fecha, c.hora || '00:00').getTime() > ahoraMs).sort((a, b) => (a.fecha + a.hora).localeCompare(b.fecha + b.hora));
          const pInfo = {}; marc.forEach(p => { pInfo[p.id] = p.fields; });
          const faltan = [...new Set(CL.filter(c => c.pago && /PENDIENTE|TRANSFER/.test(c.pago.estado) && !pInfo[c.pacienteId]).map(c => c.pacienteId))];
          for (let i = 0; i < faltan.length; i += 40) (await todosT(PACIENTES, `filterByFormula=${encodeURIComponent('OR(' + faltan.slice(i, i + 40).map(x => `RECORD_ID()='${x}'`).join(',') + ')')}&fields[]=${encodeURIComponent('FULL NAME')}&fields[]=NOMBRE&fields[]=WHATSAPP&fields[]=TELF`)).forEach(p => { pInfo[p.id] = p.fields; });
          const pac = id => { const F = pInfo[id] || {}; return { pacienteId: id, nombre: F['FULL NAME'] || '', pila: F['NOMBRE'] || '', tel: F['WHATSAPP'] || F['TELF'] || '' }; };
          const lista = [], vistos = new Set();
          CL.filter(c => c.pago && /PENDIENTE|TRANSFER/.test(c.pago.estado)).forEach(c => { vistos.add(c.pacienteId); lista.push({ tipo: /TRANSFER/.test(c.pago.estado) ? 'transfer' : 'pendiente', ...pac(c.pacienteId), cita: c }); });
          marc.forEach(p => { if (vistos.has(p.id)) return; const prox = CL.find(c => c.pacienteId === p.id && !(c.pago && c.pago.estado === 'PAGADO'));
            lista.push({ tipo: prox ? 'enviar' : 'sincita', ...pac(p.id), motivo: p.fields['PAGO ADELANTADO MOTIVO'] || '', cita: prox || null }); });
          const ord = { transfer: 0, enviar: 1, pendiente: 2, sincita: 3 };
          lista.sort((a, b) => ord[a.tipo] - ord[b.tipo] || ((a.cita ? a.cita.fecha + a.cita.hora : '9') + a.nombre).localeCompare((b.cita ? b.cita.fecha + b.cita.hora : '9') + b.nombre));
          return res.status(200).json({ ok: true, lista, aviso: lista.filter(x => x.tipo === 'enviar' || x.tipo === 'transfer').length });
        }
        if (action === 'seg-agenda-altas') { // encuesta de alta: pacientes con el alta apuntada los últimos 30 días
          const ps = await todosT(PACIENTES, `filterByFormula=${encodeURIComponent(`AND({POR QUÉ FECHA},IS_AFTER({POR QUÉ FECHA},DATEADD(TODAY(),-31,'days')),FIND('ALTA',UPPER(ARRAYJOIN({ESTADO}))))`)}&fields[]=${encodeURIComponent('FULL NAME')}&fields[]=NOMBRE&fields[]=WHATSAPP&fields[]=TELF&fields[]=${encodeURIComponent('POR QUÉ FECHA')}&fields[]=${encodeURIComponent('POR QUÉ FISIO')}&fields[]=${encodeURIComponent('FIN ENVIADA')}&fields[]=${encodeURIComponent('FIN VALORACIÓN')}&fields[]=${encodeURIComponent('FIN COMENTARIO')}&fields[]=${encodeURIComponent('FIN IR A RESEÑA')}&fields[]=${encodeURIComponent('FIN FISIO')}&fields[]=${encodeURIComponent('FIN QUITADA')}`);
          const nmA = v => (v && typeof v === 'object') ? (v.name || '') : (v || '');
          const lista = ps.filter(p => !(p.fields['FIN QUITADA'] && String(p.fields['FIN QUITADA']).slice(0, 10) >= String(p.fields['POR QUÉ FECHA'] || '').slice(0, 10))).map(p => { const F = p.fields, alta = String(F['POR QUÉ FECHA'] || '').slice(0, 10), env = F['FIN ENVIADA'] && String(F['FIN ENVIADA']).slice(0, 10) >= alta ? F['FIN ENVIADA'] : '';
            return { pacienteId: p.id, nombre: F['FULL NAME'] || '', pila: F['NOMBRE'] || '', tel: F['WHATSAPP'] || F['TELF'] || '', alta, fisio: F['FIN FISIO'] || F['POR QUÉ FISIO'] || '', enviado: env, valoracion: env ? nmA(F['FIN VALORACIÓN']) : '', comentario: env ? (F['FIN COMENTARIO'] || '') : '', resena: !!(env && F['FIN IR A RESEÑA']) }; })
            .sort((a, b) => b.alta.localeCompare(a.alta) || a.nombre.localeCompare(b.nombre));
          return res.status(200).json({ ok: true, pacientes: lista });
        }
        if (action === 'seg-agenda-fin-quitar') { // Alta: quitar de la lista (ya enviada por otro lado, ya dejó reseña o no hace falta)
          if (!okId(q.pacienteId)) return res.status(400).json({ ok: false });
          const d = await at(`${PACIENTES}/${q.pacienteId}`, { method: 'PATCH', body: JSON.stringify({ fields: { 'FIN QUITADA': q.volver ? null : new Date().toISOString() } }) });
          return res.status(200).json({ ok: !d.error });
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
        if (action === 'seg-agenda-ejpend') {
          // Ejercicios pendientes de grabar: cualquiera propone; quien tiene un rato, lo graba
          const EP = 'tblTL6et3dRyod8TZ', op = String(q.op || 'lista'), ahora = new Date().toISOString(), txt = (v, n) => String(v || '').trim().slice(0, n);
          if (op === 'crear') {
            const nombre = txt(q.nombre, 120); if (nombre.length < 2) return res.status(400).json({ ok: false, error: 'Pon el nombre del ejercicio' });
            const d = await at(EP, { method: 'POST', body: JSON.stringify({ records: [{ fields: { NOMBRE: nombre, ZONA: txt(q.zona, 60), NOTAS: txt(q.notas, 2000), 'PROPUESTO POR': txt(q.quien, 60), ESTADO: 'PENDIENTE', 'FECHA ESTADO': ahora } }], typecast: true }) });
            return res.status(200).json({ ok: !d.error });
          }
          if (op === 'estado' || op === 'borrar') {
            if (!okId(q.id)) return res.status(400).json({ ok: false });
            if (op === 'borrar') { const d = await at(`${EP}/${q.id}`, { method: 'DELETE' }); return res.status(200).json({ ok: !d.error }); }
            const est = ['PENDIENTE', 'GRABANDO', 'GRABADO'].includes(q.estado) ? q.estado : 'PENDIENTE';
            const d = await at(`${EP}/${q.id}`, { method: 'PATCH', body: JSON.stringify({ fields: { ESTADO: est, GRABA: est === 'PENDIENTE' ? '' : txt(q.quien, 60), 'FECHA ESTADO': ahora }, typecast: true }) });
            return res.status(200).json({ ok: !d.error });
          }
          const rs = await todosT(EP, `filterByFormula=${encodeURIComponent(`OR({ESTADO}!='GRABADO',IS_AFTER({FECHA ESTADO},DATEADD(NOW(),-30,'days')))`)}`);
          return res.status(200).json({ ok: true, lista: rs.map(r => ({ id: r.id, nombre: r.fields.NOMBRE || '', zona: r.fields.ZONA || '', notas: r.fields.NOTAS || '', quien: r.fields['PROPUESTO POR'] || '', estado: nmA(r.fields.ESTADO) || 'PENDIENTE', graba: r.fields.GRABA || '', fecha: r.fields['FECHA ESTADO'] || r.createdTime, creado: r.createdTime })) });
        }
        if (action === 'seg-agenda-app-enlace') {
          if (!/^rec[A-Za-z0-9]{14}$/.test(q.pacienteId || '')) return res.status(400).json({ ok: false, error: 'Falta el paciente' });
          return res.status(200).json({ ok: true, url: enlaceApp(q.pacienteId) });
        }
        if (action === 'seg-agenda-huecos-enlace') {
          if (!okF(q.desde) || !okF(q.hasta)) return res.status(400).json({ ok: false, error: 'Faltan las fechas' });
          const f = String(q.fisios || '').split(',').map(x => x.trim()).filter(x => x && x.length < 40);
          const pg = Math.round(Number(String(q.pago || '').replace(',', '.')) * 100) / 100;
          return res.status(200).json({ ok: true, url: huecosEnlace(q.desde, q.hasta, f, pg >= 1 && pg <= 2000 ? pg : 0) });
        }
        if (action === 'seg-agenda-val-fisios') { // Valoraciones por fisio de un mes (solo dirección lo ve en el panel)
          const mes = /^\d{4}-\d{2}$/.test(q.mes || '') ? q.mes : hoyF.slice(0, 7), enMes = c => `DATETIME_FORMAT(SET_TIMEZONE({${c}},'Europe/Madrid'),'YYYY-MM')='${mes}'`;
          const nmV = v => (v && typeof v === 'object') ? (v.name || '') : (v || ''), k = f => String(nmV(f) || '').trim().split(' ')[0].toLowerCase();
          const [c1, c2, c3] = await Promise.all([
            todosT(CIT, `filterByFormula=${encodeURIComponent(`AND({ENCUESTA RESPONDIDA},${enMes('ENCUESTA RESPONDIDA')})`)}&fields[]=${encodeURIComponent('PREF.')}&fields[]=${encodeURIComponent('ENCUESTA VALORACIÓN')}&fields[]=${encodeURIComponent('ENCUESTA IR A RESEÑA')}`).catch(() => []),
            todosT(PACIENTES, `filterByFormula=${encodeURIComponent(`AND({FIN RESPONDIDA},${enMes('FIN RESPONDIDA')})`)}&fields[]=${encodeURIComponent('FIN FISIO')}&fields[]=${encodeURIComponent('FIN VALORACIÓN')}&fields[]=${encodeURIComponent('FIN IR A RESEÑA')}`).catch(() => []),
            todosT(PACIENTES, `filterByFormula=${encodeURIComponent(`AND({MEJORA FECHA},${enMes('MEJORA FECHA')})`)}&fields[]=${encodeURIComponent('MEJORA FISIO')}&fields[]=${encodeURIComponent('MEJORA GOOGLE')}`).catch(() => [])]);
          const T = {}, de = f => { const x = k(f) || '—'; return (T[x] = T[x] || { fisio: x, enc: 0, exc: 0, mb: 0, mal: 0, google: 0, mej: 0, mejG: 0 }); };
          const suma = (f, v, g) => { const x = de(f); x.enc++; if (v === 'Excelente') x.exc++; else if (v === 'Muy buena') x.mb++; else if (v) x.mal++; if (g) x.google++; };
          c1.forEach(r => { const v = nmV(r.fields['ENCUESTA VALORACIÓN']); if (v) suma(r.fields['PREF.'], v, r.fields['ENCUESTA IR A RESEÑA']); });
          c2.forEach(r => { const v = nmV(r.fields['FIN VALORACIÓN']); if (v) suma(r.fields['FIN FISIO'], v, r.fields['FIN IR A RESEÑA']); });
          c3.forEach(r => { const x = de(r.fields['MEJORA FISIO']); x.mej++; if (r.fields['MEJORA GOOGLE']) x.mejG++; });
          return res.status(200).json({ ok: true, mes, fisios: Object.values(T).filter(x => x.fisio !== '—' || x.enc || x.mej).sort((a, b) => (b.enc + b.mej) - (a.enc + a.mej)) });
        }
        if (action === 'seg-agenda-sorteo') { // Sorteo mensual de 2 sesiones entre quienes han ido a dejar su reseña en Google desde nuestros enlaces
          const mes = /^\d{4}-\d{2}$/.test(q.mes || '') ? q.mes : hoyF.slice(0, 7), enMes = c => `DATETIME_FORMAT(SET_TIMEZONE({${c}},'Europe/Madrid'),'YYYY-MM')='${mes}'`, clave = 'sorteo-' + mes;
          const [c1, c2] = await Promise.all([
            todosT(CIT, `filterByFormula=${encodeURIComponent(`AND({ENCUESTA IR A RESEÑA},${enMes('ENCUESTA IR A RESEÑA')})`)}&fields[]=${encodeURIComponent('RELACIÓN - CITA')}&fields[]=${encodeURIComponent('ENCUESTA IR A RESEÑA')}`).catch(() => []),
            todosT(PACIENTES, `filterByFormula=${encodeURIComponent(`OR(AND({FIN IR A RESEÑA},${enMes('FIN IR A RESEÑA')}),AND({MEJORA GOOGLE},${enMes('MEJORA GOOGLE')}))`)}&fields[]=${encodeURIComponent('FULL NAME')}&fields[]=NOMBRE&fields[]=WHATSAPP&fields[]=TELF&fields[]=${encodeURIComponent('FIN IR A RESEÑA')}&fields[]=${encodeURIComponent('MEJORA GOOGLE')}`).catch(() => [])]);
          const P = {}, pon = (id, f, cuando) => { if (!okId(id)) return; const x = P[id] = P[id] || { pacienteId: id, nombre: '', pila: '', tel: '', fecha: '' }; if (f) Object.assign(x, { nombre: String(f['FULL NAME'] || '').trim(), pila: String(f['NOMBRE'] || '').trim(), tel: f['WHATSAPP'] || f['TELF'] || '' }); const d = String(cuando || '').slice(0, 10); if (d && (!x.fecha || d < x.fecha)) x.fecha = d; };
          c2.forEach(r => pon(r.id, r.fields, [r.fields['FIN IR A RESEÑA'], r.fields['MEJORA GOOGLE']].filter(Boolean).sort()[0]));
          c1.forEach(r => pon((r.fields['RELACIÓN - CITA'] || [])[0], null, r.fields['ENCUESTA IR A RESEÑA']));
          const falta = Object.values(P).filter(x => !x.nombre).map(x => x.pacienteId);
          for (let i = 0; i < falta.length; i += 40) { const l = falta.slice(i, i + 40); const d = await todosT(PACIENTES, `filterByFormula=${encodeURIComponent(`OR(${l.map(id => `RECORD_ID()='${id}'`).join(',')})`)}&fields[]=${encodeURIComponent('FULL NAME')}&fields[]=NOMBRE&fields[]=WHATSAPP&fields[]=TELF`).catch(() => []); d.forEach(r => pon(r.id, r.fields)); }
          const lista = Object.values(P).filter(x => x.nombre).sort((a, b) => a.fecha.localeCompare(b.fecha));
          let gan = await ajuste(clave, {}) || {};
          if (q.op === 'azar' || q.op === 'elegir' || q.op === 'quitar') {
            const tipo = q.tipo === 'creativa' ? 'creativa' : 'azar', quien = String(q.quien || '').slice(0, 40);
            if (q.op === 'quitar') delete gan[tipo];
            else {
              let w = null;
              if (q.op === 'azar') { const otro = gan.creativa && gan.creativa.pacienteId, pool = lista.filter(x => x.pacienteId !== otro && x.pacienteId !== (gan.azar && gan.azar.pacienteId)); const base = pool.length ? pool : lista.filter(x => x.pacienteId !== otro); if (!base.length) return res.status(400).json({ ok: false, error: 'Todavía no hay nadie en el sorteo este mes' }); w = base[require('crypto').randomInt(base.length)]; }
              else { w = lista.find(x => x.pacienteId === q.pacienteId); if (!w) return res.status(400).json({ ok: false, error: 'Ese paciente no está en el sorteo de este mes' }); }
              gan[tipo] = { pacienteId: w.pacienteId, nombre: w.nombre, pila: w.pila, tel: w.tel, cuando: new Date().toISOString(), quien };
            }
            await guardarAjuste(clave, gan, quien);
          }
          return res.status(200).json({ ok: true, mes, participantes: lista, ganadores: gan });
        }
        if (action === 'seg-agenda-val-quitar') { // quitar una fila de Valoraciones («Está mejor» marcado por error, o una encuesta que no hace falta ver)
          const id = String(q.id || ''), pid = String(q.pacienteId || '');
          if (q.tipo === 'mejora') { if (!okId(pid)) return res.status(400).json({ ok: false }); const d = await at(`${PACIENTES}/${pid}`, { method: 'PATCH', body: JSON.stringify({ fields: { 'MEJORA FECHA': null, 'MEJORA FISIO': '', 'MEJORA ABIERTA': null, 'MEJORA GOOGLE': null } }) }); return res.status(200).json({ ok: !d.error }); }
          if (!okId(id)) return res.status(400).json({ ok: false });
          const oc = (await ajuste('val-ocultas', [])) || []; if (!oc.includes(id)) oc.push(id);
          await guardarAjuste('val-ocultas', oc.slice(-400), String(q.quien || '').slice(0, 40)); return res.status(200).json({ ok: true });
        }
        if (action === 'seg-agenda-enc-nuevas') {
          // Respuestas a la encuesta de primera visita de los últimos 14 días (para los avisos dentro del panel)
          const rows = await todosT(CIT, `filterByFormula=${encodeURIComponent(`AND({ENCUESTA RESPONDIDA},IS_AFTER({ENCUESTA RESPONDIDA},DATEADD(NOW(),-14,'days')))`)}&fields[]=FECHA&fields[]=PREF.&fields[]=${encodeURIComponent('RELACIÓN - CITA')}&fields[]=${encodeURIComponent('ENCUESTA VALORACIÓN')}&fields[]=${encodeURIComponent('ENCUESTA COMENTARIO')}&fields[]=${encodeURIComponent('ENCUESTA IR A RESEÑA')}&fields[]=${encodeURIComponent('ENCUESTA RESPONDIDA')}`);
          const pids = [...new Set(rows.flatMap(r => r.fields['RELACIÓN - CITA'] || []))], nom = {};
          const inf = {}; for (let i = 0; i < pids.length; i += 40) (await todosT(PACIENTES, `filterByFormula=${encodeURIComponent('OR(' + pids.slice(i, i + 40).map(x => `RECORD_ID()='${x}'`).join(',') + ')')}&fields[]=${encodeURIComponent('FULL NAME')}&fields[]=NOMBRE&fields[]=WHATSAPP&fields[]=TELF`)).forEach(p => { nom[p.id] = p.fields['FULL NAME'] || ''; inf[p.id] = { pila: p.fields['NOMBRE'] || '', tel: p.fields['WHATSAPP'] || p.fields['TELF'] || '' }; });
          const nmE = v => (v && typeof v === 'object') ? (v.name || '') : (v || '');
          const lista = rows.map(r => { const F = r.fields, pid = (F['RELACIÓN - CITA'] || [])[0] || ''; return { id: r.id, pacienteId: pid, pila: (inf[pid] || {}).pila || '', tel: (inf[pid] || {}).tel || '', fecha: String(F['FECHA'] || '').slice(0, 10), fisio: nmE(F['PREF.']), nombre: nom[pid] || '', valoracion: nmE(F['ENCUESTA VALORACIÓN']), comentario: F['ENCUESTA COMENTARIO'] || '', resena: F['ENCUESTA IR A RESEÑA'] || '', respondida: F['ENCUESTA RESPONDIDA'] || '' }; })
            .filter(x => x.valoracion);
          const fins = await todosT(PACIENTES, `filterByFormula=${encodeURIComponent(`AND({FIN RESPONDIDA},IS_AFTER({FIN RESPONDIDA},DATEADD(NOW(),-14,'days')))`)}&fields[]=${encodeURIComponent('FULL NAME')}&fields[]=${encodeURIComponent('FIN FISIO')}&fields[]=${encodeURIComponent('FIN VALORACIÓN')}&fields[]=${encodeURIComponent('FIN COMENTARIO')}&fields[]=${encodeURIComponent('FIN IR A RESEÑA')}&fields[]=${encodeURIComponent('FIN RESPONDIDA')}&fields[]=NOMBRE&fields[]=WHATSAPP&fields[]=TELF`).catch(() => []);
          fins.forEach(p => { const F = p.fields; lista.push({ id: p.id, pacienteId: p.id, pila: F['NOMBRE'] || '', tel: F['WHATSAPP'] || F['TELF'] || '', tipo: 'fin', fecha: String(F['FIN RESPONDIDA'] || '').slice(0, 10), fisio: F['FIN FISIO'] || '', nombre: F['FULL NAME'] || '', valoracion: nmE(F['FIN VALORACIÓN']), comentario: F['FIN COMENTARIO'] || '', resena: F['FIN IR A RESEÑA'] || '', respondida: F['FIN RESPONDIDA'] || '' }); });
          // «Está mejor» (botón de la historia clínica): quién lo marcó, si abrió el enlace y si fue a Google
          const mej = await todosT(PACIENTES, `filterByFormula=${encodeURIComponent(`AND({MEJORA FECHA},IS_AFTER({MEJORA FECHA},DATEADD(NOW(),-14,'days')))`)}&fields[]=${encodeURIComponent('FULL NAME')}&fields[]=NOMBRE&fields[]=WHATSAPP&fields[]=TELF&fields[]=${encodeURIComponent('MEJORA FECHA')}&fields[]=${encodeURIComponent('MEJORA FISIO')}&fields[]=${encodeURIComponent('MEJORA ABIERTA')}&fields[]=${encodeURIComponent('MEJORA GOOGLE')}`).catch(() => []);
          mej.forEach(p => { const F = p.fields; lista.push({ id: 'm' + p.id, pacienteId: p.id, tipo: 'mejora', pila: F['NOMBRE'] || '', tel: F['WHATSAPP'] || F['TELF'] || '', fecha: String(F['MEJORA FECHA'] || '').slice(0, 10), fisio: F['MEJORA FISIO'] || '', nombre: F['FULL NAME'] || '', valoracion: 'Está mejor', comentario: '', abierta: F['MEJORA ABIERTA'] || '', resena: F['MEJORA GOOGLE'] || '', respondida: F['MEJORA GOOGLE'] || F['MEJORA ABIERTA'] || F['MEJORA FECHA'] || '' }); });
          lista.sort((a, b) => String(b.respondida).localeCompare(String(a.respondida)));
          const ocV = new Set((await ajuste('val-ocultas', [])) || []);
          return res.status(200).json({ ok: true, lista: lista.filter(x => x.valoracion && !ocV.has(x.id)) });
        }
        if (action === 'seg-agenda-encuestas') {
          // Encuesta de satisfacción: pacientes cuya PRIMERA sesión realizada fue ese día
          const fecha = okF(q.fecha) ? q.fecha : hoyF;
          const rows = await todosT(CIT, `filterByFormula=${encodeURIComponent(`AND(DATETIME_FORMAT({FECHA},'YYYY-MM-DD')='${fecha}',TRIM({ESTADO})='REALIZADA')`)}&fields[]=FECHA&fields[]=HORA&fields[]=PREF.&fields[]=${encodeURIComponent('RELACIÓN - CITA')}&fields[]=${encodeURIComponent('ENCUESTA ENVIADA')}&fields[]=${encodeURIComponent('ENCUESTA VALORACIÓN')}&fields[]=${encodeURIComponent('ENCUESTA COMENTARIO')}&fields[]=${encodeURIComponent('ENCUESTA IR A RESEÑA')}`);
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
          const lista = rows.map(r => { const F = r.fields, pid = (F['RELACIÓN - CITA'] || [])[0] || ''; return { id: r.id, fecha, hora: String(F['HORA'] || '').replace(/^(\d):/, '0$1:').slice(0, 5), fisio: nmE(F['PREF.']), pacienteId: pid, ...(pac[pid] || { nombre: '', pila: '', tel: '' }), enviado: F['ENCUESTA ENVIADA'] || '', encLink: enlaceEncuesta(r.id), valoracion: nmE(F['ENCUESTA VALORACIÓN']), comentario: F['ENCUESTA COMENTARIO'] || '', resena: !!F['ENCUESTA IR A RESEÑA'] }; })
            .filter(c => c.pacienteId && !antes.has(c.pacienteId) && !vistos.has(c.pacienteId) && vistos.add(c.pacienteId)).sort((a, b) => a.hora.localeCompare(b.hora));
          return res.status(200).json({ ok: true, hoy: hoyF, fecha, citas: lista });
        }
        if (action === 'seg-agenda-dia') {
          await Promise.all([procesarWeb().catch(() => {}), revisarPorReagendar().catch(() => 0), caducarPagos().catch(() => 0)]);
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
          const debenPagar = {}; if (pids.length) (await todosT(PACIENTES, `filterByFormula=${encodeURIComponent('{PAGO ADELANTADO}')}&fields[]=${encodeURIComponent('PAGO ADELANTADO MOTIVO')}`).catch(() => [])).forEach(p => { if (pids.includes(p.id)) debenPagar[p.id] = p.fields['PAGO ADELANTADO MOTIVO'] || 'Paga por adelantado'; });

          return res.status(200).json({ ok: true, hoy: hoyF, limitado, debenPagar, ausencias: ausDia, alertas: alertasDia, sinConsent, espera: (esperaTodos || []).filter(e => e.estado === 'ESPERANDO').map(e => ({ id: e.id, tabla: e.tabla, nombre: e.nombre, tel: e.tel, dias: e.dias, franja: e.franja, horario: e.horario || '', nopuede: e.nopuede || '', ofrecido: e.ofrecido || '', fisio: e.fisio, disp: e.disp, nota: e.nota, fecha: e.fecha, pacienteId: e.pacienteId, aviso: e.aviso || '' })), citas: rows.map(r => { const F = r.fields; const pid = (F['RELACIÓN - CITA'] || [])[0] || ''; return { id: r.id, pago: nmA(F['PAGO ESTADO']) ? { estado: nmA(F['PAGO ESTADO']), importe: F['PAGO IMPORTE'] || 0, limite: F['PAGO LÍMITE'] || '', link: enlacePago(r.id) } : null, fecha: String(F['FECHA'] || '').slice(0, 10), hora: hh(F['HORA']), estado: String(nmA(F['ESTADO'])).trim(), fisio: nmA(F['PREF.']), pacienteId: pid, paciente: pid ? (nomP[pid] || '') : '', tipos: (F['TIPO DE CITA'] || []).map(t => nomT[t]).filter(Boolean), sesion: nmA(F['TIPO DE SESIÓN']) || sesionDeEtiquetas((F['TIPO DE CITA'] || []).map(t => nomT[t])), notas: F['NOTAS'] || '', confirmada: (F['CONFIR'] || []).some(x => /CONFIRMADA/.test(nmA(x))), app: /APP/.test(nmA(F['RESERVA'])), web: /WEB/.test(nmA(F['RESERVA'])) }; }) });
        }
        if (req.method !== 'POST') return res.status(405).json({ ok: false });
        if (action === 'seg-agenda-res-enlace') { // historia clínica: «está mejor» → enlace a la reseña (con preview) y se apunta como pedida
          if (!okId(q.pacienteId)) return res.status(400).json({ ok: false });
          const pr = await at(`${PACIENTES}/${q.pacienteId}`); if (pr.error) return res.status(404).json({ ok: false, error: 'Paciente no encontrado' });
          const P = pr.fields || {}, tel = String(P['WHATSAPP'] || P['TELF'] || '').replace(/\D/g, ''), p0 = (String(P['NOMBRE'] || '').trim() || String(P['FULL NAME'] || '').trim()).split(/\s+/)[0] || '';
          const fm = { 'RESEÑA PEDIDA': new Date().toISOString() };
          if (q.mejora) Object.assign(fm, { 'MEJORA FECHA': new Date().toISOString(), 'MEJORA FISIO': String(q.fisio || '').slice(0, 40), 'MEJORA ABIERTA': null, 'MEJORA GOOGLE': null });
          await at(`${PACIENTES}/${q.pacienteId}`, { method: 'PATCH', body: JSON.stringify({ fields: fm }) }).catch(() => {});
          return res.status(200).json({ ok: true, link: enlaceRes(q.pacienteId), tel: tel.length === 9 ? '34' + tel : tel, pila: p0 ? p0.charAt(0).toUpperCase() + p0.slice(1).toLowerCase() : '' });
        }
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
        if (action === 'seg-agenda-pago') { // pedir pago por adelantado (op: pedir) · confirmar transferencia (op: confirmar) · quitar (op: quitar)
          if (q.op === 'perdonar') { if (!okId(q.pacienteId)) return res.status(400).json({ ok: false }); const d = await at(`${PACIENTES}/${q.pacienteId}`, { method: 'PATCH', body: JSON.stringify({ fields: { 'PAGO ADELANTADO': false } }) }); return res.status(200).json({ ok: !d.error }); }
          if (!okId(q.id)) return res.status(400).json({ ok: false });
          const cur = await at(`${CIT}/${q.id}`); if (cur.error) return res.status(404).json({ ok: false, error: 'Cita no encontrada' });
          const C0 = cur.fields || {}, reg = t => (String(C0['PAGO REGISTRO'] || '') + `\n${pagoAhora()} · ${t}`).trim(), quien = String(q.quien || '').slice(0, 40);
          if (q.op === 'pedir') {
            const imp = Math.round(Number(String(q.importe || '').replace(',', '.')) * 100) / 100; if (!(imp >= 1 && imp <= 2000)) return res.status(400).json({ ok: false, error: 'Pon el importe' });
            const yaPend = nmA(C0['PAGO ESTADO']) === 'PENDIENTE DE PAGO', lim = yaPend && C0['PAGO LÍMITE'] && new Date(C0['PAGO LÍMITE']) > new Date() ? C0['PAGO LÍMITE'] : new Date(Date.now() + 2 * 3600e3).toISOString();
            await patch(q.id, { 'PAGO ESTADO': 'PENDIENTE DE PAGO', 'PAGO IMPORTE': imp, 'PAGO LÍMITE': lim, 'PAGO REGISTRO': reg(`Pago pedido (${imp.toFixed(2).replace('.', ',')} €)${quien ? ' por ' + quien : ''}`) });
            return res.status(200).json({ ok: true, link: enlacePago(q.id), limite: lim });
          }
          if (q.op === 'confirmar') { await patch(q.id, { 'PAGO ESTADO': 'PAGADO', CONFIR: ['CONFIRMADA'], 'PAGO REGISTRO': reg(`Transferencia comprobada${quien ? ' por ' + quien : ''}`) }); await pagoQuitarMarca(C0); return res.status(200).json({ ok: true }); }
          if (q.op === 'quitar') { await patch(q.id, { 'PAGO ESTADO': null, 'PAGO LÍMITE': null, 'PAGO REGISTRO': reg(`Ya no se pide el pago${quien ? ' (' + quien + ')' : ''}`) }); return res.status(200).json({ ok: true }); }
          return res.status(400).json({ ok: false });
        }
        if (action === 'seg-agenda-fin-enlace') { // encuesta de fin de tratamiento: deja la ficha lista y devuelve el enlace personal
          if (!okId(q.pacienteId)) return res.status(400).json({ ok: false });
          const p0 = await at(`${PACIENTES}/${q.pacienteId}`); const P0 = p0.fields || {}, viejo = !P0['FIN ENVIADA'] || Date.now() - new Date(P0['FIN ENVIADA']).getTime() > 60 * 864e5;
          const ff = viejo ? { 'FIN ENVIADA': new Date().toISOString(), 'FIN VALORACIÓN': null, 'FIN COMENTARIO': '', 'FIN RESPONDIDA': null, 'FIN IR A RESEÑA': null } : {};
          // El fisio es quien le ha tratado (su última cita hecha), no quien manda el enlace
          let quien = '';
          try { const ul = await todosT(CIT, `filterByFormula=${encodeURIComponent(`AND(TRIM({ESTADO})='REALIZADA',{PREF.},FIND('${q.pacienteId}',ARRAYJOIN({PacienteRec})))`)}&fields[]=FECHA&fields[]=PREF.`); ul.sort((a, b) => String(b.fields.FECHA || '').localeCompare(String(a.fields.FECHA || ''))); const pv = (ul[0] || { fields: {} }).fields['PREF.']; quien = String((pv && typeof pv === 'object') ? (pv.name || '') : (pv || '')).trim(); } catch (e) {}
          if (quien) ff['FIN FISIO'] = String(quien).slice(0, 60);
          else if (q.fisio && (viejo || !P0['FIN FISIO'])) ff['FIN FISIO'] = String(q.fisio).slice(0, 60);
          const d = Object.keys(ff).length ? await at(`${PACIENTES}/${q.pacienteId}`, { method: 'PATCH', body: JSON.stringify({ fields: ff }) }) : {};
          return res.status(200).json({ ok: !d.error, link: enlaceFin(q.pacienteId), error: d.error && d.error.message });
        }
        if (action === 'seg-agenda-alta') { // cancela y ya no necesita más sesiones: etiqueta ALTA y motivo apuntado (no sale en «sin próxima cita»)
          if (!okId(q.pacienteId)) return res.status(400).json({ ok: false });
          const est = await at(`tbldOsLe8iw78Wun7?fields[]=ESTADO&pageSize=100`), e = (est.records || []).find(r => /^ALTA$/i.test(String(r.fields['ESTADO'] || '').trim()));
          const pac = await at(`${PACIENTES}/${q.pacienteId}`); if (pac.error) return res.status(404).json({ ok: false, error: 'Paciente no encontrado' });
          const act = (pac.fields && pac.fields['ESTADO']) || [];
          const f = { 'POR QUÉ NO REAGENDA': String(q.nota || 'Alta: ya no necesita más sesiones').slice(0, 2000), 'POR QUÉ FECHA': hoyF, 'POR QUÉ FISIO': String(q.fisio || '').slice(0, 60) };
          if (e) f.ESTADO = [...new Set([...act, e.id])];
          const d = await at(`${PACIENTES}/${q.pacienteId}`, { method: 'PATCH', body: JSON.stringify({ fields: f }) });
          const et = await ponerEtapa(q.pacienteId, 'ALTA').catch(() => null);
          return res.status(200).json({ ok: !d.error, estados: (et && et.estados) || f.ESTADO || act, error: d.error && d.error.message });
        }
        if (action === 'seg-agenda-aviso2') { // 2º aviso a quien no ha confirmado: cuándo y quién
          const ids = (Array.isArray(q.ids) ? q.ids : [q.id]).filter(okId).slice(0, 10); if (!ids.length) return res.status(400).json({ ok: false });
          const d = await at(CIT, { method: 'PATCH', body: JSON.stringify({ records: ids.map(id => ({ id, fields: { '2º AVISO ENVIADO': new Date().toISOString(), '2º AVISO POR': String(q.por || '').slice(0, 40) } })) }) });
          return res.status(200).json({ ok: !d.error, error: d.error && d.error.message });
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
          const pac = await at(`${PACIENTES}/${pid}`); const act = (pac.fields && pac.fields['ESTADO']) || [];
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
          await porQueAlHist(pid, '', '', '');
          const f = { 'POR QUÉ NO REAGENDA': '', 'POR QUÉ FECHA': null, 'POR QUÉ FISIO': '' };
          if (nuevo.join() !== act.join()) f.ESTADO = nuevo;
          await at(`${PACIENTES}/${pid}`, { method: 'PATCH', body: JSON.stringify({ fields: f }) });
          return { quitado: abiertas.length, estados: nuevo };
        };
        if (action === 'seg-agenda-dar') { global._sesPac = {}; // dar cita en una hora (o en un hueco libre concreto)
          if (!okId(q.pacienteId) || !okF(q.fecha) || !okH(q.hora) || !q.fisio) return res.status(400).json({ ok: false, error: 'Faltan datos' });
          const campos = { ESTADO: 'PENDIENTE ', 'RELACIÓN - CITA': [q.pacienteId] };
          if (q.notas) campos.NOTAS = String(q.notas).slice(0, 2000);
          if (q.sinBomba) q.tipos = [...(q.tipos || []).filter(t => !/^\s*(NO|SIN)\s+BOMBA\s*$/i.test(t)), 'NO BOMBA'];
          if (q.tipos && q.tipos.length) campos['TIPO DE CITA'] = await tiposDe(q.tipos);
          if (q.sesion) campos['TIPO DE SESIÓN'] = String(q.sesion).trim().slice(0, 60);
          if (!q.sinBomba && !q.forzarBomba) { const bl = await bombaLlena(q.fecha, q.hora, null); if (bl) return res.status(200).json(bl); }
          const r = await ocupar(q.fecha, q.hora, q.fisio, campos, !!q.forzar);
          if (r.conflicto) return res.status(200).json({ ok: false, conflicto: true, error: `A esa hora ${q.fisio} ya tiene a ${r.con || 'otro paciente'}` });
          const rep = await revisarPorReagendar(true).catch(() => 0);
          const seg = await salirDeSeguimiento(q.pacienteId, q.quien, q.fecha, q.hora).catch(() => null);
          const et = await ponerEtapa(q.pacienteId, 'cita').catch(() => null); if (seg && et) seg.estados = et.estados;
          const esp = await salirDeEspera(q.pacienteId, q.fecha, q.hora).catch(() => 0);
          const pf = await at(`${PACIENTES}/${q.pacienteId}`).catch(() => ({})), debePagar = (pf.fields || {})['PAGO ADELANTADO'] ? (pf.fields['PAGO ADELANTADO MOTIVO'] || 'Tiene que pagar por adelantado') : '';
          return res.status(200).json({ ok: true, id: r.id, reprogramadas: rep, seguimiento: seg, etapa: et && et.etapa, espera: esp, debePagar });
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
          // Cancelación tardía: se apunta sola en las notas de la cita (cuántas horas antes avisó y la política)
          if (q.estado === 'CANCELADA' && !/CANCELADA/.test(String(nmA(cur.fields.ESTADO)).toUpperCase())) {
            const hPol = Number(((await conf().catch(() => CONF_DEF)).cancelacion || {}).horas) || 24;
            const ini = madridUTC(String(cur.fields.FECHA || '').slice(0, 10), hh(cur.fields.HORA)).getTime(), faltan = (ini - Date.now()) / 36e5;
            if (faltan < hPol && faltan > -12) {
              const tx = `Cancelación tardía: avisó ${faltan <= 0 ? 'a la hora de la cita o después' : faltan < 1 ? 'con menos de 1 h' : 'con unas ' + Math.floor(faltan) + ' h'} (la política pide ${hPol} h). Apuntado el ${new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date())}.`;
              const base = f.NOTAS != null ? f.NOTAS : String(cur.fields.NOTAS || '');
              if (!/Cancelación tardía:/.test(base)) f.NOTAS = (base.trim() + (base.trim() ? '\n' : '') + tx).slice(0, 2000);
            }
          }
          if (Array.isArray(q.tipos)) f['TIPO DE CITA'] = await tiposDe(q.tipos);
          if (q.sesion !== undefined) f['TIPO DE SESIÓN'] = String(q.sesion || '').trim().slice(0, 60) || null;
          if (q.liberar) { // el paciente queda en su fila (cancelada…) y se crea un hueco libre en esa hora
            const c = cur.fields; await nueva(String(c.FECHA).slice(0, 10), hh(c.HORA), nmA(c['PREF.']), { ESTADO: 'CITA LIBRE' });
          }
          if (Object.keys(f).length) await patch(q.id, f);
          { const pidE = (cur.fields['RELACIÓN - CITA'] || [])[0]; if (pidE && /^(REALIZADA|NO ASISTIÓ)$/.test(q.estado || '')) await ponerEtapa(pidE, q.estado === 'REALIZADA' ? 'realizada' : 'noasistio').catch(() => null); }
          // Sin pack: si no vino o canceló con menos de 24 h, su próxima cita se paga por adelantado
          let debePagar = '';
          { const pidE = (cur.fields['RELACIÓN - CITA'] || [])[0], cF = String(cur.fields.FECHA || '').slice(0, 10), cH = hh(cur.fields.HORA);
            if (pidE && (q.estado === 'NO ASISTIÓ' || (q.estado === 'CANCELADA' && q.tarde))) { const pk = await packDe(pidE, cF, cH).catch(() => null);
              if (!pk || pk.t !== 'pack') { debePagar = `${q.estado === 'NO ASISTIÓ' ? 'No asistió' : 'Canceló con menos de 24 h'} el ${cF.split('-').reverse().slice(0, 2).join('/')}`; await at(`${PACIENTES}/${pidE}`, { method: 'PATCH', body: JSON.stringify({ fields: { 'PAGO ADELANTADO': true, 'PAGO ADELANTADO MOTIVO': debePagar } }) }).catch(() => {}); } } }
          return res.status(200).json({ ok: true, debePagar });
        }
        if (action === 'seg-agenda-mover') { global._sesPac = {}; // cambiar día/hora/fisio: la original queda REPROGRAMADA y se da la nueva
          if (!okId(q.id) || !okF(q.fecha) || !okH(q.hora) || !q.fisio) return res.status(400).json({ ok: false, error: 'Faltan datos' });
          const cur = await at(`${CIT}/${q.id}`); if (cur.error) return res.status(404).json({ ok: false, error: 'Cita no encontrada' });
          const c = cur.fields, pid = (c['RELACIÓN - CITA'] || [])[0];
          if (!pid) return res.status(400).json({ ok: false, error: 'Esta cita no tiene paciente' });
          const campos = { ESTADO: 'PENDIENTE ', 'RELACIÓN - CITA': [pid] };
          if (c['TIPO DE CITA']) campos['TIPO DE CITA'] = c['TIPO DE CITA'];
          if (c['TIPO DE SESIÓN']) campos['TIPO DE SESIÓN'] = nmA(c['TIPO DE SESIÓN']);
          if (c.NOTAS) campos.NOTAS = c.NOTAS;
          if (!q.forzarBomba) { const [nb] = await tiposDe(['NO BOMBA']); if (!(c['TIPO DE CITA'] || []).includes(nb)) { const bl = await bombaLlena(q.fecha, q.hora, q.id); if (bl) return res.status(200).json(bl); } }
          const r = await ocupar(q.fecha, q.hora, q.fisio, campos, !!q.forzar);
          if (r.conflicto) return res.status(200).json({ ok: false, conflicto: true, error: `A esa hora ${q.fisio} ya tiene a ${r.con || 'otro paciente'}` });
          await patch(q.id, { ESTADO: 'REPROGRAMADA' });
          if (q.liberar) await nueva(String(c.FECHA).slice(0, 10), hh(c.HORA), nmA(c['PREF.']), { ESTADO: 'CITA LIBRE' });
          return res.status(200).json({ ok: true, id: r.id });
        }
        if (action === 'seg-agenda-fisio') { global._sesPac = {}; // pasar la cita a otro fisio, mismo día y hora (sin reprogramar). Si el otro tenía esa hora libre, el hueco pasa al fisio de antes
          if (!okId(q.id) || !q.fisio) return res.status(400).json({ ok: false, error: 'Faltan datos' });
          const cur = await at(`${CIT}/${q.id}`); if (cur.error) return res.status(404).json({ ok: false, error: 'Cita no encontrada' });
          const c = cur.fields, fecha = String(c.FECHA || '').slice(0, 10), hora = hh(c.HORA), antes = nmA(c['PREF.']);
          if (String(antes).toLowerCase() === String(q.fisio).toLowerCase()) return res.status(200).json({ ok: true });
          const rows = enHora(await delDia(fecha), hora, q.fisio).filter(r => r.id !== q.id);
          const choca = rows.filter(r => ACTIVA(String(nmA(r.fields['ESTADO']))) && (r.fields['RELACIÓN - CITA'] || []).length);
          if (choca.length && !q.forzar) { const pid = (choca[0].fields['RELACIÓN - CITA'] || [])[0]; let n = ''; if (pid) { const p0 = await at(`${PACIENTES}/${pid}`); n = (p0.fields || {})['FULL NAME'] || ''; } return res.status(200).json({ ok: false, conflicto: true, error: `A esa hora ${q.fisio} ya tiene a ${n || 'otro paciente'}` }); }
          const bloq = rows.find(r => !(r.fields['RELACIÓN - CITA'] || []).length && !LIBRE(nmA(r.fields['ESTADO'])) && !/CANCELADA|REPROGRAMADA|PERDIDA/.test(String(nmA(r.fields['ESTADO']))));
          if (bloq && !q.forzar) return res.status(200).json({ ok: false, conflicto: true, error: `A esa hora ${q.fisio} la tiene ocupada (${String(nmA(bloq.fields['ESTADO'])).replace(/[^\wÁÉÍÓÚÑáéíóúñ -]/g, '').trim().toLowerCase()})` });
          await patch(q.id, { 'PREF.': q.fisio });
          const lib = rows.find(r => !(r.fields['RELACIÓN - CITA'] || []).length && LIBRE(nmA(r.fields['ESTADO'])));
          if (lib && antes) await patch(lib.id, { 'PREF.': antes });
          else if (q.liberar && antes) await nueva(fecha, hora, antes, { ESTADO: 'CITA LIBRE' });
          return res.status(200).json({ ok: true, hueco: !!lib });
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
      if (action === 'seg-ingresos-detalle') {
        // Desglose de los tickets de Holded de un periodo: cuáles cuentan en Estadísticas y cuáles no (y por qué)
        if (!HOLDED_KEY) return res.status(200).json({ ok: false, error: 'Holded no está conectado' });
        const ok = x => /^\d{4}-\d{2}-\d{2}$/.test(x || ''); if (!ok(q.desde) || !ok(q.hasta)) return res.status(400).json({ ok: false });
        const desde = q.desde < HOLDED_DESDE ? HOLDED_DESDE : q.desde;
        const [tk, rn] = await Promise.all([holdedTodos(`/sales-receipts?limit=200&start_date=${desde}&end_date=${q.hasta}`, 40), holdedTodos(`/receipt-notes?limit=200&start_date=${desde}&end_date=${q.hasta}`, 20).catch(() => [])]);
        const vistos = new Set(), L = [];
        const mete = (lista, rect) => lista.forEach(d => { if (!d || !d.id || vistos.has(d.id)) return; vistos.add(d.id); const f = String(d.date || '').slice(0, 10); if (f < desde || f > q.hasta) return;
          const motivo = /\btest\b|prueba/i.test(d.contact_name || '') ? 'Paciente de prueba' : '';
          L.push({ f, num: d.document_number || d.docNumber || d.doc_number || d.number || '', pac: d.contact_name || '', imp: (rect ? -1 : 1) * importeAbs(d), estado: String(d.status || ''), rect, borrador: !rect && !(d.document_number || d.docNumber || d.doc_number || d.number), cuenta: !motivo, motivo }); });
        mete(tk, false); mete(rn, true);
        L.sort((a, b) => a.f.localeCompare(b.f));
        const tot = L.filter(x => x.cuenta).reduce((a, x) => a + x.imp, 0);
        return res.status(200).json({ ok: true, desde, hasta: q.hasta, total: Math.round(tot * 100) / 100, tickets: L, antesHolded: q.desde < HOLDED_DESDE });
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
          global._estCaches = {}; global._estTrozos = {};
          try { const ids = (await todosT('tblLIcIro0ko9VG6G', 'fields[]=CLAVE')).map(r => r.id); for (let i = 0; i < ids.length; i += 10) await at('tblLIcIro0ko9VG6G?' + ids.slice(i, i + 10).map(x => 'records[]=' + x).join('&'), { method: 'DELETE' }); } catch (e) {}
          return res.status(200).json({ ok: !d.error, error: d.error && d.error.message });
        }
        const N = Math.min(Math.max(+q.semanas || 12, 4), 110);
        const lun0 = lunes(hoyF), desde = mv(lun0, -7 * (N - 1)), hasta = mv(lun0, 6), futuro = mv(hoyF, 60);
        const key = `${desde}|${N}`;
        { const ca = (global._estCaches || {})[key]; if (!q.fresco && ca && Date.now() - ca.t < 30 * 60000) return res.status(200).json(ca.data); }
        const calc = async (desde, hasta, futuro, N) => {
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
          // OCUPACIÓN (regla de dirección, simple): horas posibles = su horario de cada día en que hizo al menos una sesión;
          // horas entregadas = solo las sesiones hechas (REALIZADA, 1 sesión = 1 h). Los días sin ninguna sesión hecha no cuentan
          // (no estaba trabajando). Pendientes, no vino, canceladas, call-in y vídeos no cuentan como entregadas.
          const hecha = c => c.pid && /^REALIZADA$/.test(String(c.e).trim());
          // Cambios puntuales de horario (Administración › Vacaciones y horarios): «trabaja otro horario» = esas horas; «falta unas horas» = se restan
          const ausS = await ausenciasEn(a, mv(a, 6)).catch(() => []);
          const durH = x => { const [h1, m1] = String(x.hd).split(':').map(Number), [h2, m2] = String(x.hh).split(':').map(Number); return Math.max(0, (h2 * 60 + m2 - h1 * 60 - m1) / 60); };
          const horasDe = (k, f, base) => { let h = base; ausS.filter(x => x.desde <= f && x.hasta >= f && (x.fisio === 'Toda la clínica' || String(x.fisio).toLowerCase() === k)).forEach(x => {
            if (x.tipo === 'Cambio de horario' && x.hd) h = durH(x); else if (x.hd) h = Math.max(0, h - durH(x)); else h = 0; }); return h; };
          const pf = {}; EQUIPO.forEach(k => pf[k] = { ses: real.filter(c => String(c.fisio).toLowerCase() === k).length, ocup: 0, cap: 0, extra: 0 });
          let cap = 0, ocup = 0; for (let d = 0; d < 7; d++) { const f = mv(a, d), dw = new Date(f + 'T12:00:00Z').getUTCDay(); EQUIPO.forEach(k => {
            const n = C.filter(c => c.f === f && String(c.fisio).toLowerCase() === k && hecha(c)).length;
            if (!n) return; // sin sesiones hechas ese día: no cuenta (no estaba trabajando)
            // Si hace más sesiones que su horario, ese día trabajó esas horas: cuentan todas (ese día = 100 %) y lo de más se apunta como horas extra
            const h = horasDe(k, f, (horario[k] && horario[k][dw]) || 0), cd = Math.max(h, n), ex = Math.max(0, n - h);
            cap += cd; ocup += n; pf[k].cap += cd; pf[k].ocup += n; pf[k].extra += ex; }); }
          const ll = llam.filter(r => { const x = r.fields.FECHA; if (!x) return false; const d = String(x).includes('T') ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date(x)) : String(x).slice(0, 10); return en(d); });
          const m = man.find(r => String(r.fields.SEMANA || '').slice(0, 10) === a);
          semanas.push({ semana: a, sesiones: real.length, dias, atendidos: atend.length, conBono, noVino: enS.filter(c => /NO ASIST|PERDIDA/.test(c.e)).length, canceladas: enS.filter(c => /CANCELADA/.test(c.e)).length,
            nuevos: nuevos.length, vinieron: vin, reagendaron: reag, porFisio: fis, prod: pf, ocupadas: ocup, capacidad: cap, ocupacion: cap ? Math.round(ocup * 100 / cap) : null,
            recuperadas: ll.filter(r => /RECUPERADA/.test(nmS(r.fields.RESULTADO))).length, resenasPedidas: ll.filter(r => r.fields['RESEÑA']).length,
            ingresos: ingH(a) !== undefined ? ingH(a) : (m && m.fields.INGRESOS != null ? m.fields.INGRESOS : null), ingresosHolded: ingH(a) !== undefined, resenas: m && m.fields['RESEÑAS GOOGLE'] != null ? m.fields['RESEÑAS GOOGLE'] : null, quejas: m && m.fields.QUEJAS != null ? m.fields.QUEJAS : null, notas: m ? (m.fields.NOTAS || '') : '' });
        }
        const nombres = {}; { const ids = [...usados]; const lt = []; for (let i = 0; i < ids.length; i += 50) lt.push(ids.slice(i, i + 50));
          for (let i = 0; i < lt.length; i += 4) (await Promise.all(lt.slice(i, i + 4).map(t => todosT(PACIENTES, `filterByFormula=${encodeURIComponent('OR(' + t.map(x => `RECORD_ID()='${x}'`).join(',') + ')')}&fields[]=FULL%20NAME`).catch(() => [])))).forEach(rs => rs.forEach(r => nombres[r.id] = r.fields['FULL NAME'] || '')); }
        return { ok: true, hoy: hoyF, semanas, nombres, ingDias: diasH, holdedDesde: HOLDED_DESDE };
        };
        // Periodos largos: por trimestres de 13 semanas. Los trimestres ya pasados se guardan calculados en Airtable
        // (ESTADISTICAS CACHE) y solo se recalcula lo reciente: así 2 años salen en lo que tardan unas pocas semanas.
        // Lo reciente también se guarda 15 min en memoria: la carga corta y la de 2 años comparten los mismos trozos
        global._estTrozos = global._estTrozos || {};
        const calcM = async (a, b, f, n) => { const k = `${a}|${b}|${n}`, m = global._estTrozos[k]; if (!q.fresco && m && Date.now() - m.t < 15 * 60e3) return m.d; const d = await calc(a, b, f, n); global._estTrozos[k] = { t: Date.now(), d }; return d; };
        let data;
        {
          const CH = 13, EPOCH = '2024-01-01', ECT = 'tblLIcIro0ko9VG6G', VER = 'v1';
          const semK = k => mv(EPOCH, 7 * k), idx = f => Math.round((Date.parse(f + 'T12:00:00Z') - Date.parse(EPOCH + 'T12:00:00Z')) / (7 * 864e5));
          // Trimestres terminados hace más de 3 semanas: guardados. Si son de los últimos 3 meses se refrescan cada semana (la conversión aún puede subir)
          const i0 = idx(desde), iL = idx(lun0), limiteViejo = mv(lun0, -7 * 3), reciente = mv(lun0, -7 * 13);
          const mapa = {}, recId = {}; (await todosT(ECT, 'fields[]=CLAVE&fields[]=DATOS').catch(() => [])).forEach(r => { mapa[r.fields.CLAVE] = r.fields.DATOS; recId[r.fields.CLAVE] = r.id; });
          const partes = []; let calculados = 0, faltan = false;
          for (let st = Math.floor(i0 / CH) * CH; st <= iL; st += CH) {
            const ini = semK(st), finSem = semK(st + CH - 1), viejo = finSem < limiteViejo;
            if (viejo) {
              const clave = `${VER}|${ini}|${CH}`;
              if (mapa[clave]) { try { const o = JSON.parse(mapa[clave]); if (!(finSem > reciente && Date.now() - (o.t || 0) > 7 * 864e5)) { partes.push(o); continue; } } catch (e) {} }
              if (calculados >= 2) { faltan = true; continue; }
              const d = await calcM(ini, mv(finSem, 6), mv(finSem, 66), CH); calculados++;
              const txt = JSON.stringify({ t: Date.now(), semanas: d.semanas, nombres: d.nombres });
              if (txt.length < 95000) await (recId[clave] ? at(`${ECT}/${recId[clave]}`, { method: 'PATCH', body: JSON.stringify({ fields: { DATOS: txt } }) }) : at(ECT, { method: 'POST', body: JSON.stringify({ records: [{ fields: { CLAVE: clave, DATOS: txt } }] }) })).catch(() => {});
              partes.push(d);
            } else { const a2 = semK(st), b2 = semK(Math.min(st + CH - 1, iL)); partes.push(await calcM(a2, mv(b2, 6), futuro, idx(b2) - st + 1)); }
          }
          const vistas = new Set(), sems = [], noms = {}; let ingD = {};
          partes.forEach(d => { Object.assign(noms, d.nombres || {}); if (d.ingDias) ingD = d.ingDias; (d.semanas || []).forEach(w => { if (w.semana >= desde && w.semana <= lun0 && !vistas.has(w.semana)) { vistas.add(w.semana); sems.push(w); } }); });
          sems.sort((x, y) => x.semana.localeCompare(y.semana));
          data = { ok: true, hoy: hoyF, semanas: sems, nombres: noms, ingDias: ingD, holdedDesde: HOLDED_DESDE, incompleto: faltan };
        }
        if (!data.incompleto) { global._estCache = { key, t: Date.now(), data }; (global._estCaches = global._estCaches || {})[key] = global._estCache; }
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
        const segIds = new Set(pend.map(r => r.id)), ultLl = {}, histLl = {};
        if (segIds.size) {
          prev.forEach(r => { const sid = r.fields['SEG ID']; if (!segIds.has(sid)) return; if (ultLl[sid]) { const h = histLl[sid] = histLl[sid] || []; if (h.length < 8) { const fx = String(r.fields['FECHA'] || ''); h.push({ fecha: fx.includes('T') ? diaMad(fx) : fx.slice(0, 10), quien: (r.fields['QUIEN LLAMA'] && r.fields['QUIEN LLAMA'].name) || r.fields['QUIEN LLAMA'] || '', resultado: String((r.fields['RESULTADO'] && r.fields['RESULTADO'].name) || r.fields['RESULTADO'] || '').trim(), nota: r.fields['NOTAS'] || '' }); } return; } const fx = String(r.fields['FECHA'] || ''); ultLl[sid] = { fecha: fx.includes('T') ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(fx)) : fx.slice(0, 10), quien: (r.fields['QUIEN LLAMA'] && r.fields['QUIEN LLAMA'].name) || r.fields['QUIEN LLAMA'] || '', resultado: String((r.fields['RESULTADO'] && r.fields['RESULTADO'].name) || r.fields['RESULTADO'] || '').trim(), nota: r.fields['NOTAS'] || '' }; }); }
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
          pendientes: pend.map(r => ({ id: r.id, ult: ultLl[r.id] || null, hist: histLl[r.id] || [], fecha: r.fields['FECHA DE LLAMADA'] || '', nota: r.fields['NOTAS'] || '', responsable: (r.fields['RESPONSABLE'] && r.fields['RESPONSABLE'].name) || r.fields['RESPONSABLE'] || '', ...info((r.fields['PACIENTE'] || [])[0]) })),
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
          if (vuelve) { await porQueAlHist(q.id, '', '', ''); await at(`${PACIENTES}/${q.id}`, { method: 'PATCH', body: JSON.stringify({ fields: { 'POR QUÉ NO REAGENDA': '', 'POR QUÉ FECHA': null, 'POR QUÉ FISIO': '' } }) }).catch(() => {}); F['POR QUÉ NO REAGENDA'] = ''; F['POR QUÉ FECHA'] = ''; F['POR QUÉ FISIO'] = ''; }
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
          paciente: { id: pac.id, pin: F['PIN'] || '', nombre: F['FULL NAME'] || '', tel: F['WHATSAPP'] || F['TELF'] || '', telf: F['TELF'] || '', whatsapp: F['WHATSAPP'] || '', pin: F['PIN'] || '', email: F['EMAIL'] || '', dni: F['DNI'] || '', cumple: F['CUMPLE'] || '', telDescartado: F['TELF FORM DESCARTADO'] || '', foto: (((F['FOTO PERFIL'] || [])[0] || {}).thumbnails || {}).large ? F['FOTO PERFIL'][0].thumbnails.large.url : (((F['FOTO PERFIL'] || [])[0] || {}).url || ''), ultimoAcceso: F['ÚLTIMO ACCESO APP'] || '', appUsada: !!(F['ÚLTIMO ACCESO APP'] || F['PushSubscription']), appInstalada: !!(F['APP INSTALADA'] || F['PushSubscription']), alta: pac.createdTime || '', estados: F['ESTADO'] || [],
            motivo: F['MOTIVO DE VISITA'] || '', historial: F['HISTORIAL CLÍNICO'] || '', historialMod: F['HISTORIAL ACTUALIZADO'] || '', notas: F['NOTAS'] || '', porQue: F['POR QUÉ NO REAGENDA'] || '', porQueFecha: F['POR QUÉ FECHA'] || '', porQueHist: String(F['POR QUÉ HISTORIAL'] || '').split('\n').map(l => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean), porQueFisio: F['POR QUÉ FISIO'] || '', bonoPrevio: F['SESIONES BONO PREVIO'] || 0, colab: F['COLAB'] || '', resena: !!F['RESEÑA POSITIVA'],
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
          const pac = await at(`${PACIENTES}/${pid}`); const act = (pac.fields && pac.fields['ESTADO']) || [];
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
        await ponerEtapa(q.pacienteId, 'SEGUIMIENTO').catch(() => null);
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
          if (q.bonoSumar != null) { const cur = await at(`${PACIENTES}/${q.id}`); n = Number((cur.fields || {})['SESIONES BONO PREVIO'] || 0) + Number(q.bonoSumar); }
          if (!Number.isFinite(n) || n < 0 || n > 500) return res.status(400).json({ ok: false, error: 'Nº de sesiones no válido' });
          const d = await at(`${PACIENTES}/${q.id}`, { method: 'PATCH', body: JSON.stringify({ fields: Object.assign({ 'SESIONES BONO PREVIO': Math.round(n) || null }, q.bonoPrevio != null ? { 'BONO PREVIO YA USADAS': null } : {}) }) });
          global._sesPac = {};
          return res.status(200).json({ ok: !d.error, bonoPrevio: Math.round(n), error: d.error && (d.error.message || d.error.type) });
        }
        // «Ya tiene la app»: se marca a mano para que no le llegue el aviso de la app en los recordatorios
        if (q.campos && q.campos.appYa !== undefined) { const d = await at(`${PACIENTES}/${q.id}`, { method: 'PATCH', body: JSON.stringify({ fields: q.campos.appYa ? { 'ÚLTIMO ACCESO APP': new Date().toISOString(), 'APP INSTALADA': new Date().toISOString() } : { 'APP INSTALADA': null } }) }); return res.status(200).json({ ok: !d.error }); }
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
        if (q.motivo) f['MOTIVO DE VISITA'] = String(q.motivo).trim().slice(0, 2000);
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
      // Dar un informe al paciente pidiendo recibí: en su app, por enlace (WhatsApp / email) o en mano (firma en el panel)
      if (action === 'seg-inf-entrega') {
        const id = String(q.id || ''); if (!/^rec[A-Za-z0-9]{14}$/.test(id)) return res.status(400).json({ ok: false, error: 'Informe no válido' });
        const canal = ['app', 'whatsapp', 'email', 'mano'].includes(q.canal) ? q.canal : 'whatsapp';
        const r = await at(`${INFORMES_TABLE}/${id}`); if (r.error) return res.status(404).json({ ok: false, error: 'Informe no encontrado' });
        const F = r.fields || {}; let E = {}; try { E = JSON.parse(F['ENTREGA'] || '{}'); } catch (e) {}
        const pr = await at(`${PACIENTES}/${F['PacienteId']}`).catch(() => ({})); const P = pr.fields || {};
        const dniDig = String(P['DNI'] || '').replace(/\D/g, ''), nac = await pacNacimiento(F['PacienteId']);
        const verif = dniDig.length >= 4 ? 'dni' : /^\d{4}-\d{2}-\d{2}$/.test(nac) ? 'nac' : '';
        let tk = String(F['ENTREGA TOKEN'] || '');
        if (canal === 'whatsapp' || canal === 'email') {
          if (!verif) return res.status(200).json({ ok: false, error: 'Este paciente no tiene DNI ni fecha de nacimiento en su ficha: no podrá abrir el enlace. Añádelos o dáselo en su app o en mano.' });
          if (!tk) { const A = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'; tk = Array.from(require('crypto').randomBytes(20), b => A[b % A.length]).join(''); }
        }
        const fields = { 'RECIBI PIDE': true, ENTREGA: JSON.stringify({ ...E, canal, enviado: new Date().toISOString(), intentos: 0, quien: String(q.quien || '').slice(0, 60) }) };
        if (tk) fields['ENTREGA TOKEN'] = tk;
        if (canal !== 'mano') fields.SoloFisio = false; // también le aparece en su app
        if (typeof q.texto === 'string' && q.texto.trim()) fields.Informe = q.texto.slice(0, 90000); // lo último escrito en el panel
        const u = await at(`${INFORMES_TABLE}/${id}`, { method: 'PATCH', body: JSON.stringify({ fields }) });
        if (u.error) return res.status(500).json({ ok: false, error: u.error.message || 'No se ha podido guardar' });
        const pila = (String(P['NOMBRE'] || '').trim() || String(P['FULL NAME'] || '').trim()).split(/\s+/)[0] || '';
        const tel = String(P['WHATSAPP'] || P['TELF'] || '').replace(/\D/g, '');
        return res.status(200).json({ ok: true, url: tk ? `https://app.fisioterapia365.com/i/${tk}` : '', tel: tel.length === 9 ? '34' + tel : tel, email: String(P['EMAIL'] || '').trim(), pila: pila ? pila.charAt(0).toUpperCase() + pila.slice(1).toLowerCase() : '', verif, firmado: !!F['RECIBI FECHA'] });
      }
      // Enviar el enlace del informe por email desde info@ (Brevo)
      if (action === 'seg-inf-email') {
        if (req.method !== 'POST') return res.status(405).json({ ok: false });
        const id = String(q.id || ''), to = String(q.to || '').trim();
        if (!/^rec[A-Za-z0-9]{14}$/.test(id)) return res.status(400).json({ ok: false, error: 'Informe no válido' });
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return res.status(200).json({ ok: false, error: 'Revisa el email' });
        const r = await at(`${INFORMES_TABLE}/${id}`); const F = r.fields || {}; const tk = String(F['ENTREGA TOKEN'] || '');
        if (!tk) return res.status(200).json({ ok: false, error: 'Primero crea el enlace' });
        const url = `https://app.fisioterapia365.com/i/${tk}`, pila = escHtml(String(q.pila || '')), yo = escHtml(String(q.yo || '').split(' ')[0]);
        const pide = q.verif === 'nac' ? 'tu fecha de nacimiento' : 'los 4 últimos números de tu DNI';
        const html = `<!doctype html><html><body style="margin:0;background:#f5f2ee;font-family:Helvetica,Arial,sans-serif;color:#1a1a1a"><div style="max-width:520px;margin:0 auto;padding:28px 18px">
<div style="background:#fff;border-radius:18px;padding:26px 24px">
<img src="https://app.fisioterapia365.com/informe/logo.png" alt="FISIO365" width="92" style="width:92px;height:auto;display:block;margin:4px 0 30px;border:0">
<p style="font-size:16px;line-height:1.55;margin:0 0 14px">Hola${pila ? ' ' + pila : ''},</p>
<p style="font-size:15px;line-height:1.6;color:#3c342f;margin:0 0 20px">${yo ? 'Soy ' + yo + ' de FISIO365. ' : ''}Aquí tienes tu informe de fisioterapia. Para abrirlo te pediremos ${pide}, y al final te pediremos que firmes que lo has recibido.</p>
<a href="${url}" style="display:block;text-align:center;background:#c2552e;color:#fff;text-decoration:none;font-weight:bold;font-size:15px;border-radius:99px;padding:14px">Abrir mi informe</a>
<p style="font-size:12.5px;line-height:1.5;color:#9a8f87;margin:18px 0 0">El enlace es personal y caduca en 30 días. Si no puedes abrirlo, contesta a este email o llámanos al <span style="white-space:nowrap">672 89 39 49</span>.</p>
</div><p style="font-size:11.5px;color:#9a8f87;text-align:center;margin:16px 0 0">FISIO365 · Gran de Sant Andreu, 163 · Barcelona</p></div></body></html>`;
        const b = await fetch('https://api.brevo.com/v3/smtp/email', { method: 'POST', headers: { 'api-key': process.env.BREVO_API_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({ sender: { name: 'FISIO365', email: 'info@fisioterapia365.com' }, replyTo: { email: 'info@fisioterapia365.com', name: 'FISIO365' }, to: [{ email: to }], subject: 'Tu informe de fisioterapia · FISIO365', htmlContent: html }) });
        if (!b.ok) { console.error('seg-inf-email brevo', b.status, (await b.text().catch(() => '')).slice(0, 300)); return res.status(200).json({ ok: false, error: 'No se ha podido enviar (' + b.status + ')' }); }
        let E = {}; try { E = JSON.parse(F['ENTREGA'] || '{}'); } catch (e) {}
        await at(`${INFORMES_TABLE}/${id}`, { method: 'PATCH', body: JSON.stringify({ fields: { ENTREGA: JSON.stringify({ ...E, canal: 'email', email: to, enviado: new Date().toISOString() }) } }) }).catch(() => {});
        return res.status(200).json({ ok: true });
      }
      // Enviar una factura al paciente: email desde info@ con el PDF adjunto, o enlace para WhatsApp
      if (action === 'seg-fac-enviar') {
        const t = q.tipo === 'invoice' ? 'invoice' : 'salesreceipt', id = String(q.id || ''), pid = String(q.pacienteId || '');
        if (!/^[a-f0-9]{24}$/i.test(id) || !/^rec[A-Za-z0-9]{14}$/.test(pid)) return res.status(400).json({ ok: false, error: 'Factura no válida' });
        const doc = await holded('/' + docTipo(t) + '/' + id).catch(() => null), ids = await contactosDelPaciente(pid);
        if (!doc || !ids.includes(doc.contact_id)) return res.status(200).json({ ok: false, error: 'No encuentro esa factura de este paciente' });
        if (!doc.document_number) return res.status(200).json({ ok: false, error: 'Es un borrador: apruébalo en Holded antes de enviarlo' });
        const pr = await at(`${PACIENTES}/${pid}`).catch(() => ({})), P = pr.fields || {};
        const pila0 = (String(P['NOMBRE'] || '').trim() || String(P['FULL NAME'] || '').trim()).split(/\s+/)[0] || '', pila = pila0 ? pila0.charAt(0).toUpperCase() + pila0.slice(1).toLowerCase() : '';
        const tel = String(P['WHATSAPP'] || P['TELF'] || '').replace(/\D/g, ''), D = facDatos(doc), url = enlaceFac(t, id);
        if (q.op === 'datos') return res.status(200).json({ ok: true, email: String(P['EMAIL'] || '').trim(), tel: tel.length === 9 ? '34' + tel : tel, pila, url, numero: D.numero, total: D.total, fecha: D.fecha });
        if (q.op !== 'email') return res.status(400).json({ ok: false });
        const to = String(q.to || '').trim(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return res.status(200).json({ ok: false, error: 'Revisa el email' });
        const pdf = await holdedPdf('/' + docTipo(t) + '/' + id + '/pdf').catch(() => null); if (!pdf) return res.status(200).json({ ok: false, error: 'Holded no ha dado el PDF. Inténtalo en un rato.' });
        const yo = escHtml(String(q.yo || '').split(' ')[0]);
        const html = `<!doctype html><html><body style="margin:0;background:#f5f2ee;font-family:Helvetica,Arial,sans-serif;color:#1a1a1a"><div style="max-width:520px;margin:0 auto;padding:28px 18px">
<div style="background:#fff;border-radius:18px;padding:26px 24px">
<img src="https://app.fisioterapia365.com/informe/logo.png" alt="FISIO365" width="92" style="width:92px;height:auto;display:block;margin:4px 0 30px;border:0">
<p style="font-size:16px;line-height:1.55;margin:0 0 14px">Hola${pila ? ' ' + escHtml(pila) : ''},</p>
<p style="font-size:15px;line-height:1.6;color:#3c342f;margin:0 0 18px">${yo ? 'Soy ' + yo + ' de FISIO365. ' : ''}Te adjuntamos tu factura en PDF para que la tengas a mano o la envíes a tu seguro.</p>
<div style="background:#faf7f4;border-radius:14px;padding:14px 16px;margin:0 0 18px"><table role="presentation" width="100%" style="border-collapse:collapse"><tr><td style="font-size:14.5px;color:#1a1a1a"><b>Factura ${escHtml(D.numero)}</b><br><span style="font-size:13px;color:#8a7d74">${escHtml(D.fecha)}${D.concepto ? ' · ' + escHtml(D.concepto) : ''}</span></td><td align="right" style="font-size:18px;font-weight:bold;color:#1a1a1a;white-space:nowrap">${escHtml(D.total)}</td></tr></table></div>
<p style="font-size:12.5px;line-height:1.5;color:#9a8f87;margin:0">También la tienes siempre en tu app de FISIO365. Si tienes cualquier duda, contesta a este email o llámanos al <span style="white-space:nowrap">672 89 39 49</span>.</p>
</div><p style="font-size:11.5px;color:#9a8f87;text-align:center;margin:16px 0 0">FISIO365 · Gran de Sant Andreu, 163 · Barcelona</p></div></body></html>`;
        const b = await fetch('https://api.brevo.com/v3/smtp/email', { method: 'POST', headers: { 'api-key': process.env.BREVO_API_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({ sender: { name: 'FISIO365', email: 'info@fisioterapia365.com' }, replyTo: { email: 'info@fisioterapia365.com', name: 'FISIO365' }, to: [{ email: to }], subject: `Tu factura ${D.numero} · FISIO365`, htmlContent: html, attachment: [{ content: pdf, name: `Factura_${String(D.numero).replace(/[^\w-]/g, '_')}.pdf` }] }) });
        if (!b.ok) { console.error('seg-fac-enviar brevo', b.status, (await b.text().catch(() => '')).slice(0, 300)); return res.status(200).json({ ok: false, error: 'No se ha podido enviar (' + b.status + ')' }); }
        return res.status(200).json({ ok: true });
      }
      if (action === 'seg-inf-recibi-mano') {
        const id = String(q.id || ''); if (!/^rec[A-Za-z0-9]{14}$/.test(id)) return res.status(400).json({ ok: false, error: 'Informe no válido' });
        if (typeof q.firma !== 'string' || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(q.firma) || q.firma.length > 95000) return res.status(400).json({ ok: false, error: 'Falta la firma' });
        const r = await at(`${INFORMES_TABLE}/${id}`); if (r.error) return res.status(404).json({ ok: false, error: 'Informe no encontrado' });
        let E = {}; try { E = JSON.parse((r.fields || {})['ENTREGA'] || '{}'); } catch (e) {}
        const u = await at(`${INFORMES_TABLE}/${id}`, { method: 'PATCH', body: JSON.stringify({ fields: { 'RECIBI PIDE': true, 'RECIBI FECHA': new Date().toISOString(), 'RECIBI FIRMA': q.firma, ENTREGA: JSON.stringify({ ...E, canal: 'mano', enviado: E.enviado || new Date().toISOString(), quien: String(q.quien || '').slice(0, 60) }), 'RECIBI DATOS': JSON.stringify({ canal: 'mano', verificado: 'en persona, en la clínica' + (q.quien ? ' (' + String(q.quien).slice(0, 60) + ')' : ''), codigo: infCodigo(id), huella: infHuella((r.fields || {})['Informe']), texto: infTextoRecibi(id) }) } }) });
        if (u.error) return res.status(500).json({ ok: false, error: u.error.message || 'No se ha podido guardar' });
        return res.status(200).json({ ok: true });
      }
      if (action === 'seg-inf-recibi') {
        const id = String(q.id || ''); if (!/^rec[A-Za-z0-9]{14}$/.test(id)) return res.status(400).json({ ok: false, error: 'Informe no válido' });
        const r = await at(`${INFORMES_TABLE}/${id}`); const F = r.fields || {};
        if (!F['RECIBI FECHA']) return res.status(200).json({ ok: false, error: 'Todavía no ha firmado el recibí' });
        let D = {}; try { D = JSON.parse(F['RECIBI DATOS'] || '{}'); } catch (e) {}
        return res.status(200).json({ ok: true, fecha: F['RECIBI FECHA'], firma: F['RECIBI FIRMA'] || '', datos: D, codigo: infCodigo(id), huellaActual: infHuella(F['Informe']), coincide: D.huella ? D.huella === infHuella(F['Informe']) : null, paciente: String(F['PacienteNombre'] || ''), tipo: F['Protocolo'] || '', fechaInforme: F['Fecha'] || '', fisio: F['FisioNombre'] || '' });
      }
      if (action === 'seg-informe-tto') {
        // Informe fisioterapéutico redactado por la IA con el historial clínico, la anamnesis y las sesiones realizadas.
        // Se guarda en Informes de la ficha como «solo fisio»: se revisa y se comparte desde ahí.
        const pid = q.pacienteId; if (!/^rec[A-Za-z0-9]{14}$/.test(pid || '')) return res.status(400).json({ ok: false, error: 'Falta paciente' });
        const vacio = !!q.vacio; // plantilla en blanco: solo los títulos de sección, sin IA
        const K = process.env.ANTHROPIC_API_KEY; if (!K && !vacio) return res.status(200).json({ ok: false, error: 'Falta la clave de la IA' });
        const [p, ses, infs] = await Promise.all([
          at(`${PACIENTES}/${pid}`),
          todosT(CIT, `filterByFormula=${encodeURIComponent(`AND(FIND('${pid}',ARRAYJOIN({PacienteRec})),TRIM({ESTADO})='REALIZADA')`)}&fields[]=FECHA&fields[]=PREF.&sort[0][field]=FECHA&sort[0][direction]=asc`).catch(() => []),
          todosT(INFORMES_TABLE, `filterByFormula=${encodeURIComponent(`{PacienteId}='${pid}'`)}&fields[]=Protocolo&fields[]=Fecha&fields[]=Informe`).catch(() => [])
        ]);
        if (p.error || !p.fields) return res.status(404).json({ ok: false, error: 'Paciente no encontrado' });
        const F = p.fields, nm = x => (x && x.name) || x || '';
        const fechas = ses.map(c => String(c.fields['FECHA'] || '').slice(0, 10)).filter(Boolean);
        const fisios = [...new Set(ses.map(c => String(nm(c.fields['PREF.'])).trim()).filter(Boolean))];
        const fC = f => f ? f.split('-').reverse().join('/') : '';
        const ana = infs.filter(r => r.fields['Informe'] && !/sin evoluci|fisioterap[eé]utico/i.test(String(r.fields['Protocolo'] || ''))).map(r => `(${r.fields['Fecha'] || ''} · ${r.fields['Protocolo'] || ''})\n${String(r.fields['Informe']).slice(0, 3000)}`).slice(-2).join('\n\n');
        const hist = String(F['HISTORIAL CLÍNICO'] || '').replace(/\*\*|`/g, '').trim();
        if (!vacio && !hist && !ana) return res.status(200).json({ ok: false, error: 'Este paciente no tiene historial clínico ni anamnesis: no hay de dónde sacar el informe.' });
        const prompt = `Eres fisioterapeuta en FISIO365 Centro de Fisioterapia (Barcelona). Redacta un INFORME FISIOTERAPÉUTICO profesional para entregar al paciente (puede llevarlo a su médico, mutua o trabajo).
DATOS
- Paciente: ${String(F['FULL NAME'] || '').trim()}
- Sesiones realizadas: ${fechas.length}${fechas.length ? ` (del ${fC(fechas[0])} al ${fC(fechas[fechas.length - 1])})` : ''}
- Fisioterapeuta(s): ${fisios.join(', ') || 'no consta'}
- Hoy: ${hoyF}
- Motivo de visita (ficha): ${String(F['MOTIVO DE VISITA'] || '').trim() || 'no consta'}
- Anamnesis / valoración:
${ana || 'no consta'}
- Historial clínico (notas de cada sesión, en orden):
${hist.slice(-12000) || 'no consta'}
ABREVIATURAS DE LAS NOTAS: IH-EH / EHIH = inducción y extracción hídrica con bomba diamagnética; MC = microcontracción; HC = armonización; MK / Medkey = electroterapia dinámica (Medkey); TM = terapia manual; PG = puntos gatillo; ondas focalizadas/desfocalizadas = ondas de choque; bio tendón = programa de bioestimulación tendinosa; TFL = tensor de la fascia lata.
ESTRUCTURA (cada título en MAYÚSCULAS en su propia línea, sin markdown, sin asteriscos ni almohadillas):
MOTIVO DE CONSULTA
VALORACIÓN INICIAL
TRATAMIENTO REALIZADO
EVOLUCIÓN
ESTADO ACTUAL
RECOMENDACIONES
REGLAS: español de España, tercera persona, lenguaje clínico claro y conciso (máx. 450 palabras); en TRATAMIENTO REALIZADO indica el nº de sesiones y el periodo y describe las técnicas con su nombre completo, sin abreviaturas; en EVOLUCIÓN resume cómo ha ido cambiando, sin copiar sesión a sesión; usa SOLO lo que está en los datos, no inventes pruebas, diagnósticos médicos, escalas ni cifras; si de algún apartado no hay información suficiente, escribe una frase breve diciéndolo; RECOMENDACIONES solo si se desprenden de las notas (ejercicios, sesiones de mantenimiento, revisión…); no pongas datos de contacto, firma ni saludo. Devuelve solo el texto del informe.`;
        let texto = '', err = '';
        if (vacio) texto = ['MOTIVO DE CONSULTA', 'VALORACIÓN INICIAL', 'TRATAMIENTO REALIZADO', 'EVOLUCIÓN', 'ESTADO ACTUAL', 'RECOMENDACIONES'].join('\n\n\n\n') + '\n\n';
        else for (const model of ['claude-sonnet-4-5', 'claude-haiku-4-5']) {
          try {
            const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': K, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' }, body: JSON.stringify({ model, max_tokens: 2000, messages: [{ role: 'user', content: prompt }] }) });
            const j = await r.json(); texto = String(((j.content || []).find(b => b && b.type === 'text') || {}).text || '').replace(/\*\*|^#+\s*/gm, '').trim();
            if (texto) break; err = (j.error && j.error.message) || ('HTTP ' + r.status); console.error('seg-informe-tto', model, err);
          } catch (e) { err = e.message; console.error('seg-informe-tto', model, err); }
        }
        if (!texto) return res.status(200).json({ ok: false, error: 'La IA no ha podido redactarlo' + (err ? ': ' + err : '') });
        // Firma el fisio que más sesiones le ha hecho (con su nombre completo, para que salga su nº de colegiado); si no, quien lo crea
        const cuenta = {}; ses.forEach(c => { const n = String(nm(c.fields['PREF.'])).trim(); if (n) cuenta[n] = (cuenta[n] || 0) + 1; });
        const top = Object.keys(cuenta).sort((a, b) => cuenta[b] - cuenta[a])[0] || '';
        let firma = String(q.quien || '');
        if (vacio && firma) { const fd = await at('tbl2mLUrnaKCFTs6g?fields[]=Name').catch(() => ({})); const f = (fd.records || []).map(r => r.fields || {}).find(x => fisioKey(x.Name) === fisioKey(firma)); if (f) firma = String(f.Name).trim(); }
        else if (top) { const fd = await at('tbl2mLUrnaKCFTs6g?fields[]=Name').catch(() => ({})); const f = (fd.records || []).map(r => r.fields || {}).find(x => fisioKey(x.Name) === fisioKey(top)); firma = f ? String(f.Name).trim() : top; }
        const fechaEs = hoyF.split('-').reverse().join('/');
        const d = await at(INFORMES_TABLE, { method: 'POST', body: JSON.stringify({ typecast: true, records: [{ fields: { PacienteId: pid, PacienteNombre: String(F['FULL NAME'] || '').trim().toUpperCase(), FisioNombre: firma, Fecha: fechaEs, Protocolo: 'Informe fisioterapéutico', Informe: texto, SoloFisio: true } }] }) });
        if (d.error) return res.status(200).json({ ok: false, error: 'No se ha podido guardar: ' + (d.error.message || '') });
        return res.status(200).json({ ok: true, id: d.records[0].id, sesiones: fechas.length });
      }
      if (action === 'seg-wa-ia') {
        // Mensaje de WhatsApp personalizado para un paciente de «Por llamar», a partir de sus notas y su situación
        const K = process.env.ANTHROPIC_API_KEY; if (!K) { console.error('seg-wa-ia sin ANTHROPIC_API_KEY'); return res.status(200).json({ ok: false, error: 'Falta la clave de la IA' }); }
        const c = x => String(x || '').replace(/\s+/g, ' ').trim().slice(0, 400);
        // Lo último del historial clínico y de las notas de la ficha (antes la info se apuntaba sobre todo ahí)
        let hist = '', notasF = '', porQue = '';
        if (/^rec[A-Za-z0-9]{14}$/.test(q.pacienteId || '')) { try {
          const pr = await at(`${PACIENTES}/${q.pacienteId}?returnFieldsByFieldId=true`); const F = (pr && pr.fields) || {};
          const cola = (t, n) => { t = String(t || '').replace(/\*\*|`/g, '').replace(/\n{3,}/g, '\n\n').trim(); return t.length > n ? '…' + t.slice(-n) : t; };
          hist = cola(F.fldjBUieOOqXd3Bo6, 1200); notasF = cola(F.fldDkRqKrUOh2DPH1, 600); porQue = String(F.fldULHf1PxwJie889 || '').trim().slice(0, 400);
        } catch (e) { console.error('seg-wa-ia ficha', e.message); } }
        const prompt = `Escribe un WhatsApp corto (2 frases, máx. 220 caracteres) de un fisio de FISIO365 (Barcelona) a un paciente al que trató. El objetivo es que el paciente CONTESTE: el mensaje termina con UNA pregunta concreta y fácil de responder.
Datos:
- Hoy es: ${hoyF}
- Nombre del paciente: ${c(q.nombre)}
- Quién firma: ${c(q.yo)} (el fisio que le atendió)
- Última sesión: ${c(q.ultima) || 'no consta'}
- Próxima cita ya reservada: ${c(q.proxima) || 'ninguna'}
- Etapa en la clínica: ${c(q.etapas) || 'no consta'}
- Nota del seguimiento: ${c(q.nota) || 'ninguna'}
- Último contacto (llamada o WhatsApp): ${String(q.ultLlamada || '').replace(/\s+/g, ' ').trim().slice(0, 700) || 'ninguno'}
- Por qué no reagenda: ${porQue || 'no consta'}
- Notas de la ficha (lo más reciente al final): ${notasF || 'ninguna'}
- Historial clínico (lo más reciente al final; úsalo para saber qué le pasaba y cómo acabó): ${hist || 'no consta'}
Cómo escribirlo:
- Empieza con «Hola <nombre de pila>, soy ${c(q.yo)} de FISIO365.» y tutea, español de España, como lo escribiría el fisio desde su móvil: natural, cercano, nada comercial.
- Primera frase: algo concreto y reciente de esta persona (la zona que se trató en palabras sencillas —la cadera, la rodilla, la espalda—, su deporte, las plantillas, lo que quedó pendiente…). Sin diagnósticos ni datos clínicos delicados. No inventes nada que no esté en los datos.
- Termina con UNA pregunta concreta que se conteste en una línea y que, sutilmente, abra la puerta a volver. Ejemplos del estilo: «¿Cómo la notas ahora al levantarte por las mañanas?», «¿Has podido volver al pádel sin molestias?», «¿Te va bien que te guarde un hueco la semana que viene para revisarla?».
- Si el último contacto fue un WhatsApp que no ha contestado: es un segundo intento. Sin reproches ni «te escribí la semana pasada» insistente; no repitas la misma pregunta: haz otra distinta, todavía más fácil de contestar (por ejemplo, ofrecerle dos opciones o preguntarle si prefiere que le llamemos).
- Si YA tiene próxima cita, no ofrezcas hueco: pregunta algo sobre cómo está y menciona que os veis ese día.
- Referencias de tiempo: solo si salen de comparar «Hoy» con la fecha de la última sesión (p. ej. «hace un par de meses»). NUNCA menciones fiestas, estaciones ni fechas que aparezcan en el historial (puede ser antiguo).
- Tono profesional y cercano, de fisio a paciente. Nada personal ni afectivo: prohibido «pensaba en ti», «me acordaba de ti», «te echamos de menos», «tenía ganas de saber de ti» y similares.
- PROHIBIDO: «espero que…», «recuerda…», «cualquier cosa nos escribes», «aquí estamos», «no dudes en…», consejos o deberes, despedidas de relleno y emojis. Nada que se pueda leer sin contestar.
Devuelve solo el texto del mensaje, sin comillas.`;
        // Se prueban varios modelos por si alguno ya no está disponible; los errores se ven en los logs de Vercel
        let err = '';
        for (const model of ['claude-haiku-5-5', 'claude-haiku-4-5', 'claude-sonnet-4-5']) {
          try {
            const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': K, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' }, body: JSON.stringify({ model, max_tokens: 300, messages: [{ role: 'user', content: prompt }] }) });
            const j = await r.json(); const t = String(((j.content || []).find(b => b && b.type === 'text') || {}).text || '').trim().replace(/^["«]|["»]$/g, '').replace(/\p{Extended_Pictographic}\uFE0F?/gu, '').replace(/[ \t]+([.,!?])/g, '$1').replace(/[ \t]{2,}/g, ' ').trim();
            if (t) { console.log('seg-wa-ia ok', model, hist ? 'con historial' : 'sin historial'); return res.status(200).json({ ok: true, texto: t, model }); }
            err = (j.error && j.error.message) || ('HTTP ' + r.status); console.error('seg-wa-ia', model, err);
          } catch (e) { err = e.message; console.error('seg-wa-ia', model, err); }
        }
        return res.status(200).json({ ok: false, error: err });
      }
      if (action === 'seg-enc-ia') {
        // Respuesta personalizada a quien contestó una encuesta (o «está mejor»): según lo que puso, su historial y sus notas
        const K = process.env.ANTHROPIC_API_KEY; if (!K) return res.status(200).json({ ok: false, error: 'Falta la clave de la IA' });
        const c = (x, n) => String(x || '').replace(/\s+/g, ' ').trim().slice(0, n || 400);
        let hist = '', notasF = '', motivo = '';
        if (/^rec[A-Za-z0-9]{14}$/.test(q.pacienteId || '')) { try {
          const pr = await at(`${PACIENTES}/${q.pacienteId}?returnFieldsByFieldId=true`); const F = (pr && pr.fields) || {};
          const cola = (t, n) => { t = String(t || '').replace(/\*\*|`/g, '').replace(/\n{3,}/g, '\n\n').trim(); return t.length > n ? '…' + t.slice(-n) : t; };
          hist = cola(F.fldjBUieOOqXd3Bo6, 1200); notasF = cola(F.fldDkRqKrUOh2DPH1, 500);
          const pn = await at(`${PACIENTES}/${q.pacienteId}?fields[]=${encodeURIComponent('MOTIVO DE VISITA')}`).catch(() => ({})); motivo = c((pn.fields || {})['MOTIVO DE VISITA'], 300);
        } catch (e) { console.error('seg-enc-ia ficha', e.message); } }
        const que = q.tipo === 'mejora' ? `Su fisio marcó que está mejor y se le mandó un enlace para dejar una reseña en Google; ${q.resena ? 'ya fue a escribirla' : 'aún no la ha escrito'}.`
          : `Respondió la encuesta de ${q.tipo === 'fin' ? 'final de tratamiento (alta)' : 'su primera visita'} con «${c(q.valoracion, 30)}»${q.comentario ? ` y escribió: «${c(q.comentario, 500)}»` : ' y no dejó comentario'}${q.resena ? ' y fue a escribir la reseña en Google' : ''}.`;
        const objetivo = q.tipo === 'mejora' ? (q.resena ? 'Darle las gracias por la reseña.' : 'Animarle con cariño, sin insistir, a dejar la reseña: incluye el texto [ENLACE] en una línea aparte, que luego se sustituye por el enlace.')
          : q.valoracion === 'Excelente' ? (q.resena ? 'Darle las gracias por la valoración y por la reseña.' : 'Darle las gracias y pedirle, sin presión, que lo cuente en Google: incluye el texto [ENLACE] en una línea aparte, que luego se sustituye por el enlace.')
          : q.valoracion === 'Muy buena' ? 'Darle las gracias y preguntarle qué haría falta para que fuera excelente.'
          : q.comentario ? 'Agradecerle que lo cuente, decir que lo estáis revisando (refiriéndote a lo que escribió, sin repetirlo literal) y proponerle hablarlo o ponerle solución. Sin excusas ni justificaciones.'
          : 'Preguntarle con interés genuino qué podríais haber hecho mejor.';
        const prompt = `Escribe un WhatsApp corto (máx. 3 frases, ~300 caracteres sin contar el enlace) de la clínica FISIO365 (Barcelona) a un paciente.
Situación: ${que}
Objetivo: ${objetivo}
Datos del paciente (úsalos para que suene personal, nunca para dar detalles clínicos delicados):
- Nombre de pila: ${c(q.pila || q.nombre, 40)}
- Motivo de visita: ${motivo || 'no consta'}
- Notas de la ficha (lo más reciente al final): ${notasF || 'ninguna'}
- Historial clínico (lo más reciente al final): ${hist || 'no consta'}
Cómo escribirlo:
- Empieza con «Hola <nombre de pila>» o «¡Hola <nombre de pila>!». NO te presentes ni firmes con ningún nombre.
- Tutea, español de España, natural y cercano, como lo escribiría alguien de la clínica desde el móvil. Nada comercial.
- Menciona algo concreto de su caso si ayuda (la zona en palabras sencillas: la espalda, la rodilla…), sin diagnósticos ni datos delicados. No inventes nada que no esté en los datos.
- Si el objetivo es saber qué mejorar o hablarlo, termina con una pregunta fácil de contestar.
- PROHIBIDO: «espero que…», «no dudes en…», «cualquier cosa nos escribes», «aquí estamos». Como mucho un emoji.${q.tipo === 'fin' ? '\n- Es el final de su tratamiento: alégrate de que se encuentre mejor con sencillez, y cierra el mensaje con una frase corta y natural tipo «Y ya sabes que seguimos aquí para lo que necesites». Nada de «esto no es un adiós» ni nada que suene a venta.' : ''}
Devuelve solo el texto del mensaje, sin comillas.`;
        let err = '';
        for (const model of ['claude-haiku-5-5', 'claude-haiku-4-5', 'claude-sonnet-4-5']) {
          try {
            const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': K, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' }, body: JSON.stringify({ model, max_tokens: 350, messages: [{ role: 'user', content: prompt }] }) });
            const j = await r.json(); const t = String(((j.content || []).find(b => b && b.type === 'text') || {}).text || '').trim().replace(/^["«]|["»]$/g, '').trim();
            if (t) return res.status(200).json({ ok: true, texto: t });
            err = (j.error && j.error.message) || ('HTTP ' + r.status); console.error('seg-enc-ia', model, err);
          } catch (e) { err = e.message; console.error('seg-enc-ia', model, err); }
        }
        return res.status(200).json({ ok: false, error: err });
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
        if (q.resultado === 'Alta' || q.resultado === 'No volver a llamar') { let pidR = q.pacienteId; if (!/^rec[A-Za-z0-9]{14}$/.test(pidR || '') && /^rec[A-Za-z0-9]{14}$/.test(q.id || '')) { const sr = await at(`${SEG}/${q.id}`).catch(() => ({})); pidR = ((sr.fields || {}).PACIENTE || [])[0]; } await ponerEtapa(pidR, q.resultado === 'Alta' ? 'ALTA' : 'ABANDONO').catch(() => null); }
        const sigue = /^\d{4}-\d{2}-\d{2}$/.test(q.nuevaFecha || '') && ['Volver a llamar', 'No contesta', 'Pendiente de respuesta'].includes(q.resultado);
        if (!q.id) {
          // Llamada suelta (Call-in) sin seguimiento abierto: se apunta la llamada y, si hay que volver a llamar, se crea el seguimiento
          if (sigue) { const fc = { 'FECHA DE LLAMADA': q.nuevaFecha, PACIENTE: [q.pacienteId], NOTAS: String(q.nota || '') }; const rq = String(q.quien || '').trim().slice(0, 30); if (rq) fc.RESPONSABLE = rq;
            const c = await at(SEG, { method: 'POST', body: JSON.stringify({ records: [{ fields: fc }], typecast: true }) }); if (!c.error) ll['SEG ID'] = c.records[0].id; }
          const d0 = await at(LLA, { method: 'POST', body: JSON.stringify({ records: [{ fields: ll }], typecast: true }) });
          if (q.resultado === 'Cita recuperada') await porQueAlHist(q.pacienteId, '', '', ''), await at(`${PACIENTES}/${q.pacienteId}`, { method: 'PATCH', body: JSON.stringify({ fields: { 'POR QUÉ NO REAGENDA': '', 'POR QUÉ FECHA': null, 'POR QUÉ FISIO': '' } }) }).catch(() => {});
          return res.status(200).json({ ok: !d0.error, error: d0.error && d0.error.message });
        }
        ll['SEG ID'] = q.id;
        await at(LLA, { method: 'POST', body: JSON.stringify({ records: [{ fields: ll }], typecast: true }) });
        const campos = sigue ? { 'FECHA DE LLAMADA': q.nuevaFecha } : { HECHO: true };
        const d = await at(`${SEG}/${q.id}`, { method: 'PATCH', body: JSON.stringify({ fields: campos }) });
        if (q.resultado === 'Cita recuperada' && /^rec[A-Za-z0-9]{14}$/.test(q.pacienteId || '')) await porQueAlHist(q.pacienteId, '', '', ''), await at(`${PACIENTES}/${q.pacienteId}`, { method: 'PATCH', body: JSON.stringify({ fields: { 'POR QUÉ NO REAGENDA': '', 'POR QUÉ FECHA': null, 'POR QUÉ FISIO': '' } }) }).catch(() => {});
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
    // Histórico: cada motivo nuevo (o cambiado) se suma al hilo y no se pierde aunque luego se quite «No reagenda»
    await porQueAlHist(q.pacienteId, String(q.nota || '').trim(), String(q.fisio || ''), hoyF);
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
        const todos = recs.map(r => ({ id: r.id, fecha: r.fields['FECHA'] || '', tipo: r.fields['TIPO'] || '', horas: Number(r.fields['HORAS'] || 0), banco: !!r.fields['BANCO'], nota: r.fields['NOTA'] || '', por: r.fields['REGISTRADO POR'] || '', pendiente: !!r.fields['PENDIENTE VALIDAR'] }));
        const { desde, hasta } = q;
        const banco = todos.filter(r => r.banco && !r.pendiente && (!hasta || r.fecha <= hasta)).reduce((t, r) => t + r.horas, 0);
        const registros = todos.filter(r => (!desde || r.fecha >= desde) && (!hasta || r.fecha <= hasta)).sort((a, b) => a.fecha.localeCompare(b.fecha));
        return res.status(200).json({ ok: true, registros, banco });
      }
      if (req.method !== 'POST') return res.status(405).json({ ok: false });
      // Quién guarda: dirección (Rendimiento o Administración) clasifica y valida; el fisio solo explica sus días y queda pendiente de validar
      let esDir = true, yoN = '';
      if (q.yo) { const eqH = await at(`${FISIOS_TABLE}?fields[]=Name&fields[]=Password&fields[]=acc_rendimiento&fields[]=acc_admin&fields[]=${encodeURIComponent('DIRECCIÓN')}&pageSize=100`);
        const yr = (eqH.records || []).find(r => String(r.fields.Name || '').trim().toLowerCase() === String(q.yo).trim().toLowerCase());
        if (!yr || String(yr.fields.Password || '').trim() !== String(q.clave || '').trim()) return res.status(403).json({ ok: false, error: 'Vuelve a iniciar sesión.' });
        esDir = !!(yr.fields['DIRECCIÓN'] || yr.fields.acc_rendimiento || yr.fields.acc_admin); yoN = String(yr.fields.Name || '').trim().split(/\s+/)[0].toLowerCase(); }
      const previo = /^rec[A-Za-z0-9]{14}$/.test(q.id || '') ? await at(`${T}/${q.id}`) : null;
      if (!esDir) {
        if (fisio.split(/\s+/)[0].toLowerCase() !== yoN) return res.status(403).json({ ok: false, error: 'Solo puedes explicar tus propios días' });
        if (previo && previo.fields && !previo.fields['PENDIENTE VALIDAR']) return res.status(403).json({ ok: false, error: 'Dirección ya lo ha validado' });
      }
      if (action === 'horas-borrar') {
        if (!/^rec[A-Za-z0-9]{14}$/.test(q.id || '')) return res.status(400).json({ ok: false });
        await fetch(`https://api.airtable.com/v0/${BASE_ID}/${T}/${q.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } });
        return res.status(200).json({ ok: true });
      }
      if (!fisio || !/^\d{4}-\d{2}-\d{2}$/.test(q.fecha || '')) return res.status(400).json({ ok: false, error: 'Faltan datos' });
      const campos = { FECHA: q.fecha, FISIO: fisio, TIPO: String(q.tipo || 'Otro'), HORAS: Number(q.horas || 0), BANCO: esDir ? !!q.banco : false, NOTA: String(q.nota || ''), 'REGISTRADO POR': String(q.por || ''), 'PENDIENTE VALIDAR': !esDir };
      const ex = /^rec[A-Za-z0-9]{14}$/.test(q.id || '');
      const d = await at(`${T}${ex ? '/' + q.id : ''}`, { method: ex ? 'PATCH' : 'POST', body: JSON.stringify(ex ? { fields: campos, typecast: true } : { records: [{ fields: campos }], typecast: true }) });
      if (d.error) return res.status(500).json({ ok: false, error: d.error.message || 'Airtable' });
      return res.status(200).json({ ok: true, id: ex ? q.id : d.records[0].id });
    } catch (e) { return res.status(500).json({ ok: false, error: e.message }); }
  }

  // ── LISTA DE LA COMPRA (material, Fisaude): cualquiera del equipo apunta; dirección ve la lista y marca lo comprado ──
  if (action === 'compra-lista' || action === 'compra-anadir' || action === 'compra-hecho' || action === 'compra-borrar') {
    const q = req.method === 'POST' ? (req.body || {}) : req.query;
    if (!process.env.FISIO_PASSWORD || String(q.pwd || '').trim() !== process.env.FISIO_PASSWORD.trim()) return res.status(401).json({ ok: false, error: 'No autorizado' });
    const eqC = await at(`${FISIOS_TABLE}?fields[]=Name&fields[]=Password&fields[]=acc_rendimiento&fields[]=acc_admin&fields[]=${encodeURIComponent('DIRECCIÓN')}&fields[]=${encodeURIComponent('FECHA BAJA')}&pageSize=100`);
    const yc = (eqC.records || []).find(r => String(r.fields.Name || '').trim().toLowerCase() === String(q.yo || '').trim().toLowerCase());
    if (!yc || yc.fields['FECHA BAJA'] || String(yc.fields.Password || '').trim() !== String(q.clave || '').trim()) return res.status(403).json({ ok: false, error: 'Vuelve a iniciar sesión.' });
    const dirC = !!(yc.fields['DIRECCIÓN'] || yc.fields.acc_admin), yoC = String(yc.fields.Name || '').trim().split(/\s+/)[0];
    const COMPRA = 'tbl6tWCWWzZfODDns';
    const vistaC = r => ({ id: r.id, producto: r.fields.PRODUCTO || '', cantidad: r.fields.CANTIDAD || '', por: r.fields['PEDIDO POR'] || '', fecha: r.fields.FECHA || r.createdTime, nota: r.fields.NOTA || '', enlace: r.fields.ENLACE || '', comprado: !!r.fields.COMPRADO, compradoPor: r.fields['COMPRADO POR'] || '', fechaCompra: r.fields['FECHA COMPRA'] || '' });
    if (action === 'compra-anadir') {
      const producto = String(q.producto || '').trim().slice(0, 140); if (!producto) return res.status(400).json({ ok: false, error: 'Escribe qué falta' });
      const d = await at(COMPRA, { method: 'POST', body: JSON.stringify({ records: [{ fields: { PRODUCTO: producto, CANTIDAD: String(q.cantidad || '').trim().slice(0, 60), 'PEDIDO POR': String(q.por || yoC).slice(0, 40), FECHA: new Date().toISOString(), NOTA: String(q.nota || '').slice(0, 1000), ENLACE: /^https?:\/\/\S+$/i.test(String(q.enlace || '').trim()) ? String(q.enlace).trim().slice(0, 1000) : null } }] }) });
      return res.status(200).json({ ok: !d.error, item: d.records && vistaC(d.records[0]) });
    }
    if (!dirC) return res.status(403).json({ ok: false, error: 'Solo para dirección' });
    if (action === 'compra-lista') {
      const pend = []; let off = ''; do { const d = await at(`${COMPRA}?filterByFormula=${encodeURIComponent('NOT({COMPRADO})')}&pageSize=100${off ? '&offset=' + off : ''}`); pend.push(...(d.records || [])); off = d.offset || ''; } while (off);
      const hechos = await at(`${COMPRA}?filterByFormula=${encodeURIComponent('{COMPRADO}')}&sort[0][field]=${encodeURIComponent('FECHA COMPRA')}&sort[0][direction]=desc&maxRecords=15`);
      return res.status(200).json({ ok: true, pendientes: pend.map(vistaC).sort((a, b) => String(a.fecha).localeCompare(String(b.fecha))), comprados: (hechos.records || []).map(vistaC) });
    }
    if (!/^rec[A-Za-z0-9]{14}$/.test(q.id || '')) return res.status(400).json({ ok: false });
    if (action === 'compra-borrar') { const d = await at(`${COMPRA}/${q.id}`, { method: 'DELETE' }); return res.status(200).json({ ok: !d.error }); }
    const hecho = q.hecho !== false;
    const d = await at(`${COMPRA}/${q.id}`, { method: 'PATCH', body: JSON.stringify({ fields: { COMPRADO: hecho, 'COMPRADO POR': hecho ? yoC : '', 'FECHA COMPRA': hecho ? new Date().toISOString() : null } }) });
    return res.status(200).json({ ok: !d.error });
  }
  // ── PANEL: «Reporte diario» (solo dirección: Rendimiento o Administración) ──
  if (action === 'reporte-dia') {
    const q = req.method === 'POST' ? (req.body || {}) : req.query;
    if (!process.env.FISIO_PASSWORD || String(q.pwd || '').trim() !== process.env.FISIO_PASSWORD.trim()) return res.status(401).json({ ok: false, error: 'No autorizado' });
    const eqH = await at(`${FISIOS_TABLE}?fields[]=Name&fields[]=Password&fields[]=acc_rendimiento&fields[]=acc_admin&fields[]=${encodeURIComponent('DIRECCIÓN')}&pageSize=100`);
    const yr = (eqH.records || []).find(r => String(r.fields.Name || '').trim().toLowerCase() === String(q.yo || '').trim().toLowerCase());
    if (!yr || String(yr.fields.Password || '').trim() !== String(q.clave || '').trim()) return res.status(403).json({ ok: false, error: 'Vuelve a iniciar sesión.' });
    if (!(yr.fields['DIRECCIÓN'] || yr.fields.acc_rendimiento || yr.fields.acc_admin)) return res.status(403).json({ ok: false, error: 'Solo para dirección' });
    try {
      const CR = require('./cron');
      const fecha = /^\d{4}-\d{2}-\d{2}$/.test(q.fecha || '') ? q.fecha : await CR.ultimoDiaConCitas();
      return res.status(200).json({ ok: true, reporte: await CR.reporteDia(fecha) });
    } catch (e) { return res.status(500).json({ ok: false, error: 'No se ha podido preparar el reporte' }); }
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
      // Sesiones gratis (no van a Holded): se ven en la ficha junto a las facturas
      const gratis = (await capTodos(FACTURAS_TABLE, `filterByFormula=${encodeURIComponent(`AND({ESTADO}='Emitida',{PacienteId}='${pac}',{MODO DE PAGO}='Gratis')`)}`).catch(() => [])).map(r => { const f = r.fields;
        return { id: r.id, fecha: String(f['FECHA DE COBRO'] || f['FECHA'] || String(r.createdTime).slice(0, 10)).slice(0, 10), lineas: [[f['CONCEPTO 1'], f['Nº SESIONES 1']], [f['CONCEPTO 2'], f['Nº SESIONES 2']]].filter(([c]) => c).map(([c, n]) => ({ c: (c && c.name) || c, n: Number(n) || 1 })), nota: f['NOTAS'] || '' }; }).sort((a, b) => b.fecha.localeCompare(a.fecha));
      if (!HOLDED_KEY) return res.status(200).json({ ok: true, holded: false, dni, saldo, bonoPrevio, tarjetas, gratis, facturas: [] });
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
        return res.status(200).json({ ok: true, holded: true, dni, saldo: saldo2, bonoPrevio, tarjetas, gratis, enHolded: ids.length, facturas });
      }
      catch (e) { return res.status(200).json({ ok: true, holded: true, dni, saldo, bonoPrevio, tarjetas, gratis, facturas: [], error: /401|403/.test(e.message) ? 'Holded no acepta la clave (revisa la clave y sus permisos).' : 'No se han podido cargar las facturas (' + e.message + ').' }); }
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
    // Sesión gratis: no se cobra ni se hace ticket en Holded; queda apuntada (a 0 €) para que la sesión cuente como pagada
    if (q.gratis) {
      const hoyG = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date()), fG = /^\d{4}-\d{2}-\d{2}$/.test(q.fecha || '') ? q.fecha : hoyG;
      Object.assign(campos, { [FF.estado]: 'Emitida', [FF.fecha]: fG, [FF.fechaVieja]: fG, 'fldafSkOOldJ8gH70': 'Gratis', [FF.notas]: ['Gratis', String(q.notas || '').trim(), q.quien ? 'apuntado por ' + String(q.quien).split(' ')[0] : ''].filter(Boolean).join(' · ') });
      [FF.p1, FF.p2].forEach(k => { if (k in campos) campos[k] = 0; });
      global._sesPac = {}; const g = await at(FACTURAS_TABLE, { method: 'POST', body: JSON.stringify({ records: [{ fields: campos }], typecast: true }) });
      if (g.error || !g.records) return res.status(200).json({ ok: false, error: (g.error && g.error.message) || 'No se ha podido apuntar' });
      return res.status(200).json({ ok: true, gratis: true });
    }
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
  if (action === 'mi-cuenta' || action === 'cambiar-pin' || action === 'subir-foto' || action === 'app-visto' || action === 'mis-regalos' || action === 'mi-sugerencia') {
    if (!/^rec[A-Za-z0-9]{14}$/.test(patientId || '')) return res.status(400).json({ ok: false, error: 'Falta paciente' });
    const b = req.method === 'POST' ? (req.body || {}) : {};
    try {
      const p = await at(`${PACIENTES}/${patientId}`); if (p.error) return res.status(404).json({ ok: false, error: 'No encontrado' });
      const F = p.fields || {}, foto = (F['FOTO PERFIL'] || [])[0];
      const fotoUrl = foto ? ((foto.thumbnails && foto.thumbnails.large && foto.thumbnails.large.url) || foto.url) : '';
      if (action === 'app-visto') { const ahoraV = new Date().toISOString(); await at(`${PACIENTES}/${patientId}`, { method: 'PATCH', body: JSON.stringify({ fields: Object.assign({ 'ÚLTIMO ACCESO APP': ahoraV }, req.query.inst === '1' && !F['APP INSTALADA'] ? { 'APP INSTALADA': ahoraV } : {}) }) }).catch(() => {}); return res.status(200).json({ ok: true, foto: fotoUrl }); }
      if (action === 'mi-cuenta') return res.status(200).json({ ok: true, foto: fotoUrl, email: F['EMAIL'] || '' });
      if (action === 'mis-regalos') {
        const tarjetas = (await tarjetasActivas(F)).map(t => ({ codigo: t.codigo, caduca: t.caduca, por: t.por }));
        return res.status(200).json({ ok: true, tarjetas });
      }
      if (req.method !== 'POST') return res.status(405).json({ ok: false });
      if (action === 'mi-sugerencia') { // buzón de sugerencias de la app (puede ir sin nombre)
        const texto = String(b.texto || '').trim().slice(0, 3000); if (!texto) return res.status(200).json({ ok: false, error: 'Escribe tu sugerencia' });
        const anon = !!b.anonimo;
        const fields = { RESUMEN: texto.replace(/\s+/g, ' ').slice(0, 80), TEXTO: texto, ORIGEN: 'Paciente', APARTADO: 'General', ESTADO: 'Nueva', FECHA: new Date().toISOString(), 'ANÓNIMA': anon };
        if (!anon) { fields.DE = String(F['FULL NAME'] || '').trim().slice(0, 120); fields.PACIENTE = patientId; }
        const d = await at('tbll3K0ar1cZOcVjZ', { method: 'POST', body: JSON.stringify({ records: [{ fields }], typecast: true }) });
        return res.status(200).json({ ok: !!(d.records && d.records[0]), error: d.records ? undefined : 'No se ha podido enviar' });
      }
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
      const fields = 'fields[]=PacienteId&fields[]=PacienteNombre&fields[]=FisioNombre&fields[]=Fecha&fields[]=Informe&fields[]=Protocolo&fields[]=SoloFisio&fields[]=' + encodeURIComponent('RECIBI PIDE') + '&fields[]=' + encodeURIComponent('RECIBI FECHA');
      let allRecords = [];
      let offset = null;
      do {
        const off = offset ? '&offset='+offset : '';
        const r = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${INFORMES_TABLE}?${fields}&sort[0][field]=Fecha&sort[0][direction]=desc&pageSize=100${off}`,
          { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } });
        const data = await r.json();
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
          contenido: rec.fields['Informe'] || '',
          recibiPide: !!rec.fields['RECIBI PIDE'],
          recibido: rec.fields['RECIBI FECHA'] || ''
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

    // Desde la biblioteca: la explicación de cada ejercicio, y vídeo/imagen en los que no lo traen
    {
      try {
        const norm = s => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
        const F_NOMBRE = 'flda62z2UH2gXmmky', F_IMG = 'fldXYCWY9gPOh657M', F_YT = 'fldfB2hp9Ndjr0xAP', F_DESC = 'fld59uaaRP043hTUK';
        let biblio = global._biblioApp && Date.now() - global._biblioApp.t < 10 * 60e3 ? global._biblioApp.v : null;
        let offset = null;
        if (!biblio) { biblio = {}; do {
          const u = `https://api.airtable.com/v0/${BASE_ID}/${BIBLIO_TABLE}?returnFieldsByFieldId=true&fields[]=${F_NOMBRE}&fields[]=${F_IMG}&fields[]=${F_YT}&fields[]=${F_DESC}&pageSize=100${offset ? '&offset=' + offset : ''}`;
          const br = await fetch(u, { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } });
          const bd = await br.json();
          (bd.records || []).forEach(rec => {
            const f = rec.fields || {};
            const k = norm(f[F_NOMBRE]);
            if (k) biblio[k] = { yt: f[F_YT] || '', img: f[F_IMG]?.[0]?.url || '', explica: String(f[F_DESC] || '').trim() };
          });
          offset = bd.offset || null;
        } while (offset); global._biblioApp = { t: Date.now(), v: biblio }; }
        ejercicios = ejercicios.map(ej => {
          const b = biblio[norm(ej.name)];
          if (!b) return ej;
          if (b.explica && b.explica !== ej.desc) ej = { ...ej, explica: b.explica };
          if (ej.ytId) return ej;
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
module.exports.repasoEtapas = repasoEtapas;
module.exports.importeDoc = d => importeDoc(d);
module.exports.ajuste = (...a) => ajuste(...a);
module.exports.guardarAjuste = (...a) => guardarAjuste(...a);
module.exports.cierresEnviados = cierresEnviados;
module.exports.holdedApi = { holded: (...a) => holded(...a), holdedTodos: (...a) => holdedTodos(...a), activo: () => !!HOLDED_KEY };
module.exports._ogCita = ogCitaSvg;
