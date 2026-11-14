import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { unwrap, type Clock } from '@kit';
import { Instant } from '@domain/journal';
import type { CampaignJournalView } from '@contracts';
import { AppModule } from '../app.module';
import { issueAccessToken, type SessionClaims } from '../auth/access-token';
import { CLOCK } from '../auth/auth.module';
import { APP_CONFIG } from '../config/app-config';
import { configureApp } from '../create-app';
import { createTestDatabase, type TestDatabase } from '../testing/test-database';

// Spec: backlog O.7 — le journal de la bande, au bureau (demande du fondateur du 2026-11-13) ;
// CLAUDE.md §4 règle 1 : rien ne s'efface, une correction et une annulation se lisent à côté de la
// déclaration. PostgreSQL réel, HTTP ; les déclarations passent par la vraie ingestion.
jest.setTimeout(180_000);

const SECRET = 'un-secret-de-test-assez-long-pour-signer-des-jetons';
const uuid = (rank: number): string => `00000000-0000-4000-8000-${String(rank).padStart(12, '0')}`;
const TENANT = uuid(10);
const AUTRE_ELEVAGE = uuid(11);
const NORD = uuid(3);
const BANDE = uuid(4);
const BANDE_AILLEURS = uuid(6);
const OUSMANE = uuid(51);
const LE_GERANT = uuid(54);
const ORDINATEUR = uuid(92);
const PIN_HASH = '$argon2id$v=19$m=19456,t=2,p=1$dGVzdC1vbmx5LXNhbHQ$dGVzdC1vbmx5LWRpZ2VzdC1ub3QtYS1yZWFsLXBpbg';

