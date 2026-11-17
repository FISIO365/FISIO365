// ── Gastos (facturas recibidas) y banco (extractos y conciliación) ──
// Gastos: cada factura de proveedor con su IVA soportado, su retención, la cuenta que lo paga y el archivo (foto o PDF).
// La IA lee la factura y rellena los datos; se revisan y se guardan.
// Banco: se importa el extracto de cada cuenta (Norma 43, Excel o CSV; se lee en el navegador y llegan los movimientos ya limpios).
// Cada movimiento se concilia con un gasto, una o varias facturas (p. ej. la liquidación del TPV) o se marca como «no hace falta».
const crypto = require('crypto');
const PG = require('./_pg');
const FACX = require('./_facturacion');

const SQL = `
create table if not exists fac_gastos (id text primary key, actividad text not null default 'principal', fecha date not null, proveedor jsonb not null default '{}'::jsonb, numero text, categoria text, concepto text, impuestos jsonb not null default '[]'::jsonb, base numeric(12,2) not null default 0, cuota numeric(12,2) not null default 0, irpf_tipo numeric(5,2) not null default 0, irpf numeric(12,2) not null default 0, total numeric(12,2) not null default 0, cuenta text, pago jsonb not null default '{}'::jsonb, archivo jsonb, a_nombre jsonb, nota text, por text, creado timestamptz not null default now(), modificado timestamptz not null default now());
create index if not exists fac_gastos_fecha on fac_gastos (actividad, fecha);
alter table fac_gastos add column if not exists comun boolean not null default false;
alter table fac_gastos add column if not exists isp text not null default '';
alter table fac_gastos add column if not exists isp_cuota numeric(12,2) not null default 0;
alter table fac_gastos add column if not exists moneda text not null default 'EUR';
alter table fac_gastos add column if not exists importe_moneda numeric(12,2);
alter table fac_gastos add column if not exists cada int not null default 0;
create table if not exists fac_movimientos (id text primary key, cuenta text not null, fecha date not null, fvalor date, concepto text not null default '', importe numeric(12,2) not null, saldo numeric(12,2), huella text not null unique, estado text not null default 'pendiente', enlaces jsonb not null default '[]'::jsonb, nota text, importado timestamptz not null default now(), conciliado timestamptz);
create index if not exists fac_movimientos_cuenta on fac_movimientos (cuenta, fecha)
`;
const ini = { p: null };
async function db() { const D = await FACX.db(); if (!ini.p) ini.p = (async () => { for (const s of SQL.split(/;\s*\n/).map(x => x.trim()).filter(Boolean)) await D.query(s); })().catch(e => { ini.p = null; throw e; }); await ini.p; return D; }
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const isoMad = d => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(d || new Date());
const esFecha = f => /^\d{4}-\d{2}-\d{2}$/.test(String(f || ''));
const nuevoId = p => p + crypto.randomBytes(8).toString('hex');
const txt = (v, n) => String(v == null ? '' : v).trim().slice(0, n || 200);

// Categorías (las que no llevan factura no salen como «falta la factura»)
const CATEGORIAS = ['Alquiler', 'Suministros', 'Material', 'Software', 'Marketing', 'Asesoría', 'Seguros', 'Colaboradores', 'Nóminas', 'Seguridad Social', 'Impuestos', 'Comisiones bancarias', 'Formación', 'Mantenimiento', 'Equipamiento', 'Otros'];
const SIN_DOC = new Set(['Nóminas', 'Seguridad Social', 'Impuestos', 'Comisiones bancarias']);

// ── Cuentas del banco (las elige dirección: «SL», «Nora 1»…) ──
async function cuentas() { const D = await db(); const r = (await D.query(`select v from fac_config where k='cuentas'`)).rows[0]; return Array.isArray(r && r.v) ? r.v : []; }
async function guardarCuentas(L) { const D = await db();
  const v = (Array.isArray(L) ? L : []).slice(0, 30).map(c => ({ id: /^[a-z0-9]{3,20}$/.test(c.id || '') ? c.id : 'cta' + crypto.randomBytes(4).toString('hex'), nombre: txt(c.nombre, 60), iban: txt(c.iban, 40).toUpperCase().replace(/\s+/g, ' '), actividad: txt(c.actividad, 40) || 'principal' })).filter(c => c.nombre);
  await D.query(`insert into fac_config(k,v) values('cuentas',$1::jsonb) on conflict (k) do update set v=excluded.v, modificado=now()`, [JSON.stringify(v)]); return v; }

