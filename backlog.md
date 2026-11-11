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
| ~~Horloge du téléphone fausse (date de saisie postérieure à la réception) : refuser l'événement, ou l'accepter en le signalant à l'admin ?~~ ✅ tranché le 2026-11-07 : accepter et prévenir l'admin ; la date de saisie est gardée telle qu'écrite, à côté de la date de réception | CdC « Rattrapage » | ~~F.4~~ |
| Horloge en avance, deux détails reportés le 2026-11-07 (« pas urgent ; on suppose que le gardien se connecte tous les jours ») : 1) à quel instant juger l'événement — proposition : à sa date de réception, l'instant le plus tard où il a pu être écrit (sinon un téléphone en avance de cinq jours se verrait refuser une déclaration du jour même) ; la date de saisie reste stockée telle qu'écrite ; 2) à partir de quel écart prévenir l'admin — proposition : au-delà de 5 minutes, dans une constante | CdC « Rattrapage » | Rien tant que le gardien se connecte chaque jour ; à reprendre avant les pilotes |
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
| ~~Longueur du PIN~~ ✅ tranché le 2026-11-06 : 4 chiffres pour un gardien, 6 pour l'admin | CdC « Identité » | ~~E.1~~ |
| ~~Essais de PIN ratés : ralentir ou bloquer ?~~ ✅ tranché le 2026-11-06 : trois essais libres, puis 30 s, 1 min, 5 min, 15 min, 1 h au plus ; jamais de blocage définitif | CdC « Identité » | ~~E.1~~ |
| ~~Faut-il refuser les PIN trop simples (0000, 1234, 111111) à la création d'un compte ?~~ ✅ tranché le 2026-11-06 : oui — un seul chiffre répété, ou des chiffres qui se suivent dans un sens ou dans l'autre | CdC « Identité » | ~~E.1~~ |
| Un admin peut-il bloquer un autre admin du même élevage ? (aujourd'hui non : seuls les collaborateurs se bloquent, E.4) | CdC (non précisé) | E.4 |
| ~~Combien d'admins par élevage, et qui les crée ?~~ ✅ tranché le 2026-11-07 : au moins un, pas forcément un seul ; créés par le seul script de l'éditeur (D.4, E.8) | CdC « Identité » | ~~E.5~~ |
| Écran « Équipe » du bureau (créer un collaborateur, montrer son PIN provisoire, bloquer, PIN oublié) : à maquetter avec `/designer` | CdC (non précisé) | Aucune tranche d'écran ne le porte encore |
| ~~Le premier admin, amorcé par le script (D.4), doit-il changer son PIN à la première connexion ?~~ ✅ tranché le 2026-11-07 : non, la règle ne vaut que pour les comptes non admins | CdC « Identité » | ~~E.5~~ |
| ~~JWT : durée de vie et stratégie de renouvellement~~ ✅ tranché le 2026-11-07 : 7 jours pour un gardien, 24 heures pour l'admin, pas de renouvellement ; en cas de vol, l'admin bloque le compte, ce qui déconnecte tous ses appareils (vérifié à chaque requête, sans table de sessions) | CdC « Identité » | ~~E.2~~ |
| ~~Le vocal au chef : dans l'application ou par WhatsApp ?~~ ✅ tranché le 2026-11-08 : par WhatsApp en V1, au numéro de l'admin ; le vocal dans l'application passe en V2 | CdC « Parler au chef passe par WhatsApp » | M.4, M.5 |
| ~~Une photo comme justificatif des morts ?~~ ✅ tranché le 2026-11-08 : facultative, jamais bloquante, mais toujours répondue (« pas de photo » est une réponse) ; base d'entraînement des futurs modèles | CdC « Photo des morts » | K.6 |
| ~~Comment une nouvelle version arrive-t-elle sur le téléphone ?~~ ✅ tranché le 2026-11-08 : relance silencieuse quand l'application n'est pas utilisée — à l'ouverture, ou au retour au premier plan — jamais en plein geste, pas d'heure fixe ; aucun message au gardien | CdC « Mise à jour de l'application », Archi §5 | Z.5 |
| ~~Stockage du jeton dans la PWA~~ ✅ tranché le 2026-11-07 : gardé par l'application et envoyé dans l'en-tête `Authorization`, pas de cookie ; risque d'un script injecté accepté, borné par les durées et par une politique de contenu stricte (Z.5). Le sort d'une outbox non synchronisée à la fin d'une session est tranché le 2026-11-07 : elle reste sur le téléphone, et repart quand le même compte se reconnecte ; un autre compte connecté sur ce téléphone ne l'envoie jamais sous son nom | Archi §6 | G.2, G.5 |
| Règle de composition des nombres en clips ; format et poids des clips | CdC « Points ouverts », Archi §12 | I.1, I.2 |
| Une tâche sanitaire non faite est-elle reportée au lendemain ? | CdC (non précisé) | L.1 |
| Source de la météo, et seuil de chaleur qui déclenche la tâche de chaleur | CdC « Points ouverts » (Tâches par élevage). **Tranché le 2026-11-08** : la tâche de chaleur est **la glace dans l'eau**, au-delà de **32 °C**, jugée sur la **prévision du jour J** et sur le **ressenti** si la source le donne ; le **bicarbonate n'est pas lié à la chaleur**, c'est une tâche optionnelle de l'élevage. Elle vaut pour **tous les animaux, à tout âge**. Le bicarbonate tombe **certains jours de la bande, définis dans le référentiel des tâches de l'élevage** (2026-11-08). Reste : la source météo | L.1, L.3 |
| ~~Une seule campagne en cours par site ?~~ ✅ tranché le 2026-11-07 : non — un site peut avoir plusieurs campagnes en cours à la fois, et le gardien déclare sur chacune | CdC « Hiérarchie » | ~~O.2~~ |
| Seuil par défaut de l'alerte de mortalité sur 7 jours | CdC « Points ouverts » | O.4 |
| ~~Coût par poulet à date : engagé ÷ vivants ou ÷ effectif mis en place ? Et quel arrondi ?~~ ✅ tranché le 2026-11-12 : engagé ÷ `min(vivants, reçus × 93 %)` — 7 % de pertes prévues par défaut, le réel dès qu'il les dépasse —, arrondi au franc le plus proche ; absent tant que les vivants sont inconnus | CdC « Les dépenses » | ~~P.1~~ |
| Champs de saisie propres à chaque type de coût | CdC « Points ouverts » | P.6 |
| ~~Un règlement supérieur à la dette : refusé, ou il crée une créance ?~~ ✅ tranché le 2026-11-12 : accepté, il crée une créance (le tiers doit la différence) | CdC « Commandes » | ~~R.2~~ |
| Une vente diminue-t-elle le compteur de vivants vu par le gardien ? | CdC (non précisé) | W.1 |
| ~~Modèles de balance à répliquer (0–5 kg, 0–10 kg, digitale)~~ ✅ tranché le 2026-11-07 : la balance n'est pas modélisée — un poids est un entier de grammes positif, saisi tel que lu (le gardien peut le taper), sans capacité ; la forme de la saisie se décide avec `/designer` | CdC « Demande de pesée » | ~~T.3~~ |
| Délais de rétention des médias, durée légale des pièces justificatives | CdC « Points ouverts » | U.3 |
| Que devient un événement synchronisé après la clôture de la campagne ? Et l'admin peut-il encore corriger le cahier après la clôture (aujourd'hui refusé, C.4) ? | CdC (non précisé) | X.3 |
| Hébergeur et région | Archi §12 | Z.5 |
| Correspondance des onglets Excel vers les événements | CdC « Points ouverts » | Z.6 |

## Réserves du QA à lever avant la fin de la V1

Ce que `/qa` valide « avec réserves » est tenu dans `docs/cahier-de-recette.md` (verdicts, réserves numérotées, ce qui n'a pas pu être vérifié, recette manuelle sur appareil). Aucune réserve ne bloque la tranche où elle a été trouvée, mais chacune doit être levée, ou acceptée par le fondateur, avant la mise en production (Z.5). Seize réserves sont ouvertes au 2026-11-07 : R-1 à R-7 (QA, de C.4 à C.7) et R-8 à R-17 (sécurité, de D.2 à E.2 ; R-12 et R-13 levées par E.2).

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
> Livré le 2026-11-06, aucune dépendance ajoutée. `Quantity` et `Weight` sont des types marqués : un nombre non vérifié ne passe pas pour eux, et l'un ne passe pas pour l'autre. Trois motifs rejoignent la liste fermée (`InvalidQuantity`, `InvalidWeight`, `WeightOutOfScale`). La balance (`Scale`) ne porte ici que sa capacité en grammes, fournie par l'appelant : les modèles de balance restent la décision ouverte de T.3. **Révisé le 2026-11-07** : la balance n'est pas modélisée — `Scale` et `WeightOutOfScale` sont retirés, un poids n'est plus borné par aucune capacité. **Un poids s'enregistre au gramme près** (décision du 2026-11-06) : le pas de 50 g n'est qu'une aide à la saisie sur le cadran (T.3), le domaine et le serveur ne le vérifient pas — une lecture depuis une photo ou une balance digitale tombe entre deux graduations.

- [x] Une quantité déclarée est un entier strictement positif
- [x] Zéro n'est pas une quantité : il se déclare par un événement dédié
- [x] Un poids s'exprime en grammes entiers, au gramme près ; le pas de 50 g du cadran n'est pas une règle du domaine
- [x] Un poids nul ou négatif est refusé
- [x] ~~Un poids hors de l'échelle de la balance du site est refusé ; sans capacité connue, aucun poids n'est accepté~~ — retiré le 2026-11-07 : la balance n'est pas modélisée (`Scale` et `WeightOutOfScale` supprimés)

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
> Livré le 2026-11-06. **Dépendances ajoutées** : `prisma` et `@prisma/client` 6.19.3 (Apache-2.0, la version de build-track). L'audit a trouvé une vulnérabilité haute dans une sous-dépendance de la ligne de commande (`deepmerge-ts` < 8, via `@prisma/config`), corrigée seulement en Prisma 7.10.1 : elle est levée par un `overrides` vers `deepmerge-ts` 8.0.2, et l'audit est de nouveau à zéro. Prisma 7 a été écarté pour l'instant : sa ligne de commande embarque `mysql2`, un studio et un serveur de développement dont on n'a pas besoin. La branche 6 ne recevant visiblement plus ce correctif, le passage à Prisma 7 a été fait le jour même (D.5).
> **Schéma** (fusionné avec D.2, D.3 et D.4 dans la migration unique `0001_init` le 2026-11-07) : `tenants`, `users`, `sites`, `site_assignments`, `campaigns`. UUID fournis par l'appelant, aucun défaut en base. `tenant_id` obligatoire et indexé partout ; une clé étrangère passe par `(tenant_id, id)`, donc la base refuse elle-même une campagne attachée au site d'un autre élevage. Un seul titulaire par site (index partiel écrit à la main). Le rôle est un type énuméré PostgreSQL (`admin`, `collaborator`). Rien de plus que ce que les tranches livrées demandent : ni PIN (E.1), ni avatar (E.5), ni langue du site (I).
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

### D.4 — Un élevage s'amorce par un script · **S** ✅
> Spec : CdC « Onboarding assisté » (tenants créés manuellement en V1) · Zone : `apps/api/src/bootstrap-tenant.ts` (entrée du script), `apps/api/src/tenants/{bootstrap-tenant,read-secret-line}.ts`, migration `0001_init`
> Dépend de : D.2, E.1 · Revue : rien n'est ouvert au self-signup.
> Livré le 2026-11-07, aucune dépendance ajoutée. `bootstrapTenant(entrée, { prisma, hasher, ids })` crée l'élevage, son premier site et son premier admin dans une seule transaction, sous le rôle propriétaire de la base ; le script `dist/bootstrap-tenant.js` (second point d'entrée du bundle, dans le dossier `src` à cause de la frontière de lint sur les imports relatifs) lit ses arguments, et **le PIN au clavier sans l'afficher, ou sur l'entrée standard — jamais en argument**, où tout processus de la machine le lirait. Il tourne dans l'image de la tâche `migrate` : `docker compose run --rm -it migrate node dist/bootstrap-tenant.js …`.
> **Schéma** : `users.pin_hash` obligatoire (un compte sans PIN ne servirait à personne), et **un numéro de téléphone n'a qu'un compte sur tout le service** (index unique, choix à relire : il remplace l'unicité par élevage de D.1, et répond à la question laissée à E.2 — la connexion trouve son utilisateur sans connaître l'élevage ; en échange, une création de compte révèle qu'un numéro a déjà un compte ailleurs, réserve R-11 élargie). Le fuseau du site est vérifié par `TimeZone` du domaine ; le numéro en forme internationale, la devise en code ISO à trois lettres, un nom vide refusé.
> **Migrations fusionnées en une seule** (`0001_init`) sur décision du 2026-11-07 : rien n'est déployé. Les mêmes tests et les mêmes sabotages passent sur la migration unique.
> **Vérifié** : 7 tests du cas d'usage sur PostgreSQL réel, 3 de la lecture du PIN, un test qui parcourt toutes les routes du serveur sans session (seules les deux sondes répondent, aucune ne parle d'élevage ni de compte) ; 11 sabotages détectés sur 11, sur une copie ; le script joué dans la pile Docker : élevage créé avec son admin et son empreinte, PIN trop simple et fuseau inconnu refusés, le PIN absent de toute sortie et de la base. Le refus du même numéro a aussi été rejoué dans Docker : second amorçage refusé avec le code 1, un seul élevage et un seul compte en base.

- [x] Le script crée un tenant, son premier site et son premier admin, dans une seule transaction
- [x] Le fuseau du site est vérifié par `TimeZone` du domaine avant d'être écrit : un nom inconnu est refusé
- [x] Relancé avec le même numéro, il refuse au lieu de créer un doublon
- [x] Le PIN de l'admin a six chiffres, n'est pas trop simple, et ne passe jamais par la ligne de commande
- [x] Aucune route publique ne permet de créer un tenant : toutes les routes du serveur sont fermées sans session, sauf les deux sondes

### D.5 — Passer à Prisma 7 · **S** ✅
> Spec : `CLAUDE.md` §8 (versions : la stable maintenue) · Zone : `package.json`, `apps/api/prisma.config.ts`, `apps/api/src/{database,testing}/`, `infra/docker/api.Dockerfile`
> Dépend de : D.1 à D.3 · Revue : aucune règle ne change, seulement l'outil ; les mêmes tests et les mêmes sabotages doivent tenir.
> Livré le 2026-11-06, sur décision du fondateur : la vulnérabilité haute de Prisma 6 (`deepmerge-ts`) n'était levée que par un `overrides`, et la branche 6 ne reçoit plus ce correctif. **Dépendances** : `prisma` et `@prisma/client` 7.10.1, plus `@prisma/adapter-pg` 7.10.1 (qui apporte le pilote `pg`) ; l'`overrides` de `deepmerge-ts` est retiré. Audit à zéro, licences conformes.
> **Ce qui change** : l'adresse de la base quitte le schéma pour `apps/api/prisma.config.ts` ; le client se connecte par un adaptateur ; il n'y a plus de moteur natif à télécharger pour l'API. La ligne de commande devient une dépendance de développement : elle embarque un pilote MySQL, un studio et un serveur de développement dont on ne veut pas en production. **L'image de l'API ne la contient donc pas** (`npm ci --omit=dev --omit=optional` : 152 paquets, 536 Mo) ; la tâche `migrate` a sa propre étape du Dockerfile (925 Mo).
> **Tests adaptés, sans changer de règle** : Prisma 7 n'expose plus dans ses métadonnées le caractère obligatoire, le type natif ni la valeur par défaut d'un champ. Ces vérifications (identifiants UUID sans défaut, aucune séquence, liste fermée des valeurs par défaut) se lisent maintenant dans le catalogue de PostgreSQL — ce qui couvre aussi les tables écrites à la main.
> **Vérifié** : 62 tests de l'API sur Testcontainers ; les 45 sabotages de D.1 à D.3 rejoués ; image construite et pile complète démarrée à la main (trois migrations appliquées, API saine sous `yaar_app`).
> **Sécurité** : les tests d'isolation qui dépendent du client (tenant fixé dans la transaction, requêtes concurrentes, connexion rendue au pool) passent avec l'adaptateur. Les quinze tentatives d'attaque du passage de D.2 portaient sur les droits PostgreSQL, que ce changement ne touche pas : elles n'ont pas été rejouées.
> **Écart assumé avec build-track**, qui reste en Prisma 6 : ses briques se reprennent encore, à l'adaptateur près.

- [x] Les 62 tests d'infrastructure passent sans qu'aucune règle n'ait changé
- [x] Les sabotages de D.1, D.2 et D.3 sont toujours détectés
- [x] L'audit est à zéro sans correctif forcé pour Prisma
- [x] L'image de l'API n'embarque pas la ligne de commande Prisma ; la tâche de migration a son étape
- [x] La pile complète démarre : migrations appliquées, API saine

### D.6 — Le propriétaire de la base n'est pas superutilisateur · **S** · 🔒 ✅
> Spec : Archi §6 ; `CLAUDE.md` §4 règle 5 · Zone : `infra/docker-compose.yml`, `infra/postgres/init-roles.sh`, `infra/.env.example`, `apps/api/prisma/migrations/0001_init`, `apps/api/src/tenants/{bootstrap-tenant,add-admin}.ts`, `apps/api/src/testing/test-database.ts`
> Dépend de : D.2, D.4 · Revue : aucune tâche courante ne tourne en superutilisateur. Ajoutée le 2026-11-07 (réserve R-18, recommandation sécurité).
> Livrée le 2026-11-07, aucune dépendance ajoutée. Trois rôles, **deux mots de passe comme avant** : `postgres` (superutilisateur de l'image) n'initialise que le serveur, avec `DB_PASSWORD`, puis perd son mot de passe — il ne se joint plus que de l'intérieur du conteneur (`docker compose exec db psql -U postgres`) ; `yaar` possède la base et les tables (`NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB NOREPLICATION`) ; `yaar_app` sert l'API, mêmes restrictions. `infra/postgres/init-roles.sh` (ex-`init-app-role.sh`), lancé par l'image PostgreSQL elle-même au premier démarrage sur un volume vide, crée les deux rôles et la base `yaar` au nom du propriétaire. La migration ne crée plus `yaar_app` — le propriétaire n'en a pas le droit — et s'arrête s'il manque. Les scripts de l'éditeur fixent l'élevage qu'ils écrivent et le numéro qu'ils vérifient (`scopeToFarm`) ; l'ajout d'un admin vérifie l'élevage dans cette transaction. Le banc de test crée les rôles comme la pile et migre sous le propriétaire : `db.owner` est ce propriétaire sans privilège, `db.superuser` sème et relit les données des tests ; la sonde de disponibilité est vérifiée sous l'un comme sous l'autre.
> **Changé en route** : une première version ajoutait un troisième secret (`DB_SUPERUSER_PASSWORD`) ; jugé excessif par le fondateur (« rester pragmatique »), il est remplacé par le retrait du mot de passe du superutilisateur à l'initialisation. Vérifié dans Docker : depuis le réseau de la pile, `DB_PASSWORD` ouvre `yaar` et plus `postgres`.
> **Choix à relire** : le script d'initialisation ne tourne que sur un volume vide — un volume créé avant D.6 garde ses anciens rôles et se recrée (`docker compose … down -v`), ce qui ne coûte rien tant que rien n'est déployé ; la vérification dans Docker est tombée une fois sur ce piège. Les tests qui prouvent qu'une ligne du journal ou de la trace ne se modifie pas tournent sous le superutilisateur : un refus qui tient pour lui tient pour le propriétaire, qui a moins de droits (titres corrigés en ce sens).

- [x] Les tables appartiennent à un rôle propriétaire qui n'est ni superutilisateur ni dispensé de RLS ; migrations et scripts de l'éditeur tournent sous lui
- [x] Le superutilisateur de PostgreSQL ne sert qu'à l'initialisation du serveur ; son mot de passe ne va à aucun conteneur applicatif
- [x] Sous le propriétaire, sans élevage fixé, aucune ligne du journal n'est lisible (la RLS forcée s'applique à lui) ; les scripts de l'éditeur fixent l'élevage qu'ils touchent
- [x] La pile complète démarre, l'amorçage et l'ajout d'un admin marchent, joués dans Docker

