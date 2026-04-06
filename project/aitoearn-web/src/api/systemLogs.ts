import http from '@/utils/request'

export interface GetLogsParams {
  page?: number
  limit?: number
  level?: string
  search?: string
}

export function getSystemLogsApi(params: GetLogsParams) {
  return http.get<any>('system-logs', params)
}
