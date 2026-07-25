/**
 * WebChatApp — Minimal React tree for non-Google-Workspace pages.
 * Only renders the Floating Chat when "Chat in Web" is toggled on.
 */

import React from 'react'
import { FloatingUnit } from '@/components/floating-unit/FloatingUnit'

export function WebChatApp() {
  return <FloatingUnit />
}
