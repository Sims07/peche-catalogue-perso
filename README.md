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

## Changelog

### v1.1.0 — 2026-09-15
- Ajout d'un filtre par espèce, en plus du filtre par lieu.
- Une prise peut être modifiée en cliquant dessus dans le carnet : le formulaire se pré-remplit (y compris la photo), avec un bouton pour annuler la modification.

### v1.0.0 — 2026-09-15
- Version initiale : formulaire d'ajout (date, espèce, poids, taille, lieu, notes, photo), liste des prises triée par date, filtre par lieu, statistiques simples (total, plus grosse prise, dernière sortie), suppression d'une prise.
- Stockage via l'API Git Data de GitHub (blobs/trees/commits), sans limite de taille de fichier liée à l'API "contents" simple.
- Connexion par jeton personnel fine-grained, stocké uniquement en local.
