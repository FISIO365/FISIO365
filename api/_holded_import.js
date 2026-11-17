// ── Traer de Holded lo de antes (para que Gestoría, Resultados y el 347 tengan el año entero) y los movimientos de sus cuentas del banco ──
// · Ventas (tickets, facturas y sus rectificativas) → facturas del panel marcadas como «de Holded» (no gastan numeración ni van a VeriFactu)
// · Compras → gastos · Contactos clientes → clientes guardados
// · Bancos conectados en Holded → movimientos del Banco (cada cuenta de Holded se une a una del panel por los últimos dígitos del IBAN)
// Las funciones de Holded (h) vienen de schedule.js: { holdedTodos, aNum, importeDoc, fechaMov, textoMov, importeMov }
const crypto = require('crypto');
const FACX = require('./_facturacion');
const GX = require('./_gastos');

const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const txt = (v, n) => String(v == null ? '' : v).trim().slice(0, n || 200);
const fecha = (h, d) => h.fechaMov(d) || '';
const prefijo = num => (String(num || '').match(/^[A-Za-z]+/) || [''])[0].toUpperCase() || '(sin letra)';
// Tipo de IVA de una línea: el impuesto puede venir como clave («s_iva_21»), objeto ({ rate: 21 }) o nada
function tipoIva(h, l, d) {
  for (const t of (Array.isArray(l.taxes) ? l.taxes : l.tax != null ? [l.tax] : [])) {
    if (t && typeof t === 'object') { const n = h.aNum(t.rate ?? t.percentage ?? t.percent ?? t.value); if (isFinite(n)) return n; const k = t.key || t.id || t.name; if (k) { const m = String(k).match(/(\d{1,2})(?!.*\d)/); if (m) return +m[1]; } }
    if (typeof t === 'number') return t;
    if (typeof t === 'string') { if (/exent|exempt|_0$/i.test(t)) return 0; const m = t.match(/(\d{1,2})(?!.*\d)/); if (m) return +m[1]; } }
  const tax = h.aNum(d.tax ?? d.total_tax ?? d.taxes_total), sub = h.aNum(d.subtotal ?? d.total_before_tax);
  if (tax > 0 && sub > 0) { const p = tax / sub * 100; return [4, 10, 21].reduce((a, b) => Math.abs(b - p) < Math.abs(a - p) ? b : a, 21); }
  return 0;
}
function lineas(h, d) {
  const L = (d.lines || d.items || d.products || []).map(l => { const t = tipoIva(h, l, d);
    return { concepto: txt(l.name || l.description || l.desc || 'Sin concepto', 200), uds: h.aNum(l.units ?? l.quantity) || 1, precio: h.aNum(l.price ?? l.unit_price ?? l.subtotal) || 0, dto: h.aNum(l.discount) || 0, iva: t ? { tipo: t } : { tipo: 0, exencion: 'E1' } }; })
    .filter(l => l.concepto && l.uds);
  const tot = h.importeDoc(d); let c = FACX.calcular(L);
  // Si no cuadra con el total de Holded (redondeos, descuentos globales), una sola línea con el total
  if (!L.length || (tot > 0 && Math.abs(Math.abs(c.total) - tot) > 0.05)) c = FACX.calcular([{ concepto: L[0] ? L[0].concepto : 'Venta', uds: 1, precio: tot, iva: { tipo: 0, exencion: 'E1' } }]);
  return c;
}

