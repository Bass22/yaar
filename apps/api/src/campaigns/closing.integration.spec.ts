import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { unwrap, type Clock } from '@kit';
import { Instant } from '@domain/journal';
import type { CampaignMoneyView, CaretakerContext, ClosedLotView, ClosingReportView, TrackingView } from '@contracts';
import { AppModule } from '../app.module';
import { issueAccessToken, type SessionClaims } from '../auth/access-token';
import { CLOCK } from '../auth/auth.module';
import { APP_CONFIG } from '../config/app-config';
import { configureApp } from '../create-app';
import { createTestDatabase, type TestDatabase } from '../testing/test-database';

// Spec: backlog X.2 — clôturer une campagne ; cahier des charges « Les restes et le bilan »
// (décisions du fondateur du 2026-11-12) ; CLAUDE.md §4 règles 1 (rien ne s'efface), 4, 5, 8 et 14.
// PostgreSQL réel, HTTP. Les montants attendus sont calculés à la main.
jest.setTimeout(180_000);

const SECRET = 'un-secret-de-test-assez-long-pour-signer-des-jetons';
const uuid = (rank: number): string => `00000000-0000-4000-8000-${String(rank).padStart(12, '0')}`;
const TENANT = uuid(10);
const AUTRE_ELEVAGE = uuid(11);
const NORD = uuid(3);
const SUD = uuid(8);
const BANDE = uuid(4);
const SUIVANTE = uuid(5);
const AU_SUD = uuid(6);
const DEJA_CLOSE = uuid(9);
const SANS_RESTES = uuid(12);
const BANDE_AILLEURS = uuid(13);
const TROISIEME = uuid(14);
const SEDIMA = uuid(31);
const MOUSSA = uuid(33);
const POUSSINS = uuid(42);
const DEMARRAGE = uuid(43);
const VACCIN = uuid(44);
const LITIERE = uuid(45);
const OUSMANE = uuid(51);
const LE_GERANT = uuid(54);
const ORDINATEUR = uuid(92);
const PIN_HASH = '$argon2id$v=19$m=19456,t=2,p=1$dGVzdC1vbmx5LXNhbHQ$dGVzdC1vbmx5LWRpZ2VzdC1ub3QtYS1yZWFsLXBpbg';

