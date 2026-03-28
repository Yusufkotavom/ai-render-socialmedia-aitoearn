/**
 * MediaListSection - 媒体列表区域
 * 瀑布流布局 + IntersectionObserver 无限滚动展示视频/图片
 * 只读模式，无创建/批量操作
 */

'use client'

import type { MediaItem } from '@/api/types/media'
import type { MediaPreviewItem } from '@/components/common/MediaPreview'
import { Check, ImageIcon, Video } from 'lucide-react'
import { memo, useCallback, useEffect, useMemo, useRef } from 'react'
import Masonry from 'react-masonry-css'
import { useShallow } from 'zustand/react/shallow'
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

interface MediaListSectionProps {
  type: 'video' | 'img'
  materialGroupId: string
  viewMode?: DraftViewMode
  batchMode?: boolean
  selectedIds?: string[]
  onToggleSelect?: (id: string) => void
}

// 骨架屏
function MediaCardSkeleton({ index }: { index: number }) {
  const heights = [120, 160, 200, 140, 180, 150, 170, 190]
  const height = heights[index % heights.length]

  return (
    <div className="mb-4">
      <Skeleton className="w-full rounded-xl" style={{ height: `${height}px` }} />
    </div>
  )
}

// 加载更多指示器
const LoadingIndicator = memo(() => (
  <div className="flex justify-center py-4">
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
    </div>
  </div>
))
LoadingIndicator.displayName = 'LoadingIndicator'

const MediaRowCard = memo(({
  media,
  onClick,
  batchMode,
  selected,
  onToggleSelect,
}: {
  media: MediaItem
  onClick: (media: MediaItem) => void
  batchMode: boolean
  selected: boolean
  onToggleSelect: () => void
}) => {
  const cover = getOssUrl(media.thumbUrl || media.url)
  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-lg border p-2.5 mb-2 cursor-pointer transition-colors',
        selected ? 'border-primary/50 bg-primary/5' : 'border-border hover:bg-muted/40',
      )}
      onClick={() => (batchMode ? onToggleSelect() : onClick(media))}
    >
      {batchMode && (
        <div
          className={cn(
            'w-5 h-5 rounded-full border flex items-center justify-center shrink-0',
            selected ? 'bg-primary border-primary' : 'border-muted-foreground/40',
          )}
          onClick={(e) => { e.stopPropagation(); onToggleSelect() }}
        >
          {selected && <Check className="w-3 h-3 text-primary-foreground" />}
        </div>
      )}
      <div className="relative w-16 h-16 rounded-md overflow-hidden shrink-0 bg-muted">
        <LazyImage
          src={cover}
          alt={media.title || ''}
          width={64}
          height={64}
          className="w-full h-full object-cover"
          skeletonClassName="rounded-md"
          placeholderHeight={64}
        />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium line-clamp-1">{media.title || media.type.toUpperCase()}</p>
        <p className="text-xs text-muted-foreground line-clamp-1">{media.type}</p>
      </div>
    </div>
  )
})
MediaRowCard.displayName = 'MediaRowCard'

