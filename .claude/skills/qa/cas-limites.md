# Cas limites de Yaar, par module

Tirés du cahier des charges et de l'architecture. Parcours ceux du module testé ; chaque ligne est un scénario à jouer, pas une case à cocher de mémoire.

## Synchro et outbox

- Même lot envoyé deux fois : aucun événement compté deux fois.
- Lot de dix événements, réseau coupé après le sixième : au retour, les dix existent une seule fois.
- Application tuée, téléphone redémarré, navigateur fermé avant la synchro : l'outbox survit.
- Trois jours hors-ligne puis retour : tout part, dans l'ordre, avec les bonnes dates métier.
- Session expirée ou révoquée alors que l'outbox est pleine : les événements ne sont pas perdus ; l'utilisateur sait quoi faire.
- Le serveur refuse un événement du lot (mode strict, campagne clôturée) : les autres passent, le refusé n'est pas renvoyé sans fin, le gardien en est informé par picto et audio.
- Stockage du téléphone presque plein ; stockage persistant refusé par le navigateur.
- Photo ou vocal en file : l'événement part, le média suit plus tard ; échec d'envoi du média puis reprise.
- La pastille de synchro reflète l'état réel : en attente, envoyé, jamais « envoyé » à tort.

## Journal du gardien

- Zéro explicite : « Rien perdu hier » crée un événement ; un jour sans déclaration reste distinct.
- Deux gardiens déclarent des morts le même jour : la confirmation du second annonce la déclaration du premier ; les deux faits s'additionnent.
- Mode strict : un remplaçant ne peut pas déclarer ; l'admin, lui, peut toujours suppléer.
- Saisie pour hier et avant-hier : bannière et avertissement vocal, date métier correcte, date de saisie d'aujourd'hui.
- Changement de jour pendant une saisie (minuit) ; horloge du téléphone déréglée.
- Correction avant envoi : libre. Après envoi : contre-déclaration, l'événement d'origine reste visible et inchangé.
- Contre-déclaration d'une contre-déclaration ; correction qui rendrait les vivants négatifs.
- Morts supérieurs à l'effectif vivant ; compteur de vivants cohérent après correction et après synchro d'un second appareil.
- Trois taps au plus ; chaque écran parle ; aucun montant affiché ni reçu.
- Les fichiers chargés par la vue gardien ne contiennent pas le code de `domain/finance` : à vérifier sur le build de production, pas seulement par le lint.
- Tâches du jour : cochée hors-ligne, cochée par deux personnes, tâche déclenchée par la météo sans réseau.

## Commandes et réceptions

- Commande multi-lignes reçue en trois livraisons à des dates différentes (cas fondateur : véto le 12, aliment le 14, poussins le 16).
- Réception partielle : la carte du gardien reste ouverte avec « reste N à venir » ; elle se ferme à complétude ou à la clôture par l'admin.
- Manque (reçu < commandé) et **bonus** (reçu > commandé, cas réel des écloseries) : écart signé par ligne, jamais bridé à zéro.
- `facturable = min(reçu, qté) × PU` : vérifie le bonus (on ne paie pas le surplus) et le manque (on ne paie pas ce qui n'est pas arrivé).
- Réception déclarée par le gardien sans PV (« pas de papier ») : aucun blocage.
- Réception sur une commande clôturée, annulée, ou d'un autre site.
- Deux gardiens réceptionnent la même livraison.
- Commande restée en brouillon : aucune carte chez le gardien. Commande annoncée : carte et notification.
- Le coût de campagne est reconnu à la réception, pas à la commande ni au paiement.

## Argent, tiers et règlements

- Paiements multiples et découplés des réceptions : avant, après, en plusieurs fois, par des moyens différents.
- `dette = payé − facturable`, dans les deux sens : reçu non payé (tu lui dois), payé non reçu (il te doit).
- Règlement partiel, puis solde exact ; règlement supérieur à la dette.
- Coût « à payer » : crée une dette ; passage à payé en un tap ; l'historique des états est conservé.
- Modification d'un coût après coup (montant, date, statut, note) : contre-écriture tracée, total engagé recalculé.
- Duplication d'un coût : pré-remplit le formulaire, n'enregistre rien sans validation.
- Date de dépense passée (saisie différée) ; date future.
- Avance d'un collaborateur (« payé par AS ») : dette interne, remboursée plus tard.
- Budget : ne touche ni l'engagé ni le grand livre. Échéance récurrente : crée la dette à sa date, une seule fois.
- Montants : entiers FCFA, aucun arrondi flottant, grands montants (dizaines de millions), montant nul, montant négatif refusé.
- Soldes en nature (prêt de poulets) distincts des soldes en francs.
- Note longue : jamais tronquée, à la saisie comme à l'affichage.

## Pesées et suivi

- Pesée demandée par l'admin : carte chez le gardien ; cinq poids au pas de 50 g ; correction d'une case avant envoi.
- Moins de cinq poids, poids nul, poids hors de l'échelle de la balance du site.
- Validation par l'admin avec poids corrigés au clavier : moyenne recalculée ; seules les pesées validées alimentent la courbe.
- Modèle de balance différent selon le site : l'aiguille correspond au bon cadran.
- Consommation : sacs ouverts × poids du sac ÷ effectif, avec un effectif qui baisse en cours de campagne.
- Affichage par phase : pas de marge avant la première vente, pas de bilan avant la clôture.
- KPI sans donnée : absent, jamais `0`.

## Ventes

- Vente payée, à crédit (crée une créance), prêt de poulets.
- Quantité vendue supérieure aux vivants.
- Première vente : la marge apparaît.

## Clôture de campagne

- Restes : sacs entiers et demi-sac entamé, saisis par l'admin ; transfert vers la campagne suivante.
- Événement tardif (synchro) arrivant après la clôture.
- Commande non soldée ou réception en attente à la clôture.
- Bilan : poussins, pertes, coûts, revenus, coût par poulet, bénéfice — recalculé à la main sur un jeu d'essai.
- Partage du bilan : la version « groupe » ne contient aucun montant.

## Rôles, sites et tenants

- Un collaborateur ne voit ni ne déclare sur un autre site.
- Un utilisateur du tenant A n'obtient rien du tenant B, y compris par un identifiant deviné.
- Session révoquée par l'admin (téléphone perdu) : effective à la requête suivante.
- Admin qui déclare à la place du gardien : l'auteur réel est l'admin.
- Multi-site : le sélecteur de site de l'admin change tous les chiffres ensemble.

## Référentiels

- Type utilisé : archivable, jamais supprimable ; renommer ne change que l'étiquette.
- Type du socle éditeur : non supprimable ; type ajouté par l'admin : rattaché à une catégorie du socle.
- Type non commandable : coût direct, hors circuit commande → réception.
- Catalogue de prix : le dernier prix utilisé devient le défaut suivant.

## Notifications et médias

- Permission de notification refusée : la carte dans l'app existe quand même.
- Tap sur une notification : l'app s'ouvre et lit le message.
- Photo compressée autour de 800 px ; vocal limité à 90 s ; appareil photo ou micro refusé.
- Vocal traité : le sujet tagué et l'action restent au journal après la purge de l'audio.

## Appareil et accessibilité

- 360 px de large ; processeur bridé ; 3G ; démarrage à froid hors-ligne.
- Clips audio disponibles hors-ligne dans la langue du site.
- Cibles tactiles d'au moins 48 px ; contraste lisible au soleil ; animations réduites respectées.
- Bureau admin : lecture des chiffres clés à voix haute ; données en cache datées à l'écran.
