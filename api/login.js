// api/login.js - Login por email + PIN
// También entran aquí los entrenadores y coordinadores de «Mi equipo» (tabla ACCESOS, ver api/_equipo.js):
// con su email (o teléfono) y su clave. Si además son pacientes, entran como paciente y ven también «Mi equipo».
const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const { BASE_ID } = require('./_base');
require('./_pg'); // con DB_URL, los datos salen de Postgres en vez de Airtable (api/_pg.js)
const { EQ, firmaEq } = require('./_equipo');
const TABLE_ID = 'tbldBVgClS4HY2mOJ';
const CLUBS = 'tblClubsDeporti01';
const H = () => ({ Authorization: `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' });
const ahora = () => new Date().toISOString();

// Accesos activos de «Mi equipo» con ese email o teléfono
async function accesosDe(emailClean, tel) {
  const f = tel ? `AND({ACTIVO},RIGHT(REGEX_REPLACE({TELF}&'','[^0-9]',''),9)="${tel}")` : `AND({ACTIVO},LOWER(TRIM({EMAIL}&''))="${emailClean}")`;
  const r = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${EQ.acc}?filterByFormula=${encodeURIComponent(f)}`, { headers: H() }).then(x => x.json()).catch(() => ({}));
  return r.records || [];
}
async function nombresClubs(ids) {
  const out = {};
  for (const id of [...new Set(ids)].slice(0, 10)) {
    const r = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${CLUBS}/${id}`, { headers: H() }).then(x => x.json()).catch(() => ({}));
    if (r && r.fields) out[id] = r.fields['NOMBRE'] || '';
  }
  return out;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  const { email, pin } = req.query;
  if (!email || !pin) return res.status(400).json({ ok: false, error: 'Faltan datos' });
  try {
    // Se entra con el email o con el teléfono (los que no tienen email)
    const emailClean = email.trim().toLowerCase().replace(/"/g, '');
    const tel = emailClean.includes('@') ? '' : emailClean.replace(/\D/g, '').slice(-9);
    if (!emailClean.includes('@') && tel.length !== 9) return res.status(200).json({ ok: false, error: 'Escribe tu email o tu teléfono' });
    const formula = tel ? `OR(RIGHT(REGEX_REPLACE({WHATSAPP}&'','[^0-9]',''),9)="${tel}",RIGHT(REGEX_REPLACE({TELF}&'','[^0-9]',''),9)="${tel}")` : `LOWER({EMAIL})="${emailClean}"`;
    const url = `https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}?filterByFormula=${encodeURIComponent(formula)}&fields[]=FULL NAME&fields[]=EMAIL&fields[]=PIN&fields[]=WHATSAPP`;
    const [data, accs] = await Promise.all([fetch(url, { headers: H() }).then(r => r.json()), accesosDe(emailClean, tel)]);
    const recs = data.records || [];
    const patient = recs.find(rec => String(rec.fields['PIN'] || '').trim() === String(pin).trim());
    // Entrenador: su clave; si ya ha entrado como paciente con ese mismo email, no hace falta la otra clave
    const mios = accs.filter(a => patient || String(a.fields['PIN'] || '').trim() === String(pin).trim());
    if (!patient && !mios.length) {
      if (!recs.length && !accs.length) return res.status(200).json({ ok: false, error: (tel ? 'Teléfono' : 'Email') + ' no encontrado. Contacta con tu fisioterapeuta.' });
      return res.status(200).json({ ok: false, error: accs.length && !recs.length ? 'Clave incorrecta. Pídela a la clínica.' : 'PIN incorrecto. Contacta con tu fisioterapeuta.' });
    }
    let equipo = [];
    if (mios.length) {
      const nom = await nombresClubs(mios.map(a => a.fields['CLUB']).filter(Boolean));
      equipo = mios.filter(a => nom[a.fields['CLUB']] !== undefined).map(a => ({ id: a.id, tok: firmaEq(a.id), club: a.fields['CLUB'], clubNombre: nom[a.fields['CLUB']] || 'Mi club', rol: a.fields['ROL'] || '' }));
      for (const a of mios) await fetch(`https://api.airtable.com/v0/${BASE_ID}/${EQ.acc}/${a.id}`, { method: 'PATCH', headers: H(), body: JSON.stringify({ fields: { 'ÚLTIMO ACCESO': ahora() } }) }).catch(() => {});
    }
    if (patient) {
      const f = patient.fields;
      await fetch(`https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}/${patient.id}`, { method: 'PATCH', headers: H(), body: JSON.stringify({ fields: { 'ÚLTIMO ACCESO APP': ahora() } }) }).catch(() => {});
      return res.status(200).json({ ok: true, patient: { id: patient.id, nombre: f['FULL NAME'] || email, email: f['EMAIL'] || '', telefono: f['WHATSAPP'] || '', equipo } });
    }
    // Solo entrenador (no es paciente): la app se abre solo con «Mi equipo»
    if (!equipo.length) return res.status(200).json({ ok: false, error: 'Tu acceso no está activo. Habla con la clínica.' });
    const a = mios[0].fields;
    return res.status(200).json({ ok: true, patient: { id: mios[0].id, nombre: a['NOMBRE'] || email, email: a['EMAIL'] || '', telefono: a['TELF'] || '', soloEquipo: true, equipo } });
  } catch(e) {
    return res.status(500).json({ ok: false, error: 'Error de servidor' });
  }
}
