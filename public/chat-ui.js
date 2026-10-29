/* FISIO365 · Chat paciente ↔ fisio (texto, fotos y PDFs)
   Uso: FisioChat.montar(elemento, { rol:'paciente'|'fisio', pacienteId, pacienteNombre, pwd, fisio:{id,nombre,foto}, sinFisio, alto })
   Cada conversación es de un paciente con UN fisio (como WhatsApp): solo se cargan los mensajes de ese fisio
   (y, si sinFisio=true, los antiguos que no tienen fisio).
   Lo usan la app del paciente (index.html) y el panel del fisio (fisio.html). Habla con /api/chat. */
(function () {
  const MAX_MB = 2.5;
  const css = `
  .fc{display:flex;flex-direction:column;min-height:0;height:100%;font-family:'Poppins',sans-serif;color:#1a1a1a}
  .fc-hilo{flex:1;overflow-y:auto;padding:14px 4px 10px;display:flex;flex-direction:column;gap:6px;-webkit-overflow-scrolling:touch}
  .fc-dia{align-self:center;font-size:11.5px;font-weight:500;color:#8a857e;background:rgba(255,255,255,.75);border-radius:99px;padding:4px 12px;margin:10px 0 4px;}
  .fc-b{max-width:80%;padding:10px 14px 7px;border-radius:20px;font-size:14.5px;line-height:1.45;white-space:pre-wrap;word-wrap:break-word;position:relative}
  .fc-b.ellos{align-self:flex-start;background:#fff;border-bottom-left-radius:6px;box-shadow:0 1px 2px rgba(26,26,26,.05)}
  .fc-b.yo{align-self:flex-end;background:#1a1a1a;color:#f5f2ee;border-bottom-right-radius:6px}
  .fc-b small{display:block;font-size:10.5px;margin-top:3px;opacity:.55;text-align:right}
  .fc-b small.fc-t{display:flex;justify-content:flex-end;align-items:center;gap:3px}
  .fc-tk{display:inline-flex;opacity:1}.fc-tk svg{height:11px;width:auto;fill:none;stroke:currentColor;stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round}
  .fc-b.yo small.fc-t{opacity:1;color:rgba(245,242,238,.55)}.fc-tk.visto{color:#4ade80}
  .fc-autor{font-size:11px;font-weight:600;color:#c2552e;margin-bottom:2px}
  .fc-b.yo .fc-autor{color:#efc7b4}
  .fc-tag{display:inline-block;font-size:10px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;background:#ffe9e9;color:#c33;border-radius:99px;padding:2px 8px;margin-bottom:4px}
  .fc-img{display:block;margin:-4px -8px 6px;border-radius:14px;overflow:hidden;max-width:240px;background:#f7e6dd}
  .fc-img img{display:block;width:100%;height:auto;max-height:280px;object-fit:cover}
  .fc-pdf{display:flex;align-items:center;gap:10px;text-decoration:none;color:inherit;background:rgba(217,119,79,.18);border-radius:14px;padding:10px 12px;margin:-2px -6px 6px;min-width:200px}
  .fc-b.yo .fc-pdf{background:rgba(255,255,255,.1)}
  .fc-pdf i{font-style:normal;width:36px;height:42px;border-radius:8px;background:#d9774f;color:#fff;font-size:10px;font-weight:800;display:flex;align-items:center;justify-content:center;flex:none}
  .fc-pdf b{display:block;font-size:13px;font-weight:600;line-height:1.3;word-break:break-word}
  .fc-pdf span{font-size:11px;opacity:.6}
  .fc-vacio{margin:auto;text-align:center;color:#8a857e;font-size:14px;line-height:1.6;max-width:280px;padding:30px 0}
  .fc-vacio b{display:block;color:#1a1a1a;font-size:16px;margin-bottom:6px}
  .fc-prev{display:none;align-items:center;gap:10px;margin:0 4px 8px;background:#fff;border-radius:16px;padding:8px 10px}
  .fc-prev.on{display:flex}
  .fc-prev img{width:44px;height:44px;border-radius:10px;object-fit:cover}
  .fc-prev .n{flex:1;min-width:0;font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .fc-prev .n span{display:block;font-size:11px;font-weight:400;color:#8a857e}
  .fc-prev button{border:none;background:#f5f2ee;width:30px;height:30px;border-radius:50%;cursor:pointer;font-size:16px;color:#1a1a1a}
  .fc-esc{display:flex;gap:8px;align-items:flex-end;padding:8px 0 calc(6px + env(safe-area-inset-bottom))}
  .fc-esc textarea{flex:1;font-family:inherit;font-size:16px;line-height:1.4;padding:11px 16px;border-radius:24px;border:1.5px solid rgba(26,26,26,.1);background:#fff;resize:none;max-height:120px;color:#1a1a1a;outline:none}
  .fc-esc textarea:focus{border-color:#d9774f}
  .fc-btn{width:46px;height:46px;border-radius:50%;border:none;flex:none;cursor:pointer;display:flex;align-items:center;justify-content:center}
  .fc-btn svg{width:21px;height:21px;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
  .fc-adj{background:#fff;border:1.5px solid rgba(26,26,26,.1)}
  .fc-adj svg{stroke:#1a1a1a}
  .fc-env{background:#1a1a1a}
  .fc-env svg{stroke:#f5f2ee}
  .fc-env[disabled]{opacity:.3;cursor:default}
  .fc-sub{font-size:11.5px;color:#8a857e;text-align:center;padding:2px 8px 0}
  .fc-elegir{background:#fff;border-radius:20px;padding:16px;margin:6px 4px 10px}
  .fc-elegir b{display:block;font-size:14px;margin-bottom:10px}
  .fc-elegir .ops{display:flex;flex-wrap:wrap;gap:8px}
  .fc-elegir button{display:flex;align-items:center;gap:8px;font-family:inherit;font-size:13.5px;font-weight:600;border:1.5px solid rgba(26,26,26,.12);background:#fff;border-radius:99px;padding:6px 14px 6px 6px;cursor:pointer;color:#1a1a1a}
  .fc-elegir button.on{border-color:#1a1a1a;background:#1a1a1a;color:#f5f2ee}
  .fc-elegir img,.fc-elegir i{width:28px;height:28px;border-radius:50%;object-fit:cover;background:#f7e6dd;font-style:normal;font-size:11px;display:flex;align-items:center;justify-content:center;color:#c2552e}
  .fc-enviando{opacity:.55}
  .fc-guardar{display:flex;align-items:center;gap:6px;margin:2px 0 8px;border:none;border-radius:99px;background:#fbeee7;color:#c2552e;font-family:inherit;font-size:12px;font-weight:700;padding:6px 11px;cursor:pointer}
  .fc-guardar svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
  .fc-guardar.ok{background:#eaf5ea;color:#2e6b34;cursor:default}
  .fc-guardar[disabled]{opacity:.7}
  `;
  if (!document.getElementById('fc-css')) { const s = document.createElement('style'); s.id = 'fc-css'; s.textContent = css; document.head.appendChild(s); }

  const esc = (t) => String(t || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const enlaces = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener" style="color:inherit;text-decoration:underline">$1</a>');
  const kb = (b) => b > 1048576 ? (b / 1048576).toFixed(1).replace('.', ',') + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';
  const ini = (n) => String(n || '?').split(' ').map(w => w[0] || '').join('').slice(0, 2).toUpperCase();

  function leerBase64(blob) {
    return new Promise((ok, ko) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.onerror = ko; r.readAsDataURL(blob); });
  }
  // Las fotos se reducen a 1600 px (suelen quedar en 300-600 KB) para que se envíen rápido
  async function prepararArchivo(file) {
    const esImg = /^image\//.test(file.type) || /\.(heic|heif)$/i.test(file.name);
    if (!esImg && file.type !== 'application/pdf') throw new Error('Solo puedes enviar fotos o PDFs');
    if (esImg && file.type !== 'image/gif') {
      try {
        const bmp = await createImageBitmap(file);
        const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
        const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
        c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
        const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.82));
        if (blob) return { nombre: file.name.replace(/\.\w+$/, '') + '.jpg', tipo: 'image/jpeg', blob, bytes: blob.size, img: true };
      } catch (e) { /* si el navegador no puede leerla, se envía tal cual */ }
    }
    if (file.size > MAX_MB * 1048576) throw new Error(`El archivo pesa más de 2,5 MB. Prueba con uno más pequeño.`);
    return { nombre: file.name, tipo: file.type || 'application/pdf', blob: file, bytes: file.size, img: esImg };
  }

  function montar(el, o) {
    const yo = o.rol === 'fisio' ? 'fisio' : 'paciente';
    let mensajes = [], fisio = o.fisio && o.fisio.id ? o.fisio : null, adjunto = null, timer = null, firma = '', preparando = false;
    el.innerHTML = `<div class="fc">
      <div class="fc-hilo" aria-live="polite"><div class="fc-vacio">Cargando…</div></div>
      <div class="fc-elegir" hidden></div>
      <div class="fc-prev"><img alt="" hidden><div class="n"></div><button type="button" aria-label="Quitar archivo">×</button></div>
      <form class="fc-esc">
        <input type="file" accept="image/*,application/pdf" hidden>
        <button type="button" class="fc-btn fc-adj" aria-label="Adjuntar foto o PDF"><svg viewBox="0 0 24 24"><path d="M21.4 11.1 12.2 20.3a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5"/></svg></button>
        <textarea rows="1" maxlength="4000" placeholder="Escribe un mensaje…" aria-label="Mensaje"></textarea>
        <button type="submit" class="fc-btn fc-env" aria-label="Enviar" disabled><svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg></button>
      </form>
      ${yo === 'paciente' ? '<div class="fc-sub">Te contestamos en horario de la clínica. Si es urgente, llámanos.</div>' : ''}
    </div>`;
    const $ = (s) => el.querySelector(s);
    const hilo = $('.fc-hilo'), ta = $('textarea'), env = $('.fc-env'), inp = $('input[type=file]'), prev = $('.fc-prev'), elegir = $('.fc-elegir');

    const guardados = new Set();
    hilo.addEventListener('click', async ev => {
      const b = ev.target.closest('.fc-guardar[data-m]'); if (!b) return;
      b.disabled = true; const txt = b.innerHTML; b.textContent = 'Guardando…';
      try {
        const r = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'guardar-archivo', pwd: o.pwd || '', pacienteId: o.pacienteId, mensajeId: b.dataset.m, i: +b.dataset.i }) });
        const d = await r.json();
        if (!d.ok) throw new Error(d.error || 'Error');
        guardados.add(b.dataset.m + ':' + b.dataset.i);
        b.className = 'fc-guardar ok'; b.innerHTML = '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>' + (d.ya ? 'Ya estaba en su ficha' : 'Guardado en su ficha');
      } catch (e) { b.disabled = false; b.innerHTML = txt; alert('No se ha podido guardar: ' + e.message); }
    });
    function puedeEnviar() { env.disabled = preparando || !(ta.value.trim() || adjunto) || (yo === 'paciente' && !fisio); }

    // Tic de enviado (gris) y doble tic de visto (verde), como en WhatsApp
    const tic = visto => visto
      ? '<span class="fc-tk visto" title="Visto"><svg viewBox="0 0 22 12"><path d="M1 6.5l3.5 3.5L12 2.5"/><path d="M8.5 9.5l.5.5L16.5 2.5"/></svg></span>'
      : '<span class="fc-tk" title="Enviado"><svg viewBox="0 0 14 12"><path d="M1.5 6.5l3.5 3.5L12.5 2.5"/></svg></span>';
    function burbuja(m) {
      const mio = m.de === yo;
      const autor = !mio && m.de === 'fisio' && yo === 'paciente' && m.fisioNombre && !(fisio && m.fisioId === fisio.id) ? `<div class="fc-autor">${esc(m.fisioNombre)}</div>` : '';
      const puedeGuardar = yo === 'fisio' && m.de === 'paciente' && !m._enviando && !m.antiguo && /^rec[A-Za-z0-9]{14}$/.test(m.id);
      const adj = (m.adjuntos || []).map((a, i) => (/^image\//.test(a.tipo)
        ? `<a class="fc-img" href="${esc(a.url)}" target="_blank" rel="noopener"><img src="${esc(a.mini || a.url)}" alt="${esc(a.nombre)}" loading="lazy"></a>`
        : `<a class="fc-pdf" href="${esc(a.url)}" target="_blank" rel="noopener"><i>PDF</i><div><b>${esc(a.nombre)}</b><span>${a.bytes ? kb(a.bytes) + ' · ' : ''}Toca para abrir</span></div></a>`)
        + (puedeGuardar ? ((a.enFicha || guardados.has(m.id + ':' + i))
          ? `<button type="button" class="fc-guardar ok" disabled><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>Guardado en su ficha</button>`
          : `<button type="button" class="fc-guardar" data-m="${esc(m.id)}" data-i="${i}"><svg viewBox="0 0 24 24"><path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19h14"/></svg>Guardar en su ficha</button>`) : '')).join('');
      const d = new Date(m.fecha);
      return `<div class="fc-b ${mio ? 'yo' : 'ellos'}${m._enviando ? ' fc-enviando' : ''}">${autor}${m.etiqueta ? `<span class="fc-tag">${esc(m.etiqueta)}</span><br>` : ''}${adj}${m.texto ? enlaces(m.texto) : ''}<small class="fc-t">${m._enviando ? 'Enviando…' : d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}${mio && !m._enviando ? tic(m.leido) : ''}</small></div>`;
    }
    function pintar(forzarAbajo) {
      const abajo = forzarAbajo || hilo.scrollHeight - hilo.scrollTop - hilo.clientHeight < 80;
      if (!mensajes.length) {
        hilo.innerHTML = yo === 'paciente'
          ? `<div class="fc-vacio"><b>Escríbenos cuando quieras</b>Dudas con tus ejercicios, cómo te encuentras o fotos de tus informes. También puedes enviar PDFs.</div>`
          : `<div class="fc-vacio"><b>Aún no hay mensajes</b>Escríbele o envíale una foto o un PDF.</div>`;
        return;
      }
      let dia = '';
      hilo.innerHTML = mensajes.map(m => {
        let etq = new Date(m.fecha).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }); etq = etq.charAt(0).toUpperCase() + etq.slice(1);
        const sep = etq !== dia ? `<div class="fc-dia">${esc(etq)}</div>` : ''; dia = etq;
        return sep + burbuja(m);
      }).join('');
      if (abajo) { hilo.scrollTop = hilo.scrollHeight; hilo.querySelectorAll('img').forEach(i => i.addEventListener('load', () => { hilo.scrollTop = hilo.scrollHeight; }, { once: true })); }
    }

    async function elegirFisio() {
      elegir.hidden = false;
      elegir.innerHTML = '<b>¿A quién quieres escribir?</b><div class="ops">Cargando…</div>';
      try {
        const d = await (await fetch('/api/fisios?action=lista-publica')).json();
        const fs = d.fisios || [];
        elegir.querySelector('.ops').innerHTML = fs.map(f => `<button type="button" data-id="${esc(f.id)}" data-n="${esc(f.nombre)}">${f.foto ? `<img src="${esc(f.foto)}" alt="">` : `<i>${esc(ini(f.nombre))}</i>`}${esc(f.nombre.split(' ')[0])}</button>`).join('') || 'No hay fisios disponibles.';
        elegir.querySelectorAll('button').forEach(b => b.onclick = () => {
          fisio = { id: b.dataset.id, nombre: b.dataset.n };
          elegir.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
          puedeEnviar(); ta.focus();
          if (o.onFisio) o.onFisio(fisio);
        });
      } catch (e) { elegir.querySelector('.ops').textContent = 'No se ha podido cargar la lista.'; }
    }

    async function cargar(primera) {
      try {
        const filtro = fisio ? `&fisioId=${encodeURIComponent(fisio.id)}${o.sinFisio !== false ? '&sinFisio=1' : ''}` : '';
        const d = await (await fetch(`/api/chat?action=hilo&pacienteId=${encodeURIComponent(o.pacienteId)}${filtro}`, yo === 'fisio' && o.pwd ? { headers: { 'x-fisio-pwd': o.pwd } } : {})).json();
        if (!d.ok) throw new Error(d.error);
        const nueva = d.mensajes.map(m => m.id + (m.adjuntos || []).length + (m.de === yo && m.leido ? 'v' : '')).join('|'); // al verlo la otra persona se repinta con el tic verde
        const pendientes = mensajes.filter(m => m._enviando);
        if (nueva !== firma || primera) { firma = nueva; mensajes = d.mensajes.concat(pendientes); pintar(primera); }
        if (yo === 'paciente' && !fisio && d.fisio) { fisio = d.fisio; if (o.onFisio) o.onFisio(fisio); }
        if (yo === 'paciente' && !fisio && primera) elegirFisio();
        const sinLeer = d.mensajes.some(m => m.de !== yo && !m.leido);
        if (sinLeer) fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'leido', pacienteId: o.pacienteId, quien: yo, pwd: o.pwd || '', fisioId: fisio ? fisio.id : '', sinFisio: o.sinFisio !== false }) }).then(() => o.onLeido && o.onLeido()).catch(() => {});
        puedeEnviar();
      } catch (e) { if (primera) hilo.innerHTML = '<div class="fc-vacio">No se han podido cargar los mensajes. Revisa tu conexión.</div>'; }
    }

    ta.addEventListener('input', () => { puedeEnviar(); ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 120) + 'px'; });
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && window.matchMedia('(min-width: 800px)').matches) { e.preventDefault(); $('form').requestSubmit(); } });
    $('.fc-adj').onclick = () => inp.click();
    prev.querySelector('button').onclick = () => { adjunto = null; prev.classList.remove('on'); puedeEnviar(); };
    inp.onchange = async () => {
      const f = inp.files[0]; inp.value = ''; if (!f) return;
      preparando = true; puedeEnviar();
      try {
        adjunto = await prepararArchivo(f);
        const im = prev.querySelector('img');
        if (adjunto.img) { im.src = URL.createObjectURL(adjunto.blob); im.hidden = false; } else im.hidden = true;
        prev.querySelector('.n').innerHTML = `${esc(adjunto.nombre)}<span>${adjunto.img ? 'Foto' : 'PDF'} · ${kb(adjunto.bytes)}</span>`;
        prev.classList.add('on'); puedeEnviar();
      } catch (e) { alert(e.message); }
      preparando = false; puedeEnviar();
    };
    $('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const texto = ta.value.trim();
      if (preparando || (!texto && !adjunto) || (yo === 'paciente' && !fisio)) return;
      const adj = adjunto;
      const temp = { id: 'tmp' + Date.now(), de: yo, texto, fecha: new Date().toISOString(), _enviando: true,
        adjuntos: adj ? [{ url: URL.createObjectURL(adj.blob), nombre: adj.nombre, tipo: adj.tipo, bytes: adj.bytes }] : [] };
      mensajes.push(temp); pintar(true);
      ta.value = ''; ta.style.height = 'auto'; adjunto = null; prev.classList.remove('on'); puedeEnviar();
      try {
        const archivo = adj ? { nombre: adj.nombre, tipo: adj.tipo, base64: await leerBase64(adj.blob) } : null;
        const r = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
          action: 'enviar', de: yo, pwd: o.pwd || '', pacienteId: o.pacienteId, pacienteNombre: o.pacienteNombre || '',
          fisioId: (o.rol === 'fisio' ? o.fisio && o.fisio.id : fisio && fisio.id) || '', fisioNombre: (o.rol === 'fisio' ? o.fisio && o.fisio.nombre : fisio && fisio.nombre) || '',
          texto, archivo }) });
        const d = await r.json().catch(() => ({ ok: false, error: r.status === 413 ? 'El archivo es demasiado grande' : 'Error de conexión' }));
        if (!d.ok) throw new Error(d.error || 'No se ha podido enviar');
        mensajes = mensajes.filter(m => m !== temp); mensajes.push(d.mensaje); firma = ''; pintar(true);
        elegir.hidden = true;
        if (o.onEnviado) o.onEnviado(d.mensaje);
      } catch (err) {
        mensajes = mensajes.filter(m => m !== temp); pintar(true);
        ta.value = texto; if (adj) { adjunto = adj; prev.classList.add('on'); } puedeEnviar();
        alert(err.message + '. Inténtalo de nuevo.');
      }
    });

    cargar(true);
    timer = setInterval(() => { if (document.body.contains(el)) cargar(false); else clearInterval(timer); }, 12000);
    return { parar: () => clearInterval(timer), recargar: () => cargar(true) };
  }

  async function sinLeer(pacienteId) {
    try { const d = await (await fetch(`/api/chat?action=sin-leer&pacienteId=${encodeURIComponent(pacienteId)}`)).json(); return d.sinLeer || 0; } catch (e) { return 0; }
  }

  window.FisioChat = { montar, sinLeer };
})();
