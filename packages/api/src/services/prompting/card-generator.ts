/**
 * CardGenerator — Transforms trigger events into actionable prompt cards.
 *
 * Card types:
 *  - single_select: Pick one option from a list
 *  - multi_select: Pick multiple options
 *  - comparison: Compare two approaches
 *  - quick_action: One-click action button
 *  - free_text: Open-ended question
 *  - confirmation: Yes/No confirmation
 */

import type { TriggerEvent } from './trigger-monitor'

// ─── Types ──────────────────────────────────────────────────────────

export interface PromptCardOption {
  id: string
  label: string
  description: string
  icon?: string
  action?: CardAction
}

export interface CardAction {
  type: 'navigate' | 'create_file' | 'start_chat' | 'run_agent' | 'dismiss'
  payload: Record<string, unknown>
}

export interface PromptCard {
  id: string
  workspaceId: string
  userId: string
  triggerKind: string
  questionType:
    | 'single_select'
    | 'multi_select'
    | 'comparison'
    | 'quick_action'
    | 'free_text'
    | 'confirmation'
  title: string
  body: string
  explanation: string | null
  options: PromptCardOption[]
  confidence: number
  priority: number // 1 (low) - 5 (high)
  expiresAt: Date | null
  createdAt: Date
  metadata: Record<string, unknown>
}

// ─── Generators ─────────────────────────────────────────────────────

/**
 * Generate a prompt card from a trigger event.
 * Returns null if we can't produce a meaningful card.
 */
export function generateCard(trigger: TriggerEvent): PromptCard | null {
  switch (trigger.kind) {
    case 'stuck_detection':
      return generateStuckCard(trigger)
    case 'context_switch':
      return generateContextSwitchCard(trigger)
    case 'new_member':
      return generateNewMemberCard(trigger)
    case 'periodic_insight':
      return generateInsightCard(trigger)
    case 'dormant_content':
      return generateDormantContentCard(trigger)
    case 'completion_detected':
      return generateCompletionCard(trigger)
    default:
      return null
  }
}

/**
 * Generate multiple cards from a batch of triggers.
 * Deduplicates and prioritizes.
 */
export function generateCardBatch(triggers: TriggerEvent[]): PromptCard[] {
  const cards: PromptCard[] = []

  for (const trigger of triggers) {
    const card = generateCard(trigger)
    if (card) cards.push(card)
  }

  // Sort by priority (high first), then confidence
  cards.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority
    return b.confidence - a.confidence
  })

  // Limit to 3 cards max to avoid overwhelming the user
  return cards.slice(0, 3)
}

// ─── Card Generators ────────────────────────────────────────────────

function generateStuckCard(trigger: TriggerEvent): PromptCard {
  const data = trigger.data
  const isLooping = !!(data['loopingPages'] as string[] | undefined)

  if (isLooping) {
    const pages = data['loopingPages'] as string[]
    return makeCard({
      trigger,
      questionType: 'single_select',
      title: 'Looks like you might be stuck',
      body: `I noticed you've been going back and forth between a few pages. Can I help you find what you're looking for?`,
      explanation: `You visited ${pages.length} pages ${data['visitCount']} times in quick succession.`,
      priority: 4,
      options: [
        {
          id: 'help-search',
          label: 'Help me find something',
          description: 'Start a chat to help locate what you need',
          icon: '🔍',
          action: { type: 'start_chat', payload: { topic: 'Help me find what I need' } },
        },
        {
          id: 'overview',
          label: 'Show workspace overview',
          description: 'See a summary of recent activity and files',
          icon: '📊',
          action: { type: 'navigate', payload: { to: 'dashboard' } },
        },
        {
          id: 'dismiss',
          label: "I'm fine, thanks",
          description: 'Dismiss this suggestion',
          icon: '✓',
          action: { type: 'dismiss', payload: {} },
        },
      ],
    })
  }

  // Idle detection
  const idleSeconds = (data['idleSeconds'] as number) ?? 0
  const idleMinutes = Math.round(idleSeconds / 60)

  return makeCard({
    trigger,
    questionType: 'single_select',
    title: 'Need a hand?',
    body: `You've been on this page for ${idleMinutes} minutes. Would you like some help?`,
    explanation: null,
    priority: 3,
    options: [
      {
        id: 'deep-dive',
        label: 'Research this topic',
        description: "Start a deep dive on what you're working on",
        icon: '🔬',
        action: {
          type: 'start_chat',
          payload: { type: 'deep_dive', topic: `Help with ${data['currentPage']}` },
        },
      },
      {
        id: 'summarize',
        label: 'Summarize recent work',
        description: 'Get a summary of your recent workspace activity',
        icon: '📝',
        action: { type: 'run_agent', payload: { agent: 'summarizer' } },
      },
      {
        id: 'dismiss',
        label: "I'm just thinking",
        description: 'Dismiss this suggestion',
        icon: '💭',
        action: { type: 'dismiss', payload: {} },
      },
    ],
  })
}

function generateContextSwitchCard(trigger: TriggerEvent): PromptCard {
  const contexts = (trigger.data['recentContexts'] as string[]) ?? []

  return makeCard({
    trigger,
    questionType: 'single_select',
    title: 'Jumping between areas',
    body: "I noticed you've been switching between different parts of your workspace. Would you like help organizing your work?",
    explanation: `Recent areas: ${contexts.join(', ')}`,
    priority: 2,
    options: [
      {
        id: 'organize',
        label: 'Help organize',
        description: 'Get suggestions for organizing your workflow',
        icon: '📁',
        action: { type: 'start_chat', payload: { topic: 'Help me organize my workflow' } },
      },
      {
        id: 'recap',
        label: 'Quick recap',
        description: 'See what you were working on in each area',
        icon: '📋',
        action: { type: 'run_agent', payload: { agent: 'summarizer', scope: 'recent' } },
      },
      {
        id: 'dismiss',
        label: 'No thanks',
        description: 'Dismiss this suggestion',
        icon: '✓',
        action: { type: 'dismiss', payload: {} },
      },
    ],
  })
}

