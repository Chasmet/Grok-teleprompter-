# Grok Téléprompteur Studio

Application mobile pour filmer avec un téléprompteur, importer une vidéo ou une image, ajouter une facecam et enregistrer un rendu prêt pour les réseaux sociaux.

## Versions disponibles

- Application web : https://chasmet.github.io/Grok-teleprompter-/
- APK Android : construit automatiquement par GitHub Actions dans l’artefact `Grok-Teleprompter-APK`.

## Fonctions

- Mode caméra live vertical.
- Mode vidéo ou image importée.
- Mode vidéo + facecam déplaçable et redimensionnable.
- Téléprompteur avec vitesse et taille réglables.
- Sauvegarde automatique du texte sur le téléphone.
- Caméra avant ou arrière et miroir réglable.
- Zoom et déplacement du média importé, reproduits dans l’export.
- Export 1080p haute qualité ou 720p fluide.
- Son du média importé activable.
- Écran maintenu allumé pendant l’enregistrement.

## Audio haute qualité

Le mode `Voix studio`, activé par défaut, demande une capture 48 kHz et applique :

- réduction du bruit et de l’écho ;
- contrôle automatique du gain ;
- filtre des graves parasites ;
- amélioration légère de la présence vocale ;
- compression douce et limiteur anti-saturation ;
- débit cible de 256 kb/s.

Deux autres profils sont disponibles : `Voix naturelle` et `Musique / chant`. Les paramètres réellement acceptés peuvent varier selon le micro et la version Android.

## APK Android

L’APK contient l’application web dans ses propres ressources et fonctionne sans dépendre de GitHub Pages. La partie native fournit :

- les permissions caméra et microphone ;
- le sélecteur Android pour importer une vidéo ou une image ;
- une origine HTTPS locale sécurisée pour la caméra du WebView ;
- l’enregistrement par blocs des grosses vidéos, sans charger tout le fichier en mémoire native ;
- la sauvegarde directe dans `Films/Grok Teleprompteur` via MediaStore.

Configuration : Android 10 minimum, Android SDK 36, Java 17, Gradle 8.13 et Android Gradle Plugin 8.13.2.

## Construction

Le workflow `.github/workflows/build-apk.yml` lance automatiquement :

1. la vérification syntaxique de JavaScript ;
2. Android Lint ;
3. la compilation de l’APK de test ;
4. la publication de `Grok-Teleprompter-v2.0.0.apk` comme artefact téléchargeable.

## Structure utile

- `index.html` : interface mobile.
- `style.css` : design responsive.
- `script.js` : caméra, audio, téléprompteur, composition et export.
- `manifest.json` et `sw.js` : installation PWA et cache hors ligne.
- `app/` : enveloppe Android native.
- `.github/workflows/build-apk.yml` : construction automatique de l’APK.
