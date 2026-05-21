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

  // ── GENERAR INFORME IA ───────────────────────────────────────────────────
  if (action === 'informe' && req.method === 'POST') {
    try {
      const { pacienteId, pacienteNombre, fisioNombre, fisioColegiado, datos } = body;
      const colNum = fisioColegiado ? `Colegiado nº ${fisioColegiado}` : '';
      const d = datos || {};
      const tipo = d.tipo || 'hernia';
      const fa = arr => (!arr || !arr.length) ? '-' : arr.join(', ');
      const fecha = new Date().toLocaleDateString('es-ES');

      // Datos comunes
      const cabecera = `Fisioterapeuta: ${fisioNombre||'-'}${colNum?' | '+colNum:''} | Fecha: ${fecha}
Paciente: ${pacienteNombre||'-'} | Edad: ${d.edad||'-'} años | Actividad: ${d.act||'-'} | Ocupación: ${d.ocu||'-'}
IMC: ${d.peso && d.talla ? (d.peso/Math.pow(d.talla/100,2)).toFixed(1) : '-'}`;

      // Prompts específicos por protocolo
      const prompts = {

        rodilla: `Eres fisioterapeuta experto en rodilla. Redacta un informe de valoración fisioterapéutica de RODILLA. Términos técnicos explicados entre paréntesis. Sin markdown, secciones en MAYÚSCULAS, en párrafos.
${cabecera}
LESIÓN: Rodilla ${d.lado||'-'} | Evolución: ${d.evol||'-'} | Inicio: ${d.ini||'-'} | Diagnóstico previo: ${d.dx||'-'} | Cirugía: ${d.cx||'-'}
DOLOR: EVA reposo ${d.evr??'-'}/10 | EVA actividad ${d.eva??'-'}/10 | EVA escaleras ${d.eve??'-'}/10 | Localización: ${d.loc||'-'} | Tipo: ${d.tip||'-'} | Nocturno: ${d.noc||'-'} | Inflamación: ${d.infl||'-'} | Inestabilidad: ${d.ines||'-'} | Bloqueo: ${d.bloq||'-'}
EXPLORACIÓN: Flexión: ${d.flex||'-'} | Extensión: ${d.ext||'-'} | McMurray: ${d.mcm||'-'} | Lachman: ${d.lach||'-'} | Estrés colateral: ${d.est||'-'} | Patelofemoral: ${d.pat||'-'} | Fuerza cuádriceps: ${d.fcuad||'-'} | Propiocepción: ${d.prop||'-'}
FACTORES IDENTIFICADOS: ${fa(d.factores)}
FASE: ${d.fase||'-'} | Limitación: ${d.lim||'-'} | Objetivo: ${d.obj||'-'}
${d.flags && d.flags.length ? 'RED FLAGS: ' + fa(d.flags) : ''}

Redacta el informe con estas secciones EXACTAS (sin añadir ni quitar):
PRESENTACIÓN DEL CASO
HALLAZGOS DE LA EXPLORACIÓN FÍSICA
DIAGNÓSTICO FISIOTERAPÉUTICO
OBJETIVOS DEL TRATAMIENTO
PLAN DE TRATAMIENTO
RECOMENDACIONES PARA EL PACIENTE
PRONÓSTICO
${d.flags && d.flags.length ? 'ALERTAS IMPORTANTES' : ''}

NO incluyas ninguna sección de análisis neurológico ni raíces nerviosas — esta es una valoración de rodilla, no de columna.`,

        fascitis: `Eres fisioterapeuta experto en pie y tobillo. Redacta un informe de valoración fisioterapéutica de FASCITIS PLANTAR. Términos técnicos explicados entre paréntesis. Sin markdown, secciones en MAYÚSCULAS, en párrafos.
${cabecera}
LESIÓN: Pie ${d.pie||'-'} | Evolución: ${d.evol||'-'} | Desencadenante: ${d.ini||'-'} | Calzado: ${d.cal||'-'} | Episodios previos: ${d.epi||'-'}
DOLOR: EVA primeros pasos ${d.evm??'-'}/10 | EVA actividad ${d.eva??'-'}/10 | EVA final día ${d.evn??'-'}/10 | Dolor matutino: ${d.mat||'-'} | Al calentar: ${d.cal2||'-'} | Reaparece en reposo: ${d.rep||'-'} | Nocturno: ${d.noc||'-'} | Localización: ${d.loc||'-'} | Parestesias: ${d.par||'-'}
EXPLORACIÓN: Tipo de pie: ${d.tpie||'-'} | Dorsiflexión tobillo: ${d.dors||'-'} | Silfverskiöld: ${d.silf||'-'} | Windlass: ${d.wind||'-'} | Tinel: ${d.tin||'-'} | Heel raise: ${d.hr||'-'}
FACTORES IDENTIFICADOS: ${fa(d.factores)}
FASE: ${d.fase||'-'} | Limitación: ${d.lim||'-'} | Objetivo: ${d.obj||'-'}
${d.flags && d.flags.length ? 'RED FLAGS: ' + fa(d.flags) : ''}

Redacta el informe con estas secciones EXACTAS:
PRESENTACIÓN DEL CASO
HALLAZGOS DE LA EXPLORACIÓN FÍSICA
DIAGNÓSTICO FISIOTERAPÉUTICO
POR QUÉ LE DUELE — explica el mecanismo específico de la fascitis plantar de este paciente
FACTORES QUE MANTIENEN EL DOLOR
PLAN DE TRATAMIENTO
RECOMENDACIONES PARA EL PACIENTE
PRONÓSTICO
${d.flags && d.flags.length ? 'ALERTAS IMPORTANTES' : ''}

NO incluyas ninguna sección neurológica ni de columna — esta es una valoración de pie.`,

        cervical: `Eres fisioterapeuta experto en columna cervical. Redacta un informe de valoración fisioterapéutica CERVICAL. Términos técnicos explicados entre paréntesis. Sin markdown, secciones en MAYÚSCULAS, en párrafos.
${cabecera}
LESIÓN: Evolución: ${d.evol||'-'} | Inicio: ${d.ini||'-'} | Región: ${d.reg||'-'} | Diagnóstico previo: ${d.dx||'-'} | Cirugía: ${d.cx||'-'}
DOLOR: EVA cuello ${d.evc??'-'}/10 | EVA brazo ${d.evb??'-'}/10 | EVA cefalea ${d.evh??'-'}/10 | Localización: ${d.loc||'-'} | Tipo: ${d.tip||'-'} | Nocturno: ${d.noc||'-'} | Rigidez matutina: ${d.rig||'-'} | Cefalea: ${d.cef||'-'} | Mareos: ${d.mar||'-'}
NEUROLÓGICO: Dermatomas afectados: ${fa(d.derm)} | Parestesias: ${d.par||'-'} | Déficit motor: ${d.dm||'-'} | Reflejos: ${d.ref||'-'} | Spurling: ${d.spu||'-'} | Mielopatía: ${d.miel||'-'} | Autonómico: ${d.aut||'-'}
EXPLORACIÓN: Movilidad flex-ext: ${d.mfx||'-'} | Rotación: ${d.mro||'-'} | Flexores profundos: ${d.ffp||'-'} | Fuerza MMSS: ${d.fms||'-'} | Tracción: ${d.tra||'-'} | Postura: ${d.pos||'-'} | Ergonomía: ${d.erg||'-'}
FACTORES IDENTIFICADOS: ${fa(d.factores)}
FASE: ${d.fase||'-'} | Limitación: ${d.lim||'-'} | Objetivo: ${d.obj||'-'}
${d.flags && d.flags.length ? 'RED FLAGS: ' + fa(d.flags) : ''}

Redacta el informe con estas secciones EXACTAS:
PRESENTACIÓN DEL CASO
HALLAZGOS DE LA EXPLORACIÓN FÍSICA
VALORACIÓN NEUROLÓGICA — solo si hay afectación neurológica, si no omite esta sección
DIAGNÓSTICO FISIOTERAPÉUTICO
OBJETIVOS DEL TRATAMIENTO
PLAN DE TRATAMIENTO
RECOMENDACIONES PARA EL PACIENTE
PRONÓSTICO
${d.flags && d.flags.length ? 'ALERTAS IMPORTANTES' : ''}`,

        hombro: `Eres fisioterapeuta experto en hombro. Redacta un informe de valoración fisioterapéutica de HOMBRO. Términos técnicos explicados entre paréntesis. Sin markdown, secciones en MAYÚSCULAS, en párrafos.
${cabecera}
LESIÓN: Hombro ${d.lado||'-'} | Evolución: ${d.evol||'-'} | Inicio: ${d.ini||'-'} | Diagnóstico previo: ${d.dx||'-'} | Cirugía: ${d.cx||'-'}
DOLOR: EVA reposo ${d.evr??'-'}/10 | EVA movimiento ${d.evm2??'-'}/10 | EVA nocturno ${d.evn??'-'}/10 | Localización: ${d.loc||'-'} | Tipo: ${d.tip||'-'} | Nocturno: ${d.noch||'-'} | Arco doloroso: ${d.arc||'-'} | Rigidez: ${d.rig||'-'} | Inestabilidad: ${d.ines||'-'}
EXPLORACIÓN: Abducción: ${d.abd||'-'} | Rot. externa: ${d.rex||'-'} | Rot. interna: ${d.rin||'-'} | Neer: ${d.neer||'-'} | Hawkins-Kennedy: ${d.hawk||'-'} | Jobe (supraespinoso): ${d.jobe||'-'} | Patte (infraespinoso): ${d.pat||'-'} | Lift-off (subescapular): ${d.lift||'-'} | Speed (bíceps): ${d.spd||'-'} | Fuerza abductores: ${d.fabd||'-'} | Escápula: ${d.esc||'-'}
FACTORES IDENTIFICADOS: ${fa(d.factores)}
FASE: ${d.fase||'-'} | Limitación: ${d.lim||'-'} | Objetivo: ${d.obj||'-'}
${d.flags && d.flags.length ? 'RED FLAGS: ' + fa(d.flags) : ''}

Redacta el informe con estas secciones EXACTAS:
PRESENTACIÓN DEL CASO
HALLAZGOS DE LA EXPLORACIÓN FÍSICA
DIAGNÓSTICO FISIOTERAPÉUTICO — diferencia claramente entre impingement, rotura de manguito y capsulitis según los hallazgos
OBJETIVOS DEL TRATAMIENTO
PLAN DE TRATAMIENTO
RECOMENDACIONES PARA EL PACIENTE
PRONÓSTICO
${d.flags && d.flags.length ? 'ALERTAS IMPORTANTES' : ''}

NO incluyas secciones de análisis neurológico de columna.`,

        tobillo: `Eres fisioterapeuta experto en tobillo y pie. Redacta un informe de valoración fisioterapéutica de TOBILLO. Términos técnicos explicados entre paréntesis. Sin markdown, secciones en MAYÚSCULAS, en párrafos.
${cabecera}
LESIÓN: Tobillo ${d.lado||'-'} | Evolución: ${d.evol||'-'} | Mecanismo: ${d.ini||'-'} | Diagnóstico previo: ${d.dx||'-'} | Esguinces previos: ${d.eprev||'-'}
DOLOR: EVA reposo ${d.evr??'-'}/10 | EVA en carga ${d.evc??'-'}/10 | EVA deporte ${d.evd??'-'}/10 | Localización: ${d.loc||'-'} | Tipo: ${d.tip||'-'} | Nocturno: ${d.noc||'-'} | Inflamación: ${d.infl||'-'} | Inestabilidad: ${d.ines||'-'}
EXPLORACIÓN: Cajón anterior: ${d.caj||'-'} | Inversión forzada: ${d.invf||'-'} | Dorsiflexión: ${d.dors||'-'} | Thompson: ${d.thom||'-'} | Palpación peroneos: ${d.palp||'-'} | Palpación Aquiles: ${d.pala||'-'} | Heel raise: ${d.hr||'-'} | Propiocepción: ${d.prop||'-'}
FACTORES IDENTIFICADOS: ${fa(d.factores)}
FASE: ${d.fase||'-'} | Limitación: ${d.lim||'-'} | Objetivo: ${d.obj||'-'}
${d.flags && d.flags.length ? 'RED FLAGS: ' + fa(d.flags) : ''}

Redacta el informe con estas secciones EXACTAS:
PRESENTACIÓN DEL CASO
HALLAZGOS DE LA EXPLORACIÓN FÍSICA
DIAGNÓSTICO FISIOTERAPÉUTICO
OBJETIVOS DEL TRATAMIENTO
PLAN DE TRATAMIENTO
RECOMENDACIONES PARA EL PACIENTE
PRONÓSTICO
${d.flags && d.flags.length ? 'ALERTAS IMPORTANTES' : ''}

NO incluyas análisis neurológico de columna.`,

        cadera: `Eres fisioterapeuta experto en cadera. Redacta un informe de valoración fisioterapéutica de CADERA. Términos técnicos explicados entre paréntesis. Sin markdown, secciones en MAYÚSCULAS, en párrafos.
${cabecera}
LESIÓN: Cadera ${d.lado||'-'} | Evolución: ${d.evol||'-'} | Inicio: ${d.ini||'-'} | Diagnóstico previo: ${d.dx||'-'} | Cirugía: ${d.cx||'-'}
DOLOR: EVA reposo ${d.evr??'-'}/10 | EVA en carga ${d.evc??'-'}/10 | EVA actividad ${d.eva??'-'}/10 | Localización: ${d.loc||'-'} | Tipo: ${d.tip||'-'} | Nocturno: ${d.noc||'-'} | Rigidez: ${d.rig||'-'} | Marcha: ${d.mar||'-'}
EXPLORACIÓN: Flexión cadera: ${d.flex||'-'} | Rotación interna: ${d.roti||'-'} | FADIR: ${d.fadir||'-'} | FABER: ${d.faber||'-'} | Trendelemburg: ${d.tren||'-'} | Fuerza abductores: ${d.fabd||'-'} | Fuerza extensores: ${d.fext||'-'} | Palpación trocánter: ${d.palp||'-'}
FACTORES IDENTIFICADOS: ${fa(d.factores)}
FASE: ${d.fase||'-'} | Limitación: ${d.lim||'-'} | Objetivo: ${d.obj||'-'}
${d.flags && d.flags.length ? 'RED FLAGS: ' + fa(d.flags) : ''}

Redacta el informe con estas secciones EXACTAS:
PRESENTACIÓN DEL CASO
HALLAZGOS DE LA EXPLORACIÓN FÍSICA
DIAGNÓSTICO FISIOTERAPÉUTICO — diferencia entre origen articular, tendinoso o bursitis según los hallazgos
OBJETIVOS DEL TRATAMIENTO
PLAN DE TRATAMIENTO
RECOMENDACIONES PARA EL PACIENTE
PRONÓSTICO
${d.flags && d.flags.length ? 'ALERTAS IMPORTANTES' : ''}

NO incluyas análisis neurológico de columna lumbar.`,

        codo: `Eres fisioterapeuta experto en codo y extremidad superior. Redacta un informe de valoración fisioterapéutica de CODO. Términos técnicos explicados entre paréntesis. Sin markdown, secciones en MAYÚSCULAS, en párrafos.
${cabecera}
LESIÓN: Codo ${d.lado||'-'} | Evolución: ${d.evol||'-'} | Mecanismo: ${d.ini||'-'} | Diagnóstico previo: ${d.dx||'-'} | Actividad relacionada: ${d.actrel||'-'}
DOLOR: EVA reposo ${d.evr??'-'}/10 | EVA actividad ${d.eva??'-'}/10 | EVA al hacer fuerza ${d.evf??'-'}/10 | Localización: ${d.loc||'-'} | Tipo: ${d.tip||'-'} | Nocturno: ${d.noc||'-'} | Parestesias: ${d.par||'-'} | Fuerza prensión: ${d.fpre||'-'}
EXPLORACIÓN: Test Cozen: ${d.cozen||'-'} | Test Mill: ${d.mill||'-'} | Test Golfista: ${d.golf||'-'} | Tinel codo: ${d.tinel||'-'} | Movilidad codo: ${d.mob||'-'} | Pronosupinación: ${d.pron||'-'} | Fuerza ext. muñeca: ${d.fext||'-'} | Fuerza flex. muñeca: ${d.ffle||'-'}
FACTORES IDENTIFICADOS: ${fa(d.factores)}
FASE: ${d.fase||'-'} | Limitación: ${d.lim||'-'} | Objetivo: ${d.obj||'-'}
${d.flags && d.flags.length ? 'RED FLAGS: ' + fa(d.flags) : ''}

Redacta el informe con estas secciones EXACTAS:
PRESENTACIÓN DEL CASO
HALLAZGOS DE LA EXPLORACIÓN FÍSICA
DIAGNÓSTICO FISIOTERAPÉUTICO — diferencia claramente entre epicondilitis lateral, epitrocleitis medial y neuropatía cubital según los hallazgos
OBJETIVOS DEL TRATAMIENTO
PLAN DE TRATAMIENTO
RECOMENDACIONES PARA EL PACIENTE
PRONÓSTICO
${d.flags && d.flags.length ? 'ALERTAS IMPORTANTES' : ''}`,

        hernia: `Eres fisioterapeuta experto en columna lumbar. Redacta un informe de valoración fisioterapéutica de HERNIA DISCAL LUMBAR. Términos técnicos explicados entre paréntesis. Sin markdown, secciones en MAYÚSCULAS, en párrafos.
${cabecera}
Diagnóstico médico: ${d.diagnosticoMedico||'-'} | RM: ${d.rm||'-'} | TAC: ${d.tac||'-'} | RX: ${d.rx||'-'}
DOLOR: ${d.dolorPrincipal||'-'} | Inicio: ${d.inicioSintomas||'-'} | Evolución: ${d.evolucion||'-'} | EVA: ${d.evaActual||'-'}/10 | Irradiación: ${d.irradiacion||'-'} | Hormigueo: ${d.hormigueo||'-'} | Debilidad: ${d.debilidad||'-'}
COMPORTAMIENTO: Empeora con: ${fa(d.empeoraConArray)} | Mejora con: ${fa(d.mejoraConArray)} | Patrón: ${fa(d.patronMecanico)}
OBSERVACIÓN: Postura: ${fa(d.postura)} | Marcha: ${fa(d.marcha)} | Control motor: ${fa(d.controlMotor)}
TESTS FUNCIONALES: Hip hinge: ${d.hipHinge||'-'} | Marcha talones (L4-L5): ${d.marchaTalones||'-'} | Marcha puntillas (S1): ${d.marchaPuntillas||'-'}
NEURODINAMIA: Lasègue D: ${d.lasegueD||'-'} | Lasègue I: ${d.lasegueI||'-'} | Bragard D: ${d.bragardD||'-'} | Slump: ${d.slump||'-'} | Lasègue cruzado: ${d.lasCruz||'-'}
SENSIBILIDAD: L4 D/I: ${d.sensL4D||'Normal'}/${d.sensL4I||'Normal'} | L5 D/I: ${d.sensL5D||'Normal'}/${d.sensL5I||'Normal'} | S1 D/I: ${d.sensS1D||'Normal'}/${d.sensS1I||'Normal'}
REFLEJOS: Rotuliano D/I: ${d.rotulD||'-'}/${d.rotulI||'-'} | Aquíleo D/I: ${d.aquilD||'-'}/${d.aquilI||'-'}
FUERZA: L4 dorsiflexión D/I: ${d.fuerzaL4D||'-'}/${d.fuerzaL4I||'-'} | L5 ext.hallux D/I: ${d.fuerzaL5halluxD||'-'}/${d.fuerzaL5halluxI||'-'} | S1 flex.plantar D/I: ${d.fuerzaS1D||'-'}/${d.fuerzaS1I||'-'}
CLASIFICACIÓN: ${fa(d.presentacionDominante)} | Irritabilidad: ${d.irritabilidad||'-'} | Estado: ${d.estadoFuncional||'-'}
Diagnóstico fisio: ${d.diagnosticoFisio||'-'} | Plan: ${d.terapiaManual||'-'} | Conclusión: ${d.conclusion||'-'}
${d.banderas && d.banderas.length ? 'BANDERAS ROJAS: ' + fa(d.banderas) : ''}

Redacta el informe con estas secciones EXACTAS:
PRESENTACIÓN DEL CASO
HALLAZGOS DE LA EXPLORACIÓN FÍSICA
ANÁLISIS NEUROLÓGICO — interpreta el patrón radicular (L4/L5/S1) según sensibilidad, reflejos y fuerza
DIAGNÓSTICO FISIOTERAPÉUTICO
OBJETIVOS DEL TRATAMIENTO
PLAN DE TRATAMIENTO
RECOMENDACIONES PARA EL PACIENTE
PRONÓSTICO
${d.banderas && d.banderas.length ? 'ALERTAS IMPORTANTES' : ''}`
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
