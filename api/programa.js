const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const FISIO_PASSWORD = process.env.FISIO_PASSWORD || 'fisio2024';
const BASE_ID = 'appbK09V4X3pPIai3';
const PLAN_TABLE = 'tblvgE0a4gsrj4Vhp';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { pwd, pacienteId, pacienteNombre, fisioId, ejercicios, mensajeFisio } = req.body;
  if (pwd !== FISIO_PASSWORD) return res.status(401).json({ ok: false, error: 'No autorizado' });
  if (!pacienteId || !ejercicios?.length) return res.status(400).json({ ok: false, error: 'Faltan datos' });

  const today = new Date().toISOString().split('T')[0];

  try {
    const oldRes = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${PLAN_TABLE}?filterByFormula={PacienteID}="${pacienteId}"&fields[]=PacienteID`, {
      headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` }
    });
    const oldData = await oldRes.json();
    if (oldData.records?.length > 0) {
      const ids = oldData.records.map(r => r.id);
      for (let i = 0; i < ids.length; i += 10) {
        const batch = ids.slice(i, i + 10);
        await fetch(`https://api.airtable.com/v0/${BASE_ID}/${PLAN_TABLE}?${batch.map(id=>`records[]=${id}`).join('&')}`, {
          method: 'DELETE', headers: { Authorization: `Be
