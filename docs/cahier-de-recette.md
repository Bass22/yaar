# Cahier de recette — Yaar

Tenu par `/qa`, et par `/security-engineer` pour ses constats restés ouverts. Il dit ce qui a été réellement exécuté, ce qui reste en réserve, et ce qui n'a pas pu être vérifié.

**Ce qu'il ne contient pas** : les tests automatisés. Ils vivent dans les fichiers `*.spec.ts`, leurs titres sont la spécification, et eux seuls font foi — un scénario recopié ici vieillirait sans que personne ne le lance. Ce cahier ne garde que ce qu'un test automatisé ne dit pas : un verdict, une réserve, une vérification impossible aujourd'hui, un essai à refaire à la main sur un appareil.

**Règles de tenue** : une réserve a un numéro qui ne change jamais, une tranche qui l'a trouvée et une tranche qui doit la lever. Une réserve levée ou acceptée par le fondateur se raye, avec la date et la raison ; elle ne s'efface pas. La mise en production (backlog Z.5) exige que le tableau des réserves ouvertes soit vide.

## 1. Passages

| Date | Tranche | Verdict | Ce qui a été exécuté |
|---|---|---|---|
| 2026-11-06 | C.4 — contre-déclaration (1er passage) | **Refusé** | Tests du domaine, 21 sabotages, scénarios exploratoires. Quatre défauts : annulation défaite par une correction du gardien ; correction qui change la ligne de commande, la tâche ou le média ; contre-déclaration portant l'identifiant de sa déclaration ; résultat dépendant de l'ordre d'arrivée sous un même identifiant. Tous levés le jour même par décision du fondateur |
| 2026-11-06 | C.4 — contre-déclaration (2e passage) | **Validé avec réserves** (R-4, R-5, R-6) | Tests du domaine, sabotages, 8 scénarios exploratoires. Deux règles ont changé après ce passage (correction jugée à la date de saisie ; la dernière écrite fait foi) : elles sont couvertes par les tests et par 34 sabotages détectés sur 34, mais n'ont pas eu de nouveau passage exploratoire |
| 2026-11-06 | C.5 — vivants | **Validé avec réserves** (R-1, R-2, R-3, R-4) | 153 tests du domaine, 24 sabotages détectés sur 24, 8 scénarios exploratoires |
| 2026-11-06 | C.6 — résumé d'un jour | **Validé avec réserves** (R-6, R-7) | 176 tests du domaine, 23 sabotages détectés sur 23, 8 scénarios exploratoires |
| 2026-11-06 | C.7 — annulation par l'admin | **Validé avec réserves** (R-4, R-6, R-7) | 202 tests du domaine, 24 sabotages détectés sur 24, 8 scénarios exploratoires. Le défaut bloquant du 1er passage de C.4 (une correction du gardien défait l'annulation) est rejoué et tenu : la ligne annulée ne recompte pas, correction écrite ou reçue avant ou après |
| 2026-11-06 | D.2 et D.3 — cloisonnement, journal en ajout seul (passage sécurité) | **Trois constats corrigés, trois réserves** (R-8, R-9, R-10) | 62 tests de l'API sur PostgreSQL 16 réel (Testcontainers) ; 45 sabotages détectés sur 45 (D.1 : 14, D.2 : 15, D.3 : 16) ; 15 tentatives d'attaque jouées avec le rôle de l'application ; image de l'API construite et pile complète démarrée à la main (migration appliquée, API saine sous `yaar_app`, sonde 200 à travers Caddy). Corrigés : sonde qui acceptait un rôle propriétaire d'une table ; SQL assemblé comme un texte, désormais interdit par le lint ; PostgreSQL de test au mot de passe connu |
| 2026-11-06 | D.5 — passage à Prisma 7 | **Validé** (aucune règle changée) | 62 tests de l'API sur Testcontainers ; sabotages de D.1 à D.3 rejoués ; image construite et pile démarrée à la main : trois migrations appliquées, API saine sous `yaar_app`, image de l'API sans ligne de commande Prisma |
| 2026-11-06 | E.1 — PIN haché, essais comptés (passage sécurité) | **Deux durcissements faits, trois réserves pour E.2** (R-12, R-13, R-14) | 26 tests du dossier `auth`, sur la vraie bibliothèque argon2 ; 28 sabotages détectés sur 28, sur une copie du dépôt ; hachage et vérification joués dans l'image Docker de l'API |
| 2026-11-07 | D.4 — amorçage d'un élevage | **Validé** | 10 tests sur PostgreSQL réel ; toutes les routes du serveur appelées sans session ; 11 sabotages détectés sur 11 sur une copie ; script joué dans la pile Docker (création, PIN trop simple et fuseau inconnu refusés, PIN absent des sorties et de la base). Migrations fusionnées en une seule, mêmes tests et mêmes sabotages |
| 2026-11-07 | E.2 — connexion (passage sécurité) | **Validé avec réserves** (R-14 à R-17) ; R-12 et R-13 levées | 10 tests du cas d'usage et 5 de la route sur PostgreSQL réel, 9 du jeton ; sabotages sur une copie (voir backlog) |

