# Script audio du cahier du gardien

Toutes les phrases que le téléphone dit au gardien (backlog I.3), à enregistrer dans chaque langue : le français d'abord, puis le wolof. Tiré de la maquette `journal-gardien.html` et du cahier des charges ; écrit le 2026-11-07.

Le gardien ne lit pas forcément : **la voix porte le sens**, avec le picto et la couleur. Chaque phrase doit se comprendre seule, dite une fois, sans l'écran.

## Le principe : la phrase entière d'abord

Décision du 2026-11-07 (cahier des charges, « Trois canaux redondants » ; backlog I.1) :

- **Toute phrase fixe s'enregistre entière**, d'un seul tenant. C'est presque tout ce script.
- **Les phrases fréquentes avec un petit nombre s'enregistrent entières aussi**, une fois par nombre, de 1 à 20 : « 3 poulets morts aujourd'hui ». Ce seuil de 20 se règle à l'écoute, avec le locuteur et les pilotes.
- **Au-delà, la phrase se compose**, le nombre placé en fin de phrase (« Sacs reçus : quarante. »). Les nombres sont enregistrés à part (annexe).
- **On coupe entre deux phrases, jamais au milieu** : « 3 poulets morts aujourd'hui. » puis « C'est bien ça ? » sont deux clips — une pause entre deux phrases s'entend comme naturelle.
- **Aucun prénom** n'est enregistré : on ne peut pas enregistrer d'avance le nom de chaque gardien. La maquette disait « Merci Ousmane ! » ; le script dit « Merci ! ».

Le code cherche d'abord la phrase entière, puis la compose si elle n'existe pas : enregistrer plus tard une phrase entière de plus ne demande aucun code.

## Comment enregistrer

- **Qui** : **le fondateur** (décision du 2026-11-07), pour le français comme pour le wolof — toujours disponible pour réenregistrer une phrase, et toujours la même voix. La traduction wolof est **relue par un autre locuteur** avant la séance : un deuxième avis sur les tournures évite les phrases ambiguës. Le premier lot d'essai (une vingtaine de clips) est écouté par deux ou trois gardiens : comprennent-ils tout, et la voix leur va-t-elle ?
- **Avec quoi** : un téléphone et son application d'enregistrement vocal suffisent. Pièce calme, porte fermée, sans ventilateur ; micro à 20 cm de la bouche, toujours à la même distance.
- **Comment** : un fichier par ligne du tableau, nommé par son identifiant (`deaths-confirm.m4a`). Dire la phrase calmement, sans lire d'un ton monotone, comme on parle à quelqu'un dans le poulailler. Laisser une seconde de silence avant et après : le découpage se fait ensuite.
- **Les nombres dans une phrase** : pour une ligne marquée « de 1 à 20 », enregistrer vingt fichiers, `deaths-today-1`, `deaths-today-2`… ; accorder la phrase au nombre (« 1 poulet mort », « 2 poulets morts »).
- **Le wolof** : traduire le sens, pas les mots. Si une tournure sonne mieux autrement, la changer, et l'écrire dans la colonne « Wolof ». Pour les nombres, dire comme on compte au quotidien (le wolof compte par cinq : *juróom benn* pour six) — le locuteur fixe la règle, l'annexe la recueille.
- **Garder ce qui pourra servir plus tard** (décision du 2026-11-07 : une voix IA pourrait un jour produire de nouveaux clips à partir de ces enregistrements) :
  - **les fichiers originaux, en qualité maximale**, tels qu'enregistrés, à côté des clips compressés que l'application utilise ;
  - **le texte exact de chaque clip** : celui de ce script, corrigé si le locuteur a changé une tournure ;
  - pas d'autorisation à faire signer tant que la voix est celle du fondateur ; si une autre voix enregistre un jour, **son autorisation écrite** est signée avant la séance, et couvre l'application *et* l'entraînement d'une IA avec sa voix ;
  - **toujours la même voix, le même micro, la même pièce calme** : des enregistrements homogènes.
