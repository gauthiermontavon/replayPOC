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

  function iconFor(type, label, count) {
    const head = type === 'moving-object' ? '<div class="heading"></div>' : '';
    const badge = count > 1 ? '<span class="rp-count">' + count + '</span>' : '';
    return L.divIcon({
      className: 'rp-marker ' + type + ' inactive',
      html: head + '<div class="rp-pin">' + U.icons[type] + badge + '</div><div class="rp-label">' + U.esc(label) + '</div>',
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
    M.roots.forEach(addNode);
    if (RP.player) V.update(RP.player.t, RP.player.activeIds);
  };

  /*
   * Repères : clé -> { marker, ids:Set (éléments jouables représentés), node (item ou caméra), videos? }
   *  - image / objet mobile : un repère, clé = id
   *  - caméra : vidéos groupées par position effective ; 1 groupe → clé = id caméra, sinon 1 repère par groupe
   */
  function addNode(node) {
    if (node.type === 'camera') return addCamera(node);
    const it = node;
    const pos = it.type === 'moving-object' ? (it.track && it.track[0]) : it.pos;
    if (!pos) return;
    const m = { state: '', ids: new Set([it.id]), node: it };
    if (it.type === 'moving-object' && it.track.length > 1) {
      const ll = it.track.map(p => [p.lat, p.lon]);
      const c = cssColor(it.type);
      m.full = L.polyline(ll, { color: c, weight: 3, opacity: 0.35, dashArray: '6 6', interactive: false }).addTo(V.map);
      m.done = L.polyline([], { color: c, weight: 4, opacity: 0.9, interactive: false }).addTo(V.map);
    }
    m.marker = L.marker([pos.lat, pos.lon], { icon: iconFor(it.type, it.name), title: it.name, keyboard: false, riseOnHover: true }).addTo(V.map);
    m.marker.on('click', () => RP.bus.emit('item:click', it.id));
    m.marker.on('dragend', () => {
      const p = m.marker.getLatLng();
      M.update(it.id, { position: { lat: +p.lat.toFixed(7), lon: +p.lng.toFixed(7) } });
    });
    marks.set(it.id, m);
  }

  function addCamera(cam) {
    const groups = new Map();
    cam.videos.forEach(v => {
      if (!v.pos) return;
      const k = v.pos.lat.toFixed(6) + ',' + v.pos.lon.toFixed(6);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(v);
    });
    const single = groups.size === 1;
    groups.forEach((vids, k) => {
      const key = single ? cam.id : cam.id + '@' + k;
      const label = single ? cam.name : cam.name + ' · séq. ' + vids.map(v => v.seq).join(', ');
      const count = cam.videos.length > 1 ? vids.length : 0;
      const m = { state: '', ids: new Set(vids.map(v => v.id)), node: cam, videos: vids };
      m.marker = L.marker([vids[0].pos.lat, vids[0].pos.lon], { icon: iconFor('video', label, count), title: label, keyboard: false, riseOnHover: true }).addTo(V.map);
      m.marker.on('click', () => RP.bus.emit('item:click', pickVideo(vids).id));
      m.marker.on('dragend', () => {
        const p = m.marker.getLatLng();
        dragCameraGroup(cam, vids, { lat: +p.lat.toFixed(7), lon: +p.lng.toFixed(7) });
      });
      marks.set(key, m);
    });
  }

  /** Séquence pertinente d'un groupe : active, sinon la prochaine, sinon la première. */
  function pickVideo(vids) {
    const t = RP.player.t;
    return vids.find(v => RP.player.activeIds.has(v.id)) ||
      vids.filter(v => v.timed && v.tStart >= t).sort((a, b) => a.tStart - b.tStart)[0] || vids[0];
  }

  /** Déplacement d'un repère de caméra : position de la caméra (imposée ou héritée) et/ou positions propres. */
  function dragCameraGroup(cam, vids, pos) {
    const usesCamera = cam.applyPosition || vids.some(v => v.posFrom === 'camera');
    if (usesCamera) M.update(cam.id, { position: pos }, { silent: true });
    if (!cam.applyPosition) vids.filter(v => v.posFrom === 'video').forEach(v => M.update(v.id, { position: pos }, { silent: true }));
    RP.bus.emit('model:changed', { id: cam.id, item: cam });
  }

  function removeMark(key) {
    const m = marks.get(key);
    if (!m) return;
    m.marker.remove(); m.full && m.full.remove(); m.done && m.done.remove();
    marks.delete(key);
  }

  /** Rafraîchit les repères d'un média ou de la caméra qui le contient. */
  V.refreshItem = function (id) {
    const cam = M.cameraOf(id);
    if (cam) {
      Array.from(marks.keys()).forEach(k => { if (marks.get(k).node === cam) removeMark(k); });
      if (M.get(cam.id)) addCamera(cam);
    } else {
      removeMark(id);
      const it = M.get(id);
      if (it) addNode(it);
    }
    if (RP.player) V.update(RP.player.t, RP.player.activeIds, true);
    V.select(selectedId);
  };

  function isSelected(m) {
    return selectedId != null && (m.ids.has(selectedId) || m.node.id === selectedId);
  }

  /** Appelé à chaque frame par le player. */
  V.update = function (t, activeIds, force) {
    marks.forEach((m) => {
      const it = m.node;
      let active = false;
      if (activeIds) m.ids.forEach(id => { if (activeIds.has(id)) active = true; });
      const sel = isSelected(m);
      const state = (active ? 'active' : 'inactive') + (sel ? ' selected' : '');
      if (state !== m.state || force) {
        m.state = state;
        const el = m.marker.getElement();
        if (el) {
          el.classList.toggle('active', active);
          el.classList.toggle('inactive', !active);
          el.classList.toggle('selected', sel);
        }
        m.marker.setZIndexOffset(active ? 1000 : sel ? 500 : 0);
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
    marks.forEach(m => {
      for (const id of m.ids) if (activeIds.has(id)) { pts.push(m.marker.getLatLng()); break; }
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
    let first = null;
    marks.forEach((m) => {
      const sel = isSelected(m);
      if (sel && !first) first = m;
      const drag = sel && m.node.type !== 'moving-object';
      if (m.marker.dragging) drag ? m.marker.dragging.enable() : m.marker.dragging.disable();
      const el = m.marker.getElement();
      if (el) el.classList.toggle('selected', sel);
    });
    if (pan && first) {
      const ll = first.marker.getLatLng();
      if (!V.map.getBounds().pad(-0.2).contains(ll)) V.map.panTo(ll);
    }
  };

  V.focus = function (id) {
    let target = null;
    marks.forEach(m => { if (!target && (m.ids.has(id) || m.node.id === id)) target = m; });
    if (target) V.map.panTo(target.marker.getLatLng(), { animate: true });
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
