const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const FISIO_PASSWORD = process.env.FISIO_PASSWORD || 'fisio2024';
const BASE_ID = 'appsrGnHpFt8sVD5A';
const TABLE_ID = 'tbloqn3ts872ueJSE';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { pwd } = req.query;
  if (pwd !== FISIO_PASSWORD) return res.status(401).json({ ok: false, error: 'No autorizado' });

  try {
    let allRecords = [];
    let offset = null;

    // Bucle de paginación — carga TODOS los ejercicios, no solo los primeros 100
    do {
      const url = `https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}?pageSize=100${offset ? '&offset=' + offset : ''}`;
      const r = await fetch(url, { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } });
      const data = await r.json();
      allRecords = allRecords.concat(data.records || []);
      offset = data.offset || null;
    } while (offset);

    const ejercicios = allRecords.map(rec => ({
      id: rec.id,
      nombre: rec.fields['Nombre'] || rec.fields['Name'] || '—',
      zona: rec.fields['Zona'] || '',
      descripcion: rec.fields['Descripcion'] || '',
      youtubeUrl: rec.fields['YouTubeURL'] || '',
      imagen: rec.fields['Imagenes']?.[0]?.url || '',
      series: rec.fields['Series'] || 3,
      reps: rec.fields['Reps'] || 10,
      duracion: rec.fields['Duracion'] || 0,
      descanso: rec.fields['Descanso'] || 30,
    }));

    return res.status(200).json({ ok: true, ejercicios });
  } catch(e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