- **Ensuite** : les fichiers reviennent dans `audio/wo/` (ou `audio/fr/`), nommés par leur identifiant, dans n'importe quel format audio courant (m4a, mp3, wav, ogg…). `node tools/build-audio.mjs` les découpe (silences du début et de la fin), égalise leur volume et les convertit en **Opus mono à 24 kb/s** (décision du 2026-11-07), dans `apps/web/public/audio/<langue>/`, avec la liste de ce qui est enregistré. Il demande **ffmpeg** sur l'ordinateur (`brew install ffmpeg`). Un fichier dont le nom n'est pas dans ce script est refusé ; une phrase que l'écran demande et qui n'est pas encore enregistrée est signalée, jamais coupée.

Colonnes : **Id** — le nom du fichier, lu tel quel par l'outillage (`tools/audio-script.mjs`) : un identifiant entre accents graves, une liste séparée par des virgules, ou une suite `deaths-today-1` … `-20` ; **Phrase** — le français à dire ; **Quand** — le moment où le téléphone la dit ; **Wolof** — à remplir par le traducteur.

---

## 1. Connexion

| Id | Phrase | Quand | Wolof |
|---|---|---|---|
| `sign-in-welcome` | Bonjour. Tape ton code. | L'écran de connexion s'ouvre | |
| `sign-in-wrong-pin` | Ce n'est pas le bon code. Essaie encore. | Code faux | |
| `sign-in-wait` | Trop d'essais. Attends un peu, puis réessaie. | Trop d'essais : attente | |
| `sign-in-blocked` | Ce compte est bloqué. Parle au chef. | Compte bloqué | |
| `sign-in-choose-pin` | C'est ta première fois. Choisis ton propre code, et garde-le pour toi. | Premier PIN à choisir | |
| `sign-in-pin-too-simple` | Ce code est trop simple. Choisis-en un autre. | PIN trop simple | |
| `sign-in-pin-expired` | Le code du chef n'est plus bon. Demande-lui un nouveau code. | PIN provisoire expiré | |
| `sign-in-offline` | Pas de réseau. Réessaie quand le téléphone a du réseau. | Connexion sans réseau | |
| `sign-in-pin-already-chosen` | Ton code est déjà choisi. Tape-le pour entrer. | Premier code déjà choisi | |
| `sign-in-phone-format` | Le numéro s'écrit en entier, avec l'indicatif. | Numéro mal écrit | |
| `server-unavailable` | Le service ne répond pas. Réessaie plus tard. | Le serveur ne répond pas | |

## 1 bis. Écrans d'entrée (conçus le 2026-11-07, `journal-gardien-entree.html`)

Un téléphone = une personne (décision du 2026-11-08) : l'entrée ne demande que le code, sans choix de compte ; les dessins des comptes ne se disent donc pas.

| Id | Phrase | Quand | Wolof |
|---|---|---|---|
| `sign-in-type-code` | Tape ton code. | Le pavé du code s'ouvre | |
| `sign-in-type-new-code` | Tape ton nouveau code. | Premier code, deuxième étape | |
| `sign-in-type-new-code-again` | Tape encore ton nouveau code. | Premier code, troisième étape | |
| `sign-in-codes-differ` | Les deux codes ne sont pas pareils. Recommence. | Les deux saisies du nouveau code diffèrent | |
| `campaign-young` | Les petits. | Carte ou onglet de la bande la plus jeune | |
| `campaign-old` | Les grands. | Carte ou onglet de la bande la plus vieille | |
| `weighing-type-display` | Tape le poids que montre la balance. | L'afficheur de la pesée s'ouvre (remplace `weighing-type-weight`) | |
| `weighing-implausible` | Ce poids paraît faux. Regarde encore la balance. | Poids hors des bornes de l'espèce | |

## 2. Le cahier du jour

| Id | Phrase | Quand | Wolof |
|---|---|---|---|
| `notebook-open` | Voici ton cahier. | Le cahier s'ouvre | |
| `day-today` | Aujourd'hui. | Onglet du jour touché | |
| `day-yesterday` | Hier. | Onglet touché | |
| `day-before-yesterday` | Avant-hier. | Onglet touché | |
| `past-day-yesterday` | Attention : tu écris pour hier. | Bannière du jour passé | |
| `past-day-before-yesterday` | Attention : tu écris pour avant-hier. | Bannière du jour passé | |
| `no-campaign` | Il n'y a pas de bande en ce moment. | Site sans campagne en cours | |
| `choose-campaign` | Il y a plusieurs bandes. Choisis la bande. | Plusieurs campagnes en cours — écran à dessiner avec `/designer` | |
| `campaign-day-1` … `campaign-day-60` | Jour 1 de la bande. … Jour 60 de la bande. | Bandeau du jour touché — **de 1 à 60 en entier** | |
| `live-count` | Poulets vivants : *nombre*. | Compteur de vivants touché — **composé** (grand nombre, annexe) | |

