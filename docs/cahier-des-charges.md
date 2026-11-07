# Cahier des charges — Pilotage avicole

Nov 1, 2026 · @Bass

## Vision & stratégie

Produit SaaS multi-tenant de pilotage d'élevages de poulets de chair, **utilisable par des analphabètes**, vendu en abonnement par campagne via mobile money, d'abord au Sénégal puis dans la sous-région.

**Le problème.** La gestion se fait sur Excel, cahiers et mémoire : déclarations tardives ou perdues (« 32 morts non déclarés en fin de ventes »), soldes fournisseurs oubliés, pas de vision du coût de revient en cours de bande. Sur 11 campagnes réelles analysées, les 2 campagnes en perte sont les 2 pires mortalités : la qualité de la donnée terrain est le premier levier de rentabilité.

**La proposition de valeur.** Un journal de terrain fiable (hors-ligne, pictos, audio, 3 taps) tenu par le gardien + un bureau de pilotage pour le gérant (coûts, commandes, soldes, poids, alertes) + à terme un module d'analytics financier.

**La trajectoire.**

1. Double tenue (Excel + app) sur les campagnes propres du fondateur — 2 sites (Thiès, Pout).
2. Pilotes gratuits avec 2–3 éleveurs du groupe ; observation des gardiens sur le terrain.
3. Commercialisation sous-région, abonnement par campagne à bas prix.
4. Écosystème : réseau d'éleveurs (Woolunte Network), benchmark anonymisé, données propriétaires.

**Différenciateurs.** Accessibilité analphabètes de bout en bout ; pratiques locales modélisées (prêts de poulets, bonus poussins, FCFA, Wave, PV de réception) ; design signé difficile à copier ; données de pesée auto-étiquetées comme actif long terme.

## Utilisateurs, rôles & gouvernance

Hiérarchie : **Tenant (élevage) → Sites (poulaillers) → Campagnes (bandes) → Événements**. Le multi-site existe dès la V1 (réalité observée : Thiès + Pout).

| Rôle | Qui | Peut | Ne peut pas |
| --- | --- | --- | --- |
| Admin (gérant) | L'éleveur | Tout : coûts, commandes, ventes, référentiels, validation des pesées, création des comptes, déclarer à la place du gardien | — |
| Collaborateur (gardien) | 1…n par site | Tout ce qui touche les bêtes de son site : morts, sacs ouverts, réceptions annoncées, pesées, vocaux, photos, tâches | Les montants, les commandes, les autres sites |
| Investisseur (V2) | Apporteur de fonds | Lecture seule : KPI de sa campagne, médias | Toute saisie |

**Identité** : numéro de téléphone + code PIN, avatar picto reconnaissable à la connexion. Pas d'e-mail. Le PIN a **4 chiffres pour un gardien, 6 pour l'admin**, qui ouvre les chiffres d'argent (décision du 2026-11-06). **Essais ratés** : trois essais libres, puis une attente qui s'allonge — 30 secondes, 1 minute, 5 minutes, 15 minutes, puis 1 heure au plus — et jamais de blocage définitif, pour que personne ne puisse bloquer un gardien en martelant son numéro. Le compteur repart de zéro après une connexion réussie. **Un PIN trop simple est refusé** à la création (décision du 2026-11-06) : un seul chiffre répété (0000, 111111) ou des chiffres qui se suivent, dans un sens ou dans l'autre (1234, 6543, 012345). **Session** (décision du 2026-11-07) : la connexion ouvre une session portée par un jeton signé, gardé par l'application sur l'appareil — **7 jours pour un gardien, 24 heures pour l'admin** — sans renouvellement : à l'expiration, le PIN est redemandé, ce qui aide aussi à ne pas l'oublier. Hors-ligne, le gardien continue de déclarer avec une session expirée ; l'outbox part après sa reconnexion. **Téléphone volé** : l'admin **bloque le compte**, ce qui déconnecte tous ses appareils dès la requête suivante ; débloquer, changer le PIN ou « déconnecter partout » invalident de même tout jeton émis avant. Pas de révocation appareil par appareil en V1 : un gardien a un téléphone. Le jeton porte l'utilisateur, l'élevage, le rôle, l'appareil et ses dates — ni numéro, ni nom, ni site. **Premier PIN** (décision du 2026-11-07) : l'admin crée le compte d'un collaborateur avec un PIN provisoire, qu'il connaît ; à sa première connexion, le collaborateur tape le PIN provisoire **et** choisit le sien, en une seule étape, avant d'être connecté — sinon l'admin pourrait se connecter à sa place, et les déclarations porteraient le mauvais auteur. Aucune session n'existe tant que le PIN n'est pas choisi. Un PIN provisoire non utilisé expire au bout de 7 jours ; un PIN oublié se remplace de la même façon. La règle ne vaut pas pour l'admin. **Admins** (décision du 2026-11-07) : un élevage a **au moins un admin**, et pas forcément un seul ; un admin n'est créé que par l'éditeur (le « super admin »), par script — l'élevage avec son premier admin à l'onboarding, puis un admin de plus si besoin, désigné par l'identifiant de l'élevage affiché à l'amorçage. Aucune route ne crée un admin, ne change un rôle ni n'efface un compte, et un admin ne peut pas en bloquer un autre : un élevage garde donc toujours au moins un admin. Chaque admin ajouté est tracé, sans auteur — l'éditeur n'a de compte dans aucun élevage. Depuis le bureau, l'admin ne crée que des collaborateurs (écran « Équipe », en ligne : le PIN provisoire est tiré par le serveur et montré une seule fois).

