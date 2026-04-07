import { AccountType, createZodDto } from '@yikart/common'
import { PublishStatus, PublishType, ScheduleRuleFrequency, ScheduleRuleStatus } from '@yikart/mongodb'
import { z } from 'zod'
import { PublishingChannel } from './channel.interfaces'

export const CreatePublishSchema = z.object({
  flowId: z.string({ message: '流水ID' }).optional(),
  accountId: z.string({ message: '账户ID' }),
  accountType: z.enum(AccountType, { message: '平台类型' }),
  type: z.enum(PublishType, { message: '类型' }),
  title: z.string().optional(),
  desc: z.string().optional(),
  userTaskId: z.string({ message: '用户任务ID' }).optional(), // 用户任务ID
  materialGroupId: z.string({ message: '草稿箱ID' }).optional(), // 草稿箱ID (广告主线下任务)
  materialId: z.string({ message: '草稿ID' }).optional(), // 草稿ID (广告主线下任务)
  videoUrl: z.string().optional(),
  coverUrl: z.string().optional(),
  imgUrlList: z.array(z.string()).optional(),
  publishTime: z.coerce.date(),
  topics: z.array(z.string()),
  option: z.any().optional(),
})
export class CreatePublishDto extends createZodDto(CreatePublishSchema) {}

export const PubRecordListFilterSchema = z.object({
  accountId: z.string().optional().describe('账户ID'),
  uid: z.string().optional().describe('第三方平台账户id'),
  flowId: z.string().optional().describe('流水ID'),
  accountType: z.enum(AccountType).optional().describe('账户类型'),
  type: z.enum(PublishType).optional().describe('类型'),
  status: z.enum(PublishStatus).optional().describe('状态'),
  time: z
    .tuple([z.coerce.date(), z.coerce.date()])
    .optional()
    .describe('创建时间区间，必须为UTC时间'),
  publishingChannel: z.enum(PublishingChannel).optional().describe('发布渠道，通过我们内部系统发布的(internal)或平台原生端(native)'),
})
export class PubRecordListFilterDto extends createZodDto(PubRecordListFilterSchema) {}

export const UpdatePublishRecordTimeSchema = z.object({
  id: z.string().describe('数据ID'),
  publishTime: z.coerce.date()
    .describe('新的发布时间，日期为UTC时间'),
})
export class UpdatePublishRecordTimeDto extends createZodDto(UpdatePublishRecordTimeSchema) {}

export const BatchUpdatePublishRecordTimeSchema = z.object({
  updates: z.array(z.object({
    id: z.string(),
    publishTime: z.coerce.date(),
  })).min(1),
})
export class BatchUpdatePublishRecordTimeDto extends createZodDto(BatchUpdatePublishRecordTimeSchema) {}

export const ScheduleBatchModeSchema = z.enum(['viral_slots', 'interval'])

export const CreateScheduleBatchSchema = z.object({
  mode: ScheduleBatchModeSchema,
  itemIds: z.array(z.string()).min(1),
  accountId: z.string(),
  accountType: z.enum(AccountType),
  startAt: z.coerce.date(),
  slots: z.array(z.string().regex(/^\d{2}:\d{2}$/)).optional(),
  intervalHours: z.number().int().positive().optional(),
  timezone: z.string().default('Asia/Jakarta'),
})
export class CreateScheduleBatchDto extends createZodDto(CreateScheduleBatchSchema) {}

export const CreateScheduleRuleSchema = z.object({
  materialId: z.string(),
  accountId: z.string(),
  accountType: z.enum(AccountType),
  frequency: z.nativeEnum(ScheduleRuleFrequency),
  weekdays: z.array(z.number().int().min(0).max(6)).optional(),
  timeOfDay: z.string().regex(/^\d{2}:\d{2}$/),
  timezone: z.string().default('Asia/Jakarta'),
})
export class CreateScheduleRuleDto extends createZodDto(CreateScheduleRuleSchema) {}

export const UpdateScheduleRuleSchema = z.object({
  status: z.nativeEnum(ScheduleRuleStatus).optional(),
  frequency: z.nativeEnum(ScheduleRuleFrequency).optional(),
  weekdays: z.array(z.number().int().min(0).max(6)).optional(),
  timeOfDay: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  timezone: z.string().optional(),
})
export class UpdateScheduleRuleDto extends createZodDto(UpdateScheduleRuleSchema) {}

