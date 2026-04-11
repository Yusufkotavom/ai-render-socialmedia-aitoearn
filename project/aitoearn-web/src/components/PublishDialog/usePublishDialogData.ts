import type { FacebookPageItem } from '@/api/plat/facebook'
import type {
  BiblPartItem,
  YouTubeCategoryItem,
} from '@/components/PublishDialog/publishDialog.type'
import lodash from 'lodash'
import { create } from 'zustand'
import { combine } from 'zustand/middleware'
import { getPinterestBoardListApi } from '@/api/pinterest'
import { apiGetBilibiliPartitions } from '@/api/plat/bilibili'
import { apiGetFacebookPages } from '@/api/plat/facebook'
import { apiGetYouTubeCategories, apiGetYouTubeRegions } from '@/api/plat/youtube'
import { PlatType } from '@/app/config/platConfig'
import { useAccountStore } from '@/store/account'

export interface IPublishDialogDataStore {
  // b站分区列表
  bilibiliPartitions: BiblPartItem[]
  // Facebook页面列表
  facebookPages: FacebookPageItem[]
  // YouTube视频分类列表
  youTubeCategories: YouTubeCategoryItem[]
  // YouTube国区列表
  youTubeRegions: string[]
  // Pinterest Board列表
  pinterestBoards: Array<{
    id: string
    name: string
    description?: string
  }>
}

const DEFAULT_YOUTUBE_CATEGORIES: YouTubeCategoryItem[] = [
  { id: '1', snippet: { title: 'Film & Animation' } },
  { id: '2', snippet: { title: 'Autos & Vehicles' } },
  { id: '10', snippet: { title: 'Music' } },
  { id: '15', snippet: { title: 'Pets & Animals' } },
  { id: '17', snippet: { title: 'Sports' } },
  { id: '19', snippet: { title: 'Travel & Events' } },
  { id: '20', snippet: { title: 'Gaming' } },
  { id: '22', snippet: { title: 'People & Blogs' } },
  { id: '23', snippet: { title: 'Comedy' } },
  { id: '24', snippet: { title: 'Entertainment' } },
  { id: '25', snippet: { title: 'News & Politics' } },
  { id: '26', snippet: { title: 'Howto & Style' } },
  { id: '27', snippet: { title: 'Education' } },
  { id: '28', snippet: { title: 'Science & Technology' } },
  { id: '29', snippet: { title: 'Nonprofits & Activism' } },
]

const store: IPublishDialogDataStore = {
  bilibiliPartitions: [],
  facebookPages: [],
  youTubeCategories: DEFAULT_YOUTUBE_CATEGORIES,
  youTubeRegions: [],
  pinterestBoards: [],
}

function normalizeYouTubeCategories(res: any): YouTubeCategoryItem[] {
  // Backend response shape may vary by gateway/version:
  // 1) { data: { items: [...] } }
  // 2) { data: [...] }
  // 3) { items: [...] }
  // 4) [...]
  const raw = res?.data?.items ?? res?.data ?? res?.items ?? res
  if (!Array.isArray(raw)) {
    return DEFAULT_YOUTUBE_CATEGORIES
  }
  
  const validCategories = raw.filter(Boolean)
  return validCategories.length > 0 ? validCategories : DEFAULT_YOUTUBE_CATEGORIES
}

function getStore() {
  return lodash.cloneDeep(store)
}

/**
 * 存放发布弹框一些平台获取的三方数据
 * 如：b站的分区列表
 */