## 3. Déclarer des morts

| Id | Phrase | Quand | Wolof |
|---|---|---|---|
| `deaths-how-many` | Combien de morts ? Appuie sur plus pour en ajouter. | Le compteur des morts s'ouvre | |
| `deaths-today-1` … `-20` | 1 poulet mort aujourd'hui. … 20 poulets morts aujourd'hui. | Confirmation — **de 1 à 20 en entier** | |
| `deaths-yesterday-1` … `-20` | 1 poulet mort hier. … | Confirmation pour hier — **de 1 à 20** | |
| `deaths-before-yesterday-1` … `-20` | 1 poulet mort avant-hier. … | Confirmation pour avant-hier — **de 1 à 20** | |
| `deaths-many` | Poulets morts : *nombre*. | Au-delà de 20 — **composé** | |
| `confirm` | C'est bien ça ? | Après la phrase de confirmation | |
| `already-written-1` … `-20` | Il y a déjà 1 mort écrit pour ce jour. … Il y a déjà 20 morts écrits pour ce jour. | Avant le Oui, si des morts sont déjà écrits ce jour-là, par lui ou par un autre : **la somme seule** (décision du 2026-11-08) — **de 1 à 20** | |
| `already-written-many` | Morts déjà écrits pour ce jour : *nombre*. | Au-delà de 20 — **composé** | |
| `deaths-in-addition-1` … `-20` | Tes 1 mort, c'est en plus ? … Tes 20 morts, c'est en plus ? | Juste après le rappel, à la place de « C'est bien ça ? » — **de 1 à 20** (pour 1 : « Ton mort, c'est en plus ? ») | |
| `deaths-in-addition-many` | Tes morts, c'est en plus ? | Au-delà de 20 : le nombre vient d'être dit | |

## 4. Déclarer un sac ouvert

| Id | Phrase | Quand | Wolof |
|---|---|---|---|
| `bags-how-many` | Combien de sacs ouverts ? | Le compteur des sacs s'ouvre | |
| `bags-today-1` … `-20` | 1 sac ouvert aujourd'hui. … | Confirmation — **de 1 à 20** | |
| `bags-yesterday-1` … `-20` | 1 sac ouvert hier. … | Confirmation pour hier — **de 1 à 20** | |
| `bags-before-yesterday-1` … `-20` | 1 sac ouvert avant-hier. … | Confirmation pour avant-hier — **de 1 à 20** | |
| `bags-many` | Sacs ouverts : *nombre*. | Au-delà de 20 — **composé**, suivi de `confirm` | |
| `bags-already-written-1` … `-20` | Il y a déjà 1 sac ouvert écrit pour ce jour. … Il y a déjà 20 sacs ouverts écrits pour ce jour. | Avant le Oui, si des sacs ouverts sont déjà écrits ce jour-là, par lui ou par un autre : **la somme seule** (K.3) — **de 1 à 20** | |
| `bags-already-written-many` | Sacs ouverts déjà écrits pour ce jour : *nombre*. | Au-delà de 20 — **composé** | |
| `bags-in-addition-1` … `-20` | Ton sac, c'est en plus ? … Tes 20 sacs, c'est en plus ? | Juste après le rappel, à la place de « C'est bien ça ? » — **de 1 à 20** | |
| `bags-in-addition-many` | Tes sacs, c'est en plus ? | Au-delà de 20 : le nombre vient d'être dit | |

## 5. « Rien perdu »

| Id | Phrase | Quand | Wolof |
|---|---|---|---|
| `nothing-lost-reminder` | Pour hier, les morts ne sont pas écrits. S'il n'y a eu aucun mort, appuie sur le bouton vert. Sinon, écris les morts d'hier. | Post-it du rappel d'oubli | |
| `nothing-lost-done` | C'est noté : hier, rien de perdu. Merci ! | Après « Rien perdu hier » | |
| `nothing-lost-refused` | Des morts sont déjà écrits pour ce jour : on ne peut plus dire rien perdu. | « Rien perdu » refusé | |

