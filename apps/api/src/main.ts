// Must stay first: NestJS reads decorator metadata through reflect-metadata.
import 'reflect-metadata';
import { createApp } from './create-app';

async function bootstrap(): Promise<void> {
  const app = await createApp();
  await app.listen(process.env['PORT'] ?? 3000);
}

void bootstrap();
