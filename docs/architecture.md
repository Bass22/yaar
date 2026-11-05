# Architecture technique — Pilotage avicole

Nov 1, 2026 · @Bass

> Document de référence technique : il décrit **comment** le produit est construit et déployé. Le **quoi** fonctionnel (modules, écrans, règles métier, UX) est détaillé dans Doc.

> **Décisions postérieures (2026-11-05)** — elles priment sur le texte ci-dessous, voir `CLAUDE.md` :
> - **Langue du code** : identifiants, fichiers et dossiers en anglais, comme l'ERP Travaux. Le « langage omniprésent » du §4 reste celui du métier, mais il s'écrit en anglais dans le code (table de correspondance : `CLAUDE.md` §6). Les noms de modules du §4 se lisent comme des noms métier.
> - **Arborescence (§10)** : `packages/design-cahier` s'appelle `packages/design-system` ; `packages/kit` accueille les briques communes aux produits de la maison, reprises de l'ERP Travaux.
> - **Domaine partagé (§4)** : `packages/domain` a deux points d'entrée, `journal` (partagé avec le téléphone) et `finance` (jamais dans les routes gardien).
> - **Conteneurs (§9)** : trois conteneurs et non quatre — Caddy sert lui-même le web statique (image `web`), comme dans l'ERP Travaux. Deux réseaux : `edge` (Caddy ↔ API) et `data` (API ↔ base, sans sortie) ; seul `web` publie un port. Le mot de passe de la base s'appelle `DB_PASSWORD` et il est exigé. Fichiers : `infra/docker-compose.yml`, `infra/caddy/Caddyfile`, `infra/docker/*.Dockerfile`.
> - **Versions** : stables recommandées — Angular 21 (LTS), NestJS 11, Vitest pour le web et les packages, Jest pour l'API.

Produit de **pilotage d'élevages avicoles** : journal de terrain tenu par le gardien (hors-ligne, pictos, audio) + bureau financier du gérant. Vendu en SaaS multi-tenant à bas prix, FCFA (XOF) par défaut, exigence d'accessibilité maximale (utilisable par une personne ne sachant pas lire) — la même famille d'exigences que l'ERP Travaux, possée un cran plus loin.

## 1. Principes directeurs

- **Une maison, une stack** : mêmes choix que l'ERP Travaux (TypeScript de bout en bout, Angular + NestJS, PostgreSQL, Docker, Caddy, monorepo Nx). Deux produits, un seul outillage, des briques partagées (FCFA, accessibilité, tenancy) — et une équipe qui circule de l'un à l'autre.
- **Hors-ligne d'abord** : le poulailler n'a pas toujours de réseau. Toute déclaration du gardien fonctionne sans connexion ; la synchronisation est un détail d'exécution, jamais une condition.
- **Le journal est la vérité** : le serveur enregistre des événements immuables signés ; les états (soldes, vivants, coûts) sont des projections recalculables.
- **SPA statique + API REST, PWA installable** : pas de rendu serveur (application derrière connexion, pas de SEO) ; installation écran d'accueil + push sur Android bas de gamme.
- **SaaS mutualisé d'abord, option on-premise préservée** : les clients sont de petits élevages — la V1 n'expédie que le SaaS. Mais la porte on-premise reste ouverte « au cas où » (décision fondateur, nov. 2026), à coût maintenu bas par trois règles : aucun service cloud propriétaire (PostgreSQL, fichiers derrière un port de stockage — volume local ou S3-compatible, push standard VAPID) ; le `docker-compose` de production reste auto-hébergeable tel quel ; une instance on-premise = le même code en mono-tenant (`tenant_id` et RLS restent). L'isolation logique par tenant est en place dès le premier jour.
- **Tout conteneurisé (Docker)** : le compose de développement est celui de la production, à la configuration près.

## 2. Vue d'ensemble

&#91;embedded content: composants à l'exécution · une instance\]

Le worker envoie les Web Push qui réveillent la PWA ; la couche analytics (dbt, §8) lit une réplique de PostgreSQL, hors de ce chemin d'exécution.

## 3. Stack retenue & justification

Recommandation : **la stack de l'ERP Travaux, reprise à l'identique**, avec trois approfondissements propres à ce produit (hors-ligne, push, audio).

