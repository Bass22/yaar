import { unwrap } from '@kit';
import { describe, expect, it } from 'vitest';
import { BusinessDay } from './business-day';
import { CampaignId, JournalEventId, SiteId, TenantId, UserId, WeighingRequestId } from './ids';
import { Instant } from './instant';
import { MediaFingerprint } from './media-fingerprint';
import { CounterDeclaration, Declaration, Retraction, type EventEnvelope, type Fact } from './journal-event';
import { STRAINS } from './strain';
import { Weight } from './weight';
import { answeredWeighingRequests, averageWeight, outOfBounds, validateWeighing, validateWeighingValidation, weightBounds, weightCurve, WEIGHING_WEIGHTS } from './weighing';

// Spec: backlog T.1 — une pesée, sa moyenne et sa validation ; T.3 — les bornes contre une faute de
// frappe ; cahier des charges « Les pesées » (décisions du 2026-11-12 : bornes de la moitié au double
// du poids cible de la souche au jour J ; la validation, un fait du journal réservé à l'admin).

const uuid = (rank: number): string => `00000000-0000-4000-8000-${String(rank).padStart(12, '0')}`;
const BANDE = unwrap(CampaignId(uuid(4)));
const DEMANDE = unwrap(WeighingRequestId(uuid(70)));
const grammes = (...values: number[]) => values.map((value) => unwrap(Weight(value)));
const signe = (rank: number, overrides: Partial<EventEnvelope> = {}): EventEnvelope => ({
  id: unwrap(JournalEventId(uuid(rank))),
  tenantId: unwrap(TenantId(uuid(2))),
  siteId: unwrap(SiteId(uuid(3))),
  campaignId: BANDE,
  authorId: unwrap(UserId(uuid(51))),
  businessDate: unwrap(BusinessDay('2026-11-09')),
  recordedAt: unwrap(Instant(new Date(Date.UTC(2026, 10, 9, 8, rank)).toISOString())),
  ...overrides,
});
const pesee = (rank: number, ...values: number[]): Fact => ({ type: 'Weighing', weighingRequestId: DEMANDE, weights: grammes(...values) });
const valide = (rank: number, weighing: number): Declaration => Declaration(signe(rank, { authorId: unwrap(UserId(uuid(54))) }), { type: 'WeighingValidated', weighingId: unwrap(JournalEventId(uuid(weighing))) });
const COBB = STRAINS[0]!;

describe('Une pesée', () => {
  it('porte exactement cinq poids ; moins, ou plus, est refusé', () => {
    expect(WEIGHING_WEIGHTS).toBe(5);
    expect(validateWeighing(grammes(1820, 1905, 1760, 1880, 1850))).toEqual({ ok: true, value: undefined });
    expect([validateWeighing(grammes(1820, 1905, 1760, 1880)), validateWeighing(grammes(1820, 1905, 1760, 1880, 1850, 1900))]).toEqual([
      { ok: false, error: { kind: 'NotFiveWeights' } },
      { ok: false, error: { kind: 'NotFiveWeights' } },
    ]);
  });

  it('porte une photo de la balance par poids, dans le même ordre, ou aucune : un autre nombre est refusé (T.6)', () => {
    const photos = (count: number) => Array.from({ length: count }, (_, rank) => unwrap(MediaFingerprint(String(rank + 1).repeat(64))));
    const cinq = grammes(1820, 1905, 1760, 1880, 1850);

    expect([validateWeighing(cinq, photos(5)), validateWeighing(cinq)]).toEqual([{ ok: true, value: undefined }, { ok: true, value: undefined }]);
    expect([validateWeighing(cinq, photos(4)), validateWeighing(cinq, photos(0))]).toEqual([
      { ok: false, error: { kind: 'WeighingPhotosMismatch' } },
      { ok: false, error: { kind: 'WeighingPhotosMismatch' } },
    ]);
  });

  it('sa moyenne se calcule depuis les poids, au gramme près : (1 820 + 1 905 + 1 760 + 1 880 + 1 850) ÷ 5 = 1 843 ; 9 213 ÷ 5 = 1 842,6 → 1 843', () => {
    expect([averageWeight(grammes(1820, 1905, 1760, 1880, 1850)), averageWeight(grammes(1820, 1905, 1760, 1880, 1848))]).toEqual([1843, 1843]);
  });
});

