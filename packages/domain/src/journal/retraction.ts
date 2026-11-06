import { err, type Result } from '@kit';
import { isCounterDeclaration, isRetraction, type JournalEvent, type Retraction } from './journal-event';
import type { Refusal } from './refusal';
import { validateDeclaration, type DeclarationContext } from './validate-declaration';

export type RetractionContext = DeclarationContext & {
  /** The event the retraction names. */
  readonly retracted: JournalEvent;
  /** Whether the journal already holds a retraction of that event. */
  readonly alreadyRetracted: boolean;
};

/**
 * Refuses a retraction that does not take back one declaration of its own notebook and day,
 * or that comes after another one: a retraction is final. What the campaign takes (the day,
 * the closing) is judged like any declaration. Who may retract is the policy's business.
 */
export const validateRetraction = (retraction: Retraction, context: RetractionContext): Result<Retraction, Refusal> => {
  const { retracted, alreadyRetracted } = context;
  if (retracted.id !== retraction.retracts) {
    throw new TypeError('A retraction is judged against the event it names.');
  }
  if (retraction.id === retraction.retracts) {
    return err({ kind: 'CorrectsItself' });
  }
  if (isCounterDeclaration(retracted) || isRetraction(retracted)) {
    return err({ kind: 'CorrectsACounterDeclaration' });
  }
  if (
    retracted.tenantId !== retraction.tenantId ||
    retracted.siteId !== retraction.siteId ||
    retracted.campaignId !== retraction.campaignId
  ) {
    return err({ kind: 'CorrectsEventElsewhere' });
  }
  if (retracted.businessDate !== retraction.businessDate) {
    return err({ kind: 'CorrectionChangesBusinessDate' });
  }
  if (alreadyRetracted) {
    return err({ kind: 'DeclarationRetracted' });
  }
  return validateDeclaration(retraction, context);
};
