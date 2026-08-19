# Grok Téléprompteur Studio

Application mobile pour filmer avec un téléprompteur, importer une vidéo ou une image, ajouter une facecam et enregistrer un rendu prêt pour les réseaux sociaux.

## Versions disponibles

- Application web : https://chasmet.github.io/Grok-teleprompter-/
- APK Android : construit automatiquement par GitHub Actions dans l’artefact `Grok-Teleprompter-APK`.

## Fonctions

- Mode caméra live vertical ; les vidéos et images importées conservent automatiquement leur propre format.
- Mode vidéo ou image importée.
- Téléprompteur disponible en mode vidéo importée pour enregistrer une voix off sans caméra ; le texte reste un guide à l’écran et n’est jamais incrusté dans le fichier final.
- Mode vidéo + facecam déplaçable et redimensionnable.
- Détourage IA natif de la caméra dans les modes Live et Facecam ; les médias importés restent strictement intacts.
- Le canvas donné à l'encodeur n'utilise jamais la caméra brute lorsque le détourage est activé : l'enregistrement attend le premier masque puis encode uniquement la silhouette déjà aplatie.
- Caméra affichée en continu à 30 i/s pendant que le masque IA est calculé séparément, pour éviter que l’image se fige.
- Facecam tactile : glisser, pincer ou tirer la poignée de redimensionnement.
- Déplacement et pincement disponibles pendant REC ; les gestes sont directement reproduits dans la vidéo finale.
- Contours stabilisés selon le mouvement pour calmer les cheveux sans laisser de silhouette fantôme.
- Orientation de la fenêtre facecam au choix : verticale 9:16 ou paysage 16:9, sans modifier la vidéo de fond ni le fichier final.
- Téléprompteur tactile : position et cadre réglables directement dans l’aperçu.
- Texte court fixe ; défilement automatique uniquement lorsque le texte dépasse le cadre.
- Sauvegarde automatique du texte sur le téléphone.
- Sauvegarde automatique des positions, tailles, vitesse et préférences.
- Caméra avant ou arrière et miroir réglable.
- Zoom et déplacement du média importé, reproduits dans l’export.
- Informations claires sur le média importé et message utile si son codec est illisible.
- Une vidéo importée repart du début et arrête automatiquement le tournage lorsqu’elle se termine.
- Export 1080p haute qualité ou 720p fluide.
- Mixeur tactile séparé : micro 0–200 % et son du média 0–100 %.
- Micro prioritaire et son du média importé coupé par défaut.
- Enregistrement toujours disponible : si le micro est occupé ou refusé, la vidéo démarre avec le son du média activé ou sans son.
- Bouton final explicite « Télécharger la vidéo », avec sauvegarde dans Films/Grok Téléprompteur.
- Protection d’une prise non téléchargée, avec action séparée « Refaire une prise ».
- Arrêt propre et récupération de la vidéo si l’application passe en arrière-plan pendant le tournage.
- Écran maintenu allumé pendant l’enregistrement.

## Audio haute qualité

Le mode `Voix studio`, activé par défaut, demande une capture 48 kHz et applique :

- réduction du bruit et de l’écho ;
- gain maîtrisé sans amplification automatique forcée ;
- filtre des graves parasites ;
- amélioration légère de la présence vocale ;
- compression douce et limiteur anti-saturation ;
- débit cible de 256 kb/s.

Deux autres profils sont disponibles : `Voix naturelle` et `Musique / chant`. Les paramètres réellement acceptés peuvent varier selon le micro et la version Android.

Le bouton `Activer / tester le micro` et le VU-mètre permettent de confirmer la présence de la voix avant de filmer. Dans l’APK Android, l’application n’essaie plus le micro WebView : elle ouvre exclusivement la source native `CAMCORDER`, celle prévue par Android pour filmer. La jauge lit le niveau RMS de ce même flux, sans ouvrir une seconde chaîne audio, et reste désactivée pendant le tournage. Le micro caméra mono 48 kHz est envoyé directement à `MediaRecorder`. Le son de la vidéo importée peut être mélangé dans ce même contexte et possède son propre interrupteur et son propre volume d’enregistrement.

## APK Android

L’APK contient l’application web dans ses propres ressources et fonctionne sans dépendre de GitHub Pages. La partie native fournit :

- les permissions caméra et microphone ;
- le sélecteur Android pour importer une vidéo ou une image ;
- une origine HTTPS locale sécurisée pour la caméra du WebView ;
- des demandes caméra et micro séparées avec plusieurs niveaux de repli ;
- un secours microphone Android natif mono 48 kHz si le moteur WebView refuse l’entrée audio ;
- un tampon audio exécuté sur le thread sonore pour supprimer les clics et coupures entre blocs ;
- des blocs PCM de 40 ms, exactement alignés sur quatre trames Android/WebRTC de 10 ms ;
- un raccord adaptatif de 1 ms uniquement lorsqu’un saut anormal est détecté à une frontière de trame ;
- un seul contexte audio du micro natif jusqu’à l’encodeur AAC, y compris lorsque le son du média est mélangé ;
- une jauge limitée à 10 mesures par seconde et un rendu vidéo limité à 30 images par seconde pour protéger le thread audio ;
- un masque de silhouette natif à faible résolution, affiné hors du thread d’interface puis appliqué par le canvas accéléré ;
- la source Android `CAMCORDER` exclusivement : aucun micro WebView, `MIC`, `UNPROCESSED` ou reconnaissance vocale dans l’APK ;
- une aide persistante et un accès direct aux autorisations Android en cas d’échec ;
- l’enregistrement par blocs des grosses vidéos, sans charger tout le fichier en mémoire native ;
- la sauvegarde directe dans `Films/Grok Teleprompteur` via MediaStore.

Configuration : Android 10 minimum, Android SDK 36, Java 17, Gradle 8.13 et Android Gradle Plugin 8.13.2.

## Construction

Le workflow `.github/workflows/build-apk.yml` lance automatiquement :

1. la vérification syntaxique de JavaScript ;
2. l’audit statique des autorisations, éléments tactiles et règles du téléprompteur ;
3. les tests fonctionnels mobiles Chromium (média, caméra/micro simulés, gestes et enregistrement) ;
4. Android Lint ;
5. la compilation de l’APK de test ;
6. la publication de `Grok-Teleprompter-v2.14.1.apk` comme artefact téléchargeable.

## Structure utile

- `index.html` : interface mobile.
- `style.css` : design responsive.
- `script.js` : caméra, audio, téléprompteur, composition et export.
- `manifest.json` et `sw.js` : installation PWA et cache hors ligne.
- `app/` : enveloppe Android native.
- `.github/workflows/build-apk.yml` : construction automatique de l’APK.
- `AUDIT.md` : défauts relevés, corrections et matrice de validation.
- `tests/` : audit statique et scénarios fonctionnels mobiles.
