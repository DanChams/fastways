# FASTWAY — Post Studio

Application de calendrier éditorial créée à partir des deux maquettes fournies.

## Fonctionnalités
- Calendrier mensuel, années précédente/suivante, plusieurs publications par date.
- Projets libres et filtres par projet/statut.
- Fiche avec galerie, téléchargement de l'original importé, notes, commentaire et validation.
- Import de fichiers jusqu'à 25 Mo chacun, liens vers Google Drive.
- Export JSON des métadonnées du calendrier.

## Données
Cette version utilise Cloudflare D1 (publications) et R2 (fichiers), fournis par l'hébergement Sites. Ce ne sont pas des données locales au navigateur. L’audience du site est gérée depuis les paramètres Sites. Le propriétaire a rendu le site public après sa première publication. Ne pas exposer cette application sur un autre hébergeur sans ajouter une authentification serveur.

Le code source est disponible sur https://github.com/DanChams/fastways. Ce dépôt conserve le code ; il ne sert pas de base de données. Les modifications GitHub ne redéploient pas automatiquement le site. Supabase n’est pas configuré. Google Drive est relié par lien dans chaque fiche, sans OAuth ni synchronisation automatique. Les droits Drive s'appliquent toujours.

Le post initial du 1 septembre 2026 est un exemple extrait de la maquette, pas un fichier de production haute définition. L'initialisation est exécutée une seule fois ; supprimer l'exemple ne le recrée pas.

## Développement
Node >= 22.13. `pnpm install`, `pnpm dev`, `pnpm build`.
Schéma : `db/schema.ts`. Migrations : `pnpm db:generate`.
L'hébergement déclare les bindings `DB` et `BUCKET` dans `.openai/hosting.json`.
Pour un aperçu local, appliquer les migrations à la base locale avec Wrangler après le build.

## Atelier de création web

Le menu **Atelier de création** ouvre `/studio`. Les trois espaces partagent un aperçu Canvas 1080 × 1350 :

1. **Image produit** : importer le produit original et, facultativement, une référence d’ambiance, décrire le décor, générer une scène ou importer une image déjà finalisée. Réglages de zoom, position et contraste.
2. **Miniature** : utiliser la photo principale, importer une miniature indépendante ou masquer l’encart. Une miniature personnalisée sert aussi de couverture dans le calendrier.
3. **Textes** : écrire titre, prix et caractéristiques, régler taille et position, déplacer les blocs dans l’aperçu, éditer les mentions. Le logo fourni et le bandeau FASTWAY sont conservés par défaut. Un calque PNG transparent **4:5** peut remplacer le bandeau pour utiliser le template exact du propriétaire ; il doit être sans photo et sans textes variables. Effacer les champs de mentions si elles sont déjà présentes dans le calque.

Exporter en PNG ou enregistrer dans le calendrier au statut « En attente ». Le lien de confirmation ouvre la date choisie. Le brouillon est conservé dans IndexedDB sur ce navigateur, y compris ses images ; les fichiers JSON exportés permettent de le transférer et de le rouvrir. Le brouillon n’est pas synchronisé entre appareils. Les variantes générées restent disponibles pendant la session ; l’image sélectionnée reste dans le brouillon. L’image initiale de démonstration est identifiée comme exemple et ne peut pas être enregistrée sans import produit. La copie PNG finale est aplatie ; conserver le brouillon pour modifier les textes après export. Les répétitions d’un enregistrement après erreur réutilisent son identifiant et les fichiers déjà importés, y compris après rechargement du même onglet grâce à un journal sessionStorage. Les brouillons restent éditables lorsque le prix ou la date sont temporairement incomplets ; les données invalides bloquent uniquement la publication ou l’export.

### Génération et Transposition Visuelle

`GET /api/studio-image` indique si le service est configuré. `POST` appelle réellement OpenAI Images Edits, stocke le résultat dans R2 et renvoie un Asset. Avec une référence d’ambiance, la première image envoyée est la direction artistique, la deuxième est le produit strict. Le prompt serveur transpose lumière, cadrage, surfaces et décor en demandant de préserver forme, proportions, couleurs, graphismes et détails du produit. Il interdit tout ajout de texte, prix ou pictogramme dans cette étape. Les textes sont composés ensuite dans le navigateur, indépendamment. Il s’agit de la reprise des règles du plugin **Transposition Visuelle**, pas d’un appel au plugin de cette conversation. Une image générative peut malgré tout modifier des détails : vérifier le résultat avant validation et utiliser l’import manuel si nécessaire.

Le bouton **Vérifier la connexion IA** effectue un diagnostic non facturé (accès au modèle), distingue clé absente ou révoquée, modèle inaccessible, quota et incidents réseau. La présence d’une clé seule n’est jamais présentée comme une connexion vérifiée ; le diagnostic ne prouve pas le crédit disponible pour une génération.

