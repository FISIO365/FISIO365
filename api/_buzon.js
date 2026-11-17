// ── Gastos por email: las facturas de proveedores que se reenvían a gastos@facturas.<dominio> llegan aquí (Brevo, «inbound parsing») ──
// Cada adjunto (PDF o foto) queda en el buzón de Gastos con lo que ha leído la IA; dirección o administración lo revisa y lo guarda como gasto.
// Nada entra solo en los gastos: así un correo raro o mal leído no ensucia el IVA del trimestre.
const crypto = require('crypto');
const GX = require('./_gastos');
const FACX = require('./_facturacion');

const SQL = `create table if not exists fac_buzon (id text primary key, msg text, de jsonb, asunto text, archivo jsonb, datos jsonb, error text, b64 text, tipo text, estado text not null default 'nuevo', gasto text, creado timestamptz not null default now())`;
const ini = { p: null };
async function db() { const D = await GX.db(); if (!ini.p) ini.p = D.query(SQL).catch(e => { ini.p = null; throw e; }); await ini.p; return D; }
const txt = (v, n) => String(v == null ? '' : v).trim().slice(0, n || 200);
const TIPOS = /^(image\/(jpeg|png|webp|heic|heif)|application\/pdf)$/;
const tipoDe = a => { const t = String(a.ContentType || '').toLowerCase().split(';')[0].trim(), n = String(a.Name || '').toLowerCase();
  if (TIPOS.test(t)) return t; if (/\.pdf$/.test(n)) return 'application/pdf'; if (/\.jpe?g$/.test(n)) return 'image/jpeg'; if (/\.png$/.test(n)) return 'image/png'; return ''; };

// Clave de la dirección del webhook (para que nadie más pueda meter cosas en el buzón)
const clave = () => crypto.createHmac('sha256', String(process.env.AIRTABLE_TOKEN || process.env.FISIO_PASSWORD || 'fisio365')).update('fac-buzon').digest('hex').slice(0, 24);

async function conf() { const D = await db(); return ((await D.query(`select v from fac_config where k='buzon'`)).rows[0] || {}).v || {}; }
async function guardarConf(v) { const D = await db(); await D.query(`insert into fac_config(k,v) values('buzon',$1) on conflict (k) do update set v=$1`, [v]); return v; }

// Lee con la IA un elemento que aún no se ha leído (y suelta el archivo guardado para leer)
async function leer(id) { const D = await db(); const x = (await D.query(`select * from fac_buzon where id=$1`, [id])).rows[0]; if (!x) throw new Error('No encontrado');
  if (x.datos || !x.b64) return x;
  let datos = null, error = null; try { datos = await GX.leerFactura(x.b64, x.tipo, (await FACX.config()).emisor); } catch (e) { error = e.message; }
  const r = (await D.query(`update fac_buzon set datos=$2, error=$3, b64=case when $2::jsonb is null then b64 else null end where id=$1 returning *`, [id, datos, error])).rows[0]; return r; }

