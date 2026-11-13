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

  /* ------------------------------------------------------------ Liste */
  E.renderList = function () {
    const items = M.items.slice().sort((a, b) => (a.tStart == null) - (b.tStart == null) || (a.tStart || 0) - (b.tStart || 0) || a.name.localeCompare(b.name));
    const shown = E.filter === 'missing' ? items.filter(i => i.missing.length) : items;
    list.innerHTML = '';
    if (!shown.length) {
      list.append(U.el('li', { class: 'empty', text: E.filter === 'missing' ? 'Toutes les métadonnées sont complètes ✓' : 'Aucun média' }));
    }
    shown.forEach(it => {
      const sub = (U.typeLabel[it.type] || it.type) + ' · ' + (it.timed ? U.fmtDateTime(it.tStart) : 'sans date') +
        (it.type === 'video' && it.raw.duration ? ' · ' + U.fmtDuration(it.raw.duration) : '') +
        (it.type === 'moving-object' && it.track ? ' · ' + it.track.length + ' pts' : '') +
        (it.raw.file && !it.file && it.type !== 'moving-object' ? ' · fichier absent' : '');
      const li = U.el('li', { class: it.type + (it.id === E.selected ? ' sel' : ''), 'data-id': it.id }, [
        U.el('span', { class: 'dot', html: U.icons[it.type] || U.icons.pin }),
        U.el('div', { class: 'meta' }, [U.el('div', { class: 'nm', text: it.name }), U.el('div', { class: 'sub', text: sub })]),
        it.missing.length ? U.el('span', { class: 'warn', title: 'Manquant : ' + it.missing.map(k => M.missingLabels[k] || k).join(', '), text: '⚠ ' + it.missing.length }) : null
      ]);
      li.onclick = () => E.select(it.id);
      list.append(li);
    });
    markActive();
    const n = M.missingCount(), b = U.$('#badge-missing');
    b.hidden = !n; b.textContent = n;
  };

  function markActive() {
    if (!E.isOpen()) return;
    U.$$('li[data-id]', list).forEach(li => li.classList.toggle('active-now', RP.player.activeIds.has(li.dataset.id)));
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

  function renderForm() {
    const it = M.get(E.selected);
    if (!it) { form.hidden = true; return; }
    form.hidden = false;
    form.innerHTML = '';
    const r = it.raw, src = (r.meta && r.meta.source) || {};
    const srcTxt = Object.keys(src).map(k => (M.missingLabels[k] || k) + ' : ' + src[k]).join(' · ');

    form.append(
      U.el('h3', {}, [document.createTextNode(U.typeLabel[it.type] || it.type)]),
      U.el('div', { class: 'file', text: r.file ? r.file + (it.file ? '' : ' — introuvable dans le dossier') : 'Aucun fichier associé' }),
      srcTxt ? U.el('div', { class: 'ed-note', text: 'Sources : ' + srcTxt }) : null
    );

    const f = {};
    f.name = inp({ type: 'text', value: r.name || '', placeholder: it.name });
    form.append(field('name', 'Nom', f.name));

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

    if (it.type !== 'moving-object') {
      const p = r.position || {};
      f.lat = inp({ type: 'text', inputmode: 'decimal', value: p.lat != null ? p.lat : '', placeholder: 'ex. 47.123  (ou « 47.123, 7.456 »)' });
      f.lon = inp({ type: 'text', inputmode: 'decimal', value: p.lon != null ? p.lon : '', placeholder: 'ex. 7.456' });
      form.append(U.el('div', { class: 'row2' }, [field('position', 'Latitude', f.lat), field('position', 'Longitude', f.lon)]));
      form.append(U.el('div', { class: 'ed-btns' }, [
        U.el('button', { class: 'btn sm', type: 'button', text: '📍 Placer sur la carte', onclick: async () => {
          const pos = await RP.mapview.pickPosition();
          if (pos) apply({ position: pos }, 'position');
        } }),
        r.position ? U.el('button', { class: 'btn sm danger', type: 'button', text: 'Effacer la position', onclick: () => apply({ position: null }, 'position') }) : null
      ]));
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
    if (f.lat) {
      const onPos = () => {
        let la = f.lat.value.trim(), lo = f.lon.value.trim();
        const pair = la.match(/^\s*(-?\d+(?:[.,]\d+)?)\s*[,;\s]\s*(-?\d+(?:[.,]\d+)?)\s*$/);
        if (pair && !/^-?\d+,\d+$/.test(la)) { la = pair[1]; lo = pair[2]; }
        const p = { lat: num(la), lon: num(lo) };
        if (p.lat == null && p.lon == null) return apply({ position: null }, 'position');
        if (!U.validLatLon(p)) { U.toast('Coordonnées invalides'); return; }
        apply({ position: p }, 'position');
      };
      f.lat.onchange = onPos; f.lon.onchange = onPos;
    }
    f.notes.onchange = () => apply({ notes: f.notes.value.trim() || null }, null);

    // Mise en évidence des champs manquants
    it.missing.forEach(k => U.$$('.fld[data-k="' + k + '"]', form).forEach(x => x.classList.add('miss')));
  }

  function num(v) {
    if (v == null || String(v).trim() === '') return null;
    const n = parseFloat(String(v).replace(',', '.'));
    return isFinite(n) ? n : null;
  }

  function apply(patch, srcKey) {
    const it = M.get(E.selected);
    if (!it) return;
    if (srcKey) {
      const meta = Object.assign({}, it.raw.meta || {});
      meta.source = Object.assign({}, meta.source || {}, { [srcKey]: 'manuel' });
      patch.meta = meta;
    }
    M.update(it.id, patch);
  }

  /** Appelé après toute modification du modèle. */
  E.onModelChanged = function (id) {
    if (!E.isOpen()) { const n = M.missingCount(), b = U.$('#badge-missing'); b.hidden = !n; b.textContent = n; return; }
    E.renderList();
    if (id && id === E.selected) {
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
          (Array.isArray(data) ? data : [data]).forEach(raw => { if (raw && typeof raw === 'object') { M.add(raw, RP.app.fileFor(raw)); n++; } });
        }
      } catch (e) { U.toast('Import impossible : ' + f.name + ' (' + e.message + ')', 5000); }
    }
    if (n) { U.toast(n + ' élément(s) importé(s)'); RP.bus.emit('model:rebuilt'); }
  };
})();
