'use client'

/**
 * /settings/profile — user profile, account, and data-export settings.
 *
 * PAGE-SHAPE-CLEANUP-1 (2026-04-23): body lives in `./_body.tsx`.
 * Next 14's App Router page contract forbids any named export from
 * a `page.tsx` beyond the allowed set (`default`, `metadata`,
 * `viewport`, `config`, `generateStaticParams`, ...). The ConfigHub
 * Profile tab still imports `ProfileSettingsBody` from `./_body`.
 */

export { default } from './_body'
