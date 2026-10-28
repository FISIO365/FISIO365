// api/reservar.js — El paciente reserva una cita desde la app
// Los huecos libres son las citas de Airtable con ESTADO «CITA LIBRE» (los «LIBRE - SIN BOMBA» no salen en la app).
// Reservar = esa misma fila pasa a «PENDIENTE » y se enlaza con el paciente (llega directa a la agenda de Airtable).
export const config = { runtime: 'edge' };

const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const BASE_ID = 'appsrGnHpFt8sVD5A';
const CITAS = 'tblTPlcuiSjQngkaD';
const PACIENTES = 'tbldBVgClS4HY2mOJ';
const LIBRES = ['CITA LIBRE']; // «LIBRE - SIN BOMBA» no se ofrece en la app (solo la da la clínica)
const DIAS_VISTA = 35;          // cuántos días hacia delante se enseñan
const TIPO_APP = 'recvCLCoYJ82LcPh9';  // «RESERVADA POR LA APP» en la tabla de tipos de cita
const MARGEN_MIN = 0;           // se puede reservar hasta la hora de empezar, mientras el hueco esté libre

const ETAPAS_PAC = ['PACIENTE NUEVO', 'PENDIENTE DE COMENZAR', 'ACTIVO', 'SEGUIMIENTO', 'PENDIENTE DE CONTINUAR', 'ALTA', 'ABANDONO', 'NO ACUDIÓ', 'SESIÓN ÚNICA'];
async function ponerEtapaCita(pid) {
  const g = async path => (await fetch(`https://api.airtable.com/v0/${BASE_ID}/${path}`, { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } })).json();
  const est = await g('tbldOsLe8iw78Wun7?fields[]=ESTADO&pageSize=100'); const E = {}; (est.records || []).forEach(x => { E[String(x.fields['ESTADO'] || '').trim().toUpperCase()] = x.id; });
  const h = await g(`${CITAS}?filterByFormula=${encodeURIComponent(`AND(TRIM({ESTADO})='REALIZADA',FIND('${pid}',ARRAYJOIN({PacienteRec})))`)}&maxRecords=1&fields[]=FECHA`);
  const nueva = E[(h.records || []).length ? 'ACTIVO' : 'PACIENTE NUEVO']; if (!nueva) return;
  const p = await g(`${PACIENTES}/${pid}?fields[]=ESTADO`); const act = (p.fields && p.fields['ESTADO']) || [];
  const vida = ETAPAS_PAC.map(n => E[n]).filter(Boolean), nuevo = [...act.filter(id => !vida.includes(id)), nueva];
  if (nuevo.slice().sort().join() !== act.slice().sort().join()) await fetch(`https://api.airtable.com/v0/${BASE_ID}/${PACIENTES}/${pid}`, { method: 'PATCH', headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: { ESTADO: nuevo } }) });
}

