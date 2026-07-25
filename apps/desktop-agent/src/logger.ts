/**
 * Console Logger (Sprint DA-1)
 *
 * Leveled logging with timestamps and ANSI colors.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

const COLORS: Record<LogLevel, string> = {
  debug: '\x1b[90m', // gray
  info: '\x1b[36m',  // cyan
  warn: '\x1b[33m',  // yellow
  error: '\x1b[31m', // red
}

const RESET = '\x1b[0m'

export interface Logger {
  debug(msg: string, ...args: unknown[]): void
  info(msg: string, ...args: unknown[]): void
  warn(msg: string, ...args: unknown[]): void
  error(msg: string, ...args: unknown[]): void
}

function timestamp(): string {
  return new Date().toTimeString().slice(0, 8)
}

export function createLogger(minLevel: LogLevel): Logger {
  const minOrder = LEVEL_ORDER[minLevel]

  function log(level: LogLevel, msg: string, args: unknown[]) {
    if (LEVEL_ORDER[level] < minOrder) return
    const tag = level.toUpperCase().padEnd(5)
    const prefix = `${COLORS[level]}[${timestamp()}] [${tag}]${RESET}`
    if (args.length > 0) {
      console.log(prefix, msg, ...args)
    } else {
      console.log(prefix, msg)
    }
  }

  return {
    debug: (msg, ...args) => log('debug', msg, args),
    info: (msg, ...args) => log('info', msg, args),
    warn: (msg, ...args) => log('warn', msg, args),
    error: (msg, ...args) => log('error', msg, args),
  }
}
