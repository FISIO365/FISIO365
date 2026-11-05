// ── MI EQUIPO: lo compartido entre login.js, subscribe.js y schedule.js ──
// Entrenadores y coordinadores de un club entran en la app del paciente con su email y su clave (tabla ACCESOS) y ven
// el parte de sus jugadores (tabla PARTES), solo de los que han aceptado compartirlo.
// Cada acceso lleva una firma (tok) para que nadie pueda pedir los partes de un club cambiando un id.
const crypto = require('crypto');
const EQ = { acc: 'tblMiEquipoAcc001', par: 'tblMiEquipoPar001' };
const okId = s => /^rec[A-Za-z0-9]{14}$/.test(s || '');
function firmaEq(id) { return crypto.createHmac('sha256', String(process.env.AIRTABLE_TOKEN || 'fisio365')).update('equipo:' + id).digest('hex').slice(0, 16); }
function okTok(id, t) {
  if (!okId(id) || typeof t !== 'string' || t.length !== 16) return false;
  try { return crypto.timingSafeEqual(Buffer.from(t), Buffer.from(firmaEq(id))); } catch (e) { return false; }
}
module.exports = { EQ, firmaEq, okTok, okId };