**Gouvernance des déclarations** (multi-collaborateurs) :

- Le cahier appartient au **site**, pas à la personne ; chaque événement est signé (auteur + horodatage).
- Un **titulaire** par site (badge visible, cible des tâches et rappels) + remplaçants autorisés.
- **Affectations** (décisions du 2026-11-07) : l'admin seul affecte un collaborateur à un ou plusieurs sites, en ligne, depuis le bureau ; un collaborateur affecté y est remplaçant, et n'atteint que ses sites — sauf sur un site **sans titulaire**, où le collaborateur affecté **devient titulaire** (décision du 2026-11-07 : le cas courant, un site et un gardien, se fait en un geste, et aucun site ne reste sans titulaire par oubli). La règle ne joue qu'à l'affectation : un retrait ne promeut personne. L'admin n'est jamais affecté : il atteint déjà tous les sites de l'élevage. Désigner un titulaire l'affecte au site s'il n'y était pas, et **l'ancien titulaire devient remplaçant** : il garde l'accès, l'admin le retire à part s'il le faut. **Retirer le titulaire est permis** (gardien parti, téléphone volé) : le site reste sans titulaire jusqu'à la désignation ou l'affectation suivante — en mode strict, seul l'admin y déclare alors. Un retrait vaut dès la requête suivante. Chaque affectation, retrait ou désignation est tracé.
- Garde-fous anti-doublon : le journal du jour est visible avant toute saisie ; si un autre a déjà déclaré le même type aujourd'hui, la confirmation le dit à voix haute (« Ousmane a déjà écrit 3 morts. Tes 2 morts, c'est EN PLUS ? »). Le même rappel vaut pour le gardien lui-même (décision du 2026-11-06) : « Tu as déjà écrit 3 morts aujourd'hui. Tes 5 morts, c'est EN PLUS ? » — sans lui, un gardien qui recompte sa journée le soir déclarerait le total et non le supplément.
- **Mode strict** optionnel par site (seul le titulaire déclare) — un choix de l'admin, jamais une contrainte du produit : un verrou produit des trous de données ou du partage de PIN.
- Règle de partage : *les bêtes = le gardien, l'argent = l'admin* ; l'admin peut toujours suppléer.

## Principes UX fondateurs

L'app remplace **le cahier et la mémoire**, pas Excel. Chaque principe ci-dessous a été éprouvé en maquette interactive (journal-gardien.html, bureau-admin.html — références de design).

- **Trois canaux redondants** : picto + couleur + audio. L'audio = clips pré-enregistrés par langue (wolof puis français), jamais de synthèse vocale en production ; la TTS du navigateur ne sert qu'aux démos.
- **3 taps maximum** par déclaration ; on déclare des **changements d'état physiques** (un sac OUVERT, pas un repas ; un poulet mort, pas un taux).
- **L'interface imite l'objet réel** : l'aiguille de pesée réplique le cadran de la balance du site (modèle configuré par l'admin) ; le sac est dessiné d'après le vrai sac d'aliment ; l'argent s'affiche en billets et pièces FCFA ; les grands nombres se comptent en **paquets de 4 sur 5 colonnes**.
- **Affichage par phase de campagne** : un élément n'apparaît que lorsqu'il devient pertinent — carte livraison si une commande existe, demande de pesée si l'admin l'a planifiée, marge dès la première vente, bilan à la clôture.
- **Le zéro est une déclaration** : « Rien perdu hier » se déclare d'un tap (qualité de donnée : distinguer « zéro mort » de « pas de déclaration »). **Les morts d'un même jour s'ajoutent** : le gardien peut déclarer plusieurs fois, à chaque tournée (décision du 2026-11-06). « Rien perdu » est refusé un jour où des morts sont déjà écrits ; des morts écrits après un « rien perdu » l'emportent, et le jour affiche leur total.
- **La confiance est visible** : pastille de synchro (en attente → tampon « bien envoyé »), tampon animé à chaque validation, compteur de vivants décrémenté en direct.
- **Corrections** : libres sur le téléphone tant que la déclaration ne l'a jamais quitté (toucher une case, un crayon) ; si un envoi est en cours ou en doute, la ligne est verrouillée jusqu'à la réponse du serveur. Après envoi, uniquement par contre-déclaration tracée — jamais d'effacement — et **en ligne** (décision du 2026-11-06), pour le gardien comme pour l'admin : sans réseau, le crayon d'une ligne déjà envoyée est indisponible, et il le dit par picto et audio. Le gardien corrige les **trois jours de son cahier** (aujourd'hui, hier, avant-hier), comptés d'après la date de saisie de la correction, comme pour une déclaration : c'est l'horloge du téléphone qui compte (décision du 2026-11-06, prise pour un seul gardien par site ; à revoir si plusieurs téléphones corrigent le même cahier) ; l'admin corrige tout jour depuis la mise en place. Une contre-déclaration vise la déclaration d'origine (même site, même campagne, même jour, même type, même objet : ligne de commande, demande de pesée, tâche, média) et n'en remplace que les valeurs mesurées — quantité, poids, papier du livreur ; si plusieurs corrections se suivent, **la dernière écrite fait foi**, d'après la date de saisie des téléphones (décision du 2026-11-06). Le gardien peut corriger une ligne que l'admin a écrite à sa place : rien n'est modifié, la ligne de l'admin et la correction du gardien restent toutes deux au journal, chacune avec son auteur et ses deux dates. Chaque correction est signalée à l'admin avec l'ancienne et la nouvelle valeur, et une déclaration écrite pour un jour passé est marquée comme tardive. **Annulation** (décision du 2026-11-06) : une déclaration faite par erreur — double saisie, mauvais jour, mauvais geste — s'annule ; elle reste au journal, marquée annulée, et ne compte plus. **Seul l'admin annule pour le moment** (le gardien : voir « Points ouverts »), en ligne, pour tout jour depuis la mise en place et avant la clôture. L'annulation vise la déclaration d'origine et elle est **définitive** : une déclaration annulée ne se corrige plus et ne se rétablit pas, on redéclare. Elle l'emporte sur toute correction, quel que soit l'ordre d'arrivée et quelle que soit l'heure des appareils.
- **Design signé** : métaphore du cahier (pages lignées, couverture kraft, étiquettes scotchées, tampons encreurs), polices Andika (conçue pour les nouveaux lecteurs) + Shantell Sans (manuscrite), bande tissée aux couleurs locales, traits « tremblés », coins de carte en tampon. Les pictos sont **validés sur photo du terrain** (méthode éprouvée : sac, abreuvoir) — chaque objet dessiné doit être reconnu au premier regard par son utilisateur.

