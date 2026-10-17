# Installation autonome par archive de release

## Choix retenu

Les archives sont destinées au dépôt GitHub fourni par l’utilisateur : `asecher/sherlock-zed` (URL reçue : `https://github.com/asecher/sherlock-zed.git`). Aucun paquet npm du serveur n’a besoin d’être publié. Le SDK et les plugins officiels restent des dépendances embarquées dans l’archive.

La publication d’une release n’a pas été effectuée pendant la préparation. Le mode automatique ne sera utilisable de bout en bout qu’après publication de la release et de ses assets. Les essais locaux d’archive ne doivent pas être présentés comme une installation depuis GitHub réussie.

## Contrat des assets

Tag stable : `vMAJOR.MINOR.PATCH`, correspondant aux versions de `package.json`, `Cargo.toml` et `extension.toml`.

```text
sherlock-language-server-v0.1.0-darwin-arm64.tar.gz
sherlock-language-server-v0.1.0-darwin-arm64.tar.gz.sha256
```

Une archive par plateforme est nécessaire : les dépendances du SDK incluent des modules natifs, en plus des fichiers JavaScript et WASM. Ne pas réutiliser l’archive macOS arm64 sur Intel, Linux ou Windows.

Contenu à la racine de l’archive, sans dossier englobant :

```text
release.json
package.json
server/dist/main.js
server/dist/...
node_modules/...
```

`release.json` identifie le format, la version, l’OS, l’architecture, le major Node attendu et le point d’entrée. Le fichier SHA-256 correspond aux octets exacts de l’archive ; il vérifie son intégrité, pas une signature de provenance indépendante de GitHub.

## Construire et essayer sur la machine courante

```sh
npm ci --ignore-scripts
npm test
npm run typecheck
npm run test:release
node scripts/check-release.mjs
npm run release:build
npm run release:smoke
```

Le build de release installe les seules dépendances de production depuis le lockfile dans un staging isolé, sans scripts d’installation, et inclut les assets requis. Le smoke test doit extraire et lancer le serveur hors du checkout, puis vérifier de vrais échanges LSP et le moteur SDK. Aucun `npm install` n’est nécessaire sur la machine de l’utilisateur final.

Les archives et leurs fichiers d’intégrité sont écrits dans `release/`, ignoré par Git. Les tests et staging doivent utiliser le scratch Hermes, pas les projets exemples réels. La version de Node fournie par Zed doit respecter les exigences du serveur.

## Installation côté Zed

Le mode autonome vise à rendre `lsp.sherlock.binary.path` et `binary.arguments` facultatifs : l’adaptateur sélectionne la plateforme, récupère l’archive d’une version épinglée, vérifie son intégrité et son contenu, puis lance le point d’entrée avec Node via l’API Zed. Une installation complète peut être réutilisée hors ligne ; un premier téléchargement nécessite le réseau et des assets publics disponibles.

L’override local `binary` est conservé pour développer ou dépanner. Un ancien override continue donc à sélectionner le serveur local au lieu du mode autonome. Pour essayer le mode automatique après publication, retirer uniquement cet override, préserver les autres réglages/serveurs et reconstruire/recharger l’extension de développement. Ne pas supprimer le serveur local fonctionnel avant qu’une release soit disponible.

## Workflow GitHub préparé

`.github/workflows/release.yml` contient :

1. Une matrice native macOS arm64/Intel, Linux glibc arm64/x64 et Windows x64.
2. Un contrôle des versions et de la plateforme réelle avant tout packaging.
3. Des tests, le typecheck, le packaging et un smoke test hors checkout sur chaque runner.
4. L’archivage des cinq couples archive/checksum comme artifacts de CI.
5. Sur un tag du dépôt attendu, la création/mise à jour d’une **release brouillon uniquement**, après succès de tous les builds.

Un lancement manuel depuis une branche produit les artifacts mais ne publie pas de release. Le workflow refuse d’écraser une release déjà publique. Les actions sont épinglées à des commits ; le workflow a été vérifié localement avec actionlint, mais cela ne prouve pas une exécution distante réussie.

Les tests utilisent des snapshots versionnables dans `server/test/fixtures/` quand les applications locales sont absentes, ou quand `SHERLOCK_TEST_FIXTURES_ONLY=1`. Les dossiers locaux `examples-apps/` sont ignorés pour éviter des gitlinks vers des dépôts imbriqués ou la publication involontaire d’applications locales.

## Une seule préparation de release pour le mainteneur

- Définir la licence et les métadonnées de publication du nouveau code ; relire les snapshots de test avant publication.
- Mettre les sources et lockfiles dans le dépôt indiqué, sans `node_modules`, `target`, `release`, `extension.wasm` ni les applications locales.
- Pousser un tag correspondant exactement à la version choisie, lorsque la publication sera autorisée.
- Examiner les résultats des cinq runners et les assets du brouillon.
- Publier manuellement le brouillon. Alors seulement, tester le téléchargement automatique dans Zed sans override local.

Aucun push, tag distant, upload ni release publique n’est autorisé implicitement par la présence de ce workflow.

## Renommage

L’amélioration UX proposant de sélectionner la clé après extraction est abandonnée à la demande de l’utilisateur. Ce chantier de distribution ne supprime pas le renommage LSP préexistant et ne change pas l’expérience d’extraction déjà confirmée fonctionnelle.
