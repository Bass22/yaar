import type { ReadStream } from 'node:tty';

/**
 * Reads one secret line: from a terminal without echoing it, otherwise the first line piped
 * in. A secret never goes on a command line, where every process of the machine can read it.
 */
export function readSecretLine(input: NodeJS.ReadStream & Partial<ReadStream>, prompt: NodeJS.WritableStream): Promise<string> {
  return new Promise((resolve, reject) => {
    let line = '';
    const terminal = input.isTTY === true && typeof input.setRawMode === 'function';
    const finish = (): void => {
      input.off('data', onData);
      input.off('error', reject);
      if (terminal) {
        input.setRawMode?.(false);
        prompt.write('\n');
      }
      input.pause();
      resolve(line);
    };
    const onData = (chunk: Buffer | string): void => {
      for (const char of chunk.toString('utf8')) {
        if (char === '\n' || char === '\r') {
          finish();
          return;
        }
        if (terminal && char === '\u0003') {
          finish();
          return;
        }
        line += char;
      }
    };
    if (terminal) {
      input.setRawMode?.(true);
    }
    input.on('data', onData);
    input.once('error', reject);
    input.once('end', finish);
    input.resume();
  });
}
