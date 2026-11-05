# Kit maison

Briques génériques communes aux produits de la maison (Yaar, ERP Travaux) : montants, résultat typé, identifiants typés, horloge. Le kit vit dans ce dépôt le temps de savoir ce qu'il doit contenir ; il est écrit pour pouvoir en sortir un jour sans retouche, en déplaçant ce dossier dans un dépôt à part.

## Règles d'admission

Une brique entre dans le kit si un autre produit l'utiliserait **telle quelle**.

1. **Aucun vocabulaire métier.** Ni campagne, ni gardien, ni chantier : `Money` oui, `Debt` non.
2. **Aucun import hors du kit.** Ni le reste du workspace, ni un framework, ni un paquet npm. Seuls les tests importent `vitest`.
3. **Aucune API propre à Node ni au navigateur.** Le kit tourne à l'identique sur le serveur et sur le téléphone. Le code livré se compile sans les types de Node ni du DOM (`tsconfig.lib.json`) : `process`, `Buffer`, `window` ou `node:fs` font échouer `npx nx typecheck kit`.
4. **Reprise avec ses tests.** Une brique arrive de build-track avec ses tests, narrés en français.
5. **Provenance notée.** Chaque fichier de `src/` (hors tests et `index.ts`) a sa ligne dans le tableau ci-dessous, sans quoi `npm test` échoue.

Les règles 2 et 5 sont vérifiées par `tools/workspace.spec.mjs`, la règle 3 par le typage.

## Provenance

Dépôt d'origine : `../build-track` (ERP Travaux). La révision est celle du fichier au moment de la reprise ; « adapté » signale un écart avec l'original, décrit dans la colonne Écarts.

| Fichier du kit | Origine dans build-track | Révision | Écarts |
|---|---|---|---|

Aucune brique pour l'instant. Les premières reprises sont prévues par `backlog.md` (« Reprises depuis build-track ») : résultat et identifiants typés en B.3, montants en B.1, horloge en B.4. Révision de build-track à la création du kit : `bd1ad59` (2026-10-28).
