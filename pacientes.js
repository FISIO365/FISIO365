// api/done.js
// Marca un ejercicio como hecho o no hecho

const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const BASE_ID = 'appbK09V4X3pPIai3';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const { patientId, date, exId, done } = req.body;

    // Buscar si ya existe el registro de "hecho" para este ejercicio+paciente+fecha
    const searchUrl = `https://api.airtable.com/v0/${BASE_ID}/EJERCICIOS_HECHOS?filterByFormula=AND({PacienteID}="${patientId}",{Fecha}="${date}",{EjercicioID}="${exId}")`;

    const searchRes = await fetch(searchUrl, {
      headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` }
    });

    if (!searchRes.ok) {
      // Tabla no creada aún, simplemente OK
      return res.status(200).json({ ok: true });
    }

    const existing = await searchRes.json();

    if (existing.records && existing.records.length > 0) {
      // Actualizar registro existente
      const recordId = existing.records[0].id;
      await fetch(`https://api.airtable.com/v0/${BASE_ID}/EJERCICIOS_HECHOS/${recordId}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${AIRTABLE_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ fields: { Hecho: done } })
      });
    } else if (done) {
      // Crear nuevo registro
      await fetch(`https://api.airtable.com/v0/${BASE_ID}/EJERCICIOS_HECHOS`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${AIRTABLE_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          fields: {
            PacienteID: patientId,
            Fecha: date,
            EjercicioID: String(exId),
            Hecho: true,
            FechaHecho: new Date().toISOString()
          }
        })
      });
    }

    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error('Done error:', err);
    return res.status(200).json({ ok: true }); // No bloqueamos al usuario
  }
}
