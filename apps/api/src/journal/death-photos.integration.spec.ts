import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { unwrap, type Clock } from '@kit';
import { Instant } from '@domain/journal';
import type { DeathPhotosView } from '@contracts';
import { AppModule } from '../app.module';
import { issueAccessToken, type SessionClaims } from '../auth/access-token';
import { CLOCK } from '../auth/auth.module';
import { APP_CONFIG } from '../config/app-config';
import { configureApp } from '../create-app';
import { createTestDatabase, type TestDatabase } from '../testing/test-database';

// Spec: backlog K.6 — la photo des morts ; cahier des charges « Photo des morts » (décisions du
// 2026-11-08 et du 2026-11-12) : toujours répondue, jamais bloquante ; le bureau voit, par gardien,
// la part des déclarations de morts photographiées. PostgreSQL réel, HTTP.
jest.setTimeout(180_000);

const SECRET = 'un-secret-de-test-assez-long-pour-signer-des-jetons';
const uuid = (rank: number): string => `00000000-0000-4000-8000-${String(rank).padStart(12, '0')}`;
const TENANT = uuid(10);
const NORD = uuid(3);
const BANDE = uuid(4);
const OUSMANE = uuid(51);
const MODOU = uuid(52);
const LE_GERANT = uuid(54);
const ORDINATEUR = uuid(92);
const PIN_HASH = '$argon2id$v=19$m=19456,t=2,p=1$dGVzdC1vbmx5LXNhbHQ$dGVzdC1vbmx5LWRpZ2VzdC1ub3QtYS1yZWFsLXBpbg';
const MORTS = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('trois morts au sol, bien eclaires'), Buffer.from([0xff, 0xd9])]);
const EMPREINTE = createHash('sha256').update(MORTS).digest('hex');

