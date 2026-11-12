import { describe, expect, it } from 'vitest';
import { SiteId } from './ids';
import type { Refusal, RefusalKind } from './refusal';

// Spec: CLAUDE.md §8 — erreurs métier typées ; backlog B.3 — les motifs forment une liste fermée.

// One sample per reason: a reason added to the list without a sample fails `nx typecheck domain`.
const samples: { readonly [Kind in RefusalKind]: Extract<Refusal, { kind: Kind }> } = {
  InvalidId: { kind: 'InvalidId', expected: 'SiteId' },
  InvalidQuantity: { kind: 'InvalidQuantity', value: 0 },
  InvalidWeight: { kind: 'InvalidWeight', grams: 0 },
  InvalidBusinessDay: { kind: 'InvalidBusinessDay' },
  InvalidTimeZone: { kind: 'InvalidTimeZone' },
  InvalidInstant: { kind: 'InvalidInstant' },
  InvalidMediaFingerprint: { kind: 'InvalidMediaFingerprint' },
  SiteNotOfCampaign: { kind: 'SiteNotOfCampaign' },
  CampaignClosed: { kind: 'CampaignClosed' },
  FutureBusinessDate: { kind: 'FutureBusinessDate' },
  BusinessDateBeforePlacement: { kind: 'BusinessDateBeforePlacement' },
  CatchUpWindowPassed: { kind: 'CatchUpWindowPassed' },
  RoleCannotDeclare: { kind: 'RoleCannotDeclare' },
  NotAssignedToSite: { kind: 'NotAssignedToSite' },
  StrictModePrimaryOnly: { kind: 'StrictModePrimaryOnly' },
  LossByAdminOnly: { kind: 'LossByAdminOnly' },
  NoLossAfterDeaths: { kind: 'NoLossAfterDeaths' },
  RetractionByAdminOnly: { kind: 'RetractionByAdminOnly' },
  DeclarationRetracted: { kind: 'DeclarationRetracted' },
  CorrectsACounterDeclaration: { kind: 'CorrectsACounterDeclaration' },
  CorrectsEventElsewhere: { kind: 'CorrectsEventElsewhere' },
  CorrectionChangesBusinessDate: { kind: 'CorrectionChangesBusinessDate' },
  CorrectionChangesType: { kind: 'CorrectionChangesType' },
  CorrectionChangesReference: { kind: 'CorrectionChangesReference' },
  CorrectsItself: { kind: 'CorrectsItself' },
  UnknownStrain: { kind: 'UnknownStrain' },
  PlacementInFuture: { kind: 'PlacementInFuture' },
  PlacementTooOld: { kind: 'PlacementTooOld' },
  InvalidPlannedDuration: { kind: 'InvalidPlannedDuration', value: 0 },
  UnknownOrderLine: { kind: 'UnknownOrderLine' },
  OrderNotReceiving: { kind: 'OrderNotReceiving' },
  NotFiveWeights: { kind: 'NotFiveWeights' },
  WeighingPhotosMismatch: { kind: 'WeighingPhotosMismatch' },
  UnknownWeighingRequest: { kind: 'UnknownWeighingRequest' },
  UnknownWeighing: { kind: 'UnknownWeighing' },
  WeighingAlreadyValidated: { kind: 'WeighingAlreadyValidated' },
  ValidationByAdminOnly: { kind: 'ValidationByAdminOnly' },
};

// Total function over the closed list: a reason added without its `case` fails the typecheck.
function explain(refusal: Refusal): string {
  switch (refusal.kind) {
    case 'InvalidId':
      return `identifiant invalide : ${refusal.expected}`;
    case 'InvalidQuantity':
      return `quantité invalide : ${refusal.value}`;
    case 'InvalidWeight':
      return `poids invalide : ${refusal.grams} g`;
    case 'InvalidBusinessDay':
      return 'jour métier invalide';
    case 'InvalidTimeZone':
      return 'fuseau inconnu';
    case 'InvalidInstant':
      return 'instant invalide';
    case 'InvalidMediaFingerprint':
      return 'empreinte de média invalide';
    case 'SiteNotOfCampaign':
      return "ce site n'est pas celui de la campagne";
    case 'CampaignClosed':
      return 'la campagne est clôturée';
    case 'FutureBusinessDate':
      return 'ce jour est à venir';
    case 'BusinessDateBeforePlacement':
      return 'ce jour précède la mise en place';
    case 'CatchUpWindowPassed':
      return 'ce jour est trop ancien pour le gardien';
    case 'RoleCannotDeclare':
      return 'ce rôle ne déclare jamais';
    case 'NotAssignedToSite':
      return "l'auteur n'est pas affecté à ce site";
    case 'StrictModePrimaryOnly':
      return 'mode strict : seul le titulaire déclare';
    case 'LossByAdminOnly':
      return 'le gardien ne déclare que les morts';
    case 'NoLossAfterDeaths':
      return 'des morts sont déjà écrits pour ce jour';
    case 'RetractionByAdminOnly':
      return "seul l'admin annule une déclaration";
    case 'DeclarationRetracted':
      return 'cette déclaration est annulée';
    case 'CorrectsACounterDeclaration':
      return "une correction vise la déclaration d'origine";
    case 'CorrectsEventElsewhere':
      return "l'événement corrigé est dans un autre cahier";
    case 'CorrectionChangesBusinessDate':
      return 'une correction ne change pas le jour';
    case 'CorrectionChangesType':
      return 'une correction ne change pas le type';
    case 'CorrectionChangesReference':
      return "une correction ne change pas ce que la déclaration vise";
    case 'CorrectsItself':
      return "une correction ne porte pas l'identifiant de sa déclaration";
    case 'UnknownStrain':
      return 'souche inconnue';
    case 'PlacementInFuture':
      return 'mise en place dans le futur';
    case 'PlacementTooOld':
      return 'mise en place de plus de 60 jours';
    case 'InvalidPlannedDuration':
      return `durée prévue invalide : ${refusal.value} jours`;
    case 'UnknownOrderLine':
      return 'ligne de commande inconnue dans cette bande';
    case 'OrderNotReceiving':
      return 'commande en brouillon ou close : elle ne reçoit pas';
    case 'NotFiveWeights':
      return 'une pesée porte cinq poids';
    case 'WeighingPhotosMismatch':
      return 'une photo par poids, ou aucune';
    case 'UnknownWeighingRequest':
      return 'aucune demande de pesée de cette bande';
    case 'UnknownWeighing':
      return 'pesée inconnue dans cette bande';
    case 'WeighingAlreadyValidated':
      return 'pesée déjà validée';
    case 'ValidationByAdminOnly':
      return "seul l'admin valide une pesée";
    default:
      return assertNever(refusal);
  }
}

function assertNever(value: never): never {
  throw new Error(`motif de refus non traité : ${JSON.stringify(value)}`);
}

describe('Motifs de refus du journal', () => {
  it('chaque motif de la liste fermée est traité par une fonction totale', () => {
    for (const refusal of Object.values(samples)) {
      expect(explain(refusal)).toMatch(/\S/);
    }
  });

  it('un motif hors de la liste ne se compile pas', () => {
    // @ts-expect-error `Unlucky` n'est pas un motif de la liste
    const unknown: Refusal = { kind: 'Unlucky' };

    expect(unknown).toBeDefined();
  });

  it('un refus métier est un résultat typé qui porte son motif, jamais une exception', () => {
    // When
    const attempt = (): unknown => SiteId('pas-un-uuid');

    // Then
    expect(attempt).not.toThrow();
    expect(attempt()).toEqual({ ok: false, error: samples.InvalidId });
  });
});
