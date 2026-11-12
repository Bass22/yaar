import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { unwrap, type Clock } from '@kit';
import { Instant } from '@domain/journal';
import type { CaretakerContext, WeighingsView } from '@contracts';
import { AppModule } from '../app.module';
import { issueAccessToken, type SessionClaims } from '../auth/access-token';
import { CLOCK } from '../auth/auth.module';
import { APP_CONFIG } from '../config/app-config';
import { configureApp } from '../create-app';
import { createTestDatabase, type TestDatabase } from '../testing/test-database';

// Spec: backlog T.1, T.2, T.5 — la pesée, sa demande, sa validation ; cahier des charges « Les
// pesées » (décisions du 2026-11-12). PostgreSQL réel, HTTP, le gérant et le gardien.
jest.setTimeout(180_000);

const SECRET = 'un-secret-de-test-assez-long-pour-signer-des-jetons';
const uuid = (rank: number): string => `00000000-0000-4000-8000-${String(rank).padStart(12, '0')}`;
const TENANT = uuid(10);
const NORD = uuid(3);
const BANDE = uuid(4);
const AUTRE_BANDE = uuid(5);
const OUSMANE = uuid(51);
const LE_GERANT = uuid(54);
const TELEPHONE = uuid(93);
const ORDINATEUR = uuid(92);
// The photo of the scale for each of the five birds (T.6): five small JPEGs.
const balance = (rank: number) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(`poulet ${rank} sur la balance`), Buffer.from([0xff, 0xd9])]);
const PHOTOS = [1, 2, 3, 4, 5].map(balance);
const empreinte = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const PIN_HASH = '$argon2id$v=19$m=19456,t=2,p=1$dGVzdC1vbmx5LXNhbHQ$dGVzdC1vbmx5LWRpZ2VzdC1ub3QtYS1yZWFsLXBpbg';

