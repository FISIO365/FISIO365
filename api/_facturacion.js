// ── Facturación propia del panel (fase 1: en paralelo con Holded) ──
// Tablas propias en Postgres (no pasan por la capa de Airtable): numeración correlativa sin huecos por serie y año,
// facturas inmutables una vez emitidas, IVA por línea, series con su diseño. Más adelante: VeriFactu (huella, QR y envío a la AEAT).
const crypto = require('crypto');
const PG = require('./_pg');
const VF = require('./_verifactu');

const SQL = `
create table if not exists fac_config (k text primary key, v jsonb not null default '{}'::jsonb, modificado timestamptz not null default now());
create table if not exists fac_series (id text primary key, nombre text not null, prefijo text not null unique, tipo text not null default 'simplificada', diseno text not null default 'clasico', color text, activa boolean not null default true, auto boolean not null default false, nota text, orden int not null default 0, creado timestamptz not null default now());
create table if not exists fac_contadores (serie text not null, anio int not null, n bigint not null default 0, primary key (serie, anio));
create table if not exists fac_facturas (id text primary key, serie text not null, anio int not null, numero bigint not null, codigo text not null unique, tipo text not null, fecha date not null, emitida timestamptz not null default now(), emisor jsonb not null, cliente jsonb not null, lineas jsonb not null, impuestos jsonb not null, base numeric(12,2) not null, cuota numeric(12,2) not null, total numeric(12,2) not null, paciente text, fisio text, cobro text, holded text, holded_num text, pagos jsonb, nota text, rectifica text, motivo text, estado text not null default 'emitida', diseno text, por text, vf jsonb, unique (serie, anio, numero));
alter table fac_facturas add column if not exists prueba boolean not null default false;
alter table fac_series add column if not exists formato text not null default '{P}{AAAA}-{N5}';
alter table fac_series add column if not exists anual boolean not null default true;
alter table fac_series add column if not exists actividad text not null default 'principal';
alter table fac_facturas add column if not exists actividad text not null default 'principal';
alter table fac_facturas add column if not exists enviada jsonb not null default '[]'::jsonb;
alter table fac_facturas add column if not exists sustituye jsonb;
alter table fac_facturas add column if not exists sustituida_por text;
alter table fac_facturas add column if not exists rect_simpl boolean not null default false;
create table if not exists fac_clientes (id text primary key, actividad text not null default 'principal', nombre text not null, nif text, direccion text, cp text, ciudad text, provincia text, pais text, email text, tel text, nota text, usado timestamptz not null default now(), creado timestamptz not null default now());
create table if not exists fac_presupuestos (id text primary key, actividad text not null default 'principal', anio int not null, numero int not null, codigo text not null unique, fecha date not null, validez date, cliente jsonb not null, lineas jsonb not null, impuestos jsonb not null, base numeric(12,2) not null, cuota numeric(12,2) not null, total numeric(12,2) not null, nota text, estado text not null default 'pendiente', factura text, por text, creado timestamptz not null default now(), modificado timestamptz not null default now())
`;
const ini = { p: null };
async function db() {
  if (!PG.ACTIVO || !PG.db) throw new Error('La facturación necesita la base de datos propia');
  if (!ini.p) ini.p = (async () => { for (const s of (SQL + ';\n' + VF.SQL).split(/;\s*\n/).map(x => x.trim()).filter(Boolean)) await PG.db().query(s); await sembrar(); })().catch(e => { ini.p = null; throw e; });
  await ini.p; return PG.db();
}

