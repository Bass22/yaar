import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable, InjectionToken, inject, signal } from '@angular/core';
import { SwPush } from '@angular/service-worker';
import { firstValueFrom } from 'rxjs';
import type { PushPublicKeyView, SubscribeToPushRequest } from '@contracts';
import { AuthService } from '../session/auth';
import { authHeaders } from '../session/auth-headers';

export type PushPermission = 'default' | 'granted' | 'denied' | 'unsupported';

/** The browser, behind a port: what it says of the permission, asking it, subscribing (Y.1). */
export interface PushPlatform {
  permission(): PushPermission;
  requestPermission(): Promise<'default' | 'granted' | 'denied'>;
  subscribe(publicKey: string): Promise<SubscribeToPushRequest>;
  unsubscribe(): Promise<void>;
}

/** The service worker's push (Angular), or nothing where the browser or the build has none. */
export const PUSH_PLATFORM = new InjectionToken<PushPlatform>('PUSH_PLATFORM', {
  providedIn: 'root',
  factory: () => browserPush(inject(SwPush, { optional: true })),
});

function browserPush(swPush: SwPush | null): PushPlatform {
  const supported = () => swPush !== null && swPush.isEnabled && typeof Notification !== 'undefined';
  return {
    permission: () => (supported() ? Notification.permission : 'unsupported'),
    requestPermission: () => Notification.requestPermission(),
    subscribe: async (serverPublicKey) => {
      const json = (await (swPush as SwPush).requestSubscription({ serverPublicKey })).toJSON();
      return { endpoint: json.endpoint ?? '', keys: { p256dh: json.keys?.['p256dh'] ?? '', auth: json.keys?.['auth'] ?? '' } };
    },
    unsubscribe: async () => {
      if (supported()) await (swPush as SwPush).unsubscribe().catch(() => undefined);
    },
  };
}

/**
 * Where notifications stand on this device (Y.1): `ask` offers them; `later` and `denied` never
 * ask again; `on` is subscribed; `none` when the browser cannot or the server has no key.
 */
export type PushState = 'loading' | 'none' | 'ask' | 'later' | 'denied' | 'on';

const LATER = 'yaar.push.later';

@Injectable({ providedIn: 'root' })
export class PushNotifications {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly platform = inject(PUSH_PLATFORM);
  private publicKey: string | null = null;

  readonly state = signal<PushState>('loading');

  /** Reads where things stand; already allowed, the device subscribes again without asking. */
  async refresh(): Promise<void> {
    const permission = this.platform.permission();
    if (permission === 'unsupported') return this.state.set('none');
    try {
      this.publicKey = (await firstValueFrom(this.http.get<PushPublicKeyView>('/api/v1/push/public-key', { headers: this.headers() }))).publicKey;
    } catch {
      return this.state.set('none');
    }
    if (permission === 'denied') return this.state.set('denied');
    if (permission === 'granted') return this.state.set((await this.subscribe()) ? 'on' : 'ask');
    this.state.set(laterChosen() ? 'later' : 'ask');
  }

  /** The person said yes: the browser asks in its turn; a refusal changes nothing else. */
  async agree(): Promise<boolean> {
    if (this.publicKey === null) return false;
    const answer = await this.platform.requestPermission().catch(() => 'default' as const);
    if (answer === 'denied') {
      this.state.set('denied');
      return false;
    }
    if (answer !== 'granted') {
      this.later();
      return false;
    }
    const done = await this.subscribe();
    this.state.set(done ? 'on' : 'ask');
    return done;
  }

  /** « Plus tard »: the offer goes, and does not come back on this device. */
  later(): void {
    try {
      localStorage.setItem(LATER, '1');
    } catch {
      // Without storage, the offer comes back at the next opening: harmless.
    }
    this.state.set('later');
  }

  /** The device signs out: its subscription goes, here and at the server — best effort, never blocking. */
  async stop(): Promise<void> {
    if (this.platform.permission() !== 'granted') return;
    await this.platform.unsubscribe().catch(() => undefined);
    await firstValueFrom(this.http.delete('/api/v1/push-subscription', { headers: this.headers() })).catch(() => undefined);
  }

  private async subscribe(): Promise<boolean> {
    if (this.publicKey === null) return false;
    try {
      const subscription = await this.platform.subscribe(this.publicKey);
      await firstValueFrom(this.http.put('/api/v1/push-subscription', subscription, { headers: this.headers() }));
      return true;
    } catch {
      return false;
    }
  }

  private headers(): HttpHeaders {
    const session = this.auth.session();
    return authHeaders(session);
  }
}

function laterChosen(): boolean {
  try {
    return localStorage.getItem(LATER) === '1';
  } catch {
    return false;
  }
}
