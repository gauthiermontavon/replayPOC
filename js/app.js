/* Démarrage de l'application et orchestration des modules */
(function () {
  'use strict';
  const RP = window.RP, U = RP.util, M = RP.model, S = RP.storage, MD = RP.metadata;

  const A = (RP.app = { files: [], loaded: false });

  A.fileFor = function (raw) {
    const f = M.matchFile(raw, A.files);
    return f ? f.file : null;
  };

  /* ------------------------------------------------------------ Init */
  function init() {
    RP.mapview.init();
    RP.timeline.init();
    RP.player.init();
    RP.panels.init();
    RP.editor.init();

    U.$('#btn-fit').onclick = () => RP.mapview.fitAll();
    U.$('#btn-follow').onclick = () => RP.mapview.setFollow(!RP.mapview.follow);
    U.$('#btn-folder').onclick = () => showWelcome(true);

    RP.bus.on('model:changed', ({ id }) => {
      RP.mapview.refreshItem(id);
      refreshTime(true);
      RP.panels.refreshItem(id);
      RP.editor.onModelChanged(id);
      scheduleSave();
    });
    RP.bus.on('model:rebuilt', () => { rebuild(true); RP.panels.rebuild(); scheduleSave(); });
    RP.bus.on('item:click', (id) => {
      const it = M.get(id);
      if (!it) return;
      if (RP.editor.isOpen()) RP.editor.select(id, { noPan: true });
      if (it.timed && !RP.player.activeIds.has(id)) RP.player.seek(it.tStart);
      // la fenêtre s'ouvrira via media:enter ; si déjà actif mais fermée à la main, on la rouvre
      setTimeout(() => RP.panels.reveal(id), 50);
    });
    RP.bus.on('item:focus', (id) => {
      RP.mapview.focus(id);
      if (RP.editor.isOpen()) RP.editor.select(id, { noPan: true });
    });

    setupWelcome();
  }

  /* ------------------------------------------------------------ Accueil */
  async function setupWelcome() {
    const open = U.$('#wl-open'), reopen = U.$('#wl-reopen'), fbLabel = U.$('#wl-fallback-label');
    if (S.supportsFSA) {
      open.onclick = async () => {
        try { await loadFolder(await S.pick()); }
        catch (e) { if (e.name !== 'AbortError') { console.error(e); U.toast('Ouverture impossible : ' + e.message, 5000); } }
      };
      const h = await S.lastHandle();
      if (h) {
        reopen.hidden = false;
        reopen.textContent = 'Rouvrir « ' + h.name + ' »';
        reopen.onclick = async () => {
          try { await loadFolder(await S.reopen(h)); }
          catch (e) { console.error(e); U.toast('Impossible de rouvrir ce dossier : ' + e.message, 5000); }
        };
      }
    } else {
      open.hidden = true;
      fbLabel.hidden = false;
      fbLabel.classList.add('primary');
      U.$('#wl-hint').innerHTML = 'Ce navigateur ne permet pas l\'écriture dans le dossier : les modifications seront à <b>exporter</b> (replay.json). Pour l\'enregistrement direct, utilisez Chrome ou Edge.';
    }
    U.$('#wl-fallback').onchange = async (e) => {
      if (e.target.files.length) await loadFolder(await S.fromFileList(e.target.files));
      e.target.value = '';
    };
    U.$('#wl-json').onchange = async (e) => {
      const f = e.target.files[0];
      e.target.value = '';
      if (!f) return;
      try {
        const data = JSON.parse(await f.text());
        S.dir = null; S.readOnly = true; S.folderName = f.name;
        await loadFolder({ files: [], project: Array.isArray(data) ? data : [data], name: f.name });
      } catch (er) { U.toast('JSON invalide : ' + er.message, 5000); }
    };
    U.$('#welcome').addEventListener('click', (e) => { if (e.target.id === 'welcome' && A.loaded) showWelcome(false); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && A.loaded) showWelcome(false); });
  }

  function showWelcome(v) { U.$('#welcome').hidden = !v; }

  /* ------------------------------------------------------------ Chargement */
  async function loadFolder(res) {
    showWelcome(false);
    RP.player.pause();
    RP.panels.closeAll();
    M.reset();
    A.files = res.files || [];
    let changed = false;

    let project = Array.isArray(res.project) ? res.project : null;
    if (!project) {
      // Pas de replay.json : on reprend un éventuel fichier JSON au format du modèle à la racine du dossier
      for (const f of A.files.filter(f => MD.kindOf(f.name) === 'json')) {
        try {
          const d = JSON.parse(await f.file.text());
          if (Array.isArray(d) && d.length && d.every(x => x && typeof x === 'object' && x.type)) {
            project = (project || []).concat(d);
            U.toast('Modèle importé depuis « ' + f.name + ' »');
          }
        } catch (e) { /* ignore */ }
      }
      changed = true;
    }
    (project || []).forEach(raw => {
      if (!raw || typeof raw !== 'object') return;
      if (raw.type === 'video') changed = true; // ancien format migré en caméra → réécriture
      M.add(raw, A.fileFor);
    });

    // Fichiers non référencés : extraction automatique des métadonnées
    const referenced = new Set(M.items.map(it => it.file).filter(Boolean));
    const todo = A.files.filter(f => ['video', 'image', 'gpx'].includes(MD.kindOf(f.name)) && !referenced.has(f.file));
    let i = 0;
    for (const f of todo) {
      i++;
      U.toast('Analyse des médias… ' + i + '/' + todo.length, 10000);
      try {
        const raw = await MD.extract(f);
        if (!raw) continue;
        // Vidéos : toujours dans une caméra ; images : dans la caméra de leur sous-dossier, sinon photo indépendante
        if (raw.type === 'video' || (raw.type === 'image' && f.path.includes('/'))) addToFolderCamera(raw, f);
        else M.add(raw, () => f.file);
        changed = true;
      } catch (e) { console.warn('Extraction', f.name, e); }
    }
    finalizeAutoCameras();
    // Vidéos référencées sans durée : on la lit dans le fichier
    for (const it of M.items) {
      if (it.type === 'video' && it.file && !(+it.raw.duration > 0)) {
        const p = await MD.probeVideo(it.file);
        if (p.duration) {
          const meta = Object.assign({}, it.raw.meta || {});
          meta.source = Object.assign({}, meta.source || {}, { duration: 'video' });
          M.update(it.id, { duration: +p.duration.toFixed(3), meta }, { silent: true });
          changed = true;
        }
      }
    }

    A.loaded = true;
    U.$('#dr-folder').textContent = '📁 ' + (res.name || S.folderName);
    U.$('#dr-folder').title = res.name || '';
    rebuild(false);
    RP.mapview.fitAll(false);
    const n = M.items.length, miss = M.missingCount();
    U.toast(n + ' média(s) chargé(s)' + (miss ? ' — ' + miss + ' à compléter' : ''), 3500);
    setSaveState();
    if (changed && !S.readOnly) scheduleSave();
    if (miss && !M.timed().length) RP.editor.toggle(true);
  }

  A.loadFolder = loadFolder;

  /* Regroupement automatique : un sous-dossier = une caméra (vidéos et captures) ; une vidéo à la racine = sa propre caméra. */
  const autoCams = new Set();
  function addToFolderCamera(vraw, f) {
    const dir = f.path.includes('/') ? f.path.split('/').slice(0, -1).join('/') : '';
    let cam = null;
    if (dir) {
      const dirName = dir.split('/').pop(), slug = U.slug(dirName);
      cam = M.cameras().find(c => c.id === slug || U.slug(c.name) === slug || c.raw.folder === dir);
      if (!cam) { cam = M.createCamera({ id: slug, name: dirName, folder: dir }); autoCams.add(cam); }
    } else {
      const base = vraw.name || vraw.id;
      cam = M.createCamera({ id: vraw.id, name: base });
      autoCams.add(cam);
    }
    delete vraw.name; // le nom affiché est celui de la caméra ; la séquence garde son fichier
    vraw.id = cam.id + '-' + (vraw.type === 'image' ? 'c' : '') + (cam.medias.length + 1);
    M.addMediaToCamera(cam, vraw, f.file);
  }

  /** Caméras créées automatiquement : position = 1re position GPS trouvée ; appliquée à tous les médias s'ils sont tous au même endroit. */
  function finalizeAutoCameras() {
    autoCams.forEach(cam => {
      const withPos = cam.medias.filter(v => v.ownPos);
      if (!cam.raw.position && withPos.length) cam.raw.position = { lat: withPos[0].ownPos.lat, lon: withPos[0].ownPos.lon };
      const distinct = new Set(withPos.map(v => v.ownPos.lat.toFixed(6) + ',' + v.ownPos.lon.toFixed(6)));
      cam.raw.applyPosition = distinct.size <= 1;
      M.update(cam.id, {}, { silent: true });
    });
    autoCams.clear();
  }

  function refreshTime(keepView) {
    RP.timeline.setData(keepView);
    const r = M.range();
    RP.player.setRange(r);
    RP.player.refresh();
  }

  function rebuild(keepView) {
    RP.mapview.build();
    refreshTime(keepView);
    RP.editor.renderList();
  }

  /* ------------------------------------------------------------ Sauvegarde */
  function setSaveState(state, msg) {
    const el = U.$('#dr-save');
    el.className = 'save-state';
    if (S.readOnly) { el.classList.add('ro'); el.textContent = 'Lecture seule — utilisez Exporter'; return; }
    if (state === 'ok') { el.classList.add('ok'); el.textContent = '✓ Enregistré ' + U.fmtHM(Date.now()); }
    else if (state === 'err') { el.classList.add('err'); el.textContent = '⚠ ' + msg; }
    else if (state === 'pending') el.textContent = 'Enregistrement…';
    else el.textContent = 'replay.json';
  }
  const doSave = U.debounce(async () => {
    if (S.readOnly) { setSaveState(); return; }
    try { await S.save(M.serialize()); setSaveState('ok'); }
    catch (e) { console.error(e); setSaveState('err', 'Échec de l\'enregistrement'); U.toast('Échec de l\'enregistrement : ' + e.message, 5000); }
  }, 700);
  function scheduleSave() { if (!S.readOnly) setSaveState('pending'); doSave(); }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
