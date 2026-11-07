import { unwrap } from '@kit';
import { TimeZone, type BusinessDay } from '@domain/journal';
import type { CaretakerCampaign, CaretakerJournalLine, FactPayload } from '@contracts';
import type { OutboxEntry, OutboxState } from '../../core/outbox/outbox';
import { daysOf, campaignsOf, journalOf, linesOf, summaryOf } from './notebook-view';

// Spec: backlog J.1 (les bandes du site), J.2 (trois jours et leur mini-résumé), J.3 (le journal
// du jour) ; cahier des charges « En-tête et contexte », « Journal du jour », « Rattrapage » ;
// décisions du 2026-11-07 (« les petits » et « les grands », l'âge au-delà de deux bandes).

const uuid = (rank: number): string => `00000000-0000-4000-8000-${String(rank).padStart(12, '0')}`;
const TENANT = uuid(10);
const SITE = uuid(3);
const BANDE = uuid(4);
const OUSMANE = uuid(51);
const AWA = uuid(52);
const HIER = '2026-11-05' as BusinessDay;
const AUJOURDHUI = '2026-11-06' as BusinessDay;
const where = { tenantId: TENANT, siteId: SITE };

const uneBande = (fields: Partial<CaretakerCampaign> = {}): CaretakerCampaign => ({ campaignId: BANDE, placementDay: '2026-10-15', campaignDay: 22, liveCount: null, journal: [], ...fields });
const uneLigne = (rank: number, fact: FactPayload, fields: Partial<CaretakerJournalLine> = {}): CaretakerJournalLine => ({
  id: uuid(rank),
  businessDate: HIER,
  recordedAt: `2026-11-05T1${rank % 10}:00:00.000Z`,
  author: { id: AWA, name: 'Awa' },
  fact,
  corrected: false,
  retracted: false,
  ...fields,
});
let seq = 0;
const surLeTelephone = (rank: number, fact: FactPayload, state: OutboxState = 'pending', fields: { businessDate?: string; corrects?: string; recordedAt?: string } = {}): OutboxEntry => {
  const envelope = { id: uuid(rank), siteId: SITE, campaignId: BANDE, businessDate: fields.businessDate ?? HIER, recordedAt: fields.recordedAt ?? `2026-11-05T2${rank % 10}:00:00.000Z` };
  const payload = fields.corrects === undefined ? { ...envelope, fact } : { ...envelope, corrects: fields.corrects, fact };
  return { seq: ++seq, id: uuid(rank), authorId: OUSMANE, payload, state };
};
const morts = (quantity: number): FactPayload => ({ type: 'Death', quantity });

describe('Les bandes du site', () => {
  it("une seule bande n'a pas de nom : il n'y a rien à choisir", () => {
    expect(campaignsOf([uneBande()], AUJOURDHUI)).toEqual([{ campaignId: BANDE, name: null, picto: 'chick', tone: 'young', campaignDay: 22 }]);
  });

  it('deux bandes sont « les petits » — la plus jeune, au poussin — et « les grands », la plus jeune en premier', () => {
    const grands = uneBande({ campaignId: uuid(4), placementDay: '2026-10-15' });
    const petits = uneBande({ campaignId: uuid(7), placementDay: '2026-11-01' });

    expect(campaignsOf([grands, petits], AUJOURDHUI).map(({ name, picto, tone, campaignDay }) => [name, picto, tone, campaignDay])).toEqual([
      ['Les petits', 'chick', 'young', 5],
      ['Les grands', 'hen', 'old', 22],
    ]);
  });

  it("au-delà de deux bandes, chacune s'appelle par son âge (décision du 2026-11-07)", () => {
    const bandes = ['2026-10-01', '2026-10-15', '2026-11-01'].map((placementDay, rank) => uneBande({ campaignId: uuid(20 + rank), placementDay }));

    expect(campaignsOf(bandes, AUJOURDHUI).map((campaign) => campaign.name)).toEqual(['Jour 5', 'Jour 22', 'Jour 36']);
  });

  it("le jour J se compte sur l'aujourd'hui du téléphone, pas sur celui de la dernière réponse du serveur : hors-ligne, il avance quand même", () => {
    expect(campaignsOf([uneBande({ campaignDay: 22 })], '2026-11-09' as BusinessDay)[0]?.campaignDay).toBe(25);
  });
});