Configurer la clé **`IMAGE_API_KEY`** dans les secrets de l’hébergement Cloudflare/Sites (ou `.dev.vars` ignoré par Git pour un développement local), jamais dans le navigateur ni dans Git. Le service lit aussi `OPENAI_API_KEY` si déjà injectée, puis le nom de liaison historique de cette installation. `IMAGE_API_KEY_BINDING` permet de désigner explicitement un autre binding serveur existant, sans copier le secret. Le nom du binding n’est pas la valeur de la clé. Le modèle serveur facultatif `IMAGE_MODEL` vaut par défaut `gpt-image-1.5`. Le compte doit autoriser ce modèle et disposer du budget requis. Destination HTTPS : `api.openai.com`. Une exigence de secret ajoutée aux paramètres de l’environnement Codex ne fournit pas sa valeur et ne configure pas automatiquement l’hébergement du site : ajouter le binding dans chacun des contextes utilisés.

Pour limiter les appels facturés, la génération exige une identité ChatGPT injectée par l’hébergement hors localhost. Configurer l’audience/authentification du site ; le serveur de prévisualisation local autorise localhost sans connexion. L’application existante ayant des routes de calendrier publiques, rendre l’audience du site privée avant d’y conserver des données non publiques. Quotas fixes : une tentative/minute, cinq/jour/utilisateur et trente/jour/site (jours UTC), y compris les échecs. Les réservations et l’idempotence sont persistées dans `settings`, sans migration supplémentaire. Les identifiants de génération sont conservés dans sessionStorage et réutilisés après interruption réseau, y compris après rechargement. Une réponse ambiguë conserve un état indéterminé : aucune deuxième requête payante n’est lancée automatiquement. Une image déjà écrite dans R2 peut être récupérée par son identifiant déterministe. Le résultat réel du service reste à vérifier lorsqu’une clé sera fournie ; aucun résultat simulé ne masque l’absence de configuration.

### Vérifications

`pnpm build`, `pnpm exec tsc --noEmit --incremental false`, `pnpm lint` et `node --test lib/studio-image-server.test.mjs`. Les tests serveur contrôlent les formats, tailles, l’idempotence, l’exception localhost, les rôles des images et l’ordre multipart. Les vérifications navigateur ont couvert édition, miniature indépendante, export PNG, brouillon, sauvegarde D1/R2 et responsive mobile. Pour reproduire l’automatisation navigateur : installer Playwright Core dans un répertoire temporaire et exécuter `tests/studio-browser.mjs` avec `PLAYWRIGHT_MODULE` pointant vers son `index.mjs`, et `STUDIO_BASE_URL` vers le serveur local. Ce test n’appelle pas de service IA facturé, crée ses publications dans la base locale puis les supprime. Le site publié doit être redéployé pour recevoir le nouveau code ; publier l’environnement de développement ne redéploie pas le site.

Après audit : `node --test lib/studio-image-server.test.mjs lib/post-validation.test.mjs tests/studio-data.test.mjs tests/studio-client.test.mjs` exécute les régressions serveur, données et reprise client. `tests/studio-recovery-browser.mjs` simule uniquement les erreurs réseau/clé dans le navigateur, sans appel IA facturé ; `tests/studio-renderer-browser.mjs` vérifie les dispositions Canvas. Utiliser les mêmes variables Playwright et URL locale que ci-dessus.

`pnpm start` charge explicitement les fichiers facultatifs `.env`, `.env.local` et `.dev.vars` depuis la racine du dépôt, même si la configuration Wrangler est dans `dist/server`. Le séparateur Node `--` préserve les arguments Wrangler `--env-file`. Les fichiers `.dev.vars*` sont ignorés par Git. Ne pas commiter les valeurs des clés.

## Points à connaître
- Export JSON : métadonnées et liens uniquement ; télécharger les fichiers séparément.
- Une suppression de post retire la fiche ; les blobs restent dans le stockage pour éviter de casser d'autres références.
- L'application organise les posts, sans publication automatique sur les réseaux sociaux.
- Une migration vers Supabase demanderait de remplacer les routes de stockage et de configurer un projet Supabase avec authentification et règles d'accès.

## Application
https://fastway-post-studio.danindec.chatgpt.site

## Visuels
Affichage intégral 4:5 (1080 × 1350) et miniature indépendante, importée ou choisie parmi les visuels de la publication.

## Dossier Google Drive
Le dossier de référence fourni par le propriétaire est configuré par la variable serveur `DRIVE_FOLDER_URL` dans l’hébergement (à ne pas commiter). Le lien est transmis aux visiteurs de l’application ; les autorisations restent gérées dans Google Drive. Le menu, les fiches et le formulaire donnent un accès direct au dossier. Un lien spécifique par post prend priorité. Aucun contenu Drive n’est récupéré ou transféré automatiquement ; une intégration Google Drive API avec autorisation d’accès distincte serait nécessaire pour automatiser les envois.

## Mobile
Sur téléphone : calendrier compact sans défilement horizontal, sélection du jour et cartes 4:5 lisibles, menu refermé après sélection, formulaires pleine hauteur avec commandes accessibles. Les champs utilisent 16 px et le zoom du navigateur reste autorisé.
