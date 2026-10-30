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
  // [texto de FISIO365, dato de la clínica del que depende, por qué se cambia]. Solo si ese dato es distinto del de FISIO365.
  const L = [
    ['Carrer Gran de Sant Andreu, 163<br>Sant Andreu – 08030 Barcelona', 'direccion'],
    ['Carrer Gran de Sant Andreu, 163 · Sant Andreu – 08030 Barcelona', 'direccion'],
    [D.direccion, 'direccion'],
    ['C/ Gran de Sant Andreu 163, 08030 Barcelona', 'direccion'],
    ['C/ Gran de Sant Andreu, 163 · Barcelona', 'dirCorta'],
    [D.dirCorta, 'dirCorta'],
    ['Gran de Sant Andreu 163, Barcelona', 'dirCorta'],
    ['Carrer Gran de Sant Andreu, 163', 'calle'],
    ['Gran de Sant Andreu 163', 'calle'],
    ['Gran de Sant Andreu', 'zona'],
    [mayus(D.razon), 'razon', mayus],
    [D.razon, 'razon'],
    [D.nif, 'nif'],
    [D.iban, 'iban'],
    [D.email, 'email'],
    [D.tel, 'tel'],
    ['672 893 949', 'tel'],
    [D.wa, 'wa'],
    [D.googlePlace, 'googlePlace'],
    [D.zona, 'zona'],
    ['(Barcelona)', 'ciudad', v => '(' + v + ')'],
    [D.marca, 'marca']
  ];
  return L.filter(([, k]) => C[k] && C[k] !== D[k]).map(([a, k, f]) => [a, f ? f(C[k]) : C[k]]).filter(([a, b]) => a !== b);
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
