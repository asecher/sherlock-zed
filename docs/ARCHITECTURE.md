# Architecture implémentée — première tranche SDK

## Décision utilisateur

L’utilisateur valide le SDK officiel et le démarrage de l’implémentation. La base retenue est **Rust/WASM + LSP Node.js + `@inlang/sdk`**, et non l’utilisation inchangée du serveur tiers `inlang-language-server`.

Le dépôt `NEKOYASAN/inlang-zed` et son serveur ont servi à étudier l’intégration et à reproduire des défauts ; le moteur local est original et ne dépend pas de ce serveur. La sonde historique reste séparée dans `spikes/`.

## Flux

```text
Zed
 ├─ extension Rust/WASM : sélection d’une commande locale configurée
 └─ JSON-RPC LSP sur stdio
      └─ Node.js : documents ouverts, AST TypeScript, projets et éditions
           └─ @inlang/sdk 4.0.4
                └─ memfs isolé + plugins message-format 4.4.0 / 4.5.0 épinglés
```

Le LSP est un processus enfant local, pas un serveur HTTP. Aucun téléchargement automatique n’a lieu au lancement de l’extension. Le runtime et le script sont configurés explicitement dans Zed.

## Modules

| Fichier | Responsabilité |
| --- | --- |
| `src/lib.rs` | Adaptateur Zed et validation de commande locale |
| `server/src/main.ts` | LSP hover, code actions, prepareRename/rename, buffers et versions |
| `server/src/sdk-project.ts` | Chargement isolé du SDK, aperçu, insertion et export/renommage |
| `server/src/syntax.ts` | AST, imports, scope lexical, références et sélections sûres |
| `server/src/keys.ts` | Génération déterministe et collisions |
| `server/src/projects.ts` | Découverte du projet, frontière workspace, scan source borné |
| `server/test/` | Tests réels du SDK, régressions et processus LSP |

## Pourquoi isoler le SDK

Le code du SDK inspecté peut enregistrer des métadonnées au chargement. L’adaptateur copie donc uniquement les settings et catalogues autorisés dans un volume memfs neuf ; il ne lui transmet jamais le système de fichiers hôte. Les modules de settings sont validés, retirés de la configuration en mémoire et remplacés par les plugins npm épinglés fournis explicitement.

Les caches, `.meta.json`, `.lix`, plugins locaux et `.env` du projet ne sont pas chargés. Les tests interdisent les fetchs pendant l’ouverture et comparent les empreintes des copies avant/après. Cela évite les écritures hôte du SDK ; ce n’est pas un sandbox général pour du JavaScript arbitraire, qui n’est justement pas accepté.

## Données et éditions

Les messages sont lus et modifiés via les tables officielles du SDK et exportés par le plugin, pas réécrits avec un schéma maison. Les versions 4.4.0 et 4.5.0 correspondent aux exemples. Les paramètres/configurations non pris en charge sont refusés explicitement. Les variantes et métadonnées existantes sont conservées lors du renommage.

Chaque requête ouvre un état isolé à partir du disque et des catalogues ouverts non sauvegardés. Cette stratégie est volontairement simple et peut être lente sur de gros projets ; un cache ne devra être ajouté qu’avec une invalidation testée et sans affaiblir les garanties.

Une action d’extraction contient uniquement un `WorkspaceEdit` complet : import éventuel + appel source + export du catalogue de base. Pas de commande dépendant d’un effet de bord après l’édition. Renommer coordonne les références statiques reconnues et les locales possédant le message. Les buffers ouverts portent leur version ; le contenu des fichiers fermés est recontrôlé avant réponse. Une modification externe après la réponse ou un refus partiel du client n’est pas une transaction atomique garantie.

Les instantanés de renommage sont capturés avant tout `await` et le document initiateur est revalidé même si son ancienne référence disparaît. Pour éviter de perdre un catalogue ouvert via un alias, les requêtes d’édition refusent explicitement les workspaces/documents ouverts par des liens symboliques ou alias de chemin ; l’erreur indique le chemin canonique à rouvrir.

## Périmètre réel

Les deux exemples fournis utilisent Remix 3/TSX et Paraglide, avec un import namespace direct ou `m` réexporté via `app/i18n.ts`. Le support reste limité à ces familles d’imports et aux appels statiques. Les fichiers générés sont exclus ; un renommage ne modifie pas les références dynamiques qu’il ne peut pas prouver.

L’extraction refuse les sélections partielles, contextes de type/import/CSS, templates dynamiques, entités JSX, texte JSX multiligne et placeholders sans mapping. Le survol des messages existants restitue les variables sous forme `{name}`.

## Références et provenance

- SDK officiel inspecté et installé : `@inlang/sdk@4.0.4`, README et `src/project/{loadProjectFromDirectory,saveProjectToDirectory}.ts` du paquet npm.
- Plugins officiels : `@inlang/plugin-message-format@4.5.0` et alias npm de `4.4.0`.
- Adaptateur compilé contre `zed_extension_api = 0.7.0`, API publiée.
- Intégration préalablement étudiée : `NEKOYASAN/inlang-zed` commit `402d5e86ec2650cf162d0979600a1b092731d746` et serveur `dfcbdb024a4a9f017b64036813ae83538d2cb1b7`.
- Sherlock étudié pendant le cadrage : commit `5b72277cab92dde95f3ad6b756b65853729b0e63`.

Aucun code de ces extensions n’a été copié dans le moteur local. Les dépendances npm/Cargo restent sous leurs licences respectives. La licence et les métadonnées de publication du nouveau projet sont encore à définir avant distribution publique.
