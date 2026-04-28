const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const FISIO_PASSWORD = process.env.FISIO_PASSWORD || 'fisio2024';
const BASE_ID = 'appbK09V4X3pPIai3';
const PACIENTES_TABLE = 'tbldBVgClS4HY2mOJ';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const pwd = req.method === 'GET' ? req.query.pwd : req.body?.pwd;
  if (pwd !== FISIO_PASSWORD) return res.status(401).json({ ok: false, error: 'Contraseña incorrecta' });

  if (req.method === 'GET') {
    try {
      let allRecords = [];
      let offset = null;
      do {
        const pageUrl = `https://api.airtable.com/v0/${BASE_ID}/${PACIENTES_TABLE}?fields[]=FULL NAME&fields[]=EMAIL&fields[]=PIN&fields[]=WHATSAPP&sort[0][field]=FULL NAME&sort[0][direction]=asc&pageSize=100${offset ? '&offset=' + offset : ''}`;
        const pageRes = await fetch(pageUrl, { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } });
        const pageData = await pageRes.json();
        allRecords = allRecords.concat(pageData.records || []);
        offset = pageData.offset;
      } while (offset);

      const pacientes = allRecords.map(rec => ({
        id: rec.id,
        nombre: rec.fields['FULL NAME'] || '—',
        email: rec.fields['EMAIL'] || '',
        pin: rec.fields['PIN'] || '',
        telefono: rec.fields['WHATSAPP'] || ''
      }));
      return res.status(200).json({ ok: true, pacientes });
    } catch(e) {
      return res.status(500).json({ ok: false, error: 'Error interno' });
    }
  }

  if (req.method === 'POST') {
    const { nombre, email, telefono } = req.body;
    if (!nombre || !email) return res.status(400).json({ ok: false, error: 'Nombre y email son obligatorios' });
    const pin = String(Math.floor(1000 + Math.random() * 9000));
    try {
      const r = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${PACIENTES_TABLE}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ records: [{ fields: { 'FULL NAME': nombre, EMAIL: email, WHATSAPP: telefono || '', PIN: pin } }] })
      });
      const data = await r.json();
      const rec = data.records?.[0];
      return res.status(200).json({ ok: true, paciente: { id: rec.id, nombre, email, pin } });
    } catch(e) {
      return res.status(500).json({ ok: false, error: 'Error interno' });
    }
  }
}
