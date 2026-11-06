import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../app.module';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { configureApp } from '../create-app';
import { createTestDatabase, type TestDatabase } from '../testing/test-database';

// Spec: backlog D.1 — une sonde de disponibilité publique répond quand la base répond ;
// l'API refuse de démarrer sans DATABASE_URL. CLAUDE.md §8 (chaque route ouverte a son test).
// Generous: the first run pulls the PostgreSQL image, and every worker boots a container.
jest.setTimeout(180_000);

async function startApi(config: AppConfig): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(APP_CONFIG)
    .useValue(config)
    .compile();
  const app = configureApp(moduleRef.createNestApplication());
  await app.listen(0, '127.0.0.1');
  return app;
}

describe('Sonde de disponibilité', () => {
  let db: TestDatabase;
  const apps: INestApplication[] = [];

  beforeAll(async () => {
    db = await createTestDatabase();
  });

  afterAll(async () => {
    await Promise.all(apps.map((app) => app.close()));
    await db?.drop();
  });

  it('quand la base répond, la sonde répond 200 sans session', async () => {
    // Given l'API branchée, sous son rôle applicatif, sur une base qui tourne
    const app = await startApi({ port: 0, databaseUrl: db.appUrl });
    apps.push(app);

    // When
    const response = await fetch(`${await app.getUrl()}/api/v1/health/ready`);

    // Then
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
  });

  it("quand la base ne répond pas, la sonde répond 503 sans rien dire de la base, et l'API reste en vie", async () => {
    // Given l'API branchée sur une adresse où aucune base n'écoute
    const nowhere = 'postgresql://yaar:s3cr3t-de-test@127.0.0.1:1/yaar?connect_timeout=2';
    const app = await startApi({ port: 0, databaseUrl: nowhere });
    apps.push(app);
    const origin = await app.getUrl();

    // When
    const ready = await fetch(`${origin}/api/v1/health/ready`);
    const body = await ready.text();
    const alive = await fetch(`${origin}/api/v1/health`);

    // Then
    expect(ready.status).toBe(503);
    expect(body).not.toMatch(/s3cr3t|127\.0\.0\.1|postgres|prisma/i);
    expect(alive.status).toBe(200);
  });

  // Spec: backlog D.2 — le rôle de l'application n'est ni superutilisateur ni dispensé de RLS
  it("branchée par erreur sous un rôle qui échappe à la RLS, l'API ne se déclare jamais disponible", async () => {
    // Given l'API branchée sous le rôle propriétaire de la base, celui des migrations
    const app = await startApi({ port: 0, databaseUrl: db.url });
    apps.push(app);

    // When
    const response = await fetch(`${await app.getUrl()}/api/v1/health/ready`);

    // Then
    expect(response.status).toBe(503);
  });

  it("sous un rôle qui possède une table, donc capable de défaire la RLS, l'API ne se déclare pas disponible", async () => {
    // Given une base où, par erreur, le rôle applicatif est devenu propriétaire d'une table
    const misconfigured = await createTestDatabase();
    try {
      await misconfigured.owner.$executeRawUnsafe('ALTER TABLE sites OWNER TO yaar_app');
      const app = await startApi({ port: 0, databaseUrl: misconfigured.appUrl });
      apps.push(app);

      // When
      const response = await fetch(`${await app.getUrl()}/api/v1/health/ready`);

      // Then
      expect(response.status).toBe(503);
      await app.close();
      apps.pop();
    } finally {
      await misconfigured.drop();
    }
  });

  it("sans DATABASE_URL, l'API refuse de démarrer", async () => {
    // Given un environnement sans adresse de base
    const previous = process.env['DATABASE_URL'];
    delete process.env['DATABASE_URL'];

    try {
      // When on compile le module racine tel qu'il part en production
      const start = Test.createTestingModule({ imports: [AppModule] }).compile();

      // Then
      await expect(start).rejects.toThrow(/DATABASE_URL/);
    } finally {
      if (previous !== undefined) {
        process.env['DATABASE_URL'] = previous;
      }
    }
  });
});
