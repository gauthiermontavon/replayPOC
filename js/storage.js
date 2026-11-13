/* Accès au dossier de médias : File System Access API (lecture/écriture) ou repli <input webkitdirectory> (lecture seule) */
(function () {
  'use strict';
  const RP = window.RP, U = RP.util;

  const PROJECT_FILE = 'replay.json';
  const MEDIA_EXT = ['mp4', 'm4v', 'mov', 'webm', 'ogv', 'mkv', 'jpg', 'jpeg', 'png', 'webp', 'gif', 'heic', 'heif', 'avif', 'gpx'];
  const MAX_DEPTH = 3;

  const S = (RP.storage = {
    PROJECT_FILE,
    dir: null,          // FileSystemDirectoryHandle si dispo
    readOnly: true,
    folderName: '',
    supportsFSA: typeof window.showDirectoryPicker === 'function'
  });

  /* ---------- IndexedDB : mémorisation du handle du dernier dossier ---------- */
  function idb() {
    return new Promise((res, rej) => {
      let r;
      try { r = indexedDB.open('replay-poc', 1); } catch (e) { return rej(e); }
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  async function kvGet(k) {
    try {
      const db = await idb();
      return await new Promise((res) => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => res(null); });
    } catch (e) { return null; }
  }
  async function kvSet(k, v) {
    try {
      const db = await idb();
      await new Promise((res) => { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(v, k); tx.oncomplete = res; tx.onerror = res; });
    } catch (e) { /* ignore */ }
  }

  S.lastHandle = () => S.supportsFSA ? kvGet('lastDir') : Promise.resolve(null);

  /* ---------- Ouverture ---------- */
  S.pick = async function () {
    const h = await window.showDirectoryPicker({ id: 'replay-medias', mode: 'readwrite' });
    await kvSet('lastDir', h);
    return S.openHandle(h);
  };

  S.reopen = async function (h) {
    let p = await h.queryPermission({ mode: 'readwrite' });
    if (p !== 'granted') p = await h.requestPermission({ mode: 'readwrite' });
    if (p !== 'granted') {
      p = await h.requestPermission({ mode: 'read' });
      if (p !== 'granted') throw new Error('Accès refusé');
    }
    return S.openHandle(h);
  };

  S.openHandle = async function (h) {
    S.dir = h;
    S.folderName = h.name;
    S.readOnly = (await h.queryPermission({ mode: 'readwrite' })) !== 'granted';
    const files = [];
    await walk(h, '', 0, files);
    let project = null;
    try {
      const fh = await h.getFileHandle(PROJECT_FILE);
      project = JSON.parse(await (await fh.getFile()).text());
    } catch (e) {
      if (e && e.name === 'SyntaxError') U.toast('replay.json illisible : ' + e.message, 5000);
    }
    return { files, project, name: h.name };
  };

  async function walk(dir, prefix, depth, out) {
    for await (const [name, handle] of dir.entries()) {
      if (name.startsWith('.')) continue;
      const path = prefix ? prefix + '/' + name : name;
      if (handle.kind === 'directory') {
        if (depth < MAX_DEPTH) await walk(handle, path, depth + 1, out);
      } else if (MEDIA_EXT.includes(U.ext(name)) || (U.ext(name) === 'json' && name !== PROJECT_FILE && depth === 0)) {
        try { out.push({ name, path, file: await handle.getFile() }); } catch (e) { /* ignore */ }
      }
    }
  }

  /** Repli : FileList issue de <input webkitdirectory>. */
  S.fromFileList = async function (list) {
    const arr = Array.from(list);
    S.dir = null; S.readOnly = true;
    const first = arr[0] && arr[0].webkitRelativePath || '';
    S.folderName = first.split('/')[0] || 'dossier';
    let project = null;
    const files = [];
    for (const f of arr) {
      const rel = (f.webkitRelativePath || f.name).split('/').slice(1).join('/') || f.name;
      if (rel === PROJECT_FILE) {
        try { project = JSON.parse(await f.text()); } catch (e) { U.toast('replay.json illisible', 4000); }
      } else if (MEDIA_EXT.includes(U.ext(f.name)) || (U.ext(f.name) === 'json' && !rel.includes('/'))) {
        files.push({ name: f.name, path: rel, file: f });
      }
    }
    return { files, project, name: S.folderName };
  };

  /* ---------- Sauvegarde ---------- */
  S.save = async function (data) {
    const text = JSON.stringify(data, null, 2);
    if (!S.dir || S.readOnly) throw Object.assign(new Error('Lecture seule'), { code: 'RO' });
    const fh = await S.dir.getFileHandle(PROJECT_FILE, { create: true });
    const w = await fh.createWritable();
    await w.write(text);
    await w.close();
  };

  S.exportJSON = function (data) {
    U.download(PROJECT_FILE, JSON.stringify(data, null, 2));
  };
})();
