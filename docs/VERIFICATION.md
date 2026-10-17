# Vérification de la première tranche

## Exécution réelle

Vérifications exécutées depuis la racine du projet après les corrections de revue :

| Vérification | Résultat observé |
| --- | --- |
| `npm test` | 33 tests réussis, 0 échec |
| `npm run typecheck` | Réussi |
| `npm run build` | Réussi, `server/dist/main.js` produit |
| Tests stdio ciblés sur le point d’entrée JavaScript compilé | 11 tests réussis, 0 échec |
| `cargo test --locked` | 3 tests réussis, 0 échec |
| `cargo fmt --check` | Réussi |
| `cargo clippy --locked -- -D warnings` | Réussi |
| `cargo build --locked --target wasm32-wasip2 --release` | Réussi |
| `npm audit --omit=dev --json` | 0 vulnérabilité connue signalée lors de l’audit ; pas une garantie d’absence de défaut |

Commande du test sur le serveur compilé :

```sh
SHERLOCK_TEST_ENTRY="$PWD/server/dist/main.js" node --test --test-concurrency=1 \
  server/test/lsp.test.ts server/test/rename.test.ts server/test/examples.test.ts \
  server/test/aliases.test.ts server/test/rename-race.test.ts
```

## Ce qui est effectivement testé

- SDK officiel et plugins npm épinglés sur les deux configurations d’exemple, sans fetch et sans écriture des copies sources.
- Source anglaise au survol, variables et variantes existantes, textes réels des exemples, Unicode/emoji et CRLF.
- Extraction avec imports namespace/wrapper, alias lexical, absence d’appel préexistant et génération sans collision/clé réservée.
- Catalogues non sauvegardés, éditions versionnées et conservation des entrées déjà présentes.
- Renommage de références statiques multi-fichiers et des locales concernées, variables/variants/métadonnées conservés.
- Refus de sélections risquées, entités JSX, placeholders littéraux sans mapping, modules/chemins inconnus et catalogues invalides.

## Revue et régressions

La première revue indépendante a reproduit deux défauts P1 : identité canonique divergente d’un buffer ouvert via symlink, et capture trop tardive du document initiateur d’un renommage. Les tests de régression ont été observés en échec avant correction puis en succès.

Les éditions via aliases sont désormais refusées avec une erreur explicite ; un renommage dont la source change renvoie ContentModified. Les deux autres défauts de revue (placeholder littéral et entités JSX) sont corrigés par refus explicite des cas non pris en charge. La relecture indépendante ciblée des quatre corrections est approuvée : 8 tests ciblés réussis, aucune erreur logique ni préoccupation de sécurité restante reproduite dans ce périmètre. Ce verdict ne vaut pas validation des comportements GUI ni des fonctionnalités explicitement hors périmètre.

## Livrables locaux

- Serveur : `server/dist/main.js`, accompagné du checkout et de `node_modules`.
- Composant : `target/wasm32-wasip2/release/sherlock_zed.wasm`.
- Installation manuelle : [guide Zed](ZED-ADAPTER.md).

## Non validé

Aucune installation de l’extension dans l’interface Zed ni modification des réglages de l’utilisateur n’a été effectuée. L’application d’éditions, l’annulation, le refus partiel, la sauvegarde et l’expérience F2/menu restent à essayer dans Zed. Les applications complètes n’ont pas été recompilées après application d’une action dans l’éditeur. Pas de publication ni dépôt Git initialisé.

Les tests du protocole et du composant ne constituent pas une certification de ces comportements GUI. Voir les limites restantes dans le README.
