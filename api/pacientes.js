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
    } catch(e) { body = {}; }
  }

  const pwd = (body.pwd || queryPwd || '').trim();
  const expected = (FISIO_PASSWORD || '').trim();

  if (pwd !== expected) {
    return new Response(JSON.stringify({ ok: false, error: 'Contraseña incorrecta' }), { status: 401, headers: corsHeaders });
  }

  if (action === 'informe' && req.method === 'POST') {
    try {
      const { pacienteId, pacienteNombre, fisioNombre, datos } = body;
      const d = datos || {};
      const fa = arr => (!arr || !arr.length) ? null : arr.join(', ');

      const lines = [
        'Eres un fisioterapeuta experto. Redacta un informe de valoración profesional.',
        'Interpreta los tests clínicamente y correlaciona hallazgos. Identifica patrón radicular (L4/L5/S1) si existe.',
        'En español, sin markdown, secciones en MAYÚSCULAS, en párrafos sin listas.',
        '',
        `Fisioterapeuta: ${fisioNombre||'-'} | Fecha: ${new Date().toLocaleDateString('es-ES')}`,
        `Paciente: ${pacienteNombre||'-'} | Edad: ${d.edad||'-'} | Profesión: ${d.profesion||'-'}`,
        d.diagnosticoMedico ? `Diagnóstico médico: ${d.diagnosticoMedico}` : '',
        d.rm ? `RM: ${d.rm}` : '',
        d.dolorPrincipal ? `Dolor: ${d.dolorPrincipal}` : '',
        d.inicioSintomas ? `Inicio: ${d.inicioSintomas}` : '',
        d.evolucion ? `Evolución: ${d.evolucion}` : '',
        `EVA: ${d.evaActual||'-'}/10`,
        d.irradiacion ? `Irradiación: ${d.irradiacion}` : '',
        d.hormigueo ? `Hormigueo: ${d.hormigueo}` : '',
        d.debilidad ? `Debilidad: ${d.debilidad}` : '',
        d.limitaciones ? `Limitaciones: ${d.limitaciones}` : '',
        fa(d.banderas) ? `BANDERAS ROJAS: ${fa(d.banderas)}` : '',
        fa(d.empeoraConArray) ? `Empeora: ${fa(d.empeoraConArray)}` : '',
        fa(d.mejoraConArray) ? `Mejora: ${fa(d.mejoraConArray)}` : '',
        fa(d.patronMecanico) ? `Patrón: ${fa(d.patronMecanico)}` : '',
        fa(d.factoresPsicosociales) ? `Psicosocial: ${fa(d.factoresPsicosociales)}` : '',
        fa(d.postura) ? `Postura: ${fa(d.postura)}` : '',
        fa(d.marcha) ? `Marcha: ${fa(d.marcha)}` : '',
        fa(d.controlMotor) ? `Control motor: ${fa(d.controlMotor)}` : '',
        d.hipHinge ? `Hip hinge: ${d.hipHinge}` : '',
        (d.thomasD && d.thomasD!=='-') ? `Thomas D/I: ${d.thomasD}/${d.thomasI||'-'}` : '',
        (d.marchaTalones && d.marchaTalones!=='-') ? `Marcha talones: ${d.marchaTalones}` : '',
        (d.marchaPuntillas && d.marchaPuntillas!=='-') ? `Marcha puntillas: ${d.marchaPuntillas}` : '',
        ...[['L4',d.sensL4D,d.sensL4I],['L5',d.sensL5D,d.sensL5I],['S1',d.sensS1D,d.sensS1I]]
          .filter(([r,dd,ii])=>(dd&&dd!=='Normal'&&dd!=='-')||(ii&&ii!=='Normal'&&ii!=='-'))
          .map(([r,dd,ii])=>`Sensibilidad ${r}: D=${dd} I=${ii}`),
        (d.rotulD && d.rotulD!=='Normal' && d.rotulD!=='-') ? `Rotuliano D: ${d.rotulD}` : '',
        (d.rotulI && d.rotulI!=='Normal' && d.rotulI!=='-') ? `Rotuliano I: ${d.rotulI}` : '',
        (d.aquilD && d.aquilD!=='Normal' && d.aquilD!=='-') ? `Aquíleo D: ${d.aquilD}` : '',
        (d.aquilI && d.aquilI!=='Normal' && d.aquilI!=='-') ? `Aquíleo I: ${d.aquilI}` : '',
        (d.isquioD && d.isquioD!=='Normal' && d.isquioD!=='-') ? `Isquiotibial D: ${d.isquioD}` : '',
        ...[['L4 dorsiflexión',d.fuerzaL4D,d.fuerzaL4I],['L5 ext hallux',d.fuerzaL5halluxD,d.fuerzaL5halluxI],
            ['L5 abd cadera',d.fuerzaL5abdD,d.fuerzaL5abdI],['S1 flex plantar',d.fuerzaS1D,d.fuerzaS1I]]
          .filter(([m,dd,ii])=>(dd&&dd!=='5'&&dd!=='-')||(ii&&ii!=='5'&&ii!=='-'))
          .map(([m,dd,ii])=>`Fuerza ${m}: D=${dd}/5 I=${ii}/5`),
        (d.lasegueD && d.lasegueD!=='-') ? `Lasègue D: ${d.lasegueD}` : '',
        (d.lasegueI && d.lasegueI!=='-') ? `Lasègue I: ${d.lasegueI}` : '',
        (d.bragardD && d.bragardD!=='-') ? `Bragard D: ${d.bragardD}` : '',
        (d.slumpD && d.slumpD!=='-') ? `Slump: ${d.slumpD}` : '',
        (d.lasCruzD && d.lasCruzD!=='-') ? `Lasègue cruzado D: ${d.lasCruzD}` : '',
        (d.gaenslenD && d.gaenslenD!=='-') ? `Gaenslen D/I: ${d.gaenslenD}/${d.gaenslenI||'-'}` : '',
        (d.mennellD && d.mennellD!=='-') ? `Mennell D/I: ${d.mennellD}/${d.mennellI||'-'}` : '',
        (d.yeomanD && d.yeomanD!=='-') ? `Yeoman D/I: ${d.yeomanD}/${d.yeomanI||'-'}` : '',
        (d.comprSID && d.comprSID!=='-') ? `Compresión SI D/I: ${d.comprSID}/${d.comprSII||'-'}` : '',
        (d.distrSID && d.distrSID!=='-') ? `Distracción SI D/I: ${d.distrSID}/${d.distrSII||'-'}` : '',
        (d.faberD && d.faberD!=='-') ? `FABER SI D/I: ${d.faberD}/${d.faberI||'-'}` : '',
        (d.fadirD && d.fadirD!=='-') ? `FADIR D/I: ${d.fadirD}/${d.fadirI||'-'}` : '',
        (d.scourD && d.scourD!=='-') ? `Scour D/I: ${d.scourD}/${d.scourI||'-'}` : '',
        fa(d.presentacionDominante) ? `Clasificación: ${fa(d.presentacionDominante)}` : '',
        d.irritabilidad ? `Irritabilidad: ${d.irritabilidad}` : '',
        d.estadoFuncional ? `Estado: ${d.estadoFuncional}` : '',
        d.diagnosticoFisio ? `Diagnóstico fisio: ${d.diagnosticoFisio}` : '',
        d.terapiaManual ? `Plan: ${d.terapiaManual}` : '',
        d.conclusion ? `Conclusión: ${d.conclusion}` : '',
        '',
        'Secciones: PRESENTACIÓN DEL CASO / HALLAZGOS DE LA EXPLORACIÓN / ANÁLISIS NEUROLÓGICO / DIAGNÓSTICO FISIOTERAPÉUTICO / OBJETIVOS / PLAN DE TRATAMIENTO / RECOMENDACIONES / PRONÓSTICO',
      ].filter(Boolean).join('\n');

      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'claude-3-haiku-20240307',
          max_tokens: 2000,
          messages: [{ role: 'user', content: lines }]
        })
      });

      const data = await r.json();
      const informe = data.content?.[0]?.text || '';

      if (!informe) {
        const errorMsg = data.error?.message || JSON.stringify(data).substring(0, 200);
        return new Response(JSON.stringify({ ok: false, error: 'Anthropic: ' + errorMsg }), { status: 500, headers: corsHeaders });
      }

      try {
        await fetch(`https://api.airtable.com/v0/${BASE_ID}/${ANAMNESIS_TABLE}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ records: [{ fields: {
            PacienteID: pacienteId || '',
            PacienteNombre: pacienteNombre || '',
            FisioNombre: fisioNombre || '',
            FechaValoracion: new Date().toISOString().split('T')[0],
            DatosJSON: JSON.stringify(datos),
            InformeGenerado: informe
          }}]})
        });
      } catch(e) {}

      return new Response(JSON.stringify({ ok: true, informe }), { headers: corsHeaders });

    } catch(e) {
      return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: corsHeaders });
    }
  }

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
      return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: corsHeaders });
    }
  }

  if (req.method === 'POST') {
    const { nombre, email, telefono } = body;
    if (!nombre || !email) {
      return new Response(JSON.stringify({ ok: false, error: 'Nombre y email obligatorios' }), { status: 400, headers: corsHeaders });
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
      return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: corsHeaders });
    }
  }

  return new Response(JSON.stringify({ error: 'Método no permitido' }), { status: 405, headers: corsHeaders });
}
