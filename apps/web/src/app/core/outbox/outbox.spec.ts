import { IDBFactory } from 'fake-indexeddb';
import { Outbox, OutboxUnavailable, SENT_KEPT_DAYS, type EventDraft } from './outbox';

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

  // Spec: backlog J.3 — le journal du jour montre aussi ce qui n'est pas encore parti
  it("le cahier relit tout ce que le téléphone garde d'une bande — en attente, en doute, envoyé, de tous les comptes —, sauf les refus, montrés à part", async () => {
    const outbox = await Outbox.open(factory);
    const enAttente = await outbox.record(OUSMANE, troisMorts(1));
    const envoye = await outbox.record(OUSMANE, troisMorts(2));
    const refuse = await outbox.record(OUSMANE, troisMorts(3));
    const deAwa = await outbox.record(AWA, troisMorts(4));
    await outbox.record(OUSMANE, { ...troisMorts(5), campaignId: '00000000-0000-4000-8000-000000000044' });
    await outbox.markSent([envoye.id]);
    await outbox.markRefused(refuse.id, { kind: 'CampaignClosed' });

    const relu = await outbox.entriesOf('00000000-0000-4000-8000-000000000004');

    expect(relu.map((entry) => [entry.id, entry.state])).toEqual([
      [enAttente.id, 'pending'],
      [envoye.id, 'sent'],
      [deAwa.id, 'pending'],
    ]);
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

  // Spec: backlog G.6 (question du fondateur : « la mémoire des téléphones est nettoyée ? ») —
  // jamais un événement en attente ou en doute ne disparaît.
  describe('le téléphone se vide de ce qui est envoyé', () => {
    const jour = (iso: string) => new Date(`${iso}T08:00:00.000Z`);
    const ids = async (outbox: Outbox) => (await outbox.entriesOf('00000000-0000-4000-8000-000000000004')).map(({ id }) => id);

    it('un événement envoyé s’efface 120 jours après son envoi, pas avant : le serveur l’a, et le cahier le reçoit de lui', async () => {
      const outbox = await Outbox.open(factory);
      const envoye = await outbox.record(OUSMANE, troisMorts());
      await outbox.markSent([envoye.id], jour('2026-11-05'));

      expect(SENT_KEPT_DAYS).toBe(120);
      expect(await outbox.cleanUp(jour('2027-03-04'))).toBe(0); // 119 jours
      expect(await ids(outbox)).toEqual([envoye.id]);
      expect(await outbox.cleanUp(jour('2027-03-05'))).toBe(1); // 120 jours
      expect(await ids(outbox)).toEqual([]);
    });

    it('marqué envoyé deux fois, il garde sa première date d’envoi', async () => {
      const outbox = await Outbox.open(factory);
      const envoye = await outbox.record(OUSMANE, troisMorts());
      await outbox.markSent([envoye.id], jour('2026-11-05'));
      await outbox.markSent([envoye.id], jour('2027-01-01'));

      expect((await outbox.find(envoye.id))?.sentAt).toBe('2026-11-05T08:00:00.000Z');
    });

    it('un événement envoyé avant ce nettoyage, sans date d’envoi, reçoit la date du premier passage, puis part 120 jours après', async () => {
      const outbox = await Outbox.open(factory);
      const ancien = await outbox.record(OUSMANE, troisMorts());
      await outbox.markSent([ancien.id], jour('2026-01-01'));
      outbox.close();
      // An entry written before G.6 has no date of sending: the stored record is made so, by hand.
      await new Promise<void>((resolve, reject) => {
        const opening = factory.open('yaar', 1);
        opening.onerror = () => reject(opening.error);
        opening.onsuccess = () => {
          const store = opening.result.transaction('outbox', 'readwrite').objectStore('outbox');
          const all = store.getAll();
          all.onsuccess = () => {
            for (const entry of all.result as { sentAt?: string }[]) {
              delete entry.sentAt;
              store.put(entry);
            }
            store.transaction.oncomplete = () => {
              opening.result.close();
              resolve();
            };
          };
        };
      });
      const reopened = await Outbox.open(factory);

      expect(await reopened.cleanUp(jour('2026-11-05'))).toBe(0);
      expect(await reopened.cleanUp(jour('2027-03-04'))).toBe(0);
      expect(await reopened.cleanUp(jour('2027-03-05'))).toBe(1);
    });

    it('un refus reste tant que le gardien ne l’a pas vu ; vu, il s’efface', async () => {
      const outbox = await Outbox.open(factory);
      const refuse = await outbox.record(OUSMANE, troisMorts());
      await outbox.markRefused(refuse.id, { kind: 'CatchUpWindowPassed' });

      expect(await outbox.cleanUp(jour('2030-01-01'))).toBe(0);
      expect(await outbox.refused(OUSMANE)).toHaveLength(1);
      await outbox.acknowledgeRefusals([refuse.id]);
      expect(await outbox.cleanUp(jour('2030-01-01'))).toBe(1);
      expect(await outbox.refused(OUSMANE)).toHaveLength(0);
    });

    it('un événement en attente ou en doute ne s’efface jamais, quel que soit son âge, de quelque compte qu’il soit', async () => {
      const outbox = await Outbox.open(factory);
      const attente = await outbox.record(OUSMANE, troisMorts());
      const doute = await outbox.record(AWA, troisMorts(2));
      await outbox.markInDoubt([doute.id]);

      expect(await outbox.cleanUp(jour('2036-11-05'))).toBe(0);
      expect(await outbox.toSend(OUSMANE)).toHaveLength(1);
      expect(await outbox.toSend(AWA)).toHaveLength(1);
      expect([attente.id, doute.id].every(Boolean)).toBe(true);
    });
  });
});