## 2. Réserves ouvertes

| N° | Réserve | Observé | Trouvée en | Se lève avec |
|---|---|---|---|---|
| R-1 | Tant que la réception des poussins n'est pas déclarée, ou qu'aucune ligne de mise en place n'est connue, le premier mort donne des vivants négatifs : un écran qui s'y fierait lèverait à tort l'alerte de dépassement. La règle d'affichage reste à confirmer | 3 morts sans réception : reçus 0, vivants −3 ; la réception de 510 arrive ensuite : vivants 507 | C.5 | J.1, O.4 |
| R-2 | Les ventes ne diminuent pas les vivants | Aucun événement de vente n'entre dans le calcul | C.5 | W.1 (décision ouverte) |
| R-3 | Le calcul des vivants prend le journal entier de la campagne : ce que le téléphone du gardien en reçoit, et donc ce qu'il peut recalculer seul, n'est pas défini | — | C.5 | F.3 |
| R-4 | Le journal effectif et le calcul des vivants font confiance à des événements déjà validés | Une correction jamais validée, écrite dans une autre campagne, fait passer 510 reçus à 100 ; une correction d'un autre type remplace le fait ; une annulation jamais validée, écrite dans une autre campagne, annule quand même | C.4, C.5, C.7 | F.1 |
| R-5 | Une correction identique à la déclaration est acceptée : sans effet sur les chiffres, mais elle serait signalée à l'admin comme une vraie correction | 3 morts « corrigés » en 3 : acceptée | C.4 | F.1, K.5 |
| R-6 | L'horloge des appareils décide : un téléphone dont on recule la date déclare et corrige au-delà de trois jours, et entre deux appareils une horloge décalée peut faire perdre la correction réellement la plus récente. Limite acceptée le 2026-11-06 pour un seul gardien par site ; l'écart entre la date côté client et la date côté serveur doit au moins être visible | Non rejoué en C.4 depuis le changement de règle : découle du code, qui ne lit que la date de saisie. En C.6 : un « rien perdu » du soir, daté du matin par une horloge en retard, passe avant les morts au lieu d'être refusé — sans effet sur le résumé, où les morts l'emportent. En C.7 : l'appareil de l'admin en retard d'un jour voit son annulation refusée (« ce jour est à venir ») ; l'annulation elle-même, une fois acceptée, ne dépend d'aucune horloge | C.4, C.6, C.7 | F.1 (décision ouverte sur l'horloge fausse), O.4 |
| R-7 | Une double saisie par erreur ne se rattrape pas toujours : les morts s'ajoutent, une quantité ne descend pas sous 1 et rien ne s'annule. Deux fois 3 morts se corrigent en 2 et 1 ; deux fois 1 mort restent 2. Le rappel « tu as déjà écrit… » est la première parade, et elle est dans l'écran. Allégée le 2026-11-06 (C.7) : l'admin peut annuler la saisie en trop ; le gardien seul ne le peut toujours pas, et l'erreur attend que l'admin soit joignable | 3 morts écrits deux fois à cinq secondes d'écart : le jour compte 6 morts ; après annulation de la seconde par l'admin : 3 | C.6 | K.1 (rappel à la confirmation) ; décision reportée « le gardien peut-il annuler ? » |
| R-8 | (sécurité) Un événement du journal ne garde pas l'appareil d'où il vient, alors que toute action doit dire « depuis quel appareil ». La colonne manque à `journal_events` | Lu dans la migration 0003 | D.3 | E.4 (sessions par appareil), F.1 — avant toute donnée réelle |
| R-9 | (sécurité) La sonde `/api/v1/health/ready` est publique et interroge la base à chaque appel : n'importe qui peut la marteler à travers Caddy | Lu dans le Caddyfile, qui relaie tout `/api/v1/*` | D.1, D.2 | Z.5 (limite de débit, ou sonde non relayée) |
| R-10 | (sécurité) Durcissements de production : images de base désignées par étiquette et non par empreinte (`postgres:16`, `node:22-slim`) ; moteur de migration de Prisma téléchargé au build de l'image `migrate` ; si PostgreSQL journalisait les ordres de structure, le mot de passe de `yaar_app` y figurerait en clair | — | D.1, D.2 | Z.5 |
| R-11 | (sécurité) Connaître l'identifiant d'un utilisateur, d'un site ou d'une campagne d'un autre élevage permet de vérifier qu'il existe (refus d'unicité à la création). Il faut déjà posséder un UUID aléatoire : risque faible, accepté pour l'instant. Élargie le 2026-11-07 (D.4) : un numéro de téléphone n'ayant qu'un compte sur tout le service, créer un compte avec un numéro déjà pris dit qu'il a un compte ailleurs — à rendre discret dans E.5 | Créer dans A un utilisateur sous un identifiant de B : « contrainte d'unicité » | D.2 | À réévaluer si un identifiant devient prévisible |
| ~~R-12~~ | ~~(sécurité) Un essai fait pendant l'attente ne doit ni vérifier le PIN ni compter comme un essai raté : sinon marteler un numéro allonge l'attente de sa victime, et consomme le processeur du serveur. La règle le permet ; c'est la connexion qui doit l'appliquer~~ — levée le 2026-11-07 par E.2 | La règle `retryAt` existe, aucune connexion ne l'appelle encore | E.1 | E.2 |
| ~~R-13~~ | ~~(sécurité) Un numéro inconnu doit coûter le même temps qu'un mauvais PIN, sinon le temps de réponse dit quels numéros ont un compte~~ — levée le 2026-11-07 par E.2 | — | E.1 | E.2 |
| R-14 | (sécurité) Compté par compte seulement, le ralentissement laisse n'importe qui imposer jusqu'à une heure d'attente à un gardien qui se connecte sur un nouvel appareil ; et un PIN à 4 chiffres ne tient que par ce comptage (24 essais par jour au plus, une fois l'attente à une heure) : il faut compter aussi par appareil et signaler à l'admin des échecs répétés | — | E.1 | E.2 (compteur par appareil), E.6 (signalement) |
| R-15 | (sécurité) Des essais envoyés en même temps passent la fenêtre libre avant que le compteur ne bouge : le compteur se lit, puis s'incrémente après la vérification. Borné par le coût d'argon2 et par Caddy, mais il faudrait un compteur réservé avant de vérifier | Lu dans `sign-in.ts` | E.2 | Avant Z.5 |
| R-16 | (sécurité) Un numéro qui a un compte finit par répondre 429 après trois mauvais PIN ; un numéro inconnu répond toujours 401 : on peut savoir si un numéro utilise le produit. Il faudrait compter aussi les essais sur un numéro inconnu | Raisonnement sur `sign-in.ts`, non joué | E.2 | Avant Z.5 |
| R-17 | (sécurité) Le jeton gardé par l'application est lisible par un script injecté dans la PWA (pas de cookie, décision du 2026-11-07). Accepté, borné par les durées (7 jours, 24 heures) ; une politique de contenu stricte est exigée | — | E.2 | Z.5 (en-têtes), G.2 |

