import { describe, expect, it } from 'vitest';
import { MediaFingerprint } from './media-fingerprint';

// Spec: Architecture §5 « Médias hors-ligne » — l'événement référence le média par empreinte ;
// backlog M.1 — un fichier est adressé par son empreinte SHA-256.
// Les refus à la compilation (`@ts-expect-error`) sont vérifiés par `npx nx typecheck domain`.

const A_FINGERPRINT = '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08';

describe("Empreinte d'un média", () => {
  it('une empreinte est un SHA-256 en hexadécimal : 64 caractères', () => {
    expect(MediaFingerprint(A_FINGERPRINT)).toEqual({ ok: true, value: A_FINGERPRINT });
  });

  it("une même empreinte n'a qu'une écriture : les majuscules sont refusées", () => {
    expect(MediaFingerprint(A_FINGERPRINT.toUpperCase())).toEqual({
      ok: false,
      error: { kind: 'InvalidMediaFingerprint' },
    });
  });

  it("ce qui n'est pas une empreinte est refusé", () => {
    const others: unknown[] = [
      '',
      A_FINGERPRINT.slice(1),
      `${A_FINGERPRINT}0`,
      `${A_FINGERPRINT}\n`,
      `sha256:${A_FINGERPRINT}`,
      'g'.repeat(64),
      'photo.jpg',
      42,
      null,
    ];

    for (const raw of others) {
      expect(MediaFingerprint(raw)).toEqual({ ok: false, error: { kind: 'InvalidMediaFingerprint' } });
    }
  });

  it("un texte non vérifié ne passe pas pour une empreinte", () => {
    const attach = (media: MediaFingerprint): string => media;

    // @ts-expect-error un texte quelconque n'est pas une empreinte vérifiée
    attach(A_FINGERPRINT);
    expect(attach).toBeTypeOf('function');
  });
});
