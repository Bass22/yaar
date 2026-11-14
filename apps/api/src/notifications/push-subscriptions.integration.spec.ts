import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { unwrap } from '@kit';
import { Instant } from '@domain/journal';
import { AppModule } from '../app.module';
import { issueAccessToken, type SessionClaims } from '../auth/access-token';
import { APP_CONFIG } from '../config/app-config';
import { configureApp } from '../create-app';
import { createTestDatabase, type TestDatabase } from '../testing/test-database';

// Spec: backlog Y.1 — s'abonner aux notifications ; cahier des charges « Notifications push »
// (S'abonner). PostgreSQL réel, HTTP.
jest.setTimeout(180_000);

const SECRET = 'un-secret-de-test-assez-long-pour-signer-des-jetons';
// A P-256 public key, uncompressed (65 bytes), in base64url: what a browser is handed to subscribe.
const PUBLIC_KEY = `B${'A'.repeat(86)}`;
const uuid = (rank: number): string => `00000000-0000-4000-8000-${String(rank).padStart(12, '0')}`;
const TENANT = uuid(10);
const AUTRE_ELEVAGE = uuid(11);
const NORD = uuid(3);
const OUSMANE = uuid(51);
const AWA = uuid(52);
const LE_GERANT = uuid(54);
const TECNO = uuid(91);
const INFINIX = uuid(92);
const ORDINATEUR = uuid(93);
const PIN_HASH = '$argon2id$v=19$m=19456,t=2,p=1$dGVzdC1vbmx5LXNhbHQ$dGVzdC1vbmx5LWRpZ2VzdC1ub3QtYS1yZWFsLXBpbg';

// What a browser hands back once the person agreed: its push service, and the keys of the device.
const abonnement = (endpoint = 'https://fcm.googleapis.com/fcm/send/abc123', fields: Record<string, unknown> = {}) => ({
  endpoint,
  keys: { p256dh: `B${'q'.repeat(86)}`, auth: 'c2VjcmV0LWF1dGgtMTZieQ' },
  ...fields,
});

async function startApi(db: TestDatabase, vapidPublicKey: string | null): Promise<{ app: INestApplication; origin: string }> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(APP_CONFIG)
    .useValue({ port: 0, databaseUrl: db.appUrl, jwtSecret: SECRET, mediaPath: '/data/medias', vapidPublicKey })
    .compile();
  const app = configureApp(moduleRef.createNestApplication());
  await app.listen(0, '127.0.0.1');
  return { app, origin: await app.getUrl() };
}

