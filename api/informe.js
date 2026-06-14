export const config = { runtime: 'nodejs', maxDuration: 60 };

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const FISIO_PASSWORD = process.env.FISIO_PASSWORD || 'FISIO365App';
const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const BASE_ID = 'appsrGnHpFt8sVD5A';
const INFORMES_TABLE = 'tblwvWQxXNJPdR0Iv';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET - listar informes de un paciente (para app paciente y panel)
  if (req.method === 'GET') {
    const pacienteId = req.query.pacienteId || '';
    try {
      const filter = pacienteId ? `&filterByFormula=${encodeURIComponent(`{PacienteId}="${pacienteId}"`)}` : '';
      const r = await fetch(
        `https://api.airtable.com/v0/${BASE_ID}/${INFORMES_TABLE}?fields[]=PacienteId&fields[]=PacienteNombre&fields[]=FisioNombre&fields[]=Fecha&fields[]=Informe&fields[]=Protocolo${filter}&sort[0][field]=Fecha&sort[0][direction]=desc`,
        { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } }
      );
      const data = await r.json();
      const informes = (data.records || []).map(rec => ({
        id: rec.id,
        pacienteId:     rec.fields['PacienteId'] || '',
        pacienteNombre: rec.fields['PacienteNombre'] || '',
        fisioNombre:    rec.fields['FisioNombre'] || '',
        fecha:          rec.fields['Fecha'] || '',
        informe:        rec.fields['Informe'] || '',
        protocolo:      rec.fields['Protocolo'] || '',
      }));
      return res.status(200).json({ ok: true, informes });
    } catch(e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  // POST - generar informe IA y guardar en Airtable
  if (req.method === 'POST') {
    const { pwd, pacienteId, pacienteNombre, fisioNombre, fisioColegiado, datos, prompt: customPrompt } = req.body || {};

    if ((pwd || '').trim() !== (FISIO_PASSWORD || '').trim())
      return res.status(401).json({ ok: false, error: 'Contraseña incorrecta' });

    try {
      const d = datos || {};
      const tipo = d.tipo || 'hernia';
      const fecha = new Date().toLocaleDateString('es-ES');
      const hayFlags = (d.flags && d.flags.length) || (d.banderas && d.banderas.length);
      const fa = arr => (!arr || !arr.length) ? '-' : arr.join(', ');
      const colNum = fisioColegiado ? ` | Colegiado nº ${fisioColegiado}` : '';
      const cabecera = `Fisioterapeuta: ${fisioNombre||'-'}${colNum} | Fecha: ${fecha}\nPaciente: ${pacienteNombre||'-'} | Edad: ${d.edad||'-'} | Actividad: ${d.act||'-'}`;
      const estructura = `\nRedacta con EXACTAMENTE estas secciones:\nMOTIVO DE CONSULTA\nEXPLORACIÓN Y HALLAZGOS\nDIAGNÓSTICO FISIOTERAPÉUTICO\nOBJETIVOS TERAPÉUTICOS${hayFlags?'\nALERTAS':''}\nNO incluyas otras secciones ni markdown.`;
      const datosCompactos = Object.entries(d)
        .filter(([k,v])=>v&&v!=='-'&&!(Array.isArray(v)&&!v.length))
        .map(([k,v])=>`${k}: ${Array.isArray(v)?v.join(', '):String(v).slice(0,300)}`)
        .join('\n').slice(0,4000);

      const prompt = customPrompt || `Eres fisioterapeuta experto. Informe de valoración de ${tipo.toUpperCase()}. Sin markdown, párrafos claros, términos técnicos explicados entre paréntesis.\n${cabecera}\nDATOS:\n${datosCompactos}\n${hayFlags?'RED FLAGS: '+fa(d.flags||d.banderas):''}\n${estructura}`;

      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 3000, messages: [{ role: 'user', content: prompt }] })
      });

      const aiData = await r.json();
      const informe = aiData.content?.[0]?.text || '';
      if (!informe) return res.status(500).json({ ok: false, error: aiData.error?.message || 'Error Anthropic' });

      // Guardar automáticamente en Airtable
      let savedId = null;
      try {
        const atRes = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${INFORMES_TABLE}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ records: [{ fields: {
            PacienteId:     pacienteId || '',
            PacienteNombre: (pacienteNombre || '').toUpperCase(),
            FisioNombre:    fisioNombre || '',
            Fecha:          fecha,
            Protocolo:      tipo,
            Informe:        informe
          }}]})
        });
        const atData = await atRes.json();
        savedId = atData.records?.[0]?.id || null;
      } catch(e) {
        console.error('Error guardando en Airtable:', e.message);
      }

      return res.status(200).json({ ok: true, informe, savedId });
    } catch(e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  return res.status(405).json({ ok: false, error: 'Method not allowed' });
}
