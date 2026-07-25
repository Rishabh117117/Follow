'use client'

import { ToggleSwitch } from './toggle-switch'

export function AutoUpdateToggle({
  on,
  busy,
  onChange,
  testId,
  title,
}: {
  on: boolean
  busy?: boolean
  onChange: (next: boolean) => void
  testId?: string
  title?: string
}) {
  return (
    <ToggleSwitch
      on={on}
      busy={busy}
      onChange={onChange}
      testId={testId}
      title={title}
      label={on ? 'Auto-update on' : 'Auto-update off'}
    />
  )
}
