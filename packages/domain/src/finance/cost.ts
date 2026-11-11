import { err, Money, ok, type Brand, type CurrencyCode, type Result } from '@kit';
import { BusinessDay } from '../journal/business-day';
import type { CampaignId } from '../journal/ids';
import { Instant } from '../journal/instant';
import type { CounterpartyKind } from './counterparty';
import type { CostTypeId, CounterpartyId } from './purchase-order';

export type CostId = Brand<string, 'CostId'>;

/** Paid, or owed to a counterparty — a supplier, or a collaborator for a salary (P.1). */
export type CostPayment = { readonly kind: 'Paid' } | { readonly kind: 'ToPay'; readonly counterpartyId: CounterpartyId };

/**
 * A cost of a campaign, as written: the first entry, or a counter-entry that replaces it whole
 * (`corrects`, P.2). Never changed nor deleted (CLAUDE.md §4 rule 2).
 */
export type CostEntry = {
  readonly id: CostId;
  /** The cost this entry replaces; `null` for the cost as first written. */
  readonly corrects: CostId | null;
  readonly campaignId: CampaignId;
  readonly costTypeId: CostTypeId;
  /** The day the money went out, or is owed from. */
  readonly spentOn: BusinessDay;
  readonly amount: Money;
  /** Never cut; absent rather than empty. */
  readonly note: string | null;
  readonly payment: CostPayment;
  /** The fingerprint of the receipt's photo (P.5), a supporting document. */
  readonly receipt: string | null;
  /** When it was written: the latest written prevails. */
  readonly recordedAt: Instant;
};

export type CostInput = {
  readonly id: string;
  readonly campaignId: string;
  readonly costTypeId: string;
  readonly spentOn: string;
  /** Whole units of the farm's currency, at least 1. */
  readonly amount: number;
  readonly note: string | null;
  readonly payment: { readonly kind: 'Paid' } | { readonly kind: 'ToPay'; readonly counterpartyId: string };
  readonly receipt: string | null;
  readonly recordedAt: string;
};

/** What a cost is judged against: the farm's currency, the site's today, its types and counterparties. */
export type CostContext = {
  readonly currency: CurrencyCode;
  readonly today: BusinessDay;
  readonly costTypes: readonly { readonly id: string; readonly archived: boolean }[];
  readonly counterparties: readonly { readonly id: string; readonly kind: CounterpartyKind; readonly archived: boolean }[];
};

export type CostRefusal =
  | { readonly kind: 'InvalidId'; readonly expected: 'CostId' | 'CampaignId' | 'CostTypeId' | 'CounterpartyId' }
  | { readonly kind: 'InvalidBusinessDay' }
  | { readonly kind: 'InvalidInstant' }
  | { readonly kind: 'SpentInFuture' }
  | { readonly kind: 'InvalidAmount' }
  | { readonly kind: 'NoteTooLong' }
  | { readonly kind: 'InvalidMediaFingerprint' }
  | { readonly kind: 'UnknownCostType' }
  | { readonly kind: 'CostTypeArchived' }
  | { readonly kind: 'UnknownCounterparty' }
  | { readonly kind: 'CounterpartyArchived' }
  /** A customer is owed nothing by a cost: only a supplier or a collaborator. */
  | { readonly kind: 'NotACreditor' }
  /** A counter-entry names the cost as first written, never another counter-entry. */
  | { readonly kind: 'CorrectsACorrection' }
  | { readonly kind: 'CorrectsItself' }
  | { readonly kind: 'CorrectionChangesCampaign' };

/** A note is long, never cut — but bounded. */
export const NOTE_MAX_LENGTH = 2000;

const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA_256_HEX = /^[0-9a-f]{64}$/;

/** A cost as first written (P.1), judged against the farm. */
export function recordCost(input: CostInput, context: CostContext): Result<CostEntry, CostRefusal> {
  return entryOf(input, null, context);
}

/**
 * A counter-entry (P.2): the cost written again whole, under a new identifier, naming the cost as
 * first written. It follows the same rules and stays in the same campaign.
 */
export function reviseCost(original: CostEntry, input: CostInput, context: CostContext): Result<CostEntry, CostRefusal> {
  if (original.corrects !== null) return err({ kind: 'CorrectsACorrection' });
  if (input.id === original.id) return err({ kind: 'CorrectsItself' });
  if (input.campaignId !== original.campaignId) return err({ kind: 'CorrectionChangesCampaign' });
  return entryOf(input, original.id, context);
}

