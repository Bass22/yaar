import { createDecipheriv, createECDH, createHmac, createPublicKey, verify } from 'node:crypto';
import { contentKeys, encryptForDevice, sendWebPush, vapidAuthorization } from './web-push';

// Spec: backlog Y.2a — l'envoi écrit maison (décision du fondateur du 2026-11-14) : le chiffrement
// pour l'appareil suit la RFC 8291 (aes128gcm, RFC 8188), la signature du serveur la RFC 8292 (VAPID).
// Les valeurs viennent de l'annexe A de la RFC 8291 : une étape fausse fait tomber le test.

const b64 = (value: string) => Buffer.from(value, 'base64url');
const RFC = {
  plaintext: 'V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24',
  asPublic: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  uaPrivate: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
  authSecret: 'BTBZMqHH6r4Tts7J_aSIgg',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  ecdhSecret: 'kyrL1jIIOHEzg3sM2ZWRHDRB62YACZhhSlknJ672kSs',
  prkKey: 'Snr3JMxaHVDXHWJn5wdC52WjpCtd2EIEGBykDcZW32k',
  ikm: 'S4lYMb_L0FxCeq0WhDx813KgSYqU26kOyzWUdsXYyrg',
  prk: '09_eUZGrsvxChDCGRCdkLiDXrReGOEVeSCdCcPBSJSc',
  cek: 'oIhVW04MRdy2XN9CiKLxTg',
  nonce: '4h_95klXJ5E_qnoN',
  header: 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
};

/** What the phone does on receipt (RFC 8291 §3.4, RFC 8188), written apart from the server's code. */
function decryptOnDevice(body: Buffer, uaPrivate: string, authSecret: string): string {
  const salt = body.subarray(0, 16);
  const idLength = body[20] as number;
  const asPublic = body.subarray(21, 21 + idLength);
  const record = body.subarray(21 + idLength);
  const ua = createECDH('prime256v1');
  ua.setPrivateKey(b64(uaPrivate));
  const hmac = (key: Buffer, data: Buffer) => createHmac('sha256', key).update(data).digest();
  const prkKey = hmac(b64(authSecret), ua.computeSecret(asPublic));
  const ikm = hmac(prkKey, Buffer.concat([Buffer.from('WebPush: info\0'), ua.getPublicKey(), asPublic, Buffer.from([1])]));
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01')).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01')).subarray(0, 12);
  const decipher = createDecipheriv('aes-128-gcm', cek, nonce);
  decipher.setAuthTag(record.subarray(record.length - 16));
  const padded = Buffer.concat([decipher.update(record.subarray(0, record.length - 16)), decipher.final()]);
  // The last record ends with its delimiter 0x02, then zeros of padding (RFC 8188 §2): anything else is refused.
  let end = padded.length - 1;
  while (end >= 0 && padded[end] === 0) end -= 1;
  if (padded[end] !== 2) throw new Error('not the last record');
  return padded.subarray(0, end).toString('utf8');
}

describe('Le chiffrement pour l’appareil (RFC 8291)', () => {
  it('chaque étape donne la valeur de l’annexe A : secret partagé, clés intermédiaires, clé de contenu, nonce', () => {
    const keys = contentKeys({ uaPublic: b64(RFC.uaPublic), authSecret: b64(RFC.authSecret), asPrivate: b64(RFC.asPrivate), salt: b64(RFC.salt) });

    expect(keys.ecdhSecret.toString('base64url')).toBe(RFC.ecdhSecret);
    expect(keys.prkKey.toString('base64url')).toBe(RFC.prkKey);
    expect(keys.ikm.toString('base64url')).toBe(RFC.ikm);
    expect(keys.prk.toString('base64url')).toBe(RFC.prk);
    expect(keys.cek.toString('base64url')).toBe(RFC.cek);
    expect(keys.nonce.toString('base64url')).toBe(RFC.nonce);
    expect(keys.asPublic.toString('base64url')).toBe(RFC.asPublic);
  });

  it('le message commence par l’en-tête de l’annexe A (sel, taille d’enregistrement 4096, clé du serveur), et l’appareil le déchiffre', () => {
    const body = encryptForDevice({ p256dh: RFC.uaPublic, auth: RFC.authSecret }, b64(RFC.plaintext), { asPrivate: b64(RFC.asPrivate), salt: b64(RFC.salt) });

    expect(body.subarray(0, 86).toString('base64url')).toBe(RFC.header);
    expect(decryptOnDevice(body, RFC.uaPrivate, RFC.authSecret)).toBe('When I grow up, I want to be a watermelon');
  });

  it('sans graine imposée, chaque envoi tire une clé et un sel neufs ; l’appareil déchiffre toujours', () => {
    const first = encryptForDevice({ p256dh: RFC.uaPublic, auth: RFC.authSecret }, Buffer.from('Une livraison est annoncée'));
    const second = encryptForDevice({ p256dh: RFC.uaPublic, auth: RFC.authSecret }, Buffer.from('Une livraison est annoncée'));

    expect(first.subarray(0, 16).equals(second.subarray(0, 16))).toBe(false);
    expect(first.subarray(21, 86).equals(second.subarray(21, 86))).toBe(false);
    expect(decryptOnDevice(second, RFC.uaPrivate, RFC.authSecret)).toBe('Une livraison est annoncée');
  });
});

