import { Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { MediaController } from './media.controller';
import { MediaStore } from './media-store';

@Module({
  controllers: [MediaController],
  providers: [{ provide: MediaStore, inject: [APP_CONFIG], useFactory: (config: AppConfig) => new MediaStore(config.mediaPath) }],
})
export class MediaModule {}