## 6. Après une déclaration

| Id | Phrase | Quand | Wolof |
|---|---|---|---|
| `written-thanks` | C'est noté. Merci ! | Le tampon s'abat | |
| `written-well-done` | C'est noté. Bien joué ! | Tâche faite | |
| `cancelled` | D'accord, on n'écrit rien. | Non sur la confirmation | |

## 7. Corriger

| Id | Phrase | Quand | Wolof |
|---|---|---|---|
| `correct-how-many` | Corrige le nombre, puis appuie sur le bouton vert. | Le crayon est touché | |
| `corrected` | C'est corrigé. Merci ! | Correction envoyée | |
| `correct-needs-network` | Pour corriger, il faut du réseau. Réessaie quand le téléphone en a. | Crayon touché sans réseau | |
| `correct-too-old` | Ce jour est trop ancien pour corriger. Parle au chef. | Au-delà des trois jours | |
| `correct-wait-sending` | Cette ligne part en ce moment. Attends un peu, puis corrige. | Crayon touché pendant un envoi en doute (K.5) | |
| `correct-refused` | Le chef n'a pas pu accepter cette correction. Parle au chef. | Une correction refusée par le serveur, pour une autre raison que le jour trop ancien (K.5) | |

## 8. Livraison

| Id | Phrase | Quand | Wolof |
|---|---|---|---|
| `delivery-announced` | Le chef a commandé. Quand le camion arrive, appuie sur le bouton vert, et compte ce qui est arrivé. | Carte de livraison annoncée (Q.7 : une carte pour toutes les lignes attendues) | |
| `delivery-choose` | Qu'est-ce que le camion a apporté ? Touche chaque chose, puis appuie sur « Je compte ». | Plusieurs lignes attendues : le choix s'ouvre (Q.7) | |
| `delivery-how-many` | Combien de sacs reçus ? Sur l'écran, chaque paquet dessiné fait quatre sacs. Compte, et corrige si besoin. | Le compteur s'ouvre sur des sacs | |
| `delivery-how-many-boxes` | Combien de cartons de poussins reçus ? Compte les cartons. | Le compteur s'ouvre sur des cartons de poussins (Q.7) | |
| `delivery-how-many-units` | Combien en as-tu reçu ? Compte, et corrige si besoin. | Le compteur s'ouvre sur autre chose (Q.7) | |
| `delivery-received` | Sacs reçus : *nombre*. | Relecture, des sacs — **composé** | |
| `delivery-received-boxes` | Cartons reçus : *nombre*. | Relecture, des cartons — **composé** | |
| `delivery-received-units` | Reçus : *nombre*. | Relecture, autre chose — **composé** | |
| `delivery-short` | Attention : il en manque. | Moins que ce qui restait à venir | |
| `delivery-expected` | Le chef en attendait : *nombre*. | Juste après le manque — **composé** (le nombre dans l'unité comptée) | |
| `delivery-bonus` | Il y en a plus que la commande : c'est un bonus. | Plus que ce qui restait à venir | |
| `delivery-paper` | Dernière chose : le papier du livreur. Prends-le en photo. S'il n'y a pas de papier, appuie sur le bouton gris. | Après la dernière ligne comptée | |
| `delivery-paper-camera-refused` | L'appareil photo ne s'ouvre pas. Appuie sur « Pas de papier », et garde le papier pour le chef. | Photo du papier illisible (Q.8) | |
| `delivery-paper-saved` | C'est noté, et le papier est bien gardé. Merci ! | Réception avec papier | |

## 9. Pesée

| Id | Phrase | Quand | Wolof |
|---|---|---|---|
| `weighing-requested` | Le chef demande la pesée. Attrape cinq poulets, un par un, dans des coins différents. Pas seulement les gros ! | Carte de demande de pesée | |
| `weighing-type-weight` | Pèse le poulet, puis tape le poids qu'affiche ta balance. | Avant chaque poulet (la balance n'est pas modélisée : décision du 2026-11-07) | |
| `weighing-chicken-1` … `-5` | Poulet 1. … Poulet 5. | Avant le poids lu — **de 1 à 5** | |
| *(composé)* | *kilos* kilo *grammes*. | Le poids relu — **composé** des nombres et des unités de l'annexe, aucun fichier à lui | |
| `weighing-next` | C'est noté. Poulet suivant. | Poids validé, il en manque | |
| `weighing-all-done` | C'est tout bon. Appuie sur Envoyer. | Cinq poids pris | |
| `weighing-sent` | C'est envoyé. Le chef suit la croissance. | Pesée envoyée | |

