const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const FISIO_PASSWORD = process.env.FISIO_PASSWORD || 'fisio2024';
const BASE_ID = 'appsrGnHpFt8sVD5A';
const PACIENTES_TABLE = 'tbldBVgClS4HY2mOJ';
const ANAMNESIS_TABLE = 'tblF4as0orW1b6KIw';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const https = require('https');

function airtableReq(method, path, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: 'api.airtable.com',
      path: `/v0/${BASE_ID}${path}`,
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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  let body = req.body;
  if (!body || typeof body === 'string') {
    try { body = JSON.parse(body || '{}'); } catch(e) { body = {}; }
  }

  // Obtener pwd de query o body
  const pwd = (req.query.pwd || body.pwd || '').trim();
  const expectedPwd = (FISIO_PASSWORD || '').trim();

  if (pwd !== expectedPwd) {
    return res.status(401).json({ ok: false, error: 'Contraseña incorrecta' });
  }

  // ── ANAMNESIS ──
  if (req.query.action === 'anamnesis' || body.action === 'anamnesis') {
    if (req.method === 'GET') {
      try {
        const { pacienteId } = req.query;
        const formula = encodeURIComponent(`{PacienteID}="${pacienteId}"`);
        const data = await airtableReq('GET', `/${ANAMNESIS_TABLE}?filterByFormula=${formula}&sort[0][field]=FechaValoracion&sort[0][direction]=desc`);
        return res.json({ ok: true, records: data.records || [] });
      } catch(e) {
        return res.status(500).json({ error: e.message });
      }
    }
    if (req.method === 'POST') {
      const { pacienteId, pacienteNombre, fisioNombre, datos } = body;
      if (!pacienteId || !datos) return res.status(400).json({ error: 'Faltan datos' });
      const prompt = construirPrompt(pacienteNombre, fisioNombre, datos);
      let informe = '';
      try { informe = await llamarClaude(prompt); }
      catch(e) { informe = 'Error al generar el informe.'; }
      try {
        const record = await airtableReq('POST', `/${ANAMNESIS_TABLE}`, {
          records: [{ fields: {
            PacienteID: pacienteId,
            PacienteNombre: pacienteNombre || '',
            FisioNombre: fisioNombre || '',
            FechaValoracion: new Date().toISOString().split('T')[0],
            DatosJSON: JSON.stringify(datos),
            InformeGenerado: informe
          }}]
        });
        return res.json({ ok: true, informe, recordId: record.records?.[0]?.id });
      } catch(e) {
        return res.json({ ok: true, informe, warning: 'No se pudo guardar: ' + e.message });
      }
    }
  }

  // ── PACIENTES GET ──
  if (req.method === 'GET') {
    try {
      let allRecords = [], offset = null;
      do {
        const pageUrl = `/${PACIENTES_TABLE}?fields[]=FULL NAME&fields[]=EMAIL&fields[]=PIN&fields[]=WHATSAPP&sort[0][field]=FULL NAME&sort[0][direction]=asc&pageSize=100${offset ? '&offset=' + offset : ''}`;
        const pageData = await airtableReq('GET', pageUrl);
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

  // ── PACIENTES POST ──
  if (req.method === 'POST') {
    const { nombre, email, telefono } = body;
    if (!nombre || !email) return res.status(400).json({ ok: false, error: 'Nombre y email son obligatorios' });
    const pin = String(Math.floor(1000 + Math.random() * 9000));
    try {
      const r = await airtableReq('POST', `/${PACIENTES_TABLE}`, {
        records: [{ fields: { 'FULL NAME': nombre, EMAIL: email, WHATSAPP: telefono || '', PIN: pin } }]
      });
      const rec = r.records?.[0];
      return res.status(200).json({ ok: true, paciente: { id: rec.id, nombre, email, pin } });
    } catch(e) {
      return res.status(500).json({ ok: false, error: 'Error interno' });
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

El informe debe ser completamente PROFESIONAL usando terminología fisioterapéutica correcta, pero EXPLICADO para el paciente con términos técnicos entre paréntesis. En español, sin markdown, secciones en MAYÚSCULAS.

Fisioterapeuta: ${fisioNombre || '-'} | Fecha: ${new Date().toLocaleDateString('es-ES')}
Paciente: ${pacienteNombre || '-'} | Edad: ${d.edad || '-'} | Profesión: ${d.profesion || '-'} | Actividad: ${d.actividadFisica || '-'}
Diagnóstico médico: ${d.diagnosticoMedico || '-'}
RM: ${d.rm || '-'} | TAC: ${d.tac || '-'} | RX: ${d.rx || '-'}
Dolor principal: ${d.dolorPrincipal || '-'}
Inicio: ${d.inicioSintomas || '-'} | Mecanismo: ${d.mecanismoAparicion || '-'}
Evolución: ${d.evolucion || '-'}
EVA actual: ${d.evaActual || '-'}/10
Irradiación: ${d.irradiacion || '-'} | Hormigueo: ${d.hormigueo || '-'} | Debilidad: ${d.debilidad || '-'}
Limitaciones: ${d.limitaciones || '-'} | Expectativas: ${d.expectativas || '-'}
Empeora con: ${fa(d.empeoraConArray)} | Mejora con: ${fa(d.mejoraConArray)}
Patrón mecánico: ${fa(d.patronMecanico)} | Psicosocial: ${fa(d.factoresPsicosociales)}
Postura: ${fa(d.postura)} | Marcha: ${fa(d.marcha)} | Control motor: ${fa(d.controlMotor)}
Presentación: ${fa(d.presentacionDominante)}
Diagnóstico fisioterapéutico: ${d.diagnosticoFisio || '-'}
Plan: ${d.terapiaManual || '-'}
Objetivos: corto: ${d.objetivosCorto || '-'} | medio: ${d.objetivosMedio || '-'} | largo: ${d.objetivosLargo || '-'}
Conclusión: ${d.conclusion || '-'}

Redacta el informe con estas secciones en MAYÚSCULAS:
PRESENTACIÓN DEL CASO
HALLAZGOS DE LA EXPLORACIÓN FÍSICA
VALORACIÓN NEUROLÓGICA
DIAGNÓSTICO FISIOTERAPÉUTICO
OBJETIVOS DEL TRATAMIENTO
PLAN DE TRATAMIENTO
RECOMENDACIONES PARA EL PACIENTE
PRONÓSTICO

Tono profesional pero empático. Explica términos técnicos entre paréntesis. En párrafos, sin listas.`;
}
