// ── Postgres en lugar de Airtable ──
// Si existe la variable DB_URL, todas las llamadas a api.airtable.com (y las subidas de adjuntos a content.airtable.com)
// se responden desde Postgres, con el mismo formato que Airtable. El resto del código no cambia.
// Sin DB_URL no hace nada.
//
// Tablas en Postgres (ver docs/POSTGRES.md):
//   registros(tabla, id, fields jsonb, creado, modificado)  · un registro de Airtable por fila, campos por NOMBRE
//   borrados(tabla, id, t)                                   · para que las cachés de otras instancias se enteren de lo borrado
//   archivos(id, clave, nombre, tipo, bytes, datos)          · adjuntos
//   contadores(tabla, campo, n)                              · campos autonuméricos
const crypto = require('crypto');
const FX = require('./_formula');
const SCHEMA = require('./_schema.json');

const DB_URL = process.env.DB_URL || '';
const APP = String(process.env.APP_URL || 'https://app.fisioterapia365.com').replace(/\/+$/, '');

// ── Esquema: tablas y campos por id y por nombre ──
const T = {}; // id → { id, name, primary, campos: Map(nombre → def), porId: Map(id → def) }
const TN = {}; // nombre → id
const limpioN = s => String(s || '').replace(/^﻿/, '').trim();
SCHEMA.tables.forEach(t => {
  const x = { id: t.id, name: t.name, primary: t.primary, campos: new Map(), porId: new Map(), suelto: new Map() };
  t.fields.forEach(f => { x.campos.set(f.name, f); x.porId.set(f.id, f); x.suelto.set(limpioN(f.name).toLowerCase(), f); });
  x.prim = x.porId.get(t.primary);
  T[t.id] = x; TN[t.name] = t.id;
});
const tablaDe = s => { s = decodeURIComponent(String(s || '')); return T[s] ? s : TN[s] || null; };
// Campo por nombre exacto, por id o (si no) sin BOM/espacios y sin mayúsculas
function campo(tb, n) { if (n == null) return null; const t = T[tb]; return t.campos.get(n) || t.porId.get(n) || t.suelto.get(limpioN(n).toLowerCase()) || null; }
const CALC = new Set(['formula', 'multipleLookupValues', 'rollup', 'count', 'createdTime', 'lastModifiedTime', 'autoNumber', 'createdBy', 'lastModifiedBy', 'button']);

// ── Conexión ──
let _db = null;
function db() {
  if (_db) return _db;
  if (global.__PG_TEST__) { _db = global.__PG_TEST__; return _db; } // PGlite en las pruebas
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: DB_URL, max: 3, idleTimeoutMillis: 10000, ssl: /localhost|127\.0\.0\.1/.test(DB_URL) ? false : { rejectUnauthorized: false } });
  _db = { query: (q, p) => pool.query(q, p), tx: async fn => { const c = await pool.connect(); try { await c.query('BEGIN'); const r = await fn(c); await c.query('COMMIT'); return r; } catch (e) { try { await c.query('ROLLBACK'); } catch (_) {} throw e; } finally { c.release(); } } };
  return _db;
}
const SQL_INIT = `
create table if not exists registros (tabla text not null, id text primary key, fields jsonb not null default '{}'::jsonb, creado timestamptz not null default now(), modificado timestamptz not null default now());
create index if not exists registros_tabla_mod on registros (tabla, modificado);
create table if not exists borrados (tabla text not null, id text not null, t timestamptz not null default now());
create index if not exists borrados_tabla_t on borrados (tabla, t);
create table if not exists archivos (id text primary key, clave text not null, nombre text, tipo text, bytes integer, datos bytea, creado timestamptz not null default now());
create table if not exists contadores (tabla text not null, campo text not null, n bigint not null default 0, primary key (tabla, campo));
alter table registros enable row level security;
alter table borrados enable row level security;
alter table archivos enable row level security;
alter table contadores enable row level security;
alter table archivos add column if not exists ruta text;
alter table registros add column if not exists orden bigint not null default (extract(epoch from clock_timestamp()) * 1000000)::bigint;`;
// orden = el orden en que Airtable devuelve los registros sin «sort» (los nuevos, al final, como allí)
// RLS activado y sin reglas: la API pública de Supabase (clave anon) no puede leer nada; solo el servidor, que entra con DB_URL

