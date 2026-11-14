import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { unwrap, type Clock } from '@kit';
import { Instant } from '@domain/journal';
import type { OrderView } from '@contracts';
import { AppModule } from '../app.module';
import { issueAccessToken, type SessionClaims } from '../auth/access-token';
import { CLOCK } from '../auth/auth.module';
import { APP_CONFIG } from '../config/app-config';
import { configureApp } from '../create-app';
import { createTestDatabase, type TestDatabase } from '../testing/test-database';

// Spec: backlog R.6 — les justificatifs (décision du fondateur du 2026-11-13 : des photos aux
// commandes et aux paiements, ajoutables plus tard). Joindre ne modifie jamais l'écriture : c'est
// une écriture à part, en ajout seul. PostgreSQL réel, HTTP, un vrai volume de médias.
jest.setTimeout(180_000);

const SECRET = 'un-secret-de-test-assez-long-pour-signer-des-jetons';
const uuid = (rank: number): string => `00000000-0000-4000-8000-${String(rank).padStart(12, '0')}`;
const TENANT_A = uuid(10);
const TENANT_B = uuid(11);
const NORD = uuid(3);
const BANDE = uuid(4);
const SEDIMA = uuid(31);
const ALIMENT = uuid(41);
const COMMANDE = uuid(20);
const PAIEMENT = uuid(501);
const OUSMANE = uuid(51);
const LE_GERANT = uuid(54);
const GERANT_DE_B = uuid(55);
const ORDINATEUR = uuid(92);
const PIN_HASH = '$argon2id$v=19$m=19456,t=2,p=1$dGVzdC1vbmx5LXNhbHQ$dGVzdC1vbmx5LWRpZ2VzdC1ub3QtYS1yZWFsLXBpbg';

const jpeg = (words: string) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(words), Buffer.from([0xff, 0xd9])]);
const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');
const FACTURE = jpeg('la facture de Sedima, 20 sacs');
const RECU_WAVE = jpeg('le recu Wave de 100 000 F');
const JAMAIS_DEPOSEE = jpeg('une photo jamais envoyee');