## Module V1 — le cahier du gardien

Un seul écran, tout visible sans défiler jusqu'aux gestes ; PWA hors-ligne sur Android bas de gamme.

**En-tête et contexte** : avatar + site ; Jour J avec jauge poussin→poule ; compteur de vivants (les poussins réellement reçus, moins chaque mort confirmé) ; pastille de synchro ; météo du jour avec conseil vocal (la chaleur déclenche la tâche bicarbonate).

**Cartes contextuelles** (apparaissent et disparaissent selon les événements) :

- *Livraison annoncée* : créée par la commande de l'admin ; comptage pré-rempli avec la quantité attendue ; écart signé dans les deux sens — manque (« le chef en attendait 40 ») ou **bonus** (« 50 de plus que la commande », cas réel des écloseries) ; puis **photo du PV de réception** (ou « pas de papier », sans blocage) ; une commande livrée en plusieurs fois garde sa carte ouverte — « reste 20 sacs à venir » — jusqu'à complétude ou clôture par l'admin.
- *Demande de pesée* : planifiée par l'admin ; 5 poulets, consigne anti-biais dans l'audio (« dans des coins différents, pas seulement les gros ») ; saisie à **l'aiguille** qui réplique la balance du site, pas de 50 g (une aide à la saisie : le poids s'enregistre au gramme près, pour accueillir plus tard une lecture exacte depuis la photo de la pesée), la voix relit chaque poids ; correction par case avant envoi ; moyenne calculée par l'app.
- *Rappel d'oubli* : si hier est vide — « Rien perdu hier » (zéro explicite) ou « Écrire pour hier ».

**Tâches du jour** : pastilles 1 tap = fait ; protocole sanitaire configuré par l'admin (vaccins par âge) + tâches déclenchées par la météo ; haut-parleur qui lit la liste.

