/** Follow Unified Extension constants */

/** Default API base URL — overridden by chrome.storage.local */
export const DEFAULT_API_BASE_URL = 'http://localhost:3001'

/** Default web app URL for dashboard/profile links */
export const DEFAULT_WEB_APP_URL = 'http://localhost:3009'

/** Extension version */
export const EXTENSION_VERSION = '1.0.0'

/** Signal batch interval (ms) — coordinator flushes at this rate */
export const SIGNAL_BATCH_INTERVAL = 5000

/** Maximum signals per batch */
export const MAX_BATCH_SIZE = 50

/** Maximum offline queue size (FIFO eviction) */
export const MAX_QUEUE_SIZE = 1000

/** Maximum ghost drafts allowed simultaneously */
export const MAX_GHOST_DRAFTS = 3

/** Feature key type — consolidated features */
export type FeatureKey =
  | 'follow_chat'
  | 'track_document'
  | 'write_and_analyze'
  | 'follow_web'

/** Feature metadata for rendering toggles */
export interface FeatureMeta {
  key: FeatureKey
  label: string
  color: string
  colorBg: string
  /** Only available on Google Docs/Sheets/Slides pages */
  docOnly: boolean
}

/** All toggleable features */
export const FEATURES: FeatureMeta[] = [
  { key: 'follow_chat', label: 'Follow Chat', color: '#6366F1', colorBg: '#EEF2FF', docOnly: false },
  { key: 'track_document', label: 'Track Document', color: '#7C3AED', colorBg: '#F5F3FF', docOnly: true },
  { key: 'write_and_analyze', label: 'Write & Analyze', color: '#16A34A', colorBg: '#F0FDF4', docOnly: true },
  { key: 'follow_web', label: 'Follow on Web', color: '#0EA5E9', colorBg: '#F0F9FF', docOnly: false },
]

/** Floating Unit dimensions */
export const FLOATING_UNIT = {
  DOT_SIZE: 38,
  COLLAPSED_WIDTH: 680,
  EXPANDED_MIN_HEIGHT: 320,
  BOTTOM_BAR_HEIGHT: 92,
} as const

/** Colors matching Follow design system */
export const COLORS = {
  primary: '#6366F1',
  primaryHover: '#5558E6',
  blue: '#1A73E8',
  blueLight: '#E8F0FE',
  text: '#202124',
  textSecondary: '#5F6368',
  textTertiary: '#9AA0A6',
  surface: '#FFFFFF',
  surfaceHover: '#F1F3F4',
  border: '#E0E0E0',
  borderLight: '#E8EAED',
  borderDivider: '#DADCE0',
  green: '#16A34A',
  greenLight: '#DCFCE7',
  greenBg: '#E8F5E9',
  error: '#DC2626',
} as const

/** Storage keys for chrome.storage.local */
export const STORAGE_KEYS = {
  AUTH_TOKEN: 'follow_auth_token',
  API_BASE_URL: 'follow_api_base_url',
  USER_ID: 'follow_user_id',
  WORKSPACE_ID: 'follow_workspace_id',
  USER_EMAIL: 'follow_user_email',
  USER_NAME: 'follow_user_name',
  USER_AVATAR: 'follow_user_avatar',
  ACTIVE_SMART_DOCS: 'follow_active_smart_docs',
  FEATURE_TOGGLES: 'follow_feature_toggles',
} as const

/** Page types detected by the content script */
export type PageType = 'google-docs' | 'google-sheets' | 'google-slides' | 'web' | 'pdf'
