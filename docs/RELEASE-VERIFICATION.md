# Vérification de la distribution par archives

## Résultats réellement exécutés sur macOS arm64

| Contrôle | Résultat |
| --- | --- |
| Moteur sur snapshots autonomes (`SHERLOCK_TEST_FIXTURES_ONLY=1 npm test`) | 34 tests réussis |
| `npm run typecheck` | Réussi |
| `npm run test:release` | 6 tests réussis |
| `npm run release:build` | Archive hôte produite avec dépendances de production |
| `npm run release:smoke` | SDK isolé, hover et extraction réussis avec les plugins 4.4.0 et 4.5.0 |
| Extracteur/installateur Rust de production sur la vraie archive | Réussi ; cache promu puis réutilisé sans rappel du téléchargeur |
| Tests LSP sur le serveur installé par cet extracteur Rust | 11 tests réussis |
| `cargo test --locked` | 17 tests réussis |
| `cargo fmt --all -- --check` | Réussi |
| `cargo clippy --locked --all-targets -- -D warnings` | Réussi |
| `cargo build --locked --target wasm32-wasip2 --release` | Réussi |
| actionlint 1.7.12 sur `.github/workflows/release.yml` | Réussi, sans shellcheck local |

Ces comptes ne s’additionnent pas en un nombre de scénarios uniques : les tests sur le serveur installé réexécutent une partie de la suite.

## Artefacts produits

- `release/sherlock-language-server-v0.1.0-darwin-arm64.tar.gz`
- `release/sherlock-language-server-v0.1.0-darwin-arm64.tar.gz.sha256`
- `target/wasm32-wasip2/release/sherlock_zed.wasm`

La taille et le SHA-256 sont vérifiés sur les octets réellement produits ; un rebuild peut changer l’archive et son checksum. Toujours publier le couple issu du même build, jamais réutiliser une valeur de ce document comme constante de publication.

Le smoke test confirme que le SDK est résolu dans le `node_modules` extrait, pas dans le checkout. L’archive conserve les binaires natifs nécessaires et cinq assets WASM ; les shims `.bin` sont retirés et les autres liens sont refusés. Les tests d’extraction/hover préservent les catalogues non sauvegardés et ne modifient pas les fichiers des fixtures.

## Sonde de l’installateur réel

Une sonde native temporaire a chargé le module `src/release.rs` de production sans en modifier le code, avec un téléchargeur injecté copiant la véritable archive locale et son checksum aux destinations attendues. Elle a vérifié : URL épinglée, checksum, extraction bornée, manifeste, promotion du cache, puis second appel sans téléchargement. Les 11 tests stdio ont ensuite utilisé son point d’entrée installé.

Ce test démontre la compatibilité entre le packager et l’installateur Rust, mais **pas** les appels hôtes `zed::download_file` ni le téléchargement d’une release distante inexistante.

## Revue indépendante

Verdict approuvé : aucun défaut bloquant concret de sécurité ou de logique trouvé dans l’installateur, l’adaptateur, les scripts de packaging et le workflow. Le reviewer a réexécuté les 17 tests Rust et les 6 tests de release, installé la vraie archive avec le module Rust de production, démarré le serveur extrait en LSP puis confirmé sa réutilisation de cache sans source de téléchargement disponible. Le smoke SDK isolé est également passé.

Portée de ce verdict : macOS arm64 seulement. Les autres runners, le téléchargement GitHub distant et l’exécution des appels hôtes dans Zed restent à valider ; ils ne sont pas certifiés par les tests natifs.

## À faire avant disponibilité autonome réelle

- Exécuter la matrice GitHub sur les autres plateformes ; elles ne sont pas validées par un build macOS.
- Mettre les sources dans le dépôt indiqué et préparer le tag correspondant, après accord de publication.
- Publier les cinq couples d’assets du brouillon après revue des résultats.
- Reconstruire/recharger l’extension dans Zed, retirer seulement l’ancien override local, et essayer le téléchargement initial puis le redémarrage hors ligne.

Aucun push, tag distant, upload, publication ou remplacement du `extension.wasm` actuellement installé n’a été effectué. Les réglages Zed et applications exemples sont inchangés. Les snapshots de test copiés dans `server/test/fixtures/` sont des fichiers distincts à relire avant publication.