// ── Cómo se desgrava el IVA de los gastos (lo dice la gestoría) ──
// general: todo el IVA soportado se deduce al % de prorrata · sectores: lo de la actividad con IVA al 100 %, lo de la exenta nada y lo común a prorrata
// pct: el provisional del año (el definitivo del año anterior); vacío = se calcula con las facturas del año
async function ivaReg() { const D = await db(); const v = ((await D.query(`select v from fac_config where k='iva_reg'`)).rows[0] || {}).v || {}; return { modo: v.modo === 'general' ? 'general' : 'sectores', pct: v.pct == null || v.pct === '' ? null : Math.max(0, Math.min(100, Number(v.pct) || 0)) }; }
async function guardarIvaReg(o) { const D = await db(); const v = { modo: o.modo === 'general' ? 'general' : 'sectores', pct: o.pct == null || o.pct === '' ? null : Math.max(0, Math.min(100, Math.round(Number(o.pct) || 0))) };
  await D.query(`insert into fac_config(k,v) values('iva_reg',$1::jsonb) on conflict (k) do update set v=excluded.v, modificado=now()`, [JSON.stringify(v)]); return v; }
// ── Gastos ──
// isp: proveedor de fuera de España ('ue' o 'fuera'): la factura viene sin IVA y la empresa se lo repercute y soporta a sí misma (21 %)
function calcGasto(g) {
  if (g.isp === 'ue' || g.isp === 'fuera') { const base = r2((Array.isArray(g.impuestos) ? g.impuestos : []).reduce((t, x) => t + r2(x.base) + r2(x.cuota), 0));
    const irpf_tipo = Math.max(0, Math.min(50, Number(g.irpf_tipo) || 0)), irpf = r2(base * irpf_tipo / 100);
    return { impuestos: base ? [{ tipo: 0, base, cuota: 0 }] : [], base, cuota: 0, irpf_tipo, irpf, total: r2(base - irpf), isp: g.isp, isp_cuota: r2(base * 0.21) }; }
  const imp = (Array.isArray(g.impuestos) ? g.impuestos : []).map(x => { const base = r2(x.base), tipo = Math.max(0, Math.min(100, Number(x.tipo) || 0)); return { tipo, base, cuota: x.cuota != null && x.cuota !== '' ? r2(x.cuota) : r2(base * tipo / 100) }; }).filter(x => x.base || x.cuota);
  const base = r2(imp.reduce((t, x) => t + x.base, 0)), cuota = r2(imp.reduce((t, x) => t + x.cuota, 0));
  const irpf_tipo = Math.max(0, Math.min(50, Number(g.irpf_tipo) || 0)), irpf = g.irpf != null && g.irpf !== '' ? r2(g.irpf) : r2(base * irpf_tipo / 100);
  return { impuestos: imp, base, cuota, irpf_tipo, irpf, total: r2(base + cuota - irpf), isp: '', isp_cuota: 0 };
}
const provLimpio = p => { p = p || {}; return { nombre: txt(p.nombre, 160), nif: txt(p.nif, 30).toUpperCase().replace(/[^A-Z0-9]/g, ''), direccion: txt(p.direccion, 300) }; };
async function guardarGasto(o) {
  const D = await db(), c = calcGasto(o), prov = provLimpio(o.proveedor);
  if (!prov.nombre) throw new Error('Pon el proveedor');
  if (!c.total && !c.base) throw new Error('Pon el importe');
  const fecha = esFecha(o.fecha) ? o.fecha : isoMad(), cat = CATEGORIAS.includes(o.categoria) ? o.categoria : 'Otros';
  const pago = o.pago && o.pago.estado === 'pendiente' ? { estado: 'pendiente', vence: esFecha(o.pago.vence) ? o.pago.vence : null } : { estado: 'pagado', fecha: esFecha((o.pago || {}).fecha) ? o.pago.fecha : fecha, mov: (o.pago || {}).mov || null };
  const archivo = o.archivo && o.archivo.url ? { url: txt(o.archivo.url, 300), nombre: txt(o.archivo.nombre, 160), tipo: txt(o.archivo.tipo, 80) } : null;
  const aNombre = o.a_nombre && (o.a_nombre.nombre || o.a_nombre.nif) ? { nombre: txt(o.a_nombre.nombre, 160), nif: txt(o.a_nombre.nif, 30).toUpperCase() } : null;
  const mon = /^[A-Z]{3}$/.test(o.moneda || '') ? o.moneda : 'EUR', imon = mon !== 'EUR' && isFinite(Number(o.importe_moneda)) && Number(o.importe_moneda) ? r2(o.importe_moneda) : null;
  const vals = [txt(o.actividad, 40) || 'principal', fecha, prov, txt(o.numero, 60) || null, cat, txt(o.concepto, 300) || null, JSON.stringify(c.impuestos), c.base, c.cuota, c.irpf_tipo, c.irpf, c.total, txt(o.cuenta, 30) || null, pago, archivo, aNombre, txt(o.nota, 1000) || null,
    !!o.comun, c.isp, c.isp_cuota, mon, imon, [0, 1, 2, 3, 6, 12].includes(+o.cada) ? +o.cada : 0];
  if (o.id) { const ya = (await D.query(`select pago from fac_gastos where id=$1`, [o.id])).rows[0]; if (!ya) throw new Error('No encuentro ese gasto');
    if ((ya.pago || {}).mov && pago.estado === 'pagado') pago.mov = ya.pago.mov; // la conciliación se mantiene
    vals[13] = pago;
    await D.query(`update fac_gastos set actividad=$2, fecha=$3, proveedor=$4, numero=$5, categoria=$6, concepto=$7, impuestos=$8, base=$9, cuota=$10, irpf_tipo=$11, irpf=$12, total=$13, cuenta=$14, pago=$15, archivo=coalesce($16, archivo), a_nombre=$17, nota=$18, comun=$19, isp=$20, isp_cuota=$21, moneda=$22, importe_moneda=$23, cada=$24, modificado=now() where id=$1`, [o.id, ...vals]);
    return { id: o.id }; }
  const id = nuevoId('gas');
  await D.query(`insert into fac_gastos(id,actividad,fecha,proveedor,numero,categoria,concepto,impuestos,base,cuota,irpf_tipo,irpf,total,cuenta,pago,archivo,a_nombre,nota,comun,isp,isp_cuota,moneda,importe_moneda,cada,por) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)`, [id, ...vals, txt(o.por, 60) || null]);
  return { id };
}
const gastoFila = g => { ['base', 'cuota', 'irpf', 'irpf_tipo', 'total', 'isp_cuota'].forEach(k => { g[k] = Number(g[k]); }); g.falta = !g.archivo && !SIN_DOC.has(g.categoria); return g; };
async function gastos(f) { const D = await db(); const p = [f.actividad || 'principal'], w = ['(actividad=$1 or comun)'];
  if (esFecha(f.desde)) { p.push(f.desde); w.push(`fecha>=$${p.length}`); } if (esFecha(f.hasta)) { p.push(f.hasta); w.push(`fecha<=$${p.length}`); }
  if (f.categoria) { p.push(f.categoria); w.push(`categoria=$${p.length}`); }
  if (f.q) { p.push('%' + String(f.q).toLowerCase() + '%'); w.push(`(lower(proveedor->>'nombre') like $${p.length} or lower(coalesce(numero,'')) like $${p.length} or lower(coalesce(concepto,'')) like $${p.length} or lower(coalesce(proveedor->>'nif','')) like $${p.length})`); }
  let L = (await D.query(`select *, fecha::text fecha from fac_gastos where ${w.join(' and ')} order by fac_gastos.fecha desc, creado desc limit 2000`, p)).rows.map(gastoFila);
  if (f.prov) L = L.filter(g => g.proveedor.nombre === f.prov);
  if (f.filtro === 'falta') L = L.filter(g => g.falta); else if (f.filtro === 'pendiente') L = L.filter(g => (g.pago || {}).estado === 'pendiente');
  return L; }