**Gestes du cahier** : Mort (compteur visuel, poulets couchés qui s'empilent) ; Sac ouvert. **Prévenir le chef** : Parler (message vocal) ; Photo. Chaque envoi : relecture vocale → Oui/Non → tampon « C'est noté ».

**Rattrapage** : trois jours visibles (aujourd'hui / hier / avant-hier) avec mini-résumé par jour ; bannière d'avertissement vocal quand on écrit pour un jour passé. Cette limite de trois jours vaut pour le gardien : l'admin, qui peut toujours suppléer, déclare pour n'importe quel jour depuis la mise en place (décision du 2026-11-06). Personne ne déclare pour un jour futur ni pour un jour antérieur à la mise en place. Les trois jours se comptent depuis le moment de la saisie, pas depuis celui de la synchronisation : une déclaration restée hors-ligne n'est jamais refusée pour être arrivée tard. **Horloge du téléphone en avance** (décision du 2026-11-07) : un événement dont la date de saisie est postérieure à sa réception par le serveur — impossible si l'horloge était juste — est **accepté, et l'admin est prévenu** : un refus créerait un trou de donnée. Le serveur garde la date de saisie telle qu'écrite, à côté de sa propre date de réception. L'instant auquel juger un tel événement et le seuil d'alerte sont reportés (2026-11-07) : on suppose pour le moment que le gardien se connecte tous les jours, ce qui borne la dérive d'une horloge.

**Journal du jour** : lignes du cahier avec picto, auteur, statut (horloge → tampon), crayon de correction (mort, sac, réception).

**Hors-ligne** : intégral — voir Architecture.

## Module V1 — le bureau de l'admin

Même langage visuel, pensé pour un utilisateur qui lit : chiffres, saisies directes, densité. Quatre onglets.

**Jour** : Jour J, vivants, sélecteur de site ; **Engagé à date** et **Coût/poulet à date**, avec bouton d'écoute (mode accessible : certains admins clients seront analphabètes) ; alertes de base (seuil de mortalité 7 jours) ; **inbox du poulailler** : pesées à valider (poids éditables au clavier, moyenne recalculée en direct), vocaux à écouter, photos, synthèse des morts synchronisés.

**Argent** :

- Saisie d'un coût : type (chips du référentiel) + **date de la dépense** (défaut aujourd'hui, modifiable — saisie différée) + montant + **note longue** sur lignes de cahier (les commentaires sont une richesse, jamais tronqués) + **justificatif photo** (reçu) + **duplication en un tap** (pré-remplit le formulaire, n'ajoute jamais directement — cas type : frais Wave récurrents) + statut payé / à payer (défaut : payé ; « à payer » crée une dette envers le tiers choisi, réglable ensuite en une ou plusieurs fois). Tout coût est modifiable après coup (montant, statut, date, note) : chaque modification est une contre-écriture tracée, l'historique des états est conservé, et le passage « à payer » → payé se fait en un tap. Gère aussi les avances de collaborateurs (cas réel « payé par AS », remboursé plus tard : une dette interne tracée comme les autres).
- Liste des dépenses datées, mention « reçu ✓ », total engagé.
- **Qui doit quoi** : le grand livre des tiers, cœur de confiance du produit : alimenté par les commandes (reçu non payé = tu lui dois ; payé non reçu = il te doit), les coûts directs « à payer », les ventes à crédit (prêts de poulets, ramasseurs) et les avances de collaborateurs (« payé par AS ») ; règlements partiels ; soldes en francs et en nature, avec rappels.

**Budget de campagne** : prévisionnel par poste saisi à l'ouverture de la bande, **pré-rempli depuis l'historique** (coût/poussin des campagnes passées × effectif) ; l'onglet Argent affiche budget vs engagé par poste ; nourrit l'alerte de dépassement (module Analytics). Le budget est un plan, jamais une dette : il ne touche ni l'engagé ni le grand livre. S'y ajoutent les **échéances récurrentes** (salaire, eau) qui créent automatiquement la dette « à payer » à leur date, avec rappel.

**Commandes** : une commande est un **document multi-lignes**, comme un bon de commande — en-tête (fournisseur, date, référence) + lignes (article, quantité, prix unitaire). Cycle : brouillon → **annoncée au gardien** (notification + carte livraison) → **réceptions partielles multiples** (cumul par ligne ; la carte du gardien reste ouverte avec « reste N à venir » jusqu'à complétude ou clôture par l'admin) → **paiements découplés et multiples** (date, montant, moyen — espèces, Wave) → soldée. Écarts signés par ligne (manque / bonus) ; PV joint par réception. Le coût de campagne est reconnu **à la réception** (engagement) ; le paiement alimente la trésorerie et le solde fournisseur. Cas réel fondateur : commande du 12/10 multi-lignes reçue en trois livraisons (véto le 12, aliment le 14, poussins le 16), paiements à d'autres dates.

**Suivi** : KPI (coût/poulet, mortalité, Jécoulé/Jéprévu) ; **courbe de poids** réelle (pesées validées) vs objectif de la souche ; consommation d'aliment déclarée (sacs ouverts du gardien × poids du sac ÷ effectif) vs la table de la souche — journalière, cumulée et indice de consommation ; dès la première vente : marge en direct, prix de vente moyen, restant à vendre (affichage par phase — rien avant).

**Ventes** (V1, écran à maquetter sur le même modèle) : date, quantité, prix unitaire, acheteur, payé/à crédit (alimente les créances) ; gère les prêts de poulets.

## Modules V1 transverses

**Référentiels à deux niveaux.** Un socle standard géré par l'éditeur (Aliments, Poussins, Santé, Main-d'œuvre, Équipement, Nettoyage, Transport, Énergie/Eau, Frais financiers, Autres), non supprimable — il garantit les analyses comparables et le futur benchmark réseau. L'admin ajoute ses types (ex. Déplumage), chacun **rattaché à une catégorie du socle**. Chaque type porte un drapeau **fixe/variable** (pré-rempli sur le socle) qui alimentera l'Analytics, et un drapeau commandable (vrai pour Aliments, Poussins et Santé/Vétérinaires) : seuls les types commandables passent par le circuit commande → réception ; tous les autres sont des coûts directs. On archive, on ne supprime jamais un type utilisé ; renommer ne change que l'étiquette ; outil de fusion en V2 (cas réel : Gardiennage/Salaires). Le même patron vaut pour tous les référentiels : types de pertes (Morts, Manquants, Dons, Vols), unités, fournisseurs, produits vétérinaires — et les souches : référentiel éditeur des souches (Cobb 500, Ross 308…) portant la courbe de poids cible par âge et le protocole sanitaire par défaut ; chaque campagne référence sa souche, et l'espèce (poulet de chair, canard, pondeuse…) est un attribut de la souche. Le modèle d'événements est agnostique à l'espèce : seuls les référentiels changent. Le gardien ne voit jamais ces écrans. Valeurs par défaut : à la création du tenant, un catalogue de prix par article est pré-rempli (sac d'aliment, poussin, produits courants — gabarits régionaux de l'éditeur) ; il pré-remplit saisies et commandes, reste modifiable à tout moment, et s'auto-apprend : le dernier prix utilisé devient le défaut suivant.

**Notifications push (PWA).** Permission accordée pendant l'onboarding assisté ; chaque notification est doublée d'une carte dans l'app (le push est un accélérateur, jamais la source de vérité) ; un tap ouvre l'app qui **lit le message à voix haute** ; exclusion de l'optimisation batterie à l'installation (téléphones Tecno/Infinix/Itel) ; SMS de secours en V2 pour 2–3 alertes critiques. Cas d'usage : annonce de livraison, demande de pesée, rappel du soir si rien déclaré, vocal reçu côté admin, seuil de mortalité franchi.

**Partage du bilan (WhatsApp).** Un bouton génère une image du bilan de campagne, en deux versions selon l'audience : *investisseurs* (chiffres complets, quote-part) ou *groupe* (ratios et verdict, sans montants). Coût nul (image, pas de vidéo) ; c'est aussi le canal de croissance : chaque bilan partagé dans un groupe d'éleveurs est une démonstration du produit.

**Clôture de campagne.** Saisie des restes par l'admin (sacs entiers et demi-sac entamé — le gardien ne manipule jamais de fractions) ; transfert des restes vers la campagne suivante ; bilan final sur le modèle de l'onglet Résultats existant (poussins, pertes, coûts, revenus, coût/poulet, bénéfice, commentaire) ; archivage des médias selon leur classe ; alimente le partage du bilan.

## Architecture des données & hors-ligne

&#91;embedded content: voyage d'un événement · 5 étapes, 1 retour\]

Une déclaration devient un événement signé qui fait un seul voyage ; une correction après coup repart comme contre-déclaration, écrite en ligne, jamais comme modification.

- **Événement immuable** : UUID, auteur, site, campagne, type, quantité, **deux dates** (date métier choisie + date de saisie automatique, lue sur l'appareil). Le serveur y ajoute sa **date de réception**, posée à l'enregistrement en base (décision du 2026-11-06) : une date côté client, une date côté serveur, et aucune ne remplace l'autre.
- **Outbox hors-ligne** : les événements s'empilent localement (stockage persistant demandé), synchronisation dès le retour du réseau ; envoi **idempotent** — un doublon de synchro est ignoré grâce à l'UUID.
- **Corriger une ligne déjà envoyée demande le réseau** (décision du 2026-11-06) : une contre-déclaration ne passe pas par la file d'attente. Les trois jours du gardien et l'ordre des corrections se lisent à la date de saisie ; la date de réception du serveur reste à côté, pour la trace.
- Pas de réplication bidirectionnelle : on synchronise un **journal**, pas un état — deux déclarants produisent deux faits, jamais un conflit. C'est aussi ce qui réserve, pour une version ultérieure (décision fondateur, nov. 2026), un mode 100 % hors-ligne — consultation et calculs compris — sur les téléphones et ordinateurs des clients : il suffira de répliquer le journal dans les deux sens (borné par le rôle, need-to-know) et de calculer les vues localement avec le même code métier.
- Cache minimal côté gardien : référentiels du site, campagne en cours, clips audio — jamais de données financières.
- **L'admin ne perd pas une saisie faute de réseau** (décision du 2026-11-06) : un coût, un paiement, une vente ou une déclaration à la place du gardien s'enregistrent sur l'appareil et partent au retour du réseau. Le bureau dit de quand datent ses chiffres et distingue ce qui est en attente. Le reste (référentiels, modification d'une commande, clôture de campagne, création de comptes) demande le réseau. Pour le permettre, une écriture d'argent ne se modifie jamais : elle se corrige par une contre-écriture, comme une déclaration.
- Multi-tenant : cloisonnement par identifiant de tenant sur toutes les tables dès le premier jour, schéma partagé ; modules activés par feature flags.
- Les écarts (reçu vs commandé) sont **signés**, jamais bridés : un bonus est un écart positif.
- **Matin, midi, soir** (décision du 2026-11-06) : le journal ne porte aucun champ pour cela, et le gardien n'a pas de tap de plus. Le bureau indique si une déclaration faite le jour même l'a été le matin, le midi ou le soir, d'après son heure de saisie — c'est l'heure de la déclaration, pas celle de la mort. À revoir avec les pilotes : s'ils déclarent à chaque tournée, la donnée devient fiable d'elle-même ; sinon un champ facultatif s'ajoutera.
- **Les vivants partent des poussins réellement reçus**, bonus compris, jamais de l'effectif commandé (décision du 2026-11-06). Si un recomptage révèle ensuite des poussins manquants, l'admin les déclare plus tard comme une perte de type « Manquants » ; la réception n'est pas réécrite. **Une perte en poussins n'est pas une mort** (décision du 2026-11-06) : manquants et dons diminuent les vivants, mais ne comptent ni ne s'affichent parmi les morts — ni dans la mortalité, ni dans son alerte. **Le gardien ne déclare que les morts, et ne voit que les morts** ; manquants, dons et vols sont déclarés par l'admin seul et restent au bureau pour le moment. Les vols sont à part : ils se constatent à la fin de la campagne, et rien de particulier n'est prévu pour eux pour le moment. Des morts déclarés en nombre supérieur aux vivants sont **acceptés, et l'admin est alerté** (décision du 2026-11-06) : un refus créerait un trou dans la donnée de terrain.
- Le choix de la stack est détaillé dans le document d'architecture technique ; cette architecture logique n'impose rien, hormis une PWA côté client (hors-ligne + push).

## Médias & confidentialité

Deux classes de médias, deux cadences — et une règle (décision fondateur, nov. 2026) : **les images, on n'efface jamais, on archive** — elles serviront à entraîner les modèles ML du produit (une photo de pesée arrive déjà étiquetée : le poids déclaré au cadran). **Exception : les vocaux ne sont pas conservés** — purgés après traitement + délai ; mais leur **sujet est tracé à vie** : quand l'admin traite un vocal, il tague le sujet en un geste (chaleur, mortalité, aliment, eau, livraison, autre + note) et l'action prise — l'événement survit à l'audio dans le journal. Le passage chaud → archive reste automatique, jamais un ménage manuel. Et on garde, « on ne sait jamais » : clause CGU autorisant l'usage des images pour l'entraînement + conformité loi 2008-12 / CDP Sénégal — les reçus et PV photographiés portent des noms et des signatures.

| Classe | Exemples | Compression | Rétention |
| --- | --- | --- | --- |
| Preuve opérationnelle | Photos de pesée, photos de problème, messages vocaux | \~800 px / ≤ 90 s | Photos : archivage froid après validation + délai (défaut 30 j), jamais supprimées (réserve ML). Vocaux : purgés après traitement + délai — le sujet tagué et l'action restent au journal |
| Pièce justificative | Reçus d'achat, PV de réception | \~800 px | Conservée toute la durée utile (campagne + délai légal/contractuel) ; archivage froid après clôture ; jamais supprimée |

La donnée extraite (poids saisis, montants, quantités) est **permanente** ; seul le média a une durée de vie. Le PV est ce qui tranche un litige fournisseur.

**Confidentialité et sécurité** :

- Need-to-know : le téléphone du gardien ne contient jamais de données financières (ni coûts, ni ventes, ni investisseurs) — un téléphone perdu n'expose rien.
- PIN + avatar ; sessions par appareil ; audit complet (qui, quoi, quand, depuis quel appareil).
- Les partages sortants (bilan WhatsApp) sont sans montants par défaut (audience groupe).
- Données cloisonnées par tenant ; l'éleveur reste propriétaire de ses données, exportables (V2).

## Module Analytics financier (épinglé)

Chapitre à concevoir ensemble après la V1 ; les fondations sont posées dès la V1 (drapeau fixe/variable, dates métier, événements, pesées, seuil de mortalité simple).

**Périmètre visé** :

- **Coût de revient** : à date (déjà en V1) et **projeté fin de bande** (consommation restante estimée via courbe de croissance + stock de sacs + jours restants).
- **Marge** : en direct pendant les ventes (encaissé − engagé) et projetée à la clôture.
- **Alertes configurables** (seuils par tenant, défauts calibrés sur les 11 campagnes historiques) : écart de poids vs objectif souche ; dépassement de coût par poste vs budget ou vs campagne de référence ; durée de campagne vs cible ; mortalité 7 jours.
- **Analyse des coûts** : par poste et par kg produit, fixe/variable, point mort, bridge entre campagnes (prix vs volume).
- **Analyse des pertes** : par période du cycle (début/milieu/fin), coût réel d'une perte incluant l'aliment déjà ingéré.
- Comparaison multi-campagnes et multi-sites ; indice de consommation (sacs consommés ÷ kg produits) dès que les pesées sont régulières.

Posture statistique : avec peu de campagnes par tenant, descriptif honnête (médiane, étendue, indices) — pas de p-values ; les projections affichent toujours leur hypothèse.

## Feuille de route V2 / V3

**V2 — étendre** :

**Feuille de route confirmée (nov. 2026)** : V1 = une application *parfaite* pour le poulet de chair, validée sur les campagnes du fondateur. V2 = **pondeuses & œufs** + **fabrique d'aliment** — fort potentiel marché (beaucoup d'éleveurs pondeuses au Sénégal, et l'aliment pèse \~65–70 % du coût). Ensuite moutons/embouche et le reste. Tout ce qui suit est conçu pour que cette évolution soit un ajout (référentiels + un profil de cycle + quelques types d'événements), pas une refonte.

