import { inject } from '@angular/core';
import { Router, type CanMatchFn } from '@angular/router';
import { AuthService } from './auth';
import type { SessionState } from './session-store';

export type View = 'caretaker' | 'admin';

/**
 * Whether a view opens. The notebook opens to whoever the phone knows, even with an expired
 * session: the caretaker declares offline and the outbox waits for the next sign-in (CdC
 * « Identité »). The office, which shows money, needs a valid session and the admin role.
 * Comfort only: the server judges every request.
 */
export function mayEnter(view: View, session: SessionState): boolean {
  if (session.status === 'none') {
    return false;
  }
  return view === 'caretaker' || (session.status === 'active' && session.role === 'admin');
}

/** Where the application opens. */
export function homeOf(session: SessionState): string {
  if (session.status !== 'none' && session.role === 'admin') {
    return mayEnter('admin', session) ? '/admin' : '/sign-in';
  }
  return mayEnter('caretaker', session) ? '/caretaker' : '/sign-in';
}

export const canEnter =
  (view: View): CanMatchFn =>
  () => {
    const session = inject(AuthService).session();
    return mayEnter(view, session) || inject(Router).parseUrl('/sign-in');
  };

export const toHome: CanMatchFn = () => inject(Router).parseUrl(homeOf(inject(AuthService).session()));
