import { err, ok, type Result } from '@kit';
import type { PrismaClient } from '@prisma/client';
import { recordAudit } from '../audit/audit';
import { Pin, type PinRefusal } from '../auth/pin';
import type { PinHasher } from '../auth/pin-hasher';
import { E164, isUniqueViolationOn, PhoneAlreadyUsed } from './bootstrap-tenant';

// Adds an admin to a farm that exists (CdC « Identité »: at least one admin per farm, and not
// necessarily one; an admin is created by the operator only, by script). Never a route: the
// admins of a farm create collaborators only. Runs as the owner of the database, like the
// provisioning of the farm (bootstrap-tenant.ts).

export type AddAdminInput = {
  /** The identifier printed when the farm was provisioned: a farm's name is not unique. */
  readonly tenantId: string;
  readonly adminName: string;
  /** E.164: one account per number on the whole service. */
  readonly adminPhone: string;
  /** Six digits, as typed. Never stored, never echoed. */
  readonly pin: string;
};

export type AddAdminRefusal =
  | PinRefusal
  | { readonly kind: 'InvalidPhone' }
  | { readonly kind: 'MissingName' }
  | { readonly kind: 'TenantNotFound' }
  | { readonly kind: 'PhoneAlreadyUsed' };

export type AddAdminDependencies = {
  /** Connected as the owner of the database. */
  readonly prisma: PrismaClient;
  readonly hasher: PinHasher;
  readonly ids: () => string;
  readonly now: () => Date;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function addAdmin(input: AddAdminInput, { prisma, hasher, ids, now }: AddAdminDependencies): Promise<Result<{ readonly adminId: string }, AddAdminRefusal>> {
  const adminName = input.adminName.trim();
  if (adminName === '') {
    return err({ kind: 'MissingName' });
  }
  if (!E164.test(input.adminPhone)) {
    return err({ kind: 'InvalidPhone' });
  }
  const pin = Pin(input.pin, 'admin');
  if (!pin.ok) {
    return pin;
  }
  if (!UUID.test(input.tenantId) || (await prisma.tenant.count({ where: { id: input.tenantId } })) === 0) {
    return err({ kind: 'TenantNotFound' });
  }
  const pinHash = await hasher.hash(pin.value);
  const adminId = ids();

  try {
    // The account and its trace, or neither.
    await prisma.$transaction(async (tx) => {
      if ((await tx.user.findUnique({ where: { phone: input.adminPhone }, select: { id: true } })) !== null) {
        throw new PhoneAlreadyUsed();
      }
      await tx.user.create({ data: { id: adminId, tenantId: input.tenantId, phone: input.adminPhone, name: adminName, role: 'admin', pinHash } });
      await recordAudit(tx, input.tenantId, { action: 'AdminAdded', actorId: null, subjectId: adminId, deviceId: null }, now());
    });
  } catch (error) {
    if (error instanceof PhoneAlreadyUsed || isUniqueViolationOn(error, 'phone')) {
      return err({ kind: 'PhoneAlreadyUsed' });
    }
    throw error;
  }
  return ok({ adminId });
}