// ── Configuración ──
// IVA: cada concepto con su tipo (0, 4, 10, 21) y, si es 0, el motivo (exenta por ser sanitaria, etc.)
const EXENCIONES = { E1: 'Operación exenta de IVA (art. 20.Uno.3º de la Ley 37/1992 del IVA: asistencia sanitaria)', E6: 'Operación exenta de IVA', NS: 'Operación no sujeta a IVA' };
const CONF_DEF = {
  emisor: { razon: '', nif: '', direccion: '', cp: '', ciudad: '', provincia: '', pais: 'España', email: '', tel: '', web: '' },
  iva: { def: { tipo: 0, exencion: 'E1' }, conceptos: {} }, // conceptos: { 'Sesión de fisioterapia': { tipo: 0, exencion: 'E1' }, 'Venta de material': { tipo: 21 } }
  pie: '', // texto al pie (protección de datos)
  pago: '', // texto de forma de pago para completas (IBAN…)
  vf: { entorno: 'pruebas' }, // VERI*FACTU: «pruebas» (AEAT de pruebas) o «real»
  // Actividades de la misma empresa (mismo NIF y misma cadena VeriFactu), cada una con su marca, sus series y su IVA.
  // «principal» es la clínica (logo y datos de siempre); el resto, p. ej. CerraPoint
  actividades: [{ id: 'principal', nombre: '', logo: '', color: '', tel: '', email: '', web: '', direccion: '', iva: null }]
};
const actLimpia = a => ({ id: String(a.id || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20) || 'principal', nombre: String(a.nombre || '').trim().slice(0, 60), logo: /^data:image\/(png|jpeg);base64,/.test(a.logo || '') && String(a.logo).length < 700000 ? a.logo : '',
  color: /^#[0-9a-f]{6}$/i.test(a.color || '') ? a.color : '', tel: String(a.tel || '').slice(0, 40), email: String(a.email || '').slice(0, 120), web: String(a.web || '').slice(0, 120), direccion: String(a.direccion || '').slice(0, 200), iva: a.iva ? ivaLimpio(a.iva) : null, tarjeta: a.tarjeta !== false && a.tarjeta !== 'false' });
async function config() { const D = await db(); const r = await D.query(`select v from fac_config where k='config'`); const g = (r.rows[0] || {}).v || {};
  return { emisor: Object.assign({}, CONF_DEF.emisor, g.emisor || {}), iva: { def: Object.assign({}, CONF_DEF.iva.def, (g.iva || {}).def || {}), conceptos: Object.assign({}, (g.iva || {}).conceptos || {}) }, pie: g.pie != null ? g.pie : CONF_DEF.pie, pago: g.pago || '', vf: { entorno: (g.vf || {}).entorno === 'real' ? 'real' : 'pruebas' },
    actividades: (Array.isArray(g.actividades) && g.actividades.length ? g.actividades : CONF_DEF.actividades).map(actLimpia).filter((a, i, L) => L.findIndex(x => x.id === a.id) === i) }; }
async function guardarConfig(c) { const D = await db(); const v = await config();
  if (c.emisor) Object.keys(CONF_DEF.emisor).forEach(k => { if (c.emisor[k] != null) v.emisor[k] = String(c.emisor[k]).trim().slice(0, 200); });
  if (c.iva) { if (c.iva.def) v.iva.def = ivaLimpio(c.iva.def); if (c.iva.conceptos) { v.iva.conceptos = {}; Object.entries(c.iva.conceptos).slice(0, 200).forEach(([k, x]) => { k = String(k).trim().slice(0, 120); if (k) v.iva.conceptos[k] = ivaLimpio(x); }); } }
  if (c.pie != null) v.pie = String(c.pie).slice(0, 2000);
  if (c.vf && ['pruebas', 'real'].includes(c.vf.entorno)) v.vf = Object.assign({}, v.vf, { entorno: c.vf.entorno });
  if (c.pago != null) v.pago = String(c.pago).slice(0, 500);
  if (Array.isArray(c.actividades)) { const L = c.actividades.slice(0, 10).map(actLimpia); if (!L.some(a => a.id === 'principal')) L.unshift(actLimpia({ id: 'principal' }));
    // Logo que no se manda: se queda el que había
    L.forEach(a => { if (!a.logo && !(c.actividades.find(x => x.id === a.id) || {}).quitarLogo) a.logo = ((v.actividades.find(x => x.id === a.id) || {}).logo) || ''; });
    const nuevas = L.filter(a => !v.actividades.some(x => x.id === a.id)); v.actividades = L;
    // Actividad nueva: sus series (completas, simplificadas y rectificativas) con su prefijo
    for (const a of nuevas) { const P = (a.nombre || a.id).replace(/[^A-Za-z]/g, '').slice(0, 1).toUpperCase() || 'X', crea = async (id, nom, pre, tipo, orden) => D.query(`insert into fac_series(id,nombre,prefijo,tipo,diseno,actividad,orden) values($1,$2,$3,$4,'clasico',$5,$6) on conflict do nothing`, [id, nom, pre, tipo, a.id, orden]).catch(() => {});
      const libre = async b => { let p = b, i = 2; while ((await D.query(`select 1 from fac_series where prefijo=$1`, [p])).rows.length) p = b + (i++); return p; };
      await crea(a.id + '-F', 'Facturas ' + (a.nombre || a.id), await libre(P), 'completa', 20); await crea(a.id + '-S', 'Tickets ' + (a.nombre || a.id), await libre(P + 'T'), 'simplificada', 21); await crea(a.id + '-R', 'Rectificativas ' + (a.nombre || a.id), await libre(P + 'R'), 'rectificativa', 22); } }
  await D.query(`insert into fac_config(k,v,modificado) values('config',$1,now()) on conflict (k) do update set v=excluded.v, modificado=now()`, [v]); return v; }
const TIPOS_IVA = [0, 4, 10, 21];
function ivaLimpio(x) { x = x || {}; const t = Number(x.tipo); const tipo = TIPOS_IVA.includes(t) ? t : 0; return tipo ? { tipo } : { tipo: 0, exencion: EXENCIONES[x.exencion] ? x.exencion : 'E1' }; }
const ivaDe = (C, concepto) => ivaLimpio(C.iva.conceptos[concepto] || C.iva.def);
const actDe = (C, id) => C.actividades.find(a => a.id === id) || C.actividades[0] || actLimpia({});

// ── Series ──
const TIPOS = { simplificada: 'Factura simplificada', completa: 'Factura', rectificativa: 'Factura rectificativa' };
const DISENOS = { clasico: 'Clásico', moderno: 'Moderno', minimal: 'Minimal' };
async function sembrar() { const D = PG.db(); const r = await D.query(`select count(*)::int n from fac_series`); if (r.rows[0].n) return;
  await D.query(`insert into fac_series(id,nombre,prefijo,tipo,diseno,auto,orden) values ('S','Tickets (simplificadas)','T','simplificada','clasico',true,1),('F','Facturas completas','F','completa','clasico',false,2),('R','Rectificativas','R','rectificativa','clasico',false,3) on conflict do nothing`); }
async function series() { const D = await db(), anio = +isoMad().slice(0, 4); const L = (await D.query(`select s.*, (select count(*)::int from fac_facturas f where f.serie=s.id and not f.prueba) as usadas from fac_series s order by orden, creado`)).rows;
  for (const s of L) { s.siguiente = await siguiente(D, s, anio); s.proxima = codigoDe(s, anio, s.siguiente); } return L; }
async function guardarSerie(x) { const D = await db();
  const nombre = String(x.nombre || '').trim().slice(0, 60), prefijo = String(x.prefijo || '').trim().toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 10);
  if (!nombre || !prefijo) throw new Error('Pon el nombre y el prefijo de la serie');
  const tipo = TIPOS[x.tipo] ? x.tipo : 'simplificada', diseno = DISENOS[x.diseno] ? x.diseno : 'clasico', color = /^#[0-9a-f]{6}$/i.test(x.color || '') ? x.color : null;
  const formato = String(x.formato || '{P}{AAAA}-{N5}').trim(), anual = x.anual !== false, actividad = String(x.actividad || 'principal');
  if (!formatoOk(formato)) throw new Error('El formato tiene que llevar {N} (el número) y solo letras, números, guiones o barras');
  if (x.id) { const ya = (await D.query(`select s.*, (select count(*)::int from fac_facturas f where f.serie=s.id and not f.prueba) usadas from fac_series s where id=$1`, [x.id])).rows[0]; if (!ya) throw new Error('No encuentro esa serie');
    // Con facturas ya hechas, el prefijo y el tipo no se tocan (cambiarían números ya emitidos)
    if (ya.usadas && (prefijo !== ya.prefijo || tipo !== ya.tipo || formato !== ya.formato || anual !== ya.anual)) throw new Error('Esta serie ya tiene facturas: no se le puede cambiar el prefijo, el tipo ni el formato del número. Crea una serie nueva.');
    await D.query(`update fac_series set nombre=$2, prefijo=$3, tipo=$4, diseno=$5, color=$6, activa=$7, nota=$8, formato=$9, anual=$10 where id=$1`, [x.id, nombre, prefijo, tipo, diseno, color, x.activa !== false, String(x.nota || '').slice(0, 300), formato, anual]);
  } else { const id = 'S' + crypto.randomBytes(5).toString('hex');
    await D.query(`insert into fac_series(id,nombre,prefijo,tipo,diseno,color,nota,formato,anual,actividad,orden) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,(select coalesce(max(orden),0)+1 from fac_series))`, [id, nombre, prefijo, tipo, diseno, color, String(x.nota || '').slice(0, 300), formato, anual, actividad]).catch(e => { if (/unique/i.test(e.message)) throw new Error('Ya hay una serie con ese prefijo'); throw e; }); x.id = id; }
  // Por qué número sigue (p. ej. el siguiente al último ticket de Holded). Nunca hacia atrás: no puede repetir números ya usados
  if (x.siguiente != null && String(x.siguiente).trim() !== '') { const sig = Math.floor(Number(x.siguiente)), s2 = (await D.query(`select * from fac_series where id=$1`, [x.id])).rows[0], anio = +isoMad().slice(0, 4), k = s2.anual ? anio : 0;
    if (!(sig >= 1 && sig < 1e9)) throw new Error('El número por el que sigue no es válido');
    const act = await siguiente(D, s2, anio);
    if (sig !== act) { const usados = Number(((await D.query(`select max(numero) m from fac_facturas where serie=$1 and ${s2.anual ? 'anio=$2' : '$2=$2'} and not prueba`, [x.id, anio])).rows[0] || {}).m || 0);
      if (sig <= usados) throw new Error(`Ya hay facturas hasta el nº ${usados} en esta serie: tiene que seguir por el ${usados + 1} o más`);
      await D.query(`insert into fac_contadores(serie,anio,n) values($1,$2,$3) on conflict (serie,anio) do update set n=$3`, [x.id, k, sig - 1]); } }
  // Serie de los cobros del panel: solo una (simplificada o completa)
  if (x.auto) await D.query(`update fac_series set auto=(id=$1)`, [x.id]);
  return x.id; }

// ── Formato del número: {P} prefijo, {AAAA} año, {AA} año corto, {N} número (con {N4}, {N5}… cifras mínimas) ──
function codigoDe(s, anio, n) {
  let f = String(s.formato || '{P}{AAAA}-{N5}');
  return f.replace(/\{P\}/g, s.prefijo).replace(/\{AAAA\}/g, String(anio)).replace(/\{AA\}/g, String(anio).slice(2)).replace(/\{N(\d?)\}/g, (m, d) => String(n).padStart(+d || 1, '0'));
}
const formatoOk = f => /\{N\d?\}/.test(f) && f.length <= 40 && !/[^A-Za-z0-9{}\-\/_.]/.test(f);
// Siguiente número de una serie (el que tocará en la próxima factura de este año)
async function siguiente(D, s, anio) { const k = s.anual ? anio : 0; const r = (await D.query(`select n from fac_contadores where serie=$1 and anio=$2`, [s.id, k])).rows[0]; return Number((r || {}).n || 0) + 1; }

// ── Importes ──
const r2 = x => Math.round((Number(x) || 0) * 100) / 100;
function calcular(lineas) {
  const L = (lineas || []).map(l => { const uds = Number(String(l.uds ?? 1).replace(',', '.')), precio = Number(String(l.precio ?? 0).replace(',', '.')), dto = Math.min(100, Math.max(0, Number(l.dto) || 0)), iva = ivaLimpio(l.iva || { tipo: l.tipo, exencion: l.exencion });
    return { concepto: String(l.concepto || '').trim().slice(0, 200), detalle: String(l.detalle || '').trim().slice(0, 500), uds: isFinite(uds) ? uds : 0, precio: isFinite(precio) ? r2(precio * 10000) / 10000 : 0, dto, iva, base: r2(uds * precio * (1 - dto / 100)) }; })
    .filter(l => l.concepto && l.uds);
  const G = {}; L.forEach(l => { const k = l.iva.tipo ? 'T' + l.iva.tipo : 'E-' + l.iva.exencion; (G[k] = G[k] || { tipo: l.iva.tipo, exencion: l.iva.exencion || null, base: 0, cuota: 0 }).base = r2(G[k].base + l.base); });
  Object.values(G).forEach(g => { g.cuota = r2(g.base * g.tipo / 100); });
  const base = r2(L.reduce((t, l) => t + l.base, 0)), cuota = r2(Object.values(G).reduce((t, g) => t + g.cuota, 0));
  return { lineas: L, impuestos: Object.values(G).sort((a, b) => b.tipo - a.tipo), base, cuota, total: r2(base + cuota) };
}

// ── Emitir: número siguiente de su serie (bloqueando la serie) y factura cerrada ──
const isoMad = d => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d || new Date());
async function emitir(o) {
  const D = await db(), C = await config();
  const c = calcular(o.lineas);
  if (!c.lineas.length) throw new Error('La factura necesita al menos una línea');
  const hoy = isoMad(), fecha = /^\d{4}-\d{2}-\d{2}$/.test(o.fecha || '') ? o.fecha : hoy;
  if (fecha > hoy) throw new Error('La fecha no puede ser futura');
  const cli = { nombre: String((o.cliente || {}).nombre || '').trim().slice(0, 200), nif: String((o.cliente || {}).nif || '').trim().toUpperCase().slice(0, 30), direccion: String((o.cliente || {}).direccion || '').trim().slice(0, 300), cp: String((o.cliente || {}).cp || '').trim().slice(0, 10), ciudad: String((o.cliente || {}).ciudad || '').trim().slice(0, 80), provincia: String((o.cliente || {}).provincia || '').trim().slice(0, 80), pais: String((o.cliente || {}).pais || '').trim().slice(0, 60), email: String((o.cliente || {}).email || '').trim().slice(0, 120) };
  // En pruebas (en paralelo con Holded) la factura lleva el mismo número que el ticket de Holded y no gasta numeración propia
  const fijo = o.prueba ? String(o.codigoFijo || '').trim().slice(0, 60) : '';
  return D.tx(async q => {
    const s = (await q.query(`select * from fac_series where id=$1 for update`, [o.serie])).rows[0];
    if (!s) throw new Error('Elige una serie');
    if (!s.activa) throw new Error('Esa serie está desactivada');
    if (!o.prueba && s.tipo === 'completa' && (!cli.nombre || !cli.nif || !cli.direccion)) throw new Error('La factura completa necesita nombre, NIF y dirección de quien la recibe');
    if (!o.prueba && s.tipo === 'rectificativa' && !o.rectifica) throw new Error('Una rectificativa tiene que decir qué factura corrige');
    if (!o.prueba && s.tipo === 'simplificada' && c.total > 3000) throw new Error('Una factura simplificada no puede pasar de 3.000 €: usa una serie de facturas completas');
    // Factura completa que sustituye a una o varias simplificadas (el paciente pide después la factura con sus datos): mismo importe, tipo F3
    let sust = null;
    if (!o.prueba && Array.isArray(o.sustituye) && o.sustituye.length) {
      if (s.tipo !== 'completa') throw new Error('Para sustituir una simplificada, elige una serie de facturas completas');
      const X = (await q.query(`select id, codigo, fecha::text fecha, total::float total, tipo, estado, prueba, sustituida_por, actividad from fac_facturas where id = any($1) for update`, [o.sustituye.slice(0, 50)])).rows;
      if (X.length !== o.sustituye.length) throw new Error('No encuentro alguna de las facturas a sustituir');
      for (const x of X) { if (x.tipo !== 'simplificada' || x.estado !== 'emitida') throw new Error(`${x.codigo} no es una factura simplificada emitida`); if (x.prueba) throw new Error(`${x.codigo} es una copia de Holded: se cambia en Holded`); if (x.sustituida_por) throw new Error(`${x.codigo} ya está sustituida`); if ((x.actividad || 'principal') !== (s.actividad || 'principal')) throw new Error('La serie tiene que ser de la misma actividad'); }
      const tot = Math.round(X.reduce((t, x) => t + x.total, 0) * 100) / 100; if (Math.abs(tot - c.total) > 0.005) throw new Error(`El total tiene que ser el mismo que el de ${X.length > 1 ? 'las simplificadas' : 'la simplificada'} (${tot.toFixed(2).replace('.', ',')} €)`);
      sust = X.map(x => ({ id: x.id, codigo: x.codigo, fecha: x.fecha })); }
    const anio = +fecha.slice(0, 4);
    if (o.prueba) {
      const id = 'fac' + crypto.randomBytes(8).toString('hex'), n = -Math.floor(Math.random() * 1e12) - 1;
      await q.query(`insert into fac_facturas(id,serie,anio,numero,codigo,tipo,fecha,emisor,cliente,lineas,impuestos,base,cuota,total,paciente,fisio,cobro,holded,holded_num,pagos,nota,diseno,por,prueba)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,true)`,
        [id, s.id, anio, n, fijo || ('Borrador-' + id.slice(-6)), s.tipo, fecha, Object.assign({}, C.emisor), cli, JSON.stringify(c.lineas), JSON.stringify(c.impuestos), c.base, c.cuota, c.total, o.paciente || null, String(o.fisio || '').slice(0, 200) || null, o.cobro || null, o.holded || null, o.holdedNum || null, o.pagos ? JSON.stringify(o.pagos) : null, String(o.nota || '').slice(0, 2000) || null, s.diseno, String(o.por || '').slice(0, 60) || null]);
      // Registro VERI*FACTU (siempre en el entorno de pruebas): solo cuando ya tiene su número definitivo
      if (fijo) await registrarVF(q, 'pruebas', { id, emisor: C.emisor, codigo: fijo, fecha, tipo: s.tipo, total: c.total, cuota: c.cuota });
      return { id, codigo: fijo, total: c.total, prueba: true };
    }
    // Las fechas van en orden dentro de la serie: no puede ir antes que la última emitida
    const ult = (await q.query(`select max(fecha)::text f from fac_facturas where serie=$1 and anio=$2`, [s.id, anio])).rows[0].f;
    if (ult && fecha < ult) throw new Error(`La fecha es anterior a la última factura de la serie (${ult.split('-').reverse().join('/')})`);
    const n = (await q.query(`insert into fac_contadores(serie,anio,n) values($1,$2,1) on conflict (serie,anio) do update set n=fac_contadores.n+1 returning n`, [s.id, s.anual ? anio : 0])).rows[0].n;
    const codigo = codigoDe(s, anio, n), id = 'fac' + crypto.randomBytes(8).toString('hex');
    if ((await q.query(`select 1 from fac_facturas where codigo=$1`, [codigo])).rows.length) throw new Error(`Ya existe una factura con el número ${codigo}: revisa el formato o el número de la serie`);
    const A = actDe(C, s.actividad), emisor = Object.assign({}, C.emisor, A.id !== 'principal' ? { marca: A.nombre } : {}, ...['tel', 'email', 'web', 'direccion'].filter(k => A[k]).map(k => ({ [k]: A[k] })));
    await q.query(`insert into fac_facturas(id,serie,anio,numero,codigo,tipo,fecha,emisor,cliente,lineas,impuestos,base,cuota,total,paciente,fisio,cobro,holded,holded_num,pagos,nota,rectifica,motivo,diseno,por,actividad)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)`,
      [id, s.id, anio, n, codigo, s.tipo, fecha, emisor, cli, JSON.stringify(c.lineas), JSON.stringify(c.impuestos), c.base, c.cuota, c.total, o.paciente || null, String(o.fisio || '').slice(0, 200) || null, o.cobro || null, o.holded || null, o.holdedNum || null, o.pagos ? JSON.stringify(o.pagos) : null, String(o.nota || '').slice(0, 2000) || null, o.rectifica || null, o.motivo || null, s.diseno, String(o.por || '').slice(0, 60) || null, s.actividad || 'principal']);
    let rectSimpl = false; if (o.rectifica) rectSimpl = ((await q.query(`select tipo from fac_facturas where id=$1`, [o.rectifica])).rows[0] || {}).tipo === 'simplificada';
    if (sust) { await q.query(`update fac_facturas set sustituye=$2 where id=$1`, [id, JSON.stringify(sust)]); await q.query(`update fac_facturas set sustituida_por=$2 where id = any($1)`, [sust.map(x => x.id), codigo]); }
    await registrarVF(q, C.vf.entorno, { id, emisor, codigo, fecha, tipo: s.tipo, total: c.total, cuota: c.cuota, rectSimpl, f3: !!sust });
    return { id, codigo, total: c.total, actividad: s.actividad || 'principal' };
  });
}
// Copias de prueba que ya tienen su número de Holded pero se quedaron sin registro VERI*FACTU (y por eso sin QR): se registran ahora.
// No las «traídas» de Holded (son de antes y las hizo Holded) ni las que siguen en borrador.
async function vfPendientes(max = 200) { const D = await db();
  const L = (await D.query(`select id from fac_facturas where prueba and estado='emitida' and coalesce(vf->>'alta','')='' and coalesce(por,'')<>'Holded (traída)' and codigo not like 'Borrador-%' order by emitida limit $1`, [max])).rows;
  let n = 0; for (const x of L) await D.tx(async q => { const F = (await q.query(`select *, fecha::text fecha from fac_facturas where id=$1 for update`, [x.id])).rows[0];
    if (F && !(F.vf && F.vf.alta)) { await registrarVF(q, 'pruebas', { id: F.id, emisor: F.emisor, codigo: F.codigo, fecha: F.fecha, tipo: F.tipo, total: F.total, cuota: F.cuota }); n++; } }).catch(e => console.log('VF pendiente', x.id, e.message));
  return n; }
