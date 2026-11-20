# Replay — vidéos et photos géolocalisées, synchronisées dans le temps

Application web 100 % locale (HTML/CSS/JavaScript, aucune installation, aucun serveur).
Copiez le dossier entier sur une clé USB et double-cliquez sur **`index.html`**.

## Utilisation
1. **Choisir le dossier de médias** (par ex. `medias/` à côté de `index.html`, qui contient une démo).
2. L'application lit `replay.json` s'il existe, sinon reprend un fichier `.json` au format du modèle trouvé à la racine du dossier
   (ex. `data models.json`), puis analyse les fichiers non référencés :
   - photos : date + GPS EXIF ;
   - vidéos MP4/MOV : date de création et GPS (atomes `mvhd`, `©xyz`, métadonnées QuickTime), durée ;
   - traces `.gpx` → objets mobiles ;
   - à défaut, date déduite du nom de fichier (`VID_20260824_143000.mp4`…).
3. Bouton ☰ (badge orange = médias incomplets) : compléter date, position (clic sur la carte ou repère déplaçable), durée,
   décalage d'horloge. Les modifications sont **enregistrées automatiquement dans `replay.json`** du dossier.
4. Lecture : les fenêtres vidéo/photo **s'ouvrent automatiquement à leur début et se ferment à leur fin**.
   📌 épingle une fenêtre, ✕ la ferme jusqu'au prochain passage ; glisser l'en-tête la détache (double-clic pour la réancrer).

**Raccourcis** : Espace lecture/pause · ←/→ ±10 s · Maj+←/→ évènement précédent/suivant · +/− zoom timeline ·
`,` / `.` vitesse · M son · Origine/Fin.
**Timeline** : molette = zoom, glisser = déplacer, clic = aller à l'instant, double-clic = toute la période.

## Navigateurs
| | Lecture | Enregistrement direct de `replay.json` |
|---|---|---|
| Chrome / Edge | ✓ | ✓ (File System Access API) |
| Firefox / Safari | ✓ (mode lecture seule) | via le bouton **Exporter** |

Formats vidéo lisibles : ceux du navigateur (MP4 H.264, WebM ; HEVC selon la machine).

## Fond de carte hors ligne
- **En ligne** : plan Esri, OpenStreetMap ou satellite (menu ◇ de la carte).
- **Hors ligne** : fond vectoriel embarqué (Natural Earth, frontières et côtes).
- **Tuiles locales** (détaillées, hors ligne) : déposez des tuiles XYZ dans `tiles/{z}/{x}/{y}.png`
  et renseignez `tiles/config.js` (instructions dans le fichier).

## Modèle de données (`replay.json`)
Tableau d'objets ; champs optionnels ajoutés par l'application en *italique* :
```json
[
  { "id": "vehicle-001", "type": "moving-object", "name": "Véhicule A",
    "track": [ { "time": "2026-08-24T14:30:00Z", "lat": 47.123, "lon": 7.456 } ] },
  { "id": "camera-01", "type": "camera", "name": "Caméra 01",
    "position": { "lat": 47.123, "lon": 7.456 }, "applyPosition": true,
    "videos": [
      { "id": "camera-01-1", "file": "camera-01.mp4", "start": "2026-08-24T14:30:00Z", "duration": 90, "offset": 0 },
      { "id": "camera-01-2", "file": "camera-01/seq2.mp4", "start": "2026-08-24T14:33:00Z", "duration": 45,
        "position": { "lat": 47.124, "lon": 7.457 } } ] },
  { "id": "photo-17", "type": "image", "time": "2026-08-24T14:32:14Z",
    "position": { "lat": 47.125, "lon": 7.461 }, "file": "photo-17.jpg", "display": 10 }
]
```
- **Caméra** = conteneur de 1 à n vidéos (séquences d'une même caméra). Une seule fenêtre, une ligne de timeline et un repère
  par caméra ; la fenêtre enchaîne les séquences.
  - `applyPosition: true` : toutes les vidéos sont placées à la `position` de la caméra (leurs positions propres sont conservées mais ignorées).
  - `applyPosition: false` : chaque vidéo utilise sa `position` propre, à défaut celle de la caméra (un repère par position distincte).
  - Vidéos non référencées : un **sous-dossier = une caméra** (ex. `medias/camera-03/*.mp4`), une vidéo à la racine = sa propre caméra.
    Une vidéo se déplace vers une autre caméra depuis l'éditeur ; une caméra vidée est supprimée.
  - L'ancien format (`"type": "video"` au premier niveau) est converti automatiquement en caméra à une séquence.
- *`duration`* (s) : durée vidéo, lue dans le fichier ; *`display`* (s) : durée d'affichage d'une photo (10 par défaut) ;
- *`offset`* (s) : correction d'horloge de l'appareil ; *`notes`* ; *`meta.source`* : origine de chaque valeur (exif, mp4, manuel…).

## Structure
```
index.html, css/app.css
js/  util · model · storage · metadata · basemap · map · timeline · player · panels · editor · app
vendor/  Leaflet 1.9.4, exifr 7.1.3 (lite), topojson-client 3.1.0, world-atlas 2.0.2 (Natural Earth 50m)
tiles/   tuiles locales optionnelles
medias/  démonstration
```
