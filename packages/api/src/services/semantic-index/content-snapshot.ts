/**
 * Content Snapshot Helper (Sprint IX-3)
 *
 * Retrieves paragraph/section text from documents for evidence records.
 * Tries Yjs extraction first, then external document content, with graceful fallback.
 */

import { db } from '../../db/index'
import { eq, desc, and, lte } from 'drizzle-orm'
import { files } from '../../db/schema/files'
import { externalDocuments } from '../../db/schema/external-documents'
import { evidenceRecords } from '../../db/schema/semantic-index'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ContentSnapshotResult {
  text: string
  source: 'yjs' | 'external_document' | 'fallback'
  capturedAt: string
}

export interface SectionRef {
  heading?: string
  paragraphOffset?: number
}

// ─── Section Extraction ──────────────────────────────────────────────────────

/**
 * Extract a section/paragraph from full document text by heading or paragraph index.
 */
export function extractSection(
  fullText: string,
  sectionRef: SectionRef | null
): string | null {
  if (!sectionRef || !fullText) return null

  const paragraphs = fullText.split(/\n\n+/)

  if (sectionRef.heading) {
    const headingLower = sectionRef.heading.toLowerCase()
    const headingIndex = paragraphs.findIndex((p) =>
      p.trim().toLowerCase().includes(headingLower)
    )

    if (headingIndex >= 0) {
      // Find the next heading (end of this section)
      const nextHeadingIndex = paragraphs.findIndex(
        (p, i) => i > headingIndex && /^#{1,6}\s|^[A-Z][^.]{0,60}:?\s*$/.test(p.trim())
      )

      const sectionEnd = nextHeadingIndex > 0 ? nextHeadingIndex : paragraphs.length

      if (sectionRef.paragraphOffset !== undefined) {
        const paraIndex = headingIndex + 1 + sectionRef.paragraphOffset
        if (paraIndex < sectionEnd && paraIndex < paragraphs.length) {
          return paragraphs[paraIndex]!.trim()
        }
      }

      // Return entire section (capped at 2000 chars)
      const sectionText = paragraphs.slice(headingIndex, sectionEnd).join('\n\n')
      return sectionText.slice(0, 2000)
    }
  }

  // No heading match — try paragraph index directly
  if (
    sectionRef.paragraphOffset !== undefined &&
    sectionRef.paragraphOffset < paragraphs.length
  ) {
    return paragraphs[sectionRef.paragraphOffset]!.trim()
  }

  return null
}

// ─── Content Snapshot ────────────────────────────────────────────────────────

/**
 * Get paragraph/section text from a document.
 * Tries Yjs extraction, then external document content, with fallback to null.
 */
export async function getContentSnapshot(
  documentId: string,
  sectionRef: SectionRef | null,
  timing: 'before' | 'after'
): Promise<ContentSnapshotResult | null> {
  // Strategy 1: External document content (GWS docs)
  try {
    const [extDoc] = await db
      .select()
      .from(externalDocuments)
      .where(eq(externalDocuments.id, documentId))
      .limit(1)

    if (extDoc) {
      const meta = (extDoc.metadata ?? {}) as Record<string, unknown>
      const content = (meta.lastContentSnapshot as string) ?? null
      if (content) {
        const extracted = extractSection(content, sectionRef)
        if (extracted) {
          return {
            text: extracted,
            source: 'external_document',
            capturedAt: extDoc.updatedAt?.toISOString() ?? new Date().toISOString(),
          }
        }
      }
    }
  } catch {
    // External doc query failed — continue
  }

  // Strategy 2: Native document via Yjs text extraction
  try {
    const { extractFileContent } = await import('../document/yjs-text-extractor')
    const [file] = await db
      .select()
      .from(files)
      .where(eq(files.id, documentId))
      .limit(1)

    if (file) {
      const outline = extractFileContent(file as any)
      if (outline?.fullText) {
        const extracted = extractSection(outline.fullText, sectionRef)
        if (extracted) {
          return {
            text: extracted,
            source: 'yjs',
            capturedAt: new Date().toISOString(),
          }
        }
      }
    }
  } catch {
    // Yjs extraction not available — fallback
  }

  return null
}

/**
 * Get before/after content for evidence records.
 * "After" = current document state, "Before" = previous evidence contentAfter.
 */
export async function getContentBeforeAfter(
  documentId: string,
  sectionRef: SectionRef | null,
  eventTime: string
): Promise<{ before: string | null; after: string | null }> {
  // "After" is the current state (post-edit)
  const after = await getContentSnapshot(documentId, sectionRef, 'after')

  // "Before" comes from the most recent evidence record's contentAfter
  let before: string | null = null
  try {
    const conditions = [eq(evidenceRecords.documentId, documentId)]
    if (sectionRef?.heading) {
      conditions.push(eq(evidenceRecords.sectionRef, sectionRef.heading))
    }
    conditions.push(lte(evidenceRecords.createdAt, new Date(eventTime)))

    const [prevEvidence] = await db
      .select({ contentAfter: evidenceRecords.contentAfter })
      .from(evidenceRecords)
      .where(and(...conditions))
      .orderBy(desc(evidenceRecords.createdAt))
      .limit(1)

    before = prevEvidence?.contentAfter ?? null
  } catch {
    // Failed to fetch previous evidence — before stays null
  }

  return {
    before,
    after: after?.text ?? null,
  }
}
