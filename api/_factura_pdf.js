// ── PDF de una factura (A4, vectorial: texto seleccionable y QR nítido) con tres diseños: clásico, moderno y minimal ──
const { PDFDocument, rgb } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');

const W = 595.28, H = 841.89;
const hex = h => { const m = String(h || '#c2552e').replace('#', ''); return rgb(parseInt(m.slice(0, 2), 16) / 255, parseInt(m.slice(2, 4), 16) / 255, parseInt(m.slice(4, 6), 16) / 255); };
const mezcla = (h, f) => { const m = String(h || '#c2552e').replace('#', ''); const c = [0, 2, 4].map(i => parseInt(m.slice(i, i + 2), 16) / 255); return rgb(...c.map(v => v + (1 - v) * f)); };
const eur = n => (Number(n) || 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
const num = n => (Number(n) || 0).toLocaleString('es-ES', { maximumFractionDigits: 4 });
const fechaL = f => { const [a, m, d] = String(f).slice(0, 10).split('-'); return `${+d}/${+m}/${a}`; };
const TITULOS = { simplificada: 'Factura simplificada', completa: 'Factura', rectificativa: 'Factura rectificativa' };
const EXENC = { E1: 'Operación exenta de IVA (art. 20.Uno.3º de la Ley 37/1992 del IVA: asistencia sanitaria)', E6: 'Operación exenta de IVA', NS: 'Operación no sujeta a IVA' };
// pdf-lib con fuentes TTF: quitar caracteres que la fuente no tenga (emojis…)
const limpio = s => String(s == null ? '' : s).replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}️]/gu, '').replace(/\s+/g, ' ').trim();

let _F = null;
const fuentes = () => _F || (_F = { reg: Buffer.from(require('./_fuente_regular'), 'base64'), med: Buffer.from(require('./_fuentes').medium, 'base64'), bold: Buffer.from(require('./_fuentes').bold, 'base64') });

