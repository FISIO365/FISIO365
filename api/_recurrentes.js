// ── Facturas que se repiten (un club cada mes, un alquiler…): se emiten solas el día que toca y, si se quiere, se mandan por email ──
const crypto = require('crypto');
const FACX = require('./_facturacion');

const SQL = `create table if not exists fac_recurrentes (id text primary key, actividad text not null default 'principal', serie text not null, cliente jsonb not null, lineas jsonb not null, nota text, cada int not null default 1, proxima date not null, hasta date, activa boolean not null default true, enviar boolean not null default false, pagada boolean not null default false, ultima jsonb, por text, creado timestamptz not null default now())`;
const ini = { p: null };
async function db() { const D = await FACX.db(); if (!ini.p) ini.p = D.query(SQL).catch(e => { ini.p = null; throw e; }); await ini.p; return D; }
const esFecha = f => /^\d{4}-\d{2}-\d{2}$/.test(String(f || ''));
const txt = (v, n) => String(v == null ? '' : v).trim().slice(0, n || 200);
// Mismo día del mes siguiente (o el último si no existe: 31 → 30/28)
function sumaMeses(f, n) { const [a, m, d] = f.split('-').map(Number), t = new Date(Date.UTC(a, m - 1 + n, 1)), fin = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(d, fin)).padStart(2, '0')}`; }

async function guardar(o) { const D = await db();
  const c = FACX.calcular(o.lineas); if (!c.lineas.length) throw new Error('Pon al menos una línea');
  const cli = o.cliente || {}; if (!txt(cli.nombre)) throw new Error('Pon a quién va la factura');
  const s = (await D.query(`select id, tipo, actividad from fac_series where id=$1`, [o.serie])).rows[0]; if (!s) throw new Error('Elige una serie');
  if (s.tipo === 'completa' && (!txt(cli.nif) || !txt(cli.direccion))) throw new Error('La factura completa necesita NIF y dirección');
  if (!esFecha(o.proxima)) throw new Error('Pon la fecha de la próxima');
  const v = [s.actividad || 'principal', s.id, cli, JSON.stringify(c.lineas), txt(o.nota, 2000) || null, [1, 2, 3, 6, 12].includes(+o.cada) ? +o.cada : 1, o.proxima, esFecha(o.hasta) ? o.hasta : null, o.activa !== false, !!o.enviar, !!o.pagada];
  if (o.id) { await D.query(`update fac_recurrentes set actividad=$2, serie=$3, cliente=$4, lineas=$5, nota=$6, cada=$7, proxima=$8, hasta=$9, activa=$10, enviar=$11, pagada=$12 where id=$1`, [o.id, ...v]); return { id: o.id }; }
  const id = 'rec' + crypto.randomBytes(8).toString('hex');
  await D.query(`insert into fac_recurrentes(id,actividad,serie,cliente,lineas,nota,cada,proxima,hasta,activa,enviar,pagada,por) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, [id, ...v, txt(o.por, 60) || null]); return { id }; }
async function lista(actividad) { const D = await db();
  return (await D.query(`select r.*, r.proxima::text proxima, r.hasta::text hasta, s.nombre serie_nombre from fac_recurrentes r left join fac_series s on s.id=r.serie where r.actividad=$1 order by r.activa desc, r.proxima asc`, [actividad || 'principal'])).rows
    .map(r => Object.assign(r, { total: FACX.calcular(r.lineas).total })); }
async function borrar(id) { const D = await db(); await D.query(`delete from fac_recurrentes where id=$1`, [id]); }
// Las que tocan hoy (o antes, si algún día no se pudo): se emiten con la fecha de hoy y se pasa a la siguiente
async function correr(hoy, mandar) { const D = await db(), out = [];
  const L = (await D.query(`select *, proxima::text proxima, hasta::text hasta from fac_recurrentes where activa and fac_recurrentes.proxima <= $1 order by fac_recurrentes.proxima limit 50`, [hoy])).rows;
  for (const r of L) {
    // Se reserva antes de emitir (si dos procesos entran a la vez, solo uno la hace)
    const sig = sumaMeses(r.proxima, r.cada), fin = r.hasta && sig > r.hasta;
    const ok = (await D.query(`update fac_recurrentes set proxima=$2, activa=$3 where id=$1 and proxima=$4 returning id`, [r.id, sig, !fin, r.proxima])).rows.length; if (!ok) continue;
    try { const f = await FACX.emitir({ serie: r.serie, fecha: hoy, cliente: r.cliente, lineas: r.lineas, nota: r.nota, por: 'Se repite', pagos: r.pagada ? { estado: 'pagada', modo: 'Transferencia' } : { estado: 'pendiente' } });
      let env = null; if (r.enviar && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String((r.cliente || {}).email || ''))) env = await mandar(f.id, r.cliente.email).catch(e => ({ ok: false, error: e.message }));
      const ult = { factura: f.id, codigo: f.codigo, fecha: hoy, enviada: env ? !!env.ok : null };
      await D.query(`update fac_recurrentes set ultima=$2 where id=$1`, [r.id, ult]); out.push(Object.assign({ id: r.id }, ult)); }
    catch (e) { await D.query(`update fac_recurrentes set proxima=$2, activa=true, ultima=$3 where id=$1`, [r.id, r.proxima, { error: e.message, fecha: hoy }]); out.push({ id: r.id, error: e.message }); }
  }
  return out; }
module.exports = { guardar, lista, borrar, correr, sumaMeses };
