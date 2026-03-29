import dynamic from 'next/dynamic'
import { useTranslation } from '@/app/i18n'
import { fallbackLng, languages } from '@/lib/i18n/languageConfig'
import { getMetadata } from '@/utils/general'

interface PageParams {
  params: Promise<{ lng: string }>
}

export async function generateMetadata({ params }: PageParams) {
  let { lng } = await params
  if (!languages.includes(lng))
    lng = fallbackLng
  const { t } = await useTranslation(lng, 'common')

  return getMetadata(
    {
      title: `Content Scheduler - ${t('header.draftBox')}`,
      description: t('header.draftBoxSeoDescription'),
      keywords: t('header.draftBoxSeoKeywords'),
    },
    lng,
    '/content-scheduler',
  )
}

const ContentSchedulerShell = dynamic(() => import('./ContentSchedulerShell'), {
  ssr: false,
})

export default function ContentSchedulerPage() {
  return <ContentSchedulerShell />
}
