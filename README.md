# Carnet de pêche

Application web statique pour tenir un carnet de prises (carpes et autres poissons) : date, poids, taille, lieu, notes et photo. Hébergée entièrement sur GitHub Pages, sans aucun serveur.

## Fonctionnement

- Le site est 100 % statique (HTML/CSS/JS), servi par GitHub Pages.
- Les données (`data/prises.json`) sont lues et écrites **directement dans ton dépôt GitHub**, via l'API GitHub (Git Data API), depuis le navigateur.
- Les photos sont compressées côté navigateur puis encodées en base64 directement dans le fichier JSON — un seul fichier de données, pas de dossier d'images à gérer.
- Aucune base de données, aucun backend : le dépôt GitHub *est* la base de données.

## Sécurité — pourquoi personne d'autre ne peut écrire

Le site étant public (comme toute page GitHub Pages), l'écriture de nouvelles prises nécessite un jeton d'accès personnel (PAT) que **seul toi** dois posséder :

- Le jeton est saisi une fois dans l'appli et stocké uniquement dans le `localStorage` de ton navigateur.
- Il n'apparaît jamais dans le code source ni dans les fichiers du dépôt.
- Un visiteur qui ouvre le site n'a pas ce jeton : il peut au mieux consulter les données publiques du dépôt, mais ne peut rien enregistrer.

**Recommandation :** crée un jeton *fine-grained* (Settings → Developer settings → Personal access tokens → Fine-grained tokens) limité à ce seul dépôt, avec uniquement la permission **Contents: Read and write**. Évite les jetons "classic" à portée large.

## Mise en route

1. Crée un dépôt GitHub (public ou privé) et active GitHub Pages dessus (Settings → Pages → Deploy from branch).
2. Dépose les fichiers `index.html`, `style.css`, `app.js` à la racine (ou dans `/docs` selon ta config Pages).
3. Ouvre le site publié, renseigne dans l'écran de connexion :
   - **owner** : ton nom d'utilisateur GitHub
   - **repo** : le nom du dépôt
   - **branch** : la branche utilisée par Pages (souvent `main`)
   - **chemin du fichier** : `data/prises.json` par défaut (créé automatiquement au premier enregistrement)
   - **jeton** : ton fine-grained PAT
4. Ajoute ta première prise.

## Limite à connaître

Le fichier `data/prises.json` grossit à chaque photo ajoutée. Les photos sont compressées (largeur max ~900 px, qualité ~65 %) pour rester légères, mais si le carnet grossit beaucoup (des centaines de prises avec photo), il faudra un jour séparer les photos du fichier de métadonnées. Pas d'urgence à ce stade, juste à garder en tête.

## Installer l'icône sur iPhone (PWA)

L'application est une PWA (Progressive Web App) : sur iPhone, tu peux l'ajouter à l'écran d'accueil comme une vraie icône, qui s'ouvre en plein écran sans la barre d'adresse de Safari.

1. Ouvre le site avec **Safari** (obligatoire — Chrome sur iOS ne propose pas cette option).
2. Appuie sur l'icône de partage (le carré avec la flèche vers le haut).
3. Choisis "Sur l'écran d'accueil".
4. Confirme : l'icône du carnet apparaît sur ton écran d'accueil, avec le nom "Carnet pêche".

⚠️ **Après chaque mise à jour du site** (nouveaux fichiers déposés sur GitHub), pense à changer la valeur de `CACHE_NAME` en haut de `sw.js` (ex. `carnet-peche-v2`). Sans ça, l'appli installée sur l'iPhone peut continuer à afficher une version mise en cache un moment avant de se mettre à jour.

## Fichiers du projet

- `index.html`, `style.css`, `app.js` — l'application elle-même
- `manifest.json`, `sw.js`, `icons/` — nécessaires pour l'installation en PWA sur iPhone
- `data/prises.json` — créé automatiquement au premier enregistrement, contient toutes les prises

## Changelog

### v1.8.0 — 2026-09-15
- Correction d'un bug d'affichage sur iPhone : les champs du formulaire (notamment le champ photo) pouvaient dépasser du cadre et provoquer un défilement horizontal indésirable. Les champs occupent maintenant toujours toute la largeur disponible.
- Le formulaire "Nouvelle prise" est désormais organisé en sections : **Identification** (date, espèce), **Mesures** (poids, taille), **Lieu & conditions** (lieu, notes), **Photo**.

### v1.7.0 — 2026-09-15
- Cliquer sur la miniature d'une prise ouvre désormais un visualiseur plein écran (popup) pour voir la photo en grand — sans déclencher l'édition de la prise. Fermeture via le bouton ✕, un clic en dehors de l'image, ou la touche Échap.

### v1.6.0 — 2026-09-15
- Export PDF repensé pour ressembler à un vrai carnet : pages fond papier encadrées, en-tête "Carnet de pêche" répété sur chaque page, photos centrées et encadrées façon polaroid, lignes fines façon papier ligné sur les pages de prise.
- Nouvelle page "En un coup d'œil" juste après la couverture : une frise de miniatures (photo + date + espèce) de toutes les prises de la période, dans l'ordre chronologique.

### v1.5.0 — 2026-09-15
- Transformation en PWA installable : `manifest.json`, icônes (dossier `icons/`) et service worker (`sw.js`) pour un cache minimal de l'app shell.
- Sur iPhone, "Ajouter à l'écran d'accueil" depuis Safari installe désormais une vraie icône (carpe stylisée) qui ouvre l'appli en plein écran.

### v1.4.0 — 2026-09-15
- Nouveau bouton d'export (icône ⤓) : génère un "carnet" imprimable de toutes les prises, ou d'une période choisie (date de début / date de fin, les deux facultatives).
- L'export s'appuie sur la fonction d'impression du navigateur (« Enregistrer en PDF » dans la boîte de dialogue d'impression) : une page de garde avec la période et quelques statistiques, puis une page par prise avec sa photo et ses informations.

### v1.3.0 — 2026-09-15
- À l'ajout d'une photo, la position GPS est extraite automatiquement de ses métadonnées EXIF (si présente) et affichée sur une mini-carte de confirmation dans le formulaire.
- Nouvelle section "Carte des prises" affichant toutes les prises géolocalisées sur une carte (OpenStreetMap via Leaflet).
- Utilise les bibliothèques externes `exif-js` et `leaflet` chargées depuis cdnjs (aucune clé/API payante requise, cartes OpenStreetMap gratuites).
- Note : de nombreuses applications (messagerie, réseaux sociaux) suppriment les données GPS des photos avant partage — la détection ne fonctionnera que sur des photos issues directement de l'appareil photo/du téléphone, avec la localisation activée.

### v1.2.0 — 2026-09-15
- Les champs "Espèce" et "Lieu" du formulaire suggèrent désormais les valeurs déjà saisies dans les prises existantes (autocomplétion native du navigateur).

### v1.1.0 — 2026-09-15
- Ajout d'un filtre par espèce, en plus du filtre par lieu.
- Une prise peut être modifiée en cliquant dessus dans le carnet : le formulaire se pré-remplit (y compris la photo), avec un bouton pour annuler la modification.

### v1.0.0 — 2026-09-15
- Version initiale : formulaire d'ajout (date, espèce, poids, taille, lieu, notes, photo), liste des prises triée par date, filtre par lieu, statistiques simples (total, plus grosse prise, dernière sortie), suppression d'une prise.
- Stockage via l'API Git Data de GitHub (blobs/trees/commits), sans limite de taille de fichier liée à l'API "contents" simple.
- Connexion par jeton personnel fine-grained, stocké uniquement en local.
