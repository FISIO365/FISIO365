export const config = { runtime: 'edge' };

const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const BASE_ID = 'appsrGnHpFt8sVD5A';
const CITAS_TABLE = 'tblTPlcuiSjQngkaD';
const PACIENTES_TABLE = 'tbldBVgClS4HY2mOJ';

export default async function handler(req) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    // Calcular la fecha de mañana en formato YYYY-MM-DD
    const hoy = new Date();
    const mañana = new Date(hoy);
    mañana.setDate(hoy.getDate() + 1);
    const yyyy = mañana.getFullYear();
    const mm = String(mañana.getMonth() + 1).padStart(2, '0');
    const dd = String(mañana.getDate()).padStart(2, '0');
    const fechaMañana = `${yyyy}-${mm}-${dd}`;

    // 1. Leer citas de mañana
    const fields = ['FECHA', 'HORA', 'ESTADO', 'PREF.', 'TIPO DE CITA', 'RELACIÓN - CITA'];
    const fp = fields.map(f => `fields[]=${encodeURIComponent(f)}`).join('&');
    const sortQ = 'sort[0][field]=HORA&sort[0][direction]=asc';

    let allRecords = [], offset = null;
    do {
      const offsetQ = offset ? `&offset=${offset}` : '';
      const r = await fetch(
        `https://api.airtable.com/v0/${BASE_ID}/${CITAS_TABLE}?${fp}&${sortQ}&pageSize=100${offsetQ}`,
        { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } }
      );
      const data = await r.json();
      if (data.error) return new Response(JSON.stringify({ ok: false, error: data.error.message }), { headers: corsHeaders });
      allRecords = allRecords.concat(data.records || []);
      offset = data.offset;
    } while (offset);

    // Filtrar por fecha de mañana y estado pendiente
    const citasMañana = allRecords.filter(rec => {
      const fecha = (rec.fields['FECHA'] || '').substring(0, 10);
      const estado = (rec.fields['ESTADO'] || '').trim().toUpperCase();
      return fecha === fechaMañana && estado.includes('PENDIENTE');
    });

    if (!citasMañana.length) {
      return new Response(JSON.stringify({ ok: true, citas: [] }), { headers: corsHeaders });
    }

    // 2. Recoger los IDs de paciente vinculados
    const pacienteIds = new Set();
    citasMañana.forEach(rec => {
      const rel = rec.fields['RELACIÓN - CITA'];
      if (Array.isArray(rel)) rel.forEach(id => pacienteIds.add(id));
    });

    // 3. Leer los datos de esos pacientes (nombre + teléfono SMS)
    const pacientesData = {};
    const idsArray = Array.from(pacienteIds);
    for (let i = 0; i < idsArray.length; i += 10) {
      const batch = idsArray.slice(i, i + 10);
      const formula = `OR(${batch.map(id => `RECORD_ID()="${id}"`).join(',')})`;
      const r = await fetch(
        `https://api.airtable.com/v0/${BASE_ID}/${PACIENTES_TABLE}?filterByFormula=${encodeURIComponent(formula)}&fields[]=Full%20Name&fields[]=SMS`,
        { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } }
      );
      const data = await r.json();
      (data.records || []).forEach(rec => {
        pacientesData[rec.id] = {
          nombre: rec.fields['Full Name'] || '',
          telefono: rec.fields['SMS'] || ''
        };
      });
    }

    // 4. Construir respuesta final
    const citas = citasMañana.map(rec => {
      const rel = rec.fields['RELACIÓN - CITA'];
      const pacienteId = Array.isArray(rel) && rel.length ? rel[0] : null;
      const pacInfo = pacienteId ? pacientesData[pacienteId] : null;

      const fisioRaw = rec.fields['PREF.'];
      let fisio = '';
      if (Array.isArray(fisioRaw)) fisio = fisioRaw.filter(x => !String(x).startsWith('rec')).join(', ');
      else if (fisioRaw && !String(fisioRaw).startsWith('rec')) fisio = String(fisioRaw);

      const tipoRaw = rec.fields['TIPO DE CITA'];
      let tipo = '';
      if (Array.isArray(tipoRaw)) tipo = tipoRaw.filter(x => !String(x).startsWith('rec')).join(', ');
      else if (tipoRaw && !String(tipoRaw).startsWith('rec')) tipo = String(tipoRaw);

      return {
        id: rec.id,
        hora: rec.fields['HORA'] || '',
        estado: rec.fields['ESTADO'] || '',
        fisio,
        tipo,
        pacienteNombre: pacInfo ? pacInfo.nombre : 'Paciente',
        pacienteTelefono: pacInfo ? pacInfo.telefono : ''
      };
    });

    return new Response(JSON.stringify({ ok: true, fecha: fechaMañana, citas }), { headers: corsHeaders });

  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: corsHeaders });
  }
}
