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
packages/contracts/      types et DTO des événements, contrats d'API
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
packages/kit       → rien (ni le reste du workspace, ni framework)
packages/domain    → kit (ni NestJS, ni Prisma, ni Angular, ni IO)
packages/contracts → rien (types purs)
application        → domain, kit       (cas d'usage + ports : dépôts, fichiers, push, horloge)
infrastructure     → application, domain, kit   (Prisma, volume ou S3, web-push)
web — routes gardien → domain/journal, kit, contracts, design-system   (jamais domain/finance)
web — routes admin   → domain/journal, domain/finance, kit, contracts, design-system
```

**Une règle métier s'écrit une seule fois, dans `packages/domain`** — `apps/web` n'en réimplémente aucune. Mais tout le domaine ne va pas partout :

- **`domain/journal`** (validation d'une déclaration, vivants, moyenne de pesée, écart de quantité, anti-doublon) est partagé : le téléphone valide hors-ligne avec le même code que le serveur.
- **`domain/finance`** (facturable, dette, grand livre, coût par poulet) n'entre jamais dans les routes gardien, ce qu'une règle de lint garantit. Côté admin, il ne sert qu'à prévisualiser une saisie en cours ; tout chiffre enregistré vient de l'API.
- Le domaine est **isomorphe** (aucune API propre à Node) et le serveur **revalide toujours** : le calcul du client sert à l'affichage et au hors-ligne, il ne fait jamais foi.

**Imports entre projets : par alias, et le lint tient les frontières.** Un projet en importe un autre par son alias (`@kit`, `@domain/journal`, `@domain/finance`, déclarés dans `tsconfig.base.json`), jamais par un chemin relatif ; un alias s'ajoute avec son premier consommateur. Côté web, les routes gardien vivent dans `apps/web/src/app/caretaker/` et les routes admin dans `apps/web/src/app/admin/` : ce dossier est le seul à importer `@domain/finance`, et rien ne l'importe autrement que par une route paresseuse. `domain/journal` n'importe jamais `domain/finance`. Ces règles sont dans `eslint.config.mjs` et chacune est prouvée par un import fautif dans `tools/boundaries.spec.mjs` : une nouvelle frontière y ajoute d'abord son test.

**Reprendre avant d'écrire.** Avant de coder une brique générique (montants, résultat typé, horloge, garde tenant et RLS, dépôt de fichiers par empreinte, formatage FCFA, Caddy et compose), cherche-la dans le dépôt voisin `../build-track` (ERP Travaux) et reprends-la avec ses tests. Elle va dans `packages/kit` si un autre produit l'utiliserait telle quelle : aucun vocabulaire avicole, aucun import du reste du workspace, provenance notée dans `packages/kit/README.md`. Ce qui dépend du métier ou d'un framework s'adapte sur place. Avant de reprendre du code d'infrastructure, vérifie que ses dépendances passent `npm audit`.

## 4. Règles non négociables

1. **Le journal est immuable.** Un événement ne se modifie ni ne s'efface : une correction après envoi est une **contre-déclaration** tracée, écrite en ligne, qui remplace les valeurs mesurées de la déclaration ; la dernière écrite fait foi, d'après la date de saisie (décision du 2026-11-06). Une déclaration faite par erreur s'**annule** par un événement tracé, définitif, que seul l'admin écrit pour le moment : elle reste au journal et ne compte plus. Aucun `UPDATE` ni `DELETE` sur le journal. Son schéma n'évolue que **par ajout** (champ facultatif, nouveau type) : le sens d'un champ existant ne change jamais, et un événement ne porte pas de numéro de version (décision du 2026-11-06).
2. **Identifiants générés côté client** (UUID, jamais de séquence serveur). L'ingestion est **idempotente par UUID** : un doublon de synchro est ignoré, jamais compté deux fois. Chaque événement porte deux dates : date métier (choisie) et date de saisie (automatique, horloge de l'appareil) ; le serveur y ajoute sa date de réception à l'enregistrement en base, sans jamais la lire chez le client. Une déclaration, comme une contre-déclaration, se valide d'après sa date de saisie, jamais d'après l'heure de sa réception. Il porte des **faits** (les cinq poids), jamais une valeur calculée (la moyenne) : le serveur recalcule, donc un téléphone resté sur une ancienne version du domaine ne fausse rien. **Les écritures d'argent suivent la même règle** (coût, paiement, règlement, vente) : identifiant créé sur l'appareil, ingestion idempotente, jamais de modification — une correction est une contre-écriture.
3. **Hors-ligne d'abord.** Toute déclaration du gardien fonctionne sans réseau (outbox IndexedDB). La synchro est un détail d'exécution, jamais une condition ; un événement déclaré ne se perd jamais. Seule exception : corriger une déclaration déjà envoyée demande le réseau, pour le gardien comme pour l'admin. Côté admin (décision du 2026-11-06), quatre saisies partent aussi en file d'attente : un coût, un paiement, une vente, une déclaration à la place du gardien. Le reste du bureau demande le réseau et affiche la date de ses chiffres.
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

- **Mode 100 % hors-ligne** (calcul local complet des vues, au-delà des saisies en file d'attente de la V1) : UUID client ; règles dans `packages/domain`, exécutables des deux côtés ; vues dérivables du journal ; synchro pensée comme réplication du journal par curseur, bornée par le rôle ; auth téléphone + PIN vérifiable localement après la première connexion.
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
| Gardien ; titulaire du site ; remplaçant ; équipe du site ; affectation à un site (en base) ; affecter, retirer, désigner le titulaire | `Caretaker` ; `primaryCaretaker` ; `substitute` ; `SiteStaff` ; `SiteAssignment` (`isPrimary`) ; `assignToSite`, `removeFromSite`, `designatePrimaryCaretaker` |
| Mode strict (seul le titulaire déclare) | `strictMode` |
| Événement du journal ; déclaration ; contre-déclaration ; annulation (admin seul, définitive) | `JournalEvent` ; `Declaration` ; `CounterDeclaration` (`corrects`) ; `Retraction` (`retracts`) |
| Ligne du journal effectif | `JournalLine` (`effectiveJournal`) |
| Fait porté par un événement ; son type ; son auteur | `Fact` ; `type` (`EventType`) ; `authorId` (`UserId`), `Author` |
| Date métier ; date de saisie (un instant en temps universel) ; date de réception (posée par le serveur à l'enregistrement en base) | `businessDate` ; `recordedAt` (`Instant`) ; `receivedAt` |
| Jour métier ; fuseau du site ; jour J (mise en place = J0) | `BusinessDay` ; `TimeZone` ; `campaignDay`, `placementDay` |
| Mort ; perte hors mortalité (manquants, dons — admin seul) ; sac ouvert ; « rien perdu » | `Death` ; `Loss` (`lossType` : `Missing` / `Donation`) ; `BagOpened` ; `NoLoss` |
| Vivants ; lignes de commande qui livrent les animaux mis en place | `liveCount` ; `placementOrderLines` |
| Résumé d'un jour : non déclaré / zéro déclaré / morts déclarés | `DaySummary` : `NotDeclared` / `NoLossDeclared` / `DeathsDeclared` |
| Tâche ; tâche faite ; protocole sanitaire | `Task` ; `TaskDone` ; `HealthProtocol` |
| Message vocal ; photo ; empreinte d'un média | `VoiceMessage` ; `Photo` ; `MediaFingerprint` |
| Commande ; ligne de commande | `PurchaseOrder` ; `OrderLine` |
| Réception ; PV de réception (photographié / pas de papier) | `Delivery` ; `DeliveryNote` (`Photographed` / `NoPaper`) |
| Écart (manque / bonus) | `Variance` (`shortfall` / `bonus`) |
| Facturable ; paiement d'une commande | `billable` ; `Payment` |
| Dette, créance ; règlement | `Debt`, `Receivable` ; `Settlement` |
| Tiers ; grand livre des tiers | `Counterparty` ; `Ledger` |
| Montant ; différence signée | `Money` ; `SignedMoney` (du kit) |
| Contre-écriture (correction d'une écriture d'argent) | `CounterEntry` |
| Coût ; engagé ; type et catégorie de coût | `Cost` ; `committedCost` ; `CostType`, `CostCategory` |
| Budget ; échéance récurrente | `Budget` ; `RecurringCharge` |
| Pesée ; demande de pesée ; souche | `Weighing` ; `WeighingRequest` ; `Strain` |
| Quantité déclarée ; poids (grammes entiers, saisi tel que lu : la balance n'est pas modélisée) | `Quantity` ; `Weight` |
| Vente ; prêt de poulets | `Sale` ; `BirdLoan` |
| Clôture ; restes ; bilan | `closing` ; `leftovers` ; `ClosingReport` |
| Référentiel ; justificatif (reçu) | `ReferenceData` ; `Receipt` |
| PIN (4 chiffres pour un gardien, 6 pour l'admin) ; son empreinte argon2id ; essais ratés et attente avant le suivant | `Pin` ; `pinHash` (`PinHasher`) ; `PinAttempts`, `retryAt` |
| Amorçage d'un élevage (tenant, premier site, premier admin) ; ajout d'un admin par l'éditeur | `bootstrapTenant` (`dist/bootstrap-tenant.js`) ; `addAdmin` (`dist/add-admin.js`) |
| Trace d'une action sensible ; son action | `AuditEvent` (`recordAudit`) ; `AuditAction` |
| PIN provisoire donné par l'admin ; premier choix du PIN ; PIN oublié | `provisionalPin` (`provisionalPinExpiresAt`) ; `choosePin` ; `resetPin` |
| Le cahier du gardien et son état ; une bande vue dans le cahier (« les petits », « les grands », « Jour 12 ») ; où écrit le prochain geste ; contexte reçu du serveur | `Notebook` ; `NotebookCampaign` (`campaignsOf`) ; `declarationTarget` ; `CaretakerContext` |
| Voix (clips pré-enregistrés) ; morceau d'une phrase ; composer une phrase ; identifiant d'un clip du script ; liste des clips enregistrés d'une langue | `Voice` (`say`) ; `PhrasePart` (`clip`, `counted`, `number`, `weight`) ; `compose` ; `ScriptClip`, `CountedFamily` ; `ClipManifest` |
| Avatar d'un compte (liste fermée) ; langue de la voix (de la personne, sinon de son site) ; changer l'un ou l'autre ; comptes retenus par le téléphone | `AccountAvatar` (`avatar`) ; `AudioLanguage` (`audioLanguage`, `languageOf`) ; `updateAccount` ; `KnownAccount` (`knownAccounts`) |
| Connexion ; session et son jeton ; appareil ; compte bloqué ; jetons antérieurs invalidés | `signIn` ; `Session`, `AccessToken` (`issueAccessToken`, `verifyAccessToken`, durées dans `SESSION_LIFETIME_SECONDS`) ; `deviceId` ; `blockedAt` ; `sessionsValidFrom` |
| Refus métier (et son motif) | `Refusal` (`kind`) |
| File d'attente du téléphone ; état d'un événement (en attente, envoi en doute, envoyé, refusé) ; synchro | `Outbox` ; `OutboxState` (`pending`, `in-doubt`, `sent`, `refused`) ; `synchronize`, `JournalSync` |
| Ingestion d'un lot ; sort d'un événement (accepté, doublon, refusé) | `ingestEvents` ; `IngestionOutcome` (`Accepted`, `Duplicate`, `Refused`) |
| Rattrapage (aujourd'hui, hier, avant-hier) ; rôle de l'auteur | catch-up (`CatchUpWindowPassed`) ; `Role`, `authorRole` |

Rôles : `admin` (gérant), `collaborator` (gardien), `investor` (V2, lecture seule). Un terme absent de la table s'y ajoute avant d'être codé.

## 7. Méthode — TDD, tests = spécifications

- Le travail suit `backlog.md` : une tranche (`C.4`) = une demande de revue = un seul sujet, de taille S ou M. Une tranche qui déborde se scinde avant la revue ; pas de refactor opportuniste dedans.
- Cycle strict 🔴 → 🟢 → 🔵, une règle à la fois. Une règle sans test n'existe pas ; si la règle change, le test change avant le code.
- `describe` / `it` en **français métier**, corps en Given / When / Then, builders métier (`uneCommandeAnnoncee()`), référence à la spec en tête (`// Spec: Cahier des charges — Commandes`).
- **Un test doit pouvoir échouer.** Avant de clore une tranche, chaque règle est sabotée — cassée exprès — pour vérifier qu'un test tombe. Ces sabotages tournent **sur une copie du dépôt, jamais dans l'arbre de travail** (décision du 2026-11-06) : un fichier cassé exprès ne doit pouvoir être ni lu, ni committé par erreur. Un seul script à la fois, et rien d'autre ne lance de tests pendant qu'il tourne.
- Le gros du volume vit dans `packages/domain` (pur, sans mock, property-based sur les invariants d'argent et d'idempotence). Cas d'usage : ports en stub mémoire. Infrastructure : PostgreSQL réel (RLS, tenant). E2E : quelques parcours dorés, hors-ligne compris, avec les montants attendus **calculés à la main en commentaire**.
- Outils : **Vitest** pour le web et les packages, **Jest** pour l'API (décision du 2026-11-05), **fast-check** pour les propriétés (importé par les seuls fichiers de test). Les tests d'infrastructure (`*.integration.spec.ts`) tournent sur un PostgreSQL 16 réel et jetable, démarré par **Testcontainers** comme dans build-track (décision du 2026-11-06) : un conteneur par processus de test, où les migrations du dépôt sont appliquées une fois dans une base modèle, que chaque fichier de test recopie en base neuve (`apps/api/src/testing/test-database.ts`). Il faut donc un Docker qui tourne pour lancer les tests de l'API. Chaque lancement étiquette ses conteneurs et les enlève à la fin ; ceux d'un lancement tué en route sont balayés par le lancement suivant (`apps/api/jest.test-containers.js`). Playwright s'ajoutera avec la première tranche qui en a besoin.

## 8. Conventions de code

- **TypeScript strict** (`strict`, `noUncheckedIndexedAccess`) ; pas de `any`, `unknown` + narrowing aux frontières. Immutabilité par défaut. Un refus métier est une valeur — `Result<T, Refusal>`, `Result` venant du kit et les motifs d'une liste fermée (`domain/journal/refusal.ts`), chacun ajouté avec son test ; les exceptions sont réservées aux pannes d'infrastructure.
- **Domaine** : fonctions pures, pas de `Promise`, pas de décorateur, pas de `new Date()` ni de `Date.now()` (le lint les refuse : l'instant est un paramètre, lu par l'application sur le port `Clock` du kit). Un état invalide n'est pas représentable. Un identifiant est un type marqué (`SiteId`, `CampaignId`) construit depuis un UUID fourni par l'appelant, en minuscules ; le domaine n'en génère aucun. Un événement se construit par `Declaration(envelope, fact)` , `CounterDeclaration(envelope, corrects, fact)` ou `Retraction(envelope, retracts)` depuis des valeurs déjà vérifiées : seuls les champs du schéma sont recopiés, et le résultat est gelé.
- **API** : REST versionnée `/api/v1`, DTO validés aux bords (liste blanche), aucune logique métier dans un contrôleur, un DTO ou une requête. Une seule origine derrière Caddy : CORS jamais activé. Une route est fermée par défaut (`SessionGuard`, global) : seule `@Public()` l'ouvre, et chaque ouverture a son test. Une route reçoit sa session par `@CurrentSession()` (utilisateur, élevage, rôle, appareil, tirés du jeton seul), se restreint par `@Roles('admin')`, et lit ou écrit par `prisma.runInTenant(session.tenantId, …)` : elle rejoint alors la transaction ouverte pour la requête (`TenantTransactionInterceptor`), où le compte a été relu — bloqué, jetons invalidés ou rôle changé : refusé avant que la route ne tourne. Une requête faite sans `runInTenant` ne voit rien. L'accès à un site passe par `canReachSite`. Une action sensible écrit sa trace par `recordAudit(tx, …)` dans la même transaction (table `audit_events`, en ajout seul, sans secret : ni PIN, ni jeton, ni numéro ; le site concerné dans `site_id` ; un auteur vide quand l'éditeur agit par script).
- **Design « cahier »** : les jetons (`packages/design-system/src/tokens/_tokens.scss`) sont la seule source de couleur — une couleur écrite dans le web fait échouer le lint ; les pictos sont des sources SVG recuites au build avec leur tremblé (`@design-system` donne leurs noms et leurs libellés) ; les composants partagés vivent dans `apps/web/src/app/ui/`.
- **Angular** : composants standalone, signals + `computed()`, `OnPush`, control flow natif (`@if`, `@for` avec `track`), `inject()`, routes paresseuses, reactive forms. La vue gardien est un bundle minimal : PrimeNG et CDK lourds restent dans les routes admin. Styles par tokens de `packages/design-system`, aucune couleur en dur.
- **Prisma** confiné à l'infrastructure et aux lectures simples ; `tenant_id` sur chaque modèle, et une clé étrangère passe par `(tenant_id, id)` : une ligne ne référence que des lignes de son élevage. Schéma et migrations dans `apps/api/prisma/`, configuration de la ligne de commande dans `apps/api/prisma.config.ts` (l'adresse de la base n'est plus dans le schéma) ; une migration se produit par `prisma migrate diff`, se relit, et ce que Prisma ne sait pas décrire (index partiel, RLS, déclencheur) s'y écrit à la main. **Tant que rien n'est déployé, les migrations se fusionnent en une seule** (`0001_init`, décision du 2026-11-07) : une tranche qui touche le schéma régénère la partie générée et y replace les parties écrites à la main. À partir du premier déploiement, un changement est une nouvelle migration. Le client se génère par la cible Nx `prisma-generate`, dont dépendent tests, typage, lint et build de l'API ; il se connecte par l'adaptateur `@prisma/adapter-pg`. La ligne de commande `prisma` est une dépendance de développement : l'image de l'API ne l'embarque pas (`npm ci --omit=dev --omit=optional`), seule l'image de la tâche de migration l'a. **Cloisonnement** : l'API se connecte sous le rôle `yaar_app`, qui ne possède aucune table et subit la RLS ; toute lecture ou écriture d'un élevage passe par `PrismaService.runInTenant(tenantId, …)`, qui fixe le tenant pour la transaction — hors de lui, aucune ligne n'est visible. Les tables appartiennent à `yaar`, sous lequel tournent les migrations et les scripts de l'éditeur : **ni superutilisateur ni dispensé de RLS** (décision du 2026-11-07, D.6), la RLS forcée le lie aussi, donc un script fixe l'élevage qu'il touche (`scopeToFarm`). Les deux rôles et la base naissent avec le serveur de base (`infra/postgres/init-roles.sh`) ; le superutilisateur `postgres` ne sert qu'à cette initialisation, puis perd son mot de passe : il ne se joint plus que de l'intérieur du conteneur (`docker compose exec db psql -U postgres`). Le script ne tourne que sur un volume vide : un volume créé avant D.6 se recrée (`docker compose … down -v`). Dans les tests, `db.owner` est ce propriétaire et `db.superuser` sème et relit par-dessus les élevages. Une nouvelle table reçoit dans sa migration ses droits (table par table, jamais `DELETE` sans raison : seule `site_assignments` l'a, pour retirer une affectation), sa RLS activée et forcée et sa politique : des tests lus dans le catalogue PostgreSQL échouent sinon. Aucun SQL assemblé comme un texte dans l'API (`$queryRawUnsafe`, `$executeRawUnsafe`, `Prisma.raw` : le lint les refuse hors des tests) : la base fait confiance à l'API pour nommer le tenant, une injection traverserait la RLS.
- **Projet propriétaire** (`LICENSE`) : tout `package.json` porte `"private": true` et `"license": "SEE LICENSE IN LICENSE"`. Aucune dépendance sous licence GPL ou AGPL, ni sans licence connue (`tools/licenses.mjs` le vérifie sur tout le verrou), et aucun code tiers recopié sans licence permissive vérifiée.
- **Dépendances : le strict nécessaire, et sûres.** Un paquet ne s'installe que pour un besoin de la tranche en cours, jamais « pour plus tard » ; ce que la plateforme ou une dépendance déjà présente sait faire ne justifie pas un paquet de plus. Avant d'ajouter : paquet officiel et maintenu, licence permissive, moteur Node compatible, puis `npm audit` — aucune vulnérabilité haute ou critique, et zéro dans les dépendances d'exécution (`npm audit --omit=dev`). Une sous-dépendance vulnérable se corrige par `overrides` dans `package.json` quand une version corrigée existe. Les scripts d'installation sont bloqués par `.npmrc` (`ignore-scripts=true`) : n'en autorise aucun sans le demander. Les paquets qui ne servent qu'à générer du code (plugins et schematics Nx, Angular, NestJS) ne restent pas installés.
- **Versions : la stable recommandée, pas la dernière.** On prend la version stable maintenue que le Node en place supporte officiellement ; à défaut, celle de build-track. Ni bêta, ni option expérimentale, ni majeure que l'outillage ne suit pas encore. En place : Angular 21 (LTS), NestJS 11, TypeScript 5.9, Vitest 4, Jest 29, ESLint 9, Nx 24, Prisma 7.10 (la branche 6 de build-track ne reçoit plus les correctifs de sécurité : décision du 2026-11-06), argon2 0.45 (ses binaires sont dans le paquet : aucun script d'installation n'a besoin de tourner), Testcontainers 11.14 (la dernière que Node 22.14 accepte ; `uuid` et `glob` forcés en version corrigée sous elle), `@angular/service-worker` (PWA), polices `@fontsource` servies par l'application, `fake-indexeddb` pour tester l'outbox. Une montée de version est une tranche à part.

## 9. Commandes

Prérequis : Node 22.12 ou plus, et un Docker qui tourne — pour les tests de l'API (Testcontainers) comme pour la pile complète. Le verrou `package-lock.json` fait foi : installe toujours avec `npm ci`. **Toute modification du verrou passe par npm 11** — modifie `package.json`, puis `npx npm@11 install --package-lock-only`, puis `npm ci`. npm 10 plante s'il recrée le verrou (défaut de résolution autour de `vitest` 4.1) et, s'il le retouche, en retire les champs `libc`.

```bash
npm ci                                # installer depuis le verrou
npm test                              # structure du workspace + tests de tous les projets
npm run lint                          # ESLint, `any` refusé
npm run typecheck                     # tsc strict
npm run build                         # web (dist/apps/web) et API (apps/api/dist/main.js, un seul fichier)
npx nx test domain                    # un seul projet : web, api, domain, contracts, design-system, kit
npx nx affected -t lint test build    # ce que la modification touche
npx nx serve web                      # Angular, en développement
npx nx serve api                      # NestJS, après build (DATABASE_URL exigé ; PORT, défaut 3000)
npx nx prisma-generate api            # régénérer le client Prisma après un changement de schéma
node packages/design-system/tools/bake-pictograms.mjs   # recuire les pictos après avoir modifié une source (--check : à jour ?)
node tools/audio-script.mjs           # après avoir modifié audio/script.md : les identifiants que l'écran peut dire
node tools/build-audio.mjs            # convertir les enregistrements de audio/<langue>/ en clips Opus (demande ffmpeg ; --check sans lui)
npx prisma migrate diff --config apps/api/prisma.config.ts --from-empty --to-schema apps/api/prisma/schema.prisma --script   # le SQL du schéma entier
cp infra/.env.example infra/.env      # une fois ; remplir DB_PASSWORD, APP_DB_PASSWORD et JWT_SECRET
# amorcer un élevage (tenant, premier site, premier admin) : par le script, jamais par une route ; le PIN est demandé au clavier
docker compose -f infra/docker-compose.yml run --rm -it migrate node dist/bootstrap-tenant.js --tenant "…" --site "…" --time-zone Africa/Dakar --admin-name "…" --admin-phone +221…
# ajouter un admin à un élevage existant (son tenant_id est affiché à l'amorçage) : par script aussi, jamais par une route
docker compose -f infra/docker-compose.yml run --rm -it migrate node dist/add-admin.js --tenant-id … --admin-name "…" --admin-phone +221…
docker compose -f infra/docker-compose.yml up --build   # la pile : http://localhost:8080
```

Il n'y a pas de générateur installé : un nouveau projet se crée en copiant un `project.json` voisin, et déclare dans `implicitDependencies` les projets dont il dépend d'après le §3. La CI (`.github/workflows/ci.yml`) rejoue les règles du workspace et l'audit à chaque poussée, puis `nx affected` sur ce que la modification touche. Ouvrir une maquette : `open journal-gardien.html` (aucun build).

## 10. Skills du projet (`.claude/skills/`)

- `/designer` — concevoir ou critiquer un écran dans le design « cahier ».
- `/tech-lead` — cadrer, implémenter ou relire du code front et back.
- `/security-engineer` — modéliser les menaces d'une fonctionnalité, auditer une modification.
- `/qa` — chercher les bugs d'une fonctionnalité avant qu'elle ne soit déclarée finie ; verdicts et réserves dans `docs/cahier-de-recette.md`.

## 11. Décisions ouvertes — ne pas les trancher en silence

Architecture §12 et cahier des charges « Points ouverts » : TTL et refresh du JWT, champs spécifiques par type de coût, seuils d'alerte par défaut, hébergeur. Si une tâche bute sur l'une d'elles, pose la question au fondateur au lieu de choisir à sa place.
