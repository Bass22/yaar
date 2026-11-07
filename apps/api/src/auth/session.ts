import { createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common';
import type { Role, TenantId } from '@domain/journal';

/** Who is calling, read from a verified token: the tenant of every query of the request. */
export type Session = {
  readonly userId: string;
  readonly tenantId: TenantId;
  readonly role: Role;
  readonly deviceId: string;
};

/** A request once the session guard has let it through. */
export type SessionRequest = { session?: Session; sessionIssuedAt?: number };

/** Injects the session of the request. Only meaningful on a route that is not `@Public()`. */
export const CurrentSession = createParamDecorator((_data: unknown, context: ExecutionContext): Session => {
  const session = context.switchToHttp().getRequest<SessionRequest>().session;
  if (session === undefined) {
    throw new Error('CurrentSession used on a route without a session.');
  }
  return session;
});

export const ROLES_KEY = 'auth:roles';

/** Restricts a route (or a controller) to these roles. Without it, any session gets through. */
export const Roles = (...roles: Role[]): MethodDecorator & ClassDecorator => SetMetadata(ROLES_KEY, roles);
