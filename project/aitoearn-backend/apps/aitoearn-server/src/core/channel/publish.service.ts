import { Injectable, Logger } from '@nestjs/common'
import { AssetsService } from '@yikart/assets'
import { AppException, getErrorDetail, ResponseCode, TableDto } from '@yikart/common'
import { PublishRecord, PublishStatus, ScheduleRuleFrequency, ScheduleRuleStatus } from '@yikart/mongodb'
import dayjs from 'dayjs'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'
import { z } from 'zod'
import { MaterialService } from '../content/material.service'
import { PublishRecordService } from '../publish-record/publish-record.service'
import { RelayClientService } from '../relay/relay-client.service'
import { PublishingChannel } from './channel.interfaces'
import { NewPublishData, PlatOptions } from './common'
import { ChannelAccountService } from './platforms/channel-account.service'
import { PostHistoryItemVoSchema } from './publish-response.vo'
import { PublishDayInfoListFiltersDto, PubRecordListFilterDto, UpdatePublishTaskDto } from './publish.dto'
import { CreatePublishDto, UpdatePublishTaskDto as PublishingUpdatePublishTaskDto } from './publishing/publish.dto'
import { PublishingService } from './publishing/publishing.service'
import { ScheduleRuleService } from './publishing/schedule-rule.service'

dayjs.extend(utc)
dayjs.extend(timezone)

type PostHistoryItem = z.infer<typeof PostHistoryItemVoSchema>

@Injectable()
export class PublishService {
  private readonly logger = new Logger(PublishService.name)
  constructor(
    private readonly publishingService: PublishingService,
    private readonly publishRecordService: PublishRecordService,
    private readonly assetsService: AssetsService,
    private readonly materialService: MaterialService,
    private readonly scheduleRuleService: ScheduleRuleService,
    private readonly channelAccountService: ChannelAccountService,
    private readonly relayClientService: RelayClientService,
  ) { }

  private async uploadMediaToRelayIfNeeded(payload: CreatePublishDto): Promise<CreatePublishDto> {
    const uploadOne = async (url?: string) => {
      if (!url) {
        return url
      }
      const absoluteUrl = this.assetsService.buildUrl(url)
      return await this.relayClientService.uploadFileFromLocalUrl(absoluteUrl)
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
      return await this.relayClientService.post('/plat/publish/create', {
        ...relayPayload,
        accountId: accountInfo.relayAccountRef,
      })
    }
    return await this.publishingService.createPublishingTask(payload)
  }

  private toCreatePublishDto(newData: NewPublishData<PlatOptions>): CreatePublishDto {
    return {
      flowId: newData.flowId,
      accountId: newData.accountId,
      accountType: newData.accountType,
      type: newData.type,
      title: newData.title,
      desc: newData.desc,
      userTaskId: newData.userTaskId,
      videoUrl: newData.videoUrl,
      coverUrl: newData.coverUrl,
      imgUrlList: newData.imgUrlList,
      publishTime: newData.publishTime || new Date(),
      topics: newData.topics || [],
      option: newData.option,
    } as CreatePublishDto
  }

  /**
   * 公开的发布接口
   * @param newData
   * @returns
   */
  async pubCreate(newData: NewPublishData<PlatOptions>) {
    const res = await this.publishingService.createPublishingTask(this.toCreatePublishDto(newData))
    return res
  }

  async create(userId: string, newData: NewPublishData<PlatOptions>) {
    const res = await this.createPublishTaskWithRelaySupport(this.toCreatePublishDto(newData))
    return res
  }

  async run(id: string) {
    const res = await this.publishingService.publishTaskImmediately(id)
    return res
  }

  async getList(data: PubRecordListFilterDto, userId: string) {
    const res = await this.publishRecordService.getPublishRecordList({
      ...data,
      userId,
    })
    return res
  }

  /**
   * 从 snapshot 作品数据中提取互动统计和更新时间
   */
  private getDefaultEngagement() {
    return {
      viewCount: 0,
      commentCount: 0,
      likeCount: 0,
      shareCount: 0,
      clickCount: 0,
      impressionCount: 0,
      favoriteCount: 0,
    }
  }