// ── Caché por tabla (en cada instancia del servidor) ──
// Se carga entera la primera vez y luego solo se piden los cambios (modificado > última vez, con 30 s de margen
// por si una escritura de otra instancia se confirmó tarde).
const CACHE = {};
const MARGEN = 30000;
async function filas(tb) {
  const c = CACHE[tb] || (CACHE[tb] = { rows: new Map(), hasta: null, cargando: null, t: 0 });
  if (c.cargando) return c.cargando;
  c.cargando = (async () => {
    const D = db();
    if (!c.hasta || Date.now() - c.t > 15 * 60000) { // primera carga (o cada 15 min, por seguridad)
      const r = await D.query('select id, fields, creado, modificado, orden from registros where tabla = $1', [tb]);
      c.rows = new Map(); let mx = 0;
      r.rows.forEach(x => { c.rows.set(x.id, fila(x)); mx = Math.max(mx, +new Date(x.modificado)); });
      c.hasta = mx ? new Date(mx) : new Date(0); c.t = Date.now();
    } else {
      const desde = new Date(c.hasta.getTime() - MARGEN);
      const r = await D.query(`select id, fields, creado, modificado, orden, false as borrado from registros where tabla = $1 and modificado > $2
        union all select id, null, null, t, null, true from borrados where tabla = $1 and t > $2`, [tb, desde]);
      let mx = c.hasta.getTime();
      r.rows.forEach(x => { if (x.borrado) { const ya = c.rows.get(x.id); if (!ya || +new Date(x.modificado) >= +ya.modificado) c.rows.delete(x.id); } else c.rows.set(x.id, fila(x)); mx = Math.max(mx, +new Date(x.modificado)); });
      c.hasta = new Date(mx);
    }
    return c.rows;
  })();
  try { return await c.cargando; } finally { c.cargando = null; }
}
const porOrden = (a, b) => (a.orden - b.orden) || (a.creado - b.creado) || (a.id < b.id ? -1 : 1);
const fila = x => ({ id: x.id, fields: typeof x.fields === 'string' ? JSON.parse(x.fields) : (x.fields || {}), creado: new Date(x.creado), modificado: new Date(x.modificado), orden: x.orden != null ? Number(x.orden) : new Date(x.creado).getTime() * 1000 });
function fueraCache(tb, id) { const c = CACHE[tb]; if (c && c.hasta) c.rows.delete(id); }

