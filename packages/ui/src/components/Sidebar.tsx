'use client'

import React, { useState, createContext, useContext } from 'react'
import { cn } from '@workspace/shared/utils'

// --- Context ---

interface SidebarContextValue {
  collapsed: boolean
  toggle: () => void
}

const SidebarContext = createContext<SidebarContextValue>({
  collapsed: false,
  toggle: () => {},
})

const useSidebar = () => useContext(SidebarContext)

// --- Sidebar ---

export interface SidebarProps {
  children: React.ReactNode
  defaultCollapsed?: boolean
  className?: string
}

export const Sidebar: React.FC<SidebarProps> = ({
  children,
  defaultCollapsed = false,
  className,
}) => {
  const [collapsed, setCollapsed] = useState(defaultCollapsed)

  const toggle = () => setCollapsed((prev) => !prev)

  return (
    <SidebarContext.Provider value={{ collapsed, toggle }}>
      <aside
        className={cn(
          'flex h-full flex-col border-r border-zinc-800 bg-zinc-950 transition-all duration-200',
          collapsed ? 'w-14' : 'w-60',
          className
        )}
      >
        {/* Toggle button */}
        <div className="flex items-center justify-end p-2">
          <button
            onClick={toggle}
            className="rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={cn('transition-transform duration-200', collapsed && 'rotate-180')}
            >
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <nav className="flex-1 overflow-y-auto overflow-x-hidden px-2 pb-4">{children}</nav>
      </aside>
    </SidebarContext.Provider>
  )
}

// --- SidebarSection ---

export interface SidebarSectionProps {
  title?: string
  children: React.ReactNode
  className?: string
}

export const SidebarSection: React.FC<SidebarSectionProps> = ({ title, children, className }) => {
  const { collapsed } = useSidebar()

  return (
    <div className={cn('mb-4', className)}>
      {title && !collapsed && (
        <h3 className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
          {title}
        </h3>
      )}
      <div className="space-y-0.5">{children}</div>
    </div>
  )
}

// --- SidebarItem ---

export interface SidebarItemProps {
  icon?: React.ReactNode
  label: string
  active?: boolean
  onClick?: () => void
  className?: string
}

export const SidebarItem: React.FC<SidebarItemProps> = ({
  icon,
  label,
  active = false,
  onClick,
  className,
}) => {
  const { collapsed } = useSidebar()

  return (
    <button
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-sm font-medium transition-colors',
        active
          ? 'bg-violet-600/20 text-violet-400'
          : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100',
        collapsed && 'justify-center px-0',
        className
      )}
      title={collapsed ? label : undefined}
    >
      {icon && <span className="flex h-5 w-5 shrink-0 items-center justify-center">{icon}</span>}
      {!collapsed && <span className="truncate">{label}</span>}
    </button>
  )
}
