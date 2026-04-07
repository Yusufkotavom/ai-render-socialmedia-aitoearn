'use client'

import type { PromotionMaterial, PromotionPlan } from '@/app/[lng]/brand-promotion/brandPromotionStore/types'
import type { BulkBatchStatus } from '@/api/bulk-publish'
import dayjs from 'dayjs'
import { CalendarClock, Loader2, RefreshCw, Rocket, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  apiCreateBulkDeleteQueued,
  apiCreateBulkPublishNow,
  apiCreateBulkUpdateTime,
  apiGetBulkBatchStatus,
} from '@/api/bulk-publish'
import { apiGetMaterialGroupList, apiGetMaterialList } from '@/api/material'
import { getPublishList } from '@/api/plat/publish'
import { PublishStatus } from '@/api/plat/types/publish.types'
import type { PublishRecordItem } from '@/api/plat/types/publish.types'
import { apiCreateScheduleBatch } from '@/api/scheduler'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'
import { useAccountStore } from '@/store/account'

type StatusFilter = 'all' | 'queued' | 'running' | 'published' | 'failed'
type ScheduleMode = 'viral_slots' | 'interval'

function matchesStatus(status: PublishStatus, filter: StatusFilter) {
  if (filter === 'all')
    return true
  if (filter === 'queued')
    return status === PublishStatus.UNPUBLISH
  if (filter === 'running')
    return status === PublishStatus.PUB_LOADING
  if (filter === 'published')
    return status === PublishStatus.RELEASED
  return status === PublishStatus.FAIL
}

