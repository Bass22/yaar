import { PassThrough } from 'node:stream';
import { readSecretLine } from './read-secret-line';

// Spec: backlog D.4 — le PIN ne passe jamais par la ligne de commande ; E.1 — il ne sort jamais.

describe('Lecture du PIN', () => {
  const unFlux = (): NodeJS.ReadStream & { isTTY?: boolean } => Object.assign(new PassThrough(), { isTTY: false }) as never;

  it("hors d'un terminal, le PIN est la première ligne reçue, sans la fin de ligne", async () => {
    const input = unFlux();
    const read = readSecretLine(input, process.stderr);
    input.end('482913\nreste ignoré\n');

    expect(await read).toBe('482913');
  });

  it("un flux qui se termine sans fin de ligne donne ce qui a été reçu", async () => {
    const input = unFlux();
    const read = readSecretLine(input, process.stderr);
    input.end('482913');

    expect(await read).toBe('482913');
  });

  it("une fin de ligne Windows est acceptée", async () => {
    const input = unFlux();
    const read = readSecretLine(input, process.stderr);
    input.end('482913\r\n');

    expect(await read).toBe('482913');
  });
});