// ── Valores de campo ──
const ISO = d => (d instanceof Date && !isNaN(d)) ? d.toISOString() : null;
// Todo lo que sigue es síncrono: antes de leer se cargan en caché las tablas que hacen falta (preparar).
const filasYa = tb => (CACHE[tb] && CACHE[tb].rows) || new Map();
// Tablas que hay que tener cargadas para calcular estos campos (enlaces, lookups, fórmulas)
// salida=true: para devolver el campo (un enlace solo necesita sus ids); salida=false: para usarlo en una fórmula (necesita el nombre)
function deps(tb, fs, salida, out = new Set(), vistos = new Set()) {
  for (const f of fs) {
    if (!f) continue; const k = tb + '|' + f.id + '|' + !!salida; if (vistos.has(k)) continue; vistos.add(k);
    if (f.type === 'multipleRecordLinks') { if (!salida && T[f.o.link]) { out.add(f.o.link); deps(f.o.link, [T[f.o.link].prim], false, out, vistos); } }
    else if (f.type === 'multipleLookupValues') { const via = campo(tb, f.o.via); if (via && T[via.o.link]) { const tf = T[via.o.link].porId.get(f.o.target); if (!(tf && tf.type === 'formula' && /^\s*RECORD_ID\(\)\s*$/.test(tf.o.formula))) { out.add(via.o.link); deps(via.o.link, [tf], salida, out, vistos); } } }
    else if (f.type === 'formula') { try { const ast = FX.parse(f.o.formula); deps(tb, fDeAst(tb, ast), false, out, vistos); } catch (e) {} }
  }
  return out;
}
// Campos que usa una fórmula; RECORD_ID({enlace}) solo necesita los ids (no cuenta como uso del nombre)
function fDeAst(tb, ast) { const out = []; (function w(n) { if (!n) return; if (n.k === 'fn' && n.f === 'RECORD_ID') return; if (n.k === 'campo') out.push(campo(tb, n.n)); [n.a, n.b, n.x, ...(n.args || [])].forEach(w); })(ast); return out; }
async function preparar(tb, salida, formula) { await filas(tb); const D = deps(tb, salida || [], true); deps(tb, formula || [], false, D); for (const t of D) await filas(t); }
// Valor tal como lo devuelve la API de Airtable (campos calculados incluidos). ctx guarda lo ya calculado en esta petición.
function valorApi(tb, rec, f, ctx) {
  switch (f.type) {
    case 'createdTime': return ISO(rec.creado);
    case 'lastModifiedTime': { const k = rec.fields['__mod_' + f.id]; return (f.o && f.o.watch && f.o.watch.length) ? (k || null) : ISO(rec.modificado); }
    case 'formula': {
      const v = formulaCampo(tb, rec, f, ctx);
      if (FX.vacio(v)) return null;
      if (v instanceof Date || (v && v.__dt)) return ISO(v instanceof Date ? v : v.__dt);
      if (typeof v === 'boolean') return v ? 1 : 0;
      if (typeof v === 'number') return isFinite(v) ? v : { specialValue: 'NaN' };
      return v;
    }
    case 'multipleLookupValues': {
      const via = campo(tb, f.o.via), ids = rec.fields[via && via.name] || []; if (!ids.length) return null;
      const lt = via.o.link, tf = T[lt] && T[lt].porId.get(f.o.target); if (!tf) return null;
      if (tf.type === 'formula' && /^\s*RECORD_ID\(\)\s*$/.test(tf.o.formula)) return ids.slice();
      const rows = filasYa(lt), out = [];
      for (const id of ids) { const r = rows.get(id); if (!r) continue; const v = valorApi(lt, r, tf, ctx); if (Array.isArray(v)) out.push(...v); else if (v != null && v !== '') out.push(v); }
      return out.length ? out : null;
    }
    case 'count': return null; // el único que hay está roto en Airtable
    default: return rec.fields[f.name];
  }
}
// Valor para usar dentro de una fórmula (tipos de fórmula de Airtable)
function valorFormula(tb, rec, f, ctx) {
  const v = valorApi(tb, rec, f, ctx);
  if (FX.vacio(v) || v === false) return f.type === 'checkbox' ? false : null;
  switch (f.type) {
    case 'date': return FX.aFecha(String(v).slice(0, 10));
    case 'dateTime': case 'createdTime': case 'lastModifiedTime': return new Date(v);
    case 'number': case 'currency': case 'percent': case 'autoNumber': case 'rating': case 'duration': return typeof v === 'number' ? v : FX.numero(v);
    case 'checkbox': return !!v;
    case 'multipleRecordLinks': { const lt = f.o.link, rows = filasYa(lt), out = []; for (const id of v) { const r = rows.get(id); if (r) out.push(mostrar(lt, r, ctx)); } return out; }
    case 'multipleAttachments': return v.map(a => a.filename || '');
    case 'aiText': return v && typeof v === 'object' ? (v.value || null) : v;
    case 'formula': return (f.o && (f.o.result === 'date' || f.o.result === 'dateTime')) ? FX.aFecha(v) : v;
    default: return v;
  }
}
// Cómo se ve un registro enlazado (su campo principal como texto)
function mostrar(tb, rec, ctx) {
  const k = 'm|' + rec.id; if (ctx.f.has(k)) return ctx.f.get(k);
  const p = T[tb].prim, v = valorApi(tb, rec, p, ctx); let s = '';
  if (!FX.vacio(v)) { if (p.type === 'date') { const d = FX.aFecha(String(v).slice(0, 10)); const fm = p.o && p.o.fmt; s = FX.formatea(d, !fm || fm === 'l' ? 'M/D/YYYY' : fm); } else s = FX.texto(v); }
  ctx.f.set(k, s); return s;
}
function formulaCampo(tb, rec, f, ctx) {
  const k = rec.id + '|' + f.id; if (ctx.f.has(k)) return ctx.f.get(k);
  let v = null; try { v = evalFormula(tb, rec, FX.parse(f.o.formula), ctx); } catch (e) { v = null; }
  ctx.f.set(k, v); return v;
}
// Campos de una fórmula, resueltos una vez por fórmula y tabla
function camposDe(tb, ast, ctx) {
  let m = ctx.camposDe.get(ast); if (m && m.tb === tb) return m;
  m = { tb, defs: {} };
  for (const n of FX.campos(ast)) { const f = campo(tb, n); if (!f) throw Object.assign(new Error(`Unknown field names: ${n}`), { tipo: 'INVALID_FILTER_BY_FORMULA' }); m.defs[n] = f; }
  ctx.camposDe.set(ast, m); return m;
}
// Evalúa un árbol de fórmula sobre un registro (los campos se calculan solo si la fórmula los usa)
function evalFormula(tb, rec, ast, ctx) {
  const D = camposDe(tb, ast, ctx).defs;
  return FX.evaluar(ast, { campo: n => valorFormula(tb, rec, D[n], ctx), crudo: n => rec.fields[D[n].name], id: rec.id, creado: rec.creado, modificado: rec.modificado });
}
// Registro completo en formato de la API (con los campos calculados), sin los vacíos
function aApi(tb, rec, ctx, soloCampos, porId) {
  const t = T[tb], out = {};
  const lista = soloCampos ? soloCampos.map(n => campo(tb, n)).filter(Boolean) : [...t.campos.values()];
  for (const f of lista) {
    let v = valorApi(tb, rec, f, ctx);
    if (v == null || v === '' || v === false || (Array.isArray(v) && !v.length)) continue;
    if (f.type === 'multipleAttachments') v = v.map(a => adjPublico(a));
    out[porId ? f.id : f.name] = v;
  }
  return { id: rec.id, createdTime: ISO(rec.creado), fields: out };
}
const adjPublico = a => ({ ...a, url: a.url && a.url.startsWith('/') ? APP + a.url : a.url, thumbnails: a.thumbnails ? Object.fromEntries(Object.entries(a.thumbnails).map(([k, x]) => [k, { ...x, url: x.url && x.url.startsWith('/') ? APP + x.url : x.url }])) : a.thumbnails });

