/**
 * AI Edit Service — calls /api/doc-intelligence-web/suggest to get
 * AI-generated text revision suggestions for selected text.
 */

import { STORAGE_KEYS, DEFAULT_API_BASE_URL } from '@/lib/constants'

export interface SuggestionVariant {
  text: string
  label: string
}

export interface SuggestionResult {
  id: string
  originalText: string
  proposedText: string
  explanation: string
  variants: SuggestionVariant[]
}

type ChipMode = 'rewrite' | 'shorten' | 'strengthen' | 'tone' | 'grammar'

const CHIP_TO_DOC_MODE: Record<ChipMode, string> = {
  rewrite: 'edit_clarity',
  shorten: 'edit_conciseness',
  strengthen: 'edit_structure',
  tone: 'edit_tone',
  grammar: 'edit_grammar',
}

async function getAuthHeaders(): Promise<{
  headers: Record<string, string>
  baseUrl: string
}> {
  const data = await chrome.storage.local.get([
    STORAGE_KEYS.AUTH_TOKEN,
    STORAGE_KEYS.USER_ID,
    STORAGE_KEYS.WORKSPACE_ID,
    STORAGE_KEYS.API_BASE_URL,
  ])

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  const token = data[STORAGE_KEYS.AUTH_TOKEN] as string | undefined
  if (token) headers['Authorization'] = `Bearer ${token}`
  const userId = data[STORAGE_KEYS.USER_ID] as string | undefined
  if (userId) headers['x-user-id'] = userId
  const workspaceId = data[STORAGE_KEYS.WORKSPACE_ID] as string | undefined
  if (workspaceId) headers['x-workspace-id'] = workspaceId

  const baseUrl = (data[STORAGE_KEYS.API_BASE_URL] as string) || DEFAULT_API_BASE_URL
  return { headers, baseUrl }
}

/**
 * Request AI suggestion for selected text.
 */
export async function requestEditSuggestion(
  selectedText: string,
  chipMode: ChipMode,
  customInstruction?: string
): Promise<SuggestionResult> {
  const { headers, baseUrl } = await getAuthHeaders()
  const docMode = CHIP_TO_DOC_MODE[chipMode] || 'edit_custom'

  const res = await fetch(`${baseUrl}/api/doc-intelligence-web/suggest`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      content: selectedText,
      mode: customInstruction ? 'edit_custom' : docMode,
      customInstruction,
    }),
  })

  if (!res.ok) {
    throw new Error(`AI edit request failed: HTTP ${res.status}`)
  }

  const json = await res.json()
  const suggestions = json.data?.suggestions ?? []

  if (suggestions.length === 0) {
    throw new Error('No suggestions returned')
  }

  // Take the first suggestion's best variant as proposedText
  const sug = suggestions[0]
  const variants: SuggestionVariant[] = sug.variants ?? []
  const proposedText = variants.length > 0 ? variants[0].text : sug.originalText

  return {
    id: sug.id,
    originalText: sug.originalText || selectedText,
    proposedText,
    explanation: sug.explanation || '',
    variants,
  }
}

/**
 * Regenerate with a note (user feedback on previous suggestion).
 */
export async function requestRegeneration(
  originalText: string,
  previousVariants: string[],
  note: string
): Promise<SuggestionResult> {
  const { headers, baseUrl } = await getAuthHeaders()

  const res = await fetch(`${baseUrl}/api/doc-intelligence-web/regenerate`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ originalText, previousVariants, note }),
  })

  if (!res.ok) {
    throw new Error(`Regeneration failed: HTTP ${res.status}`)
  }

  const json = await res.json()
  const variants: SuggestionVariant[] = json.data?.variants ?? []

  if (variants.length === 0) {
    throw new Error('No variants returned')
  }

  return {
    id: `regen-${Date.now()}`,
    originalText,
    proposedText: variants[0].text,
    explanation: '',
    variants,
  }
}
