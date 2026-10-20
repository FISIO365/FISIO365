export const config = { runtime: 'edge' };

const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const BASE_ID = 'appsrGnHpFt8sVD5A';
const CITAS_TABLE = 'tblTPlcuiSjQngkaD';
const PACIENTES_TABLE = 'tbldBVgClS4HY2mOJ';
const CAMPO_CITAS = 'fld399NbGmV29rfjp'; // PACIENTES → sus citas (enlace inverso de «RELACIÓN - CITA»)

export default async function handler(req) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const url = new URL(req.url);
  const patientId = url.searchParams.get('patientId') || '';

  try {
    const fields = ['FECHA','HORA','ESTADO','PREF.','TIPO DE CITA','RELACIÓN - CITA'];
    const fp = fields.map(f=>`fields[]=${encodeURIComponent(f)}`).join('&');
    const sortQ = 'sort[0][field]=FECHA&sort[0][direction]=asc';

    const estadoFilter = 'OR({ESTADO}="PENDIENTE ",{ESTADO}="REALIZADA")';
    let pacienteCitas = null, pr_estado = 'sin paciente';

    // Rápido: leer del paciente la lista de sus citas (campo enlazado) y pedir solo esas
    if (/^rec[A-Za-z0-9]{14}$/.test(patientId)) {
      const pr = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${PACIENTES_TABLE}?filterByFormula=${encodeURIComponent(`RECORD_ID()="${patientId}"`)}&returnFieldsByFieldId=true&fields[]=${CAMPO_CITAS}&maxRecords=1`, { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } });
      pr_estado = pr.status;
      const pd = pr.ok ? await pr.json() : null;
      if (pd && pd.records && pd.records.length) {
        const f0 = pd.records[0].fields || {};
        const ids = f0[CAMPO_CITAS] || [];
        const trozos = [];
        for (let i = 0; i < ids.length; i += 60) trozos.push(ids.slice(i, i + 60));
        const res = await Promise.all(trozos.map(async t => {
          const f = encodeURIComponent(`AND(OR(${t.map(id => `RECORD_ID()="${id}"`).join(',')}),${estadoFilter})`);
          let recs = [], off = null;
          do {
            const r = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${CITAS_TABLE}?${fp}&${sortQ}&filterByFormula=${f}&pageSize=100${off ? '&offset=' + off : ''}`, { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } });
            const d = await r.json();
            if (d.error) throw new Error(d.error.message || 'Airtable');
            recs = recs.concat(d.records || []); off = d.offset;
          } while (off);
          return recs;
        }));
        pacienteCitas = res.flat();
        console.log('citas rápido', ids.length, 'enlazadas', pacienteCitas.length, 'válidas');
      }
    }

    // Respaldo (lento): recorrer todas las citas y filtrar
    if (!pacienteCitas) {
      console.log('citas: respaldo lento', pr_estado);
      let allRecords = [], offset = null;
      do {
        const offsetQ = offset ? `&offset=${offset}` : '';
        const r = await fetch(
          `https://api.airtable.com/v0/${BASE_ID}/${CITAS_TABLE}?${fp}&${sortQ}&filterByFormula=${encodeURIComponent(estadoFilter)}&pageSize=100${offsetQ}`,
          { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } }
        );
        const data = await r.json();
        if (data.error) return new Response(JSON.stringify({ ok: false, error: data.error.message }), { headers: corsHeaders });
        allRecords = allRecords.concat(data.records || []);
        offset = data.offset;
      } while(offset);
      pacienteCitas = patientId
        ? allRecords.filter(rec => { const rel = rec.fields['RELACIÓN - CITA']; return Array.isArray(rel) && rel.includes(patientId); })
        : allRecords;
    }
    const clave = (f) => { const v = String(f || ''); const m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); return m ? `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}` : v; };
    pacienteCitas.sort((x, y) => clave(x.fields['FECHA']).localeCompare(clave(y.fields['FECHA'])));

    const citas = pacienteCitas
      .filter(rec => {
        const e = (rec.fields['ESTADO'] || '').trim().toLowerCase();
        return e === 'pendiente' || e === 'realizada';
      })
      .map(rec => ({
        id: rec.id,
        fecha: rec.fields['FECHA'] || '',
        hora: rec.fields['HORA'] || '',
        estado: rec.fields['ESTADO'] || '',
        fisio: (() => {
          const v = rec.fields['PREF.'];
          if(!v) return '';
          if(Array.isArray(v)) return v.filter(x=>!String(x).startsWith('rec')).join(', ');
          return String(v).startsWith('rec') ? '' : String(v);
        })(),
        tipo: (() => {
          const v = rec.fields['TIPO DE CITA'];
          if(!v) return '';
          if(Array.isArray(v)) return v.filter(x=>!String(x).startsWith('rec')).join(', ');
          return String(v).startsWith('rec') ? '' : String(v);
        })()
      }));

    return new Response(JSON.stringify({ ok: true, citas }), { headers: corsHeaders });

  } catch(e) {
    return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: corsHeaders });
  }
}