describe('Les trois jours', () => {
  it("avant-hier, hier, aujourd'hui, dans le fuseau du site : à Dakar, 23 h 30 en temps universel est encore aujourd'hui", () => {
    expect(daysOf(new Date('2026-11-06T23:30:00.000Z'), unwrap(TimeZone('Africa/Dakar')))).toEqual([
      { day: '2026-11-04', when: 'dayBeforeYesterday' },
      { day: '2026-11-05', when: 'yesterday' },
      { day: '2026-11-06', when: 'today' },
    ]);
  });

  it("ailleurs, le jour suit le fuseau du site, pas le temps universel : à Lagos (UTC+1), 23 h 30 en temps universel est déjà demain", () => {
    expect(daysOf(new Date('2026-11-06T23:30:00.000Z'), unwrap(TimeZone('Africa/Lagos'))).map((day) => day.day)).toEqual(['2026-11-05', '2026-11-06', '2026-11-07']);
  });

  it("un jour où rien n'est écrit, un jour à zéro déclaré et un jour avec des morts ne se résument pas pareil", () => {
    const bande = uneBande({ journal: [uneLigne(1, { type: 'NoLoss' }, { businessDate: '2026-11-04' }), uneLigne(2, morts(3))] });
    const journal = journalOf(bande, [], where);

    expect(summaryOf(journal, BANDE, '2026-11-04' as BusinessDay).mortality).toEqual({ kind: 'NoLossDeclared' });
    expect(summaryOf(journal, BANDE, HIER).mortality).toEqual({ kind: 'DeathsDeclared', deaths: 3 });
    expect(summaryOf(journal, BANDE, AUJOURDHUI).mortality).toEqual({ kind: 'NotDeclared' });
  });

  it("le résumé compte ce qui attend encore sur le téléphone, hors-ligne, avec ce que le serveur a envoyé — un événement déjà revenu du serveur une seule fois", () => {
    const bande = uneBande({ journal: [uneLigne(1, morts(3), { author: { id: OUSMANE, name: 'Ousmane' } })] });
    const journal = journalOf(bande, [surLeTelephone(1, morts(3), 'sent'), surLeTelephone(2, morts(2))], where);

    expect(summaryOf(journal, BANDE, HIER).mortality).toEqual({ kind: 'DeathsDeclared', deaths: 5 });
  });

  it("une ligne annulée par l'admin ne compte plus, même si le téléphone la garde encore comme envoyée", () => {
    const bande = uneBande({ journal: [uneLigne(1, morts(4), { retracted: true })] });
    const journal = journalOf(bande, [surLeTelephone(1, morts(4), 'sent')], where);

    expect(summaryOf(journal, BANDE, HIER).mortality).toEqual({ kind: 'NotDeclared' });
  });

  it('une correction encore sur le téléphone compte déjà : la dernière écrite fait foi', () => {
    const bande = uneBande({ journal: [uneLigne(1, morts(4), { author: { id: OUSMANE, name: 'Ousmane' } })] });
    const journal = journalOf(bande, [surLeTelephone(2, morts(2), 'pending', { corrects: uuid(1) })], where);

    expect(summaryOf(journal, BANDE, HIER).mortality).toEqual({ kind: 'DeathsDeclared', deaths: 2 });
  });
});

describe('Le journal du jour', () => {
  it("les lignes du jour choisi, la dernière écrite en haut, avec leur auteur ; celles du téléphone portent l'horloge tant qu'elles ne sont pas parties", () => {
    const bande = uneBande({ journal: [uneLigne(1, morts(3)), uneLigne(3, { type: 'BagOpened', quantity: 1 }, { businessDate: AUJOURDHUI })] });
    const entries = [surLeTelephone(5, morts(2)), surLeTelephone(6, { type: 'BagOpened', quantity: 2 }, 'in-doubt'), surLeTelephone(7, morts(1), 'sent')];

    const lignes = linesOf(bande, journalOf(bande, entries, where), entries, HIER);

    expect(lignes.map(({ id, authorId, fact, waiting }) => [id, authorId, fact, waiting])).toEqual([
      [uuid(7), OUSMANE, morts(1), false],
      [uuid(6), OUSMANE, { type: 'BagOpened', quantity: 2 }, true],
      [uuid(5), OUSMANE, morts(2), true],
      [uuid(1), AWA, morts(3), false],
    ]);
  });

  it("une ligne corrigée montre sa valeur effective et se dit corrigée ; si la correction attend encore, la ligne attend aussi", () => {
    const bande = uneBande({ journal: [uneLigne(1, morts(2), { corrected: true }), uneLigne(2, morts(5))] });
    const entries = [surLeTelephone(8, morts(4), 'pending', { corrects: uuid(2) })];

    const lignes = linesOf(bande, journalOf(bande, entries, where), entries, HIER);

    expect(lignes.map(({ id, fact, corrected, waiting }) => [id, fact, corrected, waiting])).toEqual([
      [uuid(2), morts(4), true, true],
      [uuid(1), morts(2), true, false],
    ]);
  });

  it("une ligne annulée reste visible, dite annulée, avec ce qui avait été déclaré", () => {
    const bande = uneBande({ journal: [uneLigne(1, morts(4), { retracted: true })] });

    expect(linesOf(bande, journalOf(bande, [], where), [], HIER)).toEqual([
      { id: uuid(1), recordedAt: '2026-11-05T11:00:00.000Z', authorId: AWA, fact: morts(4), corrected: false, retracted: true, waiting: false },
    ]);
  });

  it("une autre bande ne passe pas dans ce journal", () => {
    const ailleurs = { ...surLeTelephone(9, morts(6)), payload: { ...surLeTelephone(9, morts(6)).payload, campaignId: uuid(44) } };
    const bande = uneBande();

    expect(linesOf(bande, journalOf(bande, [ailleurs], where), [ailleurs], HIER)).toEqual([]);
  });
});