  private mergePostHistory(publishRecords: PublishRecord[], publishTasks: any[]) {
    const result = new Map<string, PostHistoryItem>()

    // 以发布记录为主
    const publishRecordCache = new Map<string, PublishRecord>()
    for (const record of publishRecords) {
      if (record.coverUrl) {
        record.coverUrl = this.assetsService.buildUrl(record.coverUrl)
      }
      if (record.flowId) {
        publishRecordCache.set(record.flowId, record)
      }
      const engagement = this.getDefaultEngagement()
      result.set(record.dataId || record.id, {
        id: record.id,
        flowId: record.flowId || '',
        title: record.title || '',
        desc: record.desc || '',
        dataId: record.dataId,
        type: record.type,
        accountId: record.accountId ?? '',
        accountType: record.accountType,
        uid: record.uid,
        videoUrl: record.videoUrl || '',
        coverUrl: record.coverUrl || '',
        imgUrlList: record.imgUrlList || [],
        publishTime: record.publishTime,
        errorMsg: record.errorMsg || '',
        status: record.status,
        engagement,
        publishingChannel: PublishingChannel.INTERNAL,
        workLink: record.workLink || '',
        topics: record.topics || [],
        updatedAt: record.updatedAt,
      })
    }

    for (const task of publishTasks) {
      if (task.coverUrl) {
        task.coverUrl = this.assetsService.buildUrl(task.coverUrl)
      }
      if (task.flowId && publishRecordCache.has(task.flowId)) {
        continue
      }

      const taskKey = task.dataId || task.id
      if (result.has(taskKey)) {
        const existingPost = result.get(taskKey)!
        if (task.flowId && !existingPost.flowId) {
          existingPost.flowId = task.flowId
        }
        continue
      }

      const engagement = this.getDefaultEngagement()
      result.set(taskKey, {
        id: task.id,
        flowId: task.flowId || '',
        title: task.title || '',
        desc: task.desc || '',
        dataId: task.dataId,
        type: task.type,
        accountId: task.accountId ?? '',
        accountType: task.accountType,
        uid: task.uid,
        videoUrl: task.videoUrl || '',
        coverUrl: task.coverUrl || '',
        imgUrlList: task.imgUrlList || [],
        publishTime: task.publishTime,
        errorMsg: task.errorMsg || '',
        status: task.status,
        engagement,
        publishingChannel: PublishingChannel.INTERNAL,
        workLink: task.workLink || '',
        topics: task.topics || [],
        updatedAt: task.updatedAt,
      })
    }

    return Array.from(result.values()).sort((a, b) => new Date(b.publishTime).getTime() - new Date(a.publishTime).getTime())
  }

  async getPostHistory(data: PubRecordListFilterDto, userId: string) {
    const [publishRecords, publishTasks] = await Promise.all([
      this.publishRecordService.getPublishRecordList({ ...data, userId }),
      this.publishingService.getPublishTasks({ userId, ...data }),
    ])

    const posts = this.mergePostHistory(publishRecords, publishTasks)
    if (data.publishingChannel) {
      return posts.filter(post => post.publishingChannel === data.publishingChannel)
    }
    return posts
  }

  async getQueuedPublishingTasks(data: PubRecordListFilterDto, userId: string) {
    const publishTasks = await this.publishingService.getQueuedPublishTasks({ userId, ...data })
    const posts = this.mergePostHistory([], publishTasks)
    return posts
  }

  async getPublishedPosts(data: PubRecordListFilterDto, userId: string) {
    const [publishRecords, publishTasks] = await Promise.all([
      this.publishRecordService.getPublishRecordList({ ...data, userId }),
      this.publishingService.getPublishedPublishTasks({ userId, ...data }),
    ])

    const posts = this.mergePostHistory(publishRecords, publishTasks)
    return posts
  }

  async publishInfoData(userId: string) {
    const res = await this.publishRecordService.getPublishInfoData(userId)
    return res
  }

  async publishDataInfoList(userId: string, data: PublishDayInfoListFiltersDto, page: TableDto) {
    return await this.publishRecordService.getPublishDayInfoList({ userId, time: data.time }, page)
  }

  /**
   * Get publish task list of flow id
   * @param flowId
   * @param userId
   * @returns
   */
  async getPublishTaskListOfFlowId(flowId: string, userId: string) {
    const tasks = await this.publishingService.getPublishTasks({ userId, flowId })
    return tasks
  }

