// Datos inventados para la «Clínica Demo» (solo con CLINICA=demo): fisios, pacientes, citas pasadas y futuras, huecos libres.
// Se puede repetir: «borrar» deja la demo vacía y «sembrar» la vuelve a llenar.
const madrid = (d = 0) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date(Date.now() + d * 864e5));
const diaSem = f => new Date(f + 'T12:00:00Z').getUTCDay(); // 0 domingo … 6 sábado
const NOMBRES = ['Lucía Martín Sanz', 'Javier Romero Gil', 'Carmen Navarro Ruiz', 'Pablo Ortega Díaz', 'Marta Serrano López', 'David Molina Castro', 'Elena Vidal Torres', 'Sergio Blanco Ramos', 'Paula Iglesias Mora', 'Raúl Delgado Vega', 'Cristina Pascual Rey', 'Álvaro Herrera Cano', 'Nuria Fuentes Prieto', 'Iván Cabrera León', 'Sara Méndez Rubio', 'Óscar Campos Soler', 'Irene Vázquez Peña', 'Hugo Calvo Lozano', 'Laia Ferrer Costa', 'Andrés Moreno Bravo', 'Claudia Gallego Rius', 'Tomás Herrero Bosch', 'Alba Domínguez Pons', 'Víctor Santos Vila', 'Noelia Crespo Font', 'Jordi Marín Roca', 'Rocío Peña Gimeno', 'Daniel Arias Mas'];
const MOTIVOS = ['Dolor lumbar al estar sentado', 'Cervicalgia y cefaleas', 'Esguince de tobillo jugando a pádel', 'Tendinopatía del hombro', 'Rehabilitación de rodilla tras cirugía', 'Fascitis plantar', 'Contractura en trapecios', 'Epicondilitis', 'Ciática', 'Readaptación tras rotura de isquios'];
const NOTAS = ['TM lumbar y movilidad. Mejor que la semana pasada.', 'Punción seca en trapecio. EVA 5 → 3.', 'Ejercicios de propiocepción. Camina sin dolor.', 'Terapia manual cervical. Menos cefaleas.', 'Fuerza de cuádriceps. Flexión 110º.', 'Ondas de choque en fascia. Mejora al levantarse.'];
async function demo({ at, db, op, guardarAjuste }) {
  if (op === 'borrar') { // se apunta todo en «borrados» para que las otras instancias vacíen su caché
    await db.query('with d as (delete from registros returning tabla, id) insert into borrados (tabla, id, t) select tabla, id, clock_timestamp() from d');
    await db.query('delete from archivos'); await db.query('delete from contadores'); return { ok: true, borrado: true }; }
  const ya = await at('tbl2mLUrnaKCFTs6g?pageSize=1&fields[]=Name'); if (ya.records && ya.records.length) return { ok: false, error: 'La demo ya tiene datos: bórrala primero' };
  const lote = async (t, L) => { const ids = []; for (let i = 0; i < L.length; i += 10) { const d = await at(t, { method: 'POST', body: JSON.stringify({ records: L.slice(i, i + 10).map(fields => ({ fields })), typecast: true }) }); if (d.error) throw new Error(d.error.message || JSON.stringify(d.error)); ids.push(...d.records.map(r => r.id)); } return ids; };
  const acc = v => Object.fromEntries(['programas', 'anamnesis', 'pacientes', 'school', 'checklist', 'rendimiento', 'seguimiento', 'agenda', 'chat', 'callin', 'captacion', 'recordatorios', 'ejercicios', 'estadisticas', 'admin', 'sugerencias'].map(k => ['acc_' + k, v === true || (Array.isArray(v) && v.includes(k))]));
  const basico = ['programas', 'anamnesis', 'pacientes', 'school', 'checklist', 'agenda', 'chat', 'ejercicios', 'sugerencias', 'seguimiento', 'recordatorios'];
  // 1. Equipo (Laura entra con 1234)
  const fids = await lote('tbl2mLUrnaKCFTs6g', [
    { Name: 'Laura Gómez', Password: '1234', Role: 'fisio', 'DIRECCIÓN': true, 'NºColegiado': '12345', ...acc(true) },
    { Name: 'Marc Puig', Password: '2345', Role: 'fisio', 'NºColegiado': '23456', ...acc(basico) },
    { Name: 'Ana Ruiz', Password: '3456', Role: 'fisio', 'NºColegiado': '34567', ...acc(basico) },
    { Name: 'Recepción', Password: '4567', Role: 'admin', ...acc(['pacientes', 'agenda', 'chat', 'callin', 'captacion', 'recordatorios', 'checklist', 'school', 'sugerencias', 'seguimiento']) }]);
  const FIS = ['Laura', 'Marc', 'Ana'];
  // 2. Pacientes
  const pac = NOMBRES.map((n, i) => ({ 'FULL NAME': n, NOMBRE: n.split(' ')[0], TELF: '6' + String(10000000 + i * 3711).slice(0, 8), WHATSAPP: '6' + String(10000000 + i * 3711).slice(0, 8), EMAIL: n.split(' ')[0].toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '') + '@ejemplo.com', PIN: String(1000 + i * 37), 'MOTIVO DE VISITA': MOTIVOS[i % MOTIVOS.length] }));
  const pids = await lote('tbldBVgClS4HY2mOJ', pac);
  // 3. Citas: 3 semanas atrás (realizadas) y 2 adelante (pendientes y huecos libres), de lunes a viernes
  const citas = [], hist = {}; let k = 0;
  for (let d = -21; d <= 14; d++) {
    const f = madrid(d), w = diaSem(f); if (w === 0 || w === 6) continue;
    FIS.forEach((fi, j) => {
      const horas = j === 0 ? ['09:00', '10:00', '11:00', '12:00', '16:00', '17:00'] : j === 1 ? ['10:00', '11:00', '15:00', '16:00', '17:00', '18:00'] : ['09:00', '12:00', '13:00', '17:00', '18:00', '19:00'];
      horas.forEach((h, n) => {
        const ocupada = (k + n * 3 + j) % 7 !== 0 && (d <= 0 || (k + n + j) % 3 !== 0); k++;
        if (!ocupada) { if (d >= 0) citas.push({ FECHA: f, HORA: h, 'PREF.': fi, ESTADO: 'CITA LIBRE' }); return; }
        const pid = pids[(k * 7 + n + j * 5) % pids.length];
        const est = d < 0 ? ((k % 17 === 0) ? 'CANCELADA' : 'REALIZADA') : d === 0 ? 'PENDIENTE ' : 'PENDIENTE ';
        citas.push({ FECHA: f, HORA: h, 'PREF.': fi, ESTADO: est, 'RELACIÓN - CITA': [pid], 'TIPO DE SESIÓN': (k % 5 === 0) ? 'Fisioterapia avanzada' : 'Fisioterapia convencional' });
        if (est === 'REALIZADA') (hist[pid] = hist[pid] || []).push(`${f.split('-').reverse().join('/')} · ${fi}: ${NOTAS[k % NOTAS.length]}`);
      });
    });
  }
  await lote('tblTPlcuiSjQngkaD', citas);
  // 4. Historial clínico de quien ya ha venido
  const up = Object.entries(hist).map(([id, L]) => ({ id, fields: { 'HISTORIAL CLÍNICO': L.join('\n') } }));
  for (let i = 0; i < up.length; i += 10) await at('tbldBVgClS4HY2mOJ', { method: 'PATCH', body: JSON.stringify({ records: up.slice(i, i + 10), typecast: true }) });
  // 5. Biblioteca de ejercicios, planes para casa y chats (para que la demo no se vea vacía)
  const EJ = [
    ['Puente de glúteo', 'Tumbado boca arriba, rodillas dobladas. Sube la cadera apretando glúteos y baja despacio.', 'Cadera y glúteo', 3, 12, 0],
    ['Gato-camello', 'A cuatro patas, redondea la espalda y luego húndela suavemente, sin dolor.', 'Lumbar', 2, 10, 0],
    ['Plancha frontal', 'Apoyado en antebrazos y puntas de los pies, cuerpo recto. Respira normal.', 'Core', 3, 0, 30],
    ['Retracción cervical', 'Sentado y recto, lleva la barbilla hacia atrás como haciendo papada. Mantén 3 segundos.', 'Cervical', 2, 10, 0],
    ['Estiramiento de trapecio', 'Inclina la cabeza hacia un lado y ayúdate suave con la mano. Sin rebotes.', 'Cervical', 2, 0, 30],
    ['Rotación externa con goma', 'Codo pegado al cuerpo a 90º, abre el antebrazo hacia fuera contra la goma.', 'Hombro', 3, 12, 0],
    ['Péndulo de Codman', 'Inclinado hacia delante, deja colgar el brazo y haz círculos pequeños.', 'Hombro', 2, 0, 45],
    ['Sentadilla a la silla', 'Baja como si fueras a sentarte, roza la silla y vuelve a subir.', 'Rodilla', 3, 10, 0],
    ['Extensión de rodilla sentado', 'Sentado, estira la rodilla del todo, aprieta el muslo 3 segundos y baja.', 'Rodilla', 3, 12, 0],
    ['Equilibrio a una pierna', 'De pie sobre una pierna, cerca de una pared por si acaso.', 'Equilibrio', 3, 0, 30],
    ['Elevación de talones', 'De pie, sube a puntillas despacio y baja en 3 segundos.', 'Tobillo y pie', 3, 15, 0],
    ['Rodar la planta con pelota', 'Sentado, pasa una pelota bajo la planta del pie con presión cómoda.', 'Tobillo y pie', 1, 0, 60],
    ['Extensión de muñeca excéntrica', 'Con una botella de agua, baja la mano despacio en 4 segundos.', 'Codo, muñeca y mano', 3, 12, 0],
    ['Respiración diafragmática', 'Tumbado, una mano en el pecho y otra en la barriga: que se mueva solo la de la barriga.', 'Respiración', 1, 0, 120],
    ['Bird-dog', 'A cuatro patas, estira brazo y pierna contrarios sin mover la pelvis.', 'Core', 3, 10, 0]];
  await lote('tbloqn3ts872ueJSE', EJ.map(([Nombre, Descripcion, Zona]) => ({ Nombre, Descripcion, Zona })));
  const ej = i => { const [nombre, descripcion, zona, series, reps, dur] = EJ[i]; return { v2: 1, nombre, series, reps, duracion: dur, descanso: 30, zona, descripcion, youtubeUrl: '', imagen: '' }; };
  const PLANES = [[0, [0, 1, 14, 2], 'Hazlos cada día por la mañana. Si algo duele más de 4/10, para y me lo cuentas.'], [1, [3, 4, 13], 'Dos veces al día, sobre todo después de trabajar con el ordenador.'], [2, [10, 9, 11], 'Para el tobillo: cada día. El equilibrio, mejor descalzo.'], [3, [5, 6], 'Sin forzar. La goma, la verde de momento.'], [4, [7, 8, 9], 'Rodilla: 3 días por semana. ¡Vas genial!'], [5, [11, 10], 'Por la noche, antes de dormir.'], [7, [12], 'Lento al bajar, es lo importante.'], [8, [0, 1, 2, 14], 'Rutina de espalda para casa.']];
  const fp = i => [fids[i % 3], FIS[i % 3]];
  await lote('tblvgE0a4gsrj4Vhp', PLANES.map(([i, L, m], n) => ({ Nombre: `${NOMBRES[i]} - ${madrid(-n - 2)}`, PacienteID: pids[i], PacienteNombre: NOMBRES[i], FisioID: fp(i)[0], FisioNombre: fp(i)[1], Ejercicios: JSON.stringify(L.map(ej)), FechaAsignacion: madrid(-n - 2), MensajeFisio: m })));
  const hora = (d, h) => { const [y, mo, dd] = madrid(d).split('-'); return `${+dd}/${+mo}/${y}, ${h}:00`; };
  const CHATS = [
    [0, -2, [['paciente', '09:12', 'Hola! Esta mañana me he levantado mucho mejor de la espalda 🙌'], ['fisio', '09:40', '¡Qué bien! Sigue con los ejercicios y el jueves lo vemos.']]],
    [1, -1, [['paciente', '18:05', '¿Puedo ir al gimnasio esta semana o mejor espero?'], ['fisio', '18:30', 'Puedes ir, pero sin peso por encima de la cabeza de momento. Te paso los ejercicios por la app.'], ['paciente', '18:32', 'Perfecto, gracias!']]],
    [2, 0, [['paciente', '08:47', 'Buenos días, ¿hay hueco hoy por la tarde? Me ha vuelto a molestar el tobillo']]],
    [4, -3, [['fisio', '12:10', 'Hola Marta, ¿qué tal la rodilla después de la sesión de ayer?'], ['paciente', '13:02', 'Bastante bien, un poco cargada pero nada raro']]],
    [6, 0, [['paciente', '10:20', 'Os he dejado reseña en Google ⭐⭐⭐⭐⭐ ¡Mil gracias por todo!']]]];
  const msgs = [];
  CHATS.forEach(([i, d, L]) => L.forEach(([de, h, Texto], n) => { const [fid, fn] = fp(i), ult = n === L.length - 1; msgs.push({ PacienteId: pids[i], PacienteNombre: NOMBRES[i], FisioId: fid, FisioNombre: fn, Texto, Fecha: hora(d, h), Tipo: 'chat', De: de, Visto: de === 'fisio' || !(ult && d === 0), RespuestaLeida: de !== 'fisio' || !ult }); }));
  await lote('tblIsWo3g6x1QzJyl', msgs);
  // 6. Buzón de sugerencias: una ya respondida por los creadores de la app y otra de la clínica
  const ahora = d => new Date(Date.now() + d * 864e5).toISOString();
  await lote('tbll3K0ar1cZOcVjZ', [
    { RESUMEN: 'Saber qué pacientes aún no tienen la app', TEXTO: 'Estaría genial tener una lista de los pacientes que aún no tienen la app instalada, para acordarnos de enseñársela en la próxima sesión.', ORIGEN: 'Equipo', APARTADO: 'App', TIPO: 'Mejora', DE: 'Marc', ESTADO: 'Hecha', NOTA: '¡Hecho! Ya lo tenéis en Tareas › «Sin la app». Gracias por la idea 🙌', 'CAMBIADO POR': 'Creadores de la app', 'RESPUESTA VISTA': true, FECHA: ahora(-6) },
    { RESUMEN: 'Comprar otra camilla eléctrica', TEXTO: 'La camilla de la sala 2 empieza a fallar al subir. ¿Podríamos mirar una nueva?', ORIGEN: 'Equipo', APARTADO: 'Clínica', DE: 'Ana', ESTADO: 'Nueva', FECHA: ahora(-1) }]);
  // 7. Datos de la clínica (otro color, para ver que la marca cambia)
  const IC = require('./_demo_iconos.json'); // iconos de la demo (hoja de arce): la app en verde y el panel en claro, a juego
  await guardarAjuste('clinica-icono', { data: IC.app }, 'Demo'); await guardarAjuste('clinica-icono-panel', { data: IC.panel }, 'Demo');
  await guardarAjuste('config', { clinica: { iconoV: 1, iconoPV: 1, marca: 'Clínica Arce', razon: 'Clínica Arce Fisioterapia, S.L.', nif: 'B00000000', direccion: 'C/ de Ejemplo, 10 · 08001 Barcelona', dirCorta: 'C/ de Ejemplo, 10 · Barcelona', zona: 'Ciutat Vella', ciudad: 'Barcelona', tel: '600 000 000', email: 'hola@clinicaarce.es', web: 'clinicaarce.es', color: '#2e6e6a' } }, 'Demo');
  return { ok: true, fisios: 4, pacientes: pids.length, citas: citas.length, ejercicios: EJ.length, mensajes: msgs.length };
}
module.exports = { demo };
