import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

type Level = 'debug' | 'info' | 'warn' | 'error'

let logFile: string | null = null
let silent = false

export function configureLogger(opts: { file?: string | null; silent?: boolean }) {
  silent = opts.silent ?? silent
  logFile = opts.file ?? null
  if (logFile) mkdirSync(dirname(logFile), { recursive: true })
}

function write(level: Level, msg: string, meta?: Record<string, unknown>) {
  if (silent) return
  const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...meta })
  const out = level === 'error' || level === 'warn' ? console.error : console.log
  out(line)
  if (logFile) {
    try {
      appendFileSync(logFile, line + '\n')
    } catch {
      /* el log en fichero es best-effort */
    }
  }
}

export const log = {
  debug: (msg: string, meta?: Record<string, unknown>) => write('debug', msg, meta),
  info: (msg: string, meta?: Record<string, unknown>) => write('info', msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => write('warn', msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => write('error', msg, meta),
}
