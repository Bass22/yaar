import { err, type Result } from '@kit';
import type { JournalEventId } from './ids';
import {
  factOf,
  isCounterDeclaration,
  isRetraction,
  type CounterDeclaration,
  type Declaration,
  type Fact,
  type JournalEvent,
  type Retraction,
} from './journal-event';
import type { Refusal } from './refusal';
import { validateDeclaration, type DeclarationContext } from './validate-declaration';

export type CounterDeclarationContext = DeclarationContext & {
  /** The event the counter-declaration names. */
  readonly corrected: JournalEvent;
  /** Whether the journal holds a retraction of that event: a retracted declaration is no longer corrected. */
  readonly correctedIsRetracted: boolean;
};

/**
 * Refuses a counter-declaration that does more than correct the measured values: it stays in
 * the notebook, on the day, with the type and about the same thing as the declaration it
 * names. What the campaign takes (the caretaker's three days, the closing) is judged like any
 * declaration, at the instant the correction was written.
 */
export const validateCounterDeclaration = (
  counter: CounterDeclaration,
  context: CounterDeclarationContext,
): Result<CounterDeclaration, Refusal> => {
  const { corrected, correctedIsRetracted } = context;
  if (corrected.id !== counter.corrects) {
    throw new TypeError('A counter-declaration is judged against the event it names.');
  }
  if (counter.id === counter.corrects) {
    return err({ kind: 'CorrectsItself' });
  }
  if (isCounterDeclaration(corrected) || isRetraction(corrected)) {
    return err({ kind: 'CorrectsACounterDeclaration' });
  }
  if (
    corrected.tenantId !== counter.tenantId ||
    corrected.siteId !== counter.siteId ||
    corrected.campaignId !== counter.campaignId
  ) {
    return err({ kind: 'CorrectsEventElsewhere' });
  }
  if (corrected.businessDate !== counter.businessDate) {
    return err({ kind: 'CorrectionChangesBusinessDate' });
  }
  if (counter.type !== corrected.type) {
    return err({ kind: 'CorrectionChangesType' });
  }
  if (referenceOf(counter) !== referenceOf(corrected)) {
    return err({ kind: 'CorrectionChangesReference' });
  }
  if (correctedIsRetracted) {
    return err({ kind: 'DeclarationRetracted' });
  }
  return validateDeclaration(counter, context);
};

// What a fact is about, as opposed to what was measured. A media is its own reference:
// images are never erased, so a photo is not swapped for another.
function referenceOf(fact: Fact): string | null {
  switch (fact.type) {
    case 'Delivery':
      return fact.orderLineId;
    case 'Weighing':
      return fact.weighingRequestId;
    case 'WeighingValidated':
      return fact.weighingId;
    case 'TaskDone':
      return fact.taskId;
    case 'VoiceMessage':
    case 'Photo':
      return fact.media;
    case 'Loss':
      return fact.lossType;
    case 'Death':
    case 'BagOpened':
    case 'NoLoss':
      return null;
  }
}

type WrittenLine = {
  /** As it was written: its author and its recording instant never change. */
  readonly declaration: Declaration;
  /** The last counter-declaration written, `null` when the declaration was never corrected. */
  readonly correction: CounterDeclaration | null;
};

/** A declaration and what it counts for today: a fact, or nothing once it was taken back. */
export type JournalLine = WrittenLine &
  (
    | { readonly retraction: null; /** The declared fact, or the corrected one. */ readonly fact: Fact }
    | { readonly retraction: Retraction; readonly fact: null }
  );

/**
 * Reads the journal as it stands: one line per declaration, with the last counter-declaration
 * written for it — "last" by the recording instant, the clock of the author — and its
 * retraction if it was taken back. A retraction wins over any correction and reads no clock.
 * The result does not depend on the order the events arrived in, nor on how many times each
 * was received. Under one identifier only the first event received counts, as at ingestion.
 * A counter-declaration or a retraction whose declaration is not in the journal gives no line.
 */
export const effectiveJournal = (events: readonly JournalEvent[]): JournalLine[] => {
  const received = new Set<JournalEventId>();
  const declarations: Declaration[] = [];
  const corrections = new Map<JournalEventId, CounterDeclaration>();
  const retractions = new Map<JournalEventId, Retraction>();
  for (const event of events) {
    if (received.has(event.id)) {
      continue;
    }
    received.add(event.id);
    if (isRetraction(event)) {
      // Taken back twice, a declaration keeps the first retraction written.
      const current = retractions.get(event.retracts);
      if (current === undefined || inWritingOrder(event, current) < 0) {
        retractions.set(event.retracts, event);
      }
    } else if (isCounterDeclaration(event)) {
      const current = corrections.get(event.corrects);
      if (current === undefined || inWritingOrder(current, event) < 0) {
        corrections.set(event.corrects, event);
      }
    } else {
      declarations.push(event);
    }
  }
  return declarations.sort(inWritingOrder).map((declaration): JournalLine => {
    const correction = corrections.get(declaration.id) ?? null;
    const retraction = retractions.get(declaration.id) ?? null;
    return retraction === null
      ? { declaration, correction, retraction, fact: factOf(correction ?? declaration) }
      : { declaration, correction, retraction, fact: null };
  });
};

// By recording instant, then by identifier so that two events written at the same instant
// always come in the same order. Instants and identifiers compare as texts.
function inWritingOrder(left: JournalEvent, right: JournalEvent): number {
  if (left.recordedAt !== right.recordedAt) {
    return left.recordedAt < right.recordedAt ? -1 : 1;
  }
  return left.id === right.id ? 0 : left.id < right.id ? -1 : 1;
}
