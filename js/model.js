/* Modèle de données : caméras (conteneurs de 1..n médias : vidéos et captures), photos, objets mobiles
 *
 *  M.roots : nœuds de premier niveau, dans l'ordre du JSON (caméras, images indépendantes, objets mobiles) → serialize()
 *  M.items : liste PLATE des éléments jouables (vidéos, images, objets mobiles) → player, timeline, panels
 *  Un média de caméra pointe vers son conteneur via item.camera ; item.seq = rang chronologique (1..n) parmi
 *  tous les médias de la caméra (vidéos et captures numérotées ensemble).
 */
(function () {
  'use strict';
  const RP = window.RP, U = RP.util;

  const DEFAULT_IMAGE_DISPLAY = 10;    // s d'affichage d'une photo
  const UNKNOWN_VIDEO_DURATION = 30;   // s, placeholder si la durée est inconnue
  const DEFAULT_EVENT_DURATION = 15;   // s d'affichage d'un évènement

  const M = (RP.model = {
    roots: [],
    items: [],
    byId: new Map(),
    DEFAULT_IMAGE_DISPLAY,
    DEFAULT_EVENT_DURATION
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
    const cam = it.camera;
    if (cam) {
      // Média de caméra — position effective : imposée par la caméra, sinon propre, sinon héritée de la caméra
      it.pos = cam.applyPosition && cam.pos ? cam.pos : (own || cam.pos || null);
    }
    it.posFrom = !it.pos ? null : it.pos === own ? 'own' : 'camera';

    if (r.type === 'video') {
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
    } else if (r.type === 'event') {
      // Évènement : description de scène affichée pendant `duration` secondes ; position facultative
      it.name = r.title || r.id;
      const s = U.parseTime(r.time);
      if (s == null) it.missing.push('time');
      if (!String(r.description || '').trim()) it.missing.push('description');
      const dur = U.isNum(+r.duration) && +r.duration > 0 ? +r.duration : DEFAULT_EVENT_DURATION;
      if (s != null) { it.tStart = s + off; it.tEnd = it.tStart + dur * 1000; }
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

  /** Recalcule une caméra puis tous ses médias (position effective, ordre des séquences, manques agrégés). */
  function computeCamera(cam) {
    const r = cam.raw;
    cam.id = r.id;
    cam.type = 'camera';
    cam.name = r.name || r.id;
    cam.pos = U.validLatLon(r.position) ? { lat: +r.position.lat, lon: +r.position.lon } : null;
    cam.applyPosition = r.applyPosition !== false;
    cam.medias.forEach(compute);
    cam.medias.sort((a, b) => (a.tStart == null) - (b.tStart == null) || (a.tStart || 0) - (b.tStart || 0));
    cam.medias.forEach((v, i) => { v.seq = i + 1; });
    cam.videos = cam.medias.filter(m => m.type === 'video');
    cam.images = cam.medias.filter(m => m.type === 'image');
    const miss = new Set();
    cam.medias.forEach(v => v.missing.forEach(k => miss.add(k)));
    if (!cam.medias.length) miss.add('medias');
    cam.missing = Array.from(miss);
    const timed = cam.medias.filter(v => v.timed);
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
      camRaw.medias = [v];
      raw = camRaw;
    }

    if (raw.type === 'camera') {
      // Format courant : "medias" (vidéos + images) ; ancien format v1 : "videos" (vidéos seules)
      const medias = (Array.isArray(raw.medias) ? raw.medias : [])
        .concat((Array.isArray(raw.videos) ? raw.videos : []).map(v => Object.assign({}, v, { type: 'video' })));
      const camRaw = Object.assign({}, raw);
      delete camRaw.videos; delete camRaw.medias;
      if (!camRaw.id || M.byId.has(camRaw.id)) camRaw.id = uniqueId(camRaw.id || camRaw.name || 'camera');
      const cam = { raw: camRaw, medias: [], videos: [], images: [] };
      M.byId.set(camRaw.id, cam);
      M.roots.push(cam);
      medias.forEach(m => { if (m && typeof m === 'object') attachMedia(cam, m, resolve(m)); });
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

  /** Type d'un média de caméra : explicite, sinon déduit de l'extension, sinon vidéo. */
  function mediaType(m) {
    if (m.type === 'video' || m.type === 'image') return m.type;
    return RP.metadata && RP.metadata.kindOf(m.file || '') === 'image' ? 'image' : 'video';
  }

  function attachMedia(cam, mraw, file) {
    mraw = Object.assign({}, mraw, { type: mediaType(mraw) });
    if (!mraw.id || M.byId.has(mraw.id)) mraw.id = uniqueId(mraw.id || (cam.raw.id + '-' + (cam.medias.length + 1)));
    const it = { raw: mraw, file: file || null, camera: cam };
    cam.medias.push(it);
    M.items.push(it);
    M.byId.set(mraw.id, it);
    return it;
  }

  /** Ajoute un média brut (vidéo ou image) à une caméra existante. */
  M.addMediaToCamera = function (cam, mraw, file) {
    const it = attachMedia(cam, mraw, file);
    computeCamera(cam);
    return it;
  };
  M.addVideoToCamera = M.addMediaToCamera; // compatibilité

  /** Crée une caméra vide (sans l'ajouter à l'affichage tant qu'elle n'a pas de média). */
  M.createCamera = function (props) {
    const raw = Object.assign({ type: 'camera' }, props);
    raw.id = uniqueId(raw.id || raw.name || 'camera');
    raw.type = 'camera';
    const cam = { raw, medias: [], videos: [], images: [] };
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

  /** Cible « aucune caméra » pour moveMedia (détacher une image en photo indépendante). */
  M.NONE = '__none__';

  /**
   * Rattache un média à une caméra.
   *  cameraId = id d'une caméra existante | null (nouvelle caméra) | M.NONE (image seulement : photo indépendante).
   * Une caméra devenue vide est supprimée (une caméra contient toujours 1..n médias). Émet model:rebuilt.
   * @returns la caméra de destination, ou le média détaché
   */
  M.moveMedia = function (id, cameraId) {
    const it = M.byId.get(id);
    if (!it || (it.type !== 'video' && it.type !== 'image')) return null;
    const from = it.camera || null;
    const anchor = from || it; // position dans M.roots pour insérer une nouvelle entrée

    if (cameraId === M.NONE) {
      if (it.type !== 'image' || !from) return from; // une vidéo appartient toujours à une caméra
      detach(it, from);
      M.roots.splice(M.roots.indexOf(from) + 1, 0, it);
      compute(it);
      if (!from.medias.length) removeRoot(from); else computeCamera(from);
      RP.bus.emit('model:rebuilt');
      return it;
    }

    let to;
    if (cameraId) {
      to = M.byId.get(cameraId);
      if (!to || to.type !== 'camera' || to === from) return from;
    } else {
      to = M.createCamera({ name: it.name, position: it.pos ? { lat: it.pos.lat, lon: it.pos.lon } : undefined, applyPosition: true });
      if (!to.raw.position) delete to.raw.position;
      M.roots = M.roots.filter(n => n !== to);
      M.roots.splice(M.roots.indexOf(anchor) + 1, 0, to); // juste après l'ancienne entrée
    }
    if (from) detach(it, from);
    else M.roots = M.roots.filter(n => n !== it); // une photo indépendante quitte le premier niveau
    it.camera = to;
    to.medias.push(it);
    computeCamera(to);
    if (from) { if (!from.medias.length) removeRoot(from); else computeCamera(from); }
    RP.bus.emit('model:rebuilt');
    return to;
  };
  M.moveVideo = M.moveMedia; // compatibilité

  function detach(it, cam) {
    cam.medias = cam.medias.filter(x => x !== it);
    it.camera = null;
  }

  /** Crée un évènement (description de scène) à l'instant `t` (ms). Émet model:rebuilt. */
  M.createEvent = function (t, props) {
    const raw = Object.assign({ type: 'event', title: 'Nouvel évènement', description: '', time: U.iso(Math.floor(t / 1000) * 1000), duration: DEFAULT_EVENT_DURATION }, props);
    raw.id = uniqueId(raw.id || 'evt');
    const it = compute({ raw, file: null });
    M.items.push(it);
    M.byId.set(it.id, it);
    M.roots.push(it);
    RP.bus.emit('model:rebuilt');
    return it;
  };

  /** Supprime un élément de premier niveau sans fichier (évènement). Émet model:rebuilt. */
  M.remove = function (id) {
    const it = M.byId.get(id);
    if (!it || it.type !== 'event') return false;
    M.items = M.items.filter(x => x !== it);
    removeRoot(it);
    RP.bus.emit('model:rebuilt');
    return true;
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

  /** Sérialisation au format JSON du projet (les caméras embarquent leurs médias, typés). */
  M.serialize = function () {
    const clean = raw => Object.assign({}, raw);
    return M.roots.map(n => {
      if (n.type !== 'camera') return clean(n.raw);
      const o = clean(n.raw);
      o.medias = n.medias.map(m => {
        const x = clean(m.raw);
        return Object.assign({ type: m.type }, x); // "type" en tête pour la lisibilité
      });
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

  M.missingLabels = { start: 'date de début', time: 'date', position: 'position', duration: 'durée', track: 'trajectoire', medias: 'médias', description: 'description' };
})();
