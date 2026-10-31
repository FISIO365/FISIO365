// Prueba de scripts/migrar.js con una «Airtable» falsa (datos inventados) y PGlite
(async () => {
  const db = await require('./pglite')();
  const datos = require('./datos-falsos')(), S = require('../../api/_schema.json');
  // Un adjunto falso en el primer paciente
  const PAC = 'tbldBVgClS4HY2mOJ'; datos[PAC][0].fields.DOCUS = [{ id: 'attAAAAAAAAAAAAAA', url: 'https://fake/a.pdf', filename: 'informe.pdf', size: 3, type: 'application/pdf' }];
  // La fórmula/lookup que devuelve Airtable (para ver que no se guardan)
  datos['tblTPlcuiSjQngkaD'].forEach(r => { r.fields.PacienteRec = r.fields['RELACIÓN - CITA'] || []; });
  const fakeFetch = async (u) => {
    if (u === 'https://fake/a.pdf') return new Response(Buffer.from('PDF'), { status: 200, headers: { 'content-type': 'application/pdf' } });
    if (/\/v0\/meta\/bases\//.test(u)) { const b = u.split('/bases/')[1].split('/')[0]; return new Response(JSON.stringify({ tables: S.tables.filter(t => (t.base || S.baseId) === b).map(t => ({ id: t.id, name: t.name, fields: global.__CAMPO_NUEVO__ && t.id === 'tblTCNp81M8vBFe7q' ? [...t.fields, { id: 'fldNUEVOxxxxxxxxx', name: 'NUEVO', type: 'singleLineText' }] : t.fields })) }), { status: 200 }); }
    const m = u.match(/\/v0\/[^/]+\/([^?]+)\?pageSize=100(?:&offset=(\d+))?/); const L = datos[m[1]] || []; const o = +(m[2] || 0);
    return new Response(JSON.stringify({ records: L.slice(o, o + 100).map(r => ({ id: r.id, createdTime: r.creado, fields: r.fields })), ...(o + 100 < L.length ? { offset: String(o + 100) } : {}) }), { status: 200 });
  };
  const { migrar } = require('../migrar.js');
  const t0 = Date.now();
  const sleep = global.setTimeout; global.setTimeout = (f) => sleep(f, 0); // sin esperas en la prueba
  const r1 = await migrar({ db, fetch: fakeFetch, token: 'x', log: () => {} });
  console.log('primera copia:', Object.values(r1).reduce((s, x) => s + x.registros, 0), 'registros,', Object.values(r1).reduce((s, x) => s + x.adjuntos, 0), 'adjuntos,', Date.now() - t0, 'ms');
  const c = (await db.query("select count(*)::int n from registros")).rows[0].n; console.log('en Postgres:', c);
  const p0 = (await db.query('select fields from registros where id = $1', [datos[PAC][0].id])).rows[0].fields; console.log('adjunto migrado:', JSON.stringify(p0.DOCUS).slice(0, 160));
  const ci = (await db.query("select fields from registros where tabla = 'tblTPlcuiSjQngkaD' limit 1")).rows[0].fields; console.log('lookup no guardado:', !('PacienteRec' in ci));
  // Segunda pasada: un cambio y un borrado en «Airtable»
  datos[PAC][1].fields['FULL NAME'] = 'Nombre Cambiado'; const borrado = datos[PAC].pop().id;
  const r2 = await migrar({ db, fetch: fakeFetch, token: 'x', log: () => {} });
  const n1 = (await db.query('select fields from registros where id = $1', [datos[PAC][1].id])).rows[0].fields['FULL NAME'];
  const b = (await db.query('select count(*)::int n from registros where id = $1', [borrado])).rows[0].n;
  console.log('segunda pasada: cambio copiado =', n1 === 'Nombre Cambiado', '· borrado quitado =', b === 0, '· tombstone =', (await db.query('select count(*)::int n from borrados where id = $1', [borrado])).rows[0].n === 1);
  const cnt = (await db.query("select * from contadores")).rows; console.log('contadores autonuméricos:', cnt.length);
  // Por trozos (como en Vercel): cada llamada hace una página y sigue donde lo dejó
  { const { migrarPaso } = require('../../api/_migrar.js'); datos[PAC][2].fields['FULL NAME'] = 'Por Trozos'; let desde = null, n = 0, r;
    do { r = await migrarPaso({ db, fetch: fakeFetch, token: 'x', desde, hasta: Date.now() + 1 }); desde = r.sigue; n++; } while (!r.hecho && n < 2000);
    const pt = (await db.query('select fields from registros where id = $1', [datos[PAC][2].id])).rows[0].fields['FULL NAME'];
    const c2 = (await db.query('select count(*)::int n from registros')).rows[0].n, esperado = Object.values(datos).reduce((s, L) => s + L.length, 0);
    console.log('por trozos:', n, 'llamadas · cambio copiado =', pt === 'Por Trozos', '· registros =', c2, 'de', esperado); }
  global.__CAMPO_NUEVO__ = true; let paro = '';
  try { await migrar({ db, fetch: fakeFetch, token: 'x', log: () => {} }); } catch (e) { paro = e.message; }
  console.log('campo nuevo en Airtable → se para:', /NUEVO/.test(paro));
  process.exit(0);
})().catch(e => { console.error('FALLO', e.message, String(e.stack).split('\n').slice(1, 4).join(' | ')); process.exit(1); });