// Registro VERI*FACTU de una factura (alta o anulación) y su referencia en la factura
async function registrarVF(q, entorno, F, tipo = 'alta') {
  const r = await VF.registrar(q, entorno, F, tipo);
  await q.query(`update fac_facturas set vf = coalesce(vf,'{}'::jsonb) || $2::jsonb where id=$1`, [F.id, JSON.stringify(tipo === 'alta' ? { entorno, alta: r.id, huella: r.huella } : { anulacion: r.id })]);
  return r;
}
// Anular una factura (de momento, las de prueba cuyo ticket se borró en Holded): queda su registro de anulación
// Copias de prueba repetidas (dos copias del mismo cobro o del mismo ticket de Holded): se deja la primera y las demás se quitan
// (si no llegaron a registrarse en VeriFactu se borran; si sí, se anulan para que la cadena quede bien)
async function quitarRepetidas() { const D = await db();
  const L = (await D.query(`select id, vf, row_number() over (partition by k order by emitida, id) n from (select id, vf, emitida, coalesce(cobro, holded) k from fac_facturas where prueba and estado='emitida' and coalesce(cobro, holded) is not null) x`)).rows.filter(r => +r.n > 1);
  // Las traídas de Holded que repiten un ticket que ya tenía su copia del cobro (mismo ticket o mismo número de Holded)
  const T = (await D.query(`select a.id, a.vf from fac_facturas a where a.prueba and a.estado='emitida' and a.por='Holded (traída)' and exists (select 1 from fac_facturas b where b.id<>a.id and b.estado='emitida' and coalesce(b.por,'')<>'Holded (traída)' and ((a.holded is not null and b.holded=a.holded) or (coalesce(a.holded_num,'')<>'' and b.holded_num=a.holded_num)))`)).rows;
  L.push(...T.filter(x => !L.some(y => y.id === x.id)));
  // Y las que se hicieron al comparar si ya había otra del mismo paciente, día e importe
  const R = (await D.query(`select a.id, a.vf from fac_facturas a where a.prueba and a.estado='emitida' and a.por='Recuperada al comparar' and exists (select 1 from fac_facturas b where b.id<>a.id and b.estado='emitida' and b.paciente=a.paciente and b.fecha=a.fecha and b.total=a.total and coalesce(b.por,'')<>'Recuperada al comparar')`)).rows;
  let n = 0; for (const r of [...L, ...R.filter(x => !L.some(y => y.id === x.id))]) { if (r.vf && r.vf.alta) await anular(r.id, 'Copia repetida'); else await D.query(`delete from fac_facturas where id=$1 and prueba`, [r.id]); n++; }
  return n; }
