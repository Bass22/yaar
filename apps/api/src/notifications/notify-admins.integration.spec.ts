import { createECDH } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { unwrap, type Clock } from '@kit';
import { Instant } from '@domain/journal';
import type { CorrectionToReview } from '@contracts';
import { AppModule } from '../app.module';
import { issueAccessToken, type SessionClaims } from '../auth/access-token';
import { CLOCK } from '../auth/auth.module';
import { APP_CONFIG } from '../config/app-config';
import { configureApp } from '../create-app';
import { createTestDatabase, type TestDatabase } from '../testing/test-database';
import { PUSH_SENDER, type PushSender } from './site-notifications';

// Spec: backlog Y.2b — une correction d'un gardien et des morts au-delà des vivants préviennent
// les admins ; la carte « À traiter » d'une correction reste jusqu'à « Vu » (décision du fondateur
// du 2026-11-14). PostgreSQL réel, HTTP ; le service du navigateur est remplacé par un relevé.
jest.setTimeout(180_000);

const SECRET = 'un-secret-de-test-assez-long-pour-signer-des-jetons';
const uuid = (rank: number): string => `00000000-0000-4000-8000-${String(rank).padStart(12, '0')}`;
const TENANT = uuid(10);
const NORD = uuid(3);
const BANDE = uuid(4);
const OUSMANE = uuid(51);
const LE_GERANT = uuid(54);
const AMINATA = uuid(55);
const COUVOIR = uuid(31);
const POUSSINS = uuid(41);
const LIGNE_POUSSINS = uuid(21);
const PIN_HASH = '$argon2id$v=19$m=19456,t=2,p=1$dGVzdC1vbmx5LXNhbHQ$dGVzdC1vbmx5LWRpZ2VzdC1ub3QtYS1yZWFsLXBpbg';
const endpointOf = (who: string) => `https://fcm.googleapis.com/fcm/send/${who}`;