// F: factura (como sale de la base). o: { logo (bytes png/jpg), marca, rgpd, pago, color, qr: { url, pruebas } }
async function pdfFactura(F, o) {
  o = o || {};
  const doc = await PDFDocument.create(); doc.registerFontkit(fontkit);
  const B = fuentes(), fR = await doc.embedFont(B.reg, { subset: true }), fM = await doc.embedFont(B.med, { subset: true }), fB = await doc.embedFont(B.bold, { subset: true });
  doc.setTitle(`${TITULOS[F.tipo] || 'Factura'} ${F.codigo}`); doc.setAuthor(limpio((F.emisor || {}).razon || o.marca || '')); doc.setCreator('Panel de la clínica');
  const d = F.diseno || 'clasico', AC = hex(o.color || F.serie_color || '#c2552e'), AC2 = mezcla(o.color || F.serie_color || '#c2552e', 0.9);
  const NEGRO = rgb(0.12, 0.10, 0.09), GRIS = rgb(0.43, 0.38, 0.35), GRIS2 = rgb(0.63, 0.58, 0.55), LINEA = rgb(0.93, 0.91, 0.89), CREMA = rgb(0.973, 0.957, 0.937);
  const X0 = d === 'moderno' ? 70 : 50, X1 = W - 50, AN = X1 - X0;
  let pg = doc.addPage([W, H]), y = H - 52;
  const ancho = (t, f, s) => f.widthOfTextAtSize(t, s);
  const txt = (t, x, yy, f, s, c, alin) => { t = limpio(t); if (!t) return; const w = ancho(t, f, s); pg.drawText(t, { x: alin === 'd' ? x - w : alin === 'c' ? x - w / 2 : x, y: yy, size: s, font: f, color: c || NEGRO }); };
  const partir = (t, f, s, max) => { const P = limpio(t).split(' '), L = []; let l = ''; for (const p of P) { const n = l ? l + ' ' + p : p; if (ancho(n, f, s) > max && l) { L.push(l); l = p; } else l = n; } if (l) L.push(l); return L; };
  const etiqueta = (t, x, yy, alin) => txt(d === 'minimal' ? t.toUpperCase() : t.toUpperCase(), x, yy, fM, 7, GRIS2, alin);
  const fondo = () => { if (d === 'moderno') pg.drawRectangle({ x: 0, y: 0, width: 22, height: H, color: AC }); };
  fondo();

  // ── Cabecera: logo (o nombre) a la izquierda; QR tributario a la derecha ──
  let logoH = 0;
  if (o.logo) try { const im = /^\x89PNG/.test(o.logo.slice(0, 4).toString('latin1')) ? await doc.embedPng(o.logo) : await doc.embedJpg(o.logo); const h = 28, w = Math.min(170, im.width * h / im.height); pg.drawImage(im, { x: X0, y: y - h + 6, width: w, height: w * im.height / im.width }); logoH = h; } catch (e) {}
  if (!logoH) { txt(o.marca || (F.emisor || {}).razon || '', X0, y - 18, fB, 22, d === 'minimal' ? NEGRO : AC); logoH = 30; }
  let qrAlto = 0;
  if (o.qr && o.qr.url) {
    const QR = require('qrcode').create(o.qr.url, { errorCorrectionLevel: 'M' }), n = QR.modules.size, lado = 92, m = lado / (n + 8), x0 = X1 - lado, ytop = y + 8;
    txt('QR tributario:', x0 + lado / 2, ytop + 4, fM, 7.5, NEGRO, 'c');
    pg.drawRectangle({ x: x0, y: ytop - lado, width: lado, height: lado, color: rgb(1, 1, 1) });
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (QR.modules.get(r, c)) pg.drawRectangle({ x: x0 + (c + 4) * m, y: ytop - (r + 5) * m, width: m + 0.05, height: m + 0.05, color: rgb(0, 0, 0) });
    txt('VERI*FACTU', x0 + lado / 2, ytop - lado - 9, fB, 8, NEGRO, 'c');
    if (o.qr.pruebas) txt('Entorno de pruebas de la AEAT', x0 + lado / 2, ytop - lado - 18, fR, 6, GRIS2, 'c');
    qrAlto = lado + 22;
  }
  y -= Math.max(logoH + 26, qrAlto - 4);

  // ── Título y número ──
  const tit = TITULOS[F.tipo] || 'Factura';
  if (d === 'minimal') { txt(tit.toUpperCase(), X0, y, fR, 20, NEGRO); y -= 20; txt(F.codigo, X0, y, fM, 11, GRIS); }
  else { txt(tit, X0, y, fB, d === 'moderno' ? 26 : 22, d === 'moderno' ? NEGRO : AC); y -= 19; txt('Nº ' + F.codigo, X0, y, fM, 11, GRIS); }
  y -= 30;

  // ── De · Para · Datos ──
  const E = F.emisor || {}, Cl = F.cliente || {};
  const col = (x, w, lab, L) => { let yy = y; etiqueta(lab, x, yy); yy -= 14; L.filter(Boolean).forEach((l, i) => { partir(l, i ? fR : fB, i ? 8.5 : 9.5, w).forEach(p => { txt(p, x, yy, i ? fR : fB, i ? 8.5 : 9.5, i ? GRIS : NEGRO); yy -= i ? 12 : 13; }); }); return yy; };
  const dirE = [E.direccion, [E.cp, E.ciudad].filter(Boolean).join(' '), E.provincia].filter(Boolean).join(' · ');
  const dirC = [Cl.direccion, [Cl.cp, Cl.ciudad].filter(Boolean).join(' '), Cl.provincia, Cl.pais && Cl.pais !== 'España' ? Cl.pais : ''].filter(Boolean).join(' · ');
  const wc = (AN - 30) * 0.38, wd = AN - 2 * wc - 30;
  if (d === 'moderno') pg.drawRectangle({ x: X0 - 12, y: y - 78, width: AN + 24, height: 92, color: CREMA });
  const y1 = col(X0, wc, 'De', [E.razon, E.nif ? 'NIF ' + E.nif : '', dirE, [E.tel, E.email].filter(Boolean).join(' · ')]);
  const y2 = col(X0 + wc + 15, wc, F.tipo === 'simplificada' ? 'Cliente' : 'Facturar a', Cl.nombre ? [Cl.nombre, Cl.nif ? 'NIF/DNI ' + Cl.nif : '', dirC, Cl.email] : ['—']);
  let y3 = y; const xd = X0 + 2 * wc + 30;
  [['Fecha', fechaL(F.fecha)], F.rectifica_codigo ? ['Rectifica a', F.rectifica_codigo] : null].filter(Boolean).forEach(([l, v]) => { etiqueta(l, xd, y3); txt(v, xd, y3 - 14, fB, 9.5, NEGRO); y3 -= 34; });
  y = Math.min(y1, y2, y3, y - 66) - 22;

  // ── Tabla de líneas ──
  const L = F.lineas || [], conDto = L.some(l => l.dto);
  const C = { con: X0 + 10, uds: X1 - 250, pre: X1 - 180, dto: X1 - 130, iva: X1 - 80, imp: X1 - 10 };
  if (!conDto) { C.uds = X1 - 225; C.pre = X1 - 150; }
  const cabTabla = () => {
    if (d === 'clasico') pg.drawRectangle({ x: X0, y: y - 8, width: AN, height: 24, color: AC2 });
    else if (d === 'moderno') pg.drawRectangle({ x: X0, y: y - 8, width: AN, height: 24, color: NEGRO });
    const c = d === 'moderno' ? rgb(1, 1, 1) : d === 'clasico' ? AC : NEGRO, s = 7.5;
    txt('CONCEPTO', C.con, y, fM, s, c); txt('UDS.', C.uds, y, fM, s, c, 'd'); txt('PRECIO', C.pre, y, fM, s, c, 'd'); if (conDto) txt('DTO.', C.dto, y, fM, s, c, 'd'); txt('IVA', C.iva, y, fM, s, c, 'd'); txt('IMPORTE', C.imp, y, fM, s, c, 'd');
    if (d === 'minimal') pg.drawLine({ start: { x: X0, y: y - 8 }, end: { x: X1, y: y - 8 }, thickness: 0.8, color: NEGRO });
    y -= 30; };
  const nuevaPagina = () => { pg = doc.addPage([W, H]); fondo(); y = H - 60; txt(`${tit} ${F.codigo} (continuación)`, X0, y, fM, 9, GRIS); y -= 30; cabTabla(); };
  cabTabla();
  for (const l of L) {
    const conL = partir(l.concepto, fM, 9.5, C.uds - C.con - 50), detL = l.detalle ? partir(l.detalle, fR, 8, C.uds - C.con - 50) : [];
    const alto = conL.length * 13 + detL.length * 11 + 14;
    if (y - alto < 210) nuevaPagina();
    let yy = y; conL.forEach(p => { txt(p, C.con, yy, fM, 9.5, NEGRO); yy -= 13; }); detL.forEach(p => { txt(p, C.con, yy, fR, 8, GRIS); yy -= 11; });
    txt(num(l.uds), C.uds, y, fR, 9.5, NEGRO, 'd'); txt(eur(l.precio), C.pre, y, fR, 9.5, NEGRO, 'd'); if (conDto) txt(l.dto ? num(l.dto) + ' %' : '', C.dto, y, fR, 9.5, NEGRO, 'd');
    txt(l.iva && l.iva.tipo ? l.iva.tipo + ' %' : 'Exenta', C.iva, y, fR, 9, GRIS, 'd'); txt(eur(l.base), C.imp, y, fM, 9.5, NEGRO, 'd');
    y = Math.min(yy, y - 13) - 8;
    pg.drawLine({ start: { x: X0, y: y + 6 }, end: { x: X1, y: y + 6 }, thickness: 0.6, color: LINEA }); y -= 6;
  }

  // ── Totales ──
  y -= 10; const xt = X1 - 210;
  (F.impuestos || []).forEach(g => { txt(g.tipo ? `Base imponible ${g.tipo} %` : 'Base exenta', xt, y, fR, 9, GRIS); txt(eur(g.base), X1 - 10, y, fR, 9, NEGRO, 'd'); y -= 15;
    if (g.tipo) { txt(`IVA ${g.tipo} %`, xt, y, fR, 9, GRIS); txt(eur(g.cuota), X1 - 10, y, fR, 9, NEGRO, 'd'); y -= 15; } });
  y -= 4;
  if (d === 'minimal') { pg.drawLine({ start: { x: xt, y: y + 8 }, end: { x: X1, y: y + 8 }, thickness: 0.8, color: NEGRO }); y -= 12; txt('TOTAL', xt, y, fM, 10, NEGRO); txt(eur(F.total), X1 - 10, y - 2, fB, 16, NEGRO, 'd'); y -= 20; }
  else { pg.drawRectangle({ x: xt - 12, y: y - 22, width: X1 - xt + 12, height: 34, color: d === 'moderno' ? AC : AC2 });
    const ct = d === 'moderno' ? rgb(1, 1, 1) : AC; txt('Total', xt, y - 10, fB, 11, ct); txt(eur(F.total), X1 - 10, y - 12, fB, 16, ct, 'd'); y -= 36; }

  // ── Pie: quién atendió, notas, exenciones, protección de datos ──
  const exentas = [...new Set(L.filter(l => !(l.iva && l.iva.tipo)).map(l => EXENC[(l.iva || {}).exencion] || EXENC.E1))];
  const pie = [F.fisio, F.nota, F.motivo ? 'Motivo de la rectificación: ' + F.motivo : '', ...exentas, F.tipo === 'completa' && o.pago ? o.pago : ''].filter(Boolean);
  const rg = o.rgpd ? partir(o.rgpd, fR, 6.8, AN) : [];
  const piL = []; pie.forEach(t => String(t).split('\n').forEach(t2 => partir(t2, fR, 8, AN).forEach(p => piL.push(p))));
  let yp = 46 + rg.length * 9 + (rg.length ? 10 : 0) + piL.length * 11;
  if (yp > y - 20) { pg = doc.addPage([W, H]); fondo(); yp = 46 + rg.length * 9 + (rg.length ? 10 : 0) + piL.length * 11; }
  pg.drawLine({ start: { x: X0, y: yp + 8 }, end: { x: X1, y: yp + 8 }, thickness: 0.6, color: LINEA });
  piL.forEach(p => { yp -= 11; txt(p, X0, yp + 2, fR, 8, GRIS); }); yp -= 8;
  rg.forEach(p => { yp -= 9; txt(p, X0, yp + 2, fR, 6.8, GRIS2); });
  // Marcas: anulada / prueba
  const marca = F.estado === 'anulada' ? 'ANULADA' : F.prueba ? 'PRUEBA' : '';
  if (marca) doc.getPages().forEach(p => p.drawText(marca, { x: 150, y: 330, size: 90, font: fB, color: F.estado === 'anulada' ? rgb(0.85, 0.2, 0.2) : rgb(0.6, 0.55, 0.5), opacity: 0.09, rotate: { type: 'degrees', angle: 28 } }));
  const n = doc.getPageCount(); if (n > 1) doc.getPages().forEach((p, i) => p.drawText(`${i + 1}/${n}`, { x: X1 - 14, y: 24, size: 7, font: fR, color: GRIS2 }));
  return Buffer.from(await doc.save());
}
module.exports = { pdfFactura };
