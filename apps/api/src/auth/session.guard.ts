import { ForbiddenException, Inject, Injectable, UnauthorizedException, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { unwrap, type Clock } from '@kit';
import { instantOf, TenantId, type Role } from '@domain/journal';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { verifyAccessToken } from './access-token';
import { CLOCK } from './clock.token';
import { IS_PUBLIC_KEY } from './public.decorator';
import { ROLES_KEY, type SessionRequest } from './session';

const BEARER = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/;

/**
 * Fail-closed (CLAUDE.md §4 rule 6): every route needs a session unless `@Public()` opens it.
 * A missing, malformed, forged or expired token is one plain 401. The tenant, the user and the
 * role come from the token alone — never from a parameter or the body. Whether the account
 * still stands (blocked, tokens invalidated, role changed) is read in the database by
 * `TenantTransactionInterceptor`, in the transaction of the request.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets) === true) {
      return true;
    }
    const request = context.switchToHttp().getRequest<SessionRequest & { headers: Record<string, string | string[] | undefined> }>();
    const header = request.headers['authorization'];
    const token = typeof header === 'string' ? BEARER.exec(header)?.[1] : undefined;
    if (token === undefined) {
      throw new UnauthorizedException();
    }
    const claims = verifyAccessToken(token, instantOf(this.clock.now()), this.config.jwtSecret);
    if (!claims.ok) {
      throw new UnauthorizedException();
    }
    const { sub, tenant, role, device, iat } = claims.value;
    request.session = { userId: sub, tenantId: unwrap(TenantId(tenant)), role, deviceId: device };
    request.sessionIssuedAt = iat;

    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, targets);
    if (roles !== undefined && !roles.includes(role)) {
      throw new ForbiddenException();
    }
    return true;
  }
}
