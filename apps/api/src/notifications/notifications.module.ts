import { Global, Module } from '@nestjs/common';
import { CorrectionsController } from './corrections.controller';
import { PushSubscriptionsController } from './push-subscriptions.controller';
import { MorningReminders } from './morning-reminders';
import { ReceptionAlerts } from './reception-alerts';
import { PUSH_SENDER_PROVIDER, SiteNotifications } from './site-notifications';

// Global: the modules that write what a caretaker must know of (orders, weighings) tell the site.
@Global()
@Module({
  controllers: [CorrectionsController, PushSubscriptionsController],
  providers: [SiteNotifications, MorningReminders, ReceptionAlerts, PUSH_SENDER_PROVIDER],
  exports: [SiteNotifications, ReceptionAlerts],
})
export class NotificationsModule {}
