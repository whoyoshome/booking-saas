import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiAssistService } from './ai-assist.service';
import { OPENAI_CLIENT, createOpenAiClient } from './openai-client';

@Module({
  controllers: [AiController],
  providers: [AiAssistService, { provide: OPENAI_CLIENT, useFactory: () => createOpenAiClient() }],
})
export class AiModule {}
