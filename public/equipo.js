// FISIO365 · «Mi club» (el jugador decide si su club ve su parte) y «Mi equipo» (el entrenador ve a sus jugadores)
// Lo usa public/index.html. Datos: /api/schedule?action=eq-mio | eq-consent | eq-equipo (ver api/schedule.js, MI EQUIPO).
(function () {
  const SEM = { rojo: 'No entrena', amarillo: 'Entrena con limitaciones', verde: 'Puede jugar' };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const MES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const fe = f => { if (!f) return ''; const d = new Date(String(f).length === 10 ? f + 'T12:00:00' : f); return isNaN(d) ? '' : `${d.getDate()} de ${MES[d.getMonth()]}`; };
  const IC = {
    club: '<svg viewBox="0 0 24 24"><path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6z"/><path d="M9 12l2 2 4-4"/></svg>',
    eq: '<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><path d="M16 5.5a3 3 0 0 1 0 5.6M17.6 13.5A5.5 5.5 0 0 1 20.5 19"/></svg>',
    flecha: '<svg viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg>',
    atras: '<svg viewBox="0 0 24 24"><path d="m15 6-6 6 6 6"/></svg>'
  };
  const S = { partes: [], equipo: null, cargado: false, jug: null, feq: '', fsem: '', chat: null, msgs: null, poll: 0 };
  const get = (a, q) => fetch(`/api/schedule?action=${a}&${new URLSearchParams(q)}`).then(r => r.json());
  const post = (a, b) => fetch(`/api/schedule?action=${a}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then(r => r.json());
  const junta = L => L.filter(Boolean).map(x => `<span>${esc(x)}</span>`).join(' · ');
  const P = () => window.patient || (typeof patient !== 'undefined' ? patient : null);
  const misAccesos = () => { const p = P(); return (p && Array.isArray(p.equipo) ? p.equipo : []).filter(e => e && e.id && e.tok); };
  const guardaPaciente = () => { try { localStorage.setItem('fisio365_patient', JSON.stringify(P())); } catch (e) {} };
  const el = id => document.getElementById(id);

  // ── Al entrar (paciente): sus clubs y, si es entrenador con el mismo email, su acceso a «Mi equipo» ──
  async function cargar() {
    const p = P(); if (!p || p.soloEquipo) return;
    try {
      const d = await get('eq-mio', { patientId: p.id }); if (!d || !d.ok) return;
      S.partes = d.partes || []; S.cargado = true;
      menu(); banner();
    } catch (e) {}
  }
  function menu() {
    const c = el('navMiClub'), e = el('navMiEquipo');
    if (c) c.style.display = 'flex'; // siempre: si no juega en ningún club, explica para qué es
    if (e) e.style.display = 'flex'; // siempre: sin acceso, explica para qué es
  }
  function banner() {
    const b = el('eqBanner'); if (!b) return;
    const pend = S.partes.find(x => x.consentimiento === 'Pendiente');
    if (!pend) { b.classList.remove('on'); return; }
    b.innerHTML = `<div class="av-ic eq-bic">${IC.club}</div><div><b class="no-tr">${esc(pend.club)}</b><span>Tu club quiere ver cómo va tu recuperación. Tú decides.</span></div><button class="ib">Ver</button>`;
    b.onclick = () => window.showSection('miclub');
    b.classList.add('on');
  }

  // ── Mi club (el jugador) ──
  function pintarClub() {
    const box = el('miClubBox'); if (!box) return;
    if (!S.cargado) { box.innerHTML = '<div class="eq-vac">Cargando…</div>'; cargar().then(pintarClub); return; }
    if (!S.partes.length) {
      const LOCK = '<svg viewBox="0 0 24 24"><rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/></svg>';
      const paso = (n, ic, t, sub) => `<div class="mcl-p" style="animation-delay:${0.15 + n * 0.15}s"><div class="mcl-pi">${ic}<i>${n}</i></div><div><b>${t}</b><span>${sub}</span></div></div>`;
      box.innerHTML = `<div class="eq-card mcl">
        <div class="mcl-hero"><div class="mcl-hic">${IC.club}</div><b>Tu entrenador, al día</b><span>Si juegas en un club, tu fisio puede contarle a tu entrenador cómo va tu recuperación. Tú decides.</span></div>
        <div class="mcl-ps">${paso(1, ICP.pdf, 'Tu fisio prepara tu parte', 'Qué tienes y cuándo vuelves')}${paso(2, ICP.ok, 'Tú lo aceptas aquí', 'Si tienes menos de 16 años, tus padres')}${paso(3, IC.club, 'Tu entrenador lo ve en su app', 'Y sabe cómo cuidarte en los entrenos')}</div>
        <div class="mcl-ej"><div class="mcl-ejh"><span>Así lo ve tu entrenador</span><em>Ejemplo</em></div>
          <div class="mcl-pc"><div class="mcl-pt"><b>Tobillo derecho</b><i>En recuperación</i></div>
            <div class="mcl-bar"><i></i></div><div class="mcl-vu">${ICP.cal}<span>Vuelve en 12 días</span></div>
            <div class="mcl-pu">${ICP.si}<span>Puede hacer: carrera suave y bici</span></div>
            <div class="mcl-no">${LOCK}<span>Tu historia clínica no la ve</span></div></div></div>
        <div class="mcl-ga">${ICP.evo}<span>Lo dejas de compartir cuando quieras</span></div>
        <button type="button" class="eq-ok eq-mcf">Díselo a tu fisio</button>
        <p class="eqh-nota" style="margin-bottom:0">Escríbele por el chat y te añade a tu club.</p></div>`;
      box.querySelector('.eq-mcf').onclick = () => window.showSection('mensajes');
      try { window.applyTranslations && applyTranslations(); } catch (e) {}
      return;
    }
    box.innerHTML = S.partes.map(x => {
      const ok = x.consentimiento === 'Aceptado';
      return `<div class="eq-card" data-id="${x.id}">
        <div class="eq-ch"><div class="eq-cic">${IC.club}</div><div><b class="no-tr">${esc(x.club)}</b>${x.equipo ? `<small class="no-tr">${esc(x.equipo)}</small>` : ''}</div>
          <span class="eq-st ${ok ? 'ok' : x.consentimiento === 'Retirado' ? 'no' : 'pe'}">${ok ? 'Lo compartes' : x.consentimiento === 'Retirado' ? 'No lo compartes' : 'Pendiente'}</span></div>
        ${ok ? `<p class="eq-p">Tu club ve el parte de tu recuperación desde el ${esc(fe(x.consFecha))}. Tu historia clínica no la ve nadie más que tu fisio.</p>${x.parte && x.parte.compEj ? '<p class="eq-p">Tu club también ve tus ejercicios.</p>' : ''}
          ${verParte(x.parte, 'Esto es lo que ve tu club')}
          <button type="button" class="eq-sec eq-ret">Dejar de compartir</button>`
        : `${verParte(x.parte, 'Así va tu recuperación')}
          <p class="eq-p eq-psep">Tu entrenador quiere ver cómo va tu recuperación: qué tienes, cuándo se prevé que vuelvas y qué puedes hacer mientras tanto. Solo lo verá si lo aceptas.</p>
          <div class="eq-txt">${esc(x.texto)}</div>
          <div class="eq-quien">
            <label class="eq-op"><input type="radio" name="q_${x.id}" value="yo" ${x.menor ? 'disabled' : 'checked'}><span>Soy yo, el jugador${x.menor ? ' (tiene que ser su padre, madre o tutor)' : ''}</span></label>
            <label class="eq-op"><input type="radio" name="q_${x.id}" value="tutor" ${x.menor ? 'checked' : ''}><span>Soy su padre, su madre o su tutor</span></label>
            <input type="text" class="eq-tut" placeholder="Nombre y apellidos del padre, la madre o el tutor" ${x.menor ? '' : 'style="display:none"'}>
          </div>
          <div class="eq-err"></div>
          <button type="button" class="eq-ok eq-acep">Aceptar y compartir</button>`}
      </div>`;
    }).join('');
    box.querySelectorAll('.eq-card').forEach(c => {
      const x = S.partes.find(p => p.id === c.dataset.id);
      const tut = c.querySelector('.eq-tut');
      c.querySelectorAll('input[type=radio]').forEach(r => r.onchange = () => { if (tut) tut.style.display = r.value === 'tutor' && r.checked ? '' : 'none'; });
      const ac = c.querySelector('.eq-acep');
      if (ac) ac.onclick = async () => {
        const q = (c.querySelector('input[type=radio]:checked') || {}).value || '', err = c.querySelector('.eq-err');
        err.textContent = '';
        if (!q) { err.textContent = 'Elige quién lo acepta'; return; }
        ac.disabled = true;
        const r = await post('eq-consent', { patientId: P().id, id: x.id, acepta: true, quien: q, tutor: tut ? tut.value : '', lang: (window.T365 && T365.lang && T365.lang()) || 'es' }).catch(() => null);
        ac.disabled = false;
        if (!r || !r.ok) { err.textContent = (r && r.error) || 'No se ha podido guardar'; return; }
        Object.assign(x, r.parte); window.toast && toast('Hecho: tu club ya puede ver tu parte'); pintarClub(); banner();
      };
      const rt = c.querySelector('.eq-ret');
      if (rt) { let arm = false; rt.onclick = async () => {
        if (!arm) { arm = true; rt.textContent = '¿Seguro? Toca otra vez'; setTimeout(() => { arm = false; if (rt.isConnected) rt.textContent = 'Dejar de compartir'; }, 4000); return; }
        rt.disabled = true;
        const r = await post('eq-consent', { patientId: P().id, id: x.id, acepta: false }).catch(() => null);
        if (!r || !r.ok) { rt.disabled = false; window.toast && toast('No se ha podido guardar', false); return; }
        Object.assign(x, r.parte); window.toast && toast('Hecho: tu club ya no ve tu parte'); pintarClub(); banner();
      }; }
    });
  }

  // Ejercicios compartidos (los mismos que tiene el jugador en su app)
  function verEjercicios(L) {
    const t = n => n >= 60 && n % 60 === 0 ? `${n / 60} min` : `${n} s`;
    const dosis = e => e.series > 1 && e.reps ? `${e.series} series × ${e.reps}` : e.series > 1 && e.dur ? `${e.series} series × ${t(e.dur)}` : e.dur ? t(e.dur) : e.reps ? `× ${e.reps}` : '';
    return `<div class="eqp-b">${tit(ICP.ej, 'Sus ejercicios')}<p class="eq-ejn">Su fisio ha compartido su programa para que lo pueda hacer también en los entrenos.</p><div class="eq-ejs">${L.map(e => {
      const img = e.ytId ? `https://img.youtube.com/vi/${encodeURIComponent(e.ytId)}/mqdefault.jpg` : e.imagen;
      return `<div class="eq-ej">${img ? `<div class="eq-ejim" style="background-image:url('${esc(img)}')">${e.ytId ? `<a href="https://www.youtube.com/watch?v=${encodeURIComponent(e.ytId)}" target="_blank" rel="noopener" aria-label="Ver vídeo"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></a>` : ''}</div>` : ''}
        <div class="eq-ejt"><b class="no-tr">${esc(e.name)}</b>${dosis(e) ? `<small>${esc(dosis(e))}</small>` : ''}${e.desc ? `<p class="no-tr">${esc(e.desc)}</p>` : ''}</div></div>`; }).join('')}</div></div>`;
  }
  // ── Piezas del parte (las usan «Mi club» y «Mi equipo») ──
  const FASES = ['Valoración', 'Tratamiento', 'Readaptación', 'Vuelta progresiva', 'Alta'];
  const ORDEN = { rojo: 0, amarillo: 1, verde: 2 };
  const hoyK = () => { const x = new Date(); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
  const diasEntre = (a, b) => Math.round((Date.parse(String(b).slice(0, 10) + 'T12:00:00Z') - Date.parse(String(a).slice(0, 10) + 'T12:00:00Z')) / 864e5);
  const iniciales = n => String(n || '').trim().split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase();
  // Desde cuándo está de baja: la primera vez que se apuntó en su evolución (si no, la última actualización)
  const inicio = p => { const L = (p.evolucion || []).map(e => String(e.f || '').slice(0, 10)).filter(Boolean).sort(); return L[0] || String(p.actualizado || '').slice(0, 10); };
  // Cuenta atrás hasta la vuelta prevista: { n: días, pct: 0-100 del camino hecho }
  function vuelta(p) {
    if (!p.vuelta || p.semaforo === 'verde') return null;
    const n = diasEntre(hoyK(), p.vuelta), ini = inicio(p), tot = ini ? diasEntre(ini, p.vuelta) : 0;
    const pct = tot > 0 ? Math.max(4, Math.min(100, Math.round(diasEntre(ini, hoyK()) / tot * 100))) : (n <= 0 ? 100 : 10);
    return { n, pct, ini };
  }
  const textoVuelta = v => v.n > 1 ? `Vuelve en ${v.n} días` : v.n === 1 ? 'Vuelve mañana' : v.n === 0 ? 'Vuelve hoy' : 'Fecha de vuelta superada';
  const ICP = {
    que: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>',
    si: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="m8.5 12.2 2.4 2.4 4.6-4.8"/></svg>',
    no: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="m9.5 9.5 5 5M14.5 9.5l-5 5"/></svg>',
    plan: '<svg viewBox="0 0 24 24"><path d="M5 19c3-1 3-5 7-6s4-5 7-6"/><circle cx="5" cy="19" r="1.6"/><circle cx="19" cy="7" r="1.6"/></svg>',
    evo: '<svg viewBox="0 0 24 24"><path d="M4 18l5-5 4 3 7-8"/><path d="M15 8h5v5"/></svg>',
    cal: '<svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="15" rx="3"/><path d="M8 3v4M16 3v4M4 10h16"/></svg>',
    share: '<svg viewBox="0 0 24 24"><path d="M12 15V4M8 8l4-4 4 4"/><path d="M5 13v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"/></svg>',
    pdf: '<svg viewBox="0 0 24 24"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/></svg>',
    ok: '<svg viewBox="0 0 24 24"><path d="m5 12.5 4.2 4.2L19 7"/></svg>',
    ej: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M10 9.5v5l4-2.5z"/></svg>'
  };
  const tit = (ic, t) => `<div class="eqp-h">${ic}<span>${t}</span></div>`;
  // Las fases como pasos: hechas, la de ahora y las que quedan
  function pasos(fase) {
    const k = FASES.indexOf(fase); if (k < 0) return '';
    return `<div class="eqp-fw"><div class="eqp-fs">${FASES.map((f, i) => `<div class="eqp-f ${i < k ? 'hecha' : i === k ? 'ahora' : ''}"><i>${i < k ? ICP.ok : ''}</i></div>`).join('')}</div><div class="eqp-fl"><span>Fase</span> <b>${esc(fase)}</b><em>${k + 1}/${FASES.length}</em></div></div>`;
  }
  // El parte tal como lo ve el club
  function verParte(p, titulo, acciones) {
    if (!p) return '';
    const vacio = !p.semaforo && !p.diagnostico && !p.puede && !p.noPuede && !p.pautas;
    const v = vuelta(p);
    const bloque = (ic, t, val, cls) => val ? `<div class="eqp-b ${cls || ''}">${tit(ic, t)}<p class="no-tr">${esc(val)}</p></div>` : '';
    return `<div class="eq-parte">${titulo ? `<div class="eq-pt">${titulo}</div>` : ''}
      ${vacio ? '<div class="eq-vac">Tu fisio todavía no ha escrito el parte.</div>' : `
      ${p.semaforo ? `<div class="eqp-st ${esc(p.semaforo)}"><i></i><div><small>Estado</small><b>${esc(SEM[p.semaforo] || '')}</b></div>${p.fase ? `<span>${esc(p.fase)}</span>` : ''}</div>` : ''}
      ${v ? `<div class="eqp-cd${v.n < 0 ? ' tarde' : ''}"><div class="eqp-cdt">${v.n > 0 ? `<b>${v.n}</b><span>${v.n === 1 ? 'día' : 'días'}</span>` : `<b class="eqp-cdh">${v.n === 0 ? 'Hoy' : '—'}</b>`}<div><small>${v.n < 0 ? 'Fecha de vuelta superada' : 'Vuelta prevista'}</small><em>${esc(fe(p.vuelta))}</em></div></div>
        <div class="eqp-bar"><i style="width:${v.pct}%"></i></div>${v.ini ? `<div class="eqp-bl"><span>Desde el ${esc(fe(v.ini))}</span><span>${esc(fe(p.vuelta))}</span></div>` : ''}</div>`
        : p.semaforo === 'verde' ? `<div class="eqp-cd ok"><div class="eqp-cdt"><b class="eqp-cdh">${ICP.ok}</b><div><small>Disponible</small><em>Puede jugar con normalidad</em></div></div></div>`
        : p.semaforo ? `<div class="eqp-cd sin"><div class="eqp-cdt"><b class="eqp-cdh">${ICP.cal}</b><div><small>Vuelta prevista</small><em>Sin fecha todavía</em></div></div></div>` : ''}
      ${pasos(p.fase)}
      ${bloque(ICP.que, 'Qué le pasa', p.diagnostico)}
      ${p.puede || p.noPuede ? `<div class="eqp-2">${bloque(ICP.si, 'Puede hacer', p.puede, 'si')}${bloque(ICP.no, 'No puede hacer', p.noPuede, 'no')}</div>` : ''}
      ${bloque(ICP.plan, 'Plan de vuelta', p.pautas)}
      ${Array.isArray(p.ejercicios) && p.ejercicios.length ? verEjercicios(p.ejercicios) : ''}
      ${(p.evolucion || []).length ? `<div class="eqp-b">${tit(ICP.evo, 'Evolución')}<div class="eq-evo">${p.evolucion.map(e => `<div class="eq-ev"><i class="${esc(e.sem || '')}"></i><b>${esc(fe(e.f))}${e.fisio ? ' · <span class="no-tr">' + esc(e.fisio) + '</span>' : ''}</b>${[SEM[e.sem], e.fase].filter(Boolean).length ? `<small>${junta([SEM[e.sem], e.fase])}</small>` : ''}${e.txt ? `<p class="no-tr">${esc(e.txt)}</p>` : ''}</div>`).join('')}</div></div>` : ''}
      ${p.actualizado ? `<div class="eq-act">Actualizado el ${esc(fe(p.actualizado))}${p.fisio ? ' por <span class="no-tr">' + esc(p.fisio) + '</span>' : ''}</div>` : ''}
      ${acciones ? `<div class="eqp-acc"><button type="button" class="eqp-sh">${ICP.share}<span>Compartir</span></button><button type="button" class="eqp-pdf">${ICP.pdf}<span>Descargar PDF</span></button></div>` : ''}`}
    </div>`;
  }
  // Texto para compartir (WhatsApp, cuerpo técnico…)
  function textoParte(j) {
    const v = vuelta(j), L = [`${j.jugador}${j.equipo ? ' · ' + j.equipo : ''}`, [SEM[j.semaforo], j.fase].filter(Boolean).join(' · ')];
    if (v) L.push(`Vuelta prevista: ${fe(j.vuelta)} (${textoVuelta(v).toLowerCase()})`);
    if (j.diagnostico) L.push('', 'Qué le pasa: ' + j.diagnostico);
    if (j.puede) L.push('Puede hacer: ' + j.puede);
    if (j.noPuede) L.push('No puede hacer: ' + j.noPuede);
    if (j.pautas) L.push('Plan de vuelta: ' + j.pautas);
    L.push('', `Parte de ${(window.CLINICA && window.CLINICA.marca) || 'FISIO365'}${j.actualizado ? ', actualizado el ' + fe(j.actualizado) : ''}`);
    return L.filter(x => x != null).join('\n');
  }
  async function compartir(j) {
    const t = textoParte(j);
    try { if (navigator.share) { await navigator.share({ title: 'Parte de ' + j.jugador, text: t }); return; } } catch (e) { if (e && e.name === 'AbortError') return; }
    try { await navigator.clipboard.writeText(t); window.toast && toast('Copiado: pégalo donde quieras'); } catch (e) { window.toast && toast('No se ha podido copiar', false); }
  }
  // PDF del parte, limpio y con la marca (jsPDF bajo demanda)
  function jsPDFlib() {
    if (window.jspdf && window.jspdf.jsPDF) return Promise.resolve(window.jspdf.jsPDF);
    return new Promise((ok, ko) => { const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'; s.onload = () => window.jspdf ? ok(window.jspdf.jsPDF) : ko(); s.onerror = ko; document.head.appendChild(s); });
  }
  async function descargarPDF(j, club) {
    let J; try { J = await jsPDFlib(); } catch (e) { window.toast && toast('No se ha podido preparar el PDF. Mira tu conexión.', false); return; }
    const doc = new J({ unit: 'mm', format: 'a4' }), W = 210, M = 18, CO = [194, 85, 46], NE = [30, 30, 30], GR = [125, 112, 104];
    const COL = { rojo: [194, 85, 46], amarillo: [233, 160, 127], verde: [30, 30, 30] };
    let y = 20;
    const CL = window.CLINICA || {}, marca = CL.marca || 'FISIO365';
    doc.setFont('helvetica', 'bold'); doc.setFontSize(17); doc.setTextColor(...NE);
    if (marca === 'FISIO365') { doc.text('FISIO', M, y); doc.setTextColor(...CO); doc.text('365', M + doc.getTextWidth('FISIO'), y); } else doc.text(marca, M, y);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...GR); doc.text('Parte de recuperación para el club', W - M, y, { align: 'right' });
    y += 5; doc.setDrawColor(234, 223, 214); doc.setLineWidth(.4); doc.line(M, y, W - M, y); y += 12;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(20); doc.setTextColor(...NE); doc.text(j.jugador || '', M, y); y += 6.5;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5); doc.setTextColor(...GR); doc.text([j.equipo, club].filter(Boolean).join(' · '), M, y); y += 10;
    if (j.semaforo) {
      const c = COL[j.semaforo] || GR; doc.setFillColor(250, 247, 244); doc.roundedRect(M, y, W - 2 * M, 16, 3, 3, 'F');
      doc.setFillColor(...c); doc.circle(M + 7, y + 8, 2.2, 'F');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(12.5); doc.setTextColor(...NE); doc.text(SEM[j.semaforo] || '', M + 13, y + 9.6);
      if (j.fase) { doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); doc.setTextColor(...CO); doc.text('Fase: ' + j.fase, W - M - 6, y + 9.6, { align: 'right' }); }
      y += 23;
    }
    const v = vuelta(j);
    if (j.vuelta || v) {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(...GR); doc.text('VUELTA PREVISTA', M, y); y += 5.5;
      doc.setFontSize(13); doc.setTextColor(...NE); doc.text(fe(j.vuelta) + (v ? '  ·  ' + textoVuelta(v).toLowerCase() : ''), M, y); y += 4;
      if (v) { doc.setFillColor(241, 235, 230); doc.roundedRect(M, y, W - 2 * M, 2.6, 1.3, 1.3, 'F'); doc.setFillColor(...CO); doc.roundedRect(M, y, Math.max(3, (W - 2 * M) * v.pct / 100), 2.6, 1.3, 1.3, 'F'); y += 6; }
      y += 6;
    }
    const sec = (t, val) => { if (!val) return; if (y > 265) { doc.addPage(); y = 20; }
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(...CO); doc.text(t.toUpperCase(), M, y); y += 5.5;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.setTextColor(...NE);
      doc.splitTextToSize(String(val), W - 2 * M).forEach(l => { if (y > 280) { doc.addPage(); y = 20; } doc.text(l, M, y); y += 5.4; }); y += 5; };
    sec('Qué le pasa', j.diagnostico); sec('Puede hacer', j.puede); sec('No puede hacer', j.noPuede); sec('Plan de vuelta', j.pautas);
    if (Array.isArray(j.ejercicios) && j.ejercicios.length) sec('Sus ejercicios', j.ejercicios.map(e => '• ' + e.name + (e.series > 1 && e.reps ? ` (${e.series} × ${e.reps})` : e.series > 1 && e.dur ? ` (${e.series} × ${e.dur} s)` : '')).join('\n'));
    const ev = (j.evolucion || []).slice(0, 6);
    if (ev.length) sec('Evolución', ev.map(e => `${fe(e.f)}${e.fisio ? ' · ' + e.fisio : ''} — ${[SEM[e.sem], e.fase].filter(Boolean).join(' · ')}${e.txt ? '\n' + e.txt : ''}`).join('\n\n'));
    const pie = [`Actualizado el ${fe(j.actualizado)}${j.fisio ? ' por ' + j.fisio : ''}`, marca, CL.direccion || (marca === 'FISIO365' ? 'Gran de Sant Andreu 163, Barcelona' : ''), CL.tel || (marca === 'FISIO365' ? '672 89 39 49' : '')].filter(Boolean).join(' · ');
    const n = doc.getNumberOfPages(); for (let k = 1; k <= n; k++) { doc.setPage(k); doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...GR); doc.text(pie, W / 2, 288, { align: 'center' }); doc.text('Solo el parte deportivo: la historia clínica no se comparte.', W / 2, 292, { align: 'center' }); }
    const nom = 'Parte ' + String(j.jugador || '').replace(/[^\p{L}\p{N} ]/gu, '').trim() + '.pdf';
    const blob = doc.output('blob');
    try { const f = new File([blob], nom, { type: 'application/pdf' }); if (navigator.canShare && navigator.canShare({ files: [f] })) { await navigator.share({ files: [f], title: 'Parte de ' + j.jugador }); return; } } catch (e) { if (e && e.name === 'AbortError') return; }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nom; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  }

  // ── Mi equipo (el entrenador) ──
  async function pintarEquipo(abrir) {
    const box = el('miEquipoBox'); if (!box) return;
    const acc = misAccesos(), vista = P() && P().vista;
    if (P() && P().demo) { { const v = el('vistaMiequipo'); if (v) v.classList.remove('sin-acc'); } if (abrir) S.jug = abrir; S.equipo = demoDatos(); dibuja(); return; }
    { const v = el('vistaMiequipo'); if (v) v.classList.toggle('sin-acc', !acc.length && !vista); }
    if (!acc.length && !vista) { explicar(box); return; }
    if (abrir) S.jug = abrir;
    if (!S.equipo) box.innerHTML = '<div class="eq-vac">Cargando…</div>'; else dibuja();
    const d = await get('eq-equipo', vista ? { vista } : { a: acc.map(x => x.id).join(','), t: acc.map(x => x.tok).join(',') }).catch(() => null);
    if (!d || !d.ok) {
      if (d && d.inactivo && vista) { box.innerHTML = `<div class="eq-vac">${esc(d.error)}</div>`; return; }
      if (d && d.inactivo && P() && P().soloEquipo) { box.innerHTML = `<div class="eq-vac">${esc(d.error)}</div><button type="button" class="eq-ok" onclick="cerrarSesion()">Salir</button>`; return; }
      if (!S.equipo) box.innerHTML = `<div class="eq-vac">${esc((d && d.error) || 'No se ha podido cargar. Mira tu conexión.')}</div>`;
      return;
    }
    S.equipo = d; dibuja();
  }
  // Racha actual (días seguidos con ejercicios, contando hasta ayer si hoy aún no los ha hecho)
  function rachaHoy(L) {
    const S2 = new Set((L || []).map(x => String(x).slice(0, 10))), k = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const d = new Date(); d.setHours(12, 0, 0, 0); if (!S2.has(k(d))) d.setDate(d.getDate() - 1);
    let n = 0; while (S2.has(k(d))) { n++; d.setDate(d.getDate() - 1); } return n;
  }
  const llama = '<svg viewBox="0 0 24 24"><path d="M12 3c1.5 3 5 5 5 9a5 5 0 0 1-10 0c0-2 1-3.5 2-4.5.3 1.5 1 2.5 2 3 0-3 .5-5.5 1-7.5z"/></svg>';
  const rachaChip = L => { const n = rachaHoy(L); return `<em class="eq-rch${n ? '' : ' off'}">${llama}<span>${n ? (n === 1 ? '1 día de racha' : n + ' días de racha') : 'Sin racha'}</span></em>`; };
  // Varios equipos en un club: separados por equipo (si solo hay uno, sin títulos)
  function porEquipo(L) {
    const m = new Map(); L.forEach(x => { const k = String(x.equipo || '').trim(); if (!m.has(k)) m.set(k, []); m.get(k).push(x); });
    const g = [...m.entries()].sort((a, b) => (a[0] === '') - (b[0] === '') || a[0].localeCompare(b[0], 'es', { numeric: true }));
    return g.length > 1 ? g : [[null, L]];
  }
  function dibuja() {
    const box = el('miEquipoBox'), d = S.equipo; if (!box || !d) return;
    const todos = d.clubs.flatMap(c => c.jugadores.map(j => Object.assign({ club: c.nombre }, j)));
    const j = S.jug && todos.find(x => x.id === S.jug);
    clearInterval(S.poll);
    if (j && S.chat === j.id) { dibujaChat(box, j); return; }
    S.chat = null;
    if (j) {
      box.innerHTML = `<button type="button" class="eq-back">${IC.atras}<span>Mi equipo</span></button>
        <div class="eq-card eqp"><div class="eqp-top"><div class="eqp-av ${esc(j.semaforo)}">${esc(iniciales(j.jugador))}</div><div><b class="no-tr">${esc(j.jugador)}</b><small class="no-tr">${esc([j.equipo, d.clubs.length > 1 ? j.club : ''].filter(Boolean).join(' · '))}</small></div></div>
        ${verParte(j, '', true)}</div>
        ${P() && P().vista ? '' : `<button type="button" class="eqc-card"><div class="eqp-av">${esc(iniciales(j.fisio || 'F'))}</div><div><b>Habla con su fisio</b><small>Dudas sobre su vuelta, cargas, partidos…</small></div>${j.sinLeer ? `<em>${j.sinLeer}</em>` : IC.flecha}</button>`}
        <div class="eq-pt eq-rt">Racha de ejercicios</div><div class="eq-racha"></div>`;
      try { window.FisioRacha && FisioRacha.pintar(box.querySelector('.eq-racha'), j.racha || [], { quien: 'fisio', nombre: j.jugador }); } catch (e) {}
      box.querySelector('.eq-back').onclick = () => { S.jug = null; dibuja(); window.scrollTo(0, 0); };
      { const b = box.querySelector('.eqp-sh'); if (b) b.onclick = () => compartir(j); }
      { const b = box.querySelector('.eqc-card'); if (b) b.onclick = () => { S.chat = j.id; S.msgs = null; dibuja(); window.scrollTo(0, 0); }; }
      { const b = box.querySelector('.eqp-pdf'); if (b) b.onclick = async () => { b.disabled = true; await descargarPDF(j, j.club); b.disabled = false; }; }
      return;
    }
    S.jug = null;
    // Filtros: equipo y estado
    const equipos = [...new Set(todos.map(x => String(x.equipo || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es', { numeric: true }));
    if (S.feq && !equipos.includes(S.feq)) S.feq = '';
    const enEq = todos.filter(x => !S.feq || String(x.equipo || '').trim() === S.feq);
    const cuenta = k => enEq.filter(x => x.semaforo === k).length, tot = enEq.filter(x => x.semaforo).length;
    const tile = (k, t) => `<button type="button" class="eqd-k ${k}${S.fsem === k ? ' on' : ''}" data-k="${k}"><b>${cuenta(k)}</b><span>${t}</span></button>`;
    const disp = `<div class="eqd"><div class="eqd-h"><div><small>Hoy</small><b>Disponibilidad</b></div>${tot ? `<span>${cuenta('verde')}<em>/${tot}</em></span>` : ''}</div>
      <div class="eqd-bar">${tot ? ['verde', 'amarillo', 'rojo'].map(k => cuenta(k) ? `<i class="${k}" style="flex:${cuenta(k)}"></i>` : '').join('') : '<i></i>'}</div>
      <div class="eqd-ks">${tile('verde', 'Disponibles')}${tile('amarillo', 'Con limitaciones')}${tile('rojo', 'Bajas')}</div></div>`;
    const chips = equipos.length > 1 ? `<div class="eqd-eqs">${['', ...equipos].map(e => `<button type="button" data-e="${esc(e)}" class="${(S.feq || '') === e ? 'on' : ''}${e ? ' no-tr' : ''}">${e ? esc(e) : 'Todos'}</button>`).join('')}</div>` : '';
    const ve = x => (!S.feq || String(x.equipo || '').trim() === S.feq) && (!S.fsem || x.semaforo === S.fsem);
    const orden = L => L.slice().sort((a, b) => ((ORDEN[a.semaforo] ?? 3) - (ORDEN[b.semaforo] ?? 3)) || String(a.vuelta || '9').localeCompare(String(b.vuelta || '9')) || a.jugador.localeCompare(b.jugador, 'es'));
    const fila = (x, eqn) => { const v = vuelta(x);
      return `<button type="button" class="eq-ju" data-id="${x.id}"><div class="eqp-av ${esc(x.semaforo)}">${esc(iniciales(x.jugador))}</div><div>
        <div class="eqj-1"><b class="no-tr">${esc(x.jugador)}</b>${v ? `<em class="eqj-cd${v.n < 0 ? ' tarde' : ''}">${esc(textoVuelta(v))}</em>` : ''}</div>
        <small class="eqj-st ${esc(x.semaforo)}">${x.semaforo ? esc(SEM[x.semaforo]) : 'Sin parte todavía'}${x.fase ? ' · ' + esc(x.fase) : ''}</small>
        ${x.equipo && eqn === null && equipos.length > 1 ? `<small class="no-tr">${esc(x.equipo)}</small>` : ''}
        ${v ? `<div class="eqj-bar"><i style="width:${v.pct}%"></i></div>` : ''}
        <span class="eq-tags">${x.sinLeer ? `<em class="eq-rch eqc-new"><svg viewBox="0 0 24 24"><path d="M4.5 5h15v10.5H10L5.5 19.5V15.5h-1z"/></svg><span>${x.sinLeer === 1 ? 'Mensaje de su fisio' : x.sinLeer + ' mensajes de su fisio'}</span></em>` : ''}${rachaChip(x.racha)}${Array.isArray(x.ejercicios) && x.ejercicios.length ? `<em class="eq-rch eq-ejc"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg><span>${x.ejercicios.length === 1 ? '1 ejercicio' : x.ejercicios.length + ' ejercicios'}</span></em>` : ''}</span></div>${IC.flecha}</button>`; };
    const lista = d.clubs.map(c => { const L = orden(c.jugadores.filter(ve));
      return `<div class="eq-club"><div class="eq-cn"><b class="no-tr">${esc(c.nombre)}</b>${c.deporte ? `<small class="no-tr">${esc(c.deporte)}</small>` : ''}</div>
        ${!c.jugadores.length ? '<div class="eq-vac">Todavía no hay jugadores. Aparecerán aquí cuando un jugador que se trate con nosotros acepte compartir su parte con el club.</div>'
          : !L.length ? '<div class="eq-vac">Nadie con este filtro.</div>'
          : porEquipo(L).map(([eqn, G]) => `${eqn !== null && !S.feq ? `<div class="eq-tn no-tr">${esc(eqn || 'Sin equipo')}</div>` : ''}${G.map(x => fila(x, S.feq ? '' : eqn)).join('')}`).join('')}</div>`; }).join('');
    box.innerHTML = `${P() && (P().vista || P().demo) ? '' : avisosCard()}${disp}${chips}${lista}`;
    box.querySelectorAll('.eq-ju').forEach(b => b.onclick = () => { S.jug = b.dataset.id; dibuja(); window.scrollTo(0, 0); });
    box.querySelectorAll('.eqd-k').forEach(b => b.onclick = () => { S.fsem = S.fsem === b.dataset.k ? '' : b.dataset.k; dibuja(); });
    box.querySelectorAll('.eqd-eqs button').forEach(b => b.onclick = () => { S.feq = b.dataset.e; dibuja(); });
    const av = box.querySelector('.eq-avb'); if (av) av.onclick = activarAvisos;
    try { window.applyTranslations && applyTranslations(); } catch (e) {}
  }
  // ── Chat del entrenador con el fisio del jugador (el jugador no lo ve) ──
  const hora = f => { const d = new Date(f); return isNaN(d) ? '' : `${fe(f)} · ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  async function cargaChat(j, txt) {
    if (P() && P().demo) { // ejemplo: conversación inventada, no se manda nada
      if (!S.msgs) S.msgs = [{ f: new Date(Date.now() - 864e5).toISOString(), de: 'club', quien: 'Jordi', txt: '¿Puede jugar unos minutos el sábado?' }, { f: new Date(Date.now() - 8e7).toISOString(), de: 'fisio', quien: j.fisio || 'Sara', txt: 'Mejor que no: esta semana aún sin carrera. Si el jueves va bien, el siguiente partido ya podría jugar la segunda parte.' }];
      if (txt) S.msgs.push({ f: new Date().toISOString(), de: 'club', quien: 'Tú', txt });
      return true;
    }
    const acc = misAccesos(); if (!acc.length) return false;
    const q = { id: j.id, a: acc.map(x => x.id).join(','), t: acc.map(x => x.tok).join(',') };
    const d = await (txt ? post('eq-chat', Object.assign(q, { txt })) : get('eq-chat', q)).catch(() => null);
    if (!d || !d.ok) { window.toast && toast((d && d.error) || 'No se ha podido cargar. Mira tu conexión.', false); return false; }
    S.msgs = d.mensajes; j.sinLeer = 0; return true;
  }
  function dibujaChat(box, j) {
    const pinta = () => {
      const L = S.msgs || [], l = box.querySelector('.eqc-l'); if (!l) return;
      l.innerHTML = S.msgs === null ? '<div class="eqc-v">Cargando…</div>' : L.length ? L.map(m => `<div class="eqc-m ${m.de === 'club' ? 'yo' : ''}"><p class="no-tr">${esc(m.txt)}</p><small><span class="no-tr">${esc(m.de === 'club' ? m.quien : (m.quien || j.fisio || ''))}</span> · ${esc(hora(m.f))}</small></div>`).join('') : '<div class="eqc-v">Escribe lo que necesites saber: si puede jugar el fin de semana, qué cargas puede hacer, cómo lo ves en los entrenos…</div>';
      l.scrollTop = l.scrollHeight;
    };
    box.innerHTML = `<button type="button" class="eq-back">${IC.atras}<span class="no-tr">${esc(j.jugador)}</span></button>
      <div class="eq-card eqc"><div class="eqc-h"><div class="eqp-av">${esc(iniciales(j.fisio || 'F'))}</div><div><b>${j.fisio ? `<span class="no-tr">${esc(j.fisio)}</span>` : 'Su fisio'}</b><small>Lleva su recuperación</small></div></div>
      <div class="eqc-nota">Solo lo veis su fisio y el club: el jugador no. Habla de su recuperación y de la vuelta; la historia clínica no se comparte.</div>
      <div class="eqc-l"></div>
      <div class="eqc-in"><textarea rows="1" placeholder="Escribe un mensaje…"></textarea><button type="button" aria-label="Enviar"><svg viewBox="0 0 24 24"><path d="M5 12h13M13 6l6 6-6 6"/></svg></button></div></div>`;
    box.querySelector('.eq-back').onclick = () => { S.chat = null; dibuja(); window.scrollTo(0, 0); };
    const t = box.querySelector('.eqc-in textarea'), b = box.querySelector('.eqc-in button');
    t.oninput = () => { t.style.height = 'auto'; t.style.height = Math.min(120, t.scrollHeight) + 'px'; };
    b.onclick = async () => { const v = t.value.trim(); if (!v) return; b.disabled = true; if (await cargaChat(j, v)) { t.value = ''; t.style.height = ''; pinta(); } b.disabled = false; };
    pinta(); cargaChat(j).then(pinta);
    if (!(P() && P().demo)) S.poll = setInterval(() => { if (!box.querySelector('.eqc-l') || document.hidden) return; cargaChat(j).then(pinta); }, 15000);
    try { window.applyTranslations && applyTranslations(); } catch (e) {}
  }
  // Sin acceso: para qué es «Mi equipo», pedirlo por el chat o activarlo con la clave
  function explicar(box) {
    const ic = {
      cal: '<svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="15" rx="3"/><path d="M8 3v4M16 3v4M4 10h16"/></svg>',
      sem: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M12 8v4l2.5 2"/></svg>',
      ok: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
      bell: '<svg viewBox="0 0 24 24"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>',
      wa: '<svg viewBox="0 0 24 24"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.6A8 8 0 1 1 21 12z"/></svg>'
    };
    const fila = (sem, n, t) => `<div class="eqh-j"><i class="${sem}"></i><b>${n}</b><span>${t}</span></div>`;
    const ben = (i, t, s2) => `<div class="eqh-b"><div class="eq-cic">${i}</div><div><b>${t}</b><span>${s2}</span></div></div>`;
    box.innerHTML = `<div class="eqh">
        <div class="eqh-k">Para entrenadores y coordinadores</div>
        <h3>Seamos el fisio de tu equipo</h3>
        <p>Tus jugadores se recuperan antes y tú sabes en todo momento cómo van.</p>
        <div class="eqh-demo" aria-hidden="true">
          ${fila('verde', 'Marc', 'Puede jugar')}${fila('amarillo', 'Pol', 'Con limitaciones · vuelve el sábado')}${fila('rojo', 'Nil', 'No entrena · vuelve en 3 semanas')}
        </div>
      </div>
      <div class="eqh-bens">
        ${ben(ic.sem, 'Con quién cuentas', 'Quién puede jugar, quién entrena con limitaciones y quién no')}
        ${ben(ic.cal, 'Cuándo vuelve cada uno', 'La previsión de vuelta de tus lesionados')}
        ${ben(ic.ok, 'Cómo volver sin recaídas', 'Qué pueden hacer y cómo empezar a entrenar')}
        ${ben('<svg viewBox="0 0 24 24"><path d="M12 3c1.5 3 5 5 5 9a5 5 0 0 1-10 0c0-2 1-3.5 2-4.5.3 1.5 1 2.5 2 3 0-3 .5-5.5 1-7.5z"/></svg>', 'Si hace sus ejercicios', 'Su racha: los días que hacen sus ejercicios en casa')}
        ${ben('<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M10 9.5v5l4-2.5z"/></svg>', 'Sus ejercicios', 'Con vídeo, para que también los hagan en los entrenos')}
        ${ben(ic.bell, 'Avisos al momento', 'Cada vez que actualizamos el parte de un jugador')}
      </div>
      <button type="button" class="eqh-cta">${ic.wa}<span>Quiero colaborar</span></button>
      <button type="button" class="eqh-ej">Ver un ejemplo</button>
      <p class="eqh-nota">Te abrimos WhatsApp con el mensaje ya escrito. Solo verás el parte de los jugadores que lo acepten; su historia clínica no se comparte.</p>
      <div class="eqh-clave"><button type="button" class="eqh-cl">¿Tu club ya trabaja con nosotros y te hemos dado una clave? <u>Actívala aquí</u></button>
        <div class="eq-ob"><div class="eq-cl"><input type="tel" inputmode="numeric" maxlength="4" class="eq-tut eq-clv" placeholder="Clave de 4 números"><button type="button" class="eq-ok eq-act">Activar</button></div><div class="eq-err"></div></div></div>`;
    box.querySelector('.eqh-ej').onclick = () => { location.href = '/?demo=1'; };
    const cw = box.querySelector('.eqh-clave');
    cw.querySelector('.eqh-cl').onclick = () => { cw.classList.toggle('on'); if (cw.classList.contains('on')) setTimeout(() => box.querySelector('.eq-clv').focus(), 50); };
    box.querySelector('.eqh-cta').onclick = () => {
      const K = window.CLINICA || {}, nom = (P() && P().nombre) || '';
      const msg = `Hola, soy ${nom || 'un paciente'}. Entreno/coordino un equipo y me gustaría colaborar con ${K.marca || 'FISIO365'} para que seáis el fisio de referencia del equipo. Mi club es: ___ · Mi equipo: ___`;
      window.open('https://wa.me/' + (K.wa || '34672893949') + '?text=' + encodeURIComponent(msg), '_blank');
    };
    const b = box.querySelector('.eq-act'), inp = box.querySelector('.eq-clv'), err = box.querySelector('.eq-err');
    b.onclick = async () => {
      err.textContent = ''; const v = inp.value.replace(/\D/g, '');
      if (v.length !== 4) { err.textContent = 'Escribe los 4 números de tu clave'; return; }
      b.disabled = true; const r = await post('eq-clave', { patientId: P().id, clave: v }).catch(() => null); b.disabled = false;
      if (!r || !r.ok || !(r.equipo || []).length) { err.textContent = (r && r.error) || 'No se ha podido comprobar. Mira tu conexión.'; return; }
      P().equipo = r.equipo; guardaPaciente(); window.toast && toast('¡Listo! Ya tienes Mi equipo'); pintarEquipo();
    };
  }
  // Avisos para el entrenador: cuando se actualiza un parte
  const avisosOk = () => ('serviceWorker' in navigator) && ('PushManager' in window) && ('Notification' in window);
  function avisosCard() {
    if (!avisosOk() || Notification.permission === 'granted' || Notification.permission === 'denied') { if (avisosOk() && Notification.permission === 'granted') suscribir().catch(() => {}); return ''; }
    return `<div class="in-banner on eq-avb"><div class="av-ic"><svg viewBox="0 0 24 24"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg></div><div><b>Activa los avisos</b><span>Te avisamos cuando actualicemos el parte de un jugador</span></div><button class="ib">Activar</button></div>`;
  }
  async function suscribir() {
    const reg = await navigator.serviceWorker.register('/sw.js'); await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: window.urlBase64ToUint8Array(VAPID_PUBLIC) });
    await fetch('/api/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ equipo: misAccesos().map(x => ({ id: x.id, tok: x.tok })), subscription: sub }) });
  }
  async function activarAvisos() {
    try { const r = await Notification.requestPermission(); if (r === 'granted') { await suscribir(); window.toast && toast('¡Avisos activados!'); } } catch (e) {}
    dibuja();
  }

  // ── Solo entrenador (no es paciente): la app se abre solo con «Mi equipo» ──
  function iniciarSoloEquipo() {
    document.body.classList.add('solo-equipo', 'dentro');
    try { el('nmNom').textContent = P().nombre || ''; window.pintarAvatar && pintarAvatar(); } catch (e) {}
    el('loginScreen').style.display = 'none';
    const app = el('appScreen'); app.style.display = 'block'; app.style.opacity = '1';
    el('hamburgerBtn').style.display = 'flex';
    { const n = el('navMiEquipo'); if (n) n.style.display = 'flex'; }
    try { window.applyTranslations && applyTranslations(); } catch (e) {}
    const u = new URL(location.href), p0 = u.searchParams.get('p');
    if (p0) { S.jug = p0; S.chat = u.searchParams.get('chat') === '1' ? p0 : null; history.replaceState(null, '', location.pathname); }
    window.showSection('miequipo');
  }
  function salir() {
    // Al salir, este móvil deja de recibir los avisos de los partes
    const acc = misAccesos(); if (acc.length) fetch('/api/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ equipo: acc.map(x => ({ id: x.id, tok: x.tok })), borrar: true }), keepalive: true }).catch(() => {});
    document.body.classList.remove('solo-equipo'); S.partes = []; S.equipo = null; S.cargado = false; S.jug = null; menu(); const b = el('eqBanner'); if (b) b.classList.remove('on'); }

  // Ejemplo (?demo=1): un equipo inventado para enseñar cómo se ve, sin datos reales
  function demoDatos() {
    const d = n => { const x = new Date(); x.setDate(x.getDate() + n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
    const dias = (desde, hasta, salto) => { const L = []; for (let i = desde; i <= hasta; i++) if (!salto || !salto.includes(i)) L.push(d(-i)); return L; };
    const j = (id, jugador, equipo, semaforo, fase, diagnostico, vuelta, puede, noPuede, pautas, evolucion, racha, ejercicios) => ({ id, jugador, equipo, semaforo, fase, diagnostico, vuelta, puede, noPuede, pautas, evolucion, racha, ejercicios, actualizado: evolucion[0].f, fisio: 'Sara' });
    return { ok: true, demo: true, nombre: 'Ejemplo', semaforos: SEM, clubs: [{ id: 'demo', nombre: 'Club de ejemplo', deporte: 'Fútbol', jugadores: [
      j('d1', 'Marc García', 'Juvenil A', 'rojo', 'Tratamiento', 'Esguince de tobillo derecho, de grado medio.', d(21), 'Bici estática y trabajo de tren superior.', 'Correr, saltar y cambios de dirección.', 'Semana 1: bici 20 minutos.\nSemana 2: carrera continua suave.\nVuelta al grupo cuando lo confirmemos.',
        [{ f: d(-1) + 'T18:30:00', fisio: 'Sara', sem: 'rojo', fase: 'Tratamiento', txt: 'Baja la inflamación y ya apoya sin dolor. Empezamos ejercicios de equilibrio.' }, { f: d(-6) + 'T17:00:00', fisio: 'Sara', sem: 'rojo', fase: 'Valoración', txt: 'Primera sesión: inflamación moderada, le cuesta apoyar.' }], dias(0, 5),
        [{ name: 'Equilibrio a una pierna', series: 3, dur: 30, desc: 'Sobre la pierna lesionada, rodilla un poco flexionada.' }, { name: 'Elevación de talones', series: 3, reps: 15, desc: 'Despacio, subiendo y bajando en 3 segundos.' }, { name: 'Bicicleta estática', series: 1, dur: 1200, desc: 'Ritmo suave, sin dolor.' }]),
      j('d2', 'Pol Ruiz', 'Juvenil A', 'amarillo', 'Readaptación', 'Sobrecarga en los isquiotibiales.', d(4), 'Entrenar con el grupo, sin sprints.', 'Sprints y disparos a puerta.', 'Esta semana, intensidad progresiva. El sábado puede jugar unos minutos si no tiene molestias.',
        [{ f: d(-2) + 'T19:00:00', fisio: 'Jonathan', sem: 'amarillo', fase: 'Readaptación', txt: 'Ya corre sin molestias. Le queda recuperar la velocidad.' }, { f: d(-9) + 'T19:00:00', fisio: 'Jonathan', sem: 'rojo', fase: 'Tratamiento', txt: 'Dolor al estirar y al acelerar.' }], dias(1, 14, [6, 10]),
        [{ name: 'Puente de glúteo a una pierna', series: 3, reps: 12 }, { name: 'Nordic hamstring', series: 3, reps: 6, desc: 'Bajada lenta, con un compañero sujetando los tobillos.' }]),
      j('d3', 'Nil Serra', 'Infantil B', 'verde', 'Alta', 'Dolor de rodilla por crecimiento (Osgood-Schlatter), ya controlado.', '', 'Todo.', '', 'Seguir con los ejercicios de fuerza 2 días por semana.',
        [{ f: d(-3) + 'T18:00:00', fisio: 'Sara', sem: 'verde', fase: 'Alta', txt: 'Alta deportiva. Sin dolor en los últimos entrenos.' }], dias(0, 2),
        [{ name: 'Sentadilla isométrica en pared', series: 3, dur: 30, desc: 'Antes de entrenar. Sin dolor en la rodilla.' }, { name: 'Estiramiento de cuádriceps', series: 2, dur: 30 }]),
      j('d4', 'Aleix Ferrer', 'Infantil B', 'amarillo', 'Vuelta progresiva', 'Contractura en el gemelo izquierdo.', d(2), 'Entrenar al 70 %.', 'Partido completo.', 'Estiramientos antes y después de entrenar.',
        [{ f: d(-1) + 'T17:30:00', fisio: 'Juan', sem: 'amarillo', fase: 'Vuelta progresiva', txt: 'Mucho mejor. Puede entrenar con el grupo, sin forzar.' }, { f: d(-8) + 'T17:30:00', fisio: 'Juan', sem: 'rojo', fase: 'Tratamiento', txt: 'Contractura en el gemelo. Descanso de carrera unos días.' }], dias(4, 8),
        [{ name: 'Elevación de talones excéntrica', series: 3, reps: 12, desc: 'Sube con las dos piernas y baja despacio solo con la izquierda.' }, { name: 'Estiramiento de gemelo en pared', series: 2, dur: 30 }]),
      j('d5', 'Hugo Martín', 'Infantil B', 'rojo', 'Valoración', 'Golpe en la rodilla izquierda. Estamos esperando la resonancia para saber el alcance.', '', 'Bici suave y trabajo de tren superior.', 'Correr, saltar y contacto.', 'Cuando tengamos la resonancia, os pasamos el plan y la fecha de vuelta.',
        [{ f: d(-2) + 'T18:00:00', fisio: 'Sara', sem: 'rojo', fase: 'Valoración', txt: 'Valoración inicial. Rodilla estable, algo de derrame. Pedimos resonancia.' }], dias(0, 1),
        [{ name: 'Activación de cuádriceps', series: 3, reps: 15, desc: 'Tumbado, apretando la rodilla contra una toalla.' }])
    ] }] };
  }
  // Vista previa desde el panel (?vista=…): la app como la ve un coordinador del club, sin tocar la sesión guardada
  function vistaPrevia() {
    const q = new URL(location.href).searchParams, v = q.get('vista'), demo = q.get('demo') === '1';
    if (!demo && (!v || !/^rec[A-Za-z0-9]{14}\.\d+\.[a-f0-9]{20}$/.test(v))) return false;
    try { patient = { id: 'vista', nombre: demo ? 'Ejemplo' : 'Vista previa', soloEquipo: true, vista: demo ? '' : v, demo, equipo: [] }; } catch (e) {}
    document.body.classList.add('eq-vista');
    const b = document.createElement('div'); b.className = 'eq-vbar'; b.innerHTML = `<span>${demo ? 'Ejemplo: así lo ve el entrenador' : 'Vista previa: así lo ve el entrenador'}</span><button type="button">✕</button>`; document.body.appendChild(b);
    b.querySelector('button').onclick = () => { if (window.opener) window.close(); location.href = '/'; };
    iniciarSoloEquipo(); return true;
  }
  window.EQA = { vistaPrevia, cargar, pintarClub, pintarEquipo, iniciarSoloEquipo, salir, abrirJugador: (id, chat) => { S.jug = id; S.chat = chat ? id : null; S.msgs = null; } };
})();
