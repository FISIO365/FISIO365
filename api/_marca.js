// ── Marca de la clínica ──
// Todo lo que es «de FISIO365» (nombre, razón social, dirección, teléfono, reseñas…) sale de aquí.
// Los textos del código siguen escritos con los datos de FISIO365; si una clínica tiene otros datos
// en Administración › Ajustes › Datos de la clínica, se cambian al salir (páginas, emails, IA, previews).
// Para FISIO365 no cambia nada: si los datos son los de siempre, el texto sale tal cual.

const DEF = {
  marca: 'FISIO365',
  razon: 'Fourth Dynamic, S.L.',
  nif: 'B56503592',
  direccion: 'C/ Gran de Sant Andreu, 163 · 08030 Barcelona',
  dirCorta: 'Gran de Sant Andreu, 163 · Barcelona',
  zona: 'Sant Andreu',
  ciudad: 'Barcelona',
  tel: '672 89 39 49',
  wa: '34672893949',
  email: 'info@fisioterapia365.com',
  web: 'fisioterapia365.com',
  googlePlace: 'ChIJCadKnf2G6AIRcmUzdzMr4nk',
  iban: 'ES14 0182 2392 8002 0302 2638'
};
const OPC_DEF = { sorteo: true, bomba: true };

// Limpia un valor para poder meterlo en HTML, JS y JSON sin romper nada
const limpio = (v, n) => String(v == null ? '' : v).replace(/[\r\n\t]+/g, ' ').replace(/["'`\\<>$]/g, '').trim().slice(0, n || 160);

// Junta lo guardado con lo de siempre (lo vacío vuelve al valor de FISIO365)
function datos(guardado) {
  const g = guardado || {}, o = {};
  Object.keys(DEF).forEach(k => { const v = limpio(g[k], 200); o[k] = v || DEF[k]; });
  // Compatibilidad con los nombres antiguos de «Datos de la clínica»
  if (g.tel && !g.wa) { const d = String(g.tel).replace(/\D/g, ''); if (d.length === 9) o.wa = '34' + d; }
  const calle = s => String(s || '').split(/·|,(?=\s*\d{5})/)[0].trim();
  o.calle = calle(o.dirCorta) || calle(o.direccion);
  o.opciones = Object.assign({}, OPC_DEF, (g.opciones && typeof g.opciones === 'object') ? g.opciones : {});
  return o;
}

// Pares «texto de FISIO365 → texto de la clínica», de más largo a más corto. Solo los que cambian.
function pares(C) {
  const D = datos(null), mayus = s => String(s).toUpperCase();
  const L = [
    ['Carrer Gran de Sant Andreu, 163<br>Sant Andreu – 08030 Barcelona', C.direccion],
    ['Carrer Gran de Sant Andreu, 163 · Sant Andreu – 08030 Barcelona', C.direccion],
    [D.direccion, C.direccion],
    ['C/ Gran de Sant Andreu 163, 08030 Barcelona', C.direccion],
    ['C/ Gran de Sant Andreu, 163 · Barcelona', C.dirCorta],
    [D.dirCorta, C.dirCorta],
    ['Gran de Sant Andreu 163, Barcelona', C.dirCorta],
    ['Carrer Gran de Sant Andreu, 163', C.calle],
    ['Gran de Sant Andreu 163', C.calle],
    ['Gran de Sant Andreu', C.zona],
    [mayus(D.razon), mayus(C.razon)],
    [D.razon, C.razon],
    [D.nif, C.nif],
    [D.iban, C.iban],
    [D.email, C.email],
    [D.tel, C.tel],
    ['672 893 949', C.tel],
    [D.wa, C.wa],
    [D.googlePlace, C.googlePlace],
    [D.zona, C.zona],
    ['(Barcelona)', '(' + C.ciudad + ')'],
    [D.marca, C.marca]
  ];
  return L.filter(([a, b]) => b && a !== b);
}

// Cambia los textos de FISIO365 por los de la clínica. json=true: el texto va dentro de un JSON (emails, IA)
function marcar(txt, C, json) {
  if (typeof txt !== 'string' || !C) return txt;
  const P = C._pares || (C._pares = pares(C));
  if (!P.length) return txt;
  let s = txt;
  P.forEach(([a, b]) => { if (s.includes(a)) s = s.split(a).join(json ? JSON.stringify(b).slice(1, -1) : b); });
  return s;
}

module.exports = { DEF, OPC_DEF, datos, pares, marcar, limpio };
