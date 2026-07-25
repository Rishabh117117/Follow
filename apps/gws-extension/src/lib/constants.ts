/** Follow GWS Extension constants */

/** Default API base URL — overridden by chrome.storage.local.apiBaseUrl */
export const DEFAULT_API_BASE_URL = 'http://localhost:3001'

/** Extension version — synced with manifest.json */
export const EXTENSION_VERSION = '0.1.0'

/** Signal batch interval in milliseconds */
export const SIGNAL_BATCH_INTERVAL = 5000

/** Maximum signals per batch */
export const MAX_BATCH_SIZE = 50

/** Maximum ghost drafts allowed simultaneously */
export const MAX_GHOST_DRAFTS = 3

/** Floating Unit dimensions */
export const FLOATING_UNIT = {
  DOT_SIZE: 38,
  COLLAPSED_WIDTH: 760,
  EXPANDED_MIN_HEIGHT: 320,
  BOTTOM_BAR_HEIGHT: 92,
} as const

/** Feature key type */
export type FeatureKey =
  | 'chat_in_document'
  | 'track_document'
  | 'document_analysis'
  | 'write_with_ai'
  | 'collaborate'
  | 'chat_in_web'

/** Feature metadata for rendering toggles */
export interface FeatureMeta {
  key: FeatureKey
  label: string
  color: string
  colorBg: string
  docOnly: boolean
}

/** All 6 toggleable features */
export const FEATURES: FeatureMeta[] = [
  { key: 'chat_in_document', label: 'Chat in Document', color: '#6366F1', colorBg: '#EEF2FF', docOnly: true },
  { key: 'track_document', label: 'Track Document', color: '#7C3AED', colorBg: '#F5F3FF', docOnly: true },
  { key: 'document_analysis', label: 'Document Analysis', color: '#D97706', colorBg: '#FFFBEB', docOnly: true },
  { key: 'write_with_ai', label: 'Write with AI', color: '#16A34A', colorBg: '#F0FDF4', docOnly: true },
  { key: 'collaborate', label: 'Collaborate', color: '#DC2626', colorBg: '#FEF2F2', docOnly: true },
  { key: 'chat_in_web', label: 'Chat in Web', color: '#0D9488', colorBg: '#F0FDFA', docOnly: false },
]

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
  ACTIVE_SMART_DOCS: 'follow_active_smart_docs',
  FEATURE_TOGGLES: 'follow_feature_toggles',
} as const
