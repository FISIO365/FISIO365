// Copia la base de Airtable de la clínica a Postgres (ver docs/POSTGRES.md). La usan scripts/migrar.js (de una vez)
// y /api/schedule?action=pg-migrar (por trozos de ~40 s, para que quepa en una función de Vercel).
// Solo LEE de Airtable. En Postgres escribe con «upsert»: repetirla copia lo nuevo y lo cambiado, y borra lo que ya no está.
const S = require('./_schema.json');
const BASE = process.env.AIRTABLE_BASE_ID || S.baseId;
const CALC = new Set(['formula', 'multipleLookupValues', 'rollup', 'count', 'createdTime', 'lastModifiedTime', 'createdBy', 'lastModifiedBy', 'button']);
const crypto = require('crypto');
const espera = ms => new Promise(r => setTimeout(r, ms));

// Si en Airtable hay campos o tablas que no están en api/_schema.json se para (si no, no se copiarían y se perderían sin avisar)
async function comprobarEsquema(pide) {
  const vivas = [];
  for (const b of [...new Set(S.tables.map(t => t.base || BASE))]) { const m = await pide(`https://api.airtable.com/v0/meta/bases/${b}/tables`); for (const t of m.tables || []) vivas.push({ b, t }); }
  const mio = new Map(S.tables.map(t => [t.id, t])), faltan = [];
  for (const { b, t } of vivas) { const s = mio.get(t.id); if (!s) { if (b === BASE) faltan.push(`tabla «${t.name}» (${t.id})`); continue; }
    const ids = new Set(s.fields.map(f => f.id)); for (const f of t.fields) if (!ids.has(f.id)) faltan.push(`${t.name} › «${f.name}» (${f.type}, ${f.id})`); }
  if (faltan.length) throw new Error('Faltan en api/_schema.json (añádelos antes de copiar):\n  ' + faltan.join('\n  '));
}

