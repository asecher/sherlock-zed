# Préparation distante de v0.1.0

## État vérifié

- Dépôt : `https://github.com/asecher/sherlock-zed.git`.
- Sources poussées sur `main` ; fichiers générés, dépendances, archives et applications locales exclus.
- Tag annoté `v0.1.0`, objet `dbf4e5f35633662af0c8432ae809bd54843f9b05`, pointant sur le commit `dbdb794a4a6be09b2a38ffdd321d5039344cd61a`.
- CI de prévalidation sur main : `https://github.com/asecher/sherlock-zed/actions/runs/39039025053`, succès.
- CI du tag : `https://github.com/asecher/sherlock-zed/actions/runs/39039424749`, succès, cinq builds natifs et création du brouillon réussis.
- Release `Sherlock v0.1.0`, ID `415838806`, `draft: true`, `published_at: null` lors de la vérification.
- URL du brouillon : `https://github.com/asecher/sherlock-zed/releases/tag/untagged-b779d017af96255cb3bd` (accès propriétaire nécessaire tant qu’il reste brouillon).

L’utilisateur a autorisé le push et la préparation du brouillon, pas sa publication publique. Aucune action de publication publique n’a été exécutée.

## Archives effectivement téléversées et contrôlées

Chaque archive possède un sidecar `.sha256` contenant son basename exact. Les cinq sidecars ont été relus via l’API authentifiée ; leurs valeurs correspondent aux digests des archives fournis par GitHub. Les dix assets sont dans l’état `uploaded` avec une taille non nulle.

| Plateforme | SHA-256 de l’archive distante |
| --- | --- |
| `darwin-arm64` | `57ba565075cfbde66a73738161ad1e2b19660d439ddd53de51baa5dcca289854` |
| `darwin-x64` | `9615c4e17abd74ee22fae4cc761e034d3716de0970be9608955c95c4a6642987` |
| `linux-arm64` | `0e40df59a374542fae090ce2f3159e407b240f15738d21daca078a0df111709f` |
| `linux-x64` | `59ef09ed632714ca09ff55825832c16bac5a4bf82f006831e06c3d25df592c53` |
| `win32-x64` | `21f54f37464aeb97580edb6a6e54ad6985e01a3563963e2356719e0906fa8533` |

Noms : `sherlock-language-server-v0.1.0-<plateforme>.tar.gz` et le même nom suivi de `.sha256`. Ces digests décrivent le build distant du tag, pas l’archive locale produite précédemment.

## Validation multiplateforme

Les cinq runners ont exécuté la suite moteur (34 tests), les tests de release (6 tests), le typecheck, le build, le packaging et le smoke test SDK dans l’archive extraite hors checkout.

Les deux premiers essais ont révélé trois assertions de test dépendant de séparateurs Unix ; elles ont été corrigées avec `path.join` et `path.basename`. Aucun correctif du moteur n’a été nécessaire pour ces échecs Windows. Le tag n’a été créé qu’après une matrice complète réussie ; aucun tag distant n’a été déplacé ou forcé.

## Limites restantes

Une release brouillon n’est pas téléchargeable anonymement par l’extension. L’installation autonome réelle nécessite encore sa publication publique, puis un essai dans Zed sans override local. Les essais CI du serveur ne valident pas les appels réseau du host WASM de Zed.

Conserver l’override local fonctionnel tant que le brouillon n’est pas publié. La licence du nouveau code et la publication au registre des extensions Zed sont des sujets distincts de cette préparation de release.
