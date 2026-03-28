import type { Metadata } from 'next'
import { DriveExplorerPageCore } from './DriveExplorerPageCore'

export const metadata: Metadata = {
  title: 'Drive Explorer',
  description: 'Browse mounted drive files and import media into drafts',
}

export default function DriveExplorerPage() {
  return <DriveExplorerPageCore />
}
