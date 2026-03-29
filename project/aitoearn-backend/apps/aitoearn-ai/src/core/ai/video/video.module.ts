import { Module } from '@nestjs/common'
import { GoogleFlowBrowserService } from '../libs/google-flow-browser'
import { ModelsConfigModule } from '../models-config'
import { AicsoGrokVideoModule } from './aicso-grok'
import { AicsoVeoVideoModule } from './aicso-veo'
import { GeminiVideoModule } from './gemini'
import { GrokVideoModule } from './grok'
import { OpenAIVideoModule } from './openai'
import { VideoTaskStatusScheduler } from './video-task-status.scheduler'
import { VideoController } from './video.controller'
import { VideoService } from './video.service'
import { VolcengineVideoModule } from './volcengine'

@Module({
  imports: [
    ModelsConfigModule,
    VolcengineVideoModule,
    OpenAIVideoModule,
    GeminiVideoModule,
    GrokVideoModule,
    AicsoVeoVideoModule,
    AicsoGrokVideoModule,
  ],
  controllers: [VideoController],
  providers: [VideoService, VideoTaskStatusScheduler, GoogleFlowBrowserService],
  exports: [VideoService, VolcengineVideoModule, OpenAIVideoModule, GeminiVideoModule, GrokVideoModule, AicsoVeoVideoModule, AicsoGrokVideoModule, GoogleFlowBrowserService],
})
export class VideoModule {}