export const MediaListSection = memo(({
  type,
  materialGroupId,
  viewMode = 'grid',
  batchMode = false,
  selectedIds = [],
  onToggleSelect,
}: MediaListSectionProps) => {
  const { t } = useTransClient('material')
  const loadMoreRef = useRef<HTMLDivElement>(null)

  const { list, loading, hasMore, initialized, total } = useMediaTabStore(
    useShallow(state => ({
      list: state[type].list,
      loading: state[type].loading,
      hasMore: state[type].hasMore,
      initialized: state[type].initialized,
      total: state[type].total,
    })),
  )

  const { previewOpen, previewIndex, previewType } = useMediaTabStore(
    useShallow(state => ({
      previewOpen: state.previewOpen,
      previewIndex: state.previewIndex,
      previewType: state.previewType,
    })),
  )

  const fetchMediaList = useMediaTabStore(state => state.fetchMediaList)
  const loadMore = useMediaTabStore(state => state.loadMore)
  const openPreview = useMediaTabStore(state => state.openPreview)
  const closePreview = useMediaTabStore(state => state.closePreview)

  // 首次加载
  useEffect(() => {
    if (!initialized && materialGroupId) {
      fetchMediaList(materialGroupId, type)
    }
  }, [initialized, materialGroupId, type, fetchMediaList])

  // IntersectionObserver 无限滚动
  useEffect(() => {
    const loadMoreElement = loadMoreRef.current
    if (!loadMoreElement)
      return

    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries
        if (entry.isIntersecting && hasMore && !loading && materialGroupId) {
          loadMore(materialGroupId, type)
        }
      },
      { threshold: 0.1 },
    )

    observer.observe(loadMoreElement)
    return () => observer.disconnect()
  }, [hasMore, loading, materialGroupId, type, loadMore])

  // 点击媒体卡片
  const handleMediaClick = useCallback((media: MediaItem) => {
    const index = list.findIndex(m => m._id === media._id)
    if (index !== -1) {
      openPreview(type, index)
    }
  }, [list, type, openPreview])

  // 预览项列表
  const previewItems = useMemo((): MediaPreviewItem[] => {
    return list.map(media => ({
      type: media.type === 'video' ? 'video' : 'image',
      src: getOssUrl(media.url),
      title: media.title,
    }))
  }, [list])

  // 初始加载骨架屏
  if (loading && list.length === 0) {
    return (
      <Masonry
        breakpointCols={MASONRY_BREAKPOINTS}
        className="flex -ml-4 w-auto"
        columnClassName="pl-4 bg-clip-padding"
      >
        {Array.from({ length: 8 }).map((_, i) => (
          <MediaCardSkeleton key={i} index={i} />
        ))}
      </Masonry>
    )
  }

  // 空状态
  if (initialized && list.length === 0) {
    const Icon = type === 'video' ? Video : ImageIcon
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
          <Icon className="w-8 h-8 text-muted-foreground" />
        </div>
        <p className="text-sm font-medium text-foreground mb-1">
          {type === 'video' ? t('mediaManagement.noVideo') : t('mediaManagement.noImage')}
        </p>
        <p className="text-sm text-muted-foreground">
          {type === 'video' ? t('mediaManagement.noVideoDesc') : t('mediaManagement.noImageDesc')}
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
              {list.map((media) => {
                const selected = selectedIds.includes(media._id)
                return (
                  <div key={media._id} className="relative mb-4">
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
                          onToggleSelect?.(media._id)
                        }}
                      >
                        {selected && <Check className="w-3.5 h-3.5 text-primary-foreground" />}
                      </div>
                    )}
                    <div onClick={() => (batchMode ? onToggleSelect?.(media._id) : handleMediaClick(media))}>
                      <MediaCard media={media} onClick={handleMediaClick} />
                    </div>
                  </div>
                )
              })}
            </Masonry>
          )
        : (
            <div>
              {list.map(media => (
                <MediaRowCard
                  key={media._id}
                  media={media}
                  onClick={handleMediaClick}
                  batchMode={batchMode}
                  selected={selectedIds.includes(media._id)}
                  onToggleSelect={() => onToggleSelect?.(media._id)}
                />
              ))}
            </div>
          )}

      {/* 加载触发器 */}
      <div ref={loadMoreRef} />

      {/* 加载更多指示器 */}
      {loading && <LoadingIndicator />}

      {/* 没有更多数据 */}
      {!hasMore && list.length > 0 && (
        <div className="flex items-center justify-center py-4">
          <span className="text-sm text-muted-foreground">
            {t('mediaManagement.loadedAll')}
          </span>
        </div>
      )}

      {/* 媒体预览弹窗 - 仅当前 type 匹配时渲染 */}
      {previewType === type && (
        <MediaPreview
          open={previewOpen}
          items={previewItems}
          initialIndex={previewIndex}
          onClose={closePreview}
        />
      )}
    </>
  )
})

MediaListSection.displayName = 'MediaListSection'
