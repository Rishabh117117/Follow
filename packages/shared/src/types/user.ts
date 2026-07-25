import type { User, UserRole } from './db'

export interface SessionUser extends Pick<User, 'id' | 'email' | 'name' | 'avatarUrl'> {
  workspaceId?: string
  role?: UserRole
}

/** User-editable settings stored in userProfiles.settings (JSONB). */
export interface UserSettings {
  bio?: string
  theme?: 'follow' | 'advanced' | 'system'
  defaultDocType?: 'file' | 'note'
  memoryEnabled?: boolean
  notifications?: {
    share?: boolean
    comment?: boolean
    mention?: boolean
    tension?: boolean
    system?: boolean
  }
}
