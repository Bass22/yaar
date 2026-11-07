import { unwrap } from '@kit';
import fc from 'fast-check';
import {
  BusinessDay,
  CampaignId,
  SiteId,
  TenantId,
  TimeZone,
  UserId,
  isRetraction,
  type Campaign,
  type CampaignId as CampaignIdType,
  type JournalEvent,
  type JournalEventId,
} from '@domain/journal';
import type { Session } from '../auth/session';
import { ingestEvents, type IngestionPorts, type SiteContext } from './ingest-events';

// Spec: Architecture §5 (le serveur reçoit le journal par lots, idempotent par UUID) ;
// CLAUDE.md §4 règles 1 et 2 ; cahier des charges « Gouvernance des déclarations »,
// « Corrections », « Rattrapage » ; backlog F.4. Ports en mémoire : le dépôt Prisma vient en F.2.

const uuid = (rank: number): string => `00000000-0000-4000-8000-${String(rank).padStart(12, '0')}`;
const TENANT = uuid(2);
const NORD = uuid(3);
const SUD = uuid(30);
const BANDE_NORD = uuid(4);
const BANDE_SUD = uuid(40);
const BANDE_D_UN_AUTRE_ELEVAGE = uuid(44);
const OUSMANE = uuid(51); // titulaire du Nord
const AWA = uuid(52); // remplaçante du Nord
const MODOU = uuid(53); // titulaire du Sud, en mode strict
const LE_GERANT = uuid(54);
const TELEPHONE = uuid(91);

const session = (userId: string, role: Session['role'] = 'collaborator'): Session => ({ userId, tenantId: unwrap(TenantId(TENANT)), role, deviceId: TELEPHONE });
const gardien = session(OUSMANE);
const gerant = session(LE_GERANT, 'admin');

const site = (siteId: string, primary: string, substitutes: string[], strictMode = false): SiteContext => ({
  staff: { siteId: unwrap(SiteId(siteId)), primaryCaretaker: unwrap(UserId(primary)), substitutes: substitutes.map((id) => unwrap(UserId(id))), strictMode },
  timeZone: unwrap(TimeZone('Africa/Dakar')),
  scale: { capacityGrams: 5_000 },
});
const campaign = (id: string, siteId: string): Campaign => ({ id: unwrap(CampaignId(id)), siteId: unwrap(SiteId(siteId)), placementDay: unwrap(BusinessDay('2026-10-15')), closedAt: null });

// The journal of one farm, in memory, as the Prisma repository of F.2 will hold it.
class FarmInMemory implements IngestionPorts {
  readonly journal: { event: JournalEvent; deviceId: string }[] = [];
  private readonly campaignsById = new Map<string, Campaign>([
    [BANDE_NORD, campaign(BANDE_NORD, NORD)],
    [BANDE_SUD, campaign(BANDE_SUD, SUD)],
  ]);

  // Moves the placement of the Nord flock, to write far from November 2026.
  placedOn(day: string): void {
    this.campaignsById.set(BANDE_NORD, { ...campaign(BANDE_NORD, NORD), placementDay: unwrap(BusinessDay(day)) });
  }

  async sites(): Promise<readonly SiteContext[]> {
    return [site(NORD, OUSMANE, [AWA]), site(SUD, MODOU, [AWA], true)];
  }
  async campaign(id: CampaignIdType): Promise<Campaign | null> {
    return this.campaignsById.get(id) ?? null;
  }
  async event(id: JournalEventId): Promise<JournalEvent | null> {
    return this.journal.find((row) => row.event.id === id)?.event ?? null;
  }
  async isRetracted(id: JournalEventId): Promise<boolean> {
    return this.journal.some(({ event }) => isRetraction(event) && event.retracts === id);
  }
  async dayJournal(campaignId: CampaignIdType, day: BusinessDay): Promise<readonly JournalEvent[]> {
    return this.journal.map((row) => row.event).filter((event) => event.campaignId === campaignId && event.businessDate === day);
  }
  async append(event: JournalEvent, deviceId: string): Promise<void> {
    this.journal.push({ event, deviceId });
  }
}

// What a phone sends: three deaths on the Nord site for November 5th, unless said otherwise.
const envoi = (rank: number, overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: uuid(rank),
  siteId: NORD,
  campaignId: BANDE_NORD,
  businessDate: '2026-11-05',
  recordedAt: '2026-11-05T18:30:00.000Z',
  fact: { type: 'Death', quantity: 3 },
  ...overrides,
});
const correction = (rank: number, corrects: number, overrides: Record<string, unknown> = {}) =>
  envoi(rank, { corrects: uuid(corrects), recordedAt: '2026-11-05T19:00:00.000Z', fact: { type: 'Death', quantity: 2 }, ...overrides });
