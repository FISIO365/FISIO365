"use strict";
// Se ejecuta una vez al día (vercel.json → crons, 17:00 UTC = 18-19 h en Madrid)
//  1. Recordatorio de cita: a quien tiene cita PENDIENTE mañana
//  2. Recordatorio de ejercicios: solo lunes y jueves, a quien lleva 2+ días sin hacerlos
//     (y los ha hecho en el último mes; si mañana tiene cita, solo le llega el de la cita)
const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const { enviar, BASE_ID, TABLAS } = require('./_push');
const CITAS_TABLE = 'tblTPlcuiSjQngkaD';
const TAREAS_TABLE = 'tblIXYE5ToRNY7MN4'; // cada vez que un paciente pulsa «He terminado por hoy»
const AT = { Authorization: `Bearer ${AIRTABLE_TOKEN}` };

// Fecha en Madrid, desplazada n días, como YYYY-MM-DD; y día de la semana (0 = domingo)
function madrid(n = 0) {
  const d = new Date(Date.now() + n * 864e5);
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' }).formatToParts(d).map(x => [x.type, x.value]));
  return { fecha: `${p.year}-${p.month}-${p.day}`, dia: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday) };
}
async function todos(tabla, query) {
  let recs = [], off = '';
  do {
    const r = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${tabla}?${query}&pageSize=100${off ? '&offset=' + off : ''}`, { headers: AT });
    const d = await r.json();
    if (d.error) throw new Error(d.error.message || d.error.type || 'Airtable');
    recs = recs.concat(d.records || []); off = d.offset || '';
  } while (off);
  return recs;
}
const fisioDe = v => { if (!v) return ''; if (Array.isArray(v)) v = v[0]; v = typeof v === 'object' ? v.name : String(v); return /^rec|NO HAY|TODOS|\?\?/i.test(v) ? '' : v; };
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

module.exports = async function handler(req, res) {
  if (req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) return res.status(401).json({ ok: false });
  const hoy = madrid(0), manana = madrid(1), ayer = madrid(-1), hace30 = madrid(-30);
  const out = { citas: 0, ejercicios: 0, errores: 0 };
  try {
    // Pacientes con avisos activados
    const pacs = await todos(TABLAS.paciente, `filterByFormula=${encodeURIComponent('{PushSubscription}!=""')}&fields[]=PushSubscription&fields[]=UltimaSession`);
    const subDe = {}; pacs.forEach(p => { try { subDe[p.id] = JSON.parse(p.fields.PushSubscription); } catch (e) {} });

    // 1. Citas de mañana
    const citas = await todos(CITAS_TABLE, `filterByFormula=${encodeURIComponent(`AND(DATETIME_FORMAT({FECHA},'YYYY-MM-DD')='${manana.fecha}',TRIM({ESTADO})='PENDIENTE')`)}&fields[]=HORA&fields[]=${encodeURIComponent('PREF.')}&fields[]=${encodeURIComponent('RELACIÓN - CITA')}&sort[0][field]=HORA`);
    const yaAvisado = new Set();
    for (const c of citas) {
      const pid = (c.fields['RELACIÓN - CITA'] || [])[0];
      if (!pid || !subDe[pid] || yaAvisado.has(pid)) continue;
      yaAvisado.add(pid);
      const hora = String(c.fields['HORA'] || '').slice(0, 5), fisio = fisioDe(c.fields['PREF.']);
      const ok = await enviar(subDe[pid], {
        title: 'Mañana tienes cita',
        body: `${DIAS[manana.dia].replace(/^./, m => m.toUpperCase())}${hora ? ' a las ' + hora : ''}${fisio ? ' con ' + fisio : ''}.`,
        url: '/?s=citas', tag: 'cita'
      });
      ok ? out.citas++ : out.errores++;
    }

    // 2. Ejercicios: solo lunes (1) y jueves (4)
    if (hoy.dia === 1 || hoy.dia === 4) {
      const recientes = new Set();
      pacs.forEach(p => { const u = String(p.fields.UltimaSession || '').slice(0, 10); if (u >= ayer.fecha) recientes.add(p.id); });
      // Tareas de la más reciente a la más antigua; se para al llegar a antes de ayer
      let off = '', seguir = true;
      do {
        const r = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${TAREAS_TABLE}?fields[]=PacienteId&fields[]=Fecha&sort[0][field]=Fecha&sort[0][direction]=desc&pageSize=100${off ? '&offset=' + off : ''}`, { headers: AT });
        const d = await r.json();
        if (d.error) throw new Error('Tareas: ' + (d.error.message || d.error));
        for (const t of (d.records || [])) {
          const f = String(t.fields?.Fecha || '').slice(0, 10);
          if (f >= ayer.fecha) recientes.add(t.fields?.PacienteId || '');
          else if (f) { seguir = false; break; }
        }
        off = d.offset || '';
      } while (off && seguir);
      for (const p of pacs) {
        if (recientes.has(p.id) || !subDe[p.id] || yaAvisado.has(p.id)) continue;
        // Solo pacientes en tratamiento: que hayan hecho ejercicios en el último mes
        const ult = String(p.fields.UltimaSession || '').slice(0, 10);
        if (!ult || ult < hace30.fecha) continue;
        const ok = await enviar(subDe[p.id], {
          title: '¿Hacemos los ejercicios?',
          body: 'Hace un par de días que no los haces. Son solo unos minutos y es lo que más te ayuda a mejorar.',
          url: '/?s=hoy', tag: 'ejercicios'
        });
        ok ? out.ejercicios++ : out.errores++;
      }
    }
    return res.status(200).json({ ok: true, fecha: hoy.fecha, ...out });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message, ...out });
  }
};