export const QueueOverviewQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(500).optional().default(200),
})
export class QueueOverviewQueryDto extends createZodDto(QueueOverviewQuerySchema) {}

export const createPublishRecordSchema = z.object({
  flowId: z.string().optional(),
  dataId: z.string(),
  type: z.enum(PublishType),
  status: z.enum(PublishStatus, { message: '状态' }),
  title: z.string().optional(),
  desc: z.string().optional(),
  userTaskId: z.string().optional().describe('用户任务ID'),
  materialGroupId: z.string().optional().describe('草稿箱ID'),
  materialId: z.string().optional().describe('草稿ID'),
  accountId: z.string(),
  topics: z.array(z.string()),
  accountType: z.enum(AccountType),
  uid: z.string(),
  videoUrl: z.string().optional(),
  coverUrl: z.string().optional(),
  imgUrlList: z.array(z.string()).optional(),
  publishTime: z.coerce.date(),
  imgList: z.array(z.string()).optional(),
  workLink: z.string().optional(),
  errorMsg: z.string().optional(),
  option: z.any(),
})
export class CreatePublishRecordDto extends createZodDto(createPublishRecordSchema) { }

export const PublishDayInfoListFiltersSchema = z.object({
  time: z.tuple([
    z.coerce.date(),
    z.coerce.date(),
  ]).optional(),
})
export class PublishDayInfoListFiltersDto extends createZodDto(PublishDayInfoListFiltersSchema) { }

export const listPostHistorySchema = z.object({
  uid: z.string(),
  accountType: z.enum(AccountType),
})
export class ListPostHistoryDto extends createZodDto(listPostHistorySchema) {}

export enum YouTubePrivacyStatus {
  Public = 'public',
  Unlisted = 'unlisted',
  Private = 'private',
}

export enum YouTubeLicense {
  CreativeCommon = 'creativeCommon',
  YouTube = 'youtube',
}

export const YouTubePublishOptionSchema = z.object({
  privacyStatus: z.enum([
    YouTubePrivacyStatus.Public,
    YouTubePrivacyStatus.Unlisted,
    YouTubePrivacyStatus.Private,
  ]),
  license: z.enum(YouTubeLicense).optional(),
  categoryId: z.string(),
  notifySubscribers: z.boolean().optional().default(false),
  embeddable: z.boolean().optional().default(false),
  selfDeclaredMadeForKids: z.boolean().optional().default(false),
})

export const UpdatePublishTaskSchema = z.object({
  id: z.string({ message: '任务ID' }),
  desc: z.string().optional(),
  videoUrl: z.string().optional(),
  imgUrlList: z.array(z.string()).optional(),
  topics: z.array(z.string()).optional(),
  option: z.object({
    youtube: YouTubePublishOptionSchema.optional(),
  }).optional(),
})
export class UpdatePublishTaskDto extends createZodDto(UpdatePublishTaskSchema) {}

export const NowPubTaskBodySchema = z.object({
  publishTime: z.coerce.date().optional(),
})
export class NowPubTaskBodyDto extends createZodDto(NowPubTaskBodySchema) {}

const BulkPublishIdsSchema = z.array(z.string().min(1)).min(1).max(500)

export const BulkPublishNowSchema = z.object({
  ids: BulkPublishIdsSchema,
  publishTime: z.coerce.date().optional(),
  idempotencyKey: z.string().min(1).max(120).optional(),
})
export class BulkPublishNowDto extends createZodDto(BulkPublishNowSchema) {}

export const BulkDeleteQueuedSchema = z.object({
  ids: BulkPublishIdsSchema,
  idempotencyKey: z.string().min(1).max(120).optional(),
})
export class BulkDeleteQueuedDto extends createZodDto(BulkDeleteQueuedSchema) {}

export const BulkUpdateTimeSchema = z.object({
  updates: z.array(z.object({
    id: z.string().min(1),
    publishTime: z.coerce.date(),
  })).min(1).max(500),
  idempotencyKey: z.string().min(1).max(120).optional(),
})
export class BulkUpdateTimeDto extends createZodDto(BulkUpdateTimeSchema) {}