// Lo que hay en Holded en ese periodo, agrupado por la letra del número (para decir de qué actividad es cada serie)
async function leer(h, desde, hasta) {
  const q = `limit=200&start_date=${desde}&end_date=${hasta}`;
  const [tk, fa, rn, cn, co] = await Promise.all([
    h.holdedTodos(`/sales-receipts?${q}`, 60).catch(() => []), h.holdedTodos(`/invoices?${q}`, 60).catch(() => []),
    h.holdedTodos(`/receipt-notes?${q}`, 30).catch(() => []), h.holdedTodos(`/credit-notes?${q}`, 30).catch(() => []),
    h.holdedTodos(`/purchases?${q}`, 60).catch(() => [])]);
  const ventas = [].concat(tk.map(d => ['simplificada', d]), fa.map(d => ['completa', d]), rn.map(d => ['rect-simplificada', d]), cn.map(d => ['rect-completa', d]))
    .filter(([, d]) => d && d.id && d.document_number && (() => { const f = fecha(h, d); return f >= desde && f <= hasta; })());
  return { ventas, compras: co.filter(d => d && d.id && (() => { const f = fecha(h, d); return f >= desde && f <= hasta; })()) };
}
async function previa(h, desde, hasta) {
  const D = await GX.db(), X = await leer(h, desde, hasta);
  const ya = new Set((await D.query(`select holded from fac_facturas where holded is not null`)).rows.map(r => r.holded));
  const G = {}; X.ventas.forEach(([t, d]) => { const k = prefijo(d.document_number), g = G[k] = G[k] || { prefijo: k, n: 0, nuevas: 0, total: 0, conIva: 0, ejemplo: d.document_number, tipos: {} };
    g.n++; g.total = r2(g.total + (t.startsWith('rect') ? -1 : 1) * h.importeDoc(d)); g.tipos[t] = (g.tipos[t] || 0) + 1; if (!ya.has(String(d.id))) g.nuevas++;
    if ((d.lines || []).some(l => tipoIva(h, l, d) > 0)) g.conIva++; });
  const gya = new Set((await D.query(`select holded from fac_gastos where holded is not null`).catch(() => ({ rows: [] }))).rows.map(r => r.holded));
  return { series: Object.values(G).sort((a, b) => b.n - a.n), compras: { n: X.compras.length, nuevas: X.compras.filter(d => !gya.has(String(d.id))).length, total: r2(X.compras.reduce((t, d) => t + h.importeDoc(d), 0)) } };
}
// Traer: mapa = { prefijo: actividad } (lo que no esté, a la clínica)
async function traer(h, desde, hasta, mapa, conCompras) {
  const D = await GX.db(); await D.query(`alter table fac_gastos add column if not exists holded text`);
  const X = await leer(h, desde, hasta), C = await FACX.config(), S = (await D.query(`select id, tipo, actividad from fac_series where activa order by auto desc, orden`)).rows;
  const serie = (act, tipo) => (S.find(s => (s.actividad || 'principal') === act && s.tipo === tipo) || S.find(s => s.tipo === tipo) || S[0] || {}).id;
  let nv = 0, rep = 0, ng = 0;
  for (const [t, d] of X.ventas) {
    const hid = String(d.id), num = txt(d.document_number, 60);
    if ((await D.query(`select 1 from fac_facturas where holded=$1 or codigo=$2 limit 1`, [hid, num])).rows.length) { rep++; continue; }
    const act = (mapa || {})[prefijo(num)] || 'principal', tipo = t.startsWith('rect') ? 'rectificativa' : t, c = lineas(h, d);
    if (tipo === 'rectificativa' && c.total > 0) { c.lineas.forEach(l => { l.precio = -l.precio; }); Object.assign(c, FACX.calcular(c.lineas)); }
    const f = fecha(h, d), st = String(d.status || '').toLowerCase(), pagada = /complet|paid|pagad/.test(st) || h.aNum(d.payments_pending) === 0;
    const id = 'fac' + crypto.randomBytes(8).toString('hex'), n = -Math.floor(Math.random() * 1e12) - 1;
    await D.query(`insert into fac_facturas(id,serie,anio,numero,codigo,tipo,fecha,emisor,cliente,lineas,impuestos,base,cuota,total,holded,holded_num,pagos,nota,por,prueba,actividad)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,true,$20)`,
      [id, serie(act, tipo === 'rectificativa' ? 'rectificativa' : tipo), +f.slice(0, 4), n, num, tipo, f, C.emisor, { nombre: txt(d.contact_name || (d.contact || {}).name, 200), nif: txt(d.contact_code || (d.contact || {}).code, 30).toUpperCase() }, JSON.stringify(c.lineas), JSON.stringify(c.impuestos), c.base, c.cuota, c.total, hid, num,
        JSON.stringify(tipo === 'rectificativa' ? {} : { estado: pagada ? 'pagada' : 'pendiente', fecha: pagada ? f : null }), txt(d.notes || d.desc, 1000) || null, 'Holded (traída)', act]);
    nv++; }
  if (conCompras) for (const d of X.compras) {
    const hid = String(d.id); if ((await D.query(`select 1 from fac_gastos where holded=$1 limit 1`, [hid])).rows.length) continue;
    const c = lineas(h, d), f = fecha(h, d), imp = c.impuestos.map(i => ({ tipo: i.tipo || 0, base: i.base, cuota: i.cuota }));
    const id = 'gas' + crypto.randomBytes(8).toString('hex'), st = String(d.status || '').toLowerCase(), pagado = /complet|paid|pagad/.test(st);
    await D.query(`insert into fac_gastos(id,actividad,fecha,proveedor,numero,categoria,concepto,impuestos,base,cuota,total,pago,nota,por,holded) values($1,'principal',$2,$3,$4,'Otros',$5,$6,$7,$8,$9,$10,$11,'Holded (traída)',$12)`,
      [id, f, { nombre: txt(d.contact_name || (d.contact || {}).name || 'Proveedor', 160), nif: txt(d.contact_code || (d.contact || {}).code, 30).toUpperCase().replace(/[^A-Z0-9]/g, ''), direccion: '' }, txt(d.document_number, 60) || null, txt((c.lineas[0] || {}).concepto, 300) || null, JSON.stringify(imp), c.base, c.cuota, c.total, pagado ? { estado: 'pagado', fecha: f } : { estado: 'pendiente' }, 'Traída de Holded', hid]);
    ng++; }
  return { ventas: nv, repetidas: rep, compras: ng };
}
// Clientes de Holded → clientes guardados
async function clientes(h) { const L = await h.holdedTodos('/contacts?limit=200', 60).catch(() => []); let n = 0;
  for (const c of L) { if (c && /supplier|proveedor/i.test(String(c.type || ''))) continue; const nombre = txt(c.name || c.trade_name, 200); if (!nombre) continue;
    const a = c.bill_address || c.billing_address || {}; await FACX.guardarCliente('principal', { nombre, nif: c.code || c.vat_number || '', email: c.email || '', tel: c.mobile || c.phone || '', direccion: a.address || '', cp: a.postal_code || a.postalCode || '', ciudad: a.city || '' }).catch(() => {}); n++; }
  return n; }
