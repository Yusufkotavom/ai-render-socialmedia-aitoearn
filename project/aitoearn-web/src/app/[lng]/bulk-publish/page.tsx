import dynamic from 'next/dynamic'

const BulkPublishRunnerShell = dynamic(() => import('./BulkPublishRunnerShell'), {
  ssr: false,
})

export default function BulkPublishPage() {
  return <BulkPublishRunnerShell />
}

