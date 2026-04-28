// api/login.js - Login por email + PIN
const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const BASE_ID = 'appbK09V4X3pPIai3';
const TABLE_ID = 'tbldBVgClS4HY2mOJ';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { email, pin } = req.query;
  if (!email || !pin) return res.status(400).json({ ok: false, error: 'Faltan datos' });

  try {
    const emailClean = email.trim().toLowerCase();
    const url = `https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}?filterByFormula=LOWER({EMAIL})="${emailClean}"&fields[]=FULL NAME&fields[]=EMAIL&fields[]=PIN&fields[]=WHATSAPP`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } });
    const data = await r.json();

    if (!data.records?.length) return res.status(200).json({ ok: false, error: 'Email no encontrado. Contacta con tu fisioterapeuta.' });

    const patient = data.records.find(rec => String(rec.fields['PIN'] || '').trim() === String(pin).trim());
    if (!patient) return res.status(200).json({ ok: false, error: 'PIN incorrecto. Contacta con tu fisioterapeuta.' });

    const f = patient.fields;
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