## E — Identité et sessions

### E.1 — Le PIN est haché et ses essais sont comptés · **S** · 🔒 ✅
> Spec : Archi §6 ; CdC « Identité » · Zone : `apps/api/src/auth/{pin,pin-attempts,pin-hasher,argon2-pin-hasher}.ts`
> Dépend de : B.3 · Revue : argon2id derrière un port ; le PIN ne sort jamais.
> Livré le 2026-11-06. **Dépendance ajoutée** : `argon2` 0.45.2 (MIT), la bibliothèque de build-track. Elle déclare un script d'installation, mais ses binaires sont livrés dans le paquet : elle se charge sans que ce script tourne, sur le poste comme dans l'image de l'API (vérifié dans un conteneur). Audit à zéro.
> **Décisions du 2026-11-06, ajoutées au CdC** : le PIN a **4 chiffres pour un gardien, 6 pour l'admin** ; un PIN trop simple est refusé (un seul chiffre répété, ou des chiffres qui se suivent dans un sens ou dans l'autre) ; après **trois essais libres**, l'attente s'allonge — 30 s, 1 min, 5 min, 15 min, puis 1 h au plus — sans jamais de blocage définitif ; une connexion réussie remet le compteur à zéro.
> **Ce qui est livré** : `Pin(texte, rôle)` vérifie la longueur selon le rôle et rend une valeur qui ne s'écrit jamais — imprimée, sérialisée ou glissée dans un message d'erreur, elle montre `[PIN]` ; seul `reveal()` rend les chiffres, et seul le hacheur l'appelle. Le port `PinHasher` et son adaptateur `Argon2PinHasher` (argon2id, 19 Mio, deux passes : le minimum recommandé par l'OWASP) ; une empreinte illisible ou d'un autre algorithme ne reconnaît aucun PIN, sans lever d'erreur. La règle pure `retryAt(essais, maintenant)` dit quand le prochain essai est permis ; `afterFailure` et `afterSuccess` tiennent le compteur.
> **Hors de cette tranche** : rien n'est encore stocké ni branché. La colonne de l'empreinte arrive avec D.4 (le premier admin), le compteur d'essais et son stockage avec E.2 (la connexion).
> **Passage de `/security-engineer` le 2026-11-06.** Deux durcissements faits : c'est la règle, et non l'appelant, qui dit si l'attente est écoulée ; et dans le doute elle fait attendre — des essais ratés sans date attendent à partir de maintenant, un compteur illisible attend une heure. **Restent ouverts, pour E.2** (cahier de recette, R-12 à R-14) : un essai refusé pendant l'attente ne doit ni vérifier le PIN ni compter ; un numéro inconnu doit coûter le même temps qu'un mauvais PIN ; le compteur par compte laisse n'importe qui imposer jusqu'à une heure d'attente à un gardien qui se connecte sur un nouvel appareil ; un PIN à 4 chiffres ne résiste que par le comptage des essais (au plus 24 essais par jour une fois l'attente à une heure).

- [x] Un PIN est stocké haché en argon2id, jamais en clair ; deux comptes au même PIN n'ont pas la même empreinte
- [x] Un PIN correct est reconnu ; un PIN incorrect ne l'est pas ; une empreinte illisible ne reconnaît rien
- [x] Le PIN a 4 chiffres pour un gardien, 6 pour l'admin ; rien d'autre que des chiffres
- [x] Un PIN trop simple est refusé : un seul chiffre répété, ou des chiffres qui se suivent dans un sens ou dans l'autre
- [x] Un PIN ne s'écrit ni dans un texte, ni dans un JSON, ni dans un message d'erreur ; un refus ne répète pas ce qui a été tapé
- [x] Après trois essais ratés, le délai avant un nouvel essai s'allonge : 30 s, 1 min, 5 min, 15 min, puis 1 h au plus
- [x] Le compteur d'essais se remet à zéro après une connexion réussie
- [x] Dans le doute (état incohérent, compteur illisible), la règle fait attendre

### E.2 — Se connecter avec son numéro et son PIN · **M** · 🔒 ✅
> Spec : CdC « Identité » ; Archi §6, §12 · Zone : `apps/api/src/auth/{sign-in,sign-in.controller,access-token,session-policy,auth.module}.ts`, `packages/contracts/src/auth.ts`
> Dépend de : E.1, D.2 · Revue : même réponse pour « numéro inconnu » et « mauvais PIN ».
> Livré le 2026-11-07, **aucune dépendance ajoutée** : le jeton est un JWT HS256 signé et vérifié avec `node:crypto` (une soixantaine de lignes, en-tête constant — ni « none » ni autre algorithme possible). **Décisions du 2026-11-07, ajoutées au CdC et à l'architecture** : session de **7 jours pour un gardien, 24 heures pour l'admin**, sans renouvellement, durées dans `SESSION_LIFETIME_SECONDS` ; jeton dans l'en-tête `Authorization`, pas de cookie ; en cas de vol, l'admin bloque le compte (E.4) — pas de table de sessions, deux colonnes sur `users` (`blocked_at`, `sessions_valid_from`).
> **Ce qui est livré** : `POST /api/v1/auth/sign-in` (publique, seule route ouverte avec les sondes) reçoit exactement `{ phone, pin, deviceId }` et rend `{ token, expiresAt, role }`. 400 pour une requête mal formée, 401 pour un numéro inconnu comme pour un mauvais PIN (même corps, même travail : un numéro inconnu est vérifié contre une empreinte factice), 403 pour un compte bloqué — dit seulement à qui a tapé son PIN —, 429 avec `Retry-After` pendant l'attente, sans vérifier le PIN ni compter l'essai. Le compte se trouve par son numéro avant de connaître l'élevage grâce à une politique RLS dédiée (`sign_in_lookup`), en lecture seule : ni rôle privilégié, ni fonction à droits définis. Le jeton porte l'utilisateur, l'élevage, le rôle, l'appareil et ses dates. Nouvel alias `@contracts` pour les types de la route.
> **Choix à relire** : à la connexion, le PIN tapé n'a que 4 ou 6 chiffres à respecter (`typedPin`) ; la règle du rôle et l'interdiction des PIN trop simples valent à la création. Un PIN de la mauvaise longueur pour le rôle est un mauvais PIN comme un autre. `sessions_valid_from` est posée mais pas encore vérifiée : c'est E.3.
> **Passage de `/security-engineer` le 2026-11-07** — cahier de recette, R-14 à R-17 : pas de comptage par appareil ; des essais simultanés passent la fenêtre libre avant que le compteur ne bouge ; un numéro qui a un compte se reconnaît à ce qu'il finit par répondre 429, un numéro inconnu jamais ; le jeton gardé par l'application est lisible par un script injecté (accepté, borné par les durées).

- [x] Un numéro et un PIN corrects ouvrent une session liée à l'appareil : 7 jours pour un gardien, 24 heures pour l'admin
- [x] Un numéro inconnu et un mauvais PIN reçoivent la même réponse, après le même travail (une vérification d'empreinte chacun)
- [x] Les essais sont limités par numéro (par appareil : réserve R-14, reportée)
- [x] Le jeton porte l'utilisateur, le tenant, le rôle, l'appareil et ses dates, et rien d'autre : ni numéro, ni nom, ni site (les sites se lisent en base, ils changent)
- [x] Le PIN n'apparaît dans aucun journal applicatif, ni dans une réponse
- [x] Un essai fait pendant l'attente est refusé sans que le PIN soit vérifié, et ne compte pas comme un essai raté (réserve R-12, levée)
- [x] Un compte bloqué ne se connecte pas
- [x] Un jeton expiré, falsifié, d'un autre algorithme ou au contenu inattendu est refusé à la vérification

### E.3 — Les routes sont fermées par défaut · **M** · 🔒 ✅
> Spec : `CLAUDE.md` §4 règles 5 et 6 ; CdC « Identité » · Zone : `apps/api/src/auth/{session,session.guard,tenant-transaction.interceptor,site-access}.ts`
> Dépend de : E.2 · Revue : l'ouverture d'une route est explicite et testée.
> Livré le 2026-11-07, aucune dépendance ajoutée. `SessionGuard` (global) remplace `ClosedByDefaultGuard` : hors `@Public()`, une requête doit porter `Authorization: Bearer <jeton>` ; un jeton absent, mal formé, falsifié ou expiré donne un 401 nu, et le rôle exigé par `@Roles(…)` un 403. La session (utilisateur, élevage, rôle, appareil) vient du jeton seul ; `@CurrentSession()` la donne à la route. `TenantTransactionInterceptor` (global) ouvre pour chaque requête une transaction de son élevage et y relit le compte : bloqué, jeton émis avant `sessions_valid_from` (arrondie à la seconde supérieure : un jeton émis dans la même seconde est refusé), rôle changé ou compte absent de cet élevage → 401, la route ne tourne pas. Une route qui appelle `runInTenant(session.tenantId, …)` rejoint cette transaction : ce qu'elle écrit avant d'échouer est annulé. `canReachSite` : l'admin atteint tous les sites de son élevage, un collaborateur ceux où il est affecté.
> **Changé en route** : `sessions_valid_from` est vide par défaut (aucune invalidation) au lieu de valoir la date de création — sinon un compte créé et connecté dans la même seconde aurait vu son premier jeton refusé.
> **Choix à relire** : une route qui interroge la base sans `runInTenant` ne voit rien (fail-closed) — elle ne rejoint pas d'elle-même la transaction de la requête. Chaque requête authentifiée garde une connexion du pool et une transaction ouverte pendant toute sa durée, avec la limite de Prisma (5 secondes par défaut) : l'ingestion d'un gros lot (F.1) devra la relever ou découper. Strict mode : règle de déclaration (C.3), pas d'accès.

- [x] Une route sans marque explicite exige une session valide ; une route `@Public()` reste ouverte, même avec un jeton invalide
- [x] Le tenant d'une requête vient du jeton, jamais d'un paramètre ni du corps
- [x] Une route réservée à l'admin refuse un collaborateur
- [x] Un collaborateur n'atteint que les ressources de ses sites ; personne n'atteint un site d'un autre élevage
- [x] Un jeton expiré, falsifié ou mal transporté est refusé, sans que la route ne tourne
- [x] Un jeton émis avant `sessions_valid_from`, d'un compte bloqué, d'un rôle changé ou d'un compte inconnu de l'élevage est refusé (lecture du compte à chaque requête, dans la transaction de l'élevage)
- [x] Une route rejoint la transaction de la requête : ce qu'elle écrit avant d'échouer est annulé

### E.4 — Bloquer un compte le déconnecte partout · **M** · 🔒 ✅
> Spec : CdC « Identité » (téléphone volé) ; Archi §6 · Zone : `apps/api/src/users/{account-access,users.controller,users.module}.ts`
> Dépend de : E.3 · Revue : le blocage vaut dès la requête suivante, synchro comprise.
> Reformulée le 2026-11-07 : pas de révocation appareil par appareil en V1 (décision du fondateur). Livrée le 2026-11-07, aucune dépendance ajoutée. Trois routes réservées à l'admin, qui répondent 204 : `POST /api/v1/users/:id/block` (pose `blocked_at`, gardée si déjà bloqué, et `sessions_valid_from`), `…/unblock` (lève le blocage ; les jetons émis avant restent refusés), `…/sign-out-everywhere` (invalide les jetons sans bloquer). Un compte d'un autre élevage, ou un identifiant qui n'en est pas un : 404. Le mécanisme de refus est celui d'E.3 : le compte est relu à chaque requête.
> **Choix à relire** : l'admin ne bloque que des collaborateurs — ni son propre compte (409), ni un autre admin (403), pour qu'un co-gérant ne puisse pas en enfermer un autre dehors. « Déconnecter partout » vaut pour un collaborateur comme pour l'admin lui-même (ordinateur oublié). Un gardien ne peut rien de tout cela, pas même pour lui. L'horloge du serveur est désormais un fournisseur commun à toute l'API.
> **Reporté** : la trace de ces actions (qui a bloqué qui, quand, depuis quel appareil) est l'objet d'E.6 ; l'écran du bureau qui les déclenche n'a pas encore de tranche.

- [x] L'admin bloque un compte de son équipe, et le débloque
- [x] Un compte bloqué est refusé à la requête suivante, sur tous ses appareils
- [x] Débloquer un compte n'accepte pas les jetons émis avant : il faut se reconnecter
- [x] « Déconnecter partout » invalide les jetons sans bloquer le compte
- [x] L'admin ne bloque ni son propre compte, ni un autre admin, ni un compte d'un autre élevage ; un gardien ne bloque personne

### E.5 — L'admin crée les comptes de son équipe · **M** · 🔒 ✅
> Spec : CdC « Identité », « Utilisateurs, rôles » · Zone : `apps/api/src/users/{team-accounts,users.controller}.ts`, `apps/api/src/auth/{sign-in,sign-in.controller}.ts`, `packages/contracts/src/auth.ts`
> Dépend de : E.3 · Revue : un collaborateur n'a jamais de droit admin par défaut ; aucune session n'existe avec un PIN provisoire.
> Scindée le 2026-11-07 : l'affectation aux sites et le titulaire passent en E.7. Livrée le 2026-11-07, aucune dépendance ajoutée. **Décisions du 2026-11-07, ajoutées au CdC** : premier PIN en une seule étape (provisoire + nouveau, aucune session avant) ; provisoire valable 7 jours (`PROVISIONAL_PIN_LIFETIME_SECONDS`) ; PIN oublié remplacé de même ; **au moins un admin par élevage, créés par le seul script de l'éditeur** ; l'admin crée les collaborateurs depuis le bureau, en ligne.
> **Ce qui est livré** : `POST /api/v1/users` (admin) reçoit exactement `{ id, phone, name }` et répond 201 `{ id, role: 'collaborator', provisionalPin, provisionalPinExpiresAt }` — le PIN provisoire est tiré au hasard par le serveur (jamais trop simple) et montré cette seule fois ; un numéro déjà pris : 409. `POST /api/v1/auth/choose-pin` (publique) reçoit `{ phone, provisionalPin, newPin, deviceId }` : le provisoire est vérifié et compté comme à la connexion, le nouveau suit les règles d'E.1 et diffère du provisoire, puis la première session s'ouvre. Avec le provisoire, la connexion ordinaire répond 403 `PinMustBeChosen`, ou `ProvisionalPinExpired` après 7 jours. `POST /api/v1/users/:id/reset-pin` (admin, collaborateurs seulement) donne un nouveau provisoire et invalide les jetons émis avant.
> **Choix à relire** : le PIN provisoire est tiré par le serveur, pas choisi par l'admin. Un numéro déjà pris est vérifié avant la création, sur tout le service ; deux créations simultanées du même numéro donnent une erreur 500 au lieu d'un 409 (la contrainte d'unicité tient, rien n'est créé deux fois). La réponse « numéro déjà pris » dit qu'un numéro a un compte ailleurs (R-11).

- [x] L'admin crée un collaborateur : numéro, nom ; le compte reçoit un PIN provisoire tiré au hasard, montré une seule fois à l'admin
- [x] Un compte créé est toujours un collaborateur : la requête ne choisit pas le rôle
- [x] Un numéro qui a déjà un compte est refusé
- [x] Un collaborateur ne peut ni créer un compte ni changer son rôle
- [x] Un compte non admin est créé avec un PIN provisoire. Sa première connexion demande le PIN provisoire **et** un nouveau PIN, en une seule étape : aucune session n'existe avant que le nouveau soit choisi
- [x] Avec le seul PIN provisoire, la connexion ordinaire est refusée et dit qu'il faut choisir son PIN
- [x] Un PIN provisoire non utilisé expire au bout de 7 jours : l'admin en donne un autre
- [x] Un PIN oublié se remplace de la même façon : l'admin donne un PIN provisoire, qui invalide les jetons émis avant
- [x] Le nouveau PIN suit les règles d'E.1 (4 chiffres, pas trop simple) et diffère du provisoire

### E.6 — Les actions sensibles laissent une trace · **S** · 🔒 ✅
> Spec : Archi §6 « Audit » ; `CLAUDE.md` §4 règle 14 · Zone : `apps/api/src/audit/audit.ts`, migration `0001_init`
> Dépend de : E.4, E.5 · Revue : le journal d'audit ne se modifie pas et ne contient aucun secret.
> Livré le 2026-11-07, aucune dépendance ajoutée. Table `audit_events` : élevage, instant (horloge du serveur), action (liste fermée : `SignInSucceeded`, `SignInFailed`, `SignInRefused`, `PinChosen`, `AccountCreated`, `AccountBlocked`, `AccountUnblocked`, `SignedOutEverywhere`, `PinReset`), auteur, compte concerné, appareil et raison d'un refus. Écrite par `recordAudit` dans la transaction de l'action : l'action et sa trace sont validées ou annulées ensemble. En ajout seul pour tout le monde, comme le journal (droits `SELECT, INSERT`, déclencheurs ; la fonction de refus est devenue commune aux deux tables). Cloisonnée par élevage.
> **Choix à relire** : un essai sur un numéro inconnu ne laisse aucune trace — il n'appartient à aucun élevage, et toute table porte `tenant_id`. Chaque essai refusé pendant l'attente est tracé : marteler un numéro écrit une ligne par essai. Aucun écran ne lit encore la trace.
> **Changé en route** : les migrations sont appliquées une fois par conteneur de test, dans une base modèle que chaque fichier recopie. Rejouées une fois par fichier, elles faisaient dépasser à la suite complète ses délais (183 tests, moins de 2 minutes désormais).

- [x] Une connexion, réussie, ratée ou refusée, est tracée avec le compte, l'appareil et l'instant (numéro inconnu : aucune trace)
- [x] La création d'un compte, son blocage, sa levée, « déconnecter partout » et le remplacement d'un PIN sont tracés avec leur auteur et son appareil ; le premier choix du PIN aussi
- [x] Une action refusée ne laisse pas la trace d'une action faite
- [x] Une entrée d'audit ne se modifie ni ne se supprime, ni par l'application, ni par le propriétaire de la base
- [x] Aucune entrée ne contient de PIN, de jeton ni de numéro de téléphone

### E.7 — Affecter l'équipe aux sites · **S** · 🔒 ✅
> Spec : CdC « Gouvernance des déclarations » · Zone : `apps/api/src/sites/{site-staff,sites.controller,sites.module}.ts`, `packages/contracts/src/sites.ts`, migration `0001_init`
> Dépend de : E.5 · Revue : un site n'a qu'un titulaire. Scindée d'E.5 le 2026-11-07.
> Livrée le 2026-11-07, aucune dépendance ajoutée. L'avatar sort de la tranche (décision du fondateur) : il devient E.9. **Décisions du 2026-11-07, ajoutées au CdC** : retirer le titulaire est permis, le site reste sans titulaire ; un nouveau titulaire fait de l'ancien un remplaçant, qui garde l'accès ; **affecté à un site sans titulaire, un collaborateur en devient titulaire** (un retrait ne promeut personne). Trois routes réservées à l'admin, qui répondent 204 : `PUT /api/v1/sites/:siteId/staff/:userId` (affecte comme remplaçant, ou comme titulaire si le site n'en a pas — tracé alors en `PrimaryCaretakerDesignated` ; déjà affecté : rien ne change), `DELETE …/staff/:userId` (retire ; pas affecté : 404), `PUT /api/v1/sites/:siteId/primary-caretaker` avec exactement `{ userId }` (désigne, en affectant au besoin). Un site ou un compte d'un autre élevage : 404. Chaque changement est tracé (`SiteAssigned`, `SiteUnassigned`, `PrimaryCaretakerDesignated`) avec le site, nouvelle colonne `audit_events.site_id`. Le site est verrouillé (`SELECT … FOR UPDATE`) le temps du changement : deux admins qui désignent au même moment sont servis l'un après l'autre.
> **Choix à relire** : seul un collaborateur s'affecte — un admin atteint déjà tous les sites, et n'est donc jamais titulaire (403). L'application reçoit le droit `DELETE` sur `site_assignments`, et sur elle seule : une affectation retirée s'efface, l'historique est dans la trace. Un compte bloqué peut être affecté. Aucune route ne lit encore l'équipe d'un site (l'écran « Équipe » la demandera).

- [x] L'admin affecte un collaborateur à un ou plusieurs sites, et retire une affectation
- [x] L'admin désigne le titulaire d'un site ; un site n'a qu'un titulaire
- [x] Un collaborateur ne s'affecte pas lui-même, et n'atteint que les sites où il est affecté (E.3)
- [x] ~~L'avatar du compte~~ → E.9

### E.8 — Ajouter un admin à un élevage, par script · **S** · 🔒 ✅
> Spec : CdC « Identité » (au moins un admin par élevage, créés par l'éditeur seul) · Zone : `apps/api/src/{add-admin,tenants/add-admin}.ts`, `apps/api/build.mjs`, migration `0001_init`
> Dépend de : D.4, E.5 · Revue : aucune route ne crée un admin.
> Livrée le 2026-11-07, aucune dépendance ajoutée. `node dist/add-admin.js --tenant-id … --admin-name … --admin-phone …`, dans la tâche de migration, sous le rôle propriétaire ; le PIN (6 chiffres, pas trop simple) est demandé au clavier ou lu sur l'entrée standard, jamais en argument. L'élevage se désigne par son identifiant, affiché à l'amorçage (un nom d'élevage n'est pas unique). Le nouvel admin se connecte directement, sans PIN provisoire (décision du 2026-11-07 : la règle du premier PIN ne vaut pas pour l'admin). Le compte et sa trace s'écrivent ensemble.
> **Choix à relire** : l'ajout d'un admin est tracé (`AdminAdded`), et l'amorçage trace désormais aussi le premier admin ; l'éditeur n'ayant de compte dans aucun élevage, l'auteur de ces traces est **vide** (`audit_events.actor_id` devient facultatif). « Au moins un admin » tient parce qu'aucune action ne retire un admin : un test recense toutes les routes du serveur, et une route ajoutée le fait échouer pour qu'on la relise ; pas de déclencheur en base. Retirer un admin (co-gérant parti) n'a pas de tranche : par script aussi, le jour où il le faudra, avec la garde « pas le dernier ».
> **Changé en route** : joué dans Docker, le script a révélé un défaut d'E.2 — les scripts de l'éditeur lisaient toute la configuration de l'API, `JWT_SECRET` compris, que la tâche de migration ne reçoit pas : l'amorçage (D.4) ne tournait plus. Ils ne lisent plus que `DATABASE_URL` (`loadDatabaseUrl`) ; la tâche de migration ne reçoit toujours pas le secret des jetons, et `tools/infra.spec.mjs` le garde.

- [x] Le script de l'éditeur ajoute un admin à un élevage existant (numéro, nom, PIN demandé au clavier)
- [x] Un numéro déjà pris est refusé ; un élevage inconnu aussi
- [x] Un élevage garde toujours au moins un admin : aucune action ne retire le dernier

### E.9 — L'avatar et la langue du compte · **S** ✅
> Spec : CdC « Identité » (avatar picto du compte), « Trois canaux redondants » (langue audio) · Zone : `packages/design-system/`, `apps/api/src/users/`
> Dépend de : E.5, et la liste des pictos fixée avec `/designer` · Scindée d'E.7 le 2026-11-07 ; la langue s'y ajoute le 2026-11-07 (décision du fondateur : la langue suit la personne, pas le site).

- [x] La liste fermée des avatars, fixée avec `/designer` — douze avatars validés le 2026-11-07 (`packages/design-system/src/pictograms/source/avatar-*.svg`, liste `AVATARS`, noms dans `PICTOGRAM_LABELS`), recuits avec les pictos ; à valider sur le terrain
> Livrée le 2026-11-07, aucune dépendance ajoutée. Deux types énumérés en base, `account_avatar` (les douze) et `audio_language` (`wo`, `fr`) ; `users.avatar`, `users.audio_language` et `sites.audio_language`, tous facultatifs (un admin amorcé par script n'a pas d'avatar ; la langue d'un site se règle en O.1). La création d'un compte exige l'avatar et accepte la langue (`POST /api/v1/users`) ; `PATCH /api/v1/users/:userId` (admin, 204) change exactement l'avatar, la langue, ou les deux — une langue `null` refait suivre le site ; autre champ ou valeur hors liste : 400 sans rien changer ; compte d'un autre élevage : 404. La connexion renvoie `account` : nom, avatar et **langue effective** — celle de la personne, sinon celle de son site (le site dont elle est titulaire d'abord), sinon le français, langue des premiers clips. Le changement d'avatar ou de langue n'est pas tracé : il ne touche ni l'accès ni l'argent.

- [x] L'admin choisit l'avatar d'un collaborateur à la création, et le change
- [x] ~~Deux comptes d'un même site ne portent pas le même avatar~~ — sans objet depuis le 2026-11-08 : un téléphone = une personne, aucun écran ne fait choisir entre deux avatars
- [x] L'admin choisit la langue audio d'un collaborateur à la création, et la change : une langue dont les clips existent (wolof, français ; d'autres plus tard) — c'est la personne qui écoute, et un remplaçant ne parle pas forcément la langue du titulaire
- [x] Sans langue choisie, le compte suit la langue par défaut de son site

## F — Ingestion et descente

### F.1 — Décoder un événement reçu · **M** · 🧪 ✅
> Spec : Archi §5 ; `CLAUDE.md` §4 règle 2 · Zone : `apps/api/src/journal/decode-event.ts`, `packages/contracts/src/journal.ts`, `packages/domain/src/journal/validate-declaration.ts`
> Dépend de : C.2, C.3, C.5 · Revue : rien du corps ne choisit l'auteur ni l'élevage ; une entrée inconnue est refusée.
> Scindée le 2026-11-07 : l'ingestion du lot devient F.4, la colonne de l'appareil passe en F.2. Livrée le 2026-11-07, aucune dépendance ajoutée. `decodeJournalEvent(raw, { tenantId, authorId })` rend un `JournalEvent` gelé, construit par le domaine, ou un refus `DecodingRefusal` : `MalformedEvent` (champ absent, mauvais type JSON, valeur hors d'une liste fermée — le champ est nommé, `fact.quantity`), `UnknownField` (nommé), `UnknownEventType`, ou le motif du constructeur de la valeur (`InvalidId`, `InvalidQuantity`, `InvalidInstant`…). Format d'échange `JournalEventPayload` dans `packages/contracts` : le fait est imbriqué sous `fact` ; un test de l'API décode un exemple de chaque forme du contrat. `validateDeclaration` (et donc la correction et l'annulation) reçoit désormais `author: { id, role }`, la forme de `authorizeDeclaration`, et refuse comme une faute un auteur qui n'est pas celui de l'événement.
> **Déplacé le 2026-11-07, à la demande du fondateur** : le décodeur était d'abord dans le domaine, comme le disait le backlog d'origine. « Décoder » n'est pas un mot du métier, et le domaine connaissait alors le format d'échange (noms des champs JSON, fait imbriqué sous `fact`) : c'est une traduction à la frontière, qui vit maintenant dans l'API, à côté de l'ingestion. Le domaine lui fournit la liste fermée des faits et les constructeurs des valeurs ; les motifs propres au décodage (`MalformedEvent`, `UnknownField`, `UnknownEventType`) ne sont plus dans sa liste fermée. Il reviendra au domaine le jour où le téléphone devra décoder le journal reçu (F.3), pas avant.
> **Choix à relire** : un corps qui nomme l'auteur, l'élevage, l'appareil ou une date de réception est **refusé** (`UnknownField`), pas ignoré — la règle « entrée inconnue rejetée » l'emporte sur la formule « ignorés » du backlog d'origine ; un téléphone honnête ne les envoie pas. Une pesée sans aucun poids est refusée ; le nombre de poids d'une pesée (cinq ?) n'est pas encore une règle. (La balance du site, d'abord exigée pour juger une pesée, n'est plus modélisée depuis le 2026-11-07 : `ScaleUnknown` est retiré.) Une valeur inconnue dans une liste fermée imbriquée (type de perte, papier du livreur) est un `MalformedEvent` qui la nomme ; seul le type de fait a son motif propre.

- [x] Un événement reçu en JSON est décodé en `JournalEvent` : type hors liste, champ manquant ou valeur invalide donnent un motif typé (DTO dans `packages/contracts`)
- [x] L'auteur et l'élevage viennent de la session, jamais du corps
- [x] Les règles de C.2 et de C.3 reçoivent l'auteur sous une seule forme (aujourd'hui `authorRole` pour l'une, `author` — identifiant et rôle — pour l'autre)

### F.4 — Ingérer un lot d'événements · **M** · 🧪 · ⚠ ✅
> Spec : Archi §5 ; `CLAUDE.md` §4 règle 2 · Zone : `apps/api/src/journal/ingest-events.ts` (ports en mémoire)
> Dépend de : F.1 · Revue : l'auteur vient de la session ; un doublon n'est pas une erreur. Scindée de F.1 le 2026-11-07.
> Livrée le 2026-11-07, aucune dépendance ajoutée. `ingestEvents(lot, session, ports)` rend le sort de chaque événement, dans l'ordre d'envoi : `Accepted`, `Duplicate` (identifiant déjà au journal, ou deux fois dans le lot — le premier venu reste, même si le contenu diffère) ou `Refused` avec son motif (décodage, règles du domaine, `UnknownCampaign`, `UnknownEvent`). Ports : `sites()` (tous les sites de l'élevage, avec équipe et fuseau), `campaign`, `event`, `isRetracted`, `dayJournal`, `append(événement, appareil)`. Dans un lot, les déclarations passent d'abord, puis les corrections, puis les annulations. Les règles du jour, de la correction et de l'annulation, puis la politique de déclaration, avec l'auteur et le rôle de la session.
> **Choix à relire** : l'ingestion ne lit aucune horloge — un événement daté par un téléphone en avance est jugé à sa date de saisie et accepté ; « prévenir l'admin » se calculera de la date de saisie et de la date de réception gardées en base (O.4), sans signal de plus ici. Une bande inconnue et une bande d'un autre élevage reçoivent le même refus. Lecture événement par événement : simple, suffisant pour des lots de téléphone ; à revoir si F.2 mesure un lot lent.

- [x] Un événement valide est accepté et rejoint le journal
- [x] Un événement dont la date de saisie est postérieure à sa réception est accepté (décision du 2026-11-07) ; l'alerte à l'admin se calcule des deux dates gardées en base (O.4) ; l'instant où le juger et le seuil d'alerte sont reportés (tableau des décisions)
- [x] Un événement déjà reçu (même UUID) est ignoré et signalé comme doublon, sans erreur
- [x] Un lot mêlant acceptés, doublons et refusés renvoie le sort de chaque événement
- [x] Dans un lot, une déclaration s'insère avant ce qui la corrige ou l'annule : la base refuse de nommer un événement absent (D.3)
- [x] Un événement refusé par la politique de déclaration donne un motif typé
- [x] « Rien perdu » est jugé contre le journal du jour (`validateAgainstDay`) : refusé si des morts ont été écrits avant lui
- [x] Une annulation est jugée par `validateRetraction` contre la déclaration qu'elle nomme ; le serveur lit dans le journal si celle-ci est déjà annulée, pour une annulation comme pour une correction
- [x] Une contre-déclaration est jugée par `validateCounterDeclaration` contre la déclaration qu'elle nomme, lue dans le journal ; une origine inconnue donne un motif typé
- [x] Rejouer un lot entier ne change rien au journal (property-based)

### F.2 — L'API reçoit le journal · **M** · 🔒 · 🧪 ✅
> Spec : Archi §4 (`journal`), §5 · Zone : `apps/api/src/journal/` (contrôleur, dépôt Prisma)
> Dépend de : F.4, D.3, E.3 · Revue : tests sur une vraie base ; la taille d’un lot est plafonnée.

> Livrée le 2026-11-07, aucune dépendance ajoutée. `POST /api/v1/journal/events` (chemin en anglais, comme toutes les routes — `CLAUDE.md` §6 ; le backlog d'origine disait `evenements`) reçoit exactement `{ events: [...] }`, au plus `MAX_EVENTS_PER_BATCH` = 100 événements (au-delà : 413, rien n'est écrit), et répond 200 `{ outcomes }` (types `JournalBatchRequest` et `JournalBatchResponse` dans `packages/contracts`). Toute session peut l'appeler : qui écrit quoi se juge dans le domaine. Le lot entier tient dans la transaction de la requête. Dépôt `PrismaJournal` : une ligne relue repasse par le même décodeur qu'un envoi (une ligne qui ne se décode plus est une panne) ; `factOf` du domaine sépare le fait de son enveloppe à l'écriture. Colonne `journal_events.device_id`, obligatoire (réserve R-8 levée).
> **Relecture sécurité, allégée** (le fondateur veut rester pragmatique) : le tenant, l'auteur et l'appareil viennent de la session ; une bande d'un autre élevage est inconnue ; un identifiant déjà pris chez un autre élevage donne une ligne à soi, sans toucher à l'autre ; un gardien non affecté est refusé ; corps en liste blanche, lot plafonné ; route fermée sans session. Aucune route ne lit encore le journal (F.3).
> **Changé en route** : la propriété « rejouer un lot ne change rien » (F.4) a trouvé un défaut du domaine sur un lot tiré au hasard — morts à 11 h, « rien perdu » à midi, annulation des morts à 20 h : refusé au premier envoi, « rien perdu » était accepté au second. `validateAgainstDay` juge désormais « rien perdu » contre le journal tel qu'il était à sa date de saisie (CdC mis à jour) ; 3 000 lots tirés ensuite sans contre-exemple.
> **Choix à relire** : deux envois simultanés du même lot (un téléphone qui réessaie pendant que le premier envoi tourne) peuvent faire échouer le second en 500 sur la contrainte d'unicité ; rien n'est compté deux fois, et le renvoi suivant reçoit des doublons. Une fois, la suite complète de l'API a dépassé des délais dans deux fichiers sans lien avec F.2 ; non reproduit en quatre lancements depuis.

- [x] Relecture sécurité avant le code (allégée, voir ci-dessus)
- [x] `POST /api/v1/journal/events` accepte un lot et renvoie le sort de chaque événement
- [x] Le même lot envoyé deux fois ne crée aucune ligne en double
- [x] Un UUID déjà utilisé par un autre tenant ne révèle rien et n'écrase rien
- [x] Un champ inconnu dans le corps fait refuser l'événement
- [x] Un lot au-delà de la taille maximale est refusé
- [x] L'appareil est enregistré avec l'événement : la colonne s'ajoute à `journal_events` (réserve R-8) ; il vient de la session
- [x] Le serveur pose sa date de réception (`receivedAt`) à l'enregistrement en base (déjà posée par la base depuis D.3)

### F.3 — Le gardien reçoit son contexte, sans argent · **M** · 🔒 ✅
> Spec : Archi §5 « Descente » ; `CLAUDE.md` §4 règle 4 · Zone : `apps/api/src/journal/caretaker-context/`, `packages/contracts`
> Dépend de : F.2, C.6 · Revue : le type de réponse du gardien est distinct de ceux de l'admin.
> Livrée le 2026-11-07, aucune dépendance ajoutée. `GET /api/v1/caretaker/context` (chemin en anglais ; le backlog d'origine disait `gardien/contexte`) renvoie `{ sites: [...] }` : **tous les sites que la session atteint**, en une fois — ceux du collaborateur, filtrés dans la requête, ou tous ceux de l'élevage pour l'admin. Pour chacun : nom, jour métier du site (`today`), et **ses campagnes en cours** (liste, la plus ancienne mise en place d'abord ; vide s'il n'y en a pas) — pour chacune : identifiant, mise en place, jour J, vivants, et le journal effectif d'avant-hier, hier et aujourd'hui dans l'ordre d'écriture, chaque ligne avec son auteur (identifiant et nom), le fait qui compte, `corrected` et `retracted` (une ligne annulée garde le fait déclaré). Type de réponse propre au gardien (`CaretakerContext`, packages/contracts). Construite depuis le journal et les règles du domaine (`effectiveJournal`, `recentBusinessDays`, `campaignDay`) : rien n'y lit une commande, un coût ou une vente.
> **Choix à relire** : une seule route pour tous les sites, plutôt qu'une par site. Les vivants valent `null` tant que les poussins mis en place ne sont pas connus (absent n'est pas zéro ; lève aussi le risque de R-1 côté gardien). Une campagne en cours est une campagne non clôturée ; **un site peut en avoir plusieurs à la fois, et le gardien déclare sur chacune** (décision du fondateur, 2026-11-07 — la première version n'en rendait qu'une). Le téléphone ne recalcule pas les vivants seul : il reçoit le chiffre du serveur (R-3 levée). Un gardien dont le site n'a pas de campagne reçoit le site avec une liste vide, sans chiffres.

- [x] `GET /api/v1/caretaker/context` renvoie le site, chacune de ses campagnes en cours et son jour J ; les vivants valent `null` (inconnus) tant que les lignes de commande qui livrent les poussins n'existent pas — ils viendront avec O.2 et Q.7
- [x] Il renvoie le journal effectif des trois derniers jours, avec l'auteur de chaque ligne
- [x] Ce journal ne contient aucune perte hors mortalité (manquants, dons) : le gardien ne voit que les morts
- [ ] Les vivants renvoyés tiennent compte de ces pertes — avec les vivants eux-mêmes (O.2, Q.7) ; le calcul du domaine les compte déjà (C.5)
- [x] Une ligne annulée par l'admin y est donnée comme annulée : le téléphone cesse de la compter et de la rappeler
- [x] Un collaborateur ne reçoit que le contexte de ses sites : le filtre est dans la requête du serveur, jamais à l'écran ; un site retiré ne descend plus dès la requête suivante
- [x] Aucun champ de la réponse ne porte de montant, de prix ni de solde (test de garde sur le type)
- [x] Sans campagne en cours, la réponse le dit explicitement (liste vide)
- [x] Plusieurs campagnes en cours sur un même site descendent chacune avec son jour J et son journal (décision du 2026-11-07)

## G — PWA et outbox hors-ligne

### G.1 — L'application s'installe et démarre sans réseau · **M** ✅
> Spec : Archi §5 « Service worker » · Zone : `apps/web` (manifest, service worker)
> Dépend de : A.3 · Revue : ce qui est précaché, et son poids.
> Livrée le 2026-11-07. **Dépendances ajoutées** (accord du fondateur) : `@angular/service-worker` 21.2 (MIT), `@fontsource/andika` et `@fontsource/shantell-sans` 5.3 (OFL) ; audit d'exécution à zéro, licences vérifiées. Manifeste (`public/manifest.webmanifest`, seul endroit où s'écrit « Yaar »), icônes 192 et 512 px. **Icône remplacée le 2026-11-07 par celle du fondateur** (`packages/design-system/brand/yaar-icon.png`, avec le logo `yaar-logo.png`) : `packages/design-system/tools/make-app-icons.py` (Python et Pillow, lancé à la main) en tire les icônes pleines et masquables (192, 512), l'icône iPhone (180) et le favicon, en palette de 256 couleurs ; le vert de thème et de lancement devient `#054612`, pris sur l'icône (jeton `--color-splash`). Les icônes ne sont plus précachées : le téléphone les garde à l'installation. Favicon simplifié le 2026-11-07 (`brand/favicon.svg`, le Y et trois grains sans les animaux, lisible à 32 px), en SVG et en `.ico` redessiné par le même script. Service worker Angular en production (`ngsw-config.json`) : précache de la coquille, du code, des styles, des polices et des icônes (environ 480 Ko). Polices des maquettes servies par l'application, sous-ensemble latin seulement (français et wolof). Stockage persistant demandé au démarrage, sans jamais bloquer. Vues `caretaker` et `admin` chargées à la demande ; code de départ : 62 Ko compressés.
> **Non vérifié** : le démarrage hors-ligne sur un vrai téléphone (cahier de recette, recette manuelle) ; les tests portent sur la configuration et le build.

- [x] L'application s'installe sur l'écran d'accueil avec son icône (192 et 512 px, maskable)
- [x] Après une première visite, elle démarre sans réseau (configuration du précache vérifiée ; essai sur appareil à faire)
- [x] Les polices sont servies par l'application, jamais par un CDN
- [x] Le stockage persistant est demandé à l'installation
- [x] Les routes gardien et admin sont chargées séparément

### G.2 — Se connecter sur le téléphone · **M** · 🎨 ✅
> Spec : CdC « Identité » (un téléphone = une personne, avatar du compte) · Zone : `apps/web/src/app/core/session/`, écran de connexion
> Dépend de : G.1, E.2 · Revue : utilisable sans lire.
> Cœur livré le 2026-11-07 (décision du fondateur : un écran simple maintenant, l'écran « cahier » et l'avatar après `/designer` et E.9). `SessionStore` garde le jeton, son échéance et le rôle sur le téléphone (pas de cookie) et un identifiant d'appareil créé une seule fois ; `AuthService` ouvre la session (`sign-in`, `choose-pin` au premier PIN) et rend le motif d'un refus, ou « pas de réseau », ou « service indisponible ». Écran simple `/sign-in` : numéro, PIN, puis nouveau PIN à la première connexion, messages en français. Le cahier s'ouvre à un gardien dont la session a expiré (il déclare hors-ligne) ; le bureau exige une session valide et le rôle admin. `@angular/forms` n'est pas ajouté : deux champs n'en valent pas un paquet.

- [x] L'utilisateur reconnaît son avatar, puis saisit son PIN — écran conçu le 2026-11-07 (`journal-gardien-entree.html`), porté le 2026-11-07 : le téléphone garde le compte qui s'y est connecté (`yaar.account` : identifiant, numéro, rôle, nom, avatar, langue — rien de financier), même après une déconnexion. **Corrigé le 2026-11-08** : un téléphone = une personne (décision du fondateur) ; l'écran « Qui tient le cahier ? », qui supposait un téléphone partagé, est retiré : le compte gardé ouvre directement le code, sous son avatar et son nom ; sans compte gardé, le numéro. Pavé de grosses touches (`ui/keypad.ts`), quatre ronds pour un gardien, six pour un admin, envoi au dernier chiffre ; pour un numéro jamais vu sur ce téléphone, le rôle est inconnu et le code se valide d'une touche. Code faux : ronds rouges et post-it ; au premier code, celui du chef puis le sien deux fois, comparés sur le téléphone. La voix viendra avec les clips (épique I).
- [ ] Un PIN refusé se comprend sans lire (picto, couleur, audio) — conçu le 2026-11-07 : ronds rouges qui tremblent, post-it, voix ; reste à porter
- [x] Une session ouverte survit à la fermeture de l'application
- [x] Un collaborateur arrive sur le cahier ; un admin arrive sur le bureau

### G.3 — L'outbox garde chaque déclaration · **M** · 🧪 ✅
> Spec : Archi §5 « Outbox locale » · Zone : `apps/web/src/app/core/outbox/`
> Dépend de : G.1, C.1 · Revue : rien n'est perdu entre le tap et le stockage.
> Livrée le 2026-11-07. **Dépendance de développement ajoutée** : `fake-indexeddb` 6.2 (Apache-2.0), une IndexedDB en mémoire pour les tests. `Outbox` écrit dans IndexedDB sans bibliothèque ; une écriture ne résout qu'une fois sa transaction validée. Chaque entrée garde son auteur : elle ne part que sous ce compte (décision du 2026-11-07). Une entrée jamais partie se corrige sur place (`replace`) ; tentée une fois, elle ne change plus. Stockage indisponible : `OutboxUnavailable`, et `JournalSync.storageUnavailable` le signale aux écrans.

- [x] Une déclaration est enregistrée localement avant tout appel réseau
- [x] Elle survit à la fermeture de l'application et au redémarrage du téléphone (prouvé par une réouverture de la base ; le redémarrage réel est à la recette sur appareil)
- [x] Chaque événement de l'outbox a un état : en attente (jamais parti), envoi en doute (tenté, sans réponse), envoyé ou refusé
- [x] L'UUID est généré sur le téléphone, une seule fois, à la création
- [x] Si le stockage local échoue, l'utilisateur en est averti et rien n'est marqué « noté » (l'avertissement à l'écran vient avec les écrans du cahier)

### G.4 — La synchro envoie sans perdre ni doubler · **M** · 🧪 ✅
> Spec : Archi §5 « Synchronisation » · Zone : `apps/web/src/app/core/sync/`
> Dépend de : G.3, F.2 · Revue : la reprise après coupure, cas par cas.
> Livrée le 2026-11-07. `synchronize(outbox, session, transport, now)` : par lots de 100 (`BATCH_SIZE`, le plafond de l'API), dans l'ordre de création, chaque lot marqué en doute avant de partir. `JournalSync` (service Angular, démarré avec l'application) synchronise à l'ouverture, au retour du réseau et après chaque déclaration, un envoi à la fois ; il expose `waiting` (pastille), `refused` et `stopped`.
> **Choix à relire** : une réponse du serveur autre que 200 ou 401 (panne, requête refusée en bloc) laisse le lot en doute, et il repart à la synchro suivante — pas de nouvelle tentative en boucle, seulement à l'ouverture, au retour du réseau ou à la déclaration suivante.

- [x] Les événements en attente partent à l'ouverture et au retour du réseau
- [x] Une coupure pendant l'envoi laisse les événements en doute : ils repartent ensuite, à l'identique, et ne se modifient plus sur le téléphone (une modification locale serait ignorée comme doublon)
- [x] Un événement signalé comme doublon par le serveur passe à « envoyé »
- [x] Les événements partent dans l'ordre de leur création
- [x] La pastille de synchro reflète le nombre d'événements en attente (la valeur ; la pastille elle-même vient avec H.5)

### G.5 — Refus du serveur et session expirée · **M** · 🧪 ✅
> Spec : Archi §6 « Mode strict » ; CdC « La confiance est visible » · Zone : `apps/web/src/app/core/sync/`
> Dépend de : G.4, E.4 · Revue : aucun renvoi en boucle, aucune perte silencieuse.
> Cœur livré le 2026-11-07. Un refus est gardé avec son motif et ne repart jamais. Une session expirée n'envoie rien et garde tout ; un 401 avant l'échéance du jeton est une session révoquée (compte bloqué, ou « déconnecter partout ») : la synchro s'arrête et `stopped` le dit ; rien n'est perdu (décision du 2026-11-07 : l'outbox reste sur le téléphone, et ne part que sous le compte de son auteur).
> Terminée le 2026-11-08, aucune dépendance ajoutée. **Décision du 2026-11-08, ajoutée au CdC** (« Une déclaration refusée n'est jamais perdue ») : le serveur garde chaque déclaration bien formée qu'il refuse par une règle du métier dans `refused_events` (`RefusedEvent`, migration unique `0001_init`) — la déclaration entière sous la forme du contrat, son motif, son auteur, son appareil, ses deux dates, le site de la bande ; en ajout seul (droits lire et ajouter, déclencheurs comme le journal), RLS forcée, date de réception posée par la base ; une même déclaration refusée deux fois n'y est qu'une fois ; un envoi illisible ou la bande d'un autre élevage n'y entrent pas (`ingestEvents` → `recordRefusal`). Sur le téléphone, `RefusalNotice` (`caretaker/sync/`) : un post-it liste chaque refus non encore entendu (picto, quantité, jour) avec son haut-parleur — `sync-refused-too-old` pour un jour trop ancien, `nothing-lost-refused` pour un « rien perdu » contredit, `sync-refused` sinon (« Il l'a reçue, il s'en occupe ») — jusqu'à « J'ai compris » (`refusalSeen`, gardé dans l'outbox) ; une session révoquée ou expirée a son post-it, l'expirée mène à l'entrée du code. 1 phrase ajoutée, 1 reformulée (script à 413).
> **Non fait ici** : l'écran du bureau qui lit le registre et réécrit une déclaration en un tap (O.4). Un gardien connecté peut remplir le registre de déclarations refusées à dessein (cent par envoi) : borné par sa session, tracé à son nom, accepté pour la V1. Pas regardé dans un navigateur.

- [x] Un événement refusé par le serveur n'est pas renvoyé indéfiniment
- [x] Un refus est signalé au gardien par picto et audio : un post-it montre chaque déclaration refusée (picto, quantité, jour) et la voix dit pourquoi, jusqu'à « J'ai compris »
- [x] Le serveur garde chaque déclaration bien formée qu'il refuse par une règle du métier, avec son motif, son auteur et son appareil, dans un registre en ajout seul cloisonné par élevage ; une même déclaration refusée deux fois n'y est qu'une fois ; un envoi illisible n'y entre pas (décision du 2026-11-08)
- [x] Une session expirée ou révoquée est dite au gardien par picto et audio, avec le chemin pour se reconnecter
- [x] Une session expirée conserve l'outbox ; la synchro reprend après reconnexion
- [x] Une session révoquée arrête la synchro et le dit à l'utilisateur (`JournalSync.stopped` ; l'écran qui le dit vient avec le cahier)

### G.6 — L'outbox se vide de ce qui est envoyé · **S** · 🧪
> Spec : Archi §5 « Outbox locale » ; CLAUDE.md §4 règle 3 · Zone : `apps/web/src/app/core/outbox/`
> Dépend de : G.4 · Revue : jamais un événement en attente ou en doute ne disparaît. Ajoutée le 2026-11-07 (question du fondateur : « la mémoire des téléphones est nettoyée ? »).
> Aujourd'hui rien ne nettoie l'outbox : les événements envoyés et refusés y restent. Pas urgent — environ 300 octets par déclaration, soit 1 Mo par an pour un gardien qui en écrit dix par jour — mais à faire avant que les téléphones vivent des années.

- [ ] Un événement envoyé s'efface du téléphone quelques jours après son envoi (120 jours, dans une constante) : le serveur l'a, et le cahier le reçoit de lui
- [ ] Un événement refusé reste jusqu'à ce que son refus ait été vu, pour qu'aucune erreur ne disparaisse en silence
- [ ] Un événement en attente ou en doute ne s'efface jamais, quel que soit son âge
- [ ] Le nettoyage tourne au démarrage, sans retarder l'ouverture du cahier

---

# LOT 2 — Le cahier du gardien

## H — Design system « cahier »

### H.1 — Les tokens sont la source unique du style · **S** ✅
> Spec : CdC « Design signé » ; `journal-gardien.html` (`:root`) · Zone : `packages/design-system/tokens`
> Dépend de : A.1 · Revue : comparer les valeurs à celles de la maquette.
> Livrée le 2026-11-07, aucune dépendance ajoutée. `packages/design-system/src/tokens/_tokens.scss` : propriétés CSS en anglais (`--color-shell` pour `--coquille`, etc. — `CLAUDE.md` §6), tout le `:root` de la maquette aux mêmes valeurs (un test les compare), plus le violet du jour passé, le post-it, le scotch, les ombres dures, les bords tracés à la main, les lignes du cahier, les polices, la cible tactile minimale (48 px) et la coupure des animations quand le système demande moins de mouvement. Chargé par `apps/web/src/styles.scss` (`@use 'tokens/tokens'`). Règle ESLint : une couleur littérale (`#…`, `rgb(…)`, `hsl(…)`) dans le code du web fait échouer le lint, prouvée par un essai fautif dans `tools/design-system.spec.mjs`.

- [x] Les couleurs de la maquette existent en tokens, y compris le violet du jour passé et le post-it
- [x] Andika et Shantell Sans sont auto-hébergées, en woff2 sous-ensemblé, et précachées (fait en G.1)
- [x] Ombres dures, rayons irréguliers et lignes de cahier sont des tokens réutilisables
- [x] Un composant qui écrit une couleur en dur fait échouer le lint

### H.2 — Les pictos sont pré-cuits au build · **M** ✅
> Spec : Archi §4 « Performances » · Zone : `packages/design-system/pictograms`, script de build
> Dépend de : H.1 · Revue : le rendu à côté de la maquette ; aucun filtre à l'exécution.
> Livrée le 2026-11-07, aucune dépendance ajoutée. Les 30 pictos de la maquette gardien sont des sources SVG (`src/pictograms/source/`, noms anglais : `dead-chicken`, `open-bag`…) ; la marque Yaar (`y-mini`) reste à part, sans tremblé. `tools/bake-pictograms.mjs`, sans dépendance, découpe chaque forme (cercles, ellipses, rectangles, polygones, tracés avec courbes et arcs) en points rapprochés et les déplace d'un bruit déterministe, germé par le nom du picto, qui reprend le tremblé du filtre `#rough` de la maquette ; il écrit `generated/pictograms.svg` (un symbole par picto, 74 Ko) et la liste typée des noms. `--check` dit si le fichier livré est à jour. Noms accessibles en français dans `labels.ts` : un picto ajouté sans nom fait échouer le typage. Fichier servi par l'application et précaché. Comparé visuellement, picto par picto, à la maquette : fidèle, tremblé discret. Alias `@design-system`.
> **Commande** : `node packages/design-system/tools/bake-pictograms.mjs` après avoir modifié une source.

- [x] Chaque picto de la maquette gardien existe en SVG au tremblé déjà appliqué
- [x] Aucun composant n'utilise de filtre SVG à l'exécution
- [x] Le même picto source donne toujours le même tracé (build reproductible)
- [x] Chaque picto porte un nom accessible

### H.3 — Boutons, cartes et étiquettes · **M** ✅
> Spec : `journal-gardien.html` (`.geste`, `.sticker`, `.livraison`, `.nudge`) · Zone : `packages/design-system/components`
> Dépend de : H.2 · Revue : cibles tactiles et état d'appui.

> Livrée le 2026-11-07, avec H.4 et H.5. **Choix à relire** : les composants Angular vivent dans `apps/web/src/app/ui/` et non dans `packages/design-system/components` — le paquet n'a pas l'outillage pour compiler et tester des composants Angular, et il reste sans framework (jetons, pictos, script de cuisson). `Pictogram` (le picto pré-cuit, son nom ou silencieux s'il décore), `GestureButton` (quatre tons : morts, sac, voix, photo), `TapedCard` (carte scotchée, bord papier, vert ou bleu), `PostIt`. Styles écrits avec les seuls jetons ; une règle d'outillage vérifie qu'on n'anime que `transform` et `opacity`, que les cibles tactiles tiennent 48 px et que le focus est visible. Le crayon et le haut-parleur viendront avec leurs écrans (J.3, I) et suivront la même règle.

- [x] Le bouton-geste affiche picto, couleur et libellé, et s'enfonce à l'appui
- [x] La carte scotchée et le post-it reprennent la matière de la maquette
- [x] Toute cible tactile fait au moins 48 px, crayon et haut-parleur compris (pour les cibles existantes ; crayon et haut-parleur avec leurs écrans)
- [x] Le focus est visible sur chaque composant
- [x] Les animations se coupent quand le système demande moins de mouvement

### H.4 — Feuille, compteur et pile · **M** ✅
> Spec : `journal-gardien.html` (`.feuille`, `.compteur`, `.pile`) · Zone : `packages/design-system/components`
> Dépend de : H.3 · Revue : on n'anime que `transform` et `opacity`.

> Livrée le 2026-11-07. `Sheet` (monte par `transform`, se ferme en touchant le voile ou par Échap, inerte fermée), `Counter` (jamais sous un, même quand les appuis vont plus vite que l'écran — défaut trouvé par le test et corrigé), `Pile` et `pileLayout` (12 objets puis « +n » ; réception par paquets de 4, cinq par ligne, 15 paquets puis « +n », comme la maquette).

- [x] La feuille monte du bas et se ferme en touchant le voile
- [x] Le compteur augmente et diminue par gros boutons, sans descendre sous un
- [x] La pile dessine un objet par unité comptée ; au-delà de douze, elle affiche le reste en « +n »
- [x] La pile de réception range par paquets de 4, cinq paquets par ligne

### H.5 — Tampon et pastille de synchro · **S** ✅
> Spec : CdC « La confiance est visible » · Zone : `packages/design-system/components`
> Dépend de : H.3 · Revue : la pulsation n'utilise pas `box-shadow`.

> Livrée le 2026-11-07. `Stamp` (s'abat par `transform`, annoncé à un lecteur d'écran) ; `SyncBadge` (le nombre en attente, ou une coche et « Tout est bien envoyé » ; il se branchera sur `JournalSync.waiting`, G.4).

- [x] Le tampon « C'est noté » s'abat puis disparaît
- [x] La pastille montre le nombre d'envois en attente
- [x] La pastille passe à « bien envoyé » quand plus rien n'attend
- [x] L'état de synchro se comprend sans la couleur seule

## I — Audio

### I.1 — Une phrase se compose à partir de clips · **M** ✅
> Spec : CdC « Trois canaux redondants », « Points ouverts » (composition des nombres) · Zone : `apps/web/src/app/core/audio/` (et non `packages/domain` : dire une phrase n'est pas une règle métier, le serveur ne parle jamais — 2026-11-07)
> Dépend de : B.2 · Revue : fonction pure ; relire les phrases comme un locuteur les entendrait.
> Livrée le 2026-11-07, aucune dépendance ajoutée. `compose(parts, langue, clips enregistrés)` : une suite de morceaux — un clip, une phrase comptée (`deaths-today-3`, sinon la phrase composée, le nombre à la fin), un nombre, un poids — devient la suite des clips à jouer, ou la liste de ce qui manque. Les identifiants viennent du script : `tools/audio-script.mjs` lit `audio/script.md` et écrit `script-clips.ts` ; un écran qui demande une phrase absente du script ne compile pas. **Nombres en français** jusqu'à 999 999 avec les seuls clips de l'annexe (« soixante et onze », « quatre-vingt-un », « douze mille ») ; **en wolof, aucun nombre tant que la règle n'est pas fixée avec le locuteur** : une phrase à composer y est signalée, pas inventée.

- [x] Une phrase est une suite ordonnée d'identifiants de clips
- [x] Un nombre se décompose en clips selon la règle de la langue — le français ; le wolof attend son locuteur
- [x] « Tu as écrit 3 morts » et « 1 mort » s'accordent — chaque nombre de 1 à 20 a sa phrase entière, accordée à l'enregistrement
- [x] Une phrase dont un clip n'existe pas dans la langue est signalée, jamais tronquée en silence
- [x] **Phrase entière d'abord** (décision du 2026-11-07) : une phrase enregistrée d'un seul tenant est toujours préférée ; elle n'est composée de morceaux que si elle n'existe pas entière — toute phrase fixe est enregistrée entière, et les phrases fréquentes avec un petit nombre aussi (« 3 morts aujourd'hui », jusqu'à un seuil réglé à l'écoute avec le locuteur et les pilotes) ; au-delà (livraisons, poussins), la phrase se compose, le nombre placé en fin de phrase ou détaché, les clips enchaînés sans silence. Ajouter une phrase entière ne demande aucun code

### I.2 — Les clips se jouent hors-ligne · **M** ✅
> Spec : Archi §5 (précache des clips) ; `CLAUDE.md` §4 règle 11 · Zone : `apps/web/src/app/core/audio/`
> Dépend de : I.1, G.1 · Revue : aucune synthèse vocale dans le bundle de production.
> Livrée le 2026-11-07, aucune dépendance ajoutée. **Format tranché le 2026-11-07 : Opus mono, 24 kb/s, en WebM** (environ 6 Ko pour deux secondes). `tools/build-audio.mjs` convertit les enregistrements de `audio/<langue>/` (tout format courant ; silences coupés, volume égalisé ; **ffmpeg** sur l'ordinateur) vers `apps/web/public/audio/<langue>/`, avec `manifest.json` (clips enregistrés et version) ; un fichier dont le nom n'est pas dans le script est refusé. Le service worker garde `/audio/**` dès le premier chargement (groupe « audio ») ; à la connexion, `Voice` charge une fois tous les clips de la langue de la personne (sa langue ou celle de son site, E.9), puis plus jamais tant que la version ne change pas. Lecture par Web Audio : clips décodés et posés bout à bout sur l'horloge audio. Aujourd'hui aucun clip n'est enregistré : l'écran se tait, et dit ce qui manque.

- [x] Les clips de la langue de la personne connectée sont précachés (sa langue, ou à défaut celle de son site — E.9)
- [x] Une phrase se joue sans réseau, clips enchaînés sans trou audible — enchaînement par Web Audio ; **à écouter sur un vrai téléphone** dès les premiers clips
- [x] Une nouvelle phrase interrompt la précédente
- [x] La synthèse vocale du navigateur n'est jamais appelée en production — une règle du dépôt la cherche dans tout `apps/web/src`

### I.3 — Le script français couvre tout l'écran du gardien · **S** (script écrit)
> Spec : CdC « Points ouverts » (script des phrases) · Zone : `audio/fr/`
> Dépend de : I.1 · Revue : la liste des phrases, à lire à voix haute.

- [x] Chaque texte de l'écran du gardien a sa phrase dans le script — `audio/script.md`, écrit le 2026-11-07 d'après la maquette et le cahier des charges : environ 375 clips par langue, selon le principe « phrase entière d'abord » ; colonne wolof à remplir par le traducteur ; guide d'enregistrement en tête
- [x] Un test échoue si un écran référence une phrase absente du script — par le typage : `script-clips.ts` est tiré du script, et une règle du dépôt vérifie qu'il est à jour (2026-11-07). Trois phrases ajoutées pour l'écran d'entrée : code déjà choisi, numéro mal écrit, service indisponible (398 clips par langue)
- [ ] Les phrases du bureau s'ajoutent au script : questions de saisie, relectures d'argent, sens des dettes (« tu dois… à », « … te doit »), chiffres clés — le bureau parle aussi depuis le 2026-11-07
- [ ] Les clips wolof ⏸ attendent l'enregistrement d'un locuteur

## J — L'écran du cahier

### J.1 — Couverture et bandeau du jour · **M** ✅
> Spec : CdC « En-tête et contexte » ; `journal-gardien.html` (`.app-head`, `.strip-jour`) · Zone : `apps/web/src/app/caretaker/`
> Dépend de : H.5, F.3, G.2 · Revue : tout tient sans défiler à 360 px.
> Livrée le 2026-11-07 avec J.2 et J.3, aucune dépendance ajoutée (`apps/web/src/app/caretaker/notebook/`). Le contexte du gardien (F.3) gagne deux champs, par ajout : le fuseau du site (`timeZone`), pour que le téléphone sache quel jour il est sans réseau, et son titulaire (`primaryCaretakerId`). Le téléphone garde le dernier contexte reçu (`yaar.context`, au nom du compte qui l'a reçu : un autre compte connecté sur ce téléphone ne le voit pas — rien de financier n'y est) ; le jour J et les trois jours se recalculent sur son horloge et le fuseau du site, donc ils avancent hors-ligne. **Un seul site par gardien pour l'instant** (décision du 2026-11-07) : le cahier s'ouvre sur le premier. Au-delà de deux bandes, chacune s'appelle par son âge (« Jour 12 », décision du 2026-11-07). La jauge poussin → poule se remplit sur 42 jours, en attendant la durée propre à la souche (N.4). Deux jetons ajoutés : `--color-campaign-young`, `--color-campaign-old`. **La voix** (bande sans campagne, bannière du jour passé) **vient avec l'épique I**.

- [x] La couverture montre l'avatar, le nom du gardien et son site
- [x] Le bandeau montre le jour J, la jauge poussin → poule et les vivants
- [x] Tant qu'aucun poussin n'est reçu, le bandeau ne montre pas de vivants : ni zéro, ni nombre négatif (QA de C.5 — confirmé le 2026-11-07 : le serveur envoie « inconnu », le bandeau n'en montre rien)
- [x] Le badge du titulaire est visible — « Titulaire » sur la couverture ; à valider sur le terrain
- [x] Sans campagne en cours, l'écran le dit par picto et audio — haut-parleur sur le post-it (I, 2026-11-07)
- [x] Avec une seule campagne en cours, le cahier s'ouvre directement dessus : aucun choix n'est demandé (décision du 2026-11-07)
- [x] Avec plusieurs campagnes en cours sur le site, le gardien choisit la bande à chaque ouverture du cahier, en un tap sur de grandes cartes, puis en change par des intercalaires ; la confirmation de chaque déclaration redit la bande (décisions du 2026-11-07, `journal-gardien-entree.html`) ; il la choisit simplement (picto, couleur, audio) — deux bandes s'appellent « les petits » et « les grands », la plus jeune et la plus vieille (décision du 2026-11-07) ; au-delà de deux, leur âge —, sans pouvoir se tromper, et le cahier ouvert dit toujours sur quelle bande il écrit ; le choix ne coûte pas un tap de plus à chaque déclaration. Rien ne s'écrit avant le choix ; la bande choisie devient l'intercalaire actif et le bandeau la redit. La confirmation de chaque déclaration qui redit la bande vient avec K.
- [x] L'écran s'affiche hors-ligne avec le dernier contexte reçu

### J.2 — Trois jours et bannière du jour passé · **M** ✅
> Spec : CdC « Rattrapage » ; `journal-gardien.html` (`.jours`, `.banner-passe`) · Zone : `apps/web/src/app/caretaker/`
> Dépend de : J.1, C.6 · Revue : on ne peut pas écrire pour un jour passé sans le savoir.

> Le mini-résumé vient du domaine (`summarizeDay`, C.6), calculé sur le journal reçu du serveur et sur ce que l'outbox garde : il compte aussi ce qui n'est pas encore parti.

- [x] Aujourd'hui, hier et avant-hier sont visibles, chacun avec son mini-résumé
- [x] Un jour non déclaré et un jour à zéro déclaré ne se ressemblent pas — point d'interrogation pour un jour passé resté blanc, soleil pâle pour aujourd'hui pas encore écrit, tampon pour « rien perdu »
- [x] Choisir un jour passé affiche la bannière et la dit à voix haute — « Attention : tu écris pour hier » (I, 2026-11-07) ; choisir une bande dit son nom
- [x] Une déclaration faite sous la bannière porte la date métier du jour choisi — le cahier donne aux gestes (K) le site, la bande et le jour choisis (`declarationTarget`)

### J.3 — Le journal du jour · **M** ✅
> Spec : CdC « Journal du jour » ; `journal-gardien.html` (`.evt`) · Zone : `apps/web/src/app/caretaker/journal/`
> Dépend de : J.2, G.4 · Revue : le journal est visible avant toute saisie.

> Le journal effectif vient du domaine (`effectiveJournal`) : les lignes du serveur et celles du téléphone, la dernière écrite en haut ; un événement revenu du serveur ne compte qu'une fois. Une ligne annulée par l'admin reste visible, barrée, « annulée par le chef », et ne compte plus. Un refus du serveur n'est pas dans le journal : il se dira à part (G.5).

- [x] Chaque ligne montre le picto, la quantité et l'auteur
- [x] Une ligne en attente porte l'horloge ; une ligne envoyée porte le tampon — une ligne dont la correction attend encore attend aussi
- [x] Les déclarations des autres gardiens du site apparaissent
- [x] Une ligne corrigée montre sa valeur effective
- [x] Un journal vide le dit sans texte seul

## K — Les gestes de déclaration

### K.1 — Déclarer des morts en trois taps · **M** · 🧪 ✅
> Spec : CdC « Gestes du cahier » ; `journal-gardien.html` (compteur, confirmation) · Zone : `apps/web/src/app/caretaker/gestures/death/`
> Dépend de : J.3, H.4, I.2, G.3 · Revue : compter les taps ; le parcours entier marche hors-ligne.
> Livrée le 2026-11-08, aucune dépendance ajoutée. `DeathGesture` (`caretaker/gestures/death/`, devenu `DeclarationGesture` en K.2) : Mort → compteur (pile de poulets couchés) → « C'est tout » → relecture dite et écrite → Oui ; l'événement part par `JournalSync.record`, le tampon ne tombe qu'une fois l'outbox écrite, un double tap n'écrit qu'une fois, un téléphone qui ne peut plus garder la déclaration le dit (post-it et voix, pas de tampon). La relecture est `confirmationOf` (`deaths.ts`). **Décision du 2026-11-08, ajoutée au CdC** : le rappel dit **la somme seule** des morts déjà écrits ce jour-là dans la bande, par lui comme par les autres (`Notebook.deathsWritten`, tiré de `summarizeDay`), puis « tes morts, c'est en plus ? » à la place de « c'est bien ça ? » ; le script passe à 367 phrases (`already-written-*` remplace `already-written-by-you-*` et `-by-other-*`). Les vivants du bandeau (`liveCountOf`) : ceux du serveur, moins les morts du téléphone qu'il n'a pas encore comptés — signés, jamais bridés.
> **Non fait ici** : le téléphone ne revalide pas la déclaration par `validateDeclaration` avant de la garder — le jour et la bande viennent du cahier, toujours valables à l'ouverture du compteur ; un compteur ouvert avant minuit et validé après pour avant-hier serait refusé par le serveur et dit par G.5. Au-delà de 20, « Poulets morts : quarante-deux » ne dit pas le jour : la bannière violette le montre. **Pas regardé dans un navigateur** à 360 px : à faire avec le premier lot de clips.

- [x] Geste → quantité → Oui : trois taps pour déclarer
- [x] Les poulets couchés s'empilent à chaque unité ajoutée
- [x] La voix relit la déclaration avant le Oui
- [x] Si des morts sont déjà écrits ce jour-là, la voix en dit la somme avant le Oui : « Il y a déjà 5 morts écrits pour ce jour. Tes 2 morts, c'est en plus ? » (C.6, décision du 2026-11-08)
- [x] Non ferme la feuille sans rien écrire
- [x] Après le Oui : tampon, ligne dans le journal, vivants diminués, événement dans l'outbox
- [x] Une quantité supérieure aux vivants est acceptée comme une autre : le gardien n'est pas bloqué, c'est l'admin qui est alerté (C.5)

### K.2 — Déclarer un sac ouvert · **S** ✅
> Spec : CdC « On déclare des changements d'état physiques » · Zone : `apps/web/src/app/caretaker/gestures/bag/`
> Dépend de : K.1 · Revue : réutilise le parcours de K.1, sans le dupliquer.
> Livrée le 2026-11-08, aucune dépendance ajoutée. Le geste de K.1 devient `DeclarationGesture` (`caretaker/gestures/declaration-gesture.ts`), un seul parcours décrit par un `Gesture` : `DEATHS` (`death/deaths.ts`) et `BAGS` (`bag/bags.ts`) disent ce qui se dessine, se dit et s'écrit ; aucune ligne du parcours n'est copiée. Sac ouvert → compteur (pile de sacs ouverts) → « C'est tout » → « 2 sacs ouverts aujourd'hui. C'est bien ça ? » → Oui ; l'événement `BagOpened` part par l'outbox ; Non, double tap, tampon et panne de stockage se comportent comme pour les morts. Le script gagne `bags-many` (« Sacs ouverts : *nombre*. », au-delà de 20) et passe à 368 phrases.
> **Non fait ici** : le rappel des sacs déjà écrits ce jour-là, livré par K.3. Pas regardé dans un navigateur à 360 px.

- [x] Geste → quantité → Oui déclare des sacs ouverts
- [x] Les sacs s'empilent à l'écran d'après le picto du vrai sac
- [x] La déclaration ne change pas les vivants

### K.3 — Un autre a déjà déclaré · **S** · 🧪 ✅
> Spec : CdC « Garde-fous anti-doublon » · Zone : `apps/web/src/app/caretaker/gestures/`
> Dépend de : K.1, C.6 · Revue : la question est posée à voix haute, jamais bloquante.
> **Depuis la décision du 2026-11-08** (la somme seule, sans nommer l'auteur), les morts sont couverts par K.1 : reste à porter le même rappel aux **sacs ouverts**, avec ses phrases au script.
> Livrée le 2026-11-08, aucune dépendance ajoutée. La relecture devient commune aux deux gestes : `readBackOf` (`caretaker/gestures/gesture.ts`), décrite par un `ReadBack` par type (clips et mots) ; `Notebook.bagsWritten` fait pour les sacs ce que `deathsWritten` fait pour les morts (la somme de `summarizeDay`, outbox comprise). « Il y a déjà 3 sacs ouverts écrits pour ce jour. Tes 2 sacs, c'est en plus ? » ; Oui écrit, Non n'écrit rien ; des morts écrits ne déclenchent pas le rappel des sacs, ni l'inverse. Le script gagne 42 phrases (`bags-already-written-*`, `bags-in-addition-*` et leurs formes composées) et passe à 410.

- [x] ~~Si un autre a déclaré le même type aujourd'hui, la confirmation le nomme et dit sa quantité~~ remplacé par la décision du 2026-11-08 : si des sacs ouverts sont déjà écrits ce jour-là, par lui ou par un autre, la confirmation en dit **la somme seule**
- [x] La voix demande si la nouvelle quantité vient « en plus »
- [x] Oui ajoute la déclaration ; Non l'abandonne
- [x] Sans déclaration préalable du même type ce jour-là, ni d'un autre ni de soi, la confirmation reste simple

### K.4 — « Rien perdu hier » · **S** · 🧪 ✅
> Spec : CdC « Rappel d'oubli », « Le zéro est une déclaration » · Zone : `apps/web/src/app/caretaker/reminder/`
> Dépend de : K.1, J.2 · Revue : le zéro crée bien un événement.
> Livrée le 2026-11-08, aucune dépendance ajoutée. `NothingLostReminder` (`caretaker/reminder/`) : le post-it, sur la page d'aujourd'hui, tant que `Notebook.forgottenYesterday` dit que les morts d'hier ne sont pas écrits (`summarizeDay` : `NotDeclared`, outbox comprise). « Rien perdu hier » écrit en un tap un `NoLoss` daté d'hier, à l'heure du téléphone, par l'outbox ; tampon et « C'est noté : hier, rien de perdu » une fois gardé ; double tap : un seul zéro ; panne de stockage : post-it et voix, le rappel reste. « Écrire pour hier » ouvre le cahier sur hier (bannière violette, voix). **Décision du 2026-11-08, ajoutée au CdC** : le rappel suit **les morts** d'hier, pas « hier vide » comme la maquette — un sac écrit hier ne le cache pas ; `nothing-lost-reminder` est reformulée (« Pour hier, les morts ne sont pas écrits… »). Pas de rappel pour une bande mise en place aujourd'hui.
> **Non fait ici** : pas de relecture avant le zéro — le CdC le veut d'un tap ; un zéro écrit par erreur se corrige par l'admin (annulation, C.7). Le refus « des morts sont déjà écrits » (`nothing-lost-refused`) ne peut venir que du serveur, quand un autre a écrit des morts que le téléphone n'avait pas encore reçus : il sera dit par G.5. Avant-hier n'a pas de rappel (le CdC ne parle que d'hier). Pas regardé dans un navigateur à 360 px.

- [x] Si les morts d'hier ne sont pas écrits (ni mort, ni « rien perdu » ; un sac ne compte pas : décision du 2026-11-08), le rappel apparaît
- [x] « Rien perdu hier » crée en un tap un événement daté d'hier
- [x] « Écrire pour hier » ouvre la saisie sur le jour d'hier
- [x] Le rappel disparaît dès qu'hier est déclaré

### K.5 — Corriger une déclaration · **M** · 🎨 · 🧪 ✅
> Spec : CdC « Corrections » · Zone : `apps/web/src/app/caretaker/journal/correction/`
> Dépend de : J.3, C.4, G.4 · Revue : l'interface n'offre jamais d'effacer, et ne met jamais une correction en file d'attente.
> 🎨 La maquette `journal-gardien.html` donne le crayon sur une ligne « bien envoyé » et remet la correction en attente : à reprendre d'après la décision du 2026-11-06 (correction en ligne), avec l'état « crayon indisponible sans réseau ».
> Livrée le 2026-11-08, aucune dépendance ajoutée. Le crayon de chaque ligne de mort ou de sac (`LinePencil` dans `linesOf`) : **libre** tant que la déclaration n'a jamais quitté le téléphone — `JournalSync.amend` change sa quantité dans l'outbox, même identifiant, mêmes dates ; **verrouillé** pendant un envoi en doute — il le dit (`correct-wait-sending`) ; **en ligne** une fois envoyée — `JournalSync.correct` envoie la contre-déclaration tout de suite, hors de l'outbox, puis le cahier relit le contexte. Sans réseau, le crayon d'une ligne envoyée montre le nuage et le dit (`correct-needs-network`) ; un serveur muet aussi ; un refus « trois jours passés » dit `correct-too-old`, tout autre refus `correct-refused` (2 phrases ajoutées, script à 412). Les feuilles compteur → relecture → Oui sortent de `DeclarationGesture` en `CountSheets`, partagées par le geste et la correction. **Trouvé en route** : la synchro tentait d'envoyer même sans réseau, donc toute déclaration écrite hors-ligne passait « en doute » à l'instant et ne se corrigeait plus ; le téléphone ne tente plus rien quand il se sait hors-ligne (`navigator.onLine`, architecture §1 « Corrections en ligne »).
> **Non fait ici** : la ligne corrigée montre sa valeur effective et « corrigé », pas l'ancienne valeur — le contexte du gardien ne l'envoie pas. Le dernier point de la liste est **sans objet** : le gardien n'écrit plus de correction hors-ligne, il n'y a donc jamais de correction sur le téléphone à départager d'une correction du serveur. Une session expirée pendant la correction est dite comme un refus, sans proposer de se reconnecter. Après un refus, le cahier est relu comme après une acceptation (ajouté le 2026-11-08) : une ligne annulée entre-temps par le chef apparaît barrée, sans crayon. Un serveur qui a reçu la correction sans que la réponse arrive : le gardien recommence, la seconde correction porte la même valeur, la dernière écrite fait foi — rien ne change. Pas regardé dans un navigateur à 360 px. **Test instable, trouvé le 2026-11-08** (lancement complet, machine chargée) : « une déclaration jamais partie se corrige… » touchait le crayon avant que le cahier ait relu l'outbox ; il attend maintenant le crayon. Défaut du test, pas du code ; s'il retombe, regarder d'abord le temps de relecture de l'outbox.

- [x] Tant que la déclaration n'a jamais quitté le téléphone, le crayon la modifie librement, sans réseau
- [x] Si un envoi est en doute, la ligne est verrouillée jusqu'à la réponse du serveur
- [x] Après l'envoi, le crayon crée une contre-déclaration, envoyée tout de suite : elle ne passe pas par l'outbox
- [x] Sans réseau, le crayon d'une ligne déjà envoyée est indisponible, et il le dit par picto et audio
- [x] Le crayon n'apparaît que sur les trois jours du cahier ; un refus du serveur (trois jours passés, campagne clôturée) est dit au gardien par picto et audio
- [x] Seules les valeurs mesurées se corrigent (quantité, poids, papier du livreur), jamais en dessous de 1 ; aucun geste n'annule une déclaration
- [x] La ligne d'origine reste visible, avec sa correction (sa valeur effective et « corrigé » ; l'ancienne valeur n'est pas montrée)
- [x] Les vivants suivent la valeur corrigée
- [x] ~~Le contexte du gardien donne la date de saisie de la dernière correction~~ sans objet depuis la correction en ligne : voir la note d'une ligne (J.3 ne reçoit que la valeur effective) : sans elle, une correction écrite hors-ligne plus tôt passerait, sur le téléphone, devant une correction plus récente reçue du serveur
- [x] Aucun geste ne supprime une ligne du journal

### K.6 — La photo des morts · **M** · 🎨 · 🧪
> Spec : CdC « Photo des morts » · Zone : `apps/web/src/app/caretaker/gestures/death/`, `packages/domain/src/journal/` (champ facultatif du fait `Death`, ajouté sans rien changer au sens des autres)
> Dépend de : M.3 · Revue : jamais bloquante ; la règle des trois taps tient sans photo.

- [ ] La relecture des morts offre deux Oui : « Oui, je montre » ouvre l'appareil photo, « Oui, pas de photo » écrit tout de suite (maquette d'abord)
- [ ] La déclaration porte sa réponse : photographiée (avec l'empreinte du média) ou pas de photo ; sans réponse (ancienne version, admin), elle n'est pas comptée comme « pas de photo »
- [ ] La photo part avec la déclaration, ou après elle quand le réseau revient : la déclaration n'attend jamais la photo
- [ ] Appareil photo refusé ou en panne : la déclaration s'écrit « pas de photo », et l'écran le dit
- [ ] Le bureau voit la part des morts photographiés, par gardien
- [ ] Une consigne de prise de vue est dite quand l'appareil s'ouvre, pour des photos utiles à l'entraînement (par exemple « les morts posés au sol, entiers, à la lumière ») — texte et phrase du script à trancher avec le fondateur avant de coder

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
> Spec : CdC « En-tête et contexte » (météo, glace dans l'eau), « Points ouverts » (Tâches par élevage) · Zone : `apps/api/src/sites/weather/`, `apps/web/src/app/caretaker/weather/`
> Dépend de : L.2 · Revue : la source météo est derrière un port.

- [ ] La météo du jour s'affiche avec un conseil vocal
- [ ] Au-delà de 32 °C prévus pour le jour (ressenti compris quand la source le donne), la tâche « glace dans l'eau » s'ajoute aux tâches du jour (décision du 2026-11-08 ; la maquette, qui lie le bicarbonate à la chaleur, est dépassée sur ce point)
- [ ] Sans réseau, la dernière météo connue s'affiche, datée
- [ ] Une source météo indisponible n'empêche aucune déclaration

## M — Prévenir le chef

### M.1 — Un média se dépose par son empreinte · **M** · 🔒 ✅
> Spec : Archi §7 · Zone : `apps/api/src/media/` (port de stockage, volume local)
> Dépend de : F.2 · Revue : type vérifié sur le contenu ; lecture autorisée via l'événement.

> Livrée le 2026-11-11, aucune dépendance ajoutée, reprise de build-track (`DocumentStore` → `MediaStore`, provenance en tête du fichier). Règles écrites d'abord dans l'architecture (§7 « Le dépôt »). `PUT /api/v1/media/:empreinte?retention=…` (toute session) : le corps est le fichier, lu en flux ; **l'empreinte annoncée est recalculée sur les octets** (sinon 400) ; seules les images JPEG, PNG, WebP passent, reconnues à leurs premiers octets (sinon 415) ; 2 Mo au plus (413) ; le même fichier renvoyé répond 200 sans rien écrire. Volume `medias` (`MEDIA_PATH`, exigé et absolu au démarrage ; dossier créé au nom de `node` dans l'image), rangé par élevage puis par empreinte. Table `media` (lecture et ajout seulement, RLS forcée) : classe de rétention, qui, quand, depuis quel appareil — la ligne est la trace. `GET /api/v1/media/:empreinte` : **admin seul**, et seulement si un événement du journal de l'élevage cite le média (photo, ou papier d'une réception) ; pièce jointe, `nosniff`, CSP `sandbox`, jamais en cache.
> **Écarts** : les sons sont refusés jusqu'aux vocaux (M.4, V2) ; le gardien ne relit aucun média (fail-closed : rien ne le demande, un PV peut porter des prix) ; un dépôt n'a pas de ligne d'audit en plus de sa propre ligne.

- [x] Un fichier déposé est adressé par son empreinte SHA-256
- [x] Le même fichier déposé deux fois n'est stocké qu'une fois
- [x] Un fichier dont le contenu n'est ni une image ni un son attendu est refusé (les sons attendront M.4 : refusés d'ici là)
- [x] Un fichier trop lourd est refusé
- [x] Un média ne se lit que par un utilisateur du tenant de l'événement qui le référence
- [x] Chaque média porte sa classe de rétention (preuve opérationnelle ou pièce justificative)

### M.2 — Les médias attendent le réseau · **M** · 🧪 ✅
> Spec : Archi §5 « Médias hors-ligne » · Zone : `apps/web/src/app/core/outbox/media/`
> Dépend de : M.1, G.4 · Revue : l'événement part même si le média échoue.

> Livrée le 2026-11-11, aucune dépendance ajoutée. Règles écrites d'abord dans l'architecture (§5 « La file des médias »). `MediaQueue` (`core/outbox/media-queue.ts`), base IndexedDB `yaar-media` à part de l'outbox : un média gardé **avant tout envoi**, sous l'empreinte SHA-256 calculée sur le téléphone, avec son auteur et sa classe ; la même photo gardée deux fois prend sa place une fois. `synchronizeMedia` : après les déclarations, et seulement si elles sont parties ; un à un, sous le compte de l'auteur ; reçu (201, ou 200 « déjà là ») → **effacé du téléphone** ; sans réponse → gardé, repris plus tard ; refusé (400, 413, 415) → gardé, marqué refusé, jamais renvoyé. **Borne de 30 Mo** : au-delà, une nouvelle photo n'est pas gardée (`MediaQueueFull`) et le geste le dit. `JournalSync.keepMedia` et le signal `mediaWaiting`, que le journal du jour lit.

- [x] Une photo prise hors-ligne est mise en file avec son événement
- [x] L'événement part sans attendre le média et le référence par empreinte
- [x] Un envoi de média échoué est repris
- [x] Le journal montre qu'un média n'est pas encore parti
- [x] Un média bien reçu par le serveur s'efface du téléphone : photos et vocaux pèsent des centaines de kilo-octets chacun, c'est là que la mémoire d'un téléphone d'entrée de gamme se remplit (ajouté le 2026-11-07) ; un média pas encore parti ne s'efface jamais
- [x] Le stockage pris par les médias en attente est borné, et un dépassement est dit au gardien plutôt que de perdre un média

### M.3 — Envoyer une photo au chef · **M** ✅ (à regarder sur un vrai téléphone)
> Spec : CdC « Prévenir le chef » ; `journal-gardien.html` (`.viseur`) · Zone : `apps/web/src/app/caretaker/gestures/photo/`
> Dépend de : M.2, K.1 · Revue : la compression se fait sur le téléphone.

> Livrée le 2026-11-11, aucune dépendance ajoutée. Règles écrites d'abord au CdC (« La photo au chef »). `PhotoGesture` à côté de « Parler », dès qu'une bande est en cours : l'appareil photo **du téléphone** (`<input capture>`, rien à installer), la voix dit quoi faire ; la photo apparaît dans le viseur, **réduite sur le téléphone** à 800 px de grand côté en JPEG (`REDUCE_PHOTO`) ; Oui la garde dans la file des médias puis écrit l'événement `Photo` au cahier de la bande et du jour choisis ; la voix dit « C'est noté. Le chef verra ta photo. » (le script disait « C'est envoyé », faux sans réseau : changé). Le journal du jour dit « photo pas encore partie » et garde l'horloge tant que l'image attend. Photo illisible : post-it au picto de l'appareil et la voix ; file pleine : post-it et voix. Trois phrases ajoutées au script (`photo-camera-refused`, `photo-phone-full`, et `photo-sent` réécrite).
> **À vérifier sur un vrai téléphone** : l'appareil photo d'Android ajoute souvent son propre bouton de validation — quatre gestes au lieu de trois ; l'aperçu dans l'application (getUserMedia) les ramènerait à trois, au prix d'un écran de plus à maintenir. À trancher à l'observation.

- [x] Le gardien prend une photo et la confirme par Oui
- [x] La photo est réduite à environ 800 px avant la mise en file
- [x] Si l'appareil photo est refusé, l'écran l'explique sans texte seul (photo illisible ; le refus de permission se joue dans l'appareil photo du téléphone : à vérifier sur un vrai téléphone)
- [x] La photo apparaît dans le journal du jour

### M.4 — ⏸ Envoyer un message vocal · **M** · V2
> Spec : CdC « Prévenir le chef » ; `journal-gardien.html` (`.btn-micro`) · Zone : `apps/web/src/app/caretaker/gestures/voice/`
> Dépend de : M.2, K.1 · Revue : durée plafonnée ; pulsation en `transform`.
> **Sortie de la V1 le 2026-11-08** : en V1, le gardien parle au chef par WhatsApp (M.5).

- [ ] Un tap démarre l'enregistrement, un tap l'arrête
- [ ] L'enregistrement s'arrête seul à 90 secondes
- [ ] Le gardien réécoute avant d'envoyer
- [ ] Si le micro est refusé, l'écran l'explique sans texte seul

### M.5 — Parler au chef par WhatsApp · **S** ✅
> Spec : CdC « Parler au chef passe par WhatsApp » · Zone : `apps/web/src/app/caretaker/gestures/talk/`, contexte du gardien (`apps/api/src/journal/caretaker-context.ts`)
> Dépend de : J.1 · Revue : le numéro vient du serveur ; rien d'autre de l'admin n'arrive au téléphone.
> Livrée le 2026-11-08, aucune dépendance ajoutée. Le contexte du gardien porte `chef` (`CaretakerChef` : nom et numéro, rien d'autre) — l'admin le plus ancien qui n'est pas bloqué, `null` sans admin. « Parler » (`TalkToChef`, section « Prévenir le chef », visible dès qu'il y a un site, même sans bande) ouvre `https://wa.me/<chiffres du numéro>` ; sans chef, post-it et voix (`talk-no-chef`, script à 414). **Corrigé en route** : pas de texte pré-rempli — il resterait en brouillon (CdC mis à jour).
> **Non fait ici** : choisir un autre admin que le plus ancien (réglages de l'élevage) ; le lien n'a pas été ouvert sur un vrai téléphone, avec ou sans réseau.

- [x] Le contexte du gardien donne le nom et le numéro de l'admin à joindre : le plus ancien qui n'est pas bloqué, et rien d'autre de lui
- [x] Le geste « Parler » ouvre la conversation WhatsApp avec ce numéro, sans texte pré-rempli (il resterait en brouillon)
- [x] Sans admin à joindre, l'écran le dit par picto et voix ; sans WhatsApp, c'est la page de WhatsApp qui le dit (une application web ne peut pas savoir ce qui est installé)
- [ ] Vérifié sur un vrai téléphone : le lien ouvre WhatsApp même sans réseau

---

# LOT 3 — Le bureau de l'admin

## N — Référentiels

### N.1 — Le socle de l'éditeur · **M** ✅
> Spec : CdC « Référentiels à deux niveaux » · Zone : `apps/api/src/reference-data/` (données d'amorçage, lecture)
> Dépend de : D.4 · Revue : la liste du socle et ses drapeaux, face au cahier des charges.

> Livrée le 2026-11-09, aucune dépendance ajoutée, aucune table. **Décision du 2026-11-09, ajoutée au CdC** : le socle est écrit dans le code (`COST_CATEGORIES`, `packages/domain/src/finance/cost-category.ts`), gelé, le même pour chaque élevage dès sa création ; aucune route ne l'écrit ni ne le supprime. Douze catégories : **Literie** (copeaux) ajoutée par le fondateur, variable et commandable ; **Transformation** (après l'abattage : déplumage, congélation), variable, non commandable ; drapeaux fixe / variable tranchés le 2026-11-08 (tableau du CdC). `GET /api/v1/reference-data` (admin seul, `ReferenceData`) rend les catégories et les types de pertes : morts, puis `LOSS_TYPES`. **Le vol entre au journal** (`Theft`, par ajout, décision du 2026-11-08) : admin seul (`LossByAdminOnly`), diminue les vivants, ne compte pas parmi les morts, n'entre pas dans le résumé du gardien ; le décodeur de l'API lit la liste du domaine au lieu de la recopier.
> **Non fait ici** : l'écran (N.6) et ses libellés français ; les types propres à l'élevage (N.2), qui se rattacheront au code d'une catégorie ; aucune saisie de vol au bureau avant O.4.

- [x] Les douze catégories du socle existent dès la création du tenant (Literie ajoutée le 2026-11-08, Transformation le 2026-11-09)
- [x] Chaque catégorie porte son drapeau fixe ou variable (tableau du CdC, décision du 2026-11-08)
- [x] Aliments, Poussins, Santé et Literie sont commandables ; les autres ne le sont pas
- [x] Une catégorie du socle ne se supprime pas
- [x] Les types de pertes du socle existent : morts, manquants, dons, vols — le vol s'écrit au journal (`Theft`, par ajout ; admin seul, diminue les vivants, ne compte pas parmi les morts : décision du 2026-11-08)
- [x] Le socle ne se lit qu'au bureau : un collaborateur est refusé

### N.2 — Les types propres à l'élevage · **M** ✅
> Spec : CdC « Référentiels à deux niveaux » · Zone : `apps/api/src/reference-data/`
> Dépend de : N.1 · Revue : on archive, on ne supprime jamais.

> Livrée le 2026-11-09, aucune dépendance ajoutée, côté serveur. Table `cost_types` (catégorie du socle, nom, fixe/variable, `archived_at`), RLS forcée, **sans droit DELETE**. Routes admin : `GET /api/v1/cost-types` (dans l'ordre du socle, puis par nom ; commandable lu dans le socle, jamais stocké ; archivés marqués), `POST` (catégorie obligatoire, fixe/variable repris de la catégorie s'il n'est pas choisi), `PATCH /:id` (nom, fixe/variable — jamais la catégorie ni « commandable »), `POST /:id/archive`. Audit `CostTypeCreated`, `CostTypeConfigured`, `CostTypeArchived`. **Déplumage et Congélation** (`DEFAULT_COST_TYPES`, sous Transformation) sont écrits par l'amorçage de l'élevage, dans la même transaction. Décisions du 2026-11-09, prises sur le patron des tiers et annoncées au fondateur : jamais de suppression, catégorie fixe, drapeaux repris de la catégorie.
> **Non fait ici** : l'écran (N.6) ; désarchiver ; deux types de même nom ne sont pas refusés ; un élevage amorcé avant N.2 n'a pas ses types d'office (aucun n'est déployé).

- [x] L'admin ajoute un type rattaché à une catégorie du socle
- [x] Déplumage et Congélation, rattachés à Transformation, sont en place d'office dans chaque élevage (décision du 2026-11-09 — remplacée le jour même par la liste précochée, ci-dessous)
- [x] Un élevage naît avec une liste de types précochés, un par catégorie du socle, et Déplumage et Congélation décochés (archivés) — décision du fondateur, 2026-11-09
- [x] Un type sans catégorie du socle est refusé
- [x] Renommer un type ne change que son étiquette ; les écritures passées le suivent
- [x] Un type s'archive et ne se supprime jamais, même inutilisé (décision du 2026-11-09, comme pour les tiers)
- [x] Un type archivé n'est plus proposé à la saisie mais reste lisible dans l'historique
- [x] Sa catégorie ne change pas ; il reprend le drapeau fixe/variable de sa catégorie, modifiable ; il est commandable si sa catégorie l'est (décisions du 2026-11-09)

### N.3 — Les tiers · **S** ✅
> Spec : CdC « Qui doit quoi » · Zone : `apps/api/src/counterparties/`
> Dépend de : D.2 · Revue : un tiers est un fournisseur, un client ou un collaborateur.

> Livrée le 2026-11-09, aucune dépendance ajoutée, côté serveur. Table `counterparties` (sorte `Supplier` / `Customer` / `Collaborator`, nom, visage, `archived_at`), RLS forcée, **sans droit DELETE** : un tiers ne se supprime jamais, même sans écriture (décision du 2026-11-09). Les deux listes fermées sont dans le domaine (`COUNTERPARTY_KINDS`, `COUNTERPARTY_FACES` : neuf pictos d'objets réels, le papier pour « autre »). Routes admin : `GET /api/v1/counterparties` (par nom, les archivés marqués), `POST` (créer), `PATCH /:id` (nom, visage — jamais la sorte), `POST /:id/archive` (une seule trace même demandé deux fois). Audit `CounterpartyCreated`, `CounterpartyConfigured` (champs changés), `CounterpartyArchived`. **Pas de photo en V1** (décision du fondateur : le picto suffit, et des photos de personnes posent la question des données personnelles).
> **Non fait ici** : l'écran (il viendra avec l'éditeur de commande, Q.5, ou « Qui doit quoi », R.3) ; le nom à la voix (N.3b, après M.1) ; désarchiver un tiers ; deux tiers de même nom ne sont pas refusés.

- [x] L'admin crée un fournisseur, un client ou un collaborateur comme tiers ; sa sorte ne change plus ensuite
- [x] Un tiers s'archive et ne se supprime jamais, même sans écriture (décision du 2026-11-09)
- [x] Un tiers n'est visible que dans son tenant, et seulement au bureau
- [x] À sa création, l'admin lui donne un visage : un picto d'une liste fermée (décision du 2026-11-09) ; il peut ensuite changer son nom et son visage, et chaque changement est tracé
- [ ] → N.3b : le nom au micro (deux secondes), après M.1 (décision du 2026-11-07, découpée le 2026-11-09). Pas de photo en V1 (décision du 2026-11-09 : le picto suffit, et des photos de personnes posent la question des données personnelles)

### N.3b — Le nom d'un tiers, à la voix · **S**
> Spec : CdC « Qui doit quoi » (le tiers, décision du 2026-11-07) · Zone : `apps/api/src/counterparties/`, `apps/web/src/app/admin/`
> Dépend de : N.3, M.1 · Revue : la voix et l'écran désignent le tiers sans lire.

- [ ] À la création, l'admin enregistre le nom du tiers au micro (deux secondes)
- [ ] Partout où le tiers se choisit, son nom se fait entendre

### N.4 — Les souches et la table Cobb 500 · **M**
> Spec : CdC « Référentiels » (souches), « Points ouverts » (table Cobb) · Zone : `apps/api/src/reference-data/strains/`, `packages/domain/src/journal/strain.ts`
> Dépend de : N.1 · Revue : vérifier quelques valeurs de la table contre la source.

> Livrée en partie le 2026-11-09, aucune dépendance ajoutée, aucune table. `STRAINS` (`packages/domain/src/journal/strain.ts`) : la Cobb 500, poulet de chair, transcrite du guide « Cobb 500 Performances et Recommandations Nutritionnelles » (colonne tout-venant, photo fournie par le fondateur) : J0 à J49, poids cible, consommation journalière et cumulée par poulet, indice de consommation du guide. `targetAt(souche, jour)` rend la ligne, ou `null` hors de la table ; les cases vides du guide restent `null`. La transcription se recoupe dans le test : cumul = veille + journalière à 1 g près, indice ≈ cumul ÷ poids au demi-centième ; une faute de frappe sur un nombre fait tomber un test. Le bureau lit la liste des souches dans `GET /api/v1/reference-data` (`strains`) ; la courbe reste au serveur jusqu'au Suivi (V). La jauge du cahier reste sur 42 jours : le guide ne donne pas de durée de bande.
> **Non fait ici** : **le protocole sanitaire par défaut** — absent de la page fournie ; il attend le plan de vaccination du fondateur et le référentiel des tâches (L.1). La version du guide (année) n'est pas lisible sur la photo.

- [x] La souche Cobb 500 porte son poids cible par âge, de J0 à J49
- [x] Elle porte sa consommation journalière et cumulée par âge
- [ ] Elle porte son protocole sanitaire par défaut — en attente du fondateur
- [x] L'espèce est un attribut de la souche, pas du journal
- [x] Un âge hors de la table renvoie une valeur absente, jamais zéro

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
- [ ] Il coche ou décoche un type de la liste de départ (décocher = archiver, cocher = désarchiver)
- [ ] Un type du socle n'offre pas d'action de suppression
- [ ] Les routes des référentiels sont inaccessibles à un collaborateur

## O — Sites, campagnes et coquille du bureau

### O.1 — Configurer un site · **M** ✅
> Spec : CdC « Onboarding assisté » (configuration du site) · Zone : `apps/api/src/sites/`
> Dépend de : E.5 · Revue : le mode strict est désactivé par défaut ; c'est un choix de l'admin.
> Livrée le 2026-11-08, aucune dépendance ajoutée. `POST /api/v1/sites` (`createSite`) : identifiant fourni par l'appelant, nom (1 à 60 caractères), fuseau IANA vérifié par le domaine, voix par défaut facultative ; l'élevage vient de la session ; mode strict désactivé ; identifiant déjà pris : 409 sans rien toucher. `PATCH /api/v1/sites/:siteId` (`configureSite`) : nom, voix par défaut (ou `null` : chacun la sienne), mode strict ; **le fuseau ne se change jamais** (les jours métier du journal déjà écrit en dépendent) ; un réglage qui ne change rien ne laisse pas de trace. Audit : `SiteCreated`, `SiteConfigured` avec la liste des champs changés ; le sujet d'une trace de site est le site. Admin seul ; le site d'un autre élevage n'existe pas (404).
> **Non fait ici** : le protocole sanitaire du site — son référentiel n'existe pas encore (N.4, L.1), il se rattachera avec lui ; l'écran « Sites et équipe » du bureau (sous « Plus », à faire avec les écrans de réglages).

- [x] L'admin crée un site
- [x] Il choisit la langue audio par défaut du site : celle d'un compte qui n'en a pas choisi (la langue suit la personne, E.9)
- [ ] Il attache un protocole sanitaire au site — reporté : le référentiel des protocoles vient avec N.4 et L.1
- [x] Il active ou désactive le mode strict ; par défaut il est désactivé
- [x] La modification d'une configuration de site est tracée dans l'audit

### O.2 — Ouvrir une campagne · **M** ✅
> Spec : CdC « Hiérarchie », « Référentiels » (souche), « Ouvrir une bande » · Zone : `apps/api/src/campaigns/`, `packages/domain/src/journal/campaign.ts`, `apps/web/src/app/admin/lots/`
> Dépend de : O.1, N.4 · Revue : ce qui rend une campagne « en cours ».

> Livrée le 2026-11-09, aucune dépendance ajoutée. La règle est dans le domaine, une seule fois : `validateCampaignOpening` (souche du référentiel, effectif prévu ≥ 1, mise en place ni future ni de plus de 60 jours au jour du site, durée prévue de 1 à 60 jours entiers) ; quatre motifs ajoutés à la liste fermée (`UnknownStrain`, `PlacementInFuture`, `PlacementTooOld`, `InvalidPlannedDuration`). La table `campaigns` gagne `strain`, `planned_headcount` et `planned_duration`, obligatoires (migration unique régénérée) ; audit `CampaignOpened`, le sujet est la bande. `POST /api/v1/campaigns` (admin seul, liste blanche de six champs : ni élevage, ni clôture) juge au jour du fuseau du site ; une bande « en cours » est une bande sans clôture : elle rejoint aussitôt le cahier du gardien, à J0 et sans vivants inventés. Au bureau, Lots → « Ouvrir une bande » (`OpenCampaignPage`) : le seul site, la souche Cobb 500, la date du jour du site et 45 jours sont préremplis (demande du fondateur) ; avec deux sites, aucun n'est choisi d'avance ; le calendrier borne la date ; le formulaire juge avec la règle du domaine avant d'envoyer, dit chaque refus en mots, et sans réseau dit que la bande n'est pas ouverte ; ouverte, le bureau relit ses lots et revient à Lots. Formulaire en signaux : `@angular/forms` n'est pas installé, et cinq champs ne justifient pas une dépendance. Paquet du bureau : 4,8 Ko compressés ; le code de départ ne bouge pas.
> **Trouvé dans le navigateur, le 2026-11-09** : le lien « Ouvrir une bande » et le retour à Lots étaient écrits depuis la racine (`/lots/ouvrir`), alors que le bureau vit sous `/admin` : le clic ramenait à l'accueil, sans rien dire. Les tests montaient le bureau à la racine et ne pouvaient pas le voir ; ils le montent désormais sous `/admin`, et les liens sont relatifs. Vérifié ensuite dans le navigateur, à 360 px : la bande s'ouvre et apparaît dans Lots.
> **Redessiné le 2026-11-09, à la demande du fondateur** (« une app pro, le design doit être parfait ») : plus de liste déroulante. Le site et la souche se choisissent sur des **tuiles à picto** (grange, poussin ; la tuile choisie est verte et cochée), comme les tuiles de la maquette v2 ; l'effectif s'écrit **en gros chiffres sur une ligne de cahier**, collé à « poussins » ; la durée se règle par **− et +** autour de 45 jours ; « Ouvrir la bande » est un gros bouton vert à coche, **fixé au-dessus de la barre des cinq** (la coquille donne sa hauteur, `--office-tabs-block-size`). Regardé à 360 px dans le navigateur.
> **Non fait ici** : fermer une bande (clôture, plus tard) ; la jauge du cahier suit encore 42 jours, pas la durée prévue ; la courbe de la souche n'est montrée nulle part avant le Suivi (V) ; pas de picto ni d'écoute sur les champs du formulaire (l'admin lit — à revoir si un gérant client lit mal).

- [x] L'admin ouvre une campagne sur un site : souche, effectif, date de mise en place, durée prévue (décision du 2026-11-09)
- [x] Une campagne référence sa souche et en hérite la courbe cible
- [x] Une campagne sans effectif ou sans date est refusée
- [x] Une mise en place dans le futur, ou de plus de 60 jours, est refusée ; une durée prévue hors de 1 à 60 jours aussi
- [x] Au bureau, le formulaire préremplit la souche (Cobb 500), la date (aujourd'hui) et la durée (45 jours) — demande du fondateur, 2026-11-09
- [x] La campagne ouverte rejoint le contexte du gardien du site, à côté des autres campagnes en cours sur ce site (plusieurs à la fois : décision du 2026-11-07)

### O.3 — La coquille du bureau · **M** ✅
> Spec : CdC « Architecture du bureau » ; `bureau-admin-v2.html` (validée le 2026-11-08) · Zone : `apps/web/src/app/admin/`
> Dépend de : G.2, H.3 · Revue : les routes admin ne sont pas dans le bundle du gardien.
> Livrée le 2026-11-08, aucune dépendance ajoutée. **Décision du 2026-11-08** : la v2 du bureau est validée, le CdC le dit. `OfficeShell` : en-tête kraft « Le bureau de … », la page, la barre de cinq en bas (Accueil `bell`, Lots `barn`, Achats `truck`, Tiers `coin`, Plus `paper` — trois pictos repris de la v2, recuits ; le test du design system accepte désormais les pictos du bureau que l'application utilise). `Office` lit les sites et les lots en cours (pour l'instant le contexte du cahier, que l'admin reçoit pour tout l'élevage et qui ne porte aucun montant), garde la dernière lecture avec sa date pour son seul compte ; hors-ligne, « Pas de réseau : chiffres lus le 5 nov. à 17:30 ». Accueil : les lots, puis « À traiter » (vide, il le dit). Lots : site, jour, vivants ou « pas encore connus ». Plus : « Sites et équipe » (O.1). Achats et Tiers disent qu'ils arrivent (Q, R). Le bureau a son paquet à part : 3 Ko compressés.
> **Non fait ici** : le bouton « Écrire » (avec la première saisie, P.4) ; ouvrir un lot et ses intercalaires (O.4) ; le contenu d'« À traiter » (O.4, U). Le code de départ de l'application a pris 3 Ko compressés (75,8 Ko). Pas regardé dans un navigateur.

- [x] La barre du bas de `bureau-admin-v2.html` (**validée le 2026-11-08**) : Accueil, Lots, Achats, Tiers, Plus, chacun avec son picto d'objet réel et son mot ; conçu au téléphone d'abord ; aucune espèce en dur
- [x] L'accueil et Lots montrent les lots en cours (site, jour de la bande, vivants), lus sur le serveur ; ce qui est à traiter vient avec O.4 et U
- [ ] ~~Le sélecteur de site change le contexte de tous les onglets~~ remplacé par la v2 : un lot porte son site
- [x] Hors-ligne, le bureau montre la dernière lecture et sa date
- [ ] ~~Hors-ligne, un coût, un paiement, une vente ou une déclaration partent en file d'attente~~ : porté par P.7, avec le bouton « Écrire »
- [x] Un collaborateur ne peut ouvrir aucune route du bureau (garde `canEnter('admin')`, testé depuis G.2)

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
- [ ] Les déclarations refusées du registre (G.5) s'affichent, et l'admin en réécrit une en un tap pour son jour d'origine, « pour le compte de » son auteur

## P — Coûts

> **Écritures d'argent (décision du 2026-11-06)** — vaut pour les épopées P, Q, R, S et W : une écriture (coût, paiement, règlement, vente) est ajoutée et jamais modifiée, porte un identifiant créé sur l'appareil, et son enregistrement est idempotent. Une correction est une contre-écriture (P.2). C'est ce qui permet à l'admin de saisir sans réseau (P.7).

### P.1 — Un coût et l'engagé à date · **M** · 🧪 ✅
> Spec : CdC « Argent » · Zone : `packages/domain/src/finance/{cost,committed-cost}.ts`
> Dépend de : B.1 · Revue : rien n'est stocké qui se recalcule ; relire la formule du coût par poulet.

> Livrée le 2026-11-12, aucune dépendance ajoutée. Décisions du fondateur écrites d'abord au CdC (« Les dépenses ») : coût par poulet = engagé ÷ `min(vivants, reçus × 93 %)` — **7 % de pertes prévues par défaut, le réel dès qu'il les dépasse** (`EXPECTED_LOSS_RATE`) —, au franc le plus proche, absent tant que les vivants sont inconnus ; la prédiction des pertes devient V.4. `domain/finance/cost.ts` : `recordCost` (identifiant, type non archivé, date jamais dans le futur, montant entier ≥ 1, note facultative de 2 000 caractères au plus — vide = absente —, payé ou à payer à un fournisseur ou un collaborateur, reçu par empreinte), `committedCost` (coûts + facturable des commandes), `costPerBird`.

- [x] Un coût porte un identifiant créé sur l'appareil, un type, une date de dépense, un montant, une note et un statut payé ou à payer
- [x] Le même coût enregistré deux fois (même identifiant) ne compte qu'une fois dans l'engagé (property-based)
- [x] La date de dépense vaut aujourd'hui par défaut et peut être passée
- [x] L'engagé d'une campagne est la somme de ses coûts reconnus
- [x] Un coût « à payer » compte dans l'engagé comme un coût payé
- [x] Le coût par poulet à date suit la formule décidée, sans flottant

### P.2 — Modifier un coût laisse une trace · **M** · 🧪 ✅
> Spec : CdC « Tout coût est modifiable après coup » · Zone : `packages/domain/src/finance/counter-entry.ts`
> Dépend de : P.1 · Revue : l'historique des états est complet.

> Livrée le 2026-11-12. Une contre-écriture (`reviseCost`) réécrit le coût entier sous un nouvel identifiant et nomme le coût d'origine (jamais une autre contre-écriture, jamais une autre bande) ; `effectiveCosts` garde la dernière écrite d'après sa date de saisie, quel que soit l'ordre d'arrivée, et l'historique complet. Le fichier prévu `counter-entry.ts` n'existe pas : tout tient dans `cost.ts`.

- [x] Modifier le montant, la date, la note ou le statut crée une contre-écriture
- [x] L'écriture d'origine reste lisible dans l'historique
- [x] L'engagé suit la dernière valeur
- [x] Le passage de « à payer » à « payé » se fait en une seule opération
- [x] Chaque contre-écriture porte son auteur et sa date

### P.3 — L'API des coûts · **M** · 🔒 ✅
> Spec : Archi §4 (`couts`) · Zone : `apps/api/src/costs/`, `packages/contracts`
> Dépend de : P.2, E.3, N.2 · Revue : un collaborateur n'obtient rien, pas même une liste vide.

> Livrée le 2026-11-12, aucune dépendance ajoutée. Table `costs` (lecture et ajout seulement ; une correction est une autre ligne qui nomme la première ; RLS forcée ; contraintes : « à payer » nomme un tiers, « payé » n'en nomme aucun). `POST /api/v1/costs` et `POST /api/v1/costs/:id/revisions` (liste blanche, règles du domaine, jour du site ; renvoyé à l'identique 200, autre contenu 409 ; bande close ou inconnue refusée), `GET /api/v1/campaigns/:id/money` (engagé, vivants, coût par poulet, chaque coût avec son historique). Traces `CostRecorded`, `CostRevised` (sur le coût d'origine). Un reçu cité par un coût se relit par la route des médias (M.1). Admin seul.

- [x] L'admin enregistre, corrige (contre-écriture) et liste les coûts d'une campagne
- [x] Un coût déjà reçu (même identifiant) est ignoré et signalé comme doublon, sans erreur
- [x] Un collaborateur reçoit un refus sur toute route de coûts
- [x] Un coût d'un type archivé ou non rattaché est refusé
- [x] Chaque modification d'un coût est tracée dans l'audit
- [x] Les montants voyagent en entiers, dans la plus petite unité de la devise

### P.4 — Saisir et lire les dépenses · **M** ✅ (en ligne jusqu'à P.7)
> Spec : CdC « Argent » ; `bureau-admin.html` (Argent) · Zone : `apps/web/src/app/admin/money/`
> Dépend de : P.3, O.3 · Revue : la note n'est jamais tronquée ; aucun calcul d'argent dans l'écran.

> Livrée le 2026-11-12, aucune dépendance ajoutée. « Les dépenses » depuis les achats (`achats/depenses`) : engagé et coût par poulet venus du serveur, chacun avec son bouton d'écoute ; chaque dépense avec sa date, son type au picto de sa catégorie, son montant et ses billets, son statut, « reçu ✓ », sa note en entier ; « C'est payé » en un geste, « Dupliquer », « Corriger ». Le geste (`achats/depense`, écrans 7 à 9 de `bureau-admin-v2.html`) : **quoi** (tuiles des types en usage) → **combien** (pavé à grosses touches avec **000**, le montant posé en **billets** et en liasses de 100 000 — `Banknotes`) ; « Payé » d'office, « À payer plus tard » demande à qui (fournisseurs et collaborateurs) → **relecture** dite d'office (la catégorie, le montant, payé ou à payer) → Non revient au montant, **Oui** ; date, note (lignes de cahier) et reçu derrière « Plus de détails ». La règle du domaine juge avant l'envoi ; un essai repris renvoie la même dépense. 21 phrases au script audio. Le pavé gagne une touche 000 ; la réduction des photos passe dans `core/media` (le bureau et le cahier s'en servent).
> **Écarts** : saisir une dépense demande le réseau jusqu'à P.7 ; le bouton unique « Écrire » de la maquette (écran 6) n'existe pas encore — « Une dépense » est dans les dépenses ; plusieurs pictos de catégorie sont empruntés (matériel = la grange, nettoyage = l'abreuvoir, transformation = la poule) : **à valider sur le terrain** ; les couleurs des billets sont à recaler sur les vrais billets BCEAO, sans les reproduire.

- [x] L'admin choisit un type par pastille, saisit le montant et valide
- [x] La date de dépense est modifiable avant validation
- [x] La note s'écrit sur des lignes de cahier et s'affiche en entier
- [x] La liste montre les dépenses datées et le total engagé venu de l'API
- [x] L'engagé et le coût par poulet ont un bouton d'écoute
- [x] La saisie suit quoi → combien → Oui (décision du 2026-11-07, `bureau-admin-v2.html` écrans 7 à 9) : types en pictos d'objets, pavé à grosses touches avec 000, montant aussi en billets et en liasses, relecture vocale d'office avant le Oui ; date, note et reçu derrière « plus de détails »

### P.5 — Reçu en photo et duplication · **S** ✅
> Spec : CdC « Argent » (justificatif, duplication) · Zone : `apps/web/src/app/admin/money/`
> Dépend de : P.4, M.1 · Revue : dupliquer pré-remplit, n'enregistre jamais.

> Livrée le 2026-11-12, avec P.4. La photo du reçu, réduite sur l'appareil, part d'abord au dépôt des médias comme pièce justificative, puis la dépense la cite par son empreinte ; l'admin la relit puisque la dépense la cite. « Dupliquer » remplit le geste (type, montant, statut, note) à la date du jour, sans rien écrire ; Oui écrit une nouvelle dépense. « Corriger » garde aussi la date et le reçu, et écrit une contre-écriture.

- [x] L'admin joint la photo d'un reçu à un coût ; la liste affiche « reçu ✓ »
- [x] Le reçu est rangé comme pièce justificative
- [x] Dupliquer un coût pré-remplit le formulaire sans rien enregistrer
- [x] Le coût dupliqué prend la date du jour

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

### Q.1 — Une commande et son cycle · **M** ✅
> Spec : CdC « Commandes » · Zone : `packages/domain/src/finance/purchase-order.ts`
> Dépend de : B.1, B.2, N.2, N.3 · Revue : les transitions d'état, une par une.

> Livrée le 2026-11-09, aucune dépendance ajoutée, dans le domaine pur (`domain/finance`, jamais sur le téléphone du gardien). `draftOrder` juge une commande entière contre l'élevage (`DraftOrderContext` : ses tiers, ses types, sa devise) : fournisseur de sorte « fournisseur », non archivé ; au moins une ligne ; type commandable non archivé ; quantité entière d'au moins 1 ; prix en `Money` du kit, entier, zéro permis ; lignes distinctes ; référence facultative, nettoyée ; le résultat est gelé. Motifs : `OrderRefusal` (liste fermée propre aux commandes). Transitions : `reviseOrder` (brouillon seulement, même identifiant), `announceOrder` (une fois), `acceptsDeliveries` (annoncée et pas close — servira à Q.2), `closeOrder` (annoncée, pas entièrement reçue, même rien reçu ; jamais rouverte). **L'état se déduit** (`orderStatus`, règle 8) de l'annonce, de la clôture, du reçu par ligne et du « payé » : brouillon, annoncée, partiellement reçue, reçue (un bonus compte), close, soldée (reçue ou close, et payée).
> **Non fait ici** : le reçu par ligne vient des réceptions (Q.2), le « payé » du solde (Q.3) — `orderStatus` les reçoit en paramètre ; rien n'est en base avant Q.4.

- [x] Une commande a un en-tête (fournisseur, bande, date, référence facultative) et au moins une ligne (type de l'élevage, quantité, prix unitaire) — décisions du 2026-11-09
- [x] Seuls les types commandables entrent dans une commande
- [x] Le cycle est : brouillon, annoncée, partiellement reçue, reçue, soldée
- [x] Une transition hors du cycle est refusée
- [x] L'admin peut clôturer une commande incomplète

### Q.2 — Réceptions partielles et écarts signés · **M** · 🧪 ✅
> Spec : CdC « Commandes », « Les écarts sont signés » · Zone : `packages/domain/src/journal/delivery.ts`
> Dépend de : C.1 · Revue : quantités seules, aucun prix — ce code va sur le téléphone du gardien.

> Livrée le 2026-11-09, aucune dépendance ajoutée, dans `domain/journal` (quantités seules, aucun prix : le téléphone du gardien l'utilisera pour sa carte livraison). `receivedByLine` lit le journal tel qu'il est (`effectiveJournal`) : une réception corrigée compte pour sa nouvelle valeur, une annulée ne compte plus ; ni l'ordre d'arrivée ni les doublons ne changent le cumul ; une ligne qui n'a rien reçu est absente, pas à zéro. `lineDelivery(commandé, reçu)` : reste à venir (jamais sous zéro), écart signé `reçu − commandé` (manque négatif, bonus positif, jamais bridé), complète quand rien ne reste. C'est ce cumul que `orderStatus` (Q.1) attend.
> **Non fait ici** : rattacher une réception à une commande annoncée et pas close (le serveur le jugera à l'ingestion, avec `acceptsDeliveries`, quand les commandes seront en base : Q.4) ; la carte du gardien (Q.7).

- [x] Plusieurs réceptions se cumulent par ligne
- [x] Le reste à venir vaut la quantité commandée moins le reçu cumulé, tant qu'il est positif
- [x] Un reçu inférieur au commandé donne un écart négatif (manque)
- [x] Un reçu supérieur au commandé donne un écart positif (bonus), jamais ramené à zéro
- [x] Une ligne est complète quand le reçu atteint la quantité commandée
- [x] Le reçu cumulé est la somme des réceptions, quel que soit leur ordre (property-based)

### Q.3 — Facturable, paiements et solde · **M** · 🧪 ✅
> Spec : Archi §4 (`facturable`, `dette`) ; CdC « Commandes » · Zone : `packages/domain/src/finance/order-balance.ts`
> Dépend de : Q.1, Q.2 · Revue : les montants attendus, calculés à la main dans les tests, sur le cas du 12/10.

> Livrée le 2026-11-09, aucune dépendance ajoutée, dans `domain/finance` (un seul fichier : facturable et solde se lisent ensemble). `billableOf` : `min(reçu, quantité) × prix unitaire` par ligne, en `Money` du kit. `recordPayment` : date, montant entier d'au moins 1 F, moyen dans `PAYMENT_METHODS` — **espèces ou Wave**, la liste du CdC (un autre moyen s'ajoutera s'il est observé ; à confirmer par le fondateur). **Orange Money ajouté le 2026-11-11** (décision du fondateur : des paiements se font par OM). `orderBalance` : payé (chaque paiement compté une fois, ceux d'une autre commande ignorés), facturable, `dette = payé − facturable` en `SignedMoney`, `paidInFull` — que `orderStatus` (Q.1) reçoit pour dire « soldée ». **Corrigé en route** : une devise était écrite en dur pour une commande sans ligne (règle 7) ; la commande porte désormais sa devise (`currency`, celle de l'élevage).
> **Non fait ici** : l'engagé de la bande (la somme des facturables par bande, avec les coûts directs) viendra avec les coûts (P) ; la contre-écriture d'un paiement ; rien n'est en base avant Q.4.

- [x] `facturable = min(reçu, quantité) × prix unitaire`, ligne par ligne
- [x] Un bonus n'augmente pas le facturable ; un manque le diminue
- [x] Le coût entre dans l'engagé à la réception, ni à la commande ni au paiement
- [x] Plusieurs paiements (date, montant, moyen) se cumulent, indépendamment des réceptions
- [x] `dette = payé − facturable` : négatif, tu lui dois ; positif, il te doit
- [x] Une commande est soldée quand elle est reçue ou clôturée et que le payé égale le facturable
- [x] Pour toute suite de réceptions et de paiements, le solde ne dépend pas de leur ordre (property-based)

### Q.4 — L'API des commandes · **M** · 🔒 ✅
> Spec : Archi §4 (`commandes`) · Zone : `apps/api/src/orders/`, `packages/contracts`
> Dépend de : Q.3, E.3, N.3 · Revue : réservé à l'admin ; les prix ne sortent jamais vers le gardien.

> Livrée le 2026-11-09, aucune dépendance ajoutée. Tables `purchase_orders` (fournisseur, bande, date, référence, devise, annoncée, close — **aucun état stocké**, règle 8) et `order_lines` (rang, type, quantité, prix en unités entières), RLS forcée ; une commande ne se supprime pas, les lignes d'un brouillon se réécrivent (seul `DELETE` accordé, sur `order_lines`). Routes admin : `GET /api/v1/orders` (chaque commande avec le reçu de ses lignes, lu dans le journal de sa bande, son état déduit par le domaine, son facturable), `POST` (brouillon jugé par `draftOrder` contre les tiers, les types et la devise de l'élevage ; bande de l'élevage et pas close), `PUT /:id` (brouillon réécrit entier), `POST /:id/announce`, `POST /:id/close` (le reçu vient du journal). Refus d'état en 409, d'entrée en 400 avec le motif, d'un autre élevage en 404. Audit `OrderDrafted`, `OrderRevised`, `OrderAnnounced`, `OrderClosed`, avec le site de la bande.
> **Non fait ici** : aucun paiement en base (Q.9) — le « payé » vaut 0 ; le serveur ne vérifie pas encore qu'une réception écrite par le gardien vise une ligne d'une commande annoncée et pas close (avec la carte livraison, Q.7).

- [x] L'admin crée et modifie une commande en brouillon
- [x] Il annonce une commande en brouillon
- [x] Il clôture une commande incomplète
- [x] Un collaborateur reçoit un refus sur toute route de commandes
- [x] Chaque changement d'état est tracé dans l'audit

### Q.5 — L'éditeur de commande · **M** ✅ (sauf le catalogue de prix, N.5)
> Spec : CdC « Commandes » ; `bureau-admin.html` (Commandes, éditeur de facture) · Zone : `apps/web/src/app/admin/purchases/`
> Dépend de : Q.4, O.3, N.5 · Revue : le total en cours de saisie utilise `domain/finance` ; le total enregistré vient de l'API.

> Livrée le 2026-11-09, aucune dépendance ajoutée. L'onglet **Achats** (`PurchasesPage`) liste les commandes : visage et nom du fournisseur, lot, état en picto, couleur et mot (Brouillon, Annoncée au gardien, En partie reçue, Reçue, Close, Soldée), et l'argent — commandé pour un brouillon ou une annoncée, puis « à payer » et payé. Un brouillon s'annonce d'un geste (« Annoncer au gardien ») et se rouvre pour être modifié. L'éditeur (`OrderEditorPage`, `achats/nouvelle` et `achats/:id`) : le lot (le seul choisi d'avance), le fournisseur sur des tuiles visage + nom (jamais choisi d'avance ; ni client ni archivé), **« Nouveau fournisseur » créé sur place** (nom et visage, aussitôt choisi — décision du 2026-11-09), la date du jour, le n° du bon facultatif, les lignes (types commandables en pastilles, quantité × prix l'unité), le **total recalculé pendant la frappe par `orderedAmount` (domaine)**, la règle `draftOrder` jugeant avant tout envoi, chaque refus dit en mots, « Enregistrer » fixé au-dessus de la barre des cinq. Le service `Purchases` lit commandes, tiers, types et **la devise de l'élevage**, ajoutée à `GET /api/v1/reference-data` (règle 7 : jamais écrite dans l'écran). **Les types de départ** sont devenus une liste précochée (décision du fondateur) : un par catégorie du socle, cochés, et Déplumage et Congélation décochés (archivés) — l'amorçage les écrit.
> **Regardé dans le navigateur à 360 px, le 2026-11-09** : la barre du bas (total, Annuler, Enregistrer) prenait près d'un quart d'un petit écran — ramenée à une rangée (le total à gauche, « Enregistrer » à droite ; « Annuler » sous le titre) ; « N° du bon » passait sur deux lignes — « facultatif » écrit dans le champ ; les pastilles de type ont reçu leur picto (sac, poussin, seringue). Parcours vérifié : fournisseur créé sur place, ligne de 20 sacs à 17 500 F, total 350 000 F, enregistré, annoncé, la carte dit « Annoncée au gardien ».
> **Non fait ici** : le prix prérempli depuis le catalogue (N.5) ; cocher un type décoché (N.6) ; les montants en billets pour les gérants qui lisent mal ; **Copeaux n'a pas de picto** (à dessiner, puis à faire reconnaître sur le terrain).

- [x] L'admin compose une commande ligne par ligne
- [ ] Le prix unitaire est pré-rempli depuis le catalogue — attend N.5
- [x] Le total de la saisie en cours s'affiche pendant la frappe
- [x] La liste montre chaque commande avec son état de réception et de paiement
- [x] Une commande en brouillon s'annonce d'un geste

### Q.6 — La livraison annoncée arrive chez le gardien · **S** · 🔒 ✅
> Spec : CdC « Livraison annoncée » · Zone : `apps/api/src/journal/caretaker-context.ts`
> Dépend de : Q.4, F.3 · Revue : quantité attendue seulement ; test de garde sur l'absence de prix.

> Livrée le 2026-11-09, aucune dépendance ajoutée, côté serveur. Chaque bande du contexte du gardien porte `deliveries` (`CaretakerDelivery`, par ajout au contrat) : une par commande annoncée, ni close ni entièrement reçue, la plus tôt annoncée d'abord ; chaque ligne dit son type (nom et catégorie, d'où le picto), la quantité attendue, le reçu cumulé (`receivedByLine`, lu dans le journal de la bande) et le reste à venir (`lineDelivery`). **Garde du need-to-know** : le texte même de la réponse ne contient ni prix, ni montant, ni devise, ni fournisseur, ni référence.
> **Non fait ici** : la carte livraison à l'écran du gardien, et le comptage (Q.7) ; les vivants restent « pas encore connus » tant que les poussins reçus ne sont pas comptés (Q.7 les branchera sur les lignes de poussins).

- [x] Une commande annoncée ajoute une carte livraison au contexte du gardien du site
- [x] La carte porte l'article et la quantité attendue, jamais le prix
- [x] Une commande en brouillon n'ajoute aucune carte
- [x] Une commande complète ou clôturée retire la carte

### Q.7 — Le gardien compte la livraison · **M** · 🧪 ✅ (regardé dans le navigateur ; à regarder sur un vrai téléphone)
> Spec : CdC « Livraison annoncée » ; `journal-gardien.html` (carte livraison, paquets de 4) · Zone : `apps/web/src/app/caretaker/delivery/`
> Dépend de : Q.6, Q.2, K.1 · Revue : le bonus se dit aussi bien que le manque.

> Livrée le 2026-11-11, aucune dépendance ajoutée. Décisions du fondateur écrites d'abord au CdC : une réception = une ligne ; les poussins se comptent en cartons de 50 (le reçu vaut cartons × 50, pas de vérification carton par carton, les quelques poussins en plus d'un carton ne se déclarent pas) ; une photo du papier par arrivée. **Domaine** (`domain/journal`) : `deliveryCounting` (sacs pour l'aliment et la litière, cartons de 50 pour les poussins — arrondi au-dessus —, unités pour le reste ; pré-rempli avec ce qui reste), `receivedOf`, `validateDeliveryTarget` et deux refus (`UnknownOrderLine`, `OrderNotReceiving`). **Serveur** : l'ingestion refuse une réception sur une ligne de brouillon, de commande close, inconnue ou d'une autre bande ; une correction de réception passe même après la clôture (elle garde la ligne de ce qu'elle corrige) ; **les vivants enfin connus** dans le contexte du gardien dès qu'une ligne de poussins a reçu (poussins reçus, bonus compris, moins morts et pertes ; `null` avant, jamais zéro). **Téléphone** : `DeliveryCard` au-dessus des gestes, seulement si quelque chose reste à venir ; « C'est arrivé — je compte » ; une seule ligne → le compteur aussitôt, plusieurs → les tuiles de ce que le camion a apporté, rien d'avance ; compteur pré-rempli (sacs dessinés par paquets de quatre) ; relecture : manque dit avec ce que le chef attendait, bonus dit ; Non revient au compteur ; le reste à venir et **les vivants suivent hors-ligne** ce que le téléphone a compté (`expectedDeliveriesOf`, `liveCountOf`). Script audio : phrases de la livraison rendues génériques (sacs, cartons, unités).
> **Écarts** : la carte est dans le cahier, pas encore annoncée par une notification (Y.2) ; Copeaux (litière) n'a pas de picto : les sacs reçus le remplacent.

- [x] La carte livraison n'apparaît que si une commande est annoncée
- [x] Le comptage est pré-rempli avec la quantité attendue
- [x] Un manque est dit à voix haute (« le chef en attendait 40 »)
- [x] Un bonus est dit à voix haute (« 50 de plus que la commande »)
- [x] Après une réception partielle, la carte reste ouverte avec « reste N à venir »
- [x] La réception part dans l'outbox et fonctionne hors-ligne

### Q.8 — Le papier du livreur · **S** ✅
> Spec : CdC « photo du PV de réception » · Zone : `apps/web/src/app/caretaker/delivery/`
> Dépend de : Q.7, M.3 · Revue : l'absence de papier ne bloque rien.

> Livrée le 2026-11-11 avec Q.7, sur M.1–M.3. Après la dernière ligne comptée, la feuille « Le papier du livreur » : « Photo du papier » (l'appareil photo du téléphone, la photo réduite dans le viseur, Oui ; la croix la reprend) ou « Pas de papier », sans blocage. **Une seule réponse pour toute l'arrivée** : chaque réception de l'arrivée porte le même papier (`Photographed` avec l'empreinte, ou `NoPaper`). La photo est gardée comme **pièce justificative** (`SupportingDocument`) dans la file des médias et part avec le réseau ; l'admin la relit par la route de M.1, puisque la réception la cite. Photo illisible : post-it et voix (« appuie sur Pas de papier, et garde le papier pour le chef »).

- [x] Après le comptage, le gardien photographie le PV
- [x] « Pas de papier » termine la réception sans blocage
- [x] Le PV est rangé comme pièce justificative et rattaché à la réception

### Q.9 — Payer une commande · **M** ✅ (sauf la file d'attente hors-ligne, P.7)
> Spec : CdC « paiements découplés et multiples » ; `bureau-admin.html` (règlements) · Zone : `apps/api/src/orders/`, `apps/web/src/app/admin/purchases/`
> Dépend de : Q.5 · Revue : un paiement ne touche pas l'engagé.

> Livrée le 2026-11-11, aucune dépendance ajoutée. Règles écrites d'abord au CdC (« Payer une commande ») : un paiement sur une commande de l'élevage **quel que soit son état** (un acompte sur un brouillon, le reçu d'une commande close) ; son identifiant naît au bureau : renvoyé à l'identique il compte une fois (200), le même identifiant avec un autre contenu est refusé (409) ; jamais modifié ni effacé ; payer plus que le facturable est permis ; tracé (`PaymentRecorded`). **Orange Money** ajouté aux moyens (décision du fondateur). Serveur : table `payments` (lecture et ajout seulement, RLS forcée), `POST /api/v1/orders/:id/payments` (liste blanche, règle `recordPayment` du domaine), `OrderView.payments` et le payé lu en base — l'état « soldée » de Q.3 en découle. Écran : « Payer » sur chaque carte des achats ; la page `achats/:id/payer` dit à payer, déjà payé, le reste (ou « Sedima te doit … »), liste les paiements faits, propose le reste à payer et la date du jour, trois tuiles de moyen (espèces : la pièce ; Wave et Orange Money : un **téléphone qui envoie des francs**, dessiné pour l'occasion, sans logo de marque, couleur et mot pour les distinguer — **à valider sur le terrain**), jamais choisi d'avance ; la règle du domaine juge avant l'envoi ; un essai raté puis repris renvoie **le même** paiement.
> **Non fait ici** : la file d'attente hors-ligne du bureau (P.7) — payer demande le réseau ; la contre-écriture d'un paiement erroné ; l'engagé n'existe pas encore (P.1) : le test garde que le facturable ne bouge pas.

- [x] L'admin enregistre un paiement : date, montant, moyen (espèces, Wave, Orange Money)
- [ ] Hors-ligne, le paiement part en file d'attente et s'affiche « en attente » (P.7) — attend P.7
- [x] Plusieurs paiements partiels se cumulent
- [x] Un paiement avant toute réception est accepté
- [x] L'engagé ne change pas quand un paiement est enregistré
- [x] La commande passe à « soldée » quand les conditions de Q.3 sont réunies

## R — Grand livre des tiers

### R.1 — Les soldes se déduisent des écritures · **M** · 🧪
> Spec : CdC « Qui doit quoi » · Zone : `packages/domain/src/finance/ledger.ts`
> Dépend de : Q.3, P.1 · Revue : les deux sens du solde ; aucun solde stocké.

- [ ] Reçu et non payé : tu dois au fournisseur
- [ ] Payé et non reçu : le fournisseur te doit
- [ ] Un coût direct « à payer » crée une dette envers le tiers choisi
- [ ] Le solde d'un tiers est la somme de ses écritures, quel que soit leur ordre (property-based)
- [ ] Les soldes en nature restent distincts des soldes en francs

### R.2 — Régler en une ou plusieurs fois · **S** · 🧪
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
- [ ] Le sens se voit sans lire : flèche rouge de toi vers le tiers, verte vers toi ; le tiers a son visage et la voix dit son nom enregistré, avec le montant (écran 10 de `bureau-admin-v2.html`)

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

### T.3 — Saisir un poids en grammes · **M** · ⚠
> Spec : CdC « Demande de pesée » ; `journal-gardien.html` (`#cadran`, à revoir) · Zone : `packages/design-system/`
> Dépend de : H.3, B.2 · Revue : simple pour un gardien qui ne lit pas forcément.
> Reformulée le 2026-11-07 : la balance n'est pas modélisée (décision du fondateur) ; le cadran qui répliquait le modèle de balance du site est abandonné.

- [x] La forme de la saisie est choisie avec `/designer` — le 2026-11-07 : l'afficheur d'une balance digitale, recopié chiffre par chiffre (entrée par la droite), relu par la voix ; aucun poids pré-rempli (`journal-gardien-entree.html`)
- [ ] Le poids saisi est un entier de grammes positif ; aucune capacité de balance ne le borne
- [ ] La saisie borne le poids selon le type d'animal (un poulet de chair ne pèse pas 18 kg), pour rattraper une faute de frappe : **côté écran seulement** pour le moment, le serveur ne la vérifie pas (décision du 2026-11-07) ; les bornes viennent du référentiel de l'espèce ou de la souche
- [ ] La saisie se fait au doigt sans ralentir sur un téléphone d'entrée de gamme

### T.4 — Le gardien pèse cinq poulets · **M** · 🧪
> Spec : CdC « Demande de pesée » ; `journal-gardien.html` (`.slots`) · Zone : `apps/web/src/app/caretaker/weighing/`
> Dépend de : T.3, T.2, K.1 · Revue : la consigne anti-biais est dite.

- [ ] La consigne vocale demande des poulets pris dans des coins différents
- [ ] Chaque poids saisi remplit une case, et la voix le relit
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

### V.4 — Prédire les pertes d'ici la fin de la bande · **M** · ⚠
> Spec : demande du fondateur du 2026-11-12 (« prédire les pertes d'ici la fin de campagne ») · à spécifier avant découpage : quelle méthode (rythme des 7 derniers jours prolongé, courbe des bandes passées de l'élevage, table de la souche), et ce qu'elle remplace (les 7 % par défaut du coût par poulet, P.1).

- [ ] La méthode de prédiction est choisie avec le fondateur
- [ ] Le coût par poulet utilise les pertes prédites au lieu des 7 % par défaut

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

- [ ] L'admin enregistre une vente payée ou à crédit, par le même geste que P.4 : quoi → combien → Oui, relecture vocale d'office
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
- [ ] Les sauvegardes sont chiffrées, et leur accès est restreint à l'éditeur : elles contiennent le journal de tous les élevages (réserve R-19)

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
- [ ] Une nouvelle version s'installe sans rien demander au gardien : relance à l'ouverture ou au retour au premier plan, jamais pendant un geste (décision du 2026-11-08, réserve 6 de la vérification du lot K)

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
