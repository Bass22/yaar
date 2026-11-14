import { err, ok, type Result } from '@kit';
import type { Prisma } from '@prisma/client';
import type { PushSubscriptionRefusal, SubscribeToPushRequest } from '@contracts';
import type { Session } from '../auth/session';

// The push services of the browsers (Y.1): the server will write to these hosts only, never to an
// address a phone made up. Chrome and Android: Google; Firefox: Mozilla; Safari: Apple; Edge: Microsoft.
const EXACT_HOSTS = new Set(['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com']);
const HOST_SUFFIXES = ['.notify.windows.com', '.push.apple.com'];
// The device's P-256 public key (65 bytes) and its 16-byte secret, in base64url without padding.
const P256DH = /^B[A-Za-z0-9_-]{86}$/;
const AUTH = /^[A-Za-z0-9_-]{22}$/;
const LONGEST_ENDPOINT = 2048;

export function knownPushService(endpoint: string): boolean {
  if (endpoint.length > LONGEST_ENDPOINT) return false;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  const host = url.hostname;
  return url.protocol === 'https:' && url.port === '' && url.username === '' && url.password === '' && (EXACT_HOSTS.has(host) || HOST_SUFFIXES.some((suffix) => host.endsWith(suffix)));
}

/** The device signed in subscribes, to the person signed in on it: one subscription per device, replaced. */
export async function subscribeToPush(tx: Prisma.TransactionClient, session: Session, request: SubscribeToPushRequest): Promise<Result<void, PushSubscriptionRefusal>> {
  if (!knownPushService(request.endpoint)) return err({ kind: 'UnknownPushService' });
  if (!P256DH.test(request.keys.p256dh) || !AUTH.test(request.keys.auth)) return err({ kind: 'InvalidSubscription' });
  const values = { userId: session.userId, endpoint: request.endpoint, p256dh: request.keys.p256dh, auth: request.keys.auth };
  await tx.pushSubscription.upsert({
    where: { tenantId_deviceId: { tenantId: session.tenantId, deviceId: session.deviceId } },
    create: { tenantId: session.tenantId, deviceId: session.deviceId, ...values },
    update: values,
  });
  return ok(undefined);
}

/** The device signs out: its subscription goes, the others of the person stay. */
export async function unsubscribeDevice(tx: Prisma.TransactionClient, session: Session): Promise<void> {
  await tx.pushSubscription.deleteMany({ where: { deviceId: session.deviceId } });
}

/** A blocked or signed-out account receives nothing more, on any device. */
export async function unsubscribeAccount(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  await tx.pushSubscription.deleteMany({ where: { userId } });
}
