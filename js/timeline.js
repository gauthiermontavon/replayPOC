/* Timeline canvas : zoom (molette), déplacement (glisser), seek (clic), lanes par type, vue d'ensemble */
(function () {
  'use strict';
  const RP = window.RP, U = RP.util, M = RP.model;

  const SEC = 1000, MIN = 60 * SEC, HOUR = 60 * MIN, DAY = 24 * HOUR;
  const STEPS = [1, 2, 5, 10, 15, 30].map(s => s * SEC)
    .concat([1, 2, 5, 10, 15, 30].map(m => m * MIN))
    .concat([1, 2, 3, 6, 12].map(h => h * HOUR)).concat([DAY, 2 * DAY, 7 * DAY]);
  const LANES = [
    { type: 'moving-object', label: 'Objets', color: '--moving' },
    { type: 'video', label: 'Vidéos', color: '--video' },
    { type: 'image', label: 'Photos', color: '--image' }
  ];
  const AXIS_H = 22, LANE_GAP = 4, LABEL_W = 0;

  const T = (RP.timeline = { view: null, range: null });
  let cv, ctx, ov, octx, tip, W = 0, H = 0, OW = 0, OH = 0, dpr = 1;
  let rows = {}; // type -> [[items...], ...] (empilement des chevauchements)
  let drag = null, hover = null, colors = {};
  let tNow = null;

  /* ---------------------------------------------------------------- Init */
  T.init = function () {
    cv = U.$('#tl-canvas'); ctx = cv.getContext('2d');
    ov = U.$('#tl-overview'); octx = ov.getContext('2d');
    tip = U.$('#tl-tip');
    new ResizeObserver(resize).observe(cv);
    resize();
    readColors();
    if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { readColors(); T.draw(); });

    cv.addEventListener('wheel', onWheel, { passive: false });
    cv.addEventListener('pointerdown', onDown);
    cv.addEventListener('pointermove', onMove);
    cv.addEventListener('pointerup', onUp);
    cv.addEventListener('pointercancel', () => { drag = null; cv.classList.remove('dragging'); });
    cv.addEventListener('pointerleave', () => { hover = null; tip.hidden = true; });
    cv.addEventListener('dblclick', () => T.fit());

    ov.addEventListener('pointerdown', onOverview);
    ov.addEventListener('pointermove', (e) => { if (e.buttons === 1) onOverview(e); });

    U.$('#tl-zoom-in').onclick = () => T.zoom(0.5);
    U.$('#tl-zoom-out').onclick = () => T.zoom(2);
    U.$('#tl-fit').onclick = () => T.fit();
  };

  function readColors() {
    const s = getComputedStyle(document.documentElement);
    ['--moving', '--video', '--image', '--text', '--muted', '--border', '--accent', '--warn', '--surface-2', '--accent-soft'].forEach(k => colors[k] = s.getPropertyValue(k).trim());
  }

  function resize() {
    dpr = window.devicePixelRatio || 1;
    const r = cv.getBoundingClientRect(), r2 = ov.getBoundingClientRect();
    W = r.width; H = r.height; OW = r2.width; OH = r2.height;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    ov.width = Math.round(OW * dpr); ov.height = Math.round(OH * dpr);
    const tl = U.$('#timeline');
    if (tl) document.documentElement.style.setProperty('--tl-height', tl.getBoundingClientRect().height + 'px');
    T.draw();
  }

  /* ---------------------------------------------------------------- Données */
  T.setData = function (keepView) {
    const r = M.range();
    T.range = r;
    rows = {};
    LANES.forEach(l => {
      const items = M.timed().filter(i => i.type === l.type).sort((a, b) => a.tStart - b.tStart);
      const rr = [];
      items.forEach(it => {
        let row = rr.find(r => r[r.length - 1].tEnd <= it.tStart);
        if (!row) { row = []; rr.push(row); }
        row.push(it);
      });
      rows[l.type] = rr;
    });
    U.$('#tl-title').textContent = r ? U.fmtPeriod(r.start, r.end) : 'Aucun média daté';
    if (!keepView || !T.view) T.fit(); else T.draw();
  };

  T.fit = function () {
    if (!T.range) { T.view = null; T.draw(); return; }
    const pad = (T.range.end - T.range.start) * 0.03;
    T.view = { start: T.range.start - pad, end: T.range.end + pad };
    T.draw();
  };

  function limits() {
    const span = T.range ? (T.range.end - T.range.start) : HOUR;
    return { min: 5 * SEC, max: Math.max(span * 1.6, 2 * MIN) };
  }

  T.zoom = function (factor, centerT) {
    if (!T.view) return;
    const c = centerT != null ? centerT : (tNow != null && tNow >= T.view.start && tNow <= T.view.end ? tNow : (T.view.start + T.view.end) / 2);
    const lim = limits();
    const span = U.clamp((T.view.end - T.view.start) * factor, lim.min, lim.max);
    const k = (c - T.view.start) / (T.view.end - T.view.start);
    T.view = { start: c - span * k, end: c + span * (1 - k) };
    T.draw();
  };

  /** Fait défiler la vue pour garder la tête de lecture visible pendant la lecture. */
  T.ensureVisible = function (t) {
    if (!T.view || drag) return;
    const span = T.view.end - T.view.start;
    if (t > T.view.end - span * 0.02 || t < T.view.start) {
      T.view = { start: t - span * 0.1, end: t + span * 0.9 };
    }
  };

  T.setTime = function (t) { tNow = t; T.draw(); };

  /* ---------------------------------------------------------------- Rendu */
  const x = t => (t - T.view.start) / (T.view.end - T.view.start) * W;
  const tAt = px => T.view.start + px / W * (T.view.end - T.view.start);

  function laneLayout() {
    const n = LANES.length, avail = H - AXIS_H - 4;
    const lh = (avail - LANE_GAP * (n - 1)) / n;
    return LANES.map((l, i) => ({ ...l, y: AXIS_H + 2 + i * (lh + LANE_GAP), h: lh }));
  }

  T.draw = function () {
    if (!ctx || !W) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    drawOverview();
    if (!T.view) {
      ctx.fillStyle = colors['--muted']; ctx.font = '13px system-ui, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('Ouvrez un dossier de médias pour afficher la timeline', W / 2, H / 2 + 4);
      return;
    }
    const lanes = laneLayout();

    // Fonds des lanes
    lanes.forEach(l => {
      ctx.fillStyle = colors['--surface-2'];
      roundRect(ctx, 0, l.y, W, l.h, 5); ctx.fill();
    });

    // Graduations
    const span = T.view.end - T.view.start;
    const step = STEPS.find(s => s / span * W >= 78) || STEPS[STEPS.length - 1];
    const minor = STEPS.slice().reverse().find(s => s < step && step % s === 0 && s / span * W >= 12);
    const tzOff = new Date(T.view.start).getTimezoneOffset() * MIN;
    // Aligne les graduations sur l'heure locale (fuseaux à demi-heure inclus)
    const align = (t, s) => Math.ceil((t - tzOff) / s) * s + tzOff;
    ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (minor) {
      ctx.strokeStyle = colors['--border']; ctx.lineWidth = 1;
      for (let t = align(T.view.start, minor); t <= T.view.end; t += minor) {
        const px = Math.round(x(t)) + 0.5;
        ctx.beginPath(); ctx.moveTo(px, AXIS_H - 5); ctx.lineTo(px, AXIS_H); ctx.stroke();
      }
    }
    let prevDay = null;
    for (let t = align(T.view.start, step); t <= T.view.end; t += step) {
      const px = Math.round(x(t)) + 0.5;
      ctx.strokeStyle = colors['--border']; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(px, AXIS_H - 8); ctx.lineTo(px, H); ctx.stroke();
      const d = new Date(t);
      const newDay = prevDay !== null && d.toDateString() !== prevDay;
      prevDay = d.toDateString();
      let label = step < MIN ? U.fmtTime(t) : step >= DAY ? U.fmtDayShort(t) : U.fmtHM(t);
      if (step < DAY && (newDay || (d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0))) label = U.fmtDayShort(t);
      ctx.fillStyle = newDay ? colors['--text'] : colors['--muted'];
      ctx.fillText(label, px, 9);
    }

    // Médias
    lanes.forEach(l => {
      const rr = rows[l.type] || [];
      const n = Math.max(1, rr.length);
      const rh = Math.min(16, (l.h - 4) / n);
      const c = colors[l.color];
      rr.forEach((row, ri) => {
        const y = l.y + 2 + ri * rh + (l.h - 4 - rh * n) / 2;
        row.forEach(it => {
          const x1 = x(it.tStart), x2 = x(it.tEnd);
          if (x2 < -10 || x1 > W + 10) return;
          const active = tNow != null && it.tStart <= tNow && tNow < it.tEnd;
          const hov = hover && hover.item === it;
          if (it.type === 'image') {
            // Losange au moment de la prise + zone d'affichage discrète
            ctx.fillStyle = c; ctx.globalAlpha = 0.18;
            roundRect(ctx, x1, y + 1, Math.max(2, x2 - x1), rh - 2, 3); ctx.fill();
            ctx.globalAlpha = 1;
            const s = Math.min(rh / 2 - 1, 6) + (hov || active ? 1.5 : 0);
            ctx.beginPath(); ctx.moveTo(x1, y + rh / 2 - s); ctx.lineTo(x1 + s, y + rh / 2); ctx.lineTo(x1, y + rh / 2 + s); ctx.lineTo(x1 - s, y + rh / 2); ctx.closePath();
            ctx.fillStyle = c; ctx.fill();
            if (active) { ctx.strokeStyle = colors['--text']; ctx.lineWidth = 1.2; ctx.stroke(); }
          } else {
            ctx.fillStyle = c;
            ctx.globalAlpha = it.type === 'moving-object' ? (active ? 0.75 : 0.5) : (active ? 1 : 0.72);
            roundRect(ctx, x1, y + 1, Math.max(3, x2 - x1), rh - 2, Math.min(4, (rh - 2) / 2)); ctx.fill();
            ctx.globalAlpha = 1;
            if (hov) { ctx.strokeStyle = colors['--text']; ctx.lineWidth = 1.2; ctx.stroke(); }
            if (it.missing.includes('duration')) { ctx.fillStyle = colors['--warn']; ctx.fillRect(Math.max(x1, x2 - 3), y + 1, 3, rh - 2); }
            // Libellé dans la barre si la place le permet
            const w = x2 - x1;
            if (w > 50 && rh >= 11) {
              ctx.save();
              ctx.beginPath(); ctx.rect(Math.max(0, x1) + 4, y, Math.min(x2, W) - Math.max(0, x1) - 8, rh); ctx.clip();
              ctx.fillStyle = '#fff'; ctx.font = '600 10px system-ui, sans-serif'; ctx.textAlign = 'left';
              ctx.fillText(it.name, Math.max(0, x1) + 5, y + rh / 2 + 0.5);
              ctx.restore();
            }
          }
        });
      });
      // Libellé de lane
      ctx.font = '600 10px system-ui, sans-serif'; ctx.textAlign = 'left';
      ctx.fillStyle = colors['--muted']; ctx.globalAlpha = 0.85;
      if (!rr.length) ctx.fillText(l.label + ' — aucun', 6, l.y + l.h / 2 + 0.5);
      ctx.globalAlpha = 1;
    });

    // Tête de lecture
    if (tNow != null) {
      const px = Math.round(x(tNow)) + 0.5;
      if (px >= 0 && px <= W) {
        ctx.strokeStyle = colors['--accent']; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(px, AXIS_H - 2); ctx.lineTo(px, H); ctx.stroke();
        const label = U.fmtTime(tNow);
        ctx.font = '600 11px system-ui, sans-serif';
        const tw = ctx.measureText(label).width + 12;
        const bx = U.clamp(px - tw / 2, 0, W - tw);
        ctx.fillStyle = colors['--accent'];
        roundRect(ctx, bx, 1, tw, 17, 8); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.textAlign = 'center';
        ctx.fillText(label, bx + tw / 2, 10);
      }
    }
  };

  function drawOverview() {
    octx.setTransform(dpr, 0, 0, dpr, 0, 0);
    octx.clearRect(0, 0, OW, OH);
    octx.fillStyle = colors['--surface-2'];
    roundRect(octx, 0, 0, OW, OH, 5); octx.fill();
    if (!T.range) return;
    const r0 = T.range.start, r1 = T.range.end, ox = t => (t - r0) / (r1 - r0) * OW;
    LANES.forEach((l, i) => {
      octx.fillStyle = colors[l.color]; octx.globalAlpha = 0.7;
      M.timed().filter(it => it.type === l.type).forEach(it => {
        octx.fillRect(ox(it.tStart), 2 + i * (OH - 4) / 3, Math.max(1.5, ox(it.tEnd) - ox(it.tStart)), (OH - 4) / 3 - 1);
      });
    });
    octx.globalAlpha = 1;
    if (T.view) {
      const a = U.clamp(ox(T.view.start), 0, OW), b = U.clamp(ox(T.view.end), 0, OW);
      octx.fillStyle = colors['--accent-soft'];
      octx.strokeStyle = colors['--accent']; octx.lineWidth = 1.5;
      roundRect(octx, a, 0.75, Math.max(4, b - a), OH - 1.5, 4); octx.fill(); octx.stroke();
    }
    if (tNow != null) {
      octx.fillStyle = colors['--accent'];
      octx.fillRect(U.clamp(ox(tNow), 0, OW) - 1, 0, 2, OH);
    }
  }

  function roundRect(c, x0, y0, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    c.beginPath();
    c.moveTo(x0 + r, y0); c.arcTo(x0 + w, y0, x0 + w, y0 + h, r); c.arcTo(x0 + w, y0 + h, x0, y0 + h, r);
    c.arcTo(x0, y0 + h, x0, y0, r); c.arcTo(x0, y0, x0 + w, y0, r); c.closePath();
  }

  /* ---------------------------------------------------------------- Interactions */
  function local(e) { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }

  function onWheel(e) {
    if (!T.view) return;
    e.preventDefault();
    const p = local(e);
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      const dt = e.deltaX / W * (T.view.end - T.view.start);
      T.view = { start: T.view.start + dt, end: T.view.end + dt };
      T.draw(); return;
    }
    T.zoom(Math.exp(e.deltaY * 0.0015), tAt(p.x));
  }

  function onDown(e) {
    if (!T.view || e.button !== 0) return;
    cv.setPointerCapture(e.pointerId);
    drag = { x0: local(e).x, v0: { ...T.view }, moved: false };
  }
  function onMove(e) {
    if (!T.view) return;
    const p = local(e);
    if (drag) {
      const dx = p.x - drag.x0;
      if (Math.abs(dx) > 3) { drag.moved = true; cv.classList.add('dragging'); }
      if (drag.moved) {
        const dt = -dx / W * (drag.v0.end - drag.v0.start);
        T.view = { start: drag.v0.start + dt, end: drag.v0.end + dt };
        tip.hidden = true;
        T.draw();
      }
      return;
    }
    const h = hitTest(p);
    if ((h && h.item) !== (hover && hover.item)) { hover = h; T.draw(); }
    if (h) {
      const it = h.item;
      tip.innerHTML = '<b>' + U.esc(it.name) + '</b><br>' + U.esc(U.typeLabel[it.type] || it.type) + ' · ' +
        (it.type === 'image' ? U.fmtTime(it.tStart) : U.fmtTime(it.tStart) + ' → ' + U.fmtTime(it.tEnd) + ' (' + U.fmtDuration((it.tEnd - it.tStart) / 1000) + ')') +
        (it.missing.length ? '<br><span style="color:var(--warn)">⚠ Incomplet : ' + it.missing.map(k => M.missingLabels[k] || k).join(', ') + '</span>' : '');
      tip.hidden = false;
      const tlr = U.$('#timeline').getBoundingClientRect(), cr = cv.getBoundingClientRect();
      const tw = tip.offsetWidth;
      tip.style.left = U.clamp(cr.left - tlr.left + p.x - tw / 2, 4, tlr.width - tw - 4) + 'px';
      tip.style.top = (cr.top - tlr.top + H + 8) + 'px';
    } else {
      tip.hidden = true;
    }
  }
  function onUp(e) {
    if (!drag) return;
    const moved = drag.moved;
    drag = null; cv.classList.remove('dragging');
    if (!moved) {
      const p = local(e);
      const h = hitTest(p);
      // Clic sur un média : seek à son début ; ailleurs : seek à l'instant cliqué
      const t = h && Math.abs(x(h.item.tStart) - p.x) < 8 ? h.item.tStart : tAt(p.x);
      RP.bus.emit('seek', t);
    }
  }

  function hitTest(p) {
    if (!T.view) return null;
    const lanes = laneLayout();
    const l = lanes.find(l => p.y >= l.y && p.y <= l.y + l.h);
    if (!l) return null;
    const rr = rows[l.type] || [];
    const n = Math.max(1, rr.length), rh = Math.min(16, (l.h - 4) / n);
    const ri = Math.floor((p.y - l.y - 2 - (l.h - 4 - rh * n) / 2) / rh);
    const row = rr[U.clamp(ri, 0, rr.length - 1)];
    if (!row) return null;
    let best = null, bd = 6;
    row.forEach(it => {
      const x1 = x(it.tStart), x2 = Math.max(x(it.tEnd), x1 + 3);
      const d = p.x < x1 ? x1 - p.x : p.x > x2 ? p.x - x2 : 0;
      if (d <= bd) { bd = d; best = it; }
    });
    return best ? { item: best } : null;
  }

  function onOverview(e) {
    if (!T.range || !T.view) return;
    const r = ov.getBoundingClientRect();
    const t = T.range.start + (e.clientX - r.left) / OW * (T.range.end - T.range.start);
    const span = T.view.end - T.view.start;
    T.view = { start: t - span / 2, end: t + span / 2 };
    T.draw();
  }
})();
