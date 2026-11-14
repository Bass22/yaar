import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { unwrap, type Clock } from '@kit';
import { Instant } from '@domain/journal';
import type { LedgerView, RecordSettlementRequest } from '@contracts';
import { AppModule } from '../app.module';
import { issueAccessToken, type SessionClaims } from '../auth/access-token';
import { CLOCK } from '../auth/auth.module';
import { APP_CONFIG } from '../config/app-config';
import { configureApp } from '../create-app';
import { createTestDatabase, type TestDatabase } from '../testing/test-database';

// Spec: backlog R.1 à R.3 — « Qui doit quoi » ; cahier des charges « Le grand livre » (2026-11-12) ;
// CLAUDE.md §4 règles 2, 4, 5, 8 et 14. PostgreSQL réel, HTTP.
jest.setTimeout(180_000);

const SECRET = 'un-secret-de-test-assez-long-pour-signer-des-jetons';
const uuid = (rank: number): string => `00000000-0000-4000-8000-${String(rank).padStart(12, '0')}`;
const TENANT_A = uuid(10);
const TENANT_B = uuid(11);
const NORD = uuid(3);
const BANDE = uuid(4);
const SEDIMA = uuid(31);
const OUSMANE_TIERS = uuid(32);
const RAMASSEUR = uuid(33);
const ANCIEN = uuid(34);
const TIERS_DE_B = uuid(35);
const ALIMENT = uuid(41);
const SALAIRE = uuid(43);
const OUSMANE = uuid(51);
const LE_GERANT = uuid(54);
const GERANT_DE_B = uuid(55);
const ORDINATEUR = uuid(92);
const PIN_HASH = '$argon2id$v=19$m=19456,t=2,p=1$dGVzdC1vbmx5LXNhbHQ$dGVzdC1vbmx5LWRpZ2VzdC1ub3QtYS1yZWFsLXBpbg';