async function gasto(id) { const D = await db(); const g = (await D.query(`select *, fecha::text fecha from fac_gastos where id=$1`, [id])).rows[0]; return g ? gastoFila(g) : null; }
async function borrarGasto(id) { const D = await db();
  await D.tx(async q => { const g = (await q.query(`delete from fac_gastos where id=$1 returning pago`, [id])).rows[0]; const mov = g && (g.pago || {}).mov;
    if (mov) await q.query(`update fac_movimientos set estado='pendiente', enlaces='[]'::jsonb, conciliado=null where id=$1`, [mov]); }); }
// Proveedores ya usados (para autocompletar): el último gasto de cada uno manda (categoría, cuenta, IVA)
async function proveedores(actividad, q) { const D = await db(), t = '%' + String(q || '').trim().toLowerCase() + '%';
  return (await D.query(`select distinct on (lower(proveedor->>'nombre')) proveedor, categoria, cuenta, concepto, irpf_tipo::float irpf_tipo, (select coalesce(max((x->>'tipo')::numeric),0) from jsonb_array_elements(impuestos) x)::float iva, actividad, comun, isp, moneda, cada from fac_gastos where (actividad=$1 or comun) and (lower(proveedor->>'nombre') like $2 or lower(coalesce(proveedor->>'nif','')) like $2) order by lower(proveedor->>'nombre'), fecha desc limit 12`, [actividad || 'principal', t])).rows; }
async function duplicado(o) { const D = await db(); const nif = provLimpio(o.proveedor).nif, num = txt(o.numero, 60); if (!num) return null;
  return (await D.query(`select id, fecha::text fecha, total::float total from fac_gastos where lower(coalesce(numero,''))=lower($1) and (($2<>'' and proveedor->>'nif'=$2) or lower(proveedor->>'nombre')=lower($3)) and id<>coalesce($4,'') limit 1`, [num, nif, provLimpio(o.proveedor).nombre, o.id || ''])).rows[0] || null; }

