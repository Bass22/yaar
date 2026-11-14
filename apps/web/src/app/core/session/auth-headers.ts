import { HttpHeaders } from '@angular/common/http';
import type { SessionState } from './session-store';

/** The session's token on a request, when there is a session; none otherwise — the server refuses (fail-closed). */
export function authHeaders(session: SessionState): HttpHeaders {
  return new HttpHeaders(session.status === 'none' ? {} : { Authorization: `Bearer ${session.token}` });
}
