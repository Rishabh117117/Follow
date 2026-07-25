import { z } from 'zod'

export const CreateFileSchema = z.object({
  workspaceId: z.string().uuid(),
  parentFolderId: z.string().uuid().nullable().optional(),
  name: z.string().min(1).max(255),
  type: z.enum(['file', 'folder']),
  mimeType: z.string().optional(),
})

export const UpdateFileSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  parentFolderId: z.string().uuid().nullable().optional(),
})

export type CreateFileInput = z.infer<typeof CreateFileSchema>
export type UpdateFileInput = z.infer<typeof UpdateFileSchema>