- Stock d'aliments et **fabrique d'aliment** : recettes (composition en intrants — maïs, soja, concentré…), lots de production (intrants consommés → sacs produits), **coût de revient par sac fabriqué** ; les sacs produits entrent au stock et sont consommés par les campagnes à ce coût, et l'Analytics compare fabriqué vs acheté (décision make-or-buy). Éleveurs-producteurs ; extension naturelle du « stock déporté ».
- OCR du cadran de balance : pré-remplit les poids, l'admin valide toujours.
- Accès **investisseur** en lecture (KPI de sa campagne, médias si les coûts le permettent) ; multi-devises EUR/FCFA et quote-parts (pratique réelle observée).
- Import de l'historique Excel à l'onboarding (avec nettoyage et fusion de types) ; export Excel « tu ne perds pas ton classeur, tu le récupères propre ».
- Langues audio supplémentaires (pulaar, bambara…) ; SMS de secours pour alertes critiques ; mode accessible admin enrichi (vue en billets des montants, à arbitrer avec les pilotes).
- Outil de fusion de types ; rappels de créances clients.

**V3 — écosystème** :

- **Woolunte Network** : messagerie du réseau, projets, diffusion automatisée des résultats et vidéos aux investisseurs (remplace la corvée WhatsApp manuelle).
- Benchmark anonymisé inter-éleveurs (rendu possible par le socle de référentiels commun).
- Dataset vision-poids : le protocole photo « poulet sur la balance, chiffre visible » auto-étiquette chaque image ; à l'échelle du réseau, actif propriétaire pour une estimation de poids par photo (toujours indicative, jamais décisionnelle).
  - **Pondeuses & œufs** (et autres cycles longs, canards compris) : même cœur — sites, journal du gardien, tiers, coûts, offline — avec un profil de cycle différent : production quotidienne d'œufs déclarée par le gardien (plateaux de 30, comptage par paquets), taux de ponte vs courbe de la souche, coût par œuf. Nouveaux référentiels, zéro refonte du modèle d'événements. Promu V2 (nov. 2026). Le référentiel de ponte est public (guides ISA Brown / Lohmann Brown, souches dominantes localement) : à transcrire comme la table Cobb — taux de ponte, poids d'œuf et conso (\~110 g/j) par semaine d'âge, de l'entrée en ponte (18–20 sem.) au pic (\~95 %) puis au déclin. Atout décisif : le suivi ne coûte aucun geste nouveau — les œufs sont déjà comptés pour la vente et l'effectif déjà tenu par les morts, donc taux de ponte réel vs courbe et alerte « chute de ponte » (le signal sanitaire le plus précoce en pondeuse) sont gratuits. L'économie s'inverse : trésorerie quotidienne (ventes d'œufs à clients réguliers, souvent à crédit) — le grand livre des tiers devient central ; indicateurs : coût par plateau, point mort en œufs/jour.
  - **Moutons & petits ruminants (embouche)** : le cousin le plus proche du poulet de chair — une campagne calée sur la Tabaski (achat de sujets → engraissement → vente avant la fête, date lunaire qui recule d'\~11 jours par an). Mêmes événements (achat, aliment, véto, pesée, mort, vente), mêmes commandes, budget et grand livre des tiers. La nouveauté structurante : le **suivi par tête** — chaque bélier est un individu avec sa valeur propre (race, photo, prix d'achat, courbe de poids, prix de vente négocié), donc un `animal_id` optionnel sur les événements, en plus de la bande. Référentiels : races (Ladoum, Bali-Bali, Touabire) avec GMQ cible au lieu de la table Cobb, protocole de déparasitage. Le naisseur (brebis, agnelage) relève du cycle long, comme les pondeuses.

## Modèle économique & déploiement

**Prix** : un prix par campagne plutôt qu'un abonnement mensuel — aligné sur la trésorerie de l'éleveur, qui encaisse en rafale à la fin de la bande. Le montant est paramétrable (par l'éditeur, par palier) et sera défini après confrontation avec le métier. Encaissement par mobile money (Wave, Orange Money). Paliers par modules activés par tenant (base / multi-sites / investisseurs) via feature flags.

**Validation** : une campagne en double tenue (Excel + app) sur les sites du fondateur, comparaison à la clôture ; puis 2–3 pilotes gratuits dans le groupe d'éleveurs. Le juge final de la vue gardien est un vrai gardien observé sur le terrain : chronométrer, noter chaque hésitation, itérer.

**Onboarding assisté** (en personne, par l'éditeur ou un superviseur) : installation de la PWA sur chaque téléphone, permission notifications, exclusion de l'optimisation batterie, création des comptes (téléphone + PIN + avatar), configuration du site (balance, protocole sanitaire, titulaire), import Excel le cas échéant. En V1, les tenants sont créés manuellement : ni self-signup, ni facturation automatique.

**Marque** : dépôt de la marque et du design (OAPI) avant commercialisation ; le nom « Woolunte » est pressenti pour l'app réseau, le nom du produit de pilotage reste à choisir.

## Points ouverts pour le développement

- [ ] **Champs spécifiques par type de coût** : chaque type porte son schéma de saisie (Aliments = nb de sacs × prix unitaire ; Poussins = effectif × PU ; Vétérinaires = produit + doses…) — à spécifier au démarrage du dev.
- [ ] Réseau chez les éleveurs pilotes : où font-ils leurs comptes, sur quel appareil, et combien de temps restent-ils sans aucun réseau (heures ou jours) ? La réponse décide si le bureau doit aller jusqu'au calcul local complet de ses chiffres.
- [ ] Horloge du téléphone en avance (reporté le 2026-11-07, pas urgent) : juger l'événement à sa date de réception plutôt qu'à sa date de saisie (proposition), et ne prévenir l'admin qu'au-delà d'un écart de 5 minutes (proposition, dans une constante). Hypothèse en attendant : le gardien se connecte tous les jours.
- [ ] Annulation par le gardien : aujourd'hui seul l'admin annule une déclaration faite par erreur (décision du 2026-11-06). À revoir : le gardien pourrait annuler dans ses trois jours, en ligne, comme il corrige — sinon une erreur attend que l'admin soit joignable.
- [ ] **Empreinte digitale à la connexion** (idée du fondateur, 2026-11-07) : un PIN à 4 chiffres ne tient que par le comptage des essais (au plus 24 essais par jour une fois l'attente à une heure, soit environ 200 jours en moyenne pour un numéro donné). Les passkeys du navigateur (WebAuthn) permettraient de déverrouiller avec le capteur du téléphone, sans rien stocker de biométrique côté serveur. À vérifier sur les téléphones des pilotes (Tecno, Infinix, Itel : capteur présent ? Chrome à jour ?) ; le PIN resterait la solution de secours.
- [ ] Modèles de balance par site : recenser les cadrans courants (peson 0–5 kg, 0–10 kg, digitale) pour que l'aiguille réplique fidèlement chaque modèle.
- [ ] Clips audio wolof : écrire le script complet des phrases de l'interface, enregistrer un locuteur, règle de composition des nombres.
- [ ] Import Excel : mapping des onglets existants (Couts, Pertes, Ventes, Commandes, Réceptions, Investissements, Capital, Résultats) vers les événements ; traiter les pièges connus (agrégats incrustés dans les commentaires, dates en série Excel, quantités négatives de report).
- [ ] Seuils d'alerte par défaut (mortalité 7 j, écart de poids) à calibrer sur les 11 campagnes historiques.
- [ ] Durée légale de conservation des pièces justificatives à confirmer localement.
- [ ] Représentation riche des montants pour admins analphabètes (vue en billets) — à trancher avec les pilotes.
- [ ] Table de référence Cobb 500 : transcrite (poids, conso journalière et cumulée, IC — J0 à J49) et branchée au Suivi ; faire de même à l'ajout de chaque souche.
  - [ ] Nom du produit et logo (dépôt OAPI, classes 9/35/42). Shortlist nov. 2026 — co-favoris : Yaar (élever/éduquer) et Sàmm (veiller sur le troupeau) ; challengers : Kayit (le papier/cahier), Natt (mesurer), Naat (prospérer). Vérifié : « Yaar » existe sur les stores (3 apps sociales indiennes — yaar = « pote » en hindi/ourdou), rien en agritech ni en Afrique → collision faible, hors classes et hors territoire ; anteriorité OAPI à faire avant dépôt. Départage : test oral avec 3 éleveurs + 2 gardiens. Décision logo (nov. 2026) : emblème illustré retenu tel quel (choix du fondateur) pour affiches, brochures et splash — à faire vectoriser proprement avant le dépôt OAPI ; icône app vectorielle d'après spec fondateur — carré arrondi vert forêt #1E4530, Y crème, soleil de 5 grains de maïs, deux courbes de champs, sans texte (la poignée reste sur l'emblème : illisible à 48 px) ; déclinaison tampon une encre pour les documents terrain ; slogans « Sa jur, sa koom » (wolof, terrain) / « Ton élevage, ta richesse » (FR). Emplacements dans l'app : petite marque « Y + Yaar » crème en bas de la couverture kraft (entête gardien et admin, comme la marque d'un vrai cahier) ; écran de lancement = l'icône en plein écran (Y crème, grains, courbes de champs) + nom + « Sa jur, sa koom » ; icône d'installation PWA (manifest 192/512 px, maskable) ; tampon rond une encre sur tout document qui sort (bilan partagé, PV, reçus imprimés) ; l'emblème illustré reste hors écrans de travail — réservé aux supports marketing et à l'accueil web.
- [ ] Choix de la stack technique — volontairement hors de ce document ; l'architecture logique (section dédiée) est indépendante de la stack.
- [ ] Sourcer le référentiel de ponte de la souche locale (ISA Brown / Lohmann Brown) et le transcrire comme la table Cobb (taux de ponte, poids d'œuf, conso par semaine d'âge).
