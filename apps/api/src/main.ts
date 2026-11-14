// Must stay first: NestJS reads decorator metadata through reflect-metadata.
import 'reflect-metadata';
import { APP_CONFIG, type AppConfig } from './config/app-config';
import { createApp } from './create-app';
import { MorningReminders } from './notifications/morning-reminders';

async function bootstrap(): Promise<void> {
  const app = await createApp();
  await app.listen(app.get<AppConfig>(APP_CONFIG).port);
  // The morning reminder (Y.3): looked at every five minutes; it leaves once per day and per site.
  app.get(MorningReminders).start();
}

void bootstrap();
