/* Visor de Obras Públicas — Comodoro Rivadavia
 * Sitio estático: lee data/obras.geojson (generado desde el sistema de obras).
 * Para conectarlo a la base de datos alcanza con cambiar FUENTE_DATOS por un
 * endpoint que devuelva el mismo GeoJSON.
 */
(() => {
  'use strict';

  const FUENTE_DATOS = 'data/obras.geojson';
  const CENTRO = [-45.864, -67.497];
  const LIMITES_CIUDAD = L.latLngBounds([-46.15, -67.95], [-45.6, -67.3]);
  const TEMA_KEY = 'obras-tema';

  // Tipos de obra: nombre para el vecino, color y pictograma (trazo SVG 24×24)
  const CATEGORIAS = {
    'cloacas':         { nombre: 'Cloacas',                  color: '#8b5e34', ico: 'M3 8h11a5 5 0 0 1 5 5v8M3 15h8a2 2 0 0 1 2 2v4' },
    'agua':            { nombre: 'Agua potable',             color: '#1f7fd1', ico: 'M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z' },
    'gas':             { nombre: 'Gas natural',              color: '#d99100', ico: 'M12 3c1 3 5 5 5 10a5 5 0 0 1-10 0c0-3 2-4.5 2-6.5 1.5 1 2.5 3 2.5 3S13.5 7 12 3z' },
    'drenaje':         { nombre: 'Desagües pluviales',       color: '#0f9a9a', ico: 'M2 9c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2M2 16c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2' },
    'vialidad':        { nombre: 'Calles y tránsito',        color: '#d1293d', ico: 'M9 3 5 21M15 3l4 18M12 5v2M12 11v2M12 17v2' },
    'espacio-publico': { nombre: 'Veredas y plazas',         color: '#3a9a3a', ico: 'M12 22v-6M12 3a5 5 0 0 0-5 5 4 4 0 0 0 0 8h10a4 4 0 0 0 0-8 5 5 0 0 0-5-5z' },
    'muros':           { nombre: 'Muros de contención',      color: '#7a5cc7', ico: 'M3 5h18v14H3zM3 12h18M9 5v7M15 12v7' },
    'edificios':       { nombre: 'Edificios y equipamiento', color: '#55606e', ico: 'M4 21V9l8-5 8 5v12M9 21v-6h6v6' },
    'otras':           { nombre: 'Otras obras',              color: '#898781', ico: 'M12 7v10M7 12h10' },
  };

  const estado = {
    obras: [],
    cats: new Set(),     // vacío = todas
    anio: 'todos',
    texto: '',
    sel: null,
    yo: null,            // L.LatLng de la persona, si compartió ubicación
    base: 'mapa',
  };

  const $ = s => document.querySelector(s);
  const VISOR = $('#visor');
  const PANEL = $('#panel');
  const esCelu = () => matchMedia('(max-width: 640px)').matches;
  const conHover = matchMedia('(hover: hover)').matches;
  const norm = s => (s || '').toString().normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtNum = n => new Intl.NumberFormat('es-AR').format(n);
  const fmtMes = ym => {
    if (!ym) return null;
    const [a, m] = ym.split('-').map(Number);
    const s = new Intl.DateTimeFormat('es-AR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(a, m - 1, 1)));
    return s.charAt(0).toUpperCase() + s.slice(1);
  };
  const fmtDist = m => m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toLocaleString('es-AR', { maximumFractionDigits: 1 })} km`;
  const icono = cat => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="${CATEGORIAS[cat].ico}"/></svg>`;
  const chipCat = (cat) => `<span class="chip-cat" style="--c:${CATEGORIAS[cat].color}">${icono(cat)}</span>`;

  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg; el.hidden = false;
    clearTimeout(toast.t); toast.t = setTimeout(() => (el.hidden = true), 3200);
  }

  // ---------------- Mapa ----------------
  const mapa = L.map('mapa', {
    zoomControl: false,
    minZoom: 10,
    maxBounds: LIMITES_CIUDAD.pad(0.6),
  }).setView(CENTRO, 12);
  L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(mapa);
  mapa.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>');

  // Recalcular el tamaño del mapa cuando cambia su contenedor (pestañas ocultas, rotación, etc.)
  if ('ResizeObserver' in window) new ResizeObserver(() => mapa.invalidateSize({ pan: false })).observe($('#mapa'));

  window.visorObras = { mapa, estado }; // útil para depurar desde la consola

  const IGN = '<a href="https://www.ign.gob.ar/" target="_blank" rel="noopener">IGN</a> + OpenStreetMap';
  const capas = {
    claro: L.tileLayer('https://wms.ign.gob.ar/geoserver/gwc/service/tms/1.0.0/capabaseargenmap@EPSG:3857@png/{z}/{x}/{-y}.png', { maxZoom: 19, maxNativeZoom: 18, attribution: IGN }),
    oscuro: L.tileLayer('https://wms.ign.gob.ar/geoserver/gwc/service/tms/1.0.0/argenmap_oscuro@EPSG:3857@png/{z}/{x}/{-y}.png', { maxZoom: 19, maxNativeZoom: 18, attribution: IGN }),
    satelite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, maxNativeZoom: 18, attribution: 'Imágenes © <a href="https://www.esri.com/" target="_blank" rel="noopener">Esri</a>' }),
  };
  let capaActual = null;
  const temaOscuro = () => document.documentElement.getAttribute('data-theme') === 'dark';
  function actualizarBase() {
    const nueva = estado.base === 'satelite' ? capas.satelite : (temaOscuro() ? capas.oscuro : capas.claro);
    if (nueva === capaActual) return;
    if (capaActual) mapa.removeLayer(capaActual);
    capaActual = nueva.addTo(mapa);
  }

  const grupo = L.layerGroup().addTo(mapa);
  const marcadores = new Map(); // id -> L.Marker
  let marcadorYo = null;

  // Márgenes para que nada quede tapado por el panel
  function margenPanel() {
    const p = PANEL.getBoundingClientRect();
    if (esCelu()) return { x: 0, y: p.height };
    return { x: PANEL.classList.contains('plegada') ? 0 : p.width, y: 0 };
  }
  function opcionesEncuadre(maxZoom) {
    const m = margenPanel();
    return { paddingTopLeft: [esCelu() ? 60 : 70, 24], paddingBottomRight: [m.x + 24, m.y + 24], maxZoom };
  }
  function encuadrar(bounds, maxZoom = 15) {
    if (!bounds.isValid()) return;
    mapa.flyToBounds(bounds, { ...opcionesEncuadre(maxZoom), duration: 0.6 });
  }
  function centrarEn(latlng, zoom) {
    zoom = Math.max(zoom ?? 16, mapa.getZoom());
    const m = margenPanel();
    const pt = mapa.project(latlng, zoom).add([m.x / 2, m.y / 2]);
    mapa.flyTo(mapa.unproject(pt, zoom), zoom, { duration: 0.6 });
  }

  // ---------------- Panel (plegar / hoja inferior) ----------------
  function plegarPanel(plegar) {
    PANEL.classList.toggle('plegada', plegar);
    $('#panel-head').setAttribute('aria-expanded', String(!plegar));
    $('#manija').setAttribute('aria-expanded', String(!plegar));
  }
  // Alto de la hoja en celular: lo usan el toast y los controles de Leaflet
  if ('ResizeObserver' in window) {
    new ResizeObserver(() => VISOR.style.setProperty('--vt-sheet-alto', PANEL.getBoundingClientRect().height + 'px')).observe(PANEL);
  }

  // ---------------- Filtros ----------------
  const coincideTexto = o => {
    if (!estado.texto) return true;
    return norm(estado.texto).split(/\s+/).filter(Boolean).every(t => o._busqueda.includes(t));
  };
  const coincideAnio = o => estado.anio === 'todos' || (estado.anio === 'sd' ? !o.presupuesto : o.presupuesto?.startsWith(estado.anio));
  const coincideCat = o => !estado.cats.size || estado.cats.has(o.categoria);
  const visibles = () => estado.obras.filter(o => coincideCat(o) && coincideAnio(o) && coincideTexto(o));
  const hayFiltros = () => estado.cats.size > 0 || estado.anio !== 'todos' || !!estado.texto;

  // ---------------- Render ----------------
  function render() {
    const lista = visibles();
    const ids = new Set(lista.map(o => o.id));

    // Marcadores
    for (const [id, mk] of marcadores) {
      const ver = ids.has(id);
      if (ver && !grupo.hasLayer(mk)) grupo.addLayer(mk);
      if (!ver && grupo.hasLayer(mk)) grupo.removeLayer(mk);
    }

    // Pills de tipo de obra (el conteo respeta año y búsqueda)
    const cont = {};
    estado.obras.filter(o => coincideAnio(o) && coincideTexto(o)).forEach(o => (cont[o.categoria] = (cont[o.categoria] || 0) + 1));
    const presentes = Object.keys(CATEGORIAS).filter(k => estado.obras.some(o => o.categoria === k));
    $('#pills-categorias').innerHTML = presentes.map(k => {
      const c = CATEGORIAS[k], n = cont[k] || 0, on = estado.cats.has(k);
      return `<button type="button" class="pill ${on ? 'activo' : ''}" data-cat="${k}" style="--c:${c.color}" aria-pressed="${on}" ${n || on ? '' : 'disabled'}>
        <span class="punto"></span>${esc(c.nombre)} <span class="n">${n}</span></button>`;
    }).join('');

    // Años (segmentado)
    const anios = [...new Set(estado.obras.map(o => o.presupuesto?.slice(0, 4)).filter(Boolean))].sort();
    const hayNulos = estado.obras.some(o => !o.presupuesto);
    const opciones = [['todos', 'Todos'], ...anios.map(a => [a, a]), ...(hayNulos ? [['sd', 'S/D']] : [])];
    $('#seg-anio').innerHTML = opciones.map(([v, t]) =>
      `<button type="button" class="seg ${estado.anio === v ? 'activo' : ''}" data-anio="${v}" ${v === 'sd' ? 'title="Sin fecha de presupuesto"' : ''}>${t}</button>`).join('');

    $('#btn-limpiar').classList.toggle('resaltado', hayFiltros());

    // Resumen en la cabecera del panel
    const enMapa = lista.filter(o => o.latlng).length;
    $('#stats').textContent = hayFiltros()
      ? `${lista.length} de ${estado.obras.length} obras · ${enMapa} en el mapa`
      : `${lista.length} obras · ${enMapa} en el mapa`;

    // Lista
    const ordenar = (a, b) => {
      if (estado.yo && a.latlng && b.latlng) return estado.yo.distanceTo(a.latlng) - estado.yo.distanceTo(b.latlng);
      return (b.presupuesto || '').localeCompare(a.presupuesto || '') || a.nombre.localeCompare(b.nombre, 'es');
    };
    const con = lista.filter(o => o.latlng).sort(ordenar);
    const sin = lista.filter(o => !o.latlng).sort(ordenar);
    const fila = o => {
      const sub = [o.barrio && `B° ${esc(o.barrio)}`, esc(CATEGORIAS[o.categoria].nombre), o.presupuesto?.slice(0, 4)].filter(Boolean).join(' · ');
      const dist = estado.yo && o.latlng ? `<span class="obra-dist">${fmtDist(estado.yo.distanceTo(o.latlng))}</span>` : '';
      return `<li><button type="button" class="obra-row ${o.latlng ? '' : 'sin-ubic'}" data-id="${o.id}">
        ${chipCat(o.categoria)}
        <span class="obra-texto"><span class="obra-nombre">${esc(o.nombre)}</span><span class="obra-sub">${sub}</span></span>
        ${dist}</button></li>`;
    };
    let html = con.map(fila).join('');
    if (sin.length) html += `<li class="lista-sep">Sin ubicación en el mapa (${sin.length})</li>` + sin.map(fila).join('');
    if (!lista.length) html = `<li class="lista-vacia">No encontramos obras con esos filtros.<br><button type="button" class="btn-mini" data-accion="limpiar">Ver todas las obras</button></li>`;
    $('#lista').innerHTML = html;
  }

  function renderFicha(o) {
    const c = CATEGORIAS[o.categoria];
    const dato = (titulo, valor, extra = '') =>
      `<li class="dato"><dt>${titulo}</dt>${valor
        ? `<dd>${valor}${extra ? `<small>${extra}</small>` : ''}</dd>`
        : '<dd class="sd">Sin dato</dd>'}</li>`;

    let plazoExtra = '';
    if (o.plazoDias >= 60 && !/mes/.test(o.plazoTexto)) plazoExtra = `aprox. ${Math.round(o.plazoDias / 30)} meses`;
    const benef = o.beneficiarios != null ? fmtNum(o.beneficiarios) : (o.beneficiariosTexto ? esc(o.beneficiariosTexto) : null);
    const lat = o.latlng?.lat.toFixed(6), lon = o.latlng?.lng.toFixed(6);

    $('#ficha').innerHTML = `
      <div class="ficha-top">
        ${chipCat(o.categoria)}
        <div>
          <p class="ficha-cat">${esc(c.nombre)}</p>
          <h2>${esc(o.nombre)}</h2>
          ${o.barrio ? `<p class="ficha-barrio">Barrio ${esc(o.barrio)}</p>` : ''}
        </div>
      </div>
      <dl class="datos">
        ${dato('Plazo de ejecución', o.plazoTexto && esc(o.plazoTexto), plazoExtra)}
        ${dato('Fecha de presupuesto', fmtMes(o.presupuesto))}
        ${dato('Beneficiarios', benef)}
        ${o.subSector ? dato('Lugar', esc(o.subSector)) : ''}
        ${o.subcategoria ? dato('Clasificación', esc(o.subcategoria)) : ''}
      </dl>
      <div class="ficha-acciones">
        ${o.latlng ? `
          <button type="button" class="btn-primario" data-accion="ver">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-6.1-7-11.5a7 7 0 0 1 14 0C19 14.9 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>
            Ver en el mapa</button>
          <a class="pill-accion" href="https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}" target="_blank" rel="noopener">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 11 18-8-8 18-2-8-8-2z"/></svg>
            Cómo llegar</a>` : ''}
        <button type="button" class="pill-accion" data-accion="compartir">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/></svg>
          Compartir</button>
      </div>
      ${o.latlng ? '' : '<p class="nota">Esta obra todavía no tiene una ubicación precisa cargada en el sistema, por eso no aparece en el mapa.</p>'}
      <p class="ficha-id">Proyecto N° ${o.id}</p>`;
  }

  // ---------------- Selección / navegación ----------------
  function marcarSeleccion(id) {
    for (const [mid, mk] of marcadores) {
      mk.getElement()?.firstElementChild?.classList.toggle('seleccionado', mid === id);
      mk.setZIndexOffset(mid === id ? 1000 : 0);
    }
  }

  function mostrarFicha(id, { volar = true } = {}) {
    const o = estado.obras.find(x => x.id === id);
    if (!o) { mostrarLista(); return; }
    const yaEstaba = estado.sel === id;
    estado.sel = id;
    renderFicha(o);
    $('#vista-lista').hidden = true;
    $('#vista-ficha').hidden = false;
    $('#ficha').scrollTop = 0;
    plegarPanel(false);
    marcarSeleccion(id);
    // Esperar a que el panel tome su alto final antes de centrar
    if (o.latlng && volar && !yaEstaba) requestAnimationFrame(() => centrarEn(o.latlng, 16));
    document.title = `${o.nombre} | Obras públicas`;
  }

  function mostrarLista() {
    estado.sel = null;
    $('#vista-ficha').hidden = true;
    $('#vista-lista').hidden = false;
    marcarSeleccion(null);
    document.title = 'Obras públicas | Comodoro Rivadavia';
  }

  // La URL refleja la obra abierta (#obra-191): se puede compartir y el botón "atrás" vuelve al listado.
  const idDeRuta = () => { const m = location.hash.match(/^#obra-(\d+)$/); return m ? Number(m[1]) : null; };
  function aplicarRuta() {
    const id = idDeRuta();
    if (id == null) { if (estado.sel != null) mostrarLista(); }
    else if (id !== estado.sel) mostrarFicha(id);
  }
  const abrir = id => { if (idDeRuta() === id) mostrarFicha(id); else location.hash = `obra-${id}`; };
  const volver = () => {
    if (idDeRuta() != null) history.pushState(null, '', location.pathname + location.search);
    mostrarLista();
  };

  // ---------------- Datos ----------------
  async function cargar() {
    const r = await fetch(FUENTE_DATOS, { cache: 'no-cache' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const gj = await r.json();
    estado.obras = gj.features.map(f => {
      const p = f.properties;
      const latlng = f.geometry?.type === 'Point' ? L.latLng(f.geometry.coordinates[1], f.geometry.coordinates[0]) : null;
      const categoria = CATEGORIAS[p.categoria] ? p.categoria : 'otras';
      return {
        ...p, categoria, latlng,
        _busqueda: norm([p.nombre, p.nombreOriginal, p.barrio, p.subSector, CATEGORIAS[categoria].nombre, p.id].join(' ')),
      };
    });

    for (const o of estado.obras) {
      if (!o.latlng) continue;
      const c = CATEGORIAS[o.categoria];
      const mk = L.marker(o.latlng, {
        icon: L.divIcon({ className: '', html: `<div class="mk" style="--c:${c.color}">${icono(o.categoria)}</div>`, iconSize: [24, 24], iconAnchor: [12, 12] }),
        keyboard: true, title: o.nombre, alt: o.nombre,
      });
      if (conHover) {
        const sub = [o.barrio && `Barrio ${esc(o.barrio)}`, o.plazoTexto && `Plazo: ${esc(o.plazoTexto)}`, fmtMes(o.presupuesto)].filter(Boolean).join(' · ');
        mk.bindTooltip(
          `<span class="tt-cab">${chipCat(o.categoria)}<span class="tt-cat">${esc(c.nombre)}</span></span>` +
          `<span class="tt-titulo">${esc(o.nombre)}</span>` +
          (sub ? `<span class="tt-sub">${sub}</span>` : '') +
          `<span class="tt-ayuda">Hacé clic para ver la ficha completa</span>`,
          { className: 'tt-obra', direction: 'top', offset: [0, -16] });
      }
      mk.on('click', () => abrir(o.id));
      marcadores.set(o.id, mk);
    }
  }

  // ---------------- Eventos ----------------
  let tEncuadre;
  function encuadrarVisibles() {
    clearTimeout(tEncuadre);
    tEncuadre = setTimeout(() => {
      const pts = visibles().filter(o => o.latlng).map(o => o.latlng);
      if (pts.length) encuadrar(L.latLngBounds(pts), 16);
    }, 350);
  }

  function aplicarTema(tema) {
    if (tema === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
    else document.documentElement.removeAttribute('data-theme');
    try { localStorage.setItem(TEMA_KEY, tema); } catch (_) {}
    actualizarBase();
  }

  function engancharEventos() {
    // Búsqueda y filtros
    let tBusqueda;
    $('#buscar').addEventListener('input', e => {
      clearTimeout(tBusqueda);
      tBusqueda = setTimeout(() => { estado.texto = e.target.value.trim(); render(); encuadrarVisibles(); }, 120);
    });
    const limpiar = () => {
      estado.cats.clear(); estado.anio = 'todos'; estado.texto = ''; $('#buscar').value = '';
      render(); encuadrarVisibles();
    };
    $('#btn-limpiar').addEventListener('click', limpiar);
    $('#pills-categorias').addEventListener('click', e => {
      const b = e.target.closest('.pill'); if (!b) return;
      const k = b.dataset.cat;
      estado.cats.has(k) ? estado.cats.delete(k) : estado.cats.add(k);
      render(); encuadrarVisibles();
    });
    $('#seg-anio').addEventListener('click', e => {
      const b = e.target.closest('.seg'); if (!b) return;
      estado.anio = b.dataset.anio; render(); encuadrarVisibles();
    });

    // Lista
    const lista = $('#lista');
    lista.addEventListener('click', e => {
      if (e.target.closest('[data-accion="limpiar"]')) return limpiar();
      const b = e.target.closest('.obra-row'); if (b) abrir(Number(b.dataset.id));
    });
    const resaltar = (e, on) => {
      const b = e.target.closest('.obra-row'); if (!b) return;
      marcadores.get(Number(b.dataset.id))?.getElement()?.firstElementChild?.classList.toggle('resaltado', on);
    };
    lista.addEventListener('mouseover', e => resaltar(e, true));
    lista.addEventListener('mouseout', e => resaltar(e, false));

    // Ficha
    $('#btn-volver').addEventListener('click', volver);
    $('#ficha').addEventListener('click', async e => {
      const b = e.target.closest('[data-accion]'); if (!b) return;
      const o = estado.obras.find(x => x.id === estado.sel); if (!o) return;
      if (b.dataset.accion === 'ver' && o.latlng) centrarEn(o.latlng, 17);
      if (b.dataset.accion === 'compartir') {
        const url = `${location.origin}${location.pathname}#obra-${o.id}`;
        try {
          if (navigator.share && esCelu()) await navigator.share({ title: o.nombre, text: 'Obra pública en Comodoro Rivadavia', url });
          else { await navigator.clipboard.writeText(url); toast('Enlace copiado'); }
        } catch (_) { /* cancelado */ }
      }
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && estado.sel != null) volver(); });
    window.addEventListener('hashchange', aplicarRuta);
    window.addEventListener('popstate', aplicarRuta);

    // Panel: plegar desde la cabecera o la manija (celular)
    const alternar = () => plegarPanel(!PANEL.classList.contains('plegada'));
    for (const el of [$('#panel-head'), $('#manija')]) {
      el.addEventListener('click', alternar);
      el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); alternar(); } });
    }
    engancharArrastreHoja();

    // Controles del mapa
    $('#btn-zoom-in').addEventListener('click', () => mapa.zoomIn());
    $('#btn-zoom-out').addEventListener('click', () => mapa.zoomOut());
    $('#btn-encuadre').addEventListener('click', () => encuadrar(L.latLngBounds(visibles().filter(o => o.latlng).map(o => o.latlng))));
    $('#btn-ubicarme').addEventListener('click', ubicarme);
    document.querySelectorAll('[data-base]').forEach(b => b.addEventListener('click', () => {
      estado.base = b.dataset.base;
      document.querySelectorAll('[data-base]').forEach(x => x.classList.toggle('activo', x === b));
      actualizarBase();
    }));

    // Encabezado
    $('#btn-tema').addEventListener('click', () => aplicarTema(temaOscuro() ? 'light' : 'dark'));
    $('#btn-fs').addEventListener('click', () => {
      if (document.fullscreenElement) document.exitFullscreen();
      else (VISOR.requestFullscreen || VISOR.webkitRequestFullscreen)?.call(VISOR);
    });

    // Destello al tocar botones (igual que el visor de transporte)
    VISOR.addEventListener('pointerdown', ev => {
      const el = ev.target.closest('.ctrl-acciones button, .vt-btn-header, .seg, .caja-head');
      if (!el) return;
      const r = el.getBoundingClientRect();
      el.style.setProperty('--vt-shine-x', (r.width ? ((ev.clientX - r.left) / r.width) * 100 : 50) + '%');
      el.style.setProperty('--vt-shine-y', (r.height ? ((ev.clientY - r.top) / r.height) * 100 : 50) + '%');
      el.style.setProperty('--vt-shine-radio', Math.max(r.width, r.height) * 0.55 + 'px');
      el.classList.remove('vt-destello');
      void el.offsetWidth;
      el.classList.add('vt-destello');
    });
    VISOR.addEventListener('animationend', ev => {
      if (ev.animationName === 'vt-destello') ev.target.classList.remove('vt-destello');
    });
  }

  // Hoja inferior: deslizar hacia arriba abre, hacia abajo pliega
  function engancharArrastreHoja() {
    let y0 = null;
    const TOPE_ARRIBA = -60, TOPE_ABAJO = 160, RESISTENCIA = 0.82, UMBRAL = 30;
    const zonaArrastre = t => t.closest('.vt-sheet-manija, .caja-head');
    PANEL.addEventListener('touchstart', e => {
      if (!esCelu() || !zonaArrastre(e.target)) return;
      y0 = e.touches[0].clientY;
      PANEL.style.transition = 'none';
    }, { passive: true });
    PANEL.addEventListener('touchmove', e => {
      if (y0 == null) return;
      const dy = (e.touches[0].clientY - y0) * RESISTENCIA;
      PANEL.style.transform = `translateY(${Math.max(TOPE_ARRIBA, Math.min(TOPE_ABAJO, dy))}px)`;
    }, { passive: true });
    PANEL.addEventListener('touchend', e => {
      if (y0 == null) return;
      const dy = e.changedTouches[0].clientY - y0;
      y0 = null;
      PANEL.style.transition = '';
      PANEL.style.transform = '';
      if (dy > UMBRAL) plegarPanel(true);
      else if (dy < -UMBRAL) plegarPanel(false);
    });
  }

  function ubicarme() {
    if (!navigator.geolocation) return toast('Tu navegador no permite obtener la ubicación');
    const btn = $('#btn-ubicarme');
    btn.classList.add('activo');
    navigator.geolocation.getCurrentPosition(pos => {
      const yo = L.latLng(pos.coords.latitude, pos.coords.longitude);
      if (!LIMITES_CIUDAD.contains(yo)) {
        btn.classList.remove('activo');
        return toast('Tu ubicación está fuera de Comodoro Rivadavia');
      }
      estado.yo = yo;
      if (marcadorYo) marcadorYo.setLatLng(yo);
      else marcadorYo = L.marker(yo, { icon: L.divIcon({ className: '', html: '<div class="mk-yo"></div>', iconSize: [16, 16], iconAnchor: [8, 8] }), interactive: false, zIndexOffset: 2000 }).addTo(mapa);
      render();
      if (estado.sel != null) volver();
      plegarPanel(false);
      const cercanas = visibles().filter(o => o.latlng).sort((a, b) => yo.distanceTo(a.latlng) - yo.distanceTo(b.latlng)).slice(0, 5);
      encuadrar(L.latLngBounds([yo, ...cercanas.map(o => o.latlng)]), 16);
      toast('Ordenamos las obras de la más cercana a la más lejana');
    }, () => {
      btn.classList.remove('activo');
      toast('No pudimos obtener tu ubicación');
    }, { enableHighAccuracy: true, timeout: 10000 });
  }

  // ---------------- Inicio ----------------
  actualizarBase();
  if (esCelu() && idDeRuta() == null) plegarPanel(true); // en celular arranca con el mapa despejado
  engancharEventos();
  cargar().then(() => {
    render();
    const pts = estado.obras.filter(o => o.latlng).map(o => o.latlng);
    if (pts.length) {
      mapa.invalidateSize({ pan: false });
      mapa.fitBounds(L.latLngBounds(pts), { ...opcionesEncuadre(15), animate: false });
    }
    aplicarRuta();
  }).catch(err => {
    console.error(err);
    $('#stats').textContent = 'No pudimos cargar las obras';
    toast('No pudimos cargar las obras. Probá recargar la página.');
  });
})();
