// Visor de archivos dentro de la app (PWA instalada): los PDFs, documentos y páginas propias se abren
// en una capa con «✕ Cerrar», en vez de una ventana nueva sin botón para volver.
// Los enlaces externos (WhatsApp, email, otras webs) se siguen abriendo como siempre.
(function () {
  var standalone = false;
  try { standalone = window.matchMedia('(display-mode: standalone)').matches || !!navigator.standalone; } catch (e) {}
  if (!standalone) return;
  var orig = window.open.bind(window), PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
  var propio = function (u) { try { var x = new URL(u, location.href); return x.origin === location.origin; } catch (e) { return false; } };
  var esDoc = function (u) { return /^blob:|^data:/.test(u) || /\.(pdf|png|jpe?g|webp|gif|heic)(\?|#|$)/i.test(u) || /airtableusercontent\.com/.test(u) || (propio(u) && !/\/(fisio|index\.html)?(\?|#|$)/.test(new URL(u, location.href).pathname)); };

  var css = '.vz{position:fixed;inset:0;z-index:2147483000;background:#efebe5;display:flex;flex-direction:column;font-family:Poppins,system-ui,sans-serif;animation:vzin .22s ease-out}' +
    '@keyframes vzin{from{transform:translateY(24px);opacity:0}}' +
    '.vz-b{flex:none;display:flex;align-items:center;gap:10px;padding:calc(env(safe-area-inset-top,0px) + 10px) 14px 10px;background:#fff;border-bottom:1px solid #efe6de}' +
    '.vz-x{flex:none;display:inline-flex;align-items:center;gap:6px;border:none;background:#f3efea;color:#2b2420;font:600 14px Poppins,sans-serif;border-radius:99px;padding:9px 15px;cursor:pointer}' +
    '.vz-x svg,.vz-s svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}' +
    '.vz-t{flex:1;min-width:0;font-size:14px;font-weight:600;color:#2b2420;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:center}' +
    '.vz-s{flex:none;display:inline-flex;align-items:center;gap:6px;border:none;background:#c2552e;color:#fff;font:600 14px Poppins,sans-serif;border-radius:99px;padding:9px 15px;cursor:pointer}' +
    '.vz-c{flex:1;overflow:auto;-webkit-overflow-scrolling:touch;padding:12px 10px calc(env(safe-area-inset-bottom,0px) + 16px)}' +
    '.vz-c canvas,.vz-c img{display:block;width:100%;max-width:900px;margin:0 auto 10px;background:#fff;border-radius:8px;box-shadow:0 2px 10px rgba(20,20,20,.08)}' +
    '.vz-c iframe{display:block;width:100%;height:100%;border:0;background:#fff;border-radius:10px}.vz-c.fr{padding:0}.vz-c.fr iframe{border-radius:0}' +
    '.vz-m{text-align:center;color:#8a7d74;font-size:14px;padding:40px 10px}';
  var st = document.createElement('style'); st.textContent = css; (document.head || document.documentElement).appendChild(st);

  var cargarPdfjs = function () {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    return new Promise(function (ok, ko) { var s = document.createElement('script'); s.src = PDFJS + 'pdf.min.js'; s.onload = function () { window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.js'; ok(window.pdfjsLib); }; s.onerror = ko; document.head.appendChild(s); });
  };
  var nombreDe = function (u, n) { if (n) return n; try { var p = decodeURIComponent(new URL(u, location.href).pathname.split('/').pop() || ''); return /\.\w{2,4}$/.test(p) ? p : 'Documento'; } catch (e) { return 'Documento'; } };

  function abrir(u, nombre, html) {
    var prevOv = document.body.style.overflow, blob = null, nom = nombreDe(u || '', nombre);
    var v = document.createElement('div'); v.className = 'vz';
    v.innerHTML = '<div class="vz-b"><button type="button" class="vz-x"><svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg>Volver</button><div class="vz-t"></div><button type="button" class="vz-s" hidden><svg viewBox="0 0 24 24"><path d="M12 15V4M7.5 8.5 12 4l4.5 4.5M5 14v5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5"/></svg>Guardar</button></div><div class="vz-c"><div class="vz-m">Cargando…</div></div>';
    v.querySelector('.vz-t').textContent = nom.replace(/\.(pdf|png|jpe?g|webp)$/i, '').replace(/_/g, ' ');
    document.body.appendChild(v); document.body.style.overflow = 'hidden';
    var cerrar = function () { v.remove(); document.body.style.overflow = prevOv; try { history.state && history.state.vz && history.back(); } catch (e) {} window.removeEventListener('popstate', alVolver); };
    var alVolver = function () { if (v.isConnected) { v.remove(); document.body.style.overflow = prevOv; } window.removeEventListener('popstate', alVolver); };
    try { history.pushState({ vz: 1 }, ''); window.addEventListener('popstate', alVolver); } catch (e) {}
    v.querySelector('.vz-x').onclick = cerrar;
    var c = v.querySelector('.vz-c'), sb = v.querySelector('.vz-s');
    var iframe = function (src) { c.className = 'vz-c fr'; c.innerHTML = ''; var f = document.createElement('iframe'); if (html != null) f.srcdoc = html; else f.src = src; c.appendChild(f); };
    if (html != null) return iframe();
    var pinta = function (b) {
      blob = b; var t = b.type || '';
      if (/\.pdf(\?|#|$)/i.test(u) && !/pdf/.test(t)) t = 'application/pdf';
      sb.hidden = false;
      if (/pdf/.test(t)) {
        return cargarPdfjs().then(function (lib) { return b.arrayBuffer().then(function (ab) { return lib.getDocument({ data: ab }).promise; }); }).then(function (pdf) {
          c.innerHTML = ''; var w = Math.min(c.clientWidth - 20, 900), dpr = Math.min(window.devicePixelRatio || 1, 2), n = 0;
          var sig = function () { if (++n > pdf.numPages || !v.isConnected) return; return pdf.getPage(n).then(function (pg) { var vp0 = pg.getViewport({ scale: 1 }), vp = pg.getViewport({ scale: w / vp0.width * dpr }), cv = document.createElement('canvas'); cv.width = vp.width; cv.height = vp.height; c.appendChild(cv); return pg.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise.then(sig); }); };
          return sig();
        }).catch(function () { iframe(URL.createObjectURL(b)); });
      }
      if (/^image\//.test(t)) { c.innerHTML = ''; var im = document.createElement('img'); im.src = URL.createObjectURL(b); c.appendChild(im); return; }
      iframe(URL.createObjectURL(b));
    };
    // Páginas propias (HTML) en un iframe; archivos: se descargan para verlos aquí
    if (propio(u) && !/^blob:/.test(u) && !/\.(pdf|png|jpe?g|webp)(\?|$)/i.test(u) && !/[?&]pdf=1/.test(u)) { sb.hidden = true; return iframe(u); }
    fetch(u).then(function (r) { if (!r.ok) throw 0; return r.blob(); }).then(pinta).catch(function () { iframe(u); });
    sb.onclick = function () {
      if (!blob) return;
      var nf = /\.\w{2,4}$/.test(nom) ? nom : nom + (/pdf/.test(blob.type) ? '.pdf' : '');
      try { var f = new File([blob], nf, { type: blob.type }); if (navigator.canShare && navigator.canShare({ files: [f] })) { navigator.share({ files: [f] }).catch(function () {}); return; } } catch (e) {}
      var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nf; a.dataset.vz = '1'; document.body.appendChild(a); a.click(); a.remove();
    };
  }
  window.f365Visor = abrir;

  // Si la ventana se abría «vacía» para rellenarla después (w.location.href = …, w.document.write(…)), devolvemos una de mentira
  var falsa = function () {
    var buf = '', W = { closed: false, opener: window, focus: function () {}, blur: function () {}, print: function () {}, close: function () { W.closed = true; }, document: {} };
    W.document.write = function (h) { buf += h; }; W.document.open = function () {}; W.document.close = function () { if (!W.closed && buf) { abrir('', 'Documento', buf); W.closed = true; } };
    var ir = function (x) { if (W.closed || !x) return; x = String(x); if (esDoc(x)) { abrir(x); W.closed = true; return; } var r = orig(x, '_blank'); if (!r) { location.href = x; } W.closed = true; };
    W.location = {}; Object.defineProperty(W.location, 'href', { set: ir, get: function () { return 'about:blank'; } }); W.location.assign = ir; W.location.replace = ir;
    return W;
  };
  window.open = function (u, t, f) {
    if (!u || u === 'about:blank') return falsa();
    u = String(u);
    if (esDoc(u)) { abrir(u); return { closed: true, close: function () {}, focus: function () {}, location: {} }; }
    return orig(u, t, f);
  };
  // Enlaces <a target="_blank"> a documentos o páginas propias
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest && e.target.closest('a[href]'); if (!a || e.defaultPrevented) return;
    var h = a.href; if (!h || a.dataset.vz || /^(mailto|tel|sms|whatsapp):/.test(h)) return;
    var dl = a.getAttribute('download');
    if (dl != null ? /\.(pdf|png|jpe?g|webp)$/i.test(dl) : (a.target === '_blank' && esDoc(h))) { e.preventDefault(); abrir(h, dl || ''); }
  }, true);
})();
