// api/fisios.js - Lista de fisios
const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const FISIO_PASSWORD = process.env.FISIO_PASSWORD || 'fisio2024';
const BASE_ID = 'appbK09V4X3pPIai3';
const FISIOS_TABLE = 'tbl2mLUrnaKCFTs6g';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { pwd } = req.query;
  if (pwd !== FISIO_PASSWORD) return res.status(401).json({ ok: false, error: 'No autorizado' });

  try {
    const url = `https://api.airtable.com/v0/${BASE_ID}/${FISIOS_TABLE}?fields[]=Name&fields[]=NºColegiado&fields[]=Foto`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } });
    const data = await r.json();
    const fisios = (data.records || []).map(rec => ({
      id: rec.id,
      nombre: rec.fields['Name'] || '',
      colegiado: rec.fields['NºColegiado'] || '',
      foto: rec.fields['Foto']?.[0]?.url || ''
    }));
    return res.status(200).json({ ok: true, fisios });
  } catch(e) {
    return res.status(500).json({ ok: false, error: 'Error interno' });
  }
}
