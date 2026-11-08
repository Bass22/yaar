# Premier lot d'enregistrements — liste à cocher

Les 32 phrases que l'application dit **déjà** : une fois enregistrées et converties, tu les entends dans l'appli, sur l'écran d'entrée et dans le cahier. Tiré de `audio/script.md`, qui reste la référence (et qui compte 368 phrases en tout).

## Comment nommer les fichiers

- **Un fichier par phrase**, nommé **exactement** par le nom en gras ci-dessous, suivi de l'extension que donne ton téléphone : `sign-in-wrong-pin.m4a`, `day-today.m4a`…
- **Tout en minuscules, des tirets, sans espace ni accent.** Pas de numéro devant, pas de « (1) », pas de « final ». Un nom faux est refusé par l'outil, qui te dit lequel.
- L'extension est libre : `.m4a`, `.mp3`, `.wav`, `.ogg`, `.aac`, `.amr`…
- L'application du téléphone nomme les fichiers à sa façon (« Nouvel enregistrement 12 ») : **enregistre dans l'ordre de cette liste**, puis renomme en cochant.
- **Un dossier par langue** : le français dans `audio/fr/`, le wolof dans `audio/wo/`. Le nom du fichier est **le même** dans les deux langues : `audio/fr/day-today.m4a` et `audio/wo/day-today.m4a`.
- **Pour réenregistrer** une phrase, remplace le fichier en gardant le même nom.
- Plus tard, les phrases qui ont un nombre auront un fichier par nombre, le nombre à la fin : `deaths-today-1`, `deaths-today-2`… `deaths-today-20`.

## Avant de commencer

- Une pièce calme, porte fermée, sans ventilateur, et le micro à 20 cm de la bouche, toujours à la même distance.
- **Une seconde de silence avant et après** chaque phrase : l'outil coupe les silences.
- Parle calmement, comme à quelqu'un dans le poulailler, sans lire d'un ton monotone.
- Garde tes fichiers originaux tels quels : ce sont eux qu'on met dans `audio/fr/`.

## Ensuite

```bash
brew install ffmpeg            # une seule fois
node tools/build-audio.mjs     # convertit, puis affiche « fr : 32 clips sur 368 »
```

---

## 1. L'écran d'entrée — le code (13)

- [ ] **sign-in-wrong-pin** — « Ce n'est pas le bon code. Essaie encore. »
- [ ] **sign-in-wait** — « Trop d'essais. Attends un peu, puis réessaie. »
- [ ] **sign-in-blocked** — « Ce compte est bloqué. Parle au chef. »
- [ ] **sign-in-choose-pin** — « C'est ta première fois. Choisis ton propre code, et garde-le pour toi. »
- [ ] **sign-in-type-new-code** — « Tape ton nouveau code. »
- [ ] **sign-in-type-new-code-again** — « Tape encore ton nouveau code. »
- [ ] **sign-in-codes-differ** — « Les deux codes ne sont pas pareils. Recommence. »
- [ ] **sign-in-pin-too-simple** — « Ce code est trop simple. Choisis-en un autre. »
- [ ] **sign-in-pin-already-chosen** — « Ton code est déjà choisi. Tape-le pour entrer. »
- [ ] **sign-in-pin-expired** — « Le code du chef n'est plus bon. Demande-lui un nouveau code. »
- [ ] **sign-in-phone-format** — « Le numéro s'écrit en entier, avec l'indicatif. »
- [ ] **sign-in-offline** — « Pas de réseau. Réessaie quand le téléphone a du réseau. »
- [ ] **server-unavailable** — « Le service ne répond pas. Réessaie plus tard. »

## 2. Le cahier (6)

- [ ] **day-today** — « Aujourd'hui. »
- [ ] **past-day-yesterday** — « Attention : tu écris pour hier. »
- [ ] **past-day-before-yesterday** — « Attention : tu écris pour avant-hier. »
- [ ] **campaign-young** — « Les petits. »
- [ ] **campaign-old** — « Les grands. »
- [ ] **no-campaign** — « Il n'y a pas de bande en ce moment. »

## 3. Déclarer des morts (9)

Le geste « Mort » : le compteur, la relecture, puis le tampon. Au-delà de 3 morts, la phrase se dit en morceaux avec les nombres : enregistre d'abord ces trois-là, le reste viendra.

- [ ] **deaths-how-many** — « Combien de morts ? Appuie sur plus pour en ajouter. »
- [ ] **deaths-today-1** — « 1 poulet mort aujourd'hui. »
- [ ] **deaths-today-2** — « 2 poulets morts aujourd'hui. »
- [ ] **deaths-today-3** — « 3 poulets morts aujourd'hui. »
- [ ] **confirm** — « C'est bien ça ? »
- [ ] **cancelled** — « D'accord, on n'écrit rien. »
- [ ] **written-thanks** — « C'est noté. Merci ! »
- [ ] **already-written-1** — « Il y a déjà 1 mort écrit pour ce jour. »
- [ ] **deaths-in-addition-1** — « Ton mort, c'est en plus ? »

## 4. Déclarer un sac ouvert (4)

Le geste « Sac ouvert » : même parcours que les morts. « C'est bien ça ? », « D'accord, on n'écrit rien » et « C'est noté. Merci ! » sont déjà dans la liste au-dessus.

- [ ] **bags-how-many** — « Combien de sacs ouverts ? »
- [ ] **bags-today-1** — « 1 sac ouvert aujourd'hui. »
- [ ] **bags-today-2** — « 2 sacs ouverts aujourd'hui. »
- [ ] **bags-today-3** — « 3 sacs ouverts aujourd'hui. »

---

## En wolof

La même liste, avec **les mêmes noms de fichiers**, dans `audio/wo/`. Écris d'abord la traduction dans la colonne « Wolof » de `audio/script.md` et fais-la relire. Ensuite, enregistre.
