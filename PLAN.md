# PLAN — Caméra = conteneur de 1 à n vidéos

Objectif : une caméra regroupe plusieurs séquences vidéo. On peut définir sa position GPS et choisir de l'appliquer à toutes ses vidéos (`applyPosition`). Le reste du fonctionnement ne change pas.

Décisions :
- position décochée → la vidéo garde sa position propre, sinon elle hérite de la caméra ;
- une fenêtre, une ligne timeline et un repère par caméra (un repère par position distincte si nécessaire) ;
- regroupement automatique par sous-dossier.

Format :
```json
{ "id": "camera-01", "type": "camera", "name": "Caméra 01",
  "position": { "lat": 47.123, "lon": 7.456 }, "applyPosition": true,
  "videos": [ { "id": "camera-01-1", "file": "camera-01.mp4", "start": "…", "duration": 90, "position": {…} } ] }
```
Les entrées historiques `type: "video"` sont migrées en caméra à 1 vidéo.

## Étapes
- [x] 1. Modèle (`js/model.js`)
  - [x] `M.roots` + `M.items` plat
  - [x] nœud caméra et `item.camera` / `item.seq`
  - [x] position effective
  - [x] migration `video` → `camera`
  - [x] `M.add(raw, resolveFile)`, `update` sur caméra/vidéo
  - [x] `moveVideo`, `cameraOf`, `serialize`
- [x] 2. Chargement (`js/app.js`)
  - [x] fichiers référencés imbriqués
  - [x] regroupement des vidéos par sous-dossier
  - [x] position et `applyPosition` par défaut
  - [x] sonde de durée des vidéos imbriquées
- [x] 3. Fenêtres (`js/panels.js`)
  - [x] une fenêtre par caméra, bascule de séquence
  - [x] fermeture quand plus aucune séquence n'est active
  - [x] en-tête « Séq. i/n »
- [x] 4. Carte (`js/map.js`)
  - [x] repères par caméra / groupe de position, `ids` multiples
  - [x] clic sur la séquence pertinente
  - [x] glisser → position de la caméra ou de la vidéo
- [x] 5. Timeline (`js/timeline.js`)
  - [x] une ligne par caméra, hauteur adaptative
  - [x] infobulle séquence
- [x] 6. Éditeur (`js/editor.js`, CSS)
  - [x] liste arborescente
  - [x] formulaire caméra avec « Appliquer à toutes les vidéos »
  - [x] formulaire vidéo avec menu « Caméra » et position héritée
  - [x] import
- [x] 7. Démo : `medias/camera-01/seq2.mp4` + `medias/replay.json` au nouveau format
- [x] 8. Docs : README.md, CLAUDE.md
- [x] 9. Vérification
  - [x] migration
  - [x] ouverture/fermeture des séquences
  - [x] `applyPosition`
  - [x] sous-dossiers
  - [x] déplacement d'une vidéo
  - [x] console sans erreur, affichage mobile
