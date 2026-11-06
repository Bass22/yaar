# Cahier de recette — Yaar

Tenu par `/qa`. Il dit ce qui a été réellement exécuté, ce qui reste en réserve, et ce qui n'a pas pu être vérifié.

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

## 4. Recette manuelle sur appareil

Les essais qu'aucun test automatisé ne remplace : matériel d'entrée de gamme, 3G, téléphone resté trois jours sans réseau, nombre de taps, audio entendu, picto reconnu sans lire.

Vide pour l'instant : aucun écran n'existe (les premiers arrivent au lot 2). Chaque scénario s'écrit ici quand la tranche d'écran passe `/qa`, sous cette forme : étapes, résultat attendu avec sa référence au cahier des charges, appareil, résultat observé, date. La liste se rejoue en entier avant chaque mise en service chez un pilote.
