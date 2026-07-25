import React from 'react'
import { cn } from '@workspace/shared/utils'

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string
  error?: string
  maxLength?: number
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, label, error, maxLength, value, id, onChange, ...props }, ref) => {
    const [charCount, setCharCount] = React.useState(typeof value === 'string' ? value.length : 0)
    const textareaId = id || label?.toLowerCase().replace(/\s+/g, '-')

    const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setCharCount(e.target.value.length)
      onChange?.(e)
    }

    React.useEffect(() => {
      if (typeof value === 'string') {
        setCharCount(value.length)
      }
    }, [value])

    return (
      <div className="w-full">
        {label && (
          <label htmlFor={textareaId} className="mb-1.5 block text-sm font-medium text-zinc-300">
            {label}
          </label>
        )}
        <textarea
          ref={ref}
          id={textareaId}
          value={value}
          maxLength={maxLength}
          onChange={handleChange}
          className={cn(
            'flex min-h-[80px] w-full resize-y rounded-lg border bg-zinc-900 px-3 py-2 text-sm text-zinc-100 transition-colors duration-150 placeholder:text-zinc-500',
            'focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2 focus:ring-offset-zinc-950',
            'disabled:cursor-not-allowed disabled:opacity-50',
            error ? 'border-red-500 focus:ring-red-500' : 'border-zinc-700 hover:border-zinc-600',
            className
          )}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={
            error ? `${textareaId}-error` : maxLength ? `${textareaId}-count` : undefined
          }
          {...props}
        />
        <div className="mt-1.5 flex items-center justify-between">
          {error ? (
            <p id={`${textareaId}-error`} className="text-xs text-red-400" role="alert">
              {error}
            </p>
          ) : (
            <span />
          )}
          {maxLength !== undefined && (
            <p
              id={`${textareaId}-count`}
              className={cn('text-xs', charCount >= maxLength ? 'text-red-400' : 'text-zinc-500')}
            >
              {charCount}/{maxLength}
            </p>
          )}
        </div>
      </div>
    )
  }
)

Textarea.displayName = 'Textarea'
