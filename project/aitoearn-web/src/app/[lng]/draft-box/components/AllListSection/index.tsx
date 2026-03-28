/**
 * AllListSection - 全部列表区域
 * 合并草稿、视频、图片三种数据源，瀑布流布局 + IntersectionObserver 无限滚动
 * 根据数据来源分发渲染 DraftCard 或 MediaCard
 */

'use client'

import type { MediaItem } from '@/api/types/media'
import type { PromotionMaterial } from '@/app/[lng]/brand-promotion/brandPromotionStore/types'
import type { MediaPreviewItem } from '@/components/common/MediaPreview'
import { Check, Inbox } from 'lucide-react'
import { memo, useCallback, useEffect, useMemo, useRef } from 'react'
import Masonry from 'react-masonry-css'
import { useShallow } from 'zustand/react/shallow'
import { usePlanDetailStore } from '@/app/[lng]/brand-promotion/planDetailStore'
import { useTransClient } from '@/app/i18n/client'
import { MediaPreview } from '@/components/common/MediaPreview'
import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'
import { getOssUrl } from '@/utils/oss'
import { useMediaTabStore } from '../ContentTabs/mediaTabStore'
import { LazyImage } from '../LazyImage'
import { MediaCard } from '../MediaCard'
import type { DraftViewMode } from '../DraftListToolbar'

/**
 * 瀑布流断点配置
 */
const MASONRY_BREAKPOINTS = {
  default: 5,
  1280: 4,
  1024: 3,
  768: 3,
  640: 2,
}

// 骨架屏
function AllCardSkeleton({ index }: { index: number }) {
  const heights = [120, 160, 200, 140, 180, 150, 170, 190]
  const height = heights[index % heights.length]

  return (
    <div className="mb-4">
      <Skeleton className="w-full rounded-xl" style={{ height: `${height}px` }} />
      <div className="pt-2 px-1">
        <Skeleton className="h-4 w-full" />
      </div>
    </div>
  )
}

// 加载更多指示器
const LoadingIndicator = memo(({ label }: { label: string }) => (
  <div className="flex justify-center py-4">
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
      <span>{label}</span>
    </div>
  </div>
))
LoadingIndicator.displayName = 'LoadingIndicator'

/** 草稿卡片（简化版，用于全部列表，不含批量操作） */
const AllDraftCard = memo(({ material, onClick }: { material: PromotionMaterial, onClick: () => void }) => {
  const coverUrl = material.coverUrl || '/images/placeholder.png'

  return (
    <div
      className="mb-4 cursor-pointer group relative"
      onClick={onClick}
    >
      <div className="relative w-full overflow-hidden rounded-xl">
        <LazyImage
          src={coverUrl}
          alt={material.title || ''}
          width={400}
          height={300}
          className="w-full h-auto transition-transform duration-300 group-hover:scale-105"
          skeletonClassName="rounded-xl"
          placeholderHeight={150}
          style={{ aspectRatio: 'auto' }}
        />
        {material.desc && (
          <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-end p-3 rounded-xl">
            <p className="text-white text-xs line-clamp-4">
              {material.desc}
            </p>
          </div>
        )}
      </div>
      <div className="pt-2 px-1">
        <p className="text-sm font-medium text-foreground line-clamp-2">
          {material.title || ''}
        </p>
        {material.model && (
          <span className="inline-block mt-1 px-1.5 py-0.5 text-xs rounded bg-muted text-muted-foreground">
            {material.model}
          </span>
        )}
      </div>
    </div>
  )
})
AllDraftCard.displayName = 'AllDraftCard'

interface AllListSectionProps {
  materialGroupId: string
  viewMode?: DraftViewMode
  batchMode?: boolean
  selectedKeys?: string[]
  onToggleSelect?: (key: string) => void
}

