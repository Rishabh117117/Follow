import { SettingsSidebar } from '@/components/settings/settings-sidebar'

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--n100)' }}>
      <div className="mx-auto flex w-full max-w-[1000px]">
        <SettingsSidebar />
        <main className="flex-1 py-10 pl-8 pr-8">{children}</main>
      </div>
    </div>
  )
}
