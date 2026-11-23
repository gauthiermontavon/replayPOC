/* Fenêtres médias : ouverture automatique au start, fermeture automatique au end, synchronisation vidéo */
(function () {
  'use strict';
  const RP = window.RP, U = RP.util, M = RP.model;

  const PN = (RP.panels = {});
  const wins = new Map();      // clé de fenêtre (id de caméra pour une vidéo, id du média sinon) -> win
  const dismissed = new Set(); // ids de médias/séquences fermés à la main pendant leur intervalle actif
  let dock, floating, zTop = 10;

  /** Une caméra n'a qu'une fenêtre vidéo, qui enchaîne ses séquences ; chaque capture (image) a sa propre fenêtre. */
  const keyOf = it => (it.camera && it.type === 'video' ? it.camera.id : it.id);
  /** Autre séquence de la même caméra encore active (hors `except`). */
  function otherActive(it, except) {
    if (!it.camera) return null;
    return it.camera.videos.find(v => v !== except && RP.player.activeIds.has(v.id) && !dismissed.has(v.id)) || null;
  }

  PN.init = function () {
    dock = U.$('#dock'); floating = U.$('#floating');
    RP.bus.on('media:enter', it => { if ((it.type === 'video' || it.type === 'image') && !dismissed.has(it.id)) PN.open(it); });
    RP.bus.on('media:exit', it => {
      dismissed.delete(it.id);
      const w = wins.get(keyOf(it));
      if (!w || w.item.id !== it.id) return; // la fenêtre montre déjà une autre séquence
      const next = it.type === 'video' ? otherActive(it, it) : null;
      if (next) { setContent(w, next); return; }
      if (w.pinned) { w.el.classList.add('pinned-out'); if (w.video) w.video.pause(); }
      else PN.close(keyOf(it));
    });
    RP.bus.on('tick', onTick);
    RP.bus.on('mute', m => wins.forEach(w => { if (w.video) w.video.muted = m; }));
    const lb = U.$('#lightbox');
    lb.addEventListener('click', () => { lb.hidden = true; lb.querySelector('img').removeAttribute('src'); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !lb.hidden) lb.click(); });
  };

  PN.isOpen = id => wins.has(id);

  const titleOf = it => (it.camera ? it.camera.name : it.name);

  PN.open = function (it) {
    const key = keyOf(it);
    if (wins.has(key)) {
      const w = wins.get(key);
      w.el.classList.remove('pinned-out');
      if (w.item !== it) setContent(w, it); // nouvelle séquence de la même caméra
      return w;
    }
    const w = { key, item: null, pinned: false, url: null, video: null, img: null };
    const pinBtn = U.el('button', { class: 'icon-btn sm', title: 'Épingler (rester ouvert après la fin)', text: '📌' });
    const closeBtn = U.el('button', { class: 'icon-btn sm', title: 'Fermer', text: '✕' });
    w.when = U.el('span', { class: 'when' });
    w.seq = U.el('span', { class: 'seq' });
    w.title = U.el('span', { class: 'name', text: titleOf(it) });
    const head = U.el('div', { class: 'mwin-head' }, [
      U.el('span', { class: 'ic', html: U.icons[it.type] }), w.title, w.seq, w.when, pinBtn, closeBtn
    ]);
    w.body = U.el('div', { class: 'mwin-body' });
    w.prog = U.el('i');
    w.el = U.el('div', { class: 'mwin ' + it.type, 'data-id': key }, [head, w.body, U.el('div', { class: 'mwin-prog' }, [w.prog])]);
    setContent(w, it);

    pinBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      w.pinned = !w.pinned; pinBtn.classList.toggle('on', w.pinned);
      if (!w.pinned && !RP.player.activeIds.has(w.item.id)) PN.close(key);
    });
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (RP.player.activeIds.has(w.item.id)) dismissed.add(w.item.id);
      PN.close(key);
    });
    w.el.addEventListener('pointerdown', () => { if (w.el.classList.contains('floating')) w.el.style.zIndex = ++zTop; });
    head.addEventListener('dblclick', () => toggleDock(w));
    head.addEventListener('pointerdown', (e) => startDrag(e, w));
    w.el.addEventListener('click', () => RP.bus.emit('item:focus', w.item.id));

    // Les fenêtres sont rangées par ordre chronologique dans le dock
    dock.insertBefore(w.el, dockAfter(it.tStart));
    wins.set(key, w);
    layout();
    return w;
  };

  function dockAfter(t) {
    return Array.from(dock.children).find(c => { const o = wins.get(c.dataset.id); return o && o.item && o.item.tStart > t; }) || null;
  }

  /** Affiche un média (ou une séquence) dans la fenêtre ; réutilise l'élément <video> d'une caméra. */
  function setContent(w, it) {
    const prevUrl = w.url;
    w.item = it;
    w.url = it.file ? URL.createObjectURL(it.file) : null;
    w.forceSync = true;
    w.title.textContent = titleOf(it);
    w.title.title = it.raw.file || it.name;
    const n = it.camera ? it.camera.medias.length : 0;
    w.seq.textContent = n > 1 ? 'Séq. ' + it.seq + '/' + n : '';
    w.seq.hidden = n <= 1;

    if (it.type === 'video' && w.url) {
      if (!w.video || !w.body.contains(w.video)) {
        w.body.innerHTML = '';
        const v = (w.video = U.el('video', { playsinline: true, preload: 'auto' }));
        v.muted = RP.player.muted;
        v.addEventListener('loadedmetadata', () => { w.forceSync = true; RP.player.refresh(); });
        v.addEventListener('error', () => {
          if (!v.getAttribute('src')) return;
          w.body.innerHTML = '<div class="missing">Format vidéo non lisible par ce navigateur<br><small>' + U.esc(w.item.raw.file || '') + '</small></div>';
          w.video = null;
        });
        w.body.append(v);
      }
      w.video.src = w.url;
    } else if (it.type === 'image' && w.url) {
      w.body.innerHTML = '';
      const img = (w.img = U.el('img', { alt: it.name, src: w.url }));
      img.addEventListener('click', () => { const lb = U.$('#lightbox'); lb.querySelector('img').src = w.url; lb.hidden = false; });
      img.addEventListener('error', () => { w.body.innerHTML = '<div class="missing">Image non affichable par ce navigateur (HEIC ?)</div>'; });
      w.body.append(img);
    } else {
      if (w.video) { w.video.removeAttribute('src'); w.video.load(); w.video = null; }
      w.body.innerHTML = '';
      w.body.append(U.el('div', { class: 'missing', html: 'Fichier introuvable dans le dossier<br><small>' + U.esc(it.raw.file || '(aucun fichier associé)') + '</small>' }));
    }
    if (prevUrl) setTimeout(() => URL.revokeObjectURL(prevUrl), 1000);
  }

  PN.close = function (key) {
    const w = wins.get(key);
    if (!w) return;
    wins.delete(key);
    if (w.video) { w.video.pause(); }
    w.el.classList.add('closing');
    setTimeout(() => {
      if (w.video) { w.video.removeAttribute('src'); w.video.load(); }
      if (w.url) URL.revokeObjectURL(w.url);
      w.el.remove();
      layout();
    }, 180);
  };

  PN.closeAll = function () { Array.from(wins.keys()).forEach(k => PN.close(k)); dismissed.clear(); };

  /** Rouvre une fenêtre manuellement (clic sur un repère / l'éditeur) si le média est actif. */
  PN.reveal = function (id) {
    dismissed.delete(id);
    const it = M.get(id);
    if (it && RP.player.activeIds.has(id) && (it.type === 'video' || it.type === 'image')) {
      const w = PN.open(it);
      w.el.classList.add('focus'); setTimeout(() => w.el.classList.remove('focus'), 900);
      w.el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  };

  /** Un média (ou une caméra) a été modifié dans l'éditeur. */
  PN.refreshItem = function (id) {
    const node = M.get(id);
    wins.forEach(w => {
      const it = M.get(w.item.id);
      if (!it) return;
      if (node && node.type === 'camera' ? it.camera === node : it.id === id || keyOf(it) === w.key) {
        w.item = it; w.forceSync = true;
        w.title.textContent = titleOf(it);
        const n = it.camera ? it.camera.medias.length : 0;
        w.seq.textContent = n > 1 ? 'Séq. ' + it.seq + '/' + n : ''; w.seq.hidden = n <= 1;
      }
    });
  };

  /** Après restructuration du modèle (vidéo déplacée de caméra) : on repart des médias actifs. */
  PN.rebuild = function () {
    PN.closeAll();
    M.activeAt(RP.player.t).forEach(it => { if (it.type === 'video' || it.type === 'image') PN.open(it); });
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
      dock.insertBefore(w.el, dockAfter(w.item.tStart));
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