## 3. Non vérifié

Ce qui n'a pas pu être exécuté, et la tranche à partir de laquelle ce sera possible. Un « non vérifié » se raye quand le passage correspondant a eu lieu.

| Quoi | Pourquoi | Vérifiable avec |
|---|---|---|
| L'ingestion d'une contre-déclaration : origine inconnue du serveur, doublon, lot partiellement accepté puis renvoyé | Aucune ingestion n'existe | F.1, F.2 |
| Les deux dates de chaque événement en base (côté client, côté serveur), et le refus de toute modification | Aucune base n'existe | D.3 |
| La correction en ligne sur le téléphone : crayon indisponible sans réseau, coupure pendant l'envoi, ligne en doute verrouillée | Aucun écran ni outbox | G.3, G.4, K.5 |
| L'affichage des vivants : avant toute réception, sous zéro, après une correction | Aucun écran | J.1, O.4 |
| Les vivants sur le téléphone du gardien, calculés sur la partie du journal qu'il reçoit | Descente non définie | F.3 |
| « Rien perdu » accepté hors-ligne sur le téléphone, puis refusé par le serveur qui connaît des morts écrits avant par un autre : ce que le gardien voit et entend | Ni ingestion ni écran | F.1, G.5 |
| Le rappel « tu as déjà écrit 3 morts aujourd'hui » : entendu, compris sans lire, et le gardien déclare bien le supplément | Aucun écran | K.1, K.3 — puis recette manuelle |
| L'admin annule une ligne pendant que le téléphone du gardien est hors-ligne : ce que le gardien voit avant et après sa synchro (ligne encore comptée, rappel faux), et sa correction de la ligne annulée refusée par le serveur | Ni ingestion, ni descente, ni écran | F.1, F.3, K.5 |
| L'annulation d'une réception déjà facturée ou payée : effet sur le facturable et la dette | Aucune règle d'argent n'existe | Q.2, Q.3 |
| ~~L'image Docker de l'API et `docker compose up`~~ — vérifié à la main le 2026-11-06 : image construite, `migrate` applique trois migrations et s'arrête, API saine sous `yaar_app`, sonde 200 à travers Caddy | ~~Le démon Docker ne répondait pas~~ | ~~D.1~~ ; à rejouer avec Z.5 |
| Les tests d'infrastructure en CI : Testcontainers sur le Docker de la machine de CI | Aucune CI n'a tourné depuis l'ajout | Première poussée après D.1 |

## 4. Recette manuelle sur appareil

Les essais qu'aucun test automatisé ne remplace : matériel d'entrée de gamme, 3G, téléphone resté trois jours sans réseau, nombre de taps, audio entendu, picto reconnu sans lire.

Vide pour l'instant : aucun écran n'existe (les premiers arrivent au lot 2). Chaque scénario s'écrit ici quand la tranche d'écran passe `/qa`, sous cette forme : étapes, résultat attendu avec sa référence au cahier des charges, appareil, résultat observé, date. La liste se rejoue en entier avant chaque mise en service chez un pilote.
