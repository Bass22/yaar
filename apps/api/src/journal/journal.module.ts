import { Module } from '@nestjs/common';
import { CaretakerController } from './caretaker.controller';
import { JournalController } from './journal.controller';

@Module({
  controllers: [JournalController, CaretakerController],
})
export class JournalModule {}
