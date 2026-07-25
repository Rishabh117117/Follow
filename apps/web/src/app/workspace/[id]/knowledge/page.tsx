'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api-client'
import { KnowledgeDocCard } from '@/components/knowledge/knowledge-doc-card'
import { KnowledgeDetail } from '@/components/knowledge/knowledge-detail'
import { KnowledgeGraphView } from '@/components/knowledge/knowledge-graph-view'

type DocType =
  | 'user_profile'
  | 'topic_summary'
  | 'decision_log'
  | 'project_state'
  | 'agent_playbook'

const DOC_TYPE_LABELS: Record<DocType, string> = {
  user_profile: 'User Profiles',
  topic_summary: 'Topic Summaries',
  decision_log: 'Decisions',
  project_state: 'Projects',
  agent_playbook: 'Agent Playbooks',
}

interface KnowledgeDoc {
  id: string
  docType: string
  content: Record<string, unknown>
  lastUpdated: string
}

export default function KnowledgePage() {
  const { id: workspaceId } = useParams<{ id: string }>()
  const [selectedDoc, setSelectedDoc] = useState<KnowledgeDoc | null>(null)
  const [filterType, setFilterType] = useState<DocType | 'all'>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [viewMode, setViewMode] = useState<'list' | 'graph'>('list')

  const { data: docsData, isLoading } = useQuery({
    queryKey: ['knowledge-docs', workspaceId, filterType],
    queryFn: () =>
      api.get<KnowledgeDoc[]>(
        `/api/knowledge/docs?workspaceId=${workspaceId}${filterType !== 'all' ? `&docType=${filterType}` : ''}`
      ),
  })

  const { data: graphData } = useQuery({
    queryKey: ['knowledge-graph', workspaceId],
    queryFn: () =>
      api.get<{
        nodes: Array<{ id: string; type: string; connectionCount: number }>
        edges: Array<{
          id: string
          sourceId: string
          targetId: string
          relationship: string
          weight: number
        }>
      }>(`/api/knowledge/graph?workspaceId=${workspaceId}`),
    enabled: viewMode === 'graph',
  })

  const { data: statsData } = useQuery({
    queryKey: ['knowledge-stats', workspaceId],
    queryFn: () =>
      api.get<{
        totalDocs: number
        typeCounts: Record<string, number>
        lastUpdated: string | null
      }>(`/api/knowledge/stats?workspaceId=${workspaceId}`),
  })

  const docs = docsData?.data ?? []
  const stats = statsData?.data

  const filteredDocs = searchQuery
    ? docs.filter((d) =>
        JSON.stringify(d.content).toLowerCase().includes(searchQuery.toLowerCase())
      )
    : docs

  // Group docs by type
  const groupedDocs = new Map<string, KnowledgeDoc[]>()
  for (const doc of filteredDocs) {
    const group = groupedDocs.get(doc.docType) ?? []
    group.push(doc)
    groupedDocs.set(doc.docType, group)
  }

  return (
    <div className="flex h-full">
      {/* Left Panel: Doc List */}
      <div className="flex w-80 flex-col border-r border-zinc-800 bg-zinc-950">
        {/* Header */}
        <div className="border-b border-zinc-800 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-zinc-100">Knowledge Base</h2>
            {stats && <span className="text-xs text-zinc-500">{stats.totalDocs} docs</span>}
          </div>

          {/* Search */}
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search knowledge..."
            className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-violet-600 focus:outline-none"
          />

          {/* View toggle */}
          <div className="mt-2 flex gap-1">
            <button
              onClick={() => setViewMode('list')}
              className={`flex-1 rounded px-2 py-1 text-xs transition-colors ${
                viewMode === 'list'
                  ? 'bg-violet-600 text-white'
                  : 'bg-zinc-800 text-zinc-400 hover:text-zinc-300'
              }`}
            >
              List
            </button>
            <button
              onClick={() => setViewMode('graph')}
              className={`flex-1 rounded px-2 py-1 text-xs transition-colors ${
                viewMode === 'graph'
                  ? 'bg-violet-600 text-white'
                  : 'bg-zinc-800 text-zinc-400 hover:text-zinc-300'
              }`}
            >
              Graph
            </button>
          </div>
        </div>

        {/* Type filters */}
        <div className="flex flex-wrap gap-1 border-b border-zinc-800 p-2">
          <button
            onClick={() => setFilterType('all')}
            className={`rounded-full px-2.5 py-1 text-xs transition-colors ${
              filterType === 'all'
                ? 'bg-violet-600 text-white'
                : 'bg-zinc-800 text-zinc-400 hover:text-zinc-300'
            }`}
          >
            All
          </button>
          {(Object.entries(DOC_TYPE_LABELS) as [DocType, string][]).map(([type, label]) => (
            <button
              key={type}
              onClick={() => setFilterType(type)}
              className={`rounded-full px-2.5 py-1 text-xs transition-colors ${
                filterType === type
                  ? 'bg-violet-600 text-white'
                  : 'bg-zinc-800 text-zinc-400 hover:text-zinc-300'
              }`}
            >
              {label} {stats?.typeCounts?.[type] ? `(${stats.typeCounts[type]})` : ''}
            </button>
          ))}
        </div>

        {/* Doc list */}
        <div className="flex-1 overflow-y-auto p-2">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-700 border-t-violet-600" />
            </div>
          ) : filteredDocs.length === 0 ? (
            <div className="py-12 text-center">
              <p className="text-sm text-zinc-500">No knowledge docs yet</p>
              <p className="mt-1 text-xs text-zinc-600">
                The AI will automatically build knowledge as you use the workspace
              </p>
            </div>
          ) : filterType === 'all' ? (
            // Grouped view
            [...groupedDocs.entries()].map(([type, typeDocs]) => (
              <div key={type} className="mb-4">
                <h3 className="mb-1 px-1 text-xs font-medium uppercase text-zinc-500">
                  {DOC_TYPE_LABELS[type as DocType] ?? type}
                </h3>
                <div className="space-y-1">
                  {typeDocs.map((doc) => (
                    <KnowledgeDocCard
                      key={doc.id}
                      doc={doc}
                      onClick={() => setSelectedDoc(doc)}
                      isSelected={selectedDoc?.id === doc.id}
                    />
                  ))}
                </div>
              </div>
            ))
          ) : (
            <div className="space-y-1">
              {filteredDocs.map((doc) => (
                <KnowledgeDocCard
                  key={doc.id}
                  doc={doc}
                  onClick={() => setSelectedDoc(doc)}
                  isSelected={selectedDoc?.id === doc.id}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Main Panel */}
      <div className="flex-1 overflow-y-auto bg-zinc-950">
        {viewMode === 'graph' ? (
          <div className="h-full">
            <KnowledgeGraphView
              nodes={graphData?.data?.nodes ?? []}
              edges={graphData?.data?.edges ?? []}
              searchHighlight={searchQuery}
              onNodeClick={(nodeId, _nodeType) => {
                const doc = docs.find((d) => {
                  const c = d.content as Record<string, unknown>
                  return c.userId === nodeId || c.topic === nodeId || c.projectName === nodeId
                })
                if (doc) setSelectedDoc(doc)
              }}
            />
          </div>
        ) : selectedDoc ? (
          <div className="mx-auto max-w-2xl p-6">
            <button
              onClick={() => setSelectedDoc(null)}
              className="mb-4 text-sm text-zinc-500 hover:text-zinc-300"
            >
              ← Back to list
            </button>
            <KnowledgeDetail doc={selectedDoc} />
          </div>
        ) : (
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-zinc-800">
                <span className="text-2xl">🧠</span>
              </div>
              <h3 className="text-lg font-medium text-zinc-300">Workspace Knowledge</h3>
              <p className="mt-1 max-w-sm text-sm text-zinc-500">
                Select a knowledge doc from the list to view its details, or switch to graph view to
                explore connections.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
