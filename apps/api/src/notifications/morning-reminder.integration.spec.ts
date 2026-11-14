import { createECDH } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { unwrap, type Clock } from '@kit';
import { Instant } from '@domain/journal';
import { AppModule } from '../app.module';
import { issueAccessToken } from '../auth/access-token';
import { CLOCK } from '../auth/auth.module';
import { APP_CONFIG } from '../config/app-config';
import { configureApp } from '../create-app';
import { createTestDatabase, type TestDatabase } from '../testing/test-database';
import { MorningReminders } from './morning-reminders';
import { PUSH_SENDER, type PushSender } from './site-notifications';

// Spec: backlog Y.3 — le rappel du matin : à 7 h, heure du site, à toute l'équipe d'un site dont
// une bande en cours hier n'a rien d'écrit pour les morts d'hier (décisions du fondateur du
// 2026-11-13 et du 2026-11-14 : le zéro ne se déclare que pour hier).
// PostgreSQL réel, deux élevages ; le service du navigateur est remplacé par un relevé.
jest.setTimeout(180_000);

const SECRET = 'un-secret-de-test-assez-long-pour-signer-des-jetons';
const uuid = (rank: number): string => `00000000-0000-4000-8000-${String(rank).padStart(12, '0')}`;
const FERME = uuid(10);
const AUTRE = uuid(11);
const NORD = uuid(3);
const SUD = uuid(30);
const EST = uuid(31);
const OUEST = uuid(32);
const LA_BAS = uuid(33);
const PIN_HASH = '$argon2id$v=19$m=19456,t=2,p=1$dGVzdC1vbmx5LXNhbHQ$dGVzdC1vbmx5LWRpZ2VzdC1ub3QtYS1yZWFsLXBpbg';
const endpointOf = (who: string) => `https://fcm.googleapis.com/fcm/send/${who}`;

