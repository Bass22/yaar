import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'auth:isPublic';

// Opens a route (or a whole controller) to callers without a session. Every other route
// needs a session (`SessionGuard`). Reused from build-track (public.decorator.ts).
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);
