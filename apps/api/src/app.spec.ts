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
      .useValue({ port: 0, databaseUrl: 'postgresql://nobody@127.0.0.1:1/none', jwtSecret: 'un-secret-de-test-assez-long-pour-signer-des-jetons' })
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
  it("les seules routes ouvertes sans session sont les deux sondes, la connexion et le choix du premier PIN : aucune ne crée un élevage ni un compte", async () => {
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

    // Then seules les sondes et la connexion répondent, et aucune route ne parle d'élevage ou de compte
    expect(open.sort()).toEqual(['GET /api/v1/health', 'GET /api/v1/health/ready', 'POST /api/v1/auth/choose-pin', 'POST /api/v1/auth/sign-in']);
    expect(open.filter((route) => /tenant|elevage|signup|register|user/i.test(route))).toEqual([]);
  });

  // Spec: backlog E.8 — un élevage garde toujours au moins un admin ; un admin n'est créé que par le script de l'éditeur
  it("les routes du serveur sont celles-ci, et aucune ne crée un admin, ne change un rôle ni n'efface un compte : une route ajoutée fait échouer ce test, pour qu'on la relise", () => {
    type Layer = { route?: { path: string; methods: Record<string, boolean> } };
    const instance = app.getHttpAdapter().getInstance() as { router?: { stack: Layer[] } };
    const routes = (instance.router?.stack ?? [])
      .filter((layer) => layer.route !== undefined)
      .flatMap((layer) => Object.keys(layer.route?.methods ?? {}).map((method) => `${method.toUpperCase()} ${layer.route?.path ?? ''}`))
      .filter((route) => route !== 'GET /api/v1/unopened')
      .sort();

    expect(routes).toEqual([
      'DELETE /api/v1/sites/:siteId/staff/:userId',
      // The caretaker's notebook, filtered by the server: their sites only, no money (F.3).
      // Admin only: the budget of a campaign by category, against its committed cost (S.1).
      'GET /api/v1/campaigns/:id/budget',
      // Admin only: the report of a closed campaign — 404 while it runs (X.2).
      'GET /api/v1/campaigns/:id/closing-report',
      // Admin only: how each caretaker answered for the dead, photo or not (K.6).
      'GET /api/v1/campaigns/:id/death-photos',
      // Admin only: the money of a campaign — committed, cost per bird, costs and their history (P.3).
      'GET /api/v1/campaigns/:id/money',
      // Admin only: the sales of a campaign, revenue, cashed in, margin, average price (W.3).
      'GET /api/v1/campaigns/:id/sales',
      // Admin only: the « Suivi » of a lot — cost per bird, mortality, feed, curve, sales from the first (V.3).
      'GET /api/v1/campaigns/:id/tracking',
      // Admin only: the real weight curve and the weighings waiting for validation (T.5).
      'GET /api/v1/campaigns/:id/weighings',
      // Admin only: the closed campaigns, their reports one tap away (X.2).
      'GET /api/v1/campaigns/closed',
      'GET /api/v1/caretaker/context',
      // Admin only: the farm's cost types under the base, archived ones marked (N.2).
      'GET /api/v1/cost-types',
      // Admin only: the farm's counterparties, archived ones marked (N.3).
      'GET /api/v1/counterparties',
      'GET /api/v1/health',
      'GET /api/v1/health/ready',
      // Admin only: « qui doit quoi », every balance summed again from its entries (R.3).
      'GET /api/v1/ledger',
      // Admin only: a media of the farm cited by an event of its journal, never cached (M.1).
      'GET /api/v1/media/:sha256',
      // Admin only: the farm's orders, their state deduced from the journal (Q.4).
      'GET /api/v1/orders',
      // Admin only: the publisher's base, read and never written nor deleted by a route (N.1).
      'GET /api/v1/reference-data',
      // Admin only: a cost type's name and fixed/variable flag — never its category (N.2).
      'PATCH /api/v1/cost-types/:id',
      // Admin only: a counterparty's name and face — never its kind (N.3).
      'PATCH /api/v1/counterparties/:id',
      // Admin only: a site's name, default voice and strict mode — never its time zone nor its farm (O.1).
      'PATCH /api/v1/sites/:siteId',
      // Admin only: the avatar and the language of an account (E.9) — neither the role nor the PIN.
      'PATCH /api/v1/users/:userId',
      'POST /api/v1/auth/choose-pin',
      'POST /api/v1/auth/sign-in',
      // Admin only: a campaign on a site of the farm of the session, judged by the domain (O.2).
      'POST /api/v1/campaigns',
      // Admin only, online: close a campaign with its leftovers and its comment, traced (X.2).
      'POST /api/v1/campaigns/:id/closing',
      // Admin only: a cost type under a category of the base (N.2).
      'POST /api/v1/cost-types',
      // Admin only: archived, never deleted (N.2).
      'POST /api/v1/cost-types/:id/archive',
      // Admin only: a cost, kept once when sent twice (P.3).
      'POST /api/v1/costs',
      // Admin only: a counter-entry, the cost written again whole (P.2, P.3).
      'POST /api/v1/costs/:id/revisions',
      // Admin only: a supplier, a customer or a collaborator of the farm (N.3).
      'POST /api/v1/counterparties',
      // Admin only: archived, never deleted (N.3).
      'POST /api/v1/counterparties/:id/archive',
      // Every session, judged by the domain: the author and the farm come from the session (F.2).
      'POST /api/v1/journal/events',
      // Admin only: a draft order, judged by the domain (Q.4).
      'POST /api/v1/orders',
      // Admin only: a draft announced to the site's caretaker (Q.4).
      'POST /api/v1/orders/:id/announce',
      // Admin only: an announced order not fully received is closed (Q.4).
      'POST /api/v1/orders/:id/close',
      // Admin only: a payment of an order, kept once when sent twice (Q.9).
      'POST /api/v1/orders/:id/payments',
      // Admin only: a sale, the amount computed by the server, kept once when sent twice (W.3).
      'POST /api/v1/sales',
      // Admin only: money received later for a sale (W.3).
      'POST /api/v1/sales/:id/receipts',
      // Admin only: a settlement with a counterparty, kept once when sent twice (R.2).
      'POST /api/v1/settlements',
      // Admin only: a site of the farm of the session (O.1).
      'POST /api/v1/sites',
      // Always a collaborator: the request does not choose the role (E.5).
      'POST /api/v1/users',
      // Collaborators only: neither one's own account nor another admin (E.4, E.5).
      'POST /api/v1/users/:userId/block',
      'POST /api/v1/users/:userId/reset-pin',
      'POST /api/v1/users/:userId/sign-out-everywhere',
      'POST /api/v1/users/:userId/unblock',
      // Every session: a photo sent by its fingerprint, kept once when sent twice (M.1).
      // Admin only: a weighing asked of a flock, on a day (T.2).
      'POST /api/v1/weighing-requests',
      // Admin only, online: the budget of a campaign written again, the latest counting, traced (S.1).
      'PUT /api/v1/campaigns/:id/budget',
      'PUT /api/v1/media/:sha256',
      // Admin only: a draft rewritten whole (Q.4).
      'PUT /api/v1/orders/:id',
      'PUT /api/v1/sites/:siteId/primary-caretaker',
      'PUT /api/v1/sites/:siteId/staff/:userId',
    ]);
    expect(routes.filter((route) => /role|admin|DELETE \/api\/v1\/users/i.test(route))).toEqual([]);
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
