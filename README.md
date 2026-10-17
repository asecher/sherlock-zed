# Sherlock pour Zed

Extension de développement ciblée : aperçu de la langue source au survol d’une clé Paraglide, extraction d’un texte vers inlang, et renommage coordonné des références statiques.

**État : survol et extraction confirmés fonctionnels dans Zed par l’utilisateur.** Les tests automatisés du serveur et du composant restent distincts de cette validation utilisateur. Les archives des cinq plateformes ont été construites et validées en CI ; la release `v0.1.0` est préparée en **brouillon**, pas publiée. L’installation autonome doit encore être essayée dans Zed après publication.

## Architecture retenue

- Adaptateur Zed **Rust/WASM**, serveur local **Node.js 24+** en stdio.
- Moteur sur le **SDK officiel `@inlang/sdk` 4.0.4**, avec plugins message-format npm épinglés.
- Chargement dans un système de fichiers **en mémoire** : aucun cache, module distant ou `.env` du projet exécuté ; les écritures internes du SDK restent isolées.
- Modifications proposées au client par `WorkspaceEdit`, jamais sauvegardées directement dans les projets par le serveur.

Le paquet tiers `inlang-language-server` a été étudié et testé pendant le cadrage ; il n’est pas une dépendance de cette implémentation SDK. Aucun code de production n’a été copié depuis ce serveur.

## Démarrage local

```sh
npm ci --ignore-scripts
npm test
npm run typecheck
npm run build
rustup target add wasm32-wasip2
cargo test --locked
cargo build --locked --target wasm32-wasip2 --release
```

[Installation dans Zed et override local](docs/ZED-ADAPTER.md). Le point d’entrée du serveur est `server/dist/main.js`, l’identifiant LSP est `sherlock`. Le mode de développement local nécessite le checkout et ses dépendances.

[Distribution autonome par archive de release](docs/RELEASE.md) : archive macOS arm64 construite et testée hors checkout, contrôle SHA-256, installateur Zed et workflow de brouillon GitHub préparés pour `asecher/sherlock-zed`. La publication réelle des assets reste nécessaire avant de retirer une configuration locale fonctionnelle.

## Fonctions implémentées

- **Hover source** sur les appels statiques `m.key()` et `m["key"]()`, y compris alias d’import namespace et import nommé via `i18n.ts`. Affichage du texte source et de ses placeholders, pas de tableau multilingue.
- **Extraction** de texte JSX simple et de littéraux complets dans les contextes validés ; clé lisible générée avec protection contre les collisions. Réutilisation du vrai symbole importé, même avant son premier appel. Ajout d’import lorsque le chemin est identifiable dans les structures des exemples.
- **Renommage LSP** depuis une référence reconnue : catalogues des locales concernées + références statiques des fichiers TS/JS du même projet. Les répertoires générés Paraglide sont exclus.
- Prise en compte des catalogues ouverts non sauvegardés et éditions versionnées pour les buffers ouverts. Détection de changements pendant le calcul de l’action.

## Périmètre et limites

Les configurations de `examples-apps/my-app` et `examples-apps/spa-remix3` servent de référence : Remix 3/TSX, langue source définie par `baseLocale`, locales en/fr, plugin message-format 4.4.0 ou 4.5.0, motif relatif `{locale}.json`. Les tests travaillent sur des copies ; les exemples originaux ne sont pas modifiés.

Pour cette première tranche :

- Seuls les modules/configurations explicitement reconnus sont acceptés. Aucun support universel des plugins inlang.
- Pas d’extraction des templates dynamiques/HTML interpolés, du texte JSX multiligne ou des entités JSX. Les littéraux contenant des placeholders `{name}` sont refusés à l’extraction tant qu’aucun mapping d’arguments n’est fourni ; les placeholders existants restent visibles au survol.
- Pas de renommage des clés dynamiques, d’imports individuels de messages, de réexports arbitraires ni des fichiers générés. Le nouveau nom doit être un identifiant valide. Limite de 2000 fichiers source pour le scan de renommage.
- L’export officiel 4.4 peut canonicaliser les clés avec points en objets imbriqués ; les tests vérifient la conservation de leur sémantique.
- Par sécurité, l’extraction et le renommage refusent les workspaces ou documents ouverts via un lien symbolique/alias de chemin. Réouvrir avec le chemin réel indiqué par l’erreur ; le support transparent de ces alias reste à faire.
- Les fichiers fermés utilisent une version LSP `null` : on recontrôle leur contenu avant de répondre, mais aucune transaction disque globale ni protection contre une modification externe ultérieure n’est garantie. Sauvegarde, refus partiel et annulation multi-fichiers restent à vérifier dans Zed.
- Les mises à jour de configuration `settings.json` sont lues depuis le disque, pas depuis un buffer de configuration non sauvegardé.

## Documents

- [État du tag et du brouillon distant v0.1.0](docs/RELEASE-PUBLICATION.md)
- [Archives de release et installation autonome](docs/RELEASE.md)
- [Vérification du packaging et de l’installateur](docs/RELEASE-VERIFICATION.md)
- [Architecture et garanties](docs/ARCHITECTURE.md)
- [Plan et état de validation](docs/DEVELOPMENT.md)
- [Résultats de vérification et revue](docs/VERIFICATION.md)
- [Décisions](docs/DECISIONS.md)
- [Environnement](docs/ENVIRONMENT.md)
- [Sonde historique du serveur tiers](spikes/001-upstream-lsp/README.md)

`IDEA.md` est conservé. Pas de publication ni de modification automatique des réglages Zed.
