import { Injectable, Logger } from '@nestjs/common'
import { RedisService } from '@yikart/redis'
import { AppException, getErrorMessage, ResponseCode } from '@yikart/common'
import { v4 as uuidv4 } from 'uuid'
import { ChannelRedisKeys } from './channel.constants'
import { PublishingService } from './publishing/publishing.service'

export type BulkPublishOperation = 'publish-now' | 'delete-queued' | 'update-time'
type BulkItemStatus = 'pending' | 'running' | 'success' | 'failed'
type BulkBatchState = 'queued' | 'running' | 'completed'

interface BulkPublishBatchItem {
  id: string
  status: BulkItemStatus
  error?: string
  publishTime?: string
  updatedAt: string
}

interface BulkPublishBatchSummary {
  total: number
  pending: number
  running: number
  success: number
  failed: number
}

interface BulkPublishBatchRecord {
  batchId: string
  userId: string
  operation: BulkPublishOperation
  state: BulkBatchState
  idempotencyKey?: string
  createdAt: string
  updatedAt: string
  completedAt?: string
  items: BulkPublishBatchItem[]
  summary: BulkPublishBatchSummary
  options?: {
    publishTime?: string
  }
}

@Injectable()
export class BulkPublishRunnerService {
  private readonly logger = new Logger(BulkPublishRunnerService.name)
  private readonly batchTTLSeconds = 24 * 60 * 60
  private readonly idempotencyTTLSeconds = 60 * 60
  private readonly concurrency = 5

  constructor(
    private readonly redisService: RedisService,
    private readonly publishingService: PublishingService,
  ) {}

  async createPublishNowBatch(
    userId: string,
    ids: string[],
    publishTime?: Date,
    idempotencyKey?: string,
  ) {
    return this.createBatch(
      userId,
      'publish-now',
      ids.map(id => ({
        id,
        status: 'pending',
        updatedAt: new Date().toISOString(),
      })),
      { publishTime: publishTime ? publishTime.toISOString() : undefined },
      idempotencyKey,
    )
  }

  async createDeleteQueuedBatch(userId: string, ids: string[], idempotencyKey?: string) {
    return this.createBatch(
      userId,
      'delete-queued',
      ids.map(id => ({
        id,
        status: 'pending',
        updatedAt: new Date().toISOString(),
      })),
      {},
      idempotencyKey,
    )
  }

  async createUpdateTimeBatch(
    userId: string,
    updates: { id: string, publishTime: Date }[],
    idempotencyKey?: string,
  ) {
    return this.createBatch(
      userId,
      'update-time',
      updates.map(item => ({
        id: item.id,
        publishTime: item.publishTime.toISOString(),
        status: 'pending',
        updatedAt: new Date().toISOString(),
      })),
      {},
      idempotencyKey,
    )
  }

  async getBatchStatus(userId: string, batchId: string): Promise<BulkPublishBatchRecord> {
    const batch = await this.getBatch(batchId)
    if (!batch || batch.userId !== userId) {
      throw new AppException(ResponseCode.PublishTaskNotFound, 'bulk batch not found')
    }
    return batch
  }

  private async createBatch(
    userId: string,
    operation: BulkPublishOperation,
    rawItems: BulkPublishBatchItem[],
    options: { publishTime?: string },
    idempotencyKey?: string,
  ) {
    const deduped = this.dedupeItems(rawItems)

    if (idempotencyKey) {
      const idemKey = ChannelRedisKeys.bulkPublishIdempotency(userId, operation, idempotencyKey)
      const existingBatchId = await this.redisService.get(idemKey)
      if (existingBatchId) {
        const existing = await this.getBatch(existingBatchId)
        if (existing) {
          return {
            batchId: existing.batchId,
            reused: true,
            state: existing.state,
            summary: existing.summary,
          }
        }
      }
    }

    const now = new Date().toISOString()
    const batchId = uuidv4()
    const record: BulkPublishBatchRecord = {
      batchId,
      userId,
      operation,
      state: 'queued',
      idempotencyKey,
      createdAt: now,
      updatedAt: now,
      items: deduped,
      summary: this.calculateSummary(deduped),
      options,
    }

    if (idempotencyKey) {
      const idemKey = ChannelRedisKeys.bulkPublishIdempotency(userId, operation, idempotencyKey)
      const locked = await this.redisService.setNx(idemKey, batchId, this.idempotencyTTLSeconds)
      if (!locked) {
        const existingBatchId = await this.redisService.get(idemKey)
        if (existingBatchId) {
          const existing = await this.getBatch(existingBatchId)
          if (existing) {
            return {
              batchId: existing.batchId,
              reused: true,
              state: existing.state,
              summary: existing.summary,
            }
          }
        }
      }
    }

    await this.saveBatch(record)
    setTimeout(() => {
      void this.runBatch(batchId)
    }, 0)

    return {
      batchId,
      reused: false,
      state: record.state,
      summary: record.summary,
    }
  }

