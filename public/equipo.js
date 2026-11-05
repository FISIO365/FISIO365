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
  const S = { partes: [], equipo: null, cargado: false, jug: null };
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
    if (c) c.style.display = S.partes.length ? 'flex' : 'none';
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
    if (!S.partes.length) { box.innerHTML = '<div class="eq-vac">No estás en ningún club con «Mi equipo».</div>'; return; }
    box.innerHTML = S.partes.map(x => {
      const ok = x.consentimiento === 'Aceptado';
      return `<div class="eq-card" data-id="${x.id}">
        <div class="eq-ch"><div class="eq-cic">${IC.club}</div><div><b class="no-tr">${esc(x.club)}</b>${x.equipo ? `<small class="no-tr">${esc(x.equipo)}</small>` : ''}</div>
          <span class="eq-st ${ok ? 'ok' : x.consentimiento === 'Retirado' ? 'no' : 'pe'}">${ok ? 'Lo compartes' : x.consentimiento === 'Retirado' ? 'No lo compartes' : 'Pendiente'}</span></div>
        ${ok ? `<p class="eq-p">Tu club ve el parte de tu recuperación desde el ${esc(fe(x.consFecha))}. Tu historia clínica no la ve nadie más que tu fisio.</p>
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

  // El parte tal como lo ve el club
  function verParte(p, titulo) {
    if (!p) return '';
    const bloque = (t, v) => v ? `<div class="eq-bl"><span>${t}</span><p class="no-tr">${esc(v)}</p></div>` : '';
    const vacio = !p.semaforo && !p.diagnostico && !p.puede && !p.noPuede && !p.pautas;
    return `<div class="eq-parte">${titulo ? `<div class="eq-pt">${titulo}</div>` : ''}
      ${vacio ? '<div class="eq-vac">Tu fisio todavía no ha escrito el parte.</div>' : `
      ${p.semaforo ? `<div class="eq-sm ${esc(p.semaforo)}"><i></i><b>${esc(SEM[p.semaforo] || '')}</b>${p.fase ? `<span>${esc(p.fase)}</span>` : ''}</div>` : ''}
      ${p.vuelta ? `<div class="eq-vu"><span>Vuelta prevista</span><b>${esc(fe(p.vuelta))}</b></div>` : ''}
      ${bloque('Qué le pasa', p.diagnostico)}${bloque('Qué puede hacer', p.puede)}${bloque('Qué no puede hacer', p.noPuede)}${bloque('Cómo empezar a entrenar', p.pautas)}
      ${(p.evolucion || []).length ? `<div class="eq-bl"><span>Evolución</span><div class="eq-evo">${p.evolucion.map(e => `<div class="eq-ev"><i class="${esc(e.sem || '')}"></i><b>${esc(fe(e.f))}${e.fisio ? ' · <span class="no-tr">' + esc(e.fisio) + '</span>' : ''}</b>${[SEM[e.sem], e.fase].filter(Boolean).length ? `<small>${junta([SEM[e.sem], e.fase])}</small>` : ''}${e.txt ? `<p class="no-tr">${esc(e.txt)}</p>` : ''}</div>`).join('')}</div></div>` : ''}
      ${p.actualizado ? `<div class="eq-act">Actualizado el ${esc(fe(p.actualizado))}${p.fisio ? ' por ' + esc(p.fisio) : ''}</div>` : ''}`}
    </div>`;
  }

  // ── Mi equipo (el entrenador) ──
  async function pintarEquipo(abrir) {
    const box = el('miEquipoBox'); if (!box) return;
    const acc = misAccesos(), vista = P() && P().vista;
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
    if (j) {
      box.innerHTML = `<button type="button" class="eq-back">${IC.atras}<span>Mi equipo</span></button>
        <div class="eq-card"><div class="eq-ch"><span class="eq-dot ${esc(j.semaforo)}"></span><div><b class="no-tr">${esc(j.jugador)}</b><small class="no-tr">${esc([j.equipo, d.clubs.length > 1 ? j.club : ''].filter(Boolean).join(' · '))}</small></div></div>
        ${verParte(j, '')}</div>
        <div class="eq-pt eq-rt">Racha de ejercicios</div><div class="eq-racha"></div>`;
      try { window.FisioRacha && FisioRacha.pintar(box.querySelector('.eq-racha'), j.racha || [], { quien: 'fisio', nombre: j.jugador }); } catch (e) {}
      box.querySelector('.eq-back').onclick = () => { S.jug = null; dibuja(); window.scrollTo(0, 0); };
      return;
    }
    S.jug = null;
    const cuenta = k => todos.filter(x => x.semaforo === k).length;
    box.innerHTML = `${P() && P().vista ? '' : avisosCard()}<div class="eq-res">${Object.keys(SEM).map(k => `<div class="eq-rk ${k}"><b>${cuenta(k)}</b><span>${SEM[k]}</span></div>`).join('')}</div>` +
      d.clubs.map(c => `<div class="eq-club"><div class="eq-cn"><b class="no-tr">${esc(c.nombre)}</b>${c.deporte ? `<small class="no-tr">${esc(c.deporte)}</small>` : ''}</div>
        ${c.jugadores.length ? porEquipo(c.jugadores).map(([eqn, L]) => `${eqn !== null ? `<div class="eq-tn no-tr">${esc(eqn || 'Sin equipo')}</div>` : ''}${L.map(x => `<button type="button" class="eq-ju" data-id="${x.id}"><span class="eq-dot ${esc(x.semaforo)}"></span><div><b class="no-tr">${esc(x.jugador)}</b><small>${junta([x.semaforo ? SEM[x.semaforo] : 'Sin parte todavía', x.vuelta ? 'vuelta prevista el ' + fe(x.vuelta) : ''])}</small>${x.equipo && eqn === null ? `<small class="no-tr">${esc(x.equipo)}</small>` : ''}${rachaChip(x.racha)}</div>${IC.flecha}</button>`).join('')}`).join('')
        : '<div class="eq-vac">Todavía no hay jugadores. Aparecerán aquí cuando un jugador que se trate con nosotros acepte compartir su parte con el club.</div>'}</div>`).join('');
    box.querySelectorAll('.eq-ju').forEach(b => b.onclick = () => { S.jug = b.dataset.id; dibuja(); window.scrollTo(0, 0); });
    const av = box.querySelector('.eq-avb'); if (av) av.onclick = activarAvisos;
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
        ${ben(ic.bell, 'Avisos al momento', 'Cada vez que actualizamos el parte de un jugador')}
      </div>
      <button type="button" class="eqh-cta">${ic.wa}<span>Quiero colaborar</span></button>
      <p class="eqh-nota">Te abrimos WhatsApp con el mensaje ya escrito. Solo verás el parte de los jugadores que lo acepten; su historia clínica no se comparte.</p>
      <div class="eqh-clave"><button type="button" class="eqh-cl">¿Tu club ya trabaja con nosotros y te hemos dado una clave? <u>Actívala aquí</u></button>
        <div class="eq-ob"><div class="eq-cl"><input type="tel" inputmode="numeric" maxlength="4" class="eq-tut eq-clv" placeholder="Clave de 4 números"><button type="button" class="eq-ok eq-act">Activar</button></div><div class="eq-err"></div></div></div>`;
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
    if (p0) { S.jug = p0; history.replaceState(null, '', location.pathname); }
    window.showSection('miequipo');
  }
  function salir() {
    // Al salir, este móvil deja de recibir los avisos de los partes
    const acc = misAccesos(); if (acc.length) fetch('/api/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ equipo: acc.map(x => ({ id: x.id, tok: x.tok })), borrar: true }), keepalive: true }).catch(() => {});
    document.body.classList.remove('solo-equipo'); S.partes = []; S.equipo = null; S.cargado = false; S.jug = null; menu(); const b = el('eqBanner'); if (b) b.classList.remove('on'); }

  // Vista previa desde el panel (?vista=…): la app como la ve un coordinador del club, sin tocar la sesión guardada
  function vistaPrevia() {
    const v = new URL(location.href).searchParams.get('vista');
    if (!v || !/^rec[A-Za-z0-9]{14}\.\d+\.[a-f0-9]{20}$/.test(v)) return false;
    window.patient = undefined;
    try { patient = { id: 'vista', nombre: 'Vista previa', soloEquipo: true, vista: v, equipo: [] }; } catch (e) {}
    document.body.classList.add('eq-vista');
    const b = document.createElement('div'); b.className = 'eq-vbar'; b.innerHTML = '<span>Vista previa: así lo ve el entrenador</span>'; document.body.appendChild(b);
    iniciarSoloEquipo(); return true;
  }
  window.EQA = { vistaPrevia, cargar, pintarClub, pintarEquipo, iniciarSoloEquipo, salir, abrirJugador: id => { S.jug = id; } };
})();