describe('« Qui doit quoi », au bureau', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let origin: string;
  // Thursday November 12th, 2026, 10:00 in Dakar.
  const now = Date.parse('2026-11-12T10:00:00.000Z');
  let tick = 0;
  const clock: Clock = { now: () => new Date(now + (tick += 1000)) };

  const tokenOf = (sub: string, tenant: string, role: SessionClaims['role']) =>
    issueAccessToken({ sub, tenant, role, device: ORDINATEUR }, unwrap(Instant(new Date(now - 60_000).toISOString())), SECRET);
  const gerant = () => tokenOf(LE_GERANT, TENANT_A, 'admin');
  type Token = ReturnType<typeof gerant>;
  const call = (method: string, path: string, body?: unknown, token: Token = gerant()) =>
    fetch(`${origin}/api/v1/${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const livre = async (token?: Token) => (await (await call('GET', 'ledger', undefined, token)).json()) as LedgerView;
  const regle = (body: unknown, token?: Token) => call('POST', 'settlements', body, token);
  const soldeDe = async (counterpartyId: string) => (await livre()).counterparties.find((line) => line.counterpartyId === counterpartyId)?.balance;
  const kindOf = async (response: Response) => ((await response.json()) as { kind?: string }).kind;
  const unReglement = (rank: number, fields: Partial<RecordSettlementRequest> = {}): RecordSettlementRequest => ({
    id: uuid(rank),
    counterpartyId: OUSMANE_TIERS,
    paidOn: '2026-11-11',
    amount: 20_000,
    method: 'Cash',
    direction: 'ToCounterparty',
    ...fields,
  });

  beforeAll(async () => {
    db = await createTestDatabase();
    await db.superuser.tenant.createMany({ data: [TENANT_A, TENANT_B].map((id) => ({ id, name: 'Ferme', currency: 'XOF' })) });
    await db.superuser.site.create({ data: { id: NORD, tenantId: TENANT_A, name: 'Poulailler Nord', timeZone: 'Africa/Dakar' } });
    await db.superuser.campaign.create({ data: { id: BANDE, tenantId: TENANT_A, siteId: NORD, placementDay: new Date('2026-10-01'), strain: 'Cobb500', plannedHeadcount: 1000, plannedDuration: 45 } });
    await db.superuser.user.createMany({
      data: [
        { id: OUSMANE, tenantId: TENANT_A, role: 'collaborator', phone: '+221770000001', name: 'Ousmane', pinHash: PIN_HASH },
        { id: LE_GERANT, tenantId: TENANT_A, role: 'admin', phone: '+221770000002', name: 'Le gérant', pinHash: PIN_HASH },
        { id: GERANT_DE_B, tenantId: TENANT_B, role: 'admin', phone: '+221770000003', name: 'Gérant B', pinHash: PIN_HASH },
      ],
    });
    await db.superuser.counterparty.createMany({
      data: [
        { id: SEDIMA, tenantId: TENANT_A, kind: 'Supplier', name: 'Sedima', face: 'closed-bag' },
        { id: OUSMANE_TIERS, tenantId: TENANT_A, kind: 'Collaborator', name: 'Ousmane', face: 'caretaker' },
        { id: RAMASSEUR, tenantId: TENANT_A, kind: 'Customer', name: 'Ramasseur', face: 'hen' },
        { id: ANCIEN, tenantId: TENANT_A, kind: 'Supplier', name: 'Ancien', face: 'truck', archivedAt: new Date('2026-11-01T00:00:00.000Z') },
        { id: TIERS_DE_B, tenantId: TENANT_B, kind: 'Supplier', name: 'Fournisseur de B', face: 'truck' },
      ],
    });
    await db.superuser.costType.createMany({
      data: [
        { id: ALIMENT, tenantId: TENANT_A, category: 'Feed', name: 'Aliment', behaviour: 'Variable' },
        { id: SALAIRE, tenantId: TENANT_A, category: 'Labour', name: 'Salaire', behaviour: 'Fixed' },
      ],
    });
    // Sedima: 20 bags at 17 500 F, 8 received (140 000 F billable), 100 000 F paid → you owe 40 000 F.
    await db.superuser.purchaseOrder.create({ data: { id: uuid(20), tenantId: TENANT_A, supplierId: SEDIMA, campaignId: BANDE, orderDay: new Date('2026-10-12'), currency: 'XOF', announcedAt: new Date('2026-10-12T09:00:00.000Z') } });
    await db.superuser.orderLine.create({ data: { id: uuid(21), tenantId: TENANT_A, orderId: uuid(20), position: 0, costTypeId: ALIMENT, quantity: 20, unitPrice: 17_500 } });
    await db.superuser.journalEvent.create({
      data: { id: uuid(201), tenantId: TENANT_A, siteId: NORD, campaignId: BANDE, authorId: OUSMANE, businessDate: new Date('2026-10-14'), recordedAt: new Date('2026-10-14T08:00:00.000Z'), deviceId: uuid(93), type: 'Delivery', fact: { orderLineId: uuid(21), receivedQuantity: 8, deliveryNote: { kind: 'NoPaper' } } },
    });
    await db.superuser.payment.create({ data: { id: uuid(501), tenantId: TENANT_A, orderId: uuid(20), paidOn: new Date('2026-10-13'), amount: 100_000, method: 'Wave', recordedBy: LE_GERANT } });
    // Ousmane's salary, 45 000 F to pay.
    await db.superuser.cost.create({ data: { tenantId: TENANT_A, id: uuid(301), campaignId: BANDE, costTypeId: SALAIRE, spentOn: new Date('2026-11-10'), amount: 45_000, paymentKind: 'ToPay', counterpartyId: OUSMANE_TIERS, recordedAt: new Date('2026-11-10T08:00:00.000Z'), recordedBy: LE_GERANT } });

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(APP_CONFIG)
      .useValue({ port: 0, databaseUrl: db.appUrl, jwtSecret: SECRET, mediaPath: '/data/medias', vapidPublicKey: null })
      .overrideProvider(CLOCK)
      .useValue(clock)
      .compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.listen(0, '127.0.0.1');
    origin = await app.getUrl();
  });

  afterAll(async () => {
    await app?.close();
    await db?.drop();
  });

  it('chaque tiers a son solde et ses écritures, dans les deux sens ; en tête, ce que tu dois et ce qu’on te doit — calculés par le serveur', async () => {
    // You owe Ousmane 45 000 F and Sedima 140 000 − 100 000 = 40 000 F: 85 000 F owed, nothing owed to you.
    expect(await livre()).toEqual({
      currency: 'XOF',
      youOwe: 85_000,
      owedToYou: 0,
      counterparties: [
        { counterpartyId: OUSMANE_TIERS, balance: -45_000, entries: [{ on: '2026-11-10', amount: -45_000, source: { kind: 'Cost', costId: uuid(301) } }] },
        {
          counterpartyId: SEDIMA,
          balance: -40_000,
          entries: [
            { on: '2026-10-12', amount: -140_000, source: { kind: 'OrderReceived', orderId: uuid(20) } },
            { on: '2026-10-13', amount: 100_000, source: { kind: 'OrderPayment', orderId: uuid(20), method: 'Wave' } },
          ],
        },
      ],
    });
  });

  it('un règlement partiel diminue la dette d’autant ; il est tracé', async () => {
    expect((await regle(unReglement(701))).status).toBe(201);

    // 45 000 − 20 000 = 25 000 F still owed to Ousmane.
    expect(await soldeDe(OUSMANE_TIERS)).toBe(-25_000);
    expect(await db.superuser.auditEvent.findMany({ where: { subjectId: uuid(701) }, select: { action: true, actorId: true, deviceId: true } })).toEqual([{ action: 'SettlementRecorded', actorId: LE_GERANT, deviceId: ORDINATEUR }]);
  });

  it('le même règlement renvoyé ne compte qu’une fois (200) ; le même identifiant avec un autre montant est refusé (409)', async () => {
    expect((await regle(unReglement(701))).status).toBe(200);
    const autre = await regle(unReglement(701, { amount: 30_000 }));

    expect([autre.status, await kindOf(autre)]).toEqual([409, 'SettlementAlreadyExists']);
    expect(await soldeDe(OUSMANE_TIERS)).toBe(-25_000);
  });

  it('un second règlement solde la dette exactement : le tiers soldé garde sa ligne, à zéro, en bas', async () => {
    expect((await regle(unReglement(702, { amount: 25_000, method: 'OrangeMoney' }))).status).toBe(201);

    const ledger = await livre();
    expect(ledger.counterparties.map(({ counterpartyId, balance }) => [counterpartyId, balance])).toEqual([
      [SEDIMA, -40_000],
      [OUSMANE_TIERS, 0],
    ]);
    expect(ledger.youOwe).toBe(40_000);
  });

  it('un règlement plus gros que la dette est accepté : le tiers doit alors la différence', async () => {
    expect((await regle(unReglement(703, { counterpartyId: SEDIMA, amount: 50_000, method: 'Wave' }))).status).toBe(201);

    // −40 000 + 50 000 = +10 000: Sedima owes you 10 000 F.
    const ledger = await livre();
    expect(await soldeDe(SEDIMA)).toBe(10_000);
    expect([ledger.youOwe, ledger.owedToYou]).toEqual([0, 10_000]);
  });

  it('de l’argent reçu du tiers diminue ce qu’il te doit', async () => {
    expect((await regle(unReglement(704, { counterpartyId: SEDIMA, amount: 10_000, direction: 'FromCounterparty' }))).status).toBe(201);

    expect(await soldeDe(SEDIMA)).toBe(0);
  });

  it('les règles du domaine refusent (400, avec le motif) sans rien écrire', async () => {
    const refus = await Promise.all([
      regle(unReglement(710, { amount: 0 })),
      regle(unReglement(711, { paidOn: '2026-11-13' })),
      regle(unReglement(712, { counterpartyId: ANCIEN })),
      regle(unReglement(713, { counterpartyId: TIERS_DE_B })),
      regle(unReglement(714, { method: 'Cheque' as never })),
      regle({ ...unReglement(715), tenantId: TENANT_B }),
      regle({ ...unReglement(716), amount: '20000' }),
    ]);

    expect(await Promise.all(refus.map(async (response) => [response.status, await kindOf(response)]))).toEqual([
      [400, 'InvalidAmount'],
      [400, 'PaidInFuture'],
      [400, 'CounterpartyArchived'],
      [400, 'UnknownCounterparty'],
      [400, 'UnknownPaymentMethod'],
      [400, 'InvalidRequest'],
      [400, 'InvalidRequest'],
    ]);
    expect(await db.superuser.settlement.count({ where: { id: { in: [710, 711, 712, 713, 714, 715, 716].map(uuid) } } })).toBe(0);
  });

  // Spec: backlog R.4 — payé par un tiers, et ses frais pris en charge (décisions du 2026-11-12).
  describe('payé par un tiers', () => {
    const depense = (rank: number, amount: number, counterpartyId: string) =>
      call('POST', 'costs', { id: uuid(rank), campaignId: BANDE, costTypeId: ALIMENT, spentOn: '2026-11-11', amount, note: null, payment: { kind: 'PaidBy', counterpartyId }, receipt: null });
    const paie = (rank: number, fields: Record<string, unknown> = {}) => call('POST', `orders/${uuid(20)}/payments`, { id: uuid(rank), paidOn: '2026-11-11', amount: 20_000, method: 'Wave', paidBy: RAMASSEUR, ...fields });

    it('un acheteur paie une dépense de la bande et ses frais, pris en charge : sa créance baisse de 100 000 + 1 000 F ; la dépense compte dans l’engagé', async () => {
      const avant = (await soldeDe(RAMASSEUR)) ?? 0;
      const engageAvant = ((await (await call('GET', `campaigns/${BANDE}/money`)).json()) as { committed: number }).committed;

      expect((await depense(710, 100_000, RAMASSEUR)).status).toBe(201);
      expect((await depense(711, 1_000, RAMASSEUR)).status).toBe(201);

      expect(await soldeDe(RAMASSEUR)).toBe(avant - 101_000);
      expect((await livre()).counterparties.find((line) => line.counterpartyId === RAMASSEUR)?.entries).toEqual(
        expect.arrayContaining([{ on: '2026-11-11', amount: -100_000, source: { kind: 'Cost', costId: uuid(710), paidBy: true } }]),
      );
      expect(((await (await call('GET', `campaigns/${BANDE}/money`)).json()) as { committed: number }).committed).toBe(engageAvant + 101_000);
    });

    it('un acheteur paie une commande : la dette envers Sedima baisse de 20 000 F, la créance de l’acheteur aussi ; tracé ; renvoyé, compté une fois', async () => {
      const sedima = (await soldeDe(SEDIMA)) ?? 0;
      const acheteur = (await soldeDe(RAMASSEUR)) ?? 0;

      expect((await paie(720)).status).toBe(201);
      expect((await paie(720)).status).toBe(200);

      expect(await soldeDe(SEDIMA)).toBe(sedima + 20_000);
      expect(await soldeDe(RAMASSEUR)).toBe(acheteur - 20_000);
      expect((await livre()).counterparties.find((line) => line.counterpartyId === RAMASSEUR)?.entries).toEqual(
        expect.arrayContaining([{ on: '2026-11-11', amount: -20_000, source: { kind: 'OrderPaidBy', orderId: uuid(20), method: 'Wave' } }]),
      );
      const order = ((await (await call('GET', 'orders')).json()) as { id: string; payments: { id: string; paidBy?: string | null }[] }[]).find((one) => one.id === uuid(20));
      expect(order?.payments.find((one) => one.id === uuid(720))?.paidBy).toBe(RAMASSEUR);
    });

    it('le même paiement avec un autre tiers est refusé (409) ; le fournisseur lui-même, un tiers archivé ou inconnu : refusés (400)', async () => {
      expect((await paie(720, { paidBy: OUSMANE_TIERS })).status).toBe(409);
      const refus = [await paie(721, { paidBy: SEDIMA }), await paie(722, { paidBy: ANCIEN }), await paie(723, { paidBy: uuid(99) }), await depense(724, 1_000, ANCIEN)];
      expect(refus.map((response) => response.status)).toEqual([400, 400, 400, 400]);
      expect(await Promise.all(refus.slice(0, 3).map(kindOf))).toEqual(['PaidBySupplier', 'CounterpartyArchived', 'UnknownCounterparty']);
    });
  });

  it("le grand livre d'un autre élevage ne se voit pas", async () => {
    expect((await livre(tokenOf(GERANT_DE_B, TENANT_B, 'admin'))).counterparties).toEqual([]);
  });

  it('un gardien reçoit un refus (403) : aucun solde ne lui parvient', async () => {
    const gardien = tokenOf(OUSMANE, TENANT_A, 'collaborator');
    expect([(await call('GET', 'ledger', undefined, gardien)).status, (await regle(unReglement(720), gardien)).status]).toEqual([403, 403]);
  });

  // Spec: backlog R.8 — « payé d'avance » (le fondateur a lu « il te doit » pour un fournisseur payé avant de livrer)
  it('un fournisseur payé avant de livrer : son solde dit la part payée d’avance, qui attend sa livraison', async () => {
    const [BASSIROU, COMMANDE, LIGNE] = [uuid(801), uuid(802), uuid(803)];
    await db.superuser.counterparty.create({ data: { id: BASSIROU, tenantId: TENANT_A, kind: 'Supplier', name: 'Bassirou', face: 'closed-bag' } });
    await db.superuser.purchaseOrder.create({ data: { id: COMMANDE, tenantId: TENANT_A, supplierId: BASSIROU, campaignId: BANDE, orderDay: new Date('2026-11-12'), currency: 'XOF' } });
    await db.superuser.orderLine.create({ data: { id: LIGNE, tenantId: TENANT_A, orderId: COMMANDE, position: 0, costTypeId: ALIMENT, quantity: 10, unitPrice: 18_000, bagWeight: 50_000 } });
    await db.superuser.payment.create({ data: { id: uuid(804), tenantId: TENANT_A, orderId: COMMANDE, paidOn: new Date('2026-11-12'), amount: 180_000, method: 'Wave', recordedBy: LE_GERANT } });

    const ligne = (await livre()).counterparties.find(({ counterpartyId }) => counterpartyId === BASSIROU);
    // Rien reçu : 180 000 payés, rien de facturable → il a 180 000 d'avance, à livrer
    expect(ligne).toMatchObject({ balance: 180_000, paidAhead: 180_000 });
    expect((await livre()).counterparties.find(({ counterpartyId }) => counterpartyId === SEDIMA)).not.toHaveProperty('paidAhead');

    // Bassirou rend 50 000 : il ne garde que 130 000 — la part d'avance ne dépasse jamais ce qu'il doit
    expect((await regle(unReglement(805, { counterpartyId: BASSIROU, amount: 50_000, direction: 'FromCounterparty' }))).status).toBe(201);
    expect((await livre()).counterparties.find(({ counterpartyId }) => counterpartyId === BASSIROU)).toMatchObject({ balance: 130_000, paidAhead: 130_000 });
  });
});

