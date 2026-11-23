# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Gestion des plans et tâches
- Avant de coder une nouvelle fonctionnalité, rédige et sauvegarde le plan d'exécution détaillé dans `PLAN.md`.
- Mets à jour `PLAN.md` en cochant les étapes terminées (`[x]`) au fur et à mesure.
- Lis toujours `PLAN.md` au début d'une session pour reprendre le travail en cours.


## What this is

"Replay": a fully local web app (pure HTML/CSS/JS) that replays geolocated videos, photos and moving-object tracks on a time-synchronised timeline + Leaflet map. It must run by **double-clicking `index.html` (`file://`) from a USB stick, offline, on any computer**. UI text and code comments are in French. See `README.md` for user-facing usage and the data model.

## Hard constraints (do not break)

- **No build step, no npm dependencies at runtime, no CDN.** Third-party libs are vendored in `vendor/` (Leaflet 1.9.4, exifr 7.1.3 lite UMD, topojson-client, world-atlas countries-50m wrapped as `window.WORLD_TOPO = …`).
- **No ES modules and no `fetch()` of local files** — both fail under `file://` in Chrome. All JS files are classic `<script>` tags attaching to the global namespace `window.RP`; load order in `index.html` matters (`util` → `model` → `storage` → `metadata` → `basemap` → `map` → `timeline` → `player` → `panels` → `events` → `editor` → `app`). Embedded data must be a `.js` file assigning a global.
- `tiles/config.js` must always exist (it sets `window.LOCAL_TILES = null` by default) so the script tag never 404s.
- Media files are accessed only through `File` objects (File System Access API directory handle, or `<input webkitdirectory>` fallback) and `URL.createObjectURL`.

## Running / testing

There are no build, lint or test commands. Open `index.html` directly to use it.

For automated checks in a browser pane, `file://` pages may render as static snapshots, so serve the folder over HTTP with any static server that supports Range requests (needed for video seeking), then drive it via JS. Folder pickers cannot be automated; instead load data programmatically:

```js
// build {name, path, file} entries from fetched blobs, then:
await RP.app.loadFolder({ files, project /* replay.json array or null */, name: 'test' });
// writable path can be tested with an OPFS handle:
const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('demo', { create: true });
await RP.app.loadFolder(await RP.storage.openHandle(dir));
```

`medias/` holds demo data (ffmpeg-generated `camera-01.mp4`, `camera-02.mov` with `©xyz` GPS + creation_time, photos, and `replay.json`). Opening it read-write in the real app will rewrite `medias/replay.json` (auto-extracted entries get added).

## Architecture

**Data flow.** `storage` returns `{files, project, name}` → `app.loadFolder` builds the model: entries from `replay.json` (or, if absent, any root `.json` that looks like the model, e.g. `data models.json`), then `metadata.extract` for unreferenced media, then probes missing video durations → `rebuild()` (map, timeline, player range, editor list). Saving is debounced in `app.js` and writes `replay.json` via `storage.save` unless `storage.readOnly`.

**Model (`js/model.js`).** Two views of the same data:
- `M.roots`: top-level nodes in JSON order (`camera`, standalone `image`, `moving-object`), used by `serialize()`.
- `M.items`: a **flat list of playable items** (each video, image, moving object). Player, timeline and panels only work on this list via `tStart`/`tEnd`.

Each runtime item wraps the untouched JSON object in `item.raw`, plus derived fields from `compute()`:
- `tStart`/`tEnd` (ms epoch, `offset` seconds applied), `pos`, `track` (sorted, ms), `missing[]`, `timed`;
- `file`: the `File` object, never serialized.

Always mutate through `RP.model.update(id, patch)`, which works for any id including cameras. A null or `''` value deletes the key; it emits `model:changed`.

Types:
- `camera` is a **container of 1..n medias**: `{position, applyPosition, medias: [{type: 'video'|'image', ...}]}`. Images inside a camera are screenshots of its videos and are treated as sequences. Runtime camera nodes hold `medias` (sorted by time) plus derived `videos` / `images`; each media has `item.camera` and `item.seq`, numbered across videos and images together. `computeCamera()` recomputes children and aggregates `missing`.
  - Effective position of any camera media: `applyPosition ? camera.pos : (ownPos || camera.pos)`; `posFrom` (`own`/`camera`) records which one was used.
  - Migrations in `M.add`: a v1 camera `videos: [...]` becomes `medias`; a legacy top-level `type: "video"` becomes a one-video camera (video id `<id>-1`).
  - `M.moveMedia(id, cameraId | null | M.NONE)` (alias `moveVideo`) re-parents a media; `null` = new camera, and `M.NONE` detaches an image as a standalone photo (videos always stay in a camera). A camera left empty is deleted; emits `model:rebuilt`.
- Videos (`start`, `duration`, own `position`) without a duration get a 30 s placeholder window and are flagged missing.
- `image` (`time`, `display` default 10 s, `position`); `moving-object` (`track[]`).
- `event` (top level): a scene description with `title`, `description`, `time`, `duration` (default 15 s) and an optional `position`. Missing fields flagged: `time`, `description`. Events are ordinary playable items in `M.items`, so they get `media:enter`/`media:exit`. `M.createEvent(t, props)` and `M.remove(id)` (events only) both emit `model:rebuilt`.