export default function BulkPublishRunnerShell() {
  const accountList = useAccountStore(state => state.accountList)
  const accountInit = useAccountStore(state => state.accountInit)

  const [loading, setLoading] = useState(false)
  const [posts, setPosts] = useState<PublishRecordItem[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [accountFilter, setAccountFilter] = useState<string>('all')
  const [searchText, setSearchText] = useState('')
  const [bulkPublishTime, setBulkPublishTime] = useState('')

  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>('viral_slots')
  const [scheduleStartAt, setScheduleStartAt] = useState(dayjs().add(30, 'minute').format('YYYY-MM-DDTHH:mm'))
  const [slotsText, setSlotsText] = useState('10:00,15:00,17:00')
  const [intervalHours, setIntervalHours] = useState('4')
  const [scheduleAccountId, setScheduleAccountId] = useState('')
  const [selectedGroupId, setSelectedGroupId] = useState('')
  const [groups, setGroups] = useState<PromotionPlan[]>([])
  const [materials, setMaterials] = useState<PromotionMaterial[]>([])
  const [selectedMaterialIds, setSelectedMaterialIds] = useState<Set<string>>(new Set())

  const [activeBatchId, setActiveBatchId] = useState('')
  const [batchStatus, setBatchStatus] = useState<BulkBatchStatus | null>(null)
  const [polling, setPolling] = useState(false)
  const [runningAction, setRunningAction] = useState<string>('')

  const selectedScheduleAccount = useMemo(
    () => accountList.find(item => item.id === scheduleAccountId),
    [accountList, scheduleAccountId],
  )

  const filteredPosts = useMemo(() => {
    const kw = searchText.trim().toLowerCase()
    return posts.filter((item) => {
      if (accountFilter !== 'all' && item.accountId !== accountFilter) {
        return false
      }
      if (!matchesStatus(item.status, statusFilter)) {
        return false
      }
      if (!kw) {
        return true
      }
      const text = `${item.title || ''} ${item.desc || ''} ${item.id || ''}`.toLowerCase()
      return text.includes(kw)
    })
  }, [accountFilter, posts, searchText, statusFilter])

  const selectedCount = selectedIds.size

  const allVisibleSelected = useMemo(() => {
    if (filteredPosts.length === 0)
      return false
    return filteredPosts.every(item => selectedIds.has(item.id))
  }, [filteredPosts, selectedIds])

  const refreshPosts = useCallback(async () => {
    setLoading(true)
    try {
      const res = await getPublishList({})
      const list = Array.isArray(res?.data) ? res.data : []
      list.sort((a, b) => dayjs(b.publishTime).valueOf() - dayjs(a.publishTime).valueOf())
      setPosts(list)
    }
    finally {
      setLoading(false)
    }
  }, [])

  const refreshGroups = useCallback(async () => {
    const res = await apiGetMaterialGroupList(1, 100)
    const list = Array.isArray(res?.data?.list) ? res.data.list : []
    setGroups(list)
    if (!selectedGroupId && list.length > 0) {
      setSelectedGroupId(list[0].id)
    }
  }, [selectedGroupId])

  const refreshMaterials = useCallback(async (groupId: string) => {
    if (!groupId)
      return
    const res = await apiGetMaterialList(groupId, 1, 200)
    const list = Array.isArray(res?.data?.list) ? res.data.list : []
    setMaterials(list)
    setSelectedMaterialIds(new Set())
  }, [])

  useEffect(() => {
    accountInit()
    void refreshPosts()
    void refreshGroups()
  }, [accountInit, refreshGroups, refreshPosts])

  useEffect(() => {
    if (!scheduleAccountId && accountList.length > 0) {
      setScheduleAccountId(accountList[0].id)
    }
  }, [accountList, scheduleAccountId])

  useEffect(() => {
    if (selectedGroupId) {
      void refreshMaterials(selectedGroupId)
    }
  }, [refreshMaterials, selectedGroupId])

  const refreshBatch = useCallback(async () => {
    if (!activeBatchId)
      return
    const res = await apiGetBulkBatchStatus(activeBatchId)
    if (res?.data) {
      setBatchStatus(res.data)
      if (res.data.state === 'completed') {
        setPolling(false)
      }
    }
  }, [activeBatchId])

  useEffect(() => {
    if (!polling || !activeBatchId)
      return
    const timer = setInterval(() => {
      void refreshBatch()
    }, 2000)
    return () => clearInterval(timer)
  }, [activeBatchId, polling, refreshBatch])

  const startBatchPolling = (batchId: string) => {
    setActiveBatchId(batchId)
    setPolling(true)
    void apiGetBulkBatchStatus(batchId).then((res) => {
      if (res?.data) {
        setBatchStatus(res.data)
      }
    })
  }

  const togglePost = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id))
        next.delete(id)
      else
        next.add(id)
      return next
    })
  }

  const toggleSelectAllVisible = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (allVisibleSelected) {
        for (const item of filteredPosts) {
          next.delete(item.id)
        }
      }
      else {
        for (const item of filteredPosts) {
          next.add(item.id)
        }
      }
      return next
    })
  }

  const runBulkPublishNow = async () => {
    if (selectedCount === 0) {
      toast.error('Select posts first')
      return
    }
    setRunningAction('publish-now')
    try {
      const publishTime = bulkPublishTime ? new Date(bulkPublishTime).toISOString() : undefined
      const res = await apiCreateBulkPublishNow({
        ids: Array.from(selectedIds),
        publishTime,
        idempotencyKey: `bulk-now-${Date.now()}`,
      })
      const batchId = res?.data?.batchId
      if (batchId) {
        startBatchPolling(batchId)
        toast.success('Bulk publish-now submitted')
      }
    }
    finally {
      setRunningAction('')
    }
  }

  const runBulkDeleteQueued = async () => {
    if (selectedCount === 0) {
      toast.error('Select posts first')
      return
    }
    setRunningAction('delete-queued')
    try {
      const res = await apiCreateBulkDeleteQueued({
        ids: Array.from(selectedIds),
        idempotencyKey: `bulk-del-${Date.now()}`,
      })
      const batchId = res?.data?.batchId
      if (batchId) {
        startBatchPolling(batchId)
        toast.success('Bulk delete-queued submitted')
      }
    }
    finally {
      setRunningAction('')
    }
  }

  const runBulkUpdateTime = async () => {
    if (selectedCount === 0) {
      toast.error('Select posts first')
      return
    }
    if (!bulkPublishTime) {
      toast.error('Select publish time first')
      return
    }
    setRunningAction('update-time')
    try {
      const publishTime = new Date(bulkPublishTime).toISOString()
      const res = await apiCreateBulkUpdateTime({
        updates: Array.from(selectedIds).map(id => ({ id, publishTime })),
        idempotencyKey: `bulk-time-${Date.now()}`,
      })
      const batchId = res?.data?.batchId
      if (batchId) {
        startBatchPolling(batchId)
        toast.success('Bulk update-time submitted')
      }
    }
    finally {
      setRunningAction('')
    }
  }

  const runScheduleBatch = async () => {
    if (!selectedScheduleAccount) {
      toast.error('Select account first')
      return
    }
    if (selectedMaterialIds.size === 0) {
      toast.error('Select materials first')
      return
    }
    setRunningAction('schedule')
    try {
      const payload: any = {
        mode: scheduleMode,
        itemIds: Array.from(selectedMaterialIds),
        accountId: selectedScheduleAccount.id,
        accountType: selectedScheduleAccount.type,
        startAt: new Date(scheduleStartAt).toISOString(),
        timezone: 'Asia/Jakarta',
      }
      if (scheduleMode === 'viral_slots') {
        payload.slots = slotsText.split(',').map(v => v.trim()).filter(Boolean)
      }
      else {
        payload.intervalHours = Math.max(1, Number(intervalHours) || 1)
      }
      const res = await apiCreateScheduleBatch(payload)
      const scheduled = res?.data?.totalScheduled || 0
      const failed = res?.data?.totalFailed || 0
      toast.success(`Schedule done: success=${scheduled} failed=${failed}`)
      void refreshPosts()
    }
    finally {
      setRunningAction('')
    }
  }

  const progress = useMemo(() => {
    const summary = batchStatus?.summary
    if (!summary || summary.total === 0)
      return 0
    return Math.round(((summary.success + summary.failed) / summary.total) * 100)
  }, [batchStatus])

  const retryFailedSubset = async () => {
    if (!batchStatus) {
      return
    }
    const failedItems = batchStatus.items.filter(item => item.status === 'failed')
    if (failedItems.length === 0) {
      toast.error('No failed item to retry')
      return
    }
    setRunningAction('retry-failed')
    try {
      if (batchStatus.operation === 'publish-now') {
        const res = await apiCreateBulkPublishNow({
          ids: failedItems.map(item => item.id),
          publishTime: batchStatus.options?.publishTime,
          idempotencyKey: `bulk-retry-now-${Date.now()}`,
        })
        if (res?.data?.batchId) {
          startBatchPolling(res.data.batchId)
        }
      }
      else if (batchStatus.operation === 'delete-queued') {
        const res = await apiCreateBulkDeleteQueued({
          ids: failedItems.map(item => item.id),
          idempotencyKey: `bulk-retry-delete-${Date.now()}`,
        })
        if (res?.data?.batchId) {
          startBatchPolling(res.data.batchId)
        }
      }
      else {
        const updates = failedItems
          .filter(item => !!item.publishTime)
          .map(item => ({
            id: item.id,
            publishTime: item.publishTime!,
          }))
        if (updates.length === 0) {
          toast.error('No publish time found on failed items')
          return
        }
        const res = await apiCreateBulkUpdateTime({
          updates,
          idempotencyKey: `bulk-retry-time-${Date.now()}`,
        })
        if (res?.data?.batchId) {
          startBatchPolling(res.data.batchId)
        }
      }
      toast.success(`Retry submitted for ${failedItems.length} failed item(s)`)
    }
    finally {
      setRunningAction('')
    }
  }

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl md:text-2xl font-semibold">Bulk Publish Runner</h1>
          <p className="text-sm text-muted-foreground">One place to run bulk publish operations asynchronously.</p>
        </div>
        <Button variant="outline" onClick={() => void refreshPosts()} disabled={loading}>
          {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
          Refresh
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Input Selection (Publish Records)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
            <Select value={accountFilter} onValueChange={setAccountFilter}>
              <SelectTrigger><SelectValue placeholder="Account filter" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Accounts</SelectItem>
                {accountList.map(item => (
                  <SelectItem key={item.id} value={item.id}>{item.nickname || item.account || item.id}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
              <SelectTrigger><SelectValue placeholder="Status filter" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="queued">Queued</SelectItem>
                <SelectItem value="running">Running</SelectItem>
                <SelectItem value="published">Published</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
              </SelectContent>
            </Select>
            <Input value={searchText} onChange={e => setSearchText(e.target.value)} placeholder="Search title/desc/id" />
            <Input type="datetime-local" value={bulkPublishTime} onChange={e => setBulkPublishTime(e.target.value)} />
          </div>

          <div className="flex items-center justify-between text-sm">
            <div className="text-muted-foreground">Visible: {filteredPosts.length} | Selected: {selectedCount}</div>
            <Button variant="ghost" size="sm" onClick={toggleSelectAllVisible}>
              {allVisibleSelected ? 'Unselect Visible' : 'Select Visible'}
            </Button>
          </div>

          <div className="max-h-[360px] overflow-auto rounded border">
            {filteredPosts.map((item) => (
              <div key={item.id} className="flex items-center gap-3 p-2 border-b last:border-b-0">
                <Checkbox checked={selectedIds.has(item.id)} onCheckedChange={() => togglePost(item.id)} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm truncate">{item.title || '(No title)'} · {item.accountType}</div>
                  <div className="text-xs text-muted-foreground truncate">{item.id} · {dayjs(item.publishTime).format('YYYY-MM-DD HH:mm')}</div>
                </div>
              </div>
            ))}
            {filteredPosts.length === 0 && (
              <div className="p-3 text-sm text-muted-foreground">No records.</div>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Bulk Actions (Async)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Button className="w-full" onClick={() => void runBulkPublishNow()} disabled={runningAction !== ''}>
              {runningAction === 'publish-now' ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Rocket className="w-4 h-4 mr-2" />}
              Publish Now Batch
            </Button>
            <Button className="w-full" variant="outline" onClick={() => void runBulkUpdateTime()} disabled={runningAction !== ''}>
              {runningAction === 'update-time' ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CalendarClock className="w-4 h-4 mr-2" />}
              Update Time Batch
            </Button>
            <Button className="w-full" variant="destructive" onClick={() => void runBulkDeleteQueued()} disabled={runningAction !== ''}>
              {runningAction === 'delete-queued' ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Trash2 className="w-4 h-4 mr-2" />}
              Delete Queued Batch
            </Button>
            <div className="text-xs text-muted-foreground">
              Delete Queued only succeeds for tasks that are currently in queue.
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Schedule Batch (Materials)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <Select value={scheduleAccountId} onValueChange={setScheduleAccountId}>
                <SelectTrigger><SelectValue placeholder="Account" /></SelectTrigger>
                <SelectContent>
                  {accountList.map(item => (
                    <SelectItem key={item.id} value={item.id}>{item.nickname || item.account || item.id}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={scheduleMode} onValueChange={(v) => setScheduleMode(v as ScheduleMode)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="viral_slots">viral_slots</SelectItem>
                  <SelectItem value="interval">interval</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Input type="datetime-local" value={scheduleStartAt} onChange={e => setScheduleStartAt(e.target.value)} />
            {scheduleMode === 'viral_slots'
              ? <Input value={slotsText} onChange={e => setSlotsText(e.target.value)} placeholder="10:00,15:00,17:00" />
              : <Input value={intervalHours} onChange={e => setIntervalHours(e.target.value)} placeholder="Interval hours" />}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <Select value={selectedGroupId} onValueChange={setSelectedGroupId}>
                <SelectTrigger><SelectValue placeholder="Material group" /></SelectTrigger>
                <SelectContent>
                  {groups.map(group => (
                    <SelectItem key={group.id} value={group.id}>{group.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="text-xs text-muted-foreground flex items-center">
                Selected Materials: {selectedMaterialIds.size}
              </div>
            </div>
            <div className="max-h-[160px] overflow-auto rounded border">
              {materials.map(item => (
                <label key={item.id} className="flex items-center gap-2 p-2 border-b last:border-b-0">
                  <Checkbox
                    checked={selectedMaterialIds.has(item.id)}
                    onCheckedChange={() => {
                      setSelectedMaterialIds((prev) => {
                        const next = new Set(prev)
                        if (next.has(item.id))
                          next.delete(item.id)
                        else
                          next.add(item.id)
                        return next
                      })
                    }}
                  />
                  <span className="text-sm truncate">{item.title || item.id}</span>
                </label>
              ))}
            </div>
            <Button className="w-full" onClick={() => void runScheduleBatch()} disabled={runningAction !== ''}>
              {runningAction === 'schedule' ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CalendarClock className="w-4 h-4 mr-2" />}
              Apply Schedule Batch
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Execution Monitor</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {!batchStatus && <div className="text-sm text-muted-foreground">No active batch yet.</div>}
          {batchStatus && (
            <>
              <div className="text-sm">
                Batch: <span className="font-mono">{batchStatus.batchId}</span> · Operation: <span className="font-medium">{batchStatus.operation}</span> · State: <span className="font-medium">{batchStatus.state}</span>
              </div>
              <div className="w-full h-2 rounded bg-muted overflow-hidden">
                <div className={cn('h-full bg-primary transition-all')} style={{ width: `${progress}%` }} />
              </div>
              <div className="text-xs text-muted-foreground">
                total={batchStatus.summary.total} pending={batchStatus.summary.pending} running={batchStatus.summary.running} success={batchStatus.summary.success} failed={batchStatus.summary.failed}
              </div>
              <div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void retryFailedSubset()}
                  disabled={runningAction !== '' || batchStatus.summary.failed === 0}
                >
                  {runningAction === 'retry-failed' ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                  Retry Failed
                </Button>
              </div>
              <div className="max-h-[260px] overflow-auto rounded border">
                {batchStatus.items.map(item => (
                  <div key={`${batchStatus.batchId}-${item.id}`} className="p-2 border-b last:border-b-0">
                    <div className="text-sm flex items-center justify-between gap-2">
                      <span className="font-mono truncate">{item.id}</span>
                      <span className={cn(
                        'text-xs px-2 py-0.5 rounded',
                        item.status === 'success' && 'bg-green-100 text-green-700',
                        item.status === 'failed' && 'bg-red-100 text-red-700',
                        item.status === 'running' && 'bg-blue-100 text-blue-700',
                        item.status === 'pending' && 'bg-muted text-muted-foreground',
                      )}
                      >
                        {item.status}
                      </span>
                    </div>
                    {item.error && <div className="text-xs text-red-600 mt-1">{item.error}</div>}
                  </div>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
