/**
 * BatchActionBar - 批量模式底部固定操作栏
 * 显示已选数量、取消按钮、删除按钮
 */

'use client'

import type { MetadataBatchStatusResponse } from '@/api/metadataGeneration'
import type { PromotionMaterial } from '@/app/[lng]/brand-promotion/brandPromotionStore/types'
import { ArrowRightLeft, Eraser, Loader2, PencilLine, Sparkles, Trash2 } from 'lucide-react'
import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { apiGetMaterialGroupList, apiUpdateMaterial } from '@/api/material'
import { apiCreateMetadataBatch, apiGetMetadataBatchJob } from '@/api/metadataGeneration'
import { usePlanDetailStore } from '@/app/[lng]/brand-promotion/planDetailStore'
import { useTransClient } from '@/app/i18n/client'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { confirm } from '@/lib/confirm'
import { toast } from '@/lib/toast'
import { buildPromptFromTemplate, extractHashTags } from '@/utils/metadataAi'
import { useMetadataAiSettingsStore } from '../CreateMaterialModal/metadataAiSettingsStore'

const BatchActionBar = memo(() => {
  const { t } = useTransClient('brandPromotion')
  const [batchGenerating, setBatchGenerating] = useState(false)
  const [activeJobId, setActiveJobId] = useState<string>()
  const [batchStatus, setBatchStatus] = useState<MetadataBatchStatusResponse>()
  const [applyingResults, setApplyingResults] = useState(false)
  const [appliedJobId, setAppliedJobId] = useState<string>()
  const [moving, setMoving] = useState(false)
  const [groupOptions, setGroupOptions] = useState<Array<{ id: string, name: string }>>([])
  const [targetGroupId, setTargetGroupId] = useState<string>('')
  const [metadataDialogOpen, setMetadataDialogOpen] = useState(false)
  const [metadataSaving, setMetadataSaving] = useState(false)
  const [metaTitle, setMetaTitle] = useState('')
  const [metaDesc, setMetaDesc] = useState('')
  const [metaTags, setMetaTags] = useState('')

  const { selectedMaterialIds, batchDeleting, materials } = usePlanDetailStore(
    useShallow(state => ({
      selectedMaterialIds: state.selectedMaterialIds,
      batchDeleting: state.batchDeleting,
      materials: state.materials,
    })),
  )
  const metadataSettings = useMetadataAiSettingsStore(state => state.settings)

  const selectedMaterials = useMemo(() => {
    const idSet = new Set(selectedMaterialIds)
    return materials.filter(item => idSet.has(item.id))
  }, [materials, selectedMaterialIds])

  const exitBatchMode = usePlanDetailStore(state => state.exitBatchMode)
  const batchDeleteMaterials = usePlanDetailStore(state => state.batchDeleteMaterials)
  const currentPlan = usePlanDetailStore(state => state.currentPlan)
  const fetchMaterials = usePlanDetailStore(state => state.fetchMaterials)

  useEffect(() => {
    let mounted = true
    const run = async () => {
      const res = await apiGetMaterialGroupList(1, 100)
      if (!mounted)
        return
      const list = (res?.data?.list || []).map(item => ({
        id: item.id,
        name: item.name || item.title || item.id,
      }))
      setGroupOptions(list)
      if (!targetGroupId) {
        const fallback = list.find(item => item.id !== currentPlan?.id)?.id || ''
        setTargetGroupId(fallback)
      }
    }

    void run()
    return () => {
      mounted = false
    }
  }, [currentPlan?.id, targetGroupId])

  const extractTags = (material: PromotionMaterial) => {
    const topicTags = (material.topics || []).filter(Boolean).map(tag => String(tag).replace(/^#/, '').trim())
    const descTags = extractHashTags(material.desc)
    return Array.from(new Set([...topicTags, ...descTags]))
  }

  const buildDescriptionWithTags = useCallback((description: string, tags: string[]) => {
    const descriptionLines = description.split('\n')
    while (descriptionLines.length > 0) {
      const lastLine = descriptionLines[descriptionLines.length - 1]?.trim() || ''
      if (!lastLine) {
        descriptionLines.pop()
        continue
      }
      const isHashtagLine = lastLine
        .split(/\s+/)
        .every(word => word.startsWith('#'))
      if (isHashtagLine) {
        descriptionLines.pop()
        continue
      }
      break
    }

    const cleanDescription = descriptionLines.join('\n').trim()
    if (tags.length === 0) {
      return cleanDescription
    }

    return `${cleanDescription}\n\n${tags.map(tag => `#${tag}`).join(' ')}`.trim()
  }, [])

  const applyBatchResults = useCallback(async (status: MetadataBatchStatusResponse) => {
    if (!currentPlan || applyingResults || appliedJobId === status.jobId) {
      return
    }

    const successfulItems = status.items.filter(item => item.status === 'success' && item.result)
    if (successfulItems.length === 0) {
      setAppliedJobId(status.jobId)
      return
    }

    setApplyingResults(true)
    try {
      const updateResults = await Promise.allSettled(successfulItems.map(async (item) => {
        const material = selectedMaterials[item.index]
        const generated = item.result
        if (!material || !generated) {
          return false
        }

        const nextTitle = generated.title || material.title || ''
        const nextDescription = generated.description || material.desc || ''
        const nextTags = Array.from(new Set((generated.tags || []).filter(Boolean).slice(0, 10)))
        const nextDesc = buildDescriptionWithTags(nextDescription, nextTags)

        const res = await apiUpdateMaterial(material.id, {
          coverUrl: material.coverUrl,
          mediaList: material.mediaList,
          title: nextTitle,
          desc: nextDesc,
          location: material.location,
          option: material.option,
          accountTypes: material.accountTypes,
        })

        return res?.code === 0
      }))

      const persistedCount = updateResults.filter((result) => {
        return result.status === 'fulfilled' && result.value
      }).length

      setAppliedJobId(status.jobId)
      await fetchMaterials(currentPlan.id, 1)

      if (persistedCount > 0) {
        toast.success(t('draftManage.batchGenerateApplySuccess', {
          count: persistedCount,
        }))
      }
      else {
        toast.error(t('draftManage.batchGenerateApplyFailed'))
      }
    }
    catch {
      toast.error(t('draftManage.batchGenerateApplyFailed'))
    }
    finally {
      setApplyingResults(false)
    }
  }, [appliedJobId, applyingResults, buildDescriptionWithTags, currentPlan, fetchMaterials, selectedMaterials, t])

  const updateSelectedMaterials = useCallback(async (
    updater: (material: PromotionMaterial) => Parameters<typeof apiUpdateMaterial>[1],
  ) => {
    if (!currentPlan || selectedMaterials.length === 0) {
      return 0
    }

    const results = await Promise.allSettled(selectedMaterials.map(async (material) => {
      const payload = updater(material)
      const res = await apiUpdateMaterial(material.id, payload)
      return res?.code === 0
    }))

    const successCount = results.filter(result => result.status === 'fulfilled' && result.value).length
    await fetchMaterials(currentPlan.id, 1)
    return successCount
  }, [currentPlan, fetchMaterials, selectedMaterials])

  const handleClearMetadata = useCallback(() => {
    if (selectedMaterials.length === 0) {
      return
    }

    confirm({
      title: 'Clear metadata',
      content: `Clear metadata for ${selectedMaterials.length} selected drafts?`,
      onOk: async () => {
        const successCount = await updateSelectedMaterials(material => ({
          coverUrl: material.coverUrl,
          mediaList: material.mediaList,
          title: '',
          desc: '',
          topics: [],
          location: material.location,
          option: material.option,
          accountTypes: material.accountTypes,
        }))
        if (successCount > 0) {
          toast.success(`Cleared metadata for ${successCount} drafts`)
        }
        else {
          toast.error('Failed to clear metadata')
        }
      },
    })
  }, [selectedMaterials.length, t, updateSelectedMaterials])

  const handleSaveMetadataCrud = useCallback(async () => {
    const tags = metaTags.split(',').map(tag => tag.trim().replace(/^#/, '')).filter(Boolean)
    setMetadataSaving(true)
    try {
      const successCount = await updateSelectedMaterials(material => ({
        coverUrl: material.coverUrl,
        mediaList: material.mediaList,
        title: metaTitle.trim() || material.title || '',
        desc: metaDesc.trim() || material.desc || '',
        topics: tags.length > 0 ? tags : (material.topics || []),
        location: material.location,
        option: material.option,
        accountTypes: material.accountTypes,
      }))

      if (successCount > 0) {
        toast.success(`Updated metadata for ${successCount} drafts`)
        setMetadataDialogOpen(false)
      }
      else {
        toast.error('Failed to update metadata')
      }
    }
    finally {
      setMetadataSaving(false)
    }
  }, [metaDesc, metaTags, metaTitle, t, updateSelectedMaterials])

  const handleMoveToGroup = useCallback(async () => {
    if (!targetGroupId || !currentPlan || selectedMaterials.length === 0) {
      return
    }
    if (targetGroupId === currentPlan.id) {
      toast.error('Choose another promotion tab')
      return
    }

    setMoving(true)
    try {
      const successCount = await updateSelectedMaterials(material => ({
        coverUrl: material.coverUrl,
        mediaList: material.mediaList,
        title: material.title,
        desc: material.desc,
        topics: material.topics,
        location: material.location,
        option: material.option,
        accountTypes: material.accountTypes,
        groupId: targetGroupId,
      }))
      if (successCount > 0) {
        toast.success(`Moved ${successCount} drafts`)
      }
      else {
        toast.error('Move failed')
      }
    }
    finally {
      setMoving(false)
    }
  }, [targetGroupId, currentPlan, selectedMaterials.length, updateSelectedMaterials, t])

  const handleBatchGenerateMetadata = useCallback(async () => {
    if (selectedMaterials.length === 0)
      return

    setBatchGenerating(true)
    try {
      const response = await apiCreateMetadataBatch({
        provider: metadataSettings.provider,
        model: metadataSettings.model,
        strategy: metadataSettings.strategy,
        promptTemplate: metadataSettings.promptTemplate,
        items: selectedMaterials.map((material) => {
          const tags = extractTags(material)
          const platforms = (material.accountTypes || []).map(type => String(type))
          return {
            materialId: material.id,
            title: material.title || '',
            description: material.desc || '',
            tags,
            platforms,
            prompt: buildPromptFromTemplate(metadataSettings.promptTemplate, {
              title: material.title || '',
              description: material.desc || '',
              tags,
              platforms,
            }),
          }
        }),
      })

      if (response?.code !== 0 || !response?.data?.jobId) {
        toast.error(response?.message || t('draftManage.batchGenerateMetadataFailed'))
        return
      }

      setActiveJobId(response.data.jobId)
      setAppliedJobId(undefined)
      setBatchStatus(undefined)
      toast.success(t('draftManage.batchGenerateMetadataStarted', { count: selectedMaterials.length }))
    }
    catch {
      toast.error(t('draftManage.batchGenerateMetadataFailed'))
    }
    finally {
      setBatchGenerating(false)
    }
  }, [selectedMaterials, metadataSettings, t])

  useEffect(() => {
    if (!activeJobId)
      return

    let stopped = false
    const run = async () => {
      const response = await apiGetMetadataBatchJob(activeJobId)
      if (stopped || response?.code !== 0 || !response?.data)
        return
      setBatchStatus(response.data)
      if (response.data.status === 'completed' || response.data.status === 'failed') {
        void applyBatchResults(response.data)
        return
      }
      setTimeout(run, 1500)
    }

    void run()
    return () => {
      stopped = true
    }
  }, [activeJobId])

  const handleRetryFailed = useCallback(async () => {
    if (!batchStatus || batchStatus.failedCount === 0)
      return
    const failedItems = batchStatus.items.filter(item => item.status === 'failed')
    const failedMaterials = failedItems
      .map(item => selectedMaterials[item.index])
      .filter(Boolean)

    if (failedMaterials.length === 0)
      return

    setBatchGenerating(true)
    try {
      const response = await apiCreateMetadataBatch({
        provider: metadataSettings.provider,
        model: metadataSettings.model,
        strategy: metadataSettings.strategy,
        promptTemplate: metadataSettings.promptTemplate,
        items: failedMaterials.map((material) => {
          const tags = extractTags(material)
          const platforms = (material.accountTypes || []).map(type => String(type))
          return {
            materialId: material.id,
            title: material.title || '',
            description: material.desc || '',
            tags,
            platforms,
            prompt: buildPromptFromTemplate(metadataSettings.promptTemplate, {
              title: material.title || '',
              description: material.desc || '',
              tags,
              platforms,
            }),
          }
        }),
      })
      if (response?.code !== 0 || !response?.data?.jobId) {
        toast.error(response?.message || t('draftManage.batchGenerateMetadataFailed'))
        return
      }
      setActiveJobId(response.data.jobId)
      setBatchStatus(undefined)
      toast.success(t('draftManage.batchGenerateRetryStarted', { count: failedMaterials.length }))
    }
    catch {
      toast.error(t('draftManage.batchGenerateMetadataFailed'))
    }
    finally {
      setBatchGenerating(false)
    }
  }, [batchStatus, selectedMaterials, metadataSettings, t])

  const handleDelete = useCallback(() => {
    const count = selectedMaterialIds.length
    if (count === 0)
      return

    confirm({
      title: t('draftManage.batchDeleteConfirmTitle'),
      content: t('draftManage.batchDeleteConfirmDesc', { count }),
      okType: 'destructive',
      onOk: async () => {
        const success = await batchDeleteMaterials()
        if (success) {
          toast.success(t('draftManage.batchDeleteSuccess'))
        }
        else {
          toast.error(t('draftManage.batchDeleteFailed'))
        }
      },
    })
  }, [selectedMaterialIds.length, batchDeleteMaterials, t])

  return (
    <>
      <div data-testid="draftbox-batch-bar" className="fixed bottom-0 left-0 right-0 z-50 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 px-3 md:px-6 py-2.5">
        <div className="flex items-center justify-between gap-2 max-w-screen-2xl mx-auto">
          <span data-testid="draftbox-batch-selected-count" className="text-xs text-muted-foreground whitespace-nowrap">
            {selectedMaterialIds.length} selected
          </span>

          <div className="flex items-center gap-1.5 flex-wrap justify-end">
            {batchStatus && (
              <div className="text-[10px] text-muted-foreground mr-1.5">
                {batchStatus.successCount}/{batchStatus.total}
              </div>
            )}

            <Select value={targetGroupId} onValueChange={setTargetGroupId}>
              <SelectTrigger className="h-8 w-[140px] text-xs">
                <SelectValue placeholder="Move to..." />
              </SelectTrigger>
              <SelectContent>
                {groupOptions
                  .filter(item => item.id !== currentPlan?.id)
                  .map(item => (
                    <SelectItem key={item.id} value={item.id} className="text-xs">
                      {item.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>

            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={handleMoveToGroup}
                    disabled={!targetGroupId || moving}
                    className="h-8 w-8 cursor-pointer"
                  >
                    {moving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRightLeft className="h-4 w-4" />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Move to promotion tab</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-8 w-8 cursor-pointer"
                    onClick={() => setMetadataDialogOpen(true)}
                    disabled={selectedMaterialIds.length === 0}
                  >
                    <PencilLine className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Metadata CRUD</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-8 w-8 cursor-pointer"
                    onClick={handleClearMetadata}
                    disabled={selectedMaterialIds.length === 0}
                  >
                    <Eraser className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Clear metadata</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    data-testid="draftbox-batch-generate-metadata-btn"
                    variant="outline"
                    size="icon"
                    onClick={handleBatchGenerateMetadata}
                    disabled={selectedMaterialIds.length === 0 || batchGenerating || applyingResults}
                    className="h-8 w-8 cursor-pointer"
                  >
                    {batchGenerating || applyingResults
                      ? <Loader2 className="h-4 w-4 animate-spin" />
                      : <Sparkles className="h-4 w-4" />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t('draftManage.batchGenerateMetadata')}</TooltipContent>
              </Tooltip>

              {batchStatus?.failedCount
                ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="secondary"
                          size="icon"
                          onClick={handleRetryFailed}
                          disabled={batchGenerating}
                          className="h-8 w-8 cursor-pointer"
                        >
                          <span className="text-[10px]">R</span>
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{t('draftManage.batchGenerateRetryFailed')}</TooltipContent>
                    </Tooltip>
                  )
                : null}

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" onClick={exitBatchMode} className="h-8 w-8 cursor-pointer">
                    <span className="text-[10px]">X</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t('draftManage.cancel')}</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    data-testid="draftbox-batch-delete-btn"
                    variant="destructive"
                    size="icon"
                    onClick={handleDelete}
                    disabled={selectedMaterialIds.length === 0 || batchDeleting}
                    className="h-8 w-8 cursor-pointer"
                  >
                    {batchDeleting
                      ? <Loader2 className="h-4 w-4 animate-spin" />
                      : <Trash2 className="h-4 w-4" />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t('common.delete')}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>
      </div>

      <Dialog open={metadataDialogOpen} onOpenChange={setMetadataDialogOpen}>
        <DialogContent className="sm:max-w-[540px]">
          <DialogHeader>
            <DialogTitle>Batch Metadata CRUD</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              value={metaTitle}
              onChange={e => setMetaTitle(e.target.value)}
              placeholder="Title (leave empty to keep current)"
              className="h-9 text-xs"
            />
            <Textarea
              value={metaDesc}
              onChange={e => setMetaDesc(e.target.value)}
              placeholder="Description (leave empty to keep current)"
              className="min-h-[92px] text-xs"
            />
            <Input
              value={metaTags}
              onChange={e => setMetaTags(e.target.value)}
              placeholder="Tags separated by comma, example: promo, launch, spring"
              className="h-9 text-xs"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMetadataDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSaveMetadataCrud} disabled={metadataSaving}>
              {metadataSaving ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}
              Apply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
})

BatchActionBar.displayName = 'BatchActionBar'

export { BatchActionBar }
