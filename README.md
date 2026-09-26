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
