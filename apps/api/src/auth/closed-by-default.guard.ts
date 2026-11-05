import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from './public.decorator';

// Fail-closed (CLAUDE.md §4 rule 6): a route answers only if it was explicitly opened with
// `@Public()`. Sessions do not exist yet, so nothing else gets through; backlog E.3 replaces
// the refusal below with the verification of the caller's session.
@Injectable()
export class ClosedByDefaultGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic === true) {
      return true;
    }
    throw new UnauthorizedException();
  }
}
