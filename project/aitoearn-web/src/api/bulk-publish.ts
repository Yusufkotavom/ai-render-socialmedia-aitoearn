import { request } from '@/utils/request'

export type BulkBatchItemStatus = 'pending' | 'running' | 'success' | 'failed'
export type BulkBatchState = 'queued' | 'running' | 'completed'
export type BulkBatchOperation = 'publish-now' | 'delete-queued' | 'update-time'

export interface BulkBatchItem {
  id: string
  status: BulkBatchItemStatus
  error?: string
  publishTime?: string
  updatedAt: string
}

export interface BulkBatchSummary {
  total: number
  pending: number
  running: number
  success: number
  failed: number
}

export interface BulkBatchStatus {
  batchId: string
  operation: BulkBatchOperation
  state: BulkBatchState
  createdAt: string
  updatedAt: string
  completedAt?: string
  options?: {
    publishTime?: string
  }
  summary: BulkBatchSummary
  items: BulkBatchItem[]
}

export function apiCreateBulkPublishNow(data: {
  ids: string[]
  publishTime?: string
  idempotencyKey?: string
}) {
  return request<{
    batchId: string
    reused: boolean
    state: BulkBatchState
    summary: BulkBatchSummary
  }>({
    url: 'plat/publish/bulk/publish-now',
    method: 'POST',
    data,
  })
}

export function apiCreateBulkDeleteQueued(data: { ids: string[], idempotencyKey?: string }) {
  return request<{
    batchId: string
    reused: boolean
    state: BulkBatchState
    summary: BulkBatchSummary
  }>({
    url: 'plat/publish/bulk/delete-queued',
    method: 'POST',
    data,
  })
}

export function apiCreateBulkUpdateTime(data: {
  updates: { id: string, publishTime: string }[]
  idempotencyKey?: string
}) {
  return request<{
    batchId: string
    reused: boolean
    state: BulkBatchState
    summary: BulkBatchSummary
  }>({
    url: 'plat/publish/bulk/update-time',
    method: 'POST',
    data,
  })
}

export function apiGetBulkBatchStatus(batchId: string) {
  return request<BulkBatchStatus>({
    url: `plat/publish/bulk/${batchId}`,
    method: 'GET',
  })
}