// ── Lectura (lista) ──
async function listar(tb, q) {
  const rows = await filas(tb), ctx = { f: new Map(), camposDe: new Map() };
  let L = [...rows.values()];
  const fbf = q.get('filterByFormula');
  { // Cargar antes las tablas que hacen falta (enlaces, lookups…)
    const sal = q.getAll('fields[]').concat(q.getAll('fields')), fo = [];
    if (fbf) { try { fo.push(...fDeAst(tb, FX.parse(fbf)).filter(Boolean)); } catch (e) {} }
    for (const [k, v] of q.entries()) if (/^sort\[\d+\]\[field\]$/.test(k)) fo.push(campo(tb, v));
    await preparar(tb, sal.length ? sal.map(n => campo(tb, n)) : [...T[tb].campos.values()], fo);
  }
  if (fbf) {
    let ast; try { ast = FX.parse(fbf); } catch (e) { return err(422, 'INVALID_FILTER_BY_FORMULA', 'The formula for filtering records is invalid: ' + e.message); }
    const out = [];
    try { for (const r of L) if (FX.verdad(evalFormula(tb, r, ast, ctx))) out.push(r); }
    catch (e) { return err(422, e.tipo || 'INVALID_FILTER_BY_FORMULA', e.message); }
    L = out;
  }
  // Orden: sort[i][field] / sort[i][direction]; sin orden (y en los empates), el de Airtable
  const so = [];
  for (const [k, v] of q.entries()) { const m = k.match(/^sort\[(\d+)\]\[(field|direction)\]$/); if (m) { so[+m[1]] = so[+m[1]] || {}; so[+m[1]][m[2]] = v; } }
  const S = so.filter(Boolean).filter(s => s.field);
  if (S.length) {
    const keys = new Map();
    for (const r of L) { const ks = []; for (const s of S) { const f = campo(tb, s.field); if (!f) return err(422, 'INVALID_SORT_FIELD', 'Unknown field ' + s.field); ks.push(valorFormula(tb, r, f, ctx)); } keys.set(r.id, ks); }
    L.sort((a, b) => { const A = keys.get(a.id), B = keys.get(b.id); for (let i = 0; i < S.length; i++) { const d = cmpOrden(A[i], B[i]) * (String(S[i].direction).toLowerCase() === 'desc' ? -1 : 1); if (d) return d; } return (a.creado - b.creado) || porOrden(a, b); }); // empates: por fecha de creación (como Airtable)
  } else L.sort(porOrden);
  const max = +q.get('maxRecords') || 0; if (max > 0) L = L.slice(0, max);
  const ps = Math.min(100, Math.max(1, +q.get('pageSize') || 100)), off = +(q.get('offset') || 0) || 0;
  const pag = L.slice(off, off + ps);
  const campos = q.getAll('fields[]').concat(q.getAll('fields')); const porId = q.get('returnFieldsByFieldId') === 'true';
  for (const n of campos) if (!campo(tb, n)) return err(422, 'UNKNOWN_FIELD_NAME', `Unknown field name: "${n}"`);
  const records = []; for (const r of pag) records.push(aApi(tb, r, ctx, campos.length ? campos : null, porId));
  const res = { records }; if (off + ps < L.length) res.offset = String(off + ps);
  return ok(res);
}
function cmpOrden(a, b) {
  const va = FX.vacio(a) || a === false, vb = FX.vacio(b) || b === false;
  if (va && vb) return 0; if (va) return -1; if (vb) return 1;
  if (typeof a === 'string' && typeof b === 'string') return COLL.compare(a, b); // como Airtable: sin distinguir mayúsculas ni acentos
  const d = FX.compara(a, b); return isNaN(d) ? 0 : d;
}
const COLL = new Intl.Collator('es', { sensitivity: 'base', numeric: true }); // orden «natural»: 9 antes que 31