describe('Les admins sont prévenus, et la carte attend « Vu »', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let origin: string;
  const sent: { endpoint: string; payload: { notification: { title: string; body: string; data: unknown } } }[] = [];
  let failing = false;
  const sender: PushSender = async (device, payload) => {
    if (failing) throw new Error('le service ne répond pas');
    sent.push({ endpoint: device.endpoint, payload: payload as (typeof sent)[number]['payload'] });
    return 'Delivered';
  };
  // Saturday November 14th, 2026, 10:00 in Dakar: day 12 of a flock placed on November 2nd.
  const now = Date.parse('2026-11-14T10:00:00.000Z');
  let tick = 0;
  const clock: Clock = { now: () => new Date(now + (tick += 1000)) };
  const tokenOf = (sub: string, role: SessionClaims['role']) => issueAccessToken({ sub, tenant: TENANT, role, device: uuid(sub === OUSMANE ? 91 : 92) }, unwrap(Instant(new Date(now - 60_000).toISOString())), SECRET);
  const call = (method: string, path: string, body?: unknown, token = tokenOf(LE_GERANT, 'admin')) =>
    fetch(`${origin}/api/v1/${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  let at = 0;
  const ecrit = async (author: string, role: SessionClaims['role'], event: Record<string, unknown>) => {
    const recordedAt = new Date(now - 3_600_000 + (at += 60_000)).toISOString();
    const response = await call('POST', 'journal/events', { events: [{ siteId: NORD, campaignId: BANDE, businessDate: '2026-11-14', recordedAt, ...event }] }, tokenOf(author, role));
    return ((await response.json()) as { outcomes: { status: string }[] }).outcomes[0]?.status;
  };
  const aRelire = async () => (await (await call('GET', 'corrections/to-review')).json()) as CorrectionToReview[];
  /** What left once the requests answered: the sending happens after the commit. */
  const settled = async (count: number) => {
    for (let waited = 0; sent.length < count && waited < 5_000; waited += 20) await new Promise((resolve) => setTimeout(resolve, 20));
    await new Promise((resolve) => setTimeout(resolve, 150));
    return sent;
  };
  const pair = createECDH('prime256v1');
  pair.generateKeys();

  beforeAll(async () => {
    db = await createTestDatabase();
    await db.superuser.tenant.create({ data: { id: TENANT, name: 'Ferme', currency: 'XOF' } });
    await db.superuser.site.create({ data: { id: NORD, tenantId: TENANT, name: 'Poulailler Nord', timeZone: 'Africa/Dakar' } });
    await db.superuser.campaign.create({ data: { id: BANDE, tenantId: TENANT, siteId: NORD, placementDay: new Date('2026-11-02'), strain: 'Cobb500', plannedHeadcount: 1000, plannedDuration: 45 } });
    await db.superuser.user.createMany({
      data: [
        { id: OUSMANE, tenantId: TENANT, role: 'collaborator', phone: '+221770000001', name: 'Ousmane', pinHash: PIN_HASH },
        { id: LE_GERANT, tenantId: TENANT, role: 'admin', phone: '+221770000002', name: 'Le gérant', pinHash: PIN_HASH },
        { id: AMINATA, tenantId: TENANT, role: 'admin', phone: '+221770000005', name: 'Aminata', pinHash: PIN_HASH },
      ],
    });
    await db.superuser.siteAssignment.create({ data: { tenantId: TENANT, siteId: NORD, userId: OUSMANE, isPrimary: true } });
    await db.superuser.pushSubscription.createMany({
      data: [
        { tenantId: TENANT, deviceId: uuid(91), userId: OUSMANE, endpoint: endpointOf('ousmane'), p256dh: 'p', auth: 'a' },
        { tenantId: TENANT, deviceId: uuid(92), userId: LE_GERANT, endpoint: endpointOf('gerant'), p256dh: 'p', auth: 'a' },
        { tenantId: TENANT, deviceId: uuid(93), userId: AMINATA, endpoint: endpointOf('aminata'), p256dh: 'p', auth: 'a' },
      ],
    });
    // Ten chicks announced for the flock: the live count starts with them.
    await db.superuser.counterparty.create({ data: { id: COUVOIR, tenantId: TENANT, kind: 'Supplier', name: 'Couvoir', face: 'chick' } });
    await db.superuser.costType.create({ data: { id: POUSSINS, tenantId: TENANT, category: 'Chicks', name: 'Poussins', behaviour: 'Variable' } });
    await db.superuser.purchaseOrder.create({ data: { id: uuid(20), tenantId: TENANT, supplierId: COUVOIR, campaignId: BANDE, orderDay: new Date('2026-11-01'), currency: 'XOF', announcedAt: new Date('2026-11-01T09:00:00.000Z') } });
    await db.superuser.orderLine.create({ data: { id: LIGNE_POUSSINS, tenantId: TENANT, orderId: uuid(20), position: 0, costTypeId: POUSSINS, quantity: 10, unitPrice: 500 } });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(APP_CONFIG)
      .useValue({ port: 0, databaseUrl: db.appUrl, jwtSecret: SECRET, mediaPath: '/data/medias', vapidPublicKey: pair.getPublicKey().toString('base64url'), vapidPrivateKey: pair.getPrivateKey().toString('base64url'), vapidSubject: 'mailto:contact@exemple.sn' })
      .overrideProvider(CLOCK)
      .useValue(clock)
      .overrideProvider(PUSH_SENDER)
      .useValue(sender)
      .compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.listen(0, '127.0.0.1');
    origin = await app.getUrl();
  });

  afterAll(async () => {
    await app?.close();
    await db?.drop();
  });

  beforeEach(() => {
    sent.length = 0;
    failing = false;
  });

  it('Ousmane corrige ses morts : les deux admins sont prévenus — le site, le jour, avant → après, l’auteur — et lui ne l’est pas ; la carte attend', async () => {
    expect(await ecrit(OUSMANE, 'collaborator', { id: uuid(101), fact: { type: 'Death', quantity: 3 } })).toBe('Accepted');
    expect(await ecrit(OUSMANE, 'collaborator', { id: uuid(102), corrects: uuid(101), fact: { type: 'Death', quantity: 5 } })).toBe('Accepted');

    const messages = await settled(2);
    expect(messages.map(({ endpoint }) => endpoint).sort()).toEqual([endpointOf('aminata'), endpointOf('gerant')]);
    expect(messages[0]?.payload.notification).toMatchObject({ title: 'Le cahier est corrigé', body: 'Poulailler Nord, J12 : 3 morts → 5 morts, par Ousmane', data: { kind: 'CorrectionWritten', campaignId: BANDE } });
    expect(await aRelire()).toEqual([
      { correctionId: uuid(102), campaignId: BANDE, siteId: NORD, siteName: 'Poulailler Nord', businessDate: '2026-11-14', campaignDay: 12, authorName: 'Ousmane', before: '3 morts', after: '5 morts', recordedAt: expect.any(String) },
    ]);
  });

  it('une deuxième correction part de la précédente : 5 morts → 4 morts ; chaque correction a sa carte', async () => {
    expect(await ecrit(OUSMANE, 'collaborator', { id: uuid(103), corrects: uuid(101), fact: { type: 'Death', quantity: 4 } })).toBe('Accepted');

    expect((await settled(2))[0]?.payload.notification.body).toBe('Poulailler Nord, J12 : 5 morts → 4 morts, par Ousmane');
    expect((await aRelire()).map(({ correctionId, before, after }) => [correctionId, before, after])).toEqual([
      [uuid(103), '5 morts', '4 morts'],
      [uuid(102), '3 morts', '5 morts'],
    ]);
  });

  it('une correction écrite par l’admin ne prévient personne et n’attend pas de « Vu »', async () => {
    expect(await ecrit(OUSMANE, 'collaborator', { id: uuid(104), fact: { type: 'BagOpened', quantity: 2 } })).toBe('Accepted');
    expect(await ecrit(LE_GERANT, 'admin', { id: uuid(105), corrects: uuid(104), fact: { type: 'BagOpened', quantity: 1 } })).toBe('Accepted');

    expect(await settled(1)).toEqual([]);
    expect((await aRelire()).map(({ correctionId }) => correctionId)).not.toContain(uuid(105));
  });

  it('« Vu » range la carte, une fois pour toutes ; c’est tracé ; le journal ne change pas ; le gardien ne peut pas', async () => {
    expect((await call('POST', `corrections/${uuid(102)}/review`, undefined, tokenOf(OUSMANE, 'collaborator'))).status).toBe(403);
    expect((await call('POST', `corrections/${uuid(102)}/review`)).status).toBe(204);
    expect((await call('POST', `corrections/${uuid(102)}/review`, undefined, tokenOf(AMINATA, 'admin'))).status).toBe(204);
    expect((await call('POST', `corrections/${uuid(999)}/review`)).status).toBe(404);
    expect((await call('POST', `corrections/${uuid(101)}/review`)).status).toBe(404);

    expect((await aRelire()).map(({ correctionId }) => correctionId)).toEqual([uuid(103)]);
    expect(await db.superuser.correctionReview.findMany({ select: { correctionId: true, reviewedBy: true } })).toEqual([{ correctionId: uuid(102), reviewedBy: LE_GERANT }]);
    expect(await db.superuser.auditEvent.count({ where: { action: 'CorrectionReviewed' } })).toBe(1);
    expect(await db.superuser.journalEvent.count({ where: { id: uuid(102) } })).toBe(1);
  });

  it('des morts qui font passer les vivants sous zéro préviennent les admins, avec l’écart signé ; tant qu’ils restent au-dessus, rien', async () => {
    const reception = { type: 'Delivery', orderLineId: LIGNE_POUSSINS, receivedQuantity: 10, deliveryNote: { kind: 'NoPaper' } };
    expect(await ecrit(OUSMANE, 'collaborator', { id: uuid(110), fact: reception })).toBe('Accepted');
    // 10 reçus, 4 morts plus haut : 6 vivants ; 6 de plus, 0 vivant — zéro n'est pas en dessous
    expect(await ecrit(OUSMANE, 'collaborator', { id: uuid(111), fact: { type: 'Death', quantity: 6 } })).toBe('Accepted');
    expect(await settled(1)).toEqual([]);

    // Écrit par l'admin, à la place du gardien : les admins sont prévenus aussi
    expect(await ecrit(LE_GERANT, 'admin', { id: uuid(112), fact: { type: 'Death', quantity: 2 } })).toBe('Accepted');
    const messages = await settled(2);
    expect(messages.map(({ endpoint }) => endpoint).sort()).toEqual([endpointOf('aminata'), endpointOf('gerant')]);
    expect(messages[0]?.payload.notification).toMatchObject({ title: 'Plus de morts que de vivants', body: 'Poulailler Nord : les vivants sont à −2 — à vérifier', data: { kind: 'TooManyDeaths', campaignId: BANDE } });
  });

  // Les pertes (manquants, dons, vols) sortent des vivants comme les morts : les faire passer sous zéro prévient aussi
  it('des manquants écrits par l’admin qui font passer les vivants sous zéro préviennent aussi les admins', async () => {
    // −2 plus haut (10 reçus − 4 − 6 − 2) ; les 6 corrigés en 3 : +1 ; puis 3 manquants : −2
    expect(await ecrit(LE_GERANT, 'admin', { id: uuid(113), corrects: uuid(111), fact: { type: 'Death', quantity: 3 } })).toBe('Accepted');
    await settled(1);
    sent.length = 0;

    expect(await ecrit(LE_GERANT, 'admin', { id: uuid(114), fact: { type: 'Loss', lossType: 'Missing', quantity: 3 } })).toBe('Accepted');
    const messages = await settled(2);
    expect(messages[0]?.payload.notification).toMatchObject({ title: 'Plus de morts que de vivants', body: 'Poulailler Nord : les vivants sont à −2 — à vérifier' });
  });

  it('le push en panne : la carte de la correction est là quand même', async () => {
    failing = true;
    expect(await ecrit(OUSMANE, 'collaborator', { id: uuid(120), corrects: uuid(111), fact: { type: 'Death', quantity: 5 } })).toBe('Accepted');
    await settled(1);

    expect((await aRelire()).map(({ correctionId }) => correctionId)).toContain(uuid(120));
  });
});
