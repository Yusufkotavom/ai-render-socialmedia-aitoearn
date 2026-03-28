/**
 * DraftListToolbar - 草稿列表工具栏
 * 搜索栏 + 批量/条件删除按钮 | 批量模式：全选 + 已选数 + 取消
 */

'use client'

import type { MaterialListFilters } from '@/api/material'
import lodash from 'lodash'
import { Grid3X3, Info, List, Search, Trash2 } from 'lucide-react'
import { memo, useCallback, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { usePlanDetailStore } from '@/app/[lng]/brand-promotion/planDetailStore'
import { useTransClient } from '@/app/i18n/client'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

export type DraftViewMode = 'grid' | 'list'

interface DraftListToolbarProps {
  viewMode: DraftViewMode
  onViewModeChange: (mode: DraftViewMode) => void
  compactInfo: boolean
  onToggleCompactInfo: () => void
  allowDraftActions?: boolean
}

const DraftListToolbar = memo(({
  viewMode,
  onViewModeChange,
  compactInfo,
  onToggleCompactInfo,
  allowDraftActions = true,
}: DraftListToolbarProps) => {
  const { t } = useTransClient('brandPromotion')

  const {
    batchMode,
    selectedMaterialIds,
    materials,
    materialsFilter,
  } = usePlanDetailStore(
    useShallow(state => ({
      batchMode: state.batchMode,
      selectedMaterialIds: state.selectedMaterialIds,
      materials: state.materials,
      materialsFilter: state.materialsFilter,
    })),
  )

  const setMaterialsFilter = usePlanDetailStore(state => state.setMaterialsFilter)
  const enterBatchMode = usePlanDetailStore(state => state.enterBatchMode)
  const exitBatchMode = usePlanDetailStore(state => state.exitBatchMode)
  const selectAllLoadedMaterials = usePlanDetailStore(state => state.selectAllLoadedMaterials)
  const deselectAllMaterials = usePlanDetailStore(state => state.deselectAllMaterials)
  const openConditionalDeleteDialog = usePlanDetailStore(state => state.openConditionalDeleteDialog)

  const [searchValue, setSearchValue] = useState(materialsFilter.title || '')

  const debouncedSetFilter = useMemo(
    () => lodash.debounce((filter: MaterialListFilters) => {
      setMaterialsFilter(filter)
    }, 500),
    [setMaterialsFilter],
  )

  // 清理 debounce
  const debouncedRef = useRef(debouncedSetFilter)
  debouncedRef.current = debouncedSetFilter

  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setSearchValue(value)
    const { materialsFilter } = usePlanDetailStore.getState()
    debouncedRef.current({
      ...materialsFilter,
      title: value || undefined,
    })
  }, [])

  const allSelected = materials.length > 0 && selectedMaterialIds.length === materials.length

  const handleToggleSelectAll = useCallback(() => {
    if (allSelected) {
      deselectAllMaterials()
    }
    else {
      selectAllLoadedMaterials()
    }
  }, [allSelected, deselectAllMaterials, selectAllLoadedMaterials])

  if (allowDraftActions && batchMode) {
    return (
      <div className="flex items-center gap-3 mb-4">
        <div data-testid="draftbox-select-all-checkbox" className="flex items-center gap-2 cursor-pointer" onClick={handleToggleSelectAll}>
          <Checkbox checked={allSelected} onCheckedChange={handleToggleSelectAll} />
          <span className="text-xs">{t('draftManage.selectAll')}</span>
        </div>
        <span className="text-xs text-muted-foreground">
          {t('draftManage.selectedCount', { count: selectedMaterialIds.length })}
        </span>
        <div className="flex-1" />
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button data-testid="draftbox-batch-cancel-btn" variant="ghost" size="icon" onClick={exitBatchMode} className="cursor-pointer h-8 w-8">
                <Info className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('draftManage.cancel')}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    )
  }

  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4">
      {/* 第一行：搜索框 */}
      <div className="relative w-full sm:max-w-[300px]">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          data-testid="draftbox-search-input"
          value={searchValue}
          onChange={handleSearchChange}
          placeholder={t('draftManage.searchPlaceholder')}
          className="pl-9 h-8 text-xs"
        />
      </div>
      <div className="flex items-center gap-1.5 flex-wrap sm:ml-auto">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant={viewMode === 'grid' ? 'secondary' : 'ghost'}
                size="icon"
                className="h-8 w-8 cursor-pointer"
                onClick={() => onViewModeChange('grid')}
              >
                <Grid3X3 className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('mediaManagement.grid', 'Grid')}</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant={viewMode === 'list' ? 'secondary' : 'ghost'}
                size="icon"
                className="h-8 w-8 cursor-pointer"
                onClick={() => onViewModeChange('list')}
              >
                <List className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('mediaManagement.list', 'List')}</TooltipContent>
          </Tooltip>

          {allowDraftActions && (
            <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    data-testid="draftbox-batch-mode-btn"
                    variant="outline"
                    size="icon"
                    onClick={enterBatchMode}
                    className="cursor-pointer h-8 w-8"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t('draftManage.batchDelete')}</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    data-testid="draftbox-conditional-delete-btn"
                    variant="outline"
                    size="icon"
                    onClick={openConditionalDeleteDialog}
                    className="cursor-pointer h-8 w-8 text-xs"
                  >
                    <span>#</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t('draftManage.conditionalDelete')}</TooltipContent>
              </Tooltip>
            </>
          )}

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant={compactInfo ? 'secondary' : 'ghost'}
                size="icon"
                className="h-8 w-8 cursor-pointer"
                onClick={onToggleCompactInfo}
              >
                <Info className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{compactInfo ? t('common.hide', 'Hide') : t('common.show', 'Show')}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </div>
  )
})

DraftListToolbar.displayName = 'DraftListToolbar'

export { DraftListToolbar }