export const usePublishDialogData = create(
  combine(
    {
      ...getStore(),
    },
    (set, get, storeApi) => {
      const methods = {
        // 获取b站分区列表
        async getBilibiliPartitions() {
          if (get().bilibiliPartitions.length !== 0)
            return
          const res = await apiGetBilibiliPartitions(
            useAccountStore.getState().accountList.find(v => v.type === PlatType.BILIBILI)!.id,
          )
          set({
            bilibiliPartitions: res?.data,
          })
          return res?.data
        },
        // 获取Facebook页面列表
        async getFacebookPages(accountId?: string) {
          if (get().facebookPages.length !== 0)
            return

          let targetAccountId = accountId

          if (!targetAccountId) {
            // 如果没有提供账户ID，使用第一个找到的Facebook账户（保持向后兼容）
            const facebookAccount = useAccountStore
              .getState()
              .accountList
              .find(v => v.type === PlatType.Facebook)
              
            if (!facebookAccount) {
              console.warn('没有找到Facebook账户')
              return
            }
            targetAccountId = facebookAccount.account
          } else {
            // Facebook specific: need the account field (usually ID or token string depending on logic)
            // Wait, for Facebook, the original code used facebookAccount.account
            const facebookAccount = useAccountStore
              .getState()
              .accountList
              .find(v => v.id === accountId && v.type === PlatType.Facebook)
            if (facebookAccount) {
               targetAccountId = facebookAccount.account
            } else {
               targetAccountId = accountId // fallback, maybe accountId is the account
            }
          }

          if (!targetAccountId) {
            console.warn('没有找到Facebook账户标识')
            return
          }

          const res: any = await apiGetFacebookPages(targetAccountId as string)
          set({
            facebookPages: res?.data || [],
          })
          return res?.data
        },
        // 获取YouTube国区列表
        async getYouTubeRegions(accountId?: string) {
          if (get().youTubeRegions.length !== 0)
            return

          let targetAccountId = accountId

          if (!targetAccountId) {
            // 如果没有提供账户ID，使用第一个找到的YouTube账户（保持向后兼容）
            const youtubeAccount = useAccountStore
              .getState()
              .accountList
              .find(v => v.type === PlatType.YouTube)
              
            if (!youtubeAccount) {
              console.warn('没有找到YouTube账户')
              return
            }
            targetAccountId = youtubeAccount.id
          }

          const res: any = await apiGetYouTubeRegions(targetAccountId)
          set({
            youTubeRegions: res?.data?.regionCode || [],
          })
          return res?.data?.regionCode
        },
        // 获取YouTube视频分类
        async getYouTubeCategories(accountId?: string, regionCode?: string) {
          let targetAccountId = accountId

          if (!targetAccountId) {
            // 如果没有提供账户ID，使用第一个找到的YouTube账户（保持向后兼容）
            const youtubeAccount = useAccountStore
              .getState()
              .accountList
              .find(v => v.type === PlatType.YouTube)
              
            if (!youtubeAccount) {
              console.warn('没有找到YouTube账户')
              return
            }
            targetAccountId = youtubeAccount.id
          }

          // 如果没有提供 regionCode，使用默认值 "US"
          const defaultRegionCode = regionCode || 'US'

          try {
            const res: any = await apiGetYouTubeCategories(
              targetAccountId,
              defaultRegionCode,
            )
            const categories = normalizeYouTubeCategories(res)
            set({
              youTubeCategories: categories,
            })
            return categories
          } catch (e) {
            console.warn('获取YouTube分类失败，使用默认分类', e)
            set({
              youTubeCategories: DEFAULT_YOUTUBE_CATEGORIES,
            })
            return DEFAULT_YOUTUBE_CATEGORIES
          }
        },
        // 获取Pinterest Board列表
        async getPinterestBoards(forceRefresh = false, accountId?: string) {
          if (!forceRefresh && get().pinterestBoards.length !== 0)
            return

          let targetAccountId = accountId

          if (!targetAccountId) {
            // 如果没有提供账户ID，使用第一个找到的Pinterest账户（保持向后兼容）
            const pinterestAccount = useAccountStore
              .getState()
              .accountList
              .find(v => v.type === PlatType.Pinterest)

            if (!pinterestAccount) {
              console.warn('没有找到Pinterest账户')
              return
            }
            targetAccountId = pinterestAccount.id
          }

          if (!targetAccountId) {
            console.warn('没有找到Pinterest账户标识')
            return
          }

          const res: any = await getPinterestBoardListApi({}, targetAccountId as string)
          set({
            pinterestBoards: res?.data?.list || res?.data || [],
          })
          return res?.data?.list || res?.data
        },
      }

      return methods
    },
  ),
)