// Gastos que se repiten y aún no han llegado: el último de cada proveedor con «se repite» y fecha + periodo ya pasada (con 7 días de margen)
async function esperados(actividad, hoy) { const D = await db(); hoy = hoy || isoMad();
  const L = (await D.query(`select distinct on (lower(proveedor->>'nombre')) id, fecha::text fecha, proveedor, categoria, concepto, total::float total, cada, cuenta, actividad, comun, isp, moneda, irpf_tipo::float irpf_tipo, (select coalesce(max((x->>'tipo')::numeric),0) from jsonb_array_elements(impuestos) x)::float iva from fac_gastos where (actividad=$1 or comun) order by lower(proveedor->>'nombre'), fecha desc`, [actividad || 'principal'])).rows;
  return L.filter(g => g.cada > 0).map(g => { const [a, m, d] = g.fecha.split('-').map(Number), t = new Date(Date.UTC(a, m - 1 + g.cada, Math.min(d, 28))); return Object.assign(g, { toca: t.toISOString().slice(0, 10) }); })
    .filter(g => { const lim = new Date(Date.parse(g.toca) + 7 * 864e5).toISOString().slice(0, 10); return lim <= hoy; }).sort((a, b) => a.toca.localeCompare(b.toca)); }
// Proveedores: resumen por proveedor (del año) y cambiar el nombre o el NIF en todos sus gastos
async function listaProveedores(actividad, desde, hasta) { const D = await db();
  return (await D.query(`select proveedor->>'nombre' nombre, max(proveedor->>'nif') nif, count(*)::int n, sum(total)::float total, max(fecha)::text ultima, (array_agg(categoria order by fecha desc))[1] categoria, bool_or(cada>0) repite, bool_or(isp<>'') extranjero
    from fac_gastos where (actividad=$1 or comun) and fecha between $2 and $3 group by proveedor->>'nombre' order by sum(total) desc`, [actividad || 'principal', esFecha(desde) ? desde : '2000-01-01', esFecha(hasta) ? hasta : '2099-12-31'])).rows; }
async function cambiarProveedor(de, a) { const D = await db(), P = provLimpio(a); if (!P.nombre) throw new Error('Pon el nombre');
  const r = await D.query(`update fac_gastos set proveedor = proveedor || $2::jsonb where proveedor->>'nombre'=$1`, [String(de || ''), JSON.stringify({ nombre: P.nombre, nif: P.nif })]); return r.rowCount; }
async function noRepite(id) { const D = await db(); await D.query(`update fac_gastos set cada=0 where id=$1`, [id]); }
// Guarda el archivo de la factura en el almacén (como los adjuntos de las fichas)
async function subirArchivo(b64, nombre, tipo) { const D = await db(); const buf = Buffer.from(String(b64 || ''), 'base64');
  if (!buf.length || buf.length > 4.2e6) throw new Error('El archivo es demasiado grande (máx. 4 MB)');
  if (!/^(image\/(jpeg|png|webp|heic|heif)|application\/pdf)$/.test(tipo || '')) throw new Error('Sube una foto o un PDF');
  let a; await D.tx(async c => { a = await PG.guardarArchivo(c, buf, txt(nombre, 120) || 'factura', tipo); });
  return { url: a.url, nombre: a.filename, tipo: a.type }; }

// La IA lee la factura (foto o PDF) y devuelve los datos para rellenar el gasto
async function leerFactura(b64, tipo, emisor) {
  const K = process.env.ANTHROPIC_API_KEY; if (!K) throw new Error('Falta la clave de la IA');
  const doc = tipo === 'application/pdf' ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } } : { type: 'image', source: { type: 'base64', media_type: /png|webp/.test(tipo) ? tipo : 'image/jpeg', data: b64 } };
  const pide = `Es una factura (o ticket) que ha recibido una empresa española${emisor && emisor.razon ? ` («${emisor.razon}», NIF ${emisor.nif})` : ''}. Saca los datos y responde SOLO con este JSON, sin texto alrededor:
{"proveedor":{"nombre":"quien emite la factura","nif":"","direccion":""},"a_nombre":{"nombre":"a quién va la factura","nif":""},"numero":"nº de factura","fecha":"AAAA-MM-DD","concepto":"qué es, en pocas palabras y en castellano","categoria":"una de: ${CATEGORIAS.join(', ')}","impuestos":[{"tipo":21,"base":0,"cuota":0}],"irpf_tipo":0,"irpf":0,"total":0,"moneda":"EUR","pais":"código ISO de 2 letras del país del proveedor (ES, IE, US…)","vence":"AAAA-MM-DD o vacío"}
Una entrada en "impuestos" por cada tipo de IVA (0 si no lleva IVA o es exenta: tipo 0, base = importe). Importes con punto decimal. Si algo no aparece, déjalo vacío o 0.`;
  let ult;
  for (const model of ['claude-sonnet-4-5', 'claude-haiku-4-5-20251001']) {
    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': K, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' }, body: JSON.stringify({ model, max_tokens: 1200, messages: [{ role: 'user', content: [doc, { type: 'text', text: pide }] }] }) }).then(x => x.json()).catch(e => ({ error: { message: e.message } }));
    if (r.error) { ult = r.error.message; continue; }
    const t = ((r.content || []).find(x => x.type === 'text') || {}).text || '', m = t.match(/\{[\s\S]*\}/);
    if (!m) { ult = 'No se entiende la respuesta'; continue; }
    try { const j = JSON.parse(m[0]); if (!CATEGORIAS.includes(j.categoria)) j.categoria = 'Otros'; if (!esFecha(j.fecha)) j.fecha = ''; return j; } catch (e) { ult = 'No se entiende la respuesta'; }
  }
  throw new Error('No he podido leer la factura' + (ult ? ' (' + String(ult).slice(0, 80) + ')' : ''));
}

