/* Tiroir « Médias » : liste, indicateurs de champs manquants, formulaire d'édition */
(function () {
  'use strict';
  const RP = window.RP, U = RP.util, M = RP.model;

  const E = (RP.editor = { selected: null, filter: 'all' });
  let drawer, list, form;

  E.init = function () {
    drawer = U.$('#drawer'); list = U.$('#dr-list'); form = U.$('#dr-editor');
    U.$('#btn-drawer').onclick = () => E.toggle();
    U.$('#dr-close').onclick = () => E.toggle(false);
    U.$$('#dr-filter button').forEach(b => b.onclick = () => {
      E.filter = b.dataset.f;
      U.$$('#dr-filter button').forEach(x => x.classList.toggle('on', x === b));
      E.renderList();
    });
    U.$('#dr-export').onclick = () => RP.storage.exportJSON(M.serialize());
    U.$('#dr-import').onclick = () => U.$('#import-input').click();
    U.$('#import-input').onchange = async (e) => { await E.importFiles(e.target.files); e.target.value = ''; };
    RP.bus.on('tick', U.throttle(markActive, 400));
  };

  E.toggle = function (open) {
    const o = open == null ? !drawer.classList.contains('open') : open;
    drawer.classList.toggle('open', o);
    if (o) E.renderList();
    else { RP.mapview.select(null); }
  };
  E.isOpen = () => drawer.classList.contains('open');

  /* ------------------------------------------------------------ Liste (arborescente : caméras → séquences) */
  const collapsed = new Set();
  const byTime = (a, b) => (a.tStart == null) - (b.tStart == null) || (a.tStart || 0) - (b.tStart || 0) || a.name.localeCompare(b.name);
  const warnEl = node => node.missing.length
    ? U.el('span', { class: 'warn', title: 'Manquant : ' + node.missing.map(k => M.missingLabels[k] || k).join(', '), text: '⚠ ' + node.missing.length })
    : null;

  E.renderList = function () {
    const roots = M.roots.slice().sort(byTime);
    const shown = E.filter === 'missing' ? roots.filter(n => n.missing.length) : roots;
    list.innerHTML = '';
    if (!shown.length) {
      list.append(U.el('li', { class: 'empty', text: E.filter === 'missing' ? 'Toutes les métadonnées sont complètes ✓' : 'Aucun média' }));
    }
    shown.forEach(node => {
      if (node.type === 'camera') return renderCameraRows(node);
      const it = node;
      const sub = (U.typeLabel[it.type] || it.type) + ' · ' + (it.timed ? U.fmtDateTime(it.tStart) : 'sans date') +
        (it.type === 'moving-object' && it.track ? ' · ' + it.track.length + ' pts' : '') +
        (it.raw.file && !it.file && it.type !== 'moving-object' ? ' · fichier absent' : '');
      list.append(row(it, it.type, it.name, sub, warnEl(it)));
    });
    markActive();
    const n = M.missingCount(), b = U.$('#badge-missing');
    b.hidden = !n; b.textContent = n;
    if (E.selected && !M.get(E.selected)) { E.selected = null; form.hidden = true; }
  };

  function row(node, cls, name, sub, warn, extra) {
    const li = U.el('li', { class: cls + (node.id === E.selected ? ' sel' : ''), 'data-id': node.id }, [
      extra && extra.toggle || null,
      U.el('span', { class: 'dot', html: U.icons[node.type === 'camera' ? 'video' : node.type] || U.icons.pin }),
      U.el('div', { class: 'meta' }, [U.el('div', { class: 'nm', text: name }), U.el('div', { class: 'sub', text: sub })]),
      warn
    ]);
    li.onclick = () => E.select(node.id);
    return li;
  }

  function renderCameraRows(cam) {
    const n = cam.videos.length;
    const open = !collapsed.has(cam.id);
    const toggle = n > 1 ? U.el('button', { class: 'tree-toggle', type: 'button', title: open ? 'Replier' : 'Déplier', text: open ? '▾' : '▸', onclick: (e) => {
      e.stopPropagation();
      open ? collapsed.add(cam.id) : collapsed.delete(cam.id);
      E.renderList();
    } }) : U.el('span', { class: 'tree-toggle' });
    const sub = 'Caméra · ' + n + ' séquence' + (n > 1 ? 's' : '') + ' · ' + (cam.timed ? U.fmtDateTime(cam.tStart) : 'sans date');
    list.append(row(cam, 'video camera', cam.name, sub, warnEl(cam), { toggle }));
    if (!open) return;
    cam.videos.forEach(v => {
      const vsub = 'Séq. ' + v.seq + ' · ' + (v.timed ? U.fmtTime(v.tStart) : 'sans date') +
        (v.raw.duration ? ' · ' + U.fmtDuration(v.raw.duration) : '') + (v.raw.file && !v.file ? ' · fichier absent' : '');
      list.append(row(v, 'video child', U.basename(v.raw.file) || v.name, vsub, warnEl(v)));
    });
  }

  function markActive() {
    if (!E.isOpen()) return;
    U.$$('li[data-id]', list).forEach(li => {
      const node = M.get(li.dataset.id);
      const on = node && node.type === 'camera' ? node.videos.some(v => RP.player.activeIds.has(v.id)) : RP.player.activeIds.has(li.dataset.id);
      li.classList.toggle('active-now', !!on);
    });
  }

  /* ------------------------------------------------------------ Formulaire */
  E.select = function (id, opts) {
    E.selected = id;
    if (!E.isOpen()) E.toggle(true);
    U.$$('li[data-id]', list).forEach(li => li.classList.toggle('sel', li.dataset.id === id));
    const li = list.querySelector('li[data-id="' + CSS.escape(id) + '"]');
    if (li) li.scrollIntoView({ block: 'nearest' });
    RP.mapview.select(id, !(opts && opts.noPan));
    renderForm();
  };

  function field(key, label, input, extra) {
    return U.el('label', { class: 'fld', 'data-k': key }, [U.el('span', {}, [U.el('b', { text: label }), extra ? U.el('em', { text: extra }) : null]), input]);
  }
  const inp = (attrs) => U.el('input', Object.assign({ autocomplete: 'off' }, attrs));

  /**
   * Bloc latitude/longitude (+ placer / effacer) pour un nœud.
   * opts.disabled : position imposée (affichée en lecture seule) ; opts.hint : position héritée (placeholder).
   */
  function positionBlock(node, opts) {
    opts = opts || {};
    const p = opts.disabled ? (opts.shown || {}) : (node.raw.position || {});
    const ph = opts.hint ? { lat: String(opts.hint.lat), lon: String(opts.hint.lon) } : { lat: 'ex. 47.123  (ou « 47.123, 7.456 »)', lon: 'ex. 7.456' };
    const lat = inp({ type: 'text', inputmode: 'decimal', value: p.lat != null ? p.lat : '', placeholder: ph.lat, disabled: !!opts.disabled });
    const lon = inp({ type: 'text', inputmode: 'decimal', value: p.lon != null ? p.lon : '', placeholder: ph.lon, disabled: !!opts.disabled });
    const out = [U.el('div', { class: 'row2' }, [field('position', 'Latitude', lat, opts.tag), field('position', 'Longitude', lon)])];
    if (opts.disabled) return out;
    out.push(U.el('div', { class: 'ed-btns' }, [
      U.el('button', { class: 'btn sm', type: 'button', text: '📍 Placer sur la carte', onclick: async () => {
        const pos = await RP.mapview.pickPosition();
        if (pos) apply({ position: pos }, 'position', node.id);
      } }),
      node.raw.position ? U.el('button', { class: 'btn sm danger', type: 'button', text: 'Effacer la position', onclick: () => apply({ position: null }, 'position', node.id) }) : null
    ]));
    const onPos = () => {
      let la = lat.value.trim(), lo = lon.value.trim();
      const pair = la.match(/^\s*(-?\d+(?:[.,]\d+)?)\s*[,;\s]\s*(-?\d+(?:[.,]\d+)?)\s*$/);
      if (pair && !/^-?\d+,\d+$/.test(la)) { la = pair[1]; lo = pair[2]; }
      const q = { lat: num(la), lon: num(lo) };
      if (q.lat == null && q.lon == null) return apply({ position: null }, 'position', node.id);
      if (!U.validLatLon(q)) { U.toast('Coordonnées invalides'); return; }
      apply({ position: q }, 'position', node.id);
    };
    lat.onchange = onPos; lon.onchange = onPos;
    return out;
  }

  /** Formulaire d'une caméra (conteneur de séquences). */
  function renderCameraForm(cam) {
    const r = cam.raw, n = cam.videos.length;
    form.append(
      U.el('h3', {}, [document.createTextNode('Caméra')]),
      U.el('div', { class: 'file', text: n + ' séquence' + (n > 1 ? 's' : '') + (cam.timed ? ' · ' + U.fmtDateTime(cam.tStart) + ' → ' + U.fmtTime(cam.tEnd) : '') })
    );
    const name = inp({ type: 'text', value: r.name || '', placeholder: cam.id });
    form.append(field('name', 'Nom de la caméra', name));
    name.onchange = () => apply({ name: name.value.trim() || null }, null, cam.id);

    positionBlock(cam, { tag: 'caméra' }).forEach(x => form.append(x));
    const chk = U.el('input', { type: 'checkbox' });
    chk.checked = cam.applyPosition;
    chk.onchange = () => apply({ applyPosition: chk.checked }, null, cam.id);
    form.append(U.el('label', { class: 'chk' }, [chk, U.el('span', { text: 'Appliquer cette position à toutes les vidéos' })]));
    form.append(U.el('div', { class: 'ed-note', text: cam.applyPosition
      ? 'Toutes les séquences sont placées à la position de la caméra (leurs positions propres sont conservées mais ignorées).'
      : 'Chaque séquence utilise sa position propre ; à défaut, elle hérite de celle de la caméra.' }));
    if (cam.pos) form.append(U.el('div', { class: 'ed-note', text: 'Astuce : le repère sélectionné peut être déplacé directement sur la carte.' }));

    // Séquences
    form.append(U.el('div', { class: 'fld' }, [U.el('span', {}, [U.el('b', { text: 'Séquences' })])]));
    const ul = U.el('ul', { class: 'seq-list' });
    cam.videos.forEach(v => {
      ul.append(U.el('li', { onclick: () => E.select(v.id) }, [
        U.el('b', { text: v.seq + '.' }),
        U.el('span', { class: 'nm', text: U.basename(v.raw.file) || v.name }),
        U.el('span', { class: 'sub', text: (v.timed ? U.fmtTime(v.tStart) : 'sans date') + (v.raw.duration ? ' · ' + U.fmtDuration(v.raw.duration) : '') + (v.posFrom === 'video' ? ' · 📍 propre' : '') }),
        warnEl(v)
      ]));
    });
    form.append(ul);

    const notes = U.el('textarea', { rows: '2', placeholder: 'Notes…' }); notes.value = r.notes || '';
    notes.onchange = () => apply({ notes: notes.value.trim() || null }, null, cam.id);
    form.append(field('notes', 'Notes', notes));
    form.append(U.el('div', { class: 'ed-btns' }, [
      cam.timed ? U.el('button', { class: 'btn sm primary', type: 'button', text: '▶ Aller au début', onclick: () => {
        RP.player.seek(cam.tStart); RP.panels.reveal(cam.videos.find(v => v.timed).id);
      } }) : null
    ]));
    if (cam.missing.includes('position')) U.$$('.fld[data-k="position"]', form).forEach(x => x.classList.add('miss'));
  }

  function renderForm() {
    const it = M.get(E.selected);
    if (!it) { form.hidden = true; return; }
    form.hidden = false;
    form.innerHTML = '';
    if (it.type === 'camera') return renderCameraForm(it);
    const r = it.raw, src = (r.meta && r.meta.source) || {};
    const srcTxt = Object.keys(src).map(k => (M.missingLabels[k] || k) + ' : ' + src[k]).join(' · ');
    const cam = it.camera;

    form.append(
      U.el('h3', {}, [document.createTextNode(cam ? 'Vidéo — séquence ' + it.seq + '/' + cam.videos.length : (U.typeLabel[it.type] || it.type))]),
      U.el('div', { class: 'file', text: r.file ? r.file + (it.file ? '' : ' — introuvable dans le dossier') : 'Aucun fichier associé' }),
      srcTxt ? U.el('div', { class: 'ed-note', text: 'Sources : ' + srcTxt }) : null
    );

    const f = {};
    if (cam) {
      // Caméra de rattachement (déplacement possible)
      const sel = U.el('select', { class: 'sel-input' });
      M.cameras().forEach(c => sel.append(U.el('option', { value: c.id, text: c.name + (c.videos.length > 1 ? ' (' + c.videos.length + ' séq.)' : '') })));
      sel.append(U.el('option', { value: '', text: '＋ Nouvelle caméra' }));
      sel.value = cam.id;
      sel.onchange = () => {
        const to = M.moveVideo(it.id, sel.value || null);
        if (to) U.toast('Vidéo rattachée à « ' + to.name + ' »');
        E.select(it.id, { noPan: true });
      };
      form.append(field('camera', 'Caméra', sel));
      form.append(U.el('div', { class: 'ed-btns' }, [U.el('button', { class: 'btn sm', type: 'button', text: '⚙ Ouvrir la caméra', onclick: () => E.select(cam.id) })]));
    }
    f.name = inp({ type: 'text', value: r.name || '', placeholder: cam ? U.basename(r.file) || it.name : it.name });
    form.append(field('name', cam ? 'Nom de la séquence' : 'Nom', f.name));

    const timeKey = it.type === 'video' ? 'start' : it.type === 'image' ? 'time' : null;
    if (timeKey) {
      f.time = inp({ type: 'datetime-local', step: '1', value: U.toLocalInput(U.parseTime(r[timeKey])) });
      form.append(field(timeKey, it.type === 'video' ? 'Début de la vidéo' : 'Date de prise de vue', f.time, U.tzLabel()));
      const btns = U.el('div', { class: 'ed-btns' });
      btns.append(U.el('button', { class: 'btn sm', type: 'button', text: '⟵ Tête de lecture', title: 'Utiliser l\'instant courant de la timeline', onclick: () => {
        if (RP.player.t == null) return;
        apply({ [timeKey]: U.iso(RP.player.t - (+r.offset || 0) * 1000) }, timeKey);
      } }));
      if (it.file) btns.append(U.el('button', { class: 'btn sm', type: 'button', text: 'Date du fichier', title: 'Date de dernière modification du fichier (souvent la fin de l\'enregistrement)', onclick: () => {
        let t = it.file.lastModified;
        if (it.type === 'video' && +r.duration) t -= +r.duration * 1000;
        apply({ [timeKey]: U.iso(Math.round(t / 1000) * 1000) }, timeKey);
      } }));
      form.append(btns);
    }

    if (it.type === 'video') {
      f.duration = inp({ type: 'number', step: '0.1', min: '0', value: r.duration != null ? r.duration : '', placeholder: 'secondes' });
      f.offset = inp({ type: 'number', step: '0.1', value: r.offset != null ? r.offset : '', placeholder: '0' });
      form.append(U.el('div', { class: 'row2' }, [field('duration', 'Durée (s)', f.duration), field('offset', 'Décalage horloge (s)', f.offset)]));
    } else if (it.type === 'image') {
      f.display = inp({ type: 'number', step: '1', min: '1', value: r.display != null ? r.display : '', placeholder: String(M.DEFAULT_IMAGE_DISPLAY) });
      f.offset = inp({ type: 'number', step: '0.1', value: r.offset != null ? r.offset : '', placeholder: '0' });
      form.append(U.el('div', { class: 'row2' }, [field('display', 'Affichage (s)', f.display), field('offset', 'Décalage horloge (s)', f.offset)]));
    } else if (it.type === 'moving-object') {
      f.offset = inp({ type: 'number', step: '0.1', value: r.offset != null ? r.offset : '', placeholder: '0' });
      form.append(field('offset', 'Décalage horloge (s)', f.offset));
      form.append(U.el('div', { class: 'ed-note', text: it.track && it.track.length
        ? it.track.length + ' points · ' + U.fmtDateTime(it.tStart) + ' → ' + U.fmtTime(it.tEnd)
        : 'Trajectoire vide : importez un fichier GPX ou complétez « track » dans replay.json.' }));
    }

    if (cam && cam.applyPosition) {
      positionBlock(it, { disabled: true, shown: cam.pos || {}, tag: 'imposée' }).forEach(x => form.append(x));
      form.append(U.el('div', { class: 'ed-note', text: cam.pos
        ? 'Position imposée par la caméra « ' + cam.name + ' ». Décochez « Appliquer à toutes les vidéos » dans la caméra pour définir une position propre.'
        : 'Position imposée par la caméra « ' + cam.name + ' », qui n\'en a pas encore : définissez-la dans la caméra.' }));
    } else if (cam) {
      positionBlock(it, { hint: cam.pos, tag: r.position ? 'propre' : cam.pos ? 'héritée' : '' }).forEach(x => form.append(x));
      form.append(U.el('div', { class: 'ed-note', text: cam.pos
        ? 'Sans position propre, la séquence hérite de celle de la caméra (' + cam.pos.lat + ', ' + cam.pos.lon + ').'
        : 'Ni la séquence ni la caméra n\'ont de position.' }));
    } else if (it.type !== 'moving-object') {
      positionBlock(it).forEach(x => form.append(x));
      if (r.position) form.append(U.el('div', { class: 'ed-note', text: 'Astuce : le repère sélectionné peut être déplacé directement sur la carte.' }));
    }

    f.notes = U.el('textarea', { rows: '2', placeholder: 'Notes…' }); f.notes.value = r.notes || '';
    form.append(field('notes', 'Notes', f.notes));

    form.append(U.el('div', { class: 'ed-btns' }, [
      it.timed ? U.el('button', { class: 'btn sm primary', type: 'button', text: '▶ Aller au début', onclick: () => { RP.player.seek(it.tStart); RP.panels.reveal(it.id); } }) : null
    ]));

    // Écouteurs
    f.name.onchange = () => apply({ name: f.name.value.trim() || null }, 'name');
    if (f.time) f.time.onchange = () => { const t = U.fromLocalInput(f.time.value); apply({ [timeKey]: t != null ? U.iso(t) : null }, timeKey); };
    if (f.duration) f.duration.onchange = () => apply({ duration: num(f.duration.value) }, 'duration');
    if (f.display) f.display.onchange = () => apply({ display: num(f.display.value) }, 'display');
    if (f.offset) f.offset.onchange = () => apply({ offset: num(f.offset.value) }, 'offset');
    f.notes.onchange = () => apply({ notes: f.notes.value.trim() || null }, null);

    // Mise en évidence des champs manquants
    it.missing.forEach(k => U.$$('.fld[data-k="' + k + '"]', form).forEach(x => x.classList.add('miss')));
  }

  function num(v) {
    if (v == null || String(v).trim() === '') return null;
    const n = parseFloat(String(v).replace(',', '.'));
    return isFinite(n) ? n : null;
  }

  function apply(patch, srcKey, id) {
    const it = M.get(id || E.selected);
    if (!it) return;
    if (srcKey && it.type !== 'camera') {
      const meta = Object.assign({}, it.raw.meta || {});
      meta.source = Object.assign({}, meta.source || {}, { [srcKey]: 'manuel' });
      patch.meta = meta;
    }
    M.update(it.id, patch);
  }

  /** Le nœud sélectionné est-il concerné par une modification de `id` (même caméra) ? */
  function related(id) {
    if (!id || !E.selected) return false;
    if (id === E.selected) return true;
    const a = M.cameraOf(id), b = M.cameraOf(E.selected);
    return !!a && a === b;
  }

  /** Appelé après toute modification du modèle. */
  E.onModelChanged = function (id) {
    if (!E.isOpen()) { const n = M.missingCount(), b = U.$('#badge-missing'); b.hidden = !n; b.textContent = n; return; }
    E.renderList();
    if (related(id)) {
      const a = document.activeElement;
      const focusKey = a && form.contains(a) ? (a.closest('.fld') || {}).dataset : null;
      renderForm();
      if (focusKey && focusKey.k) { const el = form.querySelector('.fld[data-k="' + focusKey.k + '"] input, .fld[data-k="' + focusKey.k + '"] textarea'); if (el) el.focus(); }
    }
  };

  /* ------------------------------------------------------------ Import */
  E.importFiles = async function (files) {
    let n = 0;
    for (const f of Array.from(files)) {
      try {
        if (/\.gpx$/i.test(f.name)) {
          const raw = await RP.metadata.parseGpx(f);
          raw.meta = { source: { track: 'gpx' } };
          M.add(raw); n++;
        } else if (/\.json$/i.test(f.name)) {
          const data = JSON.parse(await f.text());
          (Array.isArray(data) ? data : [data]).forEach(raw => { if (raw && typeof raw === 'object') { M.add(raw, RP.app.fileFor); n++; } });
        }
      } catch (e) { U.toast('Import impossible : ' + f.name + ' (' + e.message + ')', 5000); }
    }
    if (n) { U.toast(n + ' élément(s) importé(s)'); RP.bus.emit('model:rebuilt'); }
  };
})();
