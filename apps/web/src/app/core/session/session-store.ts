import { Injectable } from '@angular/core';
import type { AccountAvatar, AudioLanguage, SessionAccount, SessionRole, SignInResponse } from '@contracts';

/** What the phone knows of who uses it. An expired session still says who: the notebook stays open offline. */
export type SessionState =
  | { readonly status: 'none' }
  | { readonly status: 'active' | 'expired'; readonly userId: string; readonly role: SessionRole; readonly token: string; readonly expiresAt: string; readonly account: SessionAccount };

/** The account of this phone — one phone, one person (decision of 2026-11-08): its number is kept, only the code is asked (G.2, E.9). */
export type KnownAccount = {
  readonly userId: string;
  readonly phone: string;
  readonly role: SessionRole;
  readonly name: string;
  readonly avatar: AccountAvatar | null;
  /** The voice of the entry screen for this account (I.2); absent for an account remembered before. */
  readonly language?: AudioLanguage;
};

const SESSION_KEY = 'yaar.session';
const DEVICE_KEY = 'yaar.device';
const ACCOUNT_KEY = 'yaar.account';
const UNKNOWN_ACCOUNT: SessionAccount = { name: '', avatar: null, language: 'fr' };

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
    const account = (saved['account'] as SessionAccount | undefined) ?? UNKNOWN_ACCOUNT;
    return { status, userId, role: saved['role'], token: saved['token'] as string, expiresAt, account };
  }

  /** Keeps the session, and the account of this phone. */
  save(session: SignInResponse, phone: string): void {
    this.storage.setItem(SESSION_KEY, JSON.stringify({ token: session.token, expiresAt: session.expiresAt, role: session.role, account: session.account }));
    const userId = subjectOf(session.token);
    if (userId !== null) {
      const known: KnownAccount = { userId, phone, role: session.role, name: session.account.name, avatar: session.account.avatar, language: session.account.language };
      this.storage.setItem(ACCOUNT_KEY, JSON.stringify(known));
    }
  }

  /** The account of this phone, kept after a sign-out; none before the first sign-in. */
  knownAccount(): KnownAccount | null {
    const account = readJson(this.storage.getItem(ACCOUNT_KEY));
    return account !== null && typeof account['userId'] === 'string' && typeof account['phone'] === 'string' ? (account as KnownAccount) : null;
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
  return claimOf(token, 'sub');
}

/** The farm a token names, read without checking it (the server is the authority): the notebook's events carry it. */
export function tenantOf(token: string): string | null {
  return claimOf(token, 'tenant');
}

function claimOf(token: unknown, claim: 'sub' | 'tenant'): string | null {
  if (typeof token !== 'string') {
    return null;
  }
  try {
    const payload = token.split('.')[1] ?? '';
    const claims = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as Record<string, unknown>;
    const value = claims[claim];
    return typeof value === 'string' ? value : null;
  } catch {
    return null;
  }
}
