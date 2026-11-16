# Coffres PoE1

Scanne tes coffres Path of Exile 1, estime leur valeur et suit l'évolution des prix.

- **Scan automatique** de tous les onglets de coffre, avec rescan programmable (15 min, 30 min, 1 h)
- **Prix sûrs** issus de [poe.ninja] pour les objets à stats fixes : uniques, gemmes, currency, fragments, cartes, essences, scarabées, cartes d'Atlas…
- **Estimations trade** des rares et des magiques : recherche sur le site de trade officiel avec tes mods, moyenne de 50 annonces, conservée avec sa date
- **Trois totaux** : valeur sûre, valeur estimée par le trade, et total global
- **Suivi des prix** des objets de ton choix, avec courbe sur 7 jours (poe.ninja) et historique personnel
- Vue liste ou grille, recherche, filtres, export CSV et JSON

Page : **https://mrpatatatomique.github.io/poe-coffres/**

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
| Estimer un rare | fiche de l'objet → **Estimer sur le trade** |
| Suivre un prix | ★ dans le tableau ou sur la fiche |

Les estimations trade se font objet par objet : le site de trade limite fortement le nombre de recherches (environ 5 par 10 s et 30 par 5 min). Le script fait les pauses tout seul.

## Données et confidentialité

- Tout reste **dans ton navigateur**, dans le stockage de Violentmonkey : scans, prix, historique, estimations. Rien n'est envoyé ailleurs que sur pathofexile.com et poe.ninja.
- Le script utilise ta session pathofexile.com déjà ouverte. Il ne lit ni ne stocke ton cookie de session.
- Chaque personne utilise son propre compte : il suffit d'installer le script et de se connecter.

## Si quelque chose ne marche pas

- **« Script non détecté »** : vérifie que Violentmonkey est activé et que le script l'est aussi, puis recharge la page. Le fichier de la page doit garder un nom commençant par `coffres-poe1`.
- **« Accès refusé » au scan** : reconnecte-toi sur pathofexile.com dans le même navigateur.
- **Pas de prix** : poe.ninja ne connaît pas encore la ligue, ou l'objet a des mods variables (dans ce cas, utilise l'estimation trade).

## Mises à jour

Violentmonkey vérifie les mises à jour du script tous les jours. La page est toujours à jour puisqu'elle est servie par GitHub Pages.

---

Outil non officiel, sans lien avec Grinding Gear Games ni poe.ninja. Respecte leurs limites d'utilisation.

[poe.ninja]: https://poe.ninja
[Violentmonkey]: https://violentmonkey.github.io/
[pathofexile.com]: https://www.pathofexile.com
[poe-stash-scanner.user.js]: https://mrpatatatomique.github.io/poe-coffres/poe-stash-scanner.user.js
[Page]: https://mrpatatatomique.github.io/poe-coffres/coffres-poe1.html
