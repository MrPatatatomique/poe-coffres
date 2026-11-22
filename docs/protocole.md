# Protocole page ↔ script

La page (`coffres-poe1.html`) et le script Violentmonkey (`poe-stash-scanner.user.js`) communiquent par `window.postMessage`, dans l'onglet de la page. Le script, lui, partage son stockage (`GM_setValue`) entre tous les onglets : c'est ce qui permet à l'onglet de la page de confier un travail à un onglet pathofexile.com.

`node tools/test-protocol.mjs` vérifie que chaque commande et chaque message utilisés dans le code figurent dans ce document.

## Vue d'ensemble

```
 Onglet page des coffres                               Onglet pathofexile.com
┌───────────────────────┐  postMessage  ┌──────────────────────┐        ┌──────────────────────┐
│ coffres-poe1.html     │ ────────────▶ │ script (pont page)   │        │ script (panneau GGG) │
│                       │ ◀──────────── │                      │        │                      │
└───────────────────────┘               └──────────┬───────────┘        └──────────┬───────────┘
                                                   │   stockage Violentmonkey      │
                                                   └──── gggRequest / gggStatus ───┘
                                                         lastScan, lastChars…
```

Pourquoi un relais : les requêtes vers pathofexile.com envoyées depuis la page GitHub sont bloquées par Cloudflare. Seul un onglet pathofexile.com (cookies et vérification Cloudflare en place) peut lire les coffres et les personnages.

## Enveloppe

Chaque message est une **chaîne JSON**. Les messages qui ne sont pas des chaînes, ou qui ne viennent pas de la fenêtre elle-même (`ev.source !== window`), sont ignorés des deux côtés.

| Sens | Forme |
|---|---|
| page → script | `{ "src": "poe-viewer", "cmd": "<commande>", "data": … }` |
| script → page | `{ "src": "poe-us", "type": "<message>", "data": … }` |

Les gros contenus (scan, prix, personnages…) voyagent eux-mêmes en **chaîne JSON** dans `data` : la page les relit avec `JSON.parse`.

## Démarrage

1. La page envoie `hello` toutes les 500 ms (20 essais) tant qu'elle n'a pas reçu `ready`.
2. Le script répond `ready`, puis pousse ce qu'il a en mémoire : `settings`, `tracking`, `trades`, `scan`, `chars`, `prices`.
3. La page compare `ready.version` à `REQ_SCRIPT` : si le script est plus ancien, elle affiche le bandeau de mise à jour.
4. Plusieurs copies du script (autre gestionnaire, ancienne installation) envoient chacune `ready` : la page le signale et garde la version la plus récente.

## Commandes (page → script)

| Commande | `data` | Effet |
|---|---|---|
| `hello` | — | Demande `ready` et le contenu mémorisé (voir Démarrage). |
| `settings` | objet partiel des réglages | Fusionné dans les réglages du script, qui renvoie `settings`. La page s'en sert pour `autoMinutes`, `withChars`, et pour donner sa ligue au script quand le réglage est vide. |
| `scan` | — | Scan des coffres, **relayé** à un onglet pathofexile.com. Progression en `status`, résultat en `scan` (puis `chars` si `withChars`). |
| `chars` | `{ league }` | Import des personnages de la ligue, **relayé**. Progression en `status`, résultat en `chars`. |
| `prices` | `{ league }` | Récupère les prix poe.ninja par le script (bouton « Recharger les prix »). Réponse : `prices`. |
| `prices-set` | objet prix | Donne au script les prix du dépôt (avec `gggLeague`) ; il les garde et cesse de les récupérer lui-même (`ninjaRemote`). |
| `tracking` | `{ follow, history }` | Suivis et surveillés à garder côté script. |
| `trade-prepare` | `{ itemId, item }` | Prépare les critères de recherche trade d'un objet. Réponse : `trade-draft` ou `trade-draft-error`. |
| `trade` | `{ itemId, item, mods, extras }` | Lance l'estimation trade (file d'attente, délai 240 s). Réponse : `trade-result` ou `trade-error`. |
| `trade-store` | estimation | Enregistre une estimation calculée par la page (pont local ou overlay). |
| `trade-delete` | `{ itemId }` | Supprime une estimation. |

## Messages (script → page)

