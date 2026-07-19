# Audit complet — Grok Téléprompteur Studio 2.8.0

Date : 19 juillet 2026

## Résultat

L’audit a porté sur l’interface mobile, le cycle caméra/micro du WebView Android, les gestes tactiles, le téléprompteur, l’import des médias, la composition vidéo, l’enregistrement audio/vidéo, la sauvegarde Android et la chaîne de compilation.

## Défauts constatés et corrections

| Zone | Défaut constaté | Gravité | Correction 2.8.0 |
|---|---|---:|---|
| Caméra Android | Caméra et micro demandés dans un même appel, source fréquente de `NotReadableError` sur certains WebView | Critique | Ouverture vidéo seule, puis ouverture du micro séparée |
| Caméra Android | Une seule stratégie de contraintes vidéo | Élevée | Replis progressifs 1080/720, contraintes simples et essais par périphérique |
| Caméra Android | Caméra pas toujours libérée lors du passage en arrière-plan | Élevée | Arrêt des pistes en arrière-plan et réouverture au retour |
| Autorisations | Erreur brève et tronquée, sans solution durable | Élevée | Panneau d’aide persistant, bouton Réessayer et accès aux réglages Android |
| Facecam | Déplacement à un doigt seulement, sans redimensionnement tactile | Élevée | Glisser, pincer à deux doigts et poignée de redimensionnement |
| Facecam | Position non mémorisée | Moyenne | Sauvegarde locale de la position et de la taille |
| Format vidéo | Le choix 9:16 / 16:9 avait été appliqué par erreur à toute la vidéo | Critique | Retour au format automatique du média importé ; le sélecteur agit uniquement sur la forme de la fenêtre webcam |
| Téléprompteur | Cadre fixe, impossible à déplacer ou redimensionner | Élevée | Glisser, pincer, poignée et boutons haut/bas/taille |
| Téléprompteur | Défilement lancé même si le texte tient dans le cadre | Élevée | Mesure réelle du contenu ; texte court centré et fixe |
| Téléprompteur | Texte d’accueil visible sous le prompt | Élevée | Masquage systématique du texte d’accueil dès qu’un prompt est affiché |
| Téléprompteur | Réglages perdus au redémarrage | Moyenne | Sauvegarde du cadre, de la taille, de la vitesse et du miroir |
| Audio | Changement de profil audio redémarrait aussi la caméra | Moyenne | Redémarrage du micro uniquement, sans interrompre l’image |
| Audio | VU-mètre parfois relié au flux vidéo sans audio | Moyenne | Priorité explicite au flux microphone séparé |
| Audio | Lors d’un échec micro, le son de la vidéo pouvait être utilisé sans explication | Critique | Avertissement explicite ; le choix Son vidéo ON/OFF reste respecté |
| Enregistrement | Le bouton ne lançait rien lorsque le micro était occupé ou refusé | Critique | Suppression du verrou : démarrage vidéo garanti, avertissement clair et repli vers son du média ou vidéo muette |
| Enregistrement | La préparation audio pouvait donner l’impression d’un bouton figé | Élevée | État visible « Préparation… » et protection contre les doubles appuis |
| Compatibilité | Un type de fichier avec codec audio pouvait être choisi pour une vidéo sans piste audio | Élevée | Liste de codecs adaptée à la présence réelle d’audio et essais successifs de formats |
| Audio | Volume du micro et de la vidéo non réglables séparément | Élevée | Mixeur tactile micro 0–200 % et vidéo 0–100 %, avec ON/OFF indépendants |
| Audio | Son importé trop présent par défaut | Élevée | Son de la vidéo coupé par défaut et micro réglé à 130 % |
| Audio Android | Permissions accordées mais `NotReadableError` persistant dans certains WebView/OEM | Critique | Repli automatique vers `AudioRecord` Android natif, mono PCM 16 bits à 48 kHz, sans couper la caméra |
| Audio Android | Raccords secs et clics entre les blocs PCM transmis par le pont natif | Critique | Tampon continu `AudioWorklet` avec précharge, lissages d’entrée/sortie et protection contre les retards |
| Audio Android | Voix trop poussée, crêtes à 0 dB et traitement agressif dans l’enregistrement réel fourni | Critique | Gain ramené à un niveau naturel, compression plus douce et marge de sécurité anti-saturation |
| Audio Android | Grésillement régulier aux frontières des trames de 10 ms | Critique | Retrait du `NoiseSuppressor` et priorité à la source brute `UNPROCESSED`, puis `VOICE_RECOGNITION` ; la source caméscope traitée par le constructeur devient le dernier recours |
| Audio Android | La jauge ouvrait un second graphe audio et le canvas dessinait plus vite que les 30 i/s enregistrées | Critique | Niveau RMS calculé dans les blocs PCM natifs, jauge sans seconde chaîne et inactive pendant l’enregistrement ; composition verrouillée à 30 i/s |
| Commandes | Lecture/Pause et caméra secondaire actives sans source valable | Moyenne | États désactivés synchronisés avec la disponibilité réelle |
| Cycle Android | Absence d’accès direct à la fiche de l’application | Moyenne | Pont natif vers les réglages de l’application |
| Téléchargement | Action finale encore nommée « Enregistrer » | Faible | Bouton explicite « Télécharger la vidéo » et progression de téléchargement |

