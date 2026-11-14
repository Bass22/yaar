import { HttpClient, HttpHeaders, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { readOrRecall, type Reading } from './office-sync';

// Spec: backlog P.7 — sans réseau, un écran du bureau montre la dernière lecture gardée sur
// l'appareil, avec sa date. Refactoring du 2026-11-14 : six services lisaient chacun ainsi ; la
// lecture est maintenant une seule fonction, prouvée ici.

const URL = '/api/v1/campaigns/00000000-0000-4000-8000-000000000004/tracking';
const GERANT = '00000000-0000-4000-8000-000000000050';
const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

describe('La lecture d’un écran du bureau, en ligne ou gardée', () => {
  let http: HttpTestingController;
  let client: HttpClient;
  const shown: { reading: Reading<{ mortality: number }> | null; online: boolean }[] = [];
  const read = (now: string) =>
    readOrRecall<{ mortality: number }>(client, URL, GERANT, new HttpHeaders(), () => new Date(now), (reading, online) => {
      shown.push({ reading, online });
    });

  beforeEach(() => {
    localStorage.clear();
    shown.length = 0;
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
    client = TestBed.inject(HttpClient);
  });

  it('en ligne, l’écran montre la lecture et sa date ; sans réseau ensuite, il montre la même, gardée, avec la date de cette lecture', async () => {
    // Given une lecture en ligne à 9 h
    const enLigne = read('2026-11-14T09:00:00.000Z');
    http.expectOne(URL).flush({ mortality: 3 });
    await enLigne;

    // When le réseau manque à la lecture suivante
    const horsLigne = read('2026-11-14T11:00:00.000Z');
    await settle();
    http.expectOne(URL).error(new ProgressEvent('error'), { status: 0 });
    await horsLigne;

    // Then
    expect(shown).toEqual([
      { reading: { value: { mortality: 3 }, readAt: '2026-11-14T09:00:00.000Z' }, online: true },
      { reading: { value: { mortality: 3 }, readAt: '2026-11-14T09:00:00.000Z' }, online: false },
    ]);
  });

  it('sans réseau et sans lecture gardée, l’écran le sait : rien à montrer, hors ligne', async () => {
    const horsLigne = read('2026-11-14T11:00:00.000Z');
    http.expectOne(URL).error(new ProgressEvent('error'), { status: 0 });
    await horsLigne;

    expect(shown).toEqual([{ reading: null, online: false }]);
  });

  it('la lecture gardée est celle du compte : un autre compte sur l’appareil ne la voit pas', async () => {
    const enLigne = read('2026-11-14T09:00:00.000Z');
    http.expectOne(URL).flush({ mortality: 3 });
    await enLigne;

    const autre = readOrRecall<{ mortality: number }>(client, URL, '00000000-0000-4000-8000-000000000051', new HttpHeaders(), () => new Date(), (reading, online) => {
      shown.push({ reading, online });
    });
    http.expectOne(URL).error(new ProgressEvent('error'), { status: 0 });
    await autre;

    expect(shown.at(-1)).toEqual({ reading: null, online: false });
  });
});
