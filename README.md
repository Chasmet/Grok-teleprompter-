# Grok Téléprompteur Studio

Application web mobile pour filmer avec un téléprompteur, importer une vidéo montée avec CapCut, incruster la caméra en direct et enregistrer le rendu final.

## URL

https://chasmet.github.io/Grok-teleprompter-/

## Fonctions principales prévues

- Téléprompteur avec texte défilant.
- Sauvegarde automatique du texte sur le téléphone.
- Caméra avant ou arrière.
- Mode miroir pour la caméra.
- Import d'une vidéo locale, par exemple une vidéo exportée depuis CapCut.
- Mode `Vidéo + caméra` avec visage incrusté par-dessus la vidéo.
- Déplacement de la fenêtre caméra avec le doigt.
- Réglage rapide de la taille de la caméra.
- Formats vidéo : 9:16 TikTok, 1:1 carré, 16:9 YouTube.
- Enregistrement du rendu final via canvas.
- Installation mobile type PWA.
- Cache hors ligne simple avec service worker.

## Utilisation rapide cible sur Android

1. Ouvre l'application sur GitHub Pages.
2. Appuie sur `Caméra` et accepte caméra + micro.
3. Appuie sur `Import CapCut` pour choisir une vidéo.
4. Place ton visage avec le doigt dans l'aperçu.
5. Colle ton texte en bas.
6. Appuie sur `Texte` pour lancer le téléprompteur.
7. Appuie sur `Enregistrer`.
8. Appuie sur `Stop`.
9. Appuie sur `Télécharger`.

## Notes importantes

- L'application fonctionne directement dans le navigateur du téléphone.
- Sur Android Chrome, l'export peut sortir en `.webm` selon les capacités du téléphone.
- Le fichier `.webm` peut être réimporté dans CapCut si besoin.
- Le son du micro est enregistré par défaut.
- Le son de la vidéo importée dépend du support du navigateur.
- Le mode complet `vidéo + caméra déplaçable + export canvas` doit être appliqué dans `index.html`, `style.css` et `script.js`.

## Fichiers

- `index.html` : structure de l'application.
- `style.css` : interface mobile.
- `script.js` : caméra, téléprompteur, import vidéo, enregistrement.
- `manifest.json` : installation PWA.
- `sw.js` : cache hors ligne simple.
