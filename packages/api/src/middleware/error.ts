import type { ErrorHandler } from 'hono'

export const errorHandler: ErrorHandler = (err, c) => {
  console.error('[API Error]', err)

  const status = 'status' in err ? (err.status as number) : 500

  return c.json(
    {
      data: null,
      error: {
        code: 'INTERNAL_ERROR',
        message: err.message || 'An unexpected error occurred',
      },
    },
    status as 500
  )
}
