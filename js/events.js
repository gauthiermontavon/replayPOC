/* Évènements : bandeau « sous-titre » au-dessus de la playbar, affiché pendant la durée de chaque évènement,
 * et mise en évidence des éléments liés (vignettes + repères) tant que l'évènement est actif. */
(function () {
  'use strict';
  const RP = window.RP, U = RP.util, M = RP.model;

  const EV = (RP.events = {
    /** Ids actuellement mis en évidence (nœuds liés aux évènements actifs, caméras développées en médias). */
    highlight: new Set()
  });
  const MAX_VISIBLE = 3;
  const cards = new Map(); // id -> { el, bar, item }
  let zone, more;

  EV.init = function () {
    zone = U.$('#events-zone');
    more = U.el('div', { class: 'ev-more' });
    RP.bus.on('media:enter', it => { if (it.type === 'event') show(it); });
    RP.bus.on('media:exit', it => { if (it.type === 'event') hide(it.id); });
    RP.bus.on('tick', onTick);
    // Contenu édité dans le tiroir : on met à jour la carte affichée et les liens
    RP.bus.on('model:changed', ({ id }) => {
      const c = cards.get(id);
      if (c) fill(c, M.get(id));
      refreshHighlight();
    });
    RP.bus.on('model:rebuilt', () => {
      Array.from(cards.keys()).forEach(id => { if (!M.get(id)) hide(id); });
      if (RP.player.t != null) M.activeAt(RP.player.t).forEach(it => { if (it.type === 'event') show(it); });
      cards.forEach((c, id) => fill(c, M.get(id)));
      refreshHighlight();
    });
  };

  function show(it) {
    if (cards.has(it.id)) return;
    const c = { item: it };
    c.time = U.el('span', { class: 'ev-time' });
    c.title = U.el('span', { class: 'ev-title' });
    c.desc = U.el('div', { class: 'ev-desc' });
    c.links = U.el('div', { class: 'ev-links' });
    c.bar = U.el('i');
    c.el = U.el('div', { class: 'ev-card', 'data-id': it.id, title: 'Ouvrir l\'évènement dans l\'éditeur' }, [
      U.el('div', { class: 'ev-head' }, [U.el('span', { class: 'ev-ic', html: U.icons.event }), c.time, c.title]),
      c.desc,
      c.links,
      U.el('div', { class: 'ev-prog' }, [c.bar])
    ]);
    c.el.addEventListener('click', () => RP.editor.select(it.id));
    fill(c, it);
    cards.set(it.id, c);
    layout();
    refreshHighlight();
  }

  function fill(c, it) {
    if (!it) return;
    c.item = it;
    c.time.textContent = it.timed ? U.fmtTime(it.tStart) : '';
    c.title.textContent = it.raw.title || 'Évènement';
    c.desc.textContent = it.raw.description || '';
    c.desc.hidden = !it.raw.description;
    // Pastilles des éléments liés (clic = centrer la carte dessus)
    c.links.innerHTML = '';
    const linked = M.linksOf(it);
    linked.forEach(n => {
      const chip = U.el('button', { class: 'ev-chip ' + n.type, type: 'button', title: 'Centrer la carte sur cet élément' }, [
        U.el('span', { class: 'ic', html: U.icons[n.type === 'camera' ? 'video' : n.type] || U.icons.pin }),
        document.createTextNode(EV.labelOf(n))
      ]);
      chip.addEventListener('click', (e) => { e.stopPropagation(); RP.mapview.focus(n.id); });
      c.links.append(chip);
    });
    c.links.hidden = !linked.length;
  }

  /** Libellé lisible d'un élément liable. */
  EV.labelOf = function (n) {
    if (n.type === 'image' && n.camera) return n.camera.name + ' · capture ' + n.seq;
    return n.name;
  };

  function hide(id) {
    const c = cards.get(id);
    if (!c) return;
    cards.delete(id);
    c.el.classList.add('closing');
    setTimeout(() => { c.el.remove(); layout(); }, 180);
    refreshHighlight();
  }

  /** Recalcule les ids à mettre en évidence et prévient vignettes et carte si l'ensemble a changé. */
  function refreshHighlight() {
    const nodes = [];
    cards.forEach(c => { const it = M.get(c.item.id); if (it) nodes.push(...M.linksOf(it)); });
    const next = M.expandLinks(nodes);
    const same = next.size === EV.highlight.size && Array.from(next).every(id => EV.highlight.has(id));
    if (same) return;
    EV.highlight = next;
    RP.bus.emit('highlight', next);
  }
  EV.refreshHighlight = refreshHighlight;

  /** Les évènements les plus récents en bas (au plus près de la playbar), 3 visibles au maximum. */
  function layout() {
    const list = Array.from(cards.values()).sort((a, b) => a.item.tStart - b.item.tStart);
    const visible = list.slice(-MAX_VISIBLE);
    const hidden = list.length - visible.length;
    list.forEach(c => { if (!visible.includes(c) && c.el.parentNode) c.el.remove(); });
    more.textContent = hidden > 0 ? '+' + hidden + ' évènement' + (hidden > 1 ? 's' : '') + ' en cours' : '';
    if (hidden > 0) zone.prepend(more); else more.remove();
    visible.forEach(c => zone.append(c.el));
  }

  function onTick(ev) {
    cards.forEach(c => {
      const it = c.item;
      const k = (ev.t - it.tStart) / Math.max(1, it.tEnd - it.tStart);
      c.bar.style.width = U.clamp(100 - k * 100, 0, 100) + '%'; // temps restant
    });
  }

  EV.visibleIds = () => Array.from(cards.keys());
})();
