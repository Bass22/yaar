import { inspect } from 'node:util';
import { unwrap } from '@kit';
import { Pin } from './pin';

// Spec: Cahier des charges — « Identité » : le PIN a 4 chiffres pour un gardien, 6 pour l'admin.
// Backlog E.1 — le PIN ne sort jamais ; CLAUDE.md §4 règle 6 (fail-closed).

describe('PIN', () => {
  describe('sa longueur dépend du rôle', () => {
    it('le PIN du gardien a quatre chiffres', () => {
      expect(Pin('4829', 'collaborator').ok).toBe(true);
      for (const raw of ['482', '48291', '482913']) {
        expect(Pin(raw, 'collaborator')).toEqual({ ok: false, error: { kind: 'InvalidPin', expectedDigits: 4 } });
      }
    });

    it("le PIN de l'admin a six chiffres", () => {
      expect(Pin('482913', 'admin').ok).toBe(true);
      for (const raw of ['4829', '48291', '4829137']) {
        expect(Pin(raw, 'admin')).toEqual({ ok: false, error: { kind: 'InvalidPin', expectedDigits: 6 } });
      }
    });

    it("un PIN n'est fait que de chiffres : ni lettre, ni espace, ni signe, ni autre chose qu'un texte", () => {
      const others: unknown[] = ['48a9', ' 4829', '4829 ', '48 29', '-482', '4.29', '４８２９', '', 4829, null, undefined, ['4', '8', '2', '9']];

      for (const raw of others) {
        expect(Pin(raw, 'collaborator')).toEqual({ ok: false, error: { kind: 'InvalidPin', expectedDigits: 4 } });
      }
    });

    it("un rôle que la règle ne connaît pas n'a pas de PIN valide", () => {
      expect(Pin('4829', 'investor' as 'admin').ok).toBe(false);
      expect(Pin('482913', 'investor' as 'admin').ok).toBe(false);
    });
  });

  describe('un PIN trop simple est refusé', () => {
    it("un seul chiffre répété n'est pas un PIN", () => {
      for (const [raw, role] of [['0000', 'collaborator'], ['7777', 'collaborator'], ['111111', 'admin'], ['999999', 'admin']] as const) {
        expect(Pin(raw, role)).toEqual({ ok: false, error: { kind: 'TrivialPin' } });
      }
    });

    it("des chiffres qui se suivent, dans un sens ou dans l'autre, ne sont pas un PIN", () => {
      for (const [raw, role] of [['1234', 'collaborator'], ['0123', 'collaborator'], ['6789', 'collaborator'], ['4321', 'collaborator'], ['9876', 'collaborator'], ['123456', 'admin'], ['012345', 'admin'], ['654321', 'admin']] as const) {
        expect(Pin(raw, role)).toEqual({ ok: false, error: { kind: 'TrivialPin' } });
      }
    });

    it("un PIN qui n'est ni répété ni une suite reste accepté, même s'il a des chiffres en commun", () => {
      for (const [raw, role] of [['1235', 'collaborator'], ['1122', 'collaborator'], ['1212', 'collaborator'], ['4829', 'collaborator'], ['135790', 'admin'], ['112233', 'admin'], ['123450', 'admin']] as const) {
        expect(Pin(raw, role).ok).toBe(true);
      }
    });

    it("un refus pour PIN trop simple ne répète pas ce qui a été tapé", () => {
      expect(JSON.stringify(Pin('1234', 'collaborator'))).not.toContain('1234');
    });
  });

  describe('le PIN ne sort jamais', () => {
    // Built inside each test: a broken rule fails a named test instead of the whole file.
    const unPinDeGardien = (): Pin => unwrap(Pin('4829', 'collaborator'));

    it("un PIN ne s'écrit ni dans un texte, ni dans un JSON, ni dans un journal", () => {
      const pin = unPinDeGardien();
      const written = [String(pin), `${pin}`, JSON.stringify({ pin }), JSON.stringify(pin), inspect(pin), inspect({ pin }, { depth: 5, showHidden: true })];

      for (const text of written) {
        expect(text).not.toContain('4829');
      }
    });

    it("une erreur levée avec un PIN ne le contient pas", () => {
      expect(new Error(`échec pour ${unPinDeGardien()}`).message).not.toContain('4829');
    });

    it("un refus ne répète pas ce qui a été tapé", () => {
      expect(JSON.stringify(Pin('48291', 'collaborator'))).not.toContain('48291');
    });

    it('seul celui qui le demande explicitement lit ses chiffres', () => {
      expect(unPinDeGardien().reveal()).toBe('4829');
    });
  });
});
