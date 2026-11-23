/* Utilitaires communs — namespace global RP (pas de modules ES : compatibilité file://) */
(function () {
  'use strict';
  const RP = (window.RP = window.RP || {});

  /* ---------- Bus d'évènements ---------- */
  const listeners = {};
  RP.bus = {
    on(evt, fn) { (listeners[evt] = listeners[evt] || []).push(fn); },
    off(evt, fn) { listeners[evt] = (listeners[evt] || []).filter(f => f !== fn); },
    emit(evt, data) { (listeners[evt] || []).slice().forEach(fn => { try { fn(data); } catch (e) { console.error(evt, e); } }); }
  };

  const U = (RP.util = {});

  U.$ = (sel, root) => (root || document).querySelector(sel);
  U.$$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  U.el = function (tag, attrs, children) {
    const n = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k === 'html') n.innerHTML = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    }
    (children || []).forEach(c => c != null && n.append(c));
    return n;
  };
  U.esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  U.clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  U.lerp = (a, b, k) => a + (b - a) * k;
  U.debounce = function (fn, ms) {
    let t; return function () { clearTimeout(t); const a = arguments; t = setTimeout(() => fn.apply(null, a), ms); };
  };
  U.throttle = function (fn, ms) {
    let last = 0, t; return function () {
      const now = Date.now(), a = arguments;
      if (now - last >= ms) { last = now; fn.apply(null, a); }
      else { clearTimeout(t); t = setTimeout(() => { last = Date.now(); fn.apply(null, a); }, ms - (now - last)); }
    };
  };
  U.slug = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'media';
  U.basename = p => String(p || '').split(/[\\/]/).pop();
  U.ext = p => (U.basename(p).match(/\.([^.]+)$/) || [, ''])[1].toLowerCase();
  U.isNum = v => typeof v === 'number' && isFinite(v);

  /* ---------- Dates (affichage fr-FR, fuseau du navigateur) ---------- */
  const fmt = (o) => new Intl.DateTimeFormat('fr-FR', o);
  const fTime = fmt({ hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const fHM = fmt({ hour: '2-digit', minute: '2-digit' });
  const fDayLong = fmt({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const fDayShort = fmt({ weekday: 'short', day: 'numeric', month: 'short' });
  const fDayNum = fmt({ day: '2-digit', month: '2-digit', year: 'numeric' });

  U.fmtTime = t => fTime.format(t);
  U.fmtHM = t => fHM.format(t);
  /** 8h00, 11h30, 14h05 */
  U.fmtH = t => { const d = new Date(t); return d.getHours() + 'h' + String(d.getMinutes()).padStart(2, '0'); };
  U.fmtDayLong = t => fDayLong.format(t);
  U.fmtDayShort = t => fDayShort.format(t);
  U.fmtDayNum = t => fDayNum.format(t);
  U.fmtDateTime = t => fDayNum.format(t) + ' ' + fTime.format(t);
  U.sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();

  /** « mercredi 11 novembre 2026, de 8h00 à 11h30 » */
  U.fmtPeriod = function (a, b) {
    if (!U.isNum(a) || !U.isNum(b)) return 'Aucun média daté';
    if (U.sameDay(a, b)) return U.fmtDayLong(a) + ', de ' + U.fmtH(a) + ' à ' + U.fmtH(b);
    return 'Du ' + U.fmtDayShort(a) + ' ' + U.fmtH(a) + ' au ' + U.fmtDayShort(b) + ' ' + U.fmtH(b) + ' ' + new Date(b).getFullYear();
  };

  U.fmtDuration = function (sec) {
    if (!U.isNum(sec)) return '—';
    sec = Math.max(0, Math.round(sec));
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0');
  };

  /** ms epoch -> valeur pour <input type="datetime-local" step="1"> (heure locale) */
  U.toLocalInput = function (t) {
    if (!U.isNum(t)) return '';
    const d = new Date(t), p = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  };
  U.fromLocalInput = function (v) {
    if (!v) return null;
    const m = v.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
    if (!m) return null;
    return new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)).getTime();
  };
  U.iso = t => new Date(t).toISOString().replace('.000Z', 'Z');
  U.parseTime = function (v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return v;
    const t = Date.parse(v);
    return isNaN(t) ? null : t;
  };
  U.tzLabel = function () {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) { return 'heure locale'; }
  };

  /* ---------- Géo ---------- */
  U.bearing = function (a, b) {
    const r = Math.PI / 180, y = Math.sin((b.lon - a.lon) * r) * Math.cos(b.lat * r);
    const x = Math.cos(a.lat * r) * Math.sin(b.lat * r) - Math.sin(a.lat * r) * Math.cos(b.lat * r) * Math.cos((b.lon - a.lon) * r);
    return (Math.atan2(y, x) / r + 360) % 360;
  };
  U.validLatLon = p => p && U.isNum(+p.lat) && U.isNum(+p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180;

  /* ---------- Icônes SVG ---------- */
  U.icons = {
    video: '<svg viewBox="0 0 24 24"><rect x="2.5" y="6" width="13" height="12" rx="2"/><path d="M15.5 10.5l6-3.5v10l-6-3.5z"/></svg>',
    image: '<svg viewBox="0 0 24 24"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
    'moving-object': '<svg viewBox="0 0 24 24"><path d="M5 16V11l2-5h10l2 5v5"/><path d="M3 16h18v2H3z"/><circle cx="7.5" cy="18.5" r="1.5"/><circle cx="16.5" cy="18.5" r="1.5"/><path d="M5 11h14"/></svg>',
    event: '<svg viewBox="0 0 24 24"><path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/></svg>',
    pin: '<svg viewBox="0 0 24 24"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>'
  };
  U.typeLabel = { video: 'Vidéo', image: 'Photo', 'moving-object': 'Objet mobile', event: 'Évènement' };

  /* ---------- Toast ---------- */
  let toastT;
  U.toast = function (msg, ms) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), ms || 2800);
  };

  /* ---------- Téléchargement ---------- */
  U.download = function (name, text, mime) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: mime || 'application/json' }));
    a.download = name; document.body.append(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  };

  U.store = {
    get(k, d) { try { const v = localStorage.getItem('rp.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('rp.' + k, JSON.stringify(v)); } catch (e) { /* ignore */ } }
  };
})();
