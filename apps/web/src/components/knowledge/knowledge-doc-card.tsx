'use client'

interface KnowledgeDocCardProps {
  doc: {
    id: string
    docType: string
    content: Record<string, unknown>
    lastUpdated: string
  }
  onClick?: () => void
  isSelected?: boolean
}

const docTypeLabels: Record<string, { label: string; icon: string; color: string }> = {
  user_profile: { label: 'User Profile', icon: '👤', color: 'text-blue-400' },
  topic_summary: { label: 'Topic Summary', icon: '📋', color: 'text-green-400' },
  decision_log: { label: 'Decision', icon: '⚖️', color: 'text-amber-400' },
  project_state: { label: 'Project', icon: '📊', color: 'text-violet-400' },
  agent_playbook: { label: 'Playbook', icon: '🤖', color: 'text-pink-400' },
}

export function KnowledgeDocCard({ doc, onClick, isSelected }: KnowledgeDocCardProps) {
  const typeInfo = docTypeLabels[doc.docType] ?? {
    label: doc.docType,
    icon: '📄',
    color: 'text-zinc-400',
  }
  const content = doc.content as Record<string, unknown>

  const getTitle = (): string => {
    switch (doc.docType) {
      case 'user_profile':
        return (content.name as string) ?? 'User'
      case 'topic_summary':
        return (content.topic as string) ?? 'Topic'
      case 'decision_log':
        return ((content.decision as string) ?? 'Decision').slice(0, 60)
      case 'project_state':
        return (content.projectName as string) ?? 'Project'
      case 'agent_playbook':
        return `${(content.bestModel as string) ?? 'Model'} Playbook`
      default:
        return 'Knowledge Doc'
    }
  }

  const getSubtitle = (): string => {
    switch (doc.docType) {
      case 'user_profile':
        return (content.role as string) ?? ''
      case 'topic_summary':
        return `${(content.totalMentions as number) ?? 0} mentions`
      case 'decision_log':
        return `by ${(content.madeBy as string) ?? 'unknown'}`
      case 'project_state':
        return (content.currentStatus as string) ?? ''
      case 'agent_playbook':
        return `${(content.totalRuns as number) ?? 0} runs`
      default:
        return ''
    }
  }

  const updated = new Date(doc.lastUpdated)
  const timeAgo = getTimeAgo(updated)

  return (
    <button
      onClick={onClick}
      className={`w-full rounded-lg border p-3 text-left transition-colors ${
        isSelected
          ? 'border-violet-600 bg-violet-600/10'
          : 'border-zinc-800 bg-zinc-900 hover:border-zinc-700'
      }`}
    >
      <div className="flex items-start gap-2">
        <span className="text-lg">{typeInfo.icon}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-zinc-100">{getTitle()}</p>
          <p className="truncate text-xs text-zinc-500">{getSubtitle()}</p>
        </div>
        <span className={`text-xs ${typeInfo.color}`}>{typeInfo.label}</span>
      </div>
      <p className="mt-1 text-xs text-zinc-600">{timeAgo}</p>
    </button>
  )
}

function getTimeAgo(date: Date): string {
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return date.toLocaleDateString()
}