const H = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: H });
const AT = { Authorization: `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' };
const idValido = (s) => /^rec[A-Za-z0-9]{14}$/.test(s || '');

// Fecha y hora actuales en Madrid, como "YYYY-MM-DD" y minutos del día
function ahoraMadrid(sumarMin = 0) {
  const d = new Date(Date.now() + sumarMin * 60000);
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d).map(x => [x.type, x.value]));
  return { fecha: `${p.year}-${p.month}-${p.day}`, min: (+p.hour % 24) * 60 + (+p.minute) };
}
const aMin = (h) => { const m = String(h || '').match(/(\d{1,2}):(\d{2})/); return m ? +m[1] * 60 + +m[2] : -1; };
const fechaISO = (f) => { const v = String(f || ''); const m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : v.slice(0, 10); };
const fisioDe = (v) => { if (!v) return ''; if (Array.isArray(v)) v = v[0]; return typeof v === 'object' ? (v.name || '') : String(v); };

// ¿Este hueco se puede reservar ahora? (libre, con fisio de verdad y con margen)
function reservable(f) {
  if (!LIBRES.includes(String(f['ESTADO'] || '').trim())) return false;
  const fisio = fisioDe(f['PREF.']);
  if (!fisio || /NO HAY FISIO|TODOS|\?\?|FIESTA/i.test(fisio)) return false;
  const fecha = fechaISO(f['FECHA']), min = aMin(f['HORA']);
  if (!fecha || min < 0) return false;
  const lim = ahoraMadrid(MARGEN_MIN);
  return fecha > lim.fecha || (fecha === lim.fecha && min >= lim.min);
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { headers: H });
  const url = new URL(req.url);

  // ── Lista de huecos libres ───────────────────────────────────────
  if (req.method === 'GET') {
    try {
      const formula = `AND(OR(${LIBRES.map(e => `{ESTADO}="${e}"`).join(',')}),IS_AFTER({FECHA},DATEADD(TODAY(),-1,'days')),IS_BEFORE({FECHA},DATEADD(TODAY(),${DIAS_VISTA},'days')))`;
      const campos = ['FECHA', 'HORA', 'ESTADO', 'PREF.'].map(f => `fields[]=${encodeURIComponent(f)}`).join('&');
      let recs = [], off = '';
      do {
        const r = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${CITAS}?${campos}&filterByFormula=${encodeURIComponent(formula)}&pageSize=100${off ? '&offset=' + off : ''}`, { headers: AT });
        const d = await r.json();
        if (d.error) throw new Error(d.error.message || 'Airtable');
        recs = recs.concat(d.records || []); off = d.offset || '';
      } while (off && recs.length < 1500);
      const huecos = recs.filter(r => reservable(r.fields)).map(r => ({
        id: r.id, fecha: fechaISO(r.fields['FECHA']), hora: String(r.fields['HORA']).slice(0, 5), fisio: fisioDe(r.fields['PREF.'])
      })).sort((a, b) => (a.fecha + a.hora + a.fisio).localeCompare(b.fecha + b.hora + b.fisio));
      return json({ ok: true, huecos });
    } catch (e) { return json({ ok: false, error: e.message }, 500); }
  }

  // ── Reservar un hueco ────────────────────────────────────────────
  if (req.method === 'POST') {
    let body = {};
    try { body = await req.json(); } catch (e) { return json({ ok: false, error: 'Petición no válida' }, 400); }
    const { patientId, huecoId } = body;
    if (!idValido(patientId) || !idValido(huecoId)) return json({ ok: false, error: 'Datos no válidos' }, 400);
    try {
      // El paciente existe
      const pr = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${PACIENTES}/${patientId}`, { headers: AT });
      if (!pr.ok) return json({ ok: false, error: 'Paciente no encontrado' }, 404);

      // El hueco sigue libre
      const hr = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${CITAS}/${huecoId}`, { headers: AT });
      const h = await hr.json();
      if (!hr.ok || !h.fields) return json({ ok: false, error: 'Ese hueco ya no existe' }, 404);
      if (!reservable(h.fields)) return json({ ok: false, ocupado: true, error: 'Vaya, alguien acaba de coger este hueco. Elige otro.' }, 409);

      // Reservar: pasa a PENDIENTE y se enlaza al paciente
      const ur = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${CITAS}/${huecoId}`, {
        method: 'PATCH', headers: AT,
        body: JSON.stringify({ fields: { 'ESTADO': 'PENDIENTE ', 'RELACIÓN - CITA': [patientId], 'TIPO DE CITA': [...new Set([...(Array.isArray(h.fields['TIPO DE CITA']) ? h.fields['TIPO DE CITA'] : []), TIPO_APP])] } })
      });
      const u = await ur.json();
      if (!ur.ok) return json({ ok: false, error: u.error?.message || 'No se ha podido reservar' }, 500);
      // Comprobar de nuevo un instante después por si dos personas pulsaron a la vez
      await new Promise(r => setTimeout(r, 700));
      const vr = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${CITAS}/${huecoId}`, { headers: AT });
      const v = vr.ok ? await vr.json() : u;
      const rel = v.fields?.['RELACIÓN - CITA'] || [];
      if (!rel.includes(patientId)) return json({ ok: false, ocupado: true, error: 'Vaya, alguien acaba de coger este hueco. Elige otro.' }, 409);

      // Etapa del paciente: si nunca ha hecho una sesión → PACIENTE NUEVO; si ya vino → ACTIVO (quita Alta, Seguimiento…)
      try { await ponerEtapaCita(patientId); } catch (e) {}
      return json({ ok: true, cita: { id: u.id, fecha: fechaISO(u.fields['FECHA']), hora: String(u.fields['HORA'] || '').slice(0, 5), fisio: fisioDe(u.fields['PREF.']), estado: 'PENDIENTE ' } });
    } catch (e) { return json({ ok: false, error: e.message }, 500); }
  }

  return json({ ok: false, error: 'Método no permitido' }, 405);
}
