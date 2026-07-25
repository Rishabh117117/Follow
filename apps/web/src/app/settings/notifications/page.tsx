'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api-client'
import type { UserSettings } from '@workspace/shared/types'

interface MeData {
  profile: { settings: UserSettings }
}

type NotifKey = 'share' | 'comment' | 'mention' | 'tension' | 'system'

const ROWS: { key: NotifKey; label: string; desc: string }[] = [
  {
    key: 'share',
    label: 'Document shared with you',
    desc: 'When someone shares a document with you or invites you to collaborate.',
  },
  {
    key: 'comment',
    label: 'Comments on your documents',
    desc: 'When a collaborator leaves a comment or replies to yours.',
  },
  {
    key: 'mention',
    label: '@Mentions',
    desc: 'When someone mentions you in a document or chat.',
  },
  {
    key: 'tension',
    label: 'AI tensions detected',
    desc: 'When Follow detects contradictions or conflicts in your work.',
  },
  {
    key: 'system',
    label: 'System announcements',
    desc: 'Product updates and important changes.',
  },
]

export default function NotificationsPage() {
  const qc = useQueryClient()
  const { data: me } = useQuery({
    queryKey: ['me'],
    queryFn: () => api.get<MeData>('/api/users/me'),
  })

  const patch = useMutation({
    mutationFn: (notifications: Partial<Record<NotifKey, boolean>>) =>
      api.patch('/api/users/me', { settings: { notifications } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me'] }),
  })

  const prefs = me?.data?.profile.settings.notifications ?? {}

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
          Notifications
        </h1>
        <p className="mt-1 text-[13px]" style={{ color: 'var(--n500)' }}>
          Choose which notifications you want to receive.
        </p>
      </header>

      <section>
        <div
          className="rounded-lg border bg-white"
          style={{ borderColor: 'var(--n200)' }}
        >
          {ROWS.map((row, idx) => {
            const checked = prefs[row.key] ?? true
            return (
              <div
                key={row.key}
                className="flex items-start justify-between gap-4 px-4 py-4"
                style={{ borderTop: idx > 0 ? '1px solid var(--n150)' : undefined }}
              >
                <div className="flex-1">
                  <div className="text-[13px]" style={{ color: 'var(--n950)' }}>
                    {row.label}
                  </div>
                  <div className="text-[11px]" style={{ color: 'var(--n500)' }}>
                    {row.desc}
                  </div>
                </div>
                <Toggle
                  checked={checked}
                  onChange={(v) => patch.mutate({ [row.key]: v })}
                />
              </div>
            )
          })}
        </div>
      </section>
    </div>
  )
}

function Toggle({
  checked,
  onChange,
}: {
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className="relative h-[22px] w-[38px] flex-shrink-0 rounded-full transition-colors"
      style={{ backgroundColor: checked ? 'var(--n950)' : 'var(--n300)' }}
      role="switch"
      aria-checked={checked}
    >
      <span
        className="absolute top-[2px] h-[18px] w-[18px] rounded-full bg-white transition-transform"
        style={{ transform: checked ? 'translateX(18px)' : 'translateX(2px)' }}
      />
    </button>
  )
}