  async getPublishRecordDetail(flowId: string, userId: string) {
    try {
      const record = await this.publishRecordService.getPublishRecordDetail({ flowId, userId })
      if (record) {
        return record
      }
    }
    catch (error: any) {
      this.logger.error(`Failed to get publish record detail for flowId ${flowId} and userId ${userId}: ${error.message}`, error.stack)
    }

    const task = await this.publishingService.getPublishTaskInfoWithFlowId(flowId, userId)
    if (!task) {
      throw new AppException(ResponseCode.PublishRecordNotFound)
    }
    return task
  }

  async updatePublishTask(data: UpdatePublishTaskDto, userId: string) {
    try {
      const publishingData: PublishingUpdatePublishTaskDto = { ...data, userId }
      const success = await this.publishingService.updatePublishingTask(publishingData)
      return { success }
    }
    catch (error: unknown) {
      const { message: errorMessage, stack: errorStack } = getErrorDetail(error)
      this.logger.error(`Failed to update publish task for userId ${userId}: ${errorMessage}`, errorStack)
      throw new AppException(ResponseCode.PublishTaskUpdateFailed, errorMessage)
    }
  }

  private mapMaterialToPublishData(material: any, accountId: string, accountType: any, publishTime: Date): CreatePublishDto {
    return this.scheduleRuleService.buildPublishPayloadFromMaterial(material, {
      accountId,
      accountType,
      publishTime,
    })
  }

  private buildViralSlotTimeline(input: {
    startAt: Date
    slots: string[]
    total: number
    timezone: string
  }): Date[] {
    const slots = input.slots
      .map((slot) => {
        const [hour, minute] = slot.split(':').map(v => Number(v))
        return { hour, minute }
      })
      .sort((a, b) => (a.hour * 60 + a.minute) - (b.hour * 60 + b.minute))

    const start = dayjs(input.startAt).tz(input.timezone)
    const times: Date[] = []
    let dayOffset = 0

    while (times.length < input.total) {
      const dayBase = start.startOf('day').add(dayOffset, 'day')
      for (const slot of slots) {
        const candidate = dayBase.hour(slot.hour).minute(slot.minute).second(0).millisecond(0)
        if (candidate.isBefore(start)) {
          continue
        }
        times.push(candidate.toDate())
        if (times.length >= input.total) {
          break
        }
      }
      dayOffset++
    }

    return times
  }

  private buildIntervalTimeline(input: {
    startAt: Date
    intervalHours: number
    total: number
    timezone: string
  }): Date[] {
    const start = dayjs(input.startAt).tz(input.timezone)
    const times: Date[] = []
    for (let i = 0; i < input.total; i++) {
      times.push(start.add(i * input.intervalHours, 'hour').toDate())
    }
    return times
  }

  async createScheduleBatch(userId: string, data: {
    mode: 'viral_slots' | 'interval'
    itemIds: string[]
    accountId: string
    accountType: any
    startAt: Date
    slots?: string[]
    intervalHours?: number
    timezone?: string
  }) {
    const timezone = data.timezone || 'Asia/Jakarta'
    const materials = await this.materialService.getListByIds(data.itemIds)
    const materialMap = new Map(materials.map(item => [item.id, item]))
    const selectedMaterials = data.itemIds
      .map(id => materialMap.get(id))
      .filter(item => !!item && item.userId === userId)

    if (selectedMaterials.length === 0) {
      throw new AppException(ResponseCode.MaterialNotFound)
    }

    let timeline: Date[]
    if (data.mode === 'viral_slots') {
      if (!data.slots || data.slots.length === 0) {
        throw new AppException(ResponseCode.ValidationFailed, 'slots is required for viral_slots')
      }
      timeline = this.buildViralSlotTimeline({
        startAt: data.startAt,
        slots: data.slots,
        total: selectedMaterials.length,
        timezone,
      })
    }
    else {
      if (!data.intervalHours || data.intervalHours <= 0) {
        throw new AppException(ResponseCode.ValidationFailed, 'intervalHours is required for interval mode')
      }
      timeline = this.buildIntervalTimeline({
        startAt: data.startAt,
        intervalHours: data.intervalHours,
        total: selectedMaterials.length,
        timezone,
      })
    }

    const createdTaskIds: string[] = []
    const failedItems: Array<{ materialId: string, title?: string, error: string }> = []
    for (let i = 0; i < selectedMaterials.length; i++) {
      const material = selectedMaterials[i]
      if (!material) {
        continue
      }
      try {
        const publishData = this.mapMaterialToPublishData(material, data.accountId, data.accountType, timeline[i])
        const created = await this.createPublishTaskWithRelaySupport(publishData)
        if (created && typeof created === 'object' && 'id' in created && typeof created.id === 'string') {
          createdTaskIds.push(created.id)
        }
      }
      catch (error: any) {
        failedItems.push({
          materialId: material.id,
          title: material.title,
          error: error?.message || 'Failed creating publish task',
        })
      }
    }

    const firstPublishTime = timeline[0]
    const lastPublishTime = timeline[timeline.length - 1]
    const estimatedDays = Math.max(1, dayjs(lastPublishTime).diff(dayjs(firstPublishTime), 'day') + 1)

    return {
      totalScheduled: createdTaskIds.length,
      totalFailed: failedItems.length,
      firstPublishTime,
      lastPublishTime,
      estimatedDays,
      taskIds: createdTaskIds,
      failedItems,
    }
  }

