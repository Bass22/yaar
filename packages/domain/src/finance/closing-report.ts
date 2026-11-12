import { err, Money, ok, SignedMoney, type CurrencyCode, type Result } from '@kit';
import { halvesOf, type Leftover, type LiveCount } from '../journal';
import { NOTE_MAX_LENGTH } from './cost';

/**
 * Stock of a type the campaign paid for, counted in halves: a received order line counts two
 * halves a bag or a unit at its billable; leftovers received from an earlier campaign count at
 * their value.
 */
export type ReceivedStock = { readonly costTypeId: string; readonly halves: number; readonly value: Money };

/** A leftover and its value; absent — never zero — when nothing of its type was received. */
export type LeftoverValue = { readonly costTypeId: string; readonly halves: number; readonly value: Money | null };

/** `numerator ÷ denominator` to the nearest whole unit, half up, without a float on the way. */
const roundedDivision = (numerator: number, denominator: number): number => Math.floor((2 * numerator + denominator) / (2 * denominator));

/**
 * The value of the leftovers (X.1, decision of 2026-11-12): the average price paid for their type
 * in the campaign times what is left, a half bag for half; one rounding, at the end.
 */
export function leftoverValues(leftovers: readonly Leftover[], stock: readonly ReceivedStock[], currency: CurrencyCode): LeftoverValue[] {
  return leftovers.map((leftover) => {
    const halves = halvesOf(leftover);
    let paid = 0;
    let paidHalves = 0;
    for (const line of stock) {
      if (line.costTypeId !== leftover.costTypeId) continue;
      paid += line.value.amount;
      paidHalves += line.halves;
    }
    if (paidHalves === 0) return { costTypeId: leftover.costTypeId, halves, value: null };
    const value = Money.of(roundedDivision(paid * halves, paidHalves), currency);
    if (!value.ok) throw new RangeError('A leftover cannot be valued.');
    return { costTypeId: leftover.costTypeId, halves, value: value.value };
  });
}

export type TransferContext = {
  readonly from: { readonly campaignId: string; readonly siteId: string };
  /** The campaign the admin chose to receive the leftovers. */
  readonly to: { readonly campaignId: string; readonly siteId: string; readonly closed: boolean };
};

/** The leftovers leaving a closed campaign: their known value leaves its cost and enters the other's. */
export type LeftoverTransfer = {
  readonly from: string;
  readonly to: string;
  readonly leftovers: readonly LeftoverValue[];
  readonly value: Money;
};

export type TransferRefusal = { readonly kind: 'InvalidId' } | { readonly kind: 'SameCampaign' } | { readonly kind: 'OtherSite' } | { readonly kind: 'DestinationClosed' };

const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Sends the leftovers to the campaign the admin chose: another one of the same site, not closed. */
export function transferLeftovers(leftovers: readonly LeftoverValue[], context: TransferContext, currency: CurrencyCode): Result<LeftoverTransfer, TransferRefusal> {
  const { from, to } = context;
  if (![from.campaignId, from.siteId, to.campaignId, to.siteId].every((id) => CANONICAL_UUID.test(id))) return err({ kind: 'InvalidId' });
  if (to.campaignId === from.campaignId) return err({ kind: 'SameCampaign' });
  if (to.siteId !== from.siteId) return err({ kind: 'OtherSite' });
  if (to.closed) return err({ kind: 'DestinationClosed' });
  let value = Money.zero(currency);
  for (const leftover of leftovers) {
    if (leftover.value === null) continue;
    const sum = value.add(leftover.value);
    if (!sum.ok) throw new RangeError('The leftovers cannot be added up in one currency.');
    value = sum.value;
  }
  return ok(Object.freeze({ from: from.campaignId, to: to.campaignId, leftovers: Object.freeze([...leftovers]), value }));
}

export type ClosingInput = {
  readonly count: LiveCount;
  /** The committed cost, leftovers received from an earlier campaign included. */
  readonly committed: Money;
  /** The known value of the leftovers sent to another campaign. */
  readonly transferred: Money;
  readonly sales: { readonly birdsSold: number; readonly revenue: Money; readonly cashedIn: Money };
  readonly comment?: string | null;
};

/** The report of a closed campaign (X.1), after the « Résultats » sheet of the founder. */
export type ClosingReport = {
  readonly chicksReceived: number;
  readonly deaths: number;
  /** Missing, given away, stolen: never deaths. */
  readonly losses: number;
  readonly birdsSold: number;
  readonly costs: Money;
  readonly leftovers: Money;
  /** Costs − leftovers transferred. */
  readonly netCost: SignedMoney;
  readonly revenue: Money;
  readonly cashedIn: Money;
  /** Net cost ÷ chicks received, to the nearest unit; absent without a chick received. */
  readonly costPerBird: SignedMoney | null;
  /** Revenue ÷ chicks received (added by the founder on 2026-11-12), to compare with the cost per bird. */
  readonly revenuePerChick: Money | null;
  /** Revenue − net cost, signed. */
  readonly profit: SignedMoney;
  readonly comment: string | null;
};

export type ClosingRefusal = { readonly kind: 'CommentTooLong'; readonly max: number };

/**
 * The closing report (CdC « Les restes et le bilan », decisions of 2026-11-12): recomputed from the
 * entries every time, nothing in it is stored but the comment.
 */
export function closingReport(input: ClosingInput): Result<ClosingReport, ClosingRefusal> {
  const comment = input.comment?.trim() ?? '';
  if (comment.length > NOTE_MAX_LENGTH) return err({ kind: 'CommentTooLong', max: NOTE_MAX_LENGTH });
  const { count, committed, transferred, sales } = input;
  const netCost = SignedMoney.fromMoney(committed).subtract(SignedMoney.fromMoney(transferred));
  if (!netCost.ok) throw new RangeError('The report cannot be computed in one currency.');
  const profit = SignedMoney.fromMoney(sales.revenue).subtract(netCost.value);
  if (!profit.ok) throw new RangeError('The report cannot be computed in one currency.');
  const received = count.received;
  return ok(
    Object.freeze({
      chicksReceived: received,
      deaths: count.deaths,
      losses: count.losses,
      birdsSold: sales.birdsSold,
      costs: committed,
      leftovers: transferred,
      netCost: netCost.value,
      revenue: sales.revenue,
      cashedIn: sales.cashedIn,
      costPerBird: received > 0 ? unwrapMoney(SignedMoney.of(roundedDivision(netCost.value.amount, received), committed.currency)) : null,
      revenuePerChick: received > 0 ? unwrapMoney(Money.of(roundedDivision(sales.revenue.amount, received), committed.currency)) : null,
      profit: profit.value,
      comment: comment === '' ? null : comment,
    }),
  );
}

function unwrapMoney<T>(result: Result<T, unknown>): T {
  if (!result.ok) throw new RangeError('The report cannot be computed.');
  return result.value;
}
