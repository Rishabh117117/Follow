// ─── Notebook Types ─────────────────────────────────────────────────────────

// Page size presets (pixels at 96 DPI)
export const PAGE_SIZES = {
  letter: { width: 816, height: 1056 }, // 8.5 x 11 inches
  a4: { width: 794, height: 1123 }, // 210 x 297 mm
  a5: { width: 559, height: 794 }, // 148 x 210 mm
} as const

export type PageSize = 'letter' | 'a4' | 'a5' | 'custom'
export type PageBackground = 'blank' | 'ruled' | 'dotted' | 'grid' | 'cornell'

export type NotebookBlockType =
  | 'text'
  | 'freehand'
  | 'shape'
  | 'image'
  | 'audio'
  | 'video'
  | 'sticky'
  | 'connector'
  | 'embed'
  | 'comment'

// Discriminated union for block data
export type NotebookBlockData =
  | {
      type: 'text'
      richTextContent: Record<string, unknown>
      plainText: string
    }
  | {
      type: 'freehand'
      points: Array<{ x: number; y: number; pressure?: number; timestamp?: number }>
      svgPath: string
      color: string
      strokeWidth: number
      tool: 'pen' | 'highlighter'
      variableWidth?: boolean
    }
  | {
      type: 'shape'
      shapeType: 'rectangle' | 'circle' | 'diamond' | 'line'
      fill: string
      stroke: string
      strokeWidth: number
      cornerRadius?: number
    }
  | {
      type: 'image'
      storagePath: string
      altText?: string
      mimeType: string
      originalWidth: number
      originalHeight: number
    }
  | {
      type: 'audio'
      storagePath: string
      fileName: string
      durationSeconds?: number
      mimeType: string
    }
  | {
      type: 'video'
      storagePath: string
      fileName: string
      durationSeconds?: number
      mimeType: string
      thumbnailPath?: string
    }
  | {
      type: 'sticky'
      text: string
      color: string
    }
  | {
      type: 'connector'
      startBlockId?: string
      endBlockId?: string
      points: Array<{ x: number; y: number }>
      color: string
      strokeWidth: number
    }
  | {
      type: 'embed'
      url: string
      embedType: string
    }
  | {
      type: 'comment'
      text: string
      authorId: string
      resolved: boolean
    }

export interface NotebookBlock {
  id: string
  pageId: string
  notebookId: string
  type: NotebookBlockType
  x: number
  y: number
  width: number
  height: number
  rotation: number
  zIndex: number
  locked: boolean
  data: NotebookBlockData
  createdAt: string
  updatedAt: string
}

export interface NotebookPage {
  id: string
  notebookId: string
  pageNumber: number
  background: PageBackground
  width: number
  height: number
  blocks: NotebookBlock[]
  metadata?: Record<string, unknown>
}

export interface Notebook {
  id: string
  fileId: string
  workspaceId: string
  pageSize: PageSize
  customWidth?: number
  customHeight?: number
  pageCount: number
  defaultBackground: PageBackground
  pages: NotebookPage[]
}

// Tool types for the notebook editor
export type NotebookTool =
  | 'select'
  | 'type'
  | 'pen'
  | 'highlighter'
  | 'eraser'
  | 'shape'
  | 'image'
  | 'media'
  | 'sticky'
  | 'connector'
  | 'embed'
  | 'pan'

export type NotebookAction = {
  type: 'add' | 'delete' | 'update' | 'move' | 'resize'
  blockId: string
  before: Partial<NotebookBlock> | null
  after: Partial<NotebookBlock> | null
}
