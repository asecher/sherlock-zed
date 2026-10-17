# Développement — état de la première tranche

Ce suivi distingue implémentation/tests automatisés et validation manuelle Zed. Les tests n’écrivent que dans des copies temporaires et volumes en mémoire.

## Implémenté et exercé

- [x] Examiner les deux projets Remix/Paraglide fournis.
- [x] Installer/verrouiller les dépendances npm du moteur SDK officiel.
- [x] Isoler chargement et écritures internes du SDK dans memfs ; ne pas exécuter les modules workspace.
- [x] Tester les plugins correspondant aux deux configurations, variables, variantes, clés avec points et collisions.
- [x] Lire les catalogues ouverts non sauvegardés ; vérifier les projets sources inchangés après les requêtes.
- [x] Détecter les références par AST et distinguer les imports des variables qui les masquent.
- [x] Corriger le cas namespace `.js` et wrapper `i18n.ts` sans appel préexistant.
- [x] Implémenter le hover source dans un processus LSP stdio réel.
- [x] Implémenter l’extraction sûre des contextes TS/TSX retenus, génération de clé et import connu.
- [x] Proposer code + catalogue en éditions multi-fichiers, avec versions des buffers ouverts.
- [x] Implémenter prepareRename/rename pour catalogues et références statiques reconnues.
- [x] Refuser les sélections/contenus risqués non pris en charge plutôt que produire du code douteux.
- [x] Construire le serveur JavaScript distribué localement et exercer ce point d’entrée compilé par les tests stdio.
- [x] Compiler le composant Zed/WASM, exécuter les tests Rust, rustfmt et clippy.

## Encore à faire avant de déclarer l’extension validée dans Zed

- [ ] Installer comme dev extension dans l’interface Zed ; préserver tous les réglages et serveurs existants.
- [ ] Vérifier manuellement hover, menu d’extraction, sélection et renommage sur chacune des deux applications.
- [ ] Appliquer les éditions dans l’éditeur puis sauvegarder, annuler et essayer un refus/échec partiel.
- [x] Reproduire puis corriger le renommage concurrent avec `didChange` du document initiateur ; refuser la requête devenue obsolète.
- [x] Reproduire puis bloquer les éditions via aliases/symlinks qui pouvaient faire ignorer un catalogue ouvert non sauvegardé.
- [ ] Étendre les essais de concurrence aux nouveaux buffers ouverts/fermés pendant toutes les phases des actions.
- [ ] Compiler/tester les applications après application d’une action à leurs copies complètes.
- [ ] Ajouter CI une fois la destination du dépôt connue.

## Limites volontaires de cette tranche

Pas de templates dynamiques ou HTML interpolés, texte JSX multiligne, entités JSX ou extraction de placeholders sans mapping. Pas de résolution universelle des réexports/imports individuels, de clés dynamiques ou de plugins inlang arbitraires. Le scan de renommage est borné à 2000 sources du même projet et exclut les sorties générées. Les configurations sont lues depuis le disque.

Une édition multi-fichiers ne constitue pas une transaction disque globale : les fichiers fermés restent exposés aux modifications externes survenant après le dernier recontrôle. Les exports du plugin 4.4 peuvent canonicaliser la représentation des clés pointées, sans changement de leur sémantique testée.

## Commandes de vérification

```sh
npm ci --ignore-scripts
npm test
npm run typecheck
npm run build
SHERLOCK_TEST_ENTRY="$PWD/server/dist/main.js" node --test server/test/lsp.test.ts server/test/rename.test.ts
cargo test --locked
cargo fmt --check
cargo clippy --locked -- -D warnings
cargo build --locked --target wasm32-wasip2 --release
```

L’exécution réelle de ces commandes, les résultats et les réserves finales sont consignés dans le compte rendu de livraison. Les cases cochées ne valent pas validation GUI.