// Lo que manda Brevo: { items: [{ MessageId, From, Subject, Spam, Attachments: [{ Name, ContentType, ContentLength, DownloadToken }] }] }
async function entrada(body, avisar) { const D = await db(), K = process.env.BREVO_API_KEY, out = { nuevos: 0, saltados: 0 }, ids = [], t0 = Date.now();
  for (const it of (body && body.items) || []) {
    const spam = Number((it.Spam || {}).Score ?? it.SpamScore ?? 0); if (spam >= 5) { out.saltados++; continue; }
    const de = { email: txt((it.From || {}).Address, 160).toLowerCase(), nombre: txt((it.From || {}).Name, 120) }, msg = txt(it.MessageId || it.Uuid && it.Uuid[0], 300);
    for (const a of (it.Attachments || []).slice(0, 6)) {
      const tipo = tipoDe(a); if (!tipo || !a.DownloadToken || Number(a.ContentLength) > 4.2e6) { out.saltados++; continue; }
      if (/^image\//.test(tipo) && Number(a.ContentLength) < 15000) { out.saltados++; continue; } // logos y firmas del email
      const nom = txt(a.Name, 120) || 'factura';
      if (msg && (await D.query(`select 1 from fac_buzon where msg=$1 and archivo->>'nombre'=$2 limit 1`, [msg, nom])).rows.length) continue; // Brevo lo ha mandado otra vez
      const r = await fetch('https://api.brevo.com/v3/inbound/attachments/' + encodeURIComponent(a.DownloadToken), { headers: { 'api-key': K } }); if (!r.ok) { out.saltados++; continue; }
      const b64 = Buffer.from(await r.arrayBuffer()).toString('base64'), archivo = await GX.subirArchivo(b64, nom, tipo);
      const id = 'buz' + crypto.randomBytes(8).toString('hex');
      await D.query(`insert into fac_buzon(id,msg,de,asunto,archivo,b64,tipo) values($1,$2,$3,$4,$5,$6,$7)`, [id, msg || null, de, txt(it.Subject, 200), archivo, b64, tipo]); ids.push(id); out.nuevos++; } }
  // La IA lee lo que dé tiempo (el resto se lee al abrirlo en el panel)
  const leidos = []; for (const id of ids) { if (Date.now() - t0 > 35000) break; try { leidos.push(await leer(id)); } catch (e) {} }
  if (ids.length && avisar) { const L = leidos.filter(x => x.datos).map(x => `${txt((x.datos.proveedor || {}).nombre, 40) || 'Proveedor'}${x.datos.total ? ' · ' + Number(x.datos.total).toFixed(2).replace('.', ',') + ' €' : ''}`);
    await avisar(ids.length === 1 ? '📥 Ha llegado una factura por email' : `📥 Han llegado ${ids.length} facturas por email`, (L.length ? L.join(' · ') + '. ' : '') + 'Revísalas en Facturación › Gastos.').catch(() => {}); }
  return out; }

async function lista() { const D = await db();
  return (await D.query(`select id, de, asunto, archivo, datos, error, creado from fac_buzon where estado='nuevo' order by creado desc limit 50`)).rows; }
async function hecho(id, gasto) { const D = await db(); await D.query(`update fac_buzon set estado='hecho', gasto=$2, b64=null where id=$1`, [id, txt(gasto, 40) || null]); }
async function descartar(id) { const D = await db(); await D.query(`update fac_buzon set estado='descartado', b64=null where id=$1`, [id]); }

// Da de alta en Brevo el webhook de entrada para el dominio (una vez)
async function alta(dominio, url) { const K = process.env.BREVO_API_KEY; if (!K) throw new Error('Los emails no están conectados');
  dominio = txt(dominio, 120).toLowerCase(); if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(dominio)) throw new Error('Revisa el dominio');
  const H = { 'api-key': K, 'Content-Type': 'application/json', accept: 'application/json' };
  const L = await fetch('https://api.brevo.com/v3/webhooks?type=inbound', { headers: H }).then(r => r.json()).catch(() => ({}));
  const ya = (L.webhooks || []).find(w => String(w.url || '').includes('action=fac-buzon-in') && String(w.domain || '') === dominio);
  if (!ya) { const r = await fetch('https://api.brevo.com/v3/webhooks', { method: 'POST', headers: H, body: JSON.stringify({ type: 'inbound', events: ['inboundEmailProcessed'], url, domain: dominio, description: 'FISIO365 · gastos por email' }) });
    if (!r.ok) throw new Error('Brevo no lo ha aceptado (' + r.status + '): ' + (await r.text().catch(() => '')).slice(0, 160)); }
  return guardarConf(Object.assign(await conf(), { dominio, alta: new Date().toISOString() })); }

module.exports = { entrada, lista, leer, hecho, descartar, alta, conf, clave };
