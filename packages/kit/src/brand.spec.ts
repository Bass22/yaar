import { describe, expect, it } from 'vitest';
import type { Brand } from './brand';

// Spec: CLAUDE.md §8 — un état invalide n'est pas représentable.
// Les refus à la compilation (`@ts-expect-error`) sont vérifiés par `npx nx typecheck kit`.

type Apple = Brand<string, 'Apple'>;
type Pear = Brand<string, 'Pear'>;

const apple = 'granny' as Apple;
const pear = 'williams' as Pear;
const eatApple = (fruit: Apple): string => fruit;

describe('Marque de type', () => {
  it('deux marques posées sur le même type ne sont pas interchangeables', () => {
    // Then
    expect(eatApple(apple)).toBe('granny');
    // @ts-expect-error une poire n'est pas une pomme
    eatApple(pear);
  });

  it('une valeur sans marque ne passe pas pour une valeur marquée', () => {
    // @ts-expect-error une chaîne quelconque n'est pas une pomme
    eatApple('granny');
  });

  it("une valeur marquée reste utilisable comme son type d'origine", () => {
    // When
    const label: string = apple;

    // Then
    expect(label.toUpperCase()).toBe('GRANNY');
  });
});
