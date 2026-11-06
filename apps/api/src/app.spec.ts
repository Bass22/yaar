import { Controller, Get, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from './app.module';
import { APP_CONFIG } from './config/app-config';
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
    })
      // No database is reached by these routes: the address only has to be well formed.
      .overrideProvider(APP_CONFIG)
      .useValue({ port: 0, databaseUrl: 'postgresql://nobody@127.0.0.1:1/none' })
      .compile();
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

  // Spec: backlog D.4 — rien n'est ouvert au self-signup : un élevage se crée par le script, jamais par une route
  it("les seules routes ouvertes sans session sont les deux sondes : aucune ne crée un élevage ni un compte", async () => {
    // Given toutes les routes que le serveur connaît, lues dans son routeur
    type Layer = { route?: { path: string; methods: Record<string, boolean> } };
    const instance = app.getHttpAdapter().getInstance() as { router?: { stack: Layer[] }; _router?: { stack: Layer[] } };
    const router = instance.router ?? instance._router;
    expect(router).toBeDefined();
    const routes = (router?.stack ?? [])
      .filter((layer) => layer.route !== undefined)
      .flatMap((layer) => Object.keys(layer.route?.methods ?? {}).map((method) => ({ method: method.toUpperCase(), path: layer.route?.path ?? '' })));
    expect(routes.length).toBeGreaterThanOrEqual(3);

    // When on les appelle toutes sans session
    const open: string[] = [];
    for (const { method, path } of routes) {
      const response = await fetch(`${origin}${path}`, { method });
      if (response.status !== 401) {
        open.push(`${method} ${path}`);
      }
    }

    // Then seules les sondes répondent, et aucune route ne parle d'élevage ou de compte
    expect(open.sort()).toEqual(['GET /api/v1/health', 'GET /api/v1/health/ready']);
    expect(routes.map((route) => route.path).filter((path) => /tenant|elevage|signup|register|user/i.test(path))).toEqual([]);
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
