/* Horloge maîtresse de lecture + playbar */
(function () {
  'use strict';
  const RP = window.RP, U = RP.util, M = RP.model;

  const SPEEDS = [0.25, 0.5, 1, 2, 4, 8, 16];
  const P = (RP.player = {
    t: null, playing: false, rate: 1, loop: false, muted: U.store.get('muted', false),
    range: null, activeIds: new Set()
  });
  let last = 0, seeked = true, dirty = true;
  let ui = {};

  P.init = function () {
    ui = {
      bar: U.$('#playbar'), clock: U.$('#pb-clock'), date: U.$('#pb-date'), seek: U.$('#pb-seek'),
      speed: U.$('#pb-speed'), loop: U.$('#pb-loop'), mute: U.$('#pb-mute')
    };
    U.$('#pb-play').onclick = () => P.toggle();
    U.$('#pb-back').onclick = () => P.step(-10);
    U.$('#pb-fwd').onclick = () => P.step(10);
    U.$('#pb-prev').onclick = () => P.prevEvent();
    U.$('#pb-next').onclick = () => P.nextEvent();
    ui.speed.onchange = () => P.setRate(+ui.speed.value);
    ui.loop.onclick = () => { P.loop = !P.loop; ui.loop.classList.toggle('on', P.loop); };
    ui.mute.onclick = () => P.setMuted(!P.muted);
    ui.seek.addEventListener('input', () => {
      if (!P.range) return;
      P.seek(P.range.start + (+ui.seek.value / 1000) * (P.range.end - P.range.start));
    });
    document.body.classList.toggle('muted-all', P.muted);
    RP.bus.on('seek', t => P.seek(t));

    document.addEventListener('keydown', (e) => {
      if (e.target.closest('input, textarea, select, [contenteditable]')) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      switch (e.key) {
        case ' ': e.preventDefault(); P.toggle(); break;
        case 'ArrowLeft': e.preventDefault(); e.shiftKey ? P.prevEvent() : P.step(-10); break;
        case 'ArrowRight': e.preventDefault(); e.shiftKey ? P.nextEvent() : P.step(10); break;
        case '+': case '=': RP.timeline.zoom(0.6); break;
        case '-': case '_': RP.timeline.zoom(1 / 0.6); break;
        case 'Home': P.seek(P.range && P.range.start); break;
        case 'End': P.seek(P.range && P.range.end); break;
        case 'm': case 'M': P.setMuted(!P.muted); break;
        case ',': P.setRate(SPEEDS[Math.max(0, SPEEDS.indexOf(P.rate) - 1)]); break;
        case '.': P.setRate(SPEEDS[Math.min(SPEEDS.length - 1, SPEEDS.indexOf(P.rate) + 1)]); break;
      }
    });
    requestAnimationFrame(frame);
  };

  P.setRange = function (r) {
    P.range = r;
    if (!r) { P.pause(); P.t = null; }
    else if (P.t == null || P.t < r.start || P.t > r.end) P.t = r.start;
    seeked = dirty = true;
  };

  P.seek = function (t) {
    if (!P.range || t == null || isNaN(t)) return;
    P.t = U.clamp(t, P.range.start, P.range.end);
    seeked = dirty = true;
    process(); // immédiat : ne dépend pas de requestAnimationFrame
  };
  P.step = s => P.seek(P.t + s * 1000);

  P.play = function () {
    if (!P.range) return;
    if (P.t >= P.range.end) P.t = P.range.start;
    P.playing = true; last = performance.now(); seeked = dirty = true;
    ui.bar.classList.add('playing');
  };
  P.pause = function () {
    P.playing = false; dirty = true;
    if (ui.bar) ui.bar.classList.remove('playing');
  };
  P.toggle = () => (P.playing ? P.pause() : P.play());

  P.setRate = function (r) {
    if (!SPEEDS.includes(r)) return;
    P.rate = r; ui.speed.value = String(r); seeked = dirty = true;
  };
  P.setMuted = function (m) {
    P.muted = m; U.store.set('muted', m);
    document.body.classList.toggle('muted-all', m);
    RP.bus.emit('mute', m);
  };

  P.nextEvent = function () {
    const ev = M.events().find(e => e > P.t + 500);
    if (ev != null) P.seek(ev); else if (P.range) P.seek(P.range.end);
  };
  P.prevEvent = function () {
    const evs = M.events().filter(e => e < P.t - 1500);
    if (evs.length) P.seek(evs[evs.length - 1]); else if (P.range) P.seek(P.range.start);
  };

  /** Force le recalcul des médias actifs (après édition du modèle). */
  P.refresh = function () { seeked = dirty = true; process(); };

  function frame(now) {
    requestAnimationFrame(frame);
    if (!P.range || P.t == null) { last = now; return; }
    if (P.playing) {
      const dt = Math.min(1000, now - last); // évite les sauts après mise en veille de l'onglet
      P.t += dt * P.rate;
      if (P.t >= P.range.end) {
        if (P.loop) { P.t = P.range.start; seeked = true; }
        else { P.t = P.range.end; P.pause(); }
      }
      dirty = true;
    }
    last = now;
    if (dirty) process();
  }

  /** Recalcule l'état à l'instant P.t (médias actifs, fenêtres, carte, timeline, UI). */
  function process() {
    if (!P.range || P.t == null) return;
    dirty = false;

    // Entrées / sorties de médias : ouverture et fermeture automatiques des fenêtres
    const act = M.activeAt(P.t);
    const ids = new Set(act.map(i => i.id));
    P.activeIds.forEach(id => { if (!ids.has(id)) RP.bus.emit('media:exit', M.get(id) || { id }); });
    act.forEach(it => { if (!P.activeIds.has(it.id)) RP.bus.emit('media:enter', it); });
    P.activeIds = ids;

    const ev = { t: P.t, playing: P.playing, rate: P.rate, seeked };
    seeked = false;
    RP.bus.emit('tick', ev);

    if (P.playing) RP.timeline.ensureVisible(P.t);
    RP.timeline.setTime(P.t);
    RP.mapview.update(P.t, ids);
    ui.clock.textContent = U.fmtTime(P.t);
    ui.date.textContent = U.fmtDayShort(P.t) + ' ' + new Date(P.t).getFullYear();
    if (document.activeElement !== ui.seek) ui.seek.value = String(Math.round((P.t - P.range.start) / (P.range.end - P.range.start) * 1000));
  }
})();