describe('Clôturer une bande, au bureau', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let origin: string;
  // Wednesday November 4th, 2026, 10:00 in Dakar: day 23 of a flock placed on October 12th.
  const now = Date.parse('2026-11-04T10:00:00.000Z');
  let tick = 0;
  const clock: Clock = { now: () => new Date(now + (tick += 1000)) };
  const tokenOf = (sub: string, role: SessionClaims['role'], tenant = TENANT) => issueAccessToken({ sub, tenant, role, device: ORDINATEUR }, unwrap(Instant(new Date(now - 60_000).toISOString())), SECRET);
  const call = (method: string, path: string, body?: unknown, token = tokenOf(LE_GERANT, 'admin')) =>
    fetch(`${origin}/api/v1/${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const clore = (campaignId: string, body: unknown, token = tokenOf(LE_GERANT, 'admin')) => call('POST', `campaigns/${campaignId}/closing`, body, token);
  const RESTES = [
    { costTypeId: DEMARRAGE, whole: 2, opened: true },
    { costTypeId: VACCIN, whole: 3, opened: true },
    { costTypeId: LITIERE, whole: 1, opened: false },
  ];
  const demande = (fields: object = {}) => ({ leftovers: RESTES, leftoversTo: SUIVANTE, comment: '  Bonne bande, chaleur en semaine 4.  ', ...fields });
  const refus = async (response: Response) => ({ status: response.status, kind: ((await response.json()) as { kind?: string }).kind });

  beforeAll(async () => {
    db = await createTestDatabase();
    await db.superuser.tenant.createMany({ data: [{ id: TENANT, name: 'Ferme', currency: 'XOF' }, { id: AUTRE_ELEVAGE, name: 'Ailleurs', currency: 'XOF' }] });
    await db.superuser.site.createMany({
      data: [
        { id: NORD, tenantId: TENANT, name: 'Poulailler Nord', timeZone: 'Africa/Dakar' },
        { id: SUD, tenantId: TENANT, name: 'Poulailler Sud', timeZone: 'Africa/Dakar' },
        { id: uuid(7), tenantId: AUTRE_ELEVAGE, name: 'Là-bas', timeZone: 'Africa/Dakar' },
      ],
    });
    const bande = (id: string, siteId: string, placementDay: string, tenantId = TENANT) => ({ id, tenantId, siteId, placementDay: new Date(placementDay), strain: 'Cobb500', plannedHeadcount: 1000, plannedDuration: 45 });
    await db.superuser.campaign.createMany({
      data: [
        bande(BANDE, NORD, '2026-10-12'),
        bande(SUIVANTE, NORD, '2026-11-01'),
        bande(AU_SUD, SUD, '2026-10-20'),
        { ...bande(DEJA_CLOSE, NORD, '2026-09-01'), closedAt: new Date('2026-10-15T10:00:00.000Z') },
        bande(SANS_RESTES, SUD, '2026-10-01'),
        bande(BANDE_AILLEURS, uuid(7), '2026-10-12', AUTRE_ELEVAGE),
        bande(TROISIEME, NORD, '2026-11-03'),
      ],
    });
    await db.superuser.user.createMany({
      data: [
        { id: OUSMANE, tenantId: TENANT, role: 'collaborator', phone: '+221770000001', name: 'Ousmane', pinHash: PIN_HASH },
        { id: LE_GERANT, tenantId: TENANT, role: 'admin', phone: '+221770000002', name: 'Le gérant', pinHash: PIN_HASH },
      ],
    });
    await db.superuser.siteAssignment.create({ data: { tenantId: TENANT, siteId: NORD, userId: OUSMANE, isPrimary: true } });
    await db.superuser.counterparty.createMany({
      data: [
        { id: SEDIMA, tenantId: TENANT, kind: 'Supplier', name: 'Sedima', face: 'closed-bag' },
        { id: MOUSSA, tenantId: TENANT, kind: 'Customer', name: 'Moussa', face: 'hen' },
      ],
    });
    await db.superuser.costType.createMany({
      data: [
        { id: POUSSINS, tenantId: TENANT, category: 'Chicks', name: 'Poussins', behaviour: 'Variable' },
        { id: DEMARRAGE, tenantId: TENANT, category: 'Feed', name: 'Aliment démarrage', behaviour: 'Variable' },
        { id: VACCIN, tenantId: TENANT, category: 'Health', name: 'Antibiotique', behaviour: 'Variable' },
        { id: LITIERE, tenantId: TENANT, category: 'Bedding', name: 'Copeaux', behaviour: 'Variable' },
      ],
    });
    // 1 000 chicks at 550 F, 20 bags at 15 000 F, 10 pots at 12 500 F, all received: 975 000 F committed.
    await db.superuser.purchaseOrder.create({ data: { id: uuid(20), tenantId: TENANT, supplierId: SEDIMA, campaignId: BANDE, orderDay: new Date('2026-10-12'), currency: 'XOF', announcedAt: new Date('2026-10-12T09:00:00.000Z') } });
    await db.superuser.orderLine.createMany({
      data: [
        { id: uuid(21), tenantId: TENANT, orderId: uuid(20), position: 0, costTypeId: POUSSINS, quantity: 1000, unitPrice: 550 },
        { id: uuid(22), tenantId: TENANT, orderId: uuid(20), position: 1, costTypeId: DEMARRAGE, quantity: 20, unitPrice: 15_000 },
        { id: uuid(23), tenantId: TENANT, orderId: uuid(20), position: 2, costTypeId: VACCIN, quantity: 10, unitPrice: 12_500 },
      ],
    });
    const on = (day: string, rank: number) => ({ businessDate: new Date(day), recordedAt: new Date(`${day}T18:${String(rank % 60).padStart(2, '0')}:00.000Z`) });
    const event = (rank: number, day: string, type: 'Delivery' | 'BagOpened' | 'Death', fact: { [key: string]: string | number | { kind: string } }) => ({ id: uuid(rank), tenantId: TENANT, siteId: NORD, campaignId: BANDE, authorId: OUSMANE, deviceId: uuid(93), type, fact, ...on(day, rank) });
    const recu = (orderLineId: string, receivedQuantity: number) => ({ orderLineId, receivedQuantity, deliveryNote: { kind: 'NoPaper' } });
    await db.superuser.journalEvent.createMany({
      data: [
        event(201, '2026-10-12', 'Delivery', recu(uuid(21), 1000)),
        event(202, '2026-10-12', 'Delivery', recu(uuid(22), 20)),
        event(203, '2026-10-12', 'Delivery', recu(uuid(23), 10)),
        event(204, '2026-10-12', 'BagOpened', { quantity: 2 }),
        event(205, '2026-10-17', 'Death', { quantity: 50 }),
        event(206, '2026-11-01', 'BagOpened', { quantity: 15 }),
      ],
    });

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(APP_CONFIG)
      .useValue({ port: 0, databaseUrl: db.appUrl, jwtSecret: SECRET, mediaPath: '/data/medias' })
      .overrideProvider(CLOCK)
      .useValue(clock)
      .compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.listen(0, '127.0.0.1');
    origin = await app.getUrl();
    // 900 birds sold at 2 500 F on November 2nd: 2 250 000 F, of which 2 000 000 F received.
    const vente = { id: uuid(301), campaignId: BANDE, buyerId: MOUSSA, soldOn: '2026-11-02', birds: 900, pricing: { kind: 'PerBird', unitPrice: 2_500 }, receivedNow: { id: uuid(302), amount: 2_000_000, method: 'Cash' } };
    expect((await call('POST', 'sales', vente)).status).toBe(201);
  });

  afterAll(async () => {
    await app?.close();
    await db?.drop();
  });

  describe('avant la clôture', () => {
    it('le bilan n’existe pas tant que la bande tourne', async () => {
      expect((await call('GET', `campaigns/${BANDE}/closing-report`)).status).toBe(404);
    });

    it('le gardien ne clôture pas', async () => {
      expect((await clore(BANDE, demande(), tokenOf(OUSMANE, 'collaborator'))).status).toBe(403);
    });

    it('une bande inconnue, d’un autre élevage ou mal nommée : introuvable', async () => {
      expect((await clore(uuid(99), demande())).status).toBe(404);
      expect((await clore(BANDE_AILLEURS, demande())).status).toBe(404);
      expect((await clore('bande', demande())).status).toBe(404);
    });

    it.each([
      ['un champ en trop', { ...demande(), closedAt: '2026-01-01T00:00:00.000Z' }],
      ['sans la réponse sur les restes', { leftoversTo: SUIVANTE, comment: null }],
      ['des restes qui ne sont pas une liste', demande({ leftovers: 'rien' })],
      ['un reste mal formé', demande({ leftovers: [{ costTypeId: DEMARRAGE, whole: '2', opened: false }] })],
    ])('une demande mal formée est refusée : %s', async (_label, body) => {
      expect(await refus(await clore(BANDE, body))).toEqual({ status: 400, kind: 'InvalidRequest' });
    });

    it.each([
      ['des restes sans bande pour les recevoir', demande({ leftoversTo: null }), 'LeftoversWithoutReceiver'],
      ['vers elle-même', demande({ leftoversTo: BANDE }), 'SameCampaign'],
      ['vers une bande d’un autre site', demande({ leftoversTo: AU_SUD }), 'OtherSite'],
      ['vers une bande close', demande({ leftoversTo: DEJA_CLOSE }), 'DestinationClosed'],
      ['vers une bande inconnue', demande({ leftoversTo: uuid(98) }), 'UnknownReceiver'],
      ['des poussins en restes', demande({ leftovers: [{ costTypeId: POUSSINS, whole: 1, opened: false }] }), 'NotALeftover'],
      ['un type inconnu', demande({ leftovers: [{ costTypeId: uuid(97), whole: 1, opened: false }] }), 'UnknownCostType'],
      ['une ligne vide', demande({ leftovers: [{ costTypeId: DEMARRAGE, whole: 0, opened: false }] }), 'EmptyLeftover'],
      ['un nombre négatif', demande({ leftovers: [{ costTypeId: DEMARRAGE, whole: -1, opened: false }] }), 'InvalidQuantity'],
      ['un type en double', demande({ leftovers: [RESTES[0], RESTES[0]] }), 'DuplicateType'],
      ['un commentaire de plus de 2 000 caractères', demande({ comment: 'x'.repeat(2001) }), 'CommentTooLong'],
    ])('une clôture refusée ne touche à rien : %s', async (_label, body, kind) => {
      expect(await refus(await clore(BANDE, body))).toEqual({ status: 400, kind });
      expect(await db.superuser.campaign.findUniqueOrThrow({ where: { id: BANDE }, select: { closedAt: true } })).toEqual({ closedAt: null });
      expect(await db.superuser.campaignLeftover.count()).toBe(0);
    });

    it('une bande déjà close ne se clôture pas une seconde fois', async () => {
      expect(await refus(await clore(DEJA_CLOSE, demande({ leftovers: [], leftoversTo: null })))).toEqual({ status: 409, kind: 'CampaignClosed' });
    });

    it('une bande déjà close est refusée avant même de lire ses restes', async () => {
      expect(await refus(await clore(DEJA_CLOSE, demande({ leftoversTo: null })))).toEqual({ status: 409, kind: 'CampaignClosed' });
    });
  });

  describe('la clôture', () => {
    beforeAll(async () => {
      expect((await clore(BANDE, demande())).status).toBe(204);
    });

    it('la bande est close, ses restes écrits, la bande qui les reçoit et le commentaire gardés ; rien d’effacé', async () => {
      expect(await db.superuser.campaign.findUniqueOrThrow({ where: { id: BANDE }, select: { closedAt: true, leftoversTo: true, closingComment: true } })).toEqual({
        closedAt: expect.any(Date) as Date,
        leftoversTo: SUIVANTE,
        closingComment: 'Bonne bande, chaleur en semaine 4.',
      });
      expect(await db.superuser.campaignLeftover.findMany({ where: { campaignId: BANDE }, orderBy: { costTypeId: 'asc' }, select: { costTypeId: true, whole: true, opened: true } })).toEqual(RESTES);
      expect(await db.superuser.journalEvent.count({ where: { campaignId: BANDE } })).toBe(6);
      expect(await db.superuser.sale.count({ where: { campaignId: BANDE } })).toBe(1);
    });

    it('la clôture est tracée : qui, quelle bande, quel site, depuis quel appareil', async () => {
      expect(await db.superuser.auditEvent.findMany({ where: { action: 'CampaignClosed' }, select: { actorId: true, subjectId: true, siteId: true, deviceId: true } })).toEqual([{ actorId: LE_GERANT, subjectId: BANDE, siteId: NORD, deviceId: ORDINATEUR }]);
    });

    it('une seconde clôture est refusée', async () => {
      expect(await refus(await clore(BANDE, demande()))).toEqual({ status: 409, kind: 'CampaignClosed' });
    });

    it('le bilan : poussins, pertes, coûts, restes, revenus, coût par poulet et prix de vente par poussin reçu, bénéfice, commentaire', async () => {
      // Démarrage : 300 000 F pour 20 sacs = 40 demis ; 2 sacs et un entamé = 5 demis → 37 500 F
      // Antibiotique : 125 000 F pour 10 pots = 20 demis ; 3 pots et un entamé = 7 demis → 43 750 F
      // Copeaux : jamais reçus dans la bande → valeur inconnue ; restes transférés 81 250 F
      // Coûts 550 000 + 300 000 + 125 000 = 975 000 F ; coût net 975 000 − 81 250 = 893 750 F
      // Coût par poulet 893 750 ÷ 1 000 = 893,75 → 894 F ; prix de vente 2 250 000 ÷ 1 000 = 2 250 F
      // Bénéfice 2 250 000 − 893 750 = 1 356 250 F
      expect((await (await call('GET', `campaigns/${BANDE}/closing-report`)).json()) as ClosingReportView).toEqual({
        campaignId: BANDE,
        siteName: 'Poulailler Nord',
        placementDay: '2026-10-12',
        closedAt: expect.stringMatching(/^2026-11-04T10:00:\d\d\.000Z$/) as string,
        currency: 'XOF',
        chicksReceived: 1000,
        deaths: 50,
        losses: 0,
        birdsSold: 900,
        costs: 975_000,
        leftovers: [
          { costTypeId: DEMARRAGE, name: 'Aliment démarrage', unit: 'bag', whole: 2, opened: true, value: 37_500 },
          { costTypeId: VACCIN, name: 'Antibiotique', unit: 'unit', whole: 3, opened: true, value: 43_750 },
          { costTypeId: LITIERE, name: 'Copeaux', unit: 'bag', whole: 1, opened: false, value: null },
        ],
        leftoversTo: { campaignId: SUIVANTE, siteName: 'Poulailler Nord', placementDay: '2026-11-01' },
        leftoversValue: 81_250,
        netCost: 893_750,
        revenue: 2_250_000,
        cashedIn: 2_000_000,
        costPerBird: 894,
        revenuePerChick: 2_250,
        profit: 1_356_250,
        comment: 'Bonne bande, chaleur en semaine 4.',
      });
    });

    it('la bande qui reçoit les restes les paie : leur valeur entre dans son engagé', async () => {
      const money = (await (await call('GET', `campaigns/${SUIVANTE}/money`)).json()) as CampaignMoneyView;

      expect(money.committed).toBe(81_250);
    });

    it('une bande qui a reçu des restes les compte à leur valeur dans le prix moyen de ses propres restes', async () => {
      // La bande suivante n'a rien commandé : son démarrage, ce sont les 5 demis reçus pour 37 500 F.
      // Elle laisse un sac entamé (1 demi) à la troisième : 37 500 × 1 ÷ 5 = 7 500 F
      expect((await clore(SUIVANTE, { leftovers: [{ costTypeId: DEMARRAGE, whole: 0, opened: true }], leftoversTo: TROISIEME, comment: null })).status).toBe(204);

      const report = (await (await call('GET', `campaigns/${SUIVANTE}/closing-report`)).json()) as ClosingReportView;
      expect(report.leftovers).toEqual([{ costTypeId: DEMARRAGE, name: 'Aliment démarrage', unit: 'bag', whole: 0, opened: true, value: 7_500 }]);
      expect(((await (await call('GET', `campaigns/${TROISIEME}/money`)).json()) as CampaignMoneyView).committed).toBe(7_500);
    });

    it('le sac d’aliment entamé sort de la consommation, au dernier jour où un sac a été ouvert', async () => {
      // J0 : 2 sacs ÷ 1 000 = 100 g ; J20 : (15 − 0,5) sacs ÷ 950 = 763,16 g → 863 g (et non 889 g sans le demi-sac)
      expect(((await (await call('GET', `campaigns/${BANDE}/tracking`)).json()) as TrackingView).feed.cumulative).toBe(863);
    });

    it('le gardien du site ne voit plus les bandes closes : il voit la seule bande encore en cours', async () => {
      const response = await call('GET', 'caretaker/context', undefined, tokenOf(OUSMANE, 'collaborator'));
      const context = (await response.json()) as CaretakerContext;

      expect(context.sites.flatMap((site) => site.campaigns.map((campaign) => campaign.campaignId))).toEqual([TROISIEME]);
    });

    it('une bande close refuse une vente et un coût', async () => {
      const vente = { id: uuid(303), campaignId: BANDE, buyerId: MOUSSA, soldOn: '2026-11-04', birds: 10, pricing: { kind: 'PerBird', unitPrice: 2_500 }, receivedNow: null };
      expect((await refus(await call('POST', 'sales', vente))).kind).toBe('CampaignClosed');
      const cout = { id: uuid(304), campaignId: BANDE, costTypeId: DEMARRAGE, spentOn: '2026-11-04', amount: 1_000, payment: { kind: 'Paid' }, note: null, receipt: null };
      expect((await refus(await call('POST', 'costs', cout))).kind).toBe('CampaignClosed');
    });

    it('une bande sans restes se clôture aussi : « aucun reste » est une réponse', async () => {
      expect((await clore(SANS_RESTES, { leftovers: [], leftoversTo: null, comment: null })).status).toBe(204);

      const report = (await (await call('GET', `campaigns/${SANS_RESTES}/closing-report`)).json()) as ClosingReportView;
      expect(report).toMatchObject({ leftovers: [], leftoversTo: null, leftoversValue: 0, chicksReceived: 0, costPerBird: null, revenuePerChick: null, comment: null });
    });

    it('les lots clôturés restent consultables, le dernier clos en premier', async () => {
      const lots = (await (await call('GET', 'campaigns/closed')).json()) as ClosedLotView[];

      expect(lots.map(({ campaignId, siteName }) => [campaignId, siteName])).toEqual([
        [SANS_RESTES, 'Poulailler Sud'],
        [SUIVANTE, 'Poulailler Nord'],
        [BANDE, 'Poulailler Nord'],
        [DEJA_CLOSE, 'Poulailler Nord'],
      ]);
    });

    it('le gardien ne lit ni le bilan ni les lots clôturés', async () => {
      expect((await call('GET', `campaigns/${BANDE}/closing-report`, undefined, tokenOf(OUSMANE, 'collaborator'))).status).toBe(403);
      expect((await call('GET', 'campaigns/closed', undefined, tokenOf(OUSMANE, 'collaborator'))).status).toBe(403);
    });

    it('le bilan d’une bande d’un autre élevage est introuvable', async () => {
      expect((await call('GET', `campaigns/${BANDE_AILLEURS}/closing-report`)).status).toBe(404);
    });
  });
});
