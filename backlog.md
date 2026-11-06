# Backlog — Yaar (V1 : lots 1 à 5)

> **Périmètre** : tout ce qu'il faut pour livrer la V1 « poulet de chair » décrite dans `docs/cahier-des-charges.md`, dans l'ordre des lots de `docs/architecture.md` §11 : socle, cahier du gardien, bureau de l'admin, push et partage, mise en service des pilotes.
>
> **Méthode** : TDD strict. Chaque ligne cochable est le **titre d'un test** (`describe` / `it` en français métier, Given / When / Then, cf. `CLAUDE.md` §7). Dans une verticale, le domaine pur vient d'abord, puis l'API, puis l'écran.
>
> **Convention de tracking** : on coche un scénario quand son test est **vert** et que le code respecte les règles non négociables (`CLAUDE.md` §4). Une tranche est terminée quand tous ses scénarios sont cochés ; son titre reçoit alors ✅. On ne démarre une tranche que lorsque celles dont elle dépend sont vertes.
>
> **Hors périmètre** : V2 (pondeuses et œufs, fabrique d'aliment, OCR du cadran, accès investisseur, SMS de secours, analytics dbt étendu, fusion de types, export Excel) et V3 (Woolunte Network, benchmark, dataset vision-poids).

---

## Contrat de revue

Le backlog est découpé pour que **chaque tranche se relise d'une traite**. Une épique porte une lettre (`C`), une tranche porte un numéro (`C.4`).

1. **Une tranche = une demande de revue = un seul sujet.** Son identifiant ouvre le titre de la PR (`C.4 — Les vivants se recalculent depuis le journal`).
2. **Taille** : complexité **S** (≤ ½ jour) ou **M** (1 à 2 jours), jamais plus. Cible : moins de 400 lignes de diff à relire, hors fichiers générés, verrou de dépendances et SQL de migration généré. Si une tranche déborde en cours de route, elle est scindée (`C.4a`, `C.4b`) **avant** d'ouvrir la revue, et le backlog est mis à jour.
3. **Le domaine se relit sans rien lancer.** Une tranche de domaine ne contient que des fonctions pures et leurs tests : les titres des tests se lisent comme la règle du cahier des charges. C'est là que la relecture métier compte le plus.
4. **Le mécanique est à part.** Scaffolding, code généré, renommages : tranche dédiée, marquée ⚙, à relire vite. Aucun refactor opportuniste dans une tranche fonctionnelle.
5. **Chaque tranche laisse la branche principale verte et livrable.** Un écran inachevé n'est pas routé ; une règle inachevée n'est pas appelée.
6. **La PR dit comment vérifier** : la règle de la spec, les scénarios cochés, la commande ou le geste qui montre que ça marche, et ce qui n'a pas pu être vérifié.
7. **La PR liste chaque dépendance ajoutée et pourquoi.** Une tranche n'installe que ce dont elle a besoin (`CLAUDE.md` §8) ; le résultat de `npm audit` y figure.

Chaque tranche porte trois lignes d'en-tête : **Spec** (la règle) et **Zone** (où vit le code) ; **Dépend de** ; **Revue** (ce qu'il faut regarder en priorité).

## Légende

| Marque | Sens |
|---|---|
| **S** / **M** | ≤ ½ jour / 1 à 2 jours |
| ⚙ | Tranche mécanique : revue rapide |
| 🔒 | Passage de `/security-engineer` avant de clore (auth, tenant, ingestion, médias, push) ; ses constats restés ouverts vont dans `docs/cahier-de-recette.md` |
| 🧪 | Passage de `/qa` avant de clore (journal, argent, synchro, rôles) ; son verdict et ses réserves vont dans `docs/cahier-de-recette.md` |
| 🎨 | Maquette à produire d'abord avec `/designer` : l'écran n'existe pas dans les maquettes |
| ⚠ | Bloquée par une décision ouverte (tableau ci-dessous) |
| ⏸ | Reportée : besoin ou règle à préciser |

Abréviations : **CdC** = cahier des charges ; **Archi** = architecture technique.

## Décisions à prendre avant de démarrer

Aucune de ces questions ne se tranche en codant (`CLAUDE.md` §11). Chacune bloque les tranches indiquées.

| Décision | Source | Bloque |
|---|---|---|
| ~~Outil de test du domaine et du web (Jest ou Vitest)~~ ✅ tranché le 2026-11-05 : Vitest pour le web et les packages, Jest pour l'API | `CLAUDE.md` §7 | ~~A.1~~ |
| ~~Champ `version` dans le schéma d'événements dès le lot 1 ?~~ ✅ tranché le 2026-11-06 : non — le schéma n'évolue que par ajout, le sens d'un champ ne change jamais ; le contrat d'échange est versionné par `/api/v1` | Archi §12 | ~~C.1~~ |
| Horloge du téléphone fausse (date de saisie postérieure à la réception, ou invraisemblable) : refuser l'événement, ou l'accepter en le signalant à l'admin ? (C.2 juge le futur, les trois jours et la clôture d'une **déclaration** sur sa date de saisie ; une correction se juge de même, C.4). Chaque événement ayant une date côté client et une date côté serveur, l'écart entre les deux est mesurable — et pour une correction, écrite en ligne, il devrait être de quelques secondes) | CdC (non précisé) | F.1 |
| ~~L'admin doit-il pouvoir travailler hors-ligne dès la V1 ?~~ ✅ tranché le 2026-11-06 : oui pour la saisie, en trois volets — écritures d'argent ajoutées et jamais modifiées (identifiant créé sur l'appareil) ; coût, paiement, vente et déclaration à la place du gardien en file d'attente ; référentiels, modification de commande, clôture et comptes restent en ligne | Archi, décisions postérieures | ~~O.3, P.1, P.7~~ |
| Combien de temps les éleveurs pilotes restent-ils sans aucun réseau (heures ou jours) ? La réponse décide du calcul local complet des chiffres du bureau | CdC « Points ouverts » | Rien en V1 |
| Par quel écran l'admin annule-t-il une déclaration (C.7) ? Même question que la suivante | CdC (non précisé) | Aucune tranche d'écran ne le porte encore ; touche O.4, U.2 |
| Par quel écran l'admin déclare-t-il à la place du gardien : le cahier du site (hors-ligne, trois taps, avec le choix d'un jour au-delà d'avant-hier) ou le bureau (en ligne seulement) ? | CdC (non précisé) | Aucune tranche d'écran ne le porte encore ; touche J.2 et O.4 |
| ~~Retirer une déclaration faite par erreur (double saisie, mauvais jour, mauvais geste)~~ ✅ tranché le 2026-11-06 : l'admin l'annule, en ligne — l'annulation est tracée, définitive, et l'emporte sur toute correction (C.7) | CdC « Corrections » | ~~C.6~~ |
| Le gardien peut-il annuler lui-même, dans ses trois jours et en ligne, comme il corrige ? (reporté le 2026-11-06 : « on verra plus tard » ; d'ici là une erreur attend que l'admin soit joignable) | CdC « Points ouverts » | K.5 |
| Date de dernière synchro du cahier de chaque appareil : la garder côté serveur et l'afficher (au bureau : « le cahier d'Ousmane n'a rien envoyé depuis 2 jours », pour ne pas lire « non déclaré » là où il faut lire « pas encore reçu » ; au gardien : de quand datent ses chiffres) ? Recommandé ; ce n'est pas une condition de l'annulation, que le serveur arbitre seul | CdC (non précisé) | F.2, F.3, O.4, U.2 |
| ~~Le gardien peut-il corriger une ligne que l'admin a écrite à sa place ?~~ ✅ tranché le 2026-11-06 : oui, dans ses trois jours, du moment que c'est tracé — la ligne de l'admin et la correction restent au journal, et la correction est signalée à l'admin | CdC « Corrections » | ~~K.5, F.1~~ |
| ~~Base de départ des vivants : effectif commandé ou poussins réellement reçus (bonus compris) ?~~ ✅ tranché le 2026-11-06 : toujours les poussins réellement reçus, bonus compris ; des poussins manquants constatés après comptage sont déclarés plus tard par l'admin comme des pertes | CdC, cas du bonus poussins | ~~C.5~~ |
| ~~Sous quel type l'admin déclare-t-il les poussins manquants après comptage : des morts, ou un type à part ?~~ ✅ tranché le 2026-11-06 : un type à part — une perte en poussins n'est pas une mort. Manquants et dons diminuent les vivants, mais ne comptent ni ne s'affichent parmi les morts | CdC « Architecture des données », référentiel des types de pertes | ~~C.5, O.4~~ |
| ~~Morts déclarés supérieurs aux vivants : refuser, ou accepter et alerter l'admin ?~~ ✅ tranché le 2026-11-06 : la déclaration est acceptée et l'admin est alerté — un refus créerait un trou de donnée | CdC « Architecture des données » | ~~C.5, K.1~~ |
| JWT : durée de vie et stratégie de renouvellement | Archi §12 | E.2 |
| Stockage du jeton dans la PWA ; sort d'une outbox non synchronisée à la déconnexion | Archi §6 | G.2, G.5 |
| Règle de composition des nombres en clips ; format et poids des clips | CdC « Points ouverts », Archi §12 | I.1, I.2 |
| Une tâche sanitaire non faite est-elle reportée au lendemain ? | CdC (non précisé) | L.1 |
| Source de la météo, et seuil de chaleur qui déclenche la tâche bicarbonate | CdC (non précisé) | L.3 |
| Une seule campagne en cours par site ? | CdC (non précisé) | O.2 |
| Seuil par défaut de l'alerte de mortalité sur 7 jours | CdC « Points ouverts » | O.4 |
| Coût par poulet à date : engagé ÷ vivants ou ÷ effectif mis en place ? Et quel arrondi ? | CdC (non précisé) | P.1 |
| Champs de saisie propres à chaque type de coût | CdC « Points ouverts » | P.6 |
| Un règlement supérieur à la dette : refusé, ou il crée une créance ? | CdC (non précisé) | R.2 |
| Une vente diminue-t-elle le compteur de vivants vu par le gardien ? | CdC (non précisé) | W.1 |
| Modèles de balance à répliquer (0–5 kg, 0–10 kg, digitale) | CdC « Points ouverts » | T.3 |
| Délais de rétention des médias, durée légale des pièces justificatives | CdC « Points ouverts » | U.3 |
| Que devient un événement synchronisé après la clôture de la campagne ? Et l'admin peut-il encore corriger le cahier après la clôture (aujourd'hui refusé, C.4) ? | CdC (non précisé) | X.3 |
| Hébergeur et région | Archi §12 | Z.5 |
| Correspondance des onglets Excel vers les événements | CdC « Points ouverts » | Z.6 |

## Réserves du QA à lever avant la fin de la V1

