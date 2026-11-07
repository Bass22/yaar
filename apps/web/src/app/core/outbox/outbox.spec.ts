import { IDBFactory } from 'fake-indexeddb';
import { Outbox, OutboxUnavailable, type EventDraft } from './outbox';

// Spec: backlog G.3 — l'outbox garde chaque déclaration ; Architecture §5 « Outbox locale » ;
// CLAUDE.md §4 règles 2 (UUID créé sur l'appareil) et 3 (un événement déclaré ne se perd jamais).

const OUSMANE = '00000000-0000-4000-8000-000000000051';
const AWA = '00000000-0000-4000-8000-000000000052';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// Three deaths for November 5th, as the caretaker's gesture produces them.
const troisMorts = (quantity = 3): EventDraft => ({
  siteId: '00000000-0000-4000-8000-000000000003',
  campaignId: '00000000-0000-4000-8000-000000000004',
  businessDate: '2026-11-05',
  recordedAt: '2026-11-05T18:30:00.000Z',
  fact: { type: 'Death', quantity },
});

describe("L'outbox garde chaque déclaration", () => {
  let factory: IDBFactory;

  beforeEach(() => {
    // A fresh browser storage for every test.
    factory = new IDBFactory();
  });

  it("une déclaration est enregistrée sur le téléphone, en attente, avec un identifiant créé ici une seule fois", async () => {
    const outbox = await Outbox.open(factory);

    const entry = await outbox.record(OUSMANE, troisMorts());

    expect(entry).toMatchObject({ authorId: OUSMANE, state: 'pending', payload: { ...troisMorts(), id: entry.id } });
    expect(entry.id).toMatch(UUID);
    expect((await outbox.toSend(OUSMANE)).map((sent) => sent.payload.id)).toEqual([entry.id]);
  });

  it("elle survit à la fermeture de l'application : relue au redémarrage, à l'identique", async () => {
    const before = await Outbox.open(factory);
    const entry = await before.record(OUSMANE, troisMorts());
    before.close();

    const after = await Outbox.open(factory);

    expect(await after.toSend(OUSMANE)).toEqual([entry]);
  });

  it("les événements partent dans l'ordre de leur création", async () => {
    const outbox = await Outbox.open(factory);
    const ids: string[] = [];
    for (const quantity of [1, 2, 3, 4]) {
      ids.push((await outbox.record(OUSMANE, troisMorts(quantity))).id);
    }

    expect((await outbox.toSend(OUSMANE)).map((entry) => entry.id)).toEqual(ids);
  });

  it("chaque événement a un état : en attente, envoi en doute, envoyé ou refusé ; seuls les deux premiers sont à envoyer", async () => {
    const outbox = await Outbox.open(factory);
    const [a, b, c, d] = await Promise.all([1, 2, 3, 4].map(async () => outbox.record(OUSMANE, troisMorts())));

    await outbox.markInDoubt([b!.id, c!.id, d!.id]);
    await outbox.markSent([c!.id]);
    await outbox.markRefused(d!.id, { kind: 'CatchUpWindowPassed' });

    expect((await outbox.toSend(OUSMANE)).map((entry) => [entry.id, entry.state])).toEqual([
      [a!.id, 'pending'],
      [b!.id, 'in-doubt'],
    ]);
    expect(await outbox.refused(OUSMANE)).toEqual([expect.objectContaining({ id: d!.id, state: 'refused', refusal: { kind: 'CatchUpWindowPassed' } })]);
  });

  it("une déclaration jamais partie se corrige sur place ; dès qu'un envoi a été tenté, elle ne change plus", async () => {
    const outbox = await Outbox.open(factory);
    const untouched = await outbox.record(OUSMANE, troisMorts(3));
    const tried = await outbox.record(OUSMANE, troisMorts(3));
    await outbox.markInDoubt([tried.id]);

    expect(await outbox.replace(untouched.id, troisMorts(2))).toBe(true);
    expect(await outbox.replace(tried.id, troisMorts(2))).toBe(false);

    const [first, second] = await outbox.toSend(OUSMANE);
    expect(first).toMatchObject({ id: untouched.id, payload: { id: untouched.id, fact: { type: 'Death', quantity: 2 } } });
    expect(second).toMatchObject({ id: tried.id, payload: { fact: { type: 'Death', quantity: 3 } } });
  });

  it("chacun ne reçoit que ses propres déclarations à envoyer : rien ne part sous le nom d'un autre (décision du 2026-11-07)", async () => {
    const outbox = await Outbox.open(factory);
    const byOusmane = await outbox.record(OUSMANE, troisMorts());
    const byAwa = await outbox.record(AWA, troisMorts());

    expect((await outbox.toSend(OUSMANE)).map((entry) => entry.id)).toEqual([byOusmane.id]);
    expect((await outbox.toSend(AWA)).map((entry) => entry.id)).toEqual([byAwa.id]);
  });

  it("le compteur de la pastille dit combien d'événements restent à envoyer", async () => {
    const outbox = await Outbox.open(factory);
    const [a] = await Promise.all([1, 2, 3].map(async () => outbox.record(OUSMANE, troisMorts())));
    await outbox.markSent([a!.id]);

    expect(await outbox.waiting(OUSMANE)).toBe(2);
  });

  it("si le stockage du téléphone n'est pas disponible, l'outbox le dit au lieu de faire semblant : rien n'est noté", async () => {
    const broken = { open: () => { throw new Error('storage disabled'); } } as unknown as IDBFactory;
    await expect(Outbox.open(broken)).rejects.toBeInstanceOf(OutboxUnavailable);

    const outbox = await Outbox.open(factory);
    outbox.close();
    await expect(outbox.record(OUSMANE, troisMorts())).rejects.toBeInstanceOf(OutboxUnavailable);
  });
});
