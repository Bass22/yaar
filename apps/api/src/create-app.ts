import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

// Global choices shared by the production entry point and the tests, so that the server
// under test is configured like the one that ships. CORS is never enabled: the web app and
// the API answer on a single origin behind Caddy (CLAUDE.md §8).
export function configureApp(app: INestApplication): INestApplication {
  app.setGlobalPrefix('api/v1');
  return app;
}

export async function createApp(): Promise<INestApplication> {
  return configureApp(await NestFactory.create(AppModule));
}
