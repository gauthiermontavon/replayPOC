/* Fonds de carte hybrides : en ligne (si dispo) → tuiles locales (si présentes) → fond vectoriel embarqué */
(function () {
  'use strict';
  const RP = window.RP, U = RP.util;

  const ONLINE = {
    plan: {
      label: 'Plan (Esri World Street Map)',
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
      opts: { maxZoom: 19, attribution: 'Plan &copy; Esri, HERE, Garmin, &copy; OpenStreetMap contributors' }
    },
    osm: {
      label: 'OpenStreetMap standard',
      url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      opts: { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }
    },
    sat: {
      label: 'Satellite (Esri)',
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      opts: { maxZoom: 19, attribution: 'Imagerie &copy; Esri' }
    }
  };
  const PROBE = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/0/0/0';

  const B = (RP.basemap = { mode: U.store.get('basemap', 'auto'), online: null, layers: {} });
  let map, current = [];

  function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

  function vectorLayer() {
    if (B.layers.vector) return B.layers.vector;
    let gj = null;
    try {
      const topo = window.WORLD_TOPO;
      if (topo && window.topojson) gj = window.topojson.feature(topo, topo.objects.countries);
    } catch (e) { console.warn('Fond vectoriel', e); }
    // Pane dédié sous les tuiles (tilePane = 200) pour que les tuiles le recouvrent
    if (!map.getPane('vectorBase')) map.createPane('vectorBase').style.zIndex = 150;
    const renderer = L.canvas({ padding: 0.3, pane: 'vectorBase' });
    B.layers.vector = L.geoJSON(gj, {
      renderer, pane: 'vectorBase', interactive: false,
      style: () => ({ color: css('--land-stroke') || '#b9b3a6', weight: 0.8, fillColor: css('--land') || '#f6f4ef', fillOpacity: 1 }),
      attribution: 'Fond hors ligne : Natural Earth'
    });
    return B.layers.vector;
  }

  function localLayer() {
    const cfg = window.LOCAL_TILES;
    if (!cfg) return null;
    if (B.layers.local) return B.layers.local;
    B.layers.local = L.tileLayer(cfg.url || 'tiles/{z}/{x}/{y}.' + (cfg.ext || 'png'), {
      minZoom: cfg.minZoom || 0, maxZoom: 20, maxNativeZoom: cfg.maxZoom || 18,
      bounds: cfg.bounds ? L.latLngBounds(cfg.bounds) : undefined,
      attribution: cfg.attribution || 'Tuiles locales', errorTileUrl: ''
    });
    return B.layers.local;
  }

  function onlineLayer(key) {
    if (B.layers[key]) return B.layers[key];
    const d = ONLINE[key];
    B.layers[key] = L.tileLayer(d.url, Object.assign({ crossOrigin: false, errorTileUrl: '' }, d.opts));
    return B.layers[key];
  }

  function apply() {
    current.forEach(l => map.removeLayer(l));
    current = [];
    const want = [];
    const m = B.mode;
    // Le fond vectoriel est toujours dessous : il apparaît là où les tuiles manquent.
    want.push(vectorLayer());
    if (m === 'auto') {
      if (localLayer()) want.push(localLayer());
      if (B.online) want.push(onlineLayer('plan'));
    } else if (m === 'local') {
      if (localLayer()) want.push(localLayer());
    } else if (ONLINE[m]) {
      want.push(onlineLayer(m));
    }
    want.forEach(l => { l.addTo(map); current.push(l); });
    renderMenu();
  }

  function setOnline(v) {
    if (B.online === v) return;
    B.online = v;
    const dot = U.$('#net-dot');
    dot.className = 'net-dot ' + (v ? 'online' : 'offline');
    dot.title = v ? 'En ligne — fonds de carte détaillés disponibles' : 'Hors ligne — fond vectoriel embarqué';
    apply();
  }

  function probe() {
    if (!navigator.onLine) { setOnline(false); return; }
    const img = new Image();
    let done = false;
    const fin = v => { if (!done) { done = true; setOnline(v); } };
    img.onload = () => fin(true);
    img.onerror = () => fin(false);
    setTimeout(() => fin(false), 5000);
    img.src = PROBE + '?_=' + Date.now();
  }

  function renderMenu() {
    const menu = U.$('#basemap-menu');
    const opts = [['auto', 'Automatique (hybride)']]
      .concat(Object.keys(ONLINE).map(k => [k, ONLINE[k].label]))
      .concat([['local', 'Tuiles locales (dossier tiles/)'], ['vector', 'Vectoriel hors ligne']]);
    menu.innerHTML = '';
    opts.forEach(([k, label]) => {
      const disabled = (k === 'local' && !window.LOCAL_TILES) || (ONLINE[k] && B.online === false);
      menu.append(U.el('button', { class: B.mode === k ? 'on' : '', disabled, text: label, onclick: () => { B.set(k); menu.hidden = true; } }));
    });
    menu.append(U.el('div', { class: 'menu-note', text: B.online ? 'Connexion Internet détectée' : 'Hors ligne : fond vectoriel' + (window.LOCAL_TILES ? ' + tuiles locales' : '') }));
  }

  B.set = function (mode) { B.mode = mode; U.store.set('basemap', mode); apply(); };

  B.init = function (m) {
    map = m;
    apply();
    probe();
    window.addEventListener('online', probe);
    window.addEventListener('offline', () => setOnline(false));
    const btn = U.$('#btn-basemap'), menu = U.$('#basemap-menu');
    btn.addEventListener('click', (e) => { e.stopPropagation(); renderMenu(); menu.hidden = !menu.hidden; });
    document.addEventListener('click', (e) => { if (!menu.contains(e.target)) menu.hidden = true; });
    // Recolore le fond vectoriel si le thème système change
    if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (B.layers.vector) B.layers.vector.setStyle({ color: css('--land-stroke'), fillColor: css('--land') });
    });
  };
})();
