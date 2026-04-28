// api/done.js - Marcar ejercicio como hecho
const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const BASE_ID = 'appbK09V4X3pPIai3';
const HECHOS_TABLE = 'tblR0pv5GPw2IGGiW';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { patientId, ejercicioId, fecha, hecho } = req.body;
  if (!patientId || !ejercicioId || !fecha) return res.status(400).json({ ok: false });

  try {
    const searchUrl = `https://api.airtable.com/v0/${BASE_ID}/${HECHOS_TABLE}?filterByFormula=AND({PacienteID}="${patientId}",{EjercicioID}="${ejercicioId}",{Fecha}="${fecha}")`;
    const searchRes = await fetch(searchUrl, { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } });
    const searchData = await searchRes.json();

    if (searchData.records?.length > 0) {
      const id = searchData.records[0].id;
      await fetch(`https://api.airtable.com/v0/${BASE_ID}/${HECHOS_TABLE}/${id}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: { Hecho: hecho } })
      });
    } else {
      await fetch(`https://api.airtable.com/v0/${BASE_ID}/${HECHOS_TABLE}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ records: [{ fields: { PacienteID: patientId, EjercicioID: ejercicioId, Fecha: fecha, Hecho: hecho, FechaHecho: new Date().toISOString() } }] })
      });
    }
    return res.status(200).json({ ok: true });
  } catch(e) {
    return res.status(500).json({ ok: false });
  }
}
