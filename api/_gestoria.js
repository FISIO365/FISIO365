// ── Para la gestoría: resumen de un periodo (normalmente un trimestre) ──
// IVA repercutido (facturas emitidas) y soportado (gastos) por tipo, retenciones practicadas (alquiler → 115, profesionales → 111),
// y los dos libros (emitidas y recibidas). El IVA se declara por empresa (NIF): por defecto, todas las actividades juntas.
const { PDFDocument, rgb } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');
const FACX = require('./_facturacion');
const GX = require('./_gastos');

const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const esFecha = f => /^\d{4}-\d{2}-\d{2}$/.test(String(f || ''));
async function datos(o) {
  const D = await GX.db(); if (!esFecha(o.desde) || !esFecha(o.hasta)) throw new Error('Elige el periodo');
  const p = [o.desde, o.hasta], wa = o.actividad ? (p.push(o.actividad), ' and actividad=$3') : '';
  const F = (await D.query(`select id, codigo, fecha::text fecha, tipo, cliente, base::float base, cuota::float cuota, total::float total, impuestos, actividad, prueba from fac_facturas where estado='emitida' and fecha between $1 and $2${wa} order by fecha, emitida`, p)).rows;
  const G = (await D.query(`select id, fecha::text fecha, proveedor, numero, categoria, concepto, impuestos, base::float base, cuota::float cuota, irpf::float irpf, irpf_tipo::float irpf_tipo, total::float total, archivo, actividad, cuenta from fac_gastos where fecha between $1 and $2${wa} order by fecha, creado`, p)).rows;
  const porTipo = (L) => { const M = {}; L.forEach(x => (x.impuestos || []).forEach(i => { const k = i.tipo ? String(i.tipo) : 'exenta'; const m = M[k] = M[k] || { tipo: i.tipo || 0, base: 0, cuota: 0 }; m.base = r2(m.base + Number(i.base || 0)); m.cuota = r2(m.cuota + Number(i.cuota || 0)); })); return Object.values(M).sort((a, b) => b.tipo - a.tipo); };
  const rep = porTipo(F), sop = porTipo(G);
  const ret = { alquiler: { base: 0, irpf: 0 }, profesionales: { base: 0, irpf: 0 } };
  G.filter(g => g.irpf).forEach(g => { const k = g.categoria === 'Alquiler' ? 'alquiler' : 'profesionales'; ret[k].base = r2(ret[k].base + g.base); ret[k].irpf = r2(ret[k].irpf + g.irpf); });
  const sum = (L, k) => r2(L.reduce((t, x) => t + (Number(x[k]) || 0), 0));
  const R = { emitidas: { n: F.length, base: sum(F, 'base'), cuota: sum(F, 'cuota'), total: sum(F, 'total') }, recibidas: { n: G.length, base: sum(G, 'base'), cuota: sum(G, 'cuota'), irpf: sum(G, 'irpf'), total: sum(G, 'total') } };
  R.resultado = r2(R.emitidas.cuota - R.recibidas.cuota);
  const falta = G.filter(g => !g.archivo && !GX.SIN_DOC.has(g.categoria)).length, pruebas = F.filter(f => f.prueba).length;
  const banco = (await D.query(`select count(*)::int n from fac_movimientos where estado='pendiente' and fecha between $1 and $2`, [o.desde, o.hasta])).rows[0].n;
  return { desde: o.desde, hasta: o.hasta, actividad: o.actividad || '', facturas: F, gastos: G, iva: { repercutido: rep, soportado: sop }, retenciones: ret, resumen: R, avisos: { falta, pruebas, banco } };
}

const eur = n => (Number(n) || 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
const fFmt = f => String(f || '').slice(0, 10).split('-').reverse().join('/');
const hex = h => { const m = String(h || '#c2552e').match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i) || [0, 'c2', '55', '2e']; return rgb(parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255); };
let _F = null; const fuentes = () => _F || (_F = { reg: Buffer.from(require('./_fuente_regular'), 'base64'), med: Buffer.from(require('./_fuentes').medium, 'base64'), bold: Buffer.from(require('./_fuentes').bold, 'base64') });

