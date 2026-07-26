'use client'

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { CommandPalette, type CommandItem } from '@workspace/ui'
import { api } from '@/lib/api-client'

interface CommandPaletteContextValue {
  open: () => void
  close: () => void
}

const CommandPaletteContext = createContext<CommandPaletteContextValue>({
  open: () => undefined,
  close: () => undefined,
})

export function useCommandPalette() {
  return useContext(CommandPaletteContext)
}

interface SearchResult {
  id: string
  name: string
  type: 'file' | 'folder'
  mimeType: string | null
  parentFolderId: string | null
}

export function CommandPaletteProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false)
  const [query, setQuery] = useState('')
  const router = useRouter()
  const params = useParams()
  const workspaceId = params?.id as string | undefined

  const open = useCallback(() => setIsOpen(true), [])
  const close = useCallback(() => {
    setIsOpen(false)
    setQuery('')
  }, [])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setIsOpen((prev) => !prev)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  const { data: searchData } = useQuery({
    queryKey: ['cmd-search', workspaceId, query],
    queryFn: () =>
      api.get<SearchResult[]>(
        `/api/files/search?q=${encodeURIComponent(query)}&workspaceId=${workspaceId}`
      ),
    enabled: isOpen && !!workspaceId && query.length >= 2,
  })

  const baseId = workspaceId ? `/workspace/${workspaceId}` : '/workspace/demo'

  // teams-1: the shell is chrome-less, so the command palette is where the
  // workspace/teams actions live (switch, manage members, leave).
  const navCommands: CommandItem[] = [
    {
      id: 'nav-overview',
      label: 'Go to Overview',
      description: 'Workspace dashboard',
      onSelect: () => {
        router.push(baseId)
        close()
      },
    },
    {
      id: 'nav-switch-workspace',
      label: 'Switch workspace',
      description: 'Choose a different workspace',
      onSelect: () => {
        router.push('/workspace')
        close()
      },
    },
    ...(workspaceId
      ? [
          {
            id: 'nav-members',
            label: 'Manage members',
            description: 'Invite teammates and manage roles',
            onSelect: () => {
              router.push(`/workspace/${workspaceId}/settings`)
              close()
            },
          },
        ]
      : []),
    {
      id: 'nav-settings',
      label: 'Go to Settings',
      description: 'Account and workspace settings',
      onSelect: () => {
        router.push('/settings/general')
        close()
      },
    },
    ...(workspaceId
      ? [
          {
            id: 'nav-leave',
            label: 'Leave workspace',
            description: 'Remove yourself from this workspace',
            onSelect: async () => {
              close()
              if (!window.confirm('Leave this workspace? You will lose access until re-invited.')) {
                return
              }
              const res = await api.post<{ ok: boolean }>(`/api/workspaces/${workspaceId}/leave`)
              if (res.error) {
                window.alert(res.error.message ?? 'Could not leave the workspace.')
                return
              }
              router.push('/workspace')
            },
          },
        ]
      : []),
  ]

  const fileResults: CommandItem[] = (searchData?.data ?? [])
    .filter((file) => file.type !== 'folder')
    .map((file) => ({
      id: `file-${file.id}`,
      label: file.name,
      description: file.mimeType ?? 'File',
      onSelect: () => {
        router.push(`${baseId}/editor/${file.id}`)
        close()
      },
    }))

  const commands = [...navCommands, ...fileResults]

  return (
    <CommandPaletteContext.Provider value={{ open, close }}>
      {children}
      <CommandPalette items={commands} isOpen={isOpen} onClose={close} />
    </CommandPaletteContext.Provider>
  )
}