describe('Les pesées : la demande, la pesée, la validation', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let origin: string;
  let volume: string;
  // Monday November 9th, 2026, 10:00 in Dakar: day 28 of a flock placed on October 12th.
  const now = Date.parse('2026-11-09T10:00:00.000Z');
  let tick = 0;
  const clock: Clock = { now: () => new Date(now + (tick += 1000)) };
  const tokenOf = (sub: string, role: SessionClaims['role'], device: string) => issueAccessToken({ sub, tenant: TENANT, role, device }, unwrap(Instant(new Date(now - 60_000).toISOString())), SECRET);
  const gerant = () => tokenOf(LE_GERANT, 'admin', ORDINATEUR);
  const gardien = () => tokenOf(OUSMANE, 'collaborator', TELEPHONE);
  const call = (method: string, path: string, body?: unknown, token = gerant()) =>
    fetch(`${origin}/api/v1/${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const demande = (rank: number, requestedFor: string, campaignId = BANDE) => call('POST', 'weighing-requests', { id: uuid(rank), campaignId, requestedFor });
  const carte = async () => ((await (await call('GET', 'caretaker/context', undefined, gardien())).json()) as CaretakerContext).sites[0]?.campaigns.find(({ campaignId }) => campaignId === BANDE)?.weighingRequests;
  const pesees = async () => (await (await call('GET', `campaigns/${BANDE}/weighings`)).json()) as WeighingsView;
  const envoie = async (event: Record<string, unknown>, token = gardien()) => {
    const response = await call('POST', 'journal/events', { events: [{ siteId: NORD, campaignId: BANDE, businessDate: '2026-11-09', recordedAt: '2026-11-09T09:00:00.000Z', ...event }] }, token);
    const [outcome] = ((await response.json()) as { outcomes: { status: string; refusal?: { kind: string } }[] }).outcomes;
    return outcome?.status === 'Refused' ? outcome.refusal?.kind : outcome?.status;
  };
  const pese = (rank: number, request: number, weights: number[], photos?: string[]) =>
    envoie({ id: uuid(rank), fact: { type: 'Weighing', weighingRequestId: uuid(request), weights, ...(photos === undefined ? {} : { photos }) } });
  const depose = (bytes: Buffer) =>
    fetch(`${origin}/api/v1/media/${empreinte(bytes)}?retention=OperationalProof`, { method: 'PUT', headers: { Authorization: `Bearer ${gardien()}`, 'Content-Type': 'image/jpeg' }, body: new Uint8Array(bytes) });

  beforeAll(async () => {
    db = await createTestDatabase();
    volume = await mkdtemp(join(tmpdir(), 'yaar-weighings-'));
    await db.superuser.tenant.create({ data: { id: TENANT, name: 'Ferme', currency: 'XOF' } });
    await db.superuser.site.create({ data: { id: NORD, tenantId: TENANT, name: 'Poulailler Nord', timeZone: 'Africa/Dakar' } });
    await db.superuser.campaign.createMany({
      data: [
        { id: BANDE, tenantId: TENANT, siteId: NORD, placementDay: new Date('2026-10-12'), strain: 'Cobb500', plannedHeadcount: 1000, plannedDuration: 45 },
        { id: AUTRE_BANDE, tenantId: TENANT, siteId: NORD, placementDay: new Date('2026-11-01'), strain: 'Cobb500', plannedHeadcount: 1000, plannedDuration: 45 },
        { id: uuid(6), tenantId: TENANT, siteId: NORD, placementDay: new Date('2026-08-01'), strain: 'Cobb500', plannedHeadcount: 1000, plannedDuration: 45, closedAt: new Date('2026-09-20T10:00:00.000Z') },
      ],
    });
    await db.superuser.user.createMany({
      data: [
        { id: OUSMANE, tenantId: TENANT, role: 'collaborator', phone: '+221770000001', name: 'Ousmane', pinHash: PIN_HASH },
        { id: LE_GERANT, tenantId: TENANT, role: 'admin', phone: '+221770000002', name: 'Le gérant', pinHash: PIN_HASH },
      ],
    });
    await db.superuser.siteAssignment.create({ data: { tenantId: TENANT, siteId: NORD, userId: OUSMANE, isPrimary: true } });
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

  it('sans demande, aucune carte pesée chez le gardien', async () => {
    expect(await carte()).toEqual([]);
  });

  it('l’admin demande une pesée pour aujourd’hui : la carte apparaît chez le gardien ; une demande pour demain n’apparaît que demain ; tracée', async () => {
    expect((await demande(70, '2026-11-09')).status).toBe(201);
    expect((await demande(71, '2026-11-10')).status).toBe(201);

    expect(await carte()).toEqual([{ weighingRequestId: uuid(70), requestedFor: '2026-11-09' }]);
    expect((await db.superuser.auditEvent.findMany({ where: { subjectId: uuid(70) }, select: { action: true, actorId: true, siteId: true } }))).toEqual([{ action: 'WeighingRequested', actorId: LE_GERANT, siteId: NORD }]);
  });

  it('une demande pour hier, une bande inconnue, une bande close, un champ en trop : refusés ; un gardien ne demande pas (403)', async () => {
    const refus = [await demande(72, '2026-11-08'), await demande(73, '2026-11-09', uuid(99)), await demande(76, '2026-11-09', uuid(6)), await call('POST', 'weighing-requests', { id: uuid(74), campaignId: BANDE, requestedFor: '2026-11-09', siteId: NORD })];
    expect(refus.map((response) => response.status)).toEqual([400, 400, 400, 400]);
    expect(((await refus[2]!.json()) as { kind: string }).kind).toBe('CampaignClosed');
    expect((await call('POST', 'weighing-requests', { id: uuid(75), campaignId: BANDE, requestedFor: '2026-11-09' }, gardien())).status).toBe(403);
  });

  it('une pesée de quatre poids, ou qui ne répond à aucune demande de la bande, est refusée', async () => {
    expect(await pese(201, 70, [1820, 1905, 1760, 1880])).toBe('NotFiveWeights');
    expect(await pese(202, 99, [1820, 1905, 1760, 1880, 1850])).toBe('UnknownWeighingRequest');
  });

  it('une pesée dont les photos ne sont pas une par poids est refusée (T.6)', async () => {
    expect(await pese(204, 70, [1820, 1905, 1760, 1880, 1850], PHOTOS.slice(0, 4).map(empreinte))).toBe('WeighingPhotosMismatch');
  });

  it('le gardien pèse cinq poulets, la photo de la balance pour chacun : accepté ; la carte disparaît ; la pesée attend la validation, sa moyenne calculée, ses photos à côté', async () => {
    for (const photo of PHOTOS) expect((await depose(photo)).status).toBe(201);
    expect(await pese(203, 70, [1820, 1905, 1760, 1880, 1850], PHOTOS.map(empreinte))).toBe('Accepted');

    expect(await carte()).toEqual([]);
    // (1 820 + 1 905 + 1 760 + 1 880 + 1 850) ÷ 5 = 1 843 g, on day 28.
    expect(await pesees()).toEqual({
      campaignId: BANDE,
      siteId: NORD,
      strain: 'Cobb500',
      // Tomorrow's request is still open; today's is answered.
      openRequests: [{ weighingRequestId: uuid(71), requestedFor: '2026-11-10' }],
      curve: [],
      toValidate: [{ weighingId: uuid(203), weighingRequestId: uuid(70), businessDate: '2026-11-09', campaignDay: 28, authorName: 'Ousmane', weights: [1820, 1905, 1760, 1880, 1850], photos: PHOTOS.map(empreinte), average: 1843 }],
    });
  });

  it('l’admin lit la photo de la balance que cite une pesée (T.6)', async () => {
    const response = await call('GET', `media/${empreinte(PHOTOS[2]!)}`);

    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(PHOTOS[2]);
  });

  it('un gardien ne valide pas une pesée', async () => {
    expect(await envoie({ id: uuid(301), fact: { type: 'WeighingValidated', weighingId: uuid(203) } })).toBe('ValidationByAdminOnly');
  });

  it('corriger une pesée vers quatre poids est refusé : une pesée porte toujours cinq poids', async () => {
    expect(await envoie({ id: uuid(300), corrects: uuid(203), recordedAt: '2026-11-09T09:20:00.000Z', fact: { type: 'Weighing', weighingRequestId: uuid(70), weights: [1820, 1905, 1670, 1880] } }, gerant())).toBe('NotFiveWeights');
  });

  it('l’admin corrige un poids puis valide : le poids d’origine reste au journal ; la pesée quitte la liste et rejoint la courbe', async () => {
    const admin = gerant();
    // 1 760 was a typing mistake for 1 670: (1 820 + 1 905 + 1 670 + 1 880 + 1 850) ÷ 5 = 1 825 g.
    expect(await envoie({ id: uuid(302), corrects: uuid(203), recordedAt: '2026-11-09T09:30:00.000Z', fact: { type: 'Weighing', weighingRequestId: uuid(70), weights: [1820, 1905, 1670, 1880, 1850], photos: PHOTOS.map(empreinte) } }, admin)).toBe('Accepted');
    expect(await envoie({ id: uuid(303), recordedAt: '2026-11-09T09:31:00.000Z', fact: { type: 'WeighingValidated', weighingId: uuid(203) } }, admin)).toBe('Accepted');

    expect(await pesees()).toMatchObject({ curve: [{ weighingId: uuid(203), campaignDay: 28, average: 1825 }], toValidate: [] });
    expect((await db.superuser.journalEvent.findUnique({ where: { tenantId_id: { tenantId: TENANT, id: uuid(203) } } }))?.fact).toEqual({ weighingRequestId: uuid(70), weights: [1820, 1905, 1760, 1880, 1850], photos: PHOTOS.map(empreinte) });
  });

  it('une pesée déjà validée, ou inconnue, ne se valide pas ; la validation n’apparaît pas dans le cahier du gardien', async () => {
    const admin = gerant();
    expect(await envoie({ id: uuid(304), recordedAt: '2026-11-09T09:40:00.000Z', fact: { type: 'WeighingValidated', weighingId: uuid(203) } }, admin)).toBe('WeighingAlreadyValidated');
    expect(await envoie({ id: uuid(305), recordedAt: '2026-11-09T09:41:00.000Z', fact: { type: 'WeighingValidated', weighingId: uuid(999) } }, admin)).toBe('UnknownWeighing');

    const journal = ((await (await call('GET', 'caretaker/context', undefined, gardien())).json()) as CaretakerContext).sites[0]?.campaigns.find(({ campaignId }) => campaignId === BANDE)?.journal;
    expect(journal?.map(({ fact }) => fact.type)).toEqual(['Weighing']);
  });

  it('un gardien ne lit pas les pesées du bureau (403)', async () => {
    expect((await call('GET', `campaigns/${BANDE}/weighings`, undefined, gardien())).status).toBe(403);
  });
});
