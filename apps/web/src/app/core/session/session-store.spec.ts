import { SessionStore } from './session-store';

// Spec: backlog G.2 — une session ouverte survit à la fermeture de l'application ; CdC
// « Identité » (jeton gardé par l'application, 7 jours pour un gardien, 24 heures pour l'admin ;
// hors-ligne, le gardien continue de déclarer avec une session expirée).

// A token as the server issues it: only its payload matters here, the phone never checks the signature.
const tokenFor = (claims: Record<string, unknown>) => `e30.${btoa(JSON.stringify(claims)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')}.c2ln`;
const OUSMANE = '00000000-0000-4000-8000-000000000051';
const ACCOUNT = { name: 'Ousmane', avatar: 'baobab' as const, language: 'wo' as const };
const PHONE = '+221771234567';

describe('Session gardée sur le téléphone', () => {
  let now: Date;
  const store = (storage: Storage = localStorage) => new SessionStore(storage, () => now);

  beforeEach(() => {
    localStorage.clear();
    now = new Date('2026-11-07T08:00:00.000Z');
  });

  it("une session ouverte survit à la fermeture : relue au redémarrage, avec l'utilisateur, le rôle et l'échéance", () => {
    store().save({ token: tokenFor({ sub: OUSMANE }), expiresAt: '2026-11-14T08:00:00.000Z', role: 'collaborator', account: ACCOUNT }, PHONE);

    // A fresh store reads what the closed application left.
    expect(store().current()).toEqual({ status: 'active', userId: OUSMANE, role: 'collaborator', token: tokenFor({ sub: OUSMANE }), expiresAt: '2026-11-14T08:00:00.000Z', account: ACCOUNT });
  });

  it("passée son échéance, la session est expirée — l'utilisateur reste connu, le jeton ne sert plus", () => {
    store().save({ token: tokenFor({ sub: OUSMANE }), expiresAt: '2026-11-07T09:00:00.000Z', role: 'collaborator', account: ACCOUNT }, PHONE);
    now = new Date('2026-11-07T09:00:00.000Z');

    expect(store().current()).toMatchObject({ status: 'expired', userId: OUSMANE, role: 'collaborator' });
  });

  it("sans session enregistrée, ou avec une valeur illisible, personne n'est connecté", () => {
    expect(store().current()).toEqual({ status: 'none' });
    localStorage.setItem('yaar.session', '{pas du json');
    expect(store().current()).toEqual({ status: 'none' });
  });

  it("se déconnecter oublie la session, mais pas l'appareil", () => {
    const device = store().deviceId();
    store().save({ token: tokenFor({ sub: OUSMANE }), expiresAt: '2026-11-14T08:00:00.000Z', role: 'collaborator', account: ACCOUNT }, PHONE);

    store().clear();

    expect(store().current()).toEqual({ status: 'none' });
    expect(store().deviceId()).toBe(device);
  });

  it("le téléphone retient les comptes qui s'y sont connectés — nom, avatar, rôle, numéro, langue de la voix —, le plus récent d'abord, sans doublon, même après une déconnexion (E.9)", () => {
    const AWA = '00000000-0000-4000-8000-000000000052';
    store().save({ token: tokenFor({ sub: OUSMANE }), expiresAt: '2026-11-14T08:00:00.000Z', role: 'collaborator', account: ACCOUNT }, PHONE);
    store().save({ token: tokenFor({ sub: AWA }), expiresAt: '2026-11-14T08:00:00.000Z', role: 'collaborator', account: { name: 'Awa', avatar: 'pirogue', language: 'fr' } }, '+221770000052');
    store().save({ token: tokenFor({ sub: OUSMANE }), expiresAt: '2026-11-14T09:00:00.000Z', role: 'collaborator', account: ACCOUNT }, PHONE);
    store().clear();

    expect(store().knownAccounts()).toEqual([
      { userId: OUSMANE, phone: PHONE, role: 'collaborator', name: 'Ousmane', avatar: 'baobab', language: 'wo' },
      { userId: AWA, phone: '+221770000052', role: 'collaborator', name: 'Awa', avatar: 'pirogue', language: 'fr' },
    ]);
  });

  it("une liste de comptes illisible n'empêche pas d'entrer : elle est vide", () => {
    localStorage.setItem('yaar.accounts', '{cassé');

    expect(store().knownAccounts()).toEqual([]);
  });

  it("l'appareil reçoit un identifiant une seule fois, créé sur le téléphone, et le garde", () => {
    const first = store().deviceId();

    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(store().deviceId()).toBe(first);
  });
});
