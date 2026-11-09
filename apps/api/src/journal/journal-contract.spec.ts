import { unwrap } from '@kit';
import { TenantId, UserId } from '@domain/journal';
import type { JournalEventPayload } from '@contracts';
import { decodeJournalEvent } from './decode-event';

// Spec: backlog F.1 — le format d'échange du journal (packages/contracts) et le décodeur du
// domaine disent la même chose : tout ce que le contrat décrit se décode. Le typage refuse
// un exemple qui sort du contrat ; le décodeur refuse ce qui sort du domaine.

const uuid = (rank: number): string => `00000000-0000-4000-8000-${String(rank).padStart(12, '0')}`;
const envelope = { id: uuid(1), siteId: uuid(3), campaignId: uuid(4), businessDate: '2026-11-05', recordedAt: '2026-11-05T18:30:00.000Z' };
const MEDIA = 'b'.repeat(64);

// One example of every shape and every type of fact the contract allows.
const examples: readonly JournalEventPayload[] = [
  { ...envelope, fact: { type: 'Death', quantity: 3 } },
  { ...envelope, fact: { type: 'BagOpened', quantity: 1 } },
  { ...envelope, fact: { type: 'NoLoss' } },
  { ...envelope, fact: { type: 'Loss', lossType: 'Missing', quantity: 4 } },
  { ...envelope, fact: { type: 'Loss', lossType: 'Donation', quantity: 2 } },
  { ...envelope, fact: { type: 'Loss', lossType: 'Theft', quantity: 3 } },
  { ...envelope, fact: { type: 'Delivery', orderLineId: uuid(7), receivedQuantity: 40, deliveryNote: { kind: 'Photographed', media: MEDIA } } },
  { ...envelope, fact: { type: 'Delivery', orderLineId: uuid(7), receivedQuantity: 40, deliveryNote: { kind: 'NoPaper' } } },
  { ...envelope, fact: { type: 'Weighing', weighingRequestId: uuid(8), weights: [1820, 1905] } },
  { ...envelope, fact: { type: 'TaskDone', taskId: uuid(9) } },
  { ...envelope, fact: { type: 'VoiceMessage', media: MEDIA } },
  { ...envelope, fact: { type: 'Photo', media: MEDIA } },
  { ...envelope, id: uuid(100), corrects: uuid(1), fact: { type: 'Death', quantity: 2 } },
  { ...envelope, id: uuid(200), retracts: uuid(1) },
];

describe("Contrat d'échange du journal", () => {
  it('chaque forme et chaque type de fait du contrat se décode en un événement du journal', () => {
    const context = { tenantId: unwrap(TenantId(uuid(2))), authorId: unwrap(UserId(uuid(5))) };

    for (const example of examples) {
      expect(decodeJournalEvent(example, context)).toMatchObject({ ok: true, value: { id: example.id } });
    }
  });
});