function generateNewMemberCard(trigger: TriggerEvent): PromptCard {
  const memberName = (trigger.data['memberName'] as string) ?? 'Someone'

  return makeCard({
    trigger,
    questionType: 'single_select',
    title: `${memberName} joined!`,
    body: `${memberName} just joined the workspace. Would you like to set up an onboarding flow?`,
    explanation: null,
    priority: 3,
    options: [
      {
        id: 'onboard',
        label: 'Create onboarding doc',
        description: 'Generate an onboarding document with workspace overview',
        icon: '📄',
        action: {
          type: 'create_file',
          payload: { type: 'document', name: `Welcome ${memberName}` },
        },
      },
      {
        id: 'share-summary',
        label: 'Share workspace summary',
        description: 'Send a summary of recent activity',
        icon: '📊',
        action: { type: 'run_agent', payload: { agent: 'summarizer', scope: 'workspace' } },
      },
      {
        id: 'dismiss',
        label: 'Skip',
        description: "They'll figure it out",
        icon: '✓',
        action: { type: 'dismiss', payload: {} },
      },
    ],
  })
}

function generateInsightCard(trigger: TriggerEvent): PromptCard {
  const data = trigger.data

  return makeCard({
    trigger,
    questionType: 'quick_action',
    title: 'Daily workspace insight',
    body: "Here's a quick summary of your workspace activity. Want to dive deeper?",
    explanation: data['summary'] as string | null,
    priority: 2,
    options: [
      {
        id: 'view-timeline',
        label: 'View timeline',
        description: 'Open the full timeline view',
        icon: '📅',
        action: { type: 'navigate', payload: { to: 'timeline' } },
      },
      {
        id: 'deep-dive',
        label: 'Deep dive',
        description: 'Start a research session on your activity trends',
        icon: '🔬',
        action: {
          type: 'start_chat',
          payload: { type: 'deep_dive', topic: 'Workspace activity analysis' },
        },
      },
      {
        id: 'dismiss',
        label: 'Got it',
        description: 'Dismiss',
        icon: '✓',
        action: { type: 'dismiss', payload: {} },
      },
    ],
  })
}

function generateDormantContentCard(trigger: TriggerEvent): PromptCard {
  const items =
    (trigger.data['items'] as Array<{ id: string; name: string; lastModified: Date }>) ?? []
  const itemNames = items.slice(0, 3).map((i) => i.name)

  return makeCard({
    trigger,
    questionType: 'multi_select',
    title: 'Forgotten files?',
    body: `These files haven't been touched in a while: ${itemNames.join(', ')}${items.length > 3 ? ` and ${items.length - 3} more` : ''}. What would you like to do?`,
    explanation: null,
    priority: 1,
    options: [
      {
        id: 'review',
        label: 'Review them',
        description: 'Open files for review',
        icon: '👁',
        action: { type: 'navigate', payload: { to: 'files', filter: 'dormant' } },
      },
      {
        id: 'archive',
        label: 'Archive old files',
        description: 'Move these to archive',
        icon: '📦',
        action: {
          type: 'run_agent',
          payload: { agent: 'file_manager', action: 'archive', items: items.map((i) => i.id) },
        },
      },
      {
        id: 'dismiss',
        label: 'Leave as is',
        description: 'Keep them where they are',
        icon: '✓',
        action: { type: 'dismiss', payload: {} },
      },
    ],
  })
}

function generateCompletionCard(trigger: TriggerEvent): PromptCard {
  const objectName = (trigger.data['objectName'] as string) ?? 'your project'

  return makeCard({
    trigger,
    questionType: 'single_select',
    title: 'Nice work! 🎉',
    body: `It looks like you've completed ${objectName}. What's next?`,
    explanation: null,
    priority: 3,
    options: [
      {
        id: 'summary',
        label: 'Generate summary',
        description: 'Create a summary document of the completed work',
        icon: '📝',
        action: {
          type: 'create_file',
          payload: { type: 'document', name: `Summary: ${objectName}` },
        },
      },
      {
        id: 'next-steps',
        label: 'Suggest next steps',
        description: 'Get AI suggestions for what to do next',
        icon: '🚀',
        action: {
          type: 'start_chat',
          payload: { topic: `What should I do after completing ${objectName}?` },
        },
      },
      {
        id: 'dismiss',
        label: 'Nothing for now',
        description: 'Dismiss',
        icon: '✓',
        action: { type: 'dismiss', payload: {} },
      },
    ],
  })
}

// ─── Helpers ────────────────────────────────────────────────────────

let cardCounter = 0

function makeCard(params: {
  trigger: TriggerEvent
  questionType: PromptCard['questionType']
  title: string
  body: string
  explanation: string | null
  priority: number
  options: PromptCardOption[]
}): PromptCard {
  cardCounter++
  return {
    id: `card-${Date.now()}-${cardCounter}`,
    workspaceId: params.trigger.workspaceId,
    userId: params.trigger.userId,
    triggerKind: params.trigger.kind,
    questionType: params.questionType,
    title: params.title,
    body: params.body,
    explanation: params.explanation,
    options: params.options,
    confidence: params.trigger.confidence,
    priority: params.priority,
    expiresAt: new Date(Date.now() + 30 * 60 * 1000), // 30 min expiry
    createdAt: new Date(),
    metadata: { triggerData: params.trigger.data },
  }
}
