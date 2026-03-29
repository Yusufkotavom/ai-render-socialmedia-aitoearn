import { Injectable } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model } from 'mongoose'
import { BaseRepository } from './base.repository'
import { ScheduleRule, ScheduleRuleStatus } from '../schemas'

@Injectable()
export class ScheduleRuleRepository extends BaseRepository<ScheduleRule> {
  constructor(
    @InjectModel(ScheduleRule.name)
    private readonly scheduleRuleModel: Model<ScheduleRule>,
  ) {
    super(scheduleRuleModel)
  }

  async listByUserId(userId: string): Promise<ScheduleRule[]> {
    return await this.scheduleRuleModel.find({ userId }).sort({ createdAt: -1 }).lean({ virtuals: true }).exec()
  }

  async listDueRules(now: Date, limit = 100): Promise<ScheduleRule[]> {
    return await this.scheduleRuleModel.find({
      status: ScheduleRuleStatus.ACTIVE,
      nextRunAt: { $lte: now },
    }).sort({ nextRunAt: 1 }).limit(limit).lean({ virtuals: true }).exec()
  }

  async getByIdAndUserId(id: string, userId: string): Promise<ScheduleRule | null> {
    return await this.scheduleRuleModel.findOne({ _id: id, userId }).lean({ virtuals: true }).exec()
  }

  async updateByIdAndUserId(id: string, userId: string, data: Partial<ScheduleRule>): Promise<ScheduleRule | null> {
    return await this.scheduleRuleModel.findOneAndUpdate(
      { _id: id, userId },
      { $set: data },
      { new: true },
    ).lean({ virtuals: true }).exec()
  }

  async deleteByIdAndUserId(id: string, userId: string): Promise<boolean> {
    const res = await this.scheduleRuleModel.deleteOne({ _id: id, userId }).exec()
    return res.deletedCount > 0
  }
}