describe('Les justificatifs, au bureau', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let origin: string;
  let volume: string;
  const now = Date.parse('2026-11-13T10:00:00.000Z');
  let tick = 0;
  const clock: Clock = { now: () => new Date(now + (tick += 1000)) };
  const tokenOf = (sub: string, tenant: string, role: SessionClaims['role']) => issueAccessToken({ sub, tenant, role, device: ORDINATEUR }, unwrap(Instant(new Date(now - 60_000).toISOString())), SECRET);
  const gerant = () => tokenOf(LE_GERANT, TENANT_A, 'admin');
  type Token = ReturnType<typeof gerant>;
  const depose = (bytes: Buffer, token: Token = gerant()) =>
    fetch(`${origin}/api/v1/media/${sha256(bytes)}?retention=SupportingDocument`, { method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'image/jpeg' }, body: new Uint8Array(bytes) });
  const joins = (body: unknown, token: Token = gerant()) => fetch(`${origin}/api/v1/attachments`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const lit = (bytes: Buffer) => fetch(`${origin}/api/v1/media/${sha256(bytes)}`, { headers: { Authorization: `Bearer ${gerant()}` } });
  const commande = async () => ((await (await fetch(`${origin}/api/v1/orders`, { headers: { Authorization: `Bearer ${gerant()}` } })).json()) as OrderView[]).find(({ id }) => id === COMMANDE);
  const kindOf = async (response: Response) => ((await response.json()) as { kind?: string }).kind;

  beforeAll(async () => {
    volume = await mkdtemp(join(tmpdir(), 'yaar-attachments-'));
    db = await createTestDatabase();
    await db.superuser.tenant.createMany({ data: [TENANT_A, TENANT_B].map((id) => ({ id, name: 'Ferme', currency: 'XOF' })) });
    await db.superuser.site.create({ data: { id: NORD, tenantId: TENANT_A, name: 'Poulailler Nord', timeZone: 'Africa/Dakar' } });
    await db.superuser.campaign.create({ data: { id: BANDE, tenantId: TENANT_A, siteId: NORD, placementDay: new Date('2026-10-12'), strain: 'Cobb500', plannedHeadcount: 1000, plannedDuration: 45 } });
    await db.superuser.user.createMany({
      data: [
        { id: OUSMANE, tenantId: TENANT_A, role: 'collaborator', phone: '+221770000001', name: 'Ousmane', pinHash: PIN_HASH },
        { id: LE_GERANT, tenantId: TENANT_A, role: 'admin', phone: '+221770000002', name: 'Le gérant', pinHash: PIN_HASH },
        { id: GERANT_DE_B, tenantId: TENANT_B, role: 'admin', phone: '+221770000003', name: 'Gérant B', pinHash: PIN_HASH },
      ],
    });
    await db.superuser.counterparty.create({ data: { id: SEDIMA, tenantId: TENANT_A, kind: 'Supplier', name: 'Sedima', face: 'closed-bag' } });
    await db.superuser.costType.create({ data: { id: ALIMENT, tenantId: TENANT_A, category: 'Feed', name: 'Aliment', behaviour: 'Variable', bagWeight: 50_000 } });
    await db.superuser.purchaseOrder.create({ data: { id: COMMANDE, tenantId: TENANT_A, supplierId: SEDIMA, campaignId: BANDE, orderDay: new Date('2026-10-12'), currency: 'XOF', announcedAt: new Date('2026-10-12T09:00:00.000Z') } });
    await db.superuser.orderLine.create({ data: { id: uuid(21), tenantId: TENANT_A, orderId: COMMANDE, position: 0, costTypeId: ALIMENT, quantity: 20, unitPrice: 17_500, bagWeight: 50_000 } });
    await db.superuser.payment.create({ data: { id: PAIEMENT, tenantId: TENANT_A, orderId: COMMANDE, paidOn: new Date('2026-10-13'), amount: 100_000, method: 'Wave', recordedBy: LE_GERANT } });

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(APP_CONFIG)
      .useValue({ port: 0, databaseUrl: db.appUrl, jwtSecret: SECRET, mediaPath: volume, vapidPublicKey: null })
      .overrideProvider(CLOCK)
      .useValue(clock)
      .compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.listen(0, '127.0.0.1');
    origin = await app.getUrl();
    expect([(await depose(FACTURE)).status, (await depose(RECU_WAVE)).status]).toEqual([201, 201]);
  });

  afterAll(async () => {
    await app?.close();
    await db?.drop();
    await rm(volume, { recursive: true, force: true });
  });

  it('une photo envoyée mais jointe à rien ne se lit pas', async () => {
    expect((await lit(FACTURE)).status).toBe(404);
  });

  it('l’admin joint une photo à une commande, plus tard : la commande ne change pas, la photo se lit et se voit sur elle ; c’est tracé', async () => {
    const response = await joins({ id: uuid(601), subjectKind: 'Order', subjectId: COMMANDE, media: sha256(FACTURE) });
    expect(response.status).toBe(201);

    expect((await commande())?.attachments).toEqual([sha256(FACTURE)]);
    expect((await lit(FACTURE)).status).toBe(200);
    expect(await db.superuser.purchaseOrder.findUniqueOrThrow({ where: { id: COMMANDE }, select: { announcedAt: true } })).toEqual({ announcedAt: new Date('2026-10-12T09:00:00.000Z') });
    expect(await db.superuser.auditEvent.count({ where: { action: 'AttachmentAdded', actorId: LE_GERANT, subjectId: COMMANDE } })).toBe(1);
  });

  it('et à un paiement : le reçu Wave se voit sur ce paiement', async () => {
    expect((await joins({ id: uuid(602), subjectKind: 'Payment', subjectId: PAIEMENT, media: sha256(RECU_WAVE) })).status).toBe(201);
    expect((await commande())?.payments[0]?.attachments).toEqual([sha256(RECU_WAVE)]);
  });

  it('la même photo jointe deux fois au même ne compte qu’une fois ; le même identifiant renvoyé non plus', async () => {
    expect((await joins({ id: uuid(603), subjectKind: 'Order', subjectId: COMMANDE, media: sha256(FACTURE) })).status).toBe(200);
    expect((await joins({ id: uuid(601), subjectKind: 'Order', subjectId: COMMANDE, media: sha256(FACTURE) })).status).toBe(200);
    expect((await commande())?.attachments).toEqual([sha256(FACTURE)]);
  });

  it('une photo jamais envoyée, une écriture inconnue ou d’un autre élevage, une demande mal formée : refusées, sans rien écrire', async () => {
    const avant = await db.superuser.attachment.count();
    const jamais = await joins({ id: uuid(604), subjectKind: 'Order', subjectId: COMMANDE, media: sha256(JAMAIS_DEPOSEE) });
    const inconnue = await joins({ id: uuid(605), subjectKind: 'Payment', subjectId: uuid(999), media: sha256(FACTURE) });
    const ailleurs = await joins({ id: uuid(606), subjectKind: 'Order', subjectId: COMMANDE, media: sha256(FACTURE) }, tokenOf(GERANT_DE_B, TENANT_B, 'admin'));
    const malFormee = await joins({ id: uuid(607), subjectKind: 'Cost', subjectId: COMMANDE, media: sha256(FACTURE) });
    expect([jamais.status, await kindOf(jamais), inconnue.status, await kindOf(inconnue), ailleurs.status, malFormee.status, await kindOf(malFormee)]).toEqual([400, 'UnknownMedia', 400, 'UnknownSubject', 400, 400, 'InvalidRequest']);
    expect(await db.superuser.attachment.count()).toBe(avant);
  });

  it('le gardien ne joint rien (403)', async () => {
    expect((await joins({ id: uuid(608), subjectKind: 'Order', subjectId: COMMANDE, media: sha256(FACTURE) }, tokenOf(OUSMANE, TENANT_A, 'collaborator'))).status).toBe(403);
  });
});