  async batchUpdatePublishTaskTime(userId: string, updates: { id: string, publishTime: Date }[]) {
    const results = await Promise.allSettled(
      updates.map(item => this.publishingService.updatePublishTaskTime(item.id, item.publishTime, userId)),
    )

    const success = results.filter(result => result.status === 'fulfilled').length
    const failed = results.length - success

    return {
      total: updates.length,
      success,
      failed,
    }
  }

  async createScheduleRule(userId: string, data: {
    materialId: string
    accountId: string
    accountType: any
    frequency: ScheduleRuleFrequency
    weekdays?: number[]
    timeOfDay: string
    timezone?: string
  }) {
    return await this.scheduleRuleService.createRule({
      ...data,
      userId,
    })
  }

  async listScheduleRules(userId: string) {
    return await this.scheduleRuleService.listRules(userId)
  }

  async updateScheduleRule(id: string, userId: string, data: {
    status?: ScheduleRuleStatus
    frequency?: ScheduleRuleFrequency
    weekdays?: number[]
    timeOfDay?: string
    timezone?: string
  }) {
    const updated = await this.scheduleRuleService.updateRule(id, userId, data)
    if (!updated) {
      throw new AppException(ResponseCode.PublishTaskNotFound, 'schedule rule not found')
    }
    return updated
  }

  async deleteScheduleRule(id: string, userId: string) {
    const success = await this.scheduleRuleService.deleteRule(id, userId)
    if (!success) {
      throw new AppException(ResponseCode.PublishTaskNotFound, 'schedule rule not found')
    }
    return { success }
  }

  async queueOverview(userId: string, limit = 200) {
    const tasks = await this.publishingService.getPublishTasks({ userId })

    const grouped = {
      ready: [] as any[],
      queued: [] as any[],
      running: [] as any[],
      published: [] as any[],
      failed: [] as any[],
    }

    for (const task of tasks) {
      if (task.status === PublishStatus.PUBLISHED) {
        grouped.published.push(task)
      }
      else if (task.status === PublishStatus.PUBLISHING || task.status === PublishStatus.UPDATING) {
        grouped.running.push(task)
      }
      else if (task.status === PublishStatus.FAILED || task.status === PublishStatus.UPDATED_FAILED) {
        grouped.failed.push(task)
      }
      else if (task.inQueue || task.queued) {
        grouped.queued.push(task)
      }
      else {
        grouped.ready.push(task)
      }
    }

    return {
      counts: {
        ready: grouped.ready.length,
        queued: grouped.queued.length,
        running: grouped.running.length,
        published: grouped.published.length,
        failed: grouped.failed.length,
      },
      lists: {
        ready: grouped.ready.slice(0, limit),
        queued: grouped.queued.slice(0, limit),
        running: grouped.running.slice(0, limit),
        published: grouped.published.slice(0, limit),
        failed: grouped.failed.slice(0, limit),
      },
    }
  }
}
