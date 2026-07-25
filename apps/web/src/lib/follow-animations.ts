/**
 * Follow Animations — centralized animation presets and transition helpers.
 *
 * Provides CSS keyframe definitions, duration presets, easing curves,
 * and utility functions for consistent micro-interactions across Follow mode.
 */

// ─── Duration presets (ms) ─────────────────────────────────────────────────

export const DURATION = {
  instant: 100,
  fast: 150,
  normal: 200,
  slow: 300,
  panel: 250,
  modal: 200,
  toast: 3000,
  toastDismiss: 300,
} as const

// ─── Easing curves ─────────────────────────────────────────────────────────

export const EASING = {
  easeOut: 'cubic-bezier(0.16, 1, 0.3, 1)',
  easeIn: 'cubic-bezier(0.55, 0, 1, 0.45)',
  easeInOut: 'cubic-bezier(0.45, 0, 0.55, 1)',
  spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
  bounce: 'cubic-bezier(0.68, -0.55, 0.265, 1.55)',
} as const

// ─── CSS Keyframe names (referenced in Tailwind's animate-[] syntax) ──────

export const KEYFRAMES = {
  slideInRight: 'slideInRight',
  slideOutRight: 'slideOutRight',
  slideUp: 'slideUp',
  slideDown: 'slideDown',
  scaleIn: 'scaleIn',
  scaleOut: 'scaleOut',
  fadeIn: 'fadeIn',
  fadeOut: 'fadeOut',
  toastIn: 'toastSlideIn',
  toastOut: 'toastSlideOut',
} as const

// ─── Tailwind animation class helpers ─────────────────────────────────────

export function panelSlideIn(): string {
  return `animate-[${KEYFRAMES.slideInRight}_${DURATION.panel}ms_${EASING.easeOut}]`
}

export function panelSlideOut(): string {
  return `animate-[${KEYFRAMES.slideOutRight}_${DURATION.fast}ms_${EASING.easeIn}]`
}

export function popIn(): string {
  return `animate-[${KEYFRAMES.scaleIn}_${DURATION.instant}ms_${EASING.spring}]`
}

export function fadeIn(durationMs: number = DURATION.normal): string {
  return `animate-[${KEYFRAMES.fadeIn}_${durationMs}ms_${EASING.easeOut}]`
}

export function fadeOut(durationMs: number = DURATION.fast): string {
  return `animate-[${KEYFRAMES.fadeOut}_${durationMs}ms_${EASING.easeIn}]`
}

// ─── Transition style builders ────────────────────────────────────────────

export type TransitionProperty = 'all' | 'opacity' | 'transform' | 'background' | 'color' | 'border'

export interface TransitionConfig {
  property?: TransitionProperty
  duration?: number
  easing?: string
  delay?: number
}

export function buildTransition(config: TransitionConfig = {}): string {
  const {
    property = 'all',
    duration = DURATION.normal,
    easing = EASING.easeOut,
    delay = 0,
  } = config
  return `${property} ${duration}ms ${easing}${delay ? ` ${delay}ms` : ''}`
}

export function buildMultiTransition(configs: TransitionConfig[]): string {
  return configs.map(buildTransition).join(', ')
}

// ─── Stagger utility ──────────────────────────────────────────────────────

/** Generate staggered delay for list items */
export function staggerDelay(index: number, baseDelayMs: number = 30, maxDelayMs: number = 300): number {
  return Math.min(index * baseDelayMs, maxDelayMs)
}

/** Inline style for stagger animation */
export function staggerStyle(index: number): React.CSSProperties {
  return {
    animationDelay: `${staggerDelay(index)}ms`,
    animationFillMode: 'backwards',
  }
}

// ─── CSS keyframe definitions (for injection into globals.css) ────────────

export const KEYFRAME_DEFINITIONS = `
@keyframes slideInRight {
  from { transform: translateX(100%); opacity: 0; }
  to { transform: translateX(0); opacity: 1; }
}

@keyframes slideOutRight {
  from { transform: translateX(0); opacity: 1; }
  to { transform: translateX(100%); opacity: 0; }
}

@keyframes slideUp {
  from { transform: translateY(20px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}

@keyframes slideDown {
  from { transform: translateY(-20px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}

@keyframes scaleIn {
  from { transform: scale(0.9); opacity: 0; }
  to { transform: scale(1); opacity: 1; }
}

@keyframes scaleOut {
  from { transform: scale(1); opacity: 1; }
  to { transform: scale(0.9); opacity: 0; }
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes fadeOut {
  from { opacity: 1; }
  to { opacity: 0; }
}

@keyframes toastSlideIn {
  from { transform: translateX(100%) scale(0.95); opacity: 0; }
  to { transform: translateX(0) scale(1); opacity: 1; }
}

@keyframes toastSlideOut {
  from { transform: translateX(0) scale(1); opacity: 1; }
  to { transform: translateX(100%) scale(0.95); opacity: 0; }
}
`
