# État de l’environnement de développement

Relevé pendant la préparation du projet. Ces versions sont un constat local, pas des versions minimales garanties.

| Outil | Version / état observé |
| --- | --- |
| Zed | `1.24.2`, `/Applications/Zed.app` |
| Node.js | `v24.22.0` |
| npm | `11.19.1` |
| Rust | `rustc 1.96.0 (ac68faa20 2026-05-25)` |
| Cargo | `1.96.0 (30a34c682 2026-05-25)` |
| Rust toolchain | `stable-aarch64-apple-darwin` |
| Git | `2.50.1 (Apple Git-155)` |
| Python | `3.9.6` |
| pnpm / GitHub CLI | Non trouvés dans le PATH de cette session ; non requis pour la préparation. |
| Dépôt local | Pas encore de dépôt Git ; initialement seul `IDEA.md` est présent. |

## Prérequis relevé avant implémentation (historique)

La documentation Zed consultée demande la cible Rust `wasm32-wasip2`. Elle n’apparaît pas dans `rustup target list --installed` sur cette machine. Zed peut l’installer automatiquement via rustup à l’installation d’une extension de développement. Pour une installation explicite, lorsque le premier spike sera prêt :

```sh
rustup target add wasm32-wasip2
```

Ne pas confondre avec `wasm32-unknown-unknown` déjà présent.

Aucune installation globale, aucun changement de configuration Zed, aucune publication et aucune initialisation Git n’ont été effectués pendant ce relevé.

## Commandes de contrôle exécutées

```sh
zed --version
node --version
npm --version
rustc --version
cargo --version
rustup show active-toolchain
rustup target list --installed
git --version
python3 --version
```

## Registre npm consulté

Résultats de `npm view <package> version` au moment du relevé :

- `vscode-languageserver` : `10.1.2`
- `@inlang/sdk` : `4.0.4`
- `typescript` : `7.0.2`

Il ne s’agit pas d’une sélection de dépendances. La version du SDK compatible avec le Sherlock étudié et ses plugins devra être choisie explicitement ; ne pas installer aveuglément la dernière majeure.

## Référence

Documentation officielle consultée : `https://zed.dev/docs/extensions/developing-extensions`.

## Mise à jour après première implémentation

- La cible `wasm32-wasip2` est maintenant installée via rustup ; build release réel réussi.
- Les dépendances locales npm ont été installées avec `--ignore-scripts` ; `package-lock.json` et `Cargo.lock` sont présents.
- Le serveur utilise `@inlang/sdk` 4.0.4 et TypeScript 5.9.3 (compilateur et AST), pas nécessairement la dernière version signalée dans le relevé historique.
- Le composant est produit dans `target/wasm32-wasip2/release/sherlock_zed.wasm` et le serveur dans `server/dist/main.js`.
- Pas de dépôt Git initialisé, publication, installation GUI de l’extension ni changement automatique de réglages Zed.
