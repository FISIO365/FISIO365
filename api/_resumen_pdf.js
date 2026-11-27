// ── PDF «Resumen de facturas» (para reclamar un pago): A4 vectorial, con vuestros datos, el cliente, la tabla y el total pendiente ──
const { PDFDocument, rgb } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');

const W = 595.28, H = 841.89, M = 48;
const C = { tx: rgb(0.17, 0.14, 0.13), gris: rgb(0.54, 0.49, 0.45), linea: rgb(0.9, 0.87, 0.83), lineaS: rgb(0.94, 0.92, 0.9), coral: rgb(0.76, 0.33, 0.18), fondo: rgb(0.99, 0.95, 0.93) };
const eur = n => (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
const fd = f => String(f || '').slice(0, 10).split('-').reverse().join('/');
const limpio = s => String(s == null ? '' : s).replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}️]/gu, '').replace(/\s+/g, ' ').trim();
let _F = null;
const fuentes = () => _F || (_F = { reg: Buffer.from(require('./_fuente_regular'), 'base64'), med: Buffer.from(require('./_fuentes').medium, 'base64'), bold: Buffer.from(require('./_fuentes').bold, 'base64') });

// L: [{codigo, fecha, total, falta, cliente}] · E: emisor {razon,nif,direccion,cp,ciudad,email,tel,iban} · hoy: AAAA-MM-DD
async function pdfResumen(L, E, hoy) {
  const doc = await PDFDocument.create(); doc.registerFontkit(fontkit);
  const F = fuentes(), reg = await doc.embedFont(F.reg, { subset: true }), med = await doc.embedFont(F.med, { subset: true }), bold = await doc.embedFont(F.bold, { subset: true });
  const clis = [...new Set(L.map(x => limpio((x.cliente || {}).nombre)))], uno = clis.length === 1 ? (L[0].cliente || {}) : null;
  const dias = f => Math.max(0, Math.round((Date.parse(hoy) - Date.parse(String(f).slice(0, 10))) / 864e5));
  const algunaPend = L.some(x => x.falta > 0.004);
  let p, y;
  const t = (s, x, yy, o = {}) => { const f = o.f || reg, z = o.z || 10; let v = limpio(s); if (o.max) while (v.length > 1 && f.widthOfTextAtSize(v, z) > o.max) v = v.slice(0, -2) + '…';
    const w = f.widthOfTextAtSize(v, z); p.drawText(v, { x: o.der ? x - w : x, y: yy, size: z, font: f, color: o.c || C.tx }); return w; };
  const cols = uno ? [['Nº', M, 0], ['Fecha', M + 110, 0], ['Días', 380, 1], ['Importe', 465, 1], ['Pendiente', W - M, 1]] : [['Nº', M, 0], ['Fecha', M + 82, 0], ['Cliente', M + 152, 0], ['Días', 352, 1], ['Importe', 445, 1], ['Pendiente', W - M, 1]];
  const cabTabla = () => { cols.forEach(([n, x, d]) => t(n.toUpperCase(), x, y, { z: 7.5, f: med, c: C.gris, der: !!d })); y -= 8; p.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 1.2, color: C.linea }); y -= 16; };
  const nueva = primera => { p = doc.addPage([W, H]); y = H - M;
    if (primera) {
      t(E.razon || 'Fourth Dynamic, S.L.', M, y, { f: bold, z: 12 }); y -= 15;
      const l1 = [E.nif && 'NIF ' + E.nif, E.direccion, [E.cp, E.ciudad].filter(Boolean).join(' ')].filter(Boolean).join(' · '), l2 = [E.email, E.tel].filter(Boolean).join(' · ');
      if (l1) { t(l1, M, y, { z: 8.5, c: C.gris, max: 300 }); y -= 12; } if (l2) { t(l2, M, y, { z: 8.5, c: C.gris, max: 300 }); y -= 12; }
      if (uno) { let yy = H - M; t('PARA', W - M, yy, { z: 7.5, f: med, c: C.gris, der: true }); yy -= 14; t(uno.nombre || '', W - M, yy, { f: bold, z: 11, der: true, max: 200 }); yy -= 13;
        const c1 = [uno.nif && 'NIF ' + uno.nif].filter(Boolean).join(''); if (c1) { t(c1, W - M, yy, { z: 8.5, c: C.gris, der: true }); yy -= 12; }
        if (uno.direccion) t(uno.direccion, W - M, yy, { z: 8.5, c: C.gris, der: true, max: 200 }); }
      y = Math.min(y, H - M - 62) - 6; p.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 1.2, color: C.linea }); y -= 34;
      t(algunaPend ? 'Resumen de facturas pendientes de pago' : 'Resumen de facturas', M, y, { f: bold, z: 17 }); y -= 18;
      t(`A fecha de ${fd(hoy)} · ${L.length} factura${L.length === 1 ? '' : 's'}`, M, y, { z: 9.5, c: C.gris }); y -= 30;
    } else { t('Resumen de facturas (continuación)', M, y, { f: med, z: 10, c: C.gris }); y -= 26; }
    cabTabla(); };
  nueva(true);
  for (const x of L) {
    if (y < M + 120) nueva(false);
    const v = { 'Nº': [x.codigo, bold], Fecha: [fd(x.fecha), reg], Cliente: [(x.cliente || {}).nombre, reg], 'Días': [String(dias(x.fecha)), reg], Importe: [eur(x.total), reg], Pendiente: [eur(x.falta), bold] };
    cols.forEach(([n, cx, d]) => t(v[n][0], cx, y, { f: v[n][1], z: 9.5, der: !!d, max: n === 'Cliente' ? 120 : 0 }));
    y -= 9; p.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.6, color: C.lineaS }); y -= 15;
  }
  const tot = L.reduce((s, x) => s + (+x.total || 0), 0), pend = L.reduce((s, x) => s + (+x.falta || 0), 0);
  y -= 8; const bw = 170, bx = W - M - bw;
  p.drawRectangle({ x: bx, y: y - 44, width: bw, height: 58, color: C.fondo, borderColor: C.coral, borderWidth: 0.8 });
  t('Total pendiente', bx + 14, y - 2, { z: 8.5, c: C.gris }); t(eur(pend), bx + 14, y - 28, { f: bold, z: 18, c: C.coral });
  t('Total facturado', bx - 20, y - 2, { z: 8.5, c: C.gris, der: true }); t(eur(tot), bx - 20, y - 28, { f: bold, z: 14, der: true });
  y -= 80;
  const pie = `Os agradeceríamos que nos hicierais el pago del importe pendiente${E.iban ? ' a la cuenta ' + E.iban : ''}, indicando el número de las facturas. Si alguna ya está pagada, decídnoslo y lo revisamos. Gracias.`;
  const pal = limpio(pie).split(' '); let lin = '';
  for (const w of pal) { const n = lin ? lin + ' ' + w : w; if (reg.widthOfTextAtSize(n, 9.5) > W - 2 * M) { t(lin, M, y, { z: 9.5, c: C.gris }); y -= 14; lin = w; } else lin = n; }
  if (lin) t(lin, M, y, { z: 9.5, c: C.gris });
  return Buffer.from(await doc.save());
}
module.exports = { pdfResumen };
