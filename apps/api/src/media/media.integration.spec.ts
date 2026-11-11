import { createHash } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { unwrap, type Clock } from '@kit';
import { Instant } from '@domain/journal';
import { AppModule } from '../app.module';
import { issueAccessToken, type SessionClaims } from '../auth/access-token';
import { CLOCK } from '../auth/auth.module';
import { APP_CONFIG } from '../config/app-config';
import { configureApp } from '../create-app';
import { createTestDatabase, type TestDatabase } from '../testing/test-database';

// Spec: backlog M.1 — un média se dépose par son empreinte ; architecture §7 « Le dépôt » (décision
// du 2026-11-11) ; CLAUDE.md §4 règles 4, 5, 6, 13 et 14. PostgreSQL réel, HTTP, volume dans un
// dossier temporaire.
jest.setTimeout(180_000);

const SECRET = 'un-secret-de-test-assez-long-pour-signer-des-jetons';
const uuid = (rank: number): string => `00000000-0000-4000-8000-${String(rank).padStart(12, '0')}`;
const TENANT_A = uuid(10);
const TENANT_B = uuid(11);
const NORD = uuid(3);
const SITE_DE_B = uuid(33);
const BANDE = uuid(4);
const BANDE_DE_B = uuid(6);
const OUSMANE = uuid(51);
const LE_GERANT = uuid(54);
const GERANT_DE_B = uuid(55);
const TELEPHONE = uuid(93);
const PIN_HASH = '$argon2id$v=19$m=19456,t=2,p=1$dGVzdC1vbmx5LXNhbHQ$dGVzdC1vbmx5LWRpZ2VzdC1ub3QtYS1yZWFsLXBpbg';

const jpeg = (words: string) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(words), Buffer.from([0xff, 0xd9])]);
const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');
const MORTS = jpeg('trois morts au sol, a la lumiere');
const PV = jpeg('le PV signe du livreur');

