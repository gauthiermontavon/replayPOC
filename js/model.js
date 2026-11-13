/* Modèle de données : liste de médias (format JSON du projet) + champs calculés */
(function () {
  'use strict';
  const RP = window.RP, U = RP.util;

  const DEFAULT_IMAGE_DISPLAY = 10;    // s d'affichage d'une photo
  const UNKNOWN_VIDEO_DURATION = 30;   // s, placeholder si la durée est inconnue
  const RUNTIME_KEYS = ['_file'];

  const M = (RP.model = {
    items: [],
    byId: new Map(),
    DEFAULT_IMAGE_DISPLAY
  });

  /** Calcule les champs dérivés d'une entrée (tStart, tEnd, pos, track, missing). */
  function compute(it) {
    const r = it.raw;
    it.id = r.id;
    it.type = r.type;
    it.name = r.name || U.basename(r.file) || r.id;
    const off = U.isNum(+r.offset) ? +r.offset * 1000 : 0;
    it.missing = [];
    it.pos = U.validLatLon(r.position) ? { lat: +r.position.lat, lon: +r.position.lon } : null;
    it.track = null;
    it.tStart = it.tEnd = null;

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
      // Type inconnu : on tente au mieux
      const s = U.parseTime(r.start || r.time);
      if (s != null) { it.tStart = s + off; it.tEnd = it.tStart + (U.isNum(+r.duration) ? +r.duration * 1000 : 10000); }
    }
    it.timed = it.tStart != null;
    return it;
  }

  function uniqueId(base) {
    let id = U.slug(base), i = 2;
    while (M.byId.has(id)) id = U.slug(base) + '-' + i++;
    return id;
  }

  M.reset = function () { M.items = []; M.byId.clear(); };

  /** Ajoute une entrée brute (objet du JSON). Retourne l'item runtime. */
  M.add = function (raw, file) {
    raw = Object.assign({}, raw);
    if (!raw.id || M.byId.has(raw.id)) raw.id = uniqueId(raw.id || raw.name || U.basename(raw.file) || raw.type || 'media');
    if (!raw.type) raw.type = 'video';
    const it = compute({ raw, file: file || null });
    M.items.push(it);
    M.byId.set(it.id, it);
    return it;
  };

  M.get = id => M.byId.get(id);

  /** Applique un patch sur l'entrée brute (valeur null/undefined = suppression du champ). */
  M.update = function (id, patch, opts) {
    const it = M.byId.get(id);
    if (!it) return;
    for (const k in patch) {
      if (patch[k] === null || patch[k] === undefined || patch[k] === '') delete it.raw[k];
      else it.raw[k] = patch[k];
    }
    compute(it);
    if (!(opts && opts.silent)) RP.bus.emit('model:changed', { id, item: it });
    return it;
  };

  M.recomputeAll = function () { M.items.forEach(compute); };

  M.timed = () => M.items.filter(i => i.timed);

  M.range = function () {
    let a = Infinity, b = -Infinity;
    M.items.forEach(i => { if (i.timed) { a = Math.min(a, i.tStart); b = Math.max(b, i.tEnd); } });
    if (!isFinite(a)) return null;
    if (b - a < 10000) { b = a + 10000; }
    return { start: a, end: b };
  };

  /** Instants des évènements (débuts de médias), triés et dédoublonnés. */
  M.events = function () {
    const s = new Set();
    M.items.forEach(i => { if (i.timed) s.add(i.tStart); });
    return Array.from(s).sort((a, b) => a - b);
  };

  /** Médias actifs à l'instant t : tStart ≤ t < tEnd (les objets mobiles restent visibles jusqu'à leur fin incluse). */
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

  M.missingCount = () => M.items.filter(i => i.missing.length).length;

  /** Sérialisation au format JSON du projet. */
  M.serialize = function () {
    return M.items.map(it => {
      const o = {};
      Object.keys(it.raw).forEach(k => { if (!RUNTIME_KEYS.includes(k)) o[k] = it.raw[k]; });
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

  M.missingLabels = { start: 'date de début', time: 'date', position: 'position', duration: 'durée', track: 'trajectoire' };
})();
