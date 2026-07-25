// ─── Document Memory Types (System 2) ─────────────────────────────────────────

export type NarrativePhase = 'inception' | 'exploration' | 'convergence' | 'stabilization' | 'delivery'
export type CognitiveState = 'exploring' | 'comparing' | 'deciding' | 'synthesizing' | 'refining' | 'stuck' | 'presenting'

export interface DocumentTension {
  name: string
  description: string
  evidence: string
}

export interface SourceInfluenceEntry {
  sourceName: string
  weight: number // 0-1
  reason: string
}

export interface UnresolvedQuestion {
  question: string
  evidence: string
}

export interface DocumentInterpretation {
  id: string
  workspaceId: string
  fileId: string
  strandId: string | null
  narrativePhase: NarrativePhase
  narrativeConfidence: number
  narrativeSummary: string
  workingIntent: string
  intentEvidence: string
  cognitiveState: CognitiveState
  activeTensions: DocumentTension[]
  sourceInfluence: SourceInfluenceEntry[]
  unresolvedQuestions: UnresolvedQuestion[]
  createdAt: string
  updatedAt: string
}

export interface DocumentPattern {
  id: string
  fileId: string
  pattern: string
  confidence: number
  reinforcedCount: number
  lastReinforcedAt: string
}

export interface DecisionTrailStep {
  step: string
  type: 'human' | 'ai_accepted' | 'ai_rejected' | 'source_added' | 'collaborator'
  timestamp: string
}

export interface DocumentDecisionTrail {
  id: string
  fileId: string
  paragraphRef: string
  trailSteps: DecisionTrailStep[]
  stabilityScore: number
  humanAuthoredPct: number
  anchorSource: string | null
}

export interface DocumentMemory {
  interpretation: DocumentInterpretation | null
  patterns: DocumentPattern[]
  decisionTrails: DocumentDecisionTrail[]
}

export interface ContextParagraph {
  content: string
  tokenEstimate: number
  assembledAt: string
  queryDomain: string
}
