/*
 * Tuiles locales (optionnel) — pour un fond de carte détaillé sans Internet.
 *
 * 1. Déposez vos tuiles dans ce dossier selon l'arborescence  tiles/{z}/{x}/{y}.png
 *    (format « XYZ / slippy map », par ex. exporté avec MOBAC, QGIS « Générer des tuiles XYZ », etc.)
 * 2. Remplacez la ligne ci-dessous par une configuration, par exemple :
 *
 *    window.LOCAL_TILES = {
 *      minZoom: 5,
 *      maxZoom: 17,                               // zoom max disponible dans le dossier
 *      ext: 'png',                                // ou 'jpg'
 *      bounds: [[46.9, 7.2], [47.3, 7.7]],        // [[sud, ouest], [nord, est]] (optionnel)
 *      attribution: '© OpenStreetMap contributors'
 *    };
 */
window.LOCAL_TILES = null;
