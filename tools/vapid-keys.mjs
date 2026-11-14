// The key pair of the notifications (Y.1): VAPID, P-256, in base64url as browsers want it.
// Run once per instance, and paste both lines into infra/.env:
//   node tools/vapid-keys.mjs
// The public key goes to the API (browsers subscribe with it); the private one signs what the
// server sends and never leaves the server's environment. Changing the pair unsubscribes every device.
import { generateKeyPairSync } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export function vapidKeys() {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const { x, y, d } = privateKey.export({ format: 'jwk' });
  const point = Buffer.concat([Buffer.from([0x04]), Buffer.from(x, 'base64url'), Buffer.from(y, 'base64url')]);
  return { publicKey: point.toString('base64url'), privateKey: d };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { publicKey, privateKey } = vapidKeys();
  process.stdout.write(`VAPID_PUBLIC_KEY=${publicKey}\nVAPID_PRIVATE_KEY=${privateKey}\n`);
}
