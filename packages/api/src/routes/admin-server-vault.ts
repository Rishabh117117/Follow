/**
 * Admin — Server Vault Inspector (SERVER-VAULT-DASHBOARD-1, 2026-04-23)
 *
 * GET /api/admin/server-vault
 *   Returns the current server-vault state: every flag with its id / name /
 *   description / category / active status, plus a summary block
 *   (total / active / per-category counts). Operators use this to see
 *   what's gated vs live without grepping source.
 *
 * Auth pattern mirrors `routes/admin.ts` — `authMiddleware` on all routes,
 * reads `c.get('userId')` (currently any logged-in user; admin-role check
 * is out of scope for this sprint).
 *
 * This route is intentionally NOT wrapped in `isServerFeatureActive` — it
 * is the surface that reports what's gated; self-referential gating would
 * defeat its purpose. Treat it as KEEP.
 */

import { Hono } from 'hono'
import { authMiddleware } from '../middleware/auth'
import { getServerVaultFlags, type ServerVaultFeature } from '../config/server-vault'

const adminServerVaultRouter = new Hono()
adminServerVaultRouter.use('*', authMiddleware)

adminServerVaultRouter.get('/', (c) => {
  const flags = getServerVaultFlags().map((f: ServerVaultFeature) => ({
    id: f.id,
    name: f.name,
    description: f.description,
    category: f.category,
    active: f.active,
  }))

  const byCategory: Record<string, { total: number; active: number }> = {}
  let activeTotal = 0
  for (const f of flags) {
    if (!byCategory[f.category]) byCategory[f.category] = { total: 0, active: 0 }
    byCategory[f.category]!.total++
    if (f.active) {
      byCategory[f.category]!.active++
      activeTotal++
    }
  }

  return c.json({
    flags,
    summary: {
      total: flags.length,
      active: activeTotal,
      byCategory,
    },
  })
})

export { adminServerVaultRouter }
