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
      const fa = arr => (!arr || !arr.length) ? null : arr.join(', ');
      const val = v => (v && v !== '-') ? v : null;
      // Solo incluir en el prompt los campos que tienen valor
      const line = (label, value) => value ? label + ': ' + value + '\n' : '';
      const lineArr = (label, arr) => (arr && arr.length) ? label + ': ' + arr.join(', ') + '\n' : '';

      const prompt = [
        'Eres un fisioterapeuta experto. Redacta un informe de valoración profesional.',
        'Interpreta cada resultado de test clínicamente. Correlaciona hallazgos para construir un cuadro clínico coherente.',
        'Identifica el patrón radicular si existe (L4, L5, S1). Si hay disfunción sacroilíaca, identifícala.',
        'En español, sin markdown, secciones en MAYÚSCULAS, en párrafos sin listas.',
        '',
        `Fisioterapeuta: ${fisioNombre||'-'} | Fecha: ${new Date().toLocaleDateString('es-ES')}`,
        `Paciente: ${pacienteNombre||'-'} | Edad: ${d.edad||'-'} | Profesión: ${d.profesion||'-'} | Actividad: ${d.actividadFisica||'-'}`,
        d.diagnosticoMedico ? `Diagnóstico médico: ${d.diagnosticoMedico}` : '',
        d.rm ? `RM: ${d.rm}` : '',
        d.dolorPrincipal ? `Dolor principal: ${d.dolorPrincipal}` : '',
        d.inicioSintomas ? `Inicio: ${d.inicioSintomas}` : '',
        d.evolucion ? `Evolución: ${d.evolucion}` : '',
        `EVA: ${d.evaActual||'-'}/10`,
        d.irradiacion ? `Irradiación: ${d.irradiacion}` : '',
        d.hormigueo ? `Hormigueo: ${d.hormigueo}` : '',
        d.debilidad ? `Debilidad: ${d.debilidad}` : '',
        d.limitaciones ? `Limitaciones: ${d.limitaciones}` : '',
        fa(d.banderas) ? `BANDERAS ROJAS: ${fa(d.banderas)}` : '',
        fa(d.empeoraConArray) ? `Empeora con: ${fa(d.empeoraConArray)}` : '',
        fa(d.mejoraConArray) ? `Mejora con: ${fa(d.mejoraConArray)}` : '',
        fa(d.patronMecanico) ? `Patrón mecánico: ${fa(d.patronMecanico)}` : '',
        fa(d.factoresPsicosociales) ? `Psicosocial: ${fa(d.factoresPsicosociales)}` : '',
        fa(d.postura) ? `Postura: ${fa(d.postura)}` : '',
        fa(d.marcha) ? `Marcha observación: ${fa(d.marcha)}` : '',
        fa(d.controlMotor) ? `Control motor: ${fa(d.controlMotor)}` : '',
        d.hipHinge ? `Hip hinge: ${d.hipHinge}` : '',
        (d.thomasD && d.thomasD!=='-') ? `Thomas D/I: ${d.thomasD}/${d.thomasI||'-'}` : '',
        (d.marchaTalones && d.marchaTalones!=='-') ? `Marcha talones (L4-L5): ${d.marchaTalones}` : '',
        (d.marchaPuntillas && d.marchaPuntillas!=='-') ? `Marcha puntillas (S1): ${d.marchaPuntillas}` : '',
        // Sensibilidad - solo mostrar las alteradas
        ...[['L1',d.sensL1D,d.sensL1I],['L2',d.sensL2D,d.sensL2I],['L3',d.sensL3D,d.sensL3I],
            ['L4',d.sensL4D,d.sensL4I],['L5',d.sensL5D,d.sensL5I],['S1',d.sensS1D,d.sensS1I],['S2',d.sensS2D,d.sensS2I]]
          .filter(([r,dd,ii])=>(dd&&dd!=='Normal'&&dd!=='-')||(ii&&ii!=='Normal'&&ii!=='-'))
          .map(([r,dd,ii])=>`Sensibilidad ${r}: D=${dd||'-'} I=${ii||'-'}`),
        // Reflejos - solo mostrar los alterados
        (d.rotulD && d.rotulD!=='Normal' && d.rotulD!=='-') ? `Reflejo rotuliano D: ${d.rotulD}` : '',
        (d.rotulI && d.rotulI!=='Normal' && d.rotulI!=='-') ? `Reflejo rotuliano I: ${d.rotulI}` : '',
        (d.aquilD && d.aquilD!=='Normal' && d.aquilD!=='-') ? `Reflejo aquíleo D: ${d.aquilD}` : '',
        (d.aquilI && d.aquilI!=='Normal' && d.aquilI!=='-') ? `Reflejo aquíleo I: ${d.aquilI}` : '',
        (d.isquioD && d.isquioD!=='Normal' && d.isquioD!=='-') ? `Reflejo isquiotibial D: ${d.isquioD}` : '',
        // Fuerza - solo mostrar las deficitarias
        ...[['L1-L2 flex cadera',d.fuerzaL1L2D,d.fuerzaL1L2I],['L3-L4 ext rodilla',d.fuerzaL3L4D,d.fuerzaL3L4I],
            ['L4 dorsiflexión',d.fuerzaL4D,d.fuerzaL4I],['L5 ext hallux',d.fuerzaL5halluxD,d.fuerzaL5halluxI],
            ['L5 abd cadera',d.fuerzaL5abdD,d.fuerzaL5abdI],['S1 flex plantar',d.fuerzaS1D,d.fuerzaS1I]]
          .filter(([m,dd,ii])=>(dd&&dd!=='5'&&dd!=='-')||(ii&&ii!=='5'&&ii!=='-'))
          .map(([m,dd,ii])=>`Fuerza ${m}: D=${dd||'-'}/5 I=${ii||'-'}/5`),
        // Neurodinamia
        (d.lasegueD && d.lasegueD!=='-') ? `Lasègue D: ${d.lasegueD}` : '',
        (d.lasegueI && d.lasegueI!=='-') ? `Lasègue I: ${d.lasegueI}` : '',
        (d.bragardD && d.bragardD!=='-') ? `Bragard D: ${d.bragardD}` : '',
        (d.bragardI && d.bragardI!=='-') ? `Bragard I: ${d.bragardI}` : '',
        (d.slumpD && d.slumpD!=='-') ? `Slump D: ${d.slumpD}` : '',
        (d.lasCruzD && d.lasCruzD!=='-') ? `Lasègue cruzado D: ${d.lasCruzD}` : '',
        (d.kernigD && d.kernigD!=='-') ? `Kernig D: ${d.kernigD}` : '',
        // Sacroilíaca
        (d.gaenslenD && d.gaenslenD!=='-') ? `Gaenslen D/I: ${d.gaenslenD}/${d.gaenslenI||'-'}` : '',
        (d.mennellD && d.mennellD!=='-') ? `Mennell D/I: ${d.mennellD}/${d.mennellI||'-'}` : '',
        (d.yeomanD && d.yeomanD!=='-') ? `Yeoman D/I: ${d.yeomanD}/${d.yeomanI||'-'}` : '',
        (d.comprSID && d.comprSID!=='-') ? `Compresión SI D/I: ${d.comprSID}/${d.comprSII||'-'}` : '',
        (d.distrSID && d.distrSID!=='-') ? `Distracción SI D/I: ${d.distrSID}/${d.distrSII||'-'}` : '',
        (d.faberD && d.faberD!=='-') ? `FABER SI D/I: ${d.faberD}/${d.faberI||'-'}` : '',
        // Cadera
        (d.fadirD && d.fadirD!=='-') ? `FADIR D/I: ${d.fadirD}/${d.fadirI||'-'}` : '',
        (d.faberCadD && d.faberCadD!=='-') ? `FABER cadera D/I: ${d.faberCadD}/${d.faberCadI||'-'}` : '',
        (d.scourD && d.scourD!=='-') ? `Scour D/I: ${d.scourD}/${d.scourI||'-'}` : '',
        fa(d.presentacionDominante) ? `Clasificación: ${fa(d.presentacionDominante)}` : '',
        d.irritabilidad ? `Irritabilidad: ${d.irritabilidad}` : '',
        d.estadoFuncional ? `Estado: ${d.estadoFuncional}` : '',
        d.diagnosticoFisio ? `Diagnóstico fisio: ${d.diagnosticoFisio}` : '',
        d.terapiaManual ? `Plan: ${d.terapiaManual}` : '',
        d.objetivosCorto ? `Objetivos corto: ${d.objetivosCorto}` : '',
        d.conclusion ? `Conclusión: ${d.conclusion}` : '',
        '',
        'Redacta el informe con estas secciones en MAYÚSCULAS:',
        'PRESENTACIÓN DEL CASO',
        'HALLAZGOS DE LA EXPLORACIÓN FÍSICA',
        'ANÁLISIS NEUROLÓGICO E INTERPRETACIÓN DE TESTS',
        'CORRELACIÓN CLÍNICA Y DIAGNÓSTICO FISIOTERAPÉUTICO',
        'OBJETIVOS DEL TRATAMIENTO',
        'PLAN DE TRATAMIENTO',
        'RECOMENDACIONES PARA EL PACIENTE',
        'PRONÓSTICO',
      ].filter(Boolean).join('\n');FISIO_PASSWORD = process.env.FISIO_PASSWORD || 'fisio2024';
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
      const fa = arr => (!arr || !arr.length) ? null : arr.join(', ');
      const val = v => (v && v !== '-') ? v : null;
      // Solo incluir en el prompt los campos que tienen valor
      const line = (label, value) => value ? label + ': ' + value + '\n' : '';
      const lineArr = (label, arr) => (arr && arr.length) ? label + ': ' + arr.join(', ') + '\n' : '';

      const prompt = `Eres un fisioterapeuta experto clínico. Redacta un informe de valoración profesional y completo para el paciente ${pacienteNombre || 'el paciente'}.

INSTRUCCIONES CLAVE:
- Interpreta cada resultado de test de forma clínica
- Correlaciona los hallazgos entre sí para construir un cuadro clínico coherente
- Identifica el patrón radicular si existe (L4, L5, S1) basándote en la suma de hallazgos
- Si hay disfunción sacroilíaca, identifícala y cuantifica (número de tests positivos)
- Genera un protocolo de tratamiento específico y detallado según los hallazgos
- Tono profesional pero comprensible para el paciente
- En español, sin markdown, secciones en MAYÚSCULAS
- En párrafos, sin listas ni guiones

DATOS DEL PACIENTE:
Fisioterapeuta: ${val(fisioNombre)} | Fecha: ${new Date().toLocaleDateString('es-ES')}
Paciente: ${val(pacienteNombre)} | Edad: ${val(d.edad)} | Profesión: ${val(d.profesion)} | Actividad: ${val(d.actividadFisica)}
Diagnóstico médico: ${val(d.diagnosticoMedico)}
RM: ${val(d.rm)} | TAC: ${val(d.tac)} | RX: ${val(d.rx)}

MOTIVO DE CONSULTA:
Dolor principal: ${val(d.dolorPrincipal)}
Inicio: ${val(d.inicioSintomas)} | Mecanismo: ${val(d.mecanismoAparicion)}
Evolución: ${val(d.evolucion)}
EVA actual: ${val(d.evaActual)}/10
Irradiación: ${val(d.irradiacion)} | Hormigueo: ${val(d.hormigueo)} | Debilidad: ${val(d.debilidad)}
Limitaciones: ${val(d.limitaciones)} | Expectativas: ${val(d.expectativas)}
Empeora con: ${fa(d.empeoraConArray)} | Mejora con: ${fa(d.mejoraConArray)}
Patrón mecánico: ${fa(d.patronMecanico)}
Factores psicosociales: ${fa(d.factoresPsicosociales)}
Banderas rojas: ${fa(d.banderas)}

OBSERVACIÓN GLOBAL:
Postura: ${fa(d.postura)} | Marcha: ${fa(d.marcha)} | Control motor: ${fa(d.controlMotor)}

TEST FUNCIONALES:
Hip hinge: ${val(d.hipHinge)}
Monopodal D: ${val(d.monopodalEquD)} | Trendelenburg D: ${val(d.monopodalTrendD)} | Dolor D: ${val(d.monopodalDolorD)}
Monopodal I: ${val(d.monopodalEquI)} | Trendelenburg I: ${val(d.monopodalTrendI)} | Dolor I: ${val(d.monopodalDolorI)}
Thomas D: ${val(d.thomasD)} | Thomas I: ${val(d.thomasI)}
Extensión cadera D (orden activación): ${val(d.extCadDer)}
Extensión cadera I (orden activación): ${val(d.extCadIzq)}
Marcha talones: ${val(d.marchaTalones)}
Marcha puntillas: ${val(d.marchaPuntillas)}

SENSIBILIDAD (dermatomas):
L1 D/I: ${val(d.sensL1D)}/${val(d.sensL1I)} | L2 D/I: ${val(d.sensL2D)}/${val(d.sensL2I)} | L3 D/I: ${val(d.sensL3D)}/${val(d.sensL3I)}
L4 D/I: ${val(d.sensL4D)}/${val(d.sensL4I)} | L5 D/I: ${val(d.sensL5D)}/${val(d.sensL5I)}
S1 D/I: ${val(d.sensS1D)}/${val(d.sensS1I)} | S2 D/I: ${val(d.sensS2D)}/${val(d.sensS2I)}

REFLEJOS OSTEOTENDINOSOS:
Rotuliano D: ${val(d.rotulD)} / I: ${val(d.rotulI)} → (L3-L4: hipoactivo/ausente = lesión raíz)
Aquíleo D: ${val(d.aquilD)} / I: ${val(d.aquilI)} → (S1-S2: hipoactivo/ausente = lesión raíz)
Isquiotibial medial D: ${val(d.isquioD)} / I: ${val(d.isquioI)} → (L5: frecuente en afectación L5)

FUERZA POR RAÍCES (Daniels 0-5):
L1-L2 flexión cadera D: ${val(d.fuerzaL1L2D)} / I: ${val(d.fuerzaL1L2I)}
L2-L3 aducción cadera D: ${val(d.fuerzaL2L3D)} / I: ${val(d.fuerzaL2L3I)}
L3-L4 extensión rodilla D: ${val(d.fuerzaL3L4D)} / I: ${val(d.fuerzaL3L4I)}
L4 dorsiflexión tobillo D: ${val(d.fuerzaL4D)} / I: ${val(d.fuerzaL4I)}
L5 extensión hallux D: ${val(d.fuerzaL5halluxD)} / I: ${val(d.fuerzaL5halluxI)}
L5 abducción cadera D: ${val(d.fuerzaL5abdD)} / I: ${val(d.fuerzaL5abdI)}
S1 flexión plantar D: ${val(d.fuerzaS1D)} / I: ${val(d.fuerzaS1I)}
S1-S2 eversión pie D: ${val(d.fuerzaS1S2D)} / I: ${val(d.fuerzaS1S2I)}
S2 flexión rodilla D: ${val(d.fuerzaS2D)} / I: ${val(d.fuerzaS2I)}

EXPLORACIÓN NEURODINÁMICA:
Lasègue D: ${val(d.lasegueD)} / I: ${val(d.lasegueI)}
Bragard D: ${val(d.bragardD)} / I: ${val(d.bragardI)}
Slump D: ${val(d.slumpD)} / I: ${val(d.slumpI)}
Lasègue cruzado D: ${val(d.lasCruzD)} / I: ${val(d.lasCruzI)}
Kernig D: ${val(d.kernigD)} / I: ${val(d.kernigI)}

EXPLORACIÓN SACROILÍACA:
Gaenslen D: ${val(d.gaenslenD)} / I: ${val(d.gaenslenI)}
Mennell D: ${val(d.mennellD)} / I: ${val(d.mennellI)}
Yeoman D: ${val(d.yeomanD)} / I: ${val(d.yeomanI)}
Compresión SI D: ${val(d.comprSID)} / I: ${val(d.comprSII)}
Distracción SI D: ${val(d.distrSID)} / I: ${val(d.distrSII)}
FABER/Patrick D: ${val(d.faberD)} / I: ${val(d.faberI)}

EXPLORACIÓN DE CADERA:
ROM cadera: Flexión D/I: ${val(d.caderaFlexD)}/${val(d.caderaFlexI)} | Extensión D/I: ${val(d.caderaExtD)}/${val(d.caderaExtI)}
Rot. interna D/I: ${val(d.caderaRotIntD)}/${val(d.caderaRotIntI)} | Rot. externa D/I: ${val(d.caderaRotExtD)}/${val(d.caderaRotExtI)}
FADIR D: ${val(d.fadirD)} / I: ${val(d.fadirI)}
FABER cadera D: ${val(d.faberCadD)} / I: ${val(d.faberCadI)}
Scour D: ${val(d.scourD)} / I: ${val(d.scourI)}

CLASIFICACIÓN CLÍNICA:
Presentación: ${fa(d.presentacionDominante)}
Irritabilidad: ${val(d.irritabilidad)} | Estado: ${val(d.estadoFuncional)}

DIAGNÓSTICO Y PLAN DEL FISIOTERAPEUTA:
Diagnóstico: ${val(d.diagnosticoFisio)}
Plan: ${val(d.terapiaManual)}
Objetivos corto: ${val(d.objetivosCorto)}
Objetivos medio: ${val(d.objetivosMedio)}
Objetivos largo: ${val(d.objetivosLargo)}
Conclusión: ${val(d.conclusion)}

GUÍA DE INTERPRETACIÓN Y CORRELACIÓN (usa esto para redactar el informe):
- Lasègue + Bragard positivos = compresión radicular confirmada
- Lasègue cruzado positivo = hernia medial (alta especificidad ~90%)
- Reflejo aquíleo ↓/ausente + hipoestesia S1 + marcha puntillas alterada = radiculopatía S1
- Reflejo rotuliano ↓/ausente + hipoestesia L4 + dorsiflexión débil = radiculopatía L4
- Reflejo isquiotibial ↓ + hipoestesia L5 + extensión hallux débil + marcha talones alterada = radiculopatía L5
- 3+ tests SI positivos = disfunción sacroilíaca confirmada
- Thomas positivo + extensión cadera con erectores dominantes + Trendelenburg = patrón glúteo inhibido
- Banderas rojas presentes = mencionar URGENCIA de derivación médica

Redacta el informe con estas secciones en MAYÚSCULAS:
PRESENTACIÓN DEL CASO
HALLAZGOS DE LA EXPLORACIÓN FÍSICA
ANÁLISIS NEUROLÓGICO E INTERPRETACIÓN DE TESTS
CORRELACIÓN CLÍNICA Y DIAGNÓSTICO FISIOTERAPÉUTICO
OBJETIVOS DEL TRATAMIENTO
PROTOCOLO DE TRATAMIENTO
RECOMENDACIONES PARA EL PACIENTE
PRONÓSTICO`;

      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 3000,
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
