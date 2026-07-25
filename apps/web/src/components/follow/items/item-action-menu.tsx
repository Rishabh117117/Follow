'use client'

/**
 * ItemActionMenu (Sprint CTX-1; UI-MIGRATE-1 migrated to ContextMenu primitive)
 *
 * Dropdown menu shown from the ⋯ button on each index item.
 */
import { useState } from 'react'
import { ContextMenu, type ContextMenuItem as UiMenuItem } from '@workspace/ui'
import { useItemManageStore } from '@/stores/item-manage-store'
import { useChatContextStore } from '@/stores/chat-context-store'
import { authFetch } from '@/lib/api-client'
import { ShareV2Panel } from '@/components/follow/sharing/share-v2-panel'
import { EraseDialog } from '@/components/follow/modals/erase-dialog'

export interface IndexItem {
  id: string
  name: string
  hidden?: boolean
  type?: 'conv' | 'file' | 'fact'
  /** Storage backend distinction. 'file' is the workspace files table;
   *  'rawfile' is the raw_files table (uploads). The Erase action routes
   *  on this so non-fact items hit the right delete endpoint instead of
   *  silently no-opping against /api/index/items. */
  kind?: 'conv' | 'file' | 'rawfile' | 'fact'
}

export interface ItemActionMenuProps {
  item: IndexItem
  onClose: () => void
  onAfterAction?: () => void
}

async function callHide(id: string, hide: boolean) {
  await authFetch(`/api/index/items/${id}/${hide ? 'hide' : 'unhide'}`, { method: 'PATCH' })
}

export function ItemActionMenu({ item, onClose, onAfterAction }: ItemActionMenuProps) {
  const openConfirmDialog = useItemManageStore((s) => s.openConfirmDialog)
  const chatCtx = useChatContextStore?.() ?? null
  const [shareOpen, setShareOpen] = useState(false)
  const [eraseOpen, setEraseOpen] = useState(false)

  const items: UiMenuItem[] = [
    {
      id: 'action-hide-toggle',
      label: item.hidden ? 'Unhide' : 'Hide from index',
      accentColor: item.hidden ? '#2d8a4e' : '#b7791f',
      onSelect: async () => {
        await callHide(item.id, !item.hidden)
        onAfterAction?.()
        onClose()
      },
    },
    {
      id: 'action-pin',
      label: 'Pin to chat',
      onSelect: () => {
        const pin = (chatCtx as unknown as Record<string, unknown>)?.pinItem
        if (typeof pin === 'function') (pin as (id: string) => void)(item.id)
        onClose()
      },
    },
    {
      id: 'action-contribute',
      label: 'Contribute to project',
      onSelect: () => {
        onClose()
      },
    },
    {
      id: 'action-send',
      label: 'Send to teammate',
      onSelect: () => {
        if (item.type === 'file') {
          setShareOpen(true)
        } else {
          onClose()
        }
      },
    },
    // 2026-04-29: split the destructive action into two clearly-named choices.
    //   - Forget   → soft delete; row disappears from the UI but is restorable
    //                from the "Recently forgotten" bin for 30 days.
    //   - Erase    → GDPR-style; redacts content + audit, no restore. Behind
    //                a separate confirm with a typed reason.
    {
      id: 'action-forget',
      label: 'Forget · removable for 30 days',
      danger: true,
      onSelect: () => {
        openConfirmDialog(item.id, item.name)
        onClose()
      },
    },
    {
      id: 'action-erase',
      label: 'Erase permanently…',
      danger: true,
      onSelect: () => {
        // Opens the EraseDialog (typed-confirm + reason). Don't close the
        // menu yet — we keep this component mounted so the dialog renders
        // alongside it; close happens after the dialog finishes.
        setEraseOpen(true)
      },
    },
  ]

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{ position: 'absolute', right: 8, top: '100%', marginTop: 4, zIndex: 50 }}
    >
      <ContextMenu items={items} onClose={onClose} testIdPrefix="item" />
      {/* UI-MIGRATE-1: consolidated onto ShareV2Panel. Only mounted while
          open — ShareV2Panel calls useQuery unconditionally, so mounting it
          closed would require a QueryClientProvider in every test harness. */}
      {shareOpen && (
        <ShareV2Panel
          isOpen={shareOpen}
          onClose={() => {
            setShareOpen(false)
            onClose()
          }}
          fileId={item.id}
          fileName={item.name}
        />
      )}
      {eraseOpen && (
        <EraseDialog
          itemId={item.id}
          itemName={item.name}
          kind={item.kind ?? (item.type === 'fact' ? 'fact' : 'file')}
          onClose={() => {
            setEraseOpen(false)
            onClose()
          }}
          onErased={() => {
            onAfterAction?.()
          }}
        />
      )}
    </div>
  )
}