function entryOf(input: CostInput, corrects: CostId | null, context: CostContext): Result<CostEntry, CostRefusal> {
  if (!CANONICAL_UUID.test(input.id)) return err({ kind: 'InvalidId', expected: 'CostId' });
  if (!CANONICAL_UUID.test(input.campaignId)) return err({ kind: 'InvalidId', expected: 'CampaignId' });
  const spentOn = BusinessDay(input.spentOn);
  if (!spentOn.ok) return err({ kind: 'InvalidBusinessDay' });
  if (spentOn.value > context.today) return err({ kind: 'SpentInFuture' });
  const recordedAt = Instant(input.recordedAt);
  if (!recordedAt.ok) return err({ kind: 'InvalidInstant' });
  const amount = Money.of(input.amount, context.currency);
  if (!amount.ok || amount.value.amount === 0) return err({ kind: 'InvalidAmount' });
  const note = input.note === null || input.note.trim() === '' ? null : input.note.trim();
  if (note !== null && note.length > NOTE_MAX_LENGTH) return err({ kind: 'NoteTooLong' });
  if (input.receipt !== null && !SHA_256_HEX.test(input.receipt)) return err({ kind: 'InvalidMediaFingerprint' });
  const type = context.costTypes.find((one) => one.id === input.costTypeId);
  if (type === undefined) return err({ kind: 'UnknownCostType' });
  if (type.archived) return err({ kind: 'CostTypeArchived' });
  const payment = paymentOf(input.payment, context);
  if (!payment.ok) return payment;
  return ok(
    Object.freeze({
      id: input.id as CostId,
      corrects,
      campaignId: input.campaignId as CampaignId,
      costTypeId: input.costTypeId as CostTypeId,
      spentOn: spentOn.value,
      amount: amount.value,
      note,
      payment: payment.value,
      receipt: input.receipt,
      recordedAt: recordedAt.value,
    }),
  );
}

function paymentOf(payment: CostInput['payment'], context: CostContext): Result<CostPayment, CostRefusal> {
  if (payment.kind === 'Paid') return ok(Object.freeze({ kind: 'Paid' as const }));
  const counterparty = context.counterparties.find((one) => one.id === payment.counterpartyId);
  if (counterparty === undefined) return err({ kind: 'UnknownCounterparty' });
  if (counterparty.archived) return err({ kind: 'CounterpartyArchived' });
  if (counterparty.kind === 'Customer') return err({ kind: 'NotACreditor' });
  return ok(Object.freeze({ kind: 'ToPay' as const, counterpartyId: payment.counterpartyId as CounterpartyId }));
}

/** A cost as it counts — its latest entry — with every entry written for it, earliest first. */
export type CostHistory = {
  /** The identifier of the cost as first written. */
  readonly id: CostId;
  readonly current: CostEntry;
  readonly history: readonly CostEntry[];
};

/**
 * The costs as they count (P.2): each cost replaced by its latest entry, by the instant it was
 * written (ties broken by identifier). An entry received twice counts once; the order of arrival
 * changes nothing. A counter-entry whose cost is unknown is left out.
 */
export function effectiveCosts(entries: readonly CostEntry[]): CostHistory[] {
  const byId = new Map(entries.map((entry) => [entry.id as string, entry]));
  const histories = new Map<string, CostEntry[]>();
  for (const entry of byId.values()) {
    const root = entry.corrects ?? entry.id;
    histories.set(root, [...(histories.get(root) ?? []), entry]);
  }
  const later = (a: CostEntry, b: CostEntry) => (a.recordedAt < b.recordedAt ? -1 : a.recordedAt > b.recordedAt ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const costs: CostHistory[] = [];
  for (const [root, history] of histories) {
    const original = byId.get(root);
    if (original === undefined || original.corrects !== null) continue;
    const sorted = [original, ...history.filter((entry) => entry.corrects !== null).sort(later)];
    const current = sorted.reduce((latest, entry) => (later(entry, latest) > 0 ? entry : latest));
    costs.push({ id: original.id, current, history: sorted });
  }
  return costs.sort((a, b) => (a.current.spentOn < b.current.spentOn ? -1 : a.current.spentOn > b.current.spentOn ? 1 : a.id < b.id ? -1 : 1));
}

/**
 * The committed cost of a campaign (P.1, CdC « Les dépenses »): its costs as they count, paid or
 * owed alike, plus the billable of its orders (what was received, Q.3). Payments and budgets play
 * no part.
 */
export function committedCost(costs: readonly CostHistory[], billables: readonly Money[], currency: CurrencyCode): Money {
  let total = Money.zero(currency);
  for (const amount of [...costs.map((cost) => cost.current.amount), ...billables]) {
    const sum = total.add(amount);
    if (!sum.ok) throw new RangeError('The committed cost cannot be added up in one currency.');
    total = sum.value;
  }
  return total;
}

/** Losses expected over a campaign until a prediction exists (decision of 2026-11-12, backlog V.4). */
export const EXPECTED_LOSS_RATE = 0.07;

/**
 * The cost per bird to date (decisions of 2026-11-12): the committed cost divided by the birds one
 * expects to sell — the chicks received less 7 % of expected losses, or the birds alive today once
 * the losses already go beyond —, rounded to the nearest whole unit. Absent — never zero — while
 * the live count is unknown or nothing is left to divide by.
 */
export function costPerBird(committed: Money, birds: { readonly received: number; readonly liveCount: number | null }): Money | null {
  if (birds.liveCount === null) return null;
  // Whole birds, without a float: 7 % of 1 050 leaves 976.
  const expected = Math.floor((birds.received * Math.round((1 - EXPECTED_LOSS_RATE) * 100)) / 100);
  const divisor = Math.min(birds.liveCount, expected);
  if (divisor <= 0) return null;
  const perBird = Money.of(Math.round(committed.amount / divisor), committed.currency);
  return perBird.ok ? perBird.value : null;
}