// Bancos conectados en Holded → movimientos del Banco
async function bancos(h) {
  const A = await h.holdedTodos('/treasury/accounts?limit=100', 3).catch(() => []), C = await GX.cuentas(), out = [];
  for (const a of A) { const id = a && (a.id || a._id); if (!id) continue; const iban = String(a.iban || '').replace(/\s/g, ''), d4 = iban.slice(-4), nom = txt(a.name || a.alias || a.bank_name || ('Cuenta ' + d4), 60);
    if (!iban && !/bank|banco/i.test(String(a.type || a.kind || 'bank'))) continue;
    let cta = C.find(c => d4 && String(c.iban || '').replace(/\D/g, '').endsWith(d4.replace(/\D/g, '')));
    if (!cta) { cta = { id: 'cta' + crypto.randomBytes(4).toString('hex'), nombre: nom, iban, actividad: 'principal' }; C.push(cta); await GX.guardarCuentas(C); }
    let mv = []; try { mv = await h.holdedTodos(`/treasury/accounts/${id}/bank-movements?limit=200`, 40); } catch (e) { out.push({ cuenta: cta.nombre, error: e.message.slice(0, 120) }); continue; }
    const movs = mv.map(m => ({ fecha: h.fechaMov(m), concepto: h.textoMov(m), importe: h.importeMov(m), saldo: null })).filter(m => m.fecha && m.importe);
    const r = await GX.importar(cta.id, movs); out.push(Object.assign({ cuenta: cta.nombre }, r)); }
  return out; }
module.exports = { previa, traer, clientes, bancos, prefijo };
