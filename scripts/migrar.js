// Copia la base de Airtable de la clínica a Postgres (ver docs/POSTGRES.md).
//
//   AIRTABLE_TOKEN=… DB_URL=postgres://… node scripts/migrar.js            copia todo (se puede repetir: actualiza y borra lo que ya no está)
//   … node scripts/migrar.js --sin-adjuntos                                 sin descargar los archivos (más rápido, para probar)
//   … node scripts/migrar.js --tabla tblTPlcuiSjQngkaD                      solo una tabla
//
// Solo LEE de Airtable. En Postgres escribe con «upsert»: repetirlo el día del cambio copia lo nuevo y lo modificado,
// y borra lo que se haya borrado en Airtable.
const FETCH0 = global.fetch; // el fetch de verdad (api/_pg.js lo cambia si hay DB_URL)
const S = require('../api/_schema.json');
const BASE = process.env.AIRTABLE_BASE_ID || S.baseId;
const CALC = new Set(['formula', 'multipleLookupValues', 'rollup', 'count', 'createdTime', 'lastModifiedTime', 'createdBy', 'lastModifiedBy', 'button']);
const crypto = require('crypto');

async function migrar({ db, fetch: F = FETCH0, token = process.env.AIRTABLE_TOKEN, adjuntos = true, tabla = null, log = console.log }) {
  const SQL = require('../api/_pg.js').SQL_INIT;
  for (const s of SQL.split(';').map(x => x.trim()).filter(Boolean)) await db.query(s);
  const H = { Authorization: `Bearer ${token}` };
  const espera = ms => new Promise(r => setTimeout(r, ms));
  const pide = async u => { for (let i = 0; ; i++) { const r = await F(u, { headers: H }); if (r.status === 429 && i < 8) { await espera(1000 * (i + 1)); continue; } const d = await r.json(); if (d.error) throw new Error(JSON.stringify(d.error)); return d; } };
  // Antes de copiar: si en Airtable hay campos o tablas que no están en api/_schema.json, se pararía aquí
  // (si no, esos campos no se copiarían y se perderían sin avisar)
  if (!tabla && !process.argv.includes('--sin-comprobar')) {
    const vivas = [];
    for (const b of [...new Set(S.tables.map(t => t.base || BASE))]) { const m = await pide(`https://api.airtable.com/v0/meta/bases/${b}/tables`); for (const t of m.tables || []) vivas.push({ b, t }); }
    const mio = new Map(S.tables.map(t => [t.id, t])), faltan = [];
    for (const { b, t } of vivas) { const s = mio.get(t.id); if (!s) { if (b === BASE) faltan.push(`tabla «${t.name}» (${t.id})`); continue; }
      const ids = new Set(s.fields.map(f => f.id)); for (const f of t.fields) if (!ids.has(f.id)) faltan.push(`${t.name} › «${f.name}» (${f.type}, ${f.id})`); }
    if (faltan.length) throw new Error('Faltan en api/_schema.json (añádelos antes de copiar):\n  ' + faltan.join('\n  '));
    log('Esquema: al día');
  }
  const adjCache = new Map(); // id de Airtable → nuestro adjunto (si el mismo archivo está en varios sitios)
  const resumen = {};
  for (const t of S.tables) {
    if (tabla && t.id !== tabla) continue;
    const campos = new Map(t.fields.map(f => [f.name, f]));
    let off = '', n = 0, nAdj = 0; const vistos = new Set(); let maxAuto = {};
    do {
      const d = await pide(`https://api.airtable.com/v0/${t.base || BASE}/${t.id}?pageSize=100${off ? '&offset=' + off : ''}`);
      for (const r of d.records) {
        const out = {};
        for (const [k, v] of Object.entries(r.fields || {})) {
          const f = campos.get(k); if (!f) continue;
          if (f.type === 'lastModifiedTime' && f.o && f.o.watch && f.o.watch.length) { out['__mod_' + f.id] = v; continue; }
          if (CALC.has(f.type)) continue;
          if (f.type === 'autoNumber') { maxAuto[f.id] = Math.max(maxAuto[f.id] || 0, +v || 0); out[k] = v; continue; }
          if (f.type === 'multipleAttachments' && Array.isArray(v)) {
            if (!adjuntos) { out[k] = v.map(a => ({ id: a.id, url: a.url, filename: a.filename, size: a.size, type: a.type })); continue; }
            const L = [];
            for (const a of v) {
              if (adjCache.has(a.id)) { L.push(adjCache.get(a.id)); continue; }
              const rr = await F(a.url); if (!rr.ok) { log(`  ! no se pudo bajar ${a.filename} (${t.name} ${r.id})`); continue; }
              const buf = Buffer.from(await rr.arrayBuffer()), id = 'att' + a.id.slice(3), clave = crypto.randomBytes(16).toString('hex');
              await db.query('insert into archivos (id, clave, nombre, tipo, bytes, datos) values ($1,$2,$3,$4,$5,$6) on conflict (id) do nothing', [id, clave, a.filename, a.type, buf.length, buf]);
              const k2 = (await db.query('select clave from archivos where id = $1', [id])).rows[0].clave;
              const x = { id, url: `/api/schedule?action=archivo&id=${id}&k=${k2}`, filename: a.filename, size: buf.length, type: a.type, ...(/^image\//.test(a.type || '') ? { thumbnails: { small: { url: `/api/schedule?action=archivo&id=${id}&k=${k2}` }, large: { url: `/api/schedule?action=archivo&id=${id}&k=${k2}` }, full: { url: `/api/schedule?action=archivo&id=${id}&k=${k2}` } } } : {}) };
              adjCache.set(a.id, x); L.push(x); nAdj++;
            }
            if (L.length) out[k] = L; continue;
          }
          out[k] = v;
        }
        await db.query(`insert into registros (tabla, id, fields, creado, modificado) values ($1,$2,$3,$4,clock_timestamp())
          on conflict (id) do update set fields = excluded.fields, modificado = clock_timestamp() where registros.fields is distinct from excluded.fields`, [t.id, r.id, JSON.stringify(out), r.createdTime]);
        vistos.add(r.id); n++;
      }
      off = d.offset || '';
      await espera(220); // Airtable: máximo 5 peticiones por segundo
    } while (off);
    // Lo que ya no está en Airtable se borra también aquí
    const ya = (await db.query('select id from registros where tabla = $1', [t.id])).rows.map(x => x.id).filter(id => !vistos.has(id));
    for (const id of ya) { await db.query('delete from registros where id = $1', [id]); await db.query('insert into borrados (tabla, id, t) values ($1,$2,clock_timestamp())', [t.id, id]); }
    for (const [fid, mx] of Object.entries(maxAuto)) await db.query('insert into contadores (tabla, campo, n) values ($1,$2,$3) on conflict (tabla, campo) do update set n = greatest(contadores.n, excluded.n)', [t.id, fid, mx]);
    resumen[t.name] = { registros: n, adjuntos: nAdj, borrados: ya.length };
    log(`${t.name}: ${n} registros, ${nAdj} adjuntos${ya.length ? `, ${ya.length} borrados` : ''}`);
  }
  return resumen;
}

if (require.main === module) {
  const arg = process.argv.slice(2), val = k => { const i = arg.indexOf(k); return i >= 0 ? arg[i + 1] : null; };
  if (!process.env.AIRTABLE_TOKEN || !process.env.DB_URL) { console.error('Faltan AIRTABLE_TOKEN y DB_URL'); process.exit(1); }
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: process.env.DB_URL, max: 2, ssl: /localhost|127\.0\.0\.1/.test(process.env.DB_URL) ? false : { rejectUnauthorized: false } });
  migrar({ db: pool, adjuntos: !arg.includes('--sin-adjuntos'), tabla: val('--tabla') })
    .then(r => { console.log('Hecho.', JSON.stringify(r)); return pool.end(); })
    .catch(e => { console.error('Error:', e.message); process.exit(1); });
}
module.exports = { migrar };
