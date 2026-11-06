# Kit maison

Briques génériques communes aux produits de la maison (Yaar, ERP Travaux) : montants, résultat typé, identifiants typés, horloge. Le kit vit dans ce dépôt le temps de savoir ce qu'il doit contenir ; il est écrit pour pouvoir en sortir un jour sans retouche, en déplaçant ce dossier dans un dépôt à part.

## Règles d'admission

Une brique entre dans le kit si un autre produit l'utiliserait **telle quelle**.

1. **Aucun vocabulaire métier.** Ni campagne, ni gardien, ni chantier : `Money` oui, `Debt` non.
2. **Aucun import hors du kit.** Ni le reste du workspace, ni un framework, ni un paquet npm. Seuls les tests importent `vitest`.
3. **Aucune API propre à Node ni au navigateur.** Le kit tourne à l'identique sur le serveur et sur le téléphone. Le code livré se compile sans les types de Node ni du DOM (`tsconfig.lib.json`) : `process`, `Buffer`, `window` ou `node:fs` font échouer `npx nx typecheck kit`.
4. **Reprise avec ses tests.** Une brique arrive de build-track avec ses tests, narrés en français ; si l'original n'en a pas, ils s'écrivent ici.
5. **Provenance notée.** Chaque fichier de `src/` (hors tests et `index.ts`) a sa ligne dans le tableau ci-dessous, sans quoi `npm test` échoue.

La règle 2 est vérifiée par le lint (`eslint.config.mjs`) et par `tools/workspace.spec.mjs`, la règle 3 par le typage, la règle 5 par `tools/workspace.spec.mjs`.

## Provenance

Dépôt d'origine : `../build-track` (ERP Travaux). La révision est celle du fichier au moment de la reprise ; « adapté » signale un écart avec l'original, décrit dans la colonne Écarts.

| Fichier du kit | Origine dans build-track | Révision | Écarts |
|---|---|---|---|
| `result.ts` | `backend/modules/domain/src/main/shared/result.ts` | `4d41029` | Adapté : pas de type d'erreur par défaut (l'original prend `DomainError`, qui est du métier). Tests écrits ici : l'original n'en a pas. |
| `brand.ts` | `backend/modules/domain/src/main/shared/ids.ts` | `2d17a0f` | Adapté : seul le type `Brand` est repris, et exporté. Les identifiants eux-mêmes sont du métier et restent dans chaque produit ; le test de `ids.spec.ts` est repris sur un exemple neutre. |

Reprises à venir, d'après `backlog.md` (« Reprises depuis build-track ») : montants en B.1, horloge en B.4. Révision de build-track à la création du kit : `bd1ad59` (2026-10-28).
