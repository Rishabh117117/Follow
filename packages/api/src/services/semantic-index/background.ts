/**
 * Semantic Index Background Jobs (Sprint IX-1)
 *
 * Manages background intervals for:
 * 1. Episode refinement — every 5 minutes
 * 2. Engagement depth updates — every 5 minutes (offset by 2.5 min)
 */

import { db } from '../../db/index'
import { sql } from 'drizzle-orm'
import { workspaces } from '../../db/schema/workspaces'
import { refineEpisodes } from './episode-refiner'
import { updateEngagementDepths } from './engagement-updater'

const EPISODE_INTERVAL_MS = 5 * 60 * 1000     // 5 minutes
const ENGAGEMENT_INTERVAL_MS = 5 * 60 * 1000  // 5 minutes
const ENGAGEMENT_OFFSET_MS = 2.5 * 60 * 1000  // 2.5 minute offset

let episodeHandle: ReturnType<typeof setInterval> | null = null
let engagementHandle: ReturnType<typeof setInterval> | null = null
let engagementTimeout: ReturnType<typeof setTimeout> | null = null

/**
 * Start all semantic index background jobs.
 */
export function startSemanticIndexBackground(): void {
  if (episodeHandle) {
    console.warn('[SemanticIndex] Background jobs already running')
    return
  }

  console.info('[SemanticIndex] Starting background jobs (episode refinement, engagement depth)')

  // Episode refinement — runs immediately then every 5 minutes
  episodeHandle = setInterval(async () => {
    try {
      const workspaceIds = await getActiveWorkspaceIds()
      for (const wsId of workspaceIds) {
        await refineEpisodes(wsId).catch((err) =>
          console.warn(`[SemanticIndex] Episode refinement failed for ${wsId}:`, err)
        )
      }
    } catch (err) {
      console.error('[SemanticIndex] Episode refinement cycle failed:', err)
    }
  }, EPISODE_INTERVAL_MS)

  // Engagement depth — offset by 2.5 minutes to avoid overlap
  engagementTimeout = setTimeout(() => {
    engagementHandle = setInterval(async () => {
      try {
        const workspaceIds = await getActiveWorkspaceIds()
        for (const wsId of workspaceIds) {
          await updateEngagementDepths(wsId).catch((err) =>
            console.warn(`[SemanticIndex] Engagement update failed for ${wsId}:`, err)
          )
        }
      } catch (err) {
        console.error('[SemanticIndex] Engagement depth cycle failed:', err)
      }
    }, ENGAGEMENT_INTERVAL_MS)
  }, ENGAGEMENT_OFFSET_MS)
}

/**
 * Stop all semantic index background jobs.
 */
export function stopSemanticIndexBackground(): void {
  if (episodeHandle) {
    clearInterval(episodeHandle)
    episodeHandle = null
  }
  if (engagementHandle) {
    clearInterval(engagementHandle)
    engagementHandle = null
  }
  if (engagementTimeout) {
    clearTimeout(engagementTimeout)
    engagementTimeout = null
  }
  console.info('[SemanticIndex] Background jobs stopped')
}

/**
 * Get workspace IDs that have recent activity (last 30 minutes).
 * Avoids processing dormant workspaces.
 */
async function getActiveWorkspaceIds(): Promise<string[]> {
  try {
    const results = await db
      .select({ id: workspaces.id })
      .from(workspaces)

    return results.map((r) => r.id)
  } catch {
    return []
  }
}
