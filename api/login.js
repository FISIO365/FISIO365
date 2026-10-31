// api/login.js - Login por email + PIN
const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const { BASE_ID } = require('./_base');
require('./_pg'); // con DB_URL, los datos salen de Postgres en vez de Airtable (api/_pg.js)
const TABLE_ID = 'tbldBVgClS4HY2mOJ';
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
    const r = await fetch(url, { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } });
    const data = await r.json();
    if (!data.records?.length) return res.status(200).json({ ok: false, error: (tel ? 'Teléfono' : 'Email') + ' no encontrado. Contacta con tu fisioterapeuta.' });
    const patient = data.records.find(rec => String(rec.fields['PIN'] || '').trim() === String(pin).trim());
    if (!patient) return res.status(200).json({ ok: false, error: 'PIN incorrecto. Contacta con tu fisioterapeuta.' });
    const f = patient.fields;
    await fetch(`https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}/${patient.id}`, { method: 'PATCH', headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: { 'ÚLTIMO ACCESO APP': new Date().toISOString() } }) }).catch(() => {});
    return res.status(200).json({
      ok: true,
      patient: {
        id: patient.id,
        nombre: f['FULL NAME'] || email,
        email: f['EMAIL'] || '',
        telefono: f['WHATSAPP'] || ''
      }
    });
  } catch(e) {
    return res.status(500).json({ ok: false, error: 'Error de servidor' });
  }
}