// ── Banco: movimientos ──
const normCon = s => String(s || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
async function importar(cuenta, movs) {
  const D = await db(); if (!(await cuentas()).some(c => c.id === cuenta)) throw new Error('Elige la cuenta');
  const L = (Array.isArray(movs) ? movs : []).slice(0, 5000).map(m => ({ fecha: m.fecha, fvalor: esFecha(m.fvalor) ? m.fvalor : null, concepto: txt(m.concepto, 400), importe: r2(m.importe), saldo: m.saldo == null || m.saldo === '' || !isFinite(Number(m.saldo)) ? null : r2(m.saldo) })).filter(m => esFecha(m.fecha) && m.importe);
  const vistos = {}; let nuevos = 0;
  await D.tx(async q => { for (const m of L) {
    const k = [cuenta, m.fecha, m.importe.toFixed(2), normCon(m.concepto), m.saldo == null ? '' : m.saldo.toFixed(2)].join('|'); vistos[k] = (vistos[k] || 0) + 1; // dos movimientos iguales el mismo día cuentan como dos
    const huella = crypto.createHash('sha256').update(k + '|' + vistos[k]).digest('hex').slice(0, 40);
    const r = await q.query(`insert into fac_movimientos(id,cuenta,fecha,fvalor,concepto,importe,saldo,huella) values($1,$2,$3,$4,$5,$6,$7,$8) on conflict (huella) do nothing returning id`, [nuevoId('mov'), cuenta, m.fecha, m.fvalor, m.concepto, m.importe, m.saldo, huella]);
    if (r.rows.length) nuevos++; } });
  return { leidos: L.length, nuevos, repetidos: L.length - nuevos };
}
const movFila = m => { m.importe = Number(m.importe); if (m.saldo != null) m.saldo = Number(m.saldo); return m; };
async function movimientos(f) { const D = await db(); const p = [], w = [];
  if (f.cuenta) { p.push(f.cuenta); w.push(`cuenta=$${p.length}`); }
  if (esFecha(f.desde)) { p.push(f.desde); w.push(`fecha>=$${p.length}`); } if (esFecha(f.hasta)) { p.push(f.hasta); w.push(`fecha<=$${p.length}`); }
  if (f.estado) { p.push(f.estado); w.push(`estado=$${p.length}`); }
  if (f.q) { p.push('%' + String(f.q).toLowerCase() + '%'); w.push(`(lower(concepto) like $${p.length} or importe::text like $${p.length})`); }
  return (await D.query(`select *, fecha::text fecha, fvalor::text fvalor from fac_movimientos ${w.length ? 'where ' + w.join(' and ') : ''} order by fac_movimientos.fecha desc, importado desc, id limit 3000`, p)).rows.map(movFila); }
async function resumenBanco() { const D = await db();
  return (await D.query(`select cuenta, count(*) filter (where estado='pendiente')::int pendientes, count(*)::int total, max(fecha)::text hasta, (array_agg(saldo order by fecha desc, importado desc) filter (where saldo is not null))[1]::float saldo from fac_movimientos group by cuenta`)).rows; }

// Sugerencias para un movimiento: con qué gasto o facturas casa
const dias = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / 864e5);
const palabras = s => normCon(s).split(' ').filter(w => w.length > 3 && !/^(S ?L|SLU|SOCIEDAD|LIMITADA|ESPANA|IBERIA|SERVICIOS|GRUPO|RECIBO|COMPRA|TARJETA|TRANSFERENCIA|ADEUDO|PAGO)$/.test(w));
const ES_TPV = /\b(TPV|LIQUIDACION|LIQ|DATAFONO|ABONO TARJETAS|REMESA TARJ|COMERCIO|VENTAS? TARJ)/;
const ES_TARJ = s => /tarjeta|tpv|dat[aá]fono|bizum/i.test(String(s || ''));
async function sugerencias(id) {
  const D = await db(); const m = (await D.query(`select *, fecha::text fecha from fac_movimientos where id=$1`, [id])).rows[0]; if (!m) throw new Error('No encuentro ese movimiento');
  movFila(m); const cta = (await cuentas()).find(c => c.id === m.cuenta) || {}, con = normCon(m.concepto), imp = Math.abs(m.importe), S = [];
  if (m.importe < 0) {
    const G = (await D.query(`select *, fecha::text fecha from fac_gastos where abs(total - $1) < 0.011 and fecha between ($2::date - 75) and ($2::date + 15) and coalesce(pago->>'mov','')='' order by abs(fac_gastos.fecha - $2::date) limit 10`, [imp, m.fecha])).rows.map(gastoFila);
    G.forEach(g => { const pal = palabras(g.proveedor.nombre); const nombre = pal.some(w => con.includes(w)); S.push({ tipo: 'gasto', ids: [g.id], seguro: nombre || G.length === 1 && Math.abs(dias(m.fecha, g.fecha)) <= 5, txt: `${g.proveedor.nombre} · ${g.numero || g.concepto || g.categoria}`, fecha: g.fecha, total: g.total }); });
    // Plantilla: el mismo concepto ya se concilió antes con un gasto → mismo proveedor y categoría
    const prev = (await D.query(`select m.concepto, g.proveedor, g.categoria, g.actividad, (select coalesce(max((x->>'tipo')::numeric),0) from jsonb_array_elements(g.impuestos) x)::float iva, g.irpf_tipo::float irpf_tipo, g.concepto gcon from fac_movimientos m join fac_gastos g on g.pago->>'mov' = m.id where m.estado='conciliado' and m.importe<0 order by m.fecha desc limit 400`)).rows;
    const clave = con.replace(/\d+/g, '').split(' ').filter(Boolean).slice(0, 4).join(' ');
    const pl = clave && prev.find(p => normCon(p.concepto).replace(/\d+/g, '').split(' ').filter(Boolean).slice(0, 4).join(' ') === clave);
    var plantilla = pl ? { proveedor: pl.proveedor, categoria: pl.categoria, iva: pl.iva, irpf_tipo: pl.irpf_tipo, concepto: pl.gcon, actividad: pl.actividad } : null;
  } else {
    const act = cta.actividad || null;
    const F = (await D.query(`select id, codigo, fecha::text fecha, total::float total, cliente, pagos, actividad from fac_facturas where estado='emitida' and tipo<>'rectificativa' and abs(total - $1) < 0.011 and fecha between ($2::date - 90) and ($2::date + 5) and coalesce(pagos->>'mov','')='' order by abs(fecha - $2::date) limit 10`, [imp, m.fecha])).rows;
    F.forEach(f => { const cod = normCon(f.codigo), nom = palabras((f.cliente || {}).nombre); const fuerte = (cod && con.includes(cod)) || nom.filter(w => con.includes(w)).length >= 2;
      S.push({ tipo: 'facturas', ids: [f.id], seguro: fuerte, txt: `Factura ${f.codigo} · ${(f.cliente || {}).nombre || ''}`, fecha: f.fecha, total: f.total }); });
    // Liquidación del TPV: los cobros con tarjeta de uno o varios días seguidos antes del abono (menos la comisión)
    if (ES_TPV.test(con) || !F.length) {
      const T = (await D.query(`select id, codigo, fecha::text fecha, total::float total, pagos from fac_facturas where estado='emitida' and tipo<>'rectificativa' and fecha between ($1::date - 6) and $1::date and coalesce(pagos->>'mov','')='' ${act ? 'and actividad=$2' : ''} order by fecha`, act ? [m.fecha, act] : [m.fecha])).rows.filter(f => ES_TARJ((f.pagos || {}).modo));
      const porDia = {}; T.forEach(f => { (porDia[f.fecha] = porDia[f.fecha] || []).push(f); });
      const D0 = Object.keys(porDia).sort();
      for (let i = 0; i < D0.length; i++) for (let j = i; j < D0.length && j < i + 4; j++) {
        const fs = D0.slice(i, j + 1).flatMap(d => porDia[d]), suma = r2(fs.reduce((t, f) => t + f.total, 0)), com = r2(suma - imp);
        if (com >= -0.01 && com <= Math.max(0.5, suma * 0.035)) S.push({ tipo: 'tpv', ids: fs.map(f => f.id), seguro: ES_TPV.test(con), comision: Math.max(0, com), txt: `Cobros con tarjeta ${i === j ? 'del ' + fFmt(D0[i]) : 'del ' + fFmt(D0[i]) + ' al ' + fFmt(D0[j])} · ${fs.length} factura${fs.length > 1 ? 's' : ''}`, fecha: D0[j], total: suma });
      }
    }
  }
  // Movimientos que otras veces se marcaron «sin factura» (traspasos, nóminas…): mismo concepto → misma respuesta
  if (!S.length) { const clave = con.replace(/\d+/g, '').split(' ').filter(Boolean).slice(0, 4).join(' ');
    const ig = clave && (await D.query(`select concepto, nota from fac_movimientos where estado='ignorado' and cuenta=$1 and sign(importe)=sign($2::numeric) order by fecha desc limit 300`, [m.cuenta, m.importe])).rows.find(x => normCon(x.concepto).replace(/\d+/g, '').split(' ').filter(Boolean).slice(0, 4).join(' ') === clave);
    if (ig) S.push({ tipo: 'ignorar', ids: [], motivo: ig.nota || '', seguro: true, txt: 'Sin factura' + (ig.nota ? ': ' + ig.nota : '') + ' (como otras veces)', fecha: m.fecha, total: Math.abs(m.importe) }); }
  { const tp = S.filter(x => x.tipo === 'tpv'); if (tp.length > 1) tp.forEach(x => { x.seguro = false; }); }
  S.sort((a, b) => (b.seguro - a.seguro) || Math.abs(dias(m.fecha, a.fecha)) - Math.abs(dias(m.fecha, b.fecha)));
  return { mov: m, sugerencias: S.slice(0, 8), plantilla: plantilla || null };
}
const fFmt = f => `${+f.slice(8)}/${+f.slice(5, 7)}`;
// Varias a la vez (para la lista): solo la mejor, y si es segura
async function mejores(ids) { const out = {}; for (const id of ids.slice(0, 60)) { try { const s = await sugerencias(id); if (s.sugerencias[0]) out[id] = s.sugerencias[0]; else if (s.plantilla) out[id] = { tipo: 'plantilla', txt: 'Como otras veces: ' + s.plantilla.proveedor.nombre, plantilla: s.plantilla }; } catch (e) {} } return out; }