async function anular(id, motivo) {
  const D = await db();
  return D.tx(async q => { const F = (await q.query(`select f.*, f.fecha::text fecha from fac_facturas f where id=$1 for update`, [id])).rows[0];
    if (!F || F.estado === 'anulada') return false;
    await q.query(`update fac_facturas set estado='anulada', motivo=coalesce($2, motivo) where id=$1`, [id, motivo || null]);
    if (F.vf && F.vf.alta) await registrarVF(q, F.vf.entorno || 'pruebas', { id, emisor: F.emisor, codigo: F.codigo, fecha: F.fecha, tipo: F.tipo, total: F.total, cuota: F.cuota }, 'anulacion');
    return true; });
}

// ── Rectificativa: devuelve toda la factura o una parte (o corrige importes). Va en una serie de rectificativas ──
// modo «total»: las mismas líneas en negativo. modo «parcial»: las líneas que se pasan (en negativo lo que se devuelve).
async function rectificar(o) {
  const D = await db(), F = await una(o.id);
  if (!F) throw new Error('No encuentro esa factura');
  if (F.prueba) throw new Error('Esta es una copia de prueba de un ticket de Holded: mientras estemos en pruebas, se rectifica en Holded');
  if (F.estado === 'anulada') throw new Error('Esa factura está anulada');
  if (F.tipo === 'rectificativa') throw new Error('No se puede rectificar una rectificativa: rectifica la factura original');
  const motivo = String(o.motivo || '').trim(); if (motivo.length < 3) throw new Error('Explica el motivo de la rectificación');
  const S = (await D.query(`select id from fac_series where activa and tipo='rectificativa' and actividad=$1 order by orden`, [F.actividad || 'principal'])).rows; const serie = o.serie || (S[0] || {}).id;
  if (!serie) throw new Error('Crea primero una serie de rectificativas (Facturación › Ajustes)');
  let lineas = o.modo === 'total' ? F.lineas.map(l => ({ concepto: l.concepto, detalle: l.detalle, uds: -l.uds, precio: l.precio, dto: l.dto, iva: l.iva })) : (o.lineas || []);
  const c = calcular(lineas); if (!c.lineas.length || !c.total) throw new Error('Pon lo que se corrige');
  // No se puede devolver más de lo que se facturó
  const ya = Number(((await D.query(`select coalesce(sum(total),0) t from fac_facturas where rectifica=$1 and estado='emitida'`, [F.id])).rows[0] || {}).t || 0);
  if (Number(F.total) + ya + c.total < -0.004) throw new Error(`Con esto se devolvería más de lo facturado (quedan ${(Math.round((Number(F.total) + ya) * 100) / 100).toFixed(2).replace('.', ',')} € por devolver)`);
  return emitir({ serie, fecha: o.fecha, cliente: F.cliente, lineas: c.lineas.map(l => ({ concepto: l.concepto, detalle: l.detalle, uds: l.uds, precio: l.precio, dto: l.dto, iva: l.iva })), rectifica: F.id, motivo, paciente: F.paciente, fisio: F.fisio, por: o.por, nota: o.nota });
}
// Desde un cobro del panel (lo que ya va a Holded): misma factura con nuestra numeración. Si ya existe, no repite.
async function desdeCobro(o) {
  const D = await db();
  if (o.cobro) { const ya = (await D.query(`select id, codigo from fac_facturas where cobro=$1 and estado='emitida' limit 1`, [o.cobro])).rows[0]; if (ya) return ya; }
  const C = await config();
  const completa = !!(o.cliente && o.cliente.nif && o.cliente.direccion && o.otro);
  const S = (await D.query(`select id, tipo from fac_series where activa and actividad='principal' order by auto desc, orden`)).rows;
  const s = completa ? (S.find(x => x.tipo === 'completa') || S[0]) : (S.find(x => x.tipo === 'simplificada') || S[0]);
  if (!s) throw new Error('No hay series');
  const lineas = o.lineas.map(l => Object.assign({ iva: ivaDe(C, l.ivaDe || l.concepto) }, l));
  // o.real: ya sin Holded (día del cambio): factura de verdad con nuestra numeración
  return emitir(Object.assign({}, o, { serie: s.id, lineas, prueba: !o.real, codigoFijo: o.real ? '' : (o.holdedNum || ''), pagos: Object.assign({ estado: 'pagada', fecha: isoMad() }, o.pagos || {}) }));
}

