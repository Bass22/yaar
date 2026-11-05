# CLAUDE.md — Yaar (pilotage avicole)

> Lis ce fichier avant toute contribution. En cas de doute, applique la **boussole** (§2).
>
> Sources de vérité, à la racine du dépôt :
> - `Cahier des charges — Pilotage avicole.md` — **le quoi** : modules, écrans, règles métier, UX.
> - `Architecture technique — Pilotage avicole.md` — **le comment** : stack, couches, hors-ligne, tenancy, lots.
> - `journal-gardien.html`, `bureau-admin.html` — **maquettes interactives validées**, références de design.
>
> Une règle métier absente de ces documents s'y ajoute **avant** d'être codée.

**État du dépôt (nov. 2026)** : avant le lot 1. Il n'existe que les specs et les maquettes ; l'arborescence du §3 est une cible. Vérifie qu'un dossier, un script ou une dépendance existe avant de t'appuyer dessus. « Yaar » est un nom de travail, non déposé : il ne s'écrit qu'à un endroit par application (manifest, constante), jamais en dur dans les écrans.

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
apps/api/                NestJS — un module par domaine : auth, tenants, users, sites, campagnes,
                         journal (le cœur), commandes, tiers, couts, ventes, pesees, referentiels,
                         notifications, medias, parametres, audit
