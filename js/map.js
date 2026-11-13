/* Carte Leaflet : repères par type de média, trajectoires, suivi des médias actifs */
(function () {
  'use strict';
  const RP = window.RP, U = RP.util, M = RP.model;

  const V = (RP.mapview = { map: null, follow: false });
  const marks = new Map();   // id -> { marker, state, line, done, lastIdx }
  let selectedId = null;
  let pickResolve = null;

  V.init = function () {
    const map = (V.map = L.map('map', { zoomControl: false, worldCopyJump: true, zoomSnap: 0.5, attributionControl: true })
      .setView([46.8, 8.2], 7));
    L.control.zoom({ position: 'bottomleft', zoomInTitle: 'Zoomer', zoomOutTitle: 'Dézoomer' }).addTo(map);
    L.control.scale({ position: 'bottomleft', imperial: false }).addTo(map);
    map.attributionControl.setPrefix('<a href="https://leafletjs.com" title="Leaflet">Leaflet</a>');
    RP.basemap.init(map);

    map.on('click', (e) => {
      if (pickResolve) { const r = pickResolve; endPick(); r({ lat: +e.latlng.lat.toFixed(7), lon: +e.latlng.lng.toFixed(7) }); }
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && pickResolve) { const r = pickResolve; endPick(); r(null); } });
    map.on('dragstart', () => { if (V.follow) V.setFollow(false); });
  };

  function iconFor(it) {
    const head = it.type === 'moving-object' ? '<div class="heading"></div>' : '';
    return L.divIcon({
      className: 'rp-marker ' + it.type + ' inactive',
      html: head + '<div class="rp-pin">' + U.icons[it.type] + '</div><div class="rp-label">' + U.esc(it.name) + '</div>',
      iconSize: [34, 34], iconAnchor: [17, 17]
    });
  }

  function cssColor(type) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(type === 'moving-object' ? '--moving' : type === 'image' ? '--image' : '--video').trim();
    return v || '#2563eb';
  }

  /** (Re)construit tous les repères depuis le modèle. */
  V.build = function () {
    marks.forEach(m => { m.marker.remove(); m.full && m.full.remove(); m.done && m.done.remove(); });
    marks.clear();
    M.items.forEach(addItem);
    if (RP.player) V.update(RP.player.t, RP.player.activeIds);
  };

  function addItem(it) {
    const pos = it.type === 'moving-object' ? (it.track && it.track[0]) : it.pos;
    if (!pos) return;
    const m = { state: '' };
    if (it.type === 'moving-object' && it.track.length > 1) {
      const ll = it.track.map(p => [p.lat, p.lon]);
      const c = cssColor(it.type);
      m.full = L.polyline(ll, { color: c, weight: 3, opacity: 0.35, dashArray: '6 6', interactive: false }).addTo(V.map);
      m.done = L.polyline([], { color: c, weight: 4, opacity: 0.9, interactive: false }).addTo(V.map);
    }
    m.marker = L.marker([pos.lat, pos.lon], { icon: iconFor(it), title: it.name, keyboard: false, riseOnHover: true }).addTo(V.map);
    m.marker.on('click', () => RP.bus.emit('item:click', it.id));
    m.marker.on('dragend', () => {
      const p = m.marker.getLatLng();
      M.update(it.id, { position: { lat: +p.lat.toFixed(7), lon: +p.lng.toFixed(7) } });
    });
    marks.set(it.id, m);
  }

  /** Rafraîchit un seul média après édition. */
  V.refreshItem = function (id) {
    const m = marks.get(id);
    if (m) { m.marker.remove(); m.full && m.full.remove(); m.done && m.done.remove(); marks.delete(id); }
    const it = M.get(id);
    if (it) addItem(it);
    if (RP.player) V.update(RP.player.t, RP.player.activeIds, true);
    V.select(selectedId);
  };

  /** Appelé à chaque frame par le player. */
  V.update = function (t, activeIds, force) {
    marks.forEach((m, id) => {
      const it = M.get(id);
      if (!it) return;
      const active = activeIds && activeIds.has(id);
      const state = (active ? 'active' : 'inactive') + (id === selectedId ? ' selected' : '');
      if (state !== m.state || force) {
        m.state = state;
        const el = m.marker.getElement();
        if (el) {
          el.classList.toggle('active', active);
          el.classList.toggle('inactive', !active);
          el.classList.toggle('selected', id === selectedId);
        }
        m.marker.setZIndexOffset(active ? 1000 : id === selectedId ? 500 : 0);
      }
      if (it.type === 'moving-object' && it.track && it.track.length) {
        const p = M.positionAt(it, t);
        m.marker.setLatLng([p.lat, p.lon]);
        const el = m.marker.getElement();
        const h = el && el.querySelector('.heading');
        if (h) h.style.transform = 'rotate(' + p.heading + 'deg)';
        if (m.done) {
          if (m.lastIdx !== p.idx || force) {
            m.lastIdx = p.idx;
            m.base = t <= it.tStart ? [] : it.track.slice(0, p.idx + 1).map(q => [q.lat, q.lon]);
          }
          m.done.setLatLngs(t <= it.tStart ? [] : m.base.concat([[p.lat, p.lon]]));
        }
      }
    });
    if (V.follow) followActive(activeIds);
  };

  const followActive = U.throttle(function (activeIds) {
    const pts = [];
    activeIds.forEach(id => {
      const m = marks.get(id);
      if (m) pts.push(m.marker.getLatLng());
    });
    if (!pts.length) return;
    const b = L.latLngBounds(pts);
    const view = V.map.getBounds().pad(-0.15);
    if (!view.contains(b)) {
      if (pts.length === 1) V.map.panTo(pts[0], { animate: true, duration: 0.6 });
      else V.map.fitBounds(b, { padding: [120, 120], maxZoom: Math.max(V.map.getZoom(), 15), animate: true });
    }
  }, 600);

  V.setFollow = function (on) {
    V.follow = on;
    U.$('#btn-follow').classList.toggle('on', on);
    if (on && RP.player) followActive(RP.player.activeIds);
  };

  V.fitAll = function (animate) {
    const pts = [];
    M.items.forEach(it => {
      if (it.type === 'moving-object' && it.track) it.track.forEach(p => pts.push([p.lat, p.lon]));
      else if (it.pos) pts.push([it.pos.lat, it.pos.lon]);
    });
    if (!pts.length) return;
    const b = L.latLngBounds(pts);
    V.map.fitBounds(b, { padding: [170, 170], maxZoom: 16, animate: animate !== false });
  };

  /** Sélection (depuis l'éditeur) : le repère devient déplaçable. */
  V.select = function (id, pan) {
    selectedId = id;
    marks.forEach((m, mid) => {
      const it = M.get(mid);
      const drag = mid === id && it && it.type !== 'moving-object';
      if (m.marker.dragging) drag ? m.marker.dragging.enable() : m.marker.dragging.disable();
      const el = m.marker.getElement();
      if (el) el.classList.toggle('selected', mid === id);
    });
    if (pan && id && marks.has(id)) {
      const ll = marks.get(id).marker.getLatLng();
      if (!V.map.getBounds().pad(-0.2).contains(ll)) V.map.panTo(ll);
    }
  };

  V.focus = function (id) {
    const m = marks.get(id);
    if (m) V.map.panTo(m.marker.getLatLng(), { animate: true });
  };

  /** Mode « placer sur la carte » : résout la promesse avec {lat, lon} ou null (Échap). */
  V.pickPosition = function () {
    if (pickResolve) endPick();
    U.$('#map').classList.add('placing');
    U.toast('Cliquez sur la carte pour placer le média (Échap pour annuler)', 4000);
    return new Promise(res => { pickResolve = res; });
  };
  function endPick() { pickResolve = null; U.$('#map').classList.remove('placing'); }
})();