async function lista(f) {
  const D = await db(); const w = [], p = [];
  if (/^\d{4}-\d{2}-\d{2}$/.test(f.desde || '')) { p.push(f.desde); w.push(`fecha>=$${p.length}`); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(f.hasta || '')) { p.push(f.hasta); w.push(`fecha<=$${p.length}`); }
  if (f.serie) { p.push(f.serie); w.push(`serie=$${p.length}`); }
  if (f.actividad) { p.push(f.actividad); w.push(`actividad=$${p.length}`); }
  if (f.paciente) { p.push(f.paciente); w.push(`paciente=$${p.length}`); }
  // Como en Holded: «facturas» = completas y sus rectificativas; «tickets» = simplificadas y sus rectificativas
  const rTipo = `(select o.tipo from fac_facturas o where o.id=fac_facturas.rectifica)`;
  if (f.clase === 'facturas') w.push(`(tipo='completa' or (tipo='rectificativa' and not rect_simpl and coalesce(${rTipo},'completa')<>'simplificada'))`);
  if (f.clase === 'tickets') w.push(`(tipo='simplificada' or (tipo='rectificativa' and (rect_simpl or ${rTipo}='simplificada')))`);
  if (f.q) { p.push('%' + String(f.q).toLowerCase() + '%'); w.push(`(lower(codigo) like $${p.length} or lower(cliente->>'nombre') like $${p.length} or lower(coalesce(cliente->>'nif','')) like $${p.length} or lower(coalesce(holded_num,'')) like $${p.length})`); }
  const r = await D.query(`select id, serie, codigo, tipo, fecha::text, cliente, base, cuota, total, paciente, fisio, cobro, holded, holded_num, por, estado, emitida, impuestos, prueba, vf, pagos, sustituida_por, (select o.codigo from fac_facturas o where o.id=fac_facturas.rectifica) rectifica_codigo from fac_facturas ${w.length ? 'where ' + w.join(' and ') : ''} order by fecha desc, emitida desc limit ${Math.min(2000, Number(f.limite) || 500)}`, p);
  return r.rows.map(x => Object.assign(x, { base: Number(x.base), cuota: Number(x.cuota), total: Number(x.total) }));
}
async function una(id) { const D = await db(); const r = (await D.query(`select f.*, f.fecha::text fecha, s.nombre serie_nombre, s.color serie_color,
  (select codigo from fac_facturas o where o.id=f.rectifica) rectifica_codigo,
  case when f.rect_simpl then 'simplificada' else (select tipo from fac_facturas o where o.id=f.rectifica) end rectifica_tipo,
  (select json_build_object('estado',r.estado,'entorno',r.entorno,'csv',r.csv) from fac_registros r where r.factura=f.id and r.tipo='alta' order by r.id desc limit 1) vf_reg,
  (select coalesce(json_agg(json_build_object('id',x.id,'codigo',x.codigo,'total',x.total,'fecha',x.fecha::text,'motivo',x.motivo) order by x.emitida),'[]'::json) from fac_facturas x where x.rectifica=f.id and x.estado='emitida') rects
  from fac_facturas f join fac_series s on s.id=f.serie where f.id=$1`, [id])).rows[0];
  if (r) ['base', 'cuota', 'total'].forEach(k => { r[k] = Number(r[k]); }); return r || null; }

// Enlace firmado para ver una factura (el paciente desde su app, o compartirla)
const firma = (id) => crypto.createHmac('sha256', String(process.env.FISIO_PASSWORD || process.env.MIGRAR_KEY || 'f365')).update('fac:' + id).digest('base64url').slice(0, 22);

