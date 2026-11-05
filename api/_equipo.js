// ── MI EQUIPO: lo compartido entre login.js, subscribe.js y schedule.js ──
// Entrenadores y coordinadores de un club entran en la app del paciente con su email y su clave (tabla ACCESOS) y ven
// el parte de sus jugadores (tabla PARTES), solo de los que han aceptado compartirlo.
// Cada acceso lleva una firma (tok) para que nadie pueda pedir los partes de un club cambiando un id. La firma depende
// también de su clave: si dirección le cambia la clave, las sesiones abiertas con la anterior dejan de valer.
const crypto = require('crypto');
const EQ = { acc: 'tblMiEquipoAcc001', par: 'tblMiEquipoPar001' };
const okId = s => /^rec[A-Za-z0-9]{14}$/.test(s || '');
function firmaEq(id, pin) { return crypto.createHmac('sha256', String(process.env.AIRTABLE_TOKEN || 'fisio365')).update('equipo:' + id + ':' + String(pin || '').trim()).digest('hex').slice(0, 16); }
// okFormato: antes de leer el registro; okTok: con la clave que tiene ahora
const okFormato = (id, t) => okId(id) && typeof t === 'string' && /^[a-f0-9]{16}$/.test(t);
function okTok(id, t, pin) {
  if (!okFormato(id, t)) return false;
  try { return crypto.timingSafeEqual(Buffer.from(t), Buffer.from(firmaEq(id, pin))); } catch (e) { return false; }
}
module.exports = { EQ, firmaEq, okTok, okFormato, okId };
