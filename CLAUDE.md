# CLAUDE.md — Yaar (pilotage avicole)

> Lis ce fichier avant toute contribution. En cas de doute, applique la **boussole** (§2).
>
> Sources de vérité :
> - `docs/cahier-des-charges.md` — **le quoi** : modules, écrans, règles métier, UX.
> - `docs/architecture.md` — **le comment** : stack, couches, hors-ligne, tenancy, lots.
> - `journal-gardien.html`, `bureau-admin.html` (à la racine) — **maquettes interactives validées**, références de design.
>
> Une règle métier absente de ces documents s'y ajoute **avant** d'être codée.

**État du dépôt** : le socle se construit tranche par tranche ; `backlog.md` dit ce qui est livré (✅). L'arborescence du §3 est une cible : vérifie qu'un dossier, un script ou une dépendance existe avant de t'appuyer dessus. « Yaar » est un nom de travail, non déposé : il ne s'écrit qu'à un endroit par application (manifest, titre de page), jamais en dur dans les écrans.

## 1. Le produit

SaaS multi-tenant de pilotage d'élevages de poulets de chair, d'abord au Sénégal, en FCFA (XOF, sans décimales). Deux vues dans une même PWA :

- **Le cahier du gardien** — journal de terrain tenu par quelqu'un qui ne sait pas forcément lire : pictos, couleur, audio, 3 taps, hors-ligne, Android d'entrée de gamme (Tecno, Infinix, Itel).
- **Le bureau de l'admin** — pilotage du gérant : coûts, commandes, réceptions, grand livre des tiers, pesées, suivi.

Hiérarchie : **Tenant (élevage) → Sites (poulaillers) → Campagnes (bandes) → Événements**. Partage des rôles : *les bêtes = le gardien, l'argent = l'admin*. La qualité de la donnée terrain est le premier levier de rentabilité : c'est elle que le produit protège.

## 2. Boussole

> Avant d'ajouter une couche, une abstraction, une dépendance, un écran ou une option :
> **« Est-ce que ça rend la donnée du terrain plus fiable, l'argent plus juste, ou le geste du gardien plus simple ? »**
> Oui → garde. Non → ne l'ajoute pas.

Clean Architecture et DDD **autant que nécessaire** : l'esprit, pas la cérémonie. Les écritures du journal et les règles d'argent traversent le domaine pur ; les CRUD de référentiels et les lectures de tableaux de bord interrogent Prisma en direct. Ni repository générique, ni factory systématique, ni event-sourcing généralisé, ni microservices. On abstrait face à un second cas concret.

## 3. Structure cible (monorepo Nx)

```
apps/web/                Angular — SPA + PWA (vues gardien et admin)
apps/api/                NestJS — un module par domaine : auth, tenants, users, sites, campaigns,
                         journal (le cœur), orders, counterparties, costs, sales, weighings,
                         reference-data, notifications, media, settings, audit
packages/domain/         cœur métier pur, deux points d'entrée : journal (terrain) et finance
packages/shared/         types et DTO des événements, contrats d'API
packages/design-system/  design system « cahier » : tokens, pictos SVG, tampons
packages/kit/            briques communes aux produits de la maison (Money, Result…), reprises
                         de build-track et extractibles plus tard dans un dépôt à part
analytics/dbt/           Python + dbt sur réplique Postgres — hors chemin applicatif
audio/                   scripts des phrases + clips par langue (wo/, fr/)
infra/                   docker-compose, Caddy
docs/                    cahier des charges, architecture
```

Règle de dépendance — les flèches pointent vers l'intérieur :

```
packages/kit      → rien (ni le reste du workspace, ni framework)
packages/domain   → kit (ni NestJS, ni Prisma, ni Angular, ni IO)
packages/shared   → rien (types purs)
application       → domain, kit       (cas d'usage + ports : dépôts, fichiers, push, horloge)
infrastructure    → application, domain, kit   (Prisma, volume ou S3, web-push)
web — routes gardien → domain/journal, kit, shared, design-system   (jamais domain/finance)
web — routes admin   → domain/journal, domain/finance, kit, shared, design-system
```

