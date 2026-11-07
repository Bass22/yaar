import { homeOf, mayEnter } from './guards';

// Spec: backlog G.2 — un collaborateur arrive sur le cahier, un admin sur le bureau ; CdC
// « Identité » (hors-ligne, le gardien continue de déclarer avec une session expirée).
const active = (role: 'admin' | 'collaborator') => ({ status: 'active' as const, role, userId: 'u', token: 't', expiresAt: 'x' });
const expired = (role: 'admin' | 'collaborator') => ({ ...active(role), status: 'expired' as const });

describe("Où va l'utilisateur", () => {
  it("à l'ouverture : le cahier pour un gardien, le bureau pour un admin, la connexion pour personne", () => {
    expect(homeOf(active('collaborator'))).toBe('/caretaker');
    expect(homeOf(active('admin'))).toBe('/admin');
    expect(homeOf({ status: 'none' })).toBe('/sign-in');
  });

  it("le cahier s'ouvre au gardien dont la session a expiré : il déclare hors-ligne, la synchro attendra sa reconnexion", () => {
    expect(mayEnter('caretaker', expired('collaborator'))).toBe(true);
    expect(homeOf(expired('collaborator'))).toBe('/caretaker');
  });

  it("le bureau exige une session valide ; personne n'entre sans être connu", () => {
    expect(mayEnter('admin', active('admin'))).toBe(true);
    expect(mayEnter('admin', expired('admin'))).toBe(false);
    expect(homeOf(expired('admin'))).toBe('/sign-in');
    expect(mayEnter('caretaker', { status: 'none' })).toBe(false);
    expect(mayEnter('admin', { status: 'none' })).toBe(false);
  });

  it("un gardien n'entre pas au bureau ; l'admin peut tenir le cahier à la place du gardien", () => {
    expect(mayEnter('admin', active('collaborator'))).toBe(false);
    expect(mayEnter('caretaker', active('admin'))).toBe(true);
  });
});