// Un trozo de la copia. desde = { t: id de tabla, off: offset de Airtable } (null = empezar). hasta = hora límite (ms).
// Devuelve { hecho: true, resumen } o { sigue: { t, off }, resumen } para seguir en la siguiente llamada.
async function migrarPaso({ db, fetch: F, token, adjuntos = true, tabla = null, desde = null, hasta = Infinity, comprobar = true, log = () => {} }) {
  const H = { Authorization: `Bearer ${token}` };
  const pide = async u => { for (let i = 0; ; i++) { const r = await F(u, { headers: H }); if (r.status === 429 && i < 8) { await espera(1000 * (i + 1)); continue; } const d = await r.json(); if (d.error) throw new Error(JSON.stringify(d.error)); return d; } };
  if (!desde) {
    const SQL = require('./_pg.js').SQL_INIT;
    for (const s of SQL.split(';').map(x => x.trim()).filter(Boolean)) await db.query(s);
    await db.query('create table if not exists migrar_vistos (tabla text not null, id text not null, primary key (tabla, id))');
    await db.query('alter table migrar_vistos enable row level security');
    if (comprobar && !tabla) { await comprobarEsquema(pide); log('Esquema: al día'); }
  }
  const tablas = S.tables.filter(t => !tabla || t.id === tabla);
  let i = desde ? tablas.findIndex(t => t.id === desde.t) : 0; if (i < 0) throw new Error('Tabla desconocida: ' + (desde && desde.t));
  let off = desde ? String(desde.off || '') : '';
  const resumen = {};
  for (; i < tablas.length; i++, off = '') {
    const t = tablas[i], campos = new Map(t.fields.map(f => [f.name, f]));
    const R = resumen[t.name] = resumen[t.name] || { registros: 0, adjuntos: 0, borrados: 0 };
    if (!off) await db.query('delete from migrar_vistos where tabla = $1', [t.id]);
    do {
      if (Date.now() > hasta) return { sigue: { t: t.id, off }, resumen };
      const d = await pide(`https://api.airtable.com/v0/${t.base || BASE}/${t.id}?pageSize=100${off ? '&offset=' + off : ''}`);
      const filas = [], maxAuto = {}; let cortar = false;
      // 1) Adjuntos de toda la página: los que aún no están en Postgres se bajan de 8 en 8
      const adjF = new Set(t.fields.filter(f => f.type === 'multipleAttachments').map(f => f.name));
      const todos = adjuntos && adjF.size ? d.records.flatMap(r => Object.entries(r.fields || {}).filter(([k, v]) => adjF.has(k) && Array.isArray(v)).flatMap(([, v]) => v)) : [];
      const yaEn = async ids => ids.length ? new Map((await db.query('select id, clave, bytes from archivos where id = any($1::text[])', [ids])).rows.map(x => [x.id, x])) : new Map();
      let hay = await yaEn([...new Set(todos.map(a => 'att' + a.id.slice(3)))]);
      const bajar = [...new Map(todos.filter(a => !hay.has('att' + a.id.slice(3))).map(a => [a.id, a])).values()];
      for (let j = 0; j < bajar.length; j += 8) {
        if (Date.now() > hasta + 8000) { cortar = true; break; } // demasiado tiempo: la página se repite en la siguiente llamada (lo ya bajado no se vuelve a bajar)
        await Promise.all(bajar.slice(j, j + 8).map(async a => {
          const rr = await F(a.url).catch(() => null); if (!rr || !rr.ok) { log(`  ! no se pudo bajar ${a.filename} (${t.name})`); return; }
          const buf = Buffer.from(await rr.arrayBuffer());
          await db.query('insert into archivos (id, clave, nombre, tipo, bytes, datos) values ($1,$2,$3,$4,$5,$6) on conflict (id) do nothing', ['att' + a.id.slice(3), crypto.randomBytes(16).toString('hex'), a.filename, a.type, buf.length, buf]);
          R.adjuntos++;
        }));
      }
      if (cortar) return { sigue: { t: t.id, off }, resumen };
      if (bajar.length) hay = await yaEn([...new Set(todos.map(a => 'att' + a.id.slice(3)))]);
      // 2) Los registros
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
              const id = 'att' + a.id.slice(3), ya = hay.get(id); if (!ya) continue; // no se pudo bajar
              const u = `/api/schedule?action=archivo&id=${id}&k=${ya.clave}`;
              L.push({ id, url: u, filename: a.filename, size: ya.bytes, type: a.type, ...(/^image\//.test(a.type || '') ? { thumbnails: { small: { url: u }, large: { url: u }, full: { url: u } } } : {}) });
            }
            if (L.length) out[k] = L; continue;
          }
          out[k] = v;
        }
        filas.push({ id: r.id, f: out, c: r.createdTime });
      }
      if (cortar) return { sigue: { t: t.id, off }, resumen };
      if (filas.length) {
        await db.query(`insert into registros (tabla, id, fields, creado, modificado)
          select $1, x.id, x.f, x.c::timestamptz, clock_timestamp() from jsonb_to_recordset($2::jsonb) as x(id text, f jsonb, c text)
          on conflict (id) do update set fields = excluded.fields, modificado = clock_timestamp() where registros.fields is distinct from excluded.fields`, [t.id, JSON.stringify(filas)]);
        await db.query('insert into migrar_vistos (tabla, id) select $1, unnest($2::text[]) on conflict do nothing', [t.id, filas.map(x => x.id)]);
      }
      for (const [fid, mx] of Object.entries(maxAuto)) await db.query('insert into contadores (tabla, campo, n) values ($1,$2,$3) on conflict (tabla, campo) do update set n = greatest(contadores.n, excluded.n)', [t.id, fid, mx]);
      R.registros += filas.length;
      off = d.offset || '';
      if (off) await espera(220); // Airtable: máximo 5 peticiones por segundo
    } while (off);
    // Lo que ya no está en Airtable se borra también aquí
    const ya = (await db.query('select r.id from registros r where r.tabla = $1 and not exists (select 1 from migrar_vistos v where v.tabla = $1 and v.id = r.id)', [t.id])).rows.map(x => x.id);
    for (const id of ya) { await db.query('delete from registros where id = $1', [id]); await db.query('insert into borrados (tabla, id, t) values ($1,$2,clock_timestamp())', [t.id, id]); }
    R.borrados += ya.length; R.total = (await db.query('select count(*)::int n from registros where tabla = $1', [t.id])).rows[0].n;
    log(`${t.name}: ${R.registros} registros, ${R.adjuntos} adjuntos${ya.length ? `, ${ya.length} borrados` : ''}`);
  }
  return { hecho: true, resumen };
}

// Todo de una vez (scripts/migrar.js y las pruebas)
async function migrar(o) {
  let desde = null; const total = {};
  for (;;) {
    const r = await migrarPaso({ ...o, desde });
    for (const [k, v] of Object.entries(r.resumen)) { const T = total[k] = total[k] || { registros: 0, adjuntos: 0, borrados: 0 }; T.registros += v.registros; T.adjuntos += v.adjuntos; T.borrados += v.borrados; if (v.total != null) T.total = v.total; }
    if (r.hecho) return total; desde = r.sigue;
  }
}
module.exports = { migrar, migrarPaso, comprobarEsquema };
