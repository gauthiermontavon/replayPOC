# PLAN — Gestionnaire de médias

Historique :
- ✅ v1 — caméra = conteneur de 1..n vidéos (commit f987e1f).
- ✅ v2 — une caméra peut aussi contenir des images (captures d'écran de ses vidéos), traitées comme des séquences (commit 150f451).
- ✅ v3 — ergonomie du gestionnaire de médias (voir plus bas).
- ✅ v3.1 — aperçu isolé depuis le tiroir (voir plus bas).

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

---

# v3 — Ergonomie du gestionnaire de médias (tiroir « Médias », `js/editor.js` + CSS)

Décisions :
- **Glisser-déposer** : on peut faire glisser une vidéo ou une capture d'une caméra, ou une photo indépendante.
  - On la dépose sur une caméra (sa ligne ou l'un de ses médias) → `M.moveMedia(id, cameraId)`.
  - Pendant le glisser, des zones apparaissent en bas de la liste : « ＋ Nouvelle caméra », et pour une image « Photo indépendante » (`M.NONE`).
  - Les cibles valides sont surlignées. On ne peut pas déposer un média sur sa propre caméra.
- **Fermer le détail** : un bouton ✕ en haut à droite de la zone de détail désélectionne l'élément (le formulaire et la sélection sur la carte se masquent).
- **Lecture depuis la liste** : un bouton sur chaque ligne datée.
  - ▶ sur une vidéo, une caméra ou un objet mobile : se place au début et lance la lecture.
  - 👁 sur une image : se place à l'instant de la capture, en pause, et ouvre sa fenêtre.
  - Si l'élément est en cours de lecture, le bouton devient ⏸ (pause).

## Étapes
- [x] 1. PLAN.md
- [x] 2. Glisser-déposer
  - [x] lignes déplaçables
  - [x] cibles caméra
  - [x] zones « Nouvelle caméra » / « Photo indépendante »
  - [x] retour visuel
- [x] 3. Bouton ✕ de la zone de détail (`E.deselect()`)
- [x] 4. Boutons ▶ / 👁 / ⏸ par ligne, mis à jour avec l'état de lecture
- [x] 5. Vérification navigateur : déplacement par glisser, fermeture du détail, lecture depuis la liste, console sans erreur
- [x] 6. Docs : README.md, CLAUDE.md

---

# v3.1 — Aperçu isolé depuis le tiroir

Retour utilisateur :
- Un média lancé depuis le tiroir doit être vu **seul et isolé**. Ni la timeline, ni les autres médias ne doivent se lancer à la suite.
- Les images doivent avoir un bouton « Voir ».
- Le bouton de lecture du conteneur caméra est supprimé.

Décisions :
- Un **visionneur d'aperçu** modal s'ouvre, indépendant de l'horloge (`RP.panels.preview(id)`).
  - Vidéo : lecteur natif (contrôles, lecture automatique). Image : affichage plein cadre.
  - Titre : caméra et séquence, date et fichier.
  - Fermeture par ✕, Échap ou clic sur le fond.
  - La lecture de la timeline est mise en pause à l'ouverture, et ni la tête de lecture ni les autres fenêtres ne bougent.
- Liste : « ▶ Lire » sur les vidéos, « 👁 Voir » sur les images (caméra ou photo indépendante). Plus de bouton sur les caméras.
  - Les objets mobiles gardent ▶ : ils se placent sur la timeline et la lancent, car un aperçu isolé n'a pas de sens pour une trajectoire.
- Formulaire de détail d'une vidéo ou d'une image : bouton « ▶ Lire » ou « 👁 Voir » (aperçu), à côté de « Aller au début ».

## Étapes
- [x] 1. Visionneur d'aperçu (`index.html`, `js/panels.js`, CSS)
- [x] 2. Boutons de la liste et du formulaire (`js/editor.js`)
- [x] 3. Vérification : aperçu isolé (timeline en pause, aucune autre fenêtre ouverte), boutons, console sans erreur
- [x] 4. Docs : README.md, CLAUDE.md
