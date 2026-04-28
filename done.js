// api/ejercicios.js - Devuelve la biblioteca de ejercicios
const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const FISIO_PASSWORD = process.env.FISIO_PASSWORD || 'fisio2024';
const BASE_ID = 'appbK09V4X3pPIai3';
const TABLE_ID = 'tbl5VIIPMgXzVhG8r';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { pwd } = req.query;
  if (pwd !== FISIO_PASSWORD) return res.status(401).json({ ok: false, error: 'No autorizado' });

  try {
    const url = `https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}?fields[]=Nombre&fields[]=Zona&fields[]=Descripcion&fields[]=YouTubeURL&fields[]=Series&fields[]=Reps&fields[]=Duracion&fields[]=Descanso&sort[0][field]=Nombre&sort[0][direction]=asc&pageSize=100`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } });
    const data = await r.json();
    const ejercicios = (data.records || []).map(rec => ({
      id: rec.id,
      nombre: rec.fields['Nombre'] || rec.fields['Name'] || '—',
      zona: rec.fields['Zona'] || '',
      descripcion: rec.fields['Descripcion'] || '',
      youtubeUrl: rec.fields['YouTubeURL'] || '',
      series: rec.fields['Series'] || 3,
      reps: rec.fields['Reps'] || 10,
      duracion: rec.fields['Duracion'] || 0,
      descanso: rec.fields['Descanso'] || 30,
    }));
    return res.status(200).json({ ok: true, ejercicios });
  } catch(e) {
    return res.status(500).json({ ok: false, error: 'Error interno' });
  }
}