## 10. Message vocal et photo

| Id | Phrase | Quand | Wolof |
|---|---|---|---|
| `voice-speak` | Parle, j'écoute. Le chef recevra ton message. | Le micro s'ouvre | |
| `voice-sent` | C'est envoyé. Le chef va écouter ton message. | Message envoyé | |
| `talk-no-chef` | Le numéro du chef n'est pas encore dans le cahier. Appelle-le directement. | « Parler » touché sans admin à joindre (M.5) | |
| `photo-take` | Prends la photo de ce que tu veux montrer au chef. | L'appareil photo s'ouvre | |
| `photo-sent` | C'est noté. Le chef verra ta photo. | Photo gardée sur le téléphone, elle part avec le réseau (M.3 ; « envoyé » serait faux sans réseau) | |
| `photo-camera-refused` | L'appareil photo ne s'ouvre pas. Appelle le chef pour qu'il t'aide. | Appareil photo refusé ou en panne (M.3) | |
| `photo-phone-full` | Le téléphone est plein de photos qui attendent le réseau. Va où il y a du réseau, puis recommence. | Trop de photos en attente (M.2) | |

## 11. Envoi et refus

| Id | Phrase | Quand | Wolof |
|---|---|---|---|
| `sync-all-sent` | Tout est bien envoyé. | Pastille touchée, rien n'attend | |
| `sync-waiting-1` … `-20` | 1 déclaration attend le réseau. … 20 déclarations attendent le réseau. | Pastille touchée — **de 1 à 20** | |
| `sync-waiting-many` | Déclarations qui attendent le réseau : *nombre*. | Au-delà de 20 — **composé** | |
| `sync-refused` | Le chef n'a pas pu accepter une déclaration. Il l'a reçue, il s'en occupe. | Une déclaration refusée par le serveur (G.5) | |
| `sync-refused-too-old` | Ce jour est trop ancien. Le chef a reçu ta déclaration, il s'en occupe. | Refusée parce que hors des trois jours du cahier (G.5) | |
| `sync-sign-in-again` | Reconnecte-toi pour envoyer tes déclarations. Rien n'est perdu. | Session expirée | |
| `sync-stopped` | Ton compte ne peut plus envoyer. Parle au chef. Rien n'est perdu. | Session révoquée | |
| `storage-full` | Le téléphone n'arrive plus à garder tes déclarations. Appelle le chef. | Stockage indisponible (G.3) | |

## 12. Météo et tâches — exemples

Les tâches viennent du protocole sanitaire de chaque site, et la météo de sa source (décisions ouvertes, épique L) : leurs phrases définitives s'écriront avec L. Les exemples de la maquette, à enregistrer pour les pilotes :

| Id | Phrase | Quand | Wolof |
|---|---|---|---|
| `weather-hot` | Il fait très chaud aujourd'hui. Mets de la glace dans l'eau, et vérifie l'ombre. | Forte chaleur | |
| `tasks-today` | Voici les tâches du jour. Appuie sur chacune quand elle est faite. | Section des tâches | |
| `task-vaccine` | Mets le vaccin dans l'eau, le matin. | Tâche vaccin | |
| `task-bicarbonate` | Ajoute le bicarbonate dans l'eau. | Tâche bicarbonate | |
| `task-water` | Change l'eau des abreuvoirs, deux fois. | Tâche eau | |


## 13. Le bureau — les dépenses

Le gérant qui ne lit pas entend la relecture avant tout Oui d'argent (`bureau-admin-v2.html`, écrans 7 à 9 ; P.4). Le nom d'un type propre à l'élevage ne s'enregistre pas d'avance : la voix dit sa catégorie.

