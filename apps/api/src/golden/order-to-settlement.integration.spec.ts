import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { unwrap, type Clock } from '@kit';
import { Instant } from '@domain/journal';
import type { CampaignMoneyView, CaretakerContext, LedgerView, OrderView } from '@contracts';
import { AppModule } from '../app.module';
import { issueAccessToken, type SessionClaims } from '../auth/access-token';
import { CLOCK } from '../auth/auth.module';
import { APP_CONFIG } from '../config/app-config';
import { configureApp } from '../create-app';
import { createTestDatabase, type TestDatabase } from '../testing/test-database';

// Spec: backlog Z.3 — parcours doré, de la commande au solde ; cahier des charges « Commandes »
// (le cas réel du fondateur : la commande du 12/10, multi-lignes, reçue en trois livraisons — le
// véto le 12, l'aliment le 14, les poussins le 16 —, payée à d'autres dates), « Livraison
// annoncée », « Les dépenses », « Le grand livre ». Tout passe par les routes, comme sur le terrain :
// le gérant au bureau, le gardien sur son téléphone. Chaque montant attendu est calculé à la main.
jest.setTimeout(180_000);

const SECRET = 'un-secret-de-test-assez-long-pour-signer-des-jetons';
const uuid = (rank: number): string => `00000000-0000-4000-8000-${String(rank).padStart(12, '0')}`;
const TENANT = uuid(10);
const NORD = uuid(3);
const BANDE = uuid(4);
const VETO = uuid(41);
const ALIMENT = uuid(42);
const POUSSINS = uuid(43);
const OUSMANE = uuid(51);
const LE_GERANT = uuid(54);
const SEDIMA = uuid(31);
const COMMANDE = uuid(20);
const LIGNE_VETO = uuid(21);
const LIGNE_ALIMENT = uuid(22);
const LIGNE_POUSSINS = uuid(23);
const TELEPHONE = uuid(93);
const ORDINATEUR = uuid(92);
const PIN_HASH = '$argon2id$v=19$m=19456,t=2,p=1$dGVzdC1vbmx5LXNhbHQ$dGVzdC1vbmx5LWRpZ2VzdC1ub3QtYS1yZWFsLXBpbg';
const PV = 'f'.repeat(64);

