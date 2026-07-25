/**
 * Reads Google Doc state via dom-bridge: title, content, cursor, selection.
 */

import { useState, useEffect, useCallback } from 'react'
import { getDocTitle, getSelectedText, getSelectionBounds, getCollaborators, isUserEditing } from '@/content/dom-bridge'
import type { GoogleDocType } from '@/lib/google-doc-utils'

interface GoogleDocHookState {
  title: string
  selectedText: string | null
  selectionBounds: DOMRect | null
  collaborators: { name: string; color: string }[]
  isEditing: boolean
  cursorPosition: { paragraphIndex: number; charOffset: number } | null
}

export function useGoogleDoc(docType: GoogleDocType, googleDocId: string) {
  const [state, setState] = useState<GoogleDocHookState>({
    title: 'Untitled',
    selectedText: null,
    selectionBounds: null,
    collaborators: [],
    isEditing: false,
    cursorPosition: null,
  })

  // Refresh title periodically
  useEffect(() => {
    const updateTitle = () => {
      setState((s) => ({ ...s, title: getDocTitle() }))
    }
    updateTitle()
    const interval = setInterval(updateTitle, 5000)
    return () => clearInterval(interval)
  }, [])

  // Monitor selection changes
  useEffect(() => {
    const handler = () => {
      setState((s) => ({
        ...s,
        selectedText: getSelectedText(),
        selectionBounds: getSelectionBounds(),
        isEditing: isUserEditing(),
      }))
    }

    document.addEventListener('selectionchange', handler)
    return () => document.removeEventListener('selectionchange', handler)
  }, [])

  // Refresh collaborators periodically
  useEffect(() => {
    const updateCollaborators = () => {
      setState((s) => ({ ...s, collaborators: getCollaborators() }))
    }
    updateCollaborators()
    const interval = setInterval(updateCollaborators, 10000)
    return () => clearInterval(interval)
  }, [])

  // Listen for cursor change events from content script
  useEffect(() => {
    const mountPoint = document.getElementById('follow-app')
    if (!mountPoint) return

    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail
      setState((s) => ({ ...s, cursorPosition: detail.position }))
    }
    mountPoint.addEventListener('follow-cursor-change', handler)
    return () => mountPoint.removeEventListener('follow-cursor-change', handler)
  }, [])

  const refreshState = useCallback(() => {
    setState({
      title: getDocTitle(),
      selectedText: getSelectedText(),
      selectionBounds: getSelectionBounds(),
      collaborators: getCollaborators(),
      isEditing: isUserEditing(),
      cursorPosition: null,
    })
  }, [])

  return {
    ...state,
    docType,
    googleDocId,
    refreshState,
  }
}