describe('Le journal de la bande, au bureau', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let origin: string;
  // Thursday November 12th, 2026, 10:00 in Dakar: day 31 of a flock placed on October 12th.
  const now = Date.parse('2026-11-12T10:00:00.000Z');
  let tick = 0;
  const clock: Clock = { now: () => new Date(now + (tick += 1000)) };
  const tokenOf = (sub: string, role: SessionClaims['role'], tenant = TENANT) => issueAccessToken({ sub, tenant, role, device: ORDINATEUR }, unwrap(Instant(new Date(now - 60_000).toISOString())), SECRET);
  const call = (method: string, path: string, body: unknown, token: string) =>
    fetch(`${origin}/api/v1/${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const ecrit = async (author: string, role: SessionClaims['role'], event: Record<string, unknown>) => {
    const response = await call('POST', 'journal/events', { events: [{ siteId: NORD, campaignId: BANDE, ...event }] }, tokenOf(author, role));
    return ((await response.json()) as { outcomes: { status: string }[] }).outcomes[0]?.status;
  };
  const journal = async (id = BANDE, token = tokenOf(LE_GERANT, 'admin')) => call('GET', `campaigns/${id}/journal`, undefined, token);

  beforeAll(async () => {
    db = await createTestDatabase();
    await db.superuser.tenant.createMany({ data: [{ id: TENANT, name: 'Ferme', currency: 'XOF' }, { id: AUTRE_ELEVAGE, name: 'Ailleurs', currency: 'XOF' }] });
    await db.superuser.site.createMany({ data: [{ id: NORD, tenantId: TENANT, name: 'Poulailler Nord', timeZone: 'Africa/Dakar' }, { id: uuid(7), tenantId: AUTRE_ELEVAGE, name: 'Là-bas', timeZone: 'Africa/Dakar' }] });
    await db.superuser.campaign.createMany({
      data: [
        { id: BANDE, tenantId: TENANT, siteId: NORD, placementDay: new Date('2026-10-12'), strain: 'Cobb500', plannedHeadcount: 1000, plannedDuration: 45 },
        { id: BANDE_AILLEURS, tenantId: AUTRE_ELEVAGE, siteId: uuid(7), placementDay: new Date('2026-10-12'), strain: 'Cobb500', plannedHeadcount: 1000, plannedDuration: 45 },
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
      .useValue({ port: 0, databaseUrl: db.appUrl, jwtSecret: SECRET, mediaPath: '/data/medias', vapidPublicKey: null })
      .overrideProvider(CLOCK)
      .useValue(clock)
      .compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.listen(0, '127.0.0.1');
    origin = await app.getUrl();

    // Ousmane: 3 morts le 12, 2 sacs ouverts le 11 ; le gérant corrige les morts à 2, annule les sacs,
    // et écrit à la place du gardien 1 sac ouvert le 3 novembre — un jour que le gardien ne peut plus remplir.
    expect(await ecrit(OUSMANE, 'collaborator', { id: uuid(101), businessDate: '2026-11-12', recordedAt: '2026-11-12T08:00:00.000Z', fact: { type: 'Death', quantity: 3 } })).toBe('Accepted');
    expect(await ecrit(OUSMANE, 'collaborator', { id: uuid(102), businessDate: '2026-11-11', recordedAt: '2026-11-11T18:00:00.000Z', fact: { type: 'BagOpened', quantity: 2 } })).toBe('Accepted');
    expect(await ecrit(LE_GERANT, 'admin', { id: uuid(103), businessDate: '2026-11-12', recordedAt: '2026-11-12T09:00:00.000Z', corrects: uuid(101), fact: { type: 'Death', quantity: 2 } })).toBe('Accepted');
    expect(await ecrit(LE_GERANT, 'admin', { id: uuid(104), businessDate: '2026-11-11', recordedAt: '2026-11-12T09:30:00.000Z', retracts: uuid(102) })).toBe('Accepted');
    expect(await ecrit(LE_GERANT, 'admin', { id: uuid(105), businessDate: '2026-11-03', recordedAt: '2026-11-12T09:40:00.000Z', fact: { type: 'BagOpened', quantity: 1 } })).toBe('Accepted');
  });

  afterAll(async () => {
    await app?.close();
    await db?.drop();
  });

  it('l’admin lit chaque déclaration de la bande, le dernier jour d’abord : qui, quoi, quand ; la correction et l’annulation à côté, l’ancienne valeur lisible', async () => {
    const response = await journal();
    expect(response.status).toBe(200);
    const view = (await response.json()) as CampaignJournalView;

    expect(view).toMatchObject({ campaignId: BANDE, siteId: NORD, placementDay: '2026-10-12', today: '2026-11-12', closed: false });
    expect(view.lines).toEqual([
      {
        id: uuid(101), siteId: NORD, businessDate: '2026-11-12', recordedAt: '2026-11-12T08:00:00.000Z', author: { id: OUSMANE, name: 'Ousmane' },
        declared: { type: 'Death', quantity: 3 }, fact: { type: 'Death', quantity: 2 },
        correction: { author: { id: LE_GERANT, name: 'Le gérant' }, recordedAt: '2026-11-12T09:00:00.000Z' }, retraction: null,
      },
      {
        id: uuid(102), siteId: NORD, businessDate: '2026-11-11', recordedAt: '2026-11-11T18:00:00.000Z', author: { id: OUSMANE, name: 'Ousmane' },
        declared: { type: 'BagOpened', quantity: 2 }, fact: null,
        correction: null, retraction: { author: { id: LE_GERANT, name: 'Le gérant' }, recordedAt: '2026-11-12T09:30:00.000Z' },
      },
      {
        id: uuid(105), siteId: NORD, businessDate: '2026-11-03', recordedAt: '2026-11-12T09:40:00.000Z', author: { id: LE_GERANT, name: 'Le gérant' },
        declared: { type: 'BagOpened', quantity: 1 }, fact: { type: 'BagOpened', quantity: 1 }, correction: null, retraction: null,
      },
    ]);
  });

  // Spec: backlog O.8 — le calendrier de la bande (demande du fondateur du 2026-11-13)
  it('chaque jour de la bande, de J0 à aujourd’hui, dit son résumé : rien déclaré, rien perdu, ou ses morts ; et ses sacs ouverts', async () => {
    // Le 12, Ousmane ouvre 2 sacs et le gérant 1 : le jour compte 3 sacs, pas deux auteurs
    expect(await ecrit(OUSMANE, 'collaborator', { id: uuid(106), businessDate: '2026-11-12', recordedAt: '2026-11-12T09:50:00.000Z', fact: { type: 'BagOpened', quantity: 2 } })).toBe('Accepted');
    expect(await ecrit(LE_GERANT, 'admin', { id: uuid(107), businessDate: '2026-11-12', recordedAt: '2026-11-12T09:55:00.000Z', fact: { type: 'BagOpened', quantity: 1 } })).toBe('Accepted');
    const view = (await (await journal()).json()) as CampaignJournalView;

    // Du 12 octobre (J0) au 12 novembre (J31) : 32 jours
    expect(view.days).toHaveLength(32);
    expect(view.days[0]).toEqual({ day: '2026-10-12', campaignDay: 0, mortality: { kind: 'NotDeclared' }, bagsOpened: 0 });
    // Le 12 : 3 morts corrigés en 2 ; le 11 : les sacs annulés ne comptent plus ; le 3 : le sac écrit par le gérant
    expect(view.days.find(({ day }) => day === '2026-11-12')).toEqual({ day: '2026-11-12', campaignDay: 31, mortality: { kind: 'DeathsDeclared', deaths: 2 }, bagsOpened: 3 });
    expect(view.days.find(({ day }) => day === '2026-11-11')).toEqual({ day: '2026-11-11', campaignDay: 30, mortality: { kind: 'NotDeclared' }, bagsOpened: 0 });
    expect(view.days.find(({ day }) => day === '2026-11-03')).toEqual({ day: '2026-11-03', campaignDay: 22, mortality: { kind: 'NotDeclared' }, bagsOpened: 1 });
  });

  it('le gardien ne lit pas le journal du bureau (403) : il a son cahier', async () => {
    expect((await journal(BANDE, tokenOf(OUSMANE, 'collaborator'))).status).toBe(403);
  });

  it('la bande d’un autre élevage, inconnue ou mal nommée n’existe pas (404)', async () => {
    expect([(await journal(BANDE_AILLEURS)).status, (await journal(uuid(99))).status, (await journal('bande')).status]).toEqual([404, 404, 404]);
  });
});