export const AllListSection = memo(({
  materialGroupId,
  viewMode = 'grid',
  batchMode = false,
  selectedKeys = [],
  onToggleSelect,
}: AllListSectionProps) => {
  const { t } = useTransClient('material')
  const { t: tBrand } = useTransClient('brandPromotion')
  const loadMoreRef = useRef<HTMLDivElement>(null)

  const currentPlan = usePlanDetailStore(state => state.currentPlan)
  const openDraftDetailDialog = usePlanDetailStore(state => state.openDraftDetailDialog)

  const { mergedList, loading, initialized, allExhausted } = useMediaTabStore(
    useShallow(state => ({
      mergedList: state.all.mergedList,
      loading: state.all.loading,
      initialized: state.all.initialized,
      allExhausted: state.all.allExhausted,
    })),
  )

  const fetchAllList = useMediaTabStore(state => state.fetchAllList)
  const loadMoreAll = useMediaTabStore(state => state.loadMoreAll)

  // 媒体预览状态
  const { previewOpen, previewIndex, previewType } = useMediaTabStore(
    useShallow(state => ({
      previewOpen: state.previewOpen,
      previewIndex: state.previewIndex,
      previewType: state.previewType,
    })),
  )
  const openPreview = useMediaTabStore(state => state.openPreview)
  const closePreview = useMediaTabStore(state => state.closePreview)

  // 首次加载
  useEffect(() => {
    if (!initialized && materialGroupId && currentPlan) {
      fetchAllList(materialGroupId, currentPlan.id)
    }
  }, [initialized, materialGroupId, currentPlan, fetchAllList])

  // IntersectionObserver 无限滚动
  useEffect(() => {
    const loadMoreElement = loadMoreRef.current
    if (!loadMoreElement)
      return

    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries
        if (entry.isIntersecting && !allExhausted && !loading && materialGroupId && currentPlan) {
          loadMoreAll(materialGroupId, currentPlan.id)
        }
      },
      { threshold: 0.1 },
    )

    observer.observe(loadMoreElement)
    return () => observer.disconnect()
  }, [allExhausted, loading, materialGroupId, currentPlan, loadMoreAll])

  // 媒体卡片点击 - 打开预览
  const handleMediaClick = useCallback((media: MediaItem) => {
    // 找到在合并列表中同类型媒体的索引（用于预览导航）
    const mediaItems = mergedList.filter(item => item.source === media.type)
    const index = mediaItems.findIndex(item => item.id === media._id)
    if (index !== -1) {
      openPreview(media.type as 'video' | 'img', index)
    }
  }, [mergedList, openPreview])

  // 预览项列表（按当前预览类型过滤）
  const previewItems = useMemo((): MediaPreviewItem[] => {
    return mergedList
      .filter(item => item.source === previewType)
      .map((item) => {
        const media = item.data as MediaItem
        return {
          type: media.type === 'video' ? 'video' as const : 'image' as const,
          src: getOssUrl(media.url),
          title: media.title,
        }
      })
  }, [mergedList, previewType])

  // 初始加载骨架屏
  if (loading && mergedList.length === 0) {
    return (
      <Masonry
        breakpointCols={MASONRY_BREAKPOINTS}
        className="flex -ml-4 w-auto"
        columnClassName="pl-4 bg-clip-padding"
      >
        {Array.from({ length: 8 }).map((_, i) => (
          <AllCardSkeleton key={i} index={i} />
        ))}
      </Masonry>
    )
  }

  // 空状态
  if (initialized && mergedList.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
          <Inbox className="w-8 h-8 text-muted-foreground" />
        </div>
        <p className="text-sm font-medium text-foreground mb-1">
          {t('mediaManagement.noMedia')}
        </p>
        <p className="text-sm text-muted-foreground">
          {t('mediaManagement.noMediaDesc')}
        </p>
      </div>
    )
  }

  return (
    <>
      {viewMode === 'grid'
        ? (
            <Masonry
              breakpointCols={MASONRY_BREAKPOINTS}
              className="flex -ml-4 w-auto"
              columnClassName="pl-4 bg-clip-padding"
            >
              {mergedList.map((item) => {
                const itemKey = `${item.source}:${item.id}`
                const selected = selectedKeys.includes(itemKey)
                return (
                  <div key={itemKey} className="relative">
                    {batchMode && (
                      <div
                        className={cn(
                          'absolute top-2 right-2 z-10 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all duration-200 shadow-sm cursor-pointer',
                          selected
                            ? 'bg-primary border-primary'
                            : 'bg-background/90 border-muted-foreground/30',
                        )}
                        onClick={(e) => {
                          e.stopPropagation()
                          onToggleSelect?.(itemKey)
                        }}
                      >
                        {selected && <Check className="w-3.5 h-3.5 text-primary-foreground" />}
                      </div>
                    )}
                    {item.source === 'draft'
                      ? (
                          <div onClick={() => (batchMode ? onToggleSelect?.(itemKey) : openDraftDetailDialog(item.data as PromotionMaterial))}>
                            <AllDraftCard
                              material={item.data as PromotionMaterial}
                              onClick={() => openDraftDetailDialog(item.data as PromotionMaterial)}
                            />
                          </div>
                        )
                      : (
                          <div onClick={() => (batchMode ? onToggleSelect?.(itemKey) : handleMediaClick(item.data as MediaItem))}>
                            <MediaCard
                              media={item.data as MediaItem}
                              onClick={handleMediaClick}
                            />
                          </div>
                        )}
                  </div>
                )
              })}
            </Masonry>
          )
        : (
            <div className="space-y-2">
              {mergedList.map((item) => {
                const itemKey = `${item.source}:${item.id}`
                const selected = selectedKeys.includes(itemKey)
                const isDraft = item.source === 'draft'
                const draft = isDraft ? (item.data as PromotionMaterial) : null
                const media = !isDraft ? (item.data as MediaItem) : null
                const thumb = isDraft ? (draft?.coverUrl || '/images/placeholder.png') : getOssUrl(media?.thumbUrl || media?.url || '')
                const title = isDraft ? (draft?.title || 'Draft') : (media?.title || media?.type || 'Media')
                return (
                  <div
                    key={itemKey}
                    className={cn(
                      'flex items-center gap-3 rounded-lg border p-2.5 cursor-pointer',
                      selected ? 'border-primary/50 bg-primary/5' : 'border-border hover:bg-muted/40',
                    )}
                    onClick={() => (batchMode
                      ? onToggleSelect?.(itemKey)
                      : (isDraft ? openDraftDetailDialog(draft as PromotionMaterial) : handleMediaClick(media as MediaItem)))}
                  >
                    {batchMode && (
                      <div
                        className={cn(
                          'w-5 h-5 rounded-full border flex items-center justify-center shrink-0',
                          selected ? 'bg-primary border-primary' : 'border-muted-foreground/40',
                        )}
                        onClick={(e) => { e.stopPropagation(); onToggleSelect?.(itemKey) }}
                      >
                        {selected && <Check className="w-3 h-3 text-primary-foreground" />}
                      </div>
                    )}
                    <div className="relative w-16 h-16 rounded-md overflow-hidden shrink-0 bg-muted">
                      <LazyImage src={thumb} alt={title} width={64} height={64} className="w-full h-full object-cover" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium line-clamp-1">{title}</p>
                      <p className="text-xs text-muted-foreground">{item.source}</p>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

      {/* 加载触发器 */}
      <div ref={loadMoreRef} />

      {/* 加载更多指示器 */}
      {loading && <LoadingIndicator label={tBrand('common.loading')} />}

      {/* 没有更多数据 */}
      {allExhausted && mergedList.length > 0 && (
        <div className="flex items-center justify-center py-4">
          <span className="text-sm text-muted-foreground">
            {t('mediaManagement.loadedAll')}
          </span>
        </div>
      )}

      {/* 媒体预览弹窗 */}
      <MediaPreview
        open={previewOpen}
        items={previewItems}
        initialIndex={previewIndex}
        onClose={closePreview}
      />
    </>
  )
})

AllListSection.displayName = 'AllListSection'