**Une règle métier s'écrit une seule fois, dans `packages/domain`** — `apps/web` n'en réimplémente aucune. Mais tout le domaine ne va pas partout :

- **`domain/journal`** (validation d'une déclaration, vivants, moyenne de pesée, écart de quantité, anti-doublon) est partagé : le téléphone valide hors-ligne avec le même code que le serveur.
- **`domain/finance`** (facturable, dette, grand livre, coût par poulet) n'entre jamais dans les routes gardien, ce qu'une règle de lint garantit. Côté admin, il ne sert qu'à prévisualiser une saisie en cours ; tout chiffre enregistré vient de l'API.
- Le domaine est **isomorphe** (aucune API propre à Node) et le serveur **revalide toujours** : le calcul du client sert à l'affichage et au hors-ligne, il ne fait jamais foi.

**Imports entre projets : par alias, et le lint tient les frontières.** Un projet en importe un autre par son alias (`@kit`, `@domain/journal`, `@domain/finance`, déclarés dans `tsconfig.base.json`), jamais par un chemin relatif ; un alias s'ajoute avec son premier consommateur. Côté web, les routes gardien vivent dans `apps/web/src/app/caretaker/` et les routes admin dans `apps/web/src/app/admin/` : ce dossier est le seul à importer `@domain/finance`, et rien ne l'importe autrement que par une route paresseuse. `domain/journal` n'importe jamais `domain/finance`. Ces règles sont dans `eslint.config.mjs` et chacune est prouvée par un import fautif dans `tools/boundaries.spec.mjs` : une nouvelle frontière y ajoute d'abord son test. Dans `apps/api`, les alias ne se résolvent pas encore (Jest, build) : tranche A.3.

**Reprendre avant d'écrire.** Avant de coder une brique générique (montants, résultat typé, horloge, garde tenant et RLS, dépôt de fichiers par empreinte, formatage FCFA, Caddy et compose), cherche-la dans le dépôt voisin `../build-track` (ERP Travaux) et reprends-la avec ses tests. Elle va dans `packages/kit` si un autre produit l'utiliserait telle quelle : aucun vocabulaire avicole, aucun import du reste du workspace, provenance notée dans `packages/kit/README.md`. Ce qui dépend du métier ou d'un framework s'adapte sur place. Avant de reprendre du code d'infrastructure, vérifie que ses dépendances passent `npm audit`.

## 4. Règles non négociables

1. **Le journal est immuable.** Un événement ne se modifie ni ne s'efface : une correction après envoi est une **contre-déclaration** tracée. Aucun `UPDATE` ni `DELETE` sur le journal.
2. **Identifiants générés côté client** (UUID, jamais de séquence serveur). L'ingestion est **idempotente par UUID** : un doublon de synchro est ignoré, jamais compté deux fois. Chaque événement porte deux dates : date métier (choisie) et date de saisie (automatique). Il porte des **faits** (les cinq poids), jamais une valeur calculée (la moyenne) : le serveur recalcule, donc un téléphone resté sur une ancienne version du domaine ne fausse rien.
3. **Hors-ligne d'abord.** Toute déclaration du gardien fonctionne sans réseau (outbox IndexedDB). La synchro est un détail d'exécution, jamais une condition ; un événement déclaré ne se perd jamais.
4. **Need-to-know.** Le téléphone du gardien ne reçoit et ne stocke aucune donnée financière (coûts, prix, ventes, soldes). Le filtrage se fait **côté serveur selon le rôle**, pas en masquant à l'écran.
5. **Tenant partout.** `tenant_id` sur chaque table et chaque requête : garde NestJS + couche d'accès + RLS PostgreSQL. Le tenant vient de la session, jamais du client.
6. **Fail-closed.** Dans le doute, l'état par défaut est le plus restrictif : accès refusé, route protégée, entrée inconnue rejetée. L'autorisation (rôle, portée par site, mode strict) se vérifie à l'ingestion, côté serveur ; le client n'est jamais l'autorité.
7. **Jamais de flottant pour l'argent.** `Money` = value object sur entier dans la plus petite unité + code devise ; devise jamais codée en dur. Poids en grammes entiers, quantités en unités entières (le gardien ne manipule pas de fractions).
8. **Les états sont des projections.** Soldes, vivants, engagé, coût/poulet se **recalculent** depuis le journal et les écritures ; aucune vue d'écran n'existe seulement en SQL serveur. Règles d'argent : coût reconnu **à la réception** ; `facturable = min(reçu, qté) × PU` ; `dette = payé − facturable` ; le budget est un plan, jamais une dette.
9. **Les écarts sont signés, jamais bridés** : un manque est négatif, un bonus est positif.
10. **Absent n'est pas zéro, et zéro se déclare.** « Rien perdu hier » est un événement explicite ; une valeur non renseignée reste absente, jamais `0`.
11. **Trois canaux redondants** côté gardien : picto + couleur + audio. 3 taps maximum par déclaration. L'audio de production est fait de **clips pré-enregistrés** (wolof, français) ; la synthèse vocale du navigateur ne sert qu'aux maquettes.
12. **Le design « cahier » n'a pas le droit de coûter.** Pas de filtre SVG à l'exécution (le tremblé est pré-cuit au build) ; on n'anime que `transform` et `opacity` ; ni flou ni filtre sur un conteneur qui défile. Budget CI : démarrage < 2,5 s en 3G, bundle initial de route < 200 Ko gzip.
13. **Les images s'archivent, elles ne s'effacent jamais** (réserve d'entraînement ML). Seuls les vocaux sont purgés après traitement ; leur sujet tagué et l'action prise restent au journal.
14. **Toute action sensible est journalisée** : qui, quoi, quand, depuis quel appareil.

## 5. Portes à garder ouvertes

Rien à construire en V1, mais ne pas fermer :

- **Mode 100 % hors-ligne** : UUID client ; règles dans `packages/domain`, exécutables des deux côtés ; vues dérivables du journal ; synchro pensée comme réplication du journal par curseur, bornée par le rôle ; auth téléphone + PIN vérifiable localement après la première connexion.
- **On-premise** : aucun service cloud propriétaire (fichiers derrière un port de stockage, push VAPID standard) ; le `docker-compose` de production reste auto-hébergeable ; une instance on-premise = le même code en mono-tenant (`tenant_id` et RLS restent).
- **Autres espèces (V2 pondeuses, puis moutons)** : le modèle d'événements est agnostique à l'espèce ; seuls les référentiels changent. Ne code pas « poulet » en dur dans le journal.

## 6. Langue et langage ubiquitaire

**Règle stricte, celle de l'ERP Travaux** (décision du 2026-11-05 ; elle remplace sur ce point `docs/architecture.md` §4) :

- **Anglais obligatoire** pour tout identifiant : classes, types, fonctions, variables, fichiers, dossiers, modules, classes CSS, clés de test.
- **Français réservé** aux documents Markdown, aux textes destinés à l'utilisateur (libellés, messages, aria-labels, phrases audio) et à la narration des tests (`describe`, `it`, `// Given / When / Then`, builders métier).
- Commentaires de code en anglais, et rares.
- **Franglais interdit** : `CommandeService`, `calculerDette`, `argent/montant.ts` sont des fautes — écrire `PurchaseOrderService`, `computeDebt`, `finance/…`. La table fait foi : pas de synonyme.

| Métier | Code |
|---|---|
| Élevage (tenant) ; site (poulailler) | `Tenant`, `tenant_id` ; `Site` |
| Campagne, bande | `Campaign` |
| Gardien ; titulaire du site | `Caretaker` ; `primaryCaretaker` |
| Événement du journal ; déclaration ; contre-déclaration | `JournalEvent` ; `Declaration` ; `CounterDeclaration` |
| Date métier ; date de saisie | `businessDate` ; `recordedAt` |
| Mort, perte ; sac ouvert ; « rien perdu » | `Death`, `Loss` ; `BagOpened` ; `NoLoss` |
| Vivants | `liveCount` |
| Tâche ; protocole sanitaire | `Task` ; `HealthProtocol` |
| Commande ; ligne de commande | `PurchaseOrder` ; `OrderLine` |
| Réception ; PV de réception | `Delivery` ; `DeliveryNote` |
| Écart (manque / bonus) | `Variance` (`shortfall` / `bonus`) |
| Facturable ; paiement d'une commande | `billable` ; `Payment` |
| Dette, créance ; règlement | `Debt`, `Receivable` ; `Settlement` |
| Tiers ; grand livre des tiers | `Counterparty` ; `Ledger` |
| Montant ; différence signée | `Money` ; `SignedMoney` |
| Coût ; engagé ; type et catégorie de coût | `Cost` ; `committedCost` ; `CostType`, `CostCategory` |
| Budget ; échéance récurrente | `Budget` ; `RecurringCharge` |
| Pesée ; demande de pesée ; souche | `Weighing` ; `WeighingRequest` ; `Strain` |
| Vente ; prêt de poulets | `Sale` ; `BirdLoan` |
| Clôture ; restes ; bilan | `closing` ; `leftovers` ; `ClosingReport` |
| Référentiel ; justificatif (reçu) | `ReferenceData` ; `Receipt` |

Rôles : `admin` (gérant), `collaborator` (gardien), `investor` (V2, lecture seule). Un terme absent de la table s'y ajoute avant d'être codé.

## 7. Méthode — TDD, tests = spécifications

- Le travail suit `backlog.md` : une tranche (`C.4`) = une demande de revue = un seul sujet, de taille S ou M. Une tranche qui déborde se scinde avant la revue ; pas de refactor opportuniste dedans.
- Cycle strict 🔴 → 🟢 → 🔵, une règle à la fois. Une règle sans test n'existe pas ; si la règle change, le test change avant le code.
- `describe` / `it` en **français métier**, corps en Given / When / Then, builders métier (`uneCommandeAnnoncee()`), référence à la spec en tête (`// Spec: Cahier des charges — Commandes`).
- Le gros du volume vit dans `packages/domain` (pur, sans mock, property-based sur les invariants d'argent et d'idempotence). Cas d'usage : ports en stub mémoire. Infrastructure : PostgreSQL réel (RLS, tenant). E2E : quelques parcours dorés, hors-ligne compris, avec les montants attendus **calculés à la main en commentaire**.
- Outils : **Vitest** pour le web et les packages, **Jest** pour l'API (décision du 2026-11-05). fast-check, Testcontainers et Playwright s'ajouteront avec la première tranche qui en a besoin.

## 8. Conventions de code

- **TypeScript strict** (`strict`, `noUncheckedIndexedAccess`) ; pas de `any`, `unknown` + narrowing aux frontières. Immutabilité par défaut. Erreurs métier typées (résultat typé), exceptions réservées aux pannes d'infrastructure.
- **Domaine** : fonctions pures, pas de `Promise`, pas de décorateur, pas de `new Date()` (l'heure vient d'un port horloge). Un état invalide n'est pas représentable.
- **API** : REST versionnée `/api/v1`, DTO validés aux bords (liste blanche), aucune logique métier dans un contrôleur, un DTO ou une requête. Une seule origine derrière Caddy : CORS jamais activé.
- **Angular** : composants standalone, signals + `computed()`, `OnPush`, control flow natif (`@if`, `@for` avec `track`), `inject()`, routes paresseuses, reactive forms. La vue gardien est un bundle minimal : PrimeNG et CDK lourds restent dans les routes admin. Styles par tokens de `packages/design-system`, aucune couleur en dur.
- **Prisma** confiné à l'infrastructure et aux lectures simples ; `tenant_id` sur chaque modèle.
- **Projet propriétaire** (`LICENSE`) : tout `package.json` porte `"private": true` et `"license": "SEE LICENSE IN LICENSE"`. Aucune dépendance sous licence GPL ou AGPL dans ce qui est livré, et aucun code tiers recopié sans licence permissive vérifiée.
- **Dépendances : le strict nécessaire, et sûres.** Un paquet ne s'installe que pour un besoin de la tranche en cours, jamais « pour plus tard » ; ce que la plateforme ou une dépendance déjà présente sait faire ne justifie pas un paquet de plus. Avant d'ajouter : paquet officiel et maintenu, licence permissive, moteur Node compatible, puis `npm audit` — aucune vulnérabilité haute ou critique, et zéro dans les dépendances d'exécution (`npm audit --omit=dev`). Une sous-dépendance vulnérable se corrige par `overrides` dans `package.json` quand une version corrigée existe. Les scripts d'installation sont bloqués par `.npmrc` (`ignore-scripts=true`) : n'en autorise aucun sans le demander. Les paquets qui ne servent qu'à générer du code (plugins et schematics Nx, Angular, NestJS) ne restent pas installés.
- **Versions : la stable recommandée, pas la dernière.** On prend la version stable maintenue que le Node en place supporte officiellement ; à défaut, celle de build-track. Ni bêta, ni option expérimentale, ni majeure que l'outillage ne suit pas encore. En place : Angular 21 (LTS), NestJS 11, TypeScript 5.9, Vitest 4, Jest 29, ESLint 9, Nx 24. Une montée de version est une tranche à part.

## 9. Commandes

Prérequis : Node 22.12 ou plus. Le verrou `package-lock.json` fait foi : installe toujours avec `npm ci`. npm 10 sait installer depuis le verrou et y ajouter un paquet, mais plante s'il doit le recréer de zéro (défaut de résolution autour de `vitest` 4.1) ; dans ce cas : `npx npm@11 install --package-lock-only`.

```bash
npm ci                                # installer depuis le verrou
npm test                              # structure du workspace + tests de tous les projets
npm run lint                          # ESLint, `any` refusé
npm run typecheck                     # tsc strict
npm run build                         # web (dist/apps/web) et API (apps/api/dist)
npx nx test domain                    # un seul projet : web, api, domain, shared, design-system, kit
npx nx affected -t lint test build    # ce que la modification touche
npx nx serve web                      # Angular, en développement
npx nx serve api                      # NestJS, après build (PORT, défaut 3000)
```

Il n'y a pas de générateur installé : un nouveau projet se crée en copiant un `project.json` voisin. Ouvrir une maquette : `open journal-gardien.html` (aucun build).

## 10. Skills du projet (`.claude/skills/`)

- `/designer` — concevoir ou critiquer un écran dans le design « cahier ».
- `/tech-lead` — cadrer, implémenter ou relire du code front et back.
- `/security-engineer` — modéliser les menaces d'une fonctionnalité, auditer une modification.
- `/qa` — chercher les bugs d'une fonctionnalité avant qu'elle ne soit déclarée finie.

## 11. Décisions ouvertes — ne pas les trancher en silence

Architecture §12 et cahier des charges « Points ouverts » : TTL et refresh du JWT, versionnement du schéma d'événements, champs spécifiques par type de coût, modèles de balance, seuils d'alerte par défaut, format des clips audio, hébergeur. Si une tâche bute sur l'une d'elles, pose la question au fondateur au lieu de choisir à sa place.
