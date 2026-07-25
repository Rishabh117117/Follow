# AUTH-LIVE-1 — Real Google login on the deployed web (CC portion)

**Date:** 2026-06-16 · **Branch:** `claude/auth-live-1` (off `main`) → PR
**Repo:** `Rishabh117117/workspace-platform` · **App:** `@workspace/web`

> Scope note: AUTH-LIVE-1 is **config-heavy, minimal code**. The live gate (Google
> Cloud OAuth client + Railway env + `DEV_BYPASS_AUTH=false`) is Rishabh's, run on
> the deployed web (WEB-DEPLOY-1). This report covers the **CC portion**: verify
> the auth wiring end-to-end statically and fix the one real code defect found.

---

## The one code fix — middleware JWT secret

`apps/web/src/lib/auth.ts:43` signs the session JWT with
`process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET`, but
`apps/web/src/middleware.ts:19` verified it with `process.env.AUTH_SECRET`
**only**. If an operator sets just `NEXTAUTH_SECRET` (the NextAuth-canonical
name) on the web service, auth.ts signs (via the fallback) but the middleware
can't decode → `getToken` returns null → every logged-in user is bounced from
`/workspace` and `/onboarding` back to `/auth/login`. A silent, confusing
login loop.

**Fix:** mirror auth.ts's secret resolution in the middleware so the sign and
verify paths stay in lockstep.

```diff
- const token = await getToken({ req, secret: process.env.AUTH_SECRET })
+ const token = await getToken({
+   req,
+   secret: process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET,
+ })
```

Now setting **either** `AUTH_SECRET` or `NEXTAUTH_SECRET` (or both, same value)
works. The runbook still recommends setting `AUTH_SECRET` as the primary.

---

## Static verification of the rest of the auth chain — all wired

| Check                                                                        | Result | Evidence                                                                                                         |
| ---------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------- |
| JWT callback resolves a real user via the API                                | ✅     | `auth.ts:60` `POST ${NEXT_PUBLIC_API_URL}/api/auth/resolve-user`                                                 |
| …and writes `id` + `activeWorkspaceId` to the token                          | ✅     | `auth.ts:71-72`                                                                                                  |
| Session callback propagates both to `session.user`                           | ✅     | `auth.ts:91-92`                                                                                                  |
| Session type augmentation exists                                             | ✅     | `apps/web/src/types/next-auth.d.ts:10,18`                                                                        |
| API `resolve-user` find-or-creates user and returns the expected shape       | ✅     | `routes/auth.ts:117` → `{ data: { userId, workspaceId } }` (matches `data.data.userId` consumed at `auth.ts:71`) |
| `pages.newUser: '/onboarding'` resolves to a real route (no first-login 404) | ✅     | `apps/web/src/app/onboarding/page.tsx` exists                                                                    |
| Google provider gated on creds present                                       | ✅     | `auth.ts:14-21` (renders login page regardless; Google button appears once `GOOGLE_CLIENT_ID/SECRET` set)        |

**Gates:** web `typecheck` = **0** (unchanged); eslint `--max-warnings=0` clean on
`middleware.ts`. Web tests unchanged (middleware not exercised by the suite).

**No HALT.** The session shape carries `id` + `activeWorkspaceId` (the
`api-client` bridge's required headers); `resolve-user` will only 500 if the
live DB isn't migrated — which is why AUTH-LIVE-1's live gate depends on
MIGRATE-1 being live.

---

## Rishabh — live gate (unchanged from the plan)

1. **Google Cloud Console** → OAuth 2.0 Client (Web):
   - Authorized redirect URI: `https://<web-domain>/api/auth/callback/google`
   - Authorized JavaScript origin: `https://<web-domain>`
2. **Web service env:** `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and
   **`AUTH_SECRET`** (the fix above keeps `NEXTAUTH_SECRET` working too).
3. **API service:** `DEV_BYPASS_AUTH=false`; confirm `DATABASE_URL` points at the
   **migrated** DB (MIGRATE-1 adoption done).

### Gate to pass

Log in via Google → redirected back authenticated → a workspace route loads → an
authenticated API call (e.g. list projects) succeeds with `x-user-id` from the
session, `DEV_BYPASS_AUTH=false`. A new Google account → fresh user + workspace.

### HALT rules

`resolve-user` 500 on the live DB (→ coordinate with MIGRATE-1 adoption) ·
session missing `id`/`activeWorkspaceId` (→ not expected; wiring verified above).

## Depends on / next

WEB-DEPLOY-1 live + MIGRATE-1 live. Then **MCP-LIVE-1** (mint key + connect Claude).
