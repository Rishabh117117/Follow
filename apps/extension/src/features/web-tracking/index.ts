/**
 * Web Tracking — self-initializing feature module.
 *
 * Emits page-level signals (navigation, visibility, scroll, selection, idle)
 * via the signal pipeline. When follow_web is enabled, these signals feed
 * into browser-type threads in the strands system, letting Follow track
 * the user's web browsing journey.
 */

import { signalPipeline } from '@/core/signal-pipeline'

/** Scroll depth tracking — only emits when crossing thresholds */
const SCROLL_THRESHOLDS = [25, 50, 75, 90, 100]
let maxScrollDepth = 0
let scrollTimeout: ReturnType<typeof setTimeout> | null = null

/** Time tracking */
let pageLoadTime = Date.now()

/** SPA navigation detection */
let lastUrl = window.location.href

function init(): void {
  // ─── Initial page navigate signal ───
  signalPipeline.emit('page_navigate', {
    url: window.location.href,
    title: document.title,
    domain: window.location.hostname,
    referrer: document.referrer || undefined,
    threadType: 'browser',
  })
  pageLoadTime = Date.now()

  // ─── Visibility tracking ───
  const handleVisibility = () => {
    const timeOnPage = Date.now() - pageLoadTime
    signalPipeline.emit('visibility', {
      url: window.location.href,
      hidden: document.hidden,
      timeOnPageMs: timeOnPage,
      threadType: 'browser',
    })
  }
  document.addEventListener('visibilitychange', handleVisibility)

  // ─── Scroll depth tracking (debounced) ───
  const handleScroll = () => {
    if (scrollTimeout) clearTimeout(scrollTimeout)
    scrollTimeout = setTimeout(() => {
      const scrollTop = window.scrollY || document.documentElement.scrollTop
      const docHeight = Math.max(
        document.body.scrollHeight,
        document.documentElement.scrollHeight
      ) - window.innerHeight
      if (docHeight <= 0) return

      const depth = Math.min(100, Math.round((scrollTop / docHeight) * 100))

      // Only emit when crossing a threshold for the first time
      for (const threshold of SCROLL_THRESHOLDS) {
        if (depth >= threshold && maxScrollDepth < threshold) {
          maxScrollDepth = threshold
          signalPipeline.emit('scroll', {
            url: window.location.href,
            depth: threshold,
            threadType: 'browser',
          })
          break
        }
      }
    }, 300)
  }
  window.addEventListener('scroll', handleScroll, { passive: true })

  // ─── Text selection tracking ───
  let selectionTimeout: ReturnType<typeof setTimeout> | null = null
  const handleSelection = () => {
    if (selectionTimeout) clearTimeout(selectionTimeout)
    selectionTimeout = setTimeout(() => {
      const sel = window.getSelection()
      const text = sel?.toString().trim()
      if (text && text.length > 3 && text.length < 500) {
        signalPipeline.emit('selection', {
          url: window.location.href,
          textLength: text.length,
          textPreview: text.slice(0, 100),
          threadType: 'browser',
        })
      }
    }, 500)
  }
  document.addEventListener('mouseup', handleSelection)

  // ─── SPA navigation detection (History API + hashchange) ───
  const checkNavigation = () => {
    const currentUrl = window.location.href
    if (currentUrl !== lastUrl) {
      const prevUrl = lastUrl
      lastUrl = currentUrl
      maxScrollDepth = 0
      pageLoadTime = Date.now()

      signalPipeline.emit('web_navigate', {
        url: currentUrl,
        fromUrl: prevUrl,
        title: document.title,
        domain: window.location.hostname,
        navigationType: 'spa',
        threadType: 'browser',
      })
    }
  }

  // Intercept pushState/replaceState for SPA detection
  const origPushState = history.pushState.bind(history)
  const origReplaceState = history.replaceState.bind(history)

  history.pushState = function (...args) {
    origPushState(...args)
    setTimeout(checkNavigation, 0)
  }
  history.replaceState = function (...args) {
    origReplaceState(...args)
    setTimeout(checkNavigation, 0)
  }

  window.addEventListener('popstate', () => setTimeout(checkNavigation, 0))
  window.addEventListener('hashchange', () => setTimeout(checkNavigation, 0))

  // ─── Cleanup ───
  document.addEventListener('follow-unload-web-tracking', () => {
    document.removeEventListener('visibilitychange', handleVisibility)
    window.removeEventListener('scroll', handleScroll)
    document.removeEventListener('mouseup', handleSelection)
    history.pushState = origPushState
    history.replaceState = origReplaceState
    if (scrollTimeout) clearTimeout(scrollTimeout)
    if (selectionTimeout) clearTimeout(selectionTimeout)
  })
}

init()