// Conciliar: el movimiento queda unido a lo que paga o cobra, y eso queda pagado
async function conciliar(id, o) {
  const D = await db(); const m = (await D.query(`select *, fecha::text fecha from fac_movimientos where id=$1`, [id])).rows[0]; if (!m) throw new Error('No encuentro ese movimiento'); movFila(m);
  if (m.estado === 'conciliado') await desconciliar(id);
  const cta = (await cuentas()).find(c => c.id === m.cuenta) || {};
  const enl = [];
  await D.tx(async q => {
    if (o.tipo === 'ignorar') { await q.query(`update fac_movimientos set estado='ignorado', enlaces='[]'::jsonb, nota=$2, conciliado=now() where id=$1`, [id, txt(o.motivo, 200) || null]); return; }
    if (o.tipo === 'gasto') { for (const gid of (o.ids || []).slice(0, 20)) { const r = await q.query(`update fac_gastos set pago=jsonb_build_object('estado','pagado','fecha',$2::text,'mov',$3::text), cuenta=coalesce(cuenta,$4) where id=$1 returning id`, [gid, m.fecha, id, m.cuenta]); if (r.rows.length) enl.push({ tipo: 'gasto', id: gid }); } }
    else if (o.tipo === 'facturas' || o.tipo === 'tpv') {
      // Cada factura se lleva lo que le falta por cobrar; si el dinero no llega para todas, la última queda cobrada en parte
      let queda = o.tipo === 'tpv' ? Infinity : Math.abs(m.importe); const imps = o.importes || {};
      for (const fid of (o.ids || []).slice(0, 300)) { const f = (await q.query(`select total::float total, pagos from fac_facturas where id=$1 and estado='emitida' for update`, [fid])).rows[0]; if (!f) continue;
        const P = f.pagos || {}, cob = P.estado === 'parcial' ? Number(P.cobrado) || 0 : 0, falta = r2(f.total - cob); if (falta <= 0.004 && P.mov) continue;
        let ap = imps[fid] != null ? r2(imps[fid]) : Math.min(falta, queda); if (o.tipo !== 'tpv' && ap <= 0) continue; if (o.tipo === 'tpv') ap = falta; queda = r2(queda - ap);
        const cobrado = r2(cob + ap), entera = cobrado >= f.total - 0.004, movs = (P.movs || []).concat([{ mov: id, importe: ap }]);
        const N = Object.assign({}, P, { estado: entera ? 'pagada' : 'parcial', cobrado, movs, mov: id, fecha_banco: m.fecha, modo: P.modo || (o.tipo === 'tpv' ? 'Tarjeta' : 'Transferencia') });
        await q.query(`update fac_facturas set pagos=$2 where id=$1`, [fid, JSON.stringify(N)]);
        enl.push({ tipo: 'factura', id: fid, importe: ap, antes: { estado: P.estado || null, modo: P.modo || '', mov: P.mov || null, fecha_banco: P.fecha_banco || null } }); }
      // Comisión del TPV: se apunta como gasto (sin factura: la pone el banco en la liquidación)
      const com = r2(o.comision); if (o.tipo === 'tpv' && com > 0) { const gid = nuevoId('gas');
        await q.query(`insert into fac_gastos(id,actividad,fecha,proveedor,categoria,concepto,impuestos,base,total,cuenta,pago,por) values($1,$2,$3,$4,'Comisiones bancarias','Comisión del TPV',$5,$6,$6,$7,$8,'banco')`, [gid, cta.actividad || 'principal', m.fecha, { nombre: cta.nombre ? 'Banco (' + cta.nombre + ')' : 'Banco', nif: '', direccion: '' }, JSON.stringify([{ tipo: 0, base: com, cuota: 0 }]), com, m.cuenta, { estado: 'pagado', fecha: m.fecha, mov: id }]);
        enl.push({ tipo: 'gasto', id: gid, comision: com }); } }
    else throw new Error('No sé qué conciliar');
    if (!enl.length) throw new Error('Ya no está disponible (¿conciliado en otro movimiento?)');
    await q.query(`update fac_movimientos set estado='conciliado', enlaces=$2, nota=null, conciliado=now() where id=$1`, [id, JSON.stringify(enl)]);
  });
  return { ok: true, enlaces: enl };
}
async function desconciliar(id) { const D = await db();
  await D.tx(async q => { const m = (await q.query(`select enlaces from fac_movimientos where id=$1 for update`, [id])).rows[0]; if (!m) return;
    for (const e of m.enlaces || []) {
      if (e.tipo === 'gasto' && e.comision) await q.query(`delete from fac_gastos where id=$1`, [e.id]);
      else if (e.tipo === 'gasto') await q.query(`update fac_gastos set pago = pago - 'mov' where id=$1`, [e.id]);
      else if (e.tipo === 'factura') { const f = (await q.query(`select total::float total, pagos from fac_facturas where id=$1 for update`, [e.id])).rows[0]; if (!f) continue;
        const P = f.pagos || {}, movs = (P.movs || []).filter(x => x.mov !== id);
        if (!e.antes) { await q.query(`update fac_facturas set pagos = pagos - 'mov' - 'fecha_banco' - 'movs' - 'cobrado' where id=$1`, [e.id]); continue; } // conciliaciones antiguas
        let N; if (movs.length) { const cobrado = r2(movs.reduce((t, x) => t + x.importe, 0)); N = Object.assign({}, P, { movs, cobrado, mov: movs[movs.length - 1].mov, estado: cobrado >= f.total - 0.004 ? 'pagada' : 'parcial' }); }
        else { N = Object.assign({}, P); delete N.movs; delete N.cobrado; delete N.mov; delete N.fecha_banco; N.estado = e.antes.estado || 'pagada'; N.modo = e.antes.modo || ''; if (N.estado === 'pendiente') N.fecha = null; }
        await q.query(`update fac_facturas set pagos=$2 where id=$1`, [e.id, JSON.stringify(N)]); } }
    await q.query(`update fac_movimientos set estado='pendiente', enlaces='[]'::jsonb, nota=null, conciliado=null where id=$1`, [id]); }); }
