import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiAssistService } from './ai-assist.service';

@Module({
  controllers: [AiController],
  providers: [AiAssistService],
})
export class AiModule {}
