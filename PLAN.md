# PLAN — Caméra = conteneur de vidéos ET de captures (images)

Historique :
- ✅ v1 — caméra = conteneur de 1..n vidéos (commit f987e1f).
- ✅ v2 — une caméra peut aussi contenir des images : des captures d'écran d'une vidéo, traitées comme des séquences.

Décisions :
- **Format** : liste unique `medias` (vidéos et images mêlées) ; l'ancien champ `videos` est converti automatiquement.
- **Affichage** : une capture garde sa **propre fenêtre** (comme une photo), titrée au nom de la caméra avec « Séq. i/n ». Les vidéos gardent la fenêtre unique de la caméra.
- **Position** : même règle que les vidéos (`applyPosition` → position de la caméra, sinon position propre, sinon héritée).
- **Numérotation** : les séquences sont numérotées ensemble (vidéos + captures), dans l'ordre chronologique.
- **Photos indépendantes** : elles restent possibles au premier niveau. Elles se rattachent à une caméra, et s'en détachent, depuis l'éditeur.

Format :
```json
{ "id": "camera-01", "type": "camera", "name": "Caméra 01",
  "position": { "lat": 47.123, "lon": 7.456 }, "applyPosition": true,
  "medias": [
    { "type": "video", "id": "camera-01-1", "file": "camera-01.mp4", "start": "…", "duration": 90 },
    { "type": "image", "id": "camera-01-c1", "file": "camera-01/capture.jpg", "time": "…", "display": 10 },
    { "type": "video", "id": "camera-01-2", "file": "camera-01/seq2.mp4", "start": "…" } ] }
```

## Étapes
- [x] 1. Modèle (`js/model.js`)
  - [x] `cam.medias` (vidéos + images) ; `cam.videos` dérivé
  - [x] position effective et `seq` sur tous les médias
  - [x] migration de `videos` (et de `type: "video"` au premier niveau) vers `medias`
  - [x] `serialize` écrit `medias`
  - [x] `moveMedia(id, cameraId | null | NONE)` : rattacher ou détacher une image (`moveVideo` conservé comme alias)
- [x] 2. Chargement (`js/app.js`) : images d'un sous-dossier → caméra du dossier ; images à la racine → indépendantes
- [x] 3. Fenêtres (`js/panels.js`) : capture = fenêtre propre, titre caméra + séquence
- [x] 4. Carte (`js/map.js`) : repères de caméra calculés sur tous ses médias
- [x] 5. Timeline (`js/timeline.js`) : captures en losanges sur la ligne de leur caméra, exclues de la lane Photos
- [x] 6. Éditeur (`js/editor.js`)
  - [x] arborescence des médias
  - [x] formulaire image avec menu « Caméra » (dont « Aucune »)
  - [x] position imposée / héritée
- [x] 7. Démo : capture `medias/camera-01/capture-143045.jpg` dans camera-01 ; `replay.json` au format `medias`
- [x] 8. Docs : README.md, CLAUDE.md
- [x] 9. Vérification
  - [x] migration `videos` → `medias`
  - [x] ouverture/fermeture de la fenêtre de la capture
  - [x] position imposée / héritée
  - [x] sous-dossier avec images
  - [x] rattacher / détacher une photo
  - [x] console sans erreur
