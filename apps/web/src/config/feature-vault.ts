export interface VaultFeature {
  id: string
  name: string
  description: string
  active: boolean
  category: 'editor' | 'capture' | 'intelligence' | 'collaboration' | 'surface'
  componentPaths: string[]
}

export const featureVault: VaultFeature[] = [
  {
    id: 'rich-text-editor',
    name: 'Rich Text Editor',
    description: 'Full document editing with formatting, sections, and tab management.',
    active: false,
    category: 'editor',
    componentPaths: ['components/editors/rich-text/'],
  },
  {
    id: 'canvas-editor',
    name: 'Canvas Editor',
    description: 'Freeform spatial canvas with objects, layers, and drawing tools.',
    active: false,
    category: 'editor',
    componentPaths: ['components/canvas/'],
  },
  {
    id: 'spreadsheet-editor',
    name: 'Spreadsheet Editor',
    description: 'Grid-based data editing with formulas and cell formatting.',
    active: false,
    category: 'editor',
    componentPaths: ['components/editors/spreadsheet/'],
  },
  {
    id: 'presentation-editor',
    name: 'Presentation Editor',
    description: 'Slide-based presentations with speaker notes and element marks.',
    active: false,
    category: 'editor',
    componentPaths: ['components/editors/presentation/'],
  },
  {
    id: 'pdf-viewer',
    name: 'PDF Viewer',
    description: 'In-app PDF viewing with text extraction and AI analysis overlay.',
    active: false,
    category: 'editor',
    componentPaths: ['pdf-viewer/'],
  },
  {
    id: 'ghost-drafts',
    name: 'Ghost Drafts',
    description: 'AI-generated inline content suggestions placed at cursor position.',
    active: false,
    category: 'intelligence',
    componentPaths: ['ghost-draft-store'],
  },
  {
    id: 'ai-annotations',
    name: 'AI Annotations',
    description: 'Underline-based document annotations across 11 categories with ratings.',
    active: false,
    category: 'intelligence',
    componentPaths: ['ai-annotation-store'],
  },
  {
    id: 'doc-suggestions',
    name: 'Doc Suggestions',
    description: 'AI-powered document improvement suggestions with accept/reject.',
    active: false,
    category: 'intelligence',
    componentPaths: ['doc-suggestion-store'],
  },
  {
    id: 'contribution-markers',
    name: 'Contribution Markers',
    description: 'Per-user colored gutter bars showing who wrote what in a document.',
    active: false,
    category: 'collaboration',
    componentPaths: ['contribution-markers.tsx'],
  },
  {
    id: 'doc-phase',
    name: 'Doc Phase Indicator',
    description: 'Document lifecycle phase tracking with velocity arrows.',
    active: false,
    category: 'intelligence',
    componentPaths: ['doc-phase-indicator.tsx'],
  },
  {
    id: 'file-browser',
    name: 'File Browser',
    description: 'Workspace file management with folders, search, and file actions.',
    active: false,
    category: 'editor',
    componentPaths: ['components/file-browser/'],
  },
  {
    id: 'capture-ask',
    name: 'Capture & Ask',
    description: 'Web page capture with AI-powered Q&A about captured content.',
    active: false,
    category: 'capture',
    componentPaths: ['components/capture-ask/'],
  },
  {
    id: 'web-captures',
    name: 'Web Captures',
    description: 'Browser content capture and bookmarking.',
    active: false,
    category: 'capture',
    componentPaths: ['components/capture/'],
  },
  {
    id: 'doc-intelligence',
    name: 'Document Intelligence',
    description: 'Deep AI analysis of document structure, arguments, and evidence.',
    active: false,
    category: 'intelligence',
    componentPaths: ['services/doc-intelligence/'],
  },
  {
    id: 'comments',
    name: 'Comment System',
    description: 'Inline document comments with threading and resolution.',
    active: false,
    category: 'collaboration',
    componentPaths: ['comment-store'],
  },
  {
    id: 'proactive-cards',
    name: 'Proactive Cards',
    description: 'AI-generated contextual prompt suggestions based on work patterns.',
    active: false,
    category: 'intelligence',
    componentPaths: ['use-prompt-cards'],
  },
  // ─── CORE-STRIP-1: management-surface gates (2026-04-22) ─────────────────
  {
    id: 'in-app-chat',
    name: 'In-App Chat',
    description:
      'In-workspace chat UI. MCP save_conversation is the core-aligned replacement channel.',
    active: false,
    category: 'surface',
    componentPaths: ['app/workspace/[id]/chat/'],
  },
  {
    id: 'notebook-editor',
    name: 'Notebook Editor',
    description: 'N1–N4 notebook editor surface.',
    active: false,
    category: 'surface',
    componentPaths: ['app/workspace/[id]/notebook/', 'components/notebook/'],
  },
  {
    id: 'thread-archive',
    name: 'Thread Archive',
    description: 'Thread / strand archive UI.',
    active: false,
    category: 'surface',
    componentPaths: ['app/workspace/[id]/threads/', 'components/threads/'],
  },
  {
    id: 'timeline-view',
    name: 'Timeline View',
    description: 'Activity timeline management surface.',
    active: false,
    category: 'surface',
    componentPaths: ['app/workspace/[id]/timeline/', 'components/timeline/'],
  },
  {
    id: 'dev-config-hub',
    name: 'Dev Config Hub',
    description: 'Developer-only configuration hub (non-user-facing).',
    active: false,
    category: 'surface',
    componentPaths: ['app/workspace/[id]/config/', 'components/config/'],
  },
]

export function isFeatureActive(featureId: string): boolean {
  const feature = featureVault.find((f) => f.id === featureId)
  return feature?.active ?? false
}

export function getVaultFeatures(): VaultFeature[] {
  return featureVault
}

export function getInactiveFeatures(): VaultFeature[] {
  return featureVault.filter((f) => !f.active)
}
