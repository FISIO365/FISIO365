// api/programa.js - Guardar plan de ejercicios
const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const FISIO_PASSWORD = process.env.FISIO_PASSWORD || 'fisio2024';
const BASE_ID = 'appbK09V4X3pPIai3';
const PLAN_TABLE = 'tblvgE0a4gsrj4Vhp';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { pwd, pacienteId, pacienteNombre, fisioId, fisioNombre, ejercicios } = req.body;
  if (pwd !== FISIO_PASSWORD) return res.status(401).json({ ok: false, error: 'Contraseña incorrecta' });
  if (!pacienteId || !ejercicios?.length) return res.status(400).json({ ok: false, error: 'Faltan datos' });

  const today = new Date().toISOString().split('T')[0];

  try {
    const atRes = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${PLAN_TABLE}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        records: [{
          fields: {
            Nombre: `${pacienteNombre} - ${today}`,
            PacienteID: pacienteId,
            PacienteNombre: pacienteNombre,
            FisioID: fisioId || '',
            FisioNombre: fisioNombre || '',
            Ejercicios: JSON.stringify(ejercicios),
            FechaAsignacion: today
          }
        }]
      })
    });

    if (!atRes.ok) return res.status(500).json({ ok: false, error: 'Error en Airtable' });
    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'Error interno' });
  }
}
