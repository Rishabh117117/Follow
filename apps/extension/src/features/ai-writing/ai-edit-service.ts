/**
 * AI Edit Service — calls /api/doc-intelligence-web/suggest for text revision suggestions.
 */

import { sendToBackground } from '@/core/message-bus'

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

export async function requestEditSuggestion(
  selectedText: string,
  chipMode: ChipMode,
  customInstruction?: string
): Promise<SuggestionResult> {
  const docMode = CHIP_TO_DOC_MODE[chipMode] || 'edit_custom'
  const result = await sendToBackground<{ suggestions?: Array<{
    id: string; originalText?: string; explanation?: string; variants?: SuggestionVariant[]
  }> }>({
    type: 'DOC_INTEL_REQUEST',
    payload: {
      action: 'suggest',
      content: selectedText,
      mode: customInstruction ? 'edit_custom' : docMode,
      customInstruction,
    },
  })

  if (!result.success) throw new Error(result.error || 'AI edit request failed')

  const suggestions = result.data?.suggestions ?? []
  if (suggestions.length === 0) throw new Error('No suggestions returned')

  const sug = suggestions[0]!
  const variants = sug.variants ?? []
  return {
    id: sug.id,
    originalText: sug.originalText || selectedText,
    proposedText: variants.length > 0 ? variants[0]!.text : selectedText,
    explanation: sug.explanation || '',
    variants,
  }
}

export async function requestRegeneration(
  originalText: string,
  previousVariants: string[],
  note: string
): Promise<SuggestionResult> {
  const result = await sendToBackground<{ variants?: SuggestionVariant[] }>({
    type: 'DOC_INTEL_REQUEST',
    payload: { action: 'regenerate', originalText, previousVariants, note },
  })

  if (!result.success) throw new Error(result.error || 'Regeneration failed')

  const variants = result.data?.variants ?? []
  if (variants.length === 0) throw new Error('No variants returned')

  return {
    id: `regen-${Date.now()}`,
    originalText,
    proposedText: variants[0]!.text,
    explanation: '',
    variants,
  }
}