// ── Diseños: HTML listo para imprimir o guardar en PDF (A4) ──
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const eur = n => (Number(n) || 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
const fechaL = f => { const [a, m, d] = String(f).slice(0, 10).split('-'); return `${+d}/${+m}/${a}`; };
const num = n => (Number(n) || 0).toLocaleString('es-ES', { maximumFractionDigits: 4 });
function html(F, o) {
  o = o || {}; const E = F.emisor || {}, Cl = F.cliente || {}, L = F.lineas || [], I = F.impuestos || [], col = F.serie_color || o.color || '#c2552e', d = F.diseno || 'clasico';
  const titulo = F.tipo === 'rectificativa' && F.rectifica_tipo === 'simplificada' ? 'Factura simplificada rectificativa' : ({ simplificada: 'Factura simplificada', completa: 'Factura', rectificativa: 'Factura rectificativa' }[F.tipo] || 'Factura');
  const exentas = [...new Set(L.filter(l => !l.iva.tipo).map(l => EXENCIONES[l.iva.exencion] || EXENCIONES.E1))];
  const dirE = [E.direccion, [E.cp, E.ciudad].filter(Boolean).join(' '), E.provincia].filter(Boolean).join(' · ');
  const dirC = [Cl.direccion, [Cl.cp, Cl.ciudad].filter(Boolean).join(' '), Cl.provincia, Cl.pais && Cl.pais !== 'España' ? Cl.pais : ''].filter(Boolean).join(' · ');
  const conDto = L.some(l => l.dto), conIva = L.some(l => l.iva.tipo);
  const filas = L.map(l => `<tr><td><b>${esc(l.concepto)}</b>${l.detalle ? `<small>${esc(l.detalle)}</small>` : ''}</td><td class="n">${num(l.uds)}</td><td class="n">${eur(l.precio)}</td>${conDto ? `<td class="n">${l.dto ? num(l.dto) + ' %' : ''}</td>` : ''}<td class="n">${l.iva.tipo ? l.iva.tipo + ' %' : 'Exenta'}</td><td class="n">${eur(l.base)}</td></tr>`).join('');
  const imp = I.map(g => `<div class="tl"><span>${g.tipo ? `Base ${g.tipo} %` : 'Base exenta'}</span><b>${eur(g.base)}</b></div>${g.tipo ? `<div class="tl"><span>IVA ${g.tipo} %</span><b>${eur(g.cuota)}</b></div>` : ''}`).join('');
  const logo = o.logo ? `<img class="logo" src="${esc(o.logo)}" alt="">` : `<div class="marca">${esc(o.marca || E.razon || '')}</div>`;
  const emisorB = `<div class="emi">${logo}<div class="emi-t"><b>${esc(E.razon)}</b>${E.nif ? `<span>NIF ${esc(E.nif)}</span>` : ''}${dirE ? `<span>${esc(dirE)}</span>` : ''}${[E.tel, E.email, E.web].filter(Boolean).length ? `<span>${esc([E.tel, E.email, E.web].filter(Boolean).join(' · '))}</span>` : ''}</div></div>`;
  const clienteB = Cl.nombre ? `<div class="cli"><small>${F.tipo === 'simplificada' ? 'Cliente' : 'Facturar a'}</small><b>${esc(Cl.nombre)}</b>${Cl.nif ? `<span>NIF/DNI ${esc(Cl.nif)}</span>` : ''}${dirC ? `<span>${esc(dirC)}</span>` : ''}${Cl.email ? `<span>${esc(Cl.email)}</span>` : ''}</div>` : '';
  const datosB = `<div class="dat"><div><small>Nº</small><b>${esc(F.codigo)}</b></div><div><small>Fecha</small><b>${fechaL(F.fecha)}</b></div>${F.rectifica_codigo ? `<div><small>Rectifica a</small><b>${esc(F.rectifica_codigo)}</b></div>` : ''}</div>`;
  const pie = [F.fisio ? esc(F.fisio) : '', F.nota ? esc(F.nota).replace(/\n/g, '<br>') : '', F.motivo ? 'Motivo de la rectificación: ' + esc(F.motivo) : '', ...exentas.map(esc), F.tipo === 'completa' && o.pago ? esc(o.pago) : ''].filter(Boolean).map(x => `<p>${x}</p>`).join('');
  const anul = F.estado === 'anulada' ? '<div class="anul">ANULADA</div>' : F.prueba ? '<div class="anul" style="color:rgba(120,110,100,.10)">PRUEBA</div>' : '';
  const css = `@page{size:A4;margin:0}*{box-sizing:border-box;margin:0}body{font-family:Poppins,Helvetica,Arial,sans-serif;color:#1f1a17;font-size:12.5px;line-height:1.5;-webkit-print-color-adjust:exact;print-color-adjust:exact;background:#e9e5e1}
.hoja{width:210mm;min-height:297mm;margin:20px auto;background:#fff;padding:18mm 17mm 16mm;position:relative;display:flex;flex-direction:column;box-shadow:0 10px 40px rgba(0,0,0,.08)}
@media print{body{background:#fff}.hoja{margin:0;box-shadow:none}.bar{display:none}}
.bar{position:sticky;top:0;display:flex;justify-content:center;gap:10px;padding:12px;background:rgba(233,229,225,.92);backdrop-filter:blur(6px);z-index:2}.bar button{font:600 13px Poppins,sans-serif;border:0;border-radius:99px;padding:10px 20px;background:${col};color:#fff;cursor:pointer}
.logo{max-height:52px;max-width:200px;object-fit:contain;display:block}.marca{font-size:22px;font-weight:700;color:${col};letter-spacing:-.02em}
.emi{display:flex;flex-direction:column;gap:10px}.emi-t,.cli{display:flex;flex-direction:column}.emi-t span,.cli span{color:#6e625a;font-size:11.5px}.cli small,.dat small{display:block;font-size:10px;text-transform:uppercase;letter-spacing:.12em;color:#a0948b;font-weight:600}
.tit{font-size:24px;font-weight:700;letter-spacing:-.02em}
.dat{display:flex;gap:28px}.dat b{font-size:13px}
table{width:100%;border-collapse:collapse;margin-top:26px}th{font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:#a0948b;font-weight:600;text-align:left;padding:8px 6px}td{padding:11px 6px;border-top:1px solid #efe9e4;vertical-align:top}td small{display:block;color:#7d6f66;font-size:11px}.n{text-align:right;white-space:nowrap}th.n{text-align:right}
.tot{margin-left:auto;width:260px;margin-top:16px;display:flex;flex-direction:column;gap:4px}.tl{display:flex;justify-content:space-between;color:#6e625a}.tl b{color:#1f1a17;font-weight:500}.tt{display:flex;justify-content:space-between;align-items:baseline;margin-top:8px;padding-top:10px;border-top:2px solid #1f1a17;font-size:18px;font-weight:700}
.pie{margin-top:auto;padding-top:26px;display:flex;flex-direction:column;gap:6px;color:#7d6f66;font-size:10.5px}.pie .rgpd{font-size:9px;color:#a0948b;margin-top:6px}
.cab-d{display:flex;flex-direction:column;align-items:flex-end;gap:10px;text-align:right}.vfqr{display:flex;flex-direction:column;align-items:center;gap:2px;font-size:9.5px;color:#1f1a17}.vfqr svg{width:35mm;height:35mm;display:block}.vfqr b{font-size:11px;letter-spacing:.04em}.vfqr i{font-style:normal;font-size:8.5px;color:#a0948b}.vfqr small{font-size:9.5px;font-weight:600}
.anul{position:absolute;top:42%;left:0;right:0;text-align:center;font-size:90px;font-weight:800;color:rgba(200,30,30,.12);transform:rotate(-18deg)}
` + ({
    clasico: `.cab{display:flex;justify-content:space-between;gap:30px;padding-bottom:22px;border-bottom:3px solid ${col}}.cab2{display:flex;justify-content:space-between;gap:30px;margin-top:22px}.tit{color:${col}}th{border-bottom:1px solid #e6ded7}`,
    moderno: `.hoja{padding-left:30mm}.hoja::before{content:"";position:absolute;left:0;top:0;bottom:0;width:12mm;background:${col}}.cab{display:flex;justify-content:space-between;gap:30px}.cab2{display:flex;justify-content:space-between;gap:30px;margin-top:26px;padding:16px 18px;background:#f7f3ef;border-radius:14px}.tit{font-size:30px}thead tr{background:#1f1a17}th{color:#fff}th:first-child{border-radius:8px 0 0 8px}th:last-child{border-radius:0 8px 8px 0}.tt{border-top-color:${col};color:${col}}`,
    minimal: `body{font-family:Helvetica,Arial,sans-serif}.cab{display:flex;justify-content:space-between;gap:30px}.cab2{display:flex;justify-content:space-between;gap:30px;margin-top:30px}.marca{color:#1f1a17}.tit{font-weight:400;font-size:28px;letter-spacing:.02em;text-transform:uppercase}th{border-bottom:1px solid #1f1a17;color:#1f1a17}td{border-top:0;border-bottom:1px solid #eee}.tt{border-top:1px solid #1f1a17}`
  }[d] || '');
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(titulo)} ${esc(F.codigo)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800&display=swap" rel="stylesheet"><style>${css}</style></head><body>
${o.barra === false ? '' : `<div class="bar"><button onclick="print()">Descargar o imprimir</button></div>`}
<div class="hoja">${anul}<div class="cab">${emisorB}<div class="cab-d"><div class="tit">${esc(titulo)}</div>${o.qr ? `<div class="vfqr"><small>QR tributario:</small>${o.qr}<b>VERI*FACTU</b>${o.vfPruebas ? '<i>Entorno de pruebas de la AEAT</i>' : ''}</div>` : ''}</div></div>
<div class="cab2">${clienteB || '<div></div>'}${datosB}</div>
<table><thead><tr><th>Concepto</th><th class="n">Uds.</th><th class="n">Precio</th>${conDto ? '<th class="n">Dto.</th>' : ''}<th class="n">IVA</th><th class="n">Importe</th></tr></thead><tbody>${filas}</tbody></table>
<div class="tot">${imp}<div class="tt"><span>Total</span><span>${eur(F.total)}</span></div></div>
<div class="pie">${pie}${o.rgpd ? `<p class="rgpd">${esc(o.rgpd)}</p>` : ''}</div></div></body></html>`;
}
// Muestra de un diseño con datos de ejemplo (para elegir en Ajustes)
function muestra(diseno, tipo, C, o) {
  const c = calcular([{ concepto: 'Sesión de fisioterapia', uds: 1, precio: 65, iva: { tipo: 0, exencion: 'E1' } }, { concepto: 'Plus aplicación colágeno', uds: 1, precio: 15, iva: ivaDe(C, 'Plus aplicación colágeno') }]);
  return html({ emisor: C.emisor, cliente: { nombre: 'Laura Martínez Soler', nif: '12345678Z', direccion: tipo === 'simplificada' ? '' : 'C/ Ejemplo, 12', cp: tipo === 'simplificada' ? '' : '08030', ciudad: tipo === 'simplificada' ? '' : 'Barcelona' }, lineas: c.lineas, impuestos: c.impuestos, base: c.base, cuota: c.cuota, total: c.total, codigo: 'T2026-00001', fecha: isoMad(), tipo, diseno, fisio: 'Atendido por: tu fisio · Nº col. 00000' }, o);
}

// Tickets que se hicieron en borrador en Holded: cuando Holded les da número, la factura de prueba coge el mismo.
// getDoc(holdedId) → el ticket de Holded ({ document_number }) o null si ya no existe.
async function sincronizaHolded(getDoc, max = 25) {
  const D = await db();
  // Las primeras que se hicieron con numeración propia pasan a ser de prueba con el número de Holded
  await D.query(`update fac_facturas set prueba=true, codigo=coalesce(nullif(holded_num,''), 'Borrador-'||right(id,6)) where cobro is not null and not prueba`).catch(() => {});
  const L = (await D.query(`select id, holded from fac_facturas where prueba and holded is not null and coalesce(holded_num,'')='' and estado='emitida' order by emitida limit $1`, [max])).rows;
  await vfPendientes(80).catch(e => console.log('VF pendientes', e.message));
  let n = 0;
  const docs = await Promise.all(L.map(x => getDoc(x.holded).then(d => ({ d }), () => null))); // a la vez, que una a una tardaba
  for (const [i, x] of L.entries()) { if (!docs[i]) continue; const d = docs[i].d;
    if (d === null) { await anular(x.id, 'Ticket borrado en Holded').catch(() => {}); continue; }
    const num = String((d && d.document_number) || '').trim(); if (!num) continue;
    await D.tx(async q => { const F = (await q.query(`update fac_facturas set codigo=$2, holded_num=$2 where id=$1 and coalesce(holded_num,'')='' returning *, fecha::text fecha`, [x.id, num])).rows[0];
      if (F && !(F.vf && F.vf.alta)) await registrarVF(q, 'pruebas', { id: F.id, emisor: F.emisor, codigo: num, fecha: F.fecha, tipo: F.tipo, total: F.total, cuota: F.cuota }); }).catch(e => console.log('VF sincroniza', e.message)); n++; }
  return n;
}
// Registros VERI*FACTU de un entorno, del último al primero, y si la cadena está bien
async function registros(entorno, limite) { const D = await db(), C = await config(), nif = String(C.emisor.nif || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const L = (await D.query(`select r.id, r.factura, r.tipo, r.num_serie, r.fecha::text fecha, r.tipo_factura, r.importe, r.huella, r.fechahora, r.estado from fac_registros r where entorno=$1 order by id desc limit $2`, [entorno, Math.min(1000, limite || 200)])).rows;
  return { lista: L, cadena: nif ? await VF.comprobar(D, entorno, nif) : { n: 0, mal: [] } }; }
// Marcar una factura como pagada (o pendiente). No cambia nada fiscal: solo cómo está el cobro
async function pago(id, estado, modo, extra) { const D = await db(); const P = Object.assign({ estado: estado === 'pendiente' ? 'pendiente' : 'pagada', modo: String(modo || '').slice(0, 30), fecha: estado === 'pendiente' ? null : isoMad() }, extra || {});
  const r = await D.query(`update fac_facturas set pagos = coalesce(pagos,'{}'::jsonb) || $2::jsonb where id=$1 and tipo<>'rectificativa' returning id, cobro`, [id, JSON.stringify(P)]); if (!r.rows.length) throw new Error('No encuentro esa factura'); return Object.assign({}, P, { cobro: r.rows[0].cobro || null }); }
// ── Clientes guardados: los de las facturas hechas a mano (y los de las facturas ya hechas) para no escribirlos cada vez ──
const cliLimpio = c => { c = c || {}; const o = {}; ['nombre', 'nif', 'direccion', 'cp', 'ciudad', 'provincia', 'pais', 'email', 'tel'].forEach(k => { o[k] = String(c[k] || '').trim().slice(0, k === 'direccion' ? 300 : 200); }); o.nif = o.nif.toUpperCase(); return o; };
async function guardarCliente(actividad, c) { const D = await db(), x = cliLimpio(c); if (!x.nombre) return null;
  const ya = (await D.query(`select id from fac_clientes where actividad=$1 and (($2<>'' and upper(coalesce(nif,''))=$2) or ($2='' and lower(nombre)=lower($3))) limit 1`, [actividad, x.nif, x.nombre])).rows[0];
  if (ya) { await D.query(`update fac_clientes set nombre=$2, nif=$3, direccion=coalesce(nullif($4,''),direccion), cp=coalesce(nullif($5,''),cp), ciudad=coalesce(nullif($6,''),ciudad), provincia=coalesce(nullif($7,''),provincia), pais=coalesce(nullif($8,''),pais), email=coalesce(nullif($9,''),email), tel=coalesce(nullif($10,''),tel), usado=now() where id=$1`, [ya.id, x.nombre, x.nif, x.direccion, x.cp, x.ciudad, x.provincia, x.pais, x.email, x.tel]); return ya.id; }
  const id = 'cli' + crypto.randomBytes(6).toString('hex');
  await D.query(`insert into fac_clientes(id,actividad,nombre,nif,direccion,cp,ciudad,provincia,pais,email,tel) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [id, actividad, x.nombre, x.nif, x.direccion, x.cp, x.ciudad, x.provincia, x.pais, x.email, x.tel]); return id; }
