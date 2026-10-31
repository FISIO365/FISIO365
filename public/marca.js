// Marca de la clínica en la app del paciente y en el panel: color, logo y (en la app) los textos.
// Para FISIO365 no hace nada: si los datos son los de siempre, no hay nada que cambiar.
(function () {
  var TEXTO = !!window.MARCA_TEXTOS; // la app del paciente cambia también los textos (nombre, teléfono…)
  function aplicar(d) {
    if (!d || !d.ok) return;
    window.CLINICA = d.clinica;
    var P = d.pares || [], C = d.clinica || {};
    // Nombre e icono de la app instalada (al añadirla a la pantalla de inicio)
    try {
      if (C.marca && C.marca !== 'FISIO365') {
        if (document.title.indexOf('FISIO365') > -1) document.title = document.title.split('FISIO365').join(C.marca);
        var mt = document.querySelector('meta[name="apple-mobile-web-app-title"]'); if (mt) mt.setAttribute('content', mt.getAttribute('content').split('FISIO365').join(C.marca));
      }
      if (C.icono) document.querySelectorAll('link[rel="apple-touch-icon"]').forEach(function (l) { l.setAttribute('href', C.icono); });
    } catch (e) {}
    // Pares de color (empiezan por # o son el rgb del coral) y, en la app, también los de texto
    var col = P.filter(function (p) { return /^#[0-9a-fA-F]{6}$/.test(p[0]) || /^194, ?85, ?46$/.test(p[0]); });
    var txt = TEXTO ? P.filter(function (p) { return col.indexOf(p) < 0; }) : [];
    var todos = col.concat(txt);
    var fx = function (L, s) { s = String(s); for (var i = 0; i < L.length; i++) if (s.indexOf(L[i][0]) > -1) s = s.split(L[i][0]).join(L[i][1]); return s; };
    // Logos escritos como texto («FISIO365» con el 365 en color): logo subido o nombre de la clínica
    var logos = function (root) {
      if (!C.logo && C.marca === 'FISIO365') return;
      (root.querySelectorAll ? root : document).querySelectorAll('.sb-logo-t,.logo-fisio,.topbar-logo,.com-logo').forEach(function (el) {
        if (el.dataset.marca) return; el.dataset.marca = 1;
        if (C.logo) el.innerHTML = '<img src="' + C.logo + '" alt="" style="height:1.6em;max-width:180px;object-fit:contain;display:block">';
        else el.textContent = C.marca;
      });
      if (C.logo) (root.querySelectorAll ? root : document).querySelectorAll('img[src$="/informe/logo.png"]').forEach(function (im) { im.src = C.logo; });
    };
    // Mensajes que salen de la app (WhatsApp, email, SMS, copiar): también con los datos de la clínica
    window.marcaTexto = function (t) { return txt.length ? fx(txt, String(t == null ? '' : t)) : t; };
    window.marcaUrl = function (u) {
      if (!txt.length || typeof u !== 'string' || !/^(https:\/\/(wa\.me|api\.whatsapp\.com|web\.whatsapp\.com)\/|whatsapp:\/\/|mailto:|sms:)/i.test(u)) return u;
      var q = u.indexOf('?'); if (q < 0) return u;
      return u.slice(0, q + 1) + u.slice(q + 1).split('&').map(function (kv) { var i = kv.indexOf('='); if (i < 0) return kv; var k = kv.slice(0, i), v = kv.slice(i + 1);
        if (!/^(text|body|subject)$/i.test(k)) return kv; var d; try { d = decodeURIComponent(v.replace(/\+/g, '%20')); } catch (e) { return kv; } return k + '=' + encodeURIComponent(fx(txt, d)); }).join('&');
    };
    if (txt.length && !window.__marcaSalida) {
      window.__marcaSalida = 1;
      var abrir = window.open; window.open = function (u) { var a = Array.prototype.slice.call(arguments); if (typeof a[0] === 'string') a[0] = window.marcaUrl(a[0]); return abrir.apply(window, a); };
      try { var cb = navigator.clipboard, wt = cb && cb.writeText && cb.writeText.bind(cb); if (wt) cb.writeText = function (t) { return wt(window.marcaTexto(t)); }; } catch (e) {}
      try { if (navigator.share) { var sh = navigator.share.bind(navigator); navigator.share = function (o) { o = Object.assign({}, o || {}); if (o.text) o.text = window.marcaTexto(o.text); if (o.title) o.title = window.marcaTexto(o.title); return sh(o); }; } } catch (e) {}
    }
    if (!todos.length) { logos(document); return; }
    // Hojas de estilo
    var estilos = function () { document.querySelectorAll('style').forEach(function (st) { if (st.dataset.marca) return; var v = fx(col, st.textContent); if (v !== st.textContent) st.textContent = v; st.dataset.marca = 1; }); };
    var ATR = ['style', 'fill', 'stroke', 'stop-color', 'color'], ATR_T = ['title', 'alt', 'placeholder', 'aria-label', 'href'];
    var walk = function (n) {
      if (!n) return;
      if (n.nodeType === 3) { if (txt.length) { var v = fx(txt, n.nodeValue); if (v !== n.nodeValue) n.nodeValue = v; } return; }
      if (n.nodeType !== 1) return;
      if (n.tagName === 'STYLE') { var s = fx(col, n.textContent); if (s !== n.textContent) n.textContent = s; return; }
      if (/^(SCRIPT|TEXTAREA|INPUT)$/.test(n.tagName)) return;
      ATR.forEach(function (a) { var v = n.getAttribute(a); if (v) { var w = fx(col, v); if (w !== v) n.setAttribute(a, w); } });
      if (txt.length) ATR_T.forEach(function (a) { var v = n.getAttribute(a); if (v) { var w = a === 'href' && /^(https:\/\/(wa\.me|api\.whatsapp\.com|web\.whatsapp\.com)\/|mailto:|sms:)/i.test(v) ? window.marcaUrl(v) : fx(txt, v); if (w !== v) n.setAttribute(a, w); } });
      for (var i = 0; i < n.childNodes.length; i++) walk(n.childNodes[i]);
    };
    estilos();
    var meta = document.querySelector('meta[name="theme-color"]'); if (meta) meta.setAttribute('content', fx(col, meta.getAttribute('content') || ''));
    if (txt.length) document.title = fx(txt, document.title);
    walk(document.body); logos(document);
    new MutationObserver(function (ms) {
      ms.forEach(function (m) {
        if (m.type === 'characterData') walk(m.target);
        else if (m.type === 'attributes') walk(m.target);
        else for (var i = 0; i < m.addedNodes.length; i++) { walk(m.addedNodes[i]); if (m.addedNodes[i].nodeType === 1) logos(m.addedNodes[i]); }
      });
    }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['style'] });
  }
  try {
    var guardado = null; try { guardado = JSON.parse(localStorage.getItem('f365_marca') || 'null'); } catch (e) {}
    if (guardado) { if (document.body) aplicar(guardado); else document.addEventListener('DOMContentLoaded', function () { aplicar(guardado); }); }
    fetch('/api/schedule?action=clinica-pub').then(function (r) { return r.json(); }).then(function (d) {
      try { localStorage.setItem('f365_marca', JSON.stringify(d)); } catch (e) {}
      if (!guardado || JSON.stringify(guardado) !== JSON.stringify(d)) { if (document.body) aplicar(d); else document.addEventListener('DOMContentLoaded', function () { aplicar(d); }); }
    }).catch(function () {});
  } catch (e) {}
})();
