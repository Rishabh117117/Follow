/**
 * Content Hash Utility (Sprint IX-8)
 *
 * sha256-based integrity hashing for index_records version-linking.
 * Every index record stamps a hash of the source content it was built
 * from, so later verification can confirm the record traces to the
 * exact version of source content that was indexed.
 */

import { createHash } from 'crypto'

/**
 * Compute sha256 hash of source content for version-linking integrity.
 * Used by the indexer to stamp each index_record with a verifiable
 * hash of the source content it was built from.
 */
export function computeContentHash(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex')
}

/**
 * Verify that an index record's source_content_hash matches
 * the actual content of the referenced source version.
 */
export function verifyContentHash(content: string, expectedHash: string): boolean {
  return computeContentHash(content) === expectedHash
}
