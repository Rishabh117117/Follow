'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api-client'
import type { UserSettings } from '@workspace/shared/types'

interface MeData {
  profile: { settings: UserSettings }
}

type Theme = NonNullable<UserSettings['theme']>
type DocType = NonNullable<UserSettings['defaultDocType']>

export default function GeneralPage() {
  const qc = useQueryClient()
  const { data: me } = useQuery({
    queryKey: ['me'],
    queryFn: () => api.get<MeData>('/api/users/me'),
  })

  const patch = useMutation({
    mutationFn: (settings: Partial<UserSettings>) =>
      api.patch('/api/users/me', { settings }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me'] }),
  })

  const settings = me?.data?.profile.settings ?? {}
  const theme: Theme = settings.theme ?? 'follow'
  const defaultDocType: DocType = settings.defaultDocType ?? 'file'

  const setTheme = (t: Theme) => {
    patch.mutate({ theme: t })
    try {
      if (t === 'advanced') localStorage.setItem('follow-advanced-mode', 'true')
      else if (t === 'follow') localStorage.setItem('follow-advanced-mode', 'false')
      else localStorage.removeItem('follow-advanced-mode')
    } catch {
      // ignore
    }
  }

  return (
    <div className="space-y-10">
      <header>
        <h1
          className="text-[28px] leading-tight"
          style={{
            fontFamily: 'Newsreader, Georgia, serif',
            color: 'var(--n950)',
            fontWeight: 500,
          }}
        >
          General
        </h1>
        <p className="mt-1 text-[13px]" style={{ color: 'var(--n500)' }}>
          Appearance and default behavior.
        </p>
      </header>

      {/* Theme */}
      <section>
        <SectionHeading>Theme</SectionHeading>
        <div
          className="rounded-lg border bg-white"
          style={{ borderColor: 'var(--n200)' }}
        >
          {(
            [
              { v: 'follow' as const, label: 'Follow (White)', desc: 'Clean light theme for writing.' },
              { v: 'advanced' as const, label: 'Advanced (Dark)', desc: 'Full workspace chrome with dark colors.' },
              { v: 'system' as const, label: 'System', desc: 'Follow your OS preference.' },
            ]
          ).map((opt, i) => (
            <label
              key={opt.v}
              className="flex cursor-pointer items-start gap-3 px-4 py-3"
              style={{ borderTop: i > 0 ? '1px solid var(--n150)' : undefined }}
            >
              <input
                type="radio"
                checked={theme === opt.v}
                onChange={() => setTheme(opt.v)}
                className="mt-0.5"
              />
              <div className="flex-1">
                <div className="text-[13px]" style={{ color: 'var(--n950)' }}>
                  {opt.label}
                </div>
                <div className="text-[11px]" style={{ color: 'var(--n500)' }}>
                  {opt.desc}
                </div>
              </div>
            </label>
          ))}
        </div>
      </section>

      {/* Default document type */}
      <section>
        <SectionHeading>Default Document Type</SectionHeading>
        <div
          className="rounded-lg border bg-white p-4"
          style={{ borderColor: 'var(--n200)' }}
        >
          <select
            value={defaultDocType}
            onChange={(e) => patch.mutate({ defaultDocType: e.target.value as DocType })}
            className="w-full max-w-xs rounded-md border bg-white px-3 py-2 text-[13px]"
            style={{ borderColor: 'var(--n300)', color: 'var(--n950)' }}
          >
            <option value="file">Document</option>
            <option value="note">Note</option>
          </select>
          <p className="mt-2 text-[11px]" style={{ color: 'var(--n500)' }}>
            Used when creating a new document from the dashboard.
          </p>
        </div>
      </section>
    </div>
  )
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2
      className="mb-3 text-[11px] font-semibold uppercase tracking-wider"
      style={{ color: 'var(--n500)' }}
    >
      {children}
    </h2>
  )
}