Manual edits set `raw.meta.source[field] = 'manuel'`. `M.add(raw, resolveFile)` takes a function `(raw) => File`. In `app.js`, unreferenced videos and images are grouped one camera per sub-folder; a video at the root gets its own camera, and an image at the root stays standalone.

**Event bus (`RP.bus`).** Modules communicate through events rather than direct calls where possible:
- `tick` `{t, playing, rate, seeked}` — every processed frame
- `media:enter` / `media:exit` — emitted by the player when the active set changes
- `seek` (timeline → player), `item:click` (map marker), `item:focus` (media window), `mute`
- `model:changed` `{id}` / `model:rebuilt` — handled centrally in `app.js`, which refreshes map item, timeline, player range, panels and editor, then schedules a save

**Player (`js/player.js`)** is the master clock. `requestAnimationFrame` only advances `t` while playing; all state recomputation lives in `process()`, which `seek()`/`refresh()` also call **synchronously** (so behaviour doesn't depend on rAF, which is suspended in hidden tabs). `process()` diffs `model.activeAt(t)` against the previous `activeIds` to emit enter/exit, then updates timeline, map and playbar.

**Panels (`js/panels.js`)** implement the key requirement: a media window opens automatically when the playhead reaches its `start` and closes at its `end`, for playback and any seek. Video windows are keyed by **camera id**: one window per camera swaps its source when the next video sequence enters, and closes only when no video of that camera is active. Camera captures (images) keep their own window keyed by image id, titled with the camera name. `PN.rebuild()` reopens windows after `model:rebuilt`. Manual ✕ adds the current sequence id to `dismissed` until the next exit; 📌 pin keeps it open past the end. Video elements are slaved to the clock on each `tick` (re-seek when drift exceeds a rate-dependent threshold, `playbackRate` clamped to 0.0625–16); object URLs are revoked on close.

**Events (`js/events.js`)** renders active events as stacked "subtitle" cards in `#events-zone`, above the playbar and centred between the map tools and the media dock. At most 3 cards are visible, then "+n". Each card has a remaining-time bar updated on `tick`, and a click opens the event in the editor. Creation goes through `RP.editor.addEvent()`, triggered by the playbar ⚑+ button, the E key or "＋ Évènement" in the drawer. The toast now appears under the timeline so it never covers the cards.

**Timeline (`js/timeline.js`)** is a single canvas plus an overview canvas: lanes per type (an "Évènements" lane at the top with ⚑ pictograms and duration bars; one row per camera in the video lane, with its captures drawn as diamonds on it; the Photos lane only shows standalone images; greedy row stacking for the others; canvas height grows with row count), adaptive tick steps aligned to local time, wheel zoom around the cursor, drag pan, click = `seek` event.

**Editor (`js/editor.js`)** is the "Médias" drawer, with the tree list (cameras → medias) on top and the detail form below.
- **HTML5 drag & drop**: video, image and standalone-photo rows can be dragged. They drop onto any row of a camera, or onto the temporary zones "Nouvelle caméra" / "Photo indépendante" appended while dragging. Dropping calls `M.moveMedia`.
- `E.play(id)`: the per-row button. For a video or image it opens `RP.panels.preview(id)`, an **isolated modal viewer** independent of the master clock: it pauses the player, leaves the playhead and the other windows untouched, and timeline keyboard shortcuts are ignored while it is open. Cameras have no button. Moving objects keep ▶/⏸, which seeks and plays the timeline.
- `E.deselect()`: the ✕ button of the detail zone.

**Map (`js/map.js`, `js/basemap.js`).** Marks are keyed per node, and each holds `ids` (the playable items it represents). A camera's medias (videos and captures) are grouped by effective position: one group gives one marker keyed by the camera id, otherwise there is one marker per group. Dragging a camera marker updates the camera position and/or the videos' own positions. Markers are `divIcon`s whose classes (`active`/`inactive`/`selected`) are toggled only when state changes. Moving objects get an interpolated position (`model.positionAt`), a heading arrow and a "travelled" polyline. Basemap is hybrid: the Natural Earth vector layer always sits in a custom pane below `tilePane` (z 150) so tiles cover it; online layers (Esri street map default, OSM, Esri satellite) are added only after an image probe succeeds; local XYZ tiles come from `window.LOCAL_TILES`. CARTO was dropped because it now requires an API key, and OSM tiles may be refused without a Referer under `file://`.

**Metadata (`js/metadata.js`).** Hand-written MP4/MOV atom walker (reads only the `moov` box via `File.slice`): `mvhd` creation time/duration, `udta/©xyz` ISO 6709 GPS, QuickTime `meta/keys/ilst` (`location.ISO6709`, `creationdate`). Photos use `exifr` (date parsed from raw strings with `OffsetTimeOriginal` when present; GPS via `exifr.gps`). Fallback: date regex on the filename (local time). GPX → `moving-object`.

**Times.** Stored as ISO UTC strings in JSON; displayed and edited in the browser's local timezone (`Intl` `fr-FR`); `util.toLocalInput`/`fromLocalInput` convert for `datetime-local` inputs.