Ce que `/qa` valide « avec réserves » est tenu dans `docs/cahier-de-recette.md` (verdicts, réserves numérotées, ce qui n'a pas pu être vérifié, recette manuelle sur appareil). Aucune réserve ne bloque la tranche où elle a été trouvée, mais chacune doit être levée, ou acceptée par le fondateur, avant la mise en production (Z.5). Onze réserves sont ouvertes au 2026-11-06 : R-1 à R-7 (QA, de C.4 à C.7) et R-8 à R-11 (sécurité, D.2 et D.3).

## Reprises depuis build-track

Avant d'écrire une brique générique, on la reprend de l'ERP Travaux avec ses tests (`CLAUDE.md` §3). Ce qui n'a aucun vocabulaire métier va dans `packages/kit`, candidat à un dépôt commun ; le reste s'adapte sur place.

| Brique dans build-track | Fichiers d'origine | Tranche | Destination |
|---|---|---|---|
| Résultat typé, identifiants typés | `domain/shared/result.ts`, `ids.ts` | B.3 ✅ | `packages/kit` (`Result`, `Brand`) ; les identifiants eux-mêmes dans `packages/domain` |
| Montants, devise | `domain/shared/money.ts`, `signed-money.ts`, `currency-code.ts` | B.1 ✅ | `packages/kit/src/money/` |
| Table des devises, formatage d'un montant | `domain/shared/currency.ts` | P.4 | `packages/kit` |
| Arrondi explicite, taux | `domain/shared/rounding-policy.ts`, `rate.ts`, `basis-points.ts` | P.1 (coût par poulet) | `packages/kit`, quand P.1 en a besoin |
| Horloge injectée | `workflows/ports/clock.ts`, `infrastructure/clock/` | B.4 ✅ (port `Clock`), F.1 (horloge système) | `packages/kit` pour le port ; `apps/api` pour l'horloge système, qui dépend de NestJS |
| Tenant fixé par transaction, RLS | `infrastructure/database/prisma.service.ts`, migration `0002_row_level_security` | D.2 | `apps/api`, à adapter |
| Hachage argon2 | `infrastructure/auth/argon2-password-hasher.ts` | E.1 | `apps/api` |
| Garde fermée par défaut, `@Public` | `infrastructure/auth/jwt-auth.guard.ts`, `public.decorator.ts` | A.3 (`@Public`, refus par défaut) ✅, E.3 (session) | `apps/api`, à adapter (téléphone + PIN) |
| Journal d'audit en ajout seul | `infrastructure/audit/` | E.6 | `apps/api`, à adapter |
| Dépôt de fichiers par empreinte, type vérifié sur le contenu | `infrastructure/documents/document-store.ts`, `content-type.ts`, `content-disposition.ts` | M.1 | `apps/api`, à adapter |
| Route de santé | `infrastructure/health/health.controller.ts` | A.3 (vivacité) ✅, D.1 (disponibilité, avec la base) | `apps/api` |
| Configuration validée au démarrage | `infrastructure/config/app-config.ts` | D.1 (première variable exigée : `DATABASE_URL`) | `apps/api` |
| Build de l'API en un fichier | `backend/scripts/build.mjs` | A.3 ✅ | `apps/api/build.mjs`, sans `esbuild-plugin-tsc` (réécrit en 15 lignes) |
| Caddy, Dockerfiles, compose | `frontend/Caddyfile`, `*/Dockerfile`, `docker-compose*.yml`, `.dockerignore` | A.3 ✅, Z.5 (surcouche de production) | `infra/` |
| État du réseau, mise à jour de l'app | `frontend/core/offline/` | G.1, G.4 | `apps/web`, à adapter (ici le hors-ligne écrit) |
| Formatage des montants, valeur absente | `frontend/core/money/` | P.4 | `packages/kit` ou `apps/web`, à trancher en P.4 |
| Traduction des erreurs d'API | `frontend/core/api/api-error.ts` | G.2 | `apps/web` |

Ce qu'on ne reprend pas tel quel : les versions. build-track tourne sur NestJS 10, dont `multer` et `body-parser` ont des vulnérabilités hautes ; tout code d'infrastructure repris passe `npm audit` ici.

---

# LOT 1 — Socle

## A — Monorepo et outillage

### A.1 — ⚙ Le workspace démarre, teste et compile en strict · **M** ✅
> Spec : Archi §10 · Zone : racine, `apps/web`, `apps/api`, `packages/{domain,contracts,design-system}`, `tools/`
> Dépend de : — · Revue : `package.json` (chaque dépendance), `tsconfig.base.json`, les `project.json`. Seule la coquille web vient d'un générateur ; le reste est écrit à la main.
> Livré le 2026-11-05 : Angular 21 (LTS), NestJS 11, TypeScript 5.9, Nx 24 sans plugin, Vitest 4 (web, packages), Jest 29 (API). Audit : zéro vulnérabilité à l'exécution ; 7 alertes faibles dans Jest, sans correctif publié. Le 2026-11-06, `packages/shared` est renommé `packages/contracts` (le nom de build-track) : ce paquet ne porte que les contrats entre le web et l'API, pas les briques communes, qui sont dans `packages/kit`.

- [x] Le monorepo Nx contient `apps/web`, `apps/api`, `packages/domain`, `packages/contracts`, `packages/design-system`
- [x] TypeScript est strict partout (`strict`, `noUncheckedIndexedAccess`) et `any` est refusé par le lint
- [x] Chaque projet a un test qui passe, lancé par une seule commande à la racine
- [x] Tout `package.json` est privé et renvoie à `LICENSE`
- [x] Les specs rejoignent `docs/` et `CLAUDE.md` (sources de vérité, §9 Commandes) est mis à jour

### A.2 — Les frontières de dépendance sont tenues par le lint · **S** ✅
> Spec : `CLAUDE.md` §3 · Zone : `eslint.config.mjs`, `tools/boundaries.spec.mjs`, `tsconfig.base.json` (alias), `packages/domain/src/{journal,finance}/`
> Dépend de : A.1, A.5 · Revue : chaque interdiction ci-dessous est prouvée par un import fautif dans `tools/boundaries.spec.mjs`.
> Livré le 2026-11-05 : **aucune dépendance ajoutée**. `@nx/eslint-plugin`, prévu ici, embarque `@nx/js` (Babel, générateurs) et ne distingue ni les routes gardien des routes admin, ni les deux entrées du domaine : les frontières sont écrites avec la règle native `no-restricted-imports`. Les étiquettes `scope:*` des `project.json` ne servent donc à aucune règle. Les alias se résolvent dans le typage, Vitest et le build web ; pas encore dans l'API (A.3).

- [x] `packages/domain` ne peut importer ni NestJS, ni Prisma, ni Angular, ni une API propre à Node
- [x] `packages/domain` a deux points d'entrée, `journal` et `finance` (`@domain/journal`, `@domain/finance`), sans import profond
- [x] `domain/journal` n'importe jamais `domain/finance`, ni par l'alias ni par un chemin relatif
- [x] Une route gardien qui importe `domain/finance` fait échouer le lint, import différé compris
- [x] Hors de `apps/web/src/app/admin/`, rien n'importe `domain/finance` ni le code admin en statique
- [x] `packages/contracts` n'importe rien et ne contient aucun code exécutable
- [x] `packages/kit` n'importe rien du reste du workspace
- [x] Un import relatif ne sort pas de son projet : il passe par un alias
- [x] Un alias se résout dans les tests des packages, et Nx suit ces imports pour le cache et `affected`

### A.3 — La pile tourne en conteneurs derrière une seule origine · **M** ✅
> Spec : Archi §9 · Zone : `infra/`, `.dockerignore`, `apps/api/src/{auth,health}/`, `apps/api/build.mjs`, `tools/infra.spec.mjs`
> Dépend de : A.1 · Revue : aucun secret dans les fichiers versionnés ; PostgreSQL non exposé.
> Livré le 2026-11-05, repris de build-track (compose, Caddyfile, Dockerfiles, `@Public`, route de santé, stratégie de build). Une dépendance déclarée, déjà installée par Angular : `esbuild` 0.28.1. Pile démarrée et interrogée pour de vrai : web 200, santé 200 par Caddy, repli SPA, en-têtes, base injoignable depuis Caddy et sans sortie vers internet.
> Limites : la base tourne mais l'API ne s'y connecte pas encore (D.1, avec la sonde de disponibilité et la configuration validée au démarrage) ; l'image de l'API embarque les paquets d'exécution d'Angular, faute de manifeste par application (59 Mo de `node_modules`, à reprendre en Z.5) ; HTTPS et HSTS sont en Z.5.

- [x] `docker compose up` démarre le web derrière Caddy, l'API et PostgreSQL (trois conteneurs : Caddy sert lui-même le web statique)
- [x] Caddy sert le web et relaie `/api/v1` vers l'API : une seule origine, CORS jamais activé
- [x] L'API répond sur une route de santé publique ; toute autre route est refusée sans session (401, garde globale fermée par défaut)
- [x] L'API testée (Jest) et construite démarre alors qu'elle importe une règle par `@domain/journal` et `@kit` (bundle esbuild, alias résolus au build)
- [x] Les secrets viennent de l'environnement, exigés sans valeur par défaut ; `.env.example` ne contient aucune valeur réelle
- [x] PostgreSQL n'est joignable que depuis le réseau interne du compose, et par l'API seule : Caddy n'a aucun chemin vers la base
- [x] Les images tournent sans privilèges ni outils de build (API sous l'utilisateur `node`, web = Caddy et fichiers statiques)

### A.4 — La CI ne laisse passer que du vert · **S** ✅
> Spec : `CLAUDE.md` §9 · Zone : `.github/workflows/ci.yml`, `tools/{ci,licenses}.spec.mjs`, `tools/licenses.mjs`, `implicitDependencies` des `project.json`
> Dépend de : A.1, A.2 · Revue : ce qui déclenche quoi.
> Livré le 2026-11-05 : GitHub Actions, aucune dépendance ajoutée (le contrôle des licences lit le verrou, 40 lignes). Actions officielles épinglées par empreinte, droits en lecture seule, aucun secret. **Le pipeline n'a pas encore tourné sur GitHub** : ses étapes ont été rejouées en local ; la première poussée fera foi.

- [x] Une modification déclenche lint, tests, typage et build des seuls projets touchés
- [x] Un changement dans `packages/domain` ou `packages/contracts` déclenche le web et l'API ; dans le kit, le domaine aussi
- [x] Un changement de règle commune (`tsconfig.base.json`, ESLint, `nx.json`, verrou) déclenche tous les projets
- [x] Sans base de comparaison fiable (première poussée, historique réécrit), la CI vérifie tout
- [x] Une dépendance sous licence GPL ou AGPL, ou sans licence connue, fait échouer la CI, même indirecte ou de développement
- [x] Les règles du workspace (structure, frontières, conteneurs) et l'audit des dépendances tournent à chaque fois

### A.5 — ⚙ Le kit maison existe et ne dépend de rien · **S** ✅
> Spec : Archi §10 « Mutualisation avec l'ERP Travaux » ; `CLAUDE.md` §3 · Zone : `packages/kit/`, `tools/workspace.spec.mjs`
> Dépend de : A.1 · Revue : le kit ne contient aucun mot du métier avicole ; le README dit d'où vient chaque brique.
> Livré le 2026-11-05 : le kit est vide (un point d'entrée, un test de banc), aucune dépendance ajoutée. Les imports étrangers et une brique sans provenance font échouer `npm test` ; une API de Node ou du navigateur dans le code livré fait échouer `npx nx typecheck kit` (`tsconfig.lib.json`).

- [x] `packages/kit` est un projet du workspace, testé avec Vitest comme les autres packages
- [x] Il n'importe ni framework, ni le reste du workspace, ni une API propre à Node
- [x] Son README note, pour chaque brique reprise, le fichier d'origine dans build-track et sa révision
- [x] `tools/workspace.spec.mjs` connaît le nouveau projet

## B — Fondations du domaine

### B.1 — Un montant ne connaît pas l'erreur d'arrondi · **S** ✅
> Spec : `CLAUDE.md` §4 règle 7 · Zone : `packages/kit/src/money/`
> Dépend de : A.5, B.3 · Revue : **reprise de build-track** (`money.ts`, `signed-money.ts`, `currency-code.ts` et leurs tests) — relire les écarts avec l'original, pas le code entier.
> Livré le 2026-11-06. **Une dépendance de développement ajoutée** : `fast-check` 4.10.2 (MIT, tests de propriétés, une sous-dépendance `pure-rand`) ; audit inchangé, zéro à l'exécution. Seuls les fichiers de test l'importent (lint). Écarts avec build-track, détaillés dans `packages/kit/README.md` : ajout de `times` et du refus au-delà de l'entier exact (2^53 − 1), jamais arrondi ; `sum`, `isZero`, `isGreaterThan`, `DEFAULT_CURRENCY` et la table des devises (`currency.ts`, formatage) ne sont pas repris tant que rien ne s'en sert.

- [x] Un montant entier en FCFA est valide ; une fraction de franc est refusée
- [x] Un montant négatif est refusé ; une différence qui peut l'être vit dans `SignedMoney`
- [x] Deux montants de même devise s'additionnent ; deux devises différentes ne s'additionnent pas
- [x] Un montant multiplié par une quantité entière reste un entier exact
- [x] Un montant, une somme ou un produit trop grand pour rester exact est refusé, jamais arrondi
- [x] Un montant nul est distinct d'un montant absent
- [x] Pour tous montants `a` et `b`, `(a + b) − b = a` (property-based)

### B.2 — Les quantités et les poids sont entiers · **S** ✅
> Spec : `CLAUDE.md` §4 règle 7 ; CdC « Demande de pesée » · Zone : `packages/domain/src/journal/{quantity,weight}.ts`
> Dépend de : A.2 · Revue : le gardien ne manipule jamais de fraction.
> Livré le 2026-11-06, aucune dépendance ajoutée. `Quantity` et `Weight` sont des types marqués : un nombre non vérifié ne passe pas pour eux, et l'un ne passe pas pour l'autre. Trois motifs rejoignent la liste fermée (`InvalidQuantity`, `InvalidWeight`, `WeightOutOfScale`). La balance (`Scale`) ne porte ici que sa capacité en grammes, fournie par l'appelant : les modèles de balance restent la décision ouverte de T.3. **Un poids s'enregistre au gramme près** (décision du 2026-11-06) : le pas de 50 g n'est qu'une aide à la saisie sur le cadran (T.3), le domaine et le serveur ne le vérifient pas — une lecture depuis une photo ou une balance digitale tombe entre deux graduations.

- [x] Une quantité déclarée est un entier strictement positif
- [x] Zéro n'est pas une quantité : il se déclare par un événement dédié
- [x] Un poids s'exprime en grammes entiers, au gramme près ; le pas de 50 g du cadran n'est pas une règle du domaine
- [x] Un poids nul ou négatif est refusé
- [x] Un poids hors de l'échelle de la balance du site est refusé ; sans capacité connue, aucun poids n'est accepté

### B.3 — Identifiants typés et résultat typé · **S** ✅
> Spec : `CLAUDE.md` §4 règle 2, §8 · Zone : `packages/kit/src/` (`result.ts`, `brand.ts`), identifiants et motifs de refus du métier dans `packages/domain/src/journal/` (`ids.ts`, `refusal.ts`)
> Dépend de : A.5 · Revue : **reprise de build-track** (`result.ts`, le motif des identifiants typés de `ids.ts`). Différence voulue : ici l'UUID vient du client, pas de la base.
> Livré le 2026-11-05, aucune dépendance ajoutée. Écarts avec build-track : `Result` n'a plus de type d'erreur par défaut (le kit ignore le métier) ; un identifiant ne s'obtient plus par simple conversion mais par vérification de l'UUID, qui rend un résultat. Seule l'écriture canonique en minuscules est acceptée, toute version d'UUID comprise : un identifiant n'a qu'une écriture, sans quoi l'idempotence par UUID ne tient pas. Les refus à la compilation sont vérifiés par `typecheck`, pas par `test`.
> **Dernier scénario reformulé** : la liste fermée ne contient que le motif dont la règle existe (`InvalidId`). Les motifs des tranches suivantes arrivent avec leur règle et leur test (`CLAUDE.md` §7), et leurs données dépendent de types qui n'existent pas encore (jour métier, quantité). Seuls `SiteId` et `CampaignId` sont créés ; les autres identifiants viennent avec C.1.

- [x] Un identifiant de site et un identifiant de campagne ne sont pas interchangeables à la compilation
- [x] Un identifiant est un UUID fourni par l'appelant ; le domaine n'en génère pas
- [x] Un refus métier est un résultat typé, jamais une exception
- [x] Les motifs de refus forment une liste fermée : un motif ajouté sans son test, ou un motif inconnu, ne se compile pas

### B.4 — Le jour métier et l'âge de la bande · **S** ✅
> Spec : CdC « Jour J », « deux dates » · Zone : `packages/domain/src/journal/business-day.ts`, `packages/kit/src/clock.ts`, `eslint.config.mjs`
> Dépend de : B.3 · Revue : aucun `new Date()` ; l'heure vient d'un port horloge.
> Livré le 2026-11-06, aucune dépendance ajoutée (le fuseau passe par `Intl`, présent sur le serveur comme sur le téléphone). Le port `Clock` est repris de build-track dans le kit ; le domaine, lui, reçoit un instant en paramètre, et **le lint refuse désormais `new Date()` sans argument et `Date.now()` dans le domaine et le kit**. `BusinessDay` est une chaîne `AAAA-MM-JJ` marquée, et non la classe `CalendarDate` de build-track (dont la validation est reprise) : un événement se stocke et s'envoie tel quel. Deux motifs rejoignent la liste fermée (`InvalidBusinessDay`, `InvalidTimeZone`).
> **À confirmer** : le jour de la mise en place est **J0**, comme la table Cobb 500 (J0 à J49) ; la maquette affiche « Jour 23 » sans dire si le premier jour s'affiche 0 ou 1. Un jour antérieur à la mise en place donne un J négatif : c'est C.2 qui le refusera. Le fuseau d'un site est un nom IANA (`Africa/Dakar`) à porter par le site (D.1).

- [x] Un jour métier est une date sans heure, dans le fuseau du site
- [x] Une date qui n'existe pas au calendrier, ou un fuseau inconnu, est refusé
- [x] Le jour J d'une campagne se déduit de sa date de mise en place et du jour métier (mise en place = J0)
- [x] « Aujourd'hui », « hier » et « avant-hier » se déduisent de l'horloge fournie
- [x] À minuit passé, « aujourd'hui » change sans que la date de saisie d'un événement déjà créé change
- [x] Le domaine et le kit ne lisent jamais l'heure eux-mêmes (lint)

## C — Le journal (domaine)

### C.1 — Un événement est un fait signé et immuable · **M** ✅
> Spec : CdC « Architecture des données » ; `CLAUDE.md` §4 règles 1 et 2 · Zone : `packages/domain/src/journal/{journal-event,instant,media-fingerprint,ids}.ts`
> Dépend de : B.2, B.3, B.4 · Revue : la liste des types d'événements et leurs champs — c'est le contrat le plus durable du produit.
> Livré le 2026-11-06, aucune dépendance ajoutée. **Pas de champ `version`** (décision du 2026-11-06) : le schéma n'évolue que par ajout. `JournalEvent(envelope, fact)` (renommé `Declaration(envelope, fact)` en C.4) assemble des valeurs déjà vérifiées, ne recopie que les champs du schéma et gèle le résultat en profondeur ; un type hors liste ne se compile pas et, s'il contourne le typage, lève une panne. La date de saisie est un `Instant` (texte en temps universel, à la milliseconde) et non un `Date`, qui resterait modifiable. Un média est désigné par son empreinte SHA-256 (`MediaFingerprint`). Six identifiants et deux motifs de refus (`InvalidInstant`, `InvalidMediaFingerprint`) s'ajoutent.
> **Champs par type, à relire** : mort et sac ouvert → `quantity` ; rien perdu → aucun champ ; réception → `orderLineId`, `receivedQuantity`, `deliveryNote` (photographié avec son empreinte, ou « pas de papier ») ; pesée → `weighingRequestId`, `weights` ; tâche faite → `taskId` ; vocal et photo → `media`.
> **Reporté** : le nombre de poids d'une pesée (cinq) est la règle de T.1 ; l'appareil vient de la session (F.1) et n'est pas dans l'événement du domaine ; **rien n'est écrit dans `packages/contracts`** — le DTO d'échange et le décodage d'un événement reçu en JSON arrivent avec leur premier consommateur (F.1).

- [x] Un événement porte : UUID, tenant, site, campagne, type, auteur, date métier, date de saisie
- [x] Les types d'événements forment une liste fermée (mort, sac ouvert, rien perdu, réception, pesée, tâche faite, vocal, photo)
- [x] Un événement porte des faits, jamais une valeur calculée (cinq poids, pas leur moyenne)
- [x] Un événement construit ne peut plus être modifié
- [x] Aucun type d'événement ne porte de montant
- [x] Un champ hors du schéma, glissé dans la signature ou dans le fait, n'entre pas dans le journal

### C.2 — Une déclaration invalide est refusée · **S** ✅
> Spec : CdC « Rattrapage » · Zone : `packages/domain/src/journal/{validate-declaration,campaign,role}.ts`
> Dépend de : C.1 · Revue : chaque motif de refus a son test.
> Livré le 2026-11-06, aucune dépendance ajoutée. `validateDeclaration(event, { campaign, timeZone, authorRole })` rend l'événement ou l'un de cinq motifs (`SiteNotOfCampaign`, `CampaignClosed`, `FutureBusinessDate`, `BusinessDateBeforePlacement`, `CatchUpWindowPassed`). **Tout se juge au moment de la saisie** (`recordedAt`, dans le fuseau du site), jamais à la réception : la fonction ne prend pas d'horloge, donc une déclaration restée hors-ligne reçoit la même réponse sur le serveur que sur le téléphone. **La limite de trois jours ne vaut que pour le gardien** (décision du 2026-11-06, ajoutée au CdC) ; un rôle inconnu est traité comme le gardien. `Campaign` ne porte que ce que la règle lit (site, mise en place, instant de clôture) : O.2 la complétera.
> **Laissé ouvert** : une déclaration écrite avant la clôture et synchronisée après n'est pas refusée ici — son sort reste la décision de X.3. La confiance dans l'horloge du téléphone est une décision d'ingestion (tableau des décisions, F.1).

- [x] Une déclaration pour une date métier future est refusée
- [x] Une déclaration antérieure à la mise en place de la campagne est refusée
- [x] Le gardien déclare pour aujourd'hui, hier ou avant-hier, pas au-delà ; l'admin supplée pour tout jour depuis la mise en place
- [x] Le futur et les trois jours se jugent au moment de la saisie, dans le fuseau du site
- [x] Une déclaration faite après la clôture de la campagne est refusée
- [x] Une déclaration sur un site qui n'est pas celui de la campagne est refusée

### C.3 — Qui a le droit de déclarer · **S** ✅
> Spec : CdC « Gouvernance des déclarations » · Zone : `packages/domain/src/journal/declaration-policy.ts`
> Dépend de : C.1 · Revue : le mode strict est un choix de l'admin, jamais un verrou par défaut.
> Livré le 2026-11-06, aucune dépendance ajoutée. `authorizeDeclaration(event, { author, site })` rend l'événement ou l'un de trois motifs (`RoleCannotDeclare`, `NotAssignedToSite`, `StrictModePrimaryOnly`). L'équipe d'un site (`SiteStaff`) porte son titulaire, ses remplaçants et le mode strict ; l'admin passe toujours, même en mode strict et sans être affecté. Seuls l'admin et le collaborateur déclarent : tout autre rôle est refusé (`RoleCannotDeclare`), même inscrit par erreur dans l'équipe du site. Il n'existe pas de champ « pour le compte de » : l'événement nomme celui qui l'a écrit. Le défaut « mode strict désactivé » est celui de la configuration du site (O.1) ; ici, la valeur est fournie par l'appelant.

- [x] Un collaborateur affecté au site peut déclarer
- [x] Un collaborateur d'un autre site ne peut pas déclarer
- [x] En mode strict, seul le titulaire du site déclare ; sans titulaire, aucun collaborateur ne déclare
- [x] L'admin peut toujours déclarer à la place du gardien, et l'événement le nomme comme auteur
- [x] Sans mode strict, un remplaçant déclare comme le titulaire

### C.4 — La contre-déclaration corrige sans effacer · **M** · 🧪 ✅
> Spec : CdC « Corrections » · Zone : `packages/domain/src/journal/{counter-declaration,journal-event,validate-declaration}.ts`
> Dépend de : C.1, C.2 · Revue : l'événement d'origine reste intact, quoi qu'il arrive.
> Livré le 2026-11-06, aucune dépendance ajoutée. Une contre-déclaration est un événement signé comme un autre, qui nomme la déclaration qu'elle corrige (`corrects`) et porte le fait qui la remplace. `validateCounterDeclaration(counter, { corrected, campaign, timeZone, authorRole })` rend six motifs propres (`CorrectsItself`, `CorrectsACounterDeclaration`, `CorrectsEventElsewhere`, `CorrectionChangesBusinessDate`, `CorrectionChangesType`, `CorrectionChangesReference`) ou l'un de ceux de C.2. `effectiveJournal(events)` rend une ligne par déclaration (`JournalLine` : la déclaration telle qu'écrite, la correction qui fait foi, le fait qui compte).
> **Décisions du 2026-11-06, ajoutées au CdC et à l'architecture** : (1) **pas d'annulation dans cette tranche** — elle revient en C.7, par l'admin seul ; (2) **une correction après envoi s'écrit en ligne**, pour le gardien comme pour l'admin ; (3) le gardien corrige **les trois jours de son cahier**, l'admin tout jour depuis la mise en place ; (4) chaque correction est signalée à l'admin, et une déclaration tardive est marquée (O.4, Y.2) ; (5) **une correction se juge à l'horloge du gardien**, comme une déclaration — on part d'un seul gardien par site, la règle se reverra si plusieurs téléphones corrigent le même cahier ; (6) **chaque événement a une date côté client et une date côté serveur** (`recordedAt`, et `receivedAt` posée à l'enregistrement en base : D.3, F.1) ; (7) **la dernière correction écrite fait foi**, d'après les dates côté client ; (8) **le gardien peut corriger une ligne écrite par l'admin**, du moment que c'est tracé — la ligne de l'admin et la correction du gardien restent toutes deux au journal.
> **Dans le domaine** : `validateCounterDeclaration` vérifie ce qui fait une correction, puis finit par `validateDeclaration` — les trois jours du gardien et la clôture se jugent à la date de saisie de la correction, sans horloge en paramètre. Dans `effectiveJournal`, « la dernière » correction est celle dont la date de saisie est la plus récente (à égalité, le plus grand identifiant) ; les lignes sortent dans l'ordre d'écriture des déclarations ; le résultat ne dépend ni de l'ordre d'arrivée ni des doublons. Sous un même identifiant, seul le premier événement reçu compte, comme à l'ingestion. Limites connues et acceptées : un téléphone dont on recule la date corrige au-delà de trois jours, et entre deux appareils (gardien et admin) une horloge décalée peut faire perdre la correction réellement la plus récente ; l'écart entre les deux dates de chaque événement le rendra visible (décision ouverte de F.1).
> **Choix à relire** : une correction garde l'objet de la déclaration (ligne de commande, demande de pesée, tâche, média) et ne change que les valeurs mesurées — quantité, poids, papier du livreur ; un vocal ou une photo ne se remplace donc pas. Une contre-déclaration vise toujours la déclaration d'origine, jamais une autre correction. Une correction dont l'origine est absente du journal ne crée aucune ligne. Après la clôture, une correction est refusée, pour l'admin aussi (X.3).
> **Passages de `/qa` le 2026-11-06.** Premier passage : refusé (annulation défaite par une correction du gardien ; correction qui change la ligne de commande, la tâche ou le média ; contre-déclaration portant l'identifiant de sa déclaration ; résultat dépendant de l'ordre d'arrivée sous un même identifiant). Les quatre défauts sont levés par les décisions ci-dessus. Second passage : **validé avec réserves** — une correction identique à la déclaration est acceptée (sans effet, mais elle sera signalée à l'admin) ; `effectiveJournal` fait confiance à des événements déjà validés (une correction d'un autre type, jamais validée, remplacerait le fait) : c'est l'ingestion (F.1) qui le garantit. Une question rejoint le tableau des décisions : retirer une déclaration faite par erreur.
> **Reporté** : la maquette `journal-gardien.html` remet encore en file d'attente la correction d'une ligne déjà envoyée — à reprendre avec K.5.

- [x] Une contre-déclaration référence un événement du même site et de la même campagne
- [x] L'événement d'origine reste dans le journal, inchangé
- [x] Le journal effectif d'un jour tient compte des contre-déclarations (3 morts corrigés en 2 comptent pour 2)
- [x] Une contre-déclaration peut elle-même être corrigée ; la dernière écrite fait foi, quel que soit l'ordre d'arrivée
- [x] Une contre-déclaration ne change ni l'auteur ni la date de saisie de l'événement d'origine
- [x] Une contre-déclaration garde le jour, le type et l'objet de la déclaration, et vise toujours la déclaration d'origine
- [x] Une contre-déclaration ne porte pas l'identifiant de la déclaration qu'elle corrige
- [x] Le gardien corrige les trois jours de son cahier, comptés à la date de saisie de la correction ; l'admin corrige au-delà
- [x] Une correction écrite après la clôture est refusée
- [x] Le gardien corrige une ligne écrite par l'admin : la ligne garde la signature de l'admin, la correction celle du gardien
- [x] Le journal effectif ne dépend ni de l'ordre d'arrivée ni des doublons (property-based)

### C.5 — Les vivants se recalculent depuis le journal · **M** · 🧪 ✅
> Spec : CdC « En-tête et contexte », « Architecture des données » ; `CLAUDE.md` §4 règle 8 · Zone : `packages/domain/src/journal/{live-count,journal-event,declaration-policy}.ts`
> Dépend de : C.4 · Revue : les trois invariants en property-based.
> Livré le 2026-11-06, aucune dépendance ajoutée. `computeLiveCount(events, { campaignId, placementOrderLines })` rend `{ received, deaths, losses, liveCount }` : les animaux réellement reçus sur les lignes de commande de mise en place, les morts, les pertes hors mortalité, et `liveCount = received − deaths − losses`, signé. Le calcul passe par le journal effectif (C.4) : une correction compte à la place de sa déclaration, et ni l'ordre d'arrivée ni les doublons ne changent le résultat. Seuls les événements de la campagne demandée comptent.
> **Décisions du 2026-11-06, ajoutées au CdC** : (1) les vivants partent toujours des poussins réellement reçus, bonus compris, jamais de l'effectif commandé ; (2) des morts déclarés supérieurs aux vivants sont acceptés et l'admin est alerté — le calcul n'est pas bridé à zéro, ce que le compteur affiche alors se décidera avec les écrans ; (3) **une perte en poussins n'est pas une mort** : manquants et dons diminuent les vivants sans compter ni s'afficher parmi les morts ; (4) **le gardien ne déclare que les morts**, l'admin seul déclare manquants, dons et vols ; (5) les vols se constatent à la fin de la campagne : rien pour eux pour le moment.
> **Nouveau type d'événement** (ajout au schéma de C.1) : `Loss`, avec `lossType` (`Missing` ou `Donation`) et une quantité. La politique de C.3 refuse à un collaborateur de déclarer ou de corriger une perte hors mortalité (`LossByAdminOnly`) ; une correction garde le type de perte (C.4).
> **Choix à relire** : le type de perte est une liste fermée du domaine (manquants, dons), pas un identifiant du référentiel des types de pertes (N.2) — le référentiel pourra s'y rattacher plus tard, par ajout ; les vols n'y sont pas. Le journal ne sait pas qu'une ligne de commande porte des poussins : l'appelant lui donne `placementOrderLines`.
> **Passage de `/qa` le 2026-11-06 : validé avec réserves.** (1) Tant que la réception des poussins n'est pas déclarée — ou si l'appelant ne connaît aucune ligne de mise en place — le premier mort donne des vivants négatifs (−3) : un écran qui s'y fierait lèverait à tort l'alerte de dépassement. Le résultat expose `received` pour le distinguer ; règle d'affichage portée par J.1 et O.4. (2) Les ventes ne diminuent pas les vivants (décision ouverte de W.1). (3) Le calcul prend le journal entier de la campagne : ce que le téléphone du gardien en reçoit est l'affaire de F.3. (4) Comme en C.4, le calcul fait confiance à des événements déjà validés (F.1).

- [x] Les vivants valent les poussins réellement reçus (bonus compris) moins les pertes déclarées
- [x] Un bonus de l'écloserie augmente les vivants ; un manque à la réception les diminue : l'effectif commandé ne compte pas
- [x] Les réceptions partielles de poussins se cumulent ; une réception d'aliment ne met aucun poussin en place
- [x] Des poussins manquants constatés après comptage, déclarés plus tard par l'admin, diminuent les vivants sans réécrire la réception
- [x] Une perte hors mortalité (manquants, dons) diminue les vivants mais ne compte pas parmi les morts
- [x] Seul l'admin déclare ou corrige une perte hors mortalité ; le gardien ne déclare que des morts
- [x] Chaque mort confirmé diminue les vivants d'autant
- [x] Une correction compte à la place de la déclaration (3 morts corrigés en 2, 510 reçus corrigés en 508)
- [x] Seuls les événements de la campagne comptent
- [x] Rejouer deux fois le même événement (même UUID) ne change pas les vivants (property-based)
- [x] L'ordre d'arrivée des événements ne change pas les vivants (property-based)
- [x] Une déclaration de morts supérieure aux vivants est acceptée : les vivants passent sous zéro, jamais bridés

### C.6 — Le résumé d'un jour distingue zéro et absence · **S** · 🧪 ✅
> Spec : CdC « Le zéro est une déclaration », « Garde-fous anti-doublon » · Zone : `packages/domain/src/journal/day-summary.ts`
> Dépend de : C.4 · Revue : trois états distincts, jamais confondus.
> Livré le 2026-11-06, aucune dépendance ajoutée. `summarizeDay(events, { campaignId, businessDate })` rend `mortality` — `NotDeclared`, `NoLossDeclared` ou `DeathsDeclared` avec le total — et, par auteur, les morts et les sacs ouverts déjà écrits pour le jour. `declaredBefore(summary, type, authorId)` sépare ce que l'auteur a déjà écrit (`null` s'il n'a rien écrit : jamais `0`) de ce que les autres ont écrit. `validateAgainstDay(event, journal)` refuse « rien perdu » quand des morts ont été écrits avant lui ce jour-là (`NoLossAfterDeaths`).
> **Décisions du 2026-11-06, ajoutées au CdC** : (1) **les morts d'un même jour s'ajoutent** — le gardien peut déclarer à chaque tournée ; (2) des morts écrits après un « rien perdu » l'emportent ; (3) **pas de champ « matin, midi, soir »** : le bureau le déduira de l'heure de saisie, pour une déclaration faite le jour même (U.2) ; (4) **le rappel anti-doublon vaut aussi pour le gardien lui-même** (« tu as déjà écrit 3 morts aujourd'hui », K.1, K.3) ; (5) **le gardien ne voit que les morts** : manquants et dons n'entrent pas dans son résumé.
> **Choix à relire** : « rien perdu » se juge à sa date de saisie, comme toute déclaration — écrit le matin, il reste valable si des morts sont écrits le soir, même s'il arrive au serveur après eux. Une ligne corrigée par un autre reste attribuée à son auteur, avec la quantité corrigée. Les sacs ouverts ne disent rien des pertes : un jour qui n'a que des sacs reste « non déclaré ».
> **Passage de `/qa` le 2026-11-06 : validé avec réserves** (R-6, R-7 du cahier de recette).

- [x] Un jour sans aucune déclaration est « non déclaré »
- [x] Un jour avec « rien perdu » est « zéro déclaré », distinct de « non déclaré »
- [x] Un jour avec des morts donne leur total effectif ; plusieurs déclarations du même jour s'ajoutent
- [x] Des morts écrits après un « rien perdu » l'emportent
- [x] Manquants et dons n'entrent pas dans le résumé du gardien
- [x] Le résumé signale qu'un autre auteur a déjà déclaré le même type ce jour-là, et combien
- [x] Le résumé dit ce que l'auteur lui-même a déjà déclaré ce jour-là
- [x] « Rien perdu » écrit un jour qui a déjà des morts est refusé ; écrit avant eux, il reste valable
- [x] Ni l'ordre d'arrivée ni les doublons ne changent le résumé (property-based)

### C.7 — L'admin annule une déclaration faite par erreur · **M** · 🧪 ✅
> Spec : CdC « Corrections » (annulation) ; `CLAUDE.md` §4 règle 1 · Zone : `packages/domain/src/journal/{retraction,journal-event,counter-declaration,declaration-policy}.ts`
> Dépend de : C.4, C.5, C.6 · Revue : une ligne annulée ne compte plus nulle part, et rien ne la fait recompter.
> Livré le 2026-11-06, aucune dépendance ajoutée. **Décision du 2026-11-06** : une déclaration faite par erreur s'annule ; seul l'admin annule pour le moment (le gardien : décision reportée), en ligne ; l'annulation est définitive. Une annulation est un troisième genre d'événement, `Retraction(envelope, retracts)` : signée, elle nomme la déclaration et ne porte aucun fait. `validateRetraction(retraction, { retracted, alreadyRetracted, campaign, timeZone, authorRole })` exige la déclaration d'origine, du même cahier et du même jour, pas déjà annulée, puis juge comme une déclaration (jour, clôture). La politique de C.3 refuse l'annulation à un collaborateur (`RetractionByAdminOnly`). Une déclaration annulée ne se corrige plus (`DeclarationRetracted`).
> **Dans le journal effectif** : une ligne annulée reste (`JournalLine.retraction`), mais son fait vaut `null` — le typage oblige chaque calcul à l'écarter. L'annulation l'emporte sur toute correction **sans lire aucune horloge** et quel que soit l'ordre d'arrivée : c'est ce qui lève le défaut bloquant du premier passage QA de C.4. Les vivants (C.5) et le résumé d'un jour (C.6) ne comptent plus une ligne annulée ; un jour dont tout est annulé redevient « non déclaré ».
> **Choix à relire** : les motifs de refus d'une correction servent aussi à l'annulation (`CorrectsItself`, `CorrectsACounterDeclaration`, `CorrectsEventElsewhere`, `CorrectionChangesBusinessDate`) — moins de messages à dire au gardien. Annulée deux fois, une déclaration garde la première annulation écrite. L'appelant dit si la déclaration visée est déjà annulée (`alreadyRetracted`, `correctedIsRetracted`) : l'ingestion le lira dans le journal (F.1). Annuler puis redéclarer signe la nouvelle déclaration du nom de l'admin.
> **Passage de `/qa` le 2026-11-06 : validé avec réserves** (R-4, R-6 ; R-7 allégée — voir le cahier de recette).

- [x] Une annulation est un événement signé qui nomme la déclaration qu'elle annule, sans aucun fait
- [x] Elle vise la déclaration d'origine, du même cahier et du même jour : ni une correction, ni une autre annulation
- [x] Seul l'admin annule ; le gardien est refusé, même pour sa propre déclaration
- [x] L'admin annule un jour ancien tant que la campagne est en cours ; après la clôture, l'annulation est refusée
- [x] Une déclaration annulée reste au journal et ne compte plus
- [x] Une déclaration annulée ne se corrige plus et ne se ré-annule pas
- [x] Une correction ne fait pas recompter une déclaration annulée, qu'elle soit écrite ou reçue avant ou après
- [x] Les vivants ne comptent plus une ligne annulée (morts, réception de poussins)
- [x] Un jour dont les morts sont annulés redevient « non déclaré » ; une double saisie se rattrape
- [x] Ni l'ordre d'arrivée ni les doublons ne changent ce qui est annulé (property-based)

## D — Base de données et cloisonnement

### D.1 — Le schéma initial porte le tenant partout · **M** ✅
> Spec : Archi §6 · Zone : `apps/api/prisma/`, `apps/api/src/{config,database,health,testing}/`, `infra/`
> Dépend de : A.3 · Revue : le schéma Prisma, pas le SQL généré.
> Livré le 2026-11-06. **Dépendances ajoutées** : `prisma` et `@prisma/client` 6.19.3 (Apache-2.0, la version de build-track). L'audit a trouvé une vulnérabilité haute dans une sous-dépendance de la ligne de commande (`deepmerge-ts` < 8, via `@prisma/config`), corrigée seulement en Prisma 7.10.1 : elle est levée par un `overrides` vers `deepmerge-ts` 8.0.2, et l'audit est de nouveau à zéro. Prisma 7 a été écarté pour l'instant : sa ligne de commande embarque `mysql2`, un studio et un serveur de développement dont on n'a pas besoin. **À planifier** : la branche 6 ne reçoit visiblement plus ce correctif, le passage à Prisma 7 est une tranche à part.
> **Schéma** : `tenants`, `users`, `sites`, `site_assignments`, `campaigns`. UUID fournis par l'appelant, aucun défaut en base. `tenant_id` obligatoire et indexé partout ; une clé étrangère passe par `(tenant_id, id)`, donc la base refuse elle-même une campagne attachée au site d'un autre élevage. Un seul titulaire par site (index partiel écrit à la main). Le rôle est un type énuméré PostgreSQL (`admin`, `collaborator`). Rien de plus que ce que les tranches livrées demandent : ni PIN (E.1), ni avatar (E.5), ni langue du site (I).
> **Tests sur PostgreSQL réel, avec Testcontainers, comme dans build-track** (décision du 2026-11-06, après un premier essai sans) : `@testcontainers/postgresql` 11.14 en dépendance de développement (MIT ; la 12 exige Node 22.22). Elle apportait neuf alertes modérées, levées par deux `overrides` (`uuid` 11.1.1 sous `dockerode`, `glob` 14.0.4 sous `archiver-utils`). Un conteneur par processus de test, une base neuve et migrée par fichier ; le superutilisateur du conteneur reçoit un mot de passe tiré au hasard.
> **Choix à relire** : les migrations sont appliquées par une tâche à part du compose (`migrate`), pas par l'API au démarrage — l'API n'aura ainsi jamais besoin du rôle propriétaire (D.2). L'API se connecte à la base à la première requête, pas au démarrage : une base qui redémarre ne la fait pas tomber, et la sonde `/api/v1/health/ready` dit si elle répond. Un même numéro de téléphone peut exister dans deux élevages : la connexion (E.2) devra dire dans lequel.
> **Vérifié à la main le 2026-11-06, une fois Docker revenu** : l'image de l'API se construit (client et moteurs Prisma téléchargés au build) ; `docker compose up` dans un projet à part applique les trois migrations par la tâche `migrate`, qui s'arrête avec le code 0 ; l'API devient saine ; `/api/v1/health/ready` répond 200 à travers Caddy.
> **Reporté en D.4** : la vérification du fuseau par `TimeZone` du domaine se fait là où un site est écrit pour la première fois ; D.1 garantit seulement que la colonne est obligatoire.

- [x] Les modèles tenant, utilisateur, site, affectation et campagne existent
- [x] Un site porte son fuseau horaire, obligatoire (nom IANA ; sa vérification par `TimeZone` du domaine : D.4)
- [x] Tout modèle porte `tenant_id` ; un test échoue si un nouveau modèle ou une nouvelle table l'oublie, ou n'a pas d'index qui commence par lui
- [x] Les identifiants sont des UUID fournis par l'appelant, sans séquence serveur ni valeur par défaut
- [x] Une ligne ne référence que des lignes de son élevage (campagne, affectation)
- [x] Un site n'a qu'un titulaire, et autant de remplaçants qu'il faut
- [x] La migration initiale s'applique sur une base vide, et se rejoue sans effet
- [x] L'API refuse de démarrer sans `DATABASE_URL` (configuration validée au démarrage, sans jamais répéter un secret) et le compose la lui fournit
- [x] Une sonde de disponibilité publique répond quand la base répond, et 503 sans détail quand elle ne répond pas

### D.2 — Un tenant ne voit jamais un autre tenant · **M** · 🔒 ✅
> Spec : Archi §6 ; `CLAUDE.md` §4 règle 5 · Zone : `apps/api/prisma/migrations/0002_row_level_security/`, `apps/api/src/database/prisma.service.ts`, `apps/api/src/tenants/`, `infra/`
> Dépend de : D.1 · Revue : le tenant est fixé dans la transaction ; le rôle applicatif n'est pas propriétaire des tables.
> Livré le 2026-11-06, aucune dépendance ajoutée. Repris de build-track (migration RLS, `runInTenant`) et adapté : l'API se **connecte** sous le rôle applicatif `yaar_app` au lieu d'y basculer depuis le propriétaire — une requête faite hors de `runInTenant` ne voit donc rien et n'écrit rien. RLS activée et forcée sur chaque table, politique unique `tenant_isolation`, droits accordés table par table (lire et écrire, jamais supprimer ni vider ; `tenants` en lecture seule). `runInTenant(tenantId, travail)` ouvre une transaction, y fixe le tenant (`set_config` local), et un appel imbriqué du même élevage rejoint la transaction ouverte ; d'un autre élevage, il est refusé.
> **Dans le compose** : deux mots de passe. `DB_PASSWORD` pour le propriétaire (tâche `migrate`), `APP_DB_PASSWORD` pour `yaar_app` (l'API), posé une fois par `infra/postgres/init-app-role.sh` à la création du volume. Le mot de passe du propriétaire n'entre jamais dans le conteneur de l'API.
> **Durci en cours de route** : les clés étrangères générées par Prisma propageaient un changement d'identifiant (`ON UPDATE CASCADE`) — un `tenant_id` réécrit par erreur aurait entraîné ses lignes ; toutes refusent maintenant (`Restrict`). Deux migrations lancées en même temps sur un même serveur se gênaient à la création du rôle : corrigé.
> **Passage de `/security-engineer` le 2026-11-06.** Quinze tentatives jouées sur la base avec le rôle de l'application (désactiver les déclencheurs, s'accorder `BYPASSRLS`, changer de rôle, lire les mots de passe, créer une table, lancer un programme, écrire pour un autre élevage…) : toutes refusées, sauf une attendue. **Trois constats corrigés** : (1) la sonde de disponibilité acceptait un rôle non privilégié mais propriétaire d'une table, donc capable de défaire la RLS — elle le refuse maintenant ; (2) la base fait confiance à l'API pour nommer le tenant, donc une injection SQL traverserait la RLS — le lint interdit désormais tout SQL assemblé comme un texte dans l'API ; (3) le PostgreSQL jetable des tests était joignable en superutilisateur avec un mot de passe connu — le conteneur de test reçoit maintenant un mot de passe tiré au hasard. **Restent ouverts** (cahier de recette, R-8 à R-11) : l'appareil n'est pas encore enregistré avec un événement ; la sonde publique interroge la base à chaque appel ; durcissements de production.
> **Vérifié à la main le 2026-11-06 dans de vrais conteneurs** : le script d'initialisation donne son accès à `yaar_app` (ni superutilisateur, ni dispensé de RLS) ; les tables appartiennent au propriétaire `yaar` ; le conteneur de l'API tourne sous l'utilisateur `node`, ne reçoit pas `DB_PASSWORD` et se connecte sous `yaar_app`. Le script a aussi été joué avec un mot de passe piégé, sans effet.

- [x] Sans tenant fixé, aucune ligne n'est visible, dans aucune table, et rien ne s'écrit
- [x] Un utilisateur du tenant A ne lit aucune ligne du tenant B
- [x] Un utilisateur du tenant A ne peut ni écrire ni modifier une ligne du tenant B, ni y faire passer une des siennes
- [x] Deux requêtes concurrentes de tenants différents ne se mélangent pas dans le pool de connexions ; le tenant ne survit pas à la transaction
- [x] Le rôle PostgreSQL de l'application n'est ni superutilisateur, ni dispensé de RLS, ni propriétaire d'une table ; il n'a que les droits accordés table par table
- [x] Toute table a sa RLS activée et forcée, avec une politique : une table ajoutée sans elle fait échouer un test
- [x] Branchée sous un rôle privilégié ou propriétaire, l'API ne se déclare jamais disponible
- [x] Aucun SQL assemblé comme un texte dans l'API (règle de lint, prouvée)

### D.3 — La table du journal n'accepte que des ajouts · **S** · 🔒 ✅
> Spec : `CLAUDE.md` §4 règles 1 et 2 · Zone : `apps/api/prisma/migrations/0003_journal/`, `apps/api/src/journal/`
> Dépend de : D.2 · Revue : le refus vient de la base, pas seulement du code.
> Livré le 2026-11-06, aucune dépendance ajoutée. Table `journal_events` : une ligne par événement tel qu'il a été écrit sur l'appareil — déclaration, contre-déclaration (`corrects`) ou annulation (`retracts`, sans fait). Clé primaire `(tenant_id, id)` : l'identifiant créé sur l'appareil est unique par élevage. Le type est un type énuméré PostgreSQL (les neuf types du domaine), le fait est en JSON sans son type. **Ajout seul, pour tout le monde** : l'application n'a que `SELECT` et `INSERT` ; des déclencheurs refusent `UPDATE`, `DELETE` et `TRUNCATE` au propriétaire de la base lui-même. `received_at` est posée par un déclencheur, quoi qu'envoie le client.
> **Choix à relire** : une contre-déclaration ou une annulation ne peut nommer qu'un événement déjà au journal de son élevage (clé étrangère) — cohérent avec « corriger et annuler se font en ligne », mais l'ingestion (F.1) devra insérer une déclaration avant ce qui la corrige dans un même lot. Une contrainte donne la forme d'une ligne (une annulation n'a ni type ni fait ; tout autre événement a les deux) et interdit à un événement de se nommer lui-même. La date de réception est l'heure de début de la transaction d'insertion. Pas d'index de lecture pour l'instant : il viendra avec le premier lecteur (F.1, F.3).
> **Passage de `/security-engineer` le 2026-11-06** (commun avec D.2) : `INSERT … ON CONFLICT DO UPDATE`, désactivation des déclencheurs, remplacement de leur fonction, `TRUNCATE … CASCADE` depuis une table parente — tous refusés. **Reste ouvert** (R-8) : la table ne garde pas l'appareil d'où vient l'événement ; la colonne s'ajoutera avec les sessions par appareil (E.4) et l'ingestion (F.1), avant toute donnée réelle.

- [x] Un événement s'insère avec son UUID, unique par tenant ; le même UUID sert dans deux élevages sans se gêner
- [x] Une mise à jour d'un événement est refusée par la base, à l'application comme au propriétaire
- [x] Une suppression d'un événement est refusée par la base ; vider la table aussi
- [x] Le même UUID inséré deux fois dans le même tenant ne crée qu'une ligne, et la première reste
- [x] Chaque événement garde, à côté de sa date de saisie venue du client, la date de sa réception posée par la base ; elle ne se modifie pas, et celle qu'enverrait un client est ignorée
- [x] Une contre-déclaration ou une annulation ne nomme qu'un événement du journal de son élevage, jamais elle-même
- [x] Une annulation ne porte aucun fait ; tout autre événement porte son type, pris dans la liste fermée, et son fait

### D.4 — Un élevage s'amorce par un script · **S**
> **En attente de E.1** (2026-11-06) : le premier admin a besoin d'un PIN haché, que E.1 apporte. Le script tournera sous le rôle propriétaire de la base, le seul qui peut créer un élevage (D.2).
> Spec : CdC « Onboarding assisté » (tenants créés manuellement en V1) · Zone : `apps/api/scripts/`
> Dépend de : D.2, E.1 · Revue : rien n'est ouvert au self-signup.

- [ ] Le script crée un tenant, son premier site et son premier admin
- [ ] Le fuseau du site est vérifié par `TimeZone` du domaine avant d'être écrit : un nom inconnu est refusé
- [ ] Relancé avec le même numéro, il refuse au lieu de créer un doublon
- [ ] Aucune route publique ne permet de créer un tenant

## E — Identité et sessions

### E.1 — Le PIN est haché et ses essais sont comptés · **S** · 🔒
> Spec : Archi §6 · Zone : `apps/api/src/auth/`
> Dépend de : B.3 · Revue : argon2id derrière un port ; le PIN ne sort jamais.

- [ ] Un PIN est stocké haché en argon2id, jamais en clair
- [ ] Un PIN correct est reconnu ; un PIN incorrect ne l'est pas
- [ ] Après plusieurs essais ratés, le délai avant un nouvel essai s'allonge
- [ ] Le compteur d'essais se remet à zéro après une connexion réussie

### E.2 — Se connecter avec son numéro et son PIN · **M** · 🔒 · ⚠
> Spec : CdC « Identité » ; Archi §6 · Zone : `apps/api/src/auth/`, `packages/contracts`
> Dépend de : E.1, D.2 · Revue : même réponse pour « numéro inconnu » et « mauvais PIN ».

- [ ] Un numéro et un PIN corrects ouvrent une session liée à l'appareil
- [ ] Un numéro inconnu et un mauvais PIN reçoivent la même réponse, dans le même délai
- [ ] Les essais sont limités par numéro et par appareil
- [ ] Le jeton porte le tenant, le rôle, les sites et la session, et rien d'autre
- [ ] Le PIN n'apparaît dans aucun journal applicatif

### E.3 — Les routes sont fermées par défaut · **M** · 🔒
> Spec : `CLAUDE.md` §4 règle 6 · Zone : `apps/api/src/auth/` (gardes globales)
> Dépend de : E.2 · Revue : l'ouverture d'une route est explicite et testée.
> Déjà en place depuis A.3 : `@Public()` et `ClosedByDefaultGuard`, qui refuse tout ce qui n'est pas ouvert. Cette tranche remplace le refus par la vérification de la session.

- [ ] Une route sans marque explicite exige une session valide
- [ ] Le tenant d'une requête vient du jeton, jamais d'un paramètre ni du corps
- [ ] Une route réservée à l'admin refuse un collaborateur
- [ ] Un collaborateur n'atteint que les ressources de ses sites
- [ ] Un jeton expiré ou falsifié est refusé

### E.4 — Les sessions se révoquent par appareil · **M** · 🔒
> Spec : Archi §6 (téléphone perdu) · Zone : `apps/api/src/auth/sessions/`
> Dépend de : E.3 · Revue : la révocation vaut dès la requête suivante.

- [ ] L'admin voit les appareils connectés de son équipe
- [ ] L'admin révoque la session d'un appareil
- [ ] Une session révoquée est refusée à la requête suivante, synchro comprise
- [ ] Révoquer un appareil ne déconnecte pas les autres appareils du même utilisateur

### E.5 — L'admin crée les comptes de son équipe · **M** · 🔒
> Spec : CdC « Utilisateurs, rôles » · Zone : `apps/api/src/users/`
> Dépend de : E.3 · Revue : un collaborateur n'a jamais de droit admin par défaut.

- [ ] L'admin crée un collaborateur : numéro, PIN, avatar
- [ ] L'admin affecte un collaborateur à un ou plusieurs sites
- [ ] L'admin désigne le titulaire d'un site ; un site n'a qu'un titulaire
- [ ] Deux comptes du même tenant ne partagent pas un numéro
- [ ] Un collaborateur ne peut ni créer un compte ni changer son rôle

### E.6 — Les actions sensibles laissent une trace · **S** · 🔒
> Spec : Archi §6 « Audit » ; `CLAUDE.md` §4 règle 14 · Zone : `apps/api/src/audit/`
> Dépend de : E.4, E.5 · Revue : le journal d'audit ne se modifie pas et ne contient aucun secret.

- [ ] Une connexion, réussie ou ratée, est tracée avec l'appareil
- [ ] La création d'un compte et la révocation d'une session sont tracées avec leur auteur
- [ ] Une entrée d'audit ne se modifie ni ne se supprime
- [ ] Aucune entrée ne contient de PIN ni de jeton

## F — Ingestion et descente

### F.1 — Ingérer un lot d'événements · **M** · 🧪 · ⚠
> Spec : Archi §5 ; `CLAUDE.md` §4 règle 2 · Zone : `apps/api/src/journal/ingest-events.ts` (ports en mémoire)
> Dépend de : C.2, C.3, C.5 · Revue : l'auteur vient de la session ; un doublon n'est pas une erreur.

- [ ] Un événement reçu en JSON est décodé par le domaine en `JournalEvent` : type hors liste, champ manquant ou valeur invalide donnent un motif typé (DTO dans `packages/contracts`)
- [ ] Un événement valide est accepté et rejoint le journal
- [ ] Un événement dont la date de saisie est postérieure à sa réception suit la règle décidée (voir le tableau des décisions)
- [ ] Un événement déjà reçu (même UUID) est ignoré et signalé comme doublon, sans erreur
- [ ] Un lot mêlant acceptés, doublons et refusés renvoie le sort de chaque événement
- [ ] L'auteur, le tenant et l'appareil viennent de la session ; ceux du corps sont ignorés
- [ ] L'appareil est enregistré avec l'événement : la colonne s'ajoute à `journal_events` avec les sessions par appareil (E.4) — elle manque depuis D.3 (réserve R-8)
- [ ] Dans un lot, une déclaration s'insère avant ce qui la corrige ou l'annule : la base refuse de nommer un événement absent (D.3)
- [ ] Les règles de C.2 et de C.3 reçoivent l'auteur sous une seule forme (aujourd'hui `authorRole` pour l'une, `author` — identifiant et rôle — pour l'autre : incohérence à lever ici, où les deux sont appelées ensemble)
- [ ] Un événement refusé par la politique de déclaration donne un motif typé
- [ ] « Rien perdu » est jugé contre le journal du jour (`validateAgainstDay`) : refusé si des morts ont été écrits avant lui
- [ ] Une annulation est jugée par `validateRetraction` contre la déclaration qu'elle nomme ; le serveur lit dans le journal si celle-ci est déjà annulée, pour une annulation comme pour une correction
- [ ] Le serveur pose sa date de réception (`receivedAt`) à l'enregistrement en base et la garde avec l'événement ; une date de réception venue du client est ignorée
- [ ] Une contre-déclaration est jugée par `validateCounterDeclaration` contre la déclaration qu'elle nomme, lue dans le journal ; une origine inconnue donne un motif typé
- [ ] Rejouer un lot entier ne change rien au journal (property-based)

### F.2 — L'API reçoit le journal · **M** · 🔒 · 🧪
> Spec : Archi §4 (`journal`), §5 · Zone : `apps/api/src/journal/` (contrôleur, dépôt Prisma)
> Dépend de : F.1, D.3, E.3 · Revue : tests sur une vraie base ; la taille d'un lot est plafonnée.

- [ ] `POST /api/v1/journal/evenements` accepte un lot et renvoie le sort de chaque événement
- [ ] Le même lot envoyé deux fois ne crée aucune ligne en double
- [ ] Un UUID déjà utilisé par un autre tenant ne révèle rien et n'écrase rien
- [ ] Un champ inconnu dans le corps fait refuser l'événement
- [ ] Un lot au-delà de la taille maximale est refusé

### F.3 — Le gardien reçoit son contexte, sans argent · **M** · 🔒
> Spec : Archi §5 « Descente » ; `CLAUDE.md` §4 règle 4 · Zone : `apps/api/src/journal/caretaker-context/`, `packages/contracts`
> Dépend de : F.2, C.6 · Revue : le type de réponse du gardien est distinct de ceux de l'admin.

- [ ] `GET /api/v1/gardien/contexte` renvoie le site, la campagne en cours, le jour J et les vivants
- [ ] Il renvoie le journal effectif des trois derniers jours, avec l'auteur de chaque ligne
- [ ] Ce journal ne contient aucune perte hors mortalité (manquants, dons) : le gardien ne voit que les morts ; les vivants renvoyés, eux, en tiennent compte
- [ ] Une ligne annulée par l'admin y est donnée comme annulée : le téléphone cesse de la compter et de la rappeler
- [ ] Un collaborateur ne reçoit que le contexte de ses sites
- [ ] Aucun champ de la réponse ne porte de montant, de prix ni de solde (test de garde sur le type)
- [ ] Sans campagne en cours, la réponse le dit explicitement

## G — PWA et outbox hors-ligne

### G.1 — L'application s'installe et démarre sans réseau · **M**
> Spec : Archi §5 « Service worker » · Zone : `apps/web` (manifest, service worker)
> Dépend de : A.3 · Revue : ce qui est précaché, et son poids.

- [ ] L'application s'installe sur l'écran d'accueil avec son icône (192 et 512 px, maskable)
- [ ] Après une première visite, elle démarre sans réseau
- [ ] Les polices sont servies par l'application, jamais par un CDN
- [ ] Le stockage persistant est demandé à l'installation
- [ ] Les routes gardien et admin sont chargées séparément

### G.2 — Se connecter sur le téléphone · **M** · 🎨 · ⚠
> Spec : CdC « Identité » (avatar reconnaissable) · Zone : `apps/web/src/app/core/session/`, écran de connexion
> Dépend de : G.1, E.2 · Revue : utilisable sans lire.

- [ ] L'utilisateur reconnaît son avatar, puis saisit son PIN
- [ ] Un PIN refusé se comprend sans lire (picto, couleur, audio)
- [ ] Une session ouverte survit à la fermeture de l'application
- [ ] Un collaborateur arrive sur le cahier ; un admin arrive sur le bureau

### G.3 — L'outbox garde chaque déclaration · **M** · 🧪
> Spec : Archi §5 « Outbox locale » · Zone : `apps/web/src/app/core/outbox/`
> Dépend de : G.1, C.1 · Revue : rien n'est perdu entre le tap et le stockage.

- [ ] Une déclaration est enregistrée localement avant tout appel réseau
- [ ] Elle survit à la fermeture de l'application et au redémarrage du téléphone
- [ ] Chaque événement de l'outbox a un état : en attente (jamais parti), envoi en doute (tenté, sans réponse), envoyé ou refusé
- [ ] L'UUID est généré sur le téléphone, une seule fois, à la création
- [ ] Si le stockage local échoue, l'utilisateur en est averti et rien n'est marqué « noté »

### G.4 — La synchro envoie sans perdre ni doubler · **M** · 🧪
> Spec : Archi §5 « Synchronisation » · Zone : `apps/web/src/app/core/sync/`
> Dépend de : G.3, F.2 · Revue : la reprise après coupure, cas par cas.

- [ ] Les événements en attente partent à l'ouverture et au retour du réseau
- [ ] Une coupure pendant l'envoi laisse les événements en doute : ils repartent ensuite, à l'identique, et ne se modifient plus sur le téléphone (une modification locale serait ignorée comme doublon)
- [ ] Un événement signalé comme doublon par le serveur passe à « envoyé »
- [ ] Les événements partent dans l'ordre de leur création
- [ ] La pastille de synchro reflète le nombre d'événements en attente

### G.5 — Refus du serveur et session expirée · **M** · 🧪 · ⚠
> Spec : Archi §6 « Mode strict » ; CdC « La confiance est visible » · Zone : `apps/web/src/app/core/sync/`
> Dépend de : G.4, E.4 · Revue : aucun renvoi en boucle, aucune perte silencieuse.

- [ ] Un événement refusé par le serveur n'est pas renvoyé indéfiniment
- [ ] Un refus est signalé au gardien par picto et audio
- [ ] Une session expirée conserve l'outbox ; la synchro reprend après reconnexion
- [ ] Une session révoquée arrête la synchro et le dit à l'utilisateur

---

# LOT 2 — Le cahier du gardien

## H — Design system « cahier »

### H.1 — Les tokens sont la source unique du style · **S**
> Spec : CdC « Design signé » ; `journal-gardien.html` (`:root`) · Zone : `packages/design-system/tokens`
> Dépend de : A.1 · Revue : comparer les valeurs à celles de la maquette.

- [ ] Les couleurs de la maquette existent en tokens, y compris le violet du jour passé et le post-it
- [ ] Andika et Shantell Sans sont auto-hébergées, en woff2 sous-ensemblé, et précachées
- [ ] Ombres dures, rayons irréguliers et lignes de cahier sont des tokens réutilisables
- [ ] Un composant qui écrit une couleur en dur fait échouer le lint

### H.2 — Les pictos sont pré-cuits au build · **M**
> Spec : Archi §4 « Performances » · Zone : `packages/design-system/pictograms`, script de build
> Dépend de : H.1 · Revue : le rendu à côté de la maquette ; aucun filtre à l'exécution.

- [ ] Chaque picto de la maquette gardien existe en SVG au tremblé déjà appliqué
- [ ] Aucun composant n'utilise de filtre SVG à l'exécution
- [ ] Le même picto source donne toujours le même tracé (build reproductible)
- [ ] Chaque picto porte un nom accessible

### H.3 — Boutons, cartes et étiquettes · **M**
> Spec : `journal-gardien.html` (`.geste`, `.sticker`, `.livraison`, `.nudge`) · Zone : `packages/design-system/components`
> Dépend de : H.2 · Revue : cibles tactiles et état d'appui.

- [ ] Le bouton-geste affiche picto, couleur et libellé, et s'enfonce à l'appui
- [ ] La carte scotchée et le post-it reprennent la matière de la maquette
- [ ] Toute cible tactile fait au moins 48 px, crayon et haut-parleur compris
- [ ] Le focus est visible sur chaque composant
- [ ] Les animations se coupent quand le système demande moins de mouvement

### H.4 — Feuille, compteur et pile · **M**
> Spec : `journal-gardien.html` (`.feuille`, `.compteur`, `.pile`) · Zone : `packages/design-system/components`
> Dépend de : H.3 · Revue : on n'anime que `transform` et `opacity`.

- [ ] La feuille monte du bas et se ferme en touchant le voile
- [ ] Le compteur augmente et diminue par gros boutons, sans descendre sous un
- [ ] La pile dessine un objet par unité comptée ; au-delà de douze, elle affiche le reste en « +n »
- [ ] La pile de réception range par paquets de 4, cinq paquets par ligne

### H.5 — Tampon et pastille de synchro · **S**
> Spec : CdC « La confiance est visible » · Zone : `packages/design-system/components`
> Dépend de : H.3 · Revue : la pulsation n'utilise pas `box-shadow`.

- [ ] Le tampon « C'est noté » s'abat puis disparaît
- [ ] La pastille montre le nombre d'envois en attente
- [ ] La pastille passe à « bien envoyé » quand plus rien n'attend
- [ ] L'état de synchro se comprend sans la couleur seule

## I — Audio

### I.1 — Une phrase se compose à partir de clips · **M** · ⚠
> Spec : CdC « Trois canaux redondants », « Points ouverts » (composition des nombres) · Zone : `packages/domain/src/journal/audio/`
> Dépend de : B.2 · Revue : fonction pure ; relire les phrases comme un locuteur les entendrait.

- [ ] Une phrase est une suite ordonnée d'identifiants de clips
- [ ] Un nombre se décompose en clips selon la règle de la langue
- [ ] « Tu as écrit 3 morts » et « 1 mort » s'accordent
- [ ] Une phrase dont un clip n'existe pas dans la langue est signalée, jamais tronquée en silence

### I.2 — Les clips se jouent hors-ligne · **M** · ⚠
> Spec : Archi §5 (précache des clips) ; `CLAUDE.md` §4 règle 11 · Zone : `apps/web/src/app/core/audio/`
> Dépend de : I.1, G.1 · Revue : aucune synthèse vocale dans le bundle de production.

- [ ] Les clips de la langue du site sont précachés
- [ ] Une phrase se joue sans réseau, clips enchaînés sans trou audible
- [ ] Une nouvelle phrase interrompt la précédente
- [ ] La synthèse vocale du navigateur n'est jamais appelée en production

### I.3 — Le script français couvre tout l'écran du gardien · **S**
> Spec : CdC « Points ouverts » (script des phrases) · Zone : `audio/fr/`
> Dépend de : I.1 · Revue : la liste des phrases, à lire à voix haute.

- [ ] Chaque texte de l'écran du gardien a sa phrase dans le script
- [ ] Un test échoue si un écran référence une phrase absente du script
- [ ] Les clips wolof ⏸ attendent l'enregistrement d'un locuteur

## J — L'écran du cahier

### J.1 — Couverture et bandeau du jour · **M**
> Spec : CdC « En-tête et contexte » ; `journal-gardien.html` (`.app-head`, `.strip-jour`) · Zone : `apps/web/src/app/caretaker/`
> Dépend de : H.5, F.3, G.2 · Revue : tout tient sans défiler à 360 px.

- [ ] La couverture montre l'avatar, le nom du gardien et son site
- [ ] Le bandeau montre le jour J, la jauge poussin → poule et les vivants
- [ ] Tant qu'aucun poussin n'est reçu, le bandeau ne montre pas de vivants : ni zéro, ni nombre négatif (QA de C.5 — à confirmer)
- [ ] Le badge du titulaire est visible
- [ ] Sans campagne en cours, l'écran le dit par picto et audio
- [ ] L'écran s'affiche hors-ligne avec le dernier contexte reçu

### J.2 — Trois jours et bannière du jour passé · **M**
> Spec : CdC « Rattrapage » ; `journal-gardien.html` (`.jours`, `.banner-passe`) · Zone : `apps/web/src/app/caretaker/`
> Dépend de : J.1, C.6 · Revue : on ne peut pas écrire pour un jour passé sans le savoir.

- [ ] Aujourd'hui, hier et avant-hier sont visibles, chacun avec son mini-résumé
- [ ] Un jour non déclaré et un jour à zéro déclaré ne se ressemblent pas
- [ ] Choisir un jour passé affiche la bannière et la dit à voix haute
- [ ] Une déclaration faite sous la bannière porte la date métier du jour choisi

### J.3 — Le journal du jour · **M**
> Spec : CdC « Journal du jour » ; `journal-gardien.html` (`.evt`) · Zone : `apps/web/src/app/caretaker/journal/`
> Dépend de : J.2, G.4 · Revue : le journal est visible avant toute saisie.

- [ ] Chaque ligne montre le picto, la quantité et l'auteur
- [ ] Une ligne en attente porte l'horloge ; une ligne envoyée porte le tampon
- [ ] Les déclarations des autres gardiens du site apparaissent
- [ ] Une ligne corrigée montre sa valeur effective
- [ ] Un journal vide le dit sans texte seul

## K — Les gestes de déclaration

### K.1 — Déclarer des morts en trois taps · **M** · 🧪
> Spec : CdC « Gestes du cahier » ; `journal-gardien.html` (compteur, confirmation) · Zone : `apps/web/src/app/caretaker/gestures/death/`
> Dépend de : J.3, H.4, I.2, G.3 · Revue : compter les taps ; le parcours entier marche hors-ligne.

- [ ] Geste → quantité → Oui : trois taps pour déclarer
- [ ] Les poulets couchés s'empilent à chaque unité ajoutée
- [ ] La voix relit la déclaration avant le Oui
- [ ] Si le gardien a déjà écrit des morts ce jour-là, la voix le lui rappelle avant le Oui : « tu as déjà écrit 3 morts aujourd'hui, tes 5 morts, c'est en plus ? » (C.6)
- [ ] Non ferme la feuille sans rien écrire
- [ ] Après le Oui : tampon, ligne dans le journal, vivants diminués, événement dans l'outbox
- [ ] Une quantité supérieure aux vivants est acceptée comme une autre : le gardien n'est pas bloqué, c'est l'admin qui est alerté (C.5)

### K.2 — Déclarer un sac ouvert · **S**
> Spec : CdC « On déclare des changements d'état physiques » · Zone : `apps/web/src/app/caretaker/gestures/bag/`
> Dépend de : K.1 · Revue : réutilise le parcours de K.1, sans le dupliquer.

- [ ] Geste → quantité → Oui déclare des sacs ouverts
- [ ] Les sacs s'empilent à l'écran d'après le picto du vrai sac
- [ ] La déclaration ne change pas les vivants

### K.3 — Un autre a déjà déclaré · **S** · 🧪
> Spec : CdC « Garde-fous anti-doublon » · Zone : `apps/web/src/app/caretaker/gestures/`
> Dépend de : K.1, C.6 · Revue : la question est posée à voix haute, jamais bloquante.

- [ ] Si un autre a déclaré le même type aujourd'hui, la confirmation le nomme et dit sa quantité
- [ ] La voix demande si la nouvelle quantité vient « en plus »
- [ ] Oui ajoute la déclaration ; Non l'abandonne
- [ ] Sans déclaration préalable du même type ce jour-là, ni d'un autre ni de soi, la confirmation reste simple

### K.4 — « Rien perdu hier » · **S** · 🧪
> Spec : CdC « Rappel d'oubli », « Le zéro est une déclaration » · Zone : `apps/web/src/app/caretaker/reminder/`
> Dépend de : K.1, J.2 · Revue : le zéro crée bien un événement.

- [ ] Si hier est non déclaré, le rappel apparaît
- [ ] « Rien perdu hier » crée en un tap un événement daté d'hier
- [ ] « Écrire pour hier » ouvre la saisie sur le jour d'hier
- [ ] Le rappel disparaît dès qu'hier est déclaré

### K.5 — Corriger une déclaration · **M** · 🎨 · 🧪
> Spec : CdC « Corrections » · Zone : `apps/web/src/app/caretaker/journal/correction/`
> Dépend de : J.3, C.4, G.4 · Revue : l'interface n'offre jamais d'effacer, et ne met jamais une correction en file d'attente.
> 🎨 La maquette `journal-gardien.html` donne le crayon sur une ligne « bien envoyé » et remet la correction en attente : à reprendre d'après la décision du 2026-11-06 (correction en ligne), avec l'état « crayon indisponible sans réseau ».

- [ ] Tant que la déclaration n'a jamais quitté le téléphone, le crayon la modifie librement, sans réseau
- [ ] Si un envoi est en doute, la ligne est verrouillée jusqu'à la réponse du serveur
- [ ] Après l'envoi, le crayon crée une contre-déclaration, envoyée tout de suite : elle ne passe pas par l'outbox
- [ ] Sans réseau, le crayon d'une ligne déjà envoyée est indisponible, et il le dit par picto et audio
- [ ] Le crayon n'apparaît que sur les trois jours du cahier ; un refus du serveur (trois jours passés, campagne clôturée) est dit au gardien par picto et audio
- [ ] Seules les valeurs mesurées se corrigent (quantité, poids, papier du livreur), jamais en dessous de 1 ; aucun geste n'annule une déclaration
- [ ] La ligne d'origine reste visible, avec sa correction
- [ ] Les vivants suivent la valeur corrigée
- [ ] Aucun geste ne supprime une ligne du journal

## L — Tâches et météo

### L.1 — Les tâches dues dépendent de l'âge de la bande · **S** · ⚠
> Spec : CdC « Tâches du jour » · Zone : `packages/domain/src/journal/tasks.ts`
> Dépend de : B.4 · Revue : fonction pure du protocole et du jour J.

- [ ] Un vaccin prévu à un âge donné est dû ce jour-là
- [ ] Une tâche faite ne réapparaît pas le même jour
- [ ] Un jour sans tâche prévue n'en invente aucune
- [ ] Une tâche non faite la veille suit la règle décidée (voir le tableau des décisions)

### L.2 — Les pastilles de tâches · **M**
> Spec : CdC « Tâches du jour » ; `journal-gardien.html` (`.tache-chip`) · Zone : `apps/web/src/app/caretaker/tasks/`
> Dépend de : L.1, J.1, G.3 · Revue : un tap, hors-ligne compris.

- [ ] Les tâches du jour s'affichent en pastilles scotchées
- [ ] Un tap marque une tâche faite et crée un événement
- [ ] Le haut-parleur lit la liste des tâches
- [ ] Une tâche cochée par un autre gardien apparaît faite après synchro

### L.3 — Météo et tâche de chaleur · **M** · ⚠
> Spec : CdC « En-tête et contexte » (météo, bicarbonate) · Zone : `apps/api/src/sites/weather/`, `apps/web/src/app/caretaker/weather/`
> Dépend de : L.2 · Revue : la source météo est derrière un port.

- [ ] La météo du jour s'affiche avec un conseil vocal
- [ ] Au-delà d'un seuil de chaleur, la tâche bicarbonate s'ajoute aux tâches du jour
- [ ] Sans réseau, la dernière météo connue s'affiche, datée
- [ ] Une source météo indisponible n'empêche aucune déclaration

## M — Prévenir le chef

### M.1 — Un média se dépose par son empreinte · **M** · 🔒
> Spec : Archi §7 · Zone : `apps/api/src/media/` (port de stockage, volume local)
> Dépend de : F.2 · Revue : type vérifié sur le contenu ; lecture autorisée via l'événement.

- [ ] Un fichier déposé est adressé par son empreinte SHA-256
- [ ] Le même fichier déposé deux fois n'est stocké qu'une fois
- [ ] Un fichier dont le contenu n'est ni une image ni un son attendu est refusé
- [ ] Un fichier trop lourd est refusé
- [ ] Un média ne se lit que par un utilisateur du tenant de l'événement qui le référence
- [ ] Chaque média porte sa classe de rétention (preuve opérationnelle ou pièce justificative)

### M.2 — Les médias attendent le réseau · **M** · 🧪
> Spec : Archi §5 « Médias hors-ligne » · Zone : `apps/web/src/app/core/outbox/media/`
> Dépend de : M.1, G.4 · Revue : l'événement part même si le média échoue.

- [ ] Une photo prise hors-ligne est mise en file avec son événement
- [ ] L'événement part sans attendre le média et le référence par empreinte
- [ ] Un envoi de média échoué est repris
- [ ] Le journal montre qu'un média n'est pas encore parti

### M.3 — Envoyer une photo au chef · **M**
> Spec : CdC « Prévenir le chef » ; `journal-gardien.html` (`.viseur`) · Zone : `apps/web/src/app/caretaker/gestures/photo/`
> Dépend de : M.2, K.1 · Revue : la compression se fait sur le téléphone.

- [ ] Le gardien prend une photo et la confirme par Oui
- [ ] La photo est réduite à environ 800 px avant la mise en file
- [ ] Si l'appareil photo est refusé, l'écran l'explique sans texte seul
- [ ] La photo apparaît dans le journal du jour

### M.4 — Envoyer un message vocal · **M**
> Spec : CdC « Prévenir le chef » ; `journal-gardien.html` (`.btn-micro`) · Zone : `apps/web/src/app/caretaker/gestures/voice/`
> Dépend de : M.2, K.1 · Revue : durée plafonnée ; pulsation en `transform`.

- [ ] Un tap démarre l'enregistrement, un tap l'arrête
- [ ] L'enregistrement s'arrête seul à 90 secondes
- [ ] Le gardien réécoute avant d'envoyer
- [ ] Si le micro est refusé, l'écran l'explique sans texte seul

---

# LOT 3 — Le bureau de l'admin

## N — Référentiels

### N.1 — Le socle de l'éditeur · **M**
> Spec : CdC « Référentiels à deux niveaux » · Zone : `apps/api/src/reference-data/` (données d'amorçage, lecture)
> Dépend de : D.4 · Revue : la liste du socle et ses drapeaux, face au cahier des charges.

- [ ] Les dix catégories du socle existent dès la création du tenant
- [ ] Chaque catégorie porte son drapeau fixe ou variable
- [ ] Aliments, Poussins et Santé sont commandables ; les autres ne le sont pas
- [ ] Une catégorie du socle ne se supprime pas
- [ ] Les types de pertes du socle existent : morts, manquants, dons, vols (le journal n'en porte que deux en dur, `Missing` et `Donation` : voir C.5)

### N.2 — Les types propres à l'élevage · **M**
> Spec : CdC « Référentiels à deux niveaux » · Zone : `apps/api/src/reference-data/`
> Dépend de : N.1 · Revue : on archive, on ne supprime jamais.

- [ ] L'admin ajoute un type rattaché à une catégorie du socle
- [ ] Un type sans catégorie du socle est refusé
- [ ] Renommer un type ne change que son étiquette ; les écritures passées le suivent
- [ ] Un type déjà utilisé s'archive et ne se supprime pas
- [ ] Un type archivé n'est plus proposé à la saisie mais reste lisible dans l'historique

### N.3 — Les tiers · **S**
> Spec : CdC « Qui doit quoi » · Zone : `apps/api/src/counterparties/`
> Dépend de : D.2 · Revue : un tiers est un fournisseur, un client ou un collaborateur.

- [ ] L'admin crée un fournisseur, un client ou un collaborateur comme tiers
- [ ] Un tiers porteur d'écritures s'archive et ne se supprime pas
- [ ] Un tiers n'est visible que dans son tenant

### N.4 — Les souches et la table Cobb 500 · **M**
> Spec : CdC « Référentiels » (souches), « Points ouverts » (table Cobb) · Zone : `apps/api/src/reference-data/strains/`, `packages/domain/src/journal/strain.ts`
> Dépend de : N.1 · Revue : vérifier quelques valeurs de la table contre la source.

- [ ] La souche Cobb 500 porte son poids cible par âge, de J0 à J49
- [ ] Elle porte sa consommation journalière et cumulée par âge
- [ ] Elle porte son protocole sanitaire par défaut
- [ ] L'espèce est un attribut de la souche, pas du journal
- [ ] Un âge hors de la table renvoie une valeur absente, jamais zéro

### N.5 — Le catalogue de prix apprend seul · **S**
> Spec : CdC « Valeurs par défaut » · Zone : `apps/api/src/settings/price-catalog/`
> Dépend de : N.2 · Revue : le catalogue pré-remplit, il n'impose rien.

- [ ] Un catalogue de prix par article est pré-rempli à la création du tenant
- [ ] L'admin modifie un prix du catalogue à tout moment
- [ ] Le dernier prix saisi pour un article devient son prix par défaut
- [ ] Un article sans prix connu propose un champ vide, jamais zéro

### N.6 — L'écran des référentiels · **M** · 🎨
> Spec : CdC « Référentiels » (le gardien ne voit jamais ces écrans) · Zone : `apps/web/src/app/admin/reference-data/`
> Dépend de : N.2, N.3, O.3 · Revue : la maquette d'abord, puis l'écran.

- [ ] L'admin voit ses types par catégorie du socle
- [ ] Il ajoute, renomme et archive un type
- [ ] Un type du socle n'offre pas d'action de suppression
- [ ] Les routes des référentiels sont inaccessibles à un collaborateur

## O — Sites, campagnes et coquille du bureau

### O.1 — Configurer un site · **M**
> Spec : CdC « Onboarding assisté » (configuration du site) · Zone : `apps/api/src/sites/`
> Dépend de : E.5 · Revue : le mode strict est désactivé par défaut ; c'est un choix de l'admin.

- [ ] L'admin crée un site et choisit son modèle de balance
- [ ] Il choisit la langue audio du site
- [ ] Il attache un protocole sanitaire au site
- [ ] Il active ou désactive le mode strict ; par défaut il est désactivé
- [ ] La modification d'une configuration de site est tracée dans l'audit

### O.2 — Ouvrir une campagne · **M** · ⚠
> Spec : CdC « Hiérarchie », « Référentiels » (souche) · Zone : `apps/api/src/campaigns/`, `packages/domain/src/journal/campaign.ts`
> Dépend de : O.1, N.4 · Revue : ce qui rend une campagne « en cours ».

- [ ] L'admin ouvre une campagne sur un site : souche, effectif, date de mise en place
- [ ] Une campagne référence sa souche et en hérite la courbe cible
- [ ] Une campagne sans effectif ou sans date est refusée
- [ ] La campagne ouverte devient le contexte du gardien du site

### O.3 — La coquille du bureau · **M**
> Spec : CdC « Bureau de l'admin » ; `bureau-admin.html` (onglets, sélecteur de site) · Zone : `apps/web/src/app/admin/`
> Dépend de : G.2, H.3 · Revue : les routes admin ne sont pas dans le bundle du gardien.

- [ ] Quatre onglets : Jour, Argent, Commandes, Suivi
- [ ] Le sélecteur de site change le contexte de tous les onglets
- [ ] Hors-ligne, le bureau montre la dernière lecture et sa date
- [ ] Hors-ligne, un coût, un paiement, une vente ou une déclaration partent en file d'attente (P.7) ; toute autre saisie est refusée et l'écran dit pourquoi
- [ ] Un collaborateur ne peut ouvrir aucune route du bureau

### O.4 — L'onglet Jour : où en est la bande · **M** · ⚠
> Spec : CdC « Jour » ; `bureau-admin.html` (Jour) · Zone : `packages/domain/src/journal/mortality-alert.ts`, `apps/web/src/app/admin/day/`
> Dépend de : O.3, O.2, C.5 · Revue : la règle d'alerte est dans le domaine, pas dans l'écran.

- [ ] L'onglet montre le jour J et les vivants du site choisi
- [ ] La mortalité des sept derniers jours se calcule depuis le journal, sur les morts seuls : manquants et dons n'y entrent pas et ne s'affichent pas parmi les morts
- [ ] Au-delà du seuil du tenant, l'alerte s'affiche avec icône, couleur et mot
- [ ] Sous le seuil, aucune alerte
- [ ] Sans campagne en cours, l'onglet le dit et n'affiche aucun chiffre à zéro
- [ ] Une déclaration corrigée montre l'ancienne et la nouvelle valeur, l'auteur de chacune et les deux dates de la correction (saisie et réception)
- [ ] Une déclaration écrite pour un jour passé est marquée comme tardive
- [ ] Des morts déclarés supérieurs aux vivants lèvent une alerte, avec icône, couleur et mot
- [ ] Tant qu'aucun poussin n'est reçu, l'onglet dit que la réception manque au lieu de lever l'alerte de dépassement (QA de C.5 — à confirmer)

## P — Coûts

> **Écritures d'argent (décision du 2026-11-06)** — vaut pour les épopées P, Q, R, S et W : une écriture (coût, paiement, règlement, vente) est ajoutée et jamais modifiée, porte un identifiant créé sur l'appareil, et son enregistrement est idempotent. Une correction est une contre-écriture (P.2). C'est ce qui permet à l'admin de saisir sans réseau (P.7).

### P.1 — Un coût et l'engagé à date · **M** · ⚠ · 🧪
> Spec : CdC « Argent » · Zone : `packages/domain/src/finance/{cost,committed-cost}.ts`
> Dépend de : B.1 · Revue : rien n'est stocké qui se recalcule ; relire la formule du coût par poulet.

- [ ] Un coût porte un identifiant créé sur l'appareil, un type, une date de dépense, un montant, une note et un statut payé ou à payer
- [ ] Le même coût enregistré deux fois (même identifiant) ne compte qu'une fois dans l'engagé (property-based)
- [ ] La date de dépense vaut aujourd'hui par défaut et peut être passée
- [ ] L'engagé d'une campagne est la somme de ses coûts reconnus
- [ ] Un coût « à payer » compte dans l'engagé comme un coût payé
- [ ] Le coût par poulet à date suit la formule décidée, sans flottant

### P.2 — Modifier un coût laisse une trace · **M** · 🧪
> Spec : CdC « Tout coût est modifiable après coup » · Zone : `packages/domain/src/finance/counter-entry.ts`
> Dépend de : P.1 · Revue : l'historique des états est complet.

- [ ] Modifier le montant, la date, la note ou le statut crée une contre-écriture
- [ ] L'écriture d'origine reste lisible dans l'historique
- [ ] L'engagé suit la dernière valeur
- [ ] Le passage de « à payer » à « payé » se fait en une seule opération
- [ ] Chaque contre-écriture porte son auteur et sa date

### P.3 — L'API des coûts · **M** · 🔒
> Spec : Archi §4 (`couts`) · Zone : `apps/api/src/costs/`, `packages/contracts`
> Dépend de : P.2, E.3, N.2 · Revue : un collaborateur n'obtient rien, pas même une liste vide.

- [ ] L'admin enregistre, corrige (contre-écriture) et liste les coûts d'une campagne
- [ ] Un coût déjà reçu (même identifiant) est ignoré et signalé comme doublon, sans erreur
- [ ] Un collaborateur reçoit un refus sur toute route de coûts
- [ ] Un coût d'un type archivé ou non rattaché est refusé
- [ ] Chaque modification d'un coût est tracée dans l'audit
- [ ] Les montants voyagent en entiers, dans la plus petite unité de la devise

### P.4 — Saisir et lire les dépenses · **M**
> Spec : CdC « Argent » ; `bureau-admin.html` (Argent) · Zone : `apps/web/src/app/admin/money/`
> Dépend de : P.3, O.3 · Revue : la note n'est jamais tronquée ; aucun calcul d'argent dans l'écran.

- [ ] L'admin choisit un type par pastille, saisit le montant et valide
- [ ] La date de dépense est modifiable avant validation
- [ ] La note s'écrit sur des lignes de cahier et s'affiche en entier
- [ ] La liste montre les dépenses datées et le total engagé venu de l'API
- [ ] L'engagé et le coût par poulet ont un bouton d'écoute

### P.5 — Reçu en photo et duplication · **S**
> Spec : CdC « Argent » (justificatif, duplication) · Zone : `apps/web/src/app/admin/money/`
> Dépend de : P.4, M.1 · Revue : dupliquer pré-remplit, n'enregistre jamais.

- [ ] L'admin joint la photo d'un reçu à un coût ; la liste affiche « reçu ✓ »
- [ ] Le reçu est rangé comme pièce justificative
- [ ] Dupliquer un coût pré-remplit le formulaire sans rien enregistrer
- [ ] Le coût dupliqué prend la date du jour

### P.6 — ⏸ Champs propres à chaque type de coût · ⚠
> Spec : CdC « Points ouverts » · à spécifier avant découpage.

### P.7 — Les écritures de l'admin attendent le réseau · **M** · 🔒 · 🧪
> Spec : Archi, décisions postérieures « Admin hors-ligne » ; CdC « Architecture des données & hors-ligne » · Zone : `apps/web/src/app/core/outbox/`, `apps/web/src/app/admin/`
> Dépend de : P.4, G.4 · Revue : ce que l'appareil de l'admin garde en clair ; aucune écriture perdue ni doublée.

- [ ] Un coût saisi sans réseau est enregistré sur l'appareil avant tout appel, avec son identifiant
- [ ] Il part au retour du réseau, une seule fois, même si l'envoi est rejoué
- [ ] Une écriture en attente se distingue à l'écran de celles que le serveur a reçues
- [ ] Chaque écran du bureau dit de quand datent ses chiffres
- [ ] Une écriture refusée par le serveur reste visible avec son motif, jamais perdue en silence
- [ ] Les écritures en attente ne sortent jamais vers le cahier d'un gardien qui utiliserait le même appareil

## Q — Commandes et réceptions

### Q.1 — Une commande et son cycle · **M**
> Spec : CdC « Commandes » · Zone : `packages/domain/src/finance/purchase-order.ts`
> Dépend de : B.1, B.2 · Revue : les transitions d'état, une par une.

- [ ] Une commande a un en-tête (fournisseur, date, référence) et au moins une ligne (article, quantité, prix unitaire)
- [ ] Seuls les types commandables entrent dans une commande
- [ ] Le cycle est : brouillon, annoncée, partiellement reçue, reçue, soldée
- [ ] Une transition hors du cycle est refusée
- [ ] L'admin peut clôturer une commande incomplète

### Q.2 — Réceptions partielles et écarts signés · **M** · 🧪
> Spec : CdC « Commandes », « Les écarts sont signés » · Zone : `packages/domain/src/journal/delivery.ts`
> Dépend de : C.1 · Revue : quantités seules, aucun prix — ce code va sur le téléphone du gardien.

- [ ] Plusieurs réceptions se cumulent par ligne
- [ ] Le reste à venir vaut la quantité commandée moins le reçu cumulé, tant qu'il est positif
- [ ] Un reçu inférieur au commandé donne un écart négatif (manque)
- [ ] Un reçu supérieur au commandé donne un écart positif (bonus), jamais ramené à zéro
- [ ] Une ligne est complète quand le reçu atteint la quantité commandée
- [ ] Le reçu cumulé est la somme des réceptions, quel que soit leur ordre (property-based)

### Q.3 — Facturable, paiements et solde · **M** · 🧪
> Spec : Archi §4 (`facturable`, `dette`) ; CdC « Commandes » · Zone : `packages/domain/src/finance/{billable,order-balance}.ts`
> Dépend de : Q.1, Q.2 · Revue : les montants attendus, calculés à la main dans les tests, sur le cas du 12/10.

- [ ] `facturable = min(reçu, quantité) × prix unitaire`, ligne par ligne
- [ ] Un bonus n'augmente pas le facturable ; un manque le diminue
- [ ] Le coût entre dans l'engagé à la réception, ni à la commande ni au paiement
- [ ] Plusieurs paiements (date, montant, moyen) se cumulent, indépendamment des réceptions
- [ ] `dette = payé − facturable` : négatif, tu lui dois ; positif, il te doit
- [ ] Une commande est soldée quand elle est reçue ou clôturée et que le payé égale le facturable
- [ ] Pour toute suite de réceptions et de paiements, le solde ne dépend pas de leur ordre (property-based)

### Q.4 — L'API des commandes · **M** · 🔒
> Spec : Archi §4 (`commandes`) · Zone : `apps/api/src/orders/`, `packages/contracts`
> Dépend de : Q.3, E.3, N.3 · Revue : réservé à l'admin ; les prix ne sortent jamais vers le gardien.

- [ ] L'admin crée et modifie une commande en brouillon
- [ ] Il annonce une commande en brouillon
- [ ] Il clôture une commande incomplète
- [ ] Un collaborateur reçoit un refus sur toute route de commandes
- [ ] Chaque changement d'état est tracé dans l'audit

### Q.5 — L'éditeur de commande · **M**
> Spec : CdC « Commandes » ; `bureau-admin.html` (Commandes, éditeur de facture) · Zone : `apps/web/src/app/admin/orders/`
> Dépend de : Q.4, O.3, N.5 · Revue : le total en cours de saisie utilise `domain/finance` ; le total enregistré vient de l'API.

- [ ] L'admin compose une commande ligne par ligne
- [ ] Le prix unitaire est pré-rempli depuis le catalogue
- [ ] Le total de la saisie en cours s'affiche pendant la frappe
- [ ] La liste montre chaque commande avec son état de réception et de paiement
- [ ] Une commande en brouillon s'annonce d'un geste

### Q.6 — La livraison annoncée arrive chez le gardien · **S** · 🔒
> Spec : CdC « Livraison annoncée » · Zone : `apps/api/src/journal/caretaker-context/`
> Dépend de : Q.4, F.3 · Revue : quantité attendue seulement ; test de garde sur l'absence de prix.

- [ ] Une commande annoncée ajoute une carte livraison au contexte du gardien du site
- [ ] La carte porte l'article et la quantité attendue, jamais le prix
- [ ] Une commande en brouillon n'ajoute aucune carte
- [ ] Une commande complète ou clôturée retire la carte

### Q.7 — Le gardien compte la livraison · **M** · 🧪
> Spec : CdC « Livraison annoncée » ; `journal-gardien.html` (carte livraison, paquets de 4) · Zone : `apps/web/src/app/caretaker/delivery/`
> Dépend de : Q.6, Q.2, K.1 · Revue : le bonus se dit aussi bien que le manque.

- [ ] La carte livraison n'apparaît que si une commande est annoncée
- [ ] Le comptage est pré-rempli avec la quantité attendue
- [ ] Un manque est dit à voix haute (« le chef en attendait 40 »)
- [ ] Un bonus est dit à voix haute (« 50 de plus que la commande »)
- [ ] Après une réception partielle, la carte reste ouverte avec « reste N à venir »
- [ ] La réception part dans l'outbox et fonctionne hors-ligne

### Q.8 — Le papier du livreur · **S**
> Spec : CdC « photo du PV de réception » · Zone : `apps/web/src/app/caretaker/delivery/`
> Dépend de : Q.7, M.3 · Revue : l'absence de papier ne bloque rien.

- [ ] Après le comptage, le gardien photographie le PV
- [ ] « Pas de papier » termine la réception sans blocage
- [ ] Le PV est rangé comme pièce justificative et rattaché à la réception

### Q.9 — Payer une commande · **M**
> Spec : CdC « paiements découplés et multiples » ; `bureau-admin.html` (règlements) · Zone : `apps/api/src/orders/payments/`, `apps/web/src/app/admin/orders/`
> Dépend de : Q.5 · Revue : un paiement ne touche pas l'engagé.

- [ ] L'admin enregistre un paiement : date, montant, moyen (espèces, Wave)
- [ ] Hors-ligne, le paiement part en file d'attente et s'affiche « en attente » (P.7)
- [ ] Plusieurs paiements partiels se cumulent
- [ ] Un paiement avant toute réception est accepté
- [ ] L'engagé ne change pas quand un paiement est enregistré
- [ ] La commande passe à « soldée » quand les conditions de Q.3 sont réunies

## R — Grand livre des tiers

### R.1 — Les soldes se déduisent des écritures · **M** · 🧪
> Spec : CdC « Qui doit quoi » · Zone : `packages/domain/src/finance/ledger.ts`
> Dépend de : Q.3, P.1 · Revue : les deux sens du solde ; aucun solde stocké.

- [ ] Reçu et non payé : tu dois au fournisseur
- [ ] Payé et non reçu : le fournisseur te doit
- [ ] Un coût direct « à payer » crée une dette envers le tiers choisi
- [ ] Le solde d'un tiers est la somme de ses écritures, quel que soit leur ordre (property-based)
- [ ] Les soldes en nature restent distincts des soldes en francs

### R.2 — Régler en une ou plusieurs fois · **S** · ⚠ · 🧪
> Spec : CdC « règlements partiels » · Zone : `packages/domain/src/finance/settlement.ts`
> Dépend de : R.1 · Revue : le cas du règlement supérieur à la dette.

- [ ] Un règlement partiel diminue la dette d'autant
- [ ] Plusieurs règlements soldent la dette exactement
- [ ] Un règlement supérieur à la dette suit la règle décidée
- [ ] Un règlement porte sa date, son montant et son moyen

### R.3 — L'écran « Qui doit quoi » · **M**
> Spec : CdC « Qui doit quoi » ; `bureau-admin.html` (grand livre des tiers) · Zone : `apps/api/src/counterparties/`, `apps/web/src/app/admin/money/counterparties/`
> Dépend de : R.2, P.4 · Revue : les badges disent le sens de la dette en mots.

- [ ] Chaque tiers apparaît avec son solde et son sens : « tu dois » ou « il te doit »
- [ ] L'admin règle une dette depuis la ligne du tiers
- [ ] Un tiers soldé ne porte plus de badge de dette
- [ ] Les soldes viennent de l'API ; l'écran n'additionne rien

### R.4 — L'avance d'un collaborateur · **S**
> Spec : CdC « payé par AS » · Zone : `packages/domain/src/finance/ledger.ts`, écran de saisie d'un coût
> Dépend de : R.1, P.4 · Revue : une dette interne se trace comme les autres.

- [ ] Un coût « payé par » un collaborateur crée une dette envers lui
- [ ] Le coût compte dans l'engagé dès sa saisie
- [ ] Rembourser le collaborateur solde sa dette

## S — Budget et échéances

### S.1 — Le budget est un plan, jamais une dette · **M**
> Spec : CdC « Budget de campagne » · Zone : `packages/domain/src/finance/budget.ts`
> Dépend de : P.1 · Revue : le budget ne touche ni l'engagé ni le grand livre.

- [ ] Un budget prévisionnel se saisit par poste à l'ouverture de la campagne
- [ ] Il est pré-rempli depuis l'historique : coût par poussin des campagnes passées × effectif
- [ ] Sans historique, le pré-remplissage est vide, pas à zéro
- [ ] L'écart budget − engagé se calcule par poste
- [ ] Saisir un budget ne change ni l'engagé ni aucun solde de tiers

### S.2 — Les échéances récurrentes créent leur dette à date · **M** · 🧪
> Spec : CdC « échéances récurrentes » · Zone : `packages/domain/src/finance/recurring-charge.ts`, tâche planifiée de l'API
> Dépend de : R.1 · Revue : relancer la tâche ne crée pas deux dettes.

- [ ] Une échéance (salaire, eau) porte un montant, un tiers et une périodicité
- [ ] À sa date, elle crée un coût « à payer »
- [ ] La tâche planifiée relancée ne crée pas de doublon
- [ ] Une échéance d'une campagne clôturée ne crée plus rien

### S.3 — Budget contre engagé à l'écran · **S**
> Spec : CdC « l'onglet Argent affiche budget vs engagé par poste » · Zone : `apps/web/src/app/admin/money/budget/`
> Dépend de : S.1, P.4 · Revue : un dépassement se lit sans la couleur seule.

- [ ] Chaque poste montre son budget et son engagé
- [ ] Un poste sans budget n'affiche pas zéro
- [ ] Un dépassement porte icône, couleur et mot

## T — Pesées

### T.1 — Une pesée, sa moyenne et sa validation · **M** · 🧪
> Spec : CdC « Demande de pesée », « Suivi » · Zone : `packages/domain/src/journal/weighing.ts`
> Dépend de : C.1, B.2 · Revue : seules les pesées validées alimentent la courbe.

- [ ] Une pesée porte cinq poids
- [ ] Sa moyenne se calcule depuis les poids, elle ne se stocke pas
- [ ] Une pesée de moins de cinq poids est refusée
- [ ] Une pesée déclarée attend la validation de l'admin
- [ ] Un poids corrigé par l'admin laisse le poids d'origine au journal
- [ ] La courbe réelle ne retient que les pesées validées

### T.2 — Demander une pesée · **M**
> Spec : CdC « Demande de pesée » (planifiée par l'admin) · Zone : `apps/api/src/weighings/`, contexte du gardien
> Dépend de : T.1, F.3 · Revue : la carte suit la demande, rien de plus.

- [ ] L'admin planifie une demande de pesée pour un site et une date
- [ ] À cette date, la carte pesée apparaît dans le contexte du gardien
- [ ] Une fois la pesée déclarée, la carte disparaît
- [ ] Sans demande, aucune carte

### T.3 — Le cadran réplique la balance du site · **M** · ⚠
> Spec : CdC « L'interface imite l'objet réel » ; `journal-gardien.html` (`#cadran`) · Zone : `packages/design-system/dial/`
> Dépend de : H.3, B.2 · Revue : la géométrie est une fonction pure, testée sans écran.

- [ ] Un angle de l'aiguille donne un poids, et inversement, selon le modèle de balance
- [ ] L'aiguille s'arrête sur des pas de 50 g
- [ ] L'aiguille ne sort pas de l'échelle du modèle
- [ ] Le cadran se manipule au doigt sans ralentir sur un téléphone d'entrée de gamme

### T.4 — Le gardien pèse cinq poulets · **M** · 🧪
> Spec : CdC « Demande de pesée » ; `journal-gardien.html` (`.slots`) · Zone : `apps/web/src/app/caretaker/weighing/`
> Dépend de : T.3, T.2, K.1 · Revue : la consigne anti-biais est dite.

- [ ] La consigne vocale demande des poulets pris dans des coins différents
- [ ] Chaque poids réglé à l'aiguille remplit une case, et la voix le relit
- [ ] Toucher une case remplie permet de la corriger avant l'envoi
- [ ] L'envoi n'est possible qu'avec cinq poids
- [ ] La pesée part dans l'outbox avec ses cinq poids

### T.5 — L'admin valide une pesée · **M**
> Spec : CdC « inbox du poulailler » (pesées à valider) ; `bureau-admin.html` (inbox) · Zone : `apps/api/src/weighings/`, `apps/web/src/app/admin/day/inbox/`
> Dépend de : T.4, O.4 · Revue : la moyenne affichée pendant la correction vient de `domain/journal`.

- [ ] Une pesée déclarée apparaît dans l'inbox
- [ ] L'admin corrige un poids au clavier ; la moyenne suit en direct
- [ ] Valider retire la pesée de l'inbox et l'ajoute à la courbe
- [ ] La validation est tracée avec son auteur

## U — L'inbox du poulailler

### U.1 — Écouter et classer un vocal · **M**
> Spec : CdC « Médias & confidentialité » (sujet tracé à vie) · Zone : `apps/api/src/media/voice-messages/`, `apps/web/src/app/admin/day/inbox/`
> Dépend de : M.4, O.4 · Revue : le sujet et l'action survivent à l'audio.

- [ ] Un vocal reçu apparaît dans l'inbox de l'admin
- [ ] L'admin l'écoute, puis choisit un sujet : chaleur, mortalité, aliment, eau, livraison, autre
- [ ] Il note l'action prise
- [ ] Le sujet et l'action rejoignent le journal
- [ ] Un vocal traité quitte l'inbox

### U.2 — Photos et synthèse des morts · **S**
> Spec : CdC « inbox du poulailler » · Zone : `apps/web/src/app/admin/day/inbox/`
> Dépend de : M.3, O.4 · Revue : la synthèse vient du journal effectif.

- [ ] Les photos reçues apparaissent dans l'inbox, avec leur auteur
- [ ] La synthèse montre les morts synchronisés par jour
- [ ] Pour une déclaration faite le jour même, elle dit si elle a été écrite le matin, le midi ou le soir, d'après l'heure de saisie dans le fuseau du site — présenté comme l'heure de la déclaration, pas de la mort (bornes des trois périodes à fixer)
- [ ] Un jour à zéro déclaré et un jour non déclaré se distinguent

### U.3 — Les médias s'archivent seuls · **M** · 🔒 · ⚠
> Spec : CdC « Médias & confidentialité » ; Archi §7 · Zone : `apps/api/src/media/retention/`
> Dépend de : U.1, M.1 · Revue : aucune route ni tâche ne supprime une image.

- [ ] Une photo validée passe en archive froide après son délai
- [ ] Une image n'est jamais supprimée
- [ ] Un vocal traité est purgé après son délai ; son sujet et son action restent
- [ ] Une pièce justificative n'est archivée qu'à la clôture de la campagne
- [ ] La tâche relancée ne traite pas deux fois le même média

## V — Suivi

### V.1 — La consommation d'aliment · **M**
> Spec : CdC « Suivi » · Zone : `packages/domain/src/journal/feed-consumption.ts`
> Dépend de : C.5, N.4 · Revue : la formule, avec un effectif qui baisse en cours de bande.

- [ ] La consommation déclarée vaut sacs ouverts × poids du sac ÷ effectif
- [ ] Elle se donne par jour et en cumul
- [ ] Elle se compare à la table de la souche, au même âge
- [ ] L'indice de consommation vaut l'aliment consommé ÷ les kilos produits
- [ ] Sans pesée validée, l'indice est absent, pas zéro

### V.2 — La courbe de poids contre la souche · **M**
> Spec : CdC « Suivi » ; `bureau-admin.html` (graphe poids) · Zone : `apps/web/src/app/admin/tracking/weight-chart/`
> Dépend de : T.5, N.4 · Revue : la géométrie du graphe est une fonction pure.

- [ ] La courbe réelle relie les pesées validées
- [ ] La courbe cible vient de la souche de la campagne
- [ ] Sans pesée validée, seule la courbe cible s'affiche
- [ ] Le graphe se lit à 360 px de large

### V.3 — Les indicateurs du suivi · **M**
> Spec : CdC « Suivi » (KPI) · Zone : `apps/web/src/app/admin/tracking/`
> Dépend de : V.1, P.4 · Revue : un indicateur sans donnée reste vide.

- [ ] L'onglet montre le coût par poulet, la mortalité et les jours écoulés sur les jours prévus
- [ ] La consommation s'affiche en journalier et en cumul, face à la souche
- [ ] Un indicateur sans donnée s'affiche à blanc
- [ ] Marge, prix moyen et restant à vendre n'apparaissent qu'à partir de la première vente

## W — Ventes

### W.1 — Une vente, sa créance et la marge · **M** · ⚠ · 🧪
> Spec : CdC « Ventes », « Analytics » (marge en direct) · Zone : `packages/domain/src/finance/sale.ts`
> Dépend de : R.1, C.5 · Revue : la marge attendue, calculée à la main dans les tests.

- [ ] Une vente porte une date, une quantité, un prix unitaire, un acheteur et un statut payé ou à crédit
- [ ] Une vente à crédit crée une créance sur l'acheteur
- [ ] Un prêt de poulets crée un solde en nature
- [ ] La marge en direct vaut l'encaissé moins l'engagé
- [ ] Le prix de vente moyen et le restant à vendre se recalculent à chaque vente
- [ ] Avant la première vente, marge et prix moyen sont absents

### W.2 — 🎨 Maquetter l'écran des ventes · **S**
> Spec : CdC « Ventes (écran à maquetter sur le même modèle) » · Zone : maquette HTML
> Dépend de : — · Revue : la maquette, à valider avant W.3.

- [ ] La maquette couvre la saisie d'une vente, la liste et le prêt de poulets
- [ ] Elle reprend les composants de l'onglet Argent

### W.3 — Saisir une vente · **M** · 🔒
> Spec : CdC « Ventes » · Zone : `apps/api/src/sales/`, `apps/web/src/app/admin/sales/`
> Dépend de : W.1, W.2, P.4 · Revue : réservé à l'admin ; la créance apparaît dans « Qui doit quoi ».

- [ ] L'admin enregistre une vente payée ou à crédit
- [ ] Hors-ligne, la vente part en file d'attente et s'affiche « en attente » (P.7)
- [ ] Une vente à crédit apparaît chez l'acheteur dans « Qui doit quoi »
- [ ] Le restant à vendre diminue de la quantité vendue
- [ ] Un collaborateur reçoit un refus sur toute route de ventes

## X — Clôture de campagne

### X.1 — Les restes et le bilan · **M** · 🧪
> Spec : CdC « Clôture de campagne » · Zone : `packages/domain/src/finance/closing-report.ts`, `packages/domain/src/journal/leftovers.ts`
> Dépend de : W.1, V.1 · Revue : le bilan d'un jeu d'essai, recalculé à la main.

- [ ] Les restes se saisissent en sacs entiers et en demi-sac entamé
- [ ] Les restes se transfèrent à la campagne suivante du site
- [ ] Le bilan donne : poussins, pertes, coûts, revenus, coût par poulet, bénéfice
- [ ] Le bilan porte un commentaire libre
- [ ] Le bilan se recalcule à l'identique depuis les écritures

### X.2 — Clôturer une campagne · **M**
> Spec : CdC « Clôture de campagne » · Zone : `apps/api/src/campaigns/closing/`, `apps/web/src/app/admin/closing/`
> Dépend de : X.1, O.2 · Revue : la clôture est tracée et ne supprime rien.

- [ ] L'admin clôture une campagne après avoir saisi les restes
- [ ] Une campagne clôturée refuse toute nouvelle déclaration
- [ ] Le bilan n'apparaît qu'à la clôture
- [ ] La clôture est tracée dans l'audit
- [ ] Le gardien du site voit qu'il n'y a plus de campagne en cours

### X.3 — ⏸ L'événement qui arrive après la clôture · **S** · ⚠ · 🧪
> Spec : non précisé — règle à écrire avant de coder.

- [ ] Un événement déclaré avant la clôture mais synchronisé après suit la règle décidée
- [ ] Il n'est jamais perdu en silence

---

# LOT 4 — Push et partage

## Y — Notifications et partage du bilan

### Y.1 — S'abonner aux notifications · **M** · 🔒
> Spec : CdC « Notifications push » ; Archi §7 · Zone : `apps/api/src/notifications/subscriptions/`, `apps/web/src/app/core/push/`
> Dépend de : G.2, E.4 · Revue : la clé privée VAPID ne quitte pas l'environnement du serveur.

- [ ] L'appareil s'abonne après accord de l'utilisateur
- [ ] L'abonnement est lié à l'utilisateur, à l'appareil et au site
- [ ] Révoquer la session d'un appareil supprime son abonnement
- [ ] Si la permission est refusée, l'application fonctionne sans notification

### Y.2 — Envoyer une notification · **M** · 🔒
> Spec : CdC « Notifications push » (cas d'usage) ; Archi §7 · Zone : `apps/api/src/notifications/` (port push, gabarits)
> Dépend de : Y.1, Q.6, T.2, U.1, O.4 · Revue : aucune charge utile ne porte de montant.

- [ ] Une livraison annoncée notifie les gardiens du site
- [ ] Une demande de pesée notifie les gardiens du site
- [ ] Un vocal reçu et un seuil de mortalité franchi notifient l'admin
- [ ] Une correction du cahier notifie l'admin, avec l'ancienne et la nouvelle valeur
- [ ] Des morts déclarés supérieurs aux vivants notifient l'admin
- [ ] Chaque notification a sa carte dans l'application ; la carte existe même si le push échoue
- [ ] Aucune notification ne contient de montant ni de donnée d'un autre site

### Y.3 — Le rappel du soir · **S**
> Spec : CdC « rappel du soir si rien déclaré » · Zone : `apps/api/src/notifications/evening-reminder/`
> Dépend de : Y.2, C.6 · Revue : « rien perdu » compte comme une déclaration.

- [ ] Un site sans déclaration aujourd'hui reçoit un rappel le soir
- [ ] Un site qui a déclaré, zéro compris, n'en reçoit pas
- [ ] Le rappel part une seule fois par soir et par site
- [ ] Un site sans campagne en cours ne reçoit aucun rappel

### Y.4 — Un tap, et l'application lit le message · **S**
> Spec : CdC « un tap ouvre l'app qui lit le message à voix haute » · Zone : service worker, `apps/web/src/app/core/push/`
> Dépend de : Y.2, I.2 · Revue : l'adresse ouverte vient d'une liste fermée.

- [ ] Toucher une notification ouvre l'application sur la carte concernée
- [ ] L'application lit le message à voix haute
- [ ] Cela fonctionne quand l'application était fermée
- [ ] Une notification dont la cible est inconnue ouvre l'écran d'accueil

### Y.5 — Ce que chaque audience voit du bilan · **S** · 🔒
> Spec : CdC « Partage du bilan », « partages sortants sans montants par défaut » · Zone : `packages/domain/src/finance/shared-report.ts`
> Dépend de : X.1 · Revue : la version « groupe » ne contient aucun montant, par construction.

- [ ] La version « groupe » porte des ratios et un verdict, aucun montant
- [ ] La version « investisseurs » porte les chiffres complets
- [ ] L'audience par défaut est « groupe »
- [ ] Le type de la version « groupe » ne peut pas porter de montant (test de garde)

### Y.6 — Partager l'image du bilan · **M** · 🎨
> Spec : CdC « Partage du bilan (WhatsApp) » · Zone : `apps/web/src/app/admin/closing/share/`
> Dépend de : Y.5, X.2 · Revue : la maquette de l'image d'abord ; le tampon de la marque y figure.

- [ ] L'admin génère une image du bilan d'une campagne clôturée
- [ ] Choisir « investisseurs » demande un geste explicite
- [ ] L'image porte le tampon rond de la marque
- [ ] L'image se partage par la feuille de partage du téléphone

---

# LOT 5 — Mise en service des pilotes

## Z — Preuves, exploitation et reprise

### Z.1 — Le budget de performance est tenu par la CI · **S**
> Spec : Archi §4 « Budget perf en CI » · Zone : configuration CI
> Dépend de : K.1 · Revue : les seuils, et ce qui les fait échouer.

- [ ] Le bundle initial de la route gardien pèse moins de 200 Ko gzip
- [ ] Le démarrage prend moins de 2,5 s en 3G bridée
- [ ] Les fichiers chargés par la vue gardien ne contiennent pas le code de `domain/finance`

### Z.2 — Parcours doré : du poulailler au bureau · **M** · 🧪
> Spec : CdC « Cahier du gardien », « Jour » · Zone : tests de bout en bout
> Dépend de : K.5, O.4 · Revue : le scénario se lit comme une journée réelle.

- [ ] Hors-ligne, le gardien déclare des morts, un sac ouvert et corrige une saisie
- [ ] Au retour du réseau, tout arrive une seule fois
- [ ] L'admin voit les vivants et la synthèse des morts à jour
- [ ] Rejouer la synchro ne change aucun chiffre

### Z.3 — Parcours doré : de la commande au solde · **M** · 🧪
> Spec : CdC « Commandes » (cas du 12/10) · Zone : tests de bout en bout
> Dépend de : Q.9, R.3 · Revue : chaque montant attendu est calculé à la main en commentaire.

- [ ] Une commande multi-lignes est reçue en trois livraisons à des dates différentes
- [ ] Un manque et un bonus donnent les écarts et le facturable attendus
- [ ] Deux paiements à d'autres dates donnent le solde attendu
- [ ] L'engagé et « Qui doit quoi » affichent les montants calculés à la main
- [ ] Le gardien n'a reçu aucun montant pendant tout le parcours

### Z.4 — Sauvegarder et restaurer · **M** · 🔒
> Spec : Archi §9 « Sauvegardes » · Zone : `infra/`
> Dépend de : M.1 · Revue : la restauration est réellement jouée, pas seulement la sauvegarde.

- [ ] Une sauvegarde contient la base et le volume des médias
- [ ] Une restauration sur une instance vide redonne les mêmes chiffres et les mêmes médias
- [ ] Les sauvegardes sont chiffrées

### Z.5 — Mettre en production · **M** · 🔒 · ⚠
> Spec : Archi §9 · Zone : `infra/` (compose de production, Caddy)
> Dépend de : Z.4 · Revue : en-têtes de sécurité et secrets.

- [ ] Le compose de production ne diffère du développement que par la configuration
- [ ] Caddy sert l'application en HTTPS avec un certificat persistant
- [ ] Les en-têtes de sécurité sont en place (HSTS, CSP, anti-encadrement)
- [ ] Aucun secret n'est présent dans une image ni dans le dépôt
- [ ] Les images de base sont épinglées par empreinte, et PostgreSQL ne journalise pas les ordres qui portent un mot de passe (réserve R-10)
- [ ] La sonde `/api/v1/health/ready` n'est pas offerte à Internet sans limite de débit (réserve R-9)
- [ ] Le tableau des réserves ouvertes de `docs/cahier-de-recette.md` est vide : chaque réserve est levée, ou acceptée par le fondateur
- [ ] La recette manuelle sur appareil du même cahier a été rejouée en entier

### Z.6 — ⏸ Importer l'historique Excel · ⚠
> Spec : CdC « Points ouverts » (import Excel) · à spécifier avant découpage : correspondance des onglets, agrégats incrustés dans les commentaires, dates en série Excel, quantités négatives de report.

### Z.7 — Le guide d'onboarding assisté · **S**
> Spec : CdC « Onboarding assisté » · Zone : `docs/onboarding.md`
> Dépend de : Y.1, O.1 · Revue : à dérouler une fois sur un vrai téléphone d'entrée de gamme.

- [ ] Le guide couvre l'installation de la PWA et la permission de notification
- [ ] Il couvre l'exclusion de l'optimisation de batterie (Tecno, Infinix, Itel)
- [ ] Il couvre la création des comptes et la configuration du site

---

## Ordre et dépendances

```
LOT 1   A ──┬──→ B ──→ C ──────────────┬──→ F ──┬──→ G.3 → G.4 → G.5
            ├──→ D ──→ E ───────────────┘        │
            └──→ G.1 ──→ G.2 ────────────────────┘

LOT 2   H (dès A.1) ──┐
        I (dès B.2) ──┼──→ J ──→ K ──→ L
        F.3, G ───────┘          └──→ M

LOT 3   N ──→ O ──┬──→ P ──┬──→ R ──→ S
                  │        └──→ W ──→ X
                  ├──→ Q (Q.1–Q.3 dès B) ──→ R
                  └──→ T ──→ U ──→ V

LOT 4   Y.1–Y.4 (après Q.6, T.2, U.1)     Y.5–Y.6 (après X)
LOT 5   Z.1–Z.3 dès que leurs parcours existent ; Z.4 → Z.5 ; Z.7
```

**Ce qui peut avancer en parallèle.** Après `A`, trois pistes ne se touchent pas : le domaine (`B`, `C`), la base et l'identité (`D`, `E`), le design system (`H`). Les tranches de domaine du lot 3 (`P.1`, `P.2`, `Q.1` à `Q.3`, `R.1`, `S.1`, `T.1`, `V.1`, `W.1`, `X.1`) ne dépendent que du domaine : elles peuvent être écrites et relues bien avant leurs écrans.

**Jalons — ce qu'on peut montrer.**

1. **Fin du lot 1** : une déclaration faite hors-ligne sur un téléphone arrive une seule fois en base, sous le bon tenant, même rejouée.
2. **Fin du lot 2** : un gardien tient son cahier pour de vrai — morts, sacs, zéro, corrections, tâches, photo, vocal — sans réseau et sans lire. C'est le moment d'observer un vrai gardien.
3. **Fin de `Q` et `R`** : la commande du 12/10 se rejoue de bout en bout et les soldes tombent juste.
4. **Fin du lot 3** : une campagne se tient de l'ouverture à la clôture ; la double tenue avec Excel peut commencer.
5. **Fins des lots 4 et 5** : notifications, bilan partagé, production, pilotes.

**À chaque tranche terminée** : cocher ses scénarios, marquer son titre ✅, et rayer du tableau des décisions celles qui ont été tranchées, avec la date et la réponse.
