# Publication FASTWAY Creative Studio

Version préparée pour le projet Sites existant : `appgprj_6ab79524b9408191a98c1ccc0966e1ae`.
Site : https://fastway-post-studio.danindec.chatgpt.site
Atelier : `/studio`.

## Destination et contenu

Publier cette version depuis l'hébergement **Sites du projet existant**, en conservant ses ressources et son audience. Le code est livré sur la branche `codex/fastway-creative-studio`. Un push GitHub ne redéploie pas automatiquement ce site.

Construction reproductible : Node >=22.13, pnpm11.25.0, `pnpm install --frozen-lockfile`, puis `pnpm build`. Le contenu de publication est **l'ensemble de `dist/`**, avec `dist/.openai/hosting.json` et ses migrations, pas seulement `dist/server/`.

La configuration Wrangler générée est destinée au développement : nom de starter et identifiant D1 `00000000-0000-4000-8000-000000000000`. Ne pas utiliser `wrangler deploy` avec cette configuration pour remplacer le site existant. L'hébergement Sites doit rattacher ses propres ressources de production.

## Configuration à conserver sur l'hébergement

- Binding `DB` : conserver la base D1 existante et ses publications.
- Binding `BUCKET` : conserver le stockage R2 existant et ses fichiers.
- Secret serveur `IMAGE_API_KEY` ou binding historique déjà enregistré : ne pas copier sa valeur dans le code ni le navigateur. Le code reconnaît les noms standards et le nom historique de cette installation. `IMAGE_API_KEY_BINDING` permet de sélectionner explicitement un autre nom existant.
- `IMAGE_MODEL` facultatif : `gpt-image-1.5` par défaut. Accès HTTPS requis vers `api.openai.com`.
- Conserver `DRIVE_FOLDER_URL` s'il est déjà configuré.
- La génération payante exige l'identité ChatGPT injectée par l'hébergement. Conserver la protection et l'authentification gérées par Sites.

Les secrets de l'environnement de développement Codex ne sont pas automatiquement ceux de l'hébergement. Au dernier contrôle, le binding sécurisé était enregistré dans la configuration Codex mais absent du serveur local actif : sa validité et la génération réelle restent à vérifier sur l'hébergement.

## Validation après publication

1. Ouvrir `/studio` avec le compte autorisé : les trois onglets et l'aperçu doivent apparaître.
2. Utiliser « Vérifier la connexion IA » : contrôle non facturé de la clé et de l'accès au modèle. Ce contrôle ne prouve pas le crédit disponible pour générer.
3. Importer la référence d'ambiance puis le produit ; générer une image, en vérifier les détails, ajouter la miniature et les textes.
4. Exporter le PNG et enregistrer une publication ; vérifier sa date et ses fichiers dans le calendrier.

## État vérifié avant publication

- TypeScript et compilation réussis.
- Lint : zéro erreur ; dix avertissements liés aux images HTML.
- 36 tests serveur/données/reprise client passent.
- Parcours navigateur local : miniature indépendante, textes, export PNG1080×1350, brouillons et calendrier.
- Reprises réseau simulées : même identifiant de génération après rechargement, aucune deuxième génération payante ; même publication et fichiers après réponse perdue.
- Canvas : quatre dispositions valides et six cas d'erreur vérifiés.
- Fichiers de configuration locaux : chemin racine et démarrage sans fichiers facultatifs vérifiés avec une donnée temporaire non secrète.
- Aucun appel IA réel validé faute de clé injectée. Aucune publication sur Sites effectuée depuis cette session.

Point de code précédent : `74183abe140ead9bf35db809f9a11615369ea321`. La publication ne doit ni remplacer ni vider la base et le stockage existants.
