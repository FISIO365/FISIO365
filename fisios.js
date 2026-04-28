// api/done.js - Marcar ejercicio como hecho / desmarcar
const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const BASE_ID = 'appbK09V4X3pPIai3';
const HECHOS_TABLE = 'tblSABQ4KLpDUsERy';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { patientId, ejercicioNombre, hecho } = req.body;
  const today = new Date().toISOString().split('T')[0];

  try {
    // Buscar si ya existe registro para hoy
    const searchUrl = `https://api.airtable.com/v0/${BASE_ID}/${HECHOS_TABLE}?filterByFormula=AND({PacienteID}="${patientId}",{EjercicioNombre}="${ejercicioNombre}",{Fecha}="${today}")`;
    const searchRes = await fetch(searchUrl, { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } });
    const searchData = await searchRes.json();

    if (searchData.records && searchData.records.length > 0) {
      // Actualizar existente
      const recordId = searchData.records[0].id;
      await fetch(`https://api.airtable.com/v0/${BASE_ID}/${HECHOS_TABLE}/${recordId}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: { Hecho: hecho } })
      });
    } else {
      // Crear nuevo
      await fetch(`https://api.airtable.com/v0/${BASE_ID}/${HECHOS_TABLE}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ records: [{ fields: { Nombre: `${patientId}-${ejercicioNombre}-${today}`, PacienteID: patientId, EjercicioNombre: ejercicioNombre, Fecha: today, Hecho: hecho } }] })
      });
    }
    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ ok: false });
  }
}
