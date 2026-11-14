---
name: refactor
description: "Refactoring de Yaar après implémentation : réduit les duplications inutiles, simplifie, range chaque règle à sa place, sans changer aucun comportement. Une tranche à part, des pas courts, les tests inchangés et verts à chaque pas ; puis la QA vérifie la non-régression, et la sécurité audite si une zone sensible est touchée. À lancer après une ou plusieurs tranches livrées, pour faciliter la maintenance."
when_to_use: "Demandes du type « refactore », « nettoie le code de Q.15 », « il y a des duplications », « simplifie le module notifications », « passe de maintenance ». Après plusieurs tranches qui ont touché la même zone, ou quand une revue signale du code répété."
argument-hint: "[tranche(s) ou zone à refactorer — par exemple « Q.14 et Q.15 », « apps/api/src/notifications » — ou rien pour la modification en cours]"
---

# Refactoring — Yaar

Tu rends le code plus simple à maintenir **sans changer ce qu'il fait**. Le juge est la suite de tests : elle doit rester identique et verte, avant comme après. Un refactoring qui oblige à changer ce qu'un test attend n'est plus un refactoring : c'est un changement de comportement, qui se décide ailleurs.

Les règles du projet sont dans `CLAUDE.md` et s'appliquent toutes ; ce skill ne les répète pas. Il dit quoi chercher, comment avancer, et à qui passer la main.

## Ce qui mérite un refactoring

Dans l'ordre de ce que ça coûte à la maintenance :

1. **Une règle métier écrite deux fois**, ou hors de `packages/domain` : dans un contrôleur, un composant, une requête. Elle se range dans le domaine, une seule fois (`CLAUDE.md` §3).
2. **Une duplication réelle** : le même calcul, la même lecture Prisma, le même gabarit d'écran, recopié dans **au moins deux** endroits qui changeraient ensemble. On abstrait face à un second cas concret, jamais « au cas où ». Deux bouts de code qui se ressemblent mais évolueraient séparément ne sont pas une duplication : laisse-les.
3. **Du code mort** : une fonction, une option, une branche, un import que plus rien n'utilise.
4. **Une fonction trop longue ou un nom trompeur** : un nom qui ne suit pas le glossaire (`CLAUDE.md` §6), un identifiant en franglais, un commentaire qui ment.
5. **Une incohérence de façon de faire** : deux modules qui font la même chose de deux manières (lire la session, répondre un refus, formater un montant). Aligne sur la manière déjà la plus répandue et la plus simple.

Ce qui **n'en mérite pas** : une couche de plus, un dépôt générique, une factory, une interface pour un seul cas, une dépendance (un outil de détection de doublons compris), un renommage de goût, un « nettoyage » de code qui marche et que personne ne touche.

## Ce qui est hors de portée

Un refactoring ne change jamais :

- **un comportement observable** : une réponse d'API, un écran, une phrase dite, un ordre d'affichage, un message d'erreur ;
- **un contrat** : une route, un DTO de `packages/contracts`, une forme d'événement du journal (il n'évolue que par ajout : règle 1) ;
- **le schéma de la base** : une migration n'est pas un refactoring ;
- **ce qu'un test vérifie** : un test peut suivre un fichier déplacé ou un nom changé, jamais perdre ou assouplir une assertion.

Si l'un d'eux doit changer, arrête-toi et dis-le : c'est une tranche à part, avec sa décision.

## Méthode

1. **Délimite.** La ou les tranches visées, ou la zone. Lis le code entier de la zone, ses tests, et les règles du cahier des charges qu'il porte.
2. **Relève l'état de départ.** Lance et note les compteurs : `npm run lint`, `npm run typecheck`, `npx nx test domain`, `npx nx test web`, `node --test "tools/**/*.spec.mjs"`, la suite complète de l'API (`npx jest --config apps/api/jest.config.js`), et pour le web le budget (`npx nx build web` puis `node tools/perf-budget.mjs`). Tout doit être vert avant de commencer ; sinon, signale-le et ne commence pas.
3. **Dresse l'inventaire.** Chaque refactoring envisagé, avec sa preuve : les fichiers et lignes en double, le nombre d'occurrences, la règle mal rangée. Classe-les par gain. Présente l'inventaire avant de toucher au code quand il dépasse quelques retouches évidentes.
4. **Un refactoring à la fois, à petits pas.** Après chaque pas, relance les tests de la zone ; tout reste vert, avec le même nombre de tests. Un pas qui casse un test se défait, il ne se « répare » pas en modifiant le test.
5. **Repasse les sabotages des règles déplacées.** Une règle qui a changé de fichier doit toujours faire tomber un test quand on la casse : saboter sur une copie du dépôt, jamais dans l'arbre de travail (`CLAUDE.md` §7).
6. **Relève l'état d'arrivée.** Les mêmes commandes qu'au départ : mêmes compteurs de tests, tout vert, budget tenu.
7. **Passe la main** (ci-dessous).

## Passer la main

- **Toujours à la QA** : lance `/qa` pour la non-régression du refactoring. Donne-lui la zone, l'inventaire appliqué, les compteurs de départ et d'arrivée, et les sabotages repassés. Le refactoring n'est pas fini tant qu'elle n'a pas rendu son verdict.
- **À la sécurité si une zone sensible est touchée** : authentification, sessions, rôles, tenant et RLS, ingestion du journal, médias, notifications, migrations, configuration ou infra. Lance `/security-engineer` sur la modification ; un constat bloquant arrête le refactoring.

## Ce que tu livres

- L'inventaire appliqué : chaque refactoring, sa raison (la duplication ou la règle mal rangée, avec les fichiers), ce qu'il a changé.
- Ce qui a été écarté, et pourquoi (une ressemblance qui n'est pas une duplication, un changement de comportement déguisé).
- Les compteurs de départ et d'arrivée, identiques.
- Les sabotages repassés et leur résultat.
- Le verdict de la QA, et celui de la sécurité s'il y a lieu.
- Une ligne au cahier de recette (`docs/cahier-de-recette.md`), tranche « Refactoring — … ».

## La demande

$ARGUMENTS

Si rien n'est précisé ci-dessus, refactore la modification en cours dans la conversation ou dans l'arbre de travail.
