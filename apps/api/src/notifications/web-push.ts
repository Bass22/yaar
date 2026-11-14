import { createCipheriv, createECDH, createHmac, createPrivateKey, randomBytes, sign } from 'node:crypto';

// Sending a notification by hand (Y.2a, founder's decision of 2026-11-14): no dependency, Node's
// cryptography only. The message is encrypted for the device (RFC 8291, aes128gcm of RFC 8188)
// and the server signs its request (VAPID, RFC 8292). Checked against RFC 8291 Appendix A.

const RECORD_SIZE = 4096;
/** The push service keeps a message 24 hours for a phone out of the network, then drops it. */
const TIME_TO_LIVE_SECONDS = 24 * 3600;
const TOKEN_LIFETIME_SECONDS = 12 * 3600;
const TIMEOUT_MS = 10_000;

export type PushOutcome = 'Delivered' | 'Gone' | 'Failed';
export type VapidKeys = { readonly publicKey: string; readonly privateKey: string; readonly subject: string };
export type DeviceSubscription = { readonly endpoint: string; readonly p256dh: string; readonly auth: string };
type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

const hmac = (key: Buffer, data: Buffer): Buffer => createHmac('sha256', key).update(data).digest();

/** The keys of one message (RFC 8291 §3.3, §3.4): every intermediate value, for the test against the RFC. */
export function contentKeys(input: { readonly uaPublic: Buffer; readonly authSecret: Buffer; readonly asPrivate: Buffer; readonly salt: Buffer }) {
  const server = createECDH('prime256v1');
  server.setPrivateKey(input.asPrivate);
  const asPublic = server.getPublicKey();
  const ecdhSecret = server.computeSecret(input.uaPublic);
  const prkKey = hmac(input.authSecret, ecdhSecret);
  const ikm = hmac(prkKey, Buffer.concat([Buffer.from('WebPush: info\0'), input.uaPublic, asPublic, Buffer.from([1])]));
  const prk = hmac(input.salt, ikm);
  const cek = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01')).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01')).subarray(0, 12);
  return { asPublic, ecdhSecret, prkKey, ikm, prk, cek, nonce };
}

/**
 * The body for one device: salt, record size, the server's one-time public key, then one record
 * (the message, the 0x02 of the last record) under AES-128-GCM. `seed` fixes the one-time key
 * and the salt for the test; otherwise both are drawn anew for each message.
 */
export function encryptForDevice(keys: { readonly p256dh: string; readonly auth: string }, plaintext: Buffer, seed?: { readonly asPrivate: Buffer; readonly salt: Buffer }): Buffer {
  const salt = seed?.salt ?? randomBytes(16);
  const asPrivate = seed?.asPrivate ?? oneTimeKey();
  const { asPublic, cek, nonce } = contentKeys({ uaPublic: Buffer.from(keys.p256dh, 'base64url'), authSecret: Buffer.from(keys.auth, 'base64url'), asPrivate, salt });
  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  const record = Buffer.concat([cipher.update(Buffer.concat([plaintext, Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const size = Buffer.alloc(4);
  size.writeUInt32BE(RECORD_SIZE);
  return Buffer.concat([salt, size, Buffer.from([asPublic.length]), asPublic, record]);
}

function oneTimeKey(): Buffer {
  const key = createECDH('prime256v1');
  key.generateKeys();
  return key.getPrivateKey();
}

/** `vapid t=…, k=…`: a JWT signed ES256 for the origin of the push service, and the server's public key. */
export function vapidAuthorization(endpoint: string, vapid: VapidKeys, now: Date): string {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned = `${encode({ typ: 'JWT', alg: 'ES256' })}.${encode({ aud: new URL(endpoint).origin, exp: Math.floor(now.getTime() / 1000) + TOKEN_LIFETIME_SECONDS, sub: vapid.subject })}`;
  const point = Buffer.from(vapid.publicKey, 'base64url');
  const key = createPrivateKey({ key: { kty: 'EC', crv: 'P-256', x: point.subarray(1, 33).toString('base64url'), y: point.subarray(33).toString('base64url'), d: vapid.privateKey }, format: 'jwk' });
  const signature = sign('sha256', Buffer.from(unsigned), { key, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${unsigned}.${signature.toString('base64url')}, k=${vapid.publicKey}`;
}

/** One message to one device. Never throws: the push only speeds things up, the card is the truth. */
export async function sendWebPush(device: DeviceSubscription, payload: object, vapid: VapidKeys, now: Date, fetcher: Fetcher = fetch): Promise<PushOutcome> {
  try {
    const body = encryptForDevice(device, Buffer.from(JSON.stringify(payload)));
    const response = await fetcher(device.endpoint, {
      method: 'POST',
      headers: { TTL: String(TIME_TO_LIVE_SECONDS), 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', Authorization: vapidAuthorization(device.endpoint, vapid, now) },
      body: new Uint8Array(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (response.status === 404 || response.status === 410) return 'Gone';
    return response.ok ? 'Delivered' : 'Failed';
  } catch {
    return 'Failed';
  }
}