async function pdf(X, o) {
  o = o || {}; const doc = await PDFDocument.create(); doc.registerFontkit(fontkit);
  const B = fuentes(), fR = await doc.embedFont(B.reg, { subset: true }), fM = await doc.embedFont(B.med, { subset: true }), fB = await doc.embedFont(B.bold, { subset: true });
  const W = 595.28, H = 841.89, M = 42, AC = hex(o.color), NEG = rgb(0.1, 0.1, 0.1), GR = rgb(0.48, 0.43, 0.4), LN = rgb(0.92, 0.89, 0.86), CR = rgb(0.98, 0.965, 0.95);
  let pg, y;
  const nueva = () => { pg = doc.addPage([W, H]); y = H - M; pg.drawText(`${o.empresa || ''}${o.nif ? ' · ' + o.nif : ''}`, { x: M, y: 22, size: 7.5, font: fR, color: GR }); pg.drawText(`Página ${doc.getPageCount()}`, { x: W - M - fR.widthOfTextAtSize(`Página ${doc.getPageCount()}`, 7.5), y: 22, size: 7.5, font: fR, color: GR }); };
  const corta = (t, f, s, w) => { t = String(t || ''); if (f.widthOfTextAtSize(t, s) <= w) return t; while (t.length > 1 && f.widthOfTextAtSize(t + '…', s) > w) t = t.slice(0, -1); return t + '…'; };
  const txt = (t, x, f, s, c, al, w) => { t = w ? corta(t, f, s, w) : String(t); const tw = f.widthOfTextAtSize(t, s); pg.drawText(t, { x: al === 'r' ? x - tw : x, y, size: s, font: f, color: c || NEG }); };
  const sitio = h => { if (y - h < 40) nueva(); };
  nueva();
  // Cabecera
  txt('Resumen para la gestoría', M, fM, 20); y -= 20;
  txt(`${o.periodo || ''} · del ${fFmt(X.desde)} al ${fFmt(X.hasta)}${o.actNom ? ' · ' + o.actNom : ''}`, M, fR, 10, GR); y -= 14;
  txt(`${o.empresa || ''}${o.nif ? ' · NIF ' + o.nif : ''}`, M, fR, 10, GR); y -= 26;
  // Tarjetas
  const R = X.resumen, cw = (W - 2 * M - 20) / 3;
  [['IVA repercutido', eur(R.emitidas.cuota), `${R.emitidas.n} facturas · base ${eur(R.emitidas.base)}`], ['IVA soportado', eur(R.recibidas.cuota), `${R.recibidas.n} gastos · base ${eur(R.recibidas.base)}`], [R.resultado >= 0 ? 'A ingresar (aprox.)' : 'A compensar (aprox.)', eur(Math.abs(R.resultado)), 'Repercutido − soportado']].forEach(([a, b, c], i) => {
    const x = M + i * (cw + 10); pg.drawRectangle({ x, y: y - 62, width: cw, height: 66, color: i === 2 ? CR : rgb(1, 1, 1), borderColor: LN, borderWidth: 0.8 });
    pg.drawText(a.toUpperCase(), { x: x + 12, y: y - 14, size: 7, font: fB, color: GR }); pg.drawText(b, { x: x + 12, y: y - 36, size: 15, font: fM, color: i === 2 ? AC : NEG }); pg.drawText(corta(c, fR, 7.5, cw - 24), { x: x + 12, y: y - 52, size: 7.5, font: fR, color: GR }); });
  y -= 86;
  // IVA por tipo
  const tabla = (tit, cols, filas, tot) => { sitio(60); txt(tit, M, fM, 12); y -= 16;
    const fila = (vals, f, c, fondo) => { sitio(16); if (fondo) pg.drawRectangle({ x: M - 4, y: y - 4, width: W - 2 * M + 8, height: 15, color: fondo }); let x = M; cols.forEach((col, i) => { const v = vals[i] == null ? '' : vals[i]; if (col.r) txt(v, x + col.w, f, 7.8, c, 'r'); else txt(v, x, f, 7.8, c, null, col.w - 6); x += col.w; }); y -= 15; };
    fila(cols.map(c => c.t), fB, GR, CR); filas.forEach(v => { fila(v, fR, NEG); pg.drawLine({ start: { x: M, y: y + 11 }, end: { x: W - M, y: y + 11 }, thickness: 0.4, color: LN }); });
    if (tot) fila(tot, fM, NEG); y -= 12; };
  const civa = [{ t: 'Tipo', w: 140 }, { t: 'Base', w: 120, r: 1 }, { t: 'Cuota', w: 120, r: 1 }];
  tabla('IVA repercutido (facturas emitidas)', civa, X.iva.repercutido.map(i => [i.tipo ? i.tipo + ' %' : 'Exenta / sin IVA', eur(i.base), eur(i.cuota)]), ['Total', eur(R.emitidas.base), eur(R.emitidas.cuota)]);
  tabla('IVA soportado (gastos)', civa, X.iva.soportado.map(i => [i.tipo ? i.tipo + ' %' : 'Sin IVA', eur(i.base), eur(i.cuota)]), ['Total', eur(R.recibidas.base), eur(R.recibidas.cuota)]);
  const Rt = X.retenciones; if (Rt.alquiler.irpf || Rt.profesionales.irpf) tabla('Retenciones practicadas', [{ t: 'Qué', w: 240 }, { t: 'Base', w: 120, r: 1 }, { t: 'Retención', w: 120, r: 1 }], [Rt.alquiler.irpf ? ['Alquiler del local (modelo 115)', eur(Rt.alquiler.base), eur(Rt.alquiler.irpf)] : null, Rt.profesionales.irpf ? ['Profesionales (modelo 111)', eur(Rt.profesionales.base), eur(Rt.profesionales.irpf)] : null].filter(Boolean));
  const av = []; if (X.avisos.falta) av.push(`Hay ${X.avisos.falta} gasto${X.avisos.falta > 1 ? 's' : ''} sin la factura subida.`); if (X.avisos.banco) av.push(`Quedan ${X.avisos.banco} movimiento${X.avisos.banco > 1 ? 's' : ''} del banco por revisar en este periodo.`); if (X.avisos.pruebas) av.push(`${X.avisos.pruebas} facturas son la copia de prueba de los tickets de Holded (las que valen son las de Holded).`);
  if (av.length) { sitio(20 + av.length * 13); av.forEach(a => { txt('· ' + a, M, fR, 8.5, AC); y -= 13; }); y -= 10; }
  // Libros
  y -= 6; tabla('Facturas emitidas', [{ t: 'Fecha', w: 52 }, { t: 'Nº', w: 78 }, { t: 'Cliente', w: 170 }, { t: 'NIF', w: 70 }, { t: 'Base', w: 48, r: 1 }, { t: 'IVA', w: 42, r: 1 }, { t: 'Total', w: 51, r: 1 }],
    X.facturas.map(f => [fFmt(f.fecha), f.codigo, (f.cliente || {}).nombre || '', (f.cliente || {}).nif || '', eur(f.base).replace(' €', ''), eur(f.cuota).replace(' €', ''), eur(f.total).replace(' €', '')]), ['', '', `${X.facturas.length} facturas`, '', eur(R.emitidas.base).replace(' €', ''), eur(R.emitidas.cuota).replace(' €', ''), eur(R.emitidas.total).replace(' €', '')]);
  tabla('Facturas recibidas (gastos)', [{ t: 'Fecha', w: 52 }, { t: 'Proveedor', w: 140 }, { t: 'NIF', w: 66 }, { t: 'Nº', w: 70 }, { t: 'Base', w: 46, r: 1 }, { t: 'IVA', w: 40, r: 1 }, { t: 'Ret.', w: 36, r: 1 }, { t: 'Total', w: 61, r: 1 }],
    X.gastos.map(g => [fFmt(g.fecha), g.proveedor.nombre, g.proveedor.nif || '', g.numero || (g.archivo ? '' : 'sin factura'), eur(g.base).replace(' €', ''), eur(g.cuota).replace(' €', ''), g.irpf ? eur(g.irpf).replace(' €', '') : '', eur(g.total).replace(' €', '')]), ['', `${X.gastos.length} gastos`, '', '', eur(R.recibidas.base).replace(' €', ''), eur(R.recibidas.cuota).replace(' €', ''), R.recibidas.irpf ? eur(R.recibidas.irpf).replace(' €', '') : '', eur(R.recibidas.total).replace(' €', '')]);
  sitio(30); txt('Importes en euros. El resultado del IVA es orientativo: lo calcula y lo presenta la gestoría.', M, fR, 7.5, GR);
  return Buffer.from(await doc.save());
}
module.exports = { datos, pdf };
