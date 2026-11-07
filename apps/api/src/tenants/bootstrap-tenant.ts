import { err, ok, type Result } from '@kit';
import { TimeZone } from '@domain/journal';
import { Prisma, type PrismaClient } from '@prisma/client';
import { Pin, type PinRefusal } from '../auth/pin';
import type { PinHasher } from '../auth/pin-hasher';
import { recordAudit } from '../audit/audit';

// Provisioning of a farm (CdC « Onboarding assisté »): a tenant, its first site and its first
// admin, created by hand by the operator — never through a route. It runs as the owner of the
// database, the only role allowed to insert a tenant (migration 0002). Adapted from
// build-track (bootstrap-company.ts).

export type BootstrapInput = {
  readonly tenantName: string;
  /** ISO 4217, the money the farm counts in. */
  readonly currency: string;
  readonly siteName: string;
  /** IANA name, checked by the domain: it decides which day a declaration falls on. */
  readonly timeZone: string;
  readonly adminName: string;
  /** E.164: one account per number on the whole service. */
  readonly adminPhone: string;
  /** Six digits, as typed. Never stored, never echoed. */
  readonly pin: string;
};

export type BootstrapRefusal =
  | PinRefusal
  | { readonly kind: 'InvalidTimeZone' }
  | { readonly kind: 'InvalidPhone' }
  | { readonly kind: 'InvalidCurrency' }
  | { readonly kind: 'MissingName' }
  | { readonly kind: 'PhoneAlreadyUsed' };

export type Bootstrapped = { readonly tenantId: string; readonly siteId: string; readonly adminId: string };

export type BootstrapDependencies = {
  /** Connected as the owner of the database. */
  readonly prisma: PrismaClient;
  readonly hasher: PinHasher;
  /** Identifiers are made by the caller, never by the database (CLAUDE.md §4 rule 2). */
  readonly ids: () => string;
  /** The clock of the trace. */
  readonly now: () => Date;
};

export const E164 = /^\+[1-9][0-9]{7,14}$/;
const ISO_4217 = /^[A-Z]{3}$/;

export async function bootstrapTenant(input: BootstrapInput, { prisma, hasher, ids, now }: BootstrapDependencies): Promise<Result<Bootstrapped, BootstrapRefusal>> {
  const names = [input.tenantName, input.siteName, input.adminName].map((name) => name.trim());
  if (names.some((name) => name === '')) {
    return err({ kind: 'MissingName' });
  }
  const [tenantName, siteName, adminName] = names as [string, string, string];
  if (!ISO_4217.test(input.currency)) {
    return err({ kind: 'InvalidCurrency' });
  }
  const timeZone = TimeZone(input.timeZone);
  if (!timeZone.ok) {
    return err({ kind: 'InvalidTimeZone' });
  }
  if (!E164.test(input.adminPhone)) {
    return err({ kind: 'InvalidPhone' });
  }
  const pin = Pin(input.pin, 'admin');
  if (!pin.ok) {
    return pin;
  }
  const pinHash = await hasher.hash(pin.value);
  const tenantId = ids();
  const siteId = ids();
  const adminId = ids();

  try {
    // All three rows, or none: an admin without a farm, or a farm without an admin, is a
    // state nobody could use.
    await prisma.$transaction(async (tx) => {
      if ((await tx.user.findUnique({ where: { phone: input.adminPhone }, select: { id: true } })) !== null) {
        throw new PhoneAlreadyUsed();
      }
      await tx.tenant.create({ data: { id: tenantId, name: tenantName, currency: input.currency } });
      await tx.site.create({ data: { id: siteId, tenantId, name: siteName, timeZone: timeZone.value } });
      await tx.user.create({ data: { id: adminId, tenantId, phone: input.adminPhone, name: adminName, role: 'admin', pinHash } });
      await recordAudit(tx, tenantId, { action: 'AdminAdded', actorId: null, subjectId: adminId, deviceId: null }, now());
    });
  } catch (error) {
    // The unique index on the phone is the last word, whatever the check above saw.
    if (error instanceof PhoneAlreadyUsed || isUniqueViolationOn(error, 'phone')) {
      return err({ kind: 'PhoneAlreadyUsed' });
    }
    throw error;
  }
  return ok({ tenantId, siteId, adminId });
}

export class PhoneAlreadyUsed extends Error {}

export function isUniqueViolationOn(error: unknown, column: string): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
    return false;
  }
  const target = error.meta?.['target'];
  return Array.isArray(target) && target.includes(column);
}
