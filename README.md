# Coffres PoE1

Scanne tes coffres Path of Exile 1, estime leur valeur et suit l'évolution des prix.

- **Scan automatique** de tous les onglets de coffre, avec rescan programmable (15 min, 30 min, 1 h)
- **Prix sûrs** issus de [poe.ninja] pour les objets à stats fixes : uniques, gemmes, currency, fragments, cartes, essences, scarabées, cartes d'Atlas…
- **Estimations trade** des rares et des magiques : recherche sur le site de trade officiel avec tes mods, moyenne de 50 annonces, conservée avec sa date
- **Trois totaux** : valeur sûre, valeur estimée par le trade, et total global
- **Rolls des uniques** comparés aux plages de Path of Building (complétées par poe.ninja) : barre par mod et note globale
- **Influences** et marques spéciales (Shaper, Elder, conquérants, Searing Exarch, Eater of Worlds, fracturé, synthétisé…) affichées et utilisables comme critères de recherche
- **Historique des prix sur toute la ligue** pour tous les objets cotés (relevé toutes les 30 min), et suivi des objets de ton choix
- Vue liste ou grille, recherche, filtres, export CSV et JSON

Page : **https://mrpatatatomique.github.io/poe-coffres/**

## Path of Exile 2

Page PoE2 : **https://mrpatatatomique.github.io/poe-coffres/coffres-poe2.html**

