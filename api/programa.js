const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const FISIO_PASSWORD = process.env.FISIO_PASSWORD || 'fisio2024';
const BASE_ID = 'appsrGnHpFt8sVD5A';
const PLAN_TABLE = 'tblvgE0a4gsrj4Vhp';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    const { pwd, pacienteId } = req.query;
    if (pwd !== FISIO_PASSWORD) return res.status(401).json({ ok: false, error: 'No autorizado' });
    if (!pacienteId) return res.status(400).json({ ok: false, error: 'Falta pacienteId' });

    try {
      const formula = encodeURIComponent(`{PacienteID}="${pacienteId}"`);
      const url = `https://api.airtable.com/v0/${BASE_ID}/${PLAN_TABLE}?filterByFormula=${formula}&fields[]=Ejercicios&fields[]=MensajeFisio&fields[]=FechaAsignacion&sort[0][field]=FechaAsignacion&sort[0][direction]=desc&pageSize=1`;
      const r = await fetch(url, { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } });
      const data = await r.json();

      if (!data.records?.length) {
        return res.status(200).json({ ok: true, ejercicios: [], mensaje: '' });
      }

      const rec = data.records[0];
      let ejercicios = [];
      try { ejercicios = JSON.parse(rec.fields['Ejercicios'] || '[]'); } catch(e) { ejercicios = []; }

      return res.status(200).json({
        ok: true,
        ejercicios,
        mensaje: rec.fields['MensajeFisio'] || '',
        fecha: rec.fields['FechaAsignacion'] || ''
      });
    } catch(e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  if (req.method !== 'POST') return res.status(405).end();

  const { pwd, pacienteId, pacienteNombre, fisioId, ejercicios, mensajeFisio } = req.body;
  if (pwd !== FISIO_PASSWORD) return res.status(401).json({ ok: false, error: 'No autorizado' });
  if (!pacienteId || !ejercicios?.length) return res.status(400).json({ ok: false, error: 'Faltan datos' });

  const today = new Date().toISOString().split('T')[0];
  try {
    const formula = encodeURIComponent(`{PacienteID}="${pacienteId}"`);
    const oldRes = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${PLAN_TABLE}?filterByFormula=${formula}&fields[]=PacienteID`, {
      headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` }
    });
    const oldData = await oldRes.json();
    if (oldData.records?.length > 0) {
      const ids = oldData.records.map(r => r.id);
      for (let i = 0; i < ids.length; i += 10) {
        const batch = ids.slice(i, i + 10);
        await fetch(`https://api.airtable.com/v0/${BASE_ID}/${PLAN_TABLE}?${batch.map(id => `records[]=${id}`).join('&')}`, {
          method: 'DELETE', headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` }
        });
      }
    }

    const r = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${PLAN_TABLE}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        records: [{ fields: {
          Nombre: `${pacienteNombre} - ${today}`,
          PacienteID: pacienteId,
          PacienteNombre: pacienteNombre,
          FisioID: fisioId || '',
          Ejercicios: JSON.stringify(ejercicios),
          FechaAsignacion: today,
          MensajeFisio: mensajeFisio || ''
        }}]
      })
    });
    const d = await r.json();
    if (d.error) return res.status(500).json({ ok: false, error: d.error.message });

    try {
      const pacRes = await fetch(`https://api.airtable.com/v0/${BASE_ID}/tbldBVgClS4HY2mOJ/${pacienteId}?fields[]=PushSubscription`, {
        headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` }
      });
      const pacData = await pacRes.json();
      const pushSub = pacData.fields?.['PushSubscription'];
      if (pushSub) {
        await fetch('https://fisio365.vercel.app/api/notificar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            subscription: JSON.parse(pushSub),
            title: 'FISIO365',
            message: 'Tu fisio ha actualizado tu programa de ejercicios 💪'
          })
        });
      }
    } catch(e) {}

    return res.status(200).json({ ok: true, creados: ejercicios.length });
  } catch(e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
