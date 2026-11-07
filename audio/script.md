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
| `already-written-by-you-1` … `-20` | Tu as déjà écrit 1 mort pour ce jour. … 20 morts. | Avant le Oui, s'il en a déjà écrit — **de 1 à 20** | |
| `already-written-by-other-1` … `-20` | Un autre gardien a déjà écrit 1 mort pour ce jour. … | Avant le Oui, si un autre en a écrit — **de 1 à 20** | |
| `deaths-in-addition-1` … `-20` | Tes 1 mort, c'est en plus ? … Tes 20 morts, c'est en plus ? | Juste après le rappel — **de 1 à 20** (pour 1 : « Ton mort, c'est en plus ? ») | |

## 4. Déclarer un sac ouvert

| Id | Phrase | Quand | Wolof |
|---|---|---|---|
| `bags-how-many` | Combien de sacs ouverts ? | Le compteur des sacs s'ouvre | |
| `bags-today-1` … `-20` | 1 sac ouvert aujourd'hui. … | Confirmation — **de 1 à 20** | |
| `bags-yesterday-1` … `-20` | 1 sac ouvert hier. … | Confirmation pour hier — **de 1 à 20** | |
| `bags-before-yesterday-1` … `-20` | 1 sac ouvert avant-hier. … | Confirmation pour avant-hier — **de 1 à 20** | |

## 5. « Rien perdu »

| Id | Phrase | Quand | Wolof |
|---|---|---|---|
| `nothing-lost-reminder` | Hier, tu n'as rien déclaré. S'il n'y a eu aucun mort, appuie sur le bouton vert. Sinon, déclare pour hier. | Post-it du rappel d'oubli | |
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

## 8. Livraison

| Id | Phrase | Quand | Wolof |
|---|---|---|---|
| `delivery-announced` | Le chef a commandé des sacs d'aliment. Quand le camion arrive, appuie sur le bouton vert, et compte les sacs. | Carte de livraison annoncée | |
| `delivery-expected` | Sacs attendus : *nombre*. | Juste après — **composé** | |
| `delivery-how-many` | Combien de sacs reçus ? Sur l'écran, chaque paquet dessiné fait quatre sacs. Compte, et corrige si besoin. | Le compteur de réception s'ouvre | |
| `delivery-received` | Sacs reçus : *nombre*. | Confirmation — **composé** | |
| `delivery-short` | Attention : il en manque. Le chef en attendait plus. | Moins que commandé | |
| `delivery-bonus` | Il y en a plus que la commande : c'est un bonus. | Plus que commandé | |
| `delivery-paper` | Dernière chose : le papier du livreur. Prends-le en photo. S'il n'y a pas de papier, appuie sur le bouton gris. | Après le Oui de la réception | |
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
| `photo-take` | Prends la photo de ce que tu veux montrer au chef. | L'appareil photo s'ouvre | |
| `photo-sent` | C'est envoyé. Le chef va regarder ta photo. | Photo envoyée | |

## 11. Envoi et refus

| Id | Phrase | Quand | Wolof |
|---|---|---|---|
| `sync-all-sent` | Tout est bien envoyé. | Pastille touchée, rien n'attend | |
| `sync-waiting-1` … `-20` | 1 déclaration attend le réseau. … 20 déclarations attendent le réseau. | Pastille touchée — **de 1 à 20** | |
| `sync-waiting-many` | Déclarations qui attendent le réseau : *nombre*. | Au-delà de 20 — **composé** | |
| `sync-refused` | Le chef n'a pas pu accepter une déclaration. Regarde la ligne marquée, et parle au chef. | Un refus du serveur (G.5) | |
| `sync-sign-in-again` | Reconnecte-toi pour envoyer tes déclarations. Rien n'est perdu. | Session expirée | |
| `sync-stopped` | Ton compte ne peut plus envoyer. Parle au chef. Rien n'est perdu. | Session révoquée | |
| `storage-full` | Le téléphone n'arrive plus à garder tes déclarations. Appelle le chef. | Stockage indisponible (G.3) | |

## 12. Météo et tâches — exemples

Les tâches viennent du protocole sanitaire de chaque site, et la météo de sa source (décisions ouvertes, épique L) : leurs phrases définitives s'écriront avec L. Les exemples de la maquette, à enregistrer pour les pilotes :

| Id | Phrase | Quand | Wolof |
|---|---|---|---|
| `weather-hot` | Il fait très chaud aujourd'hui. Mets du bicarbonate dans l'eau des poulets, et vérifie l'ombre. | Forte chaleur | |
| `tasks-today` | Voici les tâches du jour. Appuie sur chacune quand elle est faite. | Section des tâches | |
| `task-vaccine` | Mets le vaccin dans l'eau, le matin. | Tâche vaccin | |
| `task-bicarbonate` | Ajoute le bicarbonate contre la chaleur. | Tâche bicarbonate | |
| `task-water` | Change l'eau des abreuvoirs, deux fois. | Tâche eau | |

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

**Volume total** : environ 385 fichiers par langue, dont 265 pour les phrases dites une fois par nombre (les jours de la bande de 1 à 60, les poulets de la pesée de 1 à 5, le reste de 1 à 20) — compter deux à trois heures d'enregistrement, pauses comprises, en une ou deux séances.
