export const config = { runtime: 'edge' };

const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const FISIO_PASSWORD = process.env.FISIO_PASSWORD || 'fisio2024';
const BASE_ID = 'appsrGnHpFt8sVD5A';
const PACIENTES_TABLE = 'tbldBVgClS4HY2mOJ';
const ANAMNESIS_TABLE = 'tblF4as0orW1b6KIw';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

export default async function handler(req) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const action = url.searchParams.get('action');
  const queryPwd = url.searchParams.get('pwd') || '';

  let body = {};
  if (req.method === 'POST') {
    try {
      const text = await req.text();
      body = text ? JSON.parse(text) : {};
    } catch(e) {
      body = {};
    }
  }

  const pwd = (body.pwd || queryPwd || '').trim();
  const expected = (FISIO_PASSWORD || '').trim();

  if (pwd !== expected) {
    return new Response(JSON.stringify({ ok: false, error: 'Contraseña incorrecta' }), { status: 401, headers: corsHeaders });
  }

  // ── GENERAR INFORME ──
  if (action === 'informe' && req.method === 'POST') {
    try {
      const { pacienteId, pacienteNombre, fisioNombre, datos } = body;
      const d = datos || {};
      const fa = arr => (!arr || !arr.length) ? '-' : arr.join(', ');

      const prompt = `Eres un fisioterapeuta experto redactando un informe de valoración para el paciente ${pacienteNombre || 'el paciente'}.
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

      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 4000,
          messages: [{ role: 'user', content: prompt }]
        })
      });

      const data = await r.json();
      const informe = data.content?.[0]?.text || '';

      if (!informe) {
        const errorMsg = data.error?.message || data.error?.type || JSON.stringify(data).substring(0, 300);
        return new Response(JSON.stringify({ ok: false, error: 'Anthropic: ' + errorMsg }), { status: 500, headers: corsHeaders });
      }

      try {
        await fetch(`https://api.airtable.com/v0/${BASE_ID}/${ANAMNESIS_TABLE}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            records: [{ fields: {
              PacienteID: pacienteId || '',
              PacienteNombre: pacienteNombre || '',
              FisioNombre: fisioNombre || '',
              FechaValoracion: new Date().toISOString().split('T')[0],
              DatosJSON: JSON.stringify(datos),
              InformeGenerado: informe
            }}]
          })
        });
      } catch(e) {}

      return new Response(JSON.stringify({ ok: true, informe }), { headers: corsHeaders });

    } catch(e) {
      return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: corsHeaders });
    }
  }

  // ── PACIENTES GET ──
  if (req.method === 'GET') {
    try {
      let allRecords = [], offset = null;
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
      return new Response(JSON.stringify({ ok: true, pacientes }), { headers: corsHeaders });
    } catch(e) {
      return new Response(JSON.stringify({ ok: false, error: 'Error interno: ' + e.message }), { status: 500, headers: corsHeaders });
    }
  }

  // ── PACIENTES POST ──
  if (req.method === 'POST') {
    const { nombre, email, telefono } = body;
    if (!nombre || !email) {
      return new Response(JSON.stringify({ ok: false, error: 'Nombre y email son obligatorios' }), { status: 400, headers: corsHeaders });
    }
    const pin = String(Math.floor(1000 + Math.random() * 9000));
    try {
      const r = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${PACIENTES_TABLE}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ records: [{ fields: { 'FULL NAME': nombre, EMAIL: email, WHATSAPP: telefono || '', PIN: pin } }] })
      });
      const data = await r.json();
      const rec = data.records?.[0];
      return new Response(JSON.stringify({ ok: true, paciente: { id: rec.id, nombre, email, pin } }), { headers: corsHeaders });
    } catch(e) {
      return new Response(JSON.stringify({ ok: false, error: 'Error interno: ' + e.message }), { status: 500, headers: corsHeaders });
    }
  }

  return new Response(JSON.stringify({ error: 'Método no permitido' }), { status: 405, headers: corsHeaders });
}
