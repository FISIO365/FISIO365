// Datos falsos (inventados) con la forma de la base real, para probar api/_pg.js sin datos de pacientes
const S = require('../../api/_schema.json');
const crypto = require('crypto');
const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const rnd = Math.random;
const pick = L => L[Math.floor(rnd() * L.length)];
const usados = new Set();
const rid = () => { let s; do { s = 'rec'; const b = crypto.randomBytes(14); for (let i = 0; i < 14; i++) s += A[b[i] % 62]; } while (usados.has(s)); usados.add(s); return s; };
const NOM = ['Laura', 'Pablo', 'Marta', 'Jordi', 'Ana', 'Carlos', 'Elena', 'Lucía', 'Sergio', 'Nuria'], APE = ['Martín', 'Ruiz', 'Gil', 'Vidal', 'Torres', 'Soler', 'Prat', 'Ferrer', 'Pons', 'Serra'];
const iso = d => d.toISOString().slice(0, 10);
const hoy = new Date(); hoy.setUTCHours(0, 0, 0, 0);
const CUENTA = { CITAS: 10700, PACIENTES: 1800, CONSENTIMIENTOS: 300 };
module.exports = function () {
  const T = {}; const ids = {};
  S.tables.forEach(t => { ids[t.id] = []; const n = CUENTA[t.name] != null ? CUENTA[t.name] : 12; for (let i = 0; i < n; i++) ids[t.id].push(rid()); });
  const fisios = ['Sara', 'Jonathan', 'Juan', 'Ramiro'];
  S.tables.forEach(t => {
    T[t.id] = ids[t.id].map((id, i) => {
      const F = {};
      t.fields.forEach(f => {
        if (rnd() < 0.15 && f.id !== t.primary) return;
        const n = f.name;
        switch (f.type) {
          case 'singleLineText': case 'multilineText': case 'richText':
            if (/NAME|NOMBRE|Nombre/.test(n)) F[n] = pick(NOM) + ' ' + pick(APE) + ' ' + pick(APE);
            else if (/HORA/.test(n)) F[n] = String(8 + Math.floor(rnd() * 12)).padStart(2, '0') + ':' + pick(['00', '30']);
            else if (/PacienteI[dD]|PacRec|^Paciente$/.test(n)) F[n] = pick(ids[S.tables.find(x => x.name === 'PACIENTES').id]);
            else if (/fisio|Fisio|FISIO|PREF/.test(n)) F[n] = pick(fisios);
            else if (/PIN/.test(n)) F[n] = String(1000 + Math.floor(rnd() * 9000));
            else F[n] = 'Texto ' + Math.floor(rnd() * 1000);
            break;
          case 'email': F[n] = 'demo' + i + '@ejemplo.com'; break;
          case 'phoneNumber': F[n] = '6' + String(10000000 + Math.floor(rnd() * 89999999)); break;
          case 'url': F[n] = 'https://ejemplo.com/' + i; break;
          case 'number': case 'currency': case 'percent': F[n] = Math.floor(rnd() * 100); break;
          case 'checkbox': if (rnd() < 0.4) F[n] = true; break;
          case 'date': { const d = new Date(hoy.getTime() + Math.floor((rnd() - 0.8) * 400) * 864e5); F[n] = iso(d); break; }
          case 'dateTime': F[n] = new Date(hoy.getTime() + Math.floor((rnd() - 0.8) * 400 * 864e5)).toISOString(); break;
          case 'singleSelect': if (f.o && f.o.choices && f.o.choices.length) F[n] = pick(f.o.choices); break;
          case 'multipleSelects': if (f.o && f.o.choices && f.o.choices.length) F[n] = [pick(f.o.choices)]; break;
          case 'multipleRecordLinks': {
            const L = ids[f.o.link]; if (!L || !L.length) break;
            // Solo el lado «principal» del enlace; el inverso se rellena después
            const inv = S.tables.find(x => x.id === f.o.link).fields.find(x => x.id === f.o.inverse);
            if (f.o.single || (inv && !inv.o.single && t.name !== 'PACIENTES' && !(t.name === 'TIPO DE CITA'))) F[n] = [pick(L)];
            break;
          }
          case 'aiText': F[n] = { state: 'generated', value: 'Resumen ' + i, isStale: false }; break;
          case 'autoNumber': F[n] = i + 1; break;
        }
      });
      return { id, fields: F, creado: new Date(hoy.getTime() - (ids[t.id].length - i) * 3600e3).toISOString() };
    });
  });
  // Inversos de los enlaces
  const porId = {}; S.tables.forEach(t => T[t.id].forEach(r => { porId[r.id] = { t: t.id, r }; }));
  S.tables.forEach(t => t.fields.filter(f => f.type === 'multipleRecordLinks').forEach(f => {
    const inv = S.tables.find(x => x.id === f.o.link).fields.find(x => x.id === f.o.inverse); if (!inv) return;
    T[t.id].forEach(r => (r.fields[f.name] || []).forEach(o => { const x = porId[o]; if (!x) return; const L = x.r.fields[inv.name] || (x.r.fields[inv.name] = []); if (!L.includes(r.id)) L.push(r.id); }));
  }));
  return T;
};
