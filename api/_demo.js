// Datos inventados para la «Clínica Demo» (solo con CLINICA=demo): fisios, pacientes, citas pasadas y futuras, huecos libres.
// Se puede repetir: «borrar» deja la demo vacía y «sembrar» la vuelve a llenar.
const madrid = (d = 0) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date(Date.now() + d * 864e5));
const diaSem = f => new Date(f + 'T12:00:00Z').getUTCDay(); // 0 domingo … 6 sábado
const NOMBRES = ['Lucía Martín Sanz', 'Javier Romero Gil', 'Carmen Navarro Ruiz', 'Pablo Ortega Díaz', 'Marta Serrano López', 'David Molina Castro', 'Elena Vidal Torres', 'Sergio Blanco Ramos', 'Paula Iglesias Mora', 'Raúl Delgado Vega', 'Cristina Pascual Rey', 'Álvaro Herrera Cano', 'Nuria Fuentes Prieto', 'Iván Cabrera León', 'Sara Méndez Rubio', 'Óscar Campos Soler', 'Irene Vázquez Peña', 'Hugo Calvo Lozano', 'Laia Ferrer Costa', 'Andrés Moreno Bravo', 'Claudia Gallego Rius', 'Tomás Herrero Bosch', 'Alba Domínguez Pons', 'Víctor Santos Vila', 'Noelia Crespo Font', 'Jordi Marín Roca', 'Rocío Peña Gimeno', 'Daniel Arias Mas'];
const MOTIVOS = ['Dolor lumbar al estar sentado', 'Cervicalgia y cefaleas', 'Esguince de tobillo jugando a pádel', 'Tendinopatía del hombro', 'Rehabilitación de rodilla tras cirugía', 'Fascitis plantar', 'Contractura en trapecios', 'Epicondilitis', 'Ciática', 'Readaptación tras rotura de isquios'];
const NOTAS = ['TM lumbar y movilidad. Mejor que la semana pasada.', 'Punción seca en trapecio. EVA 5 → 3.', 'Ejercicios de propiocepción. Camina sin dolor.', 'Terapia manual cervical. Menos cefaleas.', 'Fuerza de cuádriceps. Flexión 110º.', 'Ondas de choque en fascia. Mejora al levantarse.'];
async function demo({ at, db, op, guardarAjuste }) {
  if (op === 'borrar') { await db.query('truncate registros, borrados, archivos, contadores'); return { ok: true, borrado: true }; }
  const ya = await at('tbl2mLUrnaKCFTs6g?pageSize=1&fields[]=Name'); if (ya.records && ya.records.length) return { ok: false, error: 'La demo ya tiene datos: bórrala primero' };
  const lote = async (t, L) => { const ids = []; for (let i = 0; i < L.length; i += 10) { const d = await at(t, { method: 'POST', body: JSON.stringify({ records: L.slice(i, i + 10).map(fields => ({ fields })), typecast: true }) }); if (d.error) throw new Error(d.error.message || JSON.stringify(d.error)); ids.push(...d.records.map(r => r.id)); } return ids; };
  const acc = v => Object.fromEntries(['programas', 'anamnesis', 'pacientes', 'school', 'checklist', 'rendimiento', 'seguimiento', 'agenda', 'chat', 'callin', 'captacion', 'recordatorios', 'ejercicios', 'estadisticas', 'admin', 'sugerencias'].map(k => ['acc_' + k, v === true || (Array.isArray(v) && v.includes(k))]));
  const basico = ['programas', 'anamnesis', 'pacientes', 'school', 'checklist', 'agenda', 'chat', 'ejercicios', 'sugerencias', 'seguimiento', 'recordatorios'];
  // 1. Equipo (Laura entra con 1234)
  await lote('tbl2mLUrnaKCFTs6g', [
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
  // 5. Datos de la clínica (otro color, para ver que la marca cambia)
  await guardarAjuste('config', { clinica: { marca: 'Clínica Demo', razon: 'Clínica Demo, S.L.', nif: 'B00000000', direccion: 'C/ de Ejemplo, 10 · 08001 Barcelona', dirCorta: 'C/ de Ejemplo, 10 · Barcelona', zona: 'Ciutat Vella', ciudad: 'Barcelona', tel: '600 000 000', email: 'hola@clinicademo.es', web: 'clinicademo.es', color: '#2f6f73' } }, 'Demo');
  return { ok: true, fisios: 4, pacientes: pids.length, citas: citas.length };
}
module.exports = { demo };
