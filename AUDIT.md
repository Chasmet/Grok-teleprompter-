# Audit complet — Grok Téléprompteur Studio 2.2.0

Date : 18 juillet 2026

## Résultat

L’audit a porté sur l’interface mobile, le cycle caméra/micro du WebView Android, les gestes tactiles, le téléprompteur, l’import des médias, la composition vidéo, l’enregistrement audio/vidéo, la sauvegarde Android et la chaîne de compilation.

## Défauts constatés et corrections

| Zone | Défaut constaté | Gravité | Correction 2.1.0 |
|---|---|---:|---|
| Caméra Android | Caméra et micro demandés dans un même appel, source fréquente de `NotReadableError` sur certains WebView | Critique | Ouverture vidéo seule, puis ouverture du micro séparée |
| Caméra Android | Une seule stratégie de contraintes vidéo | Élevée | Replis progressifs 1080/720, contraintes simples et essais par périphérique |
| Caméra Android | Caméra pas toujours libérée lors du passage en arrière-plan | Élevée | Arrêt des pistes en arrière-plan et réouverture au retour |
| Autorisations | Erreur brève et tronquée, sans solution durable | Élevée | Panneau d’aide persistant, bouton Réessayer et accès aux réglages Android |
| Facecam | Déplacement à un doigt seulement, sans redimensionnement tactile | Élevée | Glisser, pincer à deux doigts et poignée de redimensionnement |
| Facecam | Position non mémorisée | Moyenne | Sauvegarde locale de la position et de la taille |
| Téléprompteur | Cadre fixe, impossible à déplacer ou redimensionner | Élevée | Glisser, pincer, poignée et boutons haut/bas/taille |
| Téléprompteur | Défilement lancé même si le texte tient dans le cadre | Élevée | Mesure réelle du contenu ; texte court centré et fixe |
| Téléprompteur | Texte d’accueil visible sous le prompt | Élevée | Masquage systématique du texte d’accueil dès qu’un prompt est affiché |
| Téléprompteur | Réglages perdus au redémarrage | Moyenne | Sauvegarde du cadre, de la taille, de la vitesse et du miroir |
| Audio | Changement de profil audio redémarrait aussi la caméra | Moyenne | Redémarrage du micro uniquement, sans interrompre l’image |
| Audio | VU-mètre parfois relié au flux vidéo sans audio | Moyenne | Priorité explicite au flux microphone séparé |
| Audio | L’enregistrement continuait avec le son de la vidéo lorsque le micro échouait | Critique | Enregistrement bloqué tant que le micro activé n’a pas de piste réelle |
| Audio | Volume du micro et de la vidéo non réglables séparément | Élevée | Mixeur tactile micro 0–200 % et vidéo 0–100 %, avec ON/OFF indépendants |
| Audio | Son importé trop présent par défaut | Élevée | Son de la vidéo coupé par défaut et micro réglé à 130 % |
| Commandes | Lecture/Pause et caméra secondaire actives sans source valable | Moyenne | États désactivés synchronisés avec la disponibilité réelle |
| Cycle Android | Absence d’accès direct à la fiche de l’application | Moyenne | Pont natif vers les réglages de l’application |

## Qualité audio

Le profil « Voix studio » demande une capture 48 kHz, mono, avec annulation d’écho, réduction de bruit et contrôle automatique du gain. Le traitement ajoute un coupe-bas, une légère présence vocale, une compression douce et un limiteur, avec un débit d’enregistrement cible de 256 kb/s. Les profils « Voix naturelle » et « Musique / chant » évitent un traitement excessif dans leurs usages respectifs.

La qualité finale reste limitée par le microphone, les traitements réellement acceptés par le constructeur Android et le codec fourni par le WebView.

## Matrice de validation automatique

| Fonction | Validation |
|---|---|
| Identifiants et commandes de l’interface | Audit statique anti-doublon |
| Autorisations Android caméra/micro | Inspection automatisée du manifeste |
| Séparation caméra et microphone | Inspection automatisée des appels média |
| Prompt court sans défilement | Test Chromium mobile |
| Prompt long avec défilement | Test Chromium mobile |
| Déplacement/redimensionnement du prompt | Test de gestes pointeur |
| Import d’image et états Lecture/Pause | Test Chromium mobile |
| Ouverture caméra + micro | Test avec périphériques média simulés |
| Refus du micro | Test confirmant le blocage de l’enregistrement vocal |
| Mixeur audio | Test des interrupteurs et barres tactiles indépendantes |
| Déplacement/redimensionnement facecam | Test de gestes pointeur |
| Enregistrement et production d’un fichier | Test MediaRecorder + canvas |
| Syntaxe JavaScript | `node --check` |
| Projet Android | Android Lint + compilation APK |

## Validation matérielle recommandée

Les tests automatisés utilisent des périphériques caméra/micro simulés. Une dernière vérification sur le téléphone concerné reste recommandée pour confirmer le pilote caméra du constructeur, le changement avant/arrière, le niveau sonore réel, l’écoute du fichier exporté et l’accès à `Films/Grok Teleprompteur`.