// ── Escritura ──
const nuevoId = (p = 'rec') => { const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789', b = crypto.randomBytes(14); let s = p; for (let i = 0; i < 14; i++) s += A[b[i] % 62]; return s; };
// Convierte un valor recibido al formato guardado. Devuelve undefined si el campo no se guarda (calculado).
async function aGuardar(tb, f, v, typecast, c) {
  if (CALC.has(f.type)) return undefined;
  if (v == null || v === '' || (Array.isArray(v) && !v.length)) return null;
  switch (f.type) {
    case 'number': case 'currency': case 'percent': case 'rating': case 'duration': { const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.')); if (isNaN(n)) throw Object.assign(new Error(`Field "${f.name}" cannot accept the provided value`), { tipo: 'INVALID_VALUE_FOR_COLUMN' }); return n; }
    case 'checkbox': return v === true || v === 'true' || v === 1 || v === '1' ? true : null;
    case 'date': { const d = FX.aFecha(v); if (!d) throw Object.assign(new Error(`Field "${f.name}" cannot accept the provided value`), { tipo: 'INVALID_VALUE_FOR_COLUMN' }); return FX.formatea(d, 'YYYY-MM-DD'); }
    case 'dateTime': { const d = FX.aFecha(v); if (!d) throw Object.assign(new Error(`Field "${f.name}" cannot accept the provided value`), { tipo: 'INVALID_VALUE_FOR_COLUMN' }); return d.toISOString(); }
    case 'singleSelect': return typeof v === 'object' ? (v.name || null) : String(v);
    case 'multipleSelects': return (Array.isArray(v) ? v : String(v).split(',')).map(x => typeof x === 'object' ? x.name : String(x)).filter(Boolean);
    case 'multipleRecordLinks': {
      const L = (Array.isArray(v) ? v : [v]).map(x => typeof x === 'object' && x ? x.id : x).filter(Boolean), out = [];
      for (const x of L) {
        if (/^rec[A-Za-z0-9]{14}$/.test(x)) { out.push(x); continue; }
        if (!typecast) throw Object.assign(new Error(`Value "${x}" is not a valid record ID.`), { tipo: 'ROW_DOES_NOT_EXIST' });
        // typecast: busca por el campo principal y, si no está, lo crea
        const lt = f.o.link, rows = await filas(lt), p = T[lt].prim;
        let hit = null; for (const r of rows.values()) if (FX.texto(r.fields[p.name]).trim() === String(x).trim()) { hit = r; break; }
        if (!hit) { hit = { id: nuevoId(), fields: { [p.name]: String(x) }, creado: new Date(), modificado: new Date(), orden: Date.now() * 1000 }; await c.query('insert into registros (tabla, id, fields, creado, modificado) values ($1,$2,$3,clock_timestamp(),clock_timestamp())', [lt, hit.id, JSON.stringify(hit.fields)]); if (c.__tocadas) c.__tocadas.add(lt); }
        out.push(hit.id);
      }
      return [...new Set(out)];
    }
    case 'multipleAttachments': {
      const L = Array.isArray(v) ? v : [v], out = [];
      for (const a of L) {
        if (!a) continue;
        if (a.id && !a.url) { const ya = (c.__adjPrev || []).find(x => x.id === a.id); if (ya) out.push(ya); else { const r = await c.query('select id, clave, nombre, tipo, bytes from archivos where id = $1', [a.id]); if (r.rows[0]) out.push(adjDe(r.rows[0])); } continue; }
        if (a.url) out.push(await guardarArchivoUrl(c, a.url, a.filename));
      }
      return out;
    }
    case 'aiText': return typeof v === 'object' ? v : { state: 'generated', value: String(v), isStale: false };
    default: return typeof v === 'string' ? v : (typeof v === 'object' ? JSON.stringify(v) : String(v));
  }
}
const adjDe = r => ({ id: r.id, url: `/api/schedule?action=archivo&id=${r.id}&k=${r.clave}`, filename: r.nombre || 'archivo', size: r.bytes || 0, type: r.tipo || 'application/octet-stream',
  ...(/^image\//.test(r.tipo || '') ? { width: undefined, height: undefined, thumbnails: { small: { url: `/api/schedule?action=archivo&id=${r.id}&k=${r.clave}` }, large: { url: `/api/schedule?action=archivo&id=${r.id}&k=${r.clave}` }, full: { url: `/api/schedule?action=archivo&id=${r.id}&k=${r.clave}` } } } : {}) });
// Almacén de archivos (Supabase Storage, privado) a través de la función «archivos» de Supabase: ARCHIVOS_URL + ARCHIVOS_CLAVE.
// Sin esas variables (pruebas), los archivos se guardan dentro de Postgres (columna datos).
const ALM = { url: process.env.ARCHIVOS_URL || '', clave: process.env.ARCHIVOS_CLAVE || '' };
async function almacen(op, body) {
  if (!ALM.url) throw new Error('Sin almacén de archivos');
  const r = await _fetch(ALM.url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-clave': ALM.clave }, body: JSON.stringify({ op, ...body }) });
  const d = await r.json().catch(() => ({ ok: false, error: 'HTTP ' + r.status })); if (!d.ok) throw new Error('Almacén: ' + (d.error || r.status)); return d;
}
const rutaDe = (id, nombre) => String(process.env.ARCHIVOS_PREFIJO || '') + id + '/' + (String(nombre || 'archivo').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/\.{2,}/g, '.').replace(/^[._-]+/, '').slice(0, 120) || 'archivo');
async function guardarArchivo(c, buf, nombre, tipo) {
  const id = nuevoId('att'), clave = crypto.randomBytes(16).toString('hex');
  if (ALM.url) { const ruta = rutaDe(id, nombre); await almacen('subir', { ruta, tipo: tipo || 'application/octet-stream', b64: buf.toString('base64') });
    await c.query('insert into archivos (id, clave, nombre, tipo, bytes, ruta) values ($1,$2,$3,$4,$5,$6)', [id, clave, nombre || 'archivo', tipo || 'application/octet-stream', buf.length, ruta]); }
  else await c.query('insert into archivos (id, clave, nombre, tipo, bytes, datos) values ($1,$2,$3,$4,$5,$6)', [id, clave, nombre || 'archivo', tipo || 'application/octet-stream', buf.length, buf]);
  return adjDe({ id, clave, nombre, tipo, bytes: buf.length });
}
async function guardarArchivoUrl(c, url, nombre) {
  let buf, tipo;
  const m = String(url).match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
  if (m) { tipo = m[1] || 'application/octet-stream'; buf = m[2] ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3])); }
  else {
    const p = String(url).match(/[?&]action=archivo&id=(att[A-Za-z0-9]{14})&k=([0-9a-f]+)/); // un adjunto nuestro: se copia (en el almacén, apunta al mismo archivo)
    if (p) { const r = await c.query('select nombre, tipo, bytes, datos, ruta from archivos where id = $1 and clave = $2', [p[1], p[2]]); const x = r.rows[0];
      if (x && x.ruta) { const id = nuevoId('att'), clave = crypto.randomBytes(16).toString('hex'); await c.query('insert into archivos (id, clave, nombre, tipo, bytes, ruta) values ($1,$2,$3,$4,$5,$6)', [id, clave, nombre || x.nombre, x.tipo, x.bytes, x.ruta]); return adjDe({ id, clave, nombre: nombre || x.nombre, tipo: x.tipo, bytes: x.bytes }); }
      if (x) return guardarArchivo(c, Buffer.from(x.datos), nombre || x.nombre, x.tipo); }
    const r = await _fetch(url); if (!r.ok) throw Object.assign(new Error('No se ha podido descargar el adjunto'), { tipo: 'INVALID_ATTACHMENT_OBJECT' });
    buf = Buffer.from(await r.arrayBuffer()); tipo = r.headers.get('content-type') || 'application/octet-stream';
  }
  return guardarArchivo(c, buf, nombre || String(url).split('/').pop().split('?')[0].slice(0, 120), tipo);
}
// Mantiene los dos lados de un enlace (como Airtable)
async function enlaces(c, tb, id, f, antes, despues, tocadas) {
  const lt = f.o.link, inv = T[lt] && T[lt].porId.get(f.o.inverse); if (!inv) return;
  const A = new Set(antes || []), B = new Set(despues || []);
  const quita = [...A].filter(x => !B.has(x)), pone = [...B].filter(x => !A.has(x));
  for (const [lista, add] of [[quita, false], [pone, true]]) for (const oid of lista) {
    const r = await c.query('select fields from registros where tabla = $1 and id = $2 for update', [lt, oid]); if (!r.rows[0]) continue;
    const F = typeof r.rows[0].fields === 'string' ? JSON.parse(r.rows[0].fields) : r.rows[0].fields;
    const cur = new Set(F[inv.name] || []); if (add) cur.add(id); else cur.delete(id);
    if (cur.size) F[inv.name] = [...cur]; else delete F[inv.name];
    await c.query('update registros set fields = $3, modificado = clock_timestamp() where tabla = $1 and id = $2', [lt, oid, JSON.stringify(F)]);
    tocadas.add(lt);
  }
}
async function contador(c, tb, f) { const r = await c.query('insert into contadores (tabla, campo, n) values ($1,$2,1) on conflict (tabla, campo) do update set n = contadores.n + 1 returning n', [tb, f.id]); return +r.rows[0].n; }

async function escribir(tb, metodo, body, idUrl) {
  const D = db(), typecast = !!body.typecast, unico = !!(body.fields && !body.records);
  const items = unico ? [{ id: idUrl, fields: body.fields }] : (body.records || []);
  if (!items.length) return err(422, 'INVALID_REQUEST_MISSING_FIELDS', 'Could not find field "records" in the request body');
  if (items.length > 10) return err(422, 'INVALID_RECORDS', 'You can only create/update up to 10 records per request');
  const tocadas = new Set([tb]);
  let res;
  try {
    res = await D.tx(async c => {
      c.__tocadas = tocadas; const out = [];
      for (const it of items) {
        const nuevo = metodo === 'POST';
        let id = nuevo ? nuevoId() : (it.id || idUrl), prev = {};
        if (!nuevo) {
          if (!/^rec[A-Za-z0-9]{14}$/.test(String(id || ''))) throw Object.assign(new Error('Invalid record id'), { tipo: 'NOT_FOUND', st: 404 });
          const r = await c.query('select fields from registros where tabla = $1 and id = $2 for update', [tb, id]);
          if (!r.rows[0]) throw Object.assign(new Error('Could not find record ' + id), { tipo: 'NOT_FOUND', st: 404 });
          prev = typeof r.rows[0].fields === 'string' ? JSON.parse(r.rows[0].fields) : r.rows[0].fields;
        }
        const F = metodo === 'PUT' ? {} : { ...prev };
        if (metodo === 'PUT') Object.keys(prev).filter(k => k.startsWith('__') || (campo(tb, k) && CALC.has(campo(tb, k).type)) || (campo(tb, k) && campo(tb, k).type === 'multipleRecordLinks' && !(it.fields || {}).hasOwnProperty(k))).forEach(k => { F[k] = prev[k]; });
        for (const [k, v] of Object.entries(it.fields || {})) {
          const f = campo(tb, k); if (!f) throw Object.assign(new Error(`Unknown field name: "${k}"`), { tipo: 'UNKNOWN_FIELD_NAME' });
          if (f.type === 'multipleAttachments') c.__adjPrev = prev[f.name] || [];
          const g = await aGuardar(tb, f, v, typecast, c);
          if (g === undefined) continue;
          if (g === null) delete F[f.name]; else F[f.name] = g;
        }
        // Campos que se rellenan solos: autonumérico y «última modificación» de campos concretos
        const t = T[tb];
        for (const f of t.campos.values()) {
          if (f.type === 'autoNumber' && nuevo) F[f.name] = await contador(c, tb, f);
          if (f.type === 'lastModifiedTime' && f.o && f.o.watch && f.o.watch.length) {
            const cambia = f.o.watch.some(w => { const wf = t.porId.get(w); return wf && JSON.stringify(prev[wf.name]) !== JSON.stringify(F[wf.name]); });
            if (cambia) F['__mod_' + f.id] = new Date().toISOString();
          }
        }
        if (nuevo) await c.query('insert into registros (tabla, id, fields, creado, modificado) values ($1,$2,$3,clock_timestamp(),clock_timestamp())', [tb, id, JSON.stringify(F)]);
        else await c.query('update registros set fields = $3, modificado = clock_timestamp() where tabla = $1 and id = $2', [tb, id, JSON.stringify(F)]);
        for (const f of t.campos.values()) if (f.type === 'multipleRecordLinks' && JSON.stringify(prev[f.name] || []) !== JSON.stringify(F[f.name] || [])) await enlaces(c, tb, id, f, prev[f.name], F[f.name], tocadas);
        out.push(id);
      }
      return out;
    });
  } catch (e) { return err(e.st || 422, e.tipo || 'INVALID_REQUEST_UNKNOWN', e.message); }
  // Releer (y refrescar la caché de esta instancia) para devolverlo con los campos calculados
  const ctx = { f: new Map(), camposDe: new Map() };
  for (const t of tocadas) if (CACHE[t] && CACHE[t].hasta) await filas(t);
  await preparar(tb, [...T[tb].campos.values()]); const rows = filasYa(tb), recs = [];
  for (const id of res) { const r = rows.get(id); if (r) recs.push(aApi(tb, r, ctx, null, body.returnFieldsByFieldId)); }
  return ok(unico ? recs[0] : { records: recs });
}
async function borrar(tb, ids) {
  const D = db(), hechos = [];
  try {
    await D.tx(async c => {
      const tocadas = new Set();
      for (const id of ids) {
        const r = await c.query('delete from registros where tabla = $1 and id = $2 returning fields', [tb, id]);
        if (!r.rows[0]) throw Object.assign(new Error('Could not find record ' + id), { tipo: 'NOT_FOUND', st: 404 });
        const F = typeof r.rows[0].fields === 'string' ? JSON.parse(r.rows[0].fields) : r.rows[0].fields;
        await c.query('insert into borrados (tabla, id, t) values ($1,$2,clock_timestamp())', [tb, id]);
        for (const f of T[tb].campos.values()) if (f.type === 'multipleRecordLinks' && (F[f.name] || []).length) await enlaces(c, tb, id, f, F[f.name], [], tocadas);
        hechos.push(id);
      }
    });
  } catch (e) { return err(e.st || 422, e.tipo || 'INVALID_REQUEST_UNKNOWN', e.message); }
  hechos.forEach(id => fueraCache(tb, id));
  return ok(ids.length === 1 && !ids.multi ? { id: hechos[0], deleted: true } : { records: hechos.map(id => ({ id, deleted: true })) });
}
// Subida de un adjunto (content.airtable.com/v0/{base}/{recordId}/{campo}/uploadAttachment)
async function subirAdjunto(recId, campoId, body) {
  const D = db();
  const r0 = await D.query('select tabla from registros where id = $1', [recId]); if (!r0.rows[0]) return err(404, 'NOT_FOUND', 'Could not find record');
  const tb = r0.rows[0].tabla, f = campo(tb, campoId); if (!f || f.type !== 'multipleAttachments') return err(422, 'INVALID_FIELD', 'Not an attachment field');
  try {
    await D.tx(async c => {
      const r = await c.query('select fields from registros where tabla = $1 and id = $2 for update', [tb, recId]);
      const F = typeof r.rows[0].fields === 'string' ? JSON.parse(r.rows[0].fields) : r.rows[0].fields;
      const a = await guardarArchivo(c, Buffer.from(String(body.file || ''), 'base64'), body.filename, body.contentType);
      F[f.name] = (F[f.name] || []).concat([a]);
      await c.query('update registros set fields = $3, modificado = clock_timestamp() where tabla = $1 and id = $2', [tb, recId, JSON.stringify(F)]);
    });
  } catch (e) { return err(422, 'INVALID_REQUEST_UNKNOWN', e.message); }
  await preparar(tb, [...T[tb].campos.values()]); const rec = filasYa(tb).get(recId), ctx = { f: new Map(), camposDe: new Map() };
  const out = aApi(tb, rec, ctx, null, true);
  return ok({ id: recId, createdTime: out.createdTime, fields: out.fields });
}
// Adjunto guardado (lo sirve schedule.js en ?action=archivo)
// Para servir un adjunto: si está en el almacén, un enlace temporal firmado (se guarda 50 min); si no, el contenido
const _firmas = new Map();
async function archivo(id, k) {
  if (!/^att[A-Za-z0-9]{14}$/.test(String(id || '')) || !/^[0-9a-f]{32}$/.test(String(k || ''))) return null;
  const r = await db().query('select nombre, tipo, ruta, case when ruta is null then datos end as datos from archivos where id = $1 and clave = $2', [id, k]);
  const x = r.rows[0]; if (!x) return null;
  if (x.ruta) {
    const f = _firmas.get(x.ruta); if (f && f.t > Date.now()) return { nombre: x.nombre, tipo: x.tipo, redirigir: f.u };
    const d = await almacen('firmar', { rutas: [x.ruta], segundos: 3600 }); const u = d.urls && d.urls[x.ruta]; if (!u) return null;
    if (_firmas.size > 2000) _firmas.clear(); _firmas.set(x.ruta, { u, t: Date.now() + 50 * 60000 });
    return { nombre: x.nombre, tipo: x.tipo, redirigir: u };
  }
  return { nombre: x.nombre, tipo: x.tipo, datos: Buffer.from(x.datos || []) };
}

// ── Respuestas con forma de fetch ──
const ok = j => new Response(JSON.stringify(j), { status: 200, headers: { 'Content-Type': 'application/json' } });
const err = (st, type, message) => new Response(JSON.stringify({ error: { type, message } }), { status: st, headers: { 'Content-Type': 'application/json' } });

// ── Esquema (meta API) ──
function meta() {
  return ok({ tables: SCHEMA.tables.map(t => ({ id: t.id, name: t.name, primaryFieldId: t.primary, fields: t.fields.map(f => ({ id: f.id, name: f.name, type: f.type })) })) });
}

// ── Enrutado de una petición a Airtable ──
async function responder(url, o) {
  const u = new URL(url), metodo = String((o && o.method) || 'GET').toUpperCase();
  let body = {}; if (o && o.body) { try { body = typeof o.body === 'string' ? JSON.parse(o.body) : o.body; } catch (e) { return err(422, 'INVALID_REQUEST_BODY', 'Invalid JSON'); } }
  if (u.hostname === 'content.airtable.com') { const m = u.pathname.match(/^\/v0\/[^/]+\/([^/]+)\/([^/]+)\/uploadAttachment$/); if (m) return subirAdjunto(m[1], decodeURIComponent(m[2]), body); return err(404, 'NOT_FOUND', ''); }
  if (/^\/v0\/meta\//.test(u.pathname)) return meta();
  const m = u.pathname.match(/^\/v0\/([^/]+)\/([^/]+)(?:\/([^/]+))?\/?$/); if (!m) return err(404, 'NOT_FOUND', 'Could not find what you are looking for');
  const tb = tablaDe(m[2]);
  if (!tb) return err(404, 'TABLE_NOT_FOUND', 'Could not find table ' + decodeURIComponent(m[2]) + ' in application ' + m[1]);
  const rid = m[3] ? decodeURIComponent(m[3]) : null;
  if (metodo === 'GET' && rid) {
    await preparar(tb, [...T[tb].campos.values()]); const r = filasYa(tb).get(rid);
    if (!r) return err(404, 'MODEL_ID_NOT_FOUND', 'Invalid record id');
    const ctx = { f: new Map(), camposDe: new Map() };
    return ok(aApi(tb, r, ctx, null, u.searchParams.get('returnFieldsByFieldId') === 'true'));
  }
  if (metodo === 'GET') return listar(tb, u.searchParams);
  if (metodo === 'POST' && rid === 'listRecords') { const q = new URLSearchParams(); Object.entries(body).forEach(([k, v]) => { if (k === 'fields') v.forEach(x => q.append('fields[]', x)); else if (k === 'sort') v.forEach((s, i) => { q.set(`sort[${i}][field]`, s.field); if (s.direction) q.set(`sort[${i}][direction]`, s.direction); }); else q.set(k, String(v)); }); return listar(tb, q); }
  if (metodo === 'POST') return escribir(tb, 'POST', body, null);
  if (metodo === 'PATCH' || metodo === 'PUT') return escribir(tb, metodo, body, rid);
  if (metodo === 'DELETE') { const ids = rid ? [rid] : u.searchParams.getAll('records[]'); if (!rid) ids.multi = true; return borrar(tb, ids); }
  return err(405, 'METHOD_NOT_ALLOWED', '');
}

// ── Engancha fetch ──
const _fetch = global.fetch;
let _init = null;
async function iniciar() { if (!_init) _init = (async () => { if (!global.__PG_TEST__) { for (const s of SQL_INIT.split(';').map(x => x.trim()).filter(Boolean)) await db().query(s); } })().catch(e => { _init = null; throw e; }); return _init; }
const ACTIVO = !!(DB_URL || global.__PG_TEST__);
if (ACTIVO && global.fetch && !global.fetch._pg) {
  const nf = async (u, o) => {
    const url = String(u && u.url ? u.url : u);
    // Versión de prueba (SIN_ENVIOS=1): no sale ningún email, cobro ni cambio en Holded; se hace como si hubiera ido bien
    if (process.env.SIN_ENVIOS && /^https:\/\/api\.(brevo|stripe|holded)\.com\//.test(url) && String((o && o.method) || 'GET').toUpperCase() !== 'GET') { console.log('SIN_ENVIOS:', url.split('?')[0]); return new Response(JSON.stringify({ messageId: 'prueba', id: 'prueba' }), { status: 201, headers: { 'Content-Type': 'application/json' } }); }
    const nuestra = /^https:\/\/api\.airtable\.com\/v0\//.test(url) || /^https:\/\/content\.airtable\.com\/v0\//.test(url);
    // Otra base de Airtable (no la de la clínica) con una tabla que no tenemos: se deja pasar si aún hay token
    if (!nuestra) return _fetch(u, o);
    const mb = url.match(/\/v0\/(app[A-Za-z0-9]{14})\/([^/?]+)/);
    if (mb && !tablaDe(mb[2]) && mb[1] !== SCHEMA.baseId && process.env.AIRTABLE_TOKEN) return _fetch(u, o);
    try { await iniciar(); return await responder(url, o); }
    catch (e) { console.error('PG', e && e.message); return err(503, 'SERVICE_UNAVAILABLE', 'Base de datos no disponible: ' + (e && e.message)); }
  };
  nf._pg = 1; nf._marca = _fetch && _fetch._marca; nf._base = 1; global.fetch = nf;
}

module.exports = { ACTIVO, responder, archivo, SQL_INIT, T, campo, _cache: CACHE, filas, iniciar, db, fetchReal: _fetch, almacen, rutaDe, ALM };
