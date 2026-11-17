// ── VERI*FACTU: envío de los registros a la AEAT (servicio web SOAP con el certificado de la empresa) ──
// Esquemas: SuministroLR.xsd / SuministroInformacion.xsd (AEAT, tike/cont/ws). Máx. 1.000 registros por envío y, entre envíos,
// esperar lo que diga la AEAT (TiempoEsperaEnvio, 60 s al principio). Los registros se mandan en el orden de la cadena.
// El certificado (.p12/.pfx) lo sube dirección en el panel: se guarda cifrado (AES-256-GCM) y nunca sale del servidor.
const crypto = require('crypto');
const https = require('https');
const FACX = require('./_facturacion');

const NS_SF = 'https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroInformacion.xsd';
const NS_LR = 'https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroLR.xsd';
const ENDPOINT = { pruebas: 'https://prewww1.aeat.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP', real: 'https://www1.agenciatributaria.gob.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP' };
// Quién hace el programa (productor del sistema informático) y cómo se llama
const SISTEMA = { nombreRazon: 'Fourth Dynamic, S.L.', nif: 'B56503592', nombre: 'Panel FISIO365', id: 'F3', version: '1.0', direccion: 'C/ Gran de Sant Andreu, 163, 08030 Barcelona' };

const clave = () => crypto.createHash('sha256').update(String(process.env.VF_CLAVE || process.env.FISIO_PASSWORD || 'sin-clave') + '|vf-cert').digest();
const cifra = o => { const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', clave(), iv), d = Buffer.concat([c.update(JSON.stringify(o), 'utf8'), c.final()]); return { iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), d: d.toString('base64') }; };
const descifra = x => { const c = crypto.createDecipheriv('aes-256-gcm', clave(), Buffer.from(x.iv, 'base64')); c.setAuthTag(Buffer.from(x.tag, 'base64')); return JSON.parse(Buffer.concat([c.update(Buffer.from(x.d, 'base64')), c.final()]).toString('utf8')); };
const conf = async k => { const D = await FACX.db(); return ((await D.query(`select v from fac_config where k=$1`, [k])).rows[0] || {}).v || null; };
const ponConf = async (k, v) => { const D = await FACX.db(); await D.query(`insert into fac_config(k,v) values($1,$2::jsonb) on conflict (k) do update set v=excluded.v, modificado=now()`, [k, JSON.stringify(v)]); };

// ── Certificado ──
function leerP12(b64, pass) {
  const forge = require('node-forge');
  let p12; try { p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(forge.util.decode64(b64)), String(pass || '')); } catch (e) { throw new Error(/password|MAC/i.test(e.message) ? 'La contraseña del certificado no es correcta' : 'No es un certificado .p12/.pfx válido'); }
  const bags = (p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] || []).map(b => b.cert).filter(Boolean);
  const keys = (p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] || []).length + (p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] || []).length;
  if (!bags.length || !keys) throw new Error('El archivo no lleva el certificado con su clave privada');
  const cert = bags.find(c => !c.extensions.some(e => e.name === 'basicConstraints' && e.cA)) || bags[0];
  const at = n => { const a = cert.subject.attributes.find(x => x.name === n || x.shortName === n || x.type === n); return a ? String(a.value) : ''; };
  const nif = (at('2.5.4.97') || at('serialNumber') || '').replace(/^(VATES-|IDCES-|VAT-ES-)/i, '').toUpperCase();
  return { nombre: at('commonName') || at('organizationName'), empresa: at('organizationName'), nif, desde: cert.validity.notBefore.toISOString(), caduca: cert.validity.notAfter.toISOString() };
}
async function guardarCert(b64, pass, por) {
  const info = leerP12(b64, pass);
  if (Date.parse(info.caduca) < Date.now()) throw new Error('Este certificado está caducado (' + info.caduca.slice(0, 10) + ')');
  await ponConf('vf_cert', Object.assign({ cifrado: cifra({ pfx: b64, pass: String(pass || '') }), subido: new Date().toISOString(), por: String(por || '').slice(0, 40) }, info));
  return info; }