| Couche | Choix | Notes |
| --- | --- | --- |
| Front | Angular (SPA statique, PWA via @angular/pwa) | Standalone components + lazy loading pour rester léger sur Android bas de gamme ; vue gardien = bundle minimal |
| UI | PrimeNG + Angular CDK | Le bureau admin est dense (type ERP) ; le design signé « cahier » reste du CSS/SVG maison porté des maquettes |
| Back | NestJS (Node.js, TypeScript) | Modules par domaine, mêmes conventions que l'ERP |
| ORM | Prisma + migrations | — |
| Base | PostgreSQL | RLS pour la défense tenant ; réplique lecture pour l'analytics |
| Hors-ligne | Service worker + IndexedDB (Dexie) | Outbox d'événements, détail §5 |
| Push | Web Push standard (clés VAPID) | Pas de dépendance Firebase obligatoire |
| Infra | Docker, Caddy (HTTPS auto), volume fichiers SHA-256 | Identique à l'ERP |
| Analytics | Python + dbt sur réplique Postgres | §8 — hors chemin applicatif |

**Pourquoi cette stack** :

1. **Mutualisation de portefeuille** : tu construis deux produits (ERP Travaux, pilotage avicole) qui partagent FCFA, accessibilité non-lecteurs, tenancy, PWA. Une seule stack = des packages partagés, un seul CI, des modèles de déploiement identiques, et chaque leçon apprise sert deux fois.
2. **Types partagés front/back** (packages/shared) : les contrats d'événements (déclaration, écart, pesée) sont la colonne vertébrale du produit — les avoir typés une fois pour Angular et NestJS élimine toute dérive de schéma entre l'outbox du téléphone et l'API.
3. **L'investissement existe déjà** : architecture éprouvée, compose, Caddyfile, conventions — le coût marginal du second produit chute.

**Pourquoi pas Django/Python, honnêtement** : c'est ton terrain personnel (admin gratuite, ORM mûr), et ce serait le bon choix si tu codais seul l'application à long terme. Mais il couperait ton portefeuille en deux stacks, sans partage de types ni d'infra — et ta force Python n'est pas sacrifiée : **la couche analytics reste en Python/dbt quelle que soit la stack applicative**, car dbt attaque Postgres directement. La vraie question n'est donc pas « Python ou TypeScript » mais « qui maintient le code applicatif » — décision §12.

## 4. Architecture applicative (back)

**Clean Architecture — autant que nécessaire** (décision fondateur, nov. 2026). Le cœur métier est isolé des frameworks ; Nest, Prisma et Angular sont des détails aux frontières :

- **`domain`** (TypeScript pur, zéro import Nest/Prisma/Angular) : les règles du cahier des charges — facturable = min(reçu, qté) × PU, dette = payé − facturable, coût reconnu à la réception, contre-déclarations, agrégats de campagne, comparaison aux courbes de souche. Testable unitairement, sans base ni serveur.
- **`application`** : cas d'usage (déclarer, réceptionner, régler, clôturer) orchestrant le domaine à travers des **ports** (dépôts, stockage de fichiers, push, horloge).
- **`infrastructure`** : adapters — Prisma pour les dépôts, volume local *ou* S3-compatible pour les fichiers, web-push. C'est la seule couche qui change entre cloud et on-premise ; le reste ne bouge pas.
- **`interface`** : contrôleurs REST + DTO de validation, composants Angular.

Pragmatisme assumé (« autant que nécessaire ») : les CRUD de référentiels et les lectures (tableaux de bord) interrogent Prisma en direct, sans cérémonie ; seules les **écritures du journal et les règles d'argent** traversent systématiquement le domaine pur. Dividende du monorepo : la lib `domain` est consommée **par l'API et par la PWA** — le téléphone valide hors-ligne avec exactement le même code métier que le serveur.