packages/domain/         cœur métier pur, deux points d'entrée : journal (terrain) et argent
packages/shared/         types et DTO des événements, contrats d'API
packages/design-cahier/  design system « cahier » : tokens, pictos SVG, tampons
analytics/dbt/           Python + dbt sur réplique Postgres — hors chemin applicatif
audio/                   scripts des phrases + clips par langue (wo/, fr/)
infra/                   docker-compose, Caddy
docs/
```

Règle de dépendance — les flèches pointent vers l'intérieur :

```
packages/domain   → rien (ni NestJS, ni Prisma, ni Angular, ni IO)
packages/shared   → rien (types purs)
application       → domain            (cas d'usage + ports : dépôts, fichiers, push, horloge)
infrastructure    → application, domain   (Prisma, volume ou S3, web-push)
web — routes gardien → domain/journal, shared, design-cahier      (jamais domain/argent)
web — routes admin   → domain/journal, domain/argent, shared, design-cahier
```

**Une règle métier s'écrit une seule fois, dans `packages/domain`** — `apps/web` n'en réimplémente aucune. Mais tout le domaine ne va pas partout :

- **`domain/journal`** (validation d'une déclaration, vivants, moyenne de pesée, écart de quantité, anti-doublon) est partagé : le téléphone valide hors-ligne avec le même code que le serveur.
- **`domain/argent`** (facturable, dette, grand livre, coût par poulet) n'entre jamais dans les routes gardien, ce qu'une règle de lint Nx garantit. Côté admin, il ne sert qu'à prévisualiser une saisie en cours ; tout chiffre enregistré vient de l'API.
- Le domaine est **isomorphe** (aucune API propre à Node) et le serveur **revalide toujours** : le calcul du client sert à l'affichage et au hors-ligne, il ne fait jamais foi.

## 4. Règles non négociables

1. **Le journal est immuable.** Un événement ne se modifie ni ne s'efface : une correction après envoi est une **contre-déclaration** tracée. Aucun `UPDATE` ni `DELETE` sur le journal.
2. **Identifiants générés côté client** (UUID, jamais de séquence serveur). L'ingestion est **idempotente par UUID** : un doublon de synchro est ignoré, jamais compté deux fois. Chaque événement porte deux dates : date métier (choisie) et date de saisie (automatique). Il porte des **faits** (les cinq poids), jamais une valeur calculée (la moyenne) : le serveur recalcule, donc un téléphone resté sur une ancienne version du domaine ne fausse rien.
3. **Hors-ligne d'abord.** Toute déclaration du gardien fonctionne sans réseau (outbox IndexedDB). La synchro est un détail d'exécution, jamais une condition ; un événement déclaré ne se perd jamais.
4. **Need-to-know.** Le téléphone du gardien ne reçoit et ne stocke aucune donnée financière (coûts, prix, ventes, soldes). Le filtrage se fait **côté serveur selon le rôle**, pas en masquant à l'écran.
5. **Tenant partout.** `tenant_id` sur chaque table et chaque requête : garde NestJS + couche d'accès + RLS PostgreSQL. Le tenant vient de la session, jamais du client.
6. **Fail-closed.** Dans le doute, l'état par défaut est le plus restrictif : accès refusé, route protégée, entrée inconnue rejetée. L'autorisation (rôle, portée par site, mode strict) se vérifie à l'ingestion, côté serveur ; le client n'est jamais l'autorité.
7. **Jamais de flottant pour l'argent.** Montant = value object sur entier FCFA + code devise ; devise jamais codée en dur. Poids en grammes entiers, quantités en unités entières (le gardien ne manipule pas de fractions).
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

**Le métier en français, la technique en anglais** (architecture §4). Les termes du métier s'écrivent comme au cahier des charges, sans accents dans les identifiants ; le vocabulaire technique reste anglais (`CommandeRepository`, `JournalController`, `outbox`, `sync`). On ne traduit jamais un terme métier (`Order`, `Batch`, `Flock` sont des fautes) et on n'invente pas de synonyme. Commentaires rares, en anglais ; textes affichés et narration des tests en français.

| Métier | Sens | Code |
|---|---|---|
| Élevage (tenant) | Client du SaaS | `Tenant`, `tenant_id` |
| Site | Poulailler | `Site` |
| Campagne (« bande » à l'oral) | Un cycle d'élevage | `Campagne` |
| Événement / déclaration | Fait signé du journal | `Evenement`, `Declaration` |
| Contre-déclaration | Correction tracée après envoi | `ContreDeclaration` |
| Titulaire | Gardien référent d'un site | `titulaire` |
| Commande, ligne, réception | Bon multi-lignes, livraisons partielles | `Commande`, `LigneCommande`, `Reception` |
| Écart (manque / bonus) | Reçu − commandé, signé | `Ecart` |
| Facturable, dette, règlement | Voir §4 règle 8 | `facturable`, `Dette`, `Reglement` |
| Tiers | Fournisseur, client, collaborateur | `Tiers` |
| Coût, engagé, échéance, budget | Écritures et plan de l'admin | `Cout`, `engage`, `Echeance`, `Budget` |
| Pesée, souche | Poids réels vs courbe cible | `Pesee`, `Souche` |
| Vivants | Effectif courant | `vivants` |
| Clôture | Fin de campagne, restes, bilan | `cloture` |

Rôles : `admin` (gérant), `collaborateur` (gardien), `investisseur` (V2, lecture seule).

## 7. Méthode — TDD, tests = spécifications

- Le travail suit `backlog.md` : une tranche (`C.4`) = une demande de revue = un seul sujet, de taille S ou M. Une tranche qui déborde se scinde avant la revue ; pas de refactor opportuniste dedans.
- Cycle strict 🔴 → 🟢 → 🔵, une règle à la fois. Une règle sans test n'existe pas ; si la règle change, le test change avant le code.
- `describe` / `it` en **français métier**, corps en Given / When / Then, builders métier (`uneCommandeAnnoncee()`), référence à la spec en tête (`// Spec: Cahier des charges — Commandes`).
- Le gros du volume vit dans `packages/domain` (pur, sans mock, property-based sur les invariants d'argent et d'idempotence). Cas d'usage : ports en stub mémoire. Infrastructure : PostgreSQL réel (RLS, tenant). E2E : quelques parcours dorés, hors-ligne compris, avec les montants attendus **calculés à la main en commentaire**.
- Outils repris de l'ERP Travaux (Jest ou Vitest, fast-check, Testcontainers, Playwright) — à figer au lot 1.

## 8. Conventions de code

- **TypeScript strict** (`strict`, `noUncheckedIndexedAccess`) ; pas de `any`, `unknown` + narrowing aux frontières. Immutabilité par défaut. Erreurs métier typées (résultat typé), exceptions réservées aux pannes d'infrastructure.
- **Domaine** : fonctions pures, pas de `Promise`, pas de décorateur, pas de `new Date()` (l'heure vient d'un port horloge). Un état invalide n'est pas représentable.
- **API** : REST versionnée `/api/v1`, DTO validés aux bords (liste blanche), aucune logique métier dans un contrôleur, un DTO ou une requête. Une seule origine derrière Caddy : CORS jamais activé.
- **Angular** : composants standalone, signals + `computed()`, `OnPush`, control flow natif (`@if`, `@for` avec `track`), `inject()`, routes paresseuses, reactive forms. La vue gardien est un bundle minimal : PrimeNG et CDK lourds restent dans les routes admin. Styles par tokens de `packages/design-cahier`, aucune couleur en dur.
- **Prisma** confiné à l'infrastructure et aux lectures simples ; `tenant_id` sur chaque modèle.
- **Projet propriétaire** (`LICENSE`) : tout `package.json` porte `"private": true` et `"license": "SEE LICENSE IN LICENSE"`. Aucune dépendance sous licence GPL ou AGPL dans ce qui est livré, et aucun code tiers recopié sans licence permissive vérifiée.

## 9. Commandes

Cible, à remplacer par les vrais scripts dès que le socle (lot 1) existe :

```bash
npx nx test domain                    # le cœur : rapide, sans Docker
npx nx affected -t lint test build    # ce que la modification touche
npx nx serve api                      # NestJS
npx nx serve web                      # Angular
docker compose -f infra/docker-compose.yml up
```

Ouvrir une maquette : `open journal-gardien.html` (aucun build).

## 10. Skills du projet (`.claude/skills/`)

- `/designer` — concevoir ou critiquer un écran dans le design « cahier ».
- `/tech-lead` — cadrer, implémenter ou relire du code front et back.
- `/security-engineer` — modéliser les menaces d'une fonctionnalité, auditer une modification.
- `/qa` — chercher les bugs d'une fonctionnalité avant qu'elle ne soit déclarée finie.

## 11. Décisions ouvertes — ne pas les trancher en silence

Architecture §12 et cahier des charges « Points ouverts » : TTL et refresh du JWT, versionnement du schéma d'événements, champs spécifiques par type de coût, modèles de balance, seuils d'alerte par défaut, format des clips audio, hébergeur. Si une tâche bute sur l'une d'elles, pose la question au fondateur au lieu de choisir à sa place.
