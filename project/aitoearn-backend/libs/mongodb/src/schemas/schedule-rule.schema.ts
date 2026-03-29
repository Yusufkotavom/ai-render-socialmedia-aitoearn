import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { AccountType } from '@yikart/common'
import { PublishType } from '../enums'
import { DEFAULT_SCHEMA_OPTIONS } from '../mongodb.constants'
import { WithTimestampSchema } from './timestamp.schema'

export enum ScheduleRuleFrequency {
  DAILY = 'daily',
  WEEKLY = 'weekly',
  CUSTOM_WEEKDAYS = 'custom_weekdays',
}

export enum ScheduleRuleStatus {
  ACTIVE = 'active',
  PAUSED = 'paused',
}

@Schema({ ...DEFAULT_SCHEMA_OPTIONS, collection: 'scheduleRule' })
export class ScheduleRule extends WithTimestampSchema {
  id: string

  @Prop({ required: true, index: true })
  userId: string

  @Prop({ required: true })
  materialId: string

  @Prop({ required: true })
  accountId: string

  @Prop({ required: true, enum: AccountType, index: true })
  accountType: AccountType

  @Prop({ required: true, enum: PublishType })
  type: PublishType

  @Prop({ required: false })
  title?: string

  @Prop({ required: false })
  desc?: string

  @Prop({ required: true, type: [String], default: [] })
  topics: string[]

  @Prop({ required: false })
  videoUrl?: string

  @Prop({ required: false })
  coverUrl?: string

  @Prop({ required: false, type: [String], default: [] })
  imgUrlList?: string[]

  @Prop({ required: false, type: Object })
  option?: Record<string, any>

  @Prop({ required: true, enum: ScheduleRuleFrequency, index: true })
  frequency: ScheduleRuleFrequency

  @Prop({ required: true, type: [Number], default: [] })
  weekdays: number[]

  @Prop({ required: true })
  timeOfDay: string // HH:mm

  @Prop({ required: true, default: 'Asia/Jakarta' })
  timezone: string

  @Prop({ required: true, enum: ScheduleRuleStatus, default: ScheduleRuleStatus.ACTIVE, index: true })
  status: ScheduleRuleStatus

  @Prop({ required: false })
  lastRunAt?: Date

  @Prop({ required: true, index: true })
  nextRunAt: Date
}

export const ScheduleRuleSchema = SchemaFactory.createForClass(ScheduleRule)

ScheduleRuleSchema.index({ userId: 1, nextRunAt: 1, status: 1 })