describe('La photo des morts', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let origin: string;
  let volume: string;
  // Thursday November 12th, 2026, 10:00 in Dakar.
  const now = Date.parse('2026-11-12T10:00:00.000Z');
  let tick = 0;
  const clock: Clock = { now: () => new Date(now + (tick += 1000)) };
  const tokenOf = (sub: string, role: SessionClaims['role']) => issueAccessToken({ sub, tenant: TENANT, role, device: ORDINATEUR }, unwrap(Instant(new Date(now - 60_000).toISOString())), SECRET);
  const call = (method: string, path: string, body: unknown, token: string) =>
    fetch(`${origin}/api/v1/${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const morts = async (rank: number, author: string, fields: Record<string, unknown> = {}) => {
    const response = await call('POST', 'journal/events', { events: [{ id: uuid(rank), siteId: NORD, campaignId: BANDE, businessDate: '2026-11-12', recordedAt: `2026-11-12T08:${String(rank % 60).padStart(2, '0')}:00.000Z`, fact: { type: 'Death', quantity: 2, ...fields } }] }, tokenOf(author, 'collaborator'));
    const [outcome] = ((await response.json()) as { outcomes: { status: string; refusal?: { kind: string; field?: string } }[] }).outcomes;
    return outcome?.status === 'Refused' ? outcome.refusal?.kind : outcome?.status;
  };

  beforeAll(async () => {
    db = await createTestDatabase();
    volume = await mkdtemp(join(tmpdir(), 'yaar-death-photos-'));
    await db.superuser.tenant.create({ data: { id: TENANT, name: 'Ferme', currency: 'XOF' } });
    await db.superuser.site.create({ data: { id: NORD, tenantId: TENANT, name: 'Poulailler Nord', timeZone: 'Africa/Dakar' } });
    await db.superuser.campaign.create({ data: { id: BANDE, tenantId: TENANT, siteId: NORD, placementDay: new Date('2026-10-12'), strain: 'Cobb500', plannedHeadcount: 1000, plannedDuration: 45 } });
    await db.superuser.user.createMany({
      data: [
        { id: OUSMANE, tenantId: TENANT, role: 'collaborator', phone: '+221770000001', name: 'Ousmane', pinHash: PIN_HASH },
        { id: MODOU, tenantId: TENANT, role: 'collaborator', phone: '+221770000002', name: 'Modou', pinHash: PIN_HASH },
        { id: LE_GERANT, tenantId: TENANT, role: 'admin', phone: '+221770000003', name: 'Le gérant', pinHash: PIN_HASH },
      ],
    });
    await db.superuser.siteAssignment.createMany({ data: [{ tenantId: TENANT, siteId: NORD, userId: OUSMANE, isPrimary: true }, { tenantId: TENANT, siteId: NORD, userId: MODOU, isPrimary: false }] });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(APP_CONFIG)
      .useValue({ port: 0, databaseUrl: db.appUrl, jwtSecret: SECRET, mediaPath: volume })
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
    if (volume !== undefined) await rm(volume, { recursive: true, force: true });
  });

  it('des morts photographiés, ou « pas de photo », ou sans réponse : acceptés et relus tels quels ; une réponse mal formée est refusée', async () => {
    const depot = await fetch(`${origin}/api/v1/media/${EMPREINTE}?retention=OperationalProof`, { method: 'PUT', headers: { Authorization: `Bearer ${tokenOf(OUSMANE, 'collaborator')}`, 'Content-Type': 'image/jpeg' }, body: new Uint8Array(MORTS) });
    expect(depot.status).toBe(201);

    expect(await morts(1, OUSMANE, { deathEvidence: { kind: 'Photographed', media: EMPREINTE } })).toBe('Accepted');
    expect(await morts(2, OUSMANE, { deathEvidence: { kind: 'NoPhoto' } })).toBe('Accepted');
    expect(await morts(3, OUSMANE, { deathEvidence: { kind: 'NoPhoto' } })).toBe('Accepted');
    expect(await morts(4, MODOU, { deathEvidence: { kind: 'Photographed', media: EMPREINTE } })).toBe('Accepted');
    expect(await morts(5, MODOU)).toBe('Accepted');
    expect([await morts(6, OUSMANE, { deathEvidence: { kind: 'Photographed' } }), await morts(7, OUSMANE, { deathEvidence: { kind: 'Maybe' } })]).toEqual(['MalformedEvent', 'MalformedEvent']);

    expect((await db.superuser.journalEvent.findUnique({ where: { tenantId_id: { tenantId: TENANT, id: uuid(1) } } }))?.fact).toEqual({ quantity: 2, deathEvidence: { kind: 'Photographed', media: EMPREINTE } });
  });

  it('l’admin lit la photo des morts que cite une déclaration', async () => {
    const response = await call('GET', `media/${EMPREINTE}`, undefined, tokenOf(LE_GERANT, 'admin'));

    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(MORTS);
  });

  it('le bureau voit, par gardien, la part de ses déclarations de morts photographiées ; celles sans réponse à part', async () => {
    const view = (await (await call('GET', `campaigns/${BANDE}/death-photos`, undefined, tokenOf(LE_GERANT, 'admin'))).json()) as DeathPhotosView;

    // Ousmane: 1 photographed of 3 answered; Modou: 1 of 1 answered, 1 without answer.
    expect(view).toEqual({
      campaignId: BANDE,
      caretakers: [
        { authorId: MODOU, name: 'Modou', photographed: 1, noPhoto: 0, unanswered: 1 },
        { authorId: OUSMANE, name: 'Ousmane', photographed: 1, noPhoto: 2, unanswered: 0 },
      ],
    });
  });

  it('une déclaration annulée par l’admin ne compte plus', async () => {
    const admin = tokenOf(LE_GERANT, 'admin');
    const retraction = await call('POST', 'journal/events', { events: [{ id: uuid(30), siteId: NORD, campaignId: BANDE, businessDate: '2026-11-12', recordedAt: '2026-11-12T09:00:00.000Z', retracts: uuid(3) }] }, admin);
    expect(((await retraction.json()) as { outcomes: { status: string }[] }).outcomes[0]?.status).toBe('Accepted');

    const view = (await (await call('GET', `campaigns/${BANDE}/death-photos`, undefined, admin)).json()) as DeathPhotosView;
    expect(view.caretakers.find((one) => one.authorId === OUSMANE)).toEqual({ authorId: OUSMANE, name: 'Ousmane', photographed: 1, noPhoto: 1, unanswered: 0 });
  });

  it('un gardien ne lit pas ces parts (403)', async () => {
    expect((await call('GET', `campaigns/${BANDE}/death-photos`, undefined, tokenOf(OUSMANE, 'collaborator'))).status).toBe(403);
  });
});
