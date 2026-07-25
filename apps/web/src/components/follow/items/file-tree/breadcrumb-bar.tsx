'use client'

import { useEffect, useState } from 'react'
import { authFetch } from '@/lib/api-client'
import { watchPillStyle, crumbBtn } from '../_shared'
import type { classifyWatchedPath } from '../_shared'
import { AutoUpdateToggle } from '../toggles/auto-update-toggle'

export function BreadcrumbBar({
  segments,
  currentPath,
  onNavigate,
  showSideTree,
  onToggleSideTree,
  classification,
  classificationLoading,
  launcherReachable,
  queueStopped,
  queuePaused,
  onUnwatched,
}: {
  segments: string[]
  currentPath: string
  onNavigate: (p: string) => void
  showSideTree: boolean
  onToggleSideTree: () => void
  classification: ReturnType<typeof classifyWatchedPath>
  classificationLoading?: boolean
  launcherReachable?: boolean
  queueStopped?: boolean
  queuePaused?: boolean
  onUnwatched: () => void
}) {
  const [busy, setBusy] = useState<null | 'unwatch' | 'stop-index'>(null)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  const launcherBase =
    (typeof window !== 'undefined' && process.env.NEXT_PUBLIC_LAUNCHER_URL) ||
    'http://localhost:4000'

  // Auto-clear the success/error toast after a few seconds so it doesn't
  // pile up across repeated actions.
  useEffect(() => {
    if (!msg) return
    const t = setTimeout(() => setMsg(null), msg.kind === 'ok' ? 3500 : 6000)
    return () => clearTimeout(t)
  }, [msg])

  // The exact path we'll send to the launcher — the watched folder's literal
  // path from the config, not the normalized breadcrumb slug. Preserves the
  // original separator style so the unwatch lookup matches without fighting
  // over `/` vs `\`.
  const canonicalWatchedPath = classification.match?.path ?? currentPath

  // Toggle auto-update (formerly "follow"): ON calls /watch, OFF calls
  // /unwatch. Same handler so the toggle switch animates uniformly.
  const toggleAutoUpdate = async (nextOn: boolean) => {
    if (!currentPath) return
    // Going OFF from a watched root — still confirm since it has a real
    // side effect (new changes stop flowing to the index).
    if (!nextOn) {
      if (classification.state !== 'watched') return
      if (
        !window.confirm(
          'Turn off auto-update for this folder?\n\n' +
            canonicalWatchedPath +
            '\n\n' +
            'The Desktop Agent will stop watching it. Files already indexed stay searchable.'
        )
      )
        return
    }
    // Going ON — convert the display path back to a native-slash form so
    // the agent config looks consistent with existing entries.
    const pathForLauncher = nextOn ? currentPath.replace(/\//g, '\\') : canonicalWatchedPath
    setBusy('unwatch')
    setMsg(null)
    try {
      const endpoint = nextOn ? 'watch' : 'unwatch'
      const res = await fetch(`${launcherBase}/api/agent/sources/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: pathForLauncher }),
      })
      const body = (await res.json().catch(() => null)) as {
        ok?: boolean
        error?: string
        alreadyWatched?: boolean
      } | null
      if (!res.ok) {
        const nice =
          res.status === 404
            ? "Folder wasn't in the watched list."
            : res.status === 409
              ? 'No agent config — provision the Desktop Agent first.'
              : body?.error || `Couldn't reach launcher (status ${res.status})`
        throw new Error(nice)
      }
      setMsg({
        kind: 'ok',
        text: nextOn
          ? body?.alreadyWatched
            ? 'Already auto-updating this folder.'
            : `Auto-update on for ${pathForLauncher}.`
          : `Auto-update off for ${pathForLauncher}.`,
      })
      onUnwatched()
    } catch (e) {
      setMsg({ kind: 'err', text: (e as Error).message })
    } finally {
      setBusy(null)
    }
  }

  const stopIndexing = async () => {
    if (!currentPath) return
    if (
      !window.confirm(
        'Stop indexing this folder (and everything under it)?\n\n' +
          currentPath +
          '\n\n' +
          'Cancels every pending and in-flight index job for this folder subtree. Stays stopped across restarts until you Jump-start from the MCP panel.'
      )
    )
      return
    setBusy('stop-index')
    setMsg(null)
    try {
      const res = await authFetch('/api/index-queue/folder/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderPath: currentPath }),
      })
      const body = (await res.json().catch(() => null)) as {
        data?: { cancelled?: number; snapshotSize?: number }
        error?: { message?: string }
      } | null
      if (!res.ok) {
        throw new Error(body?.error?.message || `Indexing server returned ${res.status}`)
      }
      const cancelled = body?.data?.cancelled ?? 0
      const snap = body?.data?.snapshotSize ?? cancelled
      // Honest feedback: if zero jobs matched, say so — otherwise the user
      // keeps clicking a button that silently does nothing (the exact bug
      // that prompted this fix).
      if (cancelled === 0) {
        setMsg({
          kind: 'ok',
          text:
            'Marked stopped, but no active jobs under this folder to cancel. ' +
            '(If the global queue is already stopped, Jump-start from the MCP panel first.)',
        })
      } else {
        setMsg({
          kind: 'ok',
          text: `Stopped ${cancelled} job${cancelled === 1 ? '' : 's'} for ${currentPath} (${snap} in snapshot).`,
        })
      }
    } catch (e) {
      setMsg({ kind: 'err', text: (e as Error).message })
    } finally {
      setBusy(null)
    }
  }

  // Auto-update control: a toggle on watched-root and leaf (not-followed)
  // states, an informational pill on 'inside' (inherited) and 'contains'
  // (ancestor) states where a simple toggle would be wrong — you can't
  // individually un-follow a subfolder that's covered by a watched parent.
  const autoUpdateControl = (() => {
    if (!currentPath) return null
    if (launcherReachable === false) {
      return (
        <span
          style={watchPillStyle('contains')}
          title="Can't reach the Desktop Agent launcher at :4000 — its state is unknown. Restart it to manage auto-update from here."
          data-testid="follow-status-unreachable"
        >
          Launcher offline
        </span>
      )
    }
    if (classificationLoading) {
      return (
        <span
          style={watchPillStyle('none')}
          title="Checking watched folders…"
          data-testid="follow-status-loading"
        >
          Checking…
        </span>
      )
    }
    if (classification.state === 'watched') {
      return (
        <AutoUpdateToggle
          on
          busy={busy === 'unwatch'}
          onChange={(v) => toggleAutoUpdate(v)}
          testId="auto-update-toggle"
          title="Desktop Agent is auto-updating this folder"
        />
      )
    }
    if (classification.state === 'inside' && classification.match) {
      return (
        <span
          style={watchPillStyle('inherited')}
          title={`Auto-update is inherited from: ${classification.match.path}. Go to that root to turn it off.`}
          data-testid="follow-status-inside"
        >
          <span aria-hidden>●</span> Auto-updating via{' '}
          <button
            type="button"
            onClick={() => {
              const root = classification.match!.path.replace(/\\/g, '/')
              onNavigate(root)
            }}
            style={{
              border: 'none',
              background: 'transparent',
              padding: 0,
              fontSize: 10,
              color: 'inherit',
              textDecoration: 'underline',
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {classification.match.path.split(/[\\/]/).filter(Boolean).pop() ||
              classification.match.path}
          </button>
        </span>
      )
    }
    if (classification.state === 'contains' && classification.contained) {
      return (
        <span
          style={watchPillStyle('contains')}
          title={`Auto-updating folders underneath:\n${classification.contained.map((f) => f.path).join('\n')}`}
          data-testid="follow-status-contains"
        >
          Contains {classification.contained.length} auto-updated
        </span>
      )
    }
    // No watched root involved — the toggle can turn ON to start watching.
    return (
      <AutoUpdateToggle
        on={false}
        busy={busy === 'unwatch'}
        onChange={(v) => toggleAutoUpdate(v)}
        testId="auto-update-toggle"
        title="Turn auto-update on for this folder"
      />
    )
  })()

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '10px 14px',
        borderBottom: '1px solid var(--n150, #e5e2de)',
        fontSize: 13,
        color: 'var(--n600, #6b6358)',
        flexWrap: 'wrap',
        minHeight: 44,
      }}
      data-testid="folder-breadcrumb"
    >
      <button
        type="button"
        onClick={onToggleSideTree}
        title={showSideTree ? 'Hide sidebar tree' : 'Show sidebar tree'}
        style={{
          padding: '4px 8px',
          marginRight: 6,
          background: showSideTree ? 'var(--n100,#f0eeeb)' : 'transparent',
          border: '1px solid var(--n200, #d8d4cf)',
          borderRadius: 4,
          cursor: 'pointer',
          fontSize: 12,
          lineHeight: 1,
          color: 'var(--n600,#6b6358)',
        }}
        data-testid="folder-sidebar-toggle"
      >
        {showSideTree ? '◧' : '▢'}
      </button>
      <button
        type="button"
        onClick={() => onNavigate('')}
        style={crumbBtn(!currentPath)}
        data-testid="crumb-root"
      >
        All files
      </button>
      {segments.map((seg, idx) => {
        const path = segments.slice(0, idx + 1).join('/')
        const isLast = idx === segments.length - 1
        return (
          <span key={path} style={{ display: 'inline-flex', alignItems: 'center' }}>
            <span style={{ color: 'var(--n400,#9c968d)', padding: '0 2px' }}>/</span>
            <button
              type="button"
              onClick={() => onNavigate(path)}
              style={crumbBtn(isLast)}
              data-testid={`crumb-${idx}`}
            >
              {seg}
            </button>
          </span>
        )
      })}
      {currentPath && (
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          {autoUpdateControl}
          <button
            type="button"
            onClick={stopIndexing}
            disabled={busy !== null}
            title="Cancel pending/processing index jobs for this folder (queue-side)"
            style={{
              padding: '4px 10px',
              fontSize: 11,
              border: '1px solid rgba(183,121,31,0.35)',
              borderRadius: 4,
              background: 'transparent',
              color: '#b7791f',
              cursor: busy ? 'wait' : 'pointer',
              fontWeight: 500,
            }}
            data-testid="stop-indexing"
          >
            {busy === 'stop-index' ? '…' : 'Stop indexing'}
          </button>
        </div>
      )}
      {(queueStopped || queuePaused) && currentPath && (
        <div
          role="note"
          style={{
            width: '100%',
            marginTop: 6,
            fontSize: 11,
            padding: '4px 8px',
            borderRadius: 4,
            background: queueStopped ? 'rgba(181,63,63,0.08)' : 'rgba(183,121,31,0.08)',
            color: queueStopped ? '#b53f3f' : '#b7791f',
            border:
              '1px solid ' + (queueStopped ? 'rgba(181,63,63,0.25)' : 'rgba(183,121,31,0.25)'),
            fontFamily: 'ui-monospace,monospace',
            display: 'flex',
            gap: 6,
            alignItems: 'center',
          }}
          data-testid="queue-global-state"
        >
          <span aria-hidden>{queueStopped ? '⏹' : '⏸'}</span>
          <span style={{ flex: 1 }}>
            {queueStopped
              ? 'The whole indexing queue is stopped — folder-scoped stop has no jobs to cancel until you Jump-start from the MCP panel.'
              : 'The whole indexing queue is paused — new jobs are not being picked up globally.'}
          </span>
        </div>
      )}
      {msg && (
        <div
          role="status"
          style={{
            width: '100%',
            marginTop: 6,
            fontSize: 11,
            padding: '4px 8px',
            borderRadius: 4,
            background: msg.kind === 'ok' ? 'rgba(45,138,78,0.08)' : 'rgba(181,63,63,0.08)',
            color: msg.kind === 'ok' ? '#2d8a4e' : '#b53f3f',
            border:
              '1px solid ' + (msg.kind === 'ok' ? 'rgba(45,138,78,0.25)' : 'rgba(181,63,63,0.25)'),
            fontFamily: 'ui-monospace,monospace',
          }}
          data-testid={msg.kind === 'ok' ? 'breadcrumb-ok' : 'breadcrumb-err'}
        >
          {msg.text}
        </div>
      )}
    </div>
  )
}
