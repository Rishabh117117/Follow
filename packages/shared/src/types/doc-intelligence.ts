export type SuggestionType = 'clarity' | 'conciseness' | 'tone' | 'grammar' | 'structure' | 'custom'

export type DocMode =
  | 'edit_clarity'
  | 'edit_conciseness'
  | 'edit_tone'
  | 'edit_grammar'
  | 'edit_structure'
  | 'edit_custom'
  | 'analyze_logic'
  | 'analyze_evidence'
  | 'analyze_bias'
  | 'analyze_structure'
  | 'analyze_audience'
  | 'analyze_custom'

export type DocScope =
  | 'selection'
  | 'paragraph'
  | 'section'
  | 'full_document'
  // Presentation scopes
  | 'active_slide'
  | 'speaker_notes'
  | 'all_slides'
  // PDF scopes
  | 'current_page'

export interface SuggestionMark {
  id: string
  suggestionType: SuggestionType
  spanText: string
  originalText: string
  variants: SuggestionVariant[]
  explanation: string
  confidence: number
}

export interface SuggestionVariant {
  text: string
  label: string
}

export interface AnalysisFinding {
  id: string
  mode: DocMode
  spanText: string
  finding: string
  severity: 'info' | 'warning' | 'critical'
  suggestion?: string
}

export interface DocSuggestRequest {
  workspaceId: string
  fileId: string
  content: string
  scope: DocScope
  mode: DocMode
  customInstruction?: string
}

export interface DocAnalyzeRequest {
  workspaceId: string
  fileId: string
  content: string
  scope: DocScope
  mode: DocMode
  customInstruction?: string
}

export interface DocSuggestResponse {
  suggestions: SuggestionMark[]
  processingTimeMs: number
}

export interface DocAnalyzeResponse {
  findings: AnalysisFinding[]
  summary: string
  processingTimeMs: number
}