async function certInfo() { const c = await conf('vf_cert'); if (!c) return null; const o = Object.assign({}, c); delete o.cifrado; return o; }
async function borrarCert() { const D = await FACX.db(); await D.query(`delete from fac_config where k='vf_cert'`); }
async function certPfx() { const c = await conf('vf_cert'); if (!c) return null; const x = descifra(c.cifrado); return { pfx: Buffer.from(x.pfx, 'base64'), passphrase: x.pass }; }

// ── XML ──
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const imp = n => (Math.round((Number(n) || 0) * 100) / 100).toFixed(2);
const fecha = f => { const [a, m, d] = String(f).slice(0, 10).split('-'); return `${d}-${m}-${a}`; };
const nifL = n => String(n || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const esNifEs = n => /^[0-9A-Z]\d{7}[0-9A-Z]$/.test(nifL(n));
const t = (n, v) => `<sf:${n}>${esc(v)}</sf:${n}>`;
const persona = (nombre, nif) => esNifEs(nif) ? t('NombreRazon', String(nombre || nif).slice(0, 120)) + t('NIF', nifL(nif)) : t('NombreRazon', String(nombre || nif).slice(0, 120)) + `<sf:IDOtro>${t('IDType', '06')}${t('ID', String(nif).slice(0, 20))}</sf:IDOtro>`;
const sistema = (inst) => `<sf:SistemaInformatico>${t('NombreRazon', SISTEMA.nombreRazon)}${t('NIF', SISTEMA.nif)}${t('NombreSistemaInformatico', SISTEMA.nombre)}${t('IdSistemaInformatico', SISTEMA.id)}${t('Version', SISTEMA.version)}${t('NumeroInstalacion', inst)}${t('TipoUsoPosibleSoloVerifactu', 'S')}${t('TipoUsoPosibleMultiOT', 'N')}${t('IndicadorMultiplesOT', 'N')}</sf:SistemaInformatico>`;
const encadena = prev => prev ? `<sf:Encadenamiento><sf:RegistroAnterior>${t('IDEmisorFactura', prev.nif)}${t('NumSerieFactura', prev.num_serie)}${t('FechaExpedicionFactura', fecha(prev.fecha))}${t('Huella', prev.huella)}</sf:RegistroAnterior></sf:Encadenamiento>` : `<sf:Encadenamiento>${t('PrimerRegistro', 'S')}</sf:Encadenamiento>`;
function desglose(F) {
  const L = (F.impuestos || []).map(i => { const base = imp(i.base);
    if (Number(i.tipo) > 0) return `<sf:DetalleDesglose>${t('Impuesto', '01')}${t('ClaveRegimen', '01')}${t('CalificacionOperacion', 'S1')}${t('TipoImpositivo', imp(i.tipo))}${t('BaseImponibleOimporteNoSujeto', base)}${t('CuotaRepercutida', imp(i.cuota))}</sf:DetalleDesglose>`;
    if (i.exencion === 'NS') return `<sf:DetalleDesglose>${t('Impuesto', '01')}${t('ClaveRegimen', '01')}${t('CalificacionOperacion', 'N1')}${t('BaseImponibleOimporteNoSujeto', base)}</sf:DetalleDesglose>`;
    return `<sf:DetalleDesglose>${t('Impuesto', '01')}${t('ClaveRegimen', '01')}${t('OperacionExenta', i.exencion === 'E6' ? 'E6' : 'E1')}${t('BaseImponibleOimporteNoSujeto', base)}</sf:DetalleDesglose>`; });
  return `<sf:Desglose>${L.join('') || `<sf:DetalleDesglose>${t('Impuesto', '01')}${t('ClaveRegimen', '01')}${t('OperacionExenta', 'E1')}${t('BaseImponibleOimporteNoSujeto', '0.00')}</sf:DetalleDesglose>`}</sf:Desglose>`;
}
function xmlAlta(r, F, prev, emisor, inst) {
  const tf = r.tipo_factura, cl = F.cliente || {}, desc = [...new Set((F.lineas || []).map(l => l.concepto).filter(Boolean))].join(', ').slice(0, 500) || 'Servicios';
  let x = `<sf:IDVersion>1.0</sf:IDVersion><sf:IDFactura>${t('IDEmisorFactura', r.nif)}${t('NumSerieFactura', r.num_serie)}${t('FechaExpedicionFactura', fecha(r.fecha))}</sf:IDFactura>${t('NombreRazonEmisor', String(emisor.razon || '').slice(0, 120))}`;
  // Reenvío de un rechazado: si ya era una subsanación → Subsanacion S + RechazoPrevio S; si era el alta normal → RechazoPrevio X
  if (r.rechazo_previo) x += r.subsanacion ? t('Subsanacion', 'S') + t('RechazoPrevio', 'S') : t('RechazoPrevio', 'X'); else if (r.subsanacion) x += t('Subsanacion', 'S');
  x += t('TipoFactura', tf);
  if (/^R/.test(tf)) { x += t('TipoRectificativa', 'I'); if (F.rect) x += `<sf:FacturasRectificadas><sf:IDFacturaRectificada>${t('IDEmisorFactura', r.nif)}${t('NumSerieFactura', F.rect.codigo)}${t('FechaExpedicionFactura', fecha(F.rect.fecha))}</sf:IDFacturaRectificada></sf:FacturasRectificadas>`; }
  if (tf === 'F3' && (F.sustituye || []).length) x += `<sf:FacturasSustituidas>${F.sustituye.map(s => `<sf:IDFacturaSustituida>${t('IDEmisorFactura', r.nif)}${t('NumSerieFactura', s.codigo)}${t('FechaExpedicionFactura', fecha(s.fecha))}</sf:IDFacturaSustituida>`).join('')}</sf:FacturasSustituidas>`;
  x += t('DescripcionOperacion', desc);
  if (['F1', 'F3', 'R1', 'R2', 'R3', 'R4'].includes(tf) && cl.nif) x += `<sf:Destinatarios><sf:IDDestinatario>${persona(cl.nombre, cl.nif)}</sf:IDDestinatario></sf:Destinatarios>`;
  x += desglose(F) + t('CuotaTotal', imp(r.cuota)) + t('ImporteTotal', imp(r.importe)) + encadena(prev) + sistema(inst) + t('FechaHoraHusoGenRegistro', r.fechahora) + t('TipoHuella', '01') + t('Huella', r.huella);
  return `<sfLR:RegistroFactura><sf:RegistroAlta>${x}</sf:RegistroAlta></sfLR:RegistroFactura>`;
}
function xmlAnul(r, prev, inst) {
  return `<sfLR:RegistroFactura><sf:RegistroAnulacion><sf:IDVersion>1.0</sf:IDVersion><sf:IDFactura>${t('IDEmisorFacturaAnulada', r.nif)}${t('NumSerieFacturaAnulada', r.num_serie)}${t('FechaExpedicionFacturaAnulada', fecha(r.fecha))}</sf:IDFactura>${encadena(prev)}${sistema(inst)}${t('FechaHoraHusoGenRegistro', r.fechahora)}${t('TipoHuella', '01')}${t('Huella', r.huella)}</sf:RegistroAnulacion></sfLR:RegistroFactura>`;
}
const sobre = (emisor, regs) => `<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:sfLR="${NS_LR}" xmlns:sf="${NS_SF}"><soapenv:Header/><soapenv:Body><sfLR:RegFactuSistemaFacturacion><sfLR:Cabecera><sf:ObligadoEmision>${t('NombreRazon', String(emisor.razon || '').slice(0, 120))}${t('NIF', nifL(emisor.nif))}</sf:ObligadoEmision></sfLR:Cabecera>${regs.join('')}</sfLR:RegFactuSistemaFacturacion></soapenv:Body></soapenv:Envelope>`;

// ── Respuesta ──
const tag = (s, n) => { const m = String(s).match(new RegExp(`<(?:\\w+:)?${n}>([\\s\\S]*?)</(?:\\w+:)?${n}>`)); return m ? m[1].trim() : ''; };
const tags = (s, n) => [...String(s).matchAll(new RegExp(`<(?:\\w+:)?${n}>([\\s\\S]*?)</(?:\\w+:)?${n}>`, 'g'))].map(m => m[1]);
function leerRespuesta(xml) {
  const fault = tag(xml, 'faultstring'); if (fault) return { fault };
  return { csv: tag(xml, 'CSV'), estado: tag(xml, 'EstadoEnvio'), espera: +tag(xml, 'TiempoEsperaEnvio') || 60,
    lineas: tags(xml, 'RespuestaLinea').map(l => ({ num: tag(l, 'NumSerieFactura'), op: tag(tag(l, 'Operacion'), 'TipoOperacion') || 'Alta', estado: tag(l, 'EstadoRegistro'), codigo: tag(l, 'CodigoErrorRegistro'), error: tag(l, 'DescripcionErrorRegistro') })) };
}
function post(url, body, cert) {
  return new Promise((ok, ko) => { const u = new URL(url);
    const r = https.request({ hostname: u.hostname, path: u.pathname, method: 'POST', pfx: cert.pfx, passphrase: cert.passphrase, timeout: 25000, headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: '""', 'Content-Length': Buffer.byteLength(body) } }, res => {
      let d = ''; res.setEncoding('utf8'); res.on('data', c => { d += c; }); res.on('end', () => ok({ status: res.statusCode, body: d })); });
    r.on('timeout', () => { r.destroy(new Error('La AEAT no contesta (tiempo agotado)')); }); r.on('error', ko); r.end(body); });
}

