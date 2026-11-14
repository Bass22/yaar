import { HttpErrorResponse, type HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { tap } from 'rxjs';
import { AuthService } from './auth';

/**
 * A session the server refuses — account blocked, tokens invalidated, secret changed — is closed,
 * and the sign-in comes back (fix of 2026-11-13): never read as « no network ». The account's
 * number and the outbox stay on the phone. The sign-in's own refusals are its screen's to say.
 */
export const sessionRefused: HttpInterceptorFn = (request, next) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return next(request).pipe(
    tap({
      error: (error: unknown) => {
        if (!(error instanceof HttpErrorResponse) || error.status !== 401) return;
        if (!request.url.startsWith('/api/v1/') || request.url.startsWith('/api/v1/auth/')) return;
        auth.signOut();
        void router.navigate(['/sign-in']);
      },
    }),
  );
};
