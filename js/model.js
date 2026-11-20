/* Modèle de données : caméras (conteneurs de 1..n vidéos), photos, objets mobiles + champs calculés
 *
 *  M.roots : nœuds de premier niveau, dans l'ordre du JSON (caméras, images, objets mobiles) → serialize()
 *  M.items : liste PLATE des éléments jouables (vidéos, images, objets mobiles) → player, timeline, panels
 *  Une vidéo pointe vers son conteneur via item.camera ; item.seq = rang chronologique (1..n) dans la caméra.
 */
(function () {
  'use strict';
  const RP = window.RP, U = RP.util;

  const DEFAULT_IMAGE_DISPLAY = 10;    // s d'affichage d'une photo
  const UNKNOWN_VIDEO_DURATION = 30;   // s, placeholder si la durée est inconnue

  const M = (RP.model = {
    roots: [],
    items: [],
    byId: new Map(),
    DEFAULT_IMAGE_DISPLAY
  });

  /* ------------------------------------------------------------ Calculs */

  /** Champs dérivés d'un élément jouable (vidéo, image, objet mobile). */
  function compute(it) {
    const r = it.raw;
    it.id = r.id;
    it.type = r.type;
    it.name = r.name || U.basename(r.file).replace(/\.[^.]+$/, '') || r.id;
    const off = U.isNum(+r.offset) ? +r.offset * 1000 : 0;
    it.missing = [];
    const own = U.validLatLon(r.position) ? { lat: +r.position.lat, lon: +r.position.lon } : null;
    it.ownPos = own;
    it.pos = own;
    it.track = null;
    it.tStart = it.tEnd = null;

    if (r.type === 'video') {
      const cam = it.camera;
      // Position effective : imposée par la caméra, sinon propre, sinon héritée de la caméra
      it.pos = cam && cam.applyPosition && cam.pos ? cam.pos : (own || (cam && cam.pos) || null);
      it.posFrom = it.pos === own && own ? 'video' : it.pos ? 'camera' : null;
      const s = U.parseTime(r.start);
      if (s == null) it.missing.push('start');
      if (!it.pos) it.missing.push('position');
      const dur = U.isNum(+r.duration) && +r.duration > 0 ? +r.duration : null;
      if (dur == null) it.missing.push('duration');
      if (s != null) { it.tStart = s + off; it.tEnd = it.tStart + (dur || UNKNOWN_VIDEO_DURATION) * 1000; }
    } else if (r.type === 'image') {
      const s = U.parseTime(r.time);
      if (s == null) it.missing.push('time');
      if (!it.pos) it.missing.push('position');
      const disp = U.isNum(+r.display) && +r.display > 0 ? +r.display : DEFAULT_IMAGE_DISPLAY;
      if (s != null) { it.tStart = s + off; it.tEnd = it.tStart + disp * 1000; }
    } else if (r.type === 'moving-object') {
      const pts = (Array.isArray(r.track) ? r.track : [])
        .map(p => ({ t: U.parseTime(p.time), lat: +p.lat, lon: +p.lon }))
        .filter(p => p.t != null && U.validLatLon(p))
        .map(p => ({ t: p.t + off, lat: p.lat, lon: p.lon }))
        .sort((a, b) => a.t - b.t);
      if (!pts.length) it.missing.push('track');
      it.track = pts;
      if (pts.length) { it.tStart = pts[0].t; it.tEnd = pts[pts.length - 1].t; it.pos = pts[0]; }
    } else {
      const s = U.parseTime(r.start || r.time);
      if (s != null) { it.tStart = s + off; it.tEnd = it.tStart + (U.isNum(+r.duration) ? +r.duration * 1000 : 10000); }
    }
    it.timed = it.tStart != null;
    return it;
  }

  /** Recalcule une caméra puis toutes ses vidéos (position effective, ordre des séquences, manques agrégés). */
  function computeCamera(cam) {
    const r = cam.raw;
    cam.id = r.id;
    cam.type = 'camera';
    cam.name = r.name || r.id;
    cam.pos = U.validLatLon(r.position) ? { lat: +r.position.lat, lon: +r.position.lon } : null;
    cam.applyPosition = r.applyPosition !== false;
    cam.videos.forEach(compute);
    cam.videos.sort((a, b) => (a.tStart == null) - (b.tStart == null) || (a.tStart || 0) - (b.tStart || 0));
    cam.videos.forEach((v, i) => { v.seq = i + 1; });
    const miss = new Set();
    cam.videos.forEach(v => v.missing.forEach(k => miss.add(k)));
    if (!cam.videos.length) miss.add('videos');
    cam.missing = Array.from(miss);
    const timed = cam.videos.filter(v => v.timed);
    cam.timed = timed.length > 0;
    cam.tStart = cam.timed ? Math.min(...timed.map(v => v.tStart)) : null;
    cam.tEnd = cam.timed ? Math.max(...timed.map(v => v.tEnd)) : null;
    return cam;
  }

  function recompute(node) {
    if (!node) return;
    if (node.type === 'camera') computeCamera(node);
    else if (node.camera) computeCamera(node.camera);
    else compute(node);
  }

  function uniqueId(base) {
    let id = U.slug(base), i = 2;
    while (M.byId.has(id)) id = U.slug(base) + '-' + i++;
    return id;
  }

  /* ------------------------------------------------------------ Construction */

  M.reset = function () { M.roots = []; M.items = []; M.byId.clear(); };

  /**
   * Ajoute une entrée brute de premier niveau.
   * @param {object} raw entrée JSON (camera, image, moving-object ; « video » historique migrée)
   * @param {function} [resolveFile] (raw) => File|null
   * @returns le nœud runtime créé
   */
  M.add = function (raw, resolveFile) {
    const resolve = typeof resolveFile === 'function' ? resolveFile : () => null;
    raw = Object.assign({}, raw);
    if (!raw.type) raw.type = 'video';

    if (raw.type === 'video') {
      // Migration de l'ancien format : une vidéo seule devient une caméra à 1 séquence
      const v = Object.assign({}, raw);
      const camRaw = { id: raw.id, type: 'camera', name: raw.name, position: raw.position, applyPosition: true };
      if (!camRaw.name) delete camRaw.name;
      if (!camRaw.position) delete camRaw.position;
      delete v.name; delete v.position;
      v.id = (raw.id || 'video') + '-1';
      camRaw.videos = [v];
      raw = camRaw;
    }

    if (raw.type === 'camera') {
      const videos = Array.isArray(raw.videos) ? raw.videos : [];
      const camRaw = Object.assign({}, raw);
      delete camRaw.videos;
      if (!camRaw.id || M.byId.has(camRaw.id)) camRaw.id = uniqueId(camRaw.id || camRaw.name || 'camera');
      const cam = { raw: camRaw, videos: [] };
      M.byId.set(camRaw.id, cam);
      M.roots.push(cam);
      videos.forEach(v => { if (v && typeof v === 'object') attachVideo(cam, v, resolve(v)); });
      computeCamera(cam);
      return cam;
    }

    if (!raw.id || M.byId.has(raw.id)) raw.id = uniqueId(raw.id || raw.name || U.basename(raw.file) || raw.type || 'media');
    const it = compute({ raw, file: resolve(raw) });
    M.items.push(it);
    M.byId.set(it.id, it);
    M.roots.push(it);
    return it;
  };

  function attachVideo(cam, vraw, file) {
    vraw = Object.assign({}, vraw, { type: 'video' });
    if (!vraw.id || M.byId.has(vraw.id)) vraw.id = uniqueId(vraw.id || (cam.raw.id + '-' + (cam.videos.length + 1)));
    const it = { raw: vraw, file: file || null, camera: cam };
    cam.videos.push(it);
    M.items.push(it);
    M.byId.set(vraw.id, it);
    return it;
  }

  /** Ajoute une vidéo brute à une caméra existante. */
  M.addVideoToCamera = function (cam, vraw, file) {
    const it = attachVideo(cam, vraw, file);
    computeCamera(cam);
    return it;
  };

  /** Crée une caméra vide (sans l'ajouter à l'affichage tant qu'elle n'a pas de vidéo). */
  M.createCamera = function (props) {
    const raw = Object.assign({ type: 'camera' }, props);
    raw.id = uniqueId(raw.id || raw.name || 'camera');
    raw.type = 'camera';
    const cam = { raw, videos: [] };
    M.byId.set(raw.id, cam);
    M.roots.push(cam);
    computeCamera(cam);
    return cam;
  };

  function removeRoot(node) {
    M.roots = M.roots.filter(n => n !== node);
    M.byId.delete(node.id);
  }

  /* ------------------------------------------------------------ Accès et mutations */

  M.get = id => M.byId.get(id);
  M.cameras = () => M.roots.filter(n => n.type === 'camera');
  M.cameraOf = function (id) {
    const n = M.byId.get(id);
    return !n ? null : n.type === 'camera' ? n : n.camera || null;
  };

  /** Applique un patch sur l'entrée brute d'un nœud (valeur null/undefined/'' = suppression du champ). */
  M.update = function (id, patch, opts) {
    const node = M.byId.get(id);
    if (!node) return;
    for (const k in patch) {
      if (patch[k] === null || patch[k] === undefined || patch[k] === '') delete node.raw[k];
      else node.raw[k] = patch[k];
    }
    recompute(node);
    if (!(opts && opts.silent)) RP.bus.emit('model:changed', { id, item: node });
    return node;
  };

  /**
   * Déplace une vidéo vers une autre caméra (cameraId = null → nouvelle caméra).
   * Une caméra devenue vide est supprimée (une caméra contient toujours 1..n vidéos).
   */
  M.moveVideo = function (videoId, cameraId) {
    const v = M.byId.get(videoId);
    if (!v || !v.camera) return null;
    const from = v.camera;
    let to;
    if (cameraId) {
      to = M.byId.get(cameraId);
      if (!to || to.type !== 'camera' || to === from) return from;
    } else {
      to = M.createCamera({ name: v.name, position: v.pos ? { lat: v.pos.lat, lon: v.pos.lon } : undefined, applyPosition: true });
      if (!to.raw.position) delete to.raw.position;
      // place la nouvelle caméra juste après l'ancienne
      M.roots = M.roots.filter(n => n !== to);
      M.roots.splice(M.roots.indexOf(from) + 1, 0, to);
    }
    from.videos = from.videos.filter(x => x !== v);
    v.camera = to;
    to.videos.push(v);
    computeCamera(to);
    if (!from.videos.length) removeRoot(from); else computeCamera(from);
    RP.bus.emit('model:rebuilt');
    return to;
  };

  M.recomputeAll = function () { M.roots.forEach(recompute); };

  M.timed = () => M.items.filter(i => i.timed);

  M.range = function () {
    let a = Infinity, b = -Infinity;
    M.items.forEach(i => { if (i.timed) { a = Math.min(a, i.tStart); b = Math.max(b, i.tEnd); } });
    if (!isFinite(a)) return null;
    if (b - a < 10000) { b = a + 10000; }
    return { start: a, end: b };
  };

  /** Instants des évènements (débuts de médias / séquences), triés et dédoublonnés. */
  M.events = function () {
    const s = new Set();
    M.items.forEach(i => { if (i.timed) s.add(i.tStart); });
    return Array.from(s).sort((a, b) => a - b);
  };

  /** Éléments actifs à l'instant t : tStart ≤ t < tEnd (les objets mobiles restent visibles jusqu'à leur fin incluse). */
  M.activeAt = function (t) {
    return M.items.filter(i => i.timed && t >= i.tStart && (t < i.tEnd || (i.type === 'moving-object' && t <= i.tEnd)));
  };

  /** Position interpolée d'un objet mobile à l'instant t. */
  M.positionAt = function (it, t) {
    const tr = it.track;
    if (!tr || !tr.length) return null;
    if (t <= tr[0].t) return { lat: tr[0].lat, lon: tr[0].lon, heading: tr.length > 1 ? U.bearing(tr[0], tr[1]) : 0, idx: 0 };
    const last = tr[tr.length - 1];
    if (t >= last.t) return { lat: last.lat, lon: last.lon, heading: tr.length > 1 ? U.bearing(tr[tr.length - 2], last) : 0, idx: tr.length - 1 };
    let lo = 0, hi = tr.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (tr[m].t <= t) lo = m; else hi = m; }
    const a = tr[lo], b = tr[hi], k = (t - a.t) / Math.max(1, b.t - a.t);
    return { lat: U.lerp(a.lat, b.lat, k), lon: U.lerp(a.lon, b.lon, k), heading: U.bearing(a, b), idx: lo, k };
  };

  /** Nombre de nœuds de premier niveau incomplets (une caméra compte pour une). */
  M.missingCount = () => M.roots.filter(n => n.missing.length).length;

  /** Sérialisation au format JSON du projet (les caméras embarquent leurs vidéos). */
  M.serialize = function () {
    const clean = raw => { const o = Object.assign({}, raw); return o; };
    return M.roots.map(n => {
      if (n.type !== 'camera') return clean(n.raw);
      const o = clean(n.raw);
      o.videos = n.videos.map(v => { const x = clean(v.raw); delete x.type; return x; });
      return o;
    });
  };

  /** Recherche d'un fichier correspondant à une entrée (chemin relatif ou nom). */
  M.matchFile = function (raw, files) {
    if (!raw.file) return null;
    const want = String(raw.file).replace(/\\/g, '/').toLowerCase();
    const base = U.basename(want);
    return files.find(f => f.path.toLowerCase() === want) || files.find(f => f.name.toLowerCase() === base) || null;
  };

  M.missingLabels = { start: 'date de début', time: 'date', position: 'position', duration: 'durée', track: 'trajectoire', videos: 'vidéos' };
})();
