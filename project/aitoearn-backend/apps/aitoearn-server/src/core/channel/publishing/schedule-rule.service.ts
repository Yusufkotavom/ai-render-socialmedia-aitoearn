import { Injectable, Logger } from '@nestjs/common'
import { AccountType, AppException, FileUtil, ResponseCode } from '@yikart/common'
import {
  Material,
  MaterialType,
  PublishType,
  ScheduleRule,
  ScheduleRuleFrequency,
  ScheduleRuleRepository,
  ScheduleRuleStatus,
} from '@yikart/mongodb'
import dayjs from 'dayjs'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'
import { v4 as uuidv4 } from 'uuid'
import { MaterialService } from '../../content/material.service'
import { RelayClientService } from '../../relay/relay-client.service'
import { ChannelAccountService } from '../platforms/channel-account.service'
import { CreatePublishDto } from './publish.dto'
import { PublishingService } from './publishing.service'

dayjs.extend(utc)
dayjs.extend(timezone)

@Injectable()
export class ScheduleRuleService {
  private readonly logger = new Logger(ScheduleRuleService.name)

  constructor(
    private readonly scheduleRuleRepository: ScheduleRuleRepository,
    private readonly materialService: MaterialService,
    private readonly publishingService: PublishingService,
    private readonly channelAccountService: ChannelAccountService,
    private readonly relayClientService: RelayClientService,
  ) { }

  private async uploadMediaToRelayIfNeeded(payload: CreatePublishDto): Promise<CreatePublishDto> {
    const uploadOne = async (url?: string) => {
      if (!url) {
        return url
      }
      const sourceUrl = /^https?:\/\//i.test(url) ? url : FileUtil.buildUrl(url)
      return await this.relayClientService.uploadFileFromLocalUrl(sourceUrl)
    }

    const [videoUrl, coverUrl] = await Promise.all([
      uploadOne(payload.videoUrl),
      uploadOne(payload.coverUrl),
    ])

    let imgUrlList: string[] | undefined
    if (payload.imgUrlList && payload.imgUrlList.length > 0) {
      imgUrlList = await Promise.all(payload.imgUrlList.map(url => uploadOne(url) as Promise<string>))
    }

    return {
      ...payload,
      videoUrl,
      coverUrl,
      imgUrlList,
    }
  }

  private async createPublishTaskWithRelaySupport(payload: CreatePublishDto) {
    const accountInfo = await this.channelAccountService.getAccountInfo(payload.accountId)
    if (accountInfo?.relayAccountRef) {
      if (!this.relayClientService.enabled) {
        throw new AppException(ResponseCode.RelayServerUnavailable)
      }
      const relayPayload = await this.uploadMediaToRelayIfNeeded(payload)
      await this.relayClientService.post('/plat/publish/create', {
        ...relayPayload,
        accountId: accountInfo.relayAccountRef,
      })
      return
    }

    await this.publishingService.createPublishingTask(payload)
  }

  private toPublishType(material: Material): PublishType {
    return material.type === MaterialType.VIDEO ? PublishType.VIDEO : PublishType.ARTICLE
  }

  private getPublishMedia(material: Material): { videoUrl?: string, coverUrl?: string, imgUrlList?: string[] } {
    const videoMedia = material.mediaList.find(media => media.type === 'video')
    const imageList = material.mediaList.filter(media => media.type === 'img').map(media => media.url)

    const videoUrl = videoMedia?.url
    const coverUrl = material.coverUrl || (imageList.length > 0 ? imageList[0] : undefined)
    const imgUrlList = imageList.length > 0 ? imageList : undefined

    return {
      videoUrl,
      coverUrl,
      imgUrlList,
    }
  }

  buildPublishPayloadFromMaterial(material: Material, input: {
    accountId: string
    accountType: AccountType
    publishTime: Date
  }): CreatePublishDto {
    const mediaPayload = this.getPublishMedia(material)

    return {
      flowId: uuidv4(),
      accountId: input.accountId,
      accountType: input.accountType,
      type: this.toPublishType(material),
      title: material.title || '',
      desc: material.desc || '',
      materialGroupId: material.groupId,
      materialId: material.id,
      videoUrl: mediaPayload.videoUrl,
      coverUrl: mediaPayload.coverUrl,
      imgUrlList: mediaPayload.imgUrlList,
      publishTime: input.publishTime,
      topics: material.topics || [],
      option: material.option,
    }
  }

  computeNextRunAt(params: {
    frequency: ScheduleRuleFrequency
    weekdays?: number[]
    timeOfDay: string
    timezone: string
    fromDate?: Date
  }): Date {
    const tz = params.timezone || 'Asia/Jakarta'
    const [hour, minute] = params.timeOfDay.split(':').map(v => Number(v))
    const now = dayjs(params.fromDate || new Date()).tz(tz)

    const baseToday = now.hour(hour).minute(minute).second(0).millisecond(0)

    if (params.frequency === ScheduleRuleFrequency.DAILY) {
      return (baseToday.isAfter(now) ? baseToday : baseToday.add(1, 'day')).toDate()
    }

    if (params.frequency === ScheduleRuleFrequency.WEEKLY) {
      const target = baseToday.day(now.day())
      return (target.isAfter(now) ? target : target.add(1, 'week')).toDate()
    }

    const weekdays = (params.weekdays || []).filter(day => day >= 0 && day <= 6)
    if (weekdays.length === 0) {
      return (baseToday.isAfter(now) ? baseToday : baseToday.add(1, 'day')).toDate()
    }

    for (let offset = 0; offset < 14; offset++) {
      const candidate = baseToday.add(offset, 'day')
      if (!weekdays.includes(candidate.day())) {
        continue
      }
      if (candidate.isAfter(now)) {
        return candidate.toDate()
      }
    }

    return baseToday.add(1, 'week').toDate()
  }

