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
  const d = F.diseno || 'clasico', colH = o.color || F.serie_color || '#c2552e', AC = d === 'minimal' ? rgb(0.12, 0.10, 0.09) : hex(colH), ACs = mezcla(colH, 0.93);
  const NEGRO = rgb(0.12, 0.10, 0.09), GRIS = rgb(0.42, 0.37, 0.34), GRIS2 = rgb(0.62, 0.57, 0.54), LINEA = rgb(0.91, 0.88, 0.85), CREMA = rgb(0.976, 0.965, 0.95), BLANCO = rgb(1, 1, 1);
  const X0 = 56, X1 = W - 56, AN = X1 - X0;
  let pg = doc.addPage([W, H]), y = H - 56;
  const ancho = (t, f, s) => f.widthOfTextAtSize(t, s);
  const txt = (t, x, yy, f, s, c, alin) => { t = limpio(t); if (!t) return 0; const w = ancho(t, f, s); pg.drawText(t, { x: alin === 'd' ? x - w : alin === 'c' ? x - w / 2 : x, y: yy, size: s, font: f, color: c || NEGRO }); return w; };
  // Texto en mayúsculas con letras separadas (etiquetas)
  const esp = (t, x, yy, s, c, alin, ls = 1.1) => { t = limpio(t).toUpperCase(); const w = [...t].reduce((a, ch) => a + ancho(ch, fM, s) + ls, -ls); let xx = alin === 'd' ? x - w : alin === 'c' ? x - w / 2 : x; for (const ch of t) { pg.drawText(ch, { x: xx, y: yy, size: s, font: fM, color: c || GRIS2 }); xx += ancho(ch, fM, s) + ls; } };
  const partir = (t, f, s, max) => { const P = limpio(t).split(' '), L = []; let l = ''; for (const p of P) { const n = l ? l + ' ' + p : p; if (ancho(n, f, s) > max && l) { L.push(l); l = p; } else l = n; } if (l) L.push(l); return L; };
  // Caja con esquinas redondeadas (borde fino o relleno suave)
  const caja = (x, yTop, w, h, o2) => { const r = Math.min(10, h / 2), P = `M ${r} 0 H ${w - r} A ${r} ${r} 0 0 1 ${w} ${r} V ${h - r} A ${r} ${r} 0 0 1 ${w - r} ${h} H ${r} A ${r} ${r} 0 0 1 0 ${h - r} V ${r} A ${r} ${r} 0 0 1 ${r} 0 Z`;
    if (d === 'minimal') { pg.drawLine({ start: { x, y: yTop - h }, end: { x: x + w, y: yTop - h }, thickness: 0.6, color: NEGRO }); return; }
    pg.drawSvgPath(P, Object.assign({ x, y: yTop }, d === 'moderno' ? { color: (o2 || {}).color || CREMA } : { borderColor: LINEA, borderWidth: 0.8, color: (o2 || {}).color || BLANCO })); };
  const linea = (yy, c, g) => pg.drawLine({ start: { x: X0, y: yy }, end: { x: X1, y: yy }, thickness: g || 0.6, color: c || LINEA });
  const redondo = (x, yTop, w, h, r, op) => { r = Math.min(r, h / 2, w / 2); pg.drawSvgPath(`M ${r} 0 H ${w - r} A ${r} ${r} 0 0 1 ${w} ${r} V ${h - r} A ${r} ${r} 0 0 1 ${w - r} ${h} H ${r} A ${r} ${r} 0 0 1 0 ${h - r} V ${r} A ${r} ${r} 0 0 1 ${r} 0 Z`, Object.assign({ x, y: yTop }, op)); };
  const arriba = () => {};
  const MIN = d === 'minimal';

  // ── Cabecera: una banda crema con el logo y los datos de la clínica; el QR tributario sobre blanco ──
  const E = F.emisor || {}, Cl = F.cliente || {};
  const dirE = [E.direccion, [E.cp, E.ciudad].filter(Boolean).join(' '), E.provincia].filter(Boolean).join(' · ');
  const conQR = !!(o.qr && o.qr.url), lado = 85.1, hCab = conQR ? lado + 46 : 104, yC = H - 40;
  if (!MIN) redondo(X0 - 16, yC, AN + 32, hCab, 16, { color: d === 'moderno' ? ACs : CREMA });
  else pg.drawLine({ start: { x: X0, y: yC - hCab }, end: { x: X1, y: yC - hCab }, thickness: 0.8, color: NEGRO });
  let yl = yC - 26, conLogo = false;
  if (o.logo) try { const im = /^\x89PNG/.test(o.logo.slice(0, 4).toString('latin1')) ? await doc.embedPng(o.logo) : await doc.embedJpg(o.logo); const h = 15, w = Math.min(100, im.width * h / im.height); pg.drawImage(im, { x: X0, y: yl - h + 4, width: w, height: w * im.height / im.width }); conLogo = true; } catch (e) {}
  if (!conLogo) txt(o.marca || E.razon || '', X0, yl - 10, fB, 14, AC);
  yl -= 32;
  [[E.razon, fM, NEGRO], [E.nif ? 'NIF ' + E.nif : '', fR, GRIS], [dirE, fR, GRIS], [[E.tel, E.email, E.web].filter(Boolean).join(' · '), fR, GRIS]].forEach(([t, f, c]) => { if (!t) return; partir(t, f, 7.8, 290).forEach(p => { txt(p, X0, yl, f, 7.8, c); yl -= 11.5; }); });
  if (conQR) {
    // 30 × 30 mm: lo mínimo que pide la norma (Orden HAC/1177/2024, art. 21)
    const QR = require('qrcode').create(o.qr.url, { errorCorrectionLevel: 'M' }), n = QR.modules.size, m = lado / n, qx = X1 - lado, qy = yC - 22;
    if (!MIN) redondo(qx - 4, qy + 4, lado + 8, lado + 8, 6, { color: BLANCO, borderColor: LINEA, borderWidth: 0.6 });
    txt('QR tributario:', qx + lado / 2, qy + 9, fR, 5.5, GRIS2, 'c');
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (QR.modules.get(r, c)) pg.drawRectangle({ x: qx + c * m, y: qy - (r + 1) * m, width: m + 0.04, height: m + 0.04, color: rgb(0, 0, 0) });
    txt('VERI*FACTU' + (o.qr.pruebas ? ' · pruebas AEAT' : ''), qx + lado / 2, qy - lado - 13, fM, 5.5, GRIS2, 'c');
  }
  y = yC - hCab - 40;

  // ── Título, número, fecha y si está pagada ──
  const tit = TITULOS[F.tipo] || 'Factura';
  txt(tit, X0, y, fM, 19, NEGRO);
  txt('Nº ' + F.codigo, X0, y - 17, fR, 9.5, GRIS);
  const fw = txt(fechaL(F.fecha), X1, y, fM, 11, NEGRO, 'd'); esp('Fecha', X1, y + 15, 6.2, GRIS2, 'd');
  if (F.rectifica_codigo) { txt(F.rectifica_codigo, X1 - fw - 36, y, fM, 11, NEGRO, 'd'); esp('Rectifica a', X1 - fw - 36, y + 15, 6.2, GRIS2, 'd'); }
  const P = F.pagos || {}, pend = P.estado === 'pendiente';
  if (F.tipo !== 'rectificativa' && (pend || P.estado === 'pagada' || P.modo)) {
    const t = pend ? 'Pendiente de pago' : 'Pagada' + (P.modo && P.modo !== 'Varias' ? ' · ' + P.modo : ''), s2 = 7.2, w = ancho(t, fM, s2) + 26, hP = 16, xP = X1 - w, yP = y - 11;
    const cP = pend ? hex('#c2552e') : rgb(0.16, 0.47, 0.28), fP = pend ? mezcla('#c2552e', 0.9) : rgb(0.91, 0.96, 0.92);
    redondo(xP, yP, w, hP, 8, { color: fP });
    pg.drawCircle({ x: xP + 10, y: yP - hP / 2, size: 2.2, color: cP });
    txt(t, xP + 16, yP - 10.8, fM, s2, cP);
  }
  y -= 44;

  // ── Cliente · Atendido por ──
  const dirC = [Cl.direccion, [Cl.cp, Cl.ciudad].filter(Boolean).join(' '), Cl.provincia, Cl.pais && Cl.pais !== 'España' ? Cl.pais : ''].filter(Boolean).join(' · ');
  const bloque = (L, w) => { const out = []; L.filter(x => x && x[0]).forEach(([t, f, s, c]) => partir(t, f, s, w).forEach(p => out.push([p, f, s, c]))); return out; };
  const wB = (AN - 14) / 2;
  const cli = bloque([[Cl.nombre || '—', fB, 10, NEGRO], [Cl.nif ? 'NIF/DNI ' + Cl.nif : '', fR, 8.5, GRIS], [dirC, fR, 8.5, GRIS], [Cl.email, fR, 8.5, GRIS]], wB - 28);
  const fis = String(F.fisio || '').trim(), m2 = fis.match(/^(?:atendid[oa] por:?\s*|fisioterapeuta:?\s*)?(.+?)(?:\s*[·,-]\s*(n[ºo°]?\.?\s*(?:de\s*)?col.*))?$/i);
  const at = fis ? bloque([[m2 ? m2[1] : fis, fB, 10, NEGRO], [m2 && m2[2] ? m2[2].replace(/^n[ºo°]?\.?\s*(de\s*)?col(egiad[oa])?\.?\s*/i, 'Nº de colegiado ') : '', fR, 8.5, GRIS]], wB - 28) : null;
  const hB = Math.max(cli.length, at ? at.length : 0) * 12.5 + 40;
  const pintaB = (x, lab, L, w) => { caja(x, y, w, hB); esp(lab, x + 14, y - 18, 6.5, GRIS2); let yy = y - 34; L.forEach(([p, f, s, c]) => { txt(p, x + 14, yy, f, s, c); yy -= 12.5; }); };
  pintaB(X0, F.tipo === 'simplificada' ? 'Cliente' : 'Facturar a', cli, at ? wB : AN);
  if (at) pintaB(X0 + wB + 14, 'Atendido por', at, wB);
  y -= hB + 30;

  // ── Líneas ──
  const L = F.lineas || [], conDto = L.some(l => l.dto);
  const C = conDto ? { con: X0, uds: X1 - 248, pre: X1 - 178, dto: X1 - 128, iva: X1 - 78, imp: X1 } : { con: X0, uds: X1 - 228, pre: X1 - 152, iva: X1 - 82, imp: X1 };
  const cab = () => { const c = MIN ? NEGRO : GRIS;
    if (!MIN) redondo(X0 - 12, y + 12, AN + 24, 24, 12, { color: CREMA }); else linea(y - 9, NEGRO, 0.8);
    esp('Concepto', C.con, y - 3, 6.3, c); esp('Uds.', C.uds, y - 3, 6.3, c, 'd'); esp('Precio', C.pre, y - 3, 6.3, c, 'd'); if (conDto) esp('Dto.', C.dto, y - 3, 6.3, c, 'd'); esp('IVA', C.iva, y - 3, 6.3, c, 'd'); esp('Importe', C.imp, y - 3, 6.3, c, 'd');
    y -= 34; };
  const nuevaPagina = () => { pg = doc.addPage([W, H]); arriba(); y = H - 60; txt(`${tit} ${F.codigo} (continuación)`, X0, y, fM, 9, GRIS); y -= 34; cab(); };
  cab();
  L.forEach((l, i) => {
    const conL = partir(l.concepto, fM, 10, C.uds - C.con - 60), detL = l.detalle ? partir(l.detalle, fR, 8.5, C.uds - C.con - 60) : [];
    if (y - (conL.length * 14 + detL.length * 12 + 16) < 220) nuevaPagina();
    if (!MIN) pg.drawCircle({ x: C.con - 6, y: y + 3.4, size: 1.6, color: AC });
    let yy = y; conL.forEach(p => { txt(p, C.con + 2, yy, fM, 10, NEGRO); yy -= 14; }); detL.forEach(p => { txt(p, C.con + 2, yy, fR, 8.5, GRIS); yy -= 12; });
    txt(num(l.uds), C.uds, y, fR, 10, NEGRO, 'd'); txt(eur(l.precio), C.pre, y, fR, 10, GRIS, 'd'); if (conDto) txt(l.dto ? num(l.dto) + ' %' : '', C.dto, y, fR, 10, GRIS, 'd');
    txt(l.iva && l.iva.tipo ? l.iva.tipo + ' %' : 'Exenta', C.iva, y, fR, 9, GRIS2, 'd'); txt(eur(l.base), C.imp, y, fM, 10, NEGRO, 'd');
    y = Math.min(yy, y - 14) - 10; if (i < L.length - 1) linea(y + 8); y -= 8;
  });
  linea(y + 8, MIN ? NEGRO : LINEA, 0.8);

  // ── Totales ──
  y -= 14; const wT = 220, xT = X1 - wT, I = F.impuestos || [];
  const filasT = []; I.forEach(g => { filasT.push([g.tipo ? `Base imponible (${g.tipo} %)` : 'Base exenta', eur(g.base)]); if (g.tipo) filasT.push([`IVA ${g.tipo} %`, eur(g.cuota)]); });
  const hT = filasT.length * 16 + 54;
  const notaL = []; [F.nota, F.motivo ? 'Motivo de la rectificación: ' + F.motivo : ''].filter(Boolean).forEach(t => String(t).split('\n').forEach(t2 => partir(t2, fR, 8.5, AN - wT - 50).forEach(p => notaL.push(p))));
  if (notaL.length) { esp('Notas', X0, y - 16, 6.5, GRIS2); let yn = y - 32; notaL.slice(0, 14).forEach(p => { txt(p, X0, yn, fR, 8.5, GRIS); yn -= 12; }); }
  caja(xT, y, wT, hT, d === 'moderno' ? { color: CREMA } : null);
  let yt = y - 20; filasT.forEach(([a, b]) => { txt(a, xT + 16, yt, fR, 8.5, GRIS); txt(b, X1 - 16, yt, fR, 8.5, NEGRO, 'd'); yt -= 16; });
  if (MIN) pg.drawLine({ start: { x: xT + 16, y: yt + 4 }, end: { x: X1 - 16, y: yt + 4 }, thickness: 0.6, color: NEGRO });
  else pg.drawLine({ start: { x: xT + 16, y: yt + 4 }, end: { x: X1 - 16, y: yt + 4 }, thickness: 0.6, color: LINEA });
  esp('Total', xT + 16, yt - 15, 7, MIN ? NEGRO : AC, null, 1.3); txt(eur(F.total), X1 - 16, yt - 18, fB, 16, MIN ? NEGRO : AC, 'd');
  y -= Math.max(hT, notaL.length ? 32 + Math.min(14, notaL.length) * 12 : 0) + 20;

  // ── Pie: notas, exenciones, protección de datos ──
  const exentas = [...new Set(L.filter(l => !(l.iva && l.iva.tipo)).map(l => EXENC[(l.iva || {}).exencion] || EXENC.E1))];
  const pie = [...exentas, F.tipo === 'completa' && o.pago ? o.pago : ''].filter(Boolean);
  const rg = o.rgpd ? partir(o.rgpd, fR, 6.5, AN) : [];
  const piL = []; pie.forEach(t => String(t).split('\n').forEach(t2 => partir(t2, fR, 7.8, AN).forEach(p => piL.push(p))));
  let yp = 44 + rg.length * 8.5 + (rg.length ? 12 : 0) + piL.length * 11;
  if (yp + 30 > y - 10) { pg = doc.addPage([W, H]); arriba(); }
  linea(yp + 10);
  if (!MIN) txt('Gracias por confiar en ' + limpio(o.marca || E.razon || 'nosotros') + '.', X0, yp + 24, fM, 8.5, AC);
  piL.forEach(p => { yp -= 11; txt(p, X0, yp + 3, fR, 7.8, GRIS); }); yp -= 10;
  rg.forEach(p => { yp -= 8.5; txt(p, X0, yp + 3, fR, 6.5, GRIS2); });
  // Marcas: anulada / prueba
  const marca = F.estado === 'anulada' ? 'ANULADA' : F.prueba ? 'PRUEBA' : '';
  if (marca) doc.getPages().forEach(p => p.drawText(marca, { x: 150, y: 300, size: 90, font: fB, color: F.estado === 'anulada' ? rgb(0.85, 0.2, 0.2) : rgb(0.6, 0.55, 0.5), opacity: 0.07, rotate: { type: 'degrees', angle: 28 } }));
  const np = doc.getPageCount(); if (np > 1) doc.getPages().forEach((p, i) => p.drawText(`${i + 1}/${np}`, { x: X1 - 14, y: 24, size: 7, font: fR, color: GRIS2 }));
  return Buffer.from(await doc.save());
}
module.exports = { pdfFactura };
