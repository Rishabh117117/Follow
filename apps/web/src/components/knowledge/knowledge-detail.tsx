'use client'

interface KnowledgeDetailProps {
  doc: {
    id: string
    docType: string
    content: Record<string, unknown>
    lastUpdated: string
  }
}

export function KnowledgeDetail({ doc }: KnowledgeDetailProps) {
  const content = doc.content as Record<string, unknown>

  return (
    <div className="space-y-4">
      {doc.docType === 'user_profile' && <UserProfileView content={content} />}
      {doc.docType === 'topic_summary' && <TopicSummaryView content={content} />}
      {doc.docType === 'decision_log' && <DecisionLogView content={content} />}
      {doc.docType === 'project_state' && <ProjectStateView content={content} />}
      {doc.docType === 'agent_playbook' && <AgentPlaybookView content={content} />}
      <p className="text-xs text-zinc-600">
        Last updated: {new Date(doc.lastUpdated).toLocaleString()}
      </p>
    </div>
  )
}

function UserProfileView({ content }: { content: Record<string, unknown> }) {
  const expertise =
    (content.expertise as Array<{ topic: string; confidence: number; recentActivity: string }>) ??
    []
  const workPatterns = (content.workPatterns as Record<string, unknown>) ?? {}
  const collaborators = (content.collaboratesOftenWith as string[]) ?? []

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-violet-600 text-lg font-bold text-white">
          {((content.name as string) ?? 'U').charAt(0).toUpperCase()}
        </div>
        <div>
          <h3 className="text-lg font-semibold text-zinc-100">{content.name as string}</h3>
          <p className="text-sm text-zinc-400">{content.role as string}</p>
        </div>
      </div>

      {expertise.length > 0 && (
        <div>
          <h4 className="mb-2 text-sm font-medium text-zinc-300">Expertise</h4>
          <div className="space-y-2">
            {expertise.map((e, i) => (
              <div key={i} className="flex items-center gap-2">
                <div className="flex-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-zinc-300">{e.topic}</span>
                    <span className="text-zinc-500">{Math.round(e.confidence * 100)}%</span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-zinc-800">
                    <div
                      className="h-full rounded-full bg-violet-600"
                      style={{ width: `${e.confidence * 100}%` }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <h4 className="mb-2 text-sm font-medium text-zinc-300">Work Patterns</h4>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-lg bg-zinc-800/50 p-2">
            <span className="text-zinc-500">Active Hours</span>
            <p className="text-zinc-300">{workPatterns.activeHours as string}</p>
          </div>
          <div className="rounded-lg bg-zinc-800/50 p-2">
            <span className="text-zinc-500">Peak Time</span>
            <p className="text-zinc-300">{workPatterns.peakProductivity as string}</p>
          </div>
          <div className="rounded-lg bg-zinc-800/50 p-2">
            <span className="text-zinc-500">Daily Active</span>
            <p className="text-zinc-300">{workPatterns.averageDailyActiveTime as string}</p>
          </div>
          <div className="rounded-lg bg-zinc-800/50 p-2">
            <span className="text-zinc-500">Focus</span>
            <p className="text-zinc-300">{content.recentFocus as string}</p>
          </div>
        </div>
      </div>

      {collaborators.length > 0 && (
        <div>
          <h4 className="mb-2 text-sm font-medium text-zinc-300">Collaborates With</h4>
          <div className="flex flex-wrap gap-1">
            {collaborators.map((name, i) => (
              <span key={i} className="rounded-full bg-zinc-800 px-2 py-0.5 text-xs text-zinc-300">
                {name}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function TopicSummaryView({ content }: { content: Record<string, unknown> }) {
  const timeline = (content.timeline as Array<{ date: string; event: string }>) ?? []
  const keyDocs = (content.keyDocuments as Array<{ id: string; name: string }>) ?? []
  const contributors = (content.contributors as string[]) ?? []

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold text-zinc-100">{content.topic as string}</h3>
        <p className="mt-1 text-sm text-zinc-400">{content.description as string}</p>
      </div>

      <div className="flex items-center gap-4 text-sm">
        <span className="text-zinc-500">
          <strong className="text-zinc-300">{content.totalMentions as number}</strong> mentions
        </span>
        <span className="text-zinc-500">
          <strong className="text-zinc-300">{contributors.length}</strong> contributors
        </span>
      </div>

      {keyDocs.length > 0 && (
        <div>
          <h4 className="mb-2 text-sm font-medium text-zinc-300">Key Documents</h4>
          <div className="space-y-1">
            {keyDocs.map((doc, i) => (
              <div
                key={i}
                className="flex items-center gap-2 rounded bg-zinc-800/50 px-2 py-1 text-xs"
              >
                <span className="text-zinc-500">◻</span>
                <span className="text-zinc-300">{doc.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {timeline.length > 0 && (
        <div>
          <h4 className="mb-2 text-sm font-medium text-zinc-300">Activity Timeline</h4>
          <div className="space-y-1">
            {timeline.slice(-5).map((entry, i) => (
              <div key={i} className="flex gap-2 text-xs">
                <span className="shrink-0 text-zinc-600">{entry.date}</span>
                <span className="text-zinc-400">{entry.event}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function DecisionLogView({ content }: { content: Record<string, unknown> }) {
  const alternatives = (content.alternativesConsidered as string[]) ?? []
  const relatedFiles = (content.relatedFiles as Array<{ id: string; name: string }>) ?? []

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-amber-900/50 bg-amber-900/10 p-4">
        <h3 className="text-base font-semibold text-zinc-100">{content.decision as string}</h3>
        {typeof content.context === 'string' && content.context && (
          <p className="mt-2 text-sm text-zinc-400">{content.context}</p>
        )}
      </div>

      <div className="flex items-center gap-4 text-sm text-zinc-500">
        <span>
          by <strong className="text-zinc-300">{content.madeBy as string}</strong>
        </span>
        <span>{new Date(content.madeAt as string).toLocaleDateString()}</span>
      </div>

      {alternatives.length > 0 && (
        <div>
          <h4 className="mb-2 text-sm font-medium text-zinc-300">Alternatives Considered</h4>
          <ul className="space-y-1">
            {alternatives.map((alt, i) => (
              <li key={i} className="flex items-center gap-2 text-xs text-zinc-400">
                <span className="text-zinc-600">—</span>
                {alt}
              </li>
            ))}
          </ul>
        </div>
      )}

      {relatedFiles.length > 0 && (
        <div>
          <h4 className="mb-2 text-sm font-medium text-zinc-300">Related Files</h4>
          <div className="flex flex-wrap gap-1">
            {relatedFiles.map((f, i) => (
              <span key={i} className="rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-300">
                {f.name}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function ProjectStateView({ content }: { content: Record<string, unknown> }) {
  const contributors = (content.activeContributors as string[]) ?? []
  const keyFiles = (content.keyFiles as Array<{ id: string; name: string }>) ?? []
  const blockers = (content.blockers as string[]) ?? []
  const nextSteps = (content.nextSteps as string[]) ?? []

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-zinc-100">{content.projectName as string}</h3>
        <span className="rounded-full bg-green-900/30 px-2 py-0.5 text-xs text-green-400">
          {content.currentStatus as string}
        </span>
      </div>

      {typeof content.recentActivity === 'string' && content.recentActivity && (
        <p className="text-sm text-zinc-400">{content.recentActivity}</p>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <h4 className="mb-1 text-xs font-medium text-zinc-500">Contributors</h4>
          <div className="flex flex-wrap gap-1">
            {contributors.map((c, i) => (
              <span key={i} className="rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-300">
                {c}
              </span>
            ))}
          </div>
        </div>
        <div>
          <h4 className="mb-1 text-xs font-medium text-zinc-500">Key Files</h4>
          <div className="flex flex-col gap-0.5">
            {keyFiles.slice(0, 5).map((f, i) => (
              <span key={i} className="truncate text-xs text-zinc-400">
                {f.name}
              </span>
            ))}
          </div>
        </div>
      </div>

      {blockers.length > 0 && (
        <div>
          <h4 className="mb-1 text-xs font-medium text-red-400">Blockers</h4>
          {blockers.map((b, i) => (
            <p key={i} className="text-xs text-zinc-400">
              • {b}
            </p>
          ))}
        </div>
      )}

      {nextSteps.length > 0 && (
        <div>
          <h4 className="mb-1 text-xs font-medium text-blue-400">Next Steps</h4>
          {nextSteps.map((s, i) => (
            <p key={i} className="text-xs text-zinc-400">
              • {s}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}

function AgentPlaybookView({ content }: { content: Record<string, unknown> }) {
  const tools = (content.recommendedTools as string[]) ?? []
  const tips = (content.tips as string[]) ?? []

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-zinc-100">
          {content.bestModel as string} Playbook
        </h3>
        <span className="text-sm text-zinc-400">{content.taskType as string}</span>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg bg-zinc-800/50 p-2">
          <p className="text-lg font-bold text-violet-400">
            {Math.round((content.avgQualityScore as number) * 100)}%
          </p>
          <p className="text-xs text-zinc-500">Avg Quality</p>
        </div>
        <div className="rounded-lg bg-zinc-800/50 p-2">
          <p className="text-lg font-bold text-green-400">
            {Math.round((content.successRate as number) * 100)}%
          </p>
          <p className="text-xs text-zinc-500">Success Rate</p>
        </div>
        <div className="rounded-lg bg-zinc-800/50 p-2">
          <p className="text-lg font-bold text-blue-400">{content.totalRuns as number}</p>
          <p className="text-xs text-zinc-500">Total Runs</p>
        </div>
      </div>

      {tools.length > 0 && (
        <div>
          <h4 className="mb-2 text-sm font-medium text-zinc-300">Recommended Tools</h4>
          <div className="flex flex-wrap gap-1">
            {tools.map((t, i) => (
              <span
                key={i}
                className="rounded-full bg-violet-900/30 px-2 py-0.5 text-xs text-violet-400"
              >
                {t}
              </span>
            ))}
          </div>
        </div>
      )}

      {tips.length > 0 && (
        <div>
          <h4 className="mb-2 text-sm font-medium text-zinc-300">Tips</h4>
          {tips.map((tip, i) => (
            <p key={i} className="text-xs text-zinc-400">
              💡 {tip}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}
