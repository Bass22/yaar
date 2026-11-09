import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { unwrap, type Clock } from '@kit';
import { Instant } from '@domain/journal';
import type { ReferenceData } from '@contracts';
import { AppModule } from '../app.module';
import { issueAccessToken, type SessionClaims } from '../auth/access-token';
import { CLOCK } from '../auth/auth.module';
import { APP_CONFIG } from '../config/app-config';
import { configureApp } from '../create-app';
import { createTestDatabase, type TestDatabase } from '../testing/test-database';

// Spec: backlog N.1 — le socle de l'éditeur ; cahier des charges « Référentiels à deux niveaux »
// (douze catégories, drapeaux fixe / variable et commandable, types de pertes ; « le gardien ne
// voit jamais ces écrans ») ; CLAUDE.md §4 règles 4 et 6. PostgreSQL réel, HTTP.
jest.setTimeout(180_000);

const SECRET = 'un-secret-de-test-assez-long-pour-signer-des-jetons';
const uuid = (rank: number): string => `00000000-0000-4000-8000-${String(rank).padStart(12, '0')}`;
const TENANT_NEUF = uuid(10);
const OUSMANE = uuid(51);
const LE_GERANT = uuid(54);
const ORDINATEUR = uuid(92);
const PIN_HASH = '$argon2id$v=19$m=19456,t=2,p=1$dGVzdC1vbmx5LXNhbHQ$dGVzdC1vbmx5LWRpZ2VzdC1ub3QtYS1yZWFsLXBpbg';

describe("Le socle de l'éditeur", () => {
  let db: TestDatabase;
  let app: INestApplication;
  let origin: string;
  const now = Date.parse('2026-11-09T09:00:00.000Z');
  const clock: Clock = { now: () => new Date(now) };

  const tokenOf = (sub: string, role: SessionClaims['role']) =>
    issueAccessToken({ sub, tenant: TENANT_NEUF, role, device: ORDINATEUR }, unwrap(Instant(new Date(now).toISOString())), SECRET);
  const read = (headers: Record<string, string>) => fetch(`${origin}/api/v1/reference-data`, { headers });

  beforeAll(async () => {
    db = await createTestDatabase();
    // A farm just created: nothing but itself and its people — no reference data was written for it.
    await db.superuser.tenant.create({ data: { id: TENANT_NEUF, name: 'Ferme neuve', currency: 'XOF' } });
    await db.superuser.user.createMany({
      data: [
        { id: OUSMANE, tenantId: TENANT_NEUF, role: 'collaborator', phone: '+221770000001', name: 'Ousmane', pinHash: PIN_HASH },
        { id: LE_GERANT, tenantId: TENANT_NEUF, role: 'admin', phone: '+221770000002', name: 'Le gérant', pinHash: PIN_HASH },
      ],
    });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(APP_CONFIG)
      .useValue({ port: 0, databaseUrl: db.appUrl, jwtSecret: SECRET })
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

  it("dès sa création, l'élevage a les douze catégories du socle, chacune avec ses drapeaux, et les quatre types de pertes", async () => {
    const response = await read({ Authorization: `Bearer ${tokenOf(LE_GERANT, 'admin')}` });

    expect(response.status).toBe(200);
    const body = (await response.json()) as ReferenceData;
    expect(body.costCategories).toEqual([
      { category: 'Feed', behaviour: 'Variable', orderable: true },
      { category: 'Chicks', behaviour: 'Variable', orderable: true },
      { category: 'Health', behaviour: 'Variable', orderable: true },
      { category: 'Bedding', behaviour: 'Variable', orderable: true },
      { category: 'Labour', behaviour: 'Fixed', orderable: false },
      { category: 'Equipment', behaviour: 'Fixed', orderable: false },
      { category: 'Cleaning', behaviour: 'Fixed', orderable: false },
      { category: 'Transport', behaviour: 'Variable', orderable: false },
      { category: 'Processing', behaviour: 'Variable', orderable: false },
      { category: 'Utilities', behaviour: 'Variable', orderable: false },
      { category: 'FinancialCharges', behaviour: 'Fixed', orderable: false },
      { category: 'Other', behaviour: 'Variable', orderable: false },
    ]);
    expect(body.lossTypes).toEqual(['Death', 'Missing', 'Donation', 'Theft']);
  });

  it('le gardien ne lit pas le socle (403) ; sans session, rien (401)', async () => {
    expect((await read({ Authorization: `Bearer ${tokenOf(OUSMANE, 'collaborator')}` })).status).toBe(403);
    expect((await read({})).status).toBe(401);
  });

  it('un admin bloqué ne lit plus rien (401) : le compte est relu à chaque requête', async () => {
    await db.superuser.user.update({ where: { id: LE_GERANT }, data: { blockedAt: new Date(now - 1000) } });

    expect((await read({ Authorization: `Bearer ${tokenOf(LE_GERANT, 'admin')}` })).status).toBe(401);
  });
});
