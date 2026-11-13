/* Extraction des métadonnées : EXIF (photos), atomes MP4/MOV (vidéos), nom de fichier, GPX */
(function () {
  'use strict';
  const RP = window.RP, U = RP.util;

  const VIDEO_EXT = ['mp4', 'm4v', 'mov', 'webm', 'ogv', 'mkv'];
  const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic', 'heif', 'avif'];
  const MP4_EPOCH = 2082844800; // secondes entre 1904-01-01 et 1970-01-01

  const MD = (RP.metadata = { VIDEO_EXT, IMAGE_EXT });

  MD.kindOf = function (name) {
    const e = U.ext(name);
    if (VIDEO_EXT.includes(e)) return 'video';
    if (IMAGE_EXT.includes(e)) return 'image';
    if (e === 'gpx') return 'gpx';
    if (e === 'json') return 'json';
    return null;
  };

  /* ------------------------------------------------------------ Nom de fichier */
  /** VID_20260824_143000, IMG-20260824-WA0001 (date seule ignorée), 2026-08-24 14.30.00, PXL_20260824_143000123 */
  MD.dateFromName = function (name) {
    const m = String(name).match(/(20\d{2}|19\d{2})[-_.]?(\d{2})[-_.]?(\d{2})[ _T-]?(\d{2})[-_.:h]?(\d{2})[-_.:m]?(\d{2})/);
    if (!m) return null;
    const d = new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
    if (isNaN(d) || +m[2] > 12 || +m[3] > 31 || +m[4] > 23 || +m[5] > 59) return null;
    return d.getTime();
  };

  /* ------------------------------------------------------------ ISO 6709 */
  function parseIso6709(s) {
    const m = String(s).match(/([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)/);
    if (!m) return null;
    const p = { lat: parseFloat(m[1]), lon: parseFloat(m[2]) };
    return U.validLatLon(p) && !(p.lat === 0 && p.lon === 0) ? p : null;
  }

  function parseAppleDate(s) {
    if (!s) return null;
    const v = String(s).trim().replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
    const t = Date.parse(v);
    return isNaN(t) ? null : t;
  }

  /* ------------------------------------------------------------ MP4 / MOV */
  async function bytes(file, start, len) {
    const buf = await file.slice(start, Math.min(file.size, start + len)).arrayBuffer();
    return new DataView(buf);
  }
  const fourcc = (dv, o) => String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));
  const u64 = (dv, o) => dv.getUint32(o) * 4294967296 + dv.getUint32(o + 4);

  /** Itère les boîtes enfants de [start, end) dans un DataView. */
  function eachBox(dv, start, end, cb) {
    let p = start, guard = 0;
    while (p + 8 <= end && guard++ < 10000) {
      let size = dv.getUint32(p);
      const type = fourcc(dv, p + 4);
      let hdr = 8;
      if (size === 1) { size = u64(dv, p + 8); hdr = 16; }
      else if (size === 0) size = end - p;
      if (size < hdr || p + size > end) break;
      if (cb(type, p + hdr, p + size) === false) break;
      p += size;
    }
  }

  /** Lit la boîte moov (où qu'elle soit dans le fichier) et en extrait date, durée, GPS. */
  MD.parseMp4 = async function (file) {
    const res = {};
    let pos = 0, guard = 0, moov = null;
    while (pos + 8 <= file.size && guard++ < 2000) {
      const h = await bytes(file, pos, 16);
      if (h.byteLength < 8) break;
      let size = h.getUint32(0), hdr = 8;
      const type = fourcc(h, 4);
      if (size === 1) { size = u64(h, 8); hdr = 16; } else if (size === 0) size = file.size - pos;
      if (size < 8) break;
      if (type === 'moov') {
        if (size > 64 * 1024 * 1024) break;
        moov = { dv: await bytes(file, pos + hdr, size - hdr) };
        break;
      }
      pos += size;
    }
    if (!moov) return res;
    const dv = moov.dv;
    const keys = [];

    function walk(start, end, parent) {
      eachBox(dv, start, end, (type, c, e) => {
        if (type === 'mvhd') {
          const v = dv.getUint8(c);
          let ct, ts, du;
          if (v === 1) { ct = u64(dv, c + 4); ts = dv.getUint32(c + 20); du = u64(dv, c + 24); }
          else { ct = dv.getUint32(c + 4); ts = dv.getUint32(c + 12); du = dv.getUint32(c + 16); }
          if (ct > MP4_EPOCH) res.creation = (ct - MP4_EPOCH) * 1000;
          if (ts) res.duration = du / ts;
        } else if (type === 'udta') {
          walk(c, e, type);
        } else if (type === '©xyz') {
          // [u16 longueur][u16 langue][chaîne] — certaines caméras omettent l'en-tête
          let s = '';
          const len = dv.getUint16(c);
          const from = len > 0 && len <= e - c - 4 ? c + 4 : c;
          for (let i = from; i < e; i++) { const ch = dv.getUint8(i); if (ch) s += String.fromCharCode(ch); }
          const p = parseIso6709(s);
          if (p) res.position = p;
        } else if (type === 'meta') {
          // QuickTime : pas de version/flags ; ISO BMFF : 4 octets de version/flags
          const isFull = e - c >= 8 && fourcc(dv, c + 4) !== 'hdlr';
          walk(isFull ? c + 4 : c, e, 'meta');
        } else if (type === 'keys') {
          const n = dv.getUint32(c + 4);
          let p = c + 8;
          for (let i = 0; i < n && p + 8 <= e; i++) {
            const sz = dv.getUint32(p);
            let name = '';
            for (let j = p + 8; j < p + sz; j++) name += String.fromCharCode(dv.getUint8(j));
            keys.push(name);
            p += sz;
          }
        } else if (type === 'ilst') {
          eachBox(dv, c, e, (t2, c2, e2) => {
            const idx = dv.getUint32(c2 - 4) - 1; // le "type" est l'index 1-based dans keys
            const key = keys[idx] || t2;
            eachBox(dv, c2, e2, (t3, c3, e3) => {
              if (t3 !== 'data') return;
              let s = '';
              try { s = new TextDecoder('utf-8').decode(new Uint8Array(dv.buffer, dv.byteOffset + c3 + 8, e3 - c3 - 8)); } catch (er) { /* ignore */ }
              if (/location\.ISO6709/i.test(key) || t2 === '©xyz') { const p = parseIso6709(s); if (p) res.position = p; }
              if (/creationdate/i.test(key)) { const d = parseAppleDate(s); if (d) res.appleDate = d; }
            });
          });
        }
      });
    }
    walk(0, dv.byteLength, 'moov');
    return res;
  };

  /** Durée via l'élément <video> (fiable pour webm/mkv, et pour vérifier). */
  MD.probeVideo = function (file) {
    return new Promise((resolve) => {
      const v = document.createElement('video');
      const url = URL.createObjectURL(file);
      let done = false;
      const end = (r) => { if (done) return; done = true; URL.revokeObjectURL(url); v.removeAttribute('src'); v.load(); resolve(r); };
      v.preload = 'metadata'; v.muted = true;
      v.onloadedmetadata = () => end({ duration: isFinite(v.duration) ? v.duration : null, width: v.videoWidth, height: v.videoHeight, playable: true });
      v.onerror = () => end({ playable: false });
      setTimeout(() => end({}), 8000);
      v.src = url;
    });
  };

  /* ------------------------------------------------------------ Photos (EXIF) */
  function exifDate(str, offset) {
    // "2026:08:24 14:32:14" (+ "+02:00" éventuel)
    const m = String(str || '').match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
    if (!m) return null;
    if (offset && /^[+-]\d{2}:\d{2}$/.test(offset)) {
      const t = Date.parse(m[1] + '-' + m[2] + '-' + m[3] + 'T' + m[4] + ':' + m[5] + ':' + m[6] + offset);
      if (!isNaN(t)) return t;
    }
    return new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
  }

  MD.parseImage = async function (file) {
    const res = {};
    if (!window.exifr) return res;
    try {
      const ex = await window.exifr.parse(file, { tiff: true, exif: true, gps: true, reviveValues: false, translateValues: false });
      if (ex) {
        const d = exifDate(ex.DateTimeOriginal || ex.CreateDate || ex.DateTime, ex.OffsetTimeOriginal || ex.OffsetTime);
        if (d) res.time = d;
      }
    } catch (e) { /* pas d'EXIF */ }
    try {
      const g = await window.exifr.gps(file);
      if (g && U.validLatLon({ lat: g.latitude, lon: g.longitude })) res.position = { lat: g.latitude, lon: g.longitude };
    } catch (e) { /* pas de GPS */ }
    return res;
  };

  /* ------------------------------------------------------------ GPX */
  MD.parseGpx = async function (file) {
    const xml = new DOMParser().parseFromString(await file.text(), 'application/xml');
    const name = (xml.querySelector('trk > name, metadata > name, name') || {}).textContent;
    const pts = Array.from(xml.querySelectorAll('trkpt, rtept')).map(n => ({
      time: (n.querySelector('time') || {}).textContent,
      lat: +n.getAttribute('lat'), lon: +n.getAttribute('lon')
    })).filter(p => p.time && U.validLatLon(p)).map(p => ({ time: U.iso(Date.parse(p.time)), lat: +p.lat.toFixed(7), lon: +p.lon.toFixed(7) }));
    return { type: 'moving-object', name: (name || U.basename(file.name).replace(/\.gpx$/i, '')).trim(), track: pts, file: file.name };
  };

  /* ------------------------------------------------------------ Point d'entrée */
  /**
   * Construit une entrée brute à partir d'un fichier.
   * @param {{name, path, file}} f
   * @returns {Promise<object|null>} entrée au format du modèle, avec meta.source
   */
  MD.extract = async function (f) {
    const kind = MD.kindOf(f.name);
    const src = {};
    if (kind === 'gpx') {
      const r = await MD.parseGpx(f.file);
      r.file = f.path; r.id = U.slug(r.name);
      r.meta = { source: { track: 'gpx' } };
      return r;
    }
    if (kind === 'video') {
      const raw = { id: U.slug(f.name.replace(/\.[^.]+$/, '')), type: 'video', name: f.name.replace(/\.[^.]+$/, ''), file: f.path };
      let mp4 = {};
      try { mp4 = await MD.parseMp4(f.file); } catch (e) { console.warn('MP4', f.name, e); }
      const probe = await MD.probeVideo(f.file);
      const dur = probe.duration || mp4.duration;
      if (dur) { raw.duration = +dur.toFixed(3); src.duration = probe.duration ? 'video' : 'mp4'; }
      const t = mp4.appleDate || mp4.creation || MD.dateFromName(f.name);
      if (t) { raw.start = U.iso(t); src.start = mp4.appleDate ? 'quicktime' : mp4.creation ? 'mp4' : 'nom de fichier'; }
      if (mp4.position) { raw.position = mp4.position; src.position = 'mp4'; }
      if (probe.playable === false) raw.meta = { unplayable: true };
      raw.meta = Object.assign(raw.meta || {}, { source: src });
      return raw;
    }
    if (kind === 'image') {
      const raw = { id: U.slug(f.name.replace(/\.[^.]+$/, '')), type: 'image', name: f.name.replace(/\.[^.]+$/, ''), file: f.path };
      const ex = await MD.parseImage(f.file);
      const t = ex.time || MD.dateFromName(f.name);
      if (t) { raw.time = U.iso(t); src.time = ex.time ? 'exif' : 'nom de fichier'; }
      if (ex.position) { raw.position = { lat: +ex.position.lat.toFixed(7), lon: +ex.position.lon.toFixed(7) }; src.position = 'exif'; }
      raw.meta = { source: src };
      return raw;
    }
    return null;
  };
})();
