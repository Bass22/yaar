import { Injectable } from '@angular/core';
import type { SessionRole, SignInResponse } from '@contracts';

/** What the phone knows of who uses it. An expired session still says who: the notebook stays open offline. */
export type SessionState =
  | { readonly status: 'none' }
  | { readonly status: 'active' | 'expired'; readonly userId: string; readonly role: SessionRole; readonly token: string; readonly expiresAt: string };

const SESSION_KEY = 'yaar.session';
const DEVICE_KEY = 'yaar.device';

/**
 * The session kept on the phone (decision of 2026-11-07: held by the application, sent in the
 * `Authorization` header, no cookie), so that it survives closing the application. The phone
 * never checks the token: it reads who it names, the server is the authority.
 */
@Injectable({ providedIn: 'root', useFactory: () => new SessionStore(globalThis.localStorage, () => new Date()) })
export class SessionStore {
  constructor(
    private readonly storage: Storage,
    private readonly now: () => Date,
  ) {}

  current(): SessionState {
    const saved = readJson(this.storage.getItem(SESSION_KEY));
    const userId = saved === null ? null : subjectOf(saved['token']);
    if (saved === null || userId === null || (saved['role'] !== 'admin' && saved['role'] !== 'collaborator') || typeof saved['expiresAt'] !== 'string') {
      return { status: 'none' };
    }
    const expiresAt = saved['expiresAt'];
    const status = Date.parse(expiresAt) > this.now().getTime() ? 'active' : 'expired';
    return { status, userId, role: saved['role'], token: saved['token'] as string, expiresAt };
  }

  save(session: SignInResponse): void {
    this.storage.setItem(SESSION_KEY, JSON.stringify({ token: session.token, expiresAt: session.expiresAt, role: session.role }));
  }

  clear(): void {
    this.storage.removeItem(SESSION_KEY);
  }

  /** The identifier of this device: made on the phone once, then kept. */
  deviceId(): string {
    const known = this.storage.getItem(DEVICE_KEY);
    if (known !== null) {
      return known;
    }
    const made = crypto.randomUUID();
    this.storage.setItem(DEVICE_KEY, made);
    return made;
  }
}

function readJson(raw: string | null): Record<string, unknown> | null {
  try {
    const value: unknown = raw === null ? null : JSON.parse(raw);
    return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

// The `sub` claim of a token, read without checking it: the phone only needs to know whose it is.
function subjectOf(token: unknown): string | null {
  if (typeof token !== 'string') {
    return null;
  }
  try {
    const payload = token.split('.')[1] ?? '';
    const claims = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as { sub?: unknown };
    return typeof claims.sub === 'string' ? claims.sub : null;
  } catch {
    return null;
  }
}