## Qualité audio

Le profil « Voix studio HD » demande une capture 48 kHz mono. Si WebView refuse cette capture malgré l’autorisation Android, l’application ouvre directement `AudioRecord`, en priorité avec la source brute `UNPROCESSED`, puis `VOICE_RECOGNITION`, et transmet le PCM 16 bits à un tampon audio continu. La source `CAMCORDER` n’est plus qu’un dernier recours. Aucun effet `NoiseSuppressor` supplémentaire n’est attaché au flux natif : l’échantillon réel présente ses plus fortes discontinuités exactement toutes les 10 ms, signature d’un traitement audio Android découpé par trames. Le niveau de la jauge est calculé dans ces mêmes blocs et envoyé au maximum dix fois par seconde, sans dupliquer le flux audio. Pendant l’enregistrement, l’analyse de niveau est coupée et le canvas est cadencé à 30 i/s. Le traitement WebAudio conserve un coupe-bas léger, une présence vocale modérée, une compression douce, un limiteur et une marge de sortie anti-saturation, avec un débit cible de 256 kb/s.

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
| Refus du micro | Test confirmant le démarrage de la vidéo sans piste micro |
| Échec micro WebView | Test confirmant le basculement vers le flux Android natif 48 kHz |
| Continuité du flux natif | Inspection automatisée du tampon audio et de ses fondus anti-clics |
| Mixeur audio | Test des interrupteurs et barres tactiles indépendantes |
| Déplacement/redimensionnement facecam | Test de gestes pointeur |
| Format automatique du média | Test confirmant que le cadre vidéo conserve le ratio du fichier importé |
| Webcam verticale/horizontale | Test des ratios 9:16 et 16:9 de la seule fenêtre facecam et de la persistance du choix |
| Jauge sans doublage audio | Contrôle statique de l’absence d’analyseur dans la chaîne d’enregistrement et du niveau natif direct |
| Enregistrement et production d’un fichier | Test MediaRecorder + canvas |
| Syntaxe JavaScript | `node --check` |
| Projet Android | Android Lint + compilation APK |

## Validation matérielle recommandée

Les tests automatisés utilisent des périphériques caméra/micro simulés. Une dernière vérification sur le téléphone concerné reste recommandée pour confirmer le pilote caméra du constructeur, le changement avant/arrière, le niveau sonore réel, l’écoute du fichier exporté et l’accès à `Films/Grok Teleprompteur`.
