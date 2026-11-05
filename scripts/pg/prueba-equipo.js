// Prueba de «Mi equipo» (accesos de club, consentimiento del jugador, parte y lo que ve el entrenador) contra PGlite.
// NODE_PATH=… FISIO_PASSWORD=x SIN_ENVIOS=1 VAPID_PUBLIC_KEY=… VAPID_PRIVATE_KEY=… node scripts/pg/prueba-equipo.js
(async () => {
  const db = await require('./pglite')(); global.__PG_TEST__ = db;
  const PG = require('../../api/_pg.js');
  for (const s of PG.SQL_INIT.split(';').map(x => x.trim()).filter(Boolean)) await db.query(s);
  const ins = (tb, id, f) => db.query('insert into registros (tabla,id,fields,creado,modificado) values ($1,$2,$3,now(),now())', [tb, id, JSON.stringify(f)]);
  const PAC = 'recPacPrueba00001', PAC2 = 'recPacPrueba00002', CLUB = 'recClubPrueba0001';
  await ins('tbldBVgClS4HY2mOJ', PAC, { 'FULL NAME': 'Marc Puig Soler', EMAIL: 'marc@ejemplo.com', PIN: '1111' });
  await ins('tbldBVgClS4HY2mOJ', PAC2, { 'FULL NAME': 'Laura Vidal', EMAIL: 'jordi@club.com', PIN: '2222' });
  await ins('tblClubsDeporti01', CLUB, { NOMBRE: 'CF Sant Andreu Prueba', DEPORTE: 'Fútbol', ESTADO: 'COLABORANDO' });
  const llamar = (mod, q, metodo = 'GET') => new Promise(ok => {
    let st = 200, h = {};
    const res = { setHeader(k, v) { h[k] = v; }, getHeader: k => h[k], status(c) { st = c; return res; }, json(j) { ok({ st, j }); }, send(b) { ok({ st, j: b }); }, end() { ok({ st, j: '' }); }, on() {} };
    const req = { method: metodo, query: metodo === 'GET' ? q : { action: q.action }, body: metodo === 'POST' ? q : undefined, headers: { host: 'localhost', 'x-forwarded-for': '1.2.3.4', 'user-agent': 'prueba' }, url: '/api/x' };
    Promise.resolve(mod(req, res)).catch(e => ok({ st: 'EXC', j: e.message }));
  });
  const S = require('../../api/schedule.js'), L = require('../../api/login.js'), pwd = process.env.FISIO_PASSWORD;
  let fallos = 0; const ver = (n, c, x) => { console.log(`${c ? 'OK ' : '!! '}${n}${c ? '' : '  ' + JSON.stringify(x).slice(0, 300)}`); if (!c) fallos++; };

  let r = await llamar(S, { action: 'seg-eq-acceso', pwd, club: CLUB, quien: 'Ramiro', campos: { nombre: 'Jordi Mas', email: 'Jordi@club.com', rol: 'Entrenador' } }, 'POST');
  ver('dar acceso al entrenador', r.j.ok && /^\d{4}$/.test(r.j.acceso.pin), r.j); const acc = r.j.acceso;
  r = await llamar(S, { action: 'seg-eq-acceso', pwd, club: CLUB, campos: { nombre: 'Jordi', email: 'jordi@club.com' } }, 'POST');
  ver('no se duplica el acceso', !r.j.ok, r.j);
  r = await llamar(S, { action: 'seg-cap', pwd });
  ver('Captación cuenta los accesos del club', r.j.ok && (r.j.clubs.find(c => c.id === CLUB) || {}).eq === 1, (r.j.clubs || []).find(c => c.id === CLUB) || r.j);
  r = await llamar(L, { email: 'jordi@club.com', pin: '0000' });
  ver('clave mala', !r.j.ok, r.j);
  r = await llamar(L, { email: 'otro@club.com', pin: acc.pin });
  ver('email que no existe', !r.j.ok, r.j);
  // jordi@club.com también es el email de una paciente (Laura, p. ej. su hija): con SU PIN entra como paciente y NO ve «Mi equipo»
  r = await llamar(L, { email: 'jordi@club.com', pin: '2222' });
  ver('mismo email que el entrenador: con su PIN no ve Mi equipo', r.j.ok && !r.j.patient.soloEquipo && r.j.patient.equipo.length === 0, r.j);
  r = await llamar(S, { action: 'eq-mio', patientId: PAC2 });
  ver('eq-mio no da accesos de entrenador', r.j.ok && !('equipo' in r.j), r.j);
  r = await llamar(L, { email: 'jordi@club.com', pin: acc.pin });
  ver('entrenador entra con su clave (solo Mi equipo)', r.j.ok && r.j.patient.soloEquipo && r.j.patient.equipo[0].clubNombre === 'CF Sant Andreu Prueba', r.j);
  const E = r.j.patient.equipo, qa = { a: E.map(e => e.id).join(','), t: E.map(e => e.tok).join(',') };
  r = await llamar(S, { action: 'eq-equipo', a: qa.a, t: 'x'.repeat(16) });
  ver('firma falsa', r.st === 401, r);
  r = await llamar(S, { action: 'seg-eq-vincular', pwd, pac: PAC, club: CLUB, equipo: 'Juvenil A', quien: 'Sara' }, 'POST');
  ver('vincular jugador', r.j.ok && r.j.parte.consentimiento === 'Pendiente', r.j); const parte = r.j.parte;
  r = await llamar(S, { action: 'seg-eq-vincular', pwd, pac: PAC, club: CLUB }, 'POST');
  ver('no se vincula dos veces', !r.j.ok, r.j);
  r = await llamar(S, { action: 'seg-eq-parte', pwd, id: parte.id, quien: 'Sara Arcusa', campos: { semaforo: 'rojo', fase: 'Tratamiento', diagnostico: 'Esguince de tobillo derecho, grado 2', vuelta: '2026-12-01', puede: 'Bici estática', noPuede: 'Correr, saltar', pautas: 'Empezar con carrera continua suave la semana 3', nota: 'Primera sesión, mucha inflamación' } }, 'POST');
  ver('guardar parte (sin compartir aún)', r.j.ok && !r.j.compartido && r.j.parte.evolucion.length === 1, r.j);
  r = await llamar(S, { action: 'eq-equipo', ...qa });
  ver('el entrenador aún no ve nada', r.j.ok && r.j.clubs[0].jugadores.length === 0, r.j);
  r = await llamar(S, { action: 'eq-mio', patientId: PAC });
  ver('el jugador ve la petición de su club', r.j.ok && r.j.partes.length === 1 && r.j.partes[0].consentimiento === 'Pendiente' && /CF Sant Andreu Prueba/.test(r.j.partes[0].texto), r.j);
  r = await llamar(S, { action: 'eq-consent', patientId: PAC2, id: parte.id, acepta: true }, 'POST');
  ver('otro paciente no puede aceptarlo', r.st === 403, r);
  r = await llamar(S, { action: 'eq-consent', patientId: PAC, id: parte.id, acepta: true, quien: 'tutor', tutor: '' }, 'POST');
  ver('tutor sin nombre', !r.j.ok, r.j);
  r = await llamar(S, { action: 'eq-consent', patientId: PAC, id: parte.id, acepta: true, quien: 'yo' }, 'POST');
  ver('el jugador acepta', r.j.ok && r.j.parte.consentimiento === 'Aceptado', r.j);
  r = await llamar(S, { action: 'eq-equipo', ...qa });
  const j0 = r.j.ok && r.j.clubs[0].jugadores[0];
  ver('el entrenador ve el parte', j0 && j0.semaforo === 'rojo' && j0.diagnostico.includes('Esguince') && j0.evolucion.length === 1, r.j);
  ver('el entrenador no ve datos del consentimiento ni ids', j0 && !('pacienteId' in j0) && !('consQuien' in j0) && !JSON.stringify(r.j).includes(PAC), j0);
  r = await llamar(S, { action: 'seg-eq-parte', pwd, id: parte.id, quien: 'Sara Arcusa', campos: { semaforo: 'amarillo', fase: 'Readaptación', nota: 'Ya corre sin dolor' } }, 'POST');
  ver('actualizar parte (compartido)', r.j.ok && r.j.compartido && r.j.parte.evolucion.length === 2, r.j);
  r = await llamar(S, { action: 'seg-eq-club', pwd, club: CLUB });
  ver('panel: accesos y jugadores del club', r.j.ok && r.j.accesos.length === 1 && r.j.jugadores.length === 1, r.j);
  r = await llamar(S, { action: 'seg-eq-ficha', pwd, id: PAC });
  ver('panel: pestaña Club de la ficha (todos los clubs, primero los activos)', r.j.ok && r.j.partes.length === 1 && r.j.clubs[0].id === CLUB && r.j.clubs[0].activo, r.j.clubs && r.j.clubs.slice(0, 2));
  r = await llamar(S, { action: 'eq-consent', patientId: PAC, id: parte.id, acepta: false }, 'POST');
  ver('el jugador deja de compartir', r.j.ok && r.j.parte.consentimiento === 'Retirado', r.j);
  r = await llamar(S, { action: 'eq-equipo', ...qa });
  ver('el entrenador ya no lo ve', r.j.ok && r.j.clubs[0].jugadores.length === 0, r.j);
  r = await llamar(S, { action: 'seg-eq-acceso', pwd, club: CLUB, id: acc.id, campos: { nombre: 'Jordi Mas', email: 'jordi@club.com', nuevaClave: true } }, 'POST');
  ver('cambiar la clave', r.j.ok && r.j.acceso.pin !== acc.pin, r.j);
  r = await llamar(S, { action: 'eq-equipo', ...qa });
  ver('con la clave cambiada, la sesión vieja ya no vale', !r.j.ok && r.j.inactivo, r.j);
  r = await llamar(S, { action: 'seg-eq-acceso', pwd, club: CLUB, id: acc.id, campos: { nombre: 'Jordi Mas', email: 'jordi@club.com', activo: false } }, 'POST');
  ver('quitar el acceso', r.j.ok && !r.j.acceso.activo, r.j);
  r = await llamar(S, { action: 'eq-equipo', ...qa });
  ver('acceso quitado: ya no entra', !r.j.ok && r.j.inactivo, r.j);
  r = await llamar(L, { email: 'jordi@club.com', pin: acc.pin });
  ver('acceso quitado: login', !r.j.ok, r.j);
  // Menor de 14 por la fecha de nacimiento: tiene que aceptarlo el tutor
  await ins('tbldBVgClS4HY2mOJ', 'recPacPrueba00003', { 'FULL NAME': 'Nil Petit', EMAIL: 'nil@ejemplo.com', PIN: '3333', CUMPLE: '2016-03-01' });
  r = await llamar(S, { action: 'seg-eq-vincular', pwd, pac: 'recPacPrueba00003', club: CLUB }, 'POST');
  ver('menor por fecha de nacimiento', r.j.ok && r.j.parte.menor, r.j);
  const pm = r.j.parte && r.j.parte.id;
  r = await llamar(S, { action: 'eq-consent', patientId: 'recPacPrueba00003', id: pm, acepta: true, quien: 'yo' }, 'POST');
  ver('menor: no lo puede aceptar él', !r.j.ok, r.j);
  r = await llamar(S, { action: 'eq-consent', patientId: 'recPacPrueba00003', id: pm, acepta: true, quien: 'tutor', tutor: 'Anna Petit', lang: 'cat' }, 'POST');
  ver('menor: lo acepta su tutora', r.j.ok && r.j.parte.consentimiento === 'Aceptado' && /Anna Petit/.test(r.j.parte.consQuien), r.j);
  // Equipos: el entrenador del Juvenil A solo ve el Juvenil A; el coordinador (sin equipos) ve todo el club
  const CLUB2 = 'recClubPrueba0002';
  await ins('tblClubsDeporti01', CLUB2, { NOMBRE: 'Club Dos', DEPORTE: 'Básquet' });
  await ins('tbldBVgClS4HY2mOJ', 'recPacPrueba00004', { 'FULL NAME': 'Uno Juvenil', PIN: '4444', EMAIL: 'uno@e.com' });
  await ins('tbldBVgClS4HY2mOJ', 'recPacPrueba00005', { 'FULL NAME': 'Dos Infantil', PIN: '5555', EMAIL: 'dos@e.com' });
  const ent = (await llamar(S, { action: 'seg-eq-acceso', pwd, club: CLUB2, campos: { nombre: 'Ent A', email: 'enta@c.com', equipos: ['Juvenil A'] } }, 'POST')).j.acceso;
  const coo = (await llamar(S, { action: 'seg-eq-acceso', pwd, club: CLUB2, campos: { nombre: 'Coord', email: 'coord@c.com' } }, 'POST')).j.acceso;
  ver('acceso con equipos', ent.equipos.length === 1 && coo.equipos.length === 0, [ent, coo]);
  for (const [pid, eqn] of [['recPacPrueba00004', 'Juvenil A'], ['recPacPrueba00005', 'Infantil B']]) {
    const pr = (await llamar(S, { action: 'seg-eq-vincular', pwd, pac: pid, club: CLUB2, equipo: eqn }, 'POST')).j.parte;
    await llamar(S, { action: 'eq-consent', patientId: pid, id: pr.id, acepta: true, quien: 'yo' }, 'POST');
    await llamar(S, { action: 'seg-eq-parte', pwd, id: pr.id, quien: 'Sara', campos: { semaforo: 'verde', nota: 'ok' } }, 'POST');
  }
  const verEq = async a => { const l = (await llamar(L, { email: a.email, pin: a.pin })).j.patient.equipo; return (await llamar(S, { action: 'eq-equipo', a: l.map(x => x.id).join(','), t: l.map(x => x.tok).join(',') })).j; };
  const hoyR = new Date(); for (let i = 0; i < 4; i++) { const d = new Date(hoyR - i * 864e5).toISOString().slice(0, 10); await ins('tblIXYE5ToRNY7MN4', 'recTarPrueba0000' + i, { PacienteId: 'recPacPrueba00004', Fecha: d }); }
  await ins('tblIXYE5ToRNY7MN4', 'recTarPrueba00009', { PacienteId: 'recPacPrueba00099', Fecha: hoyR.toISOString().slice(0, 10) });
  await ins('tblvgE0a4gsrj4Vhp', 'recPlanPrueba0001', { PacienteID: 'recPacPrueba00004', FechaAsignacion: new Date().toISOString(), Ejercicios: JSON.stringify([{ nombre: 'Sentadilla', series: 3, reps: 10 }]) });
  let ve = await verEq(ent);
  ver('el entrenador ve la racha de su jugador', ve.ok && ve.clubs[0].jugadores[0].racha.length === 4, ve.clubs && ve.clubs[0].jugadores); ver('entrenador del Juvenil A: solo su equipo', ve.ok && ve.clubs[0].jugadores.length === 1 && ve.clubs[0].jugadores[0].equipo === 'Juvenil A', ve);
  ver('sin activar, no ve los ejercicios', !('ejercicios' in ve.clubs[0].jugadores[0]), ve.clubs[0].jugadores[0]);
  { const pj = (await llamar(S, { action: 'seg-eq-club', pwd, club: CLUB2 })).j.jugadores.find(x => x.equipo === 'Juvenil A');
    await llamar(S, { action: 'seg-eq-parte', pwd, id: pj.id, quien: 'Sara', campos: { ejercicios: true } }, 'POST'); }
  ve = await verEq(ent); ver('activado: ve sus ejercicios', (ve.clubs[0].jugadores[0].ejercicios || [])[0]?.name === 'Sentadilla', ve.clubs[0].jugadores[0]);
  ve = await verEq(coo); ver('coordinador: todo el club', ve.ok && ve.clubs[0].jugadores.length === 2, ve);
  r = await llamar(S, { action: 'seg-eq-club', pwd, club: CLUB2 });
  ver('lista de equipos del club', r.j.ok && r.j.equipos.join('|') === 'Infantil B|Juvenil A', r.j.equipos);
  r = await llamar(S, { action: 'eq-mio', patientId: 'recPacPrueba00001' });
  ver('el jugador ve su parte aunque no lo comparta', r.j.ok && r.j.partes[0].consentimiento === 'Retirado' && r.j.partes[0].parte.diagnostico.includes('Esguince'), r.j);
  // Paciente que también es entrenador: activa Mi equipo con la clave (mismo email)
  await ins('tbldBVgClS4HY2mOJ', 'recPacPrueba00006', { 'FULL NAME': 'Ent A Paciente', PIN: '6666', EMAIL: 'enta@c.com' });
  r = await llamar(S, { action: 'eq-clave', patientId: 'recPacPrueba00006', clave: '0000' }, 'POST');
  ver('clave mala', !r.j.ok, r.j);
  r = await llamar(S, { action: 'eq-clave', patientId: 'recPacPrueba00006', clave: ent.pin }, 'POST');
  ver('activa Mi equipo con su clave', r.j.ok && r.j.equipo.length === 1, r.j);
  r = await llamar(S, { action: 'eq-clave', patientId: 'recPacPrueba00005', clave: ent.pin }, 'POST');
  ver('otro paciente con la misma clave no', !r.j.ok, r.j);
  // Editar solo el email: el móvil se queda
  const t1 = (await llamar(S, { action: 'seg-eq-acceso', pwd, club: CLUB2, campos: { nombre: 'Tel', telf: '611000111' } }, 'POST')).j.acceso;
  r = await llamar(S, { action: 'seg-eq-acceso', pwd, club: CLUB2, id: t1.id, campos: { nombre: 'Tel', email: 'tel@c.com' } }, 'POST');
  ver('editar email conserva el móvil', r.j.ok && r.j.acceso.telf === '611000111' && r.j.acceso.email === 'tel@c.com', r.j);
  r = await llamar(S, { action: 'seg-eq-equipos', pwd, club: CLUB2, equipos: ['Alevín A', 'Juvenil A'] }, 'POST');
  ver('crear equipos del club', r.j.ok && r.j.equipos.length === 2, r.j);
  r = await llamar(S, { action: 'seg-eq-club', pwd, club: CLUB2 });
  ver('el club lista sus equipos', r.j.equipos.includes('Alevín A') && r.j.enUso.includes('Infantil B') && !r.j.enUso.includes('Alevín A'), r.j);
  r = await llamar(S, { action: 'seg-eq-ficha', pwd, id: 'recPacPrueba00001' });
  ver('ficha: equipos del club para elegir', r.j.clubs.find(c => c.id === CLUB2).equipos.includes('Alevín A'), r.j.clubs);
  r = await llamar(S, { action: 'seg-eq-vista', pwd, club: CLUB2 });
  const vq = new URLSearchParams(r.j.url.split('?')[1]).get('vista');
  r = await llamar(S, { action: 'eq-equipo', vista: vq });
  ver('vista previa: como un coordinador', r.j.ok && r.j.clubs[0].jugadores.length === 2, r.j);
  r = await llamar(S, { action: 'eq-equipo', vista: vq.replace(/.$/, c => c === 'a' ? 'b' : 'a') });
  ver('vista previa con firma mala', !r.j.ok, r.j);
  console.log(fallos ? `\n${fallos} FALLOS` : '\nTodo bien');
  process.exit(fallos ? 1 : 0);
})().catch(e => { console.error('FALLO', e.message, String(e.stack).split('\n').slice(1, 4).join(' | ')); process.exit(1); });
