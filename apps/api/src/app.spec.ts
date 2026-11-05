import { Controller, Get, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from './app.module';
import { configureApp } from './create-app';

// A route nobody opened: it stands for any future route written without `@Public()`.
@Controller('unopened')
class UnopenedController {
  @Get()
  read(): { leaked: true } {
    return { leaked: true };
  }
}

// Spec: backlog A.3 — route de santé publique, routes fermées par défaut, CORS jamais activé
// (CLAUDE.md §4 règle 6, §8 API)
describe("Démarrage de l'API", () => {
  let app: INestApplication;
  let origin: string;

  beforeAll(async () => {
    // Given l'application configurée comme en production, plus une route que personne n'a ouverte
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [UnopenedController],
    }).compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.listen(0, '127.0.0.1');
    origin = await app.getUrl();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('la route de santé répond 200 sans session', async () => {
    const response = await fetch(`${origin}/api/v1/health`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
  });

  it("l'API est versionnée : la santé hors du préfixe /api/v1 est inconnue", async () => {
    const response = await fetch(`${origin}/health`);

    expect(response.status).toBe(404);
  });

  it("une route que personne n'a ouverte est refusée sans session", async () => {
    const response = await fetch(`${origin}/api/v1/unopened`);

    expect(response.status).toBe(401);
    expect(await response.text()).not.toContain('leaked');
  });

  it("CORS n'est jamais activé : une origine étrangère n'obtient aucune autorisation", async () => {
    // When un autre site interroge l'API, puis demande la permission d'écrire
    const read = await fetch(`${origin}/api/v1/health`, { headers: { Origin: 'https://ailleurs.example' } });
    const preflight = await fetch(`${origin}/api/v1/health`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://ailleurs.example', 'Access-Control-Request-Method': 'POST' },
    });

    // Then aucune réponse n'autorise cette origine
    for (const response of [read, preflight]) {
      const corsHeaders = [...response.headers.keys()].filter((name) => name.startsWith('access-control-'));
      expect(corsHeaders).toEqual([]);
    }
  });
});
