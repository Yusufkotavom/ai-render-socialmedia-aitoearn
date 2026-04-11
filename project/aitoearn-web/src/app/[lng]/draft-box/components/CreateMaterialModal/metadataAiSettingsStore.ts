import { createPersistStore } from '@/utils/createPersistStore'

export type MetadataAiProvider = 'auto' | 'gateway' | 'groq' | 'gemini'
export type MetadataApplyStrategy = 'replace_empty' | 'replace_all'

export const DEFAULT_GATEWAY_MODEL = process.env.NEXT_PUBLIC_METADATA_GATEWAY_MODEL || 'openai/gpt-5.4'
export const DEFAULT_GROQ_MODEL = process.env.NEXT_PUBLIC_METADATA_GROQ_MODEL || 'groq/llama-3.3-70b-versatile'
export const DEFAULT_GEMINI_MODEL = process.env.NEXT_PUBLIC_METADATA_GEMINI_MODEL || 'google/gemini-2.5-flash'

export const METADATA_PROVIDER_MODELS: Record<'gateway' | 'groq' | 'gemini', string[]> = {
  gateway: [
    DEFAULT_GATEWAY_MODEL,
    'openai/gpt-5.4',
    'anthropic/claude-sonnet-4.6',
    'google/gemini-3-flash',
  ],
  groq: [
    DEFAULT_GROQ_MODEL,
    'groq/llama-3.1-70b-versatile',
    'groq/mixtral-8x7b-32768',
  ],
  gemini: [
    DEFAULT_GEMINI_MODEL,
    'google/gemini-2.5-flash-lite',
    'google/gemini-1.5-pro',
  ],
}

export function getDefaultModelByProvider(provider: MetadataAiProvider): string {
  if (provider === 'gateway') {
    return DEFAULT_GATEWAY_MODEL
  }
  if (provider === 'gemini') {
    return DEFAULT_GEMINI_MODEL
  }
  return DEFAULT_GROQ_MODEL
}

export interface MetadataAiSettings {
  provider: MetadataAiProvider
  model?: string
  gatewayApiKey?: string
  promptTemplate: string
  strategy: MetadataApplyStrategy
}

export const DEFAULT_METADATA_PROMPT_TEMPLATE = `You are a social media metadata assistant.

Expand and improve metadata using the context below.
Return strict JSON with keys: title, description, tags.

Context:
- Title: {{title}}
- Description: {{description}}
- Tags: {{tags}}
- Platforms: {{platforms}}

Rules:
1) Keep tone engaging and natural.
2) Do not invent false claims.
3) Keep title concise and platform-friendly.
4) Return 5-10 relevant tags.`

const DEFAULT_SETTINGS: MetadataAiSettings = {
  provider: 'gateway',
  model: DEFAULT_GATEWAY_MODEL,
  gatewayApiKey: '',
  promptTemplate: DEFAULT_METADATA_PROMPT_TEMPLATE,
  strategy: 'replace_empty',
}

interface MetadataAiSettingsState {
  settings: MetadataAiSettings
}

export const useMetadataAiSettingsStore = createPersistStore(
  {
    settings: DEFAULT_SETTINGS,
  } as MetadataAiSettingsState,
  (set, get) => ({
    updateSettings(partial: Partial<MetadataAiSettings>) {
      const currentSettings = get().settings
      const nextProvider = partial.provider ?? currentSettings.provider
      const merged = {
        ...currentSettings,
        ...partial,
      }

      if ((partial.provider && !partial.model) || !merged.model?.trim()) {
        merged.model = getDefaultModelByProvider(nextProvider)
      }

      set({
        settings: merged,
      })
    },
    resetSettings() {
      set({ settings: { ...DEFAULT_SETTINGS } })
    },
  }),
  {
    name: 'create-material-metadata-ai-settings',
    version: 3,
  },
  'localStorage',
)