**Et le DDD ? On y est déjà — version utile.** La Clean Architecture dit *où ranger* le code ; le DDD dit *comment le nommer et où tracer les frontières* : **langage omniprésent** — le code parle le français du métier (campagne, bande, déclaration, contre-déclaration, réception, écart, bonus, facturable, dette, échéance, clôture, souche), le même du clip audio wolof au modèle dbt ; **contextes bornés** = les modules (journal, commandes-réceptions, argent, référentiels, suivi), l'Analytics étant un contexte de lecture séparé (réplique + dbt) ; **agrégats et invariants** là où ça compte — Campagne (effectif, clôture), Commande (lignes, réceptions partielles, facturable = min(reçu, qté) × PU), Déclaration (immuable, corrigée par contre-déclaration), Règlement ; **value objects** — Montant FCFA en entier (jamais de flottant), quantités en sacs/paquets, poids en grammes. Et pas de cérémonie : ni repository générique, ni factory systématique, ni event-sourcing serveur généralisé — le journal est événementiel parce que le métier l'est, le reste est de la table ordinaire avec audit.

**Performances : le design « cahier » n'a pas le droit de coûter** (téléphones cibles : Tecno/Infinix d'entrée de gamme). L'essentiel du style est gratuit à l'écran — dégradés lignés, bordures irrégulières, ombres dures sans flou, légères rotations. Les vrais dangers et leurs parades :