describe('Les médias, déposés par leur empreinte', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let origin: string;
  let volume: string;
  const now = Date.parse('2026-10-14T10:00:00.000Z');
  let tick = 0;
  const clock: Clock = { now: () => new Date(now + (tick += 1000)) };

  const tokenOf = (sub: string, tenant: string, role: SessionClaims['role']) =>
    issueAccessToken({ sub, tenant, role, device: TELEPHONE }, unwrap(Instant(new Date(now - 60_000).toISOString())), SECRET);
  const gardien = () => tokenOf(OUSMANE, TENANT_A, 'collaborator');
  const gerant = () => tokenOf(LE_GERANT, TENANT_A, 'admin');
  type Token = ReturnType<typeof gerant>;
  const depose = (fingerprint: string, bytes: Buffer, { retention = 'OperationalProof', token = gardien(), type = 'image/jpeg' }: { retention?: string; token?: Token; type?: string } = {}) =>
    fetch(`${origin}/api/v1/media/${fingerprint}?retention=${retention}`, { method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': type }, body: new Uint8Array(bytes) });
  const lit = (fingerprint: string, token: Token = gerant()) => fetch(`${origin}/api/v1/media/${fingerprint}`, { headers: { Authorization: `Bearer ${token}` } });
  const kindOf = async (response: Response) => ((await response.json()) as { kind?: string }).kind;
  const fichiers = async () => (await readdir(volume, { recursive: true, withFileTypes: true })).filter((entry) => entry.isFile() && !entry.parentPath.includes('.tmp')).length;
  // A photo of the journal of a farm: the event that references the media.
  const cite = (rank: number, media: string, tenantId = TENANT_A, siteId = NORD, campaignId = BANDE, authorId = OUSMANE) =>
    db.superuser.journalEvent.create({
      data: { id: uuid(rank), tenantId, siteId, campaignId, authorId, businessDate: new Date('2026-10-14'), recordedAt: new Date('2026-10-14T08:00:00.000Z'), deviceId: TELEPHONE, type: 'Photo', fact: { media } },
    });

  beforeAll(async () => {
    volume = await mkdtemp(join(tmpdir(), 'yaar-media-volume-'));
    db = await createTestDatabase();
    await db.superuser.tenant.createMany({ data: [TENANT_A, TENANT_B].map((id) => ({ id, name: 'Ferme', currency: 'XOF' })) });
    await db.superuser.site.createMany({
      data: [
        { id: NORD, tenantId: TENANT_A, name: 'Poulailler Nord', timeZone: 'Africa/Dakar' },
        { id: SITE_DE_B, tenantId: TENANT_B, name: 'Chez B', timeZone: 'Africa/Dakar' },
      ],
    });
    await db.superuser.campaign.createMany({
      data: [
        { id: BANDE, tenantId: TENANT_A, siteId: NORD, placementDay: new Date('2026-10-01'), strain: 'Cobb500', plannedHeadcount: 1000, plannedDuration: 45 },
        { id: BANDE_DE_B, tenantId: TENANT_B, siteId: SITE_DE_B, placementDay: new Date('2026-10-01'), strain: 'Cobb500', plannedHeadcount: 1000, plannedDuration: 45 },
      ],
    });
    await db.superuser.user.createMany({
      data: [
        { id: OUSMANE, tenantId: TENANT_A, role: 'collaborator', phone: '+221770000001', name: 'Ousmane', pinHash: PIN_HASH },
        { id: LE_GERANT, tenantId: TENANT_A, role: 'admin', phone: '+221770000002', name: 'Le gérant', pinHash: PIN_HASH },
        { id: GERANT_DE_B, tenantId: TENANT_B, role: 'admin', phone: '+221770000003', name: 'Gérant B', pinHash: PIN_HASH },
      ],
    });
    await db.superuser.siteAssignment.create({ data: { tenantId: TENANT_A, siteId: NORD, userId: OUSMANE, isPrimary: true } });

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
    await rm(volume, { recursive: true, force: true });
  });

  it('le gardien dépose une photo sous son empreinte : sa ligne dit sa classe, qui l’a déposée, quand et depuis quel appareil', async () => {
    const response = await depose(sha256(MORTS), MORTS);

    expect(response.status).toBe(201);
    expect(await db.superuser.media.findMany({ select: { tenantId: true, sha256: true, contentType: true, byteSize: true, retentionClass: true, uploadedBy: true, deviceId: true, uploadedAt: true } })).toEqual([
      { tenantId: TENANT_A, sha256: sha256(MORTS), contentType: 'image/jpeg', byteSize: MORTS.length, retentionClass: 'OperationalProof', uploadedBy: OUSMANE, deviceId: TELEPHONE, uploadedAt: expect.any(Date) },
    ]);
    expect(await fichiers()).toBe(1);
  });

  it('le même fichier renvoyé (une coupure, puis la reprise) ne s’écrit qu’une fois et répond « déjà là »', async () => {
    const again = await depose(sha256(MORTS), MORTS);

    expect(again.status).toBe(200);
    expect(await db.superuser.media.count()).toBe(1);
    expect(await fichiers()).toBe(1);
  });

  it('un PV se dépose comme pièce justificative', async () => {
    expect((await depose(sha256(PV), PV, { retention: 'SupportingDocument' })).status).toBe(201);
    expect((await db.superuser.media.findFirst({ where: { sha256: sha256(PV) } }))?.retentionClass).toBe('SupportingDocument');
  });

  it("une empreinte qui n'est pas celle des octets, un fichier qui n'est pas une image, trop lourd, une classe inconnue : refusés, rien ne s'écrit", async () => {
    const pdf = Buffer.from('%PDF-1.7\nun bon\n%%EOF');
    const lourd = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(2 * 1024 * 1024)]);
    const autre = jpeg('une autre photo');

    const refus = [
      await depose(sha256(PV), autre),
      await depose(sha256(pdf), pdf, { type: 'application/pdf' }),
      await depose(sha256(lourd), lourd),
      await depose(sha256(autre), autre, { retention: 'Forever' }),
      await depose('pas-une-empreinte', autre),
    ];

    expect(await Promise.all(refus.map(async (response) => [response.status, await kindOf(response)]))).toEqual([
      [400, 'FingerprintMismatch'],
      [415, 'UnsupportedType'],
      [413, 'TooLarge'],
      [400, 'InvalidRequest'],
      [400, 'InvalidRequest'],
    ]);
    expect(await db.superuser.media.count()).toBe(2);
    expect(await fichiers()).toBe(2);
  });

  it("l'admin relit une photo citée par un événement de son élevage : les octets tels quels, en pièce jointe, jamais exécutables ni gardés en cache", async () => {
    await cite(101, sha256(MORTS));

    const response = await lit(sha256(MORTS));

    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(MORTS);
    expect(Object.fromEntries(['content-type', 'x-content-type-options', 'content-security-policy', 'cache-control', 'content-disposition'].map((name) => [name, response.headers.get(name)]))).toEqual({
      'content-type': 'image/jpeg',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "sandbox; default-src 'none'",
      'cache-control': 'private, no-store',
      'content-disposition': 'attachment',
    });
  });

  it('un média déposé mais cité par aucun événement ne se lit pas (404)', async () => {
    expect((await lit(sha256(PV))).status).toBe(404);
  });

  it('le PV cité par une réception se lit, une fois la réception écrite', async () => {
    await db.superuser.journalEvent.create({
      data: {
        id: uuid(102), tenantId: TENANT_A, siteId: NORD, campaignId: BANDE, authorId: OUSMANE, businessDate: new Date('2026-10-14'), recordedAt: new Date('2026-10-14T09:00:00.000Z'), deviceId: TELEPHONE,
        type: 'Delivery', fact: { orderLineId: uuid(21), receivedQuantity: 20, deliveryNote: { kind: 'Photographed', media: sha256(PV) } },
      },
    });

    expect((await lit(sha256(PV))).status).toBe(200);
  });

  it('le reçu cité par une dépense se lit (P.5) : une dépense cite un média comme le journal', async () => {
    const recu = jpeg('le recu de la SDE');
    expect((await depose(sha256(recu), recu, { retention: 'SupportingDocument', token: gerant() })).status).toBe(201);
    expect((await lit(sha256(recu))).status).toBe(404);
    await db.superuser.costType.create({ data: { id: uuid(44), tenantId: TENANT_A, category: 'Utilities', name: 'Eau', behaviour: 'Variable' } });
    await db.superuser.cost.create({ data: { tenantId: TENANT_A, id: uuid(301), campaignId: BANDE, costTypeId: uuid(44), spentOn: new Date('2026-10-13'), amount: 12_500, paymentKind: 'Paid', receipt: sha256(recu), recordedAt: new Date(now), recordedBy: LE_GERANT } });

    expect((await lit(sha256(recu))).status).toBe(200);
  });

  it("le média d'un autre élevage ne se lit pas, même cité chez lui, même si l'on connaît son empreinte (404) ; chaque élevage a sa propre copie", async () => {
    const deB = jpeg('la photo de B');
    expect((await depose(sha256(deB), deB, { token: tokenOf(GERANT_DE_B, TENANT_B, 'admin') })).status).toBe(201);
    await cite(201, sha256(deB), TENANT_B, SITE_DE_B, BANDE_DE_B, GERANT_DE_B);
    // B also deposits the photo A already has: its own row, its own file.
    expect((await depose(sha256(MORTS), MORTS, { token: tokenOf(GERANT_DE_B, TENANT_B, 'admin') })).status).toBe(201);

    expect((await lit(sha256(deB))).status).toBe(404);
    expect((await lit(sha256(deB), tokenOf(GERANT_DE_B, TENANT_B, 'admin'))).status).toBe(200);
    expect(await db.superuser.media.count({ where: { sha256: sha256(MORTS) } })).toBe(2);
  });

  it('le gardien ne relit aucun média (403) : rien ne le demande, et un PV peut porter des prix', async () => {
    expect((await lit(sha256(MORTS), gardien())).status).toBe(403);
  });

  it('sans session, ni dépôt ni lecture (401)', async () => {
    const depot = await fetch(`${origin}/api/v1/media/${sha256(MORTS)}?retention=OperationalProof`, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: new Uint8Array(MORTS) });
    const lecture = await fetch(`${origin}/api/v1/media/${sha256(MORTS)}`);

    expect([depot.status, lecture.status]).toEqual([401, 401]);
  });
});
