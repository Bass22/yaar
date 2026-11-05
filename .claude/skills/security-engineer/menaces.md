# Surfaces d'attaque de Yaar — ce qu'il faut vérifier

À parcourir pour les surfaces que la modification touche. Chaque point est une question : la réponse doit être « oui, et voici le test ».

## Tenancy et accès aux données

- Chaque nouveau modèle Prisma porte `tenant_id`, avec une politique RLS et un test d'isolation (un utilisateur du tenant A ne lit ni n'écrit une ligne du tenant B).
- Le tenant est fixé par transaction (`set_config('app.tenant_id', …, true)`), jamais par connexion ni par variable globale.
- Le rôle PostgreSQL applicatif n'est ni superutilisateur, ni `BYPASSRLS`, ni propriétaire des tables sans `FORCE ROW LEVEL SECURITY`. Les migrations utilisent un rôle distinct.
- Toute recherche par identifiant filtre aussi par tenant, et par site pour un collaborateur (pas d'accès direct à un objet par son seul identifiant).
- Aucune requête brute construite par concaténation : gabarits étiquetés de Prisma uniquement, jamais `$queryRawUnsafe` avec une entrée.
- Les tables de lecture analytiques et les marts dbt gardent `tenant_id` ; l'accès à la réplique se fait par un rôle en lecture seule.
- Les feature flags par tenant sont vérifiés côté serveur.

## Authentification et sessions

- PIN haché en argon2id, jamais journalisé, jamais renvoyé.
- Limitation des essais par numéro et par appareil, avec délai croissant ; réponse et durée identiques que le numéro existe ou non.
- JWT : algorithme fixé à la vérification, secret hors dépôt, durée courte, revendications minimales (tenant, rôle, portée par site, identifiant de session d'appareil).
- Session par appareil révocable par l'admin, et la révocation est effective à la requête suivante, synchro de l'outbox comprise.
- La création de compte et le changement de PIN sont réservés à l'admin du tenant et audités.
- Où le jeton est-il stocké dans la PWA ? La décision est ouverte (architecture §12) : ne la tranche pas seul, expose le compromis (exposition à une injection de script contre besoin de session longue hors-ligne).

## Ingestion du journal

- Auteur, tenant et appareil viennent de la session ; les mêmes champs dans la charge utile sont ignorés ou rejetés.
- Le site et la campagne appartiennent au tenant, le site est dans les affectations du collaborateur, la campagne n'est pas clôturée.
- Mode strict : seul le titulaire déclare — vérifié ici, pas dans la PWA.
- Idempotence : unicité sur (tenant, UUID). Un UUID rejoué avec un contenu différent n'écrase rien et laisse une trace.
- Bornes : date métier ni future ni antérieure à la campagne ; quantités entières et plausibles ; taille de lot plafonnée ; type d'événement dans une liste fermée.
- Une contre-déclaration référence un événement du même tenant et du même site ; elle ne permet pas de réécrire l'auteur ni la date de saisie d'origine.
- Aucune route ne modifie ni ne supprime un événement.

## Need-to-know et descente vers l'appareil

- Les réponses servies au rôle collaborateur ont leurs propres types, sans champ financier, et un test les parcourt pour le prouver (prix, montants, soldes, budget, ventes, tiers).
- La carte livraison porte la quantité attendue, jamais le prix.
- Le bundle des routes gardien n'embarque pas `domain/finance` : la règle de lint qui interdit cet import est active, et le build le confirme (aucun code d'argent dans les fichiers chargés par la vue gardien, imports transitifs compris).
- Le service worker du gardien ne met en cache que : coquille de l'app, clips audio, référentiels du site, campagne en cours, annonces, demandes de pesée, tâches.
- À la déconnexion ou à la révocation : purge des caches, de l'outbox déjà synchronisée et du stockage local. Que devient une outbox non synchronisée ? Elle ne doit être ni perdue ni lisible par le compte suivant.
- Le cache « dernière lecture » de l'admin est lié à la session et daté à l'écran.

## Médias

- Type vérifié sur le contenu, pas sur l'extension ni l'en-tête ; taille plafonnée ; durée des vocaux plafonnée.
- Aucun chemin de fichier construit à partir d'une entrée ; les fichiers ne sont pas servis depuis un dossier statique public.
- Lecture autorisée via l'événement référent (tenant, rôle). En-têtes `nosniff` et disposition de contenu adaptés.
- Métadonnées des photos (position GPS) : décision à prendre et à écrire — elles localisent l'élevage.
- La purge des vocaux supprime réellement le fichier ; le sujet tagué reste. Les images ne sont jamais supprimées par une route.
- Reçus et PV portent des données personnelles : loi 2008-12 et CDP Sénégal, clause CGU pour l'usage en entraînement.

## Notifications push

- Clé privée VAPID en variable d'environnement, absente du dépôt et du bundle.
- Charge utile minimale, sans montant ni donnée d'un autre site ; le contenu est relu dans l'app après ouverture.
- Abonnement lié à l'utilisateur, à l'appareil et au site ; supprimé à la révocation.
- L'URL ouverte au tap vient d'une liste fermée.

## Front (Angular, PWA)

- Aucun contenu saisi par un utilisateur (note, nom de tiers, tag de vocal) injecté en HTML ; pas de contournement de l'assainissement d'Angular.
- Politique de sécurité de contenu stricte, sans script en ligne ; polices et scripts auto-hébergés.
- Aucun montant dans une URL, un titre de notification ou un journal de console en production.
- Le partage du bilan (image WhatsApp) est sans montants par défaut ; la version complète demande un choix explicite.
- Un refus du serveur (401, 403) est géré à l'écran, y compris pendant la synchro de l'outbox.

## Infrastructure et secrets

- Une seule origine derrière Caddy : CORS non activé. En-têtes HSTS, CSP, `nosniff`, interdiction d'encadrement.
- PostgreSQL non exposé hors du réseau interne du compose ; conteneurs sans privilèges inutiles.
- Secrets fournis par l'environnement, jamais dans une image, un fichier compose ou un exemple versionné.
- Sauvegardes (base + volume médias) chiffrées et à accès restreint : elles contiennent tout.
- Dépendances : verrou versionné, audit sans vulnérabilité haute non traitée, aucune dépendance ajoutée sans besoin.

## Journalisation et audit

- Audit en ajout seul : connexion, création ou révocation de compte, contre-déclaration, modification d'un coût, fusion de types, changement de configuration d'un site.
- Les logs applicatifs ne contiennent ni PIN, ni jeton, ni montant, ni numéro de téléphone complet.
- Les erreurs renvoyées au client ne révèlent ni l'existence d'un objet d'un autre tenant, ni un détail d'implémentation.
