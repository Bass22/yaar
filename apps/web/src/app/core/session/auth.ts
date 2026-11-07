import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { ChoosePinRefusal, SignInRefusal, SignInResponse } from '@contracts';
import { homeOf } from './guards';
import { SessionStore, type KnownAccount, type SessionState } from './session-store';

/** Why the phone could not open a session: the server's reason, or no network. */
export type SignInFailure = SignInRefusal | ChoosePinRefusal | { readonly kind: 'Offline' } | { readonly kind: 'ServerUnavailable' };
export type SignInResult = { readonly ok: true; readonly home: string } | { readonly ok: false; readonly refusal: SignInFailure };

/** Opens and closes the session of the phone (E.2, E.5). */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly store = inject(SessionStore);
  private readonly state = signal<SessionState>(this.store.current());
  readonly session = this.state.asReadonly();

  signIn(phone: string, pin: string): Promise<SignInResult> {
    return this.open('/api/v1/auth/sign-in', phone, { phone, pin, deviceId: this.store.deviceId() });
  }

  /** The account of this phone: its number is kept, only the code is asked. */
  knownAccount(): KnownAccount | null {
    return this.store.knownAccount();
  }

  /** First sign-in: the provisional PIN the admin gave, and one's own, in one step. */
  choosePin(phone: string, provisionalPin: string, newPin: string): Promise<SignInResult> {
    return this.open('/api/v1/auth/choose-pin', phone, { phone, provisionalPin, newPin, deviceId: this.store.deviceId() });
  }

  /** Forgets the session. What the outbox holds stays on the phone (decision of 2026-11-07). */
  signOut(): void {
    this.store.clear();
    this.refresh();
  }

  /** Reads the session again: it expires with time, or the server said it no longer holds. */
  refresh(): void {
    this.state.set(this.store.current());
  }

  private async open(url: string, phone: string, body: object): Promise<SignInResult> {
    try {
      const session = await firstValueFrom(this.http.post<SignInResponse>(url, body));
      this.store.save(session, phone);
      this.refresh();
      return { ok: true, home: homeOf(this.session()) };
    } catch (error) {
      return { ok: false, refusal: refusalOf(error) };
    }
  }
}

function refusalOf(error: unknown): SignInFailure {
  if (!(error instanceof HttpErrorResponse) || error.status === 0) {
    return { kind: 'Offline' };
  }
  const body: unknown = error.error;
  if (typeof body === 'object' && body !== null && typeof (body as { kind?: unknown }).kind === 'string') {
    return body as SignInRefusal | ChoosePinRefusal;
  }
  return error.status === 400 ? { kind: 'InvalidRequest' } : { kind: 'ServerUnavailable' };
}
