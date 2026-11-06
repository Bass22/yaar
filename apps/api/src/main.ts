// Must stay first: NestJS reads decorator metadata through reflect-metadata.
import 'reflect-metadata';
import { APP_CONFIG, type AppConfig } from './config/app-config';
import { createApp } from './create-app';

async function bootstrap(): Promise<void> {
  const app = await createApp();
  await app.listen(app.get<AppConfig>(APP_CONFIG).port);
}

void bootstrap();
