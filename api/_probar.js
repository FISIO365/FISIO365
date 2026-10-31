// Prueba de ESCRITURAS en la versión de prueba (Postgres, SIN_ENVIOS): un paciente de prueba recorre las acciones
// del panel y de la app y se comprueba que cada una queda bien guardada. Lo usa /api/schedule?action=pg-probar.
const madrid = (d = 0) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date(Date.now() + d * 864e5));
async function probar({ fetch: F, pwd, self }) {
  const byp = process.env.VERCEL_AUTOMATION_BYPASS_SECRET ? { 'x-vercel-protection-bypass': process.env.VERCEL_AUTOMATION_BYPASS_SECRET } : {};
  const post = async (ruta, b) => { const t0 = Date.now(); const r = await F(self + ruta, { method: 'POST', headers: { 'Content-Type': 'application/json', ...byp }, body: JSON.stringify({ pwd, ...b }) }); const tx = await r.text(); let j; try { j = JSON.parse(tx); } catch (_) { j = { txt: tx.slice(0, 150) }; } return { st: r.status, j, ms: Date.now() - t0 }; };
  const get = async ruta => { const r = await F(self + ruta + (ruta.includes('?') ? '&' : '?') + 'pwd=' + encodeURIComponent(pwd), { headers: byp }); const tx = await r.text(); let j; try { j = JSON.parse(tx); } catch (_) { j = { txt: tx.slice(0, 150) }; } return { st: r.status, j }; };
  const out = []; const paso = (n, ok, info) => { out.push({ paso: n, ok: !!ok, info: typeof info === 'string' ? info : JSON.stringify(info).slice(0, 220) }); return ok; };
  const dia = madrid(8), tel = '6' + String(Date.now()).slice(-8);
  // 1. Paciente nuevo
  let r = await post('/api/schedule?action=seg-paciente-crear', { nombre: 'PRUEBA MIGRACION', tel, email: 'prueba-migracion@example.com', motivo: 'Prueba', forzar: true });
  const pid = r.j && (r.j.id || (r.j.paciente && r.j.paciente.id)); if (!paso('crear paciente', r.j.ok && pid, r.j)) return out;
  r = await get(`/api/pacientes?action=buscar&q=PRUEBA MIGRACION`); paso('buscarlo', JSON.stringify(r.j).includes(pid), r.j);
  // 2. Dar cita, verla en la agenda
  r = await post('/api/schedule?action=seg-agenda-dar', { pacienteId: pid, fecha: dia, hora: '09:30', fisio: 'Ramiro', quien: 'Prueba', notas: 'cita de prueba', tipos: ['Sesión suelta'], forzar: true, sinBomba: true });
  const cid = r.j && r.j.id; if (!paso('dar cita', r.j.ok && cid, r.j)) return out;
  r = await get(`/api/schedule?action=seg-agenda-dia&fecha=${dia}`); const c0 = ((r.j && r.j.citas) || []).find(c => c.id === cid);
  paso('sale en la agenda', c0 && c0.pacienteId === pid && c0.hora === '09:30', c0 || 'no está');
  r = await get(`/api/citas?patientId=${pid}`); paso('sale en la app del paciente', JSON.stringify(r.j).includes(dia), r.j);
  // 3. Editar (nota, confirmar) y mover
  r = await post('/api/schedule?action=seg-agenda-editar', { id: cid, confirmada: true, notas: 'nota cambiada' }); paso('editar cita', r.j.ok, r.j);
  r = await post('/api/schedule?action=seg-agenda-mover', { id: cid, fecha: dia, hora: '10:30', fisio: 'Ramiro', forzar: true, sinBomba: true }); paso('mover cita', r.j.ok, r.j);
  r = await get(`/api/schedule?action=seg-agenda-dia&fecha=${dia}`); const c1 = ((r.j && r.j.citas) || []).find(c => c.pacienteId === pid && c.hora === '10:30');
  paso('movida a las 10:30 con su nota', c1 && /nota cambiada/.test(c1.notas || '') && c1.confirmada, c1 || 'no está');
  const cid2 = (c1 && c1.id) || cid;
  // 4. Realizada + historial + ficha
  r = await post('/api/schedule?action=seg-agenda-editar', { id: cid2, estado: 'REALIZADA' }); paso('marcar realizada', r.j.ok, r.j);
  r = await post('/api/schedule?action=seg-historial-anadir', { id: pid, texto: 'Sesión de prueba: TM lumbar', fecha: dia, fisio: 'Ramiro' }); paso('añadir al historial', r.j.ok, r.j);
  r = await get(`/api/schedule?action=seg-ficha&id=${pid}`); paso('ficha con historial', JSON.stringify(r.j).includes('Sesión de prueba'), r.j && r.j.paciente ? 'ok' : r.j);
  // 5. Justificante, informe en blanco, informe con IA
  r = await post('/api/schedule?action=seg-justificante', { pacienteId: pid, citas: [cid2], tipo: 'justificante', quien: 'Prueba' }); paso('justificante', r.j.ok, r.j);
  r = await post('/api/schedule?action=seg-informe-tto', { pacienteId: pid, vacio: true, quien: 'Prueba' }); paso('informe en blanco', r.j.ok, r.j);
  r = await get(`/api/pacientes?action=get-informes&pacienteId=${pid}`); paso('informe en la ficha', ((r.j && r.j.informes) || []).length >= 1, ((r.j && r.j.informes) || []).length + ' informes');
  // 6. Tarea y chat
  r = await post('/api/schedule?action=seg-tarea-guardar', { texto: 'Tarea de prueba', para: 'Ramiro', fecha: madrid(0), pacienteId: pid, creadaPor: 'Prueba' }); const tid = r.j && (r.j.id || (r.j.tarea && r.j.tarea.id)); paso('crear tarea', r.j.ok, r.j);
  if (tid) { r = await post('/api/schedule?action=seg-tarea-hecha', { id: tid }); paso('tarea hecha', r.j.ok, r.j); }
  r = await post('/api/chat?action=enviar', { action: 'enviar', pacienteId: pid, pacienteNombre: 'PRUEBA MIGRACION', de: 'fisio', texto: 'Hola, mensaje de prueba', fisioNombre: 'Prueba' }); paso('chat: fisio escribe', r.j.ok, r.j);
  r = await post('/api/chat?action=enviar', { action: 'enviar', pacienteId: pid, pacienteNombre: 'PRUEBA MIGRACION', de: 'paciente', texto: 'Respuesta del paciente' }); paso('chat: paciente responde', r.j.ok, r.j);
  r = await get(`/api/chat?action=hilo&pacienteId=${pid}`); paso('chat: se ven los 2 mensajes', ((r.j && r.j.mensajes) || []).length >= 2, ((r.j && r.j.mensajes) || []).length + ' mensajes');
  // 7. Reservar desde la app: abrir un hueco libre y que el paciente lo coja
  r = await post('/api/schedule?action=seg-agenda-hueco', { fecha: dia, hora: '12:30', fisio: 'Ramiro', estado: 'CITA LIBRE' }); const hid = r.j && (r.j.id || (r.j.ids && r.j.ids[0])); paso('abrir hueco libre', r.j.ok && hid, r.j);
  if (hid) { r = await post('/api/reservar', { patientId: pid, huecoId: hid }); paso('paciente reserva desde la app', r.j.ok, r.j);
    r = await get(`/api/schedule?action=seg-agenda-dia&fecha=${dia}`); const c2 = ((r.j && r.j.citas) || []).find(c => c.id === hid); paso('la reserva sale en la agenda', c2 && c2.pacienteId === pid, c2 || 'no está'); }
  // 8. Cancelar y borrar
  r = await post('/api/schedule?action=seg-agenda-editar', { id: hid || cid2, estado: 'CANCELADA' }); paso('cancelar cita', r.j.ok, r.j);
  r = await post('/api/schedule?action=seg-agenda-borrar', { id: cid2, conPaciente: true }); paso('borrar cita', r.j.ok, r.j);
  r = await get(`/api/schedule?action=seg-agenda-dia&fecha=${dia}`); paso('ya no está en la agenda', !((r.j && r.j.citas) || []).some(c => c.id === cid2), 'ok');
  return out;
}
module.exports = { probar };