// Lo que hay unido a un movimiento (para enseñarlo)
async function detalleEnlaces(m) { const D = await db(), out = [];
  for (const e of m.enlaces || []) {
    if (e.tipo === 'gasto') { const g = (await D.query(`select id, fecha::text fecha, proveedor, numero, concepto, total::float total from fac_gastos where id=$1`, [e.id])).rows[0]; if (g) out.push({ tipo: 'gasto', id: g.id, txt: `${g.proveedor.nombre} · ${g.numero || g.concepto || ''}`, total: g.total, fecha: g.fecha }); }
    else { const f = (await D.query(`select id, codigo, fecha::text fecha, total::float total, cliente from fac_facturas where id=$1`, [e.id])).rows[0]; if (f) out.push({ tipo: 'factura', id: f.id, txt: `Factura ${f.codigo} · ${(f.cliente || {}).nombre || ''}`, total: f.total, fecha: f.fecha }); } }
  return out; }
// Buscar a mano (gastos o facturas sin conciliar)
async function buscar(tipo, q, importe) { const D = await db(), t = '%' + String(q || '').trim().toLowerCase() + '%', imp = Math.abs(Number(importe) || 0);
  if (tipo === 'gasto') return (await D.query(`select id, fecha::text fecha, proveedor, numero, concepto, total::float total from fac_gastos where coalesce(pago->>'mov','')='' and ($1='%%' or lower(proveedor->>'nombre') like $1 or lower(coalesce(numero,'')) like $1 or total::text like $1) order by abs(total-$2), fecha desc limit 20`, [t, imp])).rows.map(g => ({ id: g.id, txt: `${g.proveedor.nombre} · ${g.numero || g.concepto || ''}`, fecha: g.fecha, total: g.total }));
  return (await D.query(`select id, codigo, fecha::text fecha, (total - case when pagos->>'estado'='parcial' then coalesce((pagos->>'cobrado')::numeric,0) else 0 end)::float total, cliente, pagos->>'estado' estado from fac_facturas where estado='emitida' and tipo<>'rectificativa' and (coalesce(pagos->>'mov','')='' or pagos->>'estado'='parcial') and ($1='%%' or lower(codigo) like $1 or lower(cliente->>'nombre') like $1 or total::text like $1) order by abs(total-$2), fecha desc limit 20`, [t, imp])).rows.map(f => ({ id: f.id, parcial: f.estado === 'parcial', txt: `Factura ${f.codigo} · ${(f.cliente || {}).nombre || ''}${f.estado === 'parcial' ? ' (lo que falta)' : ''}`, fecha: f.fecha, total: f.total })); }
async function borrarMovs(cuenta, ids) { const D = await db(); for (const id of ids || []) { await desconciliar(id); await D.query(`delete from fac_movimientos where id=$1 and cuenta=$2`, [id, cuenta]); } }

module.exports = { listaProveedores, cambiarProveedor, esperados, noRepite, ivaReg, guardarIvaReg, CATEGORIAS, SIN_DOC, db, cuentas, guardarCuentas, calcGasto, guardarGasto, gastos, gasto, borrarGasto, proveedores, duplicado, subirArchivo, leerFactura, importar, movimientos, resumenBanco, sugerencias, mejores, conciliar, desconciliar, detalleEnlaces, buscar, borrarMovs };
