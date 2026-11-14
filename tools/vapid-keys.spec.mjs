import assert from 'node:assert/strict';
import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { describe, it } from 'node:test';
import { vapidKeys } from './vapid-keys.mjs';

// Spec: backlog Y.1 — la paire de clés des notifications (VAPID) : P-256, en base64url, comme
// les navigateurs l'attendent ; l'API refuse une clé publique d'une autre forme.

describe('Les clés des notifications', () => {
  it('une paire P-256 : la clé publique non compressée (65 octets) et la privée (32), en base64url sans remplissage', () => {
    const { publicKey, privateKey } = vapidKeys();
    assert.match(publicKey, /^B[A-Za-z0-9_-]{86}$/);
    assert.match(privateKey, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(Buffer.from(publicKey, 'base64url')[0], 0x04);
  });

  it('les deux clés vont ensemble : ce que la privée signe, la publique le vérifie', () => {
    const { publicKey, privateKey } = vapidKeys();
    const point = Buffer.from(publicKey, 'base64url');
    const x = point.subarray(1, 33).toString('base64url');
    const y = point.subarray(33).toString('base64url');
    const signature = sign('sha256', Buffer.from('yaar'), createPrivateKey({ key: { kty: 'EC', crv: 'P-256', x, y, d: privateKey }, format: 'jwk' }));
    assert.ok(verify('sha256', Buffer.from('yaar'), createPublicKey({ key: { kty: 'EC', crv: 'P-256', x, y }, format: 'jwk' }), signature));
  });

  it('chaque appel tire une paire neuve', () => {
    assert.notEqual(vapidKeys().privateKey, vapidKeys().privateKey);
  });
});
