import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, loadAppConfig } from './app-config';

// Global: any module may ask for the configuration. Building the provider validates the
// environment, so a wrong one stops the boot.
@Global()
@Module({
  providers: [{ provide: APP_CONFIG, useFactory: () => loadAppConfig(process.env) }],
  exports: [APP_CONFIG],
})
export class ConfigModule {}