describe("S'abonner aux notifications", () => {
  let db: TestDatabase;
  let app: INestApplication;
  let origin: string;
  const tokenOf = (sub: string, role: SessionClaims['role'], device: string, tenant = TENANT) =>
    issueAccessToken({ sub, tenant, role, device }, unwrap(Instant(new Date(Date.now() - 60_000).toISOString())), SECRET);
  const call = (method: string, path: string, token: string, body?: unknown) =>
    fetch(`${origin}/api/v1/${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const ousmane = () => tokenOf(OUSMANE, 'collaborator', TECNO);
  const gerant = () => tokenOf(LE_GERANT, 'admin', ORDINATEUR);
  const rows = () => db.superuser.pushSubscription.findMany({ orderBy: { endpoint: 'asc' }, select: { tenantId: true, userId: true, deviceId: true, endpoint: true } });
  const refus = async (response: Response) => ({ status: response.status, kind: ((await response.json()) as { kind?: string }).kind });

  beforeAll(async () => {
    db = await createTestDatabase();
    await db.superuser.tenant.createMany({ data: [{ id: TENANT, name: 'Ferme', currency: 'XOF' }, { id: AUTRE_ELEVAGE, name: 'Autre', currency: 'XOF' }] });
    await db.superuser.site.create({ data: { id: NORD, tenantId: TENANT, name: 'Poulailler Nord', timeZone: 'Africa/Dakar' } });
    await db.superuser.user.createMany({
      data: [
        { id: OUSMANE, tenantId: TENANT, role: 'collaborator', phone: '+221770000001', name: 'Ousmane', pinHash: PIN_HASH },
        { id: AWA, tenantId: TENANT, role: 'collaborator', phone: '+221770000003', name: 'Awa', pinHash: PIN_HASH },
        { id: LE_GERANT, tenantId: TENANT, role: 'admin', phone: '+221770000002', name: 'Le gérant', pinHash: PIN_HASH },
      ],
    });
    await db.superuser.siteAssignment.createMany({ data: [{ tenantId: TENANT, siteId: NORD, userId: OUSMANE, isPrimary: true }, { tenantId: TENANT, siteId: NORD, userId: AWA, isPrimary: false }] });
    ({ app, origin } = await startApi(db, PUBLIC_KEY));
  });

  afterAll(async () => {
    await app?.close();
    await db?.drop();
  });

  beforeEach(async () => {
    await db.superuser.pushSubscription.deleteMany();
  });

  it('le téléphone lit la clé publique du serveur pour s’abonner, gardien comme admin ; la clé privée ne sort jamais', async () => {
    for (const token of [ousmane(), gerant()]) {
      const response = await call('GET', 'push/public-key', token);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ publicKey: PUBLIC_KEY });
    }
  });

  it('un appareil s’abonne à la personne connectée et à son appareil, dans son élevage ; s’abonner de nouveau remplace, jamais en double', async () => {
    expect((await call('PUT', 'push-subscription', ousmane(), abonnement())).status).toBe(204);
    // Le navigateur a changé d'adresse : le même appareil, une seule ligne
    expect((await call('PUT', 'push-subscription', ousmane(), abonnement('https://fcm.googleapis.com/fcm/send/def456'))).status).toBe(204);

    expect(await rows()).toEqual([{ tenantId: TENANT, userId: OUSMANE, deviceId: TECNO, endpoint: 'https://fcm.googleapis.com/fcm/send/def456' }]);
  });

  it('un téléphone, une personne : Awa se connecte sur le téléphone d’Ousmane, l’abonnement passe à elle', async () => {
    await call('PUT', 'push-subscription', ousmane(), abonnement());
    expect((await call('PUT', 'push-subscription', tokenOf(AWA, 'collaborator', TECNO), abonnement())).status).toBe(204);

    expect(await rows()).toEqual([{ tenantId: TENANT, userId: AWA, deviceId: TECNO, endpoint: 'https://fcm.googleapis.com/fcm/send/abc123' }]);
  });

  it('seuls les services de notification des navigateurs sont acceptés : le serveur n’écrira jamais ailleurs', async () => {
    for (const endpoint of ['https://updates.push.services.mozilla.com/wpush/v2/x', 'https://web.push.apple.com/QGx', 'https://wns2-par02p.notify.windows.com/w/?token=x']) {
      expect((await call('PUT', 'push-subscription', ousmane(), abonnement(endpoint))).status).toBe(204);
    }
    for (const endpoint of ['https://evil.example/collect', 'http://fcm.googleapis.com/fcm/send/abc', 'https://fcm.googleapis.com.evil.example/x', 'https://127.0.0.1/x', 'pas une adresse']) {
      expect(await refus(await call('PUT', 'push-subscription', ousmane(), abonnement(endpoint)))).toEqual({ status: 400, kind: 'UnknownPushService' });
    }
    expect(await refus(await call('PUT', 'push-subscription', ousmane(), abonnement(undefined, { keys: { p256dh: 'court', auth: '' } })))).toEqual({ status: 400, kind: 'InvalidSubscription' });
    expect((await call('PUT', 'push-subscription', ousmane(), abonnement(undefined, { userId: AWA }))).status).toBe(400);
    expect((await rows()).map(({ endpoint }) => endpoint)).toEqual(['https://wns2-par02p.notify.windows.com/w/?token=x']);
  });

  it('se déconnecter du téléphone supprime l’abonnement de cet appareil seulement', async () => {
    await call('PUT', 'push-subscription', ousmane(), abonnement());
    await call('PUT', 'push-subscription', tokenOf(OUSMANE, 'collaborator', INFINIX), abonnement('https://fcm.googleapis.com/fcm/send/infinix'));

    expect((await call('DELETE', 'push-subscription', ousmane())).status).toBe(204);
    expect((await rows()).map(({ deviceId }) => deviceId)).toEqual([INFINIX]);
  });

  it('bloquer un compte, ou le déconnecter partout, supprime tous ses abonnements ; ceux des autres restent', async () => {
    await call('PUT', 'push-subscription', ousmane(), abonnement());
    await call('PUT', 'push-subscription', tokenOf(OUSMANE, 'collaborator', INFINIX), abonnement('https://fcm.googleapis.com/fcm/send/infinix'));
    await call('PUT', 'push-subscription', tokenOf(AWA, 'collaborator', uuid(94)), abonnement('https://fcm.googleapis.com/fcm/send/awa'));
    await call('PUT', 'push-subscription', gerant(), abonnement('https://fcm.googleapis.com/fcm/send/gerant'));

    expect((await call('POST', `users/${OUSMANE}/block`, gerant())).status).toBe(204);
    expect((await rows()).map(({ userId }) => userId).sort()).toEqual([AWA, LE_GERANT].sort());

    expect((await call('POST', `users/${AWA}/sign-out-everywhere`, gerant())).status).toBe(204);
    expect((await rows()).map(({ userId }) => userId)).toEqual([LE_GERANT]);
  });

  it('sans clé configurée, rien n’est proposé : la clé publique répond 404, et aucun abonnement ne s’écrit', async () => {
    const without = await startApi(db, null);
    try {
      // Le gérant : Ousmane et Awa ont été bloqué et déconnectée plus haut
      const response = await fetch(`${without.origin}/api/v1/push/public-key`, { headers: { Authorization: `Bearer ${gerant()}` } });
      expect({ status: response.status, kind: ((await response.json()) as { kind?: string }).kind }).toEqual({ status: 404, kind: 'PushNotConfigured' });
      const subscribe = await fetch(`${without.origin}/api/v1/push-subscription`, { method: 'PUT', headers: { Authorization: `Bearer ${gerant()}`, 'Content-Type': 'application/json' }, body: JSON.stringify(abonnement()) });
      expect(subscribe.status).toBe(404);
      expect(await rows()).toEqual([]);
    } finally {
      await without.app.close();
    }
  });
});
