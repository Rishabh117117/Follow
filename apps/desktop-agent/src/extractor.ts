/**
 * Text Extractor (Sprint DA-1)
 *
 * Extracts readable text from files by MIME type.
 */

import { readFile } from 'fs/promises'
import { extname } from 'path'

const MAX_TEXT_LENGTH = 500_000

const TEXT_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.rs', '.go', '.java', '.c', '.cpp', '.h', '.hpp',
  '.rb', '.php', '.swift', '.kt', '.scala', '.cs',
  '.sql', '.sh', '.bash', '.zsh', '.ps1', '.bat', '.cmd',
  '.yml', '.yaml', '.toml', '.ini', '.cfg',
  '.md', '.mdx', '.txt', '.csv', '.tsv',
  '.html', '.htm', '.css', '.scss', '.less', '.sass',
  '.json', '.jsonc', '.json5', '.xml', '.svg',
  '.env.example', '.gitignore', '.dockerignore',
  '.editorconfig', '.prettierrc', '.eslintrc',
  '.graphql', '.gql', '.proto', '.prisma',
  '.tf', '.hcl', '.cmake', '.makefile',
  '.r', '.R', '.jl', '.lua', '.dart', '.ex', '.exs',
])

const TEXT_MIMES = new Set([
  'text/plain', 'text/markdown', 'text/csv', 'text/html', 'text/css',
  'text/xml', 'text/yaml', 'text/x-python', 'text/x-java',
  'application/json', 'application/javascript', 'application/typescript',
  'application/xml', 'application/yaml', 'application/x-yaml',
  'application/x-sh', 'application/sql',
])

export async function extractText(filePath: string, mimeType: string): Promise<string> {
  const ext = extname(filePath).toLowerCase()

  // Text files: read as-is
  if (TEXT_EXTENSIONS.has(ext) || TEXT_MIMES.has(mimeType) || mimeType.startsWith('text/')) {
    try {
      let content = await readFile(filePath, 'utf-8')
      // Strip null bytes
      content = content.replace(/\0/g, '')
      // Normalize line endings
      content = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
      // Truncate
      if (content.length > MAX_TEXT_LENGTH) {
        content = content.slice(0, MAX_TEXT_LENGTH) + '\n\n[Truncated at 500K characters]'
      }
      return content
    } catch {
      return ''
    }
  }

  // SVG: it's text
  if (ext === '.svg' || mimeType === 'image/svg+xml') {
    try {
      return await readFile(filePath, 'utf-8')
    } catch {
      return ''
    }
  }

  // PDF
  if (ext === '.pdf' || mimeType === 'application/pdf') {
    return '[PDF file — text extraction requires pdftotext]'
  }

  // Office
  if (
    ext === '.docx' || ext === '.xlsx' || ext === '.pptx' ||
    mimeType.includes('openxmlformats')
  ) {
    return '[Office file — content will be indexed after text extraction is implemented]'
  }

  // Images (non-SVG)
  if (mimeType.startsWith('image/')) {
    return '[Image file — visual content will be indexed via vision model in a future update]'
  }

  // Binary / unknown
  return ''
}

export function isTextExtractable(filePath: string, mimeType: string): boolean {
  const ext = extname(filePath).toLowerCase()
  return TEXT_EXTENSIONS.has(ext) || TEXT_MIMES.has(mimeType) || mimeType.startsWith('text/')
}