- **Le filtre SVG « main levée » (turbulence + displacement) est interdit à l'exécution en production.** Le tremblé des pictos est pré-cuit au build (chemins SVG déjà déformés, générés une fois) — même rendu, zéro coût au scroll. Les maquettes HTML l'utilisent à l'exécution par commodité de démo, pas le produit. Jamais de filtre ni d'ombre floue sur un conteneur qui défile ; on n'anime que transform et opacity (tampon et pulsation du micro compris, jamais box-shadow).
- **Polices** : Shantell Sans et Andika auto-hébergées (précachées par le service worker — le hors-ligne l'exige de toute façon), woff2 sous-ensemblées latin, font-display: swap, préchargées.
- **Réflexes d'app** : journal virtualisé (CDK virtual scroll) dès quelques dizaines d'entrées, content-visibility: auto sur les sections, Angular en OnPush/signals, le cadran de pesée manipulé hors zone de change detection.
- **Budget perf en CI** : Lighthouse en throttling mobile — démarrage < 2,5 s sur 3G, bundle initial de route < 200 Ko gzip — et un vrai Tecno Spark au bureau comme machine de référence des tests.

Organisation en **modules NestJS**, un par domaine :

- `auth` — téléphone + PIN, JWT ; conçu compatible OIDC (jamais prioritaire ici).
- `tenants` — élevages, résolution du tenant courant, feature flags par module.
- `users` — rôles (admin, collaborateur, investisseur V2), titulaire par site, affectations.
- `sites` / `campagnes` — poulaillers, bandes, phases, configuration (balance, protocole sanitaire), budget prévisionnel par poste (pré-rempli depuis l'historique) et échéances récurrentes (salaire, eau) génératrices de dettes à date.
- `journal` — **le cœur** : ingéré des événements (morts, sacs, réceptions, pesées, tâches, zéros, vocaux, photos), idempotence par UUID, contre-déclarations.
- `commandes` — commandes multi-lignes (en-tête + lignes), annonces au gardien, réceptions partielles cumulées par ligne, paiements multiples découplés, statuts (brouillon → annoncée → partiellement reçue → reçue → soldée).
- `tiers` — grand livre des tiers : dettes et créances issues des commandes (reçu/payé), des coûts directs à payer, des ventes à crédit et des avances de collaborateurs ; règlements partiels ; soldes en francs et en nature.
- `couts` / `ventes` — écritures financières de l'admin, justificatifs, duplication, statut payé / à payer.
- `pesees` — demandes planifiées, validation, courbe de poids.
- `referentiels` — socle éditeur + extensions tenant, drapeaux fixe/variable et commandable, archivage ; souches et espèces (courbes de poids cibles par âge, protocoles sanitaires par défaut).
- `notifications` — Web Push, abonnements par appareil, gabarits de messages.
- `medias` — dépôt, classes de rétention, archivage planifié — jamais de suppression (réserve d'entraînement ML).
- `parametres` — seuils d'alerte, langues/clips audio, devise, catalogue de prix par défaut (seedé à la création, auto-appris : le dernier prix utilisé devient le défaut).
- `audit` — journalisation des connexions et actions sensibles.

Règles transverses (reprises de l'ERP) :

- Le **moteur métier est un domaine pur**, sans dépendance à la base ni au framework : calcul des soldes tiers, coût engagé et coût/poulet à date, écarts signés (manque/bonus), moyenne et courbe de poids, verdicts d'alerte. C'est le cœur de valeur → couverture de tests unitaires prioritaire.
- **API REST versionnée** (`/api/v1/...`), DTO validés (class-validator ou Zod), contrats partagés dans `packages/shared`.
- Toute action sensible est **journalisée**.

## 5. Hors-ligne & synchronisation

Là où l'ERP Travaux prévoit une « file de saisies » en lot 5, ce produit la met **au cœur du lot 1** : le gardien déclare sans réseau, tous les jours.

- **Outbox locale** (IndexedDB via Dexie) : chaque déclaration = un événement `{uuid, tenant, site, campagne, type, quantité, date métier, auteur, horodatage}` empilé localement, marqué « en attente » à l'écran (pastille de synchro).
- **Synchronisation** : dès le retour du réseau (et à l'ouverture), POST par lots ; le serveur est **idempotent par UUID** — un doublon de synchro est ignoré, jamais compté deux fois.
- **Pas de réplication d'état** : on ne synchronise que des faits append-only ; les conflits n'existent pas (deux déclarants = deux événements). Les corrections sont des contre-déclarations, elles suivent le même chemin.
- **Descente** (pull) : référentiels du site, campagne en cours, annonces de livraison, demandes de pesée, tâches du jour — un cache léger, jamais de données financières sur le téléphone du gardien.
- **Service worker** : précache de l'app shell **et des clips audio** de la langue du site (l'audio doit marcher hors-ligne) ; `navigator.storage.persist()` demandé à l'installation pour protéger l'outbox d'une purge navigateur ; manifest PWA : icônes 192/512 px (maskable, fond vert forêt #1E4530) et écran de lancement aux couleurs de l'icône.
- **Option réservée — mode 100 % hors-ligne (version ultérieure, décision fondateur nov. 2026)** : l'app complète (consultation, validation, calculs) sans réseau durable, sur téléphone comme sur ordinateur (la PWA s'installe sur les deux). Rien à construire en V1, mais cinq règles à ne pas violer pour garder la porte ouverte : identifiants générés côté client (UUID, jamais de séquence serveur) ; règles métier dans `packages/domain`, exécutables des deux côtés ; vues d'écran dérivables du journal (aucune vue qui n'existe qu'en SQL serveur) ; synchro pensée comme réplication du journal par curseur, descente comprise, bornée par le rôle (need-to-know : le téléphone du gardien ne reçoit jamais les données financières) ; auth téléphone+PIN vérifiable localement après la première connexion. Le journal complet d'une campagne pèse quelques Mo au plus — la réplique tient sur n'importe quel téléphone d'entrée de gamme.
- **Médias hors-ligne** : photos/vocaux compressés côté client puis mis en file comme les événements, envoyés en différé ; l'événement référence le média par empreinte.
- Le bureau admin est online-first (avec cache de dernière lecture marqué « données du JJ/MM »).

## 6. Tenancy, authentification & sécurité

- **`tenant_id` sur chaque table et chaque requête** ; règle d'or identique à l'ERP : aucune requête sans filtre tenant, garantie par une garde NestJS + la couche d'accès, renforcée par le **RLS PostgreSQL**. Schéma partagé, une seule base : des centaines de petits élevages à bas prix, l'isolation physique serait de la sur-ingénierie.
- **Authentification** : numéro de téléphone + code PIN (argon2), avatar de reconnaissance à l'écran ; JWT access (TTL à trancher comme sur l'ERP, §12) ; sessions par appareil, révocables par l'admin (téléphone perdu).
- **Autorisation** : RBAC simple (admin / collaborateur / investisseur V2) + portée par site pour les collaborateurs ; le rôle détermine aussi **ce qui est synchronisé vers l'appareil** (need-to-know : rien de financier chez le gardien).
- **Audit** : chaque événement porte auteur + appareil + horodatage ; les actions admin sensibles (correction, fusion de types, suppression de compte) sont journalisées.
- **Mode strict** par site (seul le titulaire déclare) = une simple politique vérifiée à l'ingestion, jamais un verrou côté client.

## 7. Médias & notifications

**Médias** — même patron que l'ERP (volume dédié, fichiers adressés par empreinte SHA-256, pas de stockage objet tant qu'une machine suffit ; S3/MinIO deviendrait un simple adaptateur au second hôte), avec une spécificité : **deux classes de rétention** portées par le modèle de données —

- *preuve opérationnelle* (photos de pesée, vocaux, photos de problème) : compressée côté client (\~800 px / ≤ 90 s), photos : archivage froid après validation + délai, jamais supprimées (réserve d'entraînement ML) ; vocaux : purgés après traitement + délai, leur sujet tagué et l'action prise restant au journal ;
- *pièce justificative* (reçus, PV de réception) : conservée sur la durée légale/contractuelle, archivage froid à la clôture, jamais purgée sans règle explicite.

Un job planifié (module `medias`) applique les politiques ; l'archivage est un comportement du système, pas une tâche humaine — et la suppression n'existe que pour les vocaux ; toute image finit en stockage froid (tier archive S3-compatible, derrière le port de stockage), indexé par son événement d'origine (type, campagne, poids déclaré…) pour l'entraînement futur des modèles.

**Notifications** — Web Push standard (clés VAPID, service worker), sans dépendance Firebase imposée :

- abonnements par appareil, rattachés à l'utilisateur et au site ;
- chaque push est doublé d'une carte in-app (le push n'est jamais la source de vérité) ; un tap ouvre l'app qui lit le message à voix haute ;
- gabarits : annonce de livraison, demande de pesée, rappel du soir, vocal reçu, seuil d'alerte franchi ;
- TTL adapté par type de message ; SMS de secours (agrégateur local) en V2 pour 2–3 alertes critiques.

## 8. Couche analytics (Python + dbt)

La force data du fondateur vit ici, **hors du chemin applicatif** — quelle que soit la stack de l'application.

- **Source** : réplique en lecture de PostgreSQL (ou la base elle-même au début) ; les événements immuables sont un modèle source idéal pour dbt.
- **Transformation** : projet dbt — staging des événements, `fct_campagne` (coûts par poste, pertes et leur timing, pesées, délais entre bandes), marts du module Analytics (coût de revient à date et projeté, fixe/variable, point mort, comparaisons multi-campagnes et multi-sites, benchmark anonymisé en V3).
- **Restitution** : les marts alimentent l'API (tables de lecture dédiées) qui sert l'onglet Suivi et le futur module Analytics ; pas de BI externe imposée.
- **Cadence** : batch planifié (horaire suffit largement) ; les KPI temps réel de la V1 (engagé, coût/poulet, soldes) restent calculés par le moteur métier applicatif — l'analytics enrichit, il ne bloque jamais l'écran du jour.
- **Bénéfice stratégique** : les tests dbt (not null, unicité, bornes) deviennent le contrôle qualité continu des données de tous les tenants.

## 9. Déploiement & conteneurisation

Mode nominal : **SaaS mutualisé**, une instance, N élevages. Caddy → Angular statique + API NestJS + PostgreSQL + volume de fichiers (+ worker de jobs pour archivage médias et push planifiés). Le `docker-compose` de développement est celui de la production — et celui d'un éventuel on-premise (même bundle, un seul tenant).

```yaml
services:
  caddy:
    image: caddy:2
    ports: ["80:80", "443:443"]
    volumes:
      - ./caddy/Caddyfile:/etc/caddy/Caddyfile
      - caddy_data:/data
    depends_on: [api, web]
  web:            # Angular buildé (PWA), servi en statique
    build: ./apps/web
  api:            # NestJS
    build: ./apps/api
    environment:
      DATABASE_URL: ${DATABASE_URL}
      JWT_SECRET: ${JWT_SECRET}
      MEDIA_PATH: /data/medias
      VAPID_PUBLIC_KEY: ${VAPID_PUBLIC_KEY}
      VAPID_PRIVATE_KEY: ${VAPID_PRIVATE_KEY}
      DEFAULT_CURRENCY: XOF
    volumes: ["medias:/data/medias"]
    depends_on: [db]
  db:
    image: postgres:16
    environment:
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes: ["db_data:/var/lib/postgresql/data"]
volumes:
  caddy_data: {}
  db_data: {}
  medias: {}
```

- **Hébergement** : une machine suffit longtemps ; privilégier un datacenter régional si la résidence des données devient un argument commercial (§12).
- **Sauvegardes** : `pg_dump` + archive du volume médias (la base seule mentirait — même leçon que l'ERP).
- **Clips audio** : assets statiques versionnés par langue, servis avec l'app et précachés par le service worker.
- On-premise : pas en V1, mais **préservé comme option** — les trois règles qui le gardent possible sont actées (voir Déploiement). Licence hors-ligne : à traiter le jour où un client la paie.

## 10. Arborescence du dépôt & mutualisation

Monorepo **Nx**, calqué sur l'ERP Travaux :

```
pilotage-avicole/
├─ apps/
│  ├─ web/                 # Angular (SPA + PWA : vues gardien & admin)
│  └─ api/                 # NestJS
├─ packages/
│  ├─ domain/              # cœur métier pur (argent, journal, courbes) — consommé par web ET api
│  ├─ shared/              # types & DTO des événements, contrats d'API
│  └─ design-cahier/       # design system « cahier » : tokens, pictos SVG, tampons
├─ analytics/
│  └─ dbt/                 # projet dbt (staging événements → fct_campagne → marts)
├─ audio/                  # scripts des phrases + clips par langue (wo/, fr/)
├─ infra/
│  ├─ docker-compose.yml
│  ├─ caddy/Caddyfile
│  └─ docker/
├─ docs/
│  ├─ architecture.md      # ce document
│  └─ cahier-des-charges.md
└─ package.json
```

**Mutualisation avec l'ERP Travaux** (quand les deux produits vivront) : extraire dans un dépôt ou un registre commun les briques génériques — `fcfa` (formats, décomposition billets/pièces), `a11y-nonlecteurs` (audio-first, cibles tactiles, pictos), `tenancy` (garde + RLS helpers), gabarits infra (Caddy, compose, CI). Chaque produit garde son domaine ; la maison partage ses outils.

## 11. Lots de développement

1. **Socle** — monorepo Nx, Docker, PostgreSQL + modèle de données (événements, tenancy, RLS), squelette NestJS en Clean Architecture (packages/domain posé dès ce lot), auth téléphone+PIN, audit, **outbox hors-ligne dès ce lot** (c'est le cœur du produit, pas une option de fin).
2. **Journal du gardien** — la PWA gardien complète (morts, sacs, rattrapage, zéro explicite, tâches, météo), portage du design « cahier » des maquettes, clips audio français (wolof dès enregistrement).
3. **Bureau admin** — inbox, coûts (date, duplication, justificatifs), commandes → annonces → écarts → soldes tiers, pesées (demande, aiguille, validation), courbe de poids, ventes & créances, référentiels, clôture de campagne.
4. **Push & partage** — Web Push, rappel du soir, image de bilan WhatsApp (deux audiences).
5. **Pilotes** — double tenue sur les campagnes du fondateur, import Excel historique, onboarding assisté, itérations terrain avec les gardiens.
6. **V2** — selon cahier des charges : analytics dbt étendu, OCR, stock/fabrication d'aliment, investisseurs, SMS, langues.

Les lots 1–3 donnent un produit mono-éleveur complet ; le multi-tenant étant natif dès le lot 1, le passage aux pilotes (lot 5) n'exige aucune refonte.

## 12. Décisions à confirmer

- [ ] **Qui code l'application ?** C'est la décision qui valide la stack : équipe/freelances communs avec l'ERP Travaux → TypeScript confirmé ; fondateur seul sur la durée → réévaluer Django en connaissance des coûts (deux stacks, pas de types partagés).
- [ ] JWT : TTL et stratégie refresh — trancher une fois pour les deux produits.
- [ ] Hébergeur et région (résidence des données comme argument commercial ?).
- [ ] Compression/format des clips audio et taille du précache par langue.
- [ ] Stratégie de versionnement du schéma d'événements (champ `version` dès le lot 1 ?).
- [ ] Champs spécifiques par type de coût (schémas de saisie dynamiques) — déjà pointé au cahier des charges, impacte DTO et `packages/shared`.
- [ ] Seuils de bascule vers stockage objet et vers réplique analytics dédiée.