// A retraction names the declaration and carries no fact.
const annulation = (rank: number, retracts: number, overrides: Record<string, unknown> = {}) => ({
  ...Object.fromEntries(Object.entries(envoi(rank, { recordedAt: '2026-11-05T20:00:00.000Z', ...overrides })).filter(([key]) => key !== 'fact')),
  retracts: uuid(retracts),
});

const ingere = (farm: FarmInMemory, batch: unknown[], by: Session = gardien) => ingestEvents(batch, by, farm);

describe("Ingérer un lot d'événements", () => {
  describe('un événement valide rejoint le journal', () => {
    it("il est accepté, signé de l'élevage et de l'auteur de la session, et gardé avec l'appareil de la session", async () => {
      const farm = new FarmInMemory();

      const outcomes = await ingere(farm, [envoi(1)]);

      expect(outcomes).toEqual([{ index: 0, id: uuid(1), status: 'Accepted' }]);
      expect(farm.journal).toEqual([{ event: expect.objectContaining({ id: uuid(1), tenantId: TENANT, authorId: OUSMANE, quantity: 3 }), deviceId: TELEPHONE }]);
    });

    it("l'ingestion ne lit aucune horloge : une déclaration restée des semaines hors-ligne, ou datée par un téléphone en avance, est jugée à sa date de saisie et acceptée, telle qu'écrite (décision du 2026-11-07)", async () => {
      const farm = new FarmInMemory();
      // Written in 2020 for its day, or "in 2030" by a phone whose clock runs ahead: whenever the server receives them.
      const longAgo = envoi(1, { businessDate: '2020-01-05', recordedAt: '2020-01-05T18:30:00.000Z' });
      const ahead = envoi(2, { businessDate: '2030-01-05', recordedAt: '2030-01-05T07:00:00.000Z' });
      farm.placedOn('2019-12-01');

      expect(await ingere(farm, [longAgo, ahead])).toEqual([
        { index: 0, id: uuid(1), status: 'Accepted' },
        { index: 1, id: uuid(2), status: 'Accepted' },
      ]);
      expect(farm.journal.map((row) => row.event.recordedAt)).toEqual(['2020-01-05T18:30:00.000Z', '2030-01-05T07:00:00.000Z']);
    });
  });

  describe('un doublon est ignoré, sans erreur', () => {
    it("un événement déjà au journal est signalé comme doublon et n'y entre pas une seconde fois, même si son contenu diffère", async () => {
      const farm = new FarmInMemory();
      await ingere(farm, [envoi(1)]);

      const outcomes = await ingere(farm, [envoi(1, { fact: { type: 'Death', quantity: 30 } })]);

      expect(outcomes).toEqual([{ index: 0, id: uuid(1), status: 'Duplicate' }]);
      expect(farm.journal).toHaveLength(1);
      expect(farm.journal[0]?.event).toMatchObject({ quantity: 3 });
    });

    it('le même identifiant deux fois dans un lot : le second est un doublon', async () => {
      const farm = new FarmInMemory();

      expect(await ingere(farm, [envoi(1), envoi(1)])).toEqual([
        { index: 0, id: uuid(1), status: 'Accepted' },
        { index: 1, id: uuid(1), status: 'Duplicate' },
      ]);
      expect(farm.journal).toHaveLength(1);
    });
  });

  describe("le lot rend le sort de chaque événement", () => {
    it("un lot mêlant acceptés, doublons et refusés rend, dans l'ordre d'envoi, le sort de chacun ; un refus n'arrête pas le reste", async () => {
      const farm = new FarmInMemory();
      await ingere(farm, [envoi(1)]);

      const outcomes = await ingere(farm, [envoi(2), 'pas un événement', envoi(1), envoi(3, { fact: { type: 'Death', quantity: 0 } }), envoi(4, { fact: { type: 'BagOpened', quantity: 1 } })]);

      expect(outcomes).toEqual([
        { index: 0, id: uuid(2), status: 'Accepted' },
        { index: 1, status: 'Refused', refusal: { kind: 'MalformedEvent', field: '' } },
        { index: 2, id: uuid(1), status: 'Duplicate' },
        { index: 3, status: 'Refused', refusal: { kind: 'InvalidQuantity', value: 0 } },
        { index: 4, id: uuid(4), status: 'Accepted' },
      ]);
      expect(farm.journal.map((row) => row.event.id)).toEqual([uuid(1), uuid(2), uuid(4)]);
    });

    it("dans un lot, une déclaration entre au journal avant ce qui la corrige ou l'annule, même envoyée après", async () => {
      const farm = new FarmInMemory();

      const outcomes = await ingere(farm, [annulation(200, 1), correction(100, 1), envoi(1)], gerant);

      expect(outcomes.map((outcome) => outcome.status)).toEqual(['Accepted', 'Accepted', 'Accepted']);
      expect(farm.journal.map((row) => row.event.id)).toEqual([uuid(1), uuid(100), uuid(200)]);
    });

    it("une bande inconnue — ou celle d'un autre élevage, que ce journal ne voit pas — est refusée sans rien révéler", async () => {
      const farm = new FarmInMemory();

      expect(await ingere(farm, [envoi(1, { campaignId: BANDE_D_UN_AUTRE_ELEVAGE })])).toEqual([{ index: 0, id: uuid(1), status: 'Refused', refusal: { kind: 'UnknownCampaign' } }]);
      expect(farm.journal).toEqual([]);
    });

    it("les règles de la bande s'appliquent : un site qui n'est pas celui de la bande est refusé", async () => {
      const farm = new FarmInMemory();

      expect(await ingere(farm, [envoi(1, { siteId: SUD })])).toEqual([{ index: 0, id: uuid(1), status: 'Refused', refusal: { kind: 'SiteNotOfCampaign' } }]);
    });
  });

  describe('la politique de déclaration, avec l\'auteur de la session', () => {
    it("un gardien qui n'est pas affecté au site est refusé", async () => {
      expect(await ingere(new FarmInMemory(), [envoi(1)], session(MODOU))).toEqual([{ index: 0, id: uuid(1), status: 'Refused', refusal: { kind: 'NotAssignedToSite' } }]);
    });

    it("en mode strict, seul le titulaire déclare : la remplaçante est refusée, le titulaire accepté", async () => {
      const farm = new FarmInMemory();
      const auSud = (rank: number) => envoi(rank, { siteId: SUD, campaignId: BANDE_SUD });

      expect(await ingere(farm, [auSud(1)], session(AWA))).toEqual([{ index: 0, id: uuid(1), status: 'Refused', refusal: { kind: 'StrictModePrimaryOnly' } }]);
      expect(await ingere(farm, [auSud(2)], session(MODOU))).toEqual([{ index: 0, id: uuid(2), status: 'Accepted' }]);
    });

    it("le gardien ne déclare que les morts : une perte hors mortalité est refusée, acceptée de l'admin", async () => {
      const farm = new FarmInMemory();
      const manquants = (rank: number) => envoi(rank, { fact: { type: 'Loss', lossType: 'Missing', quantity: 12 } });

      expect(await ingere(farm, [manquants(1)])).toEqual([{ index: 0, id: uuid(1), status: 'Refused', refusal: { kind: 'LossByAdminOnly' } }]);
      expect(await ingere(farm, [manquants(2)], gerant)).toEqual([{ index: 0, id: uuid(2), status: 'Accepted' }]);
    });
  });

  describe('« rien perdu » est jugé contre le journal du jour', () => {
    it("refusé si des morts sont déjà écrits ce jour, avant lui ; accepté s'il a été écrit avant les morts", async () => {
      const farm = new FarmInMemory();
      const rienPerdu = (rank: number, recordedAt: string) => envoi(rank, { recordedAt, fact: { type: 'NoLoss' } });
      await ingere(farm, [envoi(1)]); // trois morts écrits à 18 h 30

      expect(await ingere(farm, [rienPerdu(2, '2026-11-05T19:00:00.000Z')])).toEqual([{ index: 0, id: uuid(2), status: 'Refused', refusal: { kind: 'NoLossAfterDeaths' } }]);
      expect(await ingere(farm, [rienPerdu(3, '2026-11-05T07:00:00.000Z')])).toEqual([{ index: 0, id: uuid(3), status: 'Accepted' }]);
    });
  });

  describe('une contre-déclaration est jugée contre la déclaration lue au journal', () => {
    it("une correction de la déclaration est acceptée", async () => {
      const farm = new FarmInMemory();
      await ingere(farm, [envoi(1)]);

      expect(await ingere(farm, [correction(100, 1)])).toEqual([{ index: 0, id: uuid(100), status: 'Accepted' }]);
    });

    it("une correction qui nomme une déclaration absente du journal est refusée", async () => {
      expect(await ingere(new FarmInMemory(), [correction(100, 1)])).toEqual([{ index: 0, id: uuid(100), status: 'Refused', refusal: { kind: 'UnknownEvent' } }]);
    });

    it("une correction qui change le type de la déclaration est refusée", async () => {
      const farm = new FarmInMemory();
      await ingere(farm, [envoi(1)]);

      expect(await ingere(farm, [correction(100, 1, { fact: { type: 'BagOpened', quantity: 1 } })])).toEqual([{ index: 0, id: uuid(100), status: 'Refused', refusal: { kind: 'CorrectionChangesType' } }]);
    });

    it("une déclaration annulée — l'annulation lue au journal — ne se corrige plus", async () => {
      const farm = new FarmInMemory();
      await ingere(farm, [envoi(1)]);
      await ingere(farm, [annulation(200, 1)], gerant);

      expect(await ingere(farm, [correction(100, 1, { recordedAt: '2026-11-05T21:00:00.000Z' })])).toEqual([{ index: 0, id: uuid(100), status: 'Refused', refusal: { kind: 'DeclarationRetracted' } }]);
    });
  });

  describe('une annulation est jugée contre la déclaration lue au journal', () => {
    it("l'admin annule ; une seconde annulation de la même déclaration est refusée, l'annulation étant lue au journal", async () => {
      const farm = new FarmInMemory();
      await ingere(farm, [envoi(1)]);

      expect(await ingere(farm, [annulation(200, 1)], gerant)).toEqual([{ index: 0, id: uuid(200), status: 'Accepted' }]);
      expect(await ingere(farm, [annulation(201, 1)], gerant)).toEqual([{ index: 0, id: uuid(201), status: 'Refused', refusal: { kind: 'DeclarationRetracted' } }]);
    });

    it("le gardien n'annule pas ; une annulation qui nomme une déclaration absente est refusée", async () => {
      const farm = new FarmInMemory();
      await ingere(farm, [envoi(1)]);

      expect(await ingere(farm, [annulation(200, 1)])).toEqual([{ index: 0, id: uuid(200), status: 'Refused', refusal: { kind: 'RetractionByAdminOnly' } }]);
      expect(await ingere(farm, [annulation(201, 9)], gerant)).toEqual([{ index: 0, id: uuid(201), status: 'Refused', refusal: { kind: 'UnknownEvent' } }]);
    });
  });

  describe('rejouer un lot', () => {
    // A batch drawn from a small pool: deaths and "nothing lost" on two days, corrections and retractions of them, by the caretaker or the admin.
    const anEvent = fc.oneof(
      fc.record({ rank: fc.integer({ min: 1, max: 6 }), day: fc.constantFrom('2026-11-04', '2026-11-05'), noLoss: fc.boolean() }).map(({ rank, day, noLoss }) =>
        envoi(rank, { businessDate: day, recordedAt: `${day}T1${rank}:00:00.000Z`, fact: noLoss ? { type: 'NoLoss' } : { type: 'Death', quantity: rank } }),
      ),
      fc.record({ rank: fc.integer({ min: 100, max: 104 }), target: fc.integer({ min: 1, max: 6 }) }).map(({ rank, target }) => correction(rank, target)),
      fc.record({ rank: fc.integer({ min: 200, max: 203 }), target: fc.integer({ min: 1, max: 6 }) }).map(({ rank, target }) => annulation(rank, target)),
    );

    it("rejouer un lot entier ne change rien au journal : ce qui était accepté devient doublon, ce qui était refusé l'est encore, pour le même motif (property-based)", async () => {
      await fc.assert(
        fc.asyncProperty(fc.uniqueArray(anEvent, { selector: (event): unknown => (event as Record<string, unknown>)['id'], maxLength: 12 }), fc.boolean(), async (batch, byAdmin) => {
          const farm = new FarmInMemory();
          const by = byAdmin ? gerant : gardien;
          const first = await ingere(farm, batch, by);
          const journalAfterFirst = [...farm.journal];

          const second = await ingere(farm, batch, by);

          expect(farm.journal).toEqual(journalAfterFirst);
          expect(second).toEqual(first.map((outcome) => (outcome.status === 'Accepted' ? { ...outcome, status: 'Duplicate' } : outcome)));
        }),
      );
    });
  });
});
