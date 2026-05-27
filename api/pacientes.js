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
    return new Response(JSON.stringify({ ok: false, error: 'Contrasena incorrecta' }), { status: 401, headers: corsHeaders });
  }

  // ── LISTAR INFORMES ──────────────────────────────────────────────────────
  if (action === 'listar-informes') {
    try {
      const fields = ['PacienteNombre','FisioNombre','FechaValoracion','InformeGenerado','Protocolo'];
      const fieldParams = fields.map(f => `fields[]=${encodeURIComponent(f)}`).join('&');
      const aUrl = `https://api.airtable.com/v0/${BASE_ID}/${ANAMNESIS_TABLE}?${fieldParams}&sort[0][field]=FechaValoracion&sort[0][direction]=desc&pageSize=50`;
      const r = await fetch(aUrl, { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } });
      const data = await r.json();
      const informes = (data.records || []).map(rec => ({
        id: rec.id,
        pacienteNombre: rec.fields['PacienteNombre'] || '—',
        fisioNombre: rec.fields['FisioNombre'] || '—',
        fecha: rec.fields['FechaValoracion'] || '—',
        informe: rec.fields['InformeGenerado'] || '',
        protocolo: rec.fields['Protocolo'] || 'hernia',
      }));
      return new Response(JSON.stringify({ ok: true, informes }), { headers: corsHeaders });
    } catch(e) {
      return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: corsHeaders });
    }
  }

  // ── GUARDAR INFORME EN PACIENTE ─────────────────────────────────────────
  if (action === 'guardar-informe' && req.method === 'POST') {
    const { pacienteId, fisioNombre, protocolo, informe, pacienteNombre } = body;
    try {
      const fecha = new Date().toLocaleDateString('es-ES');
      const entrada = `--- ${fecha} | ${fisioNombre||''} | ${protocolo||''} ---\n${informe||''}\n`;

      let textoActual = '';
      if (pacienteId) {
        const rGet = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${PACIENTES_TABLE}/${pacienteId}?fields[]=Anamnesis`, {
          headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` }
        });
        const dGet = await rGet.json();
        textoActual = dGet.fields?.['Anamnesis'] || '';
      }

      const nuevoTexto = entrada + (textoActual ? '\n' + textoActual : '');

      if (pacienteId) {
        await fetch(`https://api.airtable.com/v0/${BASE_ID}/${PACIENTES_TABLE}/${pacienteId}`, {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ fields: { Anamnesis: nuevoTexto } })
        });
      }

      await fetch(`https://api.airtable.com/v0/${BASE_ID}/${ANAMNESIS_TABLE}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ records: [{ fields: {
          PacienteNombre: pacienteNombre || '',
          FisioNombre: fisioNombre || '',
          FechaValoracion: new Date().toISOString().split('T')[0],
          InformeGenerado: informe || '',
          Protocolo: protocolo || 'hernia'
        }}]})
      });

      return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });
    } catch(e) {
      return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: corsHeaders });
    }
  }

  // ── ACTUALIZAR INFORME ───────────────────────────────────────────────────
  if (action === 'actualizar-informe' && req.method === 'POST') {
    const { id, informe } = body;
    if (!id) return new Response(JSON.stringify({ ok: false, error: 'Falta id' }), { status: 400, headers: corsHeaders });
    try {
      await fetch(`https://api.airtable.com/v0/${BASE_ID}/${ANAMNESIS_TABLE}/${id}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: { InformeGenerado: informe || '' } })
      });
      return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });
    } catch(e) {
      return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: corsHeaders });
    }
  }

  // ── BORRAR INFORME ───────────────────────────────────────────────────────
  if (action === 'borrar-informe' && req.method === 'POST') {
    const { id } = body;
    if (!id) return new Response(JSON.stringify({ ok: false, error: 'Falta id' }), { status: 400, headers: corsHeaders });
    try {
      await fetch(`https://api.airtable.com/v0/${BASE_ID}/${ANAMNESIS_TABLE}/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` }
      });
      return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });
    } catch(e) {
      return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: corsHeaders });
    }
  }

  // ── GENERAR INFORME IA ───────────────────────────────────────────────────
  if (action === 'informe' && req.method === 'POST') {
    try {
      const { pacienteId, pacienteNombre, fisioNombre, fisioColegiado, datos } = body;
      const colNum = fisioColegiado ? `Colegiado nº ${fisioColegiado}` : '';
      const d = datos || {};
      const tipo = d.tipo || 'hernia';
      const fa = arr => (!arr || !arr.length) ? '-' : arr.join(', ');
      const fc = (label, val) => (val && val !== '-' && val !== '--') ? `${label}: ${val}` : '';
      const fca = (label, arr) => (arr && arr.length) ? `${label}: ${fa(arr)}` : '';
      const compact = (...fields) => fields.filter(Boolean).join(' | ') || '-';
      const fecha = new Date().toLocaleDateString('es-ES');

      const hayFlags = (d.flags && d.flags.length) || (d.banderas && d.banderas.length);

      const cabecera = `Fisioterapeuta: ${fisioNombre||'-'}${colNum?' | '+colNum:''} | Fecha: ${fecha}
Paciente: ${pacienteNombre||'-'} | Edad: ${d.edad||'-'} años | Actividad: ${d.act||'-'} | Ocupación: ${d.ocu||'-'}
IMC: ${d.peso && d.talla ? (d.peso/Math.pow(d.talla/100,2)).toFixed(1) : '-'}`;

      // Instrucción de estructura ÚNICA para todos los protocolos
      const estructuraBase = `
Redacta el informe con EXACTAMENTE estas secciones en este orden, con los títulos exactos en MAYÚSCULAS:

MOTIVO DE CONSULTA
(Describe el motivo principal por el que el paciente acude, síntomas, localización, evolución y contexto)

EXPLORACIÓN Y HALLAZGOS
(Resume todos los datos objetivos de la exploración física y tests realizados)

DIAGNÓSTICO FISIOTERAPÉUTICO
(Diagnóstico clínico fisioterapéutico con estructura afectada, fase y origen)

OBJETIVOS TERAPÉUTICOS
(Lista los objetivos específicos del tratamiento para este paciente)
${hayFlags ? `
ALERTAS
(Red flags detectadas y precauciones prioritarias)` : ''}

IMPORTANTE: NO uses otras secciones. NO incluyas PLAN DE TRATAMIENTO, RECOMENDACIONES, PRONÓSTICO ni ninguna sección adicional. Solo las secciones indicadas arriba.`;

      const prompts = {
        rodilla: `Eres fisioterapeuta experto en rodilla. Redacta un informe de valoración fisioterapéutica de RODILLA. Términos técnicos explicados entre paréntesis. Sin markdown, en párrafos.
${cabecera}
LESIÓN: Rodilla ${d.lado||'-'} | Evolución: ${d.evol||'-'} | Inicio: ${d.ini||'-'} | Diagnóstico previo: ${d.dx||'-'} | Cirugía: ${d.cx||'-'}
DOLOR: EVA reposo ${d.evr??'-'}/10 | EVA actividad ${d.eva??'-'}/10 | EVA escaleras ${d.eve??'-'}/10 | Localización: ${d.loc||'-'} | Tipo: ${d.tip||'-'} | Nocturno: ${d.noc||'-'} | Inflamación: ${d.infl||'-'} | Inestabilidad: ${d.ines||'-'} | Bloqueo: ${d.bloq||'-'}
EXPLORACIÓN: Flexión: ${d.flex||'-'} | Extensión: ${d.ext||'-'} | McMurray: ${d.mcm||'-'} | Lachman: ${d.lach||'-'} | Estrés colateral: ${d.est||'-'} | Patelofemoral: ${d.pat||'-'} | Fuerza cuádriceps: ${d.fcuad||'-'} | Propiocepción: ${d.prop||'-'}
FACTORES: ${fa(d.factores)} | FASE: ${d.fase||'-'} | Limitación: ${d.lim||'-'} | Objetivo: ${d.obj||'-'}
${hayFlags ? 'RED FLAGS: ' + fa(d.flags) : ''}
${estructuraBase}`,

        fascitis: `Eres fisioterapeuta experto en pie y tobillo. Redacta un informe de valoración fisioterapéutica de FASCITIS PLANTAR. Términos técnicos explicados entre paréntesis. Sin markdown, en párrafos.
${cabecera}
LESIÓN: Pie ${d.pie||'-'} | Evolución: ${d.evol||'-'} | Desencadenante: ${d.ini||'-'} | Calzado: ${d.cal||'-'} | Episodios previos: ${d.epi||'-'}
DOLOR: EVA primeros pasos ${d.evm??'-'}/10 | EVA actividad ${d.eva??'-'}/10 | EVA final día ${d.evn??'-'}/10 | Dolor matutino: ${d.mat||'-'} | Al calentar: ${d.cal2||'-'} | Reaparece en reposo: ${d.rep||'-'} | Nocturno: ${d.noc||'-'} | Localización: ${d.loc||'-'} | Parestesias: ${d.par||'-'}
EXPLORACIÓN: Tipo de pie: ${d.tpie||'-'} | Dorsiflexión tobillo: ${d.dors||'-'} | Silfverskiöld: ${d.silf||'-'} | Windlass: ${d.wind||'-'} | Tinel: ${d.tin||'-'} | Heel raise: ${d.hr||'-'}
FACTORES: ${fa(d.factores)} | FASE: ${d.fase||'-'} | Limitación: ${d.lim||'-'} | Objetivo: ${d.obj||'-'}
${hayFlags ? 'RED FLAGS: ' + fa(d.flags) : ''}
${estructuraBase}`,

        cervical: `Eres fisioterapeuta experto en columna cervical. Redacta un informe de valoración fisioterapéutica CERVICAL. Términos técnicos explicados entre paréntesis. Sin markdown, en párrafos.
${cabecera}
${compact(fc('Evolución',d.evol),fc('Inicio',d.ini),fc('Región',d.reg),fc('Dx previo',d.dx),fc('Cirugía',d.cx))}
EVA: cuello ${d.evc??'-'}/10 brazo ${d.evb??'-'}/10 cefalea ${d.evh??'-'}/10
${compact(fc('Localización',d.loc),fc('Tipo',d.tip),fc('Nocturno',d.noc),fc('Rigidez',d.rig),fc('Cefalea',d.cef),fc('Mareos',d.mar))}
${compact(fca('Dermatoma',d.derm),fc('Parestesias',d.par),fc('Motor',d.dm),fc('Reflejos',d.ref),fc('Mielopatía',d.miel),fc('Autonómico',d.aut))}
${compact(fc('Compresión',d.test_compresion),fc('Spurling',d.test_spurling),fc('Distracción',d.test_distraccion))}
${compact(fc('Flex-ext',d.mfx),fc('Rotación',d.mro),fc('Flex.prof',d.ffp),fc('Fuerza MMSS',d.fms),fc('Postura',d.pos),fc('Ergonomía',d.erg))}
${compact(fca('Factores',d.factores),fc('Limitación',d.lim),fc('Objetivo',d.obj))}
${d.obs_cervical ? 'Obs: ' + d.obs_cervical : ''}
${hayFlags ? 'RED FLAGS: ' + fa(d.flags) : ''}
${estructuraBase}`,

        hombro: `Eres fisioterapeuta experto en hombro. Redacta un informe de valoración fisioterapéutica de HOMBRO. Términos técnicos explicados entre paréntesis. Sin markdown, en párrafos.
${cabecera}
LESIÓN: Hombro ${d.lado||'-'} | Evolución: ${d.evol||'-'} | Inicio: ${d.ini||'-'} | Diagnóstico previo: ${d.dx||'-'} | Cirugía: ${d.cx||'-'}
DOLOR: EVA reposo ${d.evr??'-'}/10 | EVA movimiento ${d.evm2??'-'}/10 | EVA nocturno ${d.evn??'-'}/10 | Localización: ${d.loc||'-'} | Tipo: ${d.tip||'-'} | Nocturno: ${d.noch||'-'} | Arco doloroso: ${d.arc||'-'} | Rigidez: ${d.rig||'-'} | Inestabilidad: ${d.ines||'-'}
EXPLORACIÓN: Abducción: ${d.abd||'-'} | Rot. externa: ${d.rex||'-'} | Rot. interna: ${d.rin||'-'} | Neer: ${d.neer||'-'} | Hawkins-Kennedy: ${d.hawk||'-'} | Jobe: ${d.jobe||'-'} | Patte: ${d.pat||'-'} | Lift-off: ${d.lift||'-'} | Speed: ${d.spd||'-'} | Fuerza abductores: ${d.fabd||'-'} | Escápula: ${d.esc||'-'}
FACTORES: ${fa(d.factores)} | FASE: ${d.fase||'-'} | Limitación: ${d.lim||'-'} | Objetivo: ${d.obj||'-'}
${hayFlags ? 'RED FLAGS: ' + fa(d.flags) : ''}
${estructuraBase}`,

        tobillo: `Eres fisioterapeuta experto en tobillo y pie. Redacta un informe de valoración fisioterapéutica de TOBILLO. Términos técnicos explicados entre paréntesis. Sin markdown, en párrafos.
${cabecera}
LESIÓN: Tobillo ${d.lado||'-'} | Evolución: ${d.evol||'-'} | Mecanismo: ${d.ini||'-'} | Diagnóstico previo: ${d.dx||'-'} | Esguinces previos: ${d.eprev||'-'}
DOLOR: EVA reposo ${d.evr??'-'}/10 | EVA en carga ${d.evc??'-'}/10 | EVA deporte ${d.evd??'-'}/10 | Localización: ${d.loc||'-'} | Tipo: ${d.tip||'-'} | Nocturno: ${d.noc||'-'} | Inflamación: ${d.infl||'-'} | Inestabilidad: ${d.ines||'-'}
EXPLORACIÓN: Cajón anterior: ${d.caj||'-'} | Inversión forzada: ${d.invf||'-'} | Dorsiflexión: ${d.dors||'-'} | Thompson: ${d.thom||'-'} | Palpación peroneos: ${d.palp||'-'} | Palpación Aquiles: ${d.pala||'-'} | Heel raise: ${d.hr||'-'} | Propiocepción: ${d.prop||'-'}
FACTORES: ${fa(d.factores)} | FASE: ${d.fase||'-'} | Limitación: ${d.lim||'-'} | Objetivo: ${d.obj||'-'}
${hayFlags ? 'RED FLAGS: ' + fa(d.flags) : ''}
${estructuraBase}`,

        cadera: `Eres fisioterapeuta experto en cadera. Redacta un informe de valoración fisioterapéutica de CADERA. Términos técnicos explicados entre paréntesis. Sin markdown, en párrafos.
${cabecera}
LESIÓN: Cadera ${d.lado||'-'} | Evolución: ${d.evol||'-'} | Inicio: ${d.ini||'-'} | Diagnóstico previo: ${d.dx||'-'} | Cirugía: ${d.cx||'-'}
DOLOR: EVA reposo ${d.evr??'-'}/10 | EVA en carga ${d.evc??'-'}/10 | EVA actividad ${d.eva??'-'}/10 | Localización: ${d.loc||'-'} | Tipo: ${d.tip||'-'} | Nocturno: ${d.noc||'-'} | Rigidez: ${d.rig||'-'} | Marcha: ${d.mar||'-'}
EXPLORACIÓN: Flexión cadera: ${d.flex||'-'} | Rotación interna: ${d.roti||'-'} | FADIR: ${d.fadir||'-'} | FABER: ${d.faber||'-'} | Trendelemburg: ${d.tren||'-'} | Fuerza abductores: ${d.fabd||'-'} | Fuerza extensores: ${d.fext||'-'} | Palpación trocánter: ${d.palp||'-'}
FACTORES: ${fa(d.factores)} | FASE: ${d.fase||'-'} | Limitación: ${d.lim||'-'} | Objetivo: ${d.obj||'-'}
${hayFlags ? 'RED FLAGS: ' + fa(d.flags) : ''}
${estructuraBase}`,

        codo: `Eres fisioterapeuta experto en codo y extremidad superior. Redacta un informe de valoración fisioterapéutica de CODO. Términos técnicos explicados entre paréntesis. Sin markdown, en párrafos.
${cabecera}
LESIÓN: Codo ${d.lado||'-'} | Evolución: ${d.evol||'-'} | Mecanismo: ${d.ini||'-'} | Diagnóstico previo: ${d.dx||'-'} | Actividad relacionada: ${d.actrel||'-'}
DOLOR: EVA reposo ${d.evr??'-'}/10 | EVA actividad ${d.eva??'-'}/10 | EVA al hacer fuerza ${d.evf??'-'}/10 | Localización: ${d.loc||'-'} | Tipo: ${d.tip||'-'} | Nocturno: ${d.noc||'-'} | Parestesias: ${d.par||'-'} | Fuerza prensión: ${d.fpre||'-'}
EXPLORACIÓN: Test Cozen: ${d.cozen||'-'} | Test Mill: ${d.mill||'-'} | Test Golfista: ${d.golf||'-'} | Tinel codo: ${d.tinel||'-'} | Movilidad codo: ${d.mob||'-'} | Pronosupinación: ${d.pron||'-'} | Fuerza ext. muñeca: ${d.fext||'-'} | Fuerza flex. muñeca: ${d.ffle||'-'}
FACTORES: ${fa(d.factores)} | FASE: ${d.fase||'-'} | Limitación: ${d.lim||'-'} | Objetivo: ${d.obj||'-'}
${hayFlags ? 'RED FLAGS: ' + fa(d.flags) : ''}
${estructuraBase}`,

        hernia: `Eres fisioterapeuta experto en columna lumbar. Redacta un informe de valoración fisioterapéutica de HERNIA DISCAL LUMBAR. Términos técnicos explicados entre paréntesis. Sin markdown, en párrafos.
${cabecera}
Diagnóstico médico: ${d.diagnosticoMedico||'-'} | RM: ${d.rm||'-'} | TAC: ${d.tac||'-'} | RX: ${d.rx||'-'}
DOLOR: ${d.dolorPrincipal||'-'} | Inicio: ${d.inicioSintomas||'-'} | Evolución: ${d.evolucion||'-'} | EVA: ${d.evaActual||'-'}/10 | Irradiación: ${d.irradiacion||'-'} | Hormigueo: ${d.hormigueo||'-'} | Debilidad: ${d.debilidad||'-'}
COMPORTAMIENTO: Empeora con: ${fa(d.empeoraConArray)} | Mejora con: ${fa(d.mejoraConArray)} | Patrón: ${fa(d.patronMecanico)}
OBSERVACIÓN: Postura: ${fa(d.postura)} | Marcha: ${fa(d.marcha)} | Control motor: ${fa(d.controlMotor)}
TESTS: Hip hinge: ${d.hipHinge||'-'} | Marcha talones: ${d.marchaTalones||'-'} | Marcha puntillas: ${d.marchaPuntillas||'-'}
NEURODINAMIA: Lasègue D: ${d.lasegueD||'-'} | Lasègue I: ${d.lasegueI||'-'} | Bragard D: ${d.bragardD||'-'} | Slump: ${d.slump||'-'} | Lasègue cruzado: ${d.lasCruz||'-'}
SENSIBILIDAD: L4 D/I: ${d.sensL4D||'Normal'}/${d.sensL4I||'Normal'} | L5 D/I: ${d.sensL5D||'Normal'}/${d.sensL5I||'Normal'} | S1 D/I: ${d.sensS1D||'Normal'}/${d.sensS1I||'Normal'}
REFLEJOS: Rotuliano D/I: ${d.rotulD||'-'}/${d.rotulI||'-'} | Aquíleo D/I: ${d.aquilD||'-'}/${d.aquilI||'-'}
FUERZA: L4 D/I: ${d.fuerzaL4D||'-'}/${d.fuerzaL4I||'-'} | L5 D/I: ${d.fuerzaL5halluxD||'-'}/${d.fuerzaL5halluxI||'-'} | S1 D/I: ${d.fuerzaS1D||'-'}/${d.fuerzaS1I||'-'}
CLASIFICACIÓN: ${fa(d.presentacionDominante)} | Irritabilidad: ${d.irritabilidad||'-'} | Estado: ${d.estadoFuncional||'-'}
Dx fisio: ${d.diagnosticoFisio||'-'} | Plan: ${d.terapiaManual||'-'} | Conclusión: ${d.conclusion||'-'}
${hayFlags ? 'BANDERAS ROJAS: ' + fa(d.banderas) : ''}
${estructuraBase}`
      };

      const prompt = prompts[tipo] || prompts['hernia'];

      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 2000,
          messages: [{ role: 'user', content: prompt }]
        })
      });

      const data = await r.json();
      const informe = data.content?.[0]?.text || '';

      if (!informe) {
        const errorMsg = data.error?.message || JSON.stringify(data).substring(0, 200);
        return new Response(JSON.stringify({ ok: false, error: 'Anthropic: ' + errorMsg }), { status: 500, headers: corsHeaders });
      }

      return new Response(JSON.stringify({ ok: true, informe }), { headers: corsHeaders });

    } catch(e) {
      return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: corsHeaders });
    }
  }

  // ── GET PACIENTES ────────────────────────────────────────────────────────
  if (req.method === 'GET' && !action) {
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

  // ── POST NUEVO PACIENTE ──────────────────────────────────────────────────
  if (req.method === 'POST' && !action) {
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

  return new Response(JSON.stringify({ ok: false, error: 'Ruta no encontrada' }), { status: 404, headers: corsHeaders });
}