// ── Enviar lo pendiente de un entorno (en orden; como mucho 1.000) ──
async function enviar(entorno, o) {
  o = o || {}; const D = await FACX.db(); entorno = entorno === 'real' ? 'real' : 'pruebas';
  const cert = await certPfx(); if (!cert) return { sin: 'certificado' };
  const esp = await conf('vf_espera:' + entorno); if (esp && esp.hasta > Date.now() && !o.forzar) return { espera: Math.ceil((esp.hasta - Date.now()) / 1000) };
  // Que no entren dos envíos a la vez
  const lk = 'vf_lock:' + entorno, lock = (await D.query(`insert into fac_config(k,v,modificado) values($1,'{}'::jsonb,now()) on conflict (k) do update set modificado=now() where fac_config.modificado < now() - interval '90 seconds' returning k`, [lk])).rows.length; if (!lock) return { ocupado: true };
  try {
    const R = (await D.query(`select r.*, r.fecha::text fecha from fac_registros r where entorno=$1 and estado in ('pendiente','error_envio') order by id limit 1000`, [entorno])).rows;
    if (!R.length) return { nada: true };
    const C = await FACX.config(), inst = nifL(C.emisor.nif) + '-' + entorno.slice(0, 1).toUpperCase() + '1', regs = [];
    for (const r of R) {
      const prev = (await D.query(`select nif, num_serie, fecha::text fecha, huella from fac_registros where entorno=$1 and nif=$2 and id<$3 order by id desc limit 1`, [entorno, r.nif, r.id])).rows[0] || null;
      if (r.tipo === 'anulacion') { regs.push(xmlAnul(r, prev, inst)); continue; }
      const F = (await D.query(`select f.*, f.fecha::text fecha from fac_facturas f where f.id=$1`, [r.factura])).rows[0] || {};
      if (F.rectifica) F.rect = (await D.query(`select codigo, fecha::text fecha from fac_facturas where id=$1`, [F.rectifica])).rows[0] || null;
      regs.push(xmlAlta(r, F, prev, F.emisor || C.emisor, inst)); }
    const body = sobre(C.emisor, regs);
    let resp; try { resp = await post(ENDPOINT[entorno], body, cert); }
    catch (e) { await D.query(`update fac_registros set estado='error_envio', respuesta=$2, enviado=now() where id = any($1)`, [R.map(r => r.id), { error: e.message }]); await ponConf('vf_ultimo:' + entorno, { t: new Date().toISOString(), error: e.message, n: R.length }); return { error: e.message }; }
    const X = leerRespuesta(resp.body);
    if (X.fault || !X.estado) { const err = X.fault || ('Respuesta ' + resp.status + ' sin contenido'); await D.query(`update fac_registros set estado='error_envio', respuesta=$2, enviado=now() where id = any($1)`, [R.map(r => r.id), { error: err.slice(0, 500) }]); await ponConf('vf_ultimo:' + entorno, { t: new Date().toISOString(), error: err.slice(0, 500), n: R.length }); return { error: err }; }
    await ponConf('vf_espera:' + entorno, { hasta: Date.now() + X.espera * 1000 });
    const porNum = {}; X.lineas.forEach(l => { porNum[(l.op === 'Anulacion' ? 'A:' : 'F:') + l.num] = l; });
    let bien = 0, mal = 0;
    for (const r of R) { const l = porNum[(r.tipo === 'anulacion' ? 'A:' : 'F:') + r.num_serie] || (X.estado === 'Correcto' ? { estado: 'Correcto' } : null);
      // 3000: ya estaba registrado (p. ej. un reintento después de un corte): cuenta como bien
      const est = !l ? 'error_envio' : l.estado === 'Correcto' || l.codigo === '3000' ? 'correcto' : l.estado === 'AceptadoConErrores' ? 'aceptado_errores' : 'rechazado';
      if (est === 'correcto' || est === 'aceptado_errores') bien++; else mal++;
      await D.query(`update fac_registros set estado=$2, csv=$3, respuesta=$4, enviado=now() where id=$1`, [r.id, est, X.csv || null, l ? { estado: l.estado, codigo: l.codigo || null, error: l.error || null } : { error: 'Sin respuesta para este registro' }]); }
    await ponConf('vf_ultimo:' + entorno, { t: new Date().toISOString(), estado: X.estado, csv: X.csv, n: R.length, bien, mal });
    return { enviados: R.length, bien, mal, estado: X.estado, csv: X.csv };
  } finally { await D.query(`delete from fac_config where k=$1`, [lk]).catch(() => {}); }
}
// Volver a mandar un registro rechazado (subsanación con «rechazo previo»): para cuando el problema ya está resuelto (p. ej. un NIF que Hacienda no reconocía)
async function reenviar(id) { const D = await FACX.db(); const r = (await D.query(`update fac_registros set estado='pendiente', rechazo_previo=(tipo<>'anulacion') where id=$1 and estado in ('rechazado','aceptado_errores') returning entorno`, [+id])).rows[0]; if (!r) throw new Error('Ese registro no está rechazado'); return r.entorno; }
async function estado(entorno) { const D = await FACX.db(); entorno = entorno === 'real' ? 'real' : 'pruebas';
  const c = (await D.query(`select estado, count(*)::int n from fac_registros where entorno=$1 group by estado`, [entorno])).rows, cuenta = {}; c.forEach(x => { cuenta[x.estado] = x.n; });
  const errores = (await D.query(`select id, num_serie, tipo, fecha::text fecha, estado, respuesta from fac_registros where entorno=$1 and estado in ('rechazado','aceptado_errores') order by id desc limit 50`, [entorno])).rows;
  return { cuenta, errores, ultimo: await conf('vf_ultimo:' + entorno), cert: await certInfo() }; }
module.exports = { reenviar, SISTEMA, ENDPOINT, guardarCert, certInfo, borrarCert, enviar, estado, xmlAlta, xmlAnul, sobre, leerRespuesta, leerP12 };
