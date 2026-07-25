export interface NavIntent {
  isNavRequest: boolean
  topic: string
  queries: string[]
  sourcePreference: 'any' | 'academic' | 'official' | 'news'
  automationLevel: 'recommend' | 'assist' | 'automate'
  targetDescription: string
  /** Direct URL if the user mentioned a specific domain (e.g. "porsche.com") */
  directUrl?: string
  /** Classification of navigation complexity */
  navType?: 'direct' | 'find_element' | 'interact' | 'search'
  /** URL constructed from site alias resolution (e.g., wikipedia → en.wikipedia.org/wiki/Japan) */
  resolvedUrl?: string
  /** Specific section/heading to scroll to and spotlight (e.g., "History", "Languages") */
  sectionTarget?: string
}

export interface NavTarget {
  url: string
  cssSelector: string | null
  textFragment: string | null
  confidence: number
}

export interface NavResult {
  success: boolean
  finalUrl: string
  spotlightFired: boolean
  screenshotDataUrl?: string
  fallbackUsed?: 'heading_id' | 'heading_text' | 'text_fragment' | 'scroll_top' | 'none'
  errorReason?: string
}

export interface RankedResult {
  url: string
  title: string
  snippet: string
  relevanceScore: number
  authorityScore: number
  sectionHint: string
  estimatedSelector: string
}
