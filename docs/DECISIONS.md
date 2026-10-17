# Décisions et questions ouvertes

## Validé par l’utilisateur

- Survol du texte de langue source et extraction, sans port complet de Sherlock.
- Clé générée automatiquement, puis renommable.
- Applications de référence : `examples-apps/my-app` et `examples-apps/spa-remix3`.
- Runtime LSP Node.js.
- **Usage du SDK officiel `@inlang/sdk`** et démarrage du développement.
- Survol et extraction confirmés fonctionnels dans Zed par l’utilisateur.
- Installation autonome via **archives GitHub Release**, sans publication npm du serveur. Dépôt fourni : `https://github.com/asecher/sherlock-zed.git`.
- Abandon de l’amélioration UX de renommage/sélection automatique après extraction ; pas de suppression du renommage LSP préexistant dans ce chantier.

L’accord sur le SDK remplace l’orientation provisoire de lecture JSON directe proposée précédemment. `inlang-language-server` n’est pas le SDK et n’est pas une dépendance du moteur finalement implémenté.

## Choix techniques appliqués

- Adaptateur Rust/WASM minimal et LSP Node local en stdio.
- SDK 4.0.4, plugins message-format officiels 4.4.0/4.5.0 épinglés via npm et lockfile.
- Système de fichiers memfs isolé pour charger et modifier le modèle SDK sans écriture sur le projet hôte.
- Modules/configurations du workspace sur liste autorisée ; aucun module distant/local arbitraire exécuté.
- Analyse AST et portée lexicale pour les imports et références Paraglide.
- `WorkspaceEdit` uniquement, avec versions des documents ouverts, source locale de base uniquement lors de l’extraction.
- Renommage LSP coordonné des références statiques reconnues et catalogues ; pas de renommage des fichiers générés ni des clés dynamiques.
- Mode archive autonome versionné et override local optionnel ; aucune modification automatique des settings de Zed, des exemples ou publication externe.
- Archives distinctes par plateforme à cause des dépendances natives ; contrôle des versions et intégrité avant lancement.

## À valider dans l’éditeur

- Installation de l’extension de développement et coexistence avec le serveur TypeScript.
- Affichage du hover et des actions sur sélection, expérience de renommage dans Zed.
- Sauvegarde/annulation multi-fichiers et comportement en cas de refus d’édition.
- Usage du dossier parent contenant plusieurs applications, au-delà du test de frontière projet.

## Avant publication

Le dépôt et le format archive sont décidés. L’utilisateur a autorisé le push des sources et la préparation du brouillon `v0.1.0` : sources/tag distants et dix assets du brouillon sont vérifiés. La publication publique et la licence du nouveau code restent à décider. Voir `docs/RELEASE-PUBLICATION.md` et `docs/RELEASE.md`.
