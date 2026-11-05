import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'auth:isPublic';

// Opens a route (or a whole controller) to callers without a session. Every other route
// stays closed by `ClosedByDefaultGuard`. Reused from build-track (public.decorator.ts).
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);