  async createRule(input: {
    userId: string
    materialId: string
    accountId: string
    accountType: AccountType
    frequency: ScheduleRuleFrequency
    weekdays?: number[]
    timeOfDay: string
    timezone?: string
  }): Promise<ScheduleRule> {
    const material = await this.materialService.getInfo(input.materialId)
    if (!material || material.userId !== input.userId) {
      throw new Error('Material not found')
    }

    const timezone = input.timezone || 'Asia/Jakarta'
    const nextRunAt = this.computeNextRunAt({
      frequency: input.frequency,
      weekdays: input.weekdays,
      timeOfDay: input.timeOfDay,
      timezone,
    })

    const mediaPayload = this.getPublishMedia(material)

    return await this.scheduleRuleRepository.create({
      userId: input.userId,
      materialId: material.id,
      accountId: input.accountId,
      accountType: input.accountType,
      type: this.toPublishType(material),
      title: material.title,
      desc: material.desc,
      topics: material.topics || [],
      videoUrl: mediaPayload.videoUrl,
      coverUrl: mediaPayload.coverUrl,
      imgUrlList: mediaPayload.imgUrlList,
      option: material.option,
      frequency: input.frequency,
      weekdays: input.weekdays || [],
      timeOfDay: input.timeOfDay,
      timezone,
      status: ScheduleRuleStatus.ACTIVE,
      nextRunAt,
    })
  }

  async listRules(userId: string): Promise<ScheduleRule[]> {
    return await this.scheduleRuleRepository.listByUserId(userId)
  }

  async updateRule(id: string, userId: string, data: {
    status?: ScheduleRuleStatus
    frequency?: ScheduleRuleFrequency
    weekdays?: number[]
    timeOfDay?: string
    timezone?: string
  }): Promise<ScheduleRule | null> {
    const existing = await this.scheduleRuleRepository.getByIdAndUserId(id, userId)
    if (!existing) {
      return null
    }

    const patch: Partial<ScheduleRule> = {
      ...data,
    }

    const nextFrequency = data.frequency || existing.frequency
    const nextWeekdays = data.weekdays || existing.weekdays
    const nextTimeOfDay = data.timeOfDay || existing.timeOfDay
    const nextTimezone = data.timezone || existing.timezone
    const nextStatus = data.status || existing.status

    if (
      data.frequency !== undefined
      || data.weekdays !== undefined
      || data.timeOfDay !== undefined
      || data.timezone !== undefined
      || data.status !== undefined
    ) {
      if (nextStatus === ScheduleRuleStatus.ACTIVE) {
        patch.nextRunAt = this.computeNextRunAt({
          frequency: nextFrequency,
          weekdays: nextWeekdays,
          timeOfDay: nextTimeOfDay,
          timezone: nextTimezone,
        })
      }
    }

    return await this.scheduleRuleRepository.updateByIdAndUserId(id, userId, patch)
  }

  async deleteRule(id: string, userId: string): Promise<boolean> {
    return await this.scheduleRuleRepository.deleteByIdAndUserId(id, userId)
  }

  async processDueRules(limit = 100): Promise<number> {
    const now = new Date()
    const dueRules = await this.scheduleRuleRepository.listDueRules(now, limit)

    if (dueRules.length === 0) {
      return 0
    }

    let processed = 0

    for (const rule of dueRules) {
      try {
        const material = await this.materialService.getInfo(rule.materialId)
        if (!material || material.userId !== rule.userId) {
          await this.scheduleRuleRepository.updateById(rule.id, {
            status: ScheduleRuleStatus.PAUSED,
          })
          continue
        }

        const payload = this.buildPublishPayloadFromMaterial(material, {
          accountId: rule.accountId,
          accountType: rule.accountType,
          publishTime: now,
        })

        await this.createPublishTaskWithRelaySupport(payload)

        const nextRunAt = this.computeNextRunAt({
          frequency: rule.frequency,
          weekdays: rule.weekdays,
          timeOfDay: rule.timeOfDay,
          timezone: rule.timezone,
          fromDate: new Date(now.getTime() + 1000),
        })

        await this.scheduleRuleRepository.updateById(rule.id, {
          lastRunAt: now,
          nextRunAt,
          title: material.title,
          desc: material.desc,
          topics: material.topics,
          option: material.option,
          ...this.getPublishMedia(material),
        })

        processed++
      }
      catch (error: any) {
        this.logger.error(`Failed processing schedule rule ${rule.id}: ${error?.message || error}`)
      }
    }

    return processed
  }
}