async function buscarClientes(actividad, q) { const D = await db(), t = '%' + String(q || '').trim().toLowerCase() + '%';
  const a = (await D.query(`select id, nombre, nif, direccion, cp, ciudad, provincia, pais, email, tel from fac_clientes where actividad=$1 and (lower(nombre) like $2 or lower(coalesce(nif,'')) like $2) order by usado desc limit 12`, [actividad, t])).rows;
  // También quien ya tiene facturas (p. ej. pacientes de la clínica)
  const b = (await D.query(`select distinct on (upper(coalesce(cliente->>'nif','')), lower(cliente->>'nombre')) cliente from fac_facturas where actividad=$1 and coalesce(cliente->>'nombre','')<>'' and (lower(cliente->>'nombre') like $2 or lower(coalesce(cliente->>'nif','')) like $2) limit 20`, [actividad, t])).rows.map(r => r.cliente);
  const vistos = new Set(a.map(x => (x.nif || '').toUpperCase() || x.nombre.toLowerCase()));
  b.forEach(c => { const k = (c.nif || '').toUpperCase() || String(c.nombre).toLowerCase(); if (!vistos.has(k)) { vistos.add(k); a.push(c); } });
  return a.slice(0, 12); }
async function listaClientes(actividad) { const D = await db(); return (await D.query(`select * from fac_clientes where actividad=$1 order by lower(nombre) limit 2000`, [actividad])).rows; }
async function borrarCliente(id) { const D = await db(); await D.query(`delete from fac_clientes where id=$1`, [id]); }