  private async runBatch(batchId: string) {
    const batch = await this.getBatch(batchId)
    if (!batch) {
      return
    }

    batch.state = 'running'
    batch.updatedAt = new Date().toISOString()
    await this.saveBatch(batch)

    let cursor = 0
    const workers = Array.from({ length: Math.min(this.concurrency, batch.items.length) }).map(async () => {
      while (true) {
        const index = cursor++
        if (index >= batch.items.length) {
          return
        }
        await this.executeItem(batch, batch.items[index])
      }
    })

    await Promise.all(workers)

    batch.state = 'completed'
    batch.completedAt = new Date().toISOString()
    batch.updatedAt = batch.completedAt
    batch.summary = this.calculateSummary(batch.items)
    await this.saveBatch(batch)
  }

  private async executeItem(batch: BulkPublishBatchRecord, item: BulkPublishBatchItem) {
    item.status = 'running'
    item.updatedAt = new Date().toISOString()
    batch.updatedAt = item.updatedAt
    batch.summary = this.calculateSummary(batch.items)
    await this.saveBatch(batch)

    try {
      if (batch.operation === 'publish-now') {
        const record = await this.publishingService.getPublishTaskInfoWithUserId(item.id, batch.userId)
        if (!record) {
          throw new AppException(ResponseCode.PublishTaskNotFound)
        }
        const publishTime = batch.options?.publishTime ? new Date(batch.options.publishTime) : undefined
        await this.publishingService.publishTaskImmediately(item.id, publishTime)
      }
      else if (batch.operation === 'delete-queued') {
        const record = await this.publishingService.getPublishTaskInfoWithUserId(item.id, batch.userId)
        if (!record) {
          throw new AppException(ResponseCode.PublishTaskNotFound)
        }
        if (!record.inQueue || !record.queueId) {
          throw new AppException(ResponseCode.PublishTaskStatusInvalid, 'task is not queued')
        }
        await this.publishingService.deletePublishTaskById(item.id, batch.userId)
      }
      else {
        if (!item.publishTime) {
          throw new AppException(ResponseCode.ValidationFailed, 'publishTime is required')
        }
        await this.publishingService.updatePublishTaskTime(item.id, new Date(item.publishTime), batch.userId)
      }

      item.status = 'success'
      item.error = undefined
    }
    catch (error) {
      item.status = 'failed'
      item.error = getErrorMessage(error)
      this.logger.error(`Bulk operation failed: batch=${batch.batchId} item=${item.id} error=${item.error}`)
    }

    item.updatedAt = new Date().toISOString()
    batch.updatedAt = item.updatedAt
    batch.summary = this.calculateSummary(batch.items)
    await this.saveBatch(batch)
  }

  private calculateSummary(items: BulkPublishBatchItem[]): BulkPublishBatchSummary {
    const summary: BulkPublishBatchSummary = {
      total: items.length,
      pending: 0,
      running: 0,
      success: 0,
      failed: 0,
    }

    for (const item of items) {
      if (item.status === 'pending') {
        summary.pending++
      }
      else if (item.status === 'running') {
        summary.running++
      }
      else if (item.status === 'success') {
        summary.success++
      }
      else if (item.status === 'failed') {
        summary.failed++
      }
    }

    return summary
  }

  private async getBatch(batchId: string): Promise<BulkPublishBatchRecord | null> {
    return await this.redisService.getJson<BulkPublishBatchRecord>(ChannelRedisKeys.bulkPublishBatch(batchId))
  }

  private async saveBatch(batch: BulkPublishBatchRecord) {
    await this.redisService.setJson(ChannelRedisKeys.bulkPublishBatch(batch.batchId), batch, this.batchTTLSeconds)
  }

  private dedupeItems(items: BulkPublishBatchItem[]) {
    const seen = new Set<string>()
    const deduped: BulkPublishBatchItem[] = []
    for (const item of items) {
      if (seen.has(item.id)) {
        continue
      }
      seen.add(item.id)
      deduped.push(item)
    }
    return deduped
  }
}

