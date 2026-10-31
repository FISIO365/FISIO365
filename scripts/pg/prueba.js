// Prueba de api/_pg.js con PGlite y datos falsos:  NODE_PATH=… node scripts/pg/prueba.js [formulas.json]
const t0 = Date.now();
(async () => {
  const db = await require('./pglite')();
  global.__PG_TEST__ = db;
  const PG = require('../../api/_pg.js');
  for (const s of PG.SQL_INIT.split(';').map(x => x.trim()).filter(Boolean)) await db.query(s);
  const datos = require('./datos-falsos')();
  let n = 0;
  for (const [tb, L] of Object.entries(datos)) for (let i = 0; i < L.length; i += 500) {
    const lote = L.slice(i, i + 500); const vals = [], ps = [];
    lote.forEach((r, j) => { ps.push(`($${j * 4 + 1},$${j * 4 + 2},$${j * 4 + 3},$${j * 4 + 4},$${j * 4 + 4})`); vals.push(tb, r.id, JSON.stringify(r.fields), r.creado); });
    await db.query('insert into registros (tabla,id,fields,creado,modificado) values ' + ps.join(','), vals); n += lote.length;
  }
  console.log('cargados', n, 'registros en', Date.now() - t0, 'ms');
  const B = 'https://api.airtable.com/v0/appsrGnHpFt8sVD5A/';
  const j = async (u, o) => { const r = await fetch(u, o); return { st: r.status, d: await r.json() }; };
  const CITAS = 'tblTPlcuiSjQngkaD', PAC = 'tbldBVgClS4HY2mOJ';
  const hoy = new Date().toISOString().slice(0, 10);
  // 1) Día de agenda (en frío y en caliente)
  for (const k of ['frío', 'caliente', 'caliente']) {
    const a = Date.now();
    const r = await j(B + CITAS + '?filterByFormula=' + encodeURIComponent(`DATETIME_FORMAT({FECHA},'YYYY-MM-DD')='${hoy}'`) + '&sort[0][field]=HORA&pageSize=100');
    console.log('agenda del día', k, r.st, (r.d.records || []).length, 'citas', Date.now() - a, 'ms', r.d.error ? JSON.stringify(r.d.error) : '');
  }
  // 2) Lookup y RECORD_ID
  const p0 = (await j(B + PAC + '?pageSize=1')).d.records[0];
  let a = Date.now();
  let r = await j(B + CITAS + '?filterByFormula=' + encodeURIComponent(`FIND('${p0.id}',ARRAYJOIN({PacienteRec}))`) + '&fields[]=FECHA&fields[]=PacienteRec&fields[]=PacienteId');
  console.log('citas de un paciente (lookup)', r.st, r.d.records.length, Date.now() - a, 'ms', JSON.stringify(r.d.records[0] || r.d.error).slice(0, 160));
  // 3) Crear / editar / borrar con enlaces
  r = await j(B + CITAS, { method: 'POST', body: JSON.stringify({ records: [{ fields: { FECHA: hoy, HORA: '10:00', ESTADO: 'PENDIENTE ', 'RELACIÓN - CITA': [p0.id] } }], typecast: true }) });
  const nueva = r.d.records && r.d.records[0]; console.log('crear', r.st, JSON.stringify(nueva || r.d).slice(0, 220));
  r = await j(B + PAC + '/' + p0.id); console.log('inverso en el paciente', (r.d.fields['CITAS 2'] || []).includes(nueva.id));
  r = await j(B + CITAS + '/' + nueva.id, { method: 'PATCH', body: JSON.stringify({ fields: { ESTADO: 'REALIZADA', NOTAS: 'ok' } }) }); console.log('editar', r.st, r.d.fields && r.d.fields.ESTADO);
  r = await j(B + CITAS + '?records[]=' + nueva.id, { method: 'DELETE' }); console.log('borrar', r.st, JSON.stringify(r.d));
  r = await j(B + PAC + '/' + p0.id); console.log('inverso quitado', !(r.d.fields['CITAS 2'] || []).includes(nueva.id));
  r = await j(B + CITAS + '/' + nueva.id); console.log('ya no existe', r.st);
  // 4) Errores con forma de Airtable
  r = await j(B + CITAS + '?filterByFormula=' + encodeURIComponent('AND({NO EXISTE}=1)')); console.log('campo desconocido', r.st, r.d.error && r.d.error.type);
  r = await j(B + 'tblF4as0orW1b6KIw?pageSize=1'); console.log('tabla que no existe', r.st, r.d.error && r.d.error.type);
  // 5) Adjunto
  const up = await j('https://content.airtable.com/v0/appsrGnHpFt8sVD5A/' + p0.id + '/fldTMnwMj4c1C2835/uploadAttachment', { method: 'POST', body: JSON.stringify({ contentType: 'text/plain', file: Buffer.from('hola').toString('base64'), filename: 'hola.txt' }) });
  console.log('subir adjunto', up.st, JSON.stringify(up.d).slice(0, 200));
  // 6) Todas las fórmulas sacadas del código
  const fs = require('fs'), path = process.argv[2] || '/tmp/t/formulas.json';
  if (fs.existsSync(path)) {
    const FX = require('../../api/_formula.js'); const L = JSON.parse(fs.readFileSync(path, 'utf8'));
    let okN = 0, sinTabla = 0; const malos = [];
    for (const o of L) {
      let ast; try { ast = FX.parse(o.s); } catch (e) { malos.push('PARSE ' + o.f + ':' + o.line + ' ' + e.message); continue; }
      const cs = [...FX.campos(ast)];
      const tablas = Object.values(PG.T).filter(t => cs.every(c => PG.campo(t.id, c)));
      if (!tablas.length) { sinTabla++; malos.push('SIN TABLA ' + o.f + ':' + o.line + ' ' + cs.filter(c => !Object.values(PG.T).some(t => PG.campo(t.id, c))).join('|')); continue; }
      const t = tablas.sort((a, b) => (a.id === CITAS ? -1 : 0))[0];
      const a = Date.now(); const r = await j(B + t.id + '?pageSize=5&filterByFormula=' + encodeURIComponent(o.s));
      if (r.st === 200) okN++; else malos.push('ERROR ' + o.f + ':' + o.line + ' ' + JSON.stringify(r.d.error) + ' :: ' + o.s.slice(0, 120));
      if (Date.now() - a > 400) malos.push('LENTO ' + (Date.now() - a) + 'ms ' + o.f + ':' + o.line);
    }
    console.log(`fórmulas del código: ${okN}/${L.length} sin error (${sinTabla} con campos que no están en ninguna tabla)`);
    malos.forEach(m => console.log('  ', m));
  }
  console.log('total', Date.now() - t0, 'ms');
})().catch(e => { console.error('FALLO', String(e && e.message).slice(0, 300), String(e && e.stack).split('\n').slice(1, 4).join(' | ')); process.exit(1); });
