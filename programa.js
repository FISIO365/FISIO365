// api/login.js
// Vercel Serverless Function
// Busca el paciente en Airtable por nombre + PIN

const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const BASE_ID = 'appbK09V4X3pPIai3';
const TABLE_ID = 'tbldBVgClS4HY2mOJ'; // PACIENTES

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { name, pin } = req.query;

  if (!name || !pin || pin.length !== 4) {
    return res.status(400).json({ ok: false, error: 'Datos inválidos' });
  }

  try {
    // Buscar paciente en Airtable por nombre (campo FULL NAME o NOMBRE)
    const searchName = name.trim().toLowerCase();

    const url = `https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}?filterByFormula=OR(LOWER({FULL NAME})="${searchName}",LOWER({NOMBRE})="${searchName}")&fields[]=FULL NAME&fields[]=NOMBRE&fields[]=PIN&fields[]=ID&fields[]=ESTADO&fields[]=EMAIL&fields[]=WHATSAPP`;

    const atRes = await fetch(url, {
      headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` }
    });

    if (!atRes.ok) {
      console.error('Airtable error:', await atRes.text());
      return res.status(500).json({ ok: false, error: 'Error de servidor' });
    }

    const data = await atRes.json();

    if (!data.records || data.records.length === 0) {
      return res.status(200).json({ ok: false, error: 'No encontrado. Comprueba tu nombre.' });
    }

    // Buscar el que tenga el PIN correcto
    const patient = data.records.find(r => {
      const storedPin = String(r.fields['PIN'] || '').trim();
      return storedPin === pin;
    });

    if (!patient) {
      return res.status(200).json({ ok: false, error: 'PIN incorrecto. Contacta con tu fisioterapeuta.' });
    }

    const f = patient.fields;

    return res.status(200).json({
      ok: true,
      patient: {
        id: patient.id,           // Airtable record ID
        airtableId: f['ID'],      // Auto number
        nombre: f['FULL NAME'] || f['NOMBRE'] || name,
        email: f['EMAIL'] || '',
        telefono: f['WHATSAPP'] || '',
        sesiones: 12,             // Puedes añadir campo en Airtable
        hechas: 0,                // Puedes añadir campo en Airtable
      }
    });

  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ ok: false, error: 'Error interno' });
  }
}
