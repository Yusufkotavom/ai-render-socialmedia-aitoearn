import { request } from '@/utils/request'

export type SchedulerMode = 'viral_slots' | 'interval'
export type SchedulerFrequency = 'daily' | 'weekly' | 'custom_weekdays'
export type SchedulerRuleStatus = 'active' | 'paused'

export interface CreateScheduleBatchPayload {
  mode: SchedulerMode
  itemIds: string[]
  accountId: string
  accountType: string
  startAt: string
  slots?: string[]
  intervalHours?: number
  timezone?: string
}

export interface CreateScheduleRulePayload {
  materialId: string
  accountId: string
  accountType: string
  frequency: SchedulerFrequency
  weekdays?: number[]
  timeOfDay: string
  timezone?: string
}

export interface UpdateScheduleRulePayload {
  status?: SchedulerRuleStatus
  frequency?: SchedulerFrequency
  weekdays?: number[]
  timeOfDay?: string
  timezone?: string
}

export interface ScheduleRule {
  id: string
  materialId: string
  accountId: string
  accountType: string
  frequency: SchedulerFrequency
  weekdays: number[]
  timeOfDay: string
  timezone: string
  status: SchedulerRuleStatus
  nextRunAt: string
  lastRunAt?: string
  createdAt: string
  updatedAt: string
}

export interface QueueOverviewResponse {
  counts: {
    ready: number
    queued: number
    running: number
    published: number
    failed: number
  }
  lists: {
    ready: any[]
    queued: any[]
    running: any[]
    published: any[]
    failed: any[]
  }
}

export function apiCreateScheduleBatch(data: CreateScheduleBatchPayload) {
  return request<{
    totalScheduled: number
    totalFailed?: number
    firstPublishTime: string
    lastPublishTime: string
    estimatedDays: number
    taskIds: string[]
    failedItems?: Array<{ materialId: string, title?: string, error: string }>
  }>({
    url: 'plat/publish/schedule/batch',
    method: 'POST',
    data,
  })
}

export function apiBatchUpdateSchedule(data: { updates: { id: string, publishTime: string }[] }) {
  return request<{ total: number, success: number, failed: number }>({
    url: 'plat/publish/updateTaskTime/batch',
    method: 'POST',
    data,
  })
}

export function apiCreateScheduleRule(data: CreateScheduleRulePayload) {
  return request<ScheduleRule>({
    url: 'plat/publish/schedule/rules',
    method: 'POST',
    data,
  })
}

export function apiListScheduleRules() {
  return request<ScheduleRule[]>({
    url: 'plat/publish/schedule/rules',
    method: 'GET',
  })
}

export function apiUpdateScheduleRule(id: string, data: UpdateScheduleRulePayload) {
  return request<ScheduleRule>({
    url: `plat/publish/schedule/rules/${id}`,
    method: 'POST',
    data,
  })
}

export function apiDeleteScheduleRule(id: string) {
  return request<{ success: boolean }>({
    url: `plat/publish/schedule/rules/${id}`,
    method: 'DELETE',
  })
}

export function apiGetQueueOverview(limit = 200) {
  return request<QueueOverviewResponse>({
    url: 'plat/publish/queue/overview',
    method: 'GET',
    params: { limit },
  })
}