describe('Le rappel du matin', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let origin: string;
  const sent: { endpoint: string; payload: { notification: { title: string; body: string } } }[] = [];
  const sender: PushSender = async (device, payload) => {
    sent.push({ endpoint: device.endpoint, payload: payload as (typeof sent)[number]['payload'] });
    return 'Delivered';
  };
  let now = new Date('2026-11-15T06:59:00.000Z');
  const clock: Clock = { now: () => now };
  const reminders = () => app.get(MorningReminders);
  const endpoints = () => sent.map(({ endpoint }) => endpoint).sort();
  const ecrit = async (user: string, siteId: string, campaignId: string, event: Record<string, unknown>) => {
    const token = issueAccessToken({ sub: user, tenant: FERME, role: 'collaborator', device: uuid(90) }, unwrap(Instant(new Date(now.getTime() - 60_000).toISOString())), SECRET);
    const response = await fetch(`${origin}/api/v1/journal/events`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ events: [{ siteId, campaignId, recordedAt: new Date(now.getTime() - 30_000).toISOString(), ...event }] }) });
    return ((await response.json()) as { outcomes: { status: string }[] }).outcomes[0]?.status;
  };
  const pair = createECDH('prime256v1');
  pair.generateKeys();

  beforeAll(async () => {
    db = await createTestDatabase();
    await db.superuser.tenant.createMany({ data: [{ id: FERME, name: 'Ferme', currency: 'XOF' }, { id: AUTRE, name: 'Autre ferme', currency: 'XOF' }] });
    await db.superuser.site.createMany({
      data: [
        { id: NORD, tenantId: FERME, name: 'Poulailler Nord', timeZone: 'Africa/Dakar' },
        { id: SUD, tenantId: FERME, name: 'Poulailler Sud', timeZone: 'Africa/Dakar' },
        { id: EST, tenantId: FERME, name: 'Poulailler Est', timeZone: 'Africa/Dakar' },
        { id: OUEST, tenantId: FERME, name: 'Poulailler Ouest', timeZone: 'Africa/Dakar' },
        { id: LA_BAS, tenantId: AUTRE, name: 'Là-bas', timeZone: 'Africa/Dakar' },
      ],
    });
    const bande = (id: string, tenantId: string, siteId: string, placementDay: string, closedAt: Date | null = null) => ({ id, tenantId, siteId, placementDay: new Date(placementDay), strain: 'Cobb500', plannedHeadcount: 1000, plannedDuration: 45, closedAt });
    await db.superuser.campaign.createMany({
      data: [
        bande(uuid(40), FERME, NORD, '2026-11-02'),
        bande(uuid(41), FERME, SUD, '2026-11-02'),
        // East: a flock opened ahead, placed in three days. West: a flock closed.
        bande(uuid(42), FERME, EST, '2026-11-17'),
        bande(uuid(43), FERME, OUEST, '2026-09-01', new Date('2026-10-20T10:00:00.000Z')),
        bande(uuid(44), AUTRE, LA_BAS, '2026-11-02'),
      ],
    });
    const gardien = (id: string, tenantId: string, phone: string, name: string) => ({ id, tenantId, role: 'collaborator' as const, phone, name, pinHash: PIN_HASH });
    await db.superuser.user.createMany({
      data: [
        gardien(uuid(51), FERME, '+221770000001', 'Ousmane'),
        gardien(uuid(52), FERME, '+221770000002', 'Modou'),
        gardien(uuid(53), FERME, '+221770000003', 'Awa'),
        gardien(uuid(56), FERME, '+221770000006', 'Fatou'),
        gardien(uuid(57), FERME, '+221770000007', 'Ibou'),
        gardien(uuid(58), AUTRE, '+221770000008', 'Bineta'),
        { id: uuid(54), tenantId: FERME, role: 'admin', phone: '+221770000004', name: 'Le gérant', pinHash: PIN_HASH },
      ],
    });
    await db.superuser.siteAssignment.createMany({
      data: [
        { tenantId: FERME, siteId: NORD, userId: uuid(51), isPrimary: true },
        { tenantId: FERME, siteId: NORD, userId: uuid(52), isPrimary: false },
        { tenantId: FERME, siteId: SUD, userId: uuid(53), isPrimary: true },
        { tenantId: FERME, siteId: EST, userId: uuid(56), isPrimary: true },
        { tenantId: FERME, siteId: OUEST, userId: uuid(57), isPrimary: true },
        { tenantId: AUTRE, siteId: LA_BAS, userId: uuid(58), isPrimary: true },
      ],
    });
    const abonne = (tenantId: string, userId: string, who: string, device: number) => ({ tenantId, deviceId: uuid(device), userId, endpoint: endpointOf(who), p256dh: 'p', auth: 'a' });
    await db.superuser.pushSubscription.createMany({
      data: [abonne(FERME, uuid(51), 'ousmane', 91), abonne(FERME, uuid(52), 'modou', 92), abonne(FERME, uuid(53), 'awa', 93), abonne(FERME, uuid(56), 'fatou', 96), abonne(FERME, uuid(57), 'ibou', 97), abonne(AUTRE, uuid(58), 'bineta', 98), abonne(FERME, uuid(54), 'gerant', 94)],
    });
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
  });

  it('avant 7 h, heure du site, rien ne part', async () => {
    await reminders().remind();
    expect(sent).toEqual([]);
  });

  it('à 7 h : toute l’équipe d’un site sans morts écrits pour hier, dans chaque élevage ; « Rien perdu » suffit ; ni l’admin, ni un site sans bande en cours hier', async () => {
    // Sud a écrit « Rien perdu » pour hier, ce matin tôt
    now = new Date('2026-11-15T06:30:00.000Z');
    expect(await ecrit(uuid(53), SUD, uuid(41), { id: uuid(201), businessDate: '2026-11-14', fact: { type: 'NoLoss' } })).toBe('Accepted');

    now = new Date('2026-11-15T07:05:00.000Z');
    await reminders().remind();

    expect(endpoints()).toEqual([endpointOf('bineta'), endpointOf('modou'), endpointOf('ousmane')]);
    expect(sent.find(({ endpoint }) => endpoint === endpointOf('ousmane'))?.payload.notification).toMatchObject({
      title: 'Le cahier attend',
      body: 'Poulailler Nord : les morts d’hier ne sont pas écrits. Rien perdu ? Dis-le aussi.',
    });
  });

  it('une seule fois par jour et par site, même relancé', async () => {
    now = new Date('2026-11-15T09:30:00.000Z');
    await reminders().remind();
    await reminders().remind();

    expect(sent).toEqual([]);
    expect(await db.superuser.morningReminder.count()).toBe(2);
  });

  it('le lendemain : des morts écrits suffisent ; un sac ouvert seul ne répond pas à la question des morts', async () => {
    now = new Date('2026-11-15T18:00:00.000Z');
    expect(await ecrit(uuid(51), NORD, uuid(40), { id: uuid(202), businessDate: '2026-11-15', fact: { type: 'Death', quantity: 2 } })).toBe('Accepted');
    expect(await ecrit(uuid(53), SUD, uuid(41), { id: uuid(203), businessDate: '2026-11-15', fact: { type: 'BagOpened', quantity: 1 } })).toBe('Accepted');

    now = new Date('2026-11-16T07:01:00.000Z');
    await reminders().remind();

    expect(endpoints()).toEqual([endpointOf('awa'), endpointOf('bineta')]);
  });

  it('sans clés configurées, rien ne part et rien n’est marqué parti : configuré plus tard le même jour, le rappel partira', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(APP_CONFIG)
      .useValue({ port: 0, databaseUrl: db.appUrl, jwtSecret: SECRET, mediaPath: '/data/medias', vapidPublicKey: null, vapidPrivateKey: null, vapidSubject: null })
      .overrideProvider(CLOCK)
      .useValue(clock)
      .overrideProvider(PUSH_SENDER)
      .useValue(sender)
      .compile();
    const without = moduleRef.createNestApplication();
    await without.init();
    try {
      now = new Date('2026-11-17T07:10:00.000Z');
      await without.get(MorningReminders).remind();
      expect(sent).toEqual([]);
      expect(await db.superuser.morningReminder.count({ where: { day: new Date('2026-11-16') } })).toBe(0);
    } finally {
      await without.close();
    }
  });
});
