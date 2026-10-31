// Prueba de humo: el código real de la API (schedule.js, chat.js…) contra Postgres (PGlite) con datos falsos.
// NODE_PATH=… FISIO_PASSWORD=x VAPID_PUBLIC_KEY=… VAPID_PRIVATE_KEY=… node scripts/pg/humo.js
(async () => {
  const db = await require('./pglite')(); global.__PG_TEST__ = db;
  const PG = require('../../api/_pg.js');
  for (const s of PG.SQL_INIT.split(';').map(x => x.trim()).filter(Boolean)) await db.query(s);
  const datos = require('./datos-falsos')();
  // Fisios con datos con sentido
  const FIS = 'tbl2mLUrnaKCFTs6g';
  datos[FIS] = datos[FIS].slice(0, 4).map((r, i) => ({ ...r, fields: { Name: ['Sara Arcusa', 'Jonathan Aguilar', 'Juan Quiñones', 'Ramiro López'][i], Role: i === 3 ? 'fisio' : 'fisio', PIN: '1234', 'DIRECCIÓN': i === 3 } }));
  for (const [tb, L] of Object.entries(datos)) for (let i = 0; i < L.length; i += 500) {
    const lote = L.slice(i, i + 500), vals = [], ps = [];
    lote.forEach((r, j) => { ps.push(`($${j * 4 + 1},$${j * 4 + 2},$${j * 4 + 3},$${j * 4 + 4},$${j * 4 + 4})`); vals.push(tb, r.id, JSON.stringify(r.fields), r.creado); });
    await db.query('insert into registros (tabla,id,fields,creado,modificado) values ' + ps.join(','), vals);
  }
  const llamar = (mod, q, metodo = 'GET') => new Promise(ok => {
    const t0 = Date.now(); let st = 200, h = {};
    const res = { setHeader(k, v) { h[k] = v; }, getHeader: k => h[k], status(c) { st = c; return res; }, json(j) { ok({ st, j, ms: Date.now() - t0 }); }, send(b) { ok({ st, j: typeof b === 'string' ? b.slice(0, 80) : '[bin]', ms: Date.now() - t0 }); }, end(b) { ok({ st, j: h.Location || '', ms: Date.now() - t0 }); }, redirect(c, u) { ok({ st: c, j: u, ms: Date.now() - t0 }); }, on() {} };
    const req = { method: metodo, query: metodo === 'GET' ? q : { action: q.action }, body: metodo === 'POST' ? q : undefined, headers: { host: 'localhost' }, url: '/api/x' };
    Promise.resolve(mod(req, res)).catch(e => ok({ st: 'EXC', j: e.message, ms: Date.now() - t0 }));
  });
  const S = require('../../api/schedule.js');
  const pwd = process.env.FISIO_PASSWORD, hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date());
  const pac = datos['tbldBVgClS4HY2mOJ'][0].id, fis = datos[FIS][0].id;
  const pruebas = [
    ['clinica-pub', S, { action: 'clinica-pub' }],
    ['agenda del día', S, { action: 'seg-agenda-dia', pwd, fecha: hoy }],
    ['agenda (otra vez)', S, { action: 'seg-agenda-dia', pwd, fecha: hoy }],
    ['nº de sesión', S, { action: 'seg-agenda-num', pwd, desde: hoy, hasta: hoy, pago: '1' }],
    ['semana', S, { action: 'seg-agenda-dia', pwd, desde: hoy, hasta: hoy }],
    ['ficha', S, { action: 'seg-ficha', pwd, id: pac }],
    ['tipos de cita', S, { action: 'seg-agenda-tipos', pwd }],
    ['pendientes / tareas', S, { action: 'seg-tareas', pwd, fisioId: fis }],
    ['dar cita', S, { action: 'seg-agenda-dar', pwd, pacienteId: pac, fecha: hoy, hora: '20:00', fisio: 'Sara', yo: 'Sara Arcusa', fisioId: fis }, 'POST'],
    ['agenda tras dar cita', S, { action: 'seg-agenda-dia', pwd, fecha: hoy }],
    ['rendimiento', S, { action: 'rendimiento', pwd, desde: hoy.slice(0, 8) + '01', hasta: hoy }]
  ];
  for (const [n, m, q, met] of pruebas) {
    const r = await llamar(m, q, met);
    const j = r.j && typeof r.j === 'object' ? JSON.stringify(r.j) : String(r.j);
    console.log(`${r.st === 200 && !(r.j && r.j.ok === false) ? 'OK ' : '!! '}${n.padEnd(22)} ${String(r.st).padEnd(4)} ${String(r.ms).padStart(5)} ms  ${j.slice(0, 150)}`);
    if (n === 'agenda tras dar cita') console.log('    la cita nueva sale:', /20:00/.test(j));
  }
  process.exit(0);
})().catch(e => { console.error('FALLO', e.message, String(e.stack).split('\n').slice(1, 4).join(' | ')); process.exit(1); });