describe('Parcours doré : la commande du 12/10, de la commande au solde', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let origin: string;
  // The office writes on October 20th, after the last delivery.
  const now = Date.parse('2026-10-20T10:00:00.000Z');
  let tick = 0;
  const clock: Clock = { now: () => new Date(now + (tick += 1000)) };
  const tokenOf = (sub: string, role: SessionClaims['role'], device: string) => issueAccessToken({ sub, tenant: TENANT, role, device }, unwrap(Instant(new Date(now - 60_000).toISOString())), SECRET);
  const gerant = () => tokenOf(LE_GERANT, 'admin', ORDINATEUR);
  const gardien = () => tokenOf(OUSMANE, 'collaborator', TELEPHONE);
  const call = (method: string, path: string, body?: unknown, token = gerant()) =>
    fetch(`${origin}/api/v1/${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const commande = async () => ((await (await call('GET', 'orders')).json()) as OrderView[]).find(({ id }) => id === COMMANDE);
  const argent = async () => (await (await call('GET', `campaigns/${BANDE}/money`)).json()) as CampaignMoneyView;
  const soldeDeSedima = async () => ((await (await call('GET', 'ledger')).json()) as LedgerView).counterparties.find(({ counterpartyId }) => counterpartyId === SEDIMA)?.balance;
  // What the caretaker's phone receives, raw: it must never carry an amount (rule 4).
  const textesDuGardien: string[] = [];
  const cahier = async () => {
    const raw = await (await call('GET', 'caretaker/context', undefined, gardien())).text();
    textesDuGardien.push(raw);
    return (JSON.parse(raw) as CaretakerContext).sites[0]?.campaigns[0];
  };
  // The caretaker counts a delivery on the day it arrives, with the driver's paper or without.
  const recoit = async (rank: number, day: string, orderLineId: string, receivedQuantity: number, paper: boolean) => {
    const response = await call(
      'POST',
      'journal/events',
      { events: [{ id: uuid(rank), siteId: NORD, campaignId: BANDE, businessDate: day, recordedAt: `${day}T09:00:00.000Z`, fact: { type: 'Delivery', orderLineId, receivedQuantity, deliveryNote: paper ? { kind: 'Photographed', media: PV } : { kind: 'NoPaper' } } }] },
      gardien(),
    );
    return ((await response.json()) as { outcomes: { status: string }[] }).outcomes[0]?.status;
  };

  beforeAll(async () => {
    db = await createTestDatabase();
    // What the bootstrap and the opening of the campaign leave: a farm, its site, its caretaker, its types.
    await db.superuser.tenant.create({ data: { id: TENANT, name: 'Ferme', currency: 'XOF' } });
    await db.superuser.site.create({ data: { id: NORD, tenantId: TENANT, name: 'Poulailler Nord', timeZone: 'Africa/Dakar' } });
    await db.superuser.campaign.create({ data: { id: BANDE, tenantId: TENANT, siteId: NORD, placementDay: new Date('2026-10-12'), strain: 'Cobb500', plannedHeadcount: 1000, plannedDuration: 45 } });
    await db.superuser.user.createMany({
      data: [
        { id: OUSMANE, tenantId: TENANT, role: 'collaborator', phone: '+221770000001', name: 'Ousmane', pinHash: PIN_HASH },
        { id: LE_GERANT, tenantId: TENANT, role: 'admin', phone: '+221770000002', name: 'Le gérant', pinHash: PIN_HASH },
      ],
    });
    await db.superuser.siteAssignment.create({ data: { tenantId: TENANT, siteId: NORD, userId: OUSMANE, isPrimary: true } });
    await db.superuser.costType.createMany({
      data: [
        { id: VETO, tenantId: TENANT, category: 'Health', name: 'Vaccins et soins', behaviour: 'Variable' },
        { id: ALIMENT, tenantId: TENANT, category: 'Feed', name: 'Aliment', behaviour: 'Variable', bagWeight: 50_000 },
        { id: POUSSINS, tenantId: TENANT, category: 'Chicks', name: 'Poussins', behaviour: 'Variable' },
      ],
    });
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

  it('1. le gérant crée Sedima sur place, écrit la commande multi-lignes du 12/10 et l’annonce au gardien', async () => {
    expect((await call('POST', 'counterparties', { id: SEDIMA, kind: 'Supplier', name: 'Sedima', face: 'closed-bag' })).status).toBe(201);
    const ecrite = await call('POST', 'orders', {
      id: COMMANDE,
      supplierId: SEDIMA,
      campaignId: BANDE,
      orderDay: '2026-10-12',
      reference: null,
      lines: [
        { id: LIGNE_VETO, costTypeId: VETO, quantity: 2, unitPrice: 25_000 },
        { id: LIGNE_ALIMENT, costTypeId: ALIMENT, quantity: 20, unitPrice: 17_500 },
        { id: LIGNE_POUSSINS, costTypeId: POUSSINS, quantity: 1000, unitPrice: 550 },
      ],
    });
    expect(ecrite.status).toBe(201);
    expect((await call('POST', `orders/${COMMANDE}/announce`)).status).toBe(204);

    // Ordered: 2 × 25 000 + 20 × 17 500 + 1 000 × 550 = 50 000 + 350 000 + 550 000 = 950 000 F; nothing received.
    expect(await commande()).toMatchObject({ status: 'Announced', billable: 0, paid: 0 });
    expect((await cahier())?.deliveries[0]?.lines.map(({ name, expected, remaining }) => [name, expected, remaining])).toEqual([
      ['Vaccins et soins', 2, 2],
      ['Aliment', 20, 20],
      ['Poussins', 1000, 1000],
    ]);
  });

  it('2. trois livraisons à des dates différentes : le véto le 12, l’aliment le 14 (un manque), les poussins le 16 (un bonus)', async () => {
    expect(await recoit(101, '2026-10-12', LIGNE_VETO, 2, true)).toBe('Accepted');
    expect(await recoit(102, '2026-10-14', LIGNE_ALIMENT, 18, false)).toBe('Accepted');
    // 21 boxes of 50 chicks counted: 1 050 written.
    expect(await recoit(103, '2026-10-16', LIGNE_POUSSINS, 1050, true)).toBe('Accepted');

    // Billable: 2 × 25 000 + min(18, 20) × 17 500 + min(1 050, 1 000) × 550 = 50 000 + 315 000 + 550 000 = 915 000 F.
    const order = await commande();
    expect(order).toMatchObject({ status: 'PartiallyReceived', billable: 915_000 });
    // Shortfall on the feed: 18 − 20 = −2; bonus on the chicks: 1 050 − 1 000 = +50 (the bonus is not billed).
    expect(order?.lines.map(({ received, quantity }) => received - quantity)).toEqual([0, -2, 50]);
    // What the phone still waits for: 2 bags of feed (the lines received whole come with 0 to come).
    expect((await cahier())?.deliveries[0]?.lines.filter(({ remaining }) => remaining > 0).map(({ name, remaining }) => [name, remaining])).toEqual([['Aliment', 2]]);
  });

  it('3. le gardien déclare 5 morts : les vivants, et l’engagé et le coût par poulet du gérant', async () => {
    const morts = await call('POST', 'journal/events', { events: [{ id: uuid(110), siteId: NORD, campaignId: BANDE, businessDate: '2026-10-17', recordedAt: '2026-10-17T18:00:00.000Z', fact: { type: 'Death', quantity: 5 } }] }, gardien());
    expect(morts.status).toBe(200);

    // Alive: 1 050 − 5 = 1 045.
    expect((await cahier())?.liveCount).toBe(1045);
    // Committed = the billable, 915 000 F. Birds expected: 1 050 × 93 % = 976,5 → 976 (fewer than 1 045 alive);
    // cost per bird: 915 000 ÷ 976 = 937,5 → 938 F.
    expect(await argent()).toMatchObject({ committed: 915_000, liveCount: 1045, costPerBird: 938 });
  });

  it('4. deux paiements à d’autres dates : « qui doit quoi » suit, et la commande close est soldée', async () => {
    // Paid 400 000 F by Wave on 13/10: you owe Sedima 915 000 − 400 000 = 515 000 F.
    expect((await call('POST', `orders/${COMMANDE}/payments`, { id: uuid(501), paidOn: '2026-10-13', amount: 400_000, method: 'Wave' })).status).toBe(201);
    expect(await soldeDeSedima()).toBe(-515_000);

    // The last 2 bags will not come: the order is closed; only what was received is billed.
    expect((await call('POST', `orders/${COMMANDE}/close`)).status).toBe(204);
    expect((await cahier())?.deliveries).toEqual([]);

    // Paid 515 000 F by Orange Money on 20/10: 400 000 + 515 000 = 915 000 F = billable → settled.
    expect((await call('POST', `orders/${COMMANDE}/payments`, { id: uuid(502), paidOn: '2026-10-20', amount: 515_000, method: 'OrangeMoney' })).status).toBe(201);
    expect(await commande()).toMatchObject({ status: 'Settled', billable: 915_000, paid: 915_000 });
    expect(await soldeDeSedima()).toBe(0);
    // A payment does not change the committed cost.
    expect((await argent()).committed).toBe(915_000);
  });

  it('5. le gardien n’a reçu aucun montant pendant tout le parcours', async () => {
    await cahier();
    expect(textesDuGardien.length).toBeGreaterThanOrEqual(5);
    for (const raw of textesDuGardien) {
      expect(raw).not.toMatch(/price|unitPrice|amount|billable|paid|currency|supplier|Sedima|XOF/i);
      for (const figure of ['17500', '25000', '550,', '915000', '400000', '515000']) {
        expect(raw).not.toContain(figure);
      }
    }
  });
});
