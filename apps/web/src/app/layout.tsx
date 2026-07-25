import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import { SessionProvider } from '@/lib/session-provider'
import { QueryProvider } from '@/lib/query-provider'
import './globals.css'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' })

export const metadata: Metadata = {
  title: {
    default: 'Workspace Platform',
    template: '%s | Workspace Platform',
  },
  description: 'AI-native collaborative workspace',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} font-sans`}>
        <SessionProvider>
          <QueryProvider>{children}</QueryProvider>
        </SessionProvider>
      </body>
    </html>
  )
}