describe('Les bornes contre une faute de frappe', () => {
  it('de la moitié au double du poids cible de la souche au jour J', () => {
    const cible = COBB.targets[28]!.weight;
    expect(weightBounds(COBB, 28)).toEqual({ min: Math.round(cible / 2), max: cible * 2 });
  });

  it('au-delà de la table, le dernier jour connu ; avant la mise en place, le jour 0', () => {
    const dernier = COBB.targets[COBB.targets.length - 1]!.weight;
    expect(weightBounds(COBB, 70)).toEqual({ min: Math.round(dernier / 2), max: dernier * 2 });
    expect(weightBounds(COBB, -2)).toEqual(weightBounds(COBB, 0));
  });

  // Refactoring du 2026-11-14 : le cahier et le bureau disaient chacun « hors des bornes » ; la règle est ici
  it('un poids hors des bornes alerte : sous la moitié ou au-dessus du double ; les bornes elles-mêmes sont dedans', () => {
    const { min, max } = weightBounds(COBB, 28);
    expect([outOfBounds(COBB, 28, min - 1), outOfBounds(COBB, 28, min), outOfBounds(COBB, 28, max), outOfBounds(COBB, 28, max + 1)]).toEqual([true, false, false, true]);
  });
});

describe('La validation de l’admin, et la courbe réelle', () => {
  it('seule une pesée de la bande, pas annulée, ni déjà validée, se valide', () => {
    expect(validateWeighingValidation(BANDE, { type: 'Weighing', campaignId: BANDE, retracted: false, validated: false })).toEqual({ ok: true, value: undefined });
    expect([
      validateWeighingValidation(BANDE, null),
      validateWeighingValidation(BANDE, { type: 'Death', campaignId: BANDE, retracted: false, validated: false }),
      validateWeighingValidation(BANDE, { type: 'Weighing', campaignId: unwrap(CampaignId(uuid(5))), retracted: false, validated: false }),
      validateWeighingValidation(BANDE, { type: 'Weighing', campaignId: BANDE, retracted: true, validated: false }),
      validateWeighingValidation(BANDE, { type: 'Weighing', campaignId: BANDE, retracted: false, validated: true }),
    ]).toEqual([
      { ok: false, error: { kind: 'UnknownWeighing' } },
      { ok: false, error: { kind: 'UnknownWeighing' } },
      { ok: false, error: { kind: 'UnknownWeighing' } },
      { ok: false, error: { kind: 'UnknownWeighing' } },
      { ok: false, error: { kind: 'WeighingAlreadyValidated' } },
    ]);
  });

  it('la courbe réelle ne retient que les pesées validées : le jour J et la moyenne des poids tels qu’ils comptent', () => {
    const jour = (day: string) => unwrap(BusinessDay(day));
    const premiere = Declaration(signe(1, { businessDate: jour('2026-10-26') }), pesee(1, 500, 520, 480, 510, 490));
    const corrigee = CounterDeclaration(signe(2, { businessDate: jour('2026-10-26') }), premiere.id, pesee(2, 500, 520, 480, 510, 990));
    const seconde = Declaration(signe(3, { businessDate: jour('2026-11-09') }), pesee(3, 1820, 1905, 1760, 1880, 1850));
    const pasValidee = Declaration(signe(4, { businessDate: jour('2026-11-05') }), pesee(4, 1500, 1500, 1500, 1500, 1500));

    // Placed on October 12th: October 26th is day 14, November 9th day 28.
    // The first, corrected: (500 + 520 + 480 + 510 + 990) ÷ 5 = 600.
    expect(weightCurve([premiere, corrigee, seconde, pasValidee, valide(10, 1), valide(11, 3)], jour('2026-10-12'))).toEqual([
      { weighingId: uuid(1), campaignDay: 14, average: 600 },
      { weighingId: uuid(3), campaignDay: 28, average: 1843 },
    ]);
  });

  it('une pesée annulée par l’admin quitte la courbe, même validée', () => {
    const jour = (day: string) => unwrap(BusinessDay(day));
    const seconde = Declaration(signe(3, { businessDate: jour('2026-11-09') }), pesee(3, 1820, 1905, 1760, 1880, 1850));
    const annulee = Retraction(signe(5), seconde.id);

    expect(weightCurve([seconde, valide(11, 3), annulee], jour('2026-10-12'))).toEqual([]);
  });
});

// Refactoring du 2026-11-14 : le cahier et le bureau disaient chacun quelles demandes une pesée a répondues
describe('Les demandes de pesée auxquelles une pesée répond', () => {
  it('une pesée en vigueur répond à sa demande ; annulée, elle n’y répond plus', () => {
    const pesage = Declaration(signe(3), pesee(3, 1820, 1905, 1760, 1880, 1850));

    expect([...answeredWeighingRequests([pesage])]).toEqual([DEMANDE]);
    expect([...answeredWeighingRequests([pesage, Retraction(signe(5), pesage.id)])]).toEqual([]);
  });
});
