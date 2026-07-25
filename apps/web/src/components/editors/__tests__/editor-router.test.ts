import { describe, it, expect } from 'vitest'

// Test the editor type detection logic extracted from EditorRouter

function detectEditorType(
  fileName: string,
  mimeType: string | null,
  metadata: Record<string, unknown>
): 'document' | 'spreadsheet' | 'presentation' | 'note' | 'unknown' {
  // Check metadata first
  const editorType = metadata?.editorType as string | undefined
  if (editorType) {
    if (['document', 'spreadsheet', 'presentation', 'note'].includes(editorType)) {
      return editorType as 'document' | 'spreadsheet' | 'presentation' | 'note'
    }
  }

  // Check MIME type (spreadsheet/presentation before document due to OOXML paths)
  if (mimeType) {
    if (mimeType.includes('spreadsheet') || mimeType.includes('excel') || mimeType === 'text/csv') {
      return 'spreadsheet'
    }
    if (mimeType.includes('presentation') || mimeType.includes('powerpoint')) {
      return 'presentation'
    }
    if (
      mimeType.includes('word') ||
      mimeType.includes('document') ||
      mimeType === 'application/rtf' ||
      mimeType === 'text/html'
    ) {
      return 'document'
    }
    if (mimeType === 'text/markdown' || mimeType === 'text/plain') {
      return 'note'
    }
  }

  // Check file extension
  const ext = fileName.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'doc':
    case 'docx':
    case 'rtf':
    case 'html':
      return 'document'
    case 'xls':
    case 'xlsx':
    case 'csv':
      return 'spreadsheet'
    case 'ppt':
    case 'pptx':
      return 'presentation'
    case 'md':
    case 'txt':
    case 'note':
      return 'note'
    default:
      return 'unknown'
  }
}

describe('Editor Type Detection', () => {
  describe('Metadata-based detection', () => {
    it('detects document from metadata', () => {
      expect(detectEditorType('file.txt', null, { editorType: 'document' })).toBe('document')
    })

    it('detects spreadsheet from metadata', () => {
      expect(detectEditorType('file', null, { editorType: 'spreadsheet' })).toBe('spreadsheet')
    })

    it('detects presentation from metadata', () => {
      expect(detectEditorType('file', null, { editorType: 'presentation' })).toBe('presentation')
    })

    it('detects note from metadata', () => {
      expect(detectEditorType('file', null, { editorType: 'note' })).toBe('note')
    })

    it('ignores invalid metadata editorType', () => {
      expect(detectEditorType('file.pdf', null, { editorType: 'invalid' })).toBe('unknown')
    })
  })

  describe('MIME type detection', () => {
    it('detects Word documents', () => {
      expect(
        detectEditorType(
          'file',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          {}
        )
      ).toBe('document')
    })

    it('detects Excel spreadsheets', () => {
      expect(
        detectEditorType(
          'file',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          {}
        )
      ).toBe('spreadsheet')
    })

    it('detects PowerPoint presentations', () => {
      expect(
        detectEditorType(
          'file',
          'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          {}
        )
      ).toBe('presentation')
    })

    it('detects CSV as spreadsheet', () => {
      expect(detectEditorType('data.csv', 'text/csv', {})).toBe('spreadsheet')
    })

    it('detects RTF as document', () => {
      expect(detectEditorType('file', 'application/rtf', {})).toBe('document')
    })

    it('detects markdown as note', () => {
      expect(detectEditorType('file', 'text/markdown', {})).toBe('note')
    })

    it('detects plain text as note', () => {
      expect(detectEditorType('file', 'text/plain', {})).toBe('note')
    })
  })

  describe('Extension detection', () => {
    const cases: [string, string][] = [
      ['report.docx', 'document'],
      ['report.doc', 'document'],
      ['page.html', 'document'],
      ['data.xlsx', 'spreadsheet'],
      ['data.xls', 'spreadsheet'],
      ['data.csv', 'spreadsheet'],
      ['deck.pptx', 'presentation'],
      ['deck.ppt', 'presentation'],
      ['notes.md', 'note'],
      ['readme.txt', 'note'],
      ['quick.note', 'note'],
      ['image.png', 'unknown'],
      ['archive.zip', 'unknown'],
    ]

    for (const [fileName, expected] of cases) {
      it(`detects ${fileName} as ${expected}`, () => {
        expect(detectEditorType(fileName, null, {})).toBe(expected)
      })
    }
  })

  describe('Priority', () => {
    it('metadata takes priority over MIME type', () => {
      expect(detectEditorType('file.txt', 'text/plain', { editorType: 'document' })).toBe(
        'document'
      )
    })

    it('MIME type takes priority over extension', () => {
      // The MIME 'application/vnd.workspace.spreadsheet' contains 'spreadsheet'
      // so it matches spreadsheet even though .txt extension would be 'note'
      expect(detectEditorType('file.txt', 'application/vnd.workspace.spreadsheet', {})).toBe(
        'spreadsheet'
      )
    })

    it('falls to extension when MIME is unrecognized', () => {
      expect(detectEditorType('file.txt', 'application/octet-stream', {})).toBe('note')
    })
  })
})
