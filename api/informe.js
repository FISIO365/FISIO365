export const config = { runtime: 'nodejs', maxDuration: 60 };

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const FISIO_PASSWORD = process.env.FISIO_PASSWORD || 'FISIO365App';
const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const BASE_ID = 'appsrGnHpFt8sVD5A';
const INFORMES_TABLE = 'tblwvWQxXNJPdR0Iv';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  const { pwd, pacienteId, pacienteNombre, fisioNombre, fisioColegiado, datos, prompt: customPrompt } = req.body || {};

  if ((pwd || '').trim() !== (FISIO_PASSWORD || '').trim()) {
    return res.status(401).json({ ok: false, error: 'Contraseña incorrecta' });
  }

  try {
    const d = datos || {};
    const tipo = d.tipo || 'hernia';
    const fecha = new Date().toLocaleDateString('es-ES');
    const hayFlags = (d.flags && d.flags.length) || (d.banderas && d.banderas.length);
    const colNum = fisioColegiado ? ` | Colegiado nº ${fisioColegiado}` : '';
    const fa = arr => (!arr || !arr.length) ? '-' : arr.join(', ');
    const cabecera = `Fisioterapeuta: ${fisioNombre||'-'}${colNum} | Fecha: ${fecha}\nPaciente: ${pacienteNombre||'-'} | Edad: ${d.edad||'-'} | Actividad: ${d.act||'-'}`;
    const estructura = `\nRedacta con EXACTAMENTE estas secciones:\nMOTIVO DE CONSULTA\nEXPLORACIÓN Y HALLAZGOS\nDIAGNÓSTICO FISIOTERAPÉUTICO\nOBJETIVOS TERAPÉUTICOS${hayFlags?'\nALERTAS':''}\nNO incluyas otras secciones.`;
    const datosCompactos = Object.entries(d)
      .filter(([k,v])=>v&&v!=='-'&&!(Array.isArray(v)&&!v.length))
      .map(([k,v])=>`${k}: ${Array.isArray(v)?v.join(', '):String(v).slice(0,300)}`)
      .join('\n').slice(0,4000);

    const prompt = customPrompt || `Eres fisioterapeuta experto. Informe de valoración de ${tipo.toUpperCase()}. Sin markdown, párrafos, términos técnicos explicados entre paréntesis.\n${cabecera}\nDATOS:\n${datosCompactos}\n${hayFlags?'RED FLAGS: '+fa(d.flags||d.banderas):''}\n${estructura}`;

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 3000, messages: [{ role: 'user', content: prompt }] })
    });

    const data = await r.json();
    const informe = data.content?.[0]?.text || '';
    if (!informe) return res.status(500).json({ ok: false, error: data.error?.message || 'Error Anthropic' });

    // Guardar automáticamente en Airtable
    let savedId = null;
    try {
      const atRes = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${INFORMES_TABLE}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ records: [{ fields: {
          fldDR9XqkJ9oA3WK0: pacienteId || '',
          fldqoUgXtf81ROqMy: (pacienteNombre || '').toUpperCase(),
          fld3YeK9QbDKjdSAd: fisioNombre || '',
          fldHXAL8FC00biu1X: fecha,
          fldy5HGlff56RYrOa: tipo,
          fldL5BxsNuITe2He9: informe
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
