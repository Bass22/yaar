import { Module } from '@nestjs/common';
import { CaretakerController } from './caretaker.controller';
import { DeathPhotosController } from './death-photos.controller';
import { JournalController } from './journal.controller';

@Module({
  controllers: [JournalController, CaretakerController, DeathPhotosController],
})
export class JournalModule {}
