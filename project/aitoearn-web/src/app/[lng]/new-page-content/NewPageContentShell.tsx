'use client'

import { Boxes, ChevronDown, ChevronUp, FolderOpen, Library, Sparkles } from 'lucide-react'
import { useParams, useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { usePlanDetailStore } from '@/app/[lng]/brand-promotion/planDetailStore'
import { usePlanTabStore } from '@/app/[lng]/brand-promotion/planTabStore'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import DraftBoxCore from '../draft-box/DraftBoxCore'

export default function NewPageContentShell() {
  const router = useRouter()
  const params = useParams<{ lng: string }>()
  const lng = params?.lng || 'en'
  const [mobileExpanded, setMobileExpanded] = useState(false)

  const { tabPlans, selectedPlanId } = usePlanTabStore(
    useShallow(state => ({
      tabPlans: state.tabPlans,
      selectedPlanId: state.selectedPlanId,
    })),
  )

  const { currentPlan, materialsPagination, selectedMaterialIds, generatingCount } = usePlanDetailStore(
    useShallow(state => ({
      currentPlan: state.currentPlan,
      materialsPagination: state.materialsPagination,
      selectedMaterialIds: state.selectedMaterialIds,
      generatingCount: state.generatingCount,
    })),
  )

  const currentPlanLabel = useMemo(
    () => currentPlan?.name || currentPlan?.title || selectedPlanId || '-',
    [currentPlan?.name, currentPlan?.title, selectedPlanId],
  )

  return (
    <div className="h-full min-h-0 flex flex-col">
      <div className="px-2 py-2 md:px-6 md:pt-4 md:pb-0">
        <div className="rounded-lg border bg-background/70 px-2 py-2 md:px-3 md:py-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <Sparkles className="w-4 h-4 text-muted-foreground shrink-0" />
              <span className="text-xs md:text-sm font-medium truncate">Content Manager</span>
            </div>

            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 md:hidden"
                onClick={() => setMobileExpanded(v => !v)}
              >
                {mobileExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </Button>
              <TooltipProvider>
                <div className="hidden md:flex items-center gap-1">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-7 w-7 md:h-8 md:w-8" onClick={() => router.push(`/${lng}/drive-explorer`)}>
                        <FolderOpen className="w-3.5 h-3.5 md:w-4 md:h-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Drive Explorer</TooltipContent>
                  </Tooltip>

                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-7 w-7 md:h-8 md:w-8" onClick={() => router.push(`/${lng}`)}>
                        <Library className="w-3.5 h-3.5 md:w-4 md:h-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Open Draft Box</TooltipContent>
                  </Tooltip>

                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-7 w-7 md:h-8 md:w-8" onClick={() => router.push(`/${lng}/agent-assets`)}>
                        <Boxes className="w-3.5 h-3.5 md:w-4 md:h-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Agent Assets</TooltipContent>
                  </Tooltip>
                </div>
              </TooltipProvider>
            </div>
          </div>

          {mobileExpanded && (
            <TooltipProvider>
              <div className="flex md:hidden items-center gap-1 mt-2">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-7 w-7 md:h-8 md:w-8" onClick={() => router.push(`/${lng}/drive-explorer`)}>
                      <FolderOpen className="w-3.5 h-3.5 md:w-4 md:h-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Drive Explorer</TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-7 w-7 md:h-8 md:w-8" onClick={() => router.push(`/${lng}`)}>
                      <Library className="w-3.5 h-3.5 md:w-4 md:h-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Open Draft Box</TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-7 w-7 md:h-8 md:w-8" onClick={() => router.push(`/${lng}/agent-assets`)}>
                      <Boxes className="w-3.5 h-3.5 md:w-4 md:h-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Agent Assets</TooltipContent>
                </Tooltip>
              </div>
            </TooltipProvider>
          )}

          <div className="hidden md:grid grid-cols-4 gap-2 text-xs mt-2.5">
            <div className="rounded-md border p-2">
              <div className="text-muted-foreground">Workspaces</div>
              <div className="font-semibold">{tabPlans.length}</div>
            </div>
            <div className="rounded-md border p-2">
              <div className="text-muted-foreground">Current</div>
              <div className="font-semibold truncate">{currentPlanLabel}</div>
            </div>
            <div className="rounded-md border p-2">
              <div className="text-muted-foreground">Drafts</div>
              <div className="font-semibold">{materialsPagination.total || 0}</div>
            </div>
            <div className="rounded-md border p-2">
              <div className="text-muted-foreground">Selected / Generating</div>
              <div className="font-semibold">{selectedMaterialIds.length} / {generatingCount}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0">
        <DraftBoxCore showGenerateBar={false} />
      </div>
    </div>
  )
}
