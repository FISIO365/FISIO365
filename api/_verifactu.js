// ── VERI*FACTU: registro de cada factura (alta o anulación) con su huella encadenada y el QR de la AEAT ──
// Orden HAC/1177/2024 y especificaciones técnicas de la AEAT:
//  · Huella = SHA-256 (hex en mayúsculas) de «campo=valor&…» con los datos del registro y la huella del registro anterior.
//  · Una sola cadena por emisor (NIF) y entorno; el primer registro lleva «Huella=» vacío.
//  · QR (ISO/IEC 18004, corrección M, 30–40 mm) con la URL de cotejo: nif, numserie, fecha (DD-MM-AAAA) e importe.
// El envío a la AEAT (con el certificado de la clínica) llega en la fase siguiente: aquí los registros quedan «pendiente».
const crypto = require('crypto');

const SQL = `
create table if not exists fac_registros (id bigserial primary key, entorno text not null, nif text not null, factura text not null, tipo text not null, num_serie text not null, fecha date not null, tipo_factura text, cuota numeric(12,2), importe numeric(12,2), huella text not null, huella_prev text, fechahora text not null, estado text not null default 'pendiente', csv text, respuesta jsonb, enviado timestamptz, creado timestamptz not null default now());
create index if not exists fac_registros_cadena on fac_registros (entorno, nif, id);
create index if not exists fac_registros_factura on fac_registros (factura)
`;
const URLS = { pruebas: 'https://prewww2.aeat.es/wlpl/TIKE-CONT/ValidarQR', real: 'https://www2.agenciatributaria.gob.es/wlpl/TIKE-CONT/ValidarQR' };
const importe = n => (Math.round((Number(n) || 0) * 100) / 100).toFixed(2);
const fechaVF = f => { const [a, m, d] = String(f).slice(0, 10).split('-'); return `${d}-${m}-${a}`; };
// Fecha, hora y huso de ahora en Madrid: 2026-11-17T11:35:02+01:00
function ahoraHuso(d = new Date()) {
  const P = {}; new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZoneName: 'longOffset' }).formatToParts(d).forEach(p => { P[p.type] = p.value; });
  const off = String(P.timeZoneName || 'GMT+01:00').replace('GMT', '') || '+00:00';
  return `${P.year}-${P.month}-${P.day}T${P.hour}:${P.minute}:${P.second}${off === '' ? '+00:00' : off}`;
}
const sha = s => crypto.createHash('sha256').update(s, 'utf8').digest('hex').toUpperCase();
const t = v => String(v == null ? '' : v).trim();
function huellaAlta(x) {
  return sha(`IDEmisorFactura=${t(x.nif)}&NumSerieFactura=${t(x.numSerie)}&FechaExpedicionFactura=${t(fechaVF(x.fecha))}&TipoFactura=${t(x.tipoFactura)}&CuotaTotal=${t(importe(x.cuota))}&ImporteTotal=${t(importe(x.importe))}&Huella=${t(x.prev)}&FechaHoraHusoGenRegistro=${t(x.fechahora)}`);
}
function huellaAnulacion(x) {
  return sha(`IDEmisorFacturaAnulada=${t(x.nif)}&NumSerieFacturaAnulada=${t(x.numSerie)}&FechaExpedicionFacturaAnulada=${t(fechaVF(x.fecha))}&Huella=${t(x.prev)}&FechaHoraHusoGenRegistro=${t(x.fechahora)}`);
}
// Tipo de factura de la AEAT: F1 completa, F2 simplificada, R1 rectificativa (R5 si rectifica una simplificada)
const tipoFactura = (tipo, rectSimpl) => tipo === 'simplificada' ? 'F2' : tipo === 'rectificativa' ? (rectSimpl ? 'R5' : 'R1') : 'F1';
const nifLimpio = n => String(n || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// Nuevo registro en la cadena (dentro de la misma transacción que la factura). q = cliente de la transacción
async function registrar(q, entorno, F, tipo) {
  const nif = nifLimpio((F.emisor || {}).nif);
  if (!nif) throw new Error('Falta el NIF de la clínica (Facturación › Ajustes)');
  await q.query(`select pg_advisory_xact_lock(hashtext($1))`, ['vf:' + entorno + ':' + nif]);
  const prev = ((await q.query(`select huella from fac_registros where entorno=$1 and nif=$2 order by id desc limit 1`, [entorno, nif])).rows[0] || {}).huella || '';
  const fechahora = ahoraHuso();
  const x = { nif, numSerie: F.codigo, fecha: F.fecha, tipoFactura: F.f3 ? 'F3' : tipoFactura(F.tipo, F.rectSimpl), cuota: F.cuota, importe: F.total, prev, fechahora };
  const huella = tipo === 'anulacion' ? huellaAnulacion(x) : huellaAlta(x);
  const r = await q.query(`insert into fac_registros(entorno,nif,factura,tipo,num_serie,fecha,tipo_factura,cuota,importe,huella,huella_prev,fechahora) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id`,
    [entorno, nif, F.id, tipo, x.numSerie, F.fecha, tipo === 'anulacion' ? null : x.tipoFactura, tipo === 'anulacion' ? null : importe(F.cuota), tipo === 'anulacion' ? null : importe(F.total), huella, prev || null, fechahora]);
  return { id: r.rows[0].id, huella };
}
// Enlace del QR de cotejo
function urlQR(entorno, F) {
  return `${URLS[entorno] || URLS.pruebas}?nif=${encodeURIComponent(nifLimpio((F.emisor || {}).nif))}&numserie=${encodeURIComponent(F.codigo)}&fecha=${encodeURIComponent(fechaVF(F.fecha))}&importe=${encodeURIComponent(importe(F.total))}`;
}
async function qrSvg(url) { const QR = require('qrcode'); return QR.toString(url, { type: 'svg', errorCorrectionLevel: 'M', margin: 4, color: { dark: '#000000', light: '#ffffff' } }); }
// Comprobar la cadena entera: cada huella se vuelve a calcular y tiene que coincidir (y apuntar a la anterior)
async function comprobar(D, entorno, nif) {
  const L = (await D.query(`select r.*, r.fecha::text fecha from fac_registros r where entorno=$1 and nif=$2 order by id`, [entorno, nif])).rows;
  let prev = '', mal = [];
  for (const r of L) { const x = { nif: r.nif, numSerie: r.num_serie, fecha: r.fecha, tipoFactura: r.tipo_factura, cuota: r.cuota, importe: r.importe, prev, fechahora: r.fechahora };
    const h = r.tipo === 'anulacion' ? huellaAnulacion(x) : huellaAlta(x);
    if (h !== r.huella || String(r.huella_prev || '') !== prev) mal.push(r.id); prev = r.huella; }
  return { n: L.length, mal };
}
module.exports = { SQL, registrar, urlQR, qrSvg, comprobar, huellaAlta, huellaAnulacion, ahoraHuso, fechaVF, importe, tipoFactura, URLS };
