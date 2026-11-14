import { err, ok, type Result } from '@kit';
import { effectiveJournal } from './counter-declaration';
import { campaignDay, type BusinessDay } from './business-day';
import type { CampaignId } from './ids';
import type { JournalEvent } from './journal-event';
import type { MediaFingerprint } from './media-fingerprint';
import type { Refusal } from './refusal';
import type { Strain } from './strain';
import type { Weight } from './weight';

/** A weighing is five birds, caught in different corners (CdC « Demande de pesée »). */
export const WEIGHING_WEIGHTS = 5;

/**
 * Exactly five weights: fewer would not stand for the flock, more is not what was asked. Its photos,
 * when it carries them, are one per weight, in the same order (T.6).
 */
export function validateWeighing(weights: readonly Weight[], photos?: readonly MediaFingerprint[]): Result<void, Refusal> {
  if (weights.length !== WEIGHING_WEIGHTS) return err({ kind: 'NotFiveWeights' });
  return photos === undefined || photos.length === weights.length ? ok(undefined) : err({ kind: 'WeighingPhotosMismatch' });
}

/** The average of the weights, to the nearest gram: computed, never written (CLAUDE.md §4 rule 2). */
export const averageWeight = (weights: readonly Weight[]): number => Math.round(weights.reduce((sum, weight) => sum + weight, 0) / weights.length);

/**
 * What the screen takes as a plausible weight on day `day` (T.3, decision of 2026-11-12): from half
 * to twice the strain's target that day — beyond its table, the last day known. A help against a
 * typing mistake: the server does not check it.
 */
export function weightBounds(strain: Strain, day: number): { readonly min: number; readonly max: number } {
  const last = strain.targets.length - 1;
  const target = strain.targets[Math.min(Math.max(0, Math.trunc(day)), last)]?.weight ?? 0;
  return { min: Math.round(target / 2), max: target * 2 };
}

/** A weight outside the bounds of its day (T.3, T.5): it alerts — the caretaker is asked again, the office sees it red —, it never blocks. */
export function outOfBounds(strain: Strain, day: number, grams: number): boolean {
  const { min, max } = weightBounds(strain, day);
  return grams < min || grams > max;
}

/** What a validation names, as ingestion reads it; `null` when the journal has no such event. */
export type WeighingTarget = { readonly type: string; readonly campaignId: CampaignId; readonly retracted: boolean; readonly validated: boolean };

/** Only a weighing of the same campaign, not taken back and not validated yet, is validated — once. */
export function validateWeighingValidation(campaignId: CampaignId, target: WeighingTarget | null): Result<void, Refusal> {
  if (target === null || target.type !== 'Weighing' || target.campaignId !== campaignId || target.retracted) return err({ kind: 'UnknownWeighing' });
  if (target.validated) return err({ kind: 'WeighingAlreadyValidated' });
  return ok(undefined);
}

/** The weighing requests a weighing still in effect answers (T.2, T.5): the others stay open — on the card, at the office. */
export function answeredWeighingRequests(events: readonly JournalEvent[]): ReadonlySet<string> {
  return new Set(effectiveJournal(events).flatMap(({ fact }) => (fact?.type === 'Weighing' ? [fact.weighingRequestId as string] : [])));
}

/** One point of the real curve: a validated weighing, its day and its average. */
export type WeightPoint = { readonly weighingId: string; readonly campaignDay: number; readonly average: number };

/**
 * The real weight curve (T.1): the validated weighings only — validated by an admin, not taken
 * back —, each at its campaign day with the average of its weights as they count (corrected
 * ones included). Earliest first.
 */
export function weightCurve(events: readonly JournalEvent[], placementDay: BusinessDay): WeightPoint[] {
  const lines = effectiveJournal(events);
  const validated = new Set(lines.flatMap(({ fact }) => (fact?.type === 'WeighingValidated' ? [fact.weighingId as string] : [])));
  return lines
    .flatMap(({ declaration, fact }) =>
      fact?.type === 'Weighing' && validated.has(declaration.id) ? [{ weighingId: declaration.id as string, campaignDay: campaignDay(placementDay, declaration.businessDate), average: averageWeight(fact.weights) }] : [],
    )
    .sort((a, b) => a.campaignDay - b.campaignDay);
}