| Message | `data` | Contenu |
|---|---|---|
| `ready` | `{ version, inst, scans }` | Version du script, identifiant de cette copie (détection des doublons), présence d'un scan mémorisé. |
| `settings` | objet | Réglages : `account`, `league`, `selected` (onglets par ligue), `autoMinutes`, `withChars`, `alsoDownload`, `ninjaRemote`. |
| `status` | `{ msg, p?, error?, done? }` | Progression ou erreur. `p` de 0 à 1 ; `done` termine un scan ; `error` est enregistré dans l'historique des erreurs de la page. |
| `scan` | chaîne JSON | Scan des coffres (`format: "poe1-stash-scan"`). |
| `chars` | chaîne JSON | Personnages (`format: "poe1-characters"`, `league`, `chars[].items`). |
| `prices` | chaîne JSON | Prix poe.ninja récupérés par le script (`league`, `gggLeague`, `fetchedAt`). Refusés par la page s'ils ne sont pas de la ligue du scan. |
| `tracking` | chaîne JSON | Suivis et historique mémorisés par le script. |
| `trades` | chaîne JSON | Estimations trade mémorisées, par identifiant d'objet. |
| `trade-draft` | chaîne JSON | `{ itemId, mods, extras }` : critères proposés pour la recherche trade. |
| `trade-draft-error` | `{ itemId, msg }` | Critères impossibles à préparer. |
| `trade-result` | chaîne JSON | Estimation terminée (prix, annonces, date). |
| `trade-error` | `{ itemId }` | Estimation échouée (le détail arrive aussi en `status`). |

## Relais vers l'onglet pathofexile.com

Utilisé par `scan` et `chars` quand la commande arrive dans l'onglet de la page.

1. Le script de la page écrit `gggRequest = { id, kind: "scan" | "chars", data, at }`.
2. Un onglet pathofexile.com (écouteur `GM_addValueChangeListener`) prend la demande s'il n'y a pas de verrou actif (`gggLock = { id, until }`, prolongé de 60 s à chaque étape). Il publie aussitôt un accusé de réception dans `gggStatus`.
3. Il exécute le travail et publie chaque étape dans `gggStatus = { id, msg, p, error, done, at }`.
4. Le script de la page relaie chaque `gggStatus` en `status`. Il abandonne si aucun accusé n'arrive en **8 s** (« aucun onglet pathofexile.com n'a pris la demande »), ou si plus rien n'arrive pendant **3 min**.
5. Le résultat (`lastScan`, `lastChars`) est vu par l'écouteur de l'onglet de la page, qui l'envoie à la page (`scan`, `chars`).

## Stockage partagé du script

| Clé | Contenu |
|---|---|
| `settings` | Réglages (voir le message `settings`). |
| `lastScan`, `lastScanAt` | Dernier scan (chaîne JSON) et sa date. |
| `lastChars` | Derniers personnages importés (chaîne JSON). |
| `ninjaPrices` | Prix poe.ninja mémorisés, avec `gggLeague`. |
| `tradeEstimates`, `tradeStats` | Estimations trade, liste des mods du site de trade. |
| `follow`, `priceHistory` | Suivis et historique de prix. |
| `scanLock` | Verrou de scan entre onglets : date d'expiration, prolongée de 2 min à chaque étape. |
| `authFailedAt` | Dernier refus d'authentification GGG (pause du rescan automatique). |
| `gggRequest`, `gggStatus`, `gggLock` | Relais vers l'onglet pathofexile.com (voir ci-dessus). |

## Côté page (stockage du navigateur)

Ces clés `localStorage` ne concernent que la page, mais elles sont listées ici pour être complet. Leur format est versionné par `poeSchema`, et la page purge les plus anciennes données à chaque ouverture.

`poeTracking`, `poeTrades`, `poeManual`, `poeFarm`, `poeQtyHist`, `poeValueHist`, `poeErrors`, `poeSchema`, ainsi que les préférences d'affichage (`poeFollowHidden`, `poeWatchHidden`, `poeTabsHidden`, `poeCharsHidden`, `poeGainRange`, `poeVhRange`).

## Faire évoluer le protocole

- Ajouter une commande ou un message : le traiter des deux côtés, le documenter ici, augmenter `@version` du script et `REQ_SCRIPT` dans la page si la page en a besoin.
- Une page plus récente que le script doit rester utilisable : elle vérifie la version avant d'envoyer une commande que les anciens scripts ignoreraient (voir l'import des personnages).