// ── Presupuestos: como una factura pero sin valor fiscal; se pueden cambiar mientras estén pendientes y se convierten en factura ──
const prefijoPres = (C, act) => act === 'principal' ? 'P' : ((actDe(C, act).nombre || act).replace(/[^A-Za-z]/g, '').slice(0, 1).toUpperCase() || 'X') + 'P';
async function guardarPresupuesto(o) {
  const D = await db(), C = await config(), act = String(o.actividad || 'principal'), c = calcular(o.lineas);
  if (!c.lineas.length) throw new Error('El presupuesto necesita al menos una línea');
  const cli = cliLimpio(o.cliente); if (!cli.nombre) throw new Error('Pon a quién va el presupuesto');
  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(o.fecha || '') ? o.fecha : isoMad(), validez = /^\d{4}-\d{2}-\d{2}$/.test(o.validez || '') ? o.validez : null;
  if (o.id) { const ya = (await D.query(`select estado from fac_presupuestos where id=$1`, [o.id])).rows[0]; if (!ya) throw new Error('No encuentro ese presupuesto');
    if (ya.estado === 'facturado') throw new Error('Ya está facturado: no se puede cambiar');
    await D.query(`update fac_presupuestos set fecha=$2, validez=$3, cliente=$4, lineas=$5, impuestos=$6, base=$7, cuota=$8, total=$9, nota=$10, modificado=now() where id=$1`, [o.id, fecha, validez, cli, JSON.stringify(c.lineas), JSON.stringify(c.impuestos), c.base, c.cuota, c.total, String(o.nota || '').slice(0, 2000) || null]);
    await guardarCliente(act, cli).catch(() => {}); return { id: o.id }; }
  const anio = +fecha.slice(0, 4), id = 'pre' + crypto.randomBytes(8).toString('hex');
  const r = await D.tx(async q => { const n = (await q.query(`insert into fac_contadores(serie,anio,n) values($1,$2,1) on conflict (serie,anio) do update set n=fac_contadores.n+1 returning n`, ['pres:' + act, anio])).rows[0].n;
    const codigo = `${prefijoPres(C, act)}${anio}-${String(n).padStart(4, '0')}`;
    await q.query(`insert into fac_presupuestos(id,actividad,anio,numero,codigo,fecha,validez,cliente,lineas,impuestos,base,cuota,total,nota,por) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [id, act, anio, n, codigo, fecha, validez, cli, JSON.stringify(c.lineas), JSON.stringify(c.impuestos), c.base, c.cuota, c.total, String(o.nota || '').slice(0, 2000) || null, String(o.por || '').slice(0, 60) || null]); return { id, codigo }; });
  await guardarCliente(act, cli).catch(() => {}); return r; }
async function presupuestos(f) { const D = await db(); const p = [f.actividad || 'principal'], w = ['actividad=$1'];
  if (f.estado) { p.push(f.estado); w.push(`estado=$${p.length}`); }
  if (f.q) { p.push('%' + String(f.q).toLowerCase() + '%'); w.push(`(lower(codigo) like $${p.length} or lower(cliente->>'nombre') like $${p.length})`); }
  return (await D.query(`select id, codigo, fecha::text fecha, validez::text validez, cliente, total::float total, estado, factura, nota from fac_presupuestos where ${w.join(' and ')} order by fecha desc, creado desc limit 500`, p)).rows; }
async function presupuesto(id) { const D = await db(); const r = (await D.query(`select p.*, p.fecha::text fecha, p.validez::text validez, (select codigo from fac_facturas f where f.id=p.factura) factura_codigo from fac_presupuestos p where id=$1`, [id])).rows[0];
  if (r) ['base', 'cuota', 'total'].forEach(k => { r[k] = Number(r[k]); }); return r || null; }
async function estadoPresupuesto(id, estado, factura) { const D = await db(); if (!['pendiente', 'aceptado', 'rechazado', 'facturado'].includes(estado)) throw new Error('Estado no válido');
  await D.query(`update fac_presupuestos set estado=$2, factura=coalesce($3, factura), modificado=now() where id=$1 and (estado<>'facturado' or $2='facturado')`, [id, estado, factura || null]); }

// A quién se ha enviado (email): se ve en el detalle de la factura
async function marcaEnviada(id, x) { const D = await db(); await D.query(`update fac_facturas set enviada = coalesce(enviada,'[]'::jsonb) || jsonb_build_array(jsonb_build_object('a',$2::text,'por',$3::text,'t',now()))  where id=$1`, [id, String(x.a || '').slice(0, 120), String(x.por || '').slice(0, 40)]); }
// Con qué se factura: en paralelo con Holded (lo de ahora) o ya solo con el panel (desde el día del cambio)
async function modo() { const D = await db(); const v = ((await D.query(`select v from fac_config where k='modo'`)).rows[0] || {}).v || {}; return { propio: !!v.propio, desde: v.desde || null, por: v.por || '', envioAuto: !!v.envioAuto }; }
async function guardarModo(o) { const D = await db(), ya = await modo(); const v = Object.assign({}, ya, o.propio != null ? { propio: !!o.propio, desde: o.propio ? (ya.desde && ya.propio ? ya.desde : new Date().toISOString()) : null, por: String(o.por || '').slice(0, 40) } : {}, o.envioAuto != null ? { envioAuto: !!o.envioAuto } : {});
  await D.query(`insert into fac_config(k,v) values('modo',$1::jsonb) on conflict (k) do update set v=excluded.v, modificado=now()`, [JSON.stringify(v)]); return v; }
// Algo que se hace una sola vez (p. ej. crear una actividad de la empresa): si ya se hizo, no se repite aunque luego se borre
async function unaVez(nombre, fn) { const D = await db(); const r = await D.query(`insert into fac_config(k,v) values($1,'{}'::jsonb) on conflict do nothing returning k`, ['hecho:' + nombre]); if (r.rows.length) await fn(); }
module.exports = { quitarRepetidas, vfPendientes, modo, guardarModo, marcaEnviada, guardarCliente, buscarClientes, listaClientes, borrarCliente, guardarPresupuesto, presupuestos, presupuesto, estadoPresupuesto, unaVez, actDe, pago, rectificar, codigoDe, sincronizaHolded, anular, registros, VF, db, config, guardarConfig, series, guardarSerie, emitir, desdeCobro, lista, una, firma, html, muestra, calcular, EXENCIONES, TIPOS, DISENOS, TIPOS_IVA, isoMad };
