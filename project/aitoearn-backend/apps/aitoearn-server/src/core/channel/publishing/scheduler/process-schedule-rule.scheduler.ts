import { Injectable, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { ScheduleRuleService } from '../schedule-rule.service'

@Injectable()
export class ProcessScheduleRuleScheduler {
  private readonly logger = new Logger(ProcessScheduleRuleScheduler.name)

  constructor(
    private readonly scheduleRuleService: ScheduleRuleService,
  ) { }

  @Cron(CronExpression.EVERY_10_MINUTES, { waitForCompletion: true })
  async processRules() {
    try {
      const processed = await this.scheduleRuleService.processDueRules(100)
      if (processed > 0) {
        this.logger.log(`Processed ${processed} due schedule rules`)
      }
    }
    catch (error: any) {
      this.logger.error(`Failed processing schedule rules: ${error?.message || error}`)
    }
  }
}
