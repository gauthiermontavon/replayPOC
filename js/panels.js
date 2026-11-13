/* Fenêtres médias : ouverture automatique au start, fermeture automatique au end, synchronisation vidéo */
(function () {
  'use strict';
  const RP = window.RP, U = RP.util, M = RP.model;

  const PN = (RP.panels = {});
  const wins = new Map();      // id -> win
  const dismissed = new Set(); // fermées à la main pendant leur intervalle actif
  let dock, floating, zTop = 10;

  PN.init = function () {
    dock = U.$('#dock'); floating = U.$('#floating');
    RP.bus.on('media:enter', it => { if ((it.type === 'video' || it.type === 'image') && !dismissed.has(it.id)) PN.open(it); });
    RP.bus.on('media:exit', it => {
      dismissed.delete(it.id);
      const w = wins.get(it.id);
      if (!w) return;
      if (w.pinned) { w.el.classList.add('pinned-out'); if (w.video) w.video.pause(); }
      else PN.close(it.id);
    });
    RP.bus.on('tick', onTick);
    RP.bus.on('mute', m => wins.forEach(w => { if (w.video) w.video.muted = m; }));
    const lb = U.$('#lightbox');
    lb.addEventListener('click', () => { lb.hidden = true; lb.querySelector('img').removeAttribute('src'); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !lb.hidden) lb.click(); });
  };

  PN.isOpen = id => wins.has(id);

  PN.open = function (it) {
    if (wins.has(it.id)) { const w = wins.get(it.id); w.el.classList.remove('pinned-out'); return w; }
    const w = { id: it.id, item: it, pinned: false, url: null, video: null, img: null };
    const pinBtn = U.el('button', { class: 'icon-btn sm', title: 'Épingler (rester ouvert après la fin)', text: '📌' });
    const closeBtn = U.el('button', { class: 'icon-btn sm', title: 'Fermer', text: '✕' });
    w.when = U.el('span', { class: 'when' });
    const head = U.el('div', { class: 'mwin-head' }, [
      U.el('span', { class: 'ic', html: U.icons[it.type] }),
      U.el('span', { class: 'name', text: it.name, title: it.raw.file || it.name }),
      w.when, pinBtn, closeBtn
    ]);
    const body = U.el('div', { class: 'mwin-body' });
    w.prog = U.el('i');
    w.el = U.el('div', { class: 'mwin ' + it.type, 'data-id': it.id }, [head, body, U.el('div', { class: 'mwin-prog' }, [w.prog])]);

    if (it.file) {
      w.url = URL.createObjectURL(it.file);
      if (it.type === 'video') {
        const v = (w.video = U.el('video', { playsinline: true, preload: 'auto' }));
        v.muted = RP.player.muted;
        v.src = w.url;
        v.addEventListener('loadedmetadata', () => { w.ready = true; w.forceSync = true; RP.player.refresh(); });
        v.addEventListener('error', () => { body.innerHTML = '<div class="missing">Format vidéo non lisible par ce navigateur<br><small>' + U.esc(it.raw.file || '') + '</small></div>'; w.video = null; });
        body.append(v);
      } else {
        const img = (w.img = U.el('img', { alt: it.name, src: w.url }));
        img.addEventListener('click', () => { const lb = U.$('#lightbox'); lb.querySelector('img').src = w.url; lb.hidden = false; });
        img.addEventListener('error', () => { body.innerHTML = '<div class="missing">Image non affichable par ce navigateur (HEIC ?)</div>'; });
        body.append(img);
      }
    } else {
      body.append(U.el('div', { class: 'missing', html: 'Fichier introuvable dans le dossier<br><small>' + U.esc(it.raw.file || '(aucun fichier associé)') + '</small>' }));
    }

    pinBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      w.pinned = !w.pinned; pinBtn.classList.toggle('on', w.pinned);
      if (!w.pinned && !RP.player.activeIds.has(it.id)) PN.close(it.id);
    });
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (RP.player.activeIds.has(it.id)) dismissed.add(it.id);
      PN.close(it.id);
    });
    w.el.addEventListener('pointerdown', () => { if (w.el.classList.contains('floating')) w.el.style.zIndex = ++zTop; });
    head.addEventListener('dblclick', () => toggleDock(w));
    head.addEventListener('pointerdown', (e) => startDrag(e, w));
    w.el.addEventListener('click', () => RP.bus.emit('item:focus', it.id));

    // Les fenêtres sont rangées par ordre chronologique dans le dock
    const after = Array.from(dock.children).find(c => { const o = M.get(c.dataset.id); return o && o.tStart > it.tStart; });
    dock.insertBefore(w.el, after || null);
    wins.set(it.id, w);
    w.forceSync = true;
    layout();
    return w;
  };

  PN.close = function (id) {
    const w = wins.get(id);
    if (!w) return;
    wins.delete(id);
    if (w.video) { w.video.pause(); }
    w.el.classList.add('closing');
    setTimeout(() => {
      if (w.video) { w.video.removeAttribute('src'); w.video.load(); }
      if (w.url) URL.revokeObjectURL(w.url);
      w.el.remove();
      layout();
    }, 180);
  };

  PN.closeAll = function () { Array.from(wins.keys()).forEach(id => PN.close(id)); dismissed.clear(); };

  /** Rouvre une fenêtre manuellement (clic sur un repère) si le média est actif. */
  PN.reveal = function (id) {
    dismissed.delete(id);
    const it = M.get(id);
    if (it && RP.player.activeIds.has(id) && (it.type === 'video' || it.type === 'image')) {
      const w = PN.open(it);
      w.el.classList.add('focus'); setTimeout(() => w.el.classList.remove('focus'), 900);
      w.el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  };

  /** Le média a été modifié dans l'éditeur. */
  PN.refreshItem = function (id) {
    const w = wins.get(id);
    if (!w) return;
    const it = M.get(id);
    w.item = it; w.forceSync = true;
    const n = w.el.querySelector('.mwin-head .name'); if (n) n.textContent = it.name;
  };

  function layout() {
    const docked = dock.querySelectorAll('.mwin:not(.closing)').length;
    dock.classList.toggle('many', docked > 3);
  }

  /* ---------------------------------------------------------- Synchronisation */
  function onTick(ev) {
    wins.forEach(w => {
      const it = w.item;
      const active = ev.t >= it.tStart && ev.t < it.tEnd;
      const elapsed = (ev.t - it.tStart) / 1000;
      const total = (it.tEnd - it.tStart) / 1000;
      w.prog.style.width = U.clamp(elapsed / total * 100, 0, 100) + '%';
      w.when.textContent = it.type === 'video' ? U.fmtDuration(U.clamp(elapsed, 0, total)) + ' / ' + U.fmtDuration(total) : U.fmtTime(it.tStart);
      w.el.classList.toggle('pinned-out', !active);
      const v = w.video;
      if (!v) return;
      if (!active) { if (!v.paused) v.pause(); return; }
      if (v.readyState < 1) return; // métadonnées pas encore chargées
      const target = elapsed;
      if (isFinite(v.duration) && target >= v.duration - 0.05) { if (!v.paused) v.pause(); return; }
      const drift = v.currentTime - target;
      const force = ev.seeked || w.forceSync;
      w.forceSync = false;
      if (ev.playing) {
        const r = U.clamp(ev.rate, 0.0625, 16);
        if (v.playbackRate !== r) v.playbackRate = r;
        if ((force || Math.abs(drift) > Math.max(0.35, 0.12 * ev.rate)) && !v.seeking) v.currentTime = target;
        if (v.paused) {
          const p = v.play();
          if (p && p.catch) p.catch(err => {
            if (err && err.name === 'NotAllowedError' && !v.muted) { v.muted = true; v.play().catch(() => {}); U.toast('Son coupé par le navigateur — cliquez sur 🔊 pour l\'activer'); }
          });
        }
      } else {
        if (!v.paused) v.pause();
        if ((force || Math.abs(drift) > 0.04) && !v.seeking) v.currentTime = target;
      }
    });
  }

  /* ---------------------------------------------------------- Déplacement */
  function toFloating(w) {
    const r = w.el.getBoundingClientRect();
    w.el.classList.add('floating');
    w.el.style.left = r.left + 'px'; w.el.style.top = r.top + 'px'; w.el.style.width = r.width + 'px';
    w.el.style.zIndex = ++zTop;
    floating.append(w.el);
    layout();
  }
  function toggleDock(w) {
    if (w.el.classList.contains('floating')) {
      w.el.classList.remove('floating');
      ['left', 'top', 'width', 'height', 'zIndex'].forEach(k => w.el.style[k] = '');
      const after = Array.from(dock.children).find(c => { const o = M.get(c.dataset.id); return o && o.tStart > w.item.tStart; });
      dock.insertBefore(w.el, after || null);
      layout();
    } else toFloating(w);
  }
  function startDrag(e, w) {
    if (e.button !== 0 || e.target.closest('button')) return;
    const sx = e.clientX, sy = e.clientY;
    let started = false, ox = 0, oy = 0;
    const move = (ev) => {
      if (!started) {
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 5) return;
        started = true;
        if (!w.el.classList.contains('floating')) toFloating(w);
        ox = sx - w.el.offsetLeft; oy = sy - w.el.offsetTop;
      }
      w.el.style.left = U.clamp(ev.clientX - ox, -w.el.offsetWidth + 60, innerWidth - 60) + 'px';
      w.el.style.top = U.clamp(ev.clientY - oy, 0, innerHeight - 40) + 'px';
    };
    const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
  }
})();
