import type { JournalEventOutcome, JournalEventPayload } from '@contracts';
import type { Outbox } from '../outbox/outbox';
import type { SessionState } from '../session/session-store';

/** At most what the server takes in one request (MAX_EVENTS_PER_BATCH on the API). */
export const BATCH_SIZE = 100;

/** What sending a batch gave: the fate of each event, a server that refused the session, or no answer. */
export type SyncAnswer =
  | { readonly kind: 'outcomes'; readonly outcomes: readonly JournalEventOutcome[] }
  | { readonly kind: 'unauthorized' }
  | { readonly kind: 'unreachable' };

export type SyncTransport = (events: readonly JournalEventPayload[], token: string) => Promise<SyncAnswer>;

/** Why a synchronisation stopped before the end: nothing is lost, it resumes later. */
export type SyncStop = 'Offline' | 'NoSession' | 'SessionExpired' | 'SessionRevoked';

export type SyncReport = { readonly sent: number; readonly refused: number; readonly stopped: SyncStop | null };

/**
 * Sends what the account of the session left in the outbox, in the order of creation, by
 * batches the server accepts (Architecture §5). An event is marked in doubt before it leaves:
 * without an answer it stays so, leaves again identical, and the server counts it once. An
 * accepted event or a duplicate is sent; a refused one is kept with its reason and never sent
 * again — no endless retry. Only the author's own events leave (decision of 2026-11-07).
 */
export async function synchronize(outbox: Outbox, session: SessionState, transport: SyncTransport, now: number): Promise<SyncReport> {
  if (session.status === 'none') {
    return { sent: 0, refused: 0, stopped: 'NoSession' };
  }
  if (session.status === 'expired') {
    return { sent: 0, refused: 0, stopped: 'SessionExpired' };
  }
  let sent = 0;
  let refused = 0;
  for (;;) {
    const batch = (await outbox.toSend(session.userId)).slice(0, BATCH_SIZE);
    if (batch.length === 0) {
      return { sent, refused, stopped: null };
    }
    await outbox.markInDoubt(batch.map((entry) => entry.id));
    const answer = await transport(batch.map((entry) => entry.payload), session.token);
    if (answer.kind === 'unreachable') {
      return { sent, refused, stopped: 'Offline' };
    }
    if (answer.kind === 'unauthorized') {
      // Refused before its own deadline: the account was blocked, or signed out everywhere.
      return { sent, refused, stopped: Date.parse(session.expiresAt) > now ? 'SessionRevoked' : 'SessionExpired' };
    }
    const settled = new Set<string>();
    for (const outcome of answer.outcomes) {
      const entry = batch[outcome.index];
      if (entry === undefined) {
        continue;
      }
      settled.add(entry.id);
      if (outcome.status === 'Refused') {
        await outbox.markRefused(entry.id, outcome.refusal);
        refused += 1;
      } else {
        await outbox.markSent([entry.id], new Date(now));
        sent += 1;
      }
    }
    if (settled.size < batch.length) {
      // An answer that leaves an event out: it stays in doubt and leaves at the next synchronisation.
      return { sent, refused, stopped: null };
    }
  }
}