| Id | Phrase | Quand | Wolof |
|---|---|---|---|
| `cost-what` | Tu as dépensé pour quoi ? | Le geste d'une dépense s'ouvre | |
| `cost-how-much` | Combien ? | Le pavé s'ouvre | |
| `cost-category-feed` | De l'aliment. | Relecture, catégorie Aliments | |
| `cost-category-chicks` | Des poussins. | Relecture, catégorie Poussins | |
| `cost-category-health` | Des vaccins et des soins. | Relecture, catégorie Santé | |
| `cost-category-bedding` | De la litière. | Relecture, catégorie Literie | |
| `cost-category-labour` | Un salaire. | Relecture, catégorie Main-d'œuvre | |
| `cost-category-equipment` | Du matériel. | Relecture, catégorie Équipement | |
| `cost-category-cleaning` | Le nettoyage. | Relecture, catégorie Nettoyage | |
| `cost-category-transport` | Du transport. | Relecture, catégorie Transport | |
| `cost-category-processing` | La transformation. | Relecture, catégorie Transformation | |
| `cost-category-utilities` | L'eau et l'électricité. | Relecture, catégorie Énergie/Eau | |
| `cost-category-financial-charges` | Des frais financiers. | Relecture, catégorie Frais financiers | |
| `cost-category-other` | Autre chose. | Relecture, catégorie Autres | |
| `money-amount` | Montant : *nombre* francs. | Relecture — **composé** : la phrase, le nombre, puis `money-francs` | |
| `money-francs` | francs. | Après un nombre d'argent | |
| `cost-paid` | Payé. | Relecture d'une dépense payée | |
| `cost-to-pay` | À payer plus tard. | Relecture d'une dépense à payer | |
| `committed` | Engagé à date : *nombre* francs. | Bouton d'écoute de l'engagé — **composé** | |
| `cost-per-bird` | Coût par poulet : *nombre* francs. | Bouton d'écoute du coût par poulet — **composé** | |
| `cost-per-bird-unknown` | Le coût par poulet n'est pas encore connu : les poussins ne sont pas encore comptés. | Coût par poulet absent | |

## 14. Le bureau — qui doit quoi

Le sens de la dette se dit avant le montant (`bureau-admin-v2.html`, écran 10 ; R.3). Le nom du tiers viendra de son enregistrement (N.3b).

| Id | Phrase | Quand | Wolof |
|---|---|---|---|
| `ledger-you-owe` | Tu dois : *nombre* francs. | Une ligne où l'élevage doit — **composé**, puis `money-francs` | |
| `ledger-owes-you` | On te doit : *nombre* francs. | Une ligne où le tiers doit — **composé**, puis `money-francs` | |
| `ledger-settled` | C'est soldé. Personne ne doit rien. | Une ligne soldée | |
| `ledger-total-you-owe` | En tout, tu dois : *nombre* francs. | Total en tête — **composé** | |
| `ledger-total-owed-to-you` | En tout, on te doit : *nombre* francs. | Total en tête — **composé** | |
| `settle-how-much` | Combien as-tu réglé ? | Le règlement s'ouvre | |
| `settle-to` | Tu as donné : *nombre* francs. | Relecture d'un règlement donné — **composé** | |
| `settle-from` | Tu as reçu : *nombre* francs. | Relecture d'un règlement reçu — **composé** | |

---

## Annexe — les nombres, pour composer

Enregistrés **seuls**, chacun dans un fichier, avec l'intonation d'une fin de phrase (« Sacs reçus : quarante. »). Ils servent au-delà de 20 et pour les poids. Le locuteur wolof dit comment on compose un nombre dans sa langue ; on complète cette liste avec lui.

| Id | À dire | Wolof |
|---|---|---|
| `number-0` … `number-20` | zéro, un, deux… vingt | |
| `number-30`, `number-40`, … `number-90` | trente, quarante… quatre-vingt-dix | |
| `number-100`, `number-200`, … `number-900` | cent, deux cents… neuf cents | |
| `number-1000`, `number-2000`, … `number-9000` | mille, deux mille… neuf mille | |
| `number-and` | et (« vingt et un », si la langue le demande) | |
| `unit-kilo`, `unit-kilos` | kilo, kilos | |
| `unit-grams` | grammes | |

**Volume total** : environ 451 fichiers par langue, dont 285 pour les phrases dites une fois par nombre (les jours de la bande de 1 à 60, les poulets de la pesée de 1 à 5, le reste de 1 à 20) — compter deux à trois heures d'enregistrement, pauses comprises, en une ou deux séances.