GGG ne publie pas les coffres PoE2 (ni par l'API officielle, ni par celle du site) : la page ne peut pas les scanner. Elle propose :

- **Prix poe.ninja PoE2** de toutes les catégories (monnaies, essences, runes, cœurs d'âme, uniques, tablettes…), en divines et en exalts, mis à jour toutes les heures, avec historique ;
- **Surveillés** : ☆ sur un prix pour suivre son cours ;
- **Mes ventes** : avec le script, lit tes annonces du site de trade PoE2 (onglets publics, 100 plus récentes) et les compare aux prix poe.ninja ;
- **Coller un objet** : en jeu, `Ctrl+C` sur l'objet puis `Ctrl+V` sur la page (client en anglais). Monnaies, uniques et tablettes sont cotés ; les rares et magiques n'ont pas de prix poe.ninja.

Comme pour PoE1, les ventes passent par un onglet pathofexile.com ouvert et connecté.

## Installation

1. Installe l'extension **[Violentmonkey]** (Firefox ou Chrome).
2. Installe le script en ouvrant ce lien : **[poe-stash-scanner.user.js]**. Violentmonkey propose l'installation ; accepte les autorisations (pathofexile.com, poe.ninja).
3. Connecte-toi sur [pathofexile.com] avec ton compte.
4. Sur pathofexile.com, clique sur le bouton **Coffres** en bas à droite :
   - vérifie le compte (`Nom#1234`) et la ligue ;
   - **Charger les onglets**, puis décoche ceux à ignorer ;
   - **Scanner maintenant**.
5. Ouvre la [page][Page]. Elle affiche « Script vX.Y.Z » en haut à droite et charge ton scan toute seule.

Sous Chrome ou Edge, tu peux installer la page comme une application : icône d'installation dans la barre d'adresse.

## Utilisation

| Action | Où |
|---|---|
| Rescanner | bouton **Rescanner** de la page, ou panneau **Coffres** sur pathofexile.com |
| Rescan automatique | case **Fraîcheur** de la page, ou panneau **Coffres** |
| Mettre à jour les prix | automatique toutes les 15 min, ou bouton **Prix** |
| Ouvrir la recherche d'un objet sur le trade ou sa fiche poe.ninja | liens sous le nom, dans la fiche de l'objet |
| Estimer un rare | fiche de l'objet → choisis les mods (clic) et leur % de correspondance (50 à 100 %), puis **Rechercher** |
| Suivre un prix | ★ dans le tableau ou sur la fiche |

**Avec l'overlay PoE de MrPatatatomique** lancé (pont local sur `127.0.0.1:7777`), la page lui confie directement les recherches trade : pastille « Overlay » dans l'en-tête.

**Sous Windows, sans l'overlay** : télécharge le [pont Windows](https://github.com/MrPatatatomique/poe-coffres/releases/download/pont-windows/poe-coffres-pont.exe) et lance-le (fenêtre à laisser ouverte, réduite). Windows peut afficher « Windows a protégé votre ordinateur » : *Informations complémentaires* → *Exécuter quand même*. Pour le lancer au démarrage : `Win + R` → `shell:startup`, puis glisse-y un raccourci vers le fichier. La pastille **API** passe au vert.

**En dernier recours, garde un onglet pathofexile.com ouvert** (n'importe quelle page du site) : le site est protégé par Cloudflare, et c'est cet onglet qui exécute pour la page les recherches trade et les rescans.

Les estimations trade se font objet par objet : le site de trade limite fortement le nombre de recherches (environ 5 par 10 s et 30 par 5 min). Le script fait les pauses tout seul.

## Données partagées

Une tâche GitHub Actions (`.github/workflows/data.yml`) tourne toutes les 30 min. Elle :

- récupère les prix poe.ninja des ligues actives (une seule fois pour tous les utilisateurs) ;
- ajoute un relevé à l'historique : 30 min de précision sur 7 jours, 2 h jusqu'à 30 jours, 6 h au-delà, pour tout ce qui vaut au moins 1 chaos ;
- reconstruit chaque jour la base des uniques depuis les données de [Path of Building](https://github.com/PathOfBuildingCommunity/PathOfBuilding) ;
- publie le tout avec la page sur GitHub Pages.

Les données sont stockées dans la branche `data`, réécrite à chaque passage (un seul commit, l'historique Git ne grossit pas).

## Données et confidentialité

- Tout reste **dans ton navigateur**, dans le stockage de Violentmonkey : scans, prix, historique, estimations. Rien n'est envoyé ailleurs que sur pathofexile.com et poe.ninja.
- Le script utilise ta session pathofexile.com déjà ouverte. Il ne lit ni ne stocke ton cookie de session.
- Chaque personne utilise son propre compte : il suffit d'installer le script et de se connecter.

## Si quelque chose ne marche pas

- **« Script non détecté »** : vérifie que Violentmonkey est activé et que le script l'est aussi, puis recharge la page. Le fichier de la page doit garder un nom commençant par `coffres-poe1`.
- **« Accès refusé » au scan** : reconnecte-toi sur pathofexile.com dans le même navigateur.
- **Bandeau « script trop ancien »** : dans Violentmonkey, ouvre le tableau de bord et lance la vérification des mises à jour, ou réinstalle le script depuis le lien ci-dessus.
- **Pas de prix** : poe.ninja ne connaît pas encore la ligue, ou l'objet a des mods variables (dans ce cas, utilise l'estimation trade).

## Mises à jour

Violentmonkey vérifie les mises à jour du script tous les jours. La page est toujours à jour puisqu'elle est servie par GitHub Pages.

## Développement

- `shared/ninja.js` : **source unique** des catégories et des transformations poe.ninja (lignes de prix, clés d'historique, choix de la ligue). Elle sert à `tools/update-data.mjs` et au script Violentmonkey.
- Le script en contient une copie entre les marqueurs `@@ninja-begin` / `@@ninja-end`. Après une modification de `shared/ninja.js` : `node tools/build-userscript.mjs`, puis augmenter `@version` du script.
- `node tools/test-ninja.mjs` : tests des transformations sur `tools/fixtures/ninja.json` et vérification que la copie du script est à jour.
- `node tools/test-page.mjs` : test de bout en bout de la page dans Chromium (`npm install` puis `npx playwright install chromium`, ou `CHROME_PATH=/usr/bin/google-chrome` pour un Chrome déjà installé). Il construit un faux site à partir de `tools/fixtures/` (prix, historique, scan, personnages) et vérifie totaux, cotation des gemmes et des bases, fenêtres, prix manuel, surveillés, personnages, prix d'une autre ligue, archives et absence d'erreur JavaScript.
- `tools/ninja2.mjs` et `tools/update-poe2.mjs` : prix et historique PoE2 (dossier `data/poe2/` de la branche data), appelés par `tools/update-data.mjs`. `node tools/test-poe2.mjs` les teste sur `tools/fixtures/ninja2.json`, `node tools/test-page2.mjs` teste `coffres-poe2.html` dans Chromium.
- `docs/protocole.md` : messages échangés entre la page et le script, relais vers l'onglet pathofexile.com, clés de stockage. `node tools/test-protocol.mjs` vérifie que tout ce que le code utilise y est documenté.
- `npm test` lance le tout. La tâche « Vérifications » les exécute à chaque push.

---

Outil non officiel, sans lien avec Grinding Gear Games ni poe.ninja. Respecte leurs limites d'utilisation.

[poe.ninja]: https://poe.ninja
[Violentmonkey]: https://violentmonkey.github.io/
[pathofexile.com]: https://www.pathofexile.com
[poe-stash-scanner.user.js]: https://mrpatatatomique.github.io/poe-coffres/poe-stash-scanner.user.js
[Page]: https://mrpatatatomique.github.io/poe-coffres/coffres-poe1.html
