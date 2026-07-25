/**
 * Content Hasher (Sprint DA-1)
 *
 * SHA-256 hashing matching packages/api content-hash.ts format.
 */

import { createHash } from 'crypto'
import { readFile } from 'fs/promises'

export async function hashFile(filePath: string): Promise<string> {
  const content = await readFile(filePath)
  return createHash('sha256').update(content).digest('hex')
}

export function hashString(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex')
}

export function hashBuffer(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex')
}
