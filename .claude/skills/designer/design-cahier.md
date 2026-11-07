# Design « cahier » — tokens et composants relevés dans les maquettes

Relevé de `journal-gardien.html` et `bureau-admin.html` (nov. 2026). Les maquettes font autorité : si ce fichier et une maquette divergent, la maquette a raison et ce fichier est à corriger. À terme, ces valeurs vivront dans `packages/design-system`.

## Couleurs

| Token | Valeur | Rôle |
|---|---|---|
| `--coquille` | `#FBF6EA` | Fond de page du cahier |
| `--papier` | `#FFFDF6` | Cartes, étiquettes, feuilles |
| `--paille` | `#F5E7C6` | Sélection active, avatar |
| `--mais` | `#E8B10A` | Progression (jauge du jour), contour de focus |
| `--pature` / `--pature-clair` | `#3E7C4F` / `#E4F0E6` | Vivant, fait, valider, livraison |
| `--alerte` / `--alerte-clair` | `#C84B38` / `#F8E3DD` | Mort, danger, enregistrement en cours |
| `--orange` / `--orange-clair` | `#D98A2B` / `#F8EBD8` | Attention, en attente, météo, « moins » |
| `--bleu` | `#3E6E8C` | Messages au chef (voix), pesée |
| `--terre` | `#6B4A2E` | Titres manuscrits, traits |
| `--encre` | `#3A3127` | Texte courant |
| `--kraft` / `--kraft-fonce` | `#C09258` / `#A87B42` | Couverture du cahier (en-tête) |
| `--ligne` | `rgba(107,74,46,.14)` | Lignes de cahier |
| violet (hors token) | `#8C86B8` / `#5F5894` sur `#EFEAF8` | Saisie pour un jour passé |
| post-it (hors token) | `#FCEFC9` | Rappel d'oubli |
| vert de la marque | `#054612` (`--color-splash`) | Icône du fondateur, écran de lancement, thème et fond du manifest (était `#1E4530` avant l'icône du fondateur, 2026-11-07) |

Les couleurs hors token sont à promouvoir en tokens au portage. Une couleur ne porte jamais seule un sens.

## Typographie

- **Andika** (400, 700) — texte courant ; conçue pour les nouveaux lecteurs.
- **Shantell Sans** (500, 700) — tout ce qui est « écrit à la main » : titres, libellés de gestes, nombres, tampons.
- Échelle relevée : libellés secondaires 0,66–0,85 rem ; courant 0,92–1,05 rem ; titres 1,08–1,25 rem ; poids lu 1,9 rem ; grand nombre du compteur 2,9 rem ; signes + et − 2,4 rem.

## Formes et matière

- **Bords tracés à la main** : rayons asymétriques, par exemple `255px 18px 225px 18px / 18px 225px 18px 255px` (classes `wob1`, `wob2`, `wob3`) ; ronds imparfaits `48% 52% 50% 50% / 52% 48% 53% 47%`.
- **Ombres dures, sans flou** : `2px 3px 0 rgba(58,49,39,.12)` au repos, jusqu'à `3px 4px 0 rgba(58,49,39,.3)` sur les gros boutons.
- **Légères rotations** alternées entre voisins : ±0,3° à ±1,1°.
- **Lignes de cahier** : `repeating-linear-gradient(0deg, transparent 0 27px, var(--ligne) 27px 28px)`.
- **Scotch** : pseudo-élément beige translucide `rgba(234,217,166,.75)`, incliné de 2 à 3°.
- **Pointillés** : séparateurs `1px dashed`, cadres « à remplir » `3px dashed`, bas de couverture `3px dashed`.
- **Bande tissée** aux couleurs locales en tête des feuilles (motif SVG `tissage`).
- **Tampon encreur** : rond, incliné de −10°, à chaque validation.

## Interaction et mouvement

- Appui : `translate(1–2px, 1–3px)` et ombre réduite — le bouton s'enfonce.
- Focus : contour 4 px `--mais` sur fond clair, `--encre` sur bouton coloré, décalé de 2 px.
- Durées : apparition d'un objet compté 0,18 s ; feuille montante 0,25 s ; tampon 0,4 s avec rebond. Rien au-delà.
- `prefers-reduced-motion: reduce` coupe animations et transitions.

## Composants du cahier du gardien

| Composant | Classe maquette | Notes |
|---|---|---|
| Couverture kraft | `.app-head` | Avatar, étiquette scotchée (nom + site), nuage de synchro avec pastille, marque « Y + Yaar » |
| Bandeau du jour | `.strip-jour` | Jour J, jauge poussin → poule, compteur de vivants qui « saute » à chaque mort |
| Trois jours | `.jours` / `.jour-card` | Aujourd'hui, hier, avant-hier, mini-résumé en pictos |
| Bannière jour passé | `.banner-passe` | Violette, pointillée, avec avertissement vocal |
| Rappel d'oubli | `.nudge` | Post-it : « Rien perdu hier » (vert) ou « Écrire pour hier » (orange) |
| Météo | `.strip-meteo` | Conseil vocal ; la chaleur déclenche une tâche |
| Tâches du jour | `.tache-chip` | Pastilles scotchées, un tap = fait, haut-parleur qui lit la liste |
| Gestes | `.geste` | Pancartes peintes, grille 2 × 2 : Mort, Sac ouvert, Parler, Photo |
| Carte contextuelle | `.livraison` (+ `.pesee`) | Verte pour une livraison annoncée, bleue pour une pesée demandée |
| Feuille | `.voile` + `.feuille` | Monte du bas ; titre, compteur, Oui / Non |
| Compteur | `.compteur`, `.pile`, `.btn-compte` | Les objets s'empilent ; boutons − et + de 74 px |
| Réception | `.pile.p-recu` | Paquets de 4 sur 5 colonnes |
| Pesée | `.slots`, `#cadran`, `.poids-lu` | 5 cases, aiguille au pas de 50 g, la voix relit chaque poids |
| Message vocal | `.btn-micro` | Rond de 108 px |
| Photo | `.viseur` | Cadre pointillé, devient vert une fois la photo prise |
| Confirmation | `.resume`, `.f-oui` / `.f-non` | Relecture vocale puis Oui (vert) / Non (gris) |
| Tampon | `.bravo` / `.tampon` | « C'est noté » |
| ~~Qui tient le cahier ?~~ | `.carte-compte` (`journal-gardien-entree.html`) | **Retiré le 2026-11-08** : un téléphone = une personne, l'entrée ne demande que le code. Ne pas réintroduire de choix de compte |
| Code | `.ronds`, `.pave`, `.touche` | Quatre ronds à remplir, touches de 72 px ; premier code tapé deux fois |
| Bandes | `.carte-bande`, `.intercalaires`, `.onglet`, `.tampon-bande` | Choix à l'ouverture si plusieurs bandes ; « les petits » (poussin) et « les grands » (poule) ; la confirmation redit la bande |
| Afficheur de pesée | `.afficheur` | Imite l'écran d'une balance digitale, chiffres entrés par la droite |
| Avatar | `.av` | Douze dessins (`avatar-*`), chacun sur sa couleur (liste `AVATARS`) |
| Ligne de journal | `.evt` | Picto, libellé, auteur, statut (horloge → tampon), crayon |

Tailles relevées : ligne de journal 56 px de haut au minimum ; coche de tâche 50 px ; ligne de saisie admin 48 px au minimum. **Sous le seuil de 48 px, à agrandir au portage** : crayon de correction (36 px), haut-parleur (40 px).

## Composants du bureau de l'admin

Même matière, plus dense. Quatre onglets en barre basse : Jour, Argent, Commandes, Suivi.

- **Jour** : KPI (`.kpi`, valeur `.k-val`, libellé `.k-lab`) avec bouton d'écoute, alerte, inbox du poulailler (pesées à valider avec poids éditables, vocaux, photos).
- **Argent** : chips de type de coût, champs montant (`.inp.montant`), note longue sur lignes de cahier (`.inp-note`), choix payé / à payer (`.paye-opt`), bouton de duplication (`.copie-btn`), grand livre des tiers avec badges « tu dois » / « il te doit » (`.s-badge`) et règlement (`.btn-regler`).
- **Commandes** : éditeur multi-lignes (`.lignes-saisie`), statuts de réception et de paiement.
- **Suivi** : courbe de poids réelle vs souche en SVG, lignes de consommation (`.conso-ligne`).

## Écarts connus entre maquette et production

| Dans la maquette | En production |
|---|---|
| `filter:url(#rough)` sur `.dessin` | Chemins SVG déformés au build |
| `@keyframes pulse` en `box-shadow` | Pulsation en `transform` / `opacity` |
| Polices chargées depuis un CDN | woff2 auto-hébergé et précaché |
| `speechSynthesis` | Clips pré-enregistrés par langue |
| Cadre de téléphone et barre de démo | Supprimés |
