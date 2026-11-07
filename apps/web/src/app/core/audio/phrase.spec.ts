import fc from 'fast-check';
import { NUMBER_RULES } from './numbers';
import { clip, compose, counted, number, weight } from './phrase';

// Spec: backlog I.1 — une phrase se compose à partir de clips ; cahier des charges « Trois canaux
// redondants » (phrase entière d'abord, décision du 2026-11-07) ; audio/script.md (annexe des nombres).

const french = (value: number) => NUMBER_RULES.fr?.(value) ?? [];
// What the French speaker recorded for these tests: the whole phrases up to 20, the annex.
const annex = [
  ...Array.from({ length: 21 }, (_, value) => `number-${value}`),
  ...[30, 40, 50, 60, 70, 80, 90].map((value) => `number-${value}`),
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].flatMap((rank) => [`number-${rank * 100}`, `number-${rank * 1000}`]),
  'number-and',
  'unit-kilo',
  'unit-kilos',
  'unit-grams',
];
const recorded = new Set([...annex, 'confirm', 'deaths-many', 'delivery-received', ...Array.from({ length: 20 }, (_, rank) => `deaths-today-${rank + 1}`)]);

describe('Les nombres en français', () => {
  it('de zéro à vingt, chaque nombre a son clip', () => {
    expect([0, 1, 7, 16, 20].map(french)).toEqual([['number-0'], ['number-1'], ['number-7'], ['number-16'], ['number-20']]);
  });

  it('« vingt et un », « trente-deux » : les dizaines, puis « et un » ou l’unité', () => {
    expect(french(21)).toEqual(['number-20', 'number-and', 'number-1']);
    expect(french(32)).toEqual(['number-30', 'number-2']);
    expect(french(60)).toEqual(['number-60']);
  });

  it('« soixante-dix », « soixante et onze », « soixante-dix-sept » : soixante, puis de dix à dix-neuf', () => {
    expect([70, 71, 77].map(french)).toEqual([['number-70'], ['number-60', 'number-and', 'number-11'], ['number-60', 'number-17']]);
  });

  it('« quatre-vingts », « quatre-vingt-un » sans « et », « quatre-vingt-dix », « quatre-vingt-quinze »', () => {
    expect([80, 81, 90, 95].map(french)).toEqual([['number-80'], ['number-80', 'number-1'], ['number-90'], ['number-80', 'number-15']]);
  });

  it('les centaines et les milliers enregistrés entiers : « deux cent cinquante », « quatre mille trente-huit »', () => {
    expect(french(250)).toEqual(['number-200', 'number-50']);
    expect(french(4038)).toEqual(['number-4000', 'number-30', 'number-8']);
    expect(french(1000)).toEqual(['number-1000']);
  });

  it('au-delà de neuf mille, le nombre de milliers puis « mille » : « douze mille cinq cents »', () => {
    expect(french(12_500)).toEqual(['number-12', 'number-1000', 'number-500']);
    expect(french(250_000)).toEqual(['number-200', 'number-50', 'number-1000']);
  });

  it("tout nombre jusqu'à 999 999 se dit avec les seuls clips de l'annexe", () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 999_999 }), (value) => french(value).every((id) => annex.includes(id))));
  });

  it("en wolof, la règle des nombres n'est pas encore fixée avec le locuteur : aucun nombre n'est inventé", () => {
    expect(NUMBER_RULES.wo).toBeNull();
  });
});

describe('Une phrase se compose à partir de clips', () => {
  it('une phrase est une suite ordonnée de clips, dite dans cet ordre', () => {
    expect(compose([counted('deaths-today', 3, 'deaths-many'), clip('confirm')], 'fr', recorded)).toEqual({ ok: true, value: ['deaths-today-3', 'confirm'] });
  });

  it('« 1 poulet mort » et « 3 poulets morts » : chaque nombre a sa phrase entière, accordée à l’enregistrement', () => {
    expect(compose([counted('deaths-today', 1, 'deaths-many')], 'fr', recorded)).toEqual({ ok: true, value: ['deaths-today-1'] });
    expect(compose([counted('deaths-today', 3, 'deaths-many')], 'fr', recorded)).toEqual({ ok: true, value: ['deaths-today-3'] });
  });

  it('au-delà des phrases entières, la phrase se compose, le nombre à la fin : « Poulets morts : quarante-deux »', () => {
    expect(compose([counted('deaths-today', 42, 'deaths-many')], 'fr', recorded)).toEqual({ ok: true, value: ['deaths-many', 'number-40', 'number-2'] });
  });

  it('la phrase entière est toujours préférée : en enregistrer une de plus suffit, sans code', () => {
    const plusUne = new Set([...recorded, 'deaths-today-42']);

    expect(compose([counted('deaths-today', 42, 'deaths-many')], 'fr', plusUne)).toEqual({ ok: true, value: ['deaths-today-42'] });
  });

  it('un nombre seul, et un poids : « un kilo deux cent cinquante grammes », « deux kilos », « huit cent quarante grammes »', () => {
    expect(compose([clip('delivery-received'), number(40)], 'fr', recorded)).toEqual({ ok: true, value: ['delivery-received', 'number-40'] });
    expect(compose([weight(1250)], 'fr', recorded)).toEqual({ ok: true, value: ['number-1', 'unit-kilo', 'number-200', 'number-50', 'unit-grams'] });
    expect(compose([weight(2000)], 'fr', recorded)).toEqual({ ok: true, value: ['number-2', 'unit-kilos'] });
    expect(compose([weight(840)], 'fr', recorded)).toEqual({ ok: true, value: ['number-800', 'number-40', 'unit-grams'] });
  });

  it("une phrase dont un clip n'est pas enregistré est signalée avec ce qui manque, jamais dite à moitié", () => {
    expect(compose([counted('deaths-today', 3, 'deaths-many'), clip('nothing-lost-done')], 'fr', recorded)).toEqual({
      ok: false,
      error: { kind: 'MissingClips', language: 'fr', missing: ['nothing-lost-done'] },
    });
  });

  it('une famille sans phrase composée, au-delà de ce qui est enregistré, est signalée elle aussi', () => {
    expect(compose([counted('campaign-day', 61)], 'fr', recorded)).toEqual({ ok: false, error: { kind: 'MissingClips', language: 'fr', missing: ['campaign-day-61'] } });
  });

  it("en wolof, une phrase entière enregistrée se dit ; un nombre à composer est signalé tant que la règle n'existe pas", () => {
    const wolof = new Set(['deaths-today-3', 'deaths-many', 'number-40', 'number-2']);

    expect(compose([counted('deaths-today', 3, 'deaths-many')], 'wo', wolof)).toEqual({ ok: true, value: ['deaths-today-3'] });
    expect(compose([counted('deaths-today', 42, 'deaths-many')], 'wo', wolof)).toEqual({ ok: false, error: { kind: 'MissingClips', language: 'wo', missing: ['number-42'] } });
  });
});
