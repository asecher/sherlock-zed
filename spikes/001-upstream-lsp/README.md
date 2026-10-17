# 001 — Évaluer le LSP existant sur les exemples

## Question

Étant donné les configurations et sources de `examples-apps/my-app` et `examples-apps/spa-remix3`, le serveur distribué avec l’extension suggérée sait-il déjà fournir un hover et une extraction correspondant à leur usage Paraglide ?

## Méthode

Une seule approche : exécuter le paquet upstream épinglé `inlang-language-server@0.0.7` en processus Node et lui envoyer des requêtes LSP. Le paquet est téléchargé directement du registre npm, son intégrité SHA-512 est contrôlée, et seul `bin/server.mjs` est extrait dans le scratch Hermes. Aucun script d’installation npm n’est exécuté.

Les configurations, catalogues et fichiers représentatifs sont copiés dans des dossiers temporaires isolés. Les exemples d’origine sont seulement lus. Le serveur reçoit `initialize`, `initialized`, `textDocument/hover`, `textDocument/codeAction`, `shutdown` et `exit`. Les notifications d’ouverture/changement de buffers ne sont pas testées ici.

```sh
python3 spikes/001-upstream-lsp/probe.py
```

Prérequis : Python 3.9+, Node dans le PATH et accès au registre npm. Les copies temporaires sont supprimées à la fin. Le résultat enregistré de l’exécution est dans [results.json](results.json) ; les URI temporaires qu’il contient sont des traces de l’exécution, pas des fichiers encore disponibles.

## Résultats observés

| Cas | Résultat |
| --- | --- |
| Hover `my-app`, clé `few_early_kangaroo_endure` | Texte anglais reçu, français indiqué manquant ; tableau multilingue |
| Hover SPA, clé `brand_name` | `Wayfinder` reçu pour en/fr |
| Extraction de `Get started` dans la page existante | Remplacement `{m.get_started()}` + catalogue anglais contenant le nouveau message, dans la même action |
| Fichier sans appel existant, import namespace avec chemin `messages.js` | Remplacement incorrect `{messages.fresh_greeting()}` ; seul `m` est importé, sans ajout d’import correctif |
| Fichier sans appel existant, import nommé depuis le wrapper `i18n.ts` | Remplacement incorrect `{t("fresh_greeting")}` ; seul `m` est importé, sans ajout d’import correctif |
| Renommage | Pas de `renameProvider` dans les capacités renvoyées |
| Effets des requêtes sur les copies | Empreintes de tous les fichiers inchangées |

Les éditions observées utilisent `edit.changes` et non des `documentChanges` versionnés. Le test ne les applique pas : la présence d’un plan multi-fichiers n’établit ni son application dans Zed, ni sa sécurité face aux buffers non sauvegardés.

## Verdict : PARTIAL

### Ce qui fonctionne

Le serveur existant couvre déjà le protocole et la lecture des catalogues des deux exemples. Le hover et une extraction simple sont réellement observés, pas seulement annoncés par le README upstream.

### Ce qui ne suffit pas

La détection de l’import à employer n’est pas fiable pour les cas reproduits ; le renommage reste à ajouter. L’affichage multilingue et les autres fonctions upstream dépassent le besoin initial. L’intégration Zed, le build des applications, les variables/variants complexes, les conflits et l’annulation restent non testés.

### Recommandation

Partir de cette base et ajouter des tests de régression avant correction. Pour ces exemples, lire/éditer le format JSON observé évite d’introduire d’emblée le SDK inlang et son stockage. Ne pas transformer cela en promesse de prise en charge générique des plugins. Garder séparée l’alternative d’un LSP Rust si l’absence de runtime Node devient une exigence.

## Provenance

- Extension étudiée : `NEKOYASAN/inlang-zed`, commit `402d5e86ec2650cf162d0979600a1b092731d746`.
- Dépôt serveur identifié : `NEKOYASAN/inlang-language-server`, `main` résolu en `dfcbdb024a4a9f017b64036813ae83538d2cb1b7`.
- Exécution : paquet npm publié `0.0.7`, pas une compilation de `main`.
- Les notices MIT des dépôts upstream devront accompagner toute reprise de code de production ; la sonde ne copie pas leur moteur dans le projet.
