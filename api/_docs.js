// ── MIS DOCUMENTOS y BLOC DE NOTAS de cada persona del equipo (Postgres) ──
// Cada cosa es de su dueño (nombre de pila en minúsculas). Documentos: carpetas, archivos, textos escritos en el panel
// y enlaces; cada uno se puede compartir con el equipo (lo ven todos, solo lo cambia su dueño). Las notas son siempre privadas.
const PG = require('./_pg');
const crypto = require('crypto');

const SQL = `create table if not exists doc_items (id text primary key, dueno text not null, tipo text not null, padre text, titulo text not null default '', texto text, url text, adj jsonb, compartido boolean not null default false, fijada boolean not null default false, creado timestamptz not null default now(), modificado timestamptz not null default now());
create index if not exists doc_items_dueno on doc_items (dueno, tipo)`;
const ini = global.__docsIni || (global.__docsIni = {});
async function db() {
  if (!ini.p) ini.p = (async () => { for (const s of SQL.split(/;\s*\n/).map(x => x.trim()).filter(Boolean)) await PG.db().query(s); })().catch(e => { ini.p = null; throw e; });
  await ini.p; return PG.db();
}
const quienK = q => String(q || '').trim().split(' ')[0].toLowerCase().slice(0, 40);
const nuevo = () => 'doc' + crypto.randomBytes(8).toString('hex');
const TIPOS = ['carpeta', 'archivo', 'texto', 'enlace', 'nota'];
const fila = r => ({ id: r.id, dueno: r.dueno, tipo: r.tipo, padre: r.padre || '', titulo: r.titulo, texto: r.texto || '', url: r.url || '', adj: r.adj || null, compartido: !!r.compartido, fijada: !!r.fijada, creado: r.creado, modificado: r.modificado });

async function hacer(q) {
  const yo = quienK(q.quien); if (!yo) return { ok: false, error: 'Falta quién' };
  const D = await db(), op = String(q.op || 'listar');
  const mio = async id => { const r = await D.query('select * from doc_items where id = $1 and dueno = $2', [String(id || ''), yo]); return r.rows[0] || null; };
  if (op === 'listar') { // lo mío (también notas) y lo que el resto ha compartido
    const r = await D.query("select * from doc_items where dueno = $1 or (compartido and tipo <> 'nota') order by fijada desc, modificado desc", [yo]);
    return { ok: true, yo, items: r.rows.map(fila) };
  }
  if (op === 'crear') {
    const tipo = TIPOS.includes(q.tipo) ? q.tipo : null; if (!tipo || tipo === 'archivo') return { ok: false, error: 'Tipo no válido' };
    let padre = String(q.padre || ''); if (padre && !(await mio(padre))) padre = '';
    const titulo = String(q.titulo || '').trim().slice(0, 160) || (tipo === 'nota' ? '' : 'Sin título');
    let url = ''; if (tipo === 'enlace') { url = String(q.url || '').trim().slice(0, 1000); if (!/^https?:\/\//i.test(url)) url = url ? 'https://' + url : ''; if (!url) return { ok: false, error: 'Pon el enlace' }; }
    const id = nuevo();
    await D.query('insert into doc_items (id, dueno, tipo, padre, titulo, texto, url, compartido) values ($1,$2,$3,$4,$5,$6,$7,$8)', [id, yo, tipo, padre || null, titulo, String(q.texto || '').slice(0, 200000), url || null, tipo !== 'nota' && !!q.compartido]);
    return { ok: true, item: fila((await D.query('select * from doc_items where id = $1', [id])).rows[0]) };
  }
  if (op === 'subir') { // archivo en base64 (máx. ~4 MB)
    const b64 = String(q.file || ''); if (!b64 || b64.length > 6e6) return { ok: false, error: 'El archivo es demasiado grande (máx. 4 MB)' };
    let padre = String(q.padre || ''); if (padre && !(await mio(padre))) padre = '';
    const nombre = String(q.nombre || 'archivo').slice(0, 160), tipo = String(q.tipoArchivo || 'application/octet-stream').slice(0, 120);
    const a = await PG.guardarArchivo(D, Buffer.from(b64, 'base64'), nombre, tipo);
    const id = nuevo();
    await D.query("insert into doc_items (id, dueno, tipo, padre, titulo, adj, compartido) values ($1,$2,'archivo',$3,$4,$5,$6)", [id, yo, padre || null, nombre.replace(/\.[A-Za-z0-9]{1,5}$/, ''), JSON.stringify(a), !!q.compartido]);
    return { ok: true, item: fila((await D.query('select * from doc_items where id = $1', [id])).rows[0]) };
  }
  const x = await mio(q.id); if (!x) return { ok: false, error: 'No es tuyo o ya no existe' };
  if (op === 'guardar') { // título, texto, enlace, carpeta, compartir o fijar
    const c = [], v = [x.id]; const pon = (k, val) => { v.push(val); c.push(`${k} = $${v.length}`); };
    if (q.titulo != null) pon('titulo', String(q.titulo).trim().slice(0, 160) || (x.tipo === 'nota' ? '' : 'Sin título'));
    if (q.texto != null) pon('texto', String(q.texto).slice(0, 200000));
    if (q.url != null && x.tipo === 'enlace') pon('url', String(q.url).trim().slice(0, 1000));
    if (q.padre != null && x.tipo !== 'carpeta') { const p = String(q.padre || ''); pon('padre', p && (await mio(p)) ? p : null); }
    if (q.compartido != null && x.tipo !== 'nota') pon('compartido', !!q.compartido);
    if (q.fijada != null) pon('fijada', !!q.fijada);
    if (!c.length) return { ok: true, item: fila(x) };
    await D.query(`update doc_items set ${c.join(', ')}, modificado = now() where id = $1`, v);
    if (x.tipo === 'carpeta' && q.compartido != null) await D.query('update doc_items set compartido = $3 where padre = $1 and dueno = $2', [x.id, yo, !!q.compartido]); // compartir la carpeta = todo lo de dentro
    return { ok: true, item: fila((await D.query('select * from doc_items where id = $1', [x.id])).rows[0]) };
  }
  if (op === 'borrar') {
    if (x.tipo === 'carpeta') await D.query('update doc_items set padre = null where padre = $1 and dueno = $2', [x.id, yo]); // lo de dentro no se pierde: queda suelto
    await D.query('delete from doc_items where id = $1', [x.id]);
    return { ok: true };
  }
  return { ok: false, error: 'Operación no válida' };
}
module.exports = { hacer };