describe('La signature du serveur (VAPID, RFC 8292)', () => {
  // A key pair of the test, P-256: the private scalar and its public point.
  const pair = createECDH('prime256v1');
  pair.generateKeys();
  const vapid = { publicKey: pair.getPublicKey().toString('base64url'), privateKey: pair.getPrivateKey().toString('base64url'), subject: 'mailto:contact@exemple.sn' };
  const now = new Date('2026-11-14T08:00:00.000Z');

  it('l’en-tête porte un jeton ES256 pour l’origine du service, valable 12 heures, et la clé publique ; la clé publique vérifie la signature', () => {
    const header = vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc123', vapid, now);
    const [, token, key] = /^vapid t=([^,]+), k=(.+)$/.exec(header) ?? [];
    expect(key).toBe(vapid.publicKey);
    const [head, claims, signature] = (token ?? '').split('.');

    expect(JSON.parse(b64(head ?? '').toString())).toEqual({ typ: 'JWT', alg: 'ES256' });
    expect(JSON.parse(b64(claims ?? '').toString())).toEqual({ aud: 'https://fcm.googleapis.com', exp: now.getTime() / 1000 + 12 * 3600, sub: 'mailto:contact@exemple.sn' });
    const point = pair.getPublicKey();
    const publicKey = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: point.subarray(1, 33).toString('base64url'), y: point.subarray(33).toString('base64url') }, format: 'jwk' });
    expect(verify('sha256', Buffer.from(`${head}.${claims}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, b64(signature ?? ''))).toBe(true);
  });

  describe('l’envoi et son sort', () => {
    const device = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc123', p256dh: RFC.uaPublic, auth: RFC.authSecret };
    const answering = (status: number) => {
      const calls: { url: string; init: RequestInit }[] = [];
      const fetcher = async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return new Response(null, { status });
      };
      return { calls, fetcher };
    };

    it('un POST chiffré vers l’adresse de l’appareil, avec la durée de vie (24 h), l’encodage et la signature ; 201 : remis', async () => {
      const { calls, fetcher } = answering(201);

      expect(await sendWebPush(device, { title: 'Une livraison est annoncée' }, vapid, now, fetcher)).toBe('Delivered');
      const [call] = calls;
      expect(call?.url).toBe(device.endpoint);
      expect(call?.init.method).toBe('POST');
      const headers = new Headers(call?.init.headers);
      expect([headers.get('TTL'), headers.get('Content-Encoding'), headers.get('Content-Type')]).toEqual(['86400', 'aes128gcm', 'application/octet-stream']);
      expect(headers.get('Authorization')).toMatch(/^vapid t=.+, k=.+$/);
      expect(JSON.parse(decryptOnDevice(Buffer.from(call?.init.body as Uint8Array), RFC.uaPrivate, RFC.authSecret))).toEqual({ title: 'Une livraison est annoncée' });
    });

    it('404 ou 410 : l’abonnement a disparu ; une autre réponse ou une panne réseau : échoué, sans exception', async () => {
      expect(await sendWebPush(device, {}, vapid, now, answering(410).fetcher)).toBe('Gone');
      expect(await sendWebPush(device, {}, vapid, now, answering(404).fetcher)).toBe('Gone');
      expect(await sendWebPush(device, {}, vapid, now, answering(500).fetcher)).toBe('Failed');
      expect(await sendWebPush(device, {}, vapid, now, async () => Promise.reject(new Error('réseau')))).toBe('Failed');
    });
  });
});
