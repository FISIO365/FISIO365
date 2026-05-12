// /api/anamnesis.js
const https = require('https');
 
const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const AIRTABLE_BASE = 'appsrGnHpFt8sVD5A';
const AIRTABLE_TABLE = 'tblF4as0orW1b6KIw';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const FISIO_PASSWORD = process.env.FISIO_PASSWORD;
 
function airtableReq(method, path, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: 'api.airtable.com',
      path: `/v0/${AIRTABLE_BASE}${path}`,
      method,
      headers: { 'Authorization': `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' }
    };
    if (bodyStr) opts.headers['Content-Length'] = Buffer.byteLength(bodyStr);
    const req = https.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { resolve({ error: data }); } });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}
 
function llamarClaude(prompt) {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }]
    });
    const opts = {
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr)
      }
    };
    const req = https.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data).content?.[0]?.text || ''); }
        catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}
 
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
 
  if (req.method === 'GET') {
    const { pacienteId, pwd } = req.query;
    if (pwd !== FISIO_PASSWORD) return res.status(401).json({ error: 'No autorizado' });
    try {
      const formula = encodeURIComponent(`{PacienteID}="${pacienteId}"`);
      const data = await airtableReq('GET', `/${AIRTABLE_TABLE}?filterByFormula=${formula}&sort[0][field]=FechaValoracion&sort[0][direction]=desc`);
      return res.json({ ok: true, records: data.records || [] });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }
 
  if (req.method === 'POST') {
    let body = req.body;
    if (!body || typeof body === 'string') {
      try { body = JSON.parse(body || '{}'); } catch(e) { body = {}; }
    }
    const { pwd, pacienteId, pacienteNombre, fisioNombre, datos } = body;
    if (pwd !== FISIO_PASSWORD) return res.status(401).json({ error: 'No autorizado' });
    if (!pacienteId || !datos) return res.status(400).json({ error: 'Faltan datos' });
 
    const prompt = construirPrompt(pacienteNombre, fisioNombre, datos);
 
    let informe = '';
    try {
      informe = await llamarClaude(prompt);
    } catch(e) {
      informe = 'Error al generar el informe. Por favor, contacte con su fisioterapeuta.';
    }
 
    try {
      const record = await airtableReq('POST', `/${AIRTABLE_TABLE}`, {
        records: [{
          fields: {
            PacienteID: pacienteId,
            PacienteNombre: pacienteNombre || '',
            FisioNombre: fisioNombre || '',
            FechaValoracion: new Date().toISOString().split('T')[0],
            DatosJSON: JSON.stringify(datos),
            InformeGenerado: informe
          }
        }]
      });
      return res.json({ ok: true, informe, recordId: record.records?.[0]?.id });
    } catch(e) {
      return res.json({ ok: true, informe, warning: 'No se pudo guardar en Airtable: ' + e.message });
    }
  }
 
  return res.status(405).json({ error: 'Método no permitido' });
};
 
function fa(arr) {
  if (!arr || !Array.isArray(arr) || arr.length === 0) return '-';
  return arr.join(', ');
}
 
function construirPrompt(pacienteNombre, fisioNombre, d) {
  return `Eres un fisioterapeuta experto redactando un informe de valoración para el paciente ${pacienteNombre || 'el paciente'}.
 
El informe debe ser:
- Completamente PROFESIONAL y clínico, usando terminología fisioterapéutica correcta
- Pero EXPLICADO para el paciente: cada término técnico debe ir acompañado de una breve explicación entre paréntesis
- Redactado en tercera persona clínica
- En español
- Sin asteriscos ni markdown, solo texto limpio con secciones en MAYÚSCULAS
 
Fisioterapeuta: ${fisioNombre || '-'}
Fecha: ${new Date().toLocaleDateString('es-ES')}
 
DATOS:
Paciente: ${pacienteNombre || '-'} | Edad: ${d.edad || '-'} | Profesión: ${d.profesion || '-'} | Actividad: ${d.actividadFisica || '-'}
Diagnóstico médico: ${d.diagnosticoMedico || '-'}
Pruebas imagen: RM: ${d.rm || '-'}, TAC: ${d.tac || '-'}, RX: ${d.rx || '-'}
 
MOTIVO DE CONSULTA:
Dolor principal: ${d.dolorPrincipal || '-'}
Inicio: ${d.inicioSintomas || '-'} | Mecanismo: ${d.mecanismoAparicion || '-'}
Evolución: ${d.evolucion || '-'}
EVA actual: ${d.evaActual || '-'}/10, máxima: ${d.evaMaxima || '-'}/10, mínima: ${d.evaMinima || '-'}/10
Irradiación: ${d.irradiacion || '-'} | Hormigueo: ${d.hormigueo || '-'} | Debilidad: ${d.debilidad || '-'}
Limitaciones: ${d.limitaciones || '-'}
Expectativas: ${d.expectativas || '-'}
 
COMPORTAMIENTO:
Empeora con: ${fa(d.empeoraConArray)}
Mejora con: ${fa(d.mejoraConArray)}
Patrón mecánico: ${fa(d.patronMecanico)}
Factores psicosociales: ${fa(d.factoresPsicosociales)}
 
OBSERVACIÓN:
Postura: ${fa(d.postura)} | Marcha: ${fa(d.marcha)} | Control motor: ${fa(d.controlMotor)}
 
CLASIFICACIÓN:
Presentación: ${fa(d.presentacionDominante)}
 
DIAGNÓSTICO FISIOTERAPÉUTICO:
${d.diagnosticoFisio || '-'}
 
PLAN:
Terapia manual: ${d.terapiaManual || '-'}
Ejercicio: ${d.ejercicioTerapeutico || '-'}
Neurodinamia: ${d.neurodinamia || '-'}
Educación: ${d.educacion || '-'}
Tecnologías: ${d.tecnologias || '-'}
 
Objetivos corto plazo: ${d.objetivosCorto || '-'}
Objetivos medio plazo: ${d.objetivosMedio || '-'}
Objetivos largo plazo: ${d.objetivosLargo || '-'}
 
Conclusión: ${d.conclusion || '-'}
 
Redacta el informe completo con estas secciones en MAYÚSCULAS como título:
 
PRESENTACIÓN DEL CASO
HALLAZGOS DE LA EXPLORACIÓN FÍSICA
VALORACIÓN NEUROLÓGICA
DIAGNÓSTICO FISIOTERAPÉUTICO
OBJETIVOS DEL TRATAMIENTO
PLAN DE TRATAMIENTO
RECOMENDACIONES PARA EL PACIENTE
PRONÓSTICO
 
Usa tono profesional pero empático. Explica los términos técnicos entre paréntesis. Redacta en párrafos, sin listas ni guiones.`;
}
