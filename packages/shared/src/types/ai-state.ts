// ═══ LAYER 1: IMMEDIATE (Redis only — not in PostgreSQL) ═══

export interface AIStateImmediate {
  focus: {
    documentId: string | null
    documentTitle: string | null
    sectionRef: string | null
    sectionViewStartedAt: string | null // ISO timestamp
    surface: 'doc' | 'chat' | 'browser' | 'idle'
    activeUrl: string | null
    updatedAt: string
  }
  presence: {
    isIdle: boolean
    idleSince: string | null
    collaborators: Array<{
      userId: string
      name: string
      section: string | null
      lastSeen: string
    }>
    activeSince: string | null
  }
  chat: {
    isActive: boolean
    lastTurnAt: string | null
    activeConversationId: string | null
    turnCountThisSession: number
  }
}

// ═══ LAYER 2: EVENT (PostgreSQL ai_state.state_event) ═══

export interface AIStateEvent {
  recentEvents: Array<{
    eventId: string
    label: string
    type: string
    section: string | null
    threadType: string
    timestamp: string
    isKeyChange: boolean
    isAIInvolved: boolean
    tentative: boolean
    // Reflection annotations (populated by IX-5, null until then)
    reflection: {
      tension: string | null
      connection: string | null
      shift: string | null
      gap: string | null
      knowledge: string | null
      confidence: number
    } | null
  }> // ring buffer, max 20

  activeTensions: Array<{
    id: string
    description: string
    severity: 'low' | 'medium' | 'high'
    sections: string[]
    confidence: number
    detectedAt: string
    tentative: boolean
    resolvedAt: string | null
    sourceEventIds: string[]
  }> // max 5

  activeKnowledge: Array<{
    fact: string
    source: string
    confidence: number
    linkedSection: string | null
    extractedAt: string
    fromUserId: string
    shared: boolean
  }> // max 10
}

// ═══ LAYER 3: SESSION (PostgreSQL ai_state.state_session) ═══

export interface AIStateSession {
  currentSession: {
    startedAt: string | null
    eventCount: number
    sectionsVisited: string[]
    episodeIds: string[]
    aiInteractionCount: number
    aiAcceptedCount: number
    aiRejectedCount: number
    documentsWorkedOn: Array<{
      documentId: string
      title: string
      eventCount: number
    }>
  }

  sessionSummary: string | null

  newFromTeam: Array<{
    fromUserId: string
    fromUserName: string
    memory: string
    relevantSection: string | null
    receivedAt: string
    surfaced: boolean
  }> // max 10
}

// ═══ LAYER 4: PERSISTENT (PostgreSQL ai_state.state_persistent) ═══

export interface AIStatePersistent {
  patterns: {
    workStyle: string | null
    productiveHours: [number, number] | null
    avgSessionMinutes: number | null
    aiPreferences: {
      grammarAcceptRate: number | null
      structureAcceptRate: number | null
      toneAcceptRate: number | null
      prefersOptions: boolean | null
    }
    collaborationStyle: string | null
    stuckSignals: string[]
  }

  longTermKnowledge: Array<{
    fact: string
    source: string
    confidence: number
    relatedDocuments: string[]
    confirmedAt: string
  }> // max 20

  relationships: {
    frequentCollaborators: Array<{
      userId: string
      name: string
      sharedDocuments: number
      interactionFrequency: 'daily' | 'weekly' | 'occasional'
    }>
    documentRoles: Array<{
      documentId: string
      title: string
      role: 'owner' | 'primary_editor' | 'reviewer' | 'contributor'
      lastActivity: string
    }> // max 20
  }
}

// ═══ FULL STATE (assembled by state reader) ═══

export interface AIStateComplete {
  immediate: AIStateImmediate // from Redis
  event: AIStateEvent // from PostgreSQL
  session: AIStateSession // from PostgreSQL
  persistent: AIStatePersistent // from PostgreSQL
}

// ═══ DOCUMENT SHARED STATE ═══

export interface DocumentSharedState {
  contributions: Array<{
    userId: string
    userName: string
    sections: Array<{
      sectionRef: string
      editCount: number
      lastEditAt: string
      wordsDelta: number
      isAIAssisted: boolean
    }>
    totalEvents: number
    lastActiveAt: string
    role: 'owner' | 'heavy_editor' | 'light_editor' | 'reviewer' | 'viewer'
  }>

  knowledge: Array<{
    id: string
    fact: string
    source: string
    confidence: number
    contributedBy: string
    contributedByName: string
    sharedAt: string
    method: 'auto' | 'intentional' | 'extracted'
    linkedSection: string | null
    conflictsWith: string | null
    status: 'active' | 'superseded' | 'disputed'
  }>

  tensions: Array<{
    id: string
    description: string
    severity: 'low' | 'medium' | 'high'
    type: 'contradiction' | 'gap' | 'duplication' | 'dependency' | 'stale'
    involvedUsers: string[]
    involvedSections: string[]
    detectedAt: string
    resolvedAt: string | null
    resolution: string | null
    confidence: number
  }>

  dynamics: {
    documentPhase: string | null
    activeContributors: number
    editVelocity: 'accelerating' | 'steady' | 'slowing' | 'stalled'
    lastMajorChange: {
      description: string
      userId: string
      userName: string
      timestamp: string
      section: string
    } | null
    openQuestions: Array<{
      question: string
      raisedBy: string
      raisedAt: string
      section: string | null
    }>
  }

  aiUsage: {
    totalInteractions: number
    acceptedCount: number
    rejectedCount: number
    acceptanceRate: number
    sectionsWithAIContent: string[]
    byUser: Array<{
      userId: string
      userName: string
      interactions: number
      acceptRate: number
    }>
  }
}
